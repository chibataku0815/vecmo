import {
	type AePoint,
	type AeShape,
	sampleAeShapePath,
} from "@/shared/glammer/ae-shape";
import { createId } from "@/shared/lib/id";
import {
	buildRoundedRectShape,
	filletPolygonShape,
	resolveCornerRadii,
	resolveCornerSmoothing,
	starVertices,
} from "./corner-geometry";
import {
	type GradientPaint,
	interpolateGradientForBlend,
	isGradientPaint,
} from "./gradient-edit";
import {
	applyMatrixToPoint,
	getNodeLocalBounds,
	getNodeParentBounds,
	matrixFromTransform,
	unionBounds,
} from "./rendering";
import type {
	BlendOrientation,
	BlendSourceAnchorRef,
	BlendSourceStop,
	BlendSpacing,
	BlendSpine,
	BlendStackingOrder,
	Bounds,
	FillRule,
	NodeGeometry,
	NodeStyle,
	Paint,
	SceneDocument,
	SolidPaint,
	Transform,
	Vec2,
	VectorNode,
} from "./types";

export type BlendIssueCode =
	| "blend.requires-at-least-two-sources"
	| "blend.duplicate-source"
	| "blend.missing-source"
	| "blend.child-source"
	| "blend.cross-layer-source"
	| "blend.cross-artboard-source"
	| "blend.locked-source"
	| "blend.hidden-source"
	| "blend.unsupported-source";

export type BlendIssueSeverity = "warning" | "error";

export type BlendIssue = {
	readonly code: BlendIssueCode;
	readonly severity: BlendIssueSeverity;
	readonly message: string;
	readonly nodeId?: string;
	readonly layerId?: string;
};

export type BlendOptions = {
	readonly spacing?: BlendSpacing;
	readonly spine?: BlendSpine;
	readonly orientation?: BlendOrientation;
};

const BLEND_VERSION = 1;
const DEFAULT_BLEND_STEPS = 8;
export const MAX_BLEND_STEPS = 256;
const MAX_BLEND_GENERATED_NODE_COUNT = 1024;
const DEFAULT_SMOOTH_COLOR_MAX_STEPS = 64;
const MIN_DISTANCE = 1;
const BLEND_SAMPLE_VERTEX_COUNT = 64;
const MAX_BLEND_COMPOUND_CONTOURS = 16;
const BLEND_SAMPLE_STEPS_PER_SEGMENT = 48;
const BLEND_SPINE_SEGMENT_SAMPLE_STEPS = 48;
const BLEND_SPINE_SEGMENT_DRAG_MIN_WEIGHT = 1e-3;
const BLEND_SPINE_SEGMENT_MIN_T = 0.05;
const BLEND_SPINE_INSERT_MIN_DISTANCE = 1e-3;
const BLEND_SPINE_MIN_LENGTH = 1e-6;
const BLEND_SOURCE_ANCHOR_MATCH_EPSILON = 1e-3;
const ELLIPSE_KAPPA = 0.5522847498307936;
const GROUP_WRAPPER_STYLE: NodeStyle = {
	fill: "none",
	stroke: "none",
	strokeWidth: 0,
	opacity: 1,
};

const issue = (
	code: BlendIssueCode,
	message: string,
	nodeId?: string,
	layerId?: string,
): BlendIssue => ({
	code,
	severity: "error",
	message,
	...(nodeId ? { nodeId } : {}),
	...(layerId ? { layerId } : {}),
});

const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));

const finiteOr = (value: number, fallback: number): number =>
	Number.isFinite(value) ? value : fallback;

const positiveOr = (value: number, fallback: number): number =>
	Number.isFinite(value) && value > 0 ? value : fallback;

const lerp = (from: number, to: number, t: number): number =>
	from + (to - from) * t;

const lerpVec2 = (from: Vec2, to: Vec2, t: number): Vec2 => ({
	x: lerp(from.x, to.x, t),
	y: lerp(from.y, to.y, t),
});

const lerpBounds = (from: Bounds, to: Bounds, t: number): Bounds => ({
	x: lerp(from.x, to.x, t),
	y: lerp(from.y, to.y, t),
	width: positiveOr(lerp(from.width, to.width, t), from.width),
	height: positiveOr(lerp(from.height, to.height, t), from.height),
});

