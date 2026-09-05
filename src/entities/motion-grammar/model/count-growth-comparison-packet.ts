import {
	COUNT_GROWTH_CANDIDATE_SURFACE,
	type CountGrowthCandidateInput,
	type CountGrowthCandidateSample,
	sampleCountGrowthPresentationCandidate,
} from "./count-growth-presentation-candidate";
import {
	type CountGrowthReferenceInput,
	type CountGrowthReferenceSample,
	type CountGrowthReferenceTargetSample,
	countGrowthReferenceCriticalFrames,
	sampleCountGrowthReference,
} from "./count-growth-reference-oracle";

export const COUNT_GROWTH_COMPARISON_METRIC =
	"shared-presentation-lattice-breath-structural" as const;

export type CountGrowthComparisonPair = {
	readonly targetId: string;
	readonly reference: CountGrowthReferenceTargetSample;
	readonly candidate: CountGrowthCandidateSample;
	readonly delta: {
		readonly position: number;
		readonly rotation: number;
		readonly scale: number;
		readonly opacity: number;
		readonly apparentActiveMatches: boolean;
	};
};

export type CountGrowthComparisonFrame = {
	readonly id: string;
	readonly purpose: string;
	readonly sourceFrame: number;
	readonly pairs: readonly CountGrowthComparisonPair[];
};

export type CountGrowthComparisonSummary = {
	readonly blueprintOrderMatches: boolean;
	readonly roleMapMatches: boolean;
	readonly breathEnvelopeMatches: boolean;
	readonly seamRestMatches: boolean;
	readonly maxPositionResidual: number;
	readonly maxRotationResidual: number;
	readonly maxScaleResidual: number;
	readonly maxOpacityResidual: number;
	readonly mismatchedActiveStates: number;
};

export type CountGrowthSurfaceObservation = {
	readonly surface:
		| "canvas"
		| "svg"
		| "pdf"
		| "javascript-code-runtime"
		| "webgl"
		| "bake";
	readonly status: "supported" | "unsupported" | "not-evaluated";
	readonly reason: string;
};

export type CountGrowthComparisonPacket =
	| { readonly status: "blocked"; readonly reason: string }
	| {
			readonly status: "incompatible" | "ready";
			readonly candidateSurface: typeof COUNT_GROWTH_CANDIDATE_SURFACE;
			readonly metric: typeof COUNT_GROWTH_COMPARISON_METRIC;
			readonly summary: CountGrowthComparisonSummary;
			readonly frames: readonly CountGrowthComparisonFrame[];
			readonly surfaces: readonly CountGrowthSurfaceObservation[];
			readonly incompatibilities: readonly string[];
	  };

const blocked = (reason: string): CountGrowthComparisonPacket => ({
	status: "blocked",
	reason,
});

const finiteAbs = (value: number): number =>
	Number.isFinite(value) ? Math.abs(value) : Number.POSITIVE_INFINITY;

const close = (left: number, right: number): boolean =>
	finiteAbs(left - right) <= 1e-8;

const distance = (
	left: { readonly x: number; readonly y: number },
	right: { readonly x: number; readonly y: number },
): number => Math.hypot(left.x - right.x, left.y - right.y);

const pairFrame = (
	reference: CountGrowthReferenceSample,
	candidate: readonly CountGrowthCandidateSample[],
	scaleFloor: number,
): readonly CountGrowthComparisonPair[] | string => {
	const candidateByTarget = new Map(
		candidate.map((sample) => [sample.targetId, sample] as const),
	);
	if (candidateByTarget.size !== reference.targets.length) {
		return "Count Growth source and candidate return different target counts.";
	}
	const pairs: CountGrowthComparisonPair[] = [];
	for (const source of reference.targets) {
		const candidateSample = candidateByTarget.get(source.targetId);
		if (!candidateSample)
			return `Count Growth candidate omitted ${source.targetId}.`;
		pairs.push({
			targetId: source.targetId,
			reference: source,
			candidate: candidateSample,
			delta: {
				position: distance(source.position, candidateSample.position),
				rotation: candidateSample.rotation - source.rotation,
				scale: candidateSample.scale - source.scale,
				opacity: candidateSample.opacity - source.opacity,
				apparentActiveMatches:
					source.apparentActive ===
					candidateSample.scale >= scaleFloor + (1 - scaleFloor) * 0.5,
			},
		});
	}
	return pairs;
};

