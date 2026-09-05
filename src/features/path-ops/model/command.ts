/**
 * Re-exports the pure path-operation planner and factory from
 * `entities/scene/model/path-boolean/command.ts`. Moved down to the entities
 * layer (Wave B2, agent-parity slice B6) so `entities/agent/model/write.ts`
 * can compile `scene/apply-path-operation` agent commands through the same
 * `buildPathOperationCommand` planner the Pathfinder UI uses, without a
 * features->entities import (a hard Feature-Sliced layer violation). This
 * module stays as the stable import path for existing UI callers
 * (`actions.ts` and the sibling test file) so no call site needed to change.
 */
export type {
	PathOperationCommandFailure,
	PathOperationCommandResult,
	PathOperationCommandSuccess,
	PathOperationSourcePolicy,
} from "@/entities/scene/model/path-boolean/command";
export {
	buildPathOperationCommand,
	createReplaceSourcesWithPathCommand,
	PATH_OP_SOURCE_POLICY,
} from "@/entities/scene/model/path-boolean/command";
