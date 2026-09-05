import type { Matrix2D } from "@/entities/scene/model/rendering";
import type { Bounds } from "@/entities/scene/model/types";
import {
	type Frame,
	type HandleId,
	handlePoint,
	OPPOSITE_HANDLE,
} from "./geometry";
import {
	applyToPoint,
	invert,
	multiply,
	type Point,
	rotateAbout,
	scaleAbout,
	translation,
} from "./matrix";

/**
 * Minimum scale factor. Flipping a shape past its fixed edge would produce a
 * negative scale, which {@link transformFromMatrix} cannot round-trip (it uses
 * `hypot`, always ≥ 0). Clamping keeps every gesture decomposable; true flip is
 * deferred out of the must-now scope.
 */
export const MIN_SCALE = 0.02;
export const ROTATE_SNAP_DEG = 15;
export const NUDGE_STEP = 1;
export const NUDGE_STEP_LARGE = 10;

export type Delta = { readonly dx: number; readonly dy: number };

function clampScale(scale: number): number {
	return scale < MIN_SCALE ? MIN_SCALE : scale;
}

function ratio(numerator: number, denominator: number): number {
	if (denominator === 0) return 1;
	return clampScale(numerator / denominator);
}

/** Locks the delta to the dominant axis when constrain (Shift) is held. */
export function axisLockedDelta(
	dx: number,
	dy: number,
	constrain: boolean,
): Delta {
	if (!constrain) return { dx, dy };
	return Math.abs(dx) >= Math.abs(dy) ? { dx, dy: 0 } : { dx: 0, dy };
}

/** Signed rotation in degrees from `start` to `current` about a pivot. */
export function rotationDelta(
	center: Point,
	start: Point,
	current: Point,
): number {
	const before = Math.atan2(start.y - center.y, start.x - center.x);
	const after = Math.atan2(current.y - center.y, current.x - center.x);
	return ((after - before) * 180) / Math.PI;
}

export function snapAngle(
	degrees: number,
	step: number = ROTATE_SNAP_DEG,
): number {
	return Math.round(degrees / step) * step;
}

/**
 * Translation matrix for a move gesture. Left-multiplied onto each node's
 * start matrix by the handler, so a multi-selection moves rigidly.
 */
export function moveMatrix(
	start: Point,
	current: Point,
	constrain: boolean,
): Matrix2D {
	const { dx, dy } = axisLockedDelta(
		current.x - start.x,
		current.y - start.y,
		constrain,
	);
	return translation(dx, dy);
}

/**
 * Rotation matrix about the frame center. Rotation composes with any existing
 * rotation/scale without shear, so it stays correct for rotated and
 * multi-selections alike.
 *
 * When constrained (Shift), the resulting ABSOLUTE orientation snaps to the
 * grid — `startAngle` is the node's current rotation, so a pre-rotated node
 * still lands on a 15° multiple (snapping the raw delta would leave it off the
 * grid). A multi-selection passes `startAngle = 0` (delta snap) so the group
 * rotates rigidly by a single snapped amount.
 */
export function rotateMatrix(
	center: Point,
	start: Point,
	current: Point,
	constrain: boolean,
	startAngle = 0,
): Matrix2D {
	const raw = rotationDelta(center, start, current);
	if (!constrain) return rotateAbout(center, raw);
	const snappedDelta = snapAngle(startAngle + raw) - startAngle;
	return rotateAbout(center, snappedDelta);
}

type HandleAxes = {
	readonly fixedX: 0 | 1;
	readonly fixedY: 0 | 1;
	readonly activeX: boolean;
	readonly activeY: boolean;
};

const HANDLE_AXES: Record<HandleId, HandleAxes> = {
	se: { fixedX: 0, fixedY: 0, activeX: true, activeY: true },
	nw: { fixedX: 1, fixedY: 1, activeX: true, activeY: true },
	ne: { fixedX: 0, fixedY: 1, activeX: true, activeY: true },
	sw: { fixedX: 1, fixedY: 0, activeX: true, activeY: true },
	e: { fixedX: 0, fixedY: 0, activeX: true, activeY: false },
	w: { fixedX: 1, fixedY: 0, activeX: true, activeY: false },
	s: { fixedX: 0, fixedY: 0, activeX: false, activeY: true },
	n: { fixedX: 0, fixedY: 1, activeX: false, activeY: true },
};

