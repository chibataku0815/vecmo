import type { SceneCommand } from "@/entities/scene/model/command";
import {
	applyEffectLayerStackOperation,
	type EffectLayerKind,
	type EffectLayerOwnerRef,
	type EffectLayerStack,
	type EffectLayerStackOperation,
	effectLayerStackFromIntent,
	visualRecipeFromEffectLayerStack,
} from "@/entities/scene/model/effect-layer-stack";
import { createSetEffectLayerStackCommand } from "@/entities/scene/model/effect-layer-stack-commands";
import {
	createUpdateEffectIntentCommand,
	type EffectIntentTarget,
	type UpdateEffectIntentOptions,
} from "@/entities/scene/model/node-commands";
import { resolveFrameEffectIntent } from "@/entities/scene/model/recipe-resolve";
import {
	findArtboardById,
	selectCurrentArtboard,
	selectDefaultArtboard,
} from "@/entities/scene/model/selectors";
import type { EffectIntent, SceneDocument } from "@/entities/scene/model/types";
import {
	type EffectFieldDefinitionDraft,
	type EffectInfluenceRecipe,
	type EffectInfluenceRecipeDraft,
	type EffectMaskSourceDraft,
	type EffectMaskStackItemDraft,
	linkEffectInfluenceAssignmentField,
	normalizeEffectInfluenceRecipe,
	normalizeVisualRecipe,
	removeEffectFieldDefinition,
	replaceEffectFieldSource,
	unlinkEffectInfluenceAssignmentField,
	upsertEffectFieldDefinition,
	type VisualRecipe,
} from "@/shared/vec-core";
import {
	appendEffectInfluenceStackMask,
	attachEffectInfluenceMask,
	type EffectInfluenceMaskAssignmentInput,
	type EffectInfluenceMaskAssignmentPatch,
	type EffectMaskStackItemInput,
	removeEffectInfluenceMask,
	removeEffectInfluenceStackMask,
	reorderEffectInfluenceMask,
	reorderEffectInfluenceStackMask,
	replaceEffectInfluenceMask,
	replaceEffectInfluenceStackMask,
} from "./effect-influence";
import {
	type RecipePathPatchResult,
	updateRecipeControl,
} from "./recipe-controls";

export type FrameEffectIntentTarget = EffectIntentTarget;

export type FrameEffectIntentCommandOptions = UpdateEffectIntentOptions;

export type FrameEffectIntentCommandResult =
	| {
			readonly kind: "ready";
			readonly target: FrameEffectIntentTarget;
			readonly command: SceneCommand;
			readonly visualRecipe?: VisualRecipe;
			readonly influenceRecipe?: EffectInfluenceRecipe;
	  }
	| {
			readonly kind: "unchanged";
			readonly target: FrameEffectIntentTarget;
			readonly visualRecipe?: VisualRecipe;
			readonly influenceRecipe?: EffectInfluenceRecipe;
	  }
	| {
			readonly kind: "missing-target";
			readonly target: FrameEffectIntentTarget;
	  }
	| (Extract<RecipePathPatchResult, { readonly kind: "invalid-path" }> & {
			readonly target: FrameEffectIntentTarget;
	  })
	| (Extract<RecipePathPatchResult, { readonly kind: "invalid-value" }> & {
			readonly target: FrameEffectIntentTarget;
	  });

export type FrameEffectLayerStackCommandResult =
	| {
			readonly kind: "ready";
			readonly target: FrameEffectIntentTarget;
			readonly command: SceneCommand;
			readonly effectLayerStack?: EffectLayerStack;
	  }
	| {
			readonly kind: "unchanged";
			readonly target: FrameEffectIntentTarget;
			readonly effectLayerStack?: EffectLayerStack;
	  }
	| {
			readonly kind: "missing-target";
			readonly target: FrameEffectIntentTarget;
	  };

