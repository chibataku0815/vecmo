/**
 * Shared primitives between the frame Look/graph and Noise Gradient inspector editing
 * modules only. Deliberately NOT re-exported by the `editing.ts` barrel — unlike
 * `editing-shared.ts`, these two helpers are internal wiring between
 * `frame-look-editing.ts` and `noise-gradient-editing.ts` and were never part of the
 * public inspector editing surface.
 */
import {
	findNode,
	flattenRenderableNodes,
	selectArtboardIdForNode,
} from "@/entities/scene/model/selectors";
import type { SceneDocument, VectorNode } from "@/entities/scene/model/types";
import {
	NEUTRAL_VISUAL_RECIPE,
	normalizeVisualRecipe,
	type VisualRecipe,
} from "@/shared/vec-core";
import { uniqueNodeIds } from "./editing-shared";

export const recipeForNode = (node: VectorNode): VisualRecipe =>
	normalizeVisualRecipe(node.recipe ?? NEUTRAL_VISUAL_RECIPE);

export const nodeIdsByArtboard = (
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
