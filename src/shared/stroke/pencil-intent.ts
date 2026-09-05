/**
 * PencilStrokeIntent — the transient, domain-free interpretation layer that sits
 * between raw Apple Pencil / PointerEvent capture and Vecmo's scene/motion
 * conversions.
 *
 * Both capture shells (the native iPad wet-ink overlay and browser
 * PointerEvents) collapse their rich per-sample signal into `{x, y, pressure?}`
 * before the freehand commit ever sees it. That is enough to draw a path, but it
 * throws away the timing, tilt, and roll that stroke-to-motion and
 * perform-to-motion need. This module keeps that signal alive as a pure analysis
 * object:
 *
 *   normalize samples → measure signals → classify conversion candidates
 *
 * It is intentionally free of scene/motion domain types (no `BezierShape`, no
 * node refs) so it can live in `shared` and be consumed downward by both the
 * draw feature (the producer) and the motion feature (a consumer) without a
 * feature-to-feature import. The fitted `BezierShape` is produced separately by
 * the existing freehand commit; a consumer that needs it references the committed
 * node by id.
 *
 * Every output number is finite by construction: each division guards its
 * denominator, so a zero-length path, a zero time gap between coalesced samples,
 * or a degenerate single-point stroke can never produce NaN/Infinity.
 */

import { type PressureSample, pressureSamplesToProfile } from "./resample";

/** Where a stroke's samples came from. Native carries tilt/roll; browser rarely does. */
export type PencilIntentSource = "pointer-event" | "native-pencil";

/**
 * One normalized Pencil sample in artboard-local space. `tMs` is measured from
 * the stroke's first sample (so the first sample is always 0). Every optional
 * signal is `null` — never a synthesized constant — when the device did not
 * report it, so a consumer can tell "held flat" apart from "no tilt sensor".
 */
export type PencilIntentSample = {
	readonly x: number;
	readonly y: number;
	readonly tMs: number;
	readonly pressure: number | null;
	readonly tiltRad: number | null;
	readonly azimuthRad: number | null;
	readonly rollRad: number | null;
};

/** One stop of a normalized-arc-length profile (`t` in [0, 1]); `value` is unnormalized. */
export type IntentProfileStop = {
	readonly t: number;
	readonly value: number;
};

/** Axis-aligned bounds of a stroke's traced samples, in artboard-local units. */
export type IntentBounds = {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
};

/** Pure measurements derived from a stroke's samples. */
export type PencilIntentSignals = {
	/** Total traced polyline length in artboard-local units. */
	readonly pathLength: number;
	/** Wall-clock duration of the stroke, in milliseconds. */
	readonly durationMs: number;
	/** Axis-aligned bounds of the traced samples. */
	readonly bounds: IntentBounds;
	/** 1 = a clean straight line, falling toward 0 as the stroke bends off its chord. */
	readonly straightness: number;
	/** 1 = ends where it began (a closed loop), 0 = ends far from the start. */
	readonly closedness: number;
	/** Trailing dwell at the final position — the "hold to convert" signal. */
	readonly endStillnessMs: number;
	/** Speed (units/ms) along the stroke, or null when timing is unusable. */
	readonly velocityProfile: readonly IntentProfileStop[] | null;
	/** Pen pressure along the stroke, or null for constant-force / no-pressure input. */
	readonly pressureProfile: readonly IntentProfileStop[] | null;
	/** Pen tilt (radians from vertical) along the stroke, or null when unreported. */
	readonly tiltProfile: readonly IntentProfileStop[] | null;
	/** Pencil Pro barrel roll (radians) along the stroke, or null when unreported. */
	readonly rollProfile: readonly IntentProfileStop[] | null;
};

/**
 * A conversion the stroke's geometry is a plausible candidate for. Kept as
 * neutral geometric descriptors — the product meaning of each (draw-on motion,
 * clean rect/ellipse, perform) is decided by the consuming feature, not here.
 * Rect/ellipse refinement of `closed-shape` is deferred to the sketch-to-vector
 * slice.
 */
export type PencilIntentCandidate =
	| "freehand-path"
	| "straight-line"
	| "closed-shape";

/** The transient interpretation of one drawn Pencil stroke. */
export type PencilStrokeIntent = {
	readonly id: string;
	readonly source: PencilIntentSource;
	readonly samples: readonly PencilIntentSample[];
	readonly signals: PencilIntentSignals;
	readonly candidates: readonly PencilIntentCandidate[];
};

/** A stroke needs a start and an end before any signal is meaningful. */
const MIN_INTENT_SAMPLES = 2;
/** Below this arc length (artboard units) a stroke is a dot, not a path. */
const DEGENERATE_LENGTH = 1e-3;
/** A chord this short reads as no net displacement, so "straightness" is undefined. */
const CHORD_EPSILON = 1e-6;
/** Cap on profile stops so a dense capture serializes/inspects as a compact curve. */
const MAX_PROFILE_STOPS = 24;
/** Fraction of path length within which trailing samples count as an end hold. */
const STILL_RADIUS_FRACTION = 0.03;
/** Straightness at or above which a stroke offers the straight-line conversion. */
const STRAIGHT_LINE_MIN_STRAIGHTNESS = 0.92;
/** Closedness at or above which a stroke offers the closed-shape conversion. */
const CLOSED_SHAPE_MIN_CLOSEDNESS = 0.65;

