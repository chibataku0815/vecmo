/**
 * Undoable command bridge for Codeable Native Property bindings. Each set/clear
 * is one command-bus edit, keyed by `(node, property)` so rebinding replaces the
 * previous expression instead of appending duplicate side-cars.
 */

import { castDraft, type Draft } from "immer";
import type { SceneCommand } from "./command";
import {
	type NativeExpressionBinding,
	type NativeExpressionPropertyId,
	nativeExpressionBindingId,
} from "./native-expression-binding";
import type { SceneDocument } from "./types";

const readBindings = (
	draft: Draft<SceneDocument>,
): readonly NativeExpressionBinding[] => draft.nativeExpressionBindings ?? [];

/** Sets or replaces one native expression binding. */
export function createSetNativeExpressionBindingCommand(
	binding: NativeExpressionBinding,
): SceneCommand {
	const key = nativeExpressionBindingId(binding.nodeId, binding.propertyId);
	return {
		type: "scene/set-native-expression-binding",
		label: "Bind property to code",
		run: (draft) => {
			const next = readBindings(draft).filter(
				(existing) =>
					nativeExpressionBindingId(existing.nodeId, existing.propertyId) !==
					key,
			);
			next.push(binding);
			draft.nativeExpressionBindings = castDraft(next);
		},
	};
}

/** Clears one native expression binding. Missing bindings are no-ops. */
export function createClearNativeExpressionBindingCommand(
	nodeId: string,
	propertyId: NativeExpressionPropertyId,
): SceneCommand {
	const key = nativeExpressionBindingId(nodeId, propertyId);
	return {
		type: "scene/clear-native-expression-binding",
		label: "Clear property code",
		run: (draft) => {
			const existing = readBindings(draft);
			const next = existing.filter(
				(binding) =>
					nativeExpressionBindingId(binding.nodeId, binding.propertyId) !== key,
			);
			if (next.length === existing.length) return;
			draft.nativeExpressionBindings = castDraft(next);
		},
	};
}
