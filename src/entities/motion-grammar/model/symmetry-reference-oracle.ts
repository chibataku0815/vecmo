import {
	isFiniteReferenceNumber,
	type MotionStudyReferenceCriticalFrame,
	type MotionStudyReferenceOracle,
	type MotionStudyReferenceResult,
	wrapReferenceFrame,
} from "./reference-law-oracle";

export const SYMMETRY_REFERENCE_LAW_ID =
	"shared-hold-pulse-symmetry-v1" as const;

export type SymmetryReferenceRole =
	| "outer-left"
	| "outer-right"
	| "inner-left"
	| "inner-right"
	| "center";

export type SymmetryReferenceTarget = {
	readonly targetId: string;
	readonly role: SymmetryReferenceRole;
	readonly rest: { readonly x: number; readonly y: number };
};

export type SymmetryReferenceInput = {
	readonly periodFrames: number;
	readonly riseFrames: number;
	readonly holdFrames: number;
	readonly outerTranslation: number;
	readonly innerTranslation: number;
	readonly outerScale: number;
	readonly innerScale: number;
	readonly centerScale: number;
	readonly centerRotationDegrees: number;
	readonly targets: readonly SymmetryReferenceTarget[];
};

export type SymmetryReferenceSample = {
	readonly sourceFrame: number;
	readonly localFrame: number;
	readonly pulse: number;
	readonly targets: readonly {
		readonly targetId: string;
		readonly role: SymmetryReferenceRole;
		readonly position: { readonly x: number; readonly y: number };
		readonly scale: number;
		readonly rotation: number;
	}[];
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

const pulseAt = (
	frame: number,
	periodFrames: number,
	riseFrames: number,
	holdFrames: number,
): number => {
	const local = ((frame % periodFrames) + periodFrames) % periodFrames;
	const rise = Math.min(Math.max(1, riseFrames), periodFrames);
	const hold = Math.min(
		Math.max(0, holdFrames),
		Math.max(0, periodFrames - rise),
	);
	const fall = Math.max(1, periodFrames - rise - hold);
	if (local < rise) return smoothstep(local / rise);
	if (local < rise + hold) return 1;
	return smoothstep(1 - (local - rise - hold) / fall);
};

const inputIssue = (input: SymmetryReferenceInput): string | null => {
	const numbers = [
		input.periodFrames,
		input.riseFrames,
		input.holdFrames,
		input.outerTranslation,
		input.innerTranslation,
		input.outerScale,
		input.innerScale,
		input.centerScale,
		input.centerRotationDegrees,
	];
	if (!numbers.every(isFiniteReferenceNumber))
		return "Symmetry relation values must be finite.";
	if (
		input.periodFrames <= 0 ||
		input.riseFrames <= 0 ||
		input.holdFrames < 0
	) {
		return "Symmetry period/rise/hold values must be positive and bounded.";
	}
	if (input.targets.length !== 5)
		return "Symmetry structural gate requires five named roles.";
	const roles = new Set(input.targets.map((target) => target.role));
	if (roles.size !== 5)
		return "Symmetry structural gate requires one target per named role.";
	return null;
};

export function symmetryReferenceCriticalFrames(
	input: SymmetryReferenceInput,
): MotionStudyReferenceResult<MotionStudyReferenceCriticalFrame> {
	const issue = inputIssue(input);
	if (issue) return blocked(issue);
	const peak = Math.min(
		input.periodFrames - 1,
		input.riseFrames + input.holdFrames / 2,
	);
	return {
		status: "ready",
		samples: [
			{ id: "rest", frame: 0, purpose: "closed rest" },
			{ id: "peak", frame: peak, purpose: "held symmetric expansion" },
			{
				id: "release",
				frame: Math.round((input.periodFrames + peak) / 2),
				purpose: "release from held peak",
			},
			{
				id: "loop-seam",
				frame: input.periodFrames,
				purpose: "closed loop seam",
			},
		],
	};
}

export function sampleSymmetryReference(
	input: SymmetryReferenceInput,
	frame: number,
): MotionStudyReferenceResult<SymmetryReferenceSample> {
	const issue = inputIssue(input);
	if (issue) return blocked(issue);
	const localFrame = wrapReferenceFrame(frame, input.periodFrames);
	if (localFrame === null) return blocked("Symmetry frame must be finite.");
	const pulse = pulseAt(
		localFrame,
		input.periodFrames,
		input.riseFrames,
		input.holdFrames,
	);
	const targets = input.targets.map((target) => {
		const translation =
			target.role === "outer-left"
				? -input.outerTranslation
				: target.role === "outer-right"
					? input.outerTranslation
					: target.role === "inner-left"
						? -input.innerTranslation
						: target.role === "inner-right"
							? input.innerTranslation
							: 0;
		const scaleCoefficient = target.role.startsWith("outer")
			? input.outerScale
			: target.role.startsWith("inner")
				? input.innerScale
				: input.centerScale;
		return {
			targetId: target.targetId,
			role: target.role,
			position: {
				x: target.rest.x + translation * pulse,
				y: target.rest.y,
			},
			scale: 1 + scaleCoefficient * pulse,
			rotation:
				target.role === "center" ? input.centerRotationDegrees * pulse : 0,
		};
	});
	return {
		status: "ready",
		samples: [{ sourceFrame: frame, localFrame, pulse, targets }],
	};
}

export const SYMMETRY_REFERENCE_ORACLE: MotionStudyReferenceOracle<
	SymmetryReferenceInput,
	SymmetryReferenceSample
> = {
	id: SYMMETRY_REFERENCE_LAW_ID,
	criticalFrames: symmetryReferenceCriticalFrames,
	sample: sampleSymmetryReference,
};

export const SYMMETRY_CONSTRUCTION_FIXTURE: SymmetryReferenceInput = {
	periodFrames: 120,
	riseFrames: 28,
	holdFrames: 24,
	outerTranslation: 36,
	innerTranslation: 18,
	outerScale: 0.18,
	innerScale: 0.1,
	centerScale: 0.12,
	centerRotationDegrees: 18,
	targets: [
		{
			targetId: "symmetry-outer-left",
			role: "outer-left",
			rest: { x: 160, y: 180 },
		},
		{
			targetId: "symmetry-outer-right",
			role: "outer-right",
			rest: { x: 480, y: 180 },
		},
		{
			targetId: "symmetry-inner-left",
			role: "inner-left",
			rest: { x: 240, y: 180 },
		},
		{
			targetId: "symmetry-inner-right",
			role: "inner-right",
			rest: { x: 400, y: 180 },
		},
		{ targetId: "symmetry-center", role: "center", rest: { x: 320, y: 180 } },
	],
};
