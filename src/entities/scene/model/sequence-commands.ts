import { castDraft, type Draft } from "immer";
import { createId } from "@/shared/lib/id";
import type { SceneCommand } from "./command";
import { selectSceneArtboards } from "./selectors";
import type { SceneDocument, SceneSequence, SceneSequenceItem } from "./types";

const DEFAULT_SEQUENCE_NAME = "Main sequence";
const CUT_TRANSITION = { kind: "cut" } as const;

const positiveIntegerOrNull = (value: number): number | null => {
	if (!Number.isFinite(value) || value <= 0) return null;
	return Math.max(1, Math.round(value));
};

const sequenceItemsEqual = (
	left: readonly SceneSequenceItem[],
	right: readonly SceneSequenceItem[],
): boolean => JSON.stringify(left) === JSON.stringify(right);

const writeSequence = (
	draft: Draft<SceneDocument>,
	sequence: SceneSequence | undefined,
): void => {
	if (sequence === undefined) {
		if (draft.sequence !== undefined) delete draft.sequence;
		return;
	}
	if (
		draft.sequence?.id === sequence.id &&
		draft.sequence.name === sequence.name &&
		Object.is(draft.sequence.fps, sequence.fps) &&
		JSON.stringify(draft.sequence.exportSize ?? null) ===
			JSON.stringify(sequence.exportSize ?? null) &&
		sequenceItemsEqual(draft.sequence.items, sequence.items)
	) {
		return;
	}
	draft.sequence = castDraft(sequence);
};

const sequenceWithItems = (
	sequence: SceneSequence,
	items: readonly SceneSequenceItem[],
): SceneSequence => ({
	...sequence,
	items,
});

/**
 * Creates or refreshes the document-level scene sequence from exportable scene
 * artboards. Existing matching items keep their ids, labels, durations, and
 * transition metadata, and refresh preserves the current sequence order while
 * appending newly created scene artboards.
 */
export function createInitializeSceneSequenceCommand(
	options: { readonly label?: string; readonly name?: string } = {},
): SceneCommand {
	return {
		type: "scene/sequence-initialize",
		label: options.label ?? "Create scene sequence",
		run: (draft) => {
			const sceneArtboards = selectSceneArtboards(draft);
			if (sceneArtboards.length === 0) return;

			const existingSequence = draft.sequence;
			const existingByArtboardId = new Map(
				(existingSequence?.items ?? []).map((item) => [item.artboardId, item]),
			);
			const sceneArtboardIds = new Set(
				sceneArtboards.map((artboard) => artboard.id),
			);
			const items = (existingSequence?.items ?? []).filter((item) =>
				sceneArtboardIds.has(item.artboardId),
			);
			const includedArtboardIds = new Set(items.map((item) => item.artboardId));
			const newItems = sceneArtboards.flatMap((artboard) => {
				if (includedArtboardIds.has(artboard.id)) return [];
				const existing = existingByArtboardId.get(artboard.id);
				includedArtboardIds.add(artboard.id);
				return [
					{
						id: existing?.id ?? createId("sequence-item"),
						artboardId: artboard.id,
						label: existing?.label ?? artboard.name,
						...(existing?.durationFrames !== undefined
							? { durationFrames: existing.durationFrames }
							: {}),
						transition: existing?.transition ?? CUT_TRANSITION,
					},
				];
			});
			const nextSequence: SceneSequence = {
				id: existingSequence?.id ?? createId("sequence"),
				name: options.name ?? existingSequence?.name ?? DEFAULT_SEQUENCE_NAME,
				...(existingSequence?.fps !== undefined
					? { fps: existingSequence.fps }
					: {}),
				...(existingSequence?.exportSize !== undefined
					? { exportSize: existingSequence.exportSize }
					: {}),
				items: [...items, ...newItems],
			};
			writeSequence(draft, nextSequence);
		},
	};
}

/** Updates document-level sequence metadata without replacing its item order. */
export function createUpdateSceneSequenceCommand(patch: {
	readonly name?: string;
	readonly fps?: number | null;
	readonly exportSize?: {
		readonly width: number;
		readonly height: number;
	} | null;
}): SceneCommand {
	return {
		type: "scene/sequence-update",
		label: "Edit scene sequence",
		run: (draft) => {
			const sequence = draft.sequence;
			if (!sequence) return;
			const name = patch.name?.trim();
			const fps =
				patch.fps === undefined || patch.fps === null
					? patch.fps
					: positiveIntegerOrNull(patch.fps);
			let exportSize: SceneSequence["exportSize"] | null = patch.exportSize;
			if (patch.exportSize) {
				const width = positiveIntegerOrNull(patch.exportSize.width);
				const height = positiveIntegerOrNull(patch.exportSize.height);
				if (width === null || height === null) return;
				exportSize = { width, height };
			}
			let nextSequence: SceneSequence = {
				...sequence,
				...(name ? { name } : {}),
				...(typeof fps === "number" ? { fps } : {}),
				...(exportSize && {
					exportSize: {
						width: exportSize.width,
						height: exportSize.height,
					},
				}),
			};
			if (fps === null) {
				const { fps: _fps, ...withoutFps } = nextSequence;
				nextSequence = withoutFps;
			}
			if (exportSize === null) {
				const { exportSize: _exportSize, ...withoutExportSize } = nextSequence;
				nextSequence = withoutExportSize;
			}
			writeSequence(draft, nextSequence);
		},
	};
}

