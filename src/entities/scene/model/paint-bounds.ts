import { composeMatrix, type Matrix2D } from "./rendering";
import type {
	Bounds,
	MeshGradientPaint,
	MeshPoint,
	Paint,
	PaintTransform,
	Vec2,
} from "./types";

/**
 * Bounds-equality / degeneracy threshold in scene units (px). Two bounds within
 * this on every component are treated as identical, so the remap is skipped and
 * the paint is returned by reference — the proven same-size "Paste appearance"
 * path stays byte-identical. Distinct from {@link invertMatrix}'s 1e-10 singular
 * threshold, which guards matrix inversion rather than bounds equality.
 */
const PAINT_BOUNDS_EPS = 1e-6;

const isFiniteBounds = (b: Bounds): boolean =>
	Number.isFinite(b.x) &&
	Number.isFinite(b.y) &&
	Number.isFinite(b.width) &&
	Number.isFinite(b.height);

/**
 * Whether gradient/mesh paint geometry must be remapped from source bounds `b0`
 * to target bounds `b1`. Returns false — so the caller copies the paint verbatim
 * — when either box is non-finite, degenerate (zero extent would divide by zero),
 * or effectively equal (same-size paste stays byte-identical).
 */
export function boundsRemapNeeded(b0: Bounds, b1: Bounds): boolean {
	if (!isFiniteBounds(b0) || !isFiniteBounds(b1)) return false;
	if (
		Math.abs(b0.width) <= PAINT_BOUNDS_EPS ||
		Math.abs(b0.height) <= PAINT_BOUNDS_EPS ||
		Math.abs(b1.width) <= PAINT_BOUNDS_EPS ||
		Math.abs(b1.height) <= PAINT_BOUNDS_EPS
	) {
		return false;
	}
	return (
		Math.abs(b1.x - b0.x) > PAINT_BOUNDS_EPS ||
		Math.abs(b1.y - b0.y) > PAINT_BOUNDS_EPS ||
		Math.abs(b1.width - b0.width) > PAINT_BOUNDS_EPS ||
		Math.abs(b1.height - b0.height) > PAINT_BOUNDS_EPS
	);
}

/** Precomputed bbox-fit affine `b0 -> b1` plus its per-axis ratios. */
type RemapContext = {
	readonly b0: Bounds;
	readonly b1: Bounds;
	readonly sx: number;
	readonly sy: number;
};

const contextFor = (b0: Bounds, b1: Bounds): RemapContext => ({
	b0,
	b1,
	sx: b1.width / b0.width,
	sy: b1.height / b0.height,
});

/** Maps a POSITION from b0-space into b1-space (translation included). */
const mapPoint = (p: Vec2, c: RemapContext): Vec2 => ({
	x: c.b1.x + (p.x - c.b0.x) * c.sx,
	y: c.b1.y + (p.y - c.b0.y) * c.sy,
});

/** Scales a MAGNITUDE/offset (radius, mesh handle) — no translation. */
const mapMagnitude = (v: Vec2, c: RemapContext): Vec2 => ({
	x: v.x * c.sx,
	y: v.y * c.sy,
});

/**
 * Conjugates a node-local paint transform `T` by the bbox-fit affine `S`
 * (`S∘T∘S⁻¹`) so a paint that carried an explicit transform keeps the same
 * visual relationship after refit. Reuses {@link composeMatrix}; an absent
 * transform is never synthesized (identity conjugates to identity).
 */
const conjugateTransform = (
	t: PaintTransform,
	c: RemapContext,
): PaintTransform => {
	const ex = c.b1.x - c.b0.x * c.sx;
	const fy = c.b1.y - c.b0.y * c.sy;
	const s: Matrix2D = { a: c.sx, b: 0, c: 0, d: c.sy, e: ex, f: fy };
	const sInv: Matrix2D = {
		a: 1 / c.sx,
		b: 0,
		c: 0,
		d: 1 / c.sy,
		e: -ex / c.sx,
		f: -fy / c.sy,
	};
	return composeMatrix(s, composeMatrix(t, sInv));
};

const remapMeshPoint = (point: MeshPoint, c: RemapContext): MeshPoint => ({
	...point,
	point: mapPoint(point.point, c),
	...(point.handleUp ? { handleUp: mapMagnitude(point.handleUp, c) } : {}),
	...(point.handleDown
		? { handleDown: mapMagnitude(point.handleDown, c) }
		: {}),
	...(point.handleLeft
		? { handleLeft: mapMagnitude(point.handleLeft, c) }
		: {}),
	...(point.handleRight
		? { handleRight: mapMagnitude(point.handleRight, c) }
		: {}),
});

const remapMesh = (
	paint: MeshGradientPaint,
	c: RemapContext,
): MeshGradientPaint => ({
	// Built explicitly (not spread) so any render-time `dataUrl` carried at
	// runtime is dropped: the raster bridge keys its cache on points/topology and
	// excludes dataUrl, so the moved points re-rasterize on next render.
	kind: "mesh-gradient",
	rows: paint.rows,
	cols: paint.cols,
	points: paint.points.map((point) => remapMeshPoint(point, c)),
	...(paint.opacity !== undefined ? { opacity: paint.opacity } : {}),
	...(paint.visible !== undefined ? { visible: paint.visible } : {}),
	...(paint.transform
		? { transform: conjugateTransform(paint.transform, c) }
		: {}),
});

/**
 * Refits one gradient/mesh paint from source node-local bounds `b0` into target
 * bounds `b1`, so pasting an appearance onto a differently-sized object scales
 * the paint to fill it (Figma-like) instead of keeping the source's absolute
 * userSpaceOnUse coordinates. Returns the paint unchanged (same reference) when
 * {@link boundsRemapNeeded} is false. Solid and image-reference base paints have
 * no bounds-space geometry; only an explicit paint transform is conjugated.
 */
export function remapPaintBounds(paint: Paint, b0: Bounds, b1: Bounds): Paint {
	if (!boundsRemapNeeded(b0, b1)) return paint;
	const c = contextFor(b0, b1);
	switch (paint.kind) {
		case "solid":
			return paint;
		case "linear-gradient":
			return {
				...paint,
				from: mapPoint(paint.from, c),
				to: mapPoint(paint.to, c),
				...(paint.transform
					? { transform: conjugateTransform(paint.transform, c) }
					: {}),
			};
		case "radial-gradient":
			return {
				...paint,
				center: mapPoint(paint.center, c),
				radius: mapMagnitude(paint.radius, c),
				...(paint.transform
					? { transform: conjugateTransform(paint.transform, c) }
					: {}),
			};
		case "mesh-gradient":
			return remapMesh(paint, c);
		case "image-reference":
			return paint.transform
				? { ...paint, transform: conjugateTransform(paint.transform, c) }
				: paint;
	}
}

/**
 * Refits a paint stack (fills or strokes). Returns the SAME array reference when
 * no remap is needed, so a same-size paste keeps the proven byte-identical diff.
 */
export function remapPaintListBounds(
	paints: readonly Paint[] | undefined,
	b0: Bounds,
	b1: Bounds,
): readonly Paint[] | undefined {
	if (paints === undefined) return undefined;
	if (!boundsRemapNeeded(b0, b1)) return paints;
	return paints.map((paint) => remapPaintBounds(paint, b0, b1));
}
