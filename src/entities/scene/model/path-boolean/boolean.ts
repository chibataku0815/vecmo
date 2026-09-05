import type { PathGeometry } from "@/entities/scene/model/types";
import type { AeShape } from "@/shared/glammer/ae-shape";
import { fitClosedContour, sourceIntersectionPoints } from "./curve-fit";
import {
	compoundPathGeometryFromContours,
	type PathOpPoint,
	type PathOpPolygon,
	pathGeometryFromPoints,
	sourceToOperationPolygon,
} from "./path-conversion";
import {
	type PolygonBooleanOperation,
	polygonBoolean,
} from "./polygon-boolean";
import type {
	PathOperation,
	PathOpIssue,
	PathOpResult,
	PathOpSource,
} from "./types";

const AREA_EPSILON = 1e-6;
const POINT_EPSILON = 1e-7;

type PolygonResult =
	| {
			readonly ok: true;
			readonly points: readonly PathOpPoint[];
			/**
			 * Inner contours (holes) cut from `points`. Present when the operation
			 * resolves to a single outer with holes (e.g. a donut); absent for plain
			 * single-contour output. The caller turns these into a compound
			 * `PathGeometry` with the even-odd fill rule.
			 */
			readonly holes?: readonly (readonly PathOpPoint[])[];
	  }
	| {
			readonly ok: false;
			readonly issues: readonly PathOpIssue[];
	  };

const issue = (
	code: PathOpIssue["code"],
	message: string,
	severity: PathOpIssue["severity"],
	operation: PathOperation,
	source?: PathOpPolygon,
): PathOpIssue => ({
	code,
	message,
	severity,
	operation,
	sourceId: source?.sourceId,
	geometryKind: source?.geometryKind,
});

const pointKey = (point: PathOpPoint): string =>
	`${point.x.toFixed(9)}:${point.y.toFixed(9)}`;

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

const polygonArea = (points: readonly PathOpPoint[]): number =>
	Math.abs(signedArea(points));

const samePoint = (a: PathOpPoint, b: PathOpPoint): boolean =>
	Math.hypot(a.x - b.x, a.y - b.y) <= POINT_EPSILON;

const stripDuplicateAndCollinear = (
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

	let changed = true;
	while (changed && unique.length >= 3) {
		changed = false;
		for (let index = 0; index < unique.length; index += 1) {
			const previous = unique[(index - 1 + unique.length) % unique.length];
			const current = unique[index];
			const next = unique[(index + 1) % unique.length];
			if (Math.abs(cross(previous, current, next)) <= POINT_EPSILON) {
				unique.splice(index, 1);
				changed = true;
				break;
			}
		}
	}
	return unique;
};

const ensurePositiveWinding = (
	points: readonly PathOpPoint[],
): readonly PathOpPoint[] => {
	const clean = stripDuplicateAndCollinear(points);
	return signedArea(clean) < 0 ? [...clean].reverse() : clean;
};

const validPolygon = (
	points: readonly PathOpPoint[],
): readonly PathOpPoint[] | null => {
	const clean = ensurePositiveWinding(points);
	if (clean.length < 3 || polygonArea(clean) <= AREA_EPSILON) return null;
	return clean;
};

const approximatelyEqualArea = (a: number, b: number): boolean =>
	Math.abs(a - b) <= Math.max(1, a, b) * 1e-5;

const isConvex = (points: readonly PathOpPoint[]): boolean => {
	if (points.length < 3) return false;
	let sign = 0;
	for (let index = 0; index < points.length; index += 1) {
		const value = cross(
			points[index],
			points[(index + 1) % points.length],
			points[(index + 2) % points.length],
		);
		if (Math.abs(value) <= POINT_EPSILON) continue;
		const currentSign = value > 0 ? 1 : -1;
		if (sign === 0) {
			sign = currentSign;
			continue;
		}
		if (sign !== currentSign) return false;
	}
	return sign !== 0;
};

const insideHalfPlane = (
	point: PathOpPoint,
	edgeStart: PathOpPoint,
	edgeEnd: PathOpPoint,
): boolean => cross(edgeStart, edgeEnd, point) >= -POINT_EPSILON;

