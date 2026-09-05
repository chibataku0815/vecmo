import { castDraft, type Draft } from "immer";
import type { SceneCommand } from "./command";
import { cloneSceneDocument } from "./factory";
import {
	type CreateInteractionOptions,
	createInteraction,
	normalizeInteractionDefinition,
	readInteractions,
} from "./interactions";
import type {
	InteractionAction,
	InteractionDefinition,
	InteractionTrigger,
	SceneDocument,
} from "./types";

/**
 * Undoable command bridge for the document interaction library (Interactive
 * Motion program, T3-S1: document model + agent authoring only). Every
 * mutation here flows through the scene command bus so add/update/remove are
 * single Immer-patch entries with one-gesture-one-undo semantics. The pure
 * normalization and validation rules live in `interactions.ts`; these commands
 * only wire them to the draft document. Mirrors `component-prop-commands.ts`'s
 * shape.
 */

const writeInteractionLibrary = (
	draft: Draft<SceneDocument>,
	interactions: readonly InteractionDefinition[],
): void => {
	draft.interactions = castDraft(cloneSceneDocument(interactions));
};

/**
 * Adds a normalized, collision-free interaction to the document library. An
 * empty `actions` list, or a supplied `options.id` that already exists, is a
 * safe no-op (`createInteraction` returns `null`) rather than a stored
 * malformed/duplicate-id interaction — callers that need the specific refusal
 * reason for a typed issue should check those conditions themselves before
 * dispatching (this is what the agent write boundary does).
 */
export function createAddInteractionCommand(
	options: CreateInteractionOptions,
	commandOptions: { readonly label?: string } = {},
): SceneCommand {
	return {
		type: "scene/add-interaction",
		label: commandOptions.label ?? "Add interaction",
		run: (draft) => {
			const interactions = readInteractions(draft);
			const interaction = createInteraction(interactions, options);
			if (!interaction) return;
			writeInteractionLibrary(draft, [...interactions, interaction]);
		},
	};
}

/** Partial patch for `createUpdateInteractionCommand`. `trigger`/`actions`, when present, REPLACE the interaction's trigger/action list wholesale rather than merging into it. */
export type InteractionUpdatePatch = {
	readonly name?: string;
	readonly trigger?: InteractionTrigger;
	readonly actions?: readonly InteractionAction[];
};

/**
 * Applies a partial patch to an existing interaction. A missing interaction id
 * is a no-op. `patch.actions`, if present and empty, is dropped from the patch
 * (an interaction cannot be patched down to zero actions — remove it instead)
 * rather than refusing the whole update, so a caller batching an actions
 * replacement with a trigger change still applies the valid parts — the agent
 * write boundary pre-checks non-empty actions separately and refuses the whole
 * command on an empty list instead, matching its "typed issue instead of a
 * partial silent apply" convention. The merged result is re-normalized through
 * `normalizeInteractionDefinition` so a malformed trigger cannot corrupt the
 * stored interaction; a patch that normalizes to an unchanged or invalid
 * record is a no-op.
 */
export function createUpdateInteractionCommand(
	interactionId: string,
	patch: InteractionUpdatePatch,
): SceneCommand {
	return {
		type: "scene/update-interaction",
		label: "Edit interaction",
		run: (draft) => {
			const interactions = readInteractions(draft);
			const target = interactions.find(
				(interaction) => interaction.id === interactionId,
			);
			if (!target) return;

			const nextActions =
				patch.actions !== undefined && patch.actions.length > 0
					? patch.actions
					: target.actions;
			const nextName =
				patch.name !== undefined ? patch.name.trim() : target.name;

			const normalized = normalizeInteractionDefinition({
				id: target.id,
				...(nextName ? { name: nextName } : {}),
				trigger: patch.trigger ?? target.trigger,
				actions: nextActions,
			});
			if (!normalized) return;
			if (JSON.stringify(target) === JSON.stringify(normalized)) return;

			writeInteractionLibrary(
				draft,
				interactions.map((interaction) =>
					interaction.id === interactionId ? normalized : interaction,
				),
			);
		},
	};
}

/** Removes an interaction from the library. Missing ids are a no-op. */
export function createRemoveInteractionCommand(
	interactionId: string,
): SceneCommand {
	return {
		type: "scene/remove-interaction",
		label: "Remove interaction",
		run: (draft) => {
			const interactions = readInteractions(draft);
			if (!interactions.some((interaction) => interaction.id === interactionId))
				return;
			writeInteractionLibrary(
				draft,
				interactions.filter((interaction) => interaction.id !== interactionId),
			);
		},
	};
}