const lerpRotation = (from: number, to: number, t: number): number => {
	let delta = ((to - from) % 360) + 360;
	if (delta > 180) delta -= 360;
	return from + delta * t;
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const nodeCenter = (node: VectorNode): Vec2 => {
	const bounds = getNodeParentBounds(node);
	return {
		x: bounds.x + bounds.width / 2,
		y: bounds.y + bounds.height / 2,
	};
};

const nodeLocalCenter = (node: VectorNode): Vec2 => {
	const bounds = getNodeLocalBounds(node);
	return {
		x: bounds.x + bounds.width / 2,
		y: bounds.y + bounds.height / 2,
	};
};

const pointDistance = (from: Vec2, to: Vec2): number =>
	Math.hypot(to.x - from.x, to.y - from.y);

const isFiniteVec2 = (point: Vec2): boolean =>
	Number.isFinite(point.x) && Number.isFinite(point.y);

const cleanVec2 = (point: Vec2 | undefined): Vec2 | undefined =>
	point && isFiniteVec2(point) ? { x: point.x, y: point.y } : undefined;

const cleanBlendSourceAnchorRef = (
	anchorRef: BlendSourceAnchorRef | undefined,
): BlendSourceAnchorRef | undefined => {
	if (!anchorRef || !Number.isInteger(anchorRef.index) || anchorRef.index < 0) {
		return undefined;
	}
	if (anchorRef.kind === "main")
		return { kind: "main", index: anchorRef.index };
	return Number.isInteger(anchorRef.subpathIndex) && anchorRef.subpathIndex >= 0
		? {
				kind: "subpath",
				subpathIndex: anchorRef.subpathIndex,
				index: anchorRef.index,
			}
		: undefined;
};

const cleanBlendSourceStop = (
	nodeId: string,
	sourceStops?: readonly BlendSourceStop[],
): BlendSourceStop => {
	const sourceStop = sourceStops?.find((stop) => stop.nodeId === nodeId);
	const localPoint = cleanVec2(sourceStop?.localPoint);
	const anchorRef = cleanBlendSourceAnchorRef(sourceStop?.anchorRef);
	return localPoint || anchorRef
		? {
				nodeId,
				...(anchorRef ? { anchorRef } : {}),
				...(localPoint ? { localPoint } : {}),
			}
		: { nodeId };
};

/**
 * Normalizes optional Blend source-stop metadata against the ordered source id
 * contract. Returns `undefined` when every source still uses center
 * registration so legacy/center blends stay compact.
 */
export function normalizeBlendSourceStops(
	sourceNodeIds: readonly string[],
	sourceStops?: readonly BlendSourceStop[],
): readonly BlendSourceStop[] | undefined {
	const normalized = sourceNodeIds.map((nodeId) =>
		cleanBlendSourceStop(nodeId, sourceStops),
	);
	return normalized.some((stop) => stop.localPoint || stop.anchorRef)
		? normalized
		: undefined;
}

const blendSourceLocalPoint = (
	node: VectorNode,
	sourceStop?: BlendSourceStop,
): Vec2 =>
	blendSourceAnchorLocalPoint(node, sourceStop?.anchorRef) ??
	cleanVec2(sourceStop?.localPoint) ??
	nodeLocalCenter(node);

/** Resolves a source stop registration point in the Blend parent coordinate space. */
export function blendSourceStopParentPoint(
	node: VectorNode,
	sourceStop?: BlendSourceStop,
): Vec2 {
	return applyMatrixToPoint(
		matrixFromTransform(node.transform),
		blendSourceLocalPoint(node, sourceStop),
	);
}

export type ResolvedBlendSourceStop = {
	readonly nodeId: string;
	readonly localPoint: Vec2;
	readonly parentPoint: Vec2;
	readonly anchorRef?: BlendSourceAnchorRef;
	readonly explicitLocalPoint?: Vec2;
};

/**
 * Resolves source ids plus optional local attachment points into the exact
 * points used for default spines, spacing distance, source movement, preview,
 * and generated-step placement.
 */
export function resolveBlendSourceStops(
	sources: readonly VectorNode[],
	sourceStops?: readonly BlendSourceStop[],
): readonly ResolvedBlendSourceStop[] {
	const normalized = normalizeBlendSourceStops(
		sources.map((source) => source.id),
		sourceStops,
	);
	return sources.map((source) => {
		const sourceStop = normalized?.find((stop) => stop.nodeId === source.id);
		const anchorRef = cleanBlendSourceAnchorRef(sourceStop?.anchorRef);
		const explicitLocalPoint = cleanVec2(sourceStop?.localPoint);
		const localPoint = blendSourceLocalPoint(source, sourceStop);
		return {
			nodeId: source.id,
			localPoint,
			parentPoint: applyMatrixToPoint(
				matrixFromTransform(source.transform),
				localPoint,
			),
			...(anchorRef ? { anchorRef } : {}),
			...(explicitLocalPoint ? { explicitLocalPoint } : {}),
		};
	});
}

const pointFromAe = (point: readonly number[] | undefined): Vec2 => ({
	x: finiteOr(point?.[0] ?? 0, 0),
	y: finiteOr(point?.[1] ?? 0, 0),
});

const addVec2 = (from: Vec2, delta: Vec2): Vec2 => ({
	x: from.x + delta.x,
	y: from.y + delta.y,
});

const subtractVec2 = (from: Vec2, to: Vec2): Vec2 => ({
	x: from.x - to.x,
	y: from.y - to.y,
});

const dotVec2 = (from: Vec2, to: Vec2): number => from.x * to.x + from.y * to.y;

const cubicPoint = (
	p0: Vec2,
	p1: Vec2,
	p2: Vec2,
	p3: Vec2,
	t: number,
): Vec2 => {
	const mt = 1 - t;
	const a = mt * mt * mt;
	const b = 3 * mt * mt * t;
	const c = 3 * mt * t * t;
	const d = t * t * t;
	return {
		x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
		y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
	};
};

const projectPointToLineSegment = (
	point: Vec2,
	from: Vec2,
	to: Vec2,
): { readonly point: Vec2; readonly t: number; readonly distance: number } => {
	const segment = subtractVec2(to, from);
	const lengthSquared = dotVec2(segment, segment);
	if (lengthSquared <= 0) {
		return { point: from, t: 0, distance: pointDistance(point, from) };
	}
	const rawT = dotVec2(subtractVec2(point, from), segment) / lengthSquared;
	const t = clamp(rawT, 0, 1);
	const projected = lerpVec2(from, to, t);
	return { point: projected, t, distance: pointDistance(point, projected) };
};

const sourceDistance = (from: VectorNode, to: VectorNode): number => {
	const a = nodeCenter(from);
	const b = nodeCenter(to);
	return pointDistance(a, b);
};

const angleBetween = (from: Vec2, to: Vec2): number =>
	(Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;

const angleDelta = (from: number, to: number): number => {
	let delta = ((to - from) % 360) + 360;
	if (delta > 180) delta -= 360;
	return delta;
};

const applyMatrixToVector = (
	matrix: ReturnType<typeof matrixFromTransform>,
	point: readonly [number, number],
): [number, number] => [
	matrix.a * point[0] + matrix.c * point[1],
	matrix.b * point[0] + matrix.d * point[1],
];

const transformShape = (
	shape: AeShape,
	matrix: ReturnType<typeof matrixFromTransform>,
): AeShape => ({
	type: "Shape",
	closed: shape.closed,
	vertices: shape.vertices.map(([x, y]) => {
		const point = applyMatrixToPoint(matrix, { x, y });
		return [point.x, point.y] as AePoint;
	}),
	inTangents: shape.inTangents.map((point) =>
		applyMatrixToVector(matrix, point),
	),
	outTangents: shape.outTangents.map((point) =>
		applyMatrixToVector(matrix, point),
	),
});

/**
 * Resolves user-authored blend spacing to the bounded domain the renderer can
 * materialize without exploding the scene tree.
 */
export function normalizeBlendSpacing(spacing?: BlendSpacing): BlendSpacing {
	if (!spacing) return { kind: "specified-steps", steps: DEFAULT_BLEND_STEPS };
	switch (spacing.kind) {
		case "specified-steps":
			return {
				kind: "specified-steps",
				steps: Math.round(
					clamp(
						finiteOr(spacing.steps, DEFAULT_BLEND_STEPS),
						1,
						MAX_BLEND_STEPS,
					),
				),
			};
		case "specified-distance":
			return {
				kind: "specified-distance",
				distance: positiveOr(spacing.distance, 40),
			};
		case "smooth-color":
			return {
				kind: "smooth-color",
				maxSteps: Math.round(
					clamp(
						finiteOr(
							spacing.maxSteps ?? DEFAULT_SMOOTH_COLOR_MAX_STEPS,
							DEFAULT_SMOOTH_COLOR_MAX_STEPS,
						),
						1,
						MAX_BLEND_STEPS,
					),
				),
			};
	}
}

export function normalizeBlendOrientation(
	orientation?: BlendOrientation,
): BlendOrientation {
	return orientation === "spine" ? "spine" : "page";
}

/** Resolves an omitted Blend stacking contract to normal paint order. */
export function normalizeBlendStacking(
	stacking?: BlendStackingOrder,
): BlendStackingOrder {
	return stacking === "reversed" ? "reversed" : "normal";
}

/**
 * Approximates the drawable length of a Blend spine in parent/artboard units.
 * Specified-distance spacing uses this value so custom and closed spines control
 * density by their actual contour length instead of endpoint-center distance.
 */
export function blendSpineLength(spine: BlendSpine): number | null {
	if (spine.kind === "line") {
		const length = pointDistance(spine.start, spine.end);
		return length > 0 ? length : null;
	}
	if (!canSampleShape(spine.shape) || !isFiniteShape(spine.shape)) return null;
	const segmentCount = spine.shape.closed
		? spine.shape.vertices.length
		: spine.shape.vertices.length - 1;
	if (segmentCount <= 0) return null;
	const stepCount = Math.max(
		1,
		segmentCount * BLEND_SPINE_SEGMENT_SAMPLE_STEPS,
	);
	let length = 0;
	let previous = sampleAeShapePath(spine.shape, 0, {
		stepsPerSegment: BLEND_SAMPLE_STEPS_PER_SEGMENT,
	}).point;
	for (let step = 1; step <= stepCount; step += 1) {
		const current = sampleAeShapePath(spine.shape, step / stepCount, {
			stepsPerSegment: BLEND_SAMPLE_STEPS_PER_SEGMENT,
		}).point;
		length += Math.hypot(current[0] - previous[0], current[1] - previous[1]);
		previous = current;
	}
	return length > 0 ? length : null;
}

const blendSpineRangeLength = (
	spine: BlendSpine,
	fromT: number,
	toT: number,
): number | null => {
	const startT = clamp(Math.min(fromT, toT), 0, 1);
	const endT = clamp(Math.max(fromT, toT), 0, 1);
	if (endT <= startT) return null;
	if (spine.kind === "line") {
		const start = sampleBlendSpine(spine, startT).point;
		const end = sampleBlendSpine(spine, endT).point;
		const length = pointDistance(start, end);
		return length > 0 ? length : null;
	}
	const segmentCount = spine.shape.closed
		? spine.shape.vertices.length
		: spine.shape.vertices.length - 1;
	const stepCount = Math.max(
		1,
		Math.ceil(
			segmentCount *
				BLEND_SPINE_SEGMENT_SAMPLE_STEPS *
				Math.max(0.02, endT - startT),
		),
	);
	let length = 0;
	let previous = sampleBlendSpine(spine, startT).point;
	for (let step = 1; step <= stepCount; step += 1) {
		const current = sampleBlendSpine(
			spine,
			lerp(startT, endT, step / stepCount),
		).point;
		length += pointDistance(previous, current);
		previous = current;
	}
	return length > 0 ? length : null;
};

const blendStepCountForDistance = (
	from: VectorNode,
	to: VectorNode,
	spacing: BlendSpacing,
	distance: number,
): number => {
	const normalized = normalizeBlendSpacing(spacing);
	switch (normalized.kind) {
		case "specified-steps":
			return normalized.steps;
		case "specified-distance":
			return Math.round(
				clamp(
					Math.floor(distance / Math.max(MIN_DISTANCE, normalized.distance)),
					1,
					MAX_BLEND_STEPS,
				),
			);
		case "smooth-color":
			return smoothColorStepCount(
				from,
				to,
				normalized.maxSteps ?? DEFAULT_SMOOTH_COLOR_MAX_STEPS,
				distance,
			);
	}
};

/**
 * Computes the number of generated intermediate children for a pair of blend
 * endpoints. Counts are intentionally bounded because generated steps are real
 * scene nodes in the presentation tree.
 */
export function blendStepCount(
	from: VectorNode,
	to: VectorNode,
	spacing: BlendSpacing,
	spine?: BlendSpine,
	sourceStops?: readonly BlendSourceStop[],
): number {
	const [fromStop, toStop] = resolveBlendSourceStops([from, to], sourceStops);
	const attachmentDistance =
		fromStop && toStop
			? pointDistance(fromStop.parentPoint, toStop.parentPoint)
			: sourceDistance(from, to);
	const distance = spine
		? (blendSpineLength(spine) ?? attachmentDistance)
		: attachmentDistance;
	return blendStepCountForDistance(from, to, spacing, distance);
}

const haveSameShapeTopology = (from: AeShape, to: AeShape): boolean =>
	from.closed === to.closed &&
	from.vertices.length === to.vertices.length &&
	from.inTangents.length === to.inTangents.length &&
	from.outTangents.length === to.outTangents.length;

const lerpPoint = (
	from: readonly [number, number],
	to: readonly [number, number],
	t: number,
): [number, number] => [lerp(from[0], to[0], t), lerp(from[1], to[1], t)];

const interpolateShape = (from: AeShape, to: AeShape, t: number): AeShape => {
	if (!haveSameShapeTopology(from, to)) return clone(t >= 1 ? to : from);
	return {
		type: "Shape",
		closed: from.closed,
		vertices: from.vertices.map((point, index) =>
			lerpPoint(point, to.vertices[index], t),
		),
		inTangents: from.inTangents.map((point, index) =>
			lerpPoint(point, to.inTangents[index], t),
		),
		outTangents: from.outTangents.map((point, index) =>
			lerpPoint(point, to.outTangents[index], t),
		),
	};
};

const zeroAePoint = (): AePoint => [0, 0];

const buildEllipseShape = (bounds: Bounds): AeShape => {
	const { x, y, width, height } = bounds;
	const rx = Math.max(0, width) / 2;
	const ry = Math.max(0, height) / 2;
	const cx = x + rx;
	const cy = y + ry;
	const kx = rx * ELLIPSE_KAPPA;
	const ky = ry * ELLIPSE_KAPPA;
	return {
		type: "Shape",
		closed: true,
		vertices: [
			[cx, y],
			[x + width, cy],
			[cx, y + height],
			[x, cy],
		],
		inTangents: [
			[-kx, 0],
			[0, -ky],
			[kx, 0],
			[0, ky],
		],
		outTangents: [
			[kx, 0],
			[0, ky],
			[-kx, 0],
			[0, -ky],
		],
	};
};

const geometryShapeForBlend = (geometry: NodeGeometry): AeShape | null => {
	switch (geometry.kind) {
		case "rect":
			return buildRoundedRectShape(geometry.bounds, {
				radii: resolveCornerRadii(geometry),
				smoothing: resolveCornerSmoothing(geometry),
			});
		case "ellipse":
			return buildEllipseShape(geometry.bounds);
		case "line":
			return {
				type: "Shape",
				closed: false,
				vertices: [
					[geometry.start.x, geometry.start.y],
					[geometry.end.x, geometry.end.y],
				],
				inTangents: [zeroAePoint(), zeroAePoint()],
				outTangents: [zeroAePoint(), zeroAePoint()],
			};
		case "polygon":
			return filletPolygonShape(
				geometry.points,
				geometry.cornerRadius ?? 0,
				resolveCornerSmoothing(geometry),
			);
		case "star":
			return filletPolygonShape(
				starVertices(geometry),
				geometry.cornerRadius ?? 0,
				resolveCornerSmoothing(geometry),
			);
		case "path":
			return geometry.shape;
		case "text":
		case "image":
			return null;
	}
};

const geometryContourForBlendAnchorRef = (
	geometry: NodeGeometry,
	anchorRef: BlendSourceAnchorRef | undefined,
): AeShape | null => {
	if (!anchorRef) return null;
	if (anchorRef.kind === "main") return geometryShapeForBlend(geometry);
	return geometrySubpathsForBlend(geometry)[anchorRef.subpathIndex] ?? null;
};

function blendSourceAnchorLocalPoint(
	node: VectorNode,
	anchorRef: BlendSourceAnchorRef | undefined,
): Vec2 | undefined {
	const contour = geometryContourForBlendAnchorRef(node.geometry, anchorRef);
	const point = anchorRef ? contour?.vertices[anchorRef.index] : undefined;
	const localPoint = point ? pointFromAe(point) : undefined;
	return localPoint && isFiniteVec2(localPoint) ? localPoint : undefined;
}

/**
 * Pickable source-attachment vertex exposed to the Blend tool. `localPoint` is
 * the hit-test/render point; `anchorRef` is the durable contour address stored
 * on the Blend contract when the user clicks that point.
 */
export type BlendSourceAttachmentCandidate = {
	readonly localPoint: Vec2;
	readonly anchorRef: BlendSourceAnchorRef;
};

/**
 * Local points users can explicitly register as Blend source stops. These mirror
 * the anchors/endpoints the source geometry actually renders, excluding Bezier
 * control handles so source targeting stays unambiguous.
 */
export function blendSourceAttachmentCandidates(
	node: VectorNode,
): readonly BlendSourceAttachmentCandidate[] {
	const shape = geometryShapeForBlend(node.geometry);
	if (!shape) return [];
	const contours = [
		{ anchorRef: { kind: "main" } as const, shape },
		...geometrySubpathsForBlend(node.geometry).map((subpath, subpathIndex) => ({
			anchorRef: { kind: "subpath", subpathIndex } as const,
			shape: subpath,
		})),
	];
	const candidates: BlendSourceAttachmentCandidate[] = [];
	for (const contour of contours) {
		for (let index = 0; index < contour.shape.vertices.length; index += 1) {
			const [x, y] = contour.shape.vertices[index] ?? [NaN, NaN];
			const point = { x, y };
			if (!isFiniteVec2(point)) continue;
			if (
				candidates.some(
					(existing) =>
						pointDistance(existing.localPoint, point) <= BLEND_SPINE_MIN_LENGTH,
				)
			) {
				continue;
			}
			candidates.push({
				localPoint: point,
				anchorRef:
					contour.anchorRef.kind === "main"
						? { kind: "main", index }
						: {
								kind: "subpath",
								subpathIndex: contour.anchorRef.subpathIndex,
								index,
							},
			});
		}
	}
	return candidates;
}

/**
 * Compatibility projection for overlay code that only needs to draw source
 * attachment points and does not persist a clicked contour address.
 */
export function blendSourceAttachmentLocalPoints(
	node: VectorNode,
): readonly Vec2[] {
	return blendSourceAttachmentCandidates(node).map(
		(candidate) => candidate.localPoint,
	);
}

const canSampleShape = (shape: AeShape): boolean =>
	shape.vertices.length > 0 &&
	shape.vertices.length === shape.inTangents.length &&
	shape.vertices.length === shape.outTangents.length &&
	(shape.closed || shape.vertices.length > 1);

const isFinitePoint = (point: readonly number[]): boolean =>
	point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]);

