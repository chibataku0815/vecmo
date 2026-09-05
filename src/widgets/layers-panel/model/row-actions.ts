import type { SceneCommand } from "@/entities/scene/model/command";
import {
	createRenameLayerCommand,
	createRenameNodeCommand,
} from "@/entities/scene/model/node-commands";
import type {
	SceneDocument,
	SceneLayer,
	VectorNode,
} from "@/entities/scene/model/types";
import { buildFocusArtboardRowCommand } from "@/features/artboard";
import {
	buildMoveLayerRowCommand,
	buildMoveNodeRowCommand,
	planToggleLayerLockedAction,
	planToggleLayerVisibilityAction,
} from "@/features/layer-hierarchy";
import {
	planReleaseNodeMaskStructureAction,
	planSelectedObjectActions,
	planUseNodeAsMaskStructureAction,
	type SelectedObjectUndoPlan,
} from "@/features/structure-actions";
import { createRenameArtboardRowCommand } from "./artboard-actions";
import type { MoveDirection } from "./reorder";
import type {
	ArtboardLayerPanelRow,
	LayerPanelArtboardRow,
	LayerPanelNodeRow,
} from "./rows";

export type LayerPanelRenameTarget = {
	readonly kind: "artboard" | "layer" | "node";
	readonly id: string;
	readonly value: string;
	readonly originalValue: string;
};

export type LayerPanelSelectionSnapshot = {
	readonly nodeIds: readonly string[];
	readonly primaryNodeId?: string | null;
};

export type LayerPanelSelectionPlan = {
	readonly nodeIds: readonly string[];
	readonly primaryNodeId: string | null;
};

export type LayerPanelSelectionCleanupPlan = LayerPanelSelectionPlan & {
	readonly removedNodeIds: readonly string[];
};

export type LayerPanelCommandSelectionPlan = {
	readonly command: SceneCommand;
	readonly selection: LayerPanelSelectionPlan | null;
};

export type LayerPanelNodeVisibilityPlan = {
	readonly commands: readonly SceneCommand[];
	readonly transaction: SelectedObjectUndoPlan;
	readonly hiddenSelection: LayerPanelSelectionCleanupPlan | null;
};

export type LayerPanelNodeLockedPlan = {
	readonly commands: readonly SceneCommand[];
	readonly transaction: SelectedObjectUndoPlan;
};

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
): LayerPanelSelectionPlan => {
	const unique = uniqueNodeIds(nodeIds);
	return {
		nodeIds: unique,
		primaryNodeId: primaryForSelection(unique, primaryNodeId),
	};
};

/**
 * Removes document-structure descendants from a panel selection snapshot without
 * reading global stores. Callers get an explicit primary fallback so hiding or
 * deleting rows cannot leave primary selection pointing at a removed node.
 */
