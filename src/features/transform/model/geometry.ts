import {
	composeMatrix,
	getNodeLocalBounds,
	type Matrix2D,
	matrixFromTransform,
} from "@/entities/scene/model/rendering";
import {
	findNode,
	findRenderableNodeEntry,
} from "@/entities/scene/model/selectors";
import {
	getSceneSpatialIndex,
	sceneBoundsCandidates,
	sceneHitTestCandidates,
} from "@/entities/scene/model/spatial";
import type {
	Bounds,
	SceneDocument,
	VectorNode,
} from "@/entities/scene/model/types";
import { applyToPoint, type Point } from "./matrix";

export type HandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

/** The four corner handles, used by rotation and corner-radius hit-testing. */
export type CornerHandleId = "nw" | "ne" | "se" | "sw";

export const HANDLE_IDS: readonly HandleId[] = [
	"nw",
	"n",
	"ne",
	"e",
	"se",
	"s",
	"sw",
	"w",
];

export const CORNER_HANDLES: readonly CornerHandleId[] = [
	"nw",
	"ne",
	"se",
	"sw",
];

export const OPPOSITE_HANDLE: Record<HandleId, HandleId> = {
	nw: "se",
	n: "s",
	ne: "sw",
	e: "w",
	se: "nw",
	s: "n",
	sw: "ne",
	w: "e",
};

/** Axis-aligned bounding box in artboard space. */
export type Aabb = {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
};

/**
 * Selection frame used by both the overlay (chrome) and the handler
 * (hit-testing) so handle positions stay identical between rendering and
 * interaction. A single selection yields an oriented quad (the node's rotated
 * bounds); a multi selection yields the axis-aligned union box.
 */
export type Frame = {
	/** Clockwise in screen space: nw, ne, se, sw. */
	readonly corners: readonly [Point, Point, Point, Point];
	readonly center: Point;
	readonly oriented: boolean;
};

export type RotationHandleBounds = Aabb;

export type HitTestNodeOptions = {
	readonly tolerance?: number;
};

export type HitTarget =
	| { readonly kind: "resize"; readonly handle: HandleId }
	| { readonly kind: "rotate"; readonly handle: HandleId }
	| { readonly kind: "anchor" }
	| { readonly kind: "corner-radius"; readonly handle: CornerHandleId }
	| { readonly kind: "body" }
	| { readonly kind: "none" };

const IDENTITY_MATRIX: Matrix2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function nodeMatrix(node: VectorNode): Matrix2D {
	return matrixFromTransform(node.transform);
}

/** Parent-to-artboard matrix for a nested node; identity for top-level nodes. */
export function nodeParentMatrix(
	document: SceneDocument,
	nodeId: string,
): Matrix2D {
	const entry = findRenderableNodeEntry(document, nodeId);
	if (!entry || entry.parentIds.length === 0) return IDENTITY_MATRIX;
	return entry.parentIds.reduce((matrix, parentId) => {
		const parent = findNode(document, parentId);
		return parent ? composeMatrix(matrix, nodeMatrix(parent)) : matrix;
	}, IDENTITY_MATRIX);
}

/** Node-local to artboard matrix, including group/Blend ancestor transforms. */
export function nodeWorldMatrix(
	document: SceneDocument,
	node: VectorNode,
): Matrix2D {
	return composeMatrix(nodeParentMatrix(document, node.id), nodeMatrix(node));
}

/** Artboard-space position of a node's local transform anchor. */
export function anchorPoint(node: VectorNode, document?: SceneDocument): Point {
	const matrix = document ? nodeWorldMatrix(document, node) : nodeMatrix(node);
	return applyToPoint(matrix, node.transform.anchor);
}

export function localBounds(node: VectorNode): Bounds {
	return getNodeLocalBounds(node);
}

