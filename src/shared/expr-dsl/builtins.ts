/**
 * Frozen, deterministic builtin function table for the expression DSL.
 *
 * Every function is pure and uses only integer-stable or IEEE-754 arithmetic so
 * the editor evaluator and the bundled standalone runtime agree (this module is
 * bundled as-is into the exported runtime via `scripts/runtime-sampler-bundle.ts`).
 * `random` is a SEEDED integer hash (mulberry32 mixing step via {@link Math.imul},
 * which is byte-identical across V8/JSC), NEVER `Math.random`/`Date`, so a frame's
 * output is reproducible everywhere. `noise` is a seeded trilinear value-noise
 * field built from the same integer-lattice-hash mixing (never `Math.random`/
 * `Date`, never `sin`/`cos`), so it carries the identical byte-identical-across-
 * engines guarantee as `random`. Transcendental `sin`/`cos` MAY differ at ULP
 * between engines; that is the single documented non-byte-identical edge, accepted
 * for v1.
 */

import type { ExprFnName } from "./ast";

/**
 * Mulberry32 mixing step hashed from a (possibly fractional) seed to a unit float
 * in [0, 1). `Math.floor(seed) | 0` folds the seed into an int32 deterministically,
 * and every mix uses `Math.imul` so the bit pattern is identical across engines.
 */
const hashToUnit = (seed: number): number => {
	let t = (Math.floor(seed) | 0) + 0x6d2b79f5;
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const floorMod = (a: number, b: number): number =>
	b === 0 ? 0 : ((a % b) + b) % b;

const clampValue = (x: number, lo: number, hi: number): number =>
	Math.min(Math.max(x, lo), hi);

const smoothstep = (edge0: number, edge1: number, x: number): number => {
	const denom = edge1 - edge0;
	if (denom === 0) return x < edge0 ? 0 : 1;
	const t = clampValue((x - edge0) / denom, 0, 1);
	return t * t * (3 - 2 * t);
};

/**
 * Cubic fade curve `t*t*(3-2*t)` (the same polynomial `smoothstep` uses on its
 * already-clamped input). Applied to a lattice fractional coordinate, which is
 * always in [0, 1) by construction (see {@link noiseValue}), so no clamp is
 * needed here.
 */
const fade = (t: number): number => t * t * (3 - 2 * t);

/**
 * Hashes one integer lattice corner (`ix, iy, iz`) plus an integer-folded seed to
 * a unit float in [0, 1). Mixing uses ONLY `Math.imul`, xor, shift, and add on
 * operands that JS's bitwise operators coerce via the spec-mandated `ToInt32` —
 * never a plain `*` on the coordinates (which would round in the float64 domain
 * and could disagree across engines) — so the bit pattern is identical on every
 * ECMAScript-compliant engine (V8, JSC, ...), exactly the guarantee {@link
 * hashToUnit} makes for `random`. The final avalanche/projection steps reuse
 * `hashToUnit`'s own tail so both share one byte-identical code shape.
 */
const hashLatticeCorner = (
	ix: number,
	iy: number,
	iz: number,
	seedInt: number,
): number => {
	let h = (ix | 0) + 0x6d2b79f5;
	h = Math.imul(h ^ (iy | 0), 0x9e3779b1) | 0;
	h = Math.imul(h ^ (iz | 0), 0x85ebca77) | 0;
	h = Math.imul(h ^ seedInt, 0xc2b2ae3d) | 0;
	h = Math.imul(h ^ (h >>> 15), h | 1);
	h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
	return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
};

/**
 * Deterministic 3D value noise over the integer lattice in `x`, `y`, and `t`
 * (time), seeded. Each of the 8 surrounding lattice corners is hashed with
 * {@link hashLatticeCorner} (pure int32 mixing, never `Math.random`/`Date`/
 * `sin`/`cos`); the corners are blended by trilinear interpolation using only
 * `+`, `-`, `*` (IEEE-754-exact, byte-identical across engines by spec, unlike
 * `sin`/`cos`'s accepted ULP-drift edge) with a cubic {@link fade} easing the
 * fractional coordinate on each axis. `Math.floor(seed) | 0` folds a possibly
 * fractional seed into an int32 exactly like `hashToUnit` does, so two calls
 * with the same four inputs always agree in the editor, the exported runtime
 * sampler, and the WebGL runtime, on every engine. Output is always in [0, 1),
 * continuous, and reaches exact integer lattice values (0 offset on every
 * axis) at the corner hash itself.
 */
const noiseValue = (x: number, y: number, t: number, seed: number): number => {
	const seedInt = Math.floor(seed) | 0;
	const x0 = Math.floor(x);
	const y0 = Math.floor(y);
	const z0 = Math.floor(t);
	const x1 = x0 + 1;
	const y1 = y0 + 1;
	const z1 = z0 + 1;
	const fx = fade(x - x0);
	const fy = fade(y - y0);
	const fz = fade(t - z0);
	const c000 = hashLatticeCorner(x0, y0, z0, seedInt);
	const c100 = hashLatticeCorner(x1, y0, z0, seedInt);
	const c010 = hashLatticeCorner(x0, y1, z0, seedInt);
	const c110 = hashLatticeCorner(x1, y1, z0, seedInt);
	const c001 = hashLatticeCorner(x0, y0, z1, seedInt);
	const c101 = hashLatticeCorner(x1, y0, z1, seedInt);
	const c011 = hashLatticeCorner(x0, y1, z1, seedInt);
	const c111 = hashLatticeCorner(x1, y1, z1, seedInt);
	const x00 = c000 + (c100 - c000) * fx;
	const x10 = c010 + (c110 - c010) * fx;
	const x01 = c001 + (c101 - c001) * fx;
	const x11 = c011 + (c111 - c011) * fx;
	const y00 = x00 + (x10 - x00) * fy;
	const y11 = x01 + (x11 - x01) * fy;
	return y00 + (y11 - y00) * fz;
};

/**
 * Dispatches a whitelisted builtin by name. The parser has already validated arity,
 * so each branch reads the exact positional args it needs. Returns a raw number; the
 * evaluator applies the finite guard, so naive arithmetic here cannot leak `NaN`/
 * `Infinity` past a node boundary.
 */
export const applyBuiltin = (
	fn: ExprFnName,
	args: readonly number[],
): number => {
	switch (fn) {
		case "sin":
			return Math.sin(args[0] as number);
		case "cos":
			return Math.cos(args[0] as number);
		case "abs":
			return Math.abs(args[0] as number);
		case "floor":
			return Math.floor(args[0] as number);
		case "min":
			return Math.min(args[0] as number, args[1] as number);
		case "max":
			return Math.max(args[0] as number, args[1] as number);
		case "mod":
			return floorMod(args[0] as number, args[1] as number);
		case "clamp":
			return clampValue(
				args[0] as number,
				args[1] as number,
				args[2] as number,
			);
		case "lerp":
			return (
				(args[0] as number) +
				((args[1] as number) - (args[0] as number)) * (args[2] as number)
			);
		case "smoothstep":
			return smoothstep(
				args[0] as number,
				args[1] as number,
				args[2] as number,
			);
		case "random":
			return hashToUnit(args[0] as number);
		case "noise":
			return noiseValue(
				args[0] as number,
				args[1] as number,
				args[2] as number,
				args[3] as number,
			);
	}
};
