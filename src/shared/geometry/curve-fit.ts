import type { AePoint, AeShape } from "@/shared/glammer/ae-shape";

/**
 * Corner-preserving cubic re-fit for Boolean path output.
 *
 * Boolean operations flatten curved sources to dense polygons, run the clip on
 * those polygons, then would emit a straight-line result that throws the
 * original curvature away. This module re-fits editable cubic Bézier segments
 * onto the flattened result so a union of two circles reads as smooth arcs
 * joined at the two intersection corners — not a faceted ring of line vertices.
 *
 * Fidelity rests on **corner provenance**: the caller supplies the exact set of
 * hard-corner positions — source/source boundary intersections (where the
 * result boundary generically turns) plus genuine sharp source vertices. A
 * result vertex that matches a corner position breaks the fit; every other
 * vertex is a smooth sample fed to a Schneider-style recursive cubic fitter.
 * Because a *missed* corner rounds a sharp feature (a visible regression) while
 * an *extra* corner only adds a negligible kink, classification is deliberately
 * corner-biased: when matching is ambiguous, the vertex stays a corner.
 *
 * The module never invents fidelity. Degenerate runs (collinear, sub-triangle)
 * fall back to straight segments, and any non-finite intermediate aborts the fit
 * so the caller keeps the honest polygon rather than emit NaN tangents.
 */

type Vec = { readonly x: number; readonly y: number };

type Cubic = {
	readonly p0: Vec;
	readonly c1: Vec;
	readonly c2: Vec;
	readonly p3: Vec;
};

export type CurveFitOptions = {
	/** Max allowed deviation of a sample from its fitted cubic, in scene units. */
	readonly tolerance?: number;
	/**
	 * Multiplier for the adaptive default tolerance. Values below 1 preserve more
	 * anchors; values above 1 simplify the fitted output.
	 */
	readonly toleranceScale?: number;
	/** Distance under which a result vertex counts as a supplied corner. */
	readonly matchEpsilon?: number;
};

const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
const lengthOf = (a: Vec): number => Math.hypot(a.x, a.y);
const distance = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
const isFiniteVec = (a: Vec): boolean =>
	Number.isFinite(a.x) && Number.isFinite(a.y);

const ZERO_LENGTH_EPSILON = 1e-9;

const normalize = (a: Vec): Vec => {
	const length = lengthOf(a);
	if (length <= ZERO_LENGTH_EPSILON) return { x: 0, y: 0 };
	return { x: a.x / length, y: a.y / length };
};

const negate = (a: Vec): Vec => ({ x: -a.x, y: -a.y });

const toVec = (point: Vec): Vec => ({ x: point.x, y: point.y });
const toAePoint = (a: Vec): AePoint => [a.x, a.y];

/** Forward heading at ring vertex `index` from its neighbouring chords. */
const centeredTangent = (ring: readonly Vec[], index: number): Vec => {
	const count = ring.length;
	const next = ring[(index + 1) % count];
	const previous = ring[(index - 1 + count) % count];
	return normalize(sub(next, previous));
};

/** Cubic Bézier position at parameter `t`. */
const cubicAt = (curve: Cubic, t: number): Vec => {
	const mt = 1 - t;
	const a = mt * mt * mt;
	const b = 3 * mt * mt * t;
	const c = 3 * mt * t * t;
	const d = t * t * t;
	return {
		x: a * curve.p0.x + b * curve.c1.x + c * curve.c2.x + d * curve.p3.x,
		y: a * curve.p0.y + b * curve.c1.y + c * curve.c2.y + d * curve.p3.y,
	};
};

/** Chord-length parameterisation in [0, 1] for a smooth run of samples. */
const chordParameters = (points: readonly Vec[]): number[] => {
	const params: number[] = [0];
	for (let index = 1; index < points.length; index += 1) {
		params.push(params[index - 1] + distance(points[index], points[index - 1]));
	}
	const total = params.at(-1) ?? 0;
	if (total <= ZERO_LENGTH_EPSILON)
		return points.map((_, index) => index / Math.max(1, points.length - 1));
	return params.map((value) => value / total);
};

