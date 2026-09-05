import type { FillRule, PathGeometry } from "@/entities/scene/model/types";
import { fitClosedContour } from "@/shared/geometry/curve-fit";
import type { AePoint, AeShape } from "@/shared/glammer/ae-shape";
import { aeShapeToSvgPath } from "@/shared/glammer/ae-shape-svg-path";

/**
 * Pure planar-arrangement engine for the Shape Builder tool — the one genuinely
 * new geometry primitive. It partitions N overlapping source paths into mutually
 * exclusive bounded FACES (closed regions bounded by edges, no edge inside), each
 * tagged with provenance (which sources cover it), and supports re-tracing the
 * union boundary of any subset of faces (interactive merge).
 *
 * Robustness rests on PREVENTION, not detection: an EXACT cross-product angular
 * comparator (no atan2/epsilon) sorts half-edges around each vertex, so
 * near-collinear edges never mis-sort. Three hard invariants (half-edge visited
 * once, twin/next involution, per-component Euler V-E+F=2) backstop GROSS errors.
 * This is the design demonstrated by the throwaway spike (incl. degenerate cases).
 *
 * Self-contained on purpose: it reuses only the shared geometry kernel
 * (`aeShapeToSvgPath`, `fitClosedContour`) and entities types, so the arch gate's
 * feature-to-feature import ban is satisfied. Committed results are re-fitted to
 * corner-preserving cubic Béziers (smooth arcs on curved sources) via
 * `facePathGeometry(..., refit)`; the overlay mesh stays straight-line for speed.
 */

export type Pt = { readonly x: number; readonly y: number };

export type ArrangeSource = {
	readonly id: string;
	readonly fillRule: FillRule;
	/** All flattened rings (outer + holes), artboard-local, transform baked. */
	readonly rings: readonly (readonly Pt[])[];
	/**
	 * Rings eligible for automatic gap bridging. Compound holes stay in `rings`
	 * for fill/provenance, but are excluded here so gap closing cannot tunnel
	 * from an internal cutout to a neighbouring external shape.
	 */
	readonly bridgeRings?: readonly (readonly Pt[])[];
	/** Hard-corner vertex positions (sharp anchors), artboard-local — kept sharp on re-fit. */
	readonly corners: readonly Pt[];
};

export type ShapeBuilderFace = {
	readonly id: string;
	readonly index: number;
	/** Outer boundary polyline, artboard-local. */
	readonly ring: readonly Pt[];
	readonly holes: readonly (readonly Pt[])[];
	readonly coveredBy: readonly string[];
	readonly area: number;
	readonly geometry: PathGeometry;
	/** SVG `d` for the overlay preview (artboard-local). */
	readonly pathD: string;
};

type Vertex = { readonly id: number; readonly x: number; readonly y: number };
type HalfEdge = {
	readonly id: number;
	readonly from: number;
	readonly to: number;
	readonly twin: number;
	next: number;
	face: number;
	readonly sourceSet: ReadonlySet<string>;
};

/** A face fully contained in another (disconnected nesting) → carved as a hole. */
export type FaceNesting = {
	readonly container: number;
	readonly contained: number;
	readonly ring: readonly Pt[];
};

export type Arrangement = {
	readonly ok: true;
	readonly faces: readonly ShapeBuilderFace[];
	/** Hard-corner positions (source sharp vertices + all crossings), snapped. */
	readonly corners: readonly Pt[];
	/** Corner-match tolerance for re-fit, tied to the snap grid. */
	readonly matchEpsilon: number;
	/**
	 * Disconnected-nesting relationships: a face wholly inside another (a separate
	 * DCEL component with no crossing). The union pipeline punches the contained
	 * ring out of its container when the container is unioned without it, so a
	 * fully-enclosed shape can be carved out (donut) or its ring selected.
	 */
	readonly nesting: readonly FaceNesting[];
	/** Internal DCEL retained for interactive union (merge). */
	readonly _dcel: {
		readonly verts: readonly Vertex[];
		readonly hes: readonly HalfEdge[];
		readonly outgoing: ReadonlyMap<number, readonly number[]>;
		readonly sources: readonly ArrangeSource[];
	};
};
export type ArrangeError = { readonly ok: false; readonly error: string };
export type ArrangeResult = Arrangement | ArrangeError;

const FLOAT_EPS = 1e-9;
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const cross = (a: Pt, b: Pt): number => a.x * b.y - a.y * b.x;

