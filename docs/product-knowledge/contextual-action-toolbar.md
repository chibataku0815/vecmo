# Contextual Action Toolbar Follows The Selection

Date: 2026-06-22. Updated: 2026-07-02 (group-selection anchoring fix).
Status: shipped placement consolidation + reliability fix.

## Update 2026-07-02: Correct anchoring on group selections

Selecting a **group** sometimes placed the floating chrome (the quick-action
bar and the floating properties HUD) at a stale point — the group's
creation-time top-left origin — instead of next to the group's visible box.
Cause: group containers carry a degenerate own-geometry (their extent lives in
their children), and the shared anchor math read that own-geometry directly.
The anchor now uses the same group-aware bounds the selection outline draws
from, so on group selections both floats sit beside the selection box exactly
as they do for single shapes.

Reviewer check: group two shapes (`⌘G`), move the group, reselect it — the
quick-action bar sits above the selection box and the floating HUD sits at its
top-right corner, matching non-group selections.

## Summary

Selected-object actions now live on a **single small bar that floats next to the
selection**, instead of a pinned 14-button strip at the top-center of the canvas.

Previously two surfaces showed the same intent at once: a large **"Selection
actions"** strip pinned under the top bar (duplicate, paste, group/ungroup,
frame/unframe, mask, z-order, lock/hide, focus, reset, delete), **and** a small
selection-following float (duplicate, group/ungroup). The strip's *content* was
contextual (it only appeared when something was selected) but its *position* was
global chrome — pinned in the same top-center lane the command palette opens in.
That content/position mismatch is what read as "wrong place," and the two
surfaces were redundant.

The product shift is:

- The pinned top-center strip is **removed**. The selection-following float is
  now the single near-selection surface, curated to the high-frequency verbs
  (**duplicate**, **group/ungroup**).
- The **right-click menu** gained the common long-tail verbs so they stay
  mouse-discoverable without a pinned bar: it now carries duplicate, group/
  ungroup, **bring forward**, **send backward**, **lock/unlock**, **show/hide**,
  reset bounding box, and delete.
- The **command palette (`⌘K` / `⌘P`)** remains the complete home for every
  object action, including the ones not in the menu — frame/unframe,
  use-as-mask/release, focus-artboard, and paste-in-place/over.
- The float was hardened for a motion editor:
  - It **tracks the selected object's on-screen position** (like the selection
    box), so it stays on the object as you pan, zoom, or scrub.
  - It is **hidden during playback** — the presentation pose is frozen while a
    rAF overlay animates the canvas, so a position-anchored bar would otherwise
    sit detached as the object moves away.
  - It **clamps to the viewport and flips below the selection** when sitting
    above would collide with the top chrome, so a selection near an edge — or one
    larger than the viewport at extreme zoom — pins the bar to a visible edge
    instead of scrolling off-screen.
- Every button on the float and on the boolean path-operations bar now shows the
  same **styled tooltip** as the rest of the editor chrome (previously only a
  slow native `title`).

This follows the pro-tool pattern (Figma / Illustrator / Affinity / After
Effects): a small contextual bar near the selection, with the long tail in the
context menu and command palette.

## What Users Can Do Now

- Select an object and act on it **where they are looking** — the duplicate and
  group/ungroup buttons appear right above the selection.
- Right-click the selection for the common verbs (duplicate, group/ungroup,
  bring forward, send backward, lock/unlock, show/hide, reset, delete).
- Reach **every** object action — including frame, mask, and focus-artboard —
  from the command palette (`⌘K`).
- Keep the float on the object while panning, zooming, or scrubbing; it tucks
  away during playback.

## How To Use

1. Open the editor and select one or more objects with the Select tool.
2. A small bar appears just above the selection: **Duplicate**, and
   **Group**/**Ungroup** when applicable.
3. **Right-click** the selection for the common verbs, or press `⌘K` and search
   for anything (including frame, mask, focus-artboard).
4. Select two or more paths to reveal the boolean path-operations bar
   (Union / Subtract / Intersect).

## What A Reviewer Should Verify

- The old pinned top-center "Selection actions" strip is **gone**; the top-center
  lane is clear except the command palette and the path-ops bar.
- Selecting an object shows the float with Duplicate (and Group/Ungroup when
  available); the actions still work and produce one undo step.
- Right-clicking a selection lists duplicate, group/ungroup, bring forward, send
  backward, lock/unlock, show/hide, reset bounding box, delete; each works.
- Playing the timeline **hides** the float; stopping restores it. The float
  stays on the object while scrubbing frames and while panning/zooming.
- Near a viewport edge, and at extreme zoom (e.g. 6400%), the float stays fully
  on-screen and flips below the selection instead of clipping under the top bar.
- The command palette (`⌘K`) exposes the full action set (frame/mask/focus
  included); tooltips appear on the float and path-ops buttons.

## Still Intentionally Limited

- The lowest-frequency verbs — frame/unframe, use-as-mask/release, and
  focus-artboard — are reachable from the command palette but are **not** in the
  right-click menu or on the float. An always-visible inspector "context header"
  was considered and deliberately deferred.
- **Delete is not on the float** (to avoid mis-click deletion next to small
  objects); use Backspace or the right-click menu.
- The boolean path-operations bar (2+ paths) stays in the top-center container by
  design; only the selection-actions strip was relocated.
