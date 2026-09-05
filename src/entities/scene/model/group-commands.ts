import { castDraft } from "immer";
import type { SceneCommand } from "@/entities/scene/model/command";
import { pruneDraftComponentPropBindings } from "@/entities/scene/model/component-prop-commands";
import { cloneSceneDocument } from "@/entities/scene/model/factory";
import {
	composeMatrix,
	getGeometryBounds,
	isIdentityMatrix,
	type Matrix2D,
	matrixFromTransform,
	transformFromMatrix,
} from "@/entities/scene/model/rendering";
import { findNode } from "@/entities/scene/model/selectors";
import {
	type Bounds,
	IDENTITY_TRANSFORM,
	type SceneDocument,
	type SceneLayer,
	type Vec2,
	type VectorNode,
} from "@/entities/scene/model/types";
import { createId } from "@/shared/lib/id";

export const GROUPING_SOURCE_POLICY = "top-level-same-layer" as const;

export type GroupingSourcePolicy = typeof GROUPING_SOURCE_POLICY;
export type GroupingOperation = "group" | "ungroup";
export type GroupingIssueSeverity = "error";
export type GroupingIssueCode =
	| "grouping.child-source"
	| "grouping.cross-layer-source"
	| "grouping.duplicate-source"
	| "grouping.hidden-source"
	| "grouping.locked-source"
	| "grouping.missing-source"
	| "grouping.not-group"
	| "grouping.too-few-sources";

export type GroupingIssue = {
	readonly code: GroupingIssueCode;
	readonly message: string;
	readonly severity: GroupingIssueSeverity;
	readonly operation: GroupingOperation;
	readonly sourceId?: string;
	readonly layerId?: string;
};

export type GroupNodesCommandSuccess = {
	readonly ok: true;
	readonly operation: "group";
	readonly sourcePolicy: GroupingSourcePolicy;
	readonly groupNodeId: string;
	readonly layerId: string;
	readonly groupedNodeIds: readonly string[];
	readonly command: SceneCommand;
	readonly issues: readonly GroupingIssue[];
};

export type GroupNodesCommandFailure = {
	readonly ok: false;
	readonly operation: "group";
	readonly sourcePolicy: GroupingSourcePolicy;
	readonly issues: readonly GroupingIssue[];
};

export type GroupNodesCommandResult =
	| GroupNodesCommandSuccess
	| GroupNodesCommandFailure;

export type UngroupNodeCommandSuccess = {
	readonly ok: true;
	readonly operation: "ungroup";
	readonly sourcePolicy: GroupingSourcePolicy;
	readonly groupNodeId: string;
	readonly layerId: string;
	readonly childNodeIds: readonly string[];
	readonly command: SceneCommand;
	readonly issues: readonly GroupingIssue[];
};

export type UngroupNodeCommandFailure = {
	readonly ok: false;
	readonly operation: "ungroup";
	readonly sourcePolicy: GroupingSourcePolicy;
	readonly issues: readonly GroupingIssue[];
};

export type UngroupNodeCommandResult =
	| UngroupNodeCommandSuccess
	| UngroupNodeCommandFailure;

type TopLevelNodeEntry = {
	readonly node: VectorNode;
	readonly layer: SceneLayer;
	readonly index: number;
};

const GROUP_WRAPPER_STYLE = {
	fill: "#000000",
	stroke: "#000000",
	strokeWidth: 0,
	opacity: 1,
} as const satisfies VectorNode["style"];

const cloneIdentityTransform = (): typeof IDENTITY_TRANSFORM => ({
	position: { ...IDENTITY_TRANSFORM.position },
	rotation: IDENTITY_TRANSFORM.rotation,
	scale: { ...IDENTITY_TRANSFORM.scale },
	anchor: { ...IDENTITY_TRANSFORM.anchor },
});

const issue = (
	code: GroupingIssueCode,
	message: string,
	operation: GroupingOperation,
	sourceId?: string,
	layerId?: string,
): GroupingIssue => ({
	code,
	message,
	severity: "error",
	operation,
	sourceId,
	layerId,
});

