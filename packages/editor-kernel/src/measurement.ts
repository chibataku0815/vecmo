import type { Point } from "./geometry";

/**
 * Coordinate-agnostic measurement primitives promoted from vecmo's
 * `apps/vecmo/src/shared/lib/snapping.ts` (`SnapMeasurement` + label formatting).
 * These are pure, dependency-free, and unit-neutral: callers decide whether the
 * numbers are world/artboard units or screen pixels. The kernel owns the clean
 * superset both the root editor (screen-space DOM overlays) and future snapping
 * consumers (E3) read; vecmo keeps its local copy until it migrates.
 */

export type MeasurementAxis = "x" | "y";

/**
 * A one-dimensional measurement segment beside a gesture result. Mirrors vecmo's
 * `SnapMeasurement`: how far a point moved on one axis, with a midpoint label
 * anchor, expressed in whatever units the caller supplied.
 */
export type MeasurementSegment = Readonly<{
	axis: MeasurementAxis;
	from: Point;
	to: Point;
	labelAt: Point;
	delta: number;
	distance: number;
	label: string;
}>;

const midpoint = (from: Point, to: Point): Point => ({
	x: (from.x + to.x) / 2,
	y: (from.y + to.y) / 2,
});

/** Rounds a length to the nearest integer, coercing non-finite input to 0. */
export const roundLength = (value: number): number =>
	Number.isFinite(value) ? Math.round(value) : 0;

/**
 * Formats a distance the way vecmo's overlay labels do: trims trailing zeros
 * after rounding to 3 decimals and appends the `px` unit.
 */
export const formatMeasurementDistance = (distance: number): string => {
	const safe = Number.isFinite(distance) ? distance : 0;
	const rounded = Number(safe.toFixed(3));
	const text = Number.isInteger(rounded)
		? String(rounded)
		: String(rounded).replace(/0+$/, "").replace(/\.$/, "");
	return `${text}px`;
};

/** `W × H` label from rounded dimensions, for a resize badge. */
export const formatDimensionLabel = (width: number, height: number): string =>
	`${roundLength(width)} × ${roundLength(height)}`;

/** `X, Y` label from rounded coordinates, for a drag position badge. */
export const formatPositionLabel = (x: number, y: number): string =>
	`${roundLength(x)}, ${roundLength(y)}`;

/**
 * Builds a {@link MeasurementSegment} for a one-axis move. Pure: it never reads
 * or writes any document; it only projects the given points into label metadata.
 */
export const measurementSegment = (
	axis: MeasurementAxis,
	from: Point,
	delta: number,
): MeasurementSegment => {
	const to =
		axis === "x"
			? { x: from.x + delta, y: from.y }
			: { x: from.x, y: from.y + delta };
	const distance = Math.abs(delta);
	return {
		axis,
		from,
		to,
		labelAt: midpoint(from, to),
		delta,
		distance,
		label: formatMeasurementDistance(distance),
	};
};