/** Updates one sequence item's editable label and duration override. */
export function createUpdateSceneSequenceItemCommand(
	itemId: string,
	patch: {
		readonly label?: string | null;
		readonly durationFrames?: number | null;
	},
): SceneCommand {
	return {
		type: "scene/sequence-update-item",
		label: "Edit scene",
		run: (draft) => {
			const sequence = draft.sequence;
			if (!sequence) return;
			const duration =
				patch.durationFrames === undefined || patch.durationFrames === null
					? patch.durationFrames
					: positiveIntegerOrNull(patch.durationFrames);
			if (duration === null && patch.durationFrames !== null) return;
			const label =
				patch.label === undefined
					? undefined
					: patch.label === null
						? null
						: patch.label.trim() || null;
			const items = sequence.items.map((item): SceneSequenceItem => {
				if (item.id !== itemId) return item;
				let nextItem: SceneSequenceItem = {
					...item,
					...(label ? { label } : {}),
					...(typeof duration === "number" ? { durationFrames: duration } : {}),
				};
				if (label === null) {
					const { label: _label, ...withoutLabel } = nextItem;
					nextItem = withoutLabel;
				}
				if (duration === null) {
					const { durationFrames: _durationFrames, ...withoutDuration } =
						nextItem;
					nextItem = withoutDuration;
				}
				return nextItem;
			});
			writeSequence(draft, sequenceWithItems(sequence, items));
		},
	};
}

/** Clears the optional document-level sequence side-car. */
export function createRemoveSceneSequenceCommand(): SceneCommand {
	return {
		type: "scene/sequence-remove",
		label: "Remove scene sequence",
		run: (draft) => writeSequence(draft, undefined),
	};
}

/**
 * Moves one sequence item to a new array index. The command deliberately edits
 * only the sequence side-car; artboard pasteboard order remains independent.
 */
export function createMoveSceneSequenceItemCommand(
	itemId: string,
	toIndex: number,
): SceneCommand {
	return {
		type: "scene/sequence-move-item",
		label: "Reorder scene sequence",
		run: (draft) => {
			const sequence = draft.sequence;
			if (!sequence || sequence.items.length <= 1) return;
			const fromIndex = sequence.items.findIndex((item) => item.id === itemId);
			if (fromIndex < 0) return;
			const targetIndex = Math.min(
				sequence.items.length - 1,
				Math.max(0, Math.round(toIndex)),
			);
			if (fromIndex === targetIndex) return;

			const items = [...sequence.items];
			const [item] = items.splice(fromIndex, 1);
			if (!item) return;
			items.splice(targetIndex, 0, item);
			writeSequence(draft, sequenceWithItems(sequence, items));
		},
	};
}

/**
 * Sets a composition duration override for one sequence item. Invalid values are
 * ignored so transient UI input cannot commit a corrupt non-positive duration.
 */
export function createSetSceneSequenceItemDurationCommand(
	itemId: string,
	durationFrames: number,
): SceneCommand {
	return {
		type: "scene/sequence-set-item-duration",
		label: "Set scene duration",
		coalesceKey: `scene-sequence-duration:${itemId}`,
		run: (draft) => {
			const sequence = draft.sequence;
			const duration = positiveIntegerOrNull(durationFrames);
			if (!sequence || duration === null) return;
			const items = sequence.items.map((item) =>
				item.id === itemId && item.durationFrames !== duration
					? { ...item, durationFrames: duration }
					: item,
			);
			if (sequenceItemsEqual(sequence.items, items)) return;
			writeSequence(draft, sequenceWithItems(sequence, items));
		},
	};
}

/** Removes one artboard scene from the document-level sequence side-car. */
export function createRemoveSceneSequenceItemCommand(
	itemId: string,
): SceneCommand {
	return {
		type: "scene/sequence-remove-item",
		label: "Remove scene from sequence",
		run: (draft) => {
			const sequence = draft.sequence;
			if (!sequence) return;
			const items = sequence.items.filter((item) => item.id !== itemId);
			if (items.length === sequence.items.length) return;
			writeSequence(draft, sequenceWithItems(sequence, items));
		},
	};
}
