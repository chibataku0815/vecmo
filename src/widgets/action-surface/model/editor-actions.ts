import type { LinkedInstancePlan } from "@/entities/component-motion/model/plan-linked-instance";
import type { GuideLine } from "@/entities/guides/model/snapping";
import type { MotionCommand } from "@/entities/motion/model/command";
import { enablePositionPath } from "@/entities/motion/model/commands";
import { buildMotionPath } from "@/entities/motion/model/motion-path";
import { findPositionPathTrack } from "@/entities/motion/model/position-path";
import type { MotionDocument } from "@/entities/motion/model/types";
import {
	currentMotionGrammarTargetNodeIds,
	useMotionGrammarStore,
} from "@/entities/motion-grammar/model/store";
import {
	ANALOG_FILM_LOOK_ID,
	ANALOG_FILM_LOOK_LABEL,
	ANALOG_FILM_LOOK_RECIPE,
} from "@/entities/motion-grammar/model/time-delay-materialization";
import type { SceneCommand } from "@/entities/scene/model/command";
import { createDefaultLayerNode } from "@/entities/scene/model/factory";
import {
	createAppendNodeCommand,
	createDeleteNodesCommand,
	createUpdateEffectIntentCommand,
} from "@/entities/scene/model/node-commands";
import { resolveFrameEffectIntent } from "@/entities/scene/model/recipe-resolve";
import {
	readSceneCameraAuthoringState,
	type SceneCameraAuthoringSelection,
} from "@/entities/scene/model/scene-camera-authoring";
import {
	findNode,
	selectArtboardIdForNode,
	selectCurrentArtboard,
} from "@/entities/scene/model/selectors";
import type { Bounds, SceneDocument } from "@/entities/scene/model/types";
import type {
	AlignAlignment,
	ArrangeAction,
	DistributeAxis,
	ZOrderDirection,
} from "@/features/arrange/model/actions";
import { selectedArrangeActionState } from "@/features/arrange/model/actions";
import {
	buildClipboardPayload,
	buildDuplicateClipboardCommand,
	buildPasteClipboardCommand,
	buildPasteOverSelectionClipboardCommand,
	type ClipboardPayload,
} from "@/features/clipboard";
import { useDrawStore } from "@/features/draw/model/draw-store";
import { shapeShortcutTargetKind } from "@/features/draw/model/shape-tool";
import { createFrameInfluenceMaskCommand } from "@/features/effect-authoring/model/effect-intent-commands";
import {
	createFrameInfluenceMaskKindOperation,
	type FrameEffectInfluenceMaskKind,
	frameInfluenceMaskKind,
	primaryFrameInfluenceAssignment,
} from "@/features/effect-authoring/model/frame-influence-authoring";
import {
	createDetachSelectionPlan,
	createMotionControllerWithSelectionPlan,
	createParentSelectionToPrimaryPlan,
	type MotionRelationAuthoringPlan,
} from "@/features/motion-parenting/model/authoring";
import {
	PATH_FINISHING_OPERATIONS,
	PATH_OPERATIONS,
	type PathFinishingOperation,
	type PathOperation,
	selectedPathFinishingState,
	selectedPathOperationState,
} from "@/features/path-ops";
import {
	createBindSceneCameraTargetNodeAuthoringPlan,
	createClearSceneCameraTargetAuthoringPlan,
	createRemoveSceneCameraAuthoringPlan,
	createSceneCameraForArtboardAuthoringPlan,
	createSetActiveSceneCameraAuthoringPlan,
	createTargetControllerForSceneCameraAuthoringPlan,
	ensureSceneCameraBeforeSpatialAuthoring,
	type SceneCameraAuthoringCommandPlan,
} from "@/features/scene-camera/model/authoring";
import {
	buildFrameNodesCommand,
	buildLayoutFrameNodesCommand,
	buildReleaseMaskCommand,
	buildUnframeNodeCommand,
	buildUseAsMaskCommand,
	type FrameIssue,
	type FrameNodesCommandResult,
	type MaskIssue,
	planSelectedObjectActions,
	type ReleaseMaskCommandResult,
	type RenameSelectedNodeIntent,
	SELECTED_OBJECT_ACTION_IDS,
	type SelectedObjectActionIssue,
	type SelectedObjectActionPlan,
	type SelectedObjectNextSelection,
	type SelectedObjectUndoPlan,
	type UnframeNodeCommandResult,
	type UseAsMaskCommandResult,
} from "@/features/structure-actions";
import {
	buildApplyStyleTransferCommand,
	buildStyleTransferPayload,
	type StyleTransferIssue,
	type StyleTransferPayload,
} from "@/features/style-transfer";
import { useToolSelectionStore } from "@/features/tool-selection/model/store";
import type { ToolId } from "@/features/tool-selection/model/tools";
import { editorTools } from "@/features/tool-selection/model/tools";
import type { FlipAxis } from "@/features/transform/model/flip";
import type { RepeatTransformPlan } from "@/features/transform/model/repeat-transform";
import {
	type ActionAvailability,
	type ActionDefinition,
	createActionRegistry,
	searchActionGroups,
} from "@/shared/actions";
import { normalizeVisualRecipe, type VisualRecipe } from "@/shared/vec-core";
import {
	canApplyRepeatTransformWorkflow,
	recordDuplicateRepeatWorkflow,
} from "@/widgets/canvas-shell/model/repeat-transform-workflow";
import {
	type LayerWorkflowActionId,
	type LayerWorkflowActionPlan,
	planLayerWorkflowActions,
} from "@/widgets/layers-panel/model/workflow-actions";
import {
	ACTIVATABLE_TOOL_IDS,
	type ActivatableToolId,
	toolReachability,
	UNAVAILABLE_TOOL_IDS,
	type UnavailableToolId,
} from "@/widgets/tool-rail/model/tool-reachability";

const toolById = new Map(editorTools.map((tool) => [tool.id, tool]));
const FRAME_LOOK_ACTION_ID =
	`effect.frame-look.${ANALOG_FILM_LOOK_ID}` as const;
const FRAME_INFLUENCE_MASK_KINDS = [
	"radialGradient",
	"linearGradient",
] as const satisfies readonly FrameEffectInfluenceMaskKind[];

type ToolActionId = ActivatableToolId | UnavailableToolId;
type ArrangeActionId =
	| `arrange.align.${AlignAlignment}`
	| `arrange.distribute.${DistributeAxis}`
	| `arrange.z-order.${ZOrderDirection}`;
type PathFinishingActionId = `path.finish.${PathFinishingOperation}`;
type StyleTransferActionId = "copy-properties" | "paste-properties";
type WorkflowActionId = `workflow.${
	| LayerWorkflowActionId
	| StyleTransferActionId}`;
type ClipboardPlacementActionId =
	| "edit.paste-in-place"
	| "edit.paste-over-selection";
type StructureActionId =
	| "structure.frame-selection"
	| "structure.grid-layout-selection"
	| "structure.unframe-selection"
	| "structure.use-as-mask"
	| "structure.release-mask";
type FrameInfluenceActionId =
	| `effect.frame-influence.${FrameEffectInfluenceMaskKind}`
	| "effect.frame-influence.remove";
type EffectActionId = typeof FRAME_LOOK_ACTION_ID | FrameInfluenceActionId;
type OpacityPercent = 10 | 20 | 30 | 40 | 50 | 60 | 70 | 80 | 90 | 100;
type StyleActionId = `style.opacity.${OpacityPercent}`;
type MotionTransportActionId =
	| "motion.toggle-playback"
	| "motion.stop-playback"
	| "motion.previous-frame"
	| "motion.next-frame"
	| "motion.first-frame"
	| "motion.last-frame";
type MotionRelationActionId =
	| "motion.create-controller"
	| "motion.parent-selection-to-primary"
	| "motion.detach-selection"
	| "motion.select-parent"
	| "motion.enable-spatial-path";
type SceneCameraActionId =
	| "scene-camera.create"
	| "scene-camera.create-with-target-null"
	| "scene-camera.create-target-null"
	| "scene-camera.bind-target-node"
	| "scene-camera.clear-target-node"
	| "scene-camera.set-active"
	| "scene-camera.clear-active"
	| "scene-camera.select-active"
	| "scene-camera.remove";

export type EditorActionSurface =
	| "command-palette"
	| "canvas-menu"
	| "layer-menu"
	| "timeline-menu";

export type EditorActionId =
	| `tool.${ToolActionId}`
	| ArrangeActionId
	| `path.${PathOperation}`
	| PathFinishingActionId
	| WorkflowActionId
	| ClipboardPlacementActionId
	| StructureActionId
	| EffectActionId
	| StyleActionId
	| "edit.cut"
	| "file.save"
	| "layer.insert"
	| "selection.select-all"
	| "selection.select-inverse"
	| "layer.rename-selection"
	| "transform.repeat"
	| "transform.flip-horizontal"
	| "transform.flip-vertical"
	| "transform.reset-bounding-box"
	| "view.toggle-bounding-box"
	| "layer.toggle-lock"
	| "layer.toggle-hide"
	| "view.toggle-panels"
	| "view.toggle-layers-panel"
	| "view.toggle-inspector-panel"
	| "view.toggle-timeline"
	| "view.toggle-look-workspace"
	| "view.toggle-visual-review"
	| "view.toggle-guides"
	| "view.toggle-grid"
	| "view.toggle-smart-guides"
	| "view.toggle-snap-to-point"
	| "selected.focus-artboard"
	| "view.zoom-in"
	| "view.zoom-out"
	| "view.zoom-to-100"
	| "view.zoom-to-selection"
	| "view.fit-artboard"
	| "view.command-palette"
	| "view.shortcut-help"
	| "history.undo"
	| "history.redo"
	| "motion.key-pose"
	| MotionTransportActionId
	| MotionRelationActionId
	| SceneCameraActionId
	| "export.bundle";

export type EditorActionContext = {
	readonly scene: SceneDocument;
	readonly activeTool: ToolId;
	readonly panelsOpen: boolean;
	readonly layersOpen: boolean;
	readonly inspectorOpen: boolean;
	readonly timelineOpen: boolean;
	readonly lookWorkspaceOpen: boolean;
	/** Show/Hide Bounding Box (⇧⌘B) — drives the toggle's checked state. */
	readonly boundingBoxHandlesVisible: boolean;
	readonly zoom: number;
	readonly panX: number;
	readonly panY: number;
	readonly selection: {
		readonly nodeIds: readonly string[];
		readonly primary: string | null;
		readonly sceneCamera: SceneCameraAuthoringSelection | null;
	};
	readonly repeatTransformPlan: RepeatTransformPlan | null;
	readonly selectionBounds: Bounds | null;
	readonly clipboardPayload: ClipboardPayload | null;
	readonly styleTransferPayload: StyleTransferPayload | null;
	readonly guideLines: readonly GuideLine[];
	/** Global guide-line visibility preference (the master show/hide switch). */
	readonly guideLinesVisible: boolean;
	/**
	 * Combined grid visibility — true when EITHER the workspace/desk grid or the
	 * artboard layout grid is showing. Drives the Show/hide grid toggle's checked
	 * state so it reflects the single user-facing "grid", not one of the two flags.
	 */
	readonly gridVisible: boolean;
	/** Smart Guides on/off (Cmd+U) — drives the toggle's checked state. */
	readonly smartGuides: boolean;
	/** Snap to Point on/off — drives the toggle's checked state. */
	readonly snapToPoint: boolean;
	readonly motion: {
		readonly currentFrame: number;
		readonly durationFrames: number;
		readonly isPlaying: boolean;
	};
	readonly motionDocument: MotionDocument;
	readonly canUndo: boolean;
	readonly canRedo: boolean;
	readonly canExport: boolean;
	readonly saveAvailable: boolean;
};

