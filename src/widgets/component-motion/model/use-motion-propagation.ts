import { useEffect } from "react";
import { planMotionPropagation } from "@/entities/component-motion/model/propagate-motion";
import { useMotionStore } from "@/entities/motion/model/store";
import { useSceneStore } from "@/entities/scene/model/store";

/**
 * Module guard so the resyncs this hook dispatches do not re-trigger themselves.
 * Module-scoped (not per-component) because there is a single editor motion store.
 */
let propagating = false;

/**
 * Installs the master→instance motion propagation choke point.
 *
 * Subscribes to the motion store and, on a FORWARD authoring commit, rebuilds every
 * linked component instance's keyframe tracks from its master via idempotent
 * resyncs ({@link planMotionPropagation}). This is the single place a master motion
 * edit reaches the instances, so keyframing through any path (timeline, inspector,
 * drag, agent) propagates without each editor wiring it — completeness rests on the
 * machine-checked invariant that all document mutation goes through the command bus.
 *
 * Guards:
 * - Re-entrancy: `propagating` skips the store writes this hook makes; idempotent
 *   no-op convergence (the motion store drops unchanged commands) ends the cascade.
 * - Forward-only: undo shrinks the stack; redo grows it but is detected by identity
 *   (the new undo top is the entry just popped from redo) and skipped, because a
 *   propagation `apply` during redo would clear the still-pending redo stack.
 * - Coordinated ops: a commit carrying a `compoundId` (e.g. creating a linked
 *   instance, which already copies its motion atomically) is skipped, so the
 *   propagation pass cannot bury that compound entry beneath an untagged resync and
 *   break the atomic global undo.
 *
 * UNDO COHERENCE: the resyncs reuse the master edit's coalesce key, so the motion
 * store folds the master edit and its instance resyncs into a SINGLE undo entry —
 * one undo reverts master and instances together. Master edits without a coalesce
 * key (rare) fall back to a separate resync entry; for those, undoing once reverts
 * only the resync, leaving the master edited until a second undo. A fully
 * derived-projection model (instances never historied) would remove that residue
 * entirely and is the planned follow-up.
 */
export function useMotionPropagation(): void {
	useEffect(
		() =>
			useMotionStore.subscribe((state, prev) => {
				if (propagating) return;
				if (state.undoStack.length <= prev.undoStack.length) return;
				const top = state.undoStack.at(-1);
				if (top?.meta.compoundId != null) return;
				if (
					prev.redoStack.length > 0 &&
					state.undoStack.at(-1) === prev.redoStack.at(-1)
				) {
					return;
				}
				const commands = planMotionPropagation(
					useSceneStore.getState().document,
					top?.meta.coalesceKey,
				);
				if (commands.length === 0) return;
				propagating = true;
				try {
					const { apply } = useMotionStore.getState();
					for (const command of commands) apply(command);
				} finally {
					propagating = false;
				}
			}),
		[],
	);
}
