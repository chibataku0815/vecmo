import {
	type EffectInfluenceRecipe,
	type EffectInfluenceRecipeDraft,
	normalizeEffectInfluenceRecipe,
	normalizeVisualRecipe,
	type VisualRecipe,
	type VisualRecipeDraft,
} from "@/shared/vec-core";
import {
	type EffectLayerOwnerRef,
	type EffectLayerStack,
	type EffectLayerStackDraft,
	normalizeEffectLayerStack,
} from "./effect-layer-stack";
import {
	type LookGraph,
	type LookGraphDraft,
	lookGraphFromIntent,
	normalizeLookGraph,
} from "./look-graph";
import {
	findArtboardById,
	selectArtboardIdForNode,
	selectCurrentArtboard,
} from "./selectors";
import type {
	EffectIntent,
	SceneDocument,
	ScopedEffectLook,
	VectorNode,
} from "./types";

export type VisualRecipeScopedEffectLookDraft = {
	readonly id: string;
	readonly kind: "visual-recipe-overlay";
	readonly source: "analog-film-selection";
	readonly visualRecipe: VisualRecipeDraft;
	readonly targetNodeIds: readonly string[];
	readonly influenceRecipe?: EffectInfluenceRecipeDraft | null;
};

export type LookGraphScopedEffectLookDraft = {
	readonly id: string;
	readonly kind: "look-graph-overlay";
	readonly source:
		| "object-noise-gradient"
		| "object-path-blur"
		| "selection-look-graph";
	readonly lookGraph: LookGraphDraft;
	readonly targetNodeIds: readonly string[];
};

export type ScopedEffectLookDraft =
	| VisualRecipeScopedEffectLookDraft
	| LookGraphScopedEffectLookDraft;

export type EffectIntentDraft = {
	readonly lookGraph?: LookGraphDraft | null;
	readonly effectLayerStack?: EffectLayerStackDraft | null;
	readonly visualRecipe?: VisualRecipeDraft | null;
	readonly influenceRecipe?: EffectInfluenceRecipeDraft | null;
	readonly scopedLooks?: readonly ScopedEffectLookDraft[] | null;
};

export type EffectIntentRecipeSource = "scene" | "artboard";

export type ResolvedFrameEffectIntent = {
	readonly artboardId: string;
	readonly lookGraph: LookGraph | null;
	readonly lookGraphSource: EffectIntentRecipeSource | null;
	readonly effectLayerStack: EffectLayerStack | null;
	readonly effectLayerStackSource: EffectIntentRecipeSource | null;
	readonly visualRecipe: VisualRecipe | null;
	readonly visualRecipeSource: EffectIntentRecipeSource | null;
	readonly influenceRecipe: EffectInfluenceRecipe | null;
	readonly influenceRecipeSource: EffectIntentRecipeSource | null;
};

/**
 * True when the side-car carries at least one authored slot. Empty side-cars
 * are omitted from documents, so writers use this to decide between keeping
 * and dropping the `effectIntent` field.
 */
export const hasEffectIntentPayload = (intent: EffectIntent): boolean =>
	intent.lookGraph !== undefined ||
	intent.effectLayerStack !== undefined ||
	intent.visualRecipe !== undefined ||
	intent.influenceRecipe !== undefined ||
	intent.scopedLooks !== undefined;

const normalizeScopedTargetIds = (
	nodeIds: readonly string[],
): readonly string[] => {
	const ids = new Set<string>();
	for (const nodeId of nodeIds) {
		if (nodeId.length > 0) ids.add(nodeId);
	}
	return [...ids];
};

const normalizeScopedEffectLook = (
	draft: ScopedEffectLookDraft | ScopedEffectLook,
): ScopedEffectLook | null => {
	if (draft.id.length === 0) return null;
	const targetNodeIds = normalizeScopedTargetIds(draft.targetNodeIds);
	if (targetNodeIds.length === 0) return null;
	if (draft.kind === "visual-recipe-overlay") {
		if (draft.source !== "analog-film-selection") return null;
		const influenceRecipe =
			draft.influenceRecipe === undefined || draft.influenceRecipe === null
				? undefined
				: normalizeEffectInfluenceRecipe(draft.influenceRecipe);
		return {
			id: draft.id,
			kind: draft.kind,
			source: draft.source,
			visualRecipe: normalizeVisualRecipe(draft.visualRecipe),
			targetNodeIds,
			...(influenceRecipe ? { influenceRecipe } : {}),
		};
	}
	if (draft.kind === "look-graph-overlay") {
		if (
			draft.source !== "object-noise-gradient" &&
			draft.source !== "object-path-blur" &&
			draft.source !== "selection-look-graph"
		) {
			return null;
		}
		const lookGraph = normalizeLookGraph(draft.lookGraph);
		if (!lookGraph) return null;
		return {
			id: draft.id,
			kind: draft.kind,
			source: draft.source,
			lookGraph,
			targetNodeIds,
		};
	}
	return null;
};