export type EditorActionRuntime = {
	readonly setActiveTool: (tool: ToolId) => void;
	readonly togglePanels: () => void;
	readonly toggleLayersPanel: () => void;
	readonly toggleInspectorPanel: () => void;
	readonly toggleTimeline: () => void;
	readonly toggleLookWorkspace: () => void;
	readonly toggleVisualReview: () => void;
	readonly toggleShortcutHelp: () => void;
	readonly toggleCommandPalette: () => void;
	readonly zoomIn: () => void;
	readonly zoomOut: () => void;
	readonly zoomTo100: () => void;
	readonly zoomToSelection: (bounds: Bounds) => void;
	readonly resetViewport: () => void;
	readonly undo: () => void;
	readonly redo: () => void;
	readonly arrangeNodes: (
		nodeIds: readonly string[],
		action: ArrangeAction,
	) => void;
	readonly selectAll: () => void;
	readonly selectInverse: () => void;
	readonly selectNodes: (
		nodeIds: readonly string[],
		primaryNodeId?: string | null,
	) => void;
	readonly applyMotionRelationPlan: (plan: MotionRelationAuthoringPlan) => void;
	readonly applyMotionCommand: (command: MotionCommand) => void;
	readonly flipNodes: (nodeIds: readonly string[], axis: FlipAxis) => void;
	readonly resetBoundingBox: (nodeIds: readonly string[]) => void;
	readonly toggleBoundingBox: () => void;
	readonly toggleNodesLocked: (nodeIds: readonly string[]) => void;
	readonly toggleNodesVisibility: (nodeIds: readonly string[]) => void;
	readonly setSelectedOpacity: (
		nodeIds: readonly string[],
		opacity: number,
	) => void;
	readonly togglePlayback: () => void;
	readonly stopPlayback: () => void;
	readonly setMotionFrame: (frame: number) => void;
	readonly keyNodePose: (nodeId: string) => void;
	readonly applySceneCameraPlan: (
		plan: SceneCameraAuthoringCommandPlan,
		selection?: SceneCameraAuthoringSelection | null,
	) => void;
	readonly selectSceneCamera: (
		selection: SceneCameraAuthoringSelection | null,
	) => void;
	readonly performPathOperation: (
		operation: PathOperation,
		selection: EditorActionContext["selection"],
	) => void;
	readonly performPathFinishingOperation: (
		operation: PathFinishingOperation,
		selection: EditorActionContext["selection"],
	) => void;
	readonly setWorkflowClipboardPayload: (payload: ClipboardPayload) => void;
	readonly setStyleTransferPayload: (payload: StyleTransferPayload) => void;
	readonly applyWorkflowCommand: (
		command: SceneCommand,
		selectNodeIds: readonly string[],
		primaryNodeId?: string | null,
	) => SceneDocument;
	readonly applyWorkflowCommands: (
		commands: readonly SceneCommand[],
		selectNodeIds: readonly string[],
		transaction?: SelectedObjectUndoPlan,
		primaryNodeId?: string | null,
	) => void;
	readonly applyLinkedInstancePlan: (plan: LinkedInstancePlan) => void;
	readonly applyStyleTransferCommand: (
		command: SceneCommand,
		selectNodeIds: readonly string[],
	) => void;
	readonly requestSelectedObjectRename: (
		intent: RenameSelectedNodeIntent,
	) => void;
	readonly repeatTransform: (
		plan: RepeatTransformPlan | null,
		nodeIds: readonly string[],
	) => void;
	readonly applyEffectIntentCommand: (command: SceneCommand) => void;
	readonly toggleGuideLinesVisible: () => void;
	/** Flips the combined workspace + artboard grid via the guide store. */
	readonly toggleGrid: () => void;
	readonly toggleSmartGuides: () => void;
	readonly toggleSnapToPoint: () => void;
	readonly exportCurrentState: () => void;
	readonly save: () => void;
};

export type EditorAction = ActionDefinition<
	EditorActionContext,
	EditorActionRuntime,
	EditorActionId
> & {
	readonly surfaces: readonly EditorActionSurface[];
};

const groups = {
	tools: { id: "tools", label: "Tools" },
	selection: { id: "selection", label: "Selection" },
	arrange: { id: "arrange", label: "Arrange" },
	transform: { id: "transform", label: "Transform" },
	layer: { id: "layer", label: "Layer" },
	style: { id: "style", label: "Style" },
	workflow: { id: "workflow", label: "Workflow" },
	effects: { id: "effects", label: "Effects" },
	view: { id: "view", label: "View" },
	history: { id: "history", label: "History" },
	path: { id: "path", label: "Path" },
	motion: { id: "motion", label: "Motion" },
	camera: { id: "camera", label: "Camera" },
	export: { id: "export", label: "Export" },
} as const;

const commandPalette = ["command-palette"] as const;
const commandPaletteAndCanvas = ["command-palette", "canvas-menu"] as const;
const workflowSurfaces = [
	"command-palette",
	"canvas-menu",
	"layer-menu",
] as const;

const visualRecipeSignature = (recipe: VisualRecipe | null): string | null =>
	recipe ? JSON.stringify(recipe) : null;

const ANALOG_FILM_LOOK_SIGNATURE = JSON.stringify(
	normalizeVisualRecipe(ANALOG_FILM_LOOK_RECIPE),
);

const frameLookChecked = (context: EditorActionContext): boolean =>
	visualRecipeSignature(
		resolveFrameEffectIntent(context.scene).visualRecipe,
	) === ANALOG_FILM_LOOK_SIGNATURE;

const frameInfluenceLabel = (kind: FrameEffectInfluenceMaskKind): string =>
	kind === "radialGradient" ? "radial" : "linear";

const frameInfluenceAssignment = (context: EditorActionContext) =>
	primaryFrameInfluenceAssignment(
		resolveFrameEffectIntent(context.scene).influenceRecipe,
	);

const frameInfluenceChecked =
	(kind: FrameEffectInfluenceMaskKind) =>
	(context: EditorActionContext): boolean =>
		frameInfluenceMaskKind(frameInfluenceAssignment(context)) === kind;

const alignmentActions = [
	{
		alignment: "left",
		label: "Align left",
		shortcut: { key: "a", modifiers: ["alt"] },
		keywords: ["left", "x"],
	},
	{
		alignment: "center",
		label: "Align center",
		shortcut: { key: "h", modifiers: ["alt"] },
		keywords: ["center", "x"],
	},
	{
		alignment: "right",
		label: "Align right",
		shortcut: { key: "d", modifiers: ["alt"] },
		keywords: ["right", "x"],
	},
	{
		alignment: "top",
		label: "Align top",
		shortcut: { key: "w", modifiers: ["alt"] },
		keywords: ["top", "y"],
	},
	{
		alignment: "middle",
		label: "Align middle",
		shortcut: { key: "v", modifiers: ["alt"] },
		keywords: ["middle", "y"],
	},
	{
		alignment: "bottom",
		label: "Align bottom",
		shortcut: { key: "s", modifiers: ["alt"] },
		keywords: ["bottom", "y"],
	},
] as const satisfies readonly {
	readonly alignment: AlignAlignment;
	readonly label: string;
	readonly shortcut: {
		readonly key: string;
		readonly modifiers: readonly ["alt"];
	};
	readonly keywords: readonly string[];
}[];

const distributeActions = [
	{
		axis: "horizontal",
		label: "Distribute horizontally",
		shortcut: { key: "h", modifiers: ["mod", "alt"] },
		keywords: ["spacing", "gap", "x"],
	},
	{
		axis: "vertical",
		label: "Distribute vertically",
		shortcut: { key: "v", modifiers: ["mod", "alt"] },
		keywords: ["spacing", "gap", "y"],
	},
] as const satisfies readonly {
	readonly axis: DistributeAxis;
	readonly label: string;
	readonly shortcut: {
		readonly key: string;
		readonly modifiers: readonly ["mod", "alt"];
	};
	readonly keywords: readonly string[];
}[];

const zOrderActions = [
	{
		direction: "forward",
		label: "Bring forward",
		shortcut: { key: "]", modifiers: ["mod"] },
		keywords: ["front", "raise", "stack"],
	},
	{
		direction: "backward",
		label: "Send backward",
		shortcut: { key: "[", modifiers: ["mod"] },
		keywords: ["back", "lower", "stack"],
	},
	{
		// Cmd+Shift+] = jump to the front (Figma/Illustrator standard). Matchable
		// only because the matcher now resolves the physical BracketRight code
		// (Shift+] yields `}`, so an event.key chord could never match). Crucially
		// this leaves BARE `[`/`]` unbound here so the timeline keyframe navigation
		// is no longer pre-empted by the capture-phase action listener.
		direction: "to-front",
		label: "Bring to front",
		shortcut: { key: "]", modifiers: ["mod", "shift"] },
		keywords: ["front", "top", "stack"],
	},
	{
		direction: "to-back",
		label: "Send to back",
		shortcut: { key: "[", modifiers: ["mod", "shift"] },
		keywords: ["back", "bottom", "stack"],
	},
] as const satisfies readonly {
	readonly direction: ZOrderDirection;
	readonly label: string;
	readonly shortcut: {
		readonly key: string;
		readonly modifiers: readonly ("mod" | "shift" | "alt")[];
	};
	readonly keywords: readonly string[];
}[];

const pathOperationLabels = {
	union: "Union paths",
	subtract: "Subtract paths",
	intersect: "Intersect paths",
	exclude: "Exclude overlap",
} as const satisfies Record<PathOperation, string>;

const pathOperationKeywords = {
	union: ["boolean", "pathfinder", "combine", "merge", "shape"],
	subtract: ["boolean", "pathfinder", "minus", "cut", "shape"],
	intersect: ["boolean", "pathfinder", "overlap", "shape"],
	exclude: ["boolean", "pathfinder", "xor", "compound", "shape"],
} as const satisfies Record<PathOperation, readonly string[]>;

const pathFinishingMetadata = {
	flatten: {
		label: "Flatten paths",
		shortcut: { key: "e", modifiers: ["mod"] },
		keywords: ["flatten", "expand", "bake", "convert"],
	},
	"outline-stroke": {
		label: "Outline stroke",
		shortcut: { key: "o", modifiers: ["mod", "shift"] },
		keywords: ["outline", "stroke", "expand", "convert"],
	},
	"swap-fill-stroke": {
		label: "Swap fill and stroke",
		shortcut: { key: "x", modifiers: ["shift"] },
		keywords: ["swap", "fill", "stroke", "paint"],
	},
	"remove-fill": {
		label: "Remove fill",
		shortcut: { key: "/", modifiers: ["alt"] },
		keywords: ["remove", "fill", "none", "paint"],
	},
	"remove-stroke": {
		label: "Remove stroke",
		shortcut: { key: "/" },
		keywords: ["remove", "stroke", "none", "paint"],
	},
} as const satisfies Record<
	PathFinishingOperation,
	{
		readonly label: string;
		readonly shortcut: {
			readonly key: string;
			readonly modifiers?: readonly ("mod" | "shift" | "alt")[];
		};
		readonly keywords: readonly string[];
	}
