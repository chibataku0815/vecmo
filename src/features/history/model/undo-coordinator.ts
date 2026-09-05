import type { HistoryPort } from "@motion-surface/editor-kernel";
import { useMotionStore } from "@/entities/motion/model/store";
import { useMotionGrammarStore } from "@/entities/motion-grammar/model/store";
import { useSceneStore } from "@/entities/scene/model/store";

/**
 * Cross-store undo arbitration for the single global Cmd+Z / Cmd+Shift+Z.
 *
 * The scene, motion, and motion-grammar stores are independent command buses
 * with no shared history. Each stamps every new entry with a monotonic `seq`
 * from the shared history clock, so a global undo dispatches to whichever store
 * holds the most-recently created top-of-stack entry. This preserves LIFO order
 * across the stores.
 *
 * Compound gestures can write more than one store, for example creating a linked
 * component instance can clone the node into the scene store and copy its motion
 * into the motion store. Every command in such a gesture is tagged with a shared
 * `meta.compoundId`. When the most-recent entry carries one, the coordinator
 * pops every store whose top entry shares that id in the same call, so one
 * Cmd+Z reverts the whole gesture atomically and never orphans a half.
 *
 * Known limitation, unchanged from the previous widget-local coordinator:
 * finely interleaved redo across stores can replay out of strict global order,
 * since each store clears only its own redo stack on a new edit. Undo, and redo
 * without cross-store interleaving, are correct.
 */

type HistoryTop = {
	readonly seq: number;
	readonly meta: { readonly compoundId?: string };
};

type CoordinatedStore = {
	readonly undoStack: readonly HistoryTop[];
	readonly redoStack: readonly HistoryTop[];
	readonly undo: () => void;
	readonly redo: () => void;
};

type CoordinatedStoreHandle = {
	readonly name: "scene" | "motion" | "motion-grammar";
	readonly getState: () => CoordinatedStore;
};

type HistorySide = "undoStack" | "redoStack";
type HistoryAction = "undo" | "redo";

const coordinatedStores = (): readonly CoordinatedStoreHandle[] => [
	{ name: "scene", getState: useSceneStore.getState },
	{ name: "motion", getState: useMotionStore.getState },
	{ name: "motion-grammar", getState: useMotionGrammarStore.getState },
];

const oppositeSide = (side: HistorySide): HistorySide =>
	side === "undoStack" ? "redoStack" : "undoStack";

const oppositeAction = (action: HistoryAction): HistoryAction =>
	action === "undo" ? "redo" : "undo";

const compoundReplayFailure = (
	message: string,
	errors: readonly unknown[],
): Error => {
	const error = new Error(message);
	if (errors.length > 0) {
		(error as Error & { cause?: unknown }).cause =
			errors.length === 1 ? errors[0] : errors;
	}
	return error;
};

/**
 * Dispatches one global undo/redo step. Picks the largest-`seq` top entry across
 * the stores; if it belongs to a compound gesture, runs every store whose top
 * shares that `compoundId` so the gesture reverts atomically. Each store is run
 * at most once, so reading pre-mutation snapshot tops inside the loop is safe.
 */
const dispatchLatest = (side: HistorySide, action: HistoryAction): void => {
	const stores = coordinatedStores();
	let best: CoordinatedStoreHandle | undefined;
	let bestTop: HistoryTop | undefined;
	for (const store of stores) {
		const top = store.getState()[side].at(-1);
		if (top && (!bestTop || top.seq > bestTop.seq)) {
			best = store;
			bestTop = top;
		}
	}
	if (!best || !bestTop) return;

	const { compoundId } = bestTop.meta;
	if (compoundId == null) {
		best.getState()[action]();
		return;
	}

	const participants = stores.flatMap((store) => {
		const entry = store.getState()[side].at(-1);
		return entry?.meta.compoundId === compoundId ? [{ store, entry }] : [];
	});
	const destination = oppositeSide(side);
	const replayErrors: unknown[] = [];
	const moved: (typeof participants)[number][] = [];

	for (const participant of participants) {
		try {
			participant.store.getState()[action]();
		} catch (error) {
			replayErrors.push(error);
		}
		if (
			participant.store.getState()[destination].at(-1) === participant.entry
		) {
			moved.push(participant);
		}
	}

	if (moved.length === participants.length) {
		if (replayErrors.length > 0) {
			throw compoundReplayFailure(
				`Global ${action} completed for compound ${compoundId}, but ${replayErrors.length} subscriber error(s) were reported.`,
				replayErrors,
			);
		}
		return;
	}

	// A runner failed before moving at least one history entry. Restore every
	// participant that did move so the compound remains all-or-nothing.
	const compensation = oppositeAction(action);
	const compensationErrors: unknown[] = [];
	for (const participant of moved.toReversed()) {
		if (
			participant.store.getState()[destination].at(-1) !== participant.entry
		) {
			compensationErrors.push(
				new Error(
					`${participant.store.name} history changed before compound compensation.`,
				),
			);
			continue;
		}
		try {
			participant.store.getState()[compensation]();
		} catch (error) {
			compensationErrors.push(error);
		}
		if (participant.store.getState()[side].at(-1) !== participant.entry) {
			compensationErrors.push(
				new Error(
					`${participant.store.name} history compensation did not settle.`,
				),
			);
		}
	}
	throw compoundReplayFailure(
		`Global ${action} could not replay compound ${compoundId}; moved entries were compensated.`,
		[...replayErrors, ...compensationErrors],
	);
};

/** Undo the most-recently created operation across the coordinated stores. */
export function globalUndo(): void {
	dispatchLatest("undoStack", "undo");
}

/** Redo across the coordinated stores, subject to the file-level limitation. */
export function globalRedo(): void {
	dispatchLatest("redoStack", "redo");
}

/** Product-owned stores adapted to the Kernel's intentionally narrow history port. */
export const globalHistoryPort: HistoryPort = {
	read: () => {
		const stores = coordinatedStores();
		return {
			canUndo: stores.some((store) => store.getState().undoStack.length > 0),
			canRedo: stores.some((store) => store.getState().redoStack.length > 0),
		};
	},
	undo: globalUndo,
	redo: globalRedo,
	subscribe: (listener) => {
		const unsubscribe = [
			useSceneStore.subscribe(listener),
			useMotionStore.subscribe(listener),
			useMotionGrammarStore.subscribe(listener),
		];
		return () => {
			for (const stop of unsubscribe) stop();
		};
	},
};