/** Proper interior crossing of two segments; null on parallel/collinear/endpoint. */
function crossSegments(a0: Pt, a1: Pt, b0: Pt, b1: Pt): Pt | null {
	const d1 = sub(a1, a0);
	const d2 = sub(b1, b0);
	const denom = cross(d1, d2);
	if (Math.abs(denom) <= FLOAT_EPS) return null;
	const diff = sub(b0, a0);
	const t = cross(diff, d2) / denom;
	const u = cross(diff, d1) / denom;
	if (t <= FLOAT_EPS || t >= 1 - FLOAT_EPS) return null;
	if (u <= FLOAT_EPS || u >= 1 - FLOAT_EPS) return null;
	return { x: a0.x + t * d1.x, y: a0.y + t * d1.y };
}

/** Parameter of `p` on segment [a,b] within tol, else null. */
function paramOnSegment(p: Pt, a: Pt, b: Pt, tol: number): number | null {
	const ab = sub(b, a);
	const len2 = ab.x * ab.x + ab.y * ab.y;
	if (len2 <= FLOAT_EPS) return null;
	const t = ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / len2;
	if (t < -tol || t > 1 + tol) return null;
	const proj = { x: a.x + t * ab.x, y: a.y + t * ab.y };
	if ((proj.x - p.x) ** 2 + (proj.y - p.y) ** 2 > tol * tol) return null;
	return Math.min(1, Math.max(0, t));
}

/** Collinear-overlap split params on [a0,a1] for the projected endpoints of [b0,b1]. */
function collinearOverlap(
	a0: Pt,
	a1: Pt,
	b0: Pt,
	b1: Pt,
	tol: number,
): number[] {
	const d1 = sub(a1, a0);
	const d2 = sub(b1, b0);
	if (Math.abs(cross(d1, d2)) > FLOAT_EPS) return [];
	const len1 = Math.hypot(d1.x, d1.y) || 1;
	if (Math.abs(cross(d1, sub(b0, a0))) > tol * len1) return [];
	const out: number[] = [];
	for (const bp of [b0, b1]) {
		const t = paramOnSegment(bp, a0, a1, tol);
		if (t !== null && t > tol && t < 1 - tol) out.push(t);
	}
	return out;
}

function signedArea(ring: readonly Pt[]): number {
	let s = 0;
	for (let i = 0; i < ring.length; i++) {
		const a = ring[i];
		const b = ring[(i + 1) % ring.length];
		s += a.x * b.y - b.x * a.y;
	}
	return s / 2;
}

/** Winding number of point wrt one ring (0 ⇒ outside under nonzero fill). */
function windingNumber(p: Pt, ring: readonly Pt[]): number {
	let wn = 0;
	for (let i = 0; i < ring.length; i++) {
		const a = ring[i];
		const b = ring[(i + 1) % ring.length];
		if (a.y <= p.y) {
			if (b.y > p.y && cross(sub(b, a), sub(p, a)) > 0) wn++;
		} else if (b.y <= p.y && cross(sub(b, a), sub(p, a)) < 0) wn--;
	}
	return wn;
}

function evenOddInside(p: Pt, ring: readonly Pt[]): boolean {
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const a = ring[i];
		const b = ring[j];
		if (a.y > p.y !== b.y > p.y) {
			const xint = ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
			if (p.x < xint) inside = !inside;
		}
	}
	return inside;
}

/** Whether a source covers a point under its OWN fill rule, across all its rings. */
function sourceCovers(p: Pt, source: ArrangeSource): boolean {
	if (source.fillRule === "evenodd") {
		let inside = false;
		for (const ring of source.rings)
			if (evenOddInside(p, ring)) inside = !inside;
		return inside;
	}
	let wn = 0;
	for (const ring of source.rings) wn += windingNumber(p, ring);
	return wn !== 0;
}

// EXACT cross-product angular comparator (CCW order from +x axis). No atan2/epsilon.
const halfPlane = (d: Pt): number =>
	d.y < 0 || (d.y === 0 && d.x < 0) ? 1 : 0;
function compareDir(a: Pt, b: Pt): number {
	const h = halfPlane(a) - halfPlane(b);
	if (h !== 0) return h;
	const c = cross(a, b);
	if (c > 0) return -1;
	if (c < 0) return 1;
	return 0;
}

/** Robust interior representative point of a (CCW) ring: edge-midpoint + inward normal. */
function interiorRep(ring: readonly Pt[], span: number): Pt {
	const n = ring.length;
	const delta = Math.max(span * 1e-3, 1e-4);
	for (let i = 0; i < n; i++) {
		const a = ring[i];
		const b = ring[(i + 1) % n];
		const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
		const dir = { x: b.x - a.x, y: b.y - a.y };
		const len = Math.hypot(dir.x, dir.y) || 1;
		const rep = {
			x: mid.x - (dir.y / len) * delta,
			y: mid.y + (dir.x / len) * delta,
		};
		if (windingNumber(rep, ring) !== 0) return rep;
	}
	return {
		x: ring.reduce((s, p) => s + p.x, 0) / n,
		y: ring.reduce((s, p) => s + p.y, 0) / n,
	};
}

