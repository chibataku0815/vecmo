import type { MotionCommand } from "@/entities/motion/model/command";
import { copyMotionTracksForInstance } from "@/entities/motion/model/commands";
import type { MotionGrammarCommand } from "@/entities/motion-grammar/model/command";
import { applyGrammarBinding } from "@/entities/motion-grammar/model/commands";
import type { MotionGrammarBinding } from "@/entities/motion-grammar/model/types";
import type { SceneCommand } from "@/entities/scene/model/command";
import { createInsertComponentInstanceCommand } from "@/entities/scene/model/component-symbol-commands";
import {
	type CreateComponentInstanceOptions,
	planComponentInstance,
} from "@/entities/scene/model/component-symbols";
import type { SceneDocument } from "@/entities/scene/model/types";
import { cloneInstanceGrammarBindings } from "./clone-grammar";

export type PlanLinkedInstanceOptions = CreateComponentInstanceOptions & {
	/** Live grammar side-car snapshot paired with the scene/motion snapshot. */
	readonly grammarBindings?: readonly MotionGrammarBinding[];
	readonly sceneLabel?: string;
	readonly motionLabel?: string;
};

/**
 * Cross-store plan for creating a component instance that ALSO carries its
 * master's motion. The component model and the motion timeline are independent
 * stores keyed by node id, so a scene-only instance clone (the existing
 * `createInsertComponentInstanceCommand`) lands a visually identical but DEAD
 * copy — its motion tracks still target the master's node ids. This orchestrator
 * pairs the scene insert with a motion copy keyed off the same
 * `sourceToInstanceNodeIds` map so the instance animates immediately.
 *
 * It mirrors `entities/agent` as the in-repo precedent for an entity-layer module
 * that coordinates the scene and motion stores; the caller is responsible for
 * dispatching each command to its own store's command bus.
 */
export type LinkedInstancePlan = {
	readonly sceneCommand: SceneCommand;
	/**
	 * Motion-store command that copies the master's keyframe tracks onto the new
	 * instance nodes. A no-op (and skipped by the motion store) when the master has
	 * no authored motion, but always present so callers dispatch uniformly.
	 */
	readonly motionCommand: MotionCommand;
	/** Grammar-store commands for every fully-contained source binding. */
	readonly grammarCommands: readonly MotionGrammarCommand[];
	/** Deterministic suffix/undo identity for this linked clone. */
	readonly instanceKey: string;
	readonly selectNodeIds: readonly [string];
	/** Source-node-id → instance-node-id map, the sole source→instance relation. */
	readonly sourceToInstanceNodeIds: Readonly<Record<string, string>>;
};

export type LinkedInstanceCompanionPlan = Pick<
	LinkedInstancePlan,
	| "motionCommand"
	| "grammarCommands"
	| "instanceKey"
	| "sourceToInstanceNodeIds"
>;

/**
 * Plans the Motion + Grammar side-cars for any Scene-owned component clone.
 * Both saved-source creation and instance placement use this mapping contract.
 */
export function planLinkedInstanceCompanions(options: {
	readonly sourceToInstanceNodeIds: Readonly<Record<string, string>>;
	readonly instanceKey: string;
	readonly grammarBindings?: readonly MotionGrammarBinding[];
	readonly motionLabel?: string;
}): LinkedInstanceCompanionPlan {
	const motionCommand = copyMotionTracksForInstance({
		sourceToInstanceNodeIds: options.sourceToInstanceNodeIds,
		label: options.motionLabel ?? "Carry component motion",
	});
	const grammarCommands = cloneInstanceGrammarBindings(
		options.grammarBindings ?? [],
		options.sourceToInstanceNodeIds,
		options.instanceKey,
	).map(applyGrammarBinding);
	return {
		motionCommand,
		grammarCommands,
		instanceKey: options.instanceKey,
		sourceToInstanceNodeIds: options.sourceToInstanceNodeIds,
	};
}

/**
 * Plans a linked component instance from a symbol against the live scene. Returns
 * `null` when the symbol cannot be instanced (missing symbol, source already an
 * instance, no target layer) — the same failure surface as
 * {@link planComponentInstance}, which it wraps.
 *
 * Coordinate spaces: node positions and the animated `x`/`y` channels are
 * artboard-local, so the copied tracks need no rebase — see
 * {@link copyMotionTracksForInstance}.
 */
export function planLinkedInstance(
	scene: SceneDocument,
	symbolId: string,
	options: PlanLinkedInstanceOptions = {},
): LinkedInstancePlan | null {
	const {
		grammarBindings = [],
		sceneLabel = "Create linked instance",
		motionLabel = "Carry component motion",
		...instanceOptions
	} = options;
	const instancePlan = planComponentInstance(scene, symbolId, instanceOptions);
	if (!instancePlan) return null;

	const sceneCommand = createInsertComponentInstanceCommand(instancePlan, {
		label: sceneLabel,
	});
	const companions = planLinkedInstanceCompanions({
		sourceToInstanceNodeIds: instancePlan.sourceToInstanceNodeIds,
		grammarBindings,
		instanceKey: instancePlan.rootNode.id,
		motionLabel,
	});

	return {
		sceneCommand,
		...companions,
		selectNodeIds: [instancePlan.rootNode.id],
	};
}

export type LinkedInstanceCommandDispatchers = {
	readonly scene: (command: SceneCommand) => void;
	readonly motion: (command: MotionCommand) => void;
	readonly grammar: (command: MotionGrammarCommand) => void;
};

/**
 * Commits one Scene + Motion + Grammar instance plan under a shared compound id.
 * Grammar clones share one coalesce key so global undo pops exactly one history
 * entry per store even when the source owns several technique bindings.
 */
export function commitLinkedInstancePlan(
	plan: LinkedInstancePlan,
	dispatchers: LinkedInstanceCommandDispatchers,
	compoundId: string,
): void {
	dispatchers.scene({ ...plan.sceneCommand, compoundId });
	commitLinkedInstanceCompanions(plan, dispatchers, compoundId);
}

/** Commits only the Motion + Grammar half after callers apply Scene commands. */
export function commitLinkedInstanceCompanions(
	plan: LinkedInstanceCompanionPlan,
	dispatchers: Pick<LinkedInstanceCommandDispatchers, "motion" | "grammar">,
	compoundId: string,
): void {
	dispatchers.motion({ ...plan.motionCommand, compoundId });
	const grammarCoalesceKey = `component-instance-grammar:${plan.instanceKey}`;
	for (const command of plan.grammarCommands) {
		dispatchers.grammar({
			...command,
			compoundId,
			coalesceKey: grammarCoalesceKey,
		});
	}
}
