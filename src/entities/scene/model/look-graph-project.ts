import type { VisualRecipe } from "@/shared/vec-core";
import {
	type EffectLayerDraft,
	type EffectLayerStack,
	normalizeEffectLayerStack,
	visualRecipeFromEffectLayerStack,
} from "./effect-layer-stack";
import {
	type LookGraph,
	type LookGraphDraft,
	type LookGraphNode,
	normalizeLookGraph,
} from "./look-graph";

/**
 * Reads the port name an edge endpoint targets/produces on a node, or `null`
 * when the endpoint does not resolve to a real port (defensive; normalized
 * graphs always resolve).
 */
const portName = (
	node: LookGraphNode | undefined,
	portId: string,
	direction: "input" | "output",
): string | null => {
	const ports = direction === "input" ? node?.inputs : node?.outputs;
	return ports?.find((port) => port.id === portId)?.name ?? null;
};

/**
 * Projects an effect node back to one compatibility stack layer. Only the serial
 * P0 effect kinds (grade/glow/grain) project; `source`/`output`/`mask`/
 * `composite` return `null` so a branch graph is never flattened into a lie.
 * Layer ids reuse the node id so the projection is stable and round-trippable.
 */
const layerFromNode = (node: LookGraphNode): EffectLayerDraft | null => {
	switch (node.payload.kind) {
		case "grade":
			return {
				id: node.id,
				kind: "grade",
				label: node.label,
				enabled: node.enabled,
				visualRecipe: { color: node.payload.color },
				blendMode: "normal",
			};
		case "glow":
			return {
				id: node.id,
				kind: "glow",
				label: node.label,
				enabled: node.enabled,
				visualRecipe: { glow: node.payload.glow },
				blendMode: "screen",
			};
		case "grain":
			return {
				id: node.id,
				kind: "grain",
				label: node.label,
				enabled: node.enabled,
				visualRecipe: { texture: node.payload.texture },
				blendMode: "overlay",
				adaptation: { source: "previous-alpha", strength: 1 },
			};
		default:
			return null;
	}
};

/**
 * Projects a SERIAL Look graph (`Source -> grade/glow/grain... -> Output`, no
 * branches, masks, or composites) back to the compatibility {@link
 * EffectLayerStack}. Returns `undefined` for any non-serial graph, because only a
 * linear chain has a faithful stack representation — branch graphs must use the
 * graph commands and the runtime compiler instead of pretending to be a stack.
 */
export function lookGraphToEffectLayerStack(
	graph: LookGraph | LookGraphDraft | null | undefined,
): EffectLayerStack | undefined {
	const normalized = normalizeLookGraph(graph);
	if (!normalized) return undefined;

	const nodeById = new Map(normalized.nodes.map((node) => [node.id, node]));
	const sources = normalized.nodes.filter((node) => node.kind === "source");
	const outputs = normalized.nodes.filter((node) => node.kind === "output");
	if (sources.length !== 1 || outputs.length !== 1) return undefined;
	const source = sources[0];
	if (!source) return undefined;

	// Every edge must be a single image wire; any mask/base/overlay target marks
	// a branch or composite, which is not serially projectable.
	const outgoing = new Map<string, LookGraphNode[]>();
	const indegree = new Map<string, number>();
	for (const node of normalized.nodes) indegree.set(node.id, 0);
	for (const edge of normalized.edges) {
		const fromNode = nodeById.get(edge.from.nodeId);
		const toNode = nodeById.get(edge.to.nodeId);
		if (portName(fromNode, edge.from.portId, "output") !== "image") {
			return undefined;
		}
		if (portName(toNode, edge.to.portId, "input") !== "image") return undefined;
		if (!toNode) return undefined;
		const list = outgoing.get(edge.from.nodeId) ?? [];
		list.push(toNode);
		outgoing.set(edge.from.nodeId, list);
		indegree.set(edge.to.nodeId, (indegree.get(edge.to.nodeId) ?? 0) + 1);
	}

	// Walk the unique chain from source to output.
	const ordered: LookGraphNode[] = [];
	const visited = new Set<string>();
	let current: LookGraphNode | undefined = source;
	while (current && current.kind !== "output") {
		const outs: readonly LookGraphNode[] = outgoing.get(current.id) ?? [];
		if (outs.length !== 1) return undefined;
		const next: LookGraphNode | undefined = outs[0];
		if (!next || visited.has(next.id)) return undefined;
		if ((indegree.get(next.id) ?? 0) !== 1) return undefined;
		visited.add(next.id);
		if (next.kind === "output") {
			current = next;
			break;
		}
		if (
			next.kind !== "grade" &&
			next.kind !== "glow" &&
			next.kind !== "grain"
		) {
			return undefined;
		}
		ordered.push(next);
		current = next;
	}
	if (current?.kind !== "output") return undefined;

	// Require the chain to cover every node (no disconnected/branch nodes left).
	if (normalized.nodes.length !== ordered.length + 2) return undefined;

	const layers = ordered.flatMap((node) => {
		const layer = layerFromNode(node);
		return layer ? [layer] : [];
	});
	if (layers.length !== ordered.length) return undefined;
	return normalizeEffectLayerStack({ layers });
}

/**
 * Projects a serial Look graph to the legacy `visualRecipe` that today drives the
 * canvas/export pixel approximation, so a graph-first edit is visible through the
 * existing renderers without waiting on the full graph runtime. Returns
 * `undefined` for non-serial graphs or a neutral projection.
 */
export function visualRecipeFromLookGraph(
	graph: LookGraph | LookGraphDraft | null | undefined,
): VisualRecipe | undefined {
	return visualRecipeFromEffectLayerStack(lookGraphToEffectLayerStack(graph));
}
