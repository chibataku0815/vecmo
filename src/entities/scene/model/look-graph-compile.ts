import {
	effectiveTextureBlendMode,
	normalizeVisualRecipe,
} from "@/shared/vec-core";
import {
	blurOutwardReach,
	blurPrimitives,
	chromaticFringeOutwardReach,
	chromaticFringePrimitives,
	colorGradePrimitives,
	colorMapPrimitives,
	displaceOutwardReach,
	displacePrimitives,
	type EffectFilterSpec,
	type FilterPrimitive,
	findEdgesPrimitives,
	glowPrimitives,
	noiseFieldPrimitives,
	posterizePrimitives,
	recipeOutwardReach,
	scanlinePrimitives,
	svgIdSegment,
	texturePrimitives,
	warpPrimitives,
} from "./effect-filter";
import {
	type LookGraph,
	type LookGraphEdge,
	type LookGraphEndpoint,
	type LookGraphMaskSource,
	type LookGraphNode,
	type LookGraphNodeKind,
	type LookGraphOwnerRef,
	type LookGraphValueType,
	lookGraphPortId,
	normalizeLookGraph,
} from "./look-graph";
import { canGpuComposite, rasterPlan } from "./look-graph-raster";
import type { Bounds } from "./types";

/**
 * Honest per-node renderer/export support status for a compiled Look node. The
 * status vocabulary matches the export-fidelity tiers in the Look graph plan so a
 * later export manifest can report the same labels.
 */
export type LookGraphFidelity =
	| { readonly nodeId: string; readonly status: "native" }
	| {
			readonly nodeId: string;
			readonly status:
				| "approx"
				| "capture-only"
				| "runtime-only"
				| "deferred"
				| "unsupported";
			readonly reason: string;
	  };

/**
 * One graph node lowered into the renderer-neutral plan. `inputs` maps each
 * resolved input port name to the SVG `result` pixel feeding it, and `output` is
 * the pixel name this node produces (or passes through when disabled/neutral).
 */
export type CompiledLookNode = {
	readonly nodeId: string;
	readonly kind: LookGraphNodeKind;
	readonly enabled: boolean;
	readonly inputs: Readonly<Record<string, string>>;
	readonly output: string;
	readonly outputValueType: LookGraphValueType;
	readonly primitives: readonly FilterPrimitive[];
	readonly outwardReach: number;
	readonly fidelity: LookGraphFidelity;
};

/**
 * Renderer-neutral compiled Look graph consumed by canvas/export/MCP adapters.
 * Node ids, edges, the output endpoint, cache key, outward reach, and per-node
 * fidelity travel together so every surface can explain the same graph result.
 */
export type LookGraphPlan = {
	readonly owner: LookGraphOwnerRef;
	readonly input: string;
	readonly nodes: readonly CompiledLookNode[];
	readonly edges: readonly LookGraphEdge[];
	readonly output: LookGraphEndpoint;
	readonly outputPixel: string;
	readonly cacheKey: string;
	readonly outwardReach: number;
	readonly fidelity: readonly LookGraphFidelity[];
};

/** Inputs needed to compile a graph deterministically for one owner. */
export type CompileLookGraphOptions = {
	readonly owner: LookGraphOwnerRef;
	readonly input?: string;
	/** Filter-space bounds for texture nodes that generate spatial ramps. */
	readonly bounds?: Bounds;
	/** Raster export mode: bakes explicit SMIL particle Motion while keeping inlined linear ramps. */
	readonly rasterSafe?: boolean;
	/**
	 * GPU raster callers set this so particle TextureRecipe nodes are omitted from the
	 * SVG prefix and rendered by the shared GPU surface instead of being double-applied.
	 */
	readonly deferGpuRasterEffects?: boolean;
	/** Sampled frame time in seconds, used to bake particle Motion when `rasterSafe`. */
	readonly frameTimeSeconds?: number;
};

const DEFAULT_INPUT = "SourceGraphic";
const DEFAULT_TEXTURE_BOUNDS: Bounds = { x: 0, y: 0, width: 1, height: 1 };

type LookGraphRenderContext = {
	readonly bounds: Bounds;
	readonly rasterSafe: boolean;
	readonly deferGpuRasterEffects: boolean;
	readonly frameTimeSeconds?: number;
};

/** Luminance weights (Rec. 709) reused for luminance-derived mattes. */
const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

/** Feather (0..1) scales to this Gaussian sigma ceiling for mask softening. */
const MASK_FEATHER_SIGMA = 4;

const nativeFidelity = (nodeId: string): LookGraphFidelity => ({
	nodeId,
	status: "native",
});

const fidelity = (
	nodeId: string,
	status: Exclude<LookGraphFidelity["status"], "native">,
	reason: string,
): LookGraphFidelity => ({ nodeId, status, reason });

type TopoResult = {
	readonly order: readonly LookGraphNode[];
	readonly cyclicNodeIds: readonly string[];
};

/**
 * Topologically orders nodes so each node compiles after its producers. A
 * normalized graph is acyclic; any residual cycle (defensive) is reported via
 * `cyclicNodeIds` instead of throwing so the compiler degrades honestly.
 */
