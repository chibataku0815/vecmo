import { applyPatches, enablePatches, type Patch } from "immer";
import { create } from "zustand";
import { nextHistorySeq } from "@/shared/history/sequence";
import type { MotionCommand, MotionCommandMeta } from "./command";
import { runMotionCommands } from "./runner";
import { cloneMotionDocument, initialMotionDocument } from "./seed-motion";
import type { MotionDocument } from "./types";

enablePatches();

type HistoryEntry = {
	readonly meta: MotionCommandMeta;
	readonly patches: readonly Patch[];
	readonly inversePatches: readonly Patch[];
	/**
	 * Monotonic creation stamp from the shared history clock. Present on every entry
	 * so the global undo coordinator can order this store against scene/grammar, but
	 * the coordinator only ACTS on motion entries that also carry a
	 * `meta.compoundId` — standalone keyframe edits stay on the timeline-local undo.
	 */
	readonly seq: number;
};

type Transaction = {
	readonly coalesceKey: string;
	readonly meta: MotionCommandMeta;
	readonly patches: readonly Patch[];
	readonly inversePatches: readonly Patch[];
};

type MotionStore = {
	readonly document: MotionDocument;
	readonly undoStack: readonly HistoryEntry[];
	readonly redoStack: readonly HistoryEntry[];
	readonly transaction: Transaction | null;
	readonly canUndo: boolean;
	readonly canRedo: boolean;
	readonly apply: (command: MotionCommand) => void;
	readonly beginTransaction: (
		coalesceKey: string,
		label?: string,
		compoundId?: string,
	) => void;
	readonly commit: () => void;
	readonly abortTransaction: () => void;
	readonly undo: () => void;
	readonly redo: () => void;
	readonly reset: (document?: MotionDocument) => void;
};

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

const entryFromCommand = (
	command: MotionCommand,
	patches: readonly Patch[],
	inversePatches: readonly Patch[],
): HistoryEntry => ({
	meta: {
		type: command.type,
		label: command.label,
		coalesceKey: command.coalesceKey,
		compoundId: command.compoundId,
	},
	patches,
	inversePatches,
	seq: nextHistorySeq(),
});

const assertNoRunnerIssues = (
	issues: readonly { readonly message: string }[],
): void => {
	if (issues.length === 0) return;
	throw new Error(issues.map((issue) => issue.message).join("\n"));
};

/**
 * Side-car timing history. It deliberately mirrors the scene store's Immer-patch
 * command bus (transaction batching + coalesce-key merging + undo/redo) so motion
 * edits are reversible with the same semantics, and a future merge can unify the
 * two stacks without re-deriving the contract. Undo/redo seal an active
 * transaction before replay so interrupted gestures cannot leave stale patches
 * open. Playback never calls `apply`; only user authoring mutates this store.
 */
export const useMotionStore = create<MotionStore>()((set, get) => ({
	document: cloneMotionDocument(initialMotionDocument),
	undoStack: [],
	redoStack: [],
	transaction: null,
	canUndo: false,
	canRedo: false,
	apply: (command) => {
		const state = get();
		const result = runMotionCommands(state.document, [command]);
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

		const undoStack = appendHistory(
			state.undoStack,
			entryFromCommand(command, result.patches, result.inversePatches),
		);
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
	reset: (document = initialMotionDocument) => {
		set({
			document: cloneMotionDocument(document),
			undoStack: [],
			redoStack: [],
			transaction: null,
			canUndo: false,
			canRedo: false,
		});
	},
}));
