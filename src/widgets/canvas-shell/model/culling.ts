import { meshBounds } from "@/entities/scene/model/mesh-edit";
import {
	type Matrix2D,
	matrixFromTransform,
} from "@/entities/scene/model/rendering";
import { sceneNodeVisualAabb } from "@/entities/scene/model/spatial";
import type {
	Bounds,
	MeshGradientPaint,
	PaintTransform,
	Vec2,
	VectorNode,
} from "@/entities/scene/model/types";
import {
	type Aabb,
	aabbFromPoints,
	aabbIntersects,
	inflateAabb,
} from "@/shared/lib/spatial/aabb";

/**
 * Documents with at most this many renderable nodes skip culling entirely and
 * render every node, so small/typical documents stay byte-identical and pay no
 * cull cost. Culling only activates above it — the large-document path that makes
 * its added per-node test worthwhile.
 */
export const CULL_NODE_THRESHOLD = 800;

/**
 * Extra margin, as a fraction of the visible extent, rendered beyond the viewport
 * so a pan reveals already-mounted nodes instead of popping them in at the edge.
 * Correctness (a node's stroke/shadow spilling into view) is handled per-node by
 * {@link sceneNodeVisualAabb}; this overscan is purely a pan-smoothness buffer.
 */
const OVERSCAN_FRACTION = 0.2;

export type ViewportProjection = {
	/** Pasteboard→screen multiplier (`zoom/100`), not the integer percentage. */
	readonly scale: number;
	readonly panX: number;
	readonly panY: number;
	/** Pasteboard camera rotation in radians. Omitted/zero keeps the fast path. */
	readonly rotation?: number;
	readonly viewportWidth: number;
	readonly viewportHeight: number;
};

/**
 * The pasteboard-space rectangle currently on screen, expanded by overscan. Inverts
 * the stage projection `screen = rotate(pasteboard, rotation) * scale + pan`.
 * Returns `null` before the viewport is measured or scale is non-positive,
 * signalling "do not cull".
 */
export function visiblePasteboardRect(
	projection: ViewportProjection,
): Aabb | null {
	const { scale, panX, panY, viewportWidth, viewportHeight } = projection;
	if (!(scale > 0) || viewportWidth <= 0 || viewportHeight <= 0) return null;
	const rotation =
		typeof projection.rotation === "number" &&
		Number.isFinite(projection.rotation)
			? projection.rotation
			: 0;
	const cos = rotation === 0 ? 1 : Math.cos(rotation);
	const sin = rotation === 0 ? 0 : Math.sin(rotation);
	const unproject = (x: number, y: number): Vec2 => {
		const scaledX = (x - panX) / scale;
		const scaledY = (y - panY) / scale;
		return {
			x: scaledX * cos + scaledY * sin,
			y: -scaledX * sin + scaledY * cos,
		};
	};
	const visible = aabbFromPoints([
		unproject(0, 0),
		unproject(viewportWidth, 0),
		unproject(0, viewportHeight),
		unproject(viewportWidth, viewportHeight),
	]);
	const { minX, minY, maxX, maxY } = visible;
	const overscan = Math.max(maxX - minX, maxY - minY) * OVERSCAN_FRACTION;
	return inflateAabb({ minX, minY, maxX, maxY }, overscan);
}

/**
 * Fraction of a culling rect's own size ({@link cullRectQuantum}'s input) targeted
 * for its outward-snap quantum in {@link quantizeCullingRect}: big enough that
 * ordinary pans/zooms don't cross a grid line on every frame, small enough that the
 * worst-case extra rendered area (bounded by the quantum on each edge) stays
 * modest. The quantum itself is banded in log space rather than used directly, so
 * a tiny size change doesn't also nudge the quantum — and thus the snapped edges —
 * by a proportionally tiny amount; see {@link cullRectQuantum}.
 */
const CULL_RECT_QUANTUM_FRACTION = 0.2;

