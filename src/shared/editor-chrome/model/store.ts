import { create } from "zustand";
import {
	clampInspectorMotionHeight,
	DEFAULT_INSPECTOR_MOTION_HEIGHT,
	hydrateInspectorMotionHeight,
	INSPECTOR_MOTION_HEIGHT_STORAGE_KEY,
	serializeInspectorMotionHeight,
} from "@/shared/lib/inspector-motion-height";
import {
	clampLookWorkspaceHeight,
	DEFAULT_LOOK_WORKSPACE_HEIGHT,
	hydrateLookWorkspaceHeight,
	LOOK_WORKSPACE_EXPANDED_HEIGHT,
	LOOK_WORKSPACE_HEIGHT_STORAGE_KEY,
	lookWorkspaceHeightCeiling,
	serializeLookWorkspaceHeight,
} from "@/shared/lib/look-workspace-height";
import {
	clampMotionCopilotWidth,
	DEFAULT_MOTION_COPILOT_WIDTH,
	hydrateMotionCopilotWidth,
	MOTION_COPILOT_WIDTH_STORAGE_KEY,
	serializeMotionCopilotWidth,
} from "@/shared/lib/motion-copilot-width";
import {
	clampPanelWidth,
	DEFAULT_LEFT_PANEL_WIDTH,
	DEFAULT_RIGHT_PANEL_WIDTH,
	hydratePanelWidths,
	PANEL_WIDTH_STORAGE_KEY,
	type PanelWidths,
	serializePanelWidths,
} from "@/shared/lib/panel-width";
import {
	createDebouncedPersistenceWriter,
	createLocalStorageTextAdapter,
	readLocalStorageTextSync,
} from "@/shared/lib/persistence";
import {
	clampTimelineHeight,
	DEFAULT_TIMELINE_HEIGHT,
	hydrateTimelineHeight,
	serializeTimelineHeight,
	TIMELINE_HEIGHT_STORAGE_KEY,
} from "@/shared/lib/timeline-height";

export type EditorPanelId = "layers" | "inspector" | "timeline";

/**
 * A one-shot request to focus the motion Graph on a specific track (Creator 2,
 * C2-L2 "Open in Graph"). Deliberately minimal and motion-type-free so it lives
 * in `shared` — the consumer (`features/motion` MotionTimeline) resolves it
 * against the live MotionDocument at consume time and drops it if the track/key
 * no longer exists (fail closed, no guessing). `frame` is an optional hint;
 * absent, the consumer seeds the track's first keyframe.
 */
export type EditorGraphFocusIntent = {
	readonly trackId: string;
	readonly frame?: number;
};

export type EditorPanelVisibility = {
	readonly panelsOpen: boolean;
	readonly layersOpen: boolean;
	readonly inspectorOpen: boolean;
	readonly timelineOpen: boolean;
	readonly lookWorkspaceOpen: boolean;
};

export type EditorPanelVisibilityAction =
	| { readonly type: "toggle-side-panels" }
	| { readonly type: "toggle-panel"; readonly panel: EditorPanelId };

