# Kaleidoscope Look Node

Date: 2026-06-26.
Status: `beta` (inherits the Look graph authoring surface, which is beta/internal).

## Summary

The Look graph gains a `kaleidoscope` effect node: an **N-fold wedge-and-mirror
symmetry** that turns any artboard into a symmetric mandala. It is the second effect on
**VMA's GPU (WebGL) raster-finish surface** (after the CC Lens) — a UV remap SVG filters
cannot do. Unlike the lens (a refraction), the kaleidoscope folds the plane into
`segments` mirrored wedges around a centre, so adjacent wedges reflect.

Crucially, the kaleidoscope is **content-independent**: it produces a designed-looking
mandala from any content (shapes, text, photos), so it reads as an intentional effect
the moment it is inserted — no special source needed.

## What Changed?

- The GPU raster surface (`@/shared/gpu-lens/surface`) generalized from a lens-only
  module to a **mode-based** `createGpuRasterSurface(width, height, mode)` with
  `mode: "lens" | "kaleidoscope"`. Each mode selects a fragment shader; the lens shader
  is unchanged. The shared texture wrap is now `REPEAT` (the kaleidoscope sample
  overshoots `[0,1]`; the lens never samples out of range, so REPEAT is safe for it).
- A new authorable Look node kind `kaleidoscope`, an ordinary effect node (image +
  optional mask in, image out). Params: **Segments** (mirrored wedges, integer 2..24),
  **Rotation** (0..1 = one full turn), **Center X / Y** (0..1). All four are
  keyframable (per-slider keyframe diamond + `motion/upsert-look-node-keyframe`), so a
  kaleidoscope can spin (animate Rotation) or open/close (animate Segments) over time.
- The editor canvas overlay (`src/features/gpu-lens/canvas/overlay.tsx`) and WebM video
  export now detect both `lens` and `kaleidoscope` nodes and render them on the GPU
  surface.

## What Can The User Do Now?

In the docked Look Graph workspace, add a **Kaleidoscope** node and scrub **Segments**
to set the symmetry (6 = a flower, 12 = a sunflower), **Rotation** to turn the mandala,
and **Center** to move the fold origin. Keyframing Rotation makes the kaleidoscope spin.
The effect shows live on the editor canvas (on scrub) and in WebM video export. It can
be gated by a Mask node and combined with other Look nodes (it folds the already-
graded/glowed composite, sitting downstream of them in the graph).

## What Should A Reviewer Verify?

- `bun run check` is green; `tsc -b` covers the all-numeric node cascade (the exhaustive
  switches force every typed seam). The kaleidoscope shader (wedge-mod + mirror fold +
  rotation) was proven in a real browser on the real seed artboard before the module
  existed — it produces clean N=6/8/12 mandalas, decisively "works on insert".
- In the browser (milestone smoke, verified): a kaleidoscope node on the seed artboard
  renders a symmetric mandala on the editor canvas; a lens node still renders its sphere
  (the surface refactor did not regress the lens).
- WebM export composites the kaleidoscope via the same `drawImage(webglCanvas → 2-D
  capture canvas)` path proven for the lens (`video.ts` reads the per-frame raster
  params and renders the GPU surface in the detected mode). The MediaRecorder path is
  unchanged, so it was not re-run end-to-end this slice.

## What Is Still Limited?

- **Editor canvas + WebM video, this slice.** SVG and PDF export omit the kaleidoscope
  (no SVG path) and honestly report it as a deferred, not-rendered node via the Look
  graph export manifest. The web/code runtime (`.runtime.js`) is a later slice.
- The **Cloudflare Worker** SVG renderer does not run WebGL, so server-side renders also
  omit it (the same honest degradation as export).
- A keyframed param (e.g. Rotation) animates on scrub, during **live editor playback**
  (the GPU overlay follows the transport while the presentation document is frozen), and
  in WebM.
