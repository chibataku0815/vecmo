import type {
	SceneDocument,
	SceneLayer,
	StrokeCap,
	StrokeJoin,
	VectorNode,
} from "./types";

/**
 * Legacy live-canvas renderer hardcoded round cap/join for every `path`-kind
 * node, regardless of authored style. Persisted path nodes saved before the
 * renderer started honoring {@link StrokeCap}/{@link StrokeJoin} were authored
 * and visually approved against that round look, so an explicit backfill of
 * "round" (not the style-resolve default of "butt"/"miter") is required to
 * keep existing artwork looking the same now that the renderer paints the
 * honest resolved value instead of overriding it.
 */
const LEGACY_PATH_STROKE_CAP: StrokeCap = "round";

/** @see {@link LEGACY_PATH_STROKE_CAP} */
const LEGACY_PATH_STROKE_JOIN: StrokeJoin = "round";

const backfillPathStrokeDefaults = (node: VectorNode): VectorNode => {
	const normalizedChildren = node.children?.map(backfillPathStrokeDefaults);
	const childrenChanged = normalizedChildren?.some(
		(child, index) => child !== node.children?.[index],
	);

	const needsCap =
		node.geometry.kind === "path" && node.style.strokeCap === undefined;
	const needsJoin =
		node.geometry.kind === "path" && node.style.strokeJoin === undefined;

	if (!needsCap && !needsJoin && !childrenChanged) return node;

	return {
		...node,
		...(childrenChanged ? { children: normalizedChildren } : {}),
		...(needsCap || needsJoin
			? {
					style: {
						...node.style,
						...(needsCap ? { strokeCap: LEGACY_PATH_STROKE_CAP } : {}),
						...(needsJoin ? { strokeJoin: LEGACY_PATH_STROKE_JOIN } : {}),
					},
				}
			: {}),
	};
};

const backfillSceneLayerPathStrokeDefaults = (
	layer: SceneLayer,
): SceneLayer => {
	const normalizedNodes = layer.nodes.map(backfillPathStrokeDefaults);
	const changed = normalizedNodes.some(
		(node, index) => node !== layer.nodes[index],
	);
	return changed ? { ...layer, nodes: normalizedNodes } : layer;
};

/**
 * Backfills `strokeCap`/`strokeJoin` on every `path`-kind node whose style
 * omits them, so documents saved before the canvas renderer honored
 * per-node cap/join keep their legacy round-cap/round-join look (see
 * {@link LEGACY_PATH_STROKE_CAP}). Only `path` geometry is touched — other
 * kinds already render honestly and have no such legacy override to
 * compensate for. Traverses `document.layers[].nodes[]` recursively through
 * group `children`, mirroring the walk in `recipe-compatibility.ts`, but
 * (per this module's referential-stability contract) returns the original
 * node/layer/document reference whenever nothing needed backfilling.
 */
export function normalizeSceneDocumentPathStrokeDefaults(
	document: SceneDocument,
): SceneDocument {
	const normalizedLayers = document.layers.map(
		backfillSceneLayerPathStrokeDefaults,
	);
	const changed = normalizedLayers.some(
		(layer, index) => layer !== document.layers[index],
	);
	return changed ? { ...document, layers: normalizedLayers } : document;
}
