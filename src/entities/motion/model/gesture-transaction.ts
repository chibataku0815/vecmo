import {
	abortGesture as abortKernelGesture,
	beginGesture as beginKernelGesture,
	commitGesture as commitKernelGesture,
	type GestureState,
	updateGesture as updateKernelGesture,
} from "@motion-surface/editor-kernel";
import type { MotionCommand } from "./command";
import { useMotionStore } from "./store";

export type MotionGestureTransaction = {
	readonly id: number;
	readonly scope: string;
	readonly coalesceKey: string;
	readonly label?: string;
};

let nextMotionGestureTransactionId = 0;
let activeMotionGesture: GestureState<number, string> | null = null;

/**
 * Opens a motion transaction with a unique gesture-scoped key. This gives the
 * timeline/bridge layer a typed entry point for one-gesture-one-undo authoring
 * without exposing raw coalesce-key construction.
 */
export function beginMotionTransaction(
	scope: string,
	label?: string,
): MotionGestureTransaction {
	nextMotionGestureTransactionId += 1;
	const transaction = {
		id: nextMotionGestureTransactionId,
		scope,
		coalesceKey: `${scope}:${nextMotionGestureTransactionId}`,
		label,
	} satisfies MotionGestureTransaction;
	activeMotionGesture = beginKernelGesture(
		transaction.id,
		transaction.coalesceKey,
	);
	useMotionStore
		.getState()
		.beginTransaction(transaction.coalesceKey, transaction.label);
	return transaction;
}

/**
 * Commits the active motion transaction only when it is still the gesture that
 * opened it. Stale pointer-up/unmount handlers can call this safely after a newer
 * motion transaction has taken ownership.
 */
export function commitMotionTransaction(
	transaction: MotionGestureTransaction,
): void {
	if (!activeMotionGesture) return;
	const transition = commitKernelGesture(activeMotionGesture, transaction.id);
	if (!transition.accepted) return;
	const store = useMotionStore.getState();
	if (store.transaction?.coalesceKey !== transaction.coalesceKey) return;
	store.commit();
	activeMotionGesture = transition.state;
}

/** Aborts the matching motion gesture without exposing rollback implementation. */
export function abortMotionTransaction(
	transaction: MotionGestureTransaction,
): void {
	if (!activeMotionGesture) return;
	const transition = abortKernelGesture(activeMotionGesture, transaction.id);
	if (!transition.accepted) return;
	const store = useMotionStore.getState();
	if (store.transaction?.coalesceKey !== transaction.coalesceKey) return;
	store.abortTransaction();
	activeMotionGesture = transition.state;
}

/**
 * Applies a motion command only while the matching gesture transaction is still
 * active. Delayed pointer-move callbacks from an older gesture can call this
 * without appending their patches to a newer transaction.
 */
export function applyInMotionTransaction(
	transaction: MotionGestureTransaction,
	command: MotionCommand,
): boolean {
	if (!activeMotionGesture) return false;
	const transition = updateKernelGesture(activeMotionGesture, transaction.id);
	if (!transition.accepted) return false;
	const store = useMotionStore.getState();
	if (store.transaction?.coalesceKey !== transaction.coalesceKey) return false;
	store.apply(command);
	activeMotionGesture = transition.state;
	return true;
}
