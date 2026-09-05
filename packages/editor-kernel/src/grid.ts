import { clampNumber, type Point } from "./geometry";

/**
 * Pure CSS-grid track math for canvas grid authoring (G1). The module owns no DOM
 * reference: callers resolve a container's used track sizes (normally from
 * `getComputedStyle().gridTemplateColumns/Rows`, which a grid container reports as
 * a used px listing) and project them into their own coordinate space, then ask
 * this module for cell rectangles, hit tests, and track boundary lines.
 *
 * Every function fails closed on an axis with no tracks: an empty size list yields
 * no lines, no cells, and a null hit test, so a caller that could not resolve the
 * row axis (an implicit/auto-row grid whose used listing the engine did not expose)
 * keeps working on the column axis alone instead of guessing a track count.
 */

/** Track sizes and gutter for one axis, in the caller's coordinate space. */
export type GridAxisGeometry = {
	/** Content-box start of the axis (padding and border already applied). */
	readonly origin: number;
	readonly sizes: readonly number[];
	readonly gap: number;
};

export type GridGeometry = {
	readonly columns: GridAxisGeometry;
	readonly rows: GridAxisGeometry;
};

/** 1-based grid line addresses, matching `gridColumnStart`/`gridRowStart`. */
export type GridCellAddress = {
	readonly column: number;
	readonly row: number;
};

export type GridPlacement = {
	readonly columnStart: number;
	readonly columnSpan: number;
	readonly rowStart: number;
	readonly rowSpan: number;
};

export type GridRect = {
	readonly left: number;
	readonly top: number;
	readonly width: number;
	readonly height: number;
};

/** A track boundary. `line` is the 1-based CSS grid line number it belongs to. */
export type GridTrackLine = {
	readonly axis: "x" | "y";
	readonly line: number;
	readonly position: number;
};

const PX_SUFFIX = "px";
/** Bounded to the document schema's own 1–12 track range (`setGridContainerValue`). */
export const GRID_MAX_TRACKS = 12;

/**
 * Parses a resolved `grid-template-columns` / `grid-template-rows` value into used
 * track sizes. Only a pure px listing is accepted; `none`, keyword-sized tracks, and
 * `repeat()`/`minmax()` that survived resolution all fail closed to an empty list.
 * Bracketed line-name groups are skipped rather than rejected.
 */
export const parseResolvedTrackSizes = (value: string): readonly number[] => {
	const trimmed = value.trim();
	if (trimmed === "" || trimmed === "none") return [];
	const sizes: number[] = [];
	let depth = 0;
	for (const token of trimmed.split(/\s+/)) {
		if (token.startsWith("[")) depth += 1;
		if (token.endsWith("]")) {
			depth = Math.max(0, depth - 1);
			continue;
		}
		if (depth > 0) continue;
		if (!token.endsWith(PX_SUFFIX)) return [];
		const size = Number.parseFloat(token.slice(0, -PX_SUFFIX.length));
		if (!Number.isFinite(size) || size < 0) return [];
		sizes.push(size);
	}
	return sizes;
};

/** Parses a resolved gap value; a non-px value (`normal`) fails closed to 0. */
export const parseResolvedGap = (value: string): number => {
	const trimmed = value.trim();
	if (!trimmed.endsWith(PX_SUFFIX)) return 0;
	const gap = Number.parseFloat(trimmed.slice(0, -PX_SUFFIX.length));
	return Number.isFinite(gap) && gap >= 0 ? gap : 0;
};

/**
 * Positions of every grid line on one axis, from the leading edge of track 1 to the
 * trailing edge of the last track. Length is `sizes.length + 1`, or 0 when the axis
 * has no tracks. Gutters sit between consecutive tracks, so line `n` is measured at
 * the leading edge of track `n`.
 */
export const gridAxisLinePositions = (
	axis: GridAxisGeometry,
): readonly number[] => {
	if (axis.sizes.length === 0) return [];
	const positions: number[] = [axis.origin];
	let cursor = axis.origin;
	for (const [index, size] of axis.sizes.entries()) {
		cursor += size + (index < axis.sizes.length - 1 ? axis.gap : 0);
		positions.push(cursor);
	}
	return positions;
};

/** Both axes' boundary lines, ready to project as overlay hairlines or snap targets. */
export const gridTrackLines = (
	geometry: GridGeometry,
): readonly GridTrackLine[] => [
	...gridAxisLinePositions(geometry.columns).map(
		(position, index): GridTrackLine => ({
			axis: "x",
			line: index + 1,
			position,
		}),
	),
	...gridAxisLinePositions(geometry.rows).map(
		(position, index): GridTrackLine => ({
			axis: "y",
			line: index + 1,
			position,
		}),
	),
];

