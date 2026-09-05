import {
	type PointerEvent as ReactPointerEvent,
	useRef,
	useState,
} from "react";
import {
	effectiveLayoutFrameContract,
	type LayoutFrameCell,
	type LayoutFramePlan,
	resolveLayoutFramePlan,
} from "@/entities/scene/model/layout-frame";
import {
	createSetLayoutChildPlacementCommand,
	createSetLayoutChildrenPlacementsCommand,
} from "@/entities/scene/model/layout-frame-commands";
import {
	applyMatrixToPoint,
	composeMatrix,
	invertMatrix,
	type Matrix2D,
	matrixFromTransform,
	matrixToSvg,
} from "@/entities/scene/model/rendering";
import { findNode } from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import type {
	Bounds,
	LayoutCellPlacement,
	LayoutFrameContract,
	SceneDocument,
	Vec2,
	VectorNode,
} from "@/entities/scene/model/types";

/** Layout-frame overlay target collected from the interaction document. */
export type LayoutFrameCanvasOverlayTarget = {
	readonly frame: VectorNode;
	readonly selectedChildId?: string;
	readonly selectedChildIds?: readonly string[];
	readonly matrix: Matrix2D;
};

type LayoutSpanHorizontalEdge = "left" | "right";
type LayoutSpanVerticalEdge = "top" | "bottom";
type LayoutSpanResizeHandleId =
	| LayoutSpanHorizontalEdge
	| LayoutSpanVerticalEdge
	| "top-left"
	| "top-right"
	| "bottom-left"
	| "bottom-right";

type LayoutSpanResizeHandle = {
	readonly id: LayoutSpanResizeHandleId;
	readonly horizontal?: LayoutSpanHorizontalEdge;
	readonly vertical?: LayoutSpanVerticalEdge;
	readonly cursor: string;
};

const LAYOUT_SPAN_RESIZE_HANDLES = [
	{
		id: "top-left",
		horizontal: "left",
		vertical: "top",
		cursor: "nwse-resize",
	},
	{ id: "top", vertical: "top", cursor: "ns-resize" },
	{
		id: "top-right",
		horizontal: "right",
		vertical: "top",
		cursor: "nesw-resize",
	},
	{ id: "left", horizontal: "left", cursor: "ew-resize" },
	{ id: "right", horizontal: "right", cursor: "ew-resize" },
	{
		id: "bottom-left",
		horizontal: "left",
		vertical: "bottom",
		cursor: "nesw-resize",
	},
	{ id: "bottom", vertical: "bottom", cursor: "ns-resize" },
	{
		id: "bottom-right",
		horizontal: "right",
		vertical: "bottom",
		cursor: "nwse-resize",
	},
] as const satisfies readonly LayoutSpanResizeHandle[];

/** Layout-cell placement with implicit span defaults resolved for grid math. */
export type RequiredLayoutCellSpanPlacement = Required<
	Pick<LayoutCellPlacement, "column" | "row" | "columnSpan" | "rowSpan">
>;

type LayoutCellMoveDelta = {
	readonly column: number;
	readonly row: number;
};

type LayoutCellResizeDelta = {
	readonly left?: number;
	readonly right?: number;
	readonly top?: number;
	readonly bottom?: number;
};

/** Base placement for one selected direct child in a layout frame. */
export type LayoutSelectedCellBase = {
	readonly childNodeId: string;
	readonly placement: RequiredLayoutCellSpanPlacement;
	readonly fit?: LayoutCellPlacement["fit"];
};

type LayoutSpanResizeDrag = {
	readonly handle: LayoutSpanResizeHandle;
	readonly base: RequiredLayoutCellSpanPlacement;
	readonly preview: RequiredLayoutCellSpanPlacement;
	readonly selectedBases: readonly LayoutSelectedCellBase[];
};

type LayoutCellMoveDrag = {
	readonly base: RequiredLayoutCellSpanPlacement;
	readonly preview: RequiredLayoutCellSpanPlacement;
	readonly offset: Vec2;
	readonly selectedBases: readonly LayoutSelectedCellBase[];
};

/**
 * Cell-move drag state for a pointerdown that starts on a layout-managed
 * child the on-canvas overlay does not already capture (typically an
 * unselected child, or a descendant whose Cell Host is not the overlay's
 * current active target). Lives in a ref (not overlay-component state) because
 * it is driven by the root `<svg>`'s pointer handlers, one level above any
 * single {@link LayoutFrameCanvasOverlay} instance. `matrix` is the resolved
 * frame's accumulated parent-to-frame matrix, reused every move so a fresh
 * `resolveLayoutFrameHostForNode` lookup is not needed per pointermove.
 */
export type ExternalLayoutMoveDrag = {
	readonly pointerId: number;
	readonly frameId: string;
	readonly hostChildId: string;
	readonly matrix: Matrix2D;
	readonly base: RequiredLayoutCellSpanPlacement;
	readonly offset: Vec2;
	readonly selectedBases: readonly LayoutSelectedCellBase[];
	readonly preview: RequiredLayoutCellSpanPlacement;
};

type LayoutFrameOverlayMetrics = {
	readonly bounds: Bounds;
	readonly columns: number;
	readonly rows: number;
	readonly autoRows: boolean;
	readonly contentX: number;
	readonly contentY: number;
	readonly availableHeight: number;
	readonly columnWidth: number;
	readonly rowHeight: number;
	readonly gapX: number;
	readonly gapY: number;
};

const containsSelectedLayoutDescendant = (
	node: VectorNode,
	selected: ReadonlySet<string>,
): boolean =>
	selected.has(node.id) ||
	!!node.children?.some((child) =>
		containsSelectedLayoutDescendant(child, selected),
	);

const containsLayoutDescendantId = (
	node: VectorNode,
	nodeId: string,
): boolean =>
	node.id === nodeId ||
	!!node.children?.some((child) => containsLayoutDescendantId(child, nodeId));

const selectedLayoutHostChildIds = (
	children: readonly VectorNode[] | undefined,
	selected: ReadonlySet<string>,
): readonly string[] =>
	children
		?.filter((child) => containsSelectedLayoutDescendant(child, selected))
		.map((child) => child.id) ?? [];

const layoutHostChildIdForNode = (
	children: readonly VectorNode[] | undefined,
	nodeId: string | null | undefined,
): string | undefined => {
	if (!nodeId) return undefined;
	return children?.find((child) => containsLayoutDescendantId(child, nodeId))
		?.id;
};

/** A layout frame ancestor resolved for a hit node, with its Cell Host child. */
export type LayoutFrameHost = {
	readonly frame: VectorNode;
	readonly matrix: Matrix2D;
	readonly hostChildId: string;
};

