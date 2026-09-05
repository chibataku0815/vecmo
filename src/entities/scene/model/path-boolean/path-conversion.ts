import {
	buildRoundedRectShape,
	resolveCornerRadii,
	resolveCornerSmoothing,
} from "@/entities/scene/model/corner-geometry";
import {
	type Matrix2D,
	matrixFromTransform,
} from "@/entities/scene/model/rendering";
import type {
	EllipseGeometry,
	NodeGeometry,
	PathGeometry,
	PolygonGeometry,
	RectGeometry,
	Vec2,
} from "@/entities/scene/model/types";
import type { AePoint, AeShape } from "@/shared/glammer/ae-shape";
import type { PathOpIssue, PathOpSource } from "./types";

export type PathOpPoint = {
	readonly x: number;
	readonly y: number;
};

export type PathOpPolygon = {
	readonly points: readonly PathOpPoint[];
	readonly sourceId?: string;
	readonly geometryKind: NodeGeometry["kind"];
};

type PolygonConversionSuccess = {
	readonly ok: true;
	readonly polygon: PathOpPolygon;
	/** Transformed hard-corner vertex positions, for corner-preserving re-fit. */
	readonly cornerPoints: readonly PathOpPoint[];
	readonly issues: readonly PathOpIssue[];
};

type PolygonConversionFailure = {
	readonly ok: false;
	readonly issues: readonly PathOpIssue[];
};

export type PolygonConversionResult =
	| PolygonConversionSuccess
	| PolygonConversionFailure;

type PathConversionSuccess = {
	readonly ok: true;
	readonly geometry: PathGeometry;
	readonly issues: readonly PathOpIssue[];
};

type PathConversionFailure = {
	readonly ok: false;
	readonly issues: readonly PathOpIssue[];
};

export type PathConversionResult =
	| PathConversionSuccess
	| PathConversionFailure;

const ELLIPSE_KAPPA = 0.5522847498307936;
/**
 * Max deviation, in scene units, of a flattened sample from its source cubic.
 * Adaptive subdivision (vs. a fixed step count) keeps Boolean intersections
 * precise on large arcs and feeds the curve re-fit dense, faithful samples while
 * leaving straight segments as single points.
 */
const CURVE_FLATTEN_TOLERANCE = 0.15;
const MAX_FLATTEN_DEPTH = 18;
/** Cosine of the heading change under which a vertex still reads as smooth. */
const SMOOTH_CORNER_DOT = Math.cos((1 * Math.PI) / 180);
const POINT_EPSILON = 1e-7;

const zero = (): AePoint => [0, 0];

const finite = (value: number): boolean => Number.isFinite(value);

const isFinitePoint = (point: readonly number[] | undefined): boolean =>
	finite(point?.[0] ?? Number.NaN) && finite(point?.[1] ?? Number.NaN);

const finiteVec = (point: Vec2): boolean => finite(point.x) && finite(point.y);

const issue = (
	code: PathOpIssue["code"],
	message: string,
	severity: PathOpIssue["severity"],
	source?: PathOpSource,
): PathOpIssue => ({
	code,
	message,
	severity,
	sourceId: source?.id,
	geometryKind: source?.geometry.kind,
});

const aePoint = (point: Vec2 | PathOpPoint): AePoint => [point.x, point.y];

const pointFromAe = (point: readonly number[]): PathOpPoint => ({
	x: point[0] ?? 0,
	y: point[1] ?? 0,
});

const samePoint = (a: PathOpPoint, b: PathOpPoint): boolean =>
	Math.hypot(a.x - b.x, a.y - b.y) <= POINT_EPSILON;

const midpoint = (a: PathOpPoint, b: PathOpPoint): PathOpPoint => ({
	x: (a.x + b.x) / 2,
	y: (a.y + b.y) / 2,
});

/** Perpendicular distance from `point` to the chord `start`→`end`. */
const distanceToChord = (
	point: PathOpPoint,
	start: PathOpPoint,
	end: PathOpPoint,
): number => {
	const dx = end.x - start.x;
	const dy = end.y - start.y;
	const lengthSq = dx * dx + dy * dy;
	if (lengthSq <= POINT_EPSILON) {
		return Math.hypot(point.x - start.x, point.y - start.y);
	}
	const area = Math.abs((point.x - start.x) * dy - (point.y - start.y) * dx);
	return area / Math.sqrt(lengthSq);
};

