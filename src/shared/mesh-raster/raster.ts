/**
 * Pure, DOM-free, Workers-safe CPU rasterizer for Illustrator-style gradient
 * mesh patches. Browsers ship no usable native `<meshgradient>`, so a mesh fill
 * is rendered to an RGBA bitmap here and later wrapped as `<pattern><image>` (live
 * canvas + SVG export) or PNG-encoded ({@link ./png}).
 *
 * DETERMINISM CONTRACT: the inner loop uses only `+ − × ÷` (de Casteljau via
 * Bernstein expansion + linear blends). No `Math.pow`/`exp`/trig/`random`, so the
 * pixel buffer is bit-identical across V8 contexts (browser, Node, Worker). This
 * is the load-bearing property behind the cross-environment fidelity fixture; do
 * not introduce a transcendental into any per-pixel/per-vertex path.
 *
 * COORDINATE SPACES: patch geometry is in node-local units (the same space as
 * `PathGeometry` and gradient `from`/`to`). Output pixels are in device space,
 * mapped by `(nodeLocal - bounds.origin) * deviceScale`. The caller places the
 * resulting bitmap over `bounds` via a `userSpaceOnUse` `<pattern>`.
 *
 * This module consumes the DERIVED patch form ({@link MeshPatch}); the stored
 * grid-of-points model (`MeshGradientPaint`) lives in `entities/scene/model` and
 * is converted to patches by `coonsPatchesFromMesh` so the rasterizer stays
 * topology-agnostic and independently testable.
 */

/** Point in node-local geometry units. Structurally compatible with scene `Vec2`. */
export type RasterPoint = { readonly x: number; readonly y: number };

/** Axis-aligned bounds in node-local units. Structurally compatible with `Bounds`. */
export type RasterBounds = {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
};

/**
 * One mesh corner: a node-local position, an sRGB color, and optional alpha. The
 * color is parsed as `#rgb`/`#rrggbb`/`#rrggbbaa`; unparseable values fall back to
 * a neutral gray so a leaf is never silently invisible.
 */
export type MeshCorner = {
	readonly point: RasterPoint;
	readonly color: string;
	/** 0..1; defaults to 1 when omitted, multiplied into any color alpha. */
	readonly opacity?: number;
};

/** A boundary cubic Bézier as `[P0, C1, C2, P3]` in node-local space. */
export type MeshEdge = readonly [
	RasterPoint,
	RasterPoint,
	RasterPoint,
	RasterPoint,
];

/**
 * One Coons patch (derived, transient — never the stored form). Boundary curves
 * are ordered top → right → bottom → left and share endpoints corner-to-corner;
 * `corners` are `[topLeft, topRight, bottomRight, bottomLeft]`. The winding here
 * MUST match `coonsPatchesFromMesh`; a mismatch garbles the surface in a way unit
 * tests do not obviously catch (the visual Spike-A gate does).
 */
export type MeshPatch = {
	readonly edges: readonly [MeshEdge, MeshEdge, MeshEdge, MeshEdge];
	readonly corners: readonly [MeshCorner, MeshCorner, MeshCorner, MeshCorner];
};

export type MeshRasterRequest = {
	readonly patches: readonly MeshPatch[];
	/** Node-local bounding box the bitmap covers (→ `<pattern>` x/y/width/height). */
	readonly bounds: RasterBounds;
	/**
	 * Device pixels per node-local unit. REQUIRED so callers choose resolution
	 * intentionally: live canvas uses `(zoom/100) * devicePixelRatio`, export uses
	 * a fixed factor. Output dimensions are clamped to {@link MAX_DIMENSION}.
	 */
	readonly deviceScale: number;
	/** Max per-channel color error (0..1) tolerated before a leaf stops subdividing. */
	readonly tolerance?: number;
	/** 4×4 ordered dither at 8-bit quantization to suppress Mach banding. Default on. */
	readonly dither?: boolean;
};

export type MeshRasterResult = {
	/** RGBA, length `width * height * 4`, straight (non-premultiplied) alpha. */
	readonly pixels: Uint8ClampedArray;
	readonly width: number;
	readonly height: number;
	readonly bounds: RasterBounds;
};

type Rgba = readonly [number, number, number, number];

const MAX_DEPTH = 8;
const MAX_DIMENSION = 2048;
const DEFAULT_TOLERANCE = 2 / 255;
/** Max device-pixel bow of a curved edge from its chord before subdividing. */
const GEOMETRY_TOLERANCE_PX = 0.4;
const RGB_MAX = 255;
const FALLBACK_RGBA: Rgba = [156, 163, 175, 255]; // #9ca3af, mirrors gradient fallback

