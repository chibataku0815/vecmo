# Timeline Toolbar Icon Clarity

Date: 2026-06-22.
Status: shipped UI clarity fix.

## Summary

The editor top bar's Timeline toggle no longer collides visually with the
Undo/Redo history controls.

Previously the Timeline toggle used a `Timer` (stopwatch) glyph, which is a
circular clock shape — the same visual family as the Undo (`ClockCounterClockwise`)
and Redo (`ClockClockwise`) icons sitting two buttons away. Three round
clock-like glyphs in one cluster made the Timeline button hard to pick out at a
glance.

The product shift is:

- The Timeline toggle now uses a `FilmStrip` glyph: a horizontal, rectangular
  shape that reads as "motion timeline" and is unmistakably different from the
  round history clocks.
- A vertical divider was added before Undo/Redo so the history controls read as
  their own bracketed group, separate from the panel toggles.
- The same `FilmStrip` glyph is now used by the Timeline panel header and the
  public landing page's "Motion" signal, so the "motion timeline" metaphor is
  unified across the product.

The Undo/Redo clock glyphs are intentionally unchanged: a clock is the canonical
history metaphor, so the Timeline icon — not the history icons — was the one to
change.

## What Users Can Do Now

- Identify the Timeline toggle in the top bar instantly, without confusing it
  with Undo/Redo.
- Read the top bar's two groups at a glance: panel toggles (side panels, layers,
  inspector, timeline, shortcuts) versus history actions (undo, redo).

## How To Use

1. Open the editor.
2. Look at the center cluster of the top bar.
3. The film-strip icon toggles the Timeline panel; the two clock icons (split off
   by a divider) are Undo and Redo.

## What A Reviewer Should Verify

- The Timeline toggle shows a rectangular film-strip glyph, not a stopwatch.
- When the Timeline panel is open, the toggle fills with the accent (duotone)
  state and still reads as a film strip.
- A divider separates the Timeline/Keyboard toggles from the Undo/Redo clocks.
- The Timeline panel header icon matches the toggle (both film strips).

## Still Intentionally Limited

- Undo/Redo keep their clock glyphs by design (canonical history metaphor).
- The "Video WebM" export menu item keeps its `Timer` glyph; it carries a text
  label and is not adjacent to the history controls, so it does not reintroduce
  the confusion.
