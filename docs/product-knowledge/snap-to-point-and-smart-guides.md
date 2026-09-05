# Snap to Point and Smart Guides

Date: 2026-06-23.
Status: shipped (grid/snap unification — point-snap restored, grid made
full-screen, "what you see is what you snap to").

## Summary

Grid, guides, and point snapping are now **one coordinate system**: the grid you
SEE is the grid you SNAP to, across the whole canvas. There are two snap
behaviors, exposed as independent toggles in the View command group:

- **Smart guides** (`⌘U`): while dragging a selection, its bounding box edges and
  centers align to candidate lines — artboard edges/center, other objects'
  edges/centers, **grid lines anywhere on the pasteboard**, and user guide lines.
  Winning alignments draw a guide line, like Illustrator/Figma.
- **Snap to point**: while moving, resizing, or drawing, the dragged point
  hard-locks in both axes onto the single nearest **real shape vertex**
  (rectangle corners, ellipse quadrants, line endpoints, polygon/star points, path
  Bézier anchors, including nested-group members) **or grid intersection**. The
  active-snap glyph names the target: a hollow square for a vertex, a hollow
  diamond for a grid crossing.

Both default ON and are remembered across reloads.

This restored a capability that had been implemented and shipped, then **removed
by accident** — a `chore: checkpoint` commit deleted the vertex-snap engine and
its wiring, and that revert reached main. Snap to point was gone and the two
behaviors were no longer coordinated.

## Full-Screen Grid (What You See Is What You Snap To)

The grid was three disconnected systems (an 8px grid clipped to the artboard, a
separate 80px desk grid, and yet another clamped grid for snapping), so the lines
you saw were not guaranteed to be the lines you snapped to, and nothing worked
beyond the artboard. Now a single base spacing (8px, with a heavier 64px **major**
line every 8th) drives the on-card grid, the surrounding desk grid, and the snap
candidates — all phased to the **active artboard's origin**, so the desk grid
continues the artboard grid seamlessly and the artboard corner always sits on a
grid line. Zooming out fades the fine grid down to the 64px major lattice (and the
snap targets thin with it), so you never snap to a line too dense to see.

## Why Two Toggles Instead of Grid Visibility

Previously snapping was gated on `gridVisible || guideLinesVisible`, so **hiding
the grid silently turned snapping off**. Snap behavior is now its own preference,
fully decoupled from what is drawn. Hiding the grid no longer disables snapping;
grid and guide-line *candidates* are still gated by their own visibility (you
cannot snap to a line you cannot see), while artboard, object, and vertex
candidates are always available when the matching toggle is on.

## What Users Can Do Now

- Drag an object's corner onto another shape's corner/anchor — or onto a grid
  crossing — and have it lock exactly onto that point (Snap to point). Resize
  handles lock the same way (Figma parity).
- See the full-screen grid extend past the artboard across the whole canvas, with
  the artboard corner on a grid line and a 64px major cadence for readability.
- Drag a selection and have its edges/centers align to artboard, objects, grid
  lines (anywhere on the pasteboard), and guides with a visible alignment guide
  (Smart guides).
- Toggle either behavior independently from the command palette (`⌘K` → "snap" or
  "smart guides"), the canvas right-click View group, or `⌘U` for Smart guides.
- Hold the axis-lock modifier while moving to constrain to one axis; snapping
  respects the lock and never reintroduces movement on the constrained axis.

## How To Use

1. Open the editor.
2. Press `⌘U` to toggle Smart guides; use `⌘K` → "Snap to point" to toggle point
   snapping. A check appears next to each when enabled.
3. Move a shape near another shape's vertex — it locks onto the point.
4. Move a shape so an edge lines up with another object/artboard — an alignment
   guide appears and the box snaps.

## What A Reviewer Should Verify

- With the grid hidden, dragging still snaps to vertices and to object/artboard
  edges (snapping is decoupled from grid visibility).
- Snap to point lands exactly on a real anchor (both axes from one point), not a
  per-axis split that misses the vertex.
- When point snapping finds no anchor within the magnet radius, the move falls
  through to smart-guide bounding-box snapping rather than to a raw, unsnapped
  position (precedence is fall-through, not exclusive).
- Each drag remains a single undo step.
- `⌘U` toggles Smart guides; the inline text-edit `⌘U` (underline) and the bare
  `U` mesh tool are unaffected.
- Toggles persist across reload.

## What A Reviewer Should Also Verify (Grid)

- The fine grid extends past the artboard across the whole desk, and the on-card
  grid and the desk grid line up exactly at the artboard edge (one seamless
  lattice). The artboard's left/top edge sits on a grid line.
- Dragging an object past the artboard edge still snaps to the grid out on the
  pasteboard (snap is not clipped to the artboard).
- With the grid **hidden**, nothing snaps to the grid (lines or intersections),
  but vertex, object, artboard, and guide snapping still work.
- Zoomed far out, the fine grid disappears and only the 64px major lattice
  remains; the snap targets thin with it (you never snap to an invisible line).

## Still Intentionally Limited

- **Multi-artboard grid phase**: the continuous grid is phased to the *active*
  artboard's origin. In a multi-artboard document, a non-active artboard whose
  origin is not a multiple of the spacing from the active one will have an on-card
  grid that does not perfectly continue the desk grid. The single-artboard case
  (the common one) is always seamless. Per-artboard grid phase is a future option.
- **Configurable grid size**: the base spacing is a fixed 8px (with a 64px major
  cadence). A user-settable document grid size is a possible future addition.

## Note For Maintainers

- The vertex engine is `src/entities/scene/model/vertex-snap.ts`
  (`collectVertexAnchors`, pure, artboard-local, gesture-cacheable). The 2D
  point-lock and bounding-box smart-guide math are in `src/shared/lib/snapping.ts`
  (`snapToNearestPoint`, `snapBoundingBox`). The selection wrapper is
  `snapSelectionBboxToGuides` in `src/entities/guides/model/snapping.ts`.
- Snap preferences live in `src/entities/guides/model/store.ts` as the `snap`
  slice (`smartGuides`, `snapToPoint`), persisted on a dedicated key separate from
  view preferences.
- The grid is one model: `BASE_GRID_SPACING` / `GRID_MAJOR_EVERY` /
  `gridLineDensity` in `src/entities/guides/model/snapping.ts` drive the visible
  desk grid (`collectWorkspaceGridLines`, with an `offset` = active artboard
  origin), the on-card grid (`collectArtboardGridLines`), and the snap candidates
  (`collectGridIntersectionsNear` for 2D, `collectGridLineCandidatesNear` for 1D,
  spacing chosen by `visibleGridSpacing`). The desk grid is rendered behind the
  artboard card (occluded inside it) while the on-card grid draws the same lattice
  on the card — keep BOTH render sites so the card fill never hides the grid.
- Grid snap candidates are generated **locally** around the cursor/box (not the
  whole pasteboard), in artboard-local space (lattice phase 0), so the grid snaps
  everywhere without enumerating an unbounded lattice. Grid candidates are gated on
  `gridVisible`, so a hidden grid is never a snap target.
- Move/draw composition is fall-through: 2D point lock returns only inside
  `if (lock.snapped)`; otherwise it falls through to bounding-box guide snapping,
  then to the raw point. Converting this to if/else would kill guide snapping
  whenever point snapping is on.
- To prevent another accidental loss, the restored `vertex-snap.test.ts`,
  `snapping.test.ts`, and handler tests assert the engine; `check:tests` flags raw
  deletions.