const isFiniteShape = (shape: AeShape): boolean =>
	shape.vertices.every(isFinitePoint) &&
	shape.inTangents.every(isFinitePoint) &&
	shape.outTangents.every(isFinitePoint);

const shapeHasSpineLength = (shape: AeShape): boolean => {
	const segmentCount = shape.closed
		? shape.vertices.length
		: shape.vertices.length - 1;
	for (let segment = 0; segment < segmentCount; segment += 1) {
		const next = (segment + 1) % shape.vertices.length;
		const p0 = pointFromAe(shape.vertices[segment]);
		const p3 = pointFromAe(shape.vertices[next]);
		const p1 = addVec2(p0, pointFromAe(shape.outTangents[segment]));
		const p2 = addVec2(p3, pointFromAe(shape.inTangents[next]));
		let previous = p0;
		for (let step = 1; step <= BLEND_SPINE_SEGMENT_SAMPLE_STEPS; step += 1) {
			const point = cubicPoint(
				p0,
				p1,
				p2,
				p3,
				step / BLEND_SPINE_SEGMENT_SAMPLE_STEPS,
			);
			if (pointDistance(previous, point) > BLEND_SPINE_MIN_LENGTH) {
				return true;
			}
			previous = point;
		}
	}
	return false;
};

/**
 * Guards authored Blend spines before command code stores them. The default
 * straight endpoint spine is represented by `blend.spine === undefined`; any
 * persisted spine must therefore be a real editable line or finite path. Closed
 * paths are valid custom spines, but command code treats them as contour
 * distribution paths rather than endpoint-attachment paths.
 */
export function canUseCustomBlendSpine(spine: BlendSpine): boolean {
	if (spine.kind === "line") {
		return (
			Number.isFinite(spine.start.x) &&
			Number.isFinite(spine.start.y) &&
			Number.isFinite(spine.end.x) &&
			Number.isFinite(spine.end.y) &&
			pointDistance(spine.start, spine.end) > 0
		);
	}
	return (
		canSampleShape(spine.shape) &&
		isFiniteShape(spine.shape) &&
		shapeHasSpineLength(spine.shape)
	);
}

/** Identifies contour spines whose start/end samples coincide at a path seam. */
export function isClosedBlendSpine(spine: BlendSpine): boolean {
	return spine.kind === "path" && spine.shape.closed;
}

/**
 * Removes an anchor from an authored Blend path spine. Open path endpoints are
 * protected because they own the source/target attachment contract; closed
 * contour anchors are all removable as long as the resulting spine remains
 * sampleable.
 */
export function removeBlendPathSpineAnchor(
	spine: BlendSpine,
	index: number,
): BlendSpine | null {
	if (spine.kind !== "path") return null;
	const { shape } = spine;
	if (
		shape.vertices.length !== shape.inTangents.length ||
		shape.vertices.length !== shape.outTangents.length ||
		!Number.isInteger(index) ||
		index < 0 ||
		index >= shape.vertices.length ||
		(!shape.closed && (index <= 0 || index >= shape.vertices.length - 1)) ||
		(shape.closed && shape.vertices.length <= 1)
	) {
		return null;
	}
	const withoutAnchor = (points: readonly AePoint[]): AePoint[] =>
		points
			.filter((_, pointIndex) => pointIndex !== index)
			.map((point) => [point[0], point[1]] as AePoint);
	const next: BlendSpine = {
		kind: "path",
		shape: {
			type: "Shape",
			closed: shape.closed,
			vertices: withoutAnchor(shape.vertices),
			inTangents: withoutAnchor(shape.inTangents),
			outTangents: withoutAnchor(shape.outTangents),
		},
	};
	return canUseCustomBlendSpine(next) ? next : null;
}

/** Backward-compatible name for the original open-path-only delete helper. */
export function removeInteriorOpenBlendSpineAnchor(
	spine: BlendSpine,
	index: number,
): BlendSpine | null {
	if (spine.kind === "path" && spine.shape.closed) return null;
	return removeBlendPathSpineAnchor(spine, index);
}

/**
 * Resets one authored Blend spine tangent handle to a corner while preserving the
 * opposite tangent. This mirrors direct path editing: deleting an in/out handle
 * changes only that curve side and keeps open endpoint/closed contour validity
 * guarded by the Blend spine predicate.
 */
export function resetBlendPathSpineHandle(
	spine: BlendSpine,
	index: number,
	kind: "in" | "out",
): BlendSpine | null {
	if (
		spine.kind !== "path" ||
		!Number.isInteger(index) ||
		index < 0 ||
		index >= spine.shape.vertices.length ||
		spine.shape.vertices.length !== spine.shape.inTangents.length ||
		spine.shape.vertices.length !== spine.shape.outTangents.length
	) {
		return null;
	}
	const tangent =
		kind === "in"
			? spine.shape.inTangents[index]
			: spine.shape.outTangents[index];
	if (!tangent || (tangent[0] === 0 && tangent[1] === 0)) return null;
	const nextShape: AeShape = {
		type: "Shape",
		closed: spine.shape.closed,
		vertices: spine.shape.vertices.map(
			(point) => [point[0], point[1]] as AePoint,
		),
		inTangents: spine.shape.inTangents.map(
			(point) => [point[0], point[1]] as AePoint,
		),
		outTangents: spine.shape.outTangents.map(
			(point) => [point[0], point[1]] as AePoint,
		),
	};
	if (kind === "in") {
		nextShape.inTangents[index] = zeroAePoint();
	} else {
		nextShape.outTangents[index] = zeroAePoint();
	}
	const next: BlendSpine = { kind: "path", shape: nextShape };
	return canUseCustomBlendSpine(next) ? next : null;
}

/** Nearest path spine segment sample used to split or bend a Blend spine. */
export type BlendSpineSegmentProjection = {
	readonly segment: number;
	readonly t: number;
	readonly point: Vec2;
};

/** Result of inserting a new editable anchor into an authored Blend spine. */
export type BlendSpineAnchorInsertion = {
	readonly spine: BlendSpine;
	readonly anchorIndex: number;
};

const pathSpineSegmentControls = (
	shape: AeShape,
	segment: number,
): {
	readonly next: number;
	readonly p0: Vec2;
	readonly p1: Vec2;
	readonly p2: Vec2;
	readonly p3: Vec2;
} | null => {
	const segmentCount = shape.closed
		? shape.vertices.length
		: shape.vertices.length - 1;
	if (
		shape.vertices.length === 0 ||
		shape.vertices.length !== shape.inTangents.length ||
		shape.vertices.length !== shape.outTangents.length ||
		!Number.isInteger(segment) ||
		segment < 0 ||
		segment >= segmentCount
	) {
		return null;
	}
	const next = shape.closed
		? (segment + 1) % shape.vertices.length
		: segment + 1;
	const p0 = pointFromAe(shape.vertices[segment]);
	const p3 = pointFromAe(shape.vertices[next]);
	return {
		next,
		p0,
		p1: addVec2(p0, pointFromAe(shape.outTangents[segment])),
		p2: addVec2(p3, pointFromAe(shape.inTangents[next])),
		p3,
	};
};

/**
 * Projects an artboard-space point onto an authored path Blend spine segment.
 * Handles/anchors should be hit-tested first; this is the segment-drag fallback
 * used to bend the spine without inserting an anchor. The historical function
 * name is kept for existing callers, but closed contour segments are supported.
 */
export function projectOpenBlendSpineSegment(
	spine: BlendSpine,
	point: Vec2,
	tolerance: number,
): BlendSpineSegmentProjection | null {
	if (
		spine.kind !== "path" ||
		!isFiniteVec2(point) ||
		!Number.isFinite(tolerance) ||
		tolerance < 0
	) {
		return null;
	}
	let best:
		| (BlendSpineSegmentProjection & { readonly distance: number })
		| null = null;
	const segmentCount = spine.shape.closed
		? spine.shape.vertices.length
		: spine.shape.vertices.length - 1;
	for (let segment = 0; segment < segmentCount; segment += 1) {
		const controls = pathSpineSegmentControls(spine.shape, segment);
		if (!controls) continue;
		let previous = controls.p0;
		let previousT = 0;
		for (let step = 1; step <= BLEND_SPINE_SEGMENT_SAMPLE_STEPS; step += 1) {
			const currentT = step / BLEND_SPINE_SEGMENT_SAMPLE_STEPS;
			const current = cubicPoint(
				controls.p0,
				controls.p1,
				controls.p2,
				controls.p3,
				currentT,
			);
			const projection = projectPointToLineSegment(point, previous, current);
			const t = lerp(previousT, currentT, projection.t);
			if (
				t > BLEND_SPINE_SEGMENT_MIN_T &&
				t < 1 - BLEND_SPINE_SEGMENT_MIN_T &&
				projection.distance <= tolerance &&
				(!best || projection.distance < best.distance)
			) {
				best = {
					segment,
					t,
					point: projection.point,
					distance: projection.distance,
				};
			}
			previous = current;
			previousT = currentT;
		}
	}
	return best ? { segment: best.segment, t: best.t, point: best.point } : null;
}

const lineSpineAsOpenPath = (spine: BlendSpine): BlendSpine | null =>
	spine.kind === "line"
		? {
				kind: "path",
				shape: {
					type: "Shape",
					closed: false,
					vertices: [
						[spine.start.x, spine.start.y] as AePoint,
						[spine.end.x, spine.end.y] as AePoint,
					],
					inTangents: [[0, 0] as AePoint, [0, 0] as AePoint],
					outTangents: [[0, 0] as AePoint, [0, 0] as AePoint],
				},
			}
		: null;

/**
 * Projects an artboard-space point onto a straight Blend spine body. Endpoint
 * handles are hit-tested separately, so this rejects the near-end regions that
 * would create unstable insertions or oversized segment bends.
 */
export function projectLineBlendSpineSegment(
	spine: BlendSpine,
	point: Vec2,
	tolerance: number,
): BlendSpineSegmentProjection | null {
	if (
		spine.kind !== "line" ||
		!isFiniteVec2(point) ||
		!Number.isFinite(tolerance) ||
		tolerance < 0
	) {
		return null;
	}
	const projection = projectPointToLineSegment(point, spine.start, spine.end);
	if (
		projection.t <= BLEND_SPINE_SEGMENT_MIN_T ||
		projection.t >= 1 - BLEND_SPINE_SEGMENT_MIN_T ||
		projection.distance > tolerance
	) {
		return null;
	}
	return { segment: 0, t: projection.t, point: projection.point };
}

/**
 * Splits one authored path Blend spine segment using De Casteljau
 * subdivision. The inserted anchor preserves the existing curve exactly and
 * becomes an ordinary editable spine anchor.
 */
export function insertOpenBlendSpineAnchor(
	spine: BlendSpine,
	segment: number,
	t: number,
): BlendSpineAnchorInsertion | null {
	if (spine.kind !== "path" || !Number.isFinite(t)) return null;
	const controls = pathSpineSegmentControls(spine.shape, segment);
	if (!controls) return null;
	const splitT = clamp(t, 0, 1);
	if (
		splitT <= BLEND_SPINE_SEGMENT_MIN_T ||
		splitT >= 1 - BLEND_SPINE_SEGMENT_MIN_T
	) {
		return null;
	}
	const a = lerpVec2(controls.p0, controls.p1, splitT);
	const b = lerpVec2(controls.p1, controls.p2, splitT);
	const c = lerpVec2(controls.p2, controls.p3, splitT);
	const d = lerpVec2(a, b, splitT);
	const e = lerpVec2(b, c, splitT);
	const midpoint = lerpVec2(d, e, splitT);
	if (
		pointDistance(midpoint, controls.p0) <= BLEND_SPINE_INSERT_MIN_DISTANCE ||
		pointDistance(midpoint, controls.p3) <= BLEND_SPINE_INSERT_MIN_DISTANCE
	) {
		return null;
	}
	const anchorIndex = segment + 1;
	const nextShape: AeShape = {
		type: "Shape",
		closed: spine.shape.closed,
		vertices: spine.shape.vertices.map(
			(point) => [point[0], point[1]] as AePoint,
		),
		inTangents: spine.shape.inTangents.map(
			(point) => [point[0], point[1]] as AePoint,
		),
		outTangents: spine.shape.outTangents.map(
			(point) => [point[0], point[1]] as AePoint,
		),
	};
	nextShape.outTangents[segment] = [a.x - controls.p0.x, a.y - controls.p0.y];
	nextShape.inTangents[controls.next] = [
		c.x - controls.p3.x,
		c.y - controls.p3.y,
	];
	nextShape.vertices.splice(anchorIndex, 0, [midpoint.x, midpoint.y]);
	nextShape.inTangents.splice(anchorIndex, 0, [
		d.x - midpoint.x,
		d.y - midpoint.y,
	]);
	nextShape.outTangents.splice(anchorIndex, 0, [
		e.x - midpoint.x,
		e.y - midpoint.y,
	]);
	const next: BlendSpine = { kind: "path", shape: nextShape };
	return canUseCustomBlendSpine(next) ? { spine: next, anchorIndex } : null;
}

