// Pure corner-radius math + resolvers. The SINGLE source of rounded-corner
// geometry: canvas, SVG/PDF/code export, path-conversion, and the on-canvas
// handles all import from here so they can never drift. No DOM/React/Worker
// imports — this is entities-layer domain logic.

import type { AePoint, AeShape } from "@/shared/glammer/ae-shape";
import { aeShapeToSvgPath } from "@/shared/glammer/ae-shape-svg-path";
import type {
	Bounds,
	CornerRadii,
	PolygonGeometry,
	RectGeometry,
	StarGeometry,
	Vec2,
} from "./types";

/**
 * Cubic-bezier constant for a 90° circular arc. Byte-identical to the
 * `ELLIPSE_KAPPA` used by `path-conversion.ts`, which is the backward-compat
 * lock: a uniform circular rect baked here must equal the legacy bake exactly.
 */
export const CORNER_KAPPA = 0.5522847498307936;

/** Radii at or below this read as "no rounding" for the sharp fast path. */
const RADIUS_EPSILON = 1e-7;

const finiteNonNegative = (value: number): number =>
	Number.isFinite(value) && value > 0 ? value : 0;

const clamp01 = (value: number): number =>
	Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

const zero = (): AePoint => [0, 0];

type RectCornerSource = Pick<RectGeometry, "cornerRadius" | "cornerRadii">;

/**
 * Resolves a rect's four per-corner radii (RAW, non-negative). Returns the
 * explicit `cornerRadii` when present, else expands the uniform `cornerRadius`
 * to all four corners. Never clamps to size — that happens at render time.
 */
export function resolveCornerRadii(geometry: RectCornerSource): CornerRadii {
	const { cornerRadii } = geometry;
	if (cornerRadii) {
		return {
			tl: finiteNonNegative(cornerRadii.tl),
			tr: finiteNonNegative(cornerRadii.tr),
			br: finiteNonNegative(cornerRadii.br),
			bl: finiteNonNegative(cornerRadii.bl),
		};
	}
	const r = finiteNonNegative(geometry.cornerRadius);
	return { tl: r, tr: r, br: r, bl: r };
}

/** Resolves whole-shape corner smoothing (squircle) in `0..1`. */
export function resolveCornerSmoothing(geometry: {
	readonly cornerSmoothing?: number;
}): number {
	return clamp01(geometry.cornerSmoothing ?? 0);
}

/** True when all four corner radii are equal (the uniform circular case). */
export function areCornersUniform(radii: CornerRadii): boolean {
	return (
		radii.tl === radii.tr && radii.tr === radii.br && radii.br === radii.bl
	);
}

const edgeRatio = (edge: number, sum: number): number =>
	sum > 0 ? edge / sum : Number.POSITIVE_INFINITY;

/**
 * Clamps per-corner radii so adjacent corners never overlap, using the W3C
 * border-radius proportional rule (shrink every radius by the most-constrained
 * edge). RENDER-TIME ONLY on RAW values — the result is never written back into
 * the document, so animating size cannot make a radius "stick" at the pill.
 *
 * For uniform radii this returns the bit-identical legacy clamp
 * (`min(r, width/2, height/2)`), preserving byte-for-byte rect path output.
 */
export function clampRectCorners(
	width: number,
	height: number,
	radii: CornerRadii,
): CornerRadii {
	const w = Math.max(0, width);
	const h = Math.max(0, height);
	const tl = finiteNonNegative(radii.tl);
	const tr = finiteNonNegative(radii.tr);
	const br = finiteNonNegative(radii.br);
	const bl = finiteNonNegative(radii.bl);
	if (tl === tr && tr === br && br === bl) {
		const r = Math.min(tl, w / 2, h / 2);
		return { tl: r, tr: r, br: r, bl: r };
	}
	const ratio = Math.min(
		edgeRatio(w, tl + tr), // top edge
		edgeRatio(w, bl + br), // bottom edge
		edgeRatio(h, tl + bl), // left edge
		edgeRatio(h, tr + br), // right edge
		1,
	);
	return { tl: tl * ratio, tr: tr * ratio, br: br * ratio, bl: bl * ratio };
}

/**
 * Builds the editable bezier outline of a (possibly per-corner) rounded
 * rectangle. Radii are clamped to the bounds here (the only clamp site). With
 * `smoothing === 0` and all-equal radii the output is byte-identical to the
 * legacy `rectToPathGeometry` (same 8-vertex order + tangent signs); a sharp
 * rect (all radii ~0) returns the legacy 4-vertex form.
 *
 * `smoothing > 0` (squircle) is wired in a later phase; until then corners are
 * plain circular arcs regardless of the smoothing value.
 */