const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));

/** Perpendicular distance from `point` to the line through `a`→`b`. */
const perpendicularDistance = (
	point: { readonly x: number; readonly y: number },
	a: { readonly x: number; readonly y: number },
	b: { readonly x: number; readonly y: number },
): number => {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const lineLength = Math.hypot(dx, dy);
	if (lineLength === 0) return Math.hypot(point.x - a.x, point.y - a.y);
	const cross = Math.abs(dx * (a.y - point.y) - dy * (a.x - point.x));
	return cross / lineLength;
};

/** Drops stops whose `t` does not strictly increase past the previous survivor. */
const dedupeByT = (
	stops: readonly IntentProfileStop[],
): IntentProfileStop[] => {
	const result: IntentProfileStop[] = [];
	for (const stop of stops) {
		const previous = result[result.length - 1];
		if (previous && stop.t <= previous.t) continue;
		result.push(stop);
	}
	return result;
};

/** Thins an already-deduped stop list to {@link MAX_PROFILE_STOPS}, keeping endpoints. */
const capStops = (stops: readonly IntentProfileStop[]): IntentProfileStop[] => {
	if (stops.length <= MAX_PROFILE_STOPS) return [...stops];
	const first = stops[0];
	const last = stops[stops.length - 1];
	const interior = stops.slice(1, -1);
	const budget = MAX_PROFILE_STOPS - 2;
	const kept: IntentProfileStop[] = [];
	for (let index = 0; index < budget; index += 1) {
		const sourceIndex = Math.round(
			((index + 1) * (interior.length - 1)) / (budget + 1),
		);
		kept.push(interior[sourceIndex]);
	}
	return dedupeByT([first, ...kept, last]);
};

/** Normalizes `(arcLength, value)` readings into a compact, strictly-increasing profile. */
const toProfile = (
	valued: readonly { readonly s: number; readonly value: number }[],
	totalLength: number,
): IntentProfileStop[] | null => {
	if (valued.length < MIN_INTENT_SAMPLES || !(totalLength > 0)) return null;
	const deduped = dedupeByT(
		valued.map((entry) => ({
			t: clamp(entry.s / totalLength, 0, 1),
			value: entry.value,
		})),
	);
	if (deduped.length < MIN_INTENT_SAMPLES) return null;
	return capStops(deduped);
};

/** How close the stroke is to a straight line, via max deviation from its chord. */
const computeStraightness = (
	samples: readonly PencilIntentSample[],
	first: PencilIntentSample,
	last: PencilIntentSample,
	chord: number,
): number => {
	// A near-zero chord is a loop or a return-to-start, not a line.
	if (chord < CHORD_EPSILON) return 0;
	let maxDeviation = 0;
	for (const sample of samples) {
		maxDeviation = Math.max(
			maxDeviation,
			perpendicularDistance(sample, first, last),
		);
	}
	return clamp(1 - maxDeviation / chord, 0, 1);
};

/** Milliseconds the pen dwelled near its final position (the end-hold signal). */
const computeEndStillness = (
	samples: readonly PencilIntentSample[],
	pathLength: number,
): number => {
	const last = samples[samples.length - 1];
	const radius = Math.max(
		DEGENERATE_LENGTH,
		pathLength * STILL_RADIUS_FRACTION,
	);
	let stillStart = samples.length - 1;
	for (let index = samples.length - 2; index >= 0; index -= 1) {
		const sample = samples[index];
		if (Math.hypot(sample.x - last.x, sample.y - last.y) > radius) break;
		stillStart = index;
	}
	return Math.max(0, last.tMs - samples[stillStart].tMs);
};

const computeVelocityProfile = (
	samples: readonly PencilIntentSample[],
	cumulative: readonly number[],
	pathLength: number,
): IntentProfileStop[] | null => {
	if (!(pathLength > DEGENERATE_LENGTH)) return null;
	const valued: { readonly s: number; readonly value: number }[] = [];
	for (let index = 1; index < samples.length; index += 1) {
		const dt = samples[index].tMs - samples[index - 1].tMs;
		// Coalesced sub-events can share a timestamp; skip zero-gap pairs so the
		// speed never divides by zero and injects Infinity into the profile.
		if (!(dt > 0)) continue;
		const step = Math.hypot(
			samples[index].x - samples[index - 1].x,
			samples[index].y - samples[index - 1].y,
		);
		valued.push({ s: cumulative[index], value: step / dt });
	}
	return toProfile(valued, pathLength);
};

