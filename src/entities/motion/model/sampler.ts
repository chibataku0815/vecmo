import { resolveCornerRadii } from "@/entities/scene/model/corner-geometry";
import {
	type GradientPaint,
	interpolateGradient,
} from "@/entities/scene/model/gradient-edit";
import {
	type LookGraphOwnerRef,
	sameLookGraphOwner,
} from "@/entities/scene/model/look-graph";
import { interpolateMesh } from "@/entities/scene/model/mesh-edit";
import type { SourceOpticsParameterTarget } from "@/entities/scene/model/source-optics";
import type {
	BezierShape,
	CornerRadii,
	MeshGradientPaint,
	Transform,
	VectorNode,
} from "@/entities/scene/model/types";
import {
	type AePoint,
	haveSameAeShapeTopology,
} from "@/shared/glammer/ae-shape";
import {
	type AeKeyframe,
	sampleKeyframeTrack,
} from "@/shared/glammer/keyframe-track";
import {
	isValidGradientValue,
	isValidMeshValue,
	isValidPathShape,
} from "./keyframe-validation";
import { samplePositionPath } from "./position-path";
import {
	getMotionSamplingPlan,
	indexedTrack,
	sampleIndexedNumericTrack,
} from "./sampling-plan";
import type {
	AnimatableProperty,
	KeyframeTrack,
	MotionDocument,
} from "./types";

/**
 * Evaluates the side-car {@link MotionDocument} against the scene graph. The scene
 * node carries the rest pose; a keyframe track, when present for a property,
 * overrides that property at the sampled frame. Geometry stays the source of
 * truth — this module is a read-only adapter, never a writer.
 *
 * Units: frames. Callers pass the playhead frame (may be fractional during rAF
 * playback); keyframe times are whole frames.
 */

const SCALAR_PROPERTIES = [
	"x",
	"y",
	"anchorX",
	"anchorY",
	"rotation",
	"scaleX",
	"scaleY",
	"cornerRadius",
	"cornerRadiusTL",
	"cornerRadiusTR",
	"cornerRadiusBR",
	"cornerRadiusBL",
	"cornerSmoothing",
] as const satisfies readonly AnimatableProperty[];

export function findTrack(
	motion: MotionDocument,
	nodeId: string,
	property: AnimatableProperty,
): KeyframeTrack | undefined {
	return indexedTrack(motion, nodeId, property);
}

/** True when the node has at least one non-empty track and so needs sampling. */
export function isNodeAnimated(
	motion: MotionDocument,
	nodeId: string,
): boolean {
	return getMotionSamplingPlan(motion).animatedNodeIdSet.has(nodeId);
}

/** Distinct node ids that the playback driver must drive at the current frame. */
export function animatedNodeIds(motion: MotionDocument): readonly string[] {
	return getMotionSamplingPlan(motion).animatedNodeIds;
}

const sampleScalar = (
	motion: MotionDocument,
	nodeId: string,
	property: AnimatableProperty,
	base: number,
	frame: number,
): number => {
	const track = findTrack(motion, nodeId, property);
	if (!track || track.keyframes.length === 0) return base;
	return sampleIndexedNumericTrack(motion, track, frame) ?? base;
};

/**
 * Samples one Look-graph node param from the side-car `lookNodeTracks` at a frame,
 * returning `base` when no track drives it. The value is RAW (unclamped) — the Look
 * graph compiler re-normalizes it — mirroring {@link effectiveCornerRadius}. This is
 * the read side of the Look-node animation side-car; the override is applied to the
 * sampled scene's frame look graph in `presentation.ts`.
 */
export function effectiveLookNodeParam(
	motion: MotionDocument,
	owner: LookGraphOwnerRef,
	lookNodeId: string,
	paramKey: string,
	base: number,
	frame: number,
): number {
	const track = motion.lookNodeTracks?.find(
		(candidate) =>
			candidate.target.lookNodeId === lookNodeId &&
			candidate.target.paramKey === paramKey &&
			sameLookGraphOwner(candidate.target.owner, owner),
	);
	if (!track || track.keyframes.length === 0) return base;
	const keyframes = track.keyframes.filter(
		(keyframe) =>
			Number.isFinite(keyframe.time) && Number.isFinite(keyframe.value),
	);
	if (keyframes.length === 0) return base;
	return sampleKeyframeTrack(keyframes, frame);
}