type EditorChromeState = {
	panelsOpen: boolean;
	layersOpen: boolean;
	inspectorOpen: boolean;
	timelineOpen: boolean;
	lookWorkspaceOpen: boolean;
	/**
	 * Look Graph workspace shown in a separate OS window (`window.open`) instead of
	 * docked. Orthogonal to `lookWorkspaceOpen` (which stays true while detached, so
	 * the popup mounts). A detached workspace also frees the docked footprint, so
	 * the canvas reclaims the bottom strip — see EditorPage's `look-workspace-mode`
	 * gate. Never persisted: a popup cannot be re-attached across a reload.
	 */
	lookWorkspaceDetached: boolean;
	/** Session-only metadata-blind review window; never persisted into the project. */
	visualReviewOpen: boolean;
	parameterCaptureOpen: boolean;
	commandPaletteOpen: boolean;
	shortcutHelpOpen: boolean;
	leftPanelWidth: number;
	rightPanelWidth: number;
	/**
	 * Timeline mode (Motion workspace): a reserved-space tall docked timeline.
	 * Orthogonal to `timelineOpen` (visibility) — the mode layout activates only
	 * when `timelineOpen && timelineExpanded`, so the compact floating peek stays
	 * intact when the mode is off.
	 */
	timelineExpanded: boolean;
	/**
	 * Motion Copilot panel (Creator 2, C2-L2): a persistent, collapsible
	 * right-anchored authoring dock composed by the Editor page. Chrome state only
	 * (never scene/motion history). It never blankets the canvas — the canvas stays
	 * usable with it open.
	 */
	motionCopilotOpen: boolean;
	/** Resizable/persisted width (px) of the Motion Copilot dock. */
	motionCopilotWidth: number;
	/**
	 * One-shot "Open in Graph" request consumed once by MotionTimeline. Null when
	 * there is nothing to focus. See {@link EditorGraphFocusIntent}.
	 */
	graphFocusIntent: EditorGraphFocusIntent | null;
	/**
	 * One-shot "open the account/billing surface" request (Creator 2, C2-R2),
	 * consumed once by the TopBar's `BillingEntry`. Lets a non-entitled Motion
	 * Copilot composer route the user to the EXISTING upgrade/Change-plan surface
	 * without a second billing UI or a feature-to-feature import.
	 */
	accountMenuOpenIntent: boolean;
	/** Resizable/persisted height (px) of the docked timeline while expanded. */
	timelineHeight: number;
	/** Resizable/persisted height (px) of the docked Look Graph workspace. */
	lookWorkspaceHeight: number;
	/**
	 * Resizable/persisted height (px) of the Inspector's motion pane. When a
	 * motion clip is focused the Inspector splits into a normal pane (top) and a
	 * motion pane (bottom); this is the bottom pane's height. CSS caps it at 62%
	 * of the Inspector body, so the normal pane always keeps ≥38%.
	 */
	inspectorMotionHeight: number;
	setLeftPanelWidth: (width: number) => void;
	setRightPanelWidth: (width: number) => void;
	resetLeftPanelWidth: () => void;
	resetRightPanelWidth: () => void;
	toggleTimelineExpanded: () => void;
	/** Idempotent Timeline-mode setter — used by "Open in Graph" to force the graph-capable layout. */
	setTimelineExpanded: (expanded: boolean) => void;
	toggleMotionCopilot: () => void;
	setMotionCopilotOpen: (open: boolean) => void;
	setMotionCopilotWidth: (width: number) => void;
	resetMotionCopilotWidth: () => void;
	/** Requests an "Open in Graph" focus and forces the Timeline into graph-capable mode. */
	requestGraphFocus: (intent: EditorGraphFocusIntent) => void;
	/** Clears the pending graph-focus request after MotionTimeline consumes it. */
	consumeGraphFocus: () => void;
	/** Requests the account/billing surface be opened (C2-R2 upgrade routing). */
	requestAccountMenuOpen: () => void;
	/** Clears the pending account-menu-open request after the TopBar consumes it. */
	consumeAccountMenuOpen: () => void;
	setTimelineHeight: (height: number) => void;
	resetTimelineHeight: () => void;
	setLookWorkspaceHeight: (height: number) => void;
	resetLookWorkspaceHeight: () => void;
	toggleLookWorkspaceExpanded: () => void;
	setInspectorMotionHeight: (height: number) => void;
	resetInspectorMotionHeight: () => void;
	togglePanels: () => void;
	toggleLayersPanel: () => void;
	toggleInspectorPanel: () => void;
	toggleTimeline: () => void;
	toggleLookWorkspace: () => void;
	/** Reveal the Look workspace in a separate OS window (opens it if closed). */
	detachLookWorkspace: () => void;
	/** Re-dock the Look workspace into the editor (keeps it open). */
	dockLookWorkspace: () => void;
	setVisualReviewOpen: (open: boolean) => void;
	toggleVisualReview: () => void;
	setParameterCaptureOpen: (open: boolean) => void;
	toggleParameterCapture: () => void;
	setCommandPaletteOpen: (open: boolean) => void;
	toggleCommandPalette: () => void;
	setShortcutHelpOpen: (open: boolean) => void;
	toggleShortcutHelp: () => void;
};

const sidePanelsOpen = (
	visibility: Pick<EditorPanelVisibility, "layersOpen" | "inspectorOpen">,
): boolean => visibility.layersOpen || visibility.inspectorOpen;

/**
 * Keeps the legacy side-panel aggregate in sync with per-panel visibility.
 * Panel visibility is editor chrome state only, so transitions stay outside the
 * scene and motion command histories.
 */
export function reduceEditorPanelVisibility(
	visibility: EditorPanelVisibility,
	action: EditorPanelVisibilityAction,
): EditorPanelVisibility {
	if (action.type === "toggle-side-panels") {
		const nextOpen = !sidePanelsOpen(visibility);
		return {
			...visibility,
			panelsOpen: nextOpen,
			layersOpen: nextOpen,
			inspectorOpen: nextOpen,
		};
	}

	if (action.panel === "timeline") {
		return {
			...visibility,
			timelineOpen: !visibility.timelineOpen,
		};
	}

	const nextVisibility = {
		...visibility,
		...(action.panel === "layers"
			? { layersOpen: !visibility.layersOpen }
			: { inspectorOpen: !visibility.inspectorOpen }),
	};

	return {
		...nextVisibility,
		panelsOpen: sidePanelsOpen(nextVisibility),
	};
}

