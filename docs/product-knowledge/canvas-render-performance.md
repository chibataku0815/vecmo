# Canvas Render Performance

Date: 2026-07-13.
Status: internal.

## Summary

Vecmo's canvas render path (`CanvasShell` and its viewport-culling and
motion-sampling seams) received a performance pass that removes several
per-pointermove and per-frame costs from panning, zooming, dragging, and
scrubbing large documents. This is an internal rendering optimization: it
changes nothing about what a user can author, only how much work the canvas
does to draw it. The only user-facing control added here is a safe iPad Quick
Menu action to clear regenerable derived cache artifacts; there is no change to
the scene model or export output.

The 2026-07-07 continuation adds a browser-local derived-cache substrate for
iPad-class authoring: capability probing, versioned cache keys, IndexedDB
metadata, OPFS binary payloads with IndexedDB/memory fallback, a cache Worker
queue, non-blocking layout/Blend projection warming, persistent text/mesh/
frame-grain raster artifacts, persistent committed-scene GPU draw-list source
artifacts, stale-safe data-image upload-source artifacts, GPU/text/image cache
telemetry, and a dev-only derived-cache clear/snapshot diagnostic. The scene
model remains the source of truth; cached artifacts are regenerable projections.

The 2026-07-09 runtime loop adds delivery and JavaScript-loading optimizations
around the editor instead of changing the canvas renderer: fingerprinted public
assets served through the Worker receive immutable cache headers, non-editor
routes and large editor panels are lazy-loaded into separate chunks, Vite warms
the editor's first-route transform path during dev, Vitest has opt-in focused
tag/optimizer entry points, and the React Compiler pilot is restricted to
annotated tool-rail chrome. Canvas, GPU submission, scene stores, command
history, and export output remain owned by the existing TypeScript paths.

The 2026-07-13 timeline-playback loop removes the known native-4K preview
ceiling for GPU raster Looks. Playback uses an upward-quantized
display-device-pixel backing size and restores native resolution when paused.
Transform-only scenes that prove a narrow static-appearance contract can decode
cropped material sources once and update GPU transform matrices thereafter;
every unsupported case stays on the established full-frame SVG raster fallback.
Authored/export resolution, FPS, keyframes, and Deep Glow parameters do not
change.

The Gravity Field baseline was then captured in headed Chromium at 35% zoom and
DPR 1. Its admitted 10-second warm run presented all 503 requested frames at the
browser's measured 50Hz rAF ceiling, with frame age 0, no superseded frames, and
no steady-state SVG decode or texture upload. A globally registered Path Blur
overlay was also corrected so artboards with no eligible Path Blur target do not
invoke the expensive sampled-SVG bridge on every playback tick.

## What Changed?

- **Viewport-culling rect quantization now snaps outward.** The large-document
  (`CULL_NODE_THRESHOLD` = 800 renderable nodes) culling path quantizes the
  pasteboard-space visible rect to a stable grid so ordinary pans/zooms don't
  invalidate the memoized cull set on every tick. The snap direction was
  corrected to always round `minX`/`minY` down and `maxX`/`maxY` up
  (`quantizeCullingRect` in `src/widgets/canvas-shell/model/culling.ts`), so
  the quantized rect is guaranteed to be a superset of the true visible rect.
  The prior design quantized screen-space pan/scale before the pasteboard
  conversion, which could let quantization error compound with pan magnitude
  at large pan distances and silently cull nodes that were actually on
  screen.
- **Pan/zoom re-renders are decoupled from per-artboard render work.**
  `CanvasShell`'s per-artboard render tree (frame-look intents, matte maps,
  filter/mask plans, per-node painting — `artboardContentNodes`) is hoisted
  into a single `useMemo` keyed on document/selection state rather than raw
  pan/zoom, because pan is already absorbed by the outer world `<g
  transform>`. A pan tick now leaves that memo referentially stable instead
  of re-running the render-tree construction on every pointermove. The one
  genuine viewport read inside that block (`scale`, used for screen-space
  selection-chrome sizing) is threaded through explicitly as a memo
  dependency rather than defeating the memo.
