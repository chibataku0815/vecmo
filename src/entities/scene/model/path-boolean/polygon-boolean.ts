import type { PathOpPoint } from "./path-conversion";

/**
 * Dependency-free general polygon Boolean engine.
 *
 * The convex fast-path in `boolean.ts` stays byte-identical for the common
 * adjacent/overlapping convex cases; this module is the fallback that the
 * fast-path routes to when an input is concave or the convex area-identity check
 * fails. It splits both rings at their intersections, classifies each resulting
 * directed edge fragment by an inside/outside test against the other ring, then
 * stitches the selected fragments back into closed contours.
 *
 * The engine is intentionally winding-aware enough to handle two single
 * contours with concavity. It reports every closed contour it produces so the
 * caller can distinguish a single editable contour (storable in one `AeShape`)
 * from a hole/multi-contour outcome that the single-contour scene model cannot
 * represent without silent fidelity loss.
 */

export type PolygonBooleanResult = {
	/** Outer (filled) contours; clockwise in the engine's positive convention. */
	readonly outers: readonly (readonly PathOpPoint[])[];
	/** Inner (hole) contours that the single-`AeShape` model cannot store. */
	readonly holes: readonly (readonly PathOpPoint[])[];
	/**
	 * True when the two contours share a collinear-overlapping (coincident) edge.
	 * Coincident-edge resolution is direction- and operation-dependent and is the
	 * classic failure point of dependency-free polygon Boolean cores, so the
	 * engine declines those inputs instead of emitting a possibly-wrong contour;
	 * the caller turns this into a typed disabled reason.
	 */
	readonly coincidentEdges: boolean;
	/**
	 * True when a stitched contour touches itself (a vertex repeats), which marks
	 * a frame-with-hole / figure-eight topology that a single simple contour
	 * cannot represent. The caller declines these as a compound result.
	 */
	readonly selfTouching: boolean;
};

export type PolygonBooleanOperation =
	| "union"
	| "intersect"
	| "subtract"
	| "exclude";

const EPSILON = 1e-9;
const ON_EDGE_EPSILON = 1e-7;

type Edge = {
	readonly start: PathOpPoint;
	readonly end: PathOpPoint;
};

const cross = (a: PathOpPoint, b: PathOpPoint, c: PathOpPoint): number =>
	(b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

const signedArea = (points: readonly PathOpPoint[]): number => {
	let sum = 0;
	for (let index = 0; index < points.length; index += 1) {
		const current = points[index];
		const next = points[(index + 1) % points.length];
		sum += current.x * next.y - next.x * current.y;
	}
	return sum / 2;
};

const distance = (a: PathOpPoint, b: PathOpPoint): number =>
	Math.hypot(a.x - b.x, a.y - b.y);

const lerp = (a: PathOpPoint, b: PathOpPoint, t: number): PathOpPoint => ({
	x: a.x + (b.x - a.x) * t,
	y: a.y + (b.y - a.y) * t,
});

/**
 * Returns the ring oriented clockwise (positive signed area in this engine's
 * y-down convention) so all filled inputs share one winding direction.
 */
const toClockwise = (points: readonly PathOpPoint[]): readonly PathOpPoint[] =>
	signedArea(points) < 0 ? [...points].reverse() : points;

/** Even-odd / winding point-in-polygon usable for concave rings. */
const pointInRing = (
	point: PathOpPoint,
	ring: readonly PathOpPoint[],
): boolean => {
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
		const a = ring[i];
		const b = ring[j];
		const intersects =
			a.y > point.y !== b.y > point.y &&
			point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
		if (intersects) inside = !inside;
	}
	return inside;
};

/** Distance from a point to a segment; used to detect points lying on an edge. */
const pointOnSegment = (
	point: PathOpPoint,
	start: PathOpPoint,
	end: PathOpPoint,
): boolean => {
	const length = distance(start, end);
	if (length <= EPSILON) return distance(point, start) <= ON_EDGE_EPSILON;
	const area = Math.abs(cross(start, end, point));
	const perpendicular = area / length;
	if (perpendicular > ON_EDGE_EPSILON) return false;
	const dot =
		((point.x - start.x) * (end.x - start.x) +
			(point.y - start.y) * (end.y - start.y)) /
		(length * length);
	return dot >= -EPSILON && dot <= 1 + EPSILON;
};