/**
 * Appends an adaptively flattened cubic to `out` (interior samples then `p3`,
 * never `p0`). A segment within `CURVE_FLATTEN_TOLERANCE` of its chord — every
 * straight line-segment included — emits a single endpoint, so polygon sources
 * stay byte-identical and only genuine curvature is subdivided.
 */
const flattenCubicInto = (
	p0: PathOpPoint,
	p1: PathOpPoint,
	p2: PathOpPoint,
	p3: PathOpPoint,
	out: PathOpPoint[],
	depth: number,
): void => {
	const flat =
		distanceToChord(p1, p0, p3) <= CURVE_FLATTEN_TOLERANCE &&
		distanceToChord(p2, p0, p3) <= CURVE_FLATTEN_TOLERANCE;
	if (flat || depth >= MAX_FLATTEN_DEPTH) {
		out.push(p3);
		return;
	}
	const p01 = midpoint(p0, p1);
	const p12 = midpoint(p1, p2);
	const p23 = midpoint(p2, p3);
	const p012 = midpoint(p01, p12);
	const p123 = midpoint(p12, p23);
	const mid = midpoint(p012, p123);
	flattenCubicInto(p0, p01, p012, mid, out, depth + 1);
	flattenCubicInto(mid, p123, p23, p3, out, depth + 1);
};

const add = (point: PathOpPoint, tangent: readonly number[]): PathOpPoint => ({
	x: point.x + (tangent[0] ?? 0),
	y: point.y + (tangent[1] ?? 0),
});

const hasCurveTangents = (shape: AeShape): boolean =>
	shape.inTangents.some(([x, y]) => Math.hypot(x, y) > POINT_EPSILON) ||
	shape.outTangents.some(([x, y]) => Math.hypot(x, y) > POINT_EPSILON);

const applyMatrix = (matrix: Matrix2D, point: PathOpPoint): PathOpPoint => ({
	x: matrix.a * point.x + matrix.c * point.y + matrix.e,
	y: matrix.b * point.x + matrix.d * point.y + matrix.f,
});

const transformed = (
	points: readonly PathOpPoint[],
	source: PathOpSource,
): readonly PathOpPoint[] => {
	if (!source.transform) return points;
	const matrix = matrixFromTransform(source.transform);
	return points.map((point) => applyMatrix(matrix, point));
};

const removeDuplicateClosure = (
	points: readonly PathOpPoint[],
): readonly PathOpPoint[] => {
	if (points.length < 2) return points;
	const deduped: PathOpPoint[] = [];
	for (const point of points) {
		const previous = deduped.at(-1);
		if (!previous || !samePoint(previous, point)) deduped.push(point);
	}
	const first = deduped[0];
	const last = deduped.at(-1);
	if (first && last && deduped.length > 1 && samePoint(first, last)) {
		deduped.pop();
	}
	return deduped;
};

const cloneShape = (shape: AeShape): AeShape => ({
	type: "Shape",
	closed: shape.closed,
	vertices: shape.vertices.map((point) => [point[0] ?? 0, point[1] ?? 0]),
	inTangents: shape.vertices.map((_, index) => {
		const point = shape.inTangents[index];
		return [point?.[0] ?? 0, point?.[1] ?? 0];
	}),
	outTangents: shape.vertices.map((_, index) => {
		const point = shape.outTangents[index];
		return [point?.[0] ?? 0, point?.[1] ?? 0];
	}),
});

const invalidGeometry = (
	geometry: NodeGeometry,
	message: string,
): PathConversionFailure => ({
	ok: false,
	issues: [
		{
			code: "path-op.invalid-geometry",
			message,
			severity: "error",
			geometryKind: geometry.kind,
		},
	],
});

const hasPositiveBounds = (geometry: RectGeometry | EllipseGeometry): boolean =>
	finite(geometry.bounds.x) &&
	finite(geometry.bounds.y) &&
	geometry.bounds.width > POINT_EPSILON &&
	geometry.bounds.height > POINT_EPSILON;

