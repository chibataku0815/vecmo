import type { SceneCommand } from "./command";
import {
	applyEffectLayerStackOperation,
	type EffectLayerStack,
	type EffectLayerStackDraft,
	type EffectLayerStackOperation,
	normalizeEffectLayerStack,
	visualRecipeFromEffectLayerStack,
} from "./effect-layer-stack";
import {
	createUpdateEffectIntentCommand,
	type EffectIntentTarget,
	type UpdateEffectIntentOptions,
} from "./node-commands";

export type UpdateEffectLayerStackOptions = UpdateEffectIntentOptions;

/**
 * Replaces the explicit effect-layer stack on a scene/artboard effect intent.
 * The command still flows through `scene/update-effect-intent`, so persistence,
 * undo coalescing, and artboard targeting remain on the existing command-bus
 * seam.
 */
export function createSetEffectLayerStackCommand(
	target: EffectIntentTarget,
	stack: EffectLayerStack | EffectLayerStackDraft | null | undefined,
	options: UpdateEffectLayerStackOptions = {},
): SceneCommand {
	const normalizedStack = normalizeEffectLayerStack(stack);
	return createUpdateEffectIntentCommand(
		target,
		{
			effectLayerStack: normalizedStack ?? null,
			visualRecipe: visualRecipeFromEffectLayerStack(normalizedStack) ?? null,
		},
		{
			label: options.label ?? "Edit effect stack",
			coalesceKey: options.coalesceKey,
		},
	);
}

/**
 * Applies one pure layer-stack operation to a known stack and returns the
 * undoable scene command that persists the result. Callers provide the current
 * stack from their read model, keeping mutation decisions outside React widgets
 * and MCP adapters.
 */
export function createApplyEffectLayerStackOperationCommand(
	target: EffectIntentTarget,
	currentStack: EffectLayerStack | EffectLayerStackDraft | null | undefined,
	operation: EffectLayerStackOperation,
	options: UpdateEffectLayerStackOptions = {},
): SceneCommand {
	return createSetEffectLayerStackCommand(
		target,
		applyEffectLayerStackOperation(currentStack, operation),
		options,
	);
}