const sameSourceOpticsTarget = (
	left: SourceOpticsParameterTarget,
	right: SourceOpticsParameterTarget,
): boolean => {
	if (
		left.kind !== right.kind ||
		left.artboardId !== right.artboardId ||
		left.rigId !== right.rigId ||
		left.parameterId !== right.parameterId
	) {
		return false;
	}
	if (left.kind === "ray" && right.kind === "ray") {
		return left.rayId === right.rayId;
	}
	if (left.kind === "binding" && right.kind === "binding") {
		return left.bindingId === right.bindingId;
	}
	return left.kind === "rig" && right.kind === "rig";
};

/** Samples one numeric Source Optics side-car track over its static base value. */
export function effectiveSourceOpticsParameter(
	motion: MotionDocument,
	target: SourceOpticsParameterTarget,
	base: number,
	frame: number,
): number {
	const track = motion.sourceOpticsTracks?.find((candidate) =>
		sameSourceOpticsTarget(candidate.target, target),
	);
	if (!track || track.keyframes.length === 0) return base;
	const keyframes = track.keyframes.filter(
		(keyframe) =>
			Number.isFinite(keyframe.time) && Number.isFinite(keyframe.value),
	);
	return keyframes.length > 0 ? sampleKeyframeTrack(keyframes, frame) : base;
}

/**
 * Builds the node transform at a frame by overriding each animated scalar channel
 * over the node's rest transform. Anchor tracks are sampled as first-class pivot
 * channels so rotation/scale can intentionally orbit an animated local point.
 */
export function effectiveTransform(
	node: VectorNode,
	motion: MotionDocument,
	frame: number,
): Transform {
	const { transform } = node;
	const spatialPosition = samplePositionPath(motion, node.id, frame)?.position;
	return {
		position: spatialPosition ?? {
			x: sampleScalar(motion, node.id, "x", transform.position.x, frame),
			y: sampleScalar(motion, node.id, "y", transform.position.y, frame),
		},
		rotation: sampleScalar(
			motion,
			node.id,
			"rotation",
			transform.rotation,
			frame,
		),
		scale: {
			x: sampleScalar(motion, node.id, "scaleX", transform.scale.x, frame),
			y: sampleScalar(motion, node.id, "scaleY", transform.scale.y, frame),
		},
		anchor: {
			x: sampleScalar(motion, node.id, "anchorX", transform.anchor.x, frame),
			y: sampleScalar(motion, node.id, "anchorY", transform.anchor.y, frame),
		},
	};
}

export function effectiveOpacity(
	node: VectorNode,
	motion: MotionDocument,
	frame: number,
): number {
	return sampleScalar(motion, node.id, "opacity", node.style.opacity, frame);
}

/**
 * Samples a roundable primitive's uniform corner radius at a frame. The value is
 * RAW (unclamped) — size clamping happens at render time so an animated/shrinking
 * shape never sticks at the pill radius. Returns `undefined` for kinds that carry
 * no corner radius, so callers can preserve the geometry reference unchanged.
 */
export function effectiveCornerRadius(
	node: VectorNode,
	motion: MotionDocument,
	frame: number,
): number | undefined {
	const { geometry } = node;
	if (
		geometry.kind !== "rect" &&
		geometry.kind !== "star" &&
		geometry.kind !== "polygon"
	) {
		return undefined;
	}
	const base = geometry.cornerRadius ?? 0;
	return sampleScalar(motion, node.id, "cornerRadius", base, frame);
}

/**
 * Samples a rect's four per-corner radii at a frame (RAW). Precedence per corner:
 * a per-corner channel overrides the uniform `cornerRadius` channel, which in turn
 * overrides the rest geometry. Returns `undefined` for non-rect kinds.
 */
