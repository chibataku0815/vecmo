/**
 * Public types for the WebGPU RHI-lite (`shared/gpu`). Scene-agnostic and
 * browser-only — this module has no knowledge of `SceneDocument`, artboards,
 * or nodes; it only knows how to paint colored world-space rectangles into a
 * camera-projected canvas.
 *
 * These types intentionally never leak a `GPU*` WebGPU handle across the
 * `shared/gpu` boundary (see `docs/gpu-canvas-convergence-e1-plan.md` D3/D5):
 * callers (widget glue) depend on this file, not on ambient WebGPU types, so
 * swapping the backend later (a WebGL2 back-port) does not ripple outward.
 */

/** World-space axis-aligned rectangle, in the same units as scene geometry. */
export type GpuWorldRect = {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
};

/** Straight (non-premultiplied) sRGB-encoded color, each channel `0..1`. */
export type GpuColor = {
	readonly r: number;
	readonly g: number;
	readonly b: number;
	readonly a: number;
};

/** One opaque-or-transparent flat-colored quad to draw this frame. */
export type GpuQuad = {
	readonly rect: GpuWorldRect;
	readonly color: GpuColor;
};

/** 2D point, in the same units as scene geometry (space depends on the field it types — see each field's own doc comment). */
export type GpuLocalPoint = {
	readonly x: number;
	readonly y: number;
};

/** Row-major 2D affine matrix, matching `entities/scene/model/rendering.ts`'s `Matrix2D` shape. */
export type GpuMatrix2D = {
	readonly a: number;
	readonly b: number;
	readonly c: number;
	readonly d: number;
	readonly e: number;
	readonly f: number;
};

/**
 * One gradient color stop, straight (non-premultiplied) sRGB — matches
 * `CanvasGradientStop`'s shape one-for-one (E1 S3 — see
 * `docs/gpu-canvas-convergence-e1-plan.md` D-gradient decisions). The RHI
 * premultiplies internally (see `quad-shader.ts`'s cover-pass doc comment) so
 * every caller across the codebase keeps working in the same straight-alpha
 * convention as `GpuColor`/`CanvasGradientStop`.
 */
export type GpuGradientStop = {
	readonly offset: number;
	readonly color: GpuColor;
};

/**
 * Fixed uniform-array capacity for gradient stops in the cover-pass shader
 * (E1 S3 — see `docs/gpu-canvas-convergence-e1-plan.md`'s gradient decisions).
 * A gradient with more stops than this fails GPU capability
 * (`"gradient_stops"`) rather than silently truncating — `shared/gpu` has no
 * knowledge of the capability predicate, so this constant is the single
 * source both `entities/scene/model/gpu/capability.ts` and `webgpu.ts`'s WGSL
 * uniform layout read to stay in lockstep.
 */
export const MAX_GRADIENT_STOPS = 8;

/**
 * Fixed uniform-array capacity for a stroke's dash pattern in the stencil-pass
 * fragment shader (E1 S8 — see `docs/gpu-canvas-convergence-e1-plan.md`'s S8
 * decisions). A normalized (odd-length-doubled) pattern longer than this fails
 * GPU capability (`"stroke_dash"`) rather than truncating — mirrors
 * {@link MAX_GRADIENT_STOPS}'s identical "single source of truth for both the
 * capability predicate and the WGSL uniform layout" role.
 */
export const MAX_DASH_PATTERN_ENTRIES = 8;

