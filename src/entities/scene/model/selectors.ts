import type { Draft } from "immer";
import type {
	Artboard,
	ArtboardRole,
	Bounds,
	SceneDocument,
	SceneLayer,
	Vec2,
	VectorNode,
} from "./types";

export type SceneNodeInteractionSource = "canvas" | "structure";

/**
 * Artboard read model with a guaranteed pasteboard origin. Selectors expose this
 * shape so viewport, canvas, layers, and export code do not each invent legacy
 * fallbacks for missing `position`.
 */
export type NormalizedArtboard = Artboard & {
	readonly position: Vec2;
};

/**
 * Normalized artboard collection for one scene snapshot. `defaultArtboard`
 * mirrors legacy `document.artboard`; `currentArtboard` is focus-safe because it
 * has already fallen back when `currentArtboardId` is stale.
 */
export type SceneArtboardSet = {
	readonly artboards: readonly NormalizedArtboard[];
	readonly defaultArtboard: NormalizedArtboard;
	readonly currentArtboard: NormalizedArtboard;
};

/**
 * Pasteboard-space rectangle for an artboard, keeping the id and display name
 * next to bounds so viewport and renderer consumers can avoid parallel lookups.
 */
export type ArtboardBounds = Bounds & {
	readonly artboardId: string;
	readonly name: string;
};

/**
 * Bidirectional node ownership lookup derived from explicit node artboard ids
 * plus selector fallbacks. Values are live scene node references and must be
 * treated as read-only.
 */
export type NodeArtboardMapping = {
	readonly byNodeId: Readonly<Record<string, string>>;
	readonly byArtboardId: Readonly<Record<string, readonly VectorNode[]>>;
};

export type RenderableNodeEntry = {
	readonly node: VectorNode;
	readonly layer: SceneLayer;
	readonly depth: number;
	readonly parentIds: readonly string[];
	readonly locked: boolean;
};

const DEFAULT_ARTBOARD_POSITION: Vec2 = { x: 0, y: 0 };
export const DEFAULT_ARTBOARD_ROLE: ArtboardRole = "scene";

const finiteOrZero = (value: number): number =>
	Number.isFinite(value) ? value : 0;

const normalizeArtboardPosition = (position?: Vec2): Vec2 => ({
	x: finiteOrZero(position?.x ?? DEFAULT_ARTBOARD_POSITION.x),
	y: finiteOrZero(position?.y ?? DEFAULT_ARTBOARD_POSITION.y),
});

const sceneArtboardSetCache = new WeakMap<SceneDocument, SceneArtboardSet>();

/**
 * Normalizes one artboard into the multi-artboard read contract. The position
 * fallback keeps legacy `document.artboard` scenes readable without a migration.
 */
export function normalizeArtboard(artboard: Artboard): NormalizedArtboard {
	return {
		...artboard,
		position: normalizeArtboardPosition(artboard.position),
	};
}

/**
 * Resolves the authoring role for an artboard. Missing or unknown runtime
 * values read as `"scene"` so old documents stay exportable until the user
 * explicitly marks a board as library/scratch/reference.
 */
export function normalizeArtboardRole(
	artboard: Pick<Artboard, "role">,
): ArtboardRole {
	switch (artboard.role) {
		case "asset-board":
		case "scratch":
		case "reference":
			return artboard.role;
		default:
			return DEFAULT_ARTBOARD_ROLE;
	}
}

/** Returns true when an artboard participates in scene/sequence export. */
export function isSceneArtboard(artboard: Pick<Artboard, "role">): boolean {
	return normalizeArtboardRole(artboard) === "scene";
}

/**
 * Builds the artboard set used by editor read paths. `document.artboard` stays
 * authoritative for its id so legacy commands that still patch that field do not
 * desynchronize the default artboard from an additive collection entry.
 */
export function normalizeSceneArtboards(
	document: SceneDocument,
): SceneArtboardSet {
	const cached = sceneArtboardSetCache.get(document);
	if (cached) return cached;

	const collectionDefault = document.artboards?.find(
		(artboard) => artboard.id === document.artboard.id,
	);
	const defaultArtboard = normalizeArtboard({
		...document.artboard,
		position: document.artboard.position ?? collectionDefault?.position,
	});
	const byId = new Map<string, NormalizedArtboard>();
	byId.set(defaultArtboard.id, defaultArtboard);

	for (const artboard of document.artboards ?? []) {
		if (byId.has(artboard.id)) continue;
		byId.set(artboard.id, normalizeArtboard(artboard));
	}

	const artboards = [...byId.values()];
	const currentArtboard =
		artboards.find((artboard) => artboard.id === document.currentArtboardId) ??
		defaultArtboard;

	const set = {
		artboards,
		defaultArtboard,
		currentArtboard,
	};
	sceneArtboardSetCache.set(document, set);
	return set;
}

