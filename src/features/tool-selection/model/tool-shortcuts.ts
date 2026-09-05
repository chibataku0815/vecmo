import { type ActionShortcut, normalizeShortcutKey } from "@/shared/actions";
import type { ToolId } from "./tools";

const key = (value: string): ActionShortcut => ({ key: value });
const chord = (
	value: string,
	modifiers: ActionShortcut["modifiers"],
): ActionShortcut => ({ key: value, modifiers });

/**
 * Canonical runtime shortcuts for globally activatable tools. Tool chrome,
 * actions, and canvas fallback dispatch must derive from this table; shape
 * flyout variants and unavailable tool shells intentionally have no entries.
 */
export const GLOBAL_TOOL_SHORTCUTS = {
	select: key("v"),
	"direct-select": key("a"),
	hand: key("h"),
	frame: key("f"),
	pen: key("p"),
	pencil: chord("p", ["shift"]),
	shape: key("r"),
	type: key("t"),
	eyedropper: key("i"),
	gradient: key("g"),
	"noise-gradient": key("n"),
	mesh: key("u"),
	"shape-builder": chord("m", ["shift"]),
	blend: key("w"),
	"motion-path": key("m"),
	"path-blur": key("b"),
	effect: key("e"),
} as const satisfies Partial<Record<ToolId, ActionShortcut>>;

export type GloballyShortcutableToolId = keyof typeof GLOBAL_TOOL_SHORTCUTS;

/** Returns the one authoritative runtime shortcut for a tool, when present. */
export function globalToolShortcut(toolId: ToolId): ActionShortcut | undefined {
	return GLOBAL_TOOL_SHORTCUTS[toolId as GloballyShortcutableToolId];
}

/**
 * Resolves the unmodified-key canvas fallback from the canonical declaration.
 * Modified chords remain owned by the global action dispatcher.
 */
export function toolIdForPlainShortcutKey(keyValue: string): ToolId | null {
	const normalizedKey = normalizeShortcutKey(keyValue);
	for (const [toolId, declaredShortcut] of Object.entries(
		GLOBAL_TOOL_SHORTCUTS,
	)) {
		const shortcut: ActionShortcut = declaredShortcut;
		if (shortcut.modifiers && shortcut.modifiers.length > 0) continue;
		if (normalizeShortcutKey(shortcut.key) === normalizedKey) {
			return toolId as ToolId;
		}
	}
	return null;
}
