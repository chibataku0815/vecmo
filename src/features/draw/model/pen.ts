import type { BezierShape, Vec2 } from "@/entities/scene/model/types";
import type { AePoint } from "@/shared/glammer/ae-shape";

/**
 * One pen anchor in artboard-local units. Tangents are stored as offsets
 * relative to the anchor point — the same convention as {@link BezierShape}
 * (AeShape) — so the in-progress path serializes straight into scene geometry.
 */
export type PenAnchor = {
	readonly point: readonly [number, number];
	readonly inTangent: readonly [number, number];
	readonly outTangent: readonly [number, number];
};

/** Corner anchor: zero-length handles, so adjacent segments meet sharply. */
export function cornerAnchor(point: Vec2): PenAnchor {
	return { point: [point.x, point.y], inTangent: [0, 0], outTangent: [0, 0] };
}

/**
 * Smooth anchor with symmetric handles. Dragging away from the anchor sets the
 * out tangent toward the cursor; the in tangent mirrors it, giving a continuous
 * curve through the anchor (Illustrator-style click-drag).
 */
export function smoothAnchor(point: Vec2, handle: Vec2): PenAnchor {
	const out: readonly [number, number] = [
		handle.x - point.x,
		handle.y - point.y,
	];
	return {
		point: [point.x, point.y],
		inTangent: [-out[0], -out[1]],
		outTangent: out,
	};
}

export function distance(a: Vec2, b: Vec2): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Whether `point` lands on the path's first anchor — the gesture that closes
 * the path. Requires at least two existing anchors so a single placed anchor
 * cannot self-close. `tolerance` is in artboard-local units (callers convert
 * the screen-pixel hit radius through the current zoom).
 */
export function isCloseTarget(
	point: Vec2,
	anchors: readonly PenAnchor[],
	tolerance: number,
): boolean {
	const first = anchors[0];
	if (!first || anchors.length < 2) return false;
	return distance(point, { x: first.point[0], y: first.point[1] }) <= tolerance;
}

/**
 * Serializes accumulated anchors into a scene-ready {@link BezierShape}. The
 * parallel vertex/tangent arrays preserve AeShape topology so the host renderer
 * and motion sampler consume the result without a translation layer.
 */
export function penAnchorsToShape(
	anchors: readonly PenAnchor[],
	closed: boolean,
): BezierShape {
	return {
		type: "Shape",
		closed,
		vertices: anchors.map(
			(anchor): AePoint => [anchor.point[0], anchor.point[1]],
		),
		inTangents: anchors.map(
			(anchor): AePoint => [anchor.inTangent[0], anchor.inTangent[1]],
		),
		outTangents: anchors.map(
			(anchor): AePoint => [anchor.outTangent[0], anchor.outTangent[1]],
		),
	};
}