/** Returns the legacy/default artboard with normalized pasteboard position. */
export function selectDefaultArtboard(
	document: SceneDocument,
): NormalizedArtboard {
	return normalizeSceneArtboards(document).defaultArtboard;
}

/**
 * Returns the editor-focused artboard, falling back to the default artboard when
 * `currentArtboardId` is missing or points at a stale id.
 */
export function selectCurrentArtboard(
	document: SceneDocument,
): NormalizedArtboard {
	return normalizeSceneArtboards(document).currentArtboard;
}

/**
 * Returns the document's normalized artboards in stable order. The default
 * artboard is always first, even for legacy documents with no collection.
 */
export function selectAllArtboards(
	document: SceneDocument,
): readonly NormalizedArtboard[] {
	return normalizeSceneArtboards(document).artboards;
}

/**
 * Returns artboards that are authored as exportable scenes. Role-less legacy
 * artboards are included by design through `normalizeArtboardRole`.
 */
export function selectSceneArtboards(
	document: SceneDocument,
): readonly NormalizedArtboard[] {
	return selectAllArtboards(document).filter(isSceneArtboard);
}

/**
 * Returns authoring boards that should not appear as normal sequence candidates:
 * asset boards, scratch boards, and reference boards.
 */
export function selectNonExportArtboards(
	document: SceneDocument,
): readonly NormalizedArtboard[] {
	return selectAllArtboards(document).filter(
		(artboard) => !isSceneArtboard(artboard),
	);
}

/** Finds a normalized artboard by id from the migration-free read contract. */
export function findArtboardById(
	document: SceneDocument,
	artboardId: string | null | undefined,
): NormalizedArtboard | undefined {
	if (!artboardId) return undefined;
	return selectAllArtboards(document).find(
		(artboard) => artboard.id === artboardId,
	);
}

/** Converts an artboard into pasteboard-space bounds for viewport/render code. */
export function artboardBounds(artboard: NormalizedArtboard): ArtboardBounds {
	return {
		artboardId: artboard.id,
		name: artboard.name,
		x: artboard.position.x,
		y: artboard.position.y,
		width: artboard.width,
		height: artboard.height,
	};
}

/** Returns pasteboard-space bounds for every normalized artboard. */
export function selectAllArtboardBounds(
	document: SceneDocument,
): readonly ArtboardBounds[] {
	return selectAllArtboards(document).map(artboardBounds);
}

const nodeArtboardMappingCache = new WeakMap<
	SceneDocument,
	NodeArtboardMapping
>();

/**
 * Identity-keyed index of the scene read path. The scene store replaces the
 * document object on every edit, so identity is a safe cache boundary: a given
 * snapshot is immutable, and a new snapshot gets a fresh lazily-built index.
 *
 * This lets `findNode` / `findLayerByNodeId` / selectable checks resolve in O(1)
 * instead of allocating and scanning a full flattened node array per call, which
 * matters because those helpers run on nearly every pointer move and command on
 * large documents.
 */
type SceneReadIndex = {
	readonly nodesInOrder: readonly VectorNode[];
	readonly nodeById: ReadonlyMap<string, VectorNode>;
	readonly layerByNodeId: ReadonlyMap<string, SceneLayer>;
};

const sceneReadIndexCache = new WeakMap<SceneDocument, SceneReadIndex>();

const buildSceneReadIndex = (document: SceneDocument): SceneReadIndex => {
	const nodesInOrder: VectorNode[] = [];
	const nodeById = new Map<string, VectorNode>();
	const layerByNodeId = new Map<string, SceneLayer>();

	const visit = (layer: SceneLayer, nodes: readonly VectorNode[]): void => {
		for (const node of nodes) {
			nodesInOrder.push(node);
			nodeById.set(node.id, node);
			layerByNodeId.set(node.id, layer);
			if (node.children) visit(layer, node.children);
		}
	};

	for (const layer of document.layers) {
		visit(layer, layer.nodes);
	}

	return { nodesInOrder, nodeById, layerByNodeId };
};

