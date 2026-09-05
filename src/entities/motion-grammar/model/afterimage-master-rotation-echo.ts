import { castDraft } from "immer";
import type { CreateAnimationClipInput } from "@/entities/motion/model/commands";
import {
	type MotionTimingTemplateId,
	motionTimingTemplateUnitBezierOf,
} from "@/entities/motion/model/easing";
import type { GrammarDuplicateSample } from "@/entities/motion/model/grammar-bridge";
import type { SceneCommand } from "@/entities/scene/model/command";
import { cloneSceneDocument, createNode } from "@/entities/scene/model/factory";
import { findLayerByNodeId, findNode } from "@/entities/scene/model/selectors";
import type {
	Artboard,
	SceneDocument,
	SceneLayer,
	VectorNode,
} from "@/entities/scene/model/types";
import { type UnitBezier, unitBezierY } from "@/shared/glammer/unit-bezier";
import { createId } from "@/shared/lib/id";
import type {
	MotionGrammarAuthoringParameterGroup,
	MotionGrammarAuthoringParameterRole,
	MotionGrammarAuthoringParameterSpec,
	MotionGrammarAuthoringProfileDescriptor,
} from "./authoring-profile";
import { ANALOG_FILM_LOOK_RECIPE } from "./time-delay-materialization";
import type { MotionGrammarBinding } from "./types";
import {
	MOTION_GRAMMAR_WORKSPACE_ROLE_DATA_KEY,
	type MotionGrammarWorkspaceInstanceNode,
	type MotionGrammarWorkspaceRoleData,
} from "./workspace-instance";

export const GLAMMER_AFTERIMAGE_PROFILE_VERSION = 1 as const;
export const GLAMMER_AFTERIMAGE_PROFILE_KIND =
	"glammer-master-rotation-echo-v1" as const;
export const GLAMMER_AFTERIMAGE_STAGE_BACKGROUND = "#f4f3ef" as const;
export const GLAMMER_AFTERIMAGE_REFERENCE_FRAME = 34 as const;

const AFTERIMAGE_TECHNIQUE_ID = "periodic-afterimage";
const BODY_ROLE_PREFIX = `${AFTERIMAGE_TECHNIQUE_ID}:master-rotation-dot`;
const AFTERIMAGE_EASE_TEMPLATE_ID =
	"loop.echo-sweep" satisfies MotionTimingTemplateId;
const defaultEaseTemplate = motionTimingTemplateUnitBezierOf(
	AFTERIMAGE_EASE_TEMPLATE_ID,
);
const DEFAULT_EASE: UnitBezier = defaultEaseTemplate
	? [
			defaultEaseTemplate.x1,
			defaultEaseTemplate.y1,
			defaultEaseTemplate.x2,
			defaultEaseTemplate.y2,
		]
	: [0.72, 0.02, 0.2, 1];

const REFERENCE_COMP = {
	width: 340,
	height: 240,
} as const;

const GLAMMER_AFTERIMAGE_DEFAULTS = {
	profileVersion: GLAMMER_AFTERIMAGE_PROFILE_VERSION,
	periodFrames: 96,
	sweepFrames: 72,
	copies: 9,
	delayFrames: 3,
	fadePerCopy: 0.73,
	orbitRadius: 72,
	dotRadius: 14.5,
	centerX: REFERENCE_COMP.width / 2,
	centerY: 104,
	restAngleA: 205,
	easeX1: DEFAULT_EASE[0],
	easeY1: DEFAULT_EASE[1],
	easeX2: DEFAULT_EASE[2],
	easeY2: DEFAULT_EASE[3],
	lookGrain: 0.84,
	lookRgbSplit: 0,
	lookContrast: 1.02,
	lookSaturation: 0.92,
} as const satisfies Readonly<Record<string, number>>;

type MasterRotationEchoPoint = {
	readonly x: number;
	readonly y: number;
};

type MasterRotationEchoDotSample = {
	readonly nodeId: string;
	readonly role: string;
	readonly translate: MasterRotationEchoPoint;
	readonly opacity: number;
};

