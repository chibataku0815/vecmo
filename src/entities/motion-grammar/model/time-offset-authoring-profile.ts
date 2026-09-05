import { castDraft } from "immer";
import type { MotionCommand } from "@/entities/motion/model/command";
import type { MotionTimingTemplateId } from "@/entities/motion/model/easing";
import type {
	AnimationClip,
	KeyframeTrack,
} from "@/entities/motion/model/types";
import type { SceneCommand } from "@/entities/scene/model/command";
import { cloneSceneDocument, createNode } from "@/entities/scene/model/factory";
import { findLayerByNodeId, findNode } from "@/entities/scene/model/selectors";
import type {
	Artboard,
	SceneDocument,
	SceneLayer,
	VectorNode,
} from "@/entities/scene/model/types";
import { createId } from "@/shared/lib/id";
import {
	legacyRgbSplitToCanonical,
	normalizeVisualRecipe,
} from "@/shared/vec-core";
import type {
	MotionGrammarAuthoringParameterGroup,
	MotionGrammarAuthoringParameterRole,
	MotionGrammarAuthoringParameterSpec,
	MotionGrammarAuthoringProfileDescriptor,
} from "./authoring-profile";
import { findCatalogEntry } from "./catalog";
import {
	ANALOG_FILM_LOOK_RECIPE,
	GLAMMER_TIME_DELAY_STAGE_BACKGROUND,
} from "./time-delay-materialization";
import type { MotionGrammarBinding, MotionGrammarParamSpec } from "./types";
import {
	MOTION_GRAMMAR_WORKSPACE_ROLE_DATA_KEY,
	type MotionGrammarWorkspaceInstanceNode,
	type MotionGrammarWorkspaceRoleData,
	motionGrammarWorkspaceRoleLabel,
} from "./workspace-instance";

const TIME_OFFSET_TECHNIQUE_ID = "time-offset-propagation";
const TIME_OFFSET_CLIP_LABEL = "Offset stagger conveyor";
const TIME_OFFSET_REFERENCE_FRAME = 0;
export const GLAMMER_OFFSET_STAGGER_CONVEYOR_PROFILE_VERSION = 1;
const GLAMMER_OFFSET_SLOT_COUNT = 5;
export const GLAMMER_OFFSET_STAGGER_CONVEYOR_SLOT_VALUES = [
	0, 0.72, 1.22, 0.72, 0,
] as const;
/** Semantic v2 reproduces the public conveyor law's explicit source contract. */
export const GLAMMER_OFFSET_SEMANTIC_VERSION = 2 as const;
export const GLAMMER_OFFSET_SOURCE_SUBCYCLE_FRAMES = 30 as const;
export const GLAMMER_OFFSET_SOURCE_ACTIVE_FRAMES = 18 as const;
export const GLAMMER_OFFSET_SOURCE_SPACING = 62 as const;
export const GLAMMER_OFFSET_SOURCE_OVERRIDE_SLOT = 3 as const;
export const GLAMMER_OFFSET_SOURCE_OVERRIDE_DUP = 1 as const;
export const GLAMMER_OFFSET_SOURCE_OVERRIDE_VALUE = 18.5 as const;
export const GLAMMER_OFFSET_SOURCE_VALUE_SCALE = 1 as const;
export const GLAMMER_OFFSET_SOURCE_RADIUS_ANCHOR = 52 as const;
export const GLAMMER_OFFSET_SOURCE_VISIBILITY_CUTOFF = 0.01 as const;
export const GLAMMER_OFFSET_SOURCE_EASING = [0.58, 0.057, 0.415, 0.93] as const;
export const GLAMMER_OFFSET_SOURCE_SLOT_VALUES = [
	0, 15.9, 28.85, 15.9, 0,
] as const;
const GLAMMER_OFFSET_STAGE_BACKGROUND = GLAMMER_TIME_DELAY_STAGE_BACKGROUND;
const GLAMMER_OFFSET_BODY_FILL = "rgb(29 31 35)";
const GLAMMER_OFFSET_BODY_RADIUS = 52;
const GLAMMER_OFFSET_PROFILE_KIND = "glammer-offset-stagger-conveyor-v1";
const GLAMMER_OFFSET_FOLLOW_TEMPLATE_ID =
	"follow.stagger-inherit" satisfies MotionTimingTemplateId;

