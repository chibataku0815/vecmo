import type { BezierShape, VectorNode } from "@/entities/scene/model/types";
import { effectiveShape } from "./sampler";
import type { MotionDocument } from "./types";

/**
 * Creates an independent path-shape value for motion authoring. Path keyframes
 * must never share point arrays with scene geometry or with another keyframe,
 * because later vector editing will mutate those arrays through command patches.
 */
export function clonePathShape(shape: BezierShape): BezierShape {
	return {
		type: "Shape",
		closed: shape.closed,
		vertices: shape.vertices.map((point) => [point[0], point[1]]),
		inTangents: shape.inTangents.map((point) => [point[0], point[1]]),
		outTangents: shape.outTangents.map((point) => [point[0], point[1]]),
	};
}

/**
 * Reads the path shape visible at an authored frame without mutating the scene.
 * If the node has an active path-shape track, the sampled morph is returned;
 * otherwise the node's rest geometry is cloned as the first authored key.
 */
export function pathShapeAtFrame(
	node: VectorNode,
	motion: MotionDocument,
	frame: number,
): BezierShape | null {
	if (node.geometry.kind !== "path") return null;
	return (
		effectiveShape(node, motion, frame) ?? clonePathShape(node.geometry.shape)
	);
}
