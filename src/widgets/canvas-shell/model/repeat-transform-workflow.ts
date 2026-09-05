import { useSceneStore } from "@/entities/scene/model/store";
import type { SceneDocument } from "@/entities/scene/model/types";
import { buildDuplicateClipboardCommand } from "@/features/clipboard";
import { useSelectionStore } from "@/features/selection/model/store";
import {
	buildRepeatTransformCommands,
	captureRepeatTransformMatrices,
	nextRepeatTransformTransactionKey,
	type RepeatTransformPlan,
	recordDuplicateTransformRepeat,
} from "@/features/transform/model/repeat-transform";

const ZERO_REPEAT_DUPLICATE_OFFSET = { x: 0, y: 0 } as const;

/** Returns whether the current selection can receive the stored repeat plan. */
export function canApplyRepeatTransformWorkflow(
	document: SceneDocument,
	nodeIds: readonly string[],
	plan: RepeatTransformPlan | null,
): boolean {
	if (!plan || nodeIds.length === 0) return false;
	if (plan.kind === "duplicate-transform") {
		return buildDuplicateClipboardCommand(document, nodeIds).ok;
	}
	return buildRepeatTransformCommands(document, nodeIds, plan).length > 0;
}

/**
 * Records duplicate spacing from a widget-level duplicate operation. Clipboard
 * planning owns the copy, while repeat-transform owns the affine spacing memory.
 */
export function recordDuplicateRepeatWorkflow(input: {
	readonly sourceDocument: SceneDocument;
	readonly sourceNodeIds: readonly string[];
	readonly duplicateNodeIds: readonly string[];
	readonly document: SceneDocument;
}): void {
	recordDuplicateTransformRepeat({
		sourceMatrices: captureRepeatTransformMatrices(
			input.sourceDocument,
			input.sourceNodeIds,
		),
		duplicateNodeIds: input.duplicateNodeIds,
		document: input.document,
	});
}

/**
 * Applies the stored repeat transform through the scene command bus. Duplicate
 * repeat is modeled as a zero-offset duplicate followed by the stored affine
 * delta, so each run extends the pattern from the newest selected copy.
 */
export function applyRepeatTransformWorkflow(
	plan: RepeatTransformPlan | null,
	nodeIds: readonly string[],
): boolean {
	if (!plan) return false;
	const sceneStore = useSceneStore.getState();
	if (sceneStore.transaction) return false;

	if (plan.kind === "transform") {
		const commands = buildRepeatTransformCommands(
			sceneStore.document,
			nodeIds,
			plan,
		);
		if (commands.length === 0) return false;
		sceneStore.beginTransaction(
			nextRepeatTransformTransactionKey(),
			"Transform again",
		);
		for (const command of commands) sceneStore.apply(command);
		sceneStore.commit();
		return true;
	}

	const sourceDocument = sceneStore.document;
	const result = buildDuplicateClipboardCommand(sourceDocument, nodeIds, {
		offset: ZERO_REPEAT_DUPLICATE_OFFSET,
	});
	if (!result.ok) return false;

	sceneStore.beginTransaction(
		nextRepeatTransformTransactionKey(),
		"Transform again",
	);
	sceneStore.apply(result.command);
	const repeatedCommands = buildRepeatTransformCommands(
		useSceneStore.getState().document,
		result.newRootNodeIds,
		plan,
	);
	if (repeatedCommands.length === 0) {
		sceneStore.abortTransaction();
		return false;
	}
	for (const command of repeatedCommands) sceneStore.apply(command);
	sceneStore.commit();

	const document = useSceneStore.getState().document;
	useSelectionStore
		.getState()
		.setSelection(result.newRootNodeIds, result.newRootNodeIds.at(-1) ?? null);
	recordDuplicateRepeatWorkflow({
		sourceDocument,
		sourceNodeIds: nodeIds,
		duplicateNodeIds: result.newRootNodeIds,
		document,
	});
	return true;
}