>;

const workflowActionMetadata = [
	{
		id: "group",
		label: "Group selection",
		shortcut: { key: "g", modifiers: ["mod"] },
		keywords: ["group", "layers", "selection"],
	},
	{
		id: "ungroup",
		label: "Ungroup selection",
		shortcut: { key: "g", modifiers: ["mod", "shift"] },
		keywords: ["ungroup", "layers", "release"],
	},
	{
		id: "copy",
		label: "Copy selection",
		shortcut: { key: "c", modifiers: ["mod"] },
		keywords: ["clipboard", "copy", "layers"],
	},
	{
		id: "paste",
		label: "Paste",
		shortcut: { key: "v", modifiers: ["mod"] },
		keywords: ["clipboard", "paste", "insert"],
	},
	{
		id: "duplicate",
		label: "Duplicate selection",
		shortcut: undefined,
		keywords: ["clipboard", "duplicate", "copy", "layers"],
	},
	{
		id: "delete",
		label: "Delete selection",
		shortcut: undefined,
		keywords: ["delete", "remove", "clear", "trash"],
	},
	{
		id: "component-source",
		label: "Create component",
		shortcut: { key: "k", modifiers: ["mod", "alt"] },
		keywords: ["component", "symbol", "source", "make"],
	},
	{
		id: "component-instance",
		label: "Create component instance",
		shortcut: undefined,
		keywords: ["component", "symbol", "instance", "copy"],
	},
	{
		id: "component-detach",
		label: "Detach instance",
		shortcut: { key: "b", modifiers: ["mod", "alt"] },
		keywords: ["component", "symbol", "instance", "detach", "release"],
	},
] as const satisfies readonly {
	readonly id: LayerWorkflowActionId;
	readonly label: string;
	readonly shortcut?: {
		readonly key: string;
		readonly modifiers: readonly ("mod" | "shift" | "alt")[];
	};
	readonly keywords: readonly string[];
}[];

const styleTransferActionMetadata = [
	{
		id: "copy-properties",
		label: "Copy appearance",
		shortcut: { key: "c", modifiers: ["mod", "alt"] },
		keywords: [
			"copy",
			"properties",
			"style",
			"appearance",
			"look",
			"match",
			"inherit",
		],
	},
	{
		id: "paste-properties",
		label: "Paste appearance",
		shortcut: { key: "v", modifiers: ["mod", "alt", "shift"] },
		keywords: [
			"paste",
			"properties",
			"style",
			"appearance",
			"look",
			"match",
			"inherit",
		],
	},
] as const satisfies readonly {
	readonly id: StyleTransferActionId;
	readonly label: string;
	readonly shortcut?: {
		readonly key: string;
		readonly modifiers: readonly ("mod" | "alt" | "shift")[];
	};
	readonly keywords: readonly string[];
}[];

const opacityShortcutActions = [
	{ digit: "1", percent: 10, opacity: 0.1 },
	{ digit: "2", percent: 20, opacity: 0.2 },
	{ digit: "3", percent: 30, opacity: 0.3 },
	{ digit: "4", percent: 40, opacity: 0.4 },
	{ digit: "5", percent: 50, opacity: 0.5 },
	{ digit: "6", percent: 60, opacity: 0.6 },
	{ digit: "7", percent: 70, opacity: 0.7 },
	{ digit: "8", percent: 80, opacity: 0.8 },
	{ digit: "9", percent: 90, opacity: 0.9 },
	{ digit: "0", percent: 100, opacity: 1 },
] as const satisfies readonly {
	readonly digit: string;
	readonly percent: OpacityPercent;
	readonly opacity: number;
}[];

const arrangeAvailability =
	(action: ArrangeAction) =>
	(context: EditorActionContext): ActionAvailability => {
		const state = selectedArrangeActionState(
			context.scene,
			context.selection.nodeIds,
			action,
		);
		return state.enabled
			? { enabled: true }
			: { enabled: false, reason: state.reason };
	};

const layerWorkflowActionPlan = (
	context: EditorActionContext,
	actionId: LayerWorkflowActionId,
): LayerWorkflowActionPlan =>
	planLayerWorkflowActions({
		document: context.scene,
		selectedNodeIds: context.selection.nodeIds,
		primaryNodeId: context.selection.primary,
		clipboardPayload: context.clipboardPayload,
		grammarBindings: useMotionGrammarStore.getState().document.bindings,
	})[actionId];

const workflowUnavailableReason = (
	plan: Extract<LayerWorkflowActionPlan, { readonly enabled: false }>,
): string =>
	plan.disabledReason?.message ?? `${plan.id} is unavailable right now.`;

const selectedObjectActionPlans = (context: EditorActionContext) =>
	planSelectedObjectActions({
		document: context.scene,
		selectedNodeIds: context.selection.nodeIds,
		primaryNodeId: context.selection.primary,
	});

const selectedObjectPlanFor = (
	context: EditorActionContext,
	actionId: (typeof SELECTED_OBJECT_ACTION_IDS)[keyof typeof SELECTED_OBJECT_ACTION_IDS],
): SelectedObjectActionPlan => {
	const plans = selectedObjectActionPlans(context);
	switch (actionId) {
		case SELECTED_OBJECT_ACTION_IDS.delete:
			return plans.delete;
		case SELECTED_OBJECT_ACTION_IDS.duplicate:
			return plans.duplicate;
		case SELECTED_OBJECT_ACTION_IDS.toggleLock:
			return plans.toggleLock;
		case SELECTED_OBJECT_ACTION_IDS.toggleVisibility:
			return plans.toggleVisibility;
		case SELECTED_OBJECT_ACTION_IDS.rename:
			return plans.rename;
		case SELECTED_OBJECT_ACTION_IDS.focusArtboard:
			return plans.focusArtboard;
	}
};

const selectedObjectAvailability =
	(
		actionId: (typeof SELECTED_OBJECT_ACTION_IDS)[keyof typeof SELECTED_OBJECT_ACTION_IDS],
	) =>
	(context: EditorActionContext): ActionAvailability => {
		const plan = selectedObjectPlanFor(context, actionId);
		return plan.enabled
			? { enabled: true }
			: {
					enabled: false,
					reason:
						plan.disabledReason?.message ??
						`${plan.label} is unavailable right now.`,
				};
	};

const repeatTransformAvailability = (
	context: EditorActionContext,
): ActionAvailability => {
	const plan = context.repeatTransformPlan;
	if (!plan) {
		return {
			enabled: false,
			reason: "Transform or duplicate something first.",
		};
	}
	if (context.selection.nodeIds.length === 0) {
		return { enabled: false, reason: "Select a layer to transform again." };
	}
	return canApplyRepeatTransformWorkflow(
		context.scene,
		context.selection.nodeIds,
		plan,
	)
		? { enabled: true }
		: {
				enabled: false,
				reason: "The current selection cannot be transformed.",
			};
};

const selectedCameraRigId = (
	selection: SceneCameraAuthoringSelection | null,
): string | null => {
	if (!selection) return null;
	if ("cameraRigId" in selection) return selection.cameraRigId ?? null;
	return null;
};

const activeSceneCameraRigId = (context: EditorActionContext): string | null =>
	readSceneCameraAuthoringState(context.scene).activeCameraRigId ?? null;

const cameraRigIdForCameraAction = (
	context: EditorActionContext,
): string | null =>
	selectedCameraRigId(context.selection.sceneCamera) ??
	activeSceneCameraRigId(context);

const activeSceneCameraSelection = (
	context: EditorActionContext,
): SceneCameraAuthoringSelection | null => {
	const cameraRigId = activeSceneCameraRigId(context);
	return cameraRigId ? { kind: "camera-rig", cameraRigId } : null;
};

const createSceneCameraPlan = (
	context: EditorActionContext,
	withTargetController: boolean,
): SceneCameraAuthoringCommandPlan | null =>
	createSceneCameraForArtboardAuthoringPlan(context.scene, {
		artboardId: selectCurrentArtboard(context.scene).id,
		withTargetController,
	});

const selectedCameraAvailability = (
	context: EditorActionContext,
): ActionAvailability =>
	cameraRigIdForCameraAction(context)
		? { enabled: true }
		: { enabled: false, reason: "Select or activate a scene camera first." };

const selectedCameraOnlyAvailability = (
	context: EditorActionContext,
): ActionAvailability =>
	selectedCameraRigId(context.selection.sceneCamera)
		? { enabled: true }
		: { enabled: false, reason: "Select a scene camera first." };

const activeCameraAvailability = (
	context: EditorActionContext,
): ActionAvailability =>
	activeSceneCameraRigId(context)
		? { enabled: true }
		: { enabled: false, reason: "No active scene camera on this artboard." };

const targetNodeAvailability = (
	context: EditorActionContext,
): ActionAvailability => {
	const cameraRigId = cameraRigIdForCameraAction(context);
	if (!cameraRigId) {
		return {
			enabled: false,
			reason: "Select or activate a scene camera first.",
		};
	}
	if (!context.selection.primary) {
		return { enabled: false, reason: "Select a layer to use as the target." };
	}
	return { enabled: true };
};

type SelectedObjectResolvedSelection = {
	readonly nodeIds: readonly string[];
	readonly primaryNodeId: string | null;
};

const selectedObjectSelection = (
	nextSelection: SelectedObjectNextSelection,
	fallbackNodeIds: readonly string[],
): SelectedObjectResolvedSelection => {
	switch (nextSelection.kind) {
		case "preserve":
		case "replace":
		case "focus-artboard":
			return {
				nodeIds: nextSelection.nodeIds,
				primaryNodeId: nextSelection.primaryNodeId,
			};
		case "clear":
			return { nodeIds: [], primaryNodeId: null };
		case "command-result":
			return {
				nodeIds: fallbackNodeIds,
				primaryNodeId: fallbackNodeIds.at(-1) ?? null,
			};
	}
};

const executeSelectedObjectAction = (
	runtime: EditorActionRuntime,
	context: EditorActionContext,
	actionId: (typeof SELECTED_OBJECT_ACTION_IDS)[keyof typeof SELECTED_OBJECT_ACTION_IDS],
): void => {
	const plan = selectedObjectPlanFor(context, actionId);
	if (!plan.enabled) return;
	const { execution } = plan;
	if (execution.kind === "scene-command") {
		const selection = selectedObjectSelection(
			plan.nextSelection,
			plan.report.targetNodeIds,
		);
		runtime.applyWorkflowCommand(
			execution.command,
			selection.nodeIds,
			selection.primaryNodeId,
		);
		return;
	}
	if (execution.kind === "scene-commands") {
		const selection = selectedObjectSelection(
			plan.nextSelection,
			plan.report.targetNodeIds,
		);
		runtime.applyWorkflowCommands(
			execution.commands,
			selection.nodeIds,
			execution.transaction,
			selection.primaryNodeId,
		);
		return;
	}
	if (execution.kind === "command-factory") {
		const result = buildDuplicateClipboardCommand(
			context.scene,
			execution.input.sourceNodeIds,
			{ offset: execution.input.offset },
		);
		if (!result.ok) return;
		const document = runtime.applyWorkflowCommand(
			result.command,
			result.newRootNodeIds,
			result.newRootNodeIds.at(-1) ?? null,
		);
		recordDuplicateRepeatWorkflow({
			sourceDocument: context.scene,
			sourceNodeIds: execution.input.sourceNodeIds,
			duplicateNodeIds: result.newRootNodeIds,
			document,
		});
		return;
	}
	if (execution.kind === "ui-intent") {
		if (execution.intent.kind === "start-node-rename") {
			runtime.requestSelectedObjectRename(execution.intent);
		}
	}
};

