import type {
	ArrangementLayoutSnapshot,
	Vec2,
} from "@/entities/scene/model/types";
import {
	isFiniteReferenceNumber,
	type MotionStudyReferenceCriticalFrame,
	type MotionStudyReferenceOracle,
	type MotionStudyReferenceResult,
} from "./reference-law-oracle";

export const ARRANGEMENT_REFERENCE_LAW_ID =
	"authored-layout-gather-turn-return-v1" as const;

export type ArrangementReferenceInput = {
	readonly periodFrames: number;
	readonly phaseStartFrame: number;
	readonly sourceSnapshot: ArrangementLayoutSnapshot;
	readonly destinationSnapshot: ArrangementLayoutSnapshot;
	readonly sourceToStage: Readonly<Record<string, string>>;
	readonly stageToDestination: Readonly<Record<string, string>>;
	readonly stageSlots: Readonly<Record<string, Vec2>>;
	readonly pivot: Vec2;
	readonly gatherFraction: number;
	readonly holdFraction: number;
	readonly sharedTurnDegrees: number;
	readonly lobeDepth: number;
	readonly stagingDelayFractionBySource?: Readonly<Record<string, number>>;
};

export type ArrangementReferencePhase =
	| "source-rest"
	| "gather-lobe"
	| "stage-hold"
	| "shared-turn-return"
	| "destination-rest";

export type ArrangementReferenceTargetSample = {
	readonly sourceNodeId: string;
	readonly destinationNodeId: string;
	readonly stageSlotId: string;
	readonly source: Vec2;
	readonly gather: Vec2;
	readonly stage: Vec2;
	readonly rotatedStage: Vec2;
	readonly destination: Vec2;
	readonly position: Vec2;
	readonly phase: ArrangementReferencePhase;
	readonly localProgress: number;
	readonly sharedTurnProgress: number;
};

export type ArrangementReferenceSample = {
	readonly sourceFrame: number;
	readonly globalProgress: number;
	readonly targets: readonly ArrangementReferenceTargetSample[];
};

const blocked = <TSample>(
	reason: string,
): MotionStudyReferenceResult<TSample> => ({
	status: "blocked",
	reason,
});

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const lerp = (from: Vec2, to: Vec2, amount: number): Vec2 => ({
	x: from.x + (to.x - from.x) * amount,
	y: from.y + (to.y - from.y) * amount,
});

const rotateAround = (point: Vec2, pivot: Vec2, degrees: number): Vec2 => {
	const radians = (degrees * Math.PI) / 180;
	const cosine = Math.cos(radians);
	const sine = Math.sin(radians);
	const x = point.x - pivot.x;
	const y = point.y - pivot.y;
	return {
		x: pivot.x + x * cosine - y * sine,
		y: pivot.y + x * sine + y * cosine,
	};
};

const finitePoint = (point: Vec2): boolean =>
	Number.isFinite(point.x) && Number.isFinite(point.y);