const selectPanelVisibility = (
	state: EditorPanelVisibility,
): EditorPanelVisibility => ({
	panelsOpen: state.panelsOpen,
	layersOpen: state.layersOpen,
	inspectorOpen: state.inspectorOpen,
	timelineOpen: state.timelineOpen,
	lookWorkspaceOpen: state.lookWorkspaceOpen,
});

const PANEL_WIDTH_DEBOUNCE_MS = 250;

const panelWidthAdapter = createLocalStorageTextAdapter({
	key: PANEL_WIDTH_STORAGE_KEY,
});

/**
 * Debounced singleton writer for the panel-width pair. Width is editor chrome
 * state (never scene/motion history), so it persists out-of-band; the debounce
 * coalesces a drag-end burst into one localStorage write.
 */
const panelWidthWriter = createDebouncedPersistenceWriter<PanelWidths>({
	delayMs: PANEL_WIDTH_DEBOUNCE_MS,
	save: (widths) => panelWidthAdapter.save(serializePanelWidths(widths)),
});

// Synchronous seed at store creation: an async load would flash the default
// width before the persisted value arrives on every reload.
const initialPanelWidths = hydratePanelWidths(
	readLocalStorageTextSync({ key: PANEL_WIDTH_STORAGE_KEY }),
);

const timelineHeightAdapter = createLocalStorageTextAdapter({
	key: TIMELINE_HEIGHT_STORAGE_KEY,
});

/**
 * Debounced singleton writer for the expanded timeline height. Like panel
 * widths it is editor chrome state (never scene/motion history), persisted
 * out-of-band under its OWN key so the panel-width payload shape is untouched.
 */
const timelineHeightWriter = createDebouncedPersistenceWriter<number>({
	delayMs: PANEL_WIDTH_DEBOUNCE_MS,
	save: (height) => timelineHeightAdapter.save(serializeTimelineHeight(height)),
});

const initialTimelineHeight = hydrateTimelineHeight(
	readLocalStorageTextSync({ key: TIMELINE_HEIGHT_STORAGE_KEY }),
);

const lookWorkspaceHeightAdapter = createLocalStorageTextAdapter({
	key: LOOK_WORKSPACE_HEIGHT_STORAGE_KEY,
});

/**
 * Debounced singleton writer for the Look Graph dock height. This mirrors the
 * timeline height path because both are bottom-anchored editor chrome surfaces.
 */
const lookWorkspaceHeightWriter = createDebouncedPersistenceWriter<number>({
	delayMs: PANEL_WIDTH_DEBOUNCE_MS,
	save: (height) =>
		lookWorkspaceHeightAdapter.save(serializeLookWorkspaceHeight(height)),
});

const initialLookWorkspaceHeight = hydrateLookWorkspaceHeight(
	readLocalStorageTextSync({ key: LOOK_WORKSPACE_HEIGHT_STORAGE_KEY }),
);

const inspectorMotionHeightAdapter = createLocalStorageTextAdapter({
	key: INSPECTOR_MOTION_HEIGHT_STORAGE_KEY,
});

/**
 * Debounced singleton writer for the Inspector motion-pane height. Editor chrome
 * state (never scene/motion history), persisted out-of-band under its OWN key so
 * neither the panel-width nor timeline-height payload shapes are touched.
 */
const inspectorMotionHeightWriter = createDebouncedPersistenceWriter<number>({
	delayMs: PANEL_WIDTH_DEBOUNCE_MS,
	save: (height) =>
		inspectorMotionHeightAdapter.save(serializeInspectorMotionHeight(height)),
});

const initialInspectorMotionHeight = hydrateInspectorMotionHeight(
	readLocalStorageTextSync({ key: INSPECTOR_MOTION_HEIGHT_STORAGE_KEY }),
);

const motionCopilotWidthAdapter = createLocalStorageTextAdapter({
	key: MOTION_COPILOT_WIDTH_STORAGE_KEY,
});

/**
 * Debounced singleton writer for the Motion Copilot dock width. Editor chrome
 * state (never scene/motion history), persisted out-of-band under its OWN key so
 * no other panel payload shape is touched.
 */
