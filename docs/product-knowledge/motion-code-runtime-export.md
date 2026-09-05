# Motion Code Runtime Export

Date: 2026-06-23.
Updated: 2026-07-13.
Status: shipped and verified; renderer-neutral camera/runtime integration,
generated declarations, and manifest discovery are complete.

## Summary

The **motion/code** export produces a runtime module plus an HTML page, so a
developer can drop a Vecmo motion into their own site. It now exposes three
output profiles from the Top Bar export menu:

- **Web Embed**: compact runtime output for normal web use.
- **Production**: smallest runtime bundle, excluding hidden content, editor-only
  metadata, production-only authoring names, side-car handoff files, and the
  React wrapper. It emits a shared `vector-motion-runtime.js` plus scene-specific
  data.
- **Editable**: full handoff bundle, preserving the scene/motion sidecars and
  React wrapper for developer transfer and debugging.

Previously that runtime hard-coded a **time-delay-only**
reimplementation of motion-grammar sampling: exported playback silently dropped
every other technique (Cycle, Ring Wave, Afterimage, and the rest) and drifted
from the live editor preview.

The runtime now embeds the **same pure sampler the editor uses**. At export time
the build bundles the motion-grammar evaluator and the shared presentation
compose (`buildExportRenderPresentation` → `sampleMotionPresentationScene`) into
one self-contained module and inlines it into the payload. The runtime composes a
fully-sampled scene per frame through that shared code and serializes it to SVG.
There is no per-technique logic in the runtime anymore, so exported playback
reproduces every motion-grammar technique without drift — the same code path that
draws the editor canvas draws the exported frame.

## What Users Can Do Now

- Export a scene as motion/code and get a runtime whose playback matches the
  editor for **all** motion-grammar techniques, not just Time Delay.
- Choose whether the generated code is a compact web payload, a production-sized
  runtime bundle, or a full editable handoff bundle.
- Use split-data output for Web Embed and shared-runtime output for Production,
  so the browser no longer has to parse scene/motion JSON embedded inside the
  player source.
- Download Motion / Code outputs as one ZIP archive when the selected profile
  emits multiple files. The archive preserves the separate runtime/data/html
  files needed for hosting, but the browser performs one user-visible download
  instead of one prompt per asset.
- Use the generated `*.runtime-manifest.json` (or
  `*.webgl-player.runtime-manifest.json`) as the machine-readable file map for
  Web Embed and Production split/shared packaging. It records the profile,
  renderer, runtime/data files, HTML entrypoint, React wrapper when present, and
  whether HTTP serving is required.
- Keep Production payloads focused on playback: hidden content, locked/editor
  state, component bindings, saved grammar authoring state, and the static
  bindable-property registry are projected out of the downloaded data.
  Runtime-unused vec-core recipe sidecar JSON stays out of Web Embed and
  Production data payloads; duplicate top-level effect-capability data is also
  avoided because the compact manifest already carries it. Empty grammar,
  recipe, sequence, and data-local file-list fields are omitted from compact
  payloads; the runtime manifest owns the file map. Editable keeps the full
  handoff shape. Production also removes runtime-unused scene/node/layer/artboard
  display names from the compact payload and manifest.
- Embed the runtime (`mountVectorMotion` / the React `VectorMotion` component) and
  see Cycle orbits, Ring Wave scale/opacity fields, Afterimage echo trails, and
  every other technique animate exactly as authored.
- Drive either renderer through the same `mountVectorMotion()` player contract.
  `seekFrame()` and `seekProgress()` return a per-request committed,
  superseded, rejected, or disposed result; `progress` remains a writable
  GSAP-style seam.
- Keep that contract when the payload contains a scene sequence. Player
  `frame`/`progress` remain global, while every committed snapshot and sampled
  event exposes a discriminated `scope` with the active item, artboard, and
  local motion frame. Sequence cuts change artboards without changing player
  identity or host hook semantics.
- Read the exact render-effective camera with `getCameraState()` and
  `getCameraCatalog()`, subscribe to stable committed snapshots, or use
  `onFrameSampled()` before DOM/GPU commit and `onFrameRendered()` after the
  runtime accepts the frame.
- Apply ephemeral replace-only camera channel overrides with
  `setCameraOverride()` / `setActiveCameraOverride()` without mutating the
  exported scene or motion payload. Crossfades report both resolved views.
- Consume the declaration file paired with every runtime JS module. Every
  profile now includes a runtime manifest whose `playerApi.contractVersion` is
  `2` and identifies the declaration, hooks, global/local frame scope,
  scene-sequence support, timing modes, and camera support.
- Use the same generated React lifecycle for SVG and WebGL output. Callback
  identity changes relay through latest-value refs instead of remounting the
  player; frame, component props, autoplay, loop, and playback rate update
  through the mounted player API.
- Keep reading the embedded scene/motion JSON as the source of truth; export
  profiles project that payload without changing the saved editor document.
