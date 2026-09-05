import {
	INTERFERENCE_CANDIDATE_SURFACE,
	type InterferenceCandidateInput,
	type InterferenceCandidateSample,
	sampleInterferencePresentationCandidate,
} from "./interference-presentation-candidate";
import {
	type InterferenceReferenceInput,
	interferenceReferenceCriticalFrames,
	sampleInterferenceReference,
} from "./interference-reference-oracle";

export type InterferenceComparisonPacket =
	| { readonly status: "blocked"; readonly reason: string }
	| {
			readonly status: "ready" | "incompatible";
			readonly candidateSurface: typeof INTERFERENCE_CANDIDATE_SURFACE;
			readonly frames: readonly {
				readonly id: string;
				readonly purpose: string;
				readonly sourceFrame: number;
				readonly pairs: readonly {
					readonly targetId: string;
					readonly reference: {
						readonly position: { readonly x: number; readonly y: number };
						readonly scale: number;
						readonly opacity: number;
					};
					readonly candidate: InterferenceCandidateSample;
					readonly delta: {
						readonly position: number;
						readonly scale: number;
						readonly opacity: number;
					};
				}[];
			}[];
			readonly summary: {
				readonly roleMapMatches: boolean;
				readonly proximityRelationMatches: boolean;
				readonly seamRestMatches: boolean;
				readonly maxPositionResidual: number;
				readonly maxScaleResidual: number;
				readonly maxOpacityResidual: number;
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
		reason: "Shared Motion presentation samples the registered orbit field.",
	},
	{
		surface: "javascript-code-runtime" as const,
		status: "supported" as const,
		reason: "The maintained code route uses the same sampler.",
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
		reason: "Proximity field Bake ownership is not implemented.",
	},
];

export function buildInterferenceComparisonPacket(
	input: InterferenceCandidateInput & {
		readonly source: InterferenceReferenceInput;
	},
): InterferenceComparisonPacket {
	const critical = interferenceReferenceCriticalFrames(input.source);
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
				readonly scale: number;
				readonly opacity: number;
			};
			readonly candidate: InterferenceCandidateSample;
			readonly delta: {
				readonly position: number;
				readonly scale: number;
				readonly opacity: number;
			};
		}[];
	}> = [];
	for (const frame of critical.samples) {
		const reference = sampleInterferenceReference(input.source, frame.frame);
		if (reference.status === "blocked")
			return { status: "blocked", reason: reference.reason };
		const sourceSample = reference.samples[0];
		if (!sourceSample)
			return {
				status: "blocked",
				reason: "Interference oracle returned no critical-frame sample.",
			};
		const candidate = sampleInterferencePresentationCandidate(
			input,
			frame.frame,
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
					scale: actual.scale - source.scale,
					opacity: actual.opacity - source.opacity,
				},
			};
		});
		if (pairs.some((pair) => pair === null))
			return {
				status: "blocked",
				reason: "Interference candidate omitted a ring member.",
			};
		frames.push({
			id: frame.id,
			purpose: frame.purpose,
			sourceFrame: frame.frame,
			pairs: pairs as NonNullable<(typeof pairs)[number]>[],
		});
	}
	const roleMapMatches =
		input.binding.roleMap?.["ring-wave-interference:driver"] ===
			input.driverNodeId &&
		input.ringNodeIds.every(
			(nodeId) =>
				input.binding.roleMap?.[nodeId] === "ring-wave-interference:ring",
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
	const maxOpacityResidual = Math.max(
		...frames.flatMap((frame) =>
			frame.pairs.map((pair) => Math.abs(pair.delta.opacity)),
		),
		0,
	);
	const proximityRelationMatches = [
		"radialPush",
		"tangentialSlide",
		"falloffDistance",
		"falloffExponent",
		"minDistance",
	].every((key) => input.binding.parameters[key] !== undefined);
	const start = frames.find((frame) => frame.id === "loop-start");
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
							1e-4 &&
						Math.abs(pair.candidate.scale - seamPair.candidate.scale) <= 1e-4 &&
						Math.abs(pair.candidate.opacity - seamPair.candidate.opacity) <=
							1e-4,
				);
			}),
	);
	const gaps = [
		...(roleMapMatches
			? []
			: ["Interference driver/ring role mapping is incomplete."]),
		...(proximityRelationMatches
			? []
			: ["Proximity response parameters are incomplete."]),
		...(seamRestMatches
			? []
			: ["Interference candidate does not close at the loop seam."]),
	];
	return {
		status:
			gaps.length === 0 &&
			maxPositionResidual <= 1e-4 &&
			maxScaleResidual <= 1e-4 &&
			maxOpacityResidual <= 1e-4
				? "ready"
				: "incompatible",
		candidateSurface: INTERFERENCE_CANDIDATE_SURFACE,
		frames,
		summary: {
			roleMapMatches,
			proximityRelationMatches,
			seamRestMatches,
			maxPositionResidual,
			maxScaleResidual,
			maxOpacityResidual,
		},
		surfaces: surfaces(),
		gaps,
	};
}
