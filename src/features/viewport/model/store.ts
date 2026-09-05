import { create } from "zustand";
import {
	type Camera,
	type CameraPoint,
	clampZoom,
	transformAtPoint,
	ZOOM_STEP_FACTOR,
	zoomAtPoint,
} from "./camera";

export type ViewportTransform = {
	readonly zoom: number;
	readonly panX: number;
	readonly panY: number;
	readonly rotation?: number;
};

type ViewportStore = ViewportTransform & {
	readonly rotation: number;
	/** Measured pixel size of the canvas viewport; anchors centred zoom. */
	readonly viewportWidth: number;
	readonly viewportHeight: number;
	readonly setViewportSize: (width: number, height: number) => void;
	readonly setZoom: (zoom: number) => void;
	readonly setPan: (panX: number, panY: number) => void;
	readonly setRotation: (rotation: number) => void;
	readonly panBy: (deltaX: number, deltaY: number) => void;
	/** Zoom to an absolute level, pinning the world point under a screen anchor. */
	readonly zoomToAt: (
		nextZoom: number,
		anchorX: number,
		anchorY: number,
	) => void;
	/** Zooms and rotates while pinning the world point under a screen anchor. */
	readonly transformToAt: (
		nextZoom: number,
		nextRotation: number,
		anchorX: number,
		anchorY: number,
	) => void;
	/** One geometric step in/out around an anchor (defaults to viewport centre). */
	readonly zoomStepIn: (anchorX?: number, anchorY?: number) => void;
	readonly zoomStepOut: (anchorX?: number, anchorY?: number) => void;
	/** Jump to 100% around the viewport centre. */
	readonly zoomToActualSize: () => void;
	readonly resetViewport: () => void;
};

const DEFAULT_ZOOM = 50;

const cameraOf = (state: ViewportTransform): Camera => ({
	zoom: state.zoom,
	panX: state.panX,
	panY: state.panY,
	rotation: state.rotation,
});

const centreAnchor = (
	state: Pick<ViewportStore, "viewportWidth" | "viewportHeight">,
	anchorX: number | undefined,
	anchorY: number | undefined,
): CameraPoint =>
	anchorX === undefined || anchorY === undefined
		? { x: state.viewportWidth / 2, y: state.viewportHeight / 2 }
		: { x: anchorX, y: anchorY };

export const useViewportStore = create<ViewportStore>()((set) => ({
	zoom: DEFAULT_ZOOM,
	panX: 0,
	panY: 0,
	rotation: 0,
	viewportWidth: 0,
	viewportHeight: 0,
	setViewportSize: (viewportWidth, viewportHeight) =>
		set((state) =>
			state.viewportWidth === viewportWidth &&
			state.viewportHeight === viewportHeight
				? state
				: { viewportWidth, viewportHeight },
		),
	setZoom: (zoom) => set({ zoom: clampZoom(zoom) }),
	setPan: (panX, panY) => set({ panX, panY }),
	setRotation: (rotation) => set({ rotation }),
	panBy: (deltaX, deltaY) =>
		set((state) => ({
			panX: state.panX + deltaX,
			panY: state.panY + deltaY,
		})),
	zoomToAt: (nextZoom, anchorX, anchorY) =>
		set((state) =>
			zoomAtPoint(cameraOf(state), nextZoom, { x: anchorX, y: anchorY }),
		),
	transformToAt: (nextZoom, nextRotation, anchorX, anchorY) =>
		set((state) =>
			transformAtPoint(cameraOf(state), nextZoom, nextRotation, {
				x: anchorX,
				y: anchorY,
			}),
		),
	zoomStepIn: (anchorX, anchorY) =>
		set((state) =>
			zoomAtPoint(
				cameraOf(state),
				state.zoom * ZOOM_STEP_FACTOR,
				centreAnchor(state, anchorX, anchorY),
			),
		),
	zoomStepOut: (anchorX, anchorY) =>
		set((state) =>
			zoomAtPoint(
				cameraOf(state),
				state.zoom / ZOOM_STEP_FACTOR,
				centreAnchor(state, anchorX, anchorY),
			),
		),
	zoomToActualSize: () =>
		set((state) =>
			zoomAtPoint(cameraOf(state), 100, {
				x: state.viewportWidth / 2,
				y: state.viewportHeight / 2,
			}),
		),
	resetViewport: () =>
		set({ zoom: DEFAULT_ZOOM, panX: 0, panY: 0, rotation: 0 }),
}));
