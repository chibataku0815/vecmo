# Afterimage Motion System

Date: 2026-06-22.
Status: beta Glammer Master Rotation Echo profile; runtime echo artifacts are
implemented, but visual parity still needs browser capture sign-off.

## Summary

Vecmo can now create `Afterimage` as a Glammer Master Rotation Echo authoring
system: two editable opposing source dots, one shared master rotation profile,
nine delayed runtime echo copies per dot, rest-tail vanish behavior, and a
neutral film background with the existing frame-level `Analog Film` look applied.
This keeps Afterimage on the same working grain/chromatic path as the manual
Frame Look recall instead of using a custom per-node recipe. This is a beta
authoring surface until a browser capture proves the same circular rotating dot
shape and tail behavior as the Glammer reference.

The important product shift is:

- `Afterimage` is the timeline entry for the Master Rotation Echo profile.
- `presentation-duplicates` is the internal model: real source objects stay in
  Layers, while echoes are live presentation artifacts until explicit bake.
- Users edit the two orbit dots as real scene objects.
- Users edit clip `Start` and `Duration` from the selected clip, while profile
  parameters such as loop frames, sweep frames, echo delay, tail copies, falloff,
  orbit radius, dot radius, and easing stay in the Motion Inspector.
- Inspector and Timeline share a Motion System Map so source dots and runtime
  echo tails are shown as motion role buckets, not as duplicate layer rows.
- The profile declares its editable output path: `Create editable echoes` turns
  runtime echo tails into explicit editable output when the user requests it.

## What Users Can Do Now

- Create an Afterimage system from the Inspector Motion section.
- Get a recognizable Master Rotation Echo composition on the current artboard:
  two black orbit dots on a warm film background.
- Select the `Afterimage` clip in the Timeline.
- Edit clip `Start` and `Duration` in the Inspector.
- Use `Source objects -> Select` to jump from the clip back to the real editable
  source dots.
- Read the Motion System Map: `Editable scene objects` are the two orbit dots,
  while `Runtime presentation artifacts` are the delayed echo tails.
- Preview and create editable echo output from the same profile-visible expansion
  contract, without pretending runtime echoes are layer objects.
- Scrub or play the Timeline and see delayed tail copies follow the master
  rotation using clip-local time; outside the clip range the live afterimage
  duplicates are inactive.

## Manual Verification

Use this smoke path after changing the Afterimage system:

1. Create an `Afterimage` system.
2. Confirm the current artboard now contains two editable black orbit dots on the
   film background.
3. Confirm an `Afterimage` clip exists in the Timeline.
4. Click the clip and confirm Inspector badge is `clip`.
5. Confirm the Inspector shows `Start`, `Duration`, and `Source objects`.
6. Confirm the Motion System Map shows `Objects` for source dots and `Runtime`
   for echo tails.
7. Confirm the output controls read `Preview echo output` and
   `Create editable echoes`.
8. Confirm the Timeline lower content is `Motion system`, not scalar key rows.
9. Change `Duration`, then confirm `Loop frames` and the Timeline clip range update
   together.
10. Trim the clip in the Timeline, then confirm `Loop frames` follows the new clip
   duration.
11. Compare the active frame against the Glammer Master Rotation Echo reference:
   two opposing dots should share one circular rotation profile, with delayed
   tail copies and no scalar keyframe rows.
12. Click `Source objects -> Select`.
13. Confirm Inspector returns to normal object editing for the source dots.
14. Scrub before, inside, and after the clip range and confirm echoes only appear
   inside the clip.

## Known Limits

- Echoes remain live presentation duplicates by default. Explicit bake is still
  the path for materialized clone nodes and scalar tracks.
- Playback creates, updates, and removes live echo artifacts from the sampled
  presentation scene; this keeps the layer panel focused on real editable source
  dots.
- The current profile is parameter-faithful and reference-oriented, but exact
  shape/motion matching against the Glammer web page still requires browser
  visual smoke and tuning passes. Do not treat it as complete until that capture
  shows two opposing same-shape circular dots and matching delayed tails.
- The visual finish comes from the canonical frame-level `Analog Film` look; do
  not reintroduce Afterimage-specific node look recipes for the dots or echo
  artifacts.
- The live playback fix is a bounded duplicate SVG patch path. The broader P4
  presentation patch/index model remains the scaling path for larger documents.
- Afterimage reuses the common motion-system Inspector and Timeline contract.
  There is intentionally no Afterimage-only panel.

## Related Docs

- [Motion system clip editor plan](../motion-system-clip-editor-plan.md)
- [Integration with Visual Effect Core and Motion Grammar Lab](../integration-with-vec-core-and-motion-grammar.md)
