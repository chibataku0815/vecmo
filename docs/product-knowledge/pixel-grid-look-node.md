# Pixel Grid Look Node

Date: 2026-07-01.
Status: beta - third production slice of the Display/Pixel/Print Look effects
pack.

## Summary

The Look graph gains a new node kind, `pixel-grid`: a GPU raster-finish
display-cell effect that samples the source once per fixed-size cell, then
draws a rounded lit pixel against a dark gap. It covers the LED panel / dot
matrix / low-resolution signage family without pretending to be ASCII, RGB
subpixel simulation, or a native SVG filter.

This is a sibling of `halftone`, not a print rosette. Halftone maps luminance to
dot radius; Pixel Grid keeps a uniform cell footprint and maps the sampled color
into display cells. The result reads like a controllable LED matrix, billboard,
or chunky pixel screen.

Like `halftone`, this node is **not SVG-native**. The true effect needs stable
per-cell sampling, dark inter-cell gaps, rounded cell coverage, and smooth
anti-aliasing at the fragment level, so it runs as a WebGL pass in the same
deferred fidelity family as `lens`, `kaleidoscope`, `flow`, `noise-source`,
`path-blur`, `deep-glow`, and `halftone`. Static SVG/PDF and Worker SVG output
should report the node as deferred/omitted rather than overclaiming native
fidelity.

## What Users Can Do Now

- Add **Pixel Grid** from the Look workspace node palette in the Texture
  category (search "led", "matrix", "dot matrix", "pixel", "pixel grid",
  "display", "screen", "signage", "billboard", "diode", "low-res",
  "mosaic", or "rgb").
- Control six sliders:
  - **Cell Size** - coarser vs. finer display cells, in artboard pixels / scene
    units.
  - **Gap** - dark spacing between lit cells.
  - **Roundness** - square pixels through rounded LED dots.
  - **Brightness** - display emission gain before final blending.
  - **Contrast** - tonal punch inside each sampled cell.
  - **Mix** - blend the pixel-grid result over the original image.
- Chain it with other GPU raster-finish Look nodes on the editor canvas and in
  WebM/WebGL playback export.
- Agent/MCP clients can discover the node's image ports and typed payload params
  through `list_look_node_capabilities`, then add or update it with
  `scene/patch-look-graph`.
- Add **Deep Glow** after Pixel Grid when the display should bloom; glow is not
  baked into the Pixel Grid node itself.
- Keep effects open: this node is not Pro-gated. Pro value remains cloud/publish
  continuity, not effect availability.

## How To Use

1. Open the Look workspace for the target frame/artboard Look graph.
2. Add **Pixel Grid** from the Texture category.
3. Keep the default `Cell Size: 16`, `Gap: 0.18`, `Roundness: 0.6`,
   `Brightness: 1.15`, `Contrast: 0.45`, `Mix: 1` for a visible LED-panel look
   on insert.
4. Increase **Cell Size** for signage or billboard cells; lower it for a tighter
   pixel display.
5. Raise **Gap** to make the panel structure more explicit.
6. Lower **Roundness** for square pixel art; raise it for round LED dots.
7. Raise **Brightness** or **Contrast** when the panel needs more emission.
8. Lower **Mix** when the source should remain visible beneath the grid.

## What A Reviewer Should Verify

1. Adding the node from the palette inserts a `pixel-grid` node and the canvas
   shows stable display cells.
2. Cell boundaries remain stable when scrubbing parameters; the effect should
   not look like stochastic noise.
3. Dragging **Cell Size**, **Gap**, **Roundness**, **Brightness**,
   **Contrast**, and **Mix** produces monotonic visual changes.
4. Chaining Pixel Grid before **Deep Glow** blooms the lit cells without Pixel
   Grid owning a fake glow model.
5. A serial chain of GPU raster nodes still renders in order.
6. Static SVG/PDF and Worker SVG output do not pretend the node is native;
   fidelity metadata should identify the node as deferred/omitted.

## Verification Performed

Initial handoff skipped test-like verification under the repository rule. QA
continuation on 2026-07-02 ran `bun run check`, `bun run test`,
`bun run build`, `bun run check:bundle`, and a Playwright editor smoke that
opened the Look Graph workspace, inserted **Halftone**, and confirmed **Pixel
Grid** is searchable. A source-level SVG export smoke confirmed GPU-deferred
frame Look graphs now emit `vec-core-recipe-svg-unsupported` with
`local-raster-required` instead of dropping silently.

A live pixel pass on 2026-07-02 rendered the node on an asymmetric QA chart
and on an imported MP4: stable LED cells with dark gaps, vivid color patches,
tone tracking across the gradient, upright after the GPU-surface
presentation-flip fix (`docs/look-effects-pack-handoff.md` §6, bug 3). The
same node was verified end-to-end on video: editor canvas, recorded WebM
(frame-extracted — LED cells baked into the moving frames), and the exported
WebGL player/overlay with deterministic seeks. The WebM recording path now
composes frames offscreen so a slow frame can no longer ship SVG-only
intermediate states (§6, bug 5). Cell sampling was upgraded to a 4x4 area
average (tone fidelity + video stability), live-verified on real footage
2026-07-02 on branch `feat/dither-quality-pass`.

The implementation was planned by six expert lenses plus an orchestrator-director
synthesis. The panel chose Pixel Grid as the next highest-product-value slice
after Halftone because it reuses the proven GPU raster-finish path, is visually
distinct on insertion, and avoids the premature renderer contracts required by
ASCII/glyph atlases, RGB subpixel layouts, or native SVG tile compositing.

## What Is Still Intentionally Limited

- **Not native to static SVG/PDF/Worker SVG.** This is a deferred GPU effect.
  Static vector surfaces should omit it with fidelity metadata rather than
  approximating it.
- **No ASCII or glyph cells.** Text/glyph mapping needs a separate atlas,
  charset, sizing, and sampling contract.
- **No RGB subpixel simulation.** V1 emits one sampled cell color rather than
  modeling separate red/green/blue diodes.
- **No built-in bloom.** Chain **Deep Glow** after Pixel Grid for a real glow
  pass instead of duplicating glow controls here.
- **No dedicated mask texture in the GPU pass.** The node exposes only image
  input/output, avoiding a fake mask contract until GPU mask input exists.
- **No native `feTile` prototype.** SVG tiling remains unproven for visible
  per-cell image compositing in this codebase.

## Related Docs

- [Halftone Look node](./halftone-look-node.md)
- [Scanline / CRT Look node](./scanline-crt-look-node.md)
- [Commercial packaging strategy](./commercial-packaging-strategy.md)
- [Motion / Code WebGL runtime](./webgl-player-export.md)
