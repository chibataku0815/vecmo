# Axis-Aligned Anisotropic Blur

Date: 2026-07-11.
Status: beta.

## Summary

Layer blur and the Look Graph Blur node can now use separate X and Y Gaussian
radii. This creates an axis-aligned anisotropic blur while preserving the old
single-radius document form when the axes are linked. It does not claim an
angle, path, velocity, shutter, or physically simulated motion blur.

## What Changed?

- Inspector → Appearance → Layer blur has **Link X / Y**. Linked mode stores only
  `radius`; unlinking seeds Y from X and exposes separate X/Y controls.
- Look Graph Blur has the same link control and separate X/Y sliders.
- Relinking removes `radiusY`. If the Look Y radius has animation, the UI warns
  that relinking removes that entire Y track; scene and motion commands share a
  compound undo identity.
- Linked Look blur ignores stale Y tracks, and agent/MCP writes reject a new Y
  keyframe until an explicit static `radiusY` unlinks the axes.
- Editor SVG, client SVG export, Worker SVG, and SVG-capture output lower the two
  radii to `feGaussianBlur stdDeviation="x y"`.

## How To Use

Enable Layer blur or add a Look Graph Blur node, turn off **Link X / Y**, then
set X and Y independently. Turn the link back on to restore isotropic blur and
the legacy single-radius representation.

## What A Reviewer Should Verify

- Linked X/Y stays isotropic and serializes without `radiusY`.
- Unlinked X/Y produces an axis-aligned elliptical blur footprint.
- Multi-selection exposes a mixed link state without overwriting unrelated
  values.
- Relink plus undo restores both a Look node's Y radius and its Y animation.
- No UI or documentation calls this arbitrary-angle or trajectory motion blur.

## Limits

The axis cannot rotate. Background blur has no independent Y radius. Runtime
surfaces that do not render the underlying blur remain unaffected. Tests,
typecheck, build, browser smoke, and export parity capture were not authorized in
this task, so the feature remains beta.
