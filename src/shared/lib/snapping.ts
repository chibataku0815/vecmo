export type SnapPoint = {
	readonly x: number;
	readonly y: number;
};

export type SnapAxis = "x" | "y";

/**
 * View projection used when snapping thresholds are authored in screen pixels
 * but evaluated in artboard/world units. `pan` is the screen-space offset after
 * zoom is applied: `screen = world * zoom + pan`.
 */
export type SnapProjection = {
	readonly zoom: number;
	readonly pan: SnapPoint;
};

/** Visual line a renderer can draw for the candidate that won a snap axis. */
export type SnapGuideVisual = {
	readonly axis: SnapAxis;
	readonly from: SnapPoint;
	readonly to: SnapPoint;
	readonly label?: string;
	readonly labelAt?: SnapPoint;
};

/**
 * Measurement segment emitted beside a snap result. It represents how far the
 * input point moved on one axis after snapping, in world/artboard units.
 */
export type SnapMeasurement = {
	readonly axis: SnapAxis;
	readonly from: SnapPoint;
	readonly to: SnapPoint;
	readonly labelAt: SnapPoint;
	readonly delta: number;
	readonly distance: number;
	readonly label: string;
};

/**
 * Generic one-dimensional snap target. Domain layers can extend this shape
 * with source metadata while the shared math only needs axis, value, and an
 * optional guide to return when the candidate wins.
 */
export type SnapCandidate = {
	readonly id: string;
	readonly axis: SnapAxis;
	readonly value: number;
	readonly priority?: number;
	readonly guide?: SnapGuideVisual;
	readonly label?: string;
};

export type SnapMatch<Candidate extends SnapCandidate = SnapCandidate> = {
	readonly axis: SnapAxis;
	readonly candidate: Candidate;
	readonly delta: number;
	readonly distance: number;
};

/**
 * What kind of target a 2-D point lock resolved onto, so a renderer can draw a
 * distinct glyph (Illustrator-style): a real shape anchor vs. a grid crossing.
 * Absent on 1-D axis/edge snaps, which draw the default crosshair.
 */
export type SnapPointKind = "vertex" | "grid";

/**
 * Compact marker for the exact point a snap resolved to. Renderers can draw it
 * without re-reading candidates, while handlers can ignore it and only consume
 * `adjustedPoint`. `kind` distinguishes a 2-D point lock's target for glyph choice.
 */
export type SnapIndicator = {
	readonly point: SnapPoint;
	readonly axes: readonly SnapAxis[];
	readonly sourceIds: readonly string[];
	readonly label: string;
	readonly kind?: SnapPointKind;
};

export type SnapContext<Candidate extends SnapCandidate = SnapCandidate> = {
	readonly enabled: boolean;
	/**
	 * Fallback threshold in world/artboard units. Existing callers can keep using
	 * this directly; newer callers should pass `thresholdPx` plus `projection`.
	 */
	readonly threshold: number;
	readonly thresholdPx?: number;
	readonly projection?: SnapProjection;
	readonly candidates?: readonly Candidate[];
	readonly emitMeasurements?: boolean;
};

export type SnapResult<Candidate extends SnapCandidate = SnapCandidate> = {
	/** Backward-compatible adjusted point field used by existing seam callers. */
	readonly point: SnapPoint;
	readonly adjustedPoint: SnapPoint;
	/**
	 * Translation from the raw input point to `adjustedPoint`, expressed in the
	 * same world/artboard units as the input. Transform handlers can consume this
	 * directly without re-deriving per-axis deltas from match metadata.
	 */
	readonly delta: SnapPoint;
	readonly snapped: boolean;
	readonly matches: readonly SnapMatch<Candidate>[];
	readonly guides: readonly SnapGuideVisual[];
	readonly measurements: readonly SnapMeasurement[];
	readonly indicator: SnapIndicator | null;
};

const MIN_ZOOM = 0.000001;
const EPSILON = 0.000001;

const clampThreshold = (threshold: number): number =>
	Number.isFinite(threshold) ? Math.max(0, threshold) : 0;

const zoomFactor = (projection: SnapProjection): number => {
	const zoom = Math.abs(projection.zoom);
	return zoom > MIN_ZOOM ? zoom : MIN_ZOOM;
};

const axisValue = (point: SnapPoint, axis: SnapAxis): number =>
	axis === "x" ? point.x : point.y;

