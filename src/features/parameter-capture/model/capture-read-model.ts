import {
	effectiveOpacity,
	effectiveTransform,
	findTrack,
} from "@/entities/motion/model/sampler";
import type {
	AnimatableProperty,
	MotionDocument,
} from "@/entities/motion/model/types";
import type { VectorNode } from "@/entities/scene/model/types";

/**
 * One filmed parameter row. `emphasis` is derived from motion state and lets the
 * HUD promote keyed/animated values without teaching the UI about track shape.
 */
export type ParameterCaptureRow = {
	readonly id: string;
	readonly label: string;
	readonly value: number;
	readonly displayValue: string;
	readonly deltaDisplay: string | null;
	readonly unit: string;
	readonly animated: boolean;
	readonly keyedAtFrame: boolean;
	readonly emphasis: "keyed" | "animated" | "changed" | "rest";
};

/**
 * Read-only snapshot of the selected node for Capture Mode. This is editor UI
 * presentation data only; scene and motion documents remain the source of truth.
 */
export type ParameterCaptureTarget = {
	readonly nodeId: string;
	readonly nodeName: string;
	readonly nodeKindLabel: string;
	readonly frame: number;
	readonly rows: readonly ParameterCaptureRow[];
	readonly activeRowCount: number;
};

type CaptureMetricSpec = {
	readonly id: string;
	readonly label: string;
	readonly property: AnimatableProperty;
	readonly unit: string;
	readonly value: (
		node: VectorNode,
		motion: MotionDocument,
		frame: number,
	) => number;
	readonly base: (node: VectorNode) => number;
	readonly scale?: number;
};

const CAPTURE_METRICS: readonly CaptureMetricSpec[] = [
	{
		id: "x",
		label: "X",
		property: "x",
		unit: "px",
		value: (node, motion, frame) =>
			effectiveTransform(node, motion, frame).position.x,
		base: (node) => node.transform.position.x,
	},
	{
		id: "y",
		label: "Y",
		property: "y",
		unit: "px",
		value: (node, motion, frame) =>
			effectiveTransform(node, motion, frame).position.y,
		base: (node) => node.transform.position.y,
	},
	{
		id: "rotation",
		label: "Rotation",
		property: "rotation",
		unit: "deg",
		value: (node, motion, frame) =>
			effectiveTransform(node, motion, frame).rotation,
		base: (node) => node.transform.rotation,
	},
	{
		id: "scale-x",
		label: "Scale X",
		property: "scaleX",
		unit: "%",
		value: (node, motion, frame) =>
			effectiveTransform(node, motion, frame).scale.x,
		base: (node) => node.transform.scale.x,
		scale: 100,
	},
	{
		id: "scale-y",
		label: "Scale Y",
		property: "scaleY",
		unit: "%",
		value: (node, motion, frame) =>
			effectiveTransform(node, motion, frame).scale.y,
		base: (node) => node.transform.scale.y,
		scale: 100,
	},
	{
		id: "opacity",
		label: "Opacity",
		property: "opacity",
		unit: "%",
		value: (node, motion, frame) => effectiveOpacity(node, motion, frame),
		base: (node) => node.style.opacity,
		scale: 100,
	},
	{
		id: "anchor-x",
		label: "Anchor X",
		property: "anchorX",
		unit: "px",
		value: (node, motion, frame) =>
			effectiveTransform(node, motion, frame).anchor.x,
		base: (node) => node.transform.anchor.x,
	},
	{
		id: "anchor-y",
		label: "Anchor Y",
		property: "anchorY",
		unit: "px",
		value: (node, motion, frame) =>
			effectiveTransform(node, motion, frame).anchor.y,
		base: (node) => node.transform.anchor.y,
	},
];

const nodeKindLabel = (node: VectorNode): string => {
	switch (node.geometry.kind) {
		case "rect":
			return node.frame ? "Frame" : "Rectangle";
		case "ellipse":
			return "Ellipse";
		case "line":
			return "Line";
		case "polygon":
			return "Polygon";
		case "star":
			return "Star";
		case "path":
			return "Path";
		case "text":
			return "Text";
		case "image":
			return "Image";
		default:
			return "Vector";
	}
};

const frameForCapture = (currentFrame: number): number =>
	Number.isFinite(currentFrame) ? Math.max(0, Math.round(currentFrame)) : 0;

const formatNumber = (value: number): string => {
	if (!Number.isFinite(value)) return "0";
	if (Number.isInteger(value)) return String(value);
	return String(Number(value.toFixed(2)));
};

const formatDelta = (delta: number, unit: string): string | null => {
	if (!Number.isFinite(delta) || Math.abs(delta) < 0.01) return null;
	const prefix = delta > 0 ? "+" : "";
	return `${prefix}${formatNumber(delta)}${unit}`;
};

const trackState = (
	motion: MotionDocument,
	nodeId: string,
	property: AnimatableProperty,
	frame: number,
): Pick<ParameterCaptureRow, "animated" | "keyedAtFrame"> => {
	const track = findTrack(motion, nodeId, property);
	const animated = (track?.keyframes.length ?? 0) > 0;
	const keyedAtFrame =
		track?.keyframes.some((keyframe) => keyframe.time === frame) ?? false;
	return { animated, keyedAtFrame };
};

const emphasisForRow = ({
	animated,
	keyedAtFrame,
	deltaDisplay,
}: Pick<
	ParameterCaptureRow,
	"animated" | "keyedAtFrame" | "deltaDisplay"
>): ParameterCaptureRow["emphasis"] => {
	if (keyedAtFrame) return "keyed";
	if (animated) return "animated";
	if (deltaDisplay) return "changed";
	return "rest";
};

/**
 * Builds the read-only parameter set shown by Capture Mode. Values are sampled
 * at the playhead from the motion side-car, while deltas compare against the
 * node's rest pose so marketing shots can show what is changing without opening
 * the full Inspector.
 */
export function buildParameterCaptureTarget({
	node,
	motion,
	currentFrame,
}: {
	readonly node: VectorNode;
	readonly motion: MotionDocument;
	readonly currentFrame: number;
}): ParameterCaptureTarget {
	const frame = frameForCapture(currentFrame);
	const rows = CAPTURE_METRICS.map((metric) => {
		const scale = metric.scale ?? 1;
		const value = metric.value(node, motion, frame) * scale;
		const base = metric.base(node) * scale;
		const deltaDisplay = formatDelta(value - base, metric.unit);
		const state = trackState(motion, node.id, metric.property, frame);
		return {
			id: metric.id,
			label: metric.label,
			value,
			displayValue: `${formatNumber(value)}${metric.unit}`,
			deltaDisplay,
			unit: metric.unit,
			...state,
			emphasis: emphasisForRow({ ...state, deltaDisplay }),
		} satisfies ParameterCaptureRow;
	});

	return {
		nodeId: node.id,
		nodeName: node.name,
		nodeKindLabel: nodeKindLabel(node),
		frame,
		rows,
		activeRowCount: rows.filter((row) => row.emphasis !== "rest").length,
	};
}
