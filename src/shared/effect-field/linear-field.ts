import type { EffectFieldBounds, EffectFieldVec2 } from "./mesh-scene";

/** Full-bounds axis used by directional scalar fields and gradient-tool handles. */
export type LinearEffectFieldAxis = {
	/** Degrees in screen-space convention: 0 = right, positive = clockwise. */
	readonly angle: number;
	readonly center: EffectFieldVec2;
	readonly from: EffectFieldVec2;
	readonly to: EffectFieldVec2;
	readonly direction: EffectFieldVec2;
	readonly halfSpan: number;
};

/** Ellipse geometry for circular/radial scalar fields inside effect bounds. */
export type RadialEffectFieldGeometry = {
	readonly center: EffectFieldVec2;
	readonly radiusX: number;
	readonly radiusY: number;
};

const MIN_FIELD_LENGTH = 1e-6;
const FULL_TURN_DEGREES = 360;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const normalizeAngle = (angle: number): number =>
	((angle % FULL_TURN_DEGREES) + FULL_TURN_DEGREES) % FULL_TURN_DEGREES;

/**
 * Computes the full-bounds axis for a directional scalar field. The returned
 * segment spans the rectangle far enough that a 0-to-1 ramp covers the entire
 * effect bounds at any angle.
 */
export function linearEffectFieldAxis(
	bounds: EffectFieldBounds,
	angle: number,
): LinearEffectFieldAxis {
	const width = Math.max(bounds.width, MIN_FIELD_LENGTH);
	const height = Math.max(bounds.height, MIN_FIELD_LENGTH);
	const center = {
		x: bounds.x + bounds.width / 2,
		y: bounds.y + bounds.height / 2,
	};
	const normalizedAngle = normalizeAngle(angle);
	const radians = (normalizedAngle * Math.PI) / 180;
	const direction = { x: Math.cos(radians), y: Math.sin(radians) };
	const halfSpan =
		Math.max(
			Math.abs(direction.x) * width + Math.abs(direction.y) * height,
			MIN_FIELD_LENGTH,
		) / 2;
	return {
		angle: normalizedAngle,
		center,
		from: {
			x: center.x - direction.x * halfSpan,
			y: center.y - direction.y * halfSpan,
		},
		to: {
			x: center.x + direction.x * halfSpan,
			y: center.y + direction.y * halfSpan,
		},
		direction,
		halfSpan,
	};
}

/**
 * Computes ellipse geometry for circular/radial scalar fields using normalized
 * center and radius controls. This is intentionally value-agnostic; individual
 * effects decide whether radius means blur strength, reveal reach, grain density,
 * or another scalar.
 */
export function radialEffectFieldGeometry(
	bounds: EffectFieldBounds,
	options: {
		readonly center?: EffectFieldVec2;
		readonly radius?: number;
	} = {},
): RadialEffectFieldGeometry {
	const center = options.center ?? { x: 0.5, y: 0.5 };
	const radius = clamp01(options.radius ?? 0.5);
	return {
		center: {
			x: bounds.x + clamp01(center.x) * bounds.width,
			y: bounds.y + clamp01(center.y) * bounds.height,
		},
		radiusX: Math.max(bounds.width * radius, MIN_FIELD_LENGTH),
		radiusY: Math.max(bounds.height * radius, MIN_FIELD_LENGTH),
	};
}