const BERNSTEIN_DEGREE = 3;

/**
 * Least-squares fit of one cubic to `points` with fixed unit endpoint tangents
 * (`leftTangent` leaving the start, `rightTangent` entering the end). Solves the
 * 2×2 system for the two handle magnitudes (Graphics Gems "generateBezier"),
 * falling back to a chord-third heuristic when the system is degenerate or yields
 * a non-positive magnitude.
 */
const fitSingleCubic = (
	points: readonly Vec[],
	params: readonly number[],
	leftTangent: Vec,
	rightTangent: Vec,
): Cubic => {
	const first = points[0];
	const last = points[points.length - 1];
	let c00 = 0;
	let c01 = 0;
	let c11 = 0;
	let x0 = 0;
	let x1 = 0;

	for (let index = 0; index < points.length; index += 1) {
		const t = params[index];
		const mt = 1 - t;
		const b0 = mt * mt * mt;
		const b1 = BERNSTEIN_DEGREE * mt * mt * t;
		const b2 = BERNSTEIN_DEGREE * mt * t * t;
		const b3 = t * t * t;
		const a1 = scale(leftTangent, b1);
		const a2 = scale(rightTangent, b2);
		c00 += dot(a1, a1);
		c01 += dot(a1, a2);
		c11 += dot(a2, a2);
		const endpointPart = add(scale(first, b0 + b1), scale(last, b2 + b3));
		const residual = sub(points[index], endpointPart);
		x0 += dot(a1, residual);
		x1 += dot(a2, residual);
	}

	const determinant = c00 * c11 - c01 * c01;
	const chordThird = distance(first, last) / 3;
	let alpha1 = chordThird;
	let alpha2 = chordThird;
	if (Math.abs(determinant) > ZERO_LENGTH_EPSILON) {
		alpha1 = (x0 * c11 - x1 * c01) / determinant;
		alpha2 = (c00 * x1 - c01 * x0) / determinant;
	}
	const minMagnitude = distance(first, last) * 1e-3;
	if (!(alpha1 > minMagnitude) || !(alpha2 > minMagnitude)) {
		alpha1 = chordThird;
		alpha2 = chordThird;
	}

	return {
		p0: first,
		c1: add(first, scale(leftTangent, alpha1)),
		c2: add(last, scale(rightTangent, alpha2)),
		p3: last,
	};
};

/** Largest sample deviation from `curve`, with the offending sample index. */
const maxDeviation = (
	curve: Cubic,
	points: readonly Vec[],
	params: readonly number[],
): { readonly error: number; readonly index: number } => {
	let error = 0;
	let index = Math.floor(points.length / 2);
	for (let i = 1; i < points.length - 1; i += 1) {
		const deviation = distance(cubicAt(curve, params[i]), points[i]);
		if (deviation > error) {
			error = deviation;
			index = i;
		}
	}
	return { error, index };
};

const lineCubic = (start: Vec, end: Vec): Cubic => ({
	p0: start,
	c1: start,
	c2: end,
	p3: end,
});

const MAX_FIT_DEPTH = 24;

/** Forward heading at an interior sample of an open run. */
const centeredTangentOpen = (points: readonly Vec[], index: number): Vec => {
	const next = points[Math.min(index + 1, points.length - 1)];
	const previous = points[Math.max(index - 1, 0)];
	return normalize(sub(next, previous));
};

/**
 * Recursively fits cubics to an open smooth run, subdividing at the highest-error
 * sample until every piece sits within `tolerance`. Endpoint tangent directions
 * are fixed by the caller so adjacent runs meet exactly at shared corners.
 */
const fitRun = (
	points: readonly Vec[],
	leftTangent: Vec,
	rightTangent: Vec,
	tolerance: number,
	depth: number,
): Cubic[] => {
	if (points.length <= 2) {
		return [lineCubic(points[0], points[points.length - 1])];
	}
	const params = chordParameters(points);
	const curve = fitSingleCubic(points, params, leftTangent, rightTangent);
	const { error, index } = maxDeviation(curve, points, params);
	if (error <= tolerance || depth >= MAX_FIT_DEPTH) return [curve];

	const splitTangent = centeredTangentOpen(points, index);
	const left = fitRun(
		points.slice(0, index + 1),
		leftTangent,
		negate(splitTangent),
		tolerance,
		depth + 1,
	);
	const right = fitRun(
		points.slice(index),
		splitTangent,
		rightTangent,
		tolerance,
		depth + 1,
	);
	return [...left, ...right];
};

