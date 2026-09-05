import type { Matrix2D } from "@/entities/scene/model/rendering";

/** Point in artboard or node-local space, depending on the matrix applied. */
export type Point = {
	readonly x: number;
	readonly y: number;
};

export const IDENTITY: Matrix2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/**
 * Composes two SVG affine matrices so the result applies `inner` first and then
 * `outer` (i.e. `outer ∘ inner`). The scene uses the SVG convention
 * `x' = a·x + c·y + e`, `y' = b·x + d·y + f`, matching
 * {@link matrixFromTransform}, so transform gestures compose in the same space
 * the host renders in.
 */
export function multiply(outer: Matrix2D, inner: Matrix2D): Matrix2D {
	return {
		a: outer.a * inner.a + outer.c * inner.b,
		b: outer.b * inner.a + outer.d * inner.b,
		c: outer.a * inner.c + outer.c * inner.d,
		d: outer.b * inner.c + outer.d * inner.d,
		e: outer.a * inner.e + outer.c * inner.f + outer.e,
		f: outer.b * inner.e + outer.d * inner.f + outer.f,
	};
}

/** Maps a point through an affine matrix. */
export function applyToPoint(matrix: Matrix2D, point: Point): Point {
	return {
		x: matrix.a * point.x + matrix.c * point.y + matrix.e,
		y: matrix.b * point.x + matrix.d * point.y + matrix.f,
	};
}

/**
 * Inverts an affine matrix. Returns identity for a degenerate (zero
 * determinant) matrix so a collapsed selection cannot throw mid-gesture; the
 * caller already clamps scale away from zero.
 */
export function invert(matrix: Matrix2D): Matrix2D {
	const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
	if (determinant === 0) return IDENTITY;
	const inverse = 1 / determinant;
	return {
		a: matrix.d * inverse,
		b: -matrix.b * inverse,
		c: -matrix.c * inverse,
		d: matrix.a * inverse,
		e: (matrix.c * matrix.f - matrix.d * matrix.e) * inverse,
		f: (matrix.b * matrix.e - matrix.a * matrix.f) * inverse,
	};
}

export function translation(dx: number, dy: number): Matrix2D {
	return { a: 1, b: 0, c: 0, d: 1, e: dx, f: dy };
}

export function scaling(sx: number, sy: number): Matrix2D {
	return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
}

export function rotation(degrees: number): Matrix2D {
	const radians = (degrees * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

/** Scale about a pivot: `translate(p) · scale(sx,sy) · translate(-p)`. */
export function scaleAbout(pivot: Point, sx: number, sy: number): Matrix2D {
	return multiply(
		multiply(translation(pivot.x, pivot.y), scaling(sx, sy)),
		translation(-pivot.x, -pivot.y),
	);
}

/** Rotate about a pivot: `translate(p) · rotate(deg) · translate(-p)`. */
export function rotateAbout(pivot: Point, degrees: number): Matrix2D {
	return multiply(
		multiply(translation(pivot.x, pivot.y), rotation(degrees)),
		translation(-pivot.x, -pivot.y),
	);
}