/**
 * Promotes a straight Blend spine into an explicit open-path spine and inserts a
 * new editable anchor at `t`, preserving the straight visual result.
 */
export function insertLineBlendSpineAnchor(
	spine: BlendSpine,
	t: number,
): BlendSpineAnchorInsertion | null {
	const pathSpine = lineSpineAsOpenPath(spine);
	return pathSpine ? insertOpenBlendSpineAnchor(pathSpine, 0, t) : null;
}

/**
 * Bends one path Blend spine segment by moving the adjacent cubic handles
 * while the endpoint anchors stay fixed. The `delta` is in the same artboard
 * coordinate space as the stored spine.
 */
export function moveOpenBlendSpineSegment(
	spine: BlendSpine,
	segment: number,
	t: number,
	delta: Vec2,
): BlendSpine | null {
	if (spine.kind !== "path" || !isFiniteVec2(delta)) return null;
	const controls = pathSpineSegmentControls(spine.shape, segment);
	if (!controls || !Number.isFinite(t)) return null;
	const splitT = clamp(t, 0, 1);
	if (
		splitT <= BLEND_SPINE_SEGMENT_MIN_T ||
		splitT >= 1 - BLEND_SPINE_SEGMENT_MIN_T
	) {
		return null;
	}
	const weight = 3 * splitT * (1 - splitT);
	if (weight < BLEND_SPINE_SEGMENT_DRAG_MIN_WEIGHT) return null;
	const handleDelta: Vec2 = {
		x: delta.x / weight,
		y: delta.y / weight,
	};
	if (!isFiniteVec2(handleDelta)) return null;
	const nextShape: AeShape = {
		type: "Shape",
		closed: spine.shape.closed,
		vertices: spine.shape.vertices.map(
			(point) => [point[0], point[1]] as AePoint,
		),
		inTangents: spine.shape.inTangents.map(
			(point) => [point[0], point[1]] as AePoint,
		),
		outTangents: spine.shape.outTangents.map(
			(point) => [point[0], point[1]] as AePoint,
		),
	};
	const out = nextShape.outTangents[segment];
	const incoming = nextShape.inTangents[controls.next];
	if (!out || !incoming) return null;
	nextShape.outTangents[segment] = [
		out[0] + handleDelta.x,
		out[1] + handleDelta.y,
	];
	nextShape.inTangents[controls.next] = [
		incoming[0] + handleDelta.x,
		incoming[1] + handleDelta.y,
	];
	const next: BlendSpine = { kind: "path", shape: nextShape };
	return canUseCustomBlendSpine(next) ? next : null;
}

/**
 * Promotes a straight Blend spine into an explicit two-anchor open path and
 * bends its single segment by moving the adjacent cubic handles.
 */
export function moveLineBlendSpineSegment(
	spine: BlendSpine,
	t: number,
	delta: Vec2,
): BlendSpine | null {
	const pathSpine = lineSpineAsOpenPath(spine);
	return pathSpine ? moveOpenBlendSpineSegment(pathSpine, 0, t, delta) : null;
}

const sampleShapeForBlend = (
	shape: AeShape,
	closed: boolean,
	anchorHint?: BlendContourAnchorHint | null,
): AeShape | null => {
	if (!canSampleShape(shape)) return null;
	const count = BLEND_SAMPLE_VERTEX_COUNT;
	const divisor = shape.closed && closed ? count : count - 1;
	const vertices = Array.from({ length: count }, (_, index): AePoint => {
		const percent = divisor > 0 ? index / divisor : 0;
		const sample = sampleAeShapePath(shape, percent, {
			stepsPerSegment: BLEND_SAMPLE_STEPS_PER_SEGMENT,
		});
		return [sample.point[0], sample.point[1]];
	});
	return orientSampledShapeToAnchor(
		{
			type: "Shape",
			closed,
			vertices,
			inTangents: vertices.map(() => zeroAePoint()),
			outTangents: vertices.map(() => zeroAePoint()),
		},
		anchorHint ?? null,
	);
};

const sampledVerticesCentroid = (vertices: readonly AePoint[]): Vec2 => {
	let x = 0;
	let y = 0;
	for (const [vx, vy] of vertices) {
		x += vx;
		y += vy;
	}
	const count = Math.max(1, vertices.length);
	return { x: x / count, y: y / count };
};

const sampledVerticesSignedArea = (vertices: readonly AePoint[]): number => {
	let area = 0;
	for (let index = 0; index < vertices.length; index += 1) {
		const [x1, y1] = vertices[index] ?? [0, 0];
		const [x2, y2] = vertices[(index + 1) % vertices.length] ?? [0, 0];
		area += x1 * y2 - x2 * y1;
	}
	return area / 2;
};

/** Reverses ring direction while keeping the vertex at index 0 as the seam. */
const reverseSampledRing = (vertices: readonly AePoint[]): AePoint[] =>
	vertices.map((_, index) => {
		const [x, y] = vertices[(vertices.length - index) % vertices.length] ?? [
			0, 0,
		];
		return [x, y] as AePoint;
	});

/**
 * Re-anchors a sampled closed ring so vertex correspondence with `reference`
 * minimizes travel. Winding is matched first via signed area, then the seam
 * offset with the highest centroid-relative correlation wins; translation and
 * scale cancel out of that argmax, so no further normalization is needed. The
 * sampled seam is a sampler artifact, not authored data, so re-anchoring never
 * discards user intent — it only stops mismatched closed shapes (star to
 * circle, rotated rects) from visibly twisting through the generated steps.
 */
const alignSampledClosedRing = (reference: AeShape, ring: AeShape): AeShape => {
	const count = ring.vertices.length;
	if (count < 3 || reference.vertices.length !== count) return ring;
	const sameWinding =
		sampledVerticesSignedArea(reference.vertices) *
			sampledVerticesSignedArea(ring.vertices) >=
		0;
	const oriented = sameWinding
		? ring.vertices
		: reverseSampledRing(ring.vertices);
	const referenceCentroid = sampledVerticesCentroid(reference.vertices);
	const ringCentroid = sampledVerticesCentroid(oriented);
	let bestOffset = 0;
	let bestScore = Number.NEGATIVE_INFINITY;
	for (let offset = 0; offset < count; offset += 1) {
		let score = 0;
		for (let index = 0; index < count; index += 1) {
			const [rx, ry] = reference.vertices[index] ?? [0, 0];
			const [ox, oy] = oriented[(index + offset) % count] ?? [0, 0];
			score +=
				(rx - referenceCentroid.x) * (ox - ringCentroid.x) +
				(ry - referenceCentroid.y) * (oy - ringCentroid.y);
		}
		if (score > bestScore) {
			bestScore = score;
			bestOffset = offset;
		}
	}
	if (bestOffset === 0 && sameWinding) return ring;
	const vertices = oriented.map((_, index) => {
		const [x, y] = oriented[(index + bestOffset) % count] ?? [0, 0];
		return [x, y] as AePoint;
	});
	return {
		type: "Shape",
		closed: ring.closed,
		vertices,
		inTangents: vertices.map(() => zeroAePoint()),
		outTangents: vertices.map(() => zeroAePoint()),
	};
};

const geometrySubpathsForBlend = (
	geometry: NodeGeometry,
): readonly AeShape[] =>
	geometry.kind === "path" ? (geometry.subpaths ?? []) : [];

type BlendGeometryStop = Pick<
	ResolvedBlendSourceStop,
	"anchorRef" | "explicitLocalPoint"
>;

type BlendContourDescriptor =
	| { readonly kind: "main"; readonly shape: AeShape }
	| {
			readonly kind: "subpath";
			readonly subpathIndex: number;
			readonly shape: AeShape;
	  };

type BlendContourAnchorHint = {
	readonly point: Vec2;
	readonly index: number;
	readonly isEndpoint: boolean;
};

const blendContourDescriptors = (
	geometry: NodeGeometry,
): readonly BlendContourDescriptor[] => {
	const shape = geometryShapeForBlend(geometry);
	if (!shape) return [];
	return [
		{ kind: "main", shape },
		...geometrySubpathsForBlend(geometry).map((subpath, subpathIndex) => ({
			kind: "subpath" as const,
			subpathIndex,
			shape: subpath,
		})),
	];
};

const anchorRefMatchesContour = (
	anchorRef: BlendSourceAnchorRef,
	contour: BlendContourDescriptor,
): boolean =>
	anchorRef.kind === "main"
		? contour.kind === "main"
		: contour.kind === "subpath" &&
			anchorRef.subpathIndex === contour.subpathIndex;

const closestContourVertex = (
	shape: AeShape,
	point: Vec2,
): {
	readonly index: number;
	readonly point: Vec2;
	readonly distance: number;
} => {
	let best = {
		index: 0,
		point: { x: 0, y: 0 },
		distance: Number.POSITIVE_INFINITY,
	};
	for (let index = 0; index < shape.vertices.length; index += 1) {
		const vertex = pointFromAe(shape.vertices[index]);
		const distance = pointDistance(point, vertex);
		if (distance < best.distance) best = { index, point: vertex, distance };
	}
	return best;
};

const endpointForAnchor = (
	shape: AeShape,
	index: number,
): "start" | "end" | null => {
	if (shape.closed) return null;
	if (index === 0) return "start";
	return index === shape.vertices.length - 1 ? "end" : null;
};

const contourAnchorHint = (
	stop: BlendGeometryStop | undefined,
	contour: BlendContourDescriptor,
): BlendContourAnchorHint | null => {
	const anchorRef = cleanBlendSourceAnchorRef(stop?.anchorRef);
	if (anchorRef && anchorRefMatchesContour(anchorRef, contour)) {
		const point = contour.shape.vertices[anchorRef.index];
		const localPoint = point ? pointFromAe(point) : undefined;
		return localPoint && isFiniteVec2(localPoint)
			? {
					point: localPoint,
					index: anchorRef.index,
					isEndpoint:
						endpointForAnchor(contour.shape, anchorRef.index) !== null,
				}
			: null;
	}
	const explicitLocalPoint = cleanVec2(stop?.explicitLocalPoint);
	if (!explicitLocalPoint) return null;
	const closest = closestContourVertex(contour.shape, explicitLocalPoint);
	if (closest.distance > BLEND_SOURCE_ANCHOR_MATCH_EPSILON) return null;
	return {
		point: closest.point,
		index: closest.index,
		isEndpoint: endpointForAnchor(contour.shape, closest.index) !== null,
	};
};

const hasContourAnchorHint = (
	geometry: NodeGeometry,
	stop: BlendGeometryStop | undefined,
): boolean =>
	blendContourDescriptors(geometry).some((contour) =>
		Boolean(contourAnchorHint(stop, contour)),
	);

const rotateShapeStart = (shape: AeShape, startIndex: number): AeShape => {
	const count = shape.vertices.length;
	if (count <= 1 || startIndex <= 0 || startIndex >= count) return shape;
	const rotate = (points: readonly AePoint[]): AePoint[] =>
		points.map(
			(_, index) =>
				[...(points[(index + startIndex) % count] ?? [0, 0])] as AePoint,
		);
	return {
		type: "Shape",
		closed: shape.closed,
		vertices: rotate(shape.vertices),
		inTangents: rotate(shape.inTangents),
		outTangents: rotate(shape.outTangents),
	};
};

