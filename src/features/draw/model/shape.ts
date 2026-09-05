import type {
	Bounds,
	EllipseGeometry,
	LineGeometry,
	PolygonGeometry,
	RectGeometry,
	StarGeometry,
	Vec2,
} from "@/entities/scene/model/types";

/** Shape primitives the shape tool can author from a single press-drag. */
export type ShapeKind = "rect" | "ellipse" | "line" | "polygon" | "star";

/** Concrete scene geometry variants produced by the shape tool. */
export type ShapeGeometry =
	| RectGeometry
	| EllipseGeometry
	| LineGeometry
	| PolygonGeometry
	| StarGeometry;

/**
 * Modifier state a drag honors. `constrain` (Shift) snaps the geometry to that
 * shape's constrained form; `fromCenter` (Alt) grows the shape outward from the
 * press point instead of treating it as a corner.
 */
export type DragModifiers = {
	readonly constrain: boolean;
	readonly fromCenter: boolean;
};

const sign = (value: number): number => (value < 0 ? -1 : 1);
const FULL_TURN = Math.PI * 2;
const RIGHT_ANGLE = Math.PI / 2;
const LINE_SNAP_STEP = Math.PI / 4;
const DEFAULT_POLYGON_POINTS = 6;
const DEFAULT_STAR_POINTS = 5;
const DEFAULT_STAR_INNER_RATIO = 0.48;

const roundTiny = (value: number): number =>
	Math.abs(value) < 1e-10 ? 0 : Number(value.toFixed(6));

const centerOfBounds = (bounds: Bounds): Vec2 => ({
	x: bounds.x + bounds.width / 2,
	y: bounds.y + bounds.height / 2,
});

