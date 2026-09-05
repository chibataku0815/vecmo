/**
 * CPU-side uniform-stroke extrusion mesh builder (E1 S3 — see
 * `docs/gpu-canvas-convergence-e1-plan.md`'s stroke decisions). Scene-agnostic
 * (`shared` may not import `entities`): consumes already-flattened, WORLD-space
 * centerline rings (see `flatten.ts`'s doc comment for the flattening step
 * this builds on) and a set of stroke sub-options, and returns a flat,
 * interleaved `[posX, posY, offsetX, offsetY, ...]` vertex buffer the RHI's
 * stroke-stencil pipeline consumes directly as two vertex attributes.
 *
 * ZOOM-INDEPENDENT BY CONSTRUCTION: every emitted vertex carries a WORLD-space
 * centerline `position` plus a UNIT-ISH `offset` direction (see each corner
 * builder below for the miter-tip exception, whose magnitude is NOT unit —
 * see this file's `MiterJoin` handling). The actual on-screen corner is
 * `position + offset * halfWidthWorld`, computed by the vertex shader every
 * frame from the current camera scale — so this module's output NEVER needs
 * rebuilding on zoom/pan, only when the node's WORLD transform, the flattened
 * centerline, or the cap/join/miterlimit options change (see this file's
 * `buildStrokeMesh` doc comment for why this still runs fresh every frame
 * rather than being cached — mirroring `flatten.ts::fanTriangulateRings`'s
 * existing, un-cached-output precedent).
 *
 * WINDING DISCIPLINE: every triangle this module emits is wound consistently
 * (CCW in the corner order chosen below) so the RHI can draw the entire
 * stroke mesh through ONE stencil pass using the SAME `increment-wrap`
 * (front-face) / `decrement-wrap` (back-face) nonzero-winding accumulation the
 * fill pipeline already uses (`webgpu.ts`'s stencil-then-cover doc comment) —
 * self-overlapping segments/joins/caps simply accumulate a stencil count > 1,
 * which still passes the cover pass's `stencil != 0` test, so translucent
 * strokes never double-composite at an overlap (this is the load-bearing
 * property the design calls out explicitly).
 */
import type { AeShape } from "@/shared/glammer/ae-shape";

/** Number of triangles in a round join's wedge fan (named const per the codebase's no-magic-numbers convention). */
const ROUND_JOIN_SEGMENTS = 8;

/** Number of triangles in a round cap's semicircular fan. */
const ROUND_CAP_SEGMENTS = 8;

/**
 * Floats per stroke-mesh vertex: `posX, posY, offsetX, offsetY, arcLength` (E1
 * S8 — see `docs/gpu-canvas-convergence-e1-plan.md`'s S8 decisions). `arcLength`
 * is this vertex's WORLD-space cumulative distance along its own contour's
 * flattened centerline, resetting to `0` at the start of EACH contour (see
 * {@link buildContourMesh}) — the fragment shader interpolates it linearly
 * across a segment quad (screen-space-correct because arc length is itself a
 * linear function of position along a straight segment) and evaluates the dash
 * pattern against it. Undashed strokes never read this attribute (the WGSL
 * fragment stage short-circuits on `dashCount == 0` before any arc-length
 * math), so this field costs one extra `f32`/vertex even when unused — judged
 * negligible next to the mesh's existing position/offset payload.
 */
export const STROKE_VERTEX_FLOAT_COUNT = 5;

export type StrokeCapStyle = "butt" | "round" | "square";
export type StrokeJoinStyle = "miter" | "round" | "bevel";

export type StrokeMeshOptions = {
	readonly cap: StrokeCapStyle;
	readonly join: StrokeJoinStyle;
	/** SVG `stroke-miterlimit` semantics: a miter join whose reach would exceed this factor falls back to a bevel. */
	readonly miterLimit: number;
};

type Point = { readonly x: number; readonly y: number };

const EPSILON = 1e-9;

const subtract = (a: Point, b: Point): Point => ({
	x: a.x - b.x,
	y: a.y - b.y,
});

const length = (v: Point): number => Math.hypot(v.x, v.y);

const normalize = (v: Point): Point => {
	const len = length(v);
	return len > EPSILON ? { x: v.x / len, y: v.y / len } : { x: 0, y: 0 };
};

/** Rotates a unit vector 90° counter-clockwise (screen/world Y-down convention matches the rest of `shared/gpu`). */
const perpendicular = (v: Point): Point => ({ x: -v.y, y: v.x });

