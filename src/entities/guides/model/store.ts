import { create } from "zustand";
import {
	createLocalStorageTextAdapter,
	readLocalStorageTextSync,
} from "@/shared/lib/persistence";
import type {
	SnapGuideVisual,
	SnapIndicator,
	SnapMatch,
	SnapMeasurement,
	SnapPoint,
} from "@/shared/lib/snapping";
import {
	type GuideLine,
	type GuideSnapResult,
	isGuideLineEditable,
} from "./snapping";

export type ActiveGuideSnap = {
	readonly result: GuideSnapResult;
	readonly isDragging: boolean;
	readonly origin?: SnapPoint;
};

export type GuideViewPreferences = {
	readonly workspaceGridVisible: boolean;
	readonly gridVisible: boolean;
	readonly pixelGridVisible: boolean;
	readonly rulersVisible: boolean;
	readonly guideLinesVisible: boolean;
};

export type GuideViewPreferenceKey = keyof GuideViewPreferences;

export type GuideViewPreferenceAction =
	| {
			readonly type: "set";
			readonly preference: GuideViewPreferenceKey;
			readonly visible: boolean;
	  }
	| {
			readonly type: "toggle";
			readonly preference: GuideViewPreferenceKey;
	  };

export const DEFAULT_GUIDE_VIEW_PREFERENCES = {
	workspaceGridVisible: true,
	gridVisible: true,
	pixelGridVisible: false,
	rulersVisible: true,
	guideLinesVisible: true,
} as const satisfies GuideViewPreferences;

/**
 * Snap BEHAVIOR preferences, deliberately separate from {@link GuideViewPreferences}
 * (which is pure visibility). Before this split, snapping was gated by
 * `gridVisible || guideLinesVisible`, so hiding the grid silently disabled
 * snapping. These two flags mirror Illustrator's "Smart Guides" and "Snap to
 * Point" exactly and are the only user-facing snap knobs:
 * - `smartGuides`: align the dragged selection's bounding box (edges/centers) to
 *   artboard/object/grid/guide candidates. Grid and guide-line candidates remain
 *   gated by their own visibility; artboard and object candidates are always on.
 * - `snapToPoint`: 2D hard-lock of the dragged/drawn point onto a real path
 *   vertex (and, after grid unification, a grid intersection).
 */
export type GuideSnapPreferences = {
	readonly smartGuides: boolean;
	readonly snapToPoint: boolean;
};

export type GuideSnapPreferenceKey = keyof GuideSnapPreferences;

export type GuideSnapPreferenceAction =
	| {
			readonly type: "set";
			readonly preference: GuideSnapPreferenceKey;
			readonly enabled: boolean;
	  }
	| {
			readonly type: "toggle";
			readonly preference: GuideSnapPreferenceKey;
	  };

/** Both default ON so snapping feels alive even with the grid/guides hidden. */
export const DEFAULT_GUIDE_SNAP_PREFERENCES = {
	smartGuides: true,
	snapToPoint: true,
} as const satisfies GuideSnapPreferences;

const GUIDE_VIEW_STORAGE_KEY = "vector-motion-author:guide-view:v1";

const guideViewAdapter = createLocalStorageTextAdapter({
	key: GUIDE_VIEW_STORAGE_KEY,
});

/**
 * Tolerant rehydrate of the persisted view preferences. Any missing or
 * non-boolean field falls back to its default, so an older or corrupt payload
 * can never produce an invalid preference set; unknown keys are dropped by
 * reading only the known booleans. Guide-line records and the ephemeral
 * active-snap are deliberately not persisted — lines belong to the document and
 * the snap indicator is per-gesture.
 */
