import {
	ArrowClockwise,
	ArrowCounterClockwise,
	ArrowLineDown,
	ArrowLineUp,
	BoundingBox,
	Circle,
	ClockCounterClockwise,
	EyeSlash,
	FilmStrip,
	GridFour,
	Lock,
	Palette,
	PenNib,
	Shapes,
	StackSimple,
	Trash,
} from "@phosphor-icons/react";
import {
	type CSSProperties,
	Fragment,
	lazy,
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	Suspense,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	getEditorSessionDescriptor,
	subscribeEditorSessionDescriptor,
} from "@/entities/editor-session/model/session";
import { collectArtboardGridLines } from "@/entities/guides/model/artboard-grid";
import { collectWorkspaceGridLines } from "@/entities/guides/model/snapping";
import { useGuideStore } from "@/entities/guides/model/store";
import { animatedNodeIds } from "@/entities/motion/model/sampler";
import { initialMotionDocument } from "@/entities/motion/model/seed-motion";
import { useMotionStore } from "@/entities/motion/model/store";
import { updateGrammarBinding } from "@/entities/motion-grammar/model/commands";
import {
	currentMotionGrammarTargetNodeIds,
	useMotionGrammarStore,
} from "@/entities/motion-grammar/model/store";
import {
	externalSceneAssetForGeometry,
	programSurfaceAssetForGeometry,
} from "@/entities/scene/model/assets";
import type { SceneCommand } from "@/entities/scene/model/command";
import {
	buildSceneCompositePlan,
	type CompositeRun,
	frontRunNodeIds,
} from "@/entities/scene/model/composite-band";
import type { EffectFilterSpec } from "@/entities/scene/model/effect-filter";
import {
	beginGestureTransaction,
	commitGestureTransaction,
} from "@/entities/scene/model/gesture-transaction";
import { computeGpuArtboardSupport } from "@/entities/scene/model/gpu/capability";
import { scopedPathBlurTopmostTargetNodeIds } from "@/entities/scene/model/gpu-raster-adapter";
import { hitTestSceneStack } from "@/entities/scene/model/hit-testing";
import { materializeLayoutFramesForPresentation } from "@/entities/scene/model/layout-frame-presentation";
import { resolveSceneMaskPlan } from "@/entities/scene/model/mask-render";
import {
	createDeleteNodesCommand,
	createRemoveArtboardCommand,
	createUpdateNodeStyleCommand,
	createUpdateTextNodeCommand,
} from "@/entities/scene/model/node-commands";
import { objectPathBlurScopedLookForNode } from "@/entities/scene/model/path-blur-look";
import { frameHasPathBlurNode } from "@/entities/scene/model/recipe-resolve";
import {
	composeMatrix,
	type Matrix2D,
	matrixFromTransform,
	normalizeTextGeometry,
} from "@/entities/scene/model/rendering";
import {
	scopedLookGraphOverlays,
	scopedLookGraphOverlayTargetMap,
} from "@/entities/scene/model/scoped-look-graph-overlay";
import {
	type ArtboardBounds,
	canvasDeepSelectionTargetId,
	findNode,
	isTopLevelSceneNode,
	type NormalizedArtboard,
	selectAllArtboardBounds,
	selectAllArtboards,
	selectCurrentArtboard,
	selectNodeArtboardMapping,
} from "@/entities/scene/model/selectors";
import { buildSourceOpticsPresentation } from "@/entities/scene/model/source-optics";
import { useSceneStore } from "@/entities/scene/model/store";
import type {
	Bounds,
	RevealPaint,
	SceneDocument,
	Vec2,
	VectorNode,
} from "@/entities/scene/model/types";
import { commitArrangeNodes } from "@/features/arrange/model/actions";
import { commitFramePreset } from "@/features/artboard/model/frame-commit";
import { useFrameDraftStore } from "@/features/artboard/model/frame-draft-store";
import { buildDuplicateClipboardCommand } from "@/features/clipboard/model/clipboard";
import {
	type ActiveCloudProject,
	type EditorCloudSaveFailureReason,
	type EditorCloudSaveStatus,
	useEditorCloudProjectStore,
} from "@/features/cloud-projects/model/editor-cloud-project-store";
import { useDrawStore } from "@/features/draw/model/draw-store";
import { commitFreehandStroke } from "@/features/draw/model/freehand-commit";
import {
	createNativePencilStrokeSessionStore,
	isNativePencilDoubleTapMessage,
	isNativePencilSqueezeMessage,
	isNativePencilStrokeMessage,
	type NativePencilSample,
	nativeSamplesToFreehandPoints,
	nativeSamplesToIntentSamples,
} from "@/features/draw/model/native-pencil";
import {
	SHAPE_TOOL_VARIANTS,
	shapeToolVariant,
} from "@/features/draw/model/shape-variants";
import { convertLastStrokeToShape } from "@/features/draw/model/sketch-to-shape";
import {
	materializeVideoAssetFrames,
	sceneHasVideoMedia,
} from "@/features/export/model/video-frame-materialize";
import { selectedGroupingState } from "@/features/grouping/model/actions";
import { GuidesOverlay } from "@/features/guides/canvas/overlay";
import { guideViewShortcutIntent } from "@/features/guides/model/shortcuts";
import {
	globalRedo,
	globalUndo,
} from "@/features/history/model/undo-coordinator";
import {
	postNativeBridgeMessage,
	postWebCapabilityProbe,
	useIpadAuthoringSurface,
} from "@/features/ipad-shell/model/authoring-surface";
import {
	isNativeHostReadyMessage,
	isNativeProjectBackupOpenCancelledMessage,
	isNativeProjectBackupOpenedMessage,
	isNativeProjectBackupOpenFailedMessage,
	isNativeProjectBackupShareFailedMessage,
	isNativeProjectBackupShareReadyMessage,
	isNativeWebCapabilityProbeMessage,
} from "@/features/ipad-shell/model/native-bridge";
import {
	IpadAppearancePanel,
	type IpadAppearancePatch,
	type IpadAppearanceStyle,
	type IpadTextAppearancePatch,
} from "@/features/ipad-shell/ui/IpadAppearancePanel";
import {
	IpadAuthoringQuickbar,
	type IpadCloudStatus,
	type IpadNativeStatus,
	type IpadQuickbarDock,
	type IpadQuickbarNotice,
	type IpadQuickbarToolAction,
} from "@/features/ipad-shell/ui/IpadAuthoringQuickbar";
import { IpadConversionHud } from "@/features/ipad-shell/ui/IpadConversionHud";
import { IpadMotionTransport } from "@/features/ipad-shell/ui/IpadMotionTransport";
import {
	type IpadCommandAction,
	IpadQuickMenu,
	type IpadQuickMenuState,
} from "@/features/ipad-shell/ui/IpadQuickMenu";
import {
	commitToggleNodeLocked,
	commitToggleNodeVisibility,
} from "@/features/layer-hierarchy/model/visibility-lock-commands";
import { authorStrokeDrawOnFromLastIntent } from "@/features/motion/model/draw-on-authoring";
import { dispatchActiveInteractionPreviewEvent } from "@/features/motion/model/interaction-preview";
import {
	commitPerformRecording,
	recordPerformSample,
} from "@/features/motion/model/perform-recorder";
import { useTransportStore } from "@/features/motion/model/transport-store";
import { PerformIndicator } from "@/features/motion/ui/PerformIndicator";
import { programSurfaceLocalApprovalRegistry } from "@/features/program-surface/model/local-approval";
import { programSurfaceRuntimeStatusRegistry } from "@/features/program-surface/model/runtime-status";
import {
	projectBackupFileName,
	projectBackupMimeType,
	restorePortableProject,
	serializeProjectBackup,
} from "@/features/project-backup/model/project-backup";
import {
	createSceneCameraCanvasHandleDragPlan,
	createSceneCameraCanvasHandleDragStart,
	createSceneCameraCanvasHandleHitContext,
	hitSceneCameraCanvasHandle,
	hitSceneCameraCanvasHandleContext,
	type SceneCameraCanvasHandleDragStart,
	type SceneCameraCanvasHandleHit,
	type SceneCameraCanvasHandleHitContext,
	sceneCameraCanvasHandleDragHud,
} from "@/features/scene-camera/canvas/handles";
import { commitSceneCameraAuthoringPlan } from "@/features/scene-camera/model/authoring";
import { useSelectionStore } from "@/features/selection/model/store";
import { beginTextEditing } from "@/features/text/model/text-node";
import { useToolSelectionStore } from "@/features/tool-selection/model/store";
import {
	getEditorTool,
	type ToolId,
} from "@/features/tool-selection/model/tools";
import { useRepeatTransformStore } from "@/features/transform/model/repeat-transform";
import { useTransformUiStore } from "@/features/transform/model/store";
import {
	type Camera,
	clampZoom,
	screenToWorld,
	wheelDeltaToFactor,
	wheelDeltaToPan,
	worldToScreen,
} from "@/features/viewport/model/camera";
import { useViewportStore } from "@/features/viewport/model/store";
import { isEditableKeyboardTarget } from "@/shared/actions";
import type { BabylonRuntimeSurface } from "@/shared/babylon";
import { useEditorChromeStore } from "@/shared/editor-chrome/model/store";
import {
	isGpuCanvasEnabled,
	isGpuDiffEnabled,
} from "@/shared/lib/gpu-canvas-flag";
import {
	addFrameDiagnosticCount,
	beginFramePhase,
	setFrameDiagnosticGauge,
} from "@/shared/performance/frame-diagnostics";
import { platformCapabilities } from "@/shared/platform/mode";
import { useStrokeIntentStore } from "@/shared/stroke/intent-store";
import { buildPencilStrokeIntent } from "@/shared/stroke/pencil-intent";
import { ContextMenu, type ContextMenuGroup } from "@/shared/ui/ContextMenu";
import { clamp } from "@/shared/ui/scrub-math";
import { Tooltip, TooltipProvider } from "@/shared/ui/Tooltip";
import { documentForArtboard } from "@/widgets/canvas-shell/model/artboard-document";
import { buildArtboardLookPlan } from "@/widgets/canvas-shell/model/artboard-look-plan";
import {
	cameraTransformValue,
	rotationDegrees,
} from "@/widgets/canvas-shell/model/camera-transform";
import {
	quickActionAnchorForSelection,
	selectedNodePasteboardBounds,
} from "@/widgets/canvas-shell/model/context-actions";
import {
	CULL_NODE_THRESHOLD,
	quantizeCullingRect,
	rectForArtboard,
	shouldRenderNodeInView,
	visiblePasteboardRect,
} from "@/widgets/canvas-shell/model/culling";
import { nodeIdsWithGrammarDrivenOpacity } from "@/widgets/canvas-shell/model/gpu-grammar-opacity";
import {
	createIpadPerfCaptureController,
	type IpadPerfCaptureController,
	type IpadPerfLane,
	isIpadPerfCaptureEnabled,
} from "@/widgets/canvas-shell/model/ipad-perf-capture";
import {
	frameForNav,
	frameNavForKey,
	opacityForDigitKey,
	toolShortcutForKey,
} from "@/widgets/canvas-shell/model/keyboard-shortcuts";
import {
	getCanvasPersistentCacheClient,
	registerCanvasCacheDiagnosticsGlobal,
} from "@/widgets/canvas-shell/model/persistent-cache-client";
import { installPlaybackPerformanceDiagnostics } from "@/widgets/canvas-shell/model/playback-performance";
import {
	resolveCanvasPresentationFrame,
	samplePresentation,
} from "@/widgets/canvas-shell/model/presentation";
import {
	createProgramSurfaceHostTraceDiagnostics,
	installProgramSurfaceHostTraceDiagnostics,
	isProgramSurfaceHostTraceDiagnosticsEnabled,
} from "@/widgets/canvas-shell/model/program-surface-host-trace-diagnostics";
import {
	applyProgramSurfaceLiveFrameLease,
	type ProgramSurfaceLiveFrameLease,
	type ProgramSurfaceLiveFrameLeaseUpdate,
} from "@/widgets/canvas-shell/model/program-surface-live-frame-lease";
import { programSurfaceFrameContentKey } from "@/widgets/canvas-shell/model/program-surface-probe-host";
import {
	buildCanvasQuickActions,
	type CanvasQuickAction,
} from "@/widgets/canvas-shell/model/quick-actions";
import {
	type CanvasPointerContext,
	type HandlerApi,
	type HandlerModule,
	type OverlayModule,
	resolveHandlerModules,
	resolveOverlayModules,
} from "@/widgets/canvas-shell/model/registry";
import {
	applyRepeatTransformWorkflow,
	canApplyRepeatTransformWorkflow,
} from "@/widgets/canvas-shell/model/repeat-transform-workflow";
import {
	describeStaticRasterPlayback,
	sampleStaticRasterPlayback,
} from "@/widgets/canvas-shell/model/static-raster-playback";
import { applyNodeTransform } from "@/widgets/canvas-shell/model/writer";
import {
	ArtboardBackground,
	ArtboardChrome,
	ArtboardNameLabel,
	FrameDraftPreview,
	FramePresetPicker,
} from "./ArtboardChrome";
import { ExternalAssetRuntimePreviewLayer } from "./ExternalAssetRuntimePreviewLayer";
import {
	explicitFrameLookGraphFilterSpec,
	FrameChromaticAberrationDefs,
	FrameFilmGrainDefs,
	FrameLookInfluenceMaskDefs,
} from "./FrameLookDefs";
import { GpuSceneCanvas } from "./GpuSceneCanvas";
import {
	ArtboardGridOverlay,
	GpuArtboardGridLayer,
	WorkspaceGridOverlay,
} from "./GridOverlays";
import { IpadPerfHud } from "./IpadPerfHud";
import {
	beginExternalLayoutMoveDrag,
	collectLayoutFrameOverlayTargets,
	commitExternalLayoutMoveDrag,
	type ExternalLayoutMoveDrag,
	LayoutFrameCanvasOverlay,
	nextExternalLayoutMoveDrag,
	type RequiredLayoutCellSpanPlacement,
	resolveLayoutFrameHostForNode,
	tryRouteLayoutMoveKeyNudge,
} from "./LayoutFrameCanvasOverlay";
import { NoiseGradientToolControls } from "./NoiseGradientToolControls";
import { type PathBlurHintTarget, PathBlurToolHint } from "./PathBlurToolHint";
import { ProgramSurfaceProbeLayer } from "./ProgramSurfaceProbeLayer";
import { ArtboardSelectionChrome, SelectionOverlay } from "./SelectionChrome";
import {
	CanvasMaskDefs,
	DuplicateGhostLayer,
	EffectFilterDefs,
	maskApplicationProps,
	SceneNode,
	type ScopedLookGraphCanvasContext,
	ScopedLookGraphRun,
} from "./SvgSceneNode";

const BillingEntry = lazy(() =>
	import("@/features/billing/ui/BillingEntry").then((m) => ({
		default: m.BillingEntry,
	})),
);

/**
 * Builds the host API handed to feature tool handlers. The selection mutators
 * are the single sanctioned path for a registered handler to write the
 * canonical selection store (features cannot import `features/selection`), so
 * the host stays the only writer of selection and scene state.
 */
function buildHandlerApi(
	selection: HandlerApi["selection"],
	viewport: HandlerApi["viewport"],
	document: SceneDocument = useSceneStore.getState().document,
	options: {
		readonly allowTouchFreehand?: boolean;
		readonly isPerforming?: boolean;
	} = {},
): HandlerApi {
	return {
		apply: applyNodeTransform,
		getDoc: () => document,
		selection,
		viewport,
		select: (nodeId, additive) =>
			useSelectionStore.getState().selectNode(nodeId, additive),
		setSelection: (nodeIds, primary) =>
			useSelectionStore.getState().setSelection(nodeIds, primary),
		clearSelection: () => useSelectionStore.getState().clearSelection(),
		setSubSelection: (sub) => useSelectionStore.getState().setSubSelection(sub),
		selectArtboard: (artboardId) =>
			useSelectionStore.getState().selectArtboard(artboardId),
		selectSceneCamera: (selection) =>
			useSelectionStore.getState().selectSceneCamera(selection),
		setActiveTool: (tool) =>
			useToolSelectionStore.getState().setActiveTool(tool),
		allowTouchFreehand: options.allowTouchFreehand ?? false,
		editTextNode: (nodeId) => {
			const node = findNode(useSceneStore.getState().document, nodeId);
			if (node?.geometry.kind !== "text") return false;
			if (!beginTextEditing(nodeId, "existing")) return false;
			useSelectionStore.getState().selectNode(nodeId, false);
			useToolSelectionStore.getState().setActiveTool("type");
			return true;
		},
		beginGestureTransaction,
		commitGestureTransaction,
		buildDuplicateCommand: (nodeIds, offset) => {
			const plan = buildDuplicateClipboardCommand(document, nodeIds, {
				offset,
			});
			if (!plan.ok) return null;
			return { command: plan.command, newRootNodeIds: plan.newRootNodeIds };
		},
		isPerforming: options.isPerforming ?? false,
		onPerformSample: recordPerformSample,
		onPerformCommit: commitPerformRecording,
	};
}

const overlayModules = import.meta.glob<OverlayModule>(
	"/src/features/*/canvas/overlay.tsx",
	{ eager: true },
);

const handlerModules = import.meta.glob<HandlerModule>(
	"/src/features/*/canvas/handler.ts",
	{ eager: true },
);

// Stable sort: overlays with equal (default 0) paintOrder keep their glob
// order, but an explicit paintOrder always wins over that accident of file
// naming — see OverlayDescriptor.paintOrder.
const overlays = Object.values(overlayModules)
	.flatMap(resolveOverlayModules)
	.toSorted((a, b) => (a.paintOrder ?? 0) - (b.paintOrder ?? 0));

const handlers = Object.values(handlerModules).flatMap(resolveHandlerModules);

const DEEP_SELECT_CYCLE_RADIUS_PX = 6;
/** Minimum on-screen px between artboard pixel-grid lines before they render. */
const ARTBOARD_GRID_PIXEL_MIN_SCREEN_STEP_PX = 12;
// Preview-interactions click-vs-drag distinction: mirrors the select handler's
// own `DRAG_THRESHOLD_PX` (features/transform/canvas/handler.ts) so a small
// pointer jitter between down/up still counts as a "click" trigger.
const INTERACTION_PREVIEW_CLICK_THRESHOLD_PX = 3;

const containsArtboardPoint = (bounds: ArtboardBounds, point: Vec2): boolean =>
	point.x >= bounds.x &&
	point.x <= bounds.x + bounds.width &&
	point.y >= bounds.y &&
	point.y <= bounds.y + bounds.height;

const artboardById = (
	artboards: readonly NormalizedArtboard[],
	artboardId: string,
): NormalizedArtboard | undefined =>
	artboards.find((artboard) => artboard.id === artboardId);

/** Matches the DOM overlay viewport transform used by bounded runtime surfaces. */
const programSurfaceViewportMatrix = (camera: Camera): Matrix2D => {
	const scale = camera.zoom / 100;
	const rotation = camera.rotation ?? 0;
	const cos = Math.cos(rotation);
	const sin = Math.sin(rotation);
	return {
		a: cos * scale,
		b: sin * scale,
		c: -sin * scale,
		d: cos * scale,
		e: camera.panX,
		f: camera.panY,
	};
};

const programSurfaceTranslationMatrix = (x: number, y: number): Matrix2D => ({
	a: 1,
	b: 0,
	c: 0,
	d: 1,
	e: x,
	f: y,
});

const resolveArtboardAtPoint = (
	artboards: readonly NormalizedArtboard[],
	boundsList: readonly ArtboardBounds[],
	point: Vec2,
	preferredArtboardId: string,
): NormalizedArtboard => {
	const fallback = artboardById(artboards, preferredArtboardId) ?? artboards[0];
	if (!fallback) {
		throw new Error("CanvasShell requires at least one normalized artboard.");
	}
	const preferredBounds = boundsList.find(
		(bounds) => bounds.artboardId === preferredArtboardId,
	);
	if (preferredBounds && containsArtboardPoint(preferredBounds, point)) {
		return fallback;
	}

	for (const bounds of [...boundsList].reverse()) {
		if (!containsArtboardPoint(bounds, point)) continue;
		return artboardById(artboards, bounds.artboardId) ?? fallback;
	}

	return fallback;
};

const toArtboardPoint = (point: Vec2, artboard: NormalizedArtboard): Vec2 => ({
	x: point.x - artboard.position.x,
	y: point.y - artboard.position.y,
});

function screenPointToPasteboard(
	rect: Pick<DOMRect, "left" | "top">,
	clientX: number,
	clientY: number,
	camera: Camera,
): Vec2 {
	// The SVG fills the canvas viewport, so its top-left is the camera's screen
	// origin; invert `rotate(world, rotation) * scale + pan` to recover world.
	return screenToWorld(camera, {
		x: clientX - rect.left,
		y: clientY - rect.top,
	});
}

const hitNodeIds = (document: SceneDocument, point: Vec2): readonly string[] =>
	hitTestSceneStack(document, point).map((result) => result.nodeId);

const isRuntime3dModelNode = (
	document: SceneDocument,
	nodeId: string,
): boolean => {
	const node = findNode(document, nodeId);
	if (node?.geometry.kind !== "image") return false;
	const asset = externalSceneAssetForGeometry(document, node.geometry);
	return Boolean(
		asset?.kind === "model-3d" &&
			(asset.format === "glb" || asset.format === "gltf"),
	);
};

const sameNodeIdStack = (
	left: readonly string[],
	right: readonly string[],
): boolean =>
	left.length === right.length &&
	left.every((nodeId, index) => nodeId === right[index]);

const isDeepSelectionModifier = (event: {
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
}): boolean => event.metaKey || event.ctrlKey;

type IpadPencilFeedback =
	| "danger"
	| "delete"
	| "palette-open"
	| "redo"
	| "selection"
	| "success"
	| "undo"
	| "warning";

type IpadQuickMenuTouchHold = {
	readonly pointerId: number;
	readonly startX: number;
	readonly startY: number;
	readonly timerId: number;
};

type IpadHistoryHold = {
	readonly touchCount: 2 | 3;
	readonly timerId: number;
	intervalId: number | null;
};

type IpadPencilHoverPreview = {
	readonly x: number;
	readonly y: number;
	readonly radius: number;
	readonly altitudeAngle: number | null;
	readonly azimuthAngle: number | null;
	readonly rollDegrees: number | null;
};

type CanvasShellProps = {
	readonly onFitArtboard: () => void;
	readonly onFitSelection: (bounds: Bounds) => void;
};

type ViewportPanGesture = {
	readonly pointerId: number;
	readonly source: "hand" | "space";
	lastClientX: number;
	lastClientY: number;
};

type SceneCameraHandleDrag = {
	readonly pointerId: number;
	readonly hit: SceneCameraCanvasHandleHit;
	readonly start: SceneCameraCanvasHandleDragStart;
};

type IpadViewportTouchPoint = {
	readonly pointerId: number;
	clientX: number;
	clientY: number;
};

type IpadViewportGesture = {
	readonly startAngle: number;
	readonly startDistance: number;
	readonly startMidpointX: number;
	readonly startMidpointY: number;
	readonly startPanX: number;
	readonly startPanY: number;
	readonly startWorldX: number;
	readonly startWorldY: number;
	readonly startRotation: number;
	readonly startZoom: number;
	readonly startedAt: number;
	maxTouchCount: number;
	moved: boolean;
};

type IpadViewportTouchMetrics = {
	readonly angle: number;
	readonly distance: number;
	readonly midpointX: number;
	readonly midpointY: number;
};

type IpadViewportRestoreCamera = {
	readonly zoom: number;
	readonly panX: number;
	readonly panY: number;
	readonly rotation: number;
};

const MIN_IPAD_VIEWPORT_PINCH_DISTANCE_PX = 24;
const IPAD_QUICK_PINCH_MAX_MS = 240;
const IPAD_QUICK_PINCH_FIT_RATIO = 0.72;
const IPAD_THREE_FINGER_SWIPE_DOWN_PX = 72;
const IPAD_QUICK_MENU_HOLD_MS = 260;
const IPAD_QUICK_MENU_CANCEL_DISTANCE_PX = 14;
const IPAD_APPEARANCE_PANEL_WIDTH_PX = 288;
const IPAD_APPEARANCE_PANEL_HEIGHT_PX = 520;
const IPAD_MULTI_TOUCH_TAP_MAX_MS = 260;
const IPAD_MULTI_TOUCH_TAP_MOVE_PX = 10;
const IPAD_HISTORY_HOLD_START_MS = 420;
const IPAD_HISTORY_HOLD_REPEAT_MS = 120;
const NATIVE_QUICK_SHAPE_HOLD_SECONDS = 0.34;
const NATIVE_QUICK_SHAPE_HOLD_RADIUS_PX = 5;
const angularDistance = (left: number, right: number): number => {
	const distance = Math.abs(left - right) % (Math.PI * 2);
	return Math.min(distance, Math.PI * 2 - distance);
};

const shouldOpenIpadSqueezePalette = (phase: string): boolean => {
	const normalized = phase.toLowerCase();
	return (
		normalized.includes("ended") ||
		normalized.includes("recognized") ||
		(!normalized.includes("began") &&
			!normalized.includes("changed") &&
			!normalized.includes("cancel"))
	);
};

const finiteOrNull = (value: unknown): number | null =>
	typeof value === "number" && Number.isFinite(value) ? value : null;

const ipadPencilHoverPreviewFromEvent = (
	event: ReactPointerEvent<Element>,
	viewportRect: { readonly left: number; readonly top: number } | null,
): IpadPencilHoverPreview | null => {
	if (event.pointerType !== "pen" || event.buttons !== 0) return null;
	const nativeEvent = event.nativeEvent as PointerEvent & {
		readonly altitudeAngle?: number;
		readonly azimuthAngle?: number;
	};
	const altitudeAngle = finiteOrNull(nativeEvent.altitudeAngle);
	const azimuthAngle = finiteOrNull(nativeEvent.azimuthAngle);
	const tiltMagnitude = Math.min(
		90,
		Math.hypot(nativeEvent.tiltX ?? 0, nativeEvent.tiltY ?? 0),
	);
	const pressure = Math.max(0, Math.min(1, nativeEvent.pressure || 0));
	const radius = Math.round(8 + pressure * 18 + tiltMagnitude * 0.08);
	return {
		x: event.clientX - (viewportRect?.left ?? 0),
		y: event.clientY - (viewportRect?.top ?? 0),
		radius,
		altitudeAngle,
		azimuthAngle,
		rollDegrees: finiteOrNull(nativeEvent.twist),
	};
};

const nativePencilSamplesEndWithQuickShapeHold = (
	samples: readonly NativePencilSample[],
): boolean => {
	const last = samples.at(-1);
	if (!last) return false;
	for (let index = samples.length - 2; index >= 0; index -= 1) {
		const sample = samples[index];
		if (!sample) continue;
		if (last.timestamp - sample.timestamp >= NATIVE_QUICK_SHAPE_HOLD_SECONDS) {
			return true;
		}
		if (
			Math.hypot(last.x - sample.x, last.y - sample.y) >
			NATIVE_QUICK_SHAPE_HOLD_RADIUS_PX
		) {
			return false;
		}
	}
	return false;
};

const pointRelativeToCanvasViewport = (
	point: Pick<ReactPointerEvent<Element>, "clientX" | "clientY">,
	viewport: HTMLElement | null,
): { readonly x: number; readonly y: number } => {
	const rect = viewport?.getBoundingClientRect();
	return {
		x: point.clientX - (rect?.left ?? 0),
		y: point.clientY - (rect?.top ?? 0),
	};
};

const safelyCapturePointer = (element: Element, pointerId: number): void => {
	if (!("setPointerCapture" in element)) return;
	try {
		element.setPointerCapture(pointerId);
	} catch {}
};

const safelyReleasePointer = (element: Element, pointerId: number): void => {
	if (
		!("hasPointerCapture" in element) ||
		!("releasePointerCapture" in element) ||
		!element.hasPointerCapture(pointerId)
	) {
		return;
	}
	try {
		element.releasePointerCapture(pointerId);
	} catch {}
};

const isIpadAuthoringChromeTarget = (target: EventTarget | null): boolean =>
	target instanceof Element &&
	target.closest(
		"button,input,select,textarea,[role='button'],[data-ipad-authoring-chrome='true']",
	) !== null;

const ipadPerfLaneForViewportPan = (
	source: ViewportPanGesture["source"] | undefined,
): IpadPerfLane => (source === "space" ? "space-pan" : "hand-pan");

const ipadPerfLaneForStagePointer = (
	activeTool: ToolId,
	event: Pick<ReactPointerEvent<Element>, "buttons" | "pointerType">,
): IpadPerfLane => {
	if (event.pointerType === "pen" && event.buttons === 0) return "pencil-hover";
	if (event.pointerType === "pen" && activeTool === "pencil") {
		return "pencil-stroke";
	}
	if (
		activeTool === "select" ||
		activeTool === "direct-select" ||
		activeTool === "scale"
	) {
		return "select-transform";
	}
	return "stage-pointer";
};