const lineIntersection = (
	a: PathOpPoint,
	b: PathOpPoint,
	c: PathOpPoint,
	d: PathOpPoint,
): PathOpPoint => {
	const ab = { x: b.x - a.x, y: b.y - a.y };
	const cd = { x: d.x - c.x, y: d.y - c.y };
	const denominator = ab.x * cd.y - ab.y * cd.x;
	if (Math.abs(denominator) <= POINT_EPSILON) return b;
	const ac = { x: c.x - a.x, y: c.y - a.y };
	const t = (ac.x * cd.y - ac.y * cd.x) / denominator;
	return { x: a.x + ab.x * t, y: a.y + ab.y * t };
};

const clipHalfPlane = (
	polygon: readonly PathOpPoint[],
	edgeStart: PathOpPoint,
	edgeEnd: PathOpPoint,
	keepInside: boolean,
): readonly PathOpPoint[] | null => {
	const output: PathOpPoint[] = [];
	for (let index = 0; index < polygon.length; index += 1) {
		const current = polygon[index];
		const previous = polygon[(index - 1 + polygon.length) % polygon.length];
		const currentInside =
			insideHalfPlane(current, edgeStart, edgeEnd) === keepInside;
		const previousInside =
			insideHalfPlane(previous, edgeStart, edgeEnd) === keepInside;

		if (currentInside) {
			if (!previousInside) {
				output.push(lineIntersection(previous, current, edgeStart, edgeEnd));
			}
			output.push(current);
			continue;
		}
		if (previousInside) {
			output.push(lineIntersection(previous, current, edgeStart, edgeEnd));
		}
	}
	return validPolygon(output);
};

const intersectPair = (
	subject: readonly PathOpPoint[],
	clip: readonly PathOpPoint[],
): readonly PathOpPoint[] | null => {
	let output: readonly PathOpPoint[] | null = validPolygon(subject);
	const clipPolygon = validPolygon(clip);
	if (!output || !clipPolygon) return null;
	for (let index = 0; index < clipPolygon.length; index += 1) {
		output = clipHalfPlane(
			output,
			clipPolygon[index],
			clipPolygon[(index + 1) % clipPolygon.length],
			true,
		);
		if (!output) return null;
	}
	return output;
};

const differencePieces = (
	subject: readonly PathOpPoint[],
	clip: readonly PathOpPoint[],
): readonly (readonly PathOpPoint[])[] => {
	const clipPolygon = validPolygon(clip);
	const subjectPolygon = validPolygon(subject);
	if (!clipPolygon || !subjectPolygon) return [];

	let remainders: readonly (readonly PathOpPoint[])[] = [subjectPolygon];
	const pieces: (readonly PathOpPoint[])[] = [];
	for (let index = 0; index < clipPolygon.length; index += 1) {
		const edgeStart = clipPolygon[index];
		const edgeEnd = clipPolygon[(index + 1) % clipPolygon.length];
		const nextRemainders: (readonly PathOpPoint[])[] = [];
		for (const polygon of remainders) {
			const outside = clipHalfPlane(polygon, edgeStart, edgeEnd, false);
			if (outside) pieces.push(outside);
			const inside = clipHalfPlane(polygon, edgeStart, edgeEnd, true);
			if (inside) nextRemainders.push(inside);
		}
		remainders = nextRemainders;
		if (remainders.length === 0) break;
	}
	return pieces;
};

const convexHull = (
	points: readonly PathOpPoint[],
): readonly PathOpPoint[] | null => {
	const unique = [
		...new Map(points.map((point) => [pointKey(point), point])).values(),
	].sort((a, b) => a.x - b.x || a.y - b.y);
	if (unique.length < 3) return null;

	const lower: PathOpPoint[] = [];
	for (const point of unique) {
		while (
			lower.length >= 2 &&
			cross(lower[lower.length - 2], lower[lower.length - 1], point) <=
				POINT_EPSILON
		) {
			lower.pop();
		}
		lower.push(point);
	}

	const upper: PathOpPoint[] = [];
	for (let index = unique.length - 1; index >= 0; index -= 1) {
		const point = unique[index];
		while (
			upper.length >= 2 &&
			cross(upper[upper.length - 2], upper[upper.length - 1], point) <=
				POINT_EPSILON
		) {
			upper.pop();
		}
		upper.push(point);
	}

	return validPolygon([...lower.slice(0, -1), ...upper.slice(0, -1)]);
};