export type FrameInfluenceMaskOperation =
	| {
			readonly kind: "upsert-field";
			readonly field: EffectFieldDefinitionDraft;
	  }
	| {
			readonly kind: "remove-field";
			readonly fieldId: string;
	  }
	| {
			readonly kind: "link-field";
			readonly assignmentId: string;
			readonly fieldId: string;
	  }
	| {
			readonly kind: "unlink-field";
			readonly assignmentId: string;
	  }
	| {
			readonly kind: "replace-field-source";
			readonly fieldId: string;
			readonly source: EffectMaskSourceDraft;
	  }
	| {
			readonly kind: "attach";
			readonly assignment: EffectInfluenceMaskAssignmentInput;
			readonly index?: number;
	  }
	| {
			readonly kind: "replace";
			readonly assignmentId: string;
			readonly patch: EffectInfluenceMaskAssignmentPatch;
	  }
	| {
			readonly kind: "remove";
			readonly assignmentId: string;
	  }
	| {
			readonly kind: "reorder";
			readonly assignmentId: string;
			readonly toIndex: number;
	  }
	| {
			readonly kind: "append-stack";
			readonly assignmentId: string;
			readonly item: EffectMaskStackItemInput;
			readonly index?: number;
	  }
	| {
			readonly kind: "replace-stack";
			readonly assignmentId: string;
			readonly itemId: string;
			readonly patch: EffectMaskStackItemDraft;
	  }
	| {
			readonly kind: "remove-stack";
			readonly assignmentId: string;
			readonly itemId: string;
	  }
	| {
			readonly kind: "reorder-stack";
			readonly assignmentId: string;
			readonly itemId: string;
			readonly toIndex: number;
	  };

const sameJson = (left: unknown, right: unknown): boolean =>
	JSON.stringify(left) === JSON.stringify(right);

const effectIntentForTarget = (
	document: SceneDocument,
	target: FrameEffectIntentTarget,
): EffectIntent | null | undefined => {
	switch (target.scope) {
		case "scene":
			return document.effectIntent;
		case "current-artboard":
			return selectCurrentArtboard(document).effectIntent;
		case "default-artboard":
			return selectDefaultArtboard(document).effectIntent;
		case "artboard": {
			const artboard = findArtboardById(document, target.artboardId);
			return artboard ? artboard.effectIntent : null;
		}
	}
};

const influenceRecipeForTarget = (
	document: SceneDocument,
	target: FrameEffectIntentTarget,
	currentIntent: EffectIntent | undefined,
): EffectInfluenceRecipe | null => {
	if (target.scope === "scene") return currentIntent?.influenceRecipe ?? null;
	const artboardId =
		target.scope === "artboard"
			? target.artboardId
			: target.scope === "default-artboard"
				? selectDefaultArtboard(document).id
				: selectCurrentArtboard(document).id;
	return resolveFrameEffectIntent(document, artboardId).influenceRecipe;
};

const effectLayerOwnerForTarget = (
	document: SceneDocument,
	target: FrameEffectIntentTarget,
): EffectLayerOwnerRef | null => {
	switch (target.scope) {
		case "scene":
			return { scope: "scene" };
		case "current-artboard":
			return {
				scope: "artboard",
				artboardId: selectCurrentArtboard(document).id,
			};
		case "default-artboard":
			return {
				scope: "artboard",
				artboardId: selectDefaultArtboard(document).id,
			};
		case "artboard":
			return findArtboardById(document, target.artboardId)
				? { scope: "artboard", artboardId: target.artboardId }
				: null;
	}
};

const commandResult = (
	target: FrameEffectIntentTarget,
	command: SceneCommand,
	payload: {
		readonly visualRecipe?: VisualRecipe;
		readonly influenceRecipe?: EffectInfluenceRecipe;
	},
): FrameEffectIntentCommandResult => ({
	kind: "ready",
	target,
	command,
	...payload,
});

const layerKindForRecipePath = (path: string): EffectLayerKind | null => {
	if (path.startsWith("color.")) return "grade";
	if (path.startsWith("glow.")) return "glow";
	if (path.startsWith("texture.")) return "grain";
	return null;
};

/**
 * Reads the frame-level vec-core side-car for a command target. Explicit
 * artboard targets return `null` when stale so feature/UI adapters can skip
 * command creation instead of relying on an empty Immer patch for correctness.
 */
export function readFrameEffectIntentForTarget(
	document: SceneDocument,
	target: FrameEffectIntentTarget,
): EffectIntent | null | undefined {
	return effectIntentForTarget(document, target);
}

/** Reads the explicit or legacy-projected ordered effect stack for one frame target. */
export function readFrameEffectLayerStackForTarget(
	document: SceneDocument,
	target: FrameEffectIntentTarget,
): EffectLayerStack | null {
	const owner = effectLayerOwnerForTarget(document, target);
	const intent = effectIntentForTarget(document, target);
	if (!owner || intent === null) return null;
	return effectLayerStackFromIntent(intent, owner) ?? null;
}

