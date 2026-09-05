import {
	applyMatrixToPoint,
	composeMatrix,
	IDENTITY_MATRIX,
	type Matrix2D,
	matrixFromTransform,
} from "./rendering";
import type {
	Bounds,
	NodeGeometry,
	SceneDocument,
	Vec2,
	VectorNode,
} from "./types";

/**
 * A real anchor point of a scene shape, in ARTBOARD-LOCAL coordinates (the same
 * space as the move cursor and the smart-guide candidates). `nodeId` is the leaf
 * node the point belongs to so callers can label or filter by source.
 */
export type VertexAnchor = {
	readonly nodeId: string;
	readonly x: number;
	readonly y: number;
};

export type CollectVertexAnchorsOptions = {
	/** Nodes to skip entirely (and not recurse into) — typically the drag set. */
	readonly excludeNodeIds?: readonly string[];
};

const QUARTER_TURN = Math.PI / 2;
const FULL_TURN = Math.PI * 2;
const HALF = 2;

const boundsCorners = (bounds: Bounds): readonly Vec2[] => [
	{ x: bounds.x, y: bounds.y },
	{ x: bounds.x + bounds.width, y: bounds.y },
	{ x: bounds.x + bounds.width, y: bounds.y + bounds.height },
	{ x: bounds.x, y: bounds.y + bounds.height },
];

/** The four cardinal anchor points of an ellipse (its on-path vertices). */
const ellipseQuadrants = (bounds: Bounds): readonly Vec2[] => {
	const cx = bounds.x + bounds.width / HALF;
	const cy = bounds.y + bounds.height / HALF;
	return [
		{ x: cx, y: bounds.y },
		{ x: bounds.x + bounds.width, y: cy },
		{ x: cx, y: bounds.y + bounds.height },
		{ x: bounds.x, y: cy },
	];
};

/**
 * Star tips and valleys. Mirrors the rendering convention in
 * `features/draw/model/shape.ts` (`starPointsForGeometry`) so snap points sit
 * exactly where the star is drawn; duplicated rather than imported because a
 * feature cannot be imported from `entities`.
 */
const starVertices = (
	center: Vec2,
	points: number,
	innerRadius: number,
	outerRadius: number,
): readonly Vec2[] => {
	const total = points * 2;
	return Array.from({ length: total }, (_, index) => {
		const radius = index % 2 === 0 ? outerRadius : innerRadius;
		const angle = -QUARTER_TURN + (index / total) * FULL_TURN;
		return {
			x: center.x + radius * Math.cos(angle),
			y: center.y + radius * Math.sin(angle),
		};
	});
};

/**
 * Local-space anchor points for a leaf geometry. Paths contribute their real
 * Bézier anchors (and any compound subpath anchors); primitives contribute their
 * corners/endpoints/quadrants. Bézier control handles are intentionally excluded
 * for v1.
 */
const localAnchorsForGeometry = (geometry: NodeGeometry): readonly Vec2[] => {
	switch (geometry.kind) {
		case "rect":
		case "text":
		case "image":
			return boundsCorners(geometry.bounds);
		case "ellipse":
			return ellipseQuadrants(geometry.bounds);
		case "line":
			return [geometry.start, geometry.end];
		case "polygon":
			return geometry.points;
		case "star":
			return starVertices(
				geometry.center,
				geometry.points,
				geometry.innerRadius,
				geometry.outerRadius,
			);
		case "path":
			return [
				...geometry.shape.vertices.map(([x, y]) => ({ x, y })),
				...(geometry.subpaths ?? []).flatMap((subpath) =>
					subpath.vertices.map(([x, y]) => ({ x, y })),
				),
			];
	}
};

const walkNodes = (
	nodes: readonly VectorNode[],
	parentMatrix: Matrix2D,
	excluded: ReadonlySet<string>,
	output: VertexAnchor[],
): void => {
	for (const node of nodes) {
		if (excluded.has(node.id)) continue;
		if (!node.visible || node.locked) continue;
		const worldMatrix = composeMatrix(
			parentMatrix,
			matrixFromTransform(node.transform),
		);
		// Containers (groups/frames) hold members in `children` and carry a
		// degenerate own-geometry, so recurse into members instead of emitting the
		// placeholder shape's points.
		if (node.children && node.children.length > 0) {
			walkNodes(node.children, worldMatrix, excluded, output);
			continue;
		}
		for (const local of localAnchorsForGeometry(node.geometry)) {
			const world = applyMatrixToPoint(worldMatrix, local);
			output.push({ nodeId: node.id, x: world.x, y: world.y });
		}
	}
};

/**
 * Collects every visible leaf shape's anchor points in artboard-local space for
 * "Snap to Point". Pure and scene-immutable: safe to cache for a whole gesture.
 * Ancestor transforms are composed so nested-group vertices land where they
 * actually render. Hidden/locked nodes (and the excluded drag set, with their
 * whole subtree) are skipped so a shape never snaps to itself.
 */
export function collectVertexAnchors(
	document: SceneDocument,
	options: CollectVertexAnchorsOptions = {},
): VertexAnchor[] {
	const excluded = new Set(options.excludeNodeIds ?? []);
	const output: VertexAnchor[] = [];
	for (const layer of document.layers) {
		if (!layer.visible || layer.locked) continue;
		walkNodes(layer.nodes, IDENTITY_MATRIX, excluded, output);
	}
	return output;
}
