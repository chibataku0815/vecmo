import type { BezierShape, Vec2 } from "@/entities/scene/model/types";
import type { AePoint } from "@/shared/glammer/ae-shape";
import {
	type PressureSample,
	pressureSamplesToProfile,
} from "@/shared/stroke/resample";
import type { StrokeWidthProfileStop } from "@/shared/stroke/width-profile";

/**
 * Pure freehand-stroke geometry: turns the raw pointer samples a pencil drag
 * collects into a smooth {@link BezierShape}. Kept out of the canvas handler so
 * the simplify/smooth math (the branchy, easy-to-break part) is unit-testable
 * without the DOM or any store.
 *
 * Coordinates are artboard-local units — the same space the pen tool authors in
 * — so the result serializes straight into scene geometry. The pipeline is
 * intentionally two-stage:
 *   1. {@link simplifyPath} thins the dense, jittery sample list (Ramer–Douglas–
 *      Peucker) down to the vertices that carry the stroke's shape.
 *   2. {@link freehandStrokeToShape} fits smooth cubic tangents through those
 *      survivors so the committed path reads as a hand-drawn curve, not a
 *      polyline.
 *
 * Every output number is finite by construction: the only division is by a
 * tangent direction's length, and a zero-length direction short-circuits to a
 * zero handle, so degenerate input (a single point, repeated points, a perfectly
 * straight or doubled-back stroke) can never produce NaN/Infinity.
 */

/**
 * A raw freehand sample: an artboard-local point, plus the pen pressure at
 * that point when the input device reported one. `pressure` is left
 * `undefined` for mouse/touch input (never a synthesized constant) so
 * {@link freehandStrokeToWidthProfile} can tell "no pressure signal" apart
 * from "pressure was exactly this value".
 */
export type FreehandPoint = Vec2 & {
	readonly pressure?: number;
};

/** Cubic Bézier "one third of the segment" handle scale (de Casteljau). */
const BEZIER_HANDLE_RATIO = 1 / 3;
/** Default smoothing strength; 1 keeps the classic third-of-segment handle. */
const DEFAULT_SMOOTHING = 1;
/**
 * Consecutive samples closer than this (artboard-local units) collapse to one.
 * Purely a finiteness/zero-length-segment guard — real thinning is RDP's job, so
 * this stays tiny and is not the simplification tolerance.
 */
const DEDUPE_EPSILON = 1e-3;
/** A stroke needs at least a start and an end to describe a curve. */
const MIN_VERTICES = 2;

/**
 * Builds a tangent offset, folding IEEE negative zero to positive zero. A
 * zero-length handle on an open endpoint (or an axis-aligned direction) computes
 * `-unit * 0 === -0`; that serializes as `"0"` anyway, but keeping it `+0` makes
 * the stored geometry and equality checks predictable.
 */
const tangent = (x: number, y: number): AePoint => [
	x === 0 ? 0 : x,
	y === 0 ? 0 : y,
];

export type FreehandSmoothOptions = {
	/**
	 * RDP perpendicular-distance tolerance in artboard-local units. Larger values
	 * keep fewer vertices (smoother, looser); callers convert a screen-pixel
	 * budget through the current zoom so the feel is constant on screen.
	 */
	readonly simplifyTolerance: number;
	/**
	 * Handle-length multiplier in [0, ∞); 1 (default) yields a third-of-segment
	 * handle. 0 produces straight segments between vertices (corners preserved).
	 */
	readonly smoothing?: number;
};

/**
 * Perpendicular distance from `point` to the infinite line through `a`→`b`. When
 * `a` and `b` coincide the line is undefined, so it falls back to the point
 * distance — keeping the RDP recursion finite on a zero-length span.
 */
function perpendicularDistance(point: Vec2, a: Vec2, b: Vec2): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const lineLength = Math.hypot(dx, dy);
	if (lineLength === 0) return Math.hypot(point.x - a.x, point.y - a.y);
	const cross = Math.abs(dx * (a.y - point.y) - dy * (a.x - point.x));
	return cross / lineLength;
}

