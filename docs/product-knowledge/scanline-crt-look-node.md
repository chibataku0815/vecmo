# Scanline / CRT Look Node

Date: 2026-07-01.
Status: beta — first production slice of the Display/Pixel/Print Look effects pack.

## Summary

The Look graph gains a new node kind, `scanline`: a CRT-style horizontal-band
overlay with `Density`, `Intensity`, `Softness`, and `Noise Mix` controls. It is
the first node in the display/pixel/print-oriented Look effects pack. Halftone,
Pixel Grid, and Ordered Dither have since landed as GPU-deferred siblings.
Unlike the pack's dot-screen/dither siblings — which need
a true per-pixel spatial pattern and will most plausibly land as GPU
raster-finish nodes, like `lens`/`kaleidoscope`/`flow`/`deep-glow` — scanline is
built entirely from standard SVG filter primitives (`feTurbulence`,
`feColorMatrix`, `feComponentTransfer`, `feBlend`) with **no `feImage` and no
SMIL animation**, so it carries `native` fidelity: it renders identically in the
editor canvas, SVG export, PNG/WebM raster capture, and the Worker's server-side
SVG render.

The line pattern comes from an anisotropic `feTurbulence` field (a near-zero X
frequency against a `Density`-driven Y frequency), so bands read as an organic,
slightly wavering CRT scan rather than a mathematically perfect ruled stripe —
closer to the analog reference than a flat repeating pattern would be.

## What Users Can Do Now

- Add a `Scanline` node from the Look workspace node palette (Texture category;
  search "crt", "tv", "retro", "vhs", "lines", or "pixel").
- Control four sliders in the node's parameter panel:
  - **Density** — scan-band pitch (finer vs. wider bands).
  - **Intensity** — how dark the dim bands get, 0 (invisible) to 1 (black).
  - **Softness** — band edge character, 0 (crisp hard-edged line) to 1 (soft
    glow band).
  - **Noise Mix** — blends a second, finer static/flicker noise field in on top
    of the bands, 0 (clean lines) to 1 (heavy static).
- Wire it anywhere in a frame, artboard, or object Look graph like any other
  effect node — reorder it relative to grade/glow/grain/etc., gate it through a
  `mask` node input, bypass/enable it, or connect it into a `composite` branch.
- See it in exported SVG, exported PNG/WebM stills and video, and the server-
  rendered SVG poster, because it is `native`-tier (unlike the GPU-only
  `lens`/`kaleidoscope`/`flow`/`path-blur`/`noise-source`/`deep-glow` nodes,
  which are editor-canvas/WebM-only today).

## How To Use

1. Open the Look workspace for the target scene/artboard/object.
2. Open the node palette and add **Scanline** (Texture category).
3. Wire its image input from an upstream node (or the source) and its output
   toward Output/Composite, same as any other effect node.
4. Drag **Density** and watch the band pitch change live on the canvas.
5. Drag **Intensity** to darken the bands; drag **Softness** toward 1 for a
   glowing band instead of a hard line.
6. Optionally raise **Noise Mix** for a static/flicker CRT feel.
7. Optionally connect a `mask` node to the Scanline node's mask input to confine
   the effect to part of the frame.

## What A Reviewer Should Verify

1. Adding the node from the palette inserts a working `scanline` node with the
   default payload (`density: 8, intensity: 0.5, softness: 0.15, noiseMix: 0`)
   and the canvas immediately shows visible horizontal banding. (Verified
   live in-browser 2026-07-01: `density: 50` was the original default and
   compiles/renders fine, but at that frequency the band pitch collapses
   below a visible pixel and reads as static/speckle, not scanlines —
   lowered the default to 8 after visual inspection; the 4–240 slider range
   is unchanged, so higher values are still available as a deliberate
   "fine hatching" look, just not the first impression.)
2. Dragging each of the four sliders changes the canvas live, and one scrub
   gesture collapses into a single undo entry (Cmd+Z reverts the whole drag).
