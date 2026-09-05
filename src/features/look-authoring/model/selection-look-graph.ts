import type { SceneCommand } from "@/entities/scene/model/command";
import {
	LOOK_GRAPH_SCHEMA_VERSION,
	type LookGraph,
	type LookGraphEdgeDraft,
	type LookGraphEndpoint,
	lookGraphEdgeId,
	lookGraphNodeId,
	lookGraphPortId,
	normalizeLookGraph,
} from "@/entities/scene/model/look-graph";
import {
	createUpdateEffectIntentCommand,
	type UpdateEffectIntentOptions,
} from "@/entities/scene/model/node-commands";
import {
	findArtboardById,
	findNode,
	flattenRenderableNodes,
	selectArtboardIdForNode,
} from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import type {
	Artboard,
	LookGraphScopedEffectLook,
	SceneDocument,
	ScopedEffectLook,
} from "@/entities/scene/model/types";
import {
	createInsertLookGraphStarterCommand,
	createInsertParticleDissolveNodeCommand,
	type FrameLookGraphCommandResult,
	type LookGraphStarterId,
	type ScopedLookGraphTarget,
} from "./look-graph-commands";

export type SelectionLookGraphRecipe =
	| {
			readonly action: "starter";
			readonly id: LookGraphStarterId;
			readonly label: string;
	  }
	| {
			readonly action: "particle-dissolve";
			readonly id: "particle-dissolve";
			readonly label: string;
	  };

export type SelectionLookGraphRecipeState = {
	readonly status: "none" | "partial" | "all";
	readonly selectedCount: number;
	readonly appliedCount: number;
	readonly blockedCount: number;
	readonly canApply: boolean;
};

const SELECTION_LOOK_GRAPH_ID_PREFIX = "selection-look-graph";

const uniqueNodeIds = (nodeIds: readonly string[]): readonly string[] => [
	...new Set(nodeIds),
];

const sameSerializable = (left: unknown, right: unknown): boolean =>
	JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

const applyCommandsAsTransaction = (
	scope: string,
	label: string,
	commands: readonly SceneCommand[],
	coalesceKey?: string,
): boolean => {
	const store = useSceneStore.getState();
	const before = store.document;
	store.beginTransaction(coalesceKey ?? scope, label);
	for (const command of commands) {
		useSceneStore.getState().apply(command);
	}
	useSceneStore.getState().commit();
	return useSceneStore.getState().document !== before;
};

const selectionLookGraphScopedLookId = (
	recipe: SelectionLookGraphRecipe,
): string => `${SELECTION_LOOK_GRAPH_ID_PREFIX}:${recipe.id}`;

const graphImageEndpoint = (
	nodeId: string,
	direction: "input" | "output",
): LookGraphEndpoint => ({
	nodeId,
	portId: lookGraphPortId(nodeId, direction, "image"),
});

const graphImageEdge = (
	fromNodeId: string,
	toNodeId: string,
): LookGraphEdgeDraft => {
	const from = graphImageEndpoint(fromNodeId, "output");
	const to = graphImageEndpoint(toNodeId, "input");
	return { id: lookGraphEdgeId(from, to), from, to };
};

const baseSelectionLookGraph = (
	artboardId: string,
	scopedLookId: string,
): LookGraph | null => {
	const owner = {
		scope: "scoped-overlay",
		artboardId,
		scopedLookId,
	} as const;
	const sourceId = lookGraphNodeId(owner, "source");
	const outputId = lookGraphNodeId(owner, "output");
	return (
		normalizeLookGraph({
			schemaVersion: LOOK_GRAPH_SCHEMA_VERSION,
			outputNodeId: outputId,
			nodes: [
				{ id: sourceId, kind: "source", payload: { kind: "source" } },
				{ id: outputId, kind: "output", payload: { kind: "output" } },
			],
			edges: [graphImageEdge(sourceId, outputId)],
		}) ?? null
	);
};

const selectionLookGraphOverlay = ({
	graph,
	recipe,
	targetNodeIds,
}: {
	readonly graph: LookGraph;
	readonly recipe: SelectionLookGraphRecipe;
	readonly targetNodeIds: readonly string[];
}): LookGraphScopedEffectLook => ({
	id: selectionLookGraphScopedLookId(recipe),
	kind: "look-graph-overlay",
	source: "selection-look-graph",
	lookGraph: graph,
	targetNodeIds,
});

