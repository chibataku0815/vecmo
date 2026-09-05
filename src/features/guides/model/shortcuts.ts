import {
	isEditableKeyboardTarget,
	type ShortcutKeyboardEvent,
} from "@/shared/actions";

export type GuideViewShortcutIntent =
	| "toggle-layout-grid"
	| "toggle-pixel-grid"
	| "toggle-rulers";

/**
 * Resolves CanvasShell-owned view-aid shortcuts without coupling the guide
 * feature to React events. `Mod+'` toggles artboard layout grids, `Mod+Shift+'`
 * toggles the zoom-gated pixel grid, and `Alt+R` keeps the existing ruler-chrome
 * host shortcut. Editable targets are ignored so text editing keeps its input.
 */
export function guideViewShortcutIntent(
	event: ShortcutKeyboardEvent,
): GuideViewShortcutIntent | null {
	if (event.defaultPrevented || isEditableKeyboardTarget(event.target)) {
		return null;
	}

	if (
		event.altKey &&
		!event.metaKey &&
		!event.ctrlKey &&
		!event.shiftKey &&
		event.code === "KeyR"
	) {
		return "toggle-rulers";
	}

	if (
		(event.metaKey || event.ctrlKey) &&
		!event.altKey &&
		event.code === "Quote"
	) {
		return event.shiftKey ? "toggle-pixel-grid" : "toggle-layout-grid";
	}

	return null;
}