/**
 * Drops consecutive samples within {@link DEDUPE_EPSILON} so neither RDP nor the
 * tangent fit ever sees a zero-length segment. The first and last surviving
 * samples are always preserved.
 */
function dedupeAdjacent(points: readonly Vec2[]): Vec2[] {
	const result: Vec2[] = [];
	for (const point of points) {
		const previous = result[result.length - 1];
		if (
			previous &&
			Math.hypot(point.x - previous.x, point.y - previous.y) <= DEDUPE_EPSILON
		) {
			continue;
		}
		result.push(point);
	}
	return result;
}

/**
 * Ramer–Douglas–Peucker polyline simplification. Returns the subset of `points`
 * (endpoints always kept) whose removal would not move the path by more than
 * `tolerance`. Iterative (explicit stack) so a long, busy stroke cannot blow the
 * call stack on large documents.
 *
 * A non-positive `tolerance`, or a path already at/under {@link MIN_VERTICES},
 * returns a copy unchanged.
 */
export function simplifyPath(
	points: readonly Vec2[],
	tolerance: number,
): Vec2[] {
	if (points.length <= MIN_VERTICES || tolerance <= 0) return [...points];

	const keep = Array.from({ length: points.length }, () => false);
	keep[0] = true;
	keep[points.length - 1] = true;

	const stack: Array<readonly [number, number]> = [[0, points.length - 1]];
	while (stack.length > 0) {
		const span = stack.pop();
		if (!span) continue;
		const [start, end] = span;
		if (end - start < 2) continue;

		let maxDistance = 0;
		let maxIndex = -1;
		for (let index = start + 1; index < end; index += 1) {
			const distance = perpendicularDistance(
				points[index],
				points[start],
				points[end],
			);
			if (distance > maxDistance) {
				maxDistance = distance;
				maxIndex = index;
			}
		}

		if (maxIndex !== -1 && maxDistance > tolerance) {
			keep[maxIndex] = true;
			stack.push([start, maxIndex]);
			stack.push([maxIndex, end]);
		}
	}

	return points.filter((_, index) => keep[index]);
}

/** Total length of the raw polyline; used by callers to reject click-sized strokes. */
export function strokeLength(points: readonly Vec2[]): number {
	let total = 0;
	for (let index = 1; index < points.length; index += 1) {
		total += Math.hypot(
			points[index].x - points[index - 1].x,
			points[index].y - points[index - 1].y,
		);
	}
	return total;
}

/**
 * Fits smooth cubic tangents through `points` and returns an open
 * {@link BezierShape}. Each vertex's handle points along the normalized neighbour
 * direction (`next − prev`), with the incoming/outgoing handle lengths scaled to
 * the *adjacent* segment lengths and capped at a third of each. That cap is the
 * anti-runaway guarantee: the handle tip never reaches the next vertex, so the
 * curve stays bounded and every output stays finite. It is not a no-overshoot
 * guarantee — on a sharp or asymmetric corner the `next − prev` direction runs
 * near-perpendicular to the legs, so the curve can swing wide or bulge slightly
 * past the anchor (a *bounded* overshoot, no self-intersection in practice).
 * Endpoints reuse a clamped neighbour, giving a one-sided handle on the open ends.
 *
 * Tangents follow the AeShape offset convention (relative to the anchor): the
 * out tangent is the offset to the forward control point, the in tangent the
 * offset to the backward one — matching {@link BezierShape} so the host renderer
 * and motion sampler consume the result with no translation.
 */
