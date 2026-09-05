import {
	buildRoundedRectShape,
	resolveCornerRadii,
	resolveCornerSmoothing,
	starVertices,
} from "@/entities/scene/model/corner-geometry";
import {
	applyMatrixToPoint,
	type Matrix2D,
	matrixFromTransform,
} from "@/entities/scene/model/rendering";
import type { NodeGeometry, VectorNode } from "@/entities/scene/model/types";
import type { AePoint, AeShape } from "@/shared/glammer/ae-shape";
import type { ArrangeSource, Pt } from "./arrangement";

/**
 * Adapter: VectorNode → flattened, artboard-local {@link ArrangeSource} rings for
 * the Shape Builder engine. Curved segments are adaptively flattened (same
 * tolerance the renderer/path-ops use) and the node transform is baked, since the
 * arrangement and the resulting nodes live in artboard-local coordinates. Reuses
 * only entities geometry helpers so the arch gate stays satisfied.
 */

const FLATTEN_TOLERANCE = 0.15;
const MAX_FLATTEN_DEPTH = 18;
const ELLIPSE_KAPPA = 0.5522847498307936;

const distanceToChord = (p: Pt, a: Pt, b: Pt): number => {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const len2 = dx * dx + dy * dy;
	if (len2 <= 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
	return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / Math.sqrt(len2);
};

const flattenCubicInto = (
	p0: Pt,
	p1: Pt,
	p2: Pt,
	p3: Pt,
	out: Pt[],
	depth: number,
): void => {
	if (
		depth >= MAX_FLATTEN_DEPTH ||
		(distanceToChord(p1, p0, p3) <= FLATTEN_TOLERANCE &&
			distanceToChord(p2, p0, p3) <= FLATTEN_TOLERANCE)
	) {
		out.push(p3);
		return;
	}
	const mid = (a: Pt, b: Pt): Pt => ({
		x: (a.x + b.x) / 2,
		y: (a.y + b.y) / 2,
	});
	const p01 = mid(p0, p1);
	const p12 = mid(p1, p2);
	const p23 = mid(p2, p3);
	const p012 = mid(p01, p12);
	const p123 = mid(p12, p23);
	const m = mid(p012, p123);
	flattenCubicInto(p0, p01, p012, m, out, depth + 1);
	flattenCubicInto(m, p123, p23, p3, out, depth + 1);
};

const ae = (p: AePoint | undefined): Pt => ({ x: p?.[0] ?? 0, y: p?.[1] ?? 0 });

const SMOOTH_CORNER_DOT = Math.cos((1 * Math.PI) / 180);
const hasMag = (t: AePoint | undefined): boolean =>
	Math.hypot(t?.[0] ?? 0, t?.[1] ?? 0) > 1e-7;
const normDir = (v: Pt): Pt | null => {
	const len = Math.hypot(v.x, v.y);
	return len <= 1e-9 ? null : { x: v.x / len, y: v.y / len };
};

/**
 * Sharp anchor positions of a shape (local). A vertex is a hard corner when the
 * heading arriving (−inTangent, or the chord from the previous anchor) turns away
 * from the heading leaving (outTangent, or the chord to the next anchor) by more
 * than ~1°. Rect/polygon/star anchors are all corners; an ellipse's tangent-handled
 * anchors are smooth, so it contributes none — the fitter traces it as an arc.
 */
const hardCorners = (shape: AeShape): Pt[] => {
	const n = shape.vertices.length;
	if (n < 3) return shape.vertices.map(ae);
	const corners: Pt[] = [];
	for (let i = 0; i < n; i++) {
		const v = ae(shape.vertices[i]);
		const prev = ae(shape.vertices[(i - 1 + n) % n]);
		const next = ae(shape.vertices[(i + 1) % n]);
		const inT = shape.inTangents[i];
		const outT = shape.outTangents[i];
		const arrival = hasMag(inT)
			? { x: -(inT?.[0] ?? 0), y: -(inT?.[1] ?? 0) }
			: { x: v.x - prev.x, y: v.y - prev.y };
		const departure = hasMag(outT)
			? { x: outT?.[0] ?? 0, y: outT?.[1] ?? 0 }
			: { x: next.x - v.x, y: next.y - v.y };
		const a = normDir(arrival);
		const d = normDir(departure);
		if (!a || !d || a.x * d.x + a.y * d.y < SMOOTH_CORNER_DOT) corners.push(v);
	}
	return corners;
};

/** Flattens one closed AeShape into a deduplicated polyline (local coordinates). */
const flattenShape = (shape: AeShape): Pt[] => {
	const out: Pt[] = [];
	const n = shape.vertices.length;
	if (n < 2) return out;
	const segments = shape.closed ? n : n - 1;
	for (let i = 0; i < segments; i++) {
		const ni = (i + 1) % n;
		const p0 = ae(shape.vertices[i]);
		const p3 = ae(shape.vertices[ni]);
		const out0 = ae(shape.outTangents[i]);
		const in3 = ae(shape.inTangents[ni]);
		const p1 = { x: p0.x + out0.x, y: p0.y + out0.y };
		const p2 = { x: p3.x + in3.x, y: p3.y + in3.y };
		if (out.length === 0) out.push(p0);
		flattenCubicInto(p0, p1, p2, p3, out, 0);
	}
	return dedupeClosure(out);
};

const dedupeClosure = (points: readonly Pt[]): Pt[] => {
	const same = (a: Pt, b: Pt): boolean =>
		Math.hypot(a.x - b.x, a.y - b.y) <= 1e-7;
	const result: Pt[] = [];
	for (const p of points) {
		const prev = result.at(-1);
		if (!prev || !same(prev, p)) result.push(p);
	}
	while (result.length > 1 && same(result[0], result[result.length - 1]))
		result.pop();
	return result;
};

const pointInRing = (p: Pt, ring: readonly Pt[]): boolean => {
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const a = ring[i];
		const b = ring[j];
		if (a.y > p.y !== b.y > p.y) {
			const xint = ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
			if (p.x < xint) inside = !inside;
		}
	}
	return inside;
};