/**
 * Interior representative of `ring` that also sits OUTSIDE every hole (a point in
 * the annulus) — so a carved container's provenance is attributed to its own
 * sources, not the punched-out region's. Falls back to `fallback` if no
 * inward-pushed edge midpoint clears the holes.
 */
function repOutsideHoles(
	ring: readonly Pt[],
	holes: readonly (readonly Pt[])[],
	fallback: Pt,
	span: number,
): Pt {
	if (holes.length === 0) return fallback;
	const n = ring.length;
	const delta = Math.max(span * 1e-3, 1e-4);
	for (let i = 0; i < n; i++) {
		const a = ring[i];
		const b = ring[(i + 1) % n];
		const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
		const dir = { x: b.x - a.x, y: b.y - a.y };
		const len = Math.hypot(dir.x, dir.y) || 1;
		const rep = {
			x: mid.x - (dir.y / len) * delta,
			y: mid.y + (dir.x / len) * delta,
		};
		if (
			windingNumber(rep, ring) !== 0 &&
			!holes.some((hole) => windingNumber(rep, hole) !== 0)
		)
			return rep;
	}
	return fallback;
}

const ringToAeShape = (ring: readonly Pt[]): AeShape => {
	const vertices: AePoint[] = ring.map((p) => [p.x, p.y]);
	const zeros: AePoint[] = ring.map(() => [0, 0]);
	return {
		type: "Shape",
		closed: true,
		vertices,
		inTangents: zeros,
		outTangents: zeros,
	};
};

/** Optional corner-preserving cubic re-fit applied per ring at commit time. */
export type RefitOptions = {
	readonly corners: readonly Pt[];
	readonly matchEpsilon: number;
	readonly toleranceScale?: number;
};

/**
 * Builds emit-ready PathGeometry (compound when holes are present). Without
 * `refit` the result is the straight-line polyline (used for the lightweight
 * overlay). With `refit` each ring is re-fitted to corner-preserving cubic
 * Béziers (smooth arcs on curved sources), falling back to the straight ring for
 * any ring the fitter declines — never the whole face, so holes/evenodd hold.
 */
export function facePathGeometry(
	outer: readonly Pt[],
	holes: readonly (readonly Pt[])[],
	refit?: RefitOptions,
): PathGeometry {
	const refitRing = (ring: readonly Pt[]): AeShape =>
		refit
			? (fitClosedContour(ring, refit.corners, {
					matchEpsilon: refit.matchEpsilon,
					...(refit.toleranceScale === undefined
						? {}
						: { toleranceScale: refit.toleranceScale }),
				}) ?? ringToAeShape(ring))
			: ringToAeShape(ring);
	const shape = refitRing(outer);
	const subpaths = holes.filter((h) => h.length >= 3).map(refitRing);
	return subpaths.length > 0
		? { kind: "path", shape, subpaths, fillRule: "evenodd" }
		: { kind: "path", shape };
}

export const pathDForGeometry = (geometry: PathGeometry): string =>
	[geometry.shape, ...(geometry.subpaths ?? [])]
		.map(aeShapeToSvgPath)
		.filter((d) => d.length > 0)
		.join(" ");

/**
 * Computes the planar arrangement of `sources` into bounded faces with provenance.
 * Returns a typed error rather than emitting garbage on a topology-invariant
 * violation (the prevention-first comparator means this should not occur in
 * practice; the invariants are the GROSS-error backstop).
 */
