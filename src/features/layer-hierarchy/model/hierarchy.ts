import type {
	SceneDocument,
	SceneLayer,
	VectorNode,
	VectorNodeKind,
} from "@/entities/scene/model/types";

export type LayerTreeRowKind = "layer" | "node";

export type LayerTreeSelectionInput = {
	readonly nodeIds?: readonly string[];
	readonly primaryNodeId?: string | null;
};

export type LayerTreeBuildOptions = {
	readonly collapsedIds?: ReadonlySet<string>;
	readonly selection?: LayerTreeSelectionInput;
};

export type LayerNodePath = {
	readonly layer: SceneLayer;
	readonly layerId: string;
	readonly layerIndex: number;
	readonly node: VectorNode;
	readonly nodeId: string;
	readonly nodeIds: readonly string[];
	readonly parentNodeIds: readonly string[];
	readonly ancestors: readonly VectorNode[];
	readonly depth: number;
	readonly indexPath: readonly number[];
	readonly siblingIndex: number;
	readonly topLevelIndex: number;
	readonly topLevelNodeId: string;
	readonly isNested: boolean;
	readonly visible: boolean;
	readonly locked: boolean;
	readonly hiddenByAncestor: boolean;
	readonly lockedByAncestor: boolean;
	readonly effectiveVisible: boolean;
	readonly effectiveLocked: boolean;
};

export type LayerTreeLayerRow = {
	readonly kind: "layer";
	readonly id: `layer:${string}`;
	readonly layer: SceneLayer;
	readonly layerId: string;
	readonly layerIndex: number;
	readonly name: string;
	readonly depth: 0;
	readonly childCount: number;
	readonly canExpand: boolean;
	readonly expanded: boolean;
	readonly visible: boolean;
	readonly locked: boolean;
	readonly effectiveVisible: boolean;
	readonly effectiveLocked: boolean;
	readonly selected: false;
	readonly primary: false;
	readonly inPrimaryPath: false;
	readonly containsSelectedDescendant: boolean;
	readonly containsPrimaryDescendant: boolean;
};

export type LayerTreeNodeRow = {
	readonly kind: "node";
	readonly id: `node:${string}`;
	readonly node: VectorNode;
	readonly nodeId: string;
	readonly nodeKind: VectorNodeKind;
	readonly layer: SceneLayer;
	readonly layerId: string;
	readonly layerIndex: number;
	readonly name: string;
	readonly depth: number;
	readonly parentNodeIds: readonly string[];
	readonly nodeIds: readonly string[];
	readonly indexPath: readonly number[];
	readonly siblingIndex: number;
	readonly topLevelIndex: number;
	readonly topLevelNodeId: string;
	readonly isNested: boolean;
	readonly isGroup: boolean;
	readonly childCount: number;
	readonly canExpand: boolean;
	readonly expanded: boolean;
	readonly visible: boolean;
	readonly locked: boolean;
	readonly hiddenByAncestor: boolean;
	readonly lockedByAncestor: boolean;
	readonly effectiveVisible: boolean;
	readonly effectiveLocked: boolean;
	readonly selected: boolean;
	readonly primary: boolean;
	readonly inPrimaryPath: boolean;
	readonly containsSelectedDescendant: boolean;
	readonly containsPrimaryDescendant: boolean;
};

export type LayerTreeRow = LayerTreeLayerRow | LayerTreeNodeRow;

export type SelectionHierarchy = {
	readonly requestedNodeIds: readonly string[];
	readonly selectedNodeIds: readonly string[];
	readonly missingNodeIds: readonly string[];
	readonly selectedPaths: readonly LayerNodePath[];
	readonly primaryNodeId: string | null;
	readonly primaryPath: LayerNodePath | null;
	readonly ancestorNodeIds: readonly string[];
	readonly primaryAncestorNodeIds: readonly string[];
	readonly selectedLayerIds: readonly string[];
	readonly selectedTopLevelNodeIds: readonly string[];
	readonly hasNestedSelection: boolean;
	readonly hasCrossLayerSelection: boolean;
};

