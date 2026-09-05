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
import { buildMotionGrammarFrameSampler } from "./evaluator";
import {
	PARALLAX_REFERENCE_LAW_ID,
	type ParallaxReferenceInput,
	type ParallaxReferenceRole,
} from "./parallax-reference-oracle";
import type { MotionGrammarBinding } from "./types";

export const PARALLAX_CANDIDATE_SURFACE =
	"shared-presentation-parallax-wave" as const;

export type ParallaxCandidateInput = {
	readonly source: ParallaxReferenceInput;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly bindings: readonly MotionGrammarBinding[];
	readonly binding: MotionGrammarBinding;
	readonly roleMappings: readonly {
		readonly sourceTargetId: string;
		readonly candidateNodeId: string;
	}[];
	readonly artboardId?: string | null;
};
export type ParallaxCandidateSample = {
	readonly targetId: string;
	readonly role: ParallaxReferenceRole;
	readonly candidateFrame: number;
	readonly nodeId: string;
	readonly position: { readonly x: number; readonly y: number };
};
export type ParallaxCandidateResult =
	| { readonly status: "blocked"; readonly reason: string }
	| {
			readonly status: "incompatible" | "ready";
			readonly surface: typeof PARALLAX_CANDIDATE_SURFACE;
			readonly lawId: typeof PARALLAX_REFERENCE_LAW_ID;
			readonly artboardId: string;
			readonly roleMap: Readonly<Record<string, string>>;
			readonly authoring: {
				readonly descriptor: ReturnType<
					typeof describeMotionGrammarAuthoringProfile
				>;
				readonly exposedParameterKeys: readonly string[];
				readonly unavailableSourceSemanticKeys: readonly string[];
			};
			readonly incompatibilities: readonly string[];
			readonly samples: readonly ParallaxCandidateSample[];
	  };

const blocked = (reason: string): ParallaxCandidateResult => ({
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

export function sampleParallaxPresentationCandidate(
	input: ParallaxCandidateInput,
	sourceFrame: number,
): ParallaxCandidateResult {
	if (!Number.isFinite(sourceFrame))
		return blocked("Parallax candidate frame must be finite.");
	if (input.bindings.length !== 1 || input.bindings[0] !== input.binding)
		return blocked(
			"Parallax comparison requires exactly one matching binding.",
		);
	if (input.binding.techniqueId !== "size-speed-parallax")
		return blocked(
			"Parallax candidate must use the size-speed-parallax technique.",
		);
	const sourceIds = new Set(
		input.source.targets.map((target) => target.targetId),
	);
	if (
		input.roleMappings.length !== sourceIds.size ||
		input.roleMappings.some(
			(mapping) => !sourceIds.has(mapping.sourceTargetId),
		) ||
		new Set(input.roleMappings.map((mapping) => mapping.candidateNodeId))
			.size !== input.roleMappings.length ||
		input.roleMappings.some(
			(mapping) => !input.binding.targetIds.includes(mapping.candidateNodeId),
		)
	) {
		return blocked(
			"Parallax role mapping must cover source and binding targets one-to-one.",
		);
	}
	const first = input.roleMappings[0];
	const firstNode = first ? findNode(input.scene, first.candidateNodeId) : null;
	const artboardId = firstNode
		? selectArtboardIdForNode(input.scene, firstNode.id)
		: null;
	if (!artboardId)
		return blocked("Parallax candidate nodes must resolve to one artboard.");
	if (
		input.artboardId !== undefined &&
		input.artboardId !== null &&
		input.artboardId !== artboardId
	)
		return blocked(
			"Parallax candidate artboard does not match the mapped target artboard.",
		);
	const artboard = (input.scene.artboards ?? [input.scene.artboard]).find(
		(candidate) => candidate.id === artboardId,
	);
	if (artboard?.cameraSpacePolicy !== "screen_2d")
		return blocked(
			"Parallax comparison requires an explicit screen_2d camera-space policy.",
		);
	const parameterKeys = [
		"periodFrames",
		"descentFraction",
		"axisDegrees",
		"phaseOffsetFrames",
		"nearAmplitude",
		"midAmplitude",
		"farAmplitude",
	] as const;
	const parameters = Object.fromEntries(
		parameterKeys.map((key) => [
			key,
			finiteParameter(input.binding.parameters, key),
		]),
	);
	if (Object.values(parameters).some((value) => value === null))
		return blocked(
			"Parallax candidate requires all registered profile parameters.",
		);
	const descriptor = describeMotionGrammarAuthoringProfile(input.binding);
	const authoring = {
		descriptor,
		exposedParameterKeys: Object.keys(input.binding.parameters).sort(),
		unavailableSourceSemanticKeys: descriptor
			? []
			: ["shared-wave", "role-amplitude", "screen-2d-policy"],
	};
	const incompatibilities = parameterKeys.flatMap((key) =>
		parameters[key] !== input.source[key]
			? [`${key}: expected ${input.source[key]}, got ${parameters[key]}`]
			: [],
	);
	const clip = input.motion.clips.find(
		(candidate) => candidate.provenance?.bindingId === input.binding.id,
	);
	const startFrame = Math.max(0, clip?.startFrame ?? 0);
	const frame =
		startFrame +
		(((sourceFrame % input.source.periodFrames) + input.source.periodFrames) %
			input.source.periodFrames);
	if (frame > input.motion.durationFrames)
		return blocked("Parallax candidate frame lies outside Motion duration.");
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
			"Parallax candidate has no shared grammar presentation sampler.",
		);
	const presentation = sampleMotionPresentationFrame({
		scene: input.scene,
		motion: input.motion,
		frame,
		artboardId,
		grammar,
	});
	const valuesByNodeId = new Map(
		presentation.values.map((value) => [value.nodeId, value] as const),
	);
	const sourceRoles = new Map(
		input.source.targets.map(
			(target) => [target.targetId, target.role] as const,
		),
	);
	const samples: ParallaxCandidateSample[] = [];
	for (const mapping of input.roleMappings) {
		const node = findNode(input.scene, mapping.candidateNodeId);
		const value = valuesByNodeId.get(mapping.candidateNodeId);
		const role = sourceRoles.get(mapping.sourceTargetId);
		if (!node || !value || !role)
			return blocked("Parallax shared presentation omitted a mapped target.");
		if (
			![value.transform.position.x, value.transform.position.y].every(
				Number.isFinite,
			)
		)
			return blocked(
				"Parallax shared presentation emitted a non-finite channel.",
			);
		samples.push({
			targetId: mapping.sourceTargetId,
			role,
			candidateFrame: frame,
			nodeId: mapping.candidateNodeId,
			position: value.transform.position,
		});
	}
	return {
		status: incompatibilities.length > 0 ? "incompatible" : "ready",
		surface: PARALLAX_CANDIDATE_SURFACE,
		lawId: PARALLAX_REFERENCE_LAW_ID,
		artboardId,
		roleMap: input.binding.roleMap ?? {},
		authoring,
		incompatibilities,
		samples,
	};
}
