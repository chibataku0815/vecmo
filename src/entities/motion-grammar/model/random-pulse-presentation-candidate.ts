import { sampleMotionPresentationFrame } from "@/entities/motion/model/presentation";
import type { MotionDocument } from "@/entities/motion/model/types";
import { buildExpressionAwareFrameSampler } from "@/entities/scene/model/expression-presentation";
import { materializeLayoutFramesForPresentation } from "@/entities/scene/model/layout-frame-presentation";
import { findNode } from "@/entities/scene/model/selectors";
import type { SceneDocument } from "@/entities/scene/model/types";
import { describeMotionGrammarAuthoringProfile } from "./authoring-profile-registry";
import { deterministicSeededOrder } from "./deterministic-order";
import { buildMotionGrammarFrameSampler } from "./evaluator";
import { RANDOM_PULSE_PROFILE_KIND } from "./random-pulse-profile";
import {
	RANDOM_PULSE_REFERENCE_LAW_ID,
	type RandomPulseReferenceInput,
} from "./random-pulse-reference-oracle";
import type { MotionGrammarBinding } from "./types";

export const RANDOM_PULSE_CANDIDATE_SURFACE =
	"shared-presentation-structural" as const;

type CandidateClip = {
	readonly startFrame: number;
	readonly durationFrames: number;
	readonly endFrameExclusive: number;
};

export type RandomPulseCandidateRoleMapping = {
	readonly sourceTargetId: string;
	readonly candidateNodeId: string;
};

export type RandomPulseCandidateIncompatibilityCode =
	| "period-frames"
	| "cadence-frames"
	| "pulse-envelope"
	| "scale-amplitude"
	| "opacity-floor"
	| "rank-policy"
	| "authoring-surface"
	| "seed";

export type RandomPulseCandidateIncompatibility = {
	readonly code: RandomPulseCandidateIncompatibilityCode;
	readonly message: string;
	readonly expected: string;
	readonly actual: string;
};

export type RandomPulseCandidateProfileObservation = {
	readonly lawId: typeof RANDOM_PULSE_REFERENCE_LAW_ID;
	readonly pulseModel: "sine-positive-v0" | typeof RANDOM_PULSE_PROFILE_KIND;
	readonly periodFrames: number;
	readonly cadenceFrames: number;
	readonly pulseFrames: number;
	readonly scaleAmplitude: number;
	readonly opacityFloor: number;
	readonly seed: number;
	readonly order: readonly string[];
	readonly envelopeVersion: 1 | null;
};

export type RandomPulseCandidateAuthoringObservation = {
	readonly descriptor: ReturnType<typeof describeMotionGrammarAuthoringProfile>;
	readonly exposedParameterKeys: readonly string[];
	readonly unavailableSourceSemanticKeys: readonly string[];
};

export type RandomPulsePresentationCandidateInput = {
	readonly source: RandomPulseReferenceInput;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly bindings: readonly MotionGrammarBinding[];
	readonly binding: MotionGrammarBinding;
	readonly roleMappings: readonly RandomPulseCandidateRoleMapping[];
	readonly artboardId?: string | null;
};

export type RandomPulsePresentationCandidateSample = {
	readonly targetId: string;
	readonly rank: number;
	readonly candidateFrame: number;
	readonly nodeId: string;
	readonly positionX: number;
	readonly positionY: number;
	readonly scaleX: number;
	readonly scaleY: number;
	readonly opacity: number;
	readonly pulseFromScale: number | null;
};

export type RandomPulseCandidateResult =
	| {
			readonly status: "blocked";
			readonly reason: string;
	  }
	| {
			readonly status: "incompatible";
			readonly surface: typeof RANDOM_PULSE_CANDIDATE_SURFACE;
			readonly artboardId: string | null;
			readonly clip: CandidateClip;
			readonly profile: RandomPulseCandidateProfileObservation;
			readonly authoring: RandomPulseCandidateAuthoringObservation;
			readonly incompatibilities: readonly RandomPulseCandidateIncompatibility[];
			readonly samples: readonly RandomPulsePresentationCandidateSample[];
	  }
	| {
			readonly status: "ready";
			readonly surface: typeof RANDOM_PULSE_CANDIDATE_SURFACE;
			readonly artboardId: string | null;
			readonly clip: CandidateClip;
			readonly profile: RandomPulseCandidateProfileObservation;
			readonly authoring: RandomPulseCandidateAuthoringObservation;
			readonly samples: readonly RandomPulsePresentationCandidateSample[];
	  };

const blocked = (reason: string): RandomPulseCandidateResult => ({
	status: "blocked",
	reason,
});

