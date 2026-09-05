import { effectiveTextureBlendMode } from "@/shared/vec-core";
import {
	type LookGraph,
	type LookGraphNode,
	type LookGraphNodeKind,
	lookGraphPortId,
} from "./look-graph";

/**
 * Compiles the GPU raster segment of a Look graph: the ordered chain of GPU-tier
 * effect nodes on the actual serial path from `source` to `output`. GPU-tier nodes
 * emit no SVG and are rendered as fragment-shader passes; the SVG-tier prefix is
 * rasterized into the surface's source texture separately. Keeping
 * this as the real path-to-output (not a flat `filter` of all GPU nodes) is what keeps
 * future composite/mask/branch topologies correct.
 */

/** Look node kinds rendered on the GPU raster surface (vs. SVG-filter nodes). */
const GPU_RASTER_KINDS: ReadonlySet<LookGraphNodeKind> = new Set([
	"lens",
	"kaleidoscope",
	"flow",
	"halftone",
	"pixel-grid",
	"ordered-dither",
	"ascii-glyph",
	"block-mosaic",
	"path-blur",
	"noise-source",
	"deep-glow",
	"riso",
	"colorama",
	"wave-warp",
	"bend-warp",
	"vhs-color",
	"vhs-tracking",
	"vhs-noise",
	"crt-display",
	"signal-glitch",
	"interlace",
]);

/** Whether a node kind is a GPU raster-finish effect (rendered as a shader pass). */
export const isGpuRasterKind = (kind: LookGraphNodeKind): boolean =>
	GPU_RASTER_KINDS.has(kind);

/**
 * Whether a concrete node is rendered by the GPU raster surface. A grain node is
 * a GPU node only for the legacy fill-eroding dissolve; the noise-OVER-fill
 * reframe (particle/mixed material with an authored blend mode) stays on the SVG
 * path so it rasterizes into the surface's source texture.
 */
export const isGpuRasterNode = (node: LookGraphNode): boolean =>
	isGpuRasterKind(node.kind) ||
	(node.payload.kind === "grain" &&
		effectiveTextureBlendMode(node.payload.texture.material) === "dissolve");

const nodeHasMaskInput = (graph: LookGraph, node: LookGraphNode): boolean => {
	const maskPortId = lookGraphPortId(node.id, "input", "mask");
	return graph.edges.some(
		(edge) => edge.to.nodeId === node.id && edge.to.portId === maskPortId,
	);
};

const isGpuRasterRenderableNode = (
	graph: LookGraph,
	node: LookGraphNode,
): boolean =>
	isGpuRasterNode(node) &&
	(node.payload.kind !== "grain" || !nodeHasMaskInput(graph, node));

/** The single image-input source feeding `nodeId`'s named port (`null` if unwired). */
const sourceForPort = (
	graph: LookGraph,
	nodeId: string,
	portName: string,
): string | null => {
	const portId = lookGraphPortId(nodeId, "input", portName);
	const edge = graph.edges.find(
		(e) => e.to.nodeId === nodeId && e.to.portId === portId,
	);
	return edge ? edge.from.nodeId : null;
};

/**
 * Whether the branch feeding `nodeId` is GPU-composable: every node back to `source` is
 * `source`, an enabled GPU-raster effect, a (recursively) GPU-composable `composite`, or a
 * disabled effect (passed straight through). Any *enabled* SVG-tier effect or mask makes
 * the branch non-composable — it would have to bake into the single shared source texture
 * and leak across branches — so such a composite stays SVG `feBlend` instead.
 */
function branchIsGpuComposable(
	graph: LookGraph,
	nodeId: string,
	byId: ReadonlyMap<string, LookGraphNode>,
	stack: ReadonlySet<string>,
): boolean {
	if (stack.has(nodeId)) return false; // cycle
	const node = byId.get(nodeId);
	if (!node || node.kind === "source") return true;
	const next = new Set(stack).add(nodeId);
	const through = (portName: string): boolean => {
		const src = sourceForPort(graph, nodeId, portName);
		return src ? branchIsGpuComposable(graph, src, byId, next) : true;
	};
	// A disabled node passes its primary image input through (composite → "base").
	if (!node.enabled)
		return through(node.kind === "composite" ? "base" : "image");
	if (node.kind === "composite")
		return canGpuComposite(graph, node, byId, next);
	if (isGpuRasterRenderableNode(graph, node)) return through("image");
	return false; // enabled SVG-tier effect / mask
}

/**
 * Whether an *enabled* GPU raster effect is reachable through `nodeId`'s image inputs
 * (disabled nodes are transparent). A composite with no GPU content in either branch is a
 * pure-SVG composite and must keep its `feBlend` — without this check a composite whose
 * only "GPU" node is disabled would be wrongly GPU-deferred and dropped from SVG/PDF.
 */
