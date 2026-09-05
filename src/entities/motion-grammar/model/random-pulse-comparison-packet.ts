import {
	RANDOM_PULSE_CANDIDATE_SURFACE,
	type RandomPulseCandidateAuthoringObservation,
	type RandomPulseCandidateIncompatibility,
	type RandomPulseCandidateProfileObservation,
	type RandomPulsePresentationCandidateInput,
	type RandomPulsePresentationCandidateSample,
	sampleRandomPulsePresentationCandidate,
} from "./random-pulse-presentation-candidate";
import {
	type RandomPulseReferenceInput,
	type RandomPulseReferenceSample,
	randomPulseReferenceCriticalFrames,
	sampleRandomPulseReference,
} from "./random-pulse-reference-oracle";

export const RANDOM_PULSE_COMPARISON_METRIC =
	"shared-presentation-pulse-structural" as const;

export type RandomPulseComparisonPair = {
	readonly targetId: string;
	readonly reference: RandomPulseReferenceSample;
	readonly candidate: RandomPulsePresentationCandidateSample;
	readonly delta: {
		readonly scale: number;
		readonly opacity: number;
		readonly pulseFromScale: number;
		readonly rankMatches: boolean;
		readonly seamStateMatches: boolean;
	};
};

export type RandomPulseComparisonFrame = {
	readonly id: string;
	readonly purpose: string;
	readonly sourceFrame: number;
	readonly pairs: readonly RandomPulseComparisonPair[];
};

export type RandomPulseComparisonSummary = {
	readonly rankOrderMatches: boolean;
	readonly sharedEnvelopeMatches: boolean;
	readonly seamRestMatches: boolean;
	readonly maxScaleResidual: number;
	readonly maxOpacityResidual: number;
	readonly maxPulseResidual: number;
	readonly mismatchedRanks: number;
	readonly mismatchedSeams: number;
};

export type RandomPulseComparisonPacket =
	| {
			readonly status: "blocked";
			readonly reason: string;
	  }
	| {
			readonly status: "incompatible";
			readonly candidateSurface: typeof RANDOM_PULSE_CANDIDATE_SURFACE;
			readonly metric: typeof RANDOM_PULSE_COMPARISON_METRIC;
			readonly profile: RandomPulseCandidateProfileObservation;
			readonly authoring: RandomPulseCandidateAuthoringObservation;
			readonly incompatibilities: readonly RandomPulseCandidateIncompatibility[];
			readonly summary: RandomPulseComparisonSummary;
			readonly frames: readonly RandomPulseComparisonFrame[];
	  }
	| {
			readonly status: "ready";
			readonly candidateSurface: typeof RANDOM_PULSE_CANDIDATE_SURFACE;
			readonly metric: typeof RANDOM_PULSE_COMPARISON_METRIC;
			readonly profile: RandomPulseCandidateProfileObservation;
			readonly authoring: RandomPulseCandidateAuthoringObservation;
			readonly summary: RandomPulseComparisonSummary;
			readonly frames: readonly RandomPulseComparisonFrame[];
	  };

const BLOCKED = (reason: string): RandomPulseComparisonPacket => ({
	status: "blocked",
	reason,
});

const finiteAbs = (value: number): number =>
	Number.isFinite(value) ? Math.abs(value) : Number.POSITIVE_INFINITY;

const approximateEqual = (left: number, right: number): boolean =>
	finiteAbs(left - right) <= 1e-9;

const pairSamples = (
	reference: readonly RandomPulseReferenceSample[],
	candidate: readonly RandomPulsePresentationCandidateSample[],
): readonly RandomPulseComparisonPair[] | string => {
	const candidateByTarget = new Map(
		candidate.map((sample) => [sample.targetId, sample] as const),
	);
	if (reference.length !== candidateByTarget.size) {
		return "Random Pulse source and candidate return different target counts.";
	}
	const pairs: RandomPulseComparisonPair[] = [];
	for (const sourceSample of reference) {
		const candidateSample = candidateByTarget.get(sourceSample.targetId);
		if (!candidateSample) {
			return "Random Pulse source and candidate return different target identities.";
		}
		const candidatePulse = candidateSample.pulseFromScale ?? 0;
		pairs.push({
			targetId: sourceSample.targetId,
			reference: sourceSample,
			candidate: candidateSample,
			delta: {
				scale: candidateSample.scaleX - sourceSample.scale,
				opacity: candidateSample.opacity - sourceSample.opacity,
				pulseFromScale: candidatePulse - sourceSample.pulse,
				rankMatches: candidateSample.rank === sourceSample.rank,
				seamStateMatches:
					(sourceSample.seamState === "active") === (candidatePulse !== 0),
			},
		});
	}
	return pairs;
};

