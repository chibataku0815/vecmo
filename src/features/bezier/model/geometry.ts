import type { Matrix2D } from "@/entities/scene/model/rendering";
import type { AePoint, AeShape } from "@/shared/glammer/ae-shape";

/** Planar point in a single coordinate space (artboard or node-local). */
export type Vec = {
	readonly x: number;
	readonly y: number;
};

/** Which part of an anchor a sub-selection or hit refers to. */
export type BezierHandleKind = "anchor" | "handle-in" | "handle-out";

/** Anchor-relative target produced by hit testing. */
export type BezierTarget = {
	readonly kind: BezierHandleKind;
	readonly index: number;
};

/** Result of projecting a point onto a curve segment, used to insert anchors. */
export type SegmentProjection = {
	readonly segment: number;
	readonly t: number;
	readonly point: Vec;
};

/** Anchor point plus its two control handle positions in the same space. */
export type AnchorHandles = {
	readonly anchor: Vec;
	readonly inHandle: Vec;
	readonly outHandle: Vec;
};

/** Visual anchor classification for the direct-select overlay. */
export type AnchorKind = "corner" | "smooth";

const TANGENT_EPSILON = 1e-3;
const COLLINEAR_EPSILON = 1e-2;
const SEGMENT_SAMPLE_STEPS = 48;
const MIN_ANCHORS = 2;
// A split whose resulting anchor lands within this distance of a segment
// endpoint would fabricate a coincident duplicate vertex and a zero-length
// segment. This catches both a near-endpoint parameter and a degenerate
// (zero-length) segment whose split point coincides with its endpoints.
const INSERT_MIN_SPLIT_DISTANCE = 1e-3;
const SEGMENT_DRAG_MIN_WEIGHT = 1e-3;
const SINGULAR_EPSILON = 1e-12;
const PERCENT = 100;
const IDENTITY_MATRIX: Matrix2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

const finiteNumber = (value: number | undefined): number =>
	typeof value === "number" && Number.isFinite(value) ? value : 0;
const toAePoint = (point: readonly number[] | undefined): AePoint => [
	finiteNumber(point?.[0]),
	finiteNumber(point?.[1]),
];
const isFiniteVec = (point: Vec): boolean =>
	Number.isFinite(point.x) && Number.isFinite(point.y);
const toVec = (point: readonly number[] | undefined): Vec => ({
	x: finiteNumber(point?.[0]),
	y: finiteNumber(point?.[1]),
});
const addVec = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const distance = (a: Vec, b: Vec): number =>
	isFiniteVec(a) && isFiniteVec(b)
		? Math.hypot(a.x - b.x, a.y - b.y)
		: Number.POSITIVE_INFINITY;
const magnitude = (point: readonly number[] | undefined): number =>
	Math.hypot(finiteNumber(point?.[0]), finiteNumber(point?.[1]));
const negate = (point: AePoint): AePoint => [-point[0], -point[1]];
const hasVertex = (shape: AeShape, index: number): boolean =>
	Number.isInteger(index) && index >= 0 && index < shape.vertices.length;
/**
 * Treats externally supplied path topology as closed only when it explicitly
 * carries boolean `true`. Imported malformed flags such as `"false"` must not
 * create wrap segments or expose orphan endpoint handles before normalization.
 */
export function isPathClosed(shape: AeShape): boolean {
	return shape.vertices.length >= MIN_ANCHORS && shape.closed === true;
}
const isFiniteMatrix = (matrix: Matrix2D): boolean =>
	Number.isFinite(matrix.a) &&
	Number.isFinite(matrix.b) &&
	Number.isFinite(matrix.c) &&
	Number.isFinite(matrix.d) &&
	Number.isFinite(matrix.e) &&
	Number.isFinite(matrix.f);
const clampUnit = (value: number): number => {
	if (!Number.isFinite(value)) return 0;
	return Math.min(1, Math.max(0, value));
};
const lerp = (a: Vec, b: Vec, t: number): Vec => ({
	x: a.x + (b.x - a.x) * t,
	y: a.y + (b.y - a.y) * t,
});

const matrixScaleBounds = (
	matrix: Matrix2D,
): { readonly min: number; readonly max: number } => {
	const source = isFiniteMatrix(matrix) ? matrix : IDENTITY_MATRIX;
	const trace =
		source.a * source.a +
		source.b * source.b +
		source.c * source.c +
		source.d * source.d;
	const determinant = source.a * source.d - source.b * source.c;
	const discriminant = Math.max(
		0,
		trace * trace - 4 * determinant * determinant,
	);
	const root = Math.sqrt(discriminant);
	return {
		min: Math.sqrt(Math.max(0, (trace - root) / 2)),
		max: Math.sqrt(Math.max(0, (trace + root) / 2)),
	};
};