const pointOnRing = (
	point: PathOpPoint,
	ring: readonly PathOpPoint[],
): boolean => {
	for (let index = 0; index < ring.length; index += 1) {
		const start = ring[index];
		const end = ring[(index + 1) % ring.length];
		if (pointOnSegment(point, start, end)) return true;
	}
	return false;
};

type Containment = "inside" | "outside" | "boundary";

const classifyMidpoint = (
	midpoint: PathOpPoint,
	ring: readonly PathOpPoint[],
): Containment => {
	if (pointOnRing(midpoint, ring)) return "boundary";
	return pointInRing(midpoint, ring) ? "inside" : "outside";
};

/**
 * Splits `ring` edges at every parameter where another ring's edge crosses, plus
 * at every point of `splitPoints` that lies on an edge. The result is a denser
 * ring whose every edge is fully inside, fully outside, or on the other ring.
 */
const splitRing = (
	ring: readonly PathOpPoint[],
	splitPoints: readonly PathOpPoint[],
): readonly PathOpPoint[] => {
	const output: PathOpPoint[] = [];
	for (let index = 0; index < ring.length; index += 1) {
		const start = ring[index];
		const end = ring[(index + 1) % ring.length];
		output.push(start);
		const onEdge = splitPoints
			.filter(
				(point) =>
					pointOnSegment(point, start, end) &&
					distance(point, start) > ON_EDGE_EPSILON &&
					distance(point, end) > ON_EDGE_EPSILON,
			)
			.map((point) => ({
				point,
				t: distance(start, point) / Math.max(EPSILON, distance(start, end)),
			}))
			.sort((a, b) => a.t - b.t);
		for (const entry of onEdge) output.push(entry.point);
	}
	return output;
};

/** Returns the intersection point of two segments, or null when none/parallel. */
const segmentIntersection = (a: Edge, b: Edge): PathOpPoint | null => {
	const r = { x: a.end.x - a.start.x, y: a.end.y - a.start.y };
	const s = { x: b.end.x - b.start.x, y: b.end.y - b.start.y };
	const denominator = r.x * s.y - r.y * s.x;
	if (Math.abs(denominator) <= EPSILON) return null;
	const qp = { x: b.start.x - a.start.x, y: b.start.y - a.start.y };
	const t = (qp.x * s.y - qp.y * s.x) / denominator;
	const u = (qp.x * r.y - qp.y * r.x) / denominator;
	if (t < -EPSILON || t > 1 + EPSILON || u < -EPSILON || u > 1 + EPSILON) {
		return null;
	}
	return lerp(a.start, a.end, Math.max(0, Math.min(1, t)));
};

const allIntersections = (
	subject: readonly PathOpPoint[],
	clip: readonly PathOpPoint[],
): readonly PathOpPoint[] => {
	const points: PathOpPoint[] = [];
	for (let i = 0; i < subject.length; i += 1) {
		const subjectEdge: Edge = {
			start: subject[i],
			end: subject[(i + 1) % subject.length],
		};
		for (let j = 0; j < clip.length; j += 1) {
			const clipEdge: Edge = {
				start: clip[j],
				end: clip[(j + 1) % clip.length],
			};
			const intersection = segmentIntersection(subjectEdge, clipEdge);
			if (intersection) points.push(intersection);
		}
	}
	return points;
};

type DirectedFragment = {
	readonly start: PathOpPoint;
	readonly end: PathOpPoint;
};

const pointKey = (point: PathOpPoint): string =>
	`${point.x.toFixed(7)}:${point.y.toFixed(7)}`;

const samePoint = (a: PathOpPoint, b: PathOpPoint): boolean =>
	distance(a, b) <= ON_EDGE_EPSILON;

/**
 * Maps each containment classification to either a keep+direction rule or
 * `undefined` to drop. `reverse: true` flips the fragment so a kept fragment can
 * form an inner (hole) boundary, which subtract and exclude both need.
 */
type KeepRule = Partial<Record<Containment, { readonly reverse: boolean }>>;