export type LayerActionOperation =
	| "copy"
	| "duplicate"
	| "group"
	| "paste"
	| "ungroup";

export type LayerActionIssueCode =
	| "clipboard.cross-layer-paste-unsupported"
	| "clipboard.cross-layer-source"
	| "clipboard.duplicate-source"
	| "clipboard.empty-payload"
	| "clipboard.empty-selection"
	| "clipboard.hidden-source"
	| "clipboard.invalid-payload"
	| "clipboard.locked-source"
	| "clipboard.missing-layer"
	| "clipboard.missing-source"
	| "clipboard.nested-source-unsupported"
	| "clipboard.protected-source"
	| "clipboard.protected-target"
	| "grouping.child-source"
	| "grouping.cross-layer-source"
	| "grouping.duplicate-source"
	| "grouping.hidden-source"
	| "grouping.locked-source"
	| "grouping.missing-source"
	| "grouping.not-group"
	| "grouping.too-few-sources";

export type LayerActionIssueSeverity = "error" | "warning";

export type LayerActionProtectionReason =
	| "ancestor-hidden"
	| "ancestor-locked"
	| "layer-hidden"
	| "layer-locked"
	| "node-hidden"
	| "node-locked";

export type LayerActionIssue = {
	readonly code: LayerActionIssueCode;
	readonly message: string;
	readonly severity: LayerActionIssueSeverity;
	readonly operation?: LayerActionOperation;
	readonly sourceId?: string;
	readonly layerId?: string;
	readonly reason?: LayerActionProtectionReason;
};

export type LayerActionDisplayIssue = LayerActionIssue & {
	readonly title: string;
	readonly displayMessage: string;
	readonly priority: number;
};

export type LayerActionDisabledReason = {
	readonly operation: LayerActionOperation;
	readonly title: string;
	readonly message: string;
	readonly issueCode: LayerActionIssueCode;
	readonly issueCount: number;
	readonly sourceIds: readonly string[];
	readonly layerIds: readonly string[];
	readonly protectionReasons: readonly LayerActionProtectionReason[];
	readonly issueCodes: readonly LayerActionIssueCode[];
};

export type LayerActionAvailability = {
	readonly operation: LayerActionOperation;
	readonly disabled: boolean;
	readonly reason: LayerActionDisabledReason | null;
	readonly issues: readonly LayerActionDisplayIssue[];
};

type NodeVisitContext = {
	readonly layer: SceneLayer;
	readonly layerIndex: number;
	readonly parentNodeIds: readonly string[];
	readonly ancestors: readonly VectorNode[];
	readonly indexPath: readonly number[];
	readonly topLevelIndex: number;
	readonly hiddenByAncestor: boolean;
	readonly lockedByAncestor: boolean;
};

type IssuePresentation = {
	readonly title: string;
	readonly displayMessage: string;
	readonly priority: number;
};