const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (v: Point, factor: number): Point => ({
	x: v.x * factor,
	y: v.y * factor,
});

/**
 * One resolved segment of a world-space polyline: its two endpoints, unit
 * tangent/normal, and (E1 S8) each endpoint's cumulative WORLD-space arc
 * length along this segment's own CONTOUR (reset to `0` at the contour's own
 * start — see {@link buildContourMesh}), read by every emitted vertex's
 * `arcLength` component.
 */
type WorldSegment = {
	readonly start: Point;
	readonly end: Point;
	readonly tangent: Point;
	readonly normal: Point;
	readonly startArc: number;
	readonly endArc: number;
};

const applyMatrix = (
	matrix: {
		readonly a: number;
		readonly b: number;
		readonly c: number;
		readonly d: number;
		readonly e: number;
		readonly f: number;
	},
	x: number,
	y: number,
): Point => ({
	x: matrix.a * x + matrix.c * y + matrix.e,
	y: matrix.b * x + matrix.d * y + matrix.f,
});

/**
 * Builds the WORLD-space segment list for one flattened ring (already a flat
 * `[x0,y0,x1,y1,...]` polygon, see `flatten.ts::flattenAeShapeToRing`),
 * transforming every point by `worldTransform` first (see this file's doc
 * comment for why this must happen before normal computation, not after —
 * only a post-transform tangent/normal reproduces exact
 * `non-scaling-stroke` parity under a rotating/shearing/anisotropically-
 * scaled node transform, matching how a browser strokes an already-CTM-
 * mapped path in device space). Degenerate (near-zero-length) segments are
 * dropped so a duplicate flattening sample never produces a zero-length
 * tangent.
 *
 * (E1 S8) Each segment's `startArc`/`endArc` accumulate WORLD-space distance
 * from this RING's own start (arc `0` at `worldPoints[0]`) — dashing restarts
 * per contour, matching how a browser's `stroke-dasharray` restarts its phase
 * at each subpath (see this file's top doc comment's dash decisions). A
 * dropped degenerate segment contributes zero length, so the running total
 * never double-counts or skips a sample.
 */
function worldSegmentsForRing(
	ring: Float32Array,
	worldTransform: {
		readonly a: number;
		readonly b: number;
		readonly c: number;
		readonly d: number;
		readonly e: number;
		readonly f: number;
	},
	closed: boolean,
): readonly WorldSegment[] {
	const vertexCount = ring.length / 2;
	if (vertexCount < 2) return [];
	const worldPoints: Point[] = [];
	for (let index = 0; index < vertexCount; index++) {
		worldPoints.push(
			applyMatrix(worldTransform, ring[index * 2], ring[index * 2 + 1]),
		);
	}
	const segmentCount = closed ? vertexCount : vertexCount - 1;
	const segments: WorldSegment[] = [];
	let cumulativeArc = 0;
	for (let index = 0; index < segmentCount; index++) {
		const start = worldPoints[index];
		const end = worldPoints[(index + 1) % vertexCount];
		const tangent = normalize(subtract(end, start));
		if (tangent.x === 0 && tangent.y === 0) continue;
		const startArc = cumulativeArc;
		const endArc = startArc + length(subtract(end, start));
		segments.push({
			start,
			end,
			tangent,
			normal: perpendicular(tangent),
			startArc,
			endArc,
		});
		cumulativeArc = endArc;
	}
	return segments;
}

/**
 * Appends one triangle's three `{position, offset, arcLength}` vertices to
 * `out`, SELF-CORRECTING the winding order so every triangle this module
 * emits ends up consistently wound (see this file's top doc comment for why
 * consistent winding is load-bearing for the shared nonzero-winding stencil
 * pass). The caller may pass corners in either order; this computes the
 * triangle's actual corner positions at a nominal `halfWidth = 1` (the sign of
 * a triangle's signed area is invariant to any POSITIVE uniform scale of the
 * offsets, which `halfWidthWorld` always is, so testing at `1` is exact for
 * every real frame) and swaps the last two corners — POSITION, OFFSET, AND
 * `arcLength` together — when the signed area comes out negative — cheaper
 * and far more robust than hand-deriving the correct order at each of this
 * file's five call sites (segment quad, miter, bevel, round join, round cap).
 *
 * (E1 S8) `arc0`/`arc1`/`arc2` are each corner's WORLD-space cumulative arc
 * length — a segment quad's two corners AT THE SAME end share that end's arc
 * value (see {@link pushSegmentQuad}), while every join/cap fan corner shares
 * ONE joint/endpoint arc value (see {@link pushJoin}/{@link pushCap}) — this
 * function does not itself distinguish the two cases, it just carries
 * whatever the caller already computed straight into the interleaved buffer,
 * exactly like `position`/`offset`.
 */
