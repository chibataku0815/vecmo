# Flow Look Node (evolving organic displacement)

Date: 2026-06-26.
Status: `beta` (inherits the Look graph authoring surface, which is beta/internal).

## Summary

The Look graph gains a `flow` effect node: an **evolving organic displacement** — the
GPU equivalent of After Effects' **Turbulent Displace + Evolution**, with the
displacement-type selector AE has. A fractal-noise field warps the artboard, and an
**Evolution** parameter slides through the noise volume so the field **morphs
continuously over time** — the smooth noise evolution that SVG provably cannot do (an
SVG turbulent field can only scroll, not evolve). It is the third effect on VMA's GPU
raster-finish surface (after Lens and Kaleidoscope).

This closes the gap behind the "glow sphere" reference look (gradient → blur →
**Turbulent Displace (Bulge) + Evolution** → CC Lens → glow): the evolving Bulge
displacement is exactly what was missing.

## What Changed?

- The GPU raster surface (`@/shared/gpu-lens/surface`) gains a `flow` mode: a 3D
  value-noise fbm shader sampled at `(uv·scale, evolution)`, so raising Evolution
  morphs the field. `pattern` picks the displacement: **Turbulent** (vector),
  **Bulge** (radial), **Twist** (angular).
- A new authorable Look node kind `flow`. Params: **Pattern** (Turbulent / Bulge /
  Twist), **Amount** (strength), **Detail** (noise frequency), **Evolution** (animate
  this), **Center X / Y** (for Bulge/Twist). Amount/Detail/Evolution/Center are
  keyframable (per-slider keyframe diamond + `motion/upsert-look-node-keyframe`);
  Pattern is a select in the docked Look Graph workspace (like Warp's Mode).
- The editor overlay and WebM video export detect `flow` and render it on the GPU
  surface.

## What Can The User Do Now?

In the docked Look Graph workspace, add a **Flow** node, choose a **Pattern**, and
scrub **Amount/Detail** to set the distortion. **Keyframe Evolution** (e.g. 0 → 2 over
the timeline) to make the warp *flow and morph* — a living organic animation. Combined
with a blurred gradient source and a Lens node, this reproduces the reference glow-
sphere animation.

## What Is Still Limited?

- **Animates on scrub, during live editor Play, and in exported WebM.** The keyframed
  Evolution (and any keyframed GPU-raster effect param) now follows live editor
  playback: the GPU overlay subscribes to the transport and re-renders off it while
  the presentation document is frozen during Play.
- **Editor canvas + WebM only.** SVG and PDF export omit the flow (no SVG path) and
  honestly report it as a deferred, not-rendered node. The Cloudflare Worker (no WebGL)
  also omits it. (The existing SVG `displace` / "Turbulent Displace" node remains for
  SVG-exportable static turbulence; Flow is the GPU evolving superset.)
- The REPEAT texture wrap (shared with Kaleidoscope) means a strong displacement near
  the frame edge samples the opposite edge; fine for centred content on margins, but it
  can bleed on full-bleed sources.

## What Should A Reviewer Verify?

- `bun run check` is green; `tsc -b` covers the cascade (Pattern enum mirrors Warp's
  field-patch/select seam; the numeric params mirror the lens cascade). The shader
  (fbm + evolution axis + bulge/turbulent/twist) was proven in a real browser on the
  seed artboard before the module existed — evolution 0 vs 0.4 are different organic
  states, confirming the field morphs.
- In the browser (milestone smoke, verified): a Flow node visibly warps the seed
  artboard on the editor canvas (default turbulent, amount 0.07); Lens still renders its
  sphere (no regression from the surface render-branch change).
- WebM export composites Flow via the same `drawImage(webglCanvas → 2-D capture canvas)`
  path proven for the lens; per-frame params come from `buildExportRenderPresentation`,
  so a keyframed Evolution animates in the exported video. The MediaRecorder path is
  unchanged, so it was not re-run end-to-end this slice.
- Playback-follow (verified): with a keyframed Evolution (0→4), changing the frame while
  `isPlaying` stays true updates the GPU warp — and during Play, CanvasShell freezes the
  presentation document, so the scrub effect *cannot* fire; the update proves the
  overlay's `subscribePlayback → getRasterFrame → render` follow-path. (The rAF clock
  that auto-advances frames is throttled to zero in a hidden/headless preview tab, so
  the frame was advanced manually; the follow mechanism — the code under test — is what
  was verified.)