export type AfterimageMasterRotationEchoPlan =
	| {
			readonly status: "blocked";
			readonly reason: string;
	  }
	| {
			readonly status: "ready";
			readonly techniqueId: "periodic-afterimage";
			readonly binding: MotionGrammarBinding;
			readonly layerId?: string;
			readonly artboardId: string;
			readonly stageBackground: string;
			readonly generatedNodes: readonly MotionGrammarWorkspaceInstanceNode[];
			readonly roleMap: Readonly<Record<string, string>>;
			readonly selectedSourceNodeIds: readonly string[];
			readonly nextSelectionNodeIds: readonly string[];
			readonly clip: CreateAnimationClipInput;
	  };

export type ReadyAfterimageMasterRotationEchoPlan = Extract<
	AfterimageMasterRotationEchoPlan,
	{ readonly status: "ready" }
>;

const authoringParameter = ({
	key,
	label,
	defaultValue,
	min,
	max,
	step,
	role,
	advanced,
}: {
	readonly key: string;
	readonly label: string;
	readonly defaultValue: number;
	readonly min: number;
	readonly max: number;
	readonly step: number;
	readonly role: MotionGrammarAuthoringParameterRole;
	readonly advanced?: boolean;
}): MotionGrammarAuthoringParameterSpec => ({
	key,
	label,
	default: defaultValue,
	min,
	max,
	step,
	role,
	...(advanced === undefined ? {} : { advanced }),
});

const AFTERIMAGE_AUTHORING_PARAMETER_GROUPS = [
	{
		id: "timing",
		label: "Timing",
		intent:
			"Controls the one-lap sweep, rest segment, and delayed tail spacing.",
		parameters: [
			authoringParameter({
				key: "periodFrames",
				label: "Loop frames",
				defaultValue: GLAMMER_AFTERIMAGE_DEFAULTS.periodFrames,
				min: 12,
				max: 600,
				step: 1,
				role: "timing",
			}),
			authoringParameter({
				key: "sweepFrames",
				label: "Sweep frames",
				defaultValue: GLAMMER_AFTERIMAGE_DEFAULTS.sweepFrames,
				min: 1,
				max: 600,
				step: 1,
				role: "timing",
			}),
			authoringParameter({
				key: "delayFrames",
				label: "Echo delay",
				defaultValue: GLAMMER_AFTERIMAGE_DEFAULTS.delayFrames,
				min: 0,
				max: 60,
				step: 1,
				role: "timing",
			}),
		],
	},
	{
		id: "tail",
		label: "Tail",
		intent:
			"Controls the number and opacity falloff of presentation echo copies.",
		parameters: [
			authoringParameter({
				key: "copies",
				label: "Tail copies",
				defaultValue: GLAMMER_AFTERIMAGE_DEFAULTS.copies,
				min: 0,
				max: 32,
				step: 1,
				role: "layout",
			}),
			authoringParameter({
				key: "fadePerCopy",
				label: "Fade per copy",
				defaultValue: GLAMMER_AFTERIMAGE_DEFAULTS.fadePerCopy,
				min: 0,
				max: 1,
				step: 0.01,
				role: "look",
			}),
		],
	},
	{
		id: "orbit",
		label: "Orbit",
		intent: "Controls the shared orbit geometry for the two opposing dots.",
		parameters: [
			authoringParameter({
				key: "orbitRadius",
				label: "Orbit radius",
				defaultValue: GLAMMER_AFTERIMAGE_DEFAULTS.orbitRadius,
				min: 1,
				max: 600,
				step: 0.5,
				role: "layout",
			}),
			authoringParameter({
				key: "dotRadius",
				label: "Dot radius",
				defaultValue: GLAMMER_AFTERIMAGE_DEFAULTS.dotRadius,
				min: 1,
				max: 120,
				step: 0.25,
				role: "layout",
			}),
			authoringParameter({
				key: "centerX",
				label: "Center X",
				defaultValue: GLAMMER_AFTERIMAGE_DEFAULTS.centerX,
				min: -1200,
				max: 2400,
				step: 0.5,
				role: "layout",
				advanced: true,
			}),
			authoringParameter({
				key: "centerY",
				label: "Center Y",
				defaultValue: GLAMMER_AFTERIMAGE_DEFAULTS.centerY,
				min: -1200,
				max: 2400,
				step: 0.5,
				role: "layout",
				advanced: true,
			}),
			authoringParameter({
				key: "restAngleA",
				label: "Rest angle",
				defaultValue: GLAMMER_AFTERIMAGE_DEFAULTS.restAngleA,
				min: -720,
				max: 720,
				step: 0.5,
				role: "layout",
				advanced: true,
			}),
		],
	},
	{
		id: "easing",
		label: "Ease",
		intent:
			"Controls the single cubic-bezier rotation profile shared by all echoes.",
		parameters: [
			authoringParameter({
				key: "easeX1",
				label: "Ease x1",
				defaultValue: GLAMMER_AFTERIMAGE_DEFAULTS.easeX1,
				min: 0,
				max: 1,
				step: 0.01,
				role: "motion",
				advanced: true,
			}),
			authoringParameter({
				key: "easeY1",
				label: "Ease y1",
				defaultValue: GLAMMER_AFTERIMAGE_DEFAULTS.easeY1,
				min: -1,
				max: 2,
				step: 0.01,
				role: "motion",
				advanced: true,
			}),
			authoringParameter({
				key: "easeX2",
				label: "Ease x2",
				defaultValue: GLAMMER_AFTERIMAGE_DEFAULTS.easeX2,
				min: 0,
				max: 1,
				step: 0.01,
				role: "motion",
				advanced: true,
			}),
			authoringParameter({
				key: "easeY2",
				label: "Ease y2",
				defaultValue: GLAMMER_AFTERIMAGE_DEFAULTS.easeY2,
				min: -1,
				max: 2,
				step: 0.01,
				role: "motion",
				advanced: true,
			}),
		],
	},
] as const satisfies readonly MotionGrammarAuthoringParameterGroup[];

