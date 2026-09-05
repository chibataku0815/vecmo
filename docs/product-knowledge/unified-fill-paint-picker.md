# One Fill Swatch That Opens A Paint Picker (Gradients Made Discoverable)

Date: 2026-06-24.
Status: shipped discoverability + workflow fix for fill paint authoring.

## Summary

Gradients already worked, but the authoring flow was fragmented and hard to find, so
users concluded the feature was broken. The fill control was a small color box that
went **blank and disabled** the moment a fill stopped being solid; the only way to
reach a gradient was a tiny "Fill type" dropdown whose options were "Solid / Linear /
Radial" — the word "gradient" never appeared; and the on-canvas endpoint handles only
showed up if the user happened to press the `G` gradient-tool shortcut. Gradient mesh
was a separate button in a different part of the panel.

The fill is now **one swatch that opens one popover**:

- **The fill swatch always previews the live paint and is never a dead box.** It shows
  the gradient ramp for a gradient, a mesh glyph for a mesh, and the solid color (or a
  danger slash for "no fill") otherwise. Beside it, a label reads the current paint
  kind ("Solid", "Linear gradient", "Radial gradient", "Gradient mesh").
- **Clicking the swatch opens a paint picker.** Its top is a paint-type row — **Solid ·
  Linear · Radial** — plus a **Gradient mesh** entry for mesh-capable shapes. The body
  is the editor for the chosen kind: the color picker for solid, the gradient ramp with
  draggable stops for a gradient.
- **On-canvas gradient handles appear automatically — no `G` needed.** Switching a fill
  to a gradient, or simply opening the fill picker on a shape that already has one,
  reveals the draggable endpoint axis and stop dots on the canvas. Closing the picker
  returns to the select tool and keeps the gradient.

This is a recomposition of existing pieces (the same color picker, gradient ramp, stop
editor, and gradient overlay), not a new rendering capability. The scene model, the
linear/radial gradient render path, and mesh rasterization are unchanged.

## What the user can do now

- Click the **Fill** swatch in the Inspector's Appearance section to open the paint
  picker, instead of hunting for a "Fill type" dropdown.
- Pick **Linear** or **Radial** to turn the fill into a gradient; the ramp opens in the
  popover and the endpoint handles appear on the canvas at the same time.
- Drag a stop on the ramp, or drag an endpoint on the canvas, to shape and aim the
  gradient — with the ramp visible while dragging on canvas. Each drag is one undo entry.
- Pick **Gradient mesh** (on a mesh-capable shape) to convert the fill into an editable
  gradient mesh and drop straight into the mesh tool.
- Re-aim an existing gradient later by just opening the fill swatch again — the handles
  come back without remembering any shortcut.

## How the user operates it

- **Open the picker:** select a shape → in the Appearance section click the **Fill**
  swatch (the small paint chip). A popover opens with the paint-type row at the top.
- **Make a gradient:** click **Linear** or **Radial**. The body switches to the ramp +
  stops editor and the on-canvas axis with endpoint handles appears immediately.
- **Edit stops:** click the bare ramp to add a stop, click a stop to select it, drag a
  stop thumb to move it; the selected stop's color, position, and alpha are editable
  below. Add stops with the **+** button.
- **Aim on canvas:** with the picker open, drag the endpoint handles on the canvas to
  set the gradient's direction and extent; the ramp preview stays visible.
- **Gradient mesh:** click the **Gradient mesh** row (shown only for a single
  mesh-capable shape whose fill is not already a mesh). The shape becomes a tonal mesh
  and the mesh tool activates for on-canvas point editing.
- **Solid:** click **Solid** to return to a flat color; the color picker (with recents,
  eyedropper, and "No fill") is the popover body, and the gradient tool is released back
  to select.

## What a reviewer should manually verify

- Select a shape with a solid fill → the **Fill** swatch shows the color and the label
  reads "Solid"; the swatch is never a greyed-out empty box.
- Click the swatch → a popover opens with a **Solid · Linear · Radial** row, a
  **Gradient mesh** button (for a rect/ellipse/polygon/star/path that is not already a
  mesh), and the color picker.
- Click **Linear** → the popover body becomes the gradient ramp + stops, the Inspector
  Fill label reads "Linear gradient" with a gradient preview swatch, and the on-canvas
  endpoint axis with stop dots appears **without pressing `G`**.
- Close the popover → the gradient is kept and the active tool returns to select;
  reopen the popover on the same gradient → the canvas handles reappear.
- Click **Gradient mesh** → the fill becomes a tonal gradient mesh and the mesh tool
  activates; the row is hidden for text nodes, multi-selection, and already-mesh fills.
- A single ramp-stop drag or endpoint drag collapses to exactly one undo entry.

## What is still intentionally limited

- The **Gradient mesh** row only **creates** the mesh; per-point color and shape editing
  stay on the canvas (the grid is inherently spatial). Mesh fills are not animated.
- The picker exposes **Solid / Linear / Radial / Gradient mesh**. Image fills are not a
  pickable row (there is no in-app create-image-fill flow yet); image-fit editing remains
  in its existing control. Angular/conic/diamond gradients are not in the data model.
- Stroke paint still uses the existing inline color field and "Fill type" gradient
  controls; the unified swatch + popover is the fill surface only (stroke gradients draw
  no on-canvas handles today).
- Gradient stop editing is single-object by design; with several objects selected the
  picker switches paint kind across the selection but shows "Select a single object to
  edit gradient stops" instead of a shared ramp.
