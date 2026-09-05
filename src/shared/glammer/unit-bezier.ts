// Vendored from motion-grammar-lab/packages/motion-grammar/src/unit-bezier.ts.
// Keep this module standalone: no DOM, renderer, React, or Worker runtime imports.

// Canonical unit cubic-bezier easing solver — y at parametric x for a cubic bezier whose
// implicit endpoints are (0,0) and (1,1) with control points (p1x,p1y),(p2x,p2y).
//
// This is the single source for what was, until 2026-06-08, copy-pasted into 15 sites:
// 2 here in this package (offset-stagger-conveyor, pulse-grid) and 13 puttimw drawer verbs.
// Every prior copy was algebraically identical — the standard 3(1-t)²t·P1 + 3(1-t)t²·P2 + t³
// solved by bisecting x(t) — and differed only in float-op spelling, iteration count (40 vs a
// lone 60 in the difference cell) and the out-of-domain handling (early-return guard vs clamp).
// This canonical uses 40-iter bisection + the endpoint guard; it reproduces every prior copy to
// ≤3e-9 in y on realistic eases (bit-identical to the 40-iter+guard copies). Equivalence is
// proven by a dense numeric sweep and by check:motion-drawers-parity staying green.
//
// Promotion note: this is an *extraction* of a primitive the package already owned (two private
// copies), not a fresh promotion of single-study code — so it is clean under the second-consumer
// rule (the package itself + the study both consume it).

/** Cubic-bezier control points [p1x, p1y, p2x, p2y] for callers that carry them as a tuple. */
export type UnitBezier = [number, number, number, number];

/** y at parametric x along the cubic bezier (0,0)→(p1)→(p2)→(1,1). x is clamped to [0,1]. */
export const unitBezierY = (
	p1x: number,
	p1y: number,
	p2x: number,
	p2y: number,
	x: number,
): number => {
	if (x <= 0) return 0;
	if (x >= 1) return 1;
	let lo = 0;
	let hi = 1;
	for (let i = 0; i < 40; i += 1) {
		const mid = (lo + hi) / 2;
		const omt = 1 - mid;
		const bx = 3 * omt * omt * mid * p1x + 3 * omt * mid * mid * p2x + mid ** 3;
		if (bx < x) lo = mid;
		else hi = mid;
	}
	const t = (lo + hi) / 2;
	const omt = 1 - t;
	return 3 * omt * omt * t * p1y + 3 * omt * t * t * p2y + t ** 3;
};
