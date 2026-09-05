import {
	type Aabb,
	aabbFromPoints,
	aabbIntersects,
	createSpatialHashIndex,
	queryPointSpatialHashIndex,
	querySpatialHashIndex,
	type SpatialHashIndex,
} from "@/shared/lib/spatial/aabb";
import { nodeVisualMargin } from "./effect-filter";
import { resolveNodeRecipe } from "./recipe-resolve";
import {
	getNodeLocalBounds,
	type Matrix2D,
	matrixFromTransform,
} from "./rendering";
import { flattenRenderableNodes, type RenderableNodeEntry } from "./selectors";
import { resolveEffects } from "./style-resolve";
import type { Bounds, SceneDocument, Vec2, VectorNode } from "./types";

export type SceneSpatialEntry = RenderableNodeEntry & {
	readonly nodeId: string;
	readonly layerId: string;
	readonly renderIndex: number;
	readonly bounds: Aabb;
	readonly pickBounds: Aabb;
};

/**
 * Reusable broad-phase view of a scene snapshot. The `entries` array is render
 * order; the hash index stores the same entries by padded pick bounds.
 */
export type SceneSpatialIndex = {
	readonly entries: readonly SceneSpatialEntry[];
	readonly spatial: SpatialHashIndex<SceneSpatialEntry>;
	readonly tolerance: number;
};

export type SceneSpatialOrder = "render" | "front-to-back";

type SceneSpatialQueryOptions = {
	readonly includeLocked?: boolean;
	readonly order?: SceneSpatialOrder;
};

const DEFAULT_CELL_SIZE = 256;
const spatialIndexCache = new WeakMap<
	SceneDocument,
	Map<string, SceneSpatialIndex>
>();
const spatialEntriesCache = new WeakMap<
	SceneDocument,
	Map<string, readonly SceneSpatialEntry[]>
>();

const finiteTolerance = (value: number | undefined): number =>
	value !== undefined && Number.isFinite(value) ? Math.max(0, value) : 0;

const spatialIndexCacheKey = (options: {
	readonly tolerance?: number;
	readonly cellSize?: number;
}): string => {
	const tolerance = finiteTolerance(options.tolerance);
	const cellSize =
		options.cellSize !== undefined &&
		Number.isFinite(options.cellSize) &&
		options.cellSize > 0
			? options.cellSize
			: DEFAULT_CELL_SIZE;
	return `${tolerance}:${cellSize}`;
};

const spatialEntriesCacheKey = (options: {
	readonly tolerance?: number;
}): string => `${finiteTolerance(options.tolerance)}`;

const transformPoint = (point: Vec2, matrix: Matrix2D): Vec2 => ({
	x: matrix.a * point.x + matrix.c * point.y + matrix.e,
	y: matrix.b * point.x + matrix.d * point.y + matrix.f,
});

const paddedBounds = (bounds: Bounds, amount: number): Bounds => {
	const padding = Number.isFinite(amount) ? Math.max(0, amount) : 0;
	return {
		x: bounds.x - padding,
		y: bounds.y - padding,
		width: bounds.width + padding * 2,
		height: bounds.height + padding * 2,
	};
};

const transformedBounds = (bounds: Bounds, matrix: Matrix2D): Aabb =>
	aabbFromPoints([
		transformPoint({ x: bounds.x, y: bounds.y }, matrix),
		transformPoint({ x: bounds.x + bounds.width, y: bounds.y }, matrix),
		transformPoint(
			{ x: bounds.x + bounds.width, y: bounds.y + bounds.height },
			matrix,
		),
		transformPoint({ x: bounds.x, y: bounds.y + bounds.height }, matrix),
	]);

const pickPaddingForNode = (node: VectorNode, tolerance: number): number =>
	Math.max(0, node.style.strokeWidth) / 2 + Math.max(0, tolerance);

const orderedEntries = (
	entries: readonly SceneSpatialEntry[],
	order: SceneSpatialOrder,
): readonly SceneSpatialEntry[] =>
	order === "front-to-back" ? [...entries].reverse() : entries;

const filterSceneEntries = (
	entries: readonly SceneSpatialEntry[],
	options: SceneSpatialQueryOptions,
): readonly SceneSpatialEntry[] => {
	const unlocked = options.includeLocked
		? entries
		: entries.filter((entry) => !entry.locked);
	return orderedEntries(unlocked, options.order ?? "render");
};

/**
 * Computes a node's artboard-space AABB from geometry bounds and the scene TRS
 * matrix. Rotation and scale are included; the box is still axis-aligned so it
 * can be used as a broad-phase spatial predicate.
 */
export function sceneNodeAabb(node: VectorNode, localPadding = 0): Aabb {
	return transformedBounds(
		paddedBounds(getNodeLocalBounds(node), localPadding),
		matrixFromTransform(node.transform),
	);
}

/**
 * A node's artboard-space AABB padded by its full painted reach (stroke + visible
 * drop-shadow/blur), so a box test against the viewport never clips a node whose
 * effect or stroke spills into view while its geometry sits just off-screen. The
 * common no-effects case short-circuits to a plain stroke pad to stay cheap on the
 * per-node cull loop of large documents.
 */
