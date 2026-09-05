# Halftone Look Node

Date: 2026-07-01.
Status: beta — second production slice of the Display/Pixel/Print Look effects
pack.

## Summary

The Look graph gains a new node kind, `halftone`: a GPU raster-finish dot-screen
effect that samples source luminance on a rotated cell grid and maps each cell's
tone to a dot radius. It is designed as a designer-friendly print/display look:
add it, drag a few controls, and get an immediately legible poster/comic/screen
tone treatment.

Unlike `scanline`, this node is **not SVG-native**. The true effect needs
per-cell sampling, stable periodic cells, rotated lattice coordinates, and
anti-aliased variable dot radius, so it runs as a WebGL fragment-shader pass in
the same deferred fidelity family as `lens`, `kaleidoscope`, `flow`,
`noise-source`, `path-blur`, and `deep-glow`. Static SVG/PDF and Worker SVG
output should report the node as deferred/omitted rather than overclaiming native
fidelity.

## What Users Can Do Now

- Add **Halftone** from the Look workspace node palette in the Texture category
  (search "dots", "dot screen", "print", "newspaper", "comic", "manga",
  "risograph", "screen tone", or "pixel").
- Control five sliders:
  - **Cell Size** — coarser vs. finer dot grid, in artboard pixels / scene
    units.
  - **Dot Size** — maximum dot coverage multiplier.
  - **Contrast** — tonal steepness before dot radius is calculated.
  - **Angle** — screen rotation, -90 to 90 degrees.
  - **Mix** — blend the halftone result over the original image.
- Chain it with other GPU raster-finish Look nodes on the editor canvas and in
  WebM/WebGL playback export.
- Agent/MCP clients can discover the node's image ports and typed payload params
  through `list_look_node_capabilities`, then add or update it with
  `scene/patch-look-graph`.
- Keep effects open: this node is not Pro-gated. Pro value remains cloud/publish
  continuity, not effect availability.

## How To Use

1. Open the Look workspace for the target frame/artboard Look graph.
2. Add **Halftone** from the Texture category.
3. Keep the default `Cell Size: 16`, `Dot Size: 0.85`, `Contrast: 0.65`,
   `Angle: 15`, `Mix: 1` for a visible dot screen on insert.
4. Increase **Cell Size** for chunky poster dots, or lower it for a tighter
   screen.
5. Raise **Dot Size** or **Contrast** for heavier ink coverage.
6. Rotate **Angle** to avoid perfectly horizontal/vertical screen tone.
7. Lower **Mix** when the effect should texture the source instead of replacing
   it.

## What A Reviewer Should Verify

1. Adding the node from the palette inserts a `halftone` node and the canvas
   shows a visible dot screen.
2. The grid is stable and periodic, not stochastic noise.
3. Dragging **Cell Size**, **Dot Size**, **Contrast**, **Angle**, and **Mix**
   produces monotonic visual changes.
4. Toggling the node removes/restores the GPU overlay.
5. A serial chain of GPU raster nodes still renders in order.
6. Static SVG/PDF and Worker SVG output do not pretend the node is native;
   fidelity metadata should identify the node as deferred/omitted.

## Verification Performed

Initial handoff skipped test-like verification under the repository rule. QA
continuation on 2026-07-02 ran `bun run check`, `bun run test`,
`bun run build`, `bun run check:bundle`, and a Playwright editor smoke that
opened the Look Graph workspace, inserted **Halftone**, and confirmed the
display/print nodes are searchable. A source-level SVG export smoke confirmed
GPU-deferred frame Look graphs now emit `vec-core-recipe-svg-unsupported` with
`local-raster-required` instead of dropping silently.

A live pixel pass on 2026-07-02 rendered the node on an asymmetric QA chart
(gradient, radial highlight, color patches): dot radius tracks tone (large in
shadows, vanishing in highlights), the screen lattice rotates with Angle,
color patches print as colored dot fields, and the result is upright after
the GPU-surface presentation-flip fix (`docs/look-effects-pack-handoff.md`
§6, bug 3). The WebM recording path now composes frames offscreen so a slow
frame can no longer ship SVG-only intermediate states (§6, bug 5). Cell
sampling was upgraded to a 4x4 area average (tone fidelity + video
stability), live-verified on real footage 2026-07-02 on branch
`feat/dither-quality-pass`.

The implementation was planned by six expert lenses plus an orchestrator-director
synthesis. All six lenses converged on the GPU-deferred approach for product
quality and honesty: a true halftone needs a sampled periodic grid and variable
dot radius, while an SVG `feImage`/`feTile` route would be a separate renderer
contract that still needs proof across editor SVG, export SVG, Worker render,
and raster capture.

## What Is Still Intentionally Limited

- **Not native to static SVG/PDF/Worker SVG.** This is a deferred GPU effect.
  Static vector surfaces should omit it with fidelity metadata rather than
  approximating it.
- **No CMYK/rosette simulation.** V1 is one dot screen, not a print-accurate
  multi-channel press model.
- **No shape library.** V1 renders round dots only; line/cross/glyph cells are
  future candidates.
- **No dedicated mask texture in the GPU pass.** The node exposes only image
  input/output, avoiding a fake mask contract until GPU mask input exists.
- **No native `feTile` prototype.** SVG has a tile primitive, but this codebase
  does not yet have a proven visible-pixel `feImage`/`feTile` contract for this
  class of effect.

## Related Docs

- [Scanline / CRT Look node](./scanline-crt-look-node.md)
- [Commercial packaging strategy](./commercial-packaging-strategy.md)
- [Motion / Code WebGL runtime](./webgl-player-export.md)