/**
 * Octave ratio between adjacent {@link cullRectQuantum} bands. A rect's target
 * quantum (`size * CULL_RECT_QUANTUM_FRACTION`) is rounded to the nearest power of
 * this ratio in log space, so the quantum used for outward snapping only changes
 * when the rect's size crosses a band edge — not on every sub-pixel size change
 * from panning or zooming.
 */
const CULL_RECT_QUANTUM_BAND_RATIO = 2;

/**
 * The outward-snap quantum (pasteboard units) for a culling rect of the given
 * size (its larger dimension, `max(width, height)`). See
 * {@link CULL_RECT_QUANTUM_FRACTION} and {@link CULL_RECT_QUANTUM_BAND_RATIO}.
 */
function cullRectQuantum(size: number): number {
	const target = size * CULL_RECT_QUANTUM_FRACTION;
	const band = Math.round(
		Math.log(target) / Math.log(CULL_RECT_QUANTUM_BAND_RATIO),
	);
	return CULL_RECT_QUANTUM_BAND_RATIO ** band;
}

// `|| 0` folds a `-0` result (e.g. an edge sitting just below zero) back to `0`,
// so a `useMemo` dependency array — which compares via `Object.is`, and
// `Object.is(-0, 0)` is `false` — never sees a spurious change at zero.
const normalizeZero = (value: number): number => value || 0;

/**
 * Snaps a pasteboard-space culling rect's edges OUTWARD to a quantized grid, so
 * the result is always a SUPERSET of `rect`: `floor` can only move `minX`/`minY`
 * down and `ceil` can only move `maxX`/`maxY` up, never in. This guarantees
 * culling driven by the snapped rect can never drop a node that intersects the
 * true (unsnapped) visible rect — at worst it keeps extra nodes mounted, bounded
 * by the quantum (see {@link cullRectQuantum}) on each edge.
 *
 * The quantum is derived from `rect`'s own size and banded in log space, so
 * panning without crossing a grid line — or zooming without crossing a size band —
 * leaves every returned edge byte-identical, keeping a `useMemo` keyed on these
 * primitives stable.
 *
 * This replaces the pre-fix design of quantizing screen-space pan/scale BEFORE the
 * pasteboard conversion (`screen = pasteboard * scale + pan`, inverted as
 * `pasteboard = (screen - pan) / scale`): quantizing `scale` there let its
 * relative error get multiplied by the raw (intentionally unbounded, infinite
 * canvas) pan magnitude on conversion, so at large pans the quantized rect could
 * fall short of the true visible rect beyond the overscan margin and silently cull
 * visible nodes. Snapping the already-converted rect outward instead can only ever
 * over-cover it.
 */
export function quantizeCullingRect(rect: Aabb): Aabb {
	const size = Math.max(rect.maxX - rect.minX, rect.maxY - rect.minY);
	if (!(size > 0)) return rect;
	const quantum = cullRectQuantum(size);
	return {
		minX: normalizeZero(Math.floor(rect.minX / quantum) * quantum),
		minY: normalizeZero(Math.floor(rect.minY / quantum) * quantum),
		maxX: normalizeZero(Math.ceil(rect.maxX / quantum) * quantum),
		maxY: normalizeZero(Math.ceil(rect.maxY / quantum) * quantum),
	};
}

/**
 * Shifts a pasteboard-space rect into one artboard's local space. Artboard groups
 * render under `translate(position)`, so node AABBs are artboard-local; the visible
 * rect must be moved by `-position` to compare against them.
 */
export function rectForArtboard(
	rect: Aabb,
	position: { readonly x: number; readonly y: number },
): Aabb {
	return {
		minX: rect.minX - position.x,
		minY: rect.minY - position.y,
		maxX: rect.maxX - position.x,
		maxY: rect.maxY - position.y,
	};
}

const transformPoint = (point: Vec2, matrix: Matrix2D): Vec2 => ({
	x: matrix.a * point.x + matrix.c * point.y + matrix.e,
	y: matrix.b * point.x + matrix.d * point.y + matrix.f,
});

