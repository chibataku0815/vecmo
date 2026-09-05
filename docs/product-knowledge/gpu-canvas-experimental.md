# Experimental GPU Canvas (`gpuCanvas` Flag)

Date: 2026-07-07 (S33 non-singular image paint transforms and known-opaque image/mesh artboard background admission; S31 exclusion fixed-function blend admission; S30 hard alpha-mask stencil admission; S29 static text stroke raster; S28 explicit serial frame-film LookGraph projection; S27 topmost frame-film overlap admission; S26 explicit serial grain LookGraph; S25 image-reference uniform strokes; S24 gradient uniform strokes; S23 mesh paint transform gate; S9.5 static mesh text fill; S9.4 static fitted/cropped image text fill; S9.3 static stretched image text fill; S22 placed-image source crop UV parity; S21 image-reference fit/crop UV parity; S20 projected frame effect-layer-stack film pass; S19 sharp polygon/star dash unlock; S18 legacy frame film-grain texture/WGSL pass; S17 legacy frame chromatic-aberration WGSL pass; S16 offscreen source texture + swapchain composite; S15 WebGPU replay seam for later offscreen Look/effect composition; S14 no-op frame Look/recipe gate; S13 no-op node effect/recipe gate; S12 line stroke geometry; S11 polygon/star geometry; S10 opaque gradient artboard backgrounds; S9.2 static gradient text fill; S9.1 static text multiply/screen; S9.0 static text raster; post-S8 straight-path dash unlock;
S8 dash landed and was temporarily narrowed to rect-only on 2026-07-06; S7
landed 2026-07-06; S6 landed 2026-07-06; S5 landed 2026-07-06; post-S4
review-fix pass; S4 landed 2026-07-06, S3 landed 2026-07-06, S2 landed
2026-07-06, S1 landed 2026-07-05). Status: internal, experimental,
flag-gated.

## Summary

The editor canvas can optionally mount a second, WebGPU-backed rendering
surface above the existing SVG scene layer. This is part of a multi-slice
strangler migration described in `docs/gpu-canvas-convergence-e1-plan.md`:
over several slices, GPU rendering takes over more of the canvas so large/
animated documents stay smooth at SVG-DOM scale. **As of S33, an
artboard can use a single fully opaque solid, linear-gradient, radial-gradient, known-opaque image-reference, or known-opaque mesh-gradient
background, and renders its solid-fill, gradient-fill, image-fill (including non-singular paint transforms), and untransformed mesh-gradient-
fill shape content (rects, ellipses, paths, polygons, stars, placed image nodes), line strokes, static
solid/linear/radial/image/untransformed-mesh-fill text nodes with optional narrow solid/linear/radial text stroke (normal, `multiply`, `screen`, or `exclusion` blend), plus solid, linear/radial-gradient, or image-reference legacy uniform strokes, including non-singular image paint transforms (optionally dashed — v1's
dash envelope is un-rounded native rect outlines, `line`, straight `path`, and
sharp `polygon`/`star` geometry, any transform, see "Dashed Strokes (S8)" below) and E0 width-profile
strokes, a fixed five-mode blend subset (`multiply`/`screen`/`darken`/
`lighten`/`exclusion`) on an eligible leaf, PLUS a single-level hard clip-path or hard alpha-mask relation (a
content node masked by exactly one top-level sibling silhouette, no soft
settings), plus a narrow frame film Look (legacy film grain/chromatic aberration or an explicit serial LookGraph whose projection has only frame-film output), on the GPU surface, per-artboard, only when every node in it
qualifies.** The frame film Look is admitted only when the live frame-film passes are grain and/or chromatic aberration with no frame influence mask, no later-painted overlapping artboard covering the frame rect, and no overhanging artboard content. Earlier/lower overlapping artboards are allowed because the admitted artboard's opaque GPU background isolates its source pixels before the post-effect overwrite. An explicit effect-layer stack qualifies only through the live renderer's synchronized legacy `visualRecipe` projection; explicit LookGraphs qualify only when their serial stack projection contains visible frame-film output and no visible non-frame-film output (for example a converted legacy graph with neutral Glow/Grade around Grain). Arbitrary stack layers, branching/masked/composite explicit LookGraphs, visible grade/glow graphs, and explicit non-frame-film graph effects remain SVG. Animated text, non-admitted text strokes, tiled/transformed image text fills, text `darken`/`lighten`, renderable effects/Looks outside that frame-film subset,
soft/translucent/expanded/inverted alpha masks, multi-application or chained masks, a dash pattern with a
non-butt cap, more than 8 entries, or on curved/unsupported geometry, mesh
strokes, tiled/singular-transform/degenerate image strokes, the other 11 blend modes (and the five admitted modes on a carrier,
on a leaf mixing fill+stroke, or overhanging its artboard, plus `darken`/`lighten` on text),
tiled image fills, singular image paint transforms, and paint-level gradient/mesh transforms are still
unsupported and keep their whole artboard on SVG. Multi-paint, translucent,
transparent-source image backgrounds, tiled/transformed image backgrounds, transparent/degenerate mesh, or transformed mesh artboard backgrounds are still SVG-only. An artboard that does not
qualify keeps rendering exactly as before, entirely in SVG. The feature is off
by default and invisible unless explicitly enabled.

## What Changed?

- A new `<canvas>` element is conditionally mounted inside `CanvasShell`,
  positioned directly above the SVG scene layer (`pointer-events: none`, so
  it never intercepts clicks/drags).
- **Capability check, per artboard:** on every committed document edit,
  `computeGpuArtboardSupport` checks every node in every artboard against a
  fixed capability list (below). An artboard is "GPU-active" only if every
  node in it — including any whole-artboard look/filter and any masks —
  passes. This check runs on the COMMITTED document only, never mid-drag or
  mid-playback-scrub, so an artboard's render path never flips while the user
  is actively editing it (it can only flip on a committed edit that adds or
  removes an unsupported feature, which is an accepted, rare, visible pop).
- **GPU-active artboards:** their single fully opaque background paint (solid,
  linear-gradient, or radial-gradient) AND their fill/stroke
  shape content render on the GPU surface; the SVG renderer skips painting
  that artboard's node content (the artboard's background rect/shadow, frame
  border, and name label stay in SVG — only the shapes themselves move to
  GPU). Dragging a node in a GPU-active artboard follows the pointer live;
  playing the timeline animates its transform/opacity tracks on the GPU
  surface.
- **Gradient fills (S3):** linear and radial gradients render on the GPU by
  precomputing the node's inverse world transform CPU-side and projecting
  each fragment's position back into the gradient's own local space every
  frame — exact under rotation, non-uniform scale, and shear, not just
  uniform scale. Gradient stops interpolate in premultiplied alpha, matching
  the SVG/canvas renderers' existing convention (no gray fringing at
  transparent stops). Radial gradients are circular-only (`max(rx, ry, 0)`),
  the same simplification the SVG and canvas renderers already apply.
