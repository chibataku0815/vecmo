/**
 * Inspector editing for the frame/scene vec-core "Look": legacy recipe scalars, the Look
 * graph (materialize/insert/remove/reorder/toggle/number), Analog Film recall, and
 * frame effect influence masks. Object Noise Gradient dissolve editing lives in the
 * sibling {@link file:./noise-gradient-editing.ts} module.
 */
import { useMotionStore } from "@/entities/motion/model/store";
import { ANALOG_FILM_LOOK_RECIPE } from "@/entities/motion-grammar/model/time-delay-materialization";
import type {
	EffectLayer,
	EffectLayerStackOperation,
} from "@/entities/scene/model/effect-layer-stack";
import {
	type LookGraphEdge,
	type LookGraphNode,
	lookGraphNodeLabel,
	lookGraphPortId,
} from "@/entities/scene/model/look-graph";
import {
	createUpdateEffectIntentCommand,
	createUpdateNodeRecipeCommand,
} from "@/entities/scene/model/node-commands";
import { resolveFrameEffectIntent } from "@/entities/scene/model/recipe-resolve";
import { findArtboardById, findNode } from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import type {
	Artboard,
	SceneDocument,
	VectorNode,
} from "@/entities/scene/model/types";
import {
	createFrameEffectLayerStackOperationCommand,
	type FrameEffectIntentTarget,
	readFrameEffectLayerStackForTarget,
} from "@/features/effect-authoring/model/effect-intent-commands";
import {
	createFrameInfluenceMaskKindOperation,
	createFrameInfluenceNumberOperation,
	type FrameEffectInfluenceEditingValues,
	type FrameEffectInfluenceMaskKind,
	type FrameEffectInfluenceNumberField,
	frameInfluenceMaskKind,
	frameInfluenceValues,
	primaryFrameInfluenceAssignment,
} from "@/features/effect-authoring/model/frame-influence-authoring";
import {
	applyRecipePathPatch,
	createLegacyRecipeScalarPatch,
	type LegacyRecipeScalarField,
	type RecipeControlPath,
	type RecipeControlSpec,
	type RecipeControlValue,
	recipeControlSpecForPath,
	recipeControlValuesForSelection,
} from "@/features/effect-authoring/model/recipe-controls";
import {
	createInsertLookGraphNodeCommand,
	createInsertParticleDissolveNodeCommand,
	createMaterializeLookGraphCommand,
	createRemoveLookGraphNodeCommand,
	createReorderLookGraphNodeCommand,
	createToggleLookGraphNodeCommand,
	createUpdateLookGraphNodeNumberCommand,
	type AuthorableLookGraphNodeKind as FeatureAuthorableLookGraphNodeKind,
	type FrameLookGraphCommandResult,
	type InsertLookGraphNodeOptions,
	type LookGraphNodeNumberPath,
	readFrameLookGraphForTarget,
	targetStoresExplicitLookGraph,
	targetUsesExplicitLookGraph,
} from "@/features/look-authoring/model/look-graph-commands";
import {
	applyLookNodeParamKeyframe,
	type LookNodeKeyframeContext,
	planLookNodeKeyframe,
} from "@/features/look-authoring/model/look-node-keyframing";
import {
	type EffectInfluenceRecipe,
	legacyGlowBloomValue,
	legacyGlowRadiusValue,
	legacyRgbSplitValue,
	legacyTextureGrainValue,
	legacyTextureNoiseScaleValue,
	resolveTextureParticleLinearField,
	textureParticleFieldMode,
	textureParticleLinearFieldAngle,
	textureParticleLinearFieldEffective,
	type VisualRecipe,
} from "@/shared/vec-core";
import {
	commitFrameInfluenceMaskEdit,
	executeInspectorAuthoringPlan,
	planFrameRecipeNumberEdit,
	planFrameVisualRecipeApply,
} from "./authoring-controller";
import {
	applyCommandsAsTransaction,
	MIXED_VALUE,
	type MixedValue,
	mixedValue,
	uniqueNodeIds,
} from "./editing-shared";
import { recipeForNode } from "./frame-look-shared";

/** Authorable numeric fields of a node's vec-core recipe ("look"). */
export type RecipeNumberField = LegacyRecipeScalarField;

/** Inspector scopes that can own frame-level vec-core effect intent. */
export type FrameEffectRecipeScope = "current-artboard" | "scene";

export type FrameEffectLayerStackEditingState = {
	readonly layers: readonly EffectLayer[];
	readonly resetKey: string;
};

/** Slider-facing projection of one numeric Look graph node field. */
export type FrameLookGraphNodeSliderSpec = {
	readonly path: LookGraphNodeNumberPath;
	readonly label: string;
	readonly value: number;
	readonly kind: "unipolar" | "bipolar" | "multiplier";
	readonly min: number;
	readonly max: number;
	readonly neutral: number;
	readonly step: number;
	readonly unit?: string;
};

/** Compact row model for one authorable Look graph node in the Inspector. */
export type FrameLookGraphEditingNode = {
	readonly id: string;
	readonly kind: InspectorAuthorableLookGraphNodeKind;
	readonly label: string;
	readonly enabled: boolean;
	readonly sliders: readonly FrameLookGraphNodeSliderSpec[];
	readonly canMoveUp: boolean;
	readonly canMoveDown: boolean;
};