const cornerMatcher =
	(cornerPoints: readonly Vec[], matchEpsilon: number) =>
	(point: Vec): boolean =>
		cornerPoints.some((corner) => distance(corner, point) <= matchEpsilon);

const boundsDiagonal = (points: readonly Vec[]): number => {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const point of points) {
		minX = Math.min(minX, point.x);
		minY = Math.min(minY, point.y);
		maxX = Math.max(maxX, point.x);
		maxY = Math.max(maxY, point.y);
	}
	return Math.hypot(maxX - minX, maxY - minY);
};

const TOLERANCE_RATIO = 0.0015;
const TOLERANCE_MIN = 0.1;
const TOLERANCE_MAX = 1.5;
const MATCH_RATIO = 1e-6;
const MATCH_MIN = 1e-3;

/** Indices of `ring` vertices that match a supplied corner position. */
const cornerIndices = (
	ring: readonly Vec[],
	isCorner: (point: Vec) => boolean,
): number[] => {
	const indices: number[] = [];
	for (let index = 0; index < ring.length; index += 1) {
		if (isCorner(ring[index])) indices.push(index);
	}
	return indices;
};

/** Inclusive slice of a closed ring from `start` to `end`, wrapping if needed. */
const ringSlice = (ring: readonly Vec[], start: number, end: number): Vec[] => {
	const run: Vec[] = [];
	let index = start;
	while (true) {
		run.push(ring[index]);
		if (index === end) break;
		index = (index + 1) % ring.length;
	}
	return run;
};

/** Builds a closed run between two corner indices and fits cubics through it. */
const fitCornerRun = (
	ring: readonly Vec[],
	start: number,
	end: number,
	tolerance: number,
): Cubic[] => {
	const run = ringSlice(ring, start, end);
	if (run.length <= 2) return [lineCubic(run[0], run[run.length - 1])];
	const leftTangent = normalize(sub(run[1], run[0]));
	const rightTangent = normalize(sub(run[run.length - 2], run[run.length - 1]));
	return fitRun(run, leftTangent, rightTangent, tolerance, 0);
};

/** Fits a corner-free closed loop by splitting it into two G1-joined halves. */
const fitSmoothLoop = (ring: readonly Vec[], tolerance: number): Cubic[] => {
	const count = ring.length;
	const mid = Math.floor(count / 2);
	const startTangent = centeredTangent(ring, 0);
	const midTangent = centeredTangent(ring, mid);
	const firstHalf = fitRun(
		ringSlice(ring, 0, mid),
		startTangent,
		negate(midTangent),
		tolerance,
		0,
	);
	const secondHalf = fitRun(
		ringSlice(ring, mid, 0),
		midTangent,
		negate(startTangent),
		tolerance,
		0,
	);
	return [...firstHalf, ...secondHalf];
};

/** Assembles an ordered, continuous cubic chain into a closed editable AeShape. */
const cubicsToShape = (cubics: readonly Cubic[]): AeShape | null => {
	if (cubics.length === 0) return null;
	const vertices: AePoint[] = [];
	const inTangents: AePoint[] = [];
	const outTangents: AePoint[] = [];
	for (let index = 0; index < cubics.length; index += 1) {
		const current = cubics[index];
		const previous = cubics[(index - 1 + cubics.length) % cubics.length];
		const anchor = current.p0;
		const outTangent = sub(current.c1, anchor);
		const inTangent = sub(previous.c2, anchor);
		if (
			!isFiniteVec(anchor) ||
			!isFiniteVec(outTangent) ||
			!isFiniteVec(inTangent)
		) {
			return null;
		}
		vertices.push(toAePoint(anchor));
		outTangents.push(toAePoint(outTangent));
		inTangents.push(toAePoint(inTangent));
	}
	// A 2-anchor closed shape is valid: a lens/vesica (two arcs meeting at two
	// corners, e.g. the overlap of two circles). Only 0/1-anchor results are degenerate.
	if (vertices.length < 2) return null;
	return { type: "Shape", closed: true, vertices, inTangents, outTangents };
};