export function arrange(
	sources: readonly ArrangeSource[],
	options?: { readonly gapTolerance?: number },
): ArrangeResult {
	// Gap detection: bridge separate components whose boundaries approach within
	// this distance (0 = off). Opt-in — the live tool passes an adaptive value.
	const gapTol = Math.max(0, options?.gapTolerance ?? 0);
	const rings = sources.flatMap((s) =>
		s.rings.map((ring) => ({ ring, sourceId: s.id })),
	);
	const bridgeRings = sources.flatMap((s) =>
		(s.bridgeRings ?? s.rings).map((ring) => ({ ring, sourceId: s.id })),
	);
	if (rings.length === 0)
		return { ok: false, error: "shape-builder.no-sources" };
	for (const { ring } of rings)
		if (ring.length < 3)
			return { ok: false, error: "shape-builder.open-source" };

	let minX = Infinity,
		minY = Infinity,
		maxX = -Infinity,
		maxY = -Infinity;
	for (const { ring } of rings)
		for (const p of ring) {
			minX = Math.min(minX, p.x);
			minY = Math.min(minY, p.y);
			maxX = Math.max(maxX, p.x);
			maxY = Math.max(maxY, p.y);
		}
	const diag = Math.hypot(maxX - minX, maxY - minY);
	const g = Math.min(1e-3, Math.max(1e-5, diag * 1e-7));
	const ON_EDGE = Math.max(g / 2, 1e-9);

	const vmap = new Map<string, number>();
	const verts: Vertex[] = [];
	const vertexKey = (p: Pt): string =>
		`${Math.round(p.x / g)}:${Math.round(p.y / g)}`;
	const intern = (p: Pt): number => {
		const x = Math.round(p.x / g) * g;
		const y = Math.round(p.y / g) * g;
		const k = vertexKey(p);
		let id = vmap.get(k);
		if (id === undefined) {
			id = verts.length;
			verts.push({ id, x, y });
			vmap.set(k, id);
		}
		return id;
	};

	type SrcEdge = {
		readonly a: number;
		readonly b: number;
		readonly sourceId: string;
	};
	const srcEdges: SrcEdge[] = [];
	for (const { ring, sourceId } of rings) {
		const ids = ring.map(intern);
		for (let i = 0; i < ids.length; i++) {
			const a = ids[i];
			const b = ids[(i + 1) % ids.length];
			if (a !== b) srcEdges.push({ a, b, sourceId });
		}
	}

	const ptOf = (id: number): Pt => verts[id];
	const snapPt = (p: Pt): Pt => ({
		x: Math.round(p.x / g) * g,
		y: Math.round(p.y / g) * g,
	});
	const crossingRaw: Pt[] = [];
	const splitParams: number[][] = srcEdges.map(() => []);
	for (let i = 0; i < srcEdges.length; i++) {
		const ei = srcEdges[i];
		const a0 = ptOf(ei.a);
		const a1 = ptOf(ei.b);
		for (const v of verts) {
			if (v.id === ei.a || v.id === ei.b) continue;
			const t = paramOnSegment(v, a0, a1, ON_EDGE);
			if (t !== null && t > ON_EDGE && t < 1 - ON_EDGE) splitParams[i].push(t);
		}
		for (let j = 0; j < srcEdges.length; j++) {
			if (i === j) continue;
			const ej = srcEdges[j];
			const b0 = ptOf(ej.a);
			const b1 = ptOf(ej.b);
			const x = crossSegments(a0, a1, b0, b1);
			if (x) {
				crossingRaw.push(x); // a crossing is a hard corner (boundary switches source)
				const t = paramOnSegment(x, a0, a1, ON_EDGE);
				if (t !== null && t > ON_EDGE && t < 1 - ON_EDGE)
					splitParams[i].push(t);
			}
			for (const t of collinearOverlap(a0, a1, b0, b1, ON_EDGE))
				splitParams[i].push(t);
		}
	}

	const edgeKey = (a: number, b: number): string =>
		a < b ? `${a}:${b}` : `${b}:${a}`;
	const edgeSets = new Map<string, Set<string>>();
	const addSub = (a: number, b: number, src: string): void => {
		if (a === b) return;
		const k = edgeKey(a, b);
		let s = edgeSets.get(k);
		if (!s) {
			s = new Set();
			edgeSets.set(k, s);
		}
		s.add(src);
	};
	/** A zero-source connector edge (gap bridge) — contributes no provenance. */
	const addBridge = (a: number, b: number): void => {
		if (a === b) return;
		const k = edgeKey(a, b);
		if (!edgeSets.has(k)) edgeSets.set(k, new Set());
	};
	for (let i = 0; i < srcEdges.length; i++) {
		const e = srcEdges[i];
		const a0 = ptOf(e.a);
		const a1 = ptOf(e.b);
		const params = [...new Set(splitParams[i])].sort((p, q) => p - q);
		let prev = e.a;
		for (const t of params) {
			const mid = intern({
				x: a0.x + t * (a1.x - a0.x),
				y: a0.y + t * (a1.y - a0.y),
			});
			addSub(prev, mid, e.sourceId);
			prev = mid;
		}
		addSub(prev, e.b, e.sourceId);
	}

	// GAP DETECTION (Illustrator-style): bridge source pairs whose boundaries come
	// within gapTol but don't already touch — WITHOUT moving the artwork. Insert two
	// zero-source connector edges (a thin quadrilateral neck) between the closest
	// approaching vertices and their ring-neighbours, so the face walk can traverse
	// the gap and the enclosed region closes. Only bridges pairs that share no vertex
	// (i.e. genuinely separate). Malformed bridges are caught by the topology
	// invariants downstream (arrange returns an error rather than garbage).
	if (gapTol > 0 && sources.length >= 2) {
		const allVertsOfSource = new Map<string, Set<number>>();
		const bridgeVertsOfSource = new Map<string, Set<number>>();
		const bridgeAdj = new Map<number, Set<number>>();
		const link = (
			map: Map<number, Set<number>>,
			k: number,
			v: number,
		): void => {
			const s = map.get(k);
			if (s) s.add(v);
			else map.set(k, new Set([v]));
		};
		// Membership from the SPLIT edges (not the raw source rings): a crossing
		// vertex is an endpoint of both sources' sub-edges, so overlapping shapes
		// correctly share vertices here and are skipped (not bridged).
		for (const [k, srcSet] of edgeSets) {
			const [a, b] = k.split(":").map(Number);
			for (const src of srcSet) {
				const vs = allVertsOfSource.get(src);
				if (vs) {
					vs.add(a);
					vs.add(b);
				} else allVertsOfSource.set(src, new Set([a, b]));
			}
		}
		for (const { ring, sourceId } of bridgeRings) {
			const ids = ring
				.map((point) => vmap.get(vertexKey(point)))
				.filter((id): id is number => id !== undefined);
			if (ids.length !== ring.length) continue;
			let vs = bridgeVertsOfSource.get(sourceId);
			if (!vs) {
				vs = new Set();
				bridgeVertsOfSource.set(sourceId, vs);
			}
			for (let index = 0; index < ids.length; index += 1) {
				const a = ids[index];
				const b = ids[(index + 1) % ids.length];
				vs.add(a);
				vs.add(b);
				link(bridgeAdj, a, b);
				link(bridgeAdj, b, a);
			}
		}
		const ids = [...bridgeVertsOfSource.keys()];
		const dist2 = (u: number, v: number): number =>
			(verts[u].x - verts[v].x) ** 2 + (verts[u].y - verts[v].y) ** 2;
		const gapTol2 = gapTol * gapTol;
		for (let i = 0; i < ids.length; i++) {
			for (let j = i + 1; j < ids.length; j++) {
				const A = [...(bridgeVertsOfSource.get(ids[i]) ?? [])];
				const B = [...(bridgeVertsOfSource.get(ids[j]) ?? [])];
				if (A.length === 0 || B.length === 0) continue;
				const allA = allVertsOfSource.get(ids[i]) ?? new Set<number>();
				const allB = allVertsOfSource.get(ids[j]) ?? new Set<number>();
				if ([...allA].some((v) => allB.has(v))) continue; // already touching/crossing
				let best = Number.POSITIVE_INFINITY;
				let va = -1;
				let vb = -1;
				for (const a of A)
					for (const b of B) {
						const d = dist2(a, b);
						if (d < best) {
							best = d;
							va = a;
							vb = b;
						}
					}
				if (va < 0 || best > gapTol2) continue;
				// Second connector = the closest neighbour pair, forming a thin neck.
				// Sparse corners can be close while their adjacent vertices are far away;
				// rejecting those cases prevents a synthetic gap edge from becoming a
				// long diagonal that enters the committed outline.
				let best2 = Number.POSITIVE_INFINITY;
				let va2 = -1;
				let vb2 = -1;
				for (const na of bridgeAdj.get(va) ?? [])
					for (const nb of bridgeAdj.get(vb) ?? []) {
						const d = dist2(na, nb);
						if (d < best2) {
							best2 = d;
							va2 = na;
							vb2 = nb;
						}
					}
				const primarySpan = Math.sqrt(best);
				const maxSecondSpan = Math.max(gapTol * 1.5, primarySpan * 4);
				if (va2 < 0 || vb2 < 0 || best2 > maxSecondSpan * maxSecondSpan)
					continue;
				addBridge(va, vb);
				addBridge(va2, vb2);
			}
		}
	}

	const hes: HalfEdge[] = [];
	const outgoing = new Map<number, number[]>();
	const pushOut = (v: number, he: number): void => {
		const list = outgoing.get(v);
		if (list) list.push(he);
		else outgoing.set(v, [he]);
	};
	for (const [k, srcSet] of edgeSets) {
		const [a, b] = k.split(":").map(Number);
		const id1 = hes.length;
		hes.push({
			id: id1,
			from: a,
			to: b,
			twin: id1 + 1,
			next: -1,
			face: -1,
			sourceSet: srcSet,
		});
		hes.push({
			id: id1 + 1,
			from: b,
			to: a,
			twin: id1,
			next: -1,
			face: -1,
			sourceSet: srcSet,
		});
		pushOut(a, id1);
		pushOut(b, id1 + 1);
	}

	const dirOf = (h: HalfEdge): Pt => ({
		x: verts[h.to].x - verts[h.from].x,
		y: verts[h.to].y - verts[h.from].y,
	});
	for (const list of outgoing.values()) {
		list.sort((ha, hb) => {
			const cmp = compareDir(dirOf(hes[ha]), dirOf(hes[hb]));
			return cmp !== 0 ? cmp : ha - hb;
		});
	}
	for (const h of hes) {
		const ring = outgoing.get(h.to);
		if (!ring) return { ok: false, error: "shape-builder.dangling-vertex" };
		const i = ring.indexOf(h.twin);
		h.next = ring[(i - 1 + ring.length) % ring.length];
	}

	// face walk
	const visited: boolean[] = Array.from({ length: hes.length }, () => false);
	type RawFace = {
		readonly heIds: number[];
		readonly ring: Pt[];
		readonly sourceSet: Set<string>;
		readonly area: number;
	};
	const rawFaces: RawFace[] = [];
	for (const start of hes) {
		if (visited[start.id]) continue;
		const heIds: number[] = [];
		const ring: Pt[] = [];
		const sourceSet = new Set<string>();
		let cur = start.id;
		let guard = 0;
		while (!visited[cur]) {
			if (guard++ > hes.length + 5)
				return { ok: false, error: "shape-builder.traversal-runaway" };
			visited[cur] = true;
			const h = hes[cur];
			heIds.push(cur);
			ring.push(verts[h.from]);
			for (const s of h.sourceSet) sourceSet.add(s);
			h.face = rawFaces.length;
			cur = h.next;
		}
		if (cur !== start.id)
			return { ok: false, error: "shape-builder.face-not-closed" };
		rawFaces.push({ heIds, ring, sourceSet, area: signedArea(ring) });
	}
	if (visited.some((v) => !v))
		return { ok: false, error: "shape-builder.halfedge-uncovered" };

	// connected components + per-component Euler V-E+F=2
	const parent = verts.map((v) => v.id);
	const find = (x: number): number => {
		let root = x;
		while (parent[root] !== root) root = parent[root];
		let cur = x;
		while (parent[cur] !== root) {
			const nextRoot = parent[cur];
			parent[cur] = root;
			cur = nextRoot;
		}
		return root;
	};
	const usedV = new Set<number>();
	for (const k of edgeSets.keys()) {
		const [a, b] = k.split(":").map(Number);
		parent[find(a)] = find(b);
		usedV.add(a);
		usedV.add(b);
	}
	const comps = new Set<number>();
	for (const v of usedV) comps.add(find(v));
	for (const root of comps) {
		let V = 0,
			E = 0,
			F = 0;
		for (const v of usedV) if (find(v) === root) V++;
		for (const k of edgeSets.keys())
			if (find(Number(k.split(":")[0])) === root) E++;
		for (const f of rawFaces)
			if (f.heIds.length > 0 && find(hes[f.heIds[0]].from) === root) F++;
		if (V - E + F !== 2)
			return { ok: false, error: `shape-builder.euler:${V - E + F}` };
	}

	// bounded faces are positive-area; exactly one negative outer face per component
	const outerCount = rawFaces.filter((f) => f.area < -1e-9).length;
	if (outerCount !== comps.size)
		return {
			ok: false,
			error: `shape-builder.outer-count:${outerCount}/${comps.size}`,
		};

	// Each bounded minimal face is one selectable region, keyed by its WALK index so
	// `unionFaces` can match a swept subset against the same `he.face` membership.
	// Positive faces are collected with their DCEL component so DISCONNECTED nesting
	// (a shape fully inside another with no crossing = a separate component, hence no
	// shared vertex, hence strictly-disjoint boundaries) can be carved into an
	// annulus + inner disk. Strict disjointness makes a single interior-point test
	// decide containment exactly; the smallest-area container is the direct parent.
	type PositiveFace = {
		readonly index: number;
		readonly ring: readonly Pt[];
		readonly rep: Pt;
		readonly area: number;
		readonly comp: number;
	};
	const positive: PositiveFace[] = [];
	rawFaces.forEach((f, i) => {
		if (f.area <= 1e-9 || f.heIds.length === 0) return;
		positive.push({
			index: i,
			ring: f.ring,
			rep: interiorRep(f.ring, diag),
			area: f.area,
			comp: find(hes[f.heIds[0]].from),
		});
	});

	const nesting: FaceNesting[] = [];
	const holesByFace = new Map<number, Pt[][]>();
	for (const inner of positive) {
		let container: PositiveFace | null = null;
		for (const outer of positive) {
			if (
				outer.index === inner.index ||
				outer.comp === inner.comp ||
				outer.area <= inner.area
			)
				continue;
			if (windingNumber(inner.rep, outer.ring) === 0) continue;
			if (!container || outer.area < container.area) container = outer;
		}
		if (!container) continue;
		nesting.push({
			container: container.index,
			contained: inner.index,
			ring: inner.ring,
		});
		const list = holesByFace.get(container.index);
		if (list) list.push([...inner.ring]);
		else holesByFace.set(container.index, [[...inner.ring]]);
	}

	const faces: ShapeBuilderFace[] = positive.map((f) => {
		const holes = holesByFace.get(f.index) ?? [];
		const rep = repOutsideHoles(f.ring, holes, f.rep, diag);
		const coveredBy = sources
			.filter((s) => sourceCovers(rep, s))
			.map((s) => s.id);
		const geometry = facePathGeometry(f.ring, holes);
		const holeArea = holes.reduce((sum, h) => sum + Math.abs(signedArea(h)), 0);
		return {
			id: `sb${f.index}`,
			index: f.index,
			ring: f.ring,
			holes,
			coveredBy,
			area: Math.max(1e-9, f.area - holeArea),
			geometry,
			pathD: pathDForGeometry(geometry),
		};
	});

	// Hard-corner positions for re-fit = source sharp vertices + all crossings, snapped
	// to the same grid as the ring vertices so the fitter matches them exactly.
	const cornerMap = new Map<string, Pt>();
	const addCorner = (p: Pt): void => {
		const key = `${Math.round(p.x / g)}:${Math.round(p.y / g)}`;
		if (!cornerMap.has(key)) cornerMap.set(key, snapPt(p));
	};
	for (const src of sources) for (const c of src.corners) addCorner(c);
	for (const x of crossingRaw) addCorner(x);
	const corners = [...cornerMap.values()];
	const matchEpsilon = Math.max(g * 2, 1e-9);

	return {
		ok: true,
		faces,
		corners,
		matchEpsilon,
		nesting,
		_dcel: { verts, hes, outgoing, sources },
	};
}

