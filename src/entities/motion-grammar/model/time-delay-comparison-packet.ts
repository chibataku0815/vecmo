import {
	sampleTimeDelayPresentationCandidate,
	TIME_DELAY_CANDIDATE_SURFACE,
	type TimeDelayPresentationCandidateInput,
	type TimeDelayPresentationCandidateSample,
} from "./time-delay-presentation-candidate";
import {
	sampleTimeDelayReference,
	type TimeDelayReferenceSample,
	timeDelayReferenceCriticalFrames,
} from "./time-delay-reference-oracle";

export const TIME_DELAY_COMPARISON_DERIVATIVE_STEP_FRAMES = 0.25 as const;
export const TIME_DELAY_COMPARISON_CARRIER_METRIC =
	"normalized-transform-only" as const;

type TimeDelayDerivativeRule = "centered" | "forward" | "backward";

export type TimeDelayComparisonPair = {
	readonly targetId: string;
	readonly reference: {
		readonly body: {
			readonly profilePositionX: number;
			readonly profilePositionY: number;
			readonly scaleY: number;
			readonly analyticVelocityY: number;
		};
		readonly satellite:
			| {
					readonly kind: "absent";
			  }
			| {
					readonly kind: "present";
					readonly profilePositionX: number;
					readonly profilePositionY: number;
					readonly scaleX: number;
					readonly scaleY: number;
			  };
	};
	readonly candidate: {
		readonly body: {
			readonly profilePositionX: number;
			readonly profilePositionY: number;
			readonly scaleY: number;
			readonly opacity: number;
		};
		readonly satellite:
			| {
					readonly state: "suppressed";
			  }
			| {
					readonly state: "active";
					readonly profilePositionX: number;
					readonly profilePositionY: number;
					readonly scaleX: number;
					readonly scaleY: number;
					readonly opacity: number;
			  };
	};
	readonly delta: {
		readonly bodyProfilePositionX: number;
		readonly bodyProfilePositionY: number;
		readonly bodyScaleY: number;
		readonly satelliteStateMatches: boolean;
		readonly satelliteProfilePositionX?: number;
		readonly satelliteProfilePositionY?: number;
		readonly satelliteScaleX?: number;
		readonly satelliteScaleY?: number;
	};
	readonly finiteDifferenceVelocityY: {
		readonly rule: TimeDelayDerivativeRule;
		readonly reference: number;
		readonly candidate: number;
		readonly delta: number;
	};
};

export type TimeDelayComparisonFrame = {
	readonly id: string;
	readonly purpose: string;
	readonly frame: number;
	readonly pairs: readonly TimeDelayComparisonPair[];
};

export type TimeDelayComparisonPacket =
	| {
			readonly status: "blocked";
			readonly reason: string;
	  }
	| {
			readonly status: "ready";
			readonly candidateSurface: typeof TIME_DELAY_CANDIDATE_SURFACE;
			readonly carrierMetric: typeof TIME_DELAY_COMPARISON_CARRIER_METRIC;
			readonly derivativeStepFrames: typeof TIME_DELAY_COMPARISON_DERIVATIVE_STEP_FRAMES;
			readonly frames: readonly TimeDelayComparisonFrame[];
	  };

type SamplePair = {
	readonly reference: ReadonlyMap<string, TimeDelayReferenceSample>;
	readonly candidate: ReadonlyMap<string, TimeDelayPresentationCandidateSample>;
};

const blocked = (reason: string): TimeDelayComparisonPacket => ({
	status: "blocked",
	reason,
});

const samplePair = (
	input: TimeDelayPresentationCandidateInput,
	frame: number,
): SamplePair | string => {
	const reference = sampleTimeDelayReference(input.source, frame);
	if (reference.status === "blocked") return reference.reason;
	const candidate = sampleTimeDelayPresentationCandidate(input, frame);
	if (candidate.status === "blocked") return candidate.reason;
	const referenceByTarget = new Map(
		reference.samples.map((sample) => [sample.targetId, sample] as const),
	);
	const candidateByTarget = new Map(
		candidate.samples.map((sample) => [sample.targetId, sample] as const),
	);
	if (referenceByTarget.size !== candidateByTarget.size) {
		return "Time Delay source and candidate return different target counts.";
	}
	for (const targetId of referenceByTarget.keys()) {
		if (!candidateByTarget.has(targetId)) {
			return "Time Delay source and candidate return different target identities.";
		}
	}
	return { reference: referenceByTarget, candidate: candidateByTarget };
};

