# Perform Mode — Drag-to-Record Motion (iPad Pencil-Motion Loop L3)

Date: 2026-07-08.
Status: shipped. This is the third, separate step of the iPad Pencil-motion
loop: L1 (stroke intent capture) and L2 (draw-on) were already committed;
Perform mode adds a third, independent way to author motion — recording a
live drag as position keyframes — under the existing Select tool.

## Summary

Perform mode lets you select one object, arm "Perform," drag it across the
canvas with the pointer or Apple Pencil, and have that drag turned into
editable x/y keyframes that play back later. The design is
"capture-then-commit," the same shape as the existing pencil pipeline: while
the drag is in progress the object visually follows the pointer through the
same live-override path an ordinary move already uses (no new render code),
and every pointer sample's position and elapsed time are buffered; on
pointer-up the buffer is converted to keyframes and committed as one undo
step. Nothing is written to the object's base transform — the recording is
the only outcome, so undo removes the whole performed motion in one step.

## What Changed?

- `performing` + `armPerform()`/`disarmPerform()`
  (`src/features/motion/model/transport-store.ts`) — a one-shot arming flag.
  Arming (from the quick action) marks the SINGLE next Select-tool drag as a
  Perform gesture; committing that drag disarms it automatically, so a
  second, unrelated drag never records without arming again.
- `HandlerApi`/`HostApi` gained three optional members
  (`src/widgets/canvas-shell/model/registry.ts`,
  `src/features/transform/canvas/handler.ts`): `isPerforming`,
  `onPerformSample(nodeId, x, y, tMs)`, `onPerformCommit(nodeId)`. The
  Select-tool transform handler
  (`src/features/transform/canvas/handler.ts`) reports a live sample on every
  pointer-move of a single-node move gesture while Perform is armed, and at
  pointer-up hands off to `onPerformCommit` INSTEAD of its normal
  scene-transform commit — the node's base transform is left untouched, and
  no double write to the scene document ever happens.
- `performSamplesToKeyframes(samples, fps)`
  (`src/features/motion/model/perform-recording.ts`) — the pure conversion
  from raw `{x, y, tMs}` samples to whole-frame `{frame, x, y}` keyframe
  stops. Maps elapsed time to a frame with `round(tMs / 1000 * fps)`,
  thins jitter with an inline Ramer–Douglas–Peucker pass over the (x, y)
  path (endpoints always kept), and clamps authored frames to `[0, 600]`.
- The canvas-shell widget
  (`src/widgets/canvas-shell/ui/CanvasShell.tsx`) implements the recorder:
  accumulates samples per gesture, converts them, extends
  `motion.durationFrames` first if the capture outgrows the current timeline
  (`extendMotionDuration`, `src/entities/motion/model/commands.ts`), then
  authors the x/y keyframes through `createMotionKeyframeCommand`
  (`src/features/motion/model/authoring-commands.ts`) inside ONE motion
  transaction (`beginMotionTransaction`/`applyInMotionTransaction`/
  `commitMotionTransaction`).
- A "Perform" quick action next to "Draw on" in the contextual quick-action
  bar, enabled whenever exactly one node is selected; clicking it arms
  Perform.

## What Can The User Do Now?

Select a single object, click "Perform," then drag that object anywhere on
the canvas with the pointer or Apple Pencil. The object follows the drag
live; on release, the drag's path is turned into x/y keyframes on that
object and Perform disarms itself. Scrubbing or playing the timeline now
replays the recorded path, sampled at the same frames the drag was captured
at — no extra step is needed to "confirm" the recording.

## How To Operate It

- Select exactly one node with the Select tool.
- Click "Perform" in the contextual quick-action bar to arm the next drag.
- Drag the node. The canvas shows it following the pointer exactly as an
  ordinary move would.
- Release the pointer: the drag commits as one undo entry (the keyframes),
  and Perform disarms — the next drag on any node is an ordinary move again
  unless you arm Perform again.
- Undo removes every keyframe the drag authored (and the duration extension,
  if the capture triggered one) in one step, since they share a single
  motion transaction.

## What A Reviewer Should Verify

- With one node selected, "Perform" is visible in the quick-action bar; with
  zero or more than one node selected, it is not.