const reverseSampledShape = (shape: AeShape): AeShape => {
	const vertices = shape.closed
		? reverseSampledRing(shape.vertices)
		: shape.vertices.toReversed().map((point) => [...point] as AePoint);
	return {
		type: "Shape",
		closed: shape.closed,
		vertices,
		inTangents: vertices.map(() => zeroAePoint()),
		outTangents: vertices.map(() => zeroAePoint()),
	};
};

const matchClosedRingWinding = (reference: AeShape, ring: AeShape): AeShape => {
	const sameWinding =
		sampledVerticesSignedArea(reference.vertices) *
			sampledVerticesSignedArea(ring.vertices) >=
		0;
	return sameWinding ? ring : reverseSampledShape(ring);
};

const orientSampledShapeToAnchor = (
	sampled: AeShape,
	hint: BlendContourAnchorHint | null,
): AeShape => {
	if (!hint) return sampled;
	if (sampled.closed) {
		return rotateShapeStart(
			sampled,
			closestContourVertex(sampled, hint.point).index,
		);
	}
	if (!hint.isEndpoint || sampled.vertices.length < 2) return sampled;
	const first = pointFromAe(sampled.vertices[0]);
	const last = pointFromAe(sampled.vertices[sampled.vertices.length - 1]);
	return pointDistance(hint.point, last) < pointDistance(hint.point, first)
		? reverseSampledShape(sampled)
		: sampled;
};

const sampledVerticesBounds = (vertices: readonly AePoint[]): Bounds => {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const [x, y] of vertices) {
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, x);
		maxY = Math.max(maxY, y);
	}
	return vertices.length > 0
		? { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
		: { x: 0, y: 0, width: 0, height: 0 };
};

const normalizedRingCentroid = (ring: AeShape, bounds: Bounds): Vec2 => {
	const centroid = sampledVerticesCentroid(ring.vertices);
	return {
		x: bounds.width > 0 ? (centroid.x - bounds.x) / bounds.width : 0.5,
		y: bounds.height > 0 ? (centroid.y - bounds.y) / bounds.height : 0.5,
	};
};

const denormalizePoint = (normalized: Vec2, bounds: Bounds): Vec2 => ({
	x: bounds.x + normalized.x * bounds.width,
	y: bounds.y + normalized.y * bounds.height,
});

/** A zero-area ring every hole vertex lerps toward when it has no partner. */
const constantSampledRing = (point: Vec2): AeShape => {
	const vertices = Array.from(
		{ length: BLEND_SAMPLE_VERTEX_COUNT },
		(): AePoint => [point.x, point.y],
	);
	return {
		type: "Shape",
		closed: true,
		vertices,
		inTangents: vertices.map(() => zeroAePoint()),
		outTangents: vertices.map(() => zeroAePoint()),
	};
};

type SampledContourPair = { readonly from: AeShape; readonly to: AeShape };

/**
 * Samples a blend pair into matched contour rings. The outer contours pair
 * directly (with seam/winding alignment); compound-path holes pair greedily by
 * their centroid position normalized to each side's outer bounds, so the
 * spatially matching cutouts morph into each other. A hole with no partner
 * lerps against a zero-area ring projected to the proportional position in the
 * other endpoint's bounds — the cutout closes (or opens) in place instead of
 * snapping away.
 */
const sampledBlendGeometry = (
	from: NodeGeometry,
	to: NodeGeometry,
	fromStop?: BlendGeometryStop,
	toStop?: BlendGeometryStop,
): {
	readonly main: SampledContourPair;
	readonly holes: readonly SampledContourPair[];
} | null => {
	const fromShape = geometryShapeForBlend(from);
	const toShape = geometryShapeForBlend(to);
	if (!fromShape || !toShape) return null;
	const fromMain: BlendContourDescriptor = { kind: "main", shape: fromShape };
	const toMain: BlendContourDescriptor = { kind: "main", shape: toShape };
	const fromMainHint = contourAnchorHint(fromStop, fromMain);
	const toMainHint = contourAnchorHint(toStop, toMain);
	const closed = fromShape.closed || toShape.closed;
	const sampledFrom = sampleShapeForBlend(fromShape, closed, fromMainHint);
	const sampledTo = sampleShapeForBlend(toShape, closed, toMainHint);
	if (!sampledFrom || !sampledTo) return null;
	const hasFromMainHint = Boolean(fromMainHint);
	const hasToMainHint = Boolean(toMainHint);
	const main: SampledContourPair =
		closed && hasFromMainHint && hasToMainHint
			? {
					from: sampledFrom,
					to: matchClosedRingWinding(sampledFrom, sampledTo),
				}
			: closed && hasFromMainHint
				? {
						from: sampledFrom,
						to: alignSampledClosedRing(sampledFrom, sampledTo),
					}
				: closed && hasToMainHint
					? {
							from: alignSampledClosedRing(sampledTo, sampledFrom),
							to: sampledTo,
						}
					: toShape.closed
						? {
								from: sampledFrom,
								to: alignSampledClosedRing(sampledFrom, sampledTo),
							}
						: fromShape.closed
							? {
									from: alignSampledClosedRing(sampledTo, sampledFrom),
									to: sampledTo,
								}
							: { from: sampledFrom, to: sampledTo };
	const fromHoles = geometrySubpathsForBlend(from);
	const toHoles = geometrySubpathsForBlend(to);
	if (fromHoles.length === 0 && toHoles.length === 0) {
		return { main, holes: [] };
	}
	const sampledFromHoles: {
		readonly ring: AeShape;
		readonly hint: BlendContourAnchorHint | null;
	}[] = [];
	for (let index = 0; index < fromHoles.length; index += 1) {
		const hole = fromHoles[index];
		if (!hole) continue;
		const hint = contourAnchorHint(fromStop, {
			kind: "subpath",
			subpathIndex: index,
			shape: hole,
		});
		const sampled = sampleShapeForBlend(hole, true, hint);
		if (!sampled) return null;
		sampledFromHoles.push({ ring: sampled, hint });
	}
	const sampledToHoles: {
		readonly ring: AeShape;
		readonly hint: BlendContourAnchorHint | null;
	}[] = [];
	for (let index = 0; index < toHoles.length; index += 1) {
		const hole = toHoles[index];
		if (!hole) continue;
		const hint = contourAnchorHint(toStop, {
			kind: "subpath",
			subpathIndex: index,
			shape: hole,
		});
		const sampled = sampleShapeForBlend(hole, true, hint);
		if (!sampled) return null;
		sampledToHoles.push({ ring: sampled, hint });
	}
	const fromBounds = sampledVerticesBounds(sampledFrom.vertices);
	const toBounds = sampledVerticesBounds(sampledTo.vertices);
	const holes: SampledContourPair[] = [];
	const remaining = sampledToHoles.map((entry) => ({
		...entry,
		centroid: normalizedRingCentroid(entry.ring, toBounds),
	}));
	for (const hole of sampledFromHoles) {
		const centroid = normalizedRingCentroid(hole.ring, fromBounds);
		if (remaining.length === 0) {
			holes.push({
				from: hole.ring,
				to: constantSampledRing(denormalizePoint(centroid, toBounds)),
			});
			continue;
		}
		let bestIndex = hole.hint
			? remaining.findIndex((candidate) => Boolean(candidate.hint))
			: -1;
		if (bestIndex < 0) {
			let bestDistance = Number.POSITIVE_INFINITY;
			bestIndex = 0;
			for (let index = 0; index < remaining.length; index += 1) {
				const candidate = remaining[index];
				if (!candidate) continue;
				const distance = pointDistance(centroid, candidate.centroid);
				if (distance < bestDistance) {
					bestDistance = distance;
					bestIndex = index;
				}
			}
		}
		const [partner] = remaining.splice(bestIndex, 1);
		if (!partner) continue;
		holes.push({
			from: hole.ring,
			to:
				hole.hint && partner.hint
					? matchClosedRingWinding(hole.ring, partner.ring)
					: alignSampledClosedRing(hole.ring, partner.ring),
		});
	}
	for (const leftover of remaining) {
		holes.push({
			from: constantSampledRing(
				denormalizePoint(leftover.centroid, fromBounds),
			),
			to: leftover.ring,
		});
	}
	return { main, holes };
};

const defaultBlendSpine = (
	from: VectorNode,
	to: VectorNode,
	sourceStops?: readonly BlendSourceStop[],
): BlendSpine => ({
	kind: "line",
	start: blendSourceStopParentPoint(
		from,
		cleanBlendSourceStop(from.id, sourceStops),
	),
	end: blendSourceStopParentPoint(to, cleanBlendSourceStop(to.id, sourceStops)),
});

const defaultBlendSpineForSources = (
	sources: readonly VectorNode[],
	sourceStops?: readonly BlendSourceStop[],
): BlendSpine => {
	const first = sources[0];
	const last = sources[sources.length - 1];
	if (!first || !last) {
		return {
			kind: "line",
			start: { x: 0, y: 0 },
			end: { x: 0, y: 0 },
		};
	}
	if (sources.length <= 2) return defaultBlendSpine(first, last, sourceStops);
	const stops = resolveBlendSourceStops(sources, sourceStops);
	const vertices = stops.map((stop) => {
		return [stop.parentPoint.x, stop.parentPoint.y] as AePoint;
	});
	const shape: AeShape = {
		type: "Shape",
		closed: false,
		vertices,
		inTangents: vertices.map(() => zeroAePoint()),
		outTangents: vertices.map(() => zeroAePoint()),
	};
	return shapeHasSpineLength(shape)
		? { kind: "path", shape }
		: defaultBlendSpine(first, last, sourceStops);
};

/**
 * Resolves the spine used to materialize a Blend. An omitted contract spine means
 * the relationship is still using the live straight line between endpoint
 * children; an explicit spine is an authored custom object.
 */
export function effectiveBlendSpine(
	from: VectorNode,
	to: VectorNode,
	spine?: BlendSpine,
): BlendSpine {
	return effectiveBlendSpineForSources([from, to], spine);
}

/**
 * Resolves the materialization spine for ordered Blend stops. Multi-stop blends
 * without an authored spine use a live open path through every source
 * registration point, so generated steps naturally follow the authored stop
 * sequence.
 */
export function effectiveBlendSpineForSources(
	sources: readonly VectorNode[],
	spine?: BlendSpine,
	sourceStops?: readonly BlendSourceStop[],
): BlendSpine {
	return spine && canUseCustomBlendSpine(spine)
		? spine
		: defaultBlendSpineForSources(sources, sourceStops);
}

type BlendSpineSample = {
	readonly point: Vec2;
	readonly angleDegrees: number;
};

export function sampleBlendSpine(
	spine: BlendSpine,
	t: number,
): BlendSpineSample {
	const percent = clamp(t, 0, 1);
	if (spine.kind === "line") {
		return {
			point: lerpVec2(spine.start, spine.end, percent),
			angleDegrees: angleBetween(spine.start, spine.end),
		};
	}
	const sample = sampleAeShapePath(spine.shape, percent, {
		stepsPerSegment: BLEND_SAMPLE_STEPS_PER_SEGMENT,
	});
	return {
		point: { x: sample.point[0], y: sample.point[1] },
		angleDegrees: sample.angleDegrees,
	};
}

const BLEND_SPINE_PROJECTION_SAMPLES = 128;

/** Nearest sampled position (0..1) on a Blend spine to a parent-space point. */
export function projectPointToBlendSpineT(
	spine: BlendSpine,
	point: Vec2,
): number {
	if (!isFiniteVec2(point)) return 1;
	let bestT = 1;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (let step = 0; step <= BLEND_SPINE_PROJECTION_SAMPLES; step += 1) {
		const t = step / BLEND_SPINE_PROJECTION_SAMPLES;
		const distance = pointDistance(sampleBlendSpine(spine, t).point, point);
		if (distance < bestDistance) {
			bestDistance = distance;
			bestT = t;
		}
	}
	return bestT;
}