const validPolygonPoints = (
	geometry: PolygonGeometry,
): readonly PathOpPoint[] | null => {
	if (!geometry.points.every(finiteVec)) return null;
	const points = removeDuplicateClosure(geometry.points);
	return points.length >= 3 ? points : null;
};

const validateShape = (
	shape: AeShape,
	source: PathOpSource,
): readonly PathOpIssue[] => {
	const issues: PathOpIssue[] = [];
	if (shape.vertices.length < 3) {
		issues.push(
			issue(
				"path-op.invalid-geometry",
				"Path operations require at least three path vertices.",
				"error",
				source,
			),
		);
	}
	if (!shape.closed) {
		issues.push(
			issue(
				"path-op.open-path",
				"Open paths cannot participate in filled Boolean operations.",
				"error",
				source,
			),
		);
	}
	for (const point of [
		...shape.vertices,
		...shape.inTangents,
		...shape.outTangents,
	]) {
		if (!isFinitePoint(point)) {
			issues.push(
				issue(
					"path-op.invalid-geometry",
					"Path geometry contains non-finite coordinates.",
					"error",
					source,
				),
			);
			break;
		}
	}
	return issues;
};

/**
 * Samples an Ae shape into editable line vertices for path-operation surfaces.
 * Curved segments are deterministically flattened with the same step count used
 * by Boolean operations so future commands report identical approximation
 * warnings instead of hiding geometry loss behind separate conversion paths.
 */
export function pathShapeToPolyline(
	shape: AeShape,
	source: PathOpSource,
): {
	readonly points: readonly PathOpPoint[];
	readonly issues: readonly PathOpIssue[];
} {
	const issues: PathOpIssue[] = [];
	const curve = hasCurveTangents(shape);
	if (curve) {
		issues.push(
			issue(
				"path-op.curve-approximated",
				"Curved path segments were flattened for this dependency-free path operation.",
				"warning",
				source,
			),
		);
	}

	const points: PathOpPoint[] = [];
	const segmentCount = shape.closed
		? shape.vertices.length
		: shape.vertices.length - 1;
	for (let index = 0; index < segmentCount; index += 1) {
		const nextIndex = (index + 1) % shape.vertices.length;
		const p0 = pointFromAe(shape.vertices[index]);
		const p3 = pointFromAe(shape.vertices[nextIndex]);
		const p1 = add(p0, shape.outTangents[index]);
		const p2 = add(p3, shape.inTangents[nextIndex]);
		if (points.length === 0) points.push(p0);
		flattenCubicInto(p0, p1, p2, p3, points, 0);
	}

	return { points: removeDuplicateClosure(points), issues };
}

/**
 * Positions of `shape` vertices that read as hard corners — where the heading
 * arriving at the vertex turns away from the heading leaving it by more than the
 * smooth tolerance. Smooth on-curve vertices (ellipse cardinals, rounded-rect
 * arc joins) are excluded so the Boolean curve re-fit traces through them, while
 * genuine sharp vertices (rectangle corners, polygon points) are kept so the
 * re-fit cannot round them.
 */
export function hardCornerVertices(shape: AeShape): readonly PathOpPoint[] {
	const count = shape.vertices.length;
	if (count < 3) return shape.vertices.map(pointFromAe);
	const corners: PathOpPoint[] = [];
	for (let index = 0; index < count; index += 1) {
		if (isHardCorner(shape, index)) {
			corners.push(pointFromAe(shape.vertices[index]));
		}
	}
	return corners;
}

const hasMagnitude = (tangent: readonly number[] | undefined): boolean =>
	Math.hypot(tangent?.[0] ?? 0, tangent?.[1] ?? 0) > POINT_EPSILON;

const normalizedHeading = (vector: PathOpPoint): PathOpPoint | null => {
	const length = Math.hypot(vector.x, vector.y);
	if (length <= POINT_EPSILON) return null;
	return { x: vector.x / length, y: vector.y / length };
};