/**
 * Resolves the INNERMOST layout frame ancestor of `nodeId` whose direct
 * children contain it (the node itself or a deeper descendant of one), plus
 * that frame's accumulated parent-to-frame matrix. Used to route a fresh
 * pointerdown on a layout-managed child — one the on-canvas overlay does not
 * already own because it is not yet selected — into the same cell-placement
 * drag the overlay's selected-cell body offers. Nested layouts resolve to the
 * nearest (innermost) grid so a drag targets the grid the user is pointing
 * into, not an outer ancestor grid the same node also happens to sit inside.
 */
export const resolveLayoutFrameHostForNode = (
	document: SceneDocument,
	nodeId: string,
): LayoutFrameHost | null => {
	const identityMatrix: Matrix2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
	let resolved: LayoutFrameHost | null = null;

	const visit = (
		nodes: readonly VectorNode[],
		parentMatrix: Matrix2D,
	): void => {
		for (const node of nodes) {
			const matrix = composeMatrix(
				parentMatrix,
				matrixFromTransform(node.transform),
			);
			if (node.frame?.layout) {
				const hostChildId = layoutHostChildIdForNode(node.children, nodeId);
				if (hostChildId) resolved = { frame: node, matrix, hostChildId };
			}
			if (node.children) visit(node.children, matrix);
		}
	};

	for (const layer of document.layers) visit(layer.nodes, identityMatrix);
	return resolved;
};

/** Collects every layout frame needing grid/cell overlay chrome for selection. */
export const collectLayoutFrameOverlayTargets = (
	document: SceneDocument,
	selectedNodeIds: readonly string[],
	primaryNodeId: string | null,
): readonly LayoutFrameCanvasOverlayTarget[] => {
	const selected = new Set(selectedNodeIds);
	const targets = new Map<string, LayoutFrameCanvasOverlayTarget>();
	const identityMatrix = {
		a: 1,
		b: 0,
		c: 0,
		d: 1,
		e: 0,
		f: 0,
	} satisfies Matrix2D;

	const visit = (
		nodes: readonly VectorNode[],
		parentMatrix: Matrix2D,
	): void => {
		for (const node of nodes) {
			const matrix = composeMatrix(
				parentMatrix,
				matrixFromTransform(node.transform),
			);
			if (node.frame?.layout) {
				if (selected.has(node.id)) {
					targets.set(node.id, { frame: node, matrix });
				}
				const selectedChildIds = selectedLayoutHostChildIds(
					node.children,
					selected,
				);
				const selectedChildId =
					primaryNodeId === null
						? selectedChildIds[0]
						: layoutHostChildIdForNode(node.children, primaryNodeId);
				if (selectedChildId || selectedChildIds.length > 0) {
					targets.set(node.id, {
						frame: node,
						...(selectedChildId ? { selectedChildId } : {}),
						selectedChildIds,
						matrix,
					});
				}
			}
			if (node.children) visit(node.children, matrix);
		}
	};

	for (const layer of document.layers) visit(layer.nodes, identityMatrix);
	return [...targets.values()];
};

const toRequiredLayoutPlacement = (
	placement: LayoutCellPlacement,
): RequiredLayoutCellSpanPlacement => ({
	column: placement.column,
	row: placement.row,
	columnSpan: placement.columnSpan ?? 1,
	rowSpan: placement.rowSpan ?? 1,
});

const sameRequiredLayoutPlacement = (
	left: RequiredLayoutCellSpanPlacement,
	right: RequiredLayoutCellSpanPlacement,
): boolean =>
	left.column === right.column &&
	left.row === right.row &&
	left.columnSpan === right.columnSpan &&
	left.rowSpan === right.rowSpan;

const layoutPlacementsOverlap = (
	left: RequiredLayoutCellSpanPlacement,
	right: RequiredLayoutCellSpanPlacement,
): boolean =>
	left.column < right.column + right.columnSpan &&
	right.column < left.column + left.columnSpan &&
	left.row < right.row + right.rowSpan &&
	right.row < left.row + left.rowSpan;

const conflictingLayoutCellIds = (
	cells: readonly {
		readonly childNodeId: string;
		readonly placement: RequiredLayoutCellSpanPlacement;
	}[],
): ReadonlySet<string> => {
	const ids = new Set<string>();
	for (let index = 0; index < cells.length; index += 1) {
		const left = cells[index];
		if (!left) continue;
		for (
			let compareIndex = index + 1;
			compareIndex < cells.length;
			compareIndex += 1
		) {
			const right = cells[compareIndex];
			if (!right || !layoutPlacementsOverlap(left.placement, right.placement)) {
				continue;
			}
			ids.add(left.childNodeId);
			ids.add(right.childNodeId);
		}
	}
	return ids;
};

const clampWhole = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, Math.round(value)));

const clampInteger = (value: number, min: number, max: number): number =>
	max < min ? min : Math.min(max, Math.max(min, value));

const moveDeltaForPlacement = (
	base: RequiredLayoutCellSpanPlacement,
	preview: RequiredLayoutCellSpanPlacement,
): LayoutCellMoveDelta => ({
	column: preview.column - base.column,
	row: preview.row - base.row,
});

const placementWithMoveDelta = (
	placement: RequiredLayoutCellSpanPlacement,
	delta: LayoutCellMoveDelta,
): RequiredLayoutCellSpanPlacement => ({
	...placement,
	column: placement.column + delta.column,
	row: placement.row + delta.row,
});

/**
 * One-cell move delta for an unmodified (Shift allowed) arrow key, or `null`
 * for any other key. Unlike the ordinary pixel-nudge handler (`nudgeDelta` in
 * `features/transform/model/gestures.ts`), Shift never multiplies the step —
 * cell placement has no sub-cell granularity, so a shifted press still moves
 * exactly one cell.
 */
const layoutCellMoveDeltaForKey = (key: string): LayoutCellMoveDelta | null => {
	switch (key) {
		case "ArrowLeft":
			return { column: -1, row: 0 };
		case "ArrowRight":
			return { column: 1, row: 0 };
		case "ArrowUp":
			return { column: 0, row: -1 };
		case "ArrowDown":
			return { column: 0, row: 1 };
		default:
			return null;
	}
};

