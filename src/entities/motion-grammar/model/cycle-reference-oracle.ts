import {
	isFiniteReferenceNumber,
	type MotionStudyReferenceCriticalFrame,
	type MotionStudyReferenceOracle,
	type MotionStudyReferenceResult,
	wrapReferenceFrame,
} from "./reference-law-oracle";

export const CYCLE_REFERENCE_LAW_ID = "closed-lap-whip-crawl-v1" as const;

export type CycleReferencePathSample = {
	readonly point: { readonly x: number; readonly y: number };
	readonly tangent: { readonly x: number; readonly y: number };
	readonly angleDegrees: number;
};

/**
 * Transient source-law input. The path callback is an observation harness
 * dependency, never executable or serialized document state.
 */
export type CycleReferenceInput = {
	readonly periodFrames: number;
	readonly phaseStartFrame: number;
	readonly whipDurationFrames: number;
	readonly whipSpanFraction: number;
	readonly windowFraction: number;
	readonly headLagFraction: number;
	readonly pathLength: number;
	readonly pathSampleAt: (progress: number) => CycleReferencePathSample | null;
};

export type CycleReferenceSample = {
	readonly sourceFrame: number;
	readonly localFrame: number;
	readonly headProgress: number;
	readonly tailProgress: number;
	readonly headDotProgress: number;
	readonly head: CycleReferencePathSample;
	readonly tail: CycleReferencePathSample;
	readonly headDot: CycleReferencePathSample;
	readonly dashOffset: number;
	readonly phase: "whip" | "crawl";
	readonly whipProgress: number;
	readonly crawlProgress: number;
	readonly derivedCrawlDurationFrames: number;
	readonly derivedCrawlSpeedFractionPerFrame: number;
};

const blocked = <TSample>(
	reason: string,
): MotionStudyReferenceResult<TSample> => ({
	status: "blocked",
	reason,
});

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const wrapUnit = (value: number): number => ((value % 1) + 1) % 1;

const inputIssue = (input: CycleReferenceInput): string | null => {
	if (
		![
			input.periodFrames,
			input.phaseStartFrame,
			input.whipDurationFrames,
			input.whipSpanFraction,
			input.windowFraction,
			input.headLagFraction,
			input.pathLength,
		].every(isFiniteReferenceNumber)
	) {
		return "Cycle source-law timing, window, and path values must be finite.";
	}
	if (input.periodFrames <= 0) {
		return "Cycle period must be positive.";
	}
	if (
		input.whipDurationFrames <= 0 ||
		input.whipDurationFrames >= input.periodFrames
	) {
		return "Cycle whip duration must leave a positive derived crawl duration.";
	}
	if (input.whipSpanFraction <= 0 || input.whipSpanFraction >= 1) {
		return "Cycle whip span must be strictly between zero and one lap.";
	}
	if (input.windowFraction <= 0 || input.windowFraction > 1) {
		return "Cycle stroke window fraction must be positive and at most one lap.";
	}
	if (input.pathLength <= 0) {
		return "Cycle path length must be positive.";
	}
	const atStart = input.pathSampleAt(0);
	const atSeam = input.pathSampleAt(1);
	if (!atStart || !atSeam) {
		return "Cycle path sampler must return a closed-path sample at both seam endpoints.";
	}
	if (
		Math.hypot(
			atStart.point.x - atSeam.point.x,
			atStart.point.y - atSeam.point.y,
		) > 1e-4
	) {
		return "Cycle path seam must close in position before motion sampling.";
	}
	return null;
};

const pathSample = (
	input: CycleReferenceInput,
	progress: number,
): CycleReferencePathSample | null => input.pathSampleAt(wrapUnit(progress));