const normalizeScopedEffectLooks = (
	drafts: readonly (ScopedEffectLookDraft | ScopedEffectLook)[] | undefined,
): readonly ScopedEffectLook[] | undefined => {
	if (!drafts) return undefined;
	const normalized = drafts.flatMap((draft) => {
		const look = normalizeScopedEffectLook(draft);
		return look ? [look] : [];
	});
	return normalized.length > 0 ? normalized : undefined;
};

/**
 * Normalizes an optional scene/artboard vec-core side-car and drops empty
 * payloads. This keeps the persisted shape additive while giving O5/O6/O7 one
 * canonical read path for frame-level looks and influence assignments.
 */
export function normalizeEffectIntent(
	draft: EffectIntentDraft | EffectIntent | null | undefined,
): EffectIntent | undefined {
	if (!draft) return undefined;
	const lookGraph =
		draft.lookGraph === undefined || draft.lookGraph === null
			? undefined
			: normalizeLookGraph(draft.lookGraph);
	const effectLayerStack =
		draft.effectLayerStack === undefined || draft.effectLayerStack === null
			? undefined
			: normalizeEffectLayerStack(draft.effectLayerStack);
	const visualRecipe =
		draft.visualRecipe === undefined || draft.visualRecipe === null
			? undefined
			: normalizeVisualRecipe(draft.visualRecipe);
	const influenceRecipe =
		draft.influenceRecipe === undefined || draft.influenceRecipe === null
			? undefined
			: normalizeEffectInfluenceRecipe(draft.influenceRecipe);
	const scopedLooks =
		draft.scopedLooks === undefined || draft.scopedLooks === null
			? undefined
			: normalizeScopedEffectLooks(draft.scopedLooks);
	const intent = {
		...(lookGraph ? { lookGraph } : {}),
		...(effectLayerStack ? { effectLayerStack } : {}),
		...(visualRecipe ? { visualRecipe } : {}),
		...(influenceRecipe ? { influenceRecipe } : {}),
		...(scopedLooks ? { scopedLooks } : {}),
	} satisfies EffectIntent;
	return hasEffectIntentPayload(intent) ? intent : undefined;
}

/**
 * Applies a sparse side-car patch while preserving omitted recipe slots. Passing
 * `null` clears one slot; when both slots are absent the whole side-car resolves
 * to `undefined` so legacy-shaped documents stay compact.
 */
export function applyEffectIntentPatch(
	base: EffectIntent | undefined,
	patch: EffectIntentDraft,
): EffectIntent | undefined {
	const lookGraph =
		patch.lookGraph === undefined
			? base?.lookGraph
			: patch.lookGraph === null
				? undefined
				: normalizeLookGraph(patch.lookGraph);
	const effectLayerStack =
		patch.effectLayerStack === undefined
			? base?.effectLayerStack
			: patch.effectLayerStack === null
				? undefined
				: normalizeEffectLayerStack(patch.effectLayerStack);
	const visualRecipe =
		patch.visualRecipe === undefined
			? base?.visualRecipe
			: patch.visualRecipe === null
				? undefined
				: normalizeVisualRecipe(patch.visualRecipe);
	const influenceRecipe =
		patch.influenceRecipe === undefined
			? base?.influenceRecipe
			: patch.influenceRecipe === null
				? undefined
				: normalizeEffectInfluenceRecipe(patch.influenceRecipe);
	const scopedLooks =
		patch.scopedLooks === undefined
			? base?.scopedLooks
			: patch.scopedLooks === null
				? undefined
				: normalizeScopedEffectLooks(patch.scopedLooks);
	return normalizeEffectIntent({
		lookGraph,
		effectLayerStack,
		visualRecipe,
		influenceRecipe,
		scopedLooks,
	});
}

/**
 * Resolves a node's attached vec-core visual recipe ("look") into a canonical
 * {@link VisualRecipe}, or `null` when the node carries none. The inline
 * `node.recipe` is the live attached-intent home (integration-doc P3); it is
 * normalized defensively so render adapters can read stable, fully-populated
 * fields. `recipeRef` (a future shared-library id) is intentionally not resolved
 * here yet — when a library lands, inline `recipe` still wins.
 *
 * This is a pure scene-model resolver: it feeds the effect-filter adapter the
 * same recipe for canvas, client export, and worker export so the SVG-expressible
 * subset paints identically across all three.
 */
export function resolveNodeRecipe(node: VectorNode): VisualRecipe | null {
	if (!node.recipe) return null;
	return normalizeVisualRecipe(node.recipe);
}