function fitSmoothShape(
	points: readonly Vec2[],
	smoothing: number,
): BezierShape {
	const count = points.length;
	const vertices: AePoint[] = points.map(
		(point): AePoint => [point.x, point.y],
	);
	const inTangents: AePoint[] = [];
	const outTangents: AePoint[] = [];

	for (let index = 0; index < count; index += 1) {
		const current = points[index];
		const previous = points[Math.max(0, index - 1)];
		const next = points[Math.min(count - 1, index + 1)];

		const dirX = next.x - previous.x;
		const dirY = next.y - previous.y;
		const dirLength = Math.hypot(dirX, dirY);
		if (dirLength === 0) {
			inTangents.push([0, 0]);
			outTangents.push([0, 0]);
			continue;
		}
		const unitX = dirX / dirLength;
		const unitY = dirY / dirLength;

		const inSegment =
			index > 0
				? Math.hypot(current.x - previous.x, current.y - previous.y)
				: 0;
		const outSegment =
			index < count - 1
				? Math.hypot(next.x - current.x, next.y - current.y)
				: 0;
		const inLength = inSegment * smoothing * BEZIER_HANDLE_RATIO;
		const outLength = outSegment * smoothing * BEZIER_HANDLE_RATIO;

		inTangents.push(tangent(-unitX * inLength, -unitY * inLength));
		outTangents.push(tangent(unitX * outLength, unitY * outLength));
	}

	return { type: "Shape", closed: false, vertices, inTangents, outTangents };
}

/**
 * Full freehand pipeline: dedupe → {@link simplifyPath} → {@link fitSmoothShape}.
 * Returns null when the stroke is too short to describe a path (a click, or a
 * jiggle that collapses below {@link MIN_VERTICES} after thinning), so the caller
 * can skip minting a degenerate node.
 */
export function freehandStrokeToShape(
	rawPoints: readonly Vec2[],
	options: FreehandSmoothOptions,
): BezierShape | null {
	const deduped = dedupeAdjacent(rawPoints);
	if (deduped.length < MIN_VERTICES) return null;
	const simplified = simplifyPath(deduped, options.simplifyTolerance);
	if (simplified.length < MIN_VERTICES) return null;
	return fitSmoothShape(simplified, options.smoothing ?? DEFAULT_SMOOTHING);
}

/**
 * Derives a stroke width profile from the RAW captured freehand samples
 * (before {@link dedupeAdjacent}/{@link simplifyPath} thin them), so the
 * profile's arc-length parameterization matches what the pen actually traced
 * rather than the post-RDP vertex subset.
 *
 * Returns `null` — meaning "attach no profile, keep the node's uniform
 * `strokeWidth`" — when any of:
 * - fewer than 2 points were captured,
 * - any point lacks a `pressure` reading (mouse, touch, or a mixed capture),
 * - the polyline's total arc length is ~0 (a click-sized stroke), or
 * - {@link pressureSamplesToProfile} itself returns `null` (e.g. the pressure
 *   signal is near-constant, so there is nothing to encode).
 *
 * A point lacking pressure is treated as "give up entirely" rather than
 * "skip that sample": a partial capture (e.g. the OS drops pressure mid-
 * stroke) would otherwise silently reparameterize arc length over fewer
 * points than were actually drawn, which is worse than no profile at all.
 */
export function freehandStrokeToWidthProfile(
	rawPoints: readonly FreehandPoint[],
): readonly StrokeWidthProfileStop[] | null {
	if (rawPoints.length < MIN_VERTICES) return null;

	const samples: PressureSample[] = [];
	let cumulative = 0;
	for (let index = 0; index < rawPoints.length; index += 1) {
		const point = rawPoints[index];
		if (point.pressure === undefined) return null;
		if (index > 0) {
			const previous = rawPoints[index - 1];
			cumulative += Math.hypot(point.x - previous.x, point.y - previous.y);
		}
		samples.push({ s: cumulative, pressure: point.pressure });
	}

	const totalLength = cumulative;
	if (!(totalLength > 0)) return null;

	return pressureSamplesToProfile(samples, totalLength);
}