const workflowAvailability =
	(actionId: LayerWorkflowActionId) =>
	(context: EditorActionContext): ActionAvailability => {
		if (actionId === "delete") {
			return selectedObjectAvailability(SELECTED_OBJECT_ACTION_IDS.delete)(
				context,
			);
		}
		if (actionId === "duplicate") {
			return selectedObjectAvailability(SELECTED_OBJECT_ACTION_IDS.duplicate)(
				context,
			);
		}
		const plan = layerWorkflowActionPlan(context, actionId);
		return plan.enabled
			? { enabled: true }
			: { enabled: false, reason: workflowUnavailableReason(plan) };
	};

const firstStructureIssueReason = (
	issues: readonly (FrameIssue | MaskIssue | SelectedObjectActionIssue)[],
	fallback: string,
): string => issues[0]?.message ?? fallback;

const frameActionResult = (
	context: EditorActionContext,
	actionId: "frame-selection" | "unframe-selection",
): FrameNodesCommandResult | UnframeNodeCommandResult =>
	actionId === "frame-selection"
		? buildFrameNodesCommand(context.scene, context.selection.nodeIds)
		: buildUnframeNodeCommand(
				context.scene,
				context.selection.primary ?? context.selection.nodeIds[0] ?? "",
			);

const frameActionAvailability =
	(actionId: "frame-selection" | "unframe-selection") =>
	(context: EditorActionContext): ActionAvailability => {
		const result = frameActionResult(context, actionId);
		return result.ok
			? { enabled: true }
			: {
					enabled: false,
					reason: firstStructureIssueReason(
						result.issues,
						actionId === "frame-selection"
							? "Wrap in frame is unavailable right now."
							: "Unframe is unavailable right now.",
					),
				};
	};

const layoutFrameActionAvailability = (
	context: EditorActionContext,
): ActionAvailability => {
	const result = buildLayoutFrameNodesCommand(
		context.scene,
		context.selection.nodeIds,
	);
	return result.ok
		? { enabled: true }
		: {
				enabled: false,
				reason: firstStructureIssueReason(
					result.issues,
					"Select sibling objects to wrap in a grid layout.",
				),
			};
};

const maskActionResult = (
	context: EditorActionContext,
	actionId: "use-as-mask" | "release-mask",
): UseAsMaskCommandResult | ReleaseMaskCommandResult =>
	actionId === "use-as-mask"
		? buildUseAsMaskCommand(context.scene, context.selection.nodeIds)
		: buildReleaseMaskCommand(
				context.scene,
				context.selection.primary ?? context.selection.nodeIds[0] ?? null,
			);

const maskActionAvailability =
	(actionId: "use-as-mask" | "release-mask") =>
	(context: EditorActionContext): ActionAvailability => {
		const result = maskActionResult(context, actionId);
		return result.ok
			? { enabled: true }
			: {
					enabled: false,
					reason: firstStructureIssueReason(
						result.issues,
						actionId === "use-as-mask"
							? "Use as mask is unavailable right now."
							: "Release mask is unavailable right now.",
					),
				};
	};

const styleTransferSourceNodeId = (
	context: EditorActionContext,
): string | null =>
	context.selection.primary ?? context.selection.nodeIds[0] ?? null;

const styleTransferUnavailableReason = (
	issues: readonly StyleTransferIssue[],
	fallback: string,
): string =>
	issues.find((issue) => issue.severity === "error")?.message ??
	issues[0]?.message ??
	fallback;

const styleTransferAvailability =
	(actionId: StyleTransferActionId) =>
	(context: EditorActionContext): ActionAvailability => {
		if (actionId === "copy-properties") {
			const result = buildStyleTransferPayload(
				context.scene,
				styleTransferSourceNodeId(context),
			);
			return result.ok
				? { enabled: true }
				: {
						enabled: false,
						reason: styleTransferUnavailableReason(
							result.issues,
							"Copy properties is unavailable right now.",
						),
					};
		}

		if (!context.styleTransferPayload) {
			return {
				enabled: false,
				reason: "Copy properties before pasting properties.",
			};
		}

		const result = buildApplyStyleTransferCommand(
			context.scene,
			context.styleTransferPayload,
			context.selection.nodeIds,
			{
				grammarTargetNodeIds: currentMotionGrammarTargetNodeIds(),
				motion: context.motionDocument,
			},
		);
		return result.ok
			? { enabled: true }
			: {
					enabled: false,
					reason: styleTransferUnavailableReason(
						result.issues,
						"Paste properties is unavailable right now.",
					),
				};
	};

const currentMotionFrame = (context: EditorActionContext): number =>
	Number.isFinite(context.motion.currentFrame)
		? Math.max(0, Math.round(context.motion.currentFrame))
		: 0;

const lastMotionFrame = (context: EditorActionContext): number =>
	Math.max(0, Math.round(context.motion.durationFrames) - 1);

const clampedMotionFrame = (
	context: EditorActionContext,
	frame: number,
): number => Math.max(0, Math.min(lastMotionFrame(context), frame));

const stepMotionFrame = (
	context: EditorActionContext,
	deltaFrames: number,
): number =>
	clampedMotionFrame(context, currentMotionFrame(context) + deltaFrames);

const frameAvailability = (
	context: EditorActionContext,
	targetFrame: number,
	boundaryReason: string,
): ActionAvailability =>
	targetFrame === currentMotionFrame(context)
		? { enabled: false, reason: boundaryReason }
		: { enabled: true };

/**
 * Shape tool activation shared by the `R` shortcut and the "Shape tool" command.
 * Entering the tool from elsewhere keeps the current/last shape kind so the rail
 * selection is honored; re-invoking while the shape tool is already active
 * advances to the next kind (rect → ellipse → line → polygon → star → rect).
 * The rail's shape flyout drives the same kind state, so the on-screen grouping
 * and the single-key cycle stay in lockstep.
 */
const activateOrCycleShapeTool = (runtime: EditorActionRuntime): void => {
	const draw = useDrawStore.getState();
	const shapeToolActive =
		useToolSelectionStore.getState().activeTool === "shape";
	draw.setShapeKind(shapeShortcutTargetKind(shapeToolActive, draw.shapeKind));
	runtime.setActiveTool("shape");
};

const activatableToolActions = ACTIVATABLE_TOOL_IDS.map((toolId) => {
	const tool = toolById.get(toolId);
	if (!tool) throw new Error(`Missing tool metadata for ${toolId}`);
	const reachability = toolReachability(toolId);
	if (reachability.kind !== "activatable") {
		throw new Error(`Tool ${toolId} must be activatable.`);
	}
	return {
		id: `tool.${toolId}`,
		label: `${tool.label} tool`,
		group: groups.tools,
		shortcut: reachability.shortcut,
		keywords: ["tool", tool.id, tool.label, ...reachability.keywords],
		surfaces: ["command-palette", "canvas-menu"],
		checked: (context) => context.activeTool === toolId,
		execute:
			toolId === "shape"
				? activateOrCycleShapeTool
				: (runtime) => runtime.setActiveTool(toolId),
	} satisfies EditorAction;
});

const unavailableToolActions = UNAVAILABLE_TOOL_IDS.map((toolId) => {
	const tool = toolById.get(toolId);
	if (!tool) throw new Error(`Missing tool metadata for ${toolId}`);
	const reachability = toolReachability(toolId);
	if (reachability.kind !== "unavailable") {
		throw new Error(`Tool ${toolId} must be unavailable.`);
	}
	return {
		id: `tool.${toolId}`,
		label: `${tool.label} tool`,
		group: groups.tools,
		keywords: ["tool", tool.id, tool.label, ...reachability.keywords],
		surfaces: commandPalette,
		availability: () => ({ enabled: false, reason: reachability.reason }),
		execute: () => undefined,
	} satisfies EditorAction;
});

const alignEditorActions = alignmentActions.map(
	({ alignment, label, shortcut, keywords }) => {
		const action = {
			kind: "align",
			alignment,
		} as const satisfies ArrangeAction;
		return {
			id: `arrange.align.${alignment}`,
			label,
			group: groups.arrange,
			shortcut,
			keywords: ["arrange", "align", ...keywords],
			surfaces: commandPaletteAndCanvas,
			availability: arrangeAvailability(action),
			execute: (runtime, context) =>
				runtime.arrangeNodes(context.selection.nodeIds, action),
		} satisfies EditorAction;
	},
);

const distributeEditorActions = distributeActions.map(
	({ axis, label, shortcut, keywords }) => {
		const action = {
			kind: "distribute",
			axis,
		} as const satisfies ArrangeAction;
		return {
			id: `arrange.distribute.${axis}`,
			label,
			group: groups.arrange,
			shortcut,
			keywords: ["arrange", "distribute", ...keywords],
			surfaces: commandPaletteAndCanvas,
			availability: arrangeAvailability(action),
			execute: (runtime, context) =>
				runtime.arrangeNodes(context.selection.nodeIds, action),
		} satisfies EditorAction;
	},
);

const zOrderEditorActions = zOrderActions.map(
	({ direction, label, shortcut, keywords }) => {
		const action = {
			kind: "z-order",
			direction,
		} as const satisfies ArrangeAction;
		return {
			id: `arrange.z-order.${direction}`,
			label,
			group: groups.arrange,
			shortcut,
			keywords: ["arrange", "order", "z-order", ...keywords],
			surfaces: commandPaletteAndCanvas,
			availability: arrangeAvailability(action),
			execute: (runtime, context) =>
				runtime.arrangeNodes(context.selection.nodeIds, action),
		} satisfies EditorAction;
	},
);

const pathOperationActions = PATH_OPERATIONS.map((operation) => ({
	id: `path.${operation}` as const,
	label: pathOperationLabels[operation],
	group: groups.path,
	keywords: ["path", operation, ...pathOperationKeywords[operation]],
	surfaces: ["command-palette", "canvas-menu"],
	availability: (context) => {
		const state = selectedPathOperationState(
			context.scene,
			operation,
			context.selection,
		);
		return state.enabled
			? { enabled: true }
			: { enabled: false, reason: state.reason };
	},
	execute: (runtime, context) => {
		const state = selectedPathOperationState(
			context.scene,
			operation,
			context.selection,
		);
		if (!state.enabled) return;
		runtime.performPathOperation(operation, context.selection);
	},
})) satisfies readonly EditorAction[];

const pathFinishingActions = PATH_FINISHING_OPERATIONS.map((operation) => {
	const metadata = pathFinishingMetadata[operation];
	return {
		id: `path.finish.${operation}` as const,
		label: metadata.label,
		group: groups.path,
		shortcut: metadata.shortcut,
		keywords: ["path", "finish", operation, ...metadata.keywords],
		surfaces: commandPaletteAndCanvas,
		availability: (context) => {
			const state = selectedPathFinishingState(
				context.scene,
				operation,
				context.selection,
			);
			return state.enabled
				? { enabled: true }
				: { enabled: false, reason: state.reason };
		},
		execute: (runtime, context) => {
			const state = selectedPathFinishingState(
				context.scene,
				operation,
				context.selection,
			);
			if (!state.enabled) return;
			runtime.performPathFinishingOperation(operation, context.selection);
		},
	} satisfies EditorAction;
});

