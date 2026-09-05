/**
 * WebGPU RHI-lite: device init, canvas swapchain config, one MSAA + depth-
 * stencil render pass, a flat-color/gradient world-space quad pipeline
 * (backgrounds + the S2/S3 cover pass), the S2 stencil-then-cover solid-fill
 * pipeline pair, and (S3) a stencil-then-cover uniform-stroke pipeline pair.
 * See `docs/gpu-canvas-convergence-e1-plan.md` (D3/D4) for the decided scope.
 *
 * Back-port guardrail (D3): callers of this module only see the
 * `GpuCanvasSurface` methods in `types.ts` — never a raw `GPUDevice`,
 * `GPUBindGroup`, or `GPURenderPassDescriptor` — so a future WebGL2 backend
 * can implement the same surface contract without changing call sites.
 *
 * Browser-only by design, exactly like `shared/gpu-lens/surface.ts`: the
 * caller degrades honestly to the existing SVG layer when
 * {@link createGpuCanvasSurface} resolves `null` (no `navigator.gpu`, no
 * adapter, no device, or context configuration failure). This module must
 * only ever be reached via a lazy `import()` behind the `gpuCanvas` flag —
 * `check:bundle` cannot detect an eagerly-imported hand-rolled GPU module, so
 * the lazy boundary lives in the caller (`GpuSceneCanvas.tsx`), not here.
 *
 * STENCIL-THEN-COVER (S2, D4; extended S3 for strokes): one path's fill (or
 * one stroke's extrusion mesh) draws as (1) a STENCIL pass — world-space
 * geometry (pre-transformed CPU-side, see `flatten.ts::fanTriangulateRings`
 * for fills / `stroke-mesh.ts::buildStrokeMesh` for strokes) written with
 * `colorWriteMask: 0` so only the stencil buffer changes; nonzero winding
 * uses `increment-wrap` front / `decrement-wrap` back (cull mode `"none"`,
 * both faces draw — fills' evenodd variant uses `invert` on both faces
 * instead; strokes are ALWAYS nonzero, see `stroke-mesh.ts`'s winding-
 * discipline doc comment) — then (2) a COVER pass — the SAME world-rect quad
 * pipeline as the background quads, gated by `stencilCompare: "not-equal"`
 * against a stencil-reference of `0` so only pixels the stencil pass touched
 * get painted. The cover pass's `passOp`/`failOp` are BOTH `"zero"`: a
 * fragment whose stencil is already `0` FAILS the not-equal-0 test, and
 * `failOp: "zero"` on an already-zero value is a no-op; a fragment INSIDE the
 * filled/stroked region has nonzero stencil, PASSES, and `passOp: "zero"`
 * resets it — so covering one path's/stroke's stencil bits back to 0 needs no
 * separate clear pass before the next draw's stencil pass. Every stencil
 * pipeline and the cover pipeline share the SAME depth-stencil attachment
 * created for the background quads; the MSAA color attachment resolves once
 * per FRAME as before, never per path/stroke.
 *
 * PAINT ORDER (post-S4 review fix): `renderFrame` replays each artboard's
 * `draws` as ONE ordered list, dispatching each entry to the fill or stroke
 * pipeline pair per-entry (see the draw-encoding loop's comment below) —
 * `GpuArtboardContent.draws` (`shared/gpu/types.ts`) is already in the
 * compiler's true document paint order, fills and strokes interleaved. The
 * PREVIOUS shape (`GpuArtboardContent.fills`/`.strokes` as two separate
 * arrays) drew "every artboard's fills, THEN every artboard's strokes",
 * which silently inverted z-order for any later-node fill drawn over an
 * earlier-node's stroke whenever the two overlapped on screen — this was a
 * real cross-node rendering bug, not just a same-node ordering nuance.
 *
 * SINGLE-LEVEL CLIP MASKS (E1 S7 — see
 * `docs/gpu-canvas-convergence-e1-plan.md`'s S7 decisions and
 * `CLIP_STENCIL_BIT`'s doc comment): a `clip-begin`/`clip-end` pair in
 * `draws` brackets its masked content's own fill/stroke entries, still
 * within the SAME one-render-pass-per-frame structure (no second stencil
 * attachment, no extra clear) by PARTITIONING the one 8-bit stencil buffer:
 * bit 7 (`CLIP_STENCIL_BIT`) encodes "inside the open clip scope's
 * silhouette," bits 0-6 (`WINDING_STENCIL_MASK`) keep doing ordinary
 * nonzero/evenodd winding accumulation for whichever geometry is drawing
 * right now (the scope's own silhouette during MATERIALIZE, or the masked
 * content's fills/strokes once the scope is open) — the two concerns never
 * collide because every winding-accumulating pipeline's write mask now
 * excludes bit 7, and every clip pipeline's read/write mask is scoped to
 * only the bit(s) it actually needs (see `clipMaterializePipeline`/
 * `clipClearPipeline`/`clippedCoverPipelineDescriptor`'s own doc comments
 * for the exact per-pipeline masks). `renderFrame`'s replay loop tracks one
 * `clipActive` boolean per artboard (reset `false` at the top of each
 * artboard's own draw loop — a scope never spans artboards) that selects
 * between the ordinary unclipped cover pipelines (reference `0`) and their
 * CLIPPED counterparts (reference `CLIP_STENCIL_BIT`) for every fill/
 * image-fill/stroke cover draw while a scope is open.
 */

import {
	CHROMATIC_ABERRATION_SHADER_SOURCE,
	FRAME_FILM_GRAIN_SHADER_SOURCE,
	IMAGE_QUAD_SHADER_SOURCE,
	NODE_OPTICAL_EFFECT_SHADER_SOURCE,
	QUAD_SHADER_SOURCE,
	SOURCE_COMPOSITE_SHADER_SOURCE,
	STENCIL_SHADER_SOURCE,
	STROKE_STENCIL_SHADER_SOURCE,
} from "./quad-shader";
import { STROKE_VERTEX_FLOAT_COUNT } from "./stroke-mesh";
import type { GpuCachedTexture } from "./texture-cache";
import {
	createGpuTextureCache,
	loadImageBitmapFromHref,
} from "./texture-cache";
import type {
	GpuArtboardChromaticAberrationPostEffect,
	GpuArtboardFilmGrainPostEffect,
	GpuBlendMode,
	GpuCamera,
	GpuCanvasSurface,
	GpuColor,
	GpuFillDraw,
	GpuFrameSpec,
	GpuNodeEffect,
	GpuPaint,
	GpuQuad,
	GpuSurfaceConfig,
} from "./types";
import { MAX_DASH_PATTERN_ENTRIES, MAX_GRADIENT_STOPS } from "./types";

/**
 * Backing-store DPR ceiling (D4). SVG stays DPR-native; capping the GPU
 * backing store at 2x is an accepted, documented E1 tradeoff (softness on 3x+
 * displays) revisited in E2 when an iPad thin shell is the actual target.
 */
export const MAX_BACKING_DPR = 2;

/** MSAA sample count for both the color and depth-stencil attachments. */
const MSAA_SAMPLE_COUNT = 4;

const DEPTH_STENCIL_FORMAT: GPUTextureFormat = "depth24plus-stencil8";

const BYTES_PER_FLOAT = 4;
/** `f32` count in one `vec4<f32>` field group. */
const VEC4_FLOAT_COUNT = 4;

/**
 * Total `f32` count in one `QuadUniforms` instance (E1 S3 — see
 * `quad-shader.ts`'s doc comment for the full field list): 8 plain
 * `vec4<f32>` fields (`rect`, `color`, `camera`, `viewport`, `paintMeta`,
 * `gradientGeometry`, `worldToLocalRow0`, `worldToLocalRow1`) plus the packed
 * `stopOffsets` array (`MAX_GRADIENT_STOPS / 4` vec4s) plus the `stopColors`
 * array (`MAX_GRADIENT_STOPS` vec4s).
 */
const QUAD_UNIFORM_PLAIN_FIELD_COUNT = 8;
const UNIFORM_FLOAT_COUNT =
	QUAD_UNIFORM_PLAIN_FIELD_COUNT * VEC4_FLOAT_COUNT +
	(MAX_GRADIENT_STOPS / 4) * VEC4_FLOAT_COUNT +
	MAX_GRADIENT_STOPS * VEC4_FLOAT_COUNT;
const UNIFORM_STRUCT_BYTES = UNIFORM_FLOAT_COUNT * BYTES_PER_FLOAT;

/** Float offset (not byte offset) of each `QuadUniforms` field within the flat scratch buffer — see `writeQuadUniforms`. */
const QUAD_UNIFORM_OFFSETS = {
	rect: 0,
	color: 4,
	camera: 8,
	viewport: 12,
	paintMeta: 16,
	gradientGeometry: 20,
	worldToLocalRow0: 24,
	worldToLocalRow1: 28,
	stopOffsets: 32,
	stopColors: 32 + (MAX_GRADIENT_STOPS / 4) * VEC4_FLOAT_COUNT,
} as const;

type GpuImagePaint = Extract<GpuPaint, { readonly kind: "image" }>;

const imageFitMode = (fit: GpuImagePaint["fit"]): number => {
	switch (fit) {
		case "fit":
			return 1;
		case "crop":
			return 2;
		default:
			return 0;
	}
};

/**
 * Fallback per-quad dynamic-offset stride when `device.limits` is unavailable
 * (should not happen on a real adapter, but keeps this module total). The
 * WebGPU spec guarantees `minUniformBufferOffsetAlignment` is at most 256, so
 * this is a safe, spec-conformant default.
 */
const FALLBACK_UNIFORM_STRIDE = 256;

/** Number of quad uniform slots the uniform buffer starts with; grows on demand. */
const INITIAL_QUAD_CAPACITY = 64;

/** Bytes per world-space stencil vertex: `vec2<f32>` (`x`, `y`). */
const STENCIL_VERTEX_BYTES = 2 * BYTES_PER_FLOAT;

/** Initial stencil vertex buffer capacity, in vertices; grows (doubling) on demand. */
const INITIAL_STENCIL_VERTEX_CAPACITY = 3 * 256;

/**
 * Bytes per stroke-mesh vertex: `vec2<f32>` position + `vec2<f32>` offset +
 * (E1 S8) `f32` arcLength — see `stroke-mesh.ts::STROKE_VERTEX_FLOAT_COUNT`,
 * the single source of truth this derives from so the two never drift.
 */
const STROKE_VERTEX_BYTES = STROKE_VERTEX_FLOAT_COUNT * BYTES_PER_FLOAT;

/** Initial stroke vertex buffer capacity, in vertices; grows (doubling) on demand. */
const INITIAL_STROKE_VERTEX_CAPACITY = 3 * 256;

/**
 * `f32` count in `StrokeDrawUniforms` (E1 S8 — see `quad-shader.ts`'s
 * `STROKE_STENCIL_SHADER_SOURCE` doc comment for the full field derivation):
 * 4 plain `vec4<f32>` fields — `halfWidthWorld` (S3, x used, yzw padding),
 * `dashPattern0`/`dashPattern1` (8 dash-pattern entries packed 4-per-vec4,
 * matching `QuadUniforms`'s `stopOffsets` packing convention), and `dashMeta`
 * (x = dashCount, y = dashOffsetWorld, zw padding). Renamed from S3's
 * `STROKE_HALF_WIDTH_UNIFORM_*` now that this slot carries more than just the
 * half-width scalar.
 */
const STROKE_DRAW_UNIFORM_FLOAT_COUNT = 4 * VEC4_FLOAT_COUNT;
const STROKE_DRAW_UNIFORM_BYTES =
	STROKE_DRAW_UNIFORM_FLOAT_COUNT * BYTES_PER_FLOAT;

/** Initial stroke draw-uniform buffer slot capacity; grows (doubling) on demand — see `stencilCameraUniformBuffer`'s sibling machinery for the fill-camera equivalent. */
const INITIAL_STROKE_DRAW_UNIFORM_CAPACITY = 64;

/** `f32` count in `StencilCameraUniforms` (`camera`, `viewport` — 2 `vec4<f32>` fields), see `quad-shader.ts`. */
const STENCIL_CAMERA_UNIFORM_FLOAT_COUNT = 2 * 4;
const STENCIL_CAMERA_UNIFORM_BYTES =
	STENCIL_CAMERA_UNIFORM_FLOAT_COUNT * BYTES_PER_FLOAT;

/** `f32` count in one post-effect uniform slot: S17 CA reads the first four vec4s; S18 frame grain adds the fifth for grain weights/flags. */
const POST_EFFECT_UNIFORM_FLOAT_COUNT = 5 * VEC4_FLOAT_COUNT;
const POST_EFFECT_UNIFORM_BYTES =
	POST_EFFECT_UNIFORM_FLOAT_COUNT * BYTES_PER_FLOAT;

const OPTICAL_EFFECT_UNIFORM_FLOAT_COUNT = 92 * VEC4_FLOAT_COUNT;
const OPTICAL_EFFECT_UNIFORM_BYTES =
	OPTICAL_EFFECT_UNIFORM_FLOAT_COUNT * BYTES_PER_FLOAT;

/** Initial post-effect uniform slots; grows on demand for documents with many GPU-active frame looks. */
const INITIAL_POST_EFFECT_UNIFORM_CAPACITY = 8;
const INITIAL_OPTICAL_EFFECT_UNIFORM_CAPACITY = 8;

/** Stencil read/write mask: every bit (nonzero winding can exceed 1 wrap step on self-overlapping paths). */
const STENCIL_FULL_MASK = 0xff;

/**
 * E1 S7 stencil BIT PARTITION (see
 * `docs/gpu-canvas-convergence-e1-plan.md`'s S7 decisions) — the single
 * 8-bit stencil buffer is split so a clip scope's "am I inside the
 * silhouette" state (bit 7) coexists with an ORDINARY fill/stroke's winding
 * accumulator (bits 0-6) within the SAME depth-stencil attachment, the SAME
 * one-render-pass-per-frame structure, with no second attachment and no
 * extra clear. `CLIP_STENCIL_BIT` (`0x80`) is set by the MATERIALIZE pass
 * (see {@link coverPipelineDescriptor}'s clip variants below) wherever a
 * clip scope's silhouette winds nonzero, and read back by every CLIPPED
 * cover pipeline; `WINDING_STENCIL_MASK` (`0x7f`) is the read/write mask
 * EVERY winding-accumulating pipeline (fill/stroke stencil passes, and every
 * UNCLIPPED cover pipeline) now uses instead of {@link STENCIL_FULL_MASK},
 * so winding math never touches bit 7 and a clip scope's bit-7 state never
 * gets clobbered by an unrelated draw's winding accumulation.
 *
 * ACCEPTED COST: winding now wraps modulo 128 instead of modulo 256 (7 bits
 * instead of 8) — a self-overlapping path with 128+ same-direction winding
 * layers at one pixel would alias back to 0 one step earlier than before
 * this slice. This is the SAME class of edge case {@link STENCIL_FULL_MASK}'s
 * own doc comment already accepts at the 256-layer boundary; halving the
 * threshold is judged an acceptable tradeoff for gaining a whole spare bit
 * to encode clip-scope membership with zero extra render-pass machinery.
 */
const CLIP_STENCIL_BIT = 0x80;
/** See {@link CLIP_STENCIL_BIT}'s doc comment. */
const WINDING_STENCIL_MASK = 0x7f;

/**
 * Ordinary "normal" source-over `GPUBlendState` — the pre-S6 single
 * `coverPipeline`/`imageCoverPipeline`'s blend state, unchanged. Straight-
 * alpha color over a premultiplied swapchain: the fragment shader
 * premultiplies `color.rgb` by `color.a` itself, so the destination
 * contribution only needs `(1 - srcAlpha)` (see `createGpuCanvasSurface`'s
 * top doc comment for the background/stencil pipelines' identical
 * reasoning).
 */