const boundedParameter = (
	parameters: Readonly<Record<string, number>>,
	key: keyof typeof GLAMMER_AFTERIMAGE_DEFAULTS,
	min: number,
	max: number,
): number => {
	const fallback = GLAMMER_AFTERIMAGE_DEFAULTS[key];
	const value = parameters[key];
	const numeric =
		typeof value === "number" && Number.isFinite(value) ? value : fallback;
	return Math.min(Math.max(numeric, min), max);
};

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

const artboardOriginForReferenceComp = (
	artboard: Artboard,
): { readonly x: number; readonly y: number } => ({
	x: (artboard.width - REFERENCE_COMP.width) / 2,
	y: (artboard.height - REFERENCE_COMP.height) / 2,
});

const afterimageBodyRole = (index: number): string =>
	`${BODY_ROLE_PREFIX}-${index + 1}:source`;

const roleData = ({
	bindingId,
	role,
	roleLabel,
}: {
	readonly bindingId: string;
	readonly role: string;
	readonly roleLabel: string;
}): MotionGrammarWorkspaceRoleData => ({
	kind: "motion-grammar-workspace-role",
	schemaVersion: 1,
	bindingId,
	techniqueId: AFTERIMAGE_TECHNIQUE_ID,
	role,
	roleLabel,
	generated: true,
	replaceable: true,
});

const initialDotPosition = ({
	index,
	origin,
}: {
	readonly index: number;
	readonly origin: { readonly x: number; readonly y: number };
}): MasterRotationEchoPoint => {
	const restAngle =
		GLAMMER_AFTERIMAGE_DEFAULTS.restAngleA + (index === 0 ? 0 : 180);
	const radians = (restAngle / 360) * Math.PI * 2;
	return {
		x:
			origin.x +
			GLAMMER_AFTERIMAGE_DEFAULTS.centerX +
			GLAMMER_AFTERIMAGE_DEFAULTS.orbitRadius * Math.cos(radians),
		y:
			origin.y +
			GLAMMER_AFTERIMAGE_DEFAULTS.centerY +
			GLAMMER_AFTERIMAGE_DEFAULTS.orbitRadius * Math.sin(radians),
	};
};

