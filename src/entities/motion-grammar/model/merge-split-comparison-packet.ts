import {
	MERGE_SPLIT_CANDIDATE_SURFACE,
	type MergeSplitCandidateInput,
	type MergeSplitCandidateSample,
	sampleMergeSplitPresentationCandidate,
} from "./merge-split-presentation-candidate";
import {
	type MergeSplitReferenceSample,
	mergeSplitReferenceCriticalFrames,
	sampleMergeSplitReference,
} from "./merge-split-reference-oracle";

export const MERGE_SPLIT_COMPARISON_METRIC =
	"shared-presentation-delayed-gather-structural" as const;

export type MergeSplitComparisonPair = {
	readonly targetId: string;
	readonly role: string;
	readonly reference: MergeSplitReferenceSample["targets"][number];
	readonly candidate: MergeSplitCandidateSample;
	readonly delta: {
		readonly position: number;
		readonly scale: number;
		readonly opacity: number;
	};
};
export type MergeSplitComparisonFrame = {
	readonly id: string;
	readonly purpose: string;
	readonly sourceFrame: number;
	readonly pairs: readonly MergeSplitComparisonPair[];
};
export type MergeSplitComparisonSummary = {
	readonly blueprintOrderMatches: boolean;
	readonly roleMapMatches: boolean;
	readonly gatherEnvelopeMatches: boolean;
	readonly coreAreaMatches: boolean;
	readonly seamRestMatches: boolean;
	readonly maxPositionResidual: number;
	readonly maxScaleResidual: number;
	readonly maxOpacityResidual: number;
};
export type MergeSplitSurfaceObservation = {
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
export type MergeSplitComparisonPacket =
	| { readonly status: "blocked"; readonly reason: string }
	| {
			readonly status: "incompatible" | "ready";
			readonly candidateSurface: typeof MERGE_SPLIT_CANDIDATE_SURFACE;
			readonly metric: typeof MERGE_SPLIT_COMPARISON_METRIC;
			readonly summary: MergeSplitComparisonSummary;
			readonly frames: readonly MergeSplitComparisonFrame[];
			readonly surfaces: readonly MergeSplitSurfaceObservation[];
			readonly incompatibilities: readonly string[];
	  };

const blocked = (reason: string): MergeSplitComparisonPacket => ({
	status: "blocked",
	reason,
});
const distance = (
	left: { readonly x: number; readonly y: number },
	right: { readonly x: number; readonly y: number },
): number => Math.hypot(left.x - right.x, left.y - right.y);
const abs = (value: number): number =>
	Number.isFinite(value) ? Math.abs(value) : Number.POSITIVE_INFINITY;
const close = (left: number, right: number): boolean =>
	abs(left - right) <= 1e-7;

const surfaces = (): readonly MergeSplitSurfaceObservation[] => [
	{
		surface: "canvas",
		status: "supported",
		reason:
			"Canvas consumes the shared expression presentation for real member/core nodes.",
	},
	{
		surface: "javascript-code-runtime",
		status: "supported",
		reason:
			"Generated runtime uses the registered sampler and stores no executable document code.",
	},
	{
		surface: "svg",
		status: "not-evaluated",
		reason:
			"SVG export reachability is not a pixel-fidelity claim without a named export packet.",
	},
	{
		surface: "pdf",
		status: "not-evaluated",
		reason: "No live PDF menu packet exists for this profile.",
	},
	{
		surface: "webgl",
		status: "not-evaluated",
		reason:
			"Independent GPU render evidence is outside this structural packet.",
	},
	{
		surface: "bake",
		status: "unsupported",
		reason:
			"Core/member relation is registered live-only; no truthful derived-core bake owner exists.",
	},
];

export function buildMergeSplitComparisonPacket(
	input: MergeSplitCandidateInput,
): MergeSplitComparisonPacket {
	const critical = mergeSplitReferenceCriticalFrames(input.source);
	if (critical.status === "blocked") return blocked(critical.reason);
	const frames: MergeSplitComparisonFrame[] = [];
	let incompatibilities: readonly string[] = [];
	for (const criticalFrame of critical.samples) {
		const reference = sampleMergeSplitReference(
			input.source,
			criticalFrame.frame,
		);
		if (reference.status === "blocked") return blocked(reference.reason);
		const candidate = sampleMergeSplitPresentationCandidate(
			input,
			criticalFrame.frame,
		);
		if (candidate.status === "blocked") return blocked(candidate.reason);
		incompatibilities = candidate.incompatibilities;
		const [referenceSample] = reference.samples;
		if (!referenceSample)
			return blocked("Merge / Split reference omitted its sample.");
		const sourceById = new Map(
			referenceSample.targets.map(
				(target) => [target.targetId, target] as const,
			),
		);
		const pairs: MergeSplitComparisonPair[] = [];
		for (const sample of candidate.samples) {
			const source = sourceById.get(sample.targetId);
			if (!source)
				return blocked(`Merge / Split reference omitted ${sample.targetId}.`);
			pairs.push({
				targetId: sample.targetId,
				role: sample.role,
				reference: source,
				candidate: sample,
				delta: {
					position: distance(source.position, sample.position),
					scale: sample.scale - source.scale,
					opacity: sample.opacity - source.opacity,
				},
			});
		}
		frames.push({
			id: criticalFrame.id,
			purpose: criticalFrame.purpose,
			sourceFrame: criticalFrame.frame,
			pairs,
		});
	}
	const sourceOrder = input.source.targets.map((target) => target.targetId);
	const candidateOrder = input.roleMappings.map(
		(mapping) => mapping.sourceTargetId,
	);
	const roleMapMatches = input.source.targets.every((target) =>
		(input.binding.roleMap?.[target.targetId] ?? "").endsWith(
			`:${target.role}`,
		),
	);
	let maxPositionResidual = 0;
	let maxScaleResidual = 0;
	let maxOpacityResidual = 0;
	for (const frame of frames) {
		for (const pair of frame.pairs) {
			maxPositionResidual = Math.max(
				maxPositionResidual,
				abs(pair.delta.position),
			);
			maxScaleResidual = Math.max(maxScaleResidual, abs(pair.delta.scale));
			maxOpacityResidual = Math.max(
				maxOpacityResidual,
				abs(pair.delta.opacity),
			);
		}
	}
	const gatherEnvelopeMatches = frames.every((frame) =>
		frame.pairs.every(
			(pair) =>
				close(pair.reference.scale, pair.candidate.scale) &&
				close(pair.reference.opacity, pair.candidate.opacity),
		),
	);
	const coreAreaMatches = frames.every((frame) => {
		const core = frame.pairs.find((pair) => pair.role === "core");
		return core ? close(core.reference.scale, core.candidate.scale) : true;
	});
	const start = frames.find((frame) => frame.id === "loop-start");
	const seam = frames.find((frame) => frame.id === "loop-seam");
	const seamRestMatches = Boolean(
		start &&
			seam &&
			start.pairs.length === seam.pairs.length &&
			start.pairs.every((pair) => {
				const seamPair = seam.pairs.find(
					(candidate) => candidate.targetId === pair.targetId,
				);
				return Boolean(
					seamPair &&
						close(pair.candidate.position.x, seamPair.candidate.position.x) &&
						close(pair.candidate.position.y, seamPair.candidate.position.y) &&
						close(pair.candidate.scale, seamPair.candidate.scale) &&
						close(pair.candidate.opacity, seamPair.candidate.opacity),
				);
			}),
	);
	const summary: MergeSplitComparisonSummary = {
		blueprintOrderMatches:
			JSON.stringify(sourceOrder) === JSON.stringify(candidateOrder),
		roleMapMatches,
		gatherEnvelopeMatches,
		coreAreaMatches,
		seamRestMatches,
		maxPositionResidual,
		maxScaleResidual,
		maxOpacityResidual,
	};
	const incompatible =
		incompatibilities.length > 0 ||
		!summary.blueprintOrderMatches ||
		!summary.roleMapMatches ||
		!summary.gatherEnvelopeMatches ||
		!summary.coreAreaMatches ||
		!summary.seamRestMatches;
	return {
		status: incompatible ? "incompatible" : "ready",
		candidateSurface: MERGE_SPLIT_CANDIDATE_SURFACE,
		metric: MERGE_SPLIT_COMPARISON_METRIC,
		summary,
		frames,
		surfaces: surfaces(),
		incompatibilities,
	};
}
