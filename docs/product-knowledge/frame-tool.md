# Frame tool

Date: 2026-07-01.
Status: shipped on-canvas artboard creation.

## Summary

The **Frame tool** (`F`) is now a real, working tool: drag out a rectangle on the
pasteboard and it becomes a new **artboard** at that position and size. Until now
`F` was a dead disabled shell that showed the tooltip *"Frame creation is owned by
the frame/artboard workflow stream"* and did nothing when clicked — the domain
logic to create an artboard from a drag rectangle already existed
(`buildCreateArtboardFromBoundsCommand`), it simply had no tool wired to it.

The original Frame-tool change also removed three then-non-functional shells from
the rail. Arrow (`⇧L`) and Scale (`K`) remain disabled command-palette entries.
The former Effect Recipe slot has since returned as the working **Effect Field**
tool (`E`); it is documented separately and is not a Frame-tool capability.

## What Users Can Do Now

- Press `F` (or click **Frame** in the tool rail) and **drag on the canvas to
  create a new artboard** — no need to open a panel and type coordinates.
- See a **live size readout** (`W × H`) under the drag rectangle while sizing, so
  the artboard's dimensions are clear before releasing.
- Hold **`Shift`** to constrain the frame to a **square**, or **`Alt`** to grow it
  **from the press point as the center** — the same modifier grammar as the shape
  tools.
- The newly created artboard is **selected** on release and the tool returns to
  **Select**, so the next drag doesn't accidentally create a second artboard.
- **Click (no drag) for size presets** — a plain click floats a menu at the cursor
  with **Desktop**, **Presentation 16:9**, **Mobile**, and **Square**; choosing one
  creates that preset-sized artboard **centered on the click**. Figma opens presets
  on click; this matches it.
- **Snap while drawing** — the dragged corner snaps to neighboring **artboard
  edges/centers**, visible **grid** lines, and **guide lines**, with the smart-guide
  label, alignment line, and pixel measurement (respects the **Smart Guides** and
  grid toggles). Draw a frame flush to an existing artboard without eyeballing it.
- **Undo** (`⌘Z`) removes the artboard in one step — creation (drag or preset) goes
  through the same scene command bus as every other edit.

## How To Use

1. Activate the tool: press `F`, or click the **Frame** button (dashed-frame
   glyph) in the bottom tool rail.
2. Press and drag on empty pasteboard (or anywhere) to rubber-band the frame; the
   dashed outline and the `W × H` badge follow the pointer, snapping to artboard
   edges / grid / guides as it nears them.
3. Optionally hold `Shift` (square) and/or `Alt` (from center) while dragging.
4. Release to create the artboard. It is selected and the tool switches to Select.
5. **Or click once** (no drag) to open the size-preset menu, then pick a preset —
   the artboard is created centered on the click.
6. Press `Escape` mid-drag (or with the preset menu open) to cancel.

Rename, reposition to exact coordinates, recolor the background, reorder, or remove
the artboard afterwards from the Layers panel / Inspector "no selection" panel, as
before.

## What A Reviewer Should Verify

- With the Frame tool active, a drag on the canvas creates one artboard matching
  the dragged rectangle; the dashed preview and `W × H` badge track the drag.
- On release the new artboard shows selection chrome and the active tool is back to
  Select; a single `⌘Z` removes it.
- The **camera stays put** — drawing a frame does not zoom-jump the view to the new
  artboard (draw a small frame at a normal zoom and confirm the zoom level and the
  framed artboard do not change). This is deliberate: the new frame is *selected*
  but the *current* artboard is unchanged, so the workspace-fit reframe does not
  follow it. Contrast the Inspector "Add artboard" button, which intentionally
  makes its new artboard current and reframes to it.
- `Shift` produces a square; `Alt` grows the frame symmetrically from the press
  point; `Escape` mid-drag cancels with no artboard and no undo entry.
- **Click (no drag)** opens the preset menu at the cursor; picking **Mobile** (say)
  creates a 390×844 artboard centered on the click, selects it, returns to Select,
  and is removed by one `⌘Z`. `Escape` (or clicking canvas) dismisses the menu.
- **Snap:** with Smart Guides on, dragging a corner to within a few pixels of an
  existing artboard edge locks the preview to that edge and shows the "artboard …"
  label + alignment line + measurement; with Smart Guides off it takes the raw
  pointer.
- The tool rail does not show Arrow or Scale; the Frame button is present and
  distinct from the Rectangle and Effect Field buttons.
- The command palette still lists Arrow / Scale as greyed, non-activating rows
  with their reason text; Effect Field activates normally.

## Still Intentionally Limited

- **Creation only.** The Frame tool creates artboards; moving/resizing an existing
  artboard stays on the Select tool's artboard handles, and precise numeric edits
  stay in the Inspector.
- **Arrow / Scale remain unbuilt/redirected**, now surfaced only in the command
  palette — Arrow has no draw-model shape and Scale duplicates the Select resize
  handles.