/**
 * Chooses where a new source stop should join an ordered Blend based on where
 * its registration point projects onto the effective spine. End projections
 * prepend/append; interior projections insert between the stops whose
 * generated segment owns that span, so clicking an object that sits between
 * two stops makes it the stop between them instead of the last one.
 */
export function blendSourceInsertionIndex(
	sources: readonly VectorNode[],
	spine: BlendSpine | undefined,
	sourceStops: readonly BlendSourceStop[] | undefined,
	point: Vec2,
): number {
	if (sources.length < 2) return sources.length;
	const resolved = effectiveBlendSpineForSources(sources, spine, sourceStops);
	const t = projectPointToBlendSpineT(resolved, point);
	if (t <= 0) return 0;
	if (t >= 1) return sources.length;
	const segmentCount = sources.length - 1;
	return Math.min(segmentCount - 1, Math.floor(t * segmentCount)) + 1;
}

export function reverseBlendSpine(spine: BlendSpine): BlendSpine {
	if (spine.kind === "line") {
		return { kind: "line", start: spine.end, end: spine.start };
	}
	const sourceIndexes = spine.shape.closed
		? [
				0,
				...Array.from(
					{ length: Math.max(0, spine.shape.vertices.length - 1) },
					(_, index) => spine.shape.vertices.length - 1 - index,
				),
			]
		: Array.from(
				{ length: spine.shape.vertices.length },
				(_, index) => spine.shape.vertices.length - 1 - index,
			);
	return {
		kind: "path",
		shape: {
			type: "Shape",
			closed: spine.shape.closed,
			vertices: sourceIndexes.map((index) => {
				const [x, y] = spine.shape.vertices[index] ?? zeroAePoint();
				return [x, y] as AePoint;
			}),
			inTangents: sourceIndexes.map((index) => {
				const [x, y] = spine.shape.outTangents[index] ?? [0, 0];
				return [-x, -y] as AePoint;
			}),
			outTangents: sourceIndexes.map((index) => {
				const [x, y] = spine.shape.inTangents[index] ?? [0, 0];
				return [-x, -y] as AePoint;
			}),
		},
	};
}

/**
 * Converts a simple vector node into a parent-space Blend spine. Replace-spine
 * commands store this snapshot so Blend generation does not depend on an
 * unrelated path node staying alive elsewhere in the scene tree.
 */
export function blendSpineFromNode(node: VectorNode): BlendSpine | null {
	const matrix = matrixFromTransform(node.transform);
	if (node.geometry.kind === "line") {
		return {
			kind: "line",
			start: applyMatrixToPoint(matrix, node.geometry.start),
			end: applyMatrixToPoint(matrix, node.geometry.end),
		};
	}
	const shape = geometryShapeForBlend(node.geometry);
	if (!shape) return null;
	return {
		kind: "path",
		shape: transformShape(shape, matrix),
	};
}

/**
 * Returns the vector geometry that can safely replace an Illustrator-style Blend
 * spine. Closed paths and shapes distribute generated steps around the contour;
 * command code avoids endpoint alignment for those spines because their start
 * and end samples coincide.
 */
export function replaceableBlendSpineFromNode(
	node: VectorNode,
): BlendSpine | null {
	const spine = blendSpineFromNode(node);
	if (!spine) return null;
	return canUseCustomBlendSpine(spine) ? spine : null;
}

/**
 * Moves a node so its Blend registration point lands at `point` in parent
 * coordinates. When no stop point is present this falls back to the node's local
 * center, preserving legacy center-registered Blend behavior.
 */
export function moveNodeBlendSourceStopToPoint(
	node: VectorNode,
	sourceStop: BlendSourceStop | undefined,
	point: Vec2,
): VectorNode {
	const current = blendSourceStopParentPoint(node, sourceStop);
	return {
		...node,
		transform: {
			...node.transform,
			position: {
				x: node.transform.position.x + point.x - current.x,
				y: node.transform.position.y + point.y - current.y,
			},
		},
	};
}

const transformOnBlendSpine = (
	transform: Transform,
	fromStop: ResolvedBlendSourceStop,
	toStop: ResolvedBlendSourceStop,
	spine: BlendSpine,
	orientation: BlendOrientation,
	segmentT: number,
	t: number,
): Transform => {
	const sample = sampleBlendSpine(spine, t);
	const axisAngle = angleBetween(fromStop.parentPoint, toStop.parentPoint);
	const oriented =
		orientation === "spine"
			? {
					...transform,
					rotation:
						transform.rotation + angleDelta(axisAngle, sample.angleDegrees),
				}
			: transform;
	const attachment = applyMatrixToPoint(
		matrixFromTransform(oriented),
		lerpVec2(fromStop.localPoint, toStop.localPoint, segmentT),
	);
	return {
		...oriented,
		position: {
			x: oriented.position.x + sample.point.x - attachment.x,
			y: oriented.position.y + sample.point.y - attachment.y,
		},
	};
};

const sampledBlendFillRule = (
	from: NodeGeometry,
	to: NodeGeometry,
): FillRule | undefined => {
	if (from.kind === "path" && from.fillRule) return from.fillRule;
	if (to.kind === "path" && to.fillRule) return to.fillRule;
	return undefined;
};

const interpolateSampledGeometry = (
	from: NodeGeometry,
	to: NodeGeometry,
	t: number,
	fromStop?: BlendGeometryStop,
	toStop?: BlendGeometryStop,
): NodeGeometry | null => {
	const sampled = sampledBlendGeometry(from, to, fromStop, toStop);
	if (!sampled) return null;
	const shape = interpolateShape(sampled.main.from, sampled.main.to, t);
	if (sampled.holes.length === 0) {
		const fillRule = sampledBlendFillRule(from, to);
		return { kind: "path", shape, ...(fillRule ? { fillRule } : {}) };
	}
	// Seam/winding alignment may reverse a contour's vertex order for
	// correspondence, so direction-sensitive nonzero cannot be trusted on
	// generated steps; evenodd keeps every matched cutout a hole.
	return {
		kind: "path",
		shape,
		subpaths: sampled.holes.map((pair) =>
			interpolateShape(pair.from, pair.to, t),
		),
		fillRule: "evenodd",
	};
};

const interpolateGeometry = (
	from: NodeGeometry,
	to: NodeGeometry,
	t: number,
	fromStop?: BlendGeometryStop,
	toStop?: BlendGeometryStop,
): NodeGeometry => {
	const anchoredGeometry =
		hasContourAnchorHint(from, fromStop) || hasContourAnchorHint(to, toStop)
			? interpolateSampledGeometry(from, to, t, fromStop, toStop)
			: null;
	if (anchoredGeometry) return anchoredGeometry;
	if (from.kind !== to.kind) {
		return (
			interpolateSampledGeometry(from, to, t, fromStop, toStop) ??
			clone(t >= 1 ? to : from)
		);
	}
	switch (from.kind) {
		case "rect": {
			const target = to.kind === "rect" ? to : from;
			return {
				...from,
				bounds: lerpBounds(from.bounds, target.bounds, t),
				cornerRadius: lerp(from.cornerRadius, target.cornerRadius, t),
				...(from.cornerRadii || target.cornerRadii
					? {
							cornerRadii: {
								tl: lerp(
									from.cornerRadii?.tl ?? from.cornerRadius,
									target.cornerRadii?.tl ?? target.cornerRadius,
									t,
								),
								tr: lerp(
									from.cornerRadii?.tr ?? from.cornerRadius,
									target.cornerRadii?.tr ?? target.cornerRadius,
									t,
								),
								br: lerp(
									from.cornerRadii?.br ?? from.cornerRadius,
									target.cornerRadii?.br ?? target.cornerRadius,
									t,
								),
								bl: lerp(
									from.cornerRadii?.bl ?? from.cornerRadius,
									target.cornerRadii?.bl ?? target.cornerRadius,
									t,
								),
							},
						}
					: {}),
				...(from.cornerSmoothing !== undefined ||
				target.cornerSmoothing !== undefined
					? {
							cornerSmoothing: lerp(
								from.cornerSmoothing ?? 0,
								target.cornerSmoothing ?? 0,
								t,
							),
						}
					: {}),
			};
		}
		case "ellipse": {
			const target = to.kind === "ellipse" ? to : from;
			return { ...from, bounds: lerpBounds(from.bounds, target.bounds, t) };
		}
		case "line": {
			const target = to.kind === "line" ? to : from;
			return {
				...from,
				start: lerpVec2(from.start, target.start, t),
				end: lerpVec2(from.end, target.end, t),
			};
		}
		case "polygon": {
			const target = to.kind === "polygon" ? to : from;
			return from.points.length === target.points.length
				? {
						...from,
						points: from.points.map((point, index) =>
							lerpVec2(point, target.points[index], t),
						),
						...(from.cornerRadius !== undefined ||
						target.cornerRadius !== undefined
							? {
									cornerRadius: lerp(
										from.cornerRadius ?? 0,
										target.cornerRadius ?? 0,
										t,
									),
								}
							: {}),
						...(from.cornerSmoothing !== undefined ||
						target.cornerSmoothing !== undefined
							? {
									cornerSmoothing: lerp(
										from.cornerSmoothing ?? 0,
										target.cornerSmoothing ?? 0,
										t,
									),
								}
							: {}),
					}
				: (interpolateSampledGeometry(from, to, t) ??
						clone(t >= 1 ? to : from));
		}
		case "star": {
			const target = to.kind === "star" ? to : from;
			return from.points === target.points
				? {
						...from,
						center: lerpVec2(from.center, target.center, t),
						innerRadius: positiveOr(
							lerp(from.innerRadius, target.innerRadius, t),
							from.innerRadius,
						),
						outerRadius: positiveOr(
							lerp(from.outerRadius, target.outerRadius, t),
							from.outerRadius,
						),
						...(from.cornerRadius !== undefined ||
						target.cornerRadius !== undefined
							? {
									cornerRadius: lerp(
										from.cornerRadius ?? 0,
										target.cornerRadius ?? 0,
										t,
									),
								}
							: {}),
						...(from.cornerSmoothing !== undefined ||
						target.cornerSmoothing !== undefined
							? {
									cornerSmoothing: lerp(
										from.cornerSmoothing ?? 0,
										target.cornerSmoothing ?? 0,
										t,
									),
								}
							: {}),
					}
				: (interpolateSampledGeometry(from, to, t) ??
						clone(t >= 1 ? to : from));
		}
		case "path": {
			const target = to.kind === "path" ? to : from;
			const fromSubpaths = from.subpaths ?? [];
			const targetSubpaths = target.subpaths ?? [];
			const sameTopology =
				haveSameShapeTopology(from.shape, target.shape) &&
				fromSubpaths.length === targetSubpaths.length &&
				fromSubpaths.every((subpath, index) => {
					const targetSubpath = targetSubpaths[index];
					return (
						targetSubpath !== undefined &&
						haveSameShapeTopology(subpath, targetSubpath)
					);
				});
			if (!sameTopology) {
				return (
					interpolateSampledGeometry(from, target, t, fromStop, toStop) ??
					clone(t >= 1 ? target : from)
				);
			}
			return {
				...from,
				shape: interpolateShape(from.shape, target.shape, t),
				...(fromSubpaths.length > 0
					? {
							subpaths: fromSubpaths.map((subpath, index) =>
								interpolateShape(subpath, targetSubpaths[index] ?? subpath, t),
							),
						}
					: {}),
				...(from.fillRule || target.fillRule
					? { fillRule: from.fillRule ?? target.fillRule }
					: {}),
			};
		}
		case "text":
		case "image":
			return clone(t >= 1 ? to : from);
	}
};

type Rgb = {
	readonly r: number;
	readonly g: number;
	readonly b: number;
};