/** Selector-derived state for the no-selection Frame Look graph editor. */
export type FrameLookGraphEditingState = {
	readonly graphActive: boolean;
	readonly targetStoresGraph: boolean;
	readonly graphPresent: boolean;
	readonly nodes: readonly FrameLookGraphEditingNode[];
	readonly resetKey: string;
};

/** Held scrub gesture that collapses multiple node-number edits into one undo entry. */
export type FrameLookGraphNodeNumberGesture = {
	readonly update: (value: number) => void;
	readonly commit: () => void;
};

type InspectorAuthorableLookGraphNodeKind = Extract<
	FeatureAuthorableLookGraphNodeKind,
	"grade" | "glow" | "grain" | "blur" | "chromatic-fringe"
>;

export const FRAME_LOOK_GRAPH_AUTHORABLE_NODE_KINDS = [
	"grade",
	"glow",
	"grain",
	"blur",
	"chromatic-fringe",
] as const satisfies readonly InspectorAuthorableLookGraphNodeKind[];

export const FRAME_LOOK_GRAPH_NODE_KIND_LABELS = {
	grade: "Grade",
	glow: "Glow",
	grain: "Film Grain",
	blur: "Blur",
	"chromatic-fringe": "RGB Fringe",
} as const satisfies Record<InspectorAuthorableLookGraphNodeKind, string>;

type FrameEffectIntentConcreteTarget = Extract<
	FrameEffectIntentTarget,
	{ readonly scope: "scene" | "artboard" }
>;

const frameEffectIntentTargetForScope = (
	document: SceneDocument,
	scope: FrameEffectRecipeScope,
	artboardId?: string | null,
): FrameEffectIntentConcreteTarget =>
	scope === "scene"
		? { scope: "scene" }
		: {
				scope: "artboard",
				artboardId:
					artboardId ?? document.currentArtboardId ?? document.artboard.id,
			};

const frameEffectLayerOperationKey = (
	operation: EffectLayerStackOperation,
): string => {
	switch (operation.kind) {
		case "add":
			return `add:${operation.layer.id ?? "layer"}`;
		case "update":
			return `update:${operation.layerId}`;
		case "remove":
			return `remove:${operation.layerId}`;
		case "reorder":
			return `reorder:${operation.layerId}:${operation.toIndex}`;
	}
};

export function frameEffectLayerStackEditingState(
	document: SceneDocument,
	scope: FrameEffectRecipeScope,
	artboardId?: string | null,
): FrameEffectLayerStackEditingState {
	const target = frameEffectIntentTargetForScope(document, scope, artboardId);
	const stack = readFrameEffectLayerStackForTarget(document, target);
	const layers = stack?.layers ?? [];
	return {
		layers,
		resetKey: layers
			.map(
				(layer) =>
					`${layer.id}:${layer.kind}:${layer.enabled}:${layer.mix}:${layer.blendMode}:${layer.adaptation?.source ?? "none"}`,
			)
			.join("|"),
	};
}

const isAuthorableLookGraphNode = (
	node: LookGraphNode,
): node is LookGraphNode & {
	readonly kind: InspectorAuthorableLookGraphNodeKind;
} =>
	FRAME_LOOK_GRAPH_AUTHORABLE_NODE_KINDS.includes(
		node.kind as InspectorAuthorableLookGraphNodeKind,
	);

const isParticleTextureNode = (node: LookGraphNode): boolean =>
	node.payload.kind === "grain" &&
	(node.payload.texture.material.mode === "particle" ||
		node.payload.texture.material.mode === "mixed");

const frameLookGraphNodeDisplayLabel = (node: LookGraphNode): string => {
	if (node.payload.kind !== "grain") {
		return node.label || lookGraphNodeLabel(node.kind);
	}
	const defaultish =
		node.label === "" ||
		node.label === "Grain" ||
		node.label === "Film Grain" ||
		node.label === "Particle Dissolve";
	if (!defaultish) return node.label;
	return isParticleTextureNode(node) ? "Particle Dissolve" : "Film Grain";
};

const frameLookGraphSerialNodeIds = (
	nodes: readonly LookGraphNode[],
	edges: readonly LookGraphEdge[],
	outputNodeId: string,
): readonly string[] => {
	const source = nodes.find((node) => node.kind === "source");
	const output = nodes.find((node) => node.id === outputNodeId);
	if (!source || !output || output.kind !== "output") return [];
	const ids: string[] = [source.id];
	const visited = new Set<string>(ids);
	let cursor = source.id;
	while (cursor !== output.id) {
		const next = edges.find(
			(edge) =>
				edge.from.nodeId === cursor &&
				edge.from.portId === lookGraphPortId(cursor, "output", "image"),
		)?.to.nodeId;
		if (!next || visited.has(next)) return [];
		ids.push(next);
		visited.add(next);
		cursor = next;
	}
	return ids;
};

const sliderSpec = (
	path: LookGraphNodeNumberPath,
	label: string,
	value: number,
	kind: FrameLookGraphNodeSliderSpec["kind"],
	min: number,
	max: number,
	neutral: number,
	step: number,
	unit?: string,
): FrameLookGraphNodeSliderSpec => ({
	path,
	label,
	value,
	kind,
	min,
	max,
	neutral,
	step,
	...(unit ? { unit } : {}),
});