const unionPair = (
	a: readonly PathOpPoint[],
	b: readonly PathOpPoint[],
	operation: PathOperation,
): PolygonResult => {
	const hull = convexHull([...a, ...b]);
	if (!hull) {
		return {
			ok: false,
			issues: [
				issue(
					"path-op.empty-result",
					"Union collapsed below a valid editable path.",
					"error",
					operation,
				),
			],
		};
	}
	const intersection = intersectPair(a, b);
	const expectedArea =
		polygonArea(a) +
		polygonArea(b) -
		(intersection ? polygonArea(intersection) : 0);
	if (!approximatelyEqualArea(polygonArea(hull), expectedArea)) {
		return {
			ok: false,
			issues: [
				issue(
					"path-op.compound-result",
					"Union would require a concave or multi-contour compound path; the current scene model stores one editable contour.",
					"error",
					operation,
				),
			],
		};
	}
	return { ok: true, points: hull };
};

const unionAll = (
	polygons: readonly PathOpPolygon[],
	operation: PathOperation,
): PolygonResult => {
	let current = polygons[0]?.points;
	if (!current) {
		return {
			ok: false,
			issues: [
				issue(
					"path-op.too-few-sources",
					"Path operation requires at least two sources.",
					"error",
					operation,
				),
			],
		};
	}
	for (const polygon of polygons.slice(1)) {
		const result = unionPair(current, polygon.points, operation);
		if (!result.ok) return result;
		current = result.points;
	}
	return { ok: true, points: current };
};

const intersectAll = (
	polygons: readonly PathOpPolygon[],
	operation: PathOperation,
): PolygonResult => {
	let current = polygons[0]?.points;
	if (!current) {
		return {
			ok: false,
			issues: [
				issue(
					"path-op.too-few-sources",
					"Path operation requires at least two sources.",
					"error",
					operation,
				),
			],
		};
	}
	for (const polygon of polygons.slice(1)) {
		const next = intersectPair(current, polygon.points);
		if (!next) {
			return {
				ok: false,
				issues: [
					issue(
						"path-op.empty-result",
						"Intersection produced no filled editable path.",
						"error",
						operation,
					),
				],
			};
		}
		current = next;
	}
	return { ok: true, points: current };
};

const subtractAll = (
	polygons: readonly PathOpPolygon[],
	operation: PathOperation,
): PolygonResult => {
	let pieces: readonly (readonly PathOpPoint[])[] = [polygons[0]?.points ?? []];
	for (const polygon of polygons.slice(1)) {
		pieces = pieces.flatMap((piece) => differencePieces(piece, polygon.points));
		if (pieces.length === 0) {
			return {
				ok: false,
				issues: [
					issue(
						"path-op.empty-result",
						"Subtraction removed the entire filled path.",
						"error",
						operation,
					),
				],
			};
		}
	}
	if (pieces.length !== 1) {
		return {
			ok: false,
			issues: [
				issue(
					"path-op.compound-result",
					"Subtraction would require multiple contours or a hole; the current path geometry stores one editable contour.",
					"error",
					operation,
				),
			],
		};
	}
	return { ok: true, points: pieces[0] };
};

const excludePair = (
	a: PathOpPolygon,
	b: PathOpPolygon,
	operation: PathOperation,
): PolygonResult => {
	const pieces = [
		...differencePieces(a.points, b.points),
		...differencePieces(b.points, a.points),
	];
	if (pieces.length === 0) {
		return {
			ok: false,
			issues: [
				issue(
					"path-op.empty-result",
					"Exclude produced no filled editable path.",
					"error",
					operation,
				),
			],
		};
	}
	let current = pieces[0];
	for (const piece of pieces.slice(1)) {
		const union = unionPair(current, piece, operation);
		if (!union.ok) {
			return {
				ok: false,
				issues: [
					issue(
						"path-op.compound-result",
						"Exclude would require multiple contours or concave output; the current path geometry stores one editable contour.",
						"error",
						operation,
					),
				],
			};
		}
		current = union.points;
	}
	return { ok: true, points: current };
};