/**
 * Returns the memoized read index for an immutable scene snapshot, building it on
 * first access and reusing it for the lifetime of that document object.
 */
const getSceneReadIndex = (document: SceneDocument): SceneReadIndex => {
	const cached = sceneReadIndexCache.get(document);
	if (cached) return cached;
	const index = buildSceneReadIndex(document);
	sceneReadIndexCache.set(document, index);
	return index;
};

/**
 * Returns every node in layer order, including future group children. Callers
 * receive document nodes, not clones, so they must treat the result as read-only.
 */
export function allNodes(document: SceneDocument): VectorNode[] {
	return [...getSceneReadIndex(document).nodesInOrder];
}

/**
 * Groups nodes by owning artboard id. Explicit `node.artboardId` wins when it
 * references a known artboard; group children inherit their parent assignment;
 * otherwise nodes fall back to the current/default artboard.
 */
export function selectNodeArtboardMapping(
	document: SceneDocument,
): NodeArtboardMapping {
	const cached = nodeArtboardMappingCache.get(document);
	if (cached) return cached;

	const { artboards, currentArtboard } = normalizeSceneArtboards(document);
	const validArtboardIds = new Set(artboards.map((artboard) => artboard.id));
	const byNodeId: Record<string, string> = {};
	const byArtboardId: Record<string, VectorNode[]> = {};

	for (const artboard of artboards) {
		byArtboardId[artboard.id] = [];
	}

	const visit = (
		nodes: readonly VectorNode[],
		inheritedArtboardId: string | undefined,
	): void => {
		for (const node of nodes) {
			const explicitArtboardId =
				node.artboardId && validArtboardIds.has(node.artboardId)
					? node.artboardId
					: undefined;
			const artboardId =
				explicitArtboardId ?? inheritedArtboardId ?? currentArtboard.id;
			byNodeId[node.id] = artboardId;
			byArtboardId[artboardId]?.push(node);
			if (node.children) visit(node.children, artboardId);
		}
	};

	for (const layer of document.layers) {
		visit(layer.nodes, undefined);
	}

	const mapping = { byNodeId, byArtboardId };
	nodeArtboardMappingCache.set(document, mapping);
	return mapping;
}

/**
 * Resolves one node id to its normalized owning artboard id. Unknown node ids
 * return undefined so callers can distinguish missing nodes from defaulted ones.
 */
export function selectArtboardIdForNode(
	document: SceneDocument,
	nodeId: string | null | undefined,
): string | undefined {
	if (!nodeId) return undefined;
	return selectNodeArtboardMapping(document).byNodeId[nodeId];
}

/** Returns all nodes assigned to an artboard, defaulting to the current artboard. */
export function selectNodesForArtboard(
	document: SceneDocument,
	artboardId: string = selectCurrentArtboard(document).id,
): readonly VectorNode[] {
	return selectNodeArtboardMapping(document).byArtboardId[artboardId] ?? [];
}

/**
 * Finds a node in the live scene graph. This is the read-side selector used by
 * widgets and feature handlers instead of importing a static seed document. The
 * lookup is O(1) against a memoized per-snapshot index rather than a full scene
 * scan, so the dozens of per-interaction callers stay cheap on large documents.
 */
export function findNode(
	document: SceneDocument,
	nodeId: string | null,
): VectorNode | undefined {
	if (!nodeId) return undefined;
	return getSceneReadIndex(document).nodeById.get(nodeId);
}

/**
 * Finds the owning layer for a node id without flattening away layer context.
 * Layer ownership matters for panel actions and hit testing because a visible
 * node inside a hidden layer is not renderable/selectable from the canvas. The
 * lookup resolves in O(1) against the memoized per-snapshot index.
 */
export function findLayerByNodeId(
	document: SceneDocument,
	nodeId: string,
): SceneLayer | undefined {
	return getSceneReadIndex(document).layerByNodeId.get(nodeId);
}

/**
 * Whether a node is a direct child of its layer's node list rather than
 * reached only through a group's `children`. Callers that need a node's
 * bounds in artboard-root pixel space (not just its immediate parent's local
 * space) — e.g. the per-object GPU Path Blur crop compositor — restrict to
 * top-level nodes so a single `transform` read is artboard-root space,
 * sidestepping ancestor-transform composition the codebase has no helper for.
 */