const evenOddBridgeRingIndices = (
	rings: readonly (readonly Pt[])[],
): Set<number> => {
	const bridge = new Set<number>();
	for (let index = 0; index < rings.length; index += 1) {
		const point = rings[index][0];
		if (!point) continue;
		let depth = 0;
		for (let other = 0; other < rings.length; other += 1) {
			if (other !== index && pointInRing(point, rings[other])) depth += 1;
		}
		if (depth % 2 === 0) bridge.add(index);
	}
	return bridge;
};

const polylineShape = (points: readonly Pt[]): AeShape => {
	const vertices: AePoint[] = points.map((p) => [p.x, p.y]);
	const zeros: AePoint[] = points.map(() => [0, 0]);
	return {
		type: "Shape",
		closed: true,
		vertices,
		inTangents: zeros,
		outTangents: zeros,
	};
};

const ellipseShape = (bounds: {
	x: number;
	y: number;
	width: number;
	height: number;
}): AeShape => {
	const rx = Math.max(0, bounds.width) / 2;
	const ry = Math.max(0, bounds.height) / 2;
	const cx = bounds.x + rx;
	const cy = bounds.y + ry;
	const kx = ELLIPSE_KAPPA * rx;
	const ky = ELLIPSE_KAPPA * ry;
	return {
		type: "Shape",
		closed: true,
		vertices: [
			[cx + rx, cy],
			[cx, cy + ry],
			[cx - rx, cy],
			[cx, cy - ry],
		],
		inTangents: [
			[0, -ky],
			[kx, 0],
			[0, ky],
			[-kx, 0],
		],
		outTangents: [
			[0, ky],
			[-kx, 0],
			[0, -ky],
			[kx, 0],
		],
	};
};

/** Source AeShapes (outer + holes) in node-local coordinates, or null if area-less. */
const geometryToShapes = (geometry: NodeGeometry): AeShape[] | null => {
	switch (geometry.kind) {
		case "rect":
			return [
				buildRoundedRectShape(geometry.bounds, {
					radii: resolveCornerRadii(geometry),
					smoothing: resolveCornerSmoothing(geometry),
				}),
			];
		case "ellipse":
			return [ellipseShape(geometry.bounds)];
		case "polygon":
			return geometry.points.length >= 3
				? [polylineShape(geometry.points.map((p) => ({ x: p.x, y: p.y })))]
				: null;
		case "star":
			return [polylineShape(starVertices(geometry))];
		case "path":
			return [geometry.shape, ...(geometry.subpaths ?? [])];
		case "line":
		case "text":
		case "image":
			return null;
	}
};

/**
 * Converts a node to a Shape Builder source, or null when the geometry has no
 * fillable area (line/text/image) or collapses below a triangle.
 */
export function nodeToArrangeSource(
	node: VectorNode,
	matrix: Matrix2D = matrixFromTransform(node.transform),
): ArrangeSource | null {
	const shapes = geometryToShapes(node.geometry);
	if (!shapes) return null;
	const flattened = shapes
		.map((shape) => ({ shape, local: flattenShape(shape) }))
		.filter((entry) => entry.local.length >= 3);
	if (flattened.length === 0) return null;
	const fillRule =
		node.geometry.kind === "path"
			? (node.geometry.fillRule ?? "nonzero")
			: "nonzero";
	const bridgeIndices =
		node.geometry.kind === "path" && fillRule === "evenodd"
			? evenOddBridgeRingIndices(flattened.map((entry) => entry.local))
			: new Set(flattened.map((_, index) => index));
	const rings: Pt[][] = [];
	const bridgeRings: Pt[][] = [];
	const corners: Pt[] = [];
	for (const [index, { shape, local }] of flattened.entries()) {
		const transformed = local.map((p) => applyMatrixToPoint(matrix, p));
		rings.push(transformed);
		if (bridgeIndices.has(index)) bridgeRings.push(transformed);
		for (const c of hardCorners(shape))
			corners.push(applyMatrixToPoint(matrix, c));
	}
	return { id: node.id, fillRule, rings, bridgeRings, corners };
}
