# Display / Print Look Recipes

Date: 2026-07-01.
Updated: 2026-07-03.
Status: beta - Look Graph recipes with Frame and Object variants.

## Summary

The Look Graph **Looks** palette includes four Display/Print recipes:
**Print Poster**, **LED Glow**, **Glyph Poster**, and **Surveillance Feed**.
Each recipe expands into normal editable Look Graph nodes in one undoable
command; there is no hidden preset state or separate recipe format.

The same recipes are available as **Object** variants. Object variants
create `selection-look-graph` scoped overlays over selected objects; Frame
variants insert the recipe into the active broad graph.

## What Users Can Do Now

- **Print Poster** inserts `color-map -> ordered-dither -> halftone`, tuned for
  ink/paper poster and comic/newsprint looks.
- **LED Glow** inserts `pixel-grid -> deep-glow`, tuned for signage and display
  wall looks.
- **Glyph Poster** inserts `color-map -> ascii-glyph`, tuned for terminal-style
  glyph mosaics.
- **Surveillance Feed** inserts `color-map -> scanline -> pixel-grid`, tuned for
  low-resolution security monitor, night-vision, and camera overlay looks.
- After insertion, every node remains editable, reorderable, keyframable where
  supported, and searchable like manually-added graph nodes.

## Implementation Notes

- Recipe ids: `print-poster`, `led-glow`, `glyph-poster`,
  `surveillance-feed`.
- Frame command path: `createInsertLookGraphStarterCommand` expands starters
  into serial editable nodes and writes through the scene command bus.
- Object command path: `commitSelectionLookGraphRecipe` builds the same
  recipe graph as a `selection-look-graph` scoped overlay over selected objects.
- After an Object variant is applied, the Look Graph workspace targets that
  scoped overlay so the generated nodes are immediately editable.
- Clicking an Object variant that is already **On** removes that recipe from the
  selected objects; **Part** applies it to missing selected objects.
- Active Object variants expose a pencil action to reopen the scoped graph
  without toggling the recipe off.
- Repeated recipe clicks use a per-click operation key so separate user actions
  do not collapse into one undo entry.

## Verification Performed

Initial handoff skipped test-like verification under the repository rule. QA
continuation on 2026-07-02 ran `bun run check`, `bun run test`,
`bun run build`, `bun run check:bundle`, and an editor screenshot smoke; source
smokes confirmed MCP capability params expose `keyframable` in source and
GPU-deferred frame Look SVG export emits deferred fidelity issues instead of
dropping silently. The 2026-07-03 Object variant continuation used readback
and diff review only under the current no-test instruction. Full WebM/runtime
visual verification remains manual.

## Limits

- These are not export-native guarantees. Any recipe containing GPU-deferred
  nodes follows those nodes' existing static SVG/PDF and Worker SVG deferred
  fidelity behavior.
- **Block Mosaic** remains available as a Texture node/search result, but is not
  a Frame Look recipe yet to keep the complete-treatment list focused on the
  broadest print, display, and glyph workflows.