/**
 * One fill's paint: a flat color, a linear/radial gradient, or an image (E1
 * S5). Gradient coordinates stay in the SAME node-local geometry space as the
 * fill's own (pre-`worldTransform`) contours — mirroring `CanvasGradientDef`'s
 * `userSpaceOnUse` contract exactly (see `entities/scene/model/canvas-paint.ts`
 * and the SVG exporter's `linearGradientDef`/`radialGradientDef`) — NEVER
 * transformed to world space CPU-side. Instead, the cover-pass fragment
 * shader re-derives each fragment's own LOCAL position via a per-draw
 * `worldToLocal` uniform (`GpuFillDraw.worldToLocal`, the inverse of the
 * node's `worldTransform`) and compares THAT against these unchanged local
 * `from`/`to`/`center`/`radius` numbers — one cheap affine map per fragment,
 * no shader-side matrix inversion, and exact under rotation/anisotropic
 * scale/shear alike (see `webgpu.ts`'s cover-pass doc comment for the full
 * derivation). A gradient's own `transform`/spread/focal fields, when present
 * in the source model, are OUT OF SCOPE for S3 — the caller must fail such a
 * paint closed (`"gradient_feature"`) rather than construct a `GpuPaint` for
 * it.
 *
 * `"image"` (E1 S5/S21 — see `docs/gpu-canvas-convergence-e1-plan.md`'s S5
 * decisions) carries only a POJO placement descriptor, never a texture handle
 * or a promise — `entities/scene/model/gpu` stays DOM-free and
 * texture-loading-free by construction. `rect` is the placement rectangle in
 * the SAME node-local space as a gradient's `from`/`to` (mirroring the SVG
 * `<pattern>` `userSpaceOnUse` box `canvasPaintsForStyle`/`CanvasImageDef`
 * already emit for this exact paint); the widget layer
 * (`gpu-scene-frame.ts`) resolves `href` through the async texture cache and
 * supplies the resulting `GPUTexture`/sampler via a SEPARATE bind group the
 * renderer looks up by `href` at draw time — this type itself never changes
 * shape based on load state. `fit: "fit"` and `fit: "crop"` map to SVG's
 * centered `meet`/`slice` behavior in the image shader once texture dimensions
 * are known; tiled (`fit: "tile"`) image paint is OUT OF SCOPE (no
 * wrap-sampling in the cover shader yet), so the caller must
 * fail such a paint closed (`"image_feature"`) rather than construct a
 * `GpuPaint` for it.
 */
export type GpuImageFit = "fill" | "fit" | "crop";

export type GpuImageSourceRect = {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
};

export type GpuPaint =
	| { readonly kind: "solid"; readonly color: GpuColor }
	| {
			readonly kind: "linear-gradient";
			readonly from: GpuLocalPoint;
			readonly to: GpuLocalPoint;
			/** Ascending by `offset`, length `1..MAX_GRADIENT_STOPS` — see {@link MAX_GRADIENT_STOPS}. */
			readonly stops: readonly GpuGradientStop[];
	  }
	| {
			readonly kind: "radial-gradient";
			readonly center: GpuLocalPoint;
			/** Mirrors the SVG/canvas contract: a single circular radius (`Math.max(radius.x, radius.y, 0)`), never an ellipse. */
			readonly radius: number;
			/** Ascending by `offset`, length `1..MAX_GRADIENT_STOPS` — see {@link MAX_GRADIENT_STOPS}. */
			readonly stops: readonly GpuGradientStop[];
	  }
	| {
			readonly kind: "image";
			/** Resolved href (data URL or external URL) — the texture-cache lookup key, see this type's doc comment. */
			readonly href: string;
			/** Node-local placement rect (`fill`/`fit`/`crop` already resolved to a single rect + `preserveAspectRatio`-equivalent by the caller — see `gradientOrPaintReasons`'s image branch). */
			readonly rect: {
				readonly x: number;
				readonly y: number;
				readonly width: number;
				readonly height: number;
			};
			/** SVG image preserveAspectRatio equivalent for this placement. Omitted means stretch/fill. */
			readonly fit?: GpuImageFit;
			/** Optional normalized source UV sub-rect for cropped placed-image nodes. Omitted means the full source image. */
			readonly sourceRect?: GpuImageSourceRect;
			/** Straight-alpha `0..1` paint opacity, already folded with this leaf's inherited-opacity chain (mirrors a gradient stop's alpha convention). */
			readonly opacity: number;
	  };

/** Stroke cover paints supported by the solid/gradient or textured cover pipelines. Mesh strokes still fail capability before reaching `shared/gpu`. */
export type GpuStrokePaint = GpuPaint;

/**
 * The camera transform for one frame, matching
 * `features/viewport/model/camera.ts`: `screen = rotate(world, rotation) *
 * scale + pan`, where `scale = zoom / 100`, `rotation` is radians, and `pan`
 * is in CSS pixels relative to the canvas viewport's top-left corner.
 */
export type GpuCamera = {
	readonly scale: number;
	readonly panX: number;
	readonly panY: number;
	readonly rotation: number;
};