const moveAxis = (
	point: SnapPoint,
	axis: SnapAxis,
	delta: number,
): SnapPoint =>
	axis === "x"
		? { x: point.x + delta, y: point.y }
		: { x: point.x, y: point.y + delta };

const midpoint = (from: SnapPoint, to: SnapPoint): SnapPoint => ({
	x: (from.x + to.x) / 2,
	y: (from.y + to.y) / 2,
});

const formatDistance = (distance: number): string => {
	const rounded = Number(distance.toFixed(3));
	const text = Number.isInteger(rounded)
		? String(rounded)
		: String(rounded).replace(/0+$/, "").replace(/\.$/, "");
	return `${text}px`;
};

const emptyResult = <Candidate extends SnapCandidate>(
	point: SnapPoint,
): SnapResult<Candidate> => ({
	point,
	adjustedPoint: point,
	delta: { x: 0, y: 0 },
	snapped: false,
	matches: [],
	guides: [],
	measurements: [],
	indicator: null,
});

const effectiveThreshold = (context: SnapContext<SnapCandidate>): number => {
	if (context.thresholdPx !== undefined && context.projection) {
		return worldThresholdFromScreen(context.thresholdPx, context.projection);
	}
	return clampThreshold(context.threshold);
};

const indicatorLabel = <Candidate extends SnapCandidate>(
	matches: readonly SnapMatch<Candidate>[],
): string =>
	matches
		.map((match) => match.candidate.label ?? match.candidate.id)
		.join(" / ");

const indicatorFromMatches = <Candidate extends SnapCandidate>(
	point: SnapPoint,
	matches: readonly SnapMatch<Candidate>[],
): SnapIndicator => ({
	point,
	axes: matches.map((match) => match.axis),
	sourceIds: matches.map((match) => match.candidate.id),
	label: indicatorLabel(matches),
});

function betterMatch<Candidate extends SnapCandidate>(
	current: SnapMatch<Candidate> | null,
	next: SnapMatch<Candidate>,
): SnapMatch<Candidate> {
	if (!current) return next;
	if (next.distance < current.distance - EPSILON) return next;
	if (Math.abs(next.distance - current.distance) > EPSILON) return current;
	const currentPriority = current.candidate.priority ?? 0;
	const nextPriority = next.candidate.priority ?? 0;
	return nextPriority > currentPriority ? next : current;
}

function nearestByAxis<Candidate extends SnapCandidate>(
	point: SnapPoint,
	candidates: readonly Candidate[],
	axis: SnapAxis,
	threshold: number,
): SnapMatch<Candidate> | null {
	let match: SnapMatch<Candidate> | null = null;
	for (const candidate of candidates) {
		if (candidate.axis !== axis) continue;
		const delta = candidate.value - axisValue(point, axis);
		const distance = Math.abs(delta);
		if (distance > threshold) continue;
		match = betterMatch(match, { axis, candidate, delta, distance });
	}
	return match;
}

/**
 * Converts a screen-pixel snapping threshold into world/artboard units. This is
 * the critical bridge for Figma-like snapping: a 6px magnet should feel like 6px
 * regardless of zoom.
 */
export function worldThresholdFromScreen(
	thresholdPx: number,
	projection: SnapProjection,
): number {
	return clampThreshold(thresholdPx) / zoomFactor(projection);
}

/** Projects a world/artboard point into screen coordinates under zoom and pan. */
export function projectPoint(
	point: SnapPoint,
	projection: SnapProjection,
): SnapPoint {
	return {
		x: point.x * projection.zoom + projection.pan.x,
		y: point.y * projection.zoom + projection.pan.y,
	};
}

/** Converts a screen-space point back into world/artboard coordinates. */
export function unprojectPoint(
	point: SnapPoint,
	projection: SnapProjection,
): SnapPoint {
	const zoom = zoomFactor(projection);
	return {
		x: (point.x - projection.pan.x) / zoom,
		y: (point.y - projection.pan.y) / zoom,
	};
}

/** Projects a visual guide line into screen coordinates for overlay rendering. */
export function projectGuide(
	guide: SnapGuideVisual,
	projection: SnapProjection,
): SnapGuideVisual {
	return {
		...guide,
		from: projectPoint(guide.from, projection),
		to: projectPoint(guide.to, projection),
		labelAt: guide.labelAt
			? projectPoint(guide.labelAt, projection)
			: undefined,
	};
}

