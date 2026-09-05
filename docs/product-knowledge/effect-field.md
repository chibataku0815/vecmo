# Effect Field

Date: 2026-07-11.
Status: beta.

## Summary

Effect Field is Vecmo's reusable answer to “where should this property apply,
and by how much?” A field is independent from the property it drives: Contour,
Linear, or Mesh geometry produces a normalized matte, then a registry-owned
route applies that matte to an existing canonical owner. It is not a material
preset and does not choose art direction.

## What Changed?

- The selected-object Inspector has an **Effect Field** section, and the
  ToolRail / `E` shortcut activates direct field controls.
- **Contour**, **Linear**, and **Mesh** use one persisted source contract,
  including strength, invert, feather, and linear/smoothstep/gamma/threshold
  response controls.
- Top-level objects expose direct canvas handles. Nested selections stay numeric
  because guessing a nested coordinate conversion would be unsafe.
- A field can be shared by several routes. Link/unlink preserves an inline
  fallback; delete, duplicate, same-document copy/paste, artboard duplicate, and
  serialization pruning preserve or clean the related identity.
- The target registry currently renders three canonical routes on the editor,
  client SVG export, and Worker SVG: `style.opacity`,
  `style.effects.layer-blur`, and `recipe.glow.bloom`. Blur and Glow routing
  control wet mix and require an existing visible, non-zero owner.
- `scene/patch-effect-field` exposes the same generic operations to agent/MCP
  clients. Unknown targets, duplicate field ids, duplicate routes, ambiguous
  ownership, and newly deferred routes are rejected rather than first-wins.

## How To Use

1. Select one top-level object.
2. Open Inspector → **Effect Field** and choose **Opacity**, **Layer blur wet
   mix**, or **Glow wet mix**. Add the corresponding non-zero effect first for a
   wet-mix route.
3. Choose Contour, Linear, or Mesh. Use the `E` tool to manipulate the geometry
   on canvas, or enter exact values in the Inspector.
4. Tune strength, invert, feather, and falloff. Link to an existing compatible
   field only when several effects should share exactly the same spatial owner.
5. Remove the route when the field should no longer affect that property.

## What A Reviewer Should Verify

- A field changes only the registered property and does not create a new Look,
  material, or preset.
- Editor canvas, client SVG, and Worker SVG agree for opacity, layer-blur wet
  mix, and Glow wet mix; WebM preserves them through the SVG capture path.
- Contour visibly follows the source alpha, Linear follows its endpoints, and
  Mesh follows edited values without an unexpected full-frame fallback.
- A malformed or missing source stays inert and reports an issue.
- Linked routes update together; unlink keeps the last valid inline snapshot.
- Duplicate ids/routes block editing instead of choosing the first match.

## Fidelity And Limits

- Contour is a 12-shell SVG approximation. Mesh is a 512px local matte
  approximation. Non-linear falloff uses a sampled transfer table. These are
  labelled approximations, not pixel equivalence.
- Standalone runtime output retains the side-car but its generated sampler has
  not been regenerated. Direct WebGL has no field-matte pass. WebM is
  capture-only through the SVG presentation route.
- Mask feather and stroke softness have typed canonical descriptors but remain
  deferred until their spatial owner adapters are unambiguous. Silhouette alpha
  softness is unsupported because the scene model has no canonical owner.
- Cross-document clipboard transfer is not wired. Same-document copy/paste and
  ordinary duplicate paths are wired.
- Browser/GPU/4K performance, build, typecheck, and automated checks were not
  authorized in this task, so the feature remains beta.

## Product Rule

New localized effects must register a canonical property owner and reuse this
field system. Do not add artwork-specific field types, Glow Sphere presets, new
Look nodes, or automatic aesthetic scores to imitate a single accepted piece.
