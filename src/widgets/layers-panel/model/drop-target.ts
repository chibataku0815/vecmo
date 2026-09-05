import {
	computeInsertion,
	type ReparentTarget,
} from "@/entities/scene/model/reparent";
import type {
	ArtboardLayerPanelRow,
	LayerPanelLayerRow,
	LayerPanelNodeRow,
	LayerPanelRow,
} from "./rows";

/**
 * Pure, React-free drop-target resolution for layers-panel drag-and-drop. The
 * gesture itself is browser-verified (setPointerCapture throws on synthetic
 * pointer events), so every structural decision lives here where it is unit
 * tested. The component only feeds pointer Y + row metrics in and renders the
 * indicator the resolved target describes.
 */

/** Pointer travel (px) before a press becomes a drag — matches the repo's scrub idiom. */
export const DRAG_THRESHOLD_PX = 4;
/** Top/bottom fraction of a container row that reads as "between siblings" rather than "into". */
export const DROP_EDGE_FRACTION = 0.25;

export type DropPlacement = "before" | "after" | "inside";
export type DropRejectReason = "self" | "descendant" | "locked" | "noop";

/**
 * A resolved drop, carrying both the typed command destination and the data the
 * indicator needs. `valid` is false (with a `rejectReason`) when the drop is
 * illegal — the UI suppresses the indicator and refuses the commit. The same
 * guards are re-asserted inside the command: this resolver is UX, the command is
 * the trust boundary.
 */
export type DropTarget = ReparentTarget & {
	readonly kind: DropPlacement;
	/** The row the indicator decorates (the hovered row); `inside` also sets it as the highlight. */
	readonly anchorRowId: string;
	readonly indicatorDepth: number;
	readonly highlightRowId: string | null;
	readonly valid: boolean;
	readonly rejectReason?: DropRejectReason;
};

const CONTAINER_ROLE_IDS: ReadonlySet<string> = new Set(["group", "frame"]);

const INDENT_BASE_PX = 3;
const NODE_INDENT_STEP_PX = 8;
const LAYER_INDENT_STEP_PX = 6;

/**
 * The single indent formula shared by row padding AND the drop-line inset, so the
 * indicator can never disagree with where a row at that depth actually sits. Drops
 * target node positions, so the drop line always uses the node step.
 */
export const rowIndentPx = (kind: "node" | "layer", depth: number): number =>
	INDENT_BASE_PX +
	depth * (kind === "layer" ? LAYER_INDENT_STEP_PX : NODE_INDENT_STEP_PX);

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/** Whether a row can receive a node as a child (group/frame containers + layer headers). */
const rowAcceptsInside = (row: LayerPanelRow): boolean =>
	row.kind === "layer" || CONTAINER_ROLE_IDS.has(row.role.id);

/**
 * Maps the pointer's vertical position within a row to a placement. Containers
 * expose a middle "inside" band; a pure leaf only splits before/after so a drop
 * can never nest into something that cannot hold children.
 */
const placementFor = (row: LayerPanelRow, fraction: number): DropPlacement => {
	if (!rowAcceptsInside(row)) return fraction < 0.5 ? "before" : "after";
	if (fraction < DROP_EDGE_FRACTION) return "before";
	if (fraction > 1 - DROP_EDGE_FRACTION) return "after";
	return "inside";
};

type StructuralTarget = {
	readonly target: ReparentTarget;
	readonly kind: DropPlacement;
	readonly indicatorDepth: number;
	readonly highlightRowId: string | null;
};

/**
 * Turns a (row, placement) pair into the structural destination, independent of
 * legality. `inside` child count comes from the node's own `children` array, not
 * from counting visible child rows, so a COLLAPSED group (zero visible children,
 * non-empty array) still appends correctly.
 */
const structuralTarget = (
	row: LayerPanelRow,
	placement: DropPlacement,
): StructuralTarget => {
	if (row.kind === "layer") {
		// A node dropped on a layer header joins that layer's top level (appended).
		return {
			target: {
				targetParentNodeId: null,
				targetLayerId: row.layerId,
				toIndex: row.layer.nodes.length,
			},
			kind: "inside",
			indicatorDepth: row.depth + 1,
			highlightRowId: row.rowId,
		};
	}
	if (placement === "inside") {
		return {
			target: {
				targetParentNodeId: row.nodeId,
				targetLayerId: row.layerId,
				toIndex: row.node.children?.length ?? 0,
			},
			kind: "inside",
			indicatorDepth: row.depth + 1,
			highlightRowId: row.rowId,
		};
	}
	const parentId = row.parentIds.at(-1) ?? null;
	const gapIndex =
		placement === "before" ? row.siblingIndex : row.siblingIndex + 1;
	return {
		target: {
			targetParentNodeId: parentId,
			targetLayerId: row.layerId,
			toIndex: gapIndex,
		},
		kind: placement,
		indicatorDepth: row.depth,
		highlightRowId: null,
	};
};