const effectIntentSource = (
	intent: EffectIntent | undefined,
	source: EffectIntentRecipeSource,
): {
	readonly lookGraph: LookGraph | null;
	readonly lookGraphSource: EffectIntentRecipeSource | null;
	readonly visualRecipe: VisualRecipe | null;
	readonly visualRecipeSource: EffectIntentRecipeSource | null;
	readonly effectLayerStack: EffectLayerStack | null;
	readonly effectLayerStackSource: EffectIntentRecipeSource | null;
	readonly influenceRecipe: EffectInfluenceRecipe | null;
	readonly influenceRecipeSource: EffectIntentRecipeSource | null;
} => {
	const normalized = normalizeEffectIntent(intent);
	return {
		lookGraph: normalized?.lookGraph ?? null,
		lookGraphSource: normalized?.lookGraph ? source : null,
		effectLayerStack: normalized?.effectLayerStack ?? null,
		effectLayerStackSource: normalized?.effectLayerStack ? source : null,
		visualRecipe: normalized?.visualRecipe ?? null,
		visualRecipeSource: normalized?.visualRecipe ? source : null,
		influenceRecipe: normalized?.influenceRecipe ?? null,
		influenceRecipeSource: normalized?.influenceRecipe ? source : null,
	};
};

/**
 * Resolves the active frame-level vec-core intent for an artboard. Artboard
 * intent wins over scene intent for each recipe slot independently, giving
 * render/export/motion bridges a frame-first path while preserving scene-wide
 * defaults and node-level recipe fallback.
 */
export function resolveFrameEffectIntent(
	document: SceneDocument,
	artboardId?: string | null,
): ResolvedFrameEffectIntent {
	const artboard =
		findArtboardById(document, artboardId) ?? selectCurrentArtboard(document);
	const sceneIntent = effectIntentSource(document.effectIntent, "scene");
	const artboardIntent = effectIntentSource(artboard.effectIntent, "artboard");

	return {
		artboardId: artboard.id,
		lookGraph: artboardIntent.lookGraph ?? sceneIntent.lookGraph,
		lookGraphSource:
			artboardIntent.lookGraphSource ?? sceneIntent.lookGraphSource,
		effectLayerStack:
			artboardIntent.effectLayerStack ?? sceneIntent.effectLayerStack,
		effectLayerStackSource:
			artboardIntent.effectLayerStackSource ??
			sceneIntent.effectLayerStackSource,
		visualRecipe: artboardIntent.visualRecipe ?? sceneIntent.visualRecipe,
		visualRecipeSource:
			artboardIntent.visualRecipeSource ?? sceneIntent.visualRecipeSource,
		influenceRecipe:
			artboardIntent.influenceRecipe ?? sceneIntent.influenceRecipe,
		influenceRecipeSource:
			artboardIntent.influenceRecipeSource ?? sceneIntent.influenceRecipeSource,
	};
}

/**
 * Resolves the active frame-level Look as a graph-first {@link LookGraph}. The
 * explicit `lookGraph` wins; otherwise the resolved `effectLayerStack` projects
 * to a serial graph; otherwise the resolved legacy `visualRecipe` projects to
 * `Source -> Glow -> Grain -> Grade -> Output`. Per-slot artboard-over-scene
 * precedence is honored before projection, and generated node/port ids are
 * stable for the artboard owner. Returns `null` when the frame carries no Look.
 */
export function resolveFrameLookGraph(
	document: SceneDocument,
	artboardId?: string | null,
): LookGraph | null {
	const resolved = resolveFrameEffectIntent(document, artboardId);
	const owner: EffectLayerOwnerRef = {
		scope: "artboard",
		artboardId: resolved.artboardId,
	};
	return (
		lookGraphFromIntent(
			{
				...(resolved.lookGraph ? { lookGraph: resolved.lookGraph } : {}),
				...(resolved.effectLayerStack
					? { effectLayerStack: resolved.effectLayerStack }
					: {}),
				...(resolved.visualRecipe
					? { visualRecipe: resolved.visualRecipe }
					: {}),
				...(resolved.influenceRecipe
					? { influenceRecipe: resolved.influenceRecipe }
					: {}),
			},
			owner,
		) ?? null
	);
}

/** Reports whether the resolved frame Look owns a `path-blur` node. */
export function frameHasPathBlurNode(
	document: SceneDocument,
	artboardId: string,
): boolean {
	const graph = resolveFrameLookGraph(document, artboardId);
	return !!graph?.nodes.some((node) => node.payload.kind === "path-blur");
}

/**
 * Resolves a node's effective look with frame-level intent taking priority over
 * the legacy node-level `recipe`. This is the compatibility path O6/O7 can use
 * when an artboard look should style the whole frame before per-node fallback.
 */
export function resolveEffectiveNodeRecipe(
	document: SceneDocument,
	node: VectorNode,
): VisualRecipe | null {
	const artboardId =
		selectArtboardIdForNode(document, node.id) ??
		selectCurrentArtboard(document).id;
	return (
		resolveFrameEffectIntent(document, artboardId).visualRecipe ??
		resolveNodeRecipe(node)
	);
}
