import { GRID_MAX_TRACKS } from "./grid";

/**
 * Pure inference for "Tidy up" (Wave 2 B1): given the measured rectangles of an
 * absolutely positioned sibling selection, decide whether they read as a stack
 * (one dominant axis) or a lattice (both axes cluster consistently) and produce
 * the layout + child order a caller should write. No document/DOM reference is
 * held here — callers resolve rects (parent-relative, same space `arrangeSelection`
 * already measures) and apply the result through existing layout/order commands.
 */

/** One selected node's measured rectangle, in parent-relative coordinates. */
export type TidyNodeRect = Readonly<{
	nodeId: string;
	x: number;
	y: number;
	width: number;
	height: number;
}>;

export type TidyStackResult = Readonly<{
	mode: "stack";
	direction: "row" | "column";
	gap: number;
	/** Child order to commit, ancestor-relative sort order (first = first child). */
	order: readonly string[];
}>;

export type TidyGridResult = Readonly<{
	mode: "grid";
	columns: number;
	gap: number;
	order: readonly string[];
}>;

export type TidyResult = TidyStackResult | TidyGridResult;

const GAP_MIN = 0;
const GAP_MAX = 20_000;

const median = (values: readonly number[]): number => {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((left, right) => left - right);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0
		? (sorted[mid - 1]! + sorted[mid]!) / 2
		: sorted[mid]!;
};

const variance = (values: readonly number[]): number => {
	if (values.length === 0) return 0;
	const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
	return (
		values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
	);
};

/** Clamps a computed gap into the same bound `setNodeLayoutValue`'s "gap" field expects. */
const boundedGap = (value: number): number =>
	Number.isFinite(value)
		? Math.min(GAP_MAX, Math.max(GAP_MIN, Math.round(value)))
		: 0;

/** Median of edge-to-edge distances between adjacent [start, end) extents, floored at 0. */
const medianAdjacentGap = (
	extents: readonly Readonly<{ start: number; end: number }>[],
): number => {
	if (extents.length < 2) return 0;
	const gaps: number[] = [];
	for (let index = 1; index < extents.length; index += 1) {
		gaps.push(Math.max(0, extents[index]!.start - extents[index - 1]!.end));
	}
	return boundedGap(median(gaps));
};

type Center = Readonly<{ nodeId: string; center: number }>;

/**
 * Clusters 1-D centers into bands: a running band mean within `tolerance` of the
 * next center absorbs it, otherwise a new band starts. Input must already be
 * sorted by `center` ascending, so bands come out in ascending position order.
 */
const bandsOf = (
	sortedCenters: readonly Center[],
	tolerance: number,
): readonly (readonly string[])[] => {
	const bands: { nodeIds: string[]; sum: number; count: number }[] = [];
	for (const item of sortedCenters) {
		const last = bands.at(-1);
		if (last && Math.abs(item.center - last.sum / last.count) <= tolerance) {
			last.nodeIds.push(item.nodeId);
			last.sum += item.center;
			last.count += 1;
			continue;
		}
		bands.push({ nodeIds: [item.nodeId], sum: item.center, count: 1 });
	}
	return bands.map((band) => band.nodeIds);
};

/** A band's own bounding [start, end) along its axis, from its members' rects. */
const bandExtent = (
	nodeIds: readonly string[],
	rectById: ReadonlyMap<string, TidyNodeRect>,
	axis: "x" | "y",
): Readonly<{ start: number; end: number }> => {
	const starts = nodeIds.map((nodeId) => rectById.get(nodeId)![axis]);
	const ends = nodeIds.map((nodeId) => {
		const rect = rectById.get(nodeId)!;
		return axis === "x" ? rect.x + rect.width : rect.y + rect.height;
	});
	return { start: Math.min(...starts), end: Math.max(...ends) };
};

/**
 * Infers a tidy layout for 2+ absolutely positioned siblings. Returns null only
 * when there is nothing to infer (fewer than two rects) — every other case
 * resolves to at least a dominant-axis stack, per the design's fail-closed rule
 * ("判定不能なら主軸stack").
 */
