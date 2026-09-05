# Canvas Artboard Look Plan

Date: 2026-07-03.
Status: internal.

## Summary

CanvasShell now builds artboard frame-look and scoped-look derived data through
`src/widgets/canvas-shell/model/artboard-look-plan.ts`. This is an internal
architecture refactor only: it does not change canvas authoring behavior, frame
Look rendering, native mask behavior, export output, playback, or public copy.

## What Changed?

- The pure artboard rendering plan now lives in
  `buildArtboardLookPlan(...)`: matte node/bounds maps, frame and scoped
  influence mask plans, SVG filter and mask ids, native mask defs for the
  artboard, frame/scoped grain and chromatic-aberration params, content regions,
  selection-matte exclusion sets, and grid/film overlay flags.
- `CanvasShell.tsx` still owns React JSX mapping, refs, pointer context,
  store reads, per-node render wrappers, and all event handling. The helper
  returns data only; it does not render nodes or mutate editor state.
- Artboard SVG id sanitization was moved with the helper and re-used by
  CanvasShell for existing non-plan ids so DOM id strings stay stable.

## Why It Matters

The canvas artboard render memo had accumulated deterministic Look/mask planning
alongside JSX rendering closures. Moving the data derivation into a model helper
makes the boundary clearer: CanvasShell composes and renders, while the model
helper describes what needs to be rendered for each artboard.
