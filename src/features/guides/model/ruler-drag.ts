import {
	type GuideLine,
	guideLineFromDrag,
} from "@/entities/guides/model/snapping";
import type { SceneDocument } from "@/entities/scene/model/types";
import {
	type SnapAxis,
	type SnapPoint,
	type SnapProjection,
	unprojectPoint,
} from "@/shared/lib/snapping";

export type RulerDragAxis = SnapAxis;

export type RulerDragScreenPoint = {
	readonly x: number;
	readonly y: number;
};

export type RulerDragProjection = SnapProjection | number;

const projectionFrom = (projection: RulerDragProjection): SnapProjection =>
	typeof projection === "number"
		? { zoom: projection, pan: { x: 0, y: 0 } }
		: projection;

/**
 * Identifies which ruler starts a guide drag from screen-space overlay
 * coordinates. The top ruler creates vertical x-guides; the left ruler creates
 * horizontal y-guides. The shared corner is intentionally inert so the user does
 * not accidentally create a guide while targeting the ruler origin.
 */
export function rulerDragAxisFromPoint(
	point: RulerDragScreenPoint,
	rulerSizePx: number,
): RulerDragAxis | null {
	const inTopRuler = point.y >= 0 && point.y <= rulerSizePx;
	const inLeftRuler = point.x >= 0 && point.x <= rulerSizePx;
	if (inTopRuler && inLeftRuler) return null;
	if (inTopRuler) return "x";
	if (inLeftRuler) return "y";
	return null;
}

export function workspacePointFromOverlay(
	point: RulerDragScreenPoint,
	projection: RulerDragProjection,
): SnapPoint {
	return unprojectPoint(point, projectionFrom(projection));
}

/** Backward-compatible alias for legacy artboard-local ruler tests. */
export const artboardPointFromOverlay = workspacePointFromOverlay;

/**
 * Resolves the persisted guide represented by the current ruler drag. New
 * workspace rulers pass `coordinateSpace: "pasteboard"` so the resulting guide
 * is independent of the active artboard; omitted space keeps old artboard-local
 * guide data readable.
 */
export function guideLineForRulerDrag(input: {
	readonly id: string;
	readonly axis: RulerDragAxis;
	readonly point: RulerDragScreenPoint;
	readonly projection?: RulerDragProjection;
	readonly zoom?: number;
	readonly document: SceneDocument;
	readonly coordinateSpace?: GuideLine["coordinateSpace"];
	readonly artboardId?: string;
}): GuideLine | null {
	const projection = input.projection ?? input.zoom ?? 1;
	return guideLineFromDrag(
		input.id,
		input.axis,
		workspacePointFromOverlay(input.point, projection),
		input.document,
		{
			coordinateSpace: input.coordinateSpace,
			artboardId: input.artboardId,
		},
	);
}
