import type { MotionCommand } from "@/entities/motion/model/command";
import { copyMotionTracksForInstance } from "@/entities/motion/model/commands";
import { selectComponentInstanceNodes } from "@/entities/scene/model/component-symbols";
import type { SceneDocument } from "@/entities/scene/model/types";

/**
 * Plans the motion-store resync that keeps every linked component instance's
 * keyframe tracks in step with its master after the master's motion is edited.
 *
 * This is the propagation half of propagate-sync: instances are stored clones, so
 * a master edit does not reach them automatically. For each live instance we emit
 * an idempotent {@link copyMotionTracksForInstance} that rebuilds the instance
 * tracks from the current source tracks. The command is a no-op (and dropped by
 * the motion store's `changed` guard) when the instance already matches, so
 * dispatching the full set every motion commit converges without a staleness diff
 * and without looping.
 *
 * Pure and scene-only: track values are read from the motion draft at apply time,
 * so the plan depends only on which instances exist and their source→instance maps.
 *
 * `masterCoalesceKey` is the coalesce key of the master edit that triggered this
 * pass. When provided, every resync inherits it so the motion store folds the
 * master edit AND its instance resyncs into ONE undo entry — a single Cmd+Z/undo
 * then reverts master and instances together (no inconsistent intermediate where
 * the instance reverts but the master stays edited). Master edits with no coalesce
 * key fall back to a stable per-instance key (separate, still-coalescing entry).
 *
 * `symbolIds`, when provided, narrows the resync to instances of those component
 * symbols only — used by the agent `motion/propagate-to-instances` command's
 * optional `sourceNodeIds` scoping. Omitted (the editor's own automatic pass)
 * propagates every linked instance in the document, unchanged from before this
 * parameter existed.
 */
export function planMotionPropagation(
	scene: SceneDocument,
	masterCoalesceKey?: string,
	symbolIds?: ReadonlySet<string>,
): readonly MotionCommand[] {
	return selectComponentInstanceNodes(scene)
		.filter((entry) => !symbolIds || symbolIds.has(entry.binding.symbolId))
		.map((entry) =>
			copyMotionTracksForInstance({
				sourceToInstanceNodeIds: entry.binding.sourceToInstanceNodeIds,
				timingOffsetFrames: entry.binding.timingOffsetFrames,
				coalesceKey:
					masterCoalesceKey ?? `component-motion-sync:${entry.node.id}`,
				label: "Sync component motion",
			}),
		);
}
