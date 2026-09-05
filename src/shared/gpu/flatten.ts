/**
 * Adaptive cubic-Bezier flattening for the GPU stencil-then-cover fill path
 * (E1 S2/S3 — see `docs/gpu-canvas-convergence-e1-plan.md` D4). Scene-agnostic
 * (`shared` may not import `entities`): consumes `AeShape` contours directly
 * (`shared/glammer/ae-shape` is itself a `shared`-layer module, so this import
 * is FSD-legal) rather than a scene node, and returns flat `Float32Array`
 * polygon rings the caller (`webgpu.ts`'s stencil pass) fans into triangles.
 *
 * Flatness uses a de Casteljau midpoint subdivision, mirroring the shape (not
 * the code — this module has no access to `entities/scene/model`'s
 * `path-conversion.ts`) of the editor's own adaptive flattener: a segment
 * whose control points both sit within `tolerance` of the chord from its
 * endpoints emits a single point; otherwise it splits at the midpoint and
 * recurses. `tolerance` is caller-supplied in WORLD units (not device pixels)
 * so the caller can convert a device-pixel quality target through the current
 * zoom/DPR before calling in (see `gpu-scene-frame.ts`'s zoom-bucket comment).
 */
import type { AePoint, AeShape } from "@/shared/glammer/ae-shape";

/** Recursion depth ceiling — matches the editor's own flattener's ceiling for near-degenerate curves. */
const MAX_FLATTEN_DEPTH = 18;

type Point = { readonly x: number; readonly y: number };

const toPoint = ([x, y]: AePoint): Point => ({ x, y });

const midpoint = (a: Point, b: Point): Point => ({
	x: (a.x + b.x) / 2,
	y: (a.y + b.y) / 2,
});

const add = (a: Point, [dx, dy]: AePoint): Point => ({
	x: a.x + dx,
	y: a.y + dy,
});

/** Perpendicular distance from `point` to the chord `start` -> `end`. */
function distanceToChord(point: Point, start: Point, end: Point): number {
	const dx = end.x - start.x;
	const dy = end.y - start.y;
	const lengthSq = dx * dx + dy * dy;
	if (lengthSq <= Number.EPSILON)
		return Math.hypot(point.x - start.x, point.y - start.y);
	const area = Math.abs((point.x - start.x) * dy - (point.y - start.y) * dx);
	return area / Math.sqrt(lengthSq);
}

/** Appends an adaptively flattened cubic to `out` (interior samples then `p3`, never `p0`). */
function flattenCubicInto(
	p0: Point,
	p1: Point,
	p2: Point,
	p3: Point,
	tolerance: number,
	depth: number,
	out: number[],
): void {
	const flat =
		distanceToChord(p1, p0, p3) <= tolerance &&
		distanceToChord(p2, p0, p3) <= tolerance;
	if (flat || depth >= MAX_FLATTEN_DEPTH) {
		out.push(p3.x, p3.y);
		return;
	}
	const p01 = midpoint(p0, p1);
	const p12 = midpoint(p1, p2);
	const p23 = midpoint(p2, p3);
	const p012 = midpoint(p01, p12);
	const p123 = midpoint(p12, p23);
	const mid = midpoint(p012, p123);
	flattenCubicInto(p0, p01, p012, mid, tolerance, depth + 1, out);
	flattenCubicInto(mid, p123, p23, p3, tolerance, depth + 1, out);
}

/**
 * Flattens one `AeShape` contour to a flat `[x0,y0,x1,y1,...]` polygon ring in
 * the shape's own local coordinate space. Closed shapes wrap the last segment
 * back to the first vertex; open shapes (should not reach here in S2 — the
 * capability predicate excludes anything but closed contours) still flatten
 * every authored segment, omitting the closing one.
 */
export function flattenAeShapeToRing(
	shape: AeShape,
	tolerance: number,
): Float32Array {
	const { vertices, inTangents, outTangents, closed } = shape;
	const out: number[] = [];
	if (vertices.length === 0) return new Float32Array(0);

	const first = toPoint(vertices[0]);
	out.push(first.x, first.y);

	const segmentCount = closed ? vertices.length : vertices.length - 1;
	for (let index = 0; index < segmentCount; index++) {
		const nextIndex = (index + 1) % vertices.length;
		const p0 = toPoint(vertices[index]);
		const p3 = toPoint(vertices[nextIndex]);
		const p1 = add(p0, outTangents[index] ?? [0, 0]);
		const p2 = add(p3, inTangents[nextIndex] ?? [0, 0]);
		flattenCubicInto(p0, p1, p2, p3, tolerance, 0, out);
	}

	return Float32Array.from(out);
}

/**
 * Flattens every contour (outer + holes) of one path's contour list to rings,
 * in the same order. The caller fans each ring independently for the stencil
 * pass (see `webgpu.ts`'s stencil-then-cover doc), sharing one pivot per PATH
 * (the first vertex of `contours[0]`) across all of that path's rings so
 * nonzero/evenodd winding resolves correctly between the outer contour and its
 * holes.
 */
export function flattenContoursToRings(
	contours: readonly AeShape[],
	tolerance: number,
): readonly Float32Array[] {
	return contours.map((contour) => flattenAeShapeToRing(contour, tolerance));
}

/** Row-major 2D affine matrix, matching `entities/scene/model/rendering.ts`'s `Matrix2D` shape. */
export type FlattenMatrix2D = {
	readonly a: number;
	readonly b: number;
	readonly c: number;
	readonly d: number;
	readonly e: number;
	readonly f: number;
};

const applyMatrix = (
	matrix: FlattenMatrix2D,
	x: number,
	y: number,
): readonly [number, number] => [
	matrix.a * x + matrix.c * y + matrix.e,
	matrix.b * x + matrix.d * y + matrix.f,
];

/**
 * Fan-triangulates one path's flattened rings (outer + holes) into world-space
 * stencil-pass triangles, pre-transformed CPU-side by `worldTransform` (D4):
 * the pivot is the FIRST vertex of the FIRST ring, and every ring of the path
 * — outer and holes alike — contributes `(pivot, v[i], v[i+1])` triangles
 * against that SAME shared pivot. This relies entirely on the stencil pass's
 * winding-accumulation (`increment-wrap`/`decrement-wrap` front/back, or
 * `invert` for evenodd — see `webgpu.ts`) to resolve nonzero/evenodd fill
 * correctly; the fan itself performs no polygon-clipping or clockwise/
 * counter-clockwise reasoning; a degenerate (< 3 vertices) ring contributes no
 * triangles.
 */
export function fanTriangulateRings(
	rings: readonly Float32Array[],
	worldTransform: FlattenMatrix2D,
): Float32Array {
	const firstRing = rings.find((ring) => ring.length >= 6);
	if (!firstRing) return new Float32Array(0);
	const [pivotX, pivotY] = applyMatrix(
		worldTransform,
		firstRing[0],
		firstRing[1],
	);

	const triangles: number[] = [];
	for (const ring of rings) {
		const vertexCount = ring.length / 2;
		if (vertexCount < 3) continue;
		for (let index = 0; index < vertexCount; index++) {
			const nextIndex = (index + 1) % vertexCount;
			const [ax, ay] = applyMatrix(
				worldTransform,
				ring[index * 2],
				ring[index * 2 + 1],
			);
			const [bx, by] = applyMatrix(
				worldTransform,
				ring[nextIndex * 2],
				ring[nextIndex * 2 + 1],
			);
			triangles.push(pivotX, pivotY, ax, ay, bx, by);
		}
	}
	return Float32Array.from(triangles);
}