export const computeTidyLayout = (
	rects: readonly TidyNodeRect[],
): TidyResult | null => {
	if (rects.length < 2) return null;
	// Deterministic input order so a caller passing rects in varying order (e.g. a
	// Set iteration) still infers the same layout and, on any variance/gap tie, the
	// same child order.
	const sorted = [...rects].sort((left, right) =>
		left.nodeId.localeCompare(right.nodeId),
	);
	const rectById = new Map(sorted.map((rect) => [rect.nodeId, rect] as const));

	const centersX = sorted.map((rect) => rect.x + rect.width / 2);
	const centersY = sorted.map((rect) => rect.y + rect.height / 2);
	const xVariance = variance(centersX);
	const yVariance = variance(centersY);
	// The dominant axis is the one centers SPREAD across, not the one they cluster
	// on: nodes placed side by side vary in x and share y, so x is dominant and the
	// stack reads left-to-right (flex "row"). A tie favors "x"/"row".
	const dominantAxis: "x" | "y" = xVariance >= yVariance ? "x" : "y";

	const medianExtent = median(
		sorted.map((rect) => (dominantAxis === "x" ? rect.width : rect.height)),
	);
	// Band tolerance scales with the selection's own size so both a dense icon row
	// and a sparse card grid cluster sensibly; 4px floor covers near-zero extents.
	const bandTolerance = Math.max(4, medianExtent * 0.3);

	const centersById = new Map(
		sorted.map(
			(rect) =>
				[
					rect.nodeId,
					{ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
				] as const,
		),
	);
	const byAxisAscending = (axis: "x" | "y"): readonly Center[] =>
		[...sorted]
			.sort(
				(left, right) =>
					centersById.get(left.nodeId)![axis] -
						centersById.get(right.nodeId)![axis] ||
					left.nodeId.localeCompare(right.nodeId),
			)
			.map((rect) => ({
				nodeId: rect.nodeId,
				center: centersById.get(rect.nodeId)![axis],
			}));

	const rowBands = bandsOf(byAxisAscending("y"), bandTolerance);
	const columnBands = bandsOf(byAxisAscending("x"), bandTolerance);

	const rowIndexOf = new Map<string, number>();
	rowBands.forEach((band, index) => {
		band.forEach((nodeId) => {
			rowIndexOf.set(nodeId, index);
		});
	});
	const columnIndexOf = new Map<string, number>();
	columnBands.forEach((band, index) => {
		band.forEach((nodeId) => {
			columnIndexOf.set(nodeId, index);
		});
	});

	// A lattice needs every (row, column) cell occupied by exactly one node — not
	// merely matching band counts, which same-size-but-scrambled bands could satisfy
	// without actually forming a grid.
	const cellOccupancy = new Map<string, number>();
	for (const rect of sorted) {
		const key = `${rowIndexOf.get(rect.nodeId)}:${columnIndexOf.get(rect.nodeId)}`;
		cellOccupancy.set(key, (cellOccupancy.get(key) ?? 0) + 1);
	}
	const isLattice =
		rowBands.length >= 2 &&
		columnBands.length >= 2 &&
		columnBands.length <= GRID_MAX_TRACKS &&
		rowBands.length * columnBands.length === sorted.length &&
		cellOccupancy.size === rowBands.length * columnBands.length &&
		[...cellOccupancy.values()].every((count) => count === 1);

	if (isLattice) {
		const order = rowBands.flatMap((band) =>
			[...band].sort(
				(left, right) =>
					columnIndexOf.get(left)! - columnIndexOf.get(right)! ||
					left.localeCompare(right),
			),
		);
		const rowExtents = rowBands.map((band) => bandExtent(band, rectById, "y"));
		const columnExtents = columnBands.map((band) =>
			bandExtent(band, rectById, "x"),
		);
		// One "gap" field drives both axes (`setNodeLayoutValue`'s grid container has no
		// separate row/column gap), so each axis gets its own median first and the two
		// combine into one value the write can use.
		const rowGap = medianAdjacentGap(
			[...rowExtents].sort((left, right) => left.start - right.start),
		);
		const columnGap = medianAdjacentGap(
			[...columnExtents].sort((left, right) => left.start - right.start),
		);
		return {
			mode: "grid",
			columns: columnBands.length,
			gap: boundedGap(median([rowGap, columnGap])),
			order,
		};
	}

	const startOf = (rect: TidyNodeRect): number =>
		dominantAxis === "x" ? rect.x : rect.y;
	const endOf = (rect: TidyNodeRect): number =>
		dominantAxis === "x" ? rect.x + rect.width : rect.y + rect.height;
	const crossOf = (rect: TidyNodeRect): number =>
		dominantAxis === "x" ? rect.y : rect.x;
	const stackSorted = [...sorted].sort(
		(left, right) =>
			startOf(left) - startOf(right) ||
			crossOf(left) - crossOf(right) ||
			left.nodeId.localeCompare(right.nodeId),
	);
	const gap = medianAdjacentGap(
		stackSorted.map((rect) => ({ start: startOf(rect), end: endOf(rect) })),
	);
	return {
		mode: "stack",
		direction: dominantAxis === "x" ? "row" : "column",
		gap,
		order: stackSorted.map((rect) => rect.nodeId),
	};
};
