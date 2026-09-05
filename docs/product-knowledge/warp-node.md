# Warp (Bulge / Pinch / Twirl) Look Node

Date: 2026-06-25.
Status: `beta` (inherits the Look graph authoring surface, which is beta/internal).

## Summary

The Look graph gains a `warp` effect node: a **radial bulge / pinch** distortion that
makes flat vectors read as dimensional or sucked-in — the first effect in the
"shape-changing" family beyond the existing noise-driven Turbulent Displace. It is
the **first consumer of the new `feImage` filter primitive**: a displacement map is
generated in **pure JavaScript** (no Canvas2D) and painted via `feImage`, then drives
an `feDisplacementMap` over the artboard.

Because the whole effect is standard SVG, it **renders in the editor, in exported
SVG, and in WebM capture alike** (all three verified) — it is NOT a Canvas2D
raster-only pass, and it adds no new render surface and no Cloudflare-Worker risk.

## What Changed?

- New `feImage` `FilterPrimitive` (renderer-agnostic) + both serializers (the string
  exporters and the CanvasShell JSX twin).
- A pure, DOM-free displacement-map generator in `shared/raster-warp` that encodes an
  outward radial direction field (R = horizontal offset from the centre, G = vertical)
  and embeds it as a `data:image/png` URL via the existing Workers-safe PNG encoder.
  Memoized by centre (the strength rides the `feDisplacementMap` scale, so animating
  it never regenerates the map).
- New authorable Look node kind `warp`, an ordinary effect node (image + optional
  mask in, image out) composing like the other Look nodes. A **Mode** selector picks
  the field shape: **Bulge / Pinch** (radial — bipolar strength bulges or pinches)
  or **Twirl** (a tangential swirl around the centre, bipolar = direction). Plus an
  **Amount** strength (bipolar −1..1, 0 = identity) and **Center X / Y** (0..1).
  Amount and centre are keyframable (per-slider keyframe diamond +
  `motion/upsert-look-node-keyframe`), so a bulge can pulse or a twirl can wind up
  over time — genuine living distortion.

## What Can The User Do Now?

In the docked Look Graph workspace, add a **Warp** node and scrub **Bulge / Pinch**
to swell or compress the artboard radially, repositioning the centre as needed.
Keyframing the strength (via the diamond or an agent) animates the warp. The node can
be gated by a Mask node and combined with other nodes. The warp shows on the editor
canvas, in SVG export, and in WebM video export.

## What Should A Reviewer Verify?

- `bun run check` is green; `effect-filter.test.ts` pins the builder (feImage data-URL
  map filling the region via `width="100%"`, bipolar strength → `feDisplacementMap`
  scale, deterministic map per centre). `look-graph-compile.test.ts` pins the native
  compile (feImage → feDisplacementMap over the source, not a passthrough).
- In the browser (milestone smoke): a Warp node visibly bulges/pinches a hard-edged
  artboard; the centre moves it; SVG and WebM export reproduce it.

## What Is Still Limited?

- **Bulge/pinch and twirl ship here as SVG.** A clean spherical fisheye (CC Lens) is
  raster-tier — `feDisplacementMap` folds on a non-monotonic radial map (verified) —
  so it now ships separately as the GPU/WebGL **Lens** Look node (see
  `lens-node.md`), not via this SVG warp. Smooth turbulent **flow-evolution** is also
  genuinely raster-tier (SVG cannot synthesize an evolving noise field — confirmed
  empirically) and is not this.
- **PDF and the Worker SVG renderer** may not apply `feImage` + `feDisplacementMap`
  (the same limitation the existing Turbulent Displace node has); those surfaces
  degrade to the unwarped artboard.
- A square displacement map is stretched to the artboard, so the warp is slightly
  elliptical on extreme aspect ratios; aspect-correct maps are a refinement.
