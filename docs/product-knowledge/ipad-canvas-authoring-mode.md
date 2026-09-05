# iPad Canvas Authoring Mode

Date: 2026-07-07.
Status: beta.

## Summary

The editor now adds an iPad-focused canvas command layer on touch-first iPad-like
devices. It keeps the TypeScript editor engine as the source of truth and treats
the iPad surface as a widget-owned chrome adapter over existing scene, selection,
viewport, undo/redo, arrange, style, timeline, account, recovery, and backup
actions.

The goal is not a separate iPad document model. The goal is to make the primary
creation loop reachable without depending on desktop panels or the bottom desktop
tool rail.

Performance posture is part of the feature: on iPad-like devices, the desktop
ToolRail, ToolOptions, Layers, and Inspector subtrees are not mounted, and finger
pan/pinch viewport updates are coalesced through `requestAnimationFrame` so touch
event frequency does not directly multiply viewport-store writes.

## What Users Can Do Now

- Use a compact bottom quickbar for Pencil, Shape, Gradient, Noise Gradient,
  Select, Hand, Undo, Redo, zoom, fit-artboard, fit-selection, Quick Menu,
  Timeline, Account sign-in/management, Cloud recovery, portable backup save,
  backup open, and backup share.
- Use a Quick Menu for the same primary commands, direct Rectangle/Ellipse/Line/
  Polygon/Star draw-mode actions, Gradient/Noise Gradient material tools, and
  selected-object actions: duplicate, group/ungroup, select next stacked object,
  Style, bring forward, send backward, lock, hide, and delete. Backup
  save/open/share remains on the always-visible quickbar. Timeline, recovery,
  and backup save/open/share also appear in the empty-selection Quick Menu.
- Use compact Style controls for the selected object: stroke color, fill color,
  stroke width, opacity, stroke cap, stroke join, and dash. When the primary
  selected object is text, the panel also exposes size, leading, tracking,
  alignment, bold, italic, and underline.
- On iPad-like touch devices, use fingers for viewport navigation while Pencil
  and pen input remain available for drawing. Finger pan/pinch is applied at most
  once per animation frame; two-finger tap triggers undo; three-finger tap
  triggers redo.
- Save, open, or share a local `.vecmo-backup.json` from the canvas quickbar
  without opening the desktop top-bar import/export area. Opening a backup clears
  the active cloud-project attachment so restored local work is not silently
  treated as the previously attached cloud document.
- Open Cloud recovery from the quickbar. If the current editor is attached to a
  cloud project, `/projects` opens with that project's revision history drawer
  already selected; otherwise it opens the general project browser.

## How To Use

1. Open `/editor` on an iPad-like touch device.
2. Use the bottom quickbar to switch Pencil, Shape, Gradient, Noise Gradient,
   Select, and Hand.
3. Tap Shape to draw the current primitive, or open Quick Menu and choose
   Rectangle, Ellipse, Line, Polygon, or Star before dragging on the artboard.
4. Tap Gradient to edit object or artboard gradient handles; tap Noise Gradient
   with an object selected to use the on-canvas field controls.
5. Draw with Pencil or pen input; the freehand tool still commits a vector path
   through the existing draw handler and selects the committed path.
6. Tap the Quick Menu button for selection actions and view recovery commands.
7. Select an object and open Style for compact stroke, fill, opacity, stroke
   option, and basic text edits.
8. Use Timeline to reveal the motion timeline, or Recovery to leave the canvas
   for the project/revision recovery surface.
9. Tap Account to sign in, create an account, manage billing, or sign out without
   leaving iPad authoring mode.
10. Use two-finger tap for Undo, three-finger tap for Redo, or the quickbar icons.
11. Tap Backup to download the same portable project backup format used by the
   desktop top bar, Open to restore a portable JSON backup, or Share to invoke
   the platform share sheet when available. A restored backup resumes as local
   work until the user explicitly saves or attaches it to cloud again.

## What A Reviewer Should Verify

- On iPad Air M2 or better, the editor opens with the canvas dominant and the
  iPad quickbar visible; the desktop ToolRail, ToolOptions, Layers, and Inspector
  subtrees are not mounted on iPad-like devices.
- Pencil input draws; finger touches in drawing tools pan/zoom the viewport
  instead of mutating the scene.
- Two-finger pan/pinch feels direct despite rAF batching, and two-finger/
  three-finger taps trigger undo/redo without leaving a stuck gesture.
- Shape is visible in the iPad quickbar; Rectangle, Ellipse, Line, Polygon, and
  Star are visible in the Quick Menu; each creates the expected vector primitive
  from the next Pencil drag.
- Gradient and Noise Gradient are visible in the iPad quickbar and Quick Menu;
  Gradient activates the existing gradient handles, and Noise Gradient shows the
  selected object's on-canvas field controls when eligible.
- After drawing a stroke, Select, Fit selection, Style, Duplicate, arrange,
  lock/hide, delete, undo, redo, timeline reveal, account sign-in, cloud
  recovery, backup save, backup open, and backup share are reachable from
  iPad-scale controls.
- Fit-artboard and fit-selection leave space for the iPad quickbar instead of
  placing the selected content underneath it.
- Style edits mutate selected nodes through `createUpdateNodeStyleCommand` and
  text edits mutate selected text nodes through `createUpdateTextNodeCommand`;
  both paths coalesce by channel through the scene command bus.

## Still Intentionally Limited

- This is a beta iPad authoring layer, not a completed Procreate-class UX. Real
  TestFlight device judgement is still required before calling the loop complete.
- There is no native Swift-owned editor state and no iOS-only document format.
- The Quick Menu can be opened from the web quickbar or from native Apple Pencil
  squeeze when the iPad shell bridge reports squeeze events; the web quickbar
  remains the fallback entry point.
- Compact Style still does not expose the full rich fill, mesh, effect, frame
  look, or motion authoring panels. Gradient and Noise Gradient are reachable as
  canvas tools, while Timeline reveal and cloud recovery remain entry points
  into existing surfaces rather than complete iPad-native motion or revision
  browsers.
- No automated tests, build, browser smoke, or physical-device verification were
  run for this entry because the current task explicitly follows the repo rule to
  avoid test-like verification unless requested.