const createDotNode = ({
	artboard,
	bindingId,
	index,
	origin,
}: {
	readonly artboard: Artboard;
	readonly bindingId: string;
	readonly index: number;
	readonly origin: { readonly x: number; readonly y: number };
}): MotionGrammarWorkspaceInstanceNode => {
	const dotRadius = GLAMMER_AFTERIMAGE_DEFAULTS.dotRadius;
	const role = afterimageBodyRole(index);
	const roleLabel = `Orbit dot ${index + 1}`;
	const node = createNode(
		"ellipse",
		{
			kind: "ellipse",
			bounds: {
				x: -dotRadius,
				y: -dotRadius,
				width: dotRadius * 2,
				height: dotRadius * 2,
			},
		},
		{
			name: `Afterimage orbit dot ${index + 1}`,
			style: {
				fill: "rgb(29 31 35)",
				stroke: "rgb(29 31 35)",
				strokeWidth: 0,
				opacity: 1,
			},
			transform: {
				position: initialDotPosition({ index, origin }),
				scale: { x: 1, y: 1 },
				anchor: { x: 0, y: 0 },
			},
		},
	);
	return {
		node: {
			...node,
			artboardId: artboard.id,
			data: {
				...node.data,
				[MOTION_GRAMMAR_WORKSPACE_ROLE_DATA_KEY]: roleData({
					bindingId,
					role,
					roleLabel,
				}),
			},
		},
		role,
		roleLabel,
	};
};

const nodeOwnedByArtboard = (
	node: VectorNode,
	artboardId: string,
	fallbackArtboardId: string,
): boolean => (node.artboardId ?? fallbackArtboardId) === artboardId;

const afterimageStageArtboard = (artboard: Artboard): Artboard => ({
	...artboard,
	background: GLAMMER_AFTERIMAGE_STAGE_BACKGROUND,
	effectIntent: {
		...artboard.effectIntent,
		visualRecipe: ANALOG_FILM_LOOK_RECIPE,
	},
});

const applyAfterimageStageArtboard = (
	draft: Parameters<SceneCommand["run"]>[0],
	artboardId: string,
): void => {
	if (draft.artboard.id === artboardId) {
		draft.artboard = castDraft(afterimageStageArtboard(draft.artboard));
	}
	if (!draft.artboards) return;
	draft.artboards = castDraft(
		draft.artboards.map((artboard) =>
			artboard.id === artboardId ? afterimageStageArtboard(artboard) : artboard,
		),
	);
};

/** True when a binding is the dedicated Glammer Master Rotation Echo profile. */
export function isGlammerAfterimageMasterRotationEchoBinding(
	binding: MotionGrammarBinding,
): boolean {
	return (
		binding.techniqueId === AFTERIMAGE_TECHNIQUE_ID &&
		binding.parameters.profileVersion === GLAMMER_AFTERIMAGE_PROFILE_VERSION &&
		binding.targetIds.length === 2
	);
}

