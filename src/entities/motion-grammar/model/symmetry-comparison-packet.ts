import {
	SYMMETRY_CANDIDATE_SURFACE,
	type SymmetryCandidateInput,
	type SymmetryCandidateSample,
	sampleSymmetryPresentationCandidate,
} from "./symmetry-presentation-candidate";
import {
	type SymmetryReferenceInput,
	type SymmetryReferenceSample,
	sampleSymmetryReference,
	symmetryReferenceCriticalFrames,
} from "./symmetry-reference-oracle";

export type SymmetryComparisonPair = {
	readonly targetId: string;
	readonly role: string;
	readonly reference: {
		readonly position: { readonly x: number; readonly y: number };
		readonly scale: number;
		readonly rotation: number;
	};
	readonly candidate: SymmetryCandidateSample;
	readonly delta: {
		readonly position: number;
		readonly scale: number;
		readonly rotation: number;
	};
};

export type SymmetryComparisonPacket =
	| { readonly status: "blocked"; readonly reason: string }
	| {
			readonly status: "ready" | "incompatible";
			readonly candidateSurface: typeof SYMMETRY_CANDIDATE_SURFACE;
			readonly frames: readonly {
				readonly id: string;
				readonly purpose: string;
				readonly sourceFrame: number;
				readonly pulse: number;
				readonly pairs: readonly SymmetryComparisonPair[];
			}[];
			readonly summary: {
				readonly roleMapMatches: boolean;
				readonly pulseMatches: boolean;
				readonly seamRestMatches: boolean;
				readonly maxPositionResidual: number;
				readonly maxScaleResidual: number;
				readonly maxRotationResidual: number;
			};
			readonly surfaces: readonly {
				readonly surface:
					| "canvas"
					| "svg"
					| "pdf"
					| "javascript-code-runtime"
					| "webgl"
					| "bake";
				readonly status: "supported" | "not-evaluated" | "unsupported";
				readonly reason: string;
			}[];
			readonly gaps: readonly string[];
	  };

const distance = (
	left: { readonly x: number; readonly y: number },
	right: { readonly x: number; readonly y: number },
): number => Math.hypot(left.x - right.x, left.y - right.y);

const surfaces = () => [
	{
		surface: "canvas" as const,
		status: "supported" as const,
		reason:
			"Shared Motion presentation samples the registered Symmetry expression.",
	},
	{
		surface: "javascript-code-runtime" as const,
		status: "supported" as const,
		reason: "The maintained code route uses the same shared sampler.",
	},
	{
		surface: "svg" as const,
		status: "not-evaluated" as const,
		reason: "Surface-specific export packet is not captured for this carrier.",
	},
	{
		surface: "pdf" as const,
		status: "not-evaluated" as const,
		reason: "Live/headless PDF evidence is not captured for this carrier.",
	},
	{
		surface: "webgl" as const,
		status: "not-evaluated" as const,
		reason: "Independent GPU render evidence is not captured for this carrier.",
	},
	{
		surface: "bake" as const,
		status: "unsupported" as const,
		reason: "Trackless shared-pulse Bake ownership is not implemented.",
	},
];

const pairFrame = (
	reference: SymmetryReferenceInput["targets"],
	referenceSample: SymmetryReferenceSample,
	candidate: readonly SymmetryCandidateSample[],
): readonly SymmetryComparisonPair[] | string => {
	const candidateById = new Map(
		candidate.map((sample) => [sample.nodeId, sample] as const),
	);
	const pairs = reference.map((target) => {
		const source = referenceSample.targets.find(
			(sample) => sample.targetId === target.targetId,
		);
		const actual = candidateById.get(target.targetId);
		if (!source || !actual) return null;
		return {
			targetId: target.targetId,
			role: target.role,
			reference: source,
			candidate: actual,
			delta: {
				position: distance(source.position, actual.position),
				scale: actual.scale - source.scale,
				rotation: actual.rotation - source.rotation,
			},
		};
	});
	return pairs.some((pair) => pair === null)
		? "Symmetry candidate omitted one or more role samples."
		: (pairs as readonly SymmetryComparisonPair[]);
};

