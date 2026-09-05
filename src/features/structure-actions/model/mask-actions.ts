import {
	createReleaseMaskCommand,
	createUseNodeAsMaskCommand,
	readAppearanceMaskRelations,
} from "@/entities/scene/model/appearance";
import type { SceneCommand } from "@/entities/scene/model/command";
import { resolveSceneMaskPlan } from "@/entities/scene/model/mask-render";
import { runSceneCommands } from "@/entities/scene/model/runner";
import {
	findNode,
	selectNodeArtboardMapping,
} from "@/entities/scene/model/selectors";
import type {
	SceneDocument,
	SceneLayer,
	VectorNode,
} from "@/entities/scene/model/types";

export type MaskOperation = "use-as-mask" | "release-mask";
export type MaskIssueSeverity = "error";

export type MaskIssueCode =
	| "mask.child-source"
	| "mask.cross-artboard-source"
	| "mask.cross-layer-source"
	| "mask.duplicate-source"
	| "mask.hidden-source"
	| "mask.locked-source"
	| "mask.missing-source"
	| "mask.nested-relation-unsupported"
	| "mask.no-mask-relation"
	| "mask.render-unsupported"
	| "mask.too-few-sources";

export type MaskIssue = {
	readonly code: MaskIssueCode;
	readonly message: string;
	readonly severity: MaskIssueSeverity;
	readonly operation: MaskOperation;
	readonly sourceId?: string;
	readonly layerId?: string;
};

export type MaskSelectionTarget = {
	readonly nodeIds: readonly string[];
	readonly primaryNodeId: string | null;
};

export type UseAsMaskCommandSuccess = {
	readonly ok: true;
	readonly operation: "use-as-mask";
	readonly maskNodeId: string;
	readonly contentNodeIds: readonly string[];
	readonly layerId: string;
	readonly command: SceneCommand;
	readonly selection: MaskSelectionTarget;
	readonly issues: readonly MaskIssue[];
};

export type UseAsMaskCommandFailure = {
	readonly ok: false;
	readonly operation: "use-as-mask";
	readonly issues: readonly MaskIssue[];
};

export type UseAsMaskCommandResult =
	| UseAsMaskCommandSuccess
	| UseAsMaskCommandFailure;

export type ReleaseMaskCommandSuccess = {
	readonly ok: true;
	readonly operation: "release-mask";
	readonly maskNodeId: string;
	readonly command: SceneCommand;
	readonly selection: MaskSelectionTarget;
	readonly issues: readonly MaskIssue[];
};

export type ReleaseMaskCommandFailure = {
	readonly ok: false;
	readonly operation: "release-mask";
	readonly issues: readonly MaskIssue[];
};

export type ReleaseMaskCommandResult =
	| ReleaseMaskCommandSuccess
	| ReleaseMaskCommandFailure;

type TopLevelNodeEntry = {
	readonly node: VectorNode;
	readonly layer: SceneLayer;
	readonly index: number;
};

const issue = (
	code: MaskIssueCode,
	message: string,
	operation: MaskOperation,
	location: { readonly sourceId?: string; readonly layerId?: string } = {},
): MaskIssue => ({
	code,
	message,
	severity: "error",
	operation,
	...location,
});

const hasErrors = (issues: readonly MaskIssue[]): boolean =>
	issues.some((item) => item.severity === "error");

const findTopLevelNode = (
	document: SceneDocument,
	nodeId: string,
): TopLevelNodeEntry | undefined => {
	let paintIndex = 0;
	for (const layer of document.layers) {
		let found: TopLevelNodeEntry | undefined;
		const visit = (node: VectorNode): void => {
			if (found) return;
			const index = paintIndex;
			paintIndex += 1;
			if (node.id === nodeId) {
				found = { node, layer, index };
				return;
			}
			for (const child of node.children ?? []) visit(child);
		};
		for (const node of layer.nodes) visit(node);
		if (found) return found;
	}
	return undefined;
};

const uniqueSourceIds = (
	nodeIds: readonly string[],
	operation: MaskOperation,
): {
	readonly nodeIds: readonly string[];
	readonly issues: readonly MaskIssue[];
} => {
	const issues: MaskIssue[] = [];
	const uniqueIds: string[] = [];
	for (const nodeId of nodeIds) {
		if (uniqueIds.includes(nodeId)) {
			issues.push(
				issue(
					"mask.duplicate-source",
					"Mask source ids must be unique.",
					operation,
					{ sourceId: nodeId },
				),
			);
			continue;
		}
		uniqueIds.push(nodeId);
	}
	return { nodeIds: uniqueIds, issues };
};

