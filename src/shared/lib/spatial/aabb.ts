/** Axis-aligned bounds in a caller-defined two-dimensional coordinate space. */
export type Aabb = {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
};

/**
 * Immutable broad-phase index entry. `value` carries domain-specific metadata;
 * this shared module only inspects the AABB.
 */
export type SpatialHashEntry<T> = {
	readonly id: string;
	readonly aabb: Aabb;
	readonly value: T;
};

/**
 * Static grid index keyed by integer cells. Entries remain in original order so
 * callers can preserve render, z, or document order after querying.
 */
export type SpatialHashIndex<T> = {
	readonly cellSize: number;
	readonly entries: readonly SpatialHashEntry<T>[];
	readonly cells: ReadonlyMap<string, readonly number[]>;
};

type CellRange = {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
};

const DEFAULT_CELL_SIZE = 256;
const CELL_KEY_SEPARATOR = ":";

const finiteCellSize = (value: number | undefined): number => {
	if (value === undefined || !Number.isFinite(value) || value <= 0) {
		return DEFAULT_CELL_SIZE;
	}
	return value;
};

const cellKey = (x: number, y: number): string =>
	`${x}${CELL_KEY_SEPARATOR}${y}`;

/**
 * Normalizes arbitrary corner ordering into the canonical min/max shape used by
 * spatial queries. Callers can pass drag rectangles directly without first
 * sorting their corners.
 */
export function normalizeAabb(aabb: Aabb): Aabb {
	return {
		minX: Math.min(aabb.minX, aabb.maxX),
		minY: Math.min(aabb.minY, aabb.maxY),
		maxX: Math.max(aabb.minX, aabb.maxX),
		maxY: Math.max(aabb.minY, aabb.maxY),
	};
}

/**
 * Expands an AABB in artboard units. Negative or non-finite padding is ignored
 * so stale caller math cannot accidentally invert an index entry.
 */
export function inflateAabb(aabb: Aabb, amount: number): Aabb {
	const normalized = normalizeAabb(aabb);
	const padding = Number.isFinite(amount) ? Math.max(0, amount) : 0;
	return {
		minX: normalized.minX - padding,
		minY: normalized.minY - padding,
		maxX: normalized.maxX + padding,
		maxY: normalized.maxY + padding,
	};
}

/**
 * Builds the smallest axis-aligned box containing all points. Empty input maps
 * to a zero-sized origin box so callers can keep branch-free pipelines.
 */
export function aabbFromPoints(
	points: readonly { readonly x: number; readonly y: number }[],
): Aabb {
	if (points.length === 0) {
		return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
	}
	const xs = points.map((point) => point.x);
	const ys = points.map((point) => point.y);
	return {
		minX: Math.min(...xs),
		minY: Math.min(...ys),
		maxX: Math.max(...xs),
		maxY: Math.max(...ys),
	};
}

/** Tests whether two normalized or unnormalized AABBs overlap. */
export function aabbIntersects(a: Aabb, b: Aabb): boolean {
	const left = normalizeAabb(a);
	const right = normalizeAabb(b);
	return (
		left.minX <= right.maxX &&
		left.maxX >= right.minX &&
		left.minY <= right.maxY &&
		left.maxY >= right.minY
	);
}

/** Tests point containment inclusively so edge hits remain selectable. */
export function aabbContainsPoint(
	aabb: Aabb,
	point: { readonly x: number; readonly y: number },
): boolean {
	const normalized = normalizeAabb(aabb);
	return (
		point.x >= normalized.minX &&
		point.x <= normalized.maxX &&
		point.y >= normalized.minY &&
		point.y <= normalized.maxY
	);
}

const cellRangeForAabb = (aabb: Aabb, cellSize: number): CellRange => {
	const normalized = normalizeAabb(aabb);
	return {
		minX: Math.floor(normalized.minX / cellSize),
		minY: Math.floor(normalized.minY / cellSize),
		maxX: Math.floor(normalized.maxX / cellSize),
		maxY: Math.floor(normalized.maxY / cellSize),
	};
};

/**
 * Creates a static grid index for immutable AABB entries. The index preserves
 * input order in query results after filtering, which lets scene-level callers
 * apply their own render-order semantics without a secondary stable sort key.
 */
export function createSpatialHashIndex<T>(
	entries: readonly SpatialHashEntry<T>[],
	options: { readonly cellSize?: number } = {},
): SpatialHashIndex<T> {
	const cellSize = finiteCellSize(options.cellSize);
	const cells = new Map<string, number[]>();

	entries.forEach((entry, index) => {
		const range = cellRangeForAabb(entry.aabb, cellSize);
		for (let y = range.minY; y <= range.maxY; y += 1) {
			for (let x = range.minX; x <= range.maxX; x += 1) {
				const key = cellKey(x, y);
				const indexes = cells.get(key);
				if (indexes) {
					indexes.push(index);
				} else {
					cells.set(key, [index]);
				}
			}
		}
	});

	return { cellSize, entries, cells };
}

/**
 * Queries a static hash index and returns exact AABB intersections in original
 * entry order. Cell hits are only a broad phase; the final AABB predicate keeps
 * false positives from leaking to expensive scene-specific hit tests.
 */
export function querySpatialHashIndex<T>(
	spatialIndex: SpatialHashIndex<T>,
	query: Aabb,
): readonly SpatialHashEntry<T>[] {
	const range = cellRangeForAabb(query, spatialIndex.cellSize);
	const seen = new Set<number>();
	for (let y = range.minY; y <= range.maxY; y += 1) {
		for (let x = range.minX; x <= range.maxX; x += 1) {
			const indexes = spatialIndex.cells.get(cellKey(x, y));
			if (!indexes) continue;
			for (const entryIndex of indexes) seen.add(entryIndex);
		}
	}

	const normalized = normalizeAabb(query);
	const result: SpatialHashEntry<T>[] = [];
	for (const entryIndex of [...seen].sort((a, b) => a - b)) {
		const entry = spatialIndex.entries[entryIndex];
		if (entry && aabbIntersects(entry.aabb, normalized)) result.push(entry);
	}
	return result;
}

/**
 * Point query convenience wrapper. It intentionally uses the same broad-phase
 * path as rectangle queries so canvas click and marquee selection share index
 * behavior.
 */
export function queryPointSpatialHashIndex<T>(
	spatialIndex: SpatialHashIndex<T>,
	point: { readonly x: number; readonly y: number },
): readonly SpatialHashEntry<T>[] {
	return querySpatialHashIndex(spatialIndex, {
		minX: point.x,
		minY: point.y,
		maxX: point.x,
		maxY: point.y,
	});
}
