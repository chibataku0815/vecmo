/**
 * Pure value math for {@link ScrubSlider}. Kept React-free and domain-free so the
 * track ↔ value mapping (fraction, step quantization, range clamping, bipolar
 * center-detent) is unit-testable without rendering or pointer events. The slider
 * component owns interaction; this module owns arithmetic only.
 */

/** Clamps `value` into the inclusive `[min, max]` range. */
export function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

/**
 * Track position (0…1) of `value` within `[min, max]`. Returns 0 for a
 * degenerate (zero-width) range so callers never divide by zero.
 */
export function scrubFraction(value: number, min: number, max: number): number {
	const span = max - min;
	if (span <= 0) return 0;
	return clamp((value - min) / span, 0, 1);
}

/** Decimal places implied by a step (0.05 → 2, 0.1 → 1, 1 → 0). */
function decimalsForStep(step: number): number {
	const fraction = String(step).split(".")[1];
	return fraction ? fraction.length : 0;
}

/**
 * Quantizes `value` to the nearest multiple of `step`, trimming binary
 * floating-point dust to the step's natural decimal count (so 0.05-stepping
 * yields 0.3, not 0.30000000000000004). A non-positive step is a passthrough.
 */
export function roundToStep(value: number, step: number): number {
	if (!(step > 0)) return value;
	const snapped = Math.round(value / step) * step;
	return Number(snapped.toFixed(decimalsForStep(step)));
}

/**
 * The displayed value for a raw (unrounded) scrub position: step-quantized then
 * clamped into range. Clamp comes last because rounding can nudge a value one
 * step past an endpoint.
 */
export function quantizeToRange(
	value: number,
	min: number,
	max: number,
	step: number,
): number {
	return clamp(roundToStep(value, step), min, max);
}

/**
 * Snaps `value` to `neutral` when within `tolerance`. Used only for the bipolar
 * Exposure track so releasing near zero lands exactly on the neutral default;
 * multiplier controls (neutral 1.0) deliberately pass `tolerance` 0 — a snap-to-1
 * detent there would fight precise grading.
 */
export function snapToNeutral(
	value: number,
	neutral: number,
	tolerance: number,
): number {
	return Math.abs(value - neutral) <= tolerance ? neutral : value;
}

/** Formats a scrub value for the inline readout: step-driven decimals + optional unit. */
export function formatScrubValue(
	value: number,
	step: number,
	unit?: string,
): string {
	const text = value.toFixed(decimalsForStep(step));
	return unit ? `${text}${unit}` : text;
}
