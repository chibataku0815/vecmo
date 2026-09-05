import type { SceneCommand } from "@/entities/scene/model/command";
import {
	createReorderLayerCommand,
	createReorderNodeWithinLayerCommand,
	createReparentNodesCommand,
	createSetLayerLockedCommand,
	createSetLayerVisibilityCommand,
} from "@/entities/scene/model/node-commands";
import {
	type ReparentTarget,
	resolveInsertIndex,
} from "@/entities/scene/model/reparent";
import type { SceneLayer, VectorNode } from "@/entities/scene/model/types";

export type LayerHierarchySelectionSnapshot = {
	readonly nodeIds: readonly string[];
	readonly primaryNodeId?: string | null;
};

export type LayerHierarchySelectionPlan = {
	readonly nodeIds: readonly string[];
	readonly primaryNodeId: string | null;
};

export type LayerHierarchySelectionCleanupPlan = LayerHierarchySelectionPlan & {
	readonly removedNodeIds: readonly string[];
};

export type LayerHierarchyCommandSelectionPlan = {
	readonly command: SceneCommand;
	readonly selection: LayerHierarchySelectionPlan | null;
};

export type LayerHierarchyLayerVisibilityPlan =
	LayerHierarchyCommandSelectionPlan & {
		readonly nextVisible: boolean;
	};

export type LayerHierarchyLayerLockedPlan = {
	readonly command: SceneCommand;
	readonly nextLocked: boolean;
};

export type LayerHierarchyMoveDirection = "up" | "down";
export type LayerHierarchyDropPlacement = "before" | "after";

const collectNodeIds = (
	nodes: readonly VectorNode[],
	output: string[] = [],
): string[] => {
	for (const node of nodes) {
		output.push(node.id);
		if (node.children) collectNodeIds(node.children, output);
	}
	return output;
};

const uniqueNodeIds = (nodeIds: readonly string[]): readonly string[] => [
	...new Set(nodeIds),
];

const primaryForSelection = (
	nodeIds: readonly string[],
	primaryNodeId: string | null | undefined,
): string | null => {
	if (primaryNodeId && nodeIds.includes(primaryNodeId)) return primaryNodeId;
	return nodeIds.at(-1) ?? null;
};

const selectionPlan = (
	nodeIds: readonly string[],
	primaryNodeId?: string | null,
): LayerHierarchySelectionPlan => {
	const unique = uniqueNodeIds(nodeIds);
	return {
		nodeIds: unique,
		primaryNodeId: primaryForSelection(unique, primaryNodeId),
	};
};

/**
 * Resolves the target sibling index for a one-step hierarchy reorder action.
 * Returning null keeps stale row state, edge rows, and missing ids from creating
 * no-op command history entries.
 */
export function layerHierarchyMoveTargetIndex(
	fromIndex: number,
	length: number,
	direction: LayerHierarchyMoveDirection,
): number | null {
	if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= length) {
		return null;
	}

	const toIndex = direction === "up" ? fromIndex - 1 : fromIndex + 1;
	return toIndex >= 0 && toIndex < length ? toIndex : null;
}

/** Finds the command target index for moving a top-level layer by one row. */
export function layerHierarchyLayerMoveTargetIndex(
	layers: readonly SceneLayer[],
	layerId: string,
	direction: LayerHierarchyMoveDirection,
): number | null {
	return layerHierarchyMoveTargetIndex(
		layers.findIndex((layer) => layer.id === layerId),
		layers.length,
		direction,
	);
}

/**
 * Finds the command target index for moving a node within its current sibling
 * array. Callers choose the sibling array so this helper does not invent
 * parent/child reorder semantics.
 */
export function layerHierarchyNodeMoveTargetIndex(
	nodes: readonly VectorNode[],
	nodeId: string,
	direction: LayerHierarchyMoveDirection,
): number | null {
	return layerHierarchyMoveTargetIndex(
		nodes.findIndex((node) => node.id === nodeId),
		nodes.length,
		direction,
	);
}

/**
 * Removes hidden/deleted descendants from a layer-hierarchy selection snapshot
 * without reading UI stores. Layer surfaces can apply the returned plan to keep
 * primary selection from pointing into a subtree that is no longer selectable.
 */