export function hydrateGuideView(raw: string | null): GuideViewPreferences {
	if (raw === null) return DEFAULT_GUIDE_VIEW_PREFERENCES;
	try {
		const parsed = JSON.parse(raw) as Partial<
			Record<GuideViewPreferenceKey, unknown>
		>;
		const pick = (key: GuideViewPreferenceKey): boolean =>
			typeof parsed[key] === "boolean"
				? (parsed[key] as boolean)
				: DEFAULT_GUIDE_VIEW_PREFERENCES[key];
		return {
			workspaceGridVisible: pick("workspaceGridVisible"),
			gridVisible: pick("gridVisible"),
			pixelGridVisible: pick("pixelGridVisible"),
			rulersVisible: pick("rulersVisible"),
			guideLinesVisible: pick("guideLinesVisible"),
		};
	} catch {
		return DEFAULT_GUIDE_VIEW_PREFERENCES;
	}
}

// Synchronous seed at store creation: an async load would flash the default
// (grid shown) before the persisted value arrives, so a user who hid the grid
// would see it reappear on every reload — exactly the complaint this prevents.
const initialGuideView = hydrateGuideView(
	readLocalStorageTextSync({ key: GUIDE_VIEW_STORAGE_KEY }),
);

const GUIDE_SNAP_STORAGE_KEY = "vector-motion-author:guide-snap:v1";

const guideSnapAdapter = createLocalStorageTextAdapter({
	key: GUIDE_SNAP_STORAGE_KEY,
});

/**
 * Tolerant rehydrate of the persisted snap-behavior preferences. Mirrors
 * {@link hydrateGuideView}: any missing or non-boolean field falls back to its
 * default. The original snap design seeded these from constants only (ephemeral),
 * so a hidden-then-reloaded editor re-enabled snapping every reload — persisting
 * them on a dedicated key fixes that without thrashing the view-preference write.
 */
export function hydrateGuideSnap(raw: string | null): GuideSnapPreferences {
	if (raw === null) return DEFAULT_GUIDE_SNAP_PREFERENCES;
	try {
		const parsed = JSON.parse(raw) as Partial<
			Record<GuideSnapPreferenceKey, unknown>
		>;
		const pick = (key: GuideSnapPreferenceKey): boolean =>
			typeof parsed[key] === "boolean"
				? (parsed[key] as boolean)
				: DEFAULT_GUIDE_SNAP_PREFERENCES[key];
		return {
			smartGuides: pick("smartGuides"),
			snapToPoint: pick("snapToPoint"),
		};
	} catch {
		return DEFAULT_GUIDE_SNAP_PREFERENCES;
	}
}

const initialGuideSnap = hydrateGuideSnap(
	readLocalStorageTextSync({ key: GUIDE_SNAP_STORAGE_KEY }),
);

export type GuideLineAction =
	| { readonly type: "replace"; readonly guideLines: readonly GuideLine[] }
	| { readonly type: "create"; readonly guideLine: GuideLine }
	| { readonly type: "move"; readonly guideLine: GuideLine }
	| { readonly type: "remove"; readonly guideLineId: string }
	| {
			readonly type: "set-visible";
			readonly guideLineId: string;
			readonly visible: boolean;
	  }
	| {
			readonly type: "set-locked";
			readonly guideLineId: string;
			readonly locked: boolean;
	  };

