# Timeline mode (Motion workspace)

Added: 2026-06-22.

## What changed?

The timeline used to be a short, narrow floating strip pinned to the bottom-center of the editor (max ~176px tall, squeezed between the side panels), with the tool rail painting through its bottom edge. Doing real keyframe or clip work in it was cramped.

There is now a **Timeline mode**: a maximize button in the timeline header expands the timeline into a tall, full-width **docked** surface that *reserves* its own space. The side panels shorten to sit above it and the tool rail relocates above it, while the canvas camera keeps its exact zoom and pan. Nothing overlaps the motion surface. The docked height is **drag-resizable** and **persists** across reloads.

This is a split-rebalance, not a full-screen takeover — you keep scrubbing the timeline while watching the canvas.

## What can the user do now?

- Enter a roomy timeline workspace with one click and see many more track rows, a full-width clip lane, and uncramped transport controls.
- Drag the timeline taller or shorter to taste; the timeline, side panels, and tool rail reflow live with no overlap while the canvas view stays fixed.
- Keep the old compact "peek" — quick scrubs neither force the big layout nor nudge the artwork.

## How does the user operate it?

- **Show/hide the timeline:** `Mod+Shift+T` (unchanged). This toggles visibility only.
- **Enter / exit Timeline mode:** click the expand/restore icon (⤢ / ⤡) just right of the "Timeline" label in the timeline header. Entering the mode also reveals the timeline if it was hidden.
- **Resize the dock:** drag the divider at the top edge of the docked timeline. Double-click the divider to reset to the default height. The divider is keyboard-operable when focused (Arrow Up/Down to nudge, Shift for a coarse step, Home/End for min/max).
- **Fit after changing the workspace:** use the existing Fit Artboard or Fit Selection action when you want the artwork centered inside the currently visible canvas area. Fit accounts for the live timeline bounds.
- **Leave mode:** click the restore icon, or hide the timeline with `Mod+Shift+T` (hiding also exits the mode, so the next reveal is the compact peek).

The chosen height is remembered per browser and capped at 62% of the viewport so usable canvas remains available, even if a tall height set on a large monitor is later opened on a laptop.

## What should a reviewer manually verify?

- Entering mode makes the timeline tall and full-width; the layers/inspector panels clear its top edge and the tool rail sits above it — **no overlap or chrome bleed at any height**.
- Dragging the divider grows/shrinks smoothly and commits exactly one undo-free resize (it is editor chrome, not document history); the height survives a reload.
- Showing, hiding, expanding, restoring, and resizing the timeline preserve the exact canvas zoom and pan; an explicit Fit action centers the target above the live timeline bounds.
- Every timeline interaction still works while tall: playhead scrub, keyframe drag/add/remove, clip trim/add/delete, easing-curve drag, transport and keyframe keyboard shortcuts.
- Selecting a motion-system clip (e.g. *Time Delay expansion*) fills the tall area — no large blank band.
- `Mod+Shift+T` still only shows/hides; exiting mode restores the exact compact float.

## What is still intentionally limited?

- **No time-axis zoom yet.** The frame ruler still fits the whole duration to the available width; going full-width already roughly doubles horizontal frame density. Frame-accurate zoom/scroll is a planned follow-up.
- No dedicated keyboard shortcut for the mode toggle yet (the header button is the entry point).
- Per-track row-height controls and a sticky ruler are not included.

## Public release note

This change ships on the public `/updates` page as the **Timeline workspace mode** entry (category *Workspace*), defined in `src/pages/updates/model/product-updates.ts`. That entry deliberately keeps every public claim to behavior verified in the browser, so the reviewer-only check above (a selected motion-system clip filling the tall area) is not asserted there.
