# Ordered Dither Look Node

Date: 2026-07-01.
Status: beta - fourth production slice of the Display/Pixel/Print Look effects
pack.

## Summary

The Look graph gains a new node kind, `ordered-dither`: a GPU raster-finish
threshold-dither effect with two selectable patterns. **Organic** (the
default) samples the source against an embedded 64x64 void-and-cluster
blue-noise threshold tile, producing organic, error-diffusion-class grain.
**Bayer** samples against a true 2x2, 4x4, or 8x8 ordered threshold lattice,
producing a controlled print/screen dither. Both modes output a duotone ramp
between authored Ink and Paper colors in Luminance mode.

This is the honest continuation of the Bayer idea rejected in wave 1. The
rejected version tried to fake ordered dither with procedural noise in native
SVG. This implementation does not do that: both patterns are deterministic
threshold lookups (a tile texture for Organic, a lattice for Bayer), deferred
to the WebGL raster surface just like `halftone` and `pixel-grid`. Organic was
chosen over true error-diffusion (Floyd-Steinberg/Atkinson) because a
threshold lookup is GPU-parallel and temporally stable on video, where
scan-order error diffusion crawls frame to frame.

Like the other GPU raster-finish nodes, this node is **not SVG-native**. Static
SVG/PDF and Worker SVG output should report the node as deferred/omitted rather
than overclaiming native fidelity.

## What Users Can Do Now

- Add **Ordered Dither** from the Look workspace node palette in the Texture
  category (search "dither", "bayer", "ordered", "threshold", "matrix",
  "print", "retro", "pixel", "1-bit", "monochrome", or "halftone").
- Control nine sliders:
  - **Cell Size** - coarser vs. finer dither cells, in artboard pixels / scene
    units.
  - **Matrix Size** - Bayer lattice size, normalized to 2x2, 4x4, or 8x8 (only
    affects the Bayer pattern).
  - **Levels** - output quantization levels, from 2 to 8.
  - **Brightness** - exposure offset applied before thresholding, -1 to 1.
  - **Gamma** - midtone curve applied before thresholding, 0.25 to 2.5.
  - **Contrast** - tonal steepness before thresholding.
  - **Threshold** - global darker/lighter threshold bias.
  - **Strength** - how strongly the dither pattern modulates quantization.
  - **Mix** - blend the dither result over the original image.
- Switch **Pattern** between **Organic** (default blue-noise grain) and
  **Bayer** (ordered lattice) from the selected node controls.
- Switch **Mode** between **Luminance** and **RGB channels** from the selected
  node controls.
- Pick **Ink** and **Paper** colors (hex, default `#000000`/`#ffffff`) for a
  built-in, chain-free duotone ramp in Luminance mode - no Color Map node
  required for a simple two-color print/screen look. Ink/Paper only apply to
  Luminance mode; RGB mode quantizes per-channel and ignores them.
- Agent/MCP clients can discover the node's image ports and typed payload params
  through `list_look_node_capabilities`, then add or update it with
  `scene/patch-look-graph`.
- Chain **Color Map** before or after Ordered Dither when a richer multi-stop
  or non-linear palette is needed beyond the built-in two-color duotone.
- Keep effects open: this node is not Pro-gated. Pro value remains cloud/publish
  continuity, not effect availability.

## How To Use

1. Open the Look workspace for the target frame/artboard Look graph.
2. Add **Ordered Dither** from the Texture category.
3. Keep the default `Pattern: Organic`, `Cell Size: 4`, `Levels: 2`,
   `Mode: Luminance`, `Contrast: 0.55`, `Threshold: 0.5`, `Strength: 1`,
   `Mix: 1` for a visible one-bit organic blue-noise dither.
4. Switch **Pattern** to **Bayer** for a regular ordered lattice instead of
   organic grain; **Matrix Size** then chooses 2x2 for coarse checker
   structure, 4x4 for the default ordered print feel, or 8x8 for a finer
   lattice.
5. Increase **Cell Size** for chunky poster dither; lower it for finer print
   texture.
6. Increase **Levels** for multi-tone posterization instead of strict one-bit
   output.
7. Switch **Mode** to RGB channels when preserving color quantization matters.
8. Nudge **Brightness** and **Gamma** to shift where midtones fall before
   thresholding, without touching **Contrast**.
9. For a risograph/vintage-print duotone, keep `Mode: Luminance` and set
   **Ink** to `#1a1633` (navy) and **Paper** to `#f2e8d5` (cream) - the node
   outputs a two-color ramp between them instead of black/white. As a
   frame-level effect, the whole artboard becomes the paper color.

## What A Reviewer Should Verify

1. Adding the node from the palette inserts an `ordered-dither` node and the
   canvas shows a visible dither (organic grain by default; switch Pattern to
   Bayer for a repeating lattice) - not random unpatterned noise.