- Export a scene whose fill or stroke is a gradient-mesh paint and see the SAME
  rasterized bitmap the live canvas and in-app SVG export already show, instead
  of a blank shape. The runtime rasterizes each distinct mesh once (a content-
  keyed cache, same pattern as the live canvas bridge) and reuses that bitmap
  every animation frame, so this stays cheap even during playback.
- Export a scene whose fill or stroke is a **linear gradient, radial gradient,
  or image-reference paint** — including a fill/stroke stack with more than one
  paint layer — and see it render in exported playback instead of silently
  dropping to `fill="none"`/`stroke="none"`. The runtime resolves each paint
  layer with the same per-kind logic (and the same deterministic `paint-<node>-
  <role>-<index>` def ids) as the in-app SVG export, so a multi-layer stack
  renders as the same stacked geometry elements in the same bottom-to-top order.
- Export a scene with **node effects** (layer-blur, drop shadow, inner shadow)
  or an attached **vec-core visual recipe** ("look", e.g. grain, color grade)
  and see the same `<filter>` primitives the in-app SVG export already renders,
  instead of the effect vanishing from playback. The runtime builds the filter
  from the exact same `buildEffectFilter` chain used by the editor canvas and
  the in-app SVG export, so a layer-blur radius or grain strength authored in
  the Inspector produces the same `feGaussianBlur`/`feTurbulence`/etc. defs in
  exported playback. Background-blur remains deferred (see below); blend modes
  remain unsupported in the runtime.
- Mesh bitmaps are emitted as **compressed PNGs**: the shared deterministic
  encoder (`src/shared/mesh-raster/png.ts`) now does adaptive row filtering plus
  real DEFLATE (stored/fixed/dynamic Huffman, whichever is smallest) instead of
  uncompressed stored blocks. Decoded pixels are byte-identical, and the same
  encoder serves the live canvas, in-app SVG export, and this runtime, so all
  surfaces stay pixel-locked. Measured on the grainy-gradient-orb export demo in
  Chromium: the pattern data URL shrank from ~11.1M to ~2.0M chars, first-mount
  main-thread blocking dropped from ~1.3s to ~1.0s, and playback-time
  render+parse per frame dropped from ~200ms (~5 fps, visibly frozen) to ~21ms
  (inside the 30 fps frame budget).
- Export a compound path with disjoint contours or holes and keep every
  serialized subpath in Motion / Code playback. The embedded SVG serializer now
  concatenates the primary shape and all renderable subpaths into one `d` value
  and preserves `fill-rule="evenodd"` when authored, matching the editor and
  in-app SVG exporter instead of drawing only the first contour.
- Export a scene with a **non-default stroke cap, join, dash pattern, dash
  offset, or miter-limit** and see it render in exported playback instead of
  silently falling back to SVG defaults (butt cap, miter join, no dash, zero
  offset). The runtime's serializer now emits `stroke-linecap`/`stroke-linejoin`/
  `stroke-dasharray`/`stroke-dashoffset`/`stroke-miterlimit` at every element that
  paints a stroke — the base single-paint shape, each stroke layer of a
  multi-paint stack, and the stroke-only-blur shape — reading the same optional
  `NodeStyle` fields and applying the same non-default gating as
  `strokePresentation` (`entities/scene/model/style-presentation.ts`), the shared
  helper the live canvas and in-app SVG export already use. A multi-layer stroke
  stack derives one dash/dashoffset/cap/join/miter set from the node's style and
  applies it identically to every layer, matching the in-app SVG export's
  `renderStackedShape` (the schema has no per-layer stroke geometry). The bundled
  sampler already composes `NodeStyle.strokeDashoffset` per frame, so a
  **grammar-driven travelling-stroke animation now animates in exported
  playback** — matching the editor canvas and the in-app SVG/PDF exports — with
  the offset emitted only alongside a surviving dash and only when nonzero,
  exactly as `strokePresentation` nests it.
- Playback no longer re-parses the mesh pattern's data URL every frame. The
  player still rebuilds the full SVG markup string each frame and diffs it
  against the live DOM via `DOMParser`, but a mesh pattern's rasterized bitmap
  is frame-invariant (the same content-keyed raster cache above), so the
  steady-state per-frame markup now carries a short deterministic token in
  place of the real `data:image/png;base64,...` URL; only the rare fallback
  path that actually replaces DOM (initial mount or a structural change) ever
  substitutes the token back to the real URL. This is a player-internal
  optimization — every exported markup-producing API (`renderFrame`,
  `player.on`/`.setProps` payloads a host reads back, the in-app SVG export,
  poster frames) still returns the real data URL inline, unchanged. Measured on
  the grainy-gradient-orb export demo: per-frame `player.renderFrame` cost fell
  from ~19.9ms (dominated by re-parsing the ~2.0M-char pattern data URL) to
  near the ~1.2ms baseline of a mesh-free scene of comparable complexity.

## How To Use