- **Legacy uniform strokes (S3):** a solid-color stroke with a single width,
  no dash pattern, and no gradient paint renders via a dedicated GPU
  stencil-then-cover pass with vertex-shader extrusion. The stroke's
  half-width is expressed in WORLD units as `strokeWidth / 2 / cameraScale`,
  recomputed every frame from the live camera zoom, reproducing the SVG
  renderer's `non-scaling-stroke` behavior (constant on-screen width
  regardless of zoom) exactly, including caps, joins (miter/round/bevel with
  miter-limit fallback to bevel), on both open and closed paths.
- **E0 width-profile strokes (S3):** a pressure/width-profile stroke (see the
  variable-width-stroke feature) is pre-expanded into its outline polygon by
  the SAME geometry function the SVG/canvas renderers already use, then
  painted through the GPU's ordinary SOLID-FILL pipeline — it does not use
  the new stencil-then-cover stroke pass at all, since its geometry is
  already a filled outline by the time it reaches the GPU compiler.
- **Image fills, placed image nodes, and mesh-gradient fills (S5/S21/S22/S23/S33):** an
  image-reference fill paint, a placed image node (an editable rectangular
  image placement, not a paint role), and an untransformed gradient-mesh fill all render on
  the GPU via a textured cover-pass pipeline. Image-reference fills support
  `fit: "fill"` stretch, `fit: "fit"` centered letterbox, and `fit: "crop"`
  centered cover/crop using the decoded texture's intrinsic aspect ratio, and
  non-singular paint transforms by folding the inverse SVG `patternTransform`
  into the existing `worldToLocal` projection.
  Placed image nodes also support source-crop metadata by remapping the sampled
  source UV rect. Tiled image paints, singular image paint transforms, image text/
  background transforms, and paint-level mesh-gradient transforms are
  unsupported and keep the whole artboard on SVG for now. Texture upload is
  **asynchronous**: the first frame after a document edit adds a new image/
  mesh paint, that ONE draw is skipped (the rest of the artboard still
  renders) while the bitmap decodes and uploads in the background; the very
  next frame after upload completes picks it up automatically (no visible
  "stuck blank" state, and no separate loading indicator). An un-rasterized
  mesh-gradient fill compiles to a pending paint (the display-list compiler
  never rasterizes a mesh itself); the widget-layer frame builder resolves
  that pending paint into a drawable image paint by rasterizing it through the
  SAME shared mesh-raster bridge singleton the SVG renderer already uses for
  mesh fills — so a mesh paint's GPU and SVG pixels are byte-identical and a
  mesh is never rasterized twice for the same content — and folds in the
  node's full opacity chain (inherited-ancestor opacity × the node's own
  opacity × the paint's own fill opacity) at that same resolution step. A
  PLACED IMAGE NODE whose asset is missing/unresolvable, or an image/mesh paint
  that uses a still-unsupported paint transform, keeps its whole artboard on SVG (dev console
  reasons `"image_asset"`/`"image_feature"`/`"mesh_feature"`) exactly like every other
  capability failure. An image-reference FILL paint whose asset does not
  resolve is different: both renderers resolve fill paints through the SAME
  shared `canvasPaintsForStyle` call, so an unresolvable fill href degrades
  identically on GPU and SVG (the shared fallback color, or no fill) —
  there is nothing for the GPU path to fail to reproduce, so this case
  intentionally does not trip capability and is not an `"image_asset"`
  reason.
- **Single-level hard masks (S7/S30):** a content node with exactly one hard
  clip-path or hard alpha-mask relation (a "use as mask" applied to a top-level
  sibling shape, no feather/opacity/expand/invert settings) now renders its
  hard silhouette on the GPU surface too — see "Single-Level Hard Masks (S7/S30)" below for the
  admitted subset and the mechanism.
- **Other artboards:** unchanged from S1 — only their opaque background
  paints on the GPU surface (pixel-aligned with the SVG background rect), and
  every node continues rendering in SVG exactly as before.