const topLevelEntriesFor = (
	document: SceneDocument,
	nodeIds: readonly string[],
	operation: MaskOperation,
): {
	readonly entries: readonly TopLevelNodeEntry[];
	readonly issues: readonly MaskIssue[];
} => {
	const issues: MaskIssue[] = [];
	const entries: TopLevelNodeEntry[] = [];
	for (const nodeId of nodeIds) {
		const node = findNode(document, nodeId);
		if (!node) {
			issues.push(
				issue(
					"mask.missing-source",
					"Mask source node was not found in the scene.",
					operation,
					{ sourceId: nodeId },
				),
			);
			continue;
		}

		const entry = findTopLevelNode(document, nodeId);
		if (!entry) {
			issues.push(
				issue(
					"mask.child-source",
					"Mask actions could not resolve the node's owning layer.",
					operation,
					{ sourceId: nodeId },
				),
			);
			continue;
		}

		if (entry.layer.locked || entry.node.locked) {
			issues.push(
				issue(
					"mask.locked-source",
					"Locked nodes or nodes in locked layers cannot be used as a mask.",
					operation,
					{ sourceId: nodeId, layerId: entry.layer.id },
				),
			);
		}
		if (!entry.layer.visible || !entry.node.visible) {
			issues.push(
				issue(
					"mask.hidden-source",
					"Hidden nodes or nodes in hidden layers cannot be used as a mask.",
					operation,
					{ sourceId: nodeId, layerId: entry.layer.id },
				),
			);
		}
		entries.push(entry);
	}

	return { entries, issues };
};

const sameArtboardIssues = (
	document: SceneDocument,
	entries: readonly TopLevelNodeEntry[],
	operation: MaskOperation,
): readonly MaskIssue[] => {
	const artboardMapping = selectNodeArtboardMapping(document);
	const artboardIds = new Set(
		entries.flatMap((entry) => {
			const artboardId = artboardMapping.byNodeId[entry.node.id];
			return artboardId ? [artboardId] : [];
		}),
	);
	if (artboardIds.size <= 1) return [];
	return [
		issue(
			"mask.cross-artboard-source",
			"Mask actions currently require all sources in one artboard.",
			operation,
		),
	];
};

const maskRepresentabilityMessage = (reason: string | undefined): string => {
	if (reason === "mask-chain-unsupported") {
		return "Use as mask is unavailable for mask chains; release an existing mask first.";
	}
	if (reason === "mask-geometry-unsupported") {
		return "Use as mask requires a supported non-empty shape as the mask source.";
	}
	if (reason === "mask-node-not-same-artboard") {
		return "Use as mask requires the mask source and masked content to share one artboard.";
	}
	return "Use as mask is unavailable because the selected mask relation cannot be represented by the renderer.";
};

const representableNativeMaskIssues = (
	document: SceneDocument,
	command: SceneCommand,
	maskNodeId: string,
	contentNodeIds: readonly string[],
): readonly MaskIssue[] => {
	const preview = runSceneCommands(document, [command]);
	if (preview.issues.length > 0 || !preview.changed) {
		return [
			issue(
				"mask.render-unsupported",
				"Use as mask could not create a native mask relation for the selected nodes.",
				"use-as-mask",
				{ sourceId: maskNodeId },
			),
		];
	}

	const maskPlan = resolveSceneMaskPlan(preview.document);
	for (const contentNodeId of contentNodeIds) {
		const represented =
			maskPlan.applicationsByContentNodeId
				.get(contentNodeId)
				?.some((application) => application.maskNodeId === maskNodeId) ?? false;
		if (represented) continue;
		const fallback = maskPlan.unrepresented.find(
			(relation) => relation.contentNodeId === contentNodeId,
		);
		return [
			issue(
				"mask.render-unsupported",
				maskRepresentabilityMessage(fallback?.reason),
				"use-as-mask",
				{ sourceId: maskNodeId },
			),
		];
	}
	return [];
};

const hasNativeRelationForMask = (
	node: VectorNode,
	maskNodeId: string,
): boolean =>
	readAppearanceMaskRelations(node).some(
		(relation) =>
			relation.origin === "native" && relation.maskNodeId === maskNodeId,
	);

const hasNestedNativeRelationForMask = (
	nodes: readonly VectorNode[] | undefined,
	maskNodeId: string,
): boolean => {
	if (!nodes) return false;
	for (const node of nodes) {
		if (hasNativeRelationForMask(node, maskNodeId)) return true;
		if (hasNestedNativeRelationForMask(node.children, maskNodeId)) return true;
	}
	return false;
};

/**
 * Plans a native "use as mask" command from the selected top-level siblings.
 * The highest selected layer-order node becomes the mask source, matching common
 * design-tool behavior where the top object clips the selected content below it.
 */
