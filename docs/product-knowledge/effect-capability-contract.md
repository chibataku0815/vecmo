# Effect Capability Contract

Date: 2026-06-23.
Status: internal foundation.

## Summary

Vecmo now has a machine-readable capability registry for the look/effect controls
that are already reachable in the editor. The registry does not add new UI and
does not add a generic effect catalog. It records which current controls exist,
where they can apply, whether expressions may bind to them, and how faithfully
each export/runtime surface can carry them.

This is the foundation for keeping vector-motion texture honest across authoring,
motion expressions, and code export.

## What Changed?

- The eight current vec-core Look controls are registered as node-level and
  frame-level capabilities: Exposure, Contrast, Saturation, Grain, Noise scale,
  Glow, Glow radius, and RGB split.
- The Analog Film frame recall is registered as a frame recipe preset capability.
- The compact frame influence controls for strength and feather are registered
  as frame-influence capabilities.
- Every capability carries target scope, stack phase, control metadata, and a
  support matrix for editor canvas, SVG export, Motion Runtime JS, React wrapper,
  WebM capture, and recipe JSON.
- Export bundle manifests and generated Motion Runtime JS/React handoff assets
  now include effect-capability fidelity metadata when a vec-core recipe side-car
  is exported. Active capabilities list affected targets and support status per
  runtime/export surface.
- SVG export, PNG/WebM frame capture paths that rasterize through SVG, and the
  Worker still-SVG renderer now apply frame-level `visualRecipe` looks through a
  shared SVG-filter approximation. This closes the gap where Analog Film recalled
  on the frame showed in the editor but disappeared from exported stills.
- Motion expressions can now declare look hooks against registered effect
  capabilities. `recipeOverride` output is rejected by the expression runtime
  unless a definition declares a matching look hook.

## What Can The User Do Now?

Existing Look sliders, Analog Film recall, and frame influence controls continue
to behave as before. The user-visible export behavior is stronger and more
honest: frame Analog Film is visible in SVG/PNG still outputs as an approximation,
and code handoff assets carry a machine-readable effect fidelity manifest beside
the scene, motion, and recipe JSON.

## Why It Matters

Future expression-driven looks and runtime exports can ask one registry what a
control means and whether each output surface renders it, approximates it,
preserves it as side-car data, captures it as pixels, or does not support it.
That prevents texture from silently disappearing when an authored motion asset is
exported as code.

## What Should A Reviewer Verify?

- Existing Look controls still compile through `bun run check`.
- `effect-capabilities.test.ts` proves the current reachable controls are
  registered for the right target scopes.
- Export tests prove recipe side-cars and Motion Runtime JS carry active
  capability ids, affected targets, and support status for code handoff.
- SVG export tests prove a frame-level visual recipe wraps the artboard
  background and layers together, so frame looks survive still export.
- Expression runtime tests prove `recipeOverride` cannot bypass a declared
  capability look hook.

## What Is Still Limited?

- The registry is not yet surfaced in Inspector chrome.
- Look hooks are declaration/runtime contracts only; Inspector chrome does not
  yet render a dedicated look-hook section.
- Motion Runtime JS still preserves vec-core texture as metadata/side-car data;
  it does not yet render every effect natively.
- No high-fidelity WebGPU finishing surface is added here.