const excludeAll = (
	polygons: readonly PathOpPolygon[],
	operation: PathOperation,
): PolygonResult => {
	let current: PathOpPolygon | undefined = polygons[0];
	if (!current) {
		return {
			ok: false,
			issues: [
				issue(
					"path-op.too-few-sources",
					"Path operation requires at least two sources.",
					"error",
					operation,
				),
			],
		};
	}
	for (const polygon of polygons.slice(1)) {
		const result = excludePair(current, polygon, operation);
		if (!result.ok) return result;
		current = {
			points: result.points,
			geometryKind: "path",
			sourceId: current.sourceId,
		};
	}
	return { ok: true, points: current.points };
};

const operationResult = (
	operation: PathOperation,
	polygons: readonly PathOpPolygon[],
): PolygonResult => {
	switch (operation) {
		case "union":
			return unionAll(polygons, operation);
		case "subtract":
			return subtractAll(polygons, operation);
		case "intersect":
			return intersectAll(polygons, operation);
		case "exclude":
			return excludeAll(polygons, operation);
	}
};

const compoundIssue = (operation: PathOperation): PathOpIssue =>
	issue(
		"path-op.compound-result",
		"This path operation needs multiple contours or a hole; the current path geometry stores one editable contour.",
		"error",
		operation,
	);

const coincidentIssue = (operation: PathOperation): PathOpIssue =>
	issue(
		"path-op.coincident-edges",
		"Sources share an exactly overlapping edge; nudge one source slightly so the path operation can resolve a single contour.",
		"error",
		operation,
	);

/**
 * Runs the general concave-capable engine pairwise over all sources, folding the
 * accumulated contour with each subsequent source. A single outer contour — with
 * or without holes — is returned: a clean outline becomes a plain contour, and a
 * single outer plus holes becomes an editable compound path (donut / letter
 * counter) via the even-odd fill rule. True multi-outer output, self-touching
 * figure-eight topology, and coincident edges still map to typed errors because
 * the scene model cannot store them as one node. This is the fallback for inputs
 * the convex fast-path rejects.
 */
const generalOperationResult = (
	operation: PathOperation,
	polygons: readonly PathOpPolygon[],
): PolygonResult => {
	let current = polygons[0]?.points;
	if (!current) {
		return {
			ok: false,
			issues: [
				issue(
					"path-op.too-few-sources",
					"Path operation requires at least two sources.",
					"error",
					operation,
				),
			],
		};
	}

	const engineOperation = operation satisfies PolygonBooleanOperation;
	let holes: readonly (readonly PathOpPoint[])[] = [];
	for (const polygon of polygons.slice(1)) {
		const result = polygonBoolean(engineOperation, current, polygon.points);
		if (result.coincidentEdges) {
			return { ok: false, issues: [coincidentIssue(operation)] };
		}
		if (result.outers.length === 0) {
			return {
				ok: false,
				issues: [
					issue(
						"path-op.empty-result",
						"Path operation produced no filled editable path.",
						"error",
						operation,
					),
				],
			};
		}
		// A single outer with holes is a storable compound path; only genuine
		// multi-outer output or a self-touching figure-eight stays a compound error.
		if (result.selfTouching || result.outers.length > 1) {
			return { ok: false, issues: [compoundIssue(operation)] };
		}
		current = result.outers[0];
		// Minimal scope: carry only the latest fold step's holes. A multi-source
		// fold that cuts a hole in an intermediate step and then keeps folding
		// operates on the outer contour alone, so that early hole is dropped here;
		// the common two-source donut (a single fold step) is preserved exactly.
		holes = result.holes;
	}
	return { ok: true, points: current, holes };
};

const REFIT_CURVE_MESSAGE =
	"Curved segments were resampled and re-fitted to editable Bézier curves within a sub-pixel tolerance.";

/**
 * Re-fits a flattened Boolean outline (and any holes) into corner-preserving
 * cubic Béziers. Falls back to the straight-line geometry whenever a contour is
 * too small to fit or the fit produced a non-finite control point, so output is
 * never worse than the honest polygon. Reports whether the outer re-fit landed so
 * the caller can soften the now-sub-pixel "curve approximated" warning.
 */
