import type { AePoint, AeShape } from "@/shared/glammer/ae-shape";

/**
 * Adaptive flattening of an {@link AeShape} spine into arc-length-parameterized
 * samples, the input the variable-width stroke expander walks to place rail
 * points and widths.
 *
 * Each cubic segment (`vertex[i]` + `outTangents[i]` → `vertex[i+1]` +
 * `inTangents[i+1]`) is subdivided recursively until the flattened chord
 * deviates from the true curve by less than {@link SPINE_FLATNESS_TOLERANCE},
 * so straight segments cost one sample and tight curves cost many — no fixed
 * step count to tune per shape scale.
 *
 * Normals are deliberately **not** the analytic cubic tangent: this codebase
 * authors straight lines with zero in/out tangents (matching
 * `curve-fit.ts::lineCubic`), and the cubic derivative is exactly the zero
 * vector at both `t=0` and `t=1` for such a segment — precisely where a
 * per-segment analytic normal would be evaluated. Instead, normals are
 * computed from the flattened **polyline's secants** in a second pass after
 * every point exists, so a straight zero-tangent segment still yields a
 * correct perpendicular from its own two endpoints.
 */

/** One flattened sample along a stroked spine. */
export interface SpineSample {
	/** X position in the shape's local coordinate space. */
	readonly x: number;
	/** Y position in the shape's local coordinate space. */
	readonly y: number;
	/** Cumulative arc length from the spine's start to this sample. */
	readonly s: number;
	/** Unit normal X component (rotate the tangent -90°), for rail offsetting. */
	readonly nx: number;
	/** Unit normal Y component (rotate the tangent -90°), for rail offsetting. */
	readonly ny: number;
}

/**
 * Default max deviation (doc units) between a flattened chord and the true
 * cubic curve before it is subdivided further. Smaller values trace tighter
 * curves more faithfully at the cost of more samples.
 */
export const SPINE_FLATNESS_TOLERANCE = 0.25;

/** Recursion depth cap so a degenerate/self-similar cubic cannot hang. */
const MAX_SUBDIVISION_DEPTH = 16;

/** Zero-length guard for direction/tangent normalization. */
const DIRECTION_EPSILON = 1e-9;

type Vec = { readonly x: number; readonly y: number };
/** A flattened point before its secant normal is known. */
type FlatPoint = { readonly x: number; readonly y: number; readonly s: number };

const toVec = ([x, y]: AePoint): Vec => ({ x, y });
const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const distance = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Flatness test: distance of the two interior Bézier control points from the
 * chord through the endpoints. Both control points inside tolerance implies
 * the curve is well-approximated by the chord (standard cubic flatness bound).
 */
function chordDeviation(p0: Vec, p1: Vec, p2: Vec, p3: Vec): number {
	const chordLength = distance(p0, p3);
	if (chordLength <= DIRECTION_EPSILON) {
		return Math.max(distance(p1, p0), distance(p2, p0));
	}
	const ux = (p3.x - p0.x) / chordLength;
	const uy = (p3.y - p0.y) / chordLength;
	const perpDistance = (point: Vec): number => {
		const relX = point.x - p0.x;
		const relY = point.y - p0.y;
		const along = relX * ux + relY * uy;
		const perpX = relX - along * ux;
		const perpY = relY - along * uy;
		return Math.hypot(perpX, perpY);
	};
	return Math.max(perpDistance(p1), perpDistance(p2));
}

/**
 * Recursively subdivides `[t0, t1]` of one cubic segment, pushing samples onto
 * `out` (with running arc length `lengthSoFar`) until each piece is flat within
 * `tolerance`. The sample at `t0` is never re-pushed by the caller — each
 * recursive half only emits its own end sample — so the segment boundary
 * contributes exactly one sample per call site.
 */
function flattenCubic(
	p0: Vec,
	p1: Vec,
	p2: Vec,
	p3: Vec,
	tolerance: number,
	depth: number,
	lengthSoFar: number,
	out: FlatPoint[],
): number {
	if (
		depth >= MAX_SUBDIVISION_DEPTH ||
		chordDeviation(p0, p1, p2, p3) <= tolerance
	) {
		const nextLength = lengthSoFar + distance(p0, p3);
		out.push({ x: p3.x, y: p3.y, s: nextLength });
		return nextLength;
	}

	// De Casteljau split at t = 0.5.
	const p01 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
	const p12 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
	const p23 = { x: (p2.x + p3.x) / 2, y: (p2.y + p3.y) / 2 };
	const p012 = { x: (p01.x + p12.x) / 2, y: (p01.y + p12.y) / 2 };
	const p123 = { x: (p12.x + p23.x) / 2, y: (p12.y + p23.y) / 2 };
	const mid = { x: (p012.x + p123.x) / 2, y: (p012.y + p123.y) / 2 };

	const leftLength = flattenCubic(
		p0,
		p01,
		p012,
		mid,
		tolerance,
		depth + 1,
		lengthSoFar,
		out,
	);
	return flattenCubic(
		mid,
		p123,
		p23,
		p3,
		tolerance,
		depth + 1,
		leftLength,
		out,
	);
}

