import {
	isFiniteReferenceNumber,
	type MotionStudyReferenceCriticalFrame,
	type MotionStudyReferenceOracle,
	type MotionStudyReferenceResult,
	wrapReferenceFrame,
} from "./reference-law-oracle";

export const MERGE_SPLIT_REFERENCE_LAW_ID =
	"delayed-gather-absorb-return-v1" as const;

export type MergeSplitReferenceRole = "member" | "core";
export type MergeSplitReferencePoint = {
	readonly x: number;
	readonly y: number;
};
export type MergeSplitReferenceTarget = {
	readonly targetId: string;
	readonly role: MergeSplitReferenceRole;
	readonly rest: MergeSplitReferencePoint;
};
export type MergeSplitReferenceInput = {
	readonly periodFrames: number;
	readonly strength: number;
	readonly scaleFloor: number;
	readonly opacityFloor: number;
	readonly gatherFraction: number;
	readonly holdFraction: number;
	readonly returnFraction: number;
	readonly staggerFrames: number;
	readonly ringTurnDegrees: number;
	readonly returnOvershoot: number;
	readonly coreScaleGain: number;
	readonly targets: readonly MergeSplitReferenceTarget[];
};
export type MergeSplitReferenceTargetSample = {
	readonly targetId: string;
	readonly role: MergeSplitReferenceRole;
	readonly position: MergeSplitReferencePoint;
	readonly scale: number;
	readonly opacity: number;
	readonly absorb: number;
	readonly distanceFactor: number;
};
export type MergeSplitReferenceSample = {
	readonly sourceFrame: number;
	readonly targets: readonly MergeSplitReferenceTargetSample[];
	readonly averageAbsorb: number;
	readonly coreScale: number;
};

const blocked = <TSample>(
	reason: string,
): MotionStudyReferenceResult<TSample> => ({
	status: "blocked",
	reason,
});

const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));
const smoothstep = (value: number): number => {
	const t = clamp(value, 0, 1);
	return t * t * (3 - 2 * t);
};
const rotate = (
	point: MergeSplitReferencePoint,
	degrees: number,
): MergeSplitReferencePoint => {
	const radians = (degrees * Math.PI) / 180;
	const cosine = Math.cos(radians);
	const sine = Math.sin(radians);
	return {
		x: point.x * cosine - point.y * sine,
		y: point.x * sine + point.y * cosine,
	};
};
const subtract = (
	left: MergeSplitReferencePoint,
	right: MergeSplitReferencePoint,
) => ({
	x: left.x - right.x,
	y: left.y - right.y,
});
const add = (
	left: MergeSplitReferencePoint,
	right: MergeSplitReferencePoint,
) => ({
	x: left.x + right.x,
	y: left.y + right.y,
});
const scale = (point: MergeSplitReferencePoint, value: number) => ({
	x: point.x * value,
	y: point.y * value,
});

const inputIssue = (input: MergeSplitReferenceInput): string | null => {
	const numericValues = [
		input.periodFrames,
		input.strength,
		input.scaleFloor,
		input.opacityFloor,
		input.gatherFraction,
		input.holdFraction,
		input.returnFraction,
		input.staggerFrames,
		input.ringTurnDegrees,
		input.returnOvershoot,
		input.coreScaleGain,
	];
	if (!numericValues.every(isFiniteReferenceNumber)) {
		return "Merge / Split timing, gather, return, and core values must be finite.";
	}
	if (!Number.isInteger(input.periodFrames) || input.periodFrames <= 0) {
		return "Merge / Split period must be a positive integer.";
	}
	if (input.targets.filter((target) => target.role === "member").length < 2) {
		return "Merge / Split needs at least two members plus an optional core.";
	}
	if (
		input.targets.some(
			(target) =>
				!target.targetId ||
				!isFiniteReferenceNumber(target.rest.x) ||
				!isFiniteReferenceNumber(target.rest.y),
		)
	) {
		return "Merge / Split targets need unique ids and finite rest points.";
	}
	return null;
};

const clipState = (
	phase: number,
	input: MergeSplitReferenceInput,
	index: number,
) => {
	const gather = Math.max(0.05, input.gatherFraction);
	const hold = Math.max(0, input.holdFraction);
	const release = Math.max(0.05, input.returnFraction);
	const settle = Math.max(0, 1 - gather - hold - release);
	const duration = gather + hold + release + settle;
	const gatherEnd = gather / duration;
	const holdEnd = (gather + hold) / duration;
	const releaseEnd = (gather + hold + release) / duration;
	const local =
		(((phase - (index * input.staggerFrames) / input.periodFrames) % 1) + 1) %
		1;
	if (local < gatherEnd) {
		const absorb = smoothstep(local / gatherEnd);
		return {
			absorb,
			distanceFactor: 1 - clamp(input.strength, 0, 1.5) * absorb,
		};
	}
	if (local < holdEnd) {
		return { absorb: 1, distanceFactor: 1 - clamp(input.strength, 0, 1.5) };
	}
	if (local < releaseEnd) {
		const progress = smoothstep(
			(local - holdEnd) / Math.max(1e-6, releaseEnd - holdEnd),
		);
		return {
			absorb: 1 - progress,
			distanceFactor:
				1 -
				clamp(input.strength, 0, 1.5) +
				clamp(input.strength, 0, 1.5) *
					(progress + input.returnOvershoot * Math.sin(progress * Math.PI)),
		};
	}
	return { absorb: 0, distanceFactor: 1 };
};

