# Motion Technique Menu

Date: 2026-06-22.
Status: production authoring gate.

## Summary

The Inspector Motion technique menu now shows only techniques that have a
production authoring profile and a fixed Glammer fidelity contract.

The full 18-technique motion grammar catalog remains available internally for
parsing, evaluation, decomposition coverage, and future stream work. The user
menu is intentionally narrower so it does not offer techniques that cannot yet
be authored through promoted profile contracts. Afterimage is exposed as a beta
Glammer parity surface, not a public-complete reference yet.

`Time Offset` is promoted only through the faithful materialization path. It
must create the Glammer Offset/Stagger Conveyor study on a warm film-white
background with visible grain/chromatic finishing and no unrelated sample
artwork. The conceptual model has five slots, but the accepted reference frame
visibly reads as three dots, small-large-small. If that contract regresses, it
must be hidden again instead of being treated as complete because its internal
expression clip works.

## What Users Can Do Now

- Choose `Time Delay` from the Motion menu when two or more source objects are
  available.
- Choose `Time Offset` from the Motion menu when two or more source objects are
  available.
- Choose `Afterimage` from the Motion menu for a single source object.
- Choose `Cycle` from the Motion menu for one or more source objects; it is the
  first technique promoted through the motion-expression runtime and authors a
  trackless looping orbit. See
  [Cycle motion system](./cycle-motion-system.md).
- Avoid seeing unfinished entries such as `Random Pulse`, `Interference`,
  `Arrangement`, and other non-promoted catalog techniques.

## Manual Verification

Use this smoke path after changing Motion technique exposure:

1. Select one editable object.
2. Open the Inspector Motion technique menu.
3. Confirm the menu contains `Time Delay`, `Time Offset`, `Afterimage`, and
   `Cycle`.
4. Confirm `Time Delay` and `Time Offset` keep their two-target gating behavior,
   while `Afterimage` and `Cycle` are available with a single target.
5. Confirm unfinished catalog entries are not shown in the menu.
6. Select two or more editable objects and confirm `Time Delay` becomes
   available.

## Known Limits

- Hiding a technique from the menu does not remove it from the grammar catalog.
- New motion grammar techniques should be added to the authoring menu only when
  their workspace materialization, clip editing, effect fidelity, and manual
  verification path are production-ready.
