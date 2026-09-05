import {
	collectGuideCandidates,
	snapPointToGuides,
} from "@/entities/guides/model/snapping";
import { useGuideStore } from "@/entities/guides/model/store";
import type { SceneDocument } from "@/entities/scene/model/types";
import { modifierStateFromEvent } from "@/shared/lib/modifiers";
import { commitFrameFromBounds } from "../model/frame-commit";
import {
	frameRectFromDraft,
	useFrameDraftStore,
} from "../model/frame-draft-store";

// Local structural mirror of the canvas registry surface. Features cannot import
// the widget-layer registry types (the arch gate bans upward imports), so the
// handler is typed against this subset; the host passes a compatible superset of
// `HandlerApi` / `CanvasPointerContext`.
type LocalToolId = "select" | "frame";

type CanvasPoint = {
	readonly x: number;
	readonly y: number;
};

type PointerContext = {
	readonly point: CanvasPoint;
	/**
	 * Pointer in pasteboard ("world") space. Artboards carry no matrix and live
	 * in this space, so frame creation reads this rather than the artboard-local
	 * `point` (which the shape tools use).
	 */
	readonly pasteboardPoint: CanvasPoint;
	readonly hitNodeId: string | null;
	readonly event: PointerEvent;
};

type HostApi = {
	readonly getDoc: () => SceneDocument;
	readonly viewport: { readonly zoom: number };
	readonly selectArtboard: (artboardId: string | null) => void;
	readonly setActiveTool: (tool: LocalToolId) => void;
};

type FrameToolHandler = {
	readonly id: string;
	readonly tool: LocalToolId;
	readonly onPointerDown: (context: PointerContext, api: HostApi) => void;
	readonly onPointerMove: (context: PointerContext, api: HostApi) => void;
	readonly onPointerUp: (context: PointerContext, api: HostApi) => void;
	readonly onKeyDown?: (event: KeyboardEvent, api: HostApi) => void;
	readonly onDeactivate?: (api: HostApi) => void;
};

const PERCENT = 100;
// A drag smaller than this on screen is treated as a click, so a stray tap does
// not spawn a sliver artboard. Matches the shape tool's click-vs-drag intent.
const MIN_FRAME_SIZE_PX = 8;

const screenScale = (api: HostApi): number =>
	Math.max(api.viewport.zoom / PERCENT, 0.001);

const SNAP_THRESHOLD_PX = 6;

const draftModifiers = (
	event: PointerEvent,
): { readonly constrain: boolean; readonly fromCenter: boolean } => {
	const modifiers = modifierStateFromEvent(event);
	return { constrain: modifiers.constrain, fromCenter: modifiers.fromCenter };
};

const clearFrameSnap = (): void => {
	useGuideStore.getState().clearActiveSnap();
};

/**
 * Snaps a pasteboard-space frame corner to smart-guide candidates — existing
 * artboard edges/centers, visible grid lines, and guide lines — and drives the
 * shared snap indicator. Artboards live in pasteboard space, so (unlike the draw
 * tools' artboard-local snapping) the point, candidates, and indicator origin are
 * all world-space, hence origin `{0,0}`. Gated on the Smart Guides toggle; grid
 * and guide-line candidates additionally respect their own visibility. Node
 * objects are excluded — a frame aligns to artboards and the grid, not to every
 * small shape edge.
 */
const snapFramePoint = (
	point: CanvasPoint,
	api: HostApi,
	isDragging: boolean,
): CanvasPoint => {
	const guide = useGuideStore.getState();
	if (!guide.snap.smartGuides) {
		clearFrameSnap();
		return point;
	}
	const candidates = collectGuideCandidates(api.getDoc(), {
		includeArtboard: true,
		includeObjects: false,
		includeGrid: guide.view.gridVisible,
		includeGuideLines: guide.view.guideLinesVisible,
		guideLines: guide.view.guideLinesVisible ? guide.guideLines : [],
	});
	const result = snapPointToGuides(point, {
		enabled: true,
		thresholdPx: SNAP_THRESHOLD_PX,
		projection: { zoom: screenScale(api), pan: { x: 0, y: 0 } },
		candidates,
		showMeasurements: isDragging,
	});
	if (!result.snapped) {
		clearFrameSnap();
		return point;
	}
	useGuideStore.getState().setActiveSnap(result, {
		isDragging,
		origin: { x: 0, y: 0 },
	});
	return result.adjustedPoint;
};

const onFrameDown = (context: PointerContext, api: HostApi): void => {
	if (context.event.button !== 0) return;
	// Any fresh press dismisses an open preset menu — the user is drawing instead.
	useFrameDraftStore.getState().setPresetAnchor(null);
	const start = snapFramePoint(context.pasteboardPoint, api, false);
	useFrameDraftStore.getState().setDraft({
		start,
		current: start,
		...draftModifiers(context.event),
	});
};

const onFrameMove = (context: PointerContext, api: HostApi): void => {
	const draft = useFrameDraftStore.getState().draft;
	if (!draft) return;
	// A move with no button held means the press ended without a pointerup we
	// observed (pointercancel / lost capture); abandon so the preview does not
	// stick to the canvas.
	if (context.event.buttons === 0) {
		useFrameDraftStore.getState().clearDraft();
		clearFrameSnap();
		return;
	}
	useFrameDraftStore.getState().setDraft({
		start: draft.start,
		current: snapFramePoint(context.pasteboardPoint, api, true),
		...draftModifiers(context.event),
	});
};

const onFrameUp = (_context: PointerContext, api: HostApi): void => {
	const draft = useFrameDraftStore.getState().draft;
	useFrameDraftStore.getState().clearDraft();
	clearFrameSnap();
	if (!draft) return;

	const rect = frameRectFromDraft(draft);
	// A click or sub-threshold drag is not a sized frame — instead of a no-op,
	// open the size-preset menu at the press point (Figma opens presets on click).
	const minSize = MIN_FRAME_SIZE_PX / screenScale(api);
	if (rect.width < minSize || rect.height < minSize) {
		useFrameDraftStore.getState().setPresetAnchor(draft.start);
		return;
	}

	const result = commitFrameFromBounds(rect);
	if (!result) return;
	// Select the new artboard and hand control back to the select tool, matching
	// the draw tools' author-then-select flow.
	api.selectArtboard(result.artboardId);
	api.setActiveTool("select");
};

const onFrameKeyDown = (event: KeyboardEvent, _api: HostApi): void => {
	if (event.key !== "Escape") return;
	useFrameDraftStore.getState().clear();
	clearFrameSnap();
};

const onFrameDeactivate = (): void => {
	useFrameDraftStore.getState().clear();
	clearFrameSnap();
};

const frameHandler: FrameToolHandler = {
	id: "artboard-frame",
	tool: "frame",
	onPointerDown: onFrameDown,
	onPointerMove: onFrameMove,
	onPointerUp: onFrameUp,
	onKeyDown: onFrameKeyDown,
	onDeactivate: onFrameDeactivate,
};

export const handler = frameHandler;
