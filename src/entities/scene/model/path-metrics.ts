import {
	type AePoint,
	type AeShape,
	aeShapeArcLength,
	sampleAeShapePath,
} from "@/shared/glammer/ae-shape";
import {
	applyMatrixToPoint,
	type Matrix2D,
	matrixFromTransform,
} from "./rendering";
import type { Bounds, NodeGeometry, Vec2, VectorNode } from "./types";

const ELLIPSE_KAPPA = 0.5522847498307936;
const DEFAULT_STEPS_PER_SEGMENT = 160;
const EPSILON = 1e-6;

export type PathMetricSample = {
	readonly nodeId: string;
	readonly progress: number;
	readonly point: Vec2;
	readonly tangent: Vec2;
	readonly angleDegrees: number;
	readonly length: number;
	readonly segment: number;
	readonly segmentT: number;
};

export type PathMetricSampleOptions = {
	readonly stepsPerSegment?: number;
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const normalizeDegrees = (value: number): number => ((value % 360) + 360) % 360;

const finiteOr = (value: number | undefined, fallback: number): number =>
	typeof value === "number" && Number.isFinite(value) ? value : fallback;

const isFinitePoint = (point: readonly number[] | undefined): boolean =>
	Boolean(
		point &&
			point.length >= 2 &&
			Number.isFinite(point[0]) &&
			Number.isFinite(point[1]),
	);

const isSampleableShape = (shape: AeShape): boolean => {
	const pointCount = shape.vertices.length;
	const segmentCount = shape.closed ? pointCount : pointCount - 1;
	return (
		segmentCount > 0 &&
		pointCount === shape.inTangents.length &&
		pointCount === shape.outTangents.length &&
		shape.vertices.every(isFinitePoint) &&
		shape.inTangents.every(isFinitePoint) &&
		shape.outTangents.every(isFinitePoint)
	);
};

const zeroTangent = (): Vec2 => ({ x: 1, y: 0 });

const transformVector = (matrix: Matrix2D, [x, y]: AePoint): Vec2 => {
	const transformed = {
		x: matrix.a * x + matrix.c * y,
		y: matrix.b * x + matrix.d * y,
	};
	const length = Math.hypot(transformed.x, transformed.y);
	if (length <= EPSILON) return zeroTangent();
	return {
		x: transformed.x / length,
		y: transformed.y / length,
	};
};

const normalizePointVector = ([x, y]: AePoint): AePoint => {
	const length = Math.hypot(x, y);
	return length <= EPSILON ? [1, 0] : [x / length, y / length];
};

const addPoint = (a: AePoint, b: AePoint): AePoint => [
	a[0] + b[0],
	a[1] + b[1],
];

const segmentTangent = (
	shape: AeShape,
	segment: number,
	t: number,
	fallback: AePoint,
): AePoint => {
	const next = (segment + 1) % shape.vertices.length;
	const p0 = shape.vertices[segment];
	const p1 = addPoint(p0, shape.outTangents[segment]);
	const p3 = shape.vertices[next];
	const p2 = addPoint(p3, shape.inTangents[next]);
	const mt = 1 - t;
	const tangent: AePoint = [
		3 * mt * mt * (p1[0] - p0[0]) +
			6 * mt * t * (p2[0] - p1[0]) +
			3 * t * t * (p3[0] - p2[0]),
		3 * mt * mt * (p1[1] - p0[1]) +
			6 * mt * t * (p2[1] - p1[1]) +
			3 * t * t * (p3[1] - p2[1]),
	];
	if (Math.hypot(tangent[0], tangent[1]) > EPSILON) {
		return normalizePointVector(tangent);
	}
	const chord: AePoint = [p3[0] - p0[0], p3[1] - p0[1]];
	if (Math.hypot(chord[0], chord[1]) > EPSILON) {
		return normalizePointVector(chord);
	}
	return fallback;
};

const averageMatrixScale = (matrix: Matrix2D): number => {
	const scaleX = Math.hypot(matrix.a, matrix.b);
	const scaleY = Math.hypot(matrix.c, matrix.d);
	const scale = (scaleX + scaleY) / 2;
	return scale > EPSILON ? scale : 1;
};

const point = (x: number, y: number): AePoint => [x, y];

const zero = (): AePoint => [0, 0];

const rectShape = (bounds: Bounds): AeShape => {
	const { x, y, width, height } = bounds;
	return {
		type: "Shape",
		closed: true,
		vertices: [
			point(x, y),
			point(x + width, y),
			point(x + width, y + height),
			point(x, y + height),
		],
		inTangents: [zero(), zero(), zero(), zero()],
		outTangents: [zero(), zero(), zero(), zero()],
	};
};

const ellipseShape = (bounds: Bounds): AeShape => {
	const rx = bounds.width / 2;
	const ry = bounds.height / 2;
	const cx = bounds.x + rx;
	const cy = bounds.y + ry;
	const ox = rx * ELLIPSE_KAPPA;
	const oy = ry * ELLIPSE_KAPPA;
	return {
		type: "Shape",
		closed: true,
		vertices: [
			point(cx, cy - ry),
			point(cx + rx, cy),
			point(cx, cy + ry),
			point(cx - rx, cy),
		],
		inTangents: [point(-ox, 0), point(0, -oy), point(ox, 0), point(0, oy)],
		outTangents: [point(ox, 0), point(0, oy), point(-ox, 0), point(0, -oy)],
	};
};

const lineShape = (
	geometry: Extract<NodeGeometry, { readonly kind: "line" }>,
) =>
	({
		type: "Shape",
		closed: false,
		vertices: [
			point(geometry.start.x, geometry.start.y),
			point(geometry.end.x, geometry.end.y),
		],
		inTangents: [zero(), zero()],
		outTangents: [zero(), zero()],
	}) satisfies AeShape;

const shapeForMetric = (geometry: NodeGeometry): AeShape | null => {
	switch (geometry.kind) {
		case "path":
			return geometry.shape;
		case "ellipse":
			return ellipseShape(geometry.bounds);
		case "rect":
			return rectShape(geometry.bounds);
		case "line":
			return lineShape(geometry);
		default:
			return null;
	}
};

/**
 * Samples a path-like scene node in artboard coordinates. The helper accepts
 * authored path, ellipse, rectangle, and line geometry so motion expressions can
 * constrain bodies to ordinary editable scene objects without importing renderer
 * or React code. `point`, `tangent`, and `angleDegrees` are transformed into the
 * node's parent/artboard coordinate space; `length` is an affine-scaled estimate
 * suitable for authoring and bake metadata, not a physics integrator.
 */
export function sampleNodePathMetric(
	node: VectorNode,
	progress: number,
	options: PathMetricSampleOptions = {},
): PathMetricSample | null {
	const shape = shapeForMetric(node.geometry);
	if (!shape || !isSampleableShape(shape)) return null;
	const clampedProgress = clamp01(progress);
	const stepsPerSegment = Math.max(
		1,
		Math.round(finiteOr(options.stepsPerSegment, DEFAULT_STEPS_PER_SEGMENT)),
	);
	const sample = sampleAeShapePath(shape, clampedProgress, {
		stepsPerSegment,
	});
	const matrix = matrixFromTransform(node.transform);
	const point = applyMatrixToPoint(matrix, {
		x: sample.point[0],
		y: sample.point[1],
	});
	const tangent = transformVector(
		matrix,
		segmentTangent(shape, sample.segment, sample.segmentT, sample.tangent),
	);
	return {
		nodeId: node.id,
		progress: clampedProgress,
		point,
		tangent,
		angleDegrees: normalizeDegrees(
			(Math.atan2(tangent.y, tangent.x) * 180) / Math.PI,
		),
		length:
			aeShapeArcLength(shape, stepsPerSegment) * averageMatrixScale(matrix),
		segment: sample.segment,
		segmentT: sample.segmentT,
	};
}

/** Returns whether a node can currently serve as a parametric path target. */
export function canSampleNodePathMetric(node: VectorNode): boolean {
	const shape = shapeForMetric(node.geometry);
	return Boolean(shape && isSampleableShape(shape));
}