/**
 * Fixed-function blend-mode subset representable with WebGPU
 * `GPUBlendState` over the artboard's OPAQUE background quad (E1 S6/S31 — see
 * `docs/gpu-canvas-convergence-e1-plan.md`'s S6/S31 decisions). Absent
 * (`undefined`) on a {@link GpuFillDraw} means ordinary `"normal"`
 * source-over blending — every renderer call site treats a missing
 * `blendMode` as `"normal"` (a total fallback, defensive against any future
 * value drifting past the capability gate — see `capability.ts`'s S6/S31 gates).
 * S31 adds `exclusion`, which is the same class as `multiply`/`screen`: exact
 * for any source alpha over an opaque backdrop with the fixed-function color
 * factors `src * (1 - dst) + dst * (1 - src)`. The 11 other
 * {@link @/entities/scene/model/types!BlendMode} values (and
 * `"normal"` itself, which needs no separate literal here) are NOT
 * representable this way and stay on the SVG fallback; see
 * `entities/scene/model/gpu/capability.ts`'s `"blend_mode"`/
 * `"blend_mode_feature"` reason tokens for the exact admission gates.
 */
export type GpuBlendMode =
	| "multiply"
	| "screen"
	| "darken"
	| "lighten"
	| "exclusion";

/**
 * One fill path draw for the stencil-then-cover pass (E1 S2/S3 — see
 * `docs/gpu-canvas-convergence-e1-plan.md` D4). `triangles` are WORLD-space
 * stencil fan triangles, already flattened and transformed CPU-side (see
 * `shared/gpu/flatten.ts::fanTriangulateRings`) — the GPU shader applies only
 * the camera projection, never a per-node model matrix. `coverRect` is the
 * node's own tight paint bounds in WORLD space (already transformed by the
 * caller), used for the cover pass's screen-space quad. `paint` may be solid,
 * a linear/radial gradient (S3), or an image (S5), with gradient/image
 * geometry kept in LOCAL space (see `GpuPaint`'s doc comment); `worldToLocal`
 * is required whenever `paint.kind !== "solid"` (the cover shader multiplies
 * it by the fragment's WORLD position to recover the node-local position
 * `paint`'s `from`/`to`/`center`/`radius`/`rect` are measured against — see
 * `webgpu.ts`'s cover-pass doc comment) and is `undefined` for a solid paint,
 * where no per-fragment re-projection is needed. `kind: "fill"` is this
 * draw's tag in the discriminated {@link GpuArtboardDraw} union (E1 S3 review
 * fix — see that type's doc comment for why the union exists).
 *
 * `blendMode` (E1 S6/S31) selects one of the fixed-function {@link GpuBlendMode} pipeline
 * variants at draw time; `undefined` draws with the ordinary "normal" cover
 * pipeline. Never set on a {@link GpuStrokeDraw} — uniform strokes are not
 * blend-eligible in S6 (see `capability.ts`'s gate list).
 */
export type GpuFillDraw = {
	readonly kind: "fill";
	/** Scene-agnostic grouping key used by node-local effect islands. */
	readonly ownerId?: string;
	readonly triangles: Float32Array;
	readonly fillRule: "nonzero" | "evenodd";
	readonly coverRect: GpuWorldRect;
	readonly paint: GpuPaint;
	/** World -> node-local-geometry affine inverse; required for gradient paints, see above. */
	readonly worldToLocal?: GpuMatrix2D;
	/** Fixed-function blend variant to draw with; `undefined` means "normal". See {@link GpuBlendMode}'s doc comment. */
	readonly blendMode?: GpuBlendMode;
};

