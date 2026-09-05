import type {
	MotionGrammarCommand,
	MotionGrammarStoreDocument,
} from "@/entities/motion-grammar/model/command";
import { applyGrammarBinding } from "@/entities/motion-grammar/model/commands";
import { selectComponentInstanceNodes } from "@/entities/scene/model/component-symbols";
import type { SceneDocument } from "@/entities/scene/model/types";
import { deepEqual } from "@/shared/lib/deep-equal";
import { cloneInstanceGrammarBindings } from "./clone-grammar";

/**
 * Plans the grammar-store resync that keeps every linked instance's motion-grammar
 * bindings in step with its master after the master's grammar is edited — the
 * grammar half of propagate-sync (mirrors {@link planMotionPropagation}).
 *
 * For each instance it re-derives the cloned bindings from the current master
 * bindings and emits an `applyGrammarBinding` upsert ONLY when the live instance
 * binding (matched by deterministic id) differs from the freshly cloned one. The
 * deep-equality skip makes the pass idempotent: dispatching it on every grammar
 * commit converges without looping and without spawning redundant history.
 *
 * `symbolIds`, when provided, narrows the resync to instances of those component
 * symbols only — see {@link planMotionPropagation}'s matching parameter (used by
 * the agent `motion-grammar/propagate-to-instances` command's `sourceNodeIds`
 * scoping). Omitted propagates every linked instance, unchanged prior behavior.
 */
export function planGrammarPropagation(
	scene: SceneDocument,
	grammar: MotionGrammarStoreDocument,
	symbolIds?: ReadonlySet<string>,
): readonly MotionGrammarCommand[] {
	const existingById = new Map(
		grammar.bindings.map((binding) => [binding.id, binding]),
	);
	return selectComponentInstanceNodes(scene)
		.filter((entry) => !symbolIds || symbolIds.has(entry.binding.symbolId))
		.flatMap((entry) =>
			cloneInstanceGrammarBindings(
				grammar.bindings,
				entry.binding.sourceToInstanceNodeIds,
				entry.node.id,
			).flatMap((clone) => {
				const existing = existingById.get(clone.id);
				if (existing && deepEqual(existing, clone)) return [];
				return [applyGrammarBinding(clone)];
			}),
		);
}
