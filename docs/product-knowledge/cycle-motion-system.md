# Cycle Motion System

Date: 2026-07-09.
Status: beta production-authoring slice (expression-backed parametric path pilot).

## Summary

Vecmo can create a Glammer-style **Cycle** motion as an editable motion system.
Selected objects loop continuously either around their own rest point or along an
editable scene path, driven by a frame-to-pose expression rather than baked
keyframes.

The important product shift is twofold:

- **Cycle is a promoted Motion technique.** It appears in the Inspector Motion
  section alongside Time Delay, Time Offset, and Afterimage, and works on a
  single selected object (minimum one body target).
- **Cycle is the first technique backed by the motion-expression runtime.** Its
  Inspector controls, its timeline clip, and its live motion all derive from one
  declaration (`glammer-cycle-v1`). Adding the technique did not add a custom
  Inspector panel or a hand-written per-frame branch — the declaration projects
  into the existing motion-system surfaces. This is the durable change: future
  Glammer techniques can declare their parameters once instead of growing new UI.
- **Cycle now carries a generic parametric path role.** A generated Cycle system
  contains a body family plus a replaceable `Path` scene node. If that role is
  present, bodies sample the path by normalized progress, phase, normal offset,
  and optional tangent orientation. If no path role is present, the binding keeps
  the legacy circular orbit fallback.

The motion is `trackless-expression`: one clip controls the loop period, and no
scalar keyframe rows are created. Explicit bake remains a separate, opt-in action.

## What Users Can Do Now

- Create a `Cycle` system from the Inspector Motion section with one or more
  objects selected; the selected objects become the looping bodies.
- Scrub or play the Timeline and see each object follow the generated motion path
  when creating a Cycle system, or orbit its rest point when applying a bare
  Cycle binding with no path role.
- Edit semantic Cycle parameters in the Inspector: `Period` (loop length in
  frames), `Phase Offset`, `Phase` (per-object phase stagger in degrees), `Path
  Offset`, fallback `Radius`, `Orient`, and `Orient Offset`.
- Edit the looping objects and the motion path's fill, stroke, transform, and
  vec-core look from the normal Inspector panels — they remain ordinary editable
  scene objects.
- Retime the whole loop by editing the clip `Duration`; `Period` stays
  synchronized with the clip duration in clip mode.

## How To Use

1. Open the editor and select one object on the canvas.
2. Open the Inspector Motion section and create the `Cycle` system.
3. The system creates a body role and, when needed, an editable `motion path`
   scene node; the playhead moves to a quarter of the period so motion is visible
   immediately.
4. Press Play or scrub the Timeline and confirm the body travels the path.
5. Move or reshape the `motion path` node to redirect the loop.
6. Change `Period` (or trim the clip `Duration`) to speed up or slow down the loop.
7. Select two or more objects before creating Cycle, then change `Phase` to make
   them travel the loop out of step.
8. Turn `Orient` on to make bodies rotate to the path tangent; use `Orient
   Offset` when the artwork's forward direction is not its local +X axis.

## Manual Verification

Use this smoke path after changing the Cycle system:

1. Select one object and create a `Cycle` system from the Inspector Motion menu.
2. Confirm a `Cycle` clip exists in the Timeline and the Inspector shows the
   Cycle parameters `Period`, `Phase Offset`, `Phase`, `Path Offset`, `Radius`,
   `Orient`, and `Orient Offset`.
3. Confirm no per-object scalar keyframe rows were created (Cycle is trackless).
4. Scrub across the clip and confirm the object follows the generated path and
   returns to its start.
5. Confirm there is exactly one undo step to remove the whole system.
6. Move or scale the generated path and confirm the loop updates live.
7. Change `Duration` and confirm `Period` and the clip range update together.
8. Select two objects, create Cycle with a non-zero `Phase`, and confirm the two
   objects travel the loop at different phases.
9. Turn `Orient` on and confirm the bodies rotate to the path tangent without
   rotating the path node itself.

## What Is Still Intentionally Limited

- This slice ships the **parametric path-motion core**, not the richer Glammer
  Cycle visuals (an infinity-styled path, a thick travelling stroke window, and
  a head dot). The `strokeDashoffset` channel they will use already renders
  end-to-end — live canvas, SVG export, and the PDF dash phase — while the
  JavaScript code-export player remains the one surface without dash rendering
  (a pre-existing gap, not specific to this channel).
- Path motion samples the path node's current scene geometry and transform. There
  is no dedicated on-canvas path-stop editor, path offset handle, or tangent
  forward-axis picker yet; those are still normal Inspector/path editing tasks.
- Cycle is `trackless-expression`. Full scalar keyframe editing stays behind
  explicit bake. Bake tracks target the body family, not the path role; tangent
  rotation tracks are planned only when `Orient` is on.
- Cycle (and every motion-grammar technique) now reproduces in the JavaScript
  code-export runtime, which shares the editor's sampler — see
  [Motion code runtime export](./motion-code-runtime-export.md). The remaining
  gap is appearance/look fidelity (grain, vec-core looks), which the runtime's
  SVG serializer still approximates.

## Related Docs

- [Motion technique menu](./motion-technique-menu.md)
- [Time Delay motion system](./time-delay-motion-system.md)
- [Afterimage motion system](./afterimage-motion-system.md)
- [Motion code runtime export](./motion-code-runtime-export.md)
- [Motion expression runtime foundation plan](../vecmo-motion-expression-runtime-foundation-impl-plan.md)