/**
 * Converts a screen-pixel hit radius into local path units for the supplied
 * node transform and viewport zoom. The smallest singular scale keeps the hit
 * target usable under rotated or non-uniformly scaled paths; degenerate matrices
 * fall back to the same identity behavior used by inverse point mapping.
 */
export function screenPixelsToLocalLength(
	matrix: Matrix2D,
	zoomPercent: number,
	pixels: number,
): number {
	if (!Number.isFinite(pixels) || pixels < 0) return 0;
	const zoomScale =
		Number.isFinite(zoomPercent) && zoomPercent > 0 ? zoomPercent / PERCENT : 1;
	if (!isFiniteMatrix(matrix)) return pixels / zoomScale;
	const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
	if (Math.abs(determinant) < SINGULAR_EPSILON) return pixels / zoomScale;
	const scale = matrixScaleBounds(matrix);
	const localScale =
		scale.min > SINGULAR_EPSILON
			? scale.min
			: scale.max > SINGULAR_EPSILON
				? scale.max
				: 1;
	return pixels / zoomScale / localScale;
}

/** Applies an SVG affine matrix to a point. */
export function applyMatrix(matrix: Matrix2D, point: Vec): Vec {
	const source = isFiniteMatrix(matrix) ? matrix : IDENTITY_MATRIX;
	const safePoint = isFiniteVec(point) ? point : { x: 0, y: 0 };
	return {
		x: source.a * safePoint.x + source.c * safePoint.y + source.e,
		y: source.b * safePoint.x + source.d * safePoint.y + source.f,
	};
}

/**
 * Inverts an SVG affine matrix. Degenerate transforms fall back to identity so
 * editing never throws on a collapsed node.
 */
export function invertMatrix(matrix: Matrix2D): Matrix2D {
	if (!isFiniteMatrix(matrix)) return IDENTITY_MATRIX;
	const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
	if (Math.abs(determinant) < SINGULAR_EPSILON) {
		return IDENTITY_MATRIX;
	}
	const inverse = 1 / determinant;
	const a = matrix.d * inverse;
	const b = -matrix.b * inverse;
	const c = -matrix.c * inverse;
	const d = matrix.a * inverse;
	return {
		a,
		b,
		c,
		d,
		e: -(a * matrix.e + c * matrix.f),
		f: -(b * matrix.e + d * matrix.f),
	};
}

/** Maps an artboard-space point back into node-local space. */
export function applyInverseMatrix(matrix: Matrix2D, point: Vec): Vec {
	return applyMatrix(invertMatrix(matrix), point);
}

/**
 * Returns whether a handle controls an actual curve segment. Open paths do not
 * have an incoming segment on the first anchor or an outgoing segment on the
 * last anchor, so those endpoint tangents are hidden from hit testing and direct
 * handle dragging even if imported data contains non-zero values there.
 */
export function isVisiblePathHandle(
	shape: AeShape,
	index: number,
	kind: "handle-in" | "handle-out",
): boolean {
	if (shape.vertices.length < MIN_ANCHORS || !hasVertex(shape, index)) {
		return false;
	}
	if (isPathClosed(shape)) return true;
	const lastIndex = shape.vertices.length - 1;
	return kind === "handle-in" ? index > 0 : index < lastIndex;
}

/** Returns the anchor and both control handle positions for a vertex. */
export function anchorHandles(shape: AeShape, index: number): AnchorHandles {
	const anchor = toVec(shape.vertices[index]);
	return {
		anchor,
		inHandle: addVec(anchor, toVec(shape.inTangents[index])),
		outHandle: addVec(anchor, toVec(shape.outTangents[index])),
	};
}

/** Classifies a vertex as a smooth (collinear tangents) or corner anchor. */
export function anchorKind(shape: AeShape, index: number): AnchorKind {
	const inTangent = shape.inTangents[index];
	const outTangent = shape.outTangents[index];
	const inMagnitude = magnitude(inTangent);
	const outMagnitude = magnitude(outTangent);
	if (inMagnitude < TANGENT_EPSILON || outMagnitude < TANGENT_EPSILON) {
		return "corner";
	}
	const cross = inTangent[0] * outTangent[1] - inTangent[1] * outTangent[0];
	const dot = inTangent[0] * outTangent[0] + inTangent[1] * outTangent[1];
	const collinear =
		Math.abs(cross) <= COLLINEAR_EPSILON * inMagnitude * outMagnitude;
	return collinear && dot < 0 ? "smooth" : "corner";
}

