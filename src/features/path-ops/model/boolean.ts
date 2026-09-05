/**
 * Re-exports the pure boolean-operation engine from
 * `entities/scene/model/path-boolean/boolean.ts`. Moved down to the entities
 * layer (Wave B2, agent-parity slice B6) so `entities/agent/model/write.ts`
 * can compile a `scene/apply-path-operation` agent command through the same
 * engine the Pathfinder UI uses, without a features->entities import (a hard
 * Feature-Sliced layer violation). This module stays as the stable import
 * path for existing callers in this feature (`command.ts`'s shim and the
 * sibling test file) so no relative import needed to change.
 */
export { applyPathOperation } from "@/entities/scene/model/path-boolean/boolean";
