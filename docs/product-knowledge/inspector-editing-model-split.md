# Inspector Editing Model Split

Date: 2026-07-03.
Status: internal.

## Summary

`src/widgets/inspector/model/editing.ts` had grown to ~6,142 lines aggregating
every inspector editing domain (paint/gradient/mesh/image-fit, node shadow/blur,
frame Look/graph + Analog Film + frame effect influence, Noise Gradient particle
dissolve, typography/corner-radius/star-polygon, and artboard CRUD) in one file —
a merge-conflict magnet. This is an internal architecture fix: it does not add,
remove, or change any inspector authoring, selector, or command-bus behavior.

## What Changed?

- The single file was split into 7 modules under
  `src/widgets/inspector/model/`: `editing-shared.ts` (transaction/command-bus
  primitives, cross-domain types, generic selector/normalizer helpers),
  `paint-editing.ts`, `shadow-blur-editing.ts`, `frame-look-editing.ts`,
  `noise-gradient-editing.ts`, `typography-editing.ts`, `artboard-editing.ts`,
  plus a small `frame-look-shared.ts` holding two helpers
  (`recipeForNode`/`nodeIdsByArtboard`) shared only between the frame-look and
  Noise Gradient modules.
- `editing.ts` itself became a barrel (`export * from "./<module>"` for each of
  the 7 domain files), so every existing `@/widgets/inspector/model/editing`
  import (`InspectorPanel.tsx`, `CodeableSection.tsx`, `FloatingInspector.tsx`)
  keeps working with zero changes to those consumer files.
- Every function body was moved verbatim (pure move, no logic edits); a
  byte-for-byte reconstruction check confirmed the concatenation of the split
  files' declarations reproduces the original file's declaration region
  identically. Helpers that were private in the monolith but used across the
  new file boundary (e.g. `uniqueNodeIds`, `applyCommandsAsTransaction`,
  `shadowForNode`) gained an `export` keyword in `editing-shared.ts` purely so
  sibling domain modules can import them — they are not part of the intentional
  public inspector API and were not previously reachable from outside the file
  either.
- Feature-Sliced import direction is preserved: domain files import only from
  `editing-shared.ts` (and `frame-look-shared.ts` where relevant) and external
  entity/feature modules, never from each other, so there are no
  domain-to-domain imports and no cycles.

## Why?

`docs/architecture-responsibility-improvement-plan.md` already flagged this file
as a "Large cross-cutting edit model with scene and motion behavior mixed into
one API." Splitting it by domain makes future inspector work (e.g. a paint-only
change) touch a ~1,000–1,500-line file instead of the full ~6,000-line one,
reducing merge-conflict surface across parallel inspector streams.