/** Projects a measurement segment into screen coordinates while preserving units. */
export function projectMeasurement(
	measurement: SnapMeasurement,
	projection: SnapProjection,
): SnapMeasurement {
	return {
		...measurement,
		from: projectPoint(measurement.from, projection),
		to: projectPoint(measurement.to, projection),
		labelAt: projectPoint(measurement.labelAt, projection),
	};
}

/**
 * Snaps a point against independent x/y candidates. The function never mutates
 * candidates or documents; it only returns an adjusted point plus guide and
 * measurement metadata for the winning axes.
 */
export function snapPoint<Candidate extends SnapCandidate = SnapCandidate>(
	point: SnapPoint,
	context: SnapContext<Candidate>,
): SnapResult<Candidate> {
	if (!context.enabled) return emptyResult(point);
	const candidates = context.candidates ?? [];
	if (candidates.length === 0) return emptyResult(point);

	const threshold = effectiveThreshold(context);
	const xMatch = nearestByAxis(point, candidates, "x", threshold);
	const yMatch = nearestByAxis(point, candidates, "y", threshold);
	const matches = [xMatch, yMatch].filter(
		(match): match is SnapMatch<Candidate> => match !== null,
	);
	if (matches.length === 0) return emptyResult(point);

	const adjustedPoint = matches.reduce(
		(current, match) => moveAxis(current, match.axis, match.delta),
		point,
	);
	const delta = {
		x: adjustedPoint.x - point.x,
		y: adjustedPoint.y - point.y,
	};
	const guides = matches.flatMap((match) =>
		match.candidate.guide ? [match.candidate.guide] : [],
	);
	const measurements =
		context.emitMeasurements === false
			? []
			: matches.map((match) => {
					const to = moveAxis(point, match.axis, match.delta);
					return {
						axis: match.axis,
						from: point,
						to,
						labelAt: midpoint(point, to),
						delta: match.delta,
						distance: match.distance,
						label: formatDistance(match.distance),
					};
				});

	return {
		point: adjustedPoint,
		adjustedPoint,
		delta,
		snapped: true,
		matches,
		guides,
		measurements,
		indicator: indicatorFromMatches(adjustedPoint, matches),
	};
}

/** A 2D snap target (a real anchor point) in the same space as the input point. */
export type PointSnapCandidate = {
	readonly x: number;
	readonly y: number;
	/** Target kind for the indicator glyph; defaults to a vertex when omitted. */
	readonly kind?: SnapPointKind;
};

export type PointSnapContext = {
	readonly enabled: boolean;
	readonly thresholdPx: number;
	readonly projection: SnapProjection;
};

export type PointSnapResult<C extends PointSnapCandidate = PointSnapCandidate> =
	{
		readonly point: SnapPoint;
		readonly snapped: boolean;
		readonly match: C | null;
		readonly indicator: SnapIndicator | null;
	};

/**
 * "Snap to Point": locks BOTH axes onto the single nearest candidate point within
 * a screen-stable radius. This is deliberately NOT routed through the per-axis 1D
 * engine ({@link snapPoint}/`nearestByAxis`) — doing so would snap X to one vertex
 * and Y to another and land on neither. The contract is landing exactly ON one
 * anchor, so the nearest point (by screen-space Euclidean distance) wins and both
 * coordinates are taken from it.
 */
export function snapToNearestPoint<
	C extends PointSnapCandidate = PointSnapCandidate,
>(
	point: SnapPoint,
	candidates: readonly C[],
	context: PointSnapContext,
): PointSnapResult<C> {
	const miss: PointSnapResult<C> = {
		point,
		snapped: false,
		match: null,
		indicator: null,
	};
	if (!context.enabled || candidates.length === 0) return miss;
	const threshold = worldThresholdFromScreen(
		context.thresholdPx,
		context.projection,
	);
	let best: C | null = null;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const candidate of candidates) {
		const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
		if (distance > threshold) continue;
		if (distance < bestDistance) {
			bestDistance = distance;
			best = candidate;
		}
	}
	if (!best) return miss;
	const snapped = { x: best.x, y: best.y };
	return {
		point: snapped,
		snapped: true,
		match: best,
		indicator: {
			point: snapped,
			axes: ["x", "y"],
			sourceIds: [],
			label: "",
			// Untagged candidates are real shape anchors; grid crossings tag themselves.
			kind: best.kind ?? "vertex",
		},
	};
}

