# Repeat Transform

Date: 2026-07-02.
Status: public.

## Summary

Vecmo now has an Illustrator-style **Transform again** workflow. The editor
remembers the last committed object transform from canvas gestures, keyboard
nudge, flips, Inspector transform numbers, or Duplicate, then can replay it from
the command palette, canvas menu, or `Mod+D`.

The repeat memory is session-only editor state. It is not serialized into the
scene and it is not undoable by itself; only the repeated scene edits enter the
command history.

## What Users Can Do Now

- Move, rotate, resize, nudge, or flip a selection, then run **Transform again**
  to apply the same transform to the current transformable selection.
- Edit X, Y, W, H, or rotation for a selected object in the Inspector, then run
  **Transform again** to apply the same transform to the current selection.
- Duplicate a selection once, then run **Transform again** repeatedly to create
  the next copies with the same spacing.
- Adjust a fresh duplicate before repeating; the next repeat uses the adjusted
  distance from the original source to the duplicate when the adjustment is a
  canvas transform, keyboard nudge, Inspector transform edit, or flip.
- Undo each repeat as one step.

## How To Use

1. Select one or more objects.
2. Perform a transform, or duplicate the selection once.
3. Run **Transform again** from the command palette, canvas menu, or `Mod+D`.
4. Keep pressing `Mod+D` to continue the pattern from the newest selection.

Duplicate selection remains available from the command palette, canvas/layer
menus, and the selection quick action.

## What A Reviewer Should Verify

- Before a repeatable transform exists, **Transform again** is disabled.
- Move an object, select another object, and run **Transform again**; the second
  object moves by the same delta.
- Rotate or flip an object, then run **Transform again** repeatedly; each run is
  one undo step.
- Duplicate a selected object, then run **Transform again** several times; each
  copy lands at the same spacing and the newest copy becomes selected.
- Arrow-key nudge bursts repeat the full burst distance, not only the last key.
- Locked or hidden selected nodes stay selected but are not transformed.

## Still Intentionally Limited

- Direct Option-drag duplicate is not wired yet; duplicate-repeat currently
  starts from the existing Duplicate selection action.
- Pivot moves, corner-radius edits, artboard transforms, opacity/style changes,
  path operations, grouping, and reset bounding box do not seed Transform again.
- Text-box geometry resize is not treated as a repeatable object transform yet.