const frameLookGraphSlidersForNode = (
	node: LookGraphNode,
): readonly FrameLookGraphNodeSliderSpec[] => {
	switch (node.payload.kind) {
		case "grade":
			return [
				sliderSpec(
					"grade.exposure",
					"Exposure",
					node.payload.color.exposure,
					"bipolar",
					-4,
					4,
					0,
					0.05,
				),
				sliderSpec(
					"grade.contrast",
					"Contrast",
					node.payload.color.contrast,
					"multiplier",
					0,
					4,
					1,
					0.01,
					"×",
				),
				sliderSpec(
					"grade.saturation",
					"Saturate",
					node.payload.color.saturation,
					"multiplier",
					0,
					4,
					1,
					0.01,
					"×",
				),
			];
		case "glow":
			return [
				sliderSpec(
					"glow.strength",
					"Glow",
					node.payload.glow.bloom.strength,
					"unipolar",
					0,
					1,
					0,
					0.01,
				),
				sliderSpec(
					"glow.radius",
					"Radius",
					node.payload.glow.bloom.radius,
					"unipolar",
					0,
					1,
					0.35,
					0.01,
				),
			];
		case "grain": {
			const texture = node.payload.texture;
			const particle = isParticleTextureNode(node);
			const sliders = [
				sliderSpec(
					"grain.strength",
					particle ? "Amount" : "Grain",
					particle ? texture.grain.densityCoupling : texture.grain.strength,
					"unipolar",
					0,
					1,
					0,
					0.01,
				),
				sliderSpec(
					"grain.size",
					"Size",
					texture.grain.size,
					"unipolar",
					0,
					1,
					0.3,
					0.01,
				),
			];
			if (!particle) return sliders;
			sliders.push(
				sliderSpec(
					"grain.extent",
					"Extent",
					texture.material.strength,
					"unipolar",
					0,
					1,
					0.65,
					0.01,
				),
				sliderSpec(
					"grain.softness",
					"Softness",
					1 - texture.material.particleContrast,
					"unipolar",
					0,
					1,
					0.65,
					0.01,
				),
			);
			if (textureParticleFieldMode(texture) === "linear") {
				sliders.push(
					sliderSpec(
						"grain.angle",
						"Angle",
						textureParticleLinearFieldAngle(
							textureParticleLinearFieldEffective(
								resolveTextureParticleLinearField(texture),
							),
						),
						"unipolar",
						0,
						360,
						0,
						1,
						"deg",
					),
				);
			}
			return sliders;
		}
		case "blur":
			return node.payload.radiusY === undefined
				? [
						sliderSpec(
							"blur.radius",
							"Radius",
							node.payload.radius,
							"unipolar",
							0,
							80,
							12,
							1,
							"px",
						),
					]
				: [
						sliderSpec(
							"blur.radius",
							"X",
							node.payload.radius,
							"unipolar",
							0,
							80,
							12,
							1,
							"px",
						),
						sliderSpec(
							"blur.radiusY",
							"Y",
							node.payload.radiusY,
							"unipolar",
							0,
							80,
							12,
							1,
							"px",
						),
					];
		case "chromatic-fringe":
			return [
				sliderSpec(
					"chromatic-fringe.amount",
					"Amount",
					node.payload.amount,
					"unipolar",
					0,
					10,
					0,
					0.1,
				),
			];
		case "path-blur":
			return [
				sliderSpec(
					"path-blur.speed",
					"Speed",
					node.payload.speed,
					"unipolar",
					0,
					500,
					100,
					1,
					"%",
				),
				sliderSpec(
					"path-blur.length",
					"Length",
					node.payload.length,
					"unipolar",
					0,
					1,
					0.12,
					0.01,
				),
				sliderSpec(
					"path-blur.taper",
					"Taper",
					node.payload.taper,
					"unipolar",
					0,
					1,
					0.4,
					0.01,
				),
			];
		default:
			return [];
	}
};