const ISSUE_PRESENTATION = {
	"clipboard.cross-layer-paste-unsupported": {
		title: "Choose the source layer",
		displayMessage: "Paste currently targets the payload's original layer.",
		priority: 30,
	},
	"clipboard.cross-layer-source": {
		title: "Keep sources in one layer",
		displayMessage: "Clipboard actions currently require same-layer sources.",
		priority: 20,
	},
	"clipboard.duplicate-source": {
		title: "Remove duplicate source",
		displayMessage: "The selected source ids must be unique.",
		priority: 70,
	},
	"clipboard.empty-payload": {
		title: "Copy something first",
		displayMessage: "Paste needs at least one node in the clipboard payload.",
		priority: 10,
	},
	"clipboard.empty-selection": {
		title: "Select a node",
		displayMessage: "Clipboard actions need at least one selected node.",
		priority: 10,
	},
	"clipboard.hidden-source": {
		title: "Show the source",
		displayMessage: "Hidden nodes are protected from clipboard actions.",
		priority: 40,
	},
	"clipboard.invalid-payload": {
		title: "Unsupported clipboard payload",
		displayMessage: "The clipboard payload is not a valid scene payload.",
		priority: 10,
	},
	"clipboard.locked-source": {
		title: "Unlock the source",
		displayMessage: "Locked nodes are protected from clipboard actions.",
		priority: 40,
	},
	"clipboard.missing-layer": {
		title: "Target layer is missing",
		displayMessage: "The paste target layer no longer exists.",
		priority: 10,
	},
	"clipboard.missing-source": {
		title: "Source is missing",
		displayMessage: "A selected clipboard source no longer exists.",
		priority: 10,
	},
	"clipboard.nested-source-unsupported": {
		title: "Use a top-level source",
		displayMessage: "Nested clipboard sources need an explicit parent target.",
		priority: 25,
	},
	"clipboard.protected-source": {
		title: "Unprotect the source",
		displayMessage: "A layer or parent is hiding or locking the source.",
		priority: 35,
	},
	"clipboard.protected-target": {
		title: "Unprotect the target layer",
		displayMessage: "The paste target layer is hidden or locked.",
		priority: 35,
	},
	"grouping.child-source": {
		title: "Use top-level nodes",
		displayMessage: "Grouping actions currently operate on top-level nodes.",
		priority: 25,
	},
	"grouping.cross-layer-source": {
		title: "Keep sources in one layer",
		displayMessage: "Grouping currently requires all sources in one layer.",
		priority: 20,
	},
	"grouping.duplicate-source": {
		title: "Remove duplicate source",
		displayMessage: "Grouping source ids must be unique.",
		priority: 70,
	},
	"grouping.hidden-source": {
		title: "Show the source",
		displayMessage: "Hidden nodes or hidden layers cannot be grouped.",
		priority: 40,
	},
	"grouping.locked-source": {
		title: "Unlock the source",
		displayMessage: "Locked nodes or locked layers cannot be changed.",
		priority: 40,
	},
	"grouping.missing-source": {
		title: "Source is missing",
		displayMessage: "A selected grouping source no longer exists.",
		priority: 10,
	},
	"grouping.not-group": {
		title: "Select a group",
		displayMessage: "Ungroup needs a node with child nodes.",
		priority: 15,
	},
	"grouping.too-few-sources": {
		title: "Select two nodes",
		displayMessage: "Grouping needs at least two top-level nodes.",
		priority: 10,
	},
} as const satisfies Record<LayerActionIssueCode, IssuePresentation>;

const ACTION_LABELS = {
	copy: "copy",
	duplicate: "duplicate",
	group: "group",
	paste: "paste",
	ungroup: "ungroup",
} as const satisfies Record<LayerActionOperation, string>;

const unique = <Value>(values: readonly Value[]): readonly Value[] => [
	...new Set(values),
];

const uniqueDefined = <Value>(
	values: readonly (Value | undefined)[],
): readonly Value[] =>
	unique(values.filter((value): value is Value => value !== undefined));

const isPrefixPath = (
	candidate: readonly string[],
	target: readonly string[],
): boolean =>
	candidate.length <= target.length &&
	candidate.every((nodeId, index) => target[index] === nodeId);

