import {
	isFiniteReferenceNumber,
	type MotionStudyReferenceCriticalFrame,
	type MotionStudyReferenceOracle,
	type MotionStudyReferenceResult,
	wrapReferenceFrame,
} from "./reference-law-oracle";

export const PARALLAX_REFERENCE_LAW_ID =
	"shared-wave-depth-amplitudes-v1" as const;
export type ParallaxReferenceRole = "near" | "mid" | "far";
export type ParallaxReferencePoint = { readonly x: number; readonly y: number };
export type ParallaxReferenceTarget = {
	readonly targetId: string;
	readonly role: ParallaxReferenceRole;
	readonly rest: ParallaxReferencePoint;
};
export type ParallaxReferenceInput = {
	readonly periodFrames: number;
	readonly descentFraction: number;
	readonly axisDegrees: number;
	readonly phaseOffsetFrames: number;
	readonly nearAmplitude: number;
	readonly midAmplitude: number;
	readonly farAmplitude: number;
	readonly targets: readonly ParallaxReferenceTarget[];
};
export type ParallaxReferenceTargetSample = {
	readonly targetId: string;
	readonly role: ParallaxReferenceRole;
	readonly position: ParallaxReferencePoint;
	readonly wave: number;
	readonly amplitude: number;
};
export type ParallaxReferenceSample = {
	readonly sourceFrame: number;
	readonly targets: readonly ParallaxReferenceTargetSample[];
};

const blocked = <TSample>(
	reason: string,
): MotionStudyReferenceResult<TSample> => ({ status: "blocked", reason });
const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));
const smoothstep = (value: number): number => {
	const t = clamp(value, 0, 1);
	return t * t * (3 - 2 * t);
};

const inputIssue = (input: ParallaxReferenceInput): string | null => {
	const numericValues = [
		input.periodFrames,
		input.descentFraction,
		input.axisDegrees,
		input.phaseOffsetFrames,
		input.nearAmplitude,
		input.midAmplitude,
		input.farAmplitude,
	];
	if (!numericValues.every(isFiniteReferenceNumber))
		return "Parallax values must be finite.";
	if (!Number.isInteger(input.periodFrames) || input.periodFrames <= 0)
		return "Parallax period must be a positive integer.";
	if (input.targets.length < 3)
		return "Parallax requires near, mid, and far roles.";
	if (
		new Set(input.targets.map((target) => target.targetId)).size !==
		input.targets.length
	)
		return "Parallax target ids must be unique.";
	if (
		input.targets.some(
			(target) =>
				!isFiniteReferenceNumber(target.rest.x) ||
				!isFiniteReferenceNumber(target.rest.y),
		)
	)
		return "Parallax rest points must be finite.";
	return null;
};

const amplitudeFor = (
	role: ParallaxReferenceRole,
	input: ParallaxReferenceInput,
): number => {
	switch (role) {
		case "near":
			return input.nearAmplitude;
		case "mid":
			return input.midAmplitude;
		case "far":
			return input.farAmplitude;
	}
};

const sampleAt = (
	input: ParallaxReferenceInput,
	frame: number,
): MotionStudyReferenceResult<ParallaxReferenceSample> => {
	const issue = inputIssue(input);
	if (issue) return blocked(issue);
	if (!isFiniteReferenceNumber(frame))
		return blocked("Parallax source frame must be finite.");
	const phase =
		(wrapReferenceFrame(frame + input.phaseOffsetFrames, input.periodFrames) ??
			0) / input.periodFrames;
	const descent = clamp(input.descentFraction, 0.1, 0.9);
	const wave =
		phase < descent
			? smoothstep(phase / descent)
			: smoothstep(1 - (phase - descent) / (1 - descent));
	const radians = (input.axisDegrees * Math.PI) / 180;
	const axis = { x: Math.cos(radians), y: Math.sin(radians) };
	return {
		status: "ready",
		samples: [
			{
				sourceFrame: frame,
				targets: input.targets.map((target) => {
					const amplitude = amplitudeFor(target.role, input);
					return {
						targetId: target.targetId,
						role: target.role,
						position: {
							x: target.rest.x + axis.x * amplitude * wave,
							y: target.rest.y + axis.y * amplitude * wave,
						},
						wave,
						amplitude,
					};
				}),
			},
		],
	};
};

const criticalFrames = (
	input: ParallaxReferenceInput,
): MotionStudyReferenceResult<MotionStudyReferenceCriticalFrame> => {
	const issue = inputIssue(input);
	if (issue) return blocked(issue);
	const descent = input.periodFrames * clamp(input.descentFraction, 0.1, 0.9);
	return {
		status: "ready",
		samples: [
			{
				id: "loop-start",
				frame: 0,
				purpose: "All roles begin at their authored rest midpoint.",
			},
			{
				id: "descent-midpoint",
				frame: descent / 2,
				purpose: "Phase-locked roles separate by amplitude during descent.",
			},
			{
				id: "wave-peak",
				frame: descent,
				purpose: "Shared wave reaches the common peak.",
			},
			{
				id: "ascent-midpoint",
				frame: (descent + input.periodFrames) / 2,
				purpose: "All roles return through the same ascent.",
			},
			{
				id: "loop-seam",
				frame: input.periodFrames,
				purpose: "Shared wave returns to rest at the seam.",
			},
		],
	};
};

export const parallaxReferenceOracle: MotionStudyReferenceOracle<
	ParallaxReferenceInput,
	ParallaxReferenceSample
> = {
	id: PARALLAX_REFERENCE_LAW_ID,
	sample: sampleAt,
	criticalFrames,
};

export function sampleParallaxReference(
	input: ParallaxReferenceInput,
	frame: number,
): MotionStudyReferenceResult<ParallaxReferenceSample> {
	return sampleAt(input, frame);
}
export function parallaxReferenceCriticalFrames(
	input: ParallaxReferenceInput,
): MotionStudyReferenceResult<MotionStudyReferenceCriticalFrame> {
	return criticalFrames(input);
}
