/**
 * Undoable command bridge for the Codeable-Duplicate generator side-car. Each
 * mutation is one Immer-patch entry (one edit = one undo). v1 keeps at most one
 * generator per source node (`gen:<sourceNodeId>`), so setting replaces in place.
 */

import { castDraft, type Draft } from "immer";
import type { SceneCommand } from "./command";
import type { DuplicateGeneratorBinding } from "./duplicate-generator";
import type { SceneDocument } from "./types";

/** Deterministic generator id for the single-generator-per-node v1 model. */
export const duplicateGeneratorIdForNode = (nodeId: string): string =>
	`gen:${nodeId}`;

const readGenerators = (
	draft: Draft<SceneDocument>,
): readonly DuplicateGeneratorBinding[] => draft.duplicateGenerators ?? [];

/** Sets (or replaces) one duplicate generator, keyed by its `id`. */
export function createSetDuplicateGeneratorCommand(
	generator: DuplicateGeneratorBinding,
): SceneCommand {
	return {
		type: "scene/set-duplicate-generator",
		label: "Set duplicate generator",
		run: (draft) => {
			const next = readGenerators(draft).filter(
				(existing) => existing.id !== generator.id,
			);
			next.push(generator);
			draft.duplicateGenerators = castDraft(next);
		},
	};
}

/** Removes one duplicate generator by id. A missing id is a typed no-op. */
export function createRemoveDuplicateGeneratorCommand(
	generatorId: string,
): SceneCommand {
	return {
		type: "scene/remove-duplicate-generator",
		label: "Remove duplicate generator",
		run: (draft) => {
			const existing = readGenerators(draft);
			const next = existing.filter((generator) => generator.id !== generatorId);
			if (next.length === existing.length) return;
			draft.duplicateGenerators = castDraft(next);
		},
	};
}
