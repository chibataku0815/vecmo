# Wavefront Range Selector

Date: 2026-06-28.
Status: essence slice (parameters + MCP + minimal Inspector). The three range
parameters render and commit through the Inspector's generic technique-parameter
editor, and `rangeShape` shows as a labeled dropdown. A unified "Animate as
sequence" surface is a later slice.

## Summary

The per-target stagger of the two ordered time techniques — `Time Delay` and
`Time Offset` (time-offset-propagation) — can now be **shaped** instead of being a
fixed uniform `index * stagger` ramp. A Range Selector (the same selection
primitive the text Sequence uses) reshapes how the stagger is distributed across
the ordered target set: front-loaded, back-loaded, eased, or windowed.

The product shift is small and safe by construction:

- The default is the identity selector, so every existing binding keeps its exact
  prior uniform stagger — byte-identical, no migration, no version bump.
- The selector rides three flat numeric parameters on the binding, so it flows
  through the existing MCP write path, the timeline sampler, and the editable bake
  (decomposition) with no new serialization.
- Editor playback and exported runtime share one wavefront helper, so a shaped
  stagger looks the same in the editor and in the exported motion.

## What Users / Agents Can Do Now

- Set three parameters on a `Time Delay` or `Time Offset` binding — in the
  Inspector's technique parameters, or via the agent / MCP
  `apply_motion_grammar_commands` path:
  - `rangeStart` (0–100, percent of the ordered set) — where the wavefront begins.
  - `rangeEnd` (0–100) — where the wavefront ends.
  - `rangeShape` — the Inspector dropdown labels these by behavior: `0` **Linear**
    (front to back, the identity), `3` **Smooth** (eased), `2` **Reverse** (back to
    front), `1` **Window (sub-range)**. The selection value is a per-target
    *time-offset* (0 = fires first, 1 = fires last), so Linear / Smooth / Reverse
    are sweeps; `Window` is not a sweep — it splits the set into an in-range cohort
    (fires late) and an out-of-range cohort (fires early) via `rangeStart`/`rangeEnd`,
    so it only staggers when you narrow the window (a full-range `Window` fires every
    target together).
- Leave them unset to keep the current uniform stagger; the catalog defaults
  (`0 / 100 / 0`) are the identity wavefront.
- Apply the shaped stagger to **any real-node ordered set** — outline groups,
  shapes, duplicate-generator instances — not only text.

## Scope (hard lines)

- **Real-node ordered sets only.** Live-text glyph runs keep the pose-delta text
  animator; grammar samples are node-keyed and glyph runs are not scene nodes.
- **Base technique path only.** The Glammer `Time Delay expansion` authoring
  profile has its own timing sampler and is unchanged by this slice.
- **Two techniques only.** `Time Delay` and `Time Offset` adopt the selector
  first; the other ordered techniques are a later, per-technique step (each has its
  own notion of "ordered position" — a shuffled rank, a centre distance, an
  activation cursor — so the adoption is not a uniform substitution).
- **Minimal Inspector only.** The three range params render in the generic
  technique-parameter editor (`rangeShape` as a labeled dropdown). A purpose-built
  range window + shape control, and unification with the text "Animate as sequence"
  flow, is a later slice.

## How It Works

- The shared value-math lives in `src/shared/sequencer/range-selector.ts`
  (`selectorValueCore`, `combine`) — the same primitive the text animator consumes.
- `wavefrontDelay(index, count, selector, step)` projects a selection value to a
  per-target delay. The uniform (full-range, linear) selector returns `index *
  step` bit-exact, so the default path never drifts.
- The grammar evaluator builds the selector from the flat params and feeds the
  delay into the two ordered sites (`sampleTimeDelay`, `sampleTimeOffsetPropagation`).
- The ordinal → position normalization is per-projection: a grammar wavefront maps
  endpoints `index / (count - 1)`, unlike the text animator's centre-of-cell map.

## Manual Verification

1. Author a `Time Delay` binding over an ordered set of 4+ real nodes; leave the
   range params unset. Confirm the stagger is the usual even wavefront.
2. Set `rangeShape` to `3` (smooth) and scrub: the wavefront should ease in and
   out instead of being perfectly linear.
3. Set `rangeShape` to `2` (ramp-down): the wavefront should reverse (the last
   target leads).
4. Narrow the window (`rangeStart` 25, `rangeEnd` 75): targets outside the window
   collapse toward the window edges; inside, the stagger compresses.
5. Reset the params to `0 / 100 / 0` and confirm the motion is identical to step 1.
6. Export the artboard and confirm the shaped stagger matches the editor.

## Known Limits

- Authoring is via the generic Inspector parameter editor or MCP; a purpose-built
  range control (and the "Animate as sequence" convergence) is a later slice.
- The flat `rangeShape` int encodes a discrete shape; a continuous softness and a
  keyframed window sweep (as the text selector has) are a later, serialization-
  touching slice.
- Decomposition (editable bake) samples the evaluator, so a shaped stagger bakes
  numerically correct; the parametric selector itself is not yet reconstructed as
  editable per-stop keyframes.

## Related Docs

- [Time Delay Motion System](./time-delay-motion-system.md)
- [Motion code runtime export](./motion-code-runtime-export.md)