const collectNodePaths = (
	nodes: readonly VectorNode[],
	context: NodeVisitContext,
	output: LayerNodePath[],
): void => {
	for (const [siblingIndex, node] of nodes.entries()) {
		const topLevelIndex =
			context.parentNodeIds.length === 0 ? siblingIndex : context.topLevelIndex;
		const parentNodeIds = context.parentNodeIds;
		const nodeIds = [...parentNodeIds, node.id];
		const indexPath = [...context.indexPath, siblingIndex];
		const effectiveVisible = !context.hiddenByAncestor && node.visible;
		const effectiveLocked = context.lockedByAncestor || node.locked;
		const topLevelNodeId = parentNodeIds[0] ?? node.id;
		const path: LayerNodePath = {
			layer: context.layer,
			layerId: context.layer.id,
			layerIndex: context.layerIndex,
			node,
			nodeId: node.id,
			nodeIds,
			parentNodeIds,
			ancestors: context.ancestors,
			depth: nodeIds.length,
			indexPath,
			siblingIndex,
			topLevelIndex,
			topLevelNodeId,
			isNested: parentNodeIds.length > 0,
			visible: node.visible,
			locked: node.locked,
			hiddenByAncestor: context.hiddenByAncestor,
			lockedByAncestor: context.lockedByAncestor,
			effectiveVisible,
			effectiveLocked,
		};
		output.push(path);

		if (node.children) {
			collectNodePaths(
				node.children,
				{
					layer: context.layer,
					layerIndex: context.layerIndex,
					parentNodeIds: nodeIds,
					ancestors: [...context.ancestors, node],
					indexPath,
					topLevelIndex,
					hiddenByAncestor: !effectiveVisible,
					lockedByAncestor: effectiveLocked,
				},
				output,
			);
		}
	}
};

const pathIndexCache = new WeakMap<
	SceneDocument,
	ReadonlyMap<string, LayerNodePath>
>();

const buildPathIndex = (
	document: SceneDocument,
): ReadonlyMap<string, LayerNodePath> => {
	const paths: LayerNodePath[] = [];
	for (const [layerIndex, layer] of document.layers.entries()) {
		collectNodePaths(
			layer.nodes,
			{
				layer,
				layerIndex,
				parentNodeIds: [],
				ancestors: [],
				indexPath: [],
				topLevelIndex: 0,
				hiddenByAncestor: !layer.visible,
				lockedByAncestor: layer.locked,
			},
			paths,
		);
	}
	return new Map(paths.map((path) => [path.nodeId, path]));
};

const getPathIndex = (
	document: SceneDocument,
): ReadonlyMap<string, LayerNodePath> => {
	const cached = pathIndexCache.get(document);
	if (cached) return cached;
	const index = buildPathIndex(document);
	pathIndexCache.set(document, index);
	return index;
};

const normalizeSelectionNodeIds = (
	nodeIds: readonly string[] | undefined,
): readonly string[] => unique(nodeIds ?? []);

const sortedCollapsedIds = (
	collapsedIds: ReadonlySet<string> | undefined,
): readonly string[] => [...(collapsedIds ?? new Set<string>())].sort();

const layerTreeRowsCacheKey = (options: LayerTreeBuildOptions): string =>
	JSON.stringify({
		collapsedIds: sortedCollapsedIds(options.collapsedIds),
		nodeIds: normalizeSelectionNodeIds(options.selection?.nodeIds),
		primaryNodeId: options.selection?.primaryNodeId ?? null,
	});

// Bound per-snapshot row variants so repeated panel reads stay cheap without
// retaining every transient selection/collapse combination for a large document.
const MAX_LAYER_TREE_ROW_CACHE_ENTRIES = 8;
const layerTreeRowsCache = new WeakMap<
	SceneDocument,
	Map<string, readonly LayerTreeRow[]>
>();

const getCachedLayerTreeRows = (
	document: SceneDocument,
	key: string,
): readonly LayerTreeRow[] | undefined => {
	const rowsByKey = layerTreeRowsCache.get(document);
	const rows = rowsByKey?.get(key);
	if (!rows || !rowsByKey) return undefined;
	rowsByKey.delete(key);
	rowsByKey.set(key, rows);
	return rows;
};