/**
 * Applies one typed layer-stack operation through the existing effect-intent
 * command seam. This keeps Inspector and MCP writes aligned on stable layer ids,
 * order, and one-operation/one-undo semantics.
 */
export function createFrameEffectLayerStackOperationCommand(
	document: SceneDocument,
	target: FrameEffectIntentTarget,
	operation: EffectLayerStackOperation,
	options: FrameEffectIntentCommandOptions = {},
): FrameEffectLayerStackCommandResult {
	const owner = effectLayerOwnerForTarget(document, target);
	const intent = effectIntentForTarget(document, target);
	if (!owner || intent === null) return { kind: "missing-target", target };
	const currentStack = effectLayerStackFromIntent(intent, owner);
	const nextStack = applyEffectLayerStackOperation(
		currentStack,
		operation,
		owner,
	);
	if (sameJson(currentStack ?? null, nextStack ?? null)) {
		return {
			kind: "unchanged",
			target,
			...(nextStack ? { effectLayerStack: nextStack } : {}),
		};
	}
	return {
		kind: "ready",
		target,
		command: createSetEffectLayerStackCommand(target, nextStack, {
			label: "Edit effect stack",
			...options,
		}),
		...(nextStack ? { effectLayerStack: nextStack } : {}),
	};
}

/**
 * Applies one registered vec-core recipe path to a scene/artboard effect intent
 * and returns the existing scene command needed to persist it. The caller passes
 * a scene snapshot so invalid paths, neutral no-ops, and stale artboard targets
 * are rejected before they enter command history.
 */
export function createFrameVisualRecipeControlCommand(
	document: SceneDocument,
	target: FrameEffectIntentTarget,
	path: string,
	value: unknown,
	options: FrameEffectIntentCommandOptions = {},
): FrameEffectIntentCommandResult {
	const currentIntent = effectIntentForTarget(document, target);
	if (currentIntent === null) return { kind: "missing-target", target };
	const owner = effectLayerOwnerForTarget(document, target);
	const currentStack = owner
		? effectLayerStackFromIntent(currentIntent, owner)
		: undefined;
	const layerKind = layerKindForRecipePath(path);
	const layer = layerKind
		? currentStack?.layers.find((candidate) => candidate.kind === layerKind)
		: undefined;
	if (owner && currentStack && layer) {
		const layerResult = updateRecipeControl(layer.visualRecipe, path, value);
		if (
			layerResult.kind === "invalid-path" ||
			layerResult.kind === "invalid-value"
		) {
			return { ...layerResult, target };
		}
		if (layerResult.kind === "unchanged") {
			const projectedRecipe = visualRecipeFromEffectLayerStack(
				currentStack,
				owner,
			);
			return {
				kind: "unchanged",
				target,
				...(projectedRecipe ? { visualRecipe: projectedRecipe } : {}),
			};
		}
		const nextStack = applyEffectLayerStackOperation(
			currentStack,
			{
				kind: "update",
				layerId: layer.id,
				patch: { visualRecipe: layerResult.recipe },
			},
			owner,
		);
		return commandResult(
			target,
			createSetEffectLayerStackCommand(target, nextStack, {
				label: "Edit frame look",
				...options,
			}),
			(() => {
				const projectedRecipe = visualRecipeFromEffectLayerStack(
					nextStack,
					owner,
				);
				return projectedRecipe ? { visualRecipe: projectedRecipe } : {};
			})(),
		);
	}

	const result = updateRecipeControl(currentIntent?.visualRecipe, path, value);
	if (result.kind === "invalid-path" || result.kind === "invalid-value") {
		return { ...result, target };
	}
	if (result.kind === "unchanged") {
		return { kind: "unchanged", target, visualRecipe: result.recipe };
	}

	return commandResult(
		target,
		createUpdateEffectIntentCommand(
			target,
			{ effectLayerStack: null, visualRecipe: result.recipe },
			{ label: "Edit frame look", ...options },
		),
		{ visualRecipe: result.recipe },
	);
}

/**
 * Applies a COMPLETE vec-core visual recipe (a recallable saved frame look) to a
 * scene/artboard effect intent and returns the undoable command. Unlike
 * {@link createFrameVisualRecipeControlCommand} (which edits one canonical path),
 * this replaces the whole frame look in a single command. It is a no-op when the
 * target already carries an equal recipe, so repeated one-click recalls do not
 * flood command history. The recipe is normalized on both sides of the compare so
 * a canonical (already-normalized) saved look matches the normalized stored value.
 */
