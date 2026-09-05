import type { SelectedObjectUndoPlan } from "./selected-object-actions";

let workflowTransactionSequence = 0;

/**
 * Produces the scene-history coalesce key for selected-object multi-command
 * workflow batches. `coalescePolicy: "never"` gets a fresh key per execution so
 * repeated lock/hide batches stay as separate undo entries across editor
 * surfaces.
 */
export const selectedObjectWorkflowTransactionCoalesceKey = (
	transaction: SelectedObjectUndoPlan,
): string => {
	const baseKey = transaction.transactionKeyHint ?? transaction.label;
	if (transaction.coalescePolicy === "never") {
		const sequence = workflowTransactionSequence;
		workflowTransactionSequence += 1;
		return `${baseKey}:${sequence}`;
	}
	return baseKey;
};