1. Author a scene and apply one or more motion techniques (e.g. Cycle or Ring
   Wave) from the Inspector Motion section.
2. Export with the Web Embed, Production, or Editable motion/code profile from
   the Top Bar export menu.
3. Unzip the archive when the export contains multiple files.
4. Open the generated `*.html` from an HTTP-served directory for Web Embed or
   Production, or open the Editable HTML directly when a self-contained handoff
   is needed.
5. Keep the
   `*.runtime-manifest.json` beside the downloaded files when handing the output
   to another build system; every profile now identifies its runtime, paired
   declaration, data when split, HTML, and optional React/support files.
6. Confirm the embedded motion looks like the editor preview for every technique,
   including non-`time-delay` ones.
7. For a scene-sequence export, inspect `player.getSnapshot().scope` on both
   sides of a cut and confirm that global frame stays continuous while
   `artboardId` and `localFrame` switch to the active item.

## Manual Verification

1. Build a scene with a non-`time-delay` technique (Cycle is a good default).
2. Export motion/code and open the generated runtime.
3. Confirm the objects animate (orbit / pulse / echo) rather than sitting static.
4. Open the generated runtime file (`*.runtime.js` for Web Embed / Editable,
   `vector-motion-runtime.js` for Production) and confirm it contains the bundled
   sampler (`__vectorMotionRuntimeSampler`) and no hand-written per-technique
   `if (binding.techniqueId !== "time-delay")` branch.
5. Unit coverage lives in `src/features/export/model/code.runtime-sampler.test.ts`:
   it writes the emitted payload, imports it, and asserts the exported sampler
   matches the in-editor evaluator for Cycle, Ring Wave, and Afterimage.

## What Is Still Intentionally Limited

- The runtime's **SVG serializer** stays intentionally simple compared to the
  in-app SVG export, but shares the same appearance-artifact builders for the
  parts that matter for visual fidelity. A **mesh-gradient** fill/stroke is
  CPU-rasterized to a PNG and emitted as a `<pattern><image>` def
  (`buildSceneMeshPaintSvgArtifacts`, bundled alongside the sampler), matching
  the live canvas and the in-app SVG export pixel-for-pixel. **Linear/radial
  gradient and image-reference paints**, including multi-paint fill/stroke
  stacks, are resolved by `buildScenePaintSvgArtifacts` using the same per-paint
  fallback rules as the in-app SVG export's `resolveSvgPaintLayer`. **Node
  effects** (layer-blur, drop/inner shadow) and attached vec-core recipes are
  resolved by `buildSceneEffectFilterArtifacts`, which calls the exact same
  `buildEffectFilter` chain (`entities/scene/model/effect-filter.ts`) the in-app
  SVG export calls from `renderNode`. All three builders are bundled into BOTH
  the full and core runtime-sampler bundles (`runtime-sampler-entry.ts` /
  `runtime-sampler-core-entry.ts`), so a grammar-free scene that selects the
  core bundle still gets identical appearance fidelity.
  **Background-blur** stays deferred — it has no representable SVG filter
  primitive in `buildEffectFilter` for either export path, so it is dropped the
  same way in the runtime as in the in-app SVG export. **Blend modes** and
  **scoped look-graph overlays** remain entirely unsupported in the runtime
  player by design — it has no blend/compositing pipeline. Rich appearance
  beyond the above is approximated or omitted in the runtime; those are a
  renderer-adapter concern, not a sampler one. The embedded JSON and the
  effect-capability manifest still describe them for consumers that want higher
  fidelity.
- "Identical" here means **identical sampled values** (composed transforms,
  opacity, grammar sample maps, afterimage duplicates), proven by tests. The raw
  SVG bytes differ from the editor's React-rendered DOM; that is an allowed
  renderer difference, not motion drift.
- The runtime samples the full presentation per frame at playback time, then
  patches the mounted SVG DOM when frame structure stays stable. For very large
  or structurally changing scenes a developer may still prefer to pre-bake
  frames; that is a future option, not a current export mode.
- Web Embed and Production load `*.data.json` through `fetch`, so they are meant
  for a local/server HTTP context. Use Editable when a self-contained file-open
  handoff is required.
- The runtime manifest is a packaging map, not another scene payload. It should
  stay small and should not duplicate `scene`, `motion`, or sampled frame data.
- `onFrameRendered` means the runtime completed its DOM/canvas backing-state
  commit. It does not promise browser-compositor presentation or atomic same-vsync
  composition with an external canvas.
- Authored interactions remain disabled for scene-sequence playback because
  interaction clip windows are artboard-local. This does not remove the base
  player, camera, snapshot, or frame-hook contract from sequence output.

## Related Docs

- [Cycle motion system](./cycle-motion-system.md)
- [Time Delay motion system](./time-delay-motion-system.md)
- [Afterimage motion system](./afterimage-motion-system.md)
- [Effect capability contract](./effect-capability-contract.md)
