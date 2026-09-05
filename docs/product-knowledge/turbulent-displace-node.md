# Turbulent Displace Look Node

Date: 2026-06-25.
Status: `beta` (inherits the Look graph authoring surface, which is beta/internal).

## Summary

The Look graph gains a `displace` (Turbulent Displace) effect node: it warps its
image input with a procedural fractal-noise field, the classic "organic wobble"
move. It is built entirely on existing infrastructure — a `feTurbulence` field
drives a `feDisplacementMap` — so it previews live on the editor canvas and
exports through SVG at full (`native`) fidelity, with no new rendering engine.

## What Changed?

- New authorable Look node kind `displace`, labeled **Turbulent Displace**. It is
  an ordinary effect node (image input + optional mask, image output), so it
  composes in a chain or under a mask exactly like grade/glow/grain/blur/fringe.
- Three parameters, editable as live sliders: **Amount** (`scale`, peak
  displacement in px), **Frequency** (noise base frequency; smaller = broader
  swirls), **Complexity** (`octaves`, fractal detail, 1–5).
- The compiler lowers it to `feTurbulence` → `feDisplacementMap` (R drives X, G
  drives Y); the filter region is padded by `scale/2` so the warp never clips.

## What Can The User Do Now?

In the Frame Look graph editor or the docked Look Graph workspace, add a Turbulent
Displace node to a frame/scene look and scrub Amount / Frequency / Complexity to
warp the artboard contents. It can be gated by a Mask node (warp only part of the
frame) and combined with other nodes through the graph.

## How Does The User Operate It?

Open the Frame Look section (nothing selected) or the Look Graph workspace,
materialize/extend the graph, add a **Displace** node, and drag its sliders.
Agents/MCP reach it the same way every Look node is reached: it appears in the
node-kind catalog returned by look-graph discovery (`read-only.ts`), is created
with the generic `add-node` graph operation, and its parameters are set with the
node-number update command — one undoable edit each.

## What Should A Reviewer Verify?

- `bun run check` is green; `look-graph-compile.test.ts` proves a
  `Source → displace → Output` graph compiles to a turbulence-fed displacement
  whose output is the warped pixel (not a passthrough of the source) and reports
  `native` fidelity.
- In the browser (milestone smoke): adding a Displace node visibly warps the
  artboard; Amount/Frequency/Complexity change the warp; a feathered Mask scopes
  it; SVG export reproduces the warp.

## What Is Still Limited?

- **Not animatable.** Like the existing `blur` and `chromatic-fringe` graph
  nodes, a Displace node's parameters are statically authored — there is no path
  yet to keyframe a graph-node parameter (e.g. animate the noise to "evolve").
  Animated evolution is the higher-value half and waits on a shared graph-node
  animation surface, not on this node.
- The noise `seed` is fixed for determinism (no per-node seed/phase control yet).
- `octaves` is capped at 5 (higher is costly for little visible gain).
- This is a self-contained node (it owns its internal noise); a separate,
  reusable noise **source** node feeding multiple consumers is a later slice.
