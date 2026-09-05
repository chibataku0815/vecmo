# Shape tool group

Date: 2026-07-03.
Status: shipped grouped shape tool with `R` cycle.

## Summary

The five shape primitives — **Rectangle, Ellipse, Line, Polygon, Star** — now
share **one slot** in the bottom tool rail instead of three separate buttons
(Rectangle / Ellipse / Line) with Polygon and Star unreachable from the rail. The
single **Shape** button shows the icon of the current shape kind and carries a
small caret marking a **flyout**; the flyout lists all five primitives.

Pressing **`R`** activates the shape tool, and **pressing `R` again while the
shape tool is already active cycles to the next primitive** —
`rect → ellipse → line → polygon → star → rect`. This is the Figma-style
single-key cycle: one key reaches every shape, no separate `O`/`L`/etc. to
memorize.

All five kinds were already fully supported by the draw model
(`shapeGeometryFromDrag` handles polygon and star); this change is a chrome +
shortcut consolidation, not new geometry. The keyboard cycle order and the flyout
order come from one source (`SHAPE_TOOL_KINDS` in
`src/features/draw/model/shape-tool.ts`), so the on-screen row and the `R` cycle
can never drift.

The rail flyout is now the **single** shape-selection surface. A second,
redundant on-canvas shape picker used to float at the top of the artboard while
the shape tool was active (`ShapeToolbar` in `src/features/draw/canvas/overlay.tsx`);
it existed mainly because the old rail could not reach polygon/star. With all five
kinds now in the rail flyout and on the `R` cycle, that on-canvas toolbar was
removed to avoid two identical pickers on screen. The in-progress **drag preview**
(the dashed outline that tracks the pointer) is unchanged — only the picker toolbar
was removed.

## What Users Can Do Now

- **One Shape button** in the tool rail shows the active shape (rectangle by
  default) and opens a **flyout** of all five primitives on click.
- **Click the Shape button** to activate the shape tool with the current kind and
  reveal the flyout; **pick a primitive** in the flyout to switch kind and keep
  the shape tool active. The flyout dismisses on outside click or `Escape`.
- **Press `R`** to jump to the shape tool; **press `R` repeatedly** to cycle
  through Rectangle → Ellipse → Line → Polygon → Star and back. The rail button's
  icon updates to the current kind as you cycle.
- **Polygon and Star are now reachable from the rail** (previously only the draw
  model knew them); drag them out like any other shape, with the same `Shift`
  (constrain) / `Alt` (from center) modifier grammar.
- The command palette still finds every shape via the **Shape tool** entry
  (keywords: rectangle, ellipse, line, polygon, star).

## How To Use

1. Activate: press `R`, or click the **Shape** button (bottom tool rail; shows the
   current shape's glyph with a small up-caret).
2. To switch shapes, either **open the flyout** (click the button) and pick a
   primitive, or **press `R`** to advance to the next primitive.
3. Drag on the canvas to draw the selected shape; hold `Shift` to constrain
   (square / circle / 45° line / regular polygon) and/or `Alt` to grow from the
   press point.
4. On release the shape is committed and selected, and the tool returns to Select
   (unchanged behavior).

## What A Reviewer Should Verify

- The tool rail shows a **single Shape button**, not separate Rectangle / Ellipse
  / Line buttons; its glyph matches the current shape kind and shows the flyout
  caret.
- With the shape tool active, **no picker toolbar floats at the top of the
  artboard** — that redundant on-canvas picker was removed; the rail flyout and
  `R` are the only shape-selection surfaces. The **dashed drag preview** still
  tracks the pointer while dragging out a shape.
- **Clicking** the Shape button opens a flyout of five primitives; the current
  kind is highlighted; clicking a primitive switches the kind, keeps the shape
  tool active, and closes the flyout.
- **`R` cycles**: from Select, `R` enters the shape tool on the current kind;
  each further `R` advances rect → ellipse → line → polygon → star → rect, and the
  rail glyph tracks the change.
- Drawing after selecting **Polygon** yields a polygon and after **Star** yields a
  star (both were previously rail-unreachable).
- `Shift` / `Alt` modifiers still constrain / center each shape; `Escape` cancels
  an in-flight drag with no node.
- The command palette **Shape tool** entry still activates the shape tool and is
  found by searching any of the five shape names.

## Still Intentionally Limited

- **One shortcut, no per-shape keys.** `R` is the only shape shortcut and it
  cycles; there are deliberately no separate `O` (ellipse) / `L` (line) global
  keys — a single cycling key was the requested UX.
- **Polygon/star parameters** (point count, inner-radius ratio) keep their model
  defaults from the drag; numeric editing stays in the Inspector, unchanged.
- Entering the shape tool keeps the **last-used kind** (it does not reset to
  Rectangle); the first `R` lands on whatever the rail currently shows, and the
  next `R` advances.