const resizeDeltaForPlacement = (
	base: RequiredLayoutCellSpanPlacement,
	preview: RequiredLayoutCellSpanPlacement,
	handle: LayoutSpanResizeHandle,
): LayoutCellResizeDelta => {
	const baseRight = base.column + base.columnSpan - 1;
	const previewRight = preview.column + preview.columnSpan - 1;
	const baseBottom = base.row + base.rowSpan - 1;
	const previewBottom = preview.row + preview.rowSpan - 1;
	return {
		...(handle.horizontal === "left"
			? { left: preview.column - base.column }
			: {}),
		...(handle.horizontal === "right"
			? { right: previewRight - baseRight }
			: {}),
		...(handle.vertical === "top" ? { top: preview.row - base.row } : {}),
		...(handle.vertical === "bottom"
			? { bottom: previewBottom - baseBottom }
			: {}),
	};
};

const placementWithResizeDelta = (
	metrics: LayoutFrameOverlayMetrics,
	placement: RequiredLayoutCellSpanPlacement,
	delta: LayoutCellResizeDelta,
): RequiredLayoutCellSpanPlacement => {
	const originalRight = placement.column + placement.columnSpan - 1;
	const left =
		delta.left === undefined
			? placement.column
			: clampInteger(placement.column + delta.left, 0, originalRight);
	const right =
		delta.right === undefined
			? originalRight
			: clampInteger(
					originalRight + delta.right,
					left,
					Math.max(left, metrics.columns - 1),
				);
	const originalBottom = placement.row + placement.rowSpan - 1;
	const top =
		delta.top === undefined
			? placement.row
			: clampInteger(placement.row + delta.top, 0, originalBottom);
	const bottomMax =
		delta.bottom === undefined
			? originalBottom
			: metrics.autoRows
				? Math.max(metrics.rows - 1, originalBottom + delta.bottom)
				: metrics.rows - 1;
	const bottom =
		delta.bottom === undefined
			? originalBottom
			: clampInteger(
					originalBottom + delta.bottom,
					top,
					Math.max(top, bottomMax),
				);
	return {
		column: left,
		row: top,
		columnSpan: right - left + 1,
		rowSpan: bottom - top + 1,
	};
};

const resizeDeltaHasMovement = (delta: LayoutCellResizeDelta): boolean =>
	(delta.left ?? 0) !== 0 ||
	(delta.right ?? 0) !== 0 ||
	(delta.top ?? 0) !== 0 ||
	(delta.bottom ?? 0) !== 0;

const stepIntegerTowardZero = (value: number): number =>
	value > 0 ? value - 1 : value < 0 ? value + 1 : 0;

const stepResizeDeltaTowardZero = (
	delta: LayoutCellResizeDelta,
): LayoutCellResizeDelta => {
	const magnitude = Math.max(
		Math.abs(delta.left ?? 0),
		Math.abs(delta.right ?? 0),
		Math.abs(delta.top ?? 0),
		Math.abs(delta.bottom ?? 0),
	);
	if (magnitude === 0) return delta;
	const shouldStep = (value: number | undefined): boolean =>
		value !== undefined && value !== 0 && Math.abs(value) === magnitude;
	return {
		...(delta.left === undefined
			? {}
			: {
					left: shouldStep(delta.left)
						? stepIntegerTowardZero(delta.left)
						: delta.left,
				}),
		...(delta.right === undefined
			? {}
			: {
					right: shouldStep(delta.right)
						? stepIntegerTowardZero(delta.right)
						: delta.right,
				}),
		...(delta.top === undefined
			? {}
			: {
					top: shouldStep(delta.top)
						? stepIntegerTowardZero(delta.top)
						: delta.top,
				}),
		...(delta.bottom === undefined
			? {}
			: {
					bottom: shouldStep(delta.bottom)
						? stepIntegerTowardZero(delta.bottom)
						: delta.bottom,
				}),
	};
};

const selectedCellsWithResizeDelta = (
	metrics: LayoutFrameOverlayMetrics,
	selectedBases: readonly LayoutSelectedCellBase[],
	delta: LayoutCellResizeDelta,
): readonly {
	readonly childNodeId: string;
	readonly placement: RequiredLayoutCellSpanPlacement;
}[] =>
	selectedBases.map((item) => ({
		childNodeId: item.childNodeId,
		placement: placementWithResizeDelta(metrics, item.placement, delta),
	}));

const selectedCellsHaveConflicts = (
	cells: readonly {
		readonly childNodeId: string;
		readonly placement: RequiredLayoutCellSpanPlacement;
	}[],
): boolean => conflictingLayoutCellIds(cells).size > 0;

const clampLayoutResizeDeltaForSelectedGroup = (
	metrics: LayoutFrameOverlayMetrics,
	selectedBases: readonly LayoutSelectedCellBase[],
	delta: LayoutCellResizeDelta,
): LayoutCellResizeDelta => {
	if (selectedBases.length < 2) return delta;
	if (selectedCellsHaveConflicts(selectedBases)) return delta;
	let clamped = delta;
	while (resizeDeltaHasMovement(clamped)) {
		if (
			!selectedCellsHaveConflicts(
				selectedCellsWithResizeDelta(metrics, selectedBases, clamped),
			)
		) {
			return clamped;
		}
		clamped = stepResizeDeltaTowardZero(clamped);
	}
	return clamped;
};

const clampLayoutMoveDelta = (
	metrics: LayoutFrameOverlayMetrics,
	placements: readonly RequiredLayoutCellSpanPlacement[],
	delta: LayoutCellMoveDelta,
): LayoutCellMoveDelta => {
	if (placements.length === 0) return delta;
	const minColumn = Math.min(
		...placements.map((placement) => placement.column),
	);
	const maxColumnEnd = Math.max(
		...placements.map((placement) => placement.column + placement.columnSpan),
	);
	const minRow = Math.min(...placements.map((placement) => placement.row));
	const maxRowEnd = Math.max(
		...placements.map((placement) => placement.row + placement.rowSpan),
	);
	return {
		column: clampInteger(
			delta.column,
			-minColumn,
			metrics.columns - maxColumnEnd,
		),
		row: clampInteger(
			delta.row,
			-minRow,
			metrics.autoRows ? delta.row : metrics.rows - maxRowEnd,
		),
	};
};

const placementBounds = (
	metrics: LayoutFrameOverlayMetrics,
	placement: RequiredLayoutCellSpanPlacement,
): Bounds => {
	const rows = metrics.autoRows
		? Math.max(metrics.rows, placement.row + placement.rowSpan)
		: metrics.rows;
	const rowTrackHeight = Math.max(
		0,
		metrics.availableHeight - metrics.gapY * (rows - 1),
	);
	const rowHeight = rows > 0 ? rowTrackHeight / rows : metrics.rowHeight;
	return {
		x:
			metrics.contentX +
			placement.column * (metrics.columnWidth + metrics.gapX),
		y: metrics.contentY + placement.row * (rowHeight + metrics.gapY),
		width: Math.max(
			0,
			metrics.columnWidth * placement.columnSpan +
				metrics.gapX * (placement.columnSpan - 1),
		),
		height: Math.max(
			0,
			rowHeight * placement.rowSpan + metrics.gapY * (placement.rowSpan - 1),
		),
	};
};

