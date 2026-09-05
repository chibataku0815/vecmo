# Gradient Mesh Shows A Gradient The Moment You Create It

Date: 2026-06-23.
Status: shipped feedback + discoverability fix for the existing gradient-mesh tool.

## Summary

The gradient-mesh tool was already fully functional end to end — activate it,
click a shape, and it gets an editable Coons-patch mesh that renders on canvas and
exports. But creating a mesh **looked like nothing happened**: the new mesh was
seeded with the shape's existing flat fill, so every mesh point was the same color
and the shape was visually identical to its solid fill (only a thin grid overlay
appeared). A user who clicked a solid shape expecting a gradient saw no change and
concluded the feature was broken. The tool was also canvas-only (press `U`, or pick
the grid-tile tool, then click a shape) with no presence in the Inspector, so it
was easy to miss entirely.

Two changes close that gap:

- **Creating a mesh now produces an immediate, visible gradient.** A new mesh is
  seeded with four tonal corner colors derived from the shape's own fill — a soft
  light-to-dark sweep along the top-left → bottom-right diagonal in the same hue.
  The shape instantly reads as a dimensional gradient version of itself, and the
  colors stay editable per point.
- **The Inspector has a discoverable entry point.** When a mesh-capable shape (rect,
  ellipse, polygon, star, path) is selected and its primary fill is not already a
  mesh, the fill paint popover (open the **Fill** swatch in the Appearance section)
  offers a **"Gradient mesh"** row alongside Solid / Linear / Radial. It creates the
  same starting mesh as the canvas tool, in one undoable step. See
  [unified-fill-paint-picker.md](unified-fill-paint-picker.md) for the full picker.

This is a feedback and discoverability fix, not a new capability: the underlying
mesh model, canvas rasterization, on-canvas grid editing, point recoloring, and
SVG export are unchanged.

## What the user can do now

- Select a shape, open the **Fill** swatch, and click **Gradient mesh** in the paint
  popover (or press `U` / pick the mesh tool and click the shape on canvas) to turn
  its fill into a gradient mesh that is immediately, visibly a gradient.
- Continue editing as before: double-click a mesh point to recolor it, drag points
  to reshape the gradient, and drag a selected point's tangent handles to curve the
  mesh.

## How the user operates it

- **Inspector path:** select a mesh-capable shape → in the Appearance panel, open the
  **Fill** swatch → in the paint popover click **Gradient mesh** (grid-tile icon). The
  shape becomes a tonal gradient and the mesh grid is ready to edit on canvas.
- **Canvas path:** press `U` (or pick the grid-tile mesh tool in the tool rail),
  then click the shape. Same result.
- **Recolor a point:** with the mesh tool active and the shape selected,
  double-click a grid point to open its color popover.
- **Reshape:** drag a grid point to move it; drag a selected point's teal tangent
  dots to curve the surrounding patches.
- **Add a mesh line (subdivide):** with the mesh tool active and the mesh selected,
  click an empty spot inside the mesh. A new row and column are inserted through the
  click (a `+` intersection), giving a fresh editable control point exactly there.
  The gradient does **not** change — the new points sit on the existing colors — so
  it adds control without altering the look until you recolor or move a point. The
  cursor shows a crosshair over the mesh interior to signal this.
- **Remove a mesh line:** Alt/Option-click a mesh point to delete the row and column
  through it (boundary edges are kept, so corner points are left alone). The gradient
  resamples from the remaining points.
- **Undo:** creation, each subdivide, and each removal are one undo entry apiece.

## What a reviewer should manually verify

- Mesh tool active, click a solid-colored shape → the shape **visibly changes into
  a gradient** (not just a grid overlay), and the 3×3 grid with 9 points appears.
- The fill paint popover's **Gradient mesh** row appears for a selected rect/
  ellipse/polygon/star/path whose primary fill is not a mesh, and disappears once
  the fill is a mesh. Clicking it produces the same gradient as the canvas tool.
- Works on a **secondary, offset artboard** (e.g. "Artboard 2"): the mesh is created
  on the clicked shape and the grid overlay lands exactly on it.
- One undo reverts creation; double-click recolor and point drag still work.
- Mesh tool active + mesh selected, click inside the mesh → a new row+column appear
  through the click and **the rendered gradient is unchanged** (subdivide is
  appearance-preserving); the new center point is selected and editable. Alt-click a
  mesh point removes its row+column. Clicking/dragging an existing point still grabs
  it (it is not mistaken for a subdivide).

## What is still intentionally limited

- The Inspector affordance only **creates** the mesh; per-point color, position, and
  tangent editing remain on the canvas (the grid is inherently spatial).
- The seed gradient is a tonal sweep in the shape's own hue, chosen to be tasteful
  and non-destructive of the original color — it is a starting point, not a curated
  palette. Recolor points to taste.
- A non-hex fill (e.g. an existing gradient/image fill, or `none`) falls back to a
  neutral gray seed rather than guessing a hue.
- Subdividing a patch whose edge has been **curved with a tangent handle** flattens
  that curve at the new line (the inserted point sits on a straight split). Default
  meshes are straight, so this only affects handle-edited meshes; a full de Casteljau
  split that preserves the curve is a tracked refinement.
- Subdivide adds a full row **and** column (a `+`), matching the canvas mesh tool;
  inserting only a single row or column is a possible later refinement.
- Native PDF export of meshes and zoom-adaptive re-rasterization remain tracked
  follow-ups, unchanged by this fix.
