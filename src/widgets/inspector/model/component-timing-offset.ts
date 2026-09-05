import { copyMotionTracksForInstance } from "@/entities/motion/model/commands";
import { useMotionStore } from "@/entities/motion/model/store";
import { createSetComponentTimingOffsetCommand } from "@/entities/scene/model/component-symbol-commands";
import { findNode } from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";

/**
 * Applies a per-instance motion timing offset as ONE coordinated, gesture-coalesced
 * edit across the scene and motion stores. The scene records the offset on the
 * instance binding ({@link createSetComponentTimingOffsetCommand}); the motion store
 * re-bakes the instance's tracks shifted by the offset
 * ({@link copyMotionTracksForInstance}).
 *
 * Both commands carry `gestureKey` as their coalesce key, so a scrub's many ticks
 * collapse into ONE history entry per store (NOT a held scene transaction — that
 * cannot carry a `compoundId`); and both carry the SAME derived `compoundId`, so the
 * global-undo coordinator reverts the scene record and the baked tracks atomically.
 * Re-running with an unchanged offset is a no-op on both stores (each command guards
 * its own write), so repeated scrub ticks at the same rounded value do not churn.
 *
 * Imperative (reads `getState()`) because it is a gesture callback, mirroring the
 * cross-store dispatch the Layers panel uses to create a linked instance.
 */
export function applyInstanceTimingOffset(
	instanceRootNodeId: string,
	offsetFrames: number,
	gestureKey: string,
): void {
	const binding = findNode(
		useSceneStore.getState().document,
		instanceRootNodeId,
	)?.component;
	if (binding?.kind !== "instance") return;
	const compoundId = `instance-offset:${gestureKey}`;
	useSceneStore.getState().apply({
		...createSetComponentTimingOffsetCommand(instanceRootNodeId, offsetFrames, {
			coalesceKey: gestureKey,
		}),
		compoundId,
	});
	useMotionStore.getState().apply({
		...copyMotionTracksForInstance({
			sourceToInstanceNodeIds: binding.sourceToInstanceNodeIds,
			timingOffsetFrames: Math.round(offsetFrames),
			coalesceKey: gestureKey,
		}),
		compoundId,
	});
}
