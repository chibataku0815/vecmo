/**
 * Stroke width profile — the shared contract for variable-width strokes.
 *
 * A profile describes how stroke width varies along a path as multiplier
 * stops over normalized arc length. The effective width at position `t`
 * is `style.strokeWidth * sampleWidthProfile(stops, t)`; geometry kernels
 * expand the stroked spine into a closed filled outline from this data.
 *
 * Contract invariants (enforced by {@link validateStrokeWidthProfile}):
 * - between {@link STROKE_WIDTH_PROFILE_MIN_STOPS} and
 *   {@link STROKE_WIDTH_PROFILE_MAX_STOPS} stops
 * - `t` strictly increasing, with `t = 0` first and `t = 1` last
 * - `w` finite, `0 <= w <= STROKE_WIDTH_PROFILE_MAX_MULTIPLIER`
 */

/** One stop of a stroke width profile. */
export interface StrokeWidthProfileStop {
	/** Normalized arc-length position along the path, in [0, 1]. */
	readonly t: number;
	/** Width multiplier applied to the node's strokeWidth at this position. */
	readonly w: number;
}

export const STROKE_WIDTH_PROFILE_MIN_STOPS = 2;
export const STROKE_WIDTH_PROFILE_MAX_STOPS = 32;
export const STROKE_WIDTH_PROFILE_MAX_MULTIPLIER = 8;

/**
 * Validates a stroke width profile against the contract invariants.
 *
 * @returns `null` when valid, otherwise a list of human-readable violations.
 */
export function validateStrokeWidthProfile(
	stops: readonly StrokeWidthProfileStop[],
): readonly string[] | null {
	const errors: string[] = [];
	if (stops.length < STROKE_WIDTH_PROFILE_MIN_STOPS) {
		errors.push(
			`profile needs at least ${STROKE_WIDTH_PROFILE_MIN_STOPS} stops, got ${stops.length}`,
		);
	}
	if (stops.length > STROKE_WIDTH_PROFILE_MAX_STOPS) {
		errors.push(
			`profile allows at most ${STROKE_WIDTH_PROFILE_MAX_STOPS} stops, got ${stops.length}`,
		);
	}
	stops.forEach((stop, index) => {
		if (!Number.isFinite(stop.t) || !Number.isFinite(stop.w)) {
			errors.push(`stop ${index} has non-finite values`);
			return;
		}
		if (stop.w < 0 || stop.w > STROKE_WIDTH_PROFILE_MAX_MULTIPLIER) {
			errors.push(
				`stop ${index} width ${stop.w} outside [0, ${STROKE_WIDTH_PROFILE_MAX_MULTIPLIER}]`,
			);
		}
		if (index > 0 && stop.t <= stops[index - 1].t) {
			errors.push(
				`stop ${index} position ${stop.t} is not strictly increasing`,
			);
		}
	});
	if (stops.length > 0 && stops[0].t !== 0) {
		errors.push(`first stop must sit at t=0, got ${stops[0].t}`);
	}
	if (stops.length > 0 && stops[stops.length - 1].t !== 1) {
		errors.push(`last stop must sit at t=1, got ${stops[stops.length - 1].t}`);
	}
	return errors.length > 0 ? errors : null;
}

/**
 * Samples the width multiplier at a normalized arc-length position by
 * linear interpolation between the surrounding stops; `t` is clamped to [0, 1].
 */
export function sampleWidthProfile(
	stops: readonly StrokeWidthProfileStop[],
	t: number,
): number {
	if (stops.length === 0) return 1;
	const clamped = Math.min(1, Math.max(0, t));
	if (clamped <= stops[0].t) return stops[0].w;
	const last = stops[stops.length - 1];
	if (clamped >= last.t) return last.w;
	for (let index = 1; index < stops.length; index += 1) {
		const next = stops[index];
		if (clamped > next.t) continue;
		const previous = stops[index - 1];
		const span = next.t - previous.t;
		const local = span > 0 ? (clamped - previous.t) / span : 0;
		return previous.w + (next.w - previous.w) * local;
	}
	return last.w;
}

/**
 * Built-in profile presets exposed to the inspector, agent commands, and the
 * pencil tool. Keys are the stable preset ids used across those surfaces.
 */
export const STROKE_WIDTH_PROFILE_PRESETS = {
	"taper-out": [
		{ t: 0, w: 1 },
		{ t: 0.6, w: 0.95 },
		{ t: 1, w: 0.04 },
	],
	"taper-in": [
		{ t: 0, w: 0.04 },
		{ t: 0.4, w: 0.95 },
		{ t: 1, w: 1 },
	],
	"taper-both": [
		{ t: 0, w: 0.04 },
		{ t: 0.35, w: 1 },
		{ t: 0.65, w: 1 },
		{ t: 1, w: 0.04 },
	],
	ink: [
		{ t: 0, w: 0.25 },
		{ t: 0.18, w: 1 },
		{ t: 0.82, w: 0.92 },
		{ t: 1, w: 0.12 },
	],
} as const satisfies Record<string, readonly StrokeWidthProfileStop[]>;

/** Stable id of a built-in stroke width profile preset. */
export type StrokeWidthProfilePresetId =
	keyof typeof STROKE_WIDTH_PROFILE_PRESETS;

/** All preset ids in display order. */
export const STROKE_WIDTH_PROFILE_PRESET_IDS = Object.keys(
	STROKE_WIDTH_PROFILE_PRESETS,
) as readonly StrokeWidthProfilePresetId[];