const workflowEditorActions = workflowActionMetadata.map(
	({ id, label, shortcut, keywords }) =>
		({
			id: `workflow.${id}`,
			label,
			group: groups.workflow,
			shortcut,
			keywords: ["workflow", ...keywords],
			surfaces: workflowSurfaces,
			availability: workflowAvailability(id),
			execute: (runtime, context) => {
				if (id === "delete") {
					executeSelectedObjectAction(
						runtime,
						context,
						SELECTED_OBJECT_ACTION_IDS.delete,
					);
					return;
				}
				if (id === "duplicate") {
					executeSelectedObjectAction(
						runtime,
						context,
						SELECTED_OBJECT_ACTION_IDS.duplicate,
					);
					return;
				}
				const plan = layerWorkflowActionPlan(context, id);
				if (!plan.enabled) return;
				if (plan.id === "copy") {
					runtime.setWorkflowClipboardPayload(plan.payload);
					return;
				}
				if ("linkedInstance" in plan && plan.linkedInstance) {
					runtime.applyLinkedInstancePlan(plan.linkedInstance);
					return;
				}
				runtime.applyWorkflowCommand(plan.command, plan.selectNodeIds);
			},
		}) satisfies EditorAction,
);

const styleTransferEditorActions = styleTransferActionMetadata.map(
	({ id, label, shortcut, keywords }) =>
		({
			id: `workflow.${id}`,
			label,
			group: groups.workflow,
			shortcut,
			keywords: ["workflow", ...keywords],
			surfaces: workflowSurfaces,
			availability: styleTransferAvailability(id),
			execute: (runtime, context) => {
				if (id === "copy-properties") {
					const result = buildStyleTransferPayload(
						context.scene,
						styleTransferSourceNodeId(context),
					);
					if (!result.ok) return;
					runtime.setStyleTransferPayload(result.payload);
					return;
				}
				if (!context.styleTransferPayload) return;
				const result = buildApplyStyleTransferCommand(
					context.scene,
					context.styleTransferPayload,
					context.selection.nodeIds,
					{
						grammarTargetNodeIds: currentMotionGrammarTargetNodeIds(),
						motion: context.motionDocument,
					},
				);
				if (!result.ok) return;
				runtime.applyStyleTransferCommand(
					result.command,
					result.appliedTargetNodeIds,
				);
			},
		}) satisfies EditorAction,
);

const frameLookEditorAction = {
	id: FRAME_LOOK_ACTION_ID,
	label: `Apply ${ANALOG_FILM_LOOK_LABEL} to current frame`,
	group: groups.effects,
	keywords: [
		"look",
		"film",
		"grain",
		"effect",
		"intent",
		"frame",
		"artboard",
		"cinematic",
		"chromatic",
		ANALOG_FILM_LOOK_ID,
		ANALOG_FILM_LOOK_LABEL,
	],
	surfaces: commandPalette,
	availability: () => ({ enabled: true }),
	checked: frameLookChecked,
	execute: (runtime) =>
		runtime.applyEffectIntentCommand(
			createUpdateEffectIntentCommand(
				{ scope: "current-artboard" },
				{ visualRecipe: ANALOG_FILM_LOOK_RECIPE },
				{ label: `Apply ${ANALOG_FILM_LOOK_LABEL} frame look` },
			),
		),
} satisfies EditorAction;

const opacityEditorActions = opacityShortcutActions.map(
	({ digit, percent, opacity }) =>
		({
			id: `style.opacity.${percent}` as const,
			label: `Set opacity to ${percent}%`,
			group: groups.style,
			shortcut: { key: digit },
			keywords: [
				"opacity",
				"transparency",
				"alpha",
				"style",
				`${percent}`,
				`${percent}%`,
			],
			surfaces: commandPaletteAndCanvas,
			availability: (context) =>
				context.selection.nodeIds.length > 0
					? { enabled: true }
					: { enabled: false, reason: "Select a layer to set opacity." },
			execute: (runtime, context) =>
				runtime.setSelectedOpacity(context.selection.nodeIds, opacity),
		}) satisfies EditorAction,
);

const motionTransportEditorActions = (
	[
		{
			id: "motion.toggle-playback",
			label: "Play/pause",
			keywords: ["motion", "transport", "play", "pause", "timeline", "space"],
			checked: (context: EditorActionContext) => context.motion.isPlaying,
			execute: (runtime: EditorActionRuntime) => runtime.togglePlayback(),
		},
		{
			id: "motion.stop-playback",
			label: "Stop playback",
			keywords: ["motion", "transport", "stop", "timeline", "frame 0"],
			availability: (context: EditorActionContext): ActionAvailability =>
				context.motion.isPlaying || currentMotionFrame(context) > 0
					? { enabled: true }
					: {
							enabled: false,
							reason: "Playback is already stopped at frame 0.",
						},
			execute: (runtime: EditorActionRuntime) => runtime.stopPlayback(),
		},
		{
			id: "motion.previous-frame",
			label: "Previous frame",
			shortcut: { key: "," },
			keywords: ["motion", "transport", "previous", "frame", "timeline", ","],
			availability: (context: EditorActionContext): ActionAvailability =>
				frameAvailability(
					context,
					stepMotionFrame(context, -1),
					"Already at the first frame.",
				),
			execute: (runtime: EditorActionRuntime, context: EditorActionContext) =>
				runtime.setMotionFrame(stepMotionFrame(context, -1)),
		},
		{
			id: "motion.next-frame",
			label: "Next frame",
			shortcut: { key: "." },
			keywords: ["motion", "transport", "next", "frame", "timeline", "."],
			availability: (context: EditorActionContext): ActionAvailability =>
				frameAvailability(
					context,
					stepMotionFrame(context, 1),
					"Already at the last frame.",
				),
			execute: (runtime: EditorActionRuntime, context: EditorActionContext) =>
				runtime.setMotionFrame(stepMotionFrame(context, 1)),
		},
		{
			id: "motion.first-frame",
			label: "Go to first frame",
			shortcut: { key: "Home" },
			keywords: ["motion", "transport", "first", "start", "frame", "home"],
			availability: (context: EditorActionContext): ActionAvailability =>
				frameAvailability(context, 0, "Already at the first frame."),
			execute: (runtime: EditorActionRuntime) => runtime.setMotionFrame(0),
		},
		{
			id: "motion.last-frame",
			label: "Go to last frame",
			shortcut: { key: "End" },
			keywords: ["motion", "transport", "last", "end", "frame"],
			availability: (context: EditorActionContext): ActionAvailability =>
				frameAvailability(
					context,
					lastMotionFrame(context),
					"Already at the last frame.",
				),
			execute: (runtime: EditorActionRuntime, context: EditorActionContext) =>
				runtime.setMotionFrame(lastMotionFrame(context)),
		},
	] as const
).map(
	(action) =>
		({
			...action,
			group: groups.motion,
			surfaces: commandPalette,
		}) satisfies EditorAction,
);

const frameInfluenceMaskEditorActions = FRAME_INFLUENCE_MASK_KINDS.map(
	(kind) => {
		const label = frameInfluenceLabel(kind);
		return {
			id: `effect.frame-influence.${kind}` as const,
			label: `Apply ${label} influence mask to current frame`,
			group: groups.effects,
			keywords: [
				"influence",
				"mask",
				"soft",
				"effect",
				"intent",
				"vec-core",
				"frame",
				"artboard",
				label,
			],
			surfaces: commandPalette,
			availability: () => ({ enabled: true }),
			checked: frameInfluenceChecked(kind),
			execute: (runtime, context) => {
				const result = createFrameInfluenceMaskCommand(
					context.scene,
					{ scope: "current-artboard" },
					createFrameInfluenceMaskKindOperation(
						resolveFrameEffectIntent(context.scene).influenceRecipe,
						kind,
					),
					{ label: `Apply ${label} frame influence` },
				);
				if (result.kind !== "ready") return;
				runtime.applyEffectIntentCommand(result.command);
			},
		} satisfies EditorAction;
	},
);

const removeFrameInfluenceMaskEditorAction = {
	id: "effect.frame-influence.remove",
	label: "Remove frame influence mask",
	group: groups.effects,
	keywords: [
		"influence",
		"mask",
		"effect",
		"intent",
		"vec-core",
		"frame",
		"artboard",
		"clear",
	],
	surfaces: commandPalette,
	availability: (context) =>
		frameInfluenceAssignment(context)
			? { enabled: true }
			: {
					enabled: false,
					reason: "No frame influence mask is active on this frame.",
				},
	execute: (runtime, context) => {
		const assignment = frameInfluenceAssignment(context);
		if (!assignment) return;
		const result = createFrameInfluenceMaskCommand(
			context.scene,
			{ scope: "current-artboard" },
			{ kind: "remove", assignmentId: assignment.id },
			{ label: "Remove frame influence" },
		);
		if (result.kind !== "ready") return;
		runtime.applyEffectIntentCommand(result.command);
	},
} satisfies EditorAction;

const structureEditorActions = [
	{
		id: "structure.frame-selection",
		label: "Wrap in frame",
		group: groups.layer,
		keywords: ["frame", "wrap", "selection", "artboard", "container"],
		surfaces: commandPaletteAndCanvas,
		availability: frameActionAvailability("frame-selection"),
		execute: (runtime, context) => {
			const result = buildFrameNodesCommand(
				context.scene,
				context.selection.nodeIds,
			);
			if (!result.ok) return;
			runtime.applyWorkflowCommand(
				result.command,
				result.selection.nodeIds,
				result.selection.primaryNodeId,
			);
		},
	},
	{
		id: "structure.grid-layout-selection",
		label: "Wrap in grid layout",
		group: groups.layer,
		keywords: [
			"grid",
			"layout",
			"bento",
			"columns",
			"rows",
			"frame",
			"wrap",
			"selection",
		],
		surfaces: commandPaletteAndCanvas,
		availability: layoutFrameActionAvailability,
		execute: (runtime, context) => {
			const result = buildLayoutFrameNodesCommand(
				context.scene,
				context.selection.nodeIds,
				{ preset: "bento-mosaic" },
			);
			if (!result.ok) return;
			runtime.applyWorkflowCommand(
				result.command,
				result.selection.nodeIds,
				result.selection.primaryNodeId,
			);
		},
	},
	{
		id: "structure.unframe-selection",
		label: "Unframe",
		group: groups.layer,
		keywords: ["frame", "unframe", "release", "unwrap"],
		surfaces: commandPaletteAndCanvas,
		availability: frameActionAvailability("unframe-selection"),
		execute: (runtime, context) => {
			const result = buildUnframeNodeCommand(
				context.scene,
				context.selection.primary ?? context.selection.nodeIds[0] ?? "",
			);
			if (!result.ok) return;
			runtime.applyWorkflowCommand(
				result.command,
				result.selection.nodeIds,
				result.selection.primaryNodeId,
			);
		},
	},
	{
		id: "structure.use-as-mask",
		label: "Use as mask",
		group: groups.layer,
		keywords: ["mask", "clip", "clipping", "crop", "use as mask"],
		surfaces: commandPaletteAndCanvas,
		availability: maskActionAvailability("use-as-mask"),
		execute: (runtime, context) => {
			const result = buildUseAsMaskCommand(
				context.scene,
				context.selection.nodeIds,
			);
			if (!result.ok) return;
			runtime.applyWorkflowCommand(
				result.command,
				result.selection.nodeIds,
				result.selection.primaryNodeId,
			);
		},
	},
	{
		id: "structure.release-mask",
		label: "Release mask",
		group: groups.layer,
		keywords: ["mask", "clip", "release", "unmask"],
		surfaces: commandPaletteAndCanvas,
		availability: maskActionAvailability("release-mask"),
		execute: (runtime, context) => {
			const result = buildReleaseMaskCommand(
				context.scene,
				context.selection.primary ?? context.selection.nodeIds[0] ?? null,
			);
			if (!result.ok) return;
			runtime.applyWorkflowCommand(
				result.command,
				result.selection.nodeIds,
				result.selection.primaryNodeId,
			);
		},
	},
	{
		id: "selected.focus-artboard",
		label: "Focus selection artboard",
		group: groups.view,
		keywords: ["focus", "artboard", "frame", "selection"],
		surfaces: commandPaletteAndCanvas,
		availability: selectedObjectAvailability(
			SELECTED_OBJECT_ACTION_IDS.focusArtboard,
		),
		execute: (runtime, context) =>
			executeSelectedObjectAction(
				runtime,
				context,
				SELECTED_OBJECT_ACTION_IDS.focusArtboard,
			),
	},
] as const satisfies readonly EditorAction[];