export function sceneNodeVisualAabb(node: VectorNode): Aabb {
	const strokeWidth = Math.max(0, node.style.strokeWidth);
	const effects = node.style.effects;
	const strokeBlurRadius = Math.max(
		0,
		node.style.strokeSoftness?.blurRadius ?? 0,
	);
	// A recipe glow reaches outward too, so it must widen the cull AABB. Resolve
	// it only when present to keep the common no-recipe path allocation-free.
	const recipe = node.recipe ? resolveNodeRecipe(node) : null;
	if ((!effects || effects.length === 0) && !recipe && strokeBlurRadius === 0) {
		return sceneNodeAabb(node, strokeWidth);
	}
	return sceneNodeAabb(
		node,
		nodeVisualMargin(
			resolveEffects(effects),
			strokeWidth,
			recipe,
			strokeBlurRadius,
		),
	);
}

/**
 * Flattens renderable scene nodes into render-order spatial entries. Hidden
 * layers and hidden nodes are already removed by `flattenRenderableNodes`;
 * inherited layer/group lock state is preserved for canvas selection filters.
 */
export function sceneSpatialEntries(
	document: SceneDocument,
	options: { readonly tolerance?: number } = {},
): readonly SceneSpatialEntry[] {
	const key = spatialEntriesCacheKey(options);
	let entriesByTolerance = spatialEntriesCache.get(document);
	if (!entriesByTolerance) {
		entriesByTolerance = new Map<string, readonly SceneSpatialEntry[]>();
		spatialEntriesCache.set(document, entriesByTolerance);
	}
	const cached = entriesByTolerance.get(key);
	if (cached) return cached;

	const tolerance = finiteTolerance(options.tolerance);
	const entries = flattenRenderableNodes(document).map((entry, renderIndex) => {
		const bounds = sceneNodeAabb(entry.node);
		return {
			...entry,
			nodeId: entry.node.id,
			layerId: entry.layer.id,
			renderIndex,
			bounds,
			pickBounds: sceneNodeAabb(
				entry.node,
				pickPaddingForNode(entry.node, tolerance),
			),
		};
	});
	entriesByTolerance.set(key, entries);
	return entries;
}

/**
 * Builds a reusable broad-phase index for a scene snapshot. Canvas and layer
 * virtualization callers should memoize this by document identity and query it
 * many times instead of walking the whole scene for every pointer move.
 */
export function createSceneSpatialIndex(
	document: SceneDocument,
	options: { readonly tolerance?: number; readonly cellSize?: number } = {},
): SceneSpatialIndex {
	const entries = sceneSpatialEntries(document, options);
	const spatial = createSpatialHashIndex(
		entries.map((entry) => ({
			id: entry.nodeId,
			aabb: entry.pickBounds,
			value: entry,
		})),
		{ cellSize: options.cellSize ?? DEFAULT_CELL_SIZE },
	);
	return {
		entries,
		spatial,
		tolerance: finiteTolerance(options.tolerance),
	};
}

/**
 * Returns a memoized spatial index for an immutable scene snapshot. The scene
 * store replaces the document object on edits, so identity is a reliable cache
 * boundary for canvas hit-testing and marquee queries that run repeatedly while
 * the document is otherwise unchanged.
 */
export function getSceneSpatialIndex(
	document: SceneDocument,
	options: { readonly tolerance?: number; readonly cellSize?: number } = {},
): SceneSpatialIndex {
	const key = spatialIndexCacheKey(options);
	let indexes = spatialIndexCache.get(document);
	if (!indexes) {
		indexes = new Map<string, SceneSpatialIndex>();
		spatialIndexCache.set(document, indexes);
	}
	const cached = indexes.get(key);
	if (cached) return cached;
	const index = createSceneSpatialIndex(document, options);
	indexes.set(key, index);
	return index;
}

/**
 * Returns point-hit candidates from front to back by default. This is a broad
 * phase: callers still run precise geometry hit testing before selecting.
 */
export function sceneHitTestCandidates(
	index: SceneSpatialIndex,
	point: Vec2,
	options: SceneSpatialQueryOptions = {},
): readonly SceneSpatialEntry[] {
	const candidates = queryPointSpatialHashIndex(index.spatial, point).map(
		(entry) => entry.value,
	);
	return filterSceneEntries(candidates, {
		...options,
		order: options.order ?? "front-to-back",
	});
}

/**
 * Returns renderable nodes whose transformed geometry bounds intersect a query
 * box. The final exact AABB check uses unpadded bounds so marquee selection does
 * not grow just because click tolerance or stroke picking was indexed.
 */
export function sceneBoundsCandidates(
	index: SceneSpatialIndex,
	bounds: Aabb,
	options: SceneSpatialQueryOptions = {},
): readonly SceneSpatialEntry[] {
	const candidates = querySpatialHashIndex(index.spatial, bounds)
		.map((entry) => entry.value)
		.filter((entry) => aabbIntersects(entry.bounds, bounds));
	return filterSceneEntries(candidates, options);
}
