import { sampleMotionPresentationFrame } from "@/entities/motion/model/presentation";
import type { MotionDocument } from "@/entities/motion/model/types";
import { buildExpressionAwareFrameSampler } from "@/entities/scene/model/expression-presentation";
import { materializeLayoutFramesForPresentation } from "@/entities/scene/model/layout-frame-presentation";
import {
	findNode,
	selectArtboardIdForNode,
} from "@/entities/scene/model/selectors";
import type { SceneDocument } from "@/entities/scene/model/types";
import { describeMotionGrammarAuthoringProfile } from "./authoring-profile-registry";
import {
	COUNT_GROWTH_REFERENCE_LAW_ID,
	type CountGrowthReferenceInput,
	type CountGrowthReferenceRole,
} from "./count-growth-reference-oracle";
import { buildMotionGrammarFrameSampler } from "./evaluator";
import type { MotionGrammarBinding } from "./types";

export const COUNT_GROWTH_CANDIDATE_SURFACE =
	"shared-presentation-count-growth" as const;

export type CountGrowthCandidateRoleMapping = {
	readonly sourceTargetId: string;
	readonly candidateNodeId: string;
};

export type CountGrowthCandidateInput = {
	readonly source: CountGrowthReferenceInput;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly bindings: readonly MotionGrammarBinding[];
	readonly binding: MotionGrammarBinding;
	readonly roleMappings: readonly CountGrowthCandidateRoleMapping[];
	readonly artboardId?: string | null;
};

export type CountGrowthCandidateProfileObservation = {
	readonly lawId: typeof COUNT_GROWTH_REFERENCE_LAW_ID;
	readonly periodFrames: number;
	readonly growFrames: number;
	readonly targetRoles: Readonly<Record<string, CountGrowthReferenceRole>>;
	readonly roleMap: Readonly<Record<string, string>>;
};

export type CountGrowthCandidateAuthoringObservation = {
	readonly descriptor: ReturnType<typeof describeMotionGrammarAuthoringProfile>;
	readonly exposedParameterKeys: readonly string[];
	readonly unavailableSourceSemanticKeys: readonly string[];
};

export type CountGrowthCandidateSample = {
	readonly targetId: string;
	readonly candidateFrame: number;
	readonly nodeId: string;
	readonly position: { readonly x: number; readonly y: number };
	readonly rotation: number;
	readonly scale: number;
	readonly opacity: number;
};

export type CountGrowthCandidateResult =
	| { readonly status: "blocked"; readonly reason: string }
	| {
			readonly status: "incompatible" | "ready";
			readonly surface: typeof COUNT_GROWTH_CANDIDATE_SURFACE;
			readonly artboardId: string | null;
			readonly profile: CountGrowthCandidateProfileObservation;
			readonly authoring: CountGrowthCandidateAuthoringObservation;
			readonly incompatibilities: readonly string[];
			readonly samples: readonly CountGrowthCandidateSample[];
	  };

