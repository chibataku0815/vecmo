# Hello Motion

Date: 2026-09-06. Status: reference-scene gallery entry (Motion category).

## Summary

**Hello Motion** is a `/tutorials` reference scene authored to reach the
**FLAT** motion-artifact export tier (`selectMotionArtifactRuntimeSamplerTier`
in `features/export/model/code.ts`), unlike every other gallery scene: rects
stagger in (ease-out slide + fade), an orbiting pair loops the full 4-second
duration, and a diamond settles with an overshoot ease. No `effectIntent`,
node `recipe`/`style.effects`, masks, mesh-gradient paint, blend nodes,
interactions, grammar bindings, or look graph/scene camera — plus
`cameraSpacePolicy: "screen_2d"`, every condition FLAT requires.

## What Users Can Do Now

- Play the loop and see plain eased keyframe motion (ease-out, linear orbit,
  overshoot settle) with no baked technique, then export via Export → Motion /
  Code → the `EMBED` Motion Artifact item for a runtime measured at 48.3KB gzip
  — under the 50KiB stretch budget (`motion-artifact-budget.ts`) and well
  below every effects-bearing sibling's 115-152KB gzip.

## Related Docs
- [Motion code runtime export](./motion-code-runtime-export.md)