type GuideState = {
	readonly guideLines: readonly GuideLine[];
	readonly activeSnap: ActiveGuideSnap | null;
	readonly view: GuideViewPreferences;
	readonly snap: GuideSnapPreferences;
	readonly setGuideLines: (guideLines: readonly GuideLine[]) => void;
	readonly createGuideLine: (guideLine: GuideLine) => void;
	readonly upsertGuideLine: (guideLine: GuideLine) => void;
	readonly moveGuideLine: (guideLine: GuideLine) => void;
	readonly removeGuideLine: (guideLineId: string) => void;
	readonly setGuideLineVisible: (guideLineId: string, visible: boolean) => void;
	readonly setGuideLineLocked: (guideLineId: string, locked: boolean) => void;
	readonly setGuideViewPreference: (
		preference: GuideViewPreferenceKey,
		visible: boolean,
	) => void;
	readonly toggleGuideViewPreference: (
		preference: GuideViewPreferenceKey,
	) => void;
	readonly setWorkspaceGridVisible: (visible: boolean) => void;
	readonly toggleWorkspaceGridVisible: () => void;
	readonly setGridVisible: (visible: boolean) => void;
	readonly toggleGridVisible: () => void;
	/**
	 * Flips the single user-facing "grid" — the full-viewport workspace/desk grid
	 * and the per-artboard layout grid together — to one common target. See the
	 * implementation: it heals an out-of-phase pair instead of widening it, so the
	 * Show/hide grid checked state can never lie. The pixel grid is a separate
	 * specialist toggle and is intentionally left untouched.
	 */
	readonly toggleGridGroup: () => void;
	readonly setPixelGridVisible: (visible: boolean) => void;
	readonly togglePixelGridVisible: () => void;
	readonly setRulersVisible: (visible: boolean) => void;
	readonly toggleRulersVisible: () => void;
	readonly setGuideLinesVisible: (visible: boolean) => void;
	readonly toggleGuideLinesVisible: () => void;
	readonly setSmartGuides: (enabled: boolean) => void;
	readonly toggleSmartGuides: () => void;
	readonly setSnapToPoint: (enabled: boolean) => void;
	readonly toggleSnapToPoint: () => void;
	readonly showActiveSnap: (
		result: GuideSnapResult,
		options?: { readonly isDragging?: boolean; readonly origin?: SnapPoint },
	) => void;
	readonly setActiveSnap: (
		result: GuideSnapResult,
		options?: { readonly isDragging?: boolean; readonly origin?: SnapPoint },
	) => void;
	readonly clearActiveSnap: () => void;
};

const mergeMovedGuideLine = (
	current: GuideLine,
	next: GuideLine,
): GuideLine => ({
	...current,
	...next,
	visible: next.visible ?? current.visible,
	locked: next.locked ?? current.locked,
});

/**
 * Reduces session-local guide/view preferences without touching guide-line data
 * or the undoable scene document. No-op updates preserve object identity so
 * subscribers do not repaint for duplicate shortcut dispatch.
 */
export function reduceGuideViewPreferences(
	preferences: GuideViewPreferences,
	action: GuideViewPreferenceAction,
): GuideViewPreferences {
	const current = preferences[action.preference];
	const next = action.type === "toggle" ? !current : action.visible;
	if (current === next) return preferences;
	return { ...preferences, [action.preference]: next };
}

/**
 * Reduces snap-behavior preferences. Mirrors {@link reduceGuideViewPreferences}:
 * a no-op update preserves object identity so subscribers do not repaint on a
 * duplicate toggle dispatch.
 */
export function reduceGuideSnapPreferences(
	preferences: GuideSnapPreferences,
	action: GuideSnapPreferenceAction,
): GuideSnapPreferences {
	const current = preferences[action.preference];
	const next = action.type === "toggle" ? !current : action.enabled;
	if (current === next) return preferences;
	return { ...preferences, [action.preference]: next };
}

/**
 * Applies guide-line UI actions without touching the scene document. Duplicate
 * creates replace the existing line in place so persisted user guides remain
 * addressable by stable ids during drag-create and drag-move flows.
 */
export function reduceGuideLines(
	guideLines: readonly GuideLine[],
	action: GuideLineAction,
): readonly GuideLine[] {
	if (action.type === "replace") return [...action.guideLines];
	if (action.type === "remove") {
		const line = guideLines.find((item) => item.id === action.guideLineId);
		if (!line || !isGuideLineEditable(line)) return guideLines;
		return guideLines.filter((item) => item.id !== action.guideLineId);
	}
	if (action.type === "set-visible") {
		const index = guideLines.findIndex(
			(line) => line.id === action.guideLineId,
		);
		if (index === -1) return guideLines;
		return guideLines.map((line, lineIndex) =>
			lineIndex === index ? { ...line, visible: action.visible } : line,
		);
	}
	if (action.type === "set-locked") {
		const index = guideLines.findIndex(
			(line) => line.id === action.guideLineId,
		);
		if (index === -1) return guideLines;
		return guideLines.map((line, lineIndex) =>
			lineIndex === index ? { ...line, locked: action.locked } : line,
		);
	}

	const index = guideLines.findIndex((line) => line.id === action.guideLine.id);
	if (action.type === "move") {
		if (index === -1) return guideLines;
		const current = guideLines[index];
		if (!current || !isGuideLineEditable(current)) return guideLines;
		return guideLines.map((line, lineIndex) =>
			lineIndex === index ? mergeMovedGuideLine(line, action.guideLine) : line,
		);
	}

	if (index === -1) return [...guideLines, action.guideLine];
	const current = guideLines[index];
	if (current && !isGuideLineEditable(current)) return guideLines;
	return guideLines.map((line, lineIndex) =>
		lineIndex === index ? action.guideLine : line,
	);
}

