import {
	getNodeLocalBounds,
	type Matrix2D,
	matrixFromTransform,
} from "@/entities/scene/model/rendering";
import type { NormalizedArtboard } from "@/entities/scene/model/selectors";
import type { Bounds, Vec2, VectorNode } from "@/entities/scene/model/types";
import { type Camera, worldToScreen } from "@/features/viewport/model/camera";

export type CanvasQuickActionPlacement = "above" | "below";

export type CanvasQuickActionAnchor = {
	readonly left: number;
	readonly top: number;
	readonly placement: CanvasQuickActionPlacement;
};

export type QuickActionViewport = {
	readonly width: number;
	readonly height: number;
};

export type CanvasQuickActionAnchorOptions = {
	/** Floating surface height in screen pixels, used for flip/clamp math. */
	readonly heightPx?: number;
	/** Half of the floating surface width in screen pixels. */
	readonly halfWidthPx?: number;
	readonly gapPx?: number;
	readonly edgeMarginPx?: number;
	readonly topSafePx?: number;
};

export type CanvasContextActionGroupId =
	| "clipboard"
	| "structure"
	| "arrange"
	| "view"
	| "danger";

export type CanvasContextActionSlot = {
	readonly id: string;
	readonly actionId: string;
	readonly groupId: CanvasContextActionGroupId;
	readonly selectedObjectAction: boolean;
};

export type CanvasContextActionGroupsOptions = {
	readonly selectedNodeCount: number;
	readonly hasClipboardPayload: boolean;
};

/**
 * Canonical selected-object action order for canvas right-click menus and the
 * visible action strip. The entries point at ActionSurface registry ids so every
 * surface can share one availability and command-bus path instead of hand-coded
 * per-menu behavior.
 */
export const SELECTED_OBJECT_CONTEXT_ACTION_SLOTS = [
	{
		id: "duplicate",
		actionId: "workflow.duplicate",
		groupId: "clipboard",
		selectedObjectAction: true,
	},
	{
		id: "paste-in-place",
		actionId: "edit.paste-in-place",
		groupId: "clipboard",
		selectedObjectAction: true,
	},
	{
		id: "paste-over-selection",
		actionId: "edit.paste-over-selection",
		groupId: "clipboard",
		selectedObjectAction: true,
	},
	{
		id: "group",
		actionId: "workflow.group",
		groupId: "structure",
		selectedObjectAction: true,
	},
	{
		id: "ungroup",
		actionId: "workflow.ungroup",
		groupId: "structure",
		selectedObjectAction: true,
	},
	{
		id: "frame-selection",
		actionId: "structure.frame-selection",
		groupId: "structure",
		selectedObjectAction: true,
	},
	{
		id: "unframe-selection",
		actionId: "structure.unframe-selection",
		groupId: "structure",
		selectedObjectAction: true,
	},
	{
		id: "use-as-mask",
		actionId: "structure.use-as-mask",
		groupId: "structure",
		selectedObjectAction: true,
	},
	{
		id: "release-mask",
		actionId: "structure.release-mask",
		groupId: "structure",
		selectedObjectAction: true,
	},
	{
		id: "bring-forward",
		actionId: "arrange.z-order.forward",
		groupId: "arrange",
		selectedObjectAction: true,
	},
	{
		id: "send-backward",
		actionId: "arrange.z-order.backward",
		groupId: "arrange",
		selectedObjectAction: true,
	},
	{
		id: "toggle-lock",
		actionId: "layer.toggle-lock",
		groupId: "structure",
		selectedObjectAction: true,
	},
	{
		id: "toggle-hide",
		actionId: "layer.toggle-hide",
		groupId: "structure",
		selectedObjectAction: true,
	},
	{
		id: "focus-artboard",
		actionId: "selected.focus-artboard",
		groupId: "view",
		selectedObjectAction: true,
	},
	{
		id: "reset-bounding-box",
		actionId: "transform.reset-bounding-box",
		groupId: "arrange",
		selectedObjectAction: true,
	},
	{
		id: "delete",
		actionId: "workflow.delete",
		groupId: "danger",
		selectedObjectAction: true,
	},
] as const satisfies readonly CanvasContextActionSlot[];

/** Filters selected-object canvas action slots by state known before registry availability runs. */
export function selectedObjectContextActionSlots(
	options: CanvasContextActionGroupsOptions,
): readonly CanvasContextActionSlot[] {
	if (options.selectedNodeCount <= 0) return [];
	return SELECTED_OBJECT_CONTEXT_ACTION_SLOTS.filter((slot) => {
		if (
			slot.actionId === "edit.paste-in-place" ||
			slot.actionId === "edit.paste-over-selection"
		) {
			return options.hasClipboardPayload;
		}
		return true;
	});
}

const transformPoint = (point: Vec2, matrix: Matrix2D): Vec2 => ({
	x: matrix.a * point.x + matrix.c * point.y + matrix.e,
	y: matrix.b * point.x + matrix.d * point.y + matrix.f,
});