/** 4×4 Bayer matrix normalized to centered offsets in (-0.5, 0.5). */
const BAYER_4 = [
	[0, 8, 2, 10],
	[12, 4, 14, 6],
	[3, 11, 1, 9],
	[15, 7, 13, 5],
].map((row) => row.map((v) => (v + 0.5) / 16 - 0.5));

const clamp01 = (value: number): number =>
	value < 0 ? 0 : value > 1 ? 1 : value;

const hexNibble = (text: string, index: number): number =>
	Number.parseInt(text[index] + text[index], 16);

const hexPair = (text: string, index: number): number =>
	Number.parseInt(text.slice(index, index + 2), 16);

/**
 * Parses an sRGB hex color and folds in a 0..1 corner opacity. Supports `#rgb`,
 * `#rrggbb`, and `#rrggbbaa`; anything else resolves to {@link FALLBACK_RGBA} so a
 * malformed authored color degrades to a visible neutral rather than a hole.
 */
function parseColor(color: string, opacity: number | undefined): Rgba {
	const alphaScale = opacity === undefined ? 1 : clamp01(opacity);
	const hex = color.trim().replace(/^#/, "");
	const valid = /^[0-9a-fA-F]+$/.test(hex);
	if (valid && hex.length === 3) {
		return [
			hexNibble(hex, 0),
			hexNibble(hex, 1),
			hexNibble(hex, 2),
			RGB_MAX * alphaScale,
		];
	}
	if (valid && (hex.length === 6 || hex.length === 8)) {
		const a = hex.length === 8 ? hexPair(hex, 6) : RGB_MAX;
		return [hexPair(hex, 0), hexPair(hex, 2), hexPair(hex, 4), a * alphaScale];
	}
	return [
		FALLBACK_RGBA[0],
		FALLBACK_RGBA[1],
		FALLBACK_RGBA[2],
		FALLBACK_RGBA[3] * alphaScale,
	];
}

/** Cubic Bézier position at `t` via Bernstein expansion (multiply-only). */
function cubicAt(edge: MeshEdge, t: number): RasterPoint {
	const mt = 1 - t;
	const a = mt * mt * mt;
	const b = 3 * mt * mt * t;
	const c = 3 * mt * t * t;
	const d = t * t * t;
	const [p0, p1, p2, p3] = edge;
	return {
		x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
		y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
	};
}

/**
 * Bilinearly blended Coons surface point at `(u, v)` ∈ [0,1]². Edges are top,
 * right, bottom, left (the {@link MeshPatch} order). `top`/`bottom` are
 * reparameterized to a common left→right `u` and `left`/`right` to a common
 * top→bottom `v`, then combined with the standard corner-bilinear correction.
 */
function coonsPoint(patch: MeshPatch, u: number, v: number): RasterPoint {
	const [top, right, bottom, left] = patch.edges;
	const cTop = cubicAt(top, u); // TL→TR
	const cBottom = cubicAt(bottom, 1 - u); // edge is BR→BL, reverse to BL→BR
	const cLeft = cubicAt(left, 1 - v); // edge is BL→TL, reverse to TL→BL
	const cRight = cubicAt(right, v); // TR→BR
	const tl = top[0];
	const tr = top[3];
	const br = right[3];
	const bl = bottom[3];
	const mu = 1 - u;
	const mv = 1 - v;
	const lerpX =
		mv * cTop.x +
		v * cBottom.x +
		mu * cLeft.x +
		u * cRight.x -
		(mu * mv * tl.x + u * mv * tr.x + mu * v * bl.x + u * v * br.x);
	const lerpY =
		mv * cTop.y +
		v * cBottom.y +
		mu * cLeft.y +
		u * cRight.y -
		(mu * mv * tl.y + u * mv * tr.y + mu * v * bl.y + u * v * br.y);
	return { x: lerpX, y: lerpY };
}

/** Bilinear corner-color blend at `(u, v)`; corners are `[TL, TR, BR, BL]`. */
function colorAt(corners: readonly Rgba[], u: number, v: number): Rgba {
	const [tl, tr, br, bl] = corners;
	const mu = 1 - u;
	const mv = 1 - v;
	const w0 = mu * mv;
	const w1 = u * mv;
	const w2 = u * v;
	const w3 = mu * v;
	return [
		w0 * tl[0] + w1 * tr[0] + w2 * br[0] + w3 * bl[0],
		w0 * tl[1] + w1 * tr[1] + w2 * br[1] + w3 * bl[1],
		w0 * tl[2] + w1 * tr[2] + w2 * br[2] + w3 * bl[2],
		w0 * tl[3] + w1 * tr[3] + w2 * br[3] + w3 * bl[3],
	];
}

type DeviceVertex = {
	readonly x: number;
	readonly y: number;
	readonly c: Rgba;
};

/**
 * Rasterizes one Gouraud-shaded triangle into the RGBA buffer with inclusive
 * edge coverage (`>= 0` on all three edge functions). Inclusive coverage is
 * gap-free at shared edges — the failure mode that would show as background bleed
 * — at the cost of writing boundary pixels from both adjacent triangles; because
 * shared vertices carry identical positions and colors and pixels are OVERWRITTEN
 * (not alpha-composited), the double-write is idempotent and invisible.
 */
function fillTriangle(
	pixels: Uint8ClampedArray,
	width: number,
	height: number,
	dither: boolean,
	v0: DeviceVertex,
	v1: DeviceVertex,
	v2: DeviceVertex,
): void {
	const area = (v1.x - v0.x) * (v2.y - v0.y) - (v2.x - v0.x) * (v1.y - v0.y);
	if (area === 0) return;
	const inv = 1 / area;
	const minX = Math.max(0, Math.floor(Math.min(v0.x, v1.x, v2.x)));
	const maxX = Math.min(width - 1, Math.ceil(Math.max(v0.x, v1.x, v2.x)));
	const minY = Math.max(0, Math.floor(Math.min(v0.y, v1.y, v2.y)));
	const maxY = Math.min(height - 1, Math.ceil(Math.max(v0.y, v1.y, v2.y)));
	for (let py = minY; py <= maxY; py += 1) {
		const sy = py + 0.5;
		const bayerRow = BAYER_4[py & 3];
		for (let px = minX; px <= maxX; px += 1) {
			const sx = px + 0.5;
			// Signed sub-triangle areas; barycentric weights after sign-normalizing.
			const e0 = (v2.x - v1.x) * (sy - v1.y) - (v2.y - v1.y) * (sx - v1.x);
			const e1 = (v0.x - v2.x) * (sy - v2.y) - (v0.y - v2.y) * (sx - v2.x);
			const e2 = (v1.x - v0.x) * (sy - v0.y) - (v1.y - v0.y) * (sx - v0.x);
			const inside =
				area > 0
					? e0 >= 0 && e1 >= 0 && e2 >= 0
					: e0 <= 0 && e1 <= 0 && e2 <= 0;
			if (!inside) continue;
			const w0 = e0 * inv;
			const w1 = e1 * inv;
			const w2 = e2 * inv;
			const bias = dither ? bayerRow[px & 3] : 0;
			const offset = (py * width + px) * 4;
			pixels[offset] = w0 * v0.c[0] + w1 * v1.c[0] + w2 * v2.c[0] + bias;
			pixels[offset + 1] = w0 * v0.c[1] + w1 * v1.c[1] + w2 * v2.c[1] + bias;
			pixels[offset + 2] = w0 * v0.c[2] + w1 * v1.c[2] + w2 * v2.c[2] + bias;
			pixels[offset + 3] = w0 * v0.c[3] + w1 * v1.c[3] + w2 * v2.c[3];
		}
	}
}

const maxChannelDelta = (a: Rgba, b: Rgba): number =>
	Math.max(
		Math.abs(a[0] - b[0]),
		Math.abs(a[1] - b[1]),
		Math.abs(a[2] - b[2]),
		Math.abs(a[3] - b[3]),
	);

/**
 * Rasterizes a mesh into an RGBA bitmap via adaptive recursive subdivision of
 * each Coons patch. A leaf stops subdividing when the true center color is within
 * `tolerance` of the Gouraud-estimated center (so flat and near-linear regions
 * emit few triangles while color-curved regions refine), or at {@link MAX_DEPTH}.
 * Each leaf is drawn as two Gouraud triangles, which tile gap-free.
 *
 * Geometry curvature is NOT yet a subdivision criterion: Phase-1 factory patches
 * have straight edges (flat tangents), so the chord is exact. Curved-edge
 * refinement is a Phase-3 addition (tangent-handle editing).
 */
export function rasterizeMesh(req: MeshRasterRequest): MeshRasterResult {
	const tolerance = (req.tolerance ?? DEFAULT_TOLERANCE) * RGB_MAX;
	const dither = req.dither ?? true;
	const scale = Math.min(
		req.deviceScale,
		MAX_DIMENSION / Math.max(req.bounds.width, 1),
		MAX_DIMENSION / Math.max(req.bounds.height, 1),
	);
	const width = Math.max(1, Math.ceil(req.bounds.width * scale));
	const height = Math.max(1, Math.ceil(req.bounds.height * scale));
	const pixels = new Uint8ClampedArray(width * height * 4);
	if (req.bounds.width <= 0 || req.bounds.height <= 0) {
		return { pixels, width, height, bounds: req.bounds };
	}

	const originX = req.bounds.x;
	const originY = req.bounds.y;
	const toDevice = (point: RasterPoint, c: Rgba): DeviceVertex => ({
		x: (point.x - originX) * scale,
		y: (point.y - originY) * scale,
		c,
	});

	for (const patch of req.patches) {
		const cornerRgba = patch.corners.map((corner) =>
			parseColor(corner.color, corner.opacity),
		);
		const emitLeaf = (u0: number, v0: number, u1: number, v1: number): void => {
			const c00 = colorAt(cornerRgba, u0, v0);
			const c10 = colorAt(cornerRgba, u1, v0);
			const c11 = colorAt(cornerRgba, u1, v1);
			const c01 = colorAt(cornerRgba, u0, v1);
			const p00 = toDevice(coonsPoint(patch, u0, v0), c00);
			const p10 = toDevice(coonsPoint(patch, u1, v0), c10);
			const p11 = toDevice(coonsPoint(patch, u1, v1), c11);
			const p01 = toDevice(coonsPoint(patch, u0, v1), c01);
			fillTriangle(pixels, width, height, dither, p00, p10, p11);
			fillTriangle(pixels, width, height, dither, p00, p11, p01);
		};
		const recurse = (
			u0: number,
			v0: number,
			u1: number,
			v1: number,
			depth: number,
		): void => {
			if (depth >= MAX_DEPTH) {
				emitLeaf(u0, v0, u1, v1);
				return;
			}
			const um = (u0 + u1) / 2;
			const vm = (v0 + v1) / 2;
			// Subdivide on color nonlinearity: the TRUE bilinear color at the centre vs
			// what the two Gouraud triangles actually paint there. The leaf is split
			// along the p00→p11 diagonal, so the painted centre color is the mean of
			// that diagonal's endpoint colors; on a saddle (c00+c11 ≠ c10+c01) it
			// diverges from the bilinear centre by the cross-term and must subdivide.
			// (Comparing bilinear-at-centre to corner-mean-at-centre was a no-op: both
			// equal (c00+c10+c11+c01)/4.)
			const trueCenter = colorAt(cornerRgba, um, vm);
			const diag0 = colorAt(cornerRgba, u0, v0);
			const diag1 = colorAt(cornerRgba, u1, v1);
			const gouraud: Rgba = [
				(diag0[0] + diag1[0]) / 2,
				(diag0[1] + diag1[1]) / 2,
				(diag0[2] + diag1[2]) / 2,
				(diag0[3] + diag1[3]) / 2,
			];
			// Geometry curvature: subdivide while the Coons surface bows away from the
			// flat quad of its corners. Checked at the centre AND each edge midpoint —
			// the centre alone misses a symmetrically-bowed edge whose midpoint still
			// lands on the chord average. Straight-edged patches have zero deviation
			// everywhere, so this stays inert for handle-free meshes.
			const g00 = coonsPoint(patch, u0, v0);
			const g10 = coonsPoint(patch, u1, v0);
			const g11 = coonsPoint(patch, u1, v1);
			const g01 = coonsPoint(patch, u0, v1);
			const midDeviation = (a: RasterPoint, b: RasterPoint, mid: RasterPoint) =>
				Math.hypot(mid.x - (a.x + b.x) / 2, mid.y - (a.y + b.y) / 2);
			const geomDeviationPx =
				Math.max(
					midDeviation(g00, g11, coonsPoint(patch, um, vm)), // diagonal/centre
					midDeviation(g00, g10, coonsPoint(patch, um, v0)), // top edge
					midDeviation(g01, g11, coonsPoint(patch, um, v1)), // bottom edge
					midDeviation(g00, g01, coonsPoint(patch, u0, vm)), // left edge
					midDeviation(g10, g11, coonsPoint(patch, u1, vm)), // right edge
				) * scale;
			if (
				maxChannelDelta(trueCenter, gouraud) <= tolerance &&
				geomDeviationPx <= GEOMETRY_TOLERANCE_PX
			) {
				emitLeaf(u0, v0, u1, v1);
				return;
			}
			recurse(u0, v0, um, vm, depth + 1);
			recurse(um, v0, u1, vm, depth + 1);
			recurse(u0, vm, um, v1, depth + 1);
			recurse(um, vm, u1, v1, depth + 1);
		};
		recurse(0, 0, 1, 1, 0);
	}

	return { pixels, width, height, bounds: req.bounds };
}
