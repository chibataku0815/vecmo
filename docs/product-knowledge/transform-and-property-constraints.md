# Transform and Property Constraints

Date: 2026-07-13  
Status: **beta**

## What changed?

Vecmo now separates two partial relationships from full motion parenting.
`TransformConstraint` follows selected Position, Rotation, or Scale channels
from one same-artboard source with explicit strength, local/world space, and an
optional maintain-offset bind. `PropertyRelation` maps one registered numeric
property to another with scale, offset, and optional clamp.

Both are Scene-owned typed relations. One dependency resolver validates source
identity, cycles, scope, and evaluation order before presentation; persistence,
clone/remap/delete safety, canvas/export/runtime sampling, and Agent/MCP read and
write paths consume the same contracts.

## What can a user do now?

- Make a secondary carrier follow only the source channels it needs while its
  other authored transform channels remain independent.
- Blend transform following from 0–100%, choose local or world interpretation,
  preserve the current offset, jump to the source, or remove the constraint in
  Inspector.
- Drive `style.opacity`, `geometry.cornerRadius`, or
  `geometry.cornerSmoothing` from another registered numeric property with a
  deterministic scale/offset/clamp mapping.
- Inspect relation badges in Layers and author or read the same relations through
  Agent/MCP.

## Boundaries

- V1 is one source per relation, same-artboard, 2D Position/Rotation/Scale, and
  the explicit numeric property registry above.
- A target cannot combine a full motion parent with a transform constraint;
  ambiguous ownership fails closed.
- Bones, IK, distance constraints, weighted multi-parenting, simulation,
  arbitrary expressions, and cross-artboard relations remain deferred.
