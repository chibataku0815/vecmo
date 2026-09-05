# Reproduction Descriptor Importer

Date: 2026-07-09.
Status: internal foundation with MCP load path.

## What Changed

Vecmo has a pure importer seam for the accepted upstream reproduction-descriptor
shapes. The maintained app owns a small structural input adapter for the fields
it consumes, so a Forestone producer does not become a runtime package
dependency. The importer converts the selected descriptor into editable Vecmo
documents:

- `SceneDocument`
- `MotionDocument`
- `MotionGrammarStoreDocument`
- role-node id mapping
- acceptance-check scaffold
- typed import issues routed to descriptor, camera-space, Vecmo primitive, or
  acceptance layers

The first implementation preserves camera-space intent by creating scene-camera,
depth-plane, and target/null data when the descriptor policy is not `screen_2d`.

## What Users Can Do Now

There is no public Import menu action. Internal tooling can call
`createReproductionDescriptorSkeleton`, and MCP agents can call
`load_reproduction_descriptor` with either a descriptor object or a JSON path, to
turn a video-reference descriptor into a Vecmo-native editable skeleton instead
of inventing roles and drivers from prose on every attempt.

## How To Operate It

Call `src/features/reproduction-descriptor/model/descriptor-import.ts` directly,
or use MCP `load_reproduction_descriptor`. The MCP tool returns scene, motion,
grammar, role-node mapping, acceptance scaffold, summary counts, and typed import
issues. The caller still decides when to load it into the editor, write a backup,
or create a reproduction attempt result. Video inference compiles this contract
from evidence plus an explicit authored selection; Vecmo never reads
provider-private graph state.

## Manual Verification

1. Use the Gravity descriptor from `motion-production-state-inference`.
2. Confirm generated role nodes map to proof probe, mass, body family, and event
   plane.
3. Confirm `vector_2_5d` creates `SceneDocument.sceneCameras`,
   `Artboard.activeSceneCameraId`, a force-center target/null controller, and
   `VectorNode.depthPlane` assignments.
4. Confirm camera/depth `doNotBake` constraints appear in returned issues.
5. Confirm acceptance checks are returned as `unreviewed` scaffold rows.

## What Is Still Intentionally Limited

- No public Import UI, command-palette action, backup writer, or reference-gallery
  loading path exists yet.
- The first motion is a reference-skeleton seed, not exact AEP recovery.
- Motion-grammar bindings remain empty until descriptor fields map to concrete
  Vecmo technique ids.
- Camera and target track claims are preserved as issues unless the descriptor
  provides numeric camera keyframes.
