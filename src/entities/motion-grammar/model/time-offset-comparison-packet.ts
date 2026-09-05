import {
	sampleTimeOffsetPresentationCandidate,
	TIME_OFFSET_CANDIDATE_SURFACE,
	type TimeOffsetCandidateAuthoringObservation,
	type TimeOffsetCandidateIncompatibility,
	type TimeOffsetCandidateProfileObservation,
	type TimeOffsetPresentationCandidateInput,
	type TimeOffsetPresentationCandidateSample,
} from "./time-offset-presentation-candidate";
import {
	sampleTimeOffsetReference,
	type TimeOffsetReferenceSample,
	timeOffsetReferenceCriticalFrames,
} from "./time-offset-reference-oracle";

export const TIME_OFFSET_COMPARISON_METRIC =
	"frame-aligned-calibrated-structural" as const;

export type TimeOffsetComparisonPair = {
	readonly targetId: string;
	readonly reference: TimeOffsetReferenceSample;
	readonly candidate: TimeOffsetPresentationCandidateSample;
	readonly delta: {
		/** Calibrated artboard-space residual; never a pixel or source-fidelity verdict. */
		readonly profilePositionX: number;
		readonly profilePositionY: number;
		readonly sourceProfilePositionXProjected: number;
		readonly sourceProfilePositionYProjected: number;
		readonly positionUnitsComparable: boolean;
		/** Calibrated radius residual; never a pixel or source-fidelity verdict. */
		/** Raw binary comparison of page SVG presence and candidate opacity. */
		readonly pagePresenceMatchesCandidateOpacity: boolean;
		readonly sourceValueSvgUnits: number;
		readonly sourceValueProjectedSceneUnits: number;
		readonly candidateRadiusEquivalentSceneUnits: number;
		readonly radiusResidualSceneUnits: number;
		readonly candidateScaleX: number;
		readonly candidateScaleY: number;
		readonly valueUnitsComparable: boolean;
	};
};

export type TimeOffsetComparisonFrame = {
	readonly id: string;
	readonly purpose: string;
	readonly sourceFrame: number;
	readonly pairs: readonly TimeOffsetComparisonPair[];
};

export type TimeOffsetComparisonPacket =
	| {
			readonly status: "blocked";
			readonly reason: string;
	  }
	| {
			readonly status: "incompatible";
			readonly candidateSurface: typeof TIME_OFFSET_CANDIDATE_SURFACE;
			readonly metric: typeof TIME_OFFSET_COMPARISON_METRIC;
			readonly profile: TimeOffsetCandidateProfileObservation;
			readonly authoring: TimeOffsetCandidateAuthoringObservation;
			readonly incompatibilities: readonly TimeOffsetCandidateIncompatibility[];
			readonly frames: readonly TimeOffsetComparisonFrame[];
	  }
	| {
			readonly status: "ready";
			readonly candidateSurface: typeof TIME_OFFSET_CANDIDATE_SURFACE;
			readonly metric: typeof TIME_OFFSET_COMPARISON_METRIC;
			readonly profile: TimeOffsetCandidateProfileObservation;
			readonly authoring: TimeOffsetCandidateAuthoringObservation;
			readonly frames: readonly TimeOffsetComparisonFrame[];
	  };

const blocked = (reason: string): TimeOffsetComparisonPacket => ({
	status: "blocked",
	reason,
});