- Arm Perform, drag a node a visible distance, release: the node's on-canvas
  position after release matches where the drag ended (not a snap back to
  its pre-drag position), and scrubbing the timeline from frame 0 replays
  the drag's path.
- The dragged node's base transform (Inspector X/Y at the object's rest
  pose, frame 0 before any keyframe existed) is unchanged by a Perform
  commit — only new keyframes appear, never a base-transform edit.
- Undo after a Perform commit removes the entire recorded motion (all
  authored keyframes) in one step; redo restores it.
- A drag captured longer than the current timeline duration extends the
  timeline (visible in the timeline ruler/duration readout) rather than
  truncating the tail of the recorded motion onto the old final frame.
- An ordinary (non-Perform) Select-tool drag is completely unaffected:
  still commits a scene-transform change, still undoes in one step, still
  supports Alt-drag-duplicate and Shift/Alt modifiers.

## What Is Still Intentionally Limited (v1)

- **Position only — no rotation.** Perform records x/y only; mapping the
  Pencil's roll/barrel-rotation axis to a rotation channel is deferred to a
  later iteration.
- **Captured-timing, not real-time-against-playback.** The playhead is not
  advanced while a Perform drag is in progress (nothing calls `setFrame`
  during the gesture) and elapsed time is measured from the gesture's own
  start (`tMs = 0` at the first sample), not from wherever the playhead
  happened to be parked. A capture is a fresh motion path anchored at its
  own start, not a splice recorded "live against" an already-running
  timeline.
- **Jitter decimation is lossy by design.** The RDP pass drops samples that
  do not visibly change the path's shape; the very start and end of the
  drag are always kept, but a slow, wandering drag may not replay every
  micro-wobble the hand actually made.
- **One node per gesture.** Perform is gated on exactly one selected node
  and a single-node move; multi-selection drags, resizes, and rotations are
  never recorded, regardless of whether Perform is armed.
- **One-shot arming, no cancel affordance.** Clicking "Perform" arms the
  next drag; there is no dedicated "cancel arm" control. Pressing Escape
  during the drag itself cancels that gesture as usual (nothing commits),
  but if you arm Perform and then simply click without dragging, Perform
  stays armed for the next real drag rather than disarming on the click.
- **Frame ceiling.** An authored keyframe frame is clamped to 600, so an
  extremely long drag cannot balloon the timeline arbitrarily.

## L5 — Canvas-Local Conversion HUD (Pencil Tool)

Status: implemented; static checks are green, on-canvas render pending device
QA (see the last bullet below). A fourth reachability surface for the same
L2/L3/L4
conversions above (Draw on, Perform, Make shape — see
`pencil-stroke-to-motion.md` and `sketch-to-vector-refinement.md`), plus
Discard, that appears directly on the canvas the moment a Pencil stroke
commits — without first switching to the Select tool or selecting anything.

- A transient "Conversion HUD" (`src/features/ipad-shell/ui/IpadConversionHud.tsx`)
  floats next to the just-drawn stroke, anchored to that stroke's own
  on-screen bounds (not the current selection) using the same screen-space
  anchor math the Select-tool contextual quick-action bar uses. It offers
  "Draw on" always, "Make shape" only when the stroke reads as a rect/
  ellipse/line candidate, "Perform" (which switches to the Select tool and
  arms Perform in one tap, since Perform only ever records a Select-tool
  drag), and "Discard" to clear the pending stroke intent without converting
  it.
- It calls the exact same conversion functions the Select-tool quick-action
  bar already calls (`authorStrokeDrawOnFromLastIntent`,
  `convertLastStrokeToShape`, `armPerform`, `clearLastIntent`) — no new scene
  or motion logic, only a second, canvas-local entry point to reach them
  while still on the Pencil tool.
- Shown only while the iPad authoring chrome is visible, the Pencil tool is
  active, a stroke's conversion intent is still pending, playback is not
  running, iPad focus mode is off, the iPad pan-drag "visual diet" mode is
  not active, and no freehand gesture is currently mid-drag. Any action
  (including Discard) clears the pending intent, which is also what makes
  the HUD disappear.