/**
 * One legacy uniform-stroke draw (E1 S3, dashing added E1 S8 — see
 * `docs/gpu-canvas-convergence-e1-plan.md`'s stroke and S8 decisions). `mesh`
 * is a flat, interleaved `[posX, posY, offsetX, offsetY, arcLength, ...]`
 * vertex buffer built fresh every frame from the WORLD-space flattened
 * centerline (see `shared/gpu/stroke-mesh.ts`) — every vertex's actual screen
 * position is `position + offset * halfWidthWorld`, computed in the vertex
 * shader so a zoom/pan change never re-tessellates this mesh. `halfWidthWorld`
 * is `(strokeWidth / 2) / cameraScale`, i.e. already the WORLD-space
 * half-width that reproduces a SCREEN-constant stroke width — the caller
 * recomputes it every frame from the current camera scale (cheap scalar
 * division, not a re-tessellation). `coverRect` is expanded (by the caller)
 * past the node's own paint bounds by the worst-case miter reach, in WORLD
 * space. `paint` may be solid, linear-gradient, radial-gradient, or image; for
 * gradient/image strokes, `worldToLocal` is the inverse of the stroked node's
 * own world transform, so the cover shader samples the paint server in the
 * same node-local/object-bounding-box coordinate space SVG uses for the
 * stroke's `url(#paint)`. Mesh stroke paints remain capability fallbacks
 * (`"stroke_paint"`). `kind: "stroke"` is this draw's tag in the
 * discriminated {@link GpuArtboardDraw} union.
 *
 * `dashPatternWorld`/`dashOffsetWorld` (E1 S8) are the SCREEN-px authored
 * `strokeDash`/`strokeDashoffset` values, CPU-converted to WORLD units by the
 * caller every frame (`value / cameraScale`, the SAME per-frame conversion
 * cadence as `halfWidthWorld` — see `gpu-scene-frame.ts::strokeDrawFromCompile`)
 * so a zoom/pan change never re-tessellates the mesh for a dash either. Both
 * are `undefined` for an undashed stroke (byte-identical to pre-S8 rendering —
 * the WGSL fragment stage short-circuits on a zero dash count before any
 * pattern math). `dashPatternWorld` is always even-length and
 * `1..MAX_DASH_PATTERN_ENTRIES` long when present — see
 * {@link MAX_DASH_PATTERN_ENTRIES}.
 */
export type GpuStrokeDraw = {
	readonly kind: "stroke";
	/** Scene-agnostic grouping key used by node-local effect islands. */
	readonly ownerId?: string;
	readonly mesh: Float32Array;
	readonly halfWidthWorld: number;
	readonly coverRect: GpuWorldRect;
	readonly paint: GpuStrokePaint;
	/** World -> node-local-geometry affine inverse; required for gradient/image stroke paints, see above. */
	readonly worldToLocal?: GpuMatrix2D;
	/** World-unit dash pattern (screen->world converted per frame); absent means undashed. See this type's doc comment. */
	readonly dashPatternWorld?: readonly number[];
	/** World-unit dash phase offset (screen->world converted per frame); only meaningful alongside `dashPatternWorld`. */
	readonly dashOffsetWorld?: number;
};

/**
 * Opens a single-level hard clip-path scope (E1 S7 — see
 * `docs/gpu-canvas-convergence-e1-plan.md`'s S7 decisions for the full
 * stencil bit-partition mechanism). `triangles` are the mask SOURCE node's
 * own WORLD-space stencil fan triangles (built the SAME way a fill entry's
 * `GpuFillDraw.triangles` are — `shared/gpu/flatten.ts::fanTriangulateRings`
 * over the source's own contours) and `fillRule` its own winding rule;
 * `coverRect` is the source's own WORLD-space paint bounds, used for the
 * materialize pass's screen-space quad. Every draw between a `clip-begin`
 * and its matching `clip-end` (same artboard, never nested — the resolver
 * this compiles from rejects mask chains) renders through the CLIPPED cover
 * pipeline variants instead of the ordinary ones; a `clip-begin` with zero
 * triangles is a valid, total "empty clip" (nothing inside the scope ever
 * draws), matching SVG's own empty-`<clipPath>` semantics.
 */
export type GpuClipBegin = {
	readonly kind: "clip-begin";
	readonly triangles: Float32Array;
	readonly fillRule: "nonzero" | "evenodd";
	readonly coverRect: GpuWorldRect;
};

/**
 * Closes the clip scope opened by the preceding `GpuClipBegin` in the same
 * artboard's `draws` list (E1 S7). `coverRect` is the SAME silhouette bounds
 * `GpuClipBegin.coverRect` carried — carried again here (rather than left
 * for the renderer to remember) so the renderer's prepare pass can size the
 * clear-quad's cover geometry without threading extra state between the two
 * entries.
 */
export type GpuClipEnd = {
	readonly kind: "clip-end";
	readonly coverRect: GpuWorldRect;
};