export function isTopLevelSceneNode(
	document: SceneDocument,
	nodeId: string,
): boolean {
	return document.layers.some((layer) =>
		layer.nodes.some((node) => node.id === nodeId),
	);
}

/**
 * Returns whether a node carries the frame container role. Frames are ordinary
 * container nodes distinguished only by {@link VectorNode.frame}, so this O(1)
 * test keeps group/ungroup, plain nodes, and geometry/`data` conventions
 * frame-agnostic while giving read paths a single source of truth.
 */
export function isFrameNode(node: VectorNode | null | undefined): boolean {
	return node?.frame?.kind === "frame";
}

/**
 * Resolves whether a frame clips its children to its box. An omitted
 * `clipsContent` reads as `true` (the Figma frame default); non-frame nodes
 * return `false` so callers never treat a plain node or a group as clipping.
 */
export function frameClipsContent(
	node: VectorNode | null | undefined,
): boolean {
	if (node?.frame?.kind !== "frame") return false;
	return node.frame.clipsContent ?? true;
}

const collectRenderableNodes = (
	layer: SceneLayer,
	nodes: readonly VectorNode[],
	output: RenderableNodeEntry[],
	parentIds: readonly string[],
	depth: number,
	lockedByParent: boolean,
): RenderableNodeEntry[] => {
	for (const node of nodes) {
		if (!node.visible) continue;
		const locked = layer.locked || lockedByParent || node.locked;
		output.push({ node, layer, depth, parentIds, locked });
		if (node.children) {
			collectRenderableNodes(
				layer,
				node.children,
				output,
				[...parentIds, node.id],
				depth + 1,
				locked,
			);
		}
	}
	return output;
};

type RenderableIndex = {
	readonly entries: readonly RenderableNodeEntry[];
	readonly byNodeId: ReadonlyMap<string, RenderableNodeEntry>;
};

const renderableIndexCache = new WeakMap<SceneDocument, RenderableIndex>();

const buildRenderableIndex = (document: SceneDocument): RenderableIndex => {
	const entries = document.layers.flatMap((layer) =>
		layer.visible
			? collectRenderableNodes(layer, layer.nodes, [], [], 0, layer.locked)
			: [],
	);
	const byNodeId = new Map<string, RenderableNodeEntry>();
	for (const entry of entries) byNodeId.set(entry.node.id, entry);
	return { entries, byNodeId };
};

const getRenderableIndex = (document: SceneDocument): RenderableIndex => {
	const cached = renderableIndexCache.get(document);
	if (cached) return cached;
	const index = buildRenderableIndex(document);
	renderableIndexCache.set(document, index);
	return index;
};

/**
 * Returns nodes that should participate in rendering and canvas picking, in
 * document render order. Later entries are visually in front of earlier ones.
 * The flattened result is memoized by document identity so repeated callers
 * (spatial index builds, selectable/transformable checks) reuse one traversal.
 */
export function flattenRenderableNodes(
	document: SceneDocument,
): readonly RenderableNodeEntry[] {
	return getRenderableIndex(document).entries;
}

const findRenderableEntry = (
	document: SceneDocument,
	nodeId: string,
): RenderableNodeEntry | undefined =>
	getRenderableIndex(document).byNodeId.get(nodeId);

/**
 * Looks up a node's renderable entry (layer/depth/ancestor-folded `locked`) by
 * id, or `undefined` when the node is missing OR excluded from the renderable
 * index because it (or an ancestor, or its owning layer) is hidden — the same
 * visible/unlocked-including-ancestors policy `isNodeTransformable` collapses
 * into one boolean. Exposed as a selector (rather than only the boolean checks)
 * for callers that need to distinguish "hidden" from "locked" for diagnostics,
 * e.g. reporting *which* of the two reasons made a node non-deletable instead
 * of a single opaque false.
 */
export function findRenderableNodeEntry(
	document: SceneDocument,
	nodeId: string,
): RenderableNodeEntry | undefined {
	return findRenderableEntry(document, nodeId);
}

/**
 * Captures selection eligibility by source. Canvas selection excludes hidden and
 * locked nodes because they cannot be picked or transformed directly; structure
 * UI may still select existing nodes so users can unlock, show, rename, or
 * inspect them from Layers.
 */
export function isNodeSelectable(
	document: SceneDocument,
	nodeId: string | null,
	options: {
		readonly source?: SceneNodeInteractionSource;
	} = {},
): boolean {
	if (!nodeId) return false;
	if (options.source === "structure")
		return findNode(document, nodeId) !== undefined;
	const entry = findRenderableEntry(document, nodeId);
	return Boolean(entry && !entry.locked);
}

