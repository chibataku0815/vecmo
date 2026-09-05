import {
	type Matrix2D,
	transformFromMatrix,
} from "@/entities/scene/model/rendering";
import { findLayerByNodeId, findNode } from "@/entities/scene/model/selectors";
import type { SceneDocument, VectorNode } from "@/entities/scene/model/types";

/** One node's would-be matrix at the current drag position. */
export type NodeMatrixPatch = {
	readonly nodeId: string;
	readonly matrix: Matrix2D;
};

/**
 * Pure per-move override computation for a live node transform drag
 * (move/resize/rotate). `baseDocument` must be the gesture's PRE-DRAG
 * document — every patch carries an absolute-from-gesture-start matrix (the
 * `applyDrag` snapshots in `canvas/handler.ts` are captured once at gesture
 * start, and every move recomputes the full matrix from them), so recomputing
 * against anything other than the start snapshot would double-apply the
 * transform.
 *
 * Mirrors the guard in `createUpdateNodeTransformCommand`
 * (`entities/scene/model/node-commands.ts`) exactly: a node in a hidden or
 * locked layer, or itself hidden or locked, is skipped so the transient
 * preview never shows a move the eventual scene-store write would reject.
 */
export function computeLiveTransformOverrides(
	baseDocument: SceneDocument,
	patches: readonly NodeMatrixPatch[],
): ReadonlyMap<string, VectorNode> {
	const overrides = new Map<string, VectorNode>();
	for (const patch of patches) {
		const node = findNode(baseDocument, patch.nodeId);
		if (!node) continue;
		const layer = findLayerByNodeId(baseDocument, patch.nodeId);
		if (!layer?.visible || layer.locked || !node.visible || node.locked) {
			continue;
		}
		overrides.set(patch.nodeId, {
			...node,
			transform: transformFromMatrix(patch.matrix, node.transform.anchor),
		});
	}
	return overrides;
}

/**
 * Resolves the node a mid-drag reader (selection chrome, canvas node) should
 * draw: the live override if the gesture is currently touching it, else the
 * committed document node.
 */
export function effectiveNode(
	baseDocument: SceneDocument,
	overrides: ReadonlyMap<string, VectorNode> | null | undefined,
	nodeId: string,
): VectorNode | undefined {
	return overrides?.get(nodeId) ?? findNode(baseDocument, nodeId);
}