const placementForResizePoint = (
	metrics: LayoutFrameOverlayMetrics,
	base: RequiredLayoutCellSpanPlacement,
	handle: LayoutSpanResizeHandle,
	point: Vec2,
): RequiredLayoutCellSpanPlacement => {
	const next = { ...base };
	if (handle.horizontal) {
		const step = Math.max(1e-6, metrics.columnWidth + metrics.gapX);
		const column = clampWhole(
			Math.floor((point.x - metrics.contentX) / step),
			0,
			metrics.columns - 1,
		);
		const baseRight = base.column + base.columnSpan - 1;
		if (handle.horizontal === "left") {
			next.column = Math.min(baseRight, column);
			next.columnSpan = baseRight - next.column + 1;
		} else {
			const right = Math.max(base.column, column);
			next.columnSpan = right - base.column + 1;
		}
	}
	if (handle.vertical) {
		const step = Math.max(1e-6, metrics.rowHeight + metrics.gapY);
		const maxRow = metrics.autoRows
			? Math.max(
					metrics.rows - 1,
					Math.floor((point.y - metrics.contentY) / step),
				)
			: metrics.rows - 1;
		const row = clampWhole(
			Math.floor((point.y - metrics.contentY) / step),
			0,
			Math.max(0, maxRow),
		);
		const baseBottom = base.row + base.rowSpan - 1;
		if (handle.vertical === "top") {
			next.row = Math.min(baseBottom, row);
			next.rowSpan = baseBottom - next.row + 1;
		} else {
			const bottom = Math.max(base.row, row);
			next.rowSpan = bottom - base.row + 1;
		}
	}
	return next;
};

const placementForMovePoint = (
	metrics: LayoutFrameOverlayMetrics,
	base: RequiredLayoutCellSpanPlacement,
	point: Vec2,
	offset: Vec2,
): RequiredLayoutCellSpanPlacement => {
	const stepX = Math.max(1e-6, metrics.columnWidth + metrics.gapX);
	const stepY = Math.max(1e-6, metrics.rowHeight + metrics.gapY);
	const rawRow = (point.y - offset.y - metrics.contentY) / stepY;
	const maxRow = metrics.autoRows
		? Math.max(metrics.rows - base.rowSpan, Math.round(rawRow))
		: metrics.rows - base.rowSpan;
	return {
		...base,
		column: clampWhole(
			(point.x - offset.x - metrics.contentX) / stepX,
			0,
			Math.max(0, metrics.columns - base.columnSpan),
		),
		row: clampWhole(rawRow, 0, Math.max(0, maxRow)),
	};
};

const layoutSpanHandlePoint = (
	bounds: Bounds,
	handle: LayoutSpanResizeHandle,
): Vec2 => ({
	x:
		handle.horizontal === "left"
			? bounds.x
			: handle.horizontal === "right"
				? bounds.x + bounds.width
				: bounds.x + bounds.width / 2,
	y:
		handle.vertical === "top"
			? bounds.y
			: handle.vertical === "bottom"
				? bounds.y + bounds.height
				: bounds.y + bounds.height / 2,
});

const localPointForPointer = (
	element: SVGGraphicsElement,
	event: ReactPointerEvent<Element>,
): Vec2 | null => {
	const svg = element.ownerSVGElement;
	const matrix = element.getScreenCTM();
	if (!svg || !matrix) return null;
	const point = svg.createSVGPoint();
	point.x = event.clientX;
	point.y = event.clientY;
	const local = point.matrixTransform(matrix.inverse());
	return { x: local.x, y: local.y };
};

/**
 * Grid-track metrics for one layout frame snapshot, shared by the overlay
 * component and the external (unselected-child) cell-drag routing in the root
 * pointer handlers so the two paths cannot drift apart. `layout` is the
 * effective (variant-resolved) contract for `plan`; callers already need it
 * separately (padding/gap/allowOverlap reads outside the metrics shape), so it
 * is a parameter rather than re-derived here.
 */
const layoutOverlayMetricsFor = (
	bounds: Bounds,
	plan: LayoutFramePlan,
	layout: LayoutFrameContract,
): LayoutFrameOverlayMetrics => {
	const contentX = bounds.x + layout.padding.left;
	const contentY = bounds.y + layout.padding.top;
	const contentWidth = Math.max(
		0,
		bounds.width -
			layout.padding.left -
			layout.padding.right -
			layout.gap.x * (plan.columns - 1),
	);
	const contentHeight = Math.max(
		0,
		bounds.height -
			layout.padding.top -
			layout.padding.bottom -
			layout.gap.y * (plan.rows - 1),
	);
	const availableHeight = Math.max(
		0,
		bounds.height - layout.padding.top - layout.padding.bottom,
	);
	return {
		bounds,
		columns: plan.columns,
		rows: plan.rows,
		contentX,
		contentY,
		columnWidth: contentWidth / plan.columns,
		rowHeight: contentHeight / plan.rows,
		gapX: layout.gap.x,
		gapY: layout.gap.y,
		autoRows: layout.rows === "auto",
		availableHeight,
	};
};

/**
 * Applies a cell-move placement commit for one or more same-frame selected
 * cells, sharing a shifted delta. Extracted from the overlay's on-canvas cell
 * drag so the root pointer handlers' external (unselected-child) cell drag —
 * routed in {@link CanvasShell} when the drag starts on a layout-managed child
 * that is not yet the overlay's active selection — issues byte-identical
 * command payloads. Pure: callers own event handling (preventDefault/
 * stopPropagation) and the no-op guard when `placement` did not change.
 */
const applyLayoutMovePlacementCommit = (options: {
	readonly frameId: string;
	readonly selectedChildId: string;
	readonly selectedCellPlacement: LayoutCellPlacement;
	readonly selectedCellBases: readonly LayoutSelectedCellBase[];
	readonly placement: RequiredLayoutCellSpanPlacement;
}): void => {
	const { frameId, selectedChildId, selectedCellPlacement, selectedCellBases } =
		options;
	const basePlacement = toRequiredLayoutPlacement(selectedCellPlacement);
	if (sameRequiredLayoutPlacement(options.placement, basePlacement)) return;
	const delta = moveDeltaForPlacement(basePlacement, options.placement);
	if (selectedCellBases.length > 1) {
		useSceneStore.getState().apply(
			createSetLayoutChildrenPlacementsCommand({
				frameNodeId: frameId,
				placements: selectedCellBases.map((item) => ({
					childNodeId: item.childNodeId,
					placement: {
						...placementWithMoveDelta(item.placement, delta),
						...(item.fit ? { fit: item.fit } : {}),
					},
				})),
			}),
		);
		return;
	}
	useSceneStore.getState().apply(
		createSetLayoutChildPlacementCommand({
			frameNodeId: frameId,
			childNodeId: selectedChildId,
			placement: {
				...options.placement,
				...(selectedCellPlacement.fit
					? { fit: selectedCellPlacement.fit }
					: {}),
			},
		}),
	);
};