/** Describes the promoted Afterimage profile as Master Rotation Echo. */
export function describeGlammerAfterimageMasterRotationEchoProfile(
	binding: MotionGrammarBinding,
): MotionGrammarAuthoringProfileDescriptor | undefined {
	if (!isGlammerAfterimageMasterRotationEchoBinding(binding)) return undefined;
	const copies = Math.max(
		0,
		Math.floor(boundedParameter(binding.parameters, "copies", 0, 32)),
	);
	const instances: MotionGrammarAuthoringProfileDescriptor["instances"] =
		binding.targetIds.flatMap(
			(
				nodeId,
				sourceIndex,
			): MotionGrammarAuthoringProfileDescriptor["instances"] => [
				{
					index: sourceIndex,
					slotId: `orbit-dot:${sourceIndex + 1}`,
					reference: { kind: "scene-node", nodeId },
					nodeId,
					role: binding.roleMap?.[nodeId] ?? afterimageBodyRole(sourceIndex),
					roleLabel: `Orbit dot ${sourceIndex + 1}`,
					kind: "source",
					editable: true,
					replaceable: true,
					sourceProfileIndex: sourceIndex,
				},
				...Array.from({ length: copies }, (_, echoIndex) => {
					const copyIndex = echoIndex + 1;
					const artifactId = `${nodeId}::grammar:${binding.id}:master-rotation-echo:${copyIndex}`;
					return {
						index: sourceIndex * copies + echoIndex,
						slotId: `orbit-dot:${sourceIndex + 1}:echo:${copyIndex}`,
						reference: {
							kind: "presentation-artifact" as const,
							artifactId,
							sourceNodeId: nodeId,
							lifecycle: "runtime-evaluated" as const,
						},
						nodeId: artifactId,
						role: `${AFTERIMAGE_TECHNIQUE_ID}:master-rotation-echo:${copyIndex}`,
						roleLabel: `Dot ${sourceIndex + 1} tail ${copyIndex}`,
						kind: "artifact" as const,
						editable: false,
						replaceable: false,
						sourceProfileIndex: sourceIndex,
						delayFrames:
							boundedParameter(binding.parameters, "delayFrames", 0, 60) *
							copyIndex,
					};
				}),
			],
		);
	return {
		bindingId: binding.id,
		techniqueId: AFTERIMAGE_TECHNIQUE_ID,
		label: "Afterimage",
		summary:
			"Two opposing dots replay one master rotation profile through delayed presentation echo tails.",
		kind: "presentation-duplicates",
		timeline: {
			mode: "presentation-only",
			bakePolicy: "explicit-command",
			clipLabel: "Afterimage",
			durationParameterKey: "periodFrames",
		},
		expansion: {
			mode: "specialized-artifacts",
			label: "Editable echo output",
			actionLabel: "Create editable echoes",
			previewLabel: "Preview echo output",
			description:
				"Creates editable motion artifacts from the Master Rotation Echo profile instead of leaving the tail as runtime-only presentation draws.",
			outputSummary:
				"Orbit source dots stay editable scene objects; delayed echo tails become explicit editable artifacts/tracks.",
		},
		parameterGroups: AFTERIMAGE_AUTHORING_PARAMETER_GROUPS,
		instances,
		roleSlots: instances,
		timingTemplates: [
			{
				templateId: AFTERIMAGE_EASE_TEMPLATE_ID,
				role: "Master sweep",
				note: "Drives the shared rotation curve that every delayed echo replays.",
				parameterKeys: ["easeX1", "easeY1", "easeX2", "easeY2"],
			},
			{
				templateId: "loop.phase-continuity",
				role: "Loop seam",
				note: "The period and sweep frame controls keep the echo phrase continuous across the loop.",
				parameterKeys: ["periodFrames", "sweepFrames"],
			},
		],
		recipeRoles: ["orbit-dot", "tail-copy"],
	};
}