/** Projects the resolved frame Look graph into compact Inspector rows and sliders. */
export function frameLookGraphEditingState(
	document: SceneDocument,
	scope: FrameEffectRecipeScope,
	artboardId?: string | null,
): FrameLookGraphEditingState {
	const target = frameEffectIntentTargetForScope(document, scope, artboardId);
	const graph = readFrameLookGraphForTarget(document, target);
	const serialIds = graph
		? frameLookGraphSerialNodeIds(graph.nodes, graph.edges, graph.outputNodeId)
		: [];
	const serialEffectIds = serialIds.filter((id) => {
		const node = graph?.nodes.find((candidate) => candidate.id === id);
		return node ? isAuthorableLookGraphNode(node) : false;
	});
	const serialOrder = new Map(
		serialEffectIds.map((nodeId, index) => [nodeId, index]),
	);
	const nodes = graph
		? graph.nodes
				.filter(isAuthorableLookGraphNode)
				.toSorted(
					(left, right) =>
						(serialOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
						(serialOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER),
				)
				.map((node) => {
					const serialIndex = serialOrder.get(node.id) ?? -1;
					return {
						id: node.id,
						kind: node.kind,
						label: frameLookGraphNodeDisplayLabel(node),
						enabled: node.enabled,
						sliders: frameLookGraphSlidersForNode(node),
						canMoveUp: serialIndex > 0,
						canMoveDown:
							serialIndex >= 0 && serialIndex < serialEffectIds.length - 1,
					} satisfies FrameLookGraphEditingNode;
				})
		: [];
	return {
		graphActive: targetUsesExplicitLookGraph(document, target),
		targetStoresGraph: targetStoresExplicitLookGraph(document, target),
		graphPresent: graph !== null,
		nodes,
		resetKey: [
			scope,
			artboardId ?? "current",
			graph ? graph.outputNodeId : "none",
			...nodes.map(
				(node) =>
					`${node.id}:${node.kind}:${node.enabled}:${node.sliders
						.map((slider) => `${slider.path}:${slider.value}`)
						.join(",")}`,
			),
		].join("|"),
	};
}

/** Path-keyed frame recipe values projected into NumericField-compatible state. */
export type FrameEffectRecipeEditingValues = Readonly<
	Record<string, MixedValue<number> | null>
>;

/** Selector-derived authoring state for the current frame influence mask. */
export type FrameEffectInfluenceEditingState = {
	readonly scope: FrameEffectRecipeScope;
	readonly assignmentId: string | null;
	readonly label: string | null;
	readonly maskKind: FrameEffectInfluenceMaskKind | "unsupported" | null;
	readonly values: FrameEffectInfluenceEditingValues;
	readonly canEdit: boolean;
	readonly resetKey: string;
};

/** Compact frame-level look controls rendered by the Inspector. */
export const INSPECTOR_FRAME_RECIPE_CONTROL_PATHS = [
	"texture.grain.strength",
	"texture.grain.size",
	"glow.bloom.strength",
	"glow.bloom.radius",
	"optics.chromaticFringing",
	"color.exposure",
	"color.contrast",
	"color.saturation",
] as const satisfies readonly RecipeControlPath[];

type InspectorFrameRecipeControl = RecipeControlSpec & {
	readonly path: (typeof INSPECTOR_FRAME_RECIPE_CONTROL_PATHS)[number];
};

/** Metadata for the compact path-driven frame recipe controls. */
export const INSPECTOR_FRAME_RECIPE_CONTROLS: readonly InspectorFrameRecipeControl[] =
	INSPECTOR_FRAME_RECIPE_CONTROL_PATHS.map((path) => {
		const spec = recipeControlSpecForPath(path);
		if (!spec) throw new Error(`Missing Inspector recipe control ${path}.`);
		return spec as InspectorFrameRecipeControl;
	});

const normalizedRecipeNumber = (
	field: RecipeNumberField,
	value: number,
): number | null => {
	if (!Number.isFinite(value)) return null;
	if (field === "grain" || field === "glowBloom")
		return Math.min(Math.max(value, 0), 1);
	if (field === "noiseScale") return value > 0 ? value : null;
	if (
		field === "saturation" ||
		field === "contrast" ||
		field === "glowRadius" ||
		field === "rgbSplit"
	)
		return value >= 0 ? value : null;
	return value;
};

const withLegacyRecipeNumber = (
	recipe: VisualRecipe,
	field: RecipeNumberField,
	value: number,
): VisualRecipe | null => {
	const result = applyRecipePathPatch(
		recipe,
		createLegacyRecipeScalarPatch(field, value),
	);
	return result.kind === "applied" ? result.recipe : null;
};

/**
 * Commits one numeric field of the node's vec-core recipe through the same
 * undoable command bus as every other node edit. Reads each node's current
 * recipe (or the neutral default), updates the field, and writes the normalized
 * recipe via {@link createUpdateNodeRecipeCommand}. The SVG renderers paint the
 * vector-expressible subset (color grade + grain); a neutral recipe renders
 * nothing, so authoring stays lossless.
 */
export function commitRecipeNumber(
	nodeIds: readonly string[],
	field: RecipeNumberField,
	value: number,
): boolean {
	const normalized = normalizedRecipeNumber(field, value);
	if (normalized === null) return false;
	const document = useSceneStore.getState().document;
	const commands = uniqueNodeIds(nodeIds).flatMap((nodeId) => {
		const node = findNode(document, nodeId);
		if (!node) return [];
		const next = withLegacyRecipeNumber(recipeForNode(node), field, normalized);
		if (!next) return [];
		return [createUpdateNodeRecipeCommand(nodeId, next)];
	});
	if (commands.length === 0) return false;
	return applyCommandsAsTransaction(
		`recipe:${field}:${nodeIds.join(",")}`,
		"Edit look",
		commands,
	);
}

/**
 * A live drag handle over one recipe scalar across the selection. Every
 * {@link update} accumulates into a single held command-bus transaction, and
 * {@link commit} seals the whole gesture as exactly one undo entry.
 */
export type RecipeNumberGesture = {
	readonly update: (value: number) => void;
	readonly commit: () => void;
};

let recipeGestureSeq = 0;

/**
 * Opens a coalesced drag gesture for one numeric recipe field so a slider drag
 * collapses to ONE undo entry. {@link commitRecipeNumber} cannot be reused per
 * tick: it routes through `applyCommandsAsTransaction`, whose `nextCommitKey`
 * increments a global counter, so every tick would mint a unique coalesce key and
 * land its own history entry (one drag = dozens of undo steps). This instead opens
 * a single transaction under a stable per-gesture key and applies every tick into
 * it; the store coalesces nothing because there is nothing to coalesce — it is one
 * transaction, committed once.
 *
 * Returns null for an empty selection (mirrors {@link commitRecipeNumber}). The
 * caller MUST drain any pending rAF and flush the final value via {@link
 * RecipeNumberGesture.update} BEFORE {@link RecipeNumberGesture.commit}: a commit
 * that closes the transaction before a stale tick lands would leave that tick as a
 * second, un-coalesced entry. The gesture must also be committed if the pointer
 * release is missed (blur/unmount) so the held transaction cannot leak.
 */
export function beginRecipeNumberGesture(
	nodeIds: readonly string[],
	field: RecipeNumberField,
): RecipeNumberGesture | null {
	const ids = uniqueNodeIds(nodeIds);
	if (ids.length === 0) return null;
	const coalesceKey = `recipe-scrub:${field}:${recipeGestureSeq++}`;
	useSceneStore.getState().beginTransaction(coalesceKey, "Edit look");
	let sealed = false;
	return {
		update: (value) => {
			if (sealed) return;
			const normalized = normalizedRecipeNumber(field, value);
			if (normalized === null) return;
			const document = useSceneStore.getState().document;
			for (const nodeId of ids) {
				const node = findNode(document, nodeId);
				if (!node) continue;
				const next = withLegacyRecipeNumber(
					recipeForNode(node),
					field,
					normalized,
				);
				if (!next) continue;
				useSceneStore
					.getState()
					.apply(createUpdateNodeRecipeCommand(nodeId, next));
			}
		},
		commit: () => {
			if (sealed) return;
			sealed = true;
			useSceneStore.getState().commit();
		},
	};
}

/**
 * Applies a COMPLETE saved frame look (a canonical vec-core recipe) to the
 * scene/artboard `effectIntent` at the given scope, as one undoable command
 * through the existing frame-look authoring seam. A recall onto a frame that
 * already carries an equal recipe is a typed no-op, so repeated clicks do not
 * flood undo history.
 */
export function commitFrameVisualRecipeApply(
	scope: FrameEffectRecipeScope,
	recipe: VisualRecipe,
	artboardId?: string | null,
): boolean {
	const document = useSceneStore.getState().document;
	return executeInspectorAuthoringPlan(
		planFrameVisualRecipeApply({ document, scope, recipe, artboardId }),
	);
}

/**
 * Recalls the one canonical "Analog Film" look — the analog-film treatment (grain
 * + chromatic-aberration edge + restrained grade) — onto the current frame (or
 * scene). It reuses the exact same recipe const and frame renderer as the Time
 * Delay motion stage, so the recalled texture is faithful by construction. NOTE:
 * it reproduces the film treatment only; it does not recolor objects to near-black
 * fills, so it reads differently on light-colored artwork.
 */
export function commitAnalogFilmFrameLook(
	scope: FrameEffectRecipeScope,
	artboardId?: string | null,
): boolean {
	return commitFrameVisualRecipeApply(
		scope,
		ANALOG_FILM_LOOK_RECIPE,
		artboardId,
	);
}

const frameLookEffectIntentForScope = (
	document: SceneDocument,
	scope: FrameEffectRecipeScope,
	artboardId?: string | null,
): Artboard["effectIntent"] | SceneDocument["effectIntent"] => {
	if (scope === "scene") return document.effectIntent;
	const targetArtboardId =
		artboardId ?? document.currentArtboardId ?? document.artboard.id;
	return findArtboardById(document, targetArtboardId)?.effectIntent;
};

/** Reports whether the chosen frame-look scope currently has a removable frame pass. */
export function canRemoveAnalogFilmFrameLook(
	document: SceneDocument,
	scope: FrameEffectRecipeScope,
	artboardId?: string | null,
): boolean {
	const intent = frameLookEffectIntentForScope(document, scope, artboardId);
	return Boolean(
		intent?.effectLayerStack || intent?.visualRecipe || intent?.influenceRecipe,
	);
}

/**
 * Clears the broad frame Analog Film pass for the selected scope. Scoped
 * selection looks stay untouched, so object-level remove remains independent
 * from no-selection Frame/Scene remove.
 */
export function commitRemoveAnalogFilmFrameLook(
	scope: FrameEffectRecipeScope,
	artboardId?: string | null,
): boolean {
	const document = useSceneStore.getState().document;
	if (!canRemoveAnalogFilmFrameLook(document, scope, artboardId)) return false;
	const targetArtboardId =
		artboardId ?? document.currentArtboardId ?? document.artboard.id;
	const target =
		scope === "scene"
			? ({ scope: "scene" } as const)
			: ({ scope: "artboard", artboardId: targetArtboardId } as const);
	return applyCommandsAsTransaction(
		`frame-look:analog-film-remove:${scope}:${targetArtboardId}`,
		"Remove Analog Film",
		[
			createUpdateEffectIntentCommand(
				target,
				{ effectLayerStack: null, visualRecipe: null, influenceRecipe: null },
				{
					label: "Remove Analog Film",
					coalesceKey: `frame-look:analog-film-remove:${scope}:${targetArtboardId}`,
				},
			),
		],
	);
}

/** Mixed recipe field values for the current selection's "Look" inspector. */
export type RecipeEditingValues = {
	readonly grain: MixedValue<number> | null;
	readonly noiseScale: MixedValue<number> | null;
	readonly saturation: MixedValue<number> | null;
	readonly exposure: MixedValue<number> | null;
	readonly contrast: MixedValue<number> | null;
	readonly glowBloom: MixedValue<number> | null;
	readonly glowRadius: MixedValue<number> | null;
	readonly rgbSplit: MixedValue<number> | null;
};

/** Reads the selection's recipe fields, defaulting omitted recipes to neutral. */
export function recipeEditingValuesForSelection(
	nodes: readonly VectorNode[],
): RecipeEditingValues {
	return {
		grain: mixedValue(nodes, (node) =>
			legacyTextureGrainValue(recipeForNode(node).texture),
		),
		noiseScale: mixedValue(nodes, (node) =>
			legacyTextureNoiseScaleValue(recipeForNode(node).texture),
		),
		saturation: mixedValue(
			nodes,
			(node) => recipeForNode(node).color.saturation,
		),
		exposure: mixedValue(nodes, (node) => recipeForNode(node).color.exposure),
		contrast: mixedValue(nodes, (node) => recipeForNode(node).color.contrast),
		glowBloom: mixedValue(nodes, (node) =>
			legacyGlowBloomValue(recipeForNode(node).glow),
		),
		glowRadius: mixedValue(nodes, (node) =>
			legacyGlowRadiusValue(recipeForNode(node).glow),
		),
		rgbSplit: mixedValue(nodes, (node) =>
			legacyRgbSplitValue(recipeForNode(node).optics),
		),
	};
}

const visualRecipeForFrameScope = (
	document: SceneDocument,
	scope: FrameEffectRecipeScope,
	artboardId?: string | null,
): VisualRecipe | null => {
	if (scope === "scene") return document.effectIntent?.visualRecipe ?? null;
	return resolveFrameEffectIntent(document, artboardId).visualRecipe;
};

const influenceRecipeForFrameScope = (
	document: SceneDocument,
	scope: FrameEffectRecipeScope,
	artboardId?: string | null,
): EffectInfluenceRecipe | null => {
	if (scope === "scene") return document.effectIntent?.influenceRecipe ?? null;
	return resolveFrameEffectIntent(document, artboardId).influenceRecipe;
};

const numberFromRecipeControlValue = (
	value: RecipeControlValue | typeof MIXED_VALUE | null,
): MixedValue<number> | null => {
	if (value === MIXED_VALUE) return MIXED_VALUE;
	return typeof value === "number" ? value : null;
};

/**
 * Reads compact frame-level recipe values for the Inspector. Current-artboard
 * scope intentionally resolves scene fallback first so the first field edit
 * starts from the look the frame is effectively using, then writes an artboard
 * side-car override.
 */
export function frameRecipeEditingValues(
	document: SceneDocument,
	scope: FrameEffectRecipeScope,
	artboardId?: string | null,
	paths: readonly string[] = INSPECTOR_FRAME_RECIPE_CONTROL_PATHS,
): FrameEffectRecipeEditingValues {
	const recipe = visualRecipeForFrameScope(document, scope, artboardId);
	const values = recipeControlValuesForSelection([recipe], paths);
	return Object.fromEntries(
		paths.map((path) => {
			const value = values[path];
			if (!value || value.kind === "invalid-path" || value.kind === "empty") {
				return [path, null];
			}
			if (value.kind === "mixed") return [path, MIXED_VALUE];
			return [path, numberFromRecipeControlValue(value.value)];
		}),
	);
}

/**
 * Commits one canonical vec-core recipe path to scene/artboard `effectIntent`.
 * The command bus owns undo/redo; invalid paths or non-numeric controls remain
 * no-ops so Inspector chrome cannot persist host-only recipe fields.
 */
export function commitFrameRecipeNumber(
	scope: FrameEffectRecipeScope,
	path: string,
	value: number,
	artboardId?: string | null,
): boolean {
	const document = useSceneStore.getState().document;
	return executeInspectorAuthoringPlan(
		planFrameRecipeNumberEdit({
			document,
			scope,
			path,
			value,
			artboardId,
		}),
	);
}

export function commitFrameEffectLayerStackOperation(
	scope: FrameEffectRecipeScope,
	operation: EffectLayerStackOperation,
	artboardId?: string | null,
): boolean {
	const document = useSceneStore.getState().document;
	const target = frameEffectIntentTargetForScope(document, scope, artboardId);
	const result = createFrameEffectLayerStackOperationCommand(
		document,
		target,
		operation,
		{
			label: "Edit effect stack",
			coalesceKey: `frame-effect-stack:${scope}:${frameEffectLayerOperationKey(operation)}`,
		},
	);
	if (result.kind !== "ready") return false;
	const targetKey =
		target.scope === "scene" ? "scene" : `artboard:${target.artboardId}`;
	return applyCommandsAsTransaction(
		`frame-effect-stack:${targetKey}`,
		"Edit effect stack",
		[result.command],
		`frame-effect-stack:${targetKey}:${frameEffectLayerOperationKey(operation)}`,
	);
}

const frameLookGraphTargetKey = (
	target: FrameEffectIntentConcreteTarget,
): string =>
	target.scope === "scene" ? "scene" : `artboard:${target.artboardId}`;

const applyFrameLookGraphResult = (
	result: FrameLookGraphCommandResult,
	label: string,
	operationKey: string,
): boolean => {
	if (result.kind !== "ready") return false;
	if (result.target.scope !== "scene" && result.target.scope !== "artboard") {
		return false;
	}
	const target = result.target;
	const targetKey = frameLookGraphTargetKey(target);
	return applyCommandsAsTransaction(
		`frame-look-graph:${targetKey}`,
		label,
		[result.command],
		`frame-look-graph:${targetKey}:${operationKey}`,
	);
};

/** Materializes the resolved Frame/Scene Look into the selected scope's graph slot. */
export function commitMaterializeFrameLookGraph(
	scope: FrameEffectRecipeScope,
	artboardId?: string | null,
): boolean {
	const document = useSceneStore.getState().document;
	const target = frameEffectIntentTargetForScope(document, scope, artboardId);
	return applyFrameLookGraphResult(
		createMaterializeLookGraphCommand(document, target, {
			label: "Edit as look graph",
		}),
		"Edit as look graph",
		"materialize",
	);
}

/** Adds one serial Look graph node through the scene command bus. */
export function commitInsertFrameLookGraphNode(
	scope: FrameEffectRecipeScope,
	kind: InspectorAuthorableLookGraphNodeKind,
	artboardId?: string | null,
	options: Pick<InsertLookGraphNodeOptions, "insertAfterNodeId"> = {},
): boolean {
	const document = useSceneStore.getState().document;
	const target = frameEffectIntentTargetForScope(document, scope, artboardId);
	return applyFrameLookGraphResult(
		createInsertLookGraphNodeCommand(document, target, kind, {
			label: "Add look graph node",
			...options,
		}),
		"Add look graph node",
		options.insertAfterNodeId
			? `insert:${kind}:after:${options.insertAfterNodeId}`
			: `insert:${kind}`,
	);
}

/** Adds a frame-scope Particle Dissolve texture node through the scene command bus. */
export function commitInsertParticleDissolveNode(
	scope: FrameEffectRecipeScope,
	artboardId?: string | null,
	options: Pick<InsertLookGraphNodeOptions, "insertAfterNodeId"> = {},
): boolean {
	const document = useSceneStore.getState().document;
	const target = frameEffectIntentTargetForScope(document, scope, artboardId);
	return applyFrameLookGraphResult(
		createInsertParticleDissolveNodeCommand(document, target, {
			label: "Add particle dissolve",
			...options,
		}),
		"Add particle dissolve",
		options.insertAfterNodeId
			? `insert:particle-dissolve:after:${options.insertAfterNodeId}`
			: "insert:particle-dissolve",
	);
}

/** Removes one serial Look graph node through the scene command bus. */
export function commitRemoveFrameLookGraphNode(
	scope: FrameEffectRecipeScope,
	nodeId: string,
	artboardId?: string | null,
): boolean {
	const document = useSceneStore.getState().document;
	const target = frameEffectIntentTargetForScope(document, scope, artboardId);
	return applyFrameLookGraphResult(
		createRemoveLookGraphNodeCommand(document, target, nodeId, {
			label: "Remove look graph node",
		}),
		"Remove look graph node",
		`remove:${nodeId}`,
	);
}

/** Moves one serial Look graph node up or down in the graph chain. */
export function commitReorderFrameLookGraphNode(
	scope: FrameEffectRecipeScope,
	nodeId: string,
	direction: "up" | "down",
	artboardId?: string | null,
): boolean {
	const document = useSceneStore.getState().document;
	const target = frameEffectIntentTargetForScope(document, scope, artboardId);
	return applyFrameLookGraphResult(
		createReorderLookGraphNodeCommand(document, target, nodeId, direction, {
			label: "Reorder look graph",
		}),
		"Reorder look graph",
		`reorder:${nodeId}:${direction}`,
	);
}

/** Toggles one Look graph node's enabled state. */
export function commitToggleFrameLookGraphNode(
	scope: FrameEffectRecipeScope,
	nodeId: string,
	enabled: boolean,
	artboardId?: string | null,
): boolean {
	const document = useSceneStore.getState().document;
	const target = frameEffectIntentTargetForScope(document, scope, artboardId);
	return applyFrameLookGraphResult(
		createToggleLookGraphNodeCommand(document, target, nodeId, enabled, {
			label: "Toggle look graph node",
		}),
		"Toggle look graph node",
		`toggle:${nodeId}:${enabled}`,
	);
}

/** Commits one numeric Look graph node value as a discrete undoable edit. */
export function commitFrameLookGraphNodeNumber(
	scope: FrameEffectRecipeScope,
	nodeId: string,
	path: LookGraphNodeNumberPath,
	value: number,
	artboardId?: string | null,
	keyframeContext?: LookNodeKeyframeContext,
): boolean {
	const document = useSceneStore.getState().document;
	const target = frameEffectIntentTargetForScope(document, scope, artboardId);
	const keyframe = planLookNodeKeyframe(
		useMotionStore.getState().document,
		keyframeContext,
		target,
		nodeId,
		path,
	);
	if (keyframe) {
		applyLookNodeParamKeyframe(
			keyframe.owner,
			nodeId,
			keyframe.paramKey,
			keyframe.frame,
			value,
		);
		return true;
	}
	return applyFrameLookGraphResult(
		createUpdateLookGraphNodeNumberCommand(
			document,
			target,
			nodeId,
			path,
			value,
			{ label: "Edit look graph node" },
		),
		"Edit look graph node",
		`number:${nodeId}:${path}`,
	);
}

let frameLookGraphGestureSeq = 0;

/** Opens a held graph-node scrub transaction; callers must call `commit()`. */
export function beginFrameLookGraphNodeNumberGesture(
	scope: FrameEffectRecipeScope,
	nodeId: string,
	path: LookGraphNodeNumberPath,
	artboardId?: string | null,
	keyframeContext?: LookNodeKeyframeContext,
): FrameLookGraphNodeNumberGesture {
	const document = useSceneStore.getState().document;
	const target = frameEffectIntentTargetForScope(document, scope, artboardId);
	// Record keyframes at the playhead when the param should be keyed (recording or
	// already animated); the per-(track,frame) coalesce key folds the scrub into one
	// undo, so no motion transaction is opened. Mirrors look-graph-editor.ts.
	const keyframe = planLookNodeKeyframe(
		useMotionStore.getState().document,
		keyframeContext,
		target,
		nodeId,
		path,
	);
	if (keyframe) {
		let keyframeSealed = false;
		return {
			update: (value) => {
				if (keyframeSealed) return;
				applyLookNodeParamKeyframe(
					keyframe.owner,
					nodeId,
					keyframe.paramKey,
					keyframe.frame,
					value,
				);
			},
			commit: () => {
				keyframeSealed = true;
			},
		};
	}
	const targetKey = frameLookGraphTargetKey(target);
	const coalesceKey = `frame-look-graph-scrub:${targetKey}:${nodeId}:${path}:${frameLookGraphGestureSeq++}`;
	useSceneStore
		.getState()
		.beginTransaction(coalesceKey, "Edit look graph node");
	let sealed = false;
	return {
		update: (value) => {
			if (sealed) return;
			const result = createUpdateLookGraphNodeNumberCommand(
				useSceneStore.getState().document,
				target,
				nodeId,
				path,
				value,
				{
					label: "Edit look graph node",
					coalesceKey,
				},
			);
			if (result.kind === "ready") {
				useSceneStore.getState().apply(result.command);
			}
		},
		commit: () => {
			if (sealed) return;
			sealed = true;
			useSceneStore.getState().commit();
		},
	};
}

/** Reads the first authorable frame influence assignment for compact Inspector controls. */
export function frameEffectInfluenceEditingState(
	document: SceneDocument,
	scope: FrameEffectRecipeScope,
	artboardId?: string | null,
): FrameEffectInfluenceEditingState {
	const recipe = influenceRecipeForFrameScope(document, scope, artboardId);
	const assignment = primaryFrameInfluenceAssignment(recipe);
	const maskKind = frameInfluenceMaskKind(assignment);
	return {
		scope,
		assignmentId: assignment?.id ?? null,
		label: assignment?.label ?? null,
		maskKind,
		values: frameInfluenceValues(assignment),
		canEdit: true,
		resetKey: `frame-influence:${scope}:${artboardId ?? "scene"}:${assignment?.id ?? "none"}:${maskKind ?? "none"}`,
	};
}

/**
 * Attaches or replaces the current frame influence mask with a radial/linear
 * soft mask. Existing scene fallback is copied into the artboard side-car when
 * editing current-artboard scope so the visible frame result changes directly.
 */
export function commitFrameEffectInfluenceMaskKind(
	scope: FrameEffectRecipeScope,
	kind: FrameEffectInfluenceMaskKind,
	artboardId?: string | null,
): boolean {
	const document = useSceneStore.getState().document;
	const current = influenceRecipeForFrameScope(document, scope, artboardId);
	return commitFrameInfluenceMaskEdit(
		scope,
		createFrameInfluenceMaskKindOperation(current, kind),
		artboardId,
		"Edit effect influence",
	);
}

/** Removes the active frame influence assignment without mutating scene state directly. */
export function commitRemoveFrameEffectInfluenceMask(
	scope: FrameEffectRecipeScope,
	assignmentId: string,
	artboardId?: string | null,
): boolean {
	return commitFrameInfluenceMaskEdit(
		scope,
		{ kind: "remove", assignmentId },
		artboardId,
		"Remove effect influence",
	);
}

/**
 * Edits strength, feather, and basic radial/linear source parameters on the
 * active frame influence assignment. Unknown fields for the current source are
 * no-ops to avoid fabricating unsupported mask shapes from stale UI.
 */
export function commitFrameEffectInfluenceNumber(
	scope: FrameEffectRecipeScope,
	assignmentId: string,
	field: FrameEffectInfluenceNumberField,
	value: number,
	artboardId?: string | null,
): boolean {
	const document = useSceneStore.getState().document;
	const current = influenceRecipeForFrameScope(document, scope, artboardId);
	return commitFrameInfluenceMaskEdit(
		scope,
		createFrameInfluenceNumberOperation(current, assignmentId, field, value),
		artboardId,
		"Edit effect influence",
	);
}