type TimeOffsetParameterGroupDefinition = {
	readonly id: string;
	readonly label: string;
	readonly intent: string;
	readonly parameters: readonly {
		readonly key: string;
		readonly role: MotionGrammarAuthoringParameterRole;
		readonly advanced?: boolean;
	}[];
};

export type TimeOffsetPropagationPlan =
	| {
			readonly status: "blocked";
			readonly reason: string;
	  }
	| {
			readonly status: "ready";
			readonly techniqueId: "time-offset-propagation";
			readonly binding: MotionGrammarBinding;
			readonly layerId?: string;
			readonly artboardId: string;
			readonly stageBackground: string;
			readonly generatedNodes: readonly MotionGrammarWorkspaceInstanceNode[];
			readonly roleMap: Readonly<Record<string, string>>;
			readonly selectedSourceNodeIds: readonly string[];
			readonly nextSelectionNodeIds: readonly string[];
			readonly tracks: readonly KeyframeTrack<number>[];
			readonly clip: AnimationClip;
	  };

export type ReadyTimeOffsetPropagationPlan = Extract<
	TimeOffsetPropagationPlan,
	{ readonly status: "ready" }
>;

export { TIME_OFFSET_REFERENCE_FRAME };

const TIME_OFFSET_LEGACY_PARAMETER_GROUPS: readonly TimeOffsetParameterGroupDefinition[] =
	[
		{
			id: "timing",
			label: "Timing",
			intent:
				"Controls the legacy source motion loop and per-follower time offset.",
			parameters: [
				{ key: "periodFrames", role: "timing" },
				{ key: "staggerFrames", role: "timing" },
			],
		},
	] as const;

const TIME_OFFSET_SOURCE_PARAMETER_GROUPS: readonly TimeOffsetParameterGroupDefinition[] =
	[
		{
			id: "timing",
			label: "Timing",
			intent:
				"Controls the closed conveyor loop, active interpolation window, and source cubic-Bezier timing.",
			parameters: [
				{ key: "periodFrames", role: "timing" },
				{ key: "subcycleFrames", role: "timing" },
				{ key: "activeFrames", role: "timing" },
				{ key: "easingP1X", role: "timing", advanced: true },
				{ key: "easingP1Y", role: "timing", advanced: true },
				{ key: "easingP2X", role: "timing", advanced: true },
				{ key: "easingP2Y", role: "timing", advanced: true },
			],
		},
		{
			id: "layout",
			label: "Conveyor Layout",
			intent:
				"Controls the ordered slot spacing, source-unit calibration, and duplicate override without changing role identity.",
			parameters: [
				{ key: "spacing", role: "layout" },
				{ key: "sourceCoordinateScale", role: "layout", advanced: true },
				{ key: "sourceValueScale", role: "layout", advanced: true },
				{ key: "radiusAnchorSceneUnits", role: "layout", advanced: true },
				{ key: "slotValue1", role: "layout" },
				{ key: "slotValue2", role: "layout" },
				{ key: "slotValue3", role: "layout" },
				{ key: "slotValue4", role: "layout" },
				{ key: "slotValue5", role: "layout" },
				{ key: "overrideSlot", role: "layout", advanced: true },
				{ key: "overrideDup", role: "layout", advanced: true },
				{ key: "overrideValue", role: "layout", advanced: true },
				{
					key: "visibilityCutoffSourceUnits",
					role: "layout",
					advanced: true,
				},
			],
		},
	] as const;

const isDefined = <T>(value: T | undefined): value is T => value !== undefined;

const catalogSpecsByKey = (): ReadonlyMap<string, MotionGrammarParamSpec> => {
	const specs = new Map<string, MotionGrammarParamSpec>();
	for (const spec of findCatalogEntry(TIME_OFFSET_TECHNIQUE_ID)?.params ?? []) {
		specs.set(spec.key, spec);
	}
	return specs;
};

