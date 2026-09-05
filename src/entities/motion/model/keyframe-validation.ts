import type {
	BezierShape,
	LinearGradientPaint,
	MeshGradientPaint,
	RadialGradientPaint,
} from "@/entities/scene/model/types";
import {
	type AePoint,
	haveSameAeShapeTopology,
	isAeShape,
} from "@/shared/glammer/ae-shape";
import type { AeKeyframe } from "@/shared/glammer/keyframe-track";
import type {
	AnimatableProperty,
	AnimatableValue,
	KeyframeTrack,
} from "./types";

export const KEYFRAME_VALUE_VALIDATION_ISSUES = [
	"scalar-non-finite",
	"path-shape-invalid",
	"path-shape-topology-mismatch",
	"mesh-invalid",
	"gradient-invalid",
] as const;

export type KeyframeValueValidationIssue =
	(typeof KEYFRAME_VALUE_VALIDATION_ISSUES)[number];

export type KeyframeValueValidation =
	| { readonly valid: true }
	| {
			readonly valid: false;
			readonly reason: KeyframeValueValidationIssue;
	  };

const isFinitePoint = (value: unknown): value is AePoint =>
	Array.isArray(value) &&
	value.length === 2 &&
	Number.isFinite(value[0]) &&
	Number.isFinite(value[1]);

const hasFinitePoints = (
	points: readonly unknown[],
	pointCount: number,
): boolean => {
	if (points.length !== pointCount) return false;
	for (let index = 0; index < pointCount; index += 1) {
		if (!(index in points) || !isFinitePoint(points[index])) return false;
	}
	return true;
};

/**
 * Runtime guard for authored path-shape keys. Shape morphing only has a stable
 * sampler contract when all three point arrays are aligned and finite.
 */
export function isValidPathShape(value: unknown): value is BezierShape {
	if (!isAeShape(value) || typeof value.closed !== "boolean") return false;
	const pointCount = value.vertices.length;
	if (
		pointCount === 0 ||
		value.inTangents.length !== pointCount ||
		value.outTangents.length !== pointCount
	) {
		return false;
	}
	return (
		hasFinitePoints(value.vertices, pointCount) &&
		hasFinitePoints(value.inTangents, pointCount) &&
		hasFinitePoints(value.outTangents, pointCount)
	);
}

/** True when two path-shape keys can tween without falling back to hold behavior. */
export function haveCompatiblePathShapeTopology(
	left: BezierShape,
	right: BezierShape,
): boolean {
	return left.closed === right.closed && haveSameAeShapeTopology([left, right]);
}

/**
 * Runtime guard for authored mesh-paint keys. A mesh snapshot only has a stable
 * sampler contract when its point grid matches its declared dimensions; topology
 * mismatch *between* keys is not invalid (it holds at sample time), so it is not
 * checked here.
 */
export function isValidMeshValue(value: unknown): value is MeshGradientPaint {
	if (typeof value !== "object" || value === null) return false;
	const mesh = value as Partial<MeshGradientPaint>;
	return (
		mesh.kind === "mesh-gradient" &&
		typeof mesh.rows === "number" &&
		typeof mesh.cols === "number" &&
		mesh.rows >= 2 &&
		mesh.cols >= 2 &&
		Array.isArray(mesh.points) &&
		mesh.points.length === mesh.rows * mesh.cols
	);
}

/**
 * Runtime guard for authored gradient-fill keys. A snapshot only has a stable
 * sampler contract when it is a linear/radial gradient with at least two stops;
 * kind/stop-count mismatch *between* keys is not invalid (the interpolator
 * reconciles or holds at sample time), so it is not checked here.
 */
export function isValidGradientValue(
	value: unknown,
): value is LinearGradientPaint | RadialGradientPaint {
	if (typeof value !== "object" || value === null) return false;
	const paint = value as { readonly kind?: unknown; readonly stops?: unknown };
	return (
		(paint.kind === "linear-gradient" || paint.kind === "radial-gradient") &&
		Array.isArray(paint.stops) &&
		paint.stops.length >= 2
	);
}

const isShapeKeyframe = (
	keyframe: AeKeyframe<AnimatableValue>,
): keyframe is AeKeyframe<BezierShape> => isValidPathShape(keyframe.value);

const referenceShapeForTrack = (
	track: KeyframeTrack | undefined,
	frame: number,
): BezierShape | undefined => {
	if (track?.target.property !== "pathShape") return undefined;
	const keyframe = track.keyframes.find(
		(item): item is AeKeyframe<BezierShape> =>
			item.time !== frame && isShapeKeyframe(item),
	);
	return keyframe?.value;
};

/**
 * Validates a keyframe value before a command mutates the side-car document. This
 * keeps scalar channels numeric and path-shape channels tweenable, avoiding
 * dirty tracks that the sampler would otherwise silently ignore or hold.
 */
export function validateKeyframeValue({
	property,
	value,
	track,
	frame,
}: {
	readonly property: AnimatableProperty;
	readonly value: AnimatableValue;
	readonly track?: KeyframeTrack;
	readonly frame: number;
}): KeyframeValueValidation {
	if (property === "meshPaint") {
		return isValidMeshValue(value)
			? { valid: true }
			: { valid: false, reason: "mesh-invalid" };
	}
	if (property === "fillGradient") {
		return isValidGradientValue(value)
			? { valid: true }
			: { valid: false, reason: "gradient-invalid" };
	}
	if (property !== "pathShape") {
		return typeof value === "number" && Number.isFinite(value)
			? { valid: true }
			: { valid: false, reason: "scalar-non-finite" };
	}
	if (!isValidPathShape(value)) {
		return { valid: false, reason: "path-shape-invalid" };
	}
	const reference = referenceShapeForTrack(track, frame);
	if (reference && !haveCompatiblePathShapeTopology(reference, value)) {
		return { valid: false, reason: "path-shape-topology-mismatch" };
	}
	return { valid: true };
}
