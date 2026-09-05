import { hexToRgb, hsvToRgb, rgbToHex, rgbToHsv } from "@/shared/color";
import {
	encodePngDataUrl,
	type MeshCorner,
	type MeshEdge,
	type MeshPatch,
	rasterizeMesh,
} from "@/shared/mesh-raster";
import { getGeometryBounds } from "./rendering";
import type {
	Bounds,
	MeshGradientPaint,
	MeshPoint,
	NodeGeometry,
	Vec2,
	VectorNode,
} from "./types";

/**
 * Gradient-mesh authoring + derivation helpers. The stored model is a grid of
 * mesh points ({@link MeshGradientPaint}); this module is the single seam that
 * DERIVES Coons patches for the rasterizer/exporters and builds default grids.
 * It stays strictly DOM-free (the architecture check scans this directory) — all
 * rasterization lives in `@/shared/mesh-raster`.
 *
 * Mesh points are addressed by their stable `(row, col)` grid position, so unlike
 * gradient stops there is no per-point id to hydrate.
 */

const MIN_GRID = 2;
const HEX_RADIX = 16;
const RGB_MAX = 255;

const DEFAULT_CORNER_COLORS: readonly [string, string, string, string] = [
	"#ef4444", // TL red
	"#eab308", // TR amber
	"#3b82f6", // BR blue
	"#22c55e", // BL green
];

type Rgb = { readonly r: number; readonly g: number; readonly b: number };