const isHardCorner = (shape: AeShape, index: number): boolean => {
	const count = shape.vertices.length;
	const vertex = pointFromAe(shape.vertices[index]);
	const previous = pointFromAe(shape.vertices[(index - 1 + count) % count]);
	const next = pointFromAe(shape.vertices[(index + 1) % count]);
	const inTangent = shape.inTangents[index];
	const outTangent = shape.outTangents[index];
	// Velocity arriving at the vertex: -inTangent when handled, else the chord
	// from the previous vertex. Velocity leaving: outTangent when handled, else
	// the chord to the next vertex.
	const arrival = hasMagnitude(inTangent)
		? { x: -(inTangent[0] ?? 0), y: -(inTangent[1] ?? 0) }
		: { x: vertex.x - previous.x, y: vertex.y - previous.y };
	const departure = hasMagnitude(outTangent)
		? { x: outTangent[0] ?? 0, y: outTangent[1] ?? 0 }
		: { x: next.x - vertex.x, y: next.y - vertex.y };
	const arrivalDir = normalizedHeading(arrival);
	const departureDir = normalizedHeading(departure);
	if (!arrivalDir || !departureDir) return true;
	const alignment =
		arrivalDir.x * departureDir.x + arrivalDir.y * departureDir.y;
	return alignment < SMOOTH_CORNER_DOT;
};

/**
 * Builds an editable line-segment path from polygon vertices. Vertices must be
 * in one coordinate space; duplicate consecutive points and a duplicated
 * closing point are omitted so direct editing does not expose overlapping seam
 * anchors.
 */
export function pathGeometryFromPoints(
	points: readonly PathOpPoint[],
): PathGeometry {
	const editablePoints = removeDuplicateClosure(points);
	return {
		kind: "path",
		shape: {
			type: "Shape",
			closed: true,
			vertices: editablePoints.map(aePoint),
			inTangents: editablePoints.map(zero),
			outTangents: editablePoints.map(zero),
		},
	};
}

/**
 * Builds a compound editable path from one outer contour and one or more hole
 * contours. Holes are stored as `subpaths` resolved with the even-odd fill rule,
 * so the cutout reads correctly regardless of each hole's winding direction.
 * Mirrors the `{ shape, subpaths, fillRule }` shape the SVG importer constructs
 * for a preserved donut / letter counter, so the client renderer, SVG/PDF
 * exporters, and worker renderer all consume identical geometry. Holes that
 * collapse below a valid triangle are dropped; with none left the result
 * degrades to the plain single-contour path.
 */
export function compoundPathGeometryFromContours(
	outer: readonly PathOpPoint[],
	holes: readonly (readonly PathOpPoint[])[],
): PathGeometry {
	const base = pathGeometryFromPoints(outer);
	const subpaths = holes
		.map((hole) => pathGeometryFromPoints(hole).shape)
		.filter((shape) => shape.vertices.length >= 3);
	if (subpaths.length === 0) return base;
	return { ...base, subpaths, fillRule: "evenodd" };
}

/**
 * Converts a rectangle, including (per-corner) rounded corners, into editable
 * path data. Delegates to the shared `buildRoundedRectShape` so canvas, export,
 * and path-ops bake identical geometry; the uniform circular case stays
 * byte-identical to the legacy output.
 */
export function rectToPathGeometry(geometry: RectGeometry): PathGeometry {
	return {
		kind: "path",
		shape: buildRoundedRectShape(geometry.bounds, {
			radii: resolveCornerRadii(geometry),
			smoothing: resolveCornerSmoothing(geometry),
		}),
	};
}

/** Converts an ellipse into the standard four-cubic editable path form. */
export function ellipseToPathGeometry(geometry: EllipseGeometry): PathGeometry {
	const { x, y, width, height } = geometry.bounds;
	const rx = Math.max(0, width) / 2;
	const ry = Math.max(0, height) / 2;
	const cx = x + rx;
	const cy = y + ry;
	const kx = ELLIPSE_KAPPA * rx;
	const ky = ELLIPSE_KAPPA * ry;
	return {
		kind: "path",
		shape: {
			type: "Shape",
			closed: true,
			vertices: [
				[cx + rx, cy],
				[cx, cy + ry],
				[cx - rx, cy],
				[cx, cy - ry],
			],
			inTangents: [
				[0, -ky],
				[kx, 0],
				[0, ky],
				[-kx, 0],
			],
			outTangents: [
				[0, ky],
				[-kx, 0],
				[0, -ky],
				[kx, 0],
			],
		},
	};
}