- **Motion samplers are reused across geometry-only scene edits.** The
  motion-grammar evaluator memoizes `createMotionGrammarSamplingIndex` by
  `(bindings, motion)` object identity (a `WeakMap`), so a geometry-only
  scene edit — which replaces the scene document reference but leaves the
  motion and motion-grammar store documents untouched — skips recompiling
  the binding-to-clip activation index. The returned frame-sampler closure
  is still built fresh per call, since several grammar techniques read node
  positions directly from the scene passed to that call; only the index
  compilation is cached, not the sampling output.
- **Dense motion tracks compile into a derived sampling plan.**
  `entities/motion/model/sampling-plan.ts` indexes first tracks by node/property,
  sanitizes numeric keys once, caches animated-node membership, and directly
  addresses consecutive sampler-equivalent linear keys. The `WeakMap` key is the
  immutable `MotionDocument` identity, so an authoring edit invalidates the plan
  without adding durable state or changing serialization.
- **GPU playback preview follows displayed pixels.** During Play, the WebGL
  raster overlay sizes its backing store from editor zoom × DPR, quantized upward
  into stable buckets and capped at the authored artboard size. Pause/scrub
  returns to the native artboard backing. Export resolution is independent.
- **Static transform-only Deep Glow sources can stay resident.** A strict
  capability plan accepts at most 128 flat, static-pixel, transform-only nodes
  when one scoped Deep Glow targets every visible node. Cropped post-material SVG sources
  decode/upload once, then cached textures are matrix-composited into base and
  emission framebuffers before the existing Deep Glow kernel. Unsupported inputs
  fall back to the prior full-frame base/emission serialization path.
- **Static Source Optics can preserve separate base and emission semantics.**
  When the source node and rig parameters are not animated, its cached base keeps
  source-owned Bloom/Atmosphere while a separate emission texture omits them, so
  target Deep Glow does not re-consume the source-owned optics. Animated Source
  Optics remains outside the admission envelope and uses the fidelity-first
  fallback.
- **Inactive Path Blur no longer taxes every playback frame.** The object Path
  Blur overlay is globally registered, but it now subscribes to sampled playback
  frames only when the current artboard actually has an eligible Path Blur
  replacement to composite.
- **Playback diagnostics are bounded and dev-only.** In development,
  `globalThis.__vmaPlaybackPerf.snapshot()` reports rolling phase timings plus
  transport, cache, backing-size, frame-age, coalescing, React-commit, DOM-write,
  texture, and glow-resource counters. `reset()` clears only diagnostic memory.
- **Large authoring surfaces no longer follow every Play tick.** Action dispatch
  reads the exact live transport frame at execution, while its large registry
  surface freezes the projected frame during Play. Timeline rows and clip state
  use the same paused/scrub projection; compact ruler, playhead, and transport
  components remain live subscribers.
- **SVG playback reuses connected DOM handles.** The imperative playback overlay
  caches group, opacity, path, pattern, and image targets per canvas root/node
  identity and skips identical attribute writes. Replacement or disconnection
  invalidates the cache entry.
- **Layout presentation materialization is shared by document identity.**
  `materializeLayoutFramesForPresentation` and
  `materializeLayoutFramesForMotionPresentation` now cache their resolved layout
  scenes in `WeakMap`s keyed by the immutable `SceneDocument` root. The editor
  canvas, interaction hit-testing, motion sampling, and export preview can reuse
  the same layout-projected scene instead of rewalking layout frames and running
  deep geometry/transform equality checks for the same document. Old entries are
  released by the JavaScript engine when old document objects become unreachable,
  so this uses available machine memory without adding manual invalidation.
