# Glyph Mosaic Look Node

Date: 2026-07-01.
Status: beta - fifth production slice of the Display/Pixel/Print Look effects
pack.

## Summary

The Look graph gains a new node kind, `ascii-glyph`: a GPU raster-finish glyph
mosaic effect. It samples the source once per stable character cell, maps
luminance through a fixed density ramp, and draws a procedural 5x7 ASCII glyph
mask inside the cell.

The user-facing label is **Glyph Mosaic** rather than "custom glyph" or
"typography" because V1 is intentionally narrow: a built-in ASCII density ramp,
not a font picker, text layer, Japanese glyph atlas, or arbitrary charset
renderer.

Like `halftone`, `pixel-grid`, and `ordered-dither`, this node is **not
SVG-native**. Static SVG/PDF and Worker SVG output should report the node as
deferred/omitted rather than overclaiming native fidelity.

## What Users Can Do Now

- Add **Glyph Mosaic** from the Look workspace node palette in the Texture
  category (search "ascii", "ascii art", "glyph", "character", "text art",
  "terminal", "ansi", "code", "type", "matrix", "mosaic", "low-res", "pixel",
  "retro", or "poster").
- Control six sliders:
  - **Cell Size** - character-cell height, in artboard pixels / scene units.
  - **Glyph Size** - scale of the 5x7 glyph inside each cell.
  - **Contrast** - tonal steepness before glyph selection.
  - **Brightness** - gain for lit glyph pixels.
  - **Density Bias** - shifts the luminance-to-glyph mapping lighter/heavier.
  - **Mix** - blend the glyph mosaic over the original image.
- Toggle **Invert density ramp** from the selected node controls.
- Chain **Color Map** before or after Glyph Mosaic for color styling. Custom
  palette controls are intentionally not duplicated inside this node.

## How To Use

1. Open the Look workspace for the target frame/artboard Look graph.
2. Add **Glyph Mosaic** from the Texture category.
3. Keep the default `Cell Size: 16`, `Glyph Size: 0.9x`, `Contrast: 0.6`,
   `Brightness: 1`, `Density Bias: 0`, `Invert: off`, `Mix: 1` for a visible
   ASCII mosaic on insert.
4. Increase **Cell Size** for readable poster glyphs; lower it for denser text
   texture.
5. Raise **Density Bias** when the ramp should choose heavier glyphs more often.
6. Toggle **Invert density ramp** when dark source cells should become denser
   glyphs instead of lighter cells.

## What A Reviewer Should Verify

1. Adding the node from the palette inserts an `ascii-glyph` node and the canvas
   shows recognizable 5x7 glyph cells, not just square pixels.
2. Cell Size stays stable in artboard space while scrubbing parameters.
3. Glyph Size changes the glyph footprint without changing cell pitch.
4. Contrast, Brightness, Density Bias, Invert, and Mix produce monotonic,
   understandable changes.
5. Static SVG/PDF and Worker SVG output do not pretend the node is native;
   fidelity metadata should identify the node as deferred/omitted.

## Verification Performed

Initial handoff skipped test-like verification under the repository rule. QA
continuation on 2026-07-02 ran `bun run check`, `bun run test`,
`bun run build`, `bun run check:bundle`, and a Playwright editor smoke that
opened the Look Graph workspace, inserted **Halftone**, and confirmed **Glyph
Mosaic** is searchable. A source-level SVG export smoke confirmed GPU-deferred
frame Look graphs now emit `vec-core-recipe-svg-unsupported` with
`local-raster-required` instead of dropping silently.

A live pixel pass on 2026-07-02 rendered the node against a black→white
gradient chart and found the density ramp was **not monotonic**: the bitmaps
were ordered by the conventional ASCII ramp " .:-=+*#%@", but this 5x7 '%'
lights only 8 of 35 pixels — sparser than '=' and '+' — so a visibly brighter
band appeared between '#' and '@'. The ramp is now ordered by measured lit
pixels (" .:-%+=*#@") and '@' is drawn as a closed ring (24 lit) so the top
band out-covers '#'. Acceptance was numeric: per-tone-band mean luminance
across the gradient is strictly increasing ([0, 12, 24, 32, 44, 57, 60, 102,
106, 139]). The same pass verified glyph cells render upright after the
GPU-surface presentation-flip fix (`docs/look-effects-pack-handoff.md` §6,
bug 3). Cell sampling was upgraded to a 4x4 area average (tone fidelity +
video stability), live-verified on real footage 2026-07-02 on branch
`feat/dither-quality-pass`.

The implementation was planned by six expert lenses plus an orchestrator-director
synthesis. The panel converged on a narrow GPU-deferred node using a fixed
procedural ASCII ramp. Broader glyph sets, Japanese glyphs, font selection, and
external atlases were intentionally excluded because they require a separate
charset/font/atlas contract.

## What Is Still Intentionally Limited

- **Not native to static SVG/PDF/Worker SVG.** This is a deferred GPU effect.
  Static vector surfaces should omit it with fidelity metadata rather than
  approximating it.
- **No arbitrary text or editable typography.** This is an image effect, not a
  text layer.
- **No external font or uploaded atlas.** V1 uses a fixed procedural 5x7 ASCII
  density ramp inside the shader.
- **No Japanese/CJK glyph set.** That needs font availability, atlas size,
  fallback, and shaping decisions before it can be honest.
- **No custom palette inside the node.** Chain **Color Map** or **Posterize**
  when color styling is needed.
- **No dedicated mask texture in the GPU pass.** The node exposes only image
  input/output, avoiding a fake mask contract until GPU mask input exists.

## Related Docs

- [Ordered Dither Look node](./ordered-dither-look-node.md)
- [Pixel Grid Look node](./pixel-grid-look-node.md)
- [Halftone Look node](./halftone-look-node.md)
- [Scanline / CRT Look node](./scanline-crt-look-node.md)
- [Motion / Code WebGL runtime](./webgl-player-export.md)
