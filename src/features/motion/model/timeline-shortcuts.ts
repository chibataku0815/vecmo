import type { ActionShortcut } from "@/shared/actions";

/** Context-owned camera-cut shortcuts shared by runtime arbitration and help. */
export const CAMERA_CUT_SHORTCUTS = {
	toggleTransition: { key: "t" },
	moveToNextLane: { key: "l" },
} as const satisfies Readonly<Record<string, ActionShortcut>>;

export const CAMERA_CUT_LOCAL_SHORTCUTS: readonly ActionShortcut[] =
	Object.values(CAMERA_CUT_SHORTCUTS);
