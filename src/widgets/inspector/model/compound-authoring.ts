import type { MotionCommand } from "@/entities/motion/model/command";
import { useMotionStore } from "@/entities/motion/model/store";
import type { MotionGrammarCommand } from "@/entities/motion-grammar/model/command";
import { useMotionGrammarStore } from "@/entities/motion-grammar/model/store";
import type { SceneCommand } from "@/entities/scene/model/command";
import { useSceneStore } from "@/entities/scene/model/store";

/**
 * Commits one Inspector-owned cross-entity command plan atomically. Every
 * participating store opens before the first write. A later failure aborts
 * still-open transactions and compensates only matching finalized top entries.
 */
export const commitInspectorCompound = ({
	compoundId,
	label,
	sceneCommands = [],
	motionCommands = [],
	grammarCommands = [],
}: {
	readonly compoundId: string;
	readonly label: string;
	readonly sceneCommands?: readonly SceneCommand[];
	readonly motionCommands?: readonly MotionCommand[];
	readonly grammarCommands?: readonly MotionGrammarCommand[];
}): void => {
	const sceneStore = useSceneStore.getState();
	const motionStore = useMotionStore.getState();
	const grammarStore = useMotionGrammarStore.getState();
	try {
		if (sceneCommands.length > 0 && sceneStore.transaction) {
			throw new Error(
				"Scene has an active editor transaction; finish the current gesture first.",
			);
		}
		if (motionCommands.length > 0 && motionStore.transaction) {
			throw new Error(
				"Motion has an active editor transaction; finish the current gesture first.",
			);
		}
		if (grammarCommands.length > 0 && grammarStore.transaction) {
			throw new Error(
				"Motion Grammar has an active editor transaction; finish the current gesture first.",
			);
		}
		if (sceneCommands.length > 0) {
			sceneStore.beginTransaction(compoundId, label, compoundId);
		}
		if (motionCommands.length > 0) {
			motionStore.beginTransaction(compoundId, label, compoundId);
		}
		if (grammarCommands.length > 0) {
			grammarStore.beginTransaction(compoundId, label, compoundId);
		}
		for (const command of sceneCommands) {
			sceneStore.apply({ ...command, compoundId, coalesceKey: compoundId });
		}
		for (const command of motionCommands) {
			motionStore.apply({ ...command, compoundId, coalesceKey: compoundId });
		}
		for (const command of grammarCommands) {
			grammarStore.apply({ ...command, compoundId, coalesceKey: compoundId });
		}
		if (grammarCommands.length > 0) grammarStore.commit();
		if (motionCommands.length > 0) motionStore.commit();
		if (sceneCommands.length > 0) sceneStore.commit();
	} catch (error) {
		const rollbackErrors: unknown[] = [];
		const attemptRollback = (operation: () => void): void => {
			try {
				operation();
			} catch (rollbackError) {
				rollbackErrors.push(rollbackError);
			}
		};
		if (
			useMotionGrammarStore.getState().transaction?.coalesceKey === compoundId
		) {
			attemptRollback(() =>
				useMotionGrammarStore.getState().abortTransaction(),
			);
		}
		if (useMotionStore.getState().transaction?.coalesceKey === compoundId) {
			attemptRollback(() => useMotionStore.getState().abortTransaction());
		}
		if (useSceneStore.getState().transaction?.coalesceKey === compoundId) {
			attemptRollback(() => useSceneStore.getState().abortTransaction());
		}
		if (
			useMotionGrammarStore.getState().undoStack.at(-1)?.meta.compoundId ===
			compoundId
		) {
			attemptRollback(() => useMotionGrammarStore.getState().undo());
		}
		if (
			useMotionStore.getState().undoStack.at(-1)?.meta.compoundId === compoundId
		) {
			attemptRollback(() => useMotionStore.getState().undo());
		}
		if (
			useSceneStore.getState().undoStack.at(-1)?.meta.compoundId === compoundId
		) {
			attemptRollback(() => useSceneStore.getState().undo());
		}
		if (rollbackErrors.length > 0) {
			const rollbackFailure = new Error(
				`Inspector compound rollback encountered ${rollbackErrors.length} subscriber error(s).`,
			);
			(rollbackFailure as Error & { cause?: unknown }).cause = error;
			throw rollbackFailure;
		}
		throw error;
	}
};
