import {
	getGeometryBounds,
	type Matrix2D,
	matrixFromTransform,
} from "./rendering";
import { getSceneSpatialIndex, sceneHitTestCandidates } from "./spatial";
import type {
	Bounds,
	NodeGeometry,
	SceneDocument,
	SceneLayer,
	Vec2,
	VectorNode,
} from "./types";

export type HitTestOptions = {
	readonly tolerance?: number;
	readonly includeLocked?: boolean;
};

export type HitTestResult = {
	readonly nodeId: string;
	readonly node: VectorNode;
	readonly layer: SceneLayer;
	readonly point: Vec2;
	readonly localPoint: Vec2;
};

const DEFAULT_TOLERANCE = 4;

const inflateBounds = (bounds: Bounds, amount: number): Bounds => ({
	x: bounds.x - amount,
	y: bounds.y - amount,
	width: bounds.width + amount * 2,
	height: bounds.height + amount * 2,
});

const pointInBounds = (point: Vec2, bounds: Bounds): boolean =>
	point.x >= bounds.x &&
	point.x <= bounds.x + bounds.width &&
	point.y >= bounds.y &&
	point.y <= bounds.y + bounds.height;

const invertMatrix = (matrix: Matrix2D): Matrix2D | null => {
	const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
	if (Math.abs(determinant) < 1e-10) return null;
	return {
		a: matrix.d / determinant,
		b: -matrix.b / determinant,
		c: -matrix.c / determinant,
		d: matrix.a / determinant,
		e: (matrix.c * matrix.f - matrix.d * matrix.e) / determinant,
		f: (matrix.b * matrix.e - matrix.a * matrix.f) / determinant,
	};
};

const transformPoint = (point: Vec2, matrix: Matrix2D): Vec2 => ({
	x: matrix.a * point.x + matrix.c * point.y + matrix.e,
	y: matrix.b * point.x + matrix.d * point.y + matrix.f,
});

const distanceToSegment = (point: Vec2, start: Vec2, end: Vec2): number => {
	const dx = end.x - start.x;
	const dy = end.y - start.y;
	const lengthSquared = dx * dx + dy * dy;
	if (lengthSquared === 0)
		return Math.hypot(point.x - start.x, point.y - start.y);
	const t = Math.max(
		0,
		Math.min(
			1,
			((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
		),
	);
	const projected = { x: start.x + t * dx, y: start.y + t * dy };
	return Math.hypot(point.x - projected.x, point.y - projected.y);
};

const starPoints = (
	geometry: Extract<NodeGeometry, { kind: "star" }>,
): readonly Vec2[] => {
	const points: Vec2[] = [];
	const total = geometry.points * 2;
	for (let index = 0; index < total; index += 1) {
		const radius =
			index % 2 === 0 ? geometry.outerRadius : geometry.innerRadius;
		const angle = -Math.PI / 2 + (index / total) * Math.PI * 2;
		points.push({
			x: geometry.center.x + Math.cos(angle) * radius,
			y: geometry.center.y + Math.sin(angle) * radius,
		});
	}
	return points;
};

const pointOnPolygonEdge = (
	point: Vec2,
	points: readonly Vec2[],
	tolerance: number,
): boolean =>
	points.some((start, index) => {
		const end = points[(index + 1) % points.length];
		return end ? distanceToSegment(point, start, end) <= tolerance : false;
	});

const pointInPolygon = (
	point: Vec2,
	points: readonly Vec2[],
	tolerance: number,
): boolean => {
	if (points.length < 3) return false;
	if (pointOnPolygonEdge(point, points, tolerance)) return true;
	let inside = false;
	for (
		let index = 0, previous = points.length - 1;
		index < points.length;
		previous = index, index += 1
	) {
		const currentPoint = points[index];
		const previousPoint = points[previous];
		if (!currentPoint || !previousPoint) continue;
		const crosses =
			currentPoint.y > point.y !== previousPoint.y > point.y &&
			point.x <
				((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
					(previousPoint.y - currentPoint.y) +
					currentPoint.x;
		if (crosses) inside = !inside;
	}
	return inside;
};

const geometryContainsPoint = (
	geometry: NodeGeometry,
	point: Vec2,
	tolerance: number,
	strokeWidth: number,
): boolean => {
	const strokeTolerance = Math.max(tolerance, strokeWidth / 2 + tolerance);
	switch (geometry.kind) {
		case "rect":
		case "text":
		case "image":
			return pointInBounds(
				point,
				inflateBounds(geometry.bounds, strokeTolerance),
			);
		case "ellipse": {
			const bounds = inflateBounds(geometry.bounds, strokeTolerance);
			const radiusX = bounds.width / 2;
			const radiusY = bounds.height / 2;
			if (radiusX <= 0 || radiusY <= 0) return false;
			const centerX = bounds.x + radiusX;
			const centerY = bounds.y + radiusY;
			const normalizedX = (point.x - centerX) / radiusX;
			const normalizedY = (point.y - centerY) / radiusY;
			return normalizedX * normalizedX + normalizedY * normalizedY <= 1;
		}
		case "line":
			return (
				distanceToSegment(point, geometry.start, geometry.end) <=
				strokeTolerance
			);
		case "polygon":
			return pointInPolygon(point, geometry.points, strokeTolerance);
		case "star":
			return pointInPolygon(point, starPoints(geometry), strokeTolerance);
		case "path":
			return pointInBounds(
				point,
				inflateBounds(getGeometryBounds(geometry), strokeTolerance),
			);
	}
};

/**
 * Pure scene hit stack for canvas handlers. The traversal mirrors render order
 * and walks from front to back, then applies exact geometry checks so callers
 * can cycle overlapping or nested targets without falling back to broad-phase
 * bounds. Hidden nodes and locked nodes are skipped by default.
 */
export function hitTestSceneStack(
	document: SceneDocument,
	point: Vec2,
	options: HitTestOptions = {},
): readonly HitTestResult[] {
	const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
	const spatial = getSceneSpatialIndex(document, { tolerance });
	const candidates = sceneHitTestCandidates(spatial, point, {
		includeLocked: options.includeLocked,
	});
	const results: HitTestResult[] = [];
	for (const entry of candidates) {
		const inverse = invertMatrix(matrixFromTransform(entry.node.transform));
		if (!inverse) continue;
		const localPoint = transformPoint(point, inverse);
		if (
			geometryContainsPoint(
				entry.node.geometry,
				localPoint,
				tolerance,
				entry.node.style.strokeWidth,
			)
		) {
			results.push({
				nodeId: entry.node.id,
				node: entry.node,
				layer: entry.layer,
				point,
				localPoint,
			});
		}
	}
	return results;
}

/**
 * Returns the topmost exact hit target for ordinary canvas selection. For deep
 * selection or z-order cycling, prefer {@link hitTestSceneStack} so the caller
 * can inspect every precise candidate under the pointer.
 */
export function hitTestScene(
	document: SceneDocument,
	point: Vec2,
	options: HitTestOptions = {},
): HitTestResult | null {
	return hitTestSceneStack(document, point, options)[0] ?? null;
}