/**
 * Finds the nearest anchor or visible handle within tolerance. Handles win ties
 * so an overlapping handle stays grabbable; zero-length handles are skipped.
 */
export function hitTestShape(
	shape: AeShape,
	point: Vec,
	tolerance: number,
): BezierTarget | null {
	if (!isFiniteVec(point) || !Number.isFinite(tolerance) || tolerance < 0) {
		return null;
	}
	const candidates: { target: BezierTarget; position: Vec }[] = [];
	for (let index = 0; index < shape.vertices.length; index += 1) {
		const handles = anchorHandles(shape, index);
		if (
			isVisiblePathHandle(shape, index, "handle-out") &&
			magnitude(shape.outTangents[index]) > TANGENT_EPSILON
		) {
			candidates.push({
				target: { kind: "handle-out", index },
				position: handles.outHandle,
			});
		}
		if (
			isVisiblePathHandle(shape, index, "handle-in") &&
			magnitude(shape.inTangents[index]) > TANGENT_EPSILON
		) {
			candidates.push({
				target: { kind: "handle-in", index },
				position: handles.inHandle,
			});
		}
	}
	for (let index = 0; index < shape.vertices.length; index += 1) {
		candidates.push({
			target: { kind: "anchor", index },
			position: toVec(shape.vertices[index]),
		});
	}

	// Nearest candidate wins; handles are enumerated first so they take ties and
	// stay grabbable when they overlap their anchor.
	let best: BezierTarget | null = null;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const candidate of candidates) {
		const dist = distance(point, candidate.position);
		if (dist > tolerance) continue;
		if (dist < bestDistance) {
			best = candidate.target;
			bestDistance = dist;
		}
	}
	return best;
}

const segmentCount = (shape: AeShape): number =>
	shape.vertices.length < MIN_ANCHORS
		? 0
		: isPathClosed(shape)
			? shape.vertices.length
			: shape.vertices.length - 1;

const segmentControlPoints = (shape: AeShape, segment: number) => {
	if (
		!Number.isInteger(segment) ||
		segment < 0 ||
		segment >= segmentCount(shape)
	) {
		return null;
	}
	const next = (segment + 1) % shape.vertices.length;
	const p0 = toVec(shape.vertices[segment]);
	const p3 = toVec(shape.vertices[next]);
	return {
		next,
		p0,
		p1: addVec(p0, toVec(shape.outTangents[segment])),
		p2: addVec(p3, toVec(shape.inTangents[next])),
		p3,
	};
};

