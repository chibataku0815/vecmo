import {
	clampNumber,
	screenToWorld as kernelScreenToWorld,
	worldToScreen as kernelWorldToScreen,
	transformCameraAtPoint,
	zoomCameraAtPoint,
} from "@motion-surface/editor-kernel";

/**
 * The editor camera: the single pure screen<->world transform shared by the
 * renderer, hit-testing, viewport culling, zoom-to-cursor, and viewport fitting.
 *
 * The mapping is `screen = rotate(world, rotation) * scale + pan`, where
 * `scale = zoom / 100` and `pan` is the screen-pixel position of world origin
 * `(0, 0)`. Screen pixels are measured from the canvas viewport's top-left
 * corner.
 *
 * The defining property of an infinite canvas lives here: **the camera is
 * independent of the artboard set.** Adding, moving, or deleting an artboard
 * never changes `{zoom, panX, panY}`, so the view stays exactly where the user
 * left it instead of reflowing around the artboard union. That is what makes the
 * desk feel like an unbounded plane rather than a single framed stage — the
 * earlier union-centred projection re-derived pan from the union bounding box,
 * so any change to the set shifted the whole view.
 */

/** Lowest zoom percentage — far enough out to survey a sprawling multi-artboard desk. */
export const MIN_ZOOM = 2;
/** Highest zoom percentage — close enough in for sub-pixel vector authoring. */
export const MAX_ZOOM = 6400;

/**
 * Geometric zoom factor for one discrete step (a wheel notch, a `+`/`-` key, a
 * toolbar button). Zoom is multiplicative, not additive: one step is the same
 * perceptual change at 4% as at 4000%. An additive step that feels right near
 * 100% is invisible at 4000% and violent at 4%.
 */
export const ZOOM_STEP_FACTOR = 1.2;

// Wheel -> zoom feel knobs. Trackpad pinch (`ctrlKey`) deltas are finer-grained
// and more frequent than mouse-wheel notches, so pinch gets the higher
// sensitivity. These constants are the main tuning surface for browser smoke.
const ZOOM_SENS_PINCH = 0.0075;
const ZOOM_SENS_WHEEL = 0.002;
// Clamp one event's zoom contribution so a single coarse mouse notch cannot
// lurch the camera. Pan is intentionally unclamped below.
const MAX_WHEEL_DELTA_PX = 24;
const LINE_HEIGHT_PX = 16;
const PAGE_HEIGHT_PX = 100;

export type Camera = {
	readonly zoom: number;
	readonly panX: number;
	readonly panY: number;
	readonly rotation?: number;
};

export type CameraPoint = {
	readonly x: number;
	readonly y: number;
};

export const clampZoom = (zoom: number): number =>
	clampNumber(zoom, MIN_ZOOM, MAX_ZOOM);

/** Normalizes a wheel delta to CSS pixels regardless of `deltaMode`. */
const toPixels = (delta: number, deltaMode: number): number =>
	deltaMode === 1
		? delta * LINE_HEIGHT_PX
		: deltaMode === 2
			? delta * PAGE_HEIGHT_PX
			: delta;

const normalizeWheelDelta = (deltaY: number, deltaMode: number): number => {
	const pixels = toPixels(deltaY, deltaMode);
	return Math.sign(pixels) * Math.min(MAX_WHEEL_DELTA_PX, Math.abs(pixels));
};

/**
 * Maps a wheel tick to a multiplicative zoom factor. `deltaY < 0` yields a
 * factor above 1, so scroll-up / pinch-open zooms in.
 */
export const wheelDeltaToFactor = (
	deltaY: number,
	deltaMode: number,
	pinch: boolean,
): number => {
	const delta = normalizeWheelDelta(deltaY, deltaMode);
	const sensitivity = pinch ? ZOOM_SENS_PINCH : ZOOM_SENS_WHEEL;
	return Math.exp(-delta * sensitivity);
};

export type WheelPanDelta = {
	readonly dx: number;
	readonly dy: number;
};

/**
 * Maps a non-zoom wheel tick to a pan delta in screen pixels. The sign is
 * negated so content follows natural scrolling.
 */
export const wheelDeltaToPan = (
	deltaX: number,
	deltaY: number,
	deltaMode: number,
): WheelPanDelta => ({
	dx: -toPixels(deltaX, deltaMode),
	dy: -toPixels(deltaY, deltaMode),
});

/** World point -> screen pixel (relative to the canvas viewport top-left). */
export function worldToScreen(camera: Camera, world: CameraPoint): CameraPoint {
	return kernelWorldToScreen(camera, world);
}

/** Screen pixel (relative to the canvas viewport top-left) -> world point. */
export function screenToWorld(
	camera: Camera,
	screen: CameraPoint,
): CameraPoint {
	return kernelScreenToWorld(camera, screen);
}

/**
 * Changes zoom and rotation while pinning the world point under `anchor`.
 * This is the two-finger pinch/rotate primitive; it keeps hit testing,
 * renderers, and overlays on the same camera contract.
 */
export function transformAtPoint(
	camera: Camera,
	nextZoom: number,
	nextRotation: number,
	anchor: CameraPoint,
): Camera {
	return transformCameraAtPoint(camera, nextZoom, nextRotation, anchor, {
		minimum: MIN_ZOOM,
		maximum: MAX_ZOOM,
	});
}

/**
 * Zooms to `nextZoom` (clamped) while pinning the world point currently under
 * `anchor` (a screen pixel) to that same pixel. This is the math behind both
 * zoom-to-cursor (anchor = pointer) and centred keyboard/button zoom (anchor =
 * viewport centre); the caller picks the anchor. The invariant it guarantees is
 * `screenToWorld(before, anchor) === screenToWorld(after, anchor)`.
 */
export function zoomAtPoint(
	camera: Camera,
	nextZoom: number,
	anchor: CameraPoint,
): Camera {
	return zoomCameraAtPoint(camera, nextZoom, anchor, {
		minimum: MIN_ZOOM,
		maximum: MAX_ZOOM,
	});
}
