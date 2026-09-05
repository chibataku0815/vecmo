# Time Delay Motion System

Date: 2026-06-22.
Status: first production-authoring slice.

## Summary

Vecmo can now create a Glammer-style Time Delay motion as an editable motion
system instead of a pile of copied keyframes.

The important product shift is:

- `Time Delay expansion` is the timeline entry for the whole motion system.
- `master-instances` is the internal model: master objects drive delayed
  generated instances.
- Users edit the motion timing from the selected clip.
- Users edit visual form and vec-core look by selecting the master/source objects.
- Inspector and Timeline share a Motion System Map so master objects and
  generated support objects are visible as role buckets, not as a duplicated
  Layers tree.
- The profile declares its editable output path: `Create editable motion` turns
  the live Time Delay profile into ordinary editable motion artifacts when the
  user explicitly asks for it.

This reduces timeline noise and makes the system easier to explain: one motion
clip controls the delayed replay, while real workspace objects remain editable.

## What Users Can Do Now

- Create a Time Delay system from the Inspector Motion section.
- Select the `Time Delay expansion` clip in the Timeline.
- Edit clip `Start` and `Duration` in the Inspector.
- Edit semantic Time Delay parameters such as `Period frames`,
  `Stagger frames`, `Instance delay`, and `Instance spacing`.
- Use `Master objects -> Select` to jump from the motion-system clip back to the
  real editable workspace objects.
- Change the selected master objects' fill, stroke, radius, transform, and
  vec-core look from the normal Inspector panels.
- Read the Motion System Map: `Editable scene objects` are the replaceable master
  objects, while `Generated support objects` are driven by the Time Delay profile.
- Preview and create editable output from the same profile-visible expansion
  contract instead of guessing what the old bake action will emit.
- Scrub or play the Timeline and see the generated delay update from the system.
- Export SVG or PNG-derived frames and keep the frame-level Analog Film finish:
  grain, grade, and chromatic fringe are now applied to the exported artboard
  content instead of appearing only in the editor canvas.

## How To Use

1. Open the editor and select or create the Time Delay system.
2. Open the Timeline.
3. Click the `Time Delay expansion` clip.
4. Confirm the Inspector badge changes to `clip`.
5. Change `Duration` to retime the whole Time Delay cycle.
6. Change `Period frames` if you want the motion period to match a specific
   frame count; it stays synchronized with the clip duration in clip mode.
7. Click `Master objects -> Select` when you want to edit the actual objects.
8. Edit those selected objects using the regular Appearance and vec-core Look
   controls.
9. Click the `Time Delay expansion` clip again when you want to return to
   motion-system timing controls.

## Timeline Behavior

When `Time Delay expansion` is selected, the Timeline switches from scalar
keyframe rows to `Motion system` mode.

The Timeline shows:

- clip duration
- local frame inside the clip
- replaceable/total role count
- runtime-only artifact count
- Motion System Map buckets such as `Objects` and `Support`
- expression range, for example `trackless-expression · 0-89f`

This is intentional. The Time Delay system is not authored by manually editing
X/Y/Scale/Opacity rows for every delayed dot. Those rows become relevant only
after an explicit bake.

## Inspector Behavior

Clip selection shows motion-system controls:

- `Start`
- `Duration`
- `Master objects`
- Motion System Map buckets for editable objects and generated support roles
- Time Delay authoring profile controls
- `Preview editable output` and `Create editable motion`, using profile-owned
  labels and output descriptions

Object selection shows normal object controls:

- Transform
- Appearance
- Fill/stroke/radius
- vec-core Look
- Motion role summary

This prevents the right panel from duplicating the Layers panel. The Inspector
does not list every object as a second layer tree; it exposes the action needed
for the current mode.

## Manual Verification

Use this smoke path after changing the Time Delay system:

1. Create a `Time Delay` system.
2. Confirm workspace objects named `Time Delay dot 1` through
   `Time Delay dot 5` exist in Layers.
3. Confirm a `Time Delay expansion` clip exists in the Timeline.
4. Click the clip and confirm Inspector badge is `clip`.
5. Confirm the Inspector shows `Start`, `Duration`, and `Master objects`.
6. Confirm the Motion System Map shows `Objects` for editable masters and
   `Support` for generated satellites.
7. Confirm the output controls read `Preview editable output` and
   `Create editable motion`.
8. Change `Duration`, then confirm `Period frames` and the Timeline clip range
   update together.
9. Trim the clip in the Timeline, then confirm `Period frames` follows the new
   clip duration.
10. Compare the active stage against the Glammer Time Delay reference: dark
   capsule bodies, warm film-white background, arced delayed wave, cyan/orange
   chromatic fringe, and no unwanted blur are the fidelity bar.
11. Confirm Timeline lower content is `Motion system`, not per-dot scalar key rows.
12. Click `Master objects -> Select`.
13. Confirm Inspector returns to normal multi-object editing and shows
   `5 selected`.
14. Change an object look or appearance value and scrub the Timeline.
15. Export a frame to SVG or a PNG-backed path and confirm the Analog Film frame
    look remains visible in the exported output, including film grain and the
    cyan/orange chromatic edge.

## Known Limits

- This page documents the hardened Time Delay slice. The other motion grammar
  techniques still need equivalent product-knowledge entries as their authoring
  surfaces reach this quality level.
- `Time Delay expansion` is trackless by default. Full scalar keyframe editing is
  intentionally behind explicit bake/materialization.
- Runtime retime correctness is supporting evidence only. Sign-off still depends
  on matching the Glammer reference motion and vec-core look.
- Replacement with arbitrary imported objects is part of the broader workspace
  materialization contract, but this page only documents the current Time Delay
  editing path.
- SVG/PNG export uses the shared SVG-filter approximation of the frame recipe,
  not the future full vec-core/WebGPU finishing renderer. The result is intended
  to preserve the authored Analog Film read, not to be a pixel-identical film
  simulation.

## Related Docs

- [Motion workspace materialization contract](../motion-workspace-materialization-contract.md)
- [Motion system clip editor plan](../motion-system-clip-editor-plan.md)
- [Vecmo motion grammar demo flow](../vecmo-motion-grammar-demo-flow.md)