function branchHasGpuEffect(
	graph: LookGraph,
	nodeId: string,
	byId: ReadonlyMap<string, LookGraphNode>,
	stack: ReadonlySet<string>,
): boolean {
	if (stack.has(nodeId)) return false; // cycle
	const node = byId.get(nodeId);
	if (!node || node.kind === "source") return false;
	if (node.enabled && isGpuRasterRenderableNode(graph, node)) return true;
	const next = new Set(stack).add(nodeId);
	const maskPortId = lookGraphPortId(nodeId, "input", "mask");
	return graph.edges.some(
		(edge) =>
			edge.to.nodeId === nodeId &&
			edge.to.portId !== maskPortId &&
			branchHasGpuEffect(graph, edge.from.nodeId, byId, next),
	);
}

/**
 * Whether a `composite` blends two GPU-composable branches and should therefore be
 * composited on the GPU surface — the compile defers it (no `feBlend`, so the SVG source
 * stays the shared artboard) and `rasterPlan` renders it. ONE predicate drives both the
 * compile defer and the tree builder, so they can never disagree (a disagreement would
 * silently drop the composite from SVG *and* GPU). `byId`/`stack` are internal recursion
 * state. Returns false for disabled composites (they pass through to `base`).
 */
export function canGpuComposite(
	graph: LookGraph,
	node: LookGraphNode,
	byId?: ReadonlyMap<string, LookGraphNode>,
	stack?: ReadonlySet<string>,
): boolean {
	if (node.kind !== "composite" || !node.enabled) return false;
	const ids = byId ?? new Map(graph.nodes.map((n) => [n.id, n]));
	const visiting = stack ?? new Set<string>([node.id]);
	const base = sourceForPort(graph, node.id, "base");
	const overlay = sourceForPort(graph, node.id, "overlay");
	const composable =
		(base ? branchIsGpuComposable(graph, base, ids, visiting) : true) &&
		(overlay ? branchIsGpuComposable(graph, overlay, ids, visiting) : true);
	if (!composable) return false;
	// Both branches are GPU-composable, but it's only a GPU composite if there's actually a
	// GPU effect to render — otherwise it's a plain SVG blend and must keep its feBlend.
	const hasGpu =
		(base ? branchHasGpuEffect(graph, base, ids, visiting) : false) ||
		(overlay ? branchHasGpuEffect(graph, overlay, ids, visiting) : false);
	return hasGpu;
}

/** The image-input port name a node consumes on the serial chain (`null` = not serial). */
const serialInputPortName = (node: LookGraphNode): string | null =>
	node.kind === "mask" ? null : node.kind === "composite" ? "base" : "image";

/**
 * Walks the serial image chain ending at `output`, back to its root, and returns it in
 * `root → … → output` order; `[]` if the chain branches, cycles, or routes through a mask.
 *
 * The walk goes BACKWARD from `output` (not forward from `source`) so it reaches both a
 * `source` root and a zero-input GENERATOR root (`noise-source`/`noise-field`). A generator
 * insert orphans `source` (it wires straight to output), so a forward-from-source walk would
 * miss the whole `noise-source → … → output` chain and the rasterSegment fallback would keep
 * only the first GPU node — silently dropping later passes (e.g. `noise-source → deep-glow`).
 */
const serialPathNodes = (graph: LookGraph): readonly LookGraphNode[] => {
	const output = graph.nodes.find((node) => node.id === graph.outputNodeId);
	if (output?.kind !== "output") return [];
	const byId = new Map(graph.nodes.map((node) => [node.id, node]));
	const reversed: LookGraphNode[] = [];
	const visited = new Set<string>();
	let cursor: LookGraphNode | undefined = output;
	while (cursor) {
		if (visited.has(cursor.id)) return []; // cycle
		visited.add(cursor.id);
		reversed.push(cursor);
		if (cursor.kind === "source") break; // reached the source root
		const portName = serialInputPortName(cursor);
		if (portName === null) return []; // mask on the serial path → not a clean chain
		const feederId = sourceForPort(graph, cursor.id, portName);
		if (feederId === null) break; // zero-input generator root (noise-source/noise-field)
		cursor = byId.get(feederId);
	}
	return reversed.reverse();
};

/**
 * The GPU composite tree of a Look graph (the general "stack blended raster layers"
 * model): `source` is the shared rasterized artboard, `effects` is a run of GPU passes
 * over its input, `composite` blends two branches with the node's draw mode + mix.
 */
export type RasterPlanLayer =
	| { readonly kind: "source" }
	| {
			readonly kind: "effects";
			readonly input: RasterPlanLayer;
			readonly nodes: readonly LookGraphNode[];
	  }
	| {
			readonly kind: "composite";
			readonly node: LookGraphNode;
			readonly base: RasterPlanLayer;
			readonly overlay: RasterPlanLayer;
	  };

