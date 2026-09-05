import type { Point } from "./geometry";
import {
	formatMeasurementDistance,
	type MeasurementAxis,
	type MeasurementSegment,
	measurementSegment,
} from "./measurement";

/**
 * Coordinate-agnostic smart-guide snapping math promoted verbatim-adapted from
 * vecmo's `apps/vecmo/src/shared/lib/snapping.ts` (`SnapCandidate` /
 * `snapBoundingBox` / `snapPoint` / `worldThresholdFromScreen`). The math is pure
 * and unit-neutral: callers decide whether the numbers are world/artboard units
 * or screen pixels, and no DOM/scene reference is retained. The kernel owns the
 * single copy that both the root editor (screen-space DOM overlays) and future
 * consumers read; vecmo keeps its local copy until it migrates.
 *
 * Reconciliation with {@link ./measurement}: the E1 measurement module already
 * owns the `SnapMeasurement`-shaped segment (`MeasurementSegment`) plus its label
 * formatting, so this module IMPORTS them instead of redefining — `SnapMeasurement`
 * is a name-parity alias, and the axis/point primitives reuse geometry's `Point`
 * and measurement's `MeasurementAxis`. There is exactly one definition of each.
 */

/** A 2-D point in the same coordinate space the caller supplied. */
export type SnapPoint = Point;

/** Snap axes reuse the shared measurement axis so both modules agree on one type. */
export type SnapAxis = MeasurementAxis;

/**
 * View projection used when snapping thresholds are authored in screen pixels but
 * evaluated in world units. `pan` is the screen-space offset after zoom is applied
 * (`screen = world * zoom + pan`); only `zoom` affects the threshold conversion.
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
 * Measurement segment emitted beside a snap result. Name-parity alias over the E1
 * measurement module's {@link MeasurementSegment} — the single source of truth.
 */
export type SnapMeasurement = MeasurementSegment;

/**
 * Generic one-dimensional snap target. Domain layers can extend this shape with
 * source metadata while the shared math only needs axis, value, and an optional
 * guide to return when the candidate wins.
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
 * Compact marker for the exact point a snap resolved to. Renderers can draw it
 * without re-reading candidates; handlers can ignore it and only consume the
 * adjusted point.
 */
export type SnapIndicator = {
	readonly point: SnapPoint;
	readonly axes: readonly SnapAxis[];
	readonly sourceIds: readonly string[];
	readonly label: string;
};

export type SnapContext<Candidate extends SnapCandidate = SnapCandidate> = {
	readonly enabled: boolean;
	/**
	 * Fallback threshold in world units. Newer callers should pass `thresholdPx`
	 * plus `projection` so the magnet radius stays screen-stable under zoom.
	 */
	readonly threshold: number;
	readonly thresholdPx?: number;
	readonly projection?: SnapProjection;
	readonly candidates?: readonly Candidate[];
	readonly emitMeasurements?: boolean;
};

export type SnapResult<Candidate extends SnapCandidate = SnapCandidate> = {
	readonly point: SnapPoint;
	readonly adjustedPoint: SnapPoint;
	/** Translation from the raw input point to `adjustedPoint`, in input units. */
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

/**
 * Converts a screen-pixel snapping threshold into world units. This is the bridge
 * that keeps a 6px magnet feeling like 6px regardless of zoom.
 */
export function worldThresholdFromScreen(
	thresholdPx: number,
	projection: SnapProjection,
): number {
	return clampThreshold(thresholdPx) / zoomFactor(projection);
}

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
 * Snaps a point against independent x/y candidates. Never mutates candidates or
 * documents; returns an adjusted point plus guide and measurement metadata for
 * the winning axes. Measurement segments reuse the E1 measurement builder.
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
			: matches.map((match) =>
					measurementSegment(match.axis, point, match.delta),
				);

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

/** Axis-aligned extents of a dragged selection, in the candidate space. */
export type BoundsExtent = {
	readonly minX: number;
	readonly maxX: number;
	readonly minY: number;
	readonly maxY: number;
};

/** Restricts which axes a bounding-box snap may correct (axis-lock / edge-lock). */
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
	/** Overlay-facing result (winning guide lines, no indicator/measurement). */
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
 * snaps the grab point), this tests the selection's bounding-box edges and centers
 * — the three x-values L/Cx/R and three y-values T/Cy/B, each shifted by the
 * proposed move delta — against the per-axis candidates, and returns the smallest
 * per-axis CORRECTION to add to the delta so an edge/center aligns. Read-only: it
 * never mutates candidates or the document, only returns a correction plus the
 * winning guide lines for the overlay. `axes` lets a caller suppress an axis so
 * snapping cannot introduce movement on a constrained/edge-locked axis.
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

/** One sibling's extent along a single axis, for equal-gap candidate generation. */
export type GapSpacingExtent = Readonly<{
	id: string;
	min: number;
	max: number;
}>;

/**
 * A3: one equal-gap snap candidate paired with the geometry needed to draw its badge.
 * `axisFrom`/`gap` describe the proposed gap segment ALONG the candidate's own axis only
 * (the neighbor's near edge, and the signed length to its far edge); the caller supplies
 * the cross-axis coordinate when it builds the displayed {@link MeasurementSegment} via
 * {@link measurementSegment}, since this module has no notion of the box's other axis.
 */
export type GapSpacingCandidate<
	Candidate extends SnapCandidate = SnapCandidate,
> = Readonly<{
	candidate: Candidate;
	axisFrom: number;
	gap: number;
}>;

/**
 * A3: equal-gap snap candidates ("distribute spacing" tick marks). Given the OTHER
 * siblings' extents along one axis (the dragged node excluded) and the size of the
 * dragged box along that same axis, proposes leading-edge positions that would make the
 * dragged box's gap to an adjacent sibling equal an existing gap between two ADJACENT
 * siblings elsewhere in sorted order. Pure and unit-neutral like the rest of this module
 * — callers decide world vs. screen space. Each candidate's `label` is pre-formatted via
 * {@link formatMeasurementDistance} so a renderer never reformats the same number twice.
 */
export function equalGapCandidates(
	axis: SnapAxis,
	siblings: readonly GapSpacingExtent[],
	size: number,
	priority: number,
): readonly GapSpacingCandidate[] {
	if (siblings.length < 2 || !(size > 0)) return [];
	const sorted = [...siblings].sort((left, right) => left.min - right.min);
	const gapValues = new Set<number>();
	for (let index = 1; index < sorted.length; index += 1) {
		const gap = sorted[index].min - sorted[index - 1].max;
		if (gap > 0) gapValues.add(gap);
	}
	if (gapValues.size === 0) return [];
	const results: GapSpacingCandidate[] = [];
	for (const sibling of sorted) {
		for (const gap of gapValues) {
			const label = formatMeasurementDistance(gap);
			results.push({
				candidate: {
					id: `gap:${axis}:after:${sibling.id}:${gap}`,
					axis,
					value: sibling.max + gap,
					priority,
					label,
				},
				axisFrom: sibling.max,
				gap,
			});
			results.push({
				candidate: {
					id: `gap:${axis}:before:${sibling.id}:${gap}`,
					axis,
					value: sibling.min - gap - size,
					priority,
					label,
				},
				axisFrom: sibling.min - gap,
				gap,
			});
		}
	}
	return results;
}