/** Resolved per-move context for an {@link ExternalLayoutMoveDrag}. */
type ExternalLayoutMoveContext = {
	readonly frame: VectorNode;
	readonly plan: LayoutFramePlan;
	readonly layout: LayoutFrameContract;
	readonly metrics: LayoutFrameOverlayMetrics;
	readonly hostCell: LayoutFrameCell;
	readonly selectedBases: readonly LayoutSelectedCellBase[];
};

/**
 * Re-resolves a frame node, its current plan/metrics, and the same-frame
 * selected Cell Host bases from a fresh document snapshot. Called once to
 * begin an {@link ExternalLayoutMoveDrag} and again on every pointermove so
 * auto-row downward growth (which changes `plan.rows` as cells fill) tracks
 * the drag exactly like the overlay component's per-render recompute. Returns
 * `null` when the frame/host no longer resolve (deleted mid-drag, etc.) so the
 * caller can fail closed rather than act on stale geometry.
 */
const resolveExternalLayoutMoveContext = (
	document: SceneDocument,
	frameId: string,
	hostChildId: string,
	selectedNodeIds: readonly string[],
): ExternalLayoutMoveContext | null => {
	const frame = findNode(document, frameId);
	if (frame?.geometry.kind !== "rect" || !frame.frame?.layout) {
		return null;
	}
	const childIds = frame.children?.map((child) => child.id) ?? [];
	const plan = resolveLayoutFramePlan(
		frame.geometry.bounds,
		frame.frame.layout,
		childIds,
	);
	const hostCell = plan.cells.find((cell) => cell.nodeId === hostChildId);
	if (!hostCell) return null;
	const bounds = frame.geometry.bounds;
	const layout = effectiveLayoutFrameContract(plan.layout, {
		width: bounds.width,
	});
	const metrics = layoutOverlayMetricsFor(bounds, plan, layout);
	const selected = new Set(selectedNodeIds);
	const selectedBases = selectedLayoutHostChildIds(
		frame.children,
		selected,
	).flatMap((childId) => {
		const cell = plan.cells.find((candidate) => candidate.nodeId === childId);
		if (!cell) return [];
		return [
			{
				childNodeId: childId,
				placement: toRequiredLayoutPlacement(cell.placement),
				...(cell.placement.fit ? { fit: cell.placement.fit } : {}),
			} satisfies LayoutSelectedCellBase,
		];
	});
	return { frame, plan, layout, metrics, hostCell, selectedBases };
};

/**
 * Routes an unmodified (Shift allowed) arrow-key press into a one-cell
 * placement commit when the selection's PRIMARY node is a layout-managed
 * child, mirroring `tryRouteLayoutMoveDrag`'s pointer-drag routing for the
 * keyboard. Unlike the drag path there is no in-flight gesture state: each
 * press re-resolves fresh context via {@link resolveExternalLayoutMoveContext}
 * (so auto-row downward growth and live grid bounds are current), clamps the
 * one-cell delta with {@link clampLayoutMoveDelta} exactly like a one-cell
 * drag, and — when the clamped delta is non-zero — commits once through
 * {@link applyLayoutMovePlacementCommit}, which already propagates the shared
 * delta to every same-frame selected cell. Returns `true` when it consumed the
 * keydown (either a real commit or a clamped-to-zero no-op at a grid edge), so
 * the caller skips `preventDefault`-free fallthrough to the ordinary
 * pixel-nudge handler; `false` leaves the event untouched for a mixed
 * selection whose primary is not layout-managed, or a key this routing does
 * not own.
 */
export const tryRouteLayoutMoveKeyNudge = (
	document: SceneDocument,
	event: KeyboardEvent,
	primaryNodeId: string | null,
	selectedNodeIds: readonly string[],
): boolean => {
	if (event.metaKey || event.ctrlKey || event.altKey) return false;
	const keyDelta = layoutCellMoveDeltaForKey(event.key);
	if (!keyDelta) return false;
	if (!primaryNodeId) return false;
	const host = resolveLayoutFrameHostForNode(document, primaryNodeId);
	if (!host) return false;

	const context = resolveExternalLayoutMoveContext(
		document,
		host.frame.id,
		host.hostChildId,
		selectedNodeIds,
	);
	if (!context) return false;

	const delta = clampLayoutMoveDelta(
		context.metrics,
		context.selectedBases.map((item) => item.placement),
		keyDelta,
	);
	event.preventDefault();
	if (delta.column === 0 && delta.row === 0) return true;

	const base = toRequiredLayoutPlacement(context.hostCell.placement);
	applyLayoutMovePlacementCommit({
		frameId: host.frame.id,
		selectedChildId: host.hostChildId,
		selectedCellPlacement: context.hostCell.placement,
		selectedCellBases: context.selectedBases,
		placement: placementWithMoveDelta(base, delta),
	});
	return true;
};

/**
 * Builds the initial {@link ExternalLayoutMoveDrag} for a pointerdown that
 * lands on a layout-managed child outside the overlay's current selection.
 * `point` is the pointer in the SAME coordinate space as `host.matrix` maps
 * INTO (i.e. `host.matrix` is the frame's parent-to-frame matrix, so `point`
 * is in that parent space — the gesture's artboard-local `context.point`).
 * Returns `null` when the frame's matrix cannot be inverted (degenerate
 * scale) or the plan/host cell does not resolve, so the caller can fall
 * through to the ordinary gesture handler instead of starting a broken drag.
 */
export const beginExternalLayoutMoveDrag = (
	document: SceneDocument,
	host: LayoutFrameHost,
	point: Vec2,
	pointerId: number,
	selectedNodeIds: readonly string[],
): ExternalLayoutMoveDrag | null => {
	const context = resolveExternalLayoutMoveContext(
		document,
		host.frame.id,
		host.hostChildId,
		selectedNodeIds,
	);
	if (!context) return null;
	const inverse = invertMatrix(host.matrix);
	if (!inverse) return null;
	const localPoint = applyMatrixToPoint(inverse, point);
	const base = toRequiredLayoutPlacement(context.hostCell.placement);
	const baseBounds = placementBounds(context.metrics, base);
	return {
		pointerId,
		frameId: host.frame.id,
		hostChildId: host.hostChildId,
		matrix: host.matrix,
		base,
		offset: {
			x: localPoint.x - baseBounds.x,
			y: localPoint.y - baseBounds.y,
		},
		selectedBases: context.selectedBases,
		preview: base,
	};
};

