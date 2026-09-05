import type { SceneCommand } from "@/entities/scene/model/command";
import type { LayoutFramePatch } from "@/entities/scene/model/layout-frame";
import { createLayoutFrameFromNodesCommand } from "@/entities/scene/model/layout-frame-commands";
import {
	createFrameNodesCommand,
	createUnframeNodeCommand,
} from "@/entities/scene/model/node-commands";
import {
	findNode,
	isFrameNode,
	selectAllArtboards,
	selectNodeArtboardMapping,
} from "@/entities/scene/model/selectors";
import type {
	LayoutFramePresetId,
	SceneDocument,
	SceneLayer,
	VectorNode,
} from "@/entities/scene/model/types";
import { createId } from "@/shared/lib/id";

/**
 * Frame wrap accepts top-level same-layer, same-artboard sources. The policy is
 * named so UI bridges and tests can assert intent rather than re-deriving it, and
 * Grid/Bento layout uses its own same-parent policy instead of silently changing
 * ordinary frame behavior.
 */
export const FRAME_SOURCE_POLICY =
	"top-level-same-layer-same-artboard" as const;
export const LAYOUT_FRAME_SOURCE_POLICY =
	"same-parent-same-layer-same-artboard" as const;

export type FrameSourcePolicy =
	| typeof FRAME_SOURCE_POLICY
	| typeof LAYOUT_FRAME_SOURCE_POLICY;
export type FrameOperation = "frame" | "unframe";
export type FrameIssueSeverity = "error";

export type FrameIssueCode =
	| "frame.child-source"
	| "frame.cross-artboard-source"
	| "frame.cross-layer-source"
	| "frame.cross-parent-source"
	| "frame.duplicate-source"
	| "frame.hidden-source"
	| "frame.locked-source"
	| "frame.missing-source"
	| "frame.not-frame"
	| "frame.too-few-sources";

export type FrameIssue = {
	readonly code: FrameIssueCode;
	readonly message: string;
	readonly severity: FrameIssueSeverity;
	readonly operation: FrameOperation;
	readonly sourceId?: string;
	readonly layerId?: string;
	readonly artboardId?: string;
};

/**
 * Deterministic selection the caller should apply after the command runs. Frame
 * wrap selects the new frame (Figma behavior); unframe selects the restored
 * children. `primaryNodeId` is null when the next selection is empty.
 */
export type FrameSelectionTarget = {
	readonly nodeIds: readonly string[];
	readonly primaryNodeId: string | null;
};

export type FrameNodesCommandSuccess = {
	readonly ok: true;
	readonly operation: "frame";
	readonly sourcePolicy: FrameSourcePolicy;
	readonly frameNodeId: string;
	readonly layerId: string;
	readonly parentNodeId?: string | null;
	readonly artboardId: string;
	readonly framedNodeIds: readonly string[];
	readonly command: SceneCommand;
	readonly selection: FrameSelectionTarget;
	readonly issues: readonly FrameIssue[];
};

export type FrameNodesCommandFailure = {
	readonly ok: false;
	readonly operation: "frame";
	readonly sourcePolicy: FrameSourcePolicy;
	readonly issues: readonly FrameIssue[];
};

export type FrameNodesCommandResult =
	| FrameNodesCommandSuccess
	| FrameNodesCommandFailure;

export type UnframeNodeCommandSuccess = {
	readonly ok: true;
	readonly operation: "unframe";
	readonly sourcePolicy: FrameSourcePolicy;
	readonly frameNodeId: string;
	readonly layerId: string;
	readonly childNodeIds: readonly string[];
	readonly command: SceneCommand;
	readonly selection: FrameSelectionTarget;
	readonly issues: readonly FrameIssue[];
};

export type UnframeNodeCommandFailure = {
	readonly ok: false;
	readonly operation: "unframe";
	readonly sourcePolicy: FrameSourcePolicy;
	readonly issues: readonly FrameIssue[];
};

export type UnframeNodeCommandResult =
	| UnframeNodeCommandSuccess
	| UnframeNodeCommandFailure;

export type BuildFrameNodesOptions = {
	readonly name?: string;
	readonly clipsContent?: boolean;
};

/** Options for wrapping the current selection directly into a Grid/Bento frame. */
export type BuildLayoutFrameNodesOptions = BuildFrameNodesOptions & {
	readonly layout?: LayoutFramePatch;
	readonly preset?: LayoutFramePresetId;
};

type TopLevelNodeEntry = {
	readonly node: VectorNode;
	readonly layer: SceneLayer;
	readonly index: number;
};

type SceneNodeEntry = TopLevelNodeEntry & {
	readonly parentNode: VectorNode | null;
	readonly ancestorLocked: boolean;
	readonly ancestorVisible: boolean;
};