const rememberLayerTreeRows = (
	document: SceneDocument,
	key: string,
	rows: readonly LayerTreeRow[],
): void => {
	let rowsByKey = layerTreeRowsCache.get(document);
	if (!rowsByKey) {
		rowsByKey = new Map<string, readonly LayerTreeRow[]>();
		layerTreeRowsCache.set(document, rowsByKey);
	}
	rowsByKey.delete(key);
	rowsByKey.set(key, rows);
	if (rowsByKey.size <= MAX_LAYER_TREE_ROW_CACHE_ENTRIES) return;
	const oldestKey = rowsByKey.keys().next().value;
	if (oldestKey !== undefined) rowsByKey.delete(oldestKey);
};

const fallbackPrimaryPath = (
	selectedPaths: readonly LayerNodePath[],
): LayerNodePath | null => selectedPaths.at(-1) ?? null;

/**
 * Resolves selected node ids into stable scene paths for layer-panel use. The
 * returned paths reference the live document graph and should be treated as
 * read-only view data.
 */
export function deriveSelectionHierarchy(
	document: SceneDocument,
	selection: LayerTreeSelectionInput = {},
): SelectionHierarchy {
	const pathIndex = getPathIndex(document);
	const requestedNodeIds = normalizeSelectionNodeIds(selection.nodeIds);
	const selectedPaths: LayerNodePath[] = [];
	const missingNodeIds: string[] = [];
	for (const nodeId of requestedNodeIds) {
		const path = pathIndex.get(nodeId);
		if (path) selectedPaths.push(path);
		else missingNodeIds.push(nodeId);
	}

	const requestedPrimaryPath = selection.primaryNodeId
		? pathIndex.get(selection.primaryNodeId)
		: undefined;
	const primaryPath =
		requestedPrimaryPath ?? fallbackPrimaryPath(selectedPaths);
	const ancestorNodeIds = unique(
		selectedPaths.flatMap((path) => path.parentNodeIds),
	);
	const selectedLayerIds = unique(selectedPaths.map((path) => path.layerId));

	return {
		requestedNodeIds,
		selectedNodeIds: selectedPaths.map((path) => path.nodeId),
		missingNodeIds,
		selectedPaths,
		primaryNodeId: primaryPath?.nodeId ?? null,
		primaryPath,
		ancestorNodeIds,
		primaryAncestorNodeIds: primaryPath?.parentNodeIds ?? [],
		selectedLayerIds,
		selectedTopLevelNodeIds: unique(
			selectedPaths.map((path) => path.topLevelNodeId),
		),
		hasNestedSelection: selectedPaths.some((path) => path.isNested),
		hasCrossLayerSelection: selectedLayerIds.length > 1,
	};
}

const collectLayerRows = (
	layer: SceneLayer,
	layerIndex: number,
	options: {
		readonly collapsedIds: ReadonlySet<string>;
		readonly selection: SelectionHierarchy;
		readonly selectedNodeIds: ReadonlySet<string>;
		readonly primaryPathNodeIds: ReadonlySet<string>;
		readonly rows: LayerTreeRow[];
	},
): void => {
	const expanded = !options.collapsedIds.has(layer.id);
	const layerNodeIds = layer.nodes.flatMap((node) => collectNodeIds(node, []));
	const containsSelectedDescendant = layerNodeIds.some((nodeId) =>
		options.selectedNodeIds.has(nodeId),
	);
	const containsPrimaryDescendant =
		options.selection.primaryNodeId !== null &&
		layerNodeIds.includes(options.selection.primaryNodeId);

	options.rows.push({
		kind: "layer",
		id: `layer:${layer.id}`,
		layer,
		layerId: layer.id,
		layerIndex,
		name: layer.name,
		depth: 0,
		childCount: layer.nodes.length,
		canExpand: layer.nodes.length > 0,
		expanded,
		visible: layer.visible,
		locked: layer.locked,
		effectiveVisible: layer.visible,
		effectiveLocked: layer.locked,
		selected: false,
		primary: false,
		inPrimaryPath: false,
		containsSelectedDescendant,
		containsPrimaryDescendant,
	});

	if (!expanded) return;
	collectNodeRows(layer.nodes, {
		layer,
		layerIndex,
		parentNodeIds: [],
		indexPath: [],
		topLevelIndex: 0,
		hiddenByAncestor: !layer.visible,
		lockedByAncestor: layer.locked,
		collapsedIds: options.collapsedIds,
		selectedNodeIds: options.selectedNodeIds,
		primaryNodeId: options.selection.primaryNodeId,
		primaryPathNodeIds: options.primaryPathNodeIds,
		rows: options.rows,
	});
};