export function createFrameVisualRecipeApplyCommand(
	document: SceneDocument,
	target: FrameEffectIntentTarget,
	recipe: VisualRecipe,
	options: FrameEffectIntentCommandOptions = {},
): FrameEffectIntentCommandResult {
	const currentIntent = effectIntentForTarget(document, target);
	if (currentIntent === null) return { kind: "missing-target", target };

	const nextRecipe = normalizeVisualRecipe(recipe);
	const currentRecipe = currentIntent?.visualRecipe ?? null;
	if (
		!currentIntent?.effectLayerStack &&
		currentRecipe &&
		sameJson(normalizeVisualRecipe(currentRecipe), nextRecipe)
	) {
		return { kind: "unchanged", target, visualRecipe: nextRecipe };
	}

	return commandResult(
		target,
		createUpdateEffectIntentCommand(
			target,
			{ effectLayerStack: null, visualRecipe: nextRecipe },
			{ label: "Apply frame look", ...options },
		),
		{ visualRecipe: nextRecipe },
	);
}

/**
 * Runs a pure influence-mask operation against a frame side-car recipe. It is a
 * thin switch over vec-core authoring helpers so masks stay in the canonical
 * `EffectInfluenceRecipe` shape before command creation.
 */
export function applyFrameInfluenceMaskOperation(
	recipe: EffectInfluenceRecipeDraft | null | undefined,
	operation: FrameInfluenceMaskOperation,
): EffectInfluenceRecipe {
	const current = normalizeEffectInfluenceRecipe(recipe ?? undefined);
	switch (operation.kind) {
		case "upsert-field":
			return upsertEffectFieldDefinition(current, operation.field);
		case "remove-field":
			return removeEffectFieldDefinition(current, operation.fieldId);
		case "link-field":
			return linkEffectInfluenceAssignmentField(
				current,
				operation.assignmentId,
				operation.fieldId,
			);
		case "unlink-field":
			return unlinkEffectInfluenceAssignmentField(
				current,
				operation.assignmentId,
			);
		case "replace-field-source":
			return replaceEffectFieldSource(
				current,
				operation.fieldId,
				operation.source,
			);
		case "attach":
			return attachEffectInfluenceMask(
				current,
				operation.assignment,
				operation.index,
			);
		case "replace":
			return {
				...replaceEffectInfluenceMask(
					current,
					operation.assignmentId,
					operation.patch,
				),
				enabled: true,
			};
		case "remove":
			return removeEffectInfluenceMask(current, operation.assignmentId);
		case "reorder":
			return reorderEffectInfluenceMask(
				current,
				operation.assignmentId,
				operation.toIndex,
			);
		case "append-stack":
			return appendEffectInfluenceStackMask(
				current,
				operation.assignmentId,
				operation.item,
				operation.index,
			);
		case "replace-stack":
			return replaceEffectInfluenceStackMask(
				current,
				operation.assignmentId,
				operation.itemId,
				operation.patch,
			);
		case "remove-stack":
			return removeEffectInfluenceStackMask(
				current,
				operation.assignmentId,
				operation.itemId,
			);
		case "reorder-stack":
			return reorderEffectInfluenceStackMask(
				current,
				operation.assignmentId,
				operation.itemId,
				operation.toIndex,
			);
	}
}

/**
 * Converts a frame influence-mask authoring operation into an undoable scene
 * command. No command is returned when the operation is a semantic no-op, which
 * keeps missing assignment ids and stale artboard targets out of history.
 */
export function createFrameInfluenceMaskCommand(
	document: SceneDocument,
	target: FrameEffectIntentTarget,
	operation: FrameInfluenceMaskOperation,
	options: FrameEffectIntentCommandOptions = {},
): FrameEffectIntentCommandResult {
	const currentIntent = effectIntentForTarget(document, target);
	if (currentIntent === null) return { kind: "missing-target", target };

	const currentRecipe = normalizeEffectInfluenceRecipe(
		influenceRecipeForTarget(document, target, currentIntent) ?? undefined,
	);
	const nextRecipe = applyFrameInfluenceMaskOperation(currentRecipe, operation);
	if (sameJson(currentRecipe, nextRecipe)) {
		return { kind: "unchanged", target, influenceRecipe: currentRecipe };
	}

	return commandResult(
		target,
		createUpdateEffectIntentCommand(
			target,
			{ influenceRecipe: nextRecipe },
			{ label: "Edit influence mask", ...options },
		),
		{ influenceRecipe: nextRecipe },
	);
}
