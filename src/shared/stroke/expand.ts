import { fitClosedContour } from "@/shared/geometry/curve-fit";
import type { AeShape } from "@/shared/glammer/ae-shape";
import { type SpineSample, sampleSpine } from "@/shared/stroke/spine";
import {
	type StrokeWidthProfileStop,
	sampleWidthProfile,
	validateStrokeWidthProfile,
} from "@/shared/stroke/width-profile";

/**
 * Expands a variable-width stroked spine into a single closed, filled
 * {@link AeShape} outline: a "left rail" offset by `+normal * width/2` and a
 * "right rail" offset by `-normal * width/2`, joined by round end caps, then
 * re-fit to smooth cubics via {@link fitClosedContour}. Renderers that cannot
 * paint a variable-width stroke natively draw this outline as a plain fill.
 *
 * v1 scope is open spines only — see {@link expandStrokeWidthProfile}.
 */

export interface ExpandStrokeOptions {
	/** The stroked spine to expand; must be open (`closed === false`). */
	readonly shape: AeShape;
	/** Base stroke width in doc units; the profile scales this per-position. */
	readonly strokeWidth: number;
	/** Width multiplier stops sampled by normalized arc-length position. */
	readonly profile: readonly StrokeWidthProfileStop[];
	/** Optional override forwarded to {@link fitClosedContour}'s `tolerance`. */
	readonly fitTolerance?: number;
}

type Point = { readonly x: number; readonly y: number };

/** Points per sampled semicircle end cap. */
const CAP_SEGMENT_COUNT = 8;

/**
 * Below this half-width (doc units) an end cap collapses to a single point
 * (a sharp taper tip) instead of a sampled semicircle — a true zero/near-zero
 * width cap has no meaningful radius to sample.
 */
const MIN_CAP_WIDTH = 0.1;

/**
 * Below this arc-length gap (doc units) an inserted profile-stop sample is
 * considered a duplicate of an existing spine sample and skipped, so a stop
 * that lands exactly on (or a hair from) a flattened vertex does not add a
 * redundant near-zero-length rail segment.
 */
const STOP_INSERTION_EPSILON = 1e-6;

/**
 * Inserts one extra spine sample at each interior profile stop's arc-length
 * position (`s_k = t_k * totalLength`), so straight/low-curvature runs — which
 * {@link sampleSpine} flattens to as few as 2 points, since flattening only
 * subdivides for *geometric* curvature — still get a rail point wherever the
 * width profile itself changes. Without this, a stop between two flattened
 * samples is invisible to the rail builder: `widthAt` is only ever queried at
 * existing sample arc lengths, so an interior bulge or pinch in the profile
 * never reaches the offset rails on a straight stroke.
 *
 * Each inserted sample's position is linearly interpolated along the flattened
 * segment that contains `s_k` (valid because that segment is already flat
 * within the flattening tolerance — a straight-line lerp is not an
 * approximation there, it is the segment), and its normal is the containing
 * segment's own secant normal, independent of the neighboring samples' stored
 * normals. Stops within {@link STOP_INSERTION_EPSILON} arc length of an
 * existing sample are skipped as duplicates. Boundary stops (`t <= 0` or
 * `t >= 1`) are skipped — the spine's own start/end samples already cover them.
 */
function insertProfileStopSamples(
	spine: readonly SpineSample[],
	profile: readonly StrokeWidthProfileStop[],
	totalLength: number,
): SpineSample[] {
	const interiorArcLengths = profile
		.map((stop) => stop.t * totalLength)
		.filter((s) => s > 0 && s < totalLength);

	const result: SpineSample[] = [...spine];
	for (const targetLength of interiorArcLengths) {
		const containingIndex = result.findIndex(
			(_sample, index) =>
				index < result.length - 1 &&
				targetLength >= result[index].s &&
				targetLength <= result[index + 1].s,
		);
		if (containingIndex === -1) continue;

		const segmentStart = result[containingIndex];
		const segmentEnd = result[containingIndex + 1];
		if (
			targetLength - segmentStart.s <= STOP_INSERTION_EPSILON ||
			segmentEnd.s - targetLength <= STOP_INSERTION_EPSILON
		) {
			continue;
		}

		const span = segmentEnd.s - segmentStart.s;
		const local = span > 0 ? (targetLength - segmentStart.s) / span : 0;
		const normal = secantNormalOf(segmentStart, segmentEnd);
		result.splice(containingIndex + 1, 0, {
			x: segmentStart.x + (segmentEnd.x - segmentStart.x) * local,
			y: segmentStart.y + (segmentEnd.y - segmentStart.y) * local,
			s: targetLength,
			nx: normal.x,
			ny: normal.y,
		});
	}
	return result;
}

/**
 * Unit perpendicular (rotated -90°) of the straight-line direction between
 * two spine samples — the containing segment's own secant, used for a
 * profile-stop sample inserted along it. A zero-length segment cannot occur
 * here in practice (the caller only reaches this once the target arc length
 * sits strictly inside the segment's arc-length span, and arc length is
 * never shorter than straight-line distance), but falls back to a `{1, 0}`
 * placeholder rather than a NaN direction if it ever did.
 */
function secantNormalOf(
	from: { readonly x: number; readonly y: number },
	to: { readonly x: number; readonly y: number },
): Point {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const length = Math.hypot(dx, dy);
	if (length <= STOP_INSERTION_EPSILON) return { x: 1, y: 0 };
	return { x: dy / length, y: -dx / length };
}