const derivativeRuleForFrame = (
	frame: number,
	periodFrames: number,
): TimeDelayDerivativeRule =>
	frame <= TIME_DELAY_COMPARISON_DERIVATIVE_STEP_FRAMES
		? "forward"
		: frame >= periodFrames - TIME_DELAY_COMPARISON_DERIVATIVE_STEP_FRAMES
			? "backward"
			: "centered";

const finiteDifferenceVelocity = (
	input: TimeDelayPresentationCandidateInput,
	frame: number,
):
	| ReadonlyMap<
			string,
			{
				readonly rule: TimeDelayDerivativeRule;
				readonly reference: number;
				readonly candidate: number;
			}
	  >
	| string => {
	const rule = derivativeRuleForFrame(frame, input.source.periodFrames);
	const step = TIME_DELAY_COMPARISON_DERIVATIVE_STEP_FRAMES;
	const beforeFrame = rule === "forward" ? frame : frame - step;
	const afterFrame = rule === "backward" ? frame : frame + step;
	const before = samplePair(input, beforeFrame);
	if (typeof before === "string") return before;
	const after = samplePair(input, afterFrame);
	if (typeof after === "string") return after;
	const divisor = afterFrame - beforeFrame;
	if (divisor <= 0) return "Time Delay finite-difference interval is invalid.";
	const velocities = new Map<
		string,
		{
			readonly rule: TimeDelayDerivativeRule;
			readonly reference: number;
			readonly candidate: number;
		}
	>();
	for (const [targetId, beforeReference] of before.reference) {
		const afterReference = after.reference.get(targetId);
		const beforeCandidate = before.candidate.get(targetId);
		const afterCandidate = after.candidate.get(targetId);
		if (!afterReference || !beforeCandidate || !afterCandidate) {
			return "Time Delay finite-difference target pairing is incomplete.";
		}
		velocities.set(targetId, {
			rule,
			reference:
				(afterReference.master.body.centerY -
					beforeReference.master.body.centerY) /
				divisor,
			candidate:
				(afterCandidate.body.profilePositionY -
					beforeCandidate.body.profilePositionY) /
				divisor,
		});
	}
	return velocities;
};