function pushTriangle(
	out: number[],
	p0: Point,
	o0: Point,
	arc0: number,
	p1: Point,
	o1: Point,
	arc1: number,
	p2: Point,
	o2: Point,
	arc2: number,
): void {
	const c0 = add(p0, o0);
	const c1 = add(p1, o1);
	const c2 = add(p2, o2);
	const signedArea =
		(c1.x - c0.x) * (c2.y - c0.y) - (c2.x - c0.x) * (c1.y - c0.y);
	if (signedArea < 0) {
		out.push(
			p0.x,
			p0.y,
			o0.x,
			o0.y,
			arc0,
			p2.x,
			p2.y,
			o2.x,
			o2.y,
			arc2,
			p1.x,
			p1.y,
			o1.x,
			o1.y,
			arc1,
		);
		return;
	}
	out.push(
		p0.x,
		p0.y,
		o0.x,
		o0.y,
		arc0,
		p1.x,
		p1.y,
		o1.x,
		o1.y,
		arc1,
		p2.x,
		p2.y,
		o2.x,
		o2.y,
		arc2,
	);
}

/**
 * Emits one segment's extrusion quad as two triangles, using the SAME
 * per-segment normal at both ends (DECIDED: "per-VERTEX segment normal, not
 * averaged" — join geometry, not this quad, reconciles the normal seen by
 * adjacent segments at a shared vertex). (E1 S8) Both corners at `start`
 * carry `segment.startArc`; both corners at `end` carry `segment.endArc` — arc
 * length varies linearly ACROSS the quad via the rasterizer's own vertex
 * interpolation, exactly matching a straight segment's true arc-length
 * profile (see this file's top doc comment's mesh decisions).
 */
function pushSegmentQuad(out: number[], segment: WorldSegment): void {
	const { start, end, normal, startArc, endArc } = segment;
	const negNormal = scale(normal, -1);
	// Corners: A = start-n, B = start+n, C = end-n, D = end+n. CCW winding
	// (A, C, B) and (B, C, D) for a rectangle traversed start->end on the
	// left(-n)/right(+n) sides — verified against the screen Y-down, CCW-front
	// convention `perpendicular` establishes above.
	pushTriangle(
		out,
		start,
		negNormal,
		startArc,
		end,
		negNormal,
		endArc,
		start,
		normal,
		startArc,
	);
	pushTriangle(
		out,
		start,
		normal,
		startArc,
		end,
		negNormal,
		endArc,
		end,
		normal,
		endArc,
	);
}

/**
 * Emits a join between `prev` and `next` (consecutive segments sharing
 * `joint`) per `options.join`. Miter falls back to bevel when the reach would
 * exceed `options.miterLimit` (SVG `stroke-miterlimit` semantics) — this
 * fallback is resolved HERE, once, at mesh-build time (not per-frame), so the
 * cover-rect margin the caller applies (a cheap `miterLimit`-based conservative
 * bound) is never exceeded by the actual mesh.
 *
 * (E1 S8) Every fan vertex this function emits carries `jointArc` — the
 * joint's OWN single arc-length position (`prev.endArc`, identical to
 * `next.startArc` since both name the same contour point) — never an
 * interpolated value, matching how a join is one atomic point along the
 * dashed pattern's arc axis: the whole join appears or disappears together
 * with whatever dash segment/gap that one arc position falls in, the same
 * granularity a browser's dash-through-join rendering already exhibits.
 */
