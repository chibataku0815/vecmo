import type {
	MotionGrammarRandomPulseEnvelopeSegment,
	MotionGrammarRandomPulseProfile,
} from "./types";

export const RANDOM_PULSE_PROFILE_VERSION = 1 as const;
export const RANDOM_PULSE_PROFILE_KIND = "explicit-envelope-v1" as const;
export const RANDOM_PULSE_PROFILE_MAX_DURATION_FRAMES = 240 as const;
const RANDOM_PULSE_PROFILE_MAX_SEGMENTS =
	RANDOM_PULSE_PROFILE_MAX_DURATION_FRAMES;

/** Editable fields exposed by the generic Inspector envelope control. */
export type RandomPulseProfileEdit =
	| { readonly kind: "durationFrames"; readonly value: number }
	| {
			readonly kind: "segment";
			readonly index: number;
			readonly field:
				| "toFrame"
				| "fromValue"
				| "toValue"
				| "easingP1X"
				| "easingP1Y"
				| "easingP2X"
				| "easingP2Y";
			readonly value: number;
	  };

export type RandomPulseProfileEditResult =
	| {
			readonly status: "updated";
			readonly profile: MotionGrammarRandomPulseProfile;
	  }
	| { readonly status: "blocked"; readonly reason: string };

/** Runtime-safe default envelope; source-law oracles remain outside this module. */
export const RANDOM_PULSE_PROFILE_DEFAULT: MotionGrammarRandomPulseProfile = {
	version: RANDOM_PULSE_PROFILE_VERSION,
	durationFrames: 50,
	segments: [
		{
			fromFrame: 0,
			toFrame: 4,
			fromValue: 0,
			toValue: -0.05,
			easing: [0.33, 0, 0.67, 1],
		},
		{
			fromFrame: 4,
			toFrame: 8,
			fromValue: -0.05,
			toValue: -0.15,
			easing: [0.33, 0, 0.67, 1],
		},
		{
			fromFrame: 8,
			toFrame: 16,
			fromValue: -0.15,
			toValue: 1,
			easing: [0.33, 0, 0.67, 1],
		},
		{
			fromFrame: 16,
			toFrame: 41,
			fromValue: 1,
			toValue: 1,
			easing: [0.33, 0, 0.67, 1],
		},
		{
			fromFrame: 41,
			toFrame: 50,
			fromValue: 1,
			toValue: 0,
			easing: [0.33, 0, 0.67, 1],
		},
	],
};

const isFiniteNumber = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

const isUnitBezier = (
	value: readonly number[],
): value is readonly [number, number, number, number] =>
	value.length === 4 &&
	value.every(
		(coordinate) =>
			isFiniteNumber(coordinate) && coordinate >= 0 && coordinate <= 1,
	);

const unitBezierY = (
	curve: readonly [number, number, number, number],
	x: number,
): number => {
	if (x <= 0) return 0;
	if (x >= 1) return 1;
	let lower = 0;
	let upper = 1;
	for (let iteration = 0; iteration < 40; iteration += 1) {
		const t = (lower + upper) / 2;
		const inverse = 1 - t;
		const [p1x, , p2x] = curve;
		const bezierX =
			3 * inverse * inverse * t * p1x + 3 * inverse * t * t * p2x + t ** 3;
		if (bezierX < x) lower = t;
		else upper = t;
	}
	const t = (lower + upper) / 2;
	const inverse = 1 - t;
	const [, p1y, , p2y] = curve;
	return 3 * inverse * inverse * t * p1y + 3 * inverse * t * t * p2y + t ** 3;
};

/** Returns a fail-closed reason for an explicit Random Pulse profile. */
export const randomPulseProfileIssue = (
	profile: MotionGrammarRandomPulseProfile | undefined,
): string | null => {
	if (!profile) return null;
	if (profile.version !== RANDOM_PULSE_PROFILE_VERSION) {
		return `Random Pulse profile version must be ${RANDOM_PULSE_PROFILE_VERSION}.`;
	}
	if (
		!Number.isInteger(profile.durationFrames) ||
		profile.durationFrames <= 0 ||
		profile.durationFrames > RANDOM_PULSE_PROFILE_MAX_DURATION_FRAMES ||
		profile.segments.length < 3 ||
		profile.segments.length > RANDOM_PULSE_PROFILE_MAX_SEGMENTS
	) {
		return "Random Pulse profile duration and segment count are invalid.";
	}
	let cursor = 0;
	let previousToValue: number | undefined;
	let hasUndershoot = false;
	let hasHold = false;
	let hasPeak = false;
	for (const segment of profile.segments) {
		if (!segmentIsValid(segment, cursor, profile.durationFrames)) {
			return "Random Pulse profile segments must be contiguous, finite, and use unit Bezier easing.";
		}
		if (
			previousToValue !== undefined &&
			segment.fromValue !== previousToValue
		) {
			return "Random Pulse profile segments must preserve value continuity.";
		}
		if (segment.fromValue < 0 || segment.toValue < 0) hasUndershoot = true;
		if (segment.fromValue > 0 || segment.toValue > 0) hasPeak = true;
		if (segment.fromValue === segment.toValue) hasHold = true;
		previousToValue = segment.toValue;
		cursor = segment.toFrame;
	}
	if (cursor !== profile.durationFrames) {
		return "Random Pulse profile must end at its declared duration.";
	}
	const first = profile.segments[0];
	const last = profile.segments[profile.segments.length - 1];
	if (!first || !last || first.fromValue !== 0 || last.toValue !== 0) {
		return "Random Pulse profile must start and finish at rest.";
	}
	if (!hasUndershoot || !hasHold || !hasPeak) {
		return "Random Pulse profile must contain undershoot, positive peak, and hold segments.";
	}
	return null;
};

