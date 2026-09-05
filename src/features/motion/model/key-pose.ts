import { useMotionStore } from "@/entities/motion/model/store";
import { findNode } from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import {
	createMotionKeyframeCommand,
	MOTION_SCALAR_AUTHORING_PROPERTIES,
	motionAuthoringFrame,
} from "./authoring-commands";
import { useTransportStore } from "./transport-store";

/**
 * Snapshots a node's sampled pose into the side-car motion document at the
 * current playhead. All channels share one transaction, preserving the timeline
 * button and command-palette action as a single undoable key-pose operation.
 */
export function keyNodePoseAtPlayhead(nodeId: string): void {
	const scene = useSceneStore.getState().document;
	const node = findNode(scene, nodeId);
	if (!node) return;
	const motion = useMotionStore.getState().document;
	const frame = motionAuthoringFrame(
		motion,
		useTransportStore.getState().currentFrame,
	);
	const commands = MOTION_SCALAR_AUTHORING_PROPERTIES.flatMap((property) => {
		const command = createMotionKeyframeCommand({
			node,
			motion,
			currentFrame: frame,
			property,
		});
		return command ? [command] : [];
	});
	const pathShapeCommand = createMotionKeyframeCommand({
		node,
		motion,
		currentFrame: frame,
		property: "pathShape",
	});
	if (pathShapeCommand) commands.push(pathShapeCommand);
	if (commands.length === 0) return;
	const store = useMotionStore.getState();
	store.beginTransaction(`motion-keypose:${node.id}:${frame}`);
	for (const command of commands) store.apply(command);
	store.commit();
}

/**
 * Keys the node's current linear/radial gradient fill at the playhead as one
 * `fillGradient` snapshot (the AE stopwatch gesture for gradients). Two such keys at
 * different frames make the gradient animate — the sampler tweens geometry + stops
 * between them. No-op when the primary fill is not a linear/radial gradient.
 * Returns whether a keyframe was written.
 */
export function keyGradientFillAtPlayhead(nodeId: string): boolean {
	const scene = useSceneStore.getState().document;
	const node = findNode(scene, nodeId);
	if (!node) return false;
	const motion = useMotionStore.getState().document;
	const frame = motionAuthoringFrame(
		motion,
		useTransportStore.getState().currentFrame,
	);
	const command = createMotionKeyframeCommand({
		node,
		motion,
		currentFrame: frame,
		property: "fillGradient",
	});
	if (!command) return false;
	const store = useMotionStore.getState();
	store.beginTransaction(`motion-key:${node.id}:fillGradient:${frame}`);
	store.apply(command);
	store.commit();
	return true;
}