/**
 * Returns whether a node may receive transform edits. Transformability is
 * stricter than structural selection: hidden nodes, locked nodes, and nodes in
 * hidden/locked layers are protected from direct transform commands.
 */
export function isNodeTransformable(
	document: SceneDocument,
	nodeId: string | null,
): boolean {
	if (!nodeId) return false;
	const entry = findRenderableEntry(document, nodeId);
	return Boolean(entry && !entry.locked);
}

/**
 * Resolves a hit node id to the id the canvas select tool should target: the
 * outermost group ancestor when the node is nested inside one or more groups,
 * else the node itself. A single click therefore selects a whole group instead
 * of reaching inside it; entering a group to pick its members is a separate
 * (future) interaction. Returns the input id unchanged when it is top-level or
 * unknown so callers can apply it unconditionally.
 */
export function canvasSelectionTargetId(
	document: SceneDocument,
	nodeId: string | null,
): string | null {
	if (!nodeId) return null;
	const entry = findRenderableEntry(document, nodeId);
	return entry?.parentIds[0] ?? nodeId;
}

/**
 * Normalizes a front-to-back hit stack for deep selection. Unlike ordinary
 * canvas selection, this intentionally keeps nested child ids instead of
 * collapsing them to the outer group, while still discarding non-renderable or
 * locked candidates through the same renderable index used by canvas selection.
 */
export function canvasDeepSelectionTargetIds(
	document: SceneDocument,
	nodeIds: readonly string[],
): readonly string[] {
	const targetIds: string[] = [];
	const seen = new Set<string>();
	for (const nodeId of nodeIds) {
		const entry = findRenderableEntry(document, nodeId);
		if (!entry || entry.locked || seen.has(nodeId)) continue;
		seen.add(nodeId);
		targetIds.push(nodeId);
	}
	return targetIds;
}

/**
 * Resolves the next deep-selection target from an ordered hit stack. When the
 * current primary selection is part of the same stack, the next candidate is
 * returned so repeated modifier-clicks cycle through overlapping children,
 * siblings, and ancestors in deterministic z order.
 */
export function canvasDeepSelectionTargetId(
	document: SceneDocument,
	nodeIds: readonly string[],
	options: { readonly currentNodeId?: string | null } = {},
): string | null {
	const targetIds = canvasDeepSelectionTargetIds(document, nodeIds);
	if (targetIds.length === 0) return null;
	const currentIndex = options.currentNodeId
		? targetIds.indexOf(options.currentNodeId)
		: -1;
	if (currentIndex === -1) return targetIds[0] ?? null;
	return targetIds[(currentIndex + 1) % targetIds.length] ?? null;
}

/**
 * Finds a mutable draft layer by id for structure-panel commands. Returning the
 * draft object keeps layer edits inside Immer's patch history.
 */
export function findDraftLayer(
	document: Draft<SceneDocument>,
	layerId: string,
): Draft<SceneLayer> | undefined {
	return document.layers.find((layer) => layer.id === layerId);
}

/**
 * Finds a mutable draft node for command execution. It preserves the plain
 * document shape and avoids feature code walking layer internals directly.
 */
export function findDraftNode(
	document: Draft<SceneDocument>,
	nodeId: string,
): Draft<VectorNode> | undefined {
	const visit = (
		nodes: Draft<readonly VectorNode[]>,
	): Draft<VectorNode> | undefined => {
		for (const node of nodes) {
			if (node.id === nodeId) return node;
			if (node.children) {
				const child = visit(node.children);
				if (child) return child;
			}
		}
		return undefined;
	};

	for (const layer of document.layers) {
		const node = visit(layer.nodes);
		if (node) return node;
	}
	return undefined;
}

/**
 * Finds the owning draft layer for a node id while preserving mutable draft
 * identity for command execution.
 */
export function findDraftLayerByNodeId(
	document: Draft<SceneDocument>,
	nodeId: string,
): Draft<SceneLayer> | undefined {
	const visit = (nodes: Draft<readonly VectorNode[]>): boolean => {
		for (const node of nodes) {
			if (node.id === nodeId) return true;
			if (node.children && visit(node.children)) return true;
		}
		return false;
	};

	return document.layers.find((layer) => visit(layer.nodes));
}