type NodeRowContext = {
	readonly layer: SceneLayer;
	readonly layerIndex: number;
	readonly parentNodeIds: readonly string[];
	readonly indexPath: readonly number[];
	readonly topLevelIndex: number;
	readonly hiddenByAncestor: boolean;
	readonly lockedByAncestor: boolean;
	readonly collapsedIds: ReadonlySet<string>;
	readonly selectedNodeIds: ReadonlySet<string>;
	readonly primaryNodeId: string | null;
	readonly primaryPathNodeIds: ReadonlySet<string>;
	readonly rows: LayerTreeRow[];
};

const collectNodeIds = (
	node: VectorNode,
	output: string[] = [],
): readonly string[] => {
	output.push(node.id);
	for (const child of node.children ?? []) collectNodeIds(child, output);
	return output;
};

const collectNodeRows = (
	nodes: readonly VectorNode[],
	context: NodeRowContext,
): void => {
	for (const [siblingIndex, node] of nodes.entries()) {
		const topLevelIndex =
			context.parentNodeIds.length === 0 ? siblingIndex : context.topLevelIndex;
		const children = node.children ?? [];
		const nodeIds = [...context.parentNodeIds, node.id];
		const indexPath = [...context.indexPath, siblingIndex];
		const effectiveVisible = !context.hiddenByAncestor && node.visible;
		const effectiveLocked = context.lockedByAncestor || node.locked;
		const expanded = !context.collapsedIds.has(node.id);
		const descendantIds = children.flatMap((child) =>
			collectNodeIds(child, []),
		);
		const containsSelectedDescendant = descendantIds.some((nodeId) =>
			context.selectedNodeIds.has(nodeId),
		);
		const containsPrimaryDescendant =
			context.primaryNodeId !== null &&
			descendantIds.includes(context.primaryNodeId);

		context.rows.push({
			kind: "node",
			id: `node:${node.id}`,
			node,
			nodeId: node.id,
			nodeKind: node.geometry.kind,
			layer: context.layer,
			layerId: context.layer.id,
			layerIndex: context.layerIndex,
			name: node.name,
			depth: nodeIds.length,
			parentNodeIds: context.parentNodeIds,
			nodeIds,
			indexPath,
			siblingIndex,
			topLevelIndex,
			topLevelNodeId: context.parentNodeIds[0] ?? node.id,
			isNested: context.parentNodeIds.length > 0,
			isGroup: children.length > 0,
			childCount: children.length,
			canExpand: children.length > 0,
			expanded,
			visible: node.visible,
			locked: node.locked,
			hiddenByAncestor: context.hiddenByAncestor,
			lockedByAncestor: context.lockedByAncestor,
			effectiveVisible,
			effectiveLocked,
			selected: context.selectedNodeIds.has(node.id),
			primary: context.primaryNodeId === node.id,
			inPrimaryPath: context.primaryPathNodeIds.has(node.id),
			containsSelectedDescendant,
			containsPrimaryDescendant,
		});

		if (children.length === 0 || !expanded) continue;
		collectNodeRows(children, {
			layer: context.layer,
			layerIndex: context.layerIndex,
			parentNodeIds: nodeIds,
			indexPath,
			topLevelIndex,
			hiddenByAncestor: !effectiveVisible,
			lockedByAncestor: effectiveLocked,
			collapsedIds: context.collapsedIds,
			selectedNodeIds: context.selectedNodeIds,
			primaryNodeId: context.primaryNodeId,
			primaryPathNodeIds: context.primaryPathNodeIds,
			rows: context.rows,
		});
	}
};