/**
 * Re-fits the flattened Boolean output `contour` into a closed editable AeShape
 * with corner-preserving cubic Béziers. `cornerPoints` are the hard-corner
 * positions (source intersections + sharp source vertices) that must stay sharp.
 * Returns `null` when the contour is too small to fit or the fit produced a
 * non-finite control point, so the caller can keep the straight-line fallback.
 */
export function fitClosedContour(
	contour: readonly Vec[],
	cornerPoints: readonly Vec[],
	options: CurveFitOptions = {},
): AeShape | null {
	if (contour.length < 3) return null;
	const ring = contour.map(toVec);
	if (!ring.every(isFiniteVec)) return null;

	const diagonal = boundsDiagonal(ring);
	const toleranceScale = Number.isFinite(options.toleranceScale)
		? Math.min(6, Math.max(0.1, options.toleranceScale ?? 1))
		: 1;
	const baseTolerance = Math.min(
		TOLERANCE_MAX,
		Math.max(TOLERANCE_MIN, diagonal * TOLERANCE_RATIO),
	);
	const tolerance = options.tolerance ?? baseTolerance * toleranceScale;
	const matchEpsilon =
		options.matchEpsilon ?? Math.max(MATCH_MIN, diagonal * MATCH_RATIO);

	const isCorner = cornerMatcher(cornerPoints.map(toVec), matchEpsilon);
	const corners = cornerIndices(ring, isCorner);

	const cubics =
		corners.length === 0
			? fitSmoothLoop(ring, tolerance)
			: corners.flatMap((cornerIndex, position) =>
					fitCornerRun(
						ring,
						cornerIndex,
						corners[(position + 1) % corners.length],
						tolerance,
					),
				);

	return cubicsToShape(cubics);
}

/**
 * All pairwise segment intersections between the supplied flattened source
 * polygons. These are exactly the points where the Boolean result switches from
 * tracing one source to another — generic hard corners that must survive re-fit.
 */
export function sourceIntersectionPoints(
	polygons: readonly (readonly Vec[])[],
): Vec[] {
	const points: Vec[] = [];
	for (let a = 0; a < polygons.length; a += 1) {
		for (let b = a + 1; b < polygons.length; b += 1) {
			collectIntersections(polygons[a], polygons[b], points);
		}
	}
	return points;
}

const INTERSECTION_EPSILON = 1e-9;

const collectIntersections = (
	subject: readonly Vec[],
	clip: readonly Vec[],
	out: Vec[],
): void => {
	for (let i = 0; i < subject.length; i += 1) {
		const a0 = toVec(subject[i]);
		const a1 = toVec(subject[(i + 1) % subject.length]);
		for (let j = 0; j < clip.length; j += 1) {
			const b0 = toVec(clip[j]);
			const b1 = toVec(clip[(j + 1) % clip.length]);
			const point = segmentCross(a0, a1, b0, b1);
			if (point) out.push(point);
		}
	}
};

const segmentCross = (a0: Vec, a1: Vec, b0: Vec, b1: Vec): Vec | null => {
	const r = sub(a1, a0);
	const s = sub(b1, b0);
	const denominator = r.x * s.y - r.y * s.x;
	if (Math.abs(denominator) <= INTERSECTION_EPSILON) return null;
	const qp = sub(b0, a0);
	const t = (qp.x * s.y - qp.y * s.x) / denominator;
	const u = (qp.x * r.y - qp.y * r.x) / denominator;
	if (t < -INTERSECTION_EPSILON || t > 1 + INTERSECTION_EPSILON) return null;
	if (u < -INTERSECTION_EPSILON || u > 1 + INTERSECTION_EPSILON) return null;
	return { x: a0.x + r.x * t, y: a0.y + r.y * t };
};
