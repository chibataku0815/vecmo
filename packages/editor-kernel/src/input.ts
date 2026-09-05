import {
	type ActionDefinition,
	actionEnabled,
	actionShortcuts,
} from "./actions";
import type { Shortcut } from "./shortcuts";
import {
	type ShortcutInput,
	type ShortcutModifier,
	shortcutMatchesInput,
	shortcutMatchingSignatures,
} from "./shortcuts";

export type KeyboardInputSnapshot = ShortcutInput & {
	readonly defaultPrevented: boolean;
	readonly isComposing: boolean;
	readonly isEditable: boolean;
};

export type InputActionCandidate<TValue> = {
	readonly value: TValue;
	readonly shortcut: Shortcut;
	readonly enabled: boolean;
	readonly allowInEditable?: boolean;
};

const identityShortcut = (shortcut: Shortcut): Shortcut => shortcut;

/** Projects action definitions into input candidates using current Kernel availability. */
export function actionInputCandidates<
	TContext,
	TRuntime,
	TAction extends ActionDefinition<TContext, TRuntime>,
	TValue,
>(
	actions: readonly TAction[],
	context: TContext,
	valueForAction: (action: TAction) => TValue,
	mapShortcut: (shortcut: Shortcut) => Shortcut = identityShortcut,
): readonly InputActionCandidate<TValue>[] {
	const candidates: InputActionCandidate<TValue>[] = [];
	for (const action of actions) {
		const shortcuts = actionShortcuts(action);
		if (shortcuts.length === 0) continue;

		const value = valueForAction(action);
		const enabled = actionEnabled(action, context);
		const allowInEditable = action.allowInEditable;
		for (const shortcut of shortcuts) {
			candidates.push({
				value,
				shortcut: mapShortcut(shortcut),
				enabled,
				...(allowInEditable === undefined ? {} : { allowInEditable }),
			});
		}
	}
	return candidates;
}

export type InputScope<TValue> = {
	readonly id: string;
	readonly depth: number;
	readonly eligible: boolean;
	readonly actions: readonly InputActionCandidate<TValue>[];
	readonly claimedShortcutSignatures?: readonly string[];
};

export type ModalInputScope<TValue> = {
	readonly id: string;
	readonly locals: readonly InputScope<TValue>[];
	readonly root: InputScope<TValue>;
};

export type InputResolution<TValue> =
	| {
			readonly kind: "action";
			readonly value: TValue;
			readonly scopeId: string;
	  }
	| { readonly kind: "defer"; readonly scopeId: string }
	| {
			readonly kind: "blocked";
			readonly reason:
				| "default-prevented"
				| "ime-composition"
				| "editable"
				| "disabled"
				| "modal-exclusive";
	  }
	| { readonly kind: "none" };

export type InputResolverRequest<TValue> = {
	readonly input: KeyboardInputSnapshot;
	readonly global: InputScope<TValue>;
	readonly locals?: readonly InputScope<TValue>[];
	readonly modal?: ModalInputScope<TValue>;
};

const deepestEligible = <TValue>(
	scopes: readonly InputScope<TValue>[],
): InputScope<TValue> | null => {
	let deepest: InputScope<TValue> | null = null;
	for (const scope of scopes) {
		if (scope.eligible && (!deepest || scope.depth > deepest.depth)) {
			deepest = scope;
		}
	}
	return deepest;
};

const resolveScope = <TValue>(
	scope: InputScope<TValue>,
	input: KeyboardInputSnapshot,
): InputResolution<TValue> => {
	const matchingActions = scope.actions.filter((candidate) =>
		shortcutMatchesInput(candidate.shortcut, input),
	);
	const modifiers: ShortcutModifier[] = [];
	if (input.metaKey || input.ctrlKey) modifiers.push("mod");
	if (input.shiftKey) modifiers.push("shift");
	if (input.altKey) modifiers.push("alt");
	const inputSignatures = shortcutMatchingSignatures({
		key: input.logicalKey,
		...(input.physicalCode ? { physicalCode: input.physicalCode } : {}),
		modifiers,
	});
	const matchingClaims = (scope.claimedShortcutSignatures ?? []).some(
		(signature) => inputSignatures.includes(signature),
	);

	if (input.isEditable) {
		const editableAction = matchingActions.find(
			(candidate) => candidate.allowInEditable && candidate.enabled,
		);
		if (editableAction) {
			return { kind: "action", value: editableAction.value, scopeId: scope.id };
		}
		if (matchingActions.length > 0) {
			return { kind: "blocked", reason: "editable" };
		}
		if (matchingClaims) return { kind: "defer", scopeId: scope.id };
		return { kind: "none" };
	}

	const enabledAction = matchingActions.find((candidate) => candidate.enabled);
	if (enabledAction) {
		return { kind: "action", value: enabledAction.value, scopeId: scope.id };
	}
	if (matchingActions.length > 0)
		return { kind: "blocked", reason: "disabled" };
	if (matchingClaims) return { kind: "defer", scopeId: scope.id };
	return { kind: "none" };
};

/** Resolves one keyboard input using the Editor Kernel's fixed precedence. */
export function resolveInput<TValue>(
	request: InputResolverRequest<TValue>,
): InputResolution<TValue> {
	const { input } = request;
	if (input.isComposing) return { kind: "blocked", reason: "ime-composition" };
	if (input.defaultPrevented)
		return { kind: "blocked", reason: "default-prevented" };

	if (request.modal) {
		const local = deepestEligible(request.modal.locals);
		if (local) {
			const resolution = resolveScope(local, input);
			if (resolution.kind !== "none") return resolution;
		}
		const rootResolution = resolveScope(request.modal.root, input);
		return rootResolution.kind === "none"
			? { kind: "blocked", reason: "modal-exclusive" }
			: rootResolution;
	}

	const local = deepestEligible(request.locals ?? []);
	if (local) {
		const resolution = resolveScope(local, input);
		if (resolution.kind !== "none") return resolution;
	}
	return resolveScope(request.global, input);
}