- **Artboard grid fix (post-S4):** the artboard-scoped construction grid (the
  `Show grid` / Mod+' toggle) used to render inside the SVG scene layer,
  BELOW that artboard's node content — invisible under a GPU-active
  artboard's opaque GPU-drawn background and shapes. A GPU-active artboard's
  grid now repaints a second time in a new screen-space `<svg>` layer mounted
  directly above the GPU `<canvas>` (`GpuArtboardGridLayer` in
  `CanvasShell.tsx`), and its original in-scene render is suppressed for that
  artboard so it never double-draws. Every non-GPU-active artboard (flag off
  entirely, or an artboard that individually fails capability) is completely
  unaffected — same element, same position, same z-order as before this fix.
- The surface subscribes imperatively to the scene, motion, motion-grammar,
  live-drag-override, viewport, and transport stores and redraws (coalesced
  through a single `requestAnimationFrame`) on document edits, motion/grammar
  edits, live drags, pan/zoom, and playback ticks. It never advances the
  timeline itself — the existing `PlaybackDriver` remains the sole frame
  advancer.
- If WebGPU is unavailable (no `navigator.gpu`, no adapter, device request
  failure, or context configuration failure), the surface silently does not
  mount; the editor is visually and functionally identical to today.

## Capability List (S5-S33)

An artboard is GPU-active only if EVERY node in it satisfies all of the
following (any failure keeps that whole artboard on SVG):

- Geometry is a rectangle (including rounded corners), ellipse, path, polygon,
  star, placed image node, static text node, or stroke-only line. A line with
  visible fill stays on SVG because SVG ignores `fill` on `<line>` while the GPU
  fill path would otherwise treat it as area paint.
- A text node is admitted only in the S9.x/S29/S31 static raster envelope: no active
  live text animator, no width-profile outline, a solid, linear-gradient,
  radial-gradient, image-reference `fit: "fill"`/`"fit"`/`"crop"`, or
  untransformed mesh-gradient fill, optional single solid/linear/radial text
  stroke with no dash/blur/underline, and blend mode `normal`, `multiply`,
  `screen`, or `exclusion`. The widget layer rasterizes admitted text with Canvas2D at the
  current zoom bucket/DPR and feeds the bitmap through the existing image
  texture pipeline. Text with image `fit: "tile"` or paint transform, mesh paint
  transform, active text animator, image/mesh text stroke, dashed/blurred/profile
  text stroke, underlined stroked text, `darken`/`lighten` or any other non-admitted blend
  mode keeps the whole artboard on SVG (`"text"` or the more specific stroke
  reason when applicable).
- Exactly zero or one visible fill, which is a solid color, a linear
  gradient, a radial gradient, an image reference, or a gradient mesh; a
  gradient fill has between 1 and 8 stops (an empty stop list keeps the
  artboard on SVG, same as too many), no local transform of its own, and
  every stop resolves to a parseable color; an image-reference fill must
  resolve to a usable asset/href, use `fit: "fill"`, `"fit"`, or `"crop"`
  (`"tile"` is unsupported), and any paint-level transform must be
  non-singular;
  a gradient-mesh fill must carry no paint-level transform; its bitmap availability is a
  runtime timing detail, not a capability failure — see "Async Texture/Raster
  Loading (S5)" below).
- A placed image node (an editable rectangular image placement, distinct from
  an image-reference FILL paint) must resolve to a usable asset/href. Source
  crop metadata is admitted and maps to the same source sub-rect as the SVG
  nested-viewBox branch.
- The node's stroke is either absent, a solid-color, linear/radial-gradient, or
  image-reference legacy uniform stroke (optionally dashed, see "Dashed
  Strokes (S8)" below), or an E0 width-profile stroke with a parseable solid
  stroke color. Gradient uniform strokes share the fill-gradient limits: 1 to
  8 stops, no paint-level transform, and parseable stop colors. Image-reference
  uniform strokes share the image-fill limits: resolvable href/asset,
  `fit:"fill"|"fit"|"crop"`, any paint-level transform must be non-singular,
  and a non-degenerate
  object bounding box. Mesh-paint strokes keep the whole artboard on SVG. A
  dash pattern is admitted only with
  a `butt` stroke cap, no more than 8 pattern entries after SVG's odd-length
  normalization (an odd-length pattern is repeated once to become even,
  matching `stroke-dasharray` semantics), AND on either a native-`<rect>` fast
  path (zero corner rounding and no corner smoothing), `line`, `path` geometry
  whose outer shape and subpaths are all straight zero-tangent contours, or
  sharp `polygon`/`star` geometry whose live renderer branch is native
  `<polygon>`, in ANY orientation/transform. A `round`/`square` dash cap, a
  longer pattern, curved geometry, a rounded/smoothed rect, rounded
  polygon/star geometry, or a still-unsupported geometry kind keeps the whole
  artboard on SVG, same as before this slice. A dash on an E0 width-profile stroke is out of scope regardless
  (the scene model itself ignores `strokeDash`/`strokeDashoffset` once a width
  profile is present — a dashed variable-width stroke is a v1-wide limitation,
  not a GPU-specific one).
- No renderable effects (shadows, blurs) and no renderable Look/recipe on
  nodes. Frame Looks are still SVG except for the legacy frame film grain/chromatic-aberration
  subset. S13 uses the shared SVG filter builder as the node
  gate: a zero-radius blur, a zero-opacity shadow, or a neutral node recipe
  that serializes no filter primitives is identity and does not force SVG
  fallback. S14 applies the same visible-output rule to frame intent: a neutral
  explicit frame/scene `lookGraph`, or a legacy `visualRecipe` with no live
  frame-film pass (grain or chromatic aberration), is identity and does not
  force SVG fallback. A legacy frame `visualRecipe` with film grain and/or
  chromatic aberration can render through the GPU postprocess when there is no
  influence mask, no later-painted overlapping artboard covering this frame
  rect, and no overhanging artboard content. S26
  admits the same postprocess path for an explicit serial Source -> Grain ->
  Output LookGraph; S28 widens that to serial explicit graphs whose projected
  recipe has frame-film output only, so disabled or neutral Glow/Grade nodes
  around Grain do not force SVG. Branching graphs, masked graph nodes,
  visible grade/glow graphs, and non-frame-film graph effects still fall back. S20
  applies that same rule when an authoring `effectLayerStack` has already been
  synchronized into the legacy `visualRecipe` that the live canvas actually
  renders. This is not a generic stack renderer: any node effect/recipe,
  non-admitted explicit graph, scoped Look target, arbitrary stack-only output, or
  masked/later-covered/overhanging frame Look still falls back.
- Any mask relation on the node is EITHER absent, OR a single hard clip-path
  mask or hard alpha-mask relation (a content node with EXACTLY ONE relation
  targeting a top-level sibling shape, no feather/opacity/expand/invert settings
  — see "Single-Level Hard Masks (S7/S30)" below). A soft/translucent/expanded/
  inverted alpha mask, more than one
  application on the same content node, or a chained mask (a mask source
  that is itself masked, or a content node that is itself a mask source)
  keeps the whole artboard on SVG, as does a mask SOURCE node that is
  consumed by even one relation outside this admitted subset. An admitted
  source's own fill/stroke/effects are never separately checked (it never
  paints as ordinary content either way).
- Blend mode is `normal` (or unset), OR one of the five fixed-function modes
  (`multiply`/`screen`/`darken`/`lighten`/`exclusion` — see "Fixed-Function Blend Modes
  (S6/S31)" below) on a LEAF node whose own paint is fill-only or E0-outline-only
  (never both, never a uniform stroke), whose COMMITTED world paint bounds
  sit fully inside its own artboard rect, and — for `darken`/`lighten` only
  — whose visible paint is a fully opaque solid color. The other 11 blend
  modes, and any of these five on a container (group/frame/Blend), on a
  node failing one of the narrower per-leaf checks above, or on a leaf whose
  committed bounds overhang its own artboard, keep the whole artboard on
  SVG.
- A group/frame/Blend container's own opacity is exactly `1` (no fade) and,
  if animated, never keyframes below full opacity — its own composited
  subtree opacity is not yet GPU-representable otherwise. A LEAF node whose
  own fill and stroke are both visible AND whose own opacity can go below `1`
  (a static sub-unity `style.opacity`, an animated opacity keyframe below 1,
  or a motion-grammar binding driving opacity) also keeps its artboard on
  SVG — the combined fill+stroke composite is not yet GPU-representable at
  less than full opacity without double-darkening the overlap.
- The artboard's own background has exactly one visible paint: either an opaque,
  valid solid hex color, an opaque linear/radial gradient with 1 to 8 fully
  opaque parseable-color stops and no paint-level transform, a known-opaque
  image-reference background with no transform, or a known-opaque mesh-gradient
  background with no transform. Multi-paint, translucent, transparent-source,
  tiled/transformed image, or transparent/degenerate/transformed mesh
  backgrounds keep the whole artboard on SVG.

Artboards failing any of the above keep today's SVG rendering, untouched, for
every node — there is no partial GPU/SVG split within one artboard.

## Artboard Backgrounds (S10/S33)

GPU-active artboards now accept a single fully opaque frame background paint:
solid, linear-gradient, radial-gradient, an image-reference whose source is
statically known to be opaque, or a mesh-gradient whose raster is statically
known to be opaque. Solid backgrounds still use the original cheap `GpuQuad`
path. Gradient and S33 image/mesh backgrounds are compiled as the first
artboard-local rectangle fill draw, so they reuse the same stencil/cover path
and `worldToLocal` projection contract as ordinary node paints.

The SVG artboard chrome remains mounted underneath the GPU canvas during E1, so
transparent frame backgrounds would double-composite if the GPU drew another
semi-transparent copy above it. For that reason, S10 admits only fully opaque
paint opacity and fully opaque stops. S33 admits image backgrounds only when
document asset MIME metadata or an inline data URL MIME header identifies a JPEG
source, because JPEG has no alpha channel. Mesh backgrounds are admitted only
when the mesh has paint opacity 1, no transform, valid non-empty bounds, at
least one Coons patch, parseable `#rgb`/`#rrggbb` point colors, and no point
opacity below 1. External hrefs with unknown MIME, PNG/WebP/data images that may
carry alpha, `fit: "tile"`, image background transforms, transparent or degenerate mesh
backgrounds, mesh transforms, multi-paint stacks, empty gradients, and
gradients with more than 8 stops still keep the whole artboard on SVG.

## Static Text Raster (S9.0/S9.1/S9.2/S9.3/S9.4/S9.5/S29)

Static text nodes no longer force an otherwise-capable artboard back to SVG
when they stay inside a narrow raster envelope: solid/linear/radial fill or
image-reference `fit: "fill"`/`"fit"`/`"crop"` with no paint transform, or an
untransformed mesh-gradient fill, optional single solid/linear/radial text
stroke with no dash/blur/underline/profile outline, no active live text animator,
and blend mode `normal`, `multiply`, `screen`, or `exclusion`.
The entities-layer GPU display list emits a DOM-free `text-pending` paint
carrying the scene text geometry plus resolved fill/stroke facts; the
widget-layer frame builder rasterizes it with Canvas2D and hands `shared/gpu` a
regular image fill. `shared/gpu` therefore keeps using the same texture upload
and textured cover-pass pipeline added for S5 images and mesh rasters.

The raster is keyed by text geometry, fill/stroke payload, expanded raster bounds,
and zoom bucket/DPR. A pan-only redraw reuses the cached bitmap, while crossing a
zoom bucket or moving to a different DPR regenerates a sharper texture. S29 draws
the fill first and the admitted stroke second inside the same bitmap, so text
fill+stroke opacity and `multiply`/`screen` blend as one object. This is still a
raster text path, not a full vector glyph atlas: text with an active text
animator, image `fit: "tile"` or paint transform, image/mesh text stroke,
dashed/blurred/profile or underlined stroked text, `darken`/`lighten`, or any
other blend mode remains on SVG so animated fragment layout, richer texture
placement, and richer typography do not drift from the reference renderer.

## Async Texture/Raster Loading (S5)

Unlike every other paint kind (which draws fully resolved the moment an
artboard becomes GPU-active), an image-reference fill or a placed image node
needs an asynchronous step — decoding the source bytes and uploading them to
the GPU — before its pixels exist. This is invisible in the common case (a
document reload, or an artboard that was already GPU-active before the image
was added, already has the texture cached) and shows as a brief one-frame
gap only the first time a given image's bytes are seen by the GPU surface in
this page session: that ONE draw is simply omitted for that frame (the rest
of the artboard, and every other artboard, renders normally), and the very
next frame after the upload completes repaints it — no stuck/blank state, no
loading spinner, no separate retry needed. A resident texture is capped at
4096px per side (a huge embedded photo is downscaled on upload) and the GPU
surface keeps at most 64 decoded textures resident at once (least-recently-
used eviction, transparent to the user — an evicted image just re-uploads,
with the same one-frame gap, the next time it is drawn). A mesh-gradient
fill's bitmap is produced by ordinary synchronous CPU rasterization (the SAME
cached rasterizer the SVG renderer already uses for mesh fills) — no async
gap of its own, though the RESULTING bitmap still goes through the same
texture-upload step as any other image, so a genuinely new/large mesh can
show the same one-frame gap the first time it renders.

## Fixed-Function Blend Modes (S6/S31)

Five of the scene model's 16 blend modes — `multiply`, `screen`, `darken`,
`lighten`, and `exclusion` — are exactly representable with WebGPU's fixed-function
`GPUBlendState` over the artboard's OWN opaque background quad, with no
shader change: each mode is one `GPURenderPipeline` variant (color-component
factors/operation only; the alpha component is unchanged "normal" blending on
every variant, so interior alpha always stays `1` over the opaque backdrop).
The other 11 modes (`overlay`, `color-dodge`, `color-burn`, `hard-light`,
`soft-light`, `difference`, `hue`, `saturation`, `color`,
`luminosity`) have no fixed-function equivalent and are unsupported — a node
using any of them keeps its whole artboard on SVG (`"blend_mode"` in the dev
console), exactly like every other unsupported feature.

**Why these five are exact over an opaque backdrop:**

- `multiply`/`screen` are exact for a source of ANY alpha (`0..1`) blending
  over a fully opaque destination — the algebra works out identically to CSS
  `multiply`/`screen` regardless of how translucent the source paint is. This
  is why a `multiply`/`screen` fixture pair in the stress-scene generator can
  freely put a gradient fill (spatially varying alpha) on either half of the
  pair.
- `darken`/`lighten` (`min`/`max` of source and destination color) are exact
  ONLY when the source is fully opaque (`alpha ≡ 1`) — WebGPU's `min`/`max`
  blend operations ignore alpha blending entirely (the spec requires
  `srcFactor`/`dstFactor` to both be `"one"` for these operations), so a
  translucent or spatially-varying-alpha source would silently composite
  wrong. The capability predicate enforces this: `darken`/`lighten` are only
  admitted on a leaf whose single visible paint is a solid color at full
  opacity — never a gradient, image, mesh, or a sub-unity opacity (static,
  animated, or motion-grammar-driven).
- `exclusion` is exact for a source of any alpha, using
  `srcFactor: "one-minus-dst"` and `dstFactor: "one-minus-src"`. With the
  existing premultiplied source output over an opaque backdrop, that computes
  `source * (1 - backdrop) + backdrop * (1 - source)`, which is CSS
  `exclusion` plus ordinary source-over coverage.

**The narrower per-leaf gates (beyond the five-mode check itself):**

- A CARRIER (a group/frame/Blend container, or any node with children) can
  never use a fixed-function blend mode — SVG composites a carrier's entire
  subtree first, then blends the flattened result as ONE unit; the GPU's
  per-leaf draw list has no equivalent "blend the already-composited
  subtree" operation. This keeps the whole artboard on SVG
  (`"blend_mode_feature"`).
- A LEAF mixing a visible fill AND a visible stroke-equivalent (a uniform
  stroke or an E0 width-profile outline) can never use a fixed-function
  blend mode either — SVG blends that leaf's fill+stroke composite as ONE
  unit (the same "combined paint" semantics `"combined_paint_opacity"`
  already protects for sub-unity opacity), so blending the fill and the
  stroke as two SEPARATE GPU draws would double-blend their overlap band.
  Only a fill-only or an E0-outline-only leaf is eligible.
- A uniform (non-scaling) stroke is excluded even as a leaf's ONLY visible
  paint: unlike an E0 outline (a fixed world-space contour), a uniform
  stroke's on-screen width is screen-constant, so its world-space reach
  changes with zoom — a property this predicate (evaluated once on the
  committed document, not per frame) cannot account for.
- A blended leaf's COMMITTED world paint bounds must sit fully inside its
  own artboard rect. SVG does not clip ordinary artboard content to the
  artboard's own rect (existing, unrelated behavior — see "What Is Still
  Limited?"), so an ordinary (non-blended) overhang is harmless: SVG simply
  keeps compositing it against whatever real pasteboard content is actually
  there. A BLENDED leaf is different — the GPU surface has no equivalent
  backdrop outside an artboard's own bounds, so blending against nothing
  there would visibly diverge from SVG's `mix-blend-mode`, which blends
  against real pasteboard content. This check is a LAZY pass: it only runs
  for an artboard that has at least one leaf surviving every other blend
  gate above, so an artboard with no blend-mode usage at all (the
  overwhelming majority of documents) pays no extra cost. Bounds are
  checked on the COMMITTED pose only, matching every other capability
  check's contract (D1's "no-flap" rule) — see "What Is Still Limited?" for
  the one remaining caveat this implies (a transform ANIMATED to overhang
  transiently mid-playback is not re-checked per frame).

