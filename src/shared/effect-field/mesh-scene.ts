import {
	type ScalarEffectFieldMesh,
	scalarEffectFieldMeshPointAt,
} from "./scalar-field";

export type EffectFieldVec2 = { readonly x: number; readonly y: number };

/** Effect-local rectangular bounds that normalized scalar fields are projected into. */
export type EffectFieldBounds = {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
};

/** One scalar mesh point projected into both local and artboard coordinates. */
export type ScalarEffectFieldMeshPointScene = {
	readonly row: number;
	readonly col: number;
	readonly value: number;
	readonly normalized: EffectFieldVec2;
	readonly local: EffectFieldVec2;
	readonly artboard: EffectFieldVec2;
};

/** Projected scalar mesh geometry used by overlays, hit-testing, and rasterizers. */
export type ScalarEffectFieldMeshScene = {
	readonly fieldMesh: ScalarEffectFieldMesh;
	readonly points: readonly ScalarEffectFieldMeshPointScene[];
	readonly segments: readonly {
		readonly from: EffectFieldVec2;
		readonly to: EffectFieldVec2;
	}[];
};

/** Address and in-patch coordinates for a mesh face hit. */
export type ScalarEffectFieldMeshPatchHit = {
	readonly row: number;
	readonly col: number;
	readonly u: number;
	readonly v: number;
};

const MIN_FIELD_BOUNDS_LENGTH = 1e-6;
const NEAR_ZERO = 1e-9;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const cross2 = (ax: number, ay: number, bx: number, by: number): number =>
	ax * by - ay * bx;

const invBilinear = (
	tl: EffectFieldVec2,
	tr: EffectFieldVec2,
	br: EffectFieldVec2,
	bl: EffectFieldVec2,
	q: EffectFieldVec2,
): { readonly u: number; readonly v: number } | null => {
	const ex = tr.x - tl.x;
	const ey = tr.y - tl.y;
	const fx = bl.x - tl.x;
	const fy = bl.y - tl.y;
	const gx = br.x - bl.x - tr.x + tl.x;
	const gy = br.y - bl.y - tr.y + tl.y;
	const hx = q.x - tl.x;
	const hy = q.y - tl.y;
	const k2 = -cross2(fx, fy, gx, gy);
	const k1 = cross2(hx, hy, gx, gy) - cross2(fx, fy, ex, ey);
	const k0 = cross2(hx, hy, ex, ey);
	const solveU = (v: number): number | null => {
		const denomX = ex + v * gx;
		const denomY = ey + v * gy;
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
		return { u: clamp01(u), v: clamp01(v) };
	}
	return null;
};

/**
 * Projects a scalar effect-field mesh from normalized effect-bounds coordinates
 * into local and artboard coordinates. Tool overlays for density, blur,
 * distortion, reveal, and future scalar effects can share this projection and
 * render only their effect-specific labels/colors.
 */
export function scalarEffectFieldMeshScene(
	fieldMesh: ScalarEffectFieldMesh,
	bounds: EffectFieldBounds,
	toArtboard: (point: EffectFieldVec2) => EffectFieldVec2,
): ScalarEffectFieldMeshScene {
	const pointAt = (
		row: number,
		col: number,
	): ScalarEffectFieldMeshPointScene | null => {
		const point = scalarEffectFieldMeshPointAt(fieldMesh, row, col);
		if (!point) return null;
		const local = {
			x: bounds.x + point.x * bounds.width,
			y: bounds.y + point.y * bounds.height,
		};
		return {
			row,
			col,
			value: point.value,
			normalized: { x: point.x, y: point.y },
			local,
			artboard: toArtboard(local),
		};
	};
	const points: ScalarEffectFieldMeshPointScene[] = [];
	for (let row = 0; row < fieldMesh.rows; row += 1) {
		for (let col = 0; col < fieldMesh.cols; col += 1) {
			const point = pointAt(row, col);
			if (point) points.push(point);
		}
	}
	const segments: ScalarEffectFieldMeshScene["segments"][number][] = [];
	for (let row = 0; row < fieldMesh.rows; row += 1) {
		for (let col = 0; col < fieldMesh.cols - 1; col += 1) {
			const from = pointAt(row, col);
			const to = pointAt(row, col + 1);
			if (from && to) segments.push({ from: from.artboard, to: to.artboard });
		}
	}
	for (let col = 0; col < fieldMesh.cols; col += 1) {
		for (let row = 0; row < fieldMesh.rows - 1; row += 1) {
			const from = pointAt(row, col);
			const to = pointAt(row + 1, col);
			if (from && to) segments.push({ from: from.artboard, to: to.artboard });
		}
	}
	return { fieldMesh, points, segments };
}

/** Closest scalar Field Mesh point within `tolerance`, or null. */
export function hitScalarEffectFieldMeshPoint(
	scene: ScalarEffectFieldMeshScene,
	point: EffectFieldVec2,
	tolerance: number,
): { readonly row: number; readonly col: number } | null {
	let best: { row: number; col: number } | null = null;
	let bestDistance = tolerance;
	for (const meshPoint of scene.points) {
		const distance = Math.hypot(
			meshPoint.artboard.x - point.x,
			meshPoint.artboard.y - point.y,
		);
		if (distance <= bestDistance) {
			bestDistance = distance;
			best = { row: meshPoint.row, col: meshPoint.col };
		}
	}
	return best;
}

/**
 * Converts a local pointer position into normalized effect-bounds coordinates.
 * Degenerate bounds return null so callers do not write invalid field points.
 */
export function scalarEffectFieldPointForLocalPoint(
	bounds: EffectFieldBounds,
	point: EffectFieldVec2,
): EffectFieldVec2 | null {
	if (
		bounds.width <= MIN_FIELD_BOUNDS_LENGTH ||
		bounds.height <= MIN_FIELD_BOUNDS_LENGTH
	) {
		return null;
	}
	return {
		x: clamp01((point.x - bounds.x) / bounds.width),
		y: clamp01((point.y - bounds.y) / bounds.height),
	};
}

/** Field Mesh patch under a local pointer, for row+column insertion. */
export function scalarEffectFieldMeshPatchAt(
	scene: ScalarEffectFieldMeshScene,
	point: EffectFieldVec2,
): ScalarEffectFieldMeshPatchHit | null {
	const { fieldMesh } = scene;
	const pointAt = (row: number, col: number): EffectFieldVec2 | null =>
		scene.points.find((p) => p.row === row && p.col === col)?.local ?? null;
	for (let row = 0; row < fieldMesh.rows - 1; row += 1) {
		for (let col = 0; col < fieldMesh.cols - 1; col += 1) {
			const tl = pointAt(row, col);
			const tr = pointAt(row, col + 1);
			const br = pointAt(row + 1, col + 1);
			const bl = pointAt(row + 1, col);
			if (!tl || !tr || !br || !bl) continue;
			const uv = invBilinear(tl, tr, br, bl, point);
			if (uv) return { row, col, u: uv.u, v: uv.v };
		}
	}
	return null;
}
