import type { SceneCommand } from "@/entities/scene/model/command";
import type { SceneDocument } from "@/entities/scene/model/types";
import {
	buildGroupNodesCommand,
	buildUngroupNodeCommand,
	type GroupingIssue,
	type GroupingIssueCode,
	type GroupingOperation,
	type GroupNodesCommandFailure,
	type GroupNodesCommandSuccess,
	type UngroupNodeCommandFailure,
	type UngroupNodeCommandSuccess,
} from "./command";

/** Selection snapshot used by grouping UI bridges without importing stores. */
export type GroupingSelection = {
	readonly nodeIds: readonly string[];
	readonly primary: string | null;
};

/** Compact disabled summary derived from canonical typed grouping issues. */
export type GroupingDisabledReason = {
	readonly operation: GroupingOperation;
	readonly message: string;
	readonly issueCode: GroupingIssueCode;
	readonly issueCount: number;
	readonly issueCodes: readonly GroupingIssueCode[];
	readonly sourceIds: readonly string[];
	readonly layerIds: readonly string[];
};

/** Available group action plan with the command result kept intact. */
export type SelectedGroupNodesAvailable = {
	readonly enabled: true;
	readonly operation: "group";
	readonly sourceNodeIds: readonly string[];
	readonly selectNodeIds: readonly string[];
	readonly command: SceneCommand;
	readonly commandResult: GroupNodesCommandSuccess;
	readonly issues: readonly GroupingIssue[];
	readonly disabledReason: null;
};

/** Disabled group action plan with typed issues and no scene command. */
export type SelectedGroupNodesUnavailable = {
	readonly enabled: false;
	readonly operation: "group";
	readonly sourceNodeIds: readonly string[];
	readonly selectNodeIds: readonly string[];
	readonly commandResult: GroupNodesCommandFailure;
	readonly issues: readonly GroupingIssue[];
	readonly disabledReason: GroupingDisabledReason | null;
	readonly reason: string;
};

/** Selection-derived state for the group action. */
export type SelectedGroupNodesState =
	| SelectedGroupNodesAvailable
	| SelectedGroupNodesUnavailable;

/** Available ungroup action plan with the command result kept intact. */
export type SelectedUngroupNodeAvailable = {
	readonly enabled: true;
	readonly operation: "ungroup";
	readonly sourceNodeIds: readonly string[];
	readonly selectNodeIds: readonly string[];
	readonly command: SceneCommand;
	readonly commandResult: UngroupNodeCommandSuccess;
	readonly issues: readonly GroupingIssue[];
	readonly disabledReason: null;
};

/** Disabled ungroup action plan with typed issues and no scene command. */
export type SelectedUngroupNodeUnavailable = {
	readonly enabled: false;
	readonly operation: "ungroup";
	readonly sourceNodeIds: readonly string[];
	readonly selectNodeIds: readonly string[];
	readonly commandResult: UngroupNodeCommandFailure;
	readonly issues: readonly GroupingIssue[];
	readonly disabledReason: GroupingDisabledReason | null;
	readonly reason: string;
};

/** Selection-derived state for the ungroup action. */
export type SelectedUngroupNodeState =
	| SelectedUngroupNodeAvailable
	| SelectedUngroupNodeUnavailable;

/** Any selection-derived grouping action state. */
export type SelectedGroupingActionState =
	| SelectedGroupNodesState
	| SelectedUngroupNodeState;

/** Stable state object that layer and action-surface workflows can consume. */
export type SelectedGroupingState = {
	readonly group: SelectedGroupNodesState;
	readonly ungroup: SelectedUngroupNodeState;
};

const uniqueStrings = (
	values: readonly (string | undefined)[],
): readonly string[] => [
	...new Set(
		values.filter(
			(value): value is string => typeof value === "string" && value.length > 0,
		),
	),
];

const fallbackReason = (operation: GroupingOperation): string =>
	operation === "group"
		? "Grouping is unavailable for this selection."
		: "Ungroup is unavailable for this selection.";