const inputIssue = (input: ArrangementReferenceInput): string | null => {
	if (
		![
			input.periodFrames,
			input.phaseStartFrame,
			input.gatherFraction,
			input.holdFraction,
			input.sharedTurnDegrees,
			input.lobeDepth,
			input.pivot.x,
			input.pivot.y,
		].every(isFiniteReferenceNumber)
	) {
		return "Arrangement timing, pivot, and turn values must be finite.";
	}
	if (input.periodFrames <= 0) return "Arrangement period must be positive.";
	if (input.gatherFraction <= 0 || input.gatherFraction >= 1) {
		return "Arrangement gather fraction must be strictly between zero and one.";
	}
	if (
		input.holdFraction < 0 ||
		input.gatherFraction + input.holdFraction >= 1
	) {
		return "Arrangement hold fraction must leave a positive return phase.";
	}
	if (input.lobeDepth <= 0 || input.lobeDepth > 1) {
		return "Arrangement lobe depth must be greater than zero and at most one.";
	}
	if (!finitePoint(input.pivot)) return "Arrangement pivot must be finite.";
	const sourceIds = input.sourceSnapshot.memberNodeIds;
	if (sourceIds.length === 0 || new Set(sourceIds).size !== sourceIds.length) {
		return "Arrangement source snapshot must contain unique members.";
	}
	if (
		input.sourceSnapshot.coordinateSpace !== "artboard-local" ||
		input.destinationSnapshot.coordinateSpace !== "artboard-local"
	) {
		return "Arrangement snapshots must use artboard-local coordinates.";
	}
	if (
		input.sourceSnapshot.artboardId !== input.destinationSnapshot.artboardId
	) {
		return "Arrangement source and destination snapshots must share an artboard.";
	}
	if (input.destinationSnapshot.memberNodeIds.length !== sourceIds.length) {
		return "Arrangement source and destination counts must match explicitly.";
	}
	const destinationIds = new Set(input.destinationSnapshot.memberNodeIds);
	if (destinationIds.size !== input.destinationSnapshot.memberNodeIds.length) {
		return "Arrangement destination snapshot must contain unique members.";
	}
	const mappedDestinations = new Set<string>();
	for (const sourceId of sourceIds) {
		const source = input.sourceSnapshot.positions[sourceId];
		const stageSlotId = input.sourceToStage[sourceId];
		const destinationId = input.stageToDestination[sourceId];
		const stage = stageSlotId ? input.stageSlots[stageSlotId] : undefined;
		const destination = destinationId
			? input.destinationSnapshot.positions[destinationId]
			: undefined;
		if (!source || !stage || !destination) {
			return `Arrangement mapping is incomplete for source ${sourceId}.`;
		}
		if (
			!finitePoint(source) ||
			!finitePoint(stage) ||
			!finitePoint(destination)
		) {
			return `Arrangement mapping contains a non-finite point for source ${sourceId}.`;
		}
		if (mappedDestinations.has(destinationId)) {
			return "Arrangement source-to-destination mapping must be one-to-one.";
		}
		mappedDestinations.add(destinationId);
		const delay = input.stagingDelayFractionBySource?.[sourceId] ?? 0;
		if (!isFiniteReferenceNumber(delay) || delay < 0 || delay >= 1) {
			return `Arrangement delay must be in [0, 1) for source ${sourceId}.`;
		}
	}
	if (mappedDestinations.size !== destinationIds.size) {
		return "Arrangement destination mapping must cover every destination member.";
	}
	return null;
};

const localProgressAt = (globalProgress: number, delay: number): number =>
	clamp01((globalProgress - delay) / (1 - delay));

const targetAt = (
	input: ArrangementReferenceInput,
	sourceNodeId: string,
	globalProgress: number,
): ArrangementReferenceTargetSample | null => {
	const destinationNodeId = input.stageToDestination[sourceNodeId];
	const stageSlotId = input.sourceToStage[sourceNodeId];
	if (!destinationNodeId || !stageSlotId) return null;
	const source = input.sourceSnapshot.positions[sourceNodeId];
	const stage = input.stageSlots[stageSlotId];
	const destination = input.destinationSnapshot.positions[destinationNodeId];
	if (!source || !stage || !destination) return null;
	const delay = input.stagingDelayFractionBySource?.[sourceNodeId] ?? 0;
	const localProgress = localProgressAt(globalProgress, delay);
	const gatherEnd = input.gatherFraction;
	const holdEnd = input.gatherFraction + input.holdFraction;
	const returnFraction = 1 - holdEnd;
	const gather = lerp(source, input.pivot, input.lobeDepth);
	const rotatedStage = rotateAround(
		stage,
		input.pivot,
		input.sharedTurnDegrees,
	);
	let position = source;
	let phase: ArrangementReferencePhase = "source-rest";
	let sharedTurnProgress = 0;
	if (localProgress > 0 && localProgress < gatherEnd) {
		phase = "gather-lobe";
		position = lerp(source, gather, localProgress / gatherEnd);
	} else if (localProgress < holdEnd) {
		phase = "stage-hold";
		position = lerp(
			gather,
			stage,
			(localProgress - gatherEnd) / (holdEnd - gatherEnd || 1),
		);
	} else if (localProgress < 1) {
		phase = "shared-turn-return";
		const returnProgress = clamp01((localProgress - holdEnd) / returnFraction);
		sharedTurnProgress = returnProgress;
		const turned = rotateAround(
			stage,
			input.pivot,
			input.sharedTurnDegrees * returnProgress,
		);
		position = lerp(turned, destination, returnProgress);
	} else {
		phase = "destination-rest";
		position = destination;
		sharedTurnProgress = 1;
	}
	return {
		sourceNodeId,
		destinationNodeId,
		stageSlotId,
		source,
		gather,
		stage,
		rotatedStage,
		destination,
		position,
		phase,
		localProgress,
		sharedTurnProgress,
	};
};

