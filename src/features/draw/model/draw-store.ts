import { create } from "zustand";
import type { Vec2 } from "@/entities/scene/model/types";
import type { FreehandPoint } from "./freehand";
import type { PenAnchor } from "./pen";
import type { ShapeKind } from "./shape";

/** In-flight shape drag, mirrored to the overlay for a live dashed preview. */
export type ShapeDragPreview = {
	readonly kind: ShapeKind;
	readonly start: Vec2;
	readonly current: Vec2;
	readonly constrain: boolean;
	readonly fromCenter: boolean;
};

type DrawState = {
	readonly penAnchors: readonly PenAnchor[];
	readonly penCursor: Vec2 | null;
	readonly shapeKind: ShapeKind;
	readonly shapeDrag: ShapeDragPreview | null;
	/**
	 * Raw artboard-local samples for the in-progress pencil stroke, each with an
	 * optional pen pressure reading. The overlay draws them as a live polyline;
	 * the handler smooths them into a path (and, for pen input, derives a
	 * stroke width profile from the pressure) on pointerup. Empty whenever no
	 * stroke is being drawn.
	 */
	readonly freehandPoints: readonly FreehandPoint[];
	/**
	 * OS-predicted continuation of the in-progress pencil stroke (from
	 * `PointerEvent.getPredictedEvents`), rendered by the same overlay with the
	 * same stroke style to mask input latency. Never committed — cleared on
	 * every move/commit/cancel — so a misprediction never reaches scene
	 * geometry. Empty when no stroke is in flight or the device/browser does
	 * not report predictions.
	 */
	readonly predictedTail: readonly Vec2[];
	readonly appendAnchor: (anchor: PenAnchor) => void;
	readonly updateLastAnchor: (anchor: PenAnchor) => void;
	readonly setPenCursor: (cursor: Vec2 | null) => void;
	readonly resetPen: () => void;
	readonly setShapeKind: (kind: ShapeKind) => void;
	readonly setShapeDrag: (drag: ShapeDragPreview | null) => void;
	readonly appendFreehandPoint: (point: FreehandPoint) => void;
	readonly setPredictedTail: (points: readonly Vec2[]) => void;
	readonly resetFreehand: () => void;
};

/**
 * Feature-local store for transient draw previews the overlay renders: the
 * in-progress pen path and the live shape drag box. Committed geometry lives in
 * the scene store, not here — this holds only gesture-scoped state that is
 * cleared when a node is committed or the gesture is abandoned.
 */
export const useDrawStore = create<DrawState>()((set) => ({
	penAnchors: [],
	penCursor: null,
	shapeKind: "rect",
	shapeDrag: null,
	freehandPoints: [],
	predictedTail: [],
	appendAnchor: (anchor) =>
		set((state) => ({ penAnchors: [...state.penAnchors, anchor] })),
	updateLastAnchor: (anchor) =>
		set((state) =>
			state.penAnchors.length === 0
				? state
				: { penAnchors: [...state.penAnchors.slice(0, -1), anchor] },
		),
	setPenCursor: (penCursor) => set({ penCursor }),
	resetPen: () => set({ penAnchors: [], penCursor: null }),
	setShapeKind: (shapeKind) => set({ shapeKind }),
	setShapeDrag: (shapeDrag) => set({ shapeDrag }),
	appendFreehandPoint: (point) =>
		set((state) => ({ freehandPoints: [...state.freehandPoints, point] })),
	setPredictedTail: (predictedTail) => set({ predictedTail }),
	resetFreehand: () => set({ freehandPoints: [], predictedTail: [] }),
}));
