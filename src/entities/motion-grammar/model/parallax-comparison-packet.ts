import {
	PARALLAX_CANDIDATE_SURFACE,
	type ParallaxCandidateInput,
	type ParallaxCandidateSample,
	sampleParallaxPresentationCandidate,
} from "./parallax-presentation-candidate";
import {
	type ParallaxReferenceSample,
	parallaxReferenceCriticalFrames,
	sampleParallaxReference,
} from "./parallax-reference-oracle";

export const PARALLAX_COMPARISON_METRIC =
	"shared-presentation-parallax-wave-structural" as const;
export type ParallaxComparisonFrame = {
	readonly id: string;
	readonly purpose: string;
	readonly sourceFrame: number;
	readonly pairs: readonly {
		readonly targetId: string;
		readonly role: string;
		readonly reference: ParallaxReferenceSample["targets"][number];
		readonly candidate: ParallaxCandidateSample;
		readonly delta: number;
	}[];
};
export type ParallaxComparisonSummary = {
	readonly blueprintOrderMatches: boolean;
	readonly roleMapMatches: boolean;
	readonly waveEnvelopeMatches: boolean;
	readonly amplitudeOrderingMatches: boolean;
	readonly seamRestMatches: boolean;
	readonly maxPositionResidual: number;
};
export type ParallaxSurfaceObservation = {
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
export type ParallaxComparisonPacket =
	| { readonly status: "blocked"; readonly reason: string }
	| {
			readonly status: "incompatible" | "ready";
			readonly candidateSurface: typeof PARALLAX_CANDIDATE_SURFACE;
			readonly metric: typeof PARALLAX_COMPARISON_METRIC;
			readonly summary: ParallaxComparisonSummary;
			readonly frames: readonly ParallaxComparisonFrame[];
			readonly surfaces: readonly ParallaxSurfaceObservation[];
			readonly incompatibilities: readonly string[];
	  };

const blocked = (reason: string): ParallaxComparisonPacket => ({
	status: "blocked",
	reason,
});
const distance = (
	left: { readonly x: number; readonly y: number },
	right: { readonly x: number; readonly y: number },
): number => Math.hypot(left.x - right.x, left.y - right.y);
const close = (left: number, right: number): boolean =>
	Math.abs(left - right) <= 1e-7;
const surfaces = (): readonly ParallaxSurfaceObservation[] => [
	{
		surface: "canvas",
		status: "supported",
		reason: "Canvas consumes shared screen-space wave presentation.",
	},
	{
		surface: "javascript-code-runtime",
		status: "supported",
		reason:
			"Generated runtime resolves the registered expression without executable document code.",
	},
	{
		surface: "svg",
		status: "not-evaluated",
		reason: "SVG export reachability is not pixel-fidelity evidence.",
	},
	{
		surface: "pdf",
		status: "not-evaluated",
		reason: "No live PDF menu packet exists for this profile.",
	},
	{
		surface: "webgl",
		status: "not-evaluated",
		reason: "Independent GPU render evidence is outside this packet.",
	},
	{
		surface: "bake",
		status: "unsupported",
		reason:
			"Parallax remains live-only; no role-amplitude keyframe bake owner exists.",
	},
];

export function buildParallaxComparisonPacket(
	input: ParallaxCandidateInput,
): ParallaxComparisonPacket {
	const critical = parallaxReferenceCriticalFrames(input.source);
	if (critical.status === "blocked") return blocked(critical.reason);
	const frames: ParallaxComparisonFrame[] = [];
	let incompatibilities: readonly string[] = [];
	for (const criticalFrame of critical.samples) {
		const reference = sampleParallaxReference(
			input.source,
			criticalFrame.frame,
		);
		if (reference.status === "blocked") return blocked(reference.reason);
		const candidate = sampleParallaxPresentationCandidate(
			input,
			criticalFrame.frame,
		);
		if (candidate.status === "blocked") return blocked(candidate.reason);
		incompatibilities = candidate.incompatibilities;
		const [referenceSample] = reference.samples;
		if (!referenceSample)
			return blocked("Parallax reference omitted its sample.");
		const sourceById = new Map(
			referenceSample.targets.map(
				(target) => [target.targetId, target] as const,
			),
		);
		const pairs = candidate.samples.map((sample) => {
			const source = sourceById.get(sample.targetId);
			if (!source) return null;
			return {
				targetId: sample.targetId,
				role: sample.role,
				reference: source,
				candidate: sample,
				delta: distance(source.position, sample.position),
			};
		});
		if (pairs.some((pair) => pair === null))
			return blocked("Parallax reference omitted a candidate target.");
		frames.push({
			id: criticalFrame.id,
			purpose: criticalFrame.purpose,
			sourceFrame: criticalFrame.frame,
			pairs: pairs as NonNullable<(typeof pairs)[number]>[],
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
	const waveEnvelopeMatches = frames.every((frame) =>
		frame.pairs.every((pair) => pair.delta <= 1e-7),
	);
	const amplitudeOrderingMatches =
		input.source.nearAmplitude >= input.source.midAmplitude &&
		input.source.midAmplitude >= input.source.farAmplitude;
	let maxPositionResidual = 0;
	for (const frame of frames)
		for (const pair of frame.pairs)
			maxPositionResidual = Math.max(maxPositionResidual, pair.delta);
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
						close(pair.candidate.position.y, seamPair.candidate.position.y),
				);
			}),
	);
	const summary: ParallaxComparisonSummary = {
		blueprintOrderMatches:
			JSON.stringify(sourceOrder) === JSON.stringify(candidateOrder),
		roleMapMatches,
		waveEnvelopeMatches,
		amplitudeOrderingMatches,
		seamRestMatches,
		maxPositionResidual,
	};
	const incompatible =
		incompatibilities.length > 0 ||
		!summary.blueprintOrderMatches ||
		!summary.roleMapMatches ||
		!summary.waveEnvelopeMatches ||
		!summary.amplitudeOrderingMatches ||
		!summary.seamRestMatches;
	return {
		status: incompatible ? "incompatible" : "ready",
		candidateSurface: PARALLAX_CANDIDATE_SURFACE,
		metric: PARALLAX_COMPARISON_METRIC,
		summary,
		frames,
		surfaces: surfaces(),
		incompatibilities,
	};
}
