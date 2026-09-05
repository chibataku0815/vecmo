# Sketch to Clean Vector

Date: 2026-07-08.
Status: shipped (recognition + in-place conversion). Self-contained — no
motion is involved. See `pencil-stroke-to-motion.md` for the sibling
conversion that turns the same captured stroke intent into a draw-on reveal
instead of a clean shape.

## Summary

Every committed Pencil stroke (mouse, trackpad, or Apple Pencil) already
captures a transient `PencilStrokeIntent` in a shared, gesture-scoped store
(see `pencil-stroke-to-motion.md`). This feature reads that same intent and
offers an opt-in "Make shape" action that recognizes a rough freehand stroke as
a clean rectangle, ellipse, or line, and swaps it in **in place** — same node
id, same position in its layer's stacking order — as a single undoable edit.
Nothing is auto-applied: a stroke commit only records the intent, and a sketch
that does not read as a clean primitive is always left untouched.

## What Changed?

- `recognizeStrokeShape()` (`src/shared/stroke/shape-recognition.ts`) is a pure,
  scene-free classifier: it reads a `PencilStrokeIntent`'s already-computed
  `candidates`/`signals` and returns a neutral `{ kind: "rect" | "ellipse" |
  "line", bounds }` descriptor, or `null` when the stroke should stay a
  freehand sketch. It lives in `shared` (not `entities`) so both the draw
  feature and any future consumer can use it without a feature-to-feature
  import.
- `convertLastStrokeToShape()` (`src/features/draw/model/sketch-to-shape.ts`)
  maps that descriptor onto concrete scene geometry, gates it against the same
  minimum-size check the shape tool's own live drag uses
  (`shapeGeometryMeetsMinimum`), and — if the original sketch node is still in
  the document — builds a clean node that copies the sketch's name and style,
  reuses the sketch's own id, and replaces it through the command bus.
- `createReplaceNodeCommand()` (`src/entities/scene/model/node-commands.ts`) is
  a new scene command that swaps one node for another at the exact same index
  in its owning node array, as one Immer-patched edit. This is the primitive
  that makes the conversion non-destructive: a single undo restores the
  original sketch exactly, rather than replaying a separate delete-then-insert
  pair.
- A new "Make shape" quick action appears next to "Draw on" in the on-canvas
  contextual action bar whenever a pending stroke intent is still a shape
  candidate.

## How Recognition Works

- **Line**: offered when the intent already carries the `"straight-line"`
  candidate (the stroke's measured straightness crossed the same threshold
  `pencil-stroke-to-motion.md`'s draw-on trigger would see). The clean line
  runs corner-to-corner across the stroke's own bounding box, along whichever
  diagonal matches the stroke's captured start-to-end direction — a stroke
  drawn top-right to bottom-left comes back on that diagonal, not flipped.
- **Rect vs. ellipse**: offered when the intent carries the `"closed-shape"`
  candidate. The two are told apart by how much of its own bounding box the
  traced polygon fills (shoelace polygon area over box area): a rectangle
  traces close to the full box (ratio near 1.0), while an ellipse traces about
  `π/4` (~0.785) of it — the split sits at the midpoint of those two
  reference ratios (~0.89). This ratio is dimensionless, so recognition is
  scale-invariant: the same stroke shape is read the same way regardless of
  viewport zoom while drawing.
- **Neither candidate present** (an ordinary freehand doodle): recognition
  returns `null` and the sketch is left exactly as drawn.
- A shape that recognizes successfully but is smaller than a minimum extent is
  still treated as "keep the sketch" — a deliberate false-negative bias so a
  tiny scribble never silently collapses into a degenerate primitive.

## What Can The User Do Now?

Draw a rough rectangle, oval, or straight line with the Pencil tool, then
trigger "Make shape" from the on-canvas quick-action bar. The hand-drawn path
is replaced by a clean primitive with sharp geometry, in the same place in the
layer stack, keeping the sketch's own fill/stroke style. Undo restores the
original sketch exactly. Drawing something that is not a recognizable
rectangle, oval, or line (or drawing another stroke, or otherwise clearing the
pending intent) simply leaves no "Make shape" action available — the sketch is
never converted without the explicit action.

## How To Operate It

- Draw with the Pencil tool (mouse, trackpad, or Apple Pencil).
- If the traced stroke reads as a rectangle, oval, or straight line, "Make
  shape" appears in the contextual quick-action bar above the selection.
- Click it to swap the sketch for the clean primitive. The action consumes the
  pending intent, so it only ever acts once per stroke.
- Undo (Cmd+Z) reverts the swap in one step, restoring the original freehand
  path.

## What A Reviewer Should Verify

- Draw a wobbly-but-roughly-square path (start and end near the same point):
  "Make shape" appears; clicking it produces a `rect` node at the same
  position in the Layers panel, same id, same fill/stroke as the sketch.
- Draw a wobbly circle: same, but produces an `ellipse` node.
- Draw a reasonably straight diagonal stroke: same, but produces a `line`
  node running corner-to-corner across the stroke's bounding box, on the same
  diagonal the stroke was drawn along.
- Draw an irregular scribble (not closed, not straight): no "Make shape"
  action appears; the sketch is untouched.
- After any successful conversion, a single undo brings back the exact
  original freehand path (same id, same bezier shape) — not a blank canvas and
  not a partial revert.
- Drawing a second stroke after the first, without triggering "Make shape" on
  the first, leaves the first as a permanent sketch — only the most recent
  stroke's intent is ever pending.

## What Is Still Intentionally Limited

- **Only the most recently committed stroke is convertible.** The pending
  intent is a single-slot, gesture-scoped value (shared with the draw-on
  motion trigger); drawing again, or triggering "Draw on" instead, clears or
  replaces it, and there is no way to recognize an older, already-drawn sketch
  after the fact.
- **Name and style are copied verbatim.** A converted shape keeps the
  sketch's default "pencil path" name unless the user had already renamed it,
  and keeps its `strokeWidthProfile` (the pressure-width taper) in the style
  object even though rect/ellipse/line rendering ignores that field — inert
  but present.
- **No agent/MCP surface yet.** Conversion is reachable only from the
  on-canvas quick-action bar; there is no `scene/*` agent command for it, so
  an agent cannot trigger recognition or conversion directly today.
- **Self-contained, no motion.** This pass only replaces geometry; a
  clean-shape conversion carries no relationship to `pencil-stroke-to-motion.md`
  and does not chain into it (converting to a shape after arming "Draw on," or
  vice versa, is not a defined interaction — the two actions are independent
  and both read from the same single pending intent).