const samePoint = (a: SnapPoint, b: SnapPoint): boolean =>
	a === b || (a.x === b.x && a.y === b.y);

const sameOptionalPoint = (
	a: SnapPoint | undefined,
	b: SnapPoint | undefined,
): boolean => (a === b ? true : !a || !b ? false : samePoint(a, b));

const sameArray = <T>(
	a: readonly T[],
	b: readonly T[],
	same: (left: T, right: T) => boolean,
): boolean =>
	a === b ||
	(a.length === b.length &&
		a.every((item, index) => same(item, b[index] as T)));

const sameGuideVisual = (a: SnapGuideVisual, b: SnapGuideVisual): boolean =>
	a === b ||
	(a.axis === b.axis &&
		samePoint(a.from, b.from) &&
		samePoint(a.to, b.to) &&
		a.label === b.label &&
		sameOptionalPoint(a.labelAt, b.labelAt));

const sameMeasurement = (a: SnapMeasurement, b: SnapMeasurement): boolean =>
	a === b ||
	(a.axis === b.axis &&
		samePoint(a.from, b.from) &&
		samePoint(a.to, b.to) &&
		samePoint(a.labelAt, b.labelAt) &&
		a.delta === b.delta &&
		a.distance === b.distance &&
		a.label === b.label);

const sameIndicator = (
	a: SnapIndicator | null,
	b: SnapIndicator | null,
): boolean =>
	a === b ||
	(a !== null &&
		b !== null &&
		samePoint(a.point, b.point) &&
		sameArray(a.axes, b.axes, (left, right) => left === right) &&
		sameArray(a.sourceIds, b.sourceIds, (left, right) => left === right) &&
		a.label === b.label &&
		a.kind === b.kind);

// `candidate.id` is unique per snap source, so comparing it (plus the match's
// own axis/delta/distance) is a reliable, cheap stand-in for deep-comparing
// the whole GuideCandidate — a different id always means a different
// candidate, and this is the only field of `matches` any caller reads
// (handler tests assert on `matches[].candidate.id`/`.source`).
const sameMatch = (a: SnapMatch, b: SnapMatch): boolean =>
	a === b ||
	(a.axis === b.axis &&
		a.candidate.id === b.candidate.id &&
		a.delta === b.delta &&
		a.distance === b.distance);

/**
 * Structural equality for a {@link GuideSnapResult}: every field a subscriber
 * can observe, directly (GuidesOverlay reads `guides`/`measurements`/
 * `indicator` via `translateSnapResult`/`projectGuideSnapResult`) or through
 * `getState()` (tests read `matches` straight off the store). Two results
 * with identical values but different object identities — the common case
 * when the pointer barely moves and re-resolves to the same snap target —
 * compare equal.
 */
export function sameGuideSnapResult(
	a: GuideSnapResult,
	b: GuideSnapResult,
): boolean {
	return (
		a === b ||
		(a.snapped === b.snapped &&
			samePoint(a.point, b.point) &&
			samePoint(a.adjustedPoint, b.adjustedPoint) &&
			samePoint(a.delta, b.delta) &&
			sameArray(a.guides, b.guides, sameGuideVisual) &&
			sameArray(a.measurements, b.measurements, sameMeasurement) &&
			sameIndicator(a.indicator, b.indicator) &&
			sameArray(a.matches, b.matches, sameMatch))
	);
}