function boundsCenter(bounds: Bounds): Point {
	return {
		x: bounds.x + bounds.width / 2,
		y: bounds.y + bounds.height / 2,
	};
}

/**
 * Resize matrix for a single (possibly rotated) node. The scale is applied in
 * the node's LOCAL frame about the fixed opposite corner and right-multiplied
 * onto the start matrix (`M · scaleAbout(fixedLocal)`). Doing it in local space
 * keeps the result shear-free even when the node is rotated, so
 * {@link transformFromMatrix} round-trips it. Shift locks the aspect ratio; Alt
 * uses the local center as the fixed point for Figma-style center resize.
 */
export function resizeSingleMatrix(
	start: Matrix2D,
	bounds: Bounds,
	handle: HandleId,
	pointer: Point,
	constrain: boolean,
	fromCenter = false,
): Matrix2D {
	const axes = HANDLE_AXES[handle];
	const center = boundsCenter(bounds);
	const proportionalEdge = constrain && axes.activeX !== axes.activeY;
	const fixedLocal = fromCenter
		? center
		: {
				x:
					proportionalEdge && !axes.activeX
						? center.x
						: axes.fixedX === 0
							? bounds.x
							: bounds.x + bounds.width,
				y:
					proportionalEdge && !axes.activeY
						? center.y
						: axes.fixedY === 0
							? bounds.y
							: bounds.y + bounds.height,
			};
	const movingLocalX = axes.fixedX === 0 ? bounds.x + bounds.width : bounds.x;
	const movingLocalY = axes.fixedY === 0 ? bounds.y + bounds.height : bounds.y;
	const local = applyToPoint(invert(start), pointer);
	let sx = axes.activeX
		? ratio(local.x - fixedLocal.x, movingLocalX - fixedLocal.x)
		: 1;
	let sy = axes.activeY
		? ratio(local.y - fixedLocal.y, movingLocalY - fixedLocal.y)
		: 1;
	if (constrain && axes.activeX && axes.activeY) {
		const uniform = Math.max(sx, sy);
		sx = uniform;
		sy = uniform;
	} else if (constrain && axes.activeX) {
		sy = sx;
	} else if (constrain && axes.activeY) {
		sx = sy;
	}
	return multiply(start, scaleAbout(fixedLocal, sx, sy));
}

/**
 * Uniform group-resize matrix about the frame's fixed (opposite) handle. Only
 * uniform scaling is used for multi-selections because a non-uniform
 * artboard-axis scale would shear rotated members (and silently corrupt their
 * decomposition). Left-multiplied onto each node's start matrix by the handler.
 * Non-uniform multi-resize is deferred. Alt switches the fixed point from the
 * opposite handle to the group center.
 */
export function groupResizeMatrix(
	frame: Frame,
	handle: HandleId,
	pointer: Point,
	fromCenter = false,
): Matrix2D {
	const anchor = fromCenter
		? frame.center
		: handlePoint(frame, OPPOSITE_HANDLE[handle]);
	const reference = handlePoint(frame, handle);
	const refVec = { x: reference.x - anchor.x, y: reference.y - anchor.y };
	const curVec = { x: pointer.x - anchor.x, y: pointer.y - anchor.y };
	const denominator = refVec.x * refVec.x + refVec.y * refVec.y;
	const factor =
		denominator === 0
			? 1
			: clampScale((curVec.x * refVec.x + curVec.y * refVec.y) / denominator);
	return scaleAbout(anchor, factor, factor);
}

/** Arrow-key nudge vector in artboard units, or null for a non-arrow key. */
export function nudgeDelta(key: string, large: boolean): Delta | null {
	const step = large ? NUDGE_STEP_LARGE : NUDGE_STEP;
	switch (key) {
		case "ArrowLeft":
			return { dx: -step, dy: 0 };
		case "ArrowRight":
			return { dx: step, dy: 0 };
		case "ArrowUp":
			return { dx: 0, dy: -step };
		case "ArrowDown":
			return { dx: 0, dy: step };
		default:
			return null;
	}
}
