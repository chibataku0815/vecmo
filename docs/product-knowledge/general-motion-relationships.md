# General Motion Relationships

Date: 2026-07-13  
Status: **beta**

## What changed?

Vecmo now evaluates motion-parent/controller relations as a camera-independent
2D presentation capability. A controller can drive scattered scene nodes without
restructuring Layers or copying its keyframes into every child.

The relation is preserved through Scene save/reopen, clipboard/artboard/component
id remap, canvas presentation, client SVG/PDF, Worker still SVG, Motion / Code,
and generated WebGL runtime sampling. Invalid parents, cycles, cross-artboard
links, singular transforms, and malformed bind matrices remain typed issues with
a deterministic structural-pose fallback. Valid relation results carry an exact
presentation-only affine matrix, including shear produced by rotated
non-uniform scale, while authored and persisted node transforms remain TRS.

## What can a user do now?

- Create one motion controller at the current selection center or artboard center.
- Create and bind in one undoable action while keeping every selected node in its
  existing structural layer/group.
- Animate the controller with the ordinary Transform/keyframe workflow.
- Keep child-local position, rotation, scale, and pivot motion independent while
  inheriting the controller transform.
- Bind selected nodes to a selected primary controller without a visible jump.
- Detach at any playhead frame without a visible jump; animated child channels
  receive current-frame keys in the same compound undo.
- Inspect parent identity, controller child count, missing-parent state, and jump
  between controller/children.
- Use Agent/MCP to bind or detach at an explicit frame with the same keep-pose
  planner as the editor. Coordinated Scene + Motion writes land as one compound
  undo step.

## How to use it

1. Select the nodes to rig and run **Create motion controller** from the command
   palette. The controller becomes the selection.
2. Move, rotate, scale, or keyframe the controller like an ordinary node. Its
   canvas crosshair and current-selection relation lines are authoring chrome;
   they are not exported paint.
3. To use an existing controller, multi-select children and the controller, make
   the controller primary, then run **Parent selection to primary controller**.
4. Use Inspector **Motion relation** to choose a parent, select parent/children,
   or detach. The command palette also exposes detach and select-parent actions.

## Manual review path

- Create three unrelated shapes, bind them to one controller, and animate the
  controller translation/rotation/scale.
- Add local rotation keys to one child and confirm both motions compose.
- Bind and detach away from frame zero and confirm the frame does not jump.
- Duplicate the rig, save/reopen, and compare canvas, SVG/PDF bundle, Worker still
  SVG, and Motion / Code playback.
- Attempt self/cyclic/cross-artboard bindings and controller deletion with live
  children; the mutation must fail closed or produce a typed issue.

## Still intentionally limited

- V1 relations are affine 2D and same-artboard only.
- Exact affine output is presentation-only; Vecmo still does not expose skew as
  an authored transform channel.
- A controller may have one motion parent. Partial-channel transform constraints
  and registry-backed numeric property relations are separate capabilities; IK
  and multi-parent weighting remain deferred.
- Cross-artboard controllers require an explicit pasteboard-space contract.
