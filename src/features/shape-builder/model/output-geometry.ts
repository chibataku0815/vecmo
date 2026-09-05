import type { PathGeometry } from "@/entities/scene/model/types";
import {
	type Arrangement,
	facePathGeometry,
	type Pt,
	pathDForGeometry,
	unionFacesGrouped,
	withBridgeFaces,
} from "./arrangement";
import {
	SHAPE_BUILDER_OUTPUT_DETAIL_DEFAULT,
	shapeBuilderToleranceScaleForDetail,
} from "./output-detail";

const distSq = (a: Pt, b: Pt): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

const ringDiag = (ring: readonly Pt[]): number => {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const p of ring) {
		minX = Math.min(minX, p.x);
		minY = Math.min(minY, p.y);
		maxX = Math.max(maxX, p.x);
		maxY = Math.max(maxY, p.y);
	}
	return Number.isFinite(minX) ? Math.hypot(maxX - minX, maxY - minY) : 0;
};

const ringSimplificationTolerance = (
	ring: readonly Pt[],
	outputDetail: number,
	matchEpsilon: number,
): number => {
	const diag = ringDiag(ring);
	const detailScale = shapeBuilderToleranceScaleForDetail(outputDetail);
	const factor = 0.00012 * detailScale;
	return Math.min(2, Math.max(matchEpsilon * 2, diag * factor));
};

const pointLineDistance = (p: Pt, a: Pt, b: Pt): number => {
	const abx = b.x - a.x;
	const aby = b.y - a.y;
	const len = Math.hypot(abx, aby);
	if (len <= 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
	return Math.abs((p.x - a.x) * aby - (p.y - a.y) * abx) / len;
};

const isBetween = (p: Pt, a: Pt, b: Pt): boolean =>
	(p.x - a.x) * (p.x - b.x) + (p.y - a.y) * (p.y - b.y) <= 0;

const simplifyRing = (
	ring: readonly Pt[],
	outputDetail: number,
	matchEpsilon: number,
): readonly Pt[] => {
	if (ring.length <= 3) return ring;
	const tol = ringSimplificationTolerance(ring, outputDetail, matchEpsilon);
	const tol2 = tol * tol;
	const compact: Pt[] = [];
	for (const p of ring) {
		const prev = compact.at(-1);
		if (!prev || distSq(prev, p) > tol2) compact.push(p);
	}
	if (
		compact.length > 1 &&
		distSq(compact[0], compact.at(-1) ?? compact[0]) <= tol2
	)
		compact.pop();
	if (compact.length <= 3) return compact.length >= 3 ? compact : ring;
	const simplified = compact.filter((p, index) => {
		const prev = compact[(index - 1 + compact.length) % compact.length];
		const next = compact[(index + 1) % compact.length];
		return !(
			pointLineDistance(p, prev, next) <= tol && isBetween(p, prev, next)
		);
	});
	return simplified.length >= 3 ? simplified : compact;
};

/**
 * Builds fitted Shape Builder output geometry for an exact face set. Callers
 * decide whether bridge faces belong in that set; this helper owns only the
 * union-grouping and path-detail refit contract shared by commit and preview.
 */
export function buildShapeBuilderFaceGeometries(
	arrangement: Arrangement,
	faceIndices: readonly number[],
	outputDetail: number = SHAPE_BUILDER_OUTPUT_DETAIL_DEFAULT,
): PathGeometry[] {
	const toleranceScale = shapeBuilderToleranceScaleForDetail(outputDetail);
	const refit = {
		corners: arrangement.corners,
		matchEpsilon: arrangement.matchEpsilon,
		toleranceScale,
	};
	return unionFacesGrouped(arrangement, faceIndices).map((group) => {
		const outer = simplifyRing(
			group.outer,
			outputDetail,
			arrangement.matchEpsilon,
		);
		const holes = group.holes
			.map((hole) => simplifyRing(hole, outputDetail, arrangement.matchEpsilon))
			.filter((hole) => hole.length >= 3);
		return facePathGeometry(outer, holes, refit);
	});
}

/**
 * Compacts multiple disconnected Shape Builder contours into one compound path.
 * The visual fill stays equivalent under even-odd resolution, while the Layers
 * panel receives one editable node for one construction action instead of one
 * node per disconnected island.
 */
export function compoundShapeBuilderPathGeometries(
	geometries: readonly PathGeometry[],
): PathGeometry | null {
	const [first, ...rest] = geometries;
	if (!first) return null;
	if (rest.length === 0) return first;
	const subpaths = [
		...(first.subpaths ?? []),
		...rest.flatMap((geometry) => [
			geometry.shape,
			...(geometry.subpaths ?? []),
		]),
	];
	return {
		kind: "path",
		shape: first.shape,
		subpaths,
		fillRule: "evenodd",
	};
}

/**
 * Builds face-precise generated geometry, including bridge faces for raw swept
 * sets. Merge expansion already includes the intended swept-near bridge necks,
 * so callers holding `expandShapeBuilderMergeFaces().outputFaceIndices` should
 * use `buildShapeBuilderFaceGeometries` directly to avoid bridge widening.
 */
export function buildShapeBuilderGeneratedGeometries(
	arrangement: Arrangement,
	faceIndices: readonly number[],
	outputDetail: number = SHAPE_BUILDER_OUTPUT_DETAIL_DEFAULT,
): PathGeometry[] {
	return buildShapeBuilderFaceGeometries(
		arrangement,
		withBridgeFaces(arrangement, faceIndices),
		outputDetail,
	);
}

/** Serializes Shape Builder output geometries for overlay/flash SVG paths. */
export function shapeBuilderPathDForGeometries(
	geometries: readonly PathGeometry[],
): string {
	return geometries.map(pathDForGeometry).join(" ");
}