/**
 * Semicircle points from `start` to `end` (both at radius `radius` from
 * `center`), stepping through the half-turn on the side of `outward`. Used to
 * cap a rail pair with a round join; `segments` interior points are emitted,
 * excluding the shared start/end (the rails already provide those).
 */
function sampleRoundCap(
	center: Point,
	radius: number,
	startAngle: number,
	endAngle: number,
	segments: number,
): Point[] {
	const points: Point[] = [];
	for (let step = 1; step < segments; step += 1) {
		const t = step / segments;
		const angle = startAngle + (endAngle - startAngle) * t;
		points.push({
			x: center.x + radius * Math.cos(angle),
			y: center.y + radius * Math.sin(angle),
		});
	}
	return points;
}

/**
 * Expands `options.shape`'s spine into a closed variable-width stroke outline.
 *
 * Returns `null` when:
 * - `shape.closed` is `true` (closed-spine expansion is out of v1 scope; the
 *   caller should fall back to a uniform stroke render for that node),
 * - `strokeWidth <= 0`,
 * - `profile` fails {@link validateStrokeWidthProfile},
 * - the spine flattens to fewer than 2 samples or ~0 arc length (nothing to
 *   expand), or
 * - the re-fit step ({@link fitClosedContour}) cannot produce a valid closed
 *   shape from the offset contour.
 *
 * High-curvature self-intersection of the offset rails (a tight inner corner
 * overlapping itself) is accepted in v1 and not resolved here.
 */
export function expandStrokeWidthProfile(
	options: ExpandStrokeOptions,
): AeShape | null {
	const { shape, strokeWidth, profile, fitTolerance } = options;
	if (shape.closed) return null;
	if (!(strokeWidth > 0)) return null;
	if (validateStrokeWidthProfile(profile) !== null) return null;

	const flattenedSpine = sampleSpine(shape);
	if (flattenedSpine.length < 2) return null;
	const totalLength = flattenedSpine[flattenedSpine.length - 1].s;
	if (!(totalLength > 0)) return null;

	// The profile is piecewise-linear between stops by contract, so a rail
	// sample placed exactly at each interior stop's arc position makes the
	// rails exact between stops even on a straight run that sampleSpine
	// otherwise flattens to just its 2 endpoints (curvature-only subdivision
	// has nothing to subdivide there, but the width profile still varies).
	const spine = insertProfileStopSamples(flattenedSpine, profile, totalLength);

	const widthAt = (arcLength: number): number =>
		strokeWidth * sampleWidthProfile(profile, arcLength / totalLength);

	const leftRail: Point[] = [];
	const rightRail: Point[] = [];
	for (const sample of spine) {
		const halfWidth = widthAt(sample.s) / 2;
		leftRail.push({
			x: sample.x + sample.nx * halfWidth,
			y: sample.y + sample.ny * halfWidth,
		});
		rightRail.push({
			x: sample.x - sample.nx * halfWidth,
			y: sample.y - sample.ny * halfWidth,
		});
	}

	const startSample = spine[0];
	const endSample = spine[spine.length - 1];
	const startHalfWidth = widthAt(startSample.s) / 2;
	const endHalfWidth = widthAt(endSample.s) / 2;
	const startCenter: Point = { x: startSample.x, y: startSample.y };
	const endCenter: Point = { x: endSample.x, y: endSample.y };

	const cornerPoints: Point[] = [];

	// End cap: from the left rail's last point, around the outside, to the
	// right rail's last point. The left rail sits at +normal, so a half-turn
	// starting at the +normal angle and sweeping to the -normal angle (i.e.
	// +180°) traces the outward-facing semicircle.
	const endCap: Point[] =
		endHalfWidth < MIN_CAP_WIDTH
			? [endCenter]
			: (() => {
					const startAngle = Math.atan2(endSample.ny, endSample.nx);
					return sampleRoundCap(
						endCenter,
						endHalfWidth,
						startAngle,
						startAngle + Math.PI,
						CAP_SEGMENT_COUNT,
					);
				})();
	if (endHalfWidth < MIN_CAP_WIDTH) cornerPoints.push(endCenter);

	// Start cap: from the right rail's first point, around the outside, back
	// to the left rail's first point — the -normal angle sweeping +180° back
	// to the +normal angle.
	const startCap: Point[] =
		startHalfWidth < MIN_CAP_WIDTH
			? [startCenter]
			: (() => {
					const startAngle = Math.atan2(-startSample.ny, -startSample.nx);
					return sampleRoundCap(
						startCenter,
						startHalfWidth,
						startAngle,
						startAngle + Math.PI,
						CAP_SEGMENT_COUNT,
					);
				})();
	if (startHalfWidth < MIN_CAP_WIDTH) cornerPoints.push(startCenter);

	const contour: Point[] = [
		...leftRail,
		...endCap,
		...[...rightRail].reverse(),
		...startCap,
	];

	// fitClosedContour treats a corner as the boundary between two independent
	// smooth runs; with exactly one corner it wraps to itself and degenerates
	// the entire ring into a single zero-length run. A lone collapsed cap (one
	// tapered tip, one round end) has no second corner to pair with, so it is
	// deliberately left unflagged here — the tip still collapses to a point in
	// the contour, it is just fit as part of one continuous smooth loop rather
	// than pinned as a hard corner. Two collapsed caps still pass through as
	// two real corners.
	const fitCornerPoints = cornerPoints.length === 1 ? [] : cornerPoints;
	return fitClosedContour(contour, fitCornerPoints, {
		tolerance: fitTolerance,
	});
}