export function buildRoundedRectShape(
	bounds: Bounds,
	options: { readonly radii: CornerRadii; readonly smoothing?: number },
): AeShape {
	const { x, y, width, height } = bounds;
	const w = Math.max(0, width);
	const h = Math.max(0, height);
	const { tl, tr, br, bl } = clampRectCorners(w, h, options.radii);
	const smoothing = clamp01(options.smoothing ?? 0);

	if (
		smoothing <= 0 &&
		tl <= RADIUS_EPSILON &&
		tr <= RADIUS_EPSILON &&
		br <= RADIUS_EPSILON &&
		bl <= RADIUS_EPSILON
	) {
		return {
			type: "Shape",
			closed: true,
			vertices: [
				[x, y],
				[x + w, y],
				[x + w, y + h],
				[x, y + h],
			],
			inTangents: [zero(), zero(), zero(), zero()],
			outTangents: [zero(), zero(), zero(), zero()],
		};
	}

	const ktl = CORNER_KAPPA * tl;
	const ktr = CORNER_KAPPA * tr;
	const kbr = CORNER_KAPPA * br;
	const kbl = CORNER_KAPPA * bl;
	return {
		type: "Shape",
		closed: true,
		vertices: [
			[x + tl, y],
			[x + w - tr, y],
			[x + w, y + tr],
			[x + w, y + h - br],
			[x + w - br, y + h],
			[x + bl, y + h],
			[x, y + h - bl],
			[x, y + tl],
		],
		inTangents: [
			[-ktl, 0],
			[0, 0],
			[0, -ktr],
			[0, 0],
			[kbr, 0],
			[0, 0],
			[0, kbl],
			[0, 0],
		],
		outTangents: [
			[0, 0],
			[ktr, 0],
			[0, 0],
			[0, kbr],
			[0, 0],
			[-kbl, 0],
			[0, 0],
			[0, -ktl],
		],
	};
}

/**
 * Whether a rect must render as a baked `<path>` rather than a native
 * `<rect rx>`: true when corners are non-uniform or smoothing is on. The
 * `<rect rx>` fast path is only valid for uniform circular corners.
 */
export function rectNeedsBakedPath(
	geometry: RectCornerSource & {
		readonly cornerSmoothing?: number;
	},
): boolean {
	return (
		resolveCornerSmoothing(geometry) > 0 ||
		!areCornersUniform(resolveCornerRadii(geometry))
	);
}

/** Inverse of {@link rectNeedsBakedPath}: the `<rect rx>` fast-path predicate. */
export function isUniformCircularRect(
	geometry: RectCornerSource & { readonly cornerSmoothing?: number },
): boolean {
	return !rectNeedsBakedPath(geometry);
}

/**
 * SVG path `d` for a rounded rectangle, baked from the shared builder. Used by
 * the canvas, mask silhouette, and SVG export so per-corner/squircle rects never
 * drift between surfaces. Only meaningful when {@link rectNeedsBakedPath}.
 */
export function roundedRectPathData(geometry: RectGeometry): string {
	if (resolveCornerSmoothing(geometry) > 0) {
		return squircleRectPathData(geometry);
	}
	return aeShapeToSvgPath(
		buildRoundedRectShape(geometry.bounds, {
			radii: resolveCornerRadii(geometry),
			smoothing: resolveCornerSmoothing(geometry),
		}),
	);
}

