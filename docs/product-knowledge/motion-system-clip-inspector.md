# Motion-System Clip Inspector — Split Pane (Motion + Design Together)

Date: 2026-06-23.
Status: production authoring improvement.

## Summary

Selecting a grammar-backed motion clip in the Timeline used to **replace** the
whole Inspector with the clip's motion controls, hiding the Artboard, Frame Look
(Analog Film), and selected-object design. You could tune the motion or the look,
but never both at once — the single complaint that motivated this change.

The Inspector now **splits into two independently-scrolling panes** when a motion
clip is focused:

- **Top pane** — the normal Inspector, driven by the scene selection. With
  nothing selected it shows Artboard + Frame Look (Analog Film); with an object
  selected it shows that object's Transform / Appearance / Text.
- **Bottom pane** — the focused clip's motion-system controls (timing, tail,
  orbit, ease, source objects, create-editable-echoes).

A draggable divider between the panes reallocates height (persisted across
reloads); each pane scrolls on its own, so a tall motion section never pushes the
look controls off-screen. Both surfaces are mounted and editable at the same
time.

The clip no longer replaces the normal Inspector — that is the whole fix. The
earlier attempt stacked the source-object design below the motion section in one
scroll column, which still forced scrolling to reach either one and locked the
"partner" to the source objects; this split supersedes it.

## What Users Can Do Now

- Focus a grammar-backed clip (e.g. a `Time Delay`, `Time Offset`, or
  `Afterimage` system) and **tune its motion while the Frame Look (Analog Film)
  grain / chromatic fringing / exposure stay visible and editable** — the common
  Afterimage + Analog Film look-dev loop in one view.
- Or select an object to make the top pane show that object's design while the
  motion pane stays on the clip.
- Drag the divider to give motion or design more room; the split persists.

## How To Operate It

1. Open the Timeline and click a motion clip created from a motion grammar
   technique. The Inspector splits: normal Inspector on top, the clip's motion on
   the bottom.
2. To pair motion with the **Frame Look**, click empty canvas to clear the object
   selection — the top pane falls to Artboard + Frame Look while the clip stays
   focused (clicking a clip never changes the canvas selection, and clearing the
   canvas selection never clears the clip).
3. To pair motion with a **specific object's design**, select that object — the
   top pane shows its Transform / Appearance.
4. Drag the divider at the top of the motion pane to set the height split
   (double-click to reset; Arrow / Home / End for keyboard).
5. Motion edits land on the clip's grammar binding; design / look edits land on
   the scene selection.

## What A Reviewer Should Verify

- With a clip focused and nothing else selected, the top pane shows Frame Look and
  the bottom pane shows the clip's motion **at the same time**, each scrolling
  independently.
- Dragging the divider resizes the split smoothly (no canvas refit, no panel
  jump) and the height persists across reload.
- The normal pane keeps usable height even when the motion pane is dragged to its
  max (the 62% cap).
- Deselecting the clip removes the motion pane and the normal Inspector reflows to
  full height — identical to before this change.
- Exactly **one** motion-authoring section is shown (the normal pane's own Motion
  section is suppressed while the motion pane is open).
- The three no-clip Inspector states (no selection, single, multiple) are
  unchanged when no clip is focused.

## What Is Still Intentionally Limited

- **The top pane follows the scene selection, not the clip.** It is whatever the
  normal Inspector would show. "Motion + Frame Look" is the state when nothing is
  selected; the escape hatch is to click empty canvas.
- **The motion pane suppresses the normal pane's Motion section.** If a *different*
  object with its own motion binding is selected while a clip is focused, that
  object's per-node Motion controls are hidden (the motion pane owns the focused
  clip). Deselect the clip to author the other system. This is a deliberate v1
  cut to guarantee a single motion-authoring surface.
- **Style presets gate on the canvas selection.** The always-present Styles
  section captures/applies against the scene selection, not the clip's sources —
  pre-existing behavior, unchanged here.
- **Split is vertical (top/bottom) within the existing panel.** A separate
  floating motion panel was rejected as unnecessary chrome; the two-pane split
  delivers the same "two inspectors at once" within the fixed right panel.