const issue = (
	code: FrameIssueCode,
	message: string,
	operation: FrameOperation,
	location: {
		readonly sourceId?: string;
		readonly layerId?: string;
		readonly artboardId?: string;
	} = {},
): FrameIssue => ({
	code,
	message,
	severity: "error",
	operation,
	...location,
});

const hasErrors = (issues: readonly FrameIssue[]): boolean =>
	issues.some((item) => item.severity === "error");

const findTopLevelNode = (
	document: SceneDocument,
	nodeId: string,
): TopLevelNodeEntry | undefined => {
	for (const layer of document.layers) {
		const index = layer.nodes.findIndex((node) => node.id === nodeId);
		const node = index >= 0 ? layer.nodes[index] : undefined;
		if (node) return { node, layer, index };
	}
	return undefined;
};

const findSceneNodeEntry = (
	document: SceneDocument,
	nodeId: string,
): SceneNodeEntry | undefined => {
	const visit = (
		nodes: readonly VectorNode[],
		layer: SceneLayer,
		parentNode: VectorNode | null,
		ancestorLocked: boolean,
		ancestorVisible: boolean,
	): SceneNodeEntry | undefined => {
		for (const [index, node] of nodes.entries()) {
			if (node.id === nodeId) {
				return {
					node,
					layer,
					index,
					parentNode,
					ancestorLocked,
					ancestorVisible,
				};
			}
			if (!node.children) continue;
			const found = visit(
				node.children,
				layer,
				node,
				ancestorLocked || node.locked,
				ancestorVisible && node.visible,
			);
			if (found) return found;
		}
		return undefined;
	};
	for (const layer of document.layers) {
		const found = visit(layer.nodes, layer, null, false, true);
		if (found) return found;
	}
	return undefined;
};

/**
 * Plans a wrap-in-frame command from selected scene node ids. Unlike grouping, a
 * single node is a valid frame source (a frame is a container, not a merge of
 * siblings). Nested ids, missing ids, protected sources, cross-layer selections,
 * and cross-artboard selections surface as typed issues so a UI bridge can
 * explain a disabled command without mutating the scene.
 *
 * Artboard responsibility stays separate from the editor's current artboard: the
 * planner resolves the sources' shared owning artboard and hands it to the
 * command (for multi-artboard documents) so the new frame and its children stay
 * on that artboard instead of inheriting editor focus.
 */
export function buildFrameNodesCommand(
	document: SceneDocument,
	selectedNodeIds: readonly string[],
	options: BuildFrameNodesOptions = {},
): FrameNodesCommandResult {
	const issues: FrameIssue[] = [];
	const uniqueIds: string[] = [];
	for (const nodeId of selectedNodeIds) {
		if (uniqueIds.includes(nodeId)) {
			issues.push(
				issue(
					"frame.duplicate-source",
					"Frame source ids must be unique.",
					"frame",
					{ sourceId: nodeId },
				),
			);
			continue;
		}
		uniqueIds.push(nodeId);
	}

	if (uniqueIds.length === 0) {
		issues.push(
			issue(
				"frame.too-few-sources",
				"Wrap in frame requires at least one source node.",
				"frame",
			),
		);
	}

	const artboardMapping = selectNodeArtboardMapping(document);
	const entries: TopLevelNodeEntry[] = [];
	const artboardIds = new Set<string>();
	for (const nodeId of uniqueIds) {
		const node = findNode(document, nodeId);
		if (!node) {
			issues.push(
				issue(
					"frame.missing-source",
					"Frame source node was not found in the scene.",
					"frame",
					{ sourceId: nodeId },
				),
			);
			continue;
		}

		const entry = findTopLevelNode(document, nodeId);
		if (!entry) {
			issues.push(
				issue(
					"frame.child-source",
					"Wrap in frame currently accepts top-level nodes only.",
					"frame",
					{ sourceId: nodeId },
				),
			);
			continue;
		}

		if (entry.layer.locked || entry.node.locked) {
			issues.push(
				issue(
					"frame.locked-source",
					"Locked nodes or nodes in locked layers cannot be wrapped.",
					"frame",
					{ sourceId: nodeId, layerId: entry.layer.id },
				),
			);
		}
		if (!entry.layer.visible || !entry.node.visible) {
			issues.push(
				issue(
					"frame.hidden-source",
					"Hidden nodes or nodes in hidden layers cannot be wrapped.",
					"frame",
					{ sourceId: nodeId, layerId: entry.layer.id },
				),
			);
		}
		const artboardId = artboardMapping.byNodeId[nodeId];
		if (artboardId) artboardIds.add(artboardId);
		entries.push(entry);
	}

	const layerId = entries[0]?.layer.id;
	if (layerId) {
		for (const entry of entries) {
			if (entry.layer.id === layerId) continue;
			issues.push(
				issue(
					"frame.cross-layer-source",
					"Wrap in frame currently requires all sources in one layer.",
					"frame",
					{ sourceId: entry.node.id, layerId: entry.layer.id },
				),
			);
		}
	}

	if (artboardIds.size > 1) {
		issues.push(
			issue(
				"frame.cross-artboard-source",
				"Wrap in frame requires all sources in one artboard.",
				"frame",
			),
		);
	}

	const ownerArtboardId = entries[0]
		? (artboardMapping.byNodeId[entries[0].node.id] ?? document.artboard.id)
		: document.artboard.id;

	if (hasErrors(issues) || !layerId) {
		return {
			ok: false,
			operation: "frame",
			sourcePolicy: FRAME_SOURCE_POLICY,
			issues,
		};
	}

	const framedNodeIds = [...entries]
		.sort((left, right) => left.index - right.index)
		.map((entry) => entry.node.id);
	const frameNodeId = createId("frame");
	const multiArtboard = selectAllArtboards(document).length > 1;
	return {
		ok: true,
		operation: "frame",
		sourcePolicy: FRAME_SOURCE_POLICY,
		frameNodeId,
		layerId,
		artboardId: ownerArtboardId,
		framedNodeIds,
		command: createFrameNodesCommand({
			layerId,
			frameNodeId,
			sourceNodeIds: framedNodeIds,
			name: options.name,
			clipsContent: options.clipsContent,
			artboardId: multiArtboard ? ownerArtboardId : undefined,
		}),
		selection: { nodeIds: [frameNodeId], primaryNodeId: frameNodeId },
		issues,
	};
}