const parseHexColor = (value: string): Rgb | null => {
	const raw = value.trim().replace(/^#/, "");
	const hex =
		raw.length === 3
			? raw
					.split("")
					.map((char) => `${char}${char}`)
					.join("")
			: raw;
	if (!/^[\da-f]{6}$/iu.test(hex)) return null;
	return {
		r: Number.parseInt(hex.slice(0, 2), 16),
		g: Number.parseInt(hex.slice(2, 4), 16),
		b: Number.parseInt(hex.slice(4, 6), 16),
	};
};

const parseRgbColor = (value: string): Rgb | null => {
	const match = /^rgba?\((.+)\)$/iu.exec(value.trim());
	if (!match) return null;
	const channels = match[1]
		.replaceAll(",", " ")
		.split(/\s+/u)
		.filter(Boolean)
		.slice(0, 3)
		.map(Number);
	if (
		channels.length !== 3 ||
		channels.some((channel) => !Number.isFinite(channel))
	) {
		return null;
	}
	return {
		r: clamp(channels[0], 0, 255),
		g: clamp(channels[1], 0, 255),
		b: clamp(channels[2], 0, 255),
	};
};

const parseColor = (value: string): Rgb | null =>
	parseHexColor(value) ?? parseRgbColor(value);

const formatRgb = (color: Rgb): string =>
	`rgb(${Math.round(color.r)} ${Math.round(color.g)} ${Math.round(color.b)})`;

const rgbDistance = (from: Rgb, to: Rgb): number =>
	Math.hypot(to.r - from.r, to.g - from.g, to.b - from.b);

const paintColors = (paint: Paint): readonly Rgb[] => {
	if (paint.visible === false) return [];
	if (paint.kind === "solid") {
		const color = parseColor(paint.color);
		return color ? [color] : [];
	}
	if (isGradientPaint(paint)) {
		return paint.stops
			.map((stop) => parseColor(stop.color))
			.filter((color): color is Rgb => Boolean(color));
	}
	return [];
};

const styleColors = (style: NodeStyle): readonly Rgb[] => {
	const legacyColors = [style.fill, style.stroke]
		.map((color) => parseColor(color))
		.filter((color): color is Rgb => Boolean(color));
	const paintStackColors = [
		...(style.fills ?? []),
		...(style.strokes ?? []),
	].flatMap((paint) => paintColors(paint));
	return [...legacyColors, ...paintStackColors];
};

const styleColorDistance = (from: NodeStyle, to: NodeStyle): number => {
	const a = styleColors(from);
	const b = styleColors(to);
	const opacityDistance = Math.abs(from.opacity - to.opacity) * 255;
	if (a.length === 0 && b.length === 0) return opacityDistance;
	if (a.length === 0 || b.length === 0) return Math.max(opacityDistance, 255);
	const count = Math.max(a.length, b.length);
	let distance = opacityDistance;
	for (let index = 0; index < count; index += 1) {
		distance = Math.max(
			distance,
			rgbDistance(
				a[Math.min(index, a.length - 1)],
				b[Math.min(index, b.length - 1)],
			),
		);
	}
	return distance;
};

function smoothColorStepCount(
	from: VectorNode,
	to: VectorNode,
	maxSteps: number,
	distance: number = sourceDistance(from, to),
): number {
	const boundedMax = Math.round(clamp(maxSteps, 1, MAX_BLEND_STEPS));
	const colorSteps = Math.ceil(styleColorDistance(from.style, to.style) / 8);
	const spatialSteps = Math.ceil(distance / 80);
	const steps = Math.max(1, colorSteps, spatialSteps);
	return Math.round(clamp(steps, 1, boundedMax));
}

const interpolateColor = (from: string, to: string, t: number): string => {
	if (from === to) return from;
	if (from === "none" || to === "none") return t >= 1 ? to : from;
	const a = parseColor(from);
	const b = parseColor(to);
	if (!a || !b) return t >= 1 ? to : from;
	return formatRgb({
		r: lerp(a.r, b.r, t),
		g: lerp(a.g, b.g, t),
		b: lerp(a.b, b.b, t),
	});
};

/**
 * Represents a solid paint as a flat gradient that borrows the counterpart
 * gradient's kind and geometry, so a solid-to-gradient blend interpolates as a
 * gradual ramp fade-in instead of a mid-blend paint snap. The solid's alpha is
 * folded into the stops (no paint-level opacity survives) and the solid's
 * visibility wins, so the promoted paint renders exactly like the solid.
 */
const solidPaintAsGradient = (
	solid: SolidPaint,
	counterpart: GradientPaint,
): GradientPaint => {
	const promoted = clone(counterpart);
	delete (promoted as { opacity?: number }).opacity;
	const stopOpacity = solid.opacity ?? 1;
	return {
		...promoted,
		...(solid.visible !== undefined ? { visible: solid.visible } : {}),
		stops: [
			{ offset: 0, color: solid.color, opacity: stopOpacity },
			{ offset: 1, color: solid.color, opacity: stopOpacity },
		],
	};
};

const interpolatePaint = (from: Paint, to: Paint, t: number): Paint => {
	if (from.kind === "solid" && isGradientPaint(to)) {
		return interpolateGradientForBlend(solidPaintAsGradient(from, to), to, t);
	}
	if (isGradientPaint(from) && to.kind === "solid") {
		return interpolateGradientForBlend(from, solidPaintAsGradient(to, from), t);
	}
	if (from.kind !== to.kind) return clone(t >= 1 ? to : from);
	if (from.kind === "solid" && to.kind === "solid") {
		return {
			...from,
			color: interpolateColor(from.color, to.color, t),
			opacity: lerp(from.opacity ?? 1, to.opacity ?? 1, t),
		};
	}
	if (isGradientPaint(from) && isGradientPaint(to)) {
		return interpolateGradientForBlend(from, to, t);
	}
	return clone(t >= 1 ? to : from);
};

const interpolatePaintList = (
	from: readonly Paint[] | undefined,
	to: readonly Paint[] | undefined,
	t: number,
): readonly Paint[] | undefined => {
	if (!from || !to) return t >= 1 ? to : from;
	if (from.length !== to.length) return clone(t >= 1 ? to : from);
	return from.map((paint, index) => interpolatePaint(paint, to[index], t));
};

const interpolateTransform = (
	from: Transform,
	to: Transform,
	t: number,
): Transform => ({
	position: lerpVec2(from.position, to.position, t),
	rotation: lerpRotation(from.rotation, to.rotation, t),
	scale: lerpVec2(from.scale, to.scale, t),
	anchor: lerpVec2(from.anchor, to.anchor, t),
});

const selectedOptional = <T>(
	from: T | undefined,
	to: T | undefined,
	t: number,
): T | undefined => (t >= 1 ? to : from);

const interpolateStyle = (
	from: NodeStyle,
	to: NodeStyle,
	t: number,
): NodeStyle => {
	const fills = interpolatePaintList(from.fills, to.fills, t);
	const strokes = interpolatePaintList(from.strokes, to.strokes, t);
	const blendMode = selectedOptional(from.blendMode, to.blendMode, t);
	const strokeAlign = selectedOptional(from.strokeAlign, to.strokeAlign, t);
	const strokeCap = selectedOptional(from.strokeCap, to.strokeCap, t);
	const strokeJoin = selectedOptional(from.strokeJoin, to.strokeJoin, t);
	const strokeDash =
		from.strokeDash &&
		to.strokeDash &&
		from.strokeDash.length === to.strokeDash.length
			? from.strokeDash.map((dash, index) =>
					lerp(dash, to.strokeDash?.[index] ?? dash, t),
				)
			: selectedOptional(from.strokeDash, to.strokeDash, t);

	return {
		...from,
		fill: interpolateColor(from.fill, to.fill, t),
		stroke: interpolateColor(from.stroke, to.stroke, t),
		strokeWidth: Math.max(0, lerp(from.strokeWidth, to.strokeWidth, t)),
		opacity: clamp(lerp(from.opacity, to.opacity, t), 0, 1),
		...(fills ? { fills } : {}),
		...(strokes ? { strokes } : {}),
		...(blendMode ? { blendMode } : {}),
		...(strokeAlign ? { strokeAlign } : {}),
		...(strokeDash ? { strokeDash } : {}),
		...(from.strokeDashoffset !== undefined || to.strokeDashoffset !== undefined
			? {
					strokeDashoffset: lerp(
						from.strokeDashoffset ?? 0,
						to.strokeDashoffset ?? 0,
						t,
					),
				}
			: {}),
		...(strokeCap ? { strokeCap } : {}),
		...(strokeJoin ? { strokeJoin } : {}),
		...(from.strokeMiterLimit !== undefined || to.strokeMiterLimit !== undefined
			? {
					strokeMiterLimit: Math.max(
						0,
						lerp(from.strokeMiterLimit ?? 4, to.strokeMiterLimit ?? 4, t),
					),
				}
			: {}),
	};
};

const unsupportedPaint = (paint: Paint): boolean =>
	paint.kind === "mesh-gradient" || paint.kind === "image-reference";

/**
 * Returns the first author-facing reason a node cannot be used as a Blend
 * endpoint in the current implementation slice.
 */
export function blendNodeEligibilityIssue(node: VectorNode): BlendIssue | null {
	if (node.children?.length) {
		return issue(
			"blend.unsupported-source",
			"Blend currently accepts leaf vector nodes only.",
			node.id,
		);
	}
	if (node.frame || node.component || node.blend || node.blendStep) {
		return issue(
			"blend.unsupported-source",
			"Blend source cannot be a frame, component, existing blend, or generated blend step.",
			node.id,
		);
	}
	if (node.recipe || node.recipeRef || node.style.effects?.length) {
		return issue(
			"blend.unsupported-source",
			"Blend currently accepts sources without node effects or vec-core looks.",
			node.id,
		);
	}
	if (node.geometry.kind === "text" || node.geometry.kind === "image") {
		return issue(
			"blend.unsupported-source",
			"Blend currently accepts editable vector geometry, not text or image nodes.",
			node.id,
		);
	}
	if (
		[...(node.style.fills ?? []), ...(node.style.strokes ?? [])].some(
			unsupportedPaint,
		)
	) {
		return issue(
			"blend.unsupported-source",
			"Blend currently accepts solid or compatible gradient paints only.",
			node.id,
		);
	}
	if (
		node.geometry.kind === "path" &&
		(node.geometry.subpaths?.length ?? 0) + 1 > MAX_BLEND_COMPOUND_CONTOURS
	) {
		return issue(
			"blend.unsupported-source",
			`Blend accepts compound paths with up to ${MAX_BLEND_COMPOUND_CONTOURS} contours.`,
			node.id,
		);
	}
	return null;
}

/**
 * Returns the first pair-level incompatibility that would make generated
 * geometry visibly snap instead of interpolate.
 */
export function blendPairEligibilityIssue(
	from: VectorNode,
	to: VectorNode,
): BlendIssue | null {
	return sampledBlendGeometry(from.geometry, to.geometry)
		? null
		: issue(
				"blend.unsupported-source",
				"Blend sources must be convertible to sampled vector paths.",
				to.id,
			);
}

const blendBounds = (children: readonly VectorNode[]): Bounds => {
	const boxes = children.map(getNodeParentBounds);
	return boxes.length > 0
		? unionBounds(boxes)
		: { x: 0, y: 0, width: 0, height: 0 };
};

const clearBlendEndpointMetadata = (node: VectorNode): VectorNode => {
	const next = clone(node);
	delete (next as { blend?: unknown }).blend;
	delete (next as { blendStep?: unknown }).blendStep;
	return next;
};

const generatedBlendStepId = (blendNodeId: string, index: number): string =>
	`${blendNodeId}-step-${index + 1}`;

const createBlendStepNode = (
	blendNodeId: string,
	from: VectorNode,
	to: VectorNode,
	fromStop: ResolvedBlendSourceStop,
	toStop: ResolvedBlendSourceStop,
	index: number,
	segmentIndex: number,
	segmentT: number,
	spineT: number,
	nodeId: string,
	spine: BlendSpine,
	orientation: BlendOrientation,
): VectorNode => {
	const geometry = interpolateGeometry(
		from.geometry,
		to.geometry,
		segmentT,
		fromStop,
		toStop,
	);
	const style = interpolateStyle(from.style, to.style, segmentT);
	const base: VectorNode = {
		...clearBlendEndpointMetadata(from),
		id: nodeId,
		name: `Blend step ${index + 1}`,
		geometry,
		transform: interpolateTransform(from.transform, to.transform, segmentT),
		style,
		locked: true,
		blendStep: {
			kind: "blend-step",
			blendNodeId,
			index,
			segmentIndex,
			segmentT,
			t: spineT,
		},
	};
	return {
		...base,
		transform: transformOnBlendSpine(
			base.transform,
			fromStop,
			toStop,
			spine,
			orientation,
			segmentT,
			spineT,
		),
	};
};

const blendSegmentStepCounts = (
	sources: readonly VectorNode[],
	spacing: BlendSpacing,
	spine: BlendSpine,
	sourceStops?: readonly BlendSourceStop[],
): readonly number[] => {
	const segmentCount = Math.max(0, sources.length - 1);
	const stops = resolveBlendSourceStops(sources, sourceStops);
	const counts: number[] = [];
	let total = 0;
	for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
		const from = sources[segmentIndex];
		const to = sources[segmentIndex + 1];
		const fromStop = stops[segmentIndex];
		const toStop = stops[segmentIndex + 1];
		if (!from || !to || !fromStop || !toStop) {
			counts.push(0);
			continue;
		}
		const startT = segmentIndex / segmentCount;
		const endT = (segmentIndex + 1) / segmentCount;
		const distance =
			blendSpineRangeLength(spine, startT, endT) ??
			pointDistance(fromStop.parentPoint, toStop.parentPoint);
		const remaining = MAX_BLEND_GENERATED_NODE_COUNT - total;
		const count =
			remaining > 0
				? Math.min(
						blendStepCountForDistance(from, to, spacing, distance),
						remaining,
					)
				: 0;
		counts.push(count);
		total += count;
	}
	return counts;
};