const isSelectionLookGraphOverlay = (
	look: ScopedEffectLook,
): look is LookGraphScopedEffectLook =>
	look.kind === "look-graph-overlay" && look.source === "selection-look-graph";

const documentWithSelectionLookGraphOverlay = (
	document: SceneDocument,
	artboardId: string,
	overlay: LookGraphScopedEffectLook,
): SceneDocument => {
	const patchArtboard = (artboard: Artboard): Artboard => {
		if (artboard.id !== artboardId) return artboard;
		const scopedLooks = [
			...(artboard.effectIntent?.scopedLooks ?? []).filter(
				(look) => look.id !== overlay.id,
			),
			overlay,
		];
		return {
			...artboard,
			effectIntent: {
				...artboard.effectIntent,
				scopedLooks,
			},
		};
	};
	return {
		...document,
		artboard: patchArtboard(document.artboard),
		...(document.artboards
			? { artboards: document.artboards.map(patchArtboard) }
			: {}),
	};
};

const graphFromResult = (
	result: FrameLookGraphCommandResult,
): LookGraph | null => {
	switch (result.kind) {
		case "ready":
		case "unchanged":
			return result.graph;
		default:
			return null;
	}
};

const selectionLookGraphForRecipe = (
	document: SceneDocument,
	artboardId: string,
	recipe: SelectionLookGraphRecipe,
): LookGraph | null => {
	const scopedLookId = selectionLookGraphScopedLookId(recipe);
	const baseGraph = baseSelectionLookGraph(artboardId, scopedLookId);
	if (!baseGraph) return null;
	const baseOverlay = selectionLookGraphOverlay({
		graph: baseGraph,
		recipe,
		targetNodeIds: [],
	});
	const target: ScopedLookGraphTarget = {
		scope: "scoped-overlay",
		artboardId,
		scopedLookId,
	};
	const syntheticDocument = documentWithSelectionLookGraphOverlay(
		document,
		artboardId,
		baseOverlay,
	);
	const result =
		recipe.action === "starter"
			? createInsertLookGraphStarterCommand(
					syntheticDocument,
					target,
					recipe.id,
					{ label: recipe.label },
				)
			: createInsertParticleDissolveNodeCommand(syntheticDocument, target, {
					label: recipe.label,
				});
	return graphFromResult(result);
};

