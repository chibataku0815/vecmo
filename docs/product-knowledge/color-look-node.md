# Color Look (Gradient Map / Duotone) Look Node

Date: 2026-06-25.
Status: `beta` (inherits the Look graph authoring surface, which is beta/internal).

## Summary

The Look graph gains a `color-map` effect node — a **gradient map / duotone**: it
collapses the image to luminance and remaps that luminance onto a two- or
three-stop colour ramp (shadows → optional midtones → highlights). This is the
most recognisable, most preset-able "look" layer — Spotify-style duotones,
risograph, thermal, and cinematic teal/orange tone maps all come from it. It is
the first consumer of the `component-transfer` `table` mode (Posterize used
`discrete`), and renders at full (`native`) SVG fidelity.

## What Changed?

- New authorable Look node kind `color-map`, an ordinary effect node (image +
  optional mask in, image out) that composes like grade/glow/grain/blur.
- Parameters: **Shadows**, **Midtones** (optional — clearing it makes a pure
  duotone), and **Highlights** colours, plus a **Mix** scalar (0–1) blending the
  mapped result over the original.
- Compiles to three standard SVG primitives, all in `sRGB` so the tone map is
  perceptual rather than washed in the linear-RGB filter default:
  1. `feColorMatrix` → Rec. 709 luminance (alpha preserved);
  2. `feComponentTransfer` with a per-channel `table` built from the ramp stops
     (the `table` mode interpolates luminance across the colours);
  3. `feComposite operator="arithmetic"` lerp `mix·mapped + (1-mix)·original`.

## What Can The User Do Now?

In the docked Look Graph workspace, add a **Color Look** node, then pick the
shadow / midtone / highlight colours and scrub **Mix**. Clearing the midtone
gives a clean two-colour duotone; setting it gives a tritone ramp. The node can be
gated by a Mask node and combined with other nodes like any effect node.

## How Does The User Operate It?

Add a **Color Look** node in the Look graph. Its colours are edited through the
standard popover colour picker; **Mix** is a live slider. Agents/MCP reach it like
every Look node: it appears in the discovery node-kind catalog, is created with
the generic `add-node` operation (its colours/mix set in the node payload), and
**Mix** is keyframable through `motion/upsert-look-node-keyframe` (paramKey
`mix`) — so a Color Look can fade in over time.

## What Should A Reviewer Verify?

- `bun run check` is green; `effect-filter.test.ts` pins the ramp-table math
  (per-channel stops, two-stop duotone vs three-stop tritone, the arithmetic
  `mix`/`1-mix` lerp, mix clamping, sRGB). `look-graph-compile.test.ts` pins the
  native compile (luminance → ramp → lerp folded over the source, not a
  passthrough). `presentation.test.ts` pins the animated **Mix** per frame with an
  unmutated base.
- In the browser (milestone smoke): a Color Look node visibly recolours the
  artboard into the chosen ramp; changing colours/Mix updates live; SVG export
  reproduces it.

## What Is Still Limited?

- **Luminance map only** — the ramp is keyed on Rec. 709 luminance; per-channel or
  custom-curve mapping is out of scope (that needs the escalated curve/LUT value
  type, not a node scalar).
- **Mix is the animatable scalar; the ramp colours are static** — keyframes drive
  numeric params, so the look fades via Mix rather than by animating the colours.
- Ramp stops are evenly spaced (0 / 0.5 / 1); arbitrary stop positions are out of
  scope for this slice.
