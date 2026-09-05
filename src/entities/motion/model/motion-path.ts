import type { VectorNode } from "@/entities/scene/model/types";
import { resolvePositionPath } from "./position-path";
import { effectiveTransform, findTrack } from "./sampler";
import type { MotionDocument } from "./types";

/**
 * A single authored stop along a node's spatial trajectory. `frame` is the frame
 * at which the x and/or y channel carries a key; `x`/`y` are the position the node
 * occupies there, sampled from the side-car so a channel without its own key at
 * that frame still contributes its interpolated coordinate. `hasX`/`hasY` record
 * which channels actually own a key at the frame, so UI can show half-authored
 * stops (only x or only y keyed) without inventing keys.
 */
export type MotionPathAnchor = {
	readonly frame: number;
	readonly x: number;
	readonly y: number;
	readonly hasX: boolean;
	readonly hasY: boolean;
	readonly inTangent?: { readonly x: number; readonly y: number };
	readonly outTangent?: { readonly x: number; readonly y: number };
	readonly spatialMode?: "corner" | "continuous" | "auto";
	readonly roving?: boolean;
};

/**
 * The spatial motion path a node traces through artboard space. `anchors` are the
 * authored stops in frame order; `polyline` is a denser sampled trace of the
 * curve between the first and last anchor, for drawing the path the way Figma /
 * After Effects render a motion path. Empty when the node has no position keys.
 */
export type MotionPath = {
	readonly nodeId: string;
	readonly anchors: readonly MotionPathAnchor[];
	readonly polyline: readonly { readonly x: number; readonly y: number }[];
};

const POSITION_CHANNELS = ["x", "y"] as const;

const DEFAULT_POLYLINE_STEP = 1;
const MIN_POLYLINE_STEP = 1;

const finiteFrames = (frames: Iterable<number>): number[] =>
	[...frames].filter((frame) => Number.isFinite(frame)).sort((a, b) => a - b);

/**
 * Collects the union of frames at which a node's `x` or `y` position channel owns
 * a keyframe. The two scalar tracks are authored independently, so a position
 * anchor exists wherever *either* channel has a key, not only where both do.
 */
export function positionAnchorFrames(
	node: VectorNode,
	motion: MotionDocument,
): readonly number[] {
	const frames = new Set<number>();
	for (const channel of POSITION_CHANNELS) {
		const track = findTrack(motion, node.id, channel);
		if (!track) continue;
		for (const keyframe of track.keyframes) {
			if (Number.isFinite(keyframe.time)) frames.add(keyframe.time);
		}
	}
	return finiteFrames(frames);
}

const channelHasKeyAtFrame = (
	node: VectorNode,
	motion: MotionDocument,
	channel: (typeof POSITION_CHANNELS)[number],
	frame: number,
): boolean => {
	const track = findTrack(motion, node.id, channel);
	return track?.keyframes.some((keyframe) => keyframe.time === frame) ?? false;
};

const anchorAtFrame = (
	node: VectorNode,
	motion: MotionDocument,
	frame: number,
): MotionPathAnchor => {
	const transform = effectiveTransform(node, motion, frame);
	return {
		frame,
		x: transform.position.x,
		y: transform.position.y,
		hasX: channelHasKeyAtFrame(node, motion, "x", frame),
		hasY: channelHasKeyAtFrame(node, motion, "y", frame),
	};
};

const clampStep = (step: number): number =>
	Number.isFinite(step) && step >= MIN_POLYLINE_STEP ? step : MIN_POLYLINE_STEP;

const samplePolyline = (
	node: VectorNode,
	motion: MotionDocument,
	startFrame: number,
	endFrame: number,
	step: number,
): { readonly x: number; readonly y: number }[] => {
	if (endFrame <= startFrame) {
		const transform = effectiveTransform(node, motion, startFrame);
		return [{ x: transform.position.x, y: transform.position.y }];
	}
	const points: { x: number; y: number }[] = [];
	for (let frame = startFrame; frame < endFrame; frame += step) {
		const transform = effectiveTransform(node, motion, frame);
		points.push({ x: transform.position.x, y: transform.position.y });
	}
	const end = effectiveTransform(node, motion, endFrame);
	points.push({ x: end.position.x, y: end.position.y });
	return points;
};

/**
 * Builds the read-only spatial motion path a node traces from its `x`/`y` keys.
 * This is a pure adapter over the side-car {@link MotionDocument} and scene rest
 * pose — it never mutates either document. A node with fewer than two anchors has
 * no traversable path, so its `polyline` collapses to the single sampled point
 * (or is empty when there are no position keys at all).
 *
 * Units: frames in, artboard-space coordinates out. `polylineStep` controls trace
 * density (frames between sampled points) and is clamped to at least one frame.
 */
export function buildMotionPath(
	node: VectorNode,
	motion: MotionDocument,
	polylineStep: number = DEFAULT_POLYLINE_STEP,
): MotionPath {
	const frames = positionAnchorFrames(node, motion);
	if (frames.length === 0) {
		return { nodeId: node.id, anchors: [], polyline: [] };
	}
	const resolvedSpatial = resolvePositionPath(motion, node.id);
	const spatialByFrame = new Map(
		resolvedSpatial.keys.map((key) => [key.frame, key] as const),
	);
	const anchors = frames.map((frame) => {
		const anchor = anchorAtFrame(node, motion, frame);
		const spatial = spatialByFrame.get(frame);
		return spatial
			? {
					...anchor,
					inTangent: spatial.resolvedInTangent,
					outTangent: spatial.resolvedOutTangent,
					spatialMode: spatial.spatialMode,
					...(spatial.roving ? { roving: true } : {}),
				}
			: anchor;
	});
	if (frames.length === 1) {
		return {
			nodeId: node.id,
			anchors,
			polyline: [{ x: anchors[0].x, y: anchors[0].y }],
		};
	}
	const polyline = samplePolyline(
		node,
		motion,
		frames[0],
		frames[frames.length - 1],
		clampStep(polylineStep),
	);
	return { nodeId: node.id, anchors, polyline };
}

/** True when the node has at least two position anchors, so a path is drawable. */
export function hasDrawableMotionPath(
	node: VectorNode,
	motion: MotionDocument,
): boolean {
	return positionAnchorFrames(node, motion).length >= 2;
}