/**
 * Re-traces the union boundary of a subset of faces (interactive merge). Boundary
 * half-edges (in the subset, twin outside) are stitched into outer rings + holes
 * by the same exact-comparator rotational rule used by the face walk.
 */
export function unionFaces(
	arrangement: Arrangement,
	faceIndices: readonly number[],
): {
	readonly outer: readonly Pt[];
	readonly holes: readonly (readonly Pt[])[];
}[] {
	const { hes, verts } = arrangement._dcel;
	const inSet = new Set(faceIndices);
	// Boundary of the swept region: half-edges whose face is in the set and whose
	// twin's face is not (membership read from each half-edge's stored walk index).
	const isBoundary = (he: HalfEdge): boolean =>
		inSet.has(he.face) && !inSet.has(hes[he.twin].face);
	const boundary = hes.filter(isBoundary);
	if (boundary.length === 0) return [];

	const dirOf = (h: HalfEdge): Pt => ({
		x: verts[h.to].x - verts[h.from].x,
		y: verts[h.to].y - verts[h.from].y,
	});
	const outByVertex = new Map<number, number[]>();
	for (const he of boundary) {
		const list = outByVertex.get(he.from);
		if (list) list.push(he.id);
		else outByVertex.set(he.from, [he.id]);
	}
	for (const list of outByVertex.values())
		list.sort((ha, hb) => {
			const cmp = compareDir(dirOf(hes[ha]), dirOf(hes[hb]));
			return cmp !== 0 ? cmp : ha - hb;
		});

	const nextOf = new Map<number, number>();
	for (const he of boundary) {
		const ring = outByVertex.get(he.to);
		if (!ring || ring.length === 0) continue;
		const twinIdx = ring.indexOf(he.twin);
		const idx = twinIdx >= 0 ? (twinIdx - 1 + ring.length) % ring.length : 0;
		nextOf.set(he.id, ring[idx]);
	}

	const seen = new Set<number>();
	const loops: Pt[][] = [];
	for (const he of boundary) {
		if (seen.has(he.id)) continue;
		const loop: Pt[] = [];
		let cur = he.id;
		let guard = 0;
		while (!seen.has(cur) && guard++ <= boundary.length + 2) {
			seen.add(cur);
			loop.push(verts[hes[cur].from]);
			const nx = nextOf.get(cur);
			if (nx === undefined) break;
			cur = nx;
		}
		if (loop.length >= 3) loops.push(loop);
	}

	const outers = loops.filter((l) => signedArea(l) > 0);
	const holes = loops.filter((l) => signedArea(l) < 0);
	return outers.map((outer) => ({
		outer,
		holes: holes.filter((h) => windingNumber(interiorRep(h, 1), outer) !== 0),
	}));
}