/**
 * Unit perpendicular of a secant direction, rotated -90° (`{x: dy, y: -dx}`)
 * to match the same rotation convention as the rest of this module. Returns
 * `null` for a zero-length secant (duplicate consecutive points) so the
 * caller can fill it from a neighbor instead of guessing a direction.
 */
function secantNormal(from: Vec, to: Vec): Vec | null {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const length = Math.hypot(dx, dy);
	if (length <= DIRECTION_EPSILON) return null;
	return { x: dy / length, y: -dx / length };
}

/**
 * Assigns each flattened point a unit normal from the polyline's own secants:
 * `direction[i] = normalize(points[i+1] - points[i-1])` for interior points,
 * one-sided (`points[1]-points[0]` / `points[n-1]-points[n-2]`) at the two
 * ends. This is deliberately independent of the analytic cubic tangent — see
 * the module doc comment for why.
 *
 * A zero-length secant (duplicate consecutive points collapsed by flattening
 * onto the same spot) inherits the nearest neighbor's resolved normal, first
 * scanning forward, then backward. The `{1, 0}` placeholder only surfaces if
 * every secant in the run is zero-length, which means the whole flattened
 * run is a single repeated point — already filtered out upstream by
 * `sampleSpine`'s post-flatten `runningLength` check, so it is a
 * can't-happen fallback here, not a real code path for valid input.
 */
function assignSecantNormals(points: readonly FlatPoint[]): SpineSample[] {
	const count = points.length;
	const normals: Array<Vec | null> = new Array(count).fill(null);

	for (let index = 0; index < count; index += 1) {
		const from = points[Math.max(0, index - 1)];
		const to = points[Math.min(count - 1, index + 1)];
		normals[index] = secantNormal(from, to);
	}

	// Forward-fill, then backward-fill, so a zero-length secant borrows the
	// nearest resolved neighbor rather than falling straight to the placeholder.
	for (let index = 1; index < count; index += 1) {
		if (!normals[index]) normals[index] = normals[index - 1];
	}
	for (let index = count - 2; index >= 0; index -= 1) {
		if (!normals[index]) normals[index] = normals[index + 1];
	}

	return points.map((point, index) => {
		const normal = normals[index] ?? { x: 1, y: 0 };
		return { x: point.x, y: point.y, s: point.s, nx: normal.x, ny: normal.y };
	});
}

/**
 * Adaptively flattens every cubic segment of `shape` (vertex/outTangent →
 * next-vertex/inTangent, AE-convention offsets relative to their vertex) into
 * arc-length-parameterized samples with unit normals.
 *
 * Segment count follows {@link AeShape.closed}: open shapes have
 * `vertices.length - 1` segments, closed shapes wrap one more back to vertex 0.
 * A shape with fewer than 2 vertices (nothing to trace) or whose total arc
 * length collapses to ~0 (a degenerate, zero-length input) returns an empty
 * array — there is no meaningful spine to sample.
 */
export function sampleSpine(
	shape: AeShape,
	tolerance: number = SPINE_FLATNESS_TOLERANCE,
): SpineSample[] {
	if (shape.vertices.length < 2) return [];

	const segmentCount = shape.closed
		? shape.vertices.length
		: shape.vertices.length - 1;

	const points: FlatPoint[] = [];
	const first = toVec(shape.vertices[0]);
	points.push({ x: first.x, y: first.y, s: 0 });

	let runningLength = 0;
	for (let segment = 0; segment < segmentCount; segment += 1) {
		const startIndex = segment;
		const endIndex = (segment + 1) % shape.vertices.length;
		const p0 = toVec(shape.vertices[startIndex]);
		const p1 = add(p0, toVec(shape.outTangents[startIndex]));
		const p3 = toVec(shape.vertices[endIndex]);
		const p2 = add(p3, toVec(shape.inTangents[endIndex]));

		runningLength = flattenCubic(
			p0,
			p1,
			p2,
			p3,
			tolerance,
			0,
			runningLength,
			points,
		);
	}

	if (runningLength <= DIRECTION_EPSILON) return [];
	return assignSecantNormals(points);
}