/** Bounding rect of the whole track area, or null when either axis has no tracks. */
export const gridContentRect = (geometry: GridGeometry): GridRect | null => {
	const columnLines = gridAxisLinePositions(geometry.columns);
	const rowLines = gridAxisLinePositions(geometry.rows);
	if (columnLines.length === 0 || rowLines.length === 0) return null;
	const left = columnLines[0];
	const top = rowLines[0];
	return {
		left,
		top,
		width: columnLines[columnLines.length - 1] - left,
		height: rowLines[rowLines.length - 1] - top,
	};
};

/** Gutter bands between tracks, for the overlay's gap shading. */
export const gridGutterRects = (
	geometry: GridGeometry,
): readonly GridRect[] => {
	const content = gridContentRect(geometry);
	if (!content) return [];
	const columnLines = gridAxisLinePositions(geometry.columns);
	const rowLines = gridAxisLinePositions(geometry.rows);
	const vertical =
		geometry.columns.gap > 0
			? columnLines.slice(1, -1).map(
					(position): GridRect => ({
						left: position - geometry.columns.gap,
						top: content.top,
						width: geometry.columns.gap,
						height: content.height,
					}),
				)
			: [];
	const horizontal =
		geometry.rows.gap > 0
			? rowLines.slice(1, -1).map(
					(position): GridRect => ({
						left: content.left,
						top: position - geometry.rows.gap,
						width: content.width,
						height: geometry.rows.gap,
					}),
				)
			: [];
	return [...vertical, ...horizontal];
};

/**
 * 1-based track index containing `value`, clamped into the track range so a point in
 * a gutter or just outside the container still resolves to the nearest track. Null
 * only when the axis has no tracks at all.
 */
export const gridAxisTrackAt = (
	axis: GridAxisGeometry,
	value: number,
): number | null => {
	const lines = gridAxisLinePositions(axis);
	if (lines.length === 0) return null;
	const index = lines.findIndex(
		(position, line) => line > 0 && value < position,
	);
	return index < 0 ? axis.sizes.length : index;
};

/** Nearest cell for a point, or null when either axis has no tracks. */
export const gridCellAt = (
	geometry: GridGeometry,
	point: Point,
): GridCellAddress | null => {
	const column = gridAxisTrackAt(geometry.columns, point.x);
	const row = gridAxisTrackAt(geometry.rows, point.y);
	return column === null || row === null ? null : { column, row };
};

/** Nearest grid line (1-based) to `value` on one axis, or null with no tracks. */
export const gridAxisNearestLine = (
	axis: GridAxisGeometry,
	value: number,
): number | null => {
	const lines = gridAxisLinePositions(axis);
	if (lines.length === 0) return null;
	const nearest = lines.reduce(
		(best, position, index) =>
			Math.abs(position - value) < Math.abs(lines[best] - value) ? index : best,
		0,
	);
	return nearest + 1;
};

/**
 * Clamps a start/span pair into `1..trackCount`, keeping the span inside the track
 * range. A `trackCount` of 0 (unresolved axis) collapses to the identity 1/1 pair so
 * a caller never derives a write from an axis it could not measure.
 */
export const clampGridAxisPlacement = (
	start: number,
	span: number,
	trackCount: number,
): Readonly<{ start: number; span: number }> => {
	if (trackCount <= 0) return { start: 1, span: 1 };
	const bounded = Math.min(trackCount, GRID_MAX_TRACKS);
	const boundedSpan = clampNumber(Math.round(span), 1, bounded);
	return {
		start: clampNumber(Math.round(start), 1, bounded - boundedSpan + 1),
		span: boundedSpan,
	};
};

/** Leading and trailing edge of a clamped start/span run on one axis. */
export const gridAxisSpanEdges = (
	axis: GridAxisGeometry,
	start: number,
	span: number,
): Readonly<{ from: number; to: number }> | null => {
	const lines = gridAxisLinePositions(axis);
	if (lines.length === 0) return null;
	const bounded = clampGridAxisPlacement(start, span, axis.sizes.length);
	const lastTrack = bounded.start + bounded.span - 1;
	return {
		from: lines[bounded.start - 1],
		to: lines[lastTrack - 1] + axis.sizes[lastTrack - 1],
	};
};

/**
 * Rect covering a placement's tracks and the gutters between them (never a trailing
 * gutter), or null when an axis has no tracks. The placement is clamped first.
 */
export const gridPlacementRect = (
	geometry: GridGeometry,
	placement: GridPlacement,
): GridRect | null => {
	const columns = gridAxisSpanEdges(
		geometry.columns,
		placement.columnStart,
		placement.columnSpan,
	);
	const rows = gridAxisSpanEdges(
		geometry.rows,
		placement.rowStart,
		placement.rowSpan,
	);
	if (!columns || !rows) return null;
	return {
		left: columns.from,
		top: rows.from,
		width: columns.to - columns.from,
		height: rows.to - rows.from,
	};
};