const authoringParameter = ({
	spec,
	role,
	advanced,
}: {
	readonly spec: MotionGrammarParamSpec;
	readonly role: MotionGrammarAuthoringParameterRole;
	readonly advanced?: boolean;
}): MotionGrammarAuthoringParameterSpec => ({
	...spec,
	role,
	...(advanced !== undefined ? { advanced } : {}),
});

const bindingNumber = (
	binding: MotionGrammarBinding,
	key: string,
	fallback: number,
): number => {
	const value = binding.parameters[key];
	return Number.isFinite(value) ? value : fallback;
};

const periodFrames = (binding: MotionGrammarBinding): number =>
	Math.max(1, Math.round(bindingNumber(binding, "periodFrames", 90)));

const currentArtboard = (scene: SceneDocument): Artboard =>
	(scene.artboards ?? [scene.artboard]).find(
		(artboard) => artboard.id === scene.currentArtboardId,
	) ??
	scene.artboards?.[0] ??
	scene.artboard;

const editableLayer = (
	scene: SceneDocument,
	selectedNodeIds: readonly string[],
): SceneLayer | undefined => {
	for (const nodeId of selectedNodeIds) {
		const layer = findLayerByNodeId(scene, nodeId);
		if (layer?.visible && !layer.locked) return layer;
	}
	return [...scene.layers]
		.reverse()
		.find((layer) => layer.visible && !layer.locked);
};

const existingSelection = (
	scene: SceneDocument,
	selectedNodeIds: readonly string[],
): readonly string[] => {
	const seen = new Set<string>();
	const existing: string[] = [];
	for (const nodeId of selectedNodeIds) {
		if (seen.has(nodeId) || !findNode(scene, nodeId)) continue;
		seen.add(nodeId);
		existing.push(nodeId);
	}
	return existing;
};

const nodeOwnedByArtboard = (
	node: VectorNode,
	artboardId: string,
	fallbackArtboardId: string,
): boolean => (node.artboardId ?? fallbackArtboardId) === artboardId;

const timeOffsetStageArtboard = (artboard: Artboard): Artboard => ({
	...artboard,
	background: GLAMMER_OFFSET_STAGE_BACKGROUND,
	effectIntent: {
		...artboard.effectIntent,
		visualRecipe: ANALOG_FILM_LOOK_RECIPE,
	},
});

const applyTimeOffsetStageArtboard = (
	draft: Parameters<SceneCommand["run"]>[0],
	artboardId: string,
): void => {
	if (draft.artboard.id === artboardId) {
		draft.artboard = castDraft(timeOffsetStageArtboard(draft.artboard));
	}
	if (!draft.artboards) return;
	draft.artboards = castDraft(
		draft.artboards.map((artboard) =>
			artboard.id === artboardId ? timeOffsetStageArtboard(artboard) : artboard,
		),
	);
};

const artboardOriginForReferenceComp = (
	artboard: Artboard,
): { readonly x: number; readonly y: number } => ({
	x: artboard.width / 2,
	y: artboard.height / 2 + 12,
});

const timeOffsetSlotRole = (index: number): string =>
	`${TIME_OFFSET_TECHNIQUE_ID}:slot-${index + 1}`;

const timeOffsetSlotRoleLabel = (index: number): string =>
	`offset slot ${index + 1}`;

const timeOffsetSlotValueParameterKey = (index: number): string =>
	`slotValue${index + 1}`;

const timeOffsetSourceSlotValueParameters = (): Record<string, number> =>
	Object.fromEntries(
		GLAMMER_OFFSET_SOURCE_SLOT_VALUES.map((value, index) => [
			timeOffsetSlotValueParameterKey(index),
			value,
		]),
	);

const timeOffsetRoleData = ({
	bindingId,
	index,
}: {
	readonly bindingId: string;
	readonly index: number;
}): MotionGrammarWorkspaceRoleData => ({
	kind: "motion-grammar-workspace-role",
	schemaVersion: 1,
	bindingId,
	techniqueId: TIME_OFFSET_TECHNIQUE_ID,
	role: timeOffsetSlotRole(index),
	roleLabel: timeOffsetSlotRoleLabel(index),
	generated: true,
	replaceable: true,
});

