import {
	INSPECTOR_MOTION_HEIGHT_MIN,
	inspectorMotionHeightCeiling,
} from "@/shared/lib/inspector-motion-height";
import {
	LOOK_WORKSPACE_HEIGHT_MIN,
	lookWorkspaceHeightCeiling,
} from "@/shared/lib/look-workspace-height";
import {
	MOTION_COPILOT_WIDTH_MAX,
	MOTION_COPILOT_WIDTH_MIN,
} from "@/shared/lib/motion-copilot-width";
import { PANEL_WIDTH_MAX, PANEL_WIDTH_MIN } from "@/shared/lib/panel-width";
import {
	TIMELINE_HEIGHT_MIN,
	timelineHeightCeiling,
} from "@/shared/lib/timeline-height";
import { useEditorChromeStore } from "./store";

/**
 * `left`/`right` resize a side-panel WIDTH (vertical splitter); `timeline`
 * resizes the docked timeline HEIGHT (horizontal splitter at its top edge);
 * `look-workspace` resizes the bottom Look Graph dock HEIGHT;
 * `inspector-motion` resizes the Inspector's bottom motion pane HEIGHT
 * (horizontal splitter at its top edge).
 */
export type PanelResizeTarget =
	| "left"
	| "right"
	| "timeline"
	| "look-workspace"
	| "inspector-motion"
	| "motion-copilot";

/** @deprecated alias kept for existing call sites. */
export type PanelSide = "left" | "right";

export type PanelResizeWiring = {
	readonly growDirection: 1 | -1;
	readonly min: number;
	readonly max: number;
	readonly getCurrentWidth: () => number;
	readonly onResizeTick: (size: number) => void;
	readonly onResizeEnd: (size: number) => void;
	readonly onReset: () => void;
};

const CSS_VAR_BY_TARGET: Record<PanelResizeTarget, string> = {
	left: "--editor-left-panel-width",
	right: "--editor-right-panel-width",
	timeline: "--editor-timeline-expanded-height",
	"look-workspace": "--editor-look-workspace-height",
	"inspector-motion": "--editor-inspector-motion-height",
	"motion-copilot": "--editor-motion-copilot-width",
};

/**
 * Wires a {@link PanelResizeHandle} to the editor chrome store without
 * subscribing to the size: every read goes through `getState()`, so mounting
 * this inside the heavy panel widgets never re-renders them when size changes.
 * Live drags write the same root CSS variables that EditorPage commits.
 */
export function usePanelResize(target: PanelResizeTarget): PanelResizeWiring {
	const cssVar = CSS_VAR_BY_TARGET[target];
	if (target === "timeline") {
		return {
			// Bottom-anchored: dragging the top edge UP (clientY shrinks) must grow.
			growDirection: -1,
			min: TIMELINE_HEIGHT_MIN,
			max: timelineHeightCeiling(globalThis.innerHeight),
			getCurrentWidth: () => useEditorChromeStore.getState().timelineHeight,
			onResizeTick: (size) => {
				document.documentElement.style.setProperty(cssVar, `${size}px`);
			},
			onResizeEnd: (size) => {
				useEditorChromeStore.getState().setTimelineHeight(size);
			},
			onReset: () => {
				useEditorChromeStore.getState().resetTimelineHeight();
			},
		};
	}
	if (target === "look-workspace") {
		return {
			// Bottom-anchored: dragging the top edge UP (clientY shrinks) must grow.
			growDirection: -1,
			min: LOOK_WORKSPACE_HEIGHT_MIN,
			max: lookWorkspaceHeightCeiling(globalThis.innerHeight),
			getCurrentWidth: () =>
				useEditorChromeStore.getState().lookWorkspaceHeight,
			onResizeTick: (size) => {
				document.documentElement.style.setProperty(cssVar, `${size}px`);
			},
			onResizeEnd: (size) => {
				useEditorChromeStore.getState().setLookWorkspaceHeight(size);
			},
			onReset: () => {
				useEditorChromeStore.getState().resetLookWorkspaceHeight();
			},
		};
	}
	if (target === "inspector-motion") {
		return {
			// Bottom-anchored within the Inspector: dragging the top edge UP grows it.
			growDirection: -1,
			min: INSPECTOR_MOTION_HEIGHT_MIN,
			max: inspectorMotionHeightCeiling(globalThis.innerHeight),
			getCurrentWidth: () =>
				useEditorChromeStore.getState().inspectorMotionHeight,
			onResizeTick: (size) => {
				document.documentElement.style.setProperty(cssVar, `${size}px`);
			},
			onResizeEnd: (size) => {
				useEditorChromeStore.getState().setInspectorMotionHeight(size);
			},
			onReset: () => {
				useEditorChromeStore.getState().resetInspectorMotionHeight();
			},
		};
	}
	if (target === "motion-copilot") {
		return {
			// Right-anchored dock: dragging the left edge LEFT (clientX shrinks) grows it.
			growDirection: -1,
			min: MOTION_COPILOT_WIDTH_MIN,
			max: MOTION_COPILOT_WIDTH_MAX,
			getCurrentWidth: () => useEditorChromeStore.getState().motionCopilotWidth,
			onResizeTick: (size) => {
				document.documentElement.style.setProperty(cssVar, `${size}px`);
			},
			onResizeEnd: (size) => {
				useEditorChromeStore.getState().setMotionCopilotWidth(size);
			},
			onReset: () => {
				useEditorChromeStore.getState().resetMotionCopilotWidth();
			},
		};
	}
	return {
		growDirection: target === "left" ? 1 : -1,
		min: PANEL_WIDTH_MIN,
		max: PANEL_WIDTH_MAX,
		getCurrentWidth: () => {
			const state = useEditorChromeStore.getState();
			return target === "left" ? state.leftPanelWidth : state.rightPanelWidth;
		},
		onResizeTick: (size) => {
			document.documentElement.style.setProperty(cssVar, `${size}px`);
		},
		onResizeEnd: (size) => {
			const state = useEditorChromeStore.getState();
			if (target === "left") state.setLeftPanelWidth(size);
			else state.setRightPanelWidth(size);
		},
		onReset: () => {
			const state = useEditorChromeStore.getState();
			if (target === "left") state.resetLeftPanelWidth();
			else state.resetRightPanelWidth();
		},
	};
}