/**
 * Groups a face-index set into edge-connected components (two faces are adjacent
 * when they share an undirected edge — a half-edge in one whose twin is in the
 * other). Faces that only touch at a point (a pinch) are NOT adjacent, so they
 * land in separate components.
 */
export function connectedFaceComponents(
	arrangement: Arrangement,
	faceIndices: readonly number[],
): number[][] {
	const { hes } = arrangement._dcel;
	const inSet = new Set(faceIndices);
	const parent = new Map<number, number>([...inSet].map((i) => [i, i]));
	const find = (x: number): number => {
		let root = x;
		while (parent.get(root) !== root) root = parent.get(root) as number;
		let cur = x;
		while (parent.get(cur) !== root) {
			const nextRoot = parent.get(cur) as number;
			parent.set(cur, root);
			cur = nextRoot;
		}
		return root;
	};
	for (const he of hes) {
		const f1 = he.face;
		const f2 = hes[he.twin].face;
		if (inSet.has(f1) && inSet.has(f2)) parent.set(find(f1), find(f2));
	}
	const groups = new Map<number, number[]>();
	for (const i of inSet) {
		const root = find(i);
		const list = groups.get(root);
		if (list) list.push(i);
		else groups.set(root, [i]);
	}
	return [...groups.values()];
}

