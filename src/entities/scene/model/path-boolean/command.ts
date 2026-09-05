import { castDraft, type Draft } from "immer";
import type { SceneCommand } from "@/entities/scene/model/command";
import {
	findDraftNode,
	findLayerByNodeId,
	findNode,
	isNodeTransformable,
} from "@/entities/scene/model/selectors";
import type { SceneDocument, VectorNode } from "@/entities/scene/model/types";
import { IDENTITY_TRANSFORM } from "@/entities/scene/model/types";
import { applyPathOperation } from "./boolean";
import type {
	PathOperation,
	PathOpIssue,
	PathOpResult,
	PathOpSource,
} from "./types";

export const PATH_OP_SOURCE_POLICY = "replace-primary-remove-rest" as const;

export type PathOperationSourcePolicy = typeof PATH_OP_SOURCE_POLICY;

export type PathOperationCommandSuccess = {
	readonly ok: true;
	readonly operation: PathOperation;
	readonly sourcePolicy: PathOperationSourcePolicy;
	readonly primaryNodeId: string;
	readonly removedNodeIds: readonly string[];
	readonly command: SceneCommand;
	readonly result: PathOpResult & { readonly ok: true };
	readonly issues: readonly PathOpIssue[];
};

export type PathOperationCommandFailure = {
	readonly ok: false;
	readonly operation: PathOperation;
	readonly sourcePolicy: PathOperationSourcePolicy;
	readonly issues: readonly PathOpIssue[];
};

export type PathOperationCommandResult =
	| PathOperationCommandSuccess
	| PathOperationCommandFailure;

const operationLabel = (operation: PathOperation): string => {
	switch (operation) {
		case "union":
			return "Union paths";
		case "subtract":
			return "Subtract paths";
		case "intersect":
			return "Intersect paths";
		case "exclude":
			return "Exclude paths";
	}
};

const issue = (
	code: PathOpIssue["code"],
	message: string,
	severity: PathOpIssue["severity"],
	operation: PathOperation,
	sourceId?: string,
): PathOpIssue => ({
	code,
	message,
	severity,
	operation,
	sourceId,
});

const cloneIdentityTransform = (): typeof IDENTITY_TRANSFORM => ({
	position: { ...IDENTITY_TRANSFORM.position },
	rotation: IDENTITY_TRANSFORM.rotation,
	scale: { ...IDENTITY_TRANSFORM.scale },
	anchor: { ...IDENTITY_TRANSFORM.anchor },
});

const removeDraftNode = (
	nodes: Draft<VectorNode[]>,
	nodeId: string,
): boolean => {
	const index = nodes.findIndex((node) => node.id === nodeId);
	if (index >= 0) {
		nodes.splice(index, 1);
		return true;
	}
	for (const node of nodes) {
		if (node.children && removeDraftNode(node.children, nodeId)) return true;
	}
	return false;
};

/**
 * Applies an already planned path-op result by replacing the primary source and
 * deleting the other sources. This destructive policy is explicit because the
 * current scene model has no non-destructive compound group or multi-contour
 * path type; keeping source nodes would render duplicates over the result.
 * The result geometry is baked into artboard coordinates, so the primary node's
 * transform is reset to identity while its style, layer position, visibility,
 * lock state, and name are preserved.
 */
export function createReplaceSourcesWithPathCommand(options: {
	readonly operation: PathOperation;
	readonly primaryNodeId: string;
	readonly sourceNodeIds: readonly string[];
	readonly result: PathOpResult & { readonly ok: true };
}): SceneCommand {
	const removedNodeIds = options.sourceNodeIds.filter(
		(nodeId) => nodeId !== options.primaryNodeId,
	);
	return {
		type: `path-ops/${options.operation}`,
		label: operationLabel(options.operation),
		run: (draft) => {
			const primary = findDraftNode(draft, options.primaryNodeId);
			if (!primary) return;
			primary.geometry = castDraft(options.result.geometry);
			primary.transform = castDraft(cloneIdentityTransform());
			for (const nodeId of removedNodeIds) {
				for (const layer of draft.layers) {
					if (removeDraftNode(layer.nodes, nodeId)) break;
				}
			}
		},
	};
}

/**
 * Reads scene nodes, computes the path operation, and returns a command only
 * when every source is present, transformable, and representable as one editable
 * `PathGeometry`. Source order is semantic: the first id is the primary node and
 * the subtract subject, matching Illustrator/Figma-style selected-source flows.
 */
export function buildPathOperationCommand(
	document: SceneDocument,
	operation: PathOperation,
	sourceNodeIds: readonly string[],
): PathOperationCommandResult {
	const issues: PathOpIssue[] = [];
	const uniqueIds: string[] = [];
	for (const nodeId of sourceNodeIds) {
		if (uniqueIds.includes(nodeId)) {
			issues.push(
				issue(
					"path-op.duplicate-source",
					"Path operation source ids must be unique.",
					"error",
					operation,
					nodeId,
				),
			);
			continue;
		}
		uniqueIds.push(nodeId);
	}

	if (uniqueIds.length < 2) {
		issues.push(
			issue(
				"path-op.too-few-sources",
				"Path operation command requires at least two source nodes.",
				"error",
				operation,
			),
		);
	}

	const sources: PathOpSource[] = [];
	for (const nodeId of uniqueIds) {
		const node = findNode(document, nodeId);
		if (!node) {
			issues.push(
				issue(
					"path-op.missing-source",
					"Path operation source node was not found in the scene.",
					"error",
					operation,
					nodeId,
				),
			);
			continue;
		}
		const layer = findLayerByNodeId(document, nodeId);
		if (!layer || !isNodeTransformable(document, nodeId)) {
			issues.push(
				issue(
					"path-op.protected-source",
					"Hidden or locked path operation sources are protected from destructive replacement.",
					"error",
					operation,
					nodeId,
				),
			);
			continue;
		}
		sources.push({
			id: node.id,
			name: node.name,
			geometry: node.geometry,
			transform: node.transform,
		});
	}

	if (issues.some((item) => item.severity === "error")) {
		return {
			ok: false,
			operation,
			sourcePolicy: PATH_OP_SOURCE_POLICY,
			issues,
		};
	}

	const result = applyPathOperation(operation, sources);
	if (!result.ok) {
		return {
			ok: false,
			operation,
			sourcePolicy: PATH_OP_SOURCE_POLICY,
			issues: result.issues,
		};
	}

	const primaryNodeId = uniqueIds[0];
	const command = createReplaceSourcesWithPathCommand({
		operation,
		primaryNodeId,
		sourceNodeIds: uniqueIds,
		result,
	});

	return {
		ok: true,
		operation,
		sourcePolicy: PATH_OP_SOURCE_POLICY,
		primaryNodeId,
		removedNodeIds: uniqueIds.slice(1),
		command,
		result,
		issues: result.issues,
	};
}