const TIME_OFFSET_BODY_LOOK_RECIPE = normalizeVisualRecipe({
	id: "glammer-offset-stagger-body-look",
	label: "Glammer Offset Stagger Body",
	intent: "motion-graphics",
	texture: { grain: 0.58, noiseScale: 0.82 },
	glow: { bloom: 0, radius: 0 },
	color: {
		exposure: 0,
		contrast: 1.02,
		saturation: 0.94,
		tint: null,
	},
	optics: { chromaticFringing: legacyRgbSplitToCanonical(0.68) },
	metadata: {
		"profile.kind": GLAMMER_OFFSET_PROFILE_KIND,
		"profile.version": GLAMMER_OFFSET_STAGGER_CONVEYOR_PROFILE_VERSION,
	},
});

const createOffsetSlotNode = ({
	artboard,
	bindingId,
	index,
	origin,
	spacing,
}: {
	readonly artboard: Artboard;
	readonly bindingId: string;
	readonly index: number;
	readonly origin: { readonly x: number; readonly y: number };
	readonly spacing: number;
}): MotionGrammarWorkspaceInstanceNode => {
	const radius = GLAMMER_OFFSET_BODY_RADIUS;
	const role = timeOffsetSlotRole(index);
	const roleLabel = timeOffsetSlotRoleLabel(index);
	const centerOffset = index - (GLAMMER_OFFSET_SLOT_COUNT - 1) / 2;
	const node = createNode(
		"ellipse",
		{
			kind: "ellipse",
			bounds: {
				x: -radius,
				y: -radius,
				width: radius * 2,
				height: radius * 2,
			},
		},
		{
			name: `Time Offset body ${index + 1}`,
			style: {
				fill: GLAMMER_OFFSET_BODY_FILL,
				stroke: GLAMMER_OFFSET_BODY_FILL,
				strokeWidth: 0,
				opacity: 1,
			},
			transform: {
				position: {
					x: origin.x + centerOffset * spacing,
					y: origin.y,
				},
				scale: { x: 1, y: 1 },
				anchor: { x: 0, y: 0 },
			},
		},
	);
	return {
		node: {
			...node,
			artboardId: artboard.id,
			recipe: TIME_OFFSET_BODY_LOOK_RECIPE,
			data: {
				...node.data,
				[MOTION_GRAMMAR_WORKSPACE_ROLE_DATA_KEY]: timeOffsetRoleData({
					bindingId,
					index,
				}),
			},
		},
		role,
		roleLabel,
	};
};

const cloneTrack = (track: KeyframeTrack<number>): KeyframeTrack<number> => ({
	id: track.id,
	target: { ...track.target },
	keyframes: track.keyframes.map((keyframe) => ({
		...keyframe,
		inTemporalEase: keyframe.inTemporalEase?.map((ease) => ({ ...ease })),
		outTemporalEase: keyframe.outTemporalEase?.map((ease) => ({ ...ease })),
	})),
});

const cloneClip = (clip: AnimationClip): AnimationClip => ({
	id: clip.id,
	name: clip.name,
	startFrame: clip.startFrame,
	durationFrames: clip.durationFrames,
	trackIds: [...clip.trackIds],
	...(clip.provenance
		? {
				provenance: {
					...clip.provenance,
					targetIds: [...clip.provenance.targetIds],
					generatedNodeIds: [...clip.provenance.generatedNodeIds],
					...(clip.provenance.editableArtifacts
						? {
								editableArtifacts: clip.provenance.editableArtifacts.map(
									(artifact) => ({
										...artifact,
										targetIds: [...artifact.targetIds],
										channels: [...artifact.channels],
									}),
								),
							}
						: {}),
				},
			}
		: {}),
});

const roleForIndex = (
	binding: MotionGrammarBinding,
	nodeId: string,
	index: number,
): string =>
	binding.roleMap?.[nodeId] ?? `${TIME_OFFSET_TECHNIQUE_ID}:slot-${index + 1}`;

