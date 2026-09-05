# Mask SVG / Motion Dependency Inversion

Date: 2026-07-03.
Status: internal.

## Summary

`src/entities/scene/model/mask-svg.ts` previously value-imported
`effectiveShape`/`effectiveTransform` from
`src/entities/motion/model/sampler.ts`, while `entities/motion/**` value-imports
`entities/scene/**` extensively (corner geometry, gradient edit, look graph, mesh
edit, scene types, and more). That created a real entity-layer import cycle
between `scene` and `motion`, where the intended order is `scene` (foundational)
← `motion` (depends on scene). This is an internal architecture fix: it does not
add, remove, or change any authoring, motion, or export behavior.

## What Changed?

- `mask-svg.ts` no longer imports `effectiveShape`/`effectiveTransform` from
  motion. Its `MaskSvgContext` type gained a new field,
  `effectiveGeometry: MaskEffectiveGeometryResolver`, a locally-defined,
  motion-free structural type describing the two functions' exact existing
  signatures. `buildMaskDefSvg` and the internal path-geometry silhouette
  helper now call `ctx.effectiveGeometry.effectiveShape`/`.effectiveTransform`
  instead of the module-level import. `buildSceneMaskSvgArtifacts` gained a new
  required 4th parameter of the same resolver type, which it threads into the
  `MaskSvgContext` it builds.
- Every caller was updated to pass motion's real `effectiveShape`/
  `effectiveTransform` through unchanged: the two `buildMaskDefSvg` call sites
  in `src/features/export/model/svg.ts` (in-app SVG export), and the two
  `RUNTIME_SAMPLER.buildSceneMaskSvgArtifacts(...)` call sites inside
  `src/features/export/model/code.ts`'s embedded runtime player source
  (`renderFrame`/`renderSequenceFrame`), which now also read
  `RUNTIME_SAMPLER.effectiveShape`/`.effectiveTransform` — newly re-exported
  from `src/features/export/model/runtime-sampler-entry.ts` so the standalone
  runtime bundle can supply the same resolver to itself.
- Same functions execute with the same arguments in the same order as before;
  this is a signature/wiring change only, not a logic change. The regenerated
  `runtime-sampler.generated.ts` bundle reflects the same re-exported
  `effectiveShape`/`effectiveTransform` plus the updated `mask-svg.ts` call
  sites.

## What Can The User Do Now?

Nothing new is user-reachable. Masks, clip paths, feathering, and stroke-only
blur render and export byte-identical to before this change, in the editor
canvas, the in-app SVG export, and standalone runtime playback.

## Why It Matters

`entities/scene` is meant to be foundational — the layer every other layer
(including `entities/motion`) depends on, never the reverse. A live cycle
between two entity slices undermines that invariant: it makes the two modules'
build/type graph mutually dependent instead of a clean scene → motion order,
and it made `entities/scene/**` no longer safely usable without pulling in
`entities/motion/**`. Injecting the effective-geometry resolver instead of
importing it restores the intended one-directional dependency without changing
what either module does.

## What Should A Reviewer Verify?

- `bun run check` passes (static gate: architecture, tokens, product knowledge,
  public-English, runtime-sampler freshness, reference scenes, `tsc -b`).
- `rg -n "from \"@/entities/motion" src/entities/scene --type ts` shows no
  remaining value-level import of `entities/motion` from `mask-svg.ts` (the
  file's only remaining motion reference is `import type { MotionDocument }`,
  which the layer rule exempts).
- A manual editor smoke on a document using "use as mask"/clip and a path-kind
  mask source with active motion: masks, clipping, feathering, and stroke blur
  render identically pre/post this change in the canvas, the in-app SVG
  export, and an exported runtime preview.

## What Is Still Limited?

- This is a pure dependency-inversion refactor with no user-facing surface; it
  does not add a feature, control, or capability.
- Two other value-level `scene → motion` imports were found during this audit
  (`expression-presentation.ts` → `grammar-bridge.ts`, both value-level) and
  were left unchanged — they were not part of this task's scope and are a
  separate cycle to address on their own.
