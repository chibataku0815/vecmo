import { readAppearanceMaskRelations } from "@/entities/scene/model/appearance";
import { sceneAssetForGeometry } from "@/entities/scene/model/assets";
import {
	frameClipsContent,
	isFrameNode,
	type NormalizedArtboard,
	normalizeArtboardRole,
	selectAllArtboards,
	selectCurrentArtboard,
	selectNodeArtboardMapping,
} from "@/entities/scene/model/selectors";
import type {
	SceneDocument,
	SceneLayer,
	VectorNode,
	VectorNodeKind,
} from "@/entities/scene/model/types";

type IdCollection = ReadonlySet<string> | readonly string[];

export type LayerPanelNodeRoleId =
	| VectorNodeKind
	| "frame"
	| "group"
	| "mesh"
	| "video"
	| "external-asset"
	| "blend";

export type LayerPanelNodeRoleBadgeId =
	| "frame"
	| "group"
	| "blend"
	| "clips-content"
	| "mesh"
	| "mask-source"
	| "masked-content"
	| "component-source"
	| "component-instance";

export type LayerPanelNodeRoleBadge = {
	readonly id: LayerPanelNodeRoleBadgeId;
	readonly label: string;
	readonly count?: number;
};

export type LayerPanelNodeRole = {
	readonly id: LayerPanelNodeRoleId;
	readonly label: string;
	readonly searchTerms: readonly string[];
	readonly badges: readonly LayerPanelNodeRoleBadge[];
};

export type LayerPanelLayerRow = {
	readonly kind: "layer";
	readonly rowId: string;
	readonly rowIndex: number;
	readonly artboardId?: string;
	readonly layerId: string;
	readonly layer: SceneLayer;
	readonly layerIndex: number;
	readonly depth: number;
	readonly expanded: boolean;
	readonly hasChildren: boolean;
	readonly visible: boolean;
	readonly locked: boolean;
	readonly effectiveVisible: boolean;
	readonly effectiveLocked: boolean;
	readonly subtreeNodeIds: readonly string[];
};

export type LayerPanelNodeRow = {
	readonly kind: "node";
	readonly rowId: string;
	readonly rowIndex: number;
	readonly artboardId?: string;
	readonly nodeId: string;
	readonly node: VectorNode;
	readonly role: LayerPanelNodeRole;
	readonly layerId: string;
	readonly depth: number;
	readonly parentIds: readonly string[];
	readonly siblingIndex: number;
	readonly siblingCount: number;
	readonly expanded: boolean;
	readonly hasChildren: boolean;
	readonly selected: boolean;
	readonly primary: boolean;
	readonly visible: boolean;
	readonly locked: boolean;
	readonly effectiveVisible: boolean;
	readonly effectiveLocked: boolean;
	readonly canMoveUp: boolean;
	readonly canMoveDown: boolean;
	readonly subtreeNodeIds: readonly string[];
};

export type LayerPanelRow = LayerPanelLayerRow | LayerPanelNodeRow;

export type LayerPanelArtboardRow = {
	readonly kind: "artboard";
	readonly rowId: string;
	readonly rowIndex: number;
	readonly artboardId: string;
	readonly artboard: NormalizedArtboard;
	readonly artboardIndex: number;
	readonly artboardCount: number;
	readonly depth: 0;
	readonly current: boolean;
	readonly selected: boolean;
	readonly primary: boolean;
	readonly expanded: boolean;
	readonly hasChildren: boolean;
	readonly canMoveUp: boolean;
	readonly canMoveDown: boolean;
	readonly canRemove: boolean;
	readonly layerCount: number;
	readonly nodeCount: number;
	readonly selectedNodeCount: number;
	readonly hiddenNodeCount: number;
	readonly lockedNodeCount: number;
	readonly visible: boolean;
	readonly locked: boolean;
	readonly effectiveVisible: boolean;
	readonly effectiveLocked: boolean;
	readonly subtreeNodeIds: readonly string[];
};

export type ArtboardLayerPanelRow = LayerPanelArtboardRow | LayerPanelRow;

/**
 * Mirrors the delete command's structure-panel protection policy for a single
 * row: hidden nodes and nodes protected by a locked ancestor stay visible in the
 * layer tree, but destructive row actions must be disabled for them.
 */
export function canDeleteLayerPanelNodeRow(
	row: Pick<LayerPanelNodeRow, "effectiveLocked" | "effectiveVisible">,
): boolean {
	return row.effectiveVisible && !row.effectiveLocked;
}

export type FlattenLayerPanelRowsOptions = {
	readonly collapsedIds?: IdCollection;
	readonly selectedNodeIds?: IdCollection;
	readonly primaryNodeId?: string | null;
};