const summaryFor = (
	frames: readonly CountGrowthComparisonFrame[],
	source: CountGrowthReferenceInput,
	candidate: CountGrowthCandidateInput,
): CountGrowthComparisonSummary => {
	const sourceOrder = source.targets.map((target) => target.targetId);
	const candidateOrder = candidate.roleMappings.map(
		(mapping) => mapping.sourceTargetId,
	);
	const blueprintOrderMatches =
		JSON.stringify(sourceOrder) === JSON.stringify(candidateOrder);
	const expectedRoleMap = new Map(
		source.targets.map((target) => [target.targetId, target.role] as const),
	);
	const roleMapMatches = candidate.roleMappings.every((mapping) => {
		const expectedRole = expectedRoleMap.get(mapping.sourceTargetId);
		const actual = candidate.binding.roleMap?.[mapping.candidateNodeId] ?? "";
		return expectedRole !== undefined && actual.endsWith(`:${expectedRole}`);
	});
	let maxPositionResidual = 0;
	let maxRotationResidual = 0;
	let maxScaleResidual = 0;
	let maxOpacityResidual = 0;
	let mismatchedActiveStates = 0;
	for (const frame of frames) {
		for (const pair of frame.pairs) {
			maxPositionResidual = Math.max(
				maxPositionResidual,
				finiteAbs(pair.delta.position),
			);
			maxRotationResidual = Math.max(
				maxRotationResidual,
				finiteAbs(pair.delta.rotation),
			);
			maxScaleResidual = Math.max(
				maxScaleResidual,
				finiteAbs(pair.delta.scale),
			);
			maxOpacityResidual = Math.max(
				maxOpacityResidual,
				finiteAbs(pair.delta.opacity),
			);
			if (!pair.delta.apparentActiveMatches) mismatchedActiveStates += 1;
		}
	}
	const breathEnvelopeMatches = frames.every((frame) =>
		frame.pairs.every(
			(pair) =>
				close(pair.reference.scale, pair.candidate.scale) &&
				close(pair.reference.opacity, pair.candidate.opacity),
		),
	);
	const start = frames.find((frame) => frame.id === "loop-start");
	const seam = frames.find((frame) => frame.id === "loop-seam");
	const seamRestMatches = Boolean(
		start &&
			seam &&
			start.pairs.length === seam.pairs.length &&
			start.pairs.every((startPair) => {
				const seamPair = seam.pairs.find(
					(pair) => pair.targetId === startPair.targetId,
				);
				return Boolean(
					seamPair &&
						close(
							startPair.candidate.position.x,
							seamPair.candidate.position.x,
						) &&
						close(
							startPair.candidate.position.y,
							seamPair.candidate.position.y,
						) &&
						close(startPair.candidate.scale, seamPair.candidate.scale) &&
						close(startPair.candidate.opacity, seamPair.candidate.opacity),
				);
			}),
	);
	return {
		blueprintOrderMatches,
		roleMapMatches,
		breathEnvelopeMatches,
		seamRestMatches,
		maxPositionResidual,
		maxRotationResidual,
		maxScaleResidual,
		maxOpacityResidual,
		mismatchedActiveStates,
	};
};

const surfaces = (): readonly CountGrowthSurfaceObservation[] => [
	{
		surface: "canvas",
		status: "supported",
		reason:
			"Shared Motion presentation can sample the registered expression on existing Scene members.",
	},
	{
		surface: "svg",
		status: "not-evaluated",
		reason:
			"Shared SVG route reachability is not a pixel-fidelity claim and needs a named export packet.",
	},
	{
		surface: "pdf",
		status: "not-evaluated",
		reason: "No live PDF menu packet exists for this candidate.",
	},
	{
		surface: "javascript-code-runtime",
		status: "supported",
		reason:
			"The maintained shared sampler carries the binding without executable code in the document.",
	},
	{
		surface: "webgl",
		status: "not-evaluated",
		reason:
			"Independent GPU render evidence is not part of this structural packet.",
	},
	{
		surface: "bake",
		status: "unsupported",
		reason:
			"Count Growth is registered as live-only; arbitrary group/rail keyframe materialization has no proven owner.",
	},
];

export function buildCountGrowthComparisonPacket(
	input: CountGrowthCandidateInput,
): CountGrowthComparisonPacket {
	const criticalFrames = countGrowthReferenceCriticalFrames(input.source);
	if (criticalFrames.status === "blocked")
		return blocked(criticalFrames.reason);
	const frames: CountGrowthComparisonFrame[] = [];
	let incompatibilities: readonly string[] = [];
	for (const criticalFrame of criticalFrames.samples) {
		const reference = sampleCountGrowthReference(
			input.source,
			criticalFrame.frame,
		);
		if (reference.status === "blocked") return blocked(reference.reason);
		const candidate = sampleCountGrowthPresentationCandidate(
			input,
			criticalFrame.frame,
		);
		if (candidate.status === "blocked") return blocked(candidate.reason);
		incompatibilities = candidate.incompatibilities;
		const [referenceSample] = reference.samples;
		if (!referenceSample)
			return blocked("Count Growth reference omitted its sample.");
		const pairs = pairFrame(
			referenceSample,
			candidate.samples,
			input.source.scaleFloor,
		);
		if (typeof pairs === "string") return blocked(pairs);
		frames.push({
			id: criticalFrame.id,
			purpose: criticalFrame.purpose,
			sourceFrame: criticalFrame.frame,
			pairs,
		});
	}
	const summary = summaryFor(frames, input.source, input);
	const incompatible =
		incompatibilities.length > 0 ||
		!summary.blueprintOrderMatches ||
		!summary.roleMapMatches ||
		!summary.breathEnvelopeMatches ||
		!summary.seamRestMatches;
	return {
		status: incompatible ? "incompatible" : "ready",
		candidateSurface: COUNT_GROWTH_CANDIDATE_SURFACE,
		metric: COUNT_GROWTH_COMPARISON_METRIC,
		summary,
		frames,
		surfaces: surfaces(),
		incompatibilities,
	};
}