export function buildUseAsMaskCommand(
	document: SceneDocument,
	selectedNodeIds: readonly string[],
): UseAsMaskCommandResult {
	const unique = uniqueSourceIds(selectedNodeIds, "use-as-mask");
	const issues: MaskIssue[] = [...unique.issues];
	if (unique.nodeIds.length < 2) {
		issues.push(
			issue(
				"mask.too-few-sources",
				"Use as mask requires at least two selected nodes in one artboard.",
				"use-as-mask",
			),
		);
	}

	const resolution = topLevelEntriesFor(
		document,
		unique.nodeIds,
		"use-as-mask",
	);
	issues.push(...resolution.issues);
	issues.push(
		...sameArtboardIssues(document, resolution.entries, "use-as-mask"),
	);

	const layerId = resolution.entries[0]?.layer.id;
	if (hasErrors(issues) || !layerId) {
		return { ok: false, operation: "use-as-mask", issues };
	}

	const ordered = [...resolution.entries].sort(
		(left, right) => left.index - right.index,
	);
	const maskEntry = ordered.at(-1);
	if (!maskEntry) {
		return { ok: false, operation: "use-as-mask", issues };
	}

	const contentNodeIds = ordered.slice(0, -1).map((entry) => entry.node.id);
	const command = createUseNodeAsMaskCommand(maskEntry.node.id, contentNodeIds);
	issues.push(
		...representableNativeMaskIssues(
			document,
			command,
			maskEntry.node.id,
			contentNodeIds,
		),
	);
	if (hasErrors(issues)) {
		return { ok: false, operation: "use-as-mask", issues };
	}

	return {
		ok: true,
		operation: "use-as-mask",
		maskNodeId: maskEntry.node.id,
		contentNodeIds,
		layerId,
		command,
		selection: {
			nodeIds: ordered.map((entry) => entry.node.id),
			primaryNodeId: maskEntry.node.id,
		},
		issues,
	};
}

/**
 * Plans releasing native mask relations that use the selected node as the mask
 * source. The command itself clears all matching native relations in one undoable
 * edit; this planner keeps the action disabled until such a relation exists.
 */
export function buildReleaseMaskCommand(
	document: SceneDocument,
	maskNodeId: string | null | undefined,
): ReleaseMaskCommandResult {
	const operation = "release-mask";
	if (!maskNodeId) {
		return {
			ok: false,
			operation,
			issues: [
				issue(
					"mask.missing-source",
					"Release mask requires one selected mask source.",
					operation,
				),
			],
		};
	}

	const node = findNode(document, maskNodeId);
	if (!node) {
		return {
			ok: false,
			operation,
			issues: [
				issue(
					"mask.missing-source",
					"Mask source node was not found in the scene.",
					operation,
					{ sourceId: maskNodeId },
				),
			],
		};
	}

	const entry = findTopLevelNode(document, maskNodeId);
	if (!entry) {
		return {
			ok: false,
			operation,
			issues: [
				issue(
					"mask.child-source",
					"Release mask currently accepts top-level mask sources only.",
					operation,
					{ sourceId: maskNodeId },
				),
			],
		};
	}

	const hasAnyNativeRelation = document.layers.some((layer) =>
		layer.nodes.some(
			(candidate) =>
				hasNativeRelationForMask(candidate, maskNodeId) ||
				hasNestedNativeRelationForMask(candidate.children, maskNodeId),
		),
	);
	if (!hasAnyNativeRelation) {
		return {
			ok: false,
			operation,
			issues: [
				issue(
					"mask.no-mask-relation",
					"The selected node is not currently used as a native mask.",
					operation,
					{ sourceId: maskNodeId, layerId: entry.layer.id },
				),
			],
		};
	}

	return {
		ok: true,
		operation,
		maskNodeId,
		command: createReleaseMaskCommand(maskNodeId),
		selection: { nodeIds: [maskNodeId], primaryNodeId: maskNodeId },
		issues: [],
	};
}

/**
 * Plans a node-row "Use as Mask" operation from a mask source and the current
 * selection. The scene command still enforces sibling/top-level/editable scope;
 * this planner only removes duplicate ids, the mask source itself, and empty
 * content requests before a UI surface dispatches a command.
 */
export function planUseNodeAsMaskStructureAction(
	maskNodeId: string,
	selectedNodeIds: readonly string[],
): SceneCommand | null {
	const contentNodeIds = [...new Set(selectedNodeIds)].filter(
		(nodeId) => nodeId !== maskNodeId,
	);
	if (contentNodeIds.length === 0) return null;
	return createUseNodeAsMaskCommand(maskNodeId, contentNodeIds);
}

/**
 * Plans a node-row "Release Mask" operation. The command is safe to offer from a
 * row that is marked as a mask source because the entity command no-ops when no
 * native relation references the source.
 */
export function planReleaseNodeMaskStructureAction(
	maskNodeId: string,
): SceneCommand {
	return createReleaseMaskCommand(maskNodeId);
}
