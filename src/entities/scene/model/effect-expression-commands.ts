/**
 * Undoable command bridge for the Codeable-Effect binding side-car. Each mutation
 * flows through the scene command bus as one Immer-patch entry (one edit = one
 * undo), mirroring the style-preset library commands. Binding identity is
 * `(capability, target)`, so re-binding the same recipe or influence control
 * replaces rather than appends.
 */

import { castDraft, type Draft } from "immer";
import type { SceneCommand } from "./command";
import type {
	EffectExpressionBinding,
	EffectExpressionTargetRef,
} from "./effect-expression-binding";
import type { SceneDocument } from "./types";

const targetKey = (target: EffectExpressionTargetRef): string => {
	switch (target.kind) {
		case "node":
			return `node:${target.nodeId}`;
		case "artboard":
			return `artboard:${target.artboardId}`;
		case "scene":
			return "scene";
	}
};

const bindingKey = (
	capabilityId: string,
	target: EffectExpressionTargetRef,
): string => `${capabilityId}@${targetKey(target)}`;

const readBindings = (
	draft: Draft<SceneDocument>,
): readonly EffectExpressionBinding[] => draft.effectExpressionBindings ?? [];

/**
 * Sets (or replaces) the expression bound to one capability on one target. The
 * prior binding for the same `(capability, target)` is removed first so a control
 * has at most one expression.
 */
export function createSetEffectExpressionBindingCommand(
	binding: EffectExpressionBinding,
): SceneCommand {
	const key = bindingKey(binding.capabilityId, binding.targetRef);
	return {
		type: "scene/set-effect-expression-binding",
		label: "Bind effect to code",
		run: (draft) => {
			const next = readBindings(draft).filter(
				(existing) =>
					bindingKey(existing.capabilityId, existing.targetRef) !== key,
			);
			next.push(binding);
			draft.effectExpressionBindings = castDraft(next);
		},
	};
}

/**
 * Clears the expression bound to one capability on one target. A missing binding is
 * a typed no-op so a stale clear creates no history entry.
 */
export function createClearEffectExpressionBindingCommand(
	capabilityId: string,
	target: EffectExpressionTargetRef,
): SceneCommand {
	const key = bindingKey(capabilityId, target);
	return {
		type: "scene/clear-effect-expression-binding",
		label: "Clear effect code",
		run: (draft) => {
			const existing = readBindings(draft);
			const next = existing.filter(
				(binding) =>
					bindingKey(binding.capabilityId, binding.targetRef) !== key,
			);
			if (next.length === existing.length) return;
			draft.effectExpressionBindings = castDraft(next);
		},
	};
}