/**
 * Union boundary of a face subset, computed per edge-connected component so a
 * non-contiguous selection (or two faces meeting only at a pinch point) yields
 * one region per contiguous blob rather than a mis-threaded single loop.
 */
export function unionFacesGrouped(
	arrangement: Arrangement,
	faceIndices: readonly number[],
): {
	readonly outer: readonly Pt[];
	readonly holes: readonly (readonly Pt[])[];
}[] {
	const regions = connectedFaceComponents(arrangement, faceIndices).flatMap(
		(group) =>
			unionFaces(arrangement, group).map((region) => ({
				outer: region.outer,
				holes: [...region.holes] as Pt[][],
			})),
	);
	if (arrangement.nesting.length === 0) return regions;
	// Disconnected nesting: when a container face is unioned WITHOUT its contained
	// face, the contained region is punched out as a hole (donut / ring). Attach it
	// to the SMALLEST region that contains it, so depth-N nesting lands on the direct
	// parent, not an outer ancestor.
	const inSet = new Set(faceIndices);
	for (const nest of arrangement.nesting) {
		if (!inSet.has(nest.container) || inSet.has(nest.contained)) continue;
		const rep = interiorRep(nest.ring, 1);
		let target: (typeof regions)[number] | null = null;
		for (const region of regions) {
			if (windingNumber(rep, region.outer) === 0) continue;
			if (
				!target ||
				Math.abs(signedArea(region.outer)) < Math.abs(signedArea(target.outer))
			)
				target = region;
		}
		if (target) target.holes.push([...nest.ring]);
	}
	return regions;
}

