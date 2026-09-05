import { Dialog } from "@base-ui/react/dialog";
import { Popover } from "@base-ui/react/popover";
import {
	ArrowClockwise,
	ArrowsLeftRight,
	ArrowsOutSimple,
	Bookmarks,
	Camera,
	CaretDown,
	CaretUp,
	Check,
	Circle,
	Code,
	Copy,
	CursorClick,
	Diamond,
	Eye,
	EyeSlash,
	FloppyDisk,
	Gear,
	GridFour,
	LinkSimple,
	MagicWand,
	PencilSimple,
	Plus,
	SlidersHorizontal,
	StackSimple,
	Swatches,
	TextAlignCenter,
	TextAlignLeft,
	TextAlignRight,
	TextB,
	TextItalic,
	TextT,
	TextUnderline,
	Trash,
	X,
} from "@phosphor-icons/react";
import {
	type KeyboardEvent,
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	type RefCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	createAutomationTrack,
	distributeRovingPositionKeys,
	enablePositionPath,
	removeAutomationRecipe,
	removeAutomationTrack,
	removePositionPath,
	removeTextAnimator,
	reorderAutomationTrack,
	repairPathMorphTopology,
	reversePathMorphKeyWinding,
	setAutomationEnabled,
	setPathMorphFirstVertex,
	setPositionPathSpatialMode,
	setPositionPathTangent,
	setTextAnimator,
	updateAutomationTrack,
} from "@/entities/motion/model/commands";
import { isValidPathShape } from "@/entities/motion/model/keyframe-validation";
import { inspectMorphTopology } from "@/entities/motion/model/morph-topology";
import { buildMotionPath } from "@/entities/motion/model/motion-path";
import { resolvePositionPath } from "@/entities/motion/model/position-path";
import { sampleMotionRelationLocalScene } from "@/entities/motion/model/relation-authoring";
import { findTrack, isNodeAnimated } from "@/entities/motion/model/sampler";
import { useMotionStore } from "@/entities/motion/model/store";
import {
	createCharacterCascadeBinding,
	createLineFadeBinding,
	createWordRiseBinding,
	type TextAnimatorPresetOptions,
} from "@/entities/motion/model/text-animator";
import type {
	CameraRigAnimatableProperty,
	MotionDocument,
	RangeTextSelector,
	TextAnimatorBinding,
	TextAnimatorProperties,
	TextSelectorMode,
	TextSelectorShape,
} from "@/entities/motion/model/types";
import { useMotionGrammarStore } from "@/entities/motion-grammar/model/store";
import { ANALOG_FILM_LOOK_LABEL } from "@/entities/motion-grammar/model/time-delay-materialization";
import {
	MASK_RELATION_EXPAND_PROPERTY_ID,
	MASK_RELATION_INVERT_PROPERTY_ID,
	MASK_RELATION_OPACITY_PROPERTY_ID,
} from "@/entities/scene/model/appearance";
import { readAppearanceStack } from "@/entities/scene/model/appearance-stack";
import {
	expandPaintTargetIds,
	isWrapperContainer,
} from "@/entities/scene/model/appearance-targets";
import {
	createCaptureArrangementLayoutSnapshotCommand,
	createRecaptureArrangementLayoutSnapshotCommand,
	createRemoveArrangementLayoutSnapshotCommand,
	createRenameArrangementLayoutSnapshotCommand,
	listArrangementLayoutSnapshots,
} from "@/entities/scene/model/arrangement-layout-snapshot";
import { bindablePropertiesForGeometryKind } from "@/entities/scene/model/bindable-property";
import {
	createAddComponentPropCommand,
	createAddSharedColorComponentPropCommand,
	createAddSharedNumberComponentPropCommand,
	createRemoveComponentPropCommand,
	createSetSharedColorComponentPropCommand,
	createSetSharedNumberComponentPropCommand,
	createSetTextComponentPropCommand,
	createUpdateComponentPropCommand,
} from "@/entities/scene/model/component-prop-commands";
import {
	componentPropBindableTargetOwners,
	componentPropBindingAnimatedConflict,
	componentPropSharedNumberOwnershipConflicts,
	componentPropSharedNumberValueIssues,
	componentPropStyleColorOwnershipConflict,
	componentPropStyleColorTargetOwners,
	componentPropStyleColorValueIssues,
	isSharedNumberPropertyId,
	readComponentProps,
	resolveComponentPropBindingIssue,
	type SharedNumberPropertyId,
	sharedNumberBindingValue,
	sharedNumberValueIsValid,
} from "@/entities/scene/model/component-props";
import {
	effectCapabilitiesForRecipePath,
	effectCapabilityById,
} from "@/entities/scene/model/effect-capabilities";
import type {
	EffectExpressionBinding,
	EffectExpressionTargetRef,
} from "@/entities/scene/model/effect-expression-binding";
import type {
	EffectLayer,
	EffectLayerAdaptationSource,
	EffectLayerPatch,
} from "@/entities/scene/model/effect-layer-stack";
import {
	beginGestureTransaction,
	commitGestureTransaction,
	type GestureTransaction,
} from "@/entities/scene/model/gesture-transaction";
import {
	convertPaintKind,
	indexOfStop,
	setStopColor,
	setStopOffset,
} from "@/entities/scene/model/gradient-edit";
import {
	createAddInteractionCommand,
	createRemoveInteractionCommand,
	createUpdateInteractionCommand,
} from "@/entities/scene/model/interaction-commands";
import { readInteractions } from "@/entities/scene/model/interactions";
import {
	effectiveLayoutFrameContract,
	LAYOUT_FRAME_PRESET_IDS,
	type LayoutFramePatch,
	normalizeLayoutFrameContract,
	resolveLayoutFramePlan,
	resolveLayoutFrameWriteVariantId,
} from "@/entities/scene/model/layout-frame";
import {
	createApplyLayoutPresetCommand,
	createPackLayoutFrameCommand,
	createReapplyLayoutFrameCommand,
	createSetLayoutChildPlacementCommand,
	createUpdateLayoutFrameCommand,
} from "@/entities/scene/model/layout-frame-commands";
import type { LookGraphNode } from "@/entities/scene/model/look-graph";
import {
	type NativeExpressionPropertyId,
	nativeExpressionPropertyIdFromBindableId,
} from "@/entities/scene/model/native-expression-binding";
import { createProductionControlSampler } from "@/entities/scene/model/production-control";
import {
	getGeometryBounds,
	getNodeLocalBounds,
} from "@/entities/scene/model/rendering";
import {
	resolveSceneCameraProjection,
	type SceneCameraDepthOfFieldResolution,
} from "@/entities/scene/model/scene-camera";
import {
	readSceneCameraAuthoringState,
	resolveSceneCameraAuthoringSelection,
	type SceneCameraAuthoringSelection,
	type SceneCameraDepthPreset,
	sceneCameraDepthPresetForZ,
} from "@/entities/scene/model/scene-camera-authoring";
import {
	createRemovePropertyRelationCommand,
	createRemoveTransformConstraintCommand,
	createSetPropertyRelationCommand,
	createSetTransformConstraintCommand,
	planTransformConstraintCommand,
} from "@/entities/scene/model/scene-constraint-commands";
import {
	allNodes,
	findLayerByNodeId,
	findNode,
	isTopLevelSceneNode,
	selectArtboardIdForNode,
} from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import { resolveNodeStyle } from "@/entities/scene/model/style-resolve";
import {
	CODE_SAFE_TEXT_FONT_OPTIONS,
	isCodeSafeTextFontFamily,
} from "@/entities/scene/model/text-fonts";
import { markGroupAsTextFragments } from "@/entities/scene/model/text-fragment-commands";
import type { TextFragmentUnit } from "@/entities/scene/model/text-fragments";
import type {
	BlendMode,
	Bounds,
	ComponentPropBinding,
	ComponentPropBindingBindable,
	ComponentPropBindingStyleColor,
	ComponentPropBindingTextContent,
	ComponentPropDefinition,
	ComponentPropType,
	InteractionAction,
	InteractionActionKind,
	InteractionDefinition,
	InteractionTrigger,
	InteractionTriggerKind,
	LayoutCellFitMode,
	LayoutCellPlacement,
	LayoutFramePresetId,
	LayoutFrameVariantContract,
	RelationNumericProperty,
	RevealPaint,
	SceneCameraRigContract,
	SceneDocument,
	StrokeAlign,
	StrokeCap,
	StrokeJoin,
	TextAlign,
	TextResizeMode,
	VectorNode,
} from "@/entities/scene/model/types";
import { BlenderLinkInspectorSection } from "@/features/blender-link/ui/BlenderLinkInspectorSection";
import {
	analogFilmNodeLookStateForSelection,
	commitAnalogFilmNodeLook,
	commitRemoveAnalogFilmNodeLook,
} from "@/features/effect-authoring/model";
import {
	clearFrameEffectExpression,
	clearNodeEffectExpression,
	commitFrameEffectExpression,
	commitNodeEffectExpression,
	type FrameEffectExpressionTargetRef,
	planFrameEffectExpression,
	planNodeEffectExpression,
} from "@/features/effect-expression/model/commands";
import { useGradientEditorStore } from "@/features/gradient/model/editor-store";
import { createGroupNodesCommand } from "@/features/grouping/model/command";
import {
	bareLookNodeParamKey,
	beginFrameLookGraphNodeNumberGesture,
	commitFrameLookGraphNodeField,
	commitFrameLookGraphNodeNumber,
	commitInsertFrameLookGraphNode,
	commitInsertParticleDissolveNode,
	commitMaterializeFrameLookGraph,
	commitRemoveFrameLookGraphNode,
	commitReorderFrameLookGraphNode,
	commitToggleFrameLookGraphNode,
	FRAME_LOOK_GRAPH_AUTHORABLE_NODE_KINDS,
	FRAME_LOOK_GRAPH_NODE_KIND_LABELS,
	FRAME_LOOK_GRAPH_PARTICLE_DIRECTION_OPTIONS,
	FRAME_LOOK_GRAPH_TEXTURE_MODE_OPTIONS,
	type FrameLookGraphEditingNode,
	type FrameLookGraphNodeNumberGesture,
	type FrameLookGraphNodeSliderSpec,
	frameLookGraphEditingState,
	frameLookGraphNodeIsParticleTexture,
	frameLookGraphNodeReceivesRenderableMask,
	frameLookGraphParticleDirectionValue,
	frameLookGraphTextureModeForNode,
	isLookNodeParamAnimated,
	lookGraphOwnerForScope,
	lookGraphTargetKey,
	lookNodeParamDisplayValue,
	lookNodeParamKeyframeState,
	toggleLookNodeParamKeyframe,
} from "@/features/look-authoring/model";
import { motionAuthoringFrame } from "@/features/motion/model/authoring-commands";
import { useMotionClipSelectionStore } from "@/features/motion/model/clip-selection-store";
import { keyGradientFillAtPlayhead } from "@/features/motion/model/key-pose";
import { useTransportStore } from "@/features/motion/model/transport-store";
import {
	commitMotionRelationAuthoringPlan,
	createDetachSelectionPlan,
	createParentSelectionToPrimaryPlan,
} from "@/features/motion-parenting/model/authoring";
import {
	clearNativeExpression,
	commitNativeExpression,
	planNativeExpression,
} from "@/features/native-expression/model/commands";
import { ProgramSurfaceSection } from "@/features/program-surface/ui/ProgramSurfaceSection";
import {
	commitSceneCameraAuthoringPlan,
	createAssignSceneCameraDepthPresetPlan,
	createAssignSceneCameraDepthValuePlan,
	createBindSceneCameraTargetNodeAuthoringPlan,
	createCameraChannelKeyframePlan,
	createCameraVectorKeyframePlan,
	createClearSceneCameraTargetAuthoringPlan,
	createRemoveSceneCameraAuthoringPlan,
	createSceneCameraForArtboardAuthoringPlan,
	createSetActiveSceneCameraAuthoringPlan,
	createTargetControllerForSceneCameraAuthoringPlan,
	createUpdateSceneCameraAuthoringPlan,
	ensureSceneCameraBeforeSpatialAuthoring,
} from "@/features/scene-camera/model/authoring";
import { useSelectionStore } from "@/features/selection/model/store";
import { useToolSelectionStore } from "@/features/tool-selection/model/store";
import { useLookGraphSelectionStore } from "@/shared/editor-chrome/model/look-graph-selection";
import { usePanelResize } from "@/shared/editor-chrome/model/use-panel-resize";
import { cn } from "@/shared/lib/cn";
import { createId } from "@/shared/lib/id";
import { addFrameDiagnosticCount } from "@/shared/performance/frame-diagnostics";
import { STROKE_WIDTH_PROFILE_PRESET_IDS } from "@/shared/stroke/width-profile";
import { ColorPicker } from "@/shared/ui/ColorPicker";
import { KeyframeDiamond } from "@/shared/ui/KeyframeDiamond";
import { PanelResizeHandle } from "@/shared/ui/PanelResizeHandle";
import { SCRUB_MIXED, ScrubSlider } from "@/shared/ui/ScrubSlider";
import type {
	AutomationBinding,
	AutomationBindingChannel,
	AutomationEasing,
	AutomationTrack,
	AutomationTrackMode,
	EffectTargetRef,
	EffectTargetScope,
} from "@/shared/vec-core";
import { commitConvertFillToMesh } from "../model/appearance-stack";
import {
	commitInspectorAnchorPresetEdit,
	commitInspectorKeyframeEdit,
	commitSingleInspectorNumberEdit,
	type InspectorKeyframeActionGroup,
	type InspectorMotionField,
	inspectorAuthoringReadState,
	type ReadyInspectorKeyframeActionState,
} from "../model/authoring-controller";
import { commitDocumentTimingFromInspector } from "../model/document-timing-authoring";
import {
	type ArtboardInspectorNumberField,
	appearanceEditingStateForSelection,
	artboardInspectorState,
	beginRecipeNumberGesture,
	type CornerKey,
	canRemoveAnalogFilmFrameLook,
	commitAddArtboardFromInspector,
	commitAddGradientStop,
	commitAddGradientStopAt,
	commitAnalogFilmFrameLook,
	commitArtboardInspectorBackground,
	commitArtboardInspectorName,
	commitArtboardInspectorNumber,
	commitBlendMode,
	commitCornerRadius,
	commitCornerSmoothing,
	commitDropShadowColor,
	commitDropShadowEnabled,
	commitDropShadowNumber,
	commitDuplicateArtboardFromInspector,
	commitFrameEffectInfluenceMaskKind,
	commitFrameEffectInfluenceNumber,
	commitFrameEffectLayerStackOperation,
	commitFrameRecipeNumber,
	commitGradientStopColor,
	commitGradientStopOffset,
	commitGradientStopOpacity,
	commitHydrateGradientStops,
	commitImagePaintFit,
	commitLayerBlurAxesLinked,
	commitLayerBlurAxisNumber,
	commitLayerBlurEnabled,
	commitLinearGradientAngle,
	commitLiveGradientPaint,
	commitMaskRelationBehavior,
	commitMaskRelationFeather,
	commitMaskRelationSetting,
	commitMeshPointColor,
	commitMeshPointNumber,
	commitMeshRemovePoint,
	commitNodeStyleNumber,
	commitNoiseGradientBlendMode,
	commitNoiseGradientCoverage,
	commitNoiseGradientDirection,
	commitNoiseGradientFrameGraphBlendMode,
	commitNoiseGradientFrameGraphCoverage,
	commitNoiseGradientFrameGraphDirection,
	commitNoiseGradientFrameGraphGrainStrength,
	commitNoiseGradientFrameGraphLinearFieldFit,
	commitNoiseGradientFrameGraphLinearFieldInvert,
	commitNoiseGradientFrameGraphLinearFieldNumber,
	commitNoiseGradientFrameGraphMaterialMode,
	commitNoiseGradientFrameGraphMatteKind,
	commitNoiseGradientFrameGraphMatteNumber,
	commitNoiseGradientFrameGraphNumber,
	commitNoiseGradientFrameGraphOverlayColor,
	commitNoiseGradientFrameGraphPreset,
	commitNoiseGradientFrameGraphStyle,
	commitNoiseGradientGrainStrength,
	commitNoiseGradientLinearFieldFit,
	commitNoiseGradientLinearFieldInvert,
	commitNoiseGradientLinearFieldNumber,
	commitNoiseGradientMaterialMode,
	commitNoiseGradientMatteKind,
	commitNoiseGradientMatteNumber,
	commitNoiseGradientNumber,
	commitNoiseGradientOverlayColor,
	commitNoiseGradientPreset,
	commitNoiseGradientRevealPaint,
	commitNoiseGradientStyle,
	commitPaintKind,
	commitPaintRoleEnabled,
	commitPerCornerRadius,
	commitPrimaryPaintColor,
	commitPrimaryPaintOpacity,
	commitRecipeNumber,
	commitRemoveAnalogFilmFrameLook,
	commitRemoveArtboardFromInspector,
	commitRemoveFrameEffectInfluenceMask,
	commitRemoveGradientStop,
	commitReverseGradientStops,
	commitShadowColor,
	commitShadowEnabled,
	commitShadowNumber,
	commitStarPolygonCornerRadius,
	commitStrokeBlur,
	commitStrokeDash,
	commitStrokeOption,
	commitStrokeStyleKind,
	commitStrokeWidthProfile,
	commitTextAlign,
	commitTextBoxMode,
	commitTextBoxNumber,
	commitTextContent,
	commitTextFill,
	commitTextFontFamily,
	commitTextStyleNumber,
	commitToggleTextBold,
	commitToggleTextItalic,
	commitToggleTextUnderline,
	type FrameEffectInfluenceMaskKind,
	type FrameEffectInfluenceNumberField,
	type FrameEffectRecipeScope,
	formatInspectorNumber,
	frameEffectInfluenceEditingState,
	frameEffectLayerStackEditingState,
	frameRecipeEditingValues,
	type GradientEditModel,
	type ImagePaintEditModel,
	INSPECTOR_BLEND_MODE_VALUES,
	INSPECTOR_FRAME_RECIPE_CONTROLS,
	INSPECTOR_IMAGE_FIT_VALUES,
	INSPECTOR_STROKE_ALIGN_VALUES,
	INSPECTOR_STROKE_CAP_VALUES,
	INSPECTOR_STROKE_JOIN_VALUES,
	liveGradientPaintForInspector,
	type MeshPaintEditModel,
	type MeshPointNumberField,
	MIXED_VALUE,
	type MixedValue,
	maskFeatherEditingStateForNode,
	mixedValue,
	NOISE_GRADIENT_BLEND_MODE_OPTIONS,
	NOISE_GRADIENT_DIRECTION_CUSTOM,
	NOISE_GRADIENT_DIRECTION_EDGE,
	NOISE_GRADIENT_DIRECTION_MESH,
	NOISE_GRADIENT_MATTE_CUSTOM,
	NOISE_GRADIENT_MATTE_LINEAR,
	NOISE_GRADIENT_MATTE_NONE,
	NOISE_GRADIENT_MATTE_RADIAL,
	NOISE_GRADIENT_PRESETS,
	type NoiseGradientMatteKind,
	type NoiseGradientStyle,
	noiseGradientFrameGraphAngleForSelection,
	noiseGradientFrameGraphBlendModeForSelection,
	noiseGradientFrameGraphCoverageForSelection,
	noiseGradientFrameGraphDirectionForSelection,
	noiseGradientFrameGraphGrainStrengthForSelection,
	noiseGradientFrameGraphLinearFieldValuesForSelection,
	noiseGradientFrameGraphMaterialModeIsMixedForSelection,
	noiseGradientFrameGraphMatteValuesForSelection,
	noiseGradientFrameGraphOverlayColorForSelection,
	noiseGradientFrameGraphRevealPaintForSelection,
	noiseGradientFrameGraphStateForSelection,
	noiseGradientFrameGraphStyleForSelection,
	noiseGradientFrameGraphValuesForSelection,
	noiseGradientNodeAngleForSelection,
	noiseGradientNodeBlendModeForSelection,
	noiseGradientNodeCoverageForSelection,
	noiseGradientNodeDirectionForSelection,
	noiseGradientNodeGrainStrengthForSelection,
	noiseGradientNodeLinearFieldValuesForSelection,
	noiseGradientNodeLookStateForSelection,
	noiseGradientNodeMaterialModeIsMixedForSelection,
	noiseGradientNodeMatteValuesForSelection,
	noiseGradientNodeOverlayColorForSelection,
	noiseGradientNodeStyleForSelection,
	noiseGradientNodeValuesForSelection,
	normalizeColorInput,
	type PrimaryPaintRole,
	parseNumericDraft,
	primaryNodeForInspector,
	type RecipeNumberField,
	type RecipeNumberGesture,
	recipeEditingValuesForSelection,
	rectCornerRadiiValue,
	rectCornerRadiusValue,
	rectCornerSmoothingValue,
	rectCornersIndependent,
	rectNodeCount,
	type StrokeStyleKind,
	type StrokeWidthProfileSelection,
	sceneArtboardMutationAdapter,
	sceneNodeCount,
	selectedNodesForInspector,
	starPolygonCornerRadiusValue,
	type TextBoxEditingState,
	type TextStyleEditingState,
	type TextStyleNumberField,
	type TransformNumberField,
	textBoxEditingStateForSelection,
	textEditingStateForSelection,
	textStyleEditingStateForSelection,
} from "../model/editing";
import { motionSystemInspectorSelection } from "../model/motion-system-selection";
import { inspectorFieldToBindablePropertyId } from "../model/property-binding";
import { sharedColorOwnershipConflictForInspector } from "../model/shared-color-ownership";
import {
	sharedNumberBindingIssueReason,
	sharedNumberOwnershipReason,
} from "../model/shared-number-ownership";
import {
	createStageGInspectorReadout,
	type StageGInspectorReadout,
} from "../model/stage-g-readout";
import {
	commitApplyStylePreset,
	commitCaptureStylePreset,
	commitRemoveStylePreset,
	commitRenameStylePreset,
	commitReorderStylePreset,
	commitUpdateStylePresetFromNode,
	type StylePresetSummary,
	stylePresetInspectorState,
} from "../model/style-presets";
import { AppearanceStackSection } from "./AppearanceStackSection";
import {
	CodeableSection,
	DuplicateCodeControls,
	FrameEffectCodeControls,
} from "./CodeableSection";
import { ComponentSection } from "./ComponentSection";
import { EffectFieldControls } from "./EffectFieldControls";
import { MotionTechniqueSection } from "./MotionTechniqueSection";
import { SourceOpticsControls } from "./SourceOpticsControls";

type NumericFieldProps = {
	readonly label: string;
	readonly value: MixedValue<number | null> | null;
	readonly resetKey: string;
	readonly step?: string;
	readonly disabled?: boolean;
	/** Native HTML tooltip, e.g. explaining why a disabled field is disabled. */
	readonly title?: string;
	readonly action?: ReactNode;
	readonly onCommit: (value: number) => boolean;
};

type OptionalNumericFieldProps = {
	readonly label: string;
	readonly value: number | null;
	readonly resetKey: string;
	readonly onCommit: (value: number | null) => boolean;
};

type ColorFieldProps = {
	readonly label: string;
	readonly value: MixedValue<string | null> | null;
	readonly resetKey: string;
	readonly disabled?: boolean;
	readonly onCommit: (value: string) => boolean;
	/**
	 * Live drag tick from the popover picker. The host applies it under the given
	 * stable per-gesture coalesceKey so a drag collapses to one undo entry.
	 */
	readonly onLiveCommit?: (value: string, coalesceKey: string) => void;
	/** Whether `none`/no-fill is a valid value (fill/stroke yes; artboard bg & stops no). */
	readonly allowNone?: boolean;
	/**
	 * Opacity (0..1) for paints that carry their own alpha channel (gradient stops).
	 * When provided, the picker shows an alpha slider unifying color + alpha in one
	 * control; omitted for solid fill/stroke so they keep no alpha slider.
	 */
	readonly alpha?: number;
	/** Live alpha tick under a per-gesture coalesceKey so an alpha drag is one undo entry. */
	readonly onAlphaLiveCommit?: (value: number, coalesceKey: string) => void;
};

type TextAreaFieldProps = {
	readonly label: string;
	readonly value: MixedValue<string> | null;
	readonly resetKey: string;
	readonly disabled?: boolean;
	readonly onCommit: (value: string) => boolean;
};

type TextInputFieldProps = {
	readonly label: string;
	readonly value: MixedValue<string> | null;
	readonly resetKey: string;
	readonly disabled?: boolean;
	readonly onCommit: (value: string) => boolean;
};

type TextAlignFieldProps = {
	readonly value: MixedValue<TextAlign> | null;
	readonly disabled?: boolean;
	readonly onCommit: (value: TextAlign) => boolean;
};

type TextToggleButtonProps = {
	readonly label: string;
	readonly value: MixedValue<boolean> | null;
	readonly disabled?: boolean;
	readonly onToggle: () => boolean;
	readonly children: ReactNode;
};

type SelectFieldProps<T extends string> = {
	readonly label: string;
	readonly value: MixedValue<T> | null;
	readonly options: readonly {
		readonly value: T;
		readonly label: string;
	}[];
	readonly resetKey: string;
	readonly disabled?: boolean;
	readonly onCommit: (value: T) => boolean;
};

const transformFields: readonly {
	readonly label: string;
	readonly field: TransformNumberField;
	readonly step: string;
}[] = [
	{ label: "X", field: "x", step: "1" },
	{ label: "Y", field: "y", step: "1" },
	{ label: "W", field: "width", step: "1" },
	{ label: "H", field: "height", step: "1" },
	{ label: "AX", field: "anchorX", step: "1" },
	{ label: "AY", field: "anchorY", step: "1" },
	{ label: "R", field: "rotation", step: "1" },
];

/**
 * Transform fields a direct layout-managed child cannot author directly: the
 * layout materializer owns geometry (position/size) for these, so a write is
 * either fought back by the runner's re-materialization or silently discarded.
 * Anchor and rotation stay free properties (the materializer preserves them),
 * so they are excluded here.
 */
const LAYOUT_MANAGED_DISABLED_TRANSFORM_FIELDS = new Set<TransformNumberField>([
	"x",
	"y",
	"width",
	"height",
]);

const pivotPresets = [
	{ id: "nw", label: "Top left pivot", x: 0, y: 0 },
	{ id: "n", label: "Top pivot", x: 0.5, y: 0 },
	{ id: "ne", label: "Top right pivot", x: 1, y: 0 },
	{ id: "w", label: "Left pivot", x: 0, y: 0.5 },
	{ id: "center", label: "Center pivot", x: 0.5, y: 0.5 },
	{ id: "e", label: "Right pivot", x: 1, y: 0.5 },
	{ id: "sw", label: "Bottom left pivot", x: 0, y: 1 },
	{ id: "s", label: "Bottom pivot", x: 0.5, y: 1 },
	{ id: "se", label: "Bottom right pivot", x: 1, y: 1 },
] as const;

const artboardFields: readonly {
	readonly label: string;
	readonly field: ArtboardInspectorNumberField;
	readonly step: string;
}[] = [
	{ label: "X", field: "x", step: "1" },
	{ label: "Y", field: "y", step: "1" },
	{ label: "W", field: "width", step: "1" },
	{ label: "H", field: "height", step: "1" },
];

const textStyleNumberFields: readonly {
	readonly label: string;
	readonly field: TextStyleNumberField;
	readonly step: string;
}[] = [
	{ label: "Size", field: "fontSize", step: "1" },
	{ label: "Line", field: "lineHeight", step: "1" },
	{ label: "Weight", field: "fontWeight", step: "50" },
	{ label: "Tracking", field: "letterSpacing", step: "0.5" },
];

const codeSafeTextFontOptions: readonly {
	readonly value: string;
	readonly label: string;
}[] = CODE_SAFE_TEXT_FONT_OPTIONS.map(({ value, label }) => ({
	value,
	label,
}));

const textBoxModeOptions: readonly {
	readonly value: TextResizeMode;
	readonly label: string;
}[] = [
	{ value: "point", label: "Auto" },
	{ value: "area", label: "Area" },
];

const meshPointNumberFields: readonly {
	readonly label: string;
	readonly field: MeshPointNumberField;
	readonly step: string;
}[] = [
	{ label: "X", field: "x", step: "1" },
	{ label: "Y", field: "y", step: "1" },
	{ label: "Alpha", field: "opacity", step: "0.05" },
];

const cornerNativePropertyByKey = {
	tl: "geometry.cornerRadii.tl",
	tr: "geometry.cornerRadii.tr",
	br: "geometry.cornerRadii.br",
	bl: "geometry.cornerRadii.bl",
} as const satisfies Record<CornerKey, NativeExpressionPropertyId>;

const textAlignOptions: readonly {
	readonly value: TextAlign;
	readonly label: string;
	readonly icon: ReactNode;
}[] = [
	{
		value: "left",
		label: "Align left",
		icon: <TextAlignLeft aria-hidden="true" size={13} />,
	},
	{
		value: "center",
		label: "Align center",
		icon: <TextAlignCenter aria-hidden="true" size={13} />,
	},
	{
		value: "right",
		label: "Align right",
		icon: <TextAlignRight aria-hidden="true" size={13} />,
	},
];

const codeSafeTextFontSelectValue = (
	value: MixedValue<string> | null,
): MixedValue<string> | null => {
	if (typeof value !== "string") return value;
	return isCodeSafeTextFontFamily(value) ? value : null;
};

const unsupportedTextFontFamily = (
	value: MixedValue<string> | null,
): string | null =>
	typeof value === "string" && !isCodeSafeTextFontFamily(value) ? value : null;

const titleFromToken = (value: string): string =>
	value
		.split("-")
		.map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
		.join(" ");

const blendModeOptions = INSPECTOR_BLEND_MODE_VALUES.map((value) => ({
	value,
	label: titleFromToken(value),
}));

/**
 * Stroke-option glyphs, each drawn by the exact SVG attribute it commits
 * (`stroke-linecap`, `stroke-linejoin`, `stroke-dasharray`, an align band on a
 * boundary edge) so every segment previews the real result instead of a word.
 * `currentColor` keeps them token-safe and lets the segment's text color state
 * (muted/hover/selected) restyle the glyph for free.
 */
function StrokeAlignGlyph({ align }: { readonly align: StrokeAlign }) {
	const bandY = align === "inside" ? 7.5 : align === "center" ? 5.5 : 3.5;
	return (
		<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
			<rect
				x="2.5"
				y="5.5"
				width="11"
				height="10"
				fill="none"
				stroke="currentColor"
				strokeWidth="1"
				opacity="0.4"
			/>
			<line
				x1="2"
				y1={bandY}
				x2="14"
				y2={bandY}
				stroke="currentColor"
				strokeWidth="3"
			/>
		</svg>
	);
}

function StrokeCapGlyph({ cap }: { readonly cap: StrokeCap }) {
	return (
		<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
			<line
				x1="7"
				y1="2.5"
				x2="7"
				y2="13.5"
				stroke="currentColor"
				strokeWidth="1"
				opacity="0.4"
			/>
			<line
				x1="7"
				y1="8"
				x2="17"
				y2="8"
				stroke="currentColor"
				strokeWidth="7"
				strokeLinecap={cap}
			/>
		</svg>
	);
}

function StrokeJoinGlyph({ join }: { readonly join: StrokeJoin }) {
	return (
		<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
			<path
				d="M3.5 15 L8 5.5 L12.5 15"
				fill="none"
				stroke="currentColor"
				strokeWidth="4.5"
				strokeLinejoin={join}
				strokeMiterlimit="8"
			/>
		</svg>
	);
}

function StrokeStyleGlyph({ kind }: { readonly kind: StrokeStyleKind }) {
	const strokeDasharray =
		kind === "dotted" ? "0.1 3" : kind === "dashed" ? "3 2.5" : undefined;
	return (
		<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
			<line
				x1="1.5"
				y1="8"
				x2="14.5"
				y2="8"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeDasharray={strokeDasharray}
			/>
		</svg>
	);
}

const strokeAlignSegments = INSPECTOR_STROKE_ALIGN_VALUES.map((value) => ({
	value,
	title: titleFromToken(value),
	content: <StrokeAlignGlyph align={value} />,
}));

const strokeCapSegments = INSPECTOR_STROKE_CAP_VALUES.map((value) => ({
	value,
	title: titleFromToken(value),
	content: <StrokeCapGlyph cap={value} />,
}));

const strokeJoinSegments = INSPECTOR_STROKE_JOIN_VALUES.map((value) => ({
	value,
	title: titleFromToken(value),
	content: <StrokeJoinGlyph join={value} />,
}));

const strokeStyleSegments: readonly {
	readonly value: StrokeStyleKind;
	readonly title: string;
	readonly content: ReactNode;
}[] = [
	{
		value: "solid",
		title: "Solid",
		content: <StrokeStyleGlyph kind="solid" />,
	},
	{
		value: "dashed",
		title: "Dashed",
		content: <StrokeStyleGlyph kind="dashed" />,
	},
	{
		value: "dotted",
		title: "Dotted",
		content: <StrokeStyleGlyph kind="dotted" />,
	},
];

/** Style axis segments mirroring the tool bar's `NOISE_STYLE_OPTIONS`. */
const NOISE_GRADIENT_STYLE_SEGMENTS: readonly {
	readonly value: NoiseGradientStyle;
	readonly title: string;
	readonly content: ReactNode;
}[] = [
	{ value: "off", title: "Off", content: "Off" },
	{ value: "overlay", title: "Overlay", content: "Overlay" },
	{ value: "dissolve", title: "Dissolve", content: "Dissolve" },
];

/** Blend dropdown options for the Overlay style, excluding the dissolve blend the Style axis now owns. */
const NOISE_GRADIENT_OVERLAY_BLEND_MODE_OPTIONS =
	NOISE_GRADIENT_BLEND_MODE_OPTIONS.filter(
		(option) => option.value !== "dissolve",
	);

const imageFitOptions = INSPECTOR_IMAGE_FIT_VALUES.map((value) => ({
	value,
	label: titleFromToken(value),
}));

/**
 * Display labels for the width-profile preset picker. Not derived from
 * `titleFromToken` (which would read "Taper Out") because the product copy is
 * sentence case ("Taper out").
 */
const STROKE_WIDTH_PROFILE_LABELS = {
	"taper-out": "Taper out",
	"taper-in": "Taper in",
	"taper-both": "Taper both",
	ink: "Ink",
} as const satisfies Record<
	Exclude<StrokeWidthProfileSelection, "none" | "custom">,
	string
>;

/**
 * Options for the Inspector's width-profile select. "None" always leads; the
 * built-in presets follow in {@link STROKE_WIDTH_PROFILE_PRESET_IDS} order.
 * "Custom" is deliberately absent — it is a read-only display state added by
 * {@link strokeWidthProfileOptionsFor} only when the current selection is
 * already "custom", so it never appears as a choosable option.
 */
const strokeWidthProfileBaseOptions: readonly {
	readonly value: StrokeWidthProfileSelection;
	readonly label: string;
}[] = [
	{ value: "none", label: "None" },
	...STROKE_WIDTH_PROFILE_PRESET_IDS.map((value) => ({
		value,
		label: STROKE_WIDTH_PROFILE_LABELS[value],
	})),
];

/**
 * Appends a non-interactive "Custom" option only when the current value is
 * already `"custom"` (agent-authored or otherwise non-preset stops), so the
 * select shows it as the current label without offering it as a choice —
 * picking any other option overwrites the custom profile.
 */
function strokeWidthProfileOptionsFor(
	value: MixedValue<StrokeWidthProfileSelection> | null,
): readonly {
	readonly value: StrokeWidthProfileSelection;
	readonly label: string;
}[] {
	return value === "custom"
		? [...strokeWidthProfileBaseOptions, { value: "custom", label: "Custom" }]
		: strokeWidthProfileBaseOptions;
}

const frameLookScopeOptions: readonly {
	readonly value: FrameEffectRecipeScope;
	readonly label: string;
}[] = [
	{ value: "current-artboard", label: "Frame" },
	{ value: "scene", label: "Scene" },
];

const frameInfluenceMaskOptions: readonly {
	readonly value: FrameEffectInfluenceMaskKind;
	readonly label: string;
}[] = [
	{ value: "radialGradient", label: "Radial" },
	{ value: "linearGradient", label: "Linear" },
];

const effectLayerAdaptationOptions: readonly {
	readonly value: EffectLayerAdaptationSource;
	readonly label: string;
}[] = [
	{ value: "none", label: "None" },
	{ value: "source-alpha", label: "Source alpha" },
	{ value: "previous-alpha", label: "Previous alpha" },
	{ value: "previous-luminance", label: "Previous luma" },
];

type FrameRecipeControlPath = Parameters<
	typeof effectCapabilitiesForRecipePath
>[0];

const frameExpressionTargetRef = (
	scope: FrameEffectRecipeScope,
	artboardId: string,
): FrameEffectExpressionTargetRef =>
	scope === "scene" ? { kind: "scene" } : { kind: "artboard", artboardId };

const effectExpressionTargetKey = (
	targetRef: EffectExpressionTargetRef,
): string => {
	switch (targetRef.kind) {
		case "node":
			return `node:${targetRef.nodeId}`;
		case "artboard":
			return `artboard:${targetRef.artboardId}`;
		case "scene":
			return "scene";
	}
};

const sameEffectExpressionTarget = (
	binding: EffectExpressionBinding,
	targetRef: EffectExpressionTargetRef,
): boolean =>
	effectExpressionTargetKey(binding.targetRef) ===
	effectExpressionTargetKey(targetRef);

const effectExpressionBindingForCapability = (
	bindings: readonly EffectExpressionBinding[],
	targetRef: EffectExpressionTargetRef,
	capabilityId: string | null,
): EffectExpressionBinding | null =>
	capabilityId
		? (bindings.find(
				(binding) =>
					binding.capabilityId === capabilityId &&
					sameEffectExpressionTarget(binding, targetRef),
			) ?? null)
		: null;

const frameRecipeCapabilityIdForPath = (
	path: FrameRecipeControlPath,
	targetScope: FrameEffectExpressionTargetRef["kind"],
): string | null =>
	effectCapabilitiesForRecipePath(path).find((capability) =>
		capability.targetScopes.some((scope) => scope === targetScope),
	)?.id ?? null;

const frameInfluenceCapabilityIdForField = (
	field: FrameEffectInfluenceNumberField,
	targetScope: FrameEffectExpressionTargetRef["kind"],
): string | null => {
	if (field !== "strength" && field !== "featherRadius") return null;
	const capability = effectCapabilityById(`frame-influence.${field}`);
	if (
		capability?.source.kind !== "influence-control" ||
		!capability.targetScopes.some((scope) => scope === targetScope)
	) {
		return null;
	}
	return capability.id;
};

const nodeRecipeCapabilityIdForField = (
	field: RecipeNumberField,
): string | null => {
	const capability = effectCapabilityById(`node-look.${field}`);
	if (
		capability?.source.kind !== "recipe-control" ||
		!capability.targetScopes.some((scope) => scope === "node") ||
		!capability.control.expressionBindable
	) {
		return null;
	}
	return capability.id;
};

const draftFromNumber = (value: MixedValue<number | null> | null): string =>
	typeof value === "number" ? formatInspectorNumber(value) : "";

const draftFromColor = (value: MixedValue<string | null> | null): string =>
	typeof value === "string" ? value : "";

const draftFromText = (value: MixedValue<string> | null): string =>
	typeof value === "string" ? value : "";

const mixedPlaceholder = <T,>(value: MixedValue<T> | null): string =>
	value === MIXED_VALUE ? "Mixed" : "";

const hasMixedValue = <T,>(value: MixedValue<T> | null): boolean =>
	value === MIXED_VALUE;

function MixedBadge() {
	return (
		<span className="shrink-0 rounded border border-white/10 px-1 font-mono text-fg-subtle text-ui leading-3">
			Mixed
		</span>
	);
}

function FieldLabel({
	label,
	mixed,
}: {
	readonly label: string;
	readonly mixed: boolean;
}) {
	return (
		<span className="mb-0.5 flex h-4 items-center justify-between gap-1">
			<span className="min-w-0 truncate text-fg-muted text-ui">{label}</span>
			{mixed ? <MixedBadge /> : null}
		</span>
	);
}

/**
 * Keeps Inspector text drafts local to the selection/edit target that focused the
 * field. If the selection changes before blur, the blur event cancels instead of
 * writing a stale draft to the newly selected node.
 */
function useInspectorFieldDraft<TValue>({
	value,
	resetKey,
	toDraft,
	onCommit,
}: {
	readonly value: TValue;
	readonly resetKey: string;
	readonly toDraft: (value: TValue) => string;
	readonly onCommit: (draft: string) => boolean;
}) {
	const [draft, setDraftState] = useState(() => toDraft(value));
	const [dirty, setDirty] = useState(false);
	const focusedResetKeyRef = useRef<string | null>(null);
	const cancelNextBlurRef = useRef(false);

	useEffect(() => {
		void resetKey;
		setDraftState(toDraft(value));
		setDirty(false);
		cancelNextBlurRef.current = false;
	}, [value, resetKey, toDraft]);

	const resetDraft = () => {
		setDraftState(toDraft(value));
		setDirty(false);
	};

	const setDraft = (nextDraft: string) => {
		setDraftState(nextDraft);
		setDirty(true);
	};

	const cancelDraft = () => {
		cancelNextBlurRef.current = true;
		resetDraft();
	};

	const commitDraft = () => {
		if (cancelNextBlurRef.current) {
			cancelNextBlurRef.current = false;
			return;
		}
		if (!dirty) return;
		if (focusedResetKeyRef.current !== resetKey) {
			resetDraft();
			return;
		}
		if (!onCommit(draft)) resetDraft();
		else setDirty(false);
	};

	return {
		draft,
		setDraft,
		resetDraft,
		cancelDraft,
		commitDraft,
		onFocus: () => {
			focusedResetKeyRef.current = resetKey;
			cancelNextBlurRef.current = false;
		},
		onBlur: () => {
			commitDraft();
			focusedResetKeyRef.current = null;
		},
	};
}

function PanelSection({
	title,
	icon,
	action,
	children,
}: {
	readonly title: string;
	readonly icon: ReactNode;
	readonly action?: ReactNode;
	readonly children: ReactNode;
}) {
	return (
		<section className="border-white/8 border-b px-1.5 pb-1.5 last:border-b-0">
			<div className="sticky top-0 z-20 -mx-1.5 mb-1.5 flex h-6 items-center justify-between gap-1 border-white/8 border-b bg-surface-raised/96 px-1.5 text-fg-secondary text-ui backdrop-blur-xl">
				<div className="flex min-w-0 items-center gap-1 font-medium">
					{icon}
					<span className="truncate">{title}</span>
				</div>
				{action}
			</div>
			{children}
		</section>
	);
}

function NumericField({
	label,
	value,
	resetKey,
	step = "1",
	disabled = false,
	title,
	action,
	onCommit,
}: NumericFieldProps) {
	const { draft, setDraft, cancelDraft, onFocus, onBlur } =
		useInspectorFieldDraft({
			value,
			resetKey,
			toDraft: draftFromNumber,
			onCommit: (nextDraft) => {
				const parsed = parseNumericDraft(nextDraft);
				return parsed !== null && onCommit(parsed);
			},
		});

	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter") {
			event.currentTarget.blur();
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			cancelDraft();
			event.currentTarget.blur();
		}
	};

	const input = (
		<input
			type="text"
			inputMode="decimal"
			step={step}
			disabled={disabled}
			title={title}
			value={draft}
			placeholder={mixedPlaceholder(value)}
			onFocus={onFocus}
			onChange={(event) => {
				setDraft(event.currentTarget.value);
			}}
			onBlur={onBlur}
			onKeyDown={onKeyDown}
			className="h-6 w-full rounded-md border border-white/10 bg-black/25 px-1.5 font-mono text-fg text-ui tabular-nums outline-none transition placeholder:text-fg-subtle focus:border-accent/70 disabled:cursor-not-allowed disabled:opacity-45"
		/>
	);

	return (
		<div className="block min-w-0">
			<FieldLabel label={label} mixed={hasMixedValue(value)} />
			{action ? (
				<span className="grid grid-cols-[minmax(0,1fr)_auto] gap-1">
					{input}
					{action}
				</span>
			) : (
				input
			)}
		</div>
	);
}

function OptionalNumericField({
	label,
	value,
	resetKey,
	onCommit,
}: OptionalNumericFieldProps) {
	const { draft, setDraft, cancelDraft, onFocus, onBlur } =
		useInspectorFieldDraft({
			value,
			resetKey,
			toDraft: (nextValue) =>
				typeof nextValue === "number" ? formatInspectorNumber(nextValue) : "",
			onCommit: (nextDraft) => {
				if (nextDraft.trim() === "") return onCommit(null);
				const parsed = parseNumericDraft(nextDraft);
				return parsed !== null && onCommit(parsed);
			},
		});

	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter") {
			event.currentTarget.blur();
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			cancelDraft();
			event.currentTarget.blur();
		}
	};

	return (
		<div className="block min-w-0">
			<FieldLabel label={label} mixed={false} />
			<input
				type="text"
				inputMode="decimal"
				value={draft}
				placeholder="Auto"
				onFocus={onFocus}
				onChange={(event) => {
					setDraft(event.currentTarget.value);
				}}
				onBlur={onBlur}
				onKeyDown={onKeyDown}
				className="h-6 w-full rounded-md border border-white/10 bg-black/25 px-1.5 font-mono text-fg text-ui tabular-nums outline-none transition placeholder:text-fg-subtle focus:border-accent/70"
			/>
		</div>
	);
}

/**
 * Corner-radius controls for a single node: a uniform radius field (which rounds
 * all corners) plus a "Per corner" toggle that reveals independent TL/TR/BL/BR
 * fields for rectangles. The toggle is UI state seeded from the data, so a rect
 * authored with independent corners opens expanded. Non-rect nodes show a
 * disabled field, matching the prior single "Radius px" affordance.
 */
function CornerControls({
	node,
	resetKey,
}: {
	readonly node: VectorNode;
	readonly resetKey: string;
}) {
	const [independent, setIndependent] = useState(() =>
		rectCornersIndependent([node]),
	);

	if (node.geometry.kind === "star" || node.geometry.kind === "polygon") {
		// Star/polygon round all corners uniformly (outer tips for stars).
		return (
			<NumericField
				label="Radius px"
				value={starPolygonCornerRadiusValue([node])}
				resetKey={`${resetKey}:corner-radius`}
				step="1"
				action={
					<NativeCodeButton
						nodeId={node.id}
						propertyId="geometry.cornerRadius"
						label="Radius"
					/>
				}
				onCommit={(value) => commitStarPolygonCornerRadius([node.id], value)}
			/>
		);
	}

	if (node.geometry.kind !== "rect") {
		return (
			<NumericField
				label="Radius px"
				value={null}
				resetKey={`${resetKey}:corner-radius`}
				step="1"
				disabled
				onCommit={() => false}
			/>
		);
	}

	const radii = rectCornerRadiiValue([node]);
	const uniform = rectCornerRadiusValue([node]);
	const smoothing = rectCornerSmoothingValue([node]);
	const smoothingPercent =
		typeof smoothing === "number" ? Math.round(smoothing * 100) : smoothing;
	const perCornerField = (label: string, corner: CornerKey) => (
		<NumericField
			label={label}
			value={radii ? radii[corner] : null}
			resetKey={`${resetKey}:corner-${corner}`}
			step="1"
			action={
				<NativeCodeButton
					nodeId={node.id}
					propertyId={cornerNativePropertyByKey[corner]}
					label={label}
				/>
			}
			onCommit={(value) => commitPerCornerRadius([node.id], corner, value)}
		/>
	);

	return (
		<div className="space-y-1">
			<div className="flex items-end gap-1">
				<div className="min-w-0 flex-1">
					<NumericField
						label="Radius px"
						value={independent ? MIXED_VALUE : uniform}
						resetKey={`${resetKey}:corner-radius`}
						step="1"
						action={
							<NativeCodeButton
								nodeId={node.id}
								propertyId="geometry.cornerRadius"
								label="Radius"
							/>
						}
						onCommit={(value) => commitCornerRadius([node.id], value)}
					/>
				</div>
				<button
					type="button"
					aria-pressed={independent}
					title="Independent corners"
					onClick={() => setIndependent((value) => !value)}
					className={cn(
						"h-6 shrink-0 rounded-md border px-2 text-ui uppercase tracking-wide transition",
						independent
							? "border-accent/70 text-accent-fg"
							: "border-white/10 text-fg-secondary hover:text-fg",
					)}
				>
					Per corner
				</button>
			</div>
			{independent ? (
				<div className="grid grid-cols-2 gap-1">
					{perCornerField("TL", "tl")}
					{perCornerField("TR", "tr")}
					{perCornerField("BL", "bl")}
					{perCornerField("BR", "br")}
				</div>
			) : null}
			<div className="flex items-end gap-1">
				<div className="min-w-0 flex-1">
					<NumericField
						label="Smoothing %"
						value={smoothingPercent}
						resetKey={`${resetKey}:corner-smoothing`}
						step="1"
						action={
							<NativeCodeButton
								nodeId={node.id}
								propertyId="geometry.cornerSmoothing"
								label="Smoothing"
							/>
						}
						onCommit={(value) => commitCornerSmoothing([node.id], value / 100)}
					/>
				</div>
				<button
					type="button"
					title="iOS corner smoothing (60%)"
					onClick={() => commitCornerSmoothing([node.id], 0.6)}
					className="h-6 shrink-0 rounded-md border border-white/10 px-2 text-fg-secondary text-ui uppercase tracking-wide transition hover:text-fg"
				>
					iOS
				</button>
			</div>
		</div>
	);
}

function TextInputField({
	label,
	value,
	resetKey,
	disabled = false,
	onCommit,
}: TextInputFieldProps) {
	const { draft, setDraft, cancelDraft, onFocus, onBlur } =
		useInspectorFieldDraft({
			value,
			resetKey,
			toDraft: draftFromText,
			onCommit,
		});

	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter") {
			event.currentTarget.blur();
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			cancelDraft();
			event.currentTarget.blur();
		}
	};

	return (
		<label className="block min-w-0">
			<FieldLabel label={label} mixed={hasMixedValue(value)} />
			<input
				type="text"
				disabled={disabled}
				value={draft}
				placeholder={mixedPlaceholder(value)}
				onFocus={onFocus}
				onChange={(event) => {
					setDraft(event.currentTarget.value);
				}}
				onBlur={onBlur}
				onKeyDown={onKeyDown}
				className="h-6 w-full rounded-md border border-white/10 bg-black/25 px-1.5 font-mono text-fg text-ui outline-none transition placeholder:text-fg-subtle focus:border-accent/70 disabled:cursor-not-allowed disabled:opacity-45"
			/>
		</label>
	);
}

const COLOR_PICKER_PANEL_CLASS =
	"z-50 w-[232px] rounded-md border border-white/12 bg-surface-raised/98 p-2 text-fg text-ui shadow-2xl shadow-black/55 outline-none backdrop-blur-xl";

function ColorField({
	label,
	value,
	resetKey,
	disabled = false,
	onCommit,
	onLiveCommit,
	allowNone = false,
	alpha,
	onAlphaLiveCommit,
}: ColorFieldProps) {
	const { draft, setDraft, cancelDraft, onFocus, onBlur } =
		useInspectorFieldDraft({
			value,
			resetKey,
			toDraft: draftFromColor,
			onCommit,
		});
	const [open, setOpen] = useState(false);
	const gestureRef = useRef<GestureTransaction | null>(null);
	const alphaGestureRef = useRef<GestureTransaction | null>(null);

	const mixed = value === MIXED_VALUE;
	const colorString = mixed ? null : value;
	const normalized =
		typeof colorString === "string" ? normalizeColorInput(colorString) : null;
	const isNone = normalized === "none";
	const swatchHex = normalized && normalized !== "none" ? normalized : null;

	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter") {
			event.currentTarget.blur();
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			cancelDraft();
			event.currentTarget.blur();
		}
	};

	// Distinct, high-contrast trigger states: a diagonal danger slash for the
	// explicit no-fill state, a faint hatch for a mixed selection, otherwise the
	// solid current color (never silent black, the bug the native input had).
	const triggerBackground = mixed
		? "repeating-linear-gradient(45deg, var(--fg-muted) 0 2px, transparent 2px 5px)"
		: isNone
			? "linear-gradient(135deg, transparent 0 42%, var(--danger) 42% 58%, transparent 58%)"
			: (swatchHex ?? "#000000");

	return (
		<div className="block min-w-0">
			<FieldLabel label={label} mixed={mixed} />
			<div className="flex h-6 items-center gap-1 rounded-md border border-white/10 bg-black/25 px-1.5 transition focus-within:border-accent/70">
				<Popover.Root open={open} onOpenChange={setOpen} modal={false}>
					<Popover.Trigger
						type="button"
						disabled={disabled}
						aria-label={`${label} — open color picker`}
						title={label}
						className="size-3.5 shrink-0 rounded border border-white/15 outline-none transition focus-visible:ring-1 focus-visible:ring-accent/70 disabled:cursor-not-allowed disabled:opacity-45"
						style={{ background: triggerBackground }}
					/>
					<Popover.Portal>
						<Popover.Positioner
							align="start"
							side="bottom"
							sideOffset={6}
							collisionPadding={8}
							className="z-50 outline-none"
						>
							<Popover.Popup className={COLOR_PICKER_PANEL_CLASS}>
								<ColorPicker
									value={colorString}
									mixed={mixed}
									resetKey={resetKey}
									disabled={disabled}
									allowNone={allowNone}
									onChange={(hex) => {
										if (onLiveCommit && gestureRef.current) {
											onLiveCommit(hex, gestureRef.current.coalesceKey);
										} else {
											onCommit(hex);
										}
									}}
									onCommit={(hex) => onCommit(hex)}
									onGestureStart={() => {
										if (!onLiveCommit) return;
										gestureRef.current = beginGestureTransaction(
											`inspector-color:${resetKey}`,
											"Edit color",
										);
									}}
									onGestureEnd={() => {
										if (gestureRef.current) {
											commitGestureTransaction(gestureRef.current);
										}
										gestureRef.current = null;
									}}
									onClear={allowNone ? () => onCommit("none") : undefined}
									alpha={alpha}
									onAlphaChange={
										onAlphaLiveCommit
											? (next) => {
													if (!alphaGestureRef.current) {
														alphaGestureRef.current = beginGestureTransaction(
															`inspector-color-alpha:${resetKey}`,
															"Edit color opacity",
														);
													}
													onAlphaLiveCommit(
														next,
														alphaGestureRef.current.coalesceKey,
													);
												}
											: undefined
									}
									onAlphaEnd={() => {
										if (alphaGestureRef.current) {
											commitGestureTransaction(alphaGestureRef.current);
										}
										alphaGestureRef.current = null;
									}}
								/>
							</Popover.Popup>
						</Popover.Positioner>
					</Popover.Portal>
				</Popover.Root>
				<input
					type="text"
					aria-label={label}
					disabled={disabled}
					value={draft}
					placeholder={mixedPlaceholder(value)}
					onFocus={onFocus}
					onChange={(event) => {
						setDraft(event.currentTarget.value);
					}}
					onBlur={onBlur}
					onKeyDown={onKeyDown}
					className="min-w-0 flex-1 bg-transparent font-mono text-fg text-ui outline-none placeholder:text-fg-subtle disabled:cursor-not-allowed disabled:opacity-45"
				/>
			</div>
		</div>
	);
}

function TextAlignField({
	value,
	disabled = false,
	onCommit,
}: TextAlignFieldProps) {
	return (
		<div className="block min-w-0">
			<div className="mb-0.5 flex items-center justify-between gap-1">
				<span className="text-fg-muted text-ui">Align</span>
				{value === MIXED_VALUE ? <MixedBadge /> : null}
			</div>
			<div className="grid h-6 grid-cols-3 overflow-hidden rounded-md border border-white/10 bg-black/25">
				{textAlignOptions.map((option) => {
					const selected = value === option.value;
					return (
						<button
							key={option.value}
							type="button"
							aria-label={option.label}
							aria-pressed={selected}
							title={option.label}
							disabled={disabled}
							onClick={() => onCommit(option.value)}
							className={cn(
								"grid min-w-0 place-items-center border-white/10 border-r text-fg-muted transition last:border-r-0 disabled:cursor-not-allowed disabled:opacity-45",
								selected
									? "bg-accent-surface text-accent-fg"
									: "hover:bg-white/[0.06] hover:text-white",
							)}
						>
							{option.icon}
						</button>
					);
				})}
			</div>
		</div>
	);
}

function TextToggleButton({
	label,
	value,
	disabled = false,
	onToggle,
	children,
}: TextToggleButtonProps) {
	const selected = value === true;
	const mixed = value === MIXED_VALUE;
	return (
		<button
			type="button"
			aria-label={label}
			aria-pressed={mixed ? "mixed" : selected}
			title={mixed ? `${label} — mixed` : label}
			disabled={disabled}
			onClick={onToggle}
			className={cn(
				"grid h-6 min-w-0 place-items-center rounded-md border border-white/10 text-fg-muted transition disabled:cursor-not-allowed disabled:opacity-45",
				selected
					? "border-accent/60 bg-accent-surface text-accent-fg"
					: mixed
						? "bg-black/25 text-fg-subtle"
						: "bg-black/25 hover:bg-white/[0.06] hover:text-white",
			)}
		>
			<span className="sr-only">{mixed ? "Mixed" : ""}</span>
			{children}
		</button>
	);
}

function SelectField<T extends string>({
	label,
	value,
	options,
	resetKey,
	disabled = false,
	onCommit,
}: SelectFieldProps<T>) {
	const focusedResetKeyRef = useRef<string | null>(null);
	const selectedValue = typeof value === "string" ? value : "";
	const placeholder = value === MIXED_VALUE ? "Mixed" : "—";
	return (
		<label className="block min-w-0">
			<FieldLabel label={label} mixed={hasMixedValue(value)} />
			<select
				disabled={disabled}
				value={selectedValue}
				onFocus={() => {
					focusedResetKeyRef.current = resetKey;
				}}
				onBlur={() => {
					focusedResetKeyRef.current = null;
				}}
				onChange={(event) => {
					if (focusedResetKeyRef.current !== resetKey) return;
					onCommit(event.currentTarget.value as T);
				}}
				className="h-6 w-full rounded-md border border-white/10 bg-black/25 px-1.5 text-fg text-ui outline-none transition focus:border-accent/70 disabled:cursor-not-allowed disabled:opacity-45"
			>
				<option value="" disabled>
					{placeholder}
				</option>
				{options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
		</label>
	);
}

/**
 * One-click enum control: a labelled row of equal-width segments replacing a
 * dropdown for tiny enums (stroke position/cap/join/style) — the value is
 * changed in a single click and every choice is previewed by its glyph. A mixed
 * selection highlights no segment and shows the shared Mixed badge.
 */
function SegmentedField<T extends string>({
	label,
	value,
	options,
	disabled = false,
	onCommit,
}: {
	readonly label: string;
	readonly value: MixedValue<T> | null;
	readonly options: readonly {
		readonly value: T;
		readonly title: string;
		readonly content: ReactNode;
	}[];
	readonly disabled?: boolean;
	readonly onCommit: (value: T) => void;
}) {
	const selected = typeof value === "string" ? value : null;
	return (
		<div className="block min-w-0">
			<FieldLabel label={label} mixed={hasMixedValue(value)} />
			<div className="grid h-6 auto-cols-fr grid-flow-col overflow-hidden rounded-md border border-white/10 bg-black/25">
				{options.map((option) => {
					const isSelected = option.value === selected;
					return (
						<button
							key={option.value}
							type="button"
							title={option.title}
							aria-label={option.title}
							aria-pressed={isSelected}
							disabled={disabled}
							onClick={() => {
								if (!isSelected) onCommit(option.value);
							}}
							className={cn(
								"grid min-w-0 place-items-center border-white/10 border-r transition last:border-r-0 disabled:cursor-not-allowed disabled:opacity-45",
								isSelected
									? "bg-accent-surface text-accent-fg"
									: "text-fg-muted hover:bg-white/[0.06] hover:text-fg",
							)}
						>
							{option.content}
						</button>
					);
				})}
			</div>
		</div>
	);
}

/**
 * "Has fill / has stroke" switch header, matching the shadow/blur block headers
 * so on/off reads the same across the whole Appearance panel. A mixed selection
 * shows an indeterminate box plus the shared badge instead of pretending a
 * uniform state; checking it turns the role on for every selected node.
 */
function PaintRoleToggleHeader({
	label,
	enabled,
	disabled,
	onToggle,
}: {
	readonly label: string;
	readonly enabled: MixedValue<boolean> | null;
	readonly disabled: boolean;
	readonly onToggle: (enabled: boolean) => void;
}) {
	return (
		<div className="flex h-5 items-center justify-between gap-2 text-ui">
			<label className="flex min-w-0 items-center gap-1 text-fg-muted">
				<input
					type="checkbox"
					checked={enabled === true}
					ref={(input) => {
						if (input) input.indeterminate = enabled === MIXED_VALUE;
					}}
					disabled={disabled}
					onChange={(event) => onToggle(event.currentTarget.checked)}
					className="size-3 accent-accent disabled:cursor-not-allowed disabled:opacity-45"
				/>
				<span className="text-fg">{label}</span>
			</label>
			{enabled === MIXED_VALUE ? <MixedBadge /> : null}
		</div>
	);
}

function TextAreaField({
	label,
	value,
	resetKey,
	disabled = false,
	onCommit,
}: TextAreaFieldProps) {
	const { draft, setDraft, cancelDraft, onFocus, onBlur } =
		useInspectorFieldDraft({
			value,
			resetKey,
			toDraft: draftFromText,
			onCommit,
		});

	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
			event.currentTarget.blur();
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			cancelDraft();
			event.currentTarget.blur();
		}
	};

	return (
		<label className="block min-w-0">
			<FieldLabel label={label} mixed={hasMixedValue(value)} />
			<textarea
				disabled={disabled}
				value={draft}
				placeholder={mixedPlaceholder(value)}
				onFocus={onFocus}
				onChange={(event) => {
					setDraft(event.currentTarget.value);
				}}
				onBlur={onBlur}
				onKeyDown={onKeyDown}
				className="min-h-16 w-full resize-y rounded-md border border-white/10 bg-black/25 px-2 py-1 font-mono text-fg text-ui leading-4 outline-none transition placeholder:text-fg-subtle focus:border-accent/70 disabled:cursor-not-allowed disabled:opacity-45"
			/>
		</label>
	);
}

function TextBoxModeField({
	value,
	disabled = false,
	onCommit,
}: {
	readonly value: MixedValue<TextResizeMode> | null;
	readonly disabled?: boolean;
	readonly onCommit: (value: TextResizeMode) => boolean;
}) {
	return (
		<div className="block min-w-0">
			<FieldLabel label="Mode" mixed={hasMixedValue(value)} />
			<div className="grid h-6 grid-cols-2 overflow-hidden rounded-md border border-white/10 bg-black/25">
				{textBoxModeOptions.map((option) => {
					const active = value === option.value;
					return (
						<button
							key={option.value}
							type="button"
							disabled={disabled}
							aria-pressed={active}
							title={option.label}
							onClick={() => onCommit(option.value)}
							className={cn(
								"min-w-0 border-white/10 border-r px-1 text-ui transition last:border-r-0 disabled:cursor-not-allowed disabled:opacity-45",
								active
									? "bg-accent-surface text-accent-fg"
									: "text-fg-muted hover:bg-white/[0.06] hover:text-fg",
							)}
						>
							{option.label}
						</button>
					);
				})}
			</div>
		</div>
	);
}

function TextBoxControls({
	state,
	resetKey,
	singleAuthoringTarget,
}: {
	readonly state: TextBoxEditingState;
	readonly resetKey: string;
	readonly singleAuthoringTarget?: {
		readonly node: VectorNode;
		readonly recording: boolean;
		readonly keyframeState: ReadyInspectorKeyframeActionState;
	};
}) {
	const overflowLabel =
		state.values.overflowY === MIXED_VALUE
			? "Mixed"
			: typeof state.values.overflowY === "number" && state.values.overflowY > 0
				? `+${formatInspectorNumber(state.values.overflowY)}`
				: state.values.fits === MIXED_VALUE
					? "Mixed"
					: "Fits";
	return (
		<div className="space-y-1">
			<TextBoxModeField
				value={state.values.mode}
				onCommit={(value) => commitTextBoxMode(state.textNodeIds, value)}
			/>
			<div className="grid grid-cols-2 gap-1">
				<NumericField
					label="Box W"
					value={state.values.width}
					resetKey={`${resetKey}:width`}
					step="1"
					onCommit={(value) =>
						singleAuthoringTarget
							? commitSingleInspectorNumberEdit(
									singleAuthoringTarget.node,
									singleAuthoringTarget.recording,
									singleAuthoringTarget.keyframeState,
									"width",
									value,
									{ textBoxResize: true },
								)
							: commitTextBoxNumber(state.textNodeIds, "width", value)
					}
				/>
				<NumericField
					label="Box H"
					value={state.values.height}
					resetKey={`${resetKey}:height`}
					step="1"
					onCommit={(value) =>
						singleAuthoringTarget
							? commitSingleInspectorNumberEdit(
									singleAuthoringTarget.node,
									singleAuthoringTarget.recording,
									singleAuthoringTarget.keyframeState,
									"height",
									value,
									{ textBoxResize: true },
								)
							: commitTextBoxNumber(state.textNodeIds, "height", value)
					}
				/>
			</div>
			<ReadoutRow label="Overflow" value={overflowLabel} />
		</div>
	);
}

function TypographyControls({
	state,
	resetKey,
}: {
	readonly state: TextStyleEditingState;
	readonly resetKey: string;
}) {
	const fontFamilyValue = codeSafeTextFontSelectValue(state.values.fontFamily);
	const unsupportedFontFamily = unsupportedTextFontFamily(
		state.values.fontFamily,
	);
	return (
		<div className="space-y-1">
			<SelectField
				label="Family"
				value={fontFamilyValue}
				options={codeSafeTextFontOptions}
				resetKey={`${resetKey}:font-family`}
				onCommit={(value) => commitTextFontFamily(state.textNodeIds, value)}
			/>
			{unsupportedFontFamily ? (
				<ReadoutRow label="Unsupported" value={unsupportedFontFamily} />
			) : null}
			<div className="grid grid-cols-3 gap-1">
				<TextToggleButton
					label="Bold"
					value={state.values.bold}
					onToggle={() => commitToggleTextBold(state.textNodeIds)}
				>
					<TextB size={14} weight="bold" />
				</TextToggleButton>
				<TextToggleButton
					label="Italic"
					value={state.values.italic}
					onToggle={() => commitToggleTextItalic(state.textNodeIds)}
				>
					<TextItalic size={14} weight="bold" />
				</TextToggleButton>
				<TextToggleButton
					label="Underline"
					value={state.values.underline}
					onToggle={() => commitToggleTextUnderline(state.textNodeIds)}
				>
					<TextUnderline size={14} weight="bold" />
				</TextToggleButton>
			</div>
			<ColorField
				label="Fill"
				value={state.values.fill}
				resetKey={`${resetKey}:fill`}
				allowNone
				onCommit={(value) => commitTextFill(state.textNodeIds, value)}
				onLiveCommit={(value, coalesceKey) =>
					commitTextFill(state.textNodeIds, value, coalesceKey)
				}
			/>
			<div className="grid grid-cols-2 gap-1">
				{textStyleNumberFields.map(({ label, field, step }) => (
					<NumericField
						key={field}
						label={label}
						value={state.values[field]}
						resetKey={`${resetKey}:${field}`}
						step={step}
						onCommit={(value) =>
							commitTextStyleNumber(state.textNodeIds, field, value)
						}
					/>
				))}
				<TextAlignField
					value={state.values.align}
					onCommit={(value) => commitTextAlign(state.textNodeIds, value)}
				/>
			</div>
		</div>
	);
}

function ReadoutRow({
	label,
	value,
}: {
	readonly label: string;
	readonly value: string;
}) {
	return (
		<div className="flex h-6 items-center justify-between gap-2 rounded-md border border-white/8 bg-black/15 px-1.5 text-ui">
			<span className="text-fg-muted">{label}</span>
			<span
				className="min-w-0 truncate font-mono text-fg-secondary"
				title={value}
			>
				{value}
			</span>
		</div>
	);
}

const readoutText = (value: MixedValue<string> | null): string => {
	if (value === MIXED_VALUE) return "Mixed";
	return value ?? "—";
};

const HEX6_PATTERN = /^#[0-9a-fA-F]{6}$/;
const HEX3_PATTERN = /^#[0-9a-fA-F]{3}$/;
const HEX_RADIX = 16;
const STOP_PERCENT = 100;

function selectGradientStop(
	nodeId: string,
	role: PrimaryPaintRole,
	stopId: string,
): void {
	useSelectionStore
		.getState()
		.setSubSelection({ nodeId, kind: "gradient-stop", role, stopId });
}

/** CSS color for the ramp preview, folding stop opacity into rgba() for hex inputs. */
function cssStopColor(color: string, opacity: number): string {
	const expanded = HEX3_PATTERN.test(color)
		? `#${color
				.slice(1)
				.split("")
				.map((channel) => channel + channel)
				.join("")}`
		: color;
	if (!HEX6_PATTERN.test(expanded)) return color;
	const r = Number.parseInt(expanded.slice(1, 3), HEX_RADIX);
	const g = Number.parseInt(expanded.slice(3, 5), HEX_RADIX);
	const b = Number.parseInt(expanded.slice(5, 7), HEX_RADIX);
	return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

function rampBackground(
	stops: readonly GradientEditModel["stops"][number][],
): string {
	if (stops.length === 0) return "transparent";
	const segments = [...stops]
		.sort((a, b) => a.offset - b.offset)
		.map(
			(stop) =>
				`${cssStopColor(stop.color, stop.opacity)} ${(stop.offset * STOP_PERCENT).toFixed(2)}%`,
		)
		.join(", ");
	return `linear-gradient(to right, ${segments})`;
}

/**
 * Live-painted gradient ramp with draggable stop thumbs. Clicking a thumb selects
 * the stop (driving the same `selection.sub` the canvas annotator writes); dragging
 * a thumb moves its offset as one undo entry; clicking the bare ramp adds a stop at
 * the click position and selects it.
 */
function GradientRampBar({
	nodeId,
	paintRole,
	stops,
	selectedStopId,
	disabled,
}: {
	readonly nodeId: string;
	readonly paintRole: PrimaryPaintRole;
	readonly stops: GradientEditModel["stops"];
	readonly selectedStopId: string | null;
	readonly disabled: boolean;
}) {
	const barRef = useRef<HTMLDivElement | null>(null);

	const offsetFromClientX = (clientX: number): number => {
		const rect = barRef.current?.getBoundingClientRect();
		if (!rect || rect.width === 0) return 0;
		return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
	};

	const startThumbDrag = (
		event: ReactPointerEvent<HTMLButtonElement>,
		stopId: string,
	): void => {
		if (disabled) return;
		event.preventDefault();
		event.stopPropagation();
		selectGradientStop(nodeId, paintRole, stopId);
		const transaction = beginGestureTransaction(
			`inspector-ramp:${nodeId}:${stopId}`,
			"Edit gradient stop",
		);
		const onMove = (move: PointerEvent): void => {
			const paint = liveGradientPaintForInspector(nodeId, paintRole);
			if (!paint) return;
			const index = indexOfStop(paint, stopId);
			if (index < 0) return;
			commitLiveGradientPaint(
				nodeId,
				paintRole,
				setStopOffset(paint, index, offsetFromClientX(move.clientX)),
				transaction.coalesceKey,
			);
		};
		const onUp = (): void => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			commitGestureTransaction(transaction);
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
	};

	const addAtPointer = (event: ReactPointerEvent<HTMLDivElement>): void => {
		if (disabled) return;
		const stopId = commitAddGradientStopAt(
			nodeId,
			paintRole,
			offsetFromClientX(event.clientX),
		);
		if (stopId) selectGradientStop(nodeId, paintRole, stopId);
	};

	return (
		<div className="relative h-6">
			<div
				ref={barRef}
				className={cn(
					"h-6 w-full rounded-md border border-white/10",
					disabled ? "opacity-45" : "cursor-copy",
				)}
				style={{ background: rampBackground(stops) }}
				onPointerDown={addAtPointer}
			/>
			{stops.map((stop) =>
				stop.id ? (
					<button
						key={stop.id}
						type="button"
						aria-label={`Gradient stop at ${Math.round(stop.offset * STOP_PERCENT)} percent`}
						disabled={disabled}
						onPointerDown={(event) => startThumbDrag(event, stop.id ?? "")}
						className={cn(
							"-translate-x-1/2 absolute top-0 grid h-6 w-6 cursor-grab place-items-center disabled:cursor-not-allowed",
							stop.id === selectedStopId ? "z-10" : "z-0",
						)}
						style={{ left: `${stop.offset * STOP_PERCENT}%` }}
					>
						<span
							className={cn(
								"block size-3 rounded-full border shadow-black/40 shadow-sm transition",
								stop.id === selectedStopId
									? "scale-110 border-accent ring-2 ring-accent"
									: "border-white/70",
							)}
							style={{ background: cssStopColor(stop.color, stop.opacity) }}
						/>
					</button>
				) : null,
			)}
		</div>
	);
}

/** Color / position / opacity / delete controls for the currently selected stop. */
function SelectedStopControls({
	nodeId,
	paintRole,
	stops,
	selectedStopId,
	resetKey,
	disabled,
}: {
	readonly nodeId: string;
	readonly paintRole: PrimaryPaintRole;
	readonly stops: GradientEditModel["stops"];
	readonly selectedStopId: string | null;
	readonly resetKey: string;
	readonly disabled: boolean;
}) {
	const index = stops.findIndex(
		(stop) => stop.id !== undefined && stop.id === selectedStopId,
	);
	const stop = index >= 0 ? stops[index] : undefined;
	if (!stop) {
		return (
			<p className="px-0.5 text-fg-subtle text-ui">
				Select a stop on the ramp or canvas to edit it.
			</p>
		);
	}
	const stopKey = stop.id ?? String(index);
	const canRemove = stops.length > 2;
	return (
		<div className="grid grid-cols-[1fr_3.5rem_auto] items-end gap-1">
			<ColorField
				label="Color"
				value={stop.color}
				resetKey={`${resetKey}:color:${stopKey}`}
				disabled={disabled}
				alpha={stop.opacity}
				onCommit={(value) =>
					commitGradientStopColor([nodeId], paintRole, index, value)
				}
				onLiveCommit={(value, coalesceKey) =>
					commitGradientStopColor(
						[nodeId],
						paintRole,
						index,
						value,
						coalesceKey,
					)
				}
				onAlphaLiveCommit={(value, coalesceKey) =>
					commitGradientStopOpacity(
						[nodeId],
						paintRole,
						index,
						value,
						coalesceKey,
					)
				}
			/>
			<NumericField
				label="Pos %"
				value={Math.round(stop.offset * STOP_PERCENT)}
				resetKey={`${resetKey}:offset:${stopKey}`}
				step="1"
				disabled={disabled}
				onCommit={(value) =>
					commitGradientStopOffset(
						[nodeId],
						paintRole,
						index,
						value / STOP_PERCENT,
					)
				}
			/>
			<button
				type="button"
				aria-label="Remove selected stop"
				title="Remove stop"
				disabled={disabled || !canRemove}
				onClick={() => commitRemoveGradientStop([nodeId], paintRole, index)}
				className="grid size-6 place-items-center self-end rounded-md border border-white/10 bg-black/25 text-fg-muted transition hover:text-warn-fg disabled:cursor-not-allowed disabled:opacity-45"
			>
				<Trash aria-hidden="true" size={11} />
			</button>
		</div>
	);
}

const FILL_PAINT_PANEL_CLASS =
	"z-50 w-[248px] space-y-2 rounded-md border border-white/12 bg-surface-raised/98 p-2 text-fg text-ui shadow-2xl shadow-black/55 outline-none backdrop-blur-xl";

/** Symmetric fill paint kinds offered as a segmented row (the commitPaintKind seam). */
const FILL_PAINT_KIND_ROW = [
	{ value: "solid", label: "Solid" },
	{ value: "linear-gradient", label: "Linear" },
	{ value: "radial-gradient", label: "Radial" },
] as const;

const FILL_SWATCH_MESH_GLYPH =
	"conic-gradient(from 45deg, var(--fg-muted), var(--surface-raised) 50%, var(--fg-muted))";
const FILL_SWATCH_MIXED =
	"repeating-linear-gradient(45deg, var(--fg-muted) 0 2px, transparent 2px 5px)";
const FILL_SWATCH_NONE =
	"linear-gradient(135deg, transparent 0 42%, var(--danger) 42% 58%, transparent 58%)";

type PrimaryPaintSharedColorState =
	| { readonly kind: "unbound" }
	| {
			readonly kind: "single-owner";
			readonly propId: string;
			readonly propName: string;
	  }
	| { readonly kind: "ambiguous"; readonly reason: string };

const primaryPaintSharedColorState = (
	document: SceneDocument,
	nodeIds: readonly string[],
	paintRole: PrimaryPaintRole,
): PrimaryPaintSharedColorState => {
	const owners = [...new Set(nodeIds)].map((nodeId) => {
		const binding = {
			kind: "style-color",
			nodeId,
			role: paintRole === "fills" ? "fill" : "stroke",
			paintIndex: 0,
		} as const;
		return {
			binding,
			items: componentPropStyleColorTargetOwners(document, binding),
		};
	});
	if (owners.every(({ items }) => items.length === 0)) {
		return { kind: "unbound" };
	}
	const first = owners[0]?.items[0];
	const conflicts = owners.flatMap(({ binding, items }) => {
		if (items.length === 0) return [];
		const conflict = sharedColorOwnershipConflictForInspector(
			document,
			binding,
			items.length === 1 ? items[0]?.id : undefined,
		);
		return conflict ? [conflict] : [];
	});
	const combinedConflict = conflicts.find(
		(conflict) =>
			conflict.kind === "component-override-and-duplicate-color-prop",
	);
	const overrideConflict = conflicts.find(
		(conflict) => conflict.kind === "component-override",
	);
	const duplicateConflict = conflicts.find(
		(conflict) => conflict.kind === "duplicate-color-prop",
	);
	if (combinedConflict || (overrideConflict && duplicateConflict)) {
		return {
			kind: "ambiguous",
			reason:
				"A component override and multiple shared colors claim this selection. Remove the override and duplicate drivers.",
		};
	}
	const ownershipConflict = overrideConflict ?? duplicateConflict;
	if (ownershipConflict) {
		return {
			kind: "ambiguous",
			reason: ownershipConflict.reason,
		};
	}
	if (
		first &&
		owners.every(({ items }) => items.length === 1 && items[0]?.id === first.id)
	) {
		return {
			kind: "single-owner",
			propId: first.id,
			propName: first.name,
		};
	}
	return {
		kind: "ambiguous",
		reason:
			"This selection mixes shared-color owners and/or unbound paints. Edit one shared driver or select a uniform unbound set.",
	};
};

/** Human label for the active fill paint kind, shown beside the swatch. */
function fillKindLabel(kind: string | null, mixed: boolean): string {
	if (mixed) return "Mixed";
	if (kind === "linear-gradient") return "Linear gradient";
	if (kind === "radial-gradient") return "Radial gradient";
	if (kind === "mesh-gradient") return "Gradient mesh";
	if (kind === "image-reference") return "Image";
	return "Solid";
}

/**
 * Live preview painted into the fill swatch so it is never blank or disabled-looking:
 * the gradient ramp for gradients, a mesh glyph for mesh, the solid color (or a danger
 * slash for an explicit no-fill) otherwise. Token-safe — the dynamic value is an inline
 * style, never a raw-hex className.
 */
function fillSwatchBackground(
	kind: string | null,
	mixed: boolean,
	colorString: string | null,
	gradient: GradientEditModel | null,
): string {
	if (mixed) return FILL_SWATCH_MIXED;
	if (kind === "linear-gradient" || kind === "radial-gradient") {
		return gradient ? rampBackground(gradient.stops) : FILL_SWATCH_MESH_GLYPH;
	}
	if (kind === "mesh-gradient") return FILL_SWATCH_MESH_GLYPH;
	const hex =
		typeof colorString === "string" ? normalizeColorInput(colorString) : null;
	if (hex === "none") return FILL_SWATCH_NONE;
	return hex && hex !== "none" ? hex : "#000000";
}

/**
 * Stopwatch/diamond key for the gradient fill: snapshots the current linear/radial
 * gradient as a `fillGradient` keyframe at the playhead. Two keys at different frames
 * animate the gradient — the sampler tweens geometry + stops between them. Accent when
 * keyed at the current frame, warn when the track is animated at other frames.
 */
function GradientKeyframeButton({ nodeId }: { readonly nodeId: string }) {
	const motion = useMotionStore((state) => state.document);
	const currentFrame = useTransportStore((state) => state.currentFrame);
	const frame = motionAuthoringFrame(motion, currentFrame);
	const track = findTrack(motion, nodeId, "fillGradient");
	const animated = (track?.keyframes.length ?? 0) > 0;
	const keyedAtFrame =
		track?.keyframes.some((kf) => kf.time === frame) ?? false;
	const keyLabel = keyedAtFrame
		? `Update gradient keyframe at frame ${frame}`
		: `Set gradient keyframe at frame ${frame}`;
	return (
		<button
			type="button"
			aria-label={keyLabel}
			title={keyLabel}
			onClick={() => keyGradientFillAtPlayhead(nodeId)}
			className={cn(
				"grid size-6 shrink-0 place-items-center rounded-md border transition",
				keyedAtFrame
					? "border-accent bg-accent-surface text-accent-fg"
					: animated
						? "border-warn/45 bg-warn-surface text-warn hover:border-warn/70"
						: "border-white/10 bg-black/20 text-fg-muted hover:border-white/20 hover:text-white",
			)}
		>
			<Diamond
				aria-hidden="true"
				size={11}
				weight={keyedAtFrame ? "fill" : "regular"}
			/>
		</button>
	);
}

/**
 * Unified paint control for a primary fill OR stroke: one always-on swatch that
 * previews the live paint and opens a popover whose top is a paint-type row
 * (Solid · Linear · Radial) and whose body reuses the solid ColorPicker and the
 * gradient ramp/stops editor. Replaces the old ColorField swatch that went
 * disabled and blank for any non-solid paint, the bare "type" dropdown, and the
 * disjoint gradient block — so changing or editing either role's paint is one
 * gesture off one control. Role differences are intentional: only fills offer
 * the mesh conversion row and show the gradient keyframe diamond (the
 * `fillGradient` motion track is fill-scoped). Both fill and stroke gradients
 * activate the on-canvas gradient tool while the popover is open, targeting the
 * role that opened it.
 */
function PaintField({
	paintRole,
	nodeIds,
	singleNodeId,
	paintKind,
	color,
	colorEditable,
	gradient,
	canConvertToMesh,
	sharedColorState,
	resetKey,
	disabled,
}: {
	readonly paintRole: PrimaryPaintRole;
	readonly nodeIds: readonly string[];
	readonly singleNodeId: string | undefined;
	readonly paintKind: MixedValue<string> | null;
	readonly color: MixedValue<string | null> | null;
	readonly colorEditable: boolean;
	readonly gradient: GradientEditModel | null;
	readonly canConvertToMesh: boolean;
	readonly sharedColorState: PrimaryPaintSharedColorState;
	readonly resetKey: string;
	readonly disabled: boolean;
}) {
	const [open, setOpen] = useState(false);
	const sub = useSelectionStore((state) => state.sub);
	const gestureKeyRef = useRef<string | null>(null);
	const gestureSeqRef = useRef(0);

	const isFill = paintRole === "fills";
	const roleTitle = isFill ? "Fill" : "Stroke";
	const mixed = paintKind === MIXED_VALUE;
	const kind = mixed || paintKind === null ? null : paintKind;
	const isGradient = kind === "linear-gradient" || kind === "radial-gradient";
	const colorString = color === MIXED_VALUE || color == null ? null : color;
	const structureEditDisabled = disabled || sharedColorState.kind !== "unbound";
	const sharedTargetInvalid =
		sharedColorState.kind === "single-owner" && kind !== "solid";
	const colorEditDisabled =
		disabled ||
		!colorEditable ||
		sharedColorState.kind === "ambiguous" ||
		sharedTargetInvalid;
	const ownedDetailDisabled = disabled || sharedColorState.kind !== "unbound";
	const sharedColorMessage =
		sharedColorState.kind === "single-owner"
			? sharedTargetInvalid
				? `Shared color ${sharedColorState.propName} owns this address, but the paint is no longer solid. Repair or remove the driver before editing.`
				: `Color is driven by ${sharedColorState.propName}; solid color edits update every consumer. Paint type is locked while the driver owns this slot.`
			: sharedColorState.kind === "ambiguous"
				? sharedColorState.reason
				: null;

	// While the picker is open on a gradient paint, activate the gradient tool so the
	// on-canvas endpoint handles appear and accept drags (the overlay's visual gate and
	// the canvas pointer routing are each keyed on the active tool). commitPaintKind
	// reveals them on a fresh switch; this covers re-opening the picker on an existing
	// gradient, so re-aiming never requires discovering the "G" shortcut.
	useEffect(() => {
		if (!open || !isGradient || ownedDetailDisabled) return;
		useGradientEditorStore.getState().setTargetRole(paintRole);
		useToolSelectionStore.getState().setActiveTool("gradient");
		return () => {
			const editor = useToolSelectionStore.getState();
			if (editor.activeTool === "gradient") editor.setActiveTool("select");
			useGradientEditorStore.getState().setTargetRole("fills");
		};
	}, [open, isGradient, ownedDetailDisabled, paintRole]);

	// Persist stable stop ids the first time the picker opens on a legacy/id-less
	// gradient, so the ramp can render every stop thumb (id-less stops are skipped
	// on render). Idempotent — already-hydrated gradients write nothing.
	useEffect(() => {
		if (
			!open ||
			!isGradient ||
			ownedDetailDisabled ||
			singleNodeId === undefined
		)
			return;
		commitHydrateGradientStops(singleNodeId, paintRole);
	}, [open, isGradient, ownedDetailDisabled, singleNodeId, paintRole]);

	const selectedStopId =
		sub?.kind === "gradient-stop" &&
		sub.role === paintRole &&
		singleNodeId !== undefined &&
		sub.nodeId === singleNodeId
			? sub.stopId
			: null;

	return (
		<div className="block min-w-0">
			<FieldLabel label="Paint" mixed={mixed} />
			<div className="flex h-6 items-center gap-1 rounded-md border border-white/10 bg-black/25 px-1.5 transition focus-within:border-accent/70">
				<Popover.Root open={open} onOpenChange={setOpen} modal={false}>
					<Popover.Trigger
						type="button"
						disabled={disabled}
						aria-label={`${roleTitle} — open paint editor`}
						title={roleTitle}
						className="size-3.5 shrink-0 rounded border border-white/15 outline-none transition focus-visible:ring-1 focus-visible:ring-accent/70 disabled:cursor-not-allowed disabled:opacity-45"
						style={{
							background: fillSwatchBackground(
								kind,
								mixed,
								colorString,
								gradient,
							),
						}}
					/>
					<Popover.Portal>
						<Popover.Positioner
							align="start"
							side="bottom"
							sideOffset={6}
							collisionPadding={8}
							className="z-50 outline-none"
						>
							<Popover.Popup className={FILL_PAINT_PANEL_CLASS}>
								{sharedColorMessage ? (
									<p className="px-0.5 text-fg-subtle text-ui">
										{sharedColorMessage}
									</p>
								) : null}
								<div className="space-y-1">
									<span className="block text-fg-muted text-ui">Paint</span>
									<div className="grid grid-cols-3 overflow-hidden rounded-md border border-white/10 bg-black/25">
										{FILL_PAINT_KIND_ROW.map((option) => {
											const selected = kind === option.value;
											return (
												<button
													key={option.value}
													type="button"
													aria-pressed={selected}
													disabled={structureEditDisabled}
													onClick={() =>
														commitPaintKind(nodeIds, paintRole, option.value)
													}
													className={cn(
														"grid h-6 min-w-0 place-items-center border-white/10 border-r text-fg-muted transition last:border-r-0 disabled:cursor-not-allowed disabled:opacity-45",
														selected
															? "bg-accent-surface text-accent-fg"
															: "hover:bg-white/[0.06] hover:text-white",
													)}
												>
													{option.label}
												</button>
											);
										})}
									</div>
									{isFill && canConvertToMesh && singleNodeId !== undefined ? (
										<button
											type="button"
											disabled={structureEditDisabled}
											title="Convert the fill into an editable gradient mesh (canvas-edited, not animated)"
											onClick={() => commitConvertFillToMesh(singleNodeId)}
											className="flex w-full items-center justify-center gap-1.5 rounded-md border border-white/10 bg-black/25 px-2 py-1 text-fg-muted transition hover:bg-white/[0.08] hover:text-fg disabled:cursor-not-allowed disabled:opacity-45"
										>
											<GridFour aria-hidden="true" size={12} />
											Gradient mesh
										</button>
									) : null}
								</div>

								{isGradient ? (
									singleNodeId !== undefined && gradient ? (
										<div className="space-y-1.5">
											<div className="flex h-5 items-center justify-between text-fg-muted text-ui">
												<span>Stops</span>
												<div className="flex items-center gap-1">
													<button
														type="button"
														aria-label="Reverse gradient stops"
														title="Reverse"
														disabled={ownedDetailDisabled}
														onClick={() =>
															commitReverseGradientStops(
																[singleNodeId],
																paintRole,
															)
														}
														className="grid size-5 place-items-center rounded-md border border-white/10 bg-black/25 text-fg-muted transition hover:text-accent-fg disabled:cursor-not-allowed disabled:opacity-45"
													>
														<ArrowsLeftRight aria-hidden="true" size={11} />
													</button>
													<button
														type="button"
														aria-label="Add gradient stop"
														title="Add stop"
														disabled={ownedDetailDisabled}
														onClick={() =>
															commitAddGradientStop([singleNodeId], paintRole)
														}
														className="grid size-5 place-items-center rounded-md border border-white/10 bg-black/25 text-fg-muted transition hover:text-accent-fg disabled:cursor-not-allowed disabled:opacity-45"
													>
														<Plus aria-hidden="true" size={11} />
													</button>
												</div>
											</div>
											<GradientRampBar
												nodeId={singleNodeId}
												paintRole={paintRole}
												stops={gradient.stops}
												selectedStopId={selectedStopId}
												disabled={ownedDetailDisabled}
											/>
											{gradient.kind === "linear-gradient" &&
											gradient.angleDeg !== null ? (
												<NumericField
													label="Angle°"
													value={Math.round(gradient.angleDeg)}
													resetKey={`${resetKey}:${paintRole}:angle`}
													step="1"
													disabled={ownedDetailDisabled}
													onCommit={(value) =>
														commitLinearGradientAngle(
															[singleNodeId],
															paintRole,
															value,
														)
													}
												/>
											) : null}
											<SelectedStopControls
												nodeId={singleNodeId}
												paintRole={paintRole}
												stops={gradient.stops}
												selectedStopId={selectedStopId}
												resetKey={`${resetKey}:${paintRole}`}
												disabled={ownedDetailDisabled}
											/>
										</div>
									) : (
										<p className="px-0.5 text-fg-subtle text-ui">
											Select a single object to edit gradient stops.
										</p>
									)
								) : kind === "mesh-gradient" ? (
									<p className="px-0.5 text-fg-subtle text-ui">
										Gradient mesh is edited on the canvas — drag points to shape
										it. Mesh fill is not animated.
									</p>
								) : (
									<ColorPicker
										value={colorString}
										mixed={mixed}
										resetKey={`${resetKey}:${paintRole}:color`}
										disabled={colorEditDisabled}
										allowNone
										onChange={(hex) => {
											if (gestureKeyRef.current) {
												commitPrimaryPaintColor(
													nodeIds,
													paintRole,
													hex,
													gestureKeyRef.current,
												);
											} else {
												commitPrimaryPaintColor(nodeIds, paintRole, hex);
											}
										}}
										onCommit={(hex) =>
											commitPrimaryPaintColor(nodeIds, paintRole, hex)
										}
										onGestureStart={() => {
											gestureSeqRef.current += 1;
											gestureKeyRef.current = `${paintRole}-color:${resetKey}:${gestureSeqRef.current}`;
										}}
										onGestureEnd={() => {
											gestureKeyRef.current = null;
										}}
										onClear={() =>
											commitPrimaryPaintColor(nodeIds, paintRole, "none")
										}
									/>
								)}
							</Popover.Popup>
						</Popover.Positioner>
					</Popover.Portal>
				</Popover.Root>
				<span className="min-w-0 flex-1 truncate text-fg-secondary text-ui">
					{fillKindLabel(kind, mixed)}
				</span>
				{isFill && isGradient && singleNodeId !== undefined ? (
					<GradientKeyframeButton nodeId={singleNodeId} />
				) : null}
			</div>
		</div>
	);
}

/**
 * A default single-node bounds fallback for seeding a fresh revealPaint
 * gradient's geometry (mirrors `convertPaintKind`'s bounds arg, which
 * `commitPaintKind`/`PaintField` source from the node's OWN geometry —
 * revealPaint has no per-node geometry concept of its own, so the current
 * selection's own bounds are the closest honest analogue for "a gradient
 * spanning this object").
 */
const REVEAL_PAINT_DEFAULT_BOUNDS: Bounds = {
	x: 0,
	y: 0,
	width: 200,
	height: 200,
};

/**
 * Unified paint control for a Noise Gradient dissolve's `revealPaint` — the
 * second color/gradient a `"dissolve"` blend mode reveals underneath the
 * object's own fill (see `revealPaintForNode` in `svg.ts`/`CanvasShell.tsx`).
 * Visually mirrors {@link PaintField} (same swatch/popover/kind-row markup and
 * `FILL_PAINT_KIND_ROW`/`fillSwatchBackground`/`fillKindLabel` primitives) but
 * is wired independently: `revealPaint` lives in the scoped Look Graph
 * overlay's grain payload (`artboard.effectIntent.scopedLooks[].lookGraph`),
 * not `node.style.fills`/`strokes`, so `PaintField`'s own commit plumbing
 * (`PrimaryPaintRole`-keyed, `node.style`-bound, with mesh conversion and
 * fill-only gradient keyframing that have no revealPaint analogue) does not
 * apply here.
 *
 * Tri-state contract (matches `GraphWithObjectNoiseGradientTextureOptions`):
 * picking a color/kind SETS `revealPaint`; the "Clear" button explicitly
 * REMOVES it (`null`) through {@link commitNoiseGradientRevealPaint}
 * directly — deliberately NOT through `ColorPicker`'s `allowNone`/`onClear`,
 * which produce a `"none"` SOLID color (semantically "revealPaint = solid
 * none", a real paint that resolves to nothing) rather than "no revealPaint
 * at all". Gradient depth is intentionally pragmatic (v1): kind is
 * selectable and each stop's color is editable via a plain `ColorPicker`, but
 * there is no on-canvas endpoint drag, ramp-position drag, or add/remove/
 * reverse — those are `GradientRampBar`/`SelectedStopControls`/the on-canvas
 * gradient tool, all hard-bound to `node.style.fills`/`strokes` via
 * `useGradientEditorStore.setTargetRole` (a `PrimaryPaintRole`, which
 * `revealPaint` is not). Setting a gradient revealPaint with custom geometry
 * is already possible via the command surface (MCP/agent); this keeps the
 * Inspector control honest about what it can edit rather than rebuilding a
 * parallel ramp/sub-selection surface for a feature whose primary authoring
 * entry point is AI-driven.
 */
function RevealPaintField({
	nodeIds,
	value,
	disabled,
	resetKey,
}: {
	readonly nodeIds: readonly string[];
	readonly value: MixedValue<RevealPaint | null> | null;
	readonly disabled: boolean;
	readonly resetKey: string;
}) {
	const [open, setOpen] = useState(false);
	const gestureKeyRef = useRef<string | null>(null);
	const gestureSeqRef = useRef(0);
	const document = useSceneStore((state) => state.document);

	const mixed = value === MIXED_VALUE;
	const current = mixed || value == null ? null : value;
	const kind = current?.kind ?? null;
	const isGradient = kind === "linear-gradient" || kind === "radial-gradient";
	const colorString =
		!mixed && current?.kind === "solid" ? current.color : null;
	const singleNodeId = nodeIds.length === 1 ? nodeIds[0] : undefined;
	const bounds = (() => {
		if (singleNodeId === undefined) return REVEAL_PAINT_DEFAULT_BOUNDS;
		const node = findNode(document, singleNodeId);
		return node
			? getGeometryBounds(node.geometry)
			: REVEAL_PAINT_DEFAULT_BOUNDS;
	})();

	const commitKind = (input: string): void => {
		if (
			input !== "solid" &&
			input !== "linear-gradient" &&
			input !== "radial-gradient"
		) {
			return;
		}
		const next = convertPaintKind(current ?? undefined, input, "none", bounds);
		// `convertPaintKind` only returns `null` for image/mesh kinds, neither of
		// which `FILL_PAINT_KIND_ROW` offers here — see its own doc.
		if (
			next &&
			next.kind !== "image-reference" &&
			next.kind !== "mesh-gradient"
		) {
			commitNoiseGradientRevealPaint(nodeIds, next);
		}
	};

	const commitStopColor = (
		index: number,
		color: string,
		coalesceKey?: string,
	): void => {
		if (!isGradient || current?.kind !== kind) return;
		if (
			current.kind !== "linear-gradient" &&
			current.kind !== "radial-gradient"
		) {
			return;
		}
		commitNoiseGradientRevealPaint(
			nodeIds,
			setStopColor(current, index, color),
			coalesceKey,
		);
	};

	return (
		<div className="block min-w-0">
			<FieldLabel label="Reveal paint" mixed={mixed} />
			<div className="flex h-6 items-center gap-1 rounded-md border border-white/10 bg-black/25 px-1.5 transition focus-within:border-accent/70">
				<Popover.Root open={open} onOpenChange={setOpen} modal={false}>
					<Popover.Trigger
						type="button"
						disabled={disabled}
						aria-label="Reveal paint — open paint editor"
						title="Reveal paint"
						className="size-3.5 shrink-0 rounded border border-white/15 outline-none transition focus-visible:ring-1 focus-visible:ring-accent/70 disabled:cursor-not-allowed disabled:opacity-45"
						style={{
							background: current
								? fillSwatchBackground(kind, mixed, colorString, null)
								: FILL_SWATCH_NONE,
						}}
					/>
					<Popover.Portal>
						<Popover.Positioner
							align="start"
							side="bottom"
							sideOffset={6}
							collisionPadding={8}
							className="z-50 outline-none"
						>
							<Popover.Popup className={FILL_PAINT_PANEL_CLASS}>
								<div className="space-y-1">
									<span className="block text-fg-muted text-ui">Paint</span>
									<div className="grid grid-cols-3 overflow-hidden rounded-md border border-white/10 bg-black/25">
										{FILL_PAINT_KIND_ROW.map((option) => {
											const selected = kind === option.value;
											return (
												<button
													key={option.value}
													type="button"
													aria-pressed={selected}
													disabled={disabled}
													onClick={() => commitKind(option.value)}
													className={cn(
														"grid h-6 min-w-0 place-items-center border-white/10 border-r text-fg-muted transition last:border-r-0 disabled:cursor-not-allowed disabled:opacity-45",
														selected
															? "bg-accent-surface text-accent-fg"
															: "hover:bg-white/[0.06] hover:text-white",
													)}
												>
													{option.label}
												</button>
											);
										})}
									</div>
									<button
										type="button"
										disabled={disabled || !current}
										title="Remove the reveal paint (the dissolve reveals the object's own fill/background instead)"
										onClick={() =>
											commitNoiseGradientRevealPaint(nodeIds, null)
										}
										className="flex w-full items-center justify-center gap-1.5 rounded-md border border-white/10 bg-black/25 px-2 py-1 text-fg-muted transition hover:bg-white/[0.08] hover:text-fg disabled:cursor-not-allowed disabled:opacity-45"
									>
										Clear
									</button>
								</div>
								{current?.kind === "linear-gradient" ||
								current?.kind === "radial-gradient" ? (
									<div className="space-y-1.5">
										<span className="block text-fg-muted text-ui">Stops</span>
										{current.stops.map((stop, index) => (
											<ColorPicker
												key={stop.id ?? `${index}:${stop.offset}`}
												value={stop.color}
												resetKey={`${resetKey}:reveal-paint:stop:${index}`}
												disabled={disabled}
												onChange={(hex) => {
													if (gestureKeyRef.current) {
														commitStopColor(index, hex, gestureKeyRef.current);
													}
												}}
												onCommit={(hex) => {
													commitStopColor(index, hex);
													return true;
												}}
												onGestureStart={() => {
													gestureSeqRef.current += 1;
													gestureKeyRef.current = `reveal-paint-stop:${resetKey}:${gestureSeqRef.current}`;
												}}
												onGestureEnd={() => {
													gestureKeyRef.current = null;
												}}
											/>
										))}
									</div>
								) : (
									<ColorPicker
										value={colorString}
										mixed={mixed}
										resetKey={`${resetKey}:reveal-paint:color`}
										disabled={disabled}
										onChange={(hex) => {
											if (gestureKeyRef.current) {
												commitNoiseGradientRevealPaint(
													nodeIds,
													{ kind: "solid", color: hex },
													gestureKeyRef.current,
												);
											}
										}}
										onCommit={(hex) => {
											commitNoiseGradientRevealPaint(nodeIds, {
												kind: "solid",
												color: hex,
											});
											return true;
										}}
										onGestureStart={() => {
											gestureSeqRef.current += 1;
											gestureKeyRef.current = `reveal-paint-color:${resetKey}:${gestureSeqRef.current}`;
										}}
										onGestureEnd={() => {
											gestureKeyRef.current = null;
										}}
									/>
								)}
							</Popover.Popup>
						</Popover.Positioner>
					</Popover.Portal>
				</Popover.Root>
				<span className="min-w-0 flex-1 truncate text-fg-secondary text-ui">
					{current ? fillKindLabel(kind, mixed) : "None"}
				</span>
			</div>
		</div>
	);
}

/** Percent scale between the 0–1 paint-opacity contract and the slider display. */
const OPACITY_PERCENT = 100;

/**
 * Paint opacity as a draggable percent slider — the "make it more transparent"
 * gesture is a drag with live canvas feedback, not typing a decimal into a 0–1
 * box. A drag opens one gesture transaction and coalesces every tick into a
 * single undo entry (the ScrubSlider contract); typing in the inline readout or
 * arrow-nudging commits discretely. Disabled (not hidden) when the role has no
 * primary paint to carry an opacity.
 */
function PaintOpacitySlider({
	paintRole,
	nodeIds,
	opacity,
	disabled,
}: {
	readonly paintRole: PrimaryPaintRole;
	readonly nodeIds: readonly string[];
	readonly opacity: MixedValue<number | null> | null;
	readonly disabled: boolean;
}) {
	const gestureRef = useRef<GestureTransaction | null>(null);
	const value =
		opacity === MIXED_VALUE
			? SCRUB_MIXED
			: Math.round((opacity ?? 1) * OPACITY_PERCENT);
	return (
		<ScrubSlider
			label="Opacity"
			value={value}
			min={0}
			max={OPACITY_PERCENT}
			neutral={OPACITY_PERCENT}
			step={1}
			unit="%"
			disabled={disabled || opacity === null}
			onScrubStart={() => {
				gestureRef.current = beginGestureTransaction(
					`inspector-opacity:${paintRole}:${nodeIds.join(",")}`,
					"Edit appearance",
				);
			}}
			onScrub={(next) =>
				commitPrimaryPaintOpacity(
					nodeIds,
					paintRole,
					next / OPACITY_PERCENT,
					gestureRef.current?.coalesceKey,
				)
			}
			onScrubEnd={() => {
				if (gestureRef.current) commitGestureTransaction(gestureRef.current);
				gestureRef.current = null;
			}}
			onCommitValue={(next) =>
				commitPrimaryPaintOpacity(nodeIds, paintRole, next / OPACITY_PERCENT)
			}
		/>
	);
}

function ImagePaintControls({
	paintRole,
	label,
	nodeIds,
	model,
	resetKey,
	disabled,
}: {
	readonly paintRole: PrimaryPaintRole;
	readonly label: string;
	readonly nodeIds: readonly string[];
	readonly model: ImagePaintEditModel | null;
	readonly resetKey: string;
	readonly disabled: boolean;
}) {
	if (!model) return null;
	const fitDisabled = disabled || !model.canEditFit;
	return (
		<div className="space-y-1 rounded-md border border-white/8 bg-black/15 p-1.5">
			<div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-1">
				<ReadoutRow
					label={`${label} image`}
					value={readoutText(model.source)}
				/>
				<SelectField
					label="Fit"
					value={model.fit}
					options={imageFitOptions}
					resetKey={`${resetKey}:${paintRole}:image-fit`}
					disabled={fitDisabled}
					onCommit={(value) => commitImagePaintFit(nodeIds, paintRole, value)}
				/>
			</div>
			{model.unavailableReason ? (
				<p className="px-0.5 text-fg-subtle text-ui">
					{model.unavailableReason}
				</p>
			) : null}
		</div>
	);
}

function MeshPaintControls({
	model,
	resetKey,
	disabled,
}: {
	readonly model: MeshPaintEditModel | null;
	readonly resetKey: string;
	readonly disabled: boolean;
}) {
	if (!model) return null;
	const point = model.selectedPoint;
	return (
		<div className="space-y-1 rounded-md border border-white/8 bg-black/15 p-1.5">
			<div className="grid grid-cols-2 gap-1">
				<ReadoutRow label="Mesh" value={`${model.rows}×${model.cols}`} />
				<ReadoutRow label="Points" value={String(model.pointCount)} />
			</div>
			{point ? (
				<div className="space-y-1">
					<ReadoutRow label="Point" value={`${point.row}, ${point.col}`} />
					<div className="grid grid-cols-2 gap-1">
						<ColorField
							label="Color"
							value={point.color}
							resetKey={`${resetKey}:mesh:${model.role}:${point.row}:${point.col}:color`}
							disabled={disabled}
							onCommit={(value) =>
								commitMeshPointColor(
									model.nodeId,
									model.role,
									point.row,
									point.col,
									value,
								)
							}
						/>
						{meshPointNumberFields.map(({ label, field, step }) => (
							<NumericField
								key={field}
								label={label}
								value={point[field]}
								resetKey={`${resetKey}:mesh:${model.role}:${point.row}:${point.col}:${field}`}
								step={step}
								disabled={disabled}
								onCommit={(value) =>
									commitMeshPointNumber(
										model.nodeId,
										model.role,
										point.row,
										point.col,
										field,
										value,
									)
								}
							/>
						))}
					</div>
					<button
						type="button"
						aria-label="Remove selected mesh point"
						title={
							model.canRemoveSelectedPoint
								? "Remove this point's mesh row and column"
								: "Corner points anchor the mesh edge and can't be removed"
						}
						disabled={disabled || !model.canRemoveSelectedPoint}
						onClick={() =>
							commitMeshRemovePoint(
								model.nodeId,
								model.role,
								point.row,
								point.col,
							)
						}
						className="flex w-full items-center justify-center gap-1 rounded-md border border-white/10 bg-black/25 px-2 py-1 text-fg-muted text-ui transition hover:text-warn-fg disabled:cursor-not-allowed disabled:opacity-45"
					>
						<Trash aria-hidden="true" size={11} />
						Remove point
					</button>
				</div>
			) : (
				<p className="px-0.5 text-fg-subtle text-ui">
					{model.unavailableReason}
				</p>
			)}
		</div>
	);
}

type ExpressionCodeButtonTarget =
	| {
			readonly kind: "native";
			readonly nodeId: string;
			readonly propertyId: NativeExpressionPropertyId;
	  }
	| {
			readonly kind: "effect";
			readonly capabilityId: string;
			readonly targetRef: EffectExpressionTargetRef;
	  };

const expressionCodeButtonCopy = (
	target: ExpressionCodeButtonTarget,
): {
	readonly expressionLabel: string;
	readonly placeholder: string;
} =>
	target.kind === "native"
		? {
				expressionLabel: "code expression",
				placeholder: "value + sin(time) * 24",
			}
		: {
				expressionLabel: "effect expression",
				placeholder: "value + sin(time) * 0.5",
			};

function ExpressionCodeButton({
	target,
	label,
	disabled = false,
}: {
	readonly target: ExpressionCodeButtonTarget;
	readonly label: string;
	readonly disabled?: boolean;
}) {
	const bindingSource = useSceneStore((state) => {
		if (target.kind === "native") {
			return (
				state.document.nativeExpressionBindings?.find(
					(candidate) =>
						candidate.nodeId === target.nodeId &&
						candidate.propertyId === target.propertyId,
				)?.expr.source ?? null
			);
		}
		return (
			effectExpressionBindingForCapability(
				state.document.effectExpressionBindings ?? [],
				target.targetRef,
				target.capabilityId,
			)?.expr.source ?? null
		);
	});
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState(bindingSource ?? "value");
	const [error, setError] = useState<string | null>(null);
	const active = bindingSource !== null;
	const { expressionLabel, placeholder } = expressionCodeButtonCopy(target);

	useEffect(() => {
		if (!open) return;
		setDraft(bindingSource ?? "value");
		setError(null);
	}, [bindingSource, open]);

	const clear = () => {
		if (target.kind === "native") {
			clearNativeExpression(target.propertyId, target.nodeId);
		} else if (target.targetRef.kind === "node") {
			clearNodeEffectExpression(target.capabilityId, target.targetRef.nodeId);
		} else {
			clearFrameEffectExpression(target.capabilityId, target.targetRef);
		}
		setError(null);
		setOpen(false);
	};

	const commit = () => {
		const source = draft.trim();
		if (source.length === 0) {
			clear();
			return;
		}
		if (target.kind === "native") {
			const plan = planNativeExpression(
				target.propertyId,
				target.nodeId,
				source,
			);
			if (plan.kind === "error") {
				setError(plan.error.message);
				return;
			}
			if (plan.kind === "unknown-property") {
				setError("This property cannot be coded.");
				return;
			}
			if (plan.kind === "ineligible-target") {
				setError("This property cannot be coded for this node.");
				return;
			}
			commitNativeExpression(plan);
		} else {
			const plan =
				target.targetRef.kind === "node"
					? planNodeEffectExpression(
							target.capabilityId,
							target.targetRef.nodeId,
							source,
						)
					: planFrameEffectExpression(
							target.capabilityId,
							target.targetRef,
							source,
						);
			if (plan.kind === "error") {
				setError(plan.error.message);
				return;
			}
			if (plan.kind === "unknown-capability") {
				setError("This effect control cannot be coded.");
				return;
			}
			if (target.targetRef.kind === "node") {
				commitNodeEffectExpression(plan);
			} else {
				commitFrameEffectExpression(plan);
			}
		}
		setError(null);
		setOpen(false);
	};

	const title = active
		? `Edit ${label} ${expressionLabel}`
		: `Bind ${label} to code`;

	return (
		<Popover.Root open={open} onOpenChange={setOpen} modal={false}>
			<Popover.Trigger
				type="button"
				aria-label={title}
				aria-pressed={active}
				title={title}
				disabled={disabled}
				className={cn(
					"grid size-6 place-items-center rounded-md border transition disabled:cursor-not-allowed disabled:opacity-45",
					active
						? "border-accent bg-accent-surface text-accent-fg"
						: "border-white/10 bg-black/20 text-fg-muted hover:border-white/20 hover:text-white",
				)}
			>
				<Code
					aria-hidden="true"
					size={11}
					weight={active ? "bold" : "regular"}
				/>
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Positioner
					align="end"
					side="bottom"
					sideOffset={6}
					collisionPadding={8}
					className="z-50 outline-none"
				>
					<Popover.Popup className="w-56 rounded-md border border-white/10 bg-surface-raised p-1.5 shadow-xl outline-none">
						<label className="block min-w-0">
							<span className="mb-0.5 block text-fg-muted text-ui">
								{label} expression
							</span>
							<input
								type="text"
								spellCheck={false}
								autoComplete="off"
								value={draft}
								placeholder={placeholder}
								onChange={(event) => {
									setDraft(event.currentTarget.value);
									setError(null);
								}}
								onKeyDown={(event) => {
									if (event.key === "Enter") {
										event.preventDefault();
										commit();
										return;
									}
									if (event.key === "Escape") {
										event.preventDefault();
										setOpen(false);
									}
								}}
								className="h-6 w-full rounded-md border border-white/10 bg-black/25 px-1.5 font-mono text-fg text-ui tabular-nums outline-none transition placeholder:text-fg-subtle focus:border-accent/70"
							/>
							{error ? (
								<span className="mt-0.5 block font-mono text-danger text-ui">
									{error}
								</span>
							) : null}
						</label>
						<div className="mt-1 flex items-center justify-end gap-1">
							<button
								type="button"
								aria-label={`Clear ${label} ${expressionLabel}`}
								title={`Clear ${label} ${expressionLabel}`}
								disabled={!active}
								onClick={clear}
								className="grid size-6 place-items-center rounded-md border border-white/10 bg-black/20 text-fg-muted transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
							>
								<Trash aria-hidden="true" size={11} />
							</button>
							<button
								type="button"
								aria-label={`Save ${label} ${expressionLabel}`}
								title={`Save ${label} ${expressionLabel}`}
								onClick={commit}
								className="grid size-6 place-items-center rounded-md border border-accent bg-accent-surface text-accent-fg transition hover:border-accent"
							>
								<Check aria-hidden="true" size={11} weight="bold" />
							</button>
						</div>
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}

function EffectCodeButton({
	capabilityId,
	targetRef,
	label,
	disabled,
}: {
	readonly capabilityId: string;
	readonly targetRef: EffectExpressionTargetRef;
	readonly label: string;
	readonly disabled: boolean;
}) {
	return (
		<ExpressionCodeButton
			target={{ kind: "effect", capabilityId, targetRef }}
			label={label}
			disabled={disabled}
		/>
	);
}

function NativeCodeButton({
	nodeId,
	propertyId,
	label,
}: {
	readonly nodeId: string;
	readonly propertyId: NativeExpressionPropertyId;
	readonly label: string;
}) {
	return (
		<ExpressionCodeButton
			target={{ kind: "native", nodeId, propertyId }}
			label={label}
		/>
	);
}

function RecipePathNumberControls({
	values,
	resetKey,
	disabled,
	expressionTargetRef,
	onCommit,
}: {
	readonly values: Readonly<Record<string, MixedValue<number> | null>>;
	readonly resetKey: string;
	readonly disabled: boolean;
	readonly expressionTargetRef: FrameEffectExpressionTargetRef;
	readonly onCommit: (path: string, value: number) => boolean;
}) {
	return (
		<div className="grid grid-cols-2 gap-1">
			{INSPECTOR_FRAME_RECIPE_CONTROLS.map((control) => {
				const capabilityId = frameRecipeCapabilityIdForPath(
					control.path,
					expressionTargetRef.kind,
				);
				return (
					<NumericField
						key={control.path}
						label={control.label}
						value={values[control.path] ?? null}
						resetKey={`${resetKey}:${control.path}`}
						step={String(control.step ?? 1)}
						disabled={disabled || control.kind !== "number"}
						action={
							capabilityId ? (
								<EffectCodeButton
									capabilityId={capabilityId}
									targetRef={expressionTargetRef}
									label={control.label}
									disabled={disabled || control.kind !== "number"}
								/>
							) : undefined
						}
						onCommit={(value) => onCommit(control.path, value)}
					/>
				);
			})}
		</div>
	);
}

function FrameInfluenceControls({
	scope,
	artboardId,
	resetKey,
	disabled,
	document,
	expressionTargetRef,
}: {
	readonly scope: FrameEffectRecipeScope;
	readonly artboardId: string;
	readonly resetKey: string;
	readonly disabled: boolean;
	readonly document: SceneDocument;
	readonly expressionTargetRef: FrameEffectExpressionTargetRef;
}) {
	const state = frameEffectInfluenceEditingState(document, scope, artboardId);
	const assignmentId = state.assignmentId;
	const hasAssignment = assignmentId !== null;
	const selectedMask =
		state.maskKind === "radialGradient" || state.maskKind === "linearGradient"
			? state.maskKind
			: null;
	const commitNumber = (
		field: FrameEffectInfluenceNumberField,
		value: number,
	): boolean =>
		assignmentId
			? commitFrameEffectInfluenceNumber(
					scope,
					assignmentId,
					field,
					value,
					artboardId,
				)
			: false;
	const expressionAction = (
		field: FrameEffectInfluenceNumberField,
	): ReactNode | undefined => {
		const capabilityId = frameInfluenceCapabilityIdForField(
			field,
			expressionTargetRef.kind,
		);
		return capabilityId ? (
			<EffectCodeButton
				capabilityId={capabilityId}
				targetRef={expressionTargetRef}
				label={field === "strength" ? "Strength" : "Feather"}
				disabled={disabled || !hasAssignment}
			/>
		) : undefined;
	};

	return (
		<div className="rounded-md border border-white/8 bg-black/15 p-1">
			<div className="mb-1 flex h-5 items-center justify-between gap-1 text-ui">
				<span className="text-fg-muted">Influence</span>
				{state.maskKind === "unsupported" ? (
					<span className="font-mono text-fg-subtle">Unsupported</span>
				) : null}
				<InspectorIconButton
					label="Remove influence"
					disabled={disabled || !hasAssignment}
					tone="danger"
					onClick={() => {
						if (assignmentId) {
							commitRemoveFrameEffectInfluenceMask(
								scope,
								assignmentId,
								artboardId,
							);
						}
					}}
				>
					<Trash aria-hidden="true" size={11} />
				</InspectorIconButton>
			</div>
			<div className="space-y-1">
				<SelectField
					label="Mask"
					value={selectedMask}
					options={frameInfluenceMaskOptions}
					resetKey={`${resetKey}:mask:${state.resetKey}`}
					disabled={disabled}
					onCommit={(value) =>
						commitFrameEffectInfluenceMaskKind(scope, value, artboardId)
					}
				/>
				<div className="grid grid-cols-2 gap-1">
					<NumericField
						label="Strength"
						value={state.values.strength}
						resetKey={`${resetKey}:strength:${state.resetKey}`}
						step="0.05"
						disabled={disabled || !hasAssignment}
						action={expressionAction("strength")}
						onCommit={(value) => commitNumber("strength", value)}
					/>
					<NumericField
						label="Feather"
						value={state.values.featherRadius}
						resetKey={`${resetKey}:feather:${state.resetKey}`}
						step="0.01"
						disabled={disabled || !hasAssignment}
						action={expressionAction("featherRadius")}
						onCommit={(value) => commitNumber("featherRadius", value)}
					/>
					{state.maskKind === "radialGradient" ? (
						<>
							<NumericField
								label="Center X"
								value={state.values.cx}
								resetKey={`${resetKey}:cx:${state.resetKey}`}
								step="0.05"
								disabled={disabled}
								onCommit={(value) => commitNumber("cx", value)}
							/>
							<NumericField
								label="Center Y"
								value={state.values.cy}
								resetKey={`${resetKey}:cy:${state.resetKey}`}
								step="0.05"
								disabled={disabled}
								onCommit={(value) => commitNumber("cy", value)}
							/>
							<NumericField
								label="Radius"
								value={state.values.radius}
								resetKey={`${resetKey}:radius:${state.resetKey}`}
								step="0.05"
								disabled={disabled}
								onCommit={(value) => commitNumber("radius", value)}
							/>
						</>
					) : null}
					{state.maskKind === "linearGradient" ? (
						<>
							<NumericField
								label="X1"
								value={state.values.x1}
								resetKey={`${resetKey}:x1:${state.resetKey}`}
								step="0.05"
								disabled={disabled}
								onCommit={(value) => commitNumber("x1", value)}
							/>
							<NumericField
								label="Y1"
								value={state.values.y1}
								resetKey={`${resetKey}:y1:${state.resetKey}`}
								step="0.05"
								disabled={disabled}
								onCommit={(value) => commitNumber("y1", value)}
							/>
							<NumericField
								label="X2"
								value={state.values.x2}
								resetKey={`${resetKey}:x2:${state.resetKey}`}
								step="0.05"
								disabled={disabled}
								onCommit={(value) => commitNumber("x2", value)}
							/>
							<NumericField
								label="Y2"
								value={state.values.y2}
								resetKey={`${resetKey}:y2:${state.resetKey}`}
								step="0.05"
								disabled={disabled}
								onCommit={(value) => commitNumber("y2", value)}
							/>
						</>
					) : null}
				</div>
			</div>
		</div>
	);
}

function FrameEffectStackControls({
	scope,
	artboardId,
	resetKey,
	disabled,
	document,
}: {
	readonly scope: FrameEffectRecipeScope;
	readonly artboardId: string;
	readonly resetKey: string;
	readonly disabled: boolean;
	readonly document: SceneDocument;
}) {
	const state = frameEffectLayerStackEditingState(document, scope, artboardId);
	if (state.layers.length === 0) return null;
	const commitLayerUpdate = (
		layer: EffectLayer,
		patch: EffectLayerPatch,
	): boolean =>
		commitFrameEffectLayerStackOperation(
			scope,
			{ kind: "update", layerId: layer.id, patch },
			artboardId,
		);

	return (
		<div className="rounded-md border border-white/8 bg-black/15 p-1">
			<div className="mb-1 flex h-5 items-center justify-between gap-1 text-ui">
				<span className="text-fg-muted">Effect Stack</span>
				<span className="font-mono text-fg-subtle">{state.layers.length}</span>
			</div>
			<div className="space-y-1">
				{state.layers.map((layer, index) => {
					const adaptation = layer.adaptation?.source ?? "none";
					return (
						<div
							key={layer.id}
							className="rounded-md border border-white/8 bg-white/[0.03] p-1"
						>
							<div className="mb-1 flex h-6 items-center gap-1">
								<InspectorIconButton
									label={layer.enabled ? "Disable layer" : "Enable layer"}
									disabled={disabled}
									onClick={() =>
										commitLayerUpdate(layer, { enabled: !layer.enabled })
									}
								>
									{layer.enabled ? (
										<Eye aria-hidden="true" size={11} />
									) : (
										<EyeSlash aria-hidden="true" size={11} />
									)}
								</InspectorIconButton>
								<span className="min-w-0 flex-1 truncate text-ui text-fg">
									{layer.label}
								</span>
								<InspectorIconButton
									label="Move layer up"
									disabled={disabled || index === 0}
									onClick={() =>
										commitFrameEffectLayerStackOperation(
											scope,
											{
												kind: "reorder",
												layerId: layer.id,
												toIndex: index - 1,
											},
											artboardId,
										)
									}
								>
									<CaretUp aria-hidden="true" size={11} />
								</InspectorIconButton>
								<InspectorIconButton
									label="Move layer down"
									disabled={disabled || index >= state.layers.length - 1}
									onClick={() =>
										commitFrameEffectLayerStackOperation(
											scope,
											{
												kind: "reorder",
												layerId: layer.id,
												toIndex: index + 1,
											},
											artboardId,
										)
									}
								>
									<CaretDown aria-hidden="true" size={11} />
								</InspectorIconButton>
							</div>
							<div className="grid grid-cols-2 gap-1">
								<SelectField
									label="Blend"
									value={layer.blendMode}
									options={blendModeOptions}
									resetKey={`${resetKey}:stack:${state.resetKey}:${layer.id}:blend`}
									disabled={disabled || !layer.enabled}
									onCommit={(value) =>
										commitLayerUpdate(layer, {
											blendMode: value as BlendMode,
										})
									}
								/>
								<NumericField
									label="Mix"
									value={layer.mix}
									resetKey={`${resetKey}:stack:${state.resetKey}:${layer.id}:mix`}
									step="0.05"
									disabled={disabled || !layer.enabled}
									onCommit={(value) =>
										commitLayerUpdate(layer, {
											mix: Math.min(1, Math.max(0, value)),
										})
									}
								/>
								<SelectField
									label="Applies"
									value={adaptation}
									options={effectLayerAdaptationOptions}
									resetKey={`${resetKey}:stack:${state.resetKey}:${layer.id}:adaptation`}
									disabled={disabled || !layer.enabled}
									onCommit={(value) =>
										commitLayerUpdate(layer, {
											adaptation:
												value === "none"
													? { source: "none" }
													: { source: value, strength: 1 },
										})
									}
								/>
								<ReadoutRow label="Kind" value={titleFromToken(layer.kind)} />
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}

function LookGraphSlider({
	scope,
	artboardId,
	nodeId,
	control,
	disabled,
}: {
	readonly scope: FrameEffectRecipeScope;
	readonly artboardId: string;
	readonly nodeId: string;
	readonly control: FrameLookGraphNodeSliderSpec;
	readonly disabled: boolean;
}) {
	const gestureRef = useRef<FrameLookGraphNodeNumberGesture | null>(null);
	const motion = useMotionStore((state) => state.document);
	const currentFrame = useTransportStore((state) => state.currentFrame);
	const recording = useTransportStore((state) => state.recording);
	const frame = Math.round(currentFrame);
	const keyframeContext = { recording, frame };
	const owner = lookGraphOwnerForScope(scope, artboardId);
	// Show the keyframed value at the playhead when the param is animated, so the
	// slider tracks the timeline and a recorded edit starts from the right value.
	const value = lookNodeParamDisplayValue(
		motion,
		owner,
		nodeId,
		bareLookNodeParamKey(control.path),
		control.value,
		frame,
	);
	const keyframeState = lookNodeParamKeyframeState(
		motion,
		owner,
		nodeId,
		control.path,
		frame,
	);
	return (
		<ScrubSlider
			label={control.label}
			value={value}
			min={control.min}
			max={control.max}
			neutral={control.neutral}
			step={control.step}
			bipolar={control.kind === "bipolar"}
			unit={control.unit}
			disabled={disabled}
			action={
				keyframeState.animatable ? (
					<KeyframeDiamond
						keyed={keyframeState.hasKeyAtFrame}
						animated={keyframeState.animated}
						disabled={disabled}
						label={control.label}
						onToggle={() =>
							toggleLookNodeParamKeyframe(
								owner,
								nodeId,
								control.path,
								frame,
								value,
							)
						}
					/>
				) : undefined
			}
			onScrubStart={() => {
				gestureRef.current = beginFrameLookGraphNodeNumberGesture(
					scope,
					nodeId,
					control.path,
					artboardId,
					keyframeContext,
				);
			}}
			onScrub={(next) => gestureRef.current?.update(next)}
			onScrubEnd={() => {
				gestureRef.current?.commit();
				gestureRef.current = null;
			}}
			onCommitValue={(next) =>
				commitFrameLookGraphNodeNumber(
					scope,
					nodeId,
					control.path,
					next,
					artboardId,
					keyframeContext,
				)
			}
		/>
	);
}

function LookGraphNodeRow({
	scope,
	artboardId,
	node,
	selected,
	disabled,
	onSelect,
}: {
	readonly scope: FrameEffectRecipeScope;
	readonly artboardId: string;
	readonly node: FrameLookGraphEditingNode;
	readonly selected: boolean;
	readonly disabled: boolean;
	readonly onSelect: () => void;
}) {
	return (
		<div
			className={cn(
				"grid grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] items-center gap-1 rounded-md border p-1",
				selected
					? "border-accent/45 bg-accent-surface/45"
					: "border-white/8 bg-white/[0.03]",
			)}
		>
			<button
				type="button"
				aria-pressed={selected}
				disabled={disabled}
				onClick={onSelect}
				className="min-w-0 truncate text-left text-fg text-ui disabled:cursor-not-allowed disabled:opacity-55"
			>
				{node.label}
			</button>
			<InspectorIconButton
				label={node.enabled ? "Disable node" : "Enable node"}
				disabled={disabled}
				onClick={() =>
					commitToggleFrameLookGraphNode(
						scope,
						node.id,
						!node.enabled,
						artboardId,
					)
				}
			>
				{node.enabled ? (
					<Eye aria-hidden="true" size={11} />
				) : (
					<EyeSlash aria-hidden="true" size={11} />
				)}
			</InspectorIconButton>
			<InspectorIconButton
				label="Move node up"
				disabled={disabled || !node.canMoveUp}
				onClick={() =>
					commitReorderFrameLookGraphNode(scope, node.id, "up", artboardId)
				}
			>
				<CaretUp aria-hidden="true" size={11} />
			</InspectorIconButton>
			<InspectorIconButton
				label="Move node down"
				disabled={disabled || !node.canMoveDown}
				onClick={() =>
					commitReorderFrameLookGraphNode(scope, node.id, "down", artboardId)
				}
			>
				<CaretDown aria-hidden="true" size={11} />
			</InspectorIconButton>
			<InspectorIconButton
				label="Remove node"
				disabled={disabled}
				tone="danger"
				onClick={() =>
					commitRemoveFrameLookGraphNode(scope, node.id, artboardId)
				}
			>
				<Trash aria-hidden="true" size={11} />
			</InspectorIconButton>
		</div>
	);
}

function LookGraphNodePayloadControls({
	scope,
	artboardId,
	node,
	masked,
	disabled,
	resetKey,
}: {
	readonly scope: FrameEffectRecipeScope;
	readonly artboardId: string;
	readonly node: LookGraphNode;
	readonly masked: boolean;
	readonly disabled: boolean;
	readonly resetKey: string;
}) {
	const motion = useMotionStore((state) => state.document);
	const owner = lookGraphOwnerForScope(scope, artboardId);
	const radiusYAnimated =
		node.payload.kind === "blur" &&
		isLookNodeParamAnimated(motion, owner, node.id, "radiusY");
	if (node.payload.kind === "path-blur") {
		const centered = node.payload.centeredBlur;
		return (
			<div className="pt-1">
				<label className="flex h-5 min-w-0 items-center gap-1 text-fg-muted text-ui">
					<input
						type="checkbox"
						checked={centered}
						disabled={disabled}
						onChange={(event) =>
							commitFrameLookGraphNodeField(
								scope,
								node.id,
								{
									path: "path-blur.centeredBlur",
									value: event.currentTarget.checked,
								},
								artboardId,
							)
						}
						className="size-3 accent-accent disabled:cursor-not-allowed disabled:opacity-45"
					/>
					<span>Centered</span>
				</label>
			</div>
		);
	}
	if (node.payload.kind === "blur") {
		const linked = node.payload.radiusY === undefined && !radiusYAnimated;
		const radius = node.payload.radius;
		return (
			<div className="space-y-0.5 pt-1">
				<label className="flex h-5 min-w-0 items-center gap-1 text-fg-muted text-ui">
					<input
						type="checkbox"
						checked={linked}
						disabled={disabled}
						onChange={(event) =>
							commitFrameLookGraphNodeField(
								scope,
								node.id,
								{
									path: "blur.radiusY",
									value: event.currentTarget.checked ? null : radius,
								},
								artboardId,
							)
						}
						className="size-3 accent-accent disabled:cursor-not-allowed disabled:opacity-45"
					/>
					<span>Link X / Y</span>
				</label>
				{radiusYAnimated ? (
					<span className="block text-ui text-warn-fg">
						Relinking removes Y animation
					</span>
				) : null}
			</div>
		);
	}
	if (node.payload.kind !== "grain") return null;
	const particle = frameLookGraphNodeIsParticleTexture(node);
	const mode = frameLookGraphTextureModeForNode(node);
	const direction = frameLookGraphParticleDirectionValue(node.payload.texture);
	const directionOptions =
		direction === "custom"
			? FRAME_LOOK_GRAPH_PARTICLE_DIRECTION_OPTIONS
			: FRAME_LOOK_GRAPH_PARTICLE_DIRECTION_OPTIONS.filter(
					(option) => option.value !== "custom",
				);
	return (
		<div className="grid grid-cols-2 gap-1 pt-1">
			<SelectField
				label="Mode"
				value={mode}
				options={FRAME_LOOK_GRAPH_TEXTURE_MODE_OPTIONS}
				resetKey={`${resetKey}:${node.id}:mode`}
				disabled={disabled}
				onCommit={(value) =>
					commitFrameLookGraphNodeField(
						scope,
						node.id,
						{ path: "grain.mode", value },
						artboardId,
					)
				}
			/>
			{particle ? (
				<>
					<SelectField
						label="Field"
						value={direction}
						options={directionOptions}
						resetKey={`${resetKey}:${node.id}:direction`}
						disabled={disabled}
						onCommit={(value) => {
							if (value === "custom") return false;
							return commitFrameLookGraphNodeField(
								scope,
								node.id,
								{
									path: "grain.angle",
									value:
										value === "edge"
											? null
											: value === "mesh"
												? "mesh"
												: Number(value),
								},
								artboardId,
							);
						}}
					/>
					<div className="col-span-2 rounded-md border border-white/8 bg-black/15 px-1.5 py-1 text-fg-subtle text-ui">
						{masked ? "Masked frame pixels" : "Frame pixels"}
					</div>
				</>
			) : null}
		</div>
	);
}

function LookGraphSection({
	scope,
	artboardId,
	resetKey,
	disabled,
	state,
}: {
	readonly scope: FrameEffectRecipeScope;
	readonly artboardId: string;
	readonly resetKey: string;
	readonly disabled: boolean;
	readonly state: ReturnType<typeof frameLookGraphEditingState>;
}) {
	const selectionOwnerKey = lookGraphTargetKey(state.target);
	const selectedNodeId = useLookGraphSelectionStore((selection) =>
		selection.selectedOwnerKey === selectionOwnerKey
			? selection.selectedNodeId
			: null,
	);
	const setSelectedNodeForOwner = useLookGraphSelectionStore(
		(selection) => selection.setSelectedNodeForOwner,
	);
	const inspectorNodes = useMemo(
		() =>
			state.nodes.filter((node) =>
				(FRAME_LOOK_GRAPH_AUTHORABLE_NODE_KINDS as readonly string[]).includes(
					node.kind,
				),
			),
		[state.nodes],
	);
	useEffect(() => {
		if (inspectorNodes.length === 0) {
			if (selectedNodeId !== null) {
				setSelectedNodeForOwner(selectionOwnerKey, null);
			}
			return;
		}
		if (
			selectedNodeId === null ||
			!inspectorNodes.some((node) => node.id === selectedNodeId)
		) {
			setSelectedNodeForOwner(selectionOwnerKey, inspectorNodes[0]?.id ?? null);
		}
	}, [
		selectedNodeId,
		selectionOwnerKey,
		setSelectedNodeForOwner,
		inspectorNodes,
	]);

	const selectedNode =
		inspectorNodes.find((node) => node.id === selectedNodeId) ?? null;
	const selectedGraphNode =
		state.graph?.nodes.find((node) => node.id === selectedNodeId) ?? null;
	const selectedNodeReceivesRenderableMask =
		state.graph && selectedNodeId
			? frameLookGraphNodeReceivesRenderableMask(state.graph, selectedNodeId)
			: false;
	const graphControlsDisabled = disabled || !state.graphActive;
	const status = state.graphActive
		? state.targetStoresGraph
			? "Graph"
			: "Inherited"
		: state.graphPresent
			? "Projected"
			: "Empty";

	return (
		<div className="rounded-md border border-white/8 bg-black/15 p-1">
			<div className="mb-1 flex h-5 items-center justify-between gap-1 text-ui">
				<span className="text-fg-muted">Look Graph</span>
				<div className="flex items-center gap-1">
					<span className="font-mono text-fg-subtle">{status}</span>
					{state.graphActive ? null : (
						<button
							type="button"
							disabled={disabled}
							onClick={() => commitMaterializeFrameLookGraph(scope, artboardId)}
							className="flex h-5 items-center gap-1 rounded-md border border-white/10 bg-black/20 px-1.5 text-fg-muted transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
						>
							<PencilSimple aria-hidden="true" size={10} />
							<span>Edit</span>
						</button>
					)}
				</div>
			</div>
			<div className="mb-1 grid grid-cols-3 gap-1">
				{FRAME_LOOK_GRAPH_AUTHORABLE_NODE_KINDS.map((kind) => (
					<button
						key={kind}
						type="button"
						disabled={disabled}
						title={`Add ${FRAME_LOOK_GRAPH_NODE_KIND_LABELS[kind]} node`}
						onClick={() =>
							commitInsertFrameLookGraphNode(scope, kind, artboardId, {
								insertAfterNodeId: selectedNodeId,
							})
						}
						className="flex h-6 min-w-0 items-center justify-center gap-1 rounded-md border border-white/10 bg-black/20 px-1 text-fg-muted text-ui transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
					>
						<Plus aria-hidden="true" size={10} />
						<span className="truncate">
							{FRAME_LOOK_GRAPH_NODE_KIND_LABELS[kind]}
						</span>
					</button>
				))}
				<button
					type="button"
					disabled={disabled}
					title="Add Particle Dissolve node"
					onClick={() =>
						commitInsertParticleDissolveNode(scope, artboardId, {
							insertAfterNodeId: selectedNodeId,
						})
					}
					className="flex h-6 min-w-0 items-center justify-center gap-1 rounded-md border border-white/10 bg-black/20 px-1 text-fg-muted text-ui transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
				>
					<Plus aria-hidden="true" size={10} />
					<span className="truncate">Particle Dissolve</span>
				</button>
			</div>
			{state.graphActive ? (
				<div className="space-y-1" data-look-graph-section={resetKey}>
					{inspectorNodes.length > 0 ? (
						inspectorNodes.map((node) => (
							<LookGraphNodeRow
								key={node.id}
								scope={scope}
								artboardId={artboardId}
								node={node}
								selected={node.id === selectedNodeId}
								disabled={graphControlsDisabled}
								onSelect={() =>
									setSelectedNodeForOwner(selectionOwnerKey, node.id)
								}
							/>
						))
					) : (
						<div className="rounded-md border border-white/8 bg-white/[0.03] px-2 py-1 text-fg-subtle text-ui">
							No effect nodes
						</div>
					)}
					{selectedNode ? (
						<div className="grid grid-cols-1 gap-1 pt-1">
							{selectedGraphNode ? (
								<LookGraphNodePayloadControls
									scope={scope}
									artboardId={artboardId}
									node={selectedGraphNode}
									masked={selectedNodeReceivesRenderableMask}
									disabled={graphControlsDisabled || !selectedNode.enabled}
									resetKey={resetKey}
								/>
							) : null}
							{selectedNode.sliders.map((control) => (
								<LookGraphSlider
									key={`${selectedNode.id}:${control.path}`}
									scope={scope}
									artboardId={artboardId}
									nodeId={selectedNode.id}
									control={control}
									disabled={graphControlsDisabled || !selectedNode.enabled}
								/>
							))}
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}

function FrameLookControls({
	document,
	artboardId,
	resetKey,
	disabled,
}: {
	readonly document: SceneDocument;
	readonly artboardId: string;
	readonly resetKey: string;
	readonly disabled: boolean;
}) {
	const [scope, setScope] =
		useState<FrameEffectRecipeScope>("current-artboard");
	const recipeValues = frameRecipeEditingValues(document, scope, artboardId);
	const scopeResetKey = `${resetKey}:frame-look:${scope}`;
	const expressionTargetRef = frameExpressionTargetRef(scope, artboardId);
	const lookGraphState = frameLookGraphEditingState(
		document,
		scope,
		artboardId,
	);
	const frameLookCanRemove = canRemoveAnalogFilmFrameLook(
		document,
		scope,
		artboardId,
	);

	return (
		<PanelSection
			title="Frame Look"
			icon={<Gear aria-hidden="true" size={12} />}
		>
			<div className="space-y-1">
				<SelectField
					label="Scope"
					value={scope}
					options={frameLookScopeOptions}
					resetKey={`${scopeResetKey}:scope`}
					disabled={disabled}
					onCommit={(value) => {
						setScope(value);
						return true;
					}}
				/>
				<LookGraphSection
					scope={scope}
					artboardId={artboardId}
					resetKey={scopeResetKey}
					disabled={disabled}
					state={lookGraphState}
				/>
				{lookGraphState.graphActive ? null : (
					<>
						<button
							type="button"
							disabled={disabled}
							onClick={() => commitAnalogFilmFrameLook(scope, artboardId)}
							title="Apply the Analog Film treatment — fine grain plus a cyan/orange chromatic-aberration edge — to this frame. Reproduces the film look only; it does not recolor objects to dark fills."
							className="flex w-full flex-col gap-0.5 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-left text-ui text-fg-muted transition hover:bg-white/10 hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"
						>
							<span className="text-fg">{ANALOG_FILM_LOOK_LABEL}</span>
							<span className="text-fg-subtle">
								Grain + chromatic-edge film look
							</span>
						</button>
						<button
							type="button"
							disabled={disabled || !frameLookCanRemove}
							onClick={() => commitRemoveAnalogFilmFrameLook(scope, artboardId)}
							title={
								frameLookCanRemove
									? "Remove the current frame Analog Film look for this scope."
									: "No frame Analog Film look is applied for this scope."
							}
							className="flex h-6 w-full items-center justify-center rounded-md border border-white/10 bg-black/10 px-2 text-ui text-fg-muted transition hover:bg-white/10 hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"
						>
							Remove frame look
						</button>
						<RecipePathNumberControls
							values={recipeValues}
							resetKey={scopeResetKey}
							disabled={disabled}
							expressionTargetRef={expressionTargetRef}
							onCommit={(path, value) =>
								commitFrameRecipeNumber(scope, path, value, artboardId)
							}
						/>
						<FrameEffectStackControls
							scope={scope}
							artboardId={artboardId}
							resetKey={scopeResetKey}
							disabled={disabled}
							document={document}
						/>
						<FrameInfluenceControls
							scope={scope}
							artboardId={artboardId}
							resetKey={scopeResetKey}
							disabled={disabled}
							document={document}
							expressionTargetRef={expressionTargetRef}
						/>
						<FrameEffectCodeControls
							scope={scope}
							artboardId={artboardId}
							disabled={disabled}
						/>
					</>
				)}
			</div>
		</PanelSection>
	);
}

type LookGroup = "Color" | "Texture" | "Light" | "Optics";

type LookSliderSpec = {
	readonly field: RecipeNumberField;
	readonly label: string;
	readonly group: LookGroup;
	readonly kind: "unipolar" | "bipolar" | "multiplier";
	readonly min: number;
	readonly max: number;
	readonly neutral: number;
	readonly step: number;
	readonly unit?: string;
};

/**
 * The eight surfaced vec-core scalars as drag sliders, in displayed units (the
 * legacy↔canonical conversion lives in the editing model). Ranges and neutrals are
 * intentional: bipolar Exposure rests at 0, the Saturate/Contrast multipliers rest
 * at 1.0, and the legacy-scaled Noise/Glow r have non-zero rest points (1.0× / 35px)
 * because their canonical-zero is a degenerate kernel. Noise's min is a small
 * epsilon, not 0, since the model rejects a non-positive grain size.
 */
const LOOK_SLIDERS: readonly LookSliderSpec[] = [
	{
		field: "exposure",
		label: "Exposure",
		group: "Color",
		kind: "bipolar",
		min: -4,
		max: 4,
		neutral: 0,
		step: 0.05,
	},
	{
		field: "contrast",
		label: "Contrast",
		group: "Color",
		kind: "multiplier",
		min: 0,
		max: 4,
		neutral: 1,
		step: 0.01,
		unit: "×",
	},
	{
		field: "saturation",
		label: "Saturate",
		group: "Color",
		kind: "multiplier",
		min: 0,
		max: 4,
		neutral: 1,
		step: 0.01,
		unit: "×",
	},
	{
		field: "grain",
		label: "Grain",
		group: "Texture",
		kind: "unipolar",
		min: 0,
		max: 1,
		neutral: 0,
		step: 0.01,
	},
	{
		field: "noiseScale",
		label: "Noise",
		group: "Texture",
		kind: "unipolar",
		min: 0.05,
		max: 3.33,
		neutral: 1,
		step: 0.05,
		unit: "×",
	},
	{
		field: "glowBloom",
		label: "Glow",
		group: "Light",
		kind: "unipolar",
		min: 0,
		max: 1,
		neutral: 0,
		step: 0.01,
	},
	{
		field: "glowRadius",
		label: "Glow r",
		group: "Light",
		kind: "unipolar",
		min: 0,
		max: 100,
		neutral: 35,
		step: 1,
		unit: "px",
	},
	{
		field: "rgbSplit",
		label: "RGB split",
		group: "Optics",
		kind: "unipolar",
		min: 0,
		max: 10,
		neutral: 0,
		step: 0.1,
	},
];

const LOOK_GROUP_ORDER: readonly LookGroup[] = [
	"Color",
	"Texture",
	"Light",
	"Optics",
];

/**
 * Representative CSS swatch per look preset (preset DATA, like scene paint — not a
 * chrome token, so the inline literal colors are exempt from the token gate). Aura
 * mirrors its aura-fill stops; the rest evoke their grade (warm bloom, muted film,
 * washed fade, high-contrast noir).
 */
/**
 * Inspector adapter binding one {@link ScrubSlider} to the recipe command bus: a
 * drag opens a single coalesced gesture (one undo entry), while reset / keyboard /
 * typed edits route through the per-call {@link commitRecipeNumber}. A null value
 * (empty selection) is coerced to neutral and the slider is disabled, so the
 * primitive never receives null.
 */
function LookSlider({
	control,
	value,
	nodeIds,
	disabled,
}: {
	readonly control: LookSliderSpec;
	readonly value: MixedValue<number> | null;
	readonly nodeIds: readonly string[];
	readonly disabled: boolean;
}) {
	const gestureRef = useRef<RecipeNumberGesture | null>(null);
	const sliderValue =
		value === MIXED_VALUE ? SCRUB_MIXED : (value ?? control.neutral);
	const nodeId = nodeIds.length === 1 ? nodeIds[0] : null;
	const capabilityId = nodeId
		? nodeRecipeCapabilityIdForField(control.field)
		: null;
	return (
		<ScrubSlider
			label={control.label}
			value={sliderValue}
			min={control.min}
			max={control.max}
			neutral={control.neutral}
			step={control.step}
			bipolar={control.kind === "bipolar"}
			unit={control.unit}
			disabled={disabled || value === null}
			action={
				nodeId && capabilityId ? (
					<EffectCodeButton
						capabilityId={capabilityId}
						targetRef={{ kind: "node", nodeId }}
						label={control.label}
						disabled={disabled || value === null}
					/>
				) : undefined
			}
			onScrubStart={() => {
				gestureRef.current = beginRecipeNumberGesture(nodeIds, control.field);
			}}
			onScrub={(next) => gestureRef.current?.update(next)}
			onScrubEnd={() => {
				gestureRef.current?.commit();
				gestureRef.current = null;
			}}
			onCommitValue={(next) => {
				commitRecipeNumber(nodeIds, control.field, next);
			}}
		/>
	);
}

function AppearanceControls({
	document,
	nodes,
	resetKey,
	showFill,
	extraControls,
}: {
	readonly document: SceneDocument;
	readonly nodes: readonly VectorNode[];
	readonly resetKey: string;
	readonly showFill: boolean;
	readonly extraControls?: ReactNode;
}) {
	const subSelection = useSelectionStore((selection) => selection.sub);
	const meshSubSelection =
		subSelection?.kind === "mesh-node" ? subSelection : null;
	const state = appearanceEditingStateForSelection(nodes, meshSubSelection);
	const { values, nodeIds, paintNodeIds, canEdit } = state;
	const fillSharedColorState = primaryPaintSharedColorState(
		document,
		paintNodeIds,
		"fills",
	);
	const strokeSharedColorState = primaryPaintSharedColorState(
		document,
		paintNodeIds,
		"strokes",
	);
	const shadowFieldsDisabled = !canEdit || values.dropShadowEnabled !== true;
	const innerShadowFieldsDisabled =
		!canEdit || values.innerShadowEnabled !== true;
	const layerBlurFieldsDisabled = !canEdit || values.layerBlurEnabled !== true;
	const recipeValues = recipeEditingValuesForSelection(nodes);
	const maskFeather =
		nodes.length === 1 ? maskFeatherEditingStateForNode(nodes[0]) : null;
	const maskSource = maskFeather
		? findNode(document, maskFeather.maskNodeId)
		: undefined;
	const maskSourceStyle = maskSource
		? resolveNodeStyle(maskSource.style)
		: undefined;
	const luminanceMatteSupported =
		maskSourceStyle?.fills.length === 1 &&
		maskSourceStyle.fills[0]?.kind === "solid";
	const analogFilmNodeLookState = analogFilmNodeLookStateForSelection(
		document,
		nodeIds,
	);
	const analogFilmAppliedToSelection =
		analogFilmNodeLookState.status !== "none";
	const analogFilmPressed =
		analogFilmNodeLookState.status === "partial"
			? "mixed"
			: analogFilmNodeLookState.status === "all";
	const analogFilmScopeLabel =
		analogFilmNodeLookState.status === "all"
			? "Selection overlay · on"
			: analogFilmNodeLookState.status === "partial"
				? "Selection overlay · partial"
				: "Selection overlay";
	const noiseGradientNodeLookState = noiseGradientNodeLookStateForSelection(
		document,
		nodeIds,
	);
	const noiseGradientFrameGraphState = noiseGradientFrameGraphStateForSelection(
		document,
		nodeIds,
	);
	const noiseGradientUsesFrameGraph =
		noiseGradientFrameGraphState.status === "all";
	const noiseGradientReadsFrameGraph =
		noiseGradientFrameGraphState.status !== "none";
	const noiseGradientScopeMixed =
		noiseGradientFrameGraphState.status === "partial";
	const noiseGradientActiveStatus = noiseGradientUsesFrameGraph
		? noiseGradientFrameGraphState.status
		: noiseGradientScopeMixed
			? "partial"
			: noiseGradientNodeLookState.status;
	const noiseGradientApplied = noiseGradientActiveStatus !== "none";
	const noiseGradientScopeLabel = noiseGradientReadsFrameGraph
		? noiseGradientFrameGraphState.status === "all"
			? "Scoped effect · on"
			: "Scoped effect · partial"
		: noiseGradientNodeLookState.status === "all"
			? "Object material · on"
			: noiseGradientNodeLookState.status === "partial"
				? "Object material · partial"
				: "Object material";
	const noiseGradientValues = noiseGradientReadsFrameGraph
		? noiseGradientFrameGraphValuesForSelection(document, nodeIds)
		: noiseGradientNodeValuesForSelection(nodes);
	const noiseGradientMatteValues = noiseGradientReadsFrameGraph
		? noiseGradientFrameGraphMatteValuesForSelection(document, nodeIds)
		: noiseGradientNodeMatteValuesForSelection(nodes);
	const noiseGradientDirection = noiseGradientReadsFrameGraph
		? noiseGradientFrameGraphDirectionForSelection(document, nodeIds)
		: noiseGradientNodeDirectionForSelection(nodes);
	const noiseGradientBlendMode = noiseGradientReadsFrameGraph
		? noiseGradientFrameGraphBlendModeForSelection(document, nodeIds)
		: noiseGradientNodeBlendModeForSelection(nodes);
	const noiseGradientAngle = noiseGradientReadsFrameGraph
		? noiseGradientFrameGraphAngleForSelection(document, nodeIds)
		: noiseGradientNodeAngleForSelection(nodes);
	const noiseGradientLinearFieldValues = noiseGradientReadsFrameGraph
		? noiseGradientFrameGraphLinearFieldValuesForSelection(document, nodeIds)
		: noiseGradientNodeLinearFieldValuesForSelection(nodes);
	const noiseGradientEditDisabled = !canEdit || noiseGradientScopeMixed;
	const noiseGradientStyle = noiseGradientReadsFrameGraph
		? noiseGradientFrameGraphStyleForSelection(document, nodeIds)
		: noiseGradientNodeStyleForSelection(nodes);
	const noiseGradientOverlayColor = noiseGradientReadsFrameGraph
		? noiseGradientFrameGraphOverlayColorForSelection(document, nodeIds)
		: noiseGradientNodeOverlayColorForSelection(nodes);
	const noiseGradientMaterialModeIsMixed = noiseGradientReadsFrameGraph
		? noiseGradientFrameGraphMaterialModeIsMixedForSelection(document, nodeIds)
		: noiseGradientNodeMaterialModeIsMixedForSelection(nodes);
	const noiseGradientGrainStrength = noiseGradientReadsFrameGraph
		? noiseGradientFrameGraphGrainStrengthForSelection(document, nodeIds)
		: noiseGradientNodeGrainStrengthForSelection(nodes);
	const noiseGradientCoverage = noiseGradientReadsFrameGraph
		? noiseGradientFrameGraphCoverageForSelection(document, nodeIds)
		: noiseGradientNodeCoverageForSelection(nodes);
	const noiseGradientStyleValue =
		typeof noiseGradientStyle === "string" ? noiseGradientStyle : null;
	const noiseGradientIsOverlay = noiseGradientStyleValue === "overlay";
	const noiseGradientIsDissolve = noiseGradientStyleValue === "dissolve";
	// `revealPaint` lives ONLY in the scoped Look Graph overlay's grain payload
	// (there is no `node.recipe` equivalent field), so an object-material
	// Dissolve that has not been promoted to a scoped overlay yet simply reads
	// `null` here (no reveal set) rather than being hidden — the commit path
	// (`commitNoiseGradientRevealPaint`) auto-promotes on first write, mirroring
	// the tool bar's `commitNoiseGradientToolRevealPaint`. Gated on style
	// "dissolve" (not blend mode) to match `revealPaintForNode` in
	// `svg.ts`/`CanvasShell.tsx`: a non-dissolve style has no "hole" in the
	// object's own fill for a reveal color to show through, so showing the
	// control there would let a user set a value that never renders.
	const noiseGradientRevealPaintVisible = noiseGradientIsDissolve;
	const noiseGradientRevealPaint = noiseGradientRevealPaintVisible
		? noiseGradientFrameGraphRevealPaintForSelection(document, nodeIds)
		: null;
	const noiseGradientMixedGrainOn = noiseGradientMaterialModeIsMixed === true;
	const noiseGradientDirectionOptions: readonly {
		readonly value: string;
		readonly label: string;
	}[] = (
		[
			{ value: NOISE_GRADIENT_DIRECTION_EDGE, label: "Circular" },
			{ value: NOISE_GRADIENT_DIRECTION_MESH, label: "Field Mesh" },
			{ value: "0", label: "Linear →" },
			{ value: "45", label: "Linear ↘" },
			{ value: "90", label: "Linear ↓" },
			{ value: "135", label: "Linear ↙" },
			{ value: "180", label: "Linear ←" },
			{ value: "225", label: "Linear ↖" },
			{ value: "270", label: "Linear ↑" },
			{ value: "315", label: "Linear ↗" },
			{ value: NOISE_GRADIENT_DIRECTION_CUSTOM, label: "Custom angle" },
		] satisfies readonly {
			readonly value: string;
			readonly label: string;
		}[]
	).filter(
		(option) =>
			noiseGradientDirection === NOISE_GRADIENT_DIRECTION_CUSTOM ||
			option.value !== NOISE_GRADIENT_DIRECTION_CUSTOM,
	);
	const noiseGradientAngleVisible =
		noiseGradientAngle !== null &&
		noiseGradientDirection !== null &&
		noiseGradientDirection !== MIXED_VALUE &&
		noiseGradientDirection !== NOISE_GRADIENT_DIRECTION_EDGE &&
		noiseGradientDirection !== NOISE_GRADIENT_DIRECTION_MESH;
	const noiseGradientLinearFieldVisible = noiseGradientAngleVisible;
	const noiseGradientMatteKind = noiseGradientMatteValues.kind;
	const noiseGradientMatteOptions: readonly {
		readonly value: NoiseGradientMatteKind;
		readonly label: string;
	}[] = (
		[
			{ value: NOISE_GRADIENT_MATTE_NONE, label: "Object alpha" },
			{ value: NOISE_GRADIENT_MATTE_LINEAR, label: "Linear alpha" },
			{ value: NOISE_GRADIENT_MATTE_RADIAL, label: "Radial alpha" },
			{ value: NOISE_GRADIENT_MATTE_CUSTOM, label: "Custom alpha" },
		] satisfies readonly {
			readonly value: NoiseGradientMatteKind;
			readonly label: string;
		}[]
	).filter(
		(option) =>
			noiseGradientMatteKind === NOISE_GRADIENT_MATTE_CUSTOM ||
			option.value !== NOISE_GRADIENT_MATTE_CUSTOM,
	);
	const noiseGradientLinearMatteVisible =
		noiseGradientMatteKind === NOISE_GRADIENT_MATTE_LINEAR;
	const noiseGradientRadialMatteVisible =
		noiseGradientMatteKind === NOISE_GRADIENT_MATTE_RADIAL;
	const noiseGradientMatteFeatherVisible =
		noiseGradientLinearMatteVisible || noiseGradientRadialMatteVisible;
	const fillOff = values.fillEnabled === false;
	const strokeOff = values.strokeEnabled === false;
	// Dash controls are meaningless once a width profile is set (renderers ignore
	// dash for profiled strokes), including a mixed selection where the profile
	// state itself differs — disabling errs toward not implying dash still applies.
	const strokeWidthProfileActive =
		values.strokeWidthProfile !== null && values.strokeWidthProfile !== "none";

	return (
		<div className="space-y-1">
			{showFill ? (
				<div className="space-y-1 rounded-md border border-white/8 bg-black/15 p-1">
					<PaintRoleToggleHeader
						label="Fill"
						enabled={values.fillEnabled}
						disabled={!canEdit}
						onToggle={(enabled) =>
							commitPaintRoleEnabled(nodeIds, "fills", enabled)
						}
					/>
					{fillOff ? null : (
						<>
							<PaintField
								paintRole="fills"
								nodeIds={paintNodeIds}
								singleNodeId={
									paintNodeIds.length === 1 ? paintNodeIds[0] : undefined
								}
								paintKind={values.fillPaintKind}
								color={values.fillColor}
								colorEditable={values.fillColorEditable}
								gradient={values.fillGradient}
								canConvertToMesh={values.fillCanConvertToMesh}
								sharedColorState={fillSharedColorState}
								resetKey={resetKey}
								disabled={!canEdit}
							/>
							<PaintOpacitySlider
								paintRole="fills"
								nodeIds={paintNodeIds}
								opacity={values.fillOpacity}
								disabled={!canEdit}
							/>
							<ImagePaintControls
								paintRole="fills"
								label="Fill"
								nodeIds={paintNodeIds}
								model={values.fillImage}
								resetKey={resetKey}
								disabled={!canEdit}
							/>
							<MeshPaintControls
								model={values.fillMesh}
								resetKey={resetKey}
								disabled={!canEdit}
							/>
						</>
					)}
				</div>
			) : null}

			<div className="space-y-1 rounded-md border border-white/8 bg-black/15 p-1">
				<PaintRoleToggleHeader
					label="Stroke"
					enabled={values.strokeEnabled}
					disabled={!canEdit}
					onToggle={(enabled) =>
						commitPaintRoleEnabled(nodeIds, "strokes", enabled)
					}
				/>
				{strokeOff ? null : (
					<>
						<div className="grid grid-cols-2 gap-1">
							<PaintField
								paintRole="strokes"
								nodeIds={paintNodeIds}
								singleNodeId={
									paintNodeIds.length === 1 ? paintNodeIds[0] : undefined
								}
								paintKind={values.strokePaintKind}
								color={values.strokeColor}
								colorEditable={values.strokeColorEditable}
								gradient={values.strokeGradient}
								canConvertToMesh={false}
								sharedColorState={strokeSharedColorState}
								resetKey={resetKey}
								disabled={!canEdit}
							/>
							<NumericField
								label="Width px"
								value={values.strokeWidth}
								resetKey={`${resetKey}:stroke-width`}
								step="0.5"
								disabled={!canEdit}
								onCommit={(value) =>
									commitNodeStyleNumber(nodeIds, "strokeWidth", value)
								}
							/>
							<NumericField
								label="Stroke blur"
								value={values.strokeBlur}
								resetKey={`${resetKey}:stroke-blur`}
								step="0.5"
								disabled={!canEdit}
								onCommit={(value) => commitStrokeBlur(nodeIds, value)}
							/>
							<div className="col-span-2">
								<PaintOpacitySlider
									paintRole="strokes"
									nodeIds={paintNodeIds}
									opacity={values.strokeOpacity}
									disabled={!canEdit}
								/>
							</div>
							<SegmentedField
								label="Position"
								value={values.strokeAlign}
								options={strokeAlignSegments}
								disabled={!canEdit}
								onCommit={(value) =>
									commitStrokeOption(nodeIds, "strokeAlign", value)
								}
							/>
							<SegmentedField
								label="Cap"
								value={values.strokeCap}
								options={strokeCapSegments}
								disabled={!canEdit}
								onCommit={(value) =>
									commitStrokeOption(nodeIds, "strokeCap", value)
								}
							/>
							<SegmentedField
								label="Join"
								value={values.strokeJoin}
								options={strokeJoinSegments}
								disabled={!canEdit}
								onCommit={(value) =>
									commitStrokeOption(nodeIds, "strokeJoin", value)
								}
							/>
							<SegmentedField
								label="Style"
								value={values.strokeStyleKind}
								options={strokeStyleSegments}
								disabled={!canEdit || strokeWidthProfileActive}
								onCommit={(value) => commitStrokeStyleKind(nodeIds, value)}
							/>
							{values.strokeStyleKind === "solid" ? null : (
								<TextInputField
									label="Dash px"
									value={values.strokeDash}
									resetKey={`${resetKey}:stroke-dash`}
									disabled={!canEdit || strokeWidthProfileActive}
									onCommit={(value) => commitStrokeDash(nodeIds, value)}
								/>
							)}
							<SelectField
								label="Width profile"
								value={values.strokeWidthProfile}
								options={strokeWidthProfileOptionsFor(
									values.strokeWidthProfile,
								)}
								resetKey={`${resetKey}:stroke-width-profile`}
								disabled={!canEdit}
								onCommit={(value) => commitStrokeWidthProfile(nodeIds, value)}
							/>
						</div>
						<ImagePaintControls
							paintRole="strokes"
							label="Stroke"
							nodeIds={paintNodeIds}
							model={values.strokeImage}
							resetKey={resetKey}
							disabled={!canEdit}
						/>
						<MeshPaintControls
							model={values.strokeMesh}
							resetKey={resetKey}
							disabled={!canEdit}
						/>
					</>
				)}
			</div>

			{maskFeather ? (
				<div className="rounded-md border border-white/8 bg-black/15 p-1">
					<div className="mb-1 grid grid-cols-2 gap-1">
						<SelectField
							label="Matte"
							value={maskFeather.channel}
							options={[
								{ value: "alpha", label: "Alpha" },
								{ value: "luminance", label: "Luminance" },
								{ value: "red", label: "Red" },
								{ value: "green", label: "Green" },
								{ value: "blue", label: "Blue" },
							]}
							resetKey={`${resetKey}:mask-channel:${maskFeather.relationId}`}
							disabled={!canEdit}
							onCommit={(channel) => {
								if (
									channel !== "alpha" &&
									channel !== "luminance" &&
									channel !== "red" &&
									channel !== "green" &&
									channel !== "blue"
								)
									return false;
								if (channel !== "alpha" && !luminanceMatteSupported)
									return false;
								return commitMaskRelationBehavior(
									maskFeather.contentNodeId,
									maskFeather.relationId,
									{ channel },
								);
							}}
						/>
						<SelectField
							label="Source"
							value={maskFeather.sourceSampling}
							options={[
								{ value: "pre-effects", label: "Pre FX" },
								{ value: "post-effects", label: "Post FX" },
							]}
							resetKey={`${resetKey}:mask-source-sampling:${maskFeather.relationId}`}
							disabled={!canEdit}
							onCommit={(sourceSampling) => {
								if (
									sourceSampling !== "pre-effects" &&
									sourceSampling !== "post-effects"
								) {
									return false;
								}
								return commitMaskRelationBehavior(
									maskFeather.contentNodeId,
									maskFeather.relationId,
									{ sourceSampling },
								);
							}}
						/>
					</div>
					<div className="mb-1 flex h-5 items-center justify-between gap-2 text-ui">
						<label className="flex min-w-0 items-center gap-1 text-fg-muted">
							<input
								type="checkbox"
								checked={maskFeather.invert}
								disabled={!canEdit}
								onChange={(event) =>
									commitMaskRelationSetting(
										maskFeather.contentNodeId,
										maskFeather.relationId,
										MASK_RELATION_INVERT_PROPERTY_ID,
										event.currentTarget.checked ? 1 : 0,
									)
								}
								className="size-3 accent-accent disabled:cursor-not-allowed disabled:opacity-45"
							/>
							<span>Mask invert</span>
						</label>
					</div>
					{maskFeather.sourceSampling === "post-effects" ? (
						<div className="mb-1 rounded border border-warn/30 bg-warn-surface px-1.5 py-1 text-ui text-warn-fg">
							Post FX matte sampling is preserved as intent but currently falls
							back unmasked.
						</div>
					) : null}
					{maskFeather.channel === "luminance" && !luminanceMatteSupported ? (
						<div className="mb-1 rounded border border-danger/30 bg-danger-surface px-1.5 py-1 text-danger-fg text-ui">
							Luminance matte requires exactly one solid source fill. Output
							falls back to unclipped content.
						</div>
					) : null}
					<div className="grid grid-cols-2 gap-1">
						<NumericField
							label="Mask blur"
							value={maskFeather.featherRadius}
							resetKey={`${resetKey}:mask-feather:${maskFeather.relationId}`}
							step="1"
							disabled={!canEdit}
							onCommit={(value) =>
								commitMaskRelationFeather(
									maskFeather.contentNodeId,
									maskFeather.relationId,
									value,
								)
							}
						/>
						<NumericField
							label="Mask opacity"
							value={maskFeather.opacity}
							resetKey={`${resetKey}:mask-opacity:${maskFeather.relationId}`}
							step="0.05"
							disabled={!canEdit}
							onCommit={(value) =>
								commitMaskRelationSetting(
									maskFeather.contentNodeId,
									maskFeather.relationId,
									MASK_RELATION_OPACITY_PROPERTY_ID,
									value,
								)
							}
						/>
						<NumericField
							label="Mask expand"
							value={maskFeather.expand}
							resetKey={`${resetKey}:mask-expand:${maskFeather.relationId}`}
							step="0.5"
							disabled={!canEdit}
							onCommit={(value) =>
								commitMaskRelationSetting(
									maskFeather.contentNodeId,
									maskFeather.relationId,
									MASK_RELATION_EXPAND_PROPERTY_ID,
									value,
								)
							}
						/>
					</div>
				</div>
			) : null}

			<div className="grid grid-cols-2 gap-1">
				<SelectField
					label="Blend"
					value={values.blendMode}
					options={blendModeOptions}
					resetKey={`${resetKey}:blend`}
					disabled={!canEdit}
					onCommit={(value) => commitBlendMode(nodeIds, value)}
				/>
				{extraControls}
				{nodes.length > 1 ? (
					<>
						<ReadoutRow label="Fills" value={readoutText(values.fillSummary)} />
						<ReadoutRow
							label="Strokes"
							value={readoutText(values.strokeSummary)}
						/>
					</>
				) : null}
			</div>

			<div className="rounded-md border border-white/8 bg-black/15 p-1">
				<div className="mb-1 flex h-5 items-center justify-between gap-2 text-ui">
					<label className="flex min-w-0 items-center gap-1 text-fg-muted">
						<input
							type="checkbox"
							checked={values.dropShadowEnabled === true}
							disabled={!canEdit}
							onChange={(event) =>
								commitDropShadowEnabled(nodeIds, event.currentTarget.checked)
							}
							className="size-3 accent-accent disabled:cursor-not-allowed disabled:opacity-45"
						/>
						<span>Drop shadow</span>
					</label>
					{values.dropShadowEnabled === MIXED_VALUE ? (
						<span className="font-mono text-fg-subtle">Mixed</span>
					) : null}
				</div>
				<div className="grid grid-cols-3 gap-1">
					<ColorField
						label="Color"
						value={values.dropShadowColor}
						resetKey={`${resetKey}:shadow-color`}
						disabled={shadowFieldsDisabled}
						onCommit={(value) => commitDropShadowColor(nodeIds, value)}
						onLiveCommit={(value, coalesceKey) =>
							commitDropShadowColor(nodeIds, value, coalesceKey)
						}
					/>
					<NumericField
						label="X"
						value={values.dropShadowX}
						resetKey={`${resetKey}:shadow-x`}
						step="1"
						disabled={shadowFieldsDisabled}
						onCommit={(value) => commitDropShadowNumber(nodeIds, "x", value)}
					/>
					<NumericField
						label="Y"
						value={values.dropShadowY}
						resetKey={`${resetKey}:shadow-y`}
						step="1"
						disabled={shadowFieldsDisabled}
						onCommit={(value) => commitDropShadowNumber(nodeIds, "y", value)}
					/>
					<NumericField
						label="Blur"
						value={values.dropShadowRadius}
						resetKey={`${resetKey}:shadow-radius`}
						step="1"
						disabled={shadowFieldsDisabled}
						onCommit={(value) =>
							commitDropShadowNumber(nodeIds, "radius", value)
						}
					/>
					<NumericField
						label="Spread"
						value={values.dropShadowSpread}
						resetKey={`${resetKey}:shadow-spread`}
						step="1"
						disabled={shadowFieldsDisabled}
						onCommit={(value) =>
							commitDropShadowNumber(nodeIds, "spread", value)
						}
					/>
					<NumericField
						label="O"
						value={values.dropShadowOpacity}
						resetKey={`${resetKey}:shadow-opacity`}
						step="0.05"
						disabled={shadowFieldsDisabled}
						onCommit={(value) =>
							commitDropShadowNumber(nodeIds, "opacity", value)
						}
					/>
				</div>
			</div>

			<div className="rounded-md border border-white/8 bg-black/15 p-1">
				<div className="mb-1 flex h-5 items-center justify-between gap-2 text-ui">
					<label className="flex min-w-0 items-center gap-1 text-fg-muted">
						<input
							type="checkbox"
							checked={values.innerShadowEnabled === true}
							disabled={!canEdit}
							onChange={(event) =>
								commitShadowEnabled(
									nodeIds,
									"inner-shadow",
									event.currentTarget.checked,
								)
							}
							className="size-3 accent-accent disabled:cursor-not-allowed disabled:opacity-45"
						/>
						<span>Inner shadow</span>
					</label>
					{values.innerShadowEnabled === MIXED_VALUE ? (
						<span className="font-mono text-fg-subtle">Mixed</span>
					) : null}
				</div>
				<div className="grid grid-cols-3 gap-1">
					<ColorField
						label="Color"
						value={values.innerShadowColor}
						resetKey={`${resetKey}:inner-shadow-color`}
						disabled={innerShadowFieldsDisabled}
						onCommit={(value) =>
							commitShadowColor(nodeIds, "inner-shadow", value)
						}
						onLiveCommit={(value, coalesceKey) =>
							commitShadowColor(nodeIds, "inner-shadow", value, coalesceKey)
						}
					/>
					<NumericField
						label="X"
						value={values.innerShadowX}
						resetKey={`${resetKey}:inner-shadow-x`}
						step="1"
						disabled={innerShadowFieldsDisabled}
						onCommit={(value) =>
							commitShadowNumber(nodeIds, "inner-shadow", "x", value)
						}
					/>
					<NumericField
						label="Y"
						value={values.innerShadowY}
						resetKey={`${resetKey}:inner-shadow-y`}
						step="1"
						disabled={innerShadowFieldsDisabled}
						onCommit={(value) =>
							commitShadowNumber(nodeIds, "inner-shadow", "y", value)
						}
					/>
					<NumericField
						label="Blur"
						value={values.innerShadowRadius}
						resetKey={`${resetKey}:inner-shadow-radius`}
						step="1"
						disabled={innerShadowFieldsDisabled}
						onCommit={(value) =>
							commitShadowNumber(nodeIds, "inner-shadow", "radius", value)
						}
					/>
					<NumericField
						label="Spread"
						value={values.innerShadowSpread}
						resetKey={`${resetKey}:inner-shadow-spread`}
						step="1"
						disabled={innerShadowFieldsDisabled}
						onCommit={(value) =>
							commitShadowNumber(nodeIds, "inner-shadow", "spread", value)
						}
					/>
					<NumericField
						label="O"
						value={values.innerShadowOpacity}
						resetKey={`${resetKey}:inner-shadow-opacity`}
						step="0.05"
						disabled={innerShadowFieldsDisabled}
						onCommit={(value) =>
							commitShadowNumber(nodeIds, "inner-shadow", "opacity", value)
						}
					/>
				</div>
			</div>

			<div className="rounded-md border border-white/8 bg-black/15 p-1">
				<div className="mb-1 flex h-5 items-center justify-between gap-2 text-ui">
					<label className="flex min-w-0 items-center gap-1 text-fg-muted">
						<input
							type="checkbox"
							checked={values.layerBlurEnabled === true}
							disabled={!canEdit}
							onChange={(event) =>
								commitLayerBlurEnabled(nodeIds, event.currentTarget.checked)
							}
							className="size-3 accent-accent disabled:cursor-not-allowed disabled:opacity-45"
						/>
						<span>Layer blur</span>
					</label>
					{values.layerBlurEnabled === MIXED_VALUE ? (
						<span className="font-mono text-fg-subtle">Mixed</span>
					) : null}
				</div>
				<div className="mb-1 flex h-5 items-center justify-between gap-1 text-ui">
					<label className="flex min-w-0 items-center gap-1 text-fg-muted">
						<input
							type="checkbox"
							checked={values.layerBlurAxesLinked === true}
							ref={(input) => {
								if (input) {
									input.indeterminate =
										values.layerBlurAxesLinked === MIXED_VALUE;
								}
							}}
							disabled={layerBlurFieldsDisabled}
							onChange={(event) =>
								commitLayerBlurAxesLinked(nodeIds, event.currentTarget.checked)
							}
							className="size-3 accent-accent disabled:cursor-not-allowed disabled:opacity-45"
						/>
						<span>Link X / Y</span>
					</label>
					{values.layerBlurAxesLinked === MIXED_VALUE ? (
						<span className="font-mono text-fg-subtle">Mixed</span>
					) : null}
				</div>
				<div
					className={cn(
						"grid gap-1",
						values.layerBlurAxesLinked === true ? "grid-cols-1" : "grid-cols-2",
					)}
				>
					<NumericField
						label={values.layerBlurAxesLinked === true ? "Radius" : "X"}
						value={values.layerBlurRadius}
						resetKey={`${resetKey}:layer-blur-radius-x`}
						step="1"
						disabled={layerBlurFieldsDisabled}
						onCommit={(value) => commitLayerBlurAxisNumber(nodeIds, "x", value)}
					/>
					{values.layerBlurAxesLinked === true ? null : (
						<NumericField
							label="Y"
							value={values.layerBlurRadiusY}
							resetKey={`${resetKey}:layer-blur-radius-y`}
							step="1"
							disabled={layerBlurFieldsDisabled}
							onCommit={(value) =>
								commitLayerBlurAxisNumber(nodeIds, "y", value)
							}
						/>
					)}
				</div>
			</div>

			<div className="rounded-md border border-white/8 bg-black/15 p-1">
				<div className="mb-1 flex h-5 items-center text-fg-muted text-ui">
					<span>Look</span>
				</div>
				<div className="mb-1.5 space-y-1">
					<button
						type="button"
						disabled={!canEdit}
						aria-pressed={analogFilmPressed}
						onClick={() => commitAnalogFilmNodeLook(nodeIds)}
						title="Apply Analog Film as a frame overlay clipped to the selected object silhouettes; object material stays unchanged."
						className={cn(
							"flex w-full flex-col gap-0.5 rounded-md border px-2 py-1 text-left text-ui transition disabled:cursor-not-allowed disabled:opacity-45",
							analogFilmAppliedToSelection
								? "border-accent/60 bg-accent-surface text-accent-fg"
								: "border-white/10 bg-white/5 text-fg-muted hover:bg-white/10 hover:text-ink",
						)}
					>
						<span className="text-fg">{ANALOG_FILM_LOOK_LABEL}</span>
						<span className="text-fg-subtle">{analogFilmScopeLabel}</span>
					</button>
					<button
						type="button"
						disabled={!canEdit || !analogFilmAppliedToSelection}
						onClick={() => commitRemoveAnalogFilmNodeLook(nodeIds)}
						title={
							analogFilmAppliedToSelection
								? "Remove the selected-object Analog Film look from this selection."
								: "No selected-object Analog Film look is applied to this selection."
						}
						className="flex h-6 w-full items-center justify-center rounded-md border border-white/10 bg-black/10 px-2 text-ui text-fg-muted transition hover:bg-white/10 hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"
					>
						Remove from selection
					</button>
					<div>
						<div className="mt-1 flex items-center justify-between gap-1 border-white/8 border-t pt-1 pb-0.5">
							<span className="text-fg-subtle text-ui">Style</span>
							<span className="text-fg-subtle text-ui">
								{noiseGradientScopeLabel}
							</span>
						</div>
						<SegmentedField
							label=""
							value={noiseGradientStyle}
							options={NOISE_GRADIENT_STYLE_SEGMENTS}
							disabled={noiseGradientEditDisabled}
							onCommit={(value) =>
								noiseGradientUsesFrameGraph
									? commitNoiseGradientFrameGraphStyle(nodeIds, value)
									: commitNoiseGradientStyle(nodeIds, value)
							}
						/>
					</div>
					{noiseGradientApplied ? (
						<>
							<div className="mt-1 border-white/8 border-t pt-1 pb-0.5 text-fg-subtle text-ui">
								Look
							</div>
							{noiseGradientIsOverlay ? (
								<>
									<SelectField
										label="Blend mode"
										value={noiseGradientBlendMode}
										options={NOISE_GRADIENT_OVERLAY_BLEND_MODE_OPTIONS}
										resetKey={`${resetKey}:ng-blend-mode`}
										disabled={noiseGradientEditDisabled}
										onCommit={(value) =>
											noiseGradientUsesFrameGraph
												? commitNoiseGradientFrameGraphBlendMode(nodeIds, value)
												: commitNoiseGradientBlendMode(nodeIds, value)
										}
									/>
									<ColorField
										label="Grain tint"
										value={noiseGradientOverlayColor}
										resetKey={`${resetKey}:ng-tint`}
										disabled={noiseGradientEditDisabled}
										allowNone
										onCommit={(value) => {
											const next = value === "none" ? null : value;
											return noiseGradientUsesFrameGraph
												? commitNoiseGradientFrameGraphOverlayColor(
														nodeIds,
														next,
													)
												: commitNoiseGradientOverlayColor(nodeIds, next);
										}}
									/>
									<TextToggleButton
										label="Film grain"
										value={noiseGradientMaterialModeIsMixed}
										disabled={noiseGradientEditDisabled}
										onToggle={() =>
											noiseGradientUsesFrameGraph
												? commitNoiseGradientFrameGraphMaterialMode(
														nodeIds,
														noiseGradientMixedGrainOn ? "particle" : "mixed",
													)
												: commitNoiseGradientMaterialMode(
														nodeIds,
														noiseGradientMixedGrainOn ? "particle" : "mixed",
													)
										}
									>
										Film grain
									</TextToggleButton>
									{noiseGradientMixedGrainOn ? (
										<NumericField
											label="Grain"
											value={noiseGradientGrainStrength}
											resetKey={`${resetKey}:ng-grain-strength`}
											step="0.05"
											disabled={noiseGradientEditDisabled}
											onCommit={(value) =>
												noiseGradientUsesFrameGraph
													? commitNoiseGradientFrameGraphGrainStrength(
															nodeIds,
															value,
														)
													: commitNoiseGradientGrainStrength(nodeIds, value)
											}
										/>
									) : null}
								</>
							) : null}
							{noiseGradientIsDissolve ? (
								<>
									<NumericField
										label="Coverage"
										value={noiseGradientCoverage}
										resetKey={`${resetKey}:ng-coverage`}
										step="0.05"
										disabled={noiseGradientEditDisabled}
										onCommit={(value) =>
											noiseGradientUsesFrameGraph
												? commitNoiseGradientFrameGraphCoverage(nodeIds, value)
												: commitNoiseGradientCoverage(nodeIds, value)
										}
									/>
									<NumericField
										label="Softness"
										value={noiseGradientValues.softness}
										resetKey={`${resetKey}:ng-softness`}
										step="0.05"
										disabled={noiseGradientEditDisabled}
										onCommit={(value) =>
											noiseGradientUsesFrameGraph
												? commitNoiseGradientFrameGraphNumber(
														nodeIds,
														"softness",
														value,
													)
												: commitNoiseGradientNumber(nodeIds, "softness", value)
										}
									/>
									{noiseGradientRevealPaintVisible ? (
										<RevealPaintField
											nodeIds={nodeIds}
											value={noiseGradientRevealPaint}
											disabled={noiseGradientEditDisabled}
											resetKey={`${resetKey}:ng-reveal-paint`}
										/>
									) : null}
								</>
							) : null}
							<div className="mt-1 border-white/8 border-t pt-1 pb-0.5 text-fg-subtle text-ui">
								Field
							</div>
							<SelectField
								label="Field"
								value={noiseGradientDirection}
								options={noiseGradientDirectionOptions}
								resetKey={`${resetKey}:ng-direction`}
								disabled={noiseGradientEditDisabled}
								onCommit={(value) => {
									if (value === NOISE_GRADIENT_DIRECTION_CUSTOM) {
										return false;
									}
									const direction =
										value === NOISE_GRADIENT_DIRECTION_EDGE
											? null
											: value === NOISE_GRADIENT_DIRECTION_MESH
												? NOISE_GRADIENT_DIRECTION_MESH
												: Number(value);
									return noiseGradientUsesFrameGraph
										? commitNoiseGradientFrameGraphDirection(nodeIds, direction)
										: commitNoiseGradientDirection(nodeIds, direction);
								}}
							/>
							{noiseGradientAngleVisible ? (
								<NumericField
									label="Angle"
									value={noiseGradientAngle}
									resetKey={`${resetKey}:ng-angle`}
									step="5"
									disabled={noiseGradientEditDisabled}
									onCommit={(value) =>
										noiseGradientUsesFrameGraph
											? commitNoiseGradientFrameGraphDirection(nodeIds, value)
											: commitNoiseGradientDirection(nodeIds, value)
									}
								/>
							) : null}
							{noiseGradientLinearFieldVisible ? (
								<div className="space-y-1">
									<div className="flex h-5 items-center justify-between gap-1 text-ui">
										<span className="text-fg-muted">Linear field</span>
										<div className="flex items-center gap-1">
											<InspectorIconButton
												label="Invert Linear Noise Gradient field"
												disabled={noiseGradientEditDisabled}
												onClick={() =>
													noiseGradientUsesFrameGraph
														? commitNoiseGradientFrameGraphLinearFieldInvert(
																nodeIds,
															)
														: commitNoiseGradientLinearFieldInvert(nodeIds)
												}
											>
												<ArrowsLeftRight aria-hidden="true" size={11} />
											</InspectorIconButton>
											<InspectorIconButton
												label="Fit Linear Noise Gradient field to bounds"
												disabled={noiseGradientEditDisabled}
												onClick={() =>
													noiseGradientUsesFrameGraph
														? commitNoiseGradientFrameGraphLinearFieldFit(
																nodeIds,
															)
														: commitNoiseGradientLinearFieldFit(nodeIds)
												}
											>
												<ArrowsOutSimple aria-hidden="true" size={11} />
											</InspectorIconButton>
										</div>
									</div>
									<div className="grid grid-cols-4 gap-1">
										{(
											[
												{ field: "x1", label: "X1" },
												{ field: "y1", label: "Y1" },
												{ field: "x2", label: "X2" },
												{ field: "y2", label: "Y2" },
											] as const
										).map(({ field, label }) => (
											<NumericField
												key={field}
												label={label}
												value={noiseGradientLinearFieldValues[field]}
												resetKey={`${resetKey}:ng-linear-${field}`}
												step="0.01"
												disabled={noiseGradientEditDisabled}
												onCommit={(value) =>
													noiseGradientUsesFrameGraph
														? commitNoiseGradientFrameGraphLinearFieldNumber(
																nodeIds,
																field,
																value,
															)
														: commitNoiseGradientLinearFieldNumber(
																nodeIds,
																field,
																value,
															)
												}
											/>
										))}
									</div>
								</div>
							) : null}
							<NumericField
								label="Extent"
								value={noiseGradientValues.extent}
								resetKey={`${resetKey}:ng-extent`}
								step="0.05"
								disabled={noiseGradientEditDisabled}
								onCommit={(value) =>
									noiseGradientUsesFrameGraph
										? commitNoiseGradientFrameGraphNumber(
												nodeIds,
												"extent",
												value,
											)
										: commitNoiseGradientNumber(nodeIds, "extent", value)
								}
							/>
							<div className="mt-1 border-white/8 border-t pt-1 pb-0.5 text-fg-subtle text-ui">
								Matte
							</div>
							<SelectField
								label="Matte"
								value={noiseGradientMatteKind}
								options={noiseGradientMatteOptions}
								resetKey={`${resetKey}:ng-matte-kind`}
								disabled={noiseGradientEditDisabled}
								onCommit={(value) => {
									if (value === NOISE_GRADIENT_MATTE_CUSTOM) return false;
									return noiseGradientUsesFrameGraph
										? commitNoiseGradientFrameGraphMatteKind(nodeIds, value)
										: commitNoiseGradientMatteKind(nodeIds, value);
								}}
							/>
							{noiseGradientLinearMatteVisible ? (
								<NumericField
									label="Matte angle"
									value={noiseGradientMatteValues.angle}
									resetKey={`${resetKey}:ng-matte-angle`}
									step="5"
									disabled={noiseGradientEditDisabled}
									onCommit={(value) =>
										noiseGradientUsesFrameGraph
											? commitNoiseGradientFrameGraphMatteNumber(
													nodeIds,
													"angle",
													value,
												)
											: commitNoiseGradientMatteNumber(nodeIds, "angle", value)
									}
								/>
							) : null}
							{noiseGradientRadialMatteVisible ? (
								<div className="grid grid-cols-2 gap-1">
									<NumericField
										label="Matte X"
										value={noiseGradientMatteValues.centerX}
										resetKey={`${resetKey}:ng-matte-cx`}
										step="0.05"
										disabled={noiseGradientEditDisabled}
										onCommit={(value) =>
											noiseGradientUsesFrameGraph
												? commitNoiseGradientFrameGraphMatteNumber(
														nodeIds,
														"centerX",
														value,
													)
												: commitNoiseGradientMatteNumber(
														nodeIds,
														"centerX",
														value,
													)
										}
									/>
									<NumericField
										label="Matte Y"
										value={noiseGradientMatteValues.centerY}
										resetKey={`${resetKey}:ng-matte-cy`}
										step="0.05"
										disabled={noiseGradientEditDisabled}
										onCommit={(value) =>
											noiseGradientUsesFrameGraph
												? commitNoiseGradientFrameGraphMatteNumber(
														nodeIds,
														"centerY",
														value,
													)
												: commitNoiseGradientMatteNumber(
														nodeIds,
														"centerY",
														value,
													)
										}
									/>
									<NumericField
										label="Matte RX"
										value={noiseGradientMatteValues.radiusX}
										resetKey={`${resetKey}:ng-matte-rx`}
										step="0.05"
										disabled={noiseGradientEditDisabled}
										onCommit={(value) =>
											noiseGradientUsesFrameGraph
												? commitNoiseGradientFrameGraphMatteNumber(
														nodeIds,
														"radiusX",
														value,
													)
												: commitNoiseGradientMatteNumber(
														nodeIds,
														"radiusX",
														value,
													)
										}
									/>
									<NumericField
										label="Matte RY"
										value={noiseGradientMatteValues.radiusY}
										resetKey={`${resetKey}:ng-matte-ry`}
										step="0.05"
										disabled={noiseGradientEditDisabled}
										onCommit={(value) =>
											noiseGradientUsesFrameGraph
												? commitNoiseGradientFrameGraphMatteNumber(
														nodeIds,
														"radiusY",
														value,
													)
												: commitNoiseGradientMatteNumber(
														nodeIds,
														"radiusY",
														value,
													)
										}
									/>
								</div>
							) : null}
							{noiseGradientMatteFeatherVisible ? (
								<NumericField
									label="Matte feather"
									value={noiseGradientMatteValues.feather}
									resetKey={`${resetKey}:ng-matte-feather`}
									step="0.05"
									disabled={noiseGradientEditDisabled}
									onCommit={(value) =>
										noiseGradientUsesFrameGraph
											? commitNoiseGradientFrameGraphMatteNumber(
													nodeIds,
													"feather",
													value,
												)
											: commitNoiseGradientMatteNumber(
													nodeIds,
													"feather",
													value,
												)
									}
								/>
							) : null}
							<div className="mt-1 border-white/8 border-t pt-1 pb-0.5 text-fg-subtle text-ui">
								Presets
							</div>
							<div className="grid grid-cols-2 gap-1">
								{NOISE_GRADIENT_PRESETS.map((preset) => (
									<button
										key={preset.id}
										type="button"
										disabled={noiseGradientEditDisabled}
										title="Apply a static particle field."
										onClick={() =>
											noiseGradientUsesFrameGraph
												? commitNoiseGradientFrameGraphPreset(nodeIds, preset)
												: commitNoiseGradientPreset(nodeIds, preset)
										}
										className="h-6 rounded-md border border-white/10 bg-white/5 text-fg-muted text-ui transition hover:bg-white/10 hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"
									>
										{preset.label}
									</button>
								))}
							</div>
						</>
					) : null}
				</div>
				<div className="space-y-0.5">
					{LOOK_GROUP_ORDER.map((group) => (
						<div key={group}>
							<div className="mt-1 border-white/8 border-t pt-1 pb-0.5 text-fg-subtle text-ui">
								{group}
							</div>
							{LOOK_SLIDERS.filter((control) => control.group === group).map(
								(control) => (
									<LookSlider
										key={control.field}
										control={control}
										value={recipeValues[control.field]}
										nodeIds={nodeIds}
										disabled={!canEdit}
									/>
								),
							)}
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

function StageGReadoutSection({
	readout,
}: {
	readonly readout: StageGInspectorReadout;
}) {
	if (!readout.hasSignal) return null;
	return (
		<PanelSection
			title="Production"
			icon={<StackSimple aria-hidden="true" size={12} />}
		>
			<div className="space-y-1">
				{readout.rows.map((row) => (
					<div
						key={row.label}
						className="flex min-h-6 items-center justify-between gap-2 rounded-md border border-white/8 bg-black/15 px-1.5 text-ui"
						title={`${row.label}: ${row.value}`}
					>
						<span className="shrink-0 text-fg-muted">{row.label}</span>
						<span
							className={cn(
								"min-w-0 truncate text-right font-mono",
								row.tone === "good" && "text-accent-fg",
								row.tone === "warning" && "text-warn-fg",
								row.tone === "default" && "text-fg-secondary",
							)}
						>
							{row.value}
						</span>
					</div>
				))}
			</div>
		</PanelSection>
	);
}

function KeyframeButton({
	keyframeState,
	field,
	label,
}: {
	readonly keyframeState: ReadyInspectorKeyframeActionState;
	readonly field: InspectorMotionField;
	readonly label: string;
}) {
	const motionState = keyframeState.fields[field];
	const keyLabel = motionState.keyedAtFrame
		? `Update ${label} keyframe at frame ${motionState.frame}`
		: `Set ${label} keyframe at frame ${motionState.frame}`;
	return (
		<button
			type="button"
			aria-label={keyLabel}
			title={keyLabel}
			onClick={() =>
				commitInspectorKeyframeEdit(
					[field],
					keyframeState.nodeId,
					keyframeState.frame,
				)
			}
			className={cn(
				"grid size-6 place-items-center rounded-md border transition disabled:cursor-not-allowed disabled:opacity-45",
				motionState.keyedAtFrame
					? "border-accent bg-accent-surface text-accent-fg"
					: motionState.animated
						? "border-warn/45 bg-warn-surface text-warn hover:border-warn/70"
						: "border-white/10 bg-black/20 text-fg-muted hover:border-white/20 hover:text-white",
			)}
		>
			<Diamond
				aria-hidden="true"
				size={11}
				weight={motionState.keyedAtFrame ? "fill" : "regular"}
			/>
		</button>
	);
}

const nativeCodePropertyIdForInspectorField = (
	field: InspectorMotionField,
): NativeExpressionPropertyId | null => {
	const propertyId = inspectorFieldToBindablePropertyId(field);
	return propertyId
		? nativeExpressionPropertyIdFromBindableId(propertyId)
		: null;
};

function TransformFieldActions({
	keyframeState,
	field,
	label,
}: {
	readonly keyframeState: ReadyInspectorKeyframeActionState;
	readonly field: InspectorMotionField;
	readonly label: string;
}) {
	const propertyId = nativeCodePropertyIdForInspectorField(field);
	return (
		<span className="flex items-center gap-1">
			<KeyframeButton
				keyframeState={keyframeState}
				field={field}
				label={label}
			/>
			{propertyId ? (
				<NativeCodeButton
					nodeId={keyframeState.nodeId}
					propertyId={propertyId}
					label={label}
				/>
			) : null}
		</span>
	);
}

function PivotPresetGrid({
	node,
	recording,
	keyframeState,
}: {
	readonly node: VectorNode;
	readonly recording: boolean;
	readonly keyframeState: ReadyInspectorKeyframeActionState;
}) {
	const bounds = getNodeLocalBounds(node);
	const currentX = keyframeState.values.anchorX;
	const currentY = keyframeState.values.anchorY;
	return (
		<div className="min-w-0">
			<FieldLabel label="Pivot" mixed={false} />
			<div className="grid h-16 grid-cols-3 gap-1 rounded-md border border-white/10 bg-black/20 p-1">
				{pivotPresets.map((preset) => {
					const anchor = {
						x: bounds.x + bounds.width * preset.x,
						y: bounds.y + bounds.height * preset.y,
					};
					const active =
						typeof currentX === "number" &&
						typeof currentY === "number" &&
						Math.abs(currentX - anchor.x) < 1e-6 &&
						Math.abs(currentY - anchor.y) < 1e-6;
					return (
						<button
							key={preset.id}
							type="button"
							aria-label={preset.label}
							aria-pressed={active}
							title={preset.label}
							onClick={() =>
								commitInspectorAnchorPresetEdit(
									node,
									recording,
									keyframeState,
									anchor,
								)
							}
							className={cn(
								"grid min-h-0 place-items-center rounded-[3px] border transition",
								active
									? "border-accent bg-accent-surface text-accent-fg"
									: "border-white/10 bg-black/20 text-fg-muted hover:border-white/20 hover:text-white",
							)}
						>
							<span
								className={cn(
									"block rounded-full",
									active ? "size-2 bg-accent-fg" : "size-1.5 bg-current",
								)}
							/>
						</button>
					);
				})}
			</div>
		</div>
	);
}

function KeyframeGroupButton({
	keyframeState,
	group,
	label,
	icon,
}: {
	readonly keyframeState: ReadyInspectorKeyframeActionState;
	readonly group: InspectorKeyframeActionGroup;
	readonly label: string;
	readonly icon: ReactNode;
}) {
	const groupState = keyframeState.groups[group];
	const keyLabel = groupState.allKeyedAtFrame
		? `Update ${label} keyframes at frame ${groupState.frame}`
		: `Set ${label} keyframes at frame ${groupState.frame}`;
	return (
		<button
			type="button"
			aria-label={keyLabel}
			title={keyLabel}
			onClick={() =>
				commitInspectorKeyframeEdit(
					groupState.fields,
					keyframeState.nodeId,
					keyframeState.frame,
				)
			}
			className={cn(
				"inline-flex h-5 min-w-8 items-center justify-center gap-1 rounded-md border px-1 transition",
				groupState.allKeyedAtFrame
					? "border-accent bg-accent-surface text-accent-fg"
					: groupState.animated || groupState.someKeyedAtFrame
						? "border-warn/45 bg-warn-surface text-warn hover:border-warn/70"
						: "border-white/10 bg-black/20 text-fg-muted hover:border-white/20 hover:text-white",
			)}
		>
			{icon}
			<Diamond
				aria-hidden="true"
				size={9}
				weight={groupState.allKeyedAtFrame ? "fill" : "regular"}
			/>
		</button>
	);
}

function RecordingButton({
	recording,
	onToggle,
}: {
	readonly recording: boolean;
	readonly onToggle: () => void;
}) {
	return (
		<button
			type="button"
			aria-label={recording ? "Auto-key on" : "Auto-key off"}
			aria-pressed={recording}
			title={recording ? "Auto-key on" : "Auto-key off"}
			onClick={onToggle}
			className={cn(
				"grid size-5 place-items-center rounded-md border transition",
				recording
					? "border-danger/55 bg-danger-surface text-danger-fg"
					: "border-white/10 bg-black/20 text-fg-muted hover:border-white/20 hover:text-white",
			)}
		>
			<Circle
				aria-hidden="true"
				size={12}
				weight={recording ? "fill" : "regular"}
			/>
		</button>
	);
}

function InspectorIconButton({
	label,
	disabled = false,
	tone = "default",
	onClick,
	buttonRef,
	children,
}: {
	readonly label: string;
	readonly disabled?: boolean;
	readonly tone?: "default" | "danger";
	readonly onClick: () => void;
	readonly buttonRef?: RefCallback<HTMLButtonElement>;
	readonly children: ReactNode;
}) {
	return (
		<button
			ref={buttonRef}
			type="button"
			aria-label={label}
			aria-disabled={disabled}
			title={label}
			onClick={() => {
				if (disabled) return;
				onClick();
			}}
			className={cn(
				"grid size-5 place-items-center rounded-md border transition",
				disabled
					? "cursor-not-allowed border-white/10 bg-black/20 text-fg-subtle opacity-55"
					: tone === "danger"
						? "border-danger/25 bg-black/20 text-danger-fg hover:border-danger/55 hover:text-danger-fg"
						: "border-white/10 bg-black/20 text-fg-muted hover:border-white/20 hover:text-white",
			)}
		>
			{children}
		</button>
	);
}

function NoSelectionPanel({
	resetKey,
	suppressMotion = false,
}: {
	readonly resetKey: string;
	/** See {@link SingleSelectionPanel} — hides the empty "apply technique" Motion menu while the clip motion pane is open. */
	readonly suppressMotion?: boolean;
}) {
	const document = useSceneStore((state) => state.document);
	const selectedArtboardId = useSelectionStore(
		(state) => state.selectedArtboardId,
	);
	const artboardState = artboardInspectorState(
		document,
		sceneArtboardMutationAdapter,
		selectedArtboardId,
	);
	const { artboard, values } = artboardState;
	const artboardResetKey = `${resetKey}:${artboardState.resetKey}`;
	const artboardScope = artboardState.isDefaultArtboard ? "default" : "current";
	const artboardReadOnly = !artboardState.canMutate;
	const nodes = sceneNodeCount(document);
	const [timingIssue, setTimingIssue] = useState<string | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: switching artboards intentionally clears an issue owned by the previous timing target.
	useEffect(() => setTimingIssue(null), [artboard.id]);
	const commitTiming = (patch: {
		readonly fps?: number;
		readonly durationFrames?: number;
	}): boolean => {
		const result = commitDocumentTimingFromInspector({
			artboardId: artboard.id,
			fps: patch.fps ?? artboard.fps,
			durationFrames: patch.durationFrames ?? artboard.durationFrames,
		});
		setTimingIssue(result.status === "blocked" ? result.reason : null);
		return result.status !== "blocked";
	};

	return (
		<div className="space-y-1.5 py-1.5">
			<PanelSection
				title="Artboard"
				icon={<SlidersHorizontal aria-hidden="true" size={12} />}
				action={
					<div className="flex items-center gap-1">
						<InspectorIconButton
							label="Add artboard"
							disabled={!artboardState.canAdd}
							onClick={commitAddArtboardFromInspector}
						>
							<Plus aria-hidden="true" size={11} />
						</InspectorIconButton>
						<InspectorIconButton
							label="Duplicate artboard"
							disabled={!artboardState.canDuplicate}
							onClick={() => commitDuplicateArtboardFromInspector(artboard.id)}
						>
							<Copy aria-hidden="true" size={11} />
						</InspectorIconButton>
						<InspectorIconButton
							label={
								artboardState.canRemove
									? "Remove artboard"
									: "Cannot remove the last artboard"
							}
							disabled={!artboardState.canRemove}
							tone="danger"
							onClick={() => commitRemoveArtboardFromInspector(artboard.id)}
						>
							<Trash aria-hidden="true" size={11} />
						</InspectorIconButton>
					</div>
				}
			>
				<div className="space-y-1">
					<TextInputField
						label="Name"
						value={values.name}
						resetKey={`${artboardResetKey}:name`}
						disabled={artboardReadOnly}
						onCommit={(value) =>
							commitArtboardInspectorName(
								sceneArtboardMutationAdapter,
								artboard,
								value,
							)
						}
					/>
					<div className="grid grid-cols-2 gap-1">
						{artboardFields.map(({ label, field, step }) => (
							<NumericField
								key={field}
								label={label}
								value={values[field]}
								resetKey={`${artboardResetKey}:${field}`}
								step={step}
								disabled={artboardReadOnly}
								onCommit={(value) =>
									commitArtboardInspectorNumber(
										sceneArtboardMutationAdapter,
										artboard,
										field,
										value,
									)
								}
							/>
						))}
					</div>
					<ColorField
						label="Background"
						value={values.background}
						resetKey={`${artboardResetKey}:background`}
						disabled={artboardReadOnly}
						onCommit={(value) =>
							commitArtboardInspectorBackground(
								sceneArtboardMutationAdapter,
								artboard,
								value,
							)
						}
						onLiveCommit={(value, coalesceKey) =>
							commitArtboardInspectorBackground(
								sceneArtboardMutationAdapter,
								artboard,
								value,
								coalesceKey,
							)
						}
					/>
				</div>
			</PanelSection>

			<SceneCameraSection
				document={document}
				nodeIds={[]}
				primaryNodeId={null}
				resetKey={artboardResetKey}
			/>

			<FrameLookControls
				document={document}
				artboardId={artboard.id}
				resetKey={artboardResetKey}
				disabled={artboardReadOnly}
			/>

			{suppressMotion ? null : <MotionTechniqueSection nodeIds={[]} />}

			<PanelSection
				title="Timeline"
				icon={<SlidersHorizontal aria-hidden="true" size={12} />}
			>
				<div className="grid grid-cols-2 gap-1">
					<NumericField
						label="FPS"
						value={artboard.fps}
						resetKey={`${artboardResetKey}:timeline-fps`}
						step="1"
						disabled={artboardReadOnly}
						onCommit={(fps) => commitTiming({ fps })}
					/>
					<NumericField
						label="Frames"
						value={artboard.durationFrames}
						resetKey={`${artboardResetKey}:timeline-duration`}
						step="1"
						disabled={artboardReadOnly}
						onCommit={(durationFrames) => commitTiming({ durationFrames })}
					/>
				</div>
				<p className="mt-1 text-fg-subtle text-ui leading-3">
					Keeps frame addresses fixed and rejects unsafe timeline shrink.
				</p>
				{timingIssue ? (
					<p className="mt-1 text-danger-fg text-ui leading-3" role="status">
						{timingIssue}
					</p>
				) : null}
			</PanelSection>

			<PanelSection
				title="Export"
				icon={<Swatches aria-hidden="true" size={12} />}
			>
				<div className="space-y-1">
					<ReadoutRow label="Target" value={artboard.name} />
					<ReadoutRow
						label="Size"
						value={`${artboard.width} × ${artboard.height}`}
					/>
					<ReadoutRow
						label="Position"
						value={`${artboard.position.x}, ${artboard.position.y}`}
					/>
					<ReadoutRow
						label="Time"
						value={`${artboard.durationFrames}f @ ${artboard.fps}fps`}
					/>
					<ReadoutRow label="Scope" value={artboardScope} />
					<ReadoutRow
						label="Scene"
						value={`${document.layers.length} layers / ${nodes} nodes`}
					/>
				</div>
			</PanelSection>
		</div>
	);
}

/** Human-readable trigger summary: kind, plus the target node's display name when node-scoped (falls back to the raw id if the node was deleted since authoring). */
const interactionTriggerSummary = (
	document: SceneDocument,
	trigger: InteractionDefinition["trigger"],
): string => {
	if (!trigger.nodeId) return `${trigger.kind} (component)`;
	const node = findNode(document, trigger.nodeId);
	return `${trigger.kind} → ${node?.name ?? trigger.nodeId}`;
};

/** One-line action-kind summary (e.g. "play-clip, set-prop" for a two-action interaction), matching the order actions fire in. */
const interactionActionsSummary = (
	actions: InteractionDefinition["actions"],
): string => actions.map((action) => action.kind).join(", ");

const AUTOMATION_CHANNEL_OPTIONS = [
	{ value: "effectParam", label: "Effect parameter" },
	{ value: "effectInfluence", label: "Effect influence" },
	{ value: "transform", label: "Transform metadata" },
] as const satisfies readonly {
	readonly value: AutomationBindingChannel;
	readonly label: string;
}[];

const AUTOMATION_TARGET_SCOPE_OPTIONS = [
	{ value: "scene", label: "Scene" },
	{ value: "selection", label: "Current selection" },
	{ value: "object", label: "Object" },
	{ value: "group", label: "Group" },
	{ value: "layer", label: "Layer" },
] as const satisfies readonly {
	readonly value: EffectTargetScope;
	readonly label: string;
}[];

const AUTOMATION_MODE_OPTIONS = [
	{ value: "additive", label: "Additive" },
	{ value: "replace", label: "Replace" },
] as const satisfies readonly {
	readonly value: AutomationTrackMode;
	readonly label: string;
}[];

const AUTOMATION_EASING_OPTIONS = [
	{ value: "linear", label: "Linear" },
	{ value: "easeInOut", label: "Ease in/out" },
	{ value: "hold", label: "Hold" },
] as const satisfies readonly {
	readonly value: AutomationEasing;
	readonly label: string;
}[];

const defaultAutomationTarget = (
	document: SceneDocument,
	primaryNodeId: string | null,
): EffectTargetRef => {
	const nodeId = primaryNodeId ?? allNodes(document)[0]?.id;
	return nodeId ? { scope: "object", id: nodeId } : { scope: "scene" };
};

const defaultAutomationBinding = (
	channel: AutomationBindingChannel,
	document: SceneDocument,
	primaryNodeId: string | null,
): AutomationBinding => {
	if (channel === "effectInfluence") {
		return { channel, assignmentId: "assignment", path: "influence.value" };
	}
	const target = defaultAutomationTarget(document, primaryNodeId);
	if (channel === "transform") return { channel, target, path: "x" };
	return {
		channel,
		target,
		effect: { id: "appearance", path: "style", label: "Appearance" },
		path: "opacity",
	};
};

const automationTargetForScope = (
	scope: EffectTargetScope,
	document: SceneDocument,
	primaryNodeId: string | null,
	current: EffectTargetRef,
): EffectTargetRef => {
	if (scope === "scene" || scope === "selection") return { scope };
	if (scope === "layer") {
		return {
			scope,
			id:
				(current.scope === "layer" ? current.id : undefined) ??
				document.layers[0]?.id ??
				"layer",
		};
	}
	return {
		scope,
		id:
			(current.scope === "object" || current.scope === "group"
				? current.id
				: undefined) ??
			primaryNodeId ??
			allNodes(document)[0]?.id ??
			"object",
	};
};

function AutomationTrackEditor({
	document,
	primaryNodeId,
	track,
	trackIndex,
	trackCount,
	currentFrame,
	durationFrames,
}: {
	readonly document: SceneDocument;
	readonly primaryNodeId: string | null;
	readonly track: AutomationTrack;
	readonly trackIndex: number;
	readonly trackCount: number;
	readonly currentFrame: number;
	readonly durationFrames: number;
}) {
	const commit = (next: AutomationTrack): boolean => {
		useMotionStore.getState().apply(updateAutomationTrack(trackIndex, next));
		return true;
	};
	const binding = track.binding;
	const target =
		binding.channel === "effectParam" || binding.channel === "transform"
			? binding.target
			: null;
	const setTarget = (next: EffectTargetRef): boolean => {
		if (binding.channel === "effectParam") {
			return commit({ ...track, binding: { ...binding, target: next } });
		} else if (binding.channel === "transform") {
			return commit({ ...track, binding: { ...binding, target: next } });
		}
		return false;
	};
	const targetOptions =
		target?.scope === "layer"
			? document.layers.map((layer) => ({ value: layer.id, label: layer.name }))
			: allNodes(document).map((node) => ({
					value: node.id,
					label: node.name,
				}));
	const keyframes = [...track.keyframes].sort(
		(left, right) => left.frame - right.frame,
	);
	const replaceKeyframe = (
		keyIndex: number,
		patch: Partial<(typeof keyframes)[number]>,
	): boolean => {
		const next = keyframes
			.map((keyframe, index) =>
				index === keyIndex ? { ...keyframe, ...patch } : keyframe,
			)
			.sort((left, right) => left.frame - right.frame);
		if (new Set(next.map((keyframe) => keyframe.frame)).size !== next.length) {
			return false;
		}
		commit({ ...track, keyframes: next });
		return true;
	};

	return (
		<div className="space-y-1.5 rounded-md border border-white/8 bg-black/15 p-1.5">
			<div className="flex items-end gap-1">
				<div className="min-w-0 flex-1 text-fg-secondary text-ui">
					Automation track {trackIndex + 1}
				</div>
				<InspectorIconButton
					label="Move automation track earlier"
					disabled={trackIndex === 0}
					onClick={() =>
						useMotionStore
							.getState()
							.apply(reorderAutomationTrack(trackIndex, trackIndex - 1))
					}
				>
					<CaretUp aria-hidden="true" size={11} />
				</InspectorIconButton>
				<InspectorIconButton
					label="Move automation track later"
					disabled={trackIndex === trackCount - 1}
					onClick={() =>
						useMotionStore
							.getState()
							.apply(reorderAutomationTrack(trackIndex, trackIndex + 1))
					}
				>
					<CaretDown aria-hidden="true" size={11} />
				</InspectorIconButton>
				<InspectorIconButton
					label="Remove automation track"
					tone="danger"
					onClick={() =>
						useMotionStore.getState().apply(removeAutomationTrack(trackIndex))
					}
				>
					<Trash aria-hidden="true" size={11} />
				</InspectorIconButton>
			</div>
			<div className="grid grid-cols-2 gap-1">
				<SelectField
					label="Channel"
					value={binding.channel}
					options={AUTOMATION_CHANNEL_OPTIONS}
					resetKey={`automation:${trackIndex}:channel`}
					onCommit={(channel) =>
						commit({
							...track,
							binding: defaultAutomationBinding(
								channel,
								document,
								primaryNodeId,
							),
						})
					}
				/>
				<SelectField
					label="Mode"
					value={track.mode ?? "additive"}
					options={AUTOMATION_MODE_OPTIONS}
					resetKey={`automation:${trackIndex}:mode`}
					onCommit={(mode) => commit({ ...track, mode })}
				/>
			</div>
			{binding.channel === "effectInfluence" ? (
				<div className="grid grid-cols-2 gap-1">
					<TextInputField
						label="Assignment"
						value={binding.assignmentId}
						resetKey={`automation:${trackIndex}:assignment`}
						onCommit={(assignmentId) => {
							if (!assignmentId.trim()) return false;
							commit({
								...track,
								binding: { ...binding, assignmentId: assignmentId.trim() },
							});
							return true;
						}}
					/>
					<TextInputField
						label="Influence path"
						value={binding.path}
						resetKey={`automation:${trackIndex}:path`}
						onCommit={(path) => {
							if (!path.trim()) return false;
							commit({ ...track, binding: { ...binding, path: path.trim() } });
							return true;
						}}
					/>
				</div>
			) : null}
			{target ? (
				<div className="grid grid-cols-2 gap-1">
					<SelectField
						label="Target scope"
						value={target.scope}
						options={AUTOMATION_TARGET_SCOPE_OPTIONS}
						resetKey={`automation:${trackIndex}:scope`}
						onCommit={(scope) =>
							setTarget(
								automationTargetForScope(
									scope,
									document,
									primaryNodeId,
									target,
								),
							)
						}
					/>
					{target.scope === "object" ||
					target.scope === "group" ||
					target.scope === "layer" ? (
						<SelectField
							label="Target"
							value={target.id ?? ""}
							options={targetOptions}
							resetKey={`automation:${trackIndex}:target`}
							onCommit={(id) => setTarget({ ...target, id })}
						/>
					) : null}
				</div>
			) : null}
			{binding.channel === "effectParam" ? (
				<div className="grid grid-cols-2 gap-1">
					<TextInputField
						label="Effect id"
						value={binding.effect.id}
						resetKey={`automation:${trackIndex}:effect-id`}
						onCommit={(id) => {
							if (!id.trim()) return false;
							commit({
								...track,
								binding: {
									...binding,
									effect: { ...binding.effect, id: id.trim() },
								},
							});
							return true;
						}}
					/>
					<TextInputField
						label="Effect slot path"
						value={binding.effect.path}
						resetKey={`automation:${trackIndex}:effect-path`}
						onCommit={(path) => {
							if (!path.trim()) return false;
							commit({
								...track,
								binding: {
									...binding,
									effect: { ...binding.effect, path: path.trim() },
								},
							});
							return true;
						}}
					/>
					<TextInputField
						label="Effect label"
						value={binding.effect.label ?? ""}
						resetKey={`automation:${trackIndex}:effect-label`}
						onCommit={(label) => {
							const { label: _label, ...withoutLabel } = binding.effect;
							commit({
								...track,
								binding: {
									...binding,
									effect: label.trim()
										? { ...withoutLabel, label: label.trim() }
										: withoutLabel,
								},
							});
							return true;
						}}
					/>
					<TextInputField
						label="Parameter path"
						value={binding.path}
						resetKey={`automation:${trackIndex}:parameter-path`}
						onCommit={(path) => {
							if (!path.trim()) return false;
							commit({ ...track, binding: { ...binding, path: path.trim() } });
							return true;
						}}
					/>
				</div>
			) : null}
			{binding.channel === "transform" ? (
				<>
					<TextInputField
						label="Transform path"
						value={binding.path}
						resetKey={`automation:${trackIndex}:transform-path`}
						onCommit={(path) => {
							if (!path.trim()) return false;
							commit({ ...track, binding: { ...binding, path: path.trim() } });
							return true;
						}}
					/>
					<div className="rounded border border-white/12 bg-black/20 px-1.5 py-1 text-fg-muted text-ui">
						Transform automation is preserved, but the presentation bridge
						reports it as unsupported instead of mixing it with VMA transform
						tracks.
					</div>
				</>
			) : null}
			<div className="space-y-1">
				<div className="flex items-center justify-between text-fg-muted text-ui">
					<span>Keys ({keyframes.length})</span>
					<InspectorIconButton
						label={`Add automation key at frame ${currentFrame}`}
						disabled={keyframes.some(
							(keyframe) => keyframe.frame === currentFrame,
						)}
						onClick={() =>
							commit({
								...track,
								keyframes: [
									...keyframes,
									{
										frame: currentFrame,
										value: keyframes.at(-1)?.value ?? 0,
										easing: "linear" as const,
									},
								].sort((left, right) => left.frame - right.frame),
							})
						}
					>
						<Plus aria-hidden="true" size={11} />
					</InspectorIconButton>
				</div>
				{keyframes.map((keyframe, keyIndex) => (
					<div
						key={keyframe.frame}
						className="grid grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] items-end gap-1"
					>
						<NumericField
							label="Frame"
							value={keyframe.frame}
							resetKey={`automation:${trackIndex}:key:${keyIndex}:frame`}
							onCommit={(frame) =>
								replaceKeyframe(keyIndex, {
									frame: Math.min(
										Math.max(0, durationFrames - 1),
										Math.max(0, Math.round(frame)),
									),
								})
							}
						/>
						<NumericField
							label="Value"
							value={keyframe.value}
							resetKey={`automation:${trackIndex}:key:${keyIndex}:value`}
							onCommit={(value) => replaceKeyframe(keyIndex, { value })}
						/>
						<SelectField
							label="Ease"
							value={keyframe.easing ?? "linear"}
							options={AUTOMATION_EASING_OPTIONS}
							resetKey={`automation:${trackIndex}:key:${keyIndex}:ease`}
							onCommit={(easing) => replaceKeyframe(keyIndex, { easing })}
						/>
						<InspectorIconButton
							label={`Remove automation key at frame ${keyframe.frame}`}
							disabled={keyframes.length === 1}
							tone="danger"
							onClick={() =>
								commit({
									...track,
									keyframes: keyframes.filter(
										(_candidate, index) => index !== keyIndex,
									),
								})
							}
						>
							<Trash aria-hidden="true" size={11} />
						</InspectorIconButton>
					</div>
				))}
			</div>
		</div>
	);
}

function AutomationSection({
	document,
	primaryNodeId,
}: {
	readonly document: SceneDocument;
	readonly primaryNodeId: string | null;
}) {
	const motion = useMotionStore((state) => state.document);
	const transportFrame = useTransportStore((state) => state.currentFrame);
	const currentFrame = Math.min(
		Math.max(0, Math.round(transportFrame)),
		Math.max(0, motion.durationFrames - 1),
	);
	const automation = motion.automation;
	return (
		<PanelSection
			title="Automation"
			icon={<MagicWand aria-hidden="true" size={12} />}
			action={
				automation ? (
					<div className="flex items-center gap-1">
						<button
							type="button"
							aria-pressed={automation.enabled}
							className={cn(
								TEXT_MOTION_BUTTON,
								automation.enabled && TEXT_MOTION_BUTTON_ACTIVE,
							)}
							onClick={() =>
								useMotionStore
									.getState()
									.apply(setAutomationEnabled(!automation.enabled))
							}
						>
							{automation.enabled ? "On" : "Off"}
						</button>
						<InspectorIconButton
							label="Remove complete automation recipe"
							tone="danger"
							onClick={() =>
								useMotionStore.getState().apply(removeAutomationRecipe())
							}
						>
							<Trash aria-hidden="true" size={11} />
						</InspectorIconButton>
					</div>
				) : undefined
			}
		>
			<div className="space-y-1.5">
				{automation?.tracks.map((track, trackIndex) => (
					<AutomationTrackEditor
						// biome-ignore lint/suspicious/noArrayIndexKey: AutomationTrack has no id and every durable command addresses this stack by index.
						key={`automation-track:${trackIndex}`}
						document={document}
						primaryNodeId={primaryNodeId}
						track={track}
						trackIndex={trackIndex}
						trackCount={automation.tracks.length}
						currentFrame={currentFrame}
						durationFrames={motion.durationFrames}
					/>
				))}
				<button
					type="button"
					className={cn(TEXT_MOTION_BUTTON, "w-full")}
					onClick={() =>
						useMotionStore.getState().apply(
							createAutomationTrack({
								binding: defaultAutomationBinding(
									"effectParam",
									document,
									primaryNodeId,
								),
								mode: "replace",
								keyframes: [
									{ frame: currentFrame, value: 1, easing: "linear" },
								],
							}),
						)
					}
				>
					Add automation track
				</button>
				{automation ? (
					<div className="text-fg-subtle text-ui">
						{automation.fps} fps · {automation.durationFrames} frames · timing
						follows the document command.
					</div>
				) : null}
			</div>
		</PanelSection>
	);
}

const INTERACTION_TRIGGER_OPTIONS = [
	{ value: "click", label: "Click" },
	{ value: "hover-in", label: "Hover in" },
	{ value: "hover-out", label: "Hover out" },
	{ value: "in-view", label: "In view" },
	{ value: "scroll-progress", label: "Scroll progress" },
] as const satisfies readonly {
	readonly value: InteractionTriggerKind;
	readonly label: string;
}[];

const INTERACTION_ACTION_OPTIONS = [
	{ value: "pause", label: "Pause" },
	{ value: "resume", label: "Resume" },
	{ value: "play-clip", label: "Play clip" },
	{ value: "toggle-clip", label: "Toggle clip" },
	{ value: "seek", label: "Seek" },
	{ value: "set-prop", label: "Set component prop" },
] as const satisfies readonly {
	readonly value: InteractionActionKind;
	readonly label: string;
}[];

const defaultInteractionAction = (
	kind: InteractionActionKind,
	motion: MotionDocument,
	document: SceneDocument,
): InteractionAction => {
	if (kind === "play-clip") {
		return { kind, clipId: motion.clips[0]?.id ?? "" };
	}
	if (kind === "toggle-clip") {
		return { kind, clipId: motion.clips[0]?.id ?? "" };
	}
	if (kind === "seek") return { kind, progress: 0 };
	if (kind === "set-prop") {
		const prop = readComponentProps(document)[0];
		return {
			kind,
			propName: prop?.name ?? "",
			value: prop?.defaultValue.value ?? "",
		};
	}
	return { kind };
};

const updateInteraction = (
	interactionId: string,
	patch: Parameters<typeof createUpdateInteractionCommand>[1],
): boolean => {
	useSceneStore
		.getState()
		.apply(createUpdateInteractionCommand(interactionId, patch));
	return true;
};

function InteractionActionEditor({
	document,
	motion,
	interaction,
	action,
	actionIndex,
}: {
	readonly document: SceneDocument;
	readonly motion: MotionDocument;
	readonly interaction: InteractionDefinition;
	readonly action: InteractionAction;
	readonly actionIndex: number;
}) {
	const replaceAction = (nextAction: InteractionAction): boolean => {
		const actions = interaction.actions.map((candidate, index) =>
			index === actionIndex ? nextAction : candidate,
		);
		return updateInteraction(interaction.id, { actions });
	};
	const moveAction = (offset: -1 | 1): void => {
		const toIndex = actionIndex + offset;
		if (toIndex < 0 || toIndex >= interaction.actions.length) return;
		const actions = [...interaction.actions];
		const [moving] = actions.splice(actionIndex, 1);
		if (!moving) return;
		actions.splice(toIndex, 0, moving);
		updateInteraction(interaction.id, { actions });
	};
	const scrollProgress = interaction.trigger.kind === "scroll-progress";
	const actionOptions = scrollProgress
		? INTERACTION_ACTION_OPTIONS.filter(
				(option) => option.value === "seek" || option.value === "play-clip",
			)
		: INTERACTION_ACTION_OPTIONS;
	const resolvedProp =
		action.kind === "set-prop"
			? readComponentProps(document).find(
					(prop) => prop.name === action.propName,
				)
			: undefined;

	return (
		<div className="space-y-1 rounded-md border border-white/8 bg-black/15 p-1.5">
			<div className="flex items-end gap-1">
				<div className="min-w-0 flex-1">
					<SelectField
						label={`Action ${actionIndex + 1}`}
						value={action.kind}
						options={actionOptions}
						resetKey={`${interaction.id}:action:${actionIndex}:kind`}
						onCommit={(kind) =>
							replaceAction(defaultInteractionAction(kind, motion, document))
						}
					/>
				</div>
				<InspectorIconButton
					label="Move action earlier"
					disabled={actionIndex === 0}
					onClick={() => moveAction(-1)}
				>
					<CaretUp aria-hidden="true" size={11} />
				</InspectorIconButton>
				<InspectorIconButton
					label="Move action later"
					disabled={actionIndex === interaction.actions.length - 1}
					onClick={() => moveAction(1)}
				>
					<CaretDown aria-hidden="true" size={11} />
				</InspectorIconButton>
				<InspectorIconButton
					label="Remove action"
					disabled={interaction.actions.length === 1}
					tone="danger"
					onClick={() =>
						updateInteraction(interaction.id, {
							actions: interaction.actions.filter(
								(_candidate, index) => index !== actionIndex,
							),
						})
					}
				>
					<Trash aria-hidden="true" size={11} />
				</InspectorIconButton>
			</div>

			{action.kind === "play-clip" || action.kind === "toggle-clip" ? (
				<>
					<TextInputField
						label="Clip id"
						value={action.clipId}
						resetKey={`${interaction.id}:action:${actionIndex}:clip`}
						onCommit={(clipId) => replaceAction({ ...action, clipId })}
					/>
					<button
						type="button"
						aria-pressed={action.loop === true}
						className={cn(
							TEXT_MOTION_BUTTON,
							"w-full",
							action.loop && "border-accent/60 text-accent-fg",
						)}
						onClick={() => replaceAction({ ...action, loop: !action.loop })}
					>
						Loop {action.loop ? "on" : "off"}
					</button>
					{action.kind === "play-clip" ? (
						<div className="grid grid-cols-2 gap-1">
							<SelectField
								label="Direction"
								value={action.direction ?? "forward"}
								options={[
									{ value: "forward", label: "Forward" },
									{ value: "reverse", label: "Reverse" },
								]}
								resetKey={`${interaction.id}:action:${actionIndex}:direction`}
								onCommit={(direction) =>
									replaceAction({ ...action, direction })
								}
							/>
							<SelectField
								label="At end"
								value={action.then ?? "hold"}
								options={[
									{ value: "hold", label: "Hold" },
									{ value: "reset", label: "Reset" },
								]}
								resetKey={`${interaction.id}:action:${actionIndex}:then`}
								onCommit={(then) => replaceAction({ ...action, then })}
							/>
						</div>
					) : null}
				</>
			) : null}

			{action.kind === "seek" ? (
				<div className="grid grid-cols-2 gap-1">
					<SelectField
						label="Seek by"
						value={action.frame !== undefined ? "frame" : "progress"}
						options={
							scrollProgress
								? [{ value: "progress", label: "Progress" }]
								: [
										{ value: "progress", label: "Progress" },
										{ value: "frame", label: "Frame" },
									]
						}
						resetKey={`${interaction.id}:action:${actionIndex}:seek-mode`}
						onCommit={(mode) =>
							replaceAction(
								mode === "frame"
									? { kind: "seek", frame: 0 }
									: { kind: "seek", progress: 0 },
							)
						}
					/>
					<NumericField
						label={action.frame !== undefined ? "Frame" : "Progress"}
						value={action.frame ?? action.progress ?? 0}
						resetKey={`${interaction.id}:action:${actionIndex}:seek-value`}
						step={action.frame !== undefined ? "1" : "0.05"}
						onCommit={(value) =>
							replaceAction(
								action.frame !== undefined
									? { kind: "seek", frame: Math.max(0, value) }
									: {
											kind: "seek",
											progress: Math.max(0, Math.min(1, value)),
										},
							)
						}
					/>
				</div>
			) : null}

			{action.kind === "set-prop" ? (
				<div className="space-y-1">
					<TextInputField
						label="Prop name"
						value={action.propName}
						resetKey={`${interaction.id}:action:${actionIndex}:prop-name`}
						onCommit={(propName) => replaceAction({ ...action, propName })}
					/>
					{resolvedProp?.type === "number" ? (
						<NumericField
							label="Value"
							value={typeof action.value === "number" ? action.value : 0}
							resetKey={`${interaction.id}:action:${actionIndex}:prop-value`}
							step={String(resolvedProp.step ?? 1)}
							onCommit={(value) => replaceAction({ ...action, value })}
						/>
					) : resolvedProp?.type === "color" ? (
						<ColorField
							label="Value"
							value={typeof action.value === "string" ? action.value : "none"}
							resetKey={`${interaction.id}:action:${actionIndex}:prop-value`}
							onCommit={(value) => replaceAction({ ...action, value })}
						/>
					) : (
						<TextInputField
							label="Value"
							value={String(action.value)}
							resetKey={`${interaction.id}:action:${actionIndex}:prop-value`}
							onCommit={(value) => replaceAction({ ...action, value })}
						/>
					)}
				</div>
			) : null}
		</div>
	);
}

/** Complete semantic interaction lifecycle through the Scene command bus. */
function InteractionsSection({
	document,
	motion,
	primaryNodeId,
}: {
	readonly document: SceneDocument;
	readonly motion: MotionDocument;
	readonly primaryNodeId: string | null;
}) {
	const interactions = readInteractions(document);
	const nodes = allNodes(document);
	const nextOrdinal = interactions.length + 1;
	return (
		<PanelSection
			title={`Interactions${interactions.length > 0 ? ` (${interactions.length})` : ""}`}
			icon={<CursorClick aria-hidden="true" size={12} />}
			action={
				<InspectorIconButton
					label={
						primaryNodeId
							? "Add interaction for selected node"
							: "Add component interaction"
					}
					onClick={() =>
						useSceneStore.getState().apply(
							createAddInteractionCommand({
								name: `Interaction ${nextOrdinal}`,
								trigger: {
									kind: "click",
									...(primaryNodeId ? { nodeId: primaryNodeId } : {}),
								},
								actions: [{ kind: "pause" }],
							}),
						)
					}
				>
					<Plus aria-hidden="true" size={11} />
				</InspectorIconButton>
			}
		>
			<div className="space-y-1.5">
				{interactions.length === 0 ? (
					<p className="px-0.5 py-1 text-fg-subtle text-ui leading-4">
						No interactions. Add one for the component or selected node.
					</p>
				) : null}
				{interactions.map((interaction) => (
					<div
						key={interaction.id}
						className="space-y-1 rounded-md border border-white/8 bg-black/15 p-1.5"
					>
						<div className="flex items-end gap-1">
							<div className="min-w-0 flex-1">
								<TextInputField
									label="Name"
									value={interaction.name ?? ""}
									resetKey={`${interaction.id}:name`}
									onCommit={(name) =>
										updateInteraction(interaction.id, { name })
									}
								/>
							</div>
							<InspectorIconButton
								label={`Remove interaction "${interaction.name ?? interaction.id}"`}
								tone="danger"
								onClick={() =>
									useSceneStore
										.getState()
										.apply(createRemoveInteractionCommand(interaction.id))
								}
							>
								<Trash aria-hidden="true" size={11} />
							</InspectorIconButton>
						</div>
						<div className="grid grid-cols-2 gap-1">
							<SelectField
								label="Trigger"
								value={interaction.trigger.kind}
								options={INTERACTION_TRIGGER_OPTIONS}
								resetKey={`${interaction.id}:trigger-kind`}
								onCommit={(kind) =>
									updateInteraction(interaction.id, {
										trigger: {
											kind,
											...(interaction.trigger.nodeId
												? { nodeId: interaction.trigger.nodeId }
												: {}),
											...(kind === "in-view"
												? { threshold: interaction.trigger.threshold ?? 0.5 }
												: {}),
										},
										...(kind === "scroll-progress"
											? { actions: [{ kind: "seek", progress: 0 }] }
											: {}),
									})
								}
							/>
							<SelectField
								label="Target"
								value={interaction.trigger.nodeId ?? "__component__"}
								options={[
									{ value: "__component__", label: "Component" },
									...nodes.map((node) => ({
										value: node.id,
										label: node.name,
									})),
								]}
								resetKey={`${interaction.id}:trigger-target`}
								onCommit={(target) => {
									const trigger: InteractionTrigger = {
										kind: interaction.trigger.kind,
										...(target === "__component__" ? {} : { nodeId: target }),
										...(interaction.trigger.kind === "in-view"
											? { threshold: interaction.trigger.threshold ?? 0.5 }
											: {}),
									};
									return updateInteraction(interaction.id, { trigger });
								}}
							/>
						</div>
						{interaction.trigger.kind === "in-view" ? (
							<NumericField
								label="Visibility threshold"
								value={interaction.trigger.threshold ?? 0.5}
								resetKey={`${interaction.id}:trigger-threshold`}
								step="0.05"
								onCommit={(threshold) =>
									updateInteraction(interaction.id, {
										trigger: {
											...interaction.trigger,
											threshold: Math.max(0, Math.min(1, threshold)),
										},
									})
								}
							/>
						) : null}
						<div className="text-fg-muted text-ui">
							{interactionTriggerSummary(document, interaction.trigger)} →{" "}
							{interactionActionsSummary(interaction.actions)}
						</div>
						{interaction.actions.map((action, actionIndex) => (
							<InteractionActionEditor
								// biome-ignore lint/suspicious/noArrayIndexKey: InteractionAction has no id and mutations address the ordered action list by index.
								key={`${interaction.id}:${actionIndex}`}
								document={document}
								motion={motion}
								interaction={interaction}
								action={action}
								actionIndex={actionIndex}
							/>
						))}
						<button
							type="button"
							disabled={interaction.trigger.kind === "scroll-progress"}
							className={cn(
								TEXT_MOTION_BUTTON,
								"w-full",
								interaction.trigger.kind === "scroll-progress" && "opacity-50",
							)}
							onClick={() =>
								updateInteraction(interaction.id, {
									actions: [...interaction.actions, { kind: "pause" }],
								})
							}
						>
							Add action
						</button>
					</div>
				))}
			</div>
		</PanelSection>
	);
}

/** Frozen Arrangement A/B seat capture, recapture, rename, and removal UI. */
function ArrangementSnapshotsSection({
	document,
	nodeIds,
}: {
	readonly document: SceneDocument;
	readonly nodeIds: readonly string[];
}) {
	const snapshots = listArrangementLayoutSnapshots(document);
	const selectedArtboardId = nodeIds[0]
		? selectArtboardIdForNode(document, nodeIds[0])
		: null;
	const selectionIsCapturable =
		nodeIds.length > 0 &&
		selectedArtboardId !== null &&
		nodeIds.every(
			(nodeId) =>
				isTopLevelSceneNode(document, nodeId) &&
				selectArtboardIdForNode(document, nodeId) === selectedArtboardId,
		);
	const capture = (): void => {
		if (!selectionIsCapturable || !selectedArtboardId) return;
		const ordinal = snapshots.length + 1;
		useSceneStore.getState().apply(
			createCaptureArrangementLayoutSnapshotCommand({
				snapshotId: createId("arrangement"),
				name: `Layout ${ordinal}`,
				artboardId: selectedArtboardId,
				nodeIds,
				captureToken: createId("arrangement-capture"),
			}),
		);
	};
	return (
		<PanelSection
			title={`Arrangement layouts${snapshots.length > 0 ? ` (${snapshots.length})` : ""}`}
			icon={<GridFour aria-hidden="true" size={12} />}
			action={
				<InspectorIconButton
					label={
						selectionIsCapturable
							? "Capture selected node positions"
							: "Select top-level nodes on one artboard to capture"
					}
					disabled={!selectionIsCapturable}
					onClick={capture}
				>
					<FloppyDisk aria-hidden="true" size={11} />
				</InspectorIconButton>
			}
		>
			{snapshots.length === 0 ? (
				<p className="px-0.5 py-1 text-fg-subtle text-ui leading-4">
					No saved layouts. Select top-level nodes to freeze their seats.
				</p>
			) : (
				<div className="space-y-1">
					{snapshots.map(({ snapshot, status, reasons }) => {
						const selectedMembersValid =
							selectionIsCapturable &&
							selectedArtboardId === snapshot.artboardId;
						const recaptureNodeIds = selectedMembersValid
							? nodeIds
							: snapshot.memberNodeIds;
						const recapture = (): void => {
							useSceneStore.getState().apply(
								createRecaptureArrangementLayoutSnapshotCommand({
									snapshotId: snapshot.id,
									nodeIds: recaptureNodeIds,
									captureToken: createId("arrangement-capture"),
								}),
							);
						};
						return (
							<div
								key={snapshot.id}
								className="space-y-1 rounded-md border border-white/8 bg-black/15 p-1.5"
							>
								<div className="flex items-end gap-1">
									<div className="min-w-0 flex-1">
										<TextInputField
											label="Name"
											value={snapshot.name}
											resetKey={`${snapshot.id}:name:${snapshot.captureToken}`}
											onCommit={(name) => {
												useSceneStore
													.getState()
													.apply(
														createRenameArrangementLayoutSnapshotCommand(
															snapshot.id,
															name,
														),
													);
												return true;
											}}
										/>
									</div>
									<InspectorIconButton
										label={
											selectedMembersValid
												? "Recapture from current selection"
												: "Recapture saved members"
										}
										onClick={recapture}
									>
										<ArrowClockwise aria-hidden="true" size={11} />
									</InspectorIconButton>
									<InspectorIconButton
										label={`Remove ${snapshot.name}`}
										tone="danger"
										onClick={() =>
											useSceneStore
												.getState()
												.apply(
													createRemoveArrangementLayoutSnapshotCommand(
														snapshot.id,
													),
												)
										}
									>
										<Trash aria-hidden="true" size={11} />
									</InspectorIconButton>
								</div>
								<div className="flex items-center justify-between gap-2 text-fg-muted text-ui">
									<span>{snapshot.memberNodeIds.length} members</span>
									<span
										className={
											status === "valid" ? "text-accent-fg" : "text-danger-fg"
										}
									>
										{status}
									</span>
								</div>
								{reasons[0] ? (
									<p className="text-danger-fg text-ui leading-4">
										{reasons[0]}
									</p>
								) : null}
							</div>
						);
					})}
				</div>
			)}
		</PanelSection>
	);
}

const SHARED_NUMBER_LABELS: Readonly<Record<SharedNumberPropertyId, string>> = {
	"transform.rotation": "Rotation",
	"style.opacity": "Opacity",
};

const nextSharedTextName = (document: SceneDocument): string => {
	const names = new Set(readComponentProps(document).map((prop) => prop.name));
	let index = 1;
	while (names.has(index === 1 ? "sharedText" : `sharedText${index}`))
		index += 1;
	return index === 1 ? "sharedText" : `sharedText${index}`;
};

/** Authors and manages text-content component props for selected text nodes. */
function SharedTextsSection({
	document,
	nodeIds,
}: {
	readonly document: SceneDocument;
	readonly nodeIds: readonly string[];
}) {
	const allProps = readComponentProps(document);
	const props = allProps.filter((prop) => prop.type === "text");
	const selectedTextNodes = [...new Set(nodeIds)].flatMap((nodeId) => {
		const node = findNode(document, nodeId);
		return node?.geometry.kind === "text" ? [node] : [];
	});
	const selectedValue = selectedTextNodes[0]?.geometry;
	const matchingText =
		selectedValue?.kind === "text" &&
		selectedTextNodes.every(
			(node) =>
				node.geometry.kind === "text" &&
				node.geometry.text === selectedValue.text,
		);
	const ownedNodeIds = new Set(
		allProps.flatMap((prop) =>
			prop.bindings.flatMap((binding) =>
				binding.kind === "text-content" ? [binding.nodeId] : [],
			),
		),
	);
	const canCreate =
		selectedTextNodes.length > 0 &&
		matchingText &&
		selectedTextNodes.every((node) => !ownedNodeIds.has(node.id));
	if (props.length === 0 && selectedTextNodes.length === 0) return null;

	const createSharedText = (): void => {
		if (!canCreate || selectedValue?.kind !== "text") return;
		const bindings = selectedTextNodes.map(
			(node) =>
				({
					kind: "text-content",
					nodeId: node.id,
				}) as const satisfies ComponentPropBindingTextContent,
		);
		useSceneStore.getState().apply(
			createAddComponentPropCommand({
				name: nextSharedTextName(document),
				type: "text",
				defaultValue: { type: "text", value: selectedValue.text },
				bindings,
			}),
		);
	};

	return (
		<PanelSection
			title="Shared text"
			icon={<TextT aria-hidden="true" size={12} />}
		>
			<button
				type="button"
				className={cn(
					TEXT_MOTION_BUTTON,
					!canCreate && "cursor-not-allowed opacity-40",
				)}
				aria-disabled={!canCreate}
				title={
					canCreate
						? undefined
						: "Select unbound text nodes with matching content."
				}
				onClick={createSharedText}
			>
				+ Text content
			</button>
			{props.length > 0 ? (
				<div className="mt-1.5 space-y-1.5">
					{props.map((prop) => {
						const bindings = prop.bindings.filter(
							(binding): binding is ComponentPropBindingTextContent =>
								binding.kind === "text-content",
						);
						const available =
							bindings.length > 0 &&
							bindings.length === prop.bindings.length &&
							bindings.every(
								(binding) =>
									findNode(document, binding.nodeId)?.geometry.kind === "text",
							);
						const interactionUses = componentPropInteractionUseCount(
							document,
							prop.name,
						);
						return (
							<div
								key={prop.id}
								className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-1"
							>
								<TextInputField
									label={`${prop.name} · ${bindings.length} ${bindings.length === 1 ? "use" : "uses"}`}
									value={
										prop.defaultValue.type === "text"
											? prop.defaultValue.value
											: null
									}
									resetKey={`${document.id}:shared-text:${prop.id}`}
									disabled={!available}
									onCommit={(value) => {
										const before = useSceneStore.getState().document;
										useSceneStore.getState().apply(
											createSetTextComponentPropCommand(prop.id, value, {
												coalesceKey: `shared-text:${prop.id}`,
											}),
										);
										return useSceneStore.getState().document !== before;
									}}
								/>
								<InspectorIconButton
									label={
										interactionUses > 0
											? `Cannot remove ${prop.name}; used by interactions`
											: `Remove shared text ${prop.name}`
									}
									disabled={interactionUses > 0}
									tone="danger"
									onClick={() =>
										useSceneStore
											.getState()
											.apply(createRemoveComponentPropCommand(prop.id))
									}
								>
									<Trash aria-hidden="true" size={11} />
								</InspectorIconButton>
								{available ? null : (
									<div className="col-span-2 text-fg-muted text-ui">
										Text targets are missing or incompatible.
									</div>
								)}
							</div>
						);
					})}
				</div>
			) : null}
		</PanelSection>
	);
}

const nextAdvancedPropName = (
	document: SceneDocument,
	type: ComponentPropType,
): string => {
	const root =
		type === "number" ? "value" : type === "color" ? "color" : "text";
	const names = new Set(readComponentProps(document).map((prop) => prop.name));
	let index = 1;
	while (names.has(index === 1 ? root : `${root}${index}`)) index += 1;
	return index === 1 ? root : `${root}${index}`;
};

const bindingLabel = (binding: ComponentPropBinding): string => {
	switch (binding.kind) {
		case "bindable":
			return `${binding.nodeId} · ${binding.propertyId}`;
		case "style-color":
			return `${binding.nodeId} · ${binding.role} ${binding.paintIndex ?? 0}`;
		case "text-content":
			return `${binding.nodeId} · text`;
	}
};

/**
 * Descriptor-backed fallback for every component-prop type and binding. It is
 * intentionally compact; specialized Shared values/colors/text controls stay
 * the primary UX, while this section guarantees complete discovery and repair.
 */
function ComponentPropsAdvancedSection({
	document,
	motion,
	grammarTargetNodeIds,
	primaryNodeId,
}: {
	readonly document: SceneDocument;
	readonly motion: MotionDocument;
	readonly grammarTargetNodeIds: ReadonlySet<string>;
	readonly primaryNodeId: string | null;
}) {
	const props = readComponentProps(document);
	const primaryNode = primaryNodeId ? findNode(document, primaryNodeId) : null;
	const [numericPropertyByPropId, setNumericPropertyByPropId] = useState<
		Readonly<Record<string, string>>
	>({});
	if (props.length === 0 && !primaryNode) return null;

	const applyPatch = (
		prop: ComponentPropDefinition,
		patch: Parameters<typeof createUpdateComponentPropCommand>[1],
	): boolean => {
		const before = useSceneStore.getState().document;
		useSceneStore.getState().apply(
			createUpdateComponentPropCommand(prop.id, patch, {
				grammarTargetNodeIds,
				motion,
			}),
		);
		return useSceneStore.getState().document !== before;
	};

	const createEmptyProp = (type: ComponentPropType): void => {
		useSceneStore.getState().apply(
			createAddComponentPropCommand({
				name: nextAdvancedPropName(document, type),
				type,
				defaultValue:
					type === "number"
						? { type: "number", value: 0 }
						: type === "color"
							? { type: "color", value: "#ffffff" }
							: { type: "text", value: "" },
				bindings: [],
			}),
		);
	};

	return (
		<PanelSection title="Component props · Advanced" icon={<Code size={12} />}>
			<div className="grid grid-cols-3 gap-1">
				{(["number", "color", "text"] as const).map((type) => (
					<button
						key={type}
						type="button"
						className={TEXT_MOTION_BUTTON}
						onClick={() => createEmptyProp(type)}
					>
						+ {type}
					</button>
				))}
			</div>
			{props.length > 0 ? (
				<div className="mt-1.5 space-y-2">
					{props.map((prop) => {
						const numberOptions = primaryNode
							? bindablePropertiesForGeometryKind(
									primaryNode.geometry.kind,
								).filter(
									(descriptor) =>
										descriptor.targetScopes.includes("node") &&
										descriptor.control.valueKind === "number",
								)
							: [];
						const selectedPropertyId =
							numericPropertyByPropId[prop.id] ?? numberOptions[0]?.id ?? "";
						const candidateBinding: ComponentPropBinding | null = !primaryNode
							? null
							: prop.type === "number"
								? selectedPropertyId
									? {
											kind: "bindable",
											nodeId: primaryNode.id,
											propertyId: selectedPropertyId,
										}
									: null
								: prop.type === "text"
									? primaryNode.geometry.kind === "text"
										? { kind: "text-content", nodeId: primaryNode.id }
										: null
									: readAppearanceStack(primaryNode).fills[0]?.paint.kind ===
											"solid"
										? {
												kind: "style-color",
												nodeId: primaryNode.id,
												role: "fill",
												paintIndex: 0,
											}
										: null;
						const candidateIssue = candidateBinding
							? resolveComponentPropBindingIssue(
									prop.type,
									candidateBinding,
									(nodeId) => findNode(document, nodeId),
									motion,
								)
							: null;
						const alreadyBound = candidateBinding
							? prop.bindings.some(
									(binding) =>
										bindingLabel(binding) === bindingLabel(candidateBinding),
								)
							: false;
						return (
							<div
								key={prop.id}
								className="space-y-1 rounded border border-white/8 bg-black/12 p-1"
							>
								<TextInputField
									label={`${prop.type} name`}
									value={prop.name}
									resetKey={`${document.id}:component-prop-name:${prop.id}`}
									onCommit={(name) => applyPatch(prop, { name })}
								/>
								{prop.type === "number" ? (
									<NumericField
										label="Default"
										value={
											prop.defaultValue.type === "number"
												? prop.defaultValue.value
												: null
										}
										resetKey={`${document.id}:component-prop-default:${prop.id}`}
										onCommit={(value) =>
											applyPatch(prop, {
												defaultValue: { type: "number", value },
											})
										}
									/>
								) : prop.type === "color" ? (
									<ColorField
										label="Default"
										value={
											prop.defaultValue.type === "color"
												? prop.defaultValue.value
												: null
										}
										resetKey={`${document.id}:component-prop-default:${prop.id}`}
										onCommit={(value) =>
											applyPatch(prop, {
												defaultValue: { type: "color", value },
											})
										}
									/>
								) : (
									<TextInputField
										label="Default"
										value={
											prop.defaultValue.type === "text"
												? prop.defaultValue.value
												: null
										}
										resetKey={`${document.id}:component-prop-default:${prop.id}`}
										onCommit={(value) =>
											prop.bindings.length > 0
												? (() => {
														const before = useSceneStore.getState().document;
														useSceneStore
															.getState()
															.apply(
																createSetTextComponentPropCommand(
																	prop.id,
																	value,
																),
															);
														return useSceneStore.getState().document !== before;
													})()
												: applyPatch(prop, {
														defaultValue: { type: "text", value },
													})
										}
									/>
								)}
								{prop.type === "number" && numberOptions.length > 0 ? (
									<select
										value={selectedPropertyId}
										className="h-6 w-full rounded border border-white/10 bg-black/25 px-1 text-fg text-ui"
										onChange={(event) =>
											setNumericPropertyByPropId((current) => ({
												...current,
												[prop.id]: event.currentTarget.value,
											}))
										}
									>
										{numberOptions.map((descriptor) => (
											<option key={descriptor.id} value={descriptor.id}>
												{descriptor.label}
											</option>
										))}
									</select>
								) : null}
								<button
									type="button"
									className={cn(
										TEXT_MOTION_BUTTON,
										(!candidateBinding || candidateIssue || alreadyBound) &&
											"cursor-not-allowed opacity-40",
									)}
									aria-disabled={
										!candidateBinding || Boolean(candidateIssue) || alreadyBound
									}
									title={candidateIssue ? candidateIssue.kind : undefined}
									onClick={() => {
										if (!candidateBinding || candidateIssue || alreadyBound)
											return;
										applyPatch(prop, {
											bindings: [...prop.bindings, candidateBinding],
										});
									}}
								>
									+ Bind selected object
								</button>
								<div className="space-y-0.5">
									{prop.bindings.map((binding, bindingIndex) => (
										<div
											key={bindingLabel(binding)}
											className="flex items-center gap-1 rounded border border-white/8 px-1 text-ui"
										>
											<span className="min-w-0 flex-1 truncate text-fg-muted">
												{bindingLabel(binding)}
											</span>
											<InspectorIconButton
												label={`Remove binding ${bindingLabel(binding)}`}
												tone="danger"
												onClick={() =>
													applyPatch(prop, {
														bindings: prop.bindings.filter(
															(_, index) => index !== bindingIndex,
														),
													})
												}
											>
												<X size={10} />
											</InspectorIconButton>
										</div>
									))}
								</div>
							</div>
						);
					})}
				</div>
			) : null}
		</PanelSection>
	);
}

type SharedNumberCreationState =
	| {
			readonly available: true;
			readonly value: number;
			readonly bindings: readonly ComponentPropBindingBindable[];
	  }
	| { readonly available: false; readonly reason: string };

const sharedNumberCreationState = (
	document: SceneDocument,
	motion: MotionDocument,
	grammarTargetNodeIds: ReadonlySet<string>,
	nodeIds: readonly string[],
	propertyId: SharedNumberPropertyId,
): SharedNumberCreationState => {
	const uniqueNodeIds = [...new Set(nodeIds)];
	if (uniqueNodeIds.length === 0) {
		return { available: false, reason: "Select one or more objects." };
	}
	const bindings: ComponentPropBindingBindable[] = [];
	let value: number | undefined;
	for (const nodeId of uniqueNodeIds) {
		const binding = {
			kind: "bindable",
			nodeId,
			propertyId,
		} as const satisfies ComponentPropBindingBindable;
		const bindingIssue = resolveComponentPropBindingIssue(
			"number",
			binding,
			(id) => findNode(document, id),
			motion,
		);
		if (bindingIssue) {
			return {
				available: false,
				reason: sharedNumberBindingIssueReason(
					bindingIssue,
					propertyId,
					nodeId,
				),
			};
		}
		const conflicts = componentPropSharedNumberOwnershipConflicts(
			{
				componentProps: document.componentProps,
				layers: document.layers,
				nativeExpressionBindings: document.nativeExpressionBindings,
				grammarTargetNodeIds,
			},
			binding,
		);
		if (conflicts.length > 0) {
			return {
				available: false,
				reason: sharedNumberOwnershipReason(conflicts, propertyId, nodeId),
			};
		}
		const node = findNode(document, nodeId);
		const current = node ? sharedNumberBindingValue(node, binding) : null;
		if (current === null || !Number.isFinite(current)) {
			return {
				available: false,
				reason: `${SHARED_NUMBER_LABELS[propertyId]} has no finite value on ${nodeId}.`,
			};
		}
		if (!sharedNumberValueIsValid(propertyId, current)) {
			return {
				available: false,
				reason:
					propertyId === "style.opacity"
						? `Opacity on ${nodeId} must be between 0 and 1.`
						: `Rotation on ${nodeId} must be finite.`,
			};
		}
		if (value !== undefined && current !== value) {
			return {
				available: false,
				reason: `Selected ${SHARED_NUMBER_LABELS[propertyId].toLowerCase()} values must match before sharing.`,
			};
		}
		value = current;
		bindings.push(binding);
	}
	return value === undefined
		? { available: false, reason: "No eligible values were found." }
		: { available: true, value, bindings };
};

type SharedNumberPropStatus =
	| { readonly available: true; readonly propertyId: SharedNumberPropertyId }
	| {
			readonly available: false;
			readonly reason: string;
			readonly repairable: boolean;
			readonly propertyId?: SharedNumberPropertyId;
	  };

const sharedNumberPropStatus = (
	document: SceneDocument,
	motion: MotionDocument,
	grammarTargetNodeIds: ReadonlySet<string>,
	prop: ComponentPropDefinition,
): SharedNumberPropStatus => {
	const bindings = prop.bindings.filter(
		(binding): binding is ComponentPropBindingBindable =>
			binding.kind === "bindable",
	);
	const propertyId = bindings[0]?.propertyId;
	if (
		prop.type !== "number" ||
		bindings.length === 0 ||
		bindings.length !== prop.bindings.length ||
		!propertyId ||
		!isSharedNumberPropertyId(propertyId) ||
		bindings.some((binding) => binding.propertyId !== propertyId)
	) {
		return {
			available: false,
			reason: "Bindings must target only Rotation or only Opacity.",
			repairable: false,
		};
	}
	for (const binding of bindings) {
		const issue = resolveComponentPropBindingIssue(
			"number",
			binding,
			(nodeId) => findNode(document, nodeId),
			motion,
		);
		if (issue) {
			return {
				available: false,
				reason: sharedNumberBindingIssueReason(
					issue,
					propertyId,
					binding.nodeId,
				),
				repairable: false,
				propertyId,
			};
		}
		const owners = componentPropBindableTargetOwners(document, binding);
		const conflicts = componentPropSharedNumberOwnershipConflicts(
			{
				componentProps: document.componentProps,
				layers: document.layers,
				nativeExpressionBindings: document.nativeExpressionBindings,
				grammarTargetNodeIds,
			},
			binding,
			prop.id,
		);
		if (
			conflicts.length > 0 ||
			owners.length !== 1 ||
			owners[0]?.id !== prop.id
		) {
			return {
				available: false,
				reason:
					conflicts.length > 0
						? sharedNumberOwnershipReason(conflicts, propertyId, binding.nodeId)
						: `${SHARED_NUMBER_LABELS[propertyId]} on ${binding.nodeId} has invalid owner cardinality.`,
				repairable: false,
				propertyId,
			};
		}
	}
	const valueIssue = componentPropSharedNumberValueIssues(prop, (nodeId) =>
		findNode(document, nodeId),
	)[0];
	if (valueIssue) {
		return {
			available: false,
			reason:
				valueIssue.kind === "default-target-mismatch"
					? `Stored value (${valueIssue.expected}) differs from target ${valueIssue.binding.nodeId} (${valueIssue.actual}).`
					: valueIssue.kind === "range-contract-invalid"
						? "Stored min/max/step metadata does not match the native property contract."
						: propertyId === "style.opacity"
							? "Stored Opacity must be between 0 and 1."
							: "Stored Rotation must be finite.",
			repairable: valueIssue.kind === "default-target-mismatch",
			propertyId,
		};
	}
	return { available: true, propertyId };
};

const nextSharedNumberName = (
	document: SceneDocument,
	propertyId: SharedNumberPropertyId,
): string => {
	const root =
		propertyId === "transform.rotation" ? "sharedRotation" : "sharedOpacity";
	const names = new Set(readComponentProps(document).map((prop) => prop.name));
	let index = 1;
	while (names.has(index === 1 ? root : `${root}${index}`)) index += 1;
	return index === 1 ? root : `${root}${index}`;
};

/** Authors and manages native Rotation/Opacity component props. */
function SharedValuesSection({
	document,
	motion,
	grammarTargetNodeIds,
	nodeIds,
}: {
	readonly document: SceneDocument;
	readonly motion: MotionDocument;
	readonly grammarTargetNodeIds: ReadonlySet<string>;
	readonly nodeIds: readonly string[];
}) {
	const props = readComponentProps(document).filter(
		(prop) => prop.type === "number",
	);
	const creation = {
		"transform.rotation": sharedNumberCreationState(
			document,
			motion,
			grammarTargetNodeIds,
			nodeIds,
			"transform.rotation",
		),
		"style.opacity": sharedNumberCreationState(
			document,
			motion,
			grammarTargetNodeIds,
			nodeIds,
			"style.opacity",
		),
	} satisfies Readonly<
		Record<SharedNumberPropertyId, SharedNumberCreationState>
	>;
	const [pendingRemovalPropId, setPendingRemovalPropId] = useState<
		string | null
	>(null);
	const [removalBlockedMessage, setRemovalBlockedMessage] = useState<
		string | null
	>(null);
	const removalTriggerElements = useRef(new Map<string, HTMLButtonElement>());
	const removalReturnTargetRef = useRef<HTMLElement | null>(null);
	const pendingRemovalProp = props.find(
		(prop) => prop.id === pendingRemovalPropId,
	);
	if (props.length === 0 && nodeIds.length === 0) return null;

	const createSharedValue = (propertyId: SharedNumberPropertyId): void => {
		const state = creation[propertyId];
		if (!state.available) return;
		useSceneStore.getState().apply(
			createAddSharedNumberComponentPropCommand({
				name: nextSharedNumberName(document, propertyId),
				propertyId,
				value: state.value,
				bindings: state.bindings,
				grammarTargetNodeIds,
				motion,
			}),
		);
	};

	const commitSharedValue = (prop: ComponentPropDefinition, value: number) => {
		const status = sharedNumberPropStatus(
			document,
			motion,
			grammarTargetNodeIds,
			prop,
		);
		if (!status.available) return false;
		const before = useSceneStore.getState().document;
		useSceneStore.getState().apply(
			createSetSharedNumberComponentPropCommand(prop.id, value, {
				coalesceKey: `shared-value:${prop.id}`,
				grammarTargetNodeIds,
				motion,
			}),
		);
		return useSceneStore.getState().document !== before;
	};

	return (
		<>
			<PanelSection
				title="Shared values"
				icon={<SlidersHorizontal aria-hidden="true" size={12} />}
			>
				<div className="grid grid-cols-2 gap-1">
					{(
						[
							"transform.rotation",
							"style.opacity",
						] as const satisfies readonly SharedNumberPropertyId[]
					).map((propertyId) => {
						const state = creation[propertyId];
						return (
							<button
								key={propertyId}
								type="button"
								className={cn(
									TEXT_MOTION_BUTTON,
									!state.available && "cursor-not-allowed opacity-40",
								)}
								aria-disabled={!state.available}
								aria-describedby={
									state.available
										? undefined
										: `shared-number-create-reason-${propertyId.replace(".", "-")}`
								}
								title={state.available ? undefined : state.reason}
								onClick={() => createSharedValue(propertyId)}
							>
								+ {SHARED_NUMBER_LABELS[propertyId]}
							</button>
						);
					})}
				</div>
				<div className="mt-1 space-y-0.5 text-fg-muted text-ui">
					{(
						Object.entries(creation) as readonly [
							SharedNumberPropertyId,
							SharedNumberCreationState,
						][]
					).map(([propertyId, state]) =>
						state.available ? null : (
							<div
								key={propertyId}
								id={`shared-number-create-reason-${propertyId.replace(".", "-")}`}
							>
								{SHARED_NUMBER_LABELS[propertyId]}: {state.reason}
							</div>
						),
					)}
				</div>
				{props.length === 0 ? (
					<div className="mt-1.5 text-fg-muted text-ui">
						Share matching values across the current selection.
					</div>
				) : (
					<div className="mt-1.5 space-y-1.5">
						{props.map((prop) => {
							const status = sharedNumberPropStatus(
								document,
								motion,
								grammarTargetNodeIds,
								prop,
							);
							const propertyLabel = status.propertyId
								? status.propertyId === "style.opacity"
									? "Opacity 0–1"
									: SHARED_NUMBER_LABELS[status.propertyId]
								: "Value";
							const interactionUses = componentPropInteractionUseCount(
								document,
								prop.name,
							);
							return (
								<div
									key={prop.id}
									title={status.available ? undefined : status.reason}
									className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-1"
								>
									<NumericField
										label={`${prop.name} · ${propertyLabel} · ${prop.bindings.length} ${prop.bindings.length === 1 ? "use" : "uses"}${status.available ? "" : " · unavailable"}`}
										value={
											prop.defaultValue.type === "number"
												? prop.defaultValue.value
												: null
										}
										resetKey={`${document.id}:shared-value:${prop.id}`}
										step={
											status.propertyId === "style.opacity" ? "0.01" : "0.1"
										}
										disabled={!status.available}
										onCommit={(value) => commitSharedValue(prop, value)}
									/>
									<div className="flex items-end gap-1">
										{!status.available && status.repairable ? (
											<InspectorIconButton
												label={`Reapply ${prop.name} to every target`}
												onClick={() => {
													if (prop.defaultValue.type === "number")
														useSceneStore
															.getState()
															.apply(
																createSetSharedNumberComponentPropCommand(
																	prop.id,
																	prop.defaultValue.value,
																	{ grammarTargetNodeIds, motion },
																),
															);
												}}
											>
												<ArrowClockwise aria-hidden="true" size={11} />
											</InspectorIconButton>
										) : null}
										<InspectorIconButton
											label={
												interactionUses > 0
													? `Cannot remove ${prop.name}; used by ${interactionUses} interaction actions`
													: `Remove shared value ${prop.name}`
											}
											disabled={interactionUses > 0}
											tone="danger"
											buttonRef={(element) => {
												if (element)
													removalTriggerElements.current.set(prop.id, element);
												else removalTriggerElements.current.delete(prop.id);
											}}
											onClick={() => {
												removalReturnTargetRef.current =
													removalTriggerElements.current.get(prop.id) ?? null;
												setPendingRemovalPropId(prop.id);
											}}
										>
											<Trash aria-hidden="true" size={11} />
										</InspectorIconButton>
									</div>
									{status.available ? null : (
										<div className="col-span-2 text-fg-muted text-ui">
											{status.reason}
										</div>
									)}
								</div>
							);
						})}
					</div>
				)}
			</PanelSection>
			<Dialog.Root
				open={pendingRemovalProp !== undefined}
				onOpenChange={(open) => {
					if (!open) {
						setPendingRemovalPropId(null);
						setRemovalBlockedMessage(null);
					}
				}}
			>
				<Dialog.Portal>
					<Dialog.Backdrop className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
					<Dialog.Popup
						finalFocus={() =>
							removalReturnTargetRef.current?.isConnected
								? removalReturnTargetRef.current
								: (globalThis.document?.querySelector<HTMLElement>(
										"[data-inspector-focus-anchor]",
									) ?? null)
						}
						className="fixed left-1/2 top-1/2 z-50 flex w-[min(92vw,360px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-2 rounded-lg border border-white/12 bg-surface-raised/98 p-3 text-fg text-ui shadow-2xl shadow-black/60 outline-none backdrop-blur-xl"
					>
						<Dialog.Title className="font-medium text-fg text-ui">
							Remove shared value?
						</Dialog.Title>
						<Dialog.Description className="text-fg-secondary text-ui leading-4">
							Current Rotation/Opacity values will stay unchanged, but the
							exported prop will be removed.
						</Dialog.Description>
						{removalBlockedMessage ? (
							<div className="text-danger-fg text-ui">
								{removalBlockedMessage}
							</div>
						) : null}
						<div className="flex justify-end gap-1.5">
							<Dialog.Close className="inline-flex h-7 items-center justify-center rounded border border-white/12 bg-white/[0.05] px-2 font-medium text-fg-secondary text-ui hover:bg-white/[0.1] hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-white/55">
								Cancel
							</Dialog.Close>
							<button
								type="button"
								className="inline-flex h-7 items-center justify-center rounded border border-danger/35 bg-danger-surface/40 px-2 font-medium text-danger-fg text-ui hover:bg-danger-surface/55 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-danger/55"
								onClick={() => {
									if (!pendingRemovalProp) return;
									const liveDocument = useSceneStore.getState().document;
									const liveProp = readComponentProps(liveDocument).find(
										(prop) => prop.id === pendingRemovalProp.id,
									);
									if (!liveProp) {
										setPendingRemovalPropId(null);
										return;
									}
									const interactionUses = componentPropInteractionUseCount(
										liveDocument,
										liveProp.name,
									);
									if (interactionUses > 0) {
										setRemovalBlockedMessage(
											`Remove or reassign ${interactionUses} Interaction action${interactionUses === 1 ? "" : "s"} before deleting this prop.`,
										);
										return;
									}
									removalReturnTargetRef.current = null;
									useSceneStore
										.getState()
										.apply(
											createRemoveComponentPropCommand(pendingRemovalProp.id),
										);
									setPendingRemovalPropId(null);
								}}
							>
								Remove
							</button>
						</div>
					</Dialog.Popup>
				</Dialog.Portal>
			</Dialog.Root>
		</>
	);
}

type SharedColorCandidate = {
	readonly nodeId: string;
	readonly color: string;
	readonly binding: ComponentPropBindingStyleColor;
};

/**
 * Resolves selected nodes whose leading fill is a solid, unanimated paint.
 * Shared color V1 deliberately binds only that exact paint slot; gradients,
 * mesh/image paints, paint-keyframed targets, strokes, and effect colors keep
 * their existing independent ownership.
 */
const sharedColorCandidates = (
	document: SceneDocument,
	motion: MotionDocument,
	nodeIds: readonly string[],
): readonly SharedColorCandidate[] => {
	const candidates: SharedColorCandidate[] = [];
	const seen = new Set<string>();
	for (const nodeId of nodeIds) {
		if (seen.has(nodeId)) continue;
		seen.add(nodeId);
		const node = findNode(document, nodeId);
		const paint = node ? readAppearanceStack(node).fills[0]?.paint : undefined;
		if (paint?.kind !== "solid") continue;
		const color = normalizeColorInput(paint.color);
		if (!color || color === "none") continue;
		const binding = {
			kind: "style-color",
			nodeId,
			role: "fill",
			paintIndex: 0,
		} as const satisfies ComponentPropBindingStyleColor;
		if (componentPropBindingAnimatedConflict(binding, motion)) continue;
		if (componentPropStyleColorOwnershipConflict(document, [binding])) {
			continue;
		}
		candidates.push({
			nodeId,
			color,
			binding,
		});
	}
	return candidates;
};

const nextSharedColorName = (document: SceneDocument): string => {
	const names = new Set(readComponentProps(document).map((prop) => prop.name));
	let index = 1;
	while (names.has(index === 1 ? "sharedColor" : `sharedColor${index}`))
		index += 1;
	return index === 1 ? "sharedColor" : `sharedColor${index}`;
};

type SharedColorPropStatus =
	| { readonly available: true }
	| {
			readonly available: false;
			readonly reason: string;
			readonly repairable: boolean;
	  };

const sharedColorPropStatus = (
	document: SceneDocument,
	motion: MotionDocument,
	prop: ComponentPropDefinition,
): SharedColorPropStatus => {
	const normalizedDefault = normalizeColorInput(
		String(prop.defaultValue.value),
	);
	if (!normalizedDefault || normalizedDefault === "none") {
		return {
			available: false,
			reason: "Stored default is not a supported hex color.",
			repairable: false,
		};
	}
	if (prop.bindings.length === 0) {
		return {
			available: false,
			reason: "No paint targets are bound.",
			repairable: false,
		};
	}
	for (const binding of prop.bindings) {
		if (binding.kind !== "style-color") {
			return {
				available: false,
				reason: "A binding has the wrong kind for a color driver.",
				repairable: false,
			};
		}
		const bindingIssue = resolveComponentPropBindingIssue(
			"color",
			binding,
			(nodeId) => findNode(document, nodeId),
			motion,
		);
		if (bindingIssue) {
			const reason = (() => {
				switch (bindingIssue.kind) {
					case "node-missing":
						return `Target node ${bindingIssue.nodeId} is missing.`;
					case "style-color-not-solid":
						return `Target ${bindingIssue.nodeId} is ${bindingIssue.paintKind}, not a solid paint.`;
					case "binding-animated-conflict":
						return `Target ${bindingIssue.nodeId} is animated on ${bindingIssue.property}.`;
					default:
						return "A binding is incompatible with this color driver.";
				}
			})();
			return { available: false, reason, repairable: false };
		}
		const owners = componentPropStyleColorTargetOwners(document, binding);
		const ownershipConflict = sharedColorOwnershipConflictForInspector(
			document,
			binding,
			prop.id,
		);
		if (ownershipConflict || owners.length !== 1 || owners[0]?.id !== prop.id) {
			return {
				available: false,
				reason:
					ownershipConflict?.reason ??
					"This paint address has invalid shared-color ownership.",
				repairable: false,
			};
		}
	}
	const valueIssue = componentPropStyleColorValueIssues(prop, (nodeId) =>
		findNode(document, nodeId),
	)[0];
	if (valueIssue) {
		return valueIssue.kind === "default-invalid"
			? {
					available: false,
					reason: "Stored default is not a supported hex color.",
					repairable: false,
				}
			: {
					available: false,
					reason:
						valueIssue.kind === "target-color-invalid"
							? "A bound paint has an invalid stored color. Reapply the default to repair it."
							: `Stored pixels (${valueIssue.actual}) differ from the driver default (${valueIssue.expected}).`,
					repairable: true,
				};
	}
	return { available: true };
};

const componentPropInteractionUseCount = (
	document: SceneDocument,
	propName: string,
): number =>
	readInteractions(document).reduce(
		(count, interaction) =>
			count +
			interaction.actions.filter(
				(action) => action.kind === "set-prop" && action.propName === propName,
			).length,
		0,
	);

/**
 * Minimal editor authoring for document color props. It reuses the component
 * prop truth already consumed by Motion Component export, while its Scene
 * commands keep every bound solid paint synchronized with the stored default.
 */
function SharedColorsSection({
	document,
	motion,
	nodeIds,
	primaryNodeId,
}: {
	readonly document: SceneDocument;
	readonly motion: MotionDocument;
	readonly nodeIds: readonly string[];
	readonly primaryNodeId: string | null;
}) {
	const colorProps = readComponentProps(document).filter(
		(prop) => prop.type === "color",
	);
	const [pendingRemovalPropId, setPendingRemovalPropId] = useState<
		string | null
	>(null);
	const removalTriggerElements = useRef(new Map<string, HTMLButtonElement>());
	const removalReturnTargetRef = useRef<HTMLElement | null>(null);
	const paintTargetIds = expandPaintTargetIds(document, nodeIds);
	const primaryPaintTargetIds = primaryNodeId
		? expandPaintTargetIds(document, [primaryNodeId])
		: [];
	const primaryPaintTargetIdSet = new Set(primaryPaintTargetIds);
	const candidates = sharedColorCandidates(document, motion, paintTargetIds);
	const paintTargetCount = new Set(paintTargetIds).size;
	const selectedObjectCount = new Set(nodeIds).size;
	const source = primaryNodeId
		? candidates.find((candidate) =>
				primaryPaintTargetIdSet.has(candidate.nodeId),
			)
		: candidates[0];
	const pendingRemovalProp = colorProps.find(
		(prop) => prop.id === pendingRemovalPropId,
	);
	if (colorProps.length === 0 && nodeIds.length === 0) return null;

	const createSharedColor = (): void => {
		if (!source) return;
		useSceneStore.getState().apply(
			createAddSharedColorComponentPropCommand({
				name: nextSharedColorName(document),
				color: source.color,
				bindings: candidates.map((candidate) => candidate.binding),
			}),
		);
	};

	const commitSharedColor = (
		propId: string,
		value: string,
		coalesceKey?: string,
	): boolean => {
		const normalized = normalizeColorInput(value);
		if (!normalized || normalized === "none") return false;
		const prop = colorProps.find((candidate) => candidate.id === propId);
		if (!prop || !sharedColorPropStatus(document, motion, prop).available) {
			return false;
		}
		const before = useSceneStore.getState().document;
		useSceneStore.getState().apply(
			createSetSharedColorComponentPropCommand(propId, normalized, {
				...(coalesceKey ? { coalesceKey } : {}),
			}),
		);
		return useSceneStore.getState().document !== before;
	};

	const repairSharedColor = (prop: ComponentPropDefinition): void => {
		const color = normalizeColorInput(String(prop.defaultValue.value));
		if (!color || color === "none") return;
		useSceneStore
			.getState()
			.apply(createSetSharedColorComponentPropCommand(prop.id, color));
	};

	return (
		<>
			<PanelSection
				title="Shared colors"
				icon={<Swatches aria-hidden="true" size={12} />}
				action={
					<InspectorIconButton
						label={
							source
								? `Create from ${candidates.length} eligible of ${paintTargetCount} paint targets from ${selectedObjectCount} selected ${selectedObjectCount === 1 ? "object" : "objects"}`
								: candidates.length > 0
									? `Primary selection is ineligible; ${candidates.length} of ${paintTargetCount} paint targets from ${selectedObjectCount} selected ${selectedObjectCount === 1 ? "object is" : "objects are"} eligible`
									: "Select unanimated, unowned solid-filled nodes"
						}
						disabled={!source}
						onClick={createSharedColor}
					>
						<Plus aria-hidden="true" size={11} />
					</InspectorIconButton>
				}
			>
				{colorProps.length === 0 ? (
					<div className="text-fg-muted text-ui">
						Create from the current selection to drive its leading solid fills
						together.
					</div>
				) : (
					<div className="space-y-1.5">
						{colorProps.map((prop) => {
							const status = sharedColorPropStatus(document, motion, prop);
							const interactionUses = componentPropInteractionUseCount(
								document,
								prop.name,
							);
							return (
								<div
									key={prop.id}
									title={status.available ? undefined : status.reason}
									className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-1"
								>
									<ColorField
										label={`${prop.name} · ${prop.bindings.length} ${prop.bindings.length === 1 ? "use" : "uses"}${status.available ? "" : " · unavailable"}`}
										value={String(prop.defaultValue.value)}
										resetKey={`${document.id}:shared-color:${prop.id}`}
										disabled={!status.available}
										onCommit={(value) => commitSharedColor(prop.id, value)}
										onLiveCommit={(value, coalesceKey) => {
											commitSharedColor(prop.id, value, coalesceKey);
										}}
									/>
									<div className="flex items-end gap-1">
										{!status.available && status.repairable ? (
											<InspectorIconButton
												label={`Reapply ${prop.name} default to every target`}
												onClick={() => repairSharedColor(prop)}
											>
												<ArrowClockwise aria-hidden="true" size={11} />
											</InspectorIconButton>
										) : null}
										<InspectorIconButton
											label={
												interactionUses > 0
													? `Cannot remove ${prop.name}; used by ${interactionUses} interaction action${interactionUses === 1 ? "" : "s"}`
													: `Remove shared color ${prop.name}`
											}
											disabled={interactionUses > 0}
											tone="danger"
											buttonRef={(element) => {
												if (element)
													removalTriggerElements.current.set(prop.id, element);
												else removalTriggerElements.current.delete(prop.id);
											}}
											onClick={() => {
												removalReturnTargetRef.current =
													removalTriggerElements.current.get(prop.id) ?? null;
												setPendingRemovalPropId(prop.id);
											}}
										>
											<Trash aria-hidden="true" size={11} />
										</InspectorIconButton>
									</div>
								</div>
							);
						})}
					</div>
				)}
			</PanelSection>
			<Dialog.Root
				open={pendingRemovalProp !== undefined}
				onOpenChange={(open) => {
					if (!open) setPendingRemovalPropId(null);
				}}
			>
				<Dialog.Portal>
					<Dialog.Backdrop className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
					<Dialog.Popup
						finalFocus={() =>
							removalReturnTargetRef.current?.isConnected
								? removalReturnTargetRef.current
								: (globalThis.document?.querySelector<HTMLElement>(
										"[data-inspector-focus-anchor]",
									) ?? null)
						}
						className="fixed left-1/2 top-1/2 z-50 flex w-[min(92vw,360px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-2 rounded-lg border border-white/12 bg-surface-raised/98 p-3 text-fg text-ui shadow-2xl shadow-black/60 outline-none backdrop-blur-xl"
					>
						<Dialog.Title className="font-medium text-fg text-ui">
							Remove shared color?
						</Dialog.Title>
						<Dialog.Description className="text-fg-secondary text-ui leading-4">
							{pendingRemovalProp
								? `Current pixels will stay unchanged, but ${pendingRemovalProp.name} will no longer be available to player.setProps or generated React props.`
								: "Current pixels will stay unchanged, but the exported prop will be removed."}
						</Dialog.Description>
						<div className="flex justify-end gap-1.5">
							<Dialog.Close className="inline-flex h-7 items-center justify-center rounded border border-white/12 bg-white/[0.05] px-2 font-medium text-fg-secondary text-ui hover:bg-white/[0.1] hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-white/55">
								Cancel
							</Dialog.Close>
							<button
								type="button"
								className="inline-flex h-7 items-center justify-center rounded border border-danger/35 bg-danger-surface/40 px-2 font-medium text-danger-fg text-ui hover:bg-danger-surface/55 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-danger/55"
								onClick={() => {
									if (!pendingRemovalProp) return;
									removalReturnTargetRef.current = null;
									useSceneStore
										.getState()
										.apply(
											createRemoveComponentPropCommand(pendingRemovalProp.id),
										);
									setPendingRemovalPropId(null);
								}}
							>
								Remove
							</button>
						</div>
					</Dialog.Popup>
				</Dialog.Portal>
			</Dialog.Root>
		</>
	);
}

const TEXT_MOTION_BUTTON =
	"rounded border border-white/10 px-1 py-1 text-ui transition-colors hover:bg-white/5";
const TEXT_MOTION_BUTTON_ACTIVE =
	"border-accent/40 bg-accent-surface/40 text-accent-fg";

function SceneCameraControlGroup({
	label,
	meta,
	children,
}: {
	readonly label: string;
	readonly meta?: string;
	readonly children: ReactNode;
}) {
	return (
		<div className="space-y-1 border-white/[0.08] border-t pt-1 first:border-t-0 first:pt-0">
			<div className="flex h-4 items-center justify-between gap-2 text-ui">
				<span className="font-medium text-fg-secondary">{label}</span>
				{meta ? (
					<span className="min-w-0 truncate font-mono text-fg-subtle tabular-nums">
						{meta}
					</span>
				) : null}
			</div>
			{children}
		</div>
	);
}

type SceneCameraProjectionKind = SceneCameraRigContract["projection"]["kind"];

const sceneCameraProjectionOptions: readonly {
	readonly value: SceneCameraProjectionKind;
	readonly label: string;
}[] = [
	{ value: "orthographic", label: "Ortho" },
	{ value: "perspective", label: "Perspective" },
];

const sceneCameraDepthPresetSegments: readonly {
	readonly value: SceneCameraDepthPreset;
	readonly label: string;
	readonly title: string;
}[] = [
	{ value: "off", label: "Off", title: "No depth plane" },
	{ value: "background", label: "Back", title: "Background depth" },
	{ value: "midground", label: "Mid", title: "Midground depth" },
	{ value: "foreground", label: "Front", title: "Foreground depth" },
];

const cameraRigIdFromSelection = (
	selection: SceneCameraAuthoringSelection | null,
): string | null => {
	if (!selection) return null;
	if ("cameraRigId" in selection) return selection.cameraRigId ?? null;
	return null;
};

const selectedDepthPreset = (
	document: SceneDocument,
	nodeIds: readonly string[],
): SceneCameraDepthPreset | "custom" | "mixed" | null => {
	const presets = nodeIds.flatMap((nodeId) => {
		const node = findNode(document, nodeId);
		if (!node) return [];
		return [
			node.depthPlane
				? sceneCameraDepthPresetForZ(node.depthPlane.z)
				: ("off" as const),
		];
	});
	if (presets.length === 0) return null;
	const first = presets[0];
	return presets.every((preset) => preset === first) ? first : "mixed";
};

const selectedDepthZValue = (
	document: SceneDocument,
	nodeIds: readonly string[],
): MixedValue<number | null> | null => {
	const values = nodeIds.flatMap((nodeId) => {
		const node = findNode(document, nodeId);
		if (!node) return [];
		return [node.depthPlane?.z ?? null];
	});
	if (values.length === 0) return null;
	const first = values[0];
	return values.every((value) => Object.is(value, first)) ? first : MIXED_VALUE;
};

const cameraDofFidelityLabel = (
	fidelity: SceneCameraDepthOfFieldResolution["fidelity"],
): string => {
	switch (fidelity) {
		case "none":
			return "none";
		case "svg-layer-blur-approximation":
			return "layer blur";
		case "optical-bokeh-preview-required":
			return "bokeh needed";
	}
};

const cameraDofRendererLabel = (
	renderer: SceneCameraDepthOfFieldResolution["renderer"],
): string => {
	switch (renderer) {
		case "none":
			return "none";
		case "svg-layer-blur":
			return "SVG blur";
	}
};

const sceneCameraProjectionBadge = (
	kind: SceneCameraProjectionKind,
): string => {
	switch (kind) {
		case "orthographic":
			return "ortho";
		case "perspective":
			return "persp";
	}
};

const applySceneCameraInspectorPlan = (
	plan: Parameters<typeof commitSceneCameraAuthoringPlan>[0],
	selection?: SceneCameraAuthoringSelection | null,
): void => {
	commitSceneCameraAuthoringPlan(plan);
	if (selection !== undefined) {
		useSelectionStore.getState().selectSceneCamera(selection);
	}
};

function SceneCameraSection({
	document,
	nodeIds,
	primaryNodeId,
	resetKey,
}: {
	readonly document: SceneDocument;
	readonly nodeIds: readonly string[];
	readonly primaryNodeId: string | null;
	readonly resetKey: string;
}) {
	const sceneCameraSelection = useSelectionStore((state) => state.sceneCamera);
	const motion = useMotionStore((state) => state.document);
	const currentFrame = useTransportStore((state) => state.currentFrame);
	const [showDofDiagnostics, setShowDofDiagnostics] = useState(false);
	const state = readSceneCameraAuthoringState(document);
	const resolvedSelection = resolveSceneCameraAuthoringSelection(
		document,
		sceneCameraSelection,
		state.artboard.id,
	);
	const selectedCamera =
		resolvedSelection.status === "camera"
			? resolvedSelection.camera
			: resolvedSelection.status === "controller"
				? resolvedSelection.camera
				: undefined;
	const inspectedCamera = selectedCamera;
	const inspectedCameraRigId = inspectedCamera?.rig.id ?? null;
	const selectedRigId = cameraRigIdFromSelection(sceneCameraSelection);
	const primaryTargetNode = primaryNodeId
		? findNode(document, primaryNodeId)
		: null;
	const depthPreset = selectedDepthPreset(document, nodeIds);
	const depthZValue = selectedDepthZValue(document, nodeIds);
	const createCamera = (withTargetController: boolean): void => {
		const plan = createSceneCameraForArtboardAuthoringPlan(document, {
			artboardId: state.artboard.id,
			withTargetController,
		});
		if (!plan?.cameraRigId) return;
		applySceneCameraInspectorPlan(plan, {
			kind: "camera-rig",
			cameraRigId: plan.cameraRigId,
		});
	};
	const selectCamera = (cameraRigId: string): void => {
		useSelectionStore
			.getState()
			.selectSceneCamera({ kind: "camera-rig", cameraRigId });
	};
	const renameCamera = (
		cameraRigId: string,
		value: string,
		currentName: string,
	): string => {
		const nextName = value.trim();
		const duplicate = state.cameras.some(
			(camera) =>
				camera.rig.id !== cameraRigId &&
				camera.rig.name.trim().toLocaleLowerCase() ===
					nextName.toLocaleLowerCase(),
		);
		if (!nextName || duplicate) return currentName;
		if (nextName === currentName) return currentName;
		applySceneCameraInspectorPlan(
			createUpdateSceneCameraAuthoringPlan({
				cameraRigId,
				patch: { name: nextName },
				label: "Rename scene camera",
				coalesceKey: `scene-camera:rename:${cameraRigId}`,
			}),
			{ kind: "camera-rig", cameraRigId },
		);
		return nextName;
	};
	const commitCameraPatch = (
		patch: Parameters<typeof createUpdateSceneCameraAuthoringPlan>[0]["patch"],
		label: string,
	): boolean => {
		if (!inspectedCameraRigId) return false;
		applySceneCameraInspectorPlan(
			createUpdateSceneCameraAuthoringPlan({
				cameraRigId: inspectedCameraRigId,
				patch,
				label,
				coalesceKey: `scene-camera:inspector:${inspectedCameraRigId}:${label}`,
			}),
			{ kind: "camera-rig", cameraRigId: inspectedCameraRigId },
		);
		return true;
	};
	const setActiveCamera = (cameraRigId: string | null): void => {
		applySceneCameraInspectorPlan(
			createSetActiveSceneCameraAuthoringPlan({
				artboardId: state.artboard.id,
				cameraRigId,
			}),
			cameraRigId ? { kind: "camera-rig", cameraRigId } : null,
		);
	};
	const removeCamera = (cameraRigId: string): void => {
		applySceneCameraInspectorPlan(
			createRemoveSceneCameraAuthoringPlan(cameraRigId),
			null,
		);
	};
	const createTargetNull = (): void => {
		if (!inspectedCameraRigId) return;
		const plan = createTargetControllerForSceneCameraAuthoringPlan(
			document,
			inspectedCameraRigId,
			{ artboardId: state.artboard.id },
		);
		if (!plan?.controllerNodeId) return;
		applySceneCameraInspectorPlan(plan, {
			kind: "motion-controller",
			nodeId: plan.controllerNodeId,
			cameraRigId: inspectedCameraRigId,
			role: "target",
		});
	};
	const bindPrimaryAsTarget = (): void => {
		if (!inspectedCameraRigId || !primaryNodeId) return;
		applySceneCameraInspectorPlan(
			createBindSceneCameraTargetNodeAuthoringPlan({
				cameraRigId: inspectedCameraRigId,
				nodeId: primaryNodeId,
			}),
			{ kind: "camera-target", cameraRigId: inspectedCameraRigId },
		);
	};
	const clearTargetNode = (): void => {
		if (!inspectedCameraRigId) return;
		applySceneCameraInspectorPlan(
			createClearSceneCameraTargetAuthoringPlan(document, inspectedCameraRigId),
			{ kind: "camera-target", cameraRigId: inspectedCameraRigId },
		);
	};
	const assignDepthPreset = (preset: SceneCameraDepthPreset): void => {
		if (nodeIds.length === 0) return;
		commitSceneCameraAuthoringPlan(
			createAssignSceneCameraDepthPresetPlan({
				nodeIds,
				preset,
				cameraRigId: inspectedCameraRigId,
			}),
		);
	};
	const assignDepthZ = (z: number): boolean => {
		if (nodeIds.length === 0) return false;
		commitSceneCameraAuthoringPlan(
			createAssignSceneCameraDepthValuePlan({
				nodeIds,
				z,
				cameraRigId: inspectedCameraRigId,
			}),
		);
		return true;
	};
	const body = inspectedCamera?.rig.body.position;
	const rotation = inspectedCamera?.rig.body.rotation ?? { x: 0, y: 0, z: 0 };
	const targetState = inspectedCamera?.target;
	const target = targetState?.point ?? { x: 0, y: 0, z: 0 };
	const projection = inspectedCamera?.rig.projection;
	const cameraProjectionResolution =
		state.cameras.length > 0
			? resolveSceneCameraProjection({
					scene: document,
					motion,
					frame: currentFrame,
					artboardId: state.artboard.id,
					controls: createProductionControlSampler(document, motion),
				})
			: null;
	const frameCameraRigId =
		cameraProjectionResolution?.activeCameraRigId ?? null;
	const frameCamera = frameCameraRigId
		? state.cameras.find((camera) => camera.rig.id === frameCameraRigId)
		: undefined;
	const dof =
		cameraProjectionResolution && frameCameraRigId === inspectedCameraRigId
			? cameraProjectionResolution.depthOfField
			: null;
	const dofUnavailableLabel = "—";
	const cameraKeyedAtFrame = (
		properties: readonly CameraRigAnimatableProperty[],
	): boolean =>
		Boolean(
			inspectedCameraRigId &&
				motion.cameraTracks?.some(
					(track) =>
						track.target.cameraRigId === inspectedCameraRigId &&
						properties.includes(track.target.property) &&
						track.keyframes.some((keyframe) => keyframe.time === currentFrame),
				),
		);
	const bodyKeyed = cameraKeyedAtFrame(["bodyX", "bodyY", "bodyZ"]);
	const targetKeyed = cameraKeyedAtFrame(["targetX", "targetY", "targetZ"]);
	const orientKeyed = cameraKeyedAtFrame([
		"bodyRotationX",
		"bodyRotationY",
		"bodyRotationZ",
	]);
	const lensKeyed = cameraKeyedAtFrame([
		projection?.kind === "perspective" ? "fovDegrees" : "zoom",
		"focusDistance",
		"aperture",
	]);
	const keyCameraBody = (): void => {
		if (!inspectedCameraRigId || !body) return;
		commitSceneCameraAuthoringPlan(
			createCameraVectorKeyframePlan({
				cameraRigId: inspectedCameraRigId,
				kind: "body",
				frame: currentFrame,
				value: body,
			}),
		);
	};
	const keyCameraTarget = (): void => {
		if (!inspectedCameraRigId || !targetState?.keyable) return;
		commitSceneCameraAuthoringPlan(
			createCameraVectorKeyframePlan({
				cameraRigId: inspectedCameraRigId,
				kind: "target",
				frame: currentFrame,
				value: target,
			}),
		);
	};
	const keyCameraLens = (): void => {
		if (!inspectedCameraRigId || !projection) return;
		const perspective = projection.kind === "perspective";
		const lensPlan = createCameraChannelKeyframePlan({
			cameraRigId: inspectedCameraRigId,
			property: perspective ? "fovDegrees" : "zoom",
			frame: currentFrame,
			value: perspective
				? (projection.fovDegrees ?? 50)
				: (projection.zoom ?? 1),
		});
		const focusPlan = createCameraChannelKeyframePlan({
			cameraRigId: inspectedCameraRigId,
			property: "focusDistance",
			frame: currentFrame,
			value: projection.focusDistance ?? Math.abs(body?.z ?? 1000),
		});
		const aperturePlan = createCameraChannelKeyframePlan({
			cameraRigId: inspectedCameraRigId,
			property: "aperture",
			frame: currentFrame,
			value: projection.aperture ?? 0,
		});
		commitSceneCameraAuthoringPlan({
			sceneCommands: [],
			motionCommands: [
				...lensPlan.motionCommands,
				...focusPlan.motionCommands,
				...aperturePlan.motionCommands,
			],
			cameraRigId: inspectedCameraRigId,
		});
	};
	const keyCameraRotation = (): void => {
		if (!inspectedCameraRigId) return;
		commitSceneCameraAuthoringPlan(
			createCameraVectorKeyframePlan({
				cameraRigId: inspectedCameraRigId,
				kind: "bodyRotation",
				frame: currentFrame,
				value: rotation,
			}),
		);
	};

	return (
		<PanelSection
			title="Camera"
			icon={<Camera aria-hidden="true" size={12} />}
			action={
				<div className="flex items-center gap-1">
					<InspectorIconButton
						label="Create scene camera"
						onClick={() => createCamera(false)}
					>
						<Plus aria-hidden="true" size={11} />
					</InspectorIconButton>
					<InspectorIconButton
						label="Create scene camera with target null"
						disabled={document.layers.length === 0}
						onClick={() => createCamera(true)}
					>
						<Circle aria-hidden="true" size={9} />
					</InspectorIconButton>
				</div>
			}
		>
			<div className="space-y-1.5">
				<SceneCameraControlGroup
					label="Rig"
					meta={`${state.cameras.length} camera${state.cameras.length === 1 ? "" : "s"}`}
				>
					{state.cameras.length > 0 ? (
						<div className="space-y-1">
							{state.cameras.map((camera) => {
								const active = camera.active;
								const frame = frameCameraRigId === camera.rig.id;
								const selected = selectedRigId === camera.rig.id;
								const sameNameCameras = state.cameras.filter(
									(candidate) =>
										candidate.rig.name.trim().toLocaleLowerCase() ===
										camera.rig.name.trim().toLocaleLowerCase(),
								);
								const duplicateOrdinal =
									sameNameCameras.length > 1
										? sameNameCameras.findIndex(
												(candidate) => candidate.rig.id === camera.rig.id,
											) + 1
										: null;
								const cameraStatus = [
									duplicateOrdinal ? `#${duplicateOrdinal}` : null,
									active ? "Artboard" : null,
									frame ? "Frame" : null,
								]
									.filter(Boolean)
									.join(" · ");
								return (
									<div
										key={camera.rig.id}
										className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1"
									>
										<div
											className={cn(
												TEXT_MOTION_BUTTON,
												"flex h-6 min-w-0 items-center justify-between gap-1 px-1.5 py-0 text-left",
												selected && TEXT_MOTION_BUTTON_ACTIVE,
												frame && !selected && "border-accent/35",
												active &&
													!selected &&
													"border-warn/40 bg-warn-surface/25",
											)}
										>
											<input
												key={camera.rig.name}
												type="text"
												aria-label={`Rename ${camera.rig.name}`}
												defaultValue={camera.rig.name}
												className="min-w-0 flex-1 bg-transparent text-fg outline-none"
												onFocus={() => selectCamera(camera.rig.id)}
												onBlur={(event) => {
													event.currentTarget.value = renameCamera(
														camera.rig.id,
														event.currentTarget.value,
														camera.rig.name,
													);
												}}
												onKeyDown={(event) => {
													event.stopPropagation();
													if (event.key === "Escape") {
														event.currentTarget.value = camera.rig.name;
														event.currentTarget.blur();
													}
													if (event.key === "Enter") event.currentTarget.blur();
												}}
											/>
											<span className="shrink-0 font-mono text-fg-subtle">
												{cameraStatus ||
													sceneCameraProjectionBadge(
														camera.rig.projection.kind,
													)}
											</span>
										</div>
										<InspectorIconButton
											label={
												active
													? "Clear artboard camera"
													: "Set camera active for artboard"
											}
											onClick={() =>
												setActiveCamera(active ? null : camera.rig.id)
											}
										>
											<Check
												aria-hidden="true"
												size={11}
												weight={active ? "bold" : "regular"}
											/>
										</InspectorIconButton>
										<InspectorIconButton
											label="Remove scene camera"
											tone="danger"
											onClick={() => removeCamera(camera.rig.id)}
										>
											<Trash aria-hidden="true" size={11} />
										</InspectorIconButton>
									</div>
								);
							})}
						</div>
					) : (
						<ReadoutRow label="Camera" value="none" />
					)}
				</SceneCameraControlGroup>

				{inspectedCamera ? (
					<div className="space-y-1.5">
						<SceneCameraControlGroup
							label="Lens"
							meta={
								projection?.kind === "perspective" ? "perspective" : "ortho"
							}
						>
							<div className="grid grid-cols-2 gap-1">
								<SelectField
									label="Projection"
									value={projection?.kind ?? "orthographic"}
									options={sceneCameraProjectionOptions}
									resetKey={`${resetKey}:scene-camera:${inspectedCamera.rig.id}:projection`}
									onCommit={(kind) =>
										commitCameraPatch(
											{ projection: { kind } },
											"Set camera projection",
										)
									}
								/>
								<NumericField
									label={projection?.kind === "perspective" ? "FOV" : "Zoom"}
									value={
										projection?.kind === "perspective"
											? (projection.fovDegrees ?? 50)
											: (projection?.zoom ?? 1)
									}
									resetKey={`${resetKey}:scene-camera:${inspectedCamera.rig.id}:projection-number`}
									step={projection?.kind === "perspective" ? "1" : "0.05"}
									onCommit={(value) =>
										commitCameraPatch(
											projection?.kind === "perspective"
												? { projection: { fovDegrees: Math.max(1, value) } }
												: { projection: { zoom: Math.max(0.01, value) } },
											projection?.kind === "perspective"
												? "Set camera FOV"
												: "Set camera zoom",
										)
									}
								/>
							</div>
							{projection ? (
								<div className="space-y-1">
									<div className="grid grid-cols-2 gap-1">
										<NumericField
											label="Focus"
											value={
												projection.focusDistance ?? Math.abs(body?.z ?? 1000)
											}
											resetKey={`${resetKey}:scene-camera:${inspectedCamera.rig.id}:focus-distance`}
											step="10"
											onCommit={(value) =>
												commitCameraPatch(
													{
														projection: {
															focusDistance: Math.max(0.001, value),
														},
													},
													"Set camera focus distance",
												)
											}
										/>
										<NumericField
											label="Aperture"
											value={projection.aperture ?? 0}
											resetKey={`${resetKey}:scene-camera:${inspectedCamera.rig.id}:aperture`}
											step="0.1"
											onCommit={(value) =>
												commitCameraPatch(
													{ projection: { aperture: Math.max(0, value) } },
													"Set camera aperture",
												)
											}
										/>
									</div>
									<ReadoutRow
										label="Frame"
										value={
											frameCameraRigId === inspectedCamera.rig.id
												? "This camera"
												: (frameCamera?.rig.name ?? "No camera")
										}
									/>
									<button
										type="button"
										aria-expanded={showDofDiagnostics}
										onClick={() => setShowDofDiagnostics((visible) => !visible)}
										className="flex h-5 w-full items-center justify-between rounded border border-white/10 px-1.5 text-fg-muted text-ui hover:bg-white/5"
									>
										<span>DOF diagnostics</span>
										{showDofDiagnostics ? (
											<CaretUp aria-hidden="true" size={10} />
										) : (
											<CaretDown aria-hidden="true" size={10} />
										)}
									</button>
									{showDofDiagnostics ? (
										<div className="grid grid-cols-2 gap-1">
											<ReadoutRow
												label="Blur"
												value={
													dof
														? dof.active
															? `${dof.blurredNodeCount} nodes / max ${dof.maxBlurRadius}px`
															: "no blur"
														: dofUnavailableLabel
												}
											/>
											<ReadoutRow
												label="CoC"
												value={
													dof
														? `${dof.maxCircleOfConfusion.toFixed(3)} / ${cameraDofFidelityLabel(dof.fidelity)}`
														: dofUnavailableLabel
												}
											/>
											<ReadoutRow
												label="Near/Far"
												value={
													dof
														? `${dof.nearBlurredNodeCount}/${dof.farBlurredNodeCount}`
														: dofUnavailableLabel
												}
											/>
											<ReadoutRow
												label="Renderer"
												value={
													dof
														? cameraDofRendererLabel(dof.renderer)
														: dofUnavailableLabel
												}
											/>
										</div>
									) : null}
								</div>
							) : null}
						</SceneCameraControlGroup>
						{body ? (
							<SceneCameraControlGroup
								label="Transform"
								meta="position · degrees"
							>
								<div className="grid grid-cols-3 gap-1">
									<NumericField
										label="X"
										value={body.x}
										resetKey={`${resetKey}:scene-camera:${inspectedCamera.rig.id}:body-x`}
										onCommit={(value) =>
											commitCameraPatch(
												{ body: { position: { x: value } } },
												"Set camera body X",
											)
										}
									/>
									<NumericField
										label="Y"
										value={body.y}
										resetKey={`${resetKey}:scene-camera:${inspectedCamera.rig.id}:body-y`}
										onCommit={(value) =>
											commitCameraPatch(
												{ body: { position: { y: value } } },
												"Set camera body Y",
											)
										}
									/>
									<NumericField
										label="Z"
										value={body.z}
										resetKey={`${resetKey}:scene-camera:${inspectedCamera.rig.id}:body-z`}
										onCommit={(value) =>
											commitCameraPatch(
												{ body: { position: { z: value } } },
												"Set camera body Z",
											)
										}
									/>
								</div>
								<div className="grid grid-cols-3 gap-1">
									<NumericField
										label="Pitch"
										value={rotation.x}
										resetKey={`${resetKey}:scene-camera:${inspectedCamera.rig.id}:rotation-x`}
										step="1"
										onCommit={(value) =>
											commitCameraPatch(
												{ body: { rotation: { x: value } } },
												"Set camera pitch",
											)
										}
									/>
									<NumericField
										label="Yaw"
										value={rotation.y}
										resetKey={`${resetKey}:scene-camera:${inspectedCamera.rig.id}:rotation-y`}
										step="1"
										onCommit={(value) =>
											commitCameraPatch(
												{ body: { rotation: { y: value } } },
												"Set camera yaw",
											)
										}
									/>
									<NumericField
										label="Roll"
										value={rotation.z}
										resetKey={`${resetKey}:scene-camera:${inspectedCamera.rig.id}:rotation-z`}
										step="1"
										onCommit={(value) =>
											commitCameraPatch(
												{ body: { rotation: { z: value } } },
												"Set camera roll",
											)
										}
									/>
								</div>
							</SceneCameraControlGroup>
						) : null}
						<SceneCameraControlGroup
							label="Target"
							meta={
								targetState?.driverNode?.name ??
								(targetState?.source.startsWith("stale")
									? "missing target"
									: "free point")
							}
						>
							<div className="grid grid-cols-3 gap-1">
								<NumericField
									label="X"
									value={target.x}
									disabled={!targetState?.editable}
									resetKey={`${resetKey}:scene-camera:${inspectedCamera.rig.id}:target-x`}
									onCommit={(value) =>
										commitCameraPatch(
											{ target: { point: { x: value } } },
											"Set camera target X",
										)
									}
								/>
								<NumericField
									label="Y"
									value={target.y}
									disabled={!targetState?.editable}
									resetKey={`${resetKey}:scene-camera:${inspectedCamera.rig.id}:target-y`}
									onCommit={(value) =>
										commitCameraPatch(
											{ target: { point: { y: value } } },
											"Set camera target Y",
										)
									}
								/>
								<NumericField
									label="Z"
									value={target.z}
									disabled={!targetState?.editable}
									resetKey={`${resetKey}:scene-camera:${inspectedCamera.rig.id}:target-z`}
									onCommit={(value) =>
										commitCameraPatch(
											{ target: { point: { z: value } } },
											"Set camera target Z",
										)
									}
								/>
							</div>
							<div className="grid grid-cols-3 gap-1">
								<button
									type="button"
									aria-label="Create target null"
									title="Create target null"
									disabled={document.layers.length === 0}
									className={cn(
										TEXT_MOTION_BUTTON,
										"inline-flex items-center justify-center gap-1",
										document.layers.length === 0 &&
											"cursor-not-allowed opacity-45",
									)}
									onClick={createTargetNull}
								>
									<Circle aria-hidden="true" size={10} /> Null
								</button>
								<button
									type="button"
									aria-label="Bind selected layer as camera target"
									title="Bind selected layer as camera target"
									disabled={!primaryNodeId}
									className={cn(
										TEXT_MOTION_BUTTON,
										"inline-flex items-center justify-center gap-1",
										!primaryNodeId && "cursor-not-allowed opacity-45",
									)}
									onClick={bindPrimaryAsTarget}
								>
									<LinkSimple aria-hidden="true" size={10} /> Bind
								</button>
								<button
									type="button"
									aria-label="Clear camera target binding"
									title="Clear camera target binding"
									disabled={!targetState?.bound}
									className={cn(
										TEXT_MOTION_BUTTON,
										"inline-flex items-center justify-center gap-1",
										!targetState?.bound && "cursor-not-allowed opacity-45",
									)}
									onClick={clearTargetNode}
								>
									<X aria-hidden="true" size={10} /> Clear
								</button>
							</div>
						</SceneCameraControlGroup>
						<SceneCameraControlGroup label="Key" meta={`${currentFrame}f`}>
							<div className="grid grid-cols-4 gap-1">
								<button
									type="button"
									aria-pressed={bodyKeyed}
									className={cn(
										TEXT_MOTION_BUTTON,
										"inline-flex items-center justify-center gap-1",
										bodyKeyed && TEXT_MOTION_BUTTON_ACTIVE,
									)}
									onClick={keyCameraBody}
								>
									<Diamond aria-hidden="true" size={10} weight="fill" /> Body
								</button>
								<button
									type="button"
									disabled={!targetState?.keyable}
									aria-pressed={targetKeyed}
									className={cn(
										TEXT_MOTION_BUTTON,
										"inline-flex items-center justify-center gap-1",
										!targetState?.keyable && "cursor-not-allowed opacity-45",
										targetKeyed && TEXT_MOTION_BUTTON_ACTIVE,
									)}
									onClick={keyCameraTarget}
								>
									<Diamond aria-hidden="true" size={10} weight="fill" /> Target
								</button>
								<button
									type="button"
									aria-pressed={orientKeyed}
									className={cn(
										TEXT_MOTION_BUTTON,
										"inline-flex items-center justify-center gap-1",
										orientKeyed && TEXT_MOTION_BUTTON_ACTIVE,
									)}
									onClick={keyCameraRotation}
								>
									<Diamond aria-hidden="true" size={10} weight="fill" /> Orient
								</button>
								<button
									type="button"
									aria-pressed={lensKeyed}
									className={cn(
										TEXT_MOTION_BUTTON,
										"inline-flex items-center justify-center gap-1",
										lensKeyed && TEXT_MOTION_BUTTON_ACTIVE,
									)}
									onClick={keyCameraLens}
								>
									<Diamond aria-hidden="true" size={10} weight="fill" /> Lens
								</button>
							</div>
						</SceneCameraControlGroup>
					</div>
				) : null}

				{nodeIds.length > 0 ? (
					<SceneCameraControlGroup
						label="Layer depth"
						meta={primaryTargetNode?.name ?? `${nodeIds.length} selected`}
					>
						<ReadoutRow
							label="Layer"
							value={primaryTargetNode?.name ?? `${nodeIds.length} selected`}
						/>
						<div className="grid grid-cols-4 gap-1">
							{sceneCameraDepthPresetSegments.map((preset) => {
								const selected = depthPreset === preset.value;
								return (
									<button
										key={preset.value}
										type="button"
										title={preset.title}
										aria-pressed={selected}
										onClick={() => assignDepthPreset(preset.value)}
										className={cn(
											TEXT_MOTION_BUTTON,
											selected && TEXT_MOTION_BUTTON_ACTIVE,
										)}
									>
										{preset.label}
									</button>
								);
							})}
						</div>
						{depthPreset === "custom" || depthPreset === "mixed" ? (
							<ReadoutRow label="Depth" value={depthPreset} />
						) : null}
						<NumericField
							label="Z"
							value={depthZValue}
							resetKey={`${resetKey}:scene-camera:depth-z:${nodeIds.join("|")}`}
							step="10"
							onCommit={assignDepthZ}
						/>
					</SceneCameraControlGroup>
				) : null}
			</div>
		</PanelSection>
	);
}

const TEXT_MOTION_PRESETS: readonly {
	readonly name: string;
	readonly create: (
		options: TextAnimatorPresetOptions,
	) => ReturnType<typeof createWordRiseBinding>;
}[] = [
	{ name: "Word Rise", create: createWordRiseBinding },
	{ name: "Character Cascade", create: createCharacterCascadeBinding },
	{ name: "Line Fade", create: createLineFadeBinding },
];

const TEXT_FRAGMENT_UNIT_OPTIONS = [
	{ value: "grapheme", label: "Grapheme" },
	{ value: "character", label: "Character" },
	{ value: "character-no-spaces", label: "Character (no spaces)" },
	{ value: "word", label: "Word" },
	{ value: "line", label: "Line" },
] as const satisfies readonly {
	readonly value: TextFragmentUnit;
	readonly label: string;
}[];

const TEXT_SELECTOR_MODE_OPTIONS = [
	{ value: "add", label: "Add" },
	{ value: "subtract", label: "Subtract" },
	{ value: "intersect", label: "Intersect" },
	{ value: "min", label: "Minimum" },
	{ value: "max", label: "Maximum" },
] as const satisfies readonly {
	readonly value: TextSelectorMode;
	readonly label: string;
}[];

const TEXT_SELECTOR_SHAPE_OPTIONS = [
	{ value: "square", label: "Square" },
	{ value: "ramp-up", label: "Ramp up" },
	{ value: "ramp-down", label: "Ramp down" },
	{ value: "smooth", label: "Smooth" },
] as const satisfies readonly {
	readonly value: TextSelectorShape;
	readonly label: string;
}[];

const TEXT_ANIMATOR_PROPERTY_FIELDS = [
	{ key: "positionX", label: "Position X", step: "1" },
	{ key: "positionY", label: "Position Y", step: "1" },
	{ key: "rotation", label: "Rotation", step: "1" },
	{ key: "scaleX", label: "Scale X", step: "0.05" },
	{ key: "scaleY", label: "Scale Y", step: "0.05" },
	{ key: "opacity", label: "Opacity", step: "0.05" },
	{ key: "trackingOffset", label: "Tracking", step: "1" },
	{ key: "blurRadius", label: "Blur", step: "1" },
] as const satisfies readonly {
	readonly key: keyof TextAnimatorProperties;
	readonly label: string;
	readonly step: string;
}[];

const withTextAnimatorProperty = (
	properties: TextAnimatorProperties,
	key: keyof TextAnimatorProperties,
	value: number | null,
): TextAnimatorProperties => {
	if (value !== null) return { ...properties, [key]: value };
	return Object.fromEntries(
		Object.entries(properties).filter(([candidate]) => candidate !== key),
	) as TextAnimatorProperties;
};

const withoutTextSelectorOffsetKeys = (
	selector: RangeTextSelector,
): RangeTextSelector => {
	const { offsetKeyframes: _offsetKeyframes, ...withoutKeys } = selector;
	return withoutKeys;
};

function TextAnimatorSelectorEditor({
	binding,
	selector,
	selectorIndex,
	currentFrame,
	onChange,
}: {
	readonly binding: TextAnimatorBinding;
	readonly selector: RangeTextSelector;
	readonly selectorIndex: number;
	readonly currentFrame: number;
	readonly onChange: (binding: TextAnimatorBinding) => void;
}) {
	const replaceSelector = (next: RangeTextSelector): boolean => {
		onChange({
			...binding,
			selectors: binding.selectors.map((candidate, index) =>
				index === selectorIndex ? next : candidate,
			),
		});
		return true;
	};
	const setOffsetKeys = (
		keys: NonNullable<RangeTextSelector["offsetKeyframes"]>,
	): boolean =>
		replaceSelector({
			...withoutTextSelectorOffsetKeys(selector),
			...(keys.length > 0 ? { offsetKeyframes: keys } : {}),
		});
	const moveSelector = (offset: -1 | 1): void => {
		const toIndex = selectorIndex + offset;
		if (toIndex < 0 || toIndex >= binding.selectors.length) return;
		const selectors = [...binding.selectors];
		const [moving] = selectors.splice(selectorIndex, 1);
		if (!moving) return;
		selectors.splice(toIndex, 0, moving);
		onChange({ ...binding, selectors });
	};
	const offsetKeys = selector.offsetKeyframes ?? [];

	return (
		<div className="space-y-1 rounded-md border border-white/8 bg-black/15 p-1.5">
			<div className="flex items-end gap-1">
				<div className="min-w-0 flex-1 text-fg-secondary text-ui">
					Range selector {selectorIndex + 1}
				</div>
				<InspectorIconButton
					label="Move selector earlier"
					disabled={selectorIndex === 0}
					onClick={() => moveSelector(-1)}
				>
					<CaretUp aria-hidden="true" size={11} />
				</InspectorIconButton>
				<InspectorIconButton
					label="Move selector later"
					disabled={selectorIndex === binding.selectors.length - 1}
					onClick={() => moveSelector(1)}
				>
					<CaretDown aria-hidden="true" size={11} />
				</InspectorIconButton>
				<InspectorIconButton
					label="Remove selector"
					disabled={binding.selectors.length === 1}
					tone="danger"
					onClick={() =>
						onChange({
							...binding,
							selectors: binding.selectors.filter(
								(_candidate, index) => index !== selectorIndex,
							),
						})
					}
				>
					<Trash aria-hidden="true" size={11} />
				</InspectorIconButton>
			</div>
			<div className="grid grid-cols-2 gap-1">
				<SelectField
					label="Mode"
					value={selector.mode}
					options={TEXT_SELECTOR_MODE_OPTIONS}
					resetKey={`${binding.id}:selector:${selectorIndex}:mode`}
					onCommit={(mode) => replaceSelector({ ...selector, mode })}
				/>
				<SelectField
					label="Units"
					value={selector.units}
					options={[
						{ value: "percent", label: "Percent" },
						{ value: "index", label: "Index" },
					]}
					resetKey={`${binding.id}:selector:${selectorIndex}:units`}
					onCommit={(units) => replaceSelector({ ...selector, units })}
				/>
				<SelectField
					label="Shape"
					value={selector.shape}
					options={TEXT_SELECTOR_SHAPE_OPTIONS}
					resetKey={`${binding.id}:selector:${selectorIndex}:shape`}
					onCommit={(shape) => replaceSelector({ ...selector, shape })}
				/>
				<NumericField
					label="Amount"
					value={selector.amount}
					resetKey={`${binding.id}:selector:${selectorIndex}:amount`}
					step="1"
					onCommit={(amount) => replaceSelector({ ...selector, amount })}
				/>
				{(
					[
						["start", "Start"],
						["end", "End"],
						["offset", "Offset"],
					] as const
				).map(([key, label]) => (
					<NumericField
						key={key}
						label={label}
						value={selector[key]}
						resetKey={`${binding.id}:selector:${selectorIndex}:${key}`}
						step="1"
						onCommit={(value) => replaceSelector({ ...selector, [key]: value })}
					/>
				))}
			</div>
			<div className="space-y-1">
				<div className="flex items-center justify-between gap-1 text-fg-muted text-ui">
					<span>Offset keys ({offsetKeys.length})</span>
					<InspectorIconButton
						label={`Add offset key at frame ${currentFrame}`}
						onClick={() => {
							const existing = offsetKeys.find(
								(keyframe) => keyframe.time === currentFrame,
							);
							if (existing) {
								setOffsetKeys(
									offsetKeys.map((keyframe) =>
										keyframe.time === currentFrame
											? { ...keyframe, value: selector.offset }
											: keyframe,
									),
								);
								return;
							}
							setOffsetKeys(
								[
									...offsetKeys,
									{ time: currentFrame, value: selector.offset },
								].sort((left, right) => left.time - right.time),
							);
						}}
					>
						<Plus aria-hidden="true" size={11} />
					</InspectorIconButton>
				</div>
				{offsetKeys.map((keyframe, keyIndex) => (
					<div
						key={keyframe.time}
						className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-1"
					>
						<NumericField
							label="Frame"
							value={keyframe.time}
							resetKey={`${binding.id}:selector:${selectorIndex}:key:${keyIndex}:time`}
							step="1"
							onCommit={(time) => {
								const normalized = Math.max(0, Math.round(time));
								if (
									offsetKeys.some(
										(candidate, index) =>
											index !== keyIndex && candidate.time === normalized,
									)
								)
									return false;
								return setOffsetKeys(
									offsetKeys
										.map((candidate, index) =>
											index === keyIndex
												? { ...candidate, time: normalized }
												: candidate,
										)
										.sort((left, right) => left.time - right.time),
								);
							}}
						/>
						<NumericField
							label="Value"
							value={keyframe.value}
							resetKey={`${binding.id}:selector:${selectorIndex}:key:${keyIndex}:value`}
							step="1"
							onCommit={(value) =>
								setOffsetKeys(
									offsetKeys.map((candidate, index) =>
										index === keyIndex ? { ...candidate, value } : candidate,
									),
								)
							}
						/>
						<InspectorIconButton
							label={`Remove offset key at frame ${keyframe.time}`}
							tone="danger"
							onClick={() =>
								setOffsetKeys(
									offsetKeys.filter((_candidate, index) => index !== keyIndex),
								)
							}
						>
							<Trash aria-hidden="true" size={11} />
						</InspectorIconButton>
					</div>
				))}
			</div>
		</div>
	);
}

/**
 * Text Motion semantic editor. Presets remain the quick path, while every
 * durable binding field (identity, enablement, unit, clip, properties, selector
 * order/shape/range, and selector offset keys) stays editable through the same
 * Motion command.
 */
function TextMotionSection({ node }: { readonly node: VectorNode }) {
	const binding = useMotionStore((state) =>
		state.document.textAnimators?.find(
			(candidate) => candidate.target.nodeId === node.id,
		),
	);
	const currentFrame = useTransportStore((state) =>
		Math.max(0, Math.round(state.currentFrame)),
	);
	const isText = node.geometry.kind === "text";
	const isGroup = (node.children?.length ?? 0) > 0;
	if (!isText && !isGroup) return null;
	const target: NonNullable<TextAnimatorPresetOptions["target"]> = isText
		? "live-text"
		: "outline-group";
	const applyPreset = (
		create: (
			options: TextAnimatorPresetOptions,
		) => ReturnType<typeof createWordRiseBinding>,
	): void => {
		if (target === "outline-group" && !node.textFragmentGroup) {
			useSceneStore
				.getState()
				.apply(markGroupAsTextFragments(node.id, "character"));
		}
		useMotionStore
			.getState()
			.apply(setTextAnimator(create({ nodeId: node.id, target })));
	};
	const commitBinding = (next: TextAnimatorBinding): void => {
		useMotionStore.getState().apply(setTextAnimator(next));
	};
	const updateClip = (
		patch: Partial<NonNullable<TextAnimatorBinding["clip"]>>,
	): boolean => {
		if (!binding) return false;
		const current = binding.clip ?? { startFrame: 0, durationFrames: 30 };
		commitBinding({
			...binding,
			clip: {
				startFrame: Math.max(
					0,
					Math.round(patch.startFrame ?? current.startFrame),
				),
				durationFrames: Math.max(
					1,
					Math.round(patch.durationFrames ?? current.durationFrames),
				),
			},
		});
		return true;
	};
	return (
		<PanelSection
			title="Sequence"
			icon={<TextT aria-hidden="true" size={12} />}
			action={
				binding ? (
					<button
						type="button"
						className={TEXT_MOTION_BUTTON}
						onClick={() =>
							useMotionStore.getState().apply(removeTextAnimator(binding.id))
						}
					>
						Remove
					</button>
				) : undefined
			}
		>
			<div className="grid grid-cols-3 gap-1">
				{TEXT_MOTION_PRESETS.map((preset) => (
					<button
						key={preset.name}
						type="button"
						className={cn(
							TEXT_MOTION_BUTTON,
							binding?.name === preset.name && TEXT_MOTION_BUTTON_ACTIVE,
						)}
						onClick={() => applyPreset(preset.create)}
					>
						{preset.name}
					</button>
				))}
			</div>
			<div className="mt-1 text-fg-muted text-ui">
				{binding
					? `Active: ${binding.name} · sweeps ${binding.unit} in order.`
					: `Reveal this ${isText ? "text by word, character, or line" : "group element by element"}.`}
			</div>
			{binding ? (
				<div className="mt-1.5 space-y-1.5 border-white/8 border-t pt-1.5">
					<div className="grid grid-cols-2 gap-1">
						<TextInputField
							label="Name"
							value={binding.name}
							resetKey={`${binding.id}:name`}
							onCommit={(name) => {
								const normalized = name.trim();
								if (!normalized) return false;
								commitBinding({ ...binding, name: normalized });
								return true;
							}}
						/>
						<SelectField
							label="Based on"
							value={binding.unit}
							options={TEXT_FRAGMENT_UNIT_OPTIONS}
							resetKey={`${binding.id}:unit`}
							onCommit={(unit) => {
								commitBinding({ ...binding, unit });
								return true;
							}}
						/>
					</div>
					<div className="grid grid-cols-2 gap-1">
						<button
							type="button"
							aria-pressed={binding.enabled}
							className={cn(
								TEXT_MOTION_BUTTON,
								binding.enabled && TEXT_MOTION_BUTTON_ACTIVE,
							)}
							onClick={() =>
								commitBinding({ ...binding, enabled: !binding.enabled })
							}
						>
							Enabled {binding.enabled ? "on" : "off"}
						</button>
						<button
							type="button"
							aria-pressed={binding.clip !== undefined}
							className={cn(
								TEXT_MOTION_BUTTON,
								binding.clip && TEXT_MOTION_BUTTON_ACTIVE,
							)}
							onClick={() => {
								if (!binding.clip) {
									updateClip({});
									return;
								}
								const { clip: _clip, ...withoutClip } = binding;
								commitBinding(withoutClip);
							}}
						>
							Clip window {binding.clip ? "on" : "off"}
						</button>
					</div>
					{binding.clip ? (
						<div className="grid grid-cols-2 gap-1">
							<NumericField
								label="Clip start"
								value={binding.clip.startFrame}
								resetKey={`${binding.id}:clip:start`}
								step="1"
								onCommit={(startFrame) => updateClip({ startFrame })}
							/>
							<NumericField
								label="Clip duration"
								value={binding.clip.durationFrames}
								resetKey={`${binding.id}:clip:duration`}
								step="1"
								onCommit={(durationFrames) => updateClip({ durationFrames })}
							/>
						</div>
					) : null}
					<div className="grid grid-cols-2 gap-1">
						{TEXT_ANIMATOR_PROPERTY_FIELDS.map((field) => (
							<OptionalNumericField
								key={field.key}
								label={field.label}
								value={binding.properties[field.key] ?? null}
								resetKey={`${binding.id}:property:${field.key}`}
								onCommit={(value) => {
									commitBinding({
										...binding,
										properties: withTextAnimatorProperty(
											binding.properties,
											field.key,
											value,
										),
									});
									return true;
								}}
							/>
						))}
					</div>
					<div className="space-y-1">
						{binding.selectors.map((selector, selectorIndex) => (
							<TextAnimatorSelectorEditor
								// biome-ignore lint/suspicious/noArrayIndexKey: RangeTextSelector has no id and the binding command contract addresses selectors by index.
								key={`${binding.id}:selector:${selectorIndex}`}
								binding={binding}
								selector={selector}
								selectorIndex={selectorIndex}
								currentFrame={currentFrame}
								onChange={commitBinding}
							/>
						))}
						<button
							type="button"
							className={cn(TEXT_MOTION_BUTTON, "w-full")}
							onClick={() =>
								commitBinding({
									...binding,
									selectors: [
										...binding.selectors,
										{
											kind: "range",
											mode: "add",
											units: "percent",
											start: 0,
											end: 100,
											offset: 0,
											amount: 100,
											shape: "smooth",
										},
									],
								})
							}
						>
							Add range selector
						</button>
					</div>
				</div>
			) : null}
		</PanelSection>
	);
}

/**
 * The single-node Transform section (X/Y/W/H/R + opacity, with per-group
 * keyframe + recording controls). Extracted as a standalone export so the docked
 * Inspector rail and the FloatingInspector HUD render byte-identical controls
 * from one source — both author through the same `commitSingleInspectorNumberEdit`
 * path, so undo coalescing and keyframing behave the same in either surface.
 */
export function SingleNodeTransformSection({
	document,
	baseNode,
	keyframeState,
	recording,
	onToggleRecording,
}: {
	readonly document: SceneDocument;
	readonly baseNode: VectorNode;
	readonly keyframeState: ReadyInspectorKeyframeActionState;
	readonly recording: boolean;
	readonly onToggleRecording: () => void;
}) {
	const values = keyframeState.values;
	// A direct layout-managed child's position/size are owned by its layout
	// frame (see LAYOUT_MANAGED_DISABLED_TRANSFORM_FIELDS); the runner would
	// otherwise fight or silently discard a raw X/Y/W/H write here.
	const isLayoutManagedChild =
		findLayoutChildSelection(document, baseNode.id) !== null;
	return (
		<PanelSection
			title="Transform"
			icon={<SlidersHorizontal aria-hidden="true" size={12} />}
			action={
				<div className="flex items-center gap-1">
					<KeyframeGroupButton
						keyframeState={keyframeState}
						group="transform"
						label="transform"
						icon={<SlidersHorizontal aria-hidden="true" size={10} />}
					/>
					<KeyframeGroupButton
						keyframeState={keyframeState}
						group="opacity"
						label="opacity"
						icon={<Circle aria-hidden="true" size={8} weight="fill" />}
					/>
					<RecordingButton recording={recording} onToggle={onToggleRecording} />
				</div>
			}
		>
			<div className="space-y-1">
				<PivotPresetGrid
					node={baseNode}
					recording={recording}
					keyframeState={keyframeState}
				/>
				<div className="grid grid-cols-2 gap-1">
					{transformFields.map(({ label, field, step }) => {
						const managedDisabled =
							isLayoutManagedChild &&
							LAYOUT_MANAGED_DISABLED_TRANSFORM_FIELDS.has(field);
						return (
							<NumericField
								key={field}
								label={label}
								value={values[field]}
								resetKey={`${keyframeState.resetKey}:${field}`}
								step={step}
								disabled={managedDisabled}
								title={managedDisabled ? "Managed by grid layout" : undefined}
								action={
									<TransformFieldActions
										keyframeState={keyframeState}
										field={field}
										label={label}
									/>
								}
								onCommit={(value) =>
									commitSingleInspectorNumberEdit(
										baseNode,
										recording,
										keyframeState,
										field,
										value,
									)
								}
							/>
						);
					})}
					<NumericField
						label="O 0-1"
						value={values.opacity}
						resetKey={`${keyframeState.resetKey}:opacity`}
						step="0.05"
						action={
							<TransformFieldActions
								keyframeState={keyframeState}
								field="opacity"
								label="O"
							/>
						}
						onCommit={(value) =>
							commitSingleInspectorNumberEdit(
								baseNode,
								recording,
								keyframeState,
								"opacity",
								value,
							)
						}
					/>
				</div>
			</div>
		</PanelSection>
	);
}

/**
 * The single-node Appearance section (fill/stroke/effects stack + corner radius +
 * a motion readout). Extracted as a standalone export for the same rail/Floating
 * reuse reason as {@link SingleNodeTransformSection}.
 *
 * The per-row appearance-stack editor is hidden for a group/Blend wrapper: its
 * own paint list is a fixed placeholder with no rendering effect (see
 * {@link isWrapperContainer}), so listing it would let the user "edit" fills and
 * strokes that never appear on canvas. `AppearanceControls` above already reaches
 * the container's actual drawable children through the paint-target expansion.
 */
export function SingleNodeAppearanceSection({
	document,
	baseNode,
	motion,
	resetKey,
}: {
	readonly document: SceneDocument;
	readonly baseNode: VectorNode;
	readonly motion: MotionDocument;
	readonly resetKey: string;
}) {
	return (
		<PanelSection
			title="Appearance"
			icon={<Swatches aria-hidden="true" size={12} />}
		>
			<AppearanceControls
				document={document}
				nodes={[baseNode]}
				resetKey={`${resetKey}:appearance`}
				showFill={true}
				extraControls={
					<>
						<CornerControls node={baseNode} resetKey={`${resetKey}:corners`} />
						<ReadoutRow
							label="Motion"
							value={isNodeAnimated(motion, baseNode.id) ? "keyed" : "base"}
						/>
					</>
				}
			/>
			{isWrapperContainer(baseNode) ? (
				<p className="border-white/8 border-t px-0.5 pt-1.5 text-fg-subtle text-ui">
					Appearance edits apply to the group's contents.
				</p>
			) : (
				<AppearanceStackSection document={document} node={baseNode} />
			)}
		</PanelSection>
	);
}

/**
 * The single-node Text section (content + box + typography). Renders nothing for
 * non-text nodes. Extracted as a standalone export for the same rail/Floating
 * reuse reason as {@link SingleNodeTransformSection}; it owns its own text-editing
 * state derivation so either surface can mount it from just the node.
 */
export function SingleNodeTextSection({
	document,
	baseNode,
	resetKey,
	recording,
	keyframeState,
}: {
	readonly document: SceneDocument;
	readonly baseNode: VectorNode;
	readonly resetKey: string;
	readonly recording: boolean;
	readonly keyframeState: ReadyInspectorKeyframeActionState;
}) {
	const textState = textEditingStateForSelection([baseNode]);
	const textBoxState = textBoxEditingStateForSelection([baseNode]);
	const textStyleState = textStyleEditingStateForSelection([baseNode]);
	if (!textState.canEdit) return null;
	return (
		<PanelSection title="Text" icon={<TextT aria-hidden="true" size={12} />}>
			<div className="space-y-1.5">
				<TextAreaField
					label="Content"
					value={textState.value}
					resetKey={`${resetKey}:text-content`}
					onCommit={(value) => commitTextContent(textState.textNodeIds, value)}
				/>
				<TextBoxControls
					state={textBoxState}
					resetKey={`${document.id}:${baseNode.id}:text-box`}
					singleAuthoringTarget={{ node: baseNode, recording, keyframeState }}
				/>
				<TypographyControls
					state={textStyleState}
					resetKey={`${resetKey}:text-style`}
				/>
			</div>
		</PanelSection>
	);
}

const LAYOUT_PRESET_LABELS = {
	"uniform-grid": "Uniform",
	"bento-hero-left": "Hero L",
	"bento-hero-top": "Hero T",
	"bento-mosaic": "Mosaic",
} as const satisfies Record<LayoutFramePresetId, string>;

const LAYOUT_CELL_FIT_LABELS = {
	contain: "Fit",
	cover: "Fill",
} as const satisfies Record<LayoutCellFitMode, string>;

const LAYOUT_CELL_FIT_MODES = [
	"contain",
	"cover",
] as const satisfies readonly LayoutCellFitMode[];

function LayoutFrameSection({
	node,
	resetKey,
}: {
	readonly node: VectorNode;
	readonly resetKey: string;
}) {
	if (node.frame?.kind !== "frame") return null;
	const layoutEnabled = !!node.frame.layout;
	const layout = normalizeLayoutFrameContract(node.frame.layout);
	const frameWidth =
		node.geometry.kind === "rect" ? node.geometry.bounds.width : undefined;
	const childIds = node.children?.map((child) => child.id) ?? [];
	const resolvedPlan =
		node.geometry.kind === "rect"
			? resolveLayoutFramePlan(node.geometry.bounds, layout, childIds)
			: null;
	const effectiveLayout = effectiveLayoutFrameContract(
		resolvedPlan?.layout ?? layout,
		{
			width: frameWidth,
		},
	);
	const variants = layout.variants ?? [];
	const inspectorVariantId = resolveLayoutFrameWriteVariantId(
		layout,
		frameWidth,
	);
	const activeVariant = variants.find(
		(variant) => variant.id === inspectorVariantId,
	);
	const visibleRows =
		effectiveLayout.rows === "auto"
			? (resolvedPlan?.rows ?? 1)
			: effectiveLayout.rows;
	const commitLayoutPatch = (patch: LayoutFramePatch): boolean => {
		useSceneStore
			.getState()
			.apply(createUpdateLayoutFrameCommand(node.id, patch));
		return true;
	};
	const selectAutoMode = (): void => {
		commitLayoutPatch({ variantMode: "auto" });
	};
	const selectBase = (): void => {
		commitLayoutPatch({ activeVariantId: null, variantMode: null });
	};
	const selectVariant = (variantId: string | null): void => {
		commitLayoutPatch({ activeVariantId: variantId, variantMode: null });
	};
	const addVariant = (): void => {
		const variantId = createId("layout-variant");
		const minWidth =
			typeof frameWidth === "number" ? Math.max(0, Math.round(frameWidth)) : 0;
		const variant = {
			id: variantId,
			name: `Variant ${variants.length + 1}`,
			minWidth,
			columns: effectiveLayout.columns,
			rows: effectiveLayout.rows,
			gap: effectiveLayout.gap,
			padding: effectiveLayout.padding,
			autoFlow: effectiveLayout.autoFlow,
			allowOverlap: !!effectiveLayout.allowOverlap,
			...(effectiveLayout.preset ? { preset: effectiveLayout.preset } : {}),
			...(effectiveLayout.placements
				? { placements: effectiveLayout.placements }
				: {}),
		} satisfies LayoutFrameVariantContract;
		commitLayoutPatch({
			variants: [...variants, variant],
			activeVariantId: variantId,
			variantMode: null,
		});
	};
	const removeActiveVariant = (): void => {
		if (!inspectorVariantId) return;
		commitLayoutPatch({
			activeVariantId: null,
			variantMode: layout.variantMode === "auto" ? "auto" : null,
			variants: variants.filter((variant) => variant.id !== inspectorVariantId),
		});
	};
	const updateActiveVariantName = (name: string): boolean => {
		if (!activeVariant) return false;
		const trimmed = name.trim();
		if (!trimmed) return false;
		commitLayoutPatch({
			variants: variants.map((variant) =>
				variant.id === activeVariant.id
					? { ...variant, name: trimmed }
					: variant,
			),
		});
		return true;
	};
	const updateActiveVariantBounds = (patch: {
		readonly minWidth?: number | null;
		readonly maxWidth?: number | null;
	}): boolean => {
		if (!activeVariant) return false;
		const nextVariantWithBounds = (
			variant: LayoutFrameVariantContract,
		): LayoutFrameVariantContract => {
			const minWidth =
				patch.minWidth === undefined ? variant.minWidth : patch.minWidth;
			const maxWidth =
				patch.maxWidth === undefined ? variant.maxWidth : patch.maxWidth;
			return {
				id: variant.id,
				name: variant.name,
				...(minWidth === undefined || minWidth === null
					? {}
					: { minWidth: Math.max(0, Math.round(minWidth)) }),
				...(maxWidth === undefined || maxWidth === null
					? {}
					: { maxWidth: Math.max(0, Math.round(maxWidth)) }),
				...(variant.columns === undefined ? {} : { columns: variant.columns }),
				...(variant.rows === undefined ? {} : { rows: variant.rows }),
				...(variant.gap ? { gap: variant.gap } : {}),
				...(variant.padding ? { padding: variant.padding } : {}),
				...(variant.autoFlow ? { autoFlow: variant.autoFlow } : {}),
				...(variant.allowOverlap === undefined
					? {}
					: { allowOverlap: variant.allowOverlap }),
				...(variant.preset ? { preset: variant.preset } : {}),
				...(variant.placements ? { placements: variant.placements } : {}),
			};
		};
		commitLayoutPatch({
			variants: variants.map((variant) =>
				variant.id === activeVariant.id
					? nextVariantWithBounds(variant)
					: variant,
			),
		});
		return true;
	};
	const applyPreset = (preset: LayoutFramePresetId): void => {
		useSceneStore
			.getState()
			.apply(createApplyLayoutPresetCommand({ frameNodeId: node.id, preset }));
	};
	const reapplyLayout = (): void => {
		useSceneStore.getState().apply(createReapplyLayoutFrameCommand(node.id));
	};
	const packLayout = (): void => {
		useSceneStore.getState().apply(createPackLayoutFrameCommand(node.id));
	};

	if (!layoutEnabled) {
		return (
			<PanelSection
				title="Layout"
				icon={<GridFour aria-hidden="true" size={12} />}
			>
				<button
					type="button"
					className={cn(TEXT_MOTION_BUTTON, "w-full justify-center")}
					onClick={() => commitLayoutPatch({})}
				>
					Enable grid
				</button>
			</PanelSection>
		);
	}

	return (
		<PanelSection
			title="Layout"
			icon={<GridFour aria-hidden="true" size={12} />}
		>
			<div className="space-y-1.5">
				<div className="grid grid-cols-4 gap-1">
					<button
						type="button"
						className={cn(
							TEXT_MOTION_BUTTON,
							layout.variantMode === "auto" && TEXT_MOTION_BUTTON_ACTIVE,
						)}
						onClick={selectAutoMode}
					>
						Auto
					</button>
					<button
						type="button"
						className={cn(
							TEXT_MOTION_BUTTON,
							layout.variantMode !== "auto" &&
								!layout.activeVariantId &&
								TEXT_MOTION_BUTTON_ACTIVE,
						)}
						onClick={selectBase}
					>
						Base
					</button>
					<button
						type="button"
						className={TEXT_MOTION_BUTTON}
						onClick={addVariant}
					>
						+ Variant
					</button>
					<button
						type="button"
						className={TEXT_MOTION_BUTTON}
						disabled={!inspectorVariantId}
						onClick={removeActiveVariant}
					>
						Remove
					</button>
				</div>
				{variants.length > 0 ? (
					<div className="grid grid-cols-2 gap-1">
						{variants.map((variant) => (
							<button
								key={variant.id}
								type="button"
								className={cn(
									TEXT_MOTION_BUTTON,
									inspectorVariantId === variant.id &&
										TEXT_MOTION_BUTTON_ACTIVE,
								)}
								onClick={() => selectVariant(variant.id)}
							>
								{variant.name}
							</button>
						))}
					</div>
				) : null}
				{activeVariant ? (
					<div className="grid grid-cols-2 gap-1">
						<div className="col-span-2">
							<TextInputField
								label="Variant"
								value={activeVariant.name}
								resetKey={`${resetKey}:layout:${activeVariant.id}:name`}
								onCommit={updateActiveVariantName}
							/>
						</div>
						<OptionalNumericField
							label="Min W"
							value={activeVariant.minWidth ?? null}
							resetKey={`${resetKey}:layout:${activeVariant.id}:min-width`}
							onCommit={(value) =>
								updateActiveVariantBounds({ minWidth: value })
							}
						/>
						<OptionalNumericField
							label="Max W"
							value={activeVariant.maxWidth ?? null}
							resetKey={`${resetKey}:layout:${activeVariant.id}:max-width`}
							onCommit={(value) =>
								updateActiveVariantBounds({ maxWidth: value })
							}
						/>
					</div>
				) : null}
				<div className="grid grid-cols-3 gap-1">
					<button
						type="button"
						className={cn(
							TEXT_MOTION_BUTTON,
							effectiveLayout.autoFlow === "row" && TEXT_MOTION_BUTTON_ACTIVE,
						)}
						onClick={() => commitLayoutPatch({ autoFlow: "row" })}
					>
						Rows
					</button>
					<button
						type="button"
						className={cn(
							TEXT_MOTION_BUTTON,
							effectiveLayout.autoFlow === "column" &&
								TEXT_MOTION_BUTTON_ACTIVE,
						)}
						onClick={() => commitLayoutPatch({ autoFlow: "column" })}
					>
						Columns
					</button>
					<button
						type="button"
						className={cn(
							TEXT_MOTION_BUTTON,
							effectiveLayout.allowOverlap && TEXT_MOTION_BUTTON_ACTIVE,
						)}
						onClick={() =>
							commitLayoutPatch({
								allowOverlap: !effectiveLayout.allowOverlap,
							})
						}
					>
						Overlap
					</button>
				</div>
				<div className="grid grid-cols-2 gap-1">
					<NumericField
						label="Columns"
						value={effectiveLayout.columns}
						resetKey={`${resetKey}:layout:columns`}
						onCommit={(value) =>
							commitLayoutPatch({ columns: Math.max(1, Math.round(value)) })
						}
					/>
					<NumericField
						label="Rows"
						value={visibleRows}
						resetKey={`${resetKey}:layout:rows`}
						disabled={effectiveLayout.rows === "auto"}
						action={
							<button
								type="button"
								className={TEXT_MOTION_BUTTON}
								onClick={() =>
									commitLayoutPatch({
										rows:
											effectiveLayout.rows === "auto" ? visibleRows : "auto",
									})
								}
							>
								{effectiveLayout.rows === "auto" ? "Auto" : "Fixed"}
							</button>
						}
						onCommit={(value) =>
							commitLayoutPatch({ rows: Math.max(1, Math.round(value)) })
						}
					/>
				</div>
				<div className="grid grid-cols-2 gap-1">
					<NumericField
						label="Gap X"
						value={effectiveLayout.gap.x}
						resetKey={`${resetKey}:layout:gap-x`}
						onCommit={(value) => commitLayoutPatch({ gap: { x: value } })}
					/>
					<NumericField
						label="Gap Y"
						value={effectiveLayout.gap.y}
						resetKey={`${resetKey}:layout:gap-y`}
						onCommit={(value) => commitLayoutPatch({ gap: { y: value } })}
					/>
				</div>
				<div className="grid grid-cols-4 gap-1">
					<NumericField
						label="Top"
						value={effectiveLayout.padding.top}
						resetKey={`${resetKey}:layout:pad-top`}
						onCommit={(value) => commitLayoutPatch({ padding: { top: value } })}
					/>
					<NumericField
						label="Right"
						value={effectiveLayout.padding.right}
						resetKey={`${resetKey}:layout:pad-right`}
						onCommit={(value) =>
							commitLayoutPatch({ padding: { right: value } })
						}
					/>
					<NumericField
						label="Bottom"
						value={effectiveLayout.padding.bottom}
						resetKey={`${resetKey}:layout:pad-bottom`}
						onCommit={(value) =>
							commitLayoutPatch({ padding: { bottom: value } })
						}
					/>
					<NumericField
						label="Left"
						value={effectiveLayout.padding.left}
						resetKey={`${resetKey}:layout:pad-left`}
						onCommit={(value) =>
							commitLayoutPatch({ padding: { left: value } })
						}
					/>
				</div>
				<div className="grid grid-cols-4 gap-1">
					{LAYOUT_FRAME_PRESET_IDS.map((preset) => (
						<button
							key={preset}
							type="button"
							className={cn(
								TEXT_MOTION_BUTTON,
								effectiveLayout.preset === preset && TEXT_MOTION_BUTTON_ACTIVE,
							)}
							onClick={() => applyPreset(preset)}
						>
							{LAYOUT_PRESET_LABELS[preset]}
						</button>
					))}
				</div>
				<div className="grid grid-cols-3 gap-1">
					<button
						type="button"
						className={TEXT_MOTION_BUTTON}
						onClick={() =>
							commitLayoutPatch({ placements: null, preset: null })
						}
					>
						Clear cells
					</button>
					<button
						type="button"
						className={TEXT_MOTION_BUTTON}
						onClick={packLayout}
					>
						Pack cells
					</button>
					<button
						type="button"
						className={TEXT_MOTION_BUTTON}
						onClick={reapplyLayout}
					>
						Reapply
					</button>
				</div>
			</div>
		</PanelSection>
	);
}

type LayoutChildSelection = {
	readonly frame: VectorNode;
	readonly placement: LayoutCellPlacement;
};

type LayoutAncestorSummary = {
	readonly id: string;
	readonly name: string;
	readonly childCount: number;
};

type LayoutCellHostSelection = {
	readonly frame: VectorNode;
	readonly child: VectorNode;
	readonly placement: LayoutCellPlacement;
};

const resolvedLayoutChildPlacement = (
	frame: VectorNode,
	childId: string,
): LayoutCellPlacement => {
	if (frame.geometry.kind !== "rect" || !frame.frame?.layout) {
		return { column: 0, row: 0 };
	}
	const childIds = frame.children?.map((child) => child.id) ?? [];
	const plan = resolveLayoutFramePlan(
		frame.geometry.bounds,
		frame.frame.layout,
		childIds,
	);
	return (
		plan.cells.find((cell) => cell.nodeId === childId)?.placement ?? {
			column: 0,
			row: 0,
		}
	);
};

const containsNodeId = (node: VectorNode, nodeId: string): boolean =>
	node.id === nodeId ||
	!!node.children?.some((child) => containsNodeId(child, nodeId));

const findLayoutAncestors = (
	document: SceneDocument,
	nodeId: string,
): readonly LayoutAncestorSummary[] => {
	const visit = (
		nodes: readonly VectorNode[],
		ancestors: readonly LayoutAncestorSummary[],
	): readonly LayoutAncestorSummary[] | null => {
		for (const node of nodes) {
			if (node.id === nodeId) return ancestors;
			const nextAncestors = node.frame?.layout
				? [
						...ancestors,
						{
							id: node.id,
							name: node.name,
							childCount: node.children?.length ?? 0,
						},
					]
				: ancestors;
			if (node.children) {
				const nested = visit(node.children, nextAncestors);
				if (nested) return nested;
			}
		}
		return null;
	};

	for (const layer of document.layers) {
		const match = visit(layer.nodes, []);
		if (match) return match;
	}
	return [];
};

const findLayoutChildSelection = (
	document: SceneDocument,
	childNodeId: string,
): LayoutChildSelection | null => {
	const visit = (nodes: readonly VectorNode[]): LayoutChildSelection | null => {
		for (const node of nodes) {
			if (
				node.frame?.layout &&
				node.children?.some((child) => child.id === childNodeId)
			) {
				return {
					frame: node,
					placement: resolvedLayoutChildPlacement(node, childNodeId),
				};
			}
			if (node.children) {
				const nested = visit(node.children);
				if (nested) return nested;
			}
		}
		return null;
	};

	for (const layer of document.layers) {
		const match = visit(layer.nodes);
		if (match) return match;
	}
	return null;
};

const findLayoutCellHostSelection = (
	document: SceneDocument,
	nodeId: string,
): LayoutCellHostSelection | null => {
	const visit = (
		nodes: readonly VectorNode[],
	): LayoutCellHostSelection | null => {
		for (const node of nodes) {
			if (node.frame?.layout && node.children) {
				for (const child of node.children) {
					if (!containsNodeId(child, nodeId)) continue;
					const nested = visit([child]);
					return (
						nested ?? {
							frame: node,
							child,
							placement: resolvedLayoutChildPlacement(node, child.id),
						}
					);
				}
			}
			if (node.children) {
				const nested = visit(node.children);
				if (nested) return nested;
			}
		}
		return null;
	};

	for (const layer of document.layers) {
		const match = visit(layer.nodes);
		if (match) return match;
	}
	return null;
};

function LayoutPathSection({
	document,
	node,
}: {
	readonly document: SceneDocument;
	readonly node: VectorNode;
}) {
	const ancestors = findLayoutAncestors(document, node.id);
	const directCellSelection = findLayoutChildSelection(document, node.id);
	if (
		ancestors.length === 0 ||
		(directCellSelection !== null && ancestors.length === 1)
	) {
		return null;
	}
	const nearest = ancestors[ancestors.length - 1];
	const selectLayoutFrame = (frameNodeId: string): void => {
		useSelectionStore.getState().selectNode(frameNodeId);
	};

	return (
		<PanelSection
			title="Layout Path"
			icon={<StackSimple aria-hidden="true" size={12} />}
			action={
				nearest ? (
					<button
						type="button"
						className={cn(
							TEXT_MOTION_BUTTON,
							"inline-flex h-5 items-center gap-1 px-1.5 py-0",
						)}
						onClick={() => selectLayoutFrame(nearest.id)}
						title={`Select ${nearest.name}`}
					>
						<GridFour aria-hidden="true" size={11} />
						<span>Nearest</span>
					</button>
				) : null
			}
		>
			<div className="space-y-1">
				{ancestors.map((ancestor, index) => {
					const isNearest = index === ancestors.length - 1;
					return (
						<button
							key={ancestor.id}
							type="button"
							className={cn(
								TEXT_MOTION_BUTTON,
								"flex h-6 w-full items-center justify-between gap-1 px-1.5 py-0 text-left",
								isNearest && TEXT_MOTION_BUTTON_ACTIVE,
							)}
							onClick={() => selectLayoutFrame(ancestor.id)}
							title={`Select ${ancestor.name}`}
						>
							<span className="min-w-0 truncate">{ancestor.name}</span>
							<span className="shrink-0 font-mono text-fg-subtle">
								{ancestor.childCount}
							</span>
						</button>
					);
				})}
			</div>
		</PanelSection>
	);
}

function LayoutCellHostSection({
	document,
	node,
	resetKey,
}: {
	readonly document: SceneDocument;
	readonly node: VectorNode;
	readonly resetKey: string;
}) {
	const host = findLayoutCellHostSelection(document, node.id);
	if (!host || host.child.id === node.id) return null;
	const { frame, child, placement } = host;
	const selectNode = (nodeId: string): void => {
		useSelectionStore.getState().selectNode(nodeId);
	};
	const commitPlacement = (patch: Partial<LayoutCellPlacement>): boolean => {
		useSceneStore.getState().apply(
			createSetLayoutChildPlacementCommand({
				frameNodeId: frame.id,
				childNodeId: child.id,
				placement: {
					column: placement.column,
					row: placement.row,
					columnSpan: placement.columnSpan ?? 1,
					rowSpan: placement.rowSpan ?? 1,
					fit: placement.fit,
					...patch,
				},
			}),
		);
		return true;
	};

	return (
		<PanelSection
			title="Cell Host"
			icon={<GridFour aria-hidden="true" size={12} />}
		>
			<div className="space-y-1">
				<ReadoutRow label="Item" value={child.name} />
				<ReadoutRow label="Frame" value={frame.name} />
				<div className="grid grid-cols-2 gap-1">
					<button
						type="button"
						className={TEXT_MOTION_BUTTON}
						onClick={() => selectNode(child.id)}
						title={`Select ${child.name}`}
					>
						Item
					</button>
					<button
						type="button"
						className={TEXT_MOTION_BUTTON}
						onClick={() => selectNode(frame.id)}
						title={`Select ${frame.name}`}
					>
						Frame
					</button>
				</div>
				<div className="grid grid-cols-2 gap-1">
					<NumericField
						label="Column"
						value={placement.column}
						resetKey={`${resetKey}:layout-cell-host:${frame.id}:${child.id}:column`}
						onCommit={(value) =>
							commitPlacement({ column: Math.max(0, Math.round(value)) })
						}
					/>
					<NumericField
						label="Row"
						value={placement.row}
						resetKey={`${resetKey}:layout-cell-host:${frame.id}:${child.id}:row`}
						onCommit={(value) =>
							commitPlacement({ row: Math.max(0, Math.round(value)) })
						}
					/>
					<NumericField
						label="Col span"
						value={placement.columnSpan ?? 1}
						resetKey={`${resetKey}:layout-cell-host:${frame.id}:${child.id}:column-span`}
						onCommit={(value) =>
							commitPlacement({ columnSpan: Math.max(1, Math.round(value)) })
						}
					/>
					<NumericField
						label="Row span"
						value={placement.rowSpan ?? 1}
						resetKey={`${resetKey}:layout-cell-host:${frame.id}:${child.id}:row-span`}
						onCommit={(value) =>
							commitPlacement({ rowSpan: Math.max(1, Math.round(value)) })
						}
					/>
				</div>
				<div className="grid grid-cols-2 gap-1">
					{LAYOUT_CELL_FIT_MODES.map((fit) => (
						<button
							key={fit}
							type="button"
							className={cn(
								TEXT_MOTION_BUTTON,
								(placement.fit ?? "contain") === fit &&
									TEXT_MOTION_BUTTON_ACTIVE,
							)}
							onClick={() => commitPlacement({ fit })}
						>
							{LAYOUT_CELL_FIT_LABELS[fit]}
						</button>
					))}
				</div>
			</div>
		</PanelSection>
	);
}

function LayoutChildPlacementSection({
	document,
	node,
	resetKey,
}: {
	readonly document: SceneDocument;
	readonly node: VectorNode;
	readonly resetKey: string;
}) {
	const selection = findLayoutChildSelection(document, node.id);
	if (!selection) return null;
	const { frame, placement } = selection;
	const selectParentFrame = (): void => {
		useSelectionStore.getState().selectNode(frame.id);
	};
	const commitPlacement = (patch: Partial<LayoutCellPlacement>): boolean => {
		useSceneStore.getState().apply(
			createSetLayoutChildPlacementCommand({
				frameNodeId: frame.id,
				childNodeId: node.id,
				placement: {
					column: placement.column,
					row: placement.row,
					columnSpan: placement.columnSpan ?? 1,
					rowSpan: placement.rowSpan ?? 1,
					fit: placement.fit,
					...patch,
				},
			}),
		);
		return true;
	};

	return (
		<PanelSection
			title="Cell"
			icon={<GridFour aria-hidden="true" size={12} />}
			action={
				<button
					type="button"
					className={cn(
						TEXT_MOTION_BUTTON,
						"inline-flex h-5 items-center gap-1 px-1.5 py-0",
					)}
					onClick={selectParentFrame}
					title={`Select ${frame.name}`}
				>
					<StackSimple aria-hidden="true" size={11} />
					<span>Frame</span>
				</button>
			}
		>
			<div className="mb-1">
				<ReadoutRow label="Parent" value={frame.name} />
			</div>
			<div className="grid grid-cols-2 gap-1">
				<NumericField
					label="Column"
					value={placement.column}
					resetKey={`${resetKey}:layout-child:column`}
					onCommit={(value) =>
						commitPlacement({ column: Math.max(0, Math.round(value)) })
					}
				/>
				<NumericField
					label="Row"
					value={placement.row}
					resetKey={`${resetKey}:layout-child:row`}
					onCommit={(value) =>
						commitPlacement({ row: Math.max(0, Math.round(value)) })
					}
				/>
				<NumericField
					label="Col span"
					value={placement.columnSpan ?? 1}
					resetKey={`${resetKey}:layout-child:column-span`}
					onCommit={(value) =>
						commitPlacement({ columnSpan: Math.max(1, Math.round(value)) })
					}
				/>
				<NumericField
					label="Row span"
					value={placement.rowSpan ?? 1}
					resetKey={`${resetKey}:layout-child:row-span`}
					onCommit={(value) =>
						commitPlacement({ rowSpan: Math.max(1, Math.round(value)) })
					}
				/>
			</div>
			<div className="mt-1 grid grid-cols-2 gap-1">
				{LAYOUT_CELL_FIT_MODES.map((fit) => (
					<button
						key={fit}
						type="button"
						className={cn(
							TEXT_MOTION_BUTTON,
							(placement.fit ?? "contain") === fit && TEXT_MOTION_BUTTON_ACTIVE,
						)}
						onClick={() => commitPlacement({ fit })}
					>
						{LAYOUT_CELL_FIT_LABELS[fit]}
					</button>
				))}
			</div>
		</PanelSection>
	);
}

function CameraSelectionPanel({
	document,
	resetKey,
}: {
	readonly document: SceneDocument;
	readonly resetKey: string;
}) {
	return (
		<div className="space-y-1.5 py-1.5">
			<SceneCameraSection
				document={document}
				nodeIds={[]}
				primaryNodeId={null}
				resetKey={resetKey}
			/>
		</div>
	);
}

function MotionRelationSection({
	document,
	baseNode,
	motion,
}: {
	readonly document: SceneDocument;
	readonly baseNode: VectorNode;
	readonly motion: MotionDocument;
}) {
	const currentFrame = useTransportStore((state) => state.currentFrame);
	const artboardId = selectArtboardIdForNode(document, baseNode.id);
	const nodes = allNodes(document);
	const controllers = nodes.filter(
		(node) =>
			node.id !== baseNode.id &&
			node.motionController?.kind === "motion-controller" &&
			selectArtboardIdForNode(document, node.id) === artboardId,
	);
	const parent = baseNode.motionParent
		? findNode(document, baseNode.motionParent.parentNodeId)
		: undefined;
	const childIds = nodes
		.filter((node) => node.motionParent?.parentNodeId === baseNode.id)
		.map((node) => node.id);
	const assignParent = (controllerNodeId: string): boolean => {
		const plan = createParentSelectionToPrimaryPlan({
			scene: document,
			motion,
			frame: currentFrame,
			nodeIds: [baseNode.id, controllerNodeId],
			primaryNodeId: controllerNodeId,
		});
		if (!plan || plan.issues.length > 0) return false;
		commitMotionRelationAuthoringPlan(plan);
		useSelectionStore.getState().setSelection([baseNode.id], baseNode.id);
		return true;
	};
	const detach = (): void => {
		const plan = createDetachSelectionPlan({
			scene: document,
			motion,
			frame: currentFrame,
			nodeIds: [baseNode.id],
			primaryNodeId: baseNode.id,
		});
		if (plan.issues.length > 0) return;
		commitMotionRelationAuthoringPlan(plan);
	};

	return (
		<PanelSection
			title="Motion relation"
			icon={<LinkSimple aria-hidden="true" size={12} />}
		>
			<div className="space-y-1">
				{baseNode.motionController ? (
					<div className="grid grid-cols-2 gap-1">
						<ReadoutRow label="Role" value="controller" />
						<ReadoutRow label="Children" value={String(childIds.length)} />
					</div>
				) : null}
				<SelectField
					label="Parent"
					value={parent?.id ?? ""}
					options={controllers.map((controller) => ({
						value: controller.id,
						label: controller.name,
					}))}
					resetKey={`${document.id}:${baseNode.id}:motion-parent`}
					disabled={controllers.length === 0}
					onCommit={assignParent}
				/>
				<div className="grid grid-cols-2 gap-1">
					<button
						type="button"
						className={TEXT_MOTION_BUTTON}
						disabled={!parent}
						onClick={() => {
							if (parent)
								useSelectionStore
									.getState()
									.setSelection([parent.id], parent.id);
						}}
					>
						Select parent
					</button>
					<button
						type="button"
						className={TEXT_MOTION_BUTTON}
						disabled={!baseNode.motionParent}
						onClick={detach}
					>
						Detach
					</button>
				</div>
				{baseNode.motionParent && !parent ? (
					<div className="rounded border border-danger/30 bg-danger-surface px-1.5 py-1 text-danger-fg text-ui">
						Missing controller: {baseNode.motionParent.parentNodeId}
					</div>
				) : null}
				{childIds.length > 0 ? (
					<button
						type="button"
						className={cn(TEXT_MOTION_BUTTON, "w-full")}
						onClick={() =>
							useSelectionStore
								.getState()
								.setSelection(childIds, childIds.at(-1) ?? null)
						}
					>
						Select children
					</button>
				) : null}
			</div>
		</PanelSection>
	);
}

const RELATION_PROPERTY_OPTIONS = [
	{ value: "style.opacity", label: "Opacity" },
	{ value: "geometry.cornerRadius", label: "Corner radius" },
	{ value: "geometry.cornerSmoothing", label: "Corner smoothing" },
] as const satisfies readonly {
	readonly value: RelationNumericProperty;
	readonly label: string;
}[];

function ConstraintRelationsSection({
	document,
	baseNode,
	motion,
}: {
	readonly document: SceneDocument;
	readonly baseNode: VectorNode;
	readonly motion: MotionDocument;
}) {
	const currentFrame = useTransportStore((state) => state.currentFrame);
	const artboardId = selectArtboardIdForNode(document, baseNode.id);
	const candidates = allNodes(document).filter(
		(node) =>
			node.id !== baseNode.id &&
			selectArtboardIdForNode(document, node.id) === artboardId,
	);
	const constraint = baseNode.transformConstraint;
	const source = constraint
		? findNode(document, constraint.sourceNodeId)
		: undefined;
	const setConstraintSource = (sourceNodeId: string): boolean => {
		const sampled = sampleMotionRelationLocalScene(
			document,
			motion,
			currentFrame,
		);
		const plan = planTransformConstraintCommand({
			scene: sampled,
			nodeId: baseNode.id,
			sourceNodeId,
			channels: constraint?.channels ?? ["position"],
			strength: constraint?.strength ?? 1,
			sourceSpace: constraint?.sourceSpace ?? "world",
			destinationSpace: constraint?.destinationSpace ?? "world",
			maintainOffset: constraint?.maintainOffset ?? true,
		});
		if (plan.status === "blocked") return false;
		useSceneStore.getState().apply(plan.command);
		return true;
	};
	const updateConstraint = (
		patch: Partial<NonNullable<VectorNode["transformConstraint"]>>,
	): void => {
		if (!constraint) return;
		useSceneStore.getState().apply(
			createSetTransformConstraintCommand(baseNode.id, {
				...constraint,
				...patch,
			}),
		);
	};
	const replanConstraintSpaces = (
		patch: Partial<
			Pick<
				NonNullable<VectorNode["transformConstraint"]>,
				"sourceSpace" | "destinationSpace"
			>
		>,
	): boolean => {
		if (!constraint) return false;
		const sampled = sampleMotionRelationLocalScene(
			document,
			motion,
			currentFrame,
		);
		const plan = planTransformConstraintCommand({
			scene: sampled,
			nodeId: baseNode.id,
			sourceNodeId: constraint.sourceNodeId,
			channels: constraint.channels,
			strength: constraint.strength,
			sourceSpace: patch.sourceSpace ?? constraint.sourceSpace,
			destinationSpace: patch.destinationSpace ?? constraint.destinationSpace,
			maintainOffset: constraint.maintainOffset,
		});
		if (plan.status === "blocked") return false;
		useSceneStore.getState().apply(plan.command);
		return true;
	};
	const toggleChannel = (channel: "position" | "rotation" | "scale"): void => {
		if (!constraint) return;
		const channels = constraint.channels.includes(channel)
			? constraint.channels.filter((candidate) => candidate !== channel)
			: [...constraint.channels, channel];
		if (channels.length === 0) return;
		updateConstraint({ channels });
	};
	const propertyRelations = baseNode.propertyRelations ?? [];
	const firstCandidate = candidates[0];

	return (
		<PanelSection
			title="Constraints"
			icon={<ArrowsLeftRight aria-hidden="true" size={12} />}
		>
			<div className="space-y-1.5">
				<SelectField
					label="Transform source"
					value={source?.id ?? ""}
					options={candidates.map((candidate) => ({
						value: candidate.id,
						label: candidate.name,
					}))}
					resetKey={`${document.id}:${baseNode.id}:constraint-source`}
					disabled={candidates.length === 0 || Boolean(baseNode.motionParent)}
					onCommit={setConstraintSource}
				/>
				{constraint ? (
					<>
						<div className="grid grid-cols-3 gap-1">
							{(["position", "rotation", "scale"] as const).map((channel) => (
								<button
									key={channel}
									type="button"
									className={cn(
										TEXT_MOTION_BUTTON,
										constraint.channels.includes(channel) &&
											TEXT_MOTION_BUTTON_ACTIVE,
									)}
									onClick={() => toggleChannel(channel)}
								>
									{channel}
								</button>
							))}
						</div>
						<div className="grid grid-cols-2 gap-1">
							<SelectField
								label="Source space"
								value={constraint.sourceSpace}
								options={[
									{ value: "local", label: "Local" },
									{ value: "world", label: "World" },
								]}
								resetKey={`${constraint.id}:source-space`}
								onCommit={(value) => {
									return replanConstraintSpaces({ sourceSpace: value });
								}}
							/>
							<SelectField
								label="Target space"
								value={constraint.destinationSpace}
								options={[
									{ value: "local", label: "Local" },
									{ value: "world", label: "World" },
								]}
								resetKey={`${constraint.id}:destination-space`}
								onCommit={(value) => {
									return replanConstraintSpaces({
										destinationSpace: value,
									});
								}}
							/>
						</div>
						<NumericField
							label="Strength"
							value={constraint.strength * 100}
							resetKey={`${constraint.id}:strength`}
							step="1"
							onCommit={(value) => {
								updateConstraint({
									strength: Math.min(1, Math.max(0, value / 100)),
								});
								return true;
							}}
						/>
						<div className="grid grid-cols-2 gap-1">
							<button
								type="button"
								className={TEXT_MOTION_BUTTON}
								disabled={!source}
								onClick={() =>
									source &&
									useSelectionStore
										.getState()
										.setSelection([source.id], source.id)
								}
							>
								Select source
							</button>
							<button
								type="button"
								className={TEXT_MOTION_BUTTON}
								onClick={() =>
									useSceneStore
										.getState()
										.apply(createRemoveTransformConstraintCommand(baseNode.id))
								}
							>
								Remove
							</button>
						</div>
					</>
				) : null}
				<div className="border-white/8 border-t pt-1.5">
					<div className="mb-1 flex items-center justify-between text-fg-secondary text-ui">
						<span>Property relations</span>
						<button
							type="button"
							className={TEXT_MOTION_BUTTON}
							disabled={!firstCandidate}
							onClick={() =>
								firstCandidate &&
								useSceneStore.getState().apply(
									createSetPropertyRelationCommand({
										nodeId: baseNode.id,
										sourceNodeId: firstCandidate.id,
										sourceProperty: "style.opacity",
										targetProperty: "style.opacity",
									}),
								)
							}
						>
							Add
						</button>
					</div>
					{propertyRelations.map((relation) => (
						<div
							key={relation.id}
							className="mb-1 space-y-1 rounded-md border border-white/8 bg-black/15 p-1"
						>
							<SelectField
								label="Source"
								value={relation.sourceNodeId}
								options={candidates.map((candidate) => ({
									value: candidate.id,
									label: candidate.name,
								}))}
								resetKey={`${relation.id}:source`}
								onCommit={(value) => {
									useSceneStore.getState().apply(
										createSetPropertyRelationCommand({
											...relation,
											nodeId: baseNode.id,
											sourceNodeId: value,
										}),
									);
									return true;
								}}
							/>
							<div className="grid grid-cols-2 gap-1">
								<SelectField
									label="From"
									value={relation.sourceProperty}
									options={RELATION_PROPERTY_OPTIONS}
									resetKey={`${relation.id}:source-property`}
									onCommit={(value) => {
										useSceneStore.getState().apply(
											createSetPropertyRelationCommand({
												...relation,
												nodeId: baseNode.id,
												sourceProperty: value,
											}),
										);
										return true;
									}}
								/>
								<SelectField
									label="To"
									value={relation.targetProperty}
									options={RELATION_PROPERTY_OPTIONS}
									resetKey={`${relation.id}:target-property`}
									onCommit={(value) => {
										useSceneStore.getState().apply(
											createSetPropertyRelationCommand({
												...relation,
												nodeId: baseNode.id,
												targetProperty: value,
											}),
										);
										return true;
									}}
								/>
							</div>
							<div className="grid grid-cols-2 gap-1">
								<NumericField
									label="Scale"
									value={relation.scale}
									resetKey={`${relation.id}:scale`}
									step="0.1"
									onCommit={(value) => {
										useSceneStore.getState().apply(
											createSetPropertyRelationCommand({
												...relation,
												nodeId: baseNode.id,
												scale: value,
											}),
										);
										return true;
									}}
								/>
								<NumericField
									label="Offset"
									value={relation.offset}
									resetKey={`${relation.id}:offset`}
									step="0.1"
									onCommit={(value) => {
										useSceneStore.getState().apply(
											createSetPropertyRelationCommand({
												...relation,
												nodeId: baseNode.id,
												offset: value,
											}),
										);
										return true;
									}}
								/>
							</div>
							<button
								type="button"
								className={cn(TEXT_MOTION_BUTTON, "w-full")}
								onClick={() =>
									useSceneStore
										.getState()
										.apply(
											createRemovePropertyRelationCommand(
												baseNode.id,
												relation.id,
											),
										)
								}
							>
								Remove property relation
							</button>
						</div>
					))}
				</div>
			</div>
		</PanelSection>
	);
}

function SpatialMotionPathSection({
	baseNode,
	motion,
}: {
	readonly baseNode: VectorNode;
	readonly motion: MotionDocument;
}) {
	const path = buildMotionPath(baseNode, motion);
	if (path.anchors.length < 2) return null;
	const spatial = resolvePositionPath(motion, baseNode.id);
	const enable = (): void => {
		const command = enablePositionPath(
			baseNode.id,
			path.anchors.map((anchor) => ({
				frame: anchor.frame,
				position: { x: anchor.x, y: anchor.y },
			})),
		);
		// Camera-first just-in-time supply (Phase P4): a position path is always
		// spatial motion, so ensure a camera before enabling it and fold the
		// compound id onto this one command so undo reverts both together.
		const artboardId = selectArtboardIdForNode(
			useSceneStore.getState().document,
			baseNode.id,
		);
		const cameraResult = artboardId
			? ensureSceneCameraBeforeSpatialAuthoring({ artboardId, isSpatial: true })
			: ({ ensured: false } as const);
		useMotionStore
			.getState()
			.apply(
				cameraResult.ensured
					? { ...command, compoundId: cameraResult.compoundId }
					: command,
			);
		useToolSelectionStore.getState().setActiveTool("motion-path");
	};
	const setAllAuto = (): void => {
		const store = useMotionStore.getState();
		store.beginTransaction(
			`motion-path-auto:${baseNode.id}`,
			"Set auto spatial path",
		);
		for (const key of spatial.keys) {
			store.apply(setPositionPathSpatialMode(baseNode.id, key.frame, "auto"));
		}
		store.commit();
	};
	const commitTangent = (
		frame: number,
		direction: "in" | "out",
		current: { readonly x: number; readonly y: number },
		axis: "x" | "y",
		value: number,
		breakContinuity: boolean,
	): boolean => {
		useMotionStore
			.getState()
			.apply(
				setPositionPathTangent(
					baseNode.id,
					frame,
					direction,
					{ ...current, [axis]: value },
					{ breakContinuity },
				),
			);
		return true;
	};

	return (
		<PanelSection
			title="Spatial path"
			icon={<ArrowsOutSimple aria-hidden="true" size={12} />}
		>
			{spatial.track ? (
				<div className="space-y-1">
					<div className="grid grid-cols-2 gap-1">
						<ReadoutRow label="Stops" value={String(spatial.keys.length)} />
						<ReadoutRow
							label="Roving"
							value={String(spatial.keys.filter((key) => key.roving).length)}
						/>
					</div>
					<div className="grid grid-cols-2 gap-1">
						<button
							type="button"
							className={TEXT_MOTION_BUTTON}
							onClick={() =>
								useToolSelectionStore.getState().setActiveTool("motion-path")
							}
						>
							Edit on canvas
						</button>
						<button
							type="button"
							className={TEXT_MOTION_BUTTON}
							onClick={setAllAuto}
						>
							Auto tangents
						</button>
						<button
							type="button"
							className={TEXT_MOTION_BUTTON}
							disabled={!spatial.keys.some((key) => key.roving)}
							onClick={() =>
								useMotionStore
									.getState()
									.apply(distributeRovingPositionKeys(baseNode.id))
							}
						>
							Distribute roving
						</button>
						<button
							type="button"
							className={TEXT_MOTION_BUTTON}
							onClick={() =>
								useMotionStore.getState().apply(removePositionPath(baseNode.id))
							}
						>
							Remove path
						</button>
					</div>
					<div className="space-y-1">
						{spatial.keys.map((key) => {
							const breakContinuity = key.spatialMode === "corner";
							return (
								<div
									key={key.frame}
									className="rounded-md border border-white/8 bg-black/15 p-1"
								>
									<div className="mb-1 flex items-center justify-between text-fg-secondary text-ui">
										<span>Frame {key.frame}</span>
										<span>{key.spatialMode}</span>
									</div>
									<div className="grid grid-cols-2 gap-1">
										{(["in", "out"] as const).flatMap((direction) => {
											const tangent =
												direction === "in"
													? key.resolvedInTangent
													: key.resolvedOutTangent;
											return (["x", "y"] as const).map((axis) => (
												<NumericField
													key={`${direction}-${axis}`}
													label={`${direction === "in" ? "In" : "Out"} ${axis.toUpperCase()}`}
													value={tangent[axis]}
													resetKey={`${baseNode.id}:${key.frame}:${direction}:${axis}:${tangent[axis]}`}
													step="0.1"
													onCommit={(value) =>
														commitTangent(
															key.frame,
															direction,
															tangent,
															axis,
															value,
															breakContinuity,
														)
													}
												/>
											));
										})}
									</div>
								</div>
							);
						})}
					</div>
					{spatial.issues.length > 0 ? (
						<div className="rounded border border-danger/30 bg-danger-surface px-1.5 py-1 text-danger-fg text-ui">
							{spatial.issues[0].message}
						</div>
					) : null}
				</div>
			) : (
				<button
					type="button"
					className={cn(TEXT_MOTION_BUTTON, "w-full")}
					onClick={enable}
				>
					Enable direct path editing
				</button>
			)}
		</PanelSection>
	);
}

function MorphTopologySection({
	baseNode,
	motion,
}: {
	readonly baseNode: VectorNode;
	readonly motion: MotionDocument;
}) {
	const currentFrame = useTransportStore((state) => state.currentFrame);
	const track = findTrack(motion, baseNode.id, "pathShape");
	if (
		baseNode.geometry.kind !== "path" ||
		!track ||
		track.keyframes.length < 2
	) {
		return null;
	}
	const inspection = inspectMorphTopology(track);
	const activeKey = track.keyframes.find((key) => key.time === currentFrame);
	const activeVertexCount = isValidPathShape(activeKey?.value)
		? activeKey.value.vertices.length
		: 0;
	const activeClosed = isValidPathShape(activeKey?.value)
		? activeKey.value.closed
		: false;
	return (
		<PanelSection
			title="Morph topology"
			icon={<Diamond aria-hidden="true" size={12} />}
		>
			<div className="space-y-1">
				<div className="grid grid-cols-2 gap-1">
					<ReadoutRow label="Keys" value={String(track.keyframes.length)} />
					<ReadoutRow
						label="Topology"
						value={
							inspection.compatible
								? `${inspection.targetVertexCount} matched`
								: inspection.vertexCounts.join(" / ")
						}
					/>
				</div>
				<div className="grid grid-cols-2 gap-1">
					<button
						type="button"
						className={TEXT_MOTION_BUTTON}
						disabled={inspection.issues.length > 0 || inspection.compatible}
						onClick={() =>
							useMotionStore.getState().apply(repairPathMorphTopology(track.id))
						}
					>
						Repair counts
					</button>
					<button
						type="button"
						className={TEXT_MOTION_BUTTON}
						disabled={!activeKey || activeVertexCount < 2}
						onClick={() => {
							if (!activeKey) return;
							useMotionStore
								.getState()
								.apply(reversePathMorphKeyWinding(track.id, activeKey.time));
						}}
					>
						Reverse winding
					</button>
				</div>
				<NumericField
					label="First vertex"
					value={0}
					resetKey={`${track.id}:${activeKey?.time ?? "none"}:first-vertex`}
					step="1"
					disabled={!activeKey || activeVertexCount < 2 || !activeClosed}
					onCommit={(index) => {
						if (!activeKey) return false;
						useMotionStore
							.getState()
							.apply(setPathMorphFirstVertex(track.id, activeKey.time, index));
						return true;
					}}
				/>
				{inspection.issues[0] ? (
					<div className="rounded border border-danger/30 bg-danger-surface px-1.5 py-1 text-danger-fg text-ui">
						{inspection.issues[0].message}
					</div>
				) : !activeKey ? (
					<div className="text-fg-muted text-ui">
						Move the playhead onto a path key to edit its seam or winding.
					</div>
				) : null}
			</div>
		</PanelSection>
	);
}

function SingleSelectionPanel({
	document,
	baseNode,
	motion,
	recording,
	onToggleRecording,
	keyframeState,
	resetKey,
	suppressMotion = false,
}: {
	readonly document: SceneDocument;
	readonly baseNode: VectorNode;
	readonly motion: MotionDocument;
	readonly recording: boolean;
	readonly onToggleRecording: () => void;
	readonly keyframeState: ReadyInspectorKeyframeActionState;
	readonly resetKey: string;
	/**
	 * Suppresses the trailing per-node Motion section. Set only by the motion
	 * clip branch, where the clip-level system Motion section already owns the
	 * same grammar binding — rendering the per-node projection too would mount a
	 * duplicate motion subtree for the identical binding. Default falsy keeps the
	 * standalone-selection callers byte-identical.
	 */
	readonly suppressMotion?: boolean;
}) {
	const stageGReadout = createStageGInspectorReadout(document, [baseNode]);

	return (
		<div className="space-y-1.5 py-1.5">
			<div className="mx-1.5 min-w-0 rounded-md border border-accent/25 bg-accent-surface/45 px-2 py-1">
				<div className="truncate text-accent-fg text-ui">{baseNode.name}</div>
				<div className="mt-0.5 font-mono text-accent-fg text-ui">
					{baseNode.geometry.kind}
				</div>
			</div>

			<StageGReadoutSection readout={stageGReadout} />
			<ProgramSurfaceSection document={document} node={baseNode} />
			<BlenderLinkInspectorSection document={document} node={baseNode} />

			<TextMotionSection node={baseNode} />

			<SingleNodeTransformSection
				document={document}
				baseNode={baseNode}
				keyframeState={keyframeState}
				recording={recording}
				onToggleRecording={onToggleRecording}
			/>
			<MotionRelationSection
				document={document}
				baseNode={baseNode}
				motion={motion}
			/>
			<ConstraintRelationsSection
				document={document}
				baseNode={baseNode}
				motion={motion}
			/>
			<SpatialMotionPathSection baseNode={baseNode} motion={motion} />
			<MorphTopologySection baseNode={baseNode} motion={motion} />
			<SceneCameraSection
				document={document}
				nodeIds={[baseNode.id]}
				primaryNodeId={baseNode.id}
				resetKey={resetKey}
			/>
			<LayoutFrameSection node={baseNode} resetKey={resetKey} />
			<LayoutChildPlacementSection
				document={document}
				node={baseNode}
				resetKey={resetKey}
			/>
			<LayoutCellHostSection
				document={document}
				node={baseNode}
				resetKey={resetKey}
			/>
			<LayoutPathSection document={document} node={baseNode} />
			<SingleNodeTextSection
				document={document}
				baseNode={baseNode}
				resetKey={resetKey}
				recording={recording}
				keyframeState={keyframeState}
			/>

			<SingleNodeAppearanceSection
				document={document}
				baseNode={baseNode}
				motion={motion}
				resetKey={resetKey}
			/>

			<PanelSection
				title="Source Optics"
				icon={<Circle aria-hidden="true" size={12} />}
			>
				<SourceOpticsControls document={document} nodeId={baseNode.id} />
			</PanelSection>

			<PanelSection
				title="Effect Field"
				icon={<MagicWand aria-hidden="true" size={12} />}
			>
				<EffectFieldControls document={document} nodeId={baseNode.id} />
			</PanelSection>

			<PanelSection
				title="Duplicate"
				icon={<StackSimple aria-hidden="true" size={12} />}
			>
				<DuplicateCodeControls nodeId={baseNode.id} />
			</PanelSection>

			<ComponentSection node={baseNode} />

			{suppressMotion ? null : (
				<MotionTechniqueSection nodeIds={[baseNode.id]} />
			)}

			<CodeableSection nodeId={baseNode.id} />
		</div>
	);
}

/**
 * One-step "Animate as text" for a multi-selection (e.g. imported outlined-text
 * paths): groups the selected top-level nodes, marks the group as an ordered
 * character fragment group, binds a Word Rise animator, and selects the new group —
 * collapsing the import → group → mark → animate mainline into a single undoable
 * action. Requires 2+ nodes that are all top-level in one layer (the grouping
 * command's contract); otherwise the action is disabled with a hint.
 */
function MultiTextMotionSection({
	document,
	nodeIds,
}: {
	readonly document: SceneDocument;
	readonly nodeIds: readonly string[];
}) {
	if (nodeIds.length < 2) return null;
	const layer = findLayerByNodeId(document, nodeIds[0]);
	const sameLayer =
		layer != null &&
		nodeIds.every((id) => layer.nodes.some((node) => node.id === id));
	const animateAsText = (): void => {
		if (!layer || !sameLayer) return;
		const groupId = createId("group");
		const sceneStore = useSceneStore.getState();
		sceneStore.beginTransaction(
			`animate-as-sequence:${groupId}`,
			"Animate as sequence",
		);
		sceneStore.apply(
			createGroupNodesCommand({
				layerId: layer.id,
				groupNodeId: groupId,
				sourceNodeIds: nodeIds,
				name: "Sequence",
			}),
		);
		sceneStore.apply(markGroupAsTextFragments(groupId, "character"));
		sceneStore.commit();
		useMotionStore
			.getState()
			.apply(
				setTextAnimator(
					createWordRiseBinding({ nodeId: groupId, target: "outline-group" }),
				),
			);
		useSelectionStore.getState().selectNode(groupId);
	};
	return (
		<PanelSection
			title="Sequence"
			icon={<TextT aria-hidden="true" size={12} />}
		>
			<button
				type="button"
				disabled={!sameLayer}
				className={cn(TEXT_MOTION_BUTTON, "w-full", !sameLayer && "opacity-50")}
				onClick={animateAsText}
			>
				Animate as sequence (Word Rise)
			</button>
			<div className="mt-1 text-fg-muted text-ui">
				{sameLayer
					? "Group these elements into one ordered sequence and reveal them in order — works on any objects, not just text."
					: "Select 2+ nodes in one layer to animate as a sequence."}
			</div>
		</PanelSection>
	);
}

/**
 * Multi-selection inspector body (shared Appearance/opacity/radius + Text when
 * every selection is text + per-batch Motion). Exported so the FloatingInspector
 * can reuse the WHOLE panel un-tabbed for 2+ selections — the float is single-
 * selection-tabbed but multi has few sections, so stacking the same component is
 * the zero-drift way to keep the float a complete editing surface across states.
 */
export function MultiSelectionPanel({
	document,
	baseNodes,
	primaryNodeId,
	resetKey,
	suppressMotion = false,
}: {
	readonly document: SceneDocument;
	readonly baseNodes: readonly VectorNode[];
	readonly primaryNodeId: string | null;
	readonly resetKey: string;
	/** See {@link SingleSelectionPanel} — suppresses the duplicate per-node Motion section in the clip branch. */
	readonly suppressMotion?: boolean;
}) {
	const nodeIds = baseNodes.map((node) => node.id);
	const rects = rectNodeCount(baseNodes);
	const textState = textEditingStateForSelection(baseNodes);
	const textBoxState = textBoxEditingStateForSelection(baseNodes);
	const textStyleState = textStyleEditingStateForSelection(baseNodes);
	const textBoxResetKey = `${document.id}:${textState.textNodeIds.join("|")}:text-box`;
	const stageGReadout = createStageGInspectorReadout(document, baseNodes);

	return (
		<div className="space-y-1.5 py-1.5">
			<div className="mx-1.5 rounded-md border border-white/10 bg-white/[0.035] px-2 py-1">
				<div className="font-mono text-fg text-ui">
					{baseNodes.length} selected
				</div>
				<div className="mt-0.5 text-fg-muted text-ui">
					{rects} rects
					{textState.textNodeCount > 0
						? ` / ${textState.textNodeCount} text`
						: ""}
				</div>
			</div>

			<StageGReadoutSection readout={stageGReadout} />

			<SceneCameraSection
				document={document}
				nodeIds={nodeIds}
				primaryNodeId={primaryNodeId}
				resetKey={resetKey}
			/>

			<MultiTextMotionSection document={document} nodeIds={nodeIds} />

			{textState.canEdit ? (
				<PanelSection
					title="Text"
					icon={<TextT aria-hidden="true" size={12} />}
				>
					<div className="space-y-1">
						<TextAreaField
							label="Content"
							value={textState.value}
							resetKey={`${resetKey}:text-content`}
							onCommit={(value) =>
								commitTextContent(textState.textNodeIds, value)
							}
						/>
						<TextBoxControls state={textBoxState} resetKey={textBoxResetKey} />
						<TypographyControls
							state={textStyleState}
							resetKey={`${resetKey}:text-style`}
						/>
						<ReadoutRow
							label="Scope"
							value={`${textState.textNodeCount}/${textState.totalNodeCount} text`}
						/>
					</div>
				</PanelSection>
			) : null}

			<PanelSection
				title="Appearance"
				icon={<Swatches aria-hidden="true" size={12} />}
			>
				<AppearanceControls
					document={document}
					nodes={baseNodes}
					resetKey={`${resetKey}:appearance`}
					showFill={true}
					extraControls={
						<>
							<NumericField
								label="O 0-1"
								value={mixedValue(baseNodes, (node) => node.style.opacity)}
								resetKey={`${resetKey}:opacity`}
								step="0.05"
								onCommit={(value) =>
									commitNodeStyleNumber(nodeIds, "opacity", value)
								}
							/>
							<NumericField
								label="Radius px"
								value={rectCornerRadiusValue(baseNodes)}
								resetKey={`${resetKey}:corner-radius`}
								step="1"
								disabled={rects === 0}
								onCommit={(value) => commitCornerRadius(nodeIds, value)}
							/>
							<ReadoutRow label="Batch" value={`${nodeIds.length} nodes`} />
						</>
					}
				/>
			</PanelSection>

			{suppressMotion ? null : <MotionTechniqueSection nodeIds={nodeIds} />}
		</div>
	);
}

function StylePresetKindBadge({
	preset,
}: {
	readonly preset: StylePresetSummary;
}) {
	const parts = [
		preset.hasPaint ? "paint" : null,
		preset.hasTypography ? "type" : null,
	].filter((part): part is string => part !== null);
	return (
		<span className="shrink-0 rounded border border-white/10 px-1 py-px font-mono text-fg-muted text-ui uppercase leading-3">
			{preset.kind}
			{parts.length > 0 ? ` · ${parts.join("/")}` : ""}
		</span>
	);
}

/**
 * Inspector bridge for the document style-preset library. Reads the merged
 * `stylePresetInspectorState` adapter for capture/apply gating and routes every
 * mutation through the adapter's command helpers (one apply = one undo). Rename
 * and remove stay reachable with nothing selected because they are library
 * management, not selection edits; capture/apply gate on the live selection.
 */
function StylePresetsSection({ resetKey }: { readonly resetKey: string }) {
	const document = useSceneStore((state) => state.document);
	const nodeIds = useSelectionStore((state) => state.nodeIds);
	const primaryNodeId = useSelectionStore((state) => state.primary);
	const state = useMemo(
		() => stylePresetInspectorState(document, nodeIds, primaryNodeId),
		[document, nodeIds, primaryNodeId],
	);
	const [renamingId, setRenamingId] = useState<string | null>(null);
	const [renameDraft, setRenameDraft] = useState("");
	const [renameError, setRenameError] = useState(false);

	useEffect(() => {
		void resetKey;
		setRenamingId(null);
		setRenameError(false);
	}, [resetKey]);

	const startRename = (preset: StylePresetSummary) => {
		setRenamingId(preset.id);
		setRenameDraft(preset.name);
		setRenameError(false);
	};
	const cancelRename = () => {
		setRenamingId(null);
		setRenameError(false);
	};
	const commitRename = () => {
		if (!renamingId) return;
		if (commitRenameStylePreset(renamingId, renameDraft)) {
			cancelRename();
			return;
		}
		setRenameError(true);
	};
	const onRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter") {
			event.preventDefault();
			commitRename();
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			cancelRename();
		}
	};

	return (
		<PanelSection
			title={`Styles ${state.presetCount > 0 ? `(${state.presetCount})` : ""}`.trim()}
			icon={<Bookmarks aria-hidden="true" size={12} />}
			action={
				<InspectorIconButton
					label={
						state.canCapture
							? "Capture style from selection"
							: "Select a node to capture its style"
					}
					disabled={!state.canCapture}
					onClick={() => {
						if (!state.captureSourceNodeId) return;
						commitCaptureStylePreset(state.captureSourceNodeId);
					}}
				>
					<FloppyDisk aria-hidden="true" size={11} />
				</InspectorIconButton>
			}
		>
			{state.presets.length === 0 ? (
				<p className="px-0.5 py-1 text-fg-subtle text-ui leading-4">
					No saved styles.
				</p>
			) : (
				<ul className="space-y-1">
					{state.presets.map((preset, presetIndex) => {
						const renaming = renamingId === preset.id;
						return (
							<li
								key={preset.id}
								className="rounded-md border border-white/8 bg-black/20 px-1.5 py-1"
							>
								{renaming ? (
									<div className="space-y-1">
										<div className="flex items-center gap-1">
											<input
												// biome-ignore lint/a11y/noAutofocus: rename field opens on explicit user action
												autoFocus
												type="text"
												value={renameDraft}
												aria-label={`Rename ${preset.name}`}
												aria-invalid={renameError}
												onChange={(event) => {
													setRenameDraft(event.currentTarget.value);
													setRenameError(false);
												}}
												onKeyDown={onRenameKeyDown}
												className={cn(
													"h-6 min-w-0 flex-1 rounded-md border bg-black/25 px-1.5 text-fg text-ui outline-none transition placeholder:text-fg-subtle focus:border-accent/70",
													renameError ? "border-danger/55" : "border-white/10",
												)}
											/>
											<InspectorIconButton
												label="Save name"
												onClick={commitRename}
											>
												<Check aria-hidden="true" size={11} />
											</InspectorIconButton>
											<InspectorIconButton
												label="Cancel rename"
												onClick={cancelRename}
											>
												<X aria-hidden="true" size={11} />
											</InspectorIconButton>
										</div>
										{renameError ? (
											<p className="text-danger-fg text-ui leading-3">
												Name must be unique and not blank.
											</p>
										) : null}
									</div>
								) : (
									<div className="flex items-center gap-1">
										<button
											type="button"
											aria-label={
												state.canApply
													? `Apply ${preset.name} to selection`
													: `Select a node to apply ${preset.name}`
											}
											aria-disabled={!state.canApply}
											title={
												state.canApply
													? `Apply ${preset.name}`
													: "Select a node to apply this style"
											}
											onClick={() => {
												if (!state.canApply) return;
												commitApplyStylePreset(
													preset.id,
													state.selectedNodeIds,
												);
											}}
											className={cn(
												"flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-0.5 text-left text-ui transition",
												state.canApply
													? "text-fg-secondary hover:bg-white/[0.06] hover:text-white"
													: "cursor-not-allowed text-fg-subtle",
											)}
										>
											<span className="min-w-0 flex-1 truncate">
												{preset.name}
											</span>
											<StylePresetKindBadge preset={preset} />
										</button>
										<InspectorIconButton
											label={
												state.canCapture
													? `Update ${preset.name} from selection`
													: `Select a node to update ${preset.name}`
											}
											disabled={!state.canCapture}
											onClick={() => {
												if (!state.captureSourceNodeId) return;
												commitUpdateStylePresetFromNode(
													preset.id,
													state.captureSourceNodeId,
												);
											}}
										>
											<FloppyDisk aria-hidden="true" size={11} />
										</InspectorIconButton>
										<InspectorIconButton
											label={`Move ${preset.name} up`}
											disabled={presetIndex === 0}
											onClick={() =>
												commitReorderStylePreset(preset.id, presetIndex - 1)
											}
										>
											<CaretUp aria-hidden="true" size={11} />
										</InspectorIconButton>
										<InspectorIconButton
											label={`Move ${preset.name} down`}
											disabled={presetIndex === state.presets.length - 1}
											onClick={() =>
												commitReorderStylePreset(preset.id, presetIndex + 1)
											}
										>
											<CaretDown aria-hidden="true" size={11} />
										</InspectorIconButton>
										<InspectorIconButton
											label={`Rename ${preset.name}`}
											onClick={() => startRename(preset)}
										>
											<PencilSimple aria-hidden="true" size={11} />
										</InspectorIconButton>
										<InspectorIconButton
											label={`Remove ${preset.name}`}
											tone="danger"
											onClick={() => commitRemoveStylePreset(preset.id)}
										>
											<Trash aria-hidden="true" size={11} />
										</InspectorIconButton>
									</div>
								)}
							</li>
						);
					})}
				</ul>
			)}
		</PanelSection>
	);
}

export function InspectorPanel() {
	addFrameDiagnosticCount("react.InspectorPanel.commit");
	const inspectorResize = usePanelResize("right");
	const motionPaneResize = usePanelResize("inspector-motion");
	const document = useSceneStore((state) => state.document);
	const motion = useMotionStore((state) => state.document);
	const grammarBindings = useMotionGrammarStore(
		(state) => state.document.bindings,
	);
	const grammarTargetNodeIds = useMemo(
		() => new Set(grammarBindings.flatMap((binding) => binding.targetIds)),
		[grammarBindings],
	);
	const currentFrame = useTransportStore((state) => state.currentFrame);
	const recording = useTransportStore((state) => state.recording);
	const toggleRecording = useTransportStore((state) => state.toggleRecording);
	const selectedClipId = useMotionClipSelectionStore(
		(state) => state.selectedClipId,
	);
	const clearSelectedClip = useMotionClipSelectionStore(
		(state) => state.clearSelectedClip,
	);
	const nodeIds = useSelectionStore((state) => state.nodeIds);
	const primaryNodeId = useSelectionStore((state) => state.primary);
	const sceneCameraSelection = useSelectionStore((state) => state.sceneCamera);
	const selectedBaseNodes = selectedNodesForInspector(document, nodeIds);
	const motionSystemSelection = useMemo(
		() =>
			motionSystemInspectorSelection({
				motion,
				bindings: grammarBindings,
				selectedClipId,
			}),
		[motion, grammarBindings, selectedClipId],
	);
	const authoringState = useMemo(
		() =>
			inspectorAuthoringReadState({
				document,
				motion,
				selectedNodeIds: nodeIds,
				primaryNodeId,
				currentFrame,
				recording,
			}),
		[document, motion, nodeIds, primaryNodeId, currentFrame, recording],
	);
	const frame = authoringState.frame;
	const keyframeState = authoringState.keyframeState;
	const primaryBaseNode = primaryNodeForInspector(
		selectedBaseNodes,
		primaryNodeId,
	);
	const selectionKey = [
		motionSystemSelection?.clip.id ?? "scene",
		nodeIds.join("|"),
		primaryNodeId ?? "none",
		sceneCameraSelection
			? `${sceneCameraSelection.kind}:${cameraRigIdFromSelection(sceneCameraSelection) ?? "free"}`
			: "no-camera",
		document.id,
		frame,
	].join(":");

	// When a grammar-backed motion clip is focused, the Inspector splits into two
	// independently-scrolling panes: the normal inspector on top (driven by the
	// scene selection — Artboard + Frame Look when nothing is selected, otherwise
	// the selected object's design) and the clip's motion-system controls on the
	// bottom. The clip never REPLACES the normal inspector, so motion + Frame Look
	// (or motion + object design) are visible and editable at the same time. The
	// motion pane suppresses the normal pane's own Motion section so the same
	// binding is never authored in two places.
	const showMotionPane = motionSystemSelection !== null;

	return (
		<aside className="inspector-panel relative flex flex-col overflow-hidden rounded-md border border-white/10 bg-surface-raised/88 shadow-2xl shadow-black/35 backdrop-blur-xl">
			<div className="flex h-8 shrink-0 items-center justify-between gap-1 border-white/10 border-b px-2 text-fg text-ui">
				<h2
					data-inspector-focus-anchor=""
					tabIndex={-1}
					aria-label="Inspector"
					className="flex min-w-0 items-center gap-1 rounded-sm font-medium outline-none focus-visible:ring-1 focus-visible:ring-accent/70"
				>
					<Gear aria-hidden="true" size={12} />
					<span className="truncate">Inspector</span>
				</h2>
				<span
					className={cn(
						"rounded border border-white/10 px-1 py-0.5 font-mono text-ui",
						selectedBaseNodes.length > 0 || sceneCameraSelection
							? "text-accent-fg"
							: "text-fg-muted",
					)}
				>
					{selectedBaseNodes.length ||
						(sceneCameraSelection ? "camera" : "page")}
				</span>
			</div>

			<div className="flex min-h-0 flex-1 flex-col">
				<div className="inspector-scroll-region chrome-scrollbar-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
					{sceneCameraSelection ? (
						<CameraSelectionPanel document={document} resetKey={selectionKey} />
					) : selectedBaseNodes.length === 0 ? (
						<NoSelectionPanel
							resetKey={selectionKey}
							suppressMotion={showMotionPane}
						/>
					) : selectedBaseNodes.length === 1 &&
						primaryBaseNode &&
						keyframeState.status === "ready" ? (
						<SingleSelectionPanel
							document={document}
							baseNode={primaryBaseNode}
							motion={motion}
							recording={recording}
							onToggleRecording={toggleRecording}
							keyframeState={keyframeState}
							resetKey={selectionKey}
							suppressMotion={showMotionPane}
						/>
					) : (
						<MultiSelectionPanel
							document={document}
							baseNodes={selectedBaseNodes}
							primaryNodeId={primaryNodeId}
							resetKey={selectionKey}
							suppressMotion={showMotionPane}
						/>
					)}

					{sceneCameraSelection ? null : (
						<div className="space-y-1.5 py-1.5">
							<AutomationSection
								document={document}
								primaryNodeId={primaryNodeId}
							/>
							<InteractionsSection
								document={document}
								motion={motion}
								primaryNodeId={primaryNodeId}
							/>
							<ArrangementSnapshotsSection
								document={document}
								nodeIds={selectedBaseNodes.map((node) => node.id)}
							/>
							<SharedTextsSection
								document={document}
								nodeIds={selectedBaseNodes.map((node) => node.id)}
							/>
							<SharedValuesSection
								document={document}
								motion={motion}
								grammarTargetNodeIds={grammarTargetNodeIds}
								nodeIds={selectedBaseNodes.map((node) => node.id)}
							/>
							<SharedColorsSection
								document={document}
								motion={motion}
								nodeIds={selectedBaseNodes.map((node) => node.id)}
								primaryNodeId={primaryNodeId}
							/>
							<ComponentPropsAdvancedSection
								document={document}
								motion={motion}
								grammarTargetNodeIds={grammarTargetNodeIds}
								primaryNodeId={primaryNodeId}
							/>
							<StylePresetsSection resetKey={document.id} />
						</div>
					)}
				</div>

				{motionSystemSelection ? (
					<div className="relative h-[var(--editor-inspector-motion-height)] max-h-[62%] shrink-0 border-white/10 border-t bg-surface-raised/40">
						<PanelResizeHandle
							panelName="Inspector motion"
							orientation="horizontal"
							{...motionPaneResize}
						/>
						<div className="inspector-scroll-region chrome-scrollbar-thin h-full overflow-y-auto overflow-x-hidden">
							<div className="space-y-1.5 py-1.5">
								<MotionTechniqueSection
									nodeIds={[]}
									systemClip={motionSystemSelection.clip}
									onClearSystemClip={clearSelectedClip}
								/>
							</div>
						</div>
					</div>
				) : null}
			</div>
			<PanelResizeHandle panelName="Inspector" {...inspectorResize} />
		</aside>
	);
}