## Single-Level Hard Masks (S7/S30)

A "use as mask" relation — the same Illustrator/Figma-style action the
editor's existing mask tooling authors — now renders its hard silhouette on the GPU
surface too, for the narrow subset where the clip is a single, hard
silhouette: exactly one mask application on the content node, the mask
source a top-level sibling shape (rectangle, ellipse, polygon, star, or
path) in the same layer and artboard, with no feather, opacity, expand, or
invert setting on the relation. S7 introduced true `clip-path` relations; S30
adds hard alpha-mask relations whose SVG output is still a fully opaque white
silhouette inside `<mask mask-type="alpha">`, which is binary-equivalent to the
same stencil clip test. The masked content itself can be anything
else already GPU-supported — a single shape, or a small group containing
several shapes with a mix of fills and strokes — the clip applies to that
content's ENTIRE compiled output as one silhouette. A soft/translucent/expanded/inverted alpha
mask, a content node with more than one mask application, or a chained mask (a mask source that is
itself masked, or a mask source that is itself masked content) is unsupported and keeps its whole
artboard on SVG.

**How it renders.** The GPU surface has one 8-bit stencil buffer per pixel
and no second render pass to spend on a mask — so a clip scope is encoded by
splitting that one byte in two: one bit tracks "is this pixel inside the
open clip's silhouette," while the other seven keep doing the ordinary
inside/outside accounting every other shape on the GPU already uses to fill
correctly. Opening a clip scope draws the mask source's own silhouette once
to convert its fill test into that one membership bit; every shape drawn
while the scope is open checks both "is my own fill/stroke test true" AND
"am I inside the open silhouette" before painting; closing the scope resets
that bit for whatever comes next. This adds no new render pass, no new
texture, and no per-frame cost for the overwhelming majority of documents
that use no masks at all.