const summaryFor = (
	frames: readonly RandomPulseComparisonFrame[],
	profile: RandomPulseCandidateProfileObservation,
	input: RandomPulseReferenceInput,
): RandomPulseComparisonSummary => {
	const expectedOrder = [...input.targets]
		.sort((left, right) => left.rank - right.rank)
		.map((target) => target.targetId);
	const rankOrderMatches =
		profile.order.length === expectedOrder.length &&
		profile.order.every((targetId, index) => targetId === expectedOrder[index]);
	let maxScaleResidual = 0;
	let maxOpacityResidual = 0;
	let maxPulseResidual = 0;
	let mismatchedRanks = 0;
	let mismatchedSeams = 0;
	for (const frame of frames) {
		for (const pair of frame.pairs) {
			maxScaleResidual = Math.max(
				maxScaleResidual,
				finiteAbs(pair.delta.scale),
			);
			maxOpacityResidual = Math.max(
				maxOpacityResidual,
				finiteAbs(pair.delta.opacity),
			);
			maxPulseResidual = Math.max(
				maxPulseResidual,
				finiteAbs(pair.delta.pulseFromScale),
			);
			if (!pair.delta.rankMatches) mismatchedRanks += 1;
			if (!pair.delta.seamStateMatches) mismatchedSeams += 1;
		}
	}
	const sharedEnvelopeMatches = frames.every((frame) =>
		frame.pairs.every(
			(pair) =>
				approximateEqual(pair.reference.scale, pair.candidate.scaleX) &&
				approximateEqual(pair.reference.opacity, pair.candidate.opacity) &&
				approximateEqual(
					pair.reference.pulse,
					pair.candidate.pulseFromScale ?? 0,
				),
		),
	);
	const seamFrame = frames.find((frame) => frame.id === "loop-seam");
	const openingFrame = frames.find((frame) => frame.id === "loop-start");
	const seamRestMatches = Boolean(
		seamFrame &&
			openingFrame &&
			seamFrame.pairs.length === openingFrame.pairs.length &&
			seamFrame.pairs.every((seamPair) => {
				const openingPair = openingFrame.pairs.find(
					(candidate) => candidate.targetId === seamPair.targetId,
				);
				return Boolean(
					openingPair &&
						approximateEqual(
							seamPair.candidate.scaleX,
							openingPair.candidate.scaleX,
						) &&
						approximateEqual(
							seamPair.candidate.opacity,
							openingPair.candidate.opacity,
						),
				);
			}),
	);
	return {
		rankOrderMatches,
		sharedEnvelopeMatches,
		seamRestMatches,
		maxScaleResidual,
		maxOpacityResidual,
		maxPulseResidual,
		mismatchedRanks,
		mismatchedSeams,
	};
};

/**
 * Builds a Random Pulse packet from an independent explicit-rank oracle and
 * the document-owned shared-presentation candidate. A sine evaluator is
 * retained as an informative `incompatible` packet, never promoted silently.
 */
export function buildRandomPulseComparisonPacket(
	input: RandomPulsePresentationCandidateInput,
): RandomPulseComparisonPacket {
	const criticalFrames = randomPulseReferenceCriticalFrames(input.source);
	if (criticalFrames.status === "blocked")
		return BLOCKED(criticalFrames.reason);
	const frames: RandomPulseComparisonFrame[] = [];
	let profile: RandomPulseCandidateProfileObservation | undefined;
	let authoring: RandomPulseCandidateAuthoringObservation | undefined;
	let incompatibilities: readonly RandomPulseCandidateIncompatibility[] = [];
	let candidateWasIncompatible = false;
	for (const criticalFrame of criticalFrames.samples) {
		const reference = sampleRandomPulseReference(
			input.source,
			criticalFrame.frame,
		);
		if (reference.status === "blocked") return BLOCKED(reference.reason);
		const candidate = sampleRandomPulsePresentationCandidate(
			input,
			criticalFrame.frame,
		);
		if (candidate.status === "blocked") return BLOCKED(candidate.reason);
		profile ??= candidate.profile;
		authoring ??= candidate.authoring;
		if (candidate.status === "incompatible") {
			candidateWasIncompatible = true;
			incompatibilities = candidate.incompatibilities;
		}
		const pairs = pairSamples(reference.samples, candidate.samples);
		if (typeof pairs === "string") return BLOCKED(pairs);
		frames.push({
			id: criticalFrame.id,
			purpose: criticalFrame.purpose,
			sourceFrame: criticalFrame.frame,
			pairs,
		});
	}
	if (!profile || !authoring) {
		return BLOCKED(
			"Random Pulse comparison did not produce a candidate profile observation.",
		);
	}
	const summary = summaryFor(frames, profile, input.source);
	if (
		candidateWasIncompatible ||
		!summary.rankOrderMatches ||
		!summary.sharedEnvelopeMatches ||
		!summary.seamRestMatches
	) {
		return {
			status: "incompatible",
			candidateSurface: RANDOM_PULSE_CANDIDATE_SURFACE,
			metric: RANDOM_PULSE_COMPARISON_METRIC,
			profile,
			authoring,
			incompatibilities,
			summary,
			frames,
		};
	}
	return {
		status: "ready",
		candidateSurface: RANDOM_PULSE_CANDIDATE_SURFACE,
		metric: RANDOM_PULSE_COMPARISON_METRIC,
		profile,
		authoring,
		summary,
		frames,
	};
}