/**
 * Structural equality for the store's {@link ActiveGuideSnap} wrapper. Mirrors
 * {@link reduceGuideViewPreferences}/{@link reduceGuideSnapPreferences}: a
 * no-op update preserves object identity so a pointermove that re-resolves to
 * an equivalent snap state does not force GuidesOverlay to re-render.
 */
export function sameActiveGuideSnap(
	a: ActiveGuideSnap | null,
	b: ActiveGuideSnap | null,
): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	return (
		a.isDragging === b.isDragging &&
		sameOptionalPoint(a.origin, b.origin) &&
		sameGuideSnapResult(a.result, b.result)
	);
}

/**
 * Guide UI state. It intentionally sits beside, not inside, the scene document:
 * smart-guide indicators and user guide lines are editor aids, while all scene
 * geometry remains owned by SceneDocument and the command bus. The `view`
 * preferences are durable editor chrome — persisted to local storage out-of-band
 * (see the subscription below) so a hidden grid stays hidden across reloads —
 * whereas guide-line records and the active-snap indicator stay ephemeral.
 */
export const useGuideStore = create<GuideState>()((set) => ({
	guideLines: [],
	activeSnap: null,
	view: initialGuideView,
	snap: initialGuideSnap,
	setGuideLines: (guideLines) =>
		set((state) => ({
			guideLines: reduceGuideLines(state.guideLines, {
				type: "replace",
				guideLines,
			}),
		})),
	createGuideLine: (guideLine) =>
		set((state) => ({
			guideLines: reduceGuideLines(state.guideLines, {
				type: "create",
				guideLine,
			}),
		})),
	upsertGuideLine: (guideLine) =>
		set((state) => ({
			guideLines: reduceGuideLines(state.guideLines, {
				type: "create",
				guideLine,
			}),
		})),
	moveGuideLine: (guideLine) =>
		set((state) => ({
			guideLines: reduceGuideLines(state.guideLines, {
				type: "move",
				guideLine,
			}),
		})),
	removeGuideLine: (guideLineId) =>
		set((state) => ({
			guideLines: reduceGuideLines(state.guideLines, {
				type: "remove",
				guideLineId,
			}),
		})),
	setGuideLineVisible: (guideLineId, visible) =>
		set((state) => ({
			guideLines: reduceGuideLines(state.guideLines, {
				type: "set-visible",
				guideLineId,
				visible,
			}),
		})),
	setGuideLineLocked: (guideLineId, locked) =>
		set((state) => ({
			guideLines: reduceGuideLines(state.guideLines, {
				type: "set-locked",
				guideLineId,
				locked,
			}),
		})),
	setGuideViewPreference: (preference, visible) =>
		set((state) => ({
			view: reduceGuideViewPreferences(state.view, {
				type: "set",
				preference,
				visible,
			}),
		})),
	toggleGuideViewPreference: (preference) =>
		set((state) => ({
			view: reduceGuideViewPreferences(state.view, {
				type: "toggle",
				preference,
			}),
		})),
	setWorkspaceGridVisible: (visible) =>
		set((state) => ({
			view: reduceGuideViewPreferences(state.view, {
				type: "set",
				preference: "workspaceGridVisible",
				visible,
			}),
		})),
	toggleWorkspaceGridVisible: () =>
		set((state) => ({
			view: reduceGuideViewPreferences(state.view, {
				type: "toggle",
				preference: "workspaceGridVisible",
			}),
		})),
	setGridVisible: (visible) =>
		set((state) => ({
			view: reduceGuideViewPreferences(state.view, {
				type: "set",
				preference: "gridVisible",
				visible,
			}),
		})),
	toggleGridVisible: () =>
		set((state) => ({
			view: reduceGuideViewPreferences(state.view, {
				type: "toggle",
				preference: "gridVisible",
			}),
		})),
	toggleGridGroup: () =>
		set((state) => {
			// One user-facing "grid" = workspace/desk grid + artboard layout grid.
			// Drive BOTH flags to a single common target (set, not per-flag toggle)
			// so an out-of-phase pair — possible because the legacy Cmd+' flipped
			// only the layout flag — converges instead of diverging. The OR-based
			// `next` means: if anything is showing, hide everything; only when both
			// are already hidden does it show. Pixel grid stays a separate toggle.
			const next = !(state.view.workspaceGridVisible || state.view.gridVisible);
			return {
				view: reduceGuideViewPreferences(
					reduceGuideViewPreferences(state.view, {
						type: "set",
						preference: "workspaceGridVisible",
						visible: next,
					}),
					{ type: "set", preference: "gridVisible", visible: next },
				),
			};
		}),
	setPixelGridVisible: (visible) =>
		set((state) => ({
			view: reduceGuideViewPreferences(state.view, {
				type: "set",
				preference: "pixelGridVisible",
				visible,
			}),
		})),
	togglePixelGridVisible: () =>
		set((state) => ({
			view: reduceGuideViewPreferences(state.view, {
				type: "toggle",
				preference: "pixelGridVisible",
			}),
		})),
	setRulersVisible: (visible) =>
		set((state) => ({
			view: reduceGuideViewPreferences(state.view, {
				type: "set",
				preference: "rulersVisible",
				visible,
			}),
		})),
	toggleRulersVisible: () =>
		set((state) => ({
			view: reduceGuideViewPreferences(state.view, {
				type: "toggle",
				preference: "rulersVisible",
			}),
		})),
	setGuideLinesVisible: (visible) =>
		set((state) => ({
			view: reduceGuideViewPreferences(state.view, {
				type: "set",
				preference: "guideLinesVisible",
				visible,
			}),
		})),
	toggleGuideLinesVisible: () =>
		set((state) => ({
			view: reduceGuideViewPreferences(state.view, {
				type: "toggle",
				preference: "guideLinesVisible",
			}),
		})),
	setSmartGuides: (enabled) =>
		set((state) => ({
			snap: reduceGuideSnapPreferences(state.snap, {
				type: "set",
				preference: "smartGuides",
				enabled,
			}),
		})),
	toggleSmartGuides: () =>
		set((state) => ({
			snap: reduceGuideSnapPreferences(state.snap, {
				type: "toggle",
				preference: "smartGuides",
			}),
		})),
	setSnapToPoint: (enabled) =>
		set((state) => ({
			snap: reduceGuideSnapPreferences(state.snap, {
				type: "set",
				preference: "snapToPoint",
				enabled,
			}),
		})),
	toggleSnapToPoint: () =>
		set((state) => ({
			snap: reduceGuideSnapPreferences(state.snap, {
				type: "toggle",
				preference: "snapToPoint",
			}),
		})),
	showActiveSnap: (result, options) =>
		set((state) => {
			const next: ActiveGuideSnap = {
				result,
				isDragging: options?.isDragging ?? false,
				origin: options?.origin,
			};
			return sameActiveGuideSnap(state.activeSnap, next)
				? state
				: { activeSnap: next };
		}),
	setActiveSnap: (result, options) =>
		set((state) => {
			const next: ActiveGuideSnap = {
				result,
				isDragging: options?.isDragging ?? false,
				origin: options?.origin,
			};
			return sameActiveGuideSnap(state.activeSnap, next)
				? state
				: { activeSnap: next };
		}),
	clearActiveSnap: () =>
		set((state) => (state.activeSnap === null ? state : { activeSnap: null })),
}));

// Persist the view preferences out-of-band — they are editor chrome state, never
// scene/motion history. reduceGuideViewPreferences preserves object identity on
// no-op updates, so the reference check writes only on a real change, and the
// frequent activeSnap churn during drags never triggers a save.
useGuideStore.subscribe((state, previous) => {
	if (state.view === previous.view) return;
	void guideViewAdapter.save(JSON.stringify(state.view));
});

// Persist snap-behavior preferences on a dedicated key. reduceGuideSnapPreferences
// preserves object identity on no-op updates, so the reference check writes only
// on a real change and never thrashes during the high-frequency activeSnap churn.
useGuideStore.subscribe((state, previous) => {
	if (state.snap === previous.snap) return;
	void guideSnapAdapter.save(JSON.stringify(state.snap));
});
