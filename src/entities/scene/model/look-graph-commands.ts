import type { SceneCommand } from "./command";
import {
	type LookGraph,
	type LookGraphDraft,
	normalizeLookGraph,
} from "./look-graph";
import {
	applyLookGraphOperation,
	type LookGraphOperation,
} from "./look-graph-operations";
import { visualRecipeFromLookGraph } from "./look-graph-project";
import {
	createUpdateEffectIntentCommand,
	type EffectIntentTarget,
	type UpdateEffectIntentOptions,
} from "./node-commands";

export type UpdateLookGraphOptions = UpdateEffectIntentOptions;

/**
 * Replaces the graph-first Look on a scene/artboard effect intent and keeps the
 * compatibility slots coherent. The write flows through
 * `scene/update-effect-intent`, so persistence, undo coalescing, and artboard
 * targeting reuse the existing command-bus seam.
 *
 * `lookGraph` is canonical; the redundant explicit `effectLayerStack` is cleared
 * (so a stale stack cannot shadow the graph through `effectLayerStackFromIntent`)
 * and `visualRecipe` is rewritten to the serial-graph projection so an existing
 * canvas/export renderer reflects the graph edit immediately. A non-serial
 * (branch) graph projects to no recipe and awaits the graph runtime.
 */
export function createSetLookGraphCommand(
	target: EffectIntentTarget,
	graph: LookGraph | LookGraphDraft | null | undefined,
	options: UpdateLookGraphOptions = {},
): SceneCommand {
	const normalized = normalizeLookGraph(graph);
	return createUpdateEffectIntentCommand(
		target,
		{
			lookGraph: normalized ?? null,
			effectLayerStack: null,
			visualRecipe: normalized
				? (visualRecipeFromLookGraph(normalized) ?? null)
				: null,
		},
		{
			label: options.label ?? "Edit look graph",
			coalesceKey: options.coalesceKey,
		},
	);
}

/**
 * Applies one pure graph operation to a known graph and returns the undoable
 * scene command that persists the result. Callers provide the current graph from
 * their read model (e.g. {@link lookGraphFromIntent}), keeping mutation decisions
 * out of React widgets and MCP adapters and guaranteeing one edit per undo entry.
 */
export function createApplyLookGraphOperationCommand(
	target: EffectIntentTarget,
	currentGraph: LookGraph | LookGraphDraft | null | undefined,
	operation: LookGraphOperation,
	options: UpdateLookGraphOptions = {},
): SceneCommand {
	return createSetLookGraphCommand(
		target,
		applyLookGraphOperation(currentGraph, operation),
		options,
	);
}
