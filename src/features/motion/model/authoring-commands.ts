import type { MotionCommand } from "@/entities/motion/model/command";
import {
	snapMotionFrame,
	upsertKeyframe,
} from "@/entities/motion/model/commands";
import {
	isValidGradientValue,
	isValidMeshValue,
	isValidPathShape,
} from "@/entities/motion/model/keyframe-validation";
import { pathShapeAtFrame } from "@/entities/motion/model/path-shape";
import {
	effectiveCornerRadii,
	effectiveCornerRadius,
	effectiveCornerSmoothing,
	effectiveOpacity,
	effectiveTransform,
} from "@/entities/motion/model/sampler";
import type {
	AnimatableProperty,
	AnimatableValue,
	MotionDocument,
	ScalarAnimatableProperty,
} from "@/entities/motion/model/types";
import type { VectorNode } from "@/entities/scene/model/types";

export const MOTION_SCALAR_AUTHORING_PROPERTIES = [
	"x",
	"y",
	"anchorX",
	"anchorY",
	"rotation",
	"scaleX",
	"scaleY",
	"opacity",
	"cornerRadius",
	"cornerRadiusTL",
	"cornerRadiusTR",
	"cornerRadiusBR",
	"cornerRadiusBL",
	"cornerSmoothing",
] as const satisfies readonly ScalarAnimatableProperty[];

const PER_CORNER_AUTHORING_KEY = {
	cornerRadiusTL: "tl",
	cornerRadiusTR: "tr",
	cornerRadiusBR: "br",
	cornerRadiusBL: "bl",
} as const;

export type MotionScalarAuthoringProperty =
	(typeof MOTION_SCALAR_AUTHORING_PROPERTIES)[number];

/**
 * Resolves an authoring playhead to the same whole-frame, in-range grid used by
 * the MotionDocument command bus. Callers that treat non-finite frames as stale
 * input should guard before this helper; otherwise the command bus contract
 * snaps invalid frames to the first frame.
 */
export function motionAuthoringFrame(
	motion: MotionDocument,
	currentFrame: number,
): number {
	return snapMotionFrame(currentFrame, motion.durationFrames);
}

/**
 * Samples the scalar value a user currently sees for a node channel. This is the
 * shared bridge from presentation state back to authored keyframe values; it
 * never mutates the scene or motion document.
 */
export function sampledMotionScalarValue(
	node: VectorNode,
	motion: MotionDocument,
	frame: number,
	property: MotionScalarAuthoringProperty,
): number {
	if (property === "opacity") return effectiveOpacity(node, motion, frame);
	if (property === "cornerRadius") {
		return effectiveCornerRadius(node, motion, frame) ?? 0;
	}
	if (property === "cornerSmoothing") {
		return effectiveCornerSmoothing(node, motion, frame) ?? 0;
	}
	if (
		property === "cornerRadiusTL" ||
		property === "cornerRadiusTR" ||
		property === "cornerRadiusBR" ||
		property === "cornerRadiusBL"
	) {
		const radii = effectiveCornerRadii(node, motion, frame);
		return radii ? radii[PER_CORNER_AUTHORING_KEY[property]] : 0;
	}
	const transform = effectiveTransform(node, motion, frame);
	switch (property) {
		case "x":
			return transform.position.x;
		case "y":
			return transform.position.y;
		case "anchorX":
			return transform.anchor.x;
		case "anchorY":
			return transform.anchor.y;
		case "rotation":
			return transform.rotation;
		case "scaleX":
			return transform.scale.x;
		case "scaleY":
			return transform.scale.y;
	}
}

type MotionKeyframeCommandRequest = {
	readonly node: VectorNode;
	readonly motion: MotionDocument;
	readonly currentFrame: number;
	readonly property: AnimatableProperty;
	readonly value?: AnimatableValue;
};

const isScalarProperty = (
	property: AnimatableProperty,
): property is MotionScalarAuthoringProperty =>
	property !== "pathShape" &&
	property !== "meshPaint" &&
	property !== "fillGradient" &&
	MOTION_SCALAR_AUTHORING_PROPERTIES.includes(property);

/**
 * Creates the single command used by timeline, Inspector, key-pose, and
 * auto-key authoring. When no explicit value is supplied, the command snapshots
 * the sampled presentation value at the requested frame; explicit values are
 * still validated through the MotionDocument command path.
 */
export function createMotionKeyframeCommand({
	node,
	motion,
	currentFrame,
	property,
	value,
}: MotionKeyframeCommandRequest): MotionCommand | null {
	const frame = motionAuthoringFrame(motion, currentFrame);
	if (property === "pathShape") {
		if (value !== undefined) {
			return isValidPathShape(value)
				? upsertKeyframe(node.id, property, frame, value)
				: null;
		}
		const shape = pathShapeAtFrame(node, motion, frame);
		return shape ? upsertKeyframe(node.id, property, frame, shape) : null;
	}
	if (property === "meshPaint") {
		if (value !== undefined) {
			return isValidMeshValue(value)
				? upsertKeyframe(node.id, property, frame, value)
				: null;
		}
		// Snapshot the node's current mesh fill (the just-edited value, for the
		// auto-key/explicit-snapshot flow). Only a mesh-gradient primary fill keys.
		const mesh = node.style.fills?.[0];
		return mesh?.kind === "mesh-gradient"
			? upsertKeyframe(node.id, property, frame, mesh)
			: null;
	}
	if (property === "fillGradient") {
		if (value !== undefined) {
			return isValidGradientValue(value)
				? upsertKeyframe(node.id, property, frame, value)
				: null;
		}
		// Snapshot the node's current linear/radial gradient fill (the just-edited
		// value). Only a linear/radial-gradient primary fill keys; mesh/solid/image do not.
		const fill = node.style.fills?.[0];
		return fill?.kind === "linear-gradient" || fill?.kind === "radial-gradient"
			? upsertKeyframe(node.id, property, frame, fill)
			: null;
	}
	if (!isScalarProperty(property)) return null;
	// Corner channels are only meaningful on roundable primitives; never seed a
	// bogus track on ellipse/text/line/image (mirrors how pathShape only keys path
	// nodes). Per-corner radii are rect/frame-only; uniform radius + smoothing also
	// apply to star/polygon.
	const kind = node.geometry.kind;
	if (property === "cornerRadius" || property === "cornerSmoothing") {
		if (kind !== "rect" && kind !== "star" && kind !== "polygon") return null;
	}
	if (
		property === "cornerRadiusTL" ||
		property === "cornerRadiusTR" ||
		property === "cornerRadiusBR" ||
		property === "cornerRadiusBL"
	) {
		// Per-corner channels key only when the rect is actually in per-corner mode
		// (rest geometry carries cornerRadii); a uniform rect animates via the single
		// cornerRadius channel, so key-pose never seeds four redundant tracks.
		if (
			node.geometry.kind !== "rect" ||
			node.geometry.cornerRadii === undefined
		) {
			return null;
		}
	}
	const scalarValue =
		value === undefined
			? sampledMotionScalarValue(node, motion, frame, property)
			: value;
	if (typeof scalarValue !== "number" || !Number.isFinite(scalarValue)) {
		return null;
	}
	return upsertKeyframe(node.id, property, frame, scalarValue);
}