const topoOrder = (graph: LookGraph): TopoResult => {
	const indegree = new Map<string, number>();
	const adjacency = new Map<string, string[]>();
	for (const node of graph.nodes) {
		indegree.set(node.id, 0);
		adjacency.set(node.id, []);
	}
	for (const edge of graph.edges) {
		if (!indegree.has(edge.to.nodeId) || !adjacency.has(edge.from.nodeId)) {
			continue;
		}
		indegree.set(edge.to.nodeId, (indegree.get(edge.to.nodeId) ?? 0) + 1);
		adjacency.get(edge.from.nodeId)?.push(edge.to.nodeId);
	}
	const queue = graph.nodes
		.filter((node) => (indegree.get(node.id) ?? 0) === 0)
		.map((node) => node.id);
	const order: LookGraphNode[] = [];
	const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
	while (queue.length > 0) {
		const current = queue.shift();
		if (current === undefined) continue;
		const node = nodeById.get(current);
		if (node) order.push(node);
		for (const next of adjacency.get(current) ?? []) {
			const remaining = (indegree.get(next) ?? 0) - 1;
			indegree.set(next, remaining);
			if (remaining === 0) queue.push(next);
		}
	}
	const cyclicNodeIds = graph.nodes
		.filter((node) => (indegree.get(node.id) ?? 0) > 0)
		.map((node) => node.id);
	return { order, cyclicNodeIds };
};

/** Indexes incoming edges per target node for input resolution. */
const incomingEdges = (
	graph: LookGraph,
): Map<string, readonly LookGraphEdge[]> => {
	const index = new Map<string, LookGraphEdge[]>();
	for (const edge of graph.edges) {
		const list = index.get(edge.to.nodeId) ?? [];
		list.push(edge);
		index.set(edge.to.nodeId, list);
	}
	return index;
};

/** Resolves `inputPortName -> producing pixel name` for one node. */
const resolveInputs = (
	node: LookGraphNode,
	edges: readonly LookGraphEdge[],
	outputPixelByNode: ReadonlyMap<string, string>,
): Record<string, string> => {
	const inputs: Record<string, string> = {};
	for (const edge of edges) {
		const inputPort = node.inputs.find((port) => port.id === edge.to.portId);
		if (!inputPort) continue;
		const sourcePixel = outputPixelByNode.get(edge.from.nodeId);
		if (sourcePixel === undefined) continue;
		inputs[inputPort.name] = sourcePixel;
	}
	return inputs;
};

/** Alpha-scale color-matrix used to apply a composite `mix` to its overlay. */
const alphaScaleMatrix = (mix: number): readonly number[] => [
	1,
	0,
	0,
	0,
	0,
	0,
	1,
	0,
	0,
	0,
	0,
	0,
	1,
	0,
	0,
	0,
	0,
	0,
	mix,
	0,
];

/**
 * Builds a `feColorMatrix` value list turning an image into an alpha matte for
 * the requested mask source. White RGB keeps the matte visible for debug taps;
 * only alpha carries the mask signal. `invert` flips the alpha response.
 */