const hasErrors = (issues: readonly GroupingIssue[]): boolean =>
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

const orderedByLayerIndex = (
	entries: readonly TopLevelNodeEntry[],
): readonly TopLevelNodeEntry[] =>
	[...entries].sort((left, right) => left.index - right.index);

const transformPoint = (point: Vec2, matrix: Matrix2D): Vec2 => ({
	x: matrix.a * point.x + matrix.c * point.y + matrix.e,
	y: matrix.b * point.x + matrix.d * point.y + matrix.f,
});

const boundsFromPoints = (points: readonly Vec2[]): Bounds => {
	if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
	const xs = points.map((point) => point.x);
	const ys = points.map((point) => point.y);
	const minX = Math.min(...xs);
	const maxX = Math.max(...xs);
	const minY = Math.min(...ys);
	const maxY = Math.max(...ys);
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

const transformedNodeBounds = (node: VectorNode): Bounds => {
	const bounds = getGeometryBounds(node.geometry);
	const matrix = matrixFromTransform(node.transform);
	return boundsFromPoints([
		transformPoint({ x: bounds.x, y: bounds.y }, matrix),
		transformPoint({ x: bounds.x + bounds.width, y: bounds.y }, matrix),
		transformPoint({ x: bounds.x, y: bounds.y + bounds.height }, matrix),
		transformPoint(
			{ x: bounds.x + bounds.width, y: bounds.y + bounds.height },
			matrix,
		),
	]);
};

const boundsForNodes = (nodes: readonly VectorNode[]): Bounds => {
	const corners = nodes.flatMap((node) => {
		const bounds = transformedNodeBounds(node);
		return [
			{ x: bounds.x, y: bounds.y },
			{ x: bounds.x + bounds.width, y: bounds.y + bounds.height },
		];
	});
	return boundsFromPoints(corners);
};

const createGroupNode = (
	groupNodeId: string,
	children: readonly VectorNode[],
	name = "Group",
): VectorNode => {
	const bounds = boundsForNodes(children);
	const origin = { x: bounds.x, y: bounds.y };
	return {
		id: groupNodeId,
		name,
		geometry: {
			kind: "line",
			start: origin,
			end: origin,
		},
		transform: cloneIdentityTransform(),
		style: { ...GROUP_WRAPPER_STYLE },
		visible: true,
		locked: false,
		children: cloneSceneDocument(children),
		data: {
			grouping: {
				bounds,
				sourcePolicy: GROUPING_SOURCE_POLICY,
			},
		},
	};
};

/**
 * Creates a scene command that wraps top-level nodes from one layer in a new
 * serializable group node. The command re-reads the draft at execution time so
 * the child payload reflects the latest scene data, then removes the original
 * top-level sources before inserting the group at the first selected layer slot.
 */
export function createGroupNodesCommand(options: {
	readonly layerId: string;
	readonly groupNodeId: string;
	readonly sourceNodeIds: readonly string[];
	readonly name?: string;
}): SceneCommand {
	return {
		type: "scene/group-nodes",
		label: "Group nodes",
		run: (draft) => {
			const layer = draft.layers.find((item) => item.id === options.layerId);
			if (!layer) return;

			const sourceIds = [...new Set(options.sourceNodeIds)];
			if (sourceIds.length < 2) return;

			const sourceEntries = sourceIds
				.map((nodeId) => ({
					nodeId,
					index: layer.nodes.findIndex((node) => node.id === nodeId),
				}))
				.filter(
					(
						entry,
					): entry is { readonly nodeId: string; readonly index: number } =>
						entry.index >= 0,
				);
			if (sourceEntries.length !== sourceIds.length) return;

			const orderedEntries = [...sourceEntries].sort(
				(left, right) => left.index - right.index,
			);
			const firstIndex = orderedEntries[0]?.index;
			if (firstIndex === undefined) return;

			const children: VectorNode[] = [];
			for (const entry of orderedEntries) {
				const node = layer.nodes[entry.index];
				if (!node) return;
				children.push(cloneSceneDocument<VectorNode>(node));
			}

			const groupNode = createGroupNode(
				options.groupNodeId,
				children,
				options.name,
			);

			for (const entry of orderedEntries.toReversed()) {
				layer.nodes.splice(entry.index, 1);
			}
			layer.nodes.splice(firstIndex, 0, castDraft(groupNode));
		},
	};
}

/**
 * Creates a scene command that replaces a top-level group node with its current
 * children. Children are cloned out of the draft before insertion so ungrouping
 * keeps the scene graph plain and preserves child ids without retaining proxy
 * references.
 */
export function createUngroupNodeCommand(options: {
	readonly layerId: string;
	readonly groupNodeId: string;
}): SceneCommand {
	return {
		type: "scene/ungroup-node",
		label: "Ungroup node",
		run: (draft) => {
			const layer = draft.layers.find((item) => item.id === options.layerId);
			if (!layer) return;

			const groupIndex = layer.nodes.findIndex(
				(node) => node.id === options.groupNodeId,
			);
			const groupNode = groupIndex >= 0 ? layer.nodes[groupIndex] : undefined;
			if (!groupNode?.children?.length) return;

			// Bake the group's transform into each member so ungrouping preserves the
			// on-canvas placement a moved/rotated/uniformly-scaled group gave them.
			// Group transforms stay in the similarity class (translate + rotate +
			// uniform scale), so `groupMatrix ∘ childMatrix` is always representable as
			// a shear-free TRS; the identity (untouched group) case short-circuits to a
			// verbatim restore so a no-op group→ungroup round-trips exactly.
			const groupMatrix = matrixFromTransform(groupNode.transform);
			const children = cloneSceneDocument(groupNode.children);
			const restored = isIdentityMatrix(groupMatrix)
				? children
				: children.map((child) => ({
						...child,
						transform: transformFromMatrix(
							composeMatrix(groupMatrix, matrixFromTransform(child.transform)),
							{ x: 0, y: 0 },
						),
					}));
			layer.nodes.splice(groupIndex, 1, ...castDraft(restored));
			pruneDraftComponentPropBindings(draft, new Set([groupNode.id]));
		},
	};
}

/**
 * Plans a group command from selected scene node ids. Only same-layer top-level
 * nodes are accepted in this first grouping slice; nested nodes, missing ids,
 * protected sources, and cross-layer selections are surfaced as typed issues so
 * UI bridges can explain disabled commands without mutating the scene.
 */
export function buildGroupNodesCommand(
	document: SceneDocument,
	selectedNodeIds: readonly string[],
): GroupNodesCommandResult {
	const issues: GroupingIssue[] = [];
	const uniqueIds: string[] = [];
	for (const nodeId of selectedNodeIds) {
		if (uniqueIds.includes(nodeId)) {
			issues.push(
				issue(
					"grouping.duplicate-source",
					"Grouping source ids must be unique.",
					"group",
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
				"grouping.too-few-sources",
				"Grouping requires at least two top-level source nodes.",
				"group",
			),
		);
	}

	const entries: TopLevelNodeEntry[] = [];
	for (const nodeId of uniqueIds) {
		const node = findNode(document, nodeId);
		if (!node) {
			issues.push(
				issue(
					"grouping.missing-source",
					"Grouping source node was not found in the scene.",
					"group",
					nodeId,
				),
			);
			continue;
		}

		const entry = findTopLevelNode(document, nodeId);
		if (!entry) {
			issues.push(
				issue(
					"grouping.child-source",
					"Grouping currently accepts top-level nodes only.",
					"group",
					nodeId,
				),
			);
			continue;
		}

		if (entry.layer.locked || entry.node.locked) {
			issues.push(
				issue(
					"grouping.locked-source",
					"Locked nodes or nodes in locked layers cannot be grouped.",
					"group",
					nodeId,
					entry.layer.id,
				),
			);
		}
		if (!entry.layer.visible || !entry.node.visible) {
			issues.push(
				issue(
					"grouping.hidden-source",
					"Hidden nodes or nodes in hidden layers cannot be grouped.",
					"group",
					nodeId,
					entry.layer.id,
				),
			);
		}
		entries.push(entry);
	}

	const layerId = entries[0]?.layer.id;
	if (layerId) {
		for (const entry of entries) {
			if (entry.layer.id === layerId) continue;
			issues.push(
				issue(
					"grouping.cross-layer-source",
					"Grouping currently requires all sources to be in one layer.",
					"group",
					entry.node.id,
					entry.layer.id,
				),
			);
		}
	}

	if (hasErrors(issues) || !layerId) {
		return {
			ok: false,
			operation: "group",
			sourcePolicy: GROUPING_SOURCE_POLICY,
			issues,
		};
	}

	const orderedEntries = orderedByLayerIndex(entries);
	const groupedNodeIds = orderedEntries.map((entry) => entry.node.id);
	const groupNodeId = createId("group");
	return {
		ok: true,
		operation: "group",
		sourcePolicy: GROUPING_SOURCE_POLICY,
		groupNodeId,
		layerId,
		groupedNodeIds,
		command: createGroupNodesCommand({
			layerId,
			groupNodeId,
			sourceNodeIds: groupedNodeIds,
		}),
		issues,
	};
}

/**
 * Plans an ungroup command for one top-level group node. A group is represented
 * by the existing `children` field rather than a new geometry kind, keeping the
 * scene schema stable while allowing the command bus to replace the wrapper with
 * its children in layer order.
 */
export function buildUngroupNodeCommand(
	document: SceneDocument,
	groupNodeId: string,
): UngroupNodeCommandResult {
	const issues: GroupingIssue[] = [];
	const node = findNode(document, groupNodeId);
	if (!node) {
		issues.push(
			issue(
				"grouping.missing-source",
				"Ungroup source node was not found in the scene.",
				"ungroup",
				groupNodeId,
			),
		);
		return {
			ok: false,
			operation: "ungroup",
			sourcePolicy: GROUPING_SOURCE_POLICY,
			issues,
		};
	}

	const entry = findTopLevelNode(document, groupNodeId);
	if (!entry) {
		issues.push(
			issue(
				"grouping.child-source",
				"Ungroup currently accepts top-level group nodes only.",
				"ungroup",
				groupNodeId,
			),
		);
		return {
			ok: false,
			operation: "ungroup",
			sourcePolicy: GROUPING_SOURCE_POLICY,
			issues,
		};
	}

	if (entry.layer.locked || entry.node.locked) {
		issues.push(
			issue(
				"grouping.locked-source",
				"Locked groups or groups in locked layers cannot be ungrouped.",
				"ungroup",
				groupNodeId,
				entry.layer.id,
			),
		);
	}
	if (!entry.layer.visible || !entry.node.visible) {
		issues.push(
			issue(
				"grouping.hidden-source",
				"Hidden groups or groups in hidden layers cannot be ungrouped.",
				"ungroup",
				groupNodeId,
				entry.layer.id,
			),
		);
	}
	const groupChildren = entry.node.children;
	if (!groupChildren?.length) {
		issues.push(
			issue(
				"grouping.not-group",
				"Ungroup source must be a node with children.",
				"ungroup",
				groupNodeId,
				entry.layer.id,
			),
		);
	}

	if (hasErrors(issues) || !groupChildren?.length) {
		return {
			ok: false,
			operation: "ungroup",
			sourcePolicy: GROUPING_SOURCE_POLICY,
			issues,
		};
	}

	const childNodeIds = groupChildren.map((child) => child.id);
	return {
		ok: true,
		operation: "ungroup",
		sourcePolicy: GROUPING_SOURCE_POLICY,
		groupNodeId,
		layerId: entry.layer.id,
		childNodeIds,
		command: createUngroupNodeCommand({
			layerId: entry.layer.id,
			groupNodeId,
		}),
		issues,
	};
}