const parseHex = (color: string): Rgb | null => {
	const hex = color.trim().replace(/^#/, "");
	const expanded =
		hex.length === 3
			? hex
					.split("")
					.map((channel) => channel + channel)
					.join("")
			: hex;
	if (expanded.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(expanded)) return null;
	return {
		r: Number.parseInt(expanded.slice(0, 2), HEX_RADIX),
		g: Number.parseInt(expanded.slice(2, 4), HEX_RADIX),
		b: Number.parseInt(expanded.slice(4, 6), HEX_RADIX),
	};
};

const toHexChannel = (value: number): string =>
	Math.round(Math.min(RGB_MAX, Math.max(0, value)))
		.toString(HEX_RADIX)
		.padStart(2, "0");

/** Bilinear sRGB blend of the four corner colors at grid fraction `(fx, fy)`. */
const bilinearColor = (
	corners: readonly [string, string, string, string],
	fx: number,
	fy: number,
): string => {
	const tl = parseHex(corners[0]);
	const tr = parseHex(corners[1]);
	const br = parseHex(corners[2]);
	const bl = parseHex(corners[3]);
	if (!tl || !tr || !br || !bl) return corners[0];
	const w0 = (1 - fx) * (1 - fy);
	const w1 = fx * (1 - fy);
	const w2 = fx * fy;
	const w3 = (1 - fx) * fy;
	const mix = (a: number, b: number, c: number, d: number): number =>
		w0 * a + w1 * b + w2 * c + w3 * d;
	return `#${toHexChannel(mix(tl.r, tr.r, br.r, bl.r))}${toHexChannel(
		mix(tl.g, tr.g, br.g, bl.g),
	)}${toHexChannel(mix(tl.b, tr.b, br.b, bl.b))}`;
};

/**
 * Builds an evenly-spaced `rows × cols` mesh grid filling `bounds`, with point
 * colors bilinearly interpolated from four corner colors. This is the
 * programmatic factory (no UI); the authoring tool composes it in a later phase.
 * `rows`/`cols` are clamped to at least 2 so the grid always forms ≥1 patch.
 */
export function createMeshGrid(
	bounds: Bounds,
	rows: number,
	cols: number,
	cornerColors: readonly [
		string,
		string,
		string,
		string,
	] = DEFAULT_CORNER_COLORS,
): MeshGradientPaint {
	const safeRows = Math.max(MIN_GRID, Math.floor(rows));
	const safeCols = Math.max(MIN_GRID, Math.floor(cols));
	const points: MeshPoint[] = [];
	for (let row = 0; row < safeRows; row += 1) {
		const fy = row / (safeRows - 1);
		for (let col = 0; col < safeCols; col += 1) {
			const fx = col / (safeCols - 1);
			points.push({
				point: {
					x: bounds.x + bounds.width * fx,
					y: bounds.y + bounds.height * fy,
				},
				color: bilinearColor(cornerColors, fx, fy),
			});
		}
	}
	return { kind: "mesh-gradient", rows: safeRows, cols: safeCols, points };
}

/** Geometry kinds with a paintable interior that can carry a mesh fill. */
export const MESH_FILLABLE_KINDS: ReadonlySet<NodeGeometry["kind"]> = new Set([
	"rect",
	"ellipse",
	"polygon",
	"star",
	"path",
]);

/** Default grid size for a freshly created mesh (3×3 points = 4 patches). */
export const DEFAULT_MESH_GRID = 3;

/** Seed color when a node has no usable fill (none/transparent/empty). */
const MESH_FALLBACK_SEED = "#9ca3af";

const isVisibleSeedColor = (value: string): boolean => {
	const normalized = value.trim().toLowerCase();
	return (
		normalized !== "" && normalized !== "none" && normalized !== "transparent"
	);
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/** Brightness lift of the lightest (top-left) corner over the base fill. */
const MESH_SEED_HIGHLIGHT_V = 0.18;
/** Brightness drop of the darkest (bottom-right) corner under the base fill. */
const MESH_SEED_SHADOW_V = -0.22;
/**
 * Saturation below which a base is treated as achromatic. For a white/gray/black
 * fill `rgbToHsv` returns an undefined hue (defaulted to 0 = red), so adding any
 * saturation would tint the gradient warm/red; at/under this threshold the seed
 * keeps saturation flat and varies only brightness, staying a neutral gray ramp.
 */
const MESH_SEED_ACHROMATIC_S = 0.04;

/**
 * Four tonal corner colors derived from one base fill, so a freshly created mesh
 * shows an immediate, tasteful gradient instead of a flat single color. Seeding a
 * mesh with the object's flat fill made meshing a solid shape look like nothing
 * happened (every point identical → no visible change); a tonal seed gives instant
 * feedback that the shape is now a gradient. Brightness varies along the TL→BR
 * diagonal (light → dark) with a slight saturation lift toward the shadow, staying
 * in the base hue so the result reads as a dimensional version of the object's own
 * color. An achromatic base (white/gray/black) keeps saturation flat so the ramp
 * stays neutral instead of tinting red. Order is `[TL, TR, BR, BL]`, matching
 * {@link createMeshGrid}. A non-hex base (gradient/none seed) falls back to a flat
 * set rather than guessing a hue.
 */
export function defaultMeshCornerColors(
	base: string,
): readonly [string, string, string, string] {
	const rgb = hexToRgb(base);
	if (!rgb) return [base, base, base, base];
	const hsv = rgbToHsv(rgb);
	const achromatic = hsv.s <= MESH_SEED_ACHROMATIC_S;
	const tone = (deltaV: number, deltaS: number): string =>
		rgbToHex(
			hsvToRgb({
				h: hsv.h,
				s: clamp01(hsv.s + (achromatic ? 0 : deltaS)),
				v: clamp01(hsv.v + deltaV),
			}),
		);
	return [
		tone(MESH_SEED_HIGHLIGHT_V, -0.05),
		tone(0.05, 0),
		tone(MESH_SEED_SHADOW_V, 0.08),
		tone(-0.06, 0.03),
	];
}

/**
 * Builds the default gradient mesh used when converting a node's fill to a mesh: a
 * 3×3 grid filling the node's geometry bounds, tonally seeded from its current fill
 * via {@link defaultMeshCornerColors}. Shared by the on-canvas mesh tool and the
 * Inspector "convert to mesh" affordance so both produce an identical starting mesh.
 */
export function buildDefaultMeshForNode(node: VectorNode): MeshGradientPaint {
	const bounds = getGeometryBounds(node.geometry);
	const base = isVisibleSeedColor(node.style.fill)
		? node.style.fill
		: MESH_FALLBACK_SEED;
	return createMeshGrid(
		bounds,
		DEFAULT_MESH_GRID,
		DEFAULT_MESH_GRID,
		defaultMeshCornerColors(base),
	);
}

/**
 * Node-local bounding box covering all mesh points AND their tangent-handle
 * control points (so an outward-bowing Coons curve is not clipped by the
 * `<pattern>`/raster region). Every coordinate is finite-guarded: a non-finite
 * point/handle (corrupt input) contributes nothing rather than poisoning the
 * bounds with `NaN` — `NaN <= 0` is false, so a `NaN` width would slip past the
 * downstream degenerate-fill guards and throw in the PNG encoder. An empty or
 * all-non-finite mesh returns a zero box, which those guards treat as "no fill".
 */
export function meshBounds(paint: MeshGradientPaint): Bounds {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	const expand = (x: number, y: number): void => {
		if (!Number.isFinite(x) || !Number.isFinite(y)) return;
		if (x < minX) minX = x;
		if (y < minY) minY = y;
		if (x > maxX) maxX = x;
		if (y > maxY) maxY = y;
	};
	for (const meshPoint of paint.points) {
		expand(meshPoint.point.x, meshPoint.point.y);
		for (const handle of [
			meshPoint.handleUp,
			meshPoint.handleDown,
			meshPoint.handleLeft,
			meshPoint.handleRight,
		]) {
			if (handle)
				expand(meshPoint.point.x + handle.x, meshPoint.point.y + handle.y);
		}
	}
	if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Row-major index of a mesh point, or `-1` when `(row, col)` is out of range. */
export function meshPointIndex(
	paint: MeshGradientPaint,
	row: number,
	col: number,
): number {
	if (row < 0 || col < 0 || row >= paint.rows || col >= paint.cols) return -1;
	return row * paint.cols + col;
}

/** The mesh point at `(row, col)`, or `undefined` when out of range. */
export function meshPointAt(
	paint: MeshGradientPaint,
	row: number,
	col: number,
): MeshPoint | undefined {
	const index = meshPointIndex(paint, row, col);
	return index < 0 ? undefined : paint.points[index];
}

const replacePoint = (
	paint: MeshGradientPaint,
	row: number,
	col: number,
	next: (point: MeshPoint) => MeshPoint,
): MeshGradientPaint => {
	const index = meshPointIndex(paint, row, col);
	if (index < 0) return paint;
	return {
		...paint,
		points: paint.points.map((point, i) => (i === index ? next(point) : point)),
	};
};

/** Sets one mesh point's color (node-local grid address); other points untouched. */
export function setMeshPointColor(
	paint: MeshGradientPaint,
	row: number,
	col: number,
	color: string,
): MeshGradientPaint {
	return replacePoint(paint, row, col, (point) => ({ ...point, color }));
}

/** Sets one mesh point's opacity (clamped to [0, 1]); other points untouched. */
export function setMeshPointOpacity(
	paint: MeshGradientPaint,
	row: number,
	col: number,
	opacity: number,
): MeshGradientPaint {
	const clamped = Number.isFinite(opacity)
		? Math.min(1, Math.max(0, opacity))
		: 1;
	return replacePoint(paint, row, col, (point) => ({
		...point,
		opacity: clamped,
	}));
}

/** Moves one mesh point to a node-local position; other points untouched. */
export function moveMeshPoint(
	paint: MeshGradientPaint,
	row: number,
	col: number,
	point: Vec2,
): MeshGradientPaint {
	return replacePoint(paint, row, col, (current) => ({ ...current, point }));
}

/**
 * Nearest mesh point to a node-local query point within `tolerance` units, or
 * `null`. Used by the mesh tool's hit-testing after it projects a screen point
 * into node-local space (the same projection the gradient tool uses).
 */
export function nearestMeshPoint(
	paint: MeshGradientPaint,
	query: Vec2,
	tolerance: number,
): { readonly row: number; readonly col: number } | null {
	let best: { row: number; col: number } | null = null;
	let bestDistSq = tolerance * tolerance;
	for (let row = 0; row < paint.rows; row += 1) {
		for (let col = 0; col < paint.cols; col += 1) {
			const point = paint.points[row * paint.cols + col];
			if (!point) continue;
			const dx = point.point.x - query.x;
			const dy = point.point.y - query.y;
			const distSq = dx * dx + dy * dy;
			if (distSq <= bestDistSq) {
				bestDistSq = distSq;
				best = { row, col };
			}
		}
	}
	return best;
}

export type MeshHandleDirection = "up" | "down" | "left" | "right";

const HANDLE_FIELD = {
	up: "handleUp",
	down: "handleDown",
	left: "handleLeft",
	right: "handleRight",
} as const satisfies Record<MeshHandleDirection, keyof MeshPoint>;

const NEIGHBOR_DELTA = {
	up: [-1, 0],
	down: [1, 0],
	left: [0, -1],
	right: [0, 1],
} as const satisfies Record<MeshHandleDirection, readonly [number, number]>;

/** Where an unset handle's grab dot rests: a quarter of the way to the neighbour. */
const DEFAULT_HANDLE_FRACTION = 0.25;

/** Sets one tangent handle (node-local offset from the point); others untouched. */
export function setMeshPointHandle(
	paint: MeshGradientPaint,
	row: number,
	col: number,
	direction: MeshHandleDirection,
	offset: Vec2,
): MeshGradientPaint {
	const field = HANDLE_FIELD[direction];
	return replacePoint(paint, row, col, (point) => ({
		...point,
		[field]: offset,
	}));
}

/**
 * Node-local position of a point's tangent-handle grab dot for `direction`, or
 * `null` when that direction has no grid neighbour (an outer-edge point has fewer
 * handles). Uses the explicit handle offset when set, else a default rest position
 * a quarter of the way toward the neighbour so the dot is grabbable before any
 * handle exists. Shared by the tool's hit-testing and the overlay's rendering so
 * they never disagree.
 */
export function meshHandleRest(
	paint: MeshGradientPaint,
	row: number,
	col: number,
	direction: MeshHandleDirection,
): Vec2 | null {
	const point = meshPointAt(paint, row, col);
	if (!point) return null;
	const [dr, dc] = NEIGHBOR_DELTA[direction];
	const neighbor = meshPointAt(paint, row + dr, col + dc);
	if (!neighbor) return null;
	const explicit = point[HANDLE_FIELD[direction]];
	if (explicit) {
		return { x: point.point.x + explicit.x, y: point.point.y + explicit.y };
	}
	return {
		x:
			point.point.x +
			(neighbor.point.x - point.point.x) * DEFAULT_HANDLE_FRACTION,
		y:
			point.point.y +
			(neighbor.point.y - point.point.y) * DEFAULT_HANDLE_FRACTION,
	};
}

/** All handle directions that have a grid neighbour for `(row, col)`. */
export function meshHandleDirections(
	paint: MeshGradientPaint,
	row: number,
	col: number,
): readonly MeshHandleDirection[] {
	return (["up", "down", "left", "right"] as const).filter((direction) => {
		const [dr, dc] = NEIGHBOR_DELTA[direction];
		return meshPointAt(paint, row + dr, col + dc) !== undefined;
	});
}

const addOffset = (point: Vec2, offset: Vec2 | undefined): Vec2 | null =>
	offset ? { x: point.x + offset.x, y: point.y + offset.y } : null;

/**
 * Cubic boundary edge from point `a` to point `b`. Control points come from the
 * facing tangent handle offsets when present; an absent handle falls back to the
 * even 1/3–2/3 split, which reproduces a straight edge exactly so a handle-free
 * mesh derives byte-identically to the pre-tangent behavior.
 */
const edgeBetween = (
	a: Vec2,
	aHandle: Vec2 | undefined,
	b: Vec2,
	bHandle: Vec2 | undefined,
): MeshEdge => [
	a,
	addOffset(a, aHandle) ?? {
		x: a.x + (b.x - a.x) / 3,
		y: a.y + (b.y - a.y) / 3,
	},
	addOffset(b, bHandle) ?? {
		x: a.x + (2 * (b.x - a.x)) / 3,
		y: a.y + (2 * (b.y - a.y)) / 3,
	},
	b,
];

const cornerOf = (meshPoint: MeshPoint): MeshCorner =>
	meshPoint.opacity === undefined
		? { point: meshPoint.point, color: meshPoint.color }
		: {
				point: meshPoint.point,
				color: meshPoint.color,
				opacity: meshPoint.opacity,
			};

/**
 * Derives the `(rows-1) × (cols-1)` Coons patches the rasterizer/PDF consume from
 * a stored grid-of-points mesh. Edges are currently straight (flat tangents);
 * Phase-3 tangent handles replace `straightEdge` with the points' control offsets.
 * Winding is top → right → bottom → left with corners `[TL, TR, BR, BL]`, matching
 * the rasterizer's {@link MeshPatch} contract.
 */
export function coonsPatchesFromMesh(
	paint: MeshGradientPaint,
): readonly MeshPatch[] {
	const { rows, cols, points } = paint;
	if (rows < MIN_GRID || cols < MIN_GRID) return [];
	const at = (row: number, col: number): MeshPoint | undefined =>
		points[row * cols + col];
	const patches: MeshPatch[] = [];
	for (let row = 0; row < rows - 1; row += 1) {
		for (let col = 0; col < cols - 1; col += 1) {
			const tl = at(row, col);
			const tr = at(row, col + 1);
			const br = at(row + 1, col + 1);
			const bl = at(row + 1, col);
			if (!tl || !tr || !br || !bl) continue;
			patches.push({
				edges: [
					// top TL→TR, right TR→BR, bottom BR→BL, left BL→TL — each edge uses
					// the two endpoints' handles facing along that edge.
					edgeBetween(tl.point, tl.handleRight, tr.point, tr.handleLeft),
					edgeBetween(tr.point, tr.handleDown, br.point, br.handleUp),
					edgeBetween(br.point, br.handleLeft, bl.point, bl.handleRight),
					edgeBetween(bl.point, bl.handleUp, tl.point, tl.handleDown),
				],
				corners: [cornerOf(tl), cornerOf(tr), cornerOf(br), cornerOf(bl)],
			});
		}
	}
	return patches;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** sRGB-channel lerp between two hex colors; non-hex inputs snap to the nearer end. */
const lerpHexColor = (from: string, to: string, t: number): string => {
	const a = parseHex(from);
	const b = parseHex(to);
	if (!a || !b) return t < 0.5 ? from : to;
	return `#${toHexChannel(lerp(a.r, b.r, t))}${toHexChannel(
		lerp(a.g, b.g, t),
	)}${toHexChannel(lerp(a.b, b.b, t))}`;
};

const lerpMeshPoint = (
	from: MeshPoint,
	to: MeshPoint,
	t: number,
): MeshPoint => {
	const opacity = lerp(from.opacity ?? 1, to.opacity ?? 1, t);
	return {
		point: {
			x: lerp(from.point.x, to.point.x, t),
			y: lerp(from.point.y, to.point.y, t),
		},
		color: lerpHexColor(from.color, to.color, t),
		...(opacity === 1 ? {} : { opacity }),
		// v1 does not animate tangent handles: carry the `from` key's handles (they
		// are offsets, so they ride along as the point position lerps).
		...(from.handleUp ? { handleUp: from.handleUp } : {}),
		...(from.handleDown ? { handleDown: from.handleDown } : {}),
		...(from.handleLeft ? { handleLeft: from.handleLeft } : {}),
		...(from.handleRight ? { handleRight: from.handleRight } : {}),
	};
};

/**
 * Interpolates two mesh snapshots at `t ∈ [0,1]`: each point's position, sRGB
 * color, and opacity are lerped. Topology must match (same `rows`/`cols`/point
 * count); mismatched snapshots cannot tween, so the result HOLDS the `from`
 * snapshot until the next key (mirroring path-shape topology-mismatch behavior).
 * Tangent handles are not animated in v1 (the `from` key's handles are carried).
 * Returns an input snapshot unchanged in the hold case (meshes are immutable).
 */
export function interpolateMesh(
	from: MeshGradientPaint,
	to: MeshGradientPaint,
	t: number,
): MeshGradientPaint {
	if (
		from.rows !== to.rows ||
		from.cols !== to.cols ||
		from.points.length !== to.points.length
	) {
		return t >= 1 ? to : from;
	}
	return {
		...from,
		points: from.points.map((point, index) =>
			lerpMeshPoint(point, to.points[index], t),
		),
	};
}

/**
 * Position/color/opacity blend of two grid points for a freshly inserted mesh
 * line. Deliberately drops tangent handles: a collinear split keeps a straight
 * mesh visually byte-faithful, and the bilinear COLOR field is reproduced exactly
 * (the rasterizer interpolates color bilinearly per patch, so a point inserted at
 * fraction `t` along a grid line carries the same color the surface already shows
 * there). On a handle-curved edge the new line flattens the curve locally — a
 * conscious v1 cut; a full de Casteljau split that re-curves both halves is the
 * deferred refinement.
 */
const insertedMeshPoint = (
	a: MeshPoint,
	b: MeshPoint,
	t: number,
): MeshPoint => {
	const opacity = lerp(a.opacity ?? 1, b.opacity ?? 1, t);
	return {
		point: {
			x: lerp(a.point.x, b.point.x, t),
			y: lerp(a.point.y, b.point.y, t),
		},
		color: lerpHexColor(a.color, b.color, t),
		...(opacity === 1 ? {} : { opacity }),
	};
};

/** Keeps an insert fraction off the exact endpoints so a new line never coincides
 *  with an existing one (which would emit a zero-area, useless duplicate row/col). */
const INSERT_T_EPSILON = 0.001;
const clampInsertT = (t: number): number =>
	Math.min(1 - INSERT_T_EPSILON, Math.max(INSERT_T_EPSILON, t));

/**
 * Inserts a new mesh row between rows `afterRow` and `afterRow+1` at vertical
 * fraction `t`, interpolating every column. Appearance-preserving: the rendered
 * gradient is unchanged because each new point sits on the surface's existing
 * color (and, for straight edges, position) at that fraction. No-op for an
 * out-of-range `afterRow`.
 */
export function insertMeshRow(
	paint: MeshGradientPaint,
	afterRow: number,
	t: number,
): MeshGradientPaint {
	const { rows, cols, points } = paint;
	if (afterRow < 0 || afterRow >= rows - 1) return paint;
	const clamped = clampInsertT(t);
	const at = (row: number, col: number): MeshPoint => points[row * cols + col];
	const next: MeshPoint[] = [];
	for (let row = 0; row < rows; row += 1) {
		for (let col = 0; col < cols; col += 1) next.push(at(row, col));
		if (row === afterRow) {
			for (let col = 0; col < cols; col += 1) {
				next.push(
					insertedMeshPoint(at(afterRow, col), at(afterRow + 1, col), clamped),
				);
			}
		}
	}
	return { ...paint, rows: rows + 1, points: next };
}

/**
 * Inserts a new mesh column between columns `afterCol` and `afterCol+1` at
 * horizontal fraction `t`, interpolating every row. Appearance-preserving (see
 * {@link insertMeshRow}). No-op for an out-of-range `afterCol`.
 */
export function insertMeshColumn(
	paint: MeshGradientPaint,
	afterCol: number,
	t: number,
): MeshGradientPaint {
	const { rows, cols, points } = paint;
	if (afterCol < 0 || afterCol >= cols - 1) return paint;
	const clamped = clampInsertT(t);
	const at = (row: number, col: number): MeshPoint => points[row * cols + col];
	const next: MeshPoint[] = [];
	for (let row = 0; row < rows; row += 1) {
		for (let col = 0; col < cols; col += 1) {
			next.push(at(row, col));
			if (col === afterCol) {
				next.push(
					insertedMeshPoint(at(row, afterCol), at(row, afterCol + 1), clamped),
				);
			}
		}
	}
	return { ...paint, cols: cols + 1, points: next };
}

/** Removes mesh row `row`; no-op when it would drop below the {@link MIN_GRID}
 *  floor or the index is out of range. Other rows keep their relative order. */
export function removeMeshRow(
	paint: MeshGradientPaint,
	row: number,
): MeshGradientPaint {
	const { rows, cols, points } = paint;
	if (rows <= MIN_GRID || row < 0 || row >= rows) return paint;
	const next = points.filter((_, index) => Math.floor(index / cols) !== row);
	return { ...paint, rows: rows - 1, points: next };
}

/** Removes mesh column `col`; no-op when it would drop below {@link MIN_GRID}
 *  or the index is out of range. Other columns keep their relative order. */
export function removeMeshColumn(
	paint: MeshGradientPaint,
	col: number,
): MeshGradientPaint {
	const { cols, points } = paint;
	if (cols <= MIN_GRID || col < 0 || col >= cols) return paint;
	const next = points.filter((_, index) => index % cols !== col);
	return { ...paint, cols: cols - 1, points: next };
}

/**
 * Whether the mesh point at `(row, col)` can be removed: true when it sits on at
 * least one INTERIOR mesh line (row or column away from the boundary). Boundary
 * lines define the shape's mesh edge — removing them would shrink the mesh below
 * the geometry — so the four corner points (boundary on both axes) are never
 * removable. The single source of truth shared by the canvas delete path and the
 * Inspector remove button's enabled state, so the gesture and the affordance can
 * never disagree about what is deletable.
 */
export function canRemoveMeshPoint(
	paint: MeshGradientPaint,
	row: number,
	col: number,
): boolean {
	const rowInterior = row > 0 && row < paint.rows - 1;
	const colInterior = col > 0 && col < paint.cols - 1;
	return rowInterior || colInterior;
}

/**
 * Removes the interior mesh lines (row and/or column) passing through point
 * `(row, col)` — the inverse of a face-click subdivide. Boundary lines are kept
 * ({@link canRemoveMeshPoint}), so a corner point returns the input UNCHANGED
 * (callers detect the no-op via referential equality) and an edge point drops
 * only its one interior axis. Shared by the canvas Alt-click/Delete path and the
 * Inspector remove button so both delete identically.
 */
export function removeMeshPointLines(
	paint: MeshGradientPaint,
	row: number,
	col: number,
): MeshGradientPaint {
	let next = paint;
	if (row > 0 && row < paint.rows - 1) next = removeMeshRow(next, row);
	if (col > 0 && col < paint.cols - 1) next = removeMeshColumn(next, col);
	return next;
}

const cross2 = (ax: number, ay: number, bx: number, by: number): number =>
	ax * by - ay * bx;

/**
 * Inverse bilinear map: the `(u, v) ∈ [0,1]²` parameters of `q` inside the quad
 * `[tl, tr, br, bl]` (u left→right, v top→bottom), or `null` when `q` is outside
 * or the quad is degenerate. Solves the quadratic from
 * `q − tl = u·E + v·F + uv·G` (E=tr−tl, F=bl−tl, G=br−bl−tr+tl). Exact for
 * straight (bilinear) patches; an acceptable approximation for handle-curved ones
 * since the result only picks the click target, never the preserved gradient.
 */
const NEAR_ZERO = 1e-9;
export function invBilinear(
	tl: Vec2,
	tr: Vec2,
	br: Vec2,
	bl: Vec2,
	q: Vec2,
): { readonly u: number; readonly v: number } | null {
	const ex = tr.x - tl.x;
	const ey = tr.y - tl.y;
	const fx = bl.x - tl.x;
	const fy = bl.y - tl.y;
	const gx = br.x - bl.x - tr.x + tl.x;
	const gy = br.y - bl.y - tr.y + tl.y;
	const hx = q.x - tl.x;
	const hy = q.y - tl.y;
	// (H − vF) × (E + vG) = 0  →  k2 v² + k1 v + k0 = 0
	const k2 = -cross2(fx, fy, gx, gy);
	const k1 = cross2(hx, hy, gx, gy) - cross2(fx, fy, ex, ey);
	const k0 = cross2(hx, hy, ex, ey);
	const solveU = (v: number): number | null => {
		const denomX = ex + v * gx;
		const denomY = ey + v * gy;
		// Use whichever component has the larger magnitude to stay numerically stable.
		if (Math.abs(denomX) >= Math.abs(denomY)) {
			if (Math.abs(denomX) < NEAR_ZERO) return null;
			return (hx - v * fx) / denomX;
		}
		if (Math.abs(denomY) < NEAR_ZERO) return null;
		return (hy - v * fy) / denomY;
	};
	const candidates: number[] = [];
	if (Math.abs(k2) < NEAR_ZERO) {
		if (Math.abs(k1) < NEAR_ZERO) return null;
		candidates.push(-k0 / k1);
	} else {
		const disc = k1 * k1 - 4 * k2 * k0;
		if (disc < 0) return null;
		const root = Math.sqrt(disc);
		candidates.push((-k1 + root) / (2 * k2), (-k1 - root) / (2 * k2));
	}
	for (const v of candidates) {
		if (v < -NEAR_ZERO || v > 1 + NEAR_ZERO) continue;
		const u = solveU(v);
		if (u === null || u < -NEAR_ZERO || u > 1 + NEAR_ZERO) continue;
		return { u: Math.min(1, Math.max(0, u)), v: Math.min(1, Math.max(0, v)) };
	}
	return null;
}

/** A located mesh patch under a query point: its top-left grid address plus the
 *  local `(u, v)` of the hit, used to insert a row+column intersection there. */
export type MeshPatchHit = {
	readonly row: number;
	readonly col: number;
	readonly u: number;
	readonly v: number;
};

/**
 * The mesh patch (cell) containing node-local point `q`, with the in-patch
 * parameters, or `null` when `q` is outside every patch. Patches tile without
 * overlap, so the first containing cell is the answer.
 */
export function meshPatchAt(
	paint: MeshGradientPaint,
	q: Vec2,
): MeshPatchHit | null {
	const { rows, cols } = paint;
	for (let row = 0; row < rows - 1; row += 1) {
		for (let col = 0; col < cols - 1; col += 1) {
			const tl = meshPointAt(paint, row, col);
			const tr = meshPointAt(paint, row, col + 1);
			const br = meshPointAt(paint, row + 1, col + 1);
			const bl = meshPointAt(paint, row + 1, col);
			if (!tl || !tr || !br || !bl) continue;
			const uv = invBilinear(tl.point, tr.point, br.point, bl.point, q);
			if (uv) return { row, col, u: uv.u, v: uv.v };
		}
	}
	return null;
}

export type MeshImage = {
	readonly dataUrl: string;
	readonly bounds: Bounds;
};

/**
 * Rasterizes a mesh to a PNG data-URL plus its node-local bounds (the `<pattern>`
 * tile box). DOM-free (pure CPU scanner + pure PNG encoder), so it is shared by
 * the canvas render bridge and the imperative motion-playback path without either
 * needing a browser canvas. Returns `null` for a degenerate mesh (no patches /
 * zero-area bounds), letting callers fall back to a flat color.
 */
export function rasterizeMeshToImage(
	paint: MeshGradientPaint,
	deviceScale: number,
): MeshImage | null {
	const bounds = meshBounds(paint);
	if (bounds.width <= 0 || bounds.height <= 0) return null;
	const patches = coonsPatchesFromMesh(paint);
	if (patches.length === 0) return null;
	const raster = rasterizeMesh({ patches, bounds, deviceScale });
	return {
		dataUrl: encodePngDataUrl(raster.pixels, raster.width, raster.height),
		bounds,
	};
}