/**
 * Plans the first Grid/Bento authoring action for selected siblings. Top-level
 * nodes and direct children of the same parent are both valid sources, which
 * lets users build nested bento structures without changing ordinary frame wrap.
 */
export function buildLayoutFrameNodesCommand(
	document: SceneDocument,
	selectedNodeIds: readonly string[],
	options: BuildLayoutFrameNodesOptions = {},
): FrameNodesCommandResult {
	const issues: FrameIssue[] = [];
	const uniqueIds: string[] = [];
	for (const nodeId of selectedNodeIds) {
		if (uniqueIds.includes(nodeId)) {
			issues.push(
				issue(
					"frame.duplicate-source",
					"Layout frame source ids must be unique.",
					"frame",
					{ sourceId: nodeId },
				),
			);
			continue;
		}
		uniqueIds.push(nodeId);
	}

	if (uniqueIds.length === 0) {
		issues.push(
			issue(
				"frame.too-few-sources",
				"Wrap in grid layout requires at least one source node.",
				"frame",
			),
		);
	}

	const artboardMapping = selectNodeArtboardMapping(document);
	const entries: SceneNodeEntry[] = [];
	const layerIds = new Set<string>();
	const parentNodeIds = new Set<string | null>();
	const artboardIds = new Set<string>();
	for (const nodeId of uniqueIds) {
		const entry = findSceneNodeEntry(document, nodeId);
		if (!entry) {
			issues.push(
				issue(
					"frame.missing-source",
					"Layout frame source node was not found in the scene.",
					"frame",
					{ sourceId: nodeId },
				),
			);
			continue;
		}

		layerIds.add(entry.layer.id);
		parentNodeIds.add(entry.parentNode?.id ?? null);
		if (entry.layer.locked || entry.ancestorLocked || entry.node.locked) {
			issues.push(
				issue(
					"frame.locked-source",
					"Locked nodes or nodes inside locked parents cannot be wrapped.",
					"frame",
					{ sourceId: nodeId, layerId: entry.layer.id },
				),
			);
		}
		if (!entry.layer.visible || !entry.ancestorVisible || !entry.node.visible) {
			issues.push(
				issue(
					"frame.hidden-source",
					"Hidden nodes or nodes inside hidden parents cannot be wrapped.",
					"frame",
					{ sourceId: nodeId, layerId: entry.layer.id },
				),
			);
		}
		const artboardId = artboardMapping.byNodeId[nodeId];
		if (artboardId) artboardIds.add(artboardId);
		entries.push(entry);
	}

	if (layerIds.size > 1) {
		issues.push(
			issue(
				"frame.cross-layer-source",
				"Wrap in grid layout requires all sources in one layer.",
				"frame",
			),
		);
	}
	if (parentNodeIds.size > 1) {
		issues.push(
			issue(
				"frame.cross-parent-source",
				"Wrap in grid layout requires all sources to share one parent.",
				"frame",
			),
		);
	}
	if (artboardIds.size > 1) {
		issues.push(
			issue(
				"frame.cross-artboard-source",
				"Wrap in grid layout requires all sources in one artboard.",
				"frame",
			),
		);
	}

	const firstEntry = entries[0];
	const layerId = firstEntry?.layer.id;
	if (hasErrors(issues) || !layerId) {
		return {
			ok: false,
			operation: "frame",
			sourcePolicy: LAYOUT_FRAME_SOURCE_POLICY,
			issues,
		};
	}

	const parentNodeId = firstEntry.parentNode?.id ?? null;
	const framedNodeIds = [...entries]
		.sort((left, right) => left.index - right.index)
		.map((entry) => entry.node.id);
	const frameNodeId = createId("frame");
	const ownerArtboardId =
		artboardMapping.byNodeId[firstEntry.node.id] ?? document.artboard.id;
	const multiArtboard = selectAllArtboards(document).length > 1;
	return {
		ok: true,
		operation: "frame",
		sourcePolicy: LAYOUT_FRAME_SOURCE_POLICY,
		frameNodeId,
		layerId,
		parentNodeId,
		artboardId: ownerArtboardId,
		framedNodeIds,
		command: createLayoutFrameFromNodesCommand({
			layerId,
			parentNodeId,
			frameNodeId,
			sourceNodeIds: framedNodeIds,
			layout: options.layout,
			preset: options.preset ?? "bento-mosaic",
			name: options.name ?? "Grid layout",
			clipsContent: options.clipsContent,
			artboardId: !parentNodeId && multiArtboard ? ownerArtboardId : undefined,
		}),
		selection: { nodeIds: [frameNodeId], primaryNodeId: frameNodeId },
		issues,
	};
}

