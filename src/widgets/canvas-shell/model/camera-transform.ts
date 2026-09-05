import type { Camera } from "@/features/viewport/model/camera";

/** Radians → degrees, for SVG `rotate()` (which takes degrees, not radians). */
export const rotationDegrees = (radians: number): number =>
	(radians * 180) / Math.PI;

/**
 * SVG `transform` string projecting world/pasteboard coordinates into the
 * on-screen canvas view for a camera: pan, then rotate (degrees), then zoom.
 * Shared by the canvas world group and the frame-look defs, which must render in
 * the same projected space, so it lives here rather than inline in either.
 */
export const cameraTransformValue = (
	camera: Pick<Camera, "panX" | "panY" | "rotation" | "zoom">,
): string =>
	`translate(${camera.panX} ${camera.panY}) rotate(${rotationDegrees(camera.rotation ?? 0)}) scale(${camera.zoom / 100})`;
