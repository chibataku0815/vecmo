# Lens (CC Lens / Spherical Refraction) Look Node

Date: 2026-06-26.
Status: `beta` (inherits the Look graph authoring surface, which is beta/internal).

## Summary

The Look graph gains a `lens` effect node: a **spherical lens / fisheye** (after the
After Effects "CC Lens") that wraps the flat artboard onto a 3-D-looking sphere. It is
**VMA's first GPU (WebGL) raster-finish effect** — the kind of distortion that SVG
filters provably cannot do. A magnifying lens needs a non-monotonic radial remap;
`feDisplacementMap` folds and tears on it (verified across several profiles). So the
lens is rendered by a fullscreen-quad fragment shader on the GPU instead of an SVG
filter.

## What Changed?

- A self-contained WebGL render module, `@/shared/gpu-lens/surface`
  (`createGpuLensSurface`): it rasterizes the artboard SVG into a texture
  (`new Image()` + `decode()` of a data-URL SVG — untainted, Safari-safe) and applies
  a spherical-remap shader (`sampleUV = centre + (uv − centre)·mix(1, √(1−r²),
  convergence)`, aspect-corrected, passthrough outside the lens radius). It returns
  `null` when WebGL is unavailable, so the editor degrades to the plain SVG layer.
- A new authorable Look node kind `lens`, an ordinary effect node (image + optional
  mask in, image out) composing like the other Look nodes. Params: **Size** (lens
  radius, 0..1 of the frame), **Convergence** (spherical magnification, 0..1),
  **Center X / Y** (0..1). All four are keyframable (per-slider keyframe diamond +
  `motion/upsert-look-node-keyframe`), so the lens can swell, drift, or pulse over
  time.
- An editor canvas overlay (`src/features/gpu-lens/canvas/overlay.tsx`,
  auto-discovered by the overlay registry) that detects a `lens` node in the resolved
  frame Look graph, lazily imports the WebGL surface, and mounts the GPU canvas
  pixel-aligned over the artboard. The canvas-shell widget supplies the artboard SVG
  string (the export serializer lives in a sibling feature an overlay may not import).
- A boolean **Clip to rim** param on the lens node (default off). When on, everything
  outside the lens radius is replaced by the **artboard background colour** (opaque,
  with a one-pixel anti-aliased rim) instead of passing the source through. This is the
  fix for a content effect (e.g. Flow / Turbulent Displace) that pushes the image past
  the circle: without it, the GPU canvas passes that spilled content through, and going
  transparent instead would only reveal the un-distorted SVG source underneath (the GPU
  canvas is layered opaquely over the always-rendered SVG, in both the editor and WebM
  export). Filling with the background colour reliably hides the outside in both. The
  rim fill colour is threaded from `artboard.background` (parsed by `@/shared/color`'s
  `hexToRgb`, black fallback for a non-hex background) into the shader; the shader stays
  free of entity imports.

## What Can The User Do Now?

In the docked Look Graph workspace, add a **Lens** node and scrub **Convergence** to
wrap the artboard onto a sphere, **Size** to grow or shrink the lens, and **Center**
to move it. Keyframing the params (via the diamonds or an agent) animates the lens.
The lens shows on the editor canvas (live, on scrub) and in **WebM video export**
(composited onto each recorded frame; a keyframed lens animates in the video). It can
be gated by a Mask node and combined with other Look nodes — the lens warps the
already-graded/glowed composite, because it sits downstream of them in the graph.

Toggle **Clip to rim** on the lens node to hard-clip the result to the lens circle: the
outside is filled with the artboard background (a "glass sphere on a clean background"
cutout, anti-aliased at the rim). Use it when an upstream effect such as Flow spreads
the image past the lens circle and you want only the sphere to show. It is most
meaningful when the lens is the last (or only) GPU node before the output — a GPU pass
after it (for example Deep Glow) treats the flat background fill as image content and
would bloom or displace it. A near-zero lens **Size** with Clip to rim on fills the
whole frame with the background colour (the circle shrinks to nothing).

## What Should A Reviewer Verify?

- `bun run check` is green; `tsc -b` covers the node cascade (the exhaustive switches
  in `look-graph.ts`, `look-graph-compile.ts`, and the commands force every typed
  seam). The GPU surface render pipeline and the spherical shader were proven in a
  real browser before the module existed (see `docs/gpu-lens-raster-surface-plan.md`
  → "Slice-zero"), including a real seed-artboard SVG round-tripped through
  `renderSceneSvg → Image.decode → texImage2D → shader → readback`.
- In the browser (milestone smoke, verified): a seed artboard carrying a lens node
  (built via the real `createInsertLookGraphNodeCommand`) renders the whole composited
  artboard as a 3-D sphere on the editor canvas, with selection handles and other
  overlays drawn correctly on top; removing the lens returns the flat artboard with no
  leftover GPU canvas (the teardown branch). The add-node menu entry and the
  Size/Convergence/Center sliders are tsc-covered and pattern-identical to the other
  Look nodes, but were not separately browser-shown this slice.
- WebM export (S3): the composite mechanism — `context.drawImage(webglCanvas)` onto
  the 2-D capture canvas — was proven in a browser at real 16:9 export dimensions (the
  sphere stays circular, so aspect correction holds), and the export wiring
  (`readLensParams(buildExportRenderPresentation(...).scene)` returning params across
  frames — i.e. the lens node surviving `sampleMotionPresentationFrame`) was verified
  by running the actual export functions in a script. The full `video.ts` MediaRecorder
  path was not run end-to-end (S3 only adds one `drawImage` to the unchanged recorder).
- `bun run test` (vitest) was not run for this slice (standing test-discipline rule);
  a new `LookGraphNodeKind` may need updates to kind-enumerating tests (NODE_KINDS,
  per-kind compile loops, MCP-enum mirror). Run/update before relying on the suite.

## What Is Still Limited?

- **Editor canvas + WebM video, this slice.** The lens renders live on the editor
  canvas and is composited into WebM video export. SVG and PDF export still omit the
  lens (no SVG path) and honestly report it as a deferred, not-rendered node via the
  Look graph export manifest. The web/code runtime (`.runtime.js`) is a later slice
  (S4).
- **The Cloudflare Worker SVG renderer** does not run WebGL, so server-side renders
  also omit the lens (the same honest degradation as export).
- **Convergence is the positive (magnify) regime** for now; negative convergence
  (pincushion) and an explicit edge-refraction band are refinements.
- A keyframed param animates on scrub, during **live editor playback** (the GPU overlay
  follows the transport while the presentation document is frozen), and in WebM.
