/**
 * Tap-budget guard (S3): the closure-chain fusion model means a gather node
 * (`blur`, `find-edges`, a cell-averaging node, …) calls its upstream
 * function once per tap, and every one of those calls itself re-runs the
 * *entire* upstream chain — so tap counts compound multiplicatively with
 * chain depth (gather-after-gather, gather-after-uv-remap-after-gather, …).
 * `lower.ts` tracks, per node, the worst-case number of times the chain root
 * (`lk_source`) would be evaluated if every node's function actually ran
 * (`upstream's accumulated product * this node's own tap count`) and derives
 * a `tapBudget` — the max taps *this* node may spend — from
 * `DCTL_TAP_BUDGET / upstream's accumulated product` before invoking its
 * emitter. Gather emitters that can shrink their own kernel/grid (blur's
 * Gaussian kernel, a cell node's area-average grid) use it to degrade
 * gracefully instead of the export blowing past a reasonable generated-code
 * size; the plan is explicit this guard never fails the export.
 */
export const DCTL_TAP_BUDGET = 256;

/**
 * Shrinks a square NxN area-average tap grid (halftone/pixel-grid/
 * ordered-dither/ascii-glyph/block-mosaic's 4x4 average, riso's per-ink 2x2
 * average) down from `idealGridSize` to the largest `size <= idealGridSize`
 * whose `size * size` still fits `tapBudget`, floored at `1` (a single
 * centre sample — never zero, so a node in an absurdly deep chain still
 * produces *a* color rather than failing to compile).
 */
export const cappedAverageGridSize = (
	idealGridSize: number,
	tapBudget: number,
): number => {
	let size = Math.max(1, Math.floor(idealGridSize));
	const budget = Math.max(1, Math.floor(tapBudget));
	while (size > 1 && size * size > budget) size -= 1;
	return size;
};

/** One tap of a baked 2D blur kernel: integer texel offset plus its normalized Gaussian weight. */
export type BlurKernelTap = {
	readonly dx: number;
	readonly dy: number;
	readonly weight: number;
};

export type BlurKernelPlan = {
	readonly taps: readonly BlurKernelTap[];
	/** True when the tap-budget guard forced a smaller kernel than the natural 3-sigma truncation. */
	readonly reduced: boolean;
};

/**
 * Matches `REGION_SIGMA_REACH` in `entities/scene/model/effect-filter.ts` —
 * the same "how far a Gaussian of a given sigma visibly reaches" constant
 * the SVG blur-outward-reach math uses, so an untruncated DCTL kernel and the
 * SVG blur's affected-region estimate agree on where a Gaussian's tail stops
 * mattering.
 */
const GAUSSIAN_SIGMA_REACH = 3;

const gaussian1d = (offset: number, sigma: number): number =>
	sigma > 0
		? Math.exp(-(offset * offset) / (2 * sigma * sigma))
		: offset === 0
			? 1
			: 0;

/**
 * Bakes a fixed, separable-in-shape-but-single-pass 2D Gaussian kernel for
 * `blur`'s axis-aligned anisotropic radius/radiusY: the ideal half-extent per
 * axis is the standard `ceil(3 * sigma)` truncation (>99.7% of the
 * Gaussian's mass), then both half-extents shrink one step at a time —
 * larger axis first — until `(2*halfX+1) * (2*halfY+1)` fits `tapBudget`.
 * Weights are the product of each axis's 1D Gaussian (an axis-aligned 2D
 * Gaussian factors exactly this way) normalized so they sum to `1`. A
 * non-positive sigma on an axis collapses that axis's kernel to a single
 * `0` tap (no blur on that axis) rather than a division by zero.
 */
export const buildGaussianBlurKernel = (
	sigmaX: number,
	sigmaY: number,
	tapBudget: number,
): BlurKernelPlan => {
	const idealHalfX = sigmaX > 0 ? Math.ceil(GAUSSIAN_SIGMA_REACH * sigmaX) : 0;
	const idealHalfY = sigmaY > 0 ? Math.ceil(GAUSSIAN_SIGMA_REACH * sigmaY) : 0;
	let halfX = idealHalfX;
	let halfY = idealHalfY;
	const budget = Math.max(1, Math.floor(tapBudget));
	const totalTaps = (hx: number, hy: number): number =>
		(2 * hx + 1) * (2 * hy + 1);
	while (totalTaps(halfX, halfY) > budget && (halfX > 0 || halfY > 0)) {
		if (halfX >= halfY && halfX > 0) halfX -= 1;
		else if (halfY > 0) halfY -= 1;
		else break;
	}
	const reduced = halfX < idealHalfX || halfY < idealHalfY;
	const rawTaps: BlurKernelTap[] = [];
	let sum = 0;
	for (let dy = -halfY; dy <= halfY; dy += 1) {
		for (let dx = -halfX; dx <= halfX; dx += 1) {
			const weight = gaussian1d(dx, sigmaX) * gaussian1d(dy, sigmaY);
			rawTaps.push({ dx, dy, weight });
			sum += weight;
		}
	}
	const taps =
		sum > 0
			? rawTaps.map((tap) => ({ ...tap, weight: tap.weight / sum }))
			: rawTaps.map((tap) => ({
					...tap,
					weight: tap.dx === 0 && tap.dy === 0 ? 1 : 0,
				}));
	return { taps, reduced };
};