export type GpuDirectionalRadianceRay = {
	readonly enabled: boolean;
	readonly direction: GpuLocalPoint;
	readonly intensity: number;
	readonly bridgeSigma: readonly [number, number];
	readonly samples: readonly {
		readonly offset: GpuLocalPoint;
		readonly weight: number;
	}[];
};

export type GpuRadianceFieldEffect = {
	readonly kind: "radiance-field";
	readonly bounds: GpuWorldRect;
	readonly threshold: number;
	readonly bloom: {
		readonly enabled: boolean;
		readonly radiusX: number;
		readonly radiusY: number;
		readonly intensity: number;
	};
	readonly rays: readonly GpuDirectionalRadianceRay[];
	readonly atmosphere?: {
		readonly enabled: boolean;
		readonly direction: GpuLocalPoint;
		readonly mix: number;
		readonly falloff: number;
		readonly reach: number;
		readonly tint: GpuColor;
	};
	readonly lens?: {
		readonly enabled: boolean;
		readonly mix: number;
		readonly chroma: number;
		readonly reach: number;
	};
	readonly blendMode: "normal" | "screen";
};

export type GpuSurfaceResponseFieldEffect = {
	readonly kind: "surface-response-field";
	readonly bounds: GpuWorldRect;
	readonly direction: GpuLocalPoint;
	readonly surface?: {
		readonly amount: number;
		readonly width: number;
		readonly softness: number;
		readonly tint: GpuColor;
	};
	readonly diffusion?: {
		readonly amount: number;
		readonly depth: number;
		readonly softness: number;
		readonly tint: GpuColor;
	};
	readonly edge?: {
		readonly amount: number;
		readonly width: number;
		readonly softness: number;
		readonly tint: GpuColor;
	};
	readonly microstructureAmount: number;
	readonly spectral?: {
		readonly amount: number;
		readonly offset: number;
	};
};

/** Generic node-local sampled-texture effect; no scene or rig identity leaks here. */
export type GpuNodeEffect =
	| GpuRadianceFieldEffect
	| GpuSurfaceResponseFieldEffect;

export type GpuEffectIslandBegin = {
	readonly kind: "effect-island-begin";
	readonly id: string;
	readonly effect: GpuNodeEffect;
};

export type GpuEffectIslandEnd = {
	readonly kind: "effect-island-end";
	readonly id: string;
};

/**
 * One artboard draw in DOCUMENT PAINT ORDER (E1 S3 review fix — see
 * `docs/gpu-canvas-convergence-e1-plan.md`'s review-findings addendum). A
 * fill, a stroke, or (E1 S7) a clip-scope boundary, tagged by `kind` so the
 * renderer (`webgpu.ts`) can dispatch each entry to its own pipeline/state
 * transition while replaying the SAME relative order the compiler
 * (`entities/scene/model/gpu/display-list.ts`) emitted — that compiler
 * already interleaves a node's own fill entry immediately before its own
 * stroke/outline entry, and different nodes' entries are never interleaved
 * with each other, so ONE ordered array here (as opposed to S2/S3's separate
 * `fills`/`strokes` arrays, which silently reordered any DIFFERENT node's
 * stroke ahead of a later node's fill — see that historical bug this union
 * fixes) reproduces correct cross-node paint order for overlapping content,
 * not just correct same-node "stroke over its own fill" order. A
 * `GpuClipBegin`/`GpuClipEnd` pair always wraps its content's own fill/stroke
 * entries contiguously (the compiler emits the begin, then the masked
 * content's own entries via its ordinary recursive compile, then the end) —
 * never interleaved with a sibling node's unrelated entries.
 */
export type GpuArtboardDraw =
	| GpuFillDraw
	| GpuStrokeDraw
	| GpuClipBegin
	| GpuClipEnd
	| GpuEffectIslandBegin
	| GpuEffectIslandEnd;

export type GpuArtboardChromaticAberrationPostEffect = {
	readonly kind: "chromatic-aberration";
	readonly fringing: number;
	readonly maxShiftPx: number;
	readonly centerX: number;
	readonly centerY: number;
};

export type GpuArtboardFilmGrainPostEffect = {
	readonly kind: "film-grain";
	readonly href: string;
	readonly backgroundWeight: number;
	readonly objectWeight: number;
	readonly chromaticAberration?: GpuArtboardChromaticAberrationPostEffect;
};