export function effectiveCornerRadii(
	node: VectorNode,
	motion: MotionDocument,
	frame: number,
): CornerRadii | undefined {
	const { geometry } = node;
	if (geometry.kind !== "rect") return undefined;
	const base = resolveCornerRadii(geometry);
	const uniformTrack = findTrack(motion, node.id, "cornerRadius");
	const uniformValue =
		uniformTrack && uniformTrack.keyframes.length > 0
			? sampleScalar(
					motion,
					node.id,
					"cornerRadius",
					geometry.cornerRadius,
					frame,
				)
			: undefined;
	const corner = (
		key: keyof CornerRadii,
		property: AnimatableProperty,
	): number => {
		const track = findTrack(motion, node.id, property);
		if (track && track.keyframes.length > 0) {
			return sampleScalar(motion, node.id, property, base[key], frame);
		}
		return uniformValue ?? base[key];
	};
	return {
		tl: corner("tl", "cornerRadiusTL"),
		tr: corner("tr", "cornerRadiusTR"),
		br: corner("br", "cornerRadiusBR"),
		bl: corner("bl", "cornerRadiusBL"),
	};
}

/**
 * Samples whole-shape corner smoothing (squircle, 0..1) at a frame for a roundable
 * primitive. Returns `undefined` for kinds that carry no smoothing.
 */
export function effectiveCornerSmoothing(
	node: VectorNode,
	motion: MotionDocument,
	frame: number,
): number | undefined {
	const { geometry } = node;
	if (
		geometry.kind !== "rect" &&
		geometry.kind !== "star" &&
		geometry.kind !== "polygon"
	) {
		return undefined;
	}
	const base = geometry.cornerSmoothing ?? 0;
	return sampleScalar(motion, node.id, "cornerSmoothing", base, frame);
}

const lerpPoint = (from: AePoint, to: AePoint, t: number): AePoint => [
	from[0] + (to[0] - from[0]) * t,
	from[1] + (to[1] - from[1]) * t,
];

const cloneShape = (shape: BezierShape): BezierShape => ({
	type: "Shape",
	closed: shape.closed,
	vertices: shape.vertices.map((point) => [...point]),
	inTangents: shape.inTangents.map((point) => [...point]),
	outTangents: shape.outTangents.map((point) => [...point]),
});

/**
 * Interpolates two bezier shapes vertex-for-vertex. Shapes with mismatched
 * topology — differing vertex count or open/closed state — cannot be tweened, so
 * the result holds the `from` key until the next key is reached, the same
 * hold-on-previous-key rule the scalar HOLD interpolation uses.
 */
export function interpolateShape(
	from: BezierShape,
	to: BezierShape,
	t: number,
): BezierShape {
	if (!haveSameAeShapeTopology([from, to]) || from.closed !== to.closed) {
		return cloneShape(t >= 1 ? to : from);
	}
	return {
		type: "Shape",
		closed: from.closed,
		vertices: from.vertices.map((point, index) =>
			lerpPoint(point, to.vertices[index], t),
		),
		inTangents: from.inTangents.map((point, index) =>
			lerpPoint(point, to.inTangents[index], t),
		),
		outTangents: from.outTangents.map((point, index) =>
			lerpPoint(point, to.outTangents[index], t),
		),
	};
}

const toShapeKeyframes = (track: KeyframeTrack): AeKeyframe<BezierShape>[] =>
	track.keyframes.filter(
		(keyframe): keyframe is AeKeyframe<BezierShape> =>
			Number.isFinite(keyframe.time) && isValidPathShape(keyframe.value),
	);

type KeyframePair<V> = {
	readonly from: AeKeyframe<V>;
	readonly to: AeKeyframe<V>;
};

/**
 * Brackets `frame` to the surrounding keyframe pair (or a single held key at the
 * ends). Value-agnostic, so snapshot tracks (path shape, mesh paint) share one
 * bracketing rule.
 */
const findKeyframePair = <V>(
	keyframes: readonly AeKeyframe<V>[],
	frame: number,
): KeyframePair<V> | null => {
	if (keyframes.length === 0) return null;
	const first = keyframes[0];
	if (frame <= first.time) return { from: first, to: first };
	const last = keyframes[keyframes.length - 1];
	if (frame >= last.time) return { from: last, to: last };
	for (let index = 0; index < keyframes.length - 1; index += 1) {
		const from = keyframes[index];
		const to = keyframes[index + 1];
		if (frame >= from.time && frame < to.time) return { from, to };
	}
	return null;
};

