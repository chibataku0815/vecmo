# Timeline Playhead Scrub

Date: 2026-06-23.
Status: public.

## Summary

The Timeline playhead is now a directly manipulable object in every Timeline
view. Previously, moving the playhead by clicking only worked in the raw keyframe
lane; the view a user sees most often — the Motion System view shown when a motion
clip (for example `Cycle` or `Afterimage`) is selected — had no seek interaction at
all, and neither did the Clips lane. Clicking or dragging there did nothing, which
read as a broken playhead.

A single shared scrub foundation drives every view through one path, and the
playhead is one unified object: a continuous line runs through all lanes, capped by
one grabbable head that lives in a dedicated ruler strip above the lanes — so the
head never overlaps clip chips or keyframe diamonds, and "grab the head" works no
matter which body view is shown.

- Click anywhere on the ruler strip or any lane background to jump the playhead.
- Press and drag to scrub continuously; the canvas preview follows.
- Grab the single head in the ruler strip and drag it (it keeps scrubbing even as the
  cursor moves down over the lanes).

Because every view routes through the same path, the behavior is identical
everywhere. Seeking is ephemeral: it pauses playback first and never adds an undo
entry.

## What Users Can Do Now

- Move the playhead by clicking the time ruler or lane background in the Motion
  System view (motion-clip selected), the Clips lane, and the keyframe lane.
- Scrub continuously by dragging across any of those lanes.
- Grab the single playhead head (a focusable slider in the ruler strip at the top of
  the timeline) and drag it to scrub from any view — including dragging down over the
  lanes, where it keeps scrubbing.
- See the transport frame readout and the canvas preview update live while scrubbing.
- Type an exact frame: click the current-frame readout in the transport bar, enter a
  frame number, and press Enter (or click away) to jump the playhead to it.

## How Users Operate It

- Open the Timeline (`⌘+⇧+T`) and, optionally, enter Timeline mode (the expand
  button) for the tall docked layout.
- Click any point on the ruler/lane to seek; press and drag to scrub.
- In the Clips lane, clicking empty lane background seeks, while clicking a clip
  chip selects that clip (it does not move the playhead), and dragging a clip's
  trim handle still trims the clip.
- In the keyframe lane, dragging a keyframe diamond still retimes that key (it does
  not move the playhead); clicking the lane background seeks.
- Keyboard transport is unchanged: Space toggles play, arrows step frames, and
  Home/End jump to the ends.
- Type a frame directly: click the current-frame number in the transport bar (left of
  `/ total`), type the target frame, and commit with Enter or by clicking away; Escape
  cancels. Out-of-range input clamps to `[0, total]` and non-numeric input is ignored.

## What a Reviewer Should Verify

- Select a motion clip so the Motion System view shows, then click and drag the
  ruler/lane: the playhead jumps and follows, and the canvas preview updates.
- Confirm there is exactly one head, in the ruler strip; grab it and drag down over the
  lanes — the playhead keeps scrubbing across a body-view swap.
- Confirm the line is continuous through the ruler strip, the Clips lane, and the body,
  and that the head, a keyframe diamond, and the matching ruler tick line up at the same
  frame.
- In the Clips lane, confirm background click seeks, a clip chip click selects
  without seeking, and trim-drag still trims.
- In the keyframe lane, confirm dragging a diamond retimes the key without seeking,
  and that a keyframe retime is a single undo.
- After scrubbing, confirm no scene undo entry was created (the playhead is not
  reverted by undo) and that starting a scrub while playing pauses playback.
- Click the current-frame readout, type a frame, and press Enter: the playhead jumps
  there; an over-range value clamps and a non-numeric value leaves the frame unchanged;
  the jump adds no undo entry.

## What Is Still Intentionally Limited

- The grabbable head is a pure playhead control: with it focused, plain Arrow keys step
  the frame, but keyframe-editing keys (Delete, Alt+Arrow retime) act only when focus is
  inside the keyframe lane, not the head.
- When the keyframe lane scrolls vertically and its scrollbar appears, the head in the
  top strip can sit up to a scrollbar-width off the diamonds at the far right; the line
  through the lane itself stays aligned with its diamonds.
