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
	MERGE_SPLIT_REFERENCE_LAW_ID,
	type MergeSplitReferenceInput,
	type MergeSplitReferenceRole,
} from "./merge-split-reference-oracle";
import type { MotionGrammarBinding } from "./types";

export const MERGE_SPLIT_CANDIDATE_SURFACE =
	"shared-presentation-merge-split" as const;

export type MergeSplitCandidateInput = {
	readonly source: MergeSplitReferenceInput;
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

export type MergeSplitCandidateSample = {
	readonly targetId: string;
	readonly role: MergeSplitReferenceRole;
	readonly candidateFrame: number;
	readonly nodeId: string;
	readonly position: { readonly x: number; readonly y: number };
	readonly scale: number;
	readonly opacity: number;
};

export type MergeSplitCandidateResult =
	| { readonly status: "blocked"; readonly reason: string }
	| {
			readonly status: "incompatible" | "ready";
			readonly surface: typeof MERGE_SPLIT_CANDIDATE_SURFACE;
			readonly artboardId: string | null;
			readonly lawId: typeof MERGE_SPLIT_REFERENCE_LAW_ID;
			readonly roleMap: Readonly<Record<string, string>>;
			readonly authoring: {
				readonly descriptor: ReturnType<
					typeof describeMotionGrammarAuthoringProfile
				>;
				readonly exposedParameterKeys: readonly string[];
				readonly unavailableSourceSemanticKeys: readonly string[];
			};
			readonly incompatibilities: readonly string[];
			readonly samples: readonly MergeSplitCandidateSample[];
	  };

const blocked = (reason: string): MergeSplitCandidateResult => ({
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
	return {
		startFrame: Math.max(0, clip?.startFrame ?? 0),
		durationFrames: Math.max(1, clip?.durationFrames ?? periodFrames),
	};
};

export function sampleMergeSplitPresentationCandidate(
	input: MergeSplitCandidateInput,
	sourceFrame: number,
): MergeSplitCandidateResult {
	if (!Number.isFinite(sourceFrame))
		return blocked("Merge / Split candidate frame must be finite.");
	if (input.bindings.length !== 1 || input.bindings[0] !== input.binding) {
		return blocked(
			"Merge / Split comparison requires exactly one matching binding.",
		);
	}
	if (input.binding.techniqueId !== "merge-split-cycle") {
		return blocked(
			"Merge / Split candidate must use the merge-split-cycle technique.",
		);
	}
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
			"Merge / Split role mapping must cover source and binding targets one-to-one.",
		);
	}
	const first = input.roleMappings[0];
	const firstNode = first ? findNode(input.scene, first.candidateNodeId) : null;
	const artboardId = firstNode
		? selectArtboardIdForNode(input.scene, firstNode.id)
		: null;
	if (!artboardId)
		return blocked(
			"Merge / Split candidate nodes must resolve to one artboard.",
		);
	if (
		input.artboardId !== undefined &&
		input.artboardId !== null &&
		input.artboardId !== artboardId
	) {
		return blocked(
			"Merge / Split candidate artboard does not match the mapped target artboard.",
		);
	}
	const artboard = (input.scene.artboards ?? [input.scene.artboard]).find(
		(candidate) => candidate.id === artboardId,
	);
	if (artboard?.cameraSpacePolicy !== "screen_2d") {
		return blocked(
			"Merge / Split comparison requires an explicit screen_2d camera-space policy.",
		);
	}
	const parameterKeys = [
		"periodFrames",
		"strength",
		"scaleFloor",
		"opacityFloor",
		"gatherFraction",
		"holdFraction",
		"returnFraction",
		"staggerFrames",
		"ringTurnDegrees",
		"returnOvershoot",
		"coreScaleGain",
	] as const;
	const parameters = Object.fromEntries(
		parameterKeys.map((key) => [
			key,
			finiteParameter(input.binding.parameters, key),
		]),
	);
	if (Object.values(parameters).some((value) => value === null)) {
		return blocked(
			"Merge / Split candidate requires all registered profile parameters.",
		);
	}
	const descriptor = describeMotionGrammarAuthoringProfile(input.binding);
	const authoring = {
		descriptor,
		exposedParameterKeys: Object.keys(input.binding.parameters).sort(),
		unavailableSourceSemanticKeys: descriptor
			? []
			: ["delayed-clip", "rotating-seats", "derived-core-area"],
	};
	const incompatibilities = parameterKeys.flatMap((key) =>
		parameters[key] !== input.source[key]
			? [`${key}: expected ${input.source[key]}, got ${parameters[key]}`]
			: [],
	);
	const clip = clipFor(
		input.motion,
		input.binding.id,
		input.source.periodFrames,
	);
	const localFrame =
		((sourceFrame % input.source.periodFrames) + input.source.periodFrames) %
		input.source.periodFrames;
	const frame = clip.startFrame + localFrame;
	if (frame > input.motion.durationFrames)
		return blocked(
			"Merge / Split candidate frame lies outside Motion duration.",
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
			"Merge / Split candidate has no shared grammar presentation sampler.",
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
	const samples: MergeSplitCandidateSample[] = [];
	for (const mapping of input.roleMappings) {
		const node = findNode(input.scene, mapping.candidateNodeId);
		const value = valuesByNodeId.get(mapping.candidateNodeId);
		const role = sourceRoles.get(mapping.sourceTargetId);
		if (!node || !value || !role)
			return blocked(
				"Merge / Split shared presentation omitted a mapped target.",
			);
		const scaleX = value.transform.scale.x / node.transform.scale.x;
		const scaleY = value.transform.scale.y / node.transform.scale.y;
		const opacity = value.opacity / node.style.opacity;
		if (
			![
				value.transform.position.x,
				value.transform.position.y,
				scaleX,
				scaleY,
				opacity,
			].every(Number.isFinite)
		) {
			return blocked(
				"Merge / Split shared presentation emitted a non-finite channel.",
			);
		}
		samples.push({
			targetId: mapping.sourceTargetId,
			role,
			candidateFrame: frame,
			nodeId: mapping.candidateNodeId,
			position: value.transform.position,
			scale: (scaleX + scaleY) / 2,
			opacity,
		});
	}
	return {
		status: incompatibilities.length > 0 ? "incompatible" : "ready",
		surface: MERGE_SPLIT_CANDIDATE_SURFACE,
		artboardId,
		lawId: MERGE_SPLIT_REFERENCE_LAW_ID,
		roleMap: input.binding.roleMap ?? {},
		authoring,
		incompatibilities,
		samples,
	};
}
