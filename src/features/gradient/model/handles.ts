import {
	type GradientPaint,
	gradientStops,
	radialScalarRadius,
	setLinearEndpoint,
	setRadialCenter,
	setRadialRadius,
} from "@/entities/scene/model/gradient-edit";
import {
	applyMatrixToPoint,
	invertMatrix,
	matrixFromTransform,
} from "@/entities/scene/model/rendering";
import type { Vec2, VectorNode } from "@/entities/scene/model/types";
import type { GradientPaintRole } from "./editor-store";

/** Axes shorter than this (artboard units²) are treated as degenerate. */
const MIN_AXIS_LENGTH_SQ = 1e-6;

export type GradientHandleId = "from" | "to" | "center" | "radius";

/** A gradient axis as two artboard-local endpoints (`a` = offset 0, `b` = offset 1). */
export type GradientLine = { readonly a: Vec2; readonly b: Vec2 };

export type GradientHandle = {
	readonly id: GradientHandleId;
	/** Artboard-local position (the coordinate space of canvas overlays/handlers). */
	readonly point: Vec2;
};

export type GradientHandleScene = {
	readonly kind: "linear" | "radial";
	readonly handles: readonly GradientHandle[];
	/** Endpoints of the gradient guide line, artboard-local, for drawing. */
	readonly line: { readonly a: Vec2; readonly b: Vec2 };
};

/**
 * The primary node's editable gradient for the requested paint role, or `null`.
 * Image/solid paints have no geometry, and gradients carrying a `paint.transform`
 * are excluded because
 * the on-canvas handles only apply the node matrix — drawing them for a
 * transformed paint would let the handle drift off the rendered edge.
 */
export function draggableGradient(
	node: VectorNode,
	role: GradientPaintRole,
): GradientPaint | null {
	const paint = (role === "fills" ? node.style.fills : node.style.strokes)?.[0];
	if (!paint) return null;
	if (paint.kind !== "linear-gradient" && paint.kind !== "radial-gradient") {
		return null;
	}
	if (paint.transform) return null;
	return paint;
}

/**
 * Projects a gradient's geometry into artboard-local handle positions by applying
 * the node matrix (node-local → artboard-local). Radial exposes a single circular
 * radius handle at `center + (max(rx,ry), 0)` because the renderer collapses the
 * paint to a circle of that radius.
 */
export function gradientHandleScene(
	node: VectorNode,
	paint: GradientPaint,
): GradientHandleScene {
	const matrix = matrixFromTransform(node.transform);
	if (paint.kind === "linear-gradient") {
		const from = applyMatrixToPoint(matrix, paint.from);
		const to = applyMatrixToPoint(matrix, paint.to);
		return {
			kind: "linear",
			handles: [
				{ id: "from", point: from },
				{ id: "to", point: to },
			],
			line: { a: from, b: to },
		};
	}
	const center = applyMatrixToPoint(matrix, paint.center);
	const radiusEndpoint = applyMatrixToPoint(matrix, {
		x: paint.center.x + radialScalarRadius(paint),
		y: paint.center.y,
	});
	return {
		kind: "radial",
		handles: [
			{ id: "center", point: center },
			{ id: "radius", point: radiusEndpoint },
		],
		line: { a: center, b: radiusEndpoint },
	};
}

/**
 * Projects an artboard background gradient into artboard-local handles. Unlike a
 * node paint, the artboard fill's paint space is already the frame's local
 * coordinate system, so no node transform is applied.
 */
export function artboardGradientHandleScene(
	paint: GradientPaint,
): GradientHandleScene {
	if (paint.kind === "linear-gradient") {
		return {
			kind: "linear",
			handles: [
				{ id: "from", point: paint.from },
				{ id: "to", point: paint.to },
			],
			line: { a: paint.from, b: paint.to },
		};
	}
	const radiusEndpoint = {
		x: paint.center.x + radialScalarRadius(paint),
		y: paint.center.y,
	};
	return {
		kind: "radial",
		handles: [
			{ id: "center", point: paint.center },
			{ id: "radius", point: radiusEndpoint },
		],
		line: { a: paint.center, b: radiusEndpoint },
	};
}

/**
 * Returns the id of the closest handle within `tolerance` (artboard-local units),
 * or `null`. Endpoints are checked before the center so an overlapping center
 * never shadows a draggable endpoint.
 */
export function hitGradientHandle(
	handles: readonly GradientHandle[],
	point: Vec2,
	tolerance: number,
): GradientHandleId | null {
	let best: GradientHandleId | null = null;
	let bestDistance = tolerance;
	for (const handle of handles) {
		const distance = Math.hypot(
			handle.point.x - point.x,
			handle.point.y - point.y,
		);
		if (distance <= bestDistance) {
			bestDistance = distance;
			best = handle.id;
		}
	}
	return best;
}

