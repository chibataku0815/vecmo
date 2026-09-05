import { applyPatches, enablePatches, type Patch } from "immer";
import { create } from "zustand";
import { nextHistorySeq } from "@/shared/history/sequence";
import {
	EMPTY_GRAMMAR_DOCUMENT,
	type MotionGrammarCommand,
	type MotionGrammarCommandMeta,
	type MotionGrammarStoreDocument,
} from "./command";
import { runMotionGrammarCommands } from "./runner";

enablePatches();

/**
 * History entry carries a monotonic `seq` (stamped on new ops, preserved across
 * undo/redo) so a cross-store coordinator can order a single global Cmd+Z against
 * the scene store. See `@/shared/history/sequence`.
 */
type HistoryEntry = {
	readonly meta: MotionGrammarCommandMeta;
	readonly patches: readonly Patch[];
	readonly inversePatches: readonly Patch[];
	readonly seq: number;
};

type Transaction = {
	readonly coalesceKey: string;
	readonly meta: MotionGrammarCommandMeta;
	readonly patches: readonly Patch[];
	readonly inversePatches: readonly Patch[];
};

type MotionGrammarStore = {
	readonly document: MotionGrammarStoreDocument;
	readonly undoStack: readonly HistoryEntry[];
	readonly redoStack: readonly HistoryEntry[];
	readonly transaction: Transaction | null;
	readonly canUndo: boolean;
	readonly canRedo: boolean;
	readonly apply: (command: MotionGrammarCommand) => void;
	readonly beginTransaction: (
		coalesceKey: string,
		label?: string,
		compoundId?: string,
	) => void;
	readonly commit: () => void;
	readonly abortTransaction: () => void;
	readonly undo: () => void;
	readonly redo: () => void;
	readonly load: (document: MotionGrammarStoreDocument) => void;
	readonly reset: () => void;
};

/**
 * Coalesces consecutive entries sharing a `coalesceKey` (live drags) into one undo
 * step, taking the newer entry's `seq` so cross-store ordering tracks the latest
 * edit. Mirrors the scene/motion `appendHistory`.
 */
const appendHistory = (
	history: readonly HistoryEntry[],
	entry: HistoryEntry,
): readonly HistoryEntry[] => {
	const previous = history.at(-1);
	if (
		previous?.meta.coalesceKey &&
		previous.meta.coalesceKey === entry.meta.coalesceKey
	) {
		return [
			...history.slice(0, -1),
			{
				meta: entry.meta,
				patches: [...previous.patches, ...entry.patches],
				inversePatches: [...entry.inversePatches, ...previous.inversePatches],
				seq: entry.seq,
			},
		];
	}
	return [...history, entry];
};

const assertNoRunnerIssues = (
	issues: readonly { readonly message: string }[],
): void => {
	if (issues.length === 0) return;
	throw new Error(issues.map((issue) => issue.message).join("\n"));
};

export const useMotionGrammarStore = create<MotionGrammarStore>()(
	(set, get) => ({
		document: EMPTY_GRAMMAR_DOCUMENT,
		undoStack: [],
		redoStack: [],
		transaction: null,
		canUndo: false,
		canRedo: false,
		apply: (command) => {
			const state = get();
			const result = runMotionGrammarCommands(state.document, [command]);
			assertNoRunnerIssues(result.issues);
			if (!result.changed) return;

			if (state.transaction) {
				set({
					document: result.document,
					transaction: {
						...state.transaction,
						patches: [...state.transaction.patches, ...result.patches],
						inversePatches: [
							...result.inversePatches,
							...state.transaction.inversePatches,
						],
					},
				});
				return;
			}

			const undoStack = appendHistory(state.undoStack, {
				meta: {
					type: command.type,
					label: command.label,
					coalesceKey: command.coalesceKey,
					compoundId: command.compoundId,
				},
				patches: result.patches,
				inversePatches: result.inversePatches,
				seq: nextHistorySeq(),
			});
			set({
				document: result.document,
				undoStack,
				redoStack: [],
				canUndo: undoStack.length > 0,
				canRedo: false,
			});
		},
		beginTransaction: (coalesceKey, label, compoundId) => {
			const existing = get().transaction;
			if (existing?.coalesceKey === coalesceKey) return;
			if (existing) get().commit();
			set({
				transaction: {
					coalesceKey,
					meta: {
						type: "transaction/commit",
						label,
						coalesceKey,
						...(compoundId ? { compoundId } : {}),
					},
					patches: [],
					inversePatches: [],
				},
			});
		},
		commit: () => {
			const state = get();
			const transaction = state.transaction;
			if (!transaction) return;
			if (transaction.patches.length === 0) {
				set({ transaction: null });
				return;
			}
			const undoStack = appendHistory(state.undoStack, {
				meta: transaction.meta,
				patches: transaction.patches,
				inversePatches: transaction.inversePatches,
				seq: nextHistorySeq(),
			});
			set({
				transaction: null,
				undoStack,
				redoStack: [],
				canUndo: undoStack.length > 0,
				canRedo: false,
			});
		},
		abortTransaction: () => {
			const state = get();
			const transaction = state.transaction;
			if (!transaction) return;
			set({
				document:
					transaction.inversePatches.length > 0
						? applyPatches(state.document, transaction.inversePatches)
						: state.document,
				transaction: null,
			});
		},
		undo: () => {
			if (get().transaction) get().commit();
			const state = get();
			const entry = state.undoStack.at(-1);
			if (!entry) return;
			const undoStack = state.undoStack.slice(0, -1);
			const redoStack = [...state.redoStack, entry];
			set({
				document: applyPatches(state.document, entry.inversePatches),
				undoStack,
				redoStack,
				canUndo: undoStack.length > 0,
				canRedo: redoStack.length > 0,
			});
		},
		redo: () => {
			if (get().transaction) get().commit();
			const state = get();
			const entry = state.redoStack.at(-1);
			if (!entry) return;
			const redoStack = state.redoStack.slice(0, -1);
			const undoStack = [...state.undoStack, entry];
			set({
				document: applyPatches(state.document, entry.patches),
				undoStack,
				redoStack,
				canUndo: undoStack.length > 0,
				canRedo: redoStack.length > 0,
			});
		},
		load: (document) => {
			set({
				document,
				undoStack: [],
				redoStack: [],
				transaction: null,
				canUndo: false,
				canRedo: false,
			});
		},
		reset: () => {
			set({
				document: EMPTY_GRAMMAR_DOCUMENT,
				undoStack: [],
				redoStack: [],
				transaction: null,
				canUndo: false,
				canRedo: false,
			});
		},
	}),
);

/**
 * Snapshots every Scene node currently claimed by the active Motion Grammar
 * sidecar. Scene commands receive this set explicitly so cross-store ownership
 * checks cannot infer or silently miss the active grammar document.
 */
export function currentMotionGrammarTargetNodeIds(): ReadonlySet<string> {
	return new Set(
		useMotionGrammarStore
			.getState()
			.document.bindings.flatMap((binding) => binding.targetIds),
	);
}