/**
 * Read-side filters applied after row flattening. They intentionally operate on
 * row ids and selected node ids instead of scene nodes so the Layers UI can
 * change focus modes without inventing a second scene traversal.
 */
export type FilterLayerPanelRowsOptions = {
	readonly searchQuery?: string;
	readonly currentArtboardOnly?: boolean;
	readonly focusSelected?: boolean;
	readonly selectedNodeIds?: IdCollection;
};

/** Empty states surfaced by the compact Layers filter controls. */
export type LayerPanelFilteredRowsEmptyState =
	| "no-rows"
	| "no-current-artboard"
	| "no-search-results"
	| "no-selection"
	| "no-focused-selection";

/**
 * Filtered Layers rows plus counts for compact row-status UI. `scopedRowCount`
 * reflects current-artboard filtering before search/focus trimming, while
 * `rows` keeps the original row object identity and order.
 */
export type LayerPanelFilteredRows = {
	readonly rows: readonly ArtboardLayerPanelRow[];
	readonly totalRowCount: number;
	readonly scopedRowCount: number;
	readonly visibleRowCount: number;
	readonly hiddenRowCount: number;
	readonly searchQuery: string;
	readonly searchActive: boolean;
	readonly currentArtboardOnly: boolean;
	readonly focusSelected: boolean;
	readonly currentArtboardId: string | null;
	readonly selectedNodeCount: number;
	readonly emptyState: LayerPanelFilteredRowsEmptyState | null;
};

const toIdSet = (ids: IdCollection | undefined): ReadonlySet<string> =>
	ids instanceof Set ? ids : new Set(ids ?? []);

const sortedIds = (ids: IdCollection | undefined): readonly string[] =>
	[...toIdSet(ids)].sort();

const flattenedRowsCacheKey = (options: FlattenLayerPanelRowsOptions): string =>
	JSON.stringify({
		collapsedIds: sortedIds(options.collapsedIds),
		selectedNodeIds: sortedIds(options.selectedNodeIds),
		primaryNodeId: options.primaryNodeId ?? null,
	});

// Keep only the recent view states for one immutable document snapshot. Layers
// can cycle collapse/filter state quickly, but row derivation should not grow an
// unbounded cache while the scene document itself remains unchanged.
const MAX_DERIVED_ROW_CACHE_ENTRIES = 8;
const layerPanelRowsCache = new WeakMap<
	SceneDocument,
	Map<string, readonly LayerPanelRow[]>
>();
const artboardLayerPanelRowsCache = new WeakMap<
	SceneDocument,
	Map<string, readonly ArtboardLayerPanelRow[]>
>();

const getCachedRows = <Row>(
	cache: WeakMap<SceneDocument, Map<string, readonly Row[]>>,
	document: SceneDocument,
	key: string,
): readonly Row[] | undefined => {
	const rowsByKey = cache.get(document);
	const rows = rowsByKey?.get(key);
	if (!rows || !rowsByKey) return undefined;
	rowsByKey.delete(key);
	rowsByKey.set(key, rows);
	return rows;
};

const rememberCachedRows = <Row>(
	cache: WeakMap<SceneDocument, Map<string, readonly Row[]>>,
	document: SceneDocument,
	key: string,
	rows: readonly Row[],
): void => {
	let rowsByKey = cache.get(document);
	if (!rowsByKey) {
		rowsByKey = new Map<string, readonly Row[]>();
		cache.set(document, rowsByKey);
	}
	rowsByKey.delete(key);
	rowsByKey.set(key, rows);
	if (rowsByKey.size <= MAX_DERIVED_ROW_CACHE_ENTRIES) return;
	const oldestKey = rowsByKey.keys().next().value;
	if (oldestKey !== undefined) rowsByKey.delete(oldestKey);
};

const collectNodeIds = (
	nodes: readonly VectorNode[],
	output: string[] = [],
): string[] => {
	for (const node of nodes) {
		output.push(node.id);
		if (node.children) collectNodeIds(node.children, output);
	}
	return output;
};

const collectNodeIdsForArtboard = (
	nodes: readonly VectorNode[],
	artboardId: string,
	nodeArtboardIds: Readonly<Record<string, string>>,
	output: string[] = [],
): string[] => {
	for (const node of nodes) {
		if (nodeArtboardIds[node.id] === artboardId) output.push(node.id);
		if (node.children) {
			collectNodeIdsForArtboard(
				node.children,
				artboardId,
				nodeArtboardIds,
				output,
			);
		}
	}
	return output;
};

