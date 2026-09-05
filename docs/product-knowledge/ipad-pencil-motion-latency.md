# iPad Pencil-Motion Felt Latency Contract

Status: audited after the L1-L6 creation loops (stroke intent, draw-on, perform,
sketch-to-vector, conversion HUD, compact transport) landed. This is L7 of the
iPad Pencil-motion loop: a source-inspection pass confirming the active gesture
stays felt-immediate, and the contract future work must not regress. No code
change was needed — the discipline was built into each slice from the start; this
document makes it explicit so it is preserved.

## Why This Matters

The iPad product is a Pencil-first authoring surface. If the Pencil does not feel
like it is drawing *now* — if recognition, keyframe conversion, or a full-widget
re-render lands on the pointer-move path — the whole premise breaks on exactly the
lower-powered device this targets. The loops are therefore built so that the only
work on the hot path is bounded sample capture; every heavy step happens after the
gesture lifts or on an explicit, opt-in conversion.

## The Contract

1. **Capture is frame-bounded.** `onPencilMove` (`features/draw/canvas/handler.ts`)
   throttles samples by a minimum screen spacing before appending; a pen's
   coalesced sub-events are expanded but stay bounded by that same throttle;
   the OS-predicted tail is rendered to mask latency and is never committed.

2. **Heavy work is deferred to lift / hold / explicit conversion — never per move.**
   - `buildPencilStrokeIntent` (the signal analysis) runs *after* the freehand
     commit returns, not during the drag.
   - Shape recognition (`recognizeStrokeShape`) runs only on the explicit
     "Make shape" action.
   - The draw-on dash + grammar binding is authored only on "Draw on".
   - Performed drag samples are converted to keyframes
     (`performSamplesToKeyframes`) only at pointer-up, in one motion transaction.

3. **No broad React re-render during an active stroke or performance.**
   - Live object drag writes the transient live-override store, not the scene
     store; the single scene write happens once at pointer-up (or, in Perform
     mode, is skipped — the recorder owns the outcome).
   - Per-sample capture buffers are **module-level mutables, not React state**:
     `freehandIntentSamples` (draw handler) and `performRecordingBuffer`
     (`CanvasShell.tsx`) accumulate on every accepted sample with zero re-renders.
   - The conversion HUD is hidden while a stroke is in progress
     (`!isDraftingFreehandStroke`), so it never recomputes mid-gesture.

4. **Playback does not re-render the canvas widget.** The transport's per-frame
   `currentFrame` subscription is isolated in a small child component
   (`IpadMotionTransportHost`); `CanvasShell` freezes its own presentation frame
   during play (`resolveCanvasPresentationFrame` returns the held frame while
   `isPlaying`), and the imperative `PlaybackDriver` patches the DOM directly. So
   an animation playing back does not re-render the ~7000-line canvas widget each
   frame.

## Invariants Future Work Must Not Regress

- Do **not** move recognition, intent analysis, or keyframe conversion into
  `onPencilMove` / `onPerformSample`. Defer to pointer-up or an explicit action.
- Do **not** store a per-sample capture buffer in React state; use a module-level
  or `ref` buffer so accumulation does not re-render.
- Do **not** subscribe the `CanvasShell` function body to `transport.currentFrame`
  (or any per-frame value); isolate per-frame reads in a dedicated child.
- Do **not** write the scene store during an active drag; use the live-override
  store and commit once at gesture end.
- Add debug-only latency telemetry only when a real device complaint names a
  concrete blocker — not speculatively.

## Deferred To Real-Device QA (L8)

Source inspection confirms the paths above are bounded and defer heavy work. It
cannot confirm the *felt* result — wet-ink tracking, conversion "result appears"
timing, and playback smoothness on iPad Air M2-class hardware with Apple Pencil
Pro. Those remain the human-gated L8 measurements; see
`docs/ipad-real-device-performance-loop-plan.md`.