- Interactive rendering (draw a stroke → HUD appears → tap an action) was not
  visually verified in this pass — the automated preview harness available
  at implementation time cannot synthesize pointer input that reaches the
  canvas's drawing surface, and the document/intent stores are not reachable
  from `window` for a scripted check either. Static checks (types,
  architecture, design tokens) passed; a manual or device QA pass should
  specifically confirm: the HUD appears and is anchored next to the stroke
  (not detached or clipped); the anchor's edge-clamping looks right at the
  viewport's edges (it reuses the Select-tool bar's small-cluster clamp
  margins, tuned for a 2-3-icon bar, against a wider 3-4-button iPad-scale
  cluster); and the HUD is not occluded by the bottom iPad quickbar when a
  stroke is drawn low on the canvas.

## L6 — iPad Timeline Minimum

Status: implemented; static checks are green, on-canvas render pending device
QA (see the last bullet below). A compact, canvas-docked transport so the
motion a Pencil gesture just created (L2's `stroke-draw-on` reveal, or any
other authored motion) can be played, paused, and scrubbed, and the reveal's
length/direction trimmed, without opening the full desktop timeline panel
(`widgets/timeline`, which stays available and is unchanged by this work).

- A new presentational component,
  `src/features/ipad-shell/ui/IpadMotionTransport.tsx`, renders a play/pause
  button, a scrub lane with a playhead marker and a `frame / totalFrames`
  readout, and — only while a `stroke-draw-on` binding exists — a duration
  stepper (shorten/lengthen the reveal in 5-frame steps) and a reverse
  toggle. Like `IpadConversionHud`/`IpadAuthoringQuickbar`, it reads no store
  and dispatches nothing itself; every value and effect travels through
  props the canvas-shell widget supplies.
- `src/widgets/canvas-shell/ui/CanvasShell.tsx` wires it to `useTransportStore`
  for play/pause/scrub (scrubbing always pauses first, since the rAF
  `PlaybackDriver` is the sole per-frame writer while playing) and to
  `useMotionGrammarStore` for the duration/reverse edits, dispatched through
  `updateGrammarBinding` on the command bus like any other grammar edit —
  never a raw store write.
- The transport targets the MOST RECENTLY authored `stroke-draw-on` binding
  (`bindings.filter(...).at(-1)`), matching how the L5 Conversion HUD's
  "Draw on" action always operates on the latest Pencil stroke. With more
  than one draw-on binding in a document, only the newest is reachable from
  this surface; earlier ones still exist and still play back, but their
  duration/reverse are only editable from the desktop timeline/inspector.
- Two distinct frame counts are shown: the scrub lane's range is the whole
  motion document's `durationFrames`, while the stepper's value is this one
  binding's own `parameters.durationFrames` (the reveal length). The
  stepper's edit is clamped to `[6, min(300, totalFrames)]` — a UI-owned
  range tighter than the `stroke-draw-on` catalog's own `[1, 600]` bounds, so
  a stray extra tap on this compact surface cannot collapse the reveal to
  nothing or run it out past a sensible length.
- Shown whenever the iPad authoring chrome is visible, iPad focus mode is
  off, and at least one `stroke-draw-on` binding exists — regardless of the
  active tool or whether playback is currently running (a transport must
  stay visible and usable while the motion it controls is playing). It docks
  at the screen edge OPPOSITE the iPad quickbar's current dock (which itself
  tracks the selection, flipping to the top edge only when a selection sits
  near the bottom), so the two floating clusters can never overlap.
- Interactive rendering (draw a stroke → author draw-on → the transport
  appears → play/scrub/trim/reverse) was not visually verified in this
  pass, for the same reason as L5: the available preview harness cannot
  synthesize pointer input that reaches the canvas, and the transport/motion
  stores are not reachable from `window` for a scripted check. Static checks
  (types, architecture, design tokens) passed; a manual or device QA pass
  should specifically confirm: the transport appears once a draw-on reveal
  is authored and disappears if that binding is removed; play/pause and
  scrubbing (both tap-to-seek and drag) move the correct object's stroke
  reveal; the duration stepper visibly shortens/lengthens the reveal and the
  reverse toggle visibly flips its direction; and the transport never
  visually overlaps the iPad quickbar at either dock edge.
