import { castDraft } from "immer";
import type { SceneCommand } from "@/entities/scene/model/command";
import { useSceneStore } from "@/entities/scene/model/store";
import type { VectorNode } from "@/entities/scene/model/types";

const ADD_NODE_TYPE = "draw/add-node";

/**
 * Command that appends an already-minted node to a layer. The default target is
 * the last (top-most rendered) layer so freshly drawn shapes land above the
 * existing scene. The coalesce key embeds the node id, which is unique per
 * creation, so each drawn node is its own undo entry and never merges with a
 * neighboring gesture (unlike the transform writer's per-node key).
 *
 * Geometry only ever enters the document through this command bus path, keeping
 * the scene model the single source of truth.
 */
export function createAddNodeCommand(
	node: VectorNode,
	options: { readonly layerId?: string } = {},
): SceneCommand {
	return {
		type: ADD_NODE_TYPE,
		label: "Add node",
		coalesceKey: `${ADD_NODE_TYPE}:${node.id}`,
		run: (draft) => {
			if (draft.layers.length === 0) return;
			const target = options.layerId
				? draft.layers.find((layer) => layer.id === options.layerId)
				: draft.layers[draft.layers.length - 1];
			if (!target) return;
			target.nodes.push(castDraft(node));
		},
	};
}

/**
 * Dispatches {@link createAddNodeCommand} through the scene command bus and
 * reports whether the node was actually inserted. The store only swaps the
 * document reference when the command emits patches, so a reference change is a
 * reliable inserted-flag — false only when every candidate layer is missing
 * (e.g. an explicit `layerId` that does not exist, or a document with no
 * layers). Callers gate post-insert side effects (selection, tool switch) on it.
 */
export function addNode(
	node: VectorNode,
	options?: { readonly layerId?: string },
): boolean {
	const before = useSceneStore.getState().document;
	useSceneStore.getState().apply(createAddNodeCommand(node, options));
	return useSceneStore.getState().document !== before;
}
