import { useEffect } from "react";
import { planGrammarPropagation } from "@/entities/component-motion/model/propagate-grammar";
import { useMotionGrammarStore } from "@/entities/motion-grammar/model/store";
import { useSceneStore } from "@/entities/scene/model/store";

/**
 * Module guard so the grammar resyncs this hook dispatches do not re-trigger
 * themselves. Module-scoped because there is a single editor grammar store.
 */
let propagating = false;

/**
 * Installs the master→instance motion-GRAMMAR propagation choke point — the grammar
 * twin of {@link useMotionPropagation}. Editing a master's technique (a parameter,
 * a target, a seed) re-derives every linked instance's cloned bindings so the
 * instance follows. Same guards: re-entrancy flag, forward-only (undo shrinks the
 * stack; redo is detected by identity and skipped), and `compoundId` commits (e.g.
 * creating an instance, which carries its grammar atomically) are skipped.
 *
 * Undo coherence: each resync reuses the master edit's coalesce key so the grammar
 * store folds the master edit and instance resyncs into one undo entry. Master
 * edits without a coalesce key fall back to a separate resync entry.
 */
export function useGrammarPropagation(): void {
	useEffect(
		() =>
			useMotionGrammarStore.subscribe((state, prev) => {
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
				const commands = planGrammarPropagation(
					useSceneStore.getState().document,
					useMotionGrammarStore.getState().document,
				);
				if (commands.length === 0) return;
				const coalesceKey = top?.meta.coalesceKey;
				propagating = true;
				try {
					const { apply } = useMotionGrammarStore.getState();
					for (const command of commands) {
						apply(coalesceKey ? { ...command, coalesceKey } : command);
					}
				} finally {
					propagating = false;
				}
			}),
		[],
	);
}