const pairSamples = (
	reference: readonly TimeOffsetReferenceSample[],
	candidate: readonly TimeOffsetPresentationCandidateSample[],
	profile: TimeOffsetCandidateProfileObservation,
): readonly TimeOffsetComparisonPair[] | string => {
	const candidateByTarget = new Map(
		candidate.map((sample) => [sample.targetId, sample] as const),
	);
	if (reference.length !== candidateByTarget.size) {
		return "Offset source and candidate return different target counts.";
	}
	const pairs: TimeOffsetComparisonPair[] = [];
	for (const sourceSample of reference) {
		const candidateSample = candidateByTarget.get(sourceSample.targetId);
		if (!candidateSample) {
			return "Offset source and candidate return different target identities.";
		}
		pairs.push({
			targetId: sourceSample.targetId,
			reference: sourceSample,
			candidate: candidateSample,
			delta: {
				profilePositionX: candidateSample.profilePositionX,
				profilePositionY: candidateSample.profilePositionY,
				sourceProfilePositionXProjected:
					sourceSample.profilePositionX * profile.sourceCoordinateScale,
				sourceProfilePositionYProjected:
					sourceSample.profilePositionY * profile.sourceCoordinateScale,
				positionUnitsComparable:
					profile.semanticVersion >= 2 &&
					profile.positionUnit === "source-coordinate-projected",
				pagePresenceMatchesCandidateOpacity:
					candidateSample.opacityPresent === sourceSample.pageRenderPresent,
				sourceValueSvgUnits: sourceSample.interpolatedValueSvgUnits,
				sourceValueProjectedSceneUnits:
					sourceSample.interpolatedValueSvgUnits * profile.sourceValueScale,
				candidateRadiusEquivalentSceneUnits:
					candidateSample.radiusEquivalentSceneUnits,
				radiusResidualSceneUnits:
					candidateSample.radiusEquivalentSceneUnits -
					sourceSample.interpolatedValueSvgUnits * profile.sourceValueScale,
				candidateScaleX: candidateSample.scaleX,
				candidateScaleY: candidateSample.scaleY,
				valueUnitsComparable:
					profile.semanticVersion >= 2 &&
					profile.valueUnit === "source-radius-projected",
			},
		});
	}
	return pairs;
};

/**
 * Builds a frame-paired Offset observation. A packet can be `incompatible` and
 * still contain calibrated structural samples; neither status is an acceptance
 * score.
 */
export function buildTimeOffsetComparisonPacket(
	input: TimeOffsetPresentationCandidateInput,
): TimeOffsetComparisonPacket {
	const criticalFrames = timeOffsetReferenceCriticalFrames(input.source);
	if (criticalFrames.status === "blocked") {
		return blocked(criticalFrames.reason);
	}
	const frames: TimeOffsetComparisonFrame[] = [];
	let profile: TimeOffsetCandidateProfileObservation | undefined;
	let authoring: TimeOffsetCandidateAuthoringObservation | undefined;
	let incompatibilities: readonly TimeOffsetCandidateIncompatibility[] = [];
	let hasIncompatibility = false;
	for (const criticalFrame of criticalFrames.samples) {
		const reference = sampleTimeOffsetReference(
			input.source,
			criticalFrame.frame,
		);
		if (reference.status === "blocked") return blocked(reference.reason);
		const candidate = sampleTimeOffsetPresentationCandidate(
			input,
			criticalFrame.frame,
		);
		if (candidate.status === "blocked") return blocked(candidate.reason);
		profile ??= candidate.profile;
		authoring ??= candidate.authoring;
		if (candidate.status === "incompatible") {
			hasIncompatibility = true;
			incompatibilities = candidate.incompatibilities;
		}
		const pairs = pairSamples(
			reference.samples,
			candidate.samples,
			candidate.profile,
		);
		if (typeof pairs === "string") return blocked(pairs);
		frames.push({
			id: criticalFrame.id,
			purpose: criticalFrame.purpose,
			sourceFrame: criticalFrame.frame,
			pairs,
		});
	}
	if (!profile || !authoring) {
		return blocked(
			"Offset comparison did not produce a candidate profile observation.",
		);
	}
	if (hasIncompatibility) {
		return {
			status: "incompatible",
			candidateSurface: TIME_OFFSET_CANDIDATE_SURFACE,
			metric: TIME_OFFSET_COMPARISON_METRIC,
			profile,
			authoring,
			incompatibilities,
			frames,
		};
	}
	return {
		status: "ready",
		candidateSurface: TIME_OFFSET_CANDIDATE_SURFACE,
		metric: TIME_OFFSET_COMPARISON_METRIC,
		profile,
		authoring,
		frames,
	};
}