const computePressureProfile = (
	samples: readonly PencilIntentSample[],
	cumulative: readonly number[],
	pathLength: number,
): IntentProfileStop[] | null => {
	const pressureSamples: PressureSample[] = [];
	for (let index = 0; index < samples.length; index += 1) {
		const pressure = samples[index].pressure;
		// Any missing reading gives up the whole profile — matching the freehand
		// width-profile policy, a partial capture is worse than none.
		if (pressure === null) return null;
		pressureSamples.push({ s: cumulative[index], pressure });
	}
	const profile = pressureSamplesToProfile(pressureSamples, pathLength);
	return profile === null
		? null
		: profile.map((stop) => ({ t: stop.t, value: stop.w }));
};

const computeAngleProfile = (
	samples: readonly PencilIntentSample[],
	cumulative: readonly number[],
	pathLength: number,
	pick: (sample: PencilIntentSample) => number | null,
): IntentProfileStop[] | null => {
	if (!(pathLength > DEGENERATE_LENGTH)) return null;
	const valued: { readonly s: number; readonly value: number }[] = [];
	for (let index = 0; index < samples.length; index += 1) {
		const value = pick(samples[index]);
		// A channel absent on any sample means the device does not report it.
		if (value === null) return null;
		valued.push({ s: cumulative[index], value });
	}
	return toProfile(valued, pathLength);
};

const computeSignals = (
	samples: readonly PencilIntentSample[],
): PencilIntentSignals => {
	const first = samples[0];
	const last = samples[samples.length - 1];

	let minX = first.x;
	let minY = first.y;
	let maxX = first.x;
	let maxY = first.y;
	const cumulative: number[] = [0];
	let pathLength = 0;
	for (let index = 1; index < samples.length; index += 1) {
		const sample = samples[index];
		const previous = samples[index - 1];
		pathLength += Math.hypot(sample.x - previous.x, sample.y - previous.y);
		cumulative.push(pathLength);
		minX = Math.min(minX, sample.x);
		minY = Math.min(minY, sample.y);
		maxX = Math.max(maxX, sample.x);
		maxY = Math.max(maxY, sample.y);
	}

	const chord = Math.hypot(last.x - first.x, last.y - first.y);
	const closedness =
		pathLength > DEGENERATE_LENGTH ? clamp(1 - chord / pathLength, 0, 1) : 0;

	return {
		pathLength,
		durationMs: Math.max(0, last.tMs - first.tMs),
		bounds: { minX, minY, maxX, maxY },
		straightness: computeStraightness(samples, first, last, chord),
		closedness,
		endStillnessMs: computeEndStillness(samples, pathLength),
		velocityProfile: computeVelocityProfile(samples, cumulative, pathLength),
		pressureProfile: computePressureProfile(samples, cumulative, pathLength),
		tiltProfile: computeAngleProfile(
			samples,
			cumulative,
			pathLength,
			(sample) => sample.tiltRad,
		),
		rollProfile: computeAngleProfile(
			samples,
			cumulative,
			pathLength,
			(sample) => sample.rollRad,
		),
	};
};

const classifyCandidates = (
	signals: PencilIntentSignals,
): PencilIntentCandidate[] => {
	const candidates: PencilIntentCandidate[] = ["freehand-path"];
	if (signals.closedness >= CLOSED_SHAPE_MIN_CLOSEDNESS) {
		candidates.push("closed-shape");
	} else if (signals.straightness >= STRAIGHT_LINE_MIN_STRAIGHTNESS) {
		candidates.push("straight-line");
	}
	return candidates;
};

/** Re-bases sample timestamps so the first sample sits at t=0. */
const normalizeTiming = (
	samples: readonly PencilIntentSample[],
): PencilIntentSample[] => {
	const first = samples[0];
	if (!first) return [];
	return samples.map((sample) => ({ ...sample, tMs: sample.tMs - first.tMs }));
};

const degenerateSignals = (
	samples: readonly PencilIntentSample[],
): PencilIntentSignals => {
	const point = samples[0];
	const bounds: IntentBounds = point
		? { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y }
		: { minX: 0, minY: 0, maxX: 0, maxY: 0 };
	return {
		pathLength: 0,
		durationMs: 0,
		bounds,
		straightness: 0,
		closedness: 0,
		endStillnessMs: 0,
		velocityProfile: null,
		pressureProfile: null,
		tiltProfile: null,
		rollProfile: null,
	};
};

/**
 * Builds a {@link PencilStrokeIntent} from captured samples. Timing is
 * re-based to the first sample; a stroke shorter than {@link MIN_INTENT_SAMPLES}
 * (a tap) yields a valid intent with empty signals and only the freehand-path
 * candidate, so callers never have to special-case a degenerate capture.
 */
export function buildPencilStrokeIntent({
	id,
	source,
	samples: rawSamples,
}: {
	readonly id: string;
	readonly source: PencilIntentSource;
	readonly samples: readonly PencilIntentSample[];
}): PencilStrokeIntent {
	const samples = normalizeTiming(rawSamples);
	if (samples.length < MIN_INTENT_SAMPLES) {
		return {
			id,
			source,
			samples,
			signals: degenerateSignals(samples),
			candidates: ["freehand-path"],
		};
	}
	const signals = computeSignals(samples);
	return {
		id,
		source,
		samples,
		signals,
		candidates: classifyCandidates(signals),
	};
}