const boundsFromPoints = (points: readonly Vec2[]): Bounds => {
	const xs = points.map((point) => point.x);
	const ys = points.map((point) => point.y);
	const minX = Math.min(...xs);
	const maxX = Math.max(...xs);
	const minY = Math.min(...ys);
	const maxY = Math.max(...ys);
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

const pointOnEllipse = (
	center: Vec2,
	radiusX: number,
	radiusY: number,
	angle: number,
): Vec2 => ({
	x: roundTiny(center.x + Math.cos(angle) * radiusX),
	y: roundTiny(center.y + Math.sin(angle) * radiusY),
});

const polygonPointsFromBounds = (
	bounds: Bounds,
	points: number,
): readonly Vec2[] => {
	const center = centerOfBounds(bounds);
	const radiusX = bounds.width / 2;
	const radiusY = bounds.height / 2;
	return Array.from({ length: points }, (_, index) =>
		pointOnEllipse(
			center,
			radiusX,
			radiusY,
			-RIGHT_ANGLE + (index / points) * FULL_TURN,
		),
	);
};

const snappedVector = (start: Vec2, current: Vec2): Vec2 => {
	const dx = current.x - start.x;
	const dy = current.y - start.y;
	const length = Math.hypot(dx, dy);
	if (length === 0) return { x: 0, y: 0 };
	const angle = Math.atan2(dy, dx);
	const snappedAngle = Math.round(angle / LINE_SNAP_STEP) * LINE_SNAP_STEP;
	return {
		x: roundTiny(Math.cos(snappedAngle) * length),
		y: roundTiny(Math.sin(snappedAngle) * length),
	};
};

/**
 * Axis-aligned bounds for a press-drag in artboard-local units. The result is
 * always normalized (non-negative width/height) regardless of drag direction so
 * downstream geometry never carries a flipped box. With `constrain` the dominant
 * axis sets both extents (square/circle), preserving each axis' drag direction;
 * with `fromCenter` the press point is the center rather than a corner.
 */
export function boundsFromDrag(
	start: Vec2,
	current: Vec2,
	modifiers: DragModifiers,
): Bounds {
	let dx = current.x - start.x;
	let dy = current.y - start.y;

	if (modifiers.constrain) {
		const extent = Math.max(Math.abs(dx), Math.abs(dy));
		dx = sign(dx) * extent;
		dy = sign(dy) * extent;
	}

	if (modifiers.fromCenter) {
		const halfWidth = Math.abs(dx);
		const halfHeight = Math.abs(dy);
		return {
			x: start.x - halfWidth,
			y: start.y - halfHeight,
			width: halfWidth * 2,
			height: halfHeight * 2,
		};
	}

	return {
		x: Math.min(start.x, start.x + dx),
		y: Math.min(start.y, start.y + dy),
		width: Math.abs(dx),
		height: Math.abs(dy),
	};
}

/** Builds rect geometry (sharp corners) from a press-drag. */
export function rectGeometryFromDrag(
	start: Vec2,
	current: Vec2,
	modifiers: DragModifiers,
): RectGeometry {
	return {
		kind: "rect",
		bounds: boundsFromDrag(start, current, modifiers),
		cornerRadius: 0,
	};
}

/** Builds ellipse geometry from a press-drag. */
export function ellipseGeometryFromDrag(
	start: Vec2,
	current: Vec2,
	modifiers: DragModifiers,
): EllipseGeometry {
	return {
		kind: "ellipse",
		bounds: boundsFromDrag(start, current, modifiers),
	};
}

/**
 * Builds line geometry from a press-drag. Shift snaps the vector to 45 degree
 * increments; Alt mirrors the line around the press point so the pointer remains
 * one endpoint while the opposite endpoint grows symmetrically.
 */
export function lineGeometryFromDrag(
	start: Vec2,
	current: Vec2,
	modifiers: DragModifiers,
): LineGeometry {
	const vector = modifiers.constrain
		? snappedVector(start, current)
		: { x: current.x - start.x, y: current.y - start.y };

	if (modifiers.fromCenter) {
		return {
			kind: "line",
			start: { x: start.x - vector.x, y: start.y - vector.y },
			end: { x: start.x + vector.x, y: start.y + vector.y },
		};
	}

	return {
		kind: "line",
		start,
		end: { x: start.x + vector.x, y: start.y + vector.y },
	};
}

/**
 * Builds a six-sided polygon inscribed in the drag box. Shift makes the box
 * square for a regular polygon; Alt grows the box from the press point, matching
 * rect/ellipse modifier semantics while storing explicit scene points.
 */
export function polygonGeometryFromDrag(
	start: Vec2,
	current: Vec2,
	modifiers: DragModifiers,
): PolygonGeometry {
	return {
		kind: "polygon",
		points: polygonPointsFromBounds(
			boundsFromDrag(start, current, modifiers),
			DEFAULT_POLYGON_POINTS,
		),
	};
}

/**
 * Builds radial star geometry from a drag. The scene contract stores star
 * radius as a single scalar, so star authoring always uses a square drag region
 * while still honoring Alt/from-center behavior.
 */
export function starGeometryFromDrag(
	start: Vec2,
	current: Vec2,
	modifiers: DragModifiers,
): StarGeometry {
	const bounds = boundsFromDrag(start, current, {
		...modifiers,
		constrain: true,
	});
	return {
		kind: "star",
		center: centerOfBounds(bounds),
		points: DEFAULT_STAR_POINTS,
		innerRadius: roundTiny((bounds.width / 2) * DEFAULT_STAR_INNER_RATIO),
		outerRadius: roundTiny(bounds.width / 2),
	};
}

/** Returns the concrete scene geometry for the active shape tool kind. */
export function shapeGeometryFromDrag(
	kind: ShapeKind,
	start: Vec2,
	current: Vec2,
	modifiers: DragModifiers,
): ShapeGeometry {
	switch (kind) {
		case "rect":
			return rectGeometryFromDrag(start, current, modifiers);
		case "ellipse":
			return ellipseGeometryFromDrag(start, current, modifiers);
		case "line":
			return lineGeometryFromDrag(start, current, modifiers);
		case "polygon":
			return polygonGeometryFromDrag(start, current, modifiers);
		case "star":
			return starGeometryFromDrag(start, current, modifiers);
	}
}

/**
 * Expands star geometry into polygon points for previews. Runtime canvas/export
 * adapters have their own render helpers; this keeps draw previews byte-for-byte
 * aligned with the geometry the handler commits.
 */
export function starPointsForGeometry(geometry: StarGeometry): readonly Vec2[] {
	const total = geometry.points * 2;
	return Array.from({ length: total }, (_, index) => {
		const radius =
			index % 2 === 0 ? geometry.outerRadius : geometry.innerRadius;
		return pointOnEllipse(
			geometry.center,
			radius,
			radius,
			-RIGHT_ANGLE + (index / total) * FULL_TURN,
		);
	});
}

/**
 * True when a dragged shape is large enough to commit. Lines use segment length,
 * while area shapes use their produced geometry bounds so horizontal/vertical
 * lines do not get rejected as zero-height boxes.
 */
export function shapeGeometryMeetsMinimum(
	geometry: ShapeGeometry,
	minSize: number,
): boolean {
	switch (geometry.kind) {
		case "rect":
		case "ellipse":
			return (
				geometry.bounds.width >= minSize && geometry.bounds.height >= minSize
			);
		case "line":
			return (
				Math.hypot(
					geometry.end.x - geometry.start.x,
					geometry.end.y - geometry.start.y,
				) >= minSize
			);
		case "polygon": {
			const bounds = boundsFromPoints(geometry.points);
			return bounds.width >= minSize && bounds.height >= minSize;
		}
		case "star":
			return geometry.outerRadius * 2 >= minSize;
	}
}
