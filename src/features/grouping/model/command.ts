/**
 * Re-exports the pure grouping command factories and planners from
 * `entities/scene/model/group-commands.ts`. The logic moved down to the
 * entities layer (Wave B2, agent-parity slice B3) so `entities/agent/model/write.ts`
 * can compile `scene/group-nodes`/`scene/ungroup-node` agent commands through the
 * same planners the Inspector uses, without a features->entities import (a hard
 * Feature-Sliced layer violation). This module stays as the stable import path
 * for existing UI callers (`InspectorPanel.tsx`, `features/grouping/model/actions.ts`)
 * so no call site needed to change.
 */
export type {
	GroupingIssue,
	GroupingIssueCode,
	GroupingIssueSeverity,
	GroupingOperation,
	GroupingSourcePolicy,
	GroupNodesCommandFailure,
	GroupNodesCommandResult,
	GroupNodesCommandSuccess,
	UngroupNodeCommandFailure,
	UngroupNodeCommandResult,
	UngroupNodeCommandSuccess,
} from "@/entities/scene/model/group-commands";
export {
	buildGroupNodesCommand,
	buildUngroupNodeCommand,
	createGroupNodesCommand,
	createUngroupNodeCommand,
	GROUPING_SOURCE_POLICY,
} from "@/entities/scene/model/group-commands";
