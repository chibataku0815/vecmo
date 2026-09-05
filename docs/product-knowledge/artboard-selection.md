# Artboard Selection (Explicit-Only)

Date: 2026-07-01.
Status: Canvas interaction change (select tool + name label).

## Summary

Selecting an artboard used to be incidental. Two paths did it without the user
asking: (1) with the select tool, a plain click on an artboard's empty interior
selected that artboard, and (2) the floating artboard name label fired a select
on any pointer-down regardless of the active tool, so a click near a frame's top
edge while drawing hijacked the stroke into an artboard select. An accidental
artboard selection swapped the Inspector to the artboard panel and dropped the 8
resize handles, which then intercepted clicks near the frame edge — so ordinary
work "kept selecting the artboard and got in the way."

Artboards are now selectable only when explicitly indicated. An empty-interior
click clears selection like a bare-pasteboard click; it never selects the
artboard. The name label selects the artboard only under the select tool — under
creation/edit tools (and the hand tool) the label is inert (`pointer-events-none`
and non-focusable), so the click falls through to the active tool. Once an
artboard is selected under the select tool, its move (2-step body drag) and
resize (edge/corner handles) are unchanged, and the 8-handle selection chrome now
renders only while the select tool is active.

## What This Enables

- Draw, shape, type, and gradient tools no longer get hijacked into an artboard
  select by a click near a frame edge or on the name label.
- Clicking empty canvas with the select tool deselects cleanly (Inspector returns
  to the empty state) instead of jumping to the artboard panel.
- The draw-target artboard (the focus used to place new nodes) is unaffected by a
  deselect — it is separate from the selection and is not undoable.
- Deliberate artboard editing still works: press `V` for the select tool, click
  the artboard name label to select it, then drag the body to move or drag a
  handle to resize.

## How It Works

- Select tool (`features/transform/canvas/handler.ts`): a plain click (no drag)
  that hits no node now always calls `clearSelection`; the old
  "empty-interior click selects the artboard" branch and the now-vestigial
  `Marquee.artboardId` field are gone. A drag still marquee-selects child nodes,
  and dragging the body of an already-selected artboard still moves it (that path
  keys off the existing `selectedArtboardId`, not a fresh interior hit).
- Name label (`widgets/canvas-shell` `ArtboardNameLabel`): an `interactive` prop,
  set to `activeTool === "select"`, toggles the button between `pointer-events-auto`
  (select tool) and `pointer-events-none` + `tabIndex={-1}` (every other tool).
  Gating by pointer-events — not by a no-op click handler — is deliberate: the
  button calls `stopPropagation()` before selecting, so a swallowed click would
  otherwise become a dead click that draws nothing. With pointer-events off, the
  pointer-down passes through the label's transparent overlay to the canvas so the
  active tool runs.
- Selection chrome: the 8-handle `ArtboardSelectionChrome` renders only when the
  artboard is selected AND the select tool is active, so handles do not linger
  after switching to a creation tool.
- Selection store is unchanged: `selectedArtboardId` stays mutually exclusive with
  node selection, and both `clearSelection` and `selectArtboard` leave the
  draw-target `currentArtboardId` untouched.

## Manual Verification

1. Select tool: click an artboard's empty interior — selection clears; the
   Inspector does not switch to the artboard panel and no resize handles appear.
2. With a node selected, click the empty interior — the node deselects.
3. Select tool: click the artboard name label — the artboard Inspector opens and
   the 8 resize handles appear.
4. Still selected, drag the body to move and drag a handle to resize; `Cmd+Z`
   reverts each.
5. Switch to the pen or shape tool and press on the name label near the top edge —
   a draw/create starts (not a dead click) and no artboard gets selected.
6. Marquee-drag across an interior (select tool) still selects child nodes.

## Known Limits

- The name label is the only canvas affordance that opens the artboard Inspector
  and resize handles, and it is active only under the select tool. The
  layers-panel artboard row focuses the artboard as the draw target and selects
  its child nodes; it does not open the artboard Inspector.
- When zoomed into an artboard interior far enough that the name label is off
  the viewport, there is no canvas artboard-select until the label is visible
  again. `Shift+1` (zoom to fit) reveals it. This is accepted friction, not a
  dead-end.
