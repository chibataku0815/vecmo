# Direct Spatial Motion Paths

Date: 2026-07-13  
Status: **beta**

## What changed?

The Motion Path tool now edits the geometric route between paired X/Y position
keys. Position values remain ordinary Timeline tracks; a separate spatial
side-car owns cubic tangents, corner/continuous/auto mode, and interior roving
intent. Temporal easing and spatial geometry are not conflated.

The shared motion sampler evaluates the cubic route before controller relations
and camera projection, so canvas, export, and generated runtime use the same
path. Invalid, unpaired, duplicate, or timing-divergent spatial metadata falls
back to scalar X/Y sampling with a typed presentation issue.

## What can a user do now?

- Select a node with at least two position stops and run **Enable direct spatial
  path**, or use Inspector **Spatial path**.
- Drag path diamonds to edit paired X/Y values in one undo step.
- Drag incoming/outgoing tangent handles without changing temporal easing.
- Hold Shift to constrain an anchor or tangent; hold Alt while dragging a
  tangent to break continuity.
- Double-click a stop to toggle automatic tangents. Alt-double-click an interior
  stop to toggle and redistribute roving timing.
- Use Inspector to enter the tool, set all stops to auto, redistribute roving
  keys, enter exact incoming/outgoing tangent vectors, inspect typed issues, or
  remove only spatial metadata.
- Read frame-spaced speed dots on the canvas without changing the geometric
  route.
- In expanded Timeline mode, switch to the sampled Value or Speed Graph, drag or
  enter all four temporal cubic handles, copy/paste a curve, split or join a
  segment, and fit or zoom the graph.
- Author/inspect the same path through typed Agent/MCP commands.

## Still intentionally limited

- V1 is a 2D artboard-space cubic route over paired X/Y keys.
- Roving distribution uses geometric chord length and integral frames; it is not
  an imported application's subframe solver.
- Spatial paths require synchronized X/Y segment timing. Divergent legacy axis
  easing remains editable but disables the cubic segment with a typed fallback.
- 3D paths, follow-path orientation constraints, and path-based motion blur are
  separate capabilities. The current Graph is intentionally scoped to selected
  numeric tracks rather than an all-property curve workspace.