function ipadViewportTouchMetrics(
	touches: ReadonlyMap<number, IpadViewportTouchPoint>,
	rect: Pick<DOMRect, "left" | "top" | "width" | "height">,
): IpadViewportTouchMetrics | null {
	if (touches.size < 2 || rect.width === 0 || rect.height === 0) return null;
	const [first, second] = Array.from(touches.values()).slice(0, 2);
	if (!first || !second) return null;
	const midpointClientX = (first.clientX + second.clientX) / 2;
	const midpointClientY = (first.clientY + second.clientY) / 2;
	return {
		angle: Math.atan2(
			second.clientY - first.clientY,
			second.clientX - first.clientX,
		),
		distance: Math.hypot(
			first.clientX - second.clientX,
			first.clientY - second.clientY,
		),
		midpointX: midpointClientX - rect.left,
		midpointY: midpointClientY - rect.top,
	};
}

type DeepSelectionCycle = {
	readonly artboardId: string;
	readonly point: Vec2;
	readonly nodeIds: readonly string[];
};

function ContextualQuickActions({
	actions,
	style,
	touchComfortable,
}: {
	readonly actions: readonly CanvasQuickAction[];
	readonly style: CSSProperties;
	readonly touchComfortable: boolean;
}) {
	if (actions.length === 0) return null;
	const surfaceClass = [
		"pointer-events-auto absolute z-30 flex items-center gap-1 rounded-[6px] border border-surface/15 bg-surface-light/95 p-1 shadow-[0_10px_30px_rgba(25,24,23,0.18)] backdrop-blur",
		touchComfortable ? "h-12" : "h-9",
	].join(" ");
	const buttonClass = [
		"flex items-center justify-center rounded-[4px] border border-transparent text-surface transition hover:border-accent/50 hover:bg-accent-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
		touchComfortable ? "h-10 w-10" : "h-7 w-7",
	].join(" ");
	const iconSize = touchComfortable ? 18 : 16;

	return (
		<TooltipProvider>
			<div
				className={surfaceClass}
				onPointerDown={(event) => event.stopPropagation()}
				style={style}
			>
				{actions.map(({ id, label, title, IconComponent, onClick }) => (
					<Tooltip key={id} label={title} side="top">
						<button
							type="button"
							aria-label={label}
							className={buttonClass}
							onClick={(event) => {
								event.stopPropagation();
								onClick();
							}}
						>
							<IconComponent size={iconSize} weight="bold" aria-hidden="true" />
						</button>
					</Tooltip>
				))}
			</div>
		</TooltipProvider>
	);
}

/**
 * Owns the L6 iPad motion transport's live playhead subscription so its
 * per-frame updates stay scoped to this small component instead of forcing
 * `CanvasShell` itself to re-render every rAF tick during playback.
 * `CanvasShell` deliberately freezes its own presentation state while playing
 * (`presentationFrame` only updates via the guarded `useTransportStore.subscribe`
 * above, which bails out whenever `state.isPlaying` is true) so the rAF
 * `PlaybackDriver` overlay (`features/motion/canvas/overlay.tsx`) can patch the
 * DOM directly instead of round-tripping through a full widget re-render —
 * the same reason `subscribePlayback` hands playback ticks to overlay
 * components as a callback rather than lifting them into `CanvasShell`'s own
 * state. Reading `currentFrame` here, not sampled off the frozen
 * `presentationFrame`, keeps the transport's playhead/readout live during
 * playback (matching the desktop `TransportControls` frame field) without
 * reintroducing that per-frame re-render cost onto `CanvasShell`.
 */
function IpadMotionTransportHost({
	totalFrames,
	isPlaying,
	duration,
	reverse,
	onChangeDuration,
	onToggleReverse,
	style,
}: {
	readonly totalFrames: number;
	readonly isPlaying: boolean;
	readonly duration?: number;
	readonly reverse?: boolean;
	readonly onChangeDuration?: (frames: number) => void;
	readonly onToggleReverse?: () => void;
	readonly style: CSSProperties;
}) {
	const currentFrame = useTransportStore((state) => state.currentFrame);
	return (
		<IpadMotionTransport
			currentFrame={currentFrame}
			totalFrames={totalFrames}
			isPlaying={isPlaying}
			duration={duration}
			reverse={reverse}
			onTogglePlay={() => useTransportStore.getState().togglePlay()}
			onScrubToFrame={(frame) => {
				// Pause BEFORE setFrame: the rAF `PlaybackDriver`
				// (`features/motion/canvas/overlay.tsx`) is the sole per-frame
				// writer while playing, so a manual scrub must stop it first or
				// the two would fight over `currentFrame` on the very next frame.
				useTransportStore.getState().pause();
				useTransportStore.getState().setFrame(frame);
			}}
			onChangeDuration={onChangeDuration}
			onToggleReverse={onToggleReverse}
			style={style}
		/>
	);
}

const IPAD_AUTHORING_TOOLS = [
	"pencil",
	"shape",
	"gradient",
	"noise-gradient",
	"select",
	"hand",
] as const satisfies readonly ToolId[];

const IPAD_QUICKBAR_SELECTION_CLEARANCE_PX = 72;

const screenBoundsForPasteboardBounds = (
	bounds: Bounds,
	camera: Camera,
): Bounds => {
	const corners = [
		worldToScreen(camera, { x: bounds.x, y: bounds.y }),
		worldToScreen(camera, { x: bounds.x + bounds.width, y: bounds.y }),
		worldToScreen(camera, { x: bounds.x, y: bounds.y + bounds.height }),
		worldToScreen(camera, {
			x: bounds.x + bounds.width,
			y: bounds.y + bounds.height,
		}),
	];
	const xs = corners.map((corner) => corner.x);
	const ys = corners.map((corner) => corner.y);
	const minX = Math.min(...xs);
	const maxX = Math.max(...xs);
	const minY = Math.min(...ys);
	const maxY = Math.max(...ys);
	return {
		x: minX,
		y: minY,
		width: maxX - minX,
		height: maxY - minY,
	};
};

const ipadQuickbarDockForSelection = ({
	camera,
	selectionBounds,
	viewportSize,
}: {
	readonly camera: Camera;
	readonly selectionBounds: Bounds | null;
	readonly viewportSize: { readonly width: number; readonly height: number };
}): IpadQuickbarDock => {
	if (!selectionBounds || viewportSize.height <= 0) return "bottom";
	const screenBounds = screenBoundsForPasteboardBounds(selectionBounds, camera);
	const topClearance = screenBounds.y;
	const bottomClearance =
		viewportSize.height - (screenBounds.y + screenBounds.height);
	if (
		bottomClearance < IPAD_QUICKBAR_SELECTION_CLEARANCE_PX &&
		topClearance > bottomClearance
	) {
		return "top";
	}
	return "bottom";
};

const ipadCloudStatusForProject = ({
	activeProject,
	failureReason,
	saveStatus,
}: {
	readonly activeProject: ActiveCloudProject | null;
	readonly failureReason: EditorCloudSaveFailureReason | null;
	readonly saveStatus: EditorCloudSaveStatus;
}): IpadCloudStatus => {
	if (!activeProject) {
		return {
			tone: "neutral",
			label: "Local",
			detail: "This document is local. Backup open/share remains available.",
		};
	}
	if (saveStatus === "saving") {
		return {
			tone: "warning",
			label: "Saving",
			detail: `${activeProject.name} is saving to cloud.`,
		};
	}
	if (saveStatus === "dirty") {
		return {
			tone: "warning",
			label: "Unsaved",
			detail: `${activeProject.name} has cloud changes waiting to save.`,
		};
	}
	if (saveStatus === "failed" && failureReason === "project-not-found") {
		return {
			tone: "danger",
			label: "Stale",
			detail: `${activeProject.name} is unavailable; the document is still local.`,
		};
	}
	if (saveStatus === "failed") {
		return {
			tone: "danger",
			label: "Failed",
			detail: `${activeProject.name} could not save to cloud.`,
		};
	}
	if (saveStatus === "conflict") {
		return {
			tone: "danger",
			label: "Conflict",
			detail: `${activeProject.name} has a newer cloud revision.`,
		};
	}
	return {
		tone: "success",
		label: "Saved",
		detail: `${activeProject.name} is saved to cloud revision ${activeProject.revision}.`,
	};
};

