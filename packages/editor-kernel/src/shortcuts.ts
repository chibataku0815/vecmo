export type ShortcutModifier = "mod" | "shift" | "alt";

export type Shortcut = {
	/** Logical key value after keyboard-layout processing. */
	readonly key: string;
	/** Optional physical key position. Matching it is an explicit caller choice. */
	readonly physicalCode?: string;
	readonly modifiers?: readonly ShortcutModifier[];
};

export type NormalizedShortcut = {
	readonly key: string;
	readonly physicalCode?: string;
	readonly modifiers: readonly ShortcutModifier[];
};

export type ShortcutInput = {
	readonly logicalKey: string;
	readonly physicalCode?: string;
	readonly metaKey: boolean;
	readonly ctrlKey: boolean;
	readonly shiftKey: boolean;
	readonly altKey: boolean;
};

export type ShortcutPlatform = "apple" | "other";

const MODIFIER_ORDER = ["mod", "shift", "alt"] as const;

const NAMED_KEYS = new Map<string, string>([
	[" ", "Space"],
	["space", "Space"],
	["spacebar", "Space"],
	["esc", "Escape"],
	["escape", "Escape"],
	["return", "Enter"],
	["enter", "Enter"],
	["delete", "Delete"],
	["backspace", "Backspace"],
	["tab", "Tab"],
	["arrowleft", "ArrowLeft"],
	["arrowright", "ArrowRight"],
	["arrowup", "ArrowUp"],
	["arrowdown", "ArrowDown"],
]);

const APPLE_MODIFIER_LABELS: Readonly<Record<ShortcutModifier, string>> = {
	mod: "⌘",
	shift: "⇧",
	alt: "⌥",
};

const OTHER_MODIFIER_LABELS: Readonly<Record<ShortcutModifier, string>> = {
	mod: "Ctrl",
	shift: "Shift",
	alt: "Alt",
};

const uniqueOrderedModifiers = (
	modifiers: readonly ShortcutModifier[] = [],
): readonly ShortcutModifier[] =>
	[...new Set(modifiers)].sort(
		(left, right) =>
			MODIFIER_ORDER.indexOf(left) - MODIFIER_ORDER.indexOf(right),
	);

/** Normalizes logical key names without consulting a host keyboard or DOM. */
export function normalizeShortcutKey(key: string): string {
	const named = NAMED_KEYS.get(key.toLowerCase());
	if (named) return named;
	if (key.length === 1) return key.toUpperCase();
	return key;
}

export function normalizeShortcut(shortcut: Shortcut): NormalizedShortcut {
	return {
		key: normalizeShortcutKey(shortcut.key),
		...(shortcut.physicalCode ? { physicalCode: shortcut.physicalCode } : {}),
		modifiers: uniqueOrderedModifiers(shortcut.modifiers),
	};
}

export function shortcutSignature(shortcut: Shortcut): string {
	return shortcutMatchingSignatures(shortcut).join("|");
}

/**
 * Returns every input identity that can match this shortcut. Logical and
 * explicitly opted-in physical matching stay separate so collision detection
 * and local ownership use the same equivalence as runtime matching.
 */
export function shortcutMatchingSignatures(
	shortcut: Shortcut,
): readonly string[] {
	const normalized = normalizeShortcut(shortcut);
	const prefix = normalized.modifiers.join("+");
	return [
		`${prefix}+key:${normalized.key}`,
		...(normalized.physicalCode
			? [`${prefix}+code:${normalized.physicalCode}`]
			: []),
	];
}

/** Formats a shortcut using an explicitly injected platform. */
export function shortcutLabel(
	shortcut: Shortcut,
	platform: ShortcutPlatform,
): string {
	const normalized = normalizeShortcut(shortcut);
	const labels =
		platform === "apple" ? APPLE_MODIFIER_LABELS : OTHER_MODIFIER_LABELS;
	return [
		...normalized.modifiers.map((modifier) => labels[modifier]),
		normalized.key,
	].join("+");
}

/** Matches exact modifiers and either the logical key or an explicitly declared physical code. */
export function shortcutMatchesInput(
	shortcut: Shortcut,
	input: ShortcutInput,
): boolean {
	const normalized = normalizeShortcut(shortcut);
	const logicalKey = normalizeShortcutKey(input.logicalKey);
	const keyMatches =
		logicalKey === normalized.key ||
		(normalized.physicalCode !== undefined &&
			input.physicalCode === normalized.physicalCode);
	if (!keyMatches) return false;

	const modifiers = new Set(normalized.modifiers);
	const needsMod = modifiers.has("mod");
	if (
		needsMod ? !input.metaKey && !input.ctrlKey : input.metaKey || input.ctrlKey
	) {
		return false;
	}
	if (input.shiftKey !== modifiers.has("shift")) return false;
	if (input.altKey !== modifiers.has("alt")) return false;
	return true;
}
