import {
	type Frame,
	HANDLE_IDS,
	type HandleId,
	handlePoint,
	pointInFrame,
} from "./geometry";
import type { Point } from "./matrix";

/**
 * Smallest authoring width/height an artboard may be resized to. Unlike the
 * node path's `MIN_SCALE` (a multiplicative floor on a Transform), artboards
 * carry no matrix, so the floor is an absolute pasteboard-unit size. The clamp
 * is enforced inside {@link resizeArtboardRect} — never deferred to the command,
 * because `createUpdateArtboardCommand` drops non-positive width/height while
 * still applying position, which would half-apply a drag mid-gesture.
 */
export const MIN_ARTBOARD_SIZE = 8;

/** Pasteboard-space rectangle for an artboard (`x`/`y` are its origin). */
export type ArtboardRect = {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
};

/** Resize result shaped to drop straight into an `ArtboardPatch`. */
export type ArtboardResizePatch = {
	readonly position: { readonly x: number; readonly y: number };
	readonly width: number;
	readonly height: number;
};

export type ArtboardHit =
	| { readonly kind: "resize"; readonly handle: HandleId }
	| { readonly kind: "body" }
	| { readonly kind: "none" };

export type ArtboardResizeOptions = {
	/** Shift: preserve the start aspect ratio. */
	readonly constrain?: boolean;
	/** Alt: resize symmetrically about the rectangle center. */
	readonly fromCenter?: boolean;
	readonly minSize?: number;
};

/** Which edge each handle moves, per axis (`null` = that axis is fixed). */
type AxisSide = "min" | "max" | null;

const HANDLE_EDGES: Record<
	HandleId,
	{ readonly x: AxisSide; readonly y: AxisSide }
> = {
	nw: { x: "min", y: "min" },
	n: { x: null, y: "min" },
	ne: { x: "max", y: "min" },
	e: { x: "max", y: null },
	se: { x: "max", y: "max" },
	s: { x: null, y: "max" },
	sw: { x: "min", y: "max" },
	w: { x: "min", y: null },
};

/** Axis-aligned selection {@link Frame} for an artboard pasteboard rect. */
export function artboardFrame(rect: ArtboardRect): Frame {
	const { x, y, width, height } = rect;
	return {
		corners: [
			{ x, y },
			{ x: x + width, y },
			{ x: x + width, y: y + height },
			{ x, y: y + height },
		],
		center: { x: x + width / 2, y: y + height / 2 },
		oriented: false,
	};
}

/**
 * Classifies a pasteboard point against an artboard frame: a resize handle wins
 * within `handleHit` (screen px / scale), the interior is a body grip, and
 * everything else is empty. Artboards have no rotation band — there is no rotate
 * branch, unlike the node {@link Frame} classifier.
 */
export function classifyArtboardHit(
	point: Point,
	rect: ArtboardRect,
	handleHit: number,
): ArtboardHit {
	const frame = artboardFrame(rect);
	let nearest: HandleId | null = null;
	let nearestDistance = Number.POSITIVE_INFINITY;
	for (const handle of HANDLE_IDS) {
		const target = handlePoint(frame, handle);
		const distance = Math.hypot(point.x - target.x, point.y - target.y);
		if (distance < nearestDistance) {
			nearestDistance = distance;
			nearest = handle;
		}
	}
	if (nearest && nearestDistance <= handleHit) {
		return { kind: "resize", handle: nearest };
	}
	if (pointInFrame(point, frame)) return { kind: "body" };
	return { kind: "none" };
}

/**
 * Computes an artboard's new `position`/`width`/`height` directly from a resize
 * handle and pasteboard pointer — NOT via a Transform/matrix (artboards have
 * none). Both `start` and `pointer` are pasteboard-space.
 *
 * Anchoring: each handle moves only its own edge(s); the opposite edge stays
 * fixed (Figma top/left-constraint default), so origin-moving handles (nw/n/w)
 * change `position` while se/e/s only grow size. `constrain` locks the start
 * aspect ratio; `fromCenter` pins the center and moves both opposite edges.
 *
 * Min-size is clamped here with the anchor frozen: dragging an origin handle
 * past the fixed edge stops the origin at `fixedEdge - minSize` instead of
 * flipping the frame or letting position overshoot.
 */
export function resizeArtboardRect(
	start: ArtboardRect,
	handle: HandleId,
	pointer: Point,
	options: ArtboardResizeOptions = {},
): ArtboardResizePatch {
	const {
		constrain = false,
		fromCenter = false,
		minSize = MIN_ARTBOARD_SIZE,
	} = options;
	const control = HANDLE_EDGES[handle];
	const left0 = start.x;
	const right0 = start.x + start.width;
	const top0 = start.y;
	const bottom0 = start.y + start.height;
	const cx = (left0 + right0) / 2;
	const cy = (top0 + bottom0) / 2;

	// Signed extents implied by the pointer; sign lets a past-the-anchor drag
	// fall into the min clamp rather than mirror the frame.
	let width = start.width;
	let height = start.height;
	if (control.x === "min") {
		width = fromCenter ? 2 * (cx - pointer.x) : right0 - pointer.x;
	} else if (control.x === "max") {
		width = fromCenter ? 2 * (pointer.x - cx) : pointer.x - left0;
	}
	if (control.y === "min") {
		height = fromCenter ? 2 * (cy - pointer.y) : bottom0 - pointer.y;
	} else if (control.y === "max") {
		height = fromCenter ? 2 * (pointer.y - cy) : pointer.y - top0;
	}

	// Aspect lock: corner scales uniformly to the larger pointer extent; an edge
	// handle grows the inactive axis proportionally (centered below).
	if (constrain && start.width > 0 && start.height > 0) {
		const movesX = control.x !== null;
		const movesY = control.y !== null;
		if (movesX && movesY) {
			const scale = Math.max(
				Math.abs(width) / start.width,
				Math.abs(height) / start.height,
			);
			width = Math.sign(width || 1) * start.width * scale;
			height = Math.sign(height || 1) * start.height * scale;
		} else if (movesX) {
			height = Math.abs(width) * (start.height / start.width);
		} else if (movesY) {
			width = Math.abs(height) * (start.width / start.height);
		}
	}

	const x = solveAxis(left0, right0, control.x, width, fromCenter, minSize);
	const y = solveAxis(top0, bottom0, control.y, height, fromCenter, minSize);
	return {
		position: { x: x.lo, y: y.lo },
		width: x.hi - x.lo,
		height: y.hi - y.lo,
	};
}

/**
 * Resolves one axis to `[lo, hi]` edges from a signed target size, anchoring on
 * the side the handle does not move (or the center when `fromCenter`/inactive),
 * then clamps to `minSize` without releasing that anchor.
 */
function solveAxis(
	lo0: number,
	hi0: number,
	control: AxisSide,
	size: number,
	fromCenter: boolean,
	minSize: number,
): { lo: number; hi: number } {
	const center = (lo0 + hi0) / 2;
	let lo: number;
	let hi: number;
	if (fromCenter || control === null) {
		const half = Math.abs(size) / 2;
		lo = center - half;
		hi = center + half;
	} else if (control === "min") {
		hi = hi0;
		lo = hi0 - size;
	} else {
		lo = lo0;
		hi = lo0 + size;
	}
	if (hi - lo < minSize) {
		if (fromCenter || control === null) {
			lo = center - minSize / 2;
			hi = center + minSize / 2;
		} else if (control === "min") {
			lo = hi - minSize;
		} else {
			hi = lo + minSize;
		}
	}
	return { lo, hi };
}