2. Switching Pattern between Organic and Bayer visibly changes the dither
   texture; Matrix Size then visibly changes the repeated threshold pattern
   between 2x2, 4x4, and 8x8 in Bayer mode only.
3. Cell Size stays stable in artboard space while scrubbing parameters.
4. Levels, Brightness, Gamma, Contrast, Threshold, Strength, Mix, and Mode
   produce monotonic, understandable changes.
5. Setting Ink/Paper in Luminance mode produces a controlled two-color duotone
   without adding a Color Map node; chaining Color Map still works for richer
   palettes.
6. Static SVG/PDF and Worker SVG output do not pretend the node is native;
   fidelity metadata should identify the node as deferred/omitted.

## Verification Performed

Initial handoff skipped test-like verification under the repository rule. QA
continuation on 2026-07-02 ran `bun run check`, `bun run test`,
`bun run build`, `bun run check:bundle`, and a Playwright editor smoke that
opened the Look Graph workspace, inserted **Halftone**, and confirmed
**Ordered Dither** is searchable. A source-level SVG export smoke confirmed
GPU-deferred frame Look graphs now emit `vec-core-recipe-svg-unsupported` with
`local-raster-required` instead of dropping silently.

A live pixel pass on 2026-07-02 rendered the node on a black→white gradient
chart: the output is a regular, periodic Bayer lattice (recognizable
dispersed-dot crosshatch bands, not stochastic noise), the luminance mode
produces the ink-paper ramp, and the result is upright after the GPU-surface
presentation-flip fix (`docs/look-effects-pack-handoff.md` §6, bug 3). The
WebM recording path now composes frames offscreen so a slow frame can no
longer ship SVG-only intermediate states (§6, bug 5).

A dither-quality pass on 2026-07-02, branch `feat/dither-quality-pass`,
verified the Organic pattern, duotone, and tone-pipeline additions on real
Artlist footage in the editor, a recorded WebM, and the exported WebGL
player: on backlit-portrait and veil/jewelry 720p H.264 clips, the Organic
pattern reads as organic error-diffusion-class grain with no Bayer
crosshatch; a navy/cream duotone bakes correctly into the recorded WebM
(frame-extracted - the grain lattice stays screen-fixed while content flows
underneath, with no crawl, confirming the tile-lookup approach holds up on
video where scan-order error diffusion would not); the exported player mounts
and seeks with the look applied; Bayer mode is visually unchanged from the
prior release; and Brightness/Gamma respond monotonically. Static gates and
tests were NOT run for this pass (standing rule - not requested).

The implementation was planned by six expert lenses plus an orchestrator-director
synthesis. Product, domain-model, rendering/performance, and implementation
architecture lenses all chose Ordered Dither as the best next product-quality
slice after Pixel Grid. The editor-UX lens preferred ASCII/Glyph for novelty,
and the verification lens preferred productizing existing Duotone for safety;
the orchestrator chose Ordered Dither because it fills the pack's named dither
gap with a real renderer contract while ASCII still needs a glyph atlas and font
contract.

## What Is Still Intentionally Limited

- **Not native to static SVG/PDF/Worker SVG.** This is a deferred GPU effect.
  Static vector surfaces should omit it with fidelity metadata rather than
  approximating it.
- **No true error diffusion.** Floyd-Steinberg/Atkinson-style scan-order error
  diffusion is not built; `"error-diffusion"` is reserved in the pattern
  vocabulary for a future implementation. Organic (blue-noise) is a
  texture-lookup approximation of that grain quality, chosen because it is
  GPU-parallel and temporally stable on video.
- **Ink/Paper apply to Luminance mode only.** RGB mode quantizes each color
  channel independently and ignores the Ink/Paper colors. Chain **Color Map**
  or **Posterize** when color styling beyond a two-color duotone is needed.
- **Documents saved before the Pattern control keep rendering as Bayer.**
  Pre-pattern payloads normalize to `bayer` deliberately (that is exactly what
  they rendered before), so opening an old document never silently changes
  its look; the Organic default applies to newly added nodes.
- **No glyph/ASCII mapping.** That remains a separate atlas/charset/font
  contract.
- **No dedicated mask texture in the GPU pass.** The node exposes only image
  input/output, avoiding a fake mask contract until GPU mask input exists.

## Related Docs

- [Pixel Grid Look node](./pixel-grid-look-node.md)
- [Halftone Look node](./halftone-look-node.md)
- [Scanline / CRT Look node](./scanline-crt-look-node.md)
- [Commercial packaging strategy](./commercial-packaging-strategy.md)
- [Motion / Code WebGL runtime](./webgl-player-export.md)