export function CanvasShell({
	onFitArtboard,
	onFitSelection,
}: CanvasShellProps) {
	addFrameDiagnosticCount("react.CanvasShell.commit");
	const sceneDocument = useSceneStore((state) => state.document);
	const motionDocument = useMotionStore((state) => state.document);
	const grammarBindings = useMotionGrammarStore(
		(state) => state.document.bindings,
	);
	const isPlaying = useTransportStore((state) => state.isPlaying);
	const interactionPreview = useTransportStore(
		(state) => state.interactionPreview,
	);
	// Subscribed (not just read via `.getState()` inside `buildHandlerApi`) so
	// arming Perform from the quick action forces the memoized `handlerApi`
	// below to rebuild with a fresh `isPerforming` — otherwise a gesture torn
	// down through `latestHandlerApiRef` (tool-switch, pointercancel) would see
	// a stale flag from whatever it was when the memo last recomputed.
	const performing = useTransportStore((state) => state.performing);
	const pendingStrokeIntent = useStrokeIntentStore((state) => state.lastIntent);
	const [presentationFrame, setPresentationFrame] = useState(() => {
		const transport = useTransportStore.getState();
		return resolveCanvasPresentationFrame(transport.currentFrame, transport);
	});
	// A Program Surface approval is intentionally local to an editor binding. A
	// cloud/working-copy rebind therefore clears it before any existing overlay
	// can resolve a probe; no trust decision reaches SceneDocument persistence.
	useEffect(() => {
		const bindApprovalSession = (
			descriptor: ReturnType<typeof getEditorSessionDescriptor>,
		) => {
			programSurfaceLocalApprovalRegistry.bindSession(descriptor);
			programSurfaceRuntimeStatusRegistry.bindSession(descriptor);
		};
		bindApprovalSession(getEditorSessionDescriptor());
		const unsubscribe = subscribeEditorSessionDescriptor(bindApprovalSession);
		return () => {
			unsubscribe();
			programSurfaceLocalApprovalRegistry.clear();
			programSurfaceRuntimeStatusRegistry.clearAll();
		};
	}, []);
	const [liveProgramSurfaceFrameLease, setLiveProgramSurfaceFrameLease] =
		useState<ProgramSurfaceLiveFrameLease | null>(null);
	const handleProgramSurfaceLiveFrameLeaseUpdate = useCallback(
		(update: ProgramSurfaceLiveFrameLeaseUpdate) => {
			setLiveProgramSurfaceFrameLease((current) =>
				applyProgramSurfaceLiveFrameLease(current, update),
			);
		},
		[],
	);
	// Experimental GPU canvas (E1 — see docs/gpu-canvas-convergence-e1-plan.md).
	// Read once per mount, never per-render: toggling the URL/localStorage flag
	// mid-session requires a reload, like other one-shot editor flags.
	const [gpuCanvasEnabled] = useState(isGpuCanvasEnabled);
	// E1 S4 GPU/SVG parity diff mode (D7 verification tooling). Only ever
	// bypasses SVG suppression when the GPU canvas itself is enabled — see
	// `canRenderArtboardNode`'s use below and `isGpuDiffEnabled`'s doc comment.
	const [gpuDiffEnabled] = useState(isGpuDiffEnabled);
	const [iPadPerfCaptureEnabled] = useState(isIpadPerfCaptureEnabled);
	const [iPadPerfCapture, setIpadPerfCapture] =
		useState<IpadPerfCaptureController | null>(null);
	const iPadPerfCaptureRef = useRef<IpadPerfCaptureController | null>(null);
	// Explicit development-only observer for Program Surface host lifecycle QA.
	// The collector has no document or runtime-status write path and is created
	// before a first eligible host mount, so its stable sink never remounts it.
	const [programSurfaceHostTraceDiagnostics] = useState(() =>
		isProgramSurfaceHostTraceDiagnosticsEnabled()
			? createProgramSurfaceHostTraceDiagnostics()
			: null,
	);
	useEffect(() => installPlaybackPerformanceDiagnostics(), []);
	useEffect(() => {
		if (!programSurfaceHostTraceDiagnostics) return;
		return installProgramSurfaceHostTraceDiagnostics(
			programSurfaceHostTraceDiagnostics,
		);
	}, [programSurfaceHostTraceDiagnostics]);
	useEffect(() => {
		if (!iPadPerfCaptureEnabled || typeof window === "undefined") return;
		const controller = createIpadPerfCaptureController();
		iPadPerfCaptureRef.current = controller;
		setIpadPerfCapture(controller);
		return () => {
			controller.dispose();
			if (iPadPerfCaptureRef.current === controller) {
				iPadPerfCaptureRef.current = null;
			}
		};
	}, [iPadPerfCaptureEnabled]);
	// Precomputed summary (see `gpu-grammar-opacity.ts`'s doc comment) of node
	// ids a COMMITTED motion-grammar binding (`grammarBindings`, read above —
	// already the committed source, never sampled evaluator output) drives an
	// opacity-like channel for. Passed into `computeGpuArtboardSupport` so that
	// predicate can fail an artboard closed without importing
	// `entities/motion-grammar` (same-layer rank order forbids it).
	const grammarOpacityNodeIds = useMemo(
		() => nodeIdsWithGrammarDrivenOpacity(grammarBindings),
		[grammarBindings],
	);
	// S2 capability gate: evaluated on the COMMITTED `sceneDocument`/
	// `motionDocument`/`grammarOpacityNodeIds` ONLY — never `presentationDocument`
	// (motion-sampled) or live-drag overrides — per D1's no-flap rule (a
	// transform-only drag or a playback scrub tick must never flip an artboard's
	// render path). Recomputed only when the committed documents actually change
	// identity (an edit), not on every pan/zoom/playback tick.
	const gpuSupport = useMemo(
		() =>
			gpuCanvasEnabled
				? computeGpuArtboardSupport(
						sceneDocument,
						motionDocument,
						grammarOpacityNodeIds,
					)
				: null,
		[gpuCanvasEnabled, sceneDocument, motionDocument, grammarOpacityNodeIds],
	);
	const activeArtboardIds = useMemo(() => {
		const ids = new Set<string>();
		if (!gpuSupport) return ids;
		for (const [artboardId, support] of gpuSupport) {
			if (support.supported) ids.add(artboardId);
		}
		return ids;
	}, [gpuSupport]);
	const activeGpuArtboardCount = activeArtboardIds.size;
	useEffect(() => {
		if (!import.meta.env.DEV || !gpuSupport) return;
		const unsupported = [...gpuSupport].filter(
			([, support]) => !support.supported,
		);
		if (unsupported.length === 0) {
			if (gpuSupport.size > 0) {
				console.info(
					`[gpu-canvas] All ${gpuSupport.size} artboard(s) are GPU-active.`,
				);
			}
			return;
		}
		console.info(
			"[gpu-canvas] Artboard capability:",
			Object.fromEntries(
				unsupported.map(([artboardId, support]) => [
					artboardId,
					support.reasons,
				]),
			),
		);
	}, [gpuSupport]);
	useEffect(() => {
		if (!import.meta.env.DEV) return;
		return registerCanvasCacheDiagnosticsGlobal();
	}, []);
	useEffect(() => {
		const warm = () => {
			if (document.visibilityState === "hidden") return;
			getCanvasPersistentCacheClient().warmSceneDerivedArtifacts({
				scene: sceneDocument,
				activeArtboardIds,
				reason: "document-edit",
			});
		};
		warm();
		document.addEventListener("visibilitychange", warm);
		return () => document.removeEventListener("visibilitychange", warm);
	}, [sceneDocument, activeArtboardIds]);
	const [temporaryPanActive, setTemporaryPanActive] = useState(false);
	// ⌘/Ctrl held → temporary select cursor (state drives the cursor re-render).
	const [temporarySelectActive, setTemporarySelectActive] = useState(false);
	const [viewportPanDragging, setViewportPanDragging] = useState(false);
	useEffect(() => {
		getCanvasPersistentCacheClient().setInteractionActive(
			viewportPanDragging || isPlaying,
		);
	}, [viewportPanDragging, isPlaying]);
	const activeTool = useToolSelectionStore((state) => state.activeTool);
	const shapeKind = useDrawStore((state) => state.shapeKind);
	const setShapeKind = useDrawStore((state) => state.setShapeKind);
	// Gates the Conversion HUD off while a freehand stroke is still being
	// drawn, so the cluster from the PREVIOUS stroke's intent never floats on
	// top of an in-progress new one.
	const isDraftingFreehandStroke = useDrawStore(
		(state) => state.freehandPoints.length > 0,
	);
	const sceneCanUndo = useSceneStore((state) => state.canUndo);
	const sceneCanRedo = useSceneStore((state) => state.canRedo);
	const motionCanUndo = useMotionStore((state) => state.canUndo);
	const motionCanRedo = useMotionStore((state) => state.canRedo);
	const grammarCanUndo = useMotionGrammarStore((state) => state.canUndo);
	const grammarCanRedo = useMotionGrammarStore((state) => state.canRedo);
	const timelineOpen = useEditorChromeStore((state) => state.timelineOpen);
	const activeCloudProject = useEditorCloudProjectStore(
		(state) => state.activeProject,
	);
	const cloudSaveStatus = useEditorCloudProjectStore(
		(state) => state.saveStatus,
	);
	const cloudSaveFailureReason = useEditorCloudProjectStore(
		(state) => state.saveFailureReason,
	);
	const selectedNodeIds = useSelectionStore((state) => state.nodeIds);
	const primarySelection = useSelectionStore((state) => state.primary);
	const subSelection = useSelectionStore((state) => state.sub);
	const sceneCameraSelection = useSelectionStore((state) => state.sceneCamera);
	const repeatTransformPlan = useRepeatTransformStore((state) => state.plan);
	const selectedArtboardId = useSelectionStore(
		(state) => state.selectedArtboardId,
	);
	const selectNode = useSelectionStore((state) => state.selectNode);
	const setSelection = useSelectionStore((state) => state.setSelection);
	const clearSelection = useSelectionStore((state) => state.clearSelection);
	const selectArtboard = useSelectionStore((state) => state.selectArtboard);
	const zoom = useViewportStore((state) => state.zoom);
	const panX = useViewportStore((state) => state.panX);
	const panY = useViewportStore((state) => state.panY);
	const rotation = useViewportStore((state) => state.rotation);
	const workspaceGridVisible = useGuideStore(
		(state) => state.view.workspaceGridVisible,
	);
	const gridVisible = useGuideStore((state) => state.view.gridVisible);
	const pixelGridVisible = useGuideStore(
		(state) => state.view.pixelGridVisible,
	);
	const selection = useMemo(
		() => ({
			nodeIds: selectedNodeIds,
			primary: primarySelection,
			sub: subSelection,
			sceneCamera: sceneCameraSelection,
			selectedArtboardId,
		}),
		[
			selectedNodeIds,
			primarySelection,
			subSelection,
			sceneCameraSelection,
			selectedArtboardId,
		],
	);
	const viewport = useMemo(
		() => ({
			zoom,
			panX,
			panY,
			rotation,
		}),
		[zoom, panX, panY, rotation],
	);
	const iPadAuthoringSurface = useIpadAuthoringSurface();
	const [iPadNativeStatus, setIpadNativeStatus] = useState<IpadNativeStatus>({
		hostReady: false,
		capabilityProbe: null,
		squeezeSeen: false,
	});
	const [iPadQuickbarNotice, setIpadQuickbarNotice] =
		useState<IpadQuickbarNotice | null>(null);
	const [iPadQuickMenu, setIpadQuickMenu] = useState<IpadQuickMenuState | null>(
		null,
	);
	const [iPadAppearanceOpen, setIpadAppearanceOpen] = useState(false);
	const [iPadPencilHoverPreview, setIpadPencilHoverPreview] =
		useState<IpadPencilHoverPreview | null>(null);
	const [iPadFocusMode, setIpadFocusMode] = useState(false);
	const canUndo = sceneCanUndo || motionCanUndo || grammarCanUndo;
	const canRedo = sceneCanRedo || motionCanRedo || grammarCanRedo;
	const scale = viewport.zoom / 100;
	const activeHandler = handlers.find((handler) => handler.tool === activeTool);
	const allowTouchFreehand =
		iPadAuthoringSurface.visible && !iPadAuthoringSurface.bridgeAvailable;
	// Illustrator-style spring-loaded selection: while ⌘/Ctrl is held, pointer
	// events route to the select (transform) handler regardless of the active tool,
	// then revert on release. The handler is self-contained per-event (no onActivate
	// dependency), so driving it without activation is safe.
	const selectHandler = handlers.find((handler) => handler.tool === "select");
	const layoutInteractionDocument = useMemo(
		() => materializeLayoutFramesForPresentation(sceneDocument),
		[sceneDocument],
	);
	const handlerApi = useMemo(
		() =>
			buildHandlerApi(selection, viewport, layoutInteractionDocument, {
				allowTouchFreehand,
				isPerforming: performing,
			}),
		[
			selection,
			viewport,
			layoutInteractionDocument,
			allowTouchFreehand,
			performing,
		],
	);
	const sampleCanvasDocumentAtFrame = useCallback(
		(frame: number) =>
			samplePresentation(sceneDocument, motionDocument, frame, grammarBindings),
		[sceneDocument, motionDocument, grammarBindings],
	);
	const sampledPresentationDocument = useMemo(
		() => sampleCanvasDocumentAtFrame(presentationFrame),
		[sampleCanvasDocumentAtFrame, presentationFrame],
	);
	const [mediaFrame, setMediaFrame] = useState(
		() => useTransportStore.getState().currentFrame,
	);
	useEffect(
		() =>
			useTransportStore.subscribe((state, previous) => {
				if (state.currentFrame === previous.currentFrame) return;
				if (!sceneHasVideoMedia(useSceneStore.getState().document)) return;
				setMediaFrame(state.currentFrame);
			}),
		[],
	);
	const videoPresentationFrame = isPlaying ? mediaFrame : presentationFrame;
	const [videoPresentation, setVideoPresentation] = useState<{
		readonly source: SceneDocument;
		readonly frame: number;
		readonly document: SceneDocument;
	}>(() => ({
		source: sampledPresentationDocument,
		frame: videoPresentationFrame,
		document: sampledPresentationDocument,
	}));
	useEffect(() => {
		let cancelled = false;
		const timeSeconds =
			videoPresentationFrame / Math.max(1, motionDocument.fps);
		void materializeVideoAssetFrames(
			sampledPresentationDocument,
			timeSeconds,
		).then((document) => {
			if (cancelled) return;
			setVideoPresentation({
				source: sampledPresentationDocument,
				frame: videoPresentationFrame,
				document,
			});
		});
		return () => {
			cancelled = true;
		};
	}, [sampledPresentationDocument, videoPresentationFrame, motionDocument.fps]);
	const presentationDocument =
		videoPresentation.source === sampledPresentationDocument &&
		videoPresentation.frame === videoPresentationFrame
			? videoPresentation.document
			: sampledPresentationDocument;
	const sceneCurrentArtboard = useMemo(
		() => selectCurrentArtboard(sceneDocument),
		[sceneDocument],
	);
	const presentationArtboards = useMemo(
		() => selectAllArtboards(presentationDocument),
		[presentationDocument],
	);
	const explicitFrameLookGraphFilterSpecs = useMemo(() => {
		const specs = new Map<string, EffectFilterSpec>();
		presentationArtboards.forEach((artboard, artboardIndex) => {
			const spec = explicitFrameLookGraphFilterSpec(
				presentationDocument,
				artboard,
				artboardIndex,
			);
			if (spec) specs.set(artboard.id, spec);
		});
		return specs;
	}, [presentationDocument, presentationArtboards]);
	const presentationCurrentArtboard = useMemo(
		() => selectCurrentArtboard(presentationDocument),
		[presentationDocument],
	);
	const presentationNodeArtboards = useMemo(
		() => selectNodeArtboardMapping(presentationDocument),
		[presentationDocument],
	);
	// Native/imported mask relations resolved once per (sampled) render — never
	// per node — so consumed mask sources are dropped and masked content gets a
	// clip/mask wrapper, matching the SVG exporter. Stable during playback because
	// `presentationDocument` is frozen there (the rAF overlay patches the DOM).
	const maskPlan = useMemo(
		() => resolveSceneMaskPlan(presentationDocument),
		[presentationDocument],
	);
	const selectedOverlayArtboard = selectedArtboardId
		? artboardById(presentationArtboards, selectedArtboardId)
		: undefined;
	const overlayArtboard =
		(primarySelection
			? artboardById(
					presentationArtboards,
					presentationNodeArtboards.byNodeId[primarySelection] ?? "",
				)
			: selectedOverlayArtboard) ?? presentationCurrentArtboard;
	const overlayDocument = useMemo(
		() =>
			documentForArtboard(
				presentationDocument,
				overlayArtboard,
				presentationNodeArtboards.byNodeId,
			),
		[presentationDocument, overlayArtboard, presentationNodeArtboards],
	);
	const staticRasterPlayback = useMemo(
		() =>
			describeStaticRasterPlayback({
				grammarBindingCount: grammarBindings.length,
				hasVideoMedia: sceneHasVideoMedia(sceneDocument),
				motion: motionDocument,
				scene: sceneDocument,
			}),
		[sceneDocument, motionDocument, grammarBindings.length],
	);
	// Serializes the current (already motion-sampled) overlay artboard to a
	// standalone SVG string for overlays that need the rasterized frame as a
	// texture (the GPU lens). `initialMotionDocument` has no tracks, so the
	// already-sampled `overlayDocument` is rendered as-is (no double-sampling).
	// The export serializer is dynamically imported so it only loads on demand.
	const renderArtboardSvg = useCallback(async (): Promise<string> => {
		const { renderSceneSvg } = await import("@/features/export/model/svg");
		return renderSceneSvg({
			scene: overlayDocument,
			motion: initialMotionDocument,
			frame: 0,
			deferGpuRasterEffects: true,
		});
	}, [overlayDocument]);
	const getStaticRasterPlaybackPlan = useCallback(async () => {
		if (!staticRasterPlayback) return null;
		const { renderIsolatedNodeSetSvg: renderNodeSetImpl } = await import(
			"@/features/export/model/svg"
		);
		const layers = [];
		for (const { bounds, node } of staticRasterPlayback.nodes) {
			const emissionSvg = renderNodeSetImpl({
				bounds,
				excludedScopedLookId: staticRasterPlayback.excludedScopedLookId,
				frame: 0,
				motion: initialMotionDocument,
				nodeIds: [node.id],
				scene: sceneDocument,
			});
			if (!emissionSvg) return null;
			const svg = staticRasterPlayback.sourceOpticsSourceNodeIds.has(node.id)
				? renderNodeSetImpl({
						bounds,
						excludedScopedLookId: staticRasterPlayback.excludedScopedLookId,
						frame: 0,
						includeSourceOpticsSourceOwners: true,
						motion: initialMotionDocument,
						nodeIds: [node.id],
						scene: sceneDocument,
					})
				: emissionSvg;
			if (!svg) return null;
			layers.push({
				bounds,
				...(svg !== emissionSvg ? { emissionSvg } : {}),
				emitsGlow: true,
				nodeId: node.id,
				restMatrix: matrixFromTransform(node.transform),
				svg,
			});
		}
		return {
			artboardHeight: sceneDocument.artboard.height,
			artboardWidth: sceneDocument.artboard.width,
			background: staticRasterPlayback.background,
			glow: staticRasterPlayback.glow,
			layers,
		};
	}, [sceneDocument, staticRasterPlayback]);
	const getStaticRasterPlaybackFrame = useCallback(
		(frame: number) =>
			staticRasterPlayback
				? sampleStaticRasterPlayback(
						staticRasterPlayback,
						motionDocument,
						frame,
					)
				: null,
		[motionDocument, staticRasterPlayback],
	);
	// Playback bridge for GPU overlays: during playback the presentation document is
	// frozen, so a GPU overlay follows the transport directly. `subscribePlayback`
	// lets a feature overlay read the transport without importing its store
	// (feature-to-feature ban); `getRasterFrame` samples + serializes the overlay
	// artboard at an arbitrary frame so the overlay can re-render per playback tick.
	const overlayArtboardId = overlayArtboard.id;
	const subscribePlayback = useCallback(
		(cb: (frame: number, playing: boolean) => void) => {
			const current = useTransportStore.getState();
			cb(current.currentFrame, current.isPlaying);
			return useTransportStore.subscribe((state, previous) => {
				if (
					state.currentFrame !== previous.currentFrame ||
					state.isPlaying !== previous.isPlaying
				) {
					cb(state.currentFrame, state.isPlaying);
				}
			});
		},
		[],
	);
	// ProgramSurfaceProbeLayer is a transport reader. This is deliberately the
	// same canonical sampler CanvasShell uses for presentation, rather than an
	// iframe-owned timeline or a second derived-motion model.
	const resolveProgramSurfaceProbeFrame = useCallback(
		(nodeId: string, frame: number) => {
			if (!Number.isInteger(frame) || frame < 0) return null;
			const sampled = sampleCanvasDocumentAtFrame(frame);
			const node = findNode(sampled, nodeId);
			if (!node?.visible || node.geometry.kind !== "image") {
				return null;
			}
			const bounds = node.geometry.bounds;
			if (
				!Number.isFinite(bounds.width) ||
				!Number.isFinite(bounds.height) ||
				bounds.width <= 0 ||
				bounds.height <= 0 ||
				!Number.isFinite(node.style.opacity) ||
				node.style.opacity < 0 ||
				node.style.opacity > 1
			) {
				return null;
			}
			const sampledNodeArtboards = selectNodeArtboardMapping(sampled);
			const artboardId = sampledNodeArtboards.byNodeId[node.id];
			const artboard = artboardId
				? artboardById(selectAllArtboards(sampled), artboardId)
				: undefined;
			if (!artboard) return null;
			const matrix = composeMatrix(
				programSurfaceViewportMatrix(viewport),
				composeMatrix(
					programSurfaceTranslationMatrix(
						artboard.position.x,
						artboard.position.y,
					),
					composeMatrix(
						matrixFromTransform(node.transform),
						programSurfaceTranslationMatrix(bounds.x, bounds.y),
					),
				),
			);
			return {
				frame,
				fps: motionDocument.fps,
				placement: {
					nodeId: node.id,
					artboardId: artboard.id,
					matrix,
					cssWidth: bounds.width,
					cssHeight: bounds.height,
					opacity: node.style.opacity,
				},
			};
		},
		[motionDocument.fps, sampleCanvasDocumentAtFrame, viewport],
	);
	const getRasterFrame = useCallback(
		async (frame: number) => {
			const finishFrame = beginFramePhase("raster.framePreparation");
			const finishSampling = beginFramePhase("raster.samplePresentation");
			const presentationAtFrame = sampleCanvasDocumentAtFrame(frame);
			finishSampling();
			const timeSeconds = frame / Math.max(1, motionDocument.fps);
			const finishMedia = beginFramePhase("raster.materializeMedia");
			const mediaPresentationAtFrame = await materializeVideoAssetFrames(
				presentationAtFrame,
				timeSeconds,
			);
			finishMedia();
			const artboardsAtFrame = selectAllArtboards(mediaPresentationAtFrame);
			const artboardAtFrame =
				artboardById(artboardsAtFrame, overlayArtboardId) ??
				selectCurrentArtboard(mediaPresentationAtFrame);
			const scoped = documentForArtboard(
				mediaPresentationAtFrame,
				artboardAtFrame,
				selectNodeArtboardMapping(mediaPresentationAtFrame).byNodeId,
			);
			const { renderSceneSvg } = await import("@/features/export/model/svg");
			const finishSerialization = beginFramePhase("raster.serializeBaseSvg");
			const svg = renderSceneSvg({
				scene: scoped,
				motion: initialMotionDocument,
				frame: 0,
				deferGpuRasterEffects: true,
			});
			finishSerialization();
			setFrameDiagnosticGauge("raster.baseSvgBytes", svg.length);
			setFrameDiagnosticGauge("raster.requestedFrame", frame);
			finishFrame();
			return {
				svg,
				document: scoped,
				timeSeconds,
			};
		},
		[motionDocument.fps, overlayArtboardId, sampleCanvasDocumentAtFrame],
	);
	// Isolated single-node crop SVG for the per-object GPU Path Blur compositor
	// (see `renderIsolatedNodeSvg` in `features/export/model/svg`). Renders off
	// `sampledScene` when a playback-follow caller passes the document it already
	// got from `getRasterFrame` (no second motion sample); otherwise off the
	// current scrub-position `overlayDocument`, mirroring `renderArtboardSvg`.
	const renderIsolatedNodeSvg = useCallback(
		async (
			nodeId: string,
			bounds: Bounds,
			sampledScene?: SceneDocument,
			rasterSafe = false,
		): Promise<string | null> => {
			const { renderIsolatedNodeSvg: renderIsolatedNodeSvgImpl } = await import(
				"@/features/export/model/svg"
			);
			return renderIsolatedNodeSvgImpl({
				scene: sampledScene ?? overlayDocument,
				motion: initialMotionDocument,
				frame: 0,
				nodeId,
				bounds,
				rasterSafe,
			});
		},
		[overlayDocument],
	);
	const renderIsolatedNodeSetSvg = useCallback(
		async (
			nodeIds: readonly string[],
			excludedScopedLookId: string,
			sampledScene?: SceneDocument,
		): Promise<string | null> => {
			const { renderIsolatedNodeSetSvg: renderNodeSetImpl } = await import(
				"@/features/export/model/svg"
			);
			const finishSerialization = beginFramePhase(
				"raster.serializeEmissionSvg",
			);
			const svg = renderNodeSetImpl({
				scene: sampledScene ?? overlayDocument,
				motion: initialMotionDocument,
				frame: 0,
				nodeIds,
				excludedScopedLookId,
			});
			finishSerialization();
			setFrameDiagnosticGauge("raster.emissionSvgBytes", svg?.length ?? 0);
			return svg;
		},
		[overlayDocument],
	);
	const canvasViewportRef = useRef<HTMLDivElement | null>(null);
	const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
	// Cached wrapper screen box for the native wheel listener. It stays fresh via
	// resize/scroll measurement so the hot path can anchor zoom without layout.
	const viewportRectRef = useRef({ left: 0, top: 0, width: 0, height: 0 });
	// The camera is the absolute screen<->world transform:
	// `screen = rotate(world, rotation) * scale + pan`, independent of the
	// artboard set. The world group, overlays, hit testing, guides, and the grid
	// all read it, so there is one source of camera truth instead of the old
	// union-centred stage projection.
	const camera: Camera = viewport;
	const projection = useMemo(
		() => ({ zoom: scale, pan: { x: viewport.panX, y: viewport.panY } }),
		[scale, viewport.panX, viewport.panY],
	);
	// The desk grid is the SAME grid as the artboard's on-card grid: BASE spacing +
	// 64px major, phased to the active artboard's origin so the two are one seamless
	// full-screen lattice (and identical to the snap candidates). Gated by the single
	// `gridVisible` flag so visible == snap can never drift from the toggle.
	const workspaceGridLines = useMemo(
		() =>
			collectWorkspaceGridLines(
				projection,
				{ width: viewportSize.width, height: viewportSize.height },
				{
					layout: { visible: gridVisible },
					pixel: { visible: false },
					offset: {
						x: sceneCurrentArtboard.position.x,
						y: sceneCurrentArtboard.position.y,
					},
				},
			),
		[
			projection,
			viewportSize.width,
			viewportSize.height,
			gridVisible,
			sceneCurrentArtboard.position.x,
			sceneCurrentArtboard.position.y,
		],
	);
	const artboardGridProjection = useMemo(
		() => ({ zoom: scale, pan: { x: 0, y: 0 } }),
		[scale],
	);
	const artboardGridLinesById = useMemo(
		() =>
			new Map(
				presentationArtboards.map((artboard) => [
					artboard.id,
					collectArtboardGridLines(artboard, artboardGridProjection, {
						layout: { visible: gridVisible },
						pixel: {
							visible: pixelGridVisible,
							minScreenStepPx: ARTBOARD_GRID_PIXEL_MIN_SCREEN_STEP_PX,
						},
					}),
				]),
			),
		[
			artboardGridProjection,
			gridVisible,
			pixelGridVisible,
			presentationArtboards,
		],
	);
	// Count renderable nodes from the SCENE doc (stable across playback frames, so
	// the threshold check does not recompute every animation frame).
	const renderableNodeCount = useMemo(
		() =>
			sceneDocument.layers.reduce(
				(total, layer) => (layer.visible ? total + layer.nodes.length : total),
				0,
			),
		[sceneDocument],
	);
	const sceneLayerCount = sceneDocument.layers.length;
	useEffect(() => {
		iPadPerfCaptureRef.current?.setMetadata({
			activeGpuArtboards: activeGpuArtboardCount,
			activeTool,
			iPadShellVisible: iPadAuthoringSurface.visible,
			layerCount: sceneLayerCount,
			renderPath: gpuCanvasEnabled
				? gpuDiffEnabled
					? "gpu-diff"
					: "gpu"
				: "svg",
			topLevelNodeCount: renderableNodeCount,
			viewportHeight: viewportSize.height,
			viewportWidth: viewportSize.width,
			zoomPercent: zoom,
		});
	}, [
		activeGpuArtboardCount,
		activeTool,
		gpuCanvasEnabled,
		gpuDiffEnabled,
		iPadAuthoringSurface.visible,
		renderableNodeCount,
		sceneLayerCount,
		viewportSize.height,
		viewportSize.width,
		zoom,
	]);
	// The EXACT (unquantized) visible pasteboard rect from the raw camera, or null
	// below CULL_NODE_THRESHOLD (render every node). Cheap arithmetic; recomputed
	// directly in render, no memo needed — quantizeCullingRect below is what keeps
	// the culling rect referentially stable across small camera changes.
	const trueCullRect =
		renderableNodeCount > CULL_NODE_THRESHOLD
			? visiblePasteboardRect({
					scale: projection.zoom,
					panX: projection.pan.x,
					panY: projection.pan.y,
					rotation: viewport.rotation,
					viewportWidth: viewportSize.width,
					viewportHeight: viewportSize.height,
				})
			: null;
	// Snapped OUTWARD to a quantized grid (see quantizeCullingRect) so the culling
	// rect is always a superset of `trueCullRect` — it can only over-cover, never
	// cull a node that is genuinely visible. Destructured into primitives before the
	// memo below so a pan/zoom that doesn't cross a grid line leaves every dependency
	// (and thus `cullVisibleRect`'s identity) unchanged.
	const snappedCullRect = trueCullRect
		? quantizeCullingRect(trueCullRect)
		: null;
	const snappedCullMinX = snappedCullRect?.minX;
	const snappedCullMinY = snappedCullRect?.minY;
	const snappedCullMaxX = snappedCullRect?.maxX;
	const snappedCullMaxY = snappedCullRect?.maxY;
	// The visible pasteboard rect for culling, or null to render every node.
	// Per-node filtering stays inline so presentation nodes use their sampled
	// transform, while playback keeps animated nodes mounted for the rAF overlay.
	const cullVisibleRect = useMemo(
		() =>
			snappedCullMinX !== undefined &&
			snappedCullMinY !== undefined &&
			snappedCullMaxX !== undefined &&
			snappedCullMaxY !== undefined
				? {
						minX: snappedCullMinX,
						minY: snappedCullMinY,
						maxX: snappedCullMaxX,
						maxY: snappedCullMaxY,
					}
				: null,
		[snappedCullMinX, snappedCullMinY, snappedCullMaxX, snappedCullMaxY],
	);
	const forceMountedNodeIds = useMemo(
		() => (isPlaying ? new Set(animatedNodeIds(motionDocument)) : undefined),
		[isPlaying, motionDocument],
	);
	const nodeCullingOptions = useMemo(
		() => (forceMountedNodeIds ? { forceMountedNodeIds } : undefined),
		[forceMountedNodeIds],
	);
	useLayoutEffect(() => {
		const element = canvasViewportRef.current;
		if (!element) return;
		const measure = () => {
			const rect = element.getBoundingClientRect();
			// Cache the wrapper's screen box so the wheel hot path can derive the
			// cursor anchor (clientX - left) without a per-event layout read.
			viewportRectRef.current = {
				left: rect.left,
				top: rect.top,
				width: rect.width,
				height: rect.height,
			};
			setViewportSize((previous) =>
				previous.width === rect.width && previous.height === rect.height
					? previous
					: { width: rect.width, height: rect.height },
			);
			// Mirror into the viewport store so centred keyboard/button zoom can
			// anchor on the viewport centre without re-measuring in each caller.
			useViewportStore.getState().setViewportSize(rect.width, rect.height);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		// ResizeObserver fires on size, not position; a panel/scroll reflow can
		// move the wrapper without resizing it, so refresh the cached origin too.
		window.addEventListener("scroll", measure, { passive: true });
		window.addEventListener("resize", measure);
		return () => {
			observer.disconnect();
			window.removeEventListener("scroll", measure);
			window.removeEventListener("resize", measure);
		};
	}, []);

	// Wheel navigation on the full-bleed wrapper, Figma-style: pinch and ⌘-scroll
	// zoom (cursor-anchored, continuous); plain two-finger scroll pans. React's
	// synthetic `onWheel` is passive, so a native non-passive listener is required
	// to preventDefault the browser's page-zoom AND the back/forward swipe a
	// horizontal two-finger scroll would otherwise trigger. The handler reads only
	// refs and the store (no React-state staleness) and does zero layout reads, so
	// it stays cheap at the ~120Hz a trackpad fires.
	useEffect(() => {
		const element = canvasViewportRef.current;
		if (!element) return;
		const onWheel = (event: WheelEvent) => {
			event.preventDefault();
			iPadPerfCaptureRef.current?.recordPointer("wheel");
			const rect = viewportRectRef.current;
			if (rect.width === 0 || rect.height === 0) return;
			// ctrlKey = trackpad pinch; metaKey = ⌘-scroll. Both zoom (cursor-
			// anchored); every other wheel is a pan.
			if (event.ctrlKey || event.metaKey) {
				const factor = wheelDeltaToFactor(
					event.deltaY,
					event.deltaMode,
					event.ctrlKey,
				);
				if (factor === 1) return;
				const store = useViewportStore.getState();
				iPadPerfCaptureRef.current?.recordViewportWrite("wheel");
				store.zoomToAt(
					store.zoom * factor,
					event.clientX - rect.left,
					event.clientY - rect.top,
				);
				return;
			}
			const pan = wheelDeltaToPan(event.deltaX, event.deltaY, event.deltaMode);
			if (pan.dx === 0 && pan.dy === 0) return;
			iPadPerfCaptureRef.current?.recordViewportWrite("wheel");
			useViewportStore.getState().panBy(pan.dx, pan.dy);
		};
		element.addEventListener("wheel", onWheel, { passive: false });
		return () => element.removeEventListener("wheel", onWheel);
	}, []);
	const overlayArtboardScreen = worldToScreen(camera, overlayArtboard.position);
	const overlayStyle = {
		height: overlayArtboard.height * scale,
		left: overlayArtboardScreen.x,
		top: overlayArtboardScreen.y,
		transform: `rotate(${rotationDegrees(viewport.rotation)}deg)`,
		transformOrigin: "0 0",
		width: overlayArtboard.width * scale,
	} satisfies CSSProperties;
	const pointerArtboardIdRef = useRef<string | null>(null);
	const activePointerIdRef = useRef<number | null>(null);
	const runtime3dPickerRef = useRef<
		BabylonRuntimeSurface["pickNodeAtClientPoint"] | null
	>(null);
	const [runtime3dVectorPlaneNodeIds, setRuntime3dVectorPlaneNodeIds] =
		useState<ReadonlySet<string>>(() => new Set());
	const handleRuntime3dPickerChange = useCallback(
		(picker: BabylonRuntimeSurface["pickNodeAtClientPoint"] | null) => {
			runtime3dPickerRef.current = picker;
		},
		[],
	);
	const handleRuntime3dVectorPlaneConsumptionChange = useCallback(
		(nodeIds: readonly string[]) => {
			const next = new Set(nodeIds);
			setRuntime3dVectorPlaneNodeIds((current) => {
				if (
					current.size === next.size &&
					[...current].every((nodeId) => next.has(nodeId))
				) {
					return current;
				}
				return next;
			});
		},
		[],
	);
	const stageSvgRef = useRef<SVGSVGElement | null>(null);
	const cameraWorldGroupRef = useRef<SVGGElement | null>(null);
	// Caches the stage SVG's getBoundingClientRect() for the lifetime of a
	// pointer gesture so pointermove never forces layout: onPointerDown seeds it,
	// pointerContextFor reuses it while the pointerId matches, and every gesture
	// exit (pointerup, pointercancel, lost capture, tool switch) clears it so the
	// next hover (no button down) falls back to a direct, fresh read.
	const stageRectRef = useRef<{
		readonly pointerId: number;
		readonly rect: DOMRect;
	} | null>(null);
	const nativePencilSessionsRef = useRef<ReturnType<
		typeof createNativePencilStrokeSessionStore
	> | null>(null);
	const nativePencilFinalizeTimersRef = useRef(new Map<string, number>());
	const nativeCapabilityProbeRequestedRef = useRef(false);
	const iPadQuickbarNoticeTimerRef = useRef<number | null>(null);
	const iPadQuickMenuTouchHoldRef = useRef<IpadQuickMenuTouchHold | null>(null);
	const iPadQuickPinchRestoreRef = useRef<IpadViewportRestoreCamera | null>(
		null,
	);
	const iPadHistoryHoldRef = useRef<IpadHistoryHold | null>(null);
	if (!nativePencilSessionsRef.current) {
		nativePencilSessionsRef.current = createNativePencilStrokeSessionStore();
	}
	const layoutInteractionCacheRef = useRef<{
		readonly source: SceneDocument;
		readonly document: SceneDocument;
	}>({
		source: sceneDocument,
		document: layoutInteractionDocument,
	});
	const latestHandlerApiRef = useRef(handlerApi);
	const activeHandlerRef = useRef(activeHandler);
	const previousToolRef = useRef(activeTool);
	const previousHandlerRef = useRef(activeHandler);
	const spaceHeldRef = useRef(false);
	// Tap-vs-hold bookkeeping for Space: whether a pan pointer-down consumed this
	// hold, which disqualifies the release as a play/pause tap.
	const spacePanUsedRef = useRef(false);
	const viewportPanGestureRef = useRef<ViewportPanGesture | null>(null);
	const viewportPanRafRef = useRef<number | null>(null);
	const viewportPanPendingDeltaRef = useRef({ dx: 0, dy: 0 });
	const iPadPendingCameraCommitRef = useRef<Camera | null>(null);
	const iPadPencilHoverRafRef = useRef<number | null>(null);
	const iPadPencilHoverPendingRef = useRef<IpadPencilHoverPreview | null>(null);
	const iPadViewportTouchPointersRef = useRef(
		new Map<number, IpadViewportTouchPoint>(),
	);
	const iPadViewportGestureRef = useRef<IpadViewportGesture | null>(null);
	const iPadViewportGestureRafRef = useRef<number | null>(null);
	// Live ⌘/Ctrl-held flag read synchronously by pointer handlers (state would lag).
	const cmdSelectHeldRef = useRef(false);
	// The handler that owns the in-flight pointer gesture, latched on pointer-down so
	// releasing ⌘ mid-drag never swaps handlers mid-gesture.
	const pointerGestureHandlerRef = useRef<typeof activeHandler>(undefined);
	const sceneCameraHandleDragRef = useRef<SceneCameraHandleDrag | null>(null);
	const sceneCameraHandleHitContextRef = useRef<{
		readonly document: SceneDocument;
		readonly artboardId?: string;
		readonly sceneCameraSelection: unknown;
		readonly zoom: number;
		readonly context: SceneCameraCanvasHandleHitContext | null;
	} | null>(null);
	const [sceneCameraHandleHud, setSceneCameraHandleHud] = useState<
		string | null
	>(null);
	useEffect(() => {
		if (activeTool === "select" || activeTool === "direct-select") return;
		sceneCameraHandleHitContextRef.current = null;
		setSceneCameraHandleHud(null);
	}, [activeTool]);
	// A fresh select-tool drag that starts on a layout-managed child the overlay
	// does not already capture (see resolveLayoutFrameHostForNode) is routed here
	// instead of the ordinary gesture handler, so it performs the same
	// cell-placement drag the overlay's selected-cell body offers. The ref drives
	// the drag math per pointermove (no re-render needed for that); the paired
	// state re-renders so LayoutFrameCanvasOverlay can paint the live preview.
	const externalLayoutMoveDragRef = useRef<ExternalLayoutMoveDrag | null>(null);
	const [externalLayoutMovePreview, setExternalLayoutMovePreview] = useState<{
		readonly frameId: string;
		readonly hostChildId: string;
		readonly base: RequiredLayoutCellSpanPlacement;
		readonly placement: RequiredLayoutCellSpanPlacement;
	} | null>(null);
	const latestFitArtboardRef = useRef(onFitArtboard);
	const latestFitSelectionRef = useRef(onFitSelection);
	const latestSelectionBoundsRef = useRef<Bounds | null>(null);
	const deepSelectionCycleRef = useRef<DeepSelectionCycle | null>(null);
	// Preview-interactions hover bookkeeping: the last hit node id (or `null` for
	// a bare-canvas hover) a `hover-in`/`hover-out` pair was dispatched for, so a
	// pointermove only fires the engine on an ACTUAL hover-target change, not
	// every move within the same node — mirrors how a real DOM `pointerenter`/
	// `pointerleave` pair behaves for a mounted player's own listeners.
	const interactionPreviewHoverRef = useRef<string | null>(null);
	// Pointer-down origin + moved distance for the in-preview gesture, so a small
	// jitter still counts as a "click" (same `DRAG_THRESHOLD_PX` semantics the
	// select tool's marquee-vs-click distinction already uses) while an actual
	// drag past that threshold does not synthesize a click on release.
	const interactionPreviewGestureRef = useRef<{
		readonly pointerId: number;
		readonly originX: number;
		readonly originY: number;
	} | null>(null);
	const canvasCursor = viewportPanDragging
		? "grabbing"
		: temporaryPanActive || activeTool === "hand"
			? "grab"
			: temporarySelectActive
				? "default"
				: undefined;
	const iPadViewportVisualDietActive =
		iPadAuthoringSurface.visible && viewportPanDragging;
	const iPadCameraFastPathEnabled =
		iPadAuthoringSurface.visible && !gpuCanvasEnabled;

	const applyIpadVisualCamera = useCallback(
		(next: Camera): boolean => {
			if (!iPadCameraFastPathEnabled) return false;
			const worldGroup = cameraWorldGroupRef.current;
			if (!worldGroup) return false;
			worldGroup.setAttribute("transform", cameraTransformValue(next));
			iPadPendingCameraCommitRef.current = next;
			return true;
		},
		[iPadCameraFastPathEnabled],
	);

	const commitIpadVisualCamera = useCallback((lane: IpadPerfLane): boolean => {
		const pending = iPadPendingCameraCommitRef.current;
		if (!pending) return false;
		iPadPendingCameraCommitRef.current = null;
		iPadPerfCaptureRef.current?.recordViewportWrite(lane);
		useViewportStore.setState(pending);
		return true;
	}, []);

	const clearIpadVisualCamera = useCallback(() => {
		iPadPendingCameraCommitRef.current = null;
		cameraWorldGroupRef.current?.setAttribute(
			"transform",
			cameraTransformValue(useViewportStore.getState()),
		);
	}, []);

	useLayoutEffect(() => {
		if (iPadPendingCameraCommitRef.current) return;
		cameraWorldGroupRef.current?.setAttribute(
			"transform",
			cameraTransformValue(camera),
		);
	}, [camera]);

	const startViewportPanGesture = useCallback(
		(
			event: ReactPointerEvent<Element>,
			source: ViewportPanGesture["source"],
		) => {
			event.preventDefault();
			viewportPanGestureRef.current = {
				pointerId: event.pointerId,
				source,
				lastClientX: event.clientX,
				lastClientY: event.clientY,
			};
			iPadPerfCaptureRef.current?.recordPointer(
				ipadPerfLaneForViewportPan(source),
			);
			iPadPerfCaptureRef.current?.setActiveGesture(
				ipadPerfLaneForViewportPan(source),
			);
			setViewportPanDragging(true);
			// Capture keeps the pan alive if the pointer slips onto a floating panel,
			// but it already works without it because the viewport wrapper that now
			// owns this gesture is full-bleed, so a capture failure must not abort it.
			safelyCapturePointer(event.currentTarget, event.pointerId);
		},
		[],
	);

	const endViewportPanGesture = useCallback((pointerId: number): boolean => {
		if (viewportPanGestureRef.current?.pointerId !== pointerId) return false;
		viewportPanGestureRef.current = null;
		iPadPerfCaptureRef.current?.setActiveGesture(null);
		setViewportPanDragging(false);
		return true;
	}, []);

	const applyIpadPencilHoverPreview = useCallback(
		(next: IpadPencilHoverPreview | null) => {
			if (next) {
				iPadPerfCaptureRef.current?.recordHoverWrite("pencil-hover");
			}
			setIpadPencilHoverPreview((previous) => {
				if (!previous || !next) return next;
				if (
					Math.abs(previous.x - next.x) < 0.5 &&
					Math.abs(previous.y - next.y) < 0.5 &&
					previous.radius === next.radius &&
					previous.altitudeAngle === next.altitudeAngle &&
					previous.azimuthAngle === next.azimuthAngle &&
					previous.rollDegrees === next.rollDegrees
				) {
					return previous;
				}
				return next;
			});
		},
		[],
	);

	const cancelPendingIpadPencilHoverPreview = useCallback(() => {
		if (iPadPencilHoverRafRef.current !== null) {
			window.cancelAnimationFrame(iPadPencilHoverRafRef.current);
			iPadPencilHoverRafRef.current = null;
		}
		iPadPencilHoverPendingRef.current = null;
	}, []);

	const clearIpadPencilHoverPreview = useCallback(() => {
		cancelPendingIpadPencilHoverPreview();
		setIpadPencilHoverPreview(null);
	}, [cancelPendingIpadPencilHoverPreview]);

	const scheduleIpadPencilHoverPreview = useCallback(
		(next: IpadPencilHoverPreview) => {
			iPadPencilHoverPendingRef.current = next;
			if (iPadPencilHoverRafRef.current !== null) return;
			iPadPencilHoverRafRef.current = window.requestAnimationFrame(() => {
				iPadPencilHoverRafRef.current = null;
				const pending = iPadPencilHoverPendingRef.current;
				iPadPencilHoverPendingRef.current = null;
				applyIpadPencilHoverPreview(pending);
			});
		},
		[applyIpadPencilHoverPreview],
	);

	// iPadOS can deliver several pointermove events inside one paint interval.
	// Keep viewport store writes to one camera update per animation frame.
	const applyPendingViewportPan = useCallback(() => {
		const pending = viewportPanPendingDeltaRef.current;
		const dx = pending.dx;
		const dy = pending.dy;
		pending.dx = 0;
		pending.dy = 0;
		if (dx !== 0 || dy !== 0) {
			const base =
				iPadPendingCameraCommitRef.current ?? useViewportStore.getState();
			if (
				applyIpadVisualCamera({
					zoom: base.zoom,
					panX: base.panX + dx,
					panY: base.panY + dy,
					rotation: base.rotation,
				})
			) {
				return;
			}
			iPadPerfCaptureRef.current?.recordViewportWrite(
				ipadPerfLaneForViewportPan(viewportPanGestureRef.current?.source),
			);
			useViewportStore.getState().panBy(dx, dy);
		}
	}, [applyIpadVisualCamera]);

	const flushPendingViewportPan = useCallback(() => {
		if (viewportPanRafRef.current !== null) {
			window.cancelAnimationFrame(viewportPanRafRef.current);
			viewportPanRafRef.current = null;
		}
		applyPendingViewportPan();
		commitIpadVisualCamera(
			ipadPerfLaneForViewportPan(viewportPanGestureRef.current?.source),
		);
	}, [applyPendingViewportPan, commitIpadVisualCamera]);

	const cancelPendingViewportPan = useCallback(() => {
		if (viewportPanRafRef.current !== null) {
			window.cancelAnimationFrame(viewportPanRafRef.current);
			viewportPanRafRef.current = null;
		}
		viewportPanPendingDeltaRef.current.dx = 0;
		viewportPanPendingDeltaRef.current.dy = 0;
		clearIpadVisualCamera();
	}, [clearIpadVisualCamera]);

	const scheduleViewportPan = useCallback(
		(dx: number, dy: number) => {
			viewportPanPendingDeltaRef.current.dx += dx;
			viewportPanPendingDeltaRef.current.dy += dy;
			if (viewportPanRafRef.current !== null) return;
			viewportPanRafRef.current = window.requestAnimationFrame(() => {
				viewportPanRafRef.current = null;
				applyPendingViewportPan();
			});
		},
		[applyPendingViewportPan],
	);

	const cancelCanvasPointerGestureForIpadViewport = useCallback(() => {
		sceneCameraHandleDragRef.current = null;
		setSceneCameraHandleHud(null);
		if (externalLayoutMoveDragRef.current) {
			externalLayoutMoveDragRef.current = null;
			setExternalLayoutMovePreview(null);
		}
		if (
			activePointerIdRef.current === null &&
			pointerGestureHandlerRef.current === undefined
		) {
			return;
		}
		(
			pointerGestureHandlerRef.current ?? activeHandlerRef.current
		)?.onDeactivate?.(latestHandlerApiRef.current);
		useSceneStore.getState().commit();
		pointerGestureHandlerRef.current = undefined;
		pointerArtboardIdRef.current = null;
		activePointerIdRef.current = null;
		stageRectRef.current = null;
	}, []);

	const clearIpadHistoryHold = useCallback(() => {
		const hold = iPadHistoryHoldRef.current;
		if (!hold) return;
		window.clearTimeout(hold.timerId);
		if (hold.intervalId !== null) window.clearInterval(hold.intervalId);
		iPadHistoryHoldRef.current = null;
	}, []);

	const startIpadHistoryHold = useCallback(
		(touchCount: 2 | 3) => {
			const existing = iPadHistoryHoldRef.current;
			if (existing?.touchCount === touchCount) return;
			clearIpadHistoryHold();
			const run = () => {
				if (touchCount === 2) {
					globalUndo();
					postNativeBridgeMessage({
						kind: "perform-pencil-feedback",
						feedback: "undo",
					});
					return;
				}
				globalRedo();
				postNativeBridgeMessage({
					kind: "perform-pencil-feedback",
					feedback: "redo",
				});
			};
			const hold: IpadHistoryHold = {
				touchCount,
				timerId: window.setTimeout(() => {
					run();
					hold.intervalId = window.setInterval(
						run,
						IPAD_HISTORY_HOLD_REPEAT_MS,
					);
				}, IPAD_HISTORY_HOLD_START_MS),
				intervalId: null,
			};
			iPadHistoryHoldRef.current = hold;
		},
		[clearIpadHistoryHold],
	);

	const beginIpadViewportGesture = useCallback((): boolean => {
		const metrics = ipadViewportTouchMetrics(
			iPadViewportTouchPointersRef.current,
			viewportRectRef.current,
		);
		if (!metrics || metrics.distance < MIN_IPAD_VIEWPORT_PINCH_DISTANCE_PX) {
			return false;
		}
		const state = useViewportStore.getState();
		cancelCanvasPointerGestureForIpadViewport();
		const startWorld = screenToWorld(
			{
				zoom: state.zoom,
				panX: state.panX,
				panY: state.panY,
				rotation: state.rotation,
			},
			{ x: metrics.midpointX, y: metrics.midpointY },
		);
		viewportPanGestureRef.current = null;
		iPadPerfCaptureRef.current?.setActiveGesture("camera-touch");
		iPadViewportGestureRef.current = {
			startAngle: metrics.angle,
			startDistance: metrics.distance,
			startMidpointX: metrics.midpointX,
			startMidpointY: metrics.midpointY,
			startPanX: state.panX,
			startPanY: state.panY,
			startWorldX: startWorld.x,
			startWorldY: startWorld.y,
			startRotation: state.rotation,
			startZoom: state.zoom,
			startedAt: Date.now(),
			maxTouchCount: iPadViewportTouchPointersRef.current.size,
			moved: false,
		};
		setViewportPanDragging(true);
		return true;
	}, [cancelCanvasPointerGestureForIpadViewport]);

	const updateIpadViewportGestureMovement = useCallback(
		(gesture: IpadViewportGesture, metrics: IpadViewportTouchMetrics) => {
			if (
				Math.abs(metrics.distance - gesture.startDistance) >
					IPAD_MULTI_TOUCH_TAP_MOVE_PX ||
				Math.hypot(
					metrics.midpointX - gesture.startMidpointX,
					metrics.midpointY - gesture.startMidpointY,
				) > IPAD_MULTI_TOUCH_TAP_MOVE_PX ||
				angularDistance(metrics.angle, gesture.startAngle) > 0.035
			) {
				gesture.moved = true;
			}
		},
		[],
	);

	const applyIpadViewportGestureNow = useCallback((): boolean => {
		if (!iPadViewportGestureRef.current && !beginIpadViewportGesture()) {
			return false;
		}
		const gesture = iPadViewportGestureRef.current;
		if (!gesture) return false;
		gesture.maxTouchCount = Math.max(
			gesture.maxTouchCount,
			iPadViewportTouchPointersRef.current.size,
		);
		const metrics = ipadViewportTouchMetrics(
			iPadViewportTouchPointersRef.current,
			viewportRectRef.current,
		);
		if (!metrics) return false;
		updateIpadViewportGestureMovement(gesture, metrics);
		const nextZoom = clampZoom(
			gesture.startZoom * (metrics.distance / gesture.startDistance),
		);
		const nextRotation =
			gesture.startRotation + metrics.angle - gesture.startAngle;
		const nextScale = nextZoom / 100;
		const cos = Math.cos(nextRotation);
		const sin = Math.sin(nextRotation);
		const rotatedWorldX = gesture.startWorldX * cos - gesture.startWorldY * sin;
		const rotatedWorldY = gesture.startWorldX * sin + gesture.startWorldY * cos;
		const nextCamera = {
			zoom: nextZoom,
			panX: metrics.midpointX - rotatedWorldX * nextScale,
			panY: metrics.midpointY - rotatedWorldY * nextScale,
			rotation: nextRotation,
		} satisfies Camera;
		if (applyIpadVisualCamera(nextCamera)) return true;
		iPadPerfCaptureRef.current?.recordViewportWrite("camera-touch");
		useViewportStore.setState(nextCamera);
		return true;
	}, [
		applyIpadVisualCamera,
		beginIpadViewportGesture,
		updateIpadViewportGestureMovement,
	]);

	const scheduleIpadViewportGesture = useCallback((): boolean => {
		if (!iPadViewportGestureRef.current && !beginIpadViewportGesture()) {
			return false;
		}
		const gesture = iPadViewportGestureRef.current;
		if (gesture) {
			gesture.maxTouchCount = Math.max(
				gesture.maxTouchCount,
				iPadViewportTouchPointersRef.current.size,
			);
			const metrics = ipadViewportTouchMetrics(
				iPadViewportTouchPointersRef.current,
				viewportRectRef.current,
			);
			if (metrics) updateIpadViewportGestureMovement(gesture, metrics);
		}
		if (iPadViewportGestureRafRef.current !== null) return true;
		iPadViewportGestureRafRef.current = window.requestAnimationFrame(() => {
			iPadViewportGestureRafRef.current = null;
			applyIpadViewportGestureNow();
		});
		return true;
	}, [
		applyIpadViewportGestureNow,
		beginIpadViewportGesture,
		updateIpadViewportGestureMovement,
	]);

	const flushScheduledIpadViewportGesture = useCallback(() => {
		if (iPadViewportGestureRafRef.current === null) return;
		window.cancelAnimationFrame(iPadViewportGestureRafRef.current);
		iPadViewportGestureRafRef.current = null;
		applyIpadViewportGestureNow();
	}, [applyIpadViewportGestureNow]);

	const cancelScheduledIpadViewportGesture = useCallback(() => {
		if (iPadViewportGestureRafRef.current === null) return;
		window.cancelAnimationFrame(iPadViewportGestureRafRef.current);
		iPadViewportGestureRafRef.current = null;
	}, []);

	const endIpadViewportTouchPointer = useCallback(
		(pointerId: number): boolean => {
			const hold = iPadQuickMenuTouchHoldRef.current;
			if (hold?.pointerId === pointerId) {
				window.clearTimeout(hold.timerId);
				iPadQuickMenuTouchHoldRef.current = null;
			}
			if (!iPadViewportTouchPointersRef.current.has(pointerId)) return false;
			flushScheduledIpadViewportGesture();
			commitIpadVisualCamera("camera-touch");
			const gesture = iPadViewportGestureRef.current;
			if (
				gesture &&
				iPadViewportTouchPointersRef.current.size >= 2 &&
				!gesture.moved &&
				Date.now() - gesture.startedAt <= IPAD_MULTI_TOUCH_TAP_MAX_MS
			) {
				if (gesture.maxTouchCount >= 4) {
					setIpadFocusMode((focused) => !focused);
					setIpadAppearanceOpen(false);
					setIpadQuickMenu(null);
					useEditorChromeStore.setState({
						panelsOpen: false,
						layersOpen: false,
						inspectorOpen: false,
						timelineOpen: false,
						lookWorkspaceOpen: false,
					});
					postNativeBridgeMessage({
						kind: "perform-pencil-feedback",
						feedback: "selection",
					});
				} else if (gesture.maxTouchCount >= 3) {
					globalRedo();
					postNativeBridgeMessage({
						kind: "perform-pencil-feedback",
						feedback: "redo",
					});
				} else {
					globalUndo();
					postNativeBridgeMessage({
						kind: "perform-pencil-feedback",
						feedback: "undo",
					});
				}
				iPadViewportTouchPointersRef.current.clear();
				iPadViewportGestureRef.current = null;
				iPadPerfCaptureRef.current?.setActiveGesture(null);
				setViewportPanDragging(false);
				return true;
			}
			if (
				gesture &&
				iPadViewportTouchPointersRef.current.size >= 2 &&
				gesture.maxTouchCount === 3 &&
				gesture.moved
			) {
				const metrics = ipadViewportTouchMetrics(
					iPadViewportTouchPointersRef.current,
					viewportRectRef.current,
				);
				const deltaX =
					(metrics?.midpointX ?? gesture.startMidpointX) -
					gesture.startMidpointX;
				const deltaY =
					(metrics?.midpointY ?? gesture.startMidpointY) -
					gesture.startMidpointY;
				if (
					deltaY >= IPAD_THREE_FINGER_SWIPE_DOWN_PX &&
					Math.abs(deltaX) < deltaY * 0.8
				) {
					setIpadAppearanceOpen(false);
					setIpadQuickMenu({
						x: metrics?.midpointX ?? gesture.startMidpointX,
						y: metrics?.midpointY ?? gesture.startMidpointY,
						source: "touch",
					});
					postNativeBridgeMessage({
						kind: "perform-pencil-feedback",
						feedback: "palette-open",
					});
					iPadViewportTouchPointersRef.current.clear();
					iPadViewportGestureRef.current = null;
					iPadPerfCaptureRef.current?.setActiveGesture(null);
					setViewportPanDragging(false);
					return true;
				}
			}
			if (
				gesture &&
				iPadViewportTouchPointersRef.current.size >= 2 &&
				gesture.maxTouchCount === 2 &&
				gesture.moved &&
				Date.now() - gesture.startedAt <= IPAD_QUICK_PINCH_MAX_MS
			) {
				const metrics = ipadViewportTouchMetrics(
					iPadViewportTouchPointersRef.current,
					viewportRectRef.current,
				);
				const distanceRatio = metrics
					? metrics.distance / gesture.startDistance
					: 1;
				if (distanceRatio <= IPAD_QUICK_PINCH_FIT_RATIO) {
					const restoreCamera = iPadQuickPinchRestoreRef.current;
					if (restoreCamera) {
						iPadPerfCaptureRef.current?.recordViewportWrite("camera-touch");
						useViewportStore.setState(restoreCamera);
						iPadQuickPinchRestoreRef.current = null;
					} else {
						iPadQuickPinchRestoreRef.current = {
							zoom: gesture.startZoom,
							panX: gesture.startPanX,
							panY: gesture.startPanY,
							rotation: gesture.startRotation,
						};
						iPadPerfCaptureRef.current?.recordViewportWrite("camera-touch");
						useViewportStore.setState({ rotation: 0 });
						const bounds = latestSelectionBoundsRef.current;
						if (bounds) {
							latestFitSelectionRef.current(bounds);
						} else {
							latestFitArtboardRef.current();
						}
					}
					postNativeBridgeMessage({
						kind: "perform-pencil-feedback",
						feedback: "selection",
					});
					iPadViewportTouchPointersRef.current.clear();
					iPadViewportGestureRef.current = null;
					iPadPerfCaptureRef.current?.setActiveGesture(null);
					setViewportPanDragging(false);
					return true;
				}
			}
			const removed = iPadViewportTouchPointersRef.current.delete(pointerId);
			if (!removed) return false;
			if (
				iPadViewportTouchPointersRef.current.size < 2 &&
				iPadViewportGestureRef.current
			) {
				iPadViewportGestureRef.current = null;
				iPadPerfCaptureRef.current?.setActiveGesture(null);
				setViewportPanDragging(false);
			}
			return true;
		},
		[commitIpadVisualCamera, flushScheduledIpadViewportGesture],
	);

	const clearIpadQuickMenuTouchHold = useCallback(() => {
		const hold = iPadQuickMenuTouchHoldRef.current;
		if (!hold) return;
		window.clearTimeout(hold.timerId);
		iPadQuickMenuTouchHoldRef.current = null;
	}, []);

	const clearIpadViewportGesture = useCallback(() => {
		clearIpadQuickMenuTouchHold();
		clearIpadHistoryHold();
		cancelScheduledIpadViewportGesture();
		commitIpadVisualCamera("camera-touch");
		iPadViewportTouchPointersRef.current.clear();
		iPadViewportGestureRef.current = null;
		iPadPerfCaptureRef.current?.setActiveGesture(null);
		setViewportPanDragging(false);
	}, [
		cancelScheduledIpadViewportGesture,
		clearIpadHistoryHold,
		clearIpadQuickMenuTouchHold,
		commitIpadVisualCamera,
	]);

	useEffect(() => {
		layoutInteractionCacheRef.current = {
			source: sceneDocument,
			document: layoutInteractionDocument,
		};
		latestHandlerApiRef.current = handlerApi;
		activeHandlerRef.current = activeHandler;
	}, [activeHandler, handlerApi, layoutInteractionDocument, sceneDocument]);

	useEffect(
		() => () => {
			for (const timer of nativePencilFinalizeTimersRef.current.values()) {
				window.clearTimeout(timer);
			}
			nativePencilFinalizeTimersRef.current.clear();
			nativePencilSessionsRef.current?.clear();
			if (iPadQuickbarNoticeTimerRef.current !== null) {
				window.clearTimeout(iPadQuickbarNoticeTimerRef.current);
				iPadQuickbarNoticeTimerRef.current = null;
			}
			const hold = iPadQuickMenuTouchHoldRef.current;
			if (hold) {
				window.clearTimeout(hold.timerId);
				iPadQuickMenuTouchHoldRef.current = null;
			}
			cancelPendingIpadPencilHoverPreview();
			cancelPendingViewportPan();
			cancelScheduledIpadViewportGesture();
			clearIpadHistoryHold();
		},
		[
			cancelPendingIpadPencilHoverPreview,
			cancelPendingViewportPan,
			cancelScheduledIpadViewportGesture,
			clearIpadHistoryHold,
		],
	);

	useEffect(() => {
		latestFitArtboardRef.current = onFitArtboard;
		latestFitSelectionRef.current = onFitSelection;
	}, [onFitArtboard, onFitSelection]);

	const showIpadQuickbarNotice = useCallback(
		(notice: IpadQuickbarNotice, timeoutMs = 4_000) => {
			if (iPadQuickbarNoticeTimerRef.current !== null) {
				window.clearTimeout(iPadQuickbarNoticeTimerRef.current);
				iPadQuickbarNoticeTimerRef.current = null;
			}
			setIpadQuickbarNotice(notice);
			if (timeoutMs <= 0) return;
			iPadQuickbarNoticeTimerRef.current = window.setTimeout(() => {
				iPadQuickbarNoticeTimerRef.current = null;
				setIpadQuickbarNotice(null);
			}, timeoutMs);
		},
		[],
	);

	const performIpadPencilFeedback = useCallback(
		(feedback: IpadPencilFeedback) => {
			postNativeBridgeMessage({ kind: "perform-pencil-feedback", feedback });
		},
		[],
	);

	const closeIpadQuickMenu = useCallback(() => {
		clearIpadQuickMenuTouchHold();
		setIpadQuickMenu(null);
	}, [clearIpadQuickMenuTouchHold]);

	const openIpadQuickMenuAt = useCallback(
		(
			point: { readonly x: number; readonly y: number },
			source: IpadQuickMenuState["source"],
			pencil?: IpadQuickMenuState["pencil"],
		) => {
			clearIpadQuickMenuTouchHold();
			setIpadAppearanceOpen(false);
			setIpadQuickMenu({ ...point, source, ...(pencil ? { pencil } : {}) });
		},
		[clearIpadQuickMenuTouchHold],
	);

	const updateIpadPencilHoverPreview = useCallback(
		(event: ReactPointerEvent<Element>) => {
			if (
				!iPadAuthoringSurface.visible ||
				activeTool !== "pencil" ||
				event.pointerType !== "pen" ||
				event.buttons !== 0
			) {
				return;
			}
			const next = ipadPencilHoverPreviewFromEvent(
				event,
				viewportRectRef.current,
			);
			if (!next) {
				clearIpadPencilHoverPreview();
				return;
			}
			scheduleIpadPencilHoverPreview(next);
		},
		[
			activeTool,
			clearIpadPencilHoverPreview,
			iPadAuthoringSurface.visible,
			scheduleIpadPencilHoverPreview,
		],
	);

	useEffect(() => {
		if (!iPadAuthoringSurface.visible || activeTool !== "pencil") {
			clearIpadPencilHoverPreview();
		}
	}, [activeTool, clearIpadPencilHoverPreview, iPadAuthoringSurface.visible]);

	const applyIpadAppearancePatch = useCallback((patch: IpadAppearancePatch) => {
		const nodeIds = useSelectionStore.getState().nodeIds;
		if (nodeIds.length === 0) return;
		const channels = Object.keys(patch).sort();
		if (channels.length === 0) return;
		const store = useSceneStore.getState();
		const grammarTargetNodeIds = currentMotionGrammarTargetNodeIds();
		const motion = useMotionStore.getState().document;
		store.beginTransaction(
			`ipad-appearance:${channels.join(":")}`,
			"Adjust style",
		);
		for (const nodeId of nodeIds) {
			store.apply(
				createUpdateNodeStyleCommand(nodeId, patch, {
					grammarTargetNodeIds,
					motion,
				}),
			);
		}
		store.commit();
	}, []);

	const applyIpadTextAppearancePatch = useCallback(
		(patch: IpadTextAppearancePatch) => {
			const channels = Object.keys(patch).sort();
			if (channels.length === 0) return;
			const nodeIds = [...new Set(useSelectionStore.getState().nodeIds)];
			if (nodeIds.length === 0) return;
			const document = useSceneStore.getState().document;
			const textNodeIds = nodeIds.filter(
				(nodeId) => findNode(document, nodeId)?.geometry.kind === "text",
			);
			if (textNodeIds.length === 0) return;
			const store = useSceneStore.getState();
			store.beginTransaction(
				`ipad-typography:${channels.join(":")}`,
				"Adjust text",
			);
			for (const nodeId of textNodeIds) {
				store.apply(
					createUpdateTextNodeCommand(
						nodeId,
						{ style: patch },
						{ label: "Adjust text" },
					),
				);
			}
			store.commit();
		},
		[],
	);

	const shareIpadProjectBackup = useCallback(() => {
		const scene = useSceneStore.getState().document;
		const motion = useMotionStore.getState().document;
		const grammar = useMotionGrammarStore.getState().document;
		const fileName = projectBackupFileName(scene.name);
		showIpadQuickbarNotice(
			{
				tone: "neutral",
				label: "Preparing share",
				detail: `Preparing ${fileName} for the native share sheet.`,
			},
			0,
		);
		if (
			!postNativeBridgeMessage({
				kind: "share-project-backup",
				fileName,
				mimeType: projectBackupMimeType(),
				contents: serializeProjectBackup(scene, motion, { grammar }),
			})
		) {
			showIpadQuickbarNotice({
				tone: "danger",
				label: "Share unavailable",
				detail: "Native file sharing is not available in this editor host.",
			});
		}
	}, [showIpadQuickbarNotice]);

	const restoreIpadProjectBackup = useCallback(
		(fileName: string, contents: string) => {
			const result = restorePortableProject(contents);
			if (result.status !== "ok") {
				const issueDetail =
					result.issues[0]?.message ?? "File is not a recognized backup.";
				showIpadQuickbarNotice({
					tone: "danger",
					label: "Restore failed",
					detail: `${fileName}: ${issueDetail}`,
				});
				return;
			}
			useSceneStore.getState().reset(result.scene);
			if (result.motion) {
				useMotionStore.getState().reset(result.motion);
			} else {
				useMotionStore.getState().reset();
			}
			if (result.grammar) {
				useMotionGrammarStore.getState().load(result.grammar);
			} else {
				useMotionGrammarStore.getState().reset();
			}
			useEditorCloudProjectStore.getState().clearActiveProject();
			useSelectionStore.getState().clearSelection();
			useTransportStore.getState().stop();
			window.setTimeout(() => latestFitArtboardRef.current(), 0);
			const compatibilityLimited = result.compatibility.status === "limited";
			showIpadQuickbarNotice({
				tone: compatibilityLimited ? "warning" : "success",
				label: compatibilityLimited
					? "Backup restored with authoring limits"
					: "Backup restored",
				detail: compatibilityLimited
					? `${fileName} opened locally. ${result.compatibility.partialCapabilityCount} partial and ${result.compatibility.blockedCapabilityCount} blocked GUI capability rows are present.`
					: `${fileName} replaced the current project locally.`,
			});
		},
		[showIpadQuickbarNotice],
	);

	const openIpadProjectBackup = useCallback(() => {
		showIpadQuickbarNotice({
			tone: "neutral",
			label: "Opening Files",
			detail: "Opening the native document picker for a Vecmo backup.",
		});
		if (!postNativeBridgeMessage({ kind: "open-project-backup" })) {
			showIpadQuickbarNotice({
				tone: "danger",
				label: "Open unavailable",
				detail: "Native file import is not available in this editor host.",
			});
		}
	}, [showIpadQuickbarNotice]);

	const openIpadCloudRecovery = useCallback(() => {
		const activeProjectId =
			useEditorCloudProjectStore.getState().activeProject?.id ?? null;
		const historyQuery = activeProjectId
			? `?history=${encodeURIComponent(activeProjectId)}`
			: "";
		globalThis.location.assign(`/projects${historyQuery}`);
	}, []);

	const toggleIpadTimeline = useCallback(() => {
		setIpadAppearanceOpen(false);
		setIpadQuickMenu(null);
		useEditorChromeStore.getState().toggleTimeline();
	}, []);

	const clearIpadDerivedCache = useCallback(() => {
		setIpadAppearanceOpen(false);
		setIpadQuickMenu(null);
		void getCanvasPersistentCacheClient()
			.clearDerivedArtifacts()
			.then(() =>
				showIpadQuickbarNotice({
					tone: "success",
					label: "Cache cleared",
					detail: "Regenerable editor cache artifacts were removed.",
				}),
			)
			.catch(() =>
				showIpadQuickbarNotice({
					tone: "danger",
					label: "Cache clear failed",
					detail: "The document is unchanged. Try again after reopening.",
				}),
			);
	}, [showIpadQuickbarNotice]);

	useEffect(
		() =>
			useTransportStore.subscribe((state, previous) => {
				if (state.isPlaying) return;
				if (
					!previous.isPlaying &&
					state.currentFrame === previous.currentFrame
				) {
					return;
				}
				setPresentationFrame((frame) =>
					resolveCanvasPresentationFrame(frame, state),
				);
			}),
		[],
	);

	useEffect(() => {
		const handleViewportShortcut = (event: KeyboardEvent): boolean => {
			if (event.code === "Space") {
				event.preventDefault();
				// Leading edge only: keydown auto-repeats while held, so reset the tap
				// candidacy on the first press and never on a repeat — otherwise a
				// repeat fired mid-drag would clear the pan flag and the release would
				// wrongly toggle playback after a pan.
				if (!spaceHeldRef.current) spacePanUsedRef.current = false;
				setTemporaryPanActive(true);
				spaceHeldRef.current = true;
				return true;
			}

			const guideShortcut = guideViewShortcutIntent(event);
			if (guideShortcut) {
				event.preventDefault();
				const guideStore = useGuideStore.getState();
				if (guideShortcut === "toggle-rulers") {
					guideStore.toggleRulersVisible();
					return true;
				}
				if (guideShortcut === "toggle-pixel-grid") {
					guideStore.togglePixelGridVisible();
					return true;
				}
				// Mod+' = the merged workspace + artboard grid. The capture-phase
				// command dispatcher (view.toggle-grid) normally owns this key and
				// stops propagation before this bubble-phase handler runs; this stays
				// as the equivalent fallback so the key never half-toggles one grid.
				guideStore.toggleGridGroup();
				return true;
			}

			// Mod++ / Mod+- / Mod+0 zoom the canvas, not the browser page. They
			// preventDefault so the browser's page-zoom never fires over the editor.
			if ((event.metaKey || event.ctrlKey) && !event.altKey) {
				if (event.code === "Equal") {
					event.preventDefault();
					useViewportStore.getState().zoomStepIn();
					return true;
				}
				if (event.code === "Minus") {
					event.preventDefault();
					useViewportStore.getState().zoomStepOut();
					return true;
				}
				if (event.code === "Digit0" && !event.shiftKey) {
					event.preventDefault();
					useViewportStore.getState().zoomToActualSize();
					return true;
				}
			}

			if (event.metaKey || event.ctrlKey || event.altKey) return false;

			if (event.shiftKey) {
				if (event.code === "Digit1") {
					event.preventDefault();
					latestFitArtboardRef.current();
					return true;
				}
				if (event.code === "Digit2") {
					event.preventDefault();
					const bounds = latestSelectionBoundsRef.current;
					if (bounds) latestFitSelectionRef.current(bounds);
					return true;
				}
				if (event.code === "Digit0") {
					event.preventDefault();
					useViewportStore.getState().zoomToActualSize();
					return true;
				}
			}

			if (event.code === "Equal") {
				event.preventDefault();
				useViewportStore.getState().zoomStepIn();
				return true;
			}
			if (event.code === "Minus") {
				event.preventDefault();
				useViewportStore.getState().zoomStepOut();
				return true;
			}

			return false;
		};

		const onKeyDown = (event: KeyboardEvent) => {
			if (isEditableKeyboardTarget(event.target)) return;
			// The shortcut-help overlay is modal: suppress canvas tool/opacity/frame
			// keys while it is open (Escape is owned by the overlay).
			if (useEditorChromeStore.getState().shortcutHelpOpen) return;
			// Preview interactions owns Escape while active — exits preview (stop
			// the engine, restore the pre-preview frame) BEFORE any tool/shortcut
			// key handling below, mirroring the shortcut-help overlay's own
			// Escape-ownership priority immediately above. Every other key stays
			// suppressed too: selection/tools are fully bypassed while preview is
			// on (see `handleInteractionPreviewPointerDown`'s JSDoc), so a
			// tool-shortcut letter or Space-toggle-play firing mid-preview would
			// contradict that.
			if (useTransportStore.getState().interactionPreview) {
				if (event.key === "Escape") {
					event.preventDefault();
					useTransportStore.getState().setInteractionPreview(false);
				}
				return;
			}
			// Perform mode owns Escape while its recorder is armed: cancel the pending
			// performance before any tool/shortcut handling below, mirroring the
			// preview Escape-ownership just above, so the armed state always has a
			// keyboard exit and is never a dead-end.
			if (event.key === "Escape" && useTransportStore.getState().performing) {
				event.preventDefault();
				useTransportStore.getState().disarmPerform();
				return;
			}
			// Spring-loaded selection: holding ⌘/Ctrl routes pointer events to the
			// select handler (reverts on release). Fall through so ⌘+key shortcuts
			// (undo, select-all, …) still fire — this only affects pointer routing.
			if (
				(event.key === "Meta" || event.key === "Control") &&
				!cmdSelectHeldRef.current
			) {
				cmdSelectHeldRef.current = true;
				setTemporarySelectActive(true);
			}
			if (handleViewportShortcut(event)) return;

			// Stage L keyboard workflow: an unmodified digit sets the primary
			// selection's opacity (Figma-style), and Home/End/,/. navigate the
			// playhead. Arrows (node nudge) and Space (workspace pan) are left to
			// their existing handlers here — a layout-managed primary's arrow
			// press is instead intercepted below, right before handler dispatch.
			if (
				!event.metaKey &&
				!event.ctrlKey &&
				!event.altKey &&
				!event.shiftKey
			) {
				const toolShortcut = toolShortcutForKey(event.key);
				if (toolShortcut) {
					event.preventDefault();
					useToolSelectionStore.getState().setActiveTool(toolShortcut);
					return;
				}
				const opacity = opacityForDigitKey(event.key);
				if (opacity !== null) {
					const primaryNode = useSelectionStore.getState().primary;
					if (primaryNode) {
						event.preventDefault();
						useSceneStore.getState().apply(
							createUpdateNodeStyleCommand(
								primaryNode,
								{ opacity },
								{
									grammarTargetNodeIds: currentMotionGrammarTargetNodeIds(),
									motion: useMotionStore.getState().document,
								},
							),
						);
						return;
					}
				}
				const frameNav = frameNavForKey(event.key);
				if (frameNav) {
					event.preventDefault();
					const transport = useTransportStore.getState();
					const lastFrame =
						selectCurrentArtboard(useSceneStore.getState().document)
							.durationFrames - 1;
					transport.setFrame(
						frameForNav(frameNav, transport.currentFrame, lastFrame),
					);
					return;
				}
			}

			const tool = useToolSelectionStore.getState().activeTool;
			const keyHandler = handlers.find((item) => item.tool === tool);
			if (!keyHandler?.onKeyDown) return;
			const selectionState = useSelectionStore.getState();
			const viewportState = useViewportStore.getState();
			const interactionDocument = materializeLayoutFramesForPresentation(
				useSceneStore.getState().document,
			);

			// A layout-managed primary selection's arrow press moves its cell
			// placement by one cell instead of nudging raw geometry (the runner
			// would immediately re-materialize a managed child's matrix anyway —
			// see collectLayoutManagedChildIds). Only the select-transform handler
			// is eligible, mirroring tryRouteLayoutMoveDrag's pointer-drag routing;
			// a mixed selection whose PRIMARY is unmanaged falls through so its
			// ordinary pixel nudge still runs (co-selected managed children stay
			// put, consistent with the drag policy).
			if (
				keyHandler.id === "select-transform" &&
				tryRouteLayoutMoveKeyNudge(
					interactionDocument,
					event,
					selectionState.primary,
					selectionState.nodeIds,
				)
			) {
				return;
			}

			keyHandler.onKeyDown(
				event,
				buildHandlerApi(
					{
						nodeIds: selectionState.nodeIds,
						primary: selectionState.primary,
						sub: selectionState.sub,
						sceneCamera: selectionState.sceneCamera,
						selectedArtboardId: selectionState.selectedArtboardId,
					},
					{
						zoom: viewportState.zoom,
						panX: viewportState.panX,
						panY: viewportState.panY,
						rotation: viewportState.rotation,
					},
					interactionDocument,
					{ allowTouchFreehand },
				),
			);
		};
		const onKeyUp = (event: KeyboardEvent) => {
			// Releasing ⌘/Ctrl (or dropping either while the other stays) ends the
			// spring-loaded selection override. An in-flight gesture stays latched to
			// its handler until pointer-up, so a mid-drag release never swaps mid-move.
			if (cmdSelectHeldRef.current && !event.metaKey && !event.ctrlKey) {
				cmdSelectHeldRef.current = false;
				setTemporarySelectActive(false);
			}
			if (event.code === "Space") {
				// A Space tap — held without ever starting a pan — toggles playback
				// (the overlay's "Play / pause: Space"); Space+drag pans instead.
				// Suppressed while the help overlay is modal. The keydown-owned timeline
				// transport shortcut stopPropagation's before this window listener, so a
				// timeline-focused tap never sets spaceHeldRef and this stays inert.
				const wasTap =
					spaceHeldRef.current &&
					!spacePanUsedRef.current &&
					viewportPanGestureRef.current === null;
				spaceHeldRef.current = false;
				spacePanUsedRef.current = false;
				setTemporaryPanActive(false);
				if (viewportPanGestureRef.current?.source === "space") {
					flushPendingViewportPan();
					setViewportPanDragging(false);
				}
				if (wasTap && !useEditorChromeStore.getState().shortcutHelpOpen) {
					useTransportStore.getState().togglePlay();
				}
			}
		};
		const onBlur = () => {
			spaceHeldRef.current = false;
			spacePanUsedRef.current = false;
			setTemporaryPanActive(false);
			cancelPendingViewportPan();
			setViewportPanDragging(false);
			viewportPanGestureRef.current = null;
			clearIpadViewportGesture();
			cmdSelectHeldRef.current = false;
			setTemporarySelectActive(false);
		};
		const onPointerEnd = (event: PointerEvent) => {
			if (viewportPanGestureRef.current?.pointerId === event.pointerId) {
				flushPendingViewportPan();
				endViewportPanGesture(event.pointerId);
			}
			endIpadViewportTouchPointer(event.pointerId);
		};

		window.addEventListener("keydown", onKeyDown);
		window.addEventListener("keyup", onKeyUp);
		window.addEventListener("blur", onBlur);
		window.addEventListener("pointerup", onPointerEnd);
		window.addEventListener("pointercancel", onPointerEnd);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("keyup", onKeyUp);
			window.removeEventListener("blur", onBlur);
			window.removeEventListener("pointerup", onPointerEnd);
			window.removeEventListener("pointercancel", onPointerEnd);
		};
	}, [
		allowTouchFreehand,
		clearIpadViewportGesture,
		cancelPendingViewportPan,
		endIpadViewportTouchPointer,
		endViewportPanGesture,
		flushPendingViewportPan,
	]);

	useEffect(() => {
		if (previousToolRef.current !== activeTool) {
			// When the active tool changes, deactivate the previous tool and flush
			// any scene transaction an interrupted gesture left open so the next
			// tool's edits never fold into it.
			previousHandlerRef.current?.onDeactivate?.(latestHandlerApiRef.current);
			useSceneStore.getState().commit();
			pointerArtboardIdRef.current = null;
			activePointerIdRef.current = null;
			stageRectRef.current = null;
			clearIpadViewportGesture();
			if (viewportPanGestureRef.current?.source === "hand") {
				flushPendingViewportPan();
				viewportPanGestureRef.current = null;
				setViewportPanDragging(false);
			}
			previousToolRef.current = activeTool;
			previousHandlerRef.current = activeHandler;
			// Hand the newly active tool an activation hook AFTER the previous tool's
			// teardown + commit and the ref swap, so any seed it applies (e.g. the
			// gradient tool seeding a linear gradient on a solid fill) lands as its own
			// isolated, single-undo command. Skipped during playback — host policy: no
			// tool-activation side-effects while the timeline is running.
			if (!useTransportStore.getState().isPlaying) {
				activeHandler?.onActivate?.(latestHandlerApiRef.current);
			}
		}
	}, [
		activeHandler,
		activeTool,
		clearIpadViewportGesture,
		flushPendingViewportPan,
	]);

	useEffect(
		() => () => {
			activeHandlerRef.current?.onDeactivate?.(latestHandlerApiRef.current);
			useSceneStore.getState().commit();
			pointerArtboardIdRef.current = null;
			activePointerIdRef.current = null;
			stageRectRef.current = null;
		},
		[],
	);

	const selectedNodes = useMemo(
		() =>
			selection.nodeIds
				.map((nodeId) => findNode(presentationDocument, nodeId))
				.filter((node): node is VectorNode => node !== undefined),
		[selection.nodeIds, presentationDocument],
	);
	const iPadAppearanceNode = useMemo(
		() =>
			selectedNodes.find((node) => node.id === selection.primary) ??
			selectedNodes[0] ??
			null,
		[selectedNodes, selection.primary],
	);
	const iPadAppearanceNodeStyle = useMemo((): IpadAppearanceStyle | null => {
		if (!iPadAppearanceNode) return null;
		return {
			fill: iPadAppearanceNode.style.fill,
			stroke: iPadAppearanceNode.style.stroke,
			strokeWidth: iPadAppearanceNode.style.strokeWidth,
			opacity: iPadAppearanceNode.style.opacity,
			strokeCap: iPadAppearanceNode.style.strokeCap ?? "butt",
			strokeJoin: iPadAppearanceNode.style.strokeJoin ?? "miter",
			dashedStroke:
				iPadAppearanceNode.style.strokeDash?.some((value) => value > 0) ??
				false,
			text:
				iPadAppearanceNode.geometry.kind === "text"
					? normalizeTextGeometry(iPadAppearanceNode.geometry).style
					: undefined,
		};
	}, [iPadAppearanceNode]);
	const layoutFrameOverlayTargets = useMemo(() => {
		// Layout authoring controls write source layout intent, so their grid and
		// span metrics come from the layout-only interaction document instead of
		// the motion-sampled presentation tree.
		return collectLayoutFrameOverlayTargets(
			layoutInteractionDocument,
			selection.nodeIds,
			selection.primary,
		);
	}, [layoutInteractionDocument, selection.nodeIds, selection.primary]);
	const selectionBounds = useMemo(
		() =>
			selectedNodePasteboardBounds(
				selectedNodes,
				presentationArtboards,
				presentationNodeArtboards.byNodeId,
			),
		[selectedNodes, presentationArtboards, presentationNodeArtboards],
	);
	useEffect(() => {
		latestSelectionBoundsRef.current = selectionBounds;
	}, [selectionBounds]);
	const iPadAppearanceStyle = useMemo((): CSSProperties | null => {
		if (!selectionBounds) return null;
		const anchor = quickActionAnchorForSelection(
			selectionBounds,
			camera,
			viewportSize,
			{
				heightPx: IPAD_APPEARANCE_PANEL_HEIGHT_PX,
				halfWidthPx: IPAD_APPEARANCE_PANEL_WIDTH_PX / 2,
			},
		);
		return {
			left: anchor.left,
			top: anchor.top,
			transform:
				anchor.placement === "above"
					? "translate(-50%, calc(-100% - 14px))"
					: "translate(-50%, 14px)",
		};
	}, [camera, selectionBounds, viewportSize]);
	const iPadQuickbarDock = useMemo(
		() =>
			ipadQuickbarDockForSelection({
				camera,
				selectionBounds,
				viewportSize,
			}),
		[camera, selectionBounds, viewportSize],
	);
	const iPadCloudStatus = useMemo(
		() =>
			ipadCloudStatusForProject({
				activeProject: activeCloudProject,
				failureReason: cloudSaveFailureReason,
				saveStatus: cloudSaveStatus,
			}),
		[activeCloudProject, cloudSaveFailureReason, cloudSaveStatus],
	);
	const fitCurrentSelectionForIpad = useCallback(() => {
		const bounds = latestSelectionBoundsRef.current;
		if (!bounds) {
			latestFitArtboardRef.current();
			return;
		}
		latestFitSelectionRef.current(bounds);
	}, []);
	const openIpadQuickMenuFromQuickbar = useCallback(() => {
		openIpadQuickMenuAt(
			{
				x: viewportSize.width / 2,
				y:
					iPadQuickbarDock === "top"
						? Math.min(viewportSize.height - 96, 112)
						: Math.max(96, viewportSize.height - 112),
			},
			"quickbar",
		);
	}, [iPadQuickbarDock, openIpadQuickMenuAt, viewportSize]);
	const quickActionStyle = useMemo((): CSSProperties | null => {
		if (iPadFocusMode) return null;
		if (activeTool !== "select") return null;
		// The bar rides on the object's current on-screen position. During playback
		// the presentation pose is frozen (the rAF overlay patches the DOM
		// directly), so the bar would otherwise sit detached while the object
		// animates away — hide it while playing.
		if (isPlaying) return null;
		if (!selectionBounds) return null;
		const anchor = quickActionAnchorForSelection(
			selectionBounds,
			camera,
			viewportSize,
		);
		return {
			left: anchor.left,
			top: anchor.top,
			transform:
				anchor.placement === "above"
					? "translate(-50%, calc(-100% - 12px))"
					: "translate(-50%, 12px)",
		};
	}, [
		activeTool,
		iPadFocusMode,
		isPlaying,
		camera,
		selectionBounds,
		viewportSize,
	]);
	// L5: transient canvas-local conversion cluster for a just-committed Pencil
	// stroke. Reuses the exact same conversions L2-L4 already offer from the
	// Select-tool quick-action bar (`quickActions` below) — this only adds a
	// second reachability surface that works while still on the Pencil tool,
	// before anything is selected. Every action clears `pendingStrokeIntent` on
	// success (Perform explicitly, Draw on/Make shape as their own side
	// effect), which is also what makes the cluster disappear.
	const conversionHudActions = useMemo((): readonly IpadCommandAction[] => {
		if (!pendingStrokeIntent) return [];
		const actions: IpadCommandAction[] = [
			{
				id: "draw-on",
				label: "Draw on",
				title: "Animate draw-on",
				IconComponent: PenNib,
				onClick: () => {
					authorStrokeDrawOnFromLastIntent();
				},
			},
		];
		if (
			pendingStrokeIntent.candidates.includes("closed-shape") ||
			pendingStrokeIntent.candidates.includes("straight-line")
		) {
			actions.push({
				id: "make-shape",
				label: "Make shape",
				title: "Convert sketch to a clean shape",
				IconComponent: Shapes,
				onClick: () => {
					convertLastStrokeToShape();
				},
			});
		}
		actions.push({
			id: "perform",
			label: "Perform",
			title: "Perform: drag to record motion",
			IconComponent: Circle,
			onClick: () => {
				// Perform only ever records a Select-tool drag (see
				// `armPerform`'s contract in transport-store.ts), so arming it from
				// the Pencil tool is inert until the tool switches too.
				useToolSelectionStore.getState().setActiveTool("select");
				useTransportStore.getState().armPerform();
				useStrokeIntentStore.getState().clearLastIntent();
			},
		});
		actions.push({
			id: "discard",
			label: "Discard",
			title: "Discard this stroke's conversion options",
			IconComponent: Trash,
			danger: true,
			onClick: () => useStrokeIntentStore.getState().clearLastIntent(),
		});
		return actions;
	}, [pendingStrokeIntent]);
	// Anchored to the pending intent's own node rather than `selectionBounds`,
	// so the cluster tracks the just-drawn stroke even before anything is
	// selected — the same screen-space anchor math `quickActionStyle` uses,
	// re-pointed at a single node's pasteboard bounds. `pendingStrokeIntent.id`
	// is resolved against `sceneDocument` (not the sampled `presentationDocument`)
	// to match the same source the conversions themselves read
	// (`authorStrokeDrawOn`/`convertLastStrokeToShape` both look the node up in
	// the raw scene store).
	const conversionHudStyle = useMemo((): CSSProperties | null => {
		if (!pendingStrokeIntent) return null;
		const node = findNode(sceneDocument, pendingStrokeIntent.id);
		if (!node) return null;
		const bounds = selectedNodePasteboardBounds(
			[node],
			presentationArtboards,
			presentationNodeArtboards.byNodeId,
		);
		if (!bounds) return null;
		const anchor = quickActionAnchorForSelection(bounds, camera, viewportSize);
		return {
			left: anchor.left,
			top: anchor.top,
			transform:
				anchor.placement === "above"
					? "translate(-50%, calc(-100% - 12px))"
					: "translate(-50%, 12px)",
		};
	}, [
		pendingStrokeIntent,
		sceneDocument,
		presentationArtboards,
		presentationNodeArtboards,
		camera,
		viewportSize,
	]);
	// L6 — iPad timeline minimum (docs/product-knowledge/ipad-perform-motion.md).
	// The most recent stroke-draw-on binding, if any: the reveal this compact
	// transport lets the user trim/reverse. `.at(-1)`, not `.find`, so a second
	// authored draw-on always hands control to the newest one, matching how
	// `authorStrokeDrawOnFromLastIntent` always targets the latest Pencil stroke.
	const drawOnBinding = grammarBindings
		.filter((binding) => binding.techniqueId === "stroke-draw-on")
		.at(-1);
	const totalFrames = motionDocument.durationFrames;
	const onChangeDrawOnDuration = drawOnBinding
		? (frames: number) => {
				// Not catalog-clamped (the grammar runner accepts any finite
				// parameter) — this compact surface owns a tighter UI range so a
				// stray extra tap can't run to the catalog's 600-frame ceiling or
				// collapse the reveal to nothing.
				useMotionGrammarStore.getState().apply(
					updateGrammarBinding(drawOnBinding.id, {
						parameters: {
							durationFrames: clamp(frames, 6, Math.min(300, totalFrames)),
						},
					}),
				);
			}
		: undefined;
	const onToggleDrawOnReverse = drawOnBinding
		? () => {
				useMotionGrammarStore.getState().apply(
					updateGrammarBinding(drawOnBinding.id, {
						parameters: {
							reverse: drawOnBinding.parameters.reverse ? 0 : 1,
						},
					}),
				);
			}
		: undefined;
	// Docks at the edge OPPOSITE the iPad quickbar's current dock (which
	// tracks the selection — see `ipadQuickbarDockForSelection`), so the two
	// floating clusters can never overlap regardless of where the quickbar
	// lands.
	const motionTransportStyle = useMemo((): CSSProperties => {
		if (iPadQuickbarDock === "bottom") {
			return {
				left: "50%",
				top: "max(0.875rem, env(safe-area-inset-top))",
				transform: "translateX(-50%)",
			};
		}
		return {
			left: "50%",
			bottom: "max(0.875rem, env(safe-area-inset-bottom))",
			transform: "translateX(-50%)",
		};
	}, [iPadQuickbarDock]);
	const noiseGradientToolControlStyle = useMemo((): CSSProperties | null => {
		if (activeTool !== "noise-gradient") return null;
		if (isPlaying) return null;
		if (!selectionBounds) return null;
		const anchor = quickActionAnchorForSelection(
			selectionBounds,
			camera,
			viewportSize,
			{ heightPx: 58, halfWidthPx: 112 },
		);
		return {
			left: anchor.left,
			top: anchor.top,
			transform:
				anchor.placement === "above"
					? "translate(-50%, calc(-100% - 12px))"
					: "translate(-50%, 12px)",
		};
	}, [activeTool, isPlaying, camera, selectionBounds, viewportSize]);
	// Path Blur defaults to a FRAME-level effect — it blurs the whole artboard
	// composite, so a plain rectangle drawn afterward is blurred too — but when
	// exactly one eligible (top-level, not already blurred) object is selected,
	// it instead targets that object's own scoped overlay. The tool does NOT
	// auto-seed on activation (that silently turned the frame blur on and read
	// as "why is my rect blurred?"). Instead, whenever the Path Blur tool is
	// active and the resolved target has no path-blur node yet, show an
	// explicit on-canvas hint with a one-click add. Mirrors
	// `resolvePathBlurTarget`'s frame/object precedence so the hint and the
	// guide-editing tool always agree on which target owns the tool.
	const pathBlurHintTarget = useMemo((): PathBlurHintTarget | null => {
		if (activeTool !== "path-blur") return null;
		if (isPlaying) return null;
		if (selection.nodeIds.length === 1) {
			const nodeId = selection.nodeIds[0];
			if (
				isTopLevelSceneNode(presentationDocument, nodeId) &&
				!objectPathBlurScopedLookForNode(presentationCurrentArtboard, nodeId)
			) {
				return { mode: "object", nodeId };
			}
			return null;
		}
		if (
			frameHasPathBlurNode(presentationDocument, presentationCurrentArtboard.id)
		)
			return null;
		return { mode: "frame", artboardId: presentationCurrentArtboard.id };
	}, [
		activeTool,
		isPlaying,
		selection.nodeIds,
		presentationDocument,
		presentationCurrentArtboard,
	]);
	const pathBlurHintStyle = useMemo((): CSSProperties | null => {
		if (!pathBlurHintTarget) return null;
		if (pathBlurHintTarget.mode === "object") {
			if (!selectionBounds) return null;
			const anchor = quickActionAnchorForSelection(
				selectionBounds,
				camera,
				viewportSize,
				{ heightPx: 74, halfWidthPx: 128 },
			);
			return {
				left: anchor.left,
				top: anchor.top,
				transform:
					anchor.placement === "above"
						? "translate(-50%, calc(-100% - 12px))"
						: "translate(-50%, 12px)",
			};
		}
		const screen = worldToScreen(camera, presentationCurrentArtboard.position);
		return {
			left: screen.x + (presentationCurrentArtboard.width * scale) / 2,
			top: screen.y,
			transform: "translate(-50%, 12px)",
		};
	}, [
		pathBlurHintTarget,
		camera,
		scale,
		selectionBounds,
		viewportSize,
		presentationCurrentArtboard,
	]);
	const duplicatePlan = useMemo(
		() => buildDuplicateClipboardCommand(sceneDocument, selection.nodeIds),
		[sceneDocument, selection.nodeIds],
	);
	const groupingState = useMemo(
		() =>
			selectedGroupingState(sceneDocument, {
				nodeIds: selection.nodeIds,
				primary: selection.primary,
			}),
		[sceneDocument, selection.nodeIds, selection.primary],
	);
	const applyCommandAndSelect = useCallback(
		(
			command: SceneCommand,
			nodeIds: readonly string[],
		): SceneDocument | null => {
			const before = useSceneStore.getState().document;
			useSceneStore.getState().apply(command);
			const after = useSceneStore.getState().document;
			if (after === before) return null;

			const liveNodeIds = nodeIds.filter((nodeId) => findNode(after, nodeId));
			if (liveNodeIds.length === 0) {
				clearSelection();
				return after;
			}
			setSelection(liveNodeIds, liveNodeIds.at(-1) ?? null);
			return after;
		},
		[clearSelection, setSelection],
	);
	const openIpadStyleControls = useCallback(() => {
		if (useSelectionStore.getState().nodeIds.length === 0) return;
		setIpadQuickMenu(null);
		setIpadAppearanceOpen(true);
		performIpadPencilFeedback("selection");
	}, [performIpadPencilFeedback]);
	const deleteIpadSelection = useCallback(() => {
		const selectionState = useSelectionStore.getState();
		const nodeIds = [...new Set(selectionState.nodeIds)];
		setIpadAppearanceOpen(false);
		setIpadQuickMenu(null);
		if (nodeIds.length > 0) {
			const after = applyCommandAndSelect(
				createDeleteNodesCommand(nodeIds),
				[],
			);
			if (!after) return;
			performIpadPencilFeedback("delete");
			showIpadQuickbarNotice(
				{
					tone: "success",
					label: "Deleted",
					detail:
						nodeIds.length === 1
							? "Deleted selected object."
							: `Deleted ${nodeIds.length} selected objects.`,
				},
				1_600,
			);
			return;
		}

		const artboardId = selectionState.selectedArtboardId;
		if (!artboardId) return;
		const artboards = selectAllArtboards(useSceneStore.getState().document);
		if (artboards.length <= 1) {
			performIpadPencilFeedback("warning");
			showIpadQuickbarNotice({
				tone: "danger",
				label: "Keep one",
				detail: "The final artboard cannot be deleted.",
			});
			return;
		}

		const before = useSceneStore.getState().document;
		useSceneStore
			.getState()
			.apply(
				createRemoveArtboardCommand(artboardId, { label: "Remove artboard" }),
			);
		const after = useSceneStore.getState().document;
		if (after === before) return;
		useSelectionStore.getState().selectArtboard(null);
		performIpadPencilFeedback("delete");
		showIpadQuickbarNotice(
			{
				tone: "success",
				label: "Deleted",
				detail: "Removed selected artboard.",
			},
			1_600,
		);
	}, [
		applyCommandAndSelect,
		performIpadPencilFeedback,
		showIpadQuickbarNotice,
	]);
	const quickActions = useMemo(
		() =>
			buildCanvasQuickActions({
				duplicatePlan,
				groupingState,
				pendingStrokeIntent,
				selectionNodeIds: selection.nodeIds,
				sceneDocument,
				applyCommandAndSelect,
			}),
		[
			applyCommandAndSelect,
			duplicatePlan,
			groupingState,
			pendingStrokeIntent,
			sceneDocument,
			selection.nodeIds,
		],
	);
	const iPadQuickbarToolActions = useMemo(
		(): readonly IpadQuickbarToolAction[] =>
			IPAD_AUTHORING_TOOLS.map((toolId) => {
				const tool = getEditorTool(toolId);
				const shapeVariant =
					toolId === "shape" ? shapeToolVariant(shapeKind) : null;
				return {
					id: toolId,
					label: shapeVariant ? `Shape - ${shapeVariant.label}` : tool.label,
					IconComponent: shapeVariant?.Icon ?? tool.Icon,
					active: activeTool === toolId,
					onClick: () => useToolSelectionStore.getState().setActiveTool(toolId),
				};
			}),
		[activeTool, shapeKind],
	);
	const iPadCommandActions = useMemo((): readonly IpadCommandAction[] => {
		const hasNodeSelection = selection.nodeIds.length > 0;
		const hasIpadSelection =
			hasNodeSelection || selection.selectedArtboardId !== null;
		const actions: IpadCommandAction[] = IPAD_AUTHORING_TOOLS.map((toolId) => {
			const tool = getEditorTool(toolId);
			const shapeVariant =
				toolId === "shape" ? shapeToolVariant(shapeKind) : null;
			return {
				id: `tool-${toolId}`,
				label: tool.label,
				title: shapeVariant
					? `Switch to Shape - ${shapeVariant.label}`
					: `Switch to ${tool.label}`,
				IconComponent: shapeVariant?.Icon ?? tool.Icon,
				active: activeTool === toolId,
				onClick: () => useToolSelectionStore.getState().setActiveTool(toolId),
			};
		});

		actions.push(
			...SHAPE_TOOL_VARIANTS.map(
				(variant): IpadCommandAction => ({
					id: `shape-${variant.kind}`,
					label: variant.label,
					title: `Draw ${variant.label}`,
					IconComponent: variant.Icon,
					active: activeTool === "shape" && shapeKind === variant.kind,
					onClick: () => {
						setShapeKind(variant.kind);
						useToolSelectionStore.getState().setActiveTool("shape");
					},
				}),
			),
		);

		actions.push(
			{
				id: "undo",
				label: "Undo",
				title: "Undo",
				IconComponent: ArrowCounterClockwise,
				enabled: canUndo,
				onClick: () => {
					globalUndo();
					performIpadPencilFeedback("undo");
				},
			},
			{
				id: "redo",
				label: "Redo",
				title: "Redo",
				IconComponent: ArrowClockwise,
				enabled: canRedo,
				onClick: () => {
					globalRedo();
					performIpadPencilFeedback("redo");
				},
			},
		);

		actions.push({
			id: "fit",
			label: hasIpadSelection ? "Fit selection" : "Fit artboard",
			title: hasIpadSelection ? "Fit selection" : "Fit current artboard",
			IconComponent: BoundingBox,
			onClick: fitCurrentSelectionForIpad,
		});

		if (hasNodeSelection) {
			actions.push(
				...quickActions,
				{
					id: "appearance",
					label: "Style",
					title: "Open compact appearance controls",
					IconComponent: Palette,
					onClick: openIpadStyleControls,
				},
				{
					id: "bring-forward",
					label: "Forward",
					title: "Bring forward",
					IconComponent: ArrowLineUp,
					onClick: () =>
						commitArrangeNodes([...selection.nodeIds], {
							kind: "z-order",
							direction: "forward",
						}),
				},
				{
					id: "send-backward",
					label: "Backward",
					title: "Send backward",
					IconComponent: ArrowLineDown,
					onClick: () =>
						commitArrangeNodes([...selection.nodeIds], {
							kind: "z-order",
							direction: "backward",
						}),
				},
				{
					id: "toggle-lock",
					label: "Lock",
					title: "Lock or unlock selected objects",
					IconComponent: Lock,
					onClick: () => commitToggleNodeLocked([...selection.nodeIds]),
				},
				{
					id: "toggle-hide",
					label: "Hide",
					title: "Show or hide selected objects",
					IconComponent: EyeSlash,
					onClick: () => commitToggleNodeVisibility([...selection.nodeIds]),
				},
				{
					id: "delete",
					label: "Delete",
					title: "Delete selected objects",
					IconComponent: Trash,
					danger: true,
					onClick: deleteIpadSelection,
				},
			);
		} else if (selection.selectedArtboardId !== null) {
			actions.push({
				id: "delete",
				label: "Delete",
				title: "Delete selected artboard",
				IconComponent: Trash,
				danger: true,
				onClick: deleteIpadSelection,
			});
		} else {
			actions.push(
				{
					id: "timeline",
					label: "Timeline",
					title: "Timeline",
					IconComponent: FilmStrip,
					active: timelineOpen,
					onClick: toggleIpadTimeline,
				},
				{
					id: "recovery",
					label: "Recover",
					title: "Cloud recovery",
					IconComponent: ClockCounterClockwise,
					onClick: openIpadCloudRecovery,
				},
				{
					id: "clear-cache",
					label: "Cache",
					title: "Clear derived cache",
					IconComponent: StackSimple,
					onClick: clearIpadDerivedCache,
				},
				{
					id: "open-backup",
					label: "Open",
					title: "Open a Vecmo backup",
					IconComponent: ArrowLineDown,
					enabled: iPadAuthoringSurface.bridgeAvailable,
					onClick: openIpadProjectBackup,
				},
				{
					id: "share-backup",
					label: "Share",
					title: "Share a Vecmo backup",
					IconComponent: ArrowLineUp,
					enabled: iPadAuthoringSurface.bridgeAvailable,
					onClick: shareIpadProjectBackup,
				},
			);
		}

		return actions;
	}, [
		activeTool,
		canRedo,
		canUndo,
		clearIpadDerivedCache,
		deleteIpadSelection,
		fitCurrentSelectionForIpad,
		iPadAuthoringSurface.bridgeAvailable,
		openIpadStyleControls,
		openIpadCloudRecovery,
		openIpadProjectBackup,
		performIpadPencilFeedback,
		quickActions,
		selection.nodeIds,
		selection.selectedArtboardId,
		shareIpadProjectBackup,
		shapeKind,
		setShapeKind,
		timelineOpen,
		toggleIpadTimeline,
	]);
	const canvasMenuGroups = useMemo((): readonly ContextMenuGroup[] => {
		// Always-present View group: right-clicking the canvas — including empty
		// canvas, where there is nothing selected but the grid is exactly what the
		// user wants gone — is the discoverable, no-⌘K path to hide/show the grid.
		// ContextMenu items carry no checked state, so the label flips instead.
		const gridShowing = workspaceGridVisible || gridVisible;
		const viewGroup: ContextMenuGroup = {
			id: "view",
			items: [
				{
					id: "toggle-grid",
					label: gridShowing ? "Hide grid" : "Show grid",
					icon: GridFour,
					onSelect: () => useGuideStore.getState().toggleGridGroup(),
				},
			],
		};
		if (selectedNodeIds.length === 0) return [viewGroup];
		const groups: ContextMenuGroup[] = [];
		if (quickActions.length > 0) {
			groups.push({
				id: "actions",
				items: quickActions.map((action) => ({
					id: action.id,
					label: action.label,
					icon: action.IconComponent,
					onSelect: action.onClick,
				})),
			});
		}
		// The pinned 14-button strip was retired in favour of the selection float;
		// the common long-tail verbs (z-order, lock, hide) live here so they stay
		// mouse-discoverable. The full set, incl. frame/mask/focus, is in ⌘K.
		groups.push({
			id: "arrange-layer",
			items: [
				{
					id: "bring-forward",
					label: "Bring forward",
					icon: ArrowLineUp,
					onSelect: () =>
						commitArrangeNodes([...selectedNodeIds], {
							kind: "z-order",
							direction: "forward",
						}),
				},
				{
					id: "send-backward",
					label: "Send backward",
					icon: ArrowLineDown,
					onSelect: () =>
						commitArrangeNodes([...selectedNodeIds], {
							kind: "z-order",
							direction: "backward",
						}),
				},
				{
					id: "toggle-lock",
					label: "Lock / unlock",
					icon: Lock,
					onSelect: () => commitToggleNodeLocked([...selectedNodeIds]),
				},
				{
					id: "toggle-hide",
					label: "Show / hide",
					icon: EyeSlash,
					onSelect: () => commitToggleNodeVisibility([...selectedNodeIds]),
				},
			],
		});
		const transformAgainEnabled = canApplyRepeatTransformWorkflow(
			sceneDocument,
			selectedNodeIds,
			repeatTransformPlan,
		);
		groups.push({
			id: "transform",
			items: [
				{
					id: "transform-again",
					label: "Transform again",
					icon: ArrowClockwise,
					disabled: !transformAgainEnabled,
					onSelect: () =>
						applyRepeatTransformWorkflow(repeatTransformPlan, selectedNodeIds),
				},
				{
					id: "reset-bounding-box",
					label: "Reset Bounding Box",
					icon: BoundingBox,
					onSelect: () =>
						useTransformUiStore
							.getState()
							.resetToAxisAligned([...selectedNodeIds]),
				},
			],
		});
		groups.push({
			id: "danger",
			items: [
				{
					id: "delete",
					label: "Delete",
					icon: Trash,
					danger: true,
					onSelect: () =>
						applyCommandAndSelect(
							createDeleteNodesCommand([...selectedNodeIds]),
							[],
						),
				},
			],
		});
		// Object actions stay primary; the global grid toggle trails at the end.
		groups.push(viewGroup);
		return groups;
	}, [
		applyCommandAndSelect,
		gridVisible,
		quickActions,
		repeatTransformPlan,
		sceneDocument,
		selectedNodeIds,
		workspaceGridVisible,
	]);
	const resolveLayoutInteractionDocument = useCallback((): SceneDocument => {
		const source = useSceneStore.getState().document;
		if (source === sceneDocument) return layoutInteractionDocument;
		const cached = layoutInteractionCacheRef.current;
		if (cached.source === source) return cached.document;
		const document = materializeLayoutFramesForPresentation(source);
		layoutInteractionCacheRef.current = { source, document };
		return document;
	}, [layoutInteractionDocument, sceneDocument]);
	const contextMenuTargetNodeId = (
		svg: SVGSVGElement,
		clientX: number,
		clientY: number,
	): string | null => {
		const interactionDocument = resolveLayoutInteractionDocument();
		const interactionArtboards = selectAllArtboards(interactionDocument);
		const interactionArtboardBounds =
			selectAllArtboardBounds(interactionDocument);
		const interactionCurrentArtboard =
			selectCurrentArtboard(interactionDocument);
		const interactionNodeArtboards =
			selectNodeArtboardMapping(interactionDocument);
		const pasteboardPoint = screenPointToPasteboard(
			svg.getBoundingClientRect(),
			clientX,
			clientY,
			camera,
		);
		const artboard = resolveArtboardAtPoint(
			interactionArtboards,
			interactionArtboardBounds,
			pasteboardPoint,
			interactionCurrentArtboard.id,
		);
		const point = toArtboardPoint(pasteboardPoint, artboard);
		const targetDocument = documentForArtboard(
			interactionDocument,
			artboard,
			interactionNodeArtboards.byNodeId,
		);
		return hitNodeIds(targetDocument, point)[0] ?? null;
	};
	const pointerContextFor = useCallback(
		(
			svg: SVGSVGElement,
			event: ReactPointerEvent<SVGSVGElement>,
		): {
			readonly point: Vec2;
			readonly pasteboardPoint: Vec2;
			readonly hitNodeId: string | null;
			readonly hitStackNodeIds: readonly string[];
			readonly document: SceneDocument;
			readonly artboardId: string;
			readonly runtime3dHitResolved: boolean;
		} => {
			const interactionDocument = resolveLayoutInteractionDocument();
			const interactionArtboards = selectAllArtboards(interactionDocument);
			const interactionArtboardBounds =
				selectAllArtboardBounds(interactionDocument);
			const interactionCurrentArtboard =
				selectCurrentArtboard(interactionDocument);
			const interactionNodeArtboards =
				selectNodeArtboardMapping(interactionDocument);
			// Reuse the rect cached for this pointer's gesture (seeded on pointerdown)
			// instead of forcing layout on every move; outside a gesture (plain hover,
			// or a stale/mismatched pointerId) fall back to a direct, fresh read.
			const cachedRect = stageRectRef.current;
			const stageRect =
				cachedRect && cachedRect.pointerId === event.pointerId
					? cachedRect.rect
					: svg.getBoundingClientRect();
			const pasteboardPoint = screenPointToPasteboard(
				stageRect,
				event.clientX,
				event.clientY,
				camera,
			);
			const lockedArtboard = pointerArtboardIdRef.current
				? artboardById(interactionArtboards, pointerArtboardIdRef.current)
				: undefined;
			const artboard =
				lockedArtboard ??
				resolveArtboardAtPoint(
					interactionArtboards,
					interactionArtboardBounds,
					pasteboardPoint,
					interactionCurrentArtboard.id,
				);
			const point = toArtboardPoint(pasteboardPoint, artboard);
			const document = documentForArtboard(
				interactionDocument,
				artboard,
				interactionNodeArtboards.byNodeId,
			);
			// Hit-testing is O(nodes) (spatial-index build + exact geometry checks per
			// candidate), so it stays behind a lazily-evaluated, memoized getter: tools
			// that never read `hitNodeId`/`hitStackNodeIds` on a pointermove (shape,
			// pen, pencil drags) skip the hit test entirely, while callers that do read
			// it (select tool, deep-select cycling) still pay for exactly one hit test
			// per call, same as before.
			let hitStackMemo: readonly string[] | undefined;
			const resolveHitStack = (): readonly string[] => {
				if (hitStackMemo === undefined)
					hitStackMemo = hitNodeIds(document, point);
				return hitStackMemo;
			};
			return {
				point,
				pasteboardPoint,
				get hitNodeId() {
					return resolveHitStack()[0] ?? null;
				},
				get hitStackNodeIds() {
					return resolveHitStack();
				},
				document,
				artboardId: artboard.id,
				runtime3dHitResolved: false,
			};
		},
		[camera, resolveLayoutInteractionDocument],
	);
	/**
	 * Front-run membership for PICKING, derived from the durable scene document
	 * (not the sampled presentation) because hit-testing runs against the
	 * interaction document. Empty for every document without a 3D band, which
	 * keeps `resolveRuntime3dPointerContext` byte-identical to its pre-S3c
	 * behaviour there.
	 */
	const compositeFrontRunNodeIds = useMemo(
		() =>
			frontRunNodeIds(sceneDocument, buildSceneCompositePlan(sceneDocument)),
		[sceneDocument],
	);
	const resolveRuntime3dPointerContext = useCallback(
		(
			context: ReturnType<typeof pointerContextFor>,
			clientX: number,
			clientY: number,
		): ReturnType<typeof pointerContextFor> => {
			const outcome = runtime3dPickerRef.current?.(clientX, clientY);
			if (!outcome || outcome.artboardId !== context.artboardId) return context;
			const nonRuntimeHitStack = context.hitStackNodeIds.filter(
				(nodeId) => !isRuntime3dModelNode(context.document, nodeId),
			);
			if (outcome.kind === "miss") {
				return {
					...context,
					hitNodeId: nonRuntimeHitStack[0] ?? null,
					hitStackNodeIds: nonRuntimeHitStack,
					runtime3dHitResolved: true,
				};
			}
			const pickedNode = findNode(context.document, outcome.nodeId);
			if (!pickedNode?.visible || pickedNode.locked) return context;
			// 経路A: the front run is genuinely painted ABOVE the 3D band, so a mesh
			// hit must NOT be promoted over front-run content the author can see on
			// top of it. Front-run hits keep their geometric order ahead of the
			// picked mesh; everything else stays behind it exactly as before.
			const frontHits = nonRuntimeHitStack.filter((nodeId) =>
				compositeFrontRunNodeIds.has(nodeId),
			);
			const hitStackNodeIds = [
				...frontHits,
				outcome.nodeId,
				...nonRuntimeHitStack.filter(
					(nodeId) =>
						nodeId !== outcome.nodeId && !compositeFrontRunNodeIds.has(nodeId),
				),
			];
			return {
				...context,
				hitNodeId: hitStackNodeIds[0] ?? outcome.nodeId,
				hitStackNodeIds,
				runtime3dHitResolved: true,
			};
		},
		[compositeFrontRunNodeIds],
	);
	/**
	 * Wraps a `pointerContextFor` result into the `CanvasPointerContext` shape a
	 * tool handler receives, forwarding (not eagerly reading) the lazy hit-test
	 * getters so a handler that never touches `hitNodeId`/`hitStackNodeIds`
	 * (shape/pen/pencil drags) never triggers the underlying O(nodes) hit test.
	 */
	const toHandlerPointerContext = useCallback(
		(
			context: ReturnType<typeof pointerContextFor>,
			event: PointerEvent,
		): CanvasPointerContext => ({
			point: context.point,
			pasteboardPoint: context.pasteboardPoint,
			artboardId: context.artboardId,
			get hitNodeId() {
				return context.hitNodeId;
			},
			get hitStackNodeIds() {
				return context.hitStackNodeIds;
			},
			runtime3dHitResolved: context.runtime3dHitResolved,
			event,
		}),
		[],
	);

	const tryStartSceneCameraHandleDrag = useCallback(
		(
			context: ReturnType<typeof pointerContextFor>,
			event: ReactPointerEvent<SVGSVGElement>,
		): boolean => {
			if (activeTool !== "select" && activeTool !== "direct-select") {
				return false;
			}
			const hit = hitSceneCameraCanvasHandle({
				document: context.document,
				artboardId: context.artboardId,
				selection,
				point: context.point,
				zoom: viewport.zoom,
			});
			if (!hit) return false;
			const start = createSceneCameraCanvasHandleDragStart({
				document: context.document,
				hit,
				point: context.point,
			});
			if (!start) return false;
			const selectionKind =
				hit.role === "target" ||
				hit.role === "target-depth" ||
				hit.role === "focus"
					? "camera-target"
					: hit.role === "aperture"
						? "camera-rig"
						: "camera-body";
			useSelectionStore.getState().selectSceneCamera({
				kind: selectionKind,
				cameraRigId: hit.cameraRigId,
			});
			sceneCameraHandleDragRef.current = {
				pointerId: event.pointerId,
				hit,
				start,
			};
			setSceneCameraHandleHud(
				sceneCameraCanvasHandleDragHud({
					hit,
					point: context.point,
					start,
				}),
			);
			activePointerIdRef.current = event.pointerId;
			pointerArtboardIdRef.current = context.artboardId;
			pointerGestureHandlerRef.current = undefined;
			safelyCapturePointer(event.currentTarget, event.pointerId);
			return true;
		},
		[activeTool, selection, viewport.zoom],
	);

	const updateSceneCameraHandleDrag = useCallback(
		(
			context: ReturnType<typeof pointerContextFor>,
			drag: SceneCameraHandleDrag,
			event: ReactPointerEvent<SVGSVGElement>,
		): void => {
			const modifiers = {
				altKey: event.altKey,
				ctrlKey: event.ctrlKey,
				metaKey: event.metaKey,
				shiftKey: event.shiftKey,
			};
			const plan = createSceneCameraCanvasHandleDragPlan({
				document: context.document,
				hit: drag.hit,
				modifiers,
				point: context.point,
				start: drag.start,
			});
			if (!plan) return;
			setSceneCameraHandleHud(
				sceneCameraCanvasHandleDragHud({
					hit: drag.hit,
					modifiers,
					point: context.point,
					start: drag.start,
				}),
			);
			commitSceneCameraAuthoringPlan(plan);
		},
		[],
	);

	const stagePointerRoutingRef = useRef({
		allowTouchFreehand,
		performing,
		pointerContextFor,
		resolveLayoutInteractionDocument,
		selection,
		toHandlerPointerContext,
		viewport,
	});

	useEffect(() => {
		stagePointerRoutingRef.current = {
			allowTouchFreehand,
			performing,
			pointerContextFor,
			resolveLayoutInteractionDocument,
			selection,
			toHandlerPointerContext,
			viewport,
		};
	}, [
		allowTouchFreehand,
		performing,
		pointerContextFor,
		resolveLayoutInteractionDocument,
		selection,
		toHandlerPointerContext,
		viewport,
	]);

	useEffect(() => {
		const clearStagePointerGesture = (pointerId: number) => {
			const svg = stageSvgRef.current;
			if (svg) safelyReleasePointer(svg, pointerId);
			pointerGestureHandlerRef.current = undefined;
			iPadPerfCaptureRef.current?.setActiveGesture(null);
			pointerArtboardIdRef.current = null;
			activePointerIdRef.current = null;
			stageRectRef.current = null;
		};

		const onWindowPointerUp = (event: PointerEvent) => {
			if (activePointerIdRef.current !== event.pointerId) return;
			if (viewportPanGestureRef.current?.pointerId === event.pointerId) return;
			const svg = stageSvgRef.current;
			if (!svg) {
				clearStagePointerGesture(event.pointerId);
				return;
			}

			const externalDrag = externalLayoutMoveDragRef.current;
			if (externalDrag?.pointerId === event.pointerId) {
				const routing = stagePointerRoutingRef.current;
				const context = routing.pointerContextFor(
					svg,
					event as unknown as ReactPointerEvent<SVGSVGElement>,
				);
				commitExternalLayoutMoveDrag(
					routing.resolveLayoutInteractionDocument(),
					externalDrag,
					context.point,
					useSelectionStore.getState().nodeIds,
				);
				externalLayoutMoveDragRef.current = null;
				setExternalLayoutMovePreview(null);
				clearStagePointerGesture(event.pointerId);
				return;
			}

			const routing = stagePointerRoutingRef.current;
			const context = routing.pointerContextFor(
				svg,
				event as unknown as ReactPointerEvent<SVGSVGElement>,
			);
			const eventApi = buildHandlerApi(
				routing.selection,
				routing.viewport,
				context.document,
				{
					allowTouchFreehand: routing.allowTouchFreehand,
					isPerforming: routing.performing,
				},
			);
			pointerGestureHandlerRef.current?.onPointerUp?.(
				routing.toHandlerPointerContext(context, event),
				eventApi,
			);
			clearStagePointerGesture(event.pointerId);
		};

		const onWindowPointerCancel = (event: PointerEvent) => {
			if (activePointerIdRef.current !== event.pointerId) return;
			if (viewportPanGestureRef.current?.pointerId === event.pointerId) return;
			if (externalLayoutMoveDragRef.current?.pointerId === event.pointerId) {
				externalLayoutMoveDragRef.current = null;
				setExternalLayoutMovePreview(null);
			} else {
				(
					pointerGestureHandlerRef.current ?? activeHandlerRef.current
				)?.onDeactivate?.(latestHandlerApiRef.current);
				useSceneStore.getState().commit();
			}
			clearStagePointerGesture(event.pointerId);
		};

		window.addEventListener("pointerup", onWindowPointerUp);
		window.addEventListener("pointercancel", onWindowPointerCancel);
		return () => {
			window.removeEventListener("pointerup", onWindowPointerUp);
			window.removeEventListener("pointercancel", onWindowPointerCancel);
		};
	}, []);

	useEffect(() => {
		postNativeBridgeMessage({
			kind: "set-pencil-capture",
			enabled: activeTool === "pencil",
		});
	}, [activeTool]);

	useEffect(() => {
		const nativePencilSessions = nativePencilSessionsRef.current;
		if (!nativePencilSessions) return;
		const nativePencilFinalizeTimers = nativePencilFinalizeTimersRef.current;

		const clearNativePencilFinalizeTimer = (strokeId: string) => {
			const timer = nativePencilFinalizeTimers.get(strokeId);
			if (timer === undefined) return;
			window.clearTimeout(timer);
			nativePencilFinalizeTimers.delete(strokeId);
		};

		const nativeSampleToArtboardPoint = (
			sample: NativePencilSample,
			rect: DOMRect,
			cameraSnapshot: Camera,
			artboard: NormalizedArtboard,
		): Vec2 => {
			const pasteboardPoint = screenPointToPasteboard(
				rect,
				sample.x,
				sample.y,
				cameraSnapshot,
			);
			return toArtboardPoint(pasteboardPoint, artboard);
		};

		const commitFinalizedNativeStroke = ({
			artboard,
			cameraSnapshot,
			rect,
			strokeId,
		}: {
			readonly artboard: NormalizedArtboard;
			readonly cameraSnapshot: Camera;
			readonly rect: DOMRect;
			readonly strokeId: string;
		}) => {
			nativePencilFinalizeTimers.delete(strokeId);
			const finalized = nativePencilSessions.finalize(strokeId);
			if (!finalized || finalized.samples.length === 0) return;
			const points = nativeSamplesToFreehandPoints(
				finalized.samples,
				(sample) =>
					nativeSampleToArtboardPoint(sample, rect, cameraSnapshot, artboard),
			);
			const result = commitFreehandStroke({
				points,
				recognizeQuickLine: nativePencilSamplesEndWithQuickShapeHold(
					finalized.samples,
				),
				viewportZoom: useViewportStore.getState().zoom,
				selectNode,
			});
			// Build the transient stroke intent from the native samples' full signal
			// (timing/tilt/roll) after the commit, mirroring the browser path so both
			// shells feed the same analysis without changing the committed node.
			if (result.kind === "inserted") {
				useStrokeIntentStore.getState().setLastIntent(
					buildPencilStrokeIntent({
						id: result.nodeId,
						source: "native-pencil",
						samples: nativeSamplesToIntentSamples(finalized.samples, (sample) =>
							nativeSampleToArtboardPoint(
								sample,
								rect,
								cameraSnapshot,
								artboard,
							),
						),
					}),
				);
			}
			if (result.kind === "inserted" && result.quickShape) {
				postNativeBridgeMessage({
					kind: "perform-pencil-feedback",
					feedback: "success",
				});
			}
		};

		const handleNativeMessage = (event: Event) => {
			if (!(event instanceof CustomEvent)) return;
			const message = event.detail;
			if (isNativeHostReadyMessage(message)) {
				setIpadNativeStatus((previous) =>
					previous.hostReady ? previous : { ...previous, hostReady: true },
				);
				return;
			}
			if (isNativeWebCapabilityProbeMessage(message)) {
				setIpadNativeStatus((previous) => ({
					...previous,
					capabilityProbe: message,
				}));
				return;
			}
			if (isNativePencilSqueezeMessage(message)) {
				setIpadNativeStatus((previous) =>
					previous.squeezeSeen ? previous : { ...previous, squeezeSeen: true },
				);
				if (!shouldOpenIpadSqueezePalette(message.phase)) return;
				performIpadPencilFeedback("palette-open");
				openIpadQuickMenuAt(
					message.hoverPose
						? { x: message.hoverPose.x, y: message.hoverPose.y }
						: { x: viewportSize.width / 2, y: viewportSize.height / 2 },
					"squeeze",
					{
						phase: message.phase,
						preferredAction: message.preferredAction,
						rollAngle: message.hoverPose?.rollAngle ?? null,
					},
				);
				return;
			}
			if (isNativePencilDoubleTapMessage(message)) {
				const preferredAction = message.preferredAction.toLowerCase();
				if (
					preferredAction.includes("palette") &&
					useSelectionStore.getState().nodeIds.length > 0
				) {
					openIpadStyleControls();
					return;
				}
				const toolStore = useToolSelectionStore.getState();
				const nextTool =
					toolStore.activeTool === "pencil" ? "select" : "pencil";
				toolStore.setActiveTool(nextTool);
				performIpadPencilFeedback("selection");
				showIpadQuickbarNotice(
					{
						tone: "neutral",
						label: getEditorTool(nextTool).label,
						detail: `Apple Pencil double tap switched to ${getEditorTool(nextTool).label}.`,
					},
					1_600,
				);
				return;
			}
			if (isNativeProjectBackupOpenedMessage(message)) {
				restoreIpadProjectBackup(message.fileName, message.contents);
				return;
			}
			if (isNativeProjectBackupOpenFailedMessage(message)) {
				showIpadQuickbarNotice({
					tone: "danger",
					label: "Open failed",
					detail: `Backup could not open: ${message.reason}`,
				});
				return;
			}
			if (isNativeProjectBackupOpenCancelledMessage(message)) {
				showIpadQuickbarNotice({
					tone: "neutral",
					label: "Open cancelled",
					detail: "No backup file was selected.",
				});
				return;
			}
			if (isNativeProjectBackupShareReadyMessage(message)) {
				showIpadQuickbarNotice({
					tone: "success",
					label: "Share sheet ready",
					detail: `${message.fileName} is ready in the native share sheet.`,
				});
				return;
			}
			if (isNativeProjectBackupShareFailedMessage(message)) {
				showIpadQuickbarNotice({
					tone: "danger",
					label: "Share failed",
					detail: `Backup could not be shared: ${message.reason}`,
				});
				return;
			}
			if (!isNativePencilStrokeMessage(message)) return;

			if (message.phase === "cancelled") {
				clearNativePencilFinalizeTimer(message.strokeId);
				nativePencilSessions.apply(message);
				return;
			}

			const isPencilToolActive =
				useToolSelectionStore.getState().activeTool === "pencil";
			if (
				!isPencilToolActive &&
				(message.phase === "began" ||
					!nativePencilSessions.has(message.strokeId))
			) {
				clearNativePencilFinalizeTimer(message.strokeId);
				nativePencilSessions.cancel(message.strokeId);
				return;
			}

			const update = nativePencilSessions.apply(message);
			if (update.kind !== "finalizing") return;

			const svg = stageSvgRef.current;
			const firstSample = message.samples[0];
			if (!svg || !firstSample) {
				nativePencilSessions.cancel(message.strokeId);
				clearNativePencilFinalizeTimer(message.strokeId);
				return;
			}

			const rect = svg.getBoundingClientRect();
			const cameraSnapshot = camera;
			const interactionDocument = resolveLayoutInteractionDocument();
			const artboards = selectAllArtboards(interactionDocument);
			const artboardBounds = selectAllArtboardBounds(interactionDocument);
			const currentArtboard = selectCurrentArtboard(interactionDocument);
			const firstPasteboardPoint = screenPointToPasteboard(
				rect,
				firstSample.x,
				firstSample.y,
				cameraSnapshot,
			);
			const artboard = resolveArtboardAtPoint(
				artboards,
				artboardBounds,
				firstPasteboardPoint,
				currentArtboard.id,
			);
			clearNativePencilFinalizeTimer(message.strokeId);
			const timer = window.setTimeout(
				() =>
					commitFinalizedNativeStroke({
						artboard,
						cameraSnapshot,
						rect,
						strokeId: message.strokeId,
					}),
				update.delayMs,
			);
			nativePencilFinalizeTimers.set(message.strokeId, timer);
		};

		window.addEventListener("vma:native-message", handleNativeMessage);
		if (!nativeCapabilityProbeRequestedRef.current) {
			nativeCapabilityProbeRequestedRef.current = true;
			postWebCapabilityProbe();
		}
		return () => {
			window.removeEventListener("vma:native-message", handleNativeMessage);
		};
	}, [
		camera,
		openIpadStyleControls,
		openIpadQuickMenuAt,
		performIpadPencilFeedback,
		resolveLayoutInteractionDocument,
		restoreIpadProjectBackup,
		selectNode,
		showIpadQuickbarNotice,
		viewportSize.height,
		viewportSize.width,
	]);
	/**
	 * Preview-interactions pointer wiring (Interactive Motion program, T3-S4).
	 * While `interactionPreview` is on, the canvas SVG's own pointer handlers
	 * route here INSTEAD OF tool routing/hit-selection — every one of the three
	 * functions below returns `true` when it has fully handled the event (the
	 * caller must return immediately, never falling through to the ordinary
	 * tool-handler dispatch) and `false` when preview is off (so the caller's
	 * normal path runs unchanged). This is the "overlay swallows pointer
	 * events" mechanism: there is no separate DOM overlay element, the SAME SVG
	 * root's own handlers gate on `interactionPreview` before doing anything
	 * tool-related, reusing `pointerContextFor`'s existing artboard-local point
	 * resolution + hit test rather than a second hit-testing path.
	 */
	const handleInteractionPreviewPointerDown = (
		event: ReactPointerEvent<SVGSVGElement>,
	): boolean => {
		if (!interactionPreview) return false;
		event.preventDefault();
		interactionPreviewGestureRef.current = {
			pointerId: event.pointerId,
			originX: event.clientX,
			originY: event.clientY,
		};
		return true;
	};
	/**
	 * Hover-in/out dispatch on move: fires a `hover-out` for the PREVIOUSLY
	 * hovered node (or the bare-canvas hover) the moment the hit target
	 * changes, then a `hover-in` for the new one — a node-scoped pair for a
	 * real hit, PLUS a component-level pair (`nodeId` omitted) on every
	 * hit-or-miss change, matching the task's "component-level triggers (no
	 * nodeId) fire on any hit-or-miss within the current artboard" contract.
	 * A `null` hit still updates `interactionPreviewHoverRef` (to `null`) so
	 * moving from one node to bare canvas correctly fires that node's
	 * `hover-out`.
	 */
	const handleInteractionPreviewPointerMove = (
		context: ReturnType<typeof pointerContextFor>,
		event: ReactPointerEvent<SVGSVGElement>,
	): boolean => {
		if (!interactionPreview) return false;
		const root = event.currentTarget;
		const hitNodeId = context.hitNodeId;
		const previousHitNodeId = interactionPreviewHoverRef.current;
		if (hitNodeId !== previousHitNodeId) {
			if (previousHitNodeId) {
				dispatchActiveInteractionPreviewEvent(
					{ kind: "hover-out", nodeId: previousHitNodeId },
					root,
				);
			}
			dispatchActiveInteractionPreviewEvent({ kind: "hover-out" }, root);
			interactionPreviewHoverRef.current = hitNodeId;
			if (hitNodeId) {
				dispatchActiveInteractionPreviewEvent(
					{ kind: "hover-in", nodeId: hitNodeId },
					root,
				);
			}
			dispatchActiveInteractionPreviewEvent({ kind: "hover-in" }, root);
		}
		return true;
	};
	/**
	 * Click dispatch on release: a plain click (no drag past the threshold)
	 * fires a node-scoped `click` when the release still hits the SAME node the
	 * gesture started movement tracking on (re-hit-tested at the release
	 * point, matching ordinary click semantics elsewhere in this file — see
	 * `onLanePointerDown`-style `movedPx` checks), PLUS a component-level
	 * `click` unconditionally for any click-classified release inside the
	 * artboard (hit or miss). A drag past the threshold fires neither — preview
	 * mode has no marquee/pan gesture of its own to distinguish, so a "drag"
	 * here just means "not a click," consistent with the select tool's own
	 * click-vs-drag distinction.
	 */
	const handleInteractionPreviewPointerUp = (
		context: ReturnType<typeof pointerContextFor>,
		event: ReactPointerEvent<SVGSVGElement>,
	): boolean => {
		if (!interactionPreview) return false;
		const gesture = interactionPreviewGestureRef.current;
		interactionPreviewGestureRef.current = null;
		if (!gesture || gesture.pointerId !== event.pointerId) return true;
		const movedPx = Math.hypot(
			event.clientX - gesture.originX,
			event.clientY - gesture.originY,
		);
		if (movedPx >= INTERACTION_PREVIEW_CLICK_THRESHOLD_PX) return true;
		const root = event.currentTarget;
		const hitNodeId = context.hitNodeId;
		if (hitNodeId) {
			dispatchActiveInteractionPreviewEvent(
				{ kind: "click", nodeId: hitNodeId },
				root,
			);
		}
		dispatchActiveInteractionPreviewEvent({ kind: "click" }, root);
		return true;
	};
	const selectDeepHit = (
		context: ReturnType<typeof pointerContextFor>,
		event: ReactPointerEvent<SVGSVGElement>,
	): boolean => {
		if (activeTool !== "select" || !isDeepSelectionModifier(event)) {
			deepSelectionCycleRef.current = null;
			return false;
		}

		const previous = deepSelectionCycleRef.current;
		const cycleFromCurrent =
			previous &&
			previous.artboardId === context.artboardId &&
			sameNodeIdStack(previous.nodeIds, context.hitStackNodeIds) &&
			Math.hypot(
				previous.point.x - context.point.x,
				previous.point.y - context.point.y,
			) *
				scale <=
				DEEP_SELECT_CYCLE_RADIUS_PX;
		const targetNodeId = canvasDeepSelectionTargetId(
			context.document,
			context.hitStackNodeIds,
			{
				currentNodeId: cycleFromCurrent ? selection.primary : null,
			},
		);
		if (!targetNodeId) return false;

		event.preventDefault();
		selectNode(targetNodeId, event.shiftKey);
		deepSelectionCycleRef.current = {
			artboardId: context.artboardId,
			point: context.point,
			nodeIds: context.hitStackNodeIds,
		};
		return true;
	};
	// Per-artboard render tree (frame-look intents, matte maps, filter/mask
	// plans, per-node painting). None of it depends on pan: pan is already
	// absorbed by the world `<g transform>` this content renders under, so a
	// pan tick leaves every dependency below referentially unchanged and this
	// memo bails out. `scale` is the one genuine viewport input read directly
	// in here (screen-space sizing for the selection chrome); `cullVisibleRect`
	// only varies with the viewport for large documents, and is itself snapped
	// outward to a quantized grid (see `quantizeCullingRect` in culling.ts) so
	// small pans/zooms do not invalidate this memo either.
	/**
	 * Artboard composite plan V1 (経路A). Owned by the Scene entity so the canvas
	 * and every export adapter partition identically; `hasFrontRun` is false for
	 * every document without a linked 3D band, and that case renders exactly the
	 * DOM this component rendered before S3c.
	 */
	const compositePlan = useMemo(
		() => buildSceneCompositePlan(presentationDocument),
		[presentationDocument],
	);
	/**
	 * Builds one artboard content run. `"all"` is the pre-S3c single-pass render.
	 * `"back"`/`"front"` split the same machinery at top-level nodes so the
	 * Babylon overlay can sit between them: the back run keeps every piece of
	 * artboard chrome, and the front run carries content only.
	 */
	const buildArtboardContentNodes = useCallback(
		(run: CompositeRun | "all") =>
			presentationArtboards.map((artboard, artboardIndex) => {
				const sourceOpticsPresentation = buildSourceOpticsPresentation(
					presentationDocument,
					artboard.id,
					"editor-svg",
				);
				// Viewport culling (large docs only): only render nodes whose
				// painted bounds reach the visible pasteboard rect, shifted into
				// this artboard's local space. `cullVisibleRect` is null below the
				// node-count threshold, so small docs render every node unchanged.
				const artboardCullRect = cullVisibleRect
					? rectForArtboard(cullVisibleRect, artboard.position)
					: null;
				const artboardGridLines = artboardGridLinesById.get(artboard.id) ?? [];
				const lookPlan = buildArtboardLookPlan({
					artboard,
					artboardIndex,
					document: presentationDocument,
					nodeArtboardIds: presentationNodeArtboards.byNodeId,
					maskPlan,
					frameLookGraphFilterSpec:
						explicitFrameLookGraphFilterSpecs.get(artboard.id) ?? null,
				});
				const {
					artboardGridClipId,
					frameLookGraphFilterSpec,
					frameLookMatte,
					frameInfluenceMaskPlan,
					effectInfluenceRecipe,
					frameGrainParams,
					frameGrainFilterId,
					frameCaParams,
					frameCaFilterId,
					contentFilterIds,
					scopedInfluenceMaskPlan,
					scopedGrainParams,
					scopedGrainFilterId,
					scopedCaParams,
					scopedCaFilterId,
					scopedCaPadding,
					scopedFilterIds,
					scopedLookMaskId,
					scopedLookRegion,
					frameLookSelectionNodeIds,
					frameLookUsesSelectionNodes,
					artboardContentFilterIds,
					filmActive,
					frameLookMaskId,
					frameLookRegion,
					frameLookBaseExcludedNodeIds,
					maskDefs,
				} = lookPlan;
				// The artboard grid is editor chrome, not artwork. When a film
				// look filters the artboard content, or a scoped selection look
				// paints an opaque overlay rect, the grid must render UNFILTERED
				// above the composite (like the desk grid and guides) instead of
				// inside the filter — otherwise it is grained, chromatically
				// fringed, or occluded by the look's opaque background fill.
				const scopedLookGraphContext: ScopedLookGraphCanvasContext = {
					artboardId: artboard.id,
					targets: scopedLookGraphOverlayTargetMap(
						scopedLookGraphOverlays(artboard),
					),
					runIndex: { value: 0 },
				};
				// Object Path Blur suppression (below) must match exactly
				// which targets the GPU compositor will actually draw this
				// render — suppressing a node that is no longer topmost
				// (something now occludes it) would make it vanish instead
				// of degrading to a plain unblurred render.
				const scopedPathBlurEligibleIds = scopedPathBlurTopmostTargetNodeIds(
					documentForArtboard(
						presentationDocument,
						artboard,
						presentationNodeArtboards.byNodeId,
					),
				);
				const wrapWithFilters = (
					filterIds: readonly string[],
					child: ReactNode,
				): ReactNode =>
					filterIds.reduceRight<ReactNode>(
						(acc, filterId) => (
							<g key={filterId} filter={`url(#${filterId})`}>
								{acc}
							</g>
						),
						child,
					);
				const wrapWithFrameLookFilters = (child: ReactNode): ReactNode =>
					wrapWithFilters(contentFilterIds, child);
				const nodeUsesSelectionFrameLook = (
					node: VectorNode,
					decorative: boolean,
				): boolean =>
					!decorative &&
					frameLookSelectionNodeIds.has(node.id) &&
					contentFilterIds.length > 0;
				const canRenderArtboardNode = (
					node: VectorNode,
					decorative: boolean,
				): boolean => {
					if (!node.visible) return false;
					// A vector subtree fallback is hidden only after the Babylon
					// surface commits a materialized plane for this exact root.
					// Raster rejection or runtime failure clears consumption and
					// leaves the established SVG renderer authoritative.
					if (!decorative && runtime3dVectorPlaneNodeIds.has(node.id)) {
						return false;
					}
					const liveFrameLease = liveProgramSurfaceFrameLease;
					const liveProgramSurfaceAsset =
						liveFrameLease && node.geometry.kind === "image"
							? programSurfaceAssetForGeometry(
									presentationDocument,
									node.geometry,
								)
							: null;
					// V1 Program Surface fallback suppression is deliberately narrower
					// than generic SVG visibility: the iframe host reports a mount-scoped,
					// asset/digest-bound consumed bitmap. This independently checks the
					// current image asset so a same-node replacement or stale callback
					// cannot hide the fallback. Canvas intentionally freezes React
					// presentation frames during playback, so exact content-key matching
					// applies while paused; the host owns the live transport fence.
					if (
						!decorative &&
						liveFrameLease !== null &&
						node.id === liveFrameLease.nodeId &&
						node.geometry.kind === "image" &&
						node.geometry.assetId === liveFrameLease.assetId &&
						liveProgramSurfaceAsset?.manifest.runtime.compiledDigest ===
							liveFrameLease.compiledDigest &&
						(isPlaying ||
							liveFrameLease.contentKey ===
								programSurfaceFrameContentKey({
									nodeId: node.id,
									frame: presentationFrame,
									fps: motionDocument.fps,
								})) &&
						selectedNodeIds.length === 1 &&
						selectedNodeIds[0] === node.id
					) {
						return false;
					}
					// E1 S2 GPU suppression (D2): for a GPU-active artboard, the GPU
					// surface repaints this artboard's node content directly — the SVG
					// content-mapping site is the single, well-commented gate that
					// keeps the two renderers from double-drawing. Artboard chrome
					// (background rect/shadow, frame border, ArtboardNameLabel, grid,
					// guides) lives OUTSIDE this function and is untouched.
					// E1 S4 diff mode (D7) deliberately bypasses this suppression: both
					// renderers draw the SAME artboard so `GpuSceneCanvas`'s
					// `mix-blend-mode: difference` canvas can composite against real
					// SVG content instead of an empty backdrop (see `isGpuDiffEnabled`'s
					// doc comment).
					if (!gpuDiffEnabled && activeArtboardIds.has(artboard.id)) {
						return false;
					}
					if (presentationNodeArtboards.byNodeId[node.id] !== artboard.id) {
						return false;
					}
					if (maskPlan.consumedMaskNodeIds.has(node.id)) {
						return false;
					}
					if (
						!decorative &&
						frameLookBaseExcludedNodeIds.has(node.id) &&
						!nodeUsesSelectionFrameLook(node, decorative)
					) {
						return false;
					}
					return shouldRenderNodeInView(
						node,
						artboardCullRect,
						nodeCullingOptions,
					);
				};
				const renderArtboardNode = (
					node: VectorNode,
					decorative: boolean,
					suppressScopedLookGraphOverlay = false,
					revealingFilter?: {
						readonly filterId: string;
						readonly revealPaint: RevealPaint;
					} | null,
				): ReactNode => {
					if (!canRenderArtboardNode(node, decorative)) {
						return null;
					}
					const applications =
						maskPlan.applicationsByContentNodeId.get(node.id) ?? [];
					// Masked content is wrapped in UNTRANSFORMED clip/mask
					// wrapper(s) ABOVE `<g data-node-id transform>` so the
					// artboard-space def is not skewed by the node's own
					// transform.
					const sceneNode = (
						<SceneNode
							key={`${node.id}-${decorative ? "frame-look" : "live"}`}
							node={node}
							decorative={decorative}
							scopedLookGraph={decorative ? undefined : scopedLookGraphContext}
							suppressScopedLookGraphOverlay={suppressScopedLookGraphOverlay}
							revealingFilter={decorative ? null : revealingFilter}
							assets={presentationDocument.assets}
							effectInfluenceRecipe={effectInfluenceRecipe}
							sourceOpticsPresentation={sourceOpticsPresentation}
						/>
					);
					const renderedNode = nodeUsesSelectionFrameLook(node, decorative)
						? wrapWithFrameLookFilters(sceneNode)
						: sceneNode;
					return applications.reduce(
						(inner, application) => (
							<g
								key={`${node.id}-${decorative ? "frame-look-" : ""}mask-${application.defKey}`}
								{...maskApplicationProps(application)}
							>
								{inner}
							</g>
						),
						renderedNode,
					);
				};
				const renderArtboardNodeList = (
					nodes: readonly VectorNode[],
					decorative: boolean,
				): ReactNode => {
					const rendered: ReactNode[] = [];
					let nodeIndex = 0;
					while (nodeIndex < nodes.length) {
						const node = nodes[nodeIndex];
						const overlay =
							!decorative && canRenderArtboardNode(node, decorative)
								? (scopedLookGraphContext.targets.get(node.id) ?? null)
								: null;
						if (!overlay) {
							rendered.push(renderArtboardNode(node, decorative));
							nodeIndex += 1;
							continue;
						}
						const run = [node];
						nodeIndex += 1;
						while (nodeIndex < nodes.length) {
							const next = nodes[nodeIndex];
							const nextOverlay = canRenderArtboardNode(next, decorative)
								? (scopedLookGraphContext.targets.get(next.id) ?? null)
								: null;
							if (!nextOverlay || nextOverlay.id !== overlay.id) break;
							run.push(next);
							nodeIndex += 1;
						}
						// Object Path Blur has no SVG filter equivalent (GPU-only).
						// The live canvas always runs the GPU compositor for an
						// eligible (topmost) target (`PathBlurObjectCompositeOverlay`),
						// so the run is omitted here entirely instead of painting it
						// sharp — painting it AND compositing the blurred crop on top
						// would double it. A non-eligible target (occluded by
						// something added after it) falls through to the normal
						// path, which renders it sharp (no SVG filter compiles for
						// path-blur) rather than letting it vanish.
						if (
							overlay.source !== "object-path-blur" ||
							!scopedPathBlurEligibleIds.has(node.id)
						) {
							rendered.push(
								<ScopedLookGraphRun
									key={`scoped-look-graph-${overlay.id}-${node.id}`}
									context={scopedLookGraphContext}
									overlay={overlay}
									nodes={run}
									renderRunNode={(runNode, revealingFilter) =>
										renderArtboardNode(
											runNode,
											decorative,
											true,
											revealingFilter,
										)
									}
								/>,
							);
						}
					}
					return rendered;
				};
				// 経路A partition, applied at the ONLY place it can be applied
				// cheaply and correctly: the top-level node list. The plan is
				// defined at top level, and every descendant follows its ancestor
				// automatically because `renderArtboardNode` recurses from here.
				const nodesForRun = (
					nodes: readonly VectorNode[],
				): readonly VectorNode[] => {
					if (run === "all") return nodes;
					const wanted =
						run === "front"
							? compositePlan.frontTopLevelNodeIds
							: compositePlan.backTopLevelNodeIds;
					return nodes.filter((node) => wanted.has(node.id));
				};
				const renderArtboardLayerNodes = (decorative: boolean) =>
					presentationDocument.layers.map((layer) =>
						layer.visible ? (
							<Fragment
								key={`${layer.id}-${decorative ? "decorative" : "live"}`}
							>
								{renderArtboardNodeList(nodesForRun(layer.nodes), decorative)}
							</Fragment>
						) : null,
					);
				// E1 D2 grid re-layering: a GPU-active artboard's grid is repainted
				// above `GpuSceneCanvas` by `GpuArtboardGridLayer` instead (see that
				// component's doc comment for why this in-scene render would
				// otherwise be invisible under the opaque GPU-drawn content). Every
				// non-GPU-active artboard (flag off entirely, or this artboard simply
				// doesn't qualify) is completely unaffected — same element, same
				// position, same z-order as before this change.
				const artboardGridOverlay = activeArtboardIds.has(
					artboard.id,
				) ? null : (
					<ArtboardGridOverlay
						lines={artboardGridLines}
						clipPathId={artboardGridClipId}
					/>
				);
				const scopedLookFilteredOverlay = scopedLookMaskId ? (
					<g
						key="scoped-look-overlay"
						clipPath={`url(#${artboardGridClipId})`}
						mask={`url(#${scopedLookMaskId})`}
						pointerEvents="none"
					>
						{wrapWithFilters(
							scopedFilterIds,
							<Fragment key="scoped-look-artboard-source">
								<ArtboardBackground
									artboard={artboard}
									assets={presentationDocument.assets}
									slot="scoped-look-bg"
									x={scopedLookRegion.x}
									y={scopedLookRegion.y}
									width={scopedLookRegion.width}
									height={scopedLookRegion.height}
								/>
								{renderArtboardLayerNodes(true)}
							</Fragment>,
						)}
					</g>
				) : null;
				// Artboard-level defs (clip, frame-look filters, mask plan). Shared by
				// the back and front composite runs: both SVGs emit an identical copy,
				// so `url(#id)` resolves to the same geometry regardless of whether a
				// browser scopes local references per-SVG or per-document.
				const artboardLookDefs = (
					<>
						<defs>
							<clipPath id={artboardGridClipId}>
								<rect width={artboard.width} height={artboard.height} />
							</clipPath>
							{frameGrainParams && frameGrainFilterId ? (
								<FrameFilmGrainDefs
									id={frameGrainFilterId}
									params={frameGrainParams}
									frame={presentationFrame}
									region={frameLookRegion}
									coverage={frameLookUsesSelectionNodes ? "source" : "frame"}
								/>
							) : null}
							{frameCaParams && frameCaFilterId ? (
								<FrameChromaticAberrationDefs
									id={frameCaFilterId}
									artboard={artboard}
									params={frameCaParams}
									region={frameLookRegion}
									coverage={frameLookUsesSelectionNodes ? "source" : "frame"}
								/>
							) : null}
							{scopedGrainParams && scopedGrainFilterId ? (
								<FrameFilmGrainDefs
									id={scopedGrainFilterId}
									params={scopedGrainParams}
									frame={presentationFrame}
									region={scopedLookRegion}
									coverage="source"
								/>
							) : null}
							{scopedCaParams && scopedCaFilterId ? (
								<FrameChromaticAberrationDefs
									id={scopedCaFilterId}
									artboard={artboard}
									params={scopedCaParams}
									region={scopedLookRegion}
									coverage="source"
								/>
							) : null}
							{frameLookGraphFilterSpec ? (
								<EffectFilterDefs spec={frameLookGraphFilterSpec} />
							) : null}
							{scopedLookMaskId && scopedInfluenceMaskPlan.kind === "masked" ? (
								<FrameLookInfluenceMaskDefs
									id={scopedLookMaskId}
									artboard={artboard}
									plan={scopedInfluenceMaskPlan}
									matteNodesByRefId={frameLookMatte.nodesByRefId}
									dilateRadius={scopedCaPadding}
								/>
							) : null}
							{frameLookMaskId && frameInfluenceMaskPlan.kind === "masked" ? (
								<FrameLookInfluenceMaskDefs
									id={frameLookMaskId}
									artboard={artboard}
									plan={frameInfluenceMaskPlan}
									matteNodesByRefId={frameLookMatte.nodesByRefId}
								/>
							) : null}
						</defs>
						<CanvasMaskDefs
							defs={maskDefs}
							artboardWidth={artboard.width}
							artboardHeight={artboard.height}
						/>
					</>
				);
				if (run === "front") {
					// Content only: the artboard background, frame border, name label,
					// grid, ghosts, and selection chrome all belong to the back plate.
					// Painting any of them here would occlude the 3D band this run is
					// supposed to sit above.
					return (
						<g
							key={artboard.id}
							data-artboard-id={artboard.id}
							data-composite-run="front"
							transform={`translate(${artboard.position.x} ${artboard.position.y})`}
						>
							{artboardLookDefs}
							<g clipPath={`url(#${artboardGridClipId})`}>
								{wrapWithFilters(
									artboardContentFilterIds,
									renderArtboardLayerNodes(false),
								)}
							</g>
						</g>
					);
				}
				return (
					<g
						key={artboard.id}
						data-artboard-id={artboard.id}
						transform={`translate(${artboard.position.x} ${artboard.position.y})`}
					>
						{artboardLookDefs}
						<ArtboardChrome
							artboard={artboard}
							assets={presentationDocument.assets}
							current={artboard.id === presentationCurrentArtboard.id}
							defaultArtboard={artboard.id === presentationDocument.artboard.id}
							contentFilterIds={artboardContentFilterIds}
							contentClipPathId={artboardGridClipId}
							contentMaskId={frameLookMaskId}
							contentRegion={frameLookRegion}
							contentFilterBackground={!frameLookGraphFilterSpec}
							filteredChildren={
								frameLookMaskId ? renderArtboardLayerNodes(true) : undefined
							}
						>
							{filmActive ? null : artboardGridOverlay}
							{renderArtboardLayerNodes(false)}
						</ArtboardChrome>
						<DuplicateGhostLayer
							artboardId={artboard.id}
							assets={presentationDocument.assets}
							effectInfluenceRecipe={effectInfluenceRecipe}
						/>
						{scopedLookFilteredOverlay}
						{filmActive ? artboardGridOverlay : null}
						{layoutFrameOverlayTargets.map((target) =>
							presentationNodeArtboards.byNodeId[target.frame.id] ===
							artboard.id ? (
								<LayoutFrameCanvasOverlay
									key={`layout-frame-overlay-${target.frame.id}`}
									scale={scale}
									{...target}
									externalMoveDrag={
										externalLayoutMovePreview?.frameId === target.frame.id
											? {
													hostChildId: externalLayoutMovePreview.hostChildId,
													base: externalLayoutMovePreview.base,
													placement: externalLayoutMovePreview.placement,
												}
											: undefined
									}
								/>
							) : null,
						)}
						{activeTool !== "select" &&
							selectedNodes.map((node) =>
								presentationNodeArtboards.byNodeId[node.id] === artboard.id ? (
									<SelectionOverlay
										key={node.id}
										node={node}
										selected={node.id === selection.primary}
										scale={scale}
										touchComfortable={iPadAuthoringSurface.visible}
									/>
								) : null,
							)}
						{artboard.id === selectedArtboardId && activeTool === "select" ? (
							<ArtboardSelectionChrome
								artboard={artboard}
								scale={scale}
								touchComfortable={iPadAuthoringSurface.visible}
							/>
						) : null}
					</g>
				);
			}),
		[
			compositePlan,
			presentationArtboards,
			presentationDocument,
			presentationNodeArtboards,
			presentationCurrentArtboard,
			presentationFrame,
			maskPlan,
			cullVisibleRect,
			nodeCullingOptions,
			artboardGridLinesById,
			activeTool,
			selectedNodes,
			selection.primary,
			selectedArtboardId,
			scale,
			isPlaying,
			motionDocument,
			iPadAuthoringSurface.visible,
			explicitFrameLookGraphFilterSpecs,
			layoutFrameOverlayTargets,
			externalLayoutMovePreview,
			activeArtboardIds,
			gpuDiffEnabled,
			liveProgramSurfaceFrameLease,
			runtime3dVectorPlaneNodeIds,
			selectedNodeIds,
		],
	);
	const artboardContentNodes = useMemo(
		() => buildArtboardContentNodes(compositePlan.hasFrontRun ? "back" : "all"),
		[buildArtboardContentNodes, compositePlan.hasFrontRun],
	);
	/**
	 * The 経路A front run, painted in its OWN SVG stacked above the Babylon
	 * overlay (`ExternalAssetRuntimePreviewLayer`, z-2). Null whenever no band
	 * exists, so the ordinary document never gains a second SVG element.
	 *
	 * It is `pointer-events: none` on purpose: hit-testing is geometric
	 * (`hitTestSceneStack` against the stage SVG's own rect), never DOM-target
	 * based, so pointer events must keep landing on the stage SVG underneath for
	 * selection, drag, and context menu to behave identically for front-run
	 * nodes.
	 */
	const frontRunContentNodes = useMemo(
		() =>
			compositePlan.hasFrontRun ? buildArtboardContentNodes("front") : null,
		[buildArtboardContentNodes, compositePlan.hasFrontRun],
	);

	/**
	 * Routes a fresh pointerdown into a layout cell-placement drag when it lands
	 * on a layout-managed child the overlay does not already capture (typically
	 * an unselected child, or a descendant whose Cell Host is not the overlay's
	 * current active target — the overlay's own cell body only accepts pointer
	 * events once a child is selected). Mirrors the ordinary select-transform
	 * handler's node-click SELECTION semantics exactly (handler.ts's
	 * `onPointerDown` hit-node branch) so the same gesture that would otherwise
	 * select-and-move now selects-and-drags-the-cell. Returns `true` when it
	 * started (or intentionally no-op'd, e.g. a shift-toggle that deselected the
	 * clicked node) the interaction, so the caller skips ordinary dispatch;
	 * `false` falls through unchanged (double-click, Alt-drag, non-select tool,
	 * no host resolves, or the drag context fails to build).
	 */
	const tryRouteLayoutMoveDrag = (
		context: ReturnType<typeof pointerContextFor>,
		event: ReactPointerEvent<SVGSVGElement>,
		gestureHandler: typeof activeHandler,
	): boolean => {
		if (gestureHandler?.id !== "select-transform") return false;
		if (event.detail >= 2 || event.altKey) return false;
		if (!context.hitNodeId) return false;
		const interactionDocument = resolveLayoutInteractionDocument();
		const host = resolveLayoutFrameHostForNode(
			interactionDocument,
			context.hitNodeId,
		);
		if (!host) return false;

		// Mirror handler.ts's node-click selection semantics exactly: shift-click
		// toggles/adds; a plain click on an already-selected node preserves the
		// multi-selection; a plain click on an unselected node replace-selects it.
		// Computed WITHOUT mutating the store yet — a failed drag build below must
		// leave selection untouched so the ordinary handler's own (unaware of this
		// attempt) selection logic does not double-toggle against a live store.
		const clickedId = context.hitNodeId;
		const currentSelection = useSelectionStore.getState();
		const nextNodeIds = event.shiftKey
			? currentSelection.nodeIds.includes(clickedId)
				? currentSelection.nodeIds.filter((id) => id !== clickedId)
				: [...currentSelection.nodeIds, clickedId]
			: currentSelection.nodeIds.includes(clickedId)
				? currentSelection.nodeIds
				: [clickedId];
		if (!nextNodeIds.includes(clickedId)) {
			// A shift-toggle that would deselect the clicked node: apply the
			// selection change and stop — no drag starts (mirrors handler.ts's
			// collapseTo no-op for this case).
			selectNode(clickedId, true);
			return true;
		}

		const drag = beginExternalLayoutMoveDrag(
			interactionDocument,
			host,
			context.point,
			event.pointerId,
			nextNodeIds,
		);
		if (!drag) return false;

		// Only now commit the selection change — the drag is confirmed buildable,
		// so it is safe to let the ordinary handler's dispatch be skipped below.
		if (event.shiftKey) {
			selectNode(clickedId, true);
		} else if (!currentSelection.nodeIds.includes(clickedId)) {
			selectNode(clickedId, false);
		}
		activePointerIdRef.current = event.pointerId;
		pointerArtboardIdRef.current = context.artboardId;
		pointerGestureHandlerRef.current = undefined;
		externalLayoutMoveDragRef.current = drag;
		safelyCapturePointer(event.currentTarget, event.pointerId);
		iPadPerfCaptureRef.current?.setActiveGesture("external-layout");
		setExternalLayoutMovePreview({
			frameId: drag.frameId,
			hostChildId: drag.hostChildId,
			base: drag.base,
			placement: drag.preview,
		});
		return true;
	};

	const shouldHandleIpadViewportTouch = (
		event: ReactPointerEvent<Element>,
	): boolean =>
		iPadAuthoringSurface.visible &&
		event.pointerType === "touch" &&
		!isIpadAuthoringChromeTarget(event.target);

	const reserveIpadViewportTouch = (event: ReactPointerEvent<Element>) => {
		event.preventDefault();
		event.stopPropagation();
	};

	const nativePencilTouchCaptureActive =
		activeTool === "pencil" && iPadAuthoringSurface.bridgeAvailable;

	const handleIpadViewportTouchDownCapture = (
		event: ReactPointerEvent<Element>,
	) => {
		if (!shouldHandleIpadViewportTouch(event)) return;
		iPadPerfCaptureRef.current?.recordPointer("camera-touch");
		iPadViewportTouchPointersRef.current.set(event.pointerId, {
			pointerId: event.pointerId,
			clientX: event.clientX,
			clientY: event.clientY,
		});
		const multiTouch = iPadViewportTouchPointersRef.current.size >= 2;
		if (multiTouch) {
			clearIpadQuickMenuTouchHold();
			const touchCount = iPadViewportTouchPointersRef.current.size;
			if (touchCount === 2 || touchCount === 3) {
				startIpadHistoryHold(touchCount);
			} else {
				clearIpadHistoryHold();
			}
		} else if (nativePencilTouchCaptureActive) {
			clearIpadQuickMenuTouchHold();
			const point = pointRelativeToCanvasViewport(
				event,
				canvasViewportRef.current,
			);
			const pointerId = event.pointerId;
			const startX = event.clientX;
			const startY = event.clientY;
			const timerId = window.setTimeout(() => {
				iPadQuickMenuTouchHoldRef.current = null;
				openIpadQuickMenuAt(point, "touch");
			}, IPAD_QUICK_MENU_HOLD_MS);
			iPadQuickMenuTouchHoldRef.current = {
				pointerId,
				startX,
				startY,
				timerId,
			};
		}
		if (nativePencilTouchCaptureActive || multiTouch) {
			reserveIpadViewportTouch(event);
		}
		if (multiTouch) {
			scheduleIpadViewportGesture();
		}
	};

	const handleIpadViewportTouchMoveCapture = (
		event: ReactPointerEvent<Element>,
	) => {
		if (!shouldHandleIpadViewportTouch(event)) return;
		const touchPoint = iPadViewportTouchPointersRef.current.get(
			event.pointerId,
		);
		if (!touchPoint) return;
		iPadPerfCaptureRef.current?.recordPointer("camera-touch");
		touchPoint.clientX = event.clientX;
		touchPoint.clientY = event.clientY;
		const hold = iPadQuickMenuTouchHoldRef.current;
		if (
			hold?.pointerId === event.pointerId &&
			Math.hypot(event.clientX - hold.startX, event.clientY - hold.startY) >
				IPAD_QUICK_MENU_CANCEL_DISTANCE_PX
		) {
			clearIpadQuickMenuTouchHold();
		}
		const multiTouch = iPadViewportTouchPointersRef.current.size >= 2;
		if (multiTouch) clearIpadQuickMenuTouchHold();
		if (
			nativePencilTouchCaptureActive ||
			multiTouch ||
			iPadViewportGestureRef.current
		) {
			reserveIpadViewportTouch(event);
		}
		if (multiTouch) {
			scheduleIpadViewportGesture();
			if (iPadViewportGestureRef.current?.moved) {
				clearIpadHistoryHold();
			}
		}
	};

	const handleIpadViewportTouchEndCapture = (
		event: ReactPointerEvent<Element>,
	) => {
		if (!shouldHandleIpadViewportTouch(event)) return;
		iPadPerfCaptureRef.current?.recordPointer("camera-touch");
		flushScheduledIpadViewportGesture();
		clearIpadHistoryHold();
		const shouldReserve =
			nativePencilTouchCaptureActive ||
			iPadViewportTouchPointersRef.current.size >= 2 ||
			iPadViewportGestureRef.current !== null;
		if (iPadQuickMenuTouchHoldRef.current?.pointerId === event.pointerId) {
			clearIpadQuickMenuTouchHold();
		}
		const removed = endIpadViewportTouchPointer(event.pointerId);
		if (removed && shouldReserve) {
			reserveIpadViewportTouch(event);
		}
	};
	return (
		<section className="canvas-shell overflow-hidden">
			<div
				ref={canvasViewportRef}
				className="canvas-desk relative h-full w-full touch-none overflow-hidden"
				style={{ cursor: canvasCursor }}
				onPointerDownCapture={handleIpadViewportTouchDownCapture}
				onPointerMoveCapture={handleIpadViewportTouchMoveCapture}
				onPointerUpCapture={handleIpadViewportTouchEndCapture}
				onPointerCancelCapture={handleIpadViewportTouchEndCapture}
				onPointerDown={(event) => {
					// Hand/space pan starts here (the full-bleed wrapper) rather than on
					// the bounded stage, so a pan can begin anywhere on screen — including
					// the desk outside the artboards, which was previously a dead zone.
					if (spaceHeldRef.current) {
						// A pointer-down while Space is held is a deliberate pan, so this
						// hold can no longer resolve to a play/pause tap on release.
						spacePanUsedRef.current = true;
						startViewportPanGesture(event, "space");
						return;
					}
					if (activeTool === "hand" && event.button === 0) {
						startViewportPanGesture(event, "hand");
					}
				}}
				onPointerMove={(event) => {
					const panGesture = viewportPanGestureRef.current;
					if (panGesture?.pointerId !== event.pointerId) return;
					event.preventDefault();
					iPadPerfCaptureRef.current?.recordPointer(
						ipadPerfLaneForViewportPan(panGesture.source),
					);
					const deltaX = event.clientX - panGesture.lastClientX;
					const deltaY = event.clientY - panGesture.lastClientY;
					panGesture.lastClientX = event.clientX;
					panGesture.lastClientY = event.clientY;
					const canPan = panGesture.source === "hand" || spaceHeldRef.current;
					if (canPan && (deltaX !== 0 || deltaY !== 0)) {
						scheduleViewportPan(deltaX, deltaY);
					}
				}}
				onPointerUp={(event) => {
					if (viewportPanGestureRef.current?.pointerId !== event.pointerId) {
						return;
					}
					flushPendingViewportPan();
					if (!endViewportPanGesture(event.pointerId)) return;
					event.preventDefault();
					safelyReleasePointer(event.currentTarget, event.pointerId);
				}}
				onPointerCancel={(event) => {
					if (viewportPanGestureRef.current?.pointerId !== event.pointerId) {
						return;
					}
					flushPendingViewportPan();
					endViewportPanGesture(event.pointerId);
				}}
			>
				<WorkspaceGridOverlay
					lines={iPadViewportVisualDietActive ? [] : workspaceGridLines}
					viewportWidth={viewportSize.width}
					viewportHeight={viewportSize.height}
				/>
				<div className="absolute inset-0">
					<ContextMenu label="Selection actions" groups={canvasMenuGroups}>
						<svg
							ref={stageSvgRef}
							viewBox={`0 0 ${Math.max(1, viewportSize.width)} ${Math.max(1, viewportSize.height)}`}
							className="absolute inset-0 block h-full w-full touch-none"
							role="img"
							aria-label="Motion-ready vector artboard preview"
							style={{ cursor: canvasCursor }}
							onPointerLeave={() => {
								if (!sceneCameraHandleDragRef.current) {
									setSceneCameraHandleHud(null);
								}
							}}
							onContextMenu={(event) => {
								// Preview interactions bypasses selection/tools entirely: no
								// context menu, no deep-select-cycle hit resolution.
								if (interactionPreview) {
									event.preventDefault();
									return;
								}
								if (activeTool === "select" && isDeepSelectionModifier(event)) {
									event.preventDefault();
									event.stopPropagation();
									return;
								}
								const targetNodeId = contextMenuTargetNodeId(
									event.currentTarget,
									event.clientX,
									event.clientY,
								);
								if (targetNodeId && !selectedNodeIds.includes(targetNodeId)) {
									selectNode(targetNodeId, false);
								}
							}}
							onPointerDown={(event) => {
								iPadPerfCaptureRef.current?.recordPointer(
									ipadPerfLaneForStagePointer(activeTool, event),
								);
								if (event.pointerType === "pen") {
									clearIpadPencilHoverPreview();
								}
								// Viewport pan (hand/space) is owned by the full-bleed wrapper; bail so
								// the stage never starts a selection/draw gesture while a pan is active.
								if (spaceHeldRef.current || activeTool === "hand") return;

								if (event.button !== 0) return;
								// Seed the gesture-scoped rect cache before the first read so this
								// pointerdown pays for exactly one getBoundingClientRect(), and every
								// subsequent move/up for this pointerId reuses it. A later pointerdown
								// with a different pointerId (second touch/pen contact) just refreshes it.
								stageRectRef.current = {
									pointerId: event.pointerId,
									rect: event.currentTarget.getBoundingClientRect(),
								};
								if (handleInteractionPreviewPointerDown(event)) return;
								let context = pointerContextFor(event.currentTarget, event);
								if (
									activeTool === "select" ||
									activeTool === "direct-select" ||
									cmdSelectHeldRef.current
								) {
									context = resolveRuntime3dPointerContext(
										context,
										event.clientX,
										event.clientY,
									);
								}
								if (tryStartSceneCameraHandleDrag(context, event)) return;
								if (selectDeepHit(context, event)) return;

								// Spring-loaded selection: while ⌘/Ctrl is held, route to the
								// select handler; latch it for the whole gesture so releasing ⌘
								// mid-drag never swaps the handler out from under an active move.
								const gestureHandler =
									cmdSelectHeldRef.current && selectHandler
										? selectHandler
										: activeHandler;

								// A fresh drag on a layout-managed child the overlay does not
								// already capture performs a cell-placement drag instead of the
								// ordinary select-transform move (which the runner would fight —
								// see collectLayoutManagedChildIds). Falls through unchanged when
								// no host resolves, on double-click, or Alt-drag.
								if (tryRouteLayoutMoveDrag(context, event, gestureHandler))
									return;

								pointerGestureHandlerRef.current = gestureHandler;
								iPadPerfCaptureRef.current?.setActiveGesture(
									ipadPerfLaneForStagePointer(activeTool, event),
								);

								activePointerIdRef.current = event.pointerId;
								pointerArtboardIdRef.current = context.artboardId;
								safelyCapturePointer(event.currentTarget, event.pointerId);
								const eventApi = buildHandlerApi(
									selection,
									viewport,
									context.document,
									{ allowTouchFreehand, isPerforming: performing },
								);
								gestureHandler?.onPointerDown?.(
									toHandlerPointerContext(context, event.nativeEvent),
									eventApi,
								);
								if (!gestureHandler && context.hitNodeId) {
									selectNode(context.hitNodeId, event.shiftKey);
								}
								if (!gestureHandler && !context.hitNodeId) clearSelection();
							}}
							onPointerMove={(event) => {
								iPadPerfCaptureRef.current?.recordPointer(
									ipadPerfLaneForStagePointer(activeTool, event),
								);
								updateIpadPencilHoverPreview(event);
								if (
									activePointerIdRef.current !== null &&
									activePointerIdRef.current !== event.pointerId
								) {
									return;
								}
								// The wrapper owns viewport pan; while one is active the stage stays
								// inert so it never double-handles the pan or starts a stray edit.
								if (viewportPanGestureRef.current) return;

								const sceneCameraDrag = sceneCameraHandleDragRef.current;
								if (sceneCameraDrag?.pointerId === event.pointerId) {
									const context = pointerContextFor(event.currentTarget, event);
									updateSceneCameraHandleDrag(context, sceneCameraDrag, event);
									return;
								}

								if (interactionPreview) {
									handleInteractionPreviewPointerMove(
										pointerContextFor(event.currentTarget, event),
										event,
									);
									return;
								}

								const externalDrag = externalLayoutMoveDragRef.current;
								if (externalDrag?.pointerId === event.pointerId) {
									iPadPerfCaptureRef.current?.setActiveGesture(
										"external-layout",
									);
									const context = pointerContextFor(event.currentTarget, event);
									const next = nextExternalLayoutMoveDrag(
										resolveLayoutInteractionDocument(),
										externalDrag,
										context.point,
										useSelectionStore.getState().nodeIds,
									);
									if (next) {
										externalLayoutMoveDragRef.current = next;
										setExternalLayoutMovePreview({
											frameId: next.frameId,
											hostChildId: next.hostChildId,
											base: next.base,
											placement: next.preview,
										});
										return;
									}
									// The frame/host stopped resolving mid-drag (e.g. deleted). End
									// the gesture cleanly rather than freezing the last preview until
									// pointerup — there is nothing to commit either way.
									externalLayoutMoveDragRef.current = null;
									setExternalLayoutMovePreview(null);
									iPadPerfCaptureRef.current?.setActiveGesture(null);
									pointerArtboardIdRef.current = null;
									activePointerIdRef.current = null;
									safelyReleasePointer(event.currentTarget, event.pointerId);
									return;
								}

								const context = pointerContextFor(event.currentTarget, event);
								if (
									activePointerIdRef.current === null &&
									event.buttons === 0 &&
									(event.pointerType === "mouse" ||
										event.pointerType === "pen") &&
									(activeTool === "select" || activeTool === "direct-select")
								) {
									const cachedHitContext =
										sceneCameraHandleHitContextRef.current;
									const hitContextMatches =
										cachedHitContext?.document === context.document &&
										cachedHitContext.artboardId === context.artboardId &&
										cachedHitContext.sceneCameraSelection ===
											selection.sceneCamera &&
										cachedHitContext.zoom === viewport.zoom;
									const hitContext = hitContextMatches
										? cachedHitContext.context
										: createSceneCameraCanvasHandleHitContext({
												document: context.document,
												artboardId: context.artboardId,
												selection,
												zoom: viewport.zoom,
											});
									if (!hitContextMatches) {
										sceneCameraHandleHitContextRef.current = {
											document: context.document,
											...(context.artboardId
												? { artboardId: context.artboardId }
												: {}),
											sceneCameraSelection: selection.sceneCamera,
											zoom: viewport.zoom,
											context: hitContext,
										};
									}
									const hoverHit = hitSceneCameraCanvasHandleContext(
										hitContext,
										context.point,
									);
									const hoverStart = hoverHit
										? createSceneCameraCanvasHandleDragStart({
												document: context.document,
												hit: hoverHit,
												point: context.point,
											})
										: null;
									setSceneCameraHandleHud(
										hoverHit && hoverStart
											? sceneCameraCanvasHandleDragHud({
													hit: hoverHit,
													point: context.point,
													start: hoverStart,
												})
											: null,
									);
								}
								const eventApi = buildHandlerApi(
									selection,
									viewport,
									context.document,
									{ allowTouchFreehand, isPerforming: performing },
								);
								// During a gesture use the latched handler; on a bare hover use the
								// live one (the select handler while ⌘ is held).
								const moveHandler =
									activePointerIdRef.current !== null
										? pointerGestureHandlerRef.current
										: cmdSelectHeldRef.current && selectHandler
											? selectHandler
											: activeHandler;
								moveHandler?.onPointerMove?.(
									toHandlerPointerContext(context, event.nativeEvent),
									eventApi,
								);
							}}
							onPointerUp={(event) => {
								iPadPerfCaptureRef.current?.recordPointer(
									ipadPerfLaneForStagePointer(activeTool, event),
								);
								if (event.pointerType === "pen") {
									clearIpadPencilHoverPreview();
								}
								if (
									activePointerIdRef.current !== null &&
									activePointerIdRef.current !== event.pointerId
								) {
									return;
								}
								if (viewportPanGestureRef.current) return;

								if (
									sceneCameraHandleDragRef.current?.pointerId ===
									event.pointerId
								) {
									sceneCameraHandleDragRef.current = null;
									setSceneCameraHandleHud(null);
									iPadPerfCaptureRef.current?.setActiveGesture(null);
									pointerArtboardIdRef.current = null;
									activePointerIdRef.current = null;
									stageRectRef.current = null;
									safelyReleasePointer(event.currentTarget, event.pointerId);
									return;
								}

								if (interactionPreview) {
									handleInteractionPreviewPointerUp(
										pointerContextFor(event.currentTarget, event),
										event,
									);
									return;
								}

								const externalDrag = externalLayoutMoveDragRef.current;
								if (externalDrag?.pointerId === event.pointerId) {
									const context = pointerContextFor(event.currentTarget, event);
									commitExternalLayoutMoveDrag(
										resolveLayoutInteractionDocument(),
										externalDrag,
										context.point,
										useSelectionStore.getState().nodeIds,
									);
									externalLayoutMoveDragRef.current = null;
									setExternalLayoutMovePreview(null);
									iPadPerfCaptureRef.current?.setActiveGesture(null);
									pointerArtboardIdRef.current = null;
									activePointerIdRef.current = null;
									safelyReleasePointer(event.currentTarget, event.pointerId);
									return;
								}

								const context = pointerContextFor(event.currentTarget, event);
								const eventApi = buildHandlerApi(
									selection,
									viewport,
									context.document,
									{ allowTouchFreehand, isPerforming: performing },
								);
								pointerGestureHandlerRef.current?.onPointerUp?.(
									toHandlerPointerContext(context, event.nativeEvent),
									eventApi,
								);
								pointerGestureHandlerRef.current = undefined;
								iPadPerfCaptureRef.current?.setActiveGesture(null);
								pointerArtboardIdRef.current = null;
								activePointerIdRef.current = null;
								stageRectRef.current = null;
								safelyReleasePointer(event.currentTarget, event.pointerId);
							}}
							onPointerCancel={(event) => {
								clearIpadPencilHoverPreview();
								if (viewportPanGestureRef.current) return;

								if (
									sceneCameraHandleDragRef.current?.pointerId ===
									event.pointerId
								) {
									sceneCameraHandleDragRef.current = null;
									setSceneCameraHandleHud(null);
									iPadPerfCaptureRef.current?.setActiveGesture(null);
									pointerArtboardIdRef.current = null;
									activePointerIdRef.current = null;
									stageRectRef.current = null;
									safelyReleasePointer(event.currentTarget, event.pointerId);
									return;
								}

								// A layout cell-placement drag never writes to the scene while
								// live (only local preview state), so a cancel simply discards it
								// — there is nothing to commit or undo.
								if (externalLayoutMoveDragRef.current) {
									if (
										externalLayoutMoveDragRef.current.pointerId !==
										event.pointerId
									) {
										return;
									}
									externalLayoutMoveDragRef.current = null;
									setExternalLayoutMovePreview(null);
									iPadPerfCaptureRef.current?.setActiveGesture(null);
									pointerArtboardIdRef.current = null;
									activePointerIdRef.current = null;
									safelyReleasePointer(event.currentTarget, event.pointerId);
									return;
								}
								if (
									activePointerIdRef.current !== null &&
									activePointerIdRef.current !== event.pointerId
								) {
									return;
								}

								// A pointercancel (touch/pen interruption, OS gesture takeover)
								// fires instead of pointerup and is not suppressed by pointer
								// capture. Tear the gesture down so its scene transaction is
								// committed rather than left open to absorb later edits from any
								// feature (cross-feature undo corruption).
								(
									pointerGestureHandlerRef.current ?? activeHandler
								)?.onDeactivate?.(handlerApi);
								useSceneStore.getState().commit();
								pointerGestureHandlerRef.current = undefined;
								iPadPerfCaptureRef.current?.setActiveGesture(null);
								pointerArtboardIdRef.current = null;
								activePointerIdRef.current = null;
								stageRectRef.current = null;
								safelyReleasePointer(event.currentTarget, event.pointerId);
							}}
							onLostPointerCapture={(event) => {
								clearIpadPencilHoverPreview();
								if (viewportPanGestureRef.current) return;

								if (
									sceneCameraHandleDragRef.current?.pointerId ===
									event.pointerId
								) {
									sceneCameraHandleDragRef.current = null;
									setSceneCameraHandleHud(null);
									iPadPerfCaptureRef.current?.setActiveGesture(null);
									pointerArtboardIdRef.current = null;
									activePointerIdRef.current = null;
									stageRectRef.current = null;
									return;
								}

								if (externalLayoutMoveDragRef.current) {
									if (
										externalLayoutMoveDragRef.current.pointerId !==
										event.pointerId
									) {
										return;
									}
									externalLayoutMoveDragRef.current = null;
									setExternalLayoutMovePreview(null);
									iPadPerfCaptureRef.current?.setActiveGesture(null);
									pointerArtboardIdRef.current = null;
									activePointerIdRef.current = null;
									return;
								}

								// Defense in depth: capture can be lost without a pointerup
								// (captured element removed, focus stolen). Ignore the normal
								// lost-capture event caused by our pointerup release so multi-click
								// pen authoring is not reset between anchors.
								if (activePointerIdRef.current === null) return;
								if (activePointerIdRef.current !== event.pointerId) return;
								(
									pointerGestureHandlerRef.current ?? activeHandler
								)?.onDeactivate?.(handlerApi);
								useSceneStore.getState().commit();
								pointerGestureHandlerRef.current = undefined;
								iPadPerfCaptureRef.current?.setActiveGesture(null);
								pointerArtboardIdRef.current = null;
								activePointerIdRef.current = null;
								stageRectRef.current = null;
							}}
						>
							<defs>
								<filter
									id="vecmo-artboard-shadow"
									x="-25%"
									y="-25%"
									width="150%"
									height="150%"
									colorInterpolationFilters="sRGB"
								>
									<feDropShadow
										dx="0"
										dy="6"
										stdDeviation="12"
										floodColor="#2c2f29"
										floodOpacity="0.18"
									/>
								</filter>
							</defs>
							{/* Full-viewport transparent hit target so clicks on the empty
							    desk reach this handler (and clear selection), not just
							    clicks landing on a painted artboard. Lives in screen space,
							    outside the panned/scaled world group. */}
							<rect
								x={0}
								y={0}
								width={Math.max(1, viewportSize.width)}
								height={Math.max(1, viewportSize.height)}
								fill="transparent"
							/>
							<g
								ref={cameraWorldGroupRef}
								transform={cameraTransformValue(viewport)}
							>
								{artboardContentNodes}
							</g>
							{iPadPencilHoverPreview ? (
								<g className="pointer-events-none text-accent">
									<circle
										cx={iPadPencilHoverPreview.x}
										cy={iPadPencilHoverPreview.y}
										r={iPadPencilHoverPreview.radius}
										fill="none"
										stroke="currentColor"
										strokeOpacity={0.72}
										strokeWidth={1.5}
									/>
									<circle
										cx={iPadPencilHoverPreview.x}
										cy={iPadPencilHoverPreview.y}
										r={2}
										fill="currentColor"
										opacity={0.78}
									/>
									{iPadPencilHoverPreview.azimuthAngle !== null ? (
										<line
											x1={iPadPencilHoverPreview.x}
											y1={iPadPencilHoverPreview.y}
											x2={
												iPadPencilHoverPreview.x +
												Math.cos(iPadPencilHoverPreview.azimuthAngle) *
													iPadPencilHoverPreview.radius
											}
											y2={
												iPadPencilHoverPreview.y +
												Math.sin(iPadPencilHoverPreview.azimuthAngle) *
													iPadPencilHoverPreview.radius
											}
											stroke="currentColor"
											strokeLinecap="round"
											strokeOpacity={0.5}
											strokeWidth={1.25}
										/>
									) : null}
									{iPadPencilHoverPreview.rollDegrees !== null ? (
										<line
											x1={
												iPadPencilHoverPreview.x -
												iPadPencilHoverPreview.radius * 0.55
											}
											y1={iPadPencilHoverPreview.y}
											x2={
												iPadPencilHoverPreview.x +
												iPadPencilHoverPreview.radius * 0.55
											}
											y2={iPadPencilHoverPreview.y}
											stroke="currentColor"
											strokeLinecap="round"
											strokeOpacity={0.72}
											strokeWidth={1.5}
											transform={`rotate(${iPadPencilHoverPreview.rollDegrees} ${iPadPencilHoverPreview.x} ${iPadPencilHoverPreview.y})`}
										/>
									) : null}
								</g>
							) : null}
						</svg>
					</ContextMenu>
					{gpuCanvasEnabled ? (
						<GpuSceneCanvas
							activeArtboardIds={activeArtboardIds}
							diffEnabled={gpuDiffEnabled}
						/>
					) : null}
					{gpuCanvasEnabled && !iPadViewportVisualDietActive ? (
						<GpuArtboardGridLayer
							artboards={presentationArtboards}
							linesById={artboardGridLinesById}
							viewport={viewport}
							scale={scale}
							viewportSize={viewportSize}
						/>
					) : null}
					{!iPadViewportVisualDietActive ? (
						<ExternalAssetRuntimePreviewLayer
							artboards={presentationArtboards}
							camera={viewport}
							disabledVectorPlaneArtboardIds={activeArtboardIds}
							document={presentationDocument}
							frame={presentationFrame}
							nodeArtboardIds={presentationNodeArtboards.byNodeId}
							onPickerChange={handleRuntime3dPickerChange}
							onVectorPlaneConsumptionChange={
								handleRuntime3dVectorPlaneConsumptionChange
							}
							renderIsolatedNodeSvg={renderIsolatedNodeSvg}
							resolveDocumentAtFrame={sampleCanvasDocumentAtFrame}
							subscribePlayback={subscribePlayback}
							viewportSize={viewportSize}
						/>
					) : null}
					{frontRunContentNodes ? (
						<svg
							viewBox={`0 0 ${Math.max(1, viewportSize.width)} ${Math.max(1, viewportSize.height)}`}
							className="pointer-events-none absolute inset-0 z-[3] block h-full w-full"
							aria-hidden="true"
							data-composite-front-run="true"
						>
							<g transform={cameraTransformValue(viewport)}>
								{frontRunContentNodes}
							</g>
						</svg>
					) : null}
					{!iPadViewportVisualDietActive ? (
						<ProgramSurfaceProbeLayer
							activeGpuArtboardIds={activeArtboardIds}
							artboards={presentationArtboards}
							nodeArtboardIds={presentationNodeArtboards.byNodeId}
							onLiveFrameLeaseUpdate={handleProgramSurfaceLiveFrameLeaseUpdate}
							onTrace={programSurfaceHostTraceDiagnostics?.record}
							resolveFrame={resolveProgramSurfaceProbeFrame}
							sceneDocument={presentationDocument}
							selectedNodeIds={selectedNodeIds}
							subscribePlayback={subscribePlayback}
						/>
					) : null}
					{!iPadViewportVisualDietActive ? (
						<div className="pointer-events-none absolute" style={overlayStyle}>
							{overlays
								.filter(
									(overlay) => !overlay.tool || overlay.tool === activeTool,
								)
								.map((overlay) => (
									<overlay.Component
										key={overlay.id}
										document={overlayDocument}
										selection={selection}
										viewport={viewport}
										clearSelection={clearSelection}
										renderArtboardSvg={renderArtboardSvg}
										subscribePlayback={subscribePlayback}
										getRasterFrame={getRasterFrame}
										getStaticRasterPlaybackPlan={getStaticRasterPlaybackPlan}
										getStaticRasterPlaybackFrame={getStaticRasterPlaybackFrame}
										renderIsolatedNodeSvg={renderIsolatedNodeSvg}
										renderIsolatedNodeSetSvg={renderIsolatedNodeSetSvg}
									/>
								))}
						</div>
					) : null}
				</div>
				<div className="pointer-events-none absolute inset-0 z-10">
					{!iPadViewportVisualDietActive ? (
						<GuidesOverlay
							document={presentationDocument}
							projection={projection}
							viewportWidth={viewportSize.width}
							viewportHeight={viewportSize.height}
						/>
					) : null}
				</div>
				<div className="pointer-events-none absolute inset-0 z-20">
					<PerformIndicator />
					{sceneCameraHandleHud ? (
						<div className="absolute top-16 left-1/2 -translate-x-1/2 rounded-md border border-accent/35 bg-surface-raised/90 px-2 py-1 font-mono text-accent-fg text-ui shadow-2xl shadow-scrim/50 backdrop-blur-xl">
							{sceneCameraHandleHud}
						</div>
					) : null}
					{!iPadViewportVisualDietActive
						? presentationArtboards.map((artboard) => (
								<ArtboardNameLabel
									key={`${artboard.id}-label`}
									artboard={artboard}
									current={artboard.id === presentationCurrentArtboard.id}
									defaultArtboard={
										artboard.id === presentationDocument.artboard.id
									}
									selected={artboard.id === selectedArtboardId}
									interactive={activeTool === "select"}
									onSelect={() => selectArtboard(artboard.id)}
									camera={camera}
								/>
							))
						: null}
					{quickActionStyle && !iPadViewportVisualDietActive ? (
						<ContextualQuickActions
							actions={quickActions}
							style={quickActionStyle}
							touchComfortable={iPadAuthoringSurface.visible}
						/>
					) : null}
					{iPadAuthoringSurface.visible &&
					pendingStrokeIntent !== null &&
					activeTool === "pencil" &&
					!isPlaying &&
					!iPadFocusMode &&
					!iPadViewportVisualDietActive &&
					!isDraftingFreehandStroke &&
					conversionHudActions.length > 0 &&
					conversionHudStyle ? (
						<IpadConversionHud
							actions={conversionHudActions}
							onDismiss={() =>
								useStrokeIntentStore.getState().clearLastIntent()
							}
							style={conversionHudStyle}
						/>
					) : null}
					{iPadAuthoringSurface.visible &&
					!iPadFocusMode &&
					iPadAppearanceOpen &&
					iPadAppearanceNodeStyle &&
					iPadAppearanceStyle ? (
						<IpadAppearancePanel
							nodeStyle={iPadAppearanceNodeStyle}
							onChange={applyIpadAppearancePatch}
							onClose={() => setIpadAppearanceOpen(false)}
							onTextChange={applyIpadTextAppearancePatch}
							selectedCount={selection.nodeIds.length}
							style={iPadAppearanceStyle}
						/>
					) : null}
					{noiseGradientToolControlStyle &&
					!iPadFocusMode &&
					!iPadViewportVisualDietActive ? (
						<NoiseGradientToolControls
							document={sceneDocument}
							selection={selection}
							style={noiseGradientToolControlStyle}
						/>
					) : null}
					{iPadAuthoringSurface.visible && !iPadFocusMode ? (
						<IpadAuthoringQuickbar
							accountEntry={
								platformCapabilities.account ? (
									<Suspense fallback={null}>
										<BillingEntry
											popoverSide={
												iPadQuickbarDock === "top" ? "bottom" : "top"
											}
											tooltipSide={
												iPadQuickbarDock === "top" ? "bottom" : "top"
											}
											variant="ipad"
										/>
									</Suspense>
								) : null
							}
							bridgeAvailable={iPadAuthoringSurface.bridgeAvailable}
							canRedo={canRedo}
							canUndo={canUndo}
							cloudStatus={
								platformCapabilities.cloudProjects ? iPadCloudStatus : undefined
							}
							dock={iPadQuickbarDock}
							hasNodeSelection={selection.nodeIds.length > 0}
							hasSelection={
								selection.nodeIds.length > 0 ||
								selection.selectedArtboardId !== null
							}
							nativeStatus={iPadNativeStatus}
							notice={iPadQuickbarNotice}
							onDeleteSelection={deleteIpadSelection}
							onFitArtboard={onFitArtboard}
							onFitSelection={fitCurrentSelectionForIpad}
							onOpenBackup={openIpadProjectBackup}
							onOpenCloudRecovery={openIpadCloudRecovery}
							onOpenQuickMenu={openIpadQuickMenuFromQuickbar}
							onOpenStyle={openIpadStyleControls}
							onRedo={() => {
								globalRedo();
								performIpadPencilFeedback("redo");
							}}
							onShareBackup={shareIpadProjectBackup}
							onToggleTimeline={toggleIpadTimeline}
							onUndo={() => {
								globalUndo();
								performIpadPencilFeedback("undo");
							}}
							onZoomActualSize={() =>
								useViewportStore.getState().zoomToActualSize()
							}
							onZoomIn={() => useViewportStore.getState().zoomStepIn()}
							onZoomOut={() => useViewportStore.getState().zoomStepOut()}
							timelineOpen={timelineOpen}
							toolActions={iPadQuickbarToolActions}
							zoomPercent={zoom}
						/>
					) : null}
					{iPadAuthoringSurface.visible &&
					!iPadFocusMode &&
					drawOnBinding !== undefined ? (
						<IpadMotionTransportHost
							totalFrames={totalFrames}
							isPlaying={isPlaying}
							duration={drawOnBinding.parameters.durationFrames}
							reverse={Boolean(drawOnBinding.parameters.reverse)}
							onChangeDuration={onChangeDrawOnDuration}
							onToggleReverse={onToggleDrawOnReverse}
							style={motionTransportStyle}
						/>
					) : null}
					{iPadAuthoringSurface.visible && iPadQuickMenu ? (
						<IpadQuickMenu
							actions={iPadCommandActions}
							onClose={closeIpadQuickMenu}
							state={iPadQuickMenu}
							viewportSize={viewportSize}
						/>
					) : null}
					{activeTool === "frame" && !iPadViewportVisualDietActive ? (
						<>
							<FrameDraftPreview camera={camera} />
							<FramePresetPicker
								camera={camera}
								viewportSize={viewportSize}
								onPick={(presetId, anchor) => {
									const result = commitFramePreset(presetId, anchor);
									useFrameDraftStore.getState().setPresetAnchor(null);
									if (!result) return;
									selectArtboard(result.artboardId);
									useToolSelectionStore.getState().setActiveTool("select");
								}}
							/>
						</>
					) : null}
					{pathBlurHintTarget &&
					pathBlurHintStyle &&
					!iPadViewportVisualDietActive ? (
						<PathBlurToolHint
							target={pathBlurHintTarget}
							style={pathBlurHintStyle}
						/>
					) : null}
				</div>
				{iPadPerfCapture ? <IpadPerfHud controller={iPadPerfCapture} /> : null}
			</div>
		</section>
	);
}