/**
 * Describes Glammer's Offset/Stagger conveyor: five conceptual circle slots read
 * one sliding move with staggered copy offsets. The reference frame visibly shows
 * the three non-zero slot keys, while the endpoint slots remain part of the
 * expression so the conveyor can slide in and out without baking tracks.
 */
export function describeTimeOffsetPropagationAuthoringProfile(
	binding: MotionGrammarBinding,
): MotionGrammarAuthoringProfileDescriptor | undefined {
	if (binding.techniqueId !== TIME_OFFSET_TECHNIQUE_ID) return undefined;
	const specs = catalogSpecsByKey();
	const semanticVersion = Math.round(
		bindingNumber(binding, "semanticVersion", 1),
	);
	const parameterGroups =
		semanticVersion >= GLAMMER_OFFSET_SEMANTIC_VERSION
			? TIME_OFFSET_SOURCE_PARAMETER_GROUPS
			: TIME_OFFSET_LEGACY_PARAMETER_GROUPS;
	const stagger = bindingNumber(binding, "staggerFrames", 4);
	const instances: MotionGrammarAuthoringProfileDescriptor["instances"] =
		binding.targetIds.map((nodeId, index) => {
			const role = roleForIndex(binding, nodeId, index);
			return {
				index,
				slotId: `slot:${index + 1}`,
				reference: { kind: "scene-node", nodeId },
				nodeId,
				role,
				roleLabel: motionGrammarWorkspaceRoleLabel(
					TIME_OFFSET_TECHNIQUE_ID,
					role,
				),
				kind: "body",
				editable: true,
				replaceable: true,
				sourceProfileIndex: index,
				delayFrames: index * stagger,
			};
		});
	return {
		bindingId: binding.id,
		techniqueId: TIME_OFFSET_TECHNIQUE_ID,
		label: "Offset",
		summary:
			"Five slot values slide left while the reference frame shows the three visible dots: small, large, small.",
		kind: "master-instances",
		timeline: {
			mode: "trackless-expression",
			bakePolicy: "explicit-command",
			clipLabel: TIME_OFFSET_CLIP_LABEL,
			durationParameterKey: "periodFrames",
		},
		expansion: {
			mode: "editable-motion",
			label: "Editable offset output",
			actionLabel: "Create editable offset",
			previewLabel: "Preview offset output",
			description:
				"Creates editable scalar output from the live Offset conveyor expression when an explicit expansion is needed.",
			outputSummary:
				"The five conceptual slots stay editable scene objects; the reference frame shows the three non-zero dots while one shared expression drives the slide and size wave.",
		},
		parameterGroups: parameterGroups.map((group) => ({
			id: group.id,
			label: group.label,
			intent: group.intent,
			parameters: group.parameters
				.map((parameter) => {
					const spec = specs.get(parameter.key);
					return spec
						? authoringParameter({
								spec,
								role: parameter.role,
								advanced: parameter.advanced,
							})
						: undefined;
				})
				.filter(isDefined),
		})) satisfies readonly MotionGrammarAuthoringParameterGroup[],
		instances,
		roleSlots: instances,
		timingTemplates: [
			{
				templateId: GLAMMER_OFFSET_FOLLOW_TEMPLATE_ID,
				role: "Offset conveyor",
				note:
					semanticVersion >= GLAMMER_OFFSET_SEMANTIC_VERSION
						? "The closed subcycle advances one duplicate address while all slots inherit the same cubic-Bezier sliding profile."
						: "The stagger parameter delays each slot while every body inherits the same sliding profile.",
				parameterKeys:
					semanticVersion >= GLAMMER_OFFSET_SEMANTIC_VERSION
						? ["periodFrames", "subcycleFrames", "activeFrames"]
						: ["periodFrames", "staggerFrames"],
			},
		],
		recipeRoles: ["slot"],
	};
}

/**
 * Creates a compact Glammer Offset conveyor: five editable scene slots, a
 * reference frame that visibly reads as small-large-small, one trackless
 * expression clip, and a binding that owns the source conveyor's shared
 * progress, duplicate address, and unit calibration.
 */