function distance(a: Point, b: Point): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: Point, b: Point): Point {
	return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Corners of a node's local bounds mapped into artboard space (nw, ne, se, sw). */
export function orientedCorners(
	node: VectorNode,
	document?: SceneDocument,
): [Point, Point, Point, Point] {
	const bounds = localBounds(node);
	const matrix = document ? nodeWorldMatrix(document, node) : nodeMatrix(node);
	return [
		applyToPoint(matrix, { x: bounds.x, y: bounds.y }),
		applyToPoint(matrix, { x: bounds.x + bounds.width, y: bounds.y }),
		applyToPoint(matrix, {
			x: bounds.x + bounds.width,
			y: bounds.y + bounds.height,
		}),
		applyToPoint(matrix, { x: bounds.x, y: bounds.y + bounds.height }),
	];
}

function cornersAabb(corners: readonly Point[]): Aabb {
	const xs = corners.map((point) => point.x);
	const ys = corners.map((point) => point.y);
	return {
		minX: Math.min(...xs),
		minY: Math.min(...ys),
		maxX: Math.max(...xs),
		maxY: Math.max(...ys),
	};
}

/** Axis-aligned bounds of a node including its rotation/scale. */
export function nodeAabb(node: VectorNode, document?: SceneDocument): Aabb {
	return cornersAabb(orientedCorners(node, document));
}

function aabbToFrame(box: Aabb): Frame {
	const corners: [Point, Point, Point, Point] = [
		{ x: box.minX, y: box.minY },
		{ x: box.maxX, y: box.minY },
		{ x: box.maxX, y: box.maxY },
		{ x: box.minX, y: box.maxY },
	];
	return {
		corners,
		center: { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 },
		oriented: false,
	};
}

function centroid(corners: readonly Point[]): Point {
	const sum = corners.reduce(
		(acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
		{ x: 0, y: 0 },
	);
	return { x: sum.x / corners.length, y: sum.y / corners.length };
}

/** Options controlling how the selection frame is built. */
export type FrameOptions = {
	/**
	 * Force the upright axis-aligned union frame even for a single node — the
	 * "Reset Bounding Box" / axis-aligned mode. Ignored for multi-selections
	 * (already axis-aligned). The node's geometry is unchanged; only the chrome
	 * and the resize basis become upright, and resize stays uniform (shear-free).
	 */
	readonly forceAxisAligned?: boolean;
	/**
	 * Scene snapshot used to include ancestor transforms for nested editable
	 * children. Omitted keeps the historical top-level/local behavior.
	 */
	readonly document?: SceneDocument;
};

const OFF_AXIS_EPSILON_DEG = 1e-3;
const RIGHT_ANGLE_DEG = 90;

/**
 * True when a node's rotation is not a multiple of 90° (within float epsilon).
 * Axis-aligned mode only meaningfully differs from the oriented frame for such
 * nodes; at 0/90/180/270° the oriented bounds already equal the AABB, so the
 * mode would needlessly strip legitimate non-uniform edge handles.
 */
export function isOffAxisRotation(rotationDeg: number): boolean {
	const wrapped =
		((rotationDeg % RIGHT_ANGLE_DEG) + RIGHT_ANGLE_DEG) % RIGHT_ANGLE_DEG;
	return (
		wrapped > OFF_AXIS_EPSILON_DEG &&
		wrapped < RIGHT_ANGLE_DEG - OFF_AXIS_EPSILON_DEG
	);
}

/**
 * Whether a single selected node should render the upright AABB frame: it is in
 * axis-aligned mode AND actually rotated off-axis. Shared by the overlay and the
 * handler so chrome and hit-testing agree on one frame.
 */
export function shouldForceAxisAligned(
	node: VectorNode,
	axisAlignedMode: boolean,
): boolean {
	return axisAlignedMode && isOffAxisRotation(node.transform.rotation);
}

/**
 * Builds the selection frame. One node uses its oriented bounds so handles
 * rotate with the shape; many nodes use the axis-aligned union so group
 * gestures stay skew-free. `opts.forceAxisAligned` makes a single node use the
 * upright union too (axis-aligned mode).
 */
export function frameFromNodes(
	nodes: readonly VectorNode[],
	opts: FrameOptions = {},
): Frame | null {
	if (nodes.length === 0) return null;
	if (nodes.length === 1) {
		const node = nodes[0];
		if (!node) return null;
		if (opts.forceAxisAligned)
			return aabbToFrame(nodeAabb(node, opts.document));
		const corners = orientedCorners(node, opts.document);
		return { corners, center: centroid(corners), oriented: true };
	}
	const boxes = nodes.map((node) => nodeAabb(node, opts.document));
	const union: Aabb = {
		minX: Math.min(...boxes.map((box) => box.minX)),
		minY: Math.min(...boxes.map((box) => box.minY)),
		maxX: Math.max(...boxes.map((box) => box.maxX)),
		maxY: Math.max(...boxes.map((box) => box.maxY)),
	};
	return aabbToFrame(union);
}

/** Artboard-space position of a handle on the frame. */
export function handlePoint(frame: Frame, handle: HandleId): Point {
	const [nw, ne, se, sw] = frame.corners;
	switch (handle) {
		case "nw":
			return nw;
		case "ne":
			return ne;
		case "se":
			return se;
		case "sw":
			return sw;
		case "n":
			return midpoint(nw, ne);
		case "e":
			return midpoint(ne, se);
		case "s":
			return midpoint(se, sw);
		case "w":
			return midpoint(sw, nw);
	}
}

function normalizeVector(vector: Point, fallback: Point): Point {
	const length = Math.hypot(vector.x, vector.y);
	if (length === 0) return fallback;
	return { x: vector.x / length, y: vector.y / length };
}

/**
 * Artboard-space position of a corner-radius handle: inset from the corner along
 * the corner→center bisector. The inset is kept ≥ the handle pick radius so the
 * corner-radius pick disc never overlaps the resize disc sitting on the corner.
 */
export function cornerRadiusHandlePoint(
	frame: Frame,
	corner: CornerHandleId,
	inset: number,
): Point {
	const cornerPoint = handlePoint(frame, corner);
	const direction = normalizeVector(
		{ x: frame.center.x - cornerPoint.x, y: frame.center.y - cornerPoint.y },
		{ x: 0, y: 0 },
	);
	return {
		x: cornerPoint.x + direction.x * inset,
		y: cornerPoint.y + direction.y * inset,
	};
}

/**
 * Derives a RAW (unclamped) corner radius from a pointer expressed in the node's
 * LOCAL geometry space: the smaller inset of the pointer from the corner's two
 * adjacent edges, matching the fillet tangent-offset. Working in local space
 * keeps the radius scale/rotation-correct; the update command clamps to bounds.
 */
export function cornerRadiusFromLocalPoint(
	bounds: Bounds,
	corner: CornerHandleId,
	localPoint: Point,
): number {
	const { x, y, width, height } = bounds;
	const right = x + width;
	const bottom = y + height;
	const fromLeft = localPoint.x - x;
	const fromRight = right - localPoint.x;
	const fromTop = localPoint.y - y;
	const fromBottom = bottom - localPoint.y;
	switch (corner) {
		case "nw":
			return Math.max(0, Math.min(fromLeft, fromTop));
		case "ne":
			return Math.max(0, Math.min(fromRight, fromTop));
		case "se":
			return Math.max(0, Math.min(fromRight, fromBottom));
		case "sw":
			return Math.max(0, Math.min(fromLeft, fromBottom));
	}
}

function edgeOutwardNormal(start: Point, end: Point): Point {
	const direction = normalizeVector(
		{ x: end.x - start.x, y: end.y - start.y },
		{ x: 1, y: 0 },
	);
	return { x: direction.y, y: -direction.x };
}

function add(a: Point, b: Point): Point {
	return { x: a.x + b.x, y: a.y + b.y };
}

function outwardDirection(frame: Frame, handle: HandleId): Point {
	const [nw, ne, se, sw] = frame.corners;
	const n = edgeOutwardNormal(nw, ne);
	const e = edgeOutwardNormal(ne, se);
	const s = edgeOutwardNormal(se, sw);
	const w = edgeOutwardNormal(sw, nw);
	switch (handle) {
		case "nw":
			return normalizeVector(add(n, w), { x: -1, y: -1 });
		case "n":
			return n;
		case "ne":
			return normalizeVector(add(n, e), { x: 1, y: -1 });
		case "e":
			return e;
		case "se":
			return normalizeVector(add(s, e), { x: 1, y: 1 });
		case "s":
			return s;
		case "sw":
			return normalizeVector(add(s, w), { x: -1, y: 1 });
		case "w":
			return w;
	}
}

function insideBounds(point: Point, bounds: RotationHandleBounds): boolean {
	return (
		point.x >= bounds.minX &&
		point.x <= bounds.maxX &&
		point.y >= bounds.minY &&
		point.y <= bounds.maxY
	);
}

function clampPoint(point: Point, bounds: RotationHandleBounds): Point {
	return {
		x: Math.min(bounds.maxX, Math.max(bounds.minX, point.x)),
		y: Math.min(bounds.maxY, Math.max(bounds.minY, point.y)),
	};
}

function pointFromDirection(
	origin: Point,
	direction: Point,
	offset: number,
): Point {
	return {
		x: origin.x + direction.x * offset,
		y: origin.y + direction.y * offset,
	};
}

function directionToOctant(direction: Point, fallback: HandleId): HandleId {
	const normalized = normalizeVector(direction, { x: 0, y: -1 });
	const angle = Math.atan2(normalized.y, normalized.x);
	const wrapped = (angle + Math.PI * 2) % (Math.PI * 2);
	const octant = Math.round(wrapped / (Math.PI / 4)) % 8;
	const octants: readonly HandleId[] = [
		"e",
		"se",
		"s",
		"sw",
		"w",
		"nw",
		"n",
		"ne",
	];
	return octants[octant] ?? fallback;
}

function rotationPointWithinBounds(
	corner: Point,
	direction: Point,
	offset: number,
	bounds: RotationHandleBounds,
): Point {
	const outside = pointFromDirection(corner, direction, offset);
	if (insideBounds(outside, bounds)) return outside;
	const inside = pointFromDirection(corner, direction, -offset);
	return clampPoint(inside, bounds);
}

/**
 * Artboard-space position of the visible rotation handle for a corner. The
 * offset is supplied in artboard units by callers (`screen px / zoom`) so the
 * visual handle and hit target remain the same size at every zoom level. When
 * the outside corner would leave the artboard, the point falls back just inside
 * the same corner so edge selections still have a reachable rotation target.
 */
export function rotationHandlePoint(
	frame: Frame,
	handle: HandleId,
	offset: number,
	bounds?: RotationHandleBounds,
): Point {
	const corner = handlePoint(frame, handle);
	const direction = outwardDirection(frame, handle);
	if (bounds)
		return rotationPointWithinBounds(corner, direction, offset, bounds);
	return pointFromDirection(corner, direction, offset);
}

/**
 * Maps a handle to the screen octant it visually occupies. Resize cursors use
 * this instead of the semantic handle id so a rotated node still shows the
 * correct diagonal/horizontal/vertical cursor.
 */
export function resizeCursorOctant(frame: Frame, handle: HandleId): HandleId {
	return directionToOctant(outwardDirection(frame, handle), handle);
}

function crossSign(origin: Point, a: Point, b: Point): number {
	return Math.sign(
		(a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x),
	);
}

/** Convex-quad containment, tolerant of points exactly on an edge. */
export function pointInFrame(point: Point, frame: Frame): boolean {
	const [c0, c1, c2, c3] = frame.corners;
	const signs = [
		crossSign(c0, c1, point),
		crossSign(c1, c2, point),
		crossSign(c2, c3, point),
		crossSign(c3, c0, point),
	];
	const nonNegative = signs.every((sign) => sign >= 0);
	const nonPositive = signs.every((sign) => sign <= 0);
	return nonNegative || nonPositive;
}

/** Options gating which handles {@link classifyHit} is allowed to pick. */
export type HitOptions = {
	/**
	 * Restrict resize to the 4 corner handles (axis-aligned mode). Edge handles
	 * on a rotated node would scale non-uniformly = shear, which the TRS model
	 * cannot represent, so they must be unreachable, not just unrendered.
	 */
	readonly cornerResizeOnly?: boolean;
	/**
	 * Show/Hide Bounding Box. When false, no resize or rotation handle is
	 * pickable; the pointer falls through to body (move) / none (marquee), so
	 * suppressed handles are never invisibly grabbable.
	 */
	readonly handlesEnabled?: boolean;
	/**
	 * Enable the inset corner-radius handles (single roundable node). When true,
	 * a 4th hit pass — AFTER resize and rotate — picks a corner-radius handle so
	 * resize always wins at the exact corner and rounding lives on the inset.
	 */
	readonly cornerRadiusEnabled?: boolean;
	/** Inset of each corner-radius handle from its corner, in artboard units. */
	readonly cornerRadiusInset?: number;
	/**
	 * Artboard-space transform-anchor mark for the selected node. When provided,
	 * it becomes pickable before the body move target so pivot editing does not
	 * require the Inspector.
	 */
	readonly anchorPoint?: Point | null;
};

/**
 * Classifies a pointer against the selection frame. Resize wins on the handles,
 * rotation lives in a band just outside the corners (Figma-style), the interior
 * means a body move, and everything else is empty space for marquee.
 *
 * @param handleHit handle pick radius in artboard units (screen px / scale)
 * @param rotateBand rotation band thickness beyond the corner, artboard units
 * @param opts gates which handles are pickable (axis-aligned / Show-Hide). The
 *   pickable set MUST match what the overlay renders, or handles land where
 *   clicks miss.
 */
export function classifyHit(
	point: Point,
	frame: Frame,
	handleHit: number,
	rotateBand: number,
	rotationBounds?: RotationHandleBounds,
	opts: HitOptions = {},
): HitTarget {
	const handlesEnabled = opts.handlesEnabled ?? true;
	if (handlesEnabled) {
		const resizeHandles = opts.cornerResizeOnly ? CORNER_HANDLES : HANDLE_IDS;
		let nearestHandle: HandleId | null = null;
		let nearestHandleDistance = Number.POSITIVE_INFINITY;
		for (const handle of resizeHandles) {
			const dist = distance(point, handlePoint(frame, handle));
			if (dist < nearestHandleDistance) {
				nearestHandleDistance = dist;
				nearestHandle = handle;
			}
		}
		if (nearestHandle && nearestHandleDistance <= handleHit) {
			return { kind: "resize", handle: nearestHandle };
		}

		let nearestCorner: HandleId | null = null;
		let nearestCornerDistance = Number.POSITIVE_INFINITY;
		for (const handle of CORNER_HANDLES) {
			const dist = distance(
				point,
				rotationHandlePoint(frame, handle, rotateBand, rotationBounds),
			);
			if (dist < nearestCornerDistance) {
				nearestCornerDistance = dist;
				nearestCorner = handle;
			}
		}
		if (nearestCorner && nearestCornerDistance <= handleHit) {
			return { kind: "rotate", handle: nearestCorner };
		}

		// 4th pass: inset corner-radius handles. Runs AFTER resize+rotate so the
		// resize handle on the corner always wins; the radius handle is reachable
		// only on the inset, where the resize disc no longer covers.
		if (opts.cornerRadiusEnabled) {
			const inset = opts.cornerRadiusInset ?? 0;
			let nearestRadiusCorner: CornerHandleId | null = null;
			let nearestRadiusDistance = Number.POSITIVE_INFINITY;
			for (const corner of CORNER_HANDLES) {
				const dist = distance(
					point,
					cornerRadiusHandlePoint(frame, corner, inset),
				);
				if (dist < nearestRadiusDistance) {
					nearestRadiusDistance = dist;
					nearestRadiusCorner = corner;
				}
			}
			if (nearestRadiusCorner && nearestRadiusDistance <= handleHit) {
				return { kind: "corner-radius", handle: nearestRadiusCorner };
			}
		}
		if (opts.anchorPoint && distance(point, opts.anchorPoint) <= handleHit) {
			return { kind: "anchor" };
		}
	}
	if (pointInFrame(point, frame)) return { kind: "body" };
	return { kind: "none" };
}

export function normalizeRect(a: Point, b: Point): Aabb {
	return {
		minX: Math.min(a.x, b.x),
		minY: Math.min(a.y, b.y),
		maxX: Math.max(a.x, b.x),
		maxY: Math.max(a.y, b.y),
	};
}

export function aabbIntersects(a: Aabb, b: Aabb): boolean {
	return (
		a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY
	);
}

export function aabbContains(aabb: Aabb, point: Point): boolean {
	return (
		point.x >= aabb.minX &&
		point.x <= aabb.maxX &&
		point.y >= aabb.minY &&
		point.y <= aabb.maxY
	);
}

function collectSelectableNodes(
	nodes: readonly VectorNode[],
	output: VectorNode[],
	ancestorsUnlocked: boolean,
): VectorNode[] {
	for (const node of nodes) {
		if (!node.visible) continue;
		if (!ancestorsUnlocked || node.locked) continue;
		output.push(node);
		if (node.children) collectSelectableNodes(node.children, output, true);
	}
	return output;
}

/**
 * Canvas-selectable nodes in render order. Hidden and locked layers/nodes are
 * excluded because direct canvas gestures must skip protected artwork; Layers
 * can still select locked nodes through the selection store for inspection.
 */
export function selectableNodes(document: SceneDocument): VectorNode[] {
	return document.layers
		.filter((layer) => layer.visible && !layer.locked)
		.reduce<VectorNode[]>(
			(output, layer) => collectSelectableNodes(layer.nodes, output, true),
			[],
		);
}

function collectTransformableNodes(
	nodes: readonly VectorNode[],
	targetIds: ReadonlySet<string>,
	output: VectorNode[],
	ancestorsUnlocked: boolean,
	ancestorTargeted: boolean,
): VectorNode[] {
	for (const node of nodes) {
		if (!node.visible) continue;
		const unlocked = ancestorsUnlocked && !node.locked;
		const targeted = unlocked && targetIds.has(node.id);
		// Transforming a group already moves its members through the nested <g>, so a
		// descendant that is also selected must NOT receive the transform a second
		// time. Once an ancestor is targeted, its subtree is covered.
		if (targeted && !ancestorTargeted) output.push(node);
		if (node.children) {
			collectTransformableNodes(
				node.children,
				targetIds,
				output,
				unlocked,
				ancestorTargeted || targeted,
			);
		}
	}
	return output;
}

/**
 * Returns the selected nodes that are allowed to receive canvas transforms.
 * Selection state may legitimately contain locked/hidden nodes chosen from the
 * Layers panel; transform tools must keep those nodes selected but inert.
 */
export function transformableSelectionNodes(
	document: SceneDocument,
	nodeIds: readonly string[],
): VectorNode[] {
	const targetIds = new Set(nodeIds);
	return document.layers
		.filter((layer) => layer.visible && !layer.locked)
		.reduce<VectorNode[]>(
			(output, layer) =>
				collectTransformableNodes(layer.nodes, targetIds, output, true, false),
			[],
		);
}

export const transformableNodes = transformableSelectionNodes;

/**
 * Tests whether a node id can be selected and manipulated by canvas gestures.
 * This includes inherited layer visibility/lock state, not just node flags.
 */
export function isCanvasTransformableNode(
	document: SceneDocument,
	nodeId: string,
): boolean {
	return transformableSelectionNodes(document, [nodeId]).length > 0;
}

/**
 * Returns the topmost selectable node under an artboard point. Spatial
 * broad-phase lookup preserves rendered scene order, so later nodes/layers win
 * when bounds overlap while large documents avoid a full selectable-node scan.
 */
export function hitTestNodeId(
	document: SceneDocument,
	point: Point,
	options: HitTestNodeOptions = {},
): string | null {
	const tolerance = Math.max(0, options.tolerance ?? 0);
	const index = getSceneSpatialIndex(document, { tolerance });
	const candidates =
		tolerance > 0
			? sceneHitTestCandidates(index, point)
			: sceneBoundsCandidates(
					index,
					{
						minX: point.x,
						minY: point.y,
						maxX: point.x,
						maxY: point.y,
					},
					{ order: "front-to-back" },
				);
	return candidates[0]?.nodeId ?? null;
}

/** Ids of selectable nodes whose bounds intersect a marquee rectangle. */
export function marqueeNodeIds(document: SceneDocument, rect: Aabb): string[] {
	return sceneBoundsCandidates(getSceneSpatialIndex(document), rect).map(
		(entry) => entry.nodeId,
	);
}