## Dashed Strokes (S8)

A legacy uniform stroke's `strokeDash`/`strokeDashoffset` — the same
authoring surface that already produces a dashed stroke on the SVG renderer —
now renders its dashes on the GPU surface too for this subset: `strokeCap: "butt"`,
at most 8 pattern entries after SVG odd-length normalization, and
geometry that is either an un-rounded, un-smoothed native-`<rect>` fast path, a
`line`, a straight `path` whose outer shape and subpaths have only zero-tangent
segments, or a sharp `polygon`/`star` that the live renderer draws as native
`<polygon>`. Any transform/orientation is allowed. Dash lengths and the phase
offset are SCREEN pixels, exactly like stroke width itself: they read the same
at every zoom level and never change the mesh, because the dash test runs
entirely in the fragment shader against a per-frame, screen-to-world-converted
uniform, not by rebuilding geometry. Animating `strokeDashoffset` (a
"marching ants" or travelling-dash effect) therefore costs nothing beyond
that one per-frame scalar conversion — no re-tessellation, no extra draw call.

**Fixed alongside the straight-segment gate: `strokeDashoffset` reached the
GPU surface but not the SVG/canvas surface.** Before this fix, the scene
model's style-resolution layer normalized every other stroke sub-option
(`strokeDash`, `strokeCap`, `strokeJoin`, `strokeMiterLimit`) but never
resolved `strokeDashoffset`, so the ONE shared attribute builder both the
live canvas and the SVG exporter read from could never emit
`stroke-dashoffset` — the phase offset was silently dropped on both
non-GPU render surfaces, regardless of this GPU work. The GPU path read the
raw authored value correctly the whole time. This is now fixed centrally
(both surfaces resolve and emit `strokeDashoffset` the same way they already
do `strokeDash`), so a nonzero phase offset now marches consistently across
canvas, SVG export, and the GPU surface.