/**
 * Plans an unframe command for one top-level frame node. A frame is identified by
 * the {@link VectorNode.frame} role rather than by having children, so this never
 * dissolves a plain group: groups keep their own ungroup path. Restored children
 * keep their ids and transforms, and the planned selection targets them.
 */
export function buildUnframeNodeCommand(
	document: SceneDocument,
	frameNodeId: string,
): UnframeNodeCommandResult {
	const issues: FrameIssue[] = [];
	const node = findNode(document, frameNodeId);
	if (!node) {
		issues.push(
			issue(
				"frame.missing-source",
				"Unframe source node was not found in the scene.",
				"unframe",
				{ sourceId: frameNodeId },
			),
		);
		return {
			ok: false,
			operation: "unframe",
			sourcePolicy: FRAME_SOURCE_POLICY,
			issues,
		};
	}

	const entry = findTopLevelNode(document, frameNodeId);
	if (!entry) {
		issues.push(
			issue(
				"frame.child-source",
				"Unframe currently accepts top-level frame nodes only.",
				"unframe",
				{ sourceId: frameNodeId },
			),
		);
		return {
			ok: false,
			operation: "unframe",
			sourcePolicy: FRAME_SOURCE_POLICY,
			issues,
		};
	}

	if (!isFrameNode(entry.node)) {
		issues.push(
			issue(
				"frame.not-frame",
				"Unframe source must be a frame node.",
				"unframe",
				{ sourceId: frameNodeId, layerId: entry.layer.id },
			),
		);
	}
	if (entry.layer.locked || entry.node.locked) {
		issues.push(
			issue(
				"frame.locked-source",
				"Locked frames or frames in locked layers cannot be unframed.",
				"unframe",
				{ sourceId: frameNodeId, layerId: entry.layer.id },
			),
		);
	}
	if (!entry.layer.visible || !entry.node.visible) {
		issues.push(
			issue(
				"frame.hidden-source",
				"Hidden frames or frames in hidden layers cannot be unframed.",
				"unframe",
				{ sourceId: frameNodeId, layerId: entry.layer.id },
			),
		);
	}

	if (hasErrors(issues)) {
		return {
			ok: false,
			operation: "unframe",
			sourcePolicy: FRAME_SOURCE_POLICY,
			issues,
		};
	}

	const childNodeIds = (entry.node.children ?? []).map((child) => child.id);
	return {
		ok: true,
		operation: "unframe",
		sourcePolicy: FRAME_SOURCE_POLICY,
		frameNodeId,
		layerId: entry.layer.id,
		childNodeIds,
		command: createUnframeNodeCommand({
			layerId: entry.layer.id,
			frameNodeId,
		}),
		selection: {
			nodeIds: childNodeIds,
			primaryNodeId: childNodeIds.at(-1) ?? null,
		},
		issues,
	};
}