/**
 * Selects directed edge fragments of `ring` to keep for the operation, based on
 * how each fragment's midpoint sits relative to `other`.
 */
const selectFragments = (
	ring: readonly PathOpPoint[],
	other: readonly PathOpPoint[],
	rule: KeepRule,
): readonly DirectedFragment[] => {
	const fragments: DirectedFragment[] = [];
	for (let index = 0; index < ring.length; index += 1) {
		const start = ring[index];
		const end = ring[(index + 1) % ring.length];
		if (samePoint(start, end)) continue;
		const midpoint = lerp(start, end, 0.5);
		const containment = classifyMidpoint(midpoint, other);
		const directive = rule[containment];
		if (!directive) continue;
		fragments.push(
			directive.reverse ? { start: end, end: start } : { start, end },
		);
	}
	return fragments;
};

/** Stitches directed fragments head-to-tail into closed rings. */
const stitchFragments = (
	fragments: readonly DirectedFragment[],
): readonly (readonly PathOpPoint[])[] => {
	const remaining = new Map<string, DirectedFragment[]>();
	for (const fragment of fragments) {
		const key = pointKey(fragment.start);
		const list = remaining.get(key);
		if (list) list.push(fragment);
		else remaining.set(key, [fragment]);
	}

	const take = (from: PathOpPoint): DirectedFragment | null => {
		const key = pointKey(from);
		const list = remaining.get(key);
		if (!list || list.length === 0) return null;
		return list.shift() ?? null;
	};

	const contours: (readonly PathOpPoint[])[] = [];
	let total = fragments.length;
	let guard = 0;
	const guardLimit = total * total + total + 1;

	for (const seed of fragments) {
		if (guard > guardLimit) break;
		const seedKey = pointKey(seed.start);
		const seedList = remaining.get(seedKey);
		const seedIndex = seedList?.indexOf(seed) ?? -1;
		if (!seedList || seedIndex < 0) continue;
		// Consume the seed.
		seedList.splice(seedIndex, 1);

		const contour: PathOpPoint[] = [seed.start, seed.end];
		let current = seed.end;
		while (guard <= guardLimit) {
			guard += 1;
			if (samePoint(current, seed.start)) break;
			const next = take(current);
			if (!next) break;
			current = next.end;
			contour.push(next.end);
		}
		total -= contour.length;
		if (contour.length >= 3) {
			// Drop the duplicated closing vertex if present.
			const first = contour[0];
			const last = contour.at(-1);
			if (last && samePoint(first, last)) contour.pop();
			if (contour.length >= 3) contours.push(contour);
		}
	}

	return contours;
};

const cleanContour = (
	points: readonly PathOpPoint[],
): readonly PathOpPoint[] => {
	const unique: PathOpPoint[] = [];
	for (const point of points) {
		const previous = unique.at(-1);
		if (!previous || !samePoint(previous, point)) unique.push(point);
	}
	const first = unique[0];
	const last = unique.at(-1);
	if (first && last && unique.length > 1 && samePoint(first, last))
		unique.pop();

	// Remove collinear vertices so editable output stays minimal.
	let changed = true;
	while (changed && unique.length >= 3) {
		changed = false;
		for (let index = 0; index < unique.length; index += 1) {
			const previous = unique[(index - 1 + unique.length) % unique.length];
			const current = unique[index];
			const next = unique[(index + 1) % unique.length];
			if (Math.abs(cross(previous, current, next)) <= ON_EDGE_EPSILON) {
				unique.splice(index, 1);
				changed = true;
				break;
			}
		}
	}
	return unique;
};

type FragmentPlan = {
	readonly subject: KeepRule;
	readonly clip: KeepRule;
};

