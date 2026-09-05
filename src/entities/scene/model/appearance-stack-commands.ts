import { castDraft, current, type Draft } from "immer";
import {
	type AppearanceListRole,
	type AppearancePatch,
	applyAppearanceStackPatch,
	readAppearanceStack,
} from "./appearance-stack";
import type { SceneCommand } from "./command";
import { synchronizeSharedColorComponentPropsFromNodeStyle } from "./component-prop-commands";
import { readComponentProps } from "./component-props";
import { findDraftNode } from "./selectors";
import type { Effect, Paint, SceneDocument, VectorNode } from "./types";

/**
 * Undoable command bridge for the node appearance stack. Every mutation flows
 * through the pure {@link applyAppearanceStackPatch} so the widget never mutates a
 * paint array directly, each Inspector action is exactly one undo entry, and the
 * legacy `fill`/`stroke` stays coherent with the rich lists. A patch that changes
 * nothing (missing node, out-of-range index, identical value) is a true no-op:
 * `applyAppearanceStackPatch` returns the same style reference, so no draft write —
 * and therefore no history entry — is produced.
 */

type PaintStructurePatch =
	| Extract<AppearancePatch, { readonly op: "add" }>
	| {
			readonly op: "remove";
			readonly role: "fill" | "stroke";
			readonly index: number;
	  }
	| {
			readonly op: "reorder";
			readonly role: "fill" | "stroke";
			readonly from: number;
			readonly to: number;
	  };

const paintStructurePatch = (
	patch: AppearancePatch,
): PaintStructurePatch | null => {
	if (patch.op === "add") return patch;
	if (
		(patch.op === "remove" || patch.op === "reorder") &&
		(patch.role === "fill" || patch.role === "stroke")
	) {
		return patch as PaintStructurePatch;
	}
	return null;
};

/**
 * Returns whether an index-changing appearance patch would move, replace, or
 * accidentally materialize a shared-color address. Safe structural edits after
 * every bound index can proceed without invoking color synchronization because
 * no owned slot changed.
 */
const structurePatchRetargetsSharedColor = (
	draft: Draft<SceneDocument>,
	node: Draft<VectorNode>,
	patch: PaintStructurePatch,
): boolean => {
	const boundIndices = readComponentProps(draft).flatMap((prop) =>
		prop.type === "color"
			? prop.bindings.flatMap((binding) =>
					binding.kind === "style-color" &&
					binding.nodeId === node.id &&
					binding.role === patch.role
						? [binding.paintIndex ?? 0]
						: [],
				)
			: [],
	);
	if (boundIndices.length === 0) return false;
	const stack = readAppearanceStack(current(node) as VectorNode);
	const count =
		patch.role === "fill" ? stack.fills.length : stack.strokes.length;
	if (patch.op === "add") {
		const at = patch.index === undefined ? count : Math.min(patch.index, count);
		return boundIndices.some((index) => index >= at);
	}
	if (patch.op === "remove") {
		return boundIndices.some((index) => index >= patch.index);
	}
	const to = Math.min(Math.max(patch.to, 0), Math.max(0, count - 1));
	const start = Math.min(patch.from, to);
	const end = Math.max(patch.from, to);
	return boundIndices.some((index) => index >= start && index <= end);
};

const appearancePatchCommand = (
	nodeId: string,
	patch: AppearancePatch,
	type: string,
	label: string,
): SceneCommand => ({
	type,
	label,
	run: (draft) => {
		const node = findDraftNode(draft, nodeId);
		if (!node) return;
		const structuralPatch = paintStructurePatch(patch);
		if (
			structuralPatch &&
			structurePatchRetargetsSharedColor(draft, node, structuralPatch)
		) {
			return;
		}
		// Snapshot the draft style to plain data so the pure helper builds a fully
		// plain next style (no mixed draft/plain references) before it is reassigned.
		const plain = current(node.style);
		const next = applyAppearanceStackPatch(plain, patch);
		if (next === plain) return;
		node.style = castDraft(next);
		if (structuralPatch) return;
		if (
			!synchronizeSharedColorComponentPropsFromNodeStyle(draft, nodeId, plain, {
				allowUnboundPaintChanges:
					patch.op === "update" || patch.op === "set-visibility",
			})
		) {
			node.style = castDraft(plain);
		}
	},
});

/** Adds a fill or stroke paint to a node's stack (appended unless `index` is given). */
export function createAddAppearanceItemCommand(
	nodeId: string,
	role: "fill" | "stroke",
	paint: Paint,
	index?: number,
): SceneCommand {
	return appearancePatchCommand(
		nodeId,
		{ op: "add", role, paint, ...(index === undefined ? {} : { index }) },
		"scene/add-appearance-item",
		`Add ${role}`,
	);
}

/** Adds an effect to a node's effect stack (appended unless `index` is given). */
export function createAddAppearanceEffectCommand(
	nodeId: string,
	effect: Effect,
	index?: number,
): SceneCommand {
	return appearancePatchCommand(
		nodeId,
		{ op: "add-effect", effect, ...(index === undefined ? {} : { index }) },
		"scene/add-appearance-effect",
		"Add effect",
	);
}

/** Replaces a fill or stroke paint at one stack index. */
export function createUpdateAppearanceItemCommand(
	nodeId: string,
	role: "fill" | "stroke",
	index: number,
	paint: Paint,
): SceneCommand {
	return appearancePatchCommand(
		nodeId,
		{ op: "update", role, index, paint },
		"scene/update-appearance-item",
		`Edit ${role}`,
	);
}

/** Replaces an effect at one stack index. */
export function createUpdateAppearanceEffectCommand(
	nodeId: string,
	index: number,
	effect: Effect,
): SceneCommand {
	return appearancePatchCommand(
		nodeId,
		{ op: "update-effect", index, effect },
		"scene/update-appearance-effect",
		"Edit effect",
	);
}

/** Moves a fill/stroke/effect item from one stack position to another. */
export function createReorderAppearanceItemCommand(
	nodeId: string,
	role: AppearanceListRole,
	from: number,
	to: number,
): SceneCommand {
	return appearancePatchCommand(
		nodeId,
		{ op: "reorder", role, from, to },
		"scene/reorder-appearance-item",
		"Reorder appearance",
	);
}

/** Shows or hides one fill/stroke/effect item without removing it. */
export function createToggleAppearanceItemVisibilityCommand(
	nodeId: string,
	role: AppearanceListRole,
	index: number,
	visible: boolean,
): SceneCommand {
	return appearancePatchCommand(
		nodeId,
		{ op: "set-visibility", role, index, visible },
		"scene/toggle-appearance-visibility",
		visible ? `Show ${role}` : `Hide ${role}`,
	);
}

/** Removes one fill/stroke/effect item from a node's stack. */
export function createRemoveAppearanceItemCommand(
	nodeId: string,
	role: AppearanceListRole,
	index: number,
): SceneCommand {
	return appearancePatchCommand(
		nodeId,
		{ op: "remove", role, index },
		"scene/remove-appearance-item",
		`Remove ${role}`,
	);
}
