import {
	fitBounds,
	normalizeBounds,
	unionBounds,
} from "@motion-surface/editor-kernel";
import { MAX_ZOOM, MIN_ZOOM } from "./camera";
import type { ViewportTransform } from "./store";

export type ViewportFitSize = {
	readonly width: number;
	readonly height: number;
};

export type ViewportFitPoint = {
	readonly x: number;
	readonly y: number;
};

export type ViewportFitBounds = ViewportFitPoint & ViewportFitSize;

export type ViewportFitTarget = {
	readonly bounds: ViewportFitBounds;
	readonly center: ViewportFitPoint;
};

export type ViewportFitResult = ViewportTransform & {
	readonly target: ViewportFitTarget;
};

export type ViewportFitInsets = {
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
	readonly left: number;
};

export type ViewportFitFrame = ViewportFitSize & {
	readonly insets: ViewportFitInsets;
};

const DEFAULT_PADDING_PX = 12;
const FIT_SCALE_INSET_WEIGHT = {
	top: 1,
	right: 0.95,
	bottom: 0.82,
	left: 0.95,
} as const satisfies ViewportFitInsets;

const fitViewportToSize = (
	content: ViewportFitSize,
	frame: ViewportFitFrame,
): ViewportTransform => {
	const bounds = { x: 0, y: 0, width: content.width, height: content.height };
	return fitViewportToBounds(bounds, frame);
};

/**
 * Computes an absolute camera ({@link ViewportTransform}) that fits `targetBounds`
 * into the chrome-free part of the viewport. `panX`/`panY` are the screen-pixel
 * position of world origin (`screen = world * scale + pan`), so the result is a
 * camera the renderer applies directly — it does not depend on the artboard
 * union, which is what keeps fitting decoupled from later add/move/delete edits.
 */
const fitViewportToBounds = (
	targetBounds: ViewportFitBounds,
	frame: ViewportFitFrame,
): ViewportTransform => {
	return fitBounds(targetBounds, frame, {
		minimumZoom: MIN_ZOOM,
		maximumZoom: MAX_ZOOM,
		padding: DEFAULT_PADDING_PX,
		insetScale: FIT_SCALE_INSET_WEIGHT,
	});
};

/**
 * Normalizes one artboard-space bounds object into a viewport fit target.
 * The target keeps its center separately so multi-artboard renderers can pan
 * around the same scene-space point without redoing union math in React.
 */
export function createViewportFitTarget(
	bounds: ViewportFitBounds,
): ViewportFitTarget {
	const safe = normalizeBounds(bounds);

	return {
		bounds: safe,
		center: {
			x: safe.x + safe.width / 2,
			y: safe.y + safe.height / 2,
		},
	};
}

/**
 * Returns the union target for all supplied artboard bounds. Empty collections
 * return null so callers can deliberately fall back to the legacy single
 * `document.artboard` path until the scene artboard collection lands.
 */
export function createViewportFitTargetForBounds(
	boundsList: readonly ViewportFitBounds[],
): ViewportFitTarget | null {
	if (boundsList.length === 0) return null;

	const bounds = unionBounds(boundsList);
	return bounds ? createViewportFitTarget(bounds) : null;
}

/**
 * Fits a precomputed target into the usable editor viewport, centring it inside
 * the chrome-free region.
 */
export function fitViewportToTarget(
	target: ViewportFitTarget,
	frame: ViewportFitFrame,
): ViewportFitResult {
	return {
		...fitViewportToBounds(target.bounds, frame),
		target,
	};
}

/**
 * Fits one current artboard bounds object and keeps its scene-space center in
 * the result for renderers that need to distinguish current vs all fit.
 */
export function fitViewportToCurrentArtboardBounds(
	bounds: ViewportFitBounds,
	frame: ViewportFitFrame,
): ViewportFitResult {
	return fitViewportToTarget(createViewportFitTarget(bounds), frame);
}

/**
 * Fits the union of all supplied artboard bounds. A null result means no target
 * was supplied, not that fitting failed.
 */
export function fitViewportToAllArtboardBounds(
	boundsList: readonly ViewportFitBounds[],
	frame: ViewportFitFrame,
): ViewportFitResult | null {
	const target = createViewportFitTargetForBounds(boundsList);
	if (!target) return null;

	return fitViewportToTarget(target, frame);
}

/**
 * Fits artboard-local content into the part of the editor viewport not covered
 * by chrome. The returned pan centres the content inside panels/timeline rather
 * than blindly resetting to the visual viewport midpoint.
 */
export function fitViewportToUsableRect(
	content: ViewportFitSize,
	frame: ViewportFitFrame,
): ViewportTransform {
	return fitViewportToSize(content, frame);
}