const findNodeRow = (
	rows: readonly ArtboardLayerPanelRow[],
	nodeId: string,
): LayerPanelNodeRow | undefined =>
	rows.find(
		(row): row is LayerPanelNodeRow =>
			row.kind === "node" && row.nodeId === nodeId,
	);

const findContainerRow = (
	rows: readonly ArtboardLayerPanelRow[],
	target: ReparentTarget,
): LayerPanelNodeRow | LayerPanelLayerRow | undefined => {
	if (target.targetParentNodeId !== null) {
		return findNodeRow(rows, target.targetParentNodeId);
	}
	return rows.find(
		(row): row is LayerPanelLayerRow =>
			row.kind === "layer" && row.layerId === target.targetLayerId,
	);
};

/** Union of every dragged node's subtree ids (each `subtreeNodeIds` already includes the node itself). */
const collectDraggedSubtree = (
	rows: readonly ArtboardLayerPanelRow[],
	draggedSet: ReadonlySet<string>,
): ReadonlySet<string> => {
	const subtree = new Set<string>();
	for (const row of rows) {
		if (row.kind !== "node" || !draggedSet.has(row.nodeId)) continue;
		for (const id of row.subtreeNodeIds) subtree.add(id);
	}
	return subtree;
};

const checkLegality = (
	rows: readonly ArtboardLayerPanelRow[],
	draggedIds: readonly string[],
	target: ReparentTarget,
): { readonly valid: boolean; readonly rejectReason?: DropRejectReason } => {
	const draggedSet = new Set(draggedIds);

	// Precedence is load-bearing: first hit wins so the reason is specific.
	if (
		target.targetParentNodeId !== null &&
		draggedSet.has(target.targetParentNodeId)
	) {
		return { valid: false, rejectReason: "self" };
	}
	if (target.targetParentNodeId !== null) {
		const subtree = collectDraggedSubtree(rows, draggedSet);
		if (subtree.has(target.targetParentNodeId)) {
			return { valid: false, rejectReason: "descendant" };
		}
	}
	const containerRow = findContainerRow(rows, target);
	if (containerRow?.effectiveLocked) {
		return { valid: false, rejectReason: "locked" };
	}
	if (draggedIds.length === 1) {
		const sourceRow = findNodeRow(rows, draggedIds[0] ?? "");
		if (sourceRow && sourceRow.layerId === target.targetLayerId) {
			const sourceParentId = sourceRow.parentIds.at(-1) ?? null;
			const insertion = computeInsertion(
				sourceParentId,
				sourceRow.siblingIndex,
				target.targetParentNodeId,
				target.toIndex,
			);
			if (insertion.isNoop) return { valid: false, rejectReason: "noop" };
		}
	}
	return { valid: true };
};

/**
 * Resolves the drop the pointer currently describes, or null when the hovered
 * row cannot host one (artboard header, zero-height row). The returned target's
 * `valid`/`rejectReason` carry legality; the UI renders the indicator only when
 * valid and commits the matching reparent command on release.
 */
export function resolveDropTarget(
	rows: readonly ArtboardLayerPanelRow[],
	hoveredRow: ArtboardLayerPanelRow,
	geometry: { readonly top: number; readonly height: number },
	pointerY: number,
	draggedIds: readonly string[],
): DropTarget | null {
	if (hoveredRow.kind === "artboard" || geometry.height <= 0) return null;
	const fraction = clamp01((pointerY - geometry.top) / geometry.height);
	const placement = placementFor(hoveredRow, fraction);
	const structural = structuralTarget(hoveredRow, placement);
	const legality = checkLegality(rows, draggedIds, structural.target);
	return {
		...structural.target,
		kind: structural.kind,
		anchorRowId: hoveredRow.rowId,
		indicatorDepth: structural.indicatorDepth,
		highlightRowId: structural.highlightRowId,
		valid: legality.valid,
		rejectReason: legality.rejectReason,
	};
}

/**
 * Filters a dragged id set down to the roots that should actually move: a node
 * whose ancestor is also dragged rides inside that ancestor, so dropping it
 * again would double-move it. Returns ids in document (row) order. This mirrors
 * the command's in-draft de-descendant pass (defense in depth).
 */
export function normalizeDragSet(
	rows: readonly ArtboardLayerPanelRow[],
	draggedIds: ReadonlySet<string>,
): readonly string[] {
	const roots: string[] = [];
	for (const row of rows) {
		if (row.kind !== "node" || !draggedIds.has(row.nodeId)) continue;
		if (row.parentIds.some((parentId) => draggedIds.has(parentId))) continue;
		roots.push(row.nodeId);
	}
	return roots;
}