const segmentIsValid = (
	segment: MotionGrammarRandomPulseEnvelopeSegment,
	cursor: number,
	durationFrames: number,
): boolean =>
	[
		segment.fromFrame,
		segment.toFrame,
		segment.fromValue,
		segment.toValue,
	].every(isFiniteNumber) &&
	segment.fromFrame === cursor &&
	segment.toFrame > segment.fromFrame &&
	segment.toFrame <= durationFrames &&
	isUnitBezier(segment.easing);

const segmentAt = (
	profile: MotionGrammarRandomPulseProfile,
	frame: number,
): MotionGrammarRandomPulseEnvelopeSegment | undefined =>
	profile.segments.find(
		(segment) => frame >= segment.fromFrame && frame <= segment.toFrame,
	);

/** Samples the candidate's shared envelope; frame is binding-local and wrapped by period upstream. */
export const sampleRandomPulseProfile = (
	profile: MotionGrammarRandomPulseProfile,
	frame: number,
): number | null => {
	if (!Number.isFinite(frame)) return null;
	if (frame < 0 || frame >= profile.durationFrames) return 0;
	const segment = segmentAt(profile, frame);
	if (!segment) return null;
	const span = segment.toFrame - segment.fromFrame;
	const progress = Math.min(1, Math.max(0, (frame - segment.fromFrame) / span));
	const eased = unitBezierY(segment.easing, progress);
	return segment.fromValue + (segment.toValue - segment.fromValue) * eased;
};

const finiteEditValue = (value: number): number | null =>
	typeof value === "number" && Number.isFinite(value) ? value : null;

const clampUnit = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * Applies one semantic envelope edit and validates the whole profile before it
 * can cross the command-bus boundary. Frame boundaries are kept contiguous by
 * moving the next segment's start with the edited end; the first start and last
 * end remain derived from the profile domain.
 */
export const editRandomPulseProfile = (
	profile: MotionGrammarRandomPulseProfile,
	edit: RandomPulseProfileEdit,
): RandomPulseProfileEditResult => {
	if (randomPulseProfileIssue(profile)) {
		return {
			status: "blocked",
			reason:
				"The current Random Pulse envelope is invalid and cannot be edited.",
		};
	}
	const segments = profile.segments.map((segment) => ({
		...segment,
		easing: [...segment.easing] as [number, number, number, number],
	}));
	if (edit.kind === "durationFrames") {
		const value = finiteEditValue(edit.value);
		const last = segments.at(-1);
		if (value === null || !last) {
			return { status: "blocked", reason: "Profile duration must be finite." };
		}
		const durationFrames = Math.round(value);
		if (
			durationFrames <= last.fromFrame ||
			durationFrames > RANDOM_PULSE_PROFILE_MAX_DURATION_FRAMES
		) {
			return {
				status: "blocked",
				reason: `Profile duration must be ${last.fromFrame + 1}-${RANDOM_PULSE_PROFILE_MAX_DURATION_FRAMES} frames.`,
			};
		}
		last.toFrame = durationFrames;
		const next = { ...profile, durationFrames, segments };
		const issue = randomPulseProfileIssue(next);
		return issue
			? { status: "blocked", reason: issue }
			: { status: "updated", profile: next };
	}

	if (
		!Number.isInteger(edit.index) ||
		edit.index < 0 ||
		edit.index >= segments.length
	) {
		return { status: "blocked", reason: "Envelope segment index is invalid." };
	}
	const segment = segments[edit.index];
	if (!segment)
		return { status: "blocked", reason: "Envelope segment is missing." };
	const value = finiteEditValue(edit.value);
	if (value === null)
		return { status: "blocked", reason: "Envelope value must be finite." };

	switch (edit.field) {
		case "toFrame": {
			if (edit.index === segments.length - 1) {
				return {
					status: "blocked",
					reason:
						"The final envelope boundary is controlled by Profile duration.",
				};
			}
			const nextSegment = segments[edit.index + 1];
			if (!nextSegment)
				return {
					status: "blocked",
					reason: "Next envelope segment is missing.",
				};
			const toFrame = Math.round(value);
			if (toFrame <= segment.fromFrame || toFrame >= nextSegment.toFrame) {
				return {
					status: "blocked",
					reason: `Segment end must be ${segment.fromFrame + 1}-${nextSegment.toFrame - 1} frames.`,
				};
			}
			segment.toFrame = toFrame;
			nextSegment.fromFrame = toFrame;
			break;
		}
		case "fromValue":
			segment.fromValue = value;
			break;
		case "toValue":
			segment.toValue = value;
			break;
		case "easingP1X":
			segment.easing[0] = clampUnit(value);
			break;
		case "easingP1Y":
			segment.easing[1] = clampUnit(value);
			break;
		case "easingP2X":
			segment.easing[2] = clampUnit(value);
			break;
		case "easingP2Y":
			segment.easing[3] = clampUnit(value);
			break;
	}

	const next = { ...profile, segments };
	const issue = randomPulseProfileIssue(next);
	return issue
		? { status: "blocked", reason: issue }
		: { status: "updated", profile: next };
};