/**
 * Advances an {@link ExternalLayoutMoveDrag} preview for a new pointer point,
 * re-resolving metrics from the current document first (see
 * {@link resolveExternalLayoutMoveContext}) so downward auto-row growth during
 * the drag matches the overlay's per-render behavior. Returns `null` when the
 * frame/host stopped resolving (deleted mid-drag) so the caller can end the
 * drag without committing a stale placement.
 */
export const nextExternalLayoutMoveDrag = (
	document: SceneDocument,
	drag: ExternalLayoutMoveDrag,
	point: Vec2,
	selectedNodeIds: readonly string[],
): ExternalLayoutMoveDrag | null => {
	const context = resolveExternalLayoutMoveContext(
		document,
		drag.frameId,
		drag.hostChildId,
		selectedNodeIds,
	);
	if (!context) return null;
	const inverse = invertMatrix(drag.matrix);
	if (!inverse) return null;
	const localPoint = applyMatrixToPoint(inverse, point);
	const rawPreview = placementForMovePoint(
		context.metrics,
		drag.base,
		localPoint,
		drag.offset,
	);
	// Unlike resize, the overlay's move clamp never gates on `allowOverlap` — it
	// only keeps the selected group's extent inside the grid bounds; overlap with
	// OTHER cells is surfaced as an orange preview at render time, not blocked
	// here. Mirrored exactly (see the overlay's `nextMoveDrag`).
	const delta = clampLayoutMoveDelta(
		context.metrics,
		context.selectedBases.map((item) => item.placement),
		moveDeltaForPlacement(drag.base, rawPreview),
	);
	return {
		...drag,
		selectedBases: context.selectedBases,
		preview: placementWithMoveDelta(drag.base, delta),
	};
};

/**
 * Ends an {@link ExternalLayoutMoveDrag}: recomputes one final preview at the
 * release point (mirroring the overlay's `endMoveDrag`, which re-derives from
 * the latest pointer position before committing), then issues the same
 * command {@link applyLayoutMovePlacementCommit} the overlay's own cell body
 * issues. A `null` final-resolve (frame/host deleted mid-drag) falls back to
 * the last known preview rather than silently dropping the gesture.
 */
export const commitExternalLayoutMoveDrag = (
	document: SceneDocument,
	drag: ExternalLayoutMoveDrag,
	point: Vec2,
	selectedNodeIds: readonly string[],
): void => {
	const final =
		nextExternalLayoutMoveDrag(document, drag, point, selectedNodeIds) ?? drag;
	const context = resolveExternalLayoutMoveContext(
		document,
		final.frameId,
		final.hostChildId,
		selectedNodeIds,
	);
	if (!context) return;
	applyLayoutMovePlacementCommit({
		frameId: final.frameId,
		selectedChildId: final.hostChildId,
		selectedCellPlacement: context.hostCell.placement,
		selectedCellBases: final.selectedBases,
		placement: final.preview,
	});
};

/**
 * Interactive SVG overlay for layout-frame grid chrome and selected-cell
 * move/resize handles. It writes only layout placement commands; CanvasShell
 * owns target collection and root pointer routing.
 */
