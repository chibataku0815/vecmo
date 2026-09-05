# Parameter Capture Stage

Date: 2026-06-27.
Status: `beta` — filming aid for motion-authoring demos.

## Summary

Capture Mode adds a filmed parameter HUD over the editor. It keeps the canvas
and docked authoring surfaces intact, while a dedicated overlay shows the
selected vector part's motion-relevant values at the playhead: X/Y, rotation,
scale, opacity, and anchor. It also reads the selected Look Graph node and shows
its numeric effect parameters, including keyframed Flow, Lens, Deep Glow, and
other graph-node controls. Focused grammar-backed motion-system clips add their
clip timing and authoring-profile parameters, such as Period, Delay, Radius,
Loop frames, Copies, and Decay. Codeable Duplicate generators expose evaluated
Count / X / Y / Rotation expressions for the selected source part, and frame
Effect Stacks expose ordered layer mix/blend/applicability rows. Keyed and
animated rows are promoted visually, the floating editing Inspector is suppressed
while Capture Mode is open, and a short canvas callout connects the selected
vector part to the parameter card placed on the nearest free side of the
selection. If the docked Inspector is open, the card stays to its left so the
editing rail remains available.

This is intentionally a presentation layer, not a new document feature. It reads
scene, motion, selection, transport, and viewport state; the only state it writes
is whether Capture Mode is open.

## What Can The User Do Now?

- Toggle a Parameter Capture overlay from the small slider button near the top
  editor chrome.
- Select a vector part and see a filming-ready card with the current frame,
  selected part name, active parameter count, values, deltas from rest pose, and
  KEY / ANIM / LIVE state.
- Select a Look Graph node and see its current numeric parameter values, base
  deltas, and Look-node key/animation state in the same filming card. If a vector
  part and Look node are both selected, both parameter groups are shown.
- Select a motion-system clip in the Timeline and see its focused clip timing,
  local playhead frame, and semantic authoring parameters. If a vector part or
  Look node is also selected, the motion-system group is shown alongside them.
- Select a vector part with a Codeable Duplicate generator and see evaluated
  Count, X, Y, and Rotation generator channels with the original expressions.
- Capture an active Frame/Scene Effect Stack as ordered layer rows showing mix,
  blend mode, kind, and applicability.
- Scrub or play the timeline and see values update at the playhead.
- Pan and zoom while the callout keeps pointing at the selected part's sampled
  transform bounds.
- Keep the docked Inspector available; when the Inspector is open, the capture
  card sits to its left instead of covering it. When the floating Inspector would
  otherwise appear, Capture Mode replaces that near-selection space with the
  filmed parameter card.

## How Does The User Operate It?

1. Click the Parameter Capture slider button.
2. Select one vector part on the canvas or in Layers, select a Look Graph node in
   the docked Look Graph workspace, or focus a grammar-backed motion-system clip
   in the Timeline.
3. Scrub the Timeline, play the motion, or edit parameters through the normal
   Inspector, Timeline, Duplicate, Effect Stack, and Look Graph controls.
4. Film the screen with the selected part, Look node parameters, duplicate/effect
   rows, motion-system controls, callout, and parameter card visible.
5. Close Capture Mode from the card's close button or by clicking the slider
   button again.

## What Should A Reviewer Manually Verify?

- With no selection, Capture Mode shows a neutral empty state and does not mutate
  scene or motion history.
- With one selected node, the HUD shows the selected name/kind and six promoted
  rows, with keyed rows above animated rows and rest rows after active rows.
- With one selected Look Graph node, the HUD shows the Look node name/kind,
  Frame/Scene Look scope, six promoted numeric rows, and Look-node key state.
- With one focused motion-system clip, the HUD shows the clip name/technique,
  Start, Local frame, and the first authoring-profile parameter rows in profile
  order.
- With a selected node that owns a Codeable Duplicate generator, the HUD shows
  evaluated Count and per-copy transform rows at the playhead.
- With a frame Effect Stack, the HUD shows the current Frame/Scene Look scope,
  layer count, active count, and ordered layer mix/blend/applicability rows.
- Scrubbing the playhead updates the frame number, sampled values, keyed/animated
  state, and callout target.
- Panning and zooming keeps the callout attached to the selected part.
- Opening the Inspector places the HUD to its left; with the Inspector closed,
  the HUD chooses the nearest free side of the selected part before falling back
  to the right edge.
- Fit Artboard keeps using the normal editor chrome insets; Capture Mode does not
  reserve a global side lane because the card chooses a local free side around
  the selected part.

## What Is Still Intentionally Limited?

- The HUD currently covers node-native motion parameters, the selected Look Graph
  node's numeric sliders, focused grammar-backed motion-system clip timing/profile
  parameters, selected-node Duplicate generator channels, and frame Effect Stack
  layer rows.
- The Look Graph capture target resolves the current artboard's Frame Look first,
  then Scene Look. It does not yet mirror every workspace-local scope affordance.
- Effect Stack capture resolves the current artboard's Frame Look first, then
  Scene Look. Node-local effect-stack ownership is not a public authoring surface
  in this slice.
- There is no built-in recording/export path for the HUD yet. Use browser or OS
  screen recording; later quality passes can composite the HUD into the existing
  WebM export path.
- The overlay tracks the primary selected node only. Multi-selection filming and
  scripted shot beats are follow-up slices.
- Capture presets, aspect-ratio frames, subtitles, cursor highlights, and social
  templates are intentionally outside this first slice.