/** Maps an artboard-local point into the node's local paint space, or `null`. */
export function toNodeLocalPoint(node: VectorNode, point: Vec2): Vec2 | null {
	const inverse = invertMatrix(matrixFromTransform(node.transform));
	return inverse ? applyMatrixToPoint(inverse, point) : null;
}

/**
 * Produces the gradient updated for one handle dragged to `nodeLocalPoint` (already
 * inverse-transformed into node space, so distances are measured correctly even
 * under node scale/rotation). Stops, opacity, and any tail paints are preserved by
 * the underlying gradient-edit setters.
 */
export function applyHandleDrag(
	paint: GradientPaint,
	handleId: GradientHandleId,
	nodeLocalPoint: Vec2,
): GradientPaint {
	if (paint.kind === "linear-gradient") {
		if (handleId === "from" || handleId === "to") {
			return setLinearEndpoint(paint, handleId, nodeLocalPoint);
		}
		return paint;
	}
	if (handleId === "center") return setRadialCenter(paint, nodeLocalPoint);
	if (handleId === "radius") {
		const radius = Math.hypot(
			nodeLocalPoint.x - paint.center.x,
			nodeLocalPoint.y - paint.center.y,
		);
		return setRadialRadius(paint, radius);
	}
	return paint;
}

/** Artboard-local point on the gradient axis at normalized `offset`. */
export function axisPointForOffset(line: GradientLine, offset: number): Vec2 {
	return {
		x: line.a.x + (line.b.x - line.a.x) * offset,
		y: line.a.y + (line.b.y - line.a.y) * offset,
	};
}

/**
 * Projects an artboard-local point onto the gradient axis and returns the clamped
 * `[0, 1]` offset. A degenerate (zero-length) axis resolves to `0` so callers never
 * divide by zero when a gradient has collapsed onto a single point.
 */
export function offsetForPoint(line: GradientLine, point: Vec2): number {
	const dx = line.b.x - line.a.x;
	const dy = line.b.y - line.a.y;
	const lengthSq = dx * dx + dy * dy;
	if (lengthSq <= MIN_AXIS_LENGTH_SQ) return 0;
	const t = ((point.x - line.a.x) * dx + (point.y - line.a.y) * dy) / lengthSq;
	return Math.min(1, Math.max(0, t));
}

/** Perpendicular distance from `point` to the gradient axis segment's infinite line. */
export function distanceToAxis(line: GradientLine, point: Vec2): number {
	const projected = axisPointForOffset(line, offsetForPoint(line, point));
	return Math.hypot(point.x - projected.x, point.y - projected.y);
}

/** A gradient stop projected onto the on-canvas axis for hit-testing and drawing. */
export type GradientStopPoint = {
	readonly id: string;
	readonly offset: number;
	readonly color: string;
	readonly opacity: number;
	/** Artboard-local position on the gradient axis. */
	readonly point: Vec2;
};

/**
 * Sorted stops projected to artboard-local axis points. Stops with no id resolve to
 * an empty id; callers persist a hydrated paint (stable ids) before they start
 * tracking a stop by id, so a missing id only ever appears for pure drawing.
 */
export function gradientStopPoints(
	node: VectorNode,
	paint: GradientPaint,
): readonly GradientStopPoint[] {
	const { line } = gradientHandleScene(node, paint);
	return gradientStops(paint).map((stop) => ({
		id: stop.id ?? "",
		offset: stop.offset,
		color: stop.color,
		opacity: stop.opacity ?? 1,
		point: axisPointForOffset(line, stop.offset),
	}));
}

/** Sorted artboard-background stops projected to artboard-local axis points. */
export function artboardGradientStopPoints(
	paint: GradientPaint,
): readonly GradientStopPoint[] {
	const { line } = artboardGradientHandleScene(paint);
	return gradientStops(paint).map((stop) => ({
		id: stop.id ?? "",
		offset: stop.offset,
		color: stop.color,
		opacity: stop.opacity ?? 1,
		point: axisPointForOffset(line, stop.offset),
	}));
}

/**
 * The stop nearest `point` within `tolerance` (artboard units), or `null`. Interior
 * stops win ties against neighbors by distance; endpoint coincidence with the
 * from/to handles is resolved by the handler's hit-priority, not here.
 */
export function hitGradientStop(
	stops: readonly GradientStopPoint[],
	point: Vec2,
	tolerance: number,
): GradientStopPoint | null {
	let best: GradientStopPoint | null = null;
	let bestDistance = tolerance;
	for (const stop of stops) {
		const distance = Math.hypot(stop.point.x - point.x, stop.point.y - point.y);
		if (distance <= bestDistance) {
			bestDistance = distance;
			best = stop;
		}
	}
	return best;
}