const nodePasteboardCorners = (
	node: VectorNode,
	artboard: NormalizedArtboard,
): readonly Vec2[] => {
	// Group containers carry a degenerate own-geometry (their extent lives in
	// `children`), so anchor math must use the group-aware local bounds — the
	// same source the SelectionOverlay draws from — or floating chrome pins to
	// the group's creation-time origin point instead of its visual box.
	const bounds = getNodeLocalBounds(node);
	const matrix = matrixFromTransform(node.transform);
	const corners = [
		{ x: bounds.x, y: bounds.y },
		{ x: bounds.x + bounds.width, y: bounds.y },
		{ x: bounds.x, y: bounds.y + bounds.height },
		{ x: bounds.x + bounds.width, y: bounds.y + bounds.height },
	] as const;

	return corners.map((corner) => {
		const transformed = transformPoint(corner, matrix);
		return {
			x: artboard.position.x + transformed.x,
			y: artboard.position.y + transformed.y,
		};
	});
};

const boundsFromPoints = (points: readonly Vec2[]): Bounds | null => {
	if (points.length === 0) return null;
	const xs = points.map((point) => point.x);
	const ys = points.map((point) => point.y);
	const minX = Math.min(...xs);
	const maxX = Math.max(...xs);
	const minY = Math.min(...ys);
	const maxY = Math.max(...ys);
	return {
		x: minX,
		y: minY,
		width: Math.max(0, maxX - minX),
		height: Math.max(0, maxY - minY),
	};
};

/**
 * Computes the pasteboard-space bounds of selected nodes across artboards.
 * Canvas tools receive artboard-local points, while the contextual toolbar is
 * positioned in the pasteboard HTML overlay; this is the explicit bridge
 * between those coordinate spaces.
 */
export function selectedNodePasteboardBounds(
	nodes: readonly VectorNode[],
	artboards: readonly NormalizedArtboard[],
	nodeArtboardIds: Readonly<Record<string, string>>,
): Bounds | null {
	const corners = nodes.flatMap((node) => {
		const artboardId = nodeArtboardIds[node.id];
		const artboard = artboards.find((item) => item.id === artboardId);
		return artboard ? nodePasteboardCorners(node, artboard) : [];
	});
	return boundsFromPoints(corners);
}

/**
 * Pixel geometry of the floating quick-action bar, used to keep it fully
 * on-screen when the selection is near a viewport edge or huge at deep zoom.
 * Half-width is a conservative estimate for the small (2–3 icon) bar.
 */
const QUICK_ACTION_BAR_HEIGHT_PX = 36;
const QUICK_ACTION_BAR_HALF_WIDTH_PX = 64;
const QUICK_ACTION_BAR_GAP_PX = 12;
const QUICK_ACTION_EDGE_MARGIN_PX = 8;
/** Top band reserved for the floating top-bar chrome (ruler + top-bar row). */
const QUICK_ACTION_TOP_SAFE_PX = 72;

const clampRange = (value: number, min: number, max: number): number =>
	max < min ? min : Math.min(Math.max(value, min), max);

/**
 * Converts pasteboard selection bounds into an HTML overlay anchor for floating
 * quick-action/tool chrome in screen pixels (relative to the canvas viewport
 * top-left), via the same `screen = world * scale + pan` transform the renderer
 * applies.
 *
 * Without a viewport the bar sits above the selection's top edge (legacy
 * behaviour). With a viewport it is kept fully visible: it flips BELOW the
 * selection when sitting above would collide with the top chrome band, and its
 * centre is clamped on both axes so a selection near an edge — or one larger
 * than the viewport at extreme zoom — pins the bar to a visible edge instead of
 * scrolling off-screen.
 */
export function quickActionAnchorForSelection(
	bounds: Bounds,
	camera: Camera,
	viewport?: QuickActionViewport,
	options: CanvasQuickActionAnchorOptions = {},
): CanvasQuickActionAnchor {
	const heightPx = options.heightPx ?? QUICK_ACTION_BAR_HEIGHT_PX;
	const halfWidthPx = options.halfWidthPx ?? QUICK_ACTION_BAR_HALF_WIDTH_PX;
	const gapPx = options.gapPx ?? QUICK_ACTION_BAR_GAP_PX;
	const edgeMarginPx = options.edgeMarginPx ?? QUICK_ACTION_EDGE_MARGIN_PX;
	const topSafePx = options.topSafePx ?? QUICK_ACTION_TOP_SAFE_PX;
	const centerX = bounds.x + bounds.width / 2;
	const topCenter = worldToScreen(camera, { x: centerX, y: bounds.y });
	if (!viewport || viewport.width <= 0 || viewport.height <= 0) {
		return { left: topCenter.x, top: topCenter.y, placement: "above" };
	}
	const bottomCenter = worldToScreen(camera, {
		x: centerX,
		y: bounds.y + bounds.height,
	});
	const aboveBarTop = topCenter.y - gapPx - heightPx;
	const placement: CanvasQuickActionPlacement =
		aboveBarTop < topSafePx ? "below" : "above";
	const left = clampRange(
		topCenter.x,
		halfWidthPx + edgeMarginPx,
		viewport.width - halfWidthPx - edgeMarginPx,
	);
	const top =
		placement === "above"
			? clampRange(
					topCenter.y,
					topSafePx + gapPx + heightPx,
					viewport.height - edgeMarginPx,
				)
			: clampRange(
					bottomCenter.y,
					topSafePx,
					viewport.height - edgeMarginPx - gapPx - heightPx,
				);
	return { left, top, placement };
}
