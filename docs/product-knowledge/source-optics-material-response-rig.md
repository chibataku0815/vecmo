# Source Optics And Material Response Rig

Status: **beta**

## What changed?

Vecmo now has an artboard-scoped optical relationship that connects one existing
source node to its directional bloom, rays, bounded atmosphere, local lens
consequence, and the surface responses of existing target nodes. The source
node remains the only owner of the visible core. The rig does not create helper
objects, hidden Look nodes, named materials, or artwork presets.

## What can the user do now?

- Turn any visible node into a source without copying its geometry or paint.
- Shape linked or independent Bloom X/Y, threshold, intensity, one bounded ray,
  atmospheric spill, and a source-local spectral lens fringe.
- Bind existing targets to that source and tune Surface, Diffusion, Edge,
  existing-texture coupling, and localized Spectral response independently.
- Move or animate the source/target nodes and keep the response direction
  source-relative because the resolver reads the sampled scene.
- Animate reviewed numeric Bloom, Ray, Atmosphere, Lens, Surface, Diffusion,
  Edge, existing-texture coupling, and Spectral parameters from Inspector or
  Timeline without converting the relationship into scene layers.
- Duplicate, copy/paste, delete, reopen, and export the relationship as native
  scene data rather than as generated Layers.

## How does the user operate it?

Select a source candidate and open Inspector → Source Optics → **Use selected
node as source**. Select another node, choose the rig by stable source name/id,
then use **Bind light response**. Selecting the source exposes optical-owner
controls; selecting a bound target exposes its response channels. Canvas guides
show bloom/ray reach and source-to-target relationships without mutating the
document.

Agent workflows use the six `scene/*source-optics*` commands plus
`motion/set-source-optics-keyframe` and
`motion/remove-source-optics-keyframe`. The motion commands require the full
artboard/rig/ray-or-binding/parameter address and reject the wrong owner scope,
missing optional channel, non-keyframable id, or out-of-range value before a
write transaction opens. `observe_document` returns rig ids, owner roles,
descriptor ranges, Source Optics motion tracks, a frame-zero sampled/static
readback, and per-surface fidelity separately. `observe_node` reports whether a
node is a source or a bound target.

## What should a reviewer manually verify?

- The source core remains narrow and legible when Bloom or Atmosphere increases.
- Atmosphere stays bounded instead of lifting the full artboard.
- Two unrelated targets can keep visibly different Surface/Diffusion/Edge
  responses while sharing one source direction.
- Spectral response remains localized and existing texture is only coupled when
  the target already owns eligible microstructure.
- Layers contains no generated helper objects, and undo/reopen retain the same
  source and target identities.
- Editor SVG, SVG export, Worker SVG, WebM capture, and generated runtime
  report their actual fidelity rather than inheriting a claim from another
  surface.
- Oblique rays retain their authored angle, and a supported direct-WebGPU
  artboard renders Source Optics through ordered node-local effect islands.

Pixel quality remains a human gate. Technical success may produce
`user_review_ready`; it never produces visual acceptance.

## What is still intentionally limited?

- V1 allows one active source owner per target and prevents a source from being
  its own target.
- Up to four rays are stored; the compact Inspector edits the primary ray.
- Rays use one bounded 17-sample maximum directional kernel. SVG, export,
  generated runtime, and WebGPU consume its exact-angle offsets and normalized
  weights; this is sampled optical spread, not physical diffraction.
- The basic vector PDF writer exports the canonical vectors without Source
  Optics pixels and emits an explicit unsupported issue; use SVG or raster
  capture when the optical finish must be retained.
- Direct WebGPU uses generic radiance/surface-response effect-island contracts;
  scene semantics remain in the entity compiler. Wrapper or masked owners,
  consumed mask sources, custom Effect Field routes, invalid tints, or unsupported blend
  arrangements fail the whole artboard to typed SVG fallback before partial
  GPU pixels can appear. The legacy WebGL export path keeps its existing
  deferred fidelity label.
- Source Optics animation is numeric-keyframe only. Membership, enable/bypass,
  identities, binding topology, colors, and custom field ids remain static.
- This is an authored optical-response system, not a physical light transport or
  material simulator.

The non-PDF P2 implementation and completion evidence are governed as one stream by
[`docs/source-optics-material-response-rig-p2-loop-plan.md`](../source-optics-material-response-rig-p2-loop-plan.md):
angle-preserving sampled rays, native direct-WebGPU effect islands, and numeric
Source Optics parameter animation share one target address and sampler. PDF
optical rendering remains intentionally outside that plan.

## Implementation ownership

- Contract, normalization, lifecycle, presentation, and resource budget:
  `src/entities/scene/model/source-optics*.ts`
- Numeric motion sidecar, commands, sampling, serialization, and Timeline:
  `src/entities/motion/model/*` and `src/features/motion/ui/*`
- Shared SVG lowering: `src/entities/scene/model/source-optics-filter.ts` through
  `buildEffectFilter`
- Generic GPU contract/runtime and scene lowering: `src/shared/gpu/*`,
  `src/entities/scene/model/gpu/capability.ts`, and
  `src/widgets/canvas-shell/model/gpu-scene-frame.ts`
- Inspector and guides: `src/widgets/inspector/ui/SourceOpticsControls.tsx` and
  `src/features/source-optics-authoring/canvas/overlay.tsx`
- Agent/MCP: `src/entities/agent/model/*` and `scripts/vma-agent-mcp.ts`
- Export/runtime: `src/features/export/model/*` and the canonical generated
  runtime modules