export function createTimeOffsetPropagationPlan({
	scene,
	selectedNodeIds,
}: {
	readonly scene: SceneDocument;
	readonly selectedNodeIds: readonly string[];
}): TimeOffsetPropagationPlan {
	if (scene.layers.length === 0) {
		return {
			status: "blocked",
			reason: "Scene has no editable layer for the Time Offset system.",
		};
	}
	const selectedSourceNodeIds = existingSelection(scene, selectedNodeIds);
	const layer = editableLayer(scene, selectedSourceNodeIds);
	if (!layer) {
		return {
			status: "blocked",
			reason: "No visible unlocked layer can receive the Time Offset system.",
		};
	}
	const artboard = currentArtboard(scene);
	const bindingId = createId("motion-binding");
	const origin = artboardOriginForReferenceComp(artboard);
	const generatedNodes = Array.from(
		{ length: GLAMMER_OFFSET_SLOT_COUNT },
		(_, index) =>
			createOffsetSlotNode({
				artboard,
				bindingId,
				index,
				origin,
				spacing: GLAMMER_OFFSET_SOURCE_SPACING,
			}),
	);
	const targetIds = generatedNodes.map((generated) => generated.node.id);
	const roleMap: Record<string, string> = {};
	for (const [index, nodeId] of targetIds.entries()) {
		roleMap[nodeId] = timeOffsetSlotRole(index);
	}
	const baseBinding: MotionGrammarBinding = {
		id: bindingId,
		techniqueId: TIME_OFFSET_TECHNIQUE_ID,
		targetIds,
		roleMap,
		parameters: {
			periodFrames: 90,
			staggerFrames: 4,
		},
		effectBinding: { kind: "none" },
	};
	const binding: MotionGrammarBinding = {
		...baseBinding,
		parameters: {
			...baseBinding.parameters,
			semanticVersion: GLAMMER_OFFSET_SEMANTIC_VERSION,
			profileVersion: GLAMMER_OFFSET_STAGGER_CONVEYOR_PROFILE_VERSION,
			periodFrames: periodFrames(baseBinding),
			staggerFrames: bindingNumber(baseBinding, "staggerFrames", 4),
			slotCount: GLAMMER_OFFSET_SLOT_COUNT,
			...timeOffsetSourceSlotValueParameters(),
			subcycleFrames: GLAMMER_OFFSET_SOURCE_SUBCYCLE_FRAMES,
			activeFrames: GLAMMER_OFFSET_SOURCE_ACTIVE_FRAMES,
			spacing: GLAMMER_OFFSET_SOURCE_SPACING,
			sourceCoordinateScale: 1,
			overrideSlot: GLAMMER_OFFSET_SOURCE_OVERRIDE_SLOT,
			overrideDup: GLAMMER_OFFSET_SOURCE_OVERRIDE_DUP,
			overrideValue: GLAMMER_OFFSET_SOURCE_OVERRIDE_VALUE,
			sourceValueScale: GLAMMER_OFFSET_SOURCE_VALUE_SCALE,
			radiusAnchorSceneUnits: GLAMMER_OFFSET_SOURCE_RADIUS_ANCHOR,
			visibilityCutoffSourceUnits: GLAMMER_OFFSET_SOURCE_VISIBILITY_CUTOFF,
			easingP1X: GLAMMER_OFFSET_SOURCE_EASING[0],
			easingP1Y: GLAMMER_OFFSET_SOURCE_EASING[1],
			easingP2X: GLAMMER_OFFSET_SOURCE_EASING[2],
			easingP2Y: GLAMMER_OFFSET_SOURCE_EASING[3],
			referenceOriginX: origin.x,
			referenceOriginY: origin.y,
		},
	};
	const tracks: readonly KeyframeTrack<number>[] = [];
	const clip: AnimationClip = {
		id: createId("clip"),
		name: TIME_OFFSET_CLIP_LABEL,
		startFrame: 0,
		durationFrames: periodFrames(binding),
		trackIds: tracks.map((track) => track.id),
		provenance: {
			source: "motion-grammar",
			label: "Time Offset authoring profile",
			bindingId: binding.id,
			techniqueId: binding.techniqueId,
			techniqueLabel: "Offset",
			targetIds: [...binding.targetIds],
			generatedNodeIds: generatedNodes.map((generated) => generated.node.id),
		},
	};
	return {
		status: "ready",
		techniqueId: TIME_OFFSET_TECHNIQUE_ID,
		binding,
		layerId: layer.id,
		artboardId: artboard.id,
		stageBackground: GLAMMER_OFFSET_STAGE_BACKGROUND,
		generatedNodes,
		roleMap,
		selectedSourceNodeIds,
		nextSelectionNodeIds: targetIds.filter(
			(_, index) =>
				(GLAMMER_OFFSET_SOURCE_SLOT_VALUES[index] ?? 0) >
				GLAMMER_OFFSET_SOURCE_VISIBILITY_CUTOFF,
		),
		tracks,
		clip,
	};
}