// Coincident edges are declined before fragment selection, so each kept
// fragment's midpoint is strictly inside or outside the other ring; the
// `boundary` classification is never kept. Inside fragments are reversed when
// they must form an inner (hole) boundary.
const planFor = (operation: PolygonBooleanOperation): FragmentPlan => {
	switch (operation) {
		case "union":
			return {
				subject: { outside: { reverse: false } },
				clip: { outside: { reverse: false } },
			};
		case "intersect":
			return {
				subject: { inside: { reverse: false } },
				clip: { inside: { reverse: false } },
			};
		case "subtract":
			return {
				subject: { outside: { reverse: false } },
				clip: { inside: { reverse: true } },
			};
		case "exclude":
			// XOR = (A∖B) ∪ (B∖A): outer rims stay forward, the shared overlap is
			// bounded by reversed inside fragments so it assembles as a hole. The
			// caller declines any hole as a compound result.
			return {
				subject: {
					outside: { reverse: false },
					inside: { reverse: true },
				},
				clip: {
					outside: { reverse: false },
					inside: { reverse: true },
				},
			};
	}
};

/**
 * Detects whether any split fragment of `subject` is collinear-overlapping with
 * a fragment of `clip`. After splitting at intersections and shared vertices, a
 * coincident edge shows up as two fragments whose midpoints both lie on the
 * other ring's boundary and that span the same direction.
 */
const hasCoincidentEdge = (
	subjectSplit: readonly PathOpPoint[],
	clipSplit: readonly PathOpPoint[],
): boolean => {
	for (let i = 0; i < subjectSplit.length; i += 1) {
		const start = subjectSplit[i];
		const end = subjectSplit[(i + 1) % subjectSplit.length];
		if (samePoint(start, end)) continue;
		const midpoint = lerp(start, end, 0.5);
		if (!pointOnRing(midpoint, clipSplit)) continue;
		// Midpoint sits on the clip boundary: confirm a full collinear overlap by
		// also checking a quarter and three-quarter sample stay on the boundary.
		const quarter = lerp(start, end, 0.25);
		const threeQuarter = lerp(start, end, 0.75);
		if (
			pointOnRing(quarter, clipSplit) &&
			pointOnRing(threeQuarter, clipSplit)
		) {
			return true;
		}
	}
	return false;
};

const DECLINED: PolygonBooleanResult = {
	outers: [],
	holes: [],
	coincidentEdges: true,
	selfTouching: false,
};

/** A simple contour visits each vertex once; a repeat marks a touching topology. */
const isSelfTouching = (points: readonly PathOpPoint[]): boolean => {
	for (let i = 0; i < points.length; i += 1) {
		for (let j = i + 1; j < points.length; j += 1) {
			if (samePoint(points[i], points[j])) return true;
		}
	}
	return false;
};

/**
 * Computes a Boolean operation between two single closed contours that may be
 * concave. Returns the assembled outer and hole contours so the caller decides
 * whether the outcome fits the single-contour scene model. Inputs that share a
 * coincident edge are declined (`coincidentEdges: true`) rather than risk an
 * incorrect merged contour from degenerate edge classification.
 */
export function polygonBoolean(
	operation: PolygonBooleanOperation,
	subjectInput: readonly PathOpPoint[],
	clipInput: readonly PathOpPoint[],
): PolygonBooleanResult {
	const subject = toClockwise(subjectInput);
	const clip = toClockwise(clipInput);
	const intersections = allIntersections(subject, clip);

	const subjectSplit = splitRing(subject, [...intersections, ...clip]);
	const clipSplit = splitRing(clip, [...intersections, ...subject]);

	if (hasCoincidentEdge(subjectSplit, clipSplit)) return DECLINED;

	const plan = planFor(operation);
	const fragments = [
		...selectFragments(subjectSplit, clip, plan.subject),
		...selectFragments(clipSplit, subject, plan.clip),
	];

	const stitched = stitchFragments(fragments)
		.map(cleanContour)
		.filter(
			(contour) =>
				contour.length >= 3 && Math.abs(signedArea(contour)) > ON_EDGE_EPSILON,
		);

	const outers: (readonly PathOpPoint[])[] = [];
	const holes: (readonly PathOpPoint[])[] = [];
	let selfTouching = false;
	for (const contour of stitched) {
		if (isSelfTouching(contour)) selfTouching = true;
		// Positive area = clockwise = filled in this engine's convention.
		if (signedArea(contour) >= 0) outers.push(contour);
		else holes.push([...contour].reverse());
	}

	return { outers, holes, coincidentEdges: false, selfTouching };
}
