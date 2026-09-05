import { castDraft, type Draft } from "immer";
import type { SceneCommand } from "./command";
import type { MotionConflictView } from "./component-props";
import { cloneSceneDocument } from "./factory";
import {
	createUpdateNodeStyleCommand,
	createUpdateTextNodeCommand,
} from "./node-commands";
import { findDraftNode } from "./selectors";
import {
	type CreateStylePresetOptions,
	createStylePreset,
	normalizeStylePreset,
	normalizeStylePresetTypography,
	readStylePresets,
} from "./style-presets";
import type { SceneDocument, StylePreset } from "./types";

/**
 * Undoable command bridge for the document style-preset library. Every mutation
 * here flows through the scene command bus so add/apply/rename/remove are single
 * Immer-patch entries with one-gesture-one-undo semantics. The pure normalization
 * and value-copy apply rules live in `style-presets.ts`; these commands only wire
 * them to the draft document.
 */

const normalizedLabel = (value: string): string | null => {
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
};

const writePresetLibrary = (
	draft: Draft<SceneDocument>,
	presets: readonly StylePreset[],
): void => {
	draft.stylePresets = castDraft(cloneSceneDocument(presets));
};

/**
 * Adds a normalized preset to the document library. The preset is minted against
 * the live library so ids and names stay collision-free, and an empty payload is
 * a safe no-op rather than a stored no-op preset. The minted id is deterministic
 * only when `options.id` is supplied; otherwise callers should plan ids with
 * `createStylePreset` before applying if they need the id for follow-up actions.
 */
export function createAddStylePresetCommand(
	options: CreateStylePresetOptions = {},
	commandOptions: { readonly label?: string } = {},
): SceneCommand {
	return {
		type: "scene/add-style-preset",
		label: commandOptions.label ?? "Add style preset",
		run: (draft) => {
			const presets = readStylePresets(draft);
			const preset = createStylePreset(presets, options);
			if (!preset) return;
			writePresetLibrary(draft, [...presets, preset]);
		},
	};
}

/**
 * Inserts an already-minted preset into the library. This is the deterministic
 * companion to `createAddStylePresetCommand`: callers that need the new preset id
 * up front mint it with `createStylePreset(readStylePresets(doc), ...)` and pass
 * the result here. Collisions with the live library are a no-op so stale plans
 * cannot overwrite an existing preset.
 */
export function createInsertStylePresetCommand(
	preset: StylePreset,
	options: { readonly label?: string } = {},
): SceneCommand {
	return {
		type: "scene/insert-style-preset",
		label: options.label ?? "Add style preset",
		run: (draft) => {
			const normalized = normalizeStylePreset(preset);
			if (!normalized) return;
			const presets = readStylePresets(draft);
			if (presets.some((existing) => existing.id === normalized.id)) return;
			if (presets.some((existing) => existing.name === normalized.name)) return;
			writePresetLibrary(draft, [...presets, normalized]);
		},
	};
}

/**
 * Applies one preset to a set of nodes as a single undoable entry. Paint is
 * assigned with the same clamps as `createUpdateNodeStyleCommand`, and typography
 * (text nodes only) is applied through `createUpdateTextNodeCommand`, which keeps
 * bounds resizing identical to direct text-style edits. Missing nodes and a
 * missing preset are no-ops, so an empty selection or stale id creates no history.
 */
export function createApplyStylePresetCommand(
	presetId: string,
	nodeIds: readonly string[],
	options: {
		readonly label?: string;
		readonly grammarTargetNodeIds?: ReadonlySet<string>;
		readonly motion?: MotionConflictView;
	} = {},
): SceneCommand {
	const targetIds = [...new Set(nodeIds)];
	return {
		type: "scene/apply-style-preset",
		label: options.label ?? "Apply style preset",
		run: (draft) => {
			const preset = readStylePresets(draft).find(
				(entry) => entry.id === presetId,
			);
			if (!preset || targetIds.length === 0) return;

			for (const nodeId of targetIds) {
				const node = findDraftNode(draft, nodeId);
				if (!node) continue;
				if (preset.paint) {
					// Delegate to the node-style command body so paint clamping and
					// field handling stay byte-identical to direct style edits.
					createUpdateNodeStyleCommand(nodeId, preset.paint, {
						grammarTargetNodeIds: options.grammarTargetNodeIds,
						motion: options.motion,
					}).run(draft);
				}
				if (preset.appearance) {
					// Rich appearance fields are a subset of the node-style patch, so the
					// same command applies the fill/stroke stacks, effects, blend, and
					// stroke geometry with identical clamping. Runs after `paint` so the
					// expressive stacks win over the legacy single-color part.
					createUpdateNodeStyleCommand(nodeId, preset.appearance, {
						grammarTargetNodeIds: options.grammarTargetNodeIds,
						motion: options.motion,
					}).run(draft);
				}
				if (preset.typography && node.geometry.kind === "text") {
					createUpdateTextNodeCommand(
						nodeId,
						{ style: preset.typography },
						{ label: "Apply style preset" },
					).run(draft);
				}
			}
		},
	};
}