const comparisonPair = ({
	reference,
	candidate,
	velocity,
	satelliteScaleAnchorPx,
}: {
	readonly reference: TimeDelayReferenceSample;
	readonly candidate: TimeDelayPresentationCandidateSample;
	readonly velocity: {
		readonly rule: TimeDelayDerivativeRule;
		readonly reference: number;
		readonly candidate: number;
	};
	readonly satelliteScaleAnchorPx: number;
}): TimeDelayComparisonPair => {
	const referenceSatellite =
		reference.master.satellite.kind === "present"
			? {
					kind: "present" as const,
					profilePositionX: reference.centerX,
					profilePositionY: reference.master.satellite.centerY,
					scaleX: reference.master.satellite.radius / satelliteScaleAnchorPx,
					scaleY: reference.master.satellite.radius / satelliteScaleAnchorPx,
				}
			: { kind: "absent" as const };
	const candidateSatellite =
		candidate.satellite.state === "active"
			? {
					state: "active" as const,
					profilePositionX: candidate.satellite.profilePositionX,
					profilePositionY: candidate.satellite.profilePositionY,
					scaleX: candidate.satellite.scaleX,
					scaleY: candidate.satellite.scaleY,
					opacity: candidate.satellite.opacity,
				}
			: { state: "suppressed" as const };
	const matchingSatellite =
		referenceSatellite.kind === "present" &&
		candidateSatellite.state === "active"
			? {
					satelliteProfilePositionX:
						candidateSatellite.profilePositionX -
						referenceSatellite.profilePositionX,
					satelliteProfilePositionY:
						candidateSatellite.profilePositionY -
						referenceSatellite.profilePositionY,
					satelliteScaleX:
						candidateSatellite.scaleX - referenceSatellite.scaleX,
					satelliteScaleY:
						candidateSatellite.scaleY - referenceSatellite.scaleY,
				}
			: {};
	return {
		targetId: reference.targetId,
		reference: {
			body: {
				profilePositionX: reference.centerX,
				profilePositionY: reference.master.body.centerY,
				scaleY: reference.master.body.stretchY,
				analyticVelocityY: reference.master.body.velocityY,
			},
			satellite: referenceSatellite,
		},
		candidate: {
			body: {
				profilePositionX: candidate.body.profilePositionX,
				profilePositionY: candidate.body.profilePositionY,
				scaleY: candidate.body.scaleY,
				opacity: candidate.body.opacity,
			},
			satellite: candidateSatellite,
		},
		delta: {
			bodyProfilePositionX: candidate.body.profilePositionX - reference.centerX,
			bodyProfilePositionY:
				candidate.body.profilePositionY - reference.master.body.centerY,
			bodyScaleY: candidate.body.scaleY - reference.master.body.stretchY,
			satelliteStateMatches:
				(referenceSatellite.kind === "present" &&
					candidateSatellite.state === "active") ||
				(referenceSatellite.kind === "absent" &&
					candidateSatellite.state === "suppressed"),
			...matchingSatellite,
		},
		finiteDifferenceVelocityY: {
			rule: velocity.rule,
			reference: velocity.reference,
			candidate: velocity.candidate,
			delta: velocity.candidate - velocity.reference,
		},
	};
};

/**
 * Builds a read-only structural packet for every source and replayed critical
 * frame. It intentionally has no tolerance or accepted/rejected verdict:
 * numbers identify a residual; visual and motion acceptance remain the user's
 * authority.
 */
export function buildTimeDelayComparisonPacket(
	input: TimeDelayPresentationCandidateInput,
): TimeDelayComparisonPacket {
	if (
		input.source.periodFrames <=
		TIME_DELAY_COMPARISON_DERIVATIVE_STEP_FRAMES * 2
	) {
		return blocked(
			"Time Delay comparison period must exceed two finite-difference steps.",
		);
	}
	const criticalFrames = timeDelayReferenceCriticalFrames(input.source);
	if (criticalFrames.status === "blocked")
		return blocked(criticalFrames.reason);
	const frames: TimeDelayComparisonFrame[] = [];
	for (const criticalFrame of criticalFrames.samples) {
		const samples = samplePair(input, criticalFrame.frame);
		if (typeof samples === "string") return blocked(samples);
		const velocities = finiteDifferenceVelocity(input, criticalFrame.frame);
		if (typeof velocities === "string") return blocked(velocities);
		const pairs: TimeDelayComparisonPair[] = [];
		for (const [targetId, reference] of samples.reference) {
			const candidate = samples.candidate.get(targetId);
			const velocity = velocities.get(targetId);
			if (!candidate || !velocity) {
				return blocked("Time Delay critical-frame pairing is incomplete.");
			}
			pairs.push(
				comparisonPair({
					reference,
					candidate,
					velocity,
					satelliteScaleAnchorPx: input.source.satellite.radiusAnchorPx,
				}),
			);
		}
		frames.push({
			id: criticalFrame.id,
			purpose: criticalFrame.purpose,
			frame: criticalFrame.frame,
			pairs,
		});
	}
	return {
		status: "ready",
		candidateSurface: TIME_DELAY_CANDIDATE_SURFACE,
		carrierMetric: TIME_DELAY_COMPARISON_CARRIER_METRIC,
		derivativeStepFrames: TIME_DELAY_COMPARISON_DERIVATIVE_STEP_FRAMES,
		frames,
	};
}