/**
 * Builds a flattened layer-tree row model for structure UI. Group children stay
 * in document order, collapsed ids prune only display rows, and every node row
 * carries effective hidden/locked state derived from layer and parent ancestry.
 */
export function buildLayerTreeRows(
	document: SceneDocument,
	options: LayerTreeBuildOptions = {},
): readonly LayerTreeRow[] {
	const cacheKey = layerTreeRowsCacheKey(options);
	const cached = getCachedLayerTreeRows(document, cacheKey);
	if (cached) return cached;

	const selection = deriveSelectionHierarchy(document, options.selection);
	const selectedNodeIds = new Set(selection.selectedNodeIds);
	const primaryPathNodeIds = new Set(selection.primaryPath?.nodeIds ?? []);
	const collapsedIds = options.collapsedIds ?? new Set<string>();
	const rows: LayerTreeRow[] = [];
	for (const [layerIndex, layer] of document.layers.entries()) {
		collectLayerRows(layer, layerIndex, {
			collapsedIds,
			selection,
			selectedNodeIds,
			primaryPathNodeIds,
			rows,
		});
	}
	rememberLayerTreeRows(document, cacheKey, rows);
	return rows;
}

/**
 * Converts grouping and clipboard typed issues into a compact issue list for
 * toolbars or row menus. The input is structural, allowing grouping and
 * clipboard planners to keep their own issue types without feature imports.
 */
export function formatLayerActionIssues(
	issues: readonly LayerActionIssue[],
): readonly LayerActionDisplayIssue[] {
	return issues.map((issue) => {
		const presentation = ISSUE_PRESENTATION[issue.code];
		return {
			...issue,
			title: presentation.title,
			displayMessage: presentation.displayMessage,
			priority: presentation.priority,
		};
	});
}

/**
 * Reduces typed planner issues into a single disabled reason while preserving
 * all display issues for detailed UI. Warnings remain visible but do not disable
 * the action; the first highest-priority error becomes the short reason.
 */
export function buildLayerActionAvailability(
	operation: LayerActionOperation,
	issues: readonly LayerActionIssue[],
): LayerActionAvailability {
	const displayIssues = formatLayerActionIssues(issues);
	const blockingIssues = displayIssues
		.filter((issue) => issue.severity === "error")
		.toSorted((left, right) => left.priority - right.priority);
	const primaryIssue = blockingIssues[0];

	if (!primaryIssue) {
		return {
			operation,
			disabled: false,
			reason: null,
			issues: displayIssues,
		};
	}

	return {
		operation,
		disabled: true,
		reason: {
			operation,
			title: `Cannot ${ACTION_LABELS[operation]}`,
			message: primaryIssue.displayMessage,
			issueCode: primaryIssue.code,
			issueCount: blockingIssues.length,
			sourceIds: uniqueDefined(blockingIssues.map((issue) => issue.sourceId)),
			layerIds: uniqueDefined(blockingIssues.map((issue) => issue.layerId)),
			protectionReasons: uniqueDefined(
				blockingIssues.map((issue) => issue.reason),
			),
			issueCodes: unique(blockingIssues.map((issue) => issue.code)),
		},
		issues: displayIssues,
	};
}

/**
 * Returns true when a candidate path belongs to the current primary selection
 * branch. This keeps row styling logic out of React components and avoids each
 * panel rebuilding ancestor sets independently.
 */
export function isPathInPrimarySelection(
	path: LayerNodePath,
	selection: SelectionHierarchy,
): boolean {
	const primaryNodeIds = selection.primaryPath?.nodeIds;
	if (!primaryNodeIds) return false;
	return (
		isPrefixPath(path.nodeIds, primaryNodeIds) ||
		isPrefixPath(primaryNodeIds, path.nodeIds)
	);
}