const finiteParameter = (
	parameters: Readonly<Record<string, number>>,
	key: string,
): number | null => {
	const value = parameters[key];
	return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const positiveModulo = (value: number, modulo: number): number => {
	const remainder = value % modulo;
	return remainder < 0 ? remainder + modulo : remainder;
};

const clipFor = (
	motion: MotionDocument,
	bindingId: string,
	periodFrames: number,
): CandidateClip => {
	const clip = motion.clips.find(
		(candidate) => candidate.provenance?.bindingId === bindingId,
	);
	const clipStartFrame = clip?.startFrame;
	const clipDurationFrames = clip?.durationFrames;
	const finiteClipStartFrame =
		typeof clipStartFrame === "number" && Number.isFinite(clipStartFrame)
			? clipStartFrame
			: 0;
	const finiteClipDurationFrames =
		typeof clipDurationFrames === "number" &&
		Number.isFinite(clipDurationFrames)
			? clipDurationFrames
			: periodFrames;
	const startFrame = Math.max(0, finiteClipStartFrame);
	const durationFrames = Math.max(1, finiteClipDurationFrames);
	return {
		startFrame,
		durationFrames,
		endFrameExclusive: startFrame + durationFrames,
	};
};

const addIncompatibility = (
	list: RandomPulseCandidateIncompatibility[],
	item: RandomPulseCandidateIncompatibility,
): void => {
	if (list.some((candidate) => candidate.code === item.code)) return;
	list.push(item);
};

const resolveCandidate = (
	input: RandomPulsePresentationCandidateInput,
):
	| string
	| {
			readonly clip: CandidateClip;
			readonly profile: RandomPulseCandidateProfileObservation;
			readonly authoring: RandomPulseCandidateAuthoringObservation;
			readonly incompatibilities: readonly RandomPulseCandidateIncompatibility[];
			readonly roles: readonly RandomPulseCandidateRoleMapping[];
	  } => {
	if (input.bindings.length !== 1 || input.bindings[0] !== input.binding) {
		return "Random Pulse comparison requires exactly one matching binding.";
	}
	if (input.binding.techniqueId !== "random-phase-pulse") {
		return "Random Pulse candidate must use the random-phase-pulse technique.";
	}
	const seed = input.binding.seed;
	if (seed === undefined || !Number.isFinite(seed)) {
		return "Random Pulse candidate requires an explicit finite durable seed.";
	}
	const mappingBySource = new Map(
		input.roleMappings.map(
			(mapping) => [mapping.sourceTargetId, mapping] as const,
		),
	);
	if (mappingBySource.size !== input.source.targets.length) {
		return "Random Pulse candidate role mapping must cover every source target exactly once.";
	}
	const candidateIds = new Set(input.binding.targetIds);
	if (candidateIds.size !== input.binding.targetIds.length) {
		return "Random Pulse candidate target ids must be unique.";
	}
	const mappedCandidateIds = new Set(
		input.roleMappings.map((mapping) => mapping.candidateNodeId),
	);
	if (
		mappedCandidateIds.size !== mappingBySource.size ||
		mappedCandidateIds.size !== candidateIds.size ||
		[...candidateIds].some((nodeId) => !mappedCandidateIds.has(nodeId))
	) {
		return "Random Pulse candidate mapping must be a one-to-one cover of the binding targets.";
	}
	for (const sourceTarget of input.source.targets) {
		const mapping = mappingBySource.get(sourceTarget.targetId);
		if (!mapping || !candidateIds.has(mapping.candidateNodeId)) {
			return `Random Pulse candidate mapping is incomplete for ${sourceTarget.targetId}.`;
		}
		if (!findNode(input.scene, mapping.candidateNodeId)) {
			return `Random Pulse candidate node ${mapping.candidateNodeId} is missing from Scene.`;
		}
	}
	const periodFrames = finiteParameter(
		input.binding.parameters,
		"periodFrames",
	);
	const cadenceFrames = finiteParameter(
		input.binding.parameters,
		"cadenceFrames",
	);
	const pulseFrames = finiteParameter(input.binding.parameters, "pulseFrames");
	const scaleAmplitude = finiteParameter(
		input.binding.parameters,
		"scaleAmplitude",
	);
	const opacityFloor = finiteParameter(
		input.binding.parameters,
		"opacityFloor",
	);
	if (
		periodFrames === null ||
		cadenceFrames === null ||
		pulseFrames === null ||
		scaleAmplitude === null ||
		opacityFloor === null
	) {
		return "Random Pulse candidate requires finite catalog parameters.";
	}
	const orderedNodeIds = deterministicSeededOrder(
		input.binding.targetIds,
		(nodeId) => nodeId,
		seed,
	);
	const inverseMapping = new Map(
		input.roleMappings.map(
			(mapping) => [mapping.candidateNodeId, mapping.sourceTargetId] as const,
		),
	);
	const order = orderedNodeIds.map(
		(nodeId) => inverseMapping.get(nodeId) ?? nodeId,
	);
	const authoringDescriptor = describeMotionGrammarAuthoringProfile(
		input.binding,
	);
	const explicitEnvelope = input.binding.randomPulseProfile;
	const authoring: RandomPulseCandidateAuthoringObservation = {
		descriptor: authoringDescriptor,
		exposedParameterKeys: Object.keys(input.binding.parameters).sort(),
		unavailableSourceSemanticKeys: authoringDescriptor
			? []
			: [
					"rankTableOrVersionedSeedPolicy",
					...(explicitEnvelope ? [] : ["pulseEnvelope"]),
					"loopSeamReservation",
				],
	};
	const profile: RandomPulseCandidateProfileObservation = {
		lawId: RANDOM_PULSE_REFERENCE_LAW_ID,
		pulseModel: explicitEnvelope
			? RANDOM_PULSE_PROFILE_KIND
			: "sine-positive-v0",
		periodFrames,
		cadenceFrames,
		pulseFrames,
		scaleAmplitude,
		opacityFloor,
		seed,
		order,
		envelopeVersion: explicitEnvelope?.version ?? null,
	};
	const incompatibilities: RandomPulseCandidateIncompatibility[] = [];
	if (periodFrames !== input.source.periodFrames) {
		addIncompatibility(incompatibilities, {
			code: "period-frames",
			message: "Candidate period does not match the source-law packet.",
			expected: String(input.source.periodFrames),
			actual: String(periodFrames),
		});
	}
	if (cadenceFrames !== input.source.cadenceFrames) {
		addIncompatibility(incompatibilities, {
			code: "cadence-frames",
			message: "Candidate cadence does not match the source-law packet.",
			expected: String(input.source.cadenceFrames),
			actual: String(cadenceFrames),
		});
	}
	if (
		!explicitEnvelope ||
		pulseFrames !== input.source.envelope.durationFrames ||
		explicitEnvelope.durationFrames !== input.source.envelope.durationFrames ||
		JSON.stringify(explicitEnvelope.segments) !==
			JSON.stringify(input.source.envelope.segments)
	) {
		addIncompatibility(incompatibilities, {
			code: "pulse-envelope",
			message: explicitEnvelope
				? "Candidate envelope does not match the independent source-law envelope."
				: "Candidate exposes a sine pulse width, not the explicit shared source envelope duration.",
			expected: `${input.source.envelope.durationFrames}f explicit envelope`,
			actual: explicitEnvelope
				? `${explicitEnvelope.durationFrames}f ${RANDOM_PULSE_PROFILE_KIND}`
				: `${pulseFrames}f sine-positive-v0`,
		});
	}
	if (scaleAmplitude !== input.source.scaleAmplitude) {
		addIncompatibility(incompatibilities, {
			code: "scale-amplitude",
			message: "Candidate scale amplitude differs from the source-law input.",
			expected: String(input.source.scaleAmplitude),
			actual: String(scaleAmplitude),
		});
	}
	if (opacityFloor !== input.source.opacityFloor) {
		addIncompatibility(incompatibilities, {
			code: "opacity-floor",
			message: "Candidate opacity floor differs from the source-law input.",
			expected: String(input.source.opacityFloor),
			actual: String(opacityFloor),
		});
	}
	const expectedOrder = [...input.source.targets]
		.sort((left, right) => left.rank - right.rank)
		.map((target) => target.targetId);
	if (JSON.stringify(order) !== JSON.stringify(expectedOrder)) {
		addIncompatibility(incompatibilities, {
			code: "rank-policy",
			message:
				"Candidate seed policy resolves a different rank order than the explicit source table.",
			expected: JSON.stringify(expectedOrder),
			actual: JSON.stringify(order),
		});
	}
	if (!authoringDescriptor) {
		addIncompatibility(incompatibilities, {
			code: "authoring-surface",
			message:
				"Random Pulse has no promoted profile/module, so the source envelope and rank provenance are not normally authorable.",
			expected: "promoted semantic authoring descriptor",
			actual: "catalog/evaluator binding only",
		});
	}
	return {
		clip: clipFor(input.motion, input.binding.id, periodFrames),
		profile,
		authoring,
		incompatibilities,
		roles: input.roleMappings,
	};
};

/**
 * Samples the current evaluator through the shared Canvas/export presentation
 * bridge. It intentionally reports `incompatible` for the existing sine
 * surrogate rather than upgrading it into a source-law profile.
 */
export function sampleRandomPulsePresentationCandidate(
	input: RandomPulsePresentationCandidateInput,
	sourceFrame: number,
): RandomPulseCandidateResult {
	if (!Number.isFinite(sourceFrame)) {
		return blocked("Random Pulse source comparison frame must be finite.");
	}
	const resolved = resolveCandidate(input);
	if (typeof resolved === "string") return blocked(resolved);
	const localFrame = positiveModulo(sourceFrame, input.source.periodFrames);
	const frame = resolved.clip.startFrame + localFrame;
	if (
		frame < resolved.clip.startFrame ||
		frame >= resolved.clip.endFrameExclusive ||
		frame > input.motion.durationFrames
	) {
		return blocked(
			"Random Pulse candidate frame lies outside the resolved profile clip.",
		);
	}
	const layoutScene = materializeLayoutFramesForPresentation(input.scene);
	const grammar = buildExpressionAwareFrameSampler({
		scene: layoutScene,
		fps: input.motion.fps,
		baseSampler: buildMotionGrammarFrameSampler({
			bindings: input.bindings,
			scene: layoutScene,
			motion: input.motion,
		}),
	});
	if (!grammar) {
		return blocked(
			"Random Pulse candidate has no shared grammar presentation sampler.",
		);
	}
	const presentation = sampleMotionPresentationFrame({
		scene: input.scene,
		motion: input.motion,
		frame,
		artboardId: input.artboardId ?? null,
		grammar,
	});
	const valuesByNodeId = new Map(
		presentation.values.map((value) => [value.nodeId, value] as const),
	);
	const rankBySourceTarget = new Map(
		resolved.profile.order.map((targetId, rank) => [targetId, rank] as const),
	);
	const samples: RandomPulsePresentationCandidateSample[] = [];
	for (const mapping of resolved.roles) {
		const value = valuesByNodeId.get(mapping.candidateNodeId);
		const rank = rankBySourceTarget.get(mapping.sourceTargetId);
		const node = findNode(input.scene, mapping.candidateNodeId);
		if (!value || !node || rank === undefined) {
			return blocked(
				"Random Pulse shared presentation omitted a mapped target or rank.",
			);
		}
		const baseScaleX = node.transform.scale.x;
		const baseScaleY = node.transform.scale.y;
		const baseOpacity = node.style.opacity;
		if (
			Math.abs(baseScaleX) <= 1e-9 ||
			Math.abs(baseScaleY) <= 1e-9 ||
			!Number.isFinite(baseOpacity) ||
			Math.abs(baseOpacity) <= 1e-9
		) {
			return blocked(
				"Random Pulse candidate requires non-zero finite base scale and opacity channels.",
			);
		}
		const scaleX = value.transform.scale.x / baseScaleX;
		const scaleY = value.transform.scale.y / baseScaleY;
		const opacity = value.opacity / baseOpacity;
		const channels = [
			value.transform.position.x,
			value.transform.position.y,
			scaleX,
			scaleY,
			opacity,
		];
		if (!channels.every(Number.isFinite)) {
			return blocked(
				"Random Pulse shared presentation emitted a non-finite channel.",
			);
		}
		const amplitude = resolved.profile.scaleAmplitude;
		samples.push({
			targetId: mapping.sourceTargetId,
			rank,
			candidateFrame: frame,
			nodeId: mapping.candidateNodeId,
			positionX: value.transform.position.x,
			positionY: value.transform.position.y,
			scaleX,
			scaleY,
			opacity,
			pulseFromScale:
				Math.abs(amplitude) > 1e-9 ? (scaleX - 1) / amplitude : null,
		});
	}
	if (resolved.incompatibilities.length > 0) {
		return {
			status: "incompatible",
			surface: RANDOM_PULSE_CANDIDATE_SURFACE,
			artboardId: input.artboardId ?? null,
			clip: resolved.clip,
			profile: resolved.profile,
			authoring: resolved.authoring,
			incompatibilities: resolved.incompatibilities,
			samples,
		};
	}
	return {
		status: "ready",
		surface: RANDOM_PULSE_CANDIDATE_SURFACE,
		artboardId: input.artboardId ?? null,
		clip: resolved.clip,
		profile: resolved.profile,
		authoring: resolved.authoring,
		samples,
	};
}
