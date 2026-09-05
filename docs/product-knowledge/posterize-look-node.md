# Posterize Look Node

Date: 2026-06-25.
Status: `beta` (inherits the Look graph authoring surface, which is beta/internal).

## Summary

The Look graph gains a `posterize` effect node: it quantizes each RGB channel to
a small number of evenly-spaced tone bands, the classic flat poster / screen-print
look. It is the first consumer of the `component-transfer` filter primitive added
in the Wave 0 foundation, and renders at full (`native`) SVG fidelity.

## What Changed?

- New authorable Look node kind `posterize`, an ordinary effect node (image +
  optional mask in, image out) that composes like grade/glow/grain/blur.
- One parameter, **Levels** (2–16 bands, default 5), edited as a live slider.
- Compiles to a single `feComponentTransfer` with a `discrete` table
  `[0, 1/(N-1), …, 1]` on R/G/B (alpha untouched), so 2 levels is a hard tonal
  threshold and higher levels give progressively smoother banding.

## What Can The User Do Now?

In the Frame Look graph editor or the docked Look Graph workspace, add a Posterize
node and scrub Levels to flatten the artboard's tones into bands. It can be gated
by a Mask node and combined with other nodes.

## How Does The User Operate It?

Add a **Posterize** node in the Look graph and drag its Levels slider.
Agents/MCP reach it like every Look node: it appears in the discovery node-kind
catalog, is created with the generic `add-node` operation, and Levels is set with
the node-number update command — one undoable edit each.

## What Should A Reviewer Verify?

- `bun run check` is green; `effect-filter.test.ts` pins the discrete-band table
  math (3 levels → `[0, 0.5, 1]`, sub-2 clamps to a binary `[0, 1]`, alpha
  untouched). The compile path is the shared effect-node path already covered by
  `look-graph-compile.test.ts`.
- In the browser (milestone smoke): a Posterize node visibly bands the artboard
  tones; Levels changes the band count; SVG export reproduces it.

## What Is Still Limited?

- **Not animatable** — like the other non-projectable graph nodes (blur,
  chromatic-fringe, displace), Levels is statically authored; there is no
  graph-node keyframe path yet.
- Bands are evenly spaced and applied per RGB channel; perceptual/luminance
  posterization and custom band positions are out of scope.
