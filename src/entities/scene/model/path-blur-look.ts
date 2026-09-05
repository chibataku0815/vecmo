import {
	DEFAULT_PATH_BLUR_GUIDE,
	LOOK_GRAPH_SCHEMA_VERSION,
	type LookGraph,
	type LookGraphEdgeDraft,
	type LookGraphEndpoint,
	type LookGraphNode,
	lookGraphEdgeId,
	lookGraphNodeId,
	lookGraphPortId,
	normalizeLookGraph,
} from "./look-graph";
import type {
	Artboard,
	LookGraphScopedEffectLook,
	ScopedEffectLook,
	VectorNode,
} from "./types";

const OBJECT_PATH_BLUR_SCOPED_LOOK_ID_PREFIX = "object-path-blur";

/** Stable scoped-overlay id for one object's Path Blur. */
export const objectPathBlurScopedLookId = (nodeId: string): string =>
	`${OBJECT_PATH_BLUR_SCOPED_LOOK_ID_PREFIX}:${nodeId}`;

/** Narrows a scoped effect overlay to the graph-backed Object Path Blur form. */
export const isObjectPathBlurScopedLook = (
	look: ScopedEffectLook,
): look is LookGraphScopedEffectLook =>
	look.kind === "look-graph-overlay" && look.source === "object-path-blur";

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

/**
 * Builds the graph-native scoped overlay for one object's Path Blur. Guide
 * positions live in the *object's own crop UV* (0..1 across its padded paint
 * bounds), not frame UV — the GPU compositor renders this object into an
 * isolated crop surface and samples the guide field in that same space, so no
 * frame-relative remap is needed. The graph's SourceGraphic is resolved by
 * that isolated compositor, so this stays independent of canvas/export
 * adapters.
 */
export const objectPathBlurLookGraph = (
	artboardId: string,
	node: VectorNode,
): LookGraph | null => {
	const owner = {
		scope: "scoped-overlay",
		artboardId,
		scopedLookId: objectPathBlurScopedLookId(node.id),
	} as const;
	const sourceId = lookGraphNodeId(owner, "source");
	const pathBlurId = `${lookGraphNodeId(owner, "path-blur")}:${node.id}`;
	const outputId = lookGraphNodeId(owner, "output");
	return (
		normalizeLookGraph({
			schemaVersion: LOOK_GRAPH_SCHEMA_VERSION,
			outputNodeId: outputId,
			nodes: [
				{ id: sourceId, kind: "source", payload: { kind: "source" } },
				{
					id: pathBlurId,
					kind: "path-blur",
					label: "Path Blur",
					payload: {
						kind: "path-blur",
						guides: [DEFAULT_PATH_BLUR_GUIDE],
						speed: 100,
						length: 0.12,
						taper: 0.4,
						centeredBlur: false,
						strobeStrength: 0,
						strobeFlashes: 0,
					},
				},
				{ id: outputId, kind: "output", payload: { kind: "output" } },
			],
			edges: [
				graphImageEdge(sourceId, pathBlurId),
				graphImageEdge(pathBlurId, outputId),
			],
		}) ?? null
	);
};

/** Builds the persisted scoped overlay wrapper for one object's Path Blur graph. */
export const objectPathBlurScopedLook = (
	artboardId: string,
	node: VectorNode,
): LookGraphScopedEffectLook | null => {
	const lookGraph = objectPathBlurLookGraph(artboardId, node);
	if (!lookGraph) return null;
	return {
		id: objectPathBlurScopedLookId(node.id),
		kind: "look-graph-overlay",
		source: "object-path-blur",
		lookGraph,
		targetNodeIds: [node.id],
	};
};

/** Finds the Object Path Blur scoped overlay that currently owns `nodeId`. */
export const objectPathBlurScopedLookForNode = (
	current: Artboard | readonly ScopedEffectLook[] | undefined,
	nodeId: string,
): LookGraphScopedEffectLook | null => {
	if (!current) return null;
	const scopedLooks: readonly ScopedEffectLook[] | undefined = Array.isArray(
		current,
	)
		? current
		: (current as Artboard).effectIntent?.scopedLooks;
	return (
		scopedLooks?.find(
			(look): look is LookGraphScopedEffectLook =>
				isObjectPathBlurScopedLook(look) && look.targetNodeIds.includes(nodeId),
		) ?? null
	);
};

/** Returns the path-blur graph node inside an Object Path Blur overlay. */
export const objectPathBlurGraphNode = (
	look: LookGraphScopedEffectLook,
): LookGraphNode | null =>
	look.lookGraph.nodes.find((node) => node.payload.kind === "path-blur") ??
	null;

/** Returns a copy of `look.lookGraph` with its Path Blur node payload replaced. */
export const graphWithObjectPathBlurPayload = (
	look: LookGraphScopedEffectLook,
	payload: Extract<LookGraphNode["payload"], { readonly kind: "path-blur" }>,
): LookGraph | null => {
	const pathBlurNode = objectPathBlurGraphNode(look);
	if (!pathBlurNode) return null;
	return (
		normalizeLookGraph({
			...look.lookGraph,
			nodes: look.lookGraph.nodes.map((node) =>
				node.id === pathBlurNode.id ? { ...node, payload } : node,
			),
		}) ?? null
	);
};
