import {
	isFiniteReferenceNumber,
	type MotionStudyReferenceCriticalFrame,
	type MotionStudyReferenceOracle,
	type MotionStudyReferenceResult,
	wrapReferenceFrame,
} from "./reference-law-oracle";

export const AFTERIMAGE_REFERENCE_LAW_ID = "historical-pose-echo-v1" as const;

export type AfterimageReferencePose = {
	readonly x: number;
	readonly y: number;
	readonly rotation: number;
	readonly scaleX: number;
	readonly scaleY: number;
};

export type AfterimageReferenceInput = {
	readonly periodFrames: number;
	readonly copies: number;
	readonly delayFrames: number;
	readonly fadePerCopy: number;
	readonly sourceIds: readonly string[];
	readonly loopPolicy: "loop" | "clamp";
	readonly masterPoseAt: (
		sourceId: string,
		frame: number,
	) => AfterimageReferencePose | null;
};

export type AfterimageReferenceEcho = {
	readonly sourceId: string;
	readonly copyIndex: number;
	readonly sourceFrame: number | null;
	readonly opacity: number;
	readonly pose: AfterimageReferencePose | null;
	readonly lifecycle: "present" | "absent";
};

export type AfterimageReferenceSample = {
	readonly sourceFrame: number;
	readonly localFrame: number;
	readonly echoes: readonly AfterimageReferenceEcho[];
};

const blocked = <TSample>(
	reason: string,
): MotionStudyReferenceResult<TSample> => ({
	status: "blocked",
	reason,
});

const inputIssue = (input: AfterimageReferenceInput): string | null => {
	if (
		![
			input.periodFrames,
			input.copies,
			input.delayFrames,
			input.fadePerCopy,
		].every(isFiniteReferenceNumber)
	) {
		return "Afterimage period, copy, delay, and fade values must be finite.";
	}
	if (input.periodFrames <= 0 || input.copies < 0 || input.copies > 64) {
		return "Afterimage period or bounded copy count is invalid.";
	}
	if (input.delayFrames < 0 || input.fadePerCopy < 0 || input.fadePerCopy > 1) {
		return "Afterimage delay must be non-negative and fade must be in [0, 1].";
	}
	if (
		input.sourceIds.length === 0 ||
		new Set(input.sourceIds).size !== input.sourceIds.length
	) {
		return "Afterimage source ids must be non-empty and unique.";
	}
	return null;
};

export function sampleAfterimageReference(
	input: AfterimageReferenceInput,
	frame: number,
): MotionStudyReferenceResult<AfterimageReferenceSample> {
	const issue = inputIssue(input);
	if (issue) return blocked(issue);
	const localFrame = wrapReferenceFrame(frame, input.periodFrames);
	if (localFrame === null) return blocked("Afterimage frame must be finite.");
	const echoes: AfterimageReferenceEcho[] = [];
	for (const sourceId of input.sourceIds) {
		for (
			let copyIndex = 1;
			copyIndex <= Math.floor(input.copies);
			copyIndex += 1
		) {
			const historicalFrame = localFrame - copyIndex * input.delayFrames;
			const sourceFrame =
				input.loopPolicy === "loop"
					? wrapReferenceFrame(historicalFrame, input.periodFrames)
					: historicalFrame >= 0
						? Math.min(historicalFrame, input.periodFrames - Number.EPSILON)
						: null;
			const pose =
				sourceFrame === null ? null : input.masterPoseAt(sourceId, sourceFrame);
			echoes.push({
				sourceId,
				copyIndex,
				sourceFrame,
				opacity: input.fadePerCopy ** copyIndex,
				pose,
				lifecycle: pose ? "present" : "absent",
			});
		}
	}
	return {
		status: "ready",
		samples: [{ sourceFrame: frame, localFrame, echoes }],
	};
}

export function afterimageReferenceCriticalFrames(
	input: AfterimageReferenceInput,
): MotionStudyReferenceResult<MotionStudyReferenceCriticalFrame> {
	const issue = inputIssue(input);
	if (issue) return blocked(issue);
	const lastTailDelay = Math.floor(input.copies) * input.delayFrames;
	return {
		status: "ready",
		samples: [
			{
				id: "rest",
				frame: 0,
				purpose: "master pose and initial artifact lifecycle",
			},
			{
				id: "acceleration",
				frame: Math.min(input.periodFrames / 8, lastTailDelay),
				purpose: "historical tail begins separating from the master",
			},
			{
				id: "maximum-speed",
				frame: input.periodFrames / 2,
				purpose: "maximum pose-history separation probe",
			},
			{
				id: "tail-fused",
				frame: lastTailDelay,
				purpose: "last delayed history reaches the current clip",
			},
			{
				id: "last-present",
				frame: Math.max(0, lastTailDelay),
				purpose: "last-present echo lifecycle boundary",
			},
			{
				id: "first-absent",
				frame: 0,
				purpose:
					"first-absent clamp lifecycle boundary when history is unavailable",
			},
			{
				id: "loop-seam",
				frame: input.periodFrames,
				purpose: "history address closes at the loop seam",
			},
		],
	};
}

export const AFTERIMAGE_REFERENCE_ORACLE: MotionStudyReferenceOracle<
	AfterimageReferenceInput,
	AfterimageReferenceSample
> = {
	id: AFTERIMAGE_REFERENCE_LAW_ID,
	criticalFrames: afterimageReferenceCriticalFrames,
	sample: sampleAfterimageReference,
};