- **Blend refresh projections are shared by document identity.**
  `refreshSceneBlendNodes` now caches the read-only generated-children projection
  for a `SceneDocument` root. This prevents Blend-heavy motion presentation from
  allocating a fresh refreshed scene before every layout/motion sample when the
  source document itself has not changed.
- **Derived projection artifacts can warm through browser storage.**
  `src/shared/cache/*` adds the browser-local cache substrate:
  content-addressed keys, manifests, memory fallback, IndexedDB registry/blob
  storage, OPFS blob storage, runtime capability probing, a cache Worker queue,
  and telemetry. `CanvasShell` schedules idle warming through
  `widgets/canvas-shell/model/persistent-cache-client.ts`, reads persistent
  layout/Blend artifacts without blocking the pointer path, and primes the
  existing `WeakMap` caches only after the stored document hash matches the
  current scene.
- **GPU/text/image cache activity is observable.** The experimental GPU surface
  and text raster path now emit derived-cache telemetry for texture decode,
  data-image upload-source reuse, text rasters, frame-grain upload sources, and
  GPU draw-list bucket compiles.
  In dev builds, `globalThis.__vmaCanvasCache.snapshot()` reports recent cache
  activity and `globalThis.__vmaCanvasCache.clear(kind?)` clears only derived
  artifacts, never project/document data.
- **Text, mesh, frame-grain, GPU draw-list, and data-image source artifacts can
  persist.** `widgets/canvas-shell/model/persistent-raster-cache.ts` gives
  synchronous render paths a memory-first lookup, schedules OPFS/IndexedDB
  hydrate on miss, and writes freshly generated text rasters, mesh rasters, and
  frame-grain upload sources back to the derived cache without awaiting inside
  render. `widgets/canvas-shell/model/persistent-gpu-draw-list-cache.ts` does
  the same for committed-scene GPU draw-list source artifacts, while
  `shared/gpu/texture-cache.ts` persists only stale-safe `data:image/*` source
  bytes and leaves external URLs on the ordinary fetch/decode path.
- **iPad Quick Menu can clear derived cache safely.** The no-selection iPad
  Quick Menu exposes a cache clear command that calls the same derived-artifact
  clear path as the diagnostic global. It deletes only regenerable cache
  artifacts, never project or document data.
- **Live drag geometry is routed through a transient override store.** Node
  move/resize/rotate drags previously wrote the scene store's document on
  every pointermove, which re-rendered the whole canvas tree (per-artboard
  frame-look/mask/filter computation, motion/expression re-sampling) on every
  frame of a drag. A new transient store
  (`src/features/transform/model/live-drag-store.ts`) holds per-node
  geometry overrides for the in-progress gesture; `CanvasShell`'s memoized
  node renderer and the select-tool overlay subscribe to it per node, so
  only the actively dragged node(s) and selection chrome re-render mid-drag.
  The scene store itself is written once, at gesture end, mirroring the
  pattern the draw feature already used for shape/pen/pencil drags
  (`useDrawStore`). Every pointermove still recomputes an absolute matrix
  from the gesture's start snapshot (never a delta), so the final committed
  write is byte-identical to what the old per-move path would have produced.
- **Stage rect is cached per gesture.** The stage SVG's
  `getBoundingClientRect()` is cached once per pointer gesture (seeded on
  pointerdown, reused while the pointer id matches, cleared on
  pointerup/pointercancel/lost-capture/tool-switch), so pointermove no longer
  forces a layout read on every move.
- **No-op snap/hover writes are skipped.** `setActiveSnap` /
  `showActiveSnap` / `clearActiveSnap` (`src/entities/guides/model/store.ts`)
  and `setHover` / `setHoveredNode` (`src/features/transform/model/store.ts`)
  gained structural-equality guards, so an equivalent snap/hover state
  preserves object identity instead of forcing the guides overlay or
  transform overlay to re-render on every pointermove.