const motionCopilotWidthWriter = createDebouncedPersistenceWriter<number>({
	delayMs: PANEL_WIDTH_DEBOUNCE_MS,
	save: (width) =>
		motionCopilotWidthAdapter.save(serializeMotionCopilotWidth(width)),
});

const initialMotionCopilotWidth = hydrateMotionCopilotWidth(
	readLocalStorageTextSync({ key: MOTION_COPILOT_WIDTH_STORAGE_KEY }),
);

export const useEditorChromeStore = create<EditorChromeState>()((set, get) => ({
	panelsOpen: false,
	layersOpen: false,
	inspectorOpen: false,
	timelineOpen: false,
	lookWorkspaceOpen: false,
	lookWorkspaceDetached: false,
	visualReviewOpen: false,
	parameterCaptureOpen: false,
	commandPaletteOpen: false,
	shortcutHelpOpen: false,
	leftPanelWidth: initialPanelWidths.left,
	rightPanelWidth: initialPanelWidths.right,
	timelineExpanded: false,
	motionCopilotOpen: false,
	motionCopilotWidth: initialMotionCopilotWidth,
	graphFocusIntent: null,
	accountMenuOpenIntent: false,
	timelineHeight: initialTimelineHeight,
	lookWorkspaceHeight: initialLookWorkspaceHeight,
	inspectorMotionHeight: initialInspectorMotionHeight,
	setLeftPanelWidth: (width) => {
		const leftPanelWidth = clampPanelWidth(width);
		set({ leftPanelWidth });
		panelWidthWriter.schedule({
			left: leftPanelWidth,
			right: get().rightPanelWidth,
		});
	},
	setRightPanelWidth: (width) => {
		const rightPanelWidth = clampPanelWidth(width);
		set({ rightPanelWidth });
		panelWidthWriter.schedule({
			left: get().leftPanelWidth,
			right: rightPanelWidth,
		});
	},
	resetLeftPanelWidth: () => {
		set({ leftPanelWidth: DEFAULT_LEFT_PANEL_WIDTH });
		panelWidthWriter.schedule({
			left: DEFAULT_LEFT_PANEL_WIDTH,
			right: get().rightPanelWidth,
		});
	},
	resetRightPanelWidth: () => {
		set({ rightPanelWidth: DEFAULT_RIGHT_PANEL_WIDTH });
		panelWidthWriter.schedule({
			left: get().leftPanelWidth,
			right: DEFAULT_RIGHT_PANEL_WIDTH,
		});
	},
	togglePanels: () =>
		set((state) =>
			reduceEditorPanelVisibility(selectPanelVisibility(state), {
				type: "toggle-side-panels",
			}),
		),
	toggleLayersPanel: () =>
		set((state) =>
			reduceEditorPanelVisibility(selectPanelVisibility(state), {
				type: "toggle-panel",
				panel: "layers",
			}),
		),
	toggleInspectorPanel: () =>
		set((state) =>
			reduceEditorPanelVisibility(selectPanelVisibility(state), {
				type: "toggle-panel",
				panel: "inspector",
			}),
		),
	toggleTimeline: () =>
		set((state) => {
			const visibility = reduceEditorPanelVisibility(
				selectPanelVisibility(state),
				{ type: "toggle-panel", panel: "timeline" },
			);
			// Hiding the timeline also exits Timeline mode, so the next reveal is the
			// compact peek rather than a surprise jump back into the tall docked layout.
			return visibility.timelineOpen
				? {
						...visibility,
						lookWorkspaceOpen: false,
						lookWorkspaceDetached: false,
					}
				: { ...visibility, timelineExpanded: false };
		}),
	toggleLookWorkspace: () =>
		set((state) =>
			state.lookWorkspaceOpen
				? { lookWorkspaceOpen: false, lookWorkspaceDetached: false }
				: {
						lookWorkspaceOpen: true,
						lookWorkspaceDetached: false,
						timelineOpen: false,
						timelineExpanded: false,
					},
		),
	detachLookWorkspace: () =>
		set({
			lookWorkspaceOpen: true,
			lookWorkspaceDetached: true,
			timelineOpen: false,
			timelineExpanded: false,
		}),
	dockLookWorkspace: () => set({ lookWorkspaceDetached: false }),
	setVisualReviewOpen: (visualReviewOpen) => set({ visualReviewOpen }),
	toggleVisualReview: () =>
		set((state) => ({ visualReviewOpen: !state.visualReviewOpen })),
	toggleTimelineExpanded: () =>
		set((state) =>
			state.timelineExpanded
				? { timelineExpanded: false }
				: // Expanding a hidden timeline is meaningless — the mode forces it visible.
					{
						timelineExpanded: true,
						timelineOpen: true,
						lookWorkspaceOpen: false,
						lookWorkspaceDetached: false,
					},
		),
	setTimelineExpanded: (expanded) =>
		set(() =>
			expanded
				? {
						timelineExpanded: true,
						timelineOpen: true,
						lookWorkspaceOpen: false,
						lookWorkspaceDetached: false,
					}
				: { timelineExpanded: false },
		),
	toggleMotionCopilot: () =>
		set((state) => ({ motionCopilotOpen: !state.motionCopilotOpen })),
	setMotionCopilotOpen: (motionCopilotOpen) => set({ motionCopilotOpen }),
	setMotionCopilotWidth: (width) => {
		const motionCopilotWidth = clampMotionCopilotWidth(width);
		set({ motionCopilotWidth });
		motionCopilotWidthWriter.schedule(motionCopilotWidth);
	},
	resetMotionCopilotWidth: () => {
		set({ motionCopilotWidth: DEFAULT_MOTION_COPILOT_WIDTH });
		motionCopilotWidthWriter.schedule(DEFAULT_MOTION_COPILOT_WIDTH);
	},
	requestGraphFocus: (intent) =>
		// Force the graph-capable Timeline layout so the intent's key can be shown
		// in the Value/Speed Graph the moment MotionTimeline consumes it.
		set({
			graphFocusIntent: intent,
			timelineExpanded: true,
			timelineOpen: true,
			lookWorkspaceOpen: false,
			lookWorkspaceDetached: false,
		}),
	consumeGraphFocus: () => set({ graphFocusIntent: null }),
	requestAccountMenuOpen: () => set({ accountMenuOpenIntent: true }),
	consumeAccountMenuOpen: () => set({ accountMenuOpenIntent: false }),
	setTimelineHeight: (height) => {
		const timelineHeight = clampTimelineHeight(height);
		set({ timelineHeight });
		timelineHeightWriter.schedule(timelineHeight);
	},
	resetTimelineHeight: () => {
		set({ timelineHeight: DEFAULT_TIMELINE_HEIGHT });
		timelineHeightWriter.schedule(DEFAULT_TIMELINE_HEIGHT);
	},
	setLookWorkspaceHeight: (height) => {
		const lookWorkspaceHeight = clampLookWorkspaceHeight(height);
		set({ lookWorkspaceHeight });
		lookWorkspaceHeightWriter.schedule(lookWorkspaceHeight);
	},
	resetLookWorkspaceHeight: () => {
		set({ lookWorkspaceHeight: DEFAULT_LOOK_WORKSPACE_HEIGHT });
		lookWorkspaceHeightWriter.schedule(DEFAULT_LOOK_WORKSPACE_HEIGHT);
	},
	toggleLookWorkspaceExpanded: () =>
		set((state) => {
			const expanded =
				state.lookWorkspaceHeight > DEFAULT_LOOK_WORKSPACE_HEIGHT + 80;
			const viewportCeiling = lookWorkspaceHeightCeiling(
				globalThis.innerHeight,
			);
			const lookWorkspaceHeight = expanded
				? DEFAULT_LOOK_WORKSPACE_HEIGHT
				: Math.min(LOOK_WORKSPACE_EXPANDED_HEIGHT, viewportCeiling);
			lookWorkspaceHeightWriter.schedule(lookWorkspaceHeight);
			return { lookWorkspaceHeight };
		}),
	setParameterCaptureOpen: (parameterCaptureOpen) =>
		set({ parameterCaptureOpen }),
	toggleParameterCapture: () =>
		set((state) => ({ parameterCaptureOpen: !state.parameterCaptureOpen })),
	setInspectorMotionHeight: (height) => {
		const inspectorMotionHeight = clampInspectorMotionHeight(height);
		set({ inspectorMotionHeight });
		inspectorMotionHeightWriter.schedule(inspectorMotionHeight);
	},
	resetInspectorMotionHeight: () => {
		set({ inspectorMotionHeight: DEFAULT_INSPECTOR_MOTION_HEIGHT });
		inspectorMotionHeightWriter.schedule(DEFAULT_INSPECTOR_MOTION_HEIGHT);
	},
	setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
	toggleCommandPalette: () =>
		set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen })),
	setShortcutHelpOpen: (shortcutHelpOpen) => set({ shortcutHelpOpen }),
	toggleShortcutHelp: () =>
		set((state) => ({ shortcutHelpOpen: !state.shortcutHelpOpen })),
}));
