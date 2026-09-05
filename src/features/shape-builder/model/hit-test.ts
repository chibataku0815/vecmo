import type { Pt, ShapeBuilderFace } from "./arrangement";

/**
 * Face hit-testing for the Shape Builder tool. The scene-level path hit-test is
 * bounding-box only, so the tool owns this point-in-face test against the
 * computed face polylines (artboard-local, the space of `context.point`).
 */

/** Even-odd ray-cast point-in-ring. */
export function pointInRing(p: Pt, ring: readonly Pt[]): boolean {
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

/** Inside the outer ring and outside every hole. */
export function pointInFace(p: Pt, face: ShapeBuilderFace): boolean {
	if (!pointInRing(p, face.ring)) return false;
	return !face.holes.some((hole) => pointInRing(p, hole));
}

/**
 * Topmost face under a point. Faces partition the plane in the connected case;
 * where regions nest (a small region inside a larger one), the smallest-area
 * containing face wins so the inner region is pickable.
 */
export function faceAtPoint(
	faces: readonly ShapeBuilderFace[],
	p: Pt,
): ShapeBuilderFace | null {
	let best: ShapeBuilderFace | null = null;
	for (const face of faces) {
		if (!pointInFace(p, face)) continue;
		if (!best || face.area < best.area) best = face;
	}
	return best;
}

const distancePointToSegmentSquared = (p: Pt, a: Pt, b: Pt): number => {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const len2 = dx * dx + dy * dy;
	if (len2 <= 1e-12) return (p.x - a.x) ** 2 + (p.y - a.y) ** 2;
	const t = Math.max(
		0,
		Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2),
	);
	const x = a.x + dx * t;
	const y = a.y + dy * t;
	return (p.x - x) ** 2 + (p.y - y) ** 2;
};

const distancePointToRingSquared = (p: Pt, ring: readonly Pt[]): number => {
	let best = Number.POSITIVE_INFINITY;
	for (let i = 0; i < ring.length; i++) {
		best = Math.min(
			best,
			distancePointToSegmentSquared(p, ring[i], ring[(i + 1) % ring.length]),
		);
	}
	return best;
};

const distancePointToFaceBoundarySquared = (
	p: Pt,
	face: ShapeBuilderFace,
): number => {
	let best = distancePointToRingSquared(p, face.ring);
	for (const hole of face.holes)
		best = Math.min(best, distancePointToRingSquared(p, hole));
	return best;
};

/**
 * Face under a cursor with Illustrator-style boundary tolerance. Exact interior
 * hits still win; if the pointer rides an edge/seam, the nearest face boundary
 * within `tolerance` becomes targetable instead of returning null.
 */
export function faceAtTracePoint(
	faces: readonly ShapeBuilderFace[],
	p: Pt,
	tolerance: number,
): ShapeBuilderFace | null {
	const exact = faceAtPoint(faces, p);
	if (exact || tolerance <= 0) return exact;
	const limit2 = tolerance * tolerance;
	let best: {
		readonly face: ShapeBuilderFace;
		readonly distance2: number;
	} | null = null;
	for (const face of faces) {
		const distance2 = distancePointToFaceBoundarySquared(p, face);
		if (distance2 > limit2) continue;
		if (
			!best ||
			distance2 < best.distance2 ||
			(distance2 === best.distance2 && face.area < best.face.area)
		) {
			best = { face, distance2 };
		}
	}
	return best?.face ?? null;
}

const faceIdsAtTracePoint = (
	faces: readonly ShapeBuilderFace[],
	p: Pt,
	tolerance: number,
): string[] => {
	const ids: string[] = [];
	const exact = faceAtPoint(faces, p);
	if (exact) ids.push(exact.id);
	if (tolerance <= 0) return ids;
	const limit2 = tolerance * tolerance;
	for (const face of faces) {
		if (face.id === exact?.id) continue;
		if (
			pointInFace(p, face) ||
			distancePointToFaceBoundarySquared(p, face) <= limit2
		) {
			ids.push(face.id);
		}
	}
	return ids;
};

/**
 * Face ids crossed by the segment [a,b], sampled finely (every `step` units) so a
 * FAST drag does not skip regions between sparse pointer-move events — the merge
 * captures every face the stroke actually passes through, not just where events
 * happened to fire. Order-preserving, may repeat ids (callers dedupe via a set).
 */
export function facesAlongSegment(
	faces: readonly ShapeBuilderFace[],
	a: Pt,
	b: Pt,
	step: number,
): string[] {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const dist = Math.hypot(dx, dy);
	const steps = Math.min(
		512,
		Math.max(1, Math.ceil(dist / Math.max(step, 1e-6))),
	);
	const ids: string[] = [];
	for (let i = 1; i <= steps; i++) {
		const t = i / steps;
		const face = faceAtPoint(faces, { x: a.x + dx * t, y: a.y + dy * t });
		if (face) ids.push(face.id);
	}
	return ids;
}

/**
 * Face ids touched by a brush-like Shape Builder stroke. This keeps the normal
 * interior crossing behavior, then widens each sample by `tolerance` so tracing
 * along an existing edge/seam still selects the adjacent regions. Returned ids
 * are first-touch ordered and de-duplicated for cheaper pointer-move updates.
 */
export function facesAlongTraceSegment(
	faces: readonly ShapeBuilderFace[],
	a: Pt,
	b: Pt,
	step: number,
	tolerance: number,
): string[] {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const dist = Math.hypot(dx, dy);
	const steps = Math.min(
		512,
		Math.max(1, Math.ceil(dist / Math.max(step, 1e-6))),
	);
	const ids: string[] = [];
	const seen = new Set<string>();
	for (let i = 1; i <= steps; i++) {
		const t = i / steps;
		for (const id of faceIdsAtTracePoint(
			faces,
			{ x: a.x + dx * t, y: a.y + dy * t },
			tolerance,
		)) {
			if (seen.has(id)) continue;
			seen.add(id);
			ids.push(id);
		}
	}
	return ids;
}