/** Plans a complete Glammer Master Rotation Echo authoring system. */
export function createAfterimageMasterRotationEchoPlan({
	scene,
	selectedNodeIds,
	bindingId = createId("motion-binding"),
}: {
	readonly scene: SceneDocument;
	readonly selectedNodeIds: readonly string[];
	readonly bindingId?: string;
}): AfterimageMasterRotationEchoPlan {
	if (scene.layers.length === 0) {
		return {
			status: "blocked",
			reason: "Scene has no editable layer for the Afterimage system.",
		};
	}
	const selectedSourceNodeIds = existingSelection(scene, selectedNodeIds).slice(
		0,
		2,
	);
	const layer = editableLayer(scene, selectedSourceNodeIds);
	if (!layer) {
		return {
			status: "blocked",
			reason: "No visible unlocked layer can receive the Afterimage system.",
		};
	}
	const artboard = currentArtboard(scene);
	const origin = artboardOriginForReferenceComp(artboard);
	const generatedNodes = Array.from({ length: 2 }, (_, index) =>
		createDotNode({ artboard, bindingId, index, origin }),
	);
	const targetIds = generatedNodes.map((item) => item.node.id);
	const roleMap: Record<string, string> = {};
	for (const item of generatedNodes) roleMap[item.node.id] = item.role;
	const binding: MotionGrammarBinding = {
		id: bindingId,
		techniqueId: AFTERIMAGE_TECHNIQUE_ID,
		targetIds,
		roleMap,
		parameters: {
			...GLAMMER_AFTERIMAGE_DEFAULTS,
			referenceOriginX: origin.x,
			referenceOriginY: origin.y,
		},
		effectBinding: { kind: "none" },
	};
	return {
		status: "ready",
		techniqueId: AFTERIMAGE_TECHNIQUE_ID,
		binding,
		layerId: layer.id,
		artboardId: artboard.id,
		stageBackground: GLAMMER_AFTERIMAGE_STAGE_BACKGROUND,
		generatedNodes,
		roleMap,
		selectedSourceNodeIds,
		nextSelectionNodeIds: targetIds,
		clip: {
			id: createId("clip"),
			name: "Afterimage",
			startFrame: 0,
			durationFrames: GLAMMER_AFTERIMAGE_DEFAULTS.periodFrames,
			trackIds: [],
			provenance: {
				source: "motion-grammar",
				label: "Glammer Master Rotation Echo authoring preset",
				bindingId,
				techniqueId: AFTERIMAGE_TECHNIQUE_ID,
				techniqueLabel: "Afterimage",
				targetIds,
				generatedNodeIds: targetIds,
				editableArtifacts: [
					{
						id: `${bindingId}:master-rotation-echo-tail`,
						kind: "afterimage-master-rotation-echo-tail",
						targetIds,
						channels: ["presentation:master-rotation-echo"],
						description:
							"Nine delayed presentation echo copies per opposing orbit dot.",
					},
				],
			},
		},
	};
}