// Reuses the frozen scalar sampler to recover the eased 0..1 fraction for a
// segment, so snapshot tweens honor the exact same temporal ease as scalar tracks.
const easeProbe = <V>(
	keyframe: AeKeyframe<V>,
	value: number,
): AeKeyframe<number> => ({
	time: keyframe.time,
	value,
	inInterpolationType: keyframe.inInterpolationType,
	outInterpolationType: keyframe.outInterpolationType,
	inTemporalEase: keyframe.inTemporalEase,
	outTemporalEase: keyframe.outTemporalEase,
});

/**
 * Returns the animated path shape at a frame, or `undefined` when the node is not
 * a path or has no shape track (the renderer then keeps the node's base shape).
 */
export function effectiveShape(
	node: VectorNode,
	motion: MotionDocument,
	frame: number,
): BezierShape | undefined {
	if (node.geometry.kind !== "path") return undefined;
	const track = findTrack(motion, node.id, "pathShape");
	if (!track) return undefined;
	const keyframes = toShapeKeyframes(track);
	const pair = findKeyframePair(keyframes, frame);
	if (!pair) return undefined;
	if (pair.from === pair.to) return cloneShape(pair.from.value);
	const fraction = sampleKeyframeTrack(
		[easeProbe(pair.from, 0), easeProbe(pair.to, 1)],
		frame,
	);
	return interpolateShape(pair.from.value, pair.to.value, fraction);
}

const toMeshKeyframes = (
	track: KeyframeTrack,
): AeKeyframe<MeshGradientPaint>[] =>
	track.keyframes.filter(
		(keyframe): keyframe is AeKeyframe<MeshGradientPaint> =>
			Number.isFinite(keyframe.time) && isValidMeshValue(keyframe.value),
	);

/**
 * Returns the animated mesh-gradient paint at a frame, or `undefined` when the
 * node's primary fill is not a mesh or has no mesh track (the renderer then keeps
 * the node's base mesh). Mirrors {@link effectiveShape}: the eased 0..1 fraction
 * comes from the scalar sampler and the value is tweened by {@link interpolateMesh}
 * (never the numeric lerp), holding on topology mismatch.
 */
export function effectiveMesh(
	node: VectorNode,
	motion: MotionDocument,
	frame: number,
): MeshGradientPaint | undefined {
	if (node.style.fills?.[0]?.kind !== "mesh-gradient") return undefined;
	const track = findTrack(motion, node.id, "meshPaint");
	if (!track) return undefined;
	const keyframes = toMeshKeyframes(track);
	const pair = findKeyframePair(keyframes, frame);
	if (!pair) return undefined;
	if (pair.from === pair.to) return pair.from.value;
	const fraction = sampleKeyframeTrack(
		[easeProbe(pair.from, 0), easeProbe(pair.to, 1)],
		frame,
	);
	return interpolateMesh(pair.from.value, pair.to.value, fraction);
}

const toGradientKeyframes = (
	track: KeyframeTrack,
): AeKeyframe<GradientPaint>[] =>
	track.keyframes.filter(
		(keyframe): keyframe is AeKeyframe<GradientPaint> =>
			Number.isFinite(keyframe.time) && isValidGradientValue(keyframe.value),
	);

/**
 * Returns the animated linear/radial gradient fill at a frame, or `undefined` when
 * the node's primary fill is not such a gradient or has no `fillGradient` track (the
 * renderer then keeps the node's base gradient). Mirrors {@link effectiveMesh}: the
 * eased 0..1 fraction comes from the scalar sampler and the value is tweened by
 * {@link interpolateGradient} (never the numeric lerp), holding on shape mismatch.
 */
export function effectiveFillGradient(
	node: VectorNode,
	motion: MotionDocument,
	frame: number,
): GradientPaint | undefined {
	const base = node.style.fills?.[0];
	if (base?.kind !== "linear-gradient" && base?.kind !== "radial-gradient") {
		return undefined;
	}
	const track = findTrack(motion, node.id, "fillGradient");
	if (!track) return undefined;
	const keyframes = toGradientKeyframes(track);
	const pair = findKeyframePair(keyframes, frame);
	if (!pair) return undefined;
	if (pair.from === pair.to) return pair.from.value;
	const fraction = sampleKeyframeTrack(
		[easeProbe(pair.from, 0), easeProbe(pair.to, 1)],
		frame,
	);
	return interpolateGradient(pair.from.value, pair.to.value, fraction);
}

export { SCALAR_PROPERTIES };