const NORMAL_BLEND_STATE: GPUBlendState = {
	color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
	alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
};

/**
 * Fixed-function `GPUBlendState` for each E1 S6/S31 {@link GpuBlendMode}, plus
 * `"normal"` ({@link NORMAL_BLEND_STATE}) — see
 * `docs/gpu-canvas-convergence-e1-plan.md`'s S6/S31 decisions for the derivation.
 * Every mode keeps the SAME alpha-component blend as `"normal"`
 * (`{srcFactor:"one", dstFactor:"one-minus-src-alpha"}`) so interior alpha
 * stays 1 over the opaque artboard backdrop regardless of which color
 * operation runs; only the COLOR component's factors/operation change per
 * mode:
 *
 * - `multiply`: `co = cs·Cb + Cb·(1−αs)` — with premultiplied source
 *   `cs = αs·Cs` over opaque backdrop `Cb`, this equals
 *   `αs·Cs·Cb + (1−αs)·Cb`, i.e. CSS `multiply`, EXACT for any source alpha.
 * - `screen`: `co = cs + Cb·(1−cs)` — EXACT for any source alpha over an
 *   opaque backdrop (this is CSS `screen`'s own definition applied to a
 *   premultiplied source, since `screen(a,b) = a + b - a*b` and the
 *   destination read IS `Cb` here).
 * - `darken`/`lighten`: `co = min(cs, Cb)` / `max(cs, Cb)` — WebGPU REQUIRES
 *   `srcFactor`/`dstFactor` to both be `"one"` when `operation` is
 *   `"min"`/`"max"` (a spec validation error otherwise). This equals CSS
 *   `darken`/`lighten` ONLY when `αs ≡ 1` (an opaque source) — see
 *   `entities/scene/model/gpu/capability.ts`'s gate (e), which admits these
 *   two modes only for an opaque-solid-only leaf paint.
 * - `exclusion`: `co = cs·(1−Cb) + Cb·(1−cs)` — with premultiplied source
 *   `cs = αs·Cs` over opaque backdrop `Cb`, this expands to
 *   `αs·Cs + Cb − 2αs·Cs·Cb`, which equals
 *   `αs·(Cs + Cb − 2Cs·Cb) + (1−αs)·Cb`, i.e. CSS `exclusion`, exact for any
 *   source alpha.
 */
const BLEND_STATE_BY_MODE: Record<GpuBlendMode | "normal", GPUBlendState> = {
	normal: NORMAL_BLEND_STATE,
	multiply: {
		color: { srcFactor: "dst", dstFactor: "one-minus-src-alpha" },
		alpha: NORMAL_BLEND_STATE.alpha,
	},
	screen: {
		color: { srcFactor: "one", dstFactor: "one-minus-src" },
		alpha: NORMAL_BLEND_STATE.alpha,
	},
	darken: {
		color: { operation: "min", srcFactor: "one", dstFactor: "one" },
		alpha: NORMAL_BLEND_STATE.alpha,
	},
	lighten: {
		color: { operation: "max", srcFactor: "one", dstFactor: "one" },
		alpha: NORMAL_BLEND_STATE.alpha,
	},
	exclusion: {
		color: { srcFactor: "one-minus-dst", dstFactor: "one-minus-src" },
		alpha: NORMAL_BLEND_STATE.alpha,
	},
};

const clearColor: GPUColorDict = { r: 0, g: 0, b: 0, a: 0 };

const nextPowerOfTwoAtLeast = (value: number, minimum: number): number => {
	let capacity = minimum;
	while (capacity < value) capacity *= 2;
	return capacity;
};

/** Rounds `value` up to the nearest multiple of `alignment` (`alignment` > 0). */
const alignUp = (value: number, alignment: number): number =>
	Math.ceil(value / alignment) * alignment;

/**
 * Attempts to create the WebGPU RHI-lite surface for `canvas`. Resolves
 * `null` (never throws) when WebGPU is unavailable or initialization fails at
 * any step, matching the `shared/gpu-lens/surface.ts` degrade-honestly
 * contract — the caller keeps rendering the existing SVG layer.
 *
 * `onTextureReady` (E1 S5) is called once per successful async texture load
 * (see `texture-cache.ts`'s doc comment) with the `href` key that became
 * ready — the caller (`GpuSceneCanvas.tsx`) wires this straight to its
 * existing `scheduleRedraw`, so a newly-uploaded texture triggers exactly one
 * more coalesced redraw. The texture cache itself is owned INSIDE this
 * surface (never leaked to the caller as a separate handle) so `renderFrame`
 * can look textures up by `href` internally — this is what keeps `GpuPaint`
 * (`types.ts`) free of any `GPUTexture` handle, matching the "no leaked GPU
 * handle across the `shared/gpu` boundary" contract that type's doc comment
 * already establishes for the WebGL2 back-port guardrail (D3).
 */
