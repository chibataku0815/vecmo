# Easing Template Picker

Date: 2026-07-09.
Status: beta.

## What changed?

The Timeline keyframe easing editor now promotes semantic timing templates
instead of only four technical easing presets.

The first segment-compatible templates are:

- `Linear`
- `Ease in`
- `Ease out`
- `Ease in-out`
- `Snap hold`

Each visible template carries a tiny curve preview and a user-facing label. Most
segment templates keep the sampler-compatible AE temporal-ease contract; `Snap
hold` also inserts an intermediate hold key when the selected segment has enough
frame space, so the snap reaches the next state early and visibly holds it.
Agent/MCP motion commands can request a semantic easing template by id through
`easing: { kind: "template", templateId }`.

Motion-system profiles now expose their shared timing templates in the Inspector:
Time Delay and Offset report `Follow with lag`, Cycle reports `Phase loop`, and
Afterimage reports `Echo sweep` plus loop continuity. These profile templates are
shown as profile context, not as plain segment buttons, because their meaning
comes from expression/profile timing rather than one x-only keyframe segment.

## What can the user do now?

- Select a Timeline keyframe segment and choose timing by intent instead of by
  raw curve vocabulary.
- Compare segment-compatible timing with a compact preview before applying it.
- See the current segment reported as a semantic label when it matches a known
  template.
- Apply `Snap hold` to create an early hold key on roomy segments.
- Inspect grammar/profile timing templates on motion systems without confusing
  them with plain keyframe-segment curves.
- Keep using the lower-level custom curve handles and Start/End influence sliders
  for exact adjustment.

## How does the user operate it?

1. Open the Timeline.
2. Select a keyframe that has an outgoing segment.
3. Use the timing-template buttons in the easing editor.
4. Pick `Ease in`, `Ease out`, `Ease in-out`, `Snap hold`, or
   `Linear`.
5. Use the custom curve handles or Start/End sliders when the template needs
   fine tuning.

The final key in a track still has no outgoing segment, so timing buttons are
disabled there.

## What should a reviewer manually verify?

- Selecting a keyframe shows semantic timing buttons with tiny previews.
- Applying each visible template changes the selected segment's easing and
  updates the active timing label.
- Applying `Snap hold` on a segment with at least two frame gaps inserts a hold
  key before the next key and applies the snap curve to the shortened segment.
  Reapplying it to an already-held segment should not keep adding extra hold
  keys.
- Custom handle dragging and Start/End sliders still work after applying a
  template.
- The final keyframe correctly shows `No segment` and disables timing edits.
- Motion-system Inspector profiles show their timing-template chips with tiny
  previews when the selected binding has profile timing metadata.
- Agent/MCP `easing: { kind: "template", templateId: "absorb.soft-land" }`
  compiles to a keyframe-segment write, while a profile-only template reports a
  typed unsupported-template issue.
- Agent/MCP `easing: { kind: "template", templateId: "snap.quick-lock" }`
  inserts the same early hold key when the addressed segment has room.

## What is still intentionally limited?

- Profile-only templates such as `Follow with lag`, `Settle after impact`, and
  `Phase loop` are not promoted in the plain keyframe-segment picker because the
  current segment format cannot preserve lag, settle physics, or phase
  continuity.
- The preview is a compact curve/dot sparkline, not a live canvas ghost preview.
- `Snap hold` falls back to a single segment curve when the selected gap is too
  short to insert a hold key.
- Agent/MCP `Snap hold` uses the same hold metadata as the Timeline path for
  `motion/upsert-keyframe` and `motion/set-keyframe-easing`; gaps too short for a
  hold key fall back to the segment curve.

## QA status

QA run on 2026-07-09 after the first implementation and UX-label revision:

- Scoped Biome on touched source files passed after formatting.
- Scoped Oxlint on touched files exited 0; it reported two non-blocking existing
  warnings outside this feature's changed logic.
- `check:arch`, `check:tokens`, `check:agent-contract`,
  `check:product-knowledge`, `check:public-english`,
  `check:reference-scenes`, and `check:reference-scenes-fresh` passed.
- `tsc -b` passed after widening the template registry for helper filters.
- `bun run test` passed: 124 test files, 1288 tests.
- A focused domain smoke confirmed `Snap hold` inserts the expected hold key and
  does not duplicate it when reapplied.
- `bun run build`, `bun run check:bundle`, and a Vite preview HTTP smoke for `/`
  and `/editor` passed.

Full `bun run check` is not green in this worktree because it is blocked before
later gates by unrelated untracked `artifacts/**` formatting and an existing
`EditorPage.tsx` import-order issue. Separately, `check:runtime-sampler` reports
the committed runtime sampler bundle as stale; this feature did not touch the
sampler source or generated bundle.
