import {
	type KeyboardInputSnapshot,
	shortcutLabel as kernelShortcutLabel,
	shortcutMatchingSignatures as kernelShortcutMatchingSignatures,
	shortcutSignature as kernelShortcutSignature,
	type NormalizedShortcut,
	normalizeShortcut as normalizeKernelShortcut,
	normalizeShortcutKey,
	type Shortcut,
	type ShortcutInput,
	type ShortcutModifier,
	type ShortcutPlatform,
	shortcutMatchesInput,
} from "@motion-surface/editor-kernel";

export type ActionShortcut = Shortcut;
export type {
	KeyboardInputSnapshot,
	NormalizedShortcut,
	ShortcutModifier,
	ShortcutPlatform,
};

export type ShortcutKeyboardEvent = {
	readonly key: string;
	readonly code?: string;
	readonly metaKey: boolean;
	readonly ctrlKey: boolean;
	readonly shiftKey: boolean;
	readonly altKey: boolean;
	readonly isComposing?: boolean;
	readonly target?: EventTarget | null;
	readonly defaultPrevented?: boolean;
};

type KeyboardTargetLike = {
	readonly isContentEditable?: boolean;
	readonly tagName?: string;
	readonly getAttribute?: (name: string) => string | null;
	readonly closest?: (selector: string) => unknown;
};

const EDITABLE_SELECTOR =
	"input, textarea, select, [contenteditable='true'], [contenteditable=''], [role='textbox'], [role='searchbox']";
export const LOCAL_SHORTCUT_SCOPE_ATTRIBUTE = "data-editor-local-shortcuts";
const APPLE_PLATFORM_PATTERN = /mac|iphone|ipad|ipod/i;
const SINGLE_LETTER_KEY = /^[A-Z]$/;
const SINGLE_DIGIT_KEY = /^[0-9]$/;
const PUNCTUATION_PHYSICAL_CODES: Readonly<Record<string, string>> = {
	"]": "BracketRight",
	"[": "BracketLeft",
};

const physicalCodeForShortcutKey = (
	normalizedKey: string,
): string | undefined => {
	if (SINGLE_LETTER_KEY.test(normalizedKey)) return `Key${normalizedKey}`;
	if (SINGLE_DIGIT_KEY.test(normalizedKey)) return `Digit${normalizedKey}`;
	return PUNCTUATION_PHYSICAL_CODES[normalizedKey];
};

/**
 * Vecmo's browser adapter makes its logical-key plus physical-position fallback
 * explicit before handing a shortcut to the DOM-free Kernel.
 */
export const vecmoShortcutBinding = (
	shortcut: ActionShortcut,
): ActionShortcut => {
	if (shortcut.physicalCode) return shortcut;
	const key = normalizeShortcutKey(shortcut.key);
	const physicalCode = physicalCodeForShortcutKey(key);
	return physicalCode ? { ...shortcut, physicalCode } : shortcut;
};

export function normalizeShortcut(
	shortcut: ActionShortcut,
): NormalizedShortcut {
	return normalizeKernelShortcut(vecmoShortcutBinding(shortcut));
}

export function shortcutSignature(shortcut: ActionShortcut): string {
	return kernelShortcutSignature(vecmoShortcutBinding(shortcut));
}

export function resolveShortcutPlatform(): ShortcutPlatform {
	if (typeof navigator === "undefined") return "other";
	const probe = `${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`;
	return APPLE_PLATFORM_PATTERN.test(probe) ? "apple" : "other";
}

export function shortcutLabel(
	shortcut: ActionShortcut,
	platform: ShortcutPlatform = resolveShortcutPlatform(),
): string {
	return kernelShortcutLabel(shortcut, platform);
}

const targetLike = (
	target: EventTarget | null | undefined,
): KeyboardTargetLike => (target ?? {}) as KeyboardTargetLike;

export function isEditableKeyboardTarget(
	target: EventTarget | null | undefined,
): boolean {
	const candidate = targetLike(target);
	if (candidate.isContentEditable) return true;
	if (candidate.closest?.(EDITABLE_SELECTOR)) return true;
	const tagName = candidate.tagName?.toUpperCase();
	if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
		return true;
	}
	const role = candidate.getAttribute?.("role")?.toLowerCase();
	if (role === "textbox" || role === "searchbox") return true;
	const contentEditable = candidate.getAttribute?.("contenteditable");
	return contentEditable === "" || contentEditable?.toLowerCase() === "true";
}

export function keyboardInputSnapshot(
	event: ShortcutKeyboardEvent,
): KeyboardInputSnapshot {
	return {
		logicalKey: event.key,
		...(event.code ? { physicalCode: event.code } : {}),
		metaKey: event.metaKey,
		ctrlKey: event.ctrlKey,
		shiftKey: event.shiftKey,
		altKey: event.altKey,
		defaultPrevented: event.defaultPrevented ?? false,
		isComposing: event.isComposing ?? false,
		isEditable: isEditableKeyboardTarget(event.target),
	};
}

export function shouldHandleActionShortcut(
	event: ShortcutKeyboardEvent,
): boolean {
	const input = keyboardInputSnapshot(event);
	return !input.defaultPrevented && !input.isComposing && !input.isEditable;
}

export function localShortcutScopeValue(
	shortcuts: readonly ActionShortcut[],
): string {
	return shortcuts
		.flatMap((shortcut) =>
			kernelShortcutMatchingSignatures(vecmoShortcutBinding(shortcut)),
		)
		.join(" ");
}

export function localShortcutSignatures(
	event: ShortcutKeyboardEvent,
): readonly string[] {
	const candidate = targetLike(event.target);
	const scope = candidate.closest?.(`[${LOCAL_SHORTCUT_SCOPE_ATTRIBUTE}]`);
	const declared = targetLike(
		scope as EventTarget | null | undefined,
	).getAttribute?.(LOCAL_SHORTCUT_SCOPE_ATTRIBUTE);
	return declared?.split(/\s+/).filter(Boolean) ?? [];
}

export function shortcutMatchesEvent(
	shortcut: ActionShortcut,
	event: ShortcutKeyboardEvent,
): boolean {
	const input = keyboardInputSnapshot(event);
	const kernelInput: ShortcutInput = input;
	return shortcutMatchesInput(vecmoShortcutBinding(shortcut), kernelInput);
}

export { normalizeShortcutKey };