type LayerPanelAppearanceContext = {
	readonly maskSourceNodeIds: ReadonlySet<string>;
	readonly maskRelationCountByNodeId: ReadonlyMap<string, number>;
	readonly videoNodeIds: ReadonlySet<string>;
	readonly externalAssetNodeIds: ReadonlySet<string>;
};

const collectLayerPanelAppearanceContext = (
	document: SceneDocument,
): LayerPanelAppearanceContext => {
	const maskSourceNodeIds = new Set<string>();
	const maskRelationCountByNodeId = new Map<string, number>();
	const videoNodeIds = new Set<string>();
	const externalAssetNodeIds = new Set<string>();

	const visit = (nodes: readonly VectorNode[]): void => {
		for (const node of nodes) {
			if (node.geometry.kind === "image") {
				const asset = sceneAssetForGeometry(document, node.geometry);
				if (asset?.kind === "video") {
					videoNodeIds.add(node.id);
				}
				if (
					asset?.kind === "external-scene" ||
					asset?.kind === "model-3d" ||
					asset?.kind === "code-module"
				) {
					externalAssetNodeIds.add(node.id);
				}
			}
			const relations = readAppearanceMaskRelations(node);
			if (relations.length > 0) {
				maskRelationCountByNodeId.set(node.id, relations.length);
			}
			for (const relation of relations) {
				if (relation.maskNodeId) maskSourceNodeIds.add(relation.maskNodeId);
			}
			if (node.children) visit(node.children);
		}
	};

	for (const layer of document.layers) {
		visit(layer.nodes);
	}

	return {
		maskSourceNodeIds,
		maskRelationCountByNodeId,
		videoNodeIds,
		externalAssetNodeIds,
	};
};

const geometryRoleLabels = {
	rect: "Rectangle",
	ellipse: "Ellipse",
	line: "Line",
	polygon: "Polygon",
	star: "Star",
	path: "Path",
	text: "Text",
	image: "Image",
} satisfies Record<VectorNodeKind, string>;

const hasMeshPaint = (node: VectorNode): boolean =>
	[...(node.style.fills ?? []), ...(node.style.strokes ?? [])].some(
		(paint) => paint.kind === "mesh-gradient",
	);

const badge = (
	id: LayerPanelNodeRoleBadgeId,
	label: string,
	count?: number,
): LayerPanelNodeRoleBadge =>
	count === undefined ? { id, label } : { id, label, count };