3. Toggling the node's enabled/bypass state removes and restores the banding.
4. Rewiring the node before vs. after another effect (e.g. before vs. after
   `grade`) changes the visible result, proving it participates in the graph
   like any other node rather than being hardcoded to one position.
5. Exported SVG (`bun`-driven export or the Worker's SVG render) contains the
   `feTurbulence`/`feColorMatrix`/`feComponentTransfer`/`feBlend` chain in the
   node's `<filter>` and visually matches the editor canvas — no `feImage`, no
   `<animate>`.
6. `bunx tsc -b` is clean (the new `scanline` case is exhaustively handled in
   every discriminated-union switch over `LookGraphNodeKind`).

## Historical Verification Performed

This continuation did not rerun typecheck, browser smoke, export verification,
or a dev server because repository instructions require skipping test-like
verification unless the user explicitly asks for it in the current task.

All six items above were exercised live in a browser (add node → drag each
slider → undo → bypass toggle → reparent before/after `grade` → inspect the
live-rendered `<filter>` DOM for the primitive chain), not just type-checked.
Two real defects surfaced only by looking at rendered pixels, not by `tsc -b`:

- **Alpha-channel bug.** The two generator-side `feColorMatrix` luminance
  collapses initially reused `LUMINANCE_709_MATRIX`, whose alpha row passes
  source alpha through — correct for a transform of a real image (`grade`,
  `color-map`) but wrong for a `feTurbulence` *generator*, whose alpha channel
  is itself noise. The bug: the later `feBlend mode="multiply"` darkened by a
  random, independent alpha field instead of the intended luminance mask.
  Fixed with a dedicated `SCANLINE_LUMA_MATRIX` that forces alpha to 1
  (opaque), mirroring the existing `noiseFieldPrimitives` pattern.
- **`type="turbulence"` doesn't read as bands.** The line-generating
  `feTurbulence` used `type="turbulence"` (absolute-value-folded octaves),
  which skews the luminance distribution away from the threshold's 0.5
  midpoint and produced sparse specks/streaks instead of alternating bands —
  confirmed visually, not obvious from the code. Switching to
  `type="fractalNoise"` (signed octaves, symmetric around the threshold)
  produced clean, continuous, organically-wavering horizontal bands
  immediately. This also surfaced that the default `density: 50` was tuned
  against the broken renderer and was far too fine once bands actually
  rendered (see the verification note above) — lowered to `8`.

## What Is Still Intentionally Limited

- **No curvature/barrel distortion.** The candidate parameter list included
  "curvature" for a full CRT look; that needs a per-pixel UV remap and is GPU
  territory, deferred to a possible future GPU-tier upgrade of this node (same
  escalation pattern as `grain`'s particle-dissolve mode).
- **Not a literal pixel-accurate CRT phosphor simulation.** `Softness` gives a
  glow-like band edge via threshold steepness, not real optical bloom; pair it
  with the existing `deep-glow` node for a stronger halo if needed.
- **PDF export does not carry it.** This is not a regression: PDF export does
  not serialize *any* Look filter effect today (confirmed against `pdf.ts`,
  which never imports the filter serializer) — `grade`, `grain`, `posterize`,
  and every other node share this same PDF ceiling.
- **Ordered/Bayer dither is not SVG-native.** It now exists as the GPU-deferred
  `ordered-dither` node, because a true per-pixel periodic threshold matrix
  cannot be honestly expressed with the currently proven plain SVG filter
  contract.
- **MCP/agent access is catalog-driven, not bespoke.** The node is reachable
  through `list_look_node_capabilities` / `scene/patch-look-graph`; the source
  catalog advertises its image/mask ports plus typed payload params so agents
  can patch `density`, `intensity`, `softness`, and `noiseMix` without importing
  editor UI code.

## Related Docs

- [Effect capability contract](./effect-capability-contract.md)
- [Look node graph workspace plan](../look-node-graph-workspace-plan.md)
