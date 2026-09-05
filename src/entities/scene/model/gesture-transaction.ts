import {
	abortGesture as abortKernelGesture,
	beginGesture as beginKernelGesture,
	commitGesture as commitKernelGesture,
	type GestureState,
} from "@motion-surface/editor-kernel";
import { useSceneStore } from "./store";

export type GestureTransaction = {
	readonly id: number;
	readonly scope: string;
	readonly coalesceKey: string;
	readonly label?: string;
};

let nextGestureTransactionId = 0;
let activeGesture: GestureState<number, string> | null = null;

/**
 * Opens a scene transaction with a unique gesture-scoped coalesce key. Use one
 * transaction for one pointer/keyboard gesture so repeated draft updates commit
 * as a single undo step without collapsing across later gestures.
 */
export function beginGestureTransaction(
	scope: string,
	label?: string,
): GestureTransaction {
	nextGestureTransactionId += 1;
	const transaction = {
		id: nextGestureTransactionId,
		scope,
		coalesceKey: `${scope}:${nextGestureTransactionId}`,
		label,
	} satisfies GestureTransaction;
	activeGesture = beginKernelGesture(transaction.id, transaction.coalesceKey);
	useSceneStore
		.getState()
		.beginTransaction(transaction.coalesceKey, transaction.label);
	return transaction;
}

/**
 * Commits the transaction opened by `beginGestureTransaction` if it is still the
 * active transaction. Stale commits are ignored so interrupted handlers cannot
 * accidentally seal another feature's newer gesture.
 */
export function commitGestureTransaction(
	transaction: GestureTransaction,
): void {
	if (!activeGesture) return;
	const transition = commitKernelGesture(activeGesture, transaction.id);
	if (!transition.accepted) return;
	const store = useSceneStore.getState();
	if (store.transaction?.coalesceKey !== transaction.coalesceKey) return;
	store.commit();
	activeGesture = transition.state;
}

/**
 * Rolls back the transaction opened by `beginGestureTransaction` if it is still
 * active. Stale aborts are ignored for the same reason stale commits are: a
 * canceled gesture must never undo another feature's newer transaction.
 */
export function abortGestureTransaction(transaction: GestureTransaction): void {
	if (!activeGesture) return;
	const transition = abortKernelGesture(activeGesture, transaction.id);
	if (!transition.accepted) return;
	const store = useSceneStore.getState();
	if (store.transaction?.coalesceKey !== transaction.coalesceKey) return;
	store.abortTransaction();
	activeGesture = transition.state;
}