const transformPaintPoint = (
	point: Vec2,
	transform: PaintTransform | undefined,
): Vec2 =>
	transform
		? {
				x: transform.a * point.x + transform.c * point.y + transform.e,
				y: transform.b * point.x + transform.d * point.y + transform.f,
			}
		: point;

const boundsCorners = (bounds: Bounds): readonly [Vec2, Vec2, Vec2, Vec2] => [
	{ x: bounds.x, y: bounds.y },
	{ x: bounds.x + bounds.width, y: bounds.y },
	{ x: bounds.x + bounds.width, y: bounds.y + bounds.height },
	{ x: bounds.x, y: bounds.y + bounds.height },
];

const unionAabb = (left: Aabb, right: Aabb): Aabb => ({
	minX: Math.min(left.minX, right.minX),
	minY: Math.min(left.minY, right.minY),
	maxX: Math.max(left.maxX, right.maxX),
	maxY: Math.max(left.maxY, right.maxY),
});

const meshPaintLocalAabb = (paint: MeshGradientPaint): Aabb | null => {
	const bounds = meshBounds(paint);
	if (bounds.width <= 0 || bounds.height <= 0) return null;
	return aabbFromPoints(
		boundsCorners(bounds).map((point) =>
			transformPaintPoint(point, paint.transform),
		),
	);
};

/**
 * Paint-aware culling bounds for meshes whose authored points or tangent handles
 * extend outside the node's geometry box. Entity spatial bounds intentionally stay
 * geometry-first for hit testing; the canvas culling seam is where we can be more
 * conservative and keep heavy mesh previews mounted when their raster surface is
 * about to enter view.
 */
export function nodeVisualCullAabb(node: VectorNode): Aabb {
	const base = sceneNodeVisualAabb(node);
	const meshPaints = [
		...(node.style.fills ?? []),
		...(node.style.strokes ?? []),
	]
		.filter(
			(paint): paint is MeshGradientPaint => paint.kind === "mesh-gradient",
		)
		.map(meshPaintLocalAabb)
		.filter((aabb): aabb is Aabb => aabb !== null);
	if (meshPaints.length === 0) return base;
	const nodeMatrix = matrixFromTransform(node.transform);
	const transformedMeshAabb = meshPaints
		.map((aabb) =>
			aabbFromPoints(
				[
					{ x: aabb.minX, y: aabb.minY },
					{ x: aabb.maxX, y: aabb.minY },
					{ x: aabb.maxX, y: aabb.maxY },
					{ x: aabb.minX, y: aabb.maxY },
				].map((point) => transformPoint(point, nodeMatrix)),
			),
		)
		.reduce(unionAabb);
	return unionAabb(base, transformedMeshAabb);
}

/**
 * Whether a node's full painted bounds (geometry + stroke + visible effects)
 * intersect the artboard-local visible rect. Pass the PRESENTATION node (sampled
 * transform) so a node animating into view is included on the frame it enters.
 */
export function isNodeInView(
	node: VectorNode,
	visibleArtboardRect: Aabb,
): boolean {
	return aabbIntersects(nodeVisualCullAabb(node), visibleArtboardRect);
}

export type NodeRenderCullingOptions = {
	/**
	 * Node ids that must remain mounted even when their current sampled bounds are
	 * outside the viewport. Imperative playback and other live adapters need a
	 * stable DOM target; this keeps that contract local to culling callers instead
	 * of disabling viewport culling for the whole artboard.
	 */
	readonly forceMountedNodeIds?: ReadonlySet<string>;
};

/**
 * The widget-level render predicate for node viewport culling. `null` means the
 * culling gate is disabled, while force-mounted ids create a narrow keep-alive
 * path for runtime adapters that patch already-rendered SVG nodes.
 */
export function shouldRenderNodeInView(
	node: VectorNode,
	visibleArtboardRect: Aabb | null,
	options: NodeRenderCullingOptions = {},
): boolean {
	if (!visibleArtboardRect) return true;
	if (options.forceMountedNodeIds?.has(node.id)) return true;
	return isNodeInView(node, visibleArtboardRect);
}