const motionRelationEditorActions = [
	{
		id: "motion.enable-spatial-path",
		label: "Enable direct spatial path",
		group: groups.motion,
		keywords: ["motion", "path", "trajectory", "tangent", "roving"],
		surfaces: commandPaletteAndCanvas,
		availability: (context) => {
			const node = context.selection.primary
				? findNode(context.scene, context.selection.primary)
				: undefined;
			if (!node) return { enabled: false, reason: "Select one animated node." };
			if (findPositionPathTrack(context.motionDocument, node.id)) {
				return {
					enabled: false,
					reason: "This node already has a spatial path.",
				};
			}
			return buildMotionPath(node, context.motionDocument).anchors.length >= 2
				? { enabled: true }
				: {
						enabled: false,
						reason: "Add at least two X/Y position stops first.",
					};
		},
		execute: (runtime, context) => {
			const node = context.selection.primary
				? findNode(context.scene, context.selection.primary)
				: undefined;
			if (!node) return;
			const path = buildMotionPath(node, context.motionDocument);
			if (path.anchors.length < 2) return;
			const command = enablePositionPath(
				node.id,
				path.anchors.map((anchor) => ({
					frame: anchor.frame,
					position: { x: anchor.x, y: anchor.y },
				})),
			);
			// Camera-first just-in-time supply (Phase P4): a position path is
			// always spatial motion, so ensure a camera before enabling it and
			// fold the compound id onto this one command so undo reverts both.
			const artboardId = selectArtboardIdForNode(context.scene, node.id);
			const cameraResult = artboardId
				? ensureSceneCameraBeforeSpatialAuthoring({
						artboardId,
						isSpatial: true,
					})
				: ({ ensured: false } as const);
			runtime.applyMotionCommand(
				cameraResult.ensured
					? { ...command, compoundId: cameraResult.compoundId }
					: command,
			);
			runtime.setActiveTool("motion-path");
		},
	},
	{
		id: "motion.create-controller",
		label: "Create motion controller",
		group: groups.motion,
		keywords: ["motion", "controller", "null", "parent", "rig"],
		surfaces: commandPalette,
		availability: (context) => {
			if (context.scene.layers.length === 0) {
				return {
					enabled: false,
					reason: "Add a layer before creating a controller.",
				};
			}
			const artboardIds = new Set(
				context.selection.nodeIds.flatMap((nodeId) => {
					const artboardId = selectArtboardIdForNode(context.scene, nodeId);
					return artboardId ? [artboardId] : [];
				}),
			);
			return artboardIds.size <= 1
				? { enabled: true }
				: {
						enabled: false,
						reason: "The selected nodes must belong to one artboard.",
					};
		},
		execute: (runtime, context) => {
			const plan = createMotionControllerWithSelectionPlan({
				scene: context.scene,
				motion: context.motionDocument,
				frame: context.motion.currentFrame,
				nodeIds: context.selection.nodeIds,
			});
			if (!plan || plan.commands.length === 0) return;
			runtime.applyMotionRelationPlan(plan);
			runtime.selectNodes(plan.selection.nodeIds, plan.selection.primaryNodeId);
		},
	},
	{
		id: "motion.parent-selection-to-primary",
		label: "Parent selection to primary controller",
		group: groups.motion,
		keywords: ["motion", "parent", "controller", "attach", "rig"],
		surfaces: commandPaletteAndCanvas,
		availability: (context) => {
			const primary = context.selection.primary
				? findNode(context.scene, context.selection.primary)
				: undefined;
			if (primary?.motionController?.kind !== "motion-controller") {
				return {
					enabled: false,
					reason: "Make the motion controller the primary selected node.",
				};
			}
			return context.selection.nodeIds.length > 1
				? { enabled: true }
				: {
						enabled: false,
						reason: "Select the controller and at least one child.",
					};
		},
		execute: (runtime, context) => {
			const primaryNodeId = context.selection.primary;
			if (!primaryNodeId) return;
			const plan = createParentSelectionToPrimaryPlan({
				scene: context.scene,
				motion: context.motionDocument,
				frame: context.motion.currentFrame,
				nodeIds: context.selection.nodeIds,
				primaryNodeId,
			});
			if (!plan || plan.commands.length === 0) return;
			runtime.applyMotionRelationPlan(plan);
			runtime.selectNodes(plan.selection.nodeIds, plan.selection.primaryNodeId);
		},
	},
	{
		id: "motion.detach-selection",
		label: "Detach from motion controller",
		group: groups.motion,
		keywords: ["motion", "parent", "controller", "detach", "clear"],
		surfaces: commandPaletteAndCanvas,
		availability: (context) => {
			const targets = context.selection.nodeIds.filter(
				(nodeId) => findNode(context.scene, nodeId)?.motionParent,
			);
			if (targets.length === 0) {
				return { enabled: false, reason: "Select a motion-parented node." };
			}
			const plan = createDetachSelectionPlan({
				scene: context.scene,
				motion: context.motionDocument,
				frame: context.motion.currentFrame,
				nodeIds: targets,
				primaryNodeId: context.selection.primary,
			});
			return plan.issues.length === 0
				? { enabled: true }
				: {
						enabled: false,
						reason:
							plan.issues[0]?.message ??
							"The selection cannot detach without changing its pose.",
					};
		},
		execute: (runtime, context) => {
			const plan = createDetachSelectionPlan({
				scene: context.scene,
				motion: context.motionDocument,
				frame: context.motion.currentFrame,
				nodeIds: context.selection.nodeIds,
				primaryNodeId: context.selection.primary,
			});
			if (plan.commands.length === 0) return;
			runtime.applyMotionRelationPlan(plan);
			runtime.selectNodes(plan.selection.nodeIds, plan.selection.primaryNodeId);
		},
	},
	{
		id: "motion.select-parent",
		label: "Select motion controller",
		group: groups.motion,
		keywords: ["motion", "parent", "controller", "select", "jump"],
		surfaces: commandPaletteAndCanvas,
		availability: (context) => {
			const parentNodeId = context.selection.primary
				? findNode(context.scene, context.selection.primary)?.motionParent
						?.parentNodeId
				: undefined;
			return parentNodeId && findNode(context.scene, parentNodeId)
				? { enabled: true }
				: {
						enabled: false,
						reason: "The primary node has no motion controller.",
					};
		},
		execute: (runtime, context) => {
			const parentNodeId = context.selection.primary
				? findNode(context.scene, context.selection.primary)?.motionParent
						?.parentNodeId
				: undefined;
			if (parentNodeId) runtime.selectNodes([parentNodeId], parentNodeId);
		},
	},
] as const satisfies readonly EditorAction[];

const sceneCameraEditorActions = [
	{
		id: "scene-camera.create",
		label: "Create scene camera",
		group: groups.camera,
		keywords: ["camera", "scene camera", "2.5d", "parallax"],
		surfaces: commandPalette,
		execute: (runtime, context) => {
			const plan = createSceneCameraPlan(context, false);
			if (!plan?.cameraRigId) return;
			runtime.applySceneCameraPlan(plan, {
				kind: "camera-rig",
				cameraRigId: plan.cameraRigId,
			});
		},
	},
	{
		id: "scene-camera.create-with-target-null",
		label: "Create scene camera with target null",
		group: groups.camera,
		keywords: ["camera", "scene camera", "target", "null", "2.5d"],
		surfaces: commandPalette,
		availability: (context) =>
			context.scene.layers.length > 0
				? { enabled: true }
				: {
						enabled: false,
						reason: "Add a layer before creating a target null.",
					},
		execute: (runtime, context) => {
			const plan = createSceneCameraPlan(context, true);
			if (!plan?.cameraRigId) return;
			runtime.applySceneCameraPlan(plan, {
				kind: "camera-rig",
				cameraRigId: plan.cameraRigId,
			});
		},
	},
	{
		id: "scene-camera.create-target-null",
		label: "Create target null for selected camera",
		group: groups.camera,
		keywords: ["camera", "target", "null", "controller", "bind"],
		surfaces: commandPalette,
		availability: (context) => {
			const selected = selectedCameraAvailability(context);
			if (!selected.enabled) return selected;
			return context.scene.layers.length > 0
				? { enabled: true }
				: {
						enabled: false,
						reason: "Add a layer before creating a target null.",
					};
		},
		execute: (runtime, context) => {
			const cameraRigId = cameraRigIdForCameraAction(context);
			if (!cameraRigId) return;
			const plan = createTargetControllerForSceneCameraAuthoringPlan(
				context.scene,
				cameraRigId,
				{ artboardId: selectCurrentArtboard(context.scene).id },
			);
			if (!plan?.controllerNodeId) return;
			runtime.applySceneCameraPlan(plan, {
				kind: "motion-controller",
				nodeId: plan.controllerNodeId,
				cameraRigId,
				role: "target",
			});
		},
	},
	{
		id: "scene-camera.bind-target-node",
		label: "Bind selected layer as camera target",
		group: groups.camera,
		keywords: ["camera", "target", "bind", "look at", "layer"],
		surfaces: commandPalette,
		availability: targetNodeAvailability,
		execute: (runtime, context) => {
			const cameraRigId = cameraRigIdForCameraAction(context);
			const nodeId = context.selection.primary;
			if (!cameraRigId || !nodeId) return;
			runtime.applySceneCameraPlan(
				createBindSceneCameraTargetNodeAuthoringPlan({
					cameraRigId,
					nodeId,
				}),
				{ kind: "camera-target", cameraRigId },
			);
		},
	},
	{
		id: "scene-camera.clear-target-node",
		label: "Clear camera target layer",
		group: groups.camera,
		keywords: ["camera", "target", "clear", "unbind"],
		surfaces: commandPalette,
		availability: selectedCameraAvailability,
		execute: (runtime, context) => {
			const cameraRigId = cameraRigIdForCameraAction(context);
			if (!cameraRigId) return;
			runtime.applySceneCameraPlan(
				createClearSceneCameraTargetAuthoringPlan(context.scene, cameraRigId),
				{ kind: "camera-target", cameraRigId },
			);
		},
	},
	{
		id: "scene-camera.set-active",
		label: "Set selected camera active",
		group: groups.camera,
		keywords: ["camera", "active", "artboard"],
		surfaces: commandPalette,
		availability: selectedCameraOnlyAvailability,
		execute: (runtime, context) => {
			const cameraRigId = selectedCameraRigId(context.selection.sceneCamera);
			if (!cameraRigId) return;
			runtime.applySceneCameraPlan(
				createSetActiveSceneCameraAuthoringPlan({
					artboardId: selectCurrentArtboard(context.scene).id,
					cameraRigId,
				}),
				{ kind: "camera-rig", cameraRigId },
			);
		},
	},
	{
		id: "scene-camera.clear-active",
		label: "Clear active scene camera",
		group: groups.camera,
		keywords: ["camera", "active", "clear", "artboard"],
		surfaces: commandPalette,
		availability: activeCameraAvailability,
		execute: (runtime, context) => {
			runtime.applySceneCameraPlan(
				createSetActiveSceneCameraAuthoringPlan({
					artboardId: selectCurrentArtboard(context.scene).id,
					cameraRigId: null,
				}),
				null,
			);
		},
	},
	{
		id: "scene-camera.select-active",
		label: "Select active scene camera",
		group: groups.camera,
		keywords: ["camera", "active", "select", "focus"],
		surfaces: commandPalette,
		availability: activeCameraAvailability,
		execute: (runtime, context) => {
			runtime.selectSceneCamera(activeSceneCameraSelection(context));
		},
	},
	{
		id: "scene-camera.remove",
		label: "Remove selected camera",
		group: groups.camera,
		keywords: ["camera", "remove", "delete"],
		surfaces: commandPalette,
		availability: selectedCameraOnlyAvailability,
		execute: (runtime, context) => {
			const cameraRigId = selectedCameraRigId(context.selection.sceneCamera);
			if (!cameraRigId) return;
			runtime.applySceneCameraPlan(
				createRemoveSceneCameraAuthoringPlan(cameraRigId),
				null,
			);
		},
	},
] as const satisfies readonly EditorAction[];