export function LayoutFrameCanvasOverlay({
	frame,
	selectedChildId,
	selectedChildIds = [],
	matrix,
	scale,
	externalMoveDrag,
}: LayoutFrameCanvasOverlayTarget & {
	readonly scale: number;
	/**
	 * Live drag state from a root-pointer-handler cell drag that started on a
	 * child this overlay instance did not already capture (see
	 * `tryRouteLayoutMoveDrag` in {@link CanvasShell}) — carries the DRAGGED
	 * child's own host id and base placement alongside the live preview, since
	 * that child is not necessarily the overlay's `selectedChildId` (e.g. the
	 * selection's primary is a different same-frame host than the one actually
	 * being dragged). The overlay derives its active preview child from this
	 * instead of assuming it is always `selectedChildId`, so a passive selected
	 * cell previews the correct shared delta the same way it does for an
	 * in-overlay drag.
	 */
	readonly externalMoveDrag?: {
		readonly hostChildId: string;
		readonly base: RequiredLayoutCellSpanPlacement;
		readonly placement: RequiredLayoutCellSpanPlacement;
	};
}) {
	const groupRef = useRef<SVGGElement | null>(null);
	const [resizeDrag, setResizeDrag] = useState<LayoutSpanResizeDrag | null>(
		null,
	);
	const [moveDrag, setMoveDrag] = useState<LayoutCellMoveDrag | null>(null);
	if (frame.geometry.kind !== "rect" || !frame.frame?.layout) return null;
	const childIds = frame.children?.map((child) => child.id) ?? [];
	const plan = resolveLayoutFramePlan(
		frame.geometry.bounds,
		frame.frame.layout,
		childIds,
	);
	const bounds = frame.geometry.bounds;
	const layout = effectiveLayoutFrameContract(plan.layout, {
		width: bounds.width,
	});
	const contentX = bounds.x + layout.padding.left;
	const contentY = bounds.y + layout.padding.top;
	const contentWidth = Math.max(
		0,
		bounds.width -
			layout.padding.left -
			layout.padding.right -
			layout.gap.x * (plan.columns - 1),
	);
	const contentHeight = Math.max(
		0,
		bounds.height -
			layout.padding.top -
			layout.padding.bottom -
			layout.gap.y * (plan.rows - 1),
	);
	const columnWidth = contentWidth / plan.columns;
	const rowHeight = contentHeight / plan.rows;
	const metrics = layoutOverlayMetricsFor(bounds, plan, layout);
	const cells = Array.from(
		{ length: plan.columns * plan.rows },
		(_, index) => ({
			column: index % plan.columns,
			row: Math.floor(index / plan.columns),
		}),
	);
	const selectedCell = selectedChildId
		? plan.cells.find((cell) => cell.nodeId === selectedChildId)
		: null;
	// The child the LIVE preview is for is not necessarily the overlay's
	// `selectedChildId` (the selection's primary): an external drag can target a
	// different same-frame host (e.g. primary A, B also selected, user drags B's
	// body). `selectedCell`/`selectedChildId` stay authoritative for the LOCAL
	// commit-guard machinery below (in-overlay drags only ever start from the
	// selected primary's own cell rect), but preview derivation must key off the
	// child actually being dragged.
	const activeChildId = externalMoveDrag?.hostChildId ?? selectedChildId;
	const activeCell = activeChildId
		? plan.cells.find((cell) => cell.nodeId === activeChildId)
		: null;
	const selectedCellBases = selectedChildIds.flatMap((childId) => {
		const cell = plan.cells.find((candidate) => candidate.nodeId === childId);
		if (!cell) return [];
		return [
			{
				childNodeId: childId,
				placement: toRequiredLayoutPlacement(cell.placement),
				...(cell.placement.fit ? { fit: cell.placement.fit } : {}),
			} satisfies LayoutSelectedCellBase,
		];
	});
	const moveDelta = moveDrag
		? moveDeltaForPlacement(moveDrag.base, moveDrag.preview)
		: externalMoveDrag
			? moveDeltaForPlacement(externalMoveDrag.base, externalMoveDrag.placement)
			: null;
	const resizeDelta = resizeDrag
		? resizeDeltaForPlacement(
				resizeDrag.base,
				resizeDrag.preview,
				resizeDrag.handle,
			)
		: null;
	const passiveSelectedCells = selectedCellBases
		.filter((item) => item.childNodeId !== activeChildId)
		.map((item) => ({
			childNodeId: item.childNodeId,
			placement: resizeDelta
				? placementWithResizeDelta(metrics, item.placement, resizeDelta)
				: moveDelta
					? placementWithMoveDelta(item.placement, moveDelta)
					: item.placement,
		}));
	const activePlacement =
		moveDrag?.preview ??
		resizeDrag?.preview ??
		externalMoveDrag?.placement ??
		(activeCell ? toRequiredLayoutPlacement(activeCell.placement) : null);
	const activeBounds = activePlacement
		? placementBounds(metrics, activePlacement)
		: null;
	const selectedPreviewCells = [
		...(activeChildId && activePlacement
			? [{ childNodeId: activeChildId, placement: activePlacement }]
			: []),
		...passiveSelectedCells,
	];
	const conflictingSelectedCellIds =
		conflictingLayoutCellIds(selectedPreviewCells);
	const activeCellConflicted =
		activeChildId !== undefined &&
		conflictingSelectedCellIds.has(activeChildId);
	const handleSize = 12 / Math.max(0.01, scale);
	const handleHalf = handleSize / 2;
	const commitResizePlacement = (
		event: ReactPointerEvent<Element>,
		placement: RequiredLayoutCellSpanPlacement,
		drag: LayoutSpanResizeDrag,
	): void => {
		event.preventDefault();
		event.stopPropagation();
		if (!selectedChildId || !selectedCell) return;
		const basePlacement = toRequiredLayoutPlacement(selectedCell.placement);
		if (sameRequiredLayoutPlacement(placement, basePlacement)) {
			return;
		}
		const delta = resizeDeltaForPlacement(
			basePlacement,
			placement,
			drag.handle,
		);
		if (drag.selectedBases.length > 1) {
			useSceneStore.getState().apply(
				createSetLayoutChildrenPlacementsCommand({
					frameNodeId: frame.id,
					placements: drag.selectedBases.map((item) => ({
						childNodeId: item.childNodeId,
						placement: {
							...placementWithResizeDelta(metrics, item.placement, delta),
							...(item.fit ? { fit: item.fit } : {}),
						},
					})),
				}),
			);
			return;
		}
		useSceneStore.getState().apply(
			createSetLayoutChildPlacementCommand({
				frameNodeId: frame.id,
				childNodeId: selectedChildId,
				placement: {
					...placement,
					...(selectedCell?.placement.fit
						? { fit: selectedCell.placement.fit }
						: {}),
				},
			}),
		);
	};
	const commitMovePlacement = (
		event: ReactPointerEvent<Element>,
		placement: RequiredLayoutCellSpanPlacement,
	): void => {
		event.preventDefault();
		event.stopPropagation();
		if (!selectedChildId || !selectedCell) return;
		applyLayoutMovePlacementCommit({
			frameId: frame.id,
			selectedChildId,
			selectedCellPlacement: selectedCell.placement,
			selectedCellBases,
			placement,
		});
	};
	const nextResizeDrag = (
		event: ReactPointerEvent<Element>,
		drag: LayoutSpanResizeDrag,
	): LayoutSpanResizeDrag | null => {
		const group = groupRef.current;
		if (!group) return null;
		const point = localPointForPointer(group, event);
		if (!point) return null;
		const rawPreview = placementForResizePoint(
			metrics,
			drag.base,
			drag.handle,
			point,
		);
		const delta = clampLayoutResizeDeltaForSelectedGroup(
			metrics,
			layout.allowOverlap ? [] : drag.selectedBases,
			resizeDeltaForPlacement(drag.base, rawPreview, drag.handle),
		);
		return {
			...drag,
			preview: placementWithResizeDelta(metrics, drag.base, delta),
		};
	};
	const nextMoveDrag = (
		event: ReactPointerEvent<Element>,
		drag: LayoutCellMoveDrag,
	): LayoutCellMoveDrag | null => {
		const group = groupRef.current;
		if (!group) return null;
		const point = localPointForPointer(group, event);
		if (!point) return null;
		const preview = placementForMovePoint(
			metrics,
			drag.base,
			point,
			drag.offset,
		);
		const delta = clampLayoutMoveDelta(
			metrics,
			drag.selectedBases.map((item) => item.placement),
			moveDeltaForPlacement(drag.base, preview),
		);
		return {
			...drag,
			preview: placementWithMoveDelta(drag.base, delta),
		};
	};
	const updateMoveDrag = (
		event: ReactPointerEvent<Element>,
		drag: LayoutCellMoveDrag,
	): void => {
		const next = nextMoveDrag(event, drag);
		if (next) setMoveDrag(next);
	};
	const beginMoveDrag = (event: ReactPointerEvent<SVGRectElement>): void => {
		if (!activePlacement || !activeBounds) return;
		const group = groupRef.current;
		if (!group) return;
		const point = localPointForPointer(group, event);
		if (!point) return;
		event.preventDefault();
		event.stopPropagation();
		try {
			event.currentTarget.setPointerCapture(event.pointerId);
		} catch {}
		setResizeDrag(null);
		const drag = {
			base: activePlacement,
			preview: activePlacement,
			offset: {
				x: point.x - activeBounds.x,
				y: point.y - activeBounds.y,
			},
			selectedBases: selectedCellBases,
		} satisfies LayoutCellMoveDrag;
		setMoveDrag(drag);
		updateMoveDrag(event, drag);
	};
	const handleMoveDrag = (event: ReactPointerEvent<Element>): void => {
		if (!moveDrag) return;
		event.preventDefault();
		event.stopPropagation();
		updateMoveDrag(event, moveDrag);
	};
	const endMoveDrag = (event: ReactPointerEvent<Element>): void => {
		if (!moveDrag) return;
		commitMovePlacement(
			event,
			(nextMoveDrag(event, moveDrag) ?? moveDrag).preview,
		);
		setMoveDrag(null);
	};
	const cancelMoveDrag = (event: ReactPointerEvent<Element>): void => {
		if (!moveDrag) return;
		event.preventDefault();
		event.stopPropagation();
		setMoveDrag(null);
	};
	const updateResizeDrag = (
		event: ReactPointerEvent<Element>,
		drag: LayoutSpanResizeDrag,
	): void => {
		const next = nextResizeDrag(event, drag);
		if (next) setResizeDrag(next);
	};
	const beginResizeDrag = (
		handle: LayoutSpanResizeHandle,
		event: ReactPointerEvent<SVGRectElement>,
	): void => {
		if (!activePlacement) return;
		event.preventDefault();
		event.stopPropagation();
		try {
			event.currentTarget.setPointerCapture(event.pointerId);
		} catch {}
		setMoveDrag(null);
		const drag = {
			handle,
			base: activePlacement,
			preview: activePlacement,
			selectedBases: selectedCellBases,
		} satisfies LayoutSpanResizeDrag;
		setResizeDrag(drag);
		updateResizeDrag(event, drag);
	};
	const handleResizeMove = (event: ReactPointerEvent<Element>): void => {
		if (!resizeDrag) return;
		event.preventDefault();
		event.stopPropagation();
		updateResizeDrag(event, resizeDrag);
	};
	const endResizeDrag = (event: ReactPointerEvent<Element>): void => {
		if (!resizeDrag) return;
		const next = nextResizeDrag(event, resizeDrag) ?? resizeDrag;
		commitResizePlacement(event, next.preview, next);
		setResizeDrag(null);
	};
	const cancelResizeDrag = (event: ReactPointerEvent<Element>): void => {
		if (!resizeDrag) return;
		event.preventDefault();
		event.stopPropagation();
		setResizeDrag(null);
	};

	return (
		<g ref={groupRef} transform={matrixToSvg(matrix)}>
			<rect
				x={bounds.x}
				y={bounds.y}
				width={bounds.width}
				height={bounds.height}
				fill="none"
				stroke="#2ec4b6"
				strokeOpacity="0.9"
				strokeWidth="2"
				vectorEffect="non-scaling-stroke"
				pointerEvents="none"
			/>
			<rect
				x={contentX}
				y={contentY}
				width={Math.max(
					0,
					bounds.width - layout.padding.left - layout.padding.right,
				)}
				height={Math.max(
					0,
					bounds.height - layout.padding.top - layout.padding.bottom,
				)}
				fill="none"
				stroke="#2ec4b6"
				strokeDasharray="5 5"
				strokeOpacity="0.45"
				strokeWidth="1.5"
				vectorEffect="non-scaling-stroke"
				pointerEvents="none"
			/>
			{cells.map(({ column, row }) => (
				<rect
					key={`${frame.id}-cell-${column}-${row}`}
					x={contentX + column * (columnWidth + layout.gap.x)}
					y={contentY + row * (rowHeight + layout.gap.y)}
					width={Math.max(0, columnWidth)}
					height={Math.max(0, rowHeight)}
					fill="none"
					stroke="#2ec4b6"
					strokeOpacity="0.25"
					strokeWidth="1"
					vectorEffect="non-scaling-stroke"
					pointerEvents="none"
				/>
			))}
			{passiveSelectedCells.map((cell) => {
				const bounds = placementBounds(metrics, cell.placement);
				const conflicted = conflictingSelectedCellIds.has(cell.childNodeId);
				return (
					<rect
						key={`${frame.id}-selected-cell-${cell.childNodeId}`}
						x={bounds.x}
						y={bounds.y}
						width={bounds.width}
						height={bounds.height}
						fill={conflicted ? "#f59e0b" : "#2ec4b6"}
						fillOpacity={conflicted ? "0.1" : "0.06"}
						stroke={conflicted ? "#f59e0b" : "#2ec4b6"}
						strokeOpacity={conflicted ? "0.8" : "0.45"}
						strokeWidth="1.5"
						vectorEffect="non-scaling-stroke"
						pointerEvents="none"
					/>
				);
			})}
			{activeBounds ? (
				<rect
					x={activeBounds.x}
					y={activeBounds.y}
					width={activeBounds.width}
					height={activeBounds.height}
					fill={activeCellConflicted ? "#f59e0b" : "#2ec4b6"}
					fillOpacity={activeCellConflicted ? "0.14" : "0.12"}
					stroke={activeCellConflicted ? "#f59e0b" : "#2ec4b6"}
					strokeOpacity={activeCellConflicted ? "0.95" : "0.85"}
					strokeWidth="2"
					vectorEffect="non-scaling-stroke"
					cursor={selectedChildId ? "move" : undefined}
					pointerEvents={selectedChildId ? "all" : "none"}
					onPointerDown={selectedChildId ? beginMoveDrag : undefined}
					onPointerMove={selectedChildId ? handleMoveDrag : undefined}
					onPointerUp={selectedChildId ? endMoveDrag : undefined}
					onPointerCancel={selectedChildId ? cancelMoveDrag : undefined}
					onLostPointerCapture={selectedChildId ? cancelMoveDrag : undefined}
				/>
			) : null}
			{activeBounds && selectedChildId ? (
				<g>
					{LAYOUT_SPAN_RESIZE_HANDLES.map((handle: LayoutSpanResizeHandle) => {
						const point = layoutSpanHandlePoint(activeBounds, handle);
						return (
							<rect
								key={handle.id}
								x={point.x - handleHalf}
								y={point.y - handleHalf}
								width={handleSize}
								height={handleSize}
								rx={2 / Math.max(0.01, scale)}
								fill={
									handle.horizontal && handle.vertical ? "#2ec4b6" : "#f7f4eb"
								}
								stroke="#191817"
								strokeWidth="1.5"
								vectorEffect="non-scaling-stroke"
								cursor={handle.cursor}
								pointerEvents="all"
								onPointerDown={(event) => beginResizeDrag(handle, event)}
								onPointerMove={handleResizeMove}
								onPointerUp={endResizeDrag}
								onPointerCancel={cancelResizeDrag}
								onLostPointerCapture={cancelResizeDrag}
							/>
						);
					})}
				</g>
			) : null}
		</g>
	);
}
