import {
	isFiniteReferenceNumber,
	type MotionStudyReferenceCriticalFrame,
	type MotionStudyReferenceOracle,
	type MotionStudyReferenceResult,
	wrapReferenceFrame,
} from "./reference-law-oracle";

export const INVERSE_PROPORTION_REFERENCE_LAW_ID =
	"complement-tangent-pair-v1" as const;

export type InverseProportionVec2 = {
	readonly x: number;
	readonly y: number;
};

/** Transient relation input; no callback or derived geometry is serialized. */
export type InverseProportionReferenceInput = {
	readonly periodFrames: number;
	readonly anchor: InverseProportionVec2;
	readonly axis: InverseProportionVec2;
	readonly radiusSum: number;
	readonly clearance: number;
	readonly driverRadiusAt: (frame: number) => number;
};

export type InverseProportionReferenceSample = {
	readonly sourceFrame: number;
	readonly localFrame: number;
	readonly driverRadius: number;
	readonly followerRadius: number;
	readonly driverCenter: InverseProportionVec2;
	readonly followerCenter: InverseProportionVec2;
	readonly anchor: InverseProportionVec2;
	readonly axis: InverseProportionVec2;
	readonly centerDistance: number;
	readonly radiusSumResidual: number;
	readonly clearanceResidual: number;
	readonly axisResidual: number;
	readonly contactPoint: InverseProportionVec2;
};

const blocked = <TSample>(
	reason: string,
): MotionStudyReferenceResult<TSample> => ({
	status: "blocked",
	reason,
});

const vectorLength = (value: InverseProportionVec2): number =>
	Math.hypot(value.x, value.y);

const normalize = (value: InverseProportionVec2): InverseProportionVec2 => {
	const length = vectorLength(value);
	return { x: value.x / length, y: value.y / length };
};

const inputIssue = (input: InverseProportionReferenceInput): string | null => {
	if (
		![
			input.periodFrames,
			input.anchor.x,
			input.anchor.y,
			input.axis.x,
			input.axis.y,
			input.radiusSum,
			input.clearance,
		].every(isFiniteReferenceNumber)
	) {
		return "Inverse Proportion relation values must be finite.";
	}
	if (input.periodFrames <= 0)
		return "Inverse Proportion period must be positive.";
	if (input.radiusSum <= 0 || input.clearance < 0) {
		return "Inverse Proportion radius sum must be positive and clearance non-negative.";
	}
	const axisLength = vectorLength(input.axis);
	if (!Number.isFinite(axisLength) || axisLength <= 1e-8) {
		return "Inverse Proportion axis must be a non-zero vector.";
	}
	if (input.radiusSum <= input.clearance) {
		return "Inverse Proportion radius sum must exceed clearance.";
	}
	return null;
};

const sampleAt = (
	input: InverseProportionReferenceInput,
	frame: number,
): MotionStudyReferenceResult<InverseProportionReferenceSample> => {
	const issue = inputIssue(input);
	if (issue) return blocked(issue);
	const localFrame = wrapReferenceFrame(frame, input.periodFrames);
	if (localFrame === null)
		return blocked("Inverse Proportion frame must be finite.");
	const driverRadius = input.driverRadiusAt(localFrame);
	if (!isFiniteReferenceNumber(driverRadius) || driverRadius <= 0) {
		return blocked(
			"Inverse Proportion driver radius must be finite and positive.",
		);
	}
	const followerRadius = input.radiusSum - driverRadius;
	if (followerRadius <= 0) {
		return blocked(
			"Inverse Proportion driver radius leaves no positive complement.",
		);
	}
	const axis = normalize(input.axis);
	const clearanceHalf = input.clearance / 2;
	const driverDistance = driverRadius + clearanceHalf;
	const followerDistance = followerRadius + clearanceHalf;
	const driverCenter = {
		x: input.anchor.x - axis.x * driverDistance,
		y: input.anchor.y - axis.y * driverDistance,
	};
	const followerCenter = {
		x: input.anchor.x + axis.x * followerDistance,
		y: input.anchor.y + axis.y * followerDistance,
	};
	const centerDistance = Math.hypot(
		followerCenter.x - driverCenter.x,
		followerCenter.y - driverCenter.y,
	);
	return {
		status: "ready",
		samples: [
			{
				sourceFrame: frame,
				localFrame,
				driverRadius,
				followerRadius,
				driverCenter,
				followerCenter,
				anchor: input.anchor,
				axis,
				centerDistance,
				radiusSumResidual: driverRadius + followerRadius - input.radiusSum,
				clearanceResidual:
					centerDistance - driverRadius - followerRadius - input.clearance,
				axisResidual: Math.abs(
					(followerCenter.x - driverCenter.x) * axis.y -
						(followerCenter.y - driverCenter.y) * axis.x,
				),
				contactPoint: input.anchor,
			},
		],
	};
};

export function inverseProportionReferenceCriticalFrames(
	input: InverseProportionReferenceInput,
): MotionStudyReferenceResult<MotionStudyReferenceCriticalFrame> {
	const issue = inputIssue(input);
	if (issue) return blocked(issue);
	const quarter = input.periodFrames / 4;
	return {
		status: "ready",
		samples: [
			{ id: "rest", frame: 0, purpose: "driver/follower rest complement" },
			{
				id: "maximum",
				frame: quarter,
				purpose: "maximum driver-radius exchange",
			},
			{
				id: "turnaround",
				frame: input.periodFrames / 2,
				purpose: "driver radius turnaround",
			},
			{ id: "return", frame: quarter * 3, purpose: "return leg complement" },
			{
				id: "loop-seam",
				frame: input.periodFrames,
				purpose: "same tangent anchor at loop seam",
			},
		],
	};
}

export function sampleInverseProportionReference(
	input: InverseProportionReferenceInput,
	frame: number,
): MotionStudyReferenceResult<InverseProportionReferenceSample> {
	return sampleAt(input, frame);
}

export const INVERSE_PROPORTION_REFERENCE_ORACLE: MotionStudyReferenceOracle<
	InverseProportionReferenceInput,
	InverseProportionReferenceSample
> = {
	id: INVERSE_PROPORTION_REFERENCE_LAW_ID,
	criticalFrames: inverseProportionReferenceCriticalFrames,
	sample: sampleInverseProportionReference,
};
