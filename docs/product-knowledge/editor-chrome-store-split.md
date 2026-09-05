# Editor Chrome Store Split

Date: 2026-07-03.
Status: internal.

## Summary

Editor chrome state is owned by `src/shared/editor-chrome/model/store.ts`.
This includes panel visibility, dialog flags, docked workspace state, and
persisted panel dimensions. Shared panel resize wiring lives beside it in
`src/shared/editor-chrome/model/use-panel-resize.ts`.

Tool selection remains in `src/features/tool-selection/model/store.ts` as
`useToolSelectionStore`, limited to the active tool and its setter. Widgets
that need both active-tool and chrome state import both stores explicitly.

This is an architecture-only refactor. It does not change editor behavior,
authoring controls, export output, or user-facing product copy.