export function cleanupLayerPanelRowSelection(
	selection: LayerPanelSelectionSnapshot,
	removeNodeIds: readonly string[],
): LayerPanelSelectionCleanupPlan | null {
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
 * Plans a row-level artboard focus gesture, including additive whole-artboard
 * selection toggling. The focus command remains undoable, while selection stays
 * an explicit UI plan owned by the Layers document-structure surface.
 */
export function planFocusArtboardRowAction(
	row: LayerPanelArtboardRow,
	selection: LayerPanelSelectionSnapshot,
	options: { readonly additive: boolean },
): LayerPanelCommandSelectionPlan {
	const plan = buildFocusArtboardRowCommand({
		artboardId: row.artboardId,
		subtreeNodeIds: row.subtreeNodeIds,
		selection,
		additive: options.additive,
	});
	return {
		command: plan.command,
		selection: plan.selection,
	};
}

/**
 * Converts inline rename state into the matching scene command. It centralizes
 * empty/no-op guards for artboard, layer, and node rows so the React tree does
 * not own three subtly different rename paths.
 */
export function createLayerPanelRenameCommand(
	rows: readonly ArtboardLayerPanelRow[],
	target: LayerPanelRenameTarget,
): SceneCommand | null {
	const name = target.value.trim();
	if (name.length === 0 || name === target.originalValue) return null;

	if (target.kind === "artboard") {
		const row = rows.find(
			(candidate) =>
				candidate.kind === "artboard" && candidate.artboardId === target.id,
		);
		return row?.kind === "artboard"
			? createRenameArtboardRowCommand(row, name)
			: null;
	}

	if (target.kind === "layer") {
		return createRenameLayerCommand(target.id, name);
	}

	return createRenameNodeCommand(target.id, name);
}

/**
 * Plans a layer visibility toggle and the selection cleanup required when the
 * row hides a whole layer subtree. Lock toggles intentionally preserve selection.
 */
export function planToggleLayerVisibilityRowAction(
	layer: SceneLayer,
	selection: LayerPanelSelectionSnapshot,
): LayerPanelCommandSelectionPlan & { readonly nextVisible: boolean } {
	return planToggleLayerVisibilityAction(layer, selection);
}

/** Creates the row-level layer lock command; selection stays intact by design. */
export function createToggleLayerLockedRowCommand(
	layer: SceneLayer,
): SceneCommand {
	return planToggleLayerLockedAction(layer).command;
}

/**
 * Resolves a one-step layer reorder command from the current layer array. Stale
 * ids and edge rows return null so the panel cannot create inert history.
 */
export function createMoveLayerRowCommand(
	layers: readonly SceneLayer[],
	layerId: string,
	direction: MoveDirection,
): SceneCommand | null {
	return buildMoveLayerRowCommand(layers, layerId, direction);
}

/**
 * Resolves a top-level node reorder command within a layer. Nested row movement
 * stays blocked until parent-aware reparenting has its own command contract.
 */
export function createMoveNodeRowCommand(
	layers: readonly SceneLayer[],
	layerId: string,
	nodeId: string,
	direction: MoveDirection,
): SceneCommand | null {
	return buildMoveNodeRowCommand(layers, layerId, nodeId, direction);
}

/**
 * Plans the row-level node visibility operation through the shared
 * selected-object spine. Selection cleanup stays panel-local because deleting or
 * hiding an unselected row must not replace the user's current selection.
 */
export function planToggleNodeVisibilityRowAction(
	document: SceneDocument,
	node: VectorNode,
	selection: LayerPanelSelectionSnapshot,
): LayerPanelNodeVisibilityPlan | null {
	const plan = planSelectedObjectActions({
		document,
		selectedNodeIds: [node.id],
		primaryNodeId: node.id,
	}).toggleVisibility;
	if (!plan.enabled || plan.execution.kind !== "scene-commands") return null;
	const hiddenSelection =
		plan.nextSelection.kind === "clear"
			? cleanupLayerPanelRowSelection(selection, collectNodeIds([node]))
			: null;
	return {
		commands: plan.execution.commands,
		transaction: plan.execution.transaction,
		hiddenSelection,
	};
}

/** Plans node-row lock through the same selected-object spine as global lock. */
export function planToggleNodeLockedRowAction(
	document: SceneDocument,
	node: VectorNode,
): LayerPanelNodeLockedPlan | null {
	const plan = planSelectedObjectActions({
		document,
		selectedNodeIds: [node.id],
		primaryNodeId: node.id,
	}).toggleLock;
	if (!plan.enabled || plan.execution.kind !== "scene-commands") return null;
	return {
		commands: plan.execution.commands,
		transaction: plan.execution.transaction,
	};
}

/**
 * Plans a "Use as Mask" gesture from a node row: the row's node becomes the mask
 * source and every OTHER selected node becomes masked content (Figma/Illustrator
 * "make clipping mask"). The command enforces sibling/top-level/editable scope, so
 * a cross-layer or stale selection is safely narrowed. Returns null when no other
 * node is selected, so the panel never offers an inert action.
 */
export function planUseRowAsMaskAction(
	row: LayerPanelNodeRow,
	selection: LayerPanelSelectionSnapshot,
): SceneCommand | null {
	return planUseNodeAsMaskStructureAction(row.nodeId, selection.nodeIds);
}

/**
 * Plans a "Release Mask" gesture on a mask-source row: removes every native
 * relation that targets the row's node so the source paints normally again and its
 * content renders unclipped. A no-op command (no history) when nothing references
 * the source, so it is safe to offer on any row the panel marks as a mask source.
 */
export function planReleaseRowMaskAction(row: LayerPanelNodeRow): SceneCommand {
	return planReleaseNodeMaskStructureAction(row.nodeId);
}

/**
 * Plans a destructive node-row action through the shared selected-object delete
 * planner while keeping the row panel's current-selection cleanup local to the
 * panel surface.
 */
export function planDeleteNodeRowAction(
	document: SceneDocument,
	row: LayerPanelNodeRow,
	selection: LayerPanelSelectionSnapshot,
): LayerPanelCommandSelectionPlan | null {
	const plan = planSelectedObjectActions({
		document,
		selectedNodeIds: [row.nodeId],
		primaryNodeId: row.nodeId,
	}).delete;
	if (!plan.enabled || plan.execution.kind !== "scene-command") return null;
	return {
		command: plan.execution.command,
		selection: cleanupLayerPanelRowSelection(selection, row.subtreeNodeIds),
	};
}