const maskMatrix = (
	source: LookGraphMaskSource,
	invert: boolean,
): readonly number[] => {
	const whiteRgb = [0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
	const alphaRow = (() => {
		switch (source) {
			case "none":
				return [0, 0, 0, 0, invert ? 0 : 1];
			case "source-alpha":
			case "previous-alpha":
			case "mask":
				return invert ? [0, 0, 0, -1, 1] : [0, 0, 0, 1, 0];
			case "previous-luminance":
				return invert
					? [-LUMA_R, -LUMA_G, -LUMA_B, 0, 1]
					: [LUMA_R, LUMA_G, LUMA_B, 0, 0];
		}
	})();
	return [...whiteRgb, ...alphaRow];
};

type EffectCompileResult = {
	readonly primitives: readonly FilterPrimitive[];
	readonly output: string;
	readonly outwardReach: number;
	readonly fidelity: LookGraphFidelity;
};

/**
 * Compiles one grade/glow/grain node, optionally gated by a connected mask. The
 * gate keeps the effect where the mask is opaque and the original input
 * elsewhere via `feComposite operator="in"` + `feMerge` — an SVG approximation.
 */
const compileEffectNode = (
	node: LookGraphNode,
	imageInput: string,
	maskInput: string | undefined,
	result: string,
	renderContext: LookGraphRenderContext,
): EffectCompileResult => {
	const effectResult = maskInput ? `${result}-fx` : result;
	const built = ((): {
		readonly primitives: readonly FilterPrimitive[];
		readonly reach: number;
		// `blur` lowers to a faithful `feGaussianBlur` (native); the recipe-backed
		// effects are SVG approximations of richer canonical state (approx).
		readonly tier: "native" | "approx" | "deferred";
	} => {
		switch (node.payload.kind) {
			case "grade":
				return {
					primitives: colorGradePrimitives(
						node.payload.color,
						imageInput,
						effectResult,
					),
					reach: 0,
					tier: "approx",
				};
			case "glow":
				return {
					primitives: glowPrimitives(
						node.payload.glow,
						imageInput,
						effectResult,
					),
					reach: recipeOutwardReach(
						normalizeVisualRecipe({ glow: node.payload.glow }),
					),
					tier: "approx",
				};
			case "grain": {
				if (
					renderContext.deferGpuRasterEffects &&
					!maskInput &&
					// Only the legacy fill-eroding dissolve defers to the GPU raster
					// surface. A particle/mixed material with an authored blend mode is
					// the noise-OVER-fill reframe — keep it on the SVG path
					// (particleOverlayPrimitives) so it renders into the svgPrefix the
					// GPU surface samples, then the Look composites over it.
					effectiveTextureBlendMode(node.payload.texture.material) ===
						"dissolve"
				) {
					return {
						primitives: [],
						reach: 0,
						tier: "deferred",
					};
				}
				const texture = texturePrimitives({
					texture: node.payload.texture,
					bounds: renderContext.bounds,
					input: imageInput,
					result: effectResult,
					rasterSafe: renderContext.rasterSafe,
					...(renderContext.frameTimeSeconds !== undefined
						? { frameTimeSeconds: renderContext.frameTimeSeconds }
						: {}),
				});
				return {
					primitives: texture.primitives,
					reach: texture.outwardReach,
					tier: "approx",
				};
			}
			case "blur": {
				const radiusY = node.payload.radiusY ?? node.payload.radius;
				return {
					primitives: blurPrimitives(
						node.payload.radius,
						imageInput,
						effectResult,
						node.payload.radiusY,
					),
					// reach must cover the larger axis so a directional blur is not clipped
					reach: blurOutwardReach(Math.max(node.payload.radius, radiusY)),
					tier: "native",
				};
			}
			case "chromatic-fringe":
				return {
					primitives: chromaticFringePrimitives(
						node.payload.amount,
						imageInput,
						effectResult,
					),
					reach: chromaticFringeOutwardReach(node.payload.amount),
					tier: "approx",
				};
			case "displace":
				return {
					primitives: displacePrimitives(
						node.payload.scale,
						node.payload.frequency,
						node.payload.octaves,
						imageInput,
						effectResult,
					),
					reach: displaceOutwardReach(node.payload.scale),
					// feTurbulence + feDisplacementMap both render natively in SVG.
					tier: "native",
				};
			case "posterize":
				return {
					primitives: posterizePrimitives(
						node.payload.levels,
						imageInput,
						effectResult,
					),
					reach: 0,
					// feComponentTransfer renders natively in SVG (no approximation).
					tier: "native",
				};
			case "color-map":
				return {
					primitives: colorMapPrimitives(
						node.payload.shadow,
						node.payload.midtone,
						node.payload.highlight,
						node.payload.mix,
						imageInput,
						effectResult,
					),
					reach: 0,
					// feColorMatrix + feComponentTransfer + feComposite are all native SVG.
					tier: "native",
				};
			case "find-edges":
				return {
					primitives: findEdgesPrimitives(
						node.payload.invert,
						node.payload.mix,
						imageInput,
						effectResult,
					),
					reach: 0,
					// feColorMatrix + feConvolveMatrix + feComposite are all native SVG.
					tier: "native",
				};
			case "scanline":
				return {
					primitives: scanlinePrimitives(
						node.payload.density,
						node.payload.intensity,
						node.payload.softness,
						node.payload.noiseMix,
						imageInput,
						effectResult,
					),
					reach: 0,
					// feTurbulence + feColorMatrix + feComponentTransfer + feBlend are all
					// native SVG (no feImage/SMIL).
					tier: "native",
				};
			case "warp":
				return {
					primitives: warpPrimitives(
						node.payload.mode,
						node.payload.strength,
						node.payload.centerX,
						node.payload.centerY,
						imageInput,
						effectResult,
					),
					reach: 0,
					// feImage(generated map) + feDisplacementMap render natively in
					// browser SVG (editor, exported SVG, WebM capture — all verified).
					tier: "native",
				};
			default:
				return { primitives: [], reach: 0, tier: "native" };
		}
	})();

	if (built.primitives.length === 0) {
		// Neutral effect: pass the input through unchanged.
		return {
			primitives: [],
			output: imageInput,
			outwardReach: 0,
			fidelity:
				built.tier === "deferred"
					? fidelity(
							node.id,
							"deferred",
							"particle TextureRecipe is rendered by the GPU raster surface; omitted from the SVG prefix to avoid double application",
						)
					: nativeFidelity(node.id),
		};
	}

	if (!maskInput) {
		return {
			primitives: built.primitives,
			output: effectResult,
			outwardReach: built.reach,
			fidelity:
				built.tier === "native"
					? nativeFidelity(node.id)
					: fidelity(
							node.id,
							"approx",
							`${node.kind} compiled through the SVG filter approximation tier`,
						),
		};
	}

	// Per-pixel lerp `effect·m + input·(1-m)`: clip the effect INSIDE the matte
	// (`in` → effect⊙m) and the untouched input OUTSIDE it (`out` → input⊙(1-m)),
	// both premultiplied, then ADD them with an arithmetic composite (k2=k3=1). This
	// is exact for ANY matte alpha — including a FEATHERED mask — unlike an feMerge
	// (`over`), which carries a spurious (1 - effect_a·m) factor on the base term and
	// over-softens partial-alpha boundaries (α 0.5 → 0.75). Compositing is now exact,
	// so the node's fidelity reflects the underlying effect tier (native blur stays
	// native); the matte derivation reports its own fidelity on the mask node.
	const gatedResult = `${result}-gated`;
	const baseResult = `${result}-base`;
	return {
		primitives: [
			...built.primitives,
			{
				kind: "composite",
				operator: "in",
				in: effectResult,
				in2: maskInput,
				result: gatedResult,
			},
			{
				kind: "composite",
				operator: "out",
				in: imageInput,
				in2: maskInput,
				result: baseResult,
			},
			{
				kind: "composite",
				operator: "arithmetic",
				k1: 0,
				k2: 1,
				k3: 1,
				k4: 0,
				in: gatedResult,
				in2: baseResult,
				result,
			},
		],
		output: result,
		outwardReach: built.reach,
		fidelity:
			built.tier === "native"
				? nativeFidelity(node.id)
				: fidelity(
						node.id,
						"approx",
						`${node.kind} compiled through the SVG filter approximation tier`,
					),
	};
};

/** Compiles a `composite` node blending its overlay branch over its base branch. */
const compileCompositeNode = (
	node: LookGraphNode,
	baseInput: string,
	overlayInput: string | undefined,
	result: string,
): EffectCompileResult => {
	if (node.payload.kind !== "composite" || overlayInput === undefined) {
		return {
			primitives: [],
			output: baseInput,
			outwardReach: 0,
			fidelity: nativeFidelity(node.id),
		};
	}
	const { blendMode, mix } = node.payload;
	const primitives: FilterPrimitive[] = [];
	let overlayPixel = overlayInput;
	if (mix < 1) {
		const mixResult = `${result}-mix`;
		primitives.push({
			kind: "color-matrix",
			matrixType: "matrix",
			values: alphaScaleMatrix(mix),
			in: overlayInput,
			result: mixResult,
		});
		overlayPixel = mixResult;
	}
	// feBlend treats `in` as the top layer and `in2` as the backdrop, so the
	// overlay branch composites OVER the base branch. Swapping these silently
	// inverts asymmetric modes (overlay/soft-light/dodge/burn) — do not reorder.
	primitives.push({
		kind: "blend",
		mode: blendMode,
		in: overlayPixel,
		in2: baseInput,
		result,
	});
	return {
		primitives,
		output: result,
		outwardReach: 0,
		fidelity: fidelity(
			node.id,
			"approx",
			"composite blends two branches via SVG feBlend (mix is alpha-approximated; non-separable modes vary by browser)",
		),
	};
};

/**
 * A mask node produces a usable SVG alpha matte only when its source is an
 * image-derived channel (alpha/luminance). An externally-referenced mask
 * (`source: "mask"`) or an influence-assignment mask has no SVG tier and is
 * deferred, so consumers must treat it as unmasked.
 */
const maskProducesMatte = (node: LookGraphNode): boolean => {
	if (node.payload.kind !== "mask" || !node.enabled) return false;
	if (node.payload.source === "mask") return false;
	if ((node.payload.influenceAssignmentIds?.length ?? 0) > 0) return false;
	return true;
};

/** Compiles a `mask` node into an alpha matte (approximation), or defers it. */
const compileMaskNode = (
	node: LookGraphNode,
	imageInput: string,
	result: string,
): EffectCompileResult => {
	if (node.payload.kind !== "mask") {
		return {
			primitives: [],
			output: imageInput,
			outwardReach: 0,
			fidelity: nativeFidelity(node.id),
		};
	}
	if (!maskProducesMatte(node)) {
		// No SVG matte target: keep the node visible in the plan but mark it
		// deferred and pass the image through so nothing downstream gates on it.
		return {
			primitives: [],
			output: imageInput,
			outwardReach: 0,
			fidelity: fidelity(
				node.id,
				"deferred",
				"mask source has no SVG matte path (external/influence mask); runtime/capture only",
			),
		};
	}
	const { source, invert, feather } = node.payload;
	const feathered = feather !== undefined && feather > 0;
	const matrixResult = feathered ? `${result}-m` : result;
	const primitives: FilterPrimitive[] = [
		{
			kind: "color-matrix",
			matrixType: "matrix",
			values: maskMatrix(source, invert ?? false),
			in: imageInput,
			result: matrixResult,
		},
	];
	if (feathered) {
		primitives.push({
			kind: "gaussian-blur",
			in: matrixResult,
			stdDeviation: (feather ?? 0) * MASK_FEATHER_SIGMA,
			result,
		});
	}
	return {
		primitives,
		output: result,
		outwardReach: 0,
		fidelity: fidelity(
			node.id,
			"approx",
			"mask is derived as an SVG alpha matte approximation",
		),
	};
};

const compileNode = (
	node: LookGraphNode,
	order: number,
	inputs: Readonly<Record<string, string>>,
	maskInput: string | undefined,
	baseInput: string,
	renderContext: LookGraphRenderContext,
): EffectCompileResult => {
	// `result` is keyed on the topo order so every node's base name — and the
	// builder-internal `-blur`/`-noise`/`-sat`/`-fx`/`-gated` suffixes derived
	// from it — stay unique across branches that rejoin at a composite.
	const result = `look-${order}-${svgIdSegment(node.id)}`;
	const imageInput = inputs.image ?? baseInput;
	switch (node.kind) {
		case "source":
			return {
				primitives: [],
				output: baseInput,
				outwardReach: 0,
				fidelity: nativeFidelity(node.id),
			};
		case "output":
			return {
				primitives: [],
				output: imageInput,
				outwardReach: 0,
				fidelity: nativeFidelity(node.id),
			};
		case "noise-field":
			// A SOURCE/generator: it ignores any image input and EMITS a region-filling
			// fractal-noise field (feTurbulence -> grayscale). Mirrors `source`'s early
			// return position but produces primitives instead of re-exporting SourceGraphic.
			// SVG-native — renders identically in editor canvas, SVG export, and Worker.
			return node.payload.kind === "noise-field"
				? {
						primitives: noiseFieldPrimitives(node.payload, result),
						output: result,
						outwardReach: 0,
						fidelity: nativeFidelity(node.id),
					}
				: {
						primitives: [],
						output: imageInput,
						outwardReach: 0,
						fidelity: nativeFidelity(node.id),
					};
		case "grade":
		case "glow":
		case "grain":
		case "blur":
		case "chromatic-fringe":
		case "displace":
		case "posterize":
		case "color-map":
		case "find-edges":
		case "scanline":
		case "warp":
			return compileEffectNode(
				node,
				imageInput,
				maskInput,
				result,
				renderContext,
			);
		case "halftone":
			// Halftone is a GPU raster-finish dot-screen effect: it samples source
			// luminance per rotated cell and maps that to dot radius in a fragment
			// shader. SVG filters can only pass through here, so SVG/PDF/Worker
			// surfaces honestly omit it while editor canvas + video/WebGL playback
			// render the GPU pass.
			return {
				primitives: [],
				output: imageInput,
				outwardReach: 0,
				fidelity: fidelity(
					node.id,
					"deferred",
					"halftone is a GPU raster-finish dot-screen effect; editor canvas + video/WebGL playback only",
				),
			};
		case "pixel-grid":
			// Pixel Grid is a GPU raster-finish display-cell effect: it samples
			// source colour per cell and draws an anti-aliased lit cell mask in a
			// fragment shader. SVG filters pass through honestly here.
			return {
				primitives: [],
				output: imageInput,
				outwardReach: 0,
				fidelity: fidelity(
					node.id,
					"deferred",
					"pixel-grid is a GPU raster-finish display-cell effect; editor canvas + video/WebGL playback only",
				),
			};
		case "ordered-dither":
			// Ordered Dither is a true Bayer matrix threshold in the GPU raster
			// pass. The rejected native-tier noise approximation is intentionally
			// not revived here.
			return {
				primitives: [],
				output: imageInput,
				outwardReach: 0,
				fidelity: fidelity(
					node.id,
					"deferred",
					"ordered-dither is a GPU raster-finish Bayer matrix effect; editor canvas + video/WebGL playback only",
				),
			};
		case "ascii-glyph":
			// Glyph Mosaic maps source luminance to a fixed procedural ASCII ramp in
			// the GPU raster pass. Static SVG/PDF/Worker export must not fake this
			// as thousands of text nodes or an unproven font atlas.
			return {
				primitives: [],
				output: imageInput,
				outwardReach: 0,
				fidelity: fidelity(
					node.id,
					"deferred",
					"ascii-glyph is a GPU raster-finish procedural glyph mosaic; editor canvas + video/WebGL playback only",
				),
			};
		case "block-mosaic":
			// Block Mosaic is a raster-space relief reconstruction: it samples one
			// source colour per stable cell, then shades bevels/grout in the GPU.
			// SVG filters cannot express that per-cell lighting contract honestly.
			return {
				primitives: [],
				output: imageInput,
				outwardReach: 0,
				fidelity: fidelity(
					node.id,
					"deferred",
					"block-mosaic is a GPU raster-finish raised-tile effect; editor canvas + video/WebGL playback only",
				),
			};
		case "lens":
			// Lens is a GPU raster-finish effect: a spherical refraction that
			// feDisplacementMap provably tears on. It has no SVG filter path, so it
			// emits NO primitives and passes the image through here; the GPU overlay
			// renders it on the editor canvas (and WebM capture). Marked `deferred`
			// so SVG/PDF export honestly omit it and report it as not-rendered.
			return {
				primitives: [],
				output: imageInput,
				outwardReach: 0,
				fidelity: fidelity(
					node.id,
					"deferred",
					"lens is a GPU raster-finish effect with no SVG filter path; editor canvas + video capture only",
				),
			};
		case "kaleidoscope":
			// Kaleidoscope is a GPU raster-finish effect (N-fold wedge-and-mirror UV
			// remap) with no SVG path, like the lens. Emits no primitives; rendered on
			// the GPU surface. `deferred` → honest SVG/PDF omission.
			return {
				primitives: [],
				output: imageInput,
				outwardReach: 0,
				fidelity: fidelity(
					node.id,
					"deferred",
					"kaleidoscope is a GPU raster-finish effect with no SVG filter path; editor canvas + video capture only",
				),
			};
		case "flow":
			// Flow is a GPU raster-finish effect (evolving fractal-noise displacement)
			// with no SVG path — SVG noise provably cannot evolve smoothly. Emits no
			// primitives; rendered on the GPU surface. `deferred` → honest SVG/PDF
			// omission.
			return {
				primitives: [],
				output: imageInput,
				outwardReach: 0,
				fidelity: fidelity(
					node.id,
					"deferred",
					"flow is a GPU raster-finish effect with no SVG filter path; editor canvas + video capture only",
				),
			};
		case "path-blur":
			// Path Blur is a GPU raster-finish effect (directional curvature-following
			// streak along user guide paths) with no SVG path — feDisplacementMap cannot
			// follow a curved velocity field. Emits no primitives; rendered on the GPU
			// surface. `deferred` → honest SVG/PDF omission.
			return {
				primitives: [],
				output: imageInput,
				outwardReach: 0,
				fidelity: fidelity(
					node.id,
					"deferred",
					"path-blur is a GPU raster-finish effect with no SVG filter path; editor canvas + video capture only",
				),
			};
		case "noise-source":
			// A GPU procedural-noise SOURCE that BOILS (the SVG noise-field can't evolve in
			// place). Unlike noise-field it emits NO SVG primitives — so it must pass
			// `imageInput` through (NOT `output: result`, which would dangle a never-emitted
			// filter result), exactly like the other GPU effects. `deferred` → honest SVG/PDF
			// omission; the GPU surface writes the field on the editor canvas + WebM.
			return {
				primitives: [],
				output: imageInput,
				outwardReach: 0,
				fidelity: fidelity(
					node.id,
					"deferred",
					"noise-source is a GPU raster procedural-noise source with no SVG filter path; editor canvas + video capture only",
				),
			};
		case "deep-glow":
			// Deep Glow is a GPU raster-finish effect (threshold-extracted, multi-scale-
			// blurred bloom over the chain's composited output) with no SVG path. Emits no
			// primitives; rendered on the GPU surface. `deferred` → honest SVG/PDF omission.
			return {
				primitives: [],
				output: imageInput,
				outwardReach: 0,
				fidelity: fidelity(
					node.id,
					"deferred",
					"deep-glow is a GPU raster-finish effect with no SVG filter path; editor canvas + video capture only",
				),
			};
		case "riso":
			// Riso is a GPU raster-finish dot-screen effect: it samples source
			// luminance per rotated cell, per spot ink, and maps that to dot radius in
			// a fragment shader. SVG filters can only pass through here, so SVG/PDF/
			// Worker surfaces honestly omit it while editor canvas + video/WebGL
			// playback render the GPU pass.
			return {
				primitives: [],
				output: imageInput,
				outwardReach: 0,
				fidelity: fidelity(
					node.id,
					"deferred",
					"riso is a GPU raster-finish dot-screen effect; editor canvas + video/WebGL playback only",
				),
			};
		case "colorama":
			// Colorama is a GPU raster-finish effect (cyclic luminance→palette ramp)
			// with no SVG filter path — SVG `feComponentTransfer` tables cannot
			// animate a phase-shifted cyclic ramp per frame. Emits no primitives;
			// rendered on the GPU surface. `deferred` → honest SVG/PDF omission.
			return {
				primitives: [],
				output: imageInput,
				outwardReach: 0,
				fidelity: fidelity(
					node.id,
					"deferred",
					"colorama is a GPU raster-finish effect with no SVG filter path; editor canvas + video capture only",
				),
			};
		case "wave-warp":
			// Wave Warp is a GPU raster-finish effect (periodic transverse
			// displacement) with no SVG filter path — SVG `feDisplacementMap` cannot
			// animate the travelling wave's phase per frame. Emits no primitives;
			// rendered on the GPU surface. `deferred` → honest SVG/PDF omission.
			return {
				primitives: [],
				output: imageInput,
				outwardReach: 0,
				fidelity: fidelity(
					node.id,
					"deferred",
					"wave-warp is a GPU raster-finish effect with no SVG filter path; editor canvas + video capture only",
				),
			};
		case "bend-warp":
			// Bend Warp is a GPU raster-finish effect (arc bend + H/V shear) with no
			// SVG filter path — SVG filters cannot express this remap. Emits no
			// primitives; rendered on the GPU surface. `deferred` → honest SVG/PDF
			// omission.
			return {
				primitives: [],
				output: imageInput,
				outwardReach: 0,
				fidelity: fidelity(
					node.id,
					"deferred",
					"bend-warp is a GPU raster-finish effect with no SVG filter path; editor canvas + video capture only",
				),
			};
		case "vhs-color":
			// VHS Color is a GPU raster-finish effect (YUV chroma lowpass +
			// subsample + color-under quantize) with no SVG filter path — SVG
			// filters have no colorspace-conversion primitive. Emits no
			// primitives; rendered on the GPU surface. `deferred` → honest SVG/PDF
			// omission.
			return {
				primitives: [],
				output: imageInput,
				outwardReach: 0,
				fidelity: fidelity(
					node.id,
					"deferred",
					"vhs-color is a GPU raster-finish effect with no SVG filter path; editor canvas + video capture only",
				),
			};
		case "vhs-tracking":
			// VHS Tracking is a GPU raster-finish effect (per-scanline time-base
			// jitter/wow-flutter remap + head-switch/tracking-error noise bands)
			// with no SVG filter path. Emits no primitives; rendered on the GPU
			// surface. `deferred` → honest SVG/PDF omission.
			return {
				primitives: [],
				output: imageInput,
				outwardReach: 0,
				fidelity: fidelity(
					node.id,
					"deferred",
					"vhs-tracking is a GPU raster-finish effect with no SVG filter path; editor canvas + video capture only",
				),
			};
		case "vhs-noise":
			// VHS Noise is a GPU raster-finish effect (hash-noise snow, row-segment
			// dropout streaks, generation-loss softness/desaturation/contrast
			// crush) with no SVG filter path. Emits no primitives; rendered on the
			// GPU surface. `deferred` → honest SVG/PDF omission.
			return {
				primitives: [],
				output: imageInput,
				outwardReach: 0,
				fidelity: fidelity(
					node.id,
					"deferred",
					"vhs-noise is a GPU raster-finish effect with no SVG filter path; editor canvas + video capture only",
				),
			};
		case "crt-display":
			// CRT Display is a GPU raster-finish effect (barrel uv-remap + rounded-
			// corner bezel + shadow-mask modulation + vignette) with no SVG filter
			// path — SVG filters have no colorspace-free screen-mask primitive.
			// Emits no primitives; rendered on the GPU surface. `deferred` → honest
			// SVG/PDF omission.
			return {
				primitives: [],
				output: imageInput,
				outwardReach: 0,
				fidelity: fidelity(
					node.id,
					"deferred",
					"crt-display is a GPU raster-finish effect with no SVG filter path; editor canvas + video capture only",
				),
			};
		case "signal-glitch":
			// Signal Glitch is a GPU raster-finish effect (per-row tear-band hash
			// remap + vertical roll + 3-tap channel split) with no SVG filter path.
			// Emits no primitives; rendered on the GPU surface. `deferred` → honest
			// SVG/PDF omission.
			return {
				primitives: [],
				output: imageInput,
				outwardReach: 0,
				fidelity: fidelity(
					node.id,
					"deferred",
					"signal-glitch is a GPU raster-finish effect with no SVG filter path; editor canvas + video capture only",
				),
			};
		case "interlace":
			// Interlace is a GPU raster-finish effect (screen-space field-parity
			// comb + odd-field displacement) with no SVG filter path. Emits no
			// primitives; rendered on the GPU surface. `deferred` → honest SVG/PDF
			// omission.
			return {
				primitives: [],
				output: imageInput,
				outwardReach: 0,
				fidelity: fidelity(
					node.id,
					"deferred",
					"interlace is a GPU raster-finish effect with no SVG filter path; editor canvas + video capture only",
				),
			};
		case "composite":
			return compileCompositeNode(
				node,
				inputs.base ?? baseInput,
				inputs.overlay,
				result,
			);
		case "mask":
			return compileMaskNode(node, imageInput, result);
	}
};

const outputValueTypeForNode = (node: LookGraphNode): LookGraphValueType =>
	node.outputs[0]?.valueType ?? "image";

/**
 * Lowers a {@link LookGraph} into a renderer-neutral {@link LookGraphPlan}. Nodes
 * compile in topological order so edge direction — not array order — determines
 * the primitive chain, which is why `Glow -> Grain` and `Grain -> Glow` produce
 * different plans. Branches (mask gates, composite merges) are lowered to the SVG
 * approximation tier; unsupported constructs report fidelity issues rather than
 * silently disappearing.
 */
export function compileLookGraph(
	graph: LookGraph,
	options: CompileLookGraphOptions,
): LookGraphPlan {
	// Re-normalize defensively so the cache key and topology match the canonical
	// graph even if a caller passes a hand-built one. A valid graph round-trips.
	const normalized = normalizeLookGraph(graph) ?? graph;
	const baseInput = options.input ?? DEFAULT_INPUT;
	const renderContext: LookGraphRenderContext = {
		bounds: options.bounds ?? DEFAULT_TEXTURE_BOUNDS,
		rasterSafe: options.rasterSafe ?? false,
		deferGpuRasterEffects: options.deferGpuRasterEffects ?? false,
		...(options.frameTimeSeconds !== undefined
			? { frameTimeSeconds: options.frameTimeSeconds }
			: {}),
	};
	// A composite defers (drops its SVG feBlend) only when the WHOLE graph renders as a GPU
	// composite tree — i.e. `rasterPlan` succeeds. Gating on the global tree (not just "a
	// branch has a GPU node") keeps the compile and the GPU pipeline in lockstep: a mixed
	// graph (e.g. a nested composite with an SVG branch) keeps every feBlend so the
	// composite is never dropped from both SVG and GPU.
	const rendersAsGpuTree = rasterPlan(normalized) !== null;
	const { order, cyclicNodeIds } = topoOrder(normalized);
	const outputPixelByNode = new Map<string, string>();
	const incoming = incomingEdges(normalized);
	const validMaskProducers = new Set<string>();
	const compiled: CompiledLookNode[] = [];
	let outwardReach = 0;

	// Resolves the matte pixel feeding a node's `mask` port, but only when the
	// producer actually emitted a usable matte (enabled, image-derived). A
	// bypassed or deferred mask producer leaves the consumer unmasked instead of
	// feeding an image pixel where a matte is expected.
	const maskInputForNode = (
		node: LookGraphNode,
		edges: readonly LookGraphEdge[],
	): string | undefined => {
		for (const edge of edges) {
			const inputPort = node.inputs.find((port) => port.id === edge.to.portId);
			if (inputPort?.name !== "mask") continue;
			if (!validMaskProducers.has(edge.from.nodeId)) continue;
			const pixel = outputPixelByNode.get(edge.from.nodeId);
			if (pixel !== undefined) return pixel;
		}
		return undefined;
	};

	for (const [index, node] of order.entries()) {
		const nodeEdges = incoming.get(node.id) ?? [];
		const inputs = resolveInputs(node, nodeEdges, outputPixelByNode);
		const isEffectKind = node.kind !== "source" && node.kind !== "output";
		if (isEffectKind && !node.enabled) {
			// Bypassed node: pass its primary image input straight through. A
			// composite's primary image port is "base", not "image", so fall back
			// to it before the source graphic to keep an upstream chain intact.
			const passthrough = inputs.image ?? inputs.base ?? baseInput;
			outputPixelByNode.set(node.id, passthrough);
			compiled.push({
				nodeId: node.id,
				kind: node.kind,
				enabled: false,
				inputs,
				output: passthrough,
				outputValueType: outputValueTypeForNode(node),
				primitives: [],
				outwardReach: 0,
				fidelity: nativeFidelity(node.id),
			});
			continue;
		}
		const maskInput = maskInputForNode(node, nodeEdges);
		// A composite whose branches carry a GPU raster effect is composited on the GPU
		// surface, not in SVG: defer it (no feBlend) so the SVG source stays the shared
		// artboard and the GPU pipeline blends the two branches. Pure-SVG composites keep
		// their feBlend below.
		const result =
			node.kind === "composite" &&
			rendersAsGpuTree &&
			canGpuComposite(normalized, node)
				? {
						primitives: [],
						output: inputs.base ?? inputs.image ?? baseInput,
						outwardReach: 0,
						fidelity: fidelity(
							node.id,
							"deferred",
							"composite blends GPU raster branches on the editor canvas + WebM (no SVG/PDF path)",
						),
					}
				: compileNode(node, index, inputs, maskInput, baseInput, renderContext);
		outputPixelByNode.set(node.id, result.output);
		if (node.kind === "mask" && maskProducesMatte(node)) {
			validMaskProducers.add(node.id);
		}
		outwardReach = Math.max(outwardReach, result.outwardReach);
		compiled.push({
			nodeId: node.id,
			kind: node.kind,
			enabled: node.enabled,
			inputs,
			output: result.output,
			outputValueType: outputValueTypeForNode(node),
			primitives: result.primitives,
			outwardReach: result.outwardReach,
			fidelity: result.fidelity,
		});
	}

	// Defensive: a residual cycle (should not survive normalization) is reported
	// as an unsupported node rather than dropped.
	for (const nodeId of cyclicNodeIds) {
		const node = normalized.nodes.find((candidate) => candidate.id === nodeId);
		if (!node) continue;
		compiled.push({
			nodeId,
			kind: node.kind,
			enabled: node.enabled,
			inputs: {},
			output: baseInput,
			outputValueType: outputValueTypeForNode(node),
			primitives: [],
			outwardReach: 0,
			fidelity: fidelity(
				nodeId,
				"unsupported",
				"node participates in a cycle and was not compiled",
			),
		});
	}

	const outputPixel =
		outputPixelByNode.get(normalized.outputNodeId) ?? baseInput;
	const output: LookGraphEndpoint = {
		nodeId: normalized.outputNodeId,
		portId: lookGraphPortId(normalized.outputNodeId, "input", "image"),
	};

	return {
		owner: options.owner,
		input: baseInput,
		nodes: compiled,
		edges: normalized.edges,
		output,
		outputPixel,
		cacheKey: JSON.stringify({
			owner: options.owner,
			graph: normalized,
			renderContext,
		}),
		outwardReach,
		fidelity: compiled.map((node) => node.fidelity),
	};
}

/**
 * Lowers a compiled Look graph into one SVG `<filter>` spec for a frame-level look,
 * reusing the shared {@link FilterPrimitive} chain so the graph renders through the
 * same `serializeEffectFilter` pixel pipeline as node looks. Returns `null` when the
 * look is a no-op (the output is the unmodified source graphic, or no primitives are
 * produced) so callers can skip emitting an empty filter.
 *
 * SVG uses the LAST primitive as the filter result, but a disabled node or a
 * dead/dangling branch can be emitted last; the plan's `outputPixel` is therefore
 * forced as the result with a trailing `feMerge` (a single-input copy) so the
 * filter always outputs the graph's true output regardless of branch ordering.
 */
export function lookGraphPlanToEffectFilter(
	plan: LookGraphPlan,
	options: { readonly id: string; readonly bounds: Bounds },
): EffectFilterSpec | null {
	if (plan.outputPixel === plan.input) return null;
	const primitives = plan.nodes.flatMap((node) => node.primitives);
	if (primitives.length === 0) return null;
	const pad = Math.max(0, plan.outwardReach);
	return {
		id: options.id,
		region: {
			x: options.bounds.x - pad,
			y: options.bounds.y - pad,
			width: options.bounds.width + pad * 2,
			height: options.bounds.height + pad * 2,
		},
		primitives: [...primitives, { kind: "merge", inputs: [plan.outputPixel] }],
		deferred: [],
	};
}