/** Returns the authored spine positions where generated Blend steps land. */
export function blendStepSpineTValues(
	sources: readonly VectorNode[],
	spacing: BlendSpacing,
	spine?: BlendSpine,
	sourceStops?: readonly BlendSourceStop[],
): readonly number[] {
	if (sources.length < 2) return [];
	const resolvedSpine = effectiveBlendSpineForSources(
		sources,
		spine,
		sourceStops,
	);
	const segmentCount = sources.length - 1;
	const counts = blendSegmentStepCounts(
		sources,
		spacing,
		resolvedSpine,
		sourceStops,
	);
	const values: number[] = [];
	for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
		const count = counts[segmentIndex] ?? 0;
		const startT = segmentIndex / segmentCount;
		const endT = (segmentIndex + 1) / segmentCount;
		for (let index = 0; index < count; index += 1) {
			values.push(lerp(startT, endT, (index + 1) / (count + 1)));
		}
	}
	return values;
}

const generatedStepNodesForSources = (
	blendNodeId: string,
	sources: readonly VectorNode[],
	spacing: BlendSpacing,
	spine: BlendSpine,
	orientation: BlendOrientation,
	sourceStops?: readonly BlendSourceStop[],
	existingIds: readonly string[] = [],
): {
	readonly steps: readonly VectorNode[];
	readonly segmentStepCounts: readonly number[];
} => {
	const segmentCount = Math.max(0, sources.length - 1);
	const stops = resolveBlendSourceStops(sources, sourceStops);
	const steps: VectorNode[] = [];
	const segmentStepCounts = blendSegmentStepCounts(
		sources,
		spacing,
		spine,
		sourceStops,
	);
	for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
		const from = sources[segmentIndex];
		const to = sources[segmentIndex + 1];
		const fromStop = stops[segmentIndex];
		const toStop = stops[segmentIndex + 1];
		if (!from || !to || !fromStop || !toStop) continue;
		const startT = segmentIndex / segmentCount;
		const endT = (segmentIndex + 1) / segmentCount;
		const count = segmentStepCounts[segmentIndex] ?? 0;
		for (
			let segmentStepIndex = 0;
			segmentStepIndex < count;
			segmentStepIndex += 1
		) {
			const segmentT = (segmentStepIndex + 1) / (count + 1);
			const spineT = lerp(startT, endT, segmentT);
			const index = steps.length;
			steps.push(
				createBlendStepNode(
					blendNodeId,
					from,
					to,
					fromStop,
					toStop,
					index,
					segmentIndex,
					segmentT,
					spineT,
					existingIds[index] ?? generatedBlendStepId(blendNodeId, index),
					spine,
					orientation,
				),
			);
		}
	}
	return { steps, segmentStepCounts };
};

const interleaveBlendChildren = (
	sources: readonly VectorNode[],
	steps: readonly VectorNode[],
	segmentStepCounts: readonly number[],
): readonly VectorNode[] => {
	const children: VectorNode[] = [];
	let stepIndex = 0;
	for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
		const source = sources[sourceIndex];
		if (source) children.push(source);
		const segmentCount = segmentStepCounts[sourceIndex] ?? 0;
		if (segmentCount > 0) {
			children.push(...steps.slice(stepIndex, stepIndex + segmentCount));
			stepIndex += segmentCount;
		}
	}
	return children;
};

/**
 * Creates a normal scene container that records a Blend contract and stores
 * authored source-stop children plus locked generated step children. The
 * generated children are a materialized cache; callers should regenerate them via
 * {@link refreshBlendNode} after endpoint edits.
 */
export function createBlendContainerNode(options: {
	readonly blendNodeId?: string;
	readonly sources: readonly VectorNode[];
	readonly sourceStops?: readonly BlendSourceStop[];
	readonly spacing?: BlendSpacing;
	readonly spine?: BlendSpine;
	readonly orientation?: BlendOrientation;
	readonly stacking?: BlendStackingOrder;
	readonly generatedNodeIds?: readonly string[];
}): VectorNode {
	const blendNodeId = options.blendNodeId ?? createId("blend");
	const spacing = normalizeBlendSpacing(options.spacing);
	if (options.sources.length < 2) {
		throw new Error("Blend requires at least two source nodes.");
	}
	const sources = options.sources.map(clearBlendEndpointMetadata);
	const customSpine =
		options.spine && canUseCustomBlendSpine(options.spine)
			? options.spine
			: undefined;
	const sourceStops = normalizeBlendSourceStops(
		sources.map((source) => source.id),
		options.sourceStops,
	);
	const spine = effectiveBlendSpineForSources(
		sources,
		customSpine,
		sourceStops,
	);
	const orientation = normalizeBlendOrientation(options.orientation);
	const stacking = normalizeBlendStacking(options.stacking);
	const generated = generatedStepNodesForSources(
		blendNodeId,
		sources,
		spacing,
		spine,
		orientation,
		sourceStops,
		options.generatedNodeIds,
	);
	const steps = generated.steps;
	const generatedNodeIds = steps.map((step) => step.id);
	const normalChildren = interleaveBlendChildren(
		sources,
		steps,
		generated.segmentStepCounts,
	);
	const children =
		stacking === "reversed" ? normalChildren.toReversed() : normalChildren;
	const bounds = blendBounds(children);
	const origin = { x: bounds.x, y: bounds.y };
	const artboardId = sources.find((source) => source.artboardId)?.artboardId;

	return {
		id: blendNodeId,
		name: "Blend",
		...(artboardId !== undefined ? { artboardId } : {}),
		geometry: { kind: "line", start: origin, end: origin },
		transform: {
			position: { x: 0, y: 0 },
			rotation: 0,
			scale: { x: 1, y: 1 },
			anchor: { x: 0, y: 0 },
		},
		style: GROUP_WRAPPER_STYLE,
		visible: true,
		locked: false,
		children,
		blend: {
			kind: "blend",
			version: BLEND_VERSION,
			sourceNodeIds: sources.map((source) => source.id),
			...(sourceStops ? { sourceStops } : {}),
			generatedNodeIds,
			spacing,
			...(customSpine ? { spine: customSpine } : {}),
			orientation,
			...(stacking !== "normal" ? { stacking } : {}),
		},
	};
}

/**
 * Rebuilds the generated children for a single Blend container while preserving
 * the container's identity and authored wrapper state.
 */
export function refreshBlendNode(node: VectorNode): VectorNode {
	if (!node.blend || !node.children) return node;
	const sourceIds = node.blend.sourceNodeIds;
	if (sourceIds.length < 2) return node;
	const sources = sourceIds
		.map((sourceId) => node.children?.find((child) => child.id === sourceId))
		.filter((child): child is VectorNode => Boolean(child));
	if (sources.length !== sourceIds.length) return node;
	const refreshed = createBlendContainerNode({
		blendNodeId: node.id,
		sources,
		sourceStops: node.blend.sourceStops,
		spacing: node.blend.spacing,
		spine: node.blend.spine,
		orientation: node.blend.orientation,
		stacking: node.blend.stacking,
		generatedNodeIds: node.blend.generatedNodeIds,
	});
	const artboardId = node.artboardId ?? refreshed.artboardId;
	const next = {
		...refreshed,
		name: node.name,
		transform: node.transform,
		visible: node.visible,
		locked: node.locked,
	};
	return artboardId !== undefined ? { ...next, artboardId } : next;
}

/**
 * Whether any node in `nodes` (recursively, including descendants) is a Blend
 * container. Exported for the motion-artifact export profile's fail-closed
 * tier predicate (`code.ts`) — mis-tiering a scene with a Blend node is SILENT
 * visual loss (a tier that skips the blend-refresh stage leaves generated
 * Blend in-between children stale, not absent), so that predicate must gate
 * conservatively on this, not on a cheaper proxy.
 */
export const containsBlendNode = (nodes: readonly VectorNode[]): boolean =>
	nodes.some(
		(node) => Boolean(node.blend) || containsBlendNode(node.children ?? []),
	);

// Blend refresh is a read-only projection over immutable scene roots. Cache by
// document identity so motion presentation can reuse generated Blend children
// without carrying a manual invalidation path.
const blendRefreshCache = new WeakMap<SceneDocument, SceneDocument>();

/**
 * Primes the read-only Blend projection cache after an external content-key
 * check. Persistent cache hydration may call this, but command history and the
 * stored scene remain the only source of truth.
 */
export function primeBlendRefreshCache(
	scene: SceneDocument,
	refreshed: SceneDocument,
): void {
	blendRefreshCache.set(scene, refreshed);
}

const refreshBlendNodeTree = (node: VectorNode): VectorNode => {
	let childrenChanged = false;
	const children = node.children?.map((child) => {
		const next = refreshBlendNodeTree(child);
		if (next !== child) childrenChanged = true;
		return next;
	});
	const withChildren =
		children && childrenChanged ? { ...node, children } : node;
	return withChildren.blend ? refreshBlendNode(withChildren) : withChildren;
};

/**
 * Produces a read-only scene projection with every materialized Blend cache
 * regenerated from its source-stop children. This keeps canvas/export views
 * current after source edits without writing derived children into command
 * history.
 */
export function refreshSceneBlendNodes(scene: SceneDocument): SceneDocument {
	const cached = blendRefreshCache.get(scene);
	if (cached) return cached;
	let changed = false;
	const layers = scene.layers.map((layer) => {
		if (!containsBlendNode(layer.nodes)) return layer;
		changed = true;
		return {
			...layer,
			nodes: layer.nodes.map(refreshBlendNodeTree),
		};
	});
	const refreshed = changed ? { ...scene, layers } : scene;
	blendRefreshCache.set(scene, refreshed);
	return refreshed;
}

/** Finds a selected top-level Blend container without walking into child steps. */
export function selectedBlendNode(
	document: SceneDocument,
	nodeId: string | null,
): VectorNode | null {
	if (!nodeId) return null;
	for (const layer of document.layers) {
		const match = layer.nodes.find((node) => node.id === nodeId && node.blend);
		if (match?.blend) return match;
	}
	return null;
}