/** Converts polygon geometry into a closed editable line-segment path. */
export function polygonToPathGeometry(geometry: PolygonGeometry): PathGeometry {
	return pathGeometryFromPoints(geometry.points);
}

/**
 * Converts supported primitive geometry to a path without applying Boolean
 * clipping. Unsupported area-less geometry returns typed issues instead of an
 * empty path.
 */
export function geometryToPathGeometry(
	geometry: NodeGeometry,
): PathConversionResult {
	switch (geometry.kind) {
		case "rect":
			if (!hasPositiveBounds(geometry)) {
				return invalidGeometry(
					geometry,
					"Rectangle path conversion requires finite positive bounds.",
				);
			}
			return { ok: true, geometry: rectToPathGeometry(geometry), issues: [] };
		case "ellipse":
			if (!hasPositiveBounds(geometry)) {
				return invalidGeometry(
					geometry,
					"Ellipse path conversion requires finite positive bounds.",
				);
			}
			return {
				ok: true,
				geometry: ellipseToPathGeometry(geometry),
				issues: [],
			};
		case "polygon": {
			const points = validPolygonPoints(geometry);
			if (!points) {
				return invalidGeometry(
					geometry,
					"Polygon path conversion requires at least three finite unique points.",
				);
			}
			return {
				ok: true,
				geometry: pathGeometryFromPoints(points),
				issues: [],
			};
		}
		case "path":
			return {
				ok: true,
				geometry: { kind: "path", shape: cloneShape(geometry.shape) },
				issues: [],
			};
		case "line":
		case "star":
		case "text":
		case "image":
			return {
				ok: false,
				issues: [
					{
						code: "path-op.unsupported-geometry",
						message: `${geometry.kind} geometry cannot be converted to an editable filled path by path ops.`,
						severity: "error",
						geometryKind: geometry.kind,
					},
				],
			};
	}
}

/**
 * Converts a scene geometry source into a polygon in operation coordinates.
 * Transforms are baked into points because Boolean output is a new flattened
 * editable path, not a live compound reference to its sources.
 */
export function sourceToOperationPolygon(
	source: PathOpSource,
): PolygonConversionResult {
	// Boolean ops sample only the outer contour, so a compound path's holes would
	// be silently ignored and lost when the result replaces the source. Refuse
	// such sources with a visible, actionable error instead of dropping the holes;
	// hole-aware Boolean output is tracked separately.
	if (
		source.geometry.kind === "path" &&
		(source.geometry.subpaths?.length ?? 0) > 0
	) {
		return {
			ok: false,
			issues: [
				issue(
					"path-op.compound-source",
					"Boolean path operations do not yet support compound paths with holes.",
					"error",
					source,
				),
			],
		};
	}

	const pathResult = geometryToPathGeometry(source.geometry);
	if (!pathResult.ok) {
		return {
			ok: false,
			issues: pathResult.issues.map((item) => ({
				...item,
				sourceId: source.id,
				geometryKind: source.geometry.kind,
			})),
		};
	}

	const shape = pathResult.geometry.shape;
	const validationIssues = validateShape(shape, source);
	if (validationIssues.some((item) => item.severity === "error")) {
		return { ok: false, issues: [...pathResult.issues, ...validationIssues] };
	}

	const polyline = pathShapeToPolyline(shape, source);
	const points = transformed(polyline.points, source);
	if (points.length < 3) {
		return {
			ok: false,
			issues: [
				...pathResult.issues,
				...polyline.issues,
				issue(
					"path-op.invalid-geometry",
					"Path operation source collapsed below three unique points.",
					"error",
					source,
				),
			],
		};
	}

	return {
		ok: true,
		polygon: {
			points,
			sourceId: source.id,
			geometryKind: source.geometry.kind,
		},
		cornerPoints: transformed(hardCornerVertices(shape), source),
		issues: [...pathResult.issues, ...polyline.issues],
	};
}
