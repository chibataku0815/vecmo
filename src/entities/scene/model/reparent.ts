/**
 * Pure index math plus the typed destination contract shared by the layers-panel
 * drag resolver (UX) and the reparent scene command (the trust boundary). It
 * lives in the entities layer so BOTH the widget resolver (a downward import)
 * and the command consume ONE off-by-one rule — the drop indicator and the
 * splice can therefore never disagree about where a moved block lands.
 */

/**
 * The fully-resolved destination for a reparent: the new parent (`null` selects
 * the owning layer's top-level array), the owning layer, and the PRE-removal gap
 * index between the target's current children.
 */
export interface ReparentTarget {
	readonly targetParentNodeId: string | null;
	readonly targetLayerId: string;
	readonly toIndex: number;
}

/**
 * The single insert-index rule for splicing a contiguous block of moved nodes
 * into a destination array AFTER the survivors have been removed. Clamping only
 * bounds the index; it does not compensate for nodes removed BELOW the gap —
 * that compensation is the whole point. A downward same-array drag whose source
 * sat below the gap would otherwise land one slot too low.
 *
 * @param gapIndex slot between children in the target's CURRENT (pre-removal)
 *   array (0 = before first, length = after last)
 * @param movedOriginalDestIndices original indices, in the destination array, of
 *   moved nodes that already lived there (empty for a cross-parent move)
 * @param destLengthAfterRemoval destination array length once survivors are out
 */
export function resolveInsertIndex(
	gapIndex: number,
	movedOriginalDestIndices: readonly number[],
	destLengthAfterRemoval: number,
): number {
	const removedBelowGap = movedOriginalDestIndices.filter(
		(index) => index < gapIndex,
	).length;
	const shifted = gapIndex - removedBelowGap;
	return Math.max(0, Math.min(shifted, destLengthAfterRemoval));
}

/** Resolved single-node insertion: the post-removal index and whether the drop changes nothing. */
export type SingleInsertion = {
	readonly finalIndex: number;
	readonly isNoop: boolean;
};

/**
 * The single-node convenience the drag resolver uses to flag a no-op drop so it
 * can suppress a misleading indicator. It is the count-of-one special case of
 * {@link resolveInsertIndex}: a cross-parent move is never in the destination
 * array (so never compensated, never a no-op), while a same-parent move
 * compensates the one node whenever the gap sits below it.
 */
export function computeInsertion(
	sourceParentId: string | null,
	fromIndex: number,
	targetParentId: string | null,
	gapIndex: number,
): SingleInsertion {
	if (sourceParentId !== targetParentId) {
		return { finalIndex: gapIndex, isNoop: false };
	}
	const finalIndex = gapIndex > fromIndex ? gapIndex - 1 : gapIndex;
	return { finalIndex, isNoop: finalIndex === fromIndex };
}