function pushJoin(
	out: number[],
	joint: Point,
	jointArc: number,
	prev: WorldSegment,
	next: WorldSegment,
	options: StrokeMeshOptions,
): void {
	const turnCross =
		prev.tangent.x * next.tangent.y - prev.tangent.y * next.tangent.x;
	const cosTheta = Math.max(
		-1,
		Math.min(1, prev.normal.x * next.normal.x + prev.normal.y * next.normal.y),
	);
	// Colinear (no turn): nothing to fill.
	if (Math.abs(turnCross) < EPSILON && cosTheta > 0) return;

	// The two segments' normals point in a fixed screen convention (left of
	// travel); the OUTER side of the turn is the side whose normal sign the
	// turn direction picks: `turnCross > 0` means `next.tangent` rotates CCW
	// from `prev.tangent`, which — for this module's CCW/left-normal
	// convention — puts the outer bulge on the `-normal` side, and vice versa.
	const outerSign = turnCross > 0 ? -1 : 1;
	const prevOuter = scale(prev.normal, outerSign);
	const nextOuter = scale(next.normal, outerSign);

	if (options.join === "round") {
		const startAngle = Math.atan2(prevOuter.y, prevOuter.x);
		let endAngle = Math.atan2(nextOuter.y, nextOuter.x);
		// Sweep the SHORT way from prevOuter to nextOuter (never crossing the
		// long way around) — normalize the angular delta into `(-PI, PI]` then
		// step across it in `ROUND_JOIN_SEGMENTS` equal increments.
		let delta = endAngle - startAngle;
		while (delta > Math.PI) delta -= 2 * Math.PI;
		while (delta < -Math.PI) delta += 2 * Math.PI;
		endAngle = startAngle + delta;
		for (let step = 0; step < ROUND_JOIN_SEGMENTS; step++) {
			const angleA = startAngle + (delta * step) / ROUND_JOIN_SEGMENTS;
			const angleB = startAngle + (delta * (step + 1)) / ROUND_JOIN_SEGMENTS;
			const offsetA = { x: Math.cos(angleA), y: Math.sin(angleA) };
			const offsetB = { x: Math.cos(angleB), y: Math.sin(angleB) };
			pushTriangle(
				out,
				joint,
				{ x: 0, y: 0 },
				jointArc,
				joint,
				offsetA,
				jointArc,
				joint,
				offsetB,
				jointArc,
			);
		}
		return;
	}

	if (options.join === "miter") {
		const halfCos = Math.sqrt(Math.max(0, (1 + cosTheta) / 2));
		const miterFactor =
			halfCos > EPSILON ? 1 / halfCos : Number.POSITIVE_INFINITY;
		if (miterFactor <= options.miterLimit) {
			const miterDir = normalize(add(prevOuter, nextOuter));
			const miterOffset = scale(miterDir, miterFactor);
			pushTriangle(
				out,
				joint,
				prevOuter,
				jointArc,
				joint,
				miterOffset,
				jointArc,
				joint,
				nextOuter,
				jointArc,
			);
			return;
		}
		// Falls through to bevel when the miter would exceed the limit.
	}

	// Bevel (or miter-limit fallback): one triangle connecting the two outer
	// corners directly across the joint.
	pushTriangle(
		out,
		joint,
		prevOuter,
		jointArc,
		joint,
		nextOuter,
		jointArc,
		joint,
		{ x: 0, y: 0 },
		jointArc,
	);
}

/**
 * Emits an end cap at `endpoint`, facing outward along `outwardTangent` (unit,
 * pointing AWAY from the contour). (E1 S8) Every fan vertex carries
 * `endpointArc` — the SAME single arc-length position as `endpoint` itself
 * (the contour's own start, `0`, or its final accumulated length) — matching
 * {@link pushJoin}'s identical "one atomic arc position per fan" contract.
 */
function pushCap(
	out: number[],
	endpoint: Point,
	endpointArc: number,
	outwardTangent: Point,
	normal: Point,
	cap: StrokeCapStyle,
): void {
	if (cap === "butt") return;

	if (cap === "square") {
		const negNormal = scale(normal, -1);
		const outerA = add(outwardTangent, normal);
		const outerB = add(outwardTangent, negNormal);
		pushTriangle(
			out,
			endpoint,
			normal,
			endpointArc,
			endpoint,
			outerA,
			endpointArc,
			endpoint,
			outerB,
			endpointArc,
		);
		pushTriangle(
			out,
			endpoint,
			normal,
			endpointArc,
			endpoint,
			outerB,
			endpointArc,
			endpoint,
			negNormal,
			endpointArc,
		);
		return;
	}

	// Round: a semicircular fan sweeping from `+normal` through `outwardTangent`
	// to `-normal`, bulging past the endpoint.
	const startAngle = Math.atan2(normal.y, normal.x);
	const outwardAngle = Math.atan2(outwardTangent.y, outwardTangent.x);
	let delta = outwardAngle - startAngle;
	while (delta > Math.PI) delta -= 2 * Math.PI;
	while (delta < -Math.PI) delta += 2 * Math.PI;
	// `delta` is now the short way to the outward direction (±PI/2); double it
	// to sweep the full semicircle from `+normal` to `-normal` through it.
	const sweep = delta * 2;
	for (let step = 0; step < ROUND_CAP_SEGMENTS; step++) {
		const angleA = startAngle + (sweep * step) / ROUND_CAP_SEGMENTS;
		const angleB = startAngle + (sweep * (step + 1)) / ROUND_CAP_SEGMENTS;
		const offsetA = { x: Math.cos(angleA), y: Math.sin(angleA) };
		const offsetB = { x: Math.cos(angleB), y: Math.sin(angleB) };
		pushTriangle(
			out,
			endpoint,
			{ x: 0, y: 0 },
			endpointArc,
			endpoint,
			offsetA,
			endpointArc,
			endpoint,
			offsetB,
			endpointArc,
		);
	}
}