/** Replaces the current artboard content with the reference Afterimage system. */
export function createApplyAfterimageMasterRotationEchoSceneCommand(
	plan: ReadyAfterimageMasterRotationEchoPlan,
	options: {
		readonly label?: string;
		readonly coalesceKey?: string;
	} = {},
): SceneCommand {
	const generatedNodes = plan.generatedNodes.map(({ node }) =>
		cloneSceneDocument(node),
	);
	return {
		type: "motion-grammar/apply-afterimage-master-rotation-echo-scene",
		label: options.label ?? "Create Afterimage scene",
		coalesceKey:
			options.coalesceKey ??
			`motion-grammar:afterimage-master-rotation-echo-scene:${plan.binding.id}`,
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

			applyAfterimageStageArtboard(draft, plan.artboardId);
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

const parameter = (
	parameters: Readonly<Record<string, number>>,
	key: keyof typeof GLAMMER_AFTERIMAGE_DEFAULTS,
): number => {
	const value = parameters[key];
	return typeof value === "number" && Number.isFinite(value)
		? value
		: GLAMMER_AFTERIMAGE_DEFAULTS[key];
};

const bindingNumber = (
	parameters: Readonly<Record<string, number>>,
	key: string,
	fallback: number,
): number => {
	const value = parameters[key];
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

const easeFor = (parameters: Readonly<Record<string, number>>): UnitBezier => [
	Math.min(Math.max(parameter(parameters, "easeX1"), 0), 1),
	parameter(parameters, "easeY1"),
	Math.min(Math.max(parameter(parameters, "easeX2"), 0), 1),
	parameter(parameters, "easeY2"),
];

const dotRestPosition = (
	binding: MotionGrammarBinding,
	index: number,
): MasterRotationEchoPoint => {
	const origin = {
		x: bindingNumber(binding.parameters, "referenceOriginX", 0),
		y: bindingNumber(binding.parameters, "referenceOriginY", 0),
	};
	const angle =
		parameter(binding.parameters, "restAngleA") + (index === 0 ? 0 : 180);
	const theta = (angle / 360) * Math.PI * 2;
	return {
		x:
			origin.x +
			parameter(binding.parameters, "centerX") +
			parameter(binding.parameters, "orbitRadius") * Math.cos(theta),
		y:
			origin.y +
			parameter(binding.parameters, "centerY") +
			parameter(binding.parameters, "orbitRadius") * Math.sin(theta),
	};
};

const dotPositionAt = (
	binding: MotionGrammarBinding,
	index: number,
	frame: number,
): MasterRotationEchoPoint => {
	const origin = {
		x: bindingNumber(binding.parameters, "referenceOriginX", 0),
		y: bindingNumber(binding.parameters, "referenceOriginY", 0),
	};
	const sweepFrames = Math.max(1, parameter(binding.parameters, "sweepFrames"));
	const t = Math.min(Math.max(frame / sweepFrames, 0), 1);
	const [x1, y1, x2, y2] = easeFor(binding.parameters);
	const eased = unitBezierY(x1, y1, x2, y2, t);
	const restAngle =
		parameter(binding.parameters, "restAngleA") + (index === 0 ? 0 : 180);
	const theta = ((restAngle + 360 * eased) / 360) * Math.PI * 2;
	return {
		x:
			origin.x +
			parameter(binding.parameters, "centerX") +
			parameter(binding.parameters, "orbitRadius") * Math.cos(theta),
		y:
			origin.y +
			parameter(binding.parameters, "centerY") +
			parameter(binding.parameters, "orbitRadius") * Math.sin(theta),
	};
};

const translateFromRest = (
	rest: MasterRotationEchoPoint,
	current: MasterRotationEchoPoint,
): MasterRotationEchoPoint => ({
	x: current.x - rest.x,
	y: current.y - rest.y,
});

/** Samples real source-dot poses for the current frame. */
export function sampleGlammerAfterimageMasterRotationEchoSources(
	binding: MotionGrammarBinding,
	frame: number,
): readonly MasterRotationEchoDotSample[] {
	if (!isGlammerAfterimageMasterRotationEchoBinding(binding)) return [];
	return binding.targetIds.map((nodeId, index) => {
		const rest = dotRestPosition(binding, index);
		const current = dotPositionAt(binding, index, frame);
		return {
			nodeId,
			role: binding.roleMap?.[nodeId] ?? afterimageBodyRole(index),
			translate: translateFromRest(rest, current),
			opacity: 1,
		};
	});
}

/** Samples delayed presentation echo copies for the Master Rotation Echo tail. */
export function sampleGlammerAfterimageMasterRotationEchoDuplicates(
	binding: MotionGrammarBinding,
	frame: number,
): readonly GrammarDuplicateSample[] {
	if (!isGlammerAfterimageMasterRotationEchoBinding(binding)) return [];
	const sweepFrames = Math.max(1, parameter(binding.parameters, "sweepFrames"));
	if (frame >= sweepFrames) return [];
	const copies = Math.max(
		0,
		Math.min(32, Math.floor(parameter(binding.parameters, "copies"))),
	);
	const delayFrames = Math.max(0, parameter(binding.parameters, "delayFrames"));
	const fadePerCopy = Math.min(
		Math.max(parameter(binding.parameters, "fadePerCopy"), 0),
		1,
	);
	return binding.targetIds.flatMap((nodeId, sourceIndex) => {
		const rest = dotRestPosition(binding, sourceIndex);
		const samples: GrammarDuplicateSample[] = [];
		for (let echoIndex = 0; echoIndex < copies; echoIndex += 1) {
			const copy = echoIndex + 1;
			const pastFrame = frame - copy * delayFrames;
			if (pastFrame < 0) continue;
			const current = dotPositionAt(binding, sourceIndex, pastFrame);
			samples.push({
				sourceNodeId: nodeId,
				duplicateNodeId: `${nodeId}::grammar:${binding.id}:master-rotation-echo:${copy}`,
				sourceFrame: Math.max(0, pastFrame),
				opacityFactor: fadePerCopy ** copy,
				translate: translateFromRest(rest, current),
			});
		}
		return samples;
	});
}