const nodeIdsByArtboard = (
	document: SceneDocument,
	nodeIds: readonly string[],
): ReadonlyMap<string, readonly string[]> => {
	const nodeOrder = new Map(
		flattenRenderableNodes(document).map(({ node }, index) => [node.id, index]),
	);
	const idsByArtboard = new Map<string, string[]>();
	for (const nodeId of [...uniqueNodeIds(nodeIds)].sort(
		(left, right) =>
			(nodeOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
			(nodeOrder.get(right) ?? Number.MAX_SAFE_INTEGER),
	)) {
		const node = findNode(document, nodeId);
		if (!node) continue;
		const artboardId = selectArtboardIdForNode(document, node.id);
		if (!artboardId) continue;
		const ids = idsByArtboard.get(artboardId) ?? [];
		ids.push(node.id);
		idsByArtboard.set(artboardId, ids);
	}
	return idsByArtboard;
};

const blockingGraphOverlayTargetIds = (
	scopedLooks: readonly ScopedEffectLook[] | undefined,
): ReadonlySet<string> => {
	const blocked = new Set<string>();
	for (const look of scopedLooks ?? []) {
		if (look.kind !== "look-graph-overlay") continue;
		if (look.source === "selection-look-graph") continue;
		for (const nodeId of look.targetNodeIds) blocked.add(nodeId);
	}
	return blocked;
};

const replaceSelectionLookGraphOverlayTargets = (
	current: readonly ScopedEffectLook[] | undefined,
	overlay: LookGraphScopedEffectLook,
): readonly ScopedEffectLook[] => {
	const nextTargetIds = new Set(overlay.targetNodeIds);
	const nextScopedLooks = (current ?? []).flatMap(
		(look): readonly ScopedEffectLook[] => {
			if (!isSelectionLookGraphOverlay(look)) return [look];
			if (look.id === overlay.id) return [];
			const remainingTargetNodeIds = look.targetNodeIds.filter(
				(nodeId) => !nextTargetIds.has(nodeId),
			);
			return remainingTargetNodeIds.length > 0
				? [{ ...look, targetNodeIds: remainingTargetNodeIds }]
				: [];
		},
	);
	return [...nextScopedLooks, overlay];
};

const selectionLookGraphStateForArtboard = (
	artboard: Artboard,
	nodeIds: readonly string[],
	recipe: SelectionLookGraphRecipe,
): SelectionLookGraphRecipeState => {
	const blockedIds = blockingGraphOverlayTargetIds(
		artboard.effectIntent?.scopedLooks,
	);
	const recipeLookId = selectionLookGraphScopedLookId(recipe);
	const recipeLook = artboard.effectIntent?.scopedLooks?.find(
		(look): look is LookGraphScopedEffectLook =>
			isSelectionLookGraphOverlay(look) && look.id === recipeLookId,
	);
	const recipeTargetIds = new Set(recipeLook?.targetNodeIds ?? []);
	const selectedCount = nodeIds.length;
	const blockedCount = nodeIds.filter((nodeId) =>
		blockedIds.has(nodeId),
	).length;
	const appliedCount = nodeIds.filter((nodeId) =>
		recipeTargetIds.has(nodeId),
	).length;
	const unblockedCount = selectedCount - blockedCount;
	return {
		status:
			appliedCount === 0
				? "none"
				: appliedCount >= unblockedCount
					? "all"
					: "partial",
		selectedCount,
		appliedCount,
		blockedCount,
		canApply: unblockedCount > 0,
	};
};

/**
 * Applies a graph-backed Look recipe as an object-scoped overlay over the
 * selected node ids. Non-selection graph overlays keep ownership of their
 * targets; applying another Object Look replaces previous Object Look
 * ownership for those same targets.
 */
export function commitSelectionLookGraphRecipe(
	nodeIds: readonly string[],
	recipe: SelectionLookGraphRecipe,
): boolean {
	const document = useSceneStore.getState().document;
	const commands = [...nodeIdsByArtboard(document, nodeIds).entries()].flatMap(
		([artboardId, artboardNodeIds]) => {
			const artboard = findArtboardById(document, artboardId);
			if (!artboard) return [];
			const blockedIds = blockingGraphOverlayTargetIds(
				artboard.effectIntent?.scopedLooks,
			);
			const targetNodeIds = artboardNodeIds.filter(
				(nodeId) => !blockedIds.has(nodeId),
			);
			if (targetNodeIds.length === 0) return [];
			const graph = selectionLookGraphForRecipe(document, artboardId, recipe);
			if (!graph) return [];
			const overlay = selectionLookGraphOverlay({
				graph,
				recipe,
				targetNodeIds,
			});
			const scopedLooks = replaceSelectionLookGraphOverlayTargets(
				artboard.effectIntent?.scopedLooks,
				overlay,
			);
			if (sameSerializable(artboard.effectIntent?.scopedLooks, scopedLooks)) {
				return [];
			}
			const options: UpdateEffectIntentOptions = {
				label: recipe.label,
				coalesceKey: `selection-look-graph:${recipe.id}:${artboardId}`,
			};
			return [
				createUpdateEffectIntentCommand(
					{ scope: "artboard", artboardId },
					{ scopedLooks },
					options,
				),
			];
		},
	);
	if (commands.length === 0) return false;
	return applyCommandsAsTransaction(
		`selection-look-graph:${recipe.id}:${uniqueNodeIds(nodeIds).join(",")}`,
		recipe.label,
		commands,
	);
}

/**
 * Removes one graph-backed Object Look recipe from the selected node ids while
 * preserving other scoped looks and other targets still owned by that recipe.
 */
export function commitRemoveSelectionLookGraphRecipe(
	nodeIds: readonly string[],
	recipe: SelectionLookGraphRecipe,
): boolean {
	const document = useSceneStore.getState().document;
	const scopedLookId = selectionLookGraphScopedLookId(recipe);
	const commands = [...nodeIdsByArtboard(document, nodeIds).entries()].flatMap(
		([artboardId, artboardNodeIds]) => {
			const artboard = findArtboardById(document, artboardId);
			const scopedLooks = artboard?.effectIntent?.scopedLooks;
			if (!artboard || !scopedLooks?.length) return [];

			const selectedIds = new Set(artboardNodeIds);
			let changed = false;
			const nextScopedLooks = scopedLooks.flatMap(
				(look): readonly ScopedEffectLook[] => {
					if (!isSelectionLookGraphOverlay(look) || look.id !== scopedLookId) {
						return [look];
					}
					const remainingTargetNodeIds = look.targetNodeIds.filter(
						(nodeId) => !selectedIds.has(nodeId),
					);
					if (remainingTargetNodeIds.length === look.targetNodeIds.length) {
						return [look];
					}
					changed = true;
					return remainingTargetNodeIds.length > 0
						? [{ ...look, targetNodeIds: remainingTargetNodeIds }]
						: [];
				},
			);

			if (!changed) return [];
			return [
				createUpdateEffectIntentCommand(
					{ scope: "artboard", artboardId },
					{ scopedLooks: nextScopedLooks.length > 0 ? nextScopedLooks : null },
					{
						label: `Remove ${recipe.label}`,
						coalesceKey: `selection-look-graph-remove:${recipe.id}:${artboardId}`,
					},
				),
			];
		},
	);
	if (commands.length === 0) return false;
	return applyCommandsAsTransaction(
		`selection-look-graph-remove:${recipe.id}:${uniqueNodeIds(nodeIds).join(",")}`,
		`Remove ${recipe.label}`,
		commands,
	);
}

/**
 * Reads whether the current selection already has a graph-backed Object Look
 * recipe, and whether non-selection graph overlays block applying it.
 */
export function selectionLookGraphRecipeStateForSelection(
	document: SceneDocument,
	nodeIds: readonly string[],
	recipe: SelectionLookGraphRecipe,
): SelectionLookGraphRecipeState {
	let selectedCount = 0;
	let appliedCount = 0;
	let blockedCount = 0;
	for (const [artboardId, artboardNodeIds] of nodeIdsByArtboard(
		document,
		nodeIds,
	)) {
		const artboard = findArtboardById(document, artboardId);
		if (!artboard) continue;
		const state = selectionLookGraphStateForArtboard(
			artboard,
			artboardNodeIds,
			recipe,
		);
		selectedCount += state.selectedCount;
		appliedCount += state.appliedCount;
		blockedCount += state.blockedCount;
	}
	const unblockedCount = selectedCount - blockedCount;
	return {
		status:
			appliedCount === 0
				? "none"
				: appliedCount >= unblockedCount
					? "all"
					: "partial",
		selectedCount,
		appliedCount,
		blockedCount,
		canApply: unblockedCount > 0,
	};
}

/**
 * Returns the scoped graph owner that should be opened after applying an Object
 * Look recipe to the current selection. Multi-artboard selections create one
 * overlay per artboard; the first selected artboard is the least surprising
 * workspace target.
 */
export function selectionLookGraphWorkspaceTargetForSelection(
	document: SceneDocument,
	nodeIds: readonly string[],
	recipe: SelectionLookGraphRecipe,
): ScopedLookGraphTarget | null {
	const scopedLookId = selectionLookGraphScopedLookId(recipe);
	for (const [artboardId, artboardNodeIds] of nodeIdsByArtboard(
		document,
		nodeIds,
	)) {
		const artboard = findArtboardById(document, artboardId);
		const scopedLook = artboard?.effectIntent?.scopedLooks?.find(
			(look): look is LookGraphScopedEffectLook =>
				isSelectionLookGraphOverlay(look) && look.id === scopedLookId,
		);
		if (
			scopedLook?.targetNodeIds.some((nodeId) =>
				artboardNodeIds.includes(nodeId),
			)
		) {
			return { scope: "scoped-overlay", artboardId, scopedLookId };
		}
	}
	return null;
}
