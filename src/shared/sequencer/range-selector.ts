/**
 * Range Selector value-math — the shared primitive of the sequencer.
 *
 * It maps an ordered position `∈ [0,1]` to a selection value `∈ [0,1]` through a
 * window `[start, end]` (shifted by an already-resolved `offset`), shaped by
 * `shape`, scaled by `amount`, and folded across multiple selectors by a combine
 * `mode`. Nothing here knows about frames, keyframes, fragments, or scene nodes:
 * this is pure arithmetic so both the Text Animator (which projects the value to a
 * pose AMPLITUDE) and the Motion Grammar (which projects it to a wavefront
 * TIME-OFFSET) can consume the identical selection without coupling to each other.
 *
 * Frame → offset resolution (keyframe sweeps) belongs to the caller: it passes the
 * resolved `offset` in. That is what keeps this module at the `shared` layer, below
 * both `entities/motion` and `entities/motion-grammar`.
 */

const PERCENT = 100;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** Hermite smoothstep on a 0..1 input — removes the hard stepping of a linear ramp. */
const smoothstep = (t: number): number => t * t * (3 - 2 * t);

/** How the window edge transitions across the selected fragments. */
export type RangeSelectorShape = "square" | "ramp-up" | "ramp-down" | "smooth";

/** How a selector folds into the running selection when several are layered. */
export type RangeSelectorCombineMode =
	| "add"
	| "subtract"
	| "intersect"
	| "min"
	| "max";

/** How `start`/`end`/`offset` are read: 0..100 of the run, or absolute unit counts. */
export type RangeSelectorUnits = "percent" | "index";

/**
 * The value-math inputs of one selector. A structural subset of the richer
 * `RangeTextSelector` (which also carries `kind`, `mode`, `offset`, and
 * `offsetKeyframes`), so a full selector can be passed wherever a core is wanted.
 */
export type RangeSelectorCore = {
	readonly units: RangeSelectorUnits;
	readonly start: number;
	readonly end: number;
	readonly amount: number;
	readonly shape: RangeSelectorShape;
};

/**
 * Fraction of the way `position` is across the window edge `[lo, hi]`, clamped to
 * 0..1. A zero-width window collapses to a hard step at the edge.
 */
const edgeFraction = (position: number, lo: number, hi: number): number => {
	const span = hi - lo;
	if (span <= 0) return position >= hi ? 1 : 0;
	return clamp01((position - lo) / span);
};

const selectionForShape = (
	shape: RangeSelectorShape,
	position: number,
	lo: number,
	hi: number,
	t: number,
): number => {
	switch (shape) {
		case "square":
			return position >= lo && position <= hi ? 1 : 0;
		case "ramp-up":
			return t;
		case "ramp-down":
			return 1 - t;
		case "smooth":
			return smoothstep(t);
	}
};

/** Folds one selector's value into the running accumulator per its combine mode. */
export const combine = (
	mode: RangeSelectorCombineMode,
	accumulator: number,
	value: number,
): number => {
	switch (mode) {
		case "add":
			return accumulator + value;
		case "subtract":
			return accumulator - value;
		case "intersect":
			return accumulator * value;
		case "min":
			return Math.min(accumulator, value);
		case "max":
			return Math.max(accumulator, value);
	}
};

/**
 * Raw 0..1 selection of one ordered position by one selector, given a resolved
 * `offset` and the orderable `count`. This is the shared core every projection
 * builds on; the combine across multiple selectors is the caller's reduce.
 */
export const selectorValueCore = (
	selector: RangeSelectorCore,
	position: number,
	count: number,
	offset: number,
): number => {
	const denominator =
		selector.units === "percent" ? PERCENT : Math.max(1, count);
	const a = (selector.start + offset) / denominator;
	const b = (selector.end + offset) / denominator;
	const lo = Math.min(a, b);
	const hi = Math.max(a, b);
	const t = edgeFraction(position, lo, hi);
	const raw = selectionForShape(selector.shape, position, lo, hi, t);
	return raw * (selector.amount / PERCENT);
};

/** The identity wavefront: a full-range, full-strength, linear selector maps `phase(p) === p`. */
const isUniformSelector = (selector: RangeSelectorCore): boolean =>
	selector.units === "percent" &&
	selector.start === 0 &&
	selector.end === PERCENT &&
	selector.amount === PERCENT &&
	selector.shape === "ramp-up";

/**
 * Per-target wavefront delay for an ordered technique: the selector reshapes how a
 * uniform `index * step` stagger is redistributed across the ordered set. The
 * caller supplies `index` (the target's ordinal) and `count` (the set size),
 * because the ordinal → position normalization is per-projection — a grammar
 * wavefront maps endpoints `index / (count - 1)`, unlike the text animator's
 * centre-of-cell map. The uniform selector returns `index * step` BIT-EXACT, so
 * the default path never drifts from the prior `index * step` behaviour.
 */
export const wavefrontDelay = (
	index: number,
	count: number,
	selector: RangeSelectorCore,
	step: number,
): number => {
	if (count <= 1) return 0;
	if (isUniformSelector(selector)) return index * step;
	const position = index / (count - 1);
	const phase = selectorValueCore(selector, position, count, 0);
	return phase * (count - 1) * step;
};