/**
 * Replaces the current artboard with the Glammer Time Offset canonical study:
 * five dark editable conveyor slots on the film stage. At the reference frame the
 * endpoint slots evaluate to zero, leaving the Glammer small-large-small shape
 * without unrelated seed artwork.
 */
export function createApplyTimeOffsetPropagationSceneCommand(
	plan: ReadyTimeOffsetPropagationPlan,
	options: {
		readonly label?: string;
		readonly coalesceKey?: string;
	} = {},
): SceneCommand {
	const generatedNodes = plan.generatedNodes.map(({ node }) =>
		cloneSceneDocument(node),
	);
	return {
		type: "motion-grammar/apply-time-offset-propagation-scene",
		label: options.label ?? "Create Time Offset scene",
		coalesceKey:
			options.coalesceKey ??
			`motion-grammar:time-offset-propagation-scene:${plan.binding.id}`,
		run: (draft) => {
			const targetLayer =
				(plan.layerId
					? draft.layers.find((layer) => layer.id === plan.layerId)
					: undefined) ??
				[...draft.layers]
					.reverse()
					.find((layer) => layer.visible && !layer.locked) ??
				draft.layers[draft.layers.length - 1];
			if (!targetLayer) return;

			applyTimeOffsetStageArtboard(draft, plan.artboardId);
			for (const layer of draft.layers) {
				layer.nodes = castDraft(
					layer.nodes.filter(
						(node) =>
							!nodeOwnedByArtboard(node, plan.artboardId, plan.artboardId),
					),
				);
			}
			const existingIds = new Set(
				draft.layers.flatMap((layer) => layer.nodes.map((node) => node.id)),
			);
			for (const node of generatedNodes) {
				if (existingIds.has(node.id)) continue;
				targetLayer.nodes.push(castDraft(cloneSceneDocument(node)));
				existingIds.add(node.id);
			}
		},
	};
}

/** Writes the Offset trackless authoring clip into MotionDocument. */
export function createApplyTimeOffsetPropagationMotionCommand(
	plan: ReadyTimeOffsetPropagationPlan,
	options: {
		readonly label?: string;
		readonly coalesceKey?: string;
	} = {},
): MotionCommand {
	const tracks = plan.tracks.map(cloneTrack);
	const clip = cloneClip(plan.clip);
	return {
		type: "motion-grammar/apply-time-offset-propagation",
		label: options.label ?? "Create Offset motion",
		coalesceKey:
			options.coalesceKey ??
			`motion-grammar:time-offset-propagation:${plan.binding.id}`,
		run: (draft) => {
			for (const track of tracks) {
				const existingIndex = draft.tracks.findIndex(
					(candidate) =>
						candidate.id === track.id ||
						(candidate.target.nodeId === track.target.nodeId &&
							candidate.target.property === track.target.property),
				);
				if (existingIndex >= 0) {
					draft.tracks[existingIndex] = castDraft(cloneTrack(track));
					continue;
				}
				draft.tracks.push(castDraft(cloneTrack(track)));
			}
			const existingClipIndex = draft.clips.findIndex(
				(candidate) => candidate.id === clip.id,
			);
			if (existingClipIndex >= 0) {
				draft.clips[existingClipIndex] = castDraft(cloneClip(clip));
				return;
			}
			draft.clips.push(castDraft(cloneClip(clip)));
		},
	};
}
