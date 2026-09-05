/**
 * Pure key→intent mappings for the editor's global keyboard workflow (Stage L
 * keyboard completion). Kept out of `CanvasShell` so the non-obvious mappings
 * (digit→opacity, key→frame navigation) are unit-testable without the DOM. The
 * widget keydown handler is a thin adapter: guard focus/modifiers, look up the
 * intent here, apply it via the command bus / transport store.
 *
 * These bind only keys that are free in the editor (digits, `,`/`.`, Home/End) —
 * arrows are node nudge and Space is workspace pan, so neither is touched here.
 */

import { toolIdForPlainShortcutKey } from "@/features/tool-selection/model/tool-shortcuts";
import type { ToolId } from "@/features/tool-selection/model/tools";

export type CanvasToolShortcut = ToolId;

const FULL_OPACITY = 1;
const DIGIT_OPACITY: Readonly<Record<string, number>> = {
	"1": 0.1,
	"2": 0.2,
	"3": 0.3,
	"4": 0.4,
	"5": 0.5,
	"6": 0.6,
	"7": 0.7,
	"8": 0.8,
	"9": 0.9,
	"0": FULL_OPACITY,
};

/** Maps a plain key press to a canvas-owned tool shortcut. */
export function toolShortcutForKey(key: string): CanvasToolShortcut | null {
	return toolIdForPlainShortcutKey(key);
}

/**
 * Figma-style opacity from a single digit: `1`–`9` → 10%–90%, `0` → 100%. Returns
 * null for any non-digit key so the caller can fall through to other handlers.
 */
export function opacityForDigitKey(key: string): number | null {
	return key in DIGIT_OPACITY ? DIGIT_OPACITY[key] : null;
}

/** Playhead navigation intents bound to free keys. */
export type FrameNavTarget = "first" | "last" | "prev" | "next";

const FRAME_NAV_KEYS: Readonly<Record<string, FrameNavTarget>> = {
	Home: "first",
	End: "last",
	",": "prev",
	".": "next",
};

/** Maps a key to a playhead navigation intent, or null when unbound. */
export function frameNavForKey(key: string): FrameNavTarget | null {
	return FRAME_NAV_KEYS[key] ?? null;
}

/**
 * Resolves the target frame for a navigation intent, clamped to [0, lastFrame].
 * `currentFrame` may be fractional during playback, so stepping rounds first.
 */
export function frameForNav(
	target: FrameNavTarget,
	currentFrame: number,
	lastFrame: number,
): number {
	const max = Math.max(0, lastFrame);
	switch (target) {
		case "first":
			return 0;
		case "last":
			return max;
		case "prev":
			return Math.max(0, Math.round(currentFrame) - 1);
		case "next":
			return Math.min(max, Math.round(currentFrame) + 1);
	}
}