const sampleAt = (
	input: ArrangementReferenceInput,
	frame: number,
): MotionStudyReferenceResult<ArrangementReferenceSample> => {
	const issue = inputIssue(input);
	if (issue) return blocked(issue);
	if (!isFiniteReferenceNumber(frame))
		return blocked("Arrangement source frame must be finite.");
	const globalProgress = clamp01(
		(frame - input.phaseStartFrame) / input.periodFrames,
	);
	const targets: ArrangementReferenceTargetSample[] = [];
	for (const sourceNodeId of input.sourceSnapshot.memberNodeIds) {
		const target = targetAt(input, sourceNodeId, globalProgress);
		if (!target)
			return blocked(
				`Arrangement target ${sourceNodeId} could not be sampled.`,
			);
		targets.push(target);
	}
	return {
		status: "ready",
		samples: [{ sourceFrame: frame, globalProgress, targets }],
	};
};

export function arrangementReferenceCriticalFrames(
	input: ArrangementReferenceInput,
): MotionStudyReferenceResult<MotionStudyReferenceCriticalFrame> {
	const issue = inputIssue(input);
	if (issue) return blocked(issue);
	const holdEnd = input.gatherFraction + input.holdFraction;
	const returnFraction = 1 - holdEnd;
	return {
		status: "ready",
		samples: [
			{
				id: "source-rest",
				frame: input.phaseStartFrame,
				purpose: "named source layout before reclassification",
			},
			{
				id: "maximum-lobe",
				frame:
					input.phaseStartFrame + input.periodFrames * input.gatherFraction,
				purpose: "centreward gather reaches the lobe boundary",
			},
			{
				id: "stage-seating",
				frame: input.phaseStartFrame + input.periodFrames * holdEnd,
				purpose: "all mapped staging slots are seated before the shared turn",
			},
			{
				id: "shared-turn",
				frame:
					input.phaseStartFrame +
					input.periodFrames * (holdEnd + returnFraction / 2),
				purpose: "one shared turn is visible before chord return",
			},
			{
				id: "destination-rest",
				frame: input.phaseStartFrame + input.periodFrames,
				purpose: "mapped destination layout is fully seated",
			},
			{
				id: "loop-seam",
				frame: input.phaseStartFrame + input.periodFrames,
				purpose:
					"destination hold is explicit; no source-layout remap is guessed",
			},
		],
	};
}

export function sampleArrangementReference(
	input: ArrangementReferenceInput,
	frame: number,
): MotionStudyReferenceResult<ArrangementReferenceSample> {
	return sampleAt(input, frame);
}

export const ARRANGEMENT_REFERENCE_ORACLE: MotionStudyReferenceOracle<
	ArrangementReferenceInput,
	ArrangementReferenceSample
> = {
	id: ARRANGEMENT_REFERENCE_LAW_ID,
	criticalFrames: arrangementReferenceCriticalFrames,
	sample: sampleArrangementReference,
};