const cubicAt = (p0: Vec, p1: Vec, p2: Vec, p3: Vec, t: number): Vec => {
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

/** Evaluates the cubic of one segment at parameter `t`. */
export function evaluateSegment(
	shape: AeShape,
	segment: number,
	t: number,
): Vec {
	const controls = segmentControlPoints(shape, segment);
	if (!controls) return toVec(shape.vertices[0]);
	const { p0, p1, p2, p3 } = controls;
	return cubicAt(p0, p1, p2, p3, clampUnit(t));
}

/**
 * Projects a point onto the nearest curve segment within tolerance. The returned
 * `t` is sampled, so it only affects where an inserted anchor lands, never the
 * preserved curve.
 */
export function projectOntoShape(
	shape: AeShape,
	point: Vec,
	tolerance: number,
): SegmentProjection | null {
	if (!isFiniteVec(point) || !Number.isFinite(tolerance) || tolerance < 0) {
		return null;
	}
	let best: (SegmentProjection & { distance: number }) | null = null;
	const segments = segmentCount(shape);
	for (let segment = 0; segment < segments; segment += 1) {
		const controls = segmentControlPoints(shape, segment);
		if (!controls) continue;
		const { p0, p1, p2, p3 } = controls;
		for (let step = 0; step <= SEGMENT_SAMPLE_STEPS; step += 1) {
			const t = step / SEGMENT_SAMPLE_STEPS;
			const candidate = cubicAt(p0, p1, p2, p3, t);
			const dist = distance(point, candidate);
			if (dist > tolerance) continue;
			if (!best || dist < best.distance) {
				best = { segment, t, point: candidate, distance: dist };
			}
		}
	}
	if (!best) return null;
	return { segment: best.segment, t: best.t, point: best.point };
}

const cloneShape = (shape: AeShape): AeShape => ({
	type: "Shape",
	closed: isPathClosed(shape),
	vertices: shape.vertices.map((point) => toAePoint(point)),
	inTangents: shape.vertices.map((_, index) =>
		toAePoint(shape.inTangents[index]),
	),
	outTangents: shape.vertices.map((_, index) =>
		toAePoint(shape.outTangents[index]),
	),
});

const isFinitePoint = (point: readonly number[] | undefined): boolean =>
	typeof point?.[0] === "number" &&
	Number.isFinite(point[0]) &&
	typeof point[1] === "number" &&
	Number.isFinite(point[1]);
const isZeroTangent = (point: readonly number[] | undefined): boolean =>
	isFinitePoint(point) && magnitude(point) < TANGENT_EPSILON;

const clearOpenEndpointTangents = (shape: AeShape): void => {
	if (isPathClosed(shape) || shape.vertices.length === 0) return;
	shape.inTangents[0] = [0, 0];
	shape.outTangents[shape.vertices.length - 1] = [0, 0];
};

/**
 * Repairs imported or externally supplied shapes into the invariant used by
 * direct editing: vertices and both tangent arrays share length, all coordinates
 * are finite, and one-point paths cannot remain closed.
 */
export function normalizePathShape(shape: AeShape): AeShape {
	const result = cloneShape(shape);
	result.closed = isPathClosed(shape);
	clearOpenEndpointTangents(result);
	return result;
}

/**
 * Validates the editable path invariant after normalization. A path replacement
 * must keep at least two finite anchors and boolean closed state; degenerate
 * one-point imports may be inspected but are not valid write targets.
 */
export function isValidPathShape(shape: AeShape): boolean {
	return (
		shape.type === "Shape" &&
		typeof shape.closed === "boolean" &&
		shape.vertices.length >= MIN_ANCHORS &&
		shape.vertices.length === shape.inTangents.length &&
		shape.vertices.length === shape.outTangents.length &&
		shape.vertices.every(isFinitePoint) &&
		shape.inTangents.every(isFinitePoint) &&
		shape.outTangents.every(isFinitePoint) &&
		(shape.closed ||
			(isZeroTangent(shape.inTangents[0]) &&
				isZeroTangent(shape.outTangents[shape.vertices.length - 1])))
	);
}

/**
 * Retracts one selected control handle to its anchor. The opposite handle is not
 * mirrored: deleting a single handle intentionally converts that side of the
 * anchor into a corner while preserving the other curve side. Malformed imported
 * path topology is repaired through the same clone path used by other edits.
 */
export function resetHandle(
	shape: AeShape,
	index: number,
	kind: "handle-in" | "handle-out",
): AeShape {
	if (!hasVertex(shape, index)) return shape;
	const tangent =
		kind === "handle-in" ? shape.inTangents[index] : shape.outTangents[index];
	if (isZeroTangent(tangent) && isValidPathShape(shape)) return shape;
	const next = cloneShape(shape);
	if (kind === "handle-in") {
		next.inTangents[index] = [0, 0];
	} else {
		next.outTangents[index] = [0, 0];
	}
	return next;
}

/** Moves an anchor; relative tangents travel with it. */
export function moveAnchor(shape: AeShape, index: number, point: Vec): AeShape {
	const next = normalizePathShape(shape);
	if (!hasVertex(next, index) || !isFiniteVec(point)) return next;
	next.vertices[index] = [point.x, point.y];
	return next;
}

/**
 * Moves a control handle. Without `breakSymmetry` the opposite handle mirrors to
 * keep the anchor smooth, except where there is no opposing segment (open ends).
 */
export function moveHandle(
	shape: AeShape,
	index: number,
	kind: "handle-in" | "handle-out",
	point: Vec,
	breakSymmetry: boolean,
): AeShape {
	const next = normalizePathShape(shape);
	if (
		!hasVertex(next, index) ||
		!isFiniteVec(point) ||
		!isVisiblePathHandle(next, index, kind)
	) {
		return next;
	}
	const anchor = toVec(next.vertices[index]);
	const tangent: AePoint = [point.x - anchor.x, point.y - anchor.y];
	const lastIndex = next.vertices.length - 1;
	const closed = isPathClosed(next);
	const hasIncoming = closed || index > 0;
	const hasOutgoing = closed || index < lastIndex;
	if (kind === "handle-out") {
		next.outTangents[index] = tangent;
		if (!breakSymmetry && hasIncoming) next.inTangents[index] = negate(tangent);
	} else {
		next.inTangents[index] = tangent;
		if (!breakSymmetry && hasOutgoing) {
			next.outTangents[index] = negate(tangent);
		}
	}
	return next;
}

/**
 * Reports whether splitting `segment` at `t` would create a real new anchor.
 * A split whose anchor lands on an existing endpoint duplicates a vertex and
 * leaves a zero-length segment, so it is not insertable. This rejects both a
 * near-endpoint parameter (clicking right next to an anchor) and a degenerate
 * zero-length segment (e.g. imported duplicate points) whose split point
 * coincides with its endpoints regardless of `t`. The handler uses it to fall
 * back to selection instead of fabricating a coincident duplicate anchor.
 */
export function canInsertAtProjection(
	shape: AeShape,
	segment: number,
	t: number,
): boolean {
	const controls = segmentControlPoints(shape, segment);
	if (!controls || !Number.isFinite(t)) return false;
	const { p0, p1, p2, p3 } = controls;
	const splitPoint = cubicAt(p0, p1, p2, p3, clampUnit(t));
	return (
		distance(splitPoint, p0) > INSERT_MIN_SPLIT_DISTANCE &&
		distance(splitPoint, p3) > INSERT_MIN_SPLIT_DISTANCE
	);
}

/**
 * Splits a segment at `t` using De Casteljau subdivision. The inserted anchor
 * preserves the original curve exactly. Splits that collapse onto a segment
 * endpoint are rejected (return the shape unchanged) so insertion never produces
 * a coincident duplicate anchor or a zero-length segment.
 */
export function insertAnchor(
	shape: AeShape,
	segment: number,
	t: number,
): AeShape {
	const controls = segmentControlPoints(shape, segment);
	const result = cloneShape(shape);
	if (!controls || !Number.isFinite(t)) return result;
	if (!canInsertAtProjection(shape, segment, t)) return result;
	const splitT = clampUnit(t);
	const { next, p0, p1, p2, p3 } = controls;
	const a = lerp(p0, p1, splitT);
	const b = lerp(p1, p2, splitT);
	const c = lerp(p2, p3, splitT);
	const d = lerp(a, b, splitT);
	const e = lerp(b, c, splitT);
	const m = lerp(d, e, splitT);

	result.outTangents[segment] = [a.x - p0.x, a.y - p0.y];
	result.inTangents[next] = [c.x - p3.x, c.y - p3.y];
	const insertAt = segment + 1;
	result.vertices.splice(insertAt, 0, [m.x, m.y]);
	result.inTangents.splice(insertAt, 0, [d.x - m.x, d.y - m.y]);
	result.outTangents.splice(insertAt, 0, [e.x - m.x, e.y - m.y]);
	return result;
}

/**
 * Bends a segment by moving its two adjacent control handles while keeping both
 * anchors fixed. The drag delta is scaled by the cubic basis weight at `t`, so
 * the touched point follows the pointer without inserting a new anchor. This is
 * the direct-select segment-edit counterpart to anchor and handle dragging.
 */
export function moveSegment(
	shape: AeShape,
	segment: number,
	t: number,
	delta: Vec,
): AeShape {
	const result = normalizePathShape(shape);
	const controls = segmentControlPoints(result, segment);
	if (!controls || !Number.isFinite(t) || !isFiniteVec(delta)) return result;
	const splitT = clampUnit(t);
	const weight = 3 * splitT * (1 - splitT);
	if (weight < SEGMENT_DRAG_MIN_WEIGHT) return result;
	const handleDelta: Vec = {
		x: delta.x / weight,
		y: delta.y / weight,
	};
	if (!isFiniteVec(handleDelta)) return result;
	const outTangent = toAePoint(result.outTangents[segment]);
	const inTangent = toAePoint(result.inTangents[controls.next]);
	result.outTangents[segment] = [
		outTangent[0] + handleDelta.x,
		outTangent[1] + handleDelta.y,
	];
	result.inTangents[controls.next] = [
		inTangent[0] + handleDelta.x,
		inTangent[1] + handleDelta.y,
	];
	return result;
}

/** Removes an anchor, keeping at least a two-point path. */
export function removeAnchor(shape: AeShape, index: number): AeShape {
	if (shape.vertices.length <= MIN_ANCHORS || !hasVertex(shape, index)) {
		return shape;
	}
	const result = cloneShape(shape);
	result.vertices.splice(index, 1);
	result.inTangents.splice(index, 1);
	result.outTangents.splice(index, 1);
	clearOpenEndpointTangents(result);
	return result;
}

/**
 * Opens or closes a path without changing topology. Closing is only meaningful
 * for two or more anchors; one-point imported paths remain open so segment math
 * does not invent a self-closing curve.
 */
export function setPathClosed(shape: AeShape, closed: boolean): AeShape {
	const result = cloneShape(shape);
	result.closed = result.vertices.length >= MIN_ANCHORS ? closed : false;
	clearOpenEndpointTangents(result);
	return result;
}
