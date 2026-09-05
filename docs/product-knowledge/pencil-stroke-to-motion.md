# Pencil Stroke → Draw-On Motion

Date: 2026-07-08.
Status: shipped end to end. The stroke-intent capture and the `stroke-draw-on`
motion-grammar expression were already in place; this change adds the one-tap
authoring trigger and the missing live-playback DOM write that let the reveal
show on scrub and in export but not during rAF `play()`.

## Summary

Every committed Pencil stroke (mouse, trackpad, or Apple Pencil) captures a
transient `PencilStrokeIntent` — its path length and wall-clock draw duration —
in a shared, gesture-scoped store. An opt-in "Animate draw-on" action turns the
most recently drawn path into a motion that draws itself on: it sets a full-length
dash on the stroke, strips any pressure-width taper, and binds the `stroke-draw-on`
motion-grammar technique, which marches `stroke-dashoffset` from the full path
length (hidden) to zero (fully drawn) over the captured duration. Nothing is
auto-applied — a stroke commit only records the intent; the user (or an agent)
decides whether to convert it.

## What Changed?

- `authorStrokeDrawOnFromLastIntent()` and `authorStrokeDrawOn({ nodeId,
  durationFrames, reverse? })` (`src/features/motion/model/draw-on-authoring.ts`)
  turn a path node into a draw-on reveal: a scene-store style patch (full-length
  `strokeDash`, static `strokeDashoffset: 0`, `strokeWidthProfile` cleared) plus a
  motion-grammar-store `stroke-draw-on` binding sized from the stroke's captured
  duration (clamped to 6–300 frames), or a fixed 30-frame default when applied to
  an existing selection instead of a fresh stroke.
- A new "Draw on" quick action (tooltip "Animate draw-on") appears next to
  Duplicate/Group/Ungroup whenever a pending stroke intent exists or exactly one
  path node is selected. It reaches the editor through the same list in both
  places that already read it: the on-canvas contextual quick-action bar (Select
  tool, an object selected) and the iPad QuickMenu (squeeze radial menu or the
  quickbar's dots button), so the trigger is reachable on iPad and on desktop
  without a second implementation.
- The imperative playback overlay (`applyPresentationNodePose` in
  `src/features/motion/canvas/overlay.tsx`) now also writes `stroke-dashoffset`
  (and, defensively, `stroke-dasharray` if the element does not already carry
  one) from the already-sampled presentation node. Scrubbing and export already
  read the composed value through the normal React render path; live `play()`
  freezes that reactive render for performance and relies entirely on this
  overlay, so the dash reveal previously never appeared once the transport
  actually started playing.

## What Can The User Do Now?

Draw a Pencil stroke, then trigger "Animate draw-on" (on-canvas quick-action bar
with Select active and the stroke selected, or the iPad QuickMenu) — the stroke
disappears at frame 0 and draws itself on, start to end, over the time it took
to draw it. With no pending stroke — for example, applying it to an
already-drawn path later in the session — the same action falls back to a fixed
30-frame reveal on the single selected path node.

The reveal plays back correctly whether the timeline is scrubbed, exported, or
actually played (`play()` included). Duration and direction are decided once, at
creation time, from the trigger's own inputs (captured stroke duration, or the
fixed 30-frame default); see What Is Still Intentionally Limited for why neither
a human nor an agent can retarget an existing binding's `durationFrames`/`reverse`
afterward.

## How To Operate It

- Draw with the Pencil tool (mouse, trackpad, or Apple Pencil both in-browser
  and in the native iPad shell).
- Trigger "Animate draw-on" from the contextual quick-action bar above the
  selected stroke (Select tool), or from the iPad QuickMenu.
- Re-triggering "Animate draw-on" on an already-converted node (no pending
  intent left) reapplies the fixed 30-frame default — today this is the only
  way to change an existing reveal's duration; see What Is Still Intentionally
  Limited.
- Undo removes the reveal in two steps (motion-grammar binding, then the style
  patch that stripped the width taper), since the two are independent
  command-bus writes on separate stores rather than one compound gesture.

## What A Reviewer Should Verify

- Scrub the clip: `stroke-dashoffset` reads the full path length at frame 0,
  roughly half that at the clip midpoint, and 0 at the end frame (reversed with
  `reverse` set).
- Play the clip live: the same path element's `stroke-dashoffset` attribute
  changes over real time while `useTransportStore`'s `isPlaying` is `true` — not
  just on scrub or in an exported SVG/PDF.
- The action is absent from the quick-action bar and QuickMenu when nothing
  qualifies (no pending stroke intent and no single path node selected), and
  present when either condition holds.
- A pressure-captured stroke (a profiled, variable-width taper) loses its taper
  and renders at uniform width once draw-on is applied; undoing both steps
  restores the taper.

## What Is Still Intentionally Limited

- **Draw-on and the pressure-width taper are mutually exclusive in v1.**
  Renderers ignore a dash pattern while a `strokeWidthProfile` is present, and a
  pressure-captured freehand commit always attaches one, so authoring draw-on
  strips it; a draw-on stroke always renders at uniform width. Undoing the
  reveal restores the taper.
- **Two-step undo.** The style patch and the motion-grammar binding are
  separate command-bus writes with no shared compound id, so a single Cmd+Z
  reverts only the most recent of the two.
- **Never auto-applied.** A stroke commit only records the transient intent;
  nothing about the committed path changes until "Animate draw-on" is
  explicitly triggered, and the intent is consumed (cleared) once it is.
- **Duration/reverse are creation-time-only — for anyone, not just humans.**
  `stroke-draw-on` is a single-role additive expression technique with no
  catalog entry and no registered technique-module authoring profile, so it is
  invisible to every parameter-editing surface that gates on those: the
  Inspector's Motion section shows no card for it (it only manages the 18
  catalog techniques), and the agent/MCP `motion-grammar/apply-technique` and
  `motion-grammar/update-parameters` commands both reject it outright — the
  former because the technique id resolves to no catalog entry, the latter
  because every parameter key (`durationFrames`, `reverse`, `dashLength`) is
  unknown to the resulting empty catalog/profile parameter spec, which
  `normalizeMotionGrammarAuthoringParameterPatch` treats as a hard validation
  error rather than a silent drop. The only supported way to change an existing
  reveal's timing today is to re-trigger "Animate draw-on," which resets it to
  the fixed 30-frame forward default.