export function buildSymmetryComparisonPacket(
	input: SymmetryCandidateInput & { readonly source: SymmetryReferenceInput },
): SymmetryComparisonPacket {
	const critical = symmetryReferenceCriticalFrames(input.source);
	if (critical.status === "blocked")
		return { status: "blocked", reason: critical.reason };
	const frames: Array<{
		readonly id: string;
		readonly purpose: string;
		readonly sourceFrame: number;
		readonly pulse: number;
		readonly pairs: readonly SymmetryComparisonPair[];
	}> = [];
	for (const criticalFrame of critical.samples) {
		const reference = sampleSymmetryReference(
			input.source,
			criticalFrame.frame,
		);
		if (reference.status === "blocked")
			return { status: "blocked", reason: reference.reason };
		const sourceSample = reference.samples[0];
		if (!sourceSample)
			return {
				status: "blocked",
				reason: "Symmetry oracle returned no critical-frame sample.",
			};
		const candidate = sampleSymmetryPresentationCandidate(
			input,
			criticalFrame.frame,
		);
		if (candidate.status === "blocked") return candidate;
		const pairs = pairFrame(
			input.source.targets,
			sourceSample,
			candidate.samples,
		);
		if (typeof pairs === "string") return { status: "blocked", reason: pairs };
		frames.push({
			id: criticalFrame.id,
			purpose: criticalFrame.purpose,
			sourceFrame: criticalFrame.frame,
			pulse: sourceSample.pulse,
			pairs,
		});
	}
	const roleMapMatches = input.source.targets.every(
		(target) =>
			input.binding.roleMap?.[`mirror-symmetric-scale:${target.role}`] ===
			target.targetId,
	);
	const maxPositionResidual = Math.max(
		...frames.flatMap((frame) =>
			frame.pairs.map((pair) => pair.delta.position),
		),
		0,
	);
	const maxScaleResidual = Math.max(
		...frames.flatMap((frame) =>
			frame.pairs.map((pair) => Math.abs(pair.delta.scale)),
		),
		0,
	);
	const maxRotationResidual = Math.max(
		...frames.flatMap((frame) =>
			frame.pairs.map((pair) => Math.abs(pair.delta.rotation)),
		),
		0,
	);
	const pulseMatches = frames.every((frame) =>
		frame.pairs.every(
			(pair) =>
				Number.isFinite(pair.reference.scale) &&
				Number.isFinite(pair.candidate.scale),
		),
	);
	const start = frames.find((frame) => frame.id === "rest");
	const seam = frames.find((frame) => frame.id === "loop-seam");
	const seamRestMatches = Boolean(
		start &&
			seam &&
			start.pairs.every((pair) => {
				const seamPair = seam.pairs.find(
					(candidate) => candidate.targetId === pair.targetId,
				);
				return Boolean(
					seamPair &&
						distance(pair.candidate.position, seamPair.candidate.position) <=
							1e-8 &&
						Math.abs(pair.candidate.scale - seamPair.candidate.scale) <= 1e-8 &&
						Math.abs(pair.candidate.rotation - seamPair.candidate.rotation) <=
							1e-8,
				);
			}),
	);
	const gaps = [
		...(roleMapMatches
			? []
			: ["Symmetry role map does not preserve all five named roles."]),
		...(pulseMatches
			? []
			: ["Symmetry candidate emitted non-finite pulse channels."]),
		...(seamRestMatches
			? []
			: ["Symmetry candidate does not return to the rest state at loop seam."]),
	];
	return {
		status:
			gaps.length === 0 &&
			maxPositionResidual <= 1e-8 &&
			maxScaleResidual <= 1e-8 &&
			maxRotationResidual <= 1e-8
				? "ready"
				: "incompatible",
		candidateSurface: SYMMETRY_CANDIDATE_SURFACE,
		frames,
		summary: {
			roleMapMatches,
			pulseMatches,
			seamRestMatches,
			maxPositionResidual,
			maxScaleResidual,
			maxRotationResidual,
		},
		surfaces: surfaces(),
		gaps,
	};
}