const sampleAt = (
	input: MergeSplitReferenceInput,
	frame: number,
): MotionStudyReferenceResult<MergeSplitReferenceSample> => {
	const issue = inputIssue(input);
	if (issue) return blocked(issue);
	if (!isFiniteReferenceNumber(frame))
		return blocked("Merge / Split source frame must be finite.");
	const members = input.targets.filter((target) => target.role === "member");
	const core = input.targets.find((target) => target.role === "core");
	const center =
		core?.rest ??
		members.reduce(
			(sum, target) => add(sum, scale(target.rest, 1 / members.length)),
			{ x: 0, y: 0 },
		);
	const phase =
		(wrapReferenceFrame(frame, input.periodFrames) ?? 0) / input.periodFrames;
	let absorbSum = 0;
	const samples: MergeSplitReferenceTargetSample[] = [];
	let memberIndex = 0;
	for (const target of input.targets) {
		if (target.role === "core") continue;
		const delta = subtract(target.rest, center);
		const distance = Math.hypot(delta.x, delta.y);
		const radial = distance > 1e-6 ? delta : { x: 48, y: 0 };
		const seat = rotate(radial, input.ringTurnDegrees * phase);
		const state = clipState(phase, input, memberIndex);
		memberIndex += 1;
		absorbSum += state.absorb;
		const position = add(center, scale(seat, state.distanceFactor));
		samples.push({
			targetId: target.targetId,
			role: target.role,
			position,
			scale: 1 - (1 - input.scaleFloor) * state.absorb,
			opacity: 1 - (1 - input.opacityFloor) * state.absorb,
			absorb: state.absorb,
			distanceFactor: state.distanceFactor,
		});
	}
	const averageAbsorb = absorbSum / members.length;
	if (core) {
		samples.push({
			targetId: core.targetId,
			role: core.role,
			position: core.rest,
			scale: 1 + input.coreScaleGain * Math.sqrt(clamp(averageAbsorb, 0, 1)),
			opacity: 1,
			absorb: averageAbsorb,
			distanceFactor: 0,
		});
	}
	return {
		status: "ready",
		samples: [
			{
				sourceFrame: frame,
				targets: samples,
				averageAbsorb,
				coreScale:
					1 + input.coreScaleGain * Math.sqrt(clamp(averageAbsorb, 0, 1)),
			},
		],
	};
};

const criticalFrames = (
	input: MergeSplitReferenceInput,
): MotionStudyReferenceResult<MotionStudyReferenceCriticalFrame> => {
	const issue = inputIssue(input);
	if (issue) return blocked(issue);
	const gather = clamp(input.gatherFraction, 0.05, 0.7);
	const hold = clamp(input.holdFraction, 0, 0.7);
	const release = clamp(input.returnFraction, 0.05, 0.9);
	const denominator =
		gather + hold + release + Math.max(0, 1 - gather - hold - release);
	const gatherFrame = input.periodFrames * (gather / denominator);
	const holdFrame = input.periodFrames * ((gather + hold / 2) / denominator);
	const releaseFrame =
		input.periodFrames * ((gather + hold + release / 2) / denominator);
	return {
		status: "ready",
		samples: [
			{
				id: "loop-start",
				frame: 0,
				purpose: "Unmerged turning seats at the loop start.",
			},
			{
				id: "gather-peak",
				frame: gatherFrame,
				purpose: "Members have reached the shared core.",
			},
			{
				id: "hold-core",
				frame: holdFrame,
				purpose: "Core area is derived from absorbed member share.",
			},
			{
				id: "return-midpoint",
				frame: releaseFrame,
				purpose: "Members reseat with the declared return overshoot.",
			},
			{
				id: "loop-seam",
				frame: input.periodFrames,
				purpose: "The delayed clip and seat turn close the loop.",
			},
		],
	};
};

export const mergeSplitReferenceOracle: MotionStudyReferenceOracle<
	MergeSplitReferenceInput,
	MergeSplitReferenceSample
> = {
	id: MERGE_SPLIT_REFERENCE_LAW_ID,
	sample: sampleAt,
	criticalFrames,
};

export function sampleMergeSplitReference(
	input: MergeSplitReferenceInput,
	frame: number,
): MotionStudyReferenceResult<MergeSplitReferenceSample> {
	return sampleAt(input, frame);
}

export function mergeSplitReferenceCriticalFrames(
	input: MergeSplitReferenceInput,
): MotionStudyReferenceResult<MotionStudyReferenceCriticalFrame> {
	return criticalFrames(input);
}