/**
 * Renames a preset while refusing blank names and duplicate names. Missing ids
 * are a no-op so optimistic panel edits can race safely with other library edits.
 */
export function createRenameStylePresetCommand(
	presetId: string,
	name: string,
): SceneCommand {
	return {
		type: "scene/rename-style-preset",
		label: "Rename style preset",
		run: (draft) => {
			const nextName = normalizedLabel(name);
			if (!nextName) return;
			const presets = readStylePresets(draft);
			const target = presets.find((preset) => preset.id === presetId);
			if (!target || target.name === nextName) return;
			if (presets.some((preset) => preset.name === nextName)) return;
			writePresetLibrary(
				draft,
				presets.map((preset) =>
					preset.id === presetId ? { ...preset, name: nextName } : preset,
				),
			);
		},
	};
}

/**
 * Replaces a preset's reusable payload with a freshly captured style while
 * preserving the preset id and name. This is the Inspector "update style"
 * command: it lets artists refresh a saved color or text style from the current
 * selection without creating a second preset, and it remains a single undoable
 * scene-library edit.
 */
export function createReplaceStylePresetCommand(
	presetId: string,
	options: CreateStylePresetOptions,
): SceneCommand {
	return {
		type: "scene/replace-style-preset",
		label: "Update style preset",
		run: (draft) => {
			const presets = readStylePresets(draft);
			const target = presets.find((preset) => preset.id === presetId);
			if (!target) return;
			const next = normalizeStylePreset({
				id: target.id,
				name: target.name,
				kind: options.kind ?? target.kind,
				...(options.paint ? { paint: options.paint } : {}),
				...(options.typography ? { typography: options.typography } : {}),
				...(options.appearance ? { appearance: options.appearance } : {}),
			});
			if (!next) return;
			if (JSON.stringify(target) === JSON.stringify(next)) return;
			writePresetLibrary(
				draft,
				presets.map((preset) => (preset.id === presetId ? next : preset)),
			);
		},
	};
}

/**
 * Replaces a preset's typography part with a normalized payload. An empty result
 * is a no-op so a preset never loses its last usable payload to an invalid edit.
 */
export function createUpdateStylePresetTypographyCommand(
	presetId: string,
	typography: StylePreset["typography"],
): SceneCommand {
	return {
		type: "scene/update-style-preset-typography",
		label: "Edit style preset",
		run: (draft) => {
			const normalized = normalizeStylePresetTypography(typography);
			if (!normalized) return;
			const presets = readStylePresets(draft);
			const target = presets.find((preset) => preset.id === presetId);
			if (!target) return;
			// `writePresetLibrary` replaces the whole array reference, so Immer would
			// always emit a patch. Guard on content equality to keep this a true
			// no-op (no spurious undo entry) when the typography is unchanged. Both
			// sides are normalized with a fixed key order, so stable-string compare
			// is deterministic.
			if (
				target.typography &&
				JSON.stringify(target.typography) === JSON.stringify(normalized)
			) {
				return;
			}
			writePresetLibrary(
				draft,
				presets.map((preset) =>
					preset.id === presetId
						? { ...preset, typography: normalized }
						: preset,
				),
			);
		},
	};
}

/**
 * Removes a preset from the library. Missing ids are a no-op. Applied nodes keep
 * their value-copied styles because presets are not live links, so removal never
 * reverts node appearance.
 */
export function createRemoveStylePresetCommand(presetId: string): SceneCommand {
	return {
		type: "scene/remove-style-preset",
		label: "Remove style preset",
		run: (draft) => {
			const presets = readStylePresets(draft);
			if (!presets.some((preset) => preset.id === presetId)) return;
			writePresetLibrary(
				draft,
				presets.filter((preset) => preset.id !== presetId),
			);
		},
	};
}

/**
 * Moves one preset inside the durable library order. The target index is
 * clamped to the live array so stale UI/Agent plans cannot create sparse
 * entries; missing ids and already-satisfied positions remain true no-ops.
 */
export function createReorderStylePresetCommand(
	presetId: string,
	toIndex: number,
): SceneCommand {
	return {
		type: "scene/reorder-style-preset",
		label: "Reorder style preset",
		run: (draft) => {
			if (!Number.isInteger(toIndex)) return;
			const presets = readStylePresets(draft);
			const fromIndex = presets.findIndex((preset) => preset.id === presetId);
			if (fromIndex < 0 || presets.length < 2) return;
			const targetIndex = Math.min(Math.max(toIndex, 0), presets.length - 1);
			if (targetIndex === fromIndex) return;
			const next = [...presets];
			const [moved] = next.splice(fromIndex, 1);
			if (!moved) return;
			next.splice(targetIndex, 0, moved);
			writePresetLibrary(draft, next);
		},
	};
}