export async function createGpuCanvasSurface(
	canvas: HTMLCanvasElement,
	onTextureReady: (href: string) => void = () => {},
): Promise<GpuCanvasSurface | null> {
	if (!("gpu" in navigator)) {
		devInfo("navigator.gpu is unavailable in this browser.");
		return null;
	}
	const gpu = navigator.gpu as GPU;

	let adapter: GPUAdapter | null;
	try {
		adapter = await gpu.requestAdapter();
	} catch (error) {
		devInfo("navigator.gpu.requestAdapter() threw.", error);
		return null;
	}
	if (!adapter) {
		devInfo("No WebGPU adapter was returned.");
		return null;
	}

	let device: GPUDevice;
	try {
		device = await adapter.requestDevice();
	} catch (error) {
		devInfo("adapter.requestDevice() threw.", error);
		return null;
	}

	const context = canvas.getContext("webgpu");
	if (!context) {
		devInfo('canvas.getContext("webgpu") returned null.');
		return null;
	}

	const format = gpu.getPreferredCanvasFormat();
	const uniformStride = Math.max(
		UNIFORM_STRUCT_BYTES,
		alignUp(
			UNIFORM_STRUCT_BYTES,
			device.limits.minUniformBufferOffsetAlignment || FALLBACK_UNIFORM_STRIDE,
		),
	);
	const postEffectUniformStride = Math.max(
		POST_EFFECT_UNIFORM_BYTES,
		alignUp(
			POST_EFFECT_UNIFORM_BYTES,
			device.limits.minUniformBufferOffsetAlignment || FALLBACK_UNIFORM_STRIDE,
		),
	);
	const opticalEffectUniformStride = Math.max(
		OPTICAL_EFFECT_UNIFORM_BYTES,
		alignUp(
			OPTICAL_EFFECT_UNIFORM_BYTES,
			device.limits.minUniformBufferOffsetAlignment || FALLBACK_UNIFORM_STRIDE,
		),
	);

	let lost = false;
	device.lost
		.then((info) => {
			lost = true;
			destroyAttachments();
			textureCache.dispose();
			console.warn(`[gpu-canvas] WebGPU device lost: ${info.reason}.`);
		})
		.catch(() => {
			// `device.lost` never rejects per spec; this catch only guards against
			// an unexpected runtime deviation from that contract.
			lost = true;
		});

	try {
		context.configure({
			device,
			format,
			alphaMode: "premultiplied",
		});
	} catch (error) {
		devInfo("context.configure() threw.", error);
		return null;
	}

	const shaderModule = device.createShaderModule({ code: QUAD_SHADER_SOURCE });
	const bindGroupLayout = device.createBindGroupLayout({
		entries: [
			{
				binding: 0,
				visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
				buffer: { type: "uniform", hasDynamicOffset: true },
			},
		],
	});
	const pipeline = device.createRenderPipeline({
		layout: device.createPipelineLayout({
			bindGroupLayouts: [bindGroupLayout],
		}),
		vertex: { module: shaderModule, entryPoint: "vs_main" },
		fragment: {
			module: shaderModule,
			entryPoint: "fs_main",
			targets: [
				{
					format,
					blend: {
						// Straight-alpha blend over a premultiplied swapchain: the
						// fragment shader premultiplies `color.rgb` by `color.a`
						// itself, so the destination contribution only needs
						// `(1 - srcAlpha)`.
						color: {
							srcFactor: "one",
							dstFactor: "one-minus-src-alpha",
						},
						alpha: {
							srcFactor: "one",
							dstFactor: "one-minus-src-alpha",
						},
					},
				},
			],
		},
		primitive: { topology: "triangle-strip" },
		depthStencil: {
			format: DEPTH_STENCIL_FORMAT,
			depthWriteEnabled: false,
			depthCompare: "always",
		},
		multisample: { count: MSAA_SAMPLE_COUNT },
	});

	// COVER pass pipelines (S2/D4; E1 S6/S31 widens this to one pipeline PER blend
	// variant): the SAME quad shader/vertex layout as the background-quad
	// `pipeline` above, gated by the stencil test the stencil pass wrote — see
	// this module's doc comment for the exact compare/passOp/failOp reasoning.
	// Shares `bindGroupLayout`/`bindGroup` with the background pipeline
	// (identical `QuadUniforms` binding shape). `coverPipelineDescriptor` below
	// is the ONE place `blend` varies — every other field (layout, vertex,
	// primitive, depthStencil, multisample) is identical across all six
	// variants, so a per-mode `GPURenderPipeline` map (rather than six
	// hand-copied `createRenderPipeline` calls) is what keeps the six
	// variants declarative. `coverPipelines.normal` is byte-identical to the
	// pre-S6 single `coverPipeline` this replaces.
	const coverPipelineDescriptor = (
		blend: GPUBlendState,
	): GPURenderPipelineDescriptor => ({
		layout: device.createPipelineLayout({
			bindGroupLayouts: [bindGroupLayout],
		}),
		vertex: { module: shaderModule, entryPoint: "vs_main" },
		fragment: {
			module: shaderModule,
			entryPoint: "fs_main",
			targets: [{ format, blend }],
		},
		primitive: { topology: "triangle-strip" },
		depthStencil: {
			format: DEPTH_STENCIL_FORMAT,
			depthWriteEnabled: false,
			depthCompare: "always",
			// E1 S7: narrowed from `STENCIL_FULL_MASK` to `WINDING_STENCIL_MASK` so
			// this UNCLIPPED cover pipeline only ever tests/writes the winding
			// bits (0-6) — identical behavior while a clip scope's bit 7 is 0, and
			// it now correctly PRESERVES bit 7 (rather than clobbering it) if a
			// future caller somehow reached this pipeline with bit 7 set. See
			// `CLIP_STENCIL_BIT`'s doc comment.
			stencilReadMask: WINDING_STENCIL_MASK,
			stencilWriteMask: WINDING_STENCIL_MASK,
			stencilFront: {
				compare: "not-equal",
				passOp: "zero",
				failOp: "zero",
				depthFailOp: "keep",
			},
			stencilBack: {
				compare: "not-equal",
				passOp: "zero",
				failOp: "zero",
				depthFailOp: "keep",
			},
		},
		multisample: { count: MSAA_SAMPLE_COUNT },
	});
	const coverPipelines: Record<GpuBlendMode | "normal", GPURenderPipeline> = {
		normal: device.createRenderPipeline(
			coverPipelineDescriptor(BLEND_STATE_BY_MODE.normal),
		),
		multiply: device.createRenderPipeline(
			coverPipelineDescriptor(BLEND_STATE_BY_MODE.multiply),
		),
		screen: device.createRenderPipeline(
			coverPipelineDescriptor(BLEND_STATE_BY_MODE.screen),
		),
		darken: device.createRenderPipeline(
			coverPipelineDescriptor(BLEND_STATE_BY_MODE.darken),
		),
		lighten: device.createRenderPipeline(
			coverPipelineDescriptor(BLEND_STATE_BY_MODE.lighten),
		),
		exclusion: device.createRenderPipeline(
			coverPipelineDescriptor(BLEND_STATE_BY_MODE.exclusion),
		),
	};
	/** The "normal" variant, under its pre-S6 single-pipeline name — the stroke cover path (uniform strokes are not blend-eligible, see this module's replay loop) is the only remaining reader. */
	const coverPipeline = coverPipelines.normal;

	// IMAGE cover pipelines (E1 S5; E1 S6/S31 widens this to one pipeline PER blend
	// variant, mirroring `coverPipelines` above): a SEPARATE pipeline/bind-
	// group-layout family from `coverPipelines` (per the S5 decision: never
	// force the solid/gradient pipeline to bind a dummy texture) — same
	// dynamic-offset `QuadUniforms` binding SHAPE at binding 0 (so
	// `writeQuadUniforms`/the uniform buffer are shared unmodified), plus a
	// texture (binding 1) and sampler (binding 2) bound PER DRAW from the
	// texture cache below. Gated by the SAME stencil-not-equal-0 test as
	// `coverPipelines` (an image fill still goes through the ordinary
	// stencil-then-cover geometry pass — see
	// `entities/scene/model/gpu/display-list.ts`'s image/placed-image-node
	// entries, which are ordinary `kind: "fill"` entries like any other).
	const imageShaderModule = device.createShaderModule({
		code: IMAGE_QUAD_SHADER_SOURCE,
	});
	const imageBindGroupLayout = device.createBindGroupLayout({
		entries: [
			{
				binding: 0,
				visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
				buffer: { type: "uniform", hasDynamicOffset: true },
			},
			{
				binding: 1,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { sampleType: "float" },
			},
			{ binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
		],
	});
	const imageCoverPipelineDescriptor = (
		blend: GPUBlendState,
	): GPURenderPipelineDescriptor => ({
		layout: device.createPipelineLayout({
			bindGroupLayouts: [imageBindGroupLayout],
		}),
		vertex: { module: imageShaderModule, entryPoint: "vs_main" },
		fragment: {
			module: imageShaderModule,
			entryPoint: "fs_main",
			targets: [{ format, blend }],
		},
		primitive: { topology: "triangle-strip" },
		depthStencil: {
			format: DEPTH_STENCIL_FORMAT,
			depthWriteEnabled: false,
			depthCompare: "always",
			// E1 S7: narrowed from `STENCIL_FULL_MASK` to `WINDING_STENCIL_MASK` so
			// this UNCLIPPED cover pipeline only ever tests/writes the winding
			// bits (0-6) — identical behavior while a clip scope's bit 7 is 0, and
			// it now correctly PRESERVES bit 7 (rather than clobbering it) if a
			// future caller somehow reached this pipeline with bit 7 set. See
			// `CLIP_STENCIL_BIT`'s doc comment.
			stencilReadMask: WINDING_STENCIL_MASK,
			stencilWriteMask: WINDING_STENCIL_MASK,
			stencilFront: {
				compare: "not-equal",
				passOp: "zero",
				failOp: "zero",
				depthFailOp: "keep",
			},
			stencilBack: {
				compare: "not-equal",
				passOp: "zero",
				failOp: "zero",
				depthFailOp: "keep",
			},
		},
		multisample: { count: MSAA_SAMPLE_COUNT },
	});
	const imageCoverPipelines: Record<
		GpuBlendMode | "normal",
		GPURenderPipeline
	> = {
		normal: device.createRenderPipeline(
			imageCoverPipelineDescriptor(BLEND_STATE_BY_MODE.normal),
		),
		multiply: device.createRenderPipeline(
			imageCoverPipelineDescriptor(BLEND_STATE_BY_MODE.multiply),
		),
		screen: device.createRenderPipeline(
			imageCoverPipelineDescriptor(BLEND_STATE_BY_MODE.screen),
		),
		darken: device.createRenderPipeline(
			imageCoverPipelineDescriptor(BLEND_STATE_BY_MODE.darken),
		),
		lighten: device.createRenderPipeline(
			imageCoverPipelineDescriptor(BLEND_STATE_BY_MODE.lighten),
		),
		exclusion: device.createRenderPipeline(
			imageCoverPipelineDescriptor(BLEND_STATE_BY_MODE.exclusion),
		),
	};
	const textureCache = createGpuTextureCache(device, onTextureReady);

	const sourceCompositeShaderModule = device.createShaderModule({
		code: SOURCE_COMPOSITE_SHADER_SOURCE,
	});
	const sourceCompositeBindGroupLayout = device.createBindGroupLayout({
		entries: [
			{
				binding: 0,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { sampleType: "float" },
			},
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
		],
	});
	const sourceCompositePipeline = device.createRenderPipeline({
		layout: device.createPipelineLayout({
			bindGroupLayouts: [sourceCompositeBindGroupLayout],
		}),
		vertex: { module: sourceCompositeShaderModule, entryPoint: "vs_main" },
		fragment: {
			module: sourceCompositeShaderModule,
			entryPoint: "fs_main",
			targets: [{ format }],
		},
		primitive: { topology: "triangle-strip" },
	});
	const sourceCompositeSampler = device.createSampler({
		addressModeU: "clamp-to-edge",
		addressModeV: "clamp-to-edge",
		magFilter: "nearest",
		minFilter: "nearest",
	});
	const sourcePostEffectSampler = device.createSampler({
		addressModeU: "clamp-to-edge",
		addressModeV: "clamp-to-edge",
		magFilter: "linear",
		minFilter: "linear",
	});
	const opticalEffectShaderModule = device.createShaderModule({
		code: NODE_OPTICAL_EFFECT_SHADER_SOURCE,
	});
	const opticalEffectBindGroupLayout = device.createBindGroupLayout({
		entries: [
			{
				binding: 0,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { sampleType: "float" },
			},
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
			{
				binding: 2,
				visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
				buffer: { type: "uniform", hasDynamicOffset: true },
			},
		],
	});
	const opticalEffectPipeline = (blend: GPUBlendState): GPURenderPipeline =>
		device.createRenderPipeline({
			layout: device.createPipelineLayout({
				bindGroupLayouts: [opticalEffectBindGroupLayout],
			}),
			vertex: { module: opticalEffectShaderModule, entryPoint: "vs_main" },
			fragment: {
				module: opticalEffectShaderModule,
				entryPoint: "fs_main",
				targets: [{ format, blend }],
			},
			primitive: { topology: "triangle-strip" },
			multisample: { count: MSAA_SAMPLE_COUNT },
		});
	const opticalNormalPipeline = opticalEffectPipeline(NORMAL_BLEND_STATE);
	const opticalScreenPipeline = opticalEffectPipeline(
		BLEND_STATE_BY_MODE.screen,
	);
	const chromaticAberrationShaderModule = device.createShaderModule({
		code: CHROMATIC_ABERRATION_SHADER_SOURCE,
	});
	const chromaticAberrationBindGroupLayout = device.createBindGroupLayout({
		entries: [
			{
				binding: 0,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { sampleType: "float" },
			},
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
			{
				binding: 2,
				visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
				buffer: { type: "uniform", hasDynamicOffset: true },
			},
		],
	});
	const chromaticAberrationPipeline = device.createRenderPipeline({
		layout: device.createPipelineLayout({
			bindGroupLayouts: [chromaticAberrationBindGroupLayout],
		}),
		vertex: { module: chromaticAberrationShaderModule, entryPoint: "vs_main" },
		fragment: {
			module: chromaticAberrationShaderModule,
			entryPoint: "fs_main",
			targets: [{ format }],
		},
		primitive: { topology: "triangle-strip" },
	});
	const frameFilmGrainShaderModule = device.createShaderModule({
		code: FRAME_FILM_GRAIN_SHADER_SOURCE,
	});
	const frameFilmGrainBindGroupLayout = device.createBindGroupLayout({
		entries: [
			{
				binding: 0,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { sampleType: "float" },
			},
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
			{
				binding: 2,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { sampleType: "float" },
			},
			{ binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
			{
				binding: 4,
				visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
				buffer: { type: "uniform", hasDynamicOffset: true },
			},
		],
	});
	const frameFilmGrainPipeline = device.createRenderPipeline({
		layout: device.createPipelineLayout({
			bindGroupLayouts: [frameFilmGrainBindGroupLayout],
		}),
		vertex: { module: frameFilmGrainShaderModule, entryPoint: "vs_main" },
		fragment: {
			module: frameFilmGrainShaderModule,
			entryPoint: "fs_main",
			targets: [{ format }],
		},
		primitive: { topology: "triangle-strip" },
	});

	// STENCIL pass pipelines (S2/D4): world-space triangle-list geometry (a
	// plain `vec2<f32>` vertex attribute, no per-vertex uniform lookup — the
	// whole draw call shares one camera via `stencilCameraBindGroup` below).
	// `colorWriteMask: 0` (via an explicit `writeMask` on the target) makes
	// this pass invisible in the color attachment; only the stencil buffer
	// changes. Two variants share every pipeline field except `stencilFront`/
	// `stencilBack`'s `passOp` — nonzero winding increments/decrements per
	// front/back face, evenodd inverts both.
	const stencilShaderModule = device.createShaderModule({
		code: STENCIL_SHADER_SOURCE,
	});
	const stencilBindGroupLayout = device.createBindGroupLayout({
		entries: [
			{
				binding: 0,
				visibility: GPUShaderStage.VERTEX,
				buffer: { type: "uniform" },
			},
		],
	});
	const stencilPipelineLayout = device.createPipelineLayout({
		bindGroupLayouts: [stencilBindGroupLayout],
	});
	const stencilVertexBufferLayout: GPUVertexBufferLayout = {
		arrayStride: STENCIL_VERTEX_BYTES,
		attributes: [{ format: "float32x2", offset: 0, shaderLocation: 0 }],
	};
	const stencilPipelineDescriptor = (
		frontOp: GPUStencilOperation,
		backOp: GPUStencilOperation,
	): GPURenderPipelineDescriptor => ({
		layout: stencilPipelineLayout,
		vertex: {
			module: stencilShaderModule,
			entryPoint: "vs_main",
			buffers: [stencilVertexBufferLayout],
		},
		fragment: {
			module: stencilShaderModule,
			entryPoint: "fs_main",
			targets: [{ format, writeMask: 0 }],
		},
		primitive: { topology: "triangle-list", cullMode: "none" },
		depthStencil: {
			format: DEPTH_STENCIL_FORMAT,
			depthWriteEnabled: false,
			depthCompare: "always",
			// E1 S7: `stencilWriteMask` narrowed to `WINDING_STENCIL_MASK` so this
			// winding-accumulator pass never touches bit 7 (a clip scope's
			// materialized state) — `stencilReadMask` is left at
			// `STENCIL_FULL_MASK` deliberately (this pipeline's `compare: "always"`
			// never actually reads stencil, so the read mask is inert either way;
			// see `CLIP_STENCIL_BIT`'s doc comment).
			stencilReadMask: STENCIL_FULL_MASK,
			stencilWriteMask: WINDING_STENCIL_MASK,
			stencilFront: { compare: "always", passOp: frontOp },
			stencilBack: { compare: "always", passOp: backOp },
		},
		multisample: { count: MSAA_SAMPLE_COUNT },
	});
	const stencilNonzeroPipeline = device.createRenderPipeline(
		stencilPipelineDescriptor("increment-wrap", "decrement-wrap"),
	);
	const stencilEvenoddPipeline = device.createRenderPipeline(
		stencilPipelineDescriptor("invert", "invert"),
	);

	// STROKE stencil pipeline (S3): ALWAYS nonzero winding (strokes never use
	// evenodd — see `stroke-mesh.ts`'s winding-discipline doc comment), with a
	// DIFFERENT vertex layout (two `vec2<f32>` attributes: centerline position
	// + unit offset, see `STROKE_STENCIL_SHADER_SOURCE`'s doc comment) and its
	// own bind group layout (camera at binding 0 — reusing the SAME
	// `stencilCameraUniformBuffer` the fill stencil pass already writes once
	// per frame, see below — plus a per-draw dynamic-offset `StrokeDrawUniforms`
	// slot at binding 1, read by BOTH stages: the vertex stage still only reads
	// `halfWidthWorld`, but the fragment stage now also reads the dash fields
	// (E1 S8) to evaluate the discard test — so `visibility` widens to
	// `VERTEX | FRAGMENT`, unlike S3's vertex-only binding.
	const strokeStencilShaderModule = device.createShaderModule({
		code: STROKE_STENCIL_SHADER_SOURCE,
	});
	const strokeStencilBindGroupLayout = device.createBindGroupLayout({
		entries: [
			{
				binding: 0,
				visibility: GPUShaderStage.VERTEX,
				buffer: { type: "uniform" },
			},
			{
				binding: 1,
				visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
				buffer: { type: "uniform", hasDynamicOffset: true },
			},
		],
	});
	// Third attribute (E1 S8): `arcLength`, a plain `f32` (`float32`, not
	// `float32x2` — see `stroke-mesh.ts::STROKE_VERTEX_FLOAT_COUNT`'s doc
	// comment for why this is one extra scalar, not a vec2 pair) immediately
	// after `position`/`offset` in the interleaved buffer.
	const strokeStencilVertexBufferLayout: GPUVertexBufferLayout = {
		arrayStride: STROKE_VERTEX_BYTES,
		attributes: [
			{ format: "float32x2", offset: 0, shaderLocation: 0 },
			{ format: "float32x2", offset: 2 * BYTES_PER_FLOAT, shaderLocation: 1 },
			{ format: "float32", offset: 4 * BYTES_PER_FLOAT, shaderLocation: 2 },
		],
	};
	const strokeStencilPipeline = device.createRenderPipeline({
		layout: device.createPipelineLayout({
			bindGroupLayouts: [strokeStencilBindGroupLayout],
		}),
		vertex: {
			module: strokeStencilShaderModule,
			entryPoint: "vs_main",
			buffers: [strokeStencilVertexBufferLayout],
		},
		fragment: {
			module: strokeStencilShaderModule,
			entryPoint: "fs_main",
			targets: [{ format, writeMask: 0 }],
		},
		primitive: { topology: "triangle-list", cullMode: "none" },
		depthStencil: {
			format: DEPTH_STENCIL_FORMAT,
			depthWriteEnabled: false,
			depthCompare: "always",
			// E1 S7: `stencilWriteMask` narrowed to `WINDING_STENCIL_MASK` — see
			// the fill stencil pipeline's identical comment above
			// ({@link stencilPipelineDescriptor}) for why `stencilReadMask` is
			// left at `STENCIL_FULL_MASK` (inert under `compare: "always"`).
			stencilReadMask: STENCIL_FULL_MASK,
			stencilWriteMask: WINDING_STENCIL_MASK,
			stencilFront: { compare: "always", passOp: "increment-wrap" },
			stencilBack: { compare: "always", passOp: "decrement-wrap" },
		},
		multisample: { count: MSAA_SAMPLE_COUNT },
	});

	// CLIP MATERIALIZE / CLEAR / CLIPPED-COVER pipelines (E1 S7 — see
	// `docs/gpu-canvas-convergence-e1-plan.md`'s S7 decisions and
	// `CLIP_STENCIL_BIT`'s doc comment for the bit-partition this whole family
	// is built on). None of these three pipeline groups need a NEW shader
	// module or a new uniform layout — every one of them draws the SAME
	// world-rect quad (`shaderModule`/`QUAD_SHADER_SOURCE`, `bindGroupLayout`)
	// the background/cover pass already uses, with `targets[0].writeMask: 0`
	// so the color attachment is never touched; only the `depthStencil` state
	// differs per variant. `writeQuadUniforms` (below) already handles a
	// fully-transparent solid paint correctly (used for both materialize and
	// clear's quad uniforms — the color is write-masked off anyway, so any
	// paint value works, but `{kind: "solid", color: {r:0,g:0,b:0,a:0}}` keeps
	// the written uniform slot self-describing for a future debugger/inspector
	// rather than leaving it as leftover garbage from a prior draw).
	//
	// MATERIALIZE: `compare: "less"` with `stencilReadMask:
	// WINDING_STENCIL_MASK` tests `(ref & readMask) < (stored & readMask)` —
	// WebGPU's stencil comparison always puts the REFERENCE on the LEFT. Drawn
	// with `setStencilReference(CLIP_STENCIL_BIT)` (`0x80`): `(0x80 & 0x7f) =
	// 0`, so the test becomes `0 < (stored & 0x7f)`, i.e. "does this pixel's
	// WINDING (bits 0-6) differ from zero" — exactly the silhouette's nonzero
	// fill test, reusing the ordinary winding stencil pass's own output
	// (`stencilNonzeroPipeline`/`stencilEvenoddPipeline`, run immediately
	// before this pipeline in the replay loop) with NO separate winding logic
	// of its own. `passOp: "replace"`, `stencilWriteMask: STENCIL_FULL_MASK`:
	// on PASS, the FULL (unmasked) reference `0x80` is written through the
	// full write mask — bit 7 set, winding bits zeroed in one op. `failOp:
	// "zero"`: outside the silhouette, `replace`'s zero-valued analog clears
	// any stray winding residue back to 0. The reference is therefore MASKED
	// for the comparison but UNMASKED for the write — this asymmetry is what
	// lets one draw both "test winding" and "set bit 7 / clear winding" at
	// once; getting the two masks backwards (write-masking the reference
	// instead of read-masking it for compare) would silently break this.
	//
	// CLEAR: `compare: "always"` (unconditional), `passOp: "replace"`,
	// `stencilWriteMask: STENCIL_FULL_MASK`, drawn with
	// `setStencilReference(0)` — every fragment inside the clip scope's own
	// (world-space) cover rect is zeroed outright, ending the scope cleanly
	// regardless of what MATERIALIZE or any clipped draw inside the scope left
	// behind.
	//
	// CLIPPED COVER (10 variants: both cover families × all 5 blend modes):
	// `compare: "less"` with `stencilReadMask: STENCIL_FULL_MASK` (the FULL
	// byte, unlike the unclipped covers above) tests `(ref & 0xff) <
	// (stored & 0xff)`. Drawn with `setStencilReference(CLIP_STENCIL_BIT)`
	// (`0x80`): `0x80 < stored` is true iff bit 7 is set AND the winding bits
	// are non-zero (bit 7 alone, `0x80`, is NOT less than `0x80`; bit 7 plus
	// any winding bit makes `stored > 0x80`) — i.e. "inside the materialized
	// clip AND inside this draw's own winding." CRITICAL: the comparison is
	// `"less"`, NOT `"greater"` — because the REFERENCE is the LEFT operand in
	// WebGPU's stencil test (`ref OP stored`), getting this backwards
	// (`"greater"`) would invert the entire clip (paint OUTSIDE the mask,
	// hide INSIDE it). `passOp: "zero"`, `stencilWriteMask:
	// WINDING_STENCIL_MASK`: on pass, only the winding bits zero out (this
	// draw's own stencil-then-cover contract, same as an unclipped cover) —
	// bit 7 SURVIVES (masked out of the write) so the SAME clip scope's next
	// draw can still test against it. `failOp: "zero"` (same write mask):
	// outside this draw's own winding but still inside the bbox, winding
	// residue clears the same way an unclipped cover already does.
	const clipMaterializePipeline = device.createRenderPipeline({
		layout: device.createPipelineLayout({
			bindGroupLayouts: [bindGroupLayout],
		}),
		vertex: { module: shaderModule, entryPoint: "vs_main" },
		fragment: {
			module: shaderModule,
			entryPoint: "fs_main",
			targets: [{ format, writeMask: 0 }],
		},
		primitive: { topology: "triangle-strip" },
		depthStencil: {
			format: DEPTH_STENCIL_FORMAT,
			depthWriteEnabled: false,
			depthCompare: "always",
			stencilReadMask: WINDING_STENCIL_MASK,
			stencilWriteMask: STENCIL_FULL_MASK,
			stencilFront: { compare: "less", passOp: "replace", failOp: "zero" },
			stencilBack: { compare: "less", passOp: "replace", failOp: "zero" },
		},
		multisample: { count: MSAA_SAMPLE_COUNT },
	});
	const clipClearPipeline = device.createRenderPipeline({
		layout: device.createPipelineLayout({
			bindGroupLayouts: [bindGroupLayout],
		}),
		vertex: { module: shaderModule, entryPoint: "vs_main" },
		fragment: {
			module: shaderModule,
			entryPoint: "fs_main",
			targets: [{ format, writeMask: 0 }],
		},
		primitive: { topology: "triangle-strip" },
		depthStencil: {
			format: DEPTH_STENCIL_FORMAT,
			depthWriteEnabled: false,
			depthCompare: "always",
			stencilWriteMask: STENCIL_FULL_MASK,
			stencilFront: { compare: "always", passOp: "replace" },
			stencilBack: { compare: "always", passOp: "replace" },
		},
		multisample: { count: MSAA_SAMPLE_COUNT },
	});
	const clippedCoverPipelineDescriptor = (
		blend: GPUBlendState,
	): GPURenderPipelineDescriptor => ({
		layout: device.createPipelineLayout({
			bindGroupLayouts: [bindGroupLayout],
		}),
		vertex: { module: shaderModule, entryPoint: "vs_main" },
		fragment: {
			module: shaderModule,
			entryPoint: "fs_main",
			targets: [{ format, blend }],
		},
		primitive: { topology: "triangle-strip" },
		depthStencil: {
			format: DEPTH_STENCIL_FORMAT,
			depthWriteEnabled: false,
			depthCompare: "always",
			stencilReadMask: STENCIL_FULL_MASK,
			stencilWriteMask: WINDING_STENCIL_MASK,
			stencilFront: { compare: "less", passOp: "zero", failOp: "zero" },
			stencilBack: { compare: "less", passOp: "zero", failOp: "zero" },
		},
		multisample: { count: MSAA_SAMPLE_COUNT },
	});
	const clippedCoverPipelines: Record<
		GpuBlendMode | "normal",
		GPURenderPipeline
	> = {
		normal: device.createRenderPipeline(
			clippedCoverPipelineDescriptor(BLEND_STATE_BY_MODE.normal),
		),
		multiply: device.createRenderPipeline(
			clippedCoverPipelineDescriptor(BLEND_STATE_BY_MODE.multiply),
		),
		screen: device.createRenderPipeline(
			clippedCoverPipelineDescriptor(BLEND_STATE_BY_MODE.screen),
		),
		darken: device.createRenderPipeline(
			clippedCoverPipelineDescriptor(BLEND_STATE_BY_MODE.darken),
		),
		lighten: device.createRenderPipeline(
			clippedCoverPipelineDescriptor(BLEND_STATE_BY_MODE.lighten),
		),
		exclusion: device.createRenderPipeline(
			clippedCoverPipelineDescriptor(BLEND_STATE_BY_MODE.exclusion),
		),
	};
	// Same clipped stencil state as `clippedCoverPipelineDescriptor` above, but
	// on the IMAGE shader module/bind-group-layout family (mirrors
	// `imageCoverPipelineDescriptor`'s relationship to `coverPipelineDescriptor`).
	const clippedImageCoverPipelineDescriptor = (
		blend: GPUBlendState,
	): GPURenderPipelineDescriptor => ({
		layout: device.createPipelineLayout({
			bindGroupLayouts: [imageBindGroupLayout],
		}),
		vertex: { module: imageShaderModule, entryPoint: "vs_main" },
		fragment: {
			module: imageShaderModule,
			entryPoint: "fs_main",
			targets: [{ format, blend }],
		},
		primitive: { topology: "triangle-strip" },
		depthStencil: {
			format: DEPTH_STENCIL_FORMAT,
			depthWriteEnabled: false,
			depthCompare: "always",
			stencilReadMask: STENCIL_FULL_MASK,
			stencilWriteMask: WINDING_STENCIL_MASK,
			stencilFront: { compare: "less", passOp: "zero", failOp: "zero" },
			stencilBack: { compare: "less", passOp: "zero", failOp: "zero" },
		},
		multisample: { count: MSAA_SAMPLE_COUNT },
	});
	const clippedImageCoverPipelines: Record<
		GpuBlendMode | "normal",
		GPURenderPipeline
	> = {
		normal: device.createRenderPipeline(
			clippedImageCoverPipelineDescriptor(BLEND_STATE_BY_MODE.normal),
		),
		multiply: device.createRenderPipeline(
			clippedImageCoverPipelineDescriptor(BLEND_STATE_BY_MODE.multiply),
		),
		screen: device.createRenderPipeline(
			clippedImageCoverPipelineDescriptor(BLEND_STATE_BY_MODE.screen),
		),
		darken: device.createRenderPipeline(
			clippedImageCoverPipelineDescriptor(BLEND_STATE_BY_MODE.darken),
		),
		lighten: device.createRenderPipeline(
			clippedImageCoverPipelineDescriptor(BLEND_STATE_BY_MODE.lighten),
		),
		exclusion: device.createRenderPipeline(
			clippedImageCoverPipelineDescriptor(BLEND_STATE_BY_MODE.exclusion),
		),
	};

	const stencilCameraUniformBuffer = device.createBuffer({
		size: STENCIL_CAMERA_UNIFORM_BYTES,
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
	});
	const stencilCameraBindGroup = device.createBindGroup({
		layout: stencilBindGroupLayout,
		entries: [{ binding: 0, resource: { buffer: stencilCameraUniformBuffer } }],
	});
	const stencilCameraScratch = new Float32Array(
		STENCIL_CAMERA_UNIFORM_FLOAT_COUNT,
	);
	const writeStencilCameraUniforms = (
		camera: GpuCamera,
		cssWidth: number,
		cssHeight: number,
	): void => {
		stencilCameraScratch[0] = camera.scale;
		stencilCameraScratch[1] = camera.panX;
		stencilCameraScratch[2] = camera.panY;
		stencilCameraScratch[3] = camera.rotation;
		stencilCameraScratch[4] = cssWidth;
		stencilCameraScratch[5] = cssHeight;
		stencilCameraScratch[6] = 0;
		stencilCameraScratch[7] = 0;
		device.queue.writeBuffer(
			stencilCameraUniformBuffer,
			0,
			stencilCameraScratch,
		);
	};

	let stencilVertexCapacityBytes =
		INITIAL_STENCIL_VERTEX_CAPACITY * STENCIL_VERTEX_BYTES;
	let stencilVertexBuffer = device.createBuffer({
		size: stencilVertexCapacityBytes,
		usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
	});
	const growStencilVertexBuffer = (requiredBytes: number): void => {
		if (requiredBytes <= stencilVertexCapacityBytes) return;
		let capacity = stencilVertexCapacityBytes;
		while (capacity < requiredBytes) capacity *= 2;
		stencilVertexCapacityBytes = capacity;
		stencilVertexBuffer.destroy();
		stencilVertexBuffer = device.createBuffer({
			size: stencilVertexCapacityBytes,
			usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
		});
	};

	// STROKE vertex buffer (S3): the SAME growth pattern as the fill stencil
	// vertex buffer above, sized in stroke-mesh vertices (4 floats each)
	// instead of fill-stencil vertices (2 floats each).
	let strokeVertexCapacityBytes =
		INITIAL_STROKE_VERTEX_CAPACITY * STROKE_VERTEX_BYTES;
	let strokeVertexBuffer = device.createBuffer({
		size: strokeVertexCapacityBytes,
		usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
	});
	const growStrokeVertexBuffer = (requiredBytes: number): void => {
		if (requiredBytes <= strokeVertexCapacityBytes) return;
		let capacity = strokeVertexCapacityBytes;
		while (capacity < requiredBytes) capacity *= 2;
		strokeVertexCapacityBytes = capacity;
		strokeVertexBuffer.destroy();
		strokeVertexBuffer = device.createBuffer({
			size: strokeVertexCapacityBytes,
			usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
		});
	};

	// STROKE draw dynamic-offset uniform buffer (S3 halfWidthWorld, widened E1
	// S8 with the dash fields): one `StrokeDrawUniforms` slot per stroke draw
	// this frame, mirroring the quad uniform buffer's dynamic-offset growth
	// pattern (`growUniformBuffer` below) at a smaller per-slot stride
	// (`STROKE_DRAW_UNIFORM_BYTES`, 4 `vec4<f32>`s worth, vs the full
	// `QuadUniforms` struct).
	const strokeDrawUniformStride = Math.max(
		STROKE_DRAW_UNIFORM_BYTES,
		alignUp(
			STROKE_DRAW_UNIFORM_BYTES,
			device.limits.minUniformBufferOffsetAlignment || FALLBACK_UNIFORM_STRIDE,
		),
	);
	let strokeDrawUniformCapacity = INITIAL_STROKE_DRAW_UNIFORM_CAPACITY;
	let strokeDrawUniformBuffer = device.createBuffer({
		size: strokeDrawUniformCapacity * strokeDrawUniformStride,
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
	});
	let strokeStencilBindGroup = device.createBindGroup({
		layout: strokeStencilBindGroupLayout,
		entries: [
			{ binding: 0, resource: { buffer: stencilCameraUniformBuffer } },
			{
				binding: 1,
				resource: {
					buffer: strokeDrawUniformBuffer,
					size: STROKE_DRAW_UNIFORM_BYTES,
				},
			},
		],
	});
	const growStrokeDrawUniformBuffer = (requiredSlotCount: number): void => {
		if (requiredSlotCount <= strokeDrawUniformCapacity) return;
		strokeDrawUniformCapacity = nextPowerOfTwoAtLeast(
			requiredSlotCount,
			INITIAL_STROKE_DRAW_UNIFORM_CAPACITY,
		);
		strokeDrawUniformBuffer.destroy();
		strokeDrawUniformBuffer = device.createBuffer({
			size: strokeDrawUniformCapacity * strokeDrawUniformStride,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		strokeStencilBindGroup = device.createBindGroup({
			layout: strokeStencilBindGroupLayout,
			entries: [
				{ binding: 0, resource: { buffer: stencilCameraUniformBuffer } },
				{
					binding: 1,
					resource: {
						buffer: strokeDrawUniformBuffer,
						size: STROKE_DRAW_UNIFORM_BYTES,
					},
				},
			],
		});
	};
	const strokeDrawUniformScratch = new Float32Array(
		STROKE_DRAW_UNIFORM_FLOAT_COUNT,
	);
	/**
	 * Writes one stroke draw's `StrokeDrawUniforms` slot (E1 S8 — see
	 * `quad-shader.ts`'s doc comment for the field layout this mirrors exactly):
	 * `halfWidthWorld` at float offset 0 (S3, unchanged), `dashPatternWorld`
	 * packed into offsets 4..11 (zero-padded past `dashPatternWorld.length`, so
	 * an undashed draw's pattern slots are simply left `0` — inert, since
	 * `dashCount` gates the fragment shader before they are ever read), and
	 * `dashCount`/`dashOffsetWorld` at offsets 12/13. `dashPatternWorld`
	 * undefined or empty writes `dashCount = 0`, the byte-identical-to-pre-S8
	 * short-circuit the fragment shader checks first.
	 */
	const writeStrokeDrawUniform = (
		slot: number,
		halfWidthWorld: number,
		dashPatternWorld: readonly number[] | undefined,
		dashOffsetWorld: number | undefined,
	): void => {
		strokeDrawUniformScratch[0] = halfWidthWorld;
		strokeDrawUniformScratch[1] = 0;
		strokeDrawUniformScratch[2] = 0;
		strokeDrawUniformScratch[3] = 0;
		const dashCount = dashPatternWorld?.length ?? 0;
		for (let index = 0; index < MAX_DASH_PATTERN_ENTRIES; index++) {
			strokeDrawUniformScratch[4 + index] = dashPatternWorld?.[index] ?? 0;
		}
		strokeDrawUniformScratch[12] = dashCount;
		strokeDrawUniformScratch[13] = dashOffsetWorld ?? 0;
		strokeDrawUniformScratch[14] = 0;
		strokeDrawUniformScratch[15] = 0;
		device.queue.writeBuffer(
			strokeDrawUniformBuffer,
			slot * strokeDrawUniformStride,
			strokeDrawUniformScratch,
		);
	};
	const postEffectUniformScratch = new Float32Array(
		POST_EFFECT_UNIFORM_FLOAT_COUNT,
	);
	const writeChromaticAberrationUniform = (
		slot: number,
		rect: GpuQuad["rect"],
		effect: GpuArtboardChromaticAberrationPostEffect,
		camera: GpuCamera,
		cssWidth: number,
		cssHeight: number,
	): void => {
		postEffectUniformScratch[0] = rect.x * camera.scale + camera.panX;
		postEffectUniformScratch[1] = rect.y * camera.scale + camera.panY;
		postEffectUniformScratch[2] = rect.width * camera.scale;
		postEffectUniformScratch[3] = rect.height * camera.scale;
		postEffectUniformScratch[4] = cssWidth;
		postEffectUniformScratch[5] = cssHeight;
		postEffectUniformScratch[6] = 0;
		postEffectUniformScratch[7] = 0;
		postEffectUniformScratch[8] = rect.width;
		postEffectUniformScratch[9] = rect.height;
		postEffectUniformScratch[10] = 0;
		postEffectUniformScratch[11] = 0;
		postEffectUniformScratch[12] = effect.fringing;
		postEffectUniformScratch[13] = effect.maxShiftPx;
		postEffectUniformScratch[14] = effect.centerX;
		postEffectUniformScratch[15] = effect.centerY;
		device.queue.writeBuffer(
			postEffectUniformBuffer,
			slot * postEffectUniformStride,
			postEffectUniformScratch,
		);
	};
	const writeFrameFilmGrainUniform = (
		slot: number,
		rect: GpuQuad["rect"],
		effect: GpuArtboardFilmGrainPostEffect,
		camera: GpuCamera,
		cssWidth: number,
		cssHeight: number,
	): void => {
		postEffectUniformScratch[0] = rect.x * camera.scale + camera.panX;
		postEffectUniformScratch[1] = rect.y * camera.scale + camera.panY;
		postEffectUniformScratch[2] = rect.width * camera.scale;
		postEffectUniformScratch[3] = rect.height * camera.scale;
		postEffectUniformScratch[4] = cssWidth;
		postEffectUniformScratch[5] = cssHeight;
		postEffectUniformScratch[6] = 0;
		postEffectUniformScratch[7] = 0;
		postEffectUniformScratch[8] = rect.width;
		postEffectUniformScratch[9] = rect.height;
		postEffectUniformScratch[10] = 0;
		postEffectUniformScratch[11] = 0;
		const chromaticAberration = effect.chromaticAberration;
		postEffectUniformScratch[12] = chromaticAberration?.fringing ?? 0;
		postEffectUniformScratch[13] = chromaticAberration?.maxShiftPx ?? 0;
		postEffectUniformScratch[14] = chromaticAberration?.centerX ?? 0.5;
		postEffectUniformScratch[15] = chromaticAberration?.centerY ?? 0.5;
		postEffectUniformScratch[16] = effect.backgroundWeight;
		postEffectUniformScratch[17] = effect.objectWeight;
		postEffectUniformScratch[18] = chromaticAberration ? 1 : 0;
		postEffectUniformScratch[19] = 0;
		device.queue.writeBuffer(
			postEffectUniformBuffer,
			slot * postEffectUniformStride,
			postEffectUniformScratch,
		);
	};
	const opticalEffectUniformScratch = new Float32Array(
		OPTICAL_EFFECT_UNIFORM_FLOAT_COUNT,
	);
	const writeOpticalVec4 = (
		vec4Index: number,
		values: readonly [number, number, number, number],
	): void => {
		const offset = vec4Index * VEC4_FLOAT_COUNT;
		opticalEffectUniformScratch[offset] = values[0];
		opticalEffectUniformScratch[offset + 1] = values[1];
		opticalEffectUniformScratch[offset + 2] = values[2];
		opticalEffectUniformScratch[offset + 3] = values[3];
	};
	const projectedScreenRect = (
		rect: GpuQuad["rect"],
		camera: GpuCamera,
	): GpuQuad["rect"] => {
		const cosR = Math.cos(camera.rotation);
		const sinR = Math.sin(camera.rotation);
		const project = (x: number, y: number) => ({
			x: (x * cosR - y * sinR) * camera.scale + camera.panX,
			y: (x * sinR + y * cosR) * camera.scale + camera.panY,
		});
		const points = [
			project(rect.x, rect.y),
			project(rect.x + rect.width, rect.y),
			project(rect.x, rect.y + rect.height),
			project(rect.x + rect.width, rect.y + rect.height),
		];
		const xs = points.map((point) => point.x);
		const ys = points.map((point) => point.y);
		const x = Math.min(...xs);
		const y = Math.min(...ys);
		return {
			x,
			y,
			width: Math.max(...xs) - x,
			height: Math.max(...ys) - y,
		};
	};
	const projectedDirection = (
		direction: { readonly x: number; readonly y: number },
		camera: GpuCamera,
	): readonly [number, number] => {
		const cosR = Math.cos(camera.rotation);
		const sinR = Math.sin(camera.rotation);
		return [
			direction.x * cosR - direction.y * sinR,
			direction.x * sinR + direction.y * cosR,
		];
	};
	const colorVec4 = (
		color: GpuColor,
	): readonly [number, number, number, number] => [
		color.r,
		color.g,
		color.b,
		color.a,
	];
	const writeOpticalEffectUniform = (
		slot: number,
		effect: GpuNodeEffect,
		camera: GpuCamera,
		cssWidth: number,
		cssHeight: number,
	): void => {
		opticalEffectUniformScratch.fill(0);
		const screenRect = projectedScreenRect(effect.bounds, camera);
		writeOpticalVec4(0, [
			screenRect.x,
			screenRect.y,
			screenRect.width,
			screenRect.height,
		]);
		writeOpticalVec4(1, [cssWidth, cssHeight, 0, 0]);
		if (effect.kind === "radiance-field") {
			writeOpticalVec4(2, [
				0,
				effect.threshold,
				Math.min(4, effect.rays.length),
				0,
			]);
			writeOpticalVec4(3, [
				effect.bloom.radiusX * camera.scale,
				effect.bloom.radiusY * camera.scale,
				effect.bloom.intensity,
				effect.bloom.enabled ? 1 : 0,
			]);
			const atmosphere = effect.atmosphere;
			writeOpticalVec4(4, [
				atmosphere?.mix ?? 0,
				atmosphere?.falloff ?? 0,
				(atmosphere?.reach ?? 0) * camera.scale,
				atmosphere?.enabled ? 1 : 0,
			]);
			const atmosphereDirection = projectedDirection(
				atmosphere?.direction ?? { x: 0, y: 1 },
				camera,
			);
			writeOpticalVec4(5, [
				atmosphereDirection[0],
				atmosphereDirection[1],
				0,
				0,
			]);
			writeOpticalVec4(
				6,
				colorVec4(atmosphere?.tint ?? { r: 1, g: 1, b: 1, a: 1 }),
			);
			writeOpticalVec4(7, [
				effect.lens?.mix ?? 0,
				(effect.lens?.chroma ?? 0) * camera.scale,
				(effect.lens?.reach ?? 0) * camera.scale,
				effect.lens?.enabled ? 1 : 0,
			]);
			for (let rayIndex = 0; rayIndex < 4; rayIndex += 1) {
				const ray = effect.rays[rayIndex];
				if (!ray) continue;
				const direction = projectedDirection(ray.direction, camera);
				writeOpticalVec4(16 + rayIndex, [
					direction[0],
					direction[1],
					ray.enabled ? ray.intensity : 0,
					ray.enabled ? 1 : 0,
				]);
				writeOpticalVec4(20 + rayIndex, [
					ray.bridgeSigma[0] * camera.scale,
					ray.bridgeSigma[1] * camera.scale,
					0,
					0,
				]);
				for (let sampleIndex = 0; sampleIndex < 17; sampleIndex += 1) {
					const sample = ray.samples[sampleIndex];
					if (!sample) continue;
					const offset = projectedDirection(sample.offset, camera);
					writeOpticalVec4(24 + rayIndex * 17 + sampleIndex, [
						offset[0] * camera.scale,
						offset[1] * camera.scale,
						sample.weight,
						0,
					]);
				}
			}
		} else {
			writeOpticalVec4(2, [1, 0, 0, effect.microstructureAmount]);
			const direction = projectedDirection(effect.direction, camera);
			writeOpticalVec4(8, [direction[0], direction[1], 0, 0]);
			writeOpticalVec4(9, [
				effect.surface?.amount ?? 0,
				(effect.surface?.width ?? 0) * camera.scale,
				(effect.surface?.softness ?? 0) * camera.scale,
				effect.surface ? 1 : 0,
			]);
			writeOpticalVec4(
				10,
				colorVec4(effect.surface?.tint ?? { r: 1, g: 1, b: 1, a: 1 }),
			);
			writeOpticalVec4(11, [
				effect.diffusion?.amount ?? 0,
				(effect.diffusion?.depth ?? 0) * camera.scale,
				(effect.diffusion?.softness ?? 0) * camera.scale,
				effect.diffusion ? 1 : 0,
			]);
			writeOpticalVec4(
				12,
				colorVec4(effect.diffusion?.tint ?? { r: 1, g: 1, b: 1, a: 1 }),
			);
			writeOpticalVec4(13, [
				effect.edge?.amount ?? 0,
				(effect.edge?.width ?? 0) * camera.scale,
				(effect.edge?.softness ?? 0) * camera.scale,
				effect.edge ? 1 : 0,
			]);
			writeOpticalVec4(
				14,
				colorVec4(effect.edge?.tint ?? { r: 1, g: 1, b: 1, a: 1 }),
			);
			writeOpticalVec4(15, [
				effect.spectral?.amount ?? 0,
				(effect.spectral?.offset ?? 0) * camera.scale,
				effect.spectral ? 1 : 0,
				0,
			]);
		}
		device.queue.writeBuffer(
			opticalEffectUniformBuffer,
			slot * opticalEffectUniformStride,
			opticalEffectUniformScratch,
		);
	};

	let uniformCapacity = INITIAL_QUAD_CAPACITY;
	let uniformBuffer = device.createBuffer({
		size: uniformCapacity * uniformStride,
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
	});
	let bindGroup = device.createBindGroup({
		layout: bindGroupLayout,
		entries: [
			{
				binding: 0,
				resource: { buffer: uniformBuffer, size: UNIFORM_STRUCT_BYTES },
			},
		],
	});

	// One `GPUBindGroup` per resident texture (binding 0's dynamic-offset
	// uniform buffer is the SAME reference across every image draw in a given
	// buffer "generation"; only bindings 1/2 vary per texture) — cached by
	// texture identity so a repeated draw of the SAME image within/across
	// frames does not recreate its bind group. `growUniformBuffer` destroys
	// and replaces `uniformBuffer` when capacity runs out, which would leave
	// every already-cached bind group pointing at a destroyed buffer — that
	// function resets this `let` to a FRESH empty `WeakMap` in the same branch
	// that reassigns `uniformBuffer`, so a subsequent lookup always creates a
	// new bind group against the CURRENT buffer.
	let imageBindGroupByTexture = new WeakMap<GPUTexture, GPUBindGroup>();
	const imageBindGroupFor = (cached: GpuCachedTexture): GPUBindGroup => {
		const existing = imageBindGroupByTexture.get(cached.texture);
		if (existing) return existing;
		const created = device.createBindGroup({
			layout: imageBindGroupLayout,
			entries: [
				{
					binding: 0,
					resource: { buffer: uniformBuffer, size: UNIFORM_STRUCT_BYTES },
				},
				{ binding: 1, resource: cached.texture.createView() },
				{ binding: 2, resource: cached.sampler },
			],
		});
		imageBindGroupByTexture.set(cached.texture, created);
		return created;
	};

	const growUniformBuffer = (requiredQuadCount: number): void => {
		if (requiredQuadCount <= uniformCapacity) return;
		uniformCapacity = nextPowerOfTwoAtLeast(
			requiredQuadCount,
			INITIAL_QUAD_CAPACITY,
		);
		uniformBuffer.destroy();
		uniformBuffer = device.createBuffer({
			size: uniformCapacity * uniformStride,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		bindGroup = device.createBindGroup({
			layout: bindGroupLayout,
			entries: [
				{
					binding: 0,
					resource: { buffer: uniformBuffer, size: UNIFORM_STRUCT_BYTES },
				},
			],
		});
		// The image bind groups cached above also point at the OLD (now
		// destroyed) `uniformBuffer` via their own binding 0 — reset to a fresh
		// `WeakMap` so the next `imageBindGroupFor` call for each texture
		// rebuilds against the CURRENT buffer.
		imageBindGroupByTexture = new WeakMap();
	};

	let msaaColorTexture: GPUTexture | null = null;
	let msaaColorView: GPUTextureView | null = null;
	let sourceColorTexture: GPUTexture | null = null;
	let sourceColorView: GPUTextureView | null = null;
	let sourceCompositeBindGroup: GPUBindGroup | null = null;
	let islandMsaaTexture: GPUTexture | null = null;
	let islandMsaaView: GPUTextureView | null = null;
	let islandColorTexture: GPUTexture | null = null;
	let islandColorView: GPUTextureView | null = null;
	let islandDepthStencilTexture: GPUTexture | null = null;
	let islandDepthStencilView: GPUTextureView | null = null;
	let opticalEffectBindGroup: GPUBindGroup | null = null;
	let opticalEffectUniformCapacity = INITIAL_OPTICAL_EFFECT_UNIFORM_CAPACITY;
	let opticalEffectUniformBuffer = device.createBuffer({
		size: opticalEffectUniformCapacity * opticalEffectUniformStride,
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
	});
	let postEffectUniformCapacity = INITIAL_POST_EFFECT_UNIFORM_CAPACITY;
	let postEffectUniformBuffer = device.createBuffer({
		size: postEffectUniformCapacity * postEffectUniformStride,
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
	});
	let chromaticAberrationBindGroup: GPUBindGroup | null = null;
	let depthStencilTexture: GPUTexture | null = null;
	let depthStencilView: GPUTextureView | null = null;
	let backingWidth = 0;
	let backingHeight = 0;
	// CSS pixels (distinct from the DPR-scaled `backingWidth`/`backingHeight`
	// above): the vertex shader's `screen -> clip` division uses these, because
	// `screenX`/`screenY` themselves are CSS-pixel values (the camera's
	// `panX`/`panY` come from `useViewportStore`, which is CSS-pixel space).
	// Conflating this with the backing-store size would scale clip space by the
	// DPR, shrinking every quad toward the canvas's top-left corner.
	let lastCssWidth = 0;
	let lastCssHeight = 0;

	const destroyAttachments = (): void => {
		msaaColorTexture?.destroy();
		sourceColorTexture?.destroy();
		islandMsaaTexture?.destroy();
		islandColorTexture?.destroy();
		islandDepthStencilTexture?.destroy();
		depthStencilTexture?.destroy();
		msaaColorTexture = null;
		msaaColorView = null;
		sourceColorTexture = null;
		sourceColorView = null;
		sourceCompositeBindGroup = null;
		islandMsaaTexture = null;
		islandMsaaView = null;
		islandColorTexture = null;
		islandColorView = null;
		islandDepthStencilTexture = null;
		islandDepthStencilView = null;
		opticalEffectBindGroup = null;
		depthStencilTexture = null;
		depthStencilView = null;
	};

	const rebuildChromaticAberrationBindGroup = (): void => {
		chromaticAberrationBindGroup = sourceColorView
			? device.createBindGroup({
					layout: chromaticAberrationBindGroupLayout,
					entries: [
						{ binding: 0, resource: sourceColorView },
						{ binding: 1, resource: sourcePostEffectSampler },
						{
							binding: 2,
							resource: {
								buffer: postEffectUniformBuffer,
								size: POST_EFFECT_UNIFORM_BYTES,
							},
						},
					],
				})
			: null;
	};

	const growPostEffectUniformBuffer = (requiredSlotCount: number): void => {
		if (requiredSlotCount <= postEffectUniformCapacity) return;
		postEffectUniformCapacity = nextPowerOfTwoAtLeast(
			requiredSlotCount,
			INITIAL_POST_EFFECT_UNIFORM_CAPACITY,
		);
		postEffectUniformBuffer.destroy();
		postEffectUniformBuffer = device.createBuffer({
			size: postEffectUniformCapacity * postEffectUniformStride,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		rebuildChromaticAberrationBindGroup();
	};

	const rebuildOpticalEffectBindGroup = (): void => {
		opticalEffectBindGroup = islandColorView
			? device.createBindGroup({
					layout: opticalEffectBindGroupLayout,
					entries: [
						{ binding: 0, resource: islandColorView },
						{ binding: 1, resource: sourcePostEffectSampler },
						{
							binding: 2,
							resource: {
								buffer: opticalEffectUniformBuffer,
								size: OPTICAL_EFFECT_UNIFORM_BYTES,
							},
						},
					],
				})
			: null;
	};

	const growOpticalEffectUniformBuffer = (requiredSlotCount: number): void => {
		if (requiredSlotCount <= opticalEffectUniformCapacity) return;
		opticalEffectUniformCapacity = nextPowerOfTwoAtLeast(
			requiredSlotCount,
			INITIAL_OPTICAL_EFFECT_UNIFORM_CAPACITY,
		);
		opticalEffectUniformBuffer.destroy();
		opticalEffectUniformBuffer = device.createBuffer({
			size: opticalEffectUniformCapacity * opticalEffectUniformStride,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		rebuildOpticalEffectBindGroup();
	};

	const configure = ({ cssWidth, cssHeight, dpr }: GpuSurfaceConfig): void => {
		if (lost) return;
		lastCssWidth = cssWidth;
		lastCssHeight = cssHeight;
		const clampedDpr = Math.min(MAX_BACKING_DPR, Math.max(1, dpr));
		const width = Math.max(1, Math.round(cssWidth * clampedDpr));
		const height = Math.max(1, Math.round(cssHeight * clampedDpr));
		if (width === backingWidth && height === backingHeight) return;
		backingWidth = width;
		backingHeight = height;
		canvas.width = width;
		canvas.height = height;
		// Re-configuring an already-configured context is valid WebGPU usage and
		// is how the swapchain picks up the new canvas backing size.
		context.configure({ device, format, alphaMode: "premultiplied" });
		destroyAttachments();
		msaaColorTexture = device.createTexture({
			size: { width, height },
			sampleCount: MSAA_SAMPLE_COUNT,
			format,
			usage: GPUTextureUsage.RENDER_ATTACHMENT,
		});
		msaaColorView = msaaColorTexture.createView();
		sourceColorTexture = device.createTexture({
			size: { width, height },
			format,
			usage:
				GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
		});
		sourceColorView = sourceColorTexture.createView();
		sourceCompositeBindGroup = device.createBindGroup({
			layout: sourceCompositeBindGroupLayout,
			entries: [
				{ binding: 0, resource: sourceColorView },
				{ binding: 1, resource: sourceCompositeSampler },
			],
		});
		islandMsaaTexture = device.createTexture({
			size: { width, height },
			sampleCount: MSAA_SAMPLE_COUNT,
			format,
			usage: GPUTextureUsage.RENDER_ATTACHMENT,
		});
		islandMsaaView = islandMsaaTexture.createView();
		islandColorTexture = device.createTexture({
			size: { width, height },
			format,
			usage:
				GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
		});
		islandColorView = islandColorTexture.createView();
		islandDepthStencilTexture = device.createTexture({
			size: { width, height },
			sampleCount: MSAA_SAMPLE_COUNT,
			format: DEPTH_STENCIL_FORMAT,
			usage: GPUTextureUsage.RENDER_ATTACHMENT,
		});
		islandDepthStencilView = islandDepthStencilTexture.createView();
		rebuildOpticalEffectBindGroup();
		rebuildChromaticAberrationBindGroup();
		depthStencilTexture = device.createTexture({
			size: { width, height },
			sampleCount: MSAA_SAMPLE_COUNT,
			format: DEPTH_STENCIL_FORMAT,
			usage: GPUTextureUsage.RENDER_ATTACHMENT,
		});
		depthStencilView = depthStencilTexture.createView();
	};

	const scratch = new Float32Array(UNIFORM_FLOAT_COUNT);

	/** Zeroes every gradient-only field in `scratch` (paint kind, geometry, worldToLocal, stops) — the shared prelude for both a solid quad and a gradient quad missing some optional field. */
	const clearGradientFields = (): void => {
		for (
			let index = QUAD_UNIFORM_OFFSETS.paintMeta;
			index < UNIFORM_FLOAT_COUNT;
			index++
		) {
			scratch[index] = 0;
		}
	};

	/**
	 * Writes one `QuadUniforms` slot: `rect`/`camera`/`viewport` always, plus
	 * (E1 S3) `paint`'s solid color OR its gradient geometry/stops and, when
	 * supplied, `worldToLocal`'s inverse matrix; (E1 S5) an `"image"` paint
	 * writes its placement rect into the SAME `gradientGeometry` slot (see
	 * `IMAGE_QUAD_SHADER_SOURCE`'s doc comment for why one field serves both
	 * purposes), `paintMeta.xyz` as fit mode/source width/source height,
	 * `paintMeta.w` plus `stopOffsets[0]` as optional source UV rect, and
	 * `color.a` for its straight-alpha opacity. The caller (the S5/S21/S22
	 * draw-encoding branch below) separately binds this draw's own texture/sampler
	 * via a per-texture bind group, since a texture handle has no uniform-buffer
	 * representation. A background quad (S1) always calls this with
	 * `paint.kind === "solid"` and `worldToLocal` `undefined`.
	 */
	const writeQuadUniforms = (
		offset: number,
		rect: GpuQuad["rect"],
		paint: GpuPaint,
		worldToLocal: GpuFillDraw["worldToLocal"],
		camera: GpuCamera,
		cssWidth: number,
		cssHeight: number,
		imageTexture?: Pick<GpuCachedTexture, "width" | "height">,
	): void => {
		scratch[QUAD_UNIFORM_OFFSETS.rect] = rect.x;
		scratch[QUAD_UNIFORM_OFFSETS.rect + 1] = rect.y;
		scratch[QUAD_UNIFORM_OFFSETS.rect + 2] = rect.width;
		scratch[QUAD_UNIFORM_OFFSETS.rect + 3] = rect.height;
		scratch[QUAD_UNIFORM_OFFSETS.camera] = camera.scale;
		scratch[QUAD_UNIFORM_OFFSETS.camera + 1] = camera.panX;
		scratch[QUAD_UNIFORM_OFFSETS.camera + 2] = camera.panY;
		scratch[QUAD_UNIFORM_OFFSETS.camera + 3] = camera.rotation;
		scratch[QUAD_UNIFORM_OFFSETS.viewport] = cssWidth;
		scratch[QUAD_UNIFORM_OFFSETS.viewport + 1] = cssHeight;
		scratch[QUAD_UNIFORM_OFFSETS.viewport + 2] = 0;
		scratch[QUAD_UNIFORM_OFFSETS.viewport + 3] = 0;
		clearGradientFields();

		if (paint.kind === "solid") {
			scratch[QUAD_UNIFORM_OFFSETS.paintMeta] = 0;
			scratch[QUAD_UNIFORM_OFFSETS.color] = paint.color.r;
			scratch[QUAD_UNIFORM_OFFSETS.color + 1] = paint.color.g;
			scratch[QUAD_UNIFORM_OFFSETS.color + 2] = paint.color.b;
			scratch[QUAD_UNIFORM_OFFSETS.color + 3] = paint.color.a;
			device.queue.writeBuffer(uniformBuffer, offset, scratch);
			return;
		}

		if (paint.kind === "image") {
			// `color.rgb` is unused by `IMAGE_QUAD_SHADER_SOURCE`'s fragment stage
			// (it samples a texture) — `paintMeta` carries S21 fit/crop metadata
			// plus the S22 source-rect flag, `stopOffsets[0]` carries that source
			// rect when present, while `gradientGeometry` (the placement rect),
			// `worldToLocal`, and `color.a` (opacity) stay load-bearing.
			// `color[0..2]` are zeroed explicitly (this offset range is BEFORE
			// `clearGradientFields`'s start at `paintMeta`, so it is otherwise
			// left holding whatever the previous draw into this scratch buffer
			// wrote) — today's image shader ignores them, but this guards a
			// future shader edit against silently inheriting stale rgb.
			scratch[QUAD_UNIFORM_OFFSETS.color] = 0;
			scratch[QUAD_UNIFORM_OFFSETS.color + 1] = 0;
			scratch[QUAD_UNIFORM_OFFSETS.color + 2] = 0;
			scratch[QUAD_UNIFORM_OFFSETS.paintMeta] = imageFitMode(paint.fit);
			scratch[QUAD_UNIFORM_OFFSETS.paintMeta + 1] = imageTexture?.width ?? 1;
			scratch[QUAD_UNIFORM_OFFSETS.paintMeta + 2] = imageTexture?.height ?? 1;
			scratch[QUAD_UNIFORM_OFFSETS.paintMeta + 3] = paint.sourceRect ? 1 : 0;
			if (paint.sourceRect) {
				scratch[QUAD_UNIFORM_OFFSETS.stopOffsets] = paint.sourceRect.x;
				scratch[QUAD_UNIFORM_OFFSETS.stopOffsets + 1] = paint.sourceRect.y;
				scratch[QUAD_UNIFORM_OFFSETS.stopOffsets + 2] = paint.sourceRect.width;
				scratch[QUAD_UNIFORM_OFFSETS.stopOffsets + 3] = paint.sourceRect.height;
			}
			scratch[QUAD_UNIFORM_OFFSETS.gradientGeometry] = paint.rect.x;
			scratch[QUAD_UNIFORM_OFFSETS.gradientGeometry + 1] = paint.rect.y;
			scratch[QUAD_UNIFORM_OFFSETS.gradientGeometry + 2] = paint.rect.width;
			scratch[QUAD_UNIFORM_OFFSETS.gradientGeometry + 3] = paint.rect.height;
			scratch[QUAD_UNIFORM_OFFSETS.color + 3] = paint.opacity;
			if (worldToLocal) {
				scratch[QUAD_UNIFORM_OFFSETS.worldToLocalRow0] = worldToLocal.a;
				scratch[QUAD_UNIFORM_OFFSETS.worldToLocalRow0 + 1] = worldToLocal.c;
				scratch[QUAD_UNIFORM_OFFSETS.worldToLocalRow0 + 2] = worldToLocal.e;
				scratch[QUAD_UNIFORM_OFFSETS.worldToLocalRow1] = worldToLocal.b;
				scratch[QUAD_UNIFORM_OFFSETS.worldToLocalRow1 + 1] = worldToLocal.d;
				scratch[QUAD_UNIFORM_OFFSETS.worldToLocalRow1 + 2] = worldToLocal.f;
			}
			device.queue.writeBuffer(uniformBuffer, offset, scratch);
			return;
		}

		scratch[QUAD_UNIFORM_OFFSETS.paintMeta] =
			paint.kind === "linear-gradient" ? 1 : 2;
		scratch[QUAD_UNIFORM_OFFSETS.paintMeta + 1] = paint.stops.length;
		if (paint.kind === "linear-gradient") {
			scratch[QUAD_UNIFORM_OFFSETS.gradientGeometry] = paint.from.x;
			scratch[QUAD_UNIFORM_OFFSETS.gradientGeometry + 1] = paint.from.y;
			scratch[QUAD_UNIFORM_OFFSETS.gradientGeometry + 2] = paint.to.x;
			scratch[QUAD_UNIFORM_OFFSETS.gradientGeometry + 3] = paint.to.y;
		} else {
			scratch[QUAD_UNIFORM_OFFSETS.gradientGeometry] = paint.center.x;
			scratch[QUAD_UNIFORM_OFFSETS.gradientGeometry + 1] = paint.center.y;
			scratch[QUAD_UNIFORM_OFFSETS.gradientGeometry + 2] = paint.radius;
			scratch[QUAD_UNIFORM_OFFSETS.gradientGeometry + 3] = 0;
		}
		if (worldToLocal) {
			scratch[QUAD_UNIFORM_OFFSETS.worldToLocalRow0] = worldToLocal.a;
			scratch[QUAD_UNIFORM_OFFSETS.worldToLocalRow0 + 1] = worldToLocal.c;
			scratch[QUAD_UNIFORM_OFFSETS.worldToLocalRow0 + 2] = worldToLocal.e;
			scratch[QUAD_UNIFORM_OFFSETS.worldToLocalRow1] = worldToLocal.b;
			scratch[QUAD_UNIFORM_OFFSETS.worldToLocalRow1 + 1] = worldToLocal.d;
			scratch[QUAD_UNIFORM_OFFSETS.worldToLocalRow1 + 2] = worldToLocal.f;
		}
		paint.stops.forEach((stop, index) => {
			scratch[QUAD_UNIFORM_OFFSETS.stopOffsets + index] = stop.offset;
			const colorBase =
				QUAD_UNIFORM_OFFSETS.stopColors + index * VEC4_FLOAT_COUNT;
			scratch[colorBase] = stop.color.r;
			scratch[colorBase + 1] = stop.color.g;
			scratch[colorBase + 2] = stop.color.b;
			scratch[colorBase + 3] = stop.color.a;
		});
		device.queue.writeBuffer(uniformBuffer, offset, scratch);
	};

	/** Total quad-uniform SLOTS one frame needs: every GPU-active artboard's own background quad + one quad per draw (S3: fills AND strokes both cover through the SAME `QuadUniforms`-driven pipeline; E1 S7: a `clip-begin` consumes one slot for its MATERIALIZE quad and a `clip-end` consumes one slot for its CLEAR quad — each is already exactly one element of `artboard.draws`, so this generic `draws.length` count already includes them with no separate term needed). */
	const quadSlotCount = (frame: GpuFrameSpec): number =>
		frame.artboards.reduce(
			(total, artboard) =>
				total + (artboard.backgroundQuad ? 1 : 0) + artboard.draws.length,
			0,
		);

	/** Total `f32` count across every fill draw's AND (E1 S7) every `clip-begin`'s stencil triangles this frame (`x,y` pairs) — a clip scope's silhouette winds through the SAME winding stencil pipelines/vertex buffer a fill does, so it shares this one sizing pass. `clip-end` contributes no stencil vertices (the clear pass draws only a quad, no winding geometry). */
	const stencilVertexCount = (frame: GpuFrameSpec): number =>
		frame.artboards.reduce(
			(total, artboard) =>
				total +
				artboard.draws.reduce(
					(drawTotal, draw) =>
						drawTotal +
						(draw.kind === "fill" || draw.kind === "clip-begin"
							? draw.triangles.length / 2
							: 0),
					0,
				),
			0,
		);

	/** Total vertex count across every stroke draw's extrusion mesh this frame (S3; `mesh` is 4 floats/vertex, see `STROKE_VERTEX_BYTES`). */
	const strokeVertexCount = (frame: GpuFrameSpec): number =>
		frame.artboards.reduce(
			(total, artboard) =>
				total +
				artboard.draws.reduce(
					(drawTotal, draw) =>
						drawTotal +
						(draw.kind === "stroke"
							? draw.mesh.length / STROKE_VERTEX_FLOAT_COUNT
							: 0),
					0,
				),
			0,
		);

	/** Total stroke DRAW count this frame (distinct from {@link strokeVertexCount}, which counts vertices) — one dynamic-offset half-width uniform slot per stroke draw. */
	const strokeDrawCount = (frame: GpuFrameSpec): number =>
		frame.artboards.reduce(
			(total, artboard) =>
				total +
				artboard.draws.reduce(
					(drawTotal, draw) => drawTotal + (draw.kind === "stroke" ? 1 : 0),
					0,
				),
			0,
		);

	/** Total S17 post-effect pass count this frame — one dynamic-offset uniform slot per effected artboard. */
	const postEffectCount = (frame: GpuFrameSpec): number =>
		frame.artboards.reduce(
			(total, artboard) => total + (artboard.postEffects?.length ?? 0),
			0,
		);

	const opticalEffectCount = (frame: GpuFrameSpec): number =>
		frame.artboards.reduce(
			(total, artboard) =>
				total +
				artboard.draws.reduce(
					(drawTotal, draw) =>
						drawTotal + (draw.kind === "effect-island-begin" ? 1 : 0),
					0,
				),
			0,
		);

	/** One SOLID/GRADIENT fill draw's resolved buffer positions, prepared up front and replayed by the draw loop below. `blendMode` (E1 S6/S31) selects one of `coverPipelines`' six variants; `undefined` (the pre-S6 shape) means "normal". */
	type PreparedSolidFill = {
		readonly kind: "fill";
		readonly quadSlot: number;
		readonly firstVertex: number;
		readonly vertexCount: number;
		readonly fillRule: GpuFillDraw["fillRule"];
		readonly blendMode: GpuBlendMode | undefined;
	};

	/**
	 * One IMAGE fill draw's resolved buffer positions (E1 S5) — same shape as
	 * {@link PreparedSolidFill} plus the resolved texture's own `GPUBindGroup`
	 * (looked up once here via {@link imageBindGroupFor}, not per-vertex),
	 * dispatched to one of `imageCoverPipelines`' six variants (by
	 * `blendMode`, E1 S6/S31) instead of `coverPipelines` in the replay loop below.
	 */
	type PreparedImageFill = {
		readonly kind: "image-fill";
		readonly quadSlot: number;
		readonly firstVertex: number;
		readonly vertexCount: number;
		readonly fillRule: GpuFillDraw["fillRule"];
		readonly imageBindGroup: GPUBindGroup;
		readonly blendMode: GpuBlendMode | undefined;
	};

	/** One fill draw's resolved buffer positions, either kind — see {@link PreparedSolidFill}/{@link PreparedImageFill}. */
	type PreparedFill = PreparedSolidFill | PreparedImageFill;

	/** One SOLID/GRADIENT stroke draw's resolved buffer positions (S3/S24), prepared up front and replayed by the draw loop below. */
	type PreparedSolidStroke = {
		readonly kind: "stroke";
		readonly quadSlot: number;
		readonly halfWidthSlot: number;
		readonly firstVertex: number;
		readonly vertexCount: number;
	};

	/**
	 * One IMAGE stroke draw's resolved buffer positions (S25) — same stroke
	 * stencil geometry and half-width uniform as {@link PreparedSolidStroke},
	 * but its cover quad binds the resolved image texture through the image
	 * cover pipeline's normal-blend variant.
	 */
	type PreparedImageStroke = {
		readonly kind: "image-stroke";
		readonly quadSlot: number;
		readonly halfWidthSlot: number;
		readonly firstVertex: number;
		readonly vertexCount: number;
		readonly imageBindGroup: GPUBindGroup;
	};

	/** One stroke draw's resolved buffer positions, either kind — see {@link PreparedSolidStroke}/{@link PreparedImageStroke}. */
	type PreparedStroke = PreparedSolidStroke | PreparedImageStroke;

	/**
	 * One `clip-begin`'s resolved buffer positions (E1 S7): the silhouette's
	 * own stencil-vertex range (shares `stencilVertexBuffer` with fills — see
	 * {@link stencilVertexCount}) plus the MATERIALIZE quad's uniform slot.
	 * `vertexCount === 0` is valid and total (an unrepresentable/degenerate
	 * silhouette — see `display-list.ts`'s clip-scope branch) — the replay
	 * loop below draws zero winding vertices, then still runs the materialize
	 * quad, which then fails everywhere (an "empty clip," matching SVG's own
	 * empty-`<clipPath>` semantics).
	 */
	type PreparedClipBegin = {
		readonly kind: "clip-begin";
		readonly quadSlot: number;
		readonly firstVertex: number;
		readonly vertexCount: number;
		readonly fillRule: GpuFillDraw["fillRule"];
	};

	/** One `clip-end`'s resolved buffer positions (E1 S7): just the CLEAR quad's uniform slot — a clip scope's end draws no stencil geometry of its own. */
	type PreparedClipEnd = {
		readonly kind: "clip-end";
		readonly quadSlot: number;
	};

	type PreparedEffectIslandBegin = {
		readonly kind: "effect-island-begin";
		readonly id: string;
		readonly effect: GpuNodeEffect;
	};

	type PreparedEffectIslandEnd = {
		readonly kind: "effect-island-end";
		readonly id: string;
	};

	/** One prepared draw, IN DOCUMENT PAINT ORDER — see {@link PreparedArtboard}'s doc comment for why this stays one ordered array rather than a same-kind split. */
	type PreparedDraw =
		| PreparedFill
		| PreparedStroke
		| PreparedClipBegin
		| PreparedClipEnd
		| PreparedEffectIslandBegin
		| PreparedEffectIslandEnd;

	/**
	 * One artboard's resolved buffer positions: its background quad's slot (if
	 * any) plus its draws, in the SAME order `GpuArtboardContent.draws` was
	 * given in (a post-S4 review fix — see `webgpu.ts`'s top doc comment and
	 * `shared/gpu/types.ts::GpuArtboardDraw`'s doc comment: the PREVIOUS shape
	 * split this into separate `fills`/`strokes` arrays and the draw-encoding
	 * loop below fully drained one before starting the other, which silently
	 * reordered a DIFFERENT node's stroke ahead of a LATER node's fill whenever
	 * the two overlapped on screen — replaying ONE ordered list here instead
	 * fixes that cross-node z-order bug).
	 */
	type PreparedArtboard = {
		readonly backgroundQuadSlot: number | null;
		readonly draws: readonly PreparedDraw[];
	};

	/**
	 * Resolves this frame's CPU-side buffers, dynamic uniform slots, and texture
	 * cache hits before any render-pass encoding starts. S15 keeps the direct
	 * swapchain path behavior-identical, but this seam lets a later offscreen
	 * compositor replay the SAME prepared artboard stream into an intermediate
	 * source texture before WGSL Look/effect passes sample it.
	 */
	const prepareFrameDraws = (
		frame: GpuFrameSpec,
		cssWidth: number,
		cssHeight: number,
	): readonly PreparedArtboard[] => {
		// Single pass writing every uniform-buffer slot and vertex-buffer range
		// this frame needs, recording each draw/artboard's resolved slot/offset
		// so the draw-encoding loop below can replay them without recomputing
		// anything. `slot`/`vertexOffsetBytes`/`strokeVertexOffsetBytes`/
		// `halfWidthSlot` are FRAME-WIDE running counters — every artboard's
		// draws share the one respective buffer, back to back, never resetting
		// per artboard. Each artboard's OWN `draws` array is walked in order
		// (fill and stroke entries interleaved exactly as the compiler emitted
		// them — see `PreparedArtboard`'s doc comment), so a fill draw and a
		// stroke draw from the SAME artboard can freely alternate here; only
		// the PER-KIND running counters (`vertexOffsetBytes` vs
		// `strokeVertexOffsetBytes`) track each buffer's own write cursor.
		let slot = 0;
		let vertexOffsetBytes = 0;
		let strokeVertexOffsetBytes = 0;
		let halfWidthSlot = 0;
		return frame.artboards.map((artboard) => {
			let backgroundQuadSlot: number | null = null;
			if (artboard.backgroundQuad) {
				writeQuadUniforms(
					slot * uniformStride,
					artboard.backgroundQuad.rect,
					{ kind: "solid", color: artboard.backgroundQuad.color },
					undefined,
					frame.camera,
					cssWidth,
					cssHeight,
				);
				backgroundQuadSlot = slot;
				slot += 1;
			}
			// A plain `.map()` no longer fits here (E1 S5): an image fill whose
			// texture is not yet resident/loaded (a cache MISS — see
			// `texture-cache.ts`'s sync-hit/async-miss contract) contributes
			// NOTHING to this frame — no stencil write, no cover-pass quad, no
			// slot — rather than drawing a blank/garbage quad; `onReady`
			// (wired to the caller's `scheduleRedraw`) picks it up on the very
			// next frame once the async load resolves. `PreparedDraw[]` is
			// built imperatively (push, not `.map()`'s always-one-output-per-
			// input shape) so a skip is just "don't push."
			const draws: PreparedDraw[] = [];
			for (const draw of artboard.draws) {
				if (draw.kind === "effect-island-begin") {
					draws.push({
						kind: "effect-island-begin",
						id: draw.id,
						effect: draw.effect,
					});
					continue;
				}
				if (draw.kind === "effect-island-end") {
					draws.push({ kind: "effect-island-end", id: draw.id });
					continue;
				}
				if (draw.kind === "fill" && draw.paint.kind === "image") {
					const href = draw.paint.href;
					const cached = textureCache.get(href, () =>
						loadImageBitmapFromHref(href),
					);
					if (!cached) continue;
					const vertexCount = draw.triangles.length / 2;
					device.queue.writeBuffer(
						stencilVertexBuffer,
						vertexOffsetBytes,
						draw.triangles,
					);
					writeQuadUniforms(
						slot * uniformStride,
						draw.coverRect,
						draw.paint,
						draw.worldToLocal,
						frame.camera,
						cssWidth,
						cssHeight,
						cached,
					);
					const prepared: PreparedImageFill = {
						kind: "image-fill",
						quadSlot: slot,
						firstVertex: vertexOffsetBytes / STENCIL_VERTEX_BYTES,
						vertexCount,
						fillRule: draw.fillRule,
						imageBindGroup: imageBindGroupFor(cached),
						blendMode: draw.blendMode,
					};
					draws.push(prepared);
					slot += 1;
					vertexOffsetBytes += draw.triangles.byteLength;
					continue;
				}
				if (draw.kind === "fill") {
					const vertexCount = draw.triangles.length / 2;
					device.queue.writeBuffer(
						stencilVertexBuffer,
						vertexOffsetBytes,
						draw.triangles,
					);
					writeQuadUniforms(
						slot * uniformStride,
						draw.coverRect,
						draw.paint,
						draw.worldToLocal,
						frame.camera,
						cssWidth,
						cssHeight,
					);
					const prepared: PreparedSolidFill = {
						kind: "fill",
						quadSlot: slot,
						firstVertex: vertexOffsetBytes / STENCIL_VERTEX_BYTES,
						vertexCount,
						fillRule: draw.fillRule,
						blendMode: draw.blendMode,
					};
					draws.push(prepared);
					slot += 1;
					vertexOffsetBytes += draw.triangles.byteLength;
					continue;
				}
				if (draw.kind === "clip-begin") {
					// E1 S7: the silhouette's own winding triangles share the SAME
					// `stencilVertexBuffer`/`vertexOffsetBytes` cursor a fill's
					// stencil geometry already uses — `stencilVertexCount` (above)
					// already sized the buffer to include every `clip-begin`'s
					// triangles alongside every fill's. The MATERIALIZE quad's paint
					// value is irrelevant (color is write-masked off by
					// `clipMaterializePipeline`) — a fully-transparent solid keeps the
					// written uniform slot self-describing rather than leftover
					// garbage from a prior draw into this scratch buffer.
					const vertexCount = draw.triangles.length / 2;
					device.queue.writeBuffer(
						stencilVertexBuffer,
						vertexOffsetBytes,
						draw.triangles,
					);
					writeQuadUniforms(
						slot * uniformStride,
						draw.coverRect,
						{ kind: "solid", color: { r: 0, g: 0, b: 0, a: 0 } },
						undefined,
						frame.camera,
						cssWidth,
						cssHeight,
					);
					const prepared: PreparedClipBegin = {
						kind: "clip-begin",
						quadSlot: slot,
						firstVertex: vertexOffsetBytes / STENCIL_VERTEX_BYTES,
						vertexCount,
						fillRule: draw.fillRule,
					};
					draws.push(prepared);
					slot += 1;
					vertexOffsetBytes += draw.triangles.byteLength;
					continue;
				}
				if (draw.kind === "clip-end") {
					// E1 S7: no stencil geometry of its own — just the CLEAR quad's
					// uniform slot (paint value irrelevant, same reasoning as
					// `clip-begin` above).
					writeQuadUniforms(
						slot * uniformStride,
						draw.coverRect,
						{ kind: "solid", color: { r: 0, g: 0, b: 0, a: 0 } },
						undefined,
						frame.camera,
						cssWidth,
						cssHeight,
					);
					const prepared: PreparedClipEnd = {
						kind: "clip-end",
						quadSlot: slot,
					};
					draws.push(prepared);
					slot += 1;
					continue;
				}
				const vertexCount = draw.mesh.length / STROKE_VERTEX_FLOAT_COUNT;
				if (draw.paint.kind === "image") {
					const href = draw.paint.href;
					const cached = textureCache.get(href, () =>
						loadImageBitmapFromHref(href),
					);
					if (!cached) continue;
					device.queue.writeBuffer(
						strokeVertexBuffer,
						strokeVertexOffsetBytes,
						draw.mesh,
					);
					writeQuadUniforms(
						slot * uniformStride,
						draw.coverRect,
						draw.paint,
						draw.worldToLocal,
						frame.camera,
						cssWidth,
						cssHeight,
						cached,
					);
					writeStrokeDrawUniform(
						halfWidthSlot,
						draw.halfWidthWorld,
						draw.dashPatternWorld,
						draw.dashOffsetWorld,
					);
					const prepared: PreparedImageStroke = {
						kind: "image-stroke",
						quadSlot: slot,
						halfWidthSlot,
						firstVertex: strokeVertexOffsetBytes / STROKE_VERTEX_BYTES,
						vertexCount,
						imageBindGroup: imageBindGroupFor(cached),
					};
					draws.push(prepared);
					slot += 1;
					halfWidthSlot += 1;
					strokeVertexOffsetBytes += draw.mesh.byteLength;
					continue;
				}
				device.queue.writeBuffer(
					strokeVertexBuffer,
					strokeVertexOffsetBytes,
					draw.mesh,
				);
				writeQuadUniforms(
					slot * uniformStride,
					draw.coverRect,
					draw.paint,
					draw.worldToLocal,
					frame.camera,
					cssWidth,
					cssHeight,
				);
				writeStrokeDrawUniform(
					halfWidthSlot,
					draw.halfWidthWorld,
					draw.dashPatternWorld,
					draw.dashOffsetWorld,
				);
				const prepared: PreparedSolidStroke = {
					kind: "stroke",
					quadSlot: slot,
					halfWidthSlot,
					firstVertex: strokeVertexOffsetBytes / STROKE_VERTEX_BYTES,
					vertexCount,
				};
				draws.push(prepared);
				slot += 1;
				halfWidthSlot += 1;
				strokeVertexOffsetBytes += draw.mesh.byteLength;
			}
			return { backgroundQuadSlot, draws };
		});
	};

	/**
	 * Encodes the prepared artboard stream into whichever render pass owns the
	 * current color/depth-stencil attachments. The direct swapchain path uses it
	 * today; future offscreen Look/effect composition can replay the same stream
	 * into an intermediate source texture without duplicating clip/stencil logic.
	 */
	const encodePreparedArtboards = (
		pass: GPURenderPassEncoder,
		preparedArtboards: readonly PreparedArtboard[],
	): void => {
		// Draws replay in the SAME order `GpuArtboardContent.draws` was given in
		// — a post-S4 review fix (see this module's top doc comment and
		// `PreparedArtboard`'s doc comment): the PREVIOUS loop drew "every
		// artboard's fills, THEN every artboard's strokes", which silently put
		// any later-node fill ahead of an earlier-node's stroke whenever the two
		// overlapped on screen. Per-draw pipeline/vertex-buffer switching is
		// accepted here (correctness first; batching same-kind draws together
		// is a non-goal for this RHI-lite).
		for (const artboard of preparedArtboards) {
			if (artboard.backgroundQuadSlot !== null) {
				pass.setPipeline(pipeline);
				pass.setBindGroup(0, bindGroup, [
					artboard.backgroundQuadSlot * uniformStride,
				]);
				pass.draw(4);
			}
			// E1 S7: whether the draws currently being replayed sit inside an
			// open clip scope — reset to `false` at the top of EVERY artboard (a
			// scope never spans artboards; the compiler always closes a
			// `clip-begin` with its own `clip-end` before the artboard's `draws`
			// list ends, so this never needs to survive past the artboard loop
			// either). While `true`, every fill/image-fill/stroke COVER draw
			// selects its CLIPPED pipeline variant with
			// `setStencilReference(CLIP_STENCIL_BIT)` instead of the ordinary
			// unclipped variant with reference `0` — see
			// `clippedCoverPipelineDescriptor`'s doc comment for the exact
			// stencil-test semantics this selection relies on.
			let clipActive = false;
			for (const draw of artboard.draws) {
				if (
					draw.kind === "effect-island-begin" ||
					draw.kind === "effect-island-end"
				) {
					continue;
				}
				if (draw.kind === "clip-begin") {
					// Defensive totality: a NESTED `clip-begin` (one encountered while
					// `clipActive` is already `true`) cannot occur by construction —
					// `resolveSceneMaskPlan` rejects mask chains, and this compiler
					// only ever wraps a SINGLE clip scope per masked content node, so
					// two `clip-begin`s can never appear without a `clip-end` between
					// them. If a future bug somehow produced one anyway, this treats
					// it as a NO-OP begin (skip the materialize draw entirely, leave
					// the already-open scope's stencil state untouched) rather than
					// re-materializing over a live scope and corrupting bit 7 for the
					// draws already inside it.
					if (clipActive) {
						devInfo(
							"Nested clip-begin encountered mid-scope; ignoring (no-op).",
						);
						continue;
					}
					// MATERIALIZE: draw the silhouette's own winding (possibly ZERO
					// vertices — a degenerate/unrepresentable silhouette, see
					// `PreparedClipBegin`'s doc comment — `pass.draw(0, ...)` is valid
					// WebGPU and simply draws nothing, leaving every fragment's
					// winding bits at 0, which then fails the materialize test
					// everywhere, producing a totally empty clip region exactly like
					// SVG's own empty-`<clipPath>` semantics) through the SAME
					// winding stencil pipelines a fill uses, then run the
					// MATERIALIZE quad over the silhouette's own cover rect with
					// `setStencilReference(CLIP_STENCIL_BIT)` to convert that winding
					// into the scope's bit-7 membership test — see
					// `clipMaterializePipeline`'s doc comment for the exact
					// mask-asymmetry this one draw relies on.
					pass.setVertexBuffer(0, stencilVertexBuffer);
					pass.setPipeline(
						draw.fillRule === "evenodd"
							? stencilEvenoddPipeline
							: stencilNonzeroPipeline,
					);
					pass.setBindGroup(0, stencilCameraBindGroup);
					pass.draw(draw.vertexCount, 1, draw.firstVertex);

					pass.setPipeline(clipMaterializePipeline);
					pass.setStencilReference(CLIP_STENCIL_BIT);
					pass.setBindGroup(0, bindGroup, [draw.quadSlot * uniformStride]);
					pass.draw(4);
					clipActive = true;
					continue;
				}
				if (draw.kind === "clip-end") {
					// CLEAR: zero the scope's silhouette cover rect back to 0
					// unconditionally, ending the scope regardless of what
					// MATERIALIZE or any clipped draw inside it left behind.
					pass.setPipeline(clipClearPipeline);
					pass.setStencilReference(0);
					pass.setBindGroup(0, bindGroup, [draw.quadSlot * uniformStride]);
					pass.draw(4);
					clipActive = false;
					continue;
				}
				if (draw.kind === "image-fill") {
					// Same stencil-then-cover shape as an ordinary fill (E1 S5) — only
					// the COVER pipeline/bind-group differ (a per-texture bind group
					// on one of `imageCoverPipelines`'/`clippedImageCoverPipelines`'
					// variants instead of the shared `bindGroup` on `coverPipelines`);
					// the stencil pass is IDENTICAL (same stencil-nonzero/evenodd
					// pipelines, same vertex buffer). `draw.blendMode ?? "normal"` (E1
					// S6) is a TOTAL lookup key: an absent/unrecognized value always
					// falls back to "normal", defending against any future animated
					// blend landing on an admitted artboard mid-frame (see
					// `PreparedImageFill`'s doc comment).
					pass.setVertexBuffer(0, stencilVertexBuffer);
					pass.setPipeline(
						draw.fillRule === "evenodd"
							? stencilEvenoddPipeline
							: stencilNonzeroPipeline,
					);
					pass.setBindGroup(0, stencilCameraBindGroup);
					pass.draw(draw.vertexCount, 1, draw.firstVertex);

					// E1 S7: while a clip scope is open, this draw's COVER pass
					// selects the CLIPPED image-cover variant with reference
					// `CLIP_STENCIL_BIT` instead of the ordinary variant with
					// reference `0` — see `clippedCoverPipelineDescriptor`'s doc
					// comment for why this ONE selection is enough to make the same
					// cover geometry respect the open scope.
					pass.setPipeline(
						clipActive
							? clippedImageCoverPipelines[draw.blendMode ?? "normal"]
							: imageCoverPipelines[draw.blendMode ?? "normal"],
					);
					pass.setStencilReference(clipActive ? CLIP_STENCIL_BIT : 0);
					pass.setBindGroup(0, draw.imageBindGroup, [
						draw.quadSlot * uniformStride,
					]);
					pass.draw(4);
					continue;
				}
				if (draw.kind === "fill") {
					pass.setVertexBuffer(0, stencilVertexBuffer);
					pass.setPipeline(
						draw.fillRule === "evenodd"
							? stencilEvenoddPipeline
							: stencilNonzeroPipeline,
					);
					pass.setBindGroup(0, stencilCameraBindGroup);
					pass.draw(draw.vertexCount, 1, draw.firstVertex);

					// `draw.blendMode ?? "normal"` (E1 S6/S31) — see the `image-fill`
					// branch's comment above for the same total-lookup reasoning. E1
					// S7's clipped-variant selection mirrors the `image-fill` branch
					// exactly.
					pass.setPipeline(
						clipActive
							? clippedCoverPipelines[draw.blendMode ?? "normal"]
							: coverPipelines[draw.blendMode ?? "normal"],
					);
					pass.setStencilReference(clipActive ? CLIP_STENCIL_BIT : 0);
					pass.setBindGroup(0, bindGroup, [draw.quadSlot * uniformStride]);
					pass.draw(4);
					continue;
				}
				pass.setVertexBuffer(0, strokeVertexBuffer);
				pass.setPipeline(strokeStencilPipeline);
				pass.setBindGroup(0, strokeStencilBindGroup, [
					draw.halfWidthSlot * strokeDrawUniformStride,
				]);
				pass.draw(draw.vertexCount, 1, draw.firstVertex);

				// The stroke cover path always draws with the "normal"-blend cover
				// pipeline (E1 S6/S31 — uniform strokes are not blend-eligible, see
				// `entities/scene/model/gpu/capability.ts`'s gate (c)/(e)). S25
				// adds an IMAGE stroke cover variant, but still only the normal
				// blend pipeline. E1 S7 widens both to pure PIPELINE SELECTION
				// between unclipped and clipped normal variants with no new stencil
				// flow: a stroke inside an open clip scope still must clip (masked
				// content legitimately includes stroked children — see the S7 stress
				// fixture's group-with-stroke-child case), even though it never
				// blends.
				let strokeCoverPipeline = coverPipeline;
				let strokeCoverBindGroup = bindGroup;
				if (draw.kind === "image-stroke") {
					strokeCoverPipeline = clipActive
						? clippedImageCoverPipelines.normal
						: imageCoverPipelines.normal;
					strokeCoverBindGroup = draw.imageBindGroup;
				} else if (clipActive) {
					strokeCoverPipeline = clippedCoverPipelines.normal;
				}
				pass.setPipeline(strokeCoverPipeline);
				pass.setStencilReference(clipActive ? CLIP_STENCIL_BIT : 0);
				pass.setBindGroup(0, strokeCoverBindGroup, [
					draw.quadSlot * uniformStride,
				]);
				pass.draw(4);
			}
		}
	};

	type PreparedRenderAction =
		| {
				readonly kind: "plain";
				readonly artboard: PreparedArtboard;
		  }
		| {
				readonly kind: "effect";
				readonly artboard: PreparedArtboard;
				readonly effect: GpuNodeEffect;
		  };

	const preparedRenderActions = (
		preparedArtboards: readonly PreparedArtboard[],
	): readonly PreparedRenderAction[] => {
		const actions: PreparedRenderAction[] = [];
		for (const artboard of preparedArtboards) {
			let pendingBackground = artboard.backgroundQuadSlot;
			let pendingDraws: PreparedDraw[] = [];
			const flushPlain = (): void => {
				if (pendingBackground === null && pendingDraws.length === 0) return;
				actions.push({
					kind: "plain",
					artboard: {
						backgroundQuadSlot: pendingBackground,
						draws: pendingDraws,
					},
				});
				pendingBackground = null;
				pendingDraws = [];
			};
			for (let index = 0; index < artboard.draws.length; index += 1) {
				const draw = artboard.draws[index];
				if (!draw) continue;
				if (draw.kind !== "effect-island-begin") {
					if (draw.kind !== "effect-island-end") pendingDraws.push(draw);
					continue;
				}
				flushPlain();
				const effectDraws: PreparedDraw[] = [];
				let closed = false;
				for (index += 1; index < artboard.draws.length; index += 1) {
					const candidate = artboard.draws[index];
					if (!candidate) continue;
					if (
						candidate.kind === "effect-island-end" &&
						candidate.id === draw.id
					) {
						closed = true;
						break;
					}
					if (candidate.kind === "effect-island-begin") continue;
					effectDraws.push(candidate);
				}
				if (!closed || effectDraws.length === 0) {
					pendingDraws.push(...effectDraws);
					continue;
				}
				actions.push({
					kind: "effect",
					artboard: { backgroundQuadSlot: null, draws: effectDraws },
					effect: draw.effect,
				});
			}
			flushPlain();
		}
		return actions;
	};

	const encodeMainArtboardPass = (
		encoder: GPUCommandEncoder,
		artboard: PreparedArtboard,
		loadOp: GPULoadOp,
	): void => {
		if (!msaaColorView || !sourceColorView || !depthStencilView) return;
		const pass = encoder.beginRenderPass({
			colorAttachments: [
				{
					view: msaaColorView,
					resolveTarget: sourceColorView,
					clearValue: clearColor,
					loadOp,
					storeOp: "store",
				},
			],
			depthStencilAttachment: {
				view: depthStencilView,
				depthClearValue: 1,
				depthLoadOp: "clear",
				depthStoreOp: "discard",
				stencilClearValue: 0,
				stencilLoadOp: "clear",
				stencilStoreOp: "discard",
			},
		});
		encodePreparedArtboards(pass, [artboard]);
		pass.end();
	};

	const encodeEffectIslandPass = (
		encoder: GPUCommandEncoder,
		artboard: PreparedArtboard,
	): void => {
		if (!islandMsaaView || !islandColorView || !islandDepthStencilView) return;
		const pass = encoder.beginRenderPass({
			colorAttachments: [
				{
					view: islandMsaaView,
					resolveTarget: islandColorView,
					clearValue: clearColor,
					loadOp: "clear",
					storeOp: "discard",
				},
			],
			depthStencilAttachment: {
				view: islandDepthStencilView,
				depthClearValue: 1,
				depthLoadOp: "clear",
				depthStoreOp: "discard",
				stencilClearValue: 0,
				stencilLoadOp: "clear",
				stencilStoreOp: "discard",
			},
		});
		encodePreparedArtboards(pass, [artboard]);
		pass.end();
	};

	const encodeOpticalCompositePass = (
		encoder: GPUCommandEncoder,
		effect: GpuNodeEffect,
		slot: number,
	): void => {
		if (!msaaColorView || !sourceColorView || !opticalEffectBindGroup) {
			return;
		}
		const pass = encoder.beginRenderPass({
			colorAttachments: [
				{
					view: msaaColorView,
					resolveTarget: sourceColorView,
					loadOp: "load",
					storeOp: "store",
				},
			],
		});
		pass.setPipeline(
			effect.kind === "radiance-field" && effect.blendMode === "screen"
				? opticalScreenPipeline
				: opticalNormalPipeline,
		);
		pass.setBindGroup(0, opticalEffectBindGroup, [
			slot * opticalEffectUniformStride,
		]);
		pass.draw(4);
		pass.end();
	};

	const renderFrame = (frame: GpuFrameSpec): void => {
		if (lost) return;
		const requiredOpticalEffects = opticalEffectCount(frame);
		if (
			!msaaColorView ||
			!sourceColorView ||
			!sourceCompositeBindGroup ||
			!depthStencilView ||
			(requiredOpticalEffects > 0 &&
				(!islandMsaaView ||
					!islandColorView ||
					!islandDepthStencilView ||
					!opticalEffectBindGroup))
		) {
			return;
		}
		const cssWidth = lastCssWidth;
		const cssHeight = lastCssHeight;
		if (cssWidth <= 0 || cssHeight <= 0) return;

		growUniformBuffer(quadSlotCount(frame));
		growStencilVertexBuffer(stencilVertexCount(frame) * STENCIL_VERTEX_BYTES);
		growStrokeVertexBuffer(strokeVertexCount(frame) * STROKE_VERTEX_BYTES);
		growStrokeDrawUniformBuffer(strokeDrawCount(frame));
		growPostEffectUniformBuffer(postEffectCount(frame));
		growOpticalEffectUniformBuffer(requiredOpticalEffects);
		writeStencilCameraUniforms(frame.camera, cssWidth, cssHeight);
		const preparedArtboards = prepareFrameDraws(frame, cssWidth, cssHeight);

		const encoder = device.createCommandEncoder();
		const swapchainView = context.getCurrentTexture().createView();
		if (requiredOpticalEffects === 0) {
			const pass = encoder.beginRenderPass({
				colorAttachments: [
					{
						view: msaaColorView,
						resolveTarget: sourceColorView,
						clearValue: clearColor,
						loadOp: "clear",
						storeOp: "discard",
					},
				],
				depthStencilAttachment: {
					view: depthStencilView,
					depthClearValue: 1,
					depthLoadOp: "clear",
					depthStoreOp: "discard",
					stencilClearValue: 0,
					stencilLoadOp: "clear",
					stencilStoreOp: "discard",
				},
			});
			encodePreparedArtboards(pass, preparedArtboards);
			pass.end();
		} else {
			let initialized = false;
			let opticalSlot = 0;
			for (const action of preparedRenderActions(preparedArtboards)) {
				if (action.kind === "plain") {
					encodeMainArtboardPass(
						encoder,
						action.artboard,
						initialized ? "load" : "clear",
					);
					initialized = true;
					continue;
				}
				encodeEffectIslandPass(encoder, action.artboard);
				encodeMainArtboardPass(
					encoder,
					action.artboard,
					initialized ? "load" : "clear",
				);
				initialized = true;
				writeOpticalEffectUniform(
					opticalSlot,
					action.effect,
					frame.camera,
					cssWidth,
					cssHeight,
				);
				encodeOpticalCompositePass(encoder, action.effect, opticalSlot);
				opticalSlot += 1;
			}
		}
		const chromaticAberrationEffects: Array<{
			readonly slot: number;
		}> = [];
		const frameFilmGrainEffects: Array<{
			readonly slot: number;
			readonly bindGroup: GPUBindGroup;
		}> = [];
		let postEffectSlot = 0;
		for (const artboard of frame.artboards) {
			for (const effect of artboard.postEffects ?? []) {
				if (effect.kind === "chromatic-aberration") {
					writeChromaticAberrationUniform(
						postEffectSlot,
						artboard.rect,
						effect,
						frame.camera,
						cssWidth,
						cssHeight,
					);
					chromaticAberrationEffects.push({ slot: postEffectSlot });
					postEffectSlot += 1;
					continue;
				}
				const cached = textureCache.get(effect.href, () =>
					loadImageBitmapFromHref(effect.href),
				);
				if (!cached) continue;
				writeFrameFilmGrainUniform(
					postEffectSlot,
					artboard.rect,
					effect,
					frame.camera,
					cssWidth,
					cssHeight,
				);
				frameFilmGrainEffects.push({
					slot: postEffectSlot,
					bindGroup: device.createBindGroup({
						layout: frameFilmGrainBindGroupLayout,
						entries: [
							{ binding: 0, resource: sourceColorView },
							{ binding: 1, resource: sourcePostEffectSampler },
							{ binding: 2, resource: cached.texture.createView() },
							{ binding: 3, resource: cached.sampler },
							{
								binding: 4,
								resource: {
									buffer: postEffectUniformBuffer,
									size: POST_EFFECT_UNIFORM_BYTES,
								},
							},
						],
					}),
				});
				postEffectSlot += 1;
			}
		}
		const compositePass = encoder.beginRenderPass({
			colorAttachments: [
				{
					view: swapchainView,
					clearValue: clearColor,
					loadOp: "clear",
					storeOp: "store",
				},
			],
		});
		compositePass.setPipeline(sourceCompositePipeline);
		compositePass.setBindGroup(0, sourceCompositeBindGroup);
		compositePass.draw(4);
		if (chromaticAberrationBindGroup) {
			for (const effect of chromaticAberrationEffects) {
				compositePass.setPipeline(chromaticAberrationPipeline);
				compositePass.setBindGroup(0, chromaticAberrationBindGroup, [
					effect.slot * postEffectUniformStride,
				]);
				compositePass.draw(4);
			}
		}
		for (const effect of frameFilmGrainEffects) {
			compositePass.setPipeline(frameFilmGrainPipeline);
			compositePass.setBindGroup(0, effect.bindGroup, [
				effect.slot * postEffectUniformStride,
			]);
			compositePass.draw(4);
		}
		compositePass.end();
		device.queue.submit([encoder.finish()]);
	};

	return {
		configure,
		renderFrame,
		isLost: () => lost,
		dispose: () => {
			destroyAttachments();
			textureCache.dispose();
			uniformBuffer.destroy();
			stencilVertexBuffer.destroy();
			strokeVertexBuffer.destroy();
			strokeDrawUniformBuffer.destroy();
			stencilCameraUniformBuffer.destroy();
			postEffectUniformBuffer.destroy();
			opticalEffectUniformBuffer.destroy();
			device.destroy();
		},
	};
}

/** Dev-only diagnostic for the "degrade honestly" path — never thrown, never shown to users. */
function devInfo(message: string, cause?: unknown): void {
	if (!import.meta.env.DEV) return;
	console.info(`[gpu-canvas] ${message}`, cause ?? "");
}

// Re-exported so callers constructing colors/quads do not need a second
// import for the plain data shapes.
export type { GpuColor };
