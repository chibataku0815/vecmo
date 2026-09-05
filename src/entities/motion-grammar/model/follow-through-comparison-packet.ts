import {
	FOLLOW_THROUGH_CANDIDATE_SURFACE,
	type FollowThroughCandidateInput,
	type FollowThroughCandidateSample,
	sampleFollowThroughPresentationCandidate,
} from "./follow-through-presentation-candidate";
import {
	type FollowThroughReferenceInput,
	followThroughReferenceCriticalFrames,
	sampleFollowThroughReference,
} from "./follow-through-reference-oracle";

export type FollowThroughComparisonPacket =
	| { readonly status: "blocked"; readonly reason: string }
	| {
			readonly status: "ready" | "incompatible";
			readonly candidateSurface: typeof FOLLOW_THROUGH_CANDIDATE_SURFACE;
			readonly frames: readonly {
				readonly id: string;
				readonly purpose: string;
				readonly sourceFrame: number;
				readonly pairs: readonly {
					readonly targetId: string;
					readonly reference: {
						readonly position: { readonly x: number; readonly y: number };
						readonly rotation: number;
					};
					readonly candidate: FollowThroughCandidateSample;
					readonly delta: {
						readonly position: number;
						readonly rotation: number;
					};
				}[];
			}[];
			readonly summary: {
				readonly roleMapMatches: boolean;
				readonly velocityRelationMatches: boolean;
				readonly seamRestMatches: boolean;
				readonly maxPositionResidual: number;
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
			"Shared Motion presentation samples the derivative-aware expression.",
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
		reason: "PDF evidence is not captured for this carrier.",
	},
	{
		surface: "webgl" as const,
		status: "not-evaluated" as const,
		reason: "Independent GPU render evidence is not captured for this carrier.",
	},
	{
		surface: "bake" as const,
		status: "unsupported" as const,
		reason: "Velocity-derived relation Bake ownership is not implemented.",
	},
];

export function buildFollowThroughComparisonPacket(
	input: FollowThroughCandidateInput & {
		readonly source: FollowThroughReferenceInput;
	},
): FollowThroughComparisonPacket {
	const critical = followThroughReferenceCriticalFrames(input.source);
	if (critical.status === "blocked")
		return { status: "blocked", reason: critical.reason };
	const frames: Array<{
		readonly id: string;
		readonly purpose: string;
		readonly sourceFrame: number;
		readonly pairs: readonly {
			readonly targetId: string;
			readonly reference: {
				readonly position: { readonly x: number; readonly y: number };
				readonly rotation: number;
			};
			readonly candidate: FollowThroughCandidateSample;
			readonly delta: { readonly position: number; readonly rotation: number };
		}[];
	}> = [];
	for (const criticalFrame of critical.samples) {
		const reference = sampleFollowThroughReference(
			input.source,
			criticalFrame.frame,
		);
		if (reference.status === "blocked")
			return { status: "blocked", reason: reference.reason };
		const sourceSample = reference.samples[0];
		if (!sourceSample)
			return {
				status: "blocked",
				reason: "Follow-through oracle returned no critical-frame sample.",
			};
		const candidate = sampleFollowThroughPresentationCandidate(
			input,
			criticalFrame.frame,
		);
		if (candidate.status === "blocked") return candidate;
		const pairs = input.source.targets.map((target) => {
			const source = sourceSample.targets.find(
				(sample) => sample.targetId === target.targetId,
			);
			const actual = candidate.samples.find(
				(sample) => sample.nodeId === target.targetId,
			);
			if (!source || !actual) return null;
			return {
				targetId: target.targetId,
				reference: source,
				candidate: actual,
				delta: {
					position: distance(source.position, actual.position),
					rotation: actual.rotation - source.rotation,
				},
			};
		});
		if (pairs.some((pair) => pair === null))
			return {
				status: "blocked",
				reason: "Follow-through candidate omitted a follower sample.",
			};
		frames.push({
			id: criticalFrame.id,
			purpose: criticalFrame.purpose,
			sourceFrame: criticalFrame.frame,
			pairs: pairs as NonNullable<(typeof pairs)[number]>[],
		});
	}
	const roleMapMatches =
		input.binding.roleMap?.["lag-follow-through:leader"] ===
			input.leaderNodeId &&
		input.followerNodeIds.every(
			(nodeId) =>
				input.binding.roleMap?.[nodeId] === "lag-follow-through:follower",
		);
	const maxPositionResidual = Math.max(
		...frames.flatMap((frame) =>
			frame.pairs.map((pair) => pair.delta.position),
		),
		0,
	);
	const maxRotationResidual = Math.max(
		...frames.flatMap((frame) =>
			frame.pairs.map((pair) => Math.abs(pair.delta.rotation)),
		),
		0,
	);
	const velocityRelationMatches =
		input.binding.parameters.velocityLookback !== undefined &&
		input.binding.parameters.settleFrames !== undefined;
	const rest = frames.find((frame) => frame.id === "rest");
	const seam = frames.find((frame) => frame.id === "loop-seam");
	const seamRestMatches = Boolean(
		rest &&
			seam &&
			rest.pairs.every((pair) => {
				const seamPair = seam.pairs.find(
					(candidate) => candidate.targetId === pair.targetId,
				);
				return Boolean(
					seamPair &&
						distance(pair.candidate.position, seamPair.candidate.position) <=
							1e-8 &&
						Math.abs(pair.candidate.rotation - seamPair.candidate.rotation) <=
							1e-8,
				);
			}),
	);
	const gaps = [
		...(roleMapMatches
			? []
			: ["Follow-through leader/follower role mapping is incomplete."]),
		...(velocityRelationMatches
			? []
			: ["Velocity lookback or settle parameters are missing."]),
		...(seamRestMatches
			? []
			: ["Follow-through candidate does not close at the loop seam."]),
	];
	return {
		status:
			gaps.length === 0 &&
			maxPositionResidual <= 1e-4 &&
			maxRotationResidual <= 1e-4
				? "ready"
				: "incompatible",
		candidateSurface: FOLLOW_THROUGH_CANDIDATE_SURFACE,
		frames,
		summary: {
			roleMapMatches,
			velocityRelationMatches,
			seamRestMatches,
			maxPositionResidual,
			maxRotationResidual,
		},
		surfaces: surfaces(),
		gaps,
	};
}
