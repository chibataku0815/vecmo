import type { MotionCommand } from "@/entities/motion/model/command";
import {
	effectiveOpacity,
	effectiveTransform,
	findTrack,
} from "@/entities/motion/model/sampler";
import type {
	AnimatableProperty,
	MotionDocument,
} from "@/entities/motion/model/types";
import { allNodes, findNode } from "@/entities/scene/model/selectors";
import type {
	SceneDocument,
	Transform,
	VectorNode,
} from "@/entities/scene/model/types";
import {
	createMotionKeyframeCommand,
	motionAuthoringFrame,
} from "./authoring-commands";

const EPSILON = 1e-6;

/** Scalar channels the inspector/transform tools can drive into keyframes. */
const AUTOKEY_PROPERTIES = [
	"x",
	"y",
	"anchorX",
	"anchorY",
	"rotation",
	"scaleX",
	"scaleY",
	"opacity",
] as const satisfies readonly AnimatableProperty[];

type AutoKeyProperty = (typeof AUTOKEY_PROPERTIES)[number];

export type AutoKeyCommandRequest = {
	readonly previous: SceneDocument;
	readonly next: SceneDocument;
	readonly motion: MotionDocument;
	readonly currentFrame: number;
	readonly recording: boolean;
	readonly selectedNodeIds: readonly string[];
};

const readChannel = (
	transform: Transform,
	opacity: number,
	property: AutoKeyProperty,
): number => {
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
		case "opacity":
			return opacity;
	}
};

const channelOf = (node: VectorNode, property: AutoKeyProperty): number =>
	readChannel(node.transform, node.style.opacity, property);

/**
 * Derives the keyframe writes implied by a scene edit. This is the bridge that
 * turns "the user changed a property" into motion data: it diffs the previous and
 * next scene base values per channel and records a key at the playhead frame.
 *
 * It is decoupled from *how* the property changed, so it captures inspector edits,
 * transform-tool drags, and any future writer alike. Two guards keep the timeline
 * clean:
 *   - a non-recording, not-yet-animated channel is left as a plain base edit;
 *   - an already-animated channel is keyed only when the new value diverges from
 *     the value the existing curve already samples at this frame, so editing one
 *     field never pins unrelated channels at their interpolated value.
 *
 * Returns pure commands; the caller applies them so playback writes never run
 * through here.
 */
export function collectAutoKeyCommands({
	previous,
	next,
	motion,
	currentFrame,
	recording,
	selectedNodeIds,
}: AutoKeyCommandRequest): MotionCommand[] {
	if (!recording) return [];
	if (!Number.isFinite(currentFrame) || selectedNodeIds.length === 0) return [];
	const selectedNodes = new Set(selectedNodeIds);
	const frame = motionAuthoringFrame(motion, currentFrame);
	const commands: MotionCommand[] = [];
	for (const node of allNodes(next)) {
		if (!selectedNodes.has(node.id)) continue;
		const previousNode = findNode(previous, node.id);
		if (!previousNode) continue;
		const sampledTransform = effectiveTransform(node, motion, frame);
		const sampledOpacity = effectiveOpacity(node, motion, frame);
		for (const property of AUTOKEY_PROPERTIES) {
			const nextValue = channelOf(node, property);
			if (nextValue === channelOf(previousNode, property)) continue;
			const animated =
				(findTrack(motion, node.id, property)?.keyframes.length ?? 0) > 0;
			if (animated) {
				const sampled = readChannel(sampledTransform, sampledOpacity, property);
				if (Math.abs(nextValue - sampled) < EPSILON) continue;
			}
			const command = createMotionKeyframeCommand({
				node,
				motion,
				currentFrame: frame,
				property,
				value: nextValue,
			});
			if (command) commands.push(command);
		}
	}
	return commands;
}
