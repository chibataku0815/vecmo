# Center Node Anchor (Pivot)

Date: 2026-06-27.
Status: Canvas/Inspector authoring + scene command + agent/MCP capability.

## Summary

A node's rotate/scale pivot is `transform.anchor`, and the default anchor is the
local origin `{0,0}`. The renderer pivots rotation about the anchor, so a bound
or keyframed `transform.rotation` makes the node ORBIT the local origin instead
of spinning in place. Only the on-canvas rotate gizmo spun in place — it bakes a
centre pivot into position per drag — so setting rotation any other way (the
Inspector R field, a keyframe, an agent expression) swung the node around a point
off to the side.

The selected node now shows its real pivot as an on-canvas anchor mark. Dragging
that mark edits the rest-pose pivot while preserving the rendered artwork. The
Inspector Transform section also exposes a 3x3 Pivot preset grid plus anchor
`AX` / `AY` fields beside the other transform fields. Rest-pose Inspector edits
preserve the current rendered pose while moving the future rotate/scale pivot;
recording or transform-animated edits write `anchorX` / `anchorY` motion
keyframes, adding X/Y compensation keys when needed to preserve the current
frame's pose. `scene/center-node-anchor` still moves a node's anchor to its
geometry centre. After it, rotation spins the node in place. The editor computes
the centre from the live geometry, so a caller (including an agent) needs no
bounds knowledge.

## What This Enables

- "Spin in place" via any rotation source. Center the anchor once, then a bound
  `transform.rotation = frame * 6` (or keyframed rotation) rotates the node about
  its own centre rather than orbiting the origin.
- Direct pivot authoring: drag the on-canvas pivot mark, click a 3x3 Inspector
  preset, set `AX` / `AY`, add per-field keyframe diamonds, or turn on recording
  to animate the pivot itself.
- Agents can author an in-place spin on the user's selection with no geometry:
  read the live selection, send `scene/center-node-anchor` + bind the rotation,
  approve.
- MCP/agents can set or keyframe anchors by stable property id:
  `transform.anchorX` and `transform.anchorY`.

## How It Works

- `createCenterNodeAnchorCommand(nodeId)` (entities/scene `node-commands.ts`) is a
  scene command. In `run(draft)` it finds the node, reads `getNodeLocalBounds`
  (entities/scene `rendering.ts`), and sets `transform.anchor` to the bounds
  centre. Layer/node visibility + lock guards mirror the transform command.
- `transformWithAnchorPreservingMatrix` (entities/scene `rendering.ts`) computes
  the compensated `position` + `anchor` patch used by Inspector and bindable
  scene writes so pivot edits do not visually jump a rotated/scaled node.
- Select-tool overlay/handler code renders and hit-tests the anchor mark from
  `transform.anchor`; dragging maps the pointer through the gesture-start matrix
  back into local anchor space and writes the same compensated scene patch.
- Inspector presets resolve the 3x3 points from `getNodeLocalBounds`; preset
  clicks write both anchor axes together so motion compensation is calculated for
  the final pivot, not as two competing one-axis edits.
- `anchorX` / `anchorY` are scalar motion channels. `effectiveTransform` samples
  them into `transform.anchor`, and the Inspector/timeline/MCP keyframe paths use
  the same motion command bus as X/Y/rotation.
- At rotation 0 the anchor cancels in the render matrix (`e = position + anchor −
  anchor`), so centering never shifts the node — it only changes the pivot.
- Exposed to agents: `AgentSceneCommand` includes `scene/center-node-anchor`
  (`{nodeId}`), and bindable scene/motion writes expose `transform.anchorX` /
  `transform.anchorY`; the MCP schemas accept both direct `anchorX` / `anchorY`
  motion keyframes and `motion/set-bindable-keyframe` by property id.

## Manual Verification

1. Select a node whose anchor is the default origin and bind/keyframe its
   rotation — confirm it orbits a point to the side (the bug).
2. Drag the canvas pivot mark on a rotated node and confirm the artwork stays
   visually fixed while the pivot mark moves under the pointer.
3. Click Inspector Pivot presets and edit `AX` / `AY`; confirm the artwork stays
   fixed while future rotation/scale pivot around the new point.
4. Add keyframes to `AX` / `AY` and confirm they appear as timeline motion rows.
5. Apply `scene/center-node-anchor` via an agent plan and confirm rotation now
   spins it in place.

## Known Limits

- The geometry centre is the local-bounds centre (axis-aligned). For most shapes
  this is the visual centre; an intentionally off-centre pivot still needs a
  manual anchor.
- Canvas pivot dragging edits the scene/rest-pose pivot. For motion-aware pivot
  keying, use the Inspector `AX` / `AY` fields or Pivot presets with recording
  or existing transform motion; those route through the motion command bus and
  write compensation keyframes.