/**
 * Selectable bounded faces created by gap detection: a "neck" bordered by at
 * least one zero-source bridge edge (see `addBridge`). Identified STRUCTURALLY —
 * a bridge edge carries no provenance — so a legitimately enclosed empty pocket
 * (bounded only by real source edges, e.g. the hole in the middle of three
 * shapes) is NEVER mistaken for a neck and never auto-filled.
 */
function bridgeFaceIndices(arrangement: Arrangement): Set<number> {
	const { hes } = arrangement._dcel;
	const selectable = new Set(arrangement.faces.map((f) => f.index));
	const bridge = new Set<number>();
	for (const he of hes)
		if (he.sourceSet.size === 0 && selectable.has(he.face)) bridge.add(he.face);
	return bridge;
}

/**
 * Expands a swept face set with gap-bridge neck faces that connect two or more
 * already-swept faces, so a merge across a small gap unites into ONE shape even
 * when the drag never crossed the (thin, easily-missed) neck itself. Without
 * this, a natural merge-drag straight across two gapped shapes samples only the
 * two disks — which live in separate components — and silently yields two
 * shapes. Only necks are pulled in (never real-edged pockets), and only when
 * they bridge ≥2 swept faces; iterated to a fixpoint so chains of necks resolve.
 */
export function withBridgeFaces(
	arrangement: Arrangement,
	faceIndices: readonly number[],
): number[] {
	const bridges = bridgeFaceIndices(arrangement);
	if (bridges.size === 0) return [...faceIndices];
	const { hes } = arrangement._dcel;
	const neighbours = new Map<number, Set<number>>();
	for (const he of hes) {
		const f = he.face;
		const g = hes[he.twin].face;
		if (f < 0 || g < 0 || f === g) continue;
		const s = neighbours.get(f);
		if (s) s.add(g);
		else neighbours.set(f, new Set([g]));
	}
	const swept = new Set(faceIndices);
	let changed = true;
	while (changed) {
		changed = false;
		for (const b of bridges) {
			if (swept.has(b)) continue;
			const adj = neighbours.get(b);
			if (!adj) continue;
			let count = 0;
			for (const n of adj) if (swept.has(n)) count++;
			if (count >= 2) {
				swept.add(b);
				changed = true;
			}
		}
	}
	return [...swept];
}