const headProgressAt = (
	input: CycleReferenceInput,
	localFrame: number,
): {
	headProgress: number;
	phase: "whip" | "crawl";
	whipProgress: number;
	crawlProgress: number;
} => {
	const whipProgress = clamp01(localFrame / input.whipDurationFrames);
	if (localFrame <= input.whipDurationFrames) {
		return {
			headProgress: input.whipSpanFraction * whipProgress,
			phase: "whip",
			whipProgress,
			crawlProgress: 0,
		};
	}
	const derivedCrawlDurationFrames =
		input.periodFrames - input.whipDurationFrames;
	const crawlProgress = clamp01(
		(localFrame - input.whipDurationFrames) / derivedCrawlDurationFrames,
	);
	return {
		headProgress:
			input.whipSpanFraction + (1 - input.whipSpanFraction) * crawlProgress,
		phase: "crawl",
		whipProgress: 1,
		crawlProgress,
	};
};

const sampleAt = (
	input: CycleReferenceInput,
	frame: number,
): MotionStudyReferenceResult<CycleReferenceSample> => {
	const issue = inputIssue(input);
	if (issue) return blocked(issue);
	const localFrame = wrapReferenceFrame(
		frame - input.phaseStartFrame,
		input.periodFrames,
	);
	if (localFrame === null) return blocked("Cycle source frame must be finite.");
	const progress = headProgressAt(input, localFrame);
	const headProgress = wrapUnit(progress.headProgress);
	const tailProgress = wrapUnit(headProgress - input.windowFraction);
	const headDotProgress = wrapUnit(headProgress + input.headLagFraction);
	const head = pathSample(input, headProgress);
	const tail = pathSample(input, tailProgress);
	const headDot = pathSample(input, headDotProgress);
	if (!head || !tail || !headDot) {
		return blocked(
			"Cycle path sampler omitted a head, tail, or head-dot sample.",
		);
	}
	const derivedCrawlDurationFrames =
		input.periodFrames - input.whipDurationFrames;
	return {
		status: "ready",
		samples: [
			{
				sourceFrame: frame,
				localFrame,
				headProgress,
				tailProgress,
				headDotProgress,
				head,
				tail,
				headDot,
				dashOffset: -headProgress * input.pathLength,
				phase: progress.phase,
				whipProgress: progress.whipProgress,
				crawlProgress: progress.crawlProgress,
				derivedCrawlDurationFrames,
				derivedCrawlSpeedFractionPerFrame:
					(1 - input.whipSpanFraction) / derivedCrawlDurationFrames,
			},
		],
	};
};

export function cycleReferenceCriticalFrames(
	input: CycleReferenceInput,
): MotionStudyReferenceResult<MotionStudyReferenceCriticalFrame> {
	const issue = inputIssue(input);
	if (issue) return blocked(issue);
	const crawlDuration = input.periodFrames - input.whipDurationFrames;
	return {
		status: "ready",
		samples: [
			{
				id: "loop-start",
				frame: input.phaseStartFrame,
				purpose: "closed-lap origin and whip entry",
			},
			{
				id: "whip-midpoint",
				frame: input.phaseStartFrame + input.whipDurationFrames / 2,
				purpose: "mid-whip path sample and shared head progress",
			},
			{
				id: "whip-end",
				frame: input.phaseStartFrame + input.whipDurationFrames,
				purpose: "derived crawl begins after the direct whip budget",
			},
			{
				id: "crawl-midpoint",
				frame:
					input.phaseStartFrame + input.whipDurationFrames + crawlDuration / 2,
				purpose: "derived crawl span and speed, not an independent clock",
			},
			{
				id: "window-wrap-probe",
				frame:
					input.phaseStartFrame + input.periodFrames * input.windowFraction,
				purpose: "tail/head-dot window relation across the path metric",
			},
			{
				id: "loop-seam",
				frame: input.phaseStartFrame + input.periodFrames,
				purpose: "one lap closes at the same path seam",
			},
		],
	};
}

export function sampleCycleReference(
	input: CycleReferenceInput,
	frame: number,
): MotionStudyReferenceResult<CycleReferenceSample> {
	return sampleAt(input, frame);
}

export const CYCLE_REFERENCE_ORACLE: MotionStudyReferenceOracle<
	CycleReferenceInput,
	CycleReferenceSample
> = {
	id: CYCLE_REFERENCE_LAW_ID,
	criticalFrames: cycleReferenceCriticalFrames,
	sample: sampleCycleReference,
};