const plural = (count: number, noun: string): string =>
	`${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * Derives a compact display role for a scene node without changing the scene
 * contract. Structure rows prioritize frame/group/mesh readability, while mask
 * and component metadata stay badges so Layers does not imply unsupported row
 * editing tools.
 */
export function getLayerPanelNodeRole(
	node: VectorNode,
	appearance: LayerPanelAppearanceContext = {
		maskSourceNodeIds: new Set<string>(),
		maskRelationCountByNodeId: new Map<string, number>(),
		videoNodeIds: new Set<string>(),
		externalAssetNodeIds: new Set<string>(),
	},
): LayerPanelNodeRole {
	const children = node.children ?? [];
	const frame = isFrameNode(node);
	const group = !frame && children.length > 0;
	const mesh = hasMeshPaint(node);
	const video = appearance.videoNodeIds.has(node.id);
	const externalAsset = appearance.externalAssetNodeIds.has(node.id);
	const badges: LayerPanelNodeRoleBadge[] = [];
	let id: LayerPanelNodeRoleId = node.geometry.kind;
	let label = geometryRoleLabels[node.geometry.kind];
	const searchTerms: string[] = [label, node.geometry.kind];

	if (externalAsset) {
		id = "external-asset";
		label = "External asset";
		searchTerms.push("external asset", "3d", "code", "model", "preview");
	} else if (video) {
		id = "video";
		label = "Video";
		searchTerms.push("video", "media", "clip");
	} else if (frame) {
		id = "frame";
		label = "Frame";
		searchTerms.push("frame");
		badges.push(badge("frame", "Frame"));
		if (frameClipsContent(node)) {
			searchTerms.push("clip", "clips content");
			badges.push(badge("clips-content", "Clips content"));
		}
	} else if (node.blend) {
		id = "blend";
		label = "Blend";
		searchTerms.push("blend", "steps");
		badges.push(badge("blend", "Blend"));
	} else if (group) {
		id = "group";
		label = "Group";
		searchTerms.push("group");
		badges.push(badge("group", "Group"));
	} else if (mesh) {
		id = "mesh";
		label = "Mesh";
		searchTerms.push("mesh", "gradient mesh");
	}

	if (mesh) {
		searchTerms.push("mesh", "gradient mesh");
		badges.push(badge("mesh", "Gradient mesh"));
	}

	if (appearance.maskSourceNodeIds.has(node.id)) {
		searchTerms.push("mask source");
		badges.push(badge("mask-source", "Mask source"));
	}

	const maskRelationCount =
		appearance.maskRelationCountByNodeId.get(node.id) ?? 0;
	if (maskRelationCount > 0) {
		searchTerms.push("masked content", "mask relation");
		badges.push(
			badge(
				"masked-content",
				`Masked content (${plural(maskRelationCount, "relation")})`,
				maskRelationCount,
			),
		);
	}

	if (node.component?.kind === "source") {
		searchTerms.push("saved object");
		badges.push(badge("component-source", "Saved object"));
	}
	if (node.component?.kind === "instance") {
		searchTerms.push("placed copy");
		badges.push(badge("component-instance", "Placed copy"));
	}

	return { id, label, searchTerms, badges };
}

export const artboardRowId = (artboardId: string): string =>
	`artboard:${artboardId}`;

export const artboardLayerRowId = (
	artboardId: string,
	layerId: string,
): string => `artboard-layer:${artboardId}:${layerId}`;

const hasNodeForArtboard = (
	nodes: readonly VectorNode[],
	artboardId: string,
	nodeArtboardIds: Readonly<Record<string, string>>,
): boolean => {
	for (const node of nodes) {
		if (nodeArtboardIds[node.id] === artboardId) return true;
		if (
			node.children &&
			hasNodeForArtboard(node.children, artboardId, nodeArtboardIds)
		) {
			return true;
		}
	}
	return false;
};

type ArtboardState = {
	readonly nodeIds: readonly string[];
	readonly layerIds: ReadonlySet<string>;
	readonly hiddenNodeCount: number;
	readonly lockedNodeCount: number;
};

type MutableArtboardState = {
	readonly nodeIds: string[];
	readonly layerIds: Set<string>;
	hiddenNodeCount: number;
	lockedNodeCount: number;
};

const EMPTY_ARTBOARD_STATE: ArtboardState = {
	nodeIds: [],
	layerIds: new Set<string>(),
	hiddenNodeCount: 0,
	lockedNodeCount: 0,
};

/**
 * Buckets every node's owning-artboard membership and inherited visibility/lock
 * state in a single document traversal, instead of re-walking the whole tree
 * once per artboard. The result is keyed by artboard id; callers read their slice
 * in O(1) so the artboard layer-panel build stays linear in node count rather
 * than O(artboards × nodes) on large documents.
 */
const collectArtboardStates = (
	document: SceneDocument,
	nodeArtboardIds: Readonly<Record<string, string>>,
): ReadonlyMap<string, ArtboardState> => {
	const states = new Map<string, MutableArtboardState>();

	const stateFor = (artboardId: string): MutableArtboardState => {
		const existing = states.get(artboardId);
		if (existing) return existing;
		const created: MutableArtboardState = {
			nodeIds: [],
			layerIds: new Set<string>(),
			hiddenNodeCount: 0,
			lockedNodeCount: 0,
		};
		states.set(artboardId, created);
		return created;
	};

	const visit = (
		layer: SceneLayer,
		nodes: readonly VectorNode[],
		inheritedVisible: boolean,
		inheritedLocked: boolean,
	): void => {
		for (const node of nodes) {
			const effectiveVisible = inheritedVisible && node.visible;
			const effectiveLocked = inheritedLocked || node.locked;
			const artboardId = nodeArtboardIds[node.id];
			if (artboardId !== undefined) {
				const state = stateFor(artboardId);
				state.nodeIds.push(node.id);
				state.layerIds.add(layer.id);
				if (!effectiveVisible) state.hiddenNodeCount += 1;
				if (effectiveLocked) state.lockedNodeCount += 1;
			}
			if (node.children) {
				visit(layer, node.children, effectiveVisible, effectiveLocked);
			}
		}
	};

	for (const layer of document.layers) {
		visit(layer, layer.nodes, layer.visible, layer.locked);
	}

	return states;
};

const pushNodeRows = (
	rows: LayerPanelRow[],
	layer: SceneLayer,
	nodes: readonly VectorNode[],
	context: {
		readonly collapsedIds: ReadonlySet<string>;
		readonly selectedNodeIds: ReadonlySet<string>;
		readonly primaryNodeId: string | null;
		readonly appearance: LayerPanelAppearanceContext;
		readonly depth: number;
		readonly parentIds: readonly string[];
		readonly inheritedVisible: boolean;
		readonly inheritedLocked: boolean;
	},
): void => {
	nodes.forEach((node, siblingIndex) => {
		const children = node.children ?? [];
		const hasChildren = children.length > 0;
		const expanded = !context.collapsedIds.has(node.id);
		const effectiveVisible = context.inheritedVisible && node.visible;
		const effectiveLocked = context.inheritedLocked || node.locked;
		rows.push({
			kind: "node",
			rowId: `node:${node.id}`,
			rowIndex: rows.length,
			nodeId: node.id,
			node,
			role: getLayerPanelNodeRole(node, context.appearance),
			layerId: layer.id,
			depth: context.depth,
			parentIds: context.parentIds,
			siblingIndex,
			siblingCount: nodes.length,
			expanded,
			hasChildren,
			selected: context.selectedNodeIds.has(node.id),
			primary: context.primaryNodeId === node.id,
			visible: node.visible,
			locked: node.locked,
			effectiveVisible,
			effectiveLocked,
			canMoveUp: siblingIndex > 0,
			canMoveDown: siblingIndex < nodes.length - 1,
			subtreeNodeIds: collectNodeIds([node]),
		});
		if (!hasChildren || !expanded) return;
		pushNodeRows(rows, layer, children, {
			...context,
			depth: context.depth + 1,
			parentIds: [...context.parentIds, node.id],
			inheritedVisible: effectiveVisible,
			inheritedLocked: effectiveLocked,
		});
	});
};

const pushArtboardNodeRows = (
	rows: ArtboardLayerPanelRow[],
	layer: SceneLayer,
	nodes: readonly VectorNode[],
	context: {
		readonly artboardId: string;
		readonly nodeArtboardIds: Readonly<Record<string, string>>;
		readonly collapsedIds: ReadonlySet<string>;
		readonly selectedNodeIds: ReadonlySet<string>;
		readonly primaryNodeId: string | null;
		readonly appearance: LayerPanelAppearanceContext;
		readonly depth: number;
		readonly parentIds: readonly string[];
		readonly inheritedVisible: boolean;
		readonly inheritedLocked: boolean;
	},
): void => {
	nodes.forEach((node, siblingIndex) => {
		const children = node.children ?? [];
		const nodeBelongsToArtboard =
			context.nodeArtboardIds[node.id] === context.artboardId;
		const hasChildren = hasNodeForArtboard(
			children,
			context.artboardId,
			context.nodeArtboardIds,
		);
		const expanded = !context.collapsedIds.has(node.id);
		const effectiveVisible = context.inheritedVisible && node.visible;
		const effectiveLocked = context.inheritedLocked || node.locked;

		if (nodeBelongsToArtboard) {
			rows.push({
				kind: "node",
				rowId: `artboard-node:${context.artboardId}:${node.id}`,
				rowIndex: rows.length,
				artboardId: context.artboardId,
				nodeId: node.id,
				node,
				role: getLayerPanelNodeRole(node, context.appearance),
				layerId: layer.id,
				depth: context.depth,
				parentIds: context.parentIds,
				siblingIndex,
				siblingCount: nodes.length,
				expanded,
				hasChildren,
				selected: context.selectedNodeIds.has(node.id),
				primary: context.primaryNodeId === node.id,
				visible: node.visible,
				locked: node.locked,
				effectiveVisible,
				effectiveLocked,
				canMoveUp: siblingIndex > 0,
				canMoveDown: siblingIndex < nodes.length - 1,
				subtreeNodeIds: collectNodeIds([node]),
			});
		}

		if (!children.length || (nodeBelongsToArtboard && !expanded)) return;
		pushArtboardNodeRows(rows, layer, children, {
			...context,
			depth: nodeBelongsToArtboard ? context.depth + 1 : context.depth,
			parentIds: [...context.parentIds, node.id],
			inheritedVisible: effectiveVisible,
			inheritedLocked: effectiveLocked,
		});
	});
};

/**
 * Flattens the document tree into stable layer-panel rows without rendering
 * React. The row contract carries inherited visibility/lock state and selection
 * metadata so future virtualization can render a slice without recursively
 * walking the scene on every row.
 */
export function flattenLayerPanelRows(
	document: SceneDocument,
	options: FlattenLayerPanelRowsOptions = {},
): readonly LayerPanelRow[] {
	const cacheKey = flattenedRowsCacheKey(options);
	const cached = getCachedRows(layerPanelRowsCache, document, cacheKey);
	if (cached) return cached;

	const collapsedIds = toIdSet(options.collapsedIds);
	const selectedNodeIds = toIdSet(options.selectedNodeIds);
	const primaryNodeId = options.primaryNodeId ?? null;
	const appearance = collectLayerPanelAppearanceContext(document);
	const rows: LayerPanelRow[] = [];

	document.layers.forEach((layer, layerIndex) => {
		const expanded = !collapsedIds.has(layer.id);
		rows.push({
			kind: "layer",
			rowId: `layer:${layer.id}`,
			rowIndex: rows.length,
			layerId: layer.id,
			layer,
			layerIndex,
			depth: 0,
			expanded,
			hasChildren: layer.nodes.length > 0,
			visible: layer.visible,
			locked: layer.locked,
			effectiveVisible: layer.visible,
			effectiveLocked: layer.locked,
			subtreeNodeIds: collectNodeIds(layer.nodes),
		});
		if (!expanded) return;
		pushNodeRows(rows, layer, layer.nodes, {
			collapsedIds,
			selectedNodeIds,
			primaryNodeId,
			appearance,
			depth: 1,
			parentIds: [],
			inheritedVisible: layer.visible,
			inheritedLocked: layer.locked,
		});
	});

	rememberCachedRows(layerPanelRowsCache, document, cacheKey, rows);
	return rows;
}

/**
 * Builds the Layers panel's multi-artboard read model. Artboards are display
 * sections, while layer and node rows keep their original scene references so
 * existing selection, rename, lock, hide, and non-artboard reorder commands keep
 * targeting the document graph instead of a filtered copy.
 */
export function flattenArtboardLayerPanelRows(
	document: SceneDocument,
	options: FlattenLayerPanelRowsOptions = {},
): readonly ArtboardLayerPanelRow[] {
	const cacheKey = flattenedRowsCacheKey(options);
	const cached = getCachedRows(artboardLayerPanelRowsCache, document, cacheKey);
	if (cached) return cached;

	const collapsedIds = toIdSet(options.collapsedIds);
	const selectedNodeIds = toIdSet(options.selectedNodeIds);
	const primaryNodeId = options.primaryNodeId ?? null;
	const appearance = collectLayerPanelAppearanceContext(document);
	const artboards = selectAllArtboards(document);
	const currentArtboard = selectCurrentArtboard(document);
	const mapping = selectNodeArtboardMapping(document);
	const artboardStates = collectArtboardStates(document, mapping.byNodeId);
	const rows: ArtboardLayerPanelRow[] = [];

	for (const [artboardIndex, artboard] of artboards.entries()) {
		const state = artboardStates.get(artboard.id) ?? EMPTY_ARTBOARD_STATE;
		const nodeCount = state.nodeIds.length;
		const selectedNodeCount = state.nodeIds.filter((nodeId) =>
			selectedNodeIds.has(nodeId),
		).length;
		const expanded = !collapsedIds.has(artboardRowId(artboard.id));

		rows.push({
			kind: "artboard",
			rowId: artboardRowId(artboard.id),
			rowIndex: rows.length,
			artboardId: artboard.id,
			artboard,
			artboardIndex,
			artboardCount: artboards.length,
			depth: 0,
			current: artboard.id === currentArtboard.id,
			selected: selectedNodeCount > 0,
			primary:
				primaryNodeId !== null &&
				mapping.byNodeId[primaryNodeId] === artboard.id,
			expanded,
			hasChildren: nodeCount > 0,
			canMoveUp: artboardIndex > 1,
			canMoveDown: artboardIndex > 0 && artboardIndex < artboards.length - 1,
			canRemove: artboards.length > 1,
			layerCount: state.layerIds.size,
			nodeCount,
			selectedNodeCount,
			hiddenNodeCount: state.hiddenNodeCount,
			lockedNodeCount: state.lockedNodeCount,
			visible: nodeCount === 0 || state.hiddenNodeCount < nodeCount,
			locked: nodeCount > 0 && state.lockedNodeCount === nodeCount,
			effectiveVisible: nodeCount === 0 || state.hiddenNodeCount < nodeCount,
			effectiveLocked: nodeCount > 0 && state.lockedNodeCount === nodeCount,
			subtreeNodeIds: state.nodeIds,
		});

		if (!expanded) continue;

		document.layers.forEach((layer, layerIndex) => {
			const rowId = artboardLayerRowId(artboard.id, layer.id);
			const layerArtboardNodeIds = collectNodeIdsForArtboard(
				layer.nodes,
				artboard.id,
				mapping.byNodeId,
			);
			const hasChildren = layerArtboardNodeIds.length > 0;
			if (!hasChildren) return;
			const layerExpanded = !collapsedIds.has(rowId);
			rows.push({
				kind: "layer",
				rowId,
				rowIndex: rows.length,
				artboardId: artboard.id,
				layerId: layer.id,
				layer,
				layerIndex,
				depth: 1,
				expanded: layerExpanded,
				hasChildren,
				visible: layer.visible,
				locked: layer.locked,
				effectiveVisible: layer.visible,
				effectiveLocked: layer.locked,
				subtreeNodeIds: layerArtboardNodeIds,
			});
			if (!layerExpanded) return;
			pushArtboardNodeRows(rows, layer, layer.nodes, {
				artboardId: artboard.id,
				nodeArtboardIds: mapping.byNodeId,
				collapsedIds,
				selectedNodeIds,
				primaryNodeId,
				appearance,
				depth: 2,
				parentIds: [],
				inheritedVisible: layer.visible,
				inheritedLocked: layer.locked,
			});
		});
	}

	rememberCachedRows(artboardLayerPanelRowsCache, document, cacheKey, rows);
	return rows;
}

/**
 * Inclusive node-id span between an anchor row and a target row over the rows
 * exactly as rendered (post-collapse, post-filter). Range selection is a physical
 * sweep over what is on screen, so it walks render order, skips non-node header
 * rows, and includes any crossed locked/hidden node rows — lock and visibility are
 * enforced at mutation time, never at selection time, mirroring
 * {@link canDeleteLayerPanelNodeRow}. This intentionally diverges from
 * {@link flattenArtboardLayerPanelRows}'s `selectableNodeIds` scope (Select All),
 * which is a programmatic, document-wide selection rather than an on-screen sweep.
 *
 * Direction-agnostic: an anchor above or below the target yields the same set.
 * Returns `null` — the single fallback signal — when there is no anchor or the
 * anchor/target is not a rendered node row (collapsed, filtered, or deleted away),
 * letting the caller degrade to a plain single-select.
 */
export function rangeNodeIds(
	rows: readonly ArtboardLayerPanelRow[],
	anchorNodeId: string | null,
	targetNodeId: string,
): readonly string[] | null {
	if (anchorNodeId === null) return null;
	const anchorIndex = rows.findIndex(
		(row) => row.kind === "node" && row.nodeId === anchorNodeId,
	);
	const targetIndex = rows.findIndex(
		(row) => row.kind === "node" && row.nodeId === targetNodeId,
	);
	if (anchorIndex === -1 || targetIndex === -1) return null;
	const lo = Math.min(anchorIndex, targetIndex);
	const hi = Math.max(anchorIndex, targetIndex);
	return rows
		.slice(lo, hi + 1)
		.filter((row): row is LayerPanelNodeRow => row.kind === "node")
		.map((row) => row.nodeId);
}

const normalizeSearchText = (value: string): string =>
	value
		.trim()
		.toLowerCase()
		.replace(/[\s:_/-]+/g, " ");

const searchTermsForQuery = (query: string | undefined): readonly string[] =>
	normalizeSearchText(query ?? "")
		.split(" ")
		.filter((term) => term.length > 0);

const rowStateSearchFields = (
	row: ArtboardLayerPanelRow,
): readonly string[] => {
	const fields: string[] = [];
	if (!row.effectiveVisible) fields.push("hidden");
	if (row.effectiveLocked) fields.push("locked");
	if (row.kind === "artboard") {
		const role = normalizeArtboardRole(row.artboard);
		fields.push(role, role.replace("-", " "));
		if (row.current) fields.push("current");
		if (row.nodeCount === 0) fields.push("empty");
		if (row.hiddenNodeCount > 0) fields.push("hidden");
		if (row.lockedNodeCount > 0) fields.push("locked");
	}
	if (row.kind === "node") {
		if (row.selected) fields.push("selected");
		if (row.primary) fields.push("primary");
		fields.push(row.role.label, ...row.role.searchTerms);
		fields.push(...row.role.badges.map((badge) => badge.label));
	}
	return fields;
};

const rowSearchText = (row: ArtboardLayerPanelRow): string => {
	if (row.kind === "artboard") {
		return normalizeSearchText(
			[
				"artboard",
				row.artboard.id,
				row.artboard.name,
				...rowStateSearchFields(row),
			].join(" "),
		);
	}
	if (row.kind === "layer") {
		return normalizeSearchText(
			[
				"layer",
				row.layer.id,
				row.layer.name,
				...rowStateSearchFields(row),
			].join(" "),
		);
	}
	return normalizeSearchText(
		[
			"node",
			row.node.id,
			row.node.name,
			row.node.geometry.kind,
			...rowStateSearchFields(row),
		].join(" "),
	);
};

const rowMatchesSearch = (
	row: ArtboardLayerPanelRow,
	terms: readonly string[],
): boolean => {
	if (terms.length === 0) return true;
	const text = rowSearchText(row);
	return terms.every((term) => text.includes(term));
};

const deriveSelectedNodeIds = (
	rows: readonly ArtboardLayerPanelRow[],
	options: FilterLayerPanelRowsOptions,
): ReadonlySet<string> => {
	if (options.selectedNodeIds !== undefined) {
		return toIdSet(options.selectedNodeIds);
	}
	const selectedNodeIds = new Set<string>();
	for (const row of rows) {
		if (row.kind === "node" && row.selected) selectedNodeIds.add(row.nodeId);
	}
	return selectedNodeIds;
};

const rowMatchesSelectedFocus = (
	row: ArtboardLayerPanelRow,
	selectedNodeIds: ReadonlySet<string>,
): boolean => {
	if (selectedNodeIds.size === 0) return false;
	if (row.kind === "node") return selectedNodeIds.has(row.nodeId);
	return row.subtreeNodeIds.some((nodeId) => selectedNodeIds.has(nodeId));
};

const currentArtboardIdFromRows = (
	rows: readonly ArtboardLayerPanelRow[],
): string | null =>
	rows.find((row) => row.kind === "artboard" && row.current)?.artboardId ??
	null;

const resolveEmptyState = (options: {
	readonly visibleRowCount: number;
	readonly scopedRowCount: number;
	readonly totalRowCount: number;
	readonly searchActive: boolean;
	readonly focusSelected: boolean;
	readonly currentArtboardOnly: boolean;
	readonly selectedNodeCount: number;
}): LayerPanelFilteredRowsEmptyState | null => {
	if (options.visibleRowCount > 0) return null;
	if (options.totalRowCount === 0) return "no-rows";
	if (options.currentArtboardOnly && options.scopedRowCount === 0) {
		return "no-current-artboard";
	}
	if (options.focusSelected && options.selectedNodeCount === 0) {
		return "no-selection";
	}
	if (options.searchActive) return "no-search-results";
	if (options.focusSelected) return "no-focused-selection";
	return "no-rows";
};

/**
 * Filters flattened layer-panel rows for large-document navigation while
 * preserving the original row ids and row objects. Matching node/layer/artboard
 * rows pull their visible ancestors into the result, so search and selection
 * focus keep enough hierarchy context without walking the scene graph again.
 */
export function filterArtboardLayerPanelRows(
	rows: readonly ArtboardLayerPanelRow[],
	options: FilterLayerPanelRowsOptions = {},
): LayerPanelFilteredRows {
	const searchTerms = searchTermsForQuery(options.searchQuery);
	const searchQuery = searchTerms.join(" ");
	const searchActive = searchTerms.length > 0;
	const currentArtboardOnly = options.currentArtboardOnly ?? false;
	const focusSelected = options.focusSelected ?? false;
	const selectedNodeIds = deriveSelectedNodeIds(rows, options);
	const currentArtboardId = currentArtboardIdFromRows(rows);
	const includeRowIds = new Set<string>();
	const ancestorStack: ArtboardLayerPanelRow[] = [];
	let scopedRowCount = 0;

	const rowInCurrentScope = (row: ArtboardLayerPanelRow): boolean =>
		!currentArtboardOnly ||
		(currentArtboardId !== null && row.artboardId === currentArtboardId);

	const includeWithAncestors = (
		row: ArtboardLayerPanelRow,
		ancestors: readonly ArtboardLayerPanelRow[],
	): void => {
		for (const ancestor of ancestors) {
			if (rowInCurrentScope(ancestor)) includeRowIds.add(ancestor.rowId);
		}
		includeRowIds.add(row.rowId);
	};

	for (const row of rows) {
		ancestorStack.length = row.depth;
		const ancestors = ancestorStack.slice();
		const inScope = rowInCurrentScope(row);
		if (inScope) scopedRowCount += 1;

		if (inScope) {
			const matches =
				(!searchActive || rowMatchesSearch(row, searchTerms)) &&
				(!focusSelected || rowMatchesSelectedFocus(row, selectedNodeIds));
			if (!searchActive && !focusSelected) {
				includeRowIds.add(row.rowId);
			} else if (matches) {
				includeWithAncestors(row, ancestors);
			}
		}

		ancestorStack[row.depth] = row;
	}

	const filteredRows = rows.filter((row) => includeRowIds.has(row.rowId));
	const visibleRowCount = filteredRows.length;
	const hiddenRowCount = Math.max(0, scopedRowCount - visibleRowCount);

	return {
		rows: filteredRows,
		totalRowCount: rows.length,
		scopedRowCount,
		visibleRowCount,
		hiddenRowCount,
		searchQuery,
		searchActive,
		currentArtboardOnly,
		focusSelected,
		currentArtboardId,
		selectedNodeCount: selectedNodeIds.size,
		emptyState: resolveEmptyState({
			visibleRowCount,
			scopedRowCount,
			totalRowCount: rows.length,
			searchActive,
			focusSelected,
			currentArtboardOnly,
			selectedNodeCount: selectedNodeIds.size,
		}),
	};
}
