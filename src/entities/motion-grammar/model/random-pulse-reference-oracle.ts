import {
	isFiniteReferenceNumber,
	type MotionStudyReferenceCriticalFrame,
	type MotionStudyReferenceOracle,
	type MotionStudyReferenceResult,
	wrapReferenceFrame,
} from "./reference-law-oracle";

export const RANDOM_PULSE_REFERENCE_LAW_ID = "random-rank-pulse-v1" as const;

type UnitBezier = readonly [number, number, number, number];

/** One source-observed rank address. Rank is semantic order, not render order. */
export type RandomPulseReferenceTarget = {
	readonly targetId: string;
	readonly rank: number;
};

/** One bounded segment of the shared pulse envelope. */
export type RandomPulseReferenceSegment = {
	readonly fromFrame: number;
	readonly toFrame: number;
	readonly fromValue: number;
	readonly toValue: number;
	readonly easing: UnitBezier;
};

/**
 * The pulse is deliberately an explicit, transient source-law envelope. It
 * can contain an undershoot segment and a dead-flat hold segment; neither is
 * inferred from the Vecmo evaluator's sine fallback.
 */
export type RandomPulseReferenceEnvelope = {
	readonly durationFrames: number;
	readonly segments: readonly RandomPulseReferenceSegment[];
};

/**
 * Source-law input for the Random Pulse comparison packet.
 *
 * This is construction-calibration evidence, not a Motion Grammar binding and
 * not an assertion about hidden source timing. The target rank table is
 * intentionally explicit so an oracle cannot agree with a candidate merely by
 * importing the candidate's seed/hash implementation.
 */
export type RandomPulseReferenceInput = {
	readonly periodFrames: number;
	readonly cadenceFrames: number;
	readonly targets: readonly RandomPulseReferenceTarget[];
	readonly envelope: RandomPulseReferenceEnvelope;
	readonly scaleAmplitude: number;
	readonly opacityFloor: number;
};

export type RandomPulseReferenceSample = {
	readonly targetId: string;
	readonly rank: number;
	readonly sourceFrame: number;
	readonly localFrame: number;
	readonly pulse: number;
	readonly scale: number;
	readonly opacity: number;
	readonly seamState: "active" | "rest";
};

const blocked = <TSample>(
	reason: string,
): MotionStudyReferenceResult<TSample> => ({
	status: "blocked",
	reason,
});

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const isUnitBezier = (value: unknown): value is UnitBezier =>
	Array.isArray(value) &&
	value.length === 4 &&
	value.every(
		(coordinate) =>
			isFiniteReferenceNumber(coordinate) && coordinate >= 0 && coordinate <= 1,
	);

