import {
	createSetNodeLockedCommand,
	createSetNodeVisibilityCommand,
} from "@/entities/scene/model/node-commands";
import { findNode } from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import type { SceneDocument, VectorNode } from "@/entities/scene/model/types";

let toggleSequence = 0;

const resolveNodes = (
	document: SceneDocument,
	nodeIds: readonly string[],
): readonly VectorNode[] =>
	[...new Set(nodeIds)].flatMap((nodeId) => {
		const node = findNode(document, nodeId);
		return node ? [node] : [];
	});

/**
 * Target lock state for a unified toggle: lock everything unless the whole set
 * is already locked, in which case unlock. A single-node selection therefore
 * inverts that node, matching the per-row Layers panel button.
 */
export function resolveToggleLockTarget(nodes: readonly VectorNode[]): boolean {
	return !nodes.every((node) => node.locked);
}

/** Visibility twin of {@link resolveToggleLockTarget}; reveals when any node is hidden. */
export function resolveToggleVisibilityTarget(
	nodes: readonly VectorNode[],
): boolean {
	return !nodes.every((node) => node.visible);
}

/**
 * Toggles the lock state of the resolvable nodes to one unified value as a single
 * undoable transaction. Returns whether the document changed so callers can skip
 * empty history for missing-only selections.
 */
export function commitToggleNodeLocked(nodeIds: readonly string[]): boolean {
	const before = useSceneStore.getState().document;
	const nodes = resolveNodes(before, nodeIds);
	if (nodes.length === 0) return false;

	const target = resolveToggleLockTarget(nodes);
	const label = target ? "Lock nodes" : "Unlock nodes";
	useSceneStore
		.getState()
		.beginTransaction(`toggle-lock:${toggleSequence++}`, label);
	for (const node of nodes) {
		useSceneStore.getState().apply(createSetNodeLockedCommand(node.id, target));
	}
	useSceneStore.getState().commit();
	return useSceneStore.getState().document !== before;
}

/**
 * Toggles node visibility to one unified value as a single undoable transaction.
 * Returns the applied visibility (or null when nothing changed) so the caller can
 * drop newly hidden nodes from the selection like the Layers panel does.
 */
export function commitToggleNodeVisibility(
	nodeIds: readonly string[],
): boolean | null {
	const before = useSceneStore.getState().document;
	const nodes = resolveNodes(before, nodeIds);
	if (nodes.length === 0) return null;

	const target = resolveToggleVisibilityTarget(nodes);
	const label = target ? "Show nodes" : "Hide nodes";
	useSceneStore
		.getState()
		.beginTransaction(`toggle-visibility:${toggleSequence++}`, label);
	for (const node of nodes) {
		useSceneStore
			.getState()
			.apply(createSetNodeVisibilityCommand(node.id, target));
	}
	useSceneStore.getState().commit();
	return useSceneStore.getState().document === before ? null : target;
}