/** Axis-aligned extents of a dragged selection, in the candidate space. */
export type BoundsExtent = {
	readonly minX: number;
	readonly maxX: number;
	readonly minY: number;
	readonly maxY: number;
};

/** Restricts which axes a bounding-box snap may correct (Shift/axis-lock). */
export type BoundingBoxSnapAxes = {
	readonly x: boolean;
	readonly y: boolean;
};

export type BoundingBoxSnapContext<
	Candidate extends SnapCandidate = SnapCandidate,
> = SnapContext<Candidate> & { readonly axes?: BoundingBoxSnapAxes };

export type BoundingBoxSnapResult<
	Candidate extends SnapCandidate = SnapCandidate,
> = {
	/** Correction to ADD to the proposed delta so the box aligns. */
	readonly correction: SnapPoint;
	readonly snapped: boolean;
	/** Overlay/store-facing result (winning guide lines, no indicator/measurement). */
	readonly result: SnapResult<Candidate>;
};

const boxAxisAnchors = (
	box: BoundsExtent,
	axis: SnapAxis,
): readonly [number, number, number] =>
	axis === "x"
		? [box.minX, (box.minX + box.maxX) / 2, box.maxX]
		: [box.minY, (box.minY + box.maxY) / 2, box.maxY];

function bestBoxAxisMatch<Candidate extends SnapCandidate>(
	box: BoundsExtent,
	axis: SnapAxis,
	delta: number,
	candidates: readonly Candidate[],
	threshold: number,
): SnapMatch<Candidate> | null {
	let best: SnapMatch<Candidate> | null = null;
	for (const base of boxAxisAnchors(box, axis)) {
		const value = base + delta;
		const point = axis === "x" ? { x: value, y: 0 } : { x: 0, y: value };
		const match = nearestByAxis(point, candidates, axis, threshold);
		if (match) best = betterMatch(best, match);
	}
	return best;
}

/**
 * Smart-guide snapping for a dragged SELECTION. Unlike {@link snapPoint} (which
 * snaps the grab point), this tests the selection's bounding-box edges and
 * centers — the three x-values L/Cx/R and three y-values T/Cy/B, each shifted by
 * the proposed move delta — against the per-axis candidates, and returns the
 * smallest per-axis CORRECTION to add to the delta so an edge/center aligns. This
 * is what makes object-to-object alignment feel like Illustrator/Figma instead of
 * a cursor magnet. The function is read-only: it never mutates candidates or the
 * document, only returns a correction plus the winning guide lines for the
 * overlay. `axes` lets a caller suppress an axis-locked (Shift) axis so snapping
 * cannot introduce movement on a constrained axis.
 */
export function snapBoundingBox<
	Candidate extends SnapCandidate = SnapCandidate,
>(
	box: BoundsExtent,
	proposedDelta: SnapPoint,
	context: BoundingBoxSnapContext<Candidate>,
): BoundingBoxSnapResult<Candidate> {
	const center = {
		x: (box.minX + box.maxX) / 2 + proposedDelta.x,
		y: (box.minY + box.maxY) / 2 + proposedDelta.y,
	};
	const none: BoundingBoxSnapResult<Candidate> = {
		correction: { x: 0, y: 0 },
		snapped: false,
		result: emptyResult(center),
	};
	if (!context.enabled) return none;
	const candidates = context.candidates ?? [];
	if (candidates.length === 0) return none;

	const threshold = effectiveThreshold(context);
	const axes = context.axes ?? { x: true, y: true };
	const xMatch = axes.x
		? bestBoxAxisMatch(box, "x", proposedDelta.x, candidates, threshold)
		: null;
	const yMatch = axes.y
		? bestBoxAxisMatch(box, "y", proposedDelta.y, candidates, threshold)
		: null;
	const matches = [xMatch, yMatch].filter(
		(match): match is SnapMatch<Candidate> => match !== null,
	);
	if (matches.length === 0) return none;

	const correction = {
		x: xMatch ? xMatch.delta : 0,
		y: yMatch ? yMatch.delta : 0,
	};
	const adjustedCenter = {
		x: center.x + correction.x,
		y: center.y + correction.y,
	};
	const guides = matches.flatMap((match) =>
		match.candidate.guide ? [match.candidate.guide] : [],
	);
	return {
		correction,
		snapped: true,
		result: {
			point: adjustedCenter,
			adjustedPoint: adjustedCenter,
			delta: correction,
			snapped: true,
			matches,
			guides,
			measurements: [],
			indicator: null,
		},
	};
}