export function cleanupLayerHierarchySelection(
	selection: LayerHierarchySelectionSnapshot,
	removeNodeIds: readonly string[],
): LayerHierarchySelectionCleanupPlan | null {
	const removed = new Set(removeNodeIds);
	if (removed.size === 0) return null;
	const nodeIds = uniqueNodeIds(selection.nodeIds).filter(
		(nodeId) => !removed.has(nodeId),
	);
	if (nodeIds.length === uniqueNodeIds(selection.nodeIds).length) return null;

	return {
		...selectionPlan(nodeIds, selection.primaryNodeId),
		removedNodeIds: selection.nodeIds.filter((nodeId) => removed.has(nodeId)),
	};
}

/**
 * Plans a layer-row visibility toggle, including the selection cleanup required
 * when hiding a whole layer subtree. The command stays store-free and undoable;
 * UI surfaces decide how to apply the selection plan.
 */
export function planToggleLayerVisibilityAction(
	layer: SceneLayer,
	selection: LayerHierarchySelectionSnapshot,
): LayerHierarchyLayerVisibilityPlan {
	const nextVisible = !layer.visible;
	return {
		command: createSetLayerVisibilityCommand(layer.id, nextVisible),
		selection: nextVisible
			? null
			: cleanupLayerHierarchySelection(selection, collectNodeIds(layer.nodes)),
		nextVisible,
	};
}

/** Plans a layer-row lock toggle. Locking preserves node selection by design. */
export function planToggleLayerLockedAction(
	layer: SceneLayer,
): LayerHierarchyLayerLockedPlan {
	const nextLocked = !layer.locked;
	return {
		command: createSetLayerLockedCommand(layer.id, nextLocked),
		nextLocked,
	};
}

/**
 * Resolves a one-step layer reorder command from the current layer array. Stale
 * ids and edge rows return null so hierarchy surfaces cannot create inert
 * history entries.
 */
export function buildMoveLayerRowCommand(
	layers: readonly SceneLayer[],
	layerId: string,
	direction: LayerHierarchyMoveDirection,
): SceneCommand | null {
	const targetIndex = layerHierarchyLayerMoveTargetIndex(
		layers,
		layerId,
		direction,
	);
	if (targetIndex === null) return null;
	return createReorderLayerCommand(layerId, targetIndex);
}

/**
 * Resolves a top-level node reorder command within a layer. Nested row movement
 * stays blocked until parent-aware reparenting has its own command contract.
 */
export function buildMoveNodeRowCommand(
	layers: readonly SceneLayer[],
	layerId: string,
	nodeId: string,
	direction: LayerHierarchyMoveDirection,
): SceneCommand | null {
	const layer = layers.find((item) => item.id === layerId);
	if (!layer) return null;
	const targetIndex = layerHierarchyNodeMoveTargetIndex(
		layer.nodes,
		nodeId,
		direction,
	);
	if (targetIndex === null) return null;
	return createReorderNodeWithinLayerCommand(layerId, nodeId, targetIndex);
}

/**
 * Converts a resolved layer-row drop into a reorder command. Pointer geometry
 * and indicator rendering stay in the Widget hook; the hierarchy feature owns
 * stale-id, self-drop, and final insert-index semantics.
 */
export function buildDropLayerRowCommand(
	layers: readonly SceneLayer[],
	grabbedLayerId: string,
	hoveredLayerId: string,
	placement: LayerHierarchyDropPlacement,
): SceneCommand | null {
	if (grabbedLayerId === hoveredLayerId) return null;
	const fromIndex = layers.findIndex((layer) => layer.id === grabbedLayerId);
	const hoveredIndex = layers.findIndex((layer) => layer.id === hoveredLayerId);
	if (fromIndex < 0 || hoveredIndex < 0) return null;
	const gapIndex = hoveredIndex + (placement === "after" ? 1 : 0);
	const finalIndex = resolveInsertIndex(
		gapIndex,
		[fromIndex],
		layers.length - 1,
	);
	if (finalIndex === fromIndex) return null;
	return createReorderLayerCommand(grabbedLayerId, finalIndex);
}

/**
 * Converts a validated node drop target into the command-bus mutation. Drop
 * legality remains checked by the row resolver for UX feedback and is reasserted
 * by the entity command as the trust boundary.
 */
export function buildReparentNodeDropCommand(
	nodeIds: readonly string[],
	target: ReparentTarget,
): SceneCommand | null {
	if (nodeIds.length === 0) return null;
	return createReparentNodesCommand(nodeIds, target);
}
