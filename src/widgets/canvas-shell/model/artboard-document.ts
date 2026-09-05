import type { NormalizedArtboard } from "@/entities/scene/model/selectors";
import type {
	SceneDocument,
	SceneLayer,
	VectorNode,
} from "@/entities/scene/model/types";

const filterNodesForArtboard = (
	nodes: readonly VectorNode[],
	nodeArtboardIds: Readonly<Record<string, string>>,
	artboardId: string,
): readonly VectorNode[] =>
	nodes.filter((node) => nodeArtboardIds[node.id] === artboardId);

/**
 * Per-document, per-artboard memo for `documentForArtboard`. Every scene read
 * cache downstream (spatial index, hit-testing, vertex anchors, guide
 * candidates) is a `WeakMap` keyed on `SceneDocument` identity, so returning a
 * fresh object on every call — as this used to — defeated all of them on every
 * pointermove. `nodeArtboardIds` is not part of the key because it is itself a
 * `WeakMap`-cached pure derivation of `document` (`selectNodeArtboardMapping`),
 * so it is already stable for a given `document` reference.
 */
const documentForArtboardCache = new WeakMap<
	SceneDocument,
	Map<string, SceneDocument>
>();

/**
 * Narrows handler reads to the artboard that owns the active pointer gesture.
 * Feature handlers keep receiving artboard-local points, while the widget host
 * can render multiple pasteboard-positioned artboards without rewriting them.
 */
export const documentForArtboard = (
	document: SceneDocument,
	artboard: NormalizedArtboard,
	nodeArtboardIds: Readonly<Record<string, string>>,
): SceneDocument => {
	let byArtboardId = documentForArtboardCache.get(document);
	if (!byArtboardId) {
		byArtboardId = new Map();
		documentForArtboardCache.set(document, byArtboardId);
	}
	const cached = byArtboardId.get(artboard.id);
	if (cached && cached.artboard === artboard) return cached;
	const next: SceneDocument = {
		...document,
		artboard,
		currentArtboardId: artboard.id,
		layers: document.layers.map(
			(layer): SceneLayer => ({
				...layer,
				nodes: filterNodesForArtboard(
					layer.nodes,
					nodeArtboardIds,
					artboard.id,
				),
			}),
		),
	};
	byArtboardId.set(artboard.id, next);
	return next;
};