/**
 * Compiles a Look graph to a GPU composite tree, or `null` when the graph is not a valid
 * GPU composite — no GPU `composite` node, or a branch on the active path carries an
 * SVG-tier effect / mask / SVG composite (which would have to bake into the single shared
 * source and leak across branches). On `null` the caller keeps the verified linear path
 * (`rasterSegment` + `renderPipeline`); only true GPU composites take the tree evaluator.
 * v1 requires the composited branches to be pure GPU effects over the shared source.
 */
export function rasterPlan(graph: LookGraph): RasterPlanLayer | null {
	const output = graph.nodes.find((node) => node.id === graph.outputNodeId);
	if (output?.kind !== "output") return null;
	const byId = new Map(graph.nodes.map((node) => [node.id, node]));
	let sawComposite = false;

	const planFor = (
		nodeId: string,
		visiting: ReadonlySet<string>,
	): RasterPlanLayer | null => {
		if (visiting.has(nodeId)) return null; // cycle
		const node = byId.get(nodeId);
		if (!node || node.kind === "source") return { kind: "source" };
		const next = new Set(visiting).add(nodeId);
		const passThrough = (portName: string): RasterPlanLayer | null => {
			const src = sourceForPort(graph, nodeId, portName);
			return src ? planFor(src, next) : { kind: "source" };
		};
		if (node.kind === "output") return passThrough("image");
		if (!node.enabled) {
			return passThrough(node.kind === "composite" ? "base" : "image");
		}
		if (node.kind === "composite") {
			if (!canGpuComposite(graph, node)) return null; // not GPU-composable → fall back
			sawComposite = true;
			const base = passThrough("base");
			const overlaySrc = sourceForPort(graph, nodeId, "overlay");
			const overlay = overlaySrc
				? planFor(overlaySrc, next)
				: { kind: "source" as const };
			if (!base || !overlay) return null;
			return { kind: "composite", node, base, overlay };
		}
		if (isGpuRasterRenderableNode(graph, node)) {
			const input = passThrough("image");
			if (!input) return null;
			return input.kind === "effects"
				? { kind: "effects", input: input.input, nodes: [...input.nodes, node] }
				: { kind: "effects", input, nodes: [node] };
		}
		return null; // SVG-tier effect / mask — not GPU-composable in v1
	};

	const root = planFor(output.id, new Set());
	return root && sawComposite ? root : null;
}

/** The GPU raster segment of a Look graph. */
export type RasterSegment = {
	/** Enabled GPU-tier nodes in serial order — the ordered render passes. */
	readonly passes: readonly LookGraphNode[];
	/**
	 * True when an SVG-tier effect follows a GPU pass on the path. Such a node cannot
	 * bake into the source texture (it would apply pre-warp); rendering those as GPU
	 * passes too is the next step. The chain still runs; this flags the gap.
	 */
	readonly hasTrailingSvgFilter: boolean;
};

/**
 * Resolves the GPU pass chain for `graph`. On a clean serial path the passes are the
 * enabled GPU nodes in order. On a branching graph (no single serial path), falls back
 * to the first enabled GPU node so behaviour is never worse than the single-effect path.
 */
export function rasterSegment(graph: LookGraph): RasterSegment {
	// A graph with an enabled composite is the tree evaluator's (rasterPlan) domain. If
	// rasterPlan declined it (not GPU-composable → SVG feBlend renders it), the GPU overlay
	// must render NOTHING here — otherwise the branchy-graph fallback below would draw a
	// stray first-GPU-node on top of the already-composited SVG.
	if (graph.nodes.some((node) => node.enabled && node.kind === "composite")) {
		return { passes: [], hasTrailingSvgFilter: false };
	}
	const path = serialPathNodes(graph);
	if (path.length === 0) {
		const first = graph.nodes.find(
			(node) => node.enabled && isGpuRasterRenderableNode(graph, node),
		);
		return { passes: first ? [first] : [], hasTrailingSvgFilter: false };
	}
	const passes = path.filter(
		(node) => node.enabled && isGpuRasterRenderableNode(graph, node),
	);
	const firstGpuIndex = path.findIndex(
		(node) => node.enabled && isGpuRasterRenderableNode(graph, node),
	);
	const hasTrailingSvgFilter =
		firstGpuIndex >= 0 &&
		path
			.slice(firstGpuIndex + 1)
			.some(
				(node) =>
					node.enabled &&
					node.kind !== "output" &&
					!isGpuRasterRenderableNode(graph, node),
			);
	return { passes, hasTrailingSvgFilter };
}
