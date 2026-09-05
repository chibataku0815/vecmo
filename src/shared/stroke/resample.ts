import {
	type StrokeWidthProfileStop,
	validateStrokeWidthProfile,
} from "@/shared/stroke/width-profile";

/**
 * Converts raw Apple Pencil pressure samples collected along a drawn stroke
 * into a {@link StrokeWidthProfileStop} profile: normalize arc length, map
 * pressure to a width multiplier, then simplify to a handful of stops via
 * Ramer–Douglas–Peucker so a dense capture (dozens of samples per stroke)
 * survives serialization as a compact, editable profile.
 *
 * Near-constant pressure (a mouse/trackpad stroke, or a pencil held at fixed
 * force) intentionally yields `null` rather than a flat profile — callers
 * should keep the node's uniform `strokeWidth` in that case rather than carry
 * a profile that does nothing.
 */

/** One raw pressure reading along a drawn stroke. */
export interface PressureSample {
	/** Arc length from the stroke's start, in the same units as `totalLength`. */
	readonly s: number;
	/** Raw pressure reading, expected in [0, 1] (0 = no contact, 1 = max force). */
	readonly pressure: number;
}

/**
 * Floor for the width multiplier derived from pressure — even a
 * barely-touching sample keeps a sliver of visible width rather than
 * vanishing to 0.
 */
export const MIN_WIDTH_MULTIPLIER = 0.08;

/** Ceiling for the width multiplier; pressure never widens beyond the base stroke width. */
export const MAX_WIDTH_MULTIPLIER = 1;

/**
 * Minimum pressure variance for a stroke to be considered pressure-driven
 * (stddev ~0.03). Below this, the input reads as constant-force (mouse,
 * trackpad, or a pencil held steady) and the caller should fall back to a
 * uniform stroke width instead of a profile.
 */
const MIN_PRESSURE_VARIANCE = 0.0009;

/** RDP perpendicular-distance epsilon over the (t, w) curve, in multiplier units. */
const SIMPLIFY_EPSILON = 0.02;

/** Interior stops kept after simplification (excludes the forced t=0/t=1 endpoints). */
const MAX_INTERIOR_STOPS = 12;

type Stop = { readonly t: number; readonly w: number };

const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));

/** Population variance of `values`. */
function variance(values: readonly number[]): number {
	if (values.length === 0) return 0;
	const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
	const squaredDiffs = values.map((value) => (value - mean) ** 2);
	return squaredDiffs.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Perpendicular distance from `point` to the line through `a`→`b` in (t, w) space. */
function perpendicularDistance(point: Stop, a: Stop, b: Stop): number {
	const dt = b.t - a.t;
	const dw = b.w - a.w;
	const lineLength = Math.hypot(dt, dw);
	if (lineLength === 0) return Math.hypot(point.t - a.t, point.w - a.w);
	const cross = Math.abs(dt * (a.w - point.w) - dw * (a.t - point.t));
	return cross / lineLength;
}

/**
 * Ramer–Douglas–Peucker simplification over a (t, w) polyline, iterative
 * (explicit stack) so a long stroke cannot blow the call stack. Endpoints are
 * always kept; interior points survive only if omitting them would move the
 * curve by more than `tolerance`.
 */
function simplifyStops(points: readonly Stop[], tolerance: number): Stop[] {
	if (points.length <= 2) return [...points];

	const keep = points.map(() => false);
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

/**
 * Keeps at most {@link MAX_INTERIOR_STOPS} interior points, thinning evenly by
 * index when RDP alone leaves more (a very jittery capture can keep many
 * high-deviation points even at {@link SIMPLIFY_EPSILON}).
 */
function capInteriorStops(points: readonly Stop[]): Stop[] {
	const interior = points.slice(1, -1);
	if (interior.length <= MAX_INTERIOR_STOPS) return [...points];

	const first = points[0];
	const last = points[points.length - 1];
	const kept: Stop[] = [];
	for (let index = 0; index < MAX_INTERIOR_STOPS; index += 1) {
		const sourceIndex = Math.round(
			((index + 1) * (interior.length - 1)) / (MAX_INTERIOR_STOPS + 1),
		);
		kept.push(interior[sourceIndex]);
	}
	return [first, ...kept, last];
}

/** Drops points whose `t` does not strictly increase past the previous survivor. */
function dedupeByT(points: readonly Stop[]): Stop[] {
	const result: Stop[] = [];
	for (const point of points) {
		const previous = result[result.length - 1];
		if (previous && point.t <= previous.t) continue;
		result.push(point);
	}
	return result;
}

/**
 * Converts pressure samples collected along a stroke of arc length
 * `totalLength` into a simplified {@link StrokeWidthProfileStop} profile.
 *
 * Returns `null` when:
 * - fewer than 2 samples, or `totalLength` is not a positive finite number
 *   (nothing to normalize against),
 * - pressure variance is below {@link MIN_PRESSURE_VARIANCE} (constant-force
 *   input — no real pressure signal to encode), or
 * - the simplified result still fails {@link validateStrokeWidthProfile}
 *   (e.g. every sample collapsed to the same normalized position).
 */
export function pressureSamplesToProfile(
	samples: readonly PressureSample[],
	totalLength: number,
): readonly StrokeWidthProfileStop[] | null {
	if (samples.length < 2) return null;
	if (!(totalLength > 0) || !Number.isFinite(totalLength)) return null;

	const pressures = samples.map((sample) => sample.pressure);
	if (variance(pressures) < MIN_PRESSURE_VARIANCE) return null;

	const raw: Stop[] = samples
		.map((sample) => ({
			t: clamp(sample.s / totalLength, 0, 1),
			w: clamp(sample.pressure, MIN_WIDTH_MULTIPLIER, MAX_WIDTH_MULTIPLIER),
		}))
		.sort((a, b) => a.t - b.t);

	const deduped = dedupeByT(raw);
	if (deduped.length < 2) return null;

	const simplified = capInteriorStops(simplifyStops(deduped, SIMPLIFY_EPSILON));

	const forced: Stop[] = simplified.map((stop, index) => {
		if (index === 0) return { t: 0, w: stop.w };
		if (index === simplified.length - 1) return { t: 1, w: stop.w };
		return stop;
	});
	const result = dedupeByT(forced);
	if (result.length < 2) return null;

	return validateStrokeWidthProfile(result) === null ? result : null;
}