- A related earlier fix in the same series skips per-pointermove hit-test
  rebuilds during shape/pen/pencil drags (memoized document-for-artboard
  lookups, lazy hit-test getters, per-gesture smart-guide candidate caching).
- **The runtime shell loads less eagerly.** `App.tsx` keeps the persistence and
  routing shell small while lazy-loading `/editor`, public/commercial routes,
  projects, updates, legal, and tutorial pages. `EditorPage.tsx` then lazy-loads
  the largest optional chrome chunks — Layers, Inspector, Timeline, Look
  Workspace, Parameter Capture, and Floating Inspector — with stable chrome
  placeholders so workspace fit calculations still see the intended panel
  footprint while a chunk is arriving.
- **Fingerprint assets are cached immutably at the Worker boundary.** HTML
  responses remain `no-store` for stale chunk recovery, but Vite-style
  `/assets/*-[hash].*` files now receive long-lived immutable cache headers when
  served from `env.ASSETS.fetch`. Non-fingerprinted tutorial runtime files stay
  on the default safer cache path until their filenames are versioned.
- **React Compiler adoption is deliberately narrow.** The Vite Babel pass is
  limited to `widgets/tool-rail/ui` and uses annotation mode, so only components
  with a `"use memo"` directive are compiled. This keeps imperative
  CanvasShell/GPU/store subscription paths out of the first pilot.
- **Feedback-loop tuning is opt-in.** Vite can be launched with
  `bun run dev:profile`, and dev server warmup pre-transforms the app/editor
  shell. Vitest defines the intended focused tags and an opt-in dependency
  optimizer script, but existing test files are unchanged.

## What Can The User Do Now?

Authoring, motion, and export behavior are unchanged; documents render and
export byte-identical to before this pass. On iPad-like devices, the Quick Menu
can clear the derived cache if storage pressure or stale diagnostics need a
manual reset. The main observable difference is reduced main-thread work while panning,
zooming, dragging, and scrubbing, which matters most on larger documents
(at or above the existing 800-node culling threshold) and during drag
gestures on any document. On browser environments with IndexedDB/OPFS/Worker
support, layout/Blend projection work can also be warmed outside the active
gesture path and reused after reload when the content-addressed key still
matches.

For timeline review, playback can now spend pixels in proportion to the displayed
artboard instead of the authored 4K frame. The static-source compositor is
automatic only inside its narrow admission envelope; outside it the editor keeps
the established fidelity-first path. Pausing requests the native-quality frame.

On repeat visits, fingerprinted JavaScript/CSS/assets can be reused without
revalidation. Opening optional routes and panels may fetch their own chunks on
first use, but they no longer need to sit in the initial editor route payload.

## Why It Matters

The canvas is the editor's primary surface, and every one of these paths sits
on the pointermove/frame hot path: panning, zooming, dragging a selection,
and scrubbing the timeline. Removing redundant document-store writes,
render-tree reconstruction, sampler recompilation, repeated Blend/layout
materialization, layout reads, and overlay
re-renders from that hot path keeps the editor responsive as documents grow
and as motion/expression bindings are added, without changing the rendering
contract that exports and other adapters rely on.

## What Was Verified?

The 2026-07-13 continuation ran the repository static gate, test suite,
production build, bundle guard, and a headed-browser Gravity Field capture.
Runtime sampler, WebGL player, and reference-scene generated artifacts were
refreshed. The browser capture used a 1920 × 1080 viewport, DPR 1, 35% editor
zoom, and a 10-second warm playback window. The browser's own bare rAF baseline
was approximately 50Hz; Vecmo presented 503/503 requested frames, recorded no
superseded frame and frame age 0, used a 1440 × 810 playback backing, and did no
steady-state SVG decode/upload. Paused/native and playing/static screenshots were
inspected for complete composition and clipping.

These earlier broad canvas-performance checks remain separate from the focused
timeline result and should still be performed when their areas change:

- `quantizeCullingRect` in `culling.test.ts` proves the snapped rect is
  always a superset of the input rect (outward-only snapping), and that
  small pan/zoom deltas leave the quantized edges byte-identical.
- `evaluator.test.ts` and `presentation.test.ts` pin the motion-sampler
  memoization behavior and prove `samplePresentation`'s output is unchanged
  across geometry-only edits.
- `live-drag.test.ts` / `live-drag-store.test.ts` cover the override
  lifecycle and prove the final committed matrix after a multi-move drag
  matches what the prior per-move write path would have produced.
- A manual editor smoke: pan/zoom a large document, drag a selection, and
  scrub the timeline, confirming no visual regression (nothing pops in late
  at the viewport edge, dragged nodes track the pointer, motion/expression
  previews still resample correctly after the drag commits).
- For the persistent-cache continuation: open a heavy document, let the editor
  idle, reload, and confirm `__vmaCanvasCache.snapshot()` shows layout/Blend
  hits or puts without blocking pan/pinch/selection. Clear with
  `__vmaCanvasCache.clear()` and confirm document/project data remains intact.
- For the 2026-07-09 runtime loop, inspect the production manifest after an
  authorized build: route pages and large panel widgets should be dynamic
  entries, and `bun run check:bundle` should fail if those splits regress.
  In the browser network panel, HTML should stay `no-store` while hashed
  `/assets/*` responses carry immutable cache headers.

## What Is Still Limited?

- This is an internal rendering optimization with no user-facing surface;
  it does not add a feature, control, or capability.
- The transform-only static compositor deliberately rejects opacity, geometry,
  paint, text, Look-param, animated Source Optics, camera, grammar, expression,
  video, parenting, nested/Blend, partial-target, and complex-artboard cases. Those
  documents remain correct through the full-frame fallback but may still be
  slower during playback.
- The Gravity Field product bar has been captured in one named automated browser
  environment. Its browser-level rAF ceiling was 50Hz rather than the nominal
  60Hz target, but Vecmo matched that cadence without losing a requested frame.
  Wider physical-device/DPR/power-mode coverage remains release work. Deep Glow
  kernel surgery and direct WebGPU canvas convergence remain deferred because
  this evidence does not justify their complexity or a quality tradeoff.
- A separately rendered review-proxy window is documented as the preferred
  follow-up for deterministic, dropped-frame-free review of scenes outside the
  live compositor envelope. It is not implemented by this pass and must use an
  explicit render action plus frozen-source/out-of-date signaling rather than
  silently showing stale media.
- The large-document culling threshold (`CULL_NODE_THRESHOLD` = 800) is
  unchanged — this pass improves what happens above/below that line, not
  where the line sits.
- The existing `WeakMap` caches remain the synchronous render fast path. The
  browser-local persistent layer warms and primes them asynchronously; a cold
  first render can still compute synchronously when a renderer truly needs the
  projection before idle warming finishes.
- Persistent storage is best-effort. OPFS, IndexedDB, Worker, OffscreenCanvas,
  and WebGPU are all feature-detected and can fall back to memory/SVG behavior
  without changing document correctness.
- Accepted tradeoffs carried from the live-drag change: the Inspector's
  numeric fields update only at gesture end (not continuously) during a
  transform drag, and a dragged node with live motion/expression bindings
  shows raw override geometry (no re-sampling) until pointerup. Artboard
  move/resize, corner-radius rounding, and text-box area-resize still write
  per move as before — they were not part of the profiled hot path this
  pass targeted.
- The 2026-07-09 split/cache loop was implemented without running build, test,
  or benchmark commands. React Compiler coverage is intentionally tiny; broader
  compiler adoption, Vitest optimizer defaults, Vite `optimizeDeps` tuning, and
  Cloudflare Smart Placement still require measured evidence before they should
  become default behavior.
