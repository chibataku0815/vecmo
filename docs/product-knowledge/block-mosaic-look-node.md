# Block Mosaic Look Node

Date: 2026-07-01.
Status: beta - Display/Pixel/Print Look effects pack continuation.

## Summary

The Look graph gains a new node kind, `block-mosaic`: a GPU raster-finish raised
tile reconstruction effect. It samples the source once per stable cell, adds
dark grout gaps, bevel/relief shading, directional light, subtle per-cell
variation, and blends the result over the original image.

This is the honest Lego / voxel / block-reconstruction slice for the pack. It is
not SVG-native: the visual depends on raster-space cell sampling and fragment
lighting, so static SVG/PDF and Worker SVG output should report it as
deferred/omitted rather than approximating it.

## What Users Can Do Now

- Add **Block Mosaic** from the Look workspace Texture category.
- Control **Cell Size**, **Gap**, **Bevel**, **Relief**, **Light Angle**,
  **Light Elevation**, **Contrast**, **Variation**, and **Mix**.
- Chain it with Halftone, Pixel Grid, Ordered Dither, Glyph Mosaic, or Deep Glow
  on the GPU raster surface.
- Use it as a Texture node/search result for tactile block treatments; the first
  Display/Print starter set deliberately keeps Block Mosaic out of the default
  Starter list so the first screen stays focused on the most general print,
  display, and glyph looks.
- Agent/MCP clients can discover the node's image ports and typed payload params
  through `list_look_node_capabilities`, then add or update it with
  `scene/patch-look-graph`.
- Keep effects open: this node is not Pro-gated. Pro value remains cloud/publish
  continuity, not effect availability.

## Implementation Notes

- Scene payload kind: `block-mosaic`.
- Rendering tier: GPU raster-finish through `src/shared/gpu-lens/surface.ts`.
- Static compile tier: no SVG primitives; pass through with deferred fidelity
  metadata.
- Runtime bundles were regenerated so Motion / Code WebGL player output knows
  the `block-mosaic` shader mode.

## Verification Performed

The runtime sampler and WebGL player generators were run after adding the shader.
Initial handoff skipped test-like verification under the repository rule. QA
continuation on 2026-07-02 ran `bun run check`, `bun run test`,
`bun run build`, `bun run check:bundle`, and a Playwright editor smoke that
opened the Look Graph workspace, inserted **Halftone**, and confirmed **Block
Mosaic** is searchable. A source-level SVG export smoke confirmed GPU-deferred
frame Look graphs now emit `vec-core-recipe-svg-unsupported` with
`local-raster-required` instead of dropping silently.

A live pixel pass on 2026-07-02 rendered the node on an asymmetric QA chart:
stable tile faces with dark grout, per-tile color sampling (patches read as
colored tile fields), subtle bevel/relief shading and per-tile variation, and
the result is upright after the GPU-surface presentation-flip fix
(`docs/look-effects-pack-handoff.md` §6, bug 3). The WebM recording path now
composes frames offscreen so a slow frame can no longer ship SVG-only
intermediate states (§6, bug 5). Cell sampling was upgraded to a 4x4 area
average (tone fidelity + video stability), live-verified on real footage
2026-07-02 on branch `feat/dither-quality-pass`.

## What Is Still Intentionally Limited

- **Not native to static SVG/PDF/Worker SVG.** This is a deferred GPU effect.
- **Not true 3D geometry.** V1 is a fragment-shaded 2D relief reconstruction,
  not meshes, voxels, or individual editable blocks.
- **Not a brand-specific brick system.** The node deliberately avoids Lego
  naming, studs, snapping, or part libraries.
- **No asset/shape library.** It does not expose per-block materials or custom
  brick shapes yet.

## Related Docs

- [Pixel Grid Look node](./pixel-grid-look-node.md)
- [Glyph Mosaic Look node](./ascii-glyph-look-node.md)
- [Ordered Dither Look node](./ordered-dither-look-node.md)
- [Commercial packaging strategy](./commercial-packaging-strategy.md)
