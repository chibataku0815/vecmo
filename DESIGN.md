# Vecmo Design-Judgment Contract

This file is the short, stable entry point for authored visual quality. It does
not define editor chrome; [`docs/design-system.md`](docs/design-system.md) owns
that surface. Detailed motion and review procedures live in the linked
knowledge documents.

## Evidence Separation

Keep two ledgers:

- **technical eligibility**: save/reopen, serialization, renderer fidelity,
  runtime, export, frame count, hashes, and delivery;
- **visual judgement**: first read, contour, crop, overlap, counterform, scale
  ratio, material boundary, edge-softness ownership, density distribution,
  focal isolation, negative-space pressure, motion causality, and ending.

Technical eligibility never raises a visual score. Implementation difficulty,
node/effect/track counts, documentation volume, and automatic similarity are
not aesthetic evidence.

## Authority

- A producer may reject its work, request one residual iteration, or mark it
  ready for user review.
- A producer may not pass its own work.
- A critic sees pixels before the brief, names, implementation metadata,
  delivery facts, or the producer's preferred score.
- A critic may return `visual_reject`, `retry_one_residual`,
  `user_review_ready`, or `critic_uncertain`.
- Only the user gives final aesthetic acceptance.

Separate chats or agents are not automatically independent judges. Calibrate a
critic with accepted/rejected pixel anchors and user reasons, while keeping the
current candidate identity and implementation history blind until verdict lock.

## Native-First Review

Judge the authored native image first. Use diagnostic ablations only to answer
one named ownership question.

Grain may be a load-bearing carrier of form, light, depth, boundary, or
material identity. Grain-off is optional and is never a required capture,
automatic rejector, or pass condition. Reject grain only when the visible
result shows it is uniform, screen-owned, or causally unrelated.

The same rule applies to glow, atmosphere, camera, and other contributors:
ablation diagnoses ownership; it does not define beauty.

## Material Causality Gate

Simple geometry is allowed. Material quality must come from a causal chain, not
from adding more shapes:

```text
light source
-> regional surface response
-> material boundary / edge behavior
-> atmosphere or lens propagation when owned
```

Reject a still as digitally generic when gradient and blur are uniform, every
object is the same treatment in another color, highlight-to-dark transition is
flat, or grain/glow/fog floats at screen level instead of responding to the
light and form. More layers or information do not repair a missing causal
relation.

## Reference-Relative Specificity

Before reducing a reference to abstract laws, preserve observations for:

- contour and counterform;
- crop, overlap, and scale ratio;
- material boundary and regional edge softness;
- density distribution and focal isolation;
- negative-space pressure.

Use private reference pixels only for calibration. Do not copy pixels, trace
private vertices, persist references into SceneDocument/cloud storage, or embed
them in tracked docs.

## Blandness Gate

Reject a clean and coherent result when it remains exchangeable with a generic
template. Warning reads include loader, HUD, effects reel, wallpaper, sticker,
generic abstract study, and appended title card.

Authored distinctiveness requires at least one visible relation that a generic
system would not choose and that materially affects hierarchy, form, material,
space, motion, or ending. More objects, operators, effects, or detail do not
substitute for that relation.

## Artifact Ladder

Use the cheapest artifact that can disprove the current direction:

```text
art-direction thesis
-> native opening still
-> material / middle-passage still
-> short animatic with terminal pose
-> full production
```

At each step:

```text
frozen pixels
-> metadata-blind critic verdict
-> one locked largest residual
-> producer retry or bounded user gate
-> next artifact only after user acceptance
```

A weak opening still blocks motion and full production. Later delivery cannot
rescue an earlier visual failure.

## Section Ownership

- Section 07/reference direction owns visible art direction.
- Section 03 owns under-the-hood construction discipline: anchors, ratios,
  counterforms, boolean/offset/repeat relations, shared controls, selective
  detail, negative space, and editability.
- Construction technique or operator count never increases the visual score.

## Required Reading

- [`docs/knowledge/motion-concept-primer.md`](docs/knowledge/motion-concept-primer.md)
- [`docs/knowledge/vecmo-concept-gate-template.md`](docs/knowledge/vecmo-concept-gate-template.md)
- [`docs/knowledge/section-07-quality-production/aesthetic-judgment-first-action.md`](docs/knowledge/section-07-quality-production/aesthetic-judgment-first-action.md)
- [`docs/knowledge/section-07-quality-production/material-field-authorship-protocol.md`](docs/knowledge/section-07-quality-production/material-field-authorship-protocol.md)
- [`docs/vecmo-generic-visual-review-and-effect-field-loop-plan.md`](docs/vecmo-generic-visual-review-and-effect-field-loop-plan.md)