const buildResultGeometry = (
	outer: readonly PathOpPoint[],
	holes: readonly (readonly PathOpPoint[])[],
	cornerPoints: readonly PathOpPoint[],
): { readonly geometry: PathGeometry; readonly refitted: boolean } => {
	const outerShape = fitClosedContour(outer, cornerPoints);
	if (!outerShape) {
		return {
			geometry:
				holes.length > 0
					? compoundPathGeometryFromContours(outer, holes)
					: pathGeometryFromPoints(outer),
			refitted: false,
		};
	}
	if (holes.length === 0) {
		return { geometry: { kind: "path", shape: outerShape }, refitted: true };
	}
	const subpaths = holes
		.map(
			(hole): AeShape =>
				fitClosedContour(hole, cornerPoints) ??
				pathGeometryFromPoints(hole).shape,
		)
		.filter((shape) => shape.vertices.length >= 3);
	if (subpaths.length === 0) {
		return { geometry: { kind: "path", shape: outerShape }, refitted: true };
	}
	return {
		geometry: {
			kind: "path",
			shape: outerShape,
			subpaths,
			fillRule: "evenodd",
		},
		refitted: true,
	};
};

/**
 * Softens each per-source `curve-approximated` warning to an info note once the
 * output has been re-fitted to curves: the approximation is now bounded to a
 * sub-pixel tolerance rather than a lossy polygon. The issue is kept (not
 * dropped) because the operation still resampled, so the report stays honest.
 */
const softenCurveIssues = (
	issues: readonly PathOpIssue[],
	refitted: boolean,
): readonly PathOpIssue[] =>
	refitted
		? issues.map(
				(item): PathOpIssue =>
					item.code === "path-op.curve-approximated"
						? { ...item, severity: "info", message: REFIT_CURVE_MESSAGE }
						: item,
			)
		: issues;

/**
 * Computes a dependency-free Boolean path operation. Convex polygonal contours
 * use an exact fast-path so their output stays byte-identical; concave contours,
 * and convex inputs whose result needs a hole, fall back to a general engine that
 * handles arbitrary single contours. A single outer with holes is returned as a
 * compound `PathGeometry` (even-odd fill rule). Curves are first flattened with
 * warning issues, while true multi-contour and coincident-edge outcomes fail with
 * typed errors because the scene model stores one editable node.
 */
export function applyPathOperation(
	operation: PathOperation,
	sources: readonly PathOpSource[],
): PathOpResult {
	const issues: PathOpIssue[] = [];
	if (sources.length < 2) {
		return {
			ok: false,
			operation,
			issues: [
				issue(
					"path-op.too-few-sources",
					"Path operation requires at least two sources.",
					"error",
					operation,
				),
			],
		};
	}

	const polygons: PathOpPolygon[] = [];
	const sourceCorners: PathOpPoint[] = [];
	let allConvex = true;
	for (const source of sources) {
		const result = sourceToOperationPolygon(source);
		issues.push(...result.issues.map((item) => ({ ...item, operation })));
		if (!result.ok) continue;
		const points = validPolygon(result.polygon.points);
		if (!points) {
			issues.push(
				issue(
					"path-op.invalid-geometry",
					"Path operation source collapsed below a valid editable contour.",
					"error",
					operation,
					result.polygon,
				),
			);
			continue;
		}
		sourceCorners.push(...result.cornerPoints);
		if (!isConvex(points)) allConvex = false;
		polygons.push({ ...result.polygon, points });
	}

	if (issues.some((item) => item.severity === "error")) {
		return { ok: false, operation, issues };
	}

	let result = allConvex
		? operationResult(operation, polygons)
		: generalOperationResult(operation, polygons);
	// The convex fast-path cannot represent a hole: its half-plane difference emits
	// a ring of frame pieces, not an outer + cutout, and declines as a compound
	// result. Retry with the general engine, which assembles a single outer plus
	// holes into an editable compound path (e.g. one rect minus a fully contained
	// rect = a donut). Genuine multi-outer output still errors from the retry.
	if (
		!result.ok &&
		allConvex &&
		result.issues.some((item) => item.code === "path-op.compound-result")
	) {
		result = generalOperationResult(operation, polygons);
	}
	if (!result.ok) {
		return { ok: false, operation, issues: [...issues, ...result.issues] };
	}

	const cornerPoints = [
		...sourceCorners,
		...sourceIntersectionPoints(polygons.map((polygon) => polygon.points)),
	];
	const { geometry, refitted } = buildResultGeometry(
		result.points,
		result.holes ?? [],
		cornerPoints,
	);
	return {
		ok: true,
		operation,
		geometry,
		issues: softenCurveIssues(issues, refitted),
	};
}