/** Whether a star/polygon must render as a baked `<path>` (its corners round). */
export function shapeNeedsBakedPath(geometry: {
	readonly cornerRadius?: number;
}): boolean {
	return (geometry.cornerRadius ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Squircle (corner smoothing). Faithful port of the figma-squircle algorithm
// (phamfoo/figma-squircle, after MartinRGB / Figma's "Desperately seeking
// squircles"). Emits an SVG `d` string directly (using a native `A` arc for the
// residual circular section) rather than an AeShape, because AeShape is
// cubic-only and the arc→cubic conversion would add avoidable error. With
// `smoothing === 0` callers use the circular `buildRoundedRectShape` instead, so
// this path only runs for genuine squircles.
// ---------------------------------------------------------------------------

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
const SQUIRCLE_DECIMALS = 4;
const fmt = (value: number): string => value.toFixed(SQUIRCLE_DECIMALS);

type SquircleCornerParams = {
	readonly a: number;
	readonly b: number;
	readonly c: number;
	readonly d: number;
	readonly p: number;
	readonly radius: number;
	readonly arc: number;
};

/** Per-corner squircle bezier params for a 90° corner (figma-squircle eq. 11.1). */
function squircleCornerParams(
	radius: number,
	smoothing: number,
	budget: number,
): SquircleCornerParams {
	if (radius <= 0 || budget <= 0) {
		return { a: 0, b: 0, c: 0, d: 0, p: 0, radius: 0, arc: 0 };
	}
	const cappedSmoothing = Math.min(smoothing, Math.max(0, budget / radius - 1));
	const p = Math.min((1 + cappedSmoothing) * radius, budget);
	const arcMeasure = 90 * (1 - cappedSmoothing);
	const arc = Math.sin(toRadians(arcMeasure / 2)) * radius * Math.SQRT2;
	const angleAlpha = (90 - arcMeasure) / 2;
	const p3ToP4 = radius * Math.tan(toRadians(angleAlpha / 2));
	const angleBeta = 45 * cappedSmoothing;
	const c = p3ToP4 * Math.cos(toRadians(angleBeta));
	const d = c * Math.tan(toRadians(angleBeta));
	const b = (p - arc - c - d) / 3;
	const a = 2 * b;
	return { a, b, c, d, p, radius, arc };
}

type SquircleBudgets = Record<"tl" | "tr" | "br" | "bl", number>;

// Distributes the rounding+smoothing budget per corner (figma-squircle
// distribute.ts): bigger corners claim space first; each takes the smaller of
// its two adjacent sides' share.
const ADJACENTS: Record<
	"tl" | "tr" | "br" | "bl",
	readonly {
		readonly corner: "tl" | "tr" | "br" | "bl";
		readonly horizontal: boolean;
	}[]
> = {
	tl: [
		{ corner: "bl", horizontal: false },
		{ corner: "tr", horizontal: true },
	],
	tr: [
		{ corner: "tl", horizontal: true },
		{ corner: "br", horizontal: false },
	],
	br: [
		{ corner: "bl", horizontal: true },
		{ corner: "tr", horizontal: false },
	],
	bl: [
		{ corner: "br", horizontal: true },
		{ corner: "tl", horizontal: false },
	],
};

function distributeSquircleBudgets(
	radii: CornerRadii,
	width: number,
	height: number,
): SquircleBudgets {
	const radiusMap: SquircleBudgets = { ...radii };
	const budgetMap: SquircleBudgets = { tl: -1, tr: -1, br: -1, bl: -1 };
	const order = (["tl", "tr", "br", "bl"] as const)
		.slice()
		.sort((a, b) => radiusMap[b] - radiusMap[a]);
	for (const corner of order) {
		const radius = radiusMap[corner];
		const budget = Math.min(
			...ADJACENTS[corner].map((adjacent) => {
				const adjacentRadius = radiusMap[adjacent.corner];
				if (radius === 0 && adjacentRadius === 0) return 0;
				const sideLength = adjacent.horizontal ? width : height;
				const adjacentBudget = budgetMap[adjacent.corner];
				if (adjacentBudget >= 0) return sideLength - adjacentBudget;
				return (radius / (radius + adjacentRadius)) * sideLength;
			}),
		);
		budgetMap[corner] = budget;
		radiusMap[corner] = Math.min(radius, budget);
	}
	return budgetMap;
}

const squircleTopRight = (k: SquircleCornerParams): string =>
	k.radius > 0
		? `c ${fmt(k.a)} 0 ${fmt(k.a + k.b)} 0 ${fmt(k.a + k.b + k.c)} ${fmt(k.d)} a ${fmt(k.radius)} ${fmt(k.radius)} 0 0 1 ${fmt(k.arc)} ${fmt(k.arc)} c ${fmt(k.d)} ${fmt(k.c)} ${fmt(k.d)} ${fmt(k.b + k.c)} ${fmt(k.d)} ${fmt(k.a + k.b + k.c)}`
		: "";

const squircleBottomRight = (k: SquircleCornerParams): string =>
	k.radius > 0
		? `c 0 ${fmt(k.a)} 0 ${fmt(k.a + k.b)} ${fmt(-k.d)} ${fmt(k.a + k.b + k.c)} a ${fmt(k.radius)} ${fmt(k.radius)} 0 0 1 ${fmt(-k.arc)} ${fmt(k.arc)} c ${fmt(-k.c)} ${fmt(k.d)} ${fmt(-(k.b + k.c))} ${fmt(k.d)} ${fmt(-(k.a + k.b + k.c))} ${fmt(k.d)}`
		: "";

const squircleBottomLeft = (k: SquircleCornerParams): string =>
	k.radius > 0
		? `c ${fmt(-k.a)} 0 ${fmt(-(k.a + k.b))} 0 ${fmt(-(k.a + k.b + k.c))} ${fmt(-k.d)} a ${fmt(k.radius)} ${fmt(k.radius)} 0 0 1 ${fmt(-k.arc)} ${fmt(-k.arc)} c ${fmt(-k.d)} ${fmt(-k.c)} ${fmt(-k.d)} ${fmt(-(k.b + k.c))} ${fmt(-k.d)} ${fmt(-(k.a + k.b + k.c))}`
		: "";

const squircleTopLeft = (k: SquircleCornerParams): string =>
	k.radius > 0
		? `c 0 ${fmt(-k.a)} 0 ${fmt(-(k.a + k.b))} ${fmt(k.d)} ${fmt(-(k.a + k.b + k.c))} a ${fmt(k.radius)} ${fmt(k.radius)} 0 0 1 ${fmt(k.arc)} ${fmt(-k.arc)} c ${fmt(k.c)} ${fmt(-k.d)} ${fmt(k.b + k.c)} ${fmt(-k.d)} ${fmt(k.a + k.b + k.c)} ${fmt(-k.d)}`
		: "";

/**
 * SVG path `d` for a squircle (corner-smoothed) rectangle, per the figma-squircle
 * construction. Radii are clamped to the bounds via per-corner budgets, so this
 * is the only clamp site for squircles. Smoothing `0` is handled by the circular
 * builder, so callers route here only when smoothing > 0.
 */
export function squircleRectPathData(geometry: RectGeometry): string {
	const { x, y, width, height } = geometry.bounds;
	const w = Math.max(0, width);
	const h = Math.max(0, height);
	const radii = clampRectCorners(w, h, resolveCornerRadii(geometry));
	const smoothing = resolveCornerSmoothing(geometry);
	const budgets = distributeSquircleBudgets(radii, w, h);
	const tl = squircleCornerParams(radii.tl, smoothing, budgets.tl);
	const tr = squircleCornerParams(radii.tr, smoothing, budgets.tr);
	const br = squircleCornerParams(radii.br, smoothing, budgets.br);
	const bl = squircleCornerParams(radii.bl, smoothing, budgets.bl);
	return [
		`M ${fmt(x + w - tr.p)} ${fmt(y)}`,
		tr.radius > 0 ? squircleTopRight(tr) : `l ${fmt(tr.p)} 0`,
		`L ${fmt(x + w)} ${fmt(y + h - br.p)}`,
		br.radius > 0 ? squircleBottomRight(br) : `l 0 ${fmt(br.p)}`,
		`L ${fmt(x + bl.p)} ${fmt(y + h)}`,
		bl.radius > 0 ? squircleBottomLeft(bl) : `l ${fmt(-bl.p)} 0`,
		`L ${fmt(x)} ${fmt(y + tl.p)}`,
		tl.radius > 0 ? squircleTopLeft(tl) : `l 0 ${fmt(-tl.p)}`,
		"Z",
	].join(" ");
}

/** Expands a parametric star into its alternating outer/inner vertices. */
export function starVertices(geometry: StarGeometry): Vec2[] {
	const vertices: Vec2[] = [];
	const total = Math.max(0, Math.floor(geometry.points)) * 2;
	for (let index = 0; index < total; index += 1) {
		const radius =
			index % 2 === 0 ? geometry.outerRadius : geometry.innerRadius;
		const angle = -Math.PI / 2 + (index / total) * Math.PI * 2;
		vertices.push({
			x: geometry.center.x + Math.cos(angle) * radius,
			y: geometry.center.y + Math.sin(angle) * radius,
		});
	}
	return vertices;
}

const signedArea2 = (points: readonly Vec2[]): number => {
	let sum = 0;
	for (let i = 0; i < points.length; i += 1) {
		const a = points[i];
		const b = points[(i + 1) % points.length];
		sum += a.x * b.y - b.x * a.y;
	}
	return sum;
};

const CORNER_ARC_FACTOR = 4 / 3;

/**
 * Rounds the CONVEX corners of a closed polygon with a uniform radius, leaving
 * reflex (concave) vertices — e.g. a star's inner points — sharp, matching the
 * Illustrator/Figma "round the tips" convention. Each rounded corner becomes two
 * tangent vertices joined by a single cubic whose handles point at the original
 * corner; the radius is clamped to half the shorter adjacent edge so adjacent
 * fillets never overlap. `smoothing` is accepted for signature stability but is
 * applied as a plain circular arc until squircle blending lands.
 */
export function filletPolygonShape(
	points: readonly Vec2[],
	radius: number,
	_smoothing = 0,
): AeShape {
	const n = points.length;
	const sharp = (): AeShape => ({
		type: "Shape",
		closed: true,
		vertices: points.map((p) => [p.x, p.y] as AePoint),
		inTangents: points.map(() => zero()),
		outTangents: points.map(() => zero()),
	});
	if (n < 3 || radius <= RADIUS_EPSILON) return sharp();

	const winding = Math.sign(signedArea2(points)) || 1;
	const vertices: AePoint[] = [];
	const inTangents: AePoint[] = [];
	const outTangents: AePoint[] = [];

	for (let i = 0; i < n; i += 1) {
		const v = points[i];
		const p = points[(i - 1 + n) % n];
		const nx = points[(i + 1) % n];
		const toPrev = { x: p.x - v.x, y: p.y - v.y };
		const toNext = { x: nx.x - v.x, y: nx.y - v.y };
		const lenPrev = Math.hypot(toPrev.x, toPrev.y);
		const lenNext = Math.hypot(toNext.x, toNext.y);
		const cross = (v.x - p.x) * (nx.y - v.y) - (v.y - p.y) * (nx.x - v.x);
		const convex = cross === 0 || Math.sign(cross) === winding;
		const keepSharp = () => {
			vertices.push([v.x, v.y]);
			inTangents.push(zero());
			outTangents.push(zero());
		};
		if (lenPrev <= RADIUS_EPSILON || lenNext <= RADIUS_EPSILON || !convex) {
			keepSharp();
			continue;
		}
		const up = { x: toPrev.x / lenPrev, y: toPrev.y / lenPrev };
		const un = { x: toNext.x / lenNext, y: toNext.y / lenNext };
		let cosTheta = up.x * un.x + up.y * un.y;
		cosTheta = Math.max(-1, Math.min(1, cosTheta));
		const theta = Math.acos(cosTheta);
		if (theta <= RADIUS_EPSILON || Math.PI - theta <= RADIUS_EPSILON) {
			keepSharp();
			continue;
		}
		const halfTheta = theta / 2;
		const offset = Math.min(
			radius / Math.tan(halfTheta),
			0.5 * Math.min(lenPrev, lenNext),
		);
		const effectiveRadius = offset * Math.tan(halfTheta);
		const handle =
			effectiveRadius * CORNER_ARC_FACTOR * Math.tan((Math.PI - theta) / 4);
		const t1 = { x: v.x + up.x * offset, y: v.y + up.y * offset };
		const t2 = { x: v.x + un.x * offset, y: v.y + un.y * offset };
		// Handles point from each tangent point toward the original corner v.
		vertices.push([t1.x, t1.y]);
		inTangents.push(zero());
		outTangents.push([-up.x * handle, -up.y * handle]);
		vertices.push([t2.x, t2.y]);
		inTangents.push([-un.x * handle, -un.y * handle]);
		outTangents.push(zero());
	}
	return { type: "Shape", closed: true, vertices, inTangents, outTangents };
}

/** SVG path `d` for a rounded polygon (shared by canvas, mask, export). */
export function roundedPolygonPathData(geometry: PolygonGeometry): string {
	return aeShapeToSvgPath(
		filletPolygonShape(
			geometry.points,
			geometry.cornerRadius ?? 0,
			resolveCornerSmoothing(geometry),
		),
	);
}

/** SVG path `d` for a rounded star (outer tips rounded, inner points sharp). */
export function roundedStarPathData(geometry: StarGeometry): string {
	return aeShapeToSvgPath(
		filletPolygonShape(
			starVertices(geometry),
			geometry.cornerRadius ?? 0,
			resolveCornerSmoothing(geometry),
		),
	);
}