const editorActions = [
	...activatableToolActions,
	...alignEditorActions,
	...distributeEditorActions,
	...zOrderEditorActions,
	...pathOperationActions,
	...pathFinishingActions,
	...workflowEditorActions,
	...styleTransferEditorActions,
	frameLookEditorAction,
	...frameInfluenceMaskEditorActions,
	removeFrameInfluenceMaskEditorAction,
	...structureEditorActions,
	...motionRelationEditorActions,
	...sceneCameraEditorActions,
	...unavailableToolActions,
	...opacityEditorActions,
	...motionTransportEditorActions,
	{
		id: "file.save",
		label: "Save",
		group: groups.workflow,
		shortcut: { key: "s", modifiers: ["mod"] },
		allowInEditable: true,
		keywords: ["save", "working copy", "cloud", "persist"],
		surfaces: commandPalette,
		availability: (context) =>
			context.saveAvailable
				? { enabled: true }
				: {
						enabled: false,
						reason: "Saving is unavailable in this editor session.",
					},
		execute: (runtime) => runtime.save(),
	},
	{
		id: "edit.cut",
		label: "Cut selection",
		group: groups.workflow,
		shortcut: { key: "x", modifiers: ["mod"] },
		keywords: ["clipboard", "cut", "remove", "delete"],
		surfaces: workflowSurfaces,
		availability: (context) =>
			context.selection.nodeIds.length > 0
				? { enabled: true }
				: { enabled: false, reason: "Select something to cut." },
		// Cut is atomic copy-then-delete: only delete once the clipboard payload is
		// captured, so a failed copy never silently destroys the selection.
		execute: (runtime, context) => {
			const nodeIds = context.selection.nodeIds;
			if (nodeIds.length === 0) return;
			const result = buildClipboardPayload(context.scene, nodeIds);
			if (!result.ok) return;
			runtime.setWorkflowClipboardPayload(result.payload);
			runtime.applyWorkflowCommand(createDeleteNodesCommand(nodeIds), []);
		},
	},
	{
		id: "edit.paste-in-place",
		label: "Paste in place",
		group: groups.workflow,
		// `Mod+⌥+V` collides with distribute-vertical, so paste-in-place takes the
		// free `Mod+⇧+V` chord (Figma's paste-over-selection key). Same plan as
		// paste, but with a zero offset so the copy lands on the original spot.
		shortcut: { key: "v", modifiers: ["mod", "shift"] },
		keywords: ["clipboard", "paste", "place", "in place", "original"],
		surfaces: workflowSurfaces,
		availability: workflowAvailability("paste"),
		execute: (runtime, context) => {
			const plan = layerWorkflowActionPlan(context, "paste");
			if (!plan.enabled || plan.id !== "paste") return;
			if (!("payload" in plan) || !("targetLayerId" in plan)) return;
			const result = buildPasteClipboardCommand(context.scene, plan.payload, {
				targetLayerId: plan.targetLayerId,
				offset: { x: 0, y: 0 },
			});
			if (!result.ok) return;
			runtime.applyWorkflowCommand(result.command, result.newRootNodeIds);
		},
	},
	{
		id: "edit.paste-over-selection",
		label: "Paste over selection",
		group: groups.workflow,
		keywords: [
			"clipboard",
			"paste",
			"over",
			"selection",
			"replace position",
			"target",
		],
		surfaces: workflowSurfaces,
		availability: (context) => {
			if (context.selection.nodeIds.length === 0) {
				return {
					enabled: false,
					reason: "Select a target layer before pasting over selection.",
				};
			}
			const plan = layerWorkflowActionPlan(context, "paste");
			if (!plan.enabled) {
				return { enabled: false, reason: workflowUnavailableReason(plan) };
			}
			if (!("payload" in plan) || !("targetLayerId" in plan)) {
				return {
					enabled: false,
					reason: "Paste over selection cannot resolve the clipboard target.",
				};
			}
			const result = buildPasteOverSelectionClipboardCommand(
				context.scene,
				plan.payload,
				context.selection.nodeIds,
			);
			return result.ok
				? { enabled: true }
				: {
						enabled: false,
						reason:
							result.issues.find((issue) => issue.severity === "error")
								?.message ?? "Paste over selection is unavailable right now.",
					};
		},
		execute: (runtime, context) => {
			const plan = layerWorkflowActionPlan(context, "paste");
			if (!plan.enabled || plan.id !== "paste") return;
			if (!("payload" in plan) || !("targetLayerId" in plan)) return;
			const result = buildPasteOverSelectionClipboardCommand(
				context.scene,
				plan.payload,
				context.selection.nodeIds,
			);
			if (!result.ok) return;
			runtime.applyWorkflowCommand(result.command, result.newRootNodeIds);
		},
	},
	{
		id: "layer.insert",
		label: "Add layer",
		group: groups.layer,
		keywords: ["add", "insert", "new", "layer", "node", "rectangle", "create"],
		surfaces: ["command-palette", "layer-menu"],
		execute: (runtime) => {
			const node = createDefaultLayerNode();
			runtime.applyWorkflowCommand(
				createAppendNodeCommand(node, { label: "Add layer" }),
				[node.id],
			);
		},
	},
	{
		id: "selection.select-all",
		label: "Select all",
		group: groups.selection,
		shortcut: { key: "a", modifiers: ["mod"] },
		keywords: ["selection", "all", "everything"],
		surfaces: commandPalette,
		execute: (runtime) => runtime.selectAll(),
	},
	{
		id: "selection.select-inverse",
		label: "Select inverse",
		group: groups.selection,
		shortcut: { key: "a", modifiers: ["mod", "shift"] },
		keywords: ["selection", "invert", "inverse"],
		surfaces: commandPalette,
		execute: (runtime) => runtime.selectInverse(),
	},
	{
		id: "transform.repeat",
		label: "Transform again",
		group: groups.transform,
		shortcut: { key: "d", modifiers: ["mod"] },
		keywords: [
			"repeat",
			"again",
			"step",
			"duplicate",
			"copy",
			"transform",
			"spacing",
		],
		surfaces: commandPaletteAndCanvas,
		availability: repeatTransformAvailability,
		execute: (runtime, context) =>
			runtime.repeatTransform(
				context.repeatTransformPlan,
				context.selection.nodeIds,
			),
	},
	{
		id: "transform.flip-horizontal",
		label: "Flip horizontal",
		group: groups.transform,
		shortcut: { key: "h", modifiers: ["shift"] },
		keywords: ["flip", "mirror", "horizontal", "x"],
		surfaces: commandPaletteAndCanvas,
		availability: (context) =>
			context.selection.nodeIds.length > 0
				? { enabled: true }
				: { enabled: false, reason: "Select a layer to flip." },
		execute: (runtime, context) =>
			runtime.flipNodes(context.selection.nodeIds, "horizontal"),
	},
	{
		id: "transform.flip-vertical",
		label: "Flip vertical",
		group: groups.transform,
		shortcut: { key: "v", modifiers: ["shift"] },
		keywords: ["flip", "mirror", "vertical", "y"],
		surfaces: commandPaletteAndCanvas,
		availability: (context) =>
			context.selection.nodeIds.length > 0
				? { enabled: true }
				: { enabled: false, reason: "Select a layer to flip." },
		execute: (runtime, context) =>
			runtime.flipNodes(context.selection.nodeIds, "vertical"),
	},
	{
		id: "layer.toggle-lock",
		label: "Lock/unlock selection",
		group: groups.layer,
		shortcut: { key: "l", modifiers: ["mod", "shift"] },
		keywords: ["lock", "unlock", "layer", "protect"],
		surfaces: workflowSurfaces,
		availability: selectedObjectAvailability(
			SELECTED_OBJECT_ACTION_IDS.toggleLock,
		),
		execute: (runtime, context) =>
			executeSelectedObjectAction(
				runtime,
				context,
				SELECTED_OBJECT_ACTION_IDS.toggleLock,
			),
	},
	{
		id: "layer.toggle-hide",
		label: "Show/hide selection",
		group: groups.layer,
		shortcut: { key: "h", modifiers: ["mod", "shift"] },
		keywords: ["hide", "show", "visibility", "layer"],
		surfaces: workflowSurfaces,
		availability: selectedObjectAvailability(
			SELECTED_OBJECT_ACTION_IDS.toggleVisibility,
		),
		execute: (runtime, context) =>
			executeSelectedObjectAction(
				runtime,
				context,
				SELECTED_OBJECT_ACTION_IDS.toggleVisibility,
			),
	},
	{
		id: "layer.rename-selection",
		label: "Rename selection",
		group: groups.layer,
		shortcut: { key: "r", modifiers: ["mod"] },
		shortcutAliases: [{ key: "F2" }],
		keywords: ["rename", "name", "layer", "node", "artboard", "f2", "mod+r"],
		surfaces: commandPalette,
		availability: selectedObjectAvailability(SELECTED_OBJECT_ACTION_IDS.rename),
		execute: (runtime, context) =>
			executeSelectedObjectAction(
				runtime,
				context,
				SELECTED_OBJECT_ACTION_IDS.rename,
			),
	},
	{
		id: "view.command-palette",
		label: "Open actions",
		group: groups.view,
		shortcut: { key: "k", modifiers: ["mod"] },
		shortcutAliases: [{ key: "p", modifiers: ["mod"] }],
		allowInEditable: true,
		keywords: ["command", "palette", "actions", "search"],
		surfaces: [],
		execute: (runtime) => runtime.toggleCommandPalette(),
	},
	{
		id: "view.toggle-panels",
		label: "Toggle panels",
		group: groups.view,
		shortcut: { key: "\\", modifiers: ["mod"] },
		keywords: ["layers", "inspector", "sidebar", "chrome"],
		surfaces: commandPalette,
		checked: (context) => context.panelsOpen,
		execute: (runtime) => runtime.togglePanels(),
	},
	{
		id: "view.toggle-layers-panel",
		label: "Toggle Layers panel",
		group: groups.view,
		shortcut: { key: "l", modifiers: ["mod", "alt"] },
		keywords: ["layers", "sidebar", "panel", "chrome"],
		surfaces: commandPalette,
		checked: (context) => context.layersOpen,
		execute: (runtime) => runtime.toggleLayersPanel(),
	},
	{
		id: "view.toggle-inspector-panel",
		label: "Toggle Inspector panel",
		group: groups.view,
		// `Mod+⌥+I`/`J`/`C`/`U` are browser DevTools chords the page cannot
		// preventDefault, so the inspector toggle uses `Mod+⌥+P` ("Properties").
		shortcut: { key: "p", modifiers: ["mod", "alt"] },
		keywords: ["inspector", "properties", "sidebar", "panel", "chrome"],
		surfaces: commandPalette,
		checked: (context) => context.inspectorOpen,
		execute: (runtime) => runtime.toggleInspectorPanel(),
	},
	{
		id: "view.toggle-timeline",
		label: "Toggle timeline",
		group: groups.view,
		shortcut: { key: "t", modifiers: ["mod", "shift"] },
		keywords: ["motion", "panel"],
		surfaces: ["command-palette", "timeline-menu"],
		checked: (context) => context.timelineOpen,
		execute: (runtime) => runtime.toggleTimeline(),
	},
	{
		id: "view.toggle-look-workspace",
		label: "Toggle Look graph workspace",
		group: groups.view,
		keywords: ["look", "graph", "node", "workspace", "color"],
		surfaces: commandPalette,
		checked: (context) => context.lookWorkspaceOpen,
		execute: (runtime) => runtime.toggleLookWorkspace(),
	},
	{
		id: "view.toggle-visual-review",
		label: "Toggle visual review",
		group: groups.view,
		keywords: ["review", "compare", "reference", "blind", "pixels", "material"],
		surfaces: commandPalette,
		execute: (runtime) => runtime.toggleVisualReview(),
	},
	{
		id: "view.toggle-guides",
		label: "Show/hide guides",
		group: groups.view,
		shortcut: { key: "r", modifiers: ["shift"] },
		keywords: ["guides", "guide lines", "snap", "precision", "construction"],
		surfaces: commandPalette,
		// A global view toggle like show/hide grid: always available, even with zero
		// guide lines, so it is never a dead command. Flipping the preference
		// hides/shows every guide line (and gates guide snapping) and is honored the
		// moment a guide is added.
		checked: (context) => context.guideLinesVisible,
		execute: (runtime) => runtime.toggleGuideLinesVisible(),
	},
	{
		id: "view.toggle-grid",
		label: "Show/hide grid",
		group: groups.view,
		shortcut: { key: "'", modifiers: ["mod"] },
		keywords: ["grid", "grids", "layout", "workspace", "desk", "pasteboard"],
		surfaces: commandPalette,
		// One user-facing "grid" covering the workspace/desk grid and the artboard
		// layout grid. Always available, never a dead command. The capture-phase
		// dispatcher owns Mod+' (it stops propagation before the canvas bubble
		// handler), and the canvas right-click View group offers the same toggle
		// without ⌘K. The pixel grid stays a separate ⌘⇧' toggle.
		checked: (context) => context.gridVisible,
		execute: (runtime) => runtime.toggleGrid(),
	},
	{
		id: "view.toggle-smart-guides",
		label: "Smart guides",
		group: groups.view,
		// Cmd+U = Illustrator's Smart Guides toggle. Globally free: Cmd+U/
		// underline is scoped to the inline text-edit textarea, and the mesh tool
		// uses bare `U` (distinct under the exact-modifier matcher).
		shortcut: { key: "u", modifiers: ["mod"] },
		keywords: ["snap", "smart", "guides", "align", "alignment", "object"],
		surfaces: commandPaletteAndCanvas,
		checked: (context) => context.smartGuides,
		execute: (runtime) => runtime.toggleSmartGuides(),
	},
	{
		id: "view.toggle-snap-to-point",
		label: "Snap to point",
		group: groups.view,
		keywords: ["snap", "point", "anchor", "vertex", "node", "grid"],
		surfaces: commandPaletteAndCanvas,
		checked: (context) => context.snapToPoint,
		execute: (runtime) => runtime.toggleSnapToPoint(),
	},
	{
		id: "view.zoom-in",
		label: "Zoom in",
		group: groups.view,
		shortcut: { key: "=", modifiers: ["mod"] },
		shortcutAliases: [
			{ key: "=" },
			{ key: "=", modifiers: ["shift"] },
			{ key: "=", modifiers: ["mod", "shift"] },
		],
		keywords: ["viewport", "zoom", "canvas", "increase"],
		surfaces: ["command-palette", "canvas-menu"],
		execute: (runtime) => runtime.zoomIn(),
	},
	{
		id: "view.zoom-out",
		label: "Zoom out",
		group: groups.view,
		shortcut: { key: "-", modifiers: ["mod"] },
		shortcutAliases: [
			{ key: "-" },
			{ key: "-", modifiers: ["shift"] },
			{ key: "-", modifiers: ["mod", "shift"] },
		],
		keywords: ["viewport", "zoom", "canvas", "decrease"],
		surfaces: ["command-palette", "canvas-menu"],
		execute: (runtime) => runtime.zoomOut(),
	},
	{
		id: "view.zoom-to-100",
		label: "Zoom to 100%",
		group: groups.view,
		shortcut: { key: "0", modifiers: ["mod"] },
		shortcutAliases: [{ key: "0", modifiers: ["shift"] }],
		keywords: ["viewport", "zoom", "canvas", "actual", "size"],
		surfaces: ["command-palette", "canvas-menu"],
		checked: (context) => context.zoom === 100,
		execute: (runtime) => runtime.zoomTo100(),
	},
	{
		id: "view.zoom-to-selection",
		label: "Zoom to selection",
		group: groups.view,
		shortcut: { key: "2", modifiers: ["shift"] },
		keywords: [
			"viewport",
			"zoom",
			"selection",
			"fit",
			"canvas",
			"shift+2",
			"s+2",
		],
		surfaces: commandPalette,
		availability: (context) =>
			context.selectionBounds
				? { enabled: true }
				: context.selection.nodeIds.length > 0
					? {
							enabled: false,
							reason: "The current selection has no visible bounds to fit.",
						}
					: { enabled: false, reason: "Select a layer to zoom to selection." },
		execute: (runtime, context) => {
			if (context.selectionBounds)
				runtime.zoomToSelection(context.selectionBounds);
		},
	},
	{
		id: "view.fit-artboard",
		label: "Fit artboard",
		group: groups.view,
		shortcut: { key: "1", modifiers: ["shift"] },
		keywords: ["viewport", "reset", "zoom", "canvas"],
		surfaces: ["command-palette", "canvas-menu"],
		availability: () => ({ enabled: true }),
		execute: (runtime) => runtime.resetViewport(),
	},
	{
		id: "view.shortcut-help",
		label: "Keyboard shortcuts",
		group: groups.view,
		// `?` reports as event.key when Shift+/ is pressed, so the chord must be
		// `{ key: "?", modifiers: ["shift"] }`; `{ key: "/", ... }` never matches.
		shortcut: { key: "?", modifiers: ["shift"] },
		keywords: ["help", "shortcuts", "keyboard", "keys", "cheat", "reference"],
		surfaces: commandPalette,
		execute: (runtime) => runtime.toggleShortcutHelp(),
	},
	{
		id: "transform.reset-bounding-box",
		label: "Reset Bounding Box",
		group: groups.transform,
		keywords: [
			"bounding",
			"box",
			"reset",
			"upright",
			"axis",
			"align",
			"rotate",
		],
		surfaces: commandPalette,
		availability: (context) =>
			context.selection.nodeIds.length > 0
				? { enabled: true }
				: { enabled: false, reason: "Select a layer first." },
		execute: (runtime, context) =>
			runtime.resetBoundingBox(context.selection.nodeIds),
	},
	{
		id: "view.toggle-bounding-box",
		label: "Show/Hide Bounding Box",
		group: groups.view,
		shortcut: { key: "b", modifiers: ["mod", "shift"] },
		keywords: ["bounding", "box", "handles", "transform", "resize", "rotate"],
		surfaces: commandPalette,
		checked: (context) => context.boundingBoxHandlesVisible,
		execute: (runtime) => runtime.toggleBoundingBox(),
	},
	{
		id: "history.undo",
		label: "Undo",
		group: groups.history,
		shortcut: { key: "z", modifiers: ["mod"] },
		keywords: ["history", "revert"],
		surfaces: commandPalette,
		availability: (context) =>
			context.canUndo
				? { enabled: true }
				: { enabled: false, reason: "No scene edit to undo." },
		execute: (runtime) => runtime.undo(),
	},
	{
		id: "history.redo",
		label: "Redo",
		group: groups.history,
		shortcut: { key: "z", modifiers: ["mod", "shift"] },
		keywords: ["history"],
		surfaces: commandPalette,
		availability: (context) =>
			context.canRedo
				? { enabled: true }
				: { enabled: false, reason: "No scene edit to redo." },
		execute: (runtime) => runtime.redo(),
	},
	{
		id: "motion.key-pose",
		label: "Key pose at playhead",
		group: groups.motion,
		shortcut: { key: "k" },
		keywords: ["keyframe", "timeline", "animation", "motion"],
		surfaces: ["command-palette", "timeline-menu"],
		availability: (context) =>
			context.selection.primary
				? { enabled: true }
				: { enabled: false, reason: "Select a layer first." },
		execute: (runtime, context) => {
			const nodeId = context.selection.primary;
			if (nodeId) runtime.keyNodePose(nodeId);
		},
	},
	{
		id: "export.bundle",
		label: "Export",
		group: groups.export,
		shortcut: { key: "e", modifiers: ["mod", "shift"] },
		keywords: ["download", "json", "svg", "pdf"],
		surfaces: commandPalette,
		availability: (context) =>
			context.canExport
				? { enabled: true }
				: { enabled: false, reason: "Nothing exportable in the document." },
		execute: (runtime) => runtime.exportCurrentState(),
	},
] as const satisfies readonly EditorAction[];

export const editorActionRegistry = createActionRegistry<
	EditorActionContext,
	EditorActionRuntime,
	EditorAction
>(editorActions);

/** Returns action groups for the requested surface without adding fake commands. */
export function editorActionGroupsForSurface(
	surface: EditorActionSurface,
	context: EditorActionContext,
	query: string,
) {
	const actions = editorActionRegistry.actions.filter((action) =>
		action.surfaces.includes(surface),
	);
	return searchActionGroups<
		EditorActionContext,
		EditorActionRuntime,
		EditorAction
	>(actions, context, query);
}