const blocked = (reason: string): CountGrowthCandidateResult => ({
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

const clipFor = (
	motion: MotionDocument,
	bindingId: string,
	periodFrames: number,
): { readonly startFrame: number; readonly durationFrames: number } => {
	const clip = motion.clips.find(
		(candidate) => candidate.provenance?.bindingId === bindingId,
	);
	const startFrame =
		typeof clip?.startFrame === "number" && Number.isFinite(clip.startFrame)
			? Math.max(0, clip.startFrame)
			: 0;
	const durationFrames =
		typeof clip?.durationFrames === "number" &&
		Number.isFinite(clip.durationFrames)
			? Math.max(1, clip.durationFrames)
			: periodFrames;
	return { startFrame, durationFrames };
};

const resolveCandidate = (
	input: CountGrowthCandidateInput,
):
	| string
	| {
			readonly clip: {
				readonly startFrame: number;
				readonly durationFrames: number;
			};
			readonly profile: CountGrowthCandidateProfileObservation;
			readonly authoring: CountGrowthCandidateAuthoringObservation;
			readonly incompatibilities: readonly string[];
			readonly artboardId: string;
			readonly mappings: readonly CountGrowthCandidateRoleMapping[];
	  } => {
	if (input.bindings.length !== 1 || input.bindings[0] !== input.binding) {
		return "Count Growth comparison requires exactly one matching binding.";
	}
	if (input.binding.techniqueId !== "count-growth") {
		return "Count Growth candidate must use the count-growth technique.";
	}
	const sourceIds = new Set(
		input.source.targets.map((target) => target.targetId),
	);
	const mappingsBySource = new Map(
		input.roleMappings.map(
			(mapping) => [mapping.sourceTargetId, mapping] as const,
		),
	);
	const candidateIds = new Set(input.binding.targetIds);
	if (
		mappingsBySource.size !== sourceIds.size ||
		input.roleMappings.some(
			(mapping) => !sourceIds.has(mapping.sourceTargetId),
		) ||
		new Set(input.roleMappings.map((mapping) => mapping.candidateNodeId))
			.size !== input.roleMappings.length ||
		input.roleMappings.some(
			(mapping) => !candidateIds.has(mapping.candidateNodeId),
		)
	) {
		return "Count Growth candidate role mapping must cover source and binding targets one-to-one.";
	}
	const firstMapping = input.roleMappings[0];
	const firstNode = firstMapping
		? findNode(input.scene, firstMapping.candidateNodeId)
		: null;
	const artboardId = firstNode
		? selectArtboardIdForNode(input.scene, firstNode.id)
		: null;
	if (!artboardId)
		return "Count Growth candidate nodes must resolve to one artboard.";
	if (
		input.artboardId !== undefined &&
		input.artboardId !== null &&
		input.artboardId !== artboardId
	) {
		return "Count Growth candidate artboard does not match the mapped target artboard.";
	}
	const artboard = (input.scene.artboards ?? [input.scene.artboard]).find(
		(candidate) => candidate.id === artboardId,
	);
	if (artboard?.cameraSpacePolicy !== "screen_2d") {
		return "Count Growth comparison requires an explicit screen_2d camera-space policy.";
	}
	const parameterKeys = [
		"periodFrames",
		"growFrames",
		"scaleFloor",
		"opacityFloor",
		"breathOpenFraction",
		"breathHoldFraction",
		"breathRadiusScale",
		"centerOffsetX",
		"centerOffsetY",
		"rotationDegrees",
		"edgeRailAmplitude",
		"groupStaggerFrames",
	] as const;
	const parameters = Object.fromEntries(
		parameterKeys.map((key) => [
			key,
			finiteParameter(input.binding.parameters, key),
		]),
	);
	if (Object.values(parameters).some((value) => value === null)) {
		return "Count Growth candidate requires all registered profile parameters.";
	}
	const targetRoles = Object.fromEntries(
		input.source.targets.map((target) => [target.targetId, target.role]),
	);
	const profile: CountGrowthCandidateProfileObservation = {
		lawId: COUNT_GROWTH_REFERENCE_LAW_ID,
		periodFrames: parameters.periodFrames as number,
		growFrames: parameters.growFrames as number,
		targetRoles,
		roleMap: input.binding.roleMap ?? {},
	};
	const descriptor = describeMotionGrammarAuthoringProfile(input.binding);
	const authoring: CountGrowthCandidateAuthoringObservation = {
		descriptor,
		exposedParameterKeys: Object.keys(input.binding.parameters).sort(),
		unavailableSourceSemanticKeys: descriptor
			? []
			: ["blueprint-role-map", "master-breath", "group-reveal", "edge-rail"],
	};
	const incompatibilities: string[] = [];
	for (const key of parameterKeys) {
		const candidateValue = parameters[key] as number;
		const sourceValue = input.source[key];
		if (candidateValue !== sourceValue) {
			incompatibilities.push(
				`${key}: expected ${sourceValue}, got ${candidateValue}`,
			);
		}
	}
	if (!descriptor)
		incompatibilities.push(
			"Count Growth has no projected authoring descriptor.",
		);
	return {
		clip: clipFor(input.motion, input.binding.id, input.source.periodFrames),
		profile,
		authoring,
		incompatibilities,
		artboardId,
		mappings: input.roleMappings,
	};
};

export function sampleCountGrowthPresentationCandidate(
	input: CountGrowthCandidateInput,
	sourceFrame: number,
): CountGrowthCandidateResult {
	if (!Number.isFinite(sourceFrame))
		return blocked("Count Growth candidate frame must be finite.");
	const resolved = resolveCandidate(input);
	if (typeof resolved === "string") return blocked(resolved);
	const localFrame =
		((sourceFrame % input.source.periodFrames) + input.source.periodFrames) %
		input.source.periodFrames;
	const frame = resolved.clip.startFrame + localFrame;
	if (frame > input.motion.durationFrames)
		return blocked(
			"Count Growth candidate frame lies outside Motion duration.",
		);
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
	if (!grammar)
		return blocked(
			"Count Growth candidate has no shared grammar presentation sampler.",
		);
	const presentation = sampleMotionPresentationFrame({
		scene: input.scene,
		motion: input.motion,
		frame,
		artboardId: resolved.artboardId,
		grammar,
	});
	const valuesByNodeId = new Map(
		presentation.values.map((value) => [value.nodeId, value] as const),
	);
	const samples: CountGrowthCandidateSample[] = [];
	for (const mapping of resolved.mappings) {
		const node = findNode(input.scene, mapping.candidateNodeId);
		const value = valuesByNodeId.get(mapping.candidateNodeId);
		if (!node || !value)
			return blocked(
				"Count Growth shared presentation omitted a mapped target.",
			);
		if (
			Math.abs(node.transform.scale.x) <= 1e-9 ||
			Math.abs(node.transform.scale.y) <= 1e-9 ||
			Math.abs(node.style.opacity) <= 1e-9
		) {
			return blocked(
				"Count Growth candidate requires non-zero base scale and opacity.",
			);
		}
		const scaleX = value.transform.scale.x / node.transform.scale.x;
		const scaleY = value.transform.scale.y / node.transform.scale.y;
		const opacity = value.opacity / node.style.opacity;
		if (
			![
				value.transform.position.x,
				value.transform.position.y,
				value.transform.rotation,
				scaleX,
				scaleY,
				opacity,
			].every(Number.isFinite)
		) {
			return blocked(
				"Count Growth shared presentation emitted a non-finite channel.",
			);
		}
		samples.push({
			targetId: mapping.sourceTargetId,
			candidateFrame: frame,
			nodeId: mapping.candidateNodeId,
			position: value.transform.position,
			rotation: value.transform.rotation,
			scale: (scaleX + scaleY) / 2,
			opacity,
		});
	}
	return {
		status: resolved.incompatibilities.length > 0 ? "incompatible" : "ready",
		surface: COUNT_GROWTH_CANDIDATE_SURFACE,
		artboardId: resolved.artboardId,
		profile: resolved.profile,
		authoring: resolved.authoring,
		incompatibilities: resolved.incompatibilities,
		samples,
	};
}
