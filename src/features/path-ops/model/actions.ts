import { useSceneStore } from "@/entities/scene/model/store";
import type { SceneDocument } from "@/entities/scene/model/types";
import {
	buildPathOperationCommand,
	type PathOperationCommandFailure,
	type PathOperationCommandSuccess,
} from "./command";
import type { PathOperation, PathOpIssue } from "./types";

export type PathOperationSelection = {
	readonly nodeIds: readonly string[];
	readonly primary: string | null;
};

export type SelectedPathOperationAvailable = {
	readonly enabled: true;
	readonly operation: PathOperation;
	readonly sourceNodeIds: readonly string[];
	readonly issues: readonly PathOpIssue[];
};

export type SelectedPathOperationUnavailable = {
	readonly enabled: false;
	readonly operation: PathOperation;
	readonly sourceNodeIds: readonly string[];
	readonly reason: string;
	readonly issues: readonly PathOpIssue[];
};

export type SelectedPathOperationState =
	| SelectedPathOperationAvailable
	| SelectedPathOperationUnavailable;

export type SelectedPathOperationCommitSuccess = PathOperationCommandSuccess & {
	readonly sourceNodeIds: readonly string[];
	readonly changed: boolean;
};

export type SelectedPathOperationCommitFailure = PathOperationCommandFailure & {
	readonly sourceNodeIds: readonly string[];
	readonly changed: false;
	readonly reason: string;
};

export type SelectedPathOperationCommitResult =
	| SelectedPathOperationCommitSuccess
	| SelectedPathOperationCommitFailure;

export type SelectedPathOperationCleanupSelection = {
	readonly nodeIds: readonly string[];
	readonly primary: string | null;
};

/**
 * Orders selected node ids for destructive Boolean operations. The primary
 * selection is first because it receives the replacement path and is the subject
 * for subtract; the rest keep selection order so repeated commands are stable.
 */
export function selectedPathOperationSourceIds(
	selection: PathOperationSelection,
): readonly string[] {
	const sourceNodeIds: string[] = [];
	const seen = new Set<string>();
	const add = (nodeId: string | null): void => {
		if (!nodeId || seen.has(nodeId)) return;
		seen.add(nodeId);
		sourceNodeIds.push(nodeId);
	};

	if (selection.primary && selection.nodeIds.includes(selection.primary)) {
		add(selection.primary);
	}
	for (const nodeId of selection.nodeIds) add(nodeId);
	return sourceNodeIds;
}

/**
 * Converts typed path-operation issues into a concise UI reason while keeping
 * the typed issue array available to model tests and future richer surfaces.
 */
export function pathOperationIssueReason(
	issues: readonly PathOpIssue[],
): string {
	const issue =
		issues.find((item) => item.severity === "error") ?? issues[0] ?? null;
	if (!issue) return "Path operation is unavailable for this selection.";
	const source = issue.sourceId ? ` (${issue.sourceId})` : "";
	return `${issue.message}${source}`;
}

/**
 * Plans whether the current selection can run a path operation without mutating
 * the scene. Action surfaces use this to expose disabled reasons from the same
 * command planner that will be used for execution.
 */
export function selectedPathOperationState(
	document: SceneDocument,
	operation: PathOperation,
	selection: PathOperationSelection,
): SelectedPathOperationState {
	const sourceNodeIds = selectedPathOperationSourceIds(selection);
	const planned = buildPathOperationCommand(document, operation, sourceNodeIds);
	if (planned.ok) {
		return {
			enabled: true,
			operation,
			sourceNodeIds,
			issues: planned.issues,
		};
	}

	return {
		enabled: false,
		operation,
		sourceNodeIds,
		reason: pathOperationIssueReason(planned.issues),
		issues: planned.issues,
	};
}

/**
 * Executes a selected-node path operation through the scene command bus. The
 * feature intentionally knows nothing about selection-store updates; widget
 * runtime code owns post-command UI selection cleanup to avoid feature imports.
 */
export function commitSelectedPathOperation(
	operation: PathOperation,
	selection: PathOperationSelection,
): SelectedPathOperationCommitResult {
	const store = useSceneStore.getState();
	const before = store.document;
	const sourceNodeIds = selectedPathOperationSourceIds(selection);
	const planned = buildPathOperationCommand(before, operation, sourceNodeIds);
	if (!planned.ok) {
		return {
			...planned,
			sourceNodeIds,
			changed: false,
			reason: pathOperationIssueReason(planned.issues),
		};
	}

	store.apply(planned.command);
	return {
		...planned,
		sourceNodeIds,
		changed: useSceneStore.getState().document !== before,
	};
}

/**
 * Defines the post-command selection contract for destructive path operations
 * without importing the selection store into the feature. A committed operation
 * replaces the primary source with the resulting path and removes the operands,
 * so callers should focus only the surviving primary node after a real change.
 */
export function selectedPathOperationCleanupSelection(
	result: SelectedPathOperationCommitResult,
): SelectedPathOperationCleanupSelection | null {
	if (!result.ok || !result.changed) return null;
	return {
		nodeIds: [result.primaryNodeId],
		primary: result.primaryNodeId,
	};
}