/**
 * Postprocess applied to a GPU-active artboard after its source pixels have
 * been resolved into the offscreen source texture. S18 models the legacy frame
 * film pair the SVG canvas already renders: chromatic aberration and grain.
 * More complex Look/effect projections stay outside this union and therefore
 * keep their artboard on SVG.
 */
export type GpuArtboardPostEffect =
	| GpuArtboardChromaticAberrationPostEffect
	| GpuArtboardFilmGrainPostEffect;

/**
 * One GPU-active artboard's content this frame: an optional opaque background
 * quad plus its ordered draws. A GPU-INACTIVE artboard is simply absent from
 * `GpuFrameSpec.artboards` entirely (see that field's doc comment) — this
 * type only ever describes an ACTIVE artboard's content. `rect` is the
 * artboard's own world-space frame, used by postprocess passes after the
 * ordered source render has resolved. `clipRect`, when present, scissors
 * every draw in `draws` to that WORLD-space rect; S2/S3
 * never set it (the SVG renderer does not clip ordinary artboard content to
 * the artboard rect — see `docs/gpu-canvas-convergence-e1-plan.md` S2
 * acceptance notes), but the field exists so a later slice that adds
 * `frame.clipsContent`/frame-look clipping does not need a frame-spec shape
 * change. `draws` is ONE ordered list (not split by kind) — see
 * {@link GpuArtboardDraw}'s doc comment for why a same-kind split silently
 * broke cross-node paint order; the renderer switches pipeline per entry
 * (correctness first, batching is a non-goal for this RHI-lite).
 */
export type GpuArtboardContent = {
	readonly rect: GpuWorldRect;
	readonly clipRect?: GpuWorldRect;
	readonly backgroundQuad?: GpuQuad;
	readonly draws: readonly GpuArtboardDraw[];
	readonly postEffects?: readonly GpuArtboardPostEffect[];
};

/**
 * Everything one `renderFrame` call needs: the camera and the draw list.
 * There is no separate "background-only" quad list — a GPU-INACTIVE artboard
 * contributes ZERO pixels here (S1's draw-every-artboard's-background
 * placeholder was retired in the S2 review pass; see
 * `docs/gpu-canvas-convergence-e1-plan.md` D2): its background rect and real
 * node content are the SVG scene layer's to paint, showing through the
 * transparent canvas untouched. `artboards` therefore only ever contains
 * GPU-ACTIVE artboards' content.
 */
export type GpuFrameSpec = {
	readonly camera: GpuCamera;
	/** GPU-active artboards' full content (background + fills + strokes), keyed by nothing in particular — order is paint/z order across artboards. */
	readonly artboards: readonly GpuArtboardContent[];
};

/** CSS-pixel viewport size plus the device pixel ratio to back the canvas at. */
export type GpuSurfaceConfig = {
	readonly cssWidth: number;
	readonly cssHeight: number;
	readonly dpr: number;
};

/**
 * Lifecycle states surfaced to the DOM (`data-gpu-canvas`) for manual/dev
 * verification: `"init"` before the async device/adapter handshake resolves,
 * `"active"` once frames are being drawn, `"unavailable"` when WebGPU could
 * not be initialized (degrade honestly — caller keeps the SVG layer as the
 * only renderer), `"lost"` after the GPU device reports `device.lost`.
 */
export type GpuCanvasStatus = "init" | "active" | "unavailable" | "lost";

/**
 * The RHI-lite surface handle. Every method is a no-op (never throws) once
 * {@link GpuCanvasSurface.isLost} is true, so callers do not need to guard
 * every call site after a device-lost event.
 */
export type GpuCanvasSurface = {
	/**
	 * (Re)configures the backing store and swapchain for a new CSS size/DPR.
	 * Safe to call every time the canvas' parent resizes; recreates the MSAA
	 * color and depth-stencil attachments to match.
	 */
	readonly configure: (config: GpuSurfaceConfig) => void;
	/** Draws one frame: clears, then paints `frame.artboards` under `frame.camera`. */
	readonly renderFrame: (frame: GpuFrameSpec) => void;
	/** True once the underlying `GPUDevice` has reported `lost`. */
	readonly isLost: () => boolean;
	/** Releases GPU resources. The surface must not be used after this call. */
	readonly dispose: () => void;
};