/**
 * Builds one contour's stroke-extrusion triangles (segments + joins +, for an
 * open contour, end caps) and appends them to `out`.
 */
function buildContourMesh(
	ring: Float32Array,
	closed: boolean,
	worldTransform: {
		readonly a: number;
		readonly b: number;
		readonly c: number;
		readonly d: number;
		readonly e: number;
		readonly f: number;
	},
	options: StrokeMeshOptions,
	out: number[],
): void {
	const segments = worldSegmentsForRing(ring, worldTransform, closed);
	if (segments.length === 0) return;

	for (const segment of segments) pushSegmentQuad(out, segment);

	const joinCount = closed ? segments.length : segments.length - 1;
	for (let index = 0; index < joinCount; index++) {
		const prev = segments[index];
		const next = segments[(index + 1) % segments.length];
		pushJoin(out, prev.end, prev.endArc, prev, next, options);
	}

	if (!closed) {
		const first = segments[0];
		const last = segments[segments.length - 1];
		pushCap(
			out,
			first.start,
			first.startArc,
			scale(first.tangent, -1),
			first.normal,
			options.cap,
		);
		pushCap(out, last.end, last.endArc, last.tangent, last.normal, options.cap);
	}
}

/**
 * Builds one path's full stroke-extrusion mesh (every contour — outer path
 * plus any subpaths/holes, each independently stroked exactly as an SVG
 * `<path>`'s `stroke` attribute strokes every subpath in its `d` — see
 * `CanvasShell.tsx`'s `renderVectorGeometry` `case "path"`, one `<path>` with
 * every contour in `d`), as a flat interleaved `Float32Array` ready for the
 * RHI's stroke vertex buffer.
 *
 * Runs FRESH every frame (never itself cached) from already-flattened
 * (zoom-bucket-cached, see `gpu-scene-frame.ts::flattenCache`) local-space
 * `rings` — this mirrors `flatten.ts::fanTriangulateRings`'s existing
 * un-cached-output precedent for the exact same reason: the expensive step
 * (Bezier curve refinement) is what the cache above this call already avoids
 * repeating, while this function's own work (a linear pass building segment
 * quads/joins/caps from an already-flat polyline) is cheap enough to redo
 * every redraw, and — unlike the flattening step — is NOT zoom-bucket-
 * invariant: normals/joins must be computed from the WORLD-space (post-
 * `worldTransform`) polyline to reproduce exact `non-scaling-stroke` parity
 * under a rotating/shearing/anisotropically-scaled node transform (seeCPU
 * `worldSegmentsForRing`'s doc comment), so a transform-only edit DOES change
 * this function's output, unlike the fill triangulation's cached rings.
 */
export function buildStrokeMesh(
	contours: readonly {
		readonly ring: Float32Array;
		readonly closed: boolean;
	}[],
	worldTransform: {
		readonly a: number;
		readonly b: number;
		readonly c: number;
		readonly d: number;
		readonly e: number;
		readonly f: number;
	},
	options: StrokeMeshOptions,
): Float32Array {
	const out: number[] = [];
	for (const contour of contours) {
		buildContourMesh(
			contour.ring,
			contour.closed,
			worldTransform,
			options,
			out,
		);
	}
	return Float32Array.from(out);
}

/** Re-exported so callers can build `{ring, closed}` pairs from `AeShape` contours without a second lookup of the `closed` flag's source type. */
export type { AeShape };