const unitBezierY = (curve: UnitBezier, x: number): number => {
	if (x <= 0) return 0;
	if (x >= 1) return 1;
	let lower = 0;
	let upper = 1;
	for (let index = 0; index < 40; index += 1) {
		const t = (lower + upper) / 2;
		const inverse = 1 - t;
		const [p1x] = curve;
		const [, , p2x] = curve;
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

const inputIssue = (input: RandomPulseReferenceInput): string | null => {
	if (
		![
			input.periodFrames,
			input.cadenceFrames,
			input.scaleAmplitude,
			input.opacityFloor,
		].every(isFiniteReferenceNumber)
	) {
		return "Random Pulse period, cadence, amplitude, and opacity floor must be finite.";
	}
	if (!Number.isInteger(input.periodFrames) || input.periodFrames <= 0) {
		return "Random Pulse period must be a positive integer.";
	}
	if (!Number.isInteger(input.cadenceFrames) || input.cadenceFrames <= 0) {
		return "Random Pulse cadence must be a positive integer.";
	}
	if (
		input.scaleAmplitude < 0 ||
		input.opacityFloor < 0 ||
		input.opacityFloor > 1
	) {
		return "Random Pulse amplitude must be non-negative and opacity floor must be in [0, 1].";
	}
	if (input.targets.length === 0) {
		return "Random Pulse requires at least one ranked target.";
	}
	const targetIds = new Set<string>();
	const ranks = new Set<number>();
	for (const target of input.targets) {
		if (
			!target.targetId ||
			targetIds.has(target.targetId) ||
			!Number.isInteger(target.rank) ||
			target.rank < 0 ||
			ranks.has(target.rank)
		) {
			return "Random Pulse targets must have unique ids and contiguous integer ranks.";
		}
		targetIds.add(target.targetId);
		ranks.add(target.rank);
	}
	if (ranks.size !== input.targets.length || !ranks.has(0)) {
		return "Random Pulse ranks must start at zero and cover every target exactly once.";
	}
	for (let rank = 0; rank < input.targets.length; rank += 1) {
		if (!ranks.has(rank)) {
			return "Random Pulse ranks must be contiguous with no gaps.";
		}
	}
	const envelope = input.envelope;
	if (
		!isFiniteReferenceNumber(envelope.durationFrames) ||
		!Number.isInteger(envelope.durationFrames) ||
		envelope.durationFrames <= 0 ||
		envelope.durationFrames > input.periodFrames
	) {
		return "Random Pulse envelope duration must be a positive integer within the period.";
	}
	if (envelope.segments.length < 3) {
		return "Random Pulse envelope needs at least rise, hold, and recovery segments.";
	}
	let cursor = 0;
	let hasUndershoot = false;
	let hasHold = false;
	let hasPeak = false;
	for (const segment of envelope.segments) {
		if (
			![
				segment.fromFrame,
				segment.toFrame,
				segment.fromValue,
				segment.toValue,
			].every(isFiniteReferenceNumber) ||
			segment.fromFrame !== cursor ||
			segment.toFrame <= segment.fromFrame ||
			segment.toFrame > envelope.durationFrames ||
			!isUnitBezier(segment.easing)
		) {
			return "Random Pulse envelope segments must be contiguous, finite, and use unit Bezier easing.";
		}
		if (segment.fromValue < 0 || segment.toValue < 0) hasUndershoot = true;
		if (segment.fromValue > 0 || segment.toValue > 0) hasPeak = true;
		if (
			segment.fromValue === segment.toValue &&
			segment.toFrame > segment.fromFrame
		) {
			hasHold = true;
		}
		cursor = segment.toFrame;
	}
	if (cursor !== envelope.durationFrames) {
		return "Random Pulse envelope must end exactly at its declared duration.";
	}
	const first = envelope.segments[0];
	const last = envelope.segments[envelope.segments.length - 1];
	if (!first || !last || first.fromValue !== 0 || last.toValue !== 0) {
		return "Random Pulse envelope must start and finish at the rest value zero.";
	}
	if (!hasUndershoot) {
		return "Random Pulse envelope must retain an explicit undershoot segment.";
	}
	if (!hasHold) {
		return "Random Pulse envelope must retain a dead-flat hold segment.";
	}
	if (!hasPeak) {
		return "Random Pulse envelope must retain a positive authored pulse peak.";
	}
	return null;
};

const segmentAt = (
	envelope: RandomPulseReferenceEnvelope,
	frame: number,
): RandomPulseReferenceSegment | null => {
	for (const segment of envelope.segments) {
		if (frame >= segment.fromFrame && frame <= segment.toFrame) return segment;
	}
	return null;
};

const sampleEnvelope = (
	envelope: RandomPulseReferenceEnvelope,
	frame: number,
): number | null => {
	if (frame < 0 || frame >= envelope.durationFrames) return 0;
	const segment = segmentAt(envelope, frame);
	if (!segment) return null;
	const span = segment.toFrame - segment.fromFrame;
	const progress = clamp01((frame - segment.fromFrame) / span);
	const eased = unitBezierY(segment.easing, progress);
	return segment.fromValue + (segment.toValue - segment.fromValue) * eased;
};

const holdSegment = (
	envelope: RandomPulseReferenceEnvelope,
): RandomPulseReferenceSegment | undefined =>
	envelope.segments.find(
		(segment) =>
			segment.fromValue === segment.toValue &&
			segment.toFrame > segment.fromFrame,
	);

const undershootSegment = (
	envelope: RandomPulseReferenceEnvelope,
): RandomPulseReferenceSegment | undefined =>
	envelope.segments.find(
		(segment) => segment.fromValue < 0 || segment.toValue < 0,
	);

export function randomPulseReferenceCriticalFrames(
	input: RandomPulseReferenceInput,
): MotionStudyReferenceResult<MotionStudyReferenceCriticalFrame> {
	const issue = inputIssue(input);
	if (issue) return blocked(issue);
	const frames: MotionStudyReferenceCriticalFrame[] = [
		{
			id: "loop-start",
			frame: 0,
			purpose: "all ranks at the opening rest state",
		},
		{
			id: "first-rank-midpoint",
			frame: Math.min(input.cadenceFrames / 2, input.periodFrames - 1),
			purpose: "first ranked target enters the shared pulse envelope",
		},
		{
			id: "rank-handoff",
			frame: input.cadenceFrames,
			purpose: "the next semantic rank inherits the same pulse law",
		},
	];
	const undershoot = undershootSegment(input.envelope);
	if (undershoot) {
		frames.push({
			id: "undershoot-midpoint",
			frame: (undershoot.fromFrame + undershoot.toFrame) / 2,
			purpose: "shared authored undershoot rather than sine-only expansion",
		});
	}
	const hold = holdSegment(input.envelope);
	if (hold) {
		frames.push({
			id: "hold-midpoint",
			frame: (hold.fromFrame + hold.toFrame) / 2,
			purpose: "dead-flat hold inside the shared pulse clip",
		});
	}
	const lastRankStart = (input.targets.length - 1) * input.cadenceFrames;
	frames.push({
		id: "last-rank-recovery",
		frame: Math.min(
			input.periodFrames - 1,
			lastRankStart + Math.max(0, input.envelope.durationFrames - 1),
		),
		purpose: "last ranked target returns before the loop seam",
	});
	frames.push({
		id: "loop-seam",
		frame: input.periodFrames,
		purpose:
			"semantic seam probe; compare with loop-start, not a live frame index",
	});
	return { status: "ready", samples: frames };
}

export function sampleRandomPulseReference(
	input: RandomPulseReferenceInput,
	frame: number,
): MotionStudyReferenceResult<RandomPulseReferenceSample> {
	const issue = inputIssue(input);
	if (issue) return blocked(issue);
	const wrapped = wrapReferenceFrame(frame, input.periodFrames);
	if (wrapped === null)
		return blocked("Random Pulse sample frame must be finite.");
	const samples: RandomPulseReferenceSample[] = [];
	for (const target of input.targets) {
		const localFrame = wrapReferenceFrame(
			wrapped - target.rank * input.cadenceFrames,
			input.periodFrames,
		);
		if (localFrame === null)
			return blocked("Random Pulse local frame could not be wrapped.");
		const pulse = sampleEnvelope(input.envelope, localFrame);
		if (pulse === null)
			return blocked(
				"Random Pulse envelope has no segment for the sampled frame.",
			);
		samples.push({
			targetId: target.targetId,
			rank: target.rank,
			sourceFrame: frame,
			localFrame,
			pulse,
			scale: 1 + input.scaleAmplitude * pulse,
			opacity: input.opacityFloor + (1 - input.opacityFloor) * clamp01(pulse),
			seamState:
				localFrame > 0 && localFrame < input.envelope.durationFrames
					? "active"
					: "rest",
		});
	}
	return { status: "ready", samples };
}

/**
 * Canonical construction-calibration fixture. The values are explicit review
 * inputs, not hidden source defaults: the 25-frame hold is retained from the
 * study observation, while the remaining timing is intentionally editable.
 */
export const RANDOM_PULSE_CONSTRUCTION_FIXTURE: RandomPulseReferenceInput = {
	periodFrames: 120,
	cadenceFrames: 4,
	targets: Array.from({ length: 9 }, (_, rank) => ({
		targetId: `random-cell-${rank + 1}`,
		rank,
	})),
	envelope: {
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
	},
	scaleAmplitude: 0.22,
	opacityFloor: 0.45,
};

export const RANDOM_PULSE_REFERENCE_ORACLE: MotionStudyReferenceOracle<
	RandomPulseReferenceInput,
	RandomPulseReferenceSample
> = {
	id: RANDOM_PULSE_REFERENCE_LAW_ID,
	criticalFrames: randomPulseReferenceCriticalFrames,
	sample: sampleRandomPulseReference,
};