**How it renders.** The stroke-extrusion mesh (the same triangle strip that
already reproduces a uniform stroke's width and joins/caps) carries one more
per-vertex number: each vertex's cumulative distance along its own contour's
centerline, in world units, restarting at zero for every subpath — exactly
matching how a browser's `stroke-dasharray` restarts its pattern at each
subpath rather than continuing across them. The GPU's existing
stencil-then-cover stroke pipeline evaluates the dash entirely during the
STENCIL pass: a fragment whose accumulated arc position falls in a pattern
gap is discarded before it can contribute any stencil winding at all, so the
(unmodified) cover pass simply never paints there — a dash gap is a true
zero-coverage gap, not a painted-then-erased region. This is why dashing
needed no new render pass, no new pipeline, and composes for free with an
open clip scope (S7): a discarded stencil fragment inside a clip never
acquires winding, so the clip's own membership test is moot for it either
way.

**What is NOT yet supported.** A `round` or `square` dash cap (the rounded
or squared-off end each individual dash segment gets, distinct from the
stroke's own end caps) is out of scope — reproducing it would need
per-dash-segment geometry the fragment-time discard approach cannot
express, so a dash with either cap value keeps its whole artboard on SVG.
A pattern longer than 8 entries (after the odd-length-to-even doubling)
exceeds the fixed uniform-array capacity the fragment shader reads and is
likewise unsupported. Curved geometry is still excluded because the GPU stroke
mesh dashes by flattened chord length from the flattened ring's own start,
while SVG dashes native curves by true analytic arc length from the curve's
canonical start. These only agree when the rendered outline has no curvature.
Dashing an E0 width-profile stroke's tapered outline is out of scope for the
same reason it already is on every other renderer: the scene model contract
states that `strokeWidthProfile`, when present, makes the renderer ignore
`strokeDash`/`strokeDashoffset` entirely (a v1-wide limitation predating this
slice, not something S8 introduces). Dashing a multi-paint appearance-stack
stroke (rather than the legacy single `stroke`/`strokeWidth` pair) is likewise
out of scope, matching every other uniform-stroke capability check in this
predicate.

**Straight-segment kinds.** `path` is admitted when every contour is straight
because the SVG renderer's `<path>` branch honors authored cap/join values.
`line` is admitted because its native start point and the GPU open-contour start
point are the same endpoint. Sharp `polygon`/`star` geometry is admitted because
the live renderer emits one native `<polygon>` whose point order is the same
first-vertex order used by `filletPolygonShape(..., 0)` and `starVertices(...)`
for the GPU closed contour. Rounded polygon/star geometry is still excluded:
it bakes to a curved `<path>`, returning to the true-arc-length mismatch above.
A smoothed zero-radius rect is also excluded because it forces the live
renderer's baked-`<path>` branch rather than the native `<rect>` fast path; the
dash gate mirrors `rectNeedsBakedPath` so GPU/SVG cannot drift on that authoring
edge.

## How To Enable

Add `?gpuCanvas=1` to the editor URL, or set
`localStorage["vma:gpu-canvas"] = "1"` and reload. There is no settings UI
yet. The flag is read once per `CanvasShell` mount, so toggling it requires a
reload to take effect.

## Verification Tooling (S4)

Three dev-only affordances exist to make GPU/SVG parity and GPU performance
self-evident. All three require `?gpuCanvas=1` to already be set — none of
them do anything on their own.

- **Diff overlay (`?gpuDiff=1` or `localStorage["vma:gpu-canvas-diff"] = "1"`).**
  With this on, the SVG renderer stops suppressing content for GPU-active
  artboards (both renderers draw the same artboard), and the GPU `<canvas>`
  gets `mix-blend-mode: difference` against the SVG layer beneath it in the
  same stacking context. Identical pixels composite to black; any mismatch
  glows in the difference color. This is a developer parity tool, not a
  product feature: colors intentionally invert wherever the GPU draws
  (expected, not a bug) — only the residual glow (a mismatch between the two
  renderers) is meaningful. A faint shimmer at anti-aliased edges is normal
  (the two renderers anti-alias slightly differently); a solid glowing shape
  indicates a real parity bug. The artboard-scoped grid renders as normal
  (undiffed) lines above the difference-blended canvas in this mode, since
  the grid is editor chrome the GPU surface never draws and so was never
  part of the compared stack.
- **Stress-scene generator (`globalThis.__vmaGpuStress(count?)`, `DEV`
  builds only).** Run `__vmaGpuStress(400)` from the browser console to
  append one new artboard (placed to the right of existing pasteboard
  content) containing `count` (default 400) generated nodes — a mix of
  solid-fill rects/rounded-rects/ellipses/paths, linear/radial gradient
  fills, uniform strokes (varied caps/joins, some translucent), and at least
  15% E0 width-profile stroked open paths — all constructed to pass GPU
  capability by construction. It also appends three fixed-origin
  single-level clip-mask pairs (S7): a rect content node clipped by a
  partially-overlapping ellipse silhouette, a small group (a solid-fill
  child plus a stroke-only child) clipped by a rotated rect silhouette, and
  a gradient-filled rect content node clipped by a hexagon path silhouette
  — authored through the SAME "use as mask" command the product's own mask
  tooling uses, not a hand-rolled relation. The whole artboard is added as
  ONE undo entry through the ordinary scene command bus (Cmd+Z removes it
  entirely). Calling it again while a `gpu-stress-*` artboard already exists
  in the document is a no-op with a console warning — undo the existing one
  first.
- **Frame-cost HUD (`?gpuHud=1` or `localStorage["vma:gpu-canvas-hud"] = "1"`).**
  A small, plain, monospace, bottom-left overlay shows a rolling average
  (last 30 frames) plus the most recent frame's: compile time (scene
  sampling + display-list compile, in ms — drops to near-zero on a pure
  pan/zoom once S4's invalidation memo hits), draw time (GPU submit, in ms),
  and quad/fill/stroke draw counts. It only updates when a GPU frame actually
  renders — it never runs its own timer or animation loop.

## Post-S4 Review-Fix Pass

Three bugs found in review of S3/S4 were fixed with no new capability added:

- **Interleaved cross-node paint order.** Every artboard's GPU content now
  draws from ONE ordered list (`GpuArtboardContent.draws`, a fill/stroke
  discriminated union) instead of two separate fill/stroke arrays. The
  display-list compiler always emitted a single correctly-ordered list, but
  the frame assembler used to split it into `fills`/`strokes`, and the
  renderer drew "every artboard's fills, then every artboard's strokes" —
  which silently painted a later node's fill OVER an earlier node's stroke
  whenever the two overlapped on screen, inverting z-order. Same-node
  ordering (a node's own stroke over its own fill) was never affected; only
  DIFFERENT overlapping nodes were. Fixed by keeping one ordered list end to
  end, with the renderer switching pipeline per draw entry.
- **DPR-blind compile cache.** The single-entry compile cache added in S4 (to
  skip recompiling on a pure pan/zoom) was keyed on the zoom bucket alone,
  which does not change when only the display's device pixel ratio changes
  (e.g. dragging the browser window to a different-DPR monitor). A DPR-only
  change could silently keep serving geometry flattened at the OLD DPR's
  tolerance. Fixed by keying the cache (and the inner per-path flattening
  cache) on the computed tolerance value itself, which already folds in both
  the zoom bucket and the clamped DPR.
- **Empty-gradient capability gap.** A gradient fill with zero color stops
  now keeps its artboard on SVG (the same `"gradient_stops"` reason token
  used for too many stops), matching the fail-closed rule the capability
  predicate otherwise follows — previously this case was not explicitly
  checked.

## What Can The User Do Now?

Nothing new is user-reachable by default. With the flag on, a
`data-gpu-canvas` attribute on the mounted `<canvas>` (`"init"` / `"active"`
/ `"unavailable"` / `"lost"`) is available for manual verification. An
artboard with solid/gradient/image fills, untransformed mesh-gradient fills, placed image
nodes, solid/linear/radial/image-reference legacy uniform strokes, E0 width-profile strokes, a fill-only or
E0-outline-only leaf using `multiply`/`screen`/`darken`/`lighten`/`exclusion`,
and/or a content node clipped or hard-alpha-masked by a single sibling silhouette, a supported
straight dashed stroke, and static solid/linear/radial/image/untransformed-mesh-fill text using normal/`multiply`/
`screen`/`exclusion` blend, optionally with a single solid/linear/radial text stroke
(no renderable effects or frame/scoped Looks/soft-translucent-expanded-inverted-or-multi-or-chained masks/curved-or-rounded
dash/animated text/non-admitted text stroke/tiled-or-transformed image text fill/transformed mesh text fill, no
tiled image fills or singular image paint transforms, no transformed mesh fills, no mesh stroke paints, no tiled/singular-transform/degenerate image stroke paints, no other
blend mode or blend-mode-on-a-container/mixed-paint/uniform-stroke) now
visually renders from the GPU surface instead of SVG, with no visible
difference in the normal case beyond a brief first-load gap for a
newly-added image/mesh/text bitmap (see "Async Texture/Raster Loading (S5)"
and "Static Text Raster (S9.0/S9.1/S9.2/S9.3/S9.4/S9.5/S29)"); a
developer console (`import.meta.env.DEV` builds) logs which artboards are
GPU-active and, for the rest, WHY they are not (a stable, dev-only reason
token per failing capability, e.g. `"text"`, `"filter_or_look"`,
`"stroke_dash"`, `"stroke_paint"`, `"gradient_stops"`, `"gradient_feature"`,
`"mesh_feature"`,
`"combined_paint_opacity"`, `"image_asset"`, `"image_feature"`,
`"blend_mode"`, `"blend_mode_feature"`, `"mask"`).

## Why It Matters

S2 was the first point where the GPU engine took over drawing real scene
content instead of just a background rectangle — the strangler pattern's
"heart" for this migration, proving the capability-gated, per-artboard
fallback model end to end: capability evaluation, display-list compilation
off the sampled (motion-aware) document, CPU-side curve flattening, and a
stencil-then-cover GPU fill pipeline, all while the SVG renderer keeps
painting everything the GPU path does not yet support. This slice (S3)
widens that capability list to gradients and strokes — two of the most
ubiquitous appearance features in real documents — via a new
stencil-then-cover GPU stroke pipeline (vertex-shader extrusion for exact
`non-scaling-stroke` parity) and per-fragment gradient projection through a
precomputed inverse world transform. This slice (S4) adds no new rendering
capability; instead it makes the migration's payoff and correctness
self-evident: the diff overlay proves GPU/SVG parity visually rather than by
inspection, the stress-scene generator gives every future slice a
reproducible large-document benchmark, and the invalidation memo (plus the
frame HUD that proves it) removes the redundant re-compile work a camera-only
pan/zoom used to trigger — a document edit still recompiles (correctly), but
moving the camera no longer does. This slice (S5) widens the capability list
to cover real-world raster content — image fills, placed image nodes, and
gradient meshes, then S9.x covers the plain static text case, via a new
asynchronous GPU texture cache (a SEPARATE textured cover-pass pipeline, never
forcing the solid/gradient pipeline to bind a dummy texture) that shares its
mesh-rasterization cache with the SVG renderer so the two agree pixel-for-
pixel. This slice (S6) widens the capability list again with a
fixed-function blend-mode subset (`multiply`/`screen`/`darken`/`lighten`) —
each mode costs one additional `GPURenderPipeline` variant per cover pass
(color-component blend state only, no shader change) rather than any new
draw machinery, since blending is pipeline state the renderer already
selects per draw. This slice (S7) admits the first mask subset —
single-level hard clip-path masks, one of the most common uses of masking
in real documents (clipping a group of shapes to a simple silhouette) —
by partitioning the existing 8-bit stencil buffer between "ordinary winding"
and "inside the open clip scope" rather than adding a second render pass or
attachment, so a clip mask costs three extra pipeline variants and zero
extra per-frame machinery for documents that use no masks at all. S30 reuses
that exact stencil path for hard alpha-mask relations whose SVG output is still
a binary white silhouette. S8 then
admits the exact screen-space dashed-stroke subset, S9.x admits ordinary
static solid/linear/radial/image/untransformed-mesh-fill text (including `multiply`/`screen`/`exclusion`) by rasterizing the node
through Canvas2D and feeding the bitmap through the existing image texture path, and S29 adds the same
bitmap path for single solid/linear/radial text strokes. S24 lets the same
solid/gradient cover shader paint uniform linear/radial-gradient strokes after the stroke stencil
mesh has written coverage, and S25 lets image-reference uniform strokes use the same textured cover
pipeline as image fills after the stroke stencil mesh has written coverage. Mesh stroke paints still
stay on SVG because they need the mesh-raster bridge to produce a stroke paint payload. S13 removes a
false fallback for node effects/recipes that the shared SVG filter path proves
are identity (for example zero-radius blurs, zero-opacity shadows, or neutral
node recipes), and S14 does the same for explicit frame/scene Look graphs or
legacy visual recipes with no live frame-film pass. S15 does not add new admitted content; it splits
the WebGPU direct path into prepared draws and ordered render-pass replay so a later offscreen
composition pass can sample a source texture for real WGSL Look/effect rendering without duplicating
clip/stencil behavior. S16 adds that source texture and a final swapchain composite pass; S17
uses it for the first visible WGSL frame Look subset, legacy chromatic aberration, and S18 adds
legacy frame film grain via the same grain texture that the SVG frame filter uses. S20 lets frame
effect-layer-stack authoring state ride that same GPU path only through the synchronized legacy
`visualRecipe` projection that CanvasShell currently renders. S26 lets the explicit serial
grain-only LookGraph authoring path use the same WGSL grain pass, and S28 keeps converted
legacy-style serial graphs on that path when their Glow/Grade nodes are disabled or neutral. S27 relaxes artboard overlap only
when the frame-film artboard has no later-painted overlapping artboard above it; earlier/lower
overlaps are isolated by the artboard's opaque GPU background. The admitted subset is still scoped to
non-overhanging artboards with no influence mask. Later slices (tracked in
`docs/gpu-canvas-convergence-e1-plan.md`) add soft/translucent/expanded/inverted alpha masks,
multi-application and chained masks, richer dash, non-admitted text strokes,
tiled/transformed image text paint, animated text or a true glyph atlas, the other 11 blend modes, and more
so still more documents qualify over time.

## What Should A Reviewer Verify?

- `bun run check` passes (static gate).
- `bun run build && bun run check:bundle` passes, and the WebGPU RHI code
  (`src/shared/gpu/`) lands in its own dynamically-imported chunk, never the
  app's entry chunk.
- With the flag OFF (default), the editor is byte-identical to before this
  change — no new DOM, no new network/console activity, no behavior change.
- With `?gpuCanvas=1&gpuDiff=1`: a GPU-active artboard reads near-black, with
  only faint anti-aliasing shimmer at edges — a solid glowing shape is a real
  parity bug. With `?gpuCanvas=1&gpuHud=1`: the HUD's compile-time reading
  drops to near-zero on a pure pan/zoom (the S4 memo hit) while draw time
  stays roughly constant; both readings jump back up on any document edit or
  playback tick (a genuine recompile, as expected). `__vmaGpuStress(400)`
  appends one artboard as a single undo entry, its E0 profile-stroke nodes
  visibly vary in width, its image-fill/placed-image/mesh-paint fixture nodes
  render correctly (allow one frame of pop-in on first load, then foreground
  the tab and re-check — a hidden tab suspends the redraw rAF), its five
  fixed-origin blend-mode fixture pairs (multiply/screen/darken/lighten/exclusion, each
  an opaque "top" shape overlapping an opaque "base" shape by half) show the
  expected blended color in the overlap region and match between GPU-on and
  GPU-off (`?gpuDiff=1` reads near-black over them too), its three
  fixed-origin clip-mask fixture pairs (rect/ellipse, group/rotated-rect,
  gradient/hexagon-path) each show ONLY the overlap region between content
  and silhouette (the rest of the content is invisible, matching SVG
  `clip-path` and matching GPU-off `?gpuDiff=1` near-black), and the
  artboard is GPU-active (capability reasons `[]`).
- With `Show grid` (Mod+') enabled: flag OFF renders the grid identically to
  before this fix on every artboard; flag ON keeps the grid visible over a
  GPU-active artboard's opaque content (it no longer vanishes) while a
  non-GPU-active artboard's grid is unaffected; turning grid visibility off
  hides it everywhere, GPU or not.
- With the flag ON: an artboard with solid/gradient fills and solid,
  linear/radial-gradient, or image-reference legacy uniform strokes or E0 width-profile strokes
  (including the admitted straight dashed subset, but no renderable
  effects/Looks/unsupported masks/unsupported dashes/unsupported image strokes/mesh strokes)
  renders visually identically to flag-off, but its content comes from the
  GPU surface (SVG content is suppressed for that artboard, the dev console
  lists it as GPU-active) — including a screen-constant stroke width at any
  zoom level and gray-fringe-free gradients through transparent stops. A
  fill-only or E0-outline-only leaf using `multiply`/`screen`/`darken`/
  `lighten`/`exclusion` (darken/lighten only on an opaque solid paint, and only when its
  committed bounds sit inside its own artboard) also renders from the GPU
  surface, visually matching the SVG `mix-blend-mode` result. Static
  solid/linear/radial/image/untransformed-mesh-fill text with no active text animator
  and `normal`/`multiply`/`screen`/`exclusion` blend, optionally with a single solid/linear/radial text stroke,
  also renders from the GPU surface as a cached text bitmap. An artboard
  with a mesh-paint stroke, tiled/singular-transform/degenerate image stroke, non-admitted text stroke, tiled/transformed image text fill, transformed mesh text fill, animated
  text, text `darken`/`lighten`, a renderable effect/Look, a scoped Look target,
  an unsupported explicit frame Look graph or stack-only frame effect-layer output, an unsupported
  mask, one of the other 11 blend modes, one of the five supported blend
  modes on a container, on a leaf mixing fill+stroke, or on a leaf whose
  committed bounds overhang its own artboard, or a leaf whose combined
  fill+stroke composite can go sub-unity opacity stays on SVG (dev console
  lists the failing reason(s), `"blend_mode_feature"` for the
  overhang case). To manually exercise the overhang gate: drag one of the
  stress-scene generator's five blend-mode fixture nodes (or any node with
  one of the five blend modes set) so it extends past its artboard's edge
  and commit the drag — the artboard should drop to SVG-only (dev console
  reason `"blend_mode_feature"`), and moving it back fully inside the
  artboard restores GPU rendering. Dragging a node in a GPU-active artboard
  tracks the pointer live; playing the timeline animates it.
- With the flag ON: a content node with exactly one hard clip-path or hard
  alpha-mask relation (via "use as mask" on a top-level sibling shape, no
  feather/opacity/expand/invert settings) renders its hard silhouette on the GPU
  surface, visually matching the SVG result exactly, including when the
  masked content is a group with mixed fill/stroke children or the mask
  source has a rotation/scale of its own. An artboard with a soft/translucent/
  expanded/inverted alpha mask, a content node with more than one mask application, a chained mask,
  or a mask source consumed by even one relation outside that admitted
  subset stays on SVG (dev console reason `"mask"`). To manually exercise
  the admission boundary: apply a second mask relation, or a feather/
  opacity/expand/invert setting, to one of the stress-scene generator's
  clip-mask fixture content nodes and commit — the artboard should drop to
  SVG-only (dev console reason `"mask"`), and removing the extra relation/
  setting restores GPU rendering.
- With the flag ON in a browser without WebGPU: the canvas either does not
  mount or reports `data-gpu-canvas="unavailable"`, and the SVG-only editor
  is otherwise unaffected.

## What Is Still Limited?

- Only solid/gradient/image/untransformed-mesh-fill rect/ellipse/path/placed-image shapes,
  including non-singular image paint transforms,
  plus legacy uniform strokes (optionally dashed, butt cap only, at most 8
  pattern entries after normalization, and either a native-`<rect>` fast path
  with zero corner rounding/smoothing, `line`, an all-straight `path`, or sharp
  `polygon`/`star` geometry, in any orientation/transform) and E0 width-profile strokes, plus a fill-only or
  E0-outline-only leaf's `multiply`/`screen`/`darken`/`lighten`/`exclusion` blend mode
  (when its committed world paint bounds sit inside its own artboard rect),
  plus a content node clipped or hard-alpha-masked by a single sibling silhouette, plus static
  solid/linear/radial/image/untransformed-mesh-fill text with no active text animator
  and `normal`/`multiply`/`screen`/`exclusion` blend, optionally with a single solid/linear/radial text stroke, plus nodes whose authored effects/recipes are identity in the shared
  SVG filter builder, explicit frame Looks/recipes with no visible graph or
  frame-film pass, and explicit serial frame-film-only LookGraphs, render on the GPU surface. A
  dash pattern with a `round`/`square` cap, more than 8 entries, curved
  geometry, a rounded/smoothed rect, rounded dashed `polygon`/`star` geometry, a line
  with visible fill, a dashed E0 width-profile stroke (out of scope for every renderer,
  not GPU-specific — see "Dashed Strokes (S8)"), a mesh-paint stroke,
  a tiled/singular-transform/degenerate image stroke, non-admitted text stroke, tiled/transformed image text fill, transformed mesh text fill, animated text, text `darken`/`lighten`, a
  renderable effect/Look, a scoped Look target, an unsupported explicit frame Look graph or
  stack-only frame effect-layer output,
  a soft/translucent/expanded/inverted alpha mask, a content node with more than one mask
  application, a chained mask, any of the other 11 blend modes, one of the
  five supported blend modes on a container/carrier, on a leaf mixing
  fill+stroke or on a uniform stroke, or on a leaf whose committed bounds
  overhang its own artboard, a tiled image fill, a singular image paint
  transform, an image text/background transform,
  or a leaf whose combined fill+stroke composite
  can go sub-unity opacity on ANY node in an
  artboard keeps that WHOLE artboard on SVG for this slice — there is no
  partial per-node GPU/SVG split within one artboard.
- A single-level hard mask (S7/S30) only represents the HARD silhouette: any
  feather (soft edge), opacity (partial coverage), expand/choke, or invert
  setting on the mask relation forces that whole artboard to SVG instead —
  these are genuinely different render semantics (a coverage/alpha mask
  with a filter chain, not a plain silhouette test) that this slice does not
  attempt. Nested/chained masks (a mask source that is itself masked, or
  content that is itself used as a mask elsewhere) and multi-application
  masks (more than one mask relation on the same content node) are likewise
  unsupported — the minimal representable tier this slice builds on
  (`entities/scene/model/mask-render.ts::resolveSceneMaskPlan`) already
  rejects those cases for every renderer, not just the GPU surface.
- The blend-mode artboard-overhang bounds check (see "Fixed-Function Blend
  Modes (S6)") is evaluated on the COMMITTED transform only, matching every
  other capability check's contract (D1's "no-flap" rule): a node whose
  transform is ANIMATED (keyframe or motion-grammar) to overhang its
  artboard only TRANSIENTLY mid-playback, while its committed (rest) pose
  sits fully inside the artboard, is not re-checked per frame — such a node
  stays admitted, and the overhang moment itself is not specially detected
  or fallen back from. This mirrors how every other capability check in
  this predicate already treats "committed" as the evaluation point, not
  "every sampled frame."
- An image-reference fill now matches SVG image-fit semantics for `"fill"`,
  `"fit"`, and `"crop"`: stretch, centered letterbox, or centered cover/crop.
  A placed image node still stretches to its placement rect, and source-crop
  metadata now remaps the sampled source image sub-rect on the GPU surface too.
- A brand-new image/mesh paint's very first GPU frame can render with that
  ONE draw missing for exactly one frame while its texture uploads
  asynchronously in the background — see "Async Texture/Raster Loading (S5)".
  This never blocks the rest of the artboard and self-heals on the next
  frame, but it is a genuine (if brief) visual difference from the SVG
  renderer, which has no equivalent async gap for a data-URL image.
- Artboard content does not clip to the artboard's own rect on either
  renderer (this matches existing SVG behavior — content may bleed past the
  artboard bounds today), so the GPU surface does not yet apply a scissor
  rect either.
- A committed edit that adds or removes an unsupported feature can visibly
  "pop" an artboard between GPU and SVG rendering; this is accepted and
  intentional (D1's no-flap rule only guarantees the render path is stable
  DURING a drag/scrub, not across a committed edit).
- The GPU backing store is capped at 2x device pixel ratio regardless of the
  display's actual DPR, an accepted tradeoff revisited when this work targets
  higher-DPR devices directly.
- No settings UI exists for the flag; it is a URL query parameter or a raw
  `localStorage` key intended for internal/developer verification only.
