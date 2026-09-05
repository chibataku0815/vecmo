/**
 * Re-exports the pure path-operation type contracts from
 * `entities/scene/model/path-boolean/types.ts`. The types moved down to the
 * entities layer (Wave B2, agent-parity slice B6) so
 * `entities/agent/model/write.ts` can compile `scene/apply-path-operation`
 * agent commands using the same contracts the UI planner uses, without a
 * features->entities import (a hard Feature-Sliced layer violation). This
 * module stays as the stable import path for existing callers in this feature
 * (`actions.ts`, `finishing.ts`, and the sibling test files) so no relative
 * import needed to change.
 */
export type {
	PathOperation,
	PathOpFailure,
	PathOpIssue,
	PathOpIssueCode,
	PathOpIssueSeverity,
	PathOpResult,
	PathOpSource,
	PathOpSuccess,
} from "@/entities/scene/model/path-boolean/types";
export { PATH_OPERATIONS } from "@/entities/scene/model/path-boolean/types";
