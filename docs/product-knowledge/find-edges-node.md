# Find Edges Look Node

Date: 2026-06-25.
Status: `beta` (inherits the Look graph authoring surface, which is beta/internal).

## Summary

The Look graph gains a `find-edges` effect node: **grayscale edge detection** that
outlines an artboard's luminance discontinuities — the classic graphic outline /
neon-edge / pencil-sketch look. It is the **first consumer of the `convolve-matrix`
filter primitive** added in the Wave 0 foundation, which closes the last unused
Wave 0 primitive, and it renders at full (`native`) SVG fidelity.

This is grayscale (luminance-first) edge detection, **not** After Effects' per-channel
Find Edges — color-emboss-style colored edges would be a future variant.

## What Changed?

- New authorable Look node kind `find-edges`, an ordinary effect node (image +
  optional mask in, image out) that composes like grade/glow/grain/blur.
- Parameters: **Invert** (dark edges on white instead of bright edges on black) and
  a **Mix** scalar (0–1) blending the outline over the original.
- Compiles to standard SVG primitives, all in `sRGB`:
  1. `feColorMatrix` → Rec. 709 luminance (so edges are grayscale, alpha preserved);
  2. `feConvolveMatrix` with the 3×3 Laplacian kernel `[-1 -1 -1; -1 8 -1; -1 -1 -1]`
     and **`preserveAlpha`** — the kernel sums to 0, so without preserving alpha it
     would erase everything off the edges; the divisor is omitted (W3C default 1);
  3. optional `feComponentTransfer` `table [1,0]` invert;
  4. `feComposite operator="arithmetic"` lerp `mix·outline + (1-mix)·original`.

## What Can The User Do Now?

In the docked Look Graph workspace, add a **Find Edges** node, toggle **Invert**,
and scrub **Mix** to fade the outline over the artboard. **Mix** is keyframable —
via the per-slider keyframe diamond (add a key, then scrubbing auto-keys) or
`motion/upsert-look-node-keyframe` — so the outline can animate in. The node can be
gated by a Mask node and combined with other nodes.

## What Should A Reviewer Verify?

- `bun run check` is green; `effect-filter.test.ts` pins the kernel (zero-sum
  Laplacian, `preserveAlpha`, omitted divisor), the invert table `[1,0]`, and the
  `mix` lerp clamp. `look-graph-compile.test.ts` pins the native compile (luminance
  → convolve → composite over the source, not a passthrough).
- In the browser (milestone smoke): a Find Edges node visibly outlines a
  hard-edged artboard (bright edges on black, or dark on white when inverted);
  flat areas stay opaque (proves `preserveAlpha`); SVG export reproduces it.

## What Is Still Limited?

- **Grayscale edges only** — luminance-first; per-channel/color-emboss edges are
  out of scope (a future variant).
- The Laplacian clamps negative lobes to 0, so edges can read thin/one-sided —
  standard SVG edge-detection behavior, not a defect. Directional Sobel magnitude
  is not expressible in a single `feConvolveMatrix`.
- Edge thickness/strength beyond the fixed kernel is not exposed; intensity is
  controlled via **Mix**.