/**
 * Converts typed grouping issues into a concise disabled reason while keeping
 * all issue objects available for richer UI reports and tests.
 */
export function groupingDisabledReason(
	operation: GroupingOperation,
	issues: readonly GroupingIssue[],
): GroupingDisabledReason | null {
	const issue =
		issues.find((item) => item.severity === "error") ?? issues[0] ?? null;
	if (!issue) return null;

	return {
		operation,
		message: issue.message,
		issueCode: issue.code,
		issueCount: issues.length,
		issueCodes: [...new Set(issues.map((item) => item.code))],
		sourceIds: uniqueStrings(issues.map((item) => item.sourceId)),
		layerIds: uniqueStrings(issues.map((item) => item.layerId)),
	};
}

const selectedUngroupSourceId = (
	selection: GroupingSelection,
): string | null => {
	if (selection.primary && selection.nodeIds.includes(selection.primary)) {
		return selection.primary;
	}
	return selection.nodeIds[0] ?? selection.primary ?? null;
};

const selectedGroupNodesState = (
	document: SceneDocument,
	selection: GroupingSelection,
): SelectedGroupNodesState => {
	const commandResult = buildGroupNodesCommand(document, selection.nodeIds);
	if (commandResult.ok) {
		return {
			enabled: true,
			operation: "group",
			sourceNodeIds: selection.nodeIds,
			selectNodeIds: [commandResult.groupNodeId],
			command: commandResult.command,
			commandResult,
			issues: commandResult.issues,
			disabledReason: null,
		};
	}

	const disabledReason = groupingDisabledReason("group", commandResult.issues);
	return {
		enabled: false,
		operation: "group",
		sourceNodeIds: selection.nodeIds,
		selectNodeIds: [],
		commandResult,
		issues: commandResult.issues,
		disabledReason,
		reason: disabledReason?.message ?? fallbackReason("group"),
	};
};

const selectedUngroupNodeState = (
	document: SceneDocument,
	selection: GroupingSelection,
): SelectedUngroupNodeState => {
	const groupNodeId = selectedUngroupSourceId(selection);
	const commandResult = buildUngroupNodeCommand(document, groupNodeId ?? "");
	const sourceNodeIds = groupNodeId ? [groupNodeId] : [];
	if (commandResult.ok) {
		return {
			enabled: true,
			operation: "ungroup",
			sourceNodeIds,
			selectNodeIds: commandResult.childNodeIds,
			command: commandResult.command,
			commandResult,
			issues: commandResult.issues,
			disabledReason: null,
		};
	}

	const disabledReason = groupingDisabledReason(
		"ungroup",
		commandResult.issues,
	);
	return {
		enabled: false,
		operation: "ungroup",
		sourceNodeIds,
		selectNodeIds: [],
		commandResult,
		issues: commandResult.issues,
		disabledReason,
		reason: disabledReason?.message ?? fallbackReason("ungroup"),
	};
};

export function selectedGroupingActionState(
	document: SceneDocument,
	operation: "group",
	selection: GroupingSelection,
): SelectedGroupNodesState;
export function selectedGroupingActionState(
	document: SceneDocument,
	operation: "ungroup",
	selection: GroupingSelection,
): SelectedUngroupNodeState;
/**
 * Plans one grouping action from the current selection without mutating the
 * scene. The returned command result is the same result produced by the
 * canonical grouping command builder, so UI surfaces do not need to duplicate
 * availability rules.
 */
export function selectedGroupingActionState(
	document: SceneDocument,
	operation: GroupingOperation,
	selection: GroupingSelection,
): SelectedGroupingActionState {
	return operation === "group"
		? selectedGroupNodesState(document, selection)
		: selectedUngroupNodeState(document, selection);
}

/**
 * Plans group and ungroup together for UI surfaces that render both actions
 * from one scene and selection snapshot.
 */
export function selectedGroupingState(
	document: SceneDocument,
	selection: GroupingSelection,
): SelectedGroupingState {
	return {
		group: selectedGroupingActionState(document, "group", selection),
		ungroup: selectedGroupingActionState(document, "ungroup", selection),
	};
}
