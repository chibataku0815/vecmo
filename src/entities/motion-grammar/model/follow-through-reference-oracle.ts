import {
	isFiniteReferenceNumber,
	type MotionStudyReferenceCriticalFrame,
	type MotionStudyReferenceOracle,
	type MotionStudyReferenceResult,
	wrapReferenceFrame,
} from "./reference-law-oracle";

export const FOLLOW_THROUGH_REFERENCE_LAW_ID =
	"velocity-seeded-overshoot-v1" as const;

export type FollowThroughVec2 = { readonly x: number; readonly y: number };
export type FollowThroughReferenceTarget = {
	readonly targetId: string;
	readonly rest: FollowThroughVec2;
	readonly index: number;
};
export type FollowThroughReferenceInput = {
	readonly periodFrames: number;
	readonly delayFrames: number;
	readonly response: number;
	readonly settleFrames: number;
	readonly decay: number;
	readonly velocityLookback: number;
	readonly rotationResponse: number;
	readonly leadPositionAt: (frame: number) => FollowThroughVec2;
	readonly targets: readonly FollowThroughReferenceTarget[];
};
export type FollowThroughReferenceSample = {
	readonly sourceFrame: number;
	readonly localFrame: number;
	readonly leadPosition: FollowThroughVec2;
	readonly velocity: FollowThroughVec2;
	readonly targets: readonly {
		readonly targetId: string;
		readonly position: FollowThroughVec2;
		readonly rotation: number;
	}[];
};

const blocked = <TSample>(
	reason: string,
): MotionStudyReferenceResult<TSample> => ({ status: "blocked", reason });
const wrap = (value: number, period: number): number =>
	((value % period) + period) % period;

const inputIssue = (input: FollowThroughReferenceInput): string | null => {
	const numbers = [
		input.periodFrames,
		input.delayFrames,
		input.response,
		input.settleFrames,
		input.decay,
		input.velocityLookback,
		input.rotationResponse,
	];
	if (!numbers.every(isFiniteReferenceNumber))
		return "Follow-through values must be finite.";
	if (
		input.periodFrames <= 0 ||
		input.delayFrames < 0 ||
		input.settleFrames <= 0 ||
		input.velocityLookback <= 0 ||
		input.decay < 0
	)
		return "Follow-through timing/decay values are invalid.";
	if (input.targets.length < 1)
		return "Follow-through requires at least one follower target.";
	return null;
};

const sampleAt = (
	input: FollowThroughReferenceInput,
	frame: number,
): MotionStudyReferenceResult<FollowThroughReferenceSample> => {
	const issue = inputIssue(input);
	if (issue) return blocked(issue);
	const localFrame = wrapReferenceFrame(frame, input.periodFrames);
	if (localFrame === null)
		return blocked("Follow-through frame must be finite.");
	const leadPosition = input.leadPositionAt(Math.max(0, localFrame));
	const previous = input.leadPositionAt(
		Math.max(0, localFrame - input.velocityLookback),
	);
	const velocity = {
		x: (leadPosition.x - previous.x) / input.velocityLookback,
		y: (leadPosition.y - previous.y) / input.velocityLookback,
	};
	const targets = input.targets.map((target) => {
		const delay = input.delayFrames * target.index;
		const delayed = input.leadPositionAt(Math.max(0, localFrame - delay));
		const lag = {
			x: (delayed.x - leadPosition.x) * input.response,
			y: (delayed.y - leadPosition.y) * input.response,
		};
		const phase =
			wrap(localFrame - delay, input.periodFrames) / input.periodFrames;
		const settle = Math.exp(
			(-input.decay * phase * input.periodFrames) / input.settleFrames,
		);
		const oscillation =
			Math.sin(phase * Math.PI * 2) *
			settle *
			input.settleFrames *
			input.response;
		const translate = {
			x: lag.x + velocity.x * oscillation,
			y: lag.y + velocity.y * oscillation,
		};
		return {
			targetId: target.targetId,
			position: {
				x: target.rest.x + translate.x,
				y: target.rest.y + translate.y,
			},
			rotation: translate.x * input.rotationResponse,
		};
	});
	return {
		status: "ready",
		samples: [
			{ sourceFrame: frame, localFrame, leadPosition, velocity, targets },
		],
	};
};

export function followThroughReferenceCriticalFrames(
	input: FollowThroughReferenceInput,
): MotionStudyReferenceResult<MotionStudyReferenceCriticalFrame> {
	const issue = inputIssue(input);
	if (issue) return blocked(issue);
	return {
		status: "ready",
		samples: [
			{ id: "rest", frame: 0, purpose: "lead rest and zero-seam response" },
			{
				id: "commit",
				frame: input.periodFrames / 4,
				purpose: "lead committed gesture",
			},
			{
				id: "arrival",
				frame: input.periodFrames / 2,
				purpose: "arrival and velocity-derived residual",
			},
			{
				id: "return",
				frame: (input.periodFrames * 3) / 4,
				purpose: "mirrored return",
			},
			{
				id: "loop-seam",
				frame: input.periodFrames,
				purpose: "settled loop seam",
			},
		],
	};
}

export function sampleFollowThroughReference(
	input: FollowThroughReferenceInput,
	frame: number,
): MotionStudyReferenceResult<FollowThroughReferenceSample> {
	return sampleAt(input, frame);
}

export const FOLLOW_THROUGH_REFERENCE_ORACLE: MotionStudyReferenceOracle<
	FollowThroughReferenceInput,
	FollowThroughReferenceSample
> = {
	id: FOLLOW_THROUGH_REFERENCE_LAW_ID,
	criticalFrames: followThroughReferenceCriticalFrames,
	sample: sampleFollowThroughReference,
};

const leadPosition = (frame: number): FollowThroughVec2 => {
	const local = Math.min(120, Math.max(0, frame));
	const points = [
		{ frame: 0, x: 240 },
		{ frame: 30, x: 360 },
		{ frame: 60, x: 480 },
		{ frame: 90, x: 360 },
		{ frame: 120, x: 240 },
	];
	for (let index = 0; index < points.length - 1; index += 1) {
		const from = points[index];
		const to = points[index + 1];
		if (local <= to.frame) {
			const progress = (local - from.frame) / (to.frame - from.frame);
			return { x: from.x + (to.x - from.x) * progress, y: 180 };
		}
	}
	return { x: 240, y: 180 };
};

export const FOLLOW_THROUGH_CONSTRUCTION_FIXTURE: FollowThroughReferenceInput =
	{
		periodFrames: 120,
		delayFrames: 6,
		response: 0.35,
		settleFrames: 36,
		decay: 0.12,
		velocityLookback: 2,
		rotationResponse: 0.08,
		leadPositionAt: leadPosition,
		targets: [
			{
				targetId: "follow-through-follower-1",
				index: 1,
				rest: { x: 360, y: 180 },
			},
			{
				targetId: "follow-through-follower-2",
				index: 2,
				rest: { x: 420, y: 180 },
			},
		],
	};
