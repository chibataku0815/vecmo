import {
	createAgentIssue,
	createAgentToolResult,
	summarizeAgentIssues,
} from "@/entities/agent/model/contracts";
import {
	type AgentDocumentContext,
	validateAgentDocument,
} from "@/entities/agent/model/read-only";
import type {
	AgentAppendNodeGeometry,
	AgentApplyCameraCommandsRequest,
	AgentApplyDocumentCommandsRequest,
	AgentApplyMotionCommandsRequest,
	AgentApplyMotionGrammarCommandsRequest,
	AgentApplySceneCommandsRequest,
	AgentBindableEffectTarget,
	AgentCameraVerbCommand,
	AgentCommandReviewReport,
	AgentDocumentCommand,
	AgentEditPlan,
	AgentEditPlanStep,
	AgentEffectFieldOperation,
	AgentIssue,
	AgentIssueReport,
	AgentIssueTarget,
	AgentKeyframeEasing,
	AgentLookGraphTarget,
	AgentMotionCommand,
	AgentMotionGrammarCommand,
	AgentMotionGrammarCommandApplyData,
	AgentNodeStylePatch,
	AgentNodeTransformPatch,
	AgentProposeEditPlanRequest,
	AgentSceneCommand,
	AgentToolResult,
} from "@/entities/agent/model/types";
import { AGENT_CONTRACT_VERSION } from "@/entities/agent/model/types";
import {
	type CameraVerbResult,
	planCameraOrbit2_5d,
	planCameraParallaxEstablish,
	planCameraPushIn,
} from "@/entities/camera-motion/model/camera-verbs";
import {
	combineMotionCommands,
	combineMotionGrammarCommands,
} from "@/entities/component-motion/model/combine-commands";
import { planGrammarPropagation } from "@/entities/component-motion/model/propagate-grammar";
import { planMotionPropagation } from "@/entities/component-motion/model/propagate-motion";
import {
	cameraRigTrackId,
	removeCameraCutSegment,
	removeCameraRigKeyframe,
	removeCameraRigTrack,
	removeCameraRigTracks,
	retimeCameraCutSegment,
	setCameraRigKeyframeEasing,
	setCameraRigKeyframeEasingCurve,
	setCameraRigKeyframeTime,
	upsertCameraCutSegment,
	upsertCameraRigKeyframe,
	upsertCameraRigVectorKeyframes,
} from "@/entities/motion/model/camera-commands";
import {
	parseCameraChannelExpression,
	removeCameraChannelExpression,
	setCameraChannelExpression,
} from "@/entities/motion/model/camera-expression-commands";
import {
	normalizeAnimationClipRange,
	validateAnimationClipTrackAssignment,
} from "@/entities/motion/model/clips";
import type { MotionCommand } from "@/entities/motion/model/command";
import {
	applyAnimationClipTimingTemplate,
	assignAnimationClipTracks,
	createAnimationClip,
	createAutomationTrack,
	deleteAnimationClip,
	enablePositionPath,
	type KeyframeUpsertEasing,
	lookNodeTrackId,
	motionTimingRangeIssues,
	parseTextAnimatorOffsetExpression,
	removeAutomationRecipe,
	removeAutomationTrack,
	removeKeyframe,
	removeLookNodeParamTrack,
	removeSourceOpticsKeyframe,
	removeTextAnimator,
	removeTextAnimatorOffsetExpression,
	removeTrack,
	renameAnimationClip,
	reorderAnimationClip,
	reorderAutomationTrack,
	repairPathMorphTopology,
	retargetMotionNodeReferences,
	retimePositionPathKeyframe,
	reversePathMorphKeyWinding,
	setAutomationEnabled,
	setKeyframeEasing,
	setKeyframeEasingCurve,
	setKeyframeEasingWithHold,
	setKeyframeTime,
	setPathMorphFirstVertex,
	setTextAnimator,
	setTextAnimatorEnabled,
	setTextAnimatorOffsetExpression,
	snapMotionFrame,
	sourceOpticsTrackId,
	trimAnimationClip,
	updateAutomationTrack,
	updateMotionDocumentTiming,
	updatePositionPathKey,
	upsertKeyframeWithEasing,
	upsertLookNodeKeyframe,
	upsertSourceOpticsKeyframe,
} from "@/entities/motion/model/commands";
import {
	compileMotionTimingTemplateForKeyframe,
	type MotionTimingTemplateKeyframeHold,
	motionTimingTemplateKeyframeHoldOf,
} from "@/entities/motion/model/easing";
import {
	productionControlTrackId,
	removeProductionControlKeyframe,
	setProductionControlKeyframeTime,
	upsertProductionControlKeyframe,
} from "@/entities/motion/model/production-control-commands";
import {
	planMotionRelationDetachAtFrame,
	sampleMotionRelationLocalScene,
} from "@/entities/motion/model/relation-authoring";
import {
	type MotionCommandRunnerIssue,
	runMotionCommands,
} from "@/entities/motion/model/runner";
import { cloneMotionDocument } from "@/entities/motion/model/seed-motion";
import { createTextAnimatorPreset } from "@/entities/motion/model/text-animator";
import type {
	AnimatableProperty,
	CameraCutSegment,
	CameraRigAnimatableProperty,
	MotionDocument,
} from "@/entities/motion/model/types";
import { planAfterimageSelectedSourceBinding } from "@/entities/motion-grammar/model/afterimage-selected-source-authoring";
import { normalizeMotionGrammarAuthoringParameterPatch } from "@/entities/motion-grammar/model/authoring-profile";
import { describeMotionGrammarAuthoringProfile } from "@/entities/motion-grammar/model/authoring-profile-registry";
import { validateMotionGrammarBinding } from "@/entities/motion-grammar/model/binding-validation";
import {
	authorableTechniqueIds,
	findCatalogEntry,
} from "@/entities/motion-grammar/model/catalog";
import { createCollisionBounceBakeCommands } from "@/entities/motion-grammar/model/collision-bounce-bake";
import type { MotionGrammarCommand } from "@/entities/motion-grammar/model/command";
import {
	applyGrammarBinding,
	removeGrammarBinding,
	reorderGrammarBinding,
	updateGrammarBinding,
} from "@/entities/motion-grammar/model/commands";
import { defaultCountGrowthRoleMap } from "@/entities/motion-grammar/model/count-growth-v1";
import { createMotionGrammarEditableExpansionCommandPlan } from "@/entities/motion-grammar/model/editable-expansion";
import {
	FOLLOW_THROUGH_LEAD_ADAPTER_TECHNIQUE_ID,
	followThroughLeadAdapterActiveEndFrame,
	planFollowThroughLeadAdapterBinding,
	validateFollowThroughLeadAdapterBinding,
} from "@/entities/motion-grammar/model/follow-through-lead-binding";
import {
	RANDOM_PULSE_PROFILE_DEFAULT,
	randomPulseProfileIssue,
} from "@/entities/motion-grammar/model/random-pulse-profile";
import { createMotionGrammarRoleReplacementPlan } from "@/entities/motion-grammar/model/replacement";
import {
	type MotionGrammarRunnerIssue,
	runMotionGrammarCommands,
} from "@/entities/motion-grammar/model/runner";
import { createStrokeDrawOnAuthoringPlan } from "@/entities/motion-grammar/model/stroke-draw-on-authoring";
import {
	GLAMMER_OFFSET_SEMANTIC_VERSION,
	GLAMMER_OFFSET_STAGGER_CONVEYOR_PROFILE_VERSION,
} from "@/entities/motion-grammar/model/time-offset-authoring-profile";
import type {
	MotionGrammarBinding,
	MotionGrammarTechniqueId,
} from "@/entities/motion-grammar/model/types";
import {
	createMotionGrammarNewBindingDefaults,
	validateVersionedMotionExpressionBinding,
	validateVersionedMotionExpressionRoleMap,
} from "@/entities/motion-grammar/model/versioned-expression-binding";
import {
	MOTION_GRAMMAR_WORKSPACE_ROLE_DATA_KEY,
	type MotionGrammarWorkspaceRoleData,
} from "@/entities/motion-grammar/model/workspace-instance";
import {
	createReleaseMaskCommand,
	createSetMaskRelationPropertyCommand,
	createSetNodeMaskRelationCommand,
	createUseNodeAsMaskCommand,
	MASK_RELATION_PROPERTY_IDS,
	type MaskRelationPropertyId,
	readAppearanceMaskRelations,
} from "@/entities/scene/model/appearance";
import {
	createCaptureArrangementLayoutSnapshotCommand,
	createRecaptureArrangementLayoutSnapshotCommand,
	createRemoveArrangementLayoutSnapshotCommand,
} from "@/entities/scene/model/arrangement-layout-snapshot";
import {
	type BindablePropertySource,
	bindablePropertiesForGeometryKind,
	bindablePropertyById,
} from "@/entities/scene/model/bindable-property";
import {
	buildCreateBlendCommand,
	createReleaseBlendCommand,
	createUpdateBlendCommand,
} from "@/entities/scene/model/blend-commands";
import type { SceneCommand } from "@/entities/scene/model/command";
import {
	createAddComponentPropCommand,
	createRemoveComponentPropCommand,
	createUpdateComponentPropCommand,
} from "@/entities/scene/model/component-prop-commands";
import {
	type ComponentPropBindingIssue,
	type ComponentPropNameIssue,
	componentPropBindingAnimatedConflict,
	componentPropSharedNumberOwnershipConflicts,
	componentPropStyleColorOwnershipConflict,
	isSharedNumberPropertyId,
	type MotionConflictView,
	readComponentProps,
	resolveComponentPropBindingIssue,
	sharedNumberBindingValue,
	validateComponentPropName,
} from "@/entities/scene/model/component-props";
import {
	createApplyComponentOverrideCommand,
	createComponentSourceCommand,
	createDetachComponentInstanceCommand,
	createInsertComponentInstanceCommand,
	createResetComponentOverrideCommand,
	createSetComponentTimingOffsetCommand,
} from "@/entities/scene/model/component-symbol-commands";
import {
	findComponentSymbol,
	findComponentSymbolBySourceNodeId,
	planComponentInstance,
	planComponentNodeOverride,
	readComponentSymbols,
} from "@/entities/scene/model/component-symbols";
import { buildDotMatrixNode } from "@/entities/scene/model/dot-matrix";
import type { DuplicateGeneratorBinding } from "@/entities/scene/model/duplicate-generator";
import {
	createRemoveDuplicateGeneratorCommand,
	createSetDuplicateGeneratorCommand,
	duplicateGeneratorIdForNode,
} from "@/entities/scene/model/duplicate-generator-commands";
import {
	type EffectCapabilityDescriptor,
	effectCapabilityById,
} from "@/entities/scene/model/effect-capabilities";
import {
	type EffectExpressionTargetRef,
	expressionBindableCapability,
} from "@/entities/scene/model/effect-expression-binding";
import {
	createClearEffectExpressionBindingCommand,
	createSetEffectExpressionBindingCommand,
} from "@/entities/scene/model/effect-expression-commands";
import { compileEffectFieldRoutes } from "@/entities/scene/model/effect-field-routing";
import {
	applyEffectLayerStackOperation,
	type EffectLayerOwnerRef,
	type EffectLayerStack,
	type EffectLayerStackOperation,
	effectLayerStackFromIntent,
} from "@/entities/scene/model/effect-layer-stack";
import { createSetEffectLayerStackCommand } from "@/entities/scene/model/effect-layer-stack-commands";
import { cloneSceneDocument, createNode } from "@/entities/scene/model/factory";
import {
	DEFAULT_FRAME_INFLUENCE_ASSIGNMENT_ID,
	defaultFrameInfluenceRecipe,
} from "@/entities/scene/model/frame-effect-defaults";
import {
	buildGroupNodesCommand,
	buildUngroupNodeCommand,
} from "@/entities/scene/model/group-commands";
import {
	createAddInteractionCommand,
	createRemoveInteractionCommand,
	createUpdateInteractionCommand,
} from "@/entities/scene/model/interaction-commands";
import {
	type InteractionActionIssue,
	type InteractionMotionView,
	type InteractionTriggerIssue,
	readInteractions,
	validateInteractionAction,
	validateInteractionActionsNotEmpty,
	validateInteractionTrigger,
} from "@/entities/scene/model/interactions";
import {
	createApplyLayoutPresetCommand,
	createLayoutFrameFromNodesCommand,
	createPackLayoutFrameCommand,
	createReapplyLayoutFrameCommand,
	createSetLayoutChildPlacementCommand,
	createSetLayoutChildrenPlacementsCommand,
	createUpdateLayoutFrameCommand,
} from "@/entities/scene/model/layout-frame-commands";
import {
	isLookGraphNodeParamKeyframable,
	type LookGraph,
	type LookGraphOwnerRef,
	lookGraphFromIntent,
	lookGraphFromVisualRecipe,
	lookGraphNodeParamSpec,
	normalizeLookGraph,
	validateLookEdge,
} from "@/entities/scene/model/look-graph";
import { createSetLookGraphCommand } from "@/entities/scene/model/look-graph-commands";
import {
	applyLookGraphOperation,
	type LookGraphOperation,
	validateLookGraphNodePayloadPatch,
} from "@/entities/scene/model/look-graph-operations";
import { planBindMotionParentsCommand } from "@/entities/scene/model/motion-relation-commands";
import { validateMotionParentTarget } from "@/entities/scene/model/motion-relations";
import {
	NATIVE_EXPRESSION_PROPERTY_IDS,
	nativeExpressionBindingId,
	nativeExpressionPropertyIdFromBindableId,
} from "@/entities/scene/model/native-expression-binding";
import {
	createClearNativeExpressionBindingCommand,
	createSetNativeExpressionBindingCommand,
} from "@/entities/scene/model/native-expression-commands";
import {
	createAddArtboardCommand,
	createAddLayerCommand,
	createAppendNodeCommand,
	createCenterNodeAnchorCommand,
	createConvertNodeNoiseGradientToScopedLookGraphCommand,
	createDeleteNodesCommand,
	createFrameNodesCommand,
	createPlaceExistingSceneAssetCommand,
	createPlaceExternalSceneAssetCommand,
	createRemoveArtboardCommand,
	createRemoveLayerCommand,
	createRemoveUnusedSceneAssetCommand,
	createRenameDocumentCommand,
	createRenameNodeCommand,
	createReorderArtboardCommand,
	createReorderLayerCommand,
	createReorderNodeWithinLayerCommand,
	createReparentNodesCommand,
	createSetCurrentArtboardCommand,
	createSetNodeLockedCommand,
	createSetNodeVisibilityCommand,
	createUnframeNodeCommand,
	createUpdateArtboardCommand,
	createUpdateCornerSmoothingCommand,
	createUpdateEffectIntentCommand,
	createUpdateLayerCommand,
	createUpdateNodeGeometryCommand,
	createUpdateNodeRecipeCommand,
	createUpdateNodeStyleCommand,
	createUpdateNodeTransformCommand,
	createUpdatePolygonStarCornerRadiusCommand,
	createUpdateRectCornerRadiiCommand,
	createUpdateRectCornerRadiusCommand,
	createUpdateTextNodeCommand,
	createUpsertSceneAssetCommand,
	type EffectIntentTarget,
	type NodeStylePatch,
} from "@/entities/scene/model/node-commands";
import {
	NOISE_GRADIENT_DEFAULT_CONTRAST,
	NOISE_GRADIENT_DEFAULT_STRENGTH,
	NOISE_GRADIENT_FRESH_ENABLE_BLEND_MODE,
	OBJECT_NOISE_GRADIENT_DEFAULT_AMOUNT,
	OBJECT_NOISE_GRADIENT_DEFAULT_MIXED_GRAIN,
} from "@/entities/scene/model/noise-gradient-look";
import { buildPathOperationCommand } from "@/entities/scene/model/path-boolean/command";
import { createIndexedPixelArtObject } from "@/entities/scene/model/pixel-art-object";
import { sceneProductionLinks } from "@/entities/scene/model/production-control";
import { updateRecipeControl } from "@/entities/scene/model/recipe-controls";
import {
	resolveFrameEffectIntent,
	resolveFrameLookGraph,
	resolveNodeRecipe,
} from "@/entities/scene/model/recipe-resolve";
import { transformWithAnchorPreservingMatrix } from "@/entities/scene/model/rendering";
import {
	runSceneCommands,
	type SceneCommandRunnerIssue,
} from "@/entities/scene/model/runner";
import { readSceneCameraAuthoringState } from "@/entities/scene/model/scene-camera-authoring";
import {
	buildMotionControllerNode,
	buildSceneCameraRigForArtboard,
	createAddMotionControllerNodeCommand,
	createAddSceneCameraCommand,
	createBindSceneCameraBodyControllerCommand,
	createBindSceneCameraTargetControllerCommand,
	createBindSceneCameraTargetNodeCommand,
	createRemoveSceneCameraCommand,
	createSetActiveSceneCameraCommand,
	createSetMotionControllerCommand,
	createSetMotionParentCommand,
	createSetNodeDepthPlaneCommand,
	createUpdateSceneCameraCommand,
} from "@/entities/scene/model/scene-camera-commands";
import {
	createRemovePropertyRelationCommand,
	createRemoveTransformConstraintCommand,
	createSetPropertyRelationCommand,
	planTransformConstraintCommand,
} from "@/entities/scene/model/scene-constraint-commands";
import {
	createSetScopedLookGraphOverlayCommand,
	scopedLookGraphOverlays,
} from "@/entities/scene/model/scoped-look-graph-overlay";
import {
	allNodes,
	findArtboardById,
	findLayerByNodeId,
	findNode,
	findRenderableNodeEntry,
	isFrameNode,
	isTopLevelSceneNode,
	selectAllArtboards,
	selectArtboardIdForNode,
	selectCurrentArtboard,
	selectDefaultArtboard,
	selectNodeArtboardMapping,
} from "@/entities/scene/model/selectors";
import {
	createInitializeSceneSequenceCommand,
	createMoveSceneSequenceItemCommand,
	createRemoveSceneSequenceCommand,
	createRemoveSceneSequenceItemCommand,
	createUpdateSceneSequenceCommand,
	createUpdateSceneSequenceItemCommand,
} from "@/entities/scene/model/sequence-commands";
import {
	sourceOpticsParameterDescriptor,
	sourceOpticsParameterValue,
	sourceOpticsRigsForArtboard,
} from "@/entities/scene/model/source-optics";
import {
	createAddSourceOpticsRigCommand,
	createBindSourceOpticsResponseCommand,
	createRemoveSourceOpticsRigCommand,
	createUnbindSourceOpticsResponseCommand,
	createUpdateSourceOpticsResponseCommand,
	createUpdateSourceOpticsRigCommand,
} from "@/entities/scene/model/source-optics-commands";
import {
	createAddStylePresetCommand,
	createApplyStylePresetCommand,
	createInsertStylePresetCommand,
	createRemoveStylePresetCommand,
	createRenameStylePresetCommand,
	createReorderStylePresetCommand,
	createReplaceStylePresetCommand,
	createUpdateStylePresetTypographyCommand,
} from "@/entities/scene/model/style-preset-commands";
import {
	normalizeStylePreset,
	normalizeStylePresetTypography,
	readStylePresets,
} from "@/entities/scene/model/style-presets";
import { markGroupAsTextFragments } from "@/entities/scene/model/text-fragment-commands";
import type {
	Artboard,
	ComponentNodeOverride,
	ComponentPropBinding,
	ComponentPropBindingBindable,
	ComponentPropBindingStyleColor,
	ComponentPropType,
	ComponentPropValue,
	EffectIntent,
	ExternalSceneAssetCapability,
	InteractionAction,
	InteractionTrigger,
	NodeGeometry,
	NodeStyle,
	SceneCameraRigContract,
	SceneDepthPlaneContract,
	SceneDocument,
	SceneMediaSource,
	VectorNode,
} from "@/entities/scene/model/types";
import { normalizeHex } from "@/shared/color";
import {
	DUPLICATE_EXPR_VARS,
	EFFECT_EXPR_VARS,
	type ExpressionSource,
	type ExprVarName,
	parseExpression,
} from "@/shared/expr-dsl";
import { type AePoint, isAeShape } from "@/shared/glammer/ae-shape";
import { createId } from "@/shared/lib/id";
import {
	STROKE_WIDTH_PROFILE_PRESETS,
	validateStrokeWidthProfile,
} from "@/shared/stroke/width-profile";
import {
	attachEffectInfluenceAssignment,
	type EffectInfluenceRecipe,
	type EffectInfluenceRecipeDraft,
	linkEffectInfluenceAssignmentField,
	NEUTRAL_VISUAL_RECIPE,
	normalizeEffectInfluence,
	normalizeEffectInfluenceAssignment,
	normalizeEffectInfluenceRecipe,
	normalizeVisualRecipe,
	removeEffectFieldDefinition,
	replaceEffectFieldSource,
	TEXTURE_MATERIAL_BLEND_MODES,
	type TextureMaterialBlendMode,
	unlinkEffectInfluenceAssignmentField,
	upsertEffectFieldDefinition,
	type VisualRecipe,
} from "@/shared/vec-core";

export type AgentSceneCommandApplyData = {
	readonly transactionId: string;
	readonly dryRun: boolean;
	readonly changed: boolean;
	readonly appliedCommandCount: number;
	readonly appliedMotionCommandCount?: number;
	readonly report: AgentCommandReviewReport;
	readonly scene: SceneDocument;
	readonly motion?: MotionDocument;
};

export type AgentMotionCommandApplyData = {
	readonly transactionId: string;
	readonly dryRun: boolean;
	readonly changed: boolean;
	readonly appliedCommandCount: number;
	readonly report: AgentCommandReviewReport;
	readonly motion: MotionDocument;
};

/** Atomic headless result for commands that may span all durable owners. */
export type AgentDocumentCommandApplyData = {
	readonly transactionId: string;
	readonly dryRun: boolean;
	readonly changed: boolean;
	readonly appliedSceneCommandCount: number;
	readonly appliedMotionCommandCount: number;
	readonly appliedMotionGrammarCommandCount: number;
	readonly report: AgentCommandReviewReport;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly grammar: AgentDocumentContext["grammar"];
};

/**
 * Unlike scene's optional sidecar `motion?` (one command, occasional side
 * effect), a camera verb's scene and motion halves are both first-class and
 * either may legitimately be empty (a push-in on an already-compatible camera
 * emits no scene command), so both documents are always returned rather than
 * one being conditional on the other.
 */
export type AgentCameraVerbCommandApplyData = {
	readonly transactionId: string;
	readonly dryRun: boolean;
	readonly changed: boolean;
	readonly appliedSceneCommandCount: number;
	readonly appliedMotionCommandCount: number;
	readonly report: AgentCommandReviewReport;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
};

export type AgentCompiledSceneCommand = {
	readonly command: SceneCommand;
	readonly target: AgentIssueTarget;
	readonly motionCommands?: readonly AgentCompiledMotionCommand[];
};

export type AgentCompiledMotionCommand = {
	readonly command: MotionCommand;
	readonly target: AgentIssueTarget;
};

export type AgentCompiledMotionGrammarCommand = {
	readonly command: MotionGrammarCommand;
	readonly target: AgentIssueTarget;
};

/** One prevalidated command bundle spanning any subset of durable owners. */
export type AgentCompiledDocumentCommand = {
	readonly sceneCommands: readonly SceneCommand[];
	readonly motionCommands: readonly MotionCommand[];
	readonly grammarCommands: readonly MotionGrammarCommand[];
	readonly label: string;
	readonly targets: readonly AgentIssueTarget[];
};

export type AgentCompiledSceneCommandBatch = {
	readonly commands: readonly AgentCompiledSceneCommand[];
	readonly report: AgentCommandReviewReport;
};

export type AgentCompiledMotionCommandBatch = {
	readonly commands: readonly AgentCompiledMotionCommand[];
	readonly report: AgentCommandReviewReport;
};

export type AgentCompiledMotionGrammarCommandBatch = {
	readonly commands: readonly AgentCompiledMotionGrammarCommand[];
	readonly report: AgentCommandReviewReport;
};

export type AgentCompiledDocumentCommandBatch = {
	readonly commands: readonly AgentCompiledDocumentCommand[];
	readonly report: AgentCommandReviewReport;
};

/**
 * One prevalidated camera-verb expansion: the planner's cross-store bundle
 * (scene projection / depth-plane / ensure-camera + motion sparse camera-track
 * keys). Both arrays are applied under one compound so the verb lands as a
 * single undoable beat; either may be empty (e.g. a push-in on an already
 * perspective camera emits motion only).
 */
export type AgentCompiledCameraVerbCommand = {
	readonly sceneCommands: readonly SceneCommand[];
	readonly motionCommands: readonly MotionCommand[];
	readonly targets: readonly AgentIssueTarget[];
};

export type AgentCompiledCameraVerbCommandBatch = {
	readonly commands: readonly AgentCompiledCameraVerbCommand[];
	readonly report: AgentCommandReviewReport;
};

const targetKey = (target: AgentIssueTarget): string =>
	`${target.kind}:${target.id ?? ""}`;

const uniqueTargets = (
	targets: readonly AgentIssueTarget[],
): readonly AgentIssueTarget[] => {
	const seen = new Set<string>();
	const unique: AgentIssueTarget[] = [];
	for (const target of targets) {
		const key = targetKey(target);
		if (seen.has(key)) continue;
		seen.add(key);
		unique.push(target);
	}
	return unique;
};

const issueTargets = (
	issues: readonly AgentIssue[],
): readonly AgentIssueTarget[] =>
	uniqueTargets(
		issues
			.map((issue) => issue.target)
			.filter((target): target is AgentIssueTarget => target !== undefined),
	);

const mergeIssueTargets = (
	...targetGroups: readonly (readonly AgentIssueTarget[])[]
): readonly AgentIssueTarget[] => uniqueTargets(targetGroups.flat());

const createCommandReviewReport = (
	kind: AgentCommandReviewReport["kind"],
	tool: AgentCommandReviewReport["tool"],
	commandCount: number,
	validCommandCount: number,
	affected: readonly AgentIssueTarget[],
	issues: readonly AgentIssue[],
): AgentCommandReviewReport => ({
	kind,
	tool,
	commandCount,
	validCommandCount,
	affected: uniqueTargets(affected),
	summary: summarizeAgentIssues(issues),
	issues,
});

const commandLabel = (count: number): string =>
	count === 1 ? "Agent scene command" : "Agent scene commands";

const motionCommandLabel = (count: number): string =>
	count === 1 ? "Agent motion command" : "Agent motion commands";

const motionGrammarCommandLabel = (count: number): string =>
	count === 1
		? "Agent motion grammar command"
		: "Agent motion grammar commands";

const cameraVerbCommandLabel = (count: number): string =>
	count === 1 ? "Agent camera verb command" : "Agent camera verb commands";

const sceneRunnerIssueToAgentIssue = (
	issue: SceneCommandRunnerIssue,
): AgentIssue =>
	createAgentIssue(
		"agent.scene-command-runner-invalid",
		issue.severity,
		issue.message,
		{
			kind: "tool",
			id: "run_scene_commands",
			path: `commands.${issue.commandIndex}`,
		},
	);

const motionRunnerIssueToAgentIssue = (
	issue: MotionCommandRunnerIssue,
): AgentIssue =>
	createAgentIssue(
		"agent.motion-command-runner-invalid",
		issue.severity,
		issue.message,
		{
			kind: "tool",
			id: "run_motion_commands",
			path: `commands.${issue.commandIndex}`,
		},
	);

const motionGrammarRunnerIssueToAgentIssue = (
	issue: MotionGrammarRunnerIssue,
): AgentIssue =>
	createAgentIssue(
		"agent.motion-grammar-command-runner-invalid",
		issue.severity,
		issue.message,
		{
			kind: "tool",
			id: "run_motion_grammar_commands",
			path: `commands.${issue.commandIndex}`,
		},
	);

const defaultTransactionId = (
	scene: SceneDocument,
	commandCount: number,
): string => `agent-scene:${scene.id}:${commandCount}`;

const createClearCameraTargetPreservingPositionCommand = (
	scene: SceneDocument,
	cameraRigId: string,
): ReturnType<typeof createUpdateSceneCameraCommand> => {
	const targetPoint = readSceneCameraAuthoringState(scene).cameras.find(
		(camera) => camera.rig.id === cameraRigId,
	)?.target.point;
	return createUpdateSceneCameraCommand(
		cameraRigId,
		{
			target: {
				...(targetPoint ? { point: targetPoint } : {}),
				nodeId: null,
				parentControllerNodeId: null,
			},
		},
		{ label: "Clear camera target" },
	);
};

const defaultMotionTransactionId = (
	scene: SceneDocument,
	commandCount: number,
): string => `agent-motion:${scene.id}:${commandCount}`;

const defaultMotionGrammarTransactionId = (
	scene: SceneDocument,
	commandCount: number,
): string => `agent-motion-grammar:${scene.id}:${commandCount}`;

const defaultCameraVerbTransactionId = (
	scene: SceneDocument,
	commandCount: number,
): string => `agent-camera:${scene.id}:${commandCount}`;

const layerHasTopLevelNode = (
	scene: SceneDocument,
	layerId: string,
	nodeId: string,
): boolean =>
	scene.layers
		.find((layer) => layer.id === layerId)
		?.nodes.some((node) => node.id === nodeId) ?? false;

const validLayerIndex = (scene: SceneDocument, toIndex: number): boolean =>
	Number.isInteger(toIndex) && toIndex >= 0 && toIndex < scene.layers.length;

const validNodeIndex = (
	scene: SceneDocument,
	layerId: string,
	toIndex: number,
): boolean => {
	const layer = scene.layers.find((item) => item.id === layerId);
	return (
		!!layer &&
		Number.isInteger(toIndex) &&
		toIndex >= 0 &&
		toIndex < layer.nodes.length
	);
};

const isFiniteAePoint = (point: unknown): point is AePoint =>
	Array.isArray(point) &&
	point.length === 2 &&
	Number.isFinite(point[0]) &&
	Number.isFinite(point[1]);

/**
 * Validates an agent-authored path shape before it becomes a scene node. The node
 * factory and command bus trust their input, so this guards the agent boundary: a
 * shape must be a real {@link BezierShape} with at least two vertices, matching
 * in/out tangent counts, and finite coordinates. Without this an agent could
 * append a degenerate path (one point, mismatched tangents, NaN) that survives
 * `typeof number` checks but produces zero-area bounds or breaks hit-testing.
 */
const isAuthorablePathShape = (shape: unknown): boolean => {
	if (!isAeShape(shape)) return false;
	const { vertices, inTangents, outTangents } = shape;
	if (vertices.length < 2) return false;
	if (
		vertices.length !== inTangents.length ||
		vertices.length !== outTangents.length
	) {
		return false;
	}
	return (
		vertices.every(isFiniteAePoint) &&
		inTangents.every(isFiniteAePoint) &&
		outTangents.every(isFiniteAePoint)
	);
};

const isFiniteVec2 = (value: { readonly x: number; readonly y: number }) =>
	Number.isFinite(value.x) && Number.isFinite(value.y);

const isAuthorableBounds = (bounds: {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}) =>
	Number.isFinite(bounds.x) &&
	Number.isFinite(bounds.y) &&
	Number.isFinite(bounds.width) &&
	Number.isFinite(bounds.height) &&
	bounds.width > 0 &&
	bounds.height > 0;

/** Validates every semantic geometry variant at the Agent boundary. */
const isAuthorableNodeGeometry = (
	geometry: AgentAppendNodeGeometry,
): boolean => {
	switch (geometry.kind) {
		case "rect":
		case "ellipse":
		case "text":
		case "image":
			return isAuthorableBounds(geometry.bounds);
		case "line":
			return isFiniteVec2(geometry.start) && isFiniteVec2(geometry.end);
		case "polygon":
			return geometry.points.length >= 3 && geometry.points.every(isFiniteVec2);
		case "star":
			return (
				isFiniteVec2(geometry.center) &&
				Number.isInteger(geometry.points) &&
				geometry.points >= 3 &&
				Number.isFinite(geometry.innerRadius) &&
				geometry.innerRadius >= 0 &&
				Number.isFinite(geometry.outerRadius) &&
				geometry.outerRadius > 0 &&
				geometry.innerRadius <= geometry.outerRadius
			);
		case "path":
			return (
				isAuthorablePathShape(geometry.shape) &&
				(geometry.subpaths?.every(isAuthorablePathShape) ?? true)
			);
	}
};

const isMaskRelationPropertyId = (
	propertyId: string,
): propertyId is MaskRelationPropertyId =>
	(MASK_RELATION_PROPERTY_IDS as readonly string[]).includes(propertyId);

/**
 * Collects a node's own id plus every descendant id, mirroring
 * `collectDraftSubtreeIds` in `node-commands.ts` for the read-only side of the
 * reparent-into-own-descendant cycle guard: `createReparentNodesCommand` applies
 * this same subtree test against the live draft and silently drops any id whose
 * subtree contains the requested destination, so the agent compiler must run the
 * identical check up front to report *which* ids would be rejected and why.
 */
const collectNodeSubtreeIds = (node: VectorNode, output: Set<string>): void => {
	output.add(node.id);
	if (node.children) {
		for (const child of node.children) collectNodeSubtreeIds(child, output);
	}
};

const directChildNode = (
	node: VectorNode,
	childNodeId: string,
): VectorNode | undefined =>
	node.children?.find((child) => child.id === childNodeId);

const layoutFrameTargetIssue = (
	nodeId: string,
	path: string,
	message: string,
): AgentIssue =>
	createAgentIssue("agent.scene-command-non-layout-frame", "error", message, {
		kind: "node",
		id: nodeId,
		path,
	});

const resolveLayoutFrameCreateLayer = (
	scene: SceneDocument,
	layerId: string | undefined,
	parentNodeId: string | null | undefined,
	sourceNodeIds: readonly string[],
): string | undefined => {
	if (layerId) return layerId;
	if (parentNodeId) return findLayerByNodeId(scene, parentNodeId)?.id;
	const firstSourceId = sourceNodeIds[0];
	if (firstSourceId) return findLayerByNodeId(scene, firstSourceId)?.id;
	return scene.layers.at(-1)?.id;
};

const buildAppendGeometry = (
	geometry: AgentAppendNodeGeometry,
): NodeGeometry => {
	switch (geometry.kind) {
		case "rect": {
			const clampRadius = (value: number) => Math.max(0, value);
			return {
				kind: "rect",
				bounds: geometry.bounds,
				cornerRadius: clampRadius(geometry.cornerRadius ?? 0),
				...(geometry.cornerRadii
					? {
							cornerRadii: {
								tl: clampRadius(geometry.cornerRadii.tl),
								tr: clampRadius(geometry.cornerRadii.tr),
								br: clampRadius(geometry.cornerRadii.br),
								bl: clampRadius(geometry.cornerRadii.bl),
							},
						}
					: {}),
				...(geometry.cornerSmoothing !== undefined
					? {
							cornerSmoothing: Math.min(
								1,
								Math.max(0, geometry.cornerSmoothing),
							),
						}
					: {}),
			};
		}
		case "ellipse":
			return { kind: "ellipse", bounds: geometry.bounds };
		case "line":
			return { kind: "line", start: geometry.start, end: geometry.end };
		case "polygon":
			return {
				kind: "polygon",
				points: geometry.points,
				...(geometry.cornerRadius === undefined
					? {}
					: { cornerRadius: Math.max(0, geometry.cornerRadius) }),
				...(geometry.cornerSmoothing === undefined
					? {}
					: {
							cornerSmoothing: Math.min(
								1,
								Math.max(0, geometry.cornerSmoothing),
							),
						}),
			};
		case "star":
			return {
				kind: "star",
				center: geometry.center,
				points: geometry.points,
				innerRadius: geometry.innerRadius,
				outerRadius: geometry.outerRadius,
				...(geometry.cornerRadius === undefined
					? {}
					: { cornerRadius: Math.max(0, geometry.cornerRadius) }),
				...(geometry.cornerSmoothing === undefined
					? {}
					: {
							cornerSmoothing: Math.min(
								1,
								Math.max(0, geometry.cornerSmoothing),
							),
						}),
			};
		case "text":
			return geometry.style
				? {
						kind: "text",
						bounds: geometry.bounds,
						text: geometry.text,
						style: geometry.style,
					}
				: { kind: "text", bounds: geometry.bounds, text: geometry.text };
		case "path":
			return {
				kind: "path",
				shape: geometry.shape,
				...(geometry.subpaths ? { subpaths: geometry.subpaths } : {}),
				...(geometry.fillRule ? { fillRule: geometry.fillRule } : {}),
			};
		case "image":
			return {
				kind: "image",
				bounds: geometry.bounds,
				assetId: geometry.assetId,
			};
	}
};

const NEW_ARTBOARD_GAP = 80; // mirrors DUPLICATED_ARTBOARD_GAP in node-commands.ts
const DEFAULT_NEW_ARTBOARD_FPS = 30;
const DEFAULT_NEW_ARTBOARD_DURATION = 180;

/**
 * Default placement for an agent-created artboard: just right of the rightmost
 * existing artboard (mirroring the duplicate-artboard gap) so a created artboard
 * does not overlap the current one. Falls back to the origin for an empty document.
 */
const nextArtboardPosition = (
	scene: SceneDocument,
): { readonly x: number; readonly y: number } => {
	let rightEdge = Number.NEGATIVE_INFINITY;
	let rowY = 0;
	for (const artboard of selectAllArtboards(scene)) {
		const position = artboard.position ?? { x: 0, y: 0 };
		const edge = position.x + artboard.width;
		if (edge > rightEdge) {
			rightEdge = edge;
			rowY = position.y;
		}
	}
	if (!Number.isFinite(rightEdge)) return { x: 0, y: 0 };
	return { x: rightEdge + NEW_ARTBOARD_GAP, y: rowY };
};

const isPositiveSize = (value: number | undefined): boolean =>
	value === undefined || (Number.isFinite(value) && value > 0);

/** Scene-property source paths the bindable-property command can compile. */
type SceneBindablePropertyPath = Extract<
	BindablePropertySource,
	{ readonly kind: "scene-property" }
>["path"];

/**
 * Translates a native scene-property bindable path into the equivalent typed
 * scene command so node and geometry eligibility checks stay owned by the
 * existing per-command compilers (one place, no drift). Vector-valued transform
 * paths reconstruct the full vector from the node because the transform command
 * shallow-merges nested objects wholesale.
 */
const sceneCommandForBindablePath = (
	path: SceneBindablePropertyPath,
	nodeId: string,
	value: number,
	node: VectorNode,
): AgentSceneCommand => {
	const transformAnchorPatch = (anchor: {
		readonly x: number;
		readonly y: number;
	}): Pick<
		NonNullable<AgentNodeTransformPatch["transform"]>,
		"position" | "anchor"
	> => {
		const transform = transformWithAnchorPreservingMatrix(
			node.transform,
			anchor,
		);
		return {
			position: transform.position,
			anchor: transform.anchor,
		};
	};
	switch (path) {
		case "transform.position.x":
			return {
				type: "scene/update-node-transform",
				nodeId,
				patch: {
					transform: { position: { x: value, y: node.transform.position.y } },
				},
			};
		case "transform.position.y":
			return {
				type: "scene/update-node-transform",
				nodeId,
				patch: {
					transform: { position: { x: node.transform.position.x, y: value } },
				},
			};
		case "transform.rotation":
			return {
				type: "scene/update-node-transform",
				nodeId,
				patch: { transform: { rotation: value } },
			};
		case "transform.anchor.x":
			return {
				type: "scene/update-node-transform",
				nodeId,
				patch: {
					transform: transformAnchorPatch({
						x: value,
						y: node.transform.anchor.y,
					}),
				},
			};
		case "transform.anchor.y":
			return {
				type: "scene/update-node-transform",
				nodeId,
				patch: {
					transform: transformAnchorPatch({
						x: node.transform.anchor.x,
						y: value,
					}),
				},
			};
		case "transform.scale.x":
			return {
				type: "scene/update-node-transform",
				nodeId,
				patch: {
					transform: { scale: { x: value, y: node.transform.scale.y } },
				},
			};
		case "transform.scale.y":
			return {
				type: "scene/update-node-transform",
				nodeId,
				patch: {
					transform: { scale: { x: node.transform.scale.x, y: value } },
				},
			};
		case "style.opacity":
			return {
				type: "scene/update-node-style",
				nodeId,
				patch: { opacity: value },
			};
		case "geometry.cornerRadius":
			return {
				type: "scene/update-corner-radius",
				nodeId,
				cornerRadius: value,
			};
		case "geometry.cornerRadii.tl":
			return {
				type: "scene/update-rect-corner-radii",
				nodeId,
				radii: { tl: value },
			};
		case "geometry.cornerRadii.tr":
			return {
				type: "scene/update-rect-corner-radii",
				nodeId,
				radii: { tr: value },
			};
		case "geometry.cornerRadii.br":
			return {
				type: "scene/update-rect-corner-radii",
				nodeId,
				radii: { br: value },
			};
		case "geometry.cornerRadii.bl":
			return {
				type: "scene/update-rect-corner-radii",
				nodeId,
				radii: { bl: value },
			};
		case "geometry.cornerSmoothing":
			return {
				type: "scene/update-corner-smoothing",
				nodeId,
				cornerSmoothing: value,
			};
		case "style.strokeSoftness.blurRadius":
			return {
				type: "scene/update-node-style",
				nodeId,
				patch: { strokeSoftness: { blurRadius: value } },
			};
	}
};

type EffectBindablePropertySource = Extract<
	BindablePropertySource,
	{ readonly kind: "effect-capability" }
>;

type DuplicateGeneratorBindablePropertySource = Extract<
	BindablePropertySource,
	{ readonly kind: "duplicate-generator" }
>;

/**
 * Per-command compiled outcome for a `scene/patch-look-graph` command. The batch
 * pass owns look-graph accumulation so each operation is validated against its
 * pre-state (commands 0…N-1 applied, this op not yet) — a `connect` validated
 * against the batch-final graph would wrongly report its own edge as occupying the
 * target input. `graph` is the exact cumulative graph this command should SET;
 * non-empty `issues` reject the command (graph ignored, batch aborts).
 */
type LookGraphCommandCompile = {
	readonly graph?: LookGraph | null;
	readonly issues: readonly AgentIssue[];
};

type EffectFieldCommandCompile = {
	readonly recipe?: EffectInfluenceRecipe;
	readonly issues: readonly AgentIssue[];
};

type BindableSceneBatchState = {
	readonly effectRecipesByNodeId: ReadonlyMap<string, VisualRecipe | null>;
	readonly frameEffectRecipesByTargetKey: ReadonlyMap<
		string,
		VisualRecipe | null
	>;
	readonly frameInfluenceRecipesByTargetKey: ReadonlyMap<
		string,
		EffectInfluenceRecipe
	>;
	readonly effectLayerStacksByTargetKey: ReadonlyMap<
		string,
		EffectLayerStack | null
	>;
	readonly lookGraphCompilesByCommandIndex: ReadonlyMap<
		number,
		LookGraphCommandCompile
	>;
	readonly effectFieldCompilesByCommandIndex: ReadonlyMap<
		number,
		EffectFieldCommandCompile
	>;
	readonly duplicateGeneratorsByNodeId: ReadonlyMap<
		string,
		DuplicateGeneratorBinding
	>;
};

const sameJson = (left: unknown, right: unknown): boolean =>
	JSON.stringify(left) === JSON.stringify(right);

const recipeOrNullForSceneCommand = (
	recipe: VisualRecipe,
): VisualRecipe | null =>
	sameJson(recipe, NEUTRAL_VISUAL_RECIPE) ? null : recipe;

const numericExpressionSource = (value: number): ExpressionSource => ({
	source: Object.is(value, -0) ? "0" : String(value),
	ast: { type: "num", value },
});

const duplicateGeneratorForNode = (
	scene: SceneDocument,
	nodeId: string,
): DuplicateGeneratorBinding | null => {
	const generatorId = duplicateGeneratorIdForNode(nodeId);
	return (
		scene.duplicateGenerators?.find(
			(generator) =>
				generator.id === generatorId || generator.sourceNodeId === nodeId,
		) ?? null
	);
};

const defaultDuplicateGeneratorForNode = (
	nodeId: string,
): DuplicateGeneratorBinding => ({
	id: duplicateGeneratorIdForNode(nodeId),
	sourceNodeId: nodeId,
	count: numericExpressionSource(1),
	instance: {},
});

const setDuplicateGeneratorBindableChannel = (
	generator: DuplicateGeneratorBinding,
	source: DuplicateGeneratorBindablePropertySource,
	value: number,
): DuplicateGeneratorBinding => {
	const expression = numericExpressionSource(value);
	if (source.channel === "count") {
		return { ...generator, count: expression };
	}
	return {
		...generator,
		instance: {
			...generator.instance,
			[source.channel]: expression,
		},
	};
};

const setDuplicateGeneratorExpressionChannel = (
	generator: DuplicateGeneratorBinding,
	source: DuplicateGeneratorBindablePropertySource,
	expression: ExpressionSource,
): DuplicateGeneratorBinding => {
	if (source.channel === "count") {
		return { ...generator, count: expression };
	}
	return {
		...generator,
		instance: {
			...generator.instance,
			[source.channel]: expression,
		},
	};
};

const clearDuplicateGeneratorExpressionChannel = (
	generator: DuplicateGeneratorBinding,
	source: DuplicateGeneratorBindablePropertySource,
): DuplicateGeneratorBinding => {
	if (source.channel === "count") {
		return { ...generator, count: numericExpressionSource(1) };
	}
	const instance = { ...generator.instance };
	delete instance[source.channel];
	return { ...generator, instance };
};

const parseBindableExpression = (
	source: string,
	allowedVars: readonly ExprVarName[],
	index: number,
	target: AgentIssueTarget,
): {
	readonly expression?: ExpressionSource;
	readonly issues: readonly AgentIssue[];
} => {
	const parsed = parseExpression(source, allowedVars);
	if (parsed.kind === "ok") return { expression: parsed.expr, issues: [] };
	return {
		issues: [
			createAgentIssue(
				"agent.bindable-expression-invalid",
				"error",
				`Scene command ${index} has invalid expression: ${parsed.message}`,
				target,
			),
		],
	};
};

const effectCapabilityForNodeRecipeWrite = (
	source: EffectBindablePropertySource,
	index: number,
	nodeId: string,
	commandPath: string,
): {
	readonly capability?: EffectCapabilityDescriptor;
	readonly issues: readonly AgentIssue[];
} => {
	const capability = effectCapabilityById(source.capabilityId);
	if (!capability) {
		return {
			issues: [
				createAgentIssue(
					"agent.bindable-property-effect-capability-missing",
					"error",
					`Scene command ${index} references missing effect capability "${source.capabilityId}".`,
					{ kind: "node", id: nodeId, path: commandPath },
				),
			],
		};
	}
	if (!capability.targetScopes.some((scope) => scope === "node")) {
		return {
			issues: [
				createAgentIssue(
					"agent.bindable-property-effect-scope-unsupported",
					"error",
					`Scene command ${index} cannot set non-node effect capability "${source.capabilityId}" with a node-scoped bindable write.`,
					{ kind: "node", id: nodeId, path: commandPath },
				),
			],
		};
	}
	if (capability.source.kind !== "recipe-control") {
		return {
			issues: [
				createAgentIssue(
					"agent.bindable-property-effect-source-unsupported",
					"error",
					`Scene command ${index} cannot set ${capability.source.kind} effect capability "${source.capabilityId}" as a numeric node recipe control.`,
					{ kind: "node", id: nodeId, path: commandPath },
				),
			],
		};
	}
	if (capability.control.valueKind !== "number") {
		return {
			issues: [
				createAgentIssue(
					"agent.bindable-property-effect-value-kind-unsupported",
					"error",
					`Scene command ${index} cannot set ${capability.control.valueKind} effect capability "${source.capabilityId}" with numeric scene/set-bindable-property.`,
					{ kind: "node", id: nodeId, path: commandPath },
				),
			],
		};
	}
	return { capability, issues: [] };
};

const issueTargetForBindableEffectTarget = (
	scene: SceneDocument,
	target: AgentBindableEffectTarget,
	commandPath: string,
): AgentIssueTarget => {
	switch (target.scope) {
		case "scene":
			return { kind: "document", id: scene.id, path: commandPath };
		case "current-artboard":
			return {
				kind: "artboard",
				id: selectCurrentArtboard(scene).id,
				path: commandPath,
			};
		case "default-artboard":
			return {
				kind: "artboard",
				id: selectDefaultArtboard(scene).id,
				path: commandPath,
			};
		case "artboard":
			return { kind: "artboard", id: target.artboardId, path: commandPath };
	}
};

const effectIntentTargetForBindableTarget = (
	target: AgentBindableEffectTarget,
): EffectIntentTarget => {
	switch (target.scope) {
		case "scene":
			return { scope: "scene" };
		case "current-artboard":
			return { scope: "current-artboard" };
		case "default-artboard":
			return { scope: "default-artboard" };
		case "artboard":
			return { scope: "artboard", artboardId: target.artboardId };
	}
};

const bindableEffectTargetScope = (
	target: AgentBindableEffectTarget,
): "artboard" | "scene" => (target.scope === "scene" ? "scene" : "artboard");

const bindableEffectTargetKey = (
	scene: SceneDocument,
	target: AgentBindableEffectTarget,
): string | null => {
	switch (target.scope) {
		case "scene":
			return "scene";
		case "current-artboard":
			return `artboard:${selectCurrentArtboard(scene).id}`;
		case "default-artboard":
			return `artboard:${selectDefaultArtboard(scene).id}`;
		case "artboard":
			return findArtboardById(scene, target.artboardId)
				? `artboard:${target.artboardId}`
				: null;
	}
};

const effectExpressionTargetRefForBindableTarget = (
	scene: SceneDocument,
	target: AgentBindableEffectTarget,
): Extract<
	EffectExpressionTargetRef,
	{ readonly kind: "scene" | "artboard" }
> | null => {
	switch (target.scope) {
		case "scene":
			return { kind: "scene" };
		case "current-artboard":
			return { kind: "artboard", artboardId: selectCurrentArtboard(scene).id };
		case "default-artboard":
			return { kind: "artboard", artboardId: selectDefaultArtboard(scene).id };
		case "artboard":
			return findArtboardById(scene, target.artboardId)
				? { kind: "artboard", artboardId: target.artboardId }
				: null;
	}
};

const effectIntentForBindableTarget = (
	scene: SceneDocument,
	target: AgentBindableEffectTarget,
): EffectIntent | null | undefined => {
	switch (target.scope) {
		case "scene":
			return scene.effectIntent;
		case "current-artboard":
			return selectCurrentArtboard(scene).effectIntent;
		case "default-artboard":
			return selectDefaultArtboard(scene).effectIntent;
		case "artboard":
			return findArtboardById(scene, target.artboardId)?.effectIntent ?? null;
	}
};

const influenceRecipeForBindableTarget = (
	scene: SceneDocument,
	target: AgentBindableEffectTarget,
	currentIntent: EffectIntent | undefined,
): EffectInfluenceRecipe | null => {
	if (target.scope === "scene") return currentIntent?.influenceRecipe ?? null;
	const artboardId =
		target.scope === "artboard"
			? target.artboardId
			: target.scope === "default-artboard"
				? selectDefaultArtboard(scene).id
				: selectCurrentArtboard(scene).id;
	return resolveFrameEffectIntent(scene, artboardId).influenceRecipe;
};

const applyAgentEffectFieldOperation = (
	recipe: EffectInfluenceRecipe,
	operation: AgentEffectFieldOperation,
): EffectInfluenceRecipe => {
	switch (operation.kind) {
		case "upsert-field":
			return upsertEffectFieldDefinition(recipe, operation.field);
		case "remove-field":
			return removeEffectFieldDefinition(recipe, operation.fieldId);
		case "attach-route":
			return attachEffectInfluenceAssignment(recipe, operation.assignment);
		case "remove-route":
			return {
				...recipe,
				assignments: recipe.assignments.filter(
					(assignment) => assignment.id !== operation.assignmentId,
				),
			};
		case "link-route":
			return linkEffectInfluenceAssignmentField(
				recipe,
				operation.assignmentId,
				operation.fieldId,
			);
		case "unlink-route":
			return unlinkEffectInfluenceAssignmentField(
				recipe,
				operation.assignmentId,
			);
		case "replace-field-source":
			return replaceEffectFieldSource(
				recipe,
				operation.fieldId,
				operation.source,
			);
		case "update-influence": {
			const matches = recipe.assignments.filter(
				(assignment) => assignment.id === operation.assignmentId,
			);
			if (matches.length !== 1) return recipe;
			return {
				...recipe,
				assignments: recipe.assignments.map((assignment) =>
					assignment.id === operation.assignmentId
						? normalizeEffectInfluenceAssignment({
								...assignment,
								influence: normalizeEffectInfluence({
									...assignment.influence,
									...operation.patch,
									source: assignment.influence.source,
									falloff: {
										...assignment.influence.falloff,
										...operation.patch.falloff,
									},
								}),
							})
						: assignment,
				),
			};
		}
	}
};

const effectFieldRouteIssueKey = (issue: {
	readonly code: string;
	readonly assignmentId?: string;
	readonly fieldId?: string;
	readonly routeKey?: string;
}): string =>
	[
		issue.code,
		issue.assignmentId ?? "",
		issue.fieldId ?? "",
		issue.routeKey ?? "",
	].join(":");

const missingEffectFieldTargetKeys = (
	scene: SceneDocument,
	recipe: EffectInfluenceRecipe,
): ReadonlySet<string> =>
	new Set(
		recipe.assignments.flatMap((assignment) => {
			const id = assignment.target.id;
			if (!id) return [];
			const missing =
				assignment.target.scope === "object" ||
				assignment.target.scope === "group"
					? !findNode(scene, id)
					: assignment.target.scope === "layer"
						? !scene.layers.some((layer) => layer.id === id)
						: false;
			return missing
				? [`${assignment.id}:${assignment.target.scope}:${id}`]
				: [];
		}),
	);

const compileAgentEffectFieldOperation = ({
	scene,
	current,
	operation,
	index,
	target,
}: {
	readonly scene: SceneDocument;
	readonly current: EffectInfluenceRecipe;
	readonly operation: AgentEffectFieldOperation;
	readonly index: number;
	readonly target: AgentIssueTarget;
}): EffectFieldCommandCompile => {
	const next = normalizeEffectInfluenceRecipe(
		applyAgentEffectFieldOperation(current, operation),
	);
	if (sameJson(current, next)) {
		return {
			issues: [
				createAgentIssue(
					"agent.effect-field-operation-noop",
					"error",
					`Scene command ${index} did not resolve one unique Effect Field owner.`,
					target,
				),
			],
		};
	}
	const missingBefore = missingEffectFieldTargetKeys(scene, current);
	const newlyMissingTargets = [
		...missingEffectFieldTargetKeys(scene, next),
	].filter((key) => !missingBefore.has(key));
	if (newlyMissingTargets.length > 0) {
		return {
			issues: newlyMissingTargets.map((key) =>
				createAgentIssue(
					"agent.effect-field-target-missing",
					"error",
					`Scene command ${index} introduced an Effect Field route with a missing target (${key}).`,
					target,
				),
			),
		};
	}
	const before = compileEffectFieldRoutes(current, { surface: "editor-svg" });
	const after = compileEffectFieldRoutes(next, { surface: "editor-svg" });
	const existingIssueKeys = new Set(
		before.issues.map(effectFieldRouteIssueKey),
	);
	const introducedIssues = after.issues.filter(
		(issue) => !existingIssueKeys.has(effectFieldRouteIssueKey(issue)),
	);
	if (introducedIssues.length > 0) {
		return {
			issues: introducedIssues.map((issue) =>
				createAgentIssue(
					`agent.effect-field-${issue.code}`,
					"error",
					`Scene command ${index} produced ${issue.code}: ${issue.detail}.`,
					target,
				),
			),
		};
	}
	const beforeRoutes = new Set(
		before.routes.map((route) => `${route.routeKey}:${route.fidelity.status}`),
	);
	const newlyInvisible = after.routes.filter(
		(route) =>
			!beforeRoutes.has(`${route.routeKey}:${route.fidelity.status}`) &&
			route.fidelity.status !== "native" &&
			route.fidelity.status !== "approximated",
	);
	if (newlyInvisible.length > 0) {
		return {
			issues: newlyInvisible.map((route) =>
				createAgentIssue(
					"agent.effect-field-surface-deferred",
					"error",
					`Scene command ${index} targets ${route.descriptorId}, which is ${route.fidelity.status} on the editor surface: ${route.fidelity.reason ?? "no native adapter"}.`,
					target,
				),
			),
		};
	}
	return { recipe: next, issues: [] };
};

const effectLayerOwnerForBindableTarget = (
	scene: SceneDocument,
	target: AgentBindableEffectTarget,
): EffectLayerOwnerRef | null => {
	switch (target.scope) {
		case "scene":
			return { scope: "scene" };
		case "current-artboard":
			return { scope: "artboard", artboardId: selectCurrentArtboard(scene).id };
		case "default-artboard":
			return { scope: "artboard", artboardId: selectDefaultArtboard(scene).id };
		case "artboard":
			return findArtboardById(scene, target.artboardId)
				? { scope: "artboard", artboardId: target.artboardId }
				: null;
	}
};

const effectLayerStackForBindableTarget = (
	scene: SceneDocument,
	target: AgentBindableEffectTarget,
	currentIntent: EffectIntent | null | undefined,
): EffectLayerStack | undefined => {
	const owner = effectLayerOwnerForBindableTarget(scene, target);
	if (!owner || currentIntent === null) return undefined;
	return effectLayerStackFromIntent(currentIntent, owner);
};

/**
 * Seeds the graph-first Look for a target with the SAME precedence the canvas and
 * export read: explicit `lookGraph` → stack → recipe projection, AND artboard
 * inherits a scene-level Look unless it overrides it. Seeding from the target slot
 * alone would let a first patch overwrite an inherited scene Look from an empty
 * graph; resolving artboard-over-scene makes the patch build on what
 * `list_look_graph` reports.
 */
const lookGraphForBindableTarget = (
	scene: SceneDocument,
	target: AgentBindableEffectTarget,
): LookGraph | undefined => {
	const owner = effectLayerOwnerForBindableTarget(scene, target);
	if (!owner) return undefined;
	if (owner.scope === "artboard") {
		return resolveFrameLookGraph(scene, owner.artboardId) ?? undefined;
	}
	return lookGraphFromIntent(scene.effectIntent, owner) ?? undefined;
};

const scopedOverlayForLookGraphTarget = (
	scene: SceneDocument,
	target: Extract<AgentLookGraphTarget, { readonly scope: "scoped-overlay" }>,
) => {
	const artboard = findArtboardById(scene, target.artboardId);
	if (!artboard) return null;
	return (
		scopedLookGraphOverlays(artboard).find(
			(overlay) => overlay.id === target.scopedLookId,
		) ?? null
	);
};

const issueTargetForLookGraphTarget = (
	scene: SceneDocument,
	target: AgentLookGraphTarget,
	commandPath: string,
): AgentIssueTarget =>
	target.scope === "scoped-overlay"
		? { kind: "artboard", id: target.artboardId, path: commandPath }
		: issueTargetForBindableEffectTarget(scene, target, commandPath);

const lookGraphTargetKey = (
	scene: SceneDocument,
	target: AgentLookGraphTarget,
): string | null => {
	if (target.scope === "scoped-overlay") {
		return scopedOverlayForLookGraphTarget(scene, target)
			? `scoped-overlay:${target.artboardId}:${target.scopedLookId}`
			: null;
	}
	return bindableEffectTargetKey(scene, target);
};

const lookGraphOwnerForTarget = (
	scene: SceneDocument,
	target: AgentLookGraphTarget,
): LookGraphOwnerRef | null => {
	if (target.scope === "scoped-overlay") {
		return scopedOverlayForLookGraphTarget(scene, target)
			? {
					scope: "scoped-overlay",
					artboardId: target.artboardId,
					scopedLookId: target.scopedLookId,
				}
			: null;
	}
	return effectLayerOwnerForBindableTarget(scene, target);
};

const lookGraphForTarget = (
	scene: SceneDocument,
	target: AgentLookGraphTarget,
): LookGraph | undefined => {
	if (target.scope === "scoped-overlay") {
		return scopedOverlayForLookGraphTarget(scene, target)?.lookGraph;
	}
	return lookGraphForBindableTarget(scene, target);
};

const lookGraphForLookNodeKeyframeOwner = (
	scene: SceneDocument,
	owner: LookGraphOwnerRef,
): LookGraph | null => {
	switch (owner.scope) {
		case "scene":
			return lookGraphFromIntent(scene.effectIntent, owner) ?? null;
		case "artboard":
			return resolveFrameLookGraph(scene, owner.artboardId);
		case "scoped-overlay": {
			const artboard = findArtboardById(scene, owner.artboardId);
			return artboard
				? (scopedLookGraphOverlays(artboard).find(
						(overlay) => overlay.id === owner.scopedLookId,
					)?.lookGraph ?? null)
				: null;
		}
		case "node": {
			const node = findNode(scene, owner.nodeId);
			const recipe = node ? resolveNodeRecipe(node) : null;
			return recipe ? (lookGraphFromVisualRecipe(recipe, owner) ?? null) : null;
		}
	}
};

/**
 * Validates one look-graph operation against its PRE-state (the graph before this
 * op), returning typed agent issues for the acceptance-critical failures: a
 * `connect` whose ports are incompatible/occupied/cyclic (via {@link validateLookEdge};
 * `replaceInput` clears an occupied single input first) and a node-referencing op
 * whose node id does not exist. Add/update payloads are checked before
 * normalization so unsupported blur keys cannot disappear behind a successful
 * agent result. `disconnect` remains normalization-owned.
 */
const validateLookGraphOperation = (
	graph: LookGraph | undefined,
	operation: LookGraphOperation,
	index: number,
	issueTarget: AgentIssueTarget,
): readonly AgentIssue[] => {
	const nodeMissingIssue = (nodeId: string): readonly AgentIssue[] =>
		graph?.nodes.some((node) => node.id === nodeId)
			? []
			: [
					createAgentIssue(
						"agent.look-graph-node-missing",
						"error",
						`Scene command ${index} references unknown look node "${nodeId}".`,
						issueTarget,
					),
				];
	switch (operation.kind) {
		case "add-node":
			return validateLookGraphNodePayloadPatch(
				operation.node,
				operation.node.payload,
			).map((issue) =>
				createAgentIssue(
					`agent.look-graph-${issue.code}`,
					"error",
					`Scene command ${index}: ${issue.message}`,
					{
						...issueTarget,
						path: `${issueTarget.path ?? "look-graph"}/payload/${issue.key}`,
					},
				),
			);
		case "connect": {
			if (!graph) {
				return [
					createAgentIssue(
						"agent.look-graph-node-missing",
						"error",
						`Scene command ${index} connects ports in an empty look graph.`,
						issueTarget,
					),
				];
			}
			const targetPort = graph.nodes
				.find((node) => node.id === operation.to.nodeId)
				?.inputs.find((port) => port.id === operation.to.portId);
			const validationGraph =
				operation.replaceInput === true && targetPort?.cardinality === "single"
					? (normalizeLookGraph({
							...graph,
							edges: graph.edges.filter(
								(edge) =>
									edge.to.nodeId !== operation.to.nodeId ||
									edge.to.portId !== operation.to.portId,
							),
						}) ?? graph)
					: graph;
			return validateLookEdge(
				validationGraph,
				operation.from,
				operation.to,
			).map((issue) =>
				createAgentIssue(
					`agent.look-graph-${issue.code}`,
					"error",
					`Scene command ${index}: ${issue.message}.`,
					issueTarget,
				),
			);
		}
		case "update-node": {
			const missing = nodeMissingIssue(operation.nodeId);
			if (missing.length > 0) return missing;
			const node = graph?.nodes.find(
				(candidate) => candidate.id === operation.nodeId,
			);
			return node
				? validateLookGraphNodePayloadPatch(node, operation.patch.payload).map(
						(issue) =>
							createAgentIssue(
								`agent.look-graph-${issue.code}`,
								"error",
								`Scene command ${index}: ${issue.message}`,
								{
									...issueTarget,
									path: `${issueTarget.path ?? "look-graph"}/payload/${issue.key}`,
								},
							),
					)
				: [];
		}
		case "remove-node":
		case "move-node":
		case "set-output":
			return nodeMissingIssue(operation.nodeId);
		default:
			return [];
	}
};

const effectCapabilityForFrameIntentWrite = (
	source: EffectBindablePropertySource,
	target: AgentBindableEffectTarget,
	index: number,
	issueTarget: AgentIssueTarget,
): {
	readonly capability?: EffectCapabilityDescriptor;
	readonly issues: readonly AgentIssue[];
} => {
	const capability = effectCapabilityById(source.capabilityId);
	if (!capability) {
		return {
			issues: [
				createAgentIssue(
					"agent.bindable-property-effect-capability-missing",
					"error",
					`Scene command ${index} references missing effect capability "${source.capabilityId}".`,
					issueTarget,
				),
			],
		};
	}
	const targetScope = bindableEffectTargetScope(target);
	if (!capability.targetScopes.some((scope) => scope === targetScope)) {
		return {
			issues: [
				createAgentIssue(
					"agent.bindable-property-effect-scope-unsupported",
					"error",
					`Scene command ${index} cannot set ${targetScope} target with effect capability "${source.capabilityId}".`,
					issueTarget,
				),
			],
		};
	}
	if (
		capability.source.kind !== "recipe-control" &&
		capability.source.kind !== "influence-control"
	) {
		return {
			issues: [
				createAgentIssue(
					"agent.bindable-property-effect-source-unsupported",
					"error",
					`Scene command ${index} cannot set ${capability.source.kind} effect capability "${source.capabilityId}" as a numeric frame recipe or influence control.`,
					issueTarget,
				),
			],
		};
	}
	if (capability.control.valueKind !== "number") {
		return {
			issues: [
				createAgentIssue(
					"agent.bindable-property-effect-value-kind-unsupported",
					"error",
					`Scene command ${index} cannot set ${capability.control.valueKind} effect capability "${source.capabilityId}" with numeric scene/set-bindable-effect-property.`,
					issueTarget,
				),
			],
		};
	}
	return { capability, issues: [] };
};

const effectCapabilityForFrameExpressionWrite = (
	source: EffectBindablePropertySource,
	target: AgentBindableEffectTarget,
	index: number,
	issueTarget: AgentIssueTarget,
): {
	readonly capability?: EffectCapabilityDescriptor;
	readonly issues: readonly AgentIssue[];
} => {
	const capability = effectCapabilityById(source.capabilityId);
	if (!capability) {
		return {
			issues: [
				createAgentIssue(
					"agent.bindable-expression-effect-capability-missing",
					"error",
					`Scene command ${index} references missing effect capability "${source.capabilityId}".`,
					issueTarget,
				),
			],
		};
	}
	const targetScope = bindableEffectTargetScope(target);
	if (!capability.targetScopes.some((scope) => scope === targetScope)) {
		return {
			issues: [
				createAgentIssue(
					"agent.bindable-expression-effect-scope-unsupported",
					"error",
					`Scene command ${index} cannot bind ${targetScope} target with effect capability "${source.capabilityId}".`,
					issueTarget,
				),
			],
		};
	}
	if (
		capability.source.kind !== "recipe-control" &&
		capability.source.kind !== "influence-control"
	) {
		return {
			issues: [
				createAgentIssue(
					"agent.bindable-expression-effect-source-unsupported",
					"error",
					`Scene command ${index} cannot bind expressions to ${capability.source.kind} effect capability "${source.capabilityId}".`,
					issueTarget,
				),
			],
		};
	}
	if (!capability.control.expressionBindable) {
		return {
			issues: [
				createAgentIssue(
					"agent.bindable-expression-effect-unsupported",
					"error",
					`Scene command ${index} cannot bind expressions to non-expression-bindable effect capability "${source.capabilityId}".`,
					issueTarget,
				),
			],
		};
	}
	return { capability, issues: [] };
};

const applyEffectBindableValue = (
	recipe: VisualRecipe | null | undefined,
	capability: EffectCapabilityDescriptor,
	value: number,
	index: number,
	nodeId: string,
	commandPath: string,
): { readonly recipe?: VisualRecipe | null; issues: readonly AgentIssue[] } => {
	if (capability.source.kind !== "recipe-control") {
		return {
			issues: [
				createAgentIssue(
					"agent.bindable-property-effect-source-unsupported",
					"error",
					`Scene command ${index} cannot set ${capability.source.kind} effect capability "${capability.id}" as a node recipe control.`,
					{ kind: "node", id: nodeId, path: commandPath },
				),
			],
		};
	}
	const result = updateRecipeControl(
		recipe ?? NEUTRAL_VISUAL_RECIPE,
		capability.source.recipePath,
		value,
	);
	if (result.kind === "invalid-path") {
		return {
			issues: [
				createAgentIssue(
					"agent.bindable-property-effect-path-invalid",
					"error",
					`Scene command ${index} cannot set unregistered recipe path "${result.path}".`,
					{ kind: "node", id: nodeId, path: commandPath },
				),
			],
		};
	}
	if (result.kind === "invalid-value") {
		return {
			issues: [
				createAgentIssue(
					"agent.bindable-property-effect-value-invalid",
					"error",
					`Scene command ${index} cannot set effect capability "${capability.id}" to ${value}: ${result.reason}.`,
					{ kind: "node", id: nodeId, path: commandPath },
				),
			],
		};
	}
	return {
		recipe: recipeOrNullForSceneCommand(result.recipe),
		issues: [],
	};
};

const applyFrameEffectBindableValue = (
	recipe: VisualRecipe | null | undefined,
	capability: EffectCapabilityDescriptor,
	value: number,
	index: number,
	issueTarget: AgentIssueTarget,
): { readonly recipe?: VisualRecipe | null; issues: readonly AgentIssue[] } => {
	if (capability.source.kind !== "recipe-control") {
		return {
			issues: [
				createAgentIssue(
					"agent.bindable-property-effect-source-unsupported",
					"error",
					`Scene command ${index} cannot set ${capability.source.kind} effect capability "${capability.id}" as a frame recipe control.`,
					issueTarget,
				),
			],
		};
	}
	const result = updateRecipeControl(
		recipe ?? NEUTRAL_VISUAL_RECIPE,
		capability.source.recipePath,
		value,
	);
	if (result.kind === "invalid-path") {
		return {
			issues: [
				createAgentIssue(
					"agent.bindable-property-effect-path-invalid",
					"error",
					`Scene command ${index} cannot set unregistered recipe path "${result.path}".`,
					issueTarget,
				),
			],
		};
	}
	if (result.kind === "invalid-value") {
		return {
			issues: [
				createAgentIssue(
					"agent.bindable-property-effect-value-invalid",
					"error",
					`Scene command ${index} cannot set effect capability "${capability.id}" to ${value}: ${result.reason}.`,
					issueTarget,
				),
			],
		};
	}
	return {
		recipe: recipeOrNullForSceneCommand(result.recipe),
		issues: [],
	};
};

const capabilityNumberValueIssue = (
	capability: EffectCapabilityDescriptor,
	value: number,
	index: number,
	issueTarget: AgentIssueTarget,
): AgentIssue | null => {
	const { min, max } = capability.control;
	if (min !== undefined && value < min) {
		return createAgentIssue(
			"agent.bindable-property-effect-value-invalid",
			"error",
			`Scene command ${index} cannot set effect capability "${capability.id}" to ${value}: value must be at least ${min}.`,
			issueTarget,
		);
	}
	if (max !== undefined && value > max) {
		return createAgentIssue(
			"agent.bindable-property-effect-value-invalid",
			"error",
			`Scene command ${index} cannot set effect capability "${capability.id}" to ${value}: value must be at most ${max}.`,
			issueTarget,
		);
	}
	return null;
};

const primaryFrameInfluenceAssignmentId = (
	recipe: EffectInfluenceRecipe,
): string | null =>
	recipe.assignments.find(
		(assignment) => assignment.id === DEFAULT_FRAME_INFLUENCE_ASSIGNMENT_ID,
	)?.id ??
	recipe.assignments.find(
		(assignment) =>
			assignment.target.scope === "scene" &&
			assignment.effect.path.startsWith("recipe"),
	)?.id ??
	null;

const applyFrameInfluenceBindableValue = (
	recipe: EffectInfluenceRecipe | null | undefined,
	capability: EffectCapabilityDescriptor,
	value: number,
	index: number,
	issueTarget: AgentIssueTarget,
): {
	readonly recipe?: EffectInfluenceRecipe;
	readonly issues: readonly AgentIssue[];
} => {
	if (capability.source.kind !== "influence-control") {
		return {
			issues: [
				createAgentIssue(
					"agent.bindable-property-effect-source-unsupported",
					"error",
					`Scene command ${index} cannot set ${capability.source.kind} effect capability "${capability.id}" as a frame influence control.`,
					issueTarget,
				),
			],
		};
	}
	const valueIssue = capabilityNumberValueIssue(
		capability,
		value,
		index,
		issueTarget,
	);
	if (valueIssue) return { issues: [valueIssue] };

	const current = normalizeEffectInfluenceRecipe(recipe ?? undefined);
	const base =
		current.assignments.length > 0 ? current : defaultFrameInfluenceRecipe();
	const assignmentId =
		primaryFrameInfluenceAssignmentId(base) ??
		DEFAULT_FRAME_INFLUENCE_ASSIGNMENT_ID;
	const field = capability.source.field;
	const recipeDraft: EffectInfluenceRecipeDraft = {
		enabled: true,
		...(base.fields ? { fields: base.fields } : {}),
		assignments: base.assignments.map((assignment) =>
			assignment.id === assignmentId
				? {
						...assignment,
						influence: {
							...assignment.influence,
							[field]: value,
						},
					}
				: assignment,
		),
	};
	return {
		recipe: normalizeEffectInfluenceRecipe(recipeDraft),
		issues: [],
	};
};

const compileEffectBindableSceneCommand = (
	source: EffectBindablePropertySource,
	node: VectorNode,
	value: number,
	index: number,
	commandPath: string,
	batchState?: BindableSceneBatchState,
): { compiled?: AgentCompiledSceneCommand; issues: readonly AgentIssue[] } => {
	const capabilityResult = effectCapabilityForNodeRecipeWrite(
		source,
		index,
		node.id,
		commandPath,
	);
	if (!capabilityResult.capability) return { issues: capabilityResult.issues };
	const currentResult = applyEffectBindableValue(
		node.recipe,
		capabilityResult.capability,
		value,
		index,
		node.id,
		commandPath,
	);
	if (currentResult.recipe === undefined) return currentResult;
	const recipe = batchState?.effectRecipesByNodeId.has(node.id)
		? (batchState.effectRecipesByNodeId.get(node.id) ?? null)
		: currentResult.recipe;
	return {
		compiled: {
			command: createUpdateNodeRecipeCommand(node.id, recipe),
			target: { kind: "node", id: node.id, path: commandPath },
		},
		issues: [],
	};
};

const compileDuplicateGeneratorBindableSceneCommand = (
	scene: SceneDocument,
	source: DuplicateGeneratorBindablePropertySource,
	node: VectorNode,
	value: number,
	commandPath: string,
	batchState?: BindableSceneBatchState,
): { compiled?: AgentCompiledSceneCommand; issues: readonly AgentIssue[] } => {
	const generator =
		batchState?.duplicateGeneratorsByNodeId.get(node.id) ??
		setDuplicateGeneratorBindableChannel(
			duplicateGeneratorForNode(scene, node.id) ??
				defaultDuplicateGeneratorForNode(node.id),
			source,
			value,
		);
	return {
		compiled: {
			command: createSetDuplicateGeneratorCommand(generator),
			target: { kind: "node", id: node.id, path: commandPath },
		},
		issues: [],
	};
};

const compileEffectBindableExpressionSceneCommand = (
	source: EffectBindablePropertySource,
	node: VectorNode,
	expressionSource: string,
	index: number,
	commandPath: string,
): { compiled?: AgentCompiledSceneCommand; issues: readonly AgentIssue[] } => {
	const target = { kind: "node", id: node.id, path: commandPath } as const;
	const capability = expressionBindableCapability(source.capabilityId);
	if (!capability) {
		return {
			issues: [
				createAgentIssue(
					"agent.bindable-expression-effect-unsupported",
					"error",
					`Scene command ${index} cannot bind an expression to effect capability "${source.capabilityId}".`,
					target,
				),
			],
		};
	}
	if (!capability.targetScopes.some((scope) => scope === "node")) {
		return {
			issues: [
				createAgentIssue(
					"agent.bindable-expression-effect-scope-unsupported",
					"error",
					`Scene command ${index} cannot bind node-scoped effect code to non-node capability "${source.capabilityId}".`,
					target,
				),
			],
		};
	}
	if (capability.source.kind !== "recipe-control") {
		return {
			issues: [
				createAgentIssue(
					"agent.bindable-expression-effect-source-unsupported",
					"error",
					`Scene command ${index} cannot bind expressions to ${capability.source.kind} effect capability "${source.capabilityId}".`,
					target,
				),
			],
		};
	}
	const parsed = parseBindableExpression(
		expressionSource,
		EFFECT_EXPR_VARS,
		index,
		target,
	);
	if (!parsed.expression) return { issues: parsed.issues };
	return {
		compiled: {
			command: createSetEffectExpressionBindingCommand({
				id: `${capability.id}@node:${node.id}`,
				capabilityId: capability.id,
				recipePath: capability.source.recipePath,
				targetScope: "node",
				targetRef: { kind: "node", nodeId: node.id },
				expr: parsed.expression,
			}),
			target,
		},
		issues: [],
	};
};

const compileClearEffectBindableExpressionSceneCommand = (
	source: EffectBindablePropertySource,
	node: VectorNode,
	index: number,
	commandPath: string,
): { compiled?: AgentCompiledSceneCommand; issues: readonly AgentIssue[] } => {
	const target = { kind: "node", id: node.id, path: commandPath } as const;
	const capability = expressionBindableCapability(source.capabilityId);
	if (!capability) {
		return {
			issues: [
				createAgentIssue(
					"agent.bindable-expression-effect-unsupported",
					"error",
					`Scene command ${index} cannot clear an expression for effect capability "${source.capabilityId}".`,
					target,
				),
			],
		};
	}
	if (!capability.targetScopes.some((scope) => scope === "node")) {
		return {
			issues: [
				createAgentIssue(
					"agent.bindable-expression-effect-scope-unsupported",
					"error",
					`Scene command ${index} cannot clear node-scoped effect code from non-node capability "${source.capabilityId}".`,
					target,
				),
			],
		};
	}
	if (capability.source.kind !== "recipe-control") {
		return {
			issues: [
				createAgentIssue(
					"agent.bindable-expression-effect-source-unsupported",
					"error",
					`Scene command ${index} cannot clear expressions from ${capability.source.kind} effect capability "${source.capabilityId}".`,
					target,
				),
			],
		};
	}
	return {
		compiled: {
			command: createClearEffectExpressionBindingCommand(capability.id, {
				kind: "node",
				nodeId: node.id,
			}),
			target,
		},
		issues: [],
	};
};

const compileNativeBindableExpressionSceneCommand = (
	propertyId: string,
	node: VectorNode,
	expressionSource: string,
	index: number,
	commandPath: string,
): { compiled?: AgentCompiledSceneCommand; issues: readonly AgentIssue[] } => {
	const target = { kind: "node", id: node.id, path: commandPath } as const;
	const nativePropertyId = nativeExpressionPropertyIdFromBindableId(propertyId);
	const supportedProperties = NATIVE_EXPRESSION_PROPERTY_IDS.join(", ");
	if (!nativePropertyId) {
		return {
			issues: [
				createAgentIssue(
					"agent.bindable-expression-source-unsupported",
					"error",
					`Scene command ${index} cannot bind expressions to native property "${propertyId}" yet; supported native expression properties are ${supportedProperties}.`,
					target,
				),
			],
		};
	}
	if (
		!bindablePropertiesForGeometryKind(node.geometry.kind).some(
			(descriptor) => descriptor.id === nativePropertyId,
		)
	) {
		return {
			issues: [
				createAgentIssue(
					"agent.bindable-expression-target-ineligible",
					"error",
					`Scene command ${index} cannot bind expression property "${propertyId}" to ${node.geometry.kind} node "${node.id}".`,
					target,
				),
			],
		};
	}
	const parsed = parseBindableExpression(
		expressionSource,
		EFFECT_EXPR_VARS,
		index,
		target,
	);
	if (!parsed.expression) return { issues: parsed.issues };
	return {
		compiled: {
			command: createSetNativeExpressionBindingCommand({
				id: nativeExpressionBindingId(node.id, nativePropertyId),
				nodeId: node.id,
				propertyId: nativePropertyId,
				expr: parsed.expression,
			}),
			target,
		},
		issues: [],
	};
};

const compileClearNativeBindableExpressionSceneCommand = (
	propertyId: string,
	node: VectorNode,
	index: number,
	commandPath: string,
): { compiled?: AgentCompiledSceneCommand; issues: readonly AgentIssue[] } => {
	const target = { kind: "node", id: node.id, path: commandPath } as const;
	const nativePropertyId = nativeExpressionPropertyIdFromBindableId(propertyId);
	const supportedProperties = NATIVE_EXPRESSION_PROPERTY_IDS.join(", ");
	if (!nativePropertyId) {
		return {
			issues: [
				createAgentIssue(
					"agent.bindable-expression-source-unsupported",
					"error",
					`Scene command ${index} cannot clear expressions from native property "${propertyId}" yet; supported native expression properties are ${supportedProperties}.`,
					target,
				),
			],
		};
	}
	return {
		compiled: {
			command: createClearNativeExpressionBindingCommand(
				node.id,
				nativePropertyId,
			),
			target,
		},
		issues: [],
	};
};

const compileDuplicateGeneratorExpressionSceneCommand = (
	scene: SceneDocument,
	source: DuplicateGeneratorBindablePropertySource,
	node: VectorNode,
	expressionSource: string,
	index: number,
	commandPath: string,
	batchState?: BindableSceneBatchState,
): { compiled?: AgentCompiledSceneCommand; issues: readonly AgentIssue[] } => {
	const target = { kind: "node", id: node.id, path: commandPath } as const;
	const parsed = parseBindableExpression(
		expressionSource,
		DUPLICATE_EXPR_VARS,
		index,
		target,
	);
	if (!parsed.expression) return { issues: parsed.issues };
	const generator = setDuplicateGeneratorExpressionChannel(
		batchState?.duplicateGeneratorsByNodeId.get(node.id) ??
			duplicateGeneratorForNode(scene, node.id) ??
			defaultDuplicateGeneratorForNode(node.id),
		source,
		parsed.expression,
	);
	return {
		compiled: {
			command: createSetDuplicateGeneratorCommand(generator),
			target,
		},
		issues: [],
	};
};

const compileClearDuplicateGeneratorExpressionSceneCommand = (
	scene: SceneDocument,
	source: DuplicateGeneratorBindablePropertySource,
	node: VectorNode,
	commandPath: string,
	batchState?: BindableSceneBatchState,
): { compiled?: AgentCompiledSceneCommand; issues: readonly AgentIssue[] } => {
	const target = { kind: "node", id: node.id, path: commandPath } as const;
	const batchGenerator = batchState?.duplicateGeneratorsByNodeId.get(node.id);
	if (batchGenerator) {
		return {
			compiled: {
				command: createSetDuplicateGeneratorCommand(batchGenerator),
				target,
			},
			issues: [],
		};
	}
	const current = duplicateGeneratorForNode(scene, node.id);
	if (!current) {
		return { issues: [] };
	}
	if (
		source.channel !== "count" &&
		current.instance[source.channel] === undefined
	) {
		return { issues: [] };
	}
	const generator = clearDuplicateGeneratorExpressionChannel(current, source);
	return {
		compiled: {
			command: createSetDuplicateGeneratorCommand(generator),
			target,
		},
		issues: [],
	};
};

const compileFrameEffectBindableSceneCommand = (
	scene: SceneDocument,
	source: EffectBindablePropertySource,
	target: AgentBindableEffectTarget,
	value: number,
	index: number,
	commandPath: string,
	batchState?: BindableSceneBatchState,
): { compiled?: AgentCompiledSceneCommand; issues: readonly AgentIssue[] } => {
	const issueTarget = issueTargetForBindableEffectTarget(
		scene,
		target,
		commandPath,
	);
	const targetKey = bindableEffectTargetKey(scene, target);
	if (!targetKey) {
		return {
			issues: [
				createAgentIssue(
					"agent.bindable-property-effect-target-missing",
					"error",
					`Scene command ${index} targets missing artboard "${target.scope === "artboard" ? target.artboardId : ""}".`,
					issueTarget,
				),
			],
		};
	}
	const capabilityResult = effectCapabilityForFrameIntentWrite(
		source,
		target,
		index,
		issueTarget,
	);
	if (!capabilityResult.capability) return { issues: capabilityResult.issues };
	const { capability } = capabilityResult;
	const currentIntent = effectIntentForBindableTarget(scene, target);
	if (currentIntent === null) {
		return {
			issues: [
				createAgentIssue(
					"agent.bindable-property-effect-target-missing",
					"error",
					`Scene command ${index} cannot find the requested effect target.`,
					issueTarget,
				),
			],
		};
	}
	if (capability.source.kind === "influence-control") {
		const currentResult = applyFrameInfluenceBindableValue(
			batchState?.frameInfluenceRecipesByTargetKey.get(targetKey) ??
				influenceRecipeForBindableTarget(scene, target, currentIntent),
			capability,
			value,
			index,
			issueTarget,
		);
		if (currentResult.recipe === undefined) return currentResult;
		return {
			compiled: {
				command: createUpdateEffectIntentCommand(
					effectIntentTargetForBindableTarget(target),
					{ influenceRecipe: currentResult.recipe },
					{ label: "Edit influence mask" },
				),
				target: issueTarget,
			},
			issues: [],
		};
	}
	const currentResult = applyFrameEffectBindableValue(
		currentIntent?.visualRecipe,
		capability,
		value,
		index,
		issueTarget,
	);
	if (currentResult.recipe === undefined) return currentResult;
	const recipe = batchState?.frameEffectRecipesByTargetKey.has(targetKey)
		? (batchState.frameEffectRecipesByTargetKey.get(targetKey) ?? null)
		: currentResult.recipe;
	return {
		compiled: {
			command: createUpdateEffectIntentCommand(
				effectIntentTargetForBindableTarget(target),
				{ visualRecipe: recipe },
				{ label: "Edit frame look" },
			),
			target: issueTarget,
		},
		issues: [],
	};
};

const compileEffectLayerStackOperationSceneCommand = (
	scene: SceneDocument,
	target: AgentBindableEffectTarget,
	operation: EffectLayerStackOperation,
	index: number,
	commandPath: string,
	batchState?: BindableSceneBatchState,
): { compiled?: AgentCompiledSceneCommand; issues: readonly AgentIssue[] } => {
	const issueTarget = issueTargetForBindableEffectTarget(
		scene,
		target,
		commandPath,
	);
	const targetKey = bindableEffectTargetKey(scene, target);
	const owner = effectLayerOwnerForBindableTarget(scene, target);
	if (!targetKey || !owner) {
		return {
			issues: [
				createAgentIssue(
					"agent.effect-layer-stack-target-missing",
					"error",
					`Scene command ${index} targets a missing effect-stack artboard.`,
					issueTarget,
				),
			],
		};
	}
	const currentIntent = effectIntentForBindableTarget(scene, target);
	if (currentIntent === null) {
		return {
			issues: [
				createAgentIssue(
					"agent.effect-layer-stack-target-missing",
					"error",
					`Scene command ${index} cannot find the requested effect-stack target.`,
					issueTarget,
				),
			],
		};
	}
	const currentStack = batchState?.effectLayerStacksByTargetKey.has(targetKey)
		? (batchState.effectLayerStacksByTargetKey.get(targetKey) ?? undefined)
		: effectLayerStackForBindableTarget(scene, target, currentIntent);
	const nextStack = applyEffectLayerStackOperation(
		currentStack,
		operation,
		owner,
	);
	return {
		compiled: {
			command: createSetEffectLayerStackCommand(
				effectIntentTargetForBindableTarget(target),
				nextStack,
				{ label: "Edit effect stack" },
			),
			target: issueTarget,
		},
		issues: [],
	};
};

const compileEffectLayerPropertySceneCommand = (
	scene: SceneDocument,
	target: AgentBindableEffectTarget,
	layerId: string,
	propertyId: string,
	value: number,
	index: number,
	commandPath: string,
	batchState?: BindableSceneBatchState,
): { compiled?: AgentCompiledSceneCommand; issues: readonly AgentIssue[] } => {
	const issueTarget = issueTargetForBindableEffectTarget(
		scene,
		target,
		commandPath,
	);
	const targetKey = bindableEffectTargetKey(scene, target);
	const owner = effectLayerOwnerForBindableTarget(scene, target);
	if (!targetKey || !owner) {
		return {
			issues: [
				createAgentIssue(
					"agent.effect-layer-property-target-missing",
					"error",
					`Scene command ${index} targets a missing effect-layer artboard.`,
					issueTarget,
				),
			],
		};
	}
	const descriptor = bindablePropertyById(propertyId);
	if (!descriptor) {
		return {
			issues: [
				createAgentIssue(
					"agent.effect-layer-property-unknown",
					"error",
					`Scene command ${index} references unknown effect-layer property "${propertyId}".`,
					issueTarget,
				),
			],
		};
	}
	if (!descriptor.control.agentWritable) {
		return {
			issues: [
				createAgentIssue(
					"agent.effect-layer-property-not-agent-writable",
					"error",
					`Scene command ${index} cannot write non-agent-writable effect-layer property "${propertyId}".`,
					issueTarget,
				),
			],
		};
	}
	if (descriptor.source.kind !== "effect-capability") {
		return {
			issues: [
				createAgentIssue(
					"agent.effect-layer-property-effect-source-required",
					"error",
					`Scene command ${index} cannot set non-effect property "${propertyId}" on an effect layer.`,
					issueTarget,
				),
			],
		};
	}
	const capabilityResult = effectCapabilityForFrameIntentWrite(
		descriptor.source,
		target,
		index,
		issueTarget,
	);
	if (!capabilityResult.capability) return { issues: capabilityResult.issues };
	const { capability } = capabilityResult;
	if (capability.source.kind !== "recipe-control") {
		return {
			issues: [
				createAgentIssue(
					"agent.effect-layer-property-recipe-source-required",
					"error",
					`Scene command ${index} cannot set ${capability.source.kind} capability "${capability.id}" on an effect layer recipe.`,
					issueTarget,
				),
			],
		};
	}
	const currentIntent = effectIntentForBindableTarget(scene, target);
	if (currentIntent === null) {
		return {
			issues: [
				createAgentIssue(
					"agent.effect-layer-property-target-missing",
					"error",
					`Scene command ${index} cannot find the requested effect-layer target.`,
					issueTarget,
				),
			],
		};
	}
	const currentStack = batchState?.effectLayerStacksByTargetKey.has(targetKey)
		? (batchState.effectLayerStacksByTargetKey.get(targetKey) ?? undefined)
		: effectLayerStackForBindableTarget(scene, target, currentIntent);
	const layer = currentStack?.layers.find(
		(candidate) => candidate.id === layerId,
	);
	if (!currentStack || !layer) {
		return {
			issues: [
				createAgentIssue(
					"agent.effect-layer-property-missing-layer",
					"error",
					`Scene command ${index} cannot find effect layer "${layerId}".`,
					issueTarget,
				),
			],
		};
	}
	const result = updateRecipeControl(
		layer.visualRecipe,
		capability.source.recipePath,
		value,
	);
	if (result.kind === "invalid-path") {
		return {
			issues: [
				createAgentIssue(
					"agent.effect-layer-property-path-invalid",
					"error",
					`Scene command ${index} cannot set unregistered recipe path "${result.path}".`,
					issueTarget,
				),
			],
		};
	}
	if (result.kind === "invalid-value") {
		return {
			issues: [
				createAgentIssue(
					"agent.effect-layer-property-value-invalid",
					"error",
					`Scene command ${index} cannot set effect layer property "${propertyId}" to ${value}: ${result.reason}.`,
					issueTarget,
				),
			],
		};
	}
	const nextStack = applyEffectLayerStackOperation(
		currentStack,
		{
			kind: "update",
			layerId,
			patch: { visualRecipe: result.recipe },
		},
		owner,
	);
	return {
		compiled: {
			command: createSetEffectLayerStackCommand(
				effectIntentTargetForBindableTarget(target),
				nextStack,
				{ label: "Edit effect layer" },
			),
			target: issueTarget,
		},
		issues: [],
	};
};

const compileFrameEffectExpressionSceneCommand = (
	scene: SceneDocument,
	source: EffectBindablePropertySource,
	target: AgentBindableEffectTarget,
	expressionSource: string,
	index: number,
	commandPath: string,
): { compiled?: AgentCompiledSceneCommand; issues: readonly AgentIssue[] } => {
	const issueTarget = issueTargetForBindableEffectTarget(
		scene,
		target,
		commandPath,
	);
	const targetRef = effectExpressionTargetRefForBindableTarget(scene, target);
	if (!targetRef) {
		return {
			issues: [
				createAgentIssue(
					"agent.bindable-expression-effect-target-missing",
					"error",
					`Scene command ${index} targets missing artboard "${target.scope === "artboard" ? target.artboardId : ""}".`,
					issueTarget,
				),
			],
		};
	}
	const capabilityResult = effectCapabilityForFrameExpressionWrite(
		source,
		target,
		index,
		issueTarget,
	);
	if (!capabilityResult.capability) return { issues: capabilityResult.issues };
	const parsed = parseBindableExpression(
		expressionSource,
		EFFECT_EXPR_VARS,
		index,
		issueTarget,
	);
	if (!parsed.expression) return { issues: parsed.issues };
	const { capability } = capabilityResult;
	const targetKey =
		targetRef.kind === "scene" ? "scene" : `artboard:${targetRef.artboardId}`;
	if (capability.source.kind === "recipe-control") {
		return {
			compiled: {
				command: createSetEffectExpressionBindingCommand({
					id: `${capability.id}@${targetKey}`,
					capabilityId: capability.id,
					recipePath: capability.source.recipePath,
					targetScope: bindableEffectTargetScope(target),
					targetRef,
					expr: parsed.expression,
				}),
				target: issueTarget,
			},
			issues: [],
		};
	}
	if (capability.source.kind !== "influence-control") {
		return {
			issues: [
				createAgentIssue(
					"agent.bindable-expression-effect-source-unsupported",
					"error",
					`Scene command ${index} cannot bind ${capability.source.kind} effect capability "${capability.id}" as a frame recipe or influence control.`,
					issueTarget,
				),
			],
		};
	}
	return {
		compiled: {
			command: createSetEffectExpressionBindingCommand({
				id: `${capability.id}@${targetKey}`,
				capabilityId: capability.id,
				influenceField: capability.source.field,
				targetScope: bindableEffectTargetScope(target),
				targetRef,
				expr: parsed.expression,
			}),
			target: issueTarget,
		},
		issues: [],
	};
};

const compileClearFrameEffectExpressionSceneCommand = (
	scene: SceneDocument,
	source: EffectBindablePropertySource,
	target: AgentBindableEffectTarget,
	index: number,
	commandPath: string,
): { compiled?: AgentCompiledSceneCommand; issues: readonly AgentIssue[] } => {
	const issueTarget = issueTargetForBindableEffectTarget(
		scene,
		target,
		commandPath,
	);
	const targetRef = effectExpressionTargetRefForBindableTarget(scene, target);
	if (!targetRef) {
		return {
			issues: [
				createAgentIssue(
					"agent.bindable-expression-effect-target-missing",
					"error",
					`Scene command ${index} targets missing artboard "${target.scope === "artboard" ? target.artboardId : ""}".`,
					issueTarget,
				),
			],
		};
	}
	const capabilityResult = effectCapabilityForFrameExpressionWrite(
		source,
		target,
		index,
		issueTarget,
	);
	if (!capabilityResult.capability) return { issues: capabilityResult.issues };
	return {
		compiled: {
			command: createClearEffectExpressionBindingCommand(
				capabilityResult.capability.id,
				targetRef,
			),
			target: issueTarget,
		},
		issues: [],
	};
};

const buildBindableSceneBatchState = (
	scene: SceneDocument,
	commands: readonly AgentSceneCommand[],
): BindableSceneBatchState => {
	const effectRecipesByNodeId = new Map<string, VisualRecipe | null>();
	const frameEffectRecipesByTargetKey = new Map<string, VisualRecipe | null>();
	const frameInfluenceRecipesByTargetKey = new Map<
		string,
		EffectInfluenceRecipe
	>();
	const effectFieldRecipesByTargetKey = new Map<
		string,
		EffectInfluenceRecipe
	>();
	const effectFieldCompilesByCommandIndex = new Map<
		number,
		EffectFieldCommandCompile
	>();
	const effectLayerStacksByTargetKey = new Map<
		string,
		EffectLayerStack | null
	>();
	const lookGraphsByTargetKey = new Map<string, LookGraph | null>();
	const lookGraphCompilesByCommandIndex = new Map<
		number,
		LookGraphCommandCompile
	>();
	const duplicateGeneratorsByNodeId = new Map<
		string,
		DuplicateGeneratorBinding
	>();

	for (const [index, command] of commands.entries()) {
		const commandPath = `commands.${index}`;
		if (command.type === "scene/patch-effect-field") {
			const issueTarget = issueTargetForBindableEffectTarget(
				scene,
				command.target,
				commandPath,
			);
			const targetKey = bindableEffectTargetKey(scene, command.target);
			const currentIntent = effectIntentForBindableTarget(
				scene,
				command.target,
			);
			if (!targetKey || currentIntent === null) {
				effectFieldCompilesByCommandIndex.set(index, {
					issues: [
						createAgentIssue(
							"agent.effect-field-target-missing",
							"error",
							`Scene command ${index} targets a missing Effect Field owner.`,
							issueTarget,
						),
					],
				});
				continue;
			}
			const current =
				effectFieldRecipesByTargetKey.get(targetKey) ??
				normalizeEffectInfluenceRecipe(
					influenceRecipeForBindableTarget(
						scene,
						command.target,
						currentIntent,
					) ?? undefined,
				);
			const compiled = compileAgentEffectFieldOperation({
				scene,
				current,
				operation: command.operation,
				index,
				target: issueTarget,
			});
			effectFieldCompilesByCommandIndex.set(index, compiled);
			if (compiled.recipe) {
				effectFieldRecipesByTargetKey.set(targetKey, compiled.recipe);
			}
			continue;
		}
		if (command.type === "scene/set-bindable-property") {
			const descriptor = bindablePropertyById(command.propertyId);
			if (!descriptor?.control.agentWritable) continue;
			const node = findNode(scene, command.nodeId);
			if (!node) continue;
			const source = descriptor.source;
			if (source.kind === "effect-capability") {
				const capabilityResult = effectCapabilityForNodeRecipeWrite(
					source,
					index,
					command.nodeId,
					commandPath,
				);
				if (!capabilityResult.capability) continue;
				const currentRecipe = effectRecipesByNodeId.has(command.nodeId)
					? (effectRecipesByNodeId.get(command.nodeId) ?? NEUTRAL_VISUAL_RECIPE)
					: node.recipe;
				const result = applyEffectBindableValue(
					currentRecipe,
					capabilityResult.capability,
					command.value,
					index,
					command.nodeId,
					commandPath,
				);
				if (result.recipe === undefined) continue;
				effectRecipesByNodeId.set(command.nodeId, result.recipe);
				continue;
			}
			if (source.kind === "duplicate-generator") {
				const currentGenerator =
					duplicateGeneratorsByNodeId.get(command.nodeId) ??
					duplicateGeneratorForNode(scene, command.nodeId) ??
					defaultDuplicateGeneratorForNode(command.nodeId);
				duplicateGeneratorsByNodeId.set(
					command.nodeId,
					setDuplicateGeneratorBindableChannel(
						currentGenerator,
						source,
						command.value,
					),
				);
			}
			continue;
		}
		if (command.type === "scene/set-bindable-expression") {
			const descriptor = bindablePropertyById(command.propertyId);
			if (!descriptor?.control.expressionBindable) continue;
			const node = findNode(scene, command.nodeId);
			if (!node) continue;
			const source = descriptor.source;
			if (source.kind !== "duplicate-generator") continue;
			const parsed = parseExpression(command.expression, DUPLICATE_EXPR_VARS);
			if (parsed.kind !== "ok") continue;
			const currentGenerator =
				duplicateGeneratorsByNodeId.get(command.nodeId) ??
				duplicateGeneratorForNode(scene, command.nodeId) ??
				defaultDuplicateGeneratorForNode(command.nodeId);
			duplicateGeneratorsByNodeId.set(
				command.nodeId,
				setDuplicateGeneratorExpressionChannel(
					currentGenerator,
					source,
					parsed.expr,
				),
			);
			continue;
		}
		if (command.type === "scene/clear-bindable-expression") {
			const descriptor = bindablePropertyById(command.propertyId);
			if (!descriptor?.control.expressionBindable) continue;
			const node = findNode(scene, command.nodeId);
			if (!node) continue;
			const source = descriptor.source;
			if (source.kind !== "duplicate-generator") continue;
			const currentGenerator =
				duplicateGeneratorsByNodeId.get(command.nodeId) ??
				duplicateGeneratorForNode(scene, command.nodeId);
			if (!currentGenerator) continue;
			if (
				source.channel !== "count" &&
				currentGenerator.instance[source.channel] === undefined
			) {
				continue;
			}
			duplicateGeneratorsByNodeId.set(
				command.nodeId,
				clearDuplicateGeneratorExpressionChannel(currentGenerator, source),
			);
			continue;
		}
		if (
			command.type === "scene/patch-effect-stack" ||
			command.type === "scene/set-effect-layer-property"
		) {
			const targetKey = bindableEffectTargetKey(scene, command.target);
			const owner = effectLayerOwnerForBindableTarget(scene, command.target);
			if (!targetKey || !owner) continue;
			const currentIntent = effectIntentForBindableTarget(
				scene,
				command.target,
			);
			if (currentIntent === null) continue;
			const currentStack = effectLayerStacksByTargetKey.has(targetKey)
				? (effectLayerStacksByTargetKey.get(targetKey) ?? undefined)
				: effectLayerStackForBindableTarget(
						scene,
						command.target,
						currentIntent,
					);
			if (command.type === "scene/patch-effect-stack") {
				effectLayerStacksByTargetKey.set(
					targetKey,
					applyEffectLayerStackOperation(
						currentStack,
						command.operation,
						owner,
					) ?? null,
				);
				continue;
			}
			const descriptor = bindablePropertyById(command.propertyId);
			if (
				!descriptor?.control.agentWritable ||
				descriptor.source.kind !== "effect-capability"
			) {
				continue;
			}
			const capability = effectCapabilityById(descriptor.source.capabilityId);
			if (!capability) {
				continue;
			}
			if (
				!capability.targetScopes.some(
					(scope) => scope === bindableEffectTargetScope(command.target),
				) ||
				capability.source.kind !== "recipe-control" ||
				capability.control.valueKind !== "number"
			) {
				continue;
			}
			const layer = currentStack?.layers.find(
				(candidate) => candidate.id === command.layerId,
			);
			if (!currentStack || !layer) continue;
			const result = updateRecipeControl(
				layer.visualRecipe,
				capability.source.recipePath,
				command.value,
			);
			if (result.kind === "invalid-path" || result.kind === "invalid-value") {
				continue;
			}
			effectLayerStacksByTargetKey.set(
				targetKey,
				applyEffectLayerStackOperation(
					currentStack,
					{
						kind: "update",
						layerId: command.layerId,
						patch: { visualRecipe: result.recipe },
					},
					owner,
				) ?? null,
			);
			continue;
		}
		if (command.type === "scene/patch-look-graph") {
			const issueTarget = issueTargetForLookGraphTarget(
				scene,
				command.target,
				commandPath,
			);
			const targetKey = lookGraphTargetKey(scene, command.target);
			const owner = lookGraphOwnerForTarget(scene, command.target);
			// `targetKey`/`owner` are null only when the artboard does not resolve. A
			// found-but-empty target (no Look yet) is a valid authoring base — the
			// common first-edit case — so an empty `currentIntent` is NOT fatal here.
			if (!targetKey || !owner) {
				lookGraphCompilesByCommandIndex.set(index, {
					issues: [
						createAgentIssue(
							"agent.look-graph-target-missing",
							"error",
							`Scene command ${index} targets a missing look-graph artboard.`,
							issueTarget,
						),
					],
				});
				continue;
			}
			// Pre-state: the graph after commands 0…N-1 for this target (this op not
			// yet applied), so a connect is validated before its own edge exists.
			const currentGraph = lookGraphsByTargetKey.has(targetKey)
				? (lookGraphsByTargetKey.get(targetKey) ?? undefined)
				: lookGraphForTarget(scene, command.target);
			const issues = validateLookGraphOperation(
				currentGraph,
				command.operation,
				index,
				issueTarget,
			);
			if (issues.length > 0) {
				// Reject without accumulating, so later same-target ops keep a clean base.
				lookGraphCompilesByCommandIndex.set(index, { issues });
				continue;
			}
			const nextGraph =
				applyLookGraphOperation(currentGraph, command.operation) ?? null;
			lookGraphsByTargetKey.set(targetKey, nextGraph);
			lookGraphCompilesByCommandIndex.set(index, {
				graph: nextGraph,
				issues: [],
			});
			continue;
		}
		if (command.type === "scene/set-bindable-effect-property") {
			const descriptor = bindablePropertyById(command.propertyId);
			if (!descriptor?.control.agentWritable) continue;
			const source = descriptor.source;
			if (source.kind !== "effect-capability") continue;
			const targetKey = bindableEffectTargetKey(scene, command.target);
			if (!targetKey) continue;
			const issueTarget = issueTargetForBindableEffectTarget(
				scene,
				command.target,
				commandPath,
			);
			const capabilityResult = effectCapabilityForFrameIntentWrite(
				source,
				command.target,
				index,
				issueTarget,
			);
			if (!capabilityResult.capability) continue;
			const currentIntent = effectIntentForBindableTarget(
				scene,
				command.target,
			);
			if (currentIntent === null) continue;
			if (capabilityResult.capability.source.kind === "influence-control") {
				const currentRecipe =
					frameInfluenceRecipesByTargetKey.get(targetKey) ??
					influenceRecipeForBindableTarget(
						scene,
						command.target,
						currentIntent,
					);
				const result = applyFrameInfluenceBindableValue(
					currentRecipe,
					capabilityResult.capability,
					command.value,
					index,
					issueTarget,
				);
				if (result.recipe === undefined) continue;
				frameInfluenceRecipesByTargetKey.set(targetKey, result.recipe);
				continue;
			}
			const currentRecipe = frameEffectRecipesByTargetKey.has(targetKey)
				? (frameEffectRecipesByTargetKey.get(targetKey) ??
					NEUTRAL_VISUAL_RECIPE)
				: currentIntent?.visualRecipe;
			const result = applyFrameEffectBindableValue(
				currentRecipe,
				capabilityResult.capability,
				command.value,
				index,
				issueTarget,
			);
			if (result.recipe === undefined) continue;
			frameEffectRecipesByTargetKey.set(targetKey, result.recipe);
		}
	}

	return {
		effectRecipesByNodeId,
		frameEffectRecipesByTargetKey,
		frameInfluenceRecipesByTargetKey,
		effectLayerStacksByTargetKey,
		lookGraphCompilesByCommandIndex,
		effectFieldCompilesByCommandIndex,
		duplicateGeneratorsByNodeId,
	};
};

/**
 * The own-node/own-layer visible+locked guard `createUpdateNodeTransformCommand`
 * and `createCenterNodeAnchorCommand` enforce before mutating — deliberately
 * NOT the ancestor-lock-folding policy `findRenderableNodeEntry`/
 * `removeDeletableDraftNodes` use for delete. Verified empirically: a node with
 * a locked ANCESTOR but an unlocked self/layer is still transformed by these
 * two commands (ancestor locks are not walked), so reusing the ancestor-fold
 * check here would report a false-positive "locked" warning. Returns the
 * specific reason the pending mutation would silently no-op, or `undefined`
 * when the command would succeed.
 */
const nodeTransformSkipReason = (
	scene: SceneDocument,
	nodeId: string,
): "hidden" | "locked" | undefined => {
	const node = findNode(scene, nodeId);
	const layer = findLayerByNodeId(scene, nodeId);
	if (!node || !layer?.visible || !node.visible) return "hidden";
	if (layer.locked || node.locked) return "locked";
	return undefined;
};

/**
 * Converts a `ComponentPropNameIssue` (from `validateComponentPropName`) into
 * a typed agent issue. `blank`/`invalid-identifier`/`reserved` all map to the
 * single `agent.component-prop-name-invalid` code — they are all "this string
 * is not a legal prop name", differentiated by message text rather than a
 * fourth code, matching the task's fixed 8-code inventory; `collision` gets
 * its own `agent.component-prop-name-collision` code since it is actionable
 * differently (pick another name vs. fix the string shape).
 */
const componentPropNameIssueToAgentIssue = (
	issue: ComponentPropNameIssue,
	index: number,
	target: AgentIssue["target"],
): AgentIssue => {
	switch (issue.kind) {
		case "blank":
			return createAgentIssue(
				"agent.component-prop-name-invalid",
				"error",
				`Scene command ${index} cannot use a blank component prop name.`,
				target,
			);
		case "invalid-identifier":
			return createAgentIssue(
				"agent.component-prop-name-invalid",
				"error",
				`Scene command ${index} component prop name must be a valid JS identifier (^[A-Za-z_$][A-Za-z0-9_$]*$).`,
				target,
			);
		case "reserved":
			return createAgentIssue(
				"agent.component-prop-name-invalid",
				"error",
				`Scene command ${index} cannot use reserved component prop name "${issue.name}".`,
				target,
			);
		case "collision":
			return createAgentIssue(
				"agent.component-prop-name-collision",
				"error",
				`Scene command ${index} cannot use component prop name "${issue.name}": a prop with that name already exists.`,
				target,
			);
	}
};

/**
 * Converts a `ComponentPropBindingIssue` (from `resolveComponentPropBindingIssue`)
 * into a typed agent issue: a missing target node maps to
 * `agent.component-prop-binding-node-missing`; a binding `kind` incompatible
 * with the prop's `type` maps to `agent.component-prop-type-binding-mismatch`;
 * a binding whose target already has a keyframe track maps to
 * `agent.component-prop-binding-animated-conflict` at WARNING severity (see
 * below); every other reason (unknown/non-numeric/non-eligible bindable
 * property, non-SOLID style-color paint, non-text text-content target) maps to
 * `agent.component-prop-binding-invalid` with the specific reason folded into
 * the message text, matching the task's fixed 8-code inventory (now +1 for
 * the animated-conflict code, which is orthogonal to binding validity and
 * actionable differently — same rationale `agent.component-prop-name-collision`
 * got its own code over folding into `-name-invalid`).
 *
 * The animated-conflict issue is a WARNING, not an error: the binding is
 * still authored (the caller must NOT treat this as blocking, see
 * `componentPropBindingIssues`) because the conflicting keyframe track may be
 * deleted later, at which point the binding becomes live with no further
 * action. `component-props-export.ts` is the enforcing gate — it always drops
 * a binding with this conflict from the compiled appliers, regardless of this
 * authoring-time warning having been surfaced or not.
 */
const componentPropBindingIssueToAgentIssue = (
	issue: ComponentPropBindingIssue,
	index: number,
	bindingIndex: number,
	target: AgentIssue["target"],
): AgentIssue => {
	if (issue.kind === "node-missing") {
		return createAgentIssue(
			"agent.component-prop-binding-node-missing",
			"error",
			`Scene command ${index} binding ${bindingIndex} targets missing node "${issue.nodeId}".`,
			target,
		);
	}
	if (issue.kind === "type-mismatch") {
		return createAgentIssue(
			"agent.component-prop-type-binding-mismatch",
			"error",
			`Scene command ${index} binding ${bindingIndex} kind "${issue.bindingKind}" is not valid for prop type "${issue.propType}".`,
			target,
		);
	}
	if (issue.kind === "binding-animated-conflict") {
		return createAgentIssue(
			"agent.component-prop-binding-animated-conflict",
			"warning",
			`Scene command ${index} binding ${bindingIndex} targets node "${issue.nodeId}" property "${issue.property}", which already has a keyframe track; the track's sampled value overrides this prop at runtime every frame, so the binding is authored but will have no effect until the track is removed. Export drops this binding and reports it separately.`,
			target,
		);
	}
	const reason = (() => {
		switch (issue.kind) {
			case "bindable-property-unknown":
				return `unknown bindable property "${issue.propertyId}"`;
			case "bindable-property-not-numeric":
				return `bindable property "${issue.propertyId}" is not numeric`;
			case "bindable-property-not-eligible":
				return `bindable property "${issue.propertyId}" is not eligible for node "${issue.nodeId}"`;
			case "style-color-not-solid":
				return `node "${issue.nodeId}" ${issue.role} paint is "${issue.paintKind}", not solid`;
			case "text-content-not-text-node":
				return `node "${issue.nodeId}" is not a text node`;
		}
	})();
	return createAgentIssue(
		"agent.component-prop-binding-invalid",
		"error",
		`Scene command ${index} binding ${bindingIndex} is invalid: ${reason}.`,
		target,
	);
};

/**
 * Pre-checks every binding in a component-prop add/update payload against
 * `resolveComponentPropBindingIssue`, using the live `scene` snapshot (not a
 * draft) since this runs before the command is compiled. Returns one typed
 * issue per invalid binding rather than stopping at the first, so an agent
 * batching several bindings in one payload sees every failure at once.
 *
 * `motion` is passed through to `resolveComponentPropBindingIssue` so a
 * binding whose target already has a keyframe track is flagged
 * (`agent.component-prop-binding-animated-conflict`, WARNING severity — see
 * `componentPropBindingIssueToAgentIssue`). Callers MUST filter this
 * function's result by `severity === "error"` before deciding whether to
 * block compilation: an animated-conflict warning does not invalidate the
 * binding, it is still authored (allow-with-warning; export is the enforcing
 * gate).
 */
const componentPropBindingIssues = (
	scene: SceneDocument,
	motion: MotionConflictView,
	propType: ComponentPropType,
	bindings: readonly ComponentPropBinding[],
	index: number,
	commandPath: string,
): readonly AgentIssue[] => {
	const issues: AgentIssue[] = [];
	for (const [bindingIndex, binding] of bindings.entries()) {
		const issue = resolveComponentPropBindingIssue(
			propType,
			binding,
			(nodeId) => findNode(scene, nodeId),
			motion,
		);
		if (issue) {
			issues.push(
				componentPropBindingIssueToAgentIssue(issue, index, bindingIndex, {
					kind: "node",
					id: binding.nodeId,
					path: commandPath,
				}),
			);
		}
	}
	return issues;
};

/**
 * Enforces the stricter Shared values V1 contract at the Agent boundary. Other
 * number props retain the generic allow-with-warning keyframe behavior, while
 * Rotation/Opacity require one homogeneous native address family, a valid
 * scalar, no competing writer, and equal target values when a binding set is
 * created without an explicit value change.
 */
const sharedNumberComponentPropIssue = (options: {
	readonly scene: SceneDocument;
	readonly motion: MotionConflictView;
	readonly grammarTargetNodeIds: ReadonlySet<string>;
	readonly propType: ComponentPropType;
	readonly bindings: readonly ComponentPropBinding[];
	readonly defaultValue: ComponentPropValue;
	readonly requestedRange?: {
		readonly min?: number;
		readonly max?: number;
		readonly step?: number;
	};
	readonly excludePropId?: string;
	readonly requireMatchingCurrentValue: boolean;
	readonly index: number;
	readonly propName: string;
	readonly target: AgentIssueTarget;
}): AgentIssue | null => {
	const sharedBindings = options.bindings.filter(
		(binding): binding is ComponentPropBindingBindable =>
			binding.kind === "bindable" &&
			isSharedNumberPropertyId(binding.propertyId),
	);
	if (sharedBindings.length === 0) return null;
	const propertyId = sharedBindings[0]?.propertyId;
	const value =
		options.defaultValue.type === "number"
			? options.defaultValue.value
			: Number.NaN;
	const descriptor = propertyId ? bindablePropertyById(propertyId) : null;
	const invalidShape =
		options.propType !== "number" ||
		sharedBindings.length !== options.bindings.length ||
		!propertyId ||
		!isSharedNumberPropertyId(propertyId) ||
		sharedBindings.some((binding) => binding.propertyId !== propertyId);
	const invalidValue =
		!Number.isFinite(value) ||
		(typeof descriptor?.control.min === "number" &&
			value < descriptor.control.min) ||
		(typeof descriptor?.control.max === "number" &&
			value > descriptor.control.max);
	const invalidRequestedRange =
		options.requestedRange !== undefined &&
		((options.requestedRange.min !== undefined &&
			options.requestedRange.min !== descriptor?.control.min) ||
			(options.requestedRange.max !== undefined &&
				options.requestedRange.max !== descriptor?.control.max) ||
			(options.requestedRange.step !== undefined &&
				options.requestedRange.step !== descriptor?.control.step));
	let reason = invalidShape
		? "all bindings must target only Rotation or only Opacity"
		: invalidValue
			? `default ${value} is outside the native property range`
			: invalidRequestedRange
				? "requested min/max/step metadata does not match the native property contract"
				: null;
	if (!reason && propertyId && isSharedNumberPropertyId(propertyId)) {
		for (const binding of sharedBindings) {
			const conflicts = componentPropSharedNumberOwnershipConflicts(
				{
					componentProps: options.scene.componentProps,
					layers: options.scene.layers,
					nativeExpressionBindings: options.scene.nativeExpressionBindings,
					grammarTargetNodeIds: options.grammarTargetNodeIds,
				},
				binding,
				options.excludePropId,
			);
			if (conflicts.length > 0) {
				reason = `target ${binding.nodeId}:${binding.propertyId} has competing owner(s): ${conflicts.join(", ")}`;
				break;
			}
			const animated = componentPropBindingAnimatedConflict(
				binding,
				options.motion,
			);
			if (animated) {
				reason = `target ${binding.nodeId}:${binding.propertyId} has keyframe track "${animated}"`;
				break;
			}
			if (!options.requireMatchingCurrentValue) continue;
			const node = findNode(options.scene, binding.nodeId);
			const actual = node ? sharedNumberBindingValue(node, binding) : null;
			if (actual === null || actual !== value) {
				reason = `target ${binding.nodeId}:${binding.propertyId} is ${actual ?? "unavailable"}, not ${value}`;
				break;
			}
		}
	}
	return reason
		? createAgentIssue(
				"agent.component-prop-number-owner-invalid",
				"error",
				`Scene command ${options.index} cannot author shared number prop "${options.propName}": ${reason}.`,
				options.target,
			)
		: null;
};

const sharedNumberOrdinaryEditIssues = (options: {
	readonly scene: SceneDocument;
	readonly motion: MotionConflictView;
	readonly grammarTargetNodeIds: ReadonlySet<string>;
	readonly nodeId: string;
	readonly propertyId: "transform.rotation" | "style.opacity";
	readonly index: number;
	readonly target: AgentIssueTarget;
}): readonly AgentIssue[] =>
	readComponentProps(options.scene)
		.filter(
			(prop) =>
				prop.type === "number" &&
				prop.bindings.some(
					(binding) =>
						binding.kind === "bindable" &&
						binding.nodeId === options.nodeId &&
						binding.propertyId === options.propertyId,
				),
		)
		.flatMap((prop) => {
			const issue = sharedNumberComponentPropIssue({
				scene: options.scene,
				motion: options.motion,
				grammarTargetNodeIds: options.grammarTargetNodeIds,
				propType: prop.type,
				bindings: prop.bindings,
				defaultValue: prop.defaultValue,
				excludePropId: prop.id,
				requireMatchingCurrentValue: false,
				index: options.index,
				propName: prop.name,
				target: options.target,
			});
			return issue ? [issue] : [];
		});

const componentOverrideSharedDriverConflict = (
	scene: SceneDocument,
	override: ComponentNodeOverride,
): "shared-color" | "shared-number" | null => {
	for (const prop of readComponentProps(scene)) {
		for (const binding of prop.bindings) {
			if (binding.nodeId !== override.instanceNodeId) continue;
			if (
				prop.type === "color" &&
				binding.kind === "style-color" &&
				override.kind === "style" &&
				(binding.role === "fill"
					? override.style.fill !== undefined ||
						override.style.fills !== undefined
					: override.style.stroke !== undefined ||
						override.style.strokes !== undefined)
			) {
				return "shared-color";
			}
			if (
				prop.type === "number" &&
				binding.kind === "bindable" &&
				((binding.propertyId === "style.opacity" &&
					override.kind === "style" &&
					override.style.opacity !== undefined) ||
					(binding.propertyId === "transform.rotation" &&
						override.kind === "transform" &&
						override.transform.rotation !== undefined))
			) {
				return "shared-number";
			}
		}
	}
	return null;
};

/**
 * Converts an `InteractionTriggerIssue` (from `validateInteractionTrigger`)
 * into a typed agent issue. All three are ERROR-severity: a missing
 * `trigger.nodeId`, an out-of-range `threshold`, and an invalid
 * `scroll-progress` action shape are all checkable with certainty against
 * current document state — unlike a `clipId`/`propName` reference, none of
 * these become valid by waiting (see {@link InteractionDefinition}'s doc
 * comment for the allow-with-warning reference kinds, converted by
 * `interactionActionIssueToAgentIssue` below).
 */
const interactionTriggerIssueToAgentIssue = (
	issue: InteractionTriggerIssue,
	index: number,
	target: AgentIssue["target"],
): AgentIssue => {
	if (issue.kind === "node-missing") {
		return createAgentIssue(
			"agent.interaction-node-missing",
			"error",
			`Scene command ${index} interaction trigger targets missing node "${issue.nodeId}".`,
			target,
		);
	}
	if (issue.kind === "threshold-out-of-range") {
		return createAgentIssue(
			"agent.interaction-trigger-invalid",
			"error",
			`Scene command ${index} interaction trigger threshold ${issue.threshold} must be finite and within 0..1.`,
			target,
		);
	}
	return createAgentIssue(
		"agent.interaction-trigger-invalid",
		"error",
		`Scene command ${index} interaction has a "scroll-progress" trigger but its actions is not exactly one {kind:"seek", progress} or {kind:"play-clip"} entry.`,
		target,
	);
};

/**
 * Converts one `InteractionActionIssue` (from `validateInteractionAction`/
 * `validateInteractionActionsNotEmpty`) into a typed agent issue.
 * `clip-missing`/`prop-missing` are WARNING severity (allow-with-warning: the
 * clip/prop may be authored later in the same editing session — see
 * {@link InteractionDefinition}'s doc comment, mirroring
 * `agent.component-prop-binding-animated-conflict`'s precedent); every other
 * reason is a hard ERROR since it is checkable with certainty against current
 * document state.
 */
const interactionActionIssueToAgentIssue = (
	issue: InteractionActionIssue,
	index: number,
	actionIndex: number,
	target: AgentIssue["target"],
): AgentIssue => {
	if (issue.kind === "empty-actions") {
		return createAgentIssue(
			"agent.interaction-actions-empty",
			"error",
			`Scene command ${index} interaction must have at least one action.`,
			target,
		);
	}
	if (issue.kind === "clip-missing") {
		return createAgentIssue(
			"agent.interaction-clip-missing",
			"warning",
			`Scene command ${index} action ${actionIndex} targets clip "${issue.clipId}", which does not currently exist in the motion document; the interaction is authored but will have no effect until the clip is created.`,
			target,
		);
	}
	if (issue.kind === "prop-missing") {
		return createAgentIssue(
			"agent.interaction-prop-missing",
			"warning",
			`Scene command ${index} action ${actionIndex} targets component prop "${issue.propName}", which does not currently exist in the document; the interaction is authored but will have no effect until the prop is created.`,
			target,
		);
	}
	if (issue.kind === "prop-value-type-mismatch") {
		return createAgentIssue(
			"agent.interaction-prop-value-type-mismatch",
			"error",
			`Scene command ${index} action ${actionIndex} sets component prop "${issue.propName}" (type "${issue.propType}") with a "${issue.valueType}" value.`,
			target,
		);
	}
	const reason = (() => {
		switch (issue.kind) {
			case "seek-fields-invalid":
				return "must set exactly one of frame or progress";
			case "seek-frame-invalid":
				return `frame ${issue.frame} must be finite and >= 0`;
			case "seek-progress-invalid":
				return `progress ${issue.progress} must be finite and within 0..1`;
		}
	})();
	return createAgentIssue(
		"agent.interaction-action-invalid",
		"error",
		`Scene command ${index} action ${actionIndex} is invalid: ${reason}.`,
		target,
	);
};

/**
 * Runs every `interactions.ts` validation rule (trigger, non-empty actions,
 * per-action shape/reference) for one add/update payload and converts each
 * violation to a typed agent issue, mirroring `componentPropBindingIssues`'
 * "collect all, let the caller filter by severity" shape. `scene`/
 * `componentProps`/`motion` are the live (not draft) document views, since
 * this runs before the command is compiled — matching
 * `componentPropBindingIssues`' own live-snapshot contract.
 */
const interactionIssues = (
	scene: SceneDocument,
	motion: InteractionMotionView,
	trigger: InteractionTrigger,
	actions: readonly InteractionAction[],
	index: number,
	commandPath: string,
): readonly AgentIssue[] => {
	const target = { kind: "document", id: scene.id, path: commandPath } as const;
	const issues: AgentIssue[] = [];

	const triggerIssue = validateInteractionTrigger(trigger, actions, (nodeId) =>
		findNode(scene, nodeId),
	);
	if (triggerIssue) {
		issues.push(
			interactionTriggerIssueToAgentIssue(triggerIssue, index, target),
		);
	}

	const emptyIssue = validateInteractionActionsNotEmpty(actions);
	if (emptyIssue) {
		issues.push(
			interactionActionIssueToAgentIssue(emptyIssue, index, 0, target),
		);
		return issues;
	}

	const componentProps = readComponentProps(scene);
	for (const [actionIndex, action] of actions.entries()) {
		for (const actionIssue of validateInteractionAction(
			action,
			componentProps,
			motion,
		)) {
			issues.push(
				interactionActionIssueToAgentIssue(
					actionIssue,
					index,
					actionIndex,
					target,
				),
			);
		}
	}
	return issues;
};

/**
 * Looks up a scene node by id for a `compileAgentSceneCommand` case branch and
 * reports the shared `agent.scene-command-missing-node` issue when it is
 * absent. Callers early-return `{ issues: found.issues }` on a miss so the
 * message/code/target stay byte-identical across every case that guards on a
 * single required node id.
 */
const requireSceneNode = (
	scene: SceneDocument,
	nodeId: string,
	index: number,
	target: AgentIssueTarget,
):
	| { readonly node: VectorNode; readonly issues?: undefined }
	| { readonly node?: undefined; readonly issues: readonly AgentIssue[] } => {
	const node = findNode(scene, nodeId);
	if (node) return { node };
	return {
		issues: [
			createAgentIssue(
				"agent.scene-command-missing-node",
				"error",
				`Scene command ${index} targets missing node "${nodeId}".`,
				target,
			),
		],
	};
};

/**
 * Builds the shared missing-node issue list for commands that accept node-id
 * arrays. Duplicates are intentionally preserved to match the submitted payload.
 */
const missingSceneNodeIssues = (
	scene: SceneDocument,
	nodeIds: readonly string[],
	index: number,
	path: string,
): readonly AgentIssue[] =>
	nodeIds.flatMap((nodeId) =>
		findNode(scene, nodeId)
			? []
			: [
					createAgentIssue(
						"agent.scene-command-missing-node",
						"error",
						`Scene command ${index} targets missing node "${nodeId}".`,
						{ kind: "node", id: nodeId, path },
					),
				],
	);

const arrangementSnapshotNodeIssues = (
	scene: SceneDocument,
	artboardId: string,
	nodeIds: readonly string[],
	index: number,
	path: string,
): readonly AgentIssue[] => {
	const issues: AgentIssue[] = [];
	if (nodeIds.length === 0) {
		issues.push(
			createAgentIssue(
				"agent.arrangement-snapshot-empty-members",
				"error",
				`Scene command ${index} requires at least one Arrangement snapshot member node.`,
				{ kind: "artboard", id: artboardId, path },
			),
		);
	}
	if (new Set(nodeIds).size !== nodeIds.length) {
		issues.push(
			createAgentIssue(
				"agent.arrangement-snapshot-duplicate-members",
				"error",
				`Scene command ${index} cannot capture duplicate Arrangement snapshot member ids.`,
				{ kind: "artboard", id: artboardId, path },
			),
		);
	}
	for (const nodeId of nodeIds) {
		const target = { kind: "node", id: nodeId, path } as const;
		const node = findNode(scene, nodeId);
		if (!node) {
			issues.push(
				createAgentIssue(
					"agent.scene-command-missing-node",
					"error",
					`Scene command ${index} targets missing node "${nodeId}".`,
					target,
				),
			);
			continue;
		}
		if (!isTopLevelSceneNode(scene, nodeId)) {
			issues.push(
				createAgentIssue(
					"agent.arrangement-snapshot-member-not-top-level",
					"error",
					`Scene command ${index} can capture only top-level Arrangement member nodes; "${nodeId}" is nested.`,
					target,
				),
			);
		}
		if (selectArtboardIdForNode(scene, nodeId) !== artboardId) {
			issues.push(
				createAgentIssue(
					"agent.arrangement-snapshot-member-artboard-mismatch",
					"error",
					`Scene command ${index} requires all Arrangement snapshot members to belong to artboard "${artboardId}".`,
					target,
				),
			);
		}
	}
	return issues;
};

const requireArtboard = (
	scene: SceneDocument,
	artboardId: string,
	index: number,
	target: AgentIssueTarget,
):
	| { readonly artboard: Artboard; readonly issues?: undefined }
	| {
			readonly artboard?: undefined;
			readonly issues: readonly AgentIssue[];
	  } => {
	const artboard = findArtboardById(scene, artboardId);
	if (artboard) return { artboard };
	return {
		issues: [
			createAgentIssue(
				"agent.scene-command-missing-artboard",
				"error",
				`Scene command ${index} targets missing artboard "${artboardId}".`,
				target,
			),
		],
	};
};

const findSceneCameraRig = (
	scene: SceneDocument,
	cameraRigId: string,
): SceneCameraRigContract | undefined =>
	scene.sceneCameras?.find((rig) => rig.id === cameraRigId);

const requireSceneCameraRig = (
	scene: SceneDocument,
	cameraRigId: string,
	index: number,
	target: AgentIssueTarget,
):
	| { readonly rig: SceneCameraRigContract; readonly issues?: undefined }
	| { readonly rig?: undefined; readonly issues: readonly AgentIssue[] } => {
	const rig = findSceneCameraRig(scene, cameraRigId);
	if (rig) return { rig };
	return {
		issues: [
			createAgentIssue(
				"agent.scene-command-missing-camera-rig",
				"error",
				`Scene command ${index} targets missing scene camera "${cameraRigId}".`,
				target,
			),
		],
	};
};

const cameraRigScopesArtboard = (
	rig: Pick<SceneCameraRigContract, "scope">,
	artboardId: string,
): boolean =>
	rig.scope.kind === "scene" ||
	(rig.scope.kind === "artboard" && rig.scope.artboardId === artboardId);

const externalAssetCapabilitiesFromAgent = (
	capabilities: readonly string[] | undefined,
): {
	readonly capabilities?: readonly ExternalSceneAssetCapability[];
	readonly issues: readonly AgentIssue[];
} => {
	if (!capabilities) return { issues: [] };
	const accepted = new Set<ExternalSceneAssetCapability>();
	for (const capability of capabilities) {
		const normalized = capability.trim();
		if (normalized.length > 0) {
			accepted.add(normalized as ExternalSceneAssetCapability);
		}
	}
	const normalizedCapabilities = [...accepted];
	return {
		...(normalizedCapabilities.length > 0
			? { capabilities: normalizedCapabilities }
			: {}),
		issues: [],
	};
};

const sourceHref = (source: SceneMediaSource): string =>
	source.kind === "data-url" ? source.dataUrl : source.href;

const sceneDepthPlaneFromAgent = (
	depthPlane: NonNullable<
		Extract<
			AgentSceneCommand,
			{ readonly type: "scene/set-node-depth-plane" }
		>["depthPlane"]
	>,
): SceneDepthPlaneContract => ({
	kind: "depth-plane",
	version: 1,
	z: depthPlane.z,
	...(depthPlane.billboarding ? { billboarding: depthPlane.billboarding } : {}),
	...(depthPlane.cameraRigId ? { cameraRigId: depthPlane.cameraRigId } : {}),
});

/**
 * Resolves `AgentNodeStylePatch`'s `strokeWidthProfile`/`strokeWidthProfilePreset`
 * sugar pair into the plain `NodeStylePatch.strokeWidthProfile` the scene command
 * bus understands, since a preset id is agent-only convenience with no `NodeStyle`
 * field of its own.
 *
 * Precedence when both are present: the preset wins and the raw `stops` are
 * discarded (not applied), reported as a WARNING
 * (`agent.stroke-width-profile-preset-conflict`) rather than blocking the write —
 * the agent's intent (a named taper) is still honored. The discarded stops are
 * still run through {@link validateStrokeWidthProfile} so any contract
 * violations are surfaced in that same warning's message, without ever
 * escalating to an ERROR or blocking the write.
 *
 * Raw `stops` (no preset) are validated against
 * {@link validateStrokeWidthProfile}; a violation is an ERROR
 * (`agent.stroke-width-profile-invalid`) and the whole command is not applied
 * (`resolved: undefined`), matching how other malformed-payload cases in this
 * switch refuse to compile rather than silently dropping just the bad field.
 */
const resolveAgentStrokeWidthProfilePatch = (
	patch: AgentNodeStylePatch,
	index: number,
	target: AgentIssueTarget,
):
	| {
			readonly resolved: NodeStylePatch;
			readonly issues: readonly AgentIssue[];
	  }
	| {
			readonly resolved?: undefined;
			readonly issues: readonly AgentIssue[];
	  } => {
	const { strokeWidthProfile, strokeWidthProfilePreset, ...rest } = patch;
	if (strokeWidthProfilePreset !== undefined) {
		const issues: AgentIssue[] = [];
		if (strokeWidthProfile !== undefined) {
			const discardedViolations =
				strokeWidthProfile !== null
					? validateStrokeWidthProfile(strokeWidthProfile)
					: null;
			const conflictMessage = `Scene command ${index} set both strokeWidthProfile and strokeWidthProfilePreset; the preset "${strokeWidthProfilePreset}" was applied and the raw stops were ignored.`;
			issues.push(
				createAgentIssue(
					"agent.stroke-width-profile-preset-conflict",
					"warning",
					discardedViolations !== null
						? `${conflictMessage} The discarded stops were also invalid: ${discardedViolations.join("; ")}.`
						: conflictMessage,
					target,
				),
			);
		}
		const preset =
			strokeWidthProfilePreset === "none"
				? null
				: STROKE_WIDTH_PROFILE_PRESETS[strokeWidthProfilePreset];
		return { resolved: { ...rest, strokeWidthProfile: preset }, issues };
	}
	if (strokeWidthProfile === undefined) {
		return { resolved: rest, issues: [] };
	}
	if (strokeWidthProfile === null) {
		return { resolved: { ...rest, strokeWidthProfile: null }, issues: [] };
	}
	const violations = validateStrokeWidthProfile(strokeWidthProfile);
	if (violations !== null) {
		return {
			issues: [
				createAgentIssue(
					"agent.stroke-width-profile-invalid",
					"error",
					`Scene command ${index} strokeWidthProfile is invalid: ${violations.join("; ")}.`,
					target,
				),
			],
		};
	}
	return { resolved: { ...rest, strokeWidthProfile }, issues: [] };
};

/**
 * Normalizes the shared style surface used by newly created agent nodes. A null
 * width profile is meaningful for an update but is a no-op for a new node, so it
 * is removed before the patch reaches `createNode` or a generated child helper.
 */
const resolveAgentNewNodeStyle = (
	patch: AgentNodeStylePatch | undefined,
	index: number,
	target: AgentIssueTarget,
):
	| {
			readonly style?: Partial<NodeStyle>;
			readonly issues: readonly AgentIssue[];
	  }
	| {
			readonly invalid: true;
			readonly issues: readonly AgentIssue[];
	  } => {
	if (patch === undefined) return { style: undefined, issues: [] };
	const profilePatch = resolveAgentStrokeWidthProfilePatch(
		patch,
		index,
		target,
	);
	if (profilePatch.resolved === undefined) {
		return { invalid: true, issues: profilePatch.issues };
	}
	const { strokeWidthProfile, ...restStyle } = profilePatch.resolved;
	return {
		style: strokeWidthProfile
			? { ...restStyle, strokeWidthProfile }
			: restStyle,
		issues: profilePatch.issues,
	};
};

const compileAgentSceneCommand = (
	scene: SceneDocument,
	motion: MotionDocument,
	command: AgentSceneCommand,
	index: number,
	batchState?: BindableSceneBatchState,
	grammarTargetNodeIds: ReadonlySet<string> = new Set(),
): { compiled?: AgentCompiledSceneCommand; issues: readonly AgentIssue[] } => {
	const commandPath = `commands.${index}`;
	switch (command.type) {
		case "scene/rename-document": {
			const name = command.name.trim();
			const target = {
				kind: "document",
				id: scene.id,
				path: commandPath,
			} as const;
			if (!name) {
				return {
					issues: [
						createAgentIssue(
							"agent.document-name-empty",
							"error",
							"Document name must contain at least one non-whitespace character.",
							target,
						),
					],
				};
			}
			return {
				compiled: { command: createRenameDocumentCommand(name), target },
				issues:
					scene.name === name
						? [
								createAgentIssue(
									"agent.document-name-unchanged",
									"warning",
									"Document already has the requested name.",
									target,
								),
							]
						: [],
			};
		}
		case "scene/reorder-artboard": {
			const artboards = selectAllArtboards(scene);
			const target = {
				kind: "artboard",
				id: command.artboardId,
				path: commandPath,
			} as const;
			if (!findArtboardById(scene, command.artboardId)) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-artboard",
							"error",
							`Scene command ${index} targets missing artboard "${command.artboardId}".`,
							target,
						),
					],
				};
			}
			if (
				command.artboardId === scene.artboard.id ||
				!Number.isInteger(command.toIndex) ||
				command.toIndex < 1 ||
				command.toIndex >= artboards.length
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-invalid-index",
							"error",
							`Scene command ${index} must reorder a non-default artboard to an index from 1 through ${Math.max(1, artboards.length - 1)}.`,
							target,
						),
					],
				};
			}
			return {
				compiled: {
					command: createReorderArtboardCommand(
						command.artboardId,
						command.toIndex,
					),
					target,
				},
				issues: [],
			};
		}
		case "scene/initialize-sequence":
			return {
				compiled: {
					command: createInitializeSceneSequenceCommand({ name: command.name }),
					target: { kind: "document", id: scene.id, path: commandPath },
				},
				issues: [],
			};
		case "scene/update-sequence":
			if (!scene.sequence) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-sequence",
							"error",
							"Create the scene sequence before updating it.",
							{ kind: "document", id: scene.id, path: commandPath },
						),
					],
				};
			}
			return {
				compiled: {
					command: createUpdateSceneSequenceCommand(command.patch),
					target: { kind: "document", id: scene.id, path: commandPath },
				},
				issues: [],
			};
		case "scene/update-sequence-item":
		case "scene/reorder-sequence-item":
		case "scene/remove-sequence-item": {
			const item = scene.sequence?.items.find(
				(candidate) => candidate.id === command.itemId,
			);
			const target = {
				kind: "document",
				id: command.itemId,
				path: commandPath,
			} as const;
			if (!item) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-sequence-item",
							"error",
							`Scene command ${index} targets missing sequence item "${command.itemId}".`,
							target,
						),
					],
				};
			}
			if (
				command.type === "scene/reorder-sequence-item" &&
				(!Number.isInteger(command.toIndex) ||
					command.toIndex < 0 ||
					command.toIndex >= (scene.sequence?.items.length ?? 0))
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-invalid-index",
							"error",
							`Scene command ${index} has invalid sequence index ${command.toIndex}.`,
							target,
						),
					],
				};
			}
			const entityCommand =
				command.type === "scene/update-sequence-item"
					? createUpdateSceneSequenceItemCommand(command.itemId, command.patch)
					: command.type === "scene/reorder-sequence-item"
						? createMoveSceneSequenceItemCommand(
								command.itemId,
								command.toIndex,
							)
						: createRemoveSceneSequenceItemCommand(command.itemId);
			return { compiled: { command: entityCommand, target }, issues: [] };
		}
		case "scene/remove-sequence":
			return {
				compiled: {
					command: createRemoveSceneSequenceCommand(),
					target: { kind: "document", id: scene.id, path: commandPath },
				},
				issues: scene.sequence
					? []
					: [
							createAgentIssue(
								"agent.scene-command-missing-sequence",
								"warning",
								"Document has no scene sequence to remove.",
								{ kind: "document", id: scene.id, path: commandPath },
							),
						],
			};
		case "scene/add-layer": {
			const spec = command.layer ?? {};
			const target = {
				kind: "layer",
				id: spec.id,
				path: commandPath,
			} as const;
			if (spec.id && scene.layers.some((layer) => layer.id === spec.id)) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-duplicate-layer",
							"error",
							`Layer id "${spec.id}" already exists.`,
							target,
						),
					],
				};
			}
			return {
				compiled: { command: createAddLayerCommand(spec), target },
				issues: [],
			};
		}
		case "scene/update-layer":
		case "scene/remove-layer": {
			const target = {
				kind: "layer",
				id: command.layerId,
				path: commandPath,
			} as const;
			if (!scene.layers.some((layer) => layer.id === command.layerId)) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-layer",
							"error",
							`Scene command ${index} targets missing layer "${command.layerId}".`,
							target,
						),
					],
				};
			}
			if (command.type === "scene/remove-layer") {
				if (scene.layers.length <= 1) {
					return {
						issues: [
							createAgentIssue(
								"agent.scene-command-final-layer",
								"error",
								"The document's final layer cannot be removed.",
								target,
							),
						],
					};
				}
				if (
					command.fallbackLayerId &&
					(command.fallbackLayerId === command.layerId ||
						!scene.layers.some((layer) => layer.id === command.fallbackLayerId))
				) {
					return {
						issues: [
							createAgentIssue(
								"agent.scene-command-invalid-fallback-layer",
								"error",
								"Fallback layer must identify another existing layer.",
								target,
							),
						],
					};
				}
				return {
					compiled: {
						command: createRemoveLayerCommand(
							command.layerId,
							command.fallbackLayerId,
						),
						target,
					},
					issues: [],
				};
			}
			return {
				compiled: {
					command: createUpdateLayerCommand(command.layerId, command.patch),
					target,
				},
				issues: [],
			};
		}
		case "scene/rename-node":
		case "scene/set-node-visibility":
		case "scene/set-node-locked": {
			const target = {
				kind: "node",
				id: command.nodeId,
				path: commandPath,
			} as const;
			const nodeLookup = requireSceneNode(scene, command.nodeId, index, target);
			if (!nodeLookup.node) return { issues: nodeLookup.issues };
			if (command.type === "scene/rename-node" && !command.name.trim()) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-empty-node-name",
							"error",
							"Node name must not be empty.",
							target,
						),
					],
				};
			}
			const entityCommand =
				command.type === "scene/rename-node"
					? createRenameNodeCommand(command.nodeId, command.name)
					: command.type === "scene/set-node-visibility"
						? createSetNodeVisibilityCommand(command.nodeId, command.visible)
						: createSetNodeLockedCommand(command.nodeId, command.locked);
			return { compiled: { command: entityCommand, target }, issues: [] };
		}
		case "scene/update-node-geometry": {
			const target = {
				kind: "node",
				id: command.nodeId,
				path: commandPath,
			} as const;
			const nodeLookup = requireSceneNode(scene, command.nodeId, index, target);
			if (!nodeLookup.node) return { issues: nodeLookup.issues };
			if (nodeLookup.node.geometry.kind !== command.geometry.kind) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-geometry-kind-change",
							"error",
							`Geometry replacement must preserve kind "${nodeLookup.node.geometry.kind}"; received "${command.geometry.kind}".`,
							target,
						),
					],
				};
			}
			if (!isAuthorableNodeGeometry(command.geometry)) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-invalid-geometry",
							"error",
							`Scene command ${index} contains invalid ${command.geometry.kind} geometry.`,
							target,
						),
					],
				};
			}
			if (command.geometry.kind === "image") {
				const assetId = command.geometry.assetId;
				if (!(scene.assets ?? []).some((asset) => asset.id === assetId)) {
					return {
						issues: [
							createAgentIssue(
								"agent.scene-command-missing-asset",
								"error",
								`Image geometry references missing asset "${assetId}".`,
								target,
							),
						],
					};
				}
			}
			return {
				compiled: {
					command: createUpdateNodeGeometryCommand(
						command.nodeId,
						buildAppendGeometry(command.geometry),
					),
					target,
				},
				issues: [],
			};
		}
		case "scene/create-blend": {
			const planned = buildCreateBlendCommand(scene, command.sourceNodeIds, {
				...(command.spacing ? { spacing: command.spacing } : {}),
				...(command.orientation ? { orientation: command.orientation } : {}),
			});
			const issues = planned.issues.map((issue) =>
				createAgentIssue(issue.code, issue.severity, issue.message, {
					kind: issue.nodeId ? "node" : "selection",
					...(issue.nodeId ? { id: issue.nodeId } : {}),
					path: commandPath,
				}),
			);
			if (!planned.ok) return { issues };
			return {
				compiled: {
					command: planned.command,
					target: {
						kind: "node",
						id: planned.blendNodeId,
						path: commandPath,
					},
				},
				issues,
			};
		}
		case "scene/update-blend":
		case "scene/remove-blend": {
			const target = {
				kind: "node",
				id: command.blendNodeId,
				path: commandPath,
			} as const;
			const nodeLookup = requireSceneNode(
				scene,
				command.blendNodeId,
				index,
				target,
			);
			if (!nodeLookup.node) return { issues: nodeLookup.issues };
			if (!nodeLookup.node.blend) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-non-blend-node",
							"error",
							`Node "${command.blendNodeId}" is not a Blend container.`,
							target,
						),
					],
				};
			}
			return {
				compiled: {
					command:
						command.type === "scene/update-blend"
							? createUpdateBlendCommand(command.blendNodeId, command.patch)
							: createReleaseBlendCommand(command.blendNodeId),
					target,
				},
				issues: [],
			};
		}
		case "scene/update-node-transform": {
			const target = {
				kind: "node",
				id: command.nodeId,
				path: commandPath,
			} as const;
			const nodeLookup = requireSceneNode(scene, command.nodeId, index, target);
			if (!nodeLookup.node) return { issues: nodeLookup.issues };
			// createUpdateNodeTransformCommand silently no-ops when the node or its
			// own layer is hidden/locked — a single-target command, so a skip here
			// means the whole compiled command does nothing, not a partial success.
			const skipReason = nodeTransformSkipReason(scene, command.nodeId);
			const ownerIssues =
				!skipReason && command.patch.transform?.rotation !== undefined
					? sharedNumberOrdinaryEditIssues({
							scene,
							motion,
							grammarTargetNodeIds,
							nodeId: command.nodeId,
							propertyId: "transform.rotation",
							index,
							target,
						})
					: [];
			if (ownerIssues.length > 0) return { issues: ownerIssues };
			return {
				compiled: {
					command: createUpdateNodeTransformCommand(
						command.nodeId,
						command.patch,
						{ grammarTargetNodeIds, motion },
					),
					target,
				},
				issues: skipReason
					? [
							createAgentIssue(
								skipReason === "hidden"
									? "agent.scene-command-node-hidden"
									: "agent.scene-command-node-locked",
								"warning",
								`Scene command ${index} will not change node "${command.nodeId}": it (or its layer) is ${skipReason}.`,
								target,
							),
						]
					: [],
			};
		}
		case "scene/center-node-anchor": {
			const nodeLookup = requireSceneNode(scene, command.nodeId, index, {
				kind: "node",
				id: command.nodeId,
				path: commandPath,
			});
			if (!nodeLookup.node) return { issues: nodeLookup.issues };
			// Same own-node/own-layer guard as scene/update-node-transform (both
			// factories share the identical hidden/locked check).
			const skipReason = nodeTransformSkipReason(scene, command.nodeId);
			return {
				compiled: {
					command: createCenterNodeAnchorCommand(command.nodeId),
					target: { kind: "node", id: command.nodeId, path: commandPath },
				},
				issues: skipReason
					? [
							createAgentIssue(
								skipReason === "hidden"
									? "agent.scene-command-node-hidden"
									: "agent.scene-command-node-locked",
								"warning",
								`Scene command ${index} will not change node "${command.nodeId}": it (or its layer) is ${skipReason}.`,
								{ kind: "node", id: command.nodeId, path: commandPath },
							),
						]
					: [],
			};
		}
		case "scene/mark-text-fragments": {
			const groupLookup = requireSceneNode(scene, command.groupId, index, {
				kind: "node",
				id: command.groupId,
				path: commandPath,
			});
			if (!groupLookup.node) return { issues: groupLookup.issues };
			const group = groupLookup.node;
			if (!group.children || group.children.length === 0) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-invalid-target",
							"error",
							`Scene command ${index} cannot mark text fragments: node "${command.groupId}" has no children to order.`,
							{ kind: "node", id: command.groupId, path: commandPath },
						),
					],
				};
			}
			return {
				compiled: {
					command: markGroupAsTextFragments(
						command.groupId,
						command.unit ?? "character",
					),
					target: { kind: "node", id: command.groupId, path: commandPath },
				},
				issues: [],
			};
		}
		case "scene/set-duplicate-generator": {
			const target = {
				kind: "node",
				id: command.generator.sourceNodeId,
				path: commandPath,
			} as const;
			const nodeLookup = requireSceneNode(
				scene,
				command.generator.sourceNodeId,
				index,
				target,
			);
			if (!nodeLookup.node) return { issues: nodeLookup.issues };
			const count = parseBindableExpression(
				command.generator.count,
				DUPLICATE_EXPR_VARS,
				index,
				{ ...target, path: `${commandPath}.generator.count` },
			);
			const parsedChannels = (["x", "y", "rotation"] as const).map(
				(channel) => {
					const source = command.generator.instance?.[channel];
					return {
						channel,
						...(source === undefined
							? { expression: undefined, issues: [] as readonly AgentIssue[] }
							: parseBindableExpression(source, DUPLICATE_EXPR_VARS, index, {
									...target,
									path: `${commandPath}.generator.instance.${channel}`,
								})),
					};
				},
			);
			const issues = [
				...count.issues,
				...parsedChannels.flatMap((entry) => entry.issues),
			];
			if (
				!count.expression ||
				issues.some((issue) => issue.severity === "error")
			) {
				return { issues };
			}
			const expressionFor = (channel: "x" | "y" | "rotation") =>
				parsedChannels.find((entry) => entry.channel === channel)?.expression;
			const x = expressionFor("x");
			const y = expressionFor("y");
			const rotation = expressionFor("rotation");
			const instance: DuplicateGeneratorBinding["instance"] = {
				...(x ? { x } : {}),
				...(y ? { y } : {}),
				...(rotation ? { rotation } : {}),
			};
			const generator: DuplicateGeneratorBinding = {
				id: duplicateGeneratorIdForNode(command.generator.sourceNodeId),
				sourceNodeId: command.generator.sourceNodeId,
				count: count.expression,
				...(command.generator.seed === undefined
					? {}
					: { seed: command.generator.seed }),
				instance,
			};
			return {
				compiled: {
					command: createSetDuplicateGeneratorCommand(generator),
					target,
				},
				issues,
			};
		}
		case "scene/remove-duplicate-generator": {
			return {
				compiled: {
					command: createRemoveDuplicateGeneratorCommand(
						duplicateGeneratorIdForNode(command.nodeId),
					),
					target: { kind: "node", id: command.nodeId, path: commandPath },
				},
				issues: [],
			};
		}
		case "scene/update-node-style": {
			const nodeLookup = requireSceneNode(scene, command.nodeId, index, {
				kind: "node",
				id: command.nodeId,
				path: commandPath,
			});
			if (!nodeLookup.node) return { issues: nodeLookup.issues };
			const target = {
				kind: "node",
				id: command.nodeId,
				path: commandPath,
			} as const;
			const profilePatch = resolveAgentStrokeWidthProfilePatch(
				command.patch,
				index,
				target,
			);
			if (profilePatch.resolved === undefined) {
				return { issues: profilePatch.issues };
			}
			const changesPaint =
				profilePatch.resolved.fill !== undefined ||
				profilePatch.resolved.stroke !== undefined ||
				profilePatch.resolved.fills !== undefined ||
				profilePatch.resolved.strokes !== undefined;
			if (profilePatch.resolved.opacity !== undefined && changesPaint) {
				const props = readComponentProps(scene);
				const hasSharedOpacity = props.some(
					(prop) =>
						prop.type === "number" &&
						prop.bindings.some(
							(binding) =>
								binding.kind === "bindable" &&
								binding.nodeId === command.nodeId &&
								binding.propertyId === "style.opacity",
						),
				);
				const hasSharedColor = props.some(
					(prop) =>
						prop.type === "color" &&
						prop.bindings.some(
							(binding) =>
								binding.kind === "style-color" &&
								binding.nodeId === command.nodeId,
						),
				);
				if (hasSharedOpacity && hasSharedColor) {
					return {
						issues: [
							createAgentIssue(
								"agent.component-prop-mixed-owner-edit",
								"error",
								`Scene command ${index} combines opacity and paint edits on node "${command.nodeId}", where separate shared drivers own both fields; send them as separate scene commands so each driver can update atomically.`,
								target,
							),
						],
					};
				}
			}
			if (profilePatch.resolved.opacity !== undefined) {
				const ownerIssues = sharedNumberOrdinaryEditIssues({
					scene,
					motion,
					grammarTargetNodeIds,
					nodeId: command.nodeId,
					propertyId: "style.opacity",
					index,
					target,
				});
				if (ownerIssues.length > 0) return { issues: ownerIssues };
			}
			return {
				compiled: {
					command: createUpdateNodeStyleCommand(
						command.nodeId,
						profilePatch.resolved,
						{ grammarTargetNodeIds, motion },
					),
					target,
				},
				issues: profilePatch.issues,
			};
		}
		case "scene/update-text-node": {
			const nodeLookup = requireSceneNode(scene, command.nodeId, index, {
				kind: "node",
				id: command.nodeId,
				path: commandPath,
			});
			if (!nodeLookup.node) return { issues: nodeLookup.issues };
			const node = nodeLookup.node;
			if (node.geometry.kind !== "text") {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-non-text-node",
							"error",
							`Scene command ${index} cannot edit text on ${node.geometry.kind} node "${command.nodeId}".`,
							{ kind: "node", id: command.nodeId, path: commandPath },
						),
					],
				};
			}
			return {
				compiled: {
					command: createUpdateTextNodeCommand(command.nodeId, command.patch),
					target: { kind: "node", id: command.nodeId, path: commandPath },
				},
				issues: [],
			};
		}
		case "scene/update-corner-radius": {
			const nodeLookup = requireSceneNode(scene, command.nodeId, index, {
				kind: "node",
				id: command.nodeId,
				path: commandPath,
			});
			if (!nodeLookup.node) return { issues: nodeLookup.issues };
			const kind = nodeLookup.node.geometry.kind;
			if (kind !== "rect" && kind !== "star" && kind !== "polygon") {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-non-roundable-node",
							"error",
							`Scene command ${index} cannot set corner radius on ${kind} node "${command.nodeId}".`,
							{ kind: "node", id: command.nodeId, path: commandPath },
						),
					],
				};
			}
			return {
				compiled: {
					command:
						kind === "rect"
							? createUpdateRectCornerRadiusCommand(
									command.nodeId,
									command.cornerRadius,
								)
							: createUpdatePolygonStarCornerRadiusCommand(
									command.nodeId,
									command.cornerRadius,
								),
					target: { kind: "node", id: command.nodeId, path: commandPath },
				},
				issues: [],
			};
		}
		case "scene/update-rect-corner-radii": {
			const nodeLookup = requireSceneNode(scene, command.nodeId, index, {
				kind: "node",
				id: command.nodeId,
				path: commandPath,
			});
			if (!nodeLookup.node) return { issues: nodeLookup.issues };
			const node = nodeLookup.node;
			if (node.geometry.kind !== "rect") {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-non-roundable-node",
							"error",
							`Scene command ${index} cannot set per-corner radii on ${node.geometry.kind} node "${command.nodeId}".`,
							{ kind: "node", id: command.nodeId, path: commandPath },
						),
					],
				};
			}
			return {
				compiled: {
					command: createUpdateRectCornerRadiiCommand(
						command.nodeId,
						command.radii,
					),
					target: { kind: "node", id: command.nodeId, path: commandPath },
				},
				issues: [],
			};
		}
		case "scene/update-corner-smoothing": {
			const nodeLookup = requireSceneNode(scene, command.nodeId, index, {
				kind: "node",
				id: command.nodeId,
				path: commandPath,
			});
			if (!nodeLookup.node) return { issues: nodeLookup.issues };
			const kind = nodeLookup.node.geometry.kind;
			if (kind !== "rect" && kind !== "star" && kind !== "polygon") {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-non-roundable-node",
							"error",
							`Scene command ${index} cannot set corner smoothing on ${kind} node "${command.nodeId}".`,
							{ kind: "node", id: command.nodeId, path: commandPath },
						),
					],
				};
			}
			return {
				compiled: {
					command: createUpdateCornerSmoothingCommand(
						command.nodeId,
						command.cornerSmoothing,
					),
					target: { kind: "node", id: command.nodeId, path: commandPath },
				},
				issues: [],
			};
		}
		case "scene/reorder-layer": {
			const layer = scene.layers.find((item) => item.id === command.layerId);
			if (!layer) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-layer",
							"error",
							`Scene command ${index} targets missing layer "${command.layerId}".`,
							{ kind: "layer", id: command.layerId, path: commandPath },
						),
					],
				};
			}
			if (!validLayerIndex(scene, command.toIndex)) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-invalid-index",
							"error",
							`Scene command ${index} has invalid layer index ${command.toIndex}.`,
							{ kind: "layer", id: command.layerId, path: commandPath },
						),
					],
				};
			}
			return {
				compiled: {
					command: createReorderLayerCommand(command.layerId, command.toIndex),
					target: { kind: "layer", id: command.layerId, path: commandPath },
				},
				issues: [],
			};
		}
		case "scene/reorder-node-within-layer": {
			const layer = scene.layers.find((item) => item.id === command.layerId);
			if (!layer) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-layer",
							"error",
							`Scene command ${index} targets missing layer "${command.layerId}".`,
							{ kind: "layer", id: command.layerId, path: commandPath },
						),
					],
				};
			}
			const nodeLookup = requireSceneNode(scene, command.nodeId, index, {
				kind: "node",
				id: command.nodeId,
				path: commandPath,
			});
			if (!nodeLookup.node) return { issues: nodeLookup.issues };
			if (
				findLayerByNodeId(scene, command.nodeId)?.id !== command.layerId ||
				!layerHasTopLevelNode(scene, command.layerId, command.nodeId)
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-node-layer-mismatch",
							"error",
							`Scene command ${index} cannot reorder node "${command.nodeId}" inside layer "${command.layerId}".`,
							{ kind: "node", id: command.nodeId, path: commandPath },
						),
					],
				};
			}
			if (!validNodeIndex(scene, command.layerId, command.toIndex)) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-invalid-index",
							"error",
							`Scene command ${index} has invalid node index ${command.toIndex}.`,
							{ kind: "node", id: command.nodeId, path: commandPath },
						),
					],
				};
			}
			return {
				compiled: {
					command: createReorderNodeWithinLayerCommand(
						command.layerId,
						command.nodeId,
						command.toIndex,
					),
					target: { kind: "node", id: command.nodeId, path: commandPath },
				},
				issues: [],
			};
		}
		case "scene/append-node": {
			if (scene.layers.length === 0) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-no-layer",
							"error",
							`Scene command ${index} cannot append a node: the document has no layers.`,
							{ kind: "document", id: scene.id, path: commandPath },
						),
					],
				};
			}
			if (
				command.layerId &&
				!scene.layers.some((layer) => layer.id === command.layerId)
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-layer",
							"error",
							`Scene command ${index} targets missing layer "${command.layerId}".`,
							{ kind: "layer", id: command.layerId, path: commandPath },
						),
					],
				};
			}
			if (!isAuthorableNodeGeometry(command.node.geometry)) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-invalid-geometry",
							"error",
							`Scene command ${index} cannot append invalid ${command.node.geometry.kind} geometry.`,
							{ kind: "document", id: scene.id, path: commandPath },
						),
					],
				};
			}
			if (command.node.geometry.kind === "image") {
				const assetId = command.node.geometry.assetId;
				if (!(scene.assets ?? []).some((asset) => asset.id === assetId)) {
					return {
						issues: [
							createAgentIssue(
								"agent.scene-command-missing-asset",
								"error",
								`Image geometry references missing asset "${assetId}".`,
								{
									kind: "asset",
									id: assetId,
									path: commandPath,
								},
							),
						],
					};
				}
			}
			const documentTarget = {
				kind: "document",
				id: scene.id,
				path: commandPath,
			} as const;
			const styleResult = resolveAgentNewNodeStyle(
				command.node.style,
				index,
				documentTarget,
			);
			if ("invalid" in styleResult) return { issues: styleResult.issues };
			const node = createNode(
				command.node.geometry.kind,
				buildAppendGeometry(command.node.geometry),
				{
					name: command.node.name,
					style: styleResult.style,
					transform: command.node.transform,
				},
			);
			return {
				compiled: {
					command: createAppendNodeCommand(
						node,
						command.layerId ? { layerId: command.layerId } : {},
					),
					target: { kind: "node", id: node.id, path: commandPath },
				},
				issues: styleResult.issues,
			};
		}
		case "scene/append-dot-matrix": {
			if (scene.layers.length === 0) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-no-layer",
							"error",
							`Scene command ${index} cannot append a dot matrix: the document has no layers.`,
							{ kind: "document", id: scene.id, path: commandPath },
						),
					],
				};
			}
			if (
				command.layerId &&
				!scene.layers.some((layer) => layer.id === command.layerId)
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-layer",
							"error",
							`Scene command ${index} targets missing layer "${command.layerId}".`,
							{ kind: "layer", id: command.layerId, path: commandPath },
						),
					],
				};
			}

			const documentTarget = {
				kind: "document",
				id: scene.id,
				path: commandPath,
			} as const;
			const matrixResult = buildDotMatrixNode({
				name: command.matrix.name,
				origin: command.matrix.origin,
				rows: command.matrix.rows,
				cellSize: command.matrix.cellSize,
				gap: command.matrix.gap,
				style: command.matrix.style,
			});
			if (!matrixResult.ok) {
				return {
					issues: matrixResult.issues.map((issue) =>
						createAgentIssue(
							`agent.dot-matrix-${issue.code}`,
							"error",
							`Scene command ${index}: ${issue.message}`,
							documentTarget,
						),
					),
				};
			}

			return {
				compiled: {
					command: createAppendNodeCommand(matrixResult.node, {
						...(command.layerId ? { layerId: command.layerId } : {}),
						label: "Add dot matrix",
					}),
					target: {
						kind: "node",
						id: matrixResult.node.id,
						path: commandPath,
					},
				},
				issues: [],
			};
		}
		case "scene/append-pixel-art-objects": {
			if (scene.layers.length === 0) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-no-layer",
							"error",
							`Scene command ${index} cannot append pixel-art objects: the document has no layers.`,
							{ kind: "document", id: scene.id, path: commandPath },
						),
					],
				};
			}
			if (
				command.layerId &&
				!scene.layers.some((layer) => layer.id === command.layerId)
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-layer",
							"error",
							`Scene command ${index} targets missing layer "${command.layerId}".`,
							{ kind: "layer", id: command.layerId, path: commandPath },
						),
					],
				};
			}
			if (
				command.pixelArt.artboardId &&
				!findArtboardById(scene, command.pixelArt.artboardId)
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-artboard",
							"error",
							`Scene command ${index} targets missing artboard "${command.pixelArt.artboardId}".`,
							{
								kind: "artboard",
								id: command.pixelArt.artboardId,
								path: commandPath,
							},
						),
					],
				};
			}
			const result = createIndexedPixelArtObject(command.pixelArt);
			if (!result.ok) {
				return {
					issues: [
						createAgentIssue(
							`agent.pixel-art-${result.code}`,
							"error",
							`Scene command ${index}: ${result.message}`,
							{ kind: "document", id: scene.id, path: commandPath },
						),
					],
				};
			}
			return {
				compiled: {
					command: createAppendNodeCommand(result.node, {
						...(command.layerId ? { layerId: command.layerId } : {}),
						label: "Add pixel-art objects",
					}),
					target: { kind: "node", id: result.node.id, path: commandPath },
				},
				issues: [],
			};
		}
		case "scene/place-external-asset": {
			const target = {
				kind: "asset",
				id: command.asset.assetId,
				path: commandPath,
			} as const;
			if (scene.layers.length === 0) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-no-layer",
							"error",
							`Scene command ${index} cannot place an external asset: the document has no layers.`,
							{ kind: "document", id: scene.id, path: commandPath },
						),
					],
				};
			}
			if (
				command.layerId &&
				!scene.layers.some((layer) => layer.id === command.layerId)
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-layer",
							"error",
							`Scene command ${index} targets missing layer "${command.layerId}".`,
							{ kind: "layer", id: command.layerId, path: commandPath },
						),
					],
				};
			}
			const artboardId =
				command.asset.artboardId ??
				scene.currentArtboardId ??
				scene.artboard.id;
			const artboardLookup = requireArtboard(scene, artboardId, index, {
				kind: "artboard",
				id: artboardId,
				path: commandPath,
			});
			if (!artboardLookup.artboard) return { issues: artboardLookup.issues };
			const href = sourceHref(command.asset.source).trim();
			if (!href) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-external-asset-empty-source",
							"error",
							`Scene command ${index} cannot place external asset "${command.asset.name}": source href/dataUrl is empty.`,
							target,
						),
					],
				};
			}
			const nodeId = command.asset.nodeId?.trim() || createId("external-asset");
			if (findNode(scene, nodeId)) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-duplicate-node",
							"error",
							`Scene command ${index} cannot place external asset node "${nodeId}": that node id already exists.`,
							{ kind: "node", id: nodeId, path: commandPath },
						),
					],
				};
			}
			const assetId =
				command.asset.assetId?.trim() || createId("external-scene-asset");
			const existingAsset = scene.assets?.find((asset) => asset.id === assetId);
			if (existingAsset && existingAsset.kind !== command.asset.kind) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-asset-kind-conflict",
							"error",
							`Scene command ${index} cannot place external asset "${assetId}": an existing ${existingAsset.kind} asset already uses that id.`,
							{ kind: "asset", id: assetId, path: commandPath },
						),
					],
				};
			}
			if (
				command.asset.previewAssetId &&
				!scene.assets?.some(
					(asset) =>
						asset.kind === "image" && asset.id === command.asset.previewAssetId,
				)
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-preview-asset",
							"error",
							`Scene command ${index} references missing preview image asset "${command.asset.previewAssetId}".`,
							{
								kind: "asset",
								id: command.asset.previewAssetId,
								path: commandPath,
							},
						),
					],
				};
			}
			const capabilityResult = externalAssetCapabilitiesFromAgent(
				command.asset.capabilities,
			);
			return {
				compiled: {
					command: createPlaceExternalSceneAssetCommand(
						{
							assetId,
							nodeId,
							kind: command.asset.kind,
							name: command.asset.name,
							bounds: command.asset.bounds,
							source: command.asset.source,
							artboardId,
							format: command.asset.format,
							mimeType: command.asset.mimeType,
							width: command.asset.width,
							height: command.asset.height,
							...(command.asset.previewAssetId
								? {
										preview: {
											assetId: command.asset.previewAssetId,
											role: "editor-preview",
										},
									}
								: {}),
							capabilities: capabilityResult.capabilities,
							issues: command.asset.issues,
						},
						command.layerId ? { layerId: command.layerId } : {},
					),
					target: { kind: "node", id: nodeId, path: commandPath },
				},
				issues: capabilityResult.issues,
			};
		}
		case "scene/upsert-asset": {
			const target = {
				kind: "asset",
				id: command.asset.id,
				path: commandPath,
			} as const;
			if (!command.asset.id.trim() || !command.asset.name.trim()) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-invalid-asset",
							"error",
							"Asset id and name must not be empty.",
							target,
						),
					],
				};
			}
			const existing = scene.assets?.find(
				(asset) => asset.id === command.asset.id,
			);
			if (existing && existing.kind !== command.asset.kind) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-asset-kind-conflict",
							"error",
							`Asset "${command.asset.id}" is ${existing.kind}, not ${command.asset.kind}.`,
							target,
						),
					],
				};
			}
			return {
				compiled: {
					command: createUpsertSceneAssetCommand(command.asset),
					target,
				},
				issues: [],
			};
		}
		case "scene/place-asset": {
			const placement = command.placement;
			const target = {
				kind: "asset",
				id: placement.assetId,
				path: commandPath,
			} as const;
			if (
				!(scene.assets ?? []).some((asset) => asset.id === placement.assetId)
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-asset",
							"error",
							`Asset "${placement.assetId}" does not exist.`,
							target,
						),
					],
				};
			}
			if (!isAuthorableBounds(placement.bounds)) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-invalid-asset-bounds",
							"error",
							"Asset placement bounds must be finite and positive.",
							target,
						),
					],
				};
			}
			if (
				placement.layerId &&
				!scene.layers.some((layer) => layer.id === placement.layerId)
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-layer",
							"error",
							`Layer "${placement.layerId}" does not exist.`,
							target,
						),
					],
				};
			}
			const artboardId =
				placement.artboardId ?? scene.currentArtboardId ?? scene.artboard.id;
			if (!findArtboardById(scene, artboardId)) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-artboard",
							"error",
							`Artboard "${artboardId}" does not exist.`,
							target,
						),
					],
				};
			}
			const nodeId = placement.nodeId?.trim() || createId("asset-node");
			if (findNode(scene, nodeId)) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-duplicate-node",
							"error",
							`Node "${nodeId}" already exists.`,
							target,
						),
					],
				};
			}
			return {
				compiled: {
					command: createPlaceExistingSceneAssetCommand(
						{
							assetId: placement.assetId,
							nodeId,
							bounds: placement.bounds,
							artboardId,
							...(placement.name ? { name: placement.name } : {}),
						},
						placement.layerId ? { layerId: placement.layerId } : {},
					),
					target: { kind: "node", id: nodeId, path: commandPath },
				},
				issues: [],
			};
		}
		case "scene/remove-unused-asset": {
			const target = {
				kind: "asset",
				id: command.assetId,
				path: commandPath,
			} as const;
			if (!(scene.assets ?? []).some((asset) => asset.id === command.assetId)) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-asset",
							"error",
							`Asset "${command.assetId}" does not exist.`,
							target,
						),
					],
				};
			}
			return {
				compiled: {
					command: createRemoveUnusedSceneAssetCommand(command.assetId),
					target,
				},
				issues: [],
			};
		}
		case "scene/add-scene-camera": {
			const artboardId =
				command.camera.artboardId ??
				scene.currentArtboardId ??
				scene.artboard.id;
			const artboardLookup = requireArtboard(scene, artboardId, index, {
				kind: "artboard",
				id: artboardId,
				path: commandPath,
			});
			if (!artboardLookup.artboard) return { issues: artboardLookup.issues };
			if (
				command.camera.id &&
				findSceneCameraRig(scene, command.camera.id) !== undefined
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-duplicate-camera-rig",
							"error",
							`Scene command ${index} cannot create scene camera "${command.camera.id}": that id already exists.`,
							{ kind: "document", id: scene.id, path: commandPath },
						),
					],
				};
			}
			if (
				command.camera.targetControllerNodeId &&
				!findNode(scene, command.camera.targetControllerNodeId)
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-node",
							"error",
							`Scene command ${index} targets missing camera target controller "${command.camera.targetControllerNodeId}".`,
							{
								kind: "node",
								id: command.camera.targetControllerNodeId,
								path: commandPath,
							},
						),
					],
				};
			}
			if (
				command.activateArtboardId !== undefined &&
				command.activateArtboardId !== null
			) {
				const activeArtboardLookup = requireArtboard(
					scene,
					command.activateArtboardId,
					index,
					{
						kind: "artboard",
						id: command.activateArtboardId,
						path: commandPath,
					},
				);
				if (!activeArtboardLookup.artboard) {
					return { issues: activeArtboardLookup.issues };
				}
			}
			const rig = buildSceneCameraRigForArtboard(scene, {
				...command.camera,
				artboardId,
			});
			if (!rig) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-invalid-camera-rig",
							"error",
							`Scene command ${index} could not build a scene camera for artboard "${artboardId}".`,
							{ kind: "artboard", id: artboardId, path: commandPath },
						),
					],
				};
			}
			if (
				command.activateArtboardId &&
				!cameraRigScopesArtboard(rig, command.activateArtboardId)
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-camera-scope-mismatch",
							"error",
							`Scene command ${index} cannot activate new camera "${rig.id}" for artboard "${command.activateArtboardId}" because the camera scope does not include it.`,
							{
								kind: "artboard",
								id: command.activateArtboardId,
								path: commandPath,
							},
						),
					],
				};
			}
			return {
				compiled: {
					command: createAddSceneCameraCommand(rig, {
						...(command.activateArtboardId !== undefined
							? { activateArtboardId: command.activateArtboardId }
							: {}),
					}),
					target: { kind: "document", id: scene.id, path: commandPath },
				},
				issues: [],
			};
		}
		case "scene/update-scene-camera": {
			const target = {
				kind: "document",
				id: scene.id,
				path: commandPath,
			} as const;
			const rigLookup = requireSceneCameraRig(
				scene,
				command.cameraRigId,
				index,
				target,
			);
			if (!rigLookup.rig) return { issues: rigLookup.issues };
			if (
				command.patch.scope?.kind === "artboard" &&
				!findArtboardById(scene, command.patch.scope.artboardId)
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-artboard",
							"error",
							`Scene command ${index} cannot scope camera "${command.cameraRigId}" to missing artboard "${command.patch.scope.artboardId}".`,
							{
								kind: "artboard",
								id: command.patch.scope.artboardId,
								path: commandPath,
							},
						),
					],
				};
			}
			for (const nodeId of [
				command.patch.body?.parentControllerNodeId ?? undefined,
				command.patch.target && command.patch.target !== null
					? (command.patch.target.nodeId ?? undefined)
					: undefined,
				command.patch.target && command.patch.target !== null
					? (command.patch.target.parentControllerNodeId ?? undefined)
					: undefined,
				command.patch.parentControllerNodeId ?? undefined,
			]) {
				if (!nodeId || findNode(scene, nodeId)) continue;
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-node",
							"error",
							`Scene command ${index} references missing camera node/controller "${nodeId}".`,
							{ kind: "node", id: nodeId, path: commandPath },
						),
					],
				};
			}
			return {
				compiled: {
					command: createUpdateSceneCameraCommand(
						command.cameraRigId,
						command.patch,
					),
					target,
				},
				issues: [],
			};
		}
		case "scene/remove-scene-camera": {
			const target = {
				kind: "document",
				id: scene.id,
				path: commandPath,
			} as const;
			const rigLookup = requireSceneCameraRig(
				scene,
				command.cameraRigId,
				index,
				target,
			);
			if (!rigLookup.rig) return { issues: rigLookup.issues };
			return {
				compiled: {
					command: createRemoveSceneCameraCommand(command.cameraRigId),
					target,
				},
				issues: [],
			};
		}
		case "scene/set-active-scene-camera": {
			const artboardLookup = requireArtboard(scene, command.artboardId, index, {
				kind: "artboard",
				id: command.artboardId,
				path: commandPath,
			});
			if (!artboardLookup.artboard) return { issues: artboardLookup.issues };
			if (command.cameraRigId) {
				const rigLookup = requireSceneCameraRig(
					scene,
					command.cameraRigId,
					index,
					{ kind: "document", id: scene.id, path: commandPath },
				);
				if (!rigLookup.rig) return { issues: rigLookup.issues };
				if (!cameraRigScopesArtboard(rigLookup.rig, command.artboardId)) {
					return {
						issues: [
							createAgentIssue(
								"agent.scene-command-camera-scope-mismatch",
								"error",
								`Scene command ${index} cannot activate camera "${command.cameraRigId}" for artboard "${command.artboardId}" because the camera scope does not include it.`,
								{ kind: "artboard", id: command.artboardId, path: commandPath },
							),
						],
					};
				}
			}
			return {
				compiled: {
					command: createSetActiveSceneCameraCommand(
						command.artboardId,
						command.cameraRigId,
					),
					target: {
						kind: "artboard",
						id: command.artboardId,
						path: commandPath,
					},
				},
				issues: [],
			};
		}
		case "scene/set-node-depth-plane": {
			if (command.nodeIds.length === 0) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-empty-node-list",
							"error",
							`Scene command ${index} must include at least one node id for depth assignment.`,
							{ kind: "document", id: scene.id, path: commandPath },
						),
					],
				};
			}
			const missingIssues = missingSceneNodeIssues(
				scene,
				command.nodeIds,
				index,
				commandPath,
			);
			if (missingIssues.length > 0) return { issues: missingIssues };
			if (
				command.depthPlane?.cameraRigId &&
				!findSceneCameraRig(scene, command.depthPlane.cameraRigId)
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-camera-rig",
							"error",
							`Scene command ${index} references missing scene camera "${command.depthPlane.cameraRigId}" for depth assignment.`,
							{ kind: "document", id: scene.id, path: commandPath },
						),
					],
				};
			}
			return {
				compiled: {
					command: createSetNodeDepthPlaneCommand(
						command.nodeIds,
						command.depthPlane
							? sceneDepthPlaneFromAgent(command.depthPlane)
							: null,
					),
					target:
						command.nodeIds.length === 1
							? { kind: "node", id: command.nodeIds[0], path: commandPath }
							: { kind: "document", id: scene.id, path: commandPath },
				},
				issues: [],
			};
		}
		case "scene/add-motion-controller": {
			if (scene.layers.length === 0) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-no-layer",
							"error",
							`Scene command ${index} cannot create a motion controller: the document has no layers.`,
							{ kind: "document", id: scene.id, path: commandPath },
						),
					],
				};
			}
			if (
				command.layerId &&
				!scene.layers.some((layer) => layer.id === command.layerId)
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-layer",
							"error",
							`Scene command ${index} targets missing layer "${command.layerId}".`,
							{ kind: "layer", id: command.layerId, path: commandPath },
						),
					],
				};
			}
			if (
				command.controller.id &&
				findNode(scene, command.controller.id) !== undefined
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-duplicate-node",
							"error",
							`Scene command ${index} cannot create motion controller "${command.controller.id}": that node id already exists.`,
							{ kind: "node", id: command.controller.id, path: commandPath },
						),
					],
				};
			}
			const controller = buildMotionControllerNode(scene, command.controller);
			if (!controller) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-invalid-motion-controller",
							"error",
							`Scene command ${index} could not build a motion controller for the requested artboard.`,
							{ kind: "document", id: scene.id, path: commandPath },
						),
					],
				};
			}
			return {
				compiled: {
					command: createAddMotionControllerNodeCommand(controller, {
						...(command.layerId ? { layerId: command.layerId } : {}),
					}),
					target: { kind: "node", id: controller.id, path: commandPath },
				},
				issues: [],
			};
		}
		case "scene/set-motion-controller": {
			const nodeLookup = requireSceneNode(scene, command.nodeId, index, {
				kind: "node",
				id: command.nodeId,
				path: commandPath,
			});
			if (!nodeLookup.node) return { issues: nodeLookup.issues };
			return {
				compiled: {
					command: createSetMotionControllerCommand(
						command.nodeId,
						command.controller
							? {
									kind: "motion-controller",
									...(command.controller.handleRadius !== undefined
										? { handleRadius: command.controller.handleRadius }
										: {}),
								}
							: null,
					),
					target: { kind: "node", id: command.nodeId, path: commandPath },
				},
				issues: [],
			};
		}
		case "scene/set-motion-parent": {
			const target = {
				kind: "node",
				id: command.nodeId,
				path: commandPath,
			} as const;
			const nodeLookup = requireSceneNode(scene, command.nodeId, index, target);
			if (!nodeLookup.node) return { issues: nodeLookup.issues };
			if (command.binding && !findNode(scene, command.binding.parentNodeId)) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-node",
							"error",
							`Scene command ${index} references missing motion parent "${command.binding.parentNodeId}".`,
							{
								kind: "node",
								id: command.binding.parentNodeId,
								path: commandPath,
							},
						),
					],
				};
			}
			const needsPlanner =
				(command.binding !== null && !command.binding.bindMatrix) ||
				(command.binding === null &&
					nodeLookup.node.motionParent !== undefined);
			if (
				needsPlanner &&
				(command.frame === undefined || !Number.isFinite(command.frame))
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-parent-frame-required",
							"error",
							"Keep-pose motion-parent bind/detach requires a finite authoring frame.",
							target,
						),
					],
				};
			}
			if (command.binding?.bindMatrix) {
				const relationIssues = validateMotionParentTarget(
					scene,
					command.nodeId,
					command.binding.parentNodeId,
				);
				if (relationIssues.length > 0) {
					return {
						issues: relationIssues.map((entry) =>
							createAgentIssue(
								`agent.${entry.code}`,
								"error",
								entry.message,
								target,
							),
						),
					};
				}
				return {
					compiled: {
						command: createSetMotionParentCommand(command.nodeId, {
							parentNodeId: command.binding.parentNodeId,
							bindMatrix: command.binding.bindMatrix,
						}),
						target,
					},
					issues: [],
				};
			}
			if (command.binding) {
				const frame = snapMotionFrame(
					command.frame ?? 0,
					motion.durationFrames,
				);
				const sampledScene = sampleMotionRelationLocalScene(
					scene,
					motion,
					frame,
				);
				const plan = planBindMotionParentsCommand({
					restScene: scene,
					sampledScene,
					nodeIds: [command.nodeId],
					parentNodeId: command.binding.parentNodeId,
				});
				if (plan.status === "blocked") {
					return {
						issues: plan.issues.map((entry) =>
							createAgentIssue(
								`agent.${entry.code}`,
								"error",
								entry.message,
								target,
							),
						),
					};
				}
				return { compiled: { command: plan.command, target }, issues: [] };
			}
			if (!nodeLookup.node.motionParent) {
				return {
					compiled: {
						command: createSetMotionParentCommand(command.nodeId, null),
						target,
					},
					issues: [],
				};
			}
			const frame = snapMotionFrame(command.frame ?? 0, motion.durationFrames);
			const plan = planMotionRelationDetachAtFrame({
				scene,
				motion,
				frame,
				nodeIds: [command.nodeId],
			});
			if (plan.status === "blocked") {
				return {
					issues: plan.issues.map((entry) =>
						createAgentIssue(
							`agent.${entry.code}`,
							"error",
							entry.message,
							target,
						),
					),
				};
			}
			return {
				compiled: {
					command: plan.sceneCommand,
					target,
					motionCommands: plan.motionCommands.map((command) => ({
						command,
						target,
					})),
				},
				issues: [],
			};
		}
		case "scene/set-transform-constraint": {
			const target = {
				kind: "node",
				id: command.nodeId,
				path: commandPath,
			} as const;
			const nodeLookup = requireSceneNode(scene, command.nodeId, index, target);
			if (!nodeLookup.node) return { issues: nodeLookup.issues };
			if (command.sourceNodeId === null) {
				return {
					compiled: {
						command: createRemoveTransformConstraintCommand(command.nodeId),
						target,
					},
					issues: [],
				};
			}
			if (!findNode(scene, command.sourceNodeId)) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-node",
							"error",
							`Scene command ${index} references missing constraint source "${command.sourceNodeId}".`,
							{ kind: "node", id: command.sourceNodeId, path: commandPath },
						),
					],
				};
			}
			const maintainOffset =
				command.maintainOffset ??
				nodeLookup.node.transformConstraint?.maintainOffset ??
				true;
			if (
				maintainOffset &&
				(command.frame === undefined || !Number.isFinite(command.frame))
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.transform-constraint-frame-required",
							"error",
							"A maintain-offset transform constraint requires a finite authoring frame.",
							target,
						),
					],
				};
			}
			const sampledScene =
				command.frame === undefined
					? scene
					: sampleMotionRelationLocalScene(
							scene,
							motion,
							snapMotionFrame(command.frame, motion.durationFrames),
						);
			const plan = planTransformConstraintCommand({
				scene: sampledScene,
				nodeId: command.nodeId,
				sourceNodeId: command.sourceNodeId,
				channels: command.channels ??
					nodeLookup.node.transformConstraint?.channels ?? ["position"],
				strength:
					command.strength ??
					nodeLookup.node.transformConstraint?.strength ??
					1,
				sourceSpace:
					command.sourceSpace ??
					nodeLookup.node.transformConstraint?.sourceSpace ??
					"world",
				destinationSpace:
					command.destinationSpace ??
					nodeLookup.node.transformConstraint?.destinationSpace ??
					"world",
				maintainOffset,
			});
			if (plan.status === "blocked") {
				return {
					issues: [
						createAgentIssue(
							"agent.transform-constraint-invalid",
							"error",
							plan.reason,
							target,
						),
					],
				};
			}
			return { compiled: { command: plan.command, target }, issues: [] };
		}
		case "scene/set-property-relation": {
			const target = {
				kind: "node",
				id: command.nodeId,
				path: commandPath,
			} as const;
			const nodeLookup = requireSceneNode(scene, command.nodeId, index, target);
			if (!nodeLookup.node) return { issues: nodeLookup.issues };
			if (command.relation === null) {
				return {
					compiled: {
						command: createRemovePropertyRelationCommand(
							command.nodeId,
							command.relationId ?? "",
						),
						target,
					},
					issues: [],
				};
			}
			const sourceNode = findNode(scene, command.relation.sourceNodeId);
			if (!sourceNode) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-node",
							"error",
							`Scene command ${index} references missing property source "${command.relation.sourceNodeId}".`,
							{
								kind: "node",
								id: command.relation.sourceNodeId,
								path: commandPath,
							},
						),
					],
				};
			}
			if (
				selectArtboardIdForNode(scene, command.nodeId) !==
				selectArtboardIdForNode(scene, sourceNode.id)
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.property-relation-cross-artboard",
							"error",
							`Scene command ${index} cannot relate properties across artboards.`,
							target,
						),
					],
				};
			}
			return {
				compiled: {
					command: createSetPropertyRelationCommand({
						...command.relation,
						nodeId: command.nodeId,
					}),
					target,
				},
				issues: [],
			};
		}
		case "scene/bind-camera-target-node": {
			const target = {
				kind: "document",
				id: scene.id,
				path: commandPath,
			} as const;
			const rigLookup = requireSceneCameraRig(
				scene,
				command.cameraRigId,
				index,
				target,
			);
			if (!rigLookup.rig) return { issues: rigLookup.issues };
			if (command.nodeId && !findNode(scene, command.nodeId)) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-node",
							"error",
							`Scene command ${index} targets missing camera target node "${command.nodeId}".`,
							{ kind: "node", id: command.nodeId, path: commandPath },
						),
					],
				};
			}
			return {
				compiled: {
					command: command.nodeId
						? createBindSceneCameraTargetNodeCommand(
								command.cameraRigId,
								command.nodeId,
							)
						: createClearCameraTargetPreservingPositionCommand(
								scene,
								command.cameraRigId,
							),
					target,
				},
				issues: [],
			};
		}
		case "scene/bind-camera-target-controller": {
			const target = {
				kind: "document",
				id: scene.id,
				path: commandPath,
			} as const;
			const rigLookup = requireSceneCameraRig(
				scene,
				command.cameraRigId,
				index,
				target,
			);
			if (!rigLookup.rig) return { issues: rigLookup.issues };
			if (
				command.controllerNodeId &&
				!findNode(scene, command.controllerNodeId)
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-node",
							"error",
							`Scene command ${index} targets missing camera target controller "${command.controllerNodeId}".`,
							{ kind: "node", id: command.controllerNodeId, path: commandPath },
						),
					],
				};
			}
			return {
				compiled: {
					command: command.controllerNodeId
						? createBindSceneCameraTargetControllerCommand(
								command.cameraRigId,
								command.controllerNodeId,
							)
						: createClearCameraTargetPreservingPositionCommand(
								scene,
								command.cameraRigId,
							),
					target,
				},
				issues: [],
			};
		}
		case "scene/bind-camera-body-controller": {
			const target = {
				kind: "document",
				id: scene.id,
				path: commandPath,
			} as const;
			const rigLookup = requireSceneCameraRig(
				scene,
				command.cameraRigId,
				index,
				target,
			);
			if (!rigLookup.rig) return { issues: rigLookup.issues };
			if (
				command.controllerNodeId &&
				!findNode(scene, command.controllerNodeId)
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-node",
							"error",
							`Scene command ${index} targets missing camera body controller "${command.controllerNodeId}".`,
							{
								kind: "node",
								id: command.controllerNodeId,
								path: commandPath,
							},
						),
					],
				};
			}
			return {
				compiled: {
					command: createBindSceneCameraBodyControllerCommand(
						command.cameraRigId,
						command.controllerNodeId,
					),
					target,
				},
				issues: [],
			};
		}
		case "scene/create-layout-frame": {
			if (scene.layers.length === 0) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-no-layer",
							"error",
							`Scene command ${index} cannot create a layout frame: the document has no layers.`,
							{ kind: "document", id: scene.id, path: commandPath },
						),
					],
				};
			}
			if (command.sourceNodeIds.length === 0 && !command.bounds) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-empty-layout-frame",
							"error",
							`Scene command ${index} must include sourceNodeIds or explicit bounds to create a layout frame.`,
							{ kind: "document", id: scene.id, path: commandPath },
						),
					],
				};
			}
			const layerId = resolveLayoutFrameCreateLayer(
				scene,
				command.layerId,
				command.parentNodeId,
				command.sourceNodeIds,
			);
			const layer = scene.layers.find((item) => item.id === layerId);
			if (!layerId || !layer) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-layer",
							"error",
							`Scene command ${index} cannot resolve a layer for the layout frame.`,
							{ kind: "document", id: scene.id, path: commandPath },
						),
					],
				};
			}
			const sourceIssues: AgentIssue[] = [];
			const artboardMapping = selectNodeArtboardMapping(scene);
			const artboardIds = new Set<string>();
			if (layer.locked || !layer.visible) {
				sourceIssues.push(
					createAgentIssue(
						"agent.scene-command-protected-node",
						"error",
						`Scene command ${index} cannot create a layout frame in locked or hidden layer "${layerId}".`,
						{ kind: "layer", id: layerId, path: commandPath },
					),
				);
			}
			const parentNodeId = command.parentNodeId?.trim() || null;
			const parentNode = parentNodeId ? findNode(scene, parentNodeId) : null;
			if (parentNodeId && !parentNode) {
				sourceIssues.push(
					createAgentIssue(
						"agent.scene-command-missing-node",
						"error",
						`Scene command ${index} targets missing layout parent "${parentNodeId}".`,
						{ kind: "node", id: parentNodeId, path: commandPath },
					),
				);
			}
			if (parentNode && (parentNode.locked || !parentNode.visible)) {
				sourceIssues.push(
					createAgentIssue(
						"agent.scene-command-protected-node",
						"error",
						`Scene command ${index} cannot create a layout frame inside locked or hidden parent "${parentNode.id}".`,
						{ kind: "node", id: parentNode.id, path: commandPath },
					),
				);
			}
			const parentLayerId = parentNodeId
				? findLayerByNodeId(scene, parentNodeId)?.id
				: undefined;
			if (parentNodeId && parentLayerId && parentLayerId !== layerId) {
				sourceIssues.push(
					createAgentIssue(
						"agent.scene-command-node-layer-mismatch",
						"error",
						`Scene command ${index} parent "${parentNodeId}" belongs to layer "${parentLayerId}", not layer "${layerId}".`,
						{ kind: "node", id: parentNodeId, path: commandPath },
					),
				);
			}
			for (const nodeId of command.sourceNodeIds) {
				const node = findNode(scene, nodeId);
				if (!node) {
					sourceIssues.push(
						createAgentIssue(
							"agent.scene-command-missing-node",
							"error",
							`Scene command ${index} targets missing node "${nodeId}".`,
							{ kind: "node", id: nodeId, path: commandPath },
						),
					);
					continue;
				}
				const sourceInContainer = parentNode
					? !!directChildNode(parentNode, nodeId)
					: layerHasTopLevelNode(scene, layerId, nodeId);
				if (!sourceInContainer) {
					sourceIssues.push(
						createAgentIssue(
							"agent.scene-command-node-layer-mismatch",
							"error",
							parentNode
								? `Scene command ${index} can only wrap direct children of parent "${parentNode.id}" into a layout frame.`
								: `Scene command ${index} can only wrap top-level nodes from layer "${layerId}" into a layout frame.`,
							{ kind: "node", id: nodeId, path: commandPath },
						),
					);
				}
				if (node.locked || !node.visible) {
					sourceIssues.push(
						createAgentIssue(
							"agent.scene-command-protected-node",
							"error",
							`Scene command ${index} cannot wrap locked or hidden node "${nodeId}" into a layout frame.`,
							{ kind: "node", id: nodeId, path: commandPath },
						),
					);
				}
				const artboardId = artboardMapping.byNodeId[nodeId];
				if (artboardId) artboardIds.add(artboardId);
			}
			if (artboardIds.size > 1) {
				sourceIssues.push(
					createAgentIssue(
						"agent.scene-command-cross-artboard-layout-frame",
						"error",
						`Scene command ${index} cannot create one layout frame from nodes on multiple artboards.`,
						{ kind: "document", id: scene.id, path: commandPath },
					),
				);
			}
			if (sourceIssues.length > 0) return { issues: sourceIssues };
			const frameNodeId = command.frameNodeId?.trim() || createId("frame");
			if (findNode(scene, frameNodeId)) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-duplicate-node",
							"error",
							`Scene command ${index} cannot create layout frame "${frameNodeId}" because that node id already exists.`,
							{ kind: "node", id: frameNodeId, path: commandPath },
						),
					],
				};
			}
			const ownerArtboardId =
				command.sourceNodeIds.length > 0
					? (artboardMapping.byNodeId[command.sourceNodeIds[0] ?? ""] ??
						scene.artboard.id)
					: parentNodeId
						? (artboardMapping.byNodeId[parentNodeId] ?? scene.artboard.id)
						: undefined;
			const multiArtboard = selectAllArtboards(scene).length > 1;
			return {
				compiled: {
					command: createLayoutFrameFromNodesCommand({
						layerId,
						parentNodeId,
						frameNodeId,
						sourceNodeIds: command.sourceNodeIds,
						layout: command.layout,
						preset: command.preset,
						name: command.name,
						bounds: command.bounds,
						artboardId:
							!parentNodeId && multiArtboard && ownerArtboardId
								? ownerArtboardId
								: undefined,
					}),
					target: { kind: "node", id: frameNodeId, path: commandPath },
				},
				issues: [],
			};
		}
		case "scene/update-layout-frame": {
			const frame = findNode(scene, command.frameNodeId);
			if (!frame) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-node",
							"error",
							`Scene command ${index} targets missing layout frame "${command.frameNodeId}".`,
							{ kind: "node", id: command.frameNodeId, path: commandPath },
						),
					],
				};
			}
			if (frame.frame?.kind !== "frame") {
				return {
					issues: [
						layoutFrameTargetIssue(
							command.frameNodeId,
							commandPath,
							`Scene command ${index} cannot update layout: node "${command.frameNodeId}" is not a frame.`,
						),
					],
				};
			}
			return {
				compiled: {
					command: createUpdateLayoutFrameCommand(
						command.frameNodeId,
						command.patch,
					),
					target: { kind: "node", id: command.frameNodeId, path: commandPath },
				},
				issues: [],
			};
		}
		case "scene/set-layout-child-placement": {
			const frame = findNode(scene, command.frameNodeId);
			if (!frame) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-node",
							"error",
							`Scene command ${index} targets missing layout frame "${command.frameNodeId}".`,
							{ kind: "node", id: command.frameNodeId, path: commandPath },
						),
					],
				};
			}
			if (frame.frame?.kind !== "frame") {
				return {
					issues: [
						layoutFrameTargetIssue(
							command.frameNodeId,
							commandPath,
							`Scene command ${index} cannot place layout child: node "${command.frameNodeId}" is not a frame.`,
						),
					],
				};
			}
			if (!directChildNode(frame, command.childNodeId)) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-invalid-layout-child",
							"error",
							`Scene command ${index} cannot place node "${command.childNodeId}": it is not a direct child of layout frame "${command.frameNodeId}".`,
							{ kind: "node", id: command.childNodeId, path: commandPath },
						),
					],
				};
			}
			return {
				compiled: {
					command: createSetLayoutChildPlacementCommand({
						frameNodeId: command.frameNodeId,
						childNodeId: command.childNodeId,
						placement: command.placement,
					}),
					target: { kind: "node", id: command.childNodeId, path: commandPath },
				},
				issues: [],
			};
		}
		case "scene/set-layout-children-placements": {
			const frame = findNode(scene, command.frameNodeId);
			if (!frame) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-node",
							"error",
							`Scene command ${index} targets missing layout frame "${command.frameNodeId}".`,
							{ kind: "node", id: command.frameNodeId, path: commandPath },
						),
					],
				};
			}
			if (frame.frame?.kind !== "frame") {
				return {
					issues: [
						layoutFrameTargetIssue(
							command.frameNodeId,
							commandPath,
							`Scene command ${index} cannot place layout children: node "${command.frameNodeId}" is not a frame.`,
						),
					],
				};
			}
			if (command.placements.length === 0) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-empty-layout-placement",
							"error",
							`Scene command ${index} must include at least one layout child placement.`,
							{ kind: "node", id: command.frameNodeId, path: commandPath },
						),
					],
				};
			}
			const childIssues: AgentIssue[] = [];
			for (const item of command.placements) {
				if (directChildNode(frame, item.childNodeId)) continue;
				childIssues.push(
					createAgentIssue(
						"agent.scene-command-invalid-layout-child",
						"error",
						`Scene command ${index} cannot place node "${item.childNodeId}": it is not a direct child of layout frame "${command.frameNodeId}".`,
						{ kind: "node", id: item.childNodeId, path: commandPath },
					),
				);
			}
			if (childIssues.length > 0) return { issues: childIssues };
			return {
				compiled: {
					command: createSetLayoutChildrenPlacementsCommand({
						frameNodeId: command.frameNodeId,
						placements: command.placements,
					}),
					target: { kind: "node", id: command.frameNodeId, path: commandPath },
				},
				issues: [],
			};
		}
		case "scene/apply-layout-preset": {
			const frame = findNode(scene, command.frameNodeId);
			if (!frame) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-node",
							"error",
							`Scene command ${index} targets missing layout frame "${command.frameNodeId}".`,
							{ kind: "node", id: command.frameNodeId, path: commandPath },
						),
					],
				};
			}
			if (frame.frame?.kind !== "frame") {
				return {
					issues: [
						layoutFrameTargetIssue(
							command.frameNodeId,
							commandPath,
							`Scene command ${index} cannot apply layout preset: node "${command.frameNodeId}" is not a frame.`,
						),
					],
				};
			}
			return {
				compiled: {
					command: createApplyLayoutPresetCommand({
						frameNodeId: command.frameNodeId,
						preset: command.preset,
					}),
					target: { kind: "node", id: command.frameNodeId, path: commandPath },
				},
				issues: [],
			};
		}
		case "scene/pack-layout-frame": {
			const frame = findNode(scene, command.frameNodeId);
			if (!frame) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-node",
							"error",
							`Scene command ${index} targets missing layout frame "${command.frameNodeId}".`,
							{ kind: "node", id: command.frameNodeId, path: commandPath },
						),
					],
				};
			}
			if (frame.frame?.kind !== "frame") {
				return {
					issues: [
						layoutFrameTargetIssue(
							command.frameNodeId,
							commandPath,
							`Scene command ${index} cannot pack layout cells: node "${command.frameNodeId}" is not a frame.`,
						),
					],
				};
			}
			return {
				compiled: {
					command: createPackLayoutFrameCommand(command.frameNodeId),
					target: { kind: "node", id: command.frameNodeId, path: commandPath },
				},
				issues: [],
			};
		}
		case "scene/reapply-layout-frame": {
			if (!command.frameNodeId) {
				return {
					compiled: {
						command: createReapplyLayoutFrameCommand(),
						target: { kind: "document", id: scene.id, path: commandPath },
					},
					issues: [],
				};
			}
			const frame = findNode(scene, command.frameNodeId);
			if (!frame) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-node",
							"error",
							`Scene command ${index} targets missing layout frame "${command.frameNodeId}".`,
							{ kind: "node", id: command.frameNodeId, path: commandPath },
						),
					],
				};
			}
			if (frame.frame?.kind !== "frame" || !frame.frame.layout) {
				return {
					issues: [
						layoutFrameTargetIssue(
							command.frameNodeId,
							commandPath,
							`Scene command ${index} cannot reapply layout: node "${command.frameNodeId}" is not a layout frame.`,
						),
					],
				};
			}
			return {
				compiled: {
					command: createReapplyLayoutFrameCommand(command.frameNodeId),
					target: { kind: "node", id: command.frameNodeId, path: commandPath },
				},
				issues: [],
			};
		}
		case "scene/capture-arrangement-layout-snapshot": {
			const snapshot = command.snapshot;
			const target = {
				kind: "artboard",
				id: snapshot.artboardId,
				path: commandPath,
			} as const;
			if (!findArtboardById(scene, snapshot.artboardId)) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-artboard",
							"error",
							`Scene command ${index} targets missing artboard "${snapshot.artboardId}".`,
							target,
						),
					],
				};
			}
			if (
				scene.arrangementLayoutSnapshots?.some(
					(candidate) => candidate.id === snapshot.snapshotId,
				)
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.arrangement-snapshot-duplicate-id",
							"error",
							`Scene command ${index} cannot capture Arrangement snapshot "${snapshot.snapshotId}": the id already exists.`,
							target,
						),
					],
				};
			}
			if (
				snapshot.name.trim().length === 0 ||
				snapshot.captureToken.trim().length === 0
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.arrangement-snapshot-metadata-invalid",
							"error",
							`Scene command ${index} requires a non-empty Arrangement snapshot name and captureToken.`,
							target,
						),
					],
				};
			}
			const nodeIssues = arrangementSnapshotNodeIssues(
				scene,
				snapshot.artboardId,
				snapshot.nodeIds,
				index,
				`${commandPath}.snapshot.nodeIds`,
			);
			if (nodeIssues.length > 0) return { issues: nodeIssues };
			return {
				compiled: {
					command: createCaptureArrangementLayoutSnapshotCommand(snapshot),
					target,
				},
				issues: [],
			};
		}
		case "scene/recapture-arrangement-layout-snapshot": {
			const snapshot = command.snapshot;
			const previous = scene.arrangementLayoutSnapshots?.find(
				(candidate) => candidate.id === snapshot.snapshotId,
			);
			const target = {
				kind: "artboard",
				id: previous?.artboardId ?? snapshot.snapshotId,
				path: commandPath,
			} as const;
			if (!previous) {
				return {
					issues: [
						createAgentIssue(
							"agent.arrangement-snapshot-missing",
							"error",
							`Scene command ${index} cannot recapture missing Arrangement snapshot "${snapshot.snapshotId}".`,
							target,
						),
					],
				};
			}
			if (!findArtboardById(scene, previous.artboardId)) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-artboard",
							"error",
							`Scene command ${index} cannot recapture Arrangement snapshot "${snapshot.snapshotId}": artboard "${previous.artboardId}" is missing.`,
							target,
						),
					],
				};
			}
			if (
				snapshot.captureToken.trim().length === 0 ||
				snapshot.name?.trim() === ""
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.arrangement-snapshot-metadata-invalid",
							"error",
							`Scene command ${index} requires a non-empty recapture captureToken and optional non-empty name.`,
							target,
						),
					],
				};
			}
			const nodeIssues = arrangementSnapshotNodeIssues(
				scene,
				previous.artboardId,
				snapshot.nodeIds ?? previous.memberNodeIds,
				index,
				`${commandPath}.snapshot.nodeIds`,
			);
			if (nodeIssues.length > 0) return { issues: nodeIssues };
			return {
				compiled: {
					command: createRecaptureArrangementLayoutSnapshotCommand(snapshot),
					target,
				},
				issues: [],
			};
		}
		case "scene/remove-arrangement-layout-snapshot": {
			const target = {
				kind: "document",
				id: scene.id,
				path: commandPath,
			} as const;
			if (
				!scene.arrangementLayoutSnapshots?.some(
					(candidate) => candidate.id === command.snapshotId,
				)
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.arrangement-snapshot-missing",
							"error",
							`Scene command ${index} cannot remove missing Arrangement snapshot "${command.snapshotId}".`,
							target,
						),
					],
				};
			}
			return {
				compiled: {
					command: createRemoveArrangementLayoutSnapshotCommand(
						command.snapshotId,
					),
					target,
				},
				issues: [],
			};
		}
		case "scene/delete-nodes": {
			if (command.nodeIds.length === 0) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-empty-delete",
							"error",
							`Scene command ${index} must list at least one node id to delete.`,
							{ kind: "document", id: scene.id, path: commandPath },
						),
					],
				};
			}
			const missingIssues = missingSceneNodeIssues(
				scene,
				command.nodeIds,
				index,
				commandPath,
			);
			if (missingIssues.length > 0) return { issues: missingIssues };
			// createDeleteNodesCommand silently no-ops on hidden nodes and nodes with
			// a locked ancestor/layer (removeDeletableDraftNodes' policy, identical to
			// isNodeTransformable) — the command still runs and deletes the deletable
			// targets, but without this pre-check the agent would see ok:true and no
			// way to learn which requested ids were dropped and why.
			const skipIssues = command.nodeIds.flatMap((nodeId) => {
				const entry = findRenderableNodeEntry(scene, nodeId);
				const nodeTarget = {
					kind: "node",
					id: nodeId,
					path: commandPath,
				} as const;
				if (!entry) {
					return [
						createAgentIssue(
							"agent.scene-command-node-hidden",
							"warning",
							`Scene command ${index} cannot delete node "${nodeId}": it (or its layer) is hidden. Deletable targets in this command still run.`,
							nodeTarget,
						),
					];
				}
				if (entry.locked) {
					return [
						createAgentIssue(
							"agent.scene-command-node-locked",
							"warning",
							`Scene command ${index} cannot delete node "${nodeId}": it (or an ancestor/layer) is locked. Deletable targets in this command still run.`,
							nodeTarget,
						),
					];
				}
				return [];
			});
			return {
				compiled: {
					command: createDeleteNodesCommand(command.nodeIds),
					target: { kind: "node", id: command.nodeIds[0], path: commandPath },
				},
				issues: skipIssues,
			};
		}
		case "scene/add-artboard": {
			const spec = command.artboard;
			const documentTarget = {
				kind: "document",
				id: scene.id,
				path: commandPath,
			} as const;
			if (!isPositiveSize(spec.width) || spec.width <= 0 || spec.height <= 0) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-invalid-artboard",
							"error",
							`Scene command ${index} cannot add an artboard: width and height must be positive numbers.`,
							documentTarget,
						),
					],
				};
			}
			const artboardId = spec.id ?? createId("artboard");
			if (findArtboardById(scene, artboardId)) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-duplicate-artboard",
							"error",
							`Scene command ${index} cannot add artboard "${artboardId}": an artboard with that id already exists.`,
							documentTarget,
						),
					],
				};
			}
			const artboard: Artboard = {
				id: artboardId,
				name: spec.name ?? "Artboard",
				position: spec.position ?? nextArtboardPosition(scene),
				width: spec.width,
				height: spec.height,
				background: spec.background ?? "#ffffff",
				fps: spec.fps ?? DEFAULT_NEW_ARTBOARD_FPS,
				durationFrames: spec.durationFrames ?? DEFAULT_NEW_ARTBOARD_DURATION,
				...(spec.cameraSpacePolicy !== undefined
					? { cameraSpacePolicy: spec.cameraSpacePolicy }
					: {}),
			};
			return {
				compiled: {
					command: createAddArtboardCommand(artboard, { select: true }),
					target: { kind: "artboard", id: artboardId, path: commandPath },
				},
				issues: [],
			};
		}
		case "scene/update-artboard": {
			const artboardTarget = {
				kind: "artboard",
				id: command.artboardId,
				path: commandPath,
			} as const;
			if (!findArtboardById(scene, command.artboardId)) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-artboard",
							"error",
							`Scene command ${index} targets missing artboard "${command.artboardId}".`,
							artboardTarget,
						),
					],
				};
			}
			if (
				!isPositiveSize(command.patch.width) ||
				!isPositiveSize(command.patch.height)
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-invalid-artboard",
							"error",
							`Scene command ${index} cannot update artboard "${command.artboardId}": width and height must be positive numbers.`,
							artboardTarget,
						),
					],
				};
			}
			return {
				compiled: {
					command: createUpdateArtboardCommand(
						command.artboardId,
						command.patch,
					),
					target: artboardTarget,
				},
				issues: [],
			};
		}
		case "scene/add-source-optics-rig": {
			const artboard = findArtboardById(scene, command.artboardId);
			const sourceNode = findNode(scene, command.sourceNodeId);
			const sourceArtboardId =
				selectNodeArtboardMapping(scene).byNodeId[command.sourceNodeId];
			const target = {
				kind: "node",
				id: command.sourceNodeId,
				path: commandPath,
			} as const;
			if (
				!artboard ||
				!sourceNode?.visible ||
				sourceArtboardId !== command.artboardId
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-source-optics-target-missing",
							"error",
							`Scene command ${index} requires an existing artboard and source node.`,
							target,
						),
					],
				};
			}
			if (
				sourceOpticsRigsForArtboard(artboard).some(
					(rig) => rig.sourceNodeId === command.sourceNodeId,
				)
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-source-optics-owner-conflict",
							"error",
							`Source node "${command.sourceNodeId}" already owns a Source Optics rig.`,
							target,
						),
					],
				};
			}
			return {
				compiled: {
					command: createAddSourceOpticsRigCommand(
						command.artboardId,
						command.sourceNodeId,
						{
							...(command.id ? { id: command.id } : {}),
							...(command.name ? { name: command.name } : {}),
						},
					),
					target,
				},
				issues: [],
			};
		}
		case "scene/update-source-optics-rig":
		case "scene/remove-source-optics-rig": {
			const artboard = findArtboardById(scene, command.artboardId);
			const target = {
				kind: "artboard",
				id: command.artboardId,
				path: commandPath,
			} as const;
			const rig = artboard
				? sourceOpticsRigsForArtboard(artboard).filter(
						(candidate) => candidate.id === command.rigId,
					)
				: [];
			if (rig.length !== 1) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-source-optics-rig-missing",
							"error",
							`Scene command ${index} requires one unambiguous Source Optics rig "${command.rigId}".`,
							target,
						),
					],
				};
			}
			return {
				compiled: {
					command:
						command.type === "scene/update-source-optics-rig"
							? createUpdateSourceOpticsRigCommand(
									command.artboardId,
									command.rigId,
									command.patch,
								)
							: createRemoveSourceOpticsRigCommand(
									command.artboardId,
									command.rigId,
								),
					target,
				},
				issues: [],
			};
		}
		case "scene/bind-source-optics-response": {
			const artboard = findArtboardById(scene, command.artboardId);
			const targetNode = findNode(scene, command.targetNodeId);
			const targetArtboardId =
				selectNodeArtboardMapping(scene).byNodeId[command.targetNodeId];
			const target = {
				kind: "node",
				id: command.targetNodeId,
				path: commandPath,
			} as const;
			const rigs = artboard ? sourceOpticsRigsForArtboard(artboard) : [];
			const rig = rigs.filter((candidate) => candidate.id === command.rigId);
			if (
				rig.length !== 1 ||
				!targetNode?.visible ||
				targetArtboardId !== command.artboardId ||
				rig[0]?.sourceNodeId === command.targetNodeId ||
				rigs.some((candidate) =>
					candidate.responses.some(
						(response) =>
							response.enabled &&
							response.targetNodeId === command.targetNodeId,
					),
				)
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-source-optics-response-conflict",
							"error",
							`Scene command ${index} cannot bind target "${command.targetNodeId}" to rig "${command.rigId}".`,
							target,
						),
					],
				};
			}
			return {
				compiled: {
					command: createBindSourceOpticsResponseCommand(
						command.artboardId,
						command.rigId,
						command.targetNodeId,
						{
							...(command.id ? { id: command.id } : {}),
							...(command.response ? { response: command.response } : {}),
						},
					),
					target,
				},
				issues: [],
			};
		}
		case "scene/update-source-optics-response":
		case "scene/unbind-source-optics-response": {
			const artboard = findArtboardById(scene, command.artboardId);
			const rig = artboard
				? sourceOpticsRigsForArtboard(artboard).filter(
						(candidate) => candidate.id === command.rigId,
					)
				: [];
			const binding =
				rig[0]?.responses.filter(
					(response) => response.id === command.bindingId,
				) ?? [];
			const target = {
				kind: "artboard",
				id: command.artboardId,
				path: commandPath,
			} as const;
			if (rig.length !== 1 || binding.length !== 1) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-source-optics-response-missing",
							"error",
							`Scene command ${index} requires one unambiguous response "${command.bindingId}".`,
							target,
						),
					],
				};
			}
			if (
				command.type === "scene/update-source-optics-response" &&
				command.patch.enabled === true &&
				binding[0]?.enabled === false &&
				artboard &&
				sourceOpticsRigsForArtboard(artboard).some((candidate) =>
					candidate.responses.some(
						(response) =>
							response.enabled &&
							response.targetNodeId === binding[0]?.targetNodeId &&
							(candidate.id !== command.rigId ||
								response.id !== command.bindingId),
					),
				)
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-source-optics-response-conflict",
							"error",
							`Scene command ${index} cannot enable response "${command.bindingId}" because its target already has an active Source Optics owner.`,
							target,
						),
					],
				};
			}
			return {
				compiled: {
					command:
						command.type === "scene/update-source-optics-response"
							? createUpdateSourceOpticsResponseCommand(
									command.artboardId,
									command.rigId,
									command.bindingId,
									command.patch,
								)
							: createUnbindSourceOpticsResponseCommand(
									command.artboardId,
									command.rigId,
									command.bindingId,
								),
					target,
				},
				issues: [],
			};
		}
		case "scene/remove-artboard": {
			const artboardTarget = {
				kind: "artboard",
				id: command.artboardId,
				path: commandPath,
			} as const;
			if (!findArtboardById(scene, command.artboardId)) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-artboard",
							"error",
							`Scene command ${index} targets missing artboard "${command.artboardId}".`,
							artboardTarget,
						),
					],
				};
			}
			if (selectAllArtboards(scene).length <= 1) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-artboard-protected",
							"error",
							`Scene command ${index} cannot remove the last remaining artboard.`,
							artboardTarget,
						),
					],
				};
			}
			return {
				compiled: {
					command: createRemoveArtboardCommand(
						command.artboardId,
						command.fallbackArtboardId
							? { fallbackArtboardId: command.fallbackArtboardId }
							: {},
					),
					target: artboardTarget,
				},
				issues: [],
			};
		}
		case "scene/set-current-artboard": {
			const artboardTarget = {
				kind: "artboard",
				id: command.artboardId,
				path: commandPath,
			} as const;
			if (!findArtboardById(scene, command.artboardId)) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-artboard",
							"error",
							`Scene command ${index} targets missing artboard "${command.artboardId}".`,
							artboardTarget,
						),
					],
				};
			}
			return {
				compiled: {
					command: createSetCurrentArtboardCommand(command.artboardId),
					target: artboardTarget,
				},
				issues: [],
			};
		}
		case "scene/set-mask-relation-property": {
			const target = {
				kind: "node",
				id: command.contentNodeId,
				path: commandPath,
			} as const;
			if (!isMaskRelationPropertyId(command.propertyId)) {
				return {
					issues: [
						createAgentIssue(
							"agent.mask-relation-property-unknown",
							"error",
							`Scene command ${index} references unknown mask relation property "${command.propertyId}".`,
							target,
						),
					],
				};
			}
			// Finite-only: the per-property setter owns range semantics
			// (featherRadius/opacity clamp, expand is signed, invert reads 0|1), so a
			// blanket non-negative gate here would wrongly reject expand erode.
			if (!Number.isFinite(command.value)) {
				return {
					issues: [
						createAgentIssue(
							"agent.mask-relation-property-value-invalid",
							"error",
							`Scene command ${index} must set "${command.propertyId}" to a finite number.`,
							target,
						),
					],
				};
			}
			const nodeLookup = requireSceneNode(
				scene,
				command.contentNodeId,
				index,
				target,
			);
			if (!nodeLookup.node) return { issues: nodeLookup.issues };
			const node = nodeLookup.node;
			const relation = readAppearanceMaskRelations(node).find(
				(candidate) => candidate.id === command.relationId,
			);
			if (!relation) {
				return {
					issues: [
						createAgentIssue(
							"agent.mask-relation-missing",
							"error",
							`Scene command ${index} targets missing mask relation "${command.relationId}" on node "${command.contentNodeId}".`,
							target,
						),
					],
				};
			}
			if (relation.origin !== "native" || !relation.maskNodeId) {
				return {
					issues: [
						createAgentIssue(
							"agent.mask-relation-not-native",
							"error",
							`Scene command ${index} can only edit native scene-node mask relations.`,
							target,
						),
					],
				};
			}
			return {
				compiled: {
					command: createSetMaskRelationPropertyCommand(
						command.contentNodeId,
						command.relationId,
						command.propertyId,
						command.value,
					),
					target,
				},
				issues: [],
			};
		}
		case "scene/set-bindable-property": {
			const descriptor = bindablePropertyById(command.propertyId);
			if (!descriptor) {
				return {
					issues: [
						createAgentIssue(
							"agent.bindable-property-unknown",
							"error",
							`Scene command ${index} references unknown bindable property "${command.propertyId}".`,
							{ kind: "node", id: command.nodeId, path: commandPath },
						),
					],
				};
			}
			if (!descriptor.control.agentWritable) {
				return {
					issues: [
						createAgentIssue(
							"agent.bindable-property-not-agent-writable",
							"error",
							`Scene command ${index} cannot write non-agent-writable bindable property "${command.propertyId}".`,
							{ kind: "node", id: command.nodeId, path: commandPath },
						),
					],
				};
			}
			const source = descriptor.source;
			const nodeLookup = requireSceneNode(scene, command.nodeId, index, {
				kind: "node",
				id: command.nodeId,
				path: commandPath,
			});
			if (!nodeLookup.node) return { issues: nodeLookup.issues };
			const node = nodeLookup.node;
			if (source.kind === "effect-capability") {
				return compileEffectBindableSceneCommand(
					source,
					node,
					command.value,
					index,
					commandPath,
					batchState,
				);
			}
			if (source.kind === "duplicate-generator") {
				return compileDuplicateGeneratorBindableSceneCommand(
					scene,
					source,
					node,
					command.value,
					commandPath,
					batchState,
				);
			}
			if (source.kind === "scene-camera") {
				return {
					issues: [
						createAgentIssue(
							"agent.bindable-property-camera-source-unsupported",
							"error",
							`Scene command ${index} cannot write camera-rig property "${command.propertyId}" with scene/set-bindable-property; use motion/upsert-camera-keyframe (cameraRigId + property) instead.`,
							{ kind: "node", id: command.nodeId, path: commandPath },
						),
					],
				};
			}
			// Delegate to the equivalent typed scene command so geometry eligibility
			// (corner radius only on roundable shapes, per-corner only on rects) and
			// node checks stay owned by the existing compilers and cannot drift.
			return compileAgentSceneCommand(
				scene,
				motion,
				sceneCommandForBindablePath(
					source.path,
					command.nodeId,
					command.value,
					node,
				),
				index,
				undefined,
				grammarTargetNodeIds,
			);
		}
		case "scene/set-bindable-expression": {
			const descriptor = bindablePropertyById(command.propertyId);
			const target = {
				kind: "node",
				id: command.nodeId,
				path: commandPath,
			} as const;
			if (!descriptor) {
				return {
					issues: [
						createAgentIssue(
							"agent.bindable-property-unknown",
							"error",
							`Scene command ${index} references unknown bindable property "${command.propertyId}".`,
							target,
						),
					],
				};
			}
			if (!descriptor.control.expressionBindable) {
				return {
					issues: [
						createAgentIssue(
							"agent.bindable-expression-not-supported",
							"error",
							`Scene command ${index} cannot bind an expression to non-expression-bindable property "${command.propertyId}".`,
							target,
						),
					],
				};
			}
			const nodeLookup = requireSceneNode(scene, command.nodeId, index, target);
			if (!nodeLookup.node) return { issues: nodeLookup.issues };
			const node = nodeLookup.node;
			const source = descriptor.source;
			if (source.kind === "effect-capability") {
				return compileEffectBindableExpressionSceneCommand(
					source,
					node,
					command.expression,
					index,
					commandPath,
				);
			}
			if (source.kind === "duplicate-generator") {
				return compileDuplicateGeneratorExpressionSceneCommand(
					scene,
					source,
					node,
					command.expression,
					index,
					commandPath,
					batchState,
				);
			}
			if (source.kind === "scene-property") {
				return compileNativeBindableExpressionSceneCommand(
					descriptor.id,
					node,
					command.expression,
					index,
					commandPath,
				);
			}
			const unsupportedKind = (source as { readonly kind: string }).kind;
			return {
				issues: [
					createAgentIssue(
						"agent.bindable-expression-source-unsupported",
						"error",
						`Scene command ${index} cannot bind expressions to ${unsupportedKind} property "${command.propertyId}".`,
						target,
					),
				],
			};
		}
		case "scene/clear-bindable-expression": {
			const descriptor = bindablePropertyById(command.propertyId);
			const target = {
				kind: "node",
				id: command.nodeId,
				path: commandPath,
			} as const;
			if (!descriptor) {
				return {
					issues: [
						createAgentIssue(
							"agent.bindable-property-unknown",
							"error",
							`Scene command ${index} references unknown bindable property "${command.propertyId}".`,
							target,
						),
					],
				};
			}
			if (!descriptor.control.expressionBindable) {
				return {
					issues: [
						createAgentIssue(
							"agent.bindable-expression-not-supported",
							"error",
							`Scene command ${index} cannot clear an expression for non-expression-bindable property "${command.propertyId}".`,
							target,
						),
					],
				};
			}
			const nodeLookup = requireSceneNode(scene, command.nodeId, index, target);
			if (!nodeLookup.node) return { issues: nodeLookup.issues };
			const node = nodeLookup.node;
			const source = descriptor.source;
			if (source.kind === "effect-capability") {
				return compileClearEffectBindableExpressionSceneCommand(
					source,
					node,
					index,
					commandPath,
				);
			}
			if (source.kind === "duplicate-generator") {
				return compileClearDuplicateGeneratorExpressionSceneCommand(
					scene,
					source,
					node,
					commandPath,
					batchState,
				);
			}
			if (source.kind === "scene-property") {
				return compileClearNativeBindableExpressionSceneCommand(
					descriptor.id,
					node,
					index,
					commandPath,
				);
			}
			const unsupportedKind = (source as { readonly kind: string }).kind;
			return {
				issues: [
					createAgentIssue(
						"agent.bindable-expression-source-unsupported",
						"error",
						`Scene command ${index} cannot clear expressions from ${unsupportedKind} property "${command.propertyId}".`,
						target,
					),
				],
			};
		}
		case "scene/set-bindable-effect-property": {
			const issueTarget = issueTargetForBindableEffectTarget(
				scene,
				command.target,
				commandPath,
			);
			const descriptor = bindablePropertyById(command.propertyId);
			if (!descriptor) {
				return {
					issues: [
						createAgentIssue(
							"agent.bindable-property-unknown",
							"error",
							`Scene command ${index} references unknown bindable property "${command.propertyId}".`,
							issueTarget,
						),
					],
				};
			}
			if (!descriptor.control.agentWritable) {
				return {
					issues: [
						createAgentIssue(
							"agent.bindable-property-not-agent-writable",
							"error",
							`Scene command ${index} cannot write non-agent-writable bindable property "${command.propertyId}".`,
							issueTarget,
						),
					],
				};
			}
			if (descriptor.source.kind !== "effect-capability") {
				return {
					issues: [
						createAgentIssue(
							"agent.bindable-property-effect-source-required",
							"error",
							`Scene command ${index} cannot set non-effect bindable property "${command.propertyId}" with scene/set-bindable-effect-property.`,
							issueTarget,
						),
					],
				};
			}
			return compileFrameEffectBindableSceneCommand(
				scene,
				descriptor.source,
				command.target,
				command.value,
				index,
				commandPath,
				batchState,
			);
		}
		case "scene/patch-effect-stack":
			return compileEffectLayerStackOperationSceneCommand(
				scene,
				command.target,
				command.operation,
				index,
				commandPath,
				batchState,
			);
		case "scene/patch-effect-field": {
			const issueTarget = issueTargetForBindableEffectTarget(
				scene,
				command.target,
				commandPath,
			);
			const precompiled =
				batchState?.effectFieldCompilesByCommandIndex.get(index);
			if (!precompiled) {
				return {
					issues: [
						createAgentIssue(
							"agent.effect-field-batch-state-missing",
							"error",
							`Scene command ${index} could not resolve batched Effect Field state.`,
							issueTarget,
						),
					],
				};
			}
			if (precompiled.issues.length > 0 || !precompiled.recipe) {
				return { issues: precompiled.issues };
			}
			return {
				compiled: {
					command: createUpdateEffectIntentCommand(
						effectIntentTargetForBindableTarget(command.target),
						{ influenceRecipe: precompiled.recipe },
						{ label: "Edit Effect Field" },
					),
					target: issueTarget,
				},
				issues: [],
			};
		}
		case "scene/set-effect-layer-property":
			return compileEffectLayerPropertySceneCommand(
				scene,
				command.target,
				command.layerId,
				command.propertyId,
				command.value,
				index,
				commandPath,
				batchState,
			);
		case "scene/patch-look-graph": {
			// The batch pass owns look-graph accumulation + per-op pre-state
			// validation; this case is a thin lookup that turns the precomputed
			// cumulative graph into a SET command (last-wins across same-target ops).
			const precompiled =
				batchState?.lookGraphCompilesByCommandIndex.get(index);
			if (!precompiled) {
				return {
					issues: [
						createAgentIssue(
							"agent.look-graph-batch-state-missing",
							"error",
							`Scene command ${index} could not resolve batched look-graph state.`,
							issueTargetForLookGraphTarget(scene, command.target, commandPath),
						),
					],
				};
			}
			if (precompiled.issues.length > 0) {
				return { issues: precompiled.issues };
			}
			const owner = lookGraphOwnerForTarget(scene, command.target);
			if (
				!owner ||
				(command.target.scope === "scoped-overlay" && !precompiled.graph)
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.look-graph-target-missing",
							"error",
							`Scene command ${index} targets a missing or empty scoped look graph.`,
							issueTargetForLookGraphTarget(scene, command.target, commandPath),
						),
					],
				};
			}
			const target = issueTargetForLookGraphTarget(
				scene,
				command.target,
				commandPath,
			);
			if (command.target.scope === "scoped-overlay") {
				if (owner.scope !== "scoped-overlay" || !precompiled.graph) {
					return {
						issues: [
							createAgentIssue(
								"agent.look-graph-target-missing",
								"error",
								`Scene command ${index} targets a missing or empty scoped look graph.`,
								target,
							),
						],
					};
				}
				return {
					compiled: {
						command: createSetScopedLookGraphOverlayCommand(
							owner.artboardId,
							owner.scopedLookId,
							precompiled.graph,
							{ label: "Edit scoped look graph" },
						),
						target,
					},
					issues: [],
				};
			}
			return {
				compiled: {
					command: createSetLookGraphCommand(
						effectIntentTargetForBindableTarget(command.target),
						precompiled.graph ?? null,
						{ label: "Edit look graph" },
					),
					target,
				},
				issues: [],
			};
		}
		case "scene/set-bindable-effect-expression": {
			const issueTarget = issueTargetForBindableEffectTarget(
				scene,
				command.target,
				commandPath,
			);
			const descriptor = bindablePropertyById(command.propertyId);
			if (!descriptor) {
				return {
					issues: [
						createAgentIssue(
							"agent.bindable-property-unknown",
							"error",
							`Scene command ${index} references unknown bindable property "${command.propertyId}".`,
							issueTarget,
						),
					],
				};
			}
			if (!descriptor.control.expressionBindable) {
				return {
					issues: [
						createAgentIssue(
							"agent.bindable-expression-not-supported",
							"error",
							`Scene command ${index} cannot bind an expression to non-expression-bindable property "${command.propertyId}".`,
							issueTarget,
						),
					],
				};
			}
			if (descriptor.source.kind !== "effect-capability") {
				return {
					issues: [
						createAgentIssue(
							"agent.bindable-property-effect-source-required",
							"error",
							`Scene command ${index} cannot bind a frame effect expression to non-effect bindable property "${command.propertyId}".`,
							issueTarget,
						),
					],
				};
			}
			return compileFrameEffectExpressionSceneCommand(
				scene,
				descriptor.source,
				command.target,
				command.expression,
				index,
				commandPath,
			);
		}
		case "scene/clear-bindable-effect-expression": {
			const issueTarget = issueTargetForBindableEffectTarget(
				scene,
				command.target,
				commandPath,
			);
			const descriptor = bindablePropertyById(command.propertyId);
			if (!descriptor) {
				return {
					issues: [
						createAgentIssue(
							"agent.bindable-property-unknown",
							"error",
							`Scene command ${index} references unknown bindable property "${command.propertyId}".`,
							issueTarget,
						),
					],
				};
			}
			if (!descriptor.control.expressionBindable) {
				return {
					issues: [
						createAgentIssue(
							"agent.bindable-expression-not-supported",
							"error",
							`Scene command ${index} cannot clear an expression for non-expression-bindable property "${command.propertyId}".`,
							issueTarget,
						),
					],
				};
			}
			if (descriptor.source.kind !== "effect-capability") {
				return {
					issues: [
						createAgentIssue(
							"agent.bindable-property-effect-source-required",
							"error",
							`Scene command ${index} cannot clear a frame effect expression from non-effect bindable property "${command.propertyId}".`,
							issueTarget,
						),
					],
				};
			}
			return compileClearFrameEffectExpressionSceneCommand(
				scene,
				descriptor.source,
				command.target,
				index,
				commandPath,
			);
		}
		case "scene/reparent-nodes": {
			const nodeIds = [...new Set(command.nodeIds)];
			if (nodeIds.length === 0) {
				return {
					issues: [
						createAgentIssue(
							"agent.reparent-empty-source",
							"error",
							`Scene command ${index} must list at least one node id to reparent.`,
							{ kind: "document", id: scene.id, path: commandPath },
						),
					],
				};
			}
			const missingIssues = missingSceneNodeIssues(
				scene,
				nodeIds,
				index,
				commandPath,
			);
			if (missingIssues.length > 0) return { issues: missingIssues };
			let destParent: VectorNode | undefined;
			if (command.targetParentNodeId !== null) {
				destParent = findNode(scene, command.targetParentNodeId);
				if (!destParent) {
					return {
						issues: [
							createAgentIssue(
								"agent.scene-command-missing-node",
								"error",
								`Scene command ${index} targets missing destination parent node "${command.targetParentNodeId}".`,
								{
									kind: "node",
									id: command.targetParentNodeId,
									path: commandPath,
								},
							),
						],
					};
				}
				if (destParent.locked) {
					return {
						issues: [
							createAgentIssue(
								"agent.scene-command-node-locked",
								"error",
								`Scene command ${index} cannot reparent into locked node "${command.targetParentNodeId}".`,
								{
									kind: "node",
									id: command.targetParentNodeId,
									path: commandPath,
								},
							),
						],
					};
				}
				if (!destParent.children && !isFrameNode(destParent)) {
					return {
						issues: [
							createAgentIssue(
								"agent.reparent-not-a-container",
								"error",
								`Scene command ${index} cannot reparent into "${command.targetParentNodeId}": only a frame or a node that already has children can receive children.`,
								{
									kind: "node",
									id: command.targetParentNodeId,
									path: commandPath,
								},
							),
						],
					};
				}
			}
			const targetLayerId =
				command.targetLayerId ??
				(destParent
					? findLayerByNodeId(scene, destParent.id)?.id
					: findLayerByNodeId(scene, nodeIds[0] as string)?.id);
			if (!targetLayerId) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-layer",
							"error",
							`Scene command ${index} could not resolve a destination layer id; pass "targetLayerId" explicitly.`,
							{ kind: "document", id: scene.id, path: commandPath },
						),
					],
				};
			}
			const destLayer = scene.layers.find(
				(layer) => layer.id === targetLayerId,
			);
			if (!destLayer) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-layer",
							"error",
							`Scene command ${index} targets missing layer "${targetLayerId}".`,
							{ kind: "layer", id: targetLayerId, path: commandPath },
						),
					],
				};
			}
			if (destLayer.locked) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-node-locked",
							"error",
							`Scene command ${index} cannot reparent into locked layer "${targetLayerId}".`,
							{ kind: "layer", id: targetLayerId, path: commandPath },
						),
					],
				};
			}
			const subtreesByNodeId = new Map<string, ReadonlySet<string>>();
			for (const nodeId of nodeIds) {
				const node = findNode(scene, nodeId);
				if (!node) continue;
				const subtree = new Set<string>();
				collectNodeSubtreeIds(node, subtree);
				subtreesByNodeId.set(nodeId, subtree);
			}
			const cycleIssues: AgentIssue[] = [];
			if (destParent) {
				for (const [nodeId, subtree] of subtreesByNodeId) {
					if (subtree.has(destParent.id)) {
						cycleIssues.push(
							createAgentIssue(
								"agent.reparent-cycle",
								"error",
								`Scene command ${index} cannot reparent "${nodeId}" into "${destParent.id}": the destination is the node itself or one of its own descendants.`,
								{ kind: "node", id: nodeId, path: commandPath },
							),
						);
					}
				}
			}
			if (cycleIssues.length > 0) return { issues: cycleIssues };
			const lockedIssues: AgentIssue[] = [];
			for (const nodeId of nodeIds) {
				const node = findNode(scene, nodeId);
				const layer = findLayerByNodeId(scene, nodeId);
				if (node?.locked || layer?.locked) {
					lockedIssues.push(
						createAgentIssue(
							"agent.scene-command-node-locked",
							"error",
							`Scene command ${index} cannot reparent locked node "${nodeId}" (or its layer is locked).`,
							{ kind: "node", id: nodeId, path: commandPath },
						),
					);
				}
			}
			if (lockedIssues.length > 0) return { issues: lockedIssues };
			return {
				compiled: {
					command: createReparentNodesCommand(nodeIds, {
						targetParentNodeId: command.targetParentNodeId,
						targetLayerId,
						toIndex: command.toIndex ?? destLayer.nodes.length,
					}),
					target: { kind: "node", id: nodeIds[0], path: commandPath },
				},
				issues: [],
			};
		}
		case "scene/frame-nodes": {
			const sourceNodeIds = [...new Set(command.sourceNodeIds)];
			if (sourceNodeIds.length === 0) {
				return {
					issues: [
						createAgentIssue(
							"agent.frame-empty-source",
							"error",
							`Scene command ${index} must list at least one node id to wrap in a frame.`,
							{ kind: "document", id: scene.id, path: commandPath },
						),
					],
				};
			}
			const missingIssues = missingSceneNodeIssues(
				scene,
				sourceNodeIds,
				index,
				commandPath,
			);
			if (missingIssues.length > 0) return { issues: missingIssues };
			const layerId =
				command.layerId ??
				findLayerByNodeId(scene, sourceNodeIds[0] as string)?.id;
			if (!layerId) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-layer",
							"error",
							`Scene command ${index} could not resolve a source layer id; pass "layerId" explicitly.`,
							{ kind: "document", id: scene.id, path: commandPath },
						),
					],
				};
			}
			const layer = scene.layers.find((item) => item.id === layerId);
			if (!layer) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-layer",
							"error",
							`Scene command ${index} targets missing layer "${layerId}".`,
							{ kind: "layer", id: layerId, path: commandPath },
						),
					],
				};
			}
			const nonTopLevelIds = sourceNodeIds.filter(
				(nodeId) => !layer.nodes.some((node) => node.id === nodeId),
			);
			if (nonTopLevelIds.length > 0) {
				return {
					issues: nonTopLevelIds.map((nodeId) =>
						createAgentIssue(
							"agent.frame-source-not-top-level",
							"error",
							`Scene command ${index} cannot wrap "${nodeId}" in a frame: it is not a top-level node in layer "${layerId}".`,
							{ kind: "node", id: nodeId, path: commandPath },
						),
					),
				};
			}
			const frameNodeId = command.frameNodeId ?? createId("frame");
			if (findNode(scene, frameNodeId)) {
				return {
					issues: [
						createAgentIssue(
							"agent.frame-node-id-collision",
							"error",
							`Scene command ${index} cannot create frame "${frameNodeId}": a node with that id already exists.`,
							{ kind: "node", id: frameNodeId, path: commandPath },
						),
					],
				};
			}
			return {
				compiled: {
					command: createFrameNodesCommand({
						layerId,
						frameNodeId,
						sourceNodeIds,
						name: command.name,
						clipsContent: command.clipsContent,
						artboardId: command.artboardId,
					}),
					target: { kind: "node", id: frameNodeId, path: commandPath },
				},
				issues: [],
			};
		}
		case "scene/unframe-node": {
			const target = {
				kind: "node",
				id: command.frameNodeId,
				path: commandPath,
			} as const;
			const frameNodeLookup = requireSceneNode(
				scene,
				command.frameNodeId,
				index,
				target,
			);
			if (!frameNodeLookup.node) return { issues: frameNodeLookup.issues };
			const frameNode = frameNodeLookup.node;
			if (!isFrameNode(frameNode)) {
				return {
					issues: [
						createAgentIssue(
							"agent.unframe-not-a-frame",
							"error",
							`Scene command ${index} cannot unframe "${command.frameNodeId}": it is not a frame container node.`,
							target,
						),
					],
				};
			}
			if (!isTopLevelSceneNode(scene, command.frameNodeId)) {
				return {
					issues: [
						createAgentIssue(
							"agent.unframe-not-top-level",
							"error",
							`Scene command ${index} cannot unframe "${command.frameNodeId}": it is not a top-level node.`,
							target,
						),
					],
				};
			}
			const layer = findLayerByNodeId(scene, command.frameNodeId);
			if (!layer) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-layer",
							"error",
							`Scene command ${index} could not resolve the owning layer for frame "${command.frameNodeId}".`,
							target,
						),
					],
				};
			}
			return {
				compiled: {
					command: createUnframeNodeCommand({
						layerId: layer.id,
						frameNodeId: command.frameNodeId,
					}),
					target,
				},
				issues: [],
			};
		}
		case "scene/group-nodes": {
			const result = buildGroupNodesCommand(scene, command.nodeIds);
			if (!result.ok) {
				return {
					issues: result.issues.map((groupingIssue) =>
						createAgentIssue(
							`agent.grouping-${groupingIssue.code.slice("grouping.".length)}`,
							"error",
							`Scene command ${index}: ${groupingIssue.message}`,
							{
								kind: "node",
								id: groupingIssue.sourceId,
								path: commandPath,
							},
						),
					),
				};
			}
			return {
				compiled: {
					command: result.command,
					target: {
						kind: "node",
						id: result.groupNodeId,
						path: commandPath,
					},
				},
				issues: [],
			};
		}
		case "scene/ungroup-node": {
			const result = buildUngroupNodeCommand(scene, command.groupNodeId);
			if (!result.ok) {
				return {
					issues: result.issues.map((groupingIssue) =>
						createAgentIssue(
							`agent.grouping-${groupingIssue.code.slice("grouping.".length)}`,
							"error",
							`Scene command ${index}: ${groupingIssue.message}`,
							{
								kind: "node",
								id: groupingIssue.sourceId ?? command.groupNodeId,
								path: commandPath,
							},
						),
					),
				};
			}
			return {
				compiled: {
					command: result.command,
					target: {
						kind: "node",
						id: command.groupNodeId,
						path: commandPath,
					},
				},
				issues: [],
			};
		}
		case "scene/use-node-as-mask": {
			const target = {
				kind: "node",
				id: command.maskNodeId,
				path: commandPath,
			} as const;
			const maskNode = findNode(scene, command.maskNodeId);
			if (!maskNode) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-node",
							"error",
							`Scene command ${index} targets missing mask source node "${command.maskNodeId}".`,
							target,
						),
					],
				};
			}
			const maskLayer = findLayerByNodeId(scene, command.maskNodeId);
			if (!maskLayer || maskLayer.locked || !maskLayer.visible) {
				return {
					issues: [
						createAgentIssue(
							"agent.mask-source-not-editable",
							"error",
							`Scene command ${index} cannot use "${command.maskNodeId}" as a mask: its layer is missing, locked, or hidden.`,
							target,
						),
					],
				};
			}
			const contentNodeIds = [...new Set(command.contentNodeIds)].filter(
				(contentNodeId) => contentNodeId !== command.maskNodeId,
			);
			const maskArtboardId = selectArtboardIdForNode(scene, command.maskNodeId);
			const validTargets = contentNodeIds.filter((contentNodeId) => {
				const content = findNode(scene, contentNodeId);
				const contentLayer = findLayerByNodeId(scene, contentNodeId);
				return (
					content?.visible === true &&
					content.locked === false &&
					contentLayer?.visible === true &&
					!contentLayer.locked &&
					selectArtboardIdForNode(scene, contentNodeId) === maskArtboardId
				);
			});
			if (validTargets.length === 0) {
				return {
					issues: [
						createAgentIssue(
							"agent.mask-no-valid-content",
							"error",
							`Scene command ${index} cannot use "${command.maskNodeId}" as a mask: no requested editable content node is in the same artboard.`,
							target,
						),
					],
				};
			}
			return {
				compiled: {
					command: createUseNodeAsMaskCommand(
						command.maskNodeId,
						validTargets,
						command.kind ? { kind: command.kind } : {},
					),
					target,
				},
				issues: [],
			};
		}
		case "scene/author-object-noise-gradient": {
			const target = {
				kind: "node",
				id: command.nodeId,
				path: commandPath,
			} as const;
			const node = findNode(scene, command.nodeId);
			if (!node) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-node",
							"error",
							`Scene command ${index} targets missing node "${command.nodeId}".`,
							target,
						),
					],
				};
			}
			if (
				command.blendMode !== undefined &&
				!(TEXTURE_MATERIAL_BLEND_MODES as readonly string[]).includes(
					command.blendMode,
				)
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-invalid-blend-mode",
							"error",
							`Scene command ${index} has invalid blendMode "${command.blendMode}".`,
							target,
						),
					],
				};
			}
			if (
				command.revealPaint !== undefined &&
				command.revealPaint.kind !== "solid" &&
				command.revealPaint.kind !== "linear-gradient" &&
				command.revealPaint.kind !== "radial-gradient"
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-invalid-reveal-paint",
							"error",
							`Scene command ${index} has invalid revealPaint kind "${(command.revealPaint as { readonly kind?: string }).kind}" — only "solid", "linear-gradient", or "radial-gradient" are accepted (an image or mesh reveal has no clean single-element underlay rendering).`,
							target,
						),
					],
				};
			}
			if (
				command.mode !== undefined &&
				command.mode !== "particle" &&
				command.mode !== "mixed"
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-invalid-mode",
							"error",
							`Scene command ${index} has invalid mode "${command.mode}" — only "particle" or "mixed" are accepted.`,
							target,
						),
					],
				};
			}
			const blendMode = (command.blendMode ??
				NOISE_GRADIENT_FRESH_ENABLE_BLEND_MODE) as TextureMaterialBlendMode;
			const base = normalizeVisualRecipe(node.recipe);
			const amount = command.amount ?? OBJECT_NOISE_GRADIENT_DEFAULT_AMOUNT;
			const fieldMode = command.fieldMode ?? "linear";
			const linearField = command.linearField;
			const mode = command.mode ?? "particle";
			const targetRecipe = normalizeVisualRecipe({
				...base,
				texture: {
					grain: {
						...base.texture.grain,
						enabled: true,
						strength:
							mode === "mixed"
								? (command.grainStrength ??
									OBJECT_NOISE_GRADIENT_DEFAULT_MIXED_GRAIN)
								: (command.grainStrength ?? amount),
						densityCoupling: amount,
					},
					material: {
						...base.texture.material,
						mode,
						fieldMode,
						strength:
							command.materialStrength ?? NOISE_GRADIENT_DEFAULT_STRENGTH,
						particleContrast:
							command.particleContrast ?? NOISE_GRADIENT_DEFAULT_CONTRAST,
						blendMode,
						...(command.overlayColor !== undefined
							? { overlayColor: command.overlayColor }
							: {}),
						...(fieldMode === "linear"
							? {
									linearField: {
										kind: "linear",
										space: "target",
										x1: linearField?.x1 ?? 0.1,
										y1: linearField?.y1 ?? 0.9,
										x2: linearField?.x2 ?? 0.9,
										y2: linearField?.y2 ?? 0.1,
										plateau: linearField?.plateau ?? 0.1,
									},
								}
							: {}),
					},
				},
			});
			const setRecipe = createUpdateNodeRecipeCommand(
				command.nodeId,
				targetRecipe,
			);
			const convert = createConvertNodeNoiseGradientToScopedLookGraphCommand(
				command.nodeId,
				{
					refreshFromRecipe: true,
					...(command.revealPaint ? { revealPaint: command.revealPaint } : {}),
				},
			);
			return {
				compiled: {
					command: {
						type: "scene/author-object-noise-gradient",
						label: "Author object Noise Gradient",
						run: (draft) => {
							setRecipe.run(draft);
							convert.run(draft);
						},
					},
					target,
				},
				issues: [],
			};
		}
		case "scene/release-mask": {
			return {
				compiled: {
					command: createReleaseMaskCommand(command.maskNodeId),
					target: {
						kind: "node",
						id: command.maskNodeId,
						path: commandPath,
					},
				},
				issues: [],
			};
		}
		case "scene/set-mask-relation-settings": {
			const target = {
				kind: "node",
				id: command.contentNodeId,
				path: commandPath,
			} as const;
			const nodeLookup = requireSceneNode(
				scene,
				command.contentNodeId,
				index,
				target,
			);
			if (!nodeLookup.node) return { issues: nodeLookup.issues };
			if (
				command.kind !== "clip-path" &&
				command.kind !== "mask" &&
				command.kind !== "soft-mask"
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.mask-relation-kind-invalid",
							"error",
							`Scene command ${index} references unknown mask relation kind "${command.kind}".`,
							target,
						),
					],
				};
			}
			if (!command.maskNodeId && !command.value) {
				return {
					issues: [
						createAgentIssue(
							"agent.mask-relation-source-missing",
							"error",
							`Scene command ${index} must set either "maskNodeId" or "value" to identify the mask relation's source.`,
							target,
						),
					],
				};
			}
			const settings = command.settings;
			if (settings?.featherRadius !== undefined && settings.featherRadius < 0) {
				return {
					issues: [
						createAgentIssue(
							"agent.mask-relation-property-value-invalid",
							"error",
							`Scene command ${index} must set "settings.featherRadius" to a number >= 0.`,
							target,
						),
					],
				};
			}
			if (
				settings?.opacity !== undefined &&
				(settings.opacity < 0 || settings.opacity > 1)
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.mask-relation-property-value-invalid",
							"error",
							`Scene command ${index} must set "settings.opacity" to a number between 0 and 1.`,
							target,
						),
					],
				};
			}
			if (settings?.expand !== undefined && !Number.isFinite(settings.expand)) {
				return {
					issues: [
						createAgentIssue(
							"agent.mask-relation-property-value-invalid",
							"error",
							`Scene command ${index} must set "settings.expand" to a finite number.`,
							target,
						),
					],
				};
			}
			if (
				settings?.channel !== undefined &&
				settings.channel !== "alpha" &&
				settings.channel !== "luminance" &&
				settings.channel !== "red" &&
				settings.channel !== "green" &&
				settings.channel !== "blue"
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.mask-relation-property-value-invalid",
							"error",
							`Scene command ${index} must set "settings.channel" to alpha, luminance, red, green, or blue.`,
							target,
						),
					],
				};
			}
			if (
				settings?.sourceSampling !== undefined &&
				settings.sourceSampling !== "pre-effects" &&
				settings.sourceSampling !== "post-effects"
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.mask-relation-property-value-invalid",
							"error",
							`Scene command ${index} must set "settings.sourceSampling" to "pre-effects" or "post-effects".`,
							target,
						),
					],
				};
			}
			return {
				compiled: {
					command: createSetNodeMaskRelationCommand(command.contentNodeId, {
						id: command.relationId,
						kind: command.kind,
						maskNodeId: command.maskNodeId,
						value: command.value,
						settings,
					}),
					target,
				},
				issues: [],
			};
		}
		case "scene/add-style-preset": {
			const target = {
				kind: "document",
				id: scene.id,
				path: commandPath,
			} as const;
			const preview = normalizeStylePreset({
				id: command.options?.id ?? "preview",
				name: command.options?.name ?? "Preview",
				kind: command.options?.kind ?? "node",
				paint: command.options?.paint,
				typography: command.options?.typography,
				appearance: command.options?.appearance,
			});
			if (!preview) {
				return {
					issues: [
						createAgentIssue(
							"agent.style-preset-empty-payload",
							"error",
							`Scene command ${index} cannot add a style preset: the payload has no usable paint, typography, or appearance part.`,
							target,
						),
					],
				};
			}
			return {
				compiled: {
					command: createAddStylePresetCommand(
						command.options ?? {},
						command.label ? { label: command.label } : {},
					),
					target,
				},
				issues: [],
			};
		}
		case "scene/insert-style-preset": {
			const target = {
				kind: "document",
				id: scene.id,
				path: commandPath,
			} as const;
			const normalized = normalizeStylePreset(command.preset);
			if (!normalized) {
				return {
					issues: [
						createAgentIssue(
							"agent.style-preset-empty-payload",
							"error",
							`Scene command ${index} cannot insert a style preset: the payload has no usable paint, typography, or appearance part, or is missing an id/name.`,
							target,
						),
					],
				};
			}
			const existing = readStylePresets(scene);
			if (existing.some((preset) => preset.id === normalized.id)) {
				return {
					issues: [
						createAgentIssue(
							"agent.style-preset-id-collision",
							"error",
							`Scene command ${index} cannot insert style preset "${normalized.id}": a preset with that id already exists.`,
							target,
						),
					],
				};
			}
			if (existing.some((preset) => preset.name === normalized.name)) {
				return {
					issues: [
						createAgentIssue(
							"agent.style-preset-name-collision",
							"error",
							`Scene command ${index} cannot insert style preset "${normalized.name}": a preset with that name already exists.`,
							target,
						),
					],
				};
			}
			return {
				compiled: {
					command: createInsertStylePresetCommand(command.preset),
					target,
				},
				issues: [],
			};
		}
		case "scene/apply-style-preset": {
			const target = {
				kind: "document",
				id: scene.id,
				path: commandPath,
			} as const;
			const preset = readStylePresets(scene).find(
				(candidate) => candidate.id === command.presetId,
			);
			if (!preset) {
				return {
					issues: [
						createAgentIssue(
							"agent.style-preset-missing",
							"error",
							`Scene command ${index} targets missing style preset "${command.presetId}".`,
							target,
						),
					],
				};
			}
			const nodeIds = [...new Set(command.nodeIds)];
			if (nodeIds.length === 0) {
				return {
					issues: [
						createAgentIssue(
							"agent.style-preset-empty-target",
							"error",
							`Scene command ${index} must list at least one node id to apply style preset "${command.presetId}" to.`,
							target,
						),
					],
				};
			}
			const missingIssues = missingSceneNodeIssues(
				scene,
				nodeIds,
				index,
				commandPath,
			);
			if (missingIssues.length > 0) return { issues: missingIssues };
			return {
				compiled: {
					command: createApplyStylePresetCommand(command.presetId, nodeIds, {
						...(command.label ? { label: command.label } : {}),
						grammarTargetNodeIds,
						motion,
					}),
					target: { kind: "node", id: nodeIds[0], path: commandPath },
				},
				issues: [],
			};
		}
		case "scene/rename-style-preset": {
			const target = {
				kind: "document",
				id: scene.id,
				path: commandPath,
			} as const;
			const presets = readStylePresets(scene);
			const preset = presets.find(
				(candidate) => candidate.id === command.presetId,
			);
			if (!preset) {
				return {
					issues: [
						createAgentIssue(
							"agent.style-preset-missing",
							"error",
							`Scene command ${index} targets missing style preset "${command.presetId}".`,
							target,
						),
					],
				};
			}
			const nextName = command.name.trim();
			if (nextName.length === 0) {
				return {
					issues: [
						createAgentIssue(
							"agent.style-preset-blank-name",
							"error",
							`Scene command ${index} cannot rename style preset "${command.presetId}" to a blank name.`,
							target,
						),
					],
				};
			}
			if (
				nextName !== preset.name &&
				presets.some((candidate) => candidate.name === nextName)
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.style-preset-name-collision",
							"error",
							`Scene command ${index} cannot rename style preset "${command.presetId}" to "${nextName}": a preset with that name already exists.`,
							target,
						),
					],
				};
			}
			return {
				compiled: {
					command: createRenameStylePresetCommand(
						command.presetId,
						command.name,
					),
					target,
				},
				issues: [],
			};
		}
		case "scene/replace-style-preset": {
			const target = {
				kind: "document",
				id: scene.id,
				path: commandPath,
			} as const;
			const preset = readStylePresets(scene).find(
				(candidate) => candidate.id === command.presetId,
			);
			if (!preset) {
				return {
					issues: [
						createAgentIssue(
							"agent.style-preset-missing",
							"error",
							`Scene command ${index} targets missing style preset "${command.presetId}".`,
							target,
						),
					],
				};
			}
			const normalized = normalizeStylePreset({
				id: preset.id,
				name: preset.name,
				kind: command.options.kind ?? preset.kind,
				paint: command.options.paint,
				typography: command.options.typography,
				appearance: command.options.appearance,
			});
			if (!normalized) {
				return {
					issues: [
						createAgentIssue(
							"agent.style-preset-empty-payload",
							"error",
							`Scene command ${index} cannot replace style preset "${command.presetId}": the payload has no usable paint, typography, or appearance part.`,
							target,
						),
					],
				};
			}
			return {
				compiled: {
					command: createReplaceStylePresetCommand(
						command.presetId,
						command.options,
					),
					target,
				},
				issues: [],
			};
		}
		case "scene/update-style-preset-typography": {
			const target = {
				kind: "document",
				id: scene.id,
				path: commandPath,
			} as const;
			const preset = readStylePresets(scene).find(
				(candidate) => candidate.id === command.presetId,
			);
			if (!preset) {
				return {
					issues: [
						createAgentIssue(
							"agent.style-preset-missing",
							"error",
							`Scene command ${index} targets missing style preset "${command.presetId}".`,
							target,
						),
					],
				};
			}
			const normalizedTypography = normalizeStylePresetTypography(
				command.typography,
			);
			if (!normalizedTypography) {
				return {
					issues: [
						createAgentIssue(
							"agent.style-preset-empty-payload",
							"error",
							`Scene command ${index} cannot update style preset "${command.presetId}" typography: the payload normalizes to nothing.`,
							target,
						),
					],
				};
			}
			return {
				compiled: {
					command: createUpdateStylePresetTypographyCommand(
						command.presetId,
						command.typography,
					),
					target,
				},
				issues: [],
			};
		}
		case "scene/remove-style-preset": {
			const target = {
				kind: "document",
				id: scene.id,
				path: commandPath,
			} as const;
			if (
				!readStylePresets(scene).some(
					(preset) => preset.id === command.presetId,
				)
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.style-preset-missing",
							"error",
							`Scene command ${index} targets missing style preset "${command.presetId}".`,
							target,
						),
					],
				};
			}
			return {
				compiled: {
					command: createRemoveStylePresetCommand(command.presetId),
					target,
				},
				issues: [],
			};
		}
		case "scene/reorder-style-preset": {
			const target = {
				kind: "document",
				id: scene.id,
				path: commandPath,
			} as const;
			const presets = readStylePresets(scene);
			if (!presets.some((preset) => preset.id === command.presetId)) {
				return {
					issues: [
						createAgentIssue(
							"agent.style-preset-missing",
							"error",
							`Scene command ${index} targets missing style preset "${command.presetId}".`,
							target,
						),
					],
				};
			}
			if (
				!Number.isInteger(command.toIndex) ||
				command.toIndex < 0 ||
				command.toIndex >= presets.length
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.style-preset-index-out-of-range",
							"error",
							`Scene command ${index} style preset index must be an integer from 0 to ${Math.max(0, presets.length - 1)}.`,
							target,
						),
					],
				};
			}
			return {
				compiled: {
					command: createReorderStylePresetCommand(
						command.presetId,
						command.toIndex,
					),
					target,
				},
				issues: [],
			};
		}
		case "scene/apply-path-operation": {
			const planned = buildPathOperationCommand(
				scene,
				command.operation,
				command.nodeIds,
			);
			const compiledIssues = planned.issues.map((pathOpIssue) =>
				createAgentIssue(
					`agent.path-operation-${pathOpIssue.code.slice("path-op.".length)}`,
					pathOpIssue.severity,
					`Scene command ${index}: ${pathOpIssue.message}`,
					{
						kind: pathOpIssue.sourceId ? "node" : "document",
						id: pathOpIssue.sourceId ?? scene.id,
						path: commandPath,
					},
				),
			);
			if (!planned.ok) {
				return { issues: compiledIssues };
			}
			return {
				compiled: {
					command: planned.command,
					target: {
						kind: "node",
						id: planned.primaryNodeId,
						path: commandPath,
					},
				},
				issues: compiledIssues,
			};
		}
		case "scene/create-component-source": {
			const target = {
				kind: "node",
				id: command.sourceNodeId,
				path: commandPath,
			} as const;
			const sourceNodeLookup = requireSceneNode(
				scene,
				command.sourceNodeId,
				index,
				target,
			);
			if (!sourceNodeLookup.node) return { issues: sourceNodeLookup.issues };
			const sourceNode = sourceNodeLookup.node;
			if (sourceNode.component?.kind === "instance") {
				return {
					issues: [
						createAgentIssue(
							"agent.component-source-target-is-instance",
							"error",
							`Scene command ${index} cannot make component instance "${command.sourceNodeId}" a source; detach it first.`,
							target,
						),
					],
				};
			}
			if (
				readComponentSymbols(scene).some(
					(symbol) => symbol.sourceNodeId === command.sourceNodeId,
				)
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.component-source-already-exists",
							"error",
							`Scene command ${index} cannot create a component source: node "${command.sourceNodeId}" is already a component source.`,
							target,
						),
					],
				};
			}
			return {
				compiled: {
					command: createComponentSourceCommand(
						command.sourceNodeId,
						command.options,
						command.label ? { label: command.label } : {},
					),
					target,
				},
				issues: [],
			};
		}
		case "scene/insert-component-instance-from-symbol": {
			const target = {
				kind: "document",
				id: scene.id,
				path: commandPath,
			} as const;
			const symbol = findComponentSymbol(scene, command.symbolId);
			if (!symbol) {
				return {
					issues: [
						createAgentIssue(
							"agent.component-symbol-missing",
							"error",
							`Scene command ${index} targets missing component symbol "${command.symbolId}".`,
							target,
						),
					],
				};
			}
			const sourceNode = findNode(scene, symbol.sourceNodeId);
			if (!sourceNode) {
				return {
					issues: [
						createAgentIssue(
							"agent.component-source-missing",
							"error",
							`Scene command ${index} cannot instance component symbol "${command.symbolId}": its source node "${symbol.sourceNodeId}" no longer exists.`,
							target,
						),
					],
				};
			}
			if (sourceNode.component?.kind === "instance") {
				return {
					issues: [
						createAgentIssue(
							"agent.component-source-target-is-instance",
							"error",
							`Scene command ${index} cannot instance component symbol "${command.symbolId}": its source node has itself become a component instance.`,
							target,
						),
					],
				};
			}
			if (
				command.options?.layerId &&
				!scene.layers.some((layer) => layer.id === command.options?.layerId)
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-layer",
							"error",
							`Scene command ${index} targets missing layer "${command.options.layerId}".`,
							target,
						),
					],
				};
			}
			if (
				command.options?.artboardId &&
				!findArtboardById(scene, command.options.artboardId)
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.scene-command-missing-artboard",
							"error",
							`Scene command ${index} targets missing artboard "${command.options.artboardId}".`,
							target,
						),
					],
				};
			}
			const plan = planComponentInstance(
				scene,
				command.symbolId,
				command.options,
			);
			if (!plan) {
				return {
					issues: [
						createAgentIssue(
							"agent.component-instance-plan-failed",
							"error",
							`Scene command ${index} could not plan an instance of component symbol "${command.symbolId}".`,
							target,
						),
					],
				};
			}
			return {
				compiled: {
					command: createInsertComponentInstanceCommand(
						plan,
						command.label ? { label: command.label } : {},
					),
					target: { kind: "node", id: plan.rootNode.id, path: commandPath },
				},
				issues: [],
			};
		}
		case "scene/set-component-timing-offset": {
			const target = {
				kind: "node",
				id: command.instanceRootNodeId,
				path: commandPath,
			} as const;
			const node = findNode(scene, command.instanceRootNodeId);
			if (node?.component?.kind !== "instance") {
				return {
					issues: [
						createAgentIssue(
							"agent.component-instance-target-missing",
							"error",
							`Scene command ${index} targets "${command.instanceRootNodeId}", which is not a component instance root.`,
							target,
						),
					],
				};
			}
			return {
				compiled: {
					command: createSetComponentTimingOffsetCommand(
						command.instanceRootNodeId,
						command.offsetFrames,
						command.label ? { label: command.label } : {},
					),
					target,
				},
				issues: [],
			};
		}
		case "scene/detach-component-instance": {
			const target = {
				kind: "node",
				id: command.instanceRootNodeId,
				path: commandPath,
			} as const;
			const node = findNode(scene, command.instanceRootNodeId);
			if (node?.component?.kind !== "instance") {
				return {
					issues: [
						createAgentIssue(
							"agent.component-instance-target-missing",
							"error",
							`Scene command ${index} targets "${command.instanceRootNodeId}", which is not a component instance root.`,
							target,
						),
					],
				};
			}
			return {
				compiled: {
					command: createDetachComponentInstanceCommand(
						command.instanceRootNodeId,
						command.label ? { label: command.label } : {},
					),
					target,
				},
				issues: [],
			};
		}
		case "scene/apply-component-override": {
			const target = {
				kind: "node",
				id: command.instanceNodeId,
				path: commandPath,
			} as const;
			const instanceRoot = findNode(scene, command.instanceRootNodeId);
			const binding = instanceRoot?.component;
			if (binding?.kind !== "instance") {
				return {
					issues: [
						createAgentIssue(
							"agent.component-instance-target-missing",
							"error",
							`Scene command ${index} targets "${command.instanceRootNodeId}", which is not a component instance root.`,
							{
								kind: "node",
								id: command.instanceRootNodeId,
								path: commandPath,
							},
						),
					],
				};
			}
			if (
				!Object.values(binding.sourceToInstanceNodeIds).includes(
					command.instanceNodeId,
				)
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.component-override-target-not-in-instance",
							"error",
							`Scene command ${index} targets node "${command.instanceNodeId}", which is not part of component instance "${command.instanceRootNodeId}".`,
							target,
						),
					],
				};
			}
			const override = planComponentNodeOverride(
				scene,
				command.instanceRootNodeId,
				command.instanceNodeId,
				command.override,
			);
			if (!override) {
				return {
					issues: [
						createAgentIssue(
							"agent.component-override-empty-payload",
							"error",
							`Scene command ${index} cannot apply a component override: the payload normalizes to nothing for kind "${command.override.kind}".`,
							target,
						),
					],
				};
			}
			const sharedDriverConflict = componentOverrideSharedDriverConflict(
				scene,
				override,
			);
			if (sharedDriverConflict) {
				return {
					issues: [
						createAgentIssue(
							"agent.component-override-shared-driver-conflict",
							"error",
							`Scene command ${index} cannot add this component override because a ${sharedDriverConflict} already owns the same field on node "${override.instanceNodeId}".`,
							target,
						),
					],
				};
			}
			return {
				compiled: {
					command: createApplyComponentOverrideCommand(
						command.instanceRootNodeId,
						command.instanceNodeId,
						command.override,
						command.label ? { label: command.label } : {},
					),
					target,
				},
				issues: [],
			};
		}
		case "scene/reset-component-override": {
			const target = {
				kind: "node",
				id: command.instanceRootNodeId,
				path: commandPath,
			} as const;
			const instanceRoot = findNode(scene, command.instanceRootNodeId);
			const binding = instanceRoot?.component;
			if (binding?.kind !== "instance") {
				return {
					issues: [
						createAgentIssue(
							"agent.component-instance-target-missing",
							"error",
							`Scene command ${index} targets "${command.instanceRootNodeId}", which is not a component instance root.`,
							target,
						),
					],
				};
			}
			const matching = (binding.overrides ?? []).filter((override) => {
				if (
					command.filter?.instanceNodeId &&
					override.instanceNodeId !== command.filter.instanceNodeId
				) {
					return false;
				}
				if (command.filter?.kind && override.kind !== command.filter.kind) {
					return false;
				}
				return true;
			});
			if (matching.length === 0) {
				return {
					issues: [
						createAgentIssue(
							"agent.component-override-reset-nothing-to-reset",
							"error",
							`Scene command ${index} matches no tracked overrides on component instance "${command.instanceRootNodeId}" to reset.`,
							target,
						),
					],
				};
			}
			const conflictingOverride = matching.find((override) =>
				componentOverrideSharedDriverConflict(scene, override),
			);
			if (conflictingOverride) {
				return {
					issues: [
						createAgentIssue(
							"agent.component-override-shared-driver-conflict",
							"error",
							`Scene command ${index} cannot reset this override while a shared driver owns the same field on node "${conflictingOverride.instanceNodeId}"; remove one owner first.`,
							target,
						),
					],
				};
			}
			return {
				compiled: {
					command: createResetComponentOverrideCommand(
						command.instanceRootNodeId,
						command.filter,
						command.label ? { label: command.label } : {},
					),
					target,
				},
				issues: [],
			};
		}
		case "scene/add-component-prop": {
			const target = {
				kind: "document",
				id: scene.id,
				path: commandPath,
			} as const;
			const existingProps = readComponentProps(scene);
			const nameIssue = validateComponentPropName(
				command.options.name,
				existingProps,
			);
			if (nameIssue) {
				return {
					issues: [
						componentPropNameIssueToAgentIssue(nameIssue, index, target),
					],
				};
			}
			if (
				command.options.id &&
				existingProps.some((prop) => prop.id === command.options.id)
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.component-prop-id-collision",
							"error",
							`Scene command ${index} cannot add component prop: id "${command.options.id}" already exists in the document library.`,
							target,
						),
					],
				};
			}
			if (command.options.defaultValue.type !== command.options.type) {
				return {
					issues: [
						createAgentIssue(
							"agent.component-prop-default-type-mismatch",
							"error",
							`Scene command ${index} cannot add component prop "${command.options.name}": defaultValue.type "${command.options.defaultValue.type}" does not match type "${command.options.type}".`,
							target,
						),
					],
				};
			}
			const bindingIssues = componentPropBindingIssues(
				scene,
				motion,
				command.options.type,
				command.options.bindings ?? [],
				index,
				commandPath,
			);
			// Only ERROR-severity binding issues block compilation. An
			// animated-conflict issue is a WARNING (allow-with-warning, per the
			// componentPropBindingIssueToAgentIssue JSDoc) and rides through as
			// `issues` alongside the still-compiled command.
			if (bindingIssues.some((issue) => issue.severity === "error")) {
				return { issues: bindingIssues };
			}
			const numberIssue = sharedNumberComponentPropIssue({
				scene,
				motion,
				grammarTargetNodeIds,
				propType: command.options.type,
				bindings: command.options.bindings ?? [],
				defaultValue: command.options.defaultValue,
				requestedRange: {
					min: command.options.min,
					max: command.options.max,
					step: command.options.step,
				},
				requireMatchingCurrentValue: true,
				index,
				propName: command.options.name,
				target,
			});
			if (numberIssue) {
				return {
					issues: [
						...bindingIssues.filter(
							(issue) =>
								issue.code !== "agent.component-prop-binding-animated-conflict",
						),
						numberIssue,
					],
				};
			}
			const colorBindings = (command.options.bindings ?? []).filter(
				(binding): binding is ComponentPropBindingStyleColor =>
					binding.kind === "style-color",
			);
			if (
				command.options.type === "color" &&
				colorBindings.length > 0 &&
				(componentPropStyleColorOwnershipConflict(scene, colorBindings) ||
					typeof command.options.defaultValue.value !== "string" ||
					normalizeHex(command.options.defaultValue.value) === null)
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.component-prop-color-owner-invalid",
							"error",
							`Scene command ${index} cannot add color prop "${command.options.name}": each bound paint slot must have one owner and bound defaults must be hexadecimal colors.`,
							target,
						),
					],
				};
			}
			return {
				compiled: {
					command: createAddComponentPropCommand(command.options, {
						...(command.label ? { label: command.label } : {}),
						grammarTargetNodeIds,
						motion,
					}),
					target,
				},
				issues: bindingIssues,
			};
		}
		case "scene/update-component-prop": {
			const target = {
				kind: "document",
				id: scene.id,
				path: commandPath,
			} as const;
			const existingProps = readComponentProps(scene);
			const prop = existingProps.find((entry) => entry.id === command.propId);
			if (!prop) {
				return {
					issues: [
						createAgentIssue(
							"agent.component-prop-missing",
							"error",
							`Scene command ${index} targets missing component prop "${command.propId}".`,
							target,
						),
					],
				};
			}
			if (command.patch.name !== undefined) {
				const nameIssue = validateComponentPropName(
					command.patch.name,
					existingProps,
					command.propId,
				);
				if (nameIssue) {
					return {
						issues: [
							componentPropNameIssueToAgentIssue(nameIssue, index, target),
						],
					};
				}
			}
			if (
				command.patch.defaultValue !== undefined &&
				command.patch.defaultValue.type !== prop.type
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.component-prop-default-type-mismatch",
							"error",
							`Scene command ${index} cannot update component prop "${command.propId}": defaultValue.type "${command.patch.defaultValue.type}" does not match its type "${prop.type}".`,
							target,
						),
					],
				};
			}
			// Collected up front so a WARNING-severity binding issue (animated
			// conflict) still rides through on the successful `compiled` return
			// below — see the `scene/add-component-prop` case's identical
			// allow-with-warning handling.
			let bindingIssues: readonly AgentIssue[] = [];
			if (command.patch.bindings !== undefined) {
				bindingIssues = componentPropBindingIssues(
					scene,
					motion,
					prop.type,
					command.patch.bindings,
					index,
					commandPath,
				);
				if (bindingIssues.some((issue) => issue.severity === "error")) {
					return { issues: bindingIssues };
				}
			}
			const nextBindings = command.patch.bindings ?? prop.bindings;
			const colorBindings = nextBindings.filter(
				(binding): binding is ComponentPropBindingStyleColor =>
					binding.kind === "style-color",
			);
			const nextDefault = command.patch.defaultValue ?? prop.defaultValue;
			if (
				command.patch.defaultValue !== undefined ||
				command.patch.bindings !== undefined ||
				command.patch.min !== undefined ||
				command.patch.max !== undefined ||
				command.patch.step !== undefined
			) {
				const numberIssue = sharedNumberComponentPropIssue({
					scene,
					motion,
					grammarTargetNodeIds,
					propType: prop.type,
					bindings: nextBindings,
					defaultValue: nextDefault,
					requestedRange: {
						min: command.patch.min,
						max: command.patch.max,
						step: command.patch.step,
					},
					excludePropId: prop.id,
					requireMatchingCurrentValue: command.patch.defaultValue === undefined,
					index,
					propName: prop.name,
					target,
				});
				if (numberIssue) {
					return {
						issues: [
							...bindingIssues.filter(
								(issue) =>
									issue.code !==
									"agent.component-prop-binding-animated-conflict",
							),
							numberIssue,
						],
					};
				}
			}
			if (
				prop.type === "color" &&
				colorBindings.length > 0 &&
				(componentPropStyleColorOwnershipConflict(
					scene,
					colorBindings,
					prop.id,
				) ||
					typeof nextDefault.value !== "string" ||
					normalizeHex(nextDefault.value) === null)
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.component-prop-color-owner-invalid",
							"error",
							`Scene command ${index} cannot update color prop "${prop.name}": each bound paint slot must have one owner and bound defaults must be hexadecimal colors.`,
							target,
						),
					],
				};
			}
			return {
				compiled: {
					command: createUpdateComponentPropCommand(
						command.propId,
						command.patch,
						{ grammarTargetNodeIds, motion },
					),
					target,
				},
				issues: bindingIssues,
			};
		}
		case "scene/remove-component-prop": {
			const target = {
				kind: "document",
				id: scene.id,
				path: commandPath,
			} as const;
			const prop = readComponentProps(scene).find(
				(candidate) => candidate.id === command.propId,
			);
			if (!prop) {
				return {
					issues: [
						createAgentIssue(
							"agent.component-prop-missing",
							"error",
							`Scene command ${index} targets missing component prop "${command.propId}".`,
							target,
						),
					],
				};
			}
			const interactionUseCount = readInteractions(scene).reduce(
				(count, interaction) =>
					count +
					interaction.actions.filter(
						(action) =>
							action.kind === "set-prop" && action.propName === prop.name,
					).length,
				0,
			);
			if (interactionUseCount > 0) {
				return {
					issues: [
						createAgentIssue(
							"agent.component-prop-in-use",
							"error",
							`Scene command ${index} cannot remove component prop "${prop.name}" because ${interactionUseCount} interaction action${interactionUseCount === 1 ? "" : "s"} reference it.`,
							target,
						),
					],
				};
			}
			return {
				compiled: {
					command: createRemoveComponentPropCommand(command.propId),
					target,
				},
				issues: [],
			};
		}
		case "scene/add-interaction": {
			const target = {
				kind: "document",
				id: scene.id,
				path: commandPath,
			} as const;
			if (
				command.options.id &&
				readInteractions(scene).some(
					(interaction) => interaction.id === command.options.id,
				)
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.interaction-id-collision",
							"error",
							`Scene command ${index} cannot add interaction: id "${command.options.id}" already exists in the document library.`,
							target,
						),
					],
				};
			}
			const issues = interactionIssues(
				scene,
				motion,
				command.options.trigger,
				command.options.actions,
				index,
				commandPath,
			);
			// Only ERROR-severity issues block compilation. clip-missing/prop-missing
			// are WARNING (allow-with-warning) and ride through as `issues` alongside
			// the still-compiled command, matching `scene/add-component-prop`'s
			// identical binding-issue handling.
			if (issues.some((issue) => issue.severity === "error")) {
				return { issues };
			}
			return {
				compiled: {
					command: createAddInteractionCommand(
						command.options,
						command.label ? { label: command.label } : {},
					),
					target,
				},
				issues,
			};
		}
		case "scene/update-interaction": {
			const target = {
				kind: "document",
				id: scene.id,
				path: commandPath,
			} as const;
			const existing = readInteractions(scene).find(
				(interaction) => interaction.id === command.interactionId,
			);
			if (!existing) {
				return {
					issues: [
						createAgentIssue(
							"agent.interaction-missing",
							"error",
							`Scene command ${index} targets missing interaction "${command.interactionId}".`,
							target,
						),
					],
				};
			}
			// Validated against the PATCHED result (not just the delta), matching
			// the JSDoc on AgentSceneCommand's `scene/update-interaction` member —
			// an update that only changes `trigger` still re-checks it against the
			// interaction's current `actions` (relevant for the scroll-progress
			// shape rule), and vice versa.
			const issues = interactionIssues(
				scene,
				motion,
				command.patch.trigger ?? existing.trigger,
				command.patch.actions !== undefined && command.patch.actions.length > 0
					? command.patch.actions
					: existing.actions,
				index,
				commandPath,
			);
			if (issues.some((issue) => issue.severity === "error")) {
				return { issues };
			}
			return {
				compiled: {
					command: createUpdateInteractionCommand(
						command.interactionId,
						command.patch,
					),
					target,
				},
				issues,
			};
		}
		case "scene/remove-interaction": {
			const target = {
				kind: "document",
				id: scene.id,
				path: commandPath,
			} as const;
			if (
				!readInteractions(scene).some(
					(interaction) => interaction.id === command.interactionId,
				)
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.interaction-missing",
							"error",
							`Scene command ${index} targets missing interaction "${command.interactionId}".`,
							target,
						),
					],
				};
			}
			return {
				compiled: {
					command: createRemoveInteractionCommand(command.interactionId),
					target,
				},
				issues: [],
			};
		}
	}
};

/** A bindable command that writes one nested transform vector axis, if it is one. */
const bindableTransformVectorWrite = (
	command: AgentSceneCommand,
): { readonly nodeId: string; readonly path: string } | null => {
	if (command.type !== "scene/set-bindable-property") return null;
	const descriptor = bindablePropertyById(command.propertyId);
	if (descriptor?.source.kind !== "scene-property") return null;
	if (
		descriptor.source.path === "transform.position.x" ||
		descriptor.source.path === "transform.position.y" ||
		descriptor.source.path === "transform.anchor.x" ||
		descriptor.source.path === "transform.anchor.y" ||
		descriptor.source.path === "transform.scale.x" ||
		descriptor.source.path === "transform.scale.y"
	) {
		return { nodeId: command.nodeId, path: descriptor.source.path };
	}
	return null;
};

/**
 * Rejects batched bindable transform vector writes that cannot compose. Each
 * position/anchor/scale-axis bindable write reconstructs a full nested
 * transform vector from the pre-apply snapshot, so batching multiple vector
 * axes for one node would let a later stale vector clobber an earlier write.
 * The agent should send separate applies, or use `scene/update-node-transform`
 * with a full transform.
 */
const bindableTransformVectorBatchConflictIssues = (
	commands: readonly AgentSceneCommand[],
): readonly AgentIssue[] => {
	const pathsByNode = new Map<string, Set<string>>();
	const indicesByNode = new Map<string, number[]>();
	for (const [index, command] of commands.entries()) {
		const write = bindableTransformVectorWrite(command);
		if (!write) continue;
		const paths = pathsByNode.get(write.nodeId) ?? new Set<string>();
		paths.add(write.path);
		pathsByNode.set(write.nodeId, paths);
		const indices = indicesByNode.get(write.nodeId) ?? [];
		indices.push(index);
		indicesByNode.set(write.nodeId, indices);
	}
	const issues: AgentIssue[] = [];
	for (const [nodeId, paths] of pathsByNode) {
		if (paths.size < 2) continue;
		for (const index of indicesByNode.get(nodeId) ?? []) {
			issues.push(
				createAgentIssue(
					"agent.bindable-property-transform-vector-batch-conflict",
					"error",
					`Scene command ${index} batches multiple transform vector bindable writes (${[...paths].join(", ")}) for node "${nodeId}" in one apply; send them as separate applies or use scene/update-node-transform with a full transform.`,
					{ kind: "node", id: nodeId, path: `commands.${index}` },
				),
			);
		}
	}
	return issues;
};

const MAX_PIXEL_ART_OBJECT_COMMANDS_PER_PLAN = 1;

const pixelArtPlanComplexityIssues = (
	scene: SceneDocument,
	commands: readonly AgentSceneCommand[],
): readonly AgentIssue[] => {
	const pixelArtCommandCount = commands.filter(
		(command) => command.type === "scene/append-pixel-art-objects",
	).length;
	return pixelArtCommandCount <= MAX_PIXEL_ART_OBJECT_COMMANDS_PER_PLAN
		? []
		: [
				createAgentIssue(
					"agent.pixel-art-plan-complexity-exceeded",
					"error",
					`A plan may append at most ${MAX_PIXEL_ART_OBJECT_COMMANDS_PER_PLAN} pixel-art object because native lowering is contour-heavy; submit separate reviewed plans.`,
					{ kind: "document", id: scene.id, path: "commands" },
				),
			];
};

const compileAgentSceneCommands = (
	scene: SceneDocument,
	motion: MotionDocument,
	commands: readonly AgentSceneCommand[],
	grammarTargetNodeIds: ReadonlySet<string> = new Set(),
): {
	readonly commands: readonly AgentCompiledSceneCommand[];
	readonly issues: readonly AgentIssue[];
} => {
	const complexityIssues = pixelArtPlanComplexityIssues(scene, commands);
	if (complexityIssues.length > 0) {
		return { commands: [], issues: complexityIssues };
	}
	const compiled: AgentCompiledSceneCommand[] = [];
	const issues: AgentIssue[] = [];
	const batchState = buildBindableSceneBatchState(scene, commands);
	let compileScene = scene;
	for (const [index, command] of commands.entries()) {
		const result = compileAgentSceneCommand(
			compileScene,
			motion,
			command,
			index,
			batchState,
			grammarTargetNodeIds,
		);
		issues.push(...result.issues);
		if (result.compiled) {
			compiled.push(result.compiled);
			const run = runSceneCommands(compileScene, [result.compiled.command]);
			if (run.issues.length === 0) compileScene = run.document;
		}
	}
	issues.push(...bindableTransformVectorBatchConflictIssues(commands));
	return { commands: compiled, issues };
};

const reviewCompiledSceneCommands = (
	requestedCommandCount: number,
	commands: readonly AgentCompiledSceneCommand[],
	issues: readonly AgentIssue[],
): AgentCommandReviewReport =>
	createCommandReviewReport(
		"scene",
		"apply_scene_commands",
		requestedCommandCount,
		commands.length,
		commands.map((command) => command.target),
		issues,
	);

/**
 * Compiles typed scene command envelopes into existing scene command-bus
 * commands while preserving the semantic review report used by MCP and live
 * approval bridges. The returned commands are not executed here.
 */
export function compileAgentSceneCommandBatch(
	context: AgentDocumentContext,
	commands: readonly AgentSceneCommand[],
): AgentCompiledSceneCommandBatch {
	const compiled = compileAgentSceneCommands(
		context.scene,
		context.motion,
		commands,
		new Set(context.grammar.bindings.flatMap((binding) => binding.targetIds)),
	);
	return {
		commands: compiled.commands,
		report: reviewCompiledSceneCommands(
			commands.length,
			compiled.commands,
			compiled.issues,
		),
	};
}

/**
 * Reviews typed scene command envelopes against a document snapshot without
 * mutating the command store. Agents can use this to surface affected ids and
 * semantic errors before requesting an approved apply step.
 */
export function reviewAgentSceneCommands(
	context: AgentDocumentContext,
	commands: readonly AgentSceneCommand[],
): AgentCommandReviewReport {
	return compileAgentSceneCommandBatch(context, commands).report;
}

const trackTargetId = (nodeId: string, property: AnimatableProperty): string =>
	`${nodeId}:${property}`;

const findTrackById = (
	motion: MotionDocument,
	trackId: string,
): MotionDocument["tracks"][number] | undefined =>
	motion.tracks.find((track) => track.id === trackId);

const findClipById = (
	motion: MotionDocument,
	clipId: string,
): MotionDocument["clips"][number] | undefined =>
	motion.clips.find((clip) => clip.id === clipId);

const findTrackByTarget = (
	motion: MotionDocument,
	nodeId: string,
	property: AnimatableProperty,
): MotionDocument["tracks"][number] | undefined =>
	motion.tracks.find(
		(track) =>
			track.target.nodeId === nodeId && track.target.property === property,
	);

const findCameraTrackById = (
	motion: MotionDocument,
	trackId: string,
): NonNullable<MotionDocument["cameraTracks"]>[number] | undefined =>
	motion.cameraTracks?.find((track) => track.id === trackId);

const findCameraTrackByTarget = (
	motion: MotionDocument,
	cameraRigId: string,
	property: CameraRigAnimatableProperty,
): NonNullable<MotionDocument["cameraTracks"]>[number] | undefined =>
	motion.cameraTracks?.find(
		(track) =>
			track.target.cameraRigId === cameraRigId &&
			track.target.property === property,
	);

const findCameraCutById = (
	motion: MotionDocument,
	segmentId: string,
): CameraCutSegment | undefined =>
	motion.cameraCuts?.find((segment) => segment.id === segmentId);

const isUnitRangeNumber = (value: number): boolean =>
	Number.isFinite(value) && value >= 0 && value <= 1;

/**
 * Translates the agent-facing {@link AgentKeyframeEasing} into the domain-level
 * {@link KeyframeUpsertEasing} the motion command factories consume. `custom`
 * curve x-handles are validated against the same constraint
 * {@link normalizeEasingCurve} silently clamps to (finite, `0..1`) — the domain
 * layer never rejects invalid input, it coerces it, so this compiler pre-checks
 * instead of letting an out-of-range request silently resolve to a different
 * curve than the one asked for.
 */
const compileKeyframeEasing = (
	easing: AgentKeyframeEasing,
	index: number,
	target: AgentIssueTarget,
): {
	readonly easing?: KeyframeUpsertEasing;
	readonly hold?: MotionTimingTemplateKeyframeHold;
	readonly issues: readonly AgentIssue[];
} => {
	if (easing.kind === "template") {
		const compiled = compileMotionTimingTemplateForKeyframe(easing.templateId);
		if (compiled.status === "ready") {
			return {
				easing: compiled.easing,
				hold: motionTimingTemplateKeyframeHoldOf(easing.templateId),
				issues: [],
			};
		}
		if (compiled.status === "unknown") {
			return {
				issues: [
					createAgentIssue(
						"agent.motion-command-unknown-easing-template",
						"error",
						`Motion command ${index} references unknown easing template "${compiled.templateId}".`,
						target,
					),
				],
			};
		}
		return {
			issues: [
				createAgentIssue(
					"agent.motion-command-unsupported-easing-template",
					"error",
					`Motion command ${index} cannot apply "${compiled.template.uiLabel}" to a keyframe segment: ${compiled.reason}`,
					target,
				),
			],
		};
	}
	if (easing.kind === "preset") {
		return { easing: { kind: "preset", preset: easing.preset }, issues: [] };
	}
	const y1 = easing.y1 ?? 0;
	const y2 = easing.y2 ?? 1;
	if (
		!isUnitRangeNumber(easing.x1) ||
		!isUnitRangeNumber(easing.x2) ||
		!Number.isFinite(y1) ||
		!Number.isFinite(y2) ||
		y1 < -4 ||
		y1 > 5 ||
		y2 < -4 ||
		y2 > 5
	) {
		return {
			issues: [
				createAgentIssue(
					"agent.motion-command-invalid-easing-curve",
					"error",
					`Motion command ${index} has an invalid custom easing curve: x1/x2 must be in 0..1 and y1/y2 in -4..5 (got ${easing.x1}, ${y1}, ${easing.x2}, ${y2}).`,
					target,
				),
			],
		};
	}
	return {
		easing: {
			kind: "curve",
			curve: { x1: easing.x1, y1, x2: easing.x2, y2 },
		},
		issues: [],
	};
};

/**
 * Compiles the three published-control keyframe commands.
 *
 * A control is only writable when the scene actually publishes it: the link is
 * re-parsed and the control id looked up, so an agent cannot mint a track for a
 * control that no linked production declares — a track like that would silently
 * widen the desired build key and make the artifact look stale forever.
 */
const compileAgentProductionControlCommand = (
	command: Extract<
		AgentMotionCommand,
		{
			type:
				| "motion/upsert-production-control-keyframe"
				| "motion/remove-production-control-keyframe"
				| "motion/retime-production-control-keyframe";
		}
	>,
	context: AgentDocumentContext,
	index: number,
	commandPath: string,
): { compiled?: AgentCompiledMotionCommand; issues: readonly AgentIssue[] } => {
	const entry = sceneProductionLinks(context.scene).find(
		(candidate) => candidate.link.linkId === command.linkId,
	);
	const control = entry?.link.controls.find(
		(candidate) => candidate.id === command.controlId,
	);
	if (!entry || !control) {
		return {
			issues: [
				createAgentIssue(
					"agent.motion-command-missing-track",
					"error",
					`Motion command ${index} targets published control "${command.controlId}" on link "${command.linkId}", which the scene does not publish.`,
					{ kind: "document", id: context.scene.id, path: commandPath },
				),
			],
		};
	}
	const existingTrack = context.motion.productionControlTracks?.find(
		(track) =>
			track.target.linkId === command.linkId &&
			track.target.controlId === command.controlId,
	);
	const trackId =
		existingTrack?.id ??
		productionControlTrackId(command.linkId, command.controlId);
	const target: AgentIssueTarget = {
		kind: "motion-track",
		id: trackId,
		path: commandPath,
	};
	if (command.type === "motion/upsert-production-control-keyframe") {
		return {
			compiled: {
				command: upsertProductionControlKeyframe(
					command.linkId,
					command.controlId,
					command.frame,
					command.value,
				),
				target,
			},
			issues: [],
		};
	}
	if (!existingTrack) {
		return {
			issues: [
				createAgentIssue(
					"agent.motion-command-missing-track",
					"error",
					`Motion command ${index} targets missing production control track "${trackId}".`,
					target,
				),
			],
		};
	}
	if (command.type === "motion/remove-production-control-keyframe") {
		return {
			compiled: {
				command: removeProductionControlKeyframe(
					command.linkId,
					command.controlId,
					command.frame,
				),
				target,
			},
			issues: [],
		};
	}
	return {
		compiled: {
			command: setProductionControlKeyframeTime(
				existingTrack.id,
				command.fromFrame,
				command.toFrame,
				`agent-production-control-retime:${existingTrack.id}:${command.fromFrame}`,
			),
			target,
		},
		issues: [],
	};
};

const compileAgentMotionCommand = (
	context: AgentDocumentContext,
	command: AgentMotionCommand,
	index: number,
): { compiled?: AgentCompiledMotionCommand; issues: readonly AgentIssue[] } => {
	const commandPath = `commands.${index}`;
	switch (command.type) {
		case "motion/apply-clip-timing-template": {
			const clip = context.motion.clips.find(
				(candidate) => candidate.id === command.clipId,
			);
			const compiled = compileMotionTimingTemplateForKeyframe(
				command.templateId,
			);
			if (!clip || compiled.status !== "ready") {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-missing-clip",
							"error",
							!clip
								? `Motion command ${index} targets missing clip "${command.clipId}".`
								: `Motion timing template "${command.templateId}" cannot be applied to keyframe segments.`,
							{ kind: "document", id: context.scene.id, path: commandPath },
						),
					],
				};
			}
			return {
				compiled: {
					command: applyAnimationClipTimingTemplate(
						clip.id,
						command.templateId,
					),
					target: { kind: "document", id: context.scene.id, path: commandPath },
				},
				issues: [],
			};
		}
		case "motion/repair-path-morph-topology": {
			const track = findTrackById(context.motion, command.trackId);
			if (track?.target.property !== "pathShape") {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-missing-track",
							"error",
							`Motion command ${index} requires an existing pathShape track.`,
							{ kind: "motion-track", id: command.trackId, path: commandPath },
						),
					],
				};
			}
			return {
				compiled: {
					command: repairPathMorphTopology(track.id),
					target: { kind: "motion-track", id: track.id, path: commandPath },
				},
				issues: [],
			};
		}
		case "motion/set-path-morph-first-vertex":
		case "motion/reverse-path-morph-winding": {
			const track = findTrackById(context.motion, command.trackId);
			const keyframe = track?.keyframes.find(
				(key) => key.time === command.frame,
			);
			if (track?.target.property !== "pathShape" || !keyframe) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-missing-keyframe",
							"error",
							`Motion command ${index} requires a pathShape key at frame ${command.frame}.`,
							{
								kind: "motion-track",
								id: command.trackId,
								path: commandPath,
							},
						),
					],
				};
			}
			return {
				compiled: {
					command:
						command.type === "motion/set-path-morph-first-vertex"
							? setPathMorphFirstVertex(
									track.id,
									command.frame,
									command.firstVertexIndex,
								)
							: reversePathMorphKeyWinding(track.id, command.frame),
					target: { kind: "motion-track", id: track.id, path: commandPath },
				},
				issues: [],
			};
		}
		case "motion/enable-position-path": {
			if (!findNode(context.scene, command.nodeId)) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-missing-node",
							"error",
							`Motion command ${index} targets missing scene node "${command.nodeId}".`,
							{ kind: "node", id: command.nodeId, path: commandPath },
						),
					],
				};
			}
			return {
				compiled: {
					command: enablePositionPath(command.nodeId, command.keys),
					target: {
						kind: "motion-track",
						id: `position-path:${command.nodeId}`,
						path: commandPath,
					},
				},
				issues: [],
			};
		}
		case "motion/update-position-path-key": {
			const path = context.motion.positionPaths?.find(
				(candidate) => candidate.nodeId === command.nodeId,
			);
			if (!path?.keys.some((key) => key.frame === command.frame)) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-missing-keyframe",
							"error",
							`Motion command ${index} cannot find spatial key ${command.frame} for node "${command.nodeId}".`,
							{
								kind: "motion-track",
								id: path?.id ?? `position-path:${command.nodeId}`,
								path: commandPath,
							},
						),
					],
				};
			}
			return {
				compiled: {
					command: updatePositionPathKey(command.nodeId, command.frame, {
						...(command.inTangent ? { inTangent: command.inTangent } : {}),
						...(command.outTangent ? { outTangent: command.outTangent } : {}),
						...(command.spatialMode
							? { spatialMode: command.spatialMode }
							: {}),
						...(command.roving !== undefined ? { roving: command.roving } : {}),
					}),
					target: { kind: "motion-track", id: path.id, path: commandPath },
				},
				issues: [],
			};
		}
		case "motion/retime-position-path-key": {
			const path = context.motion.positionPaths?.find(
				(candidate) => candidate.nodeId === command.nodeId,
			);
			if (!path?.keys.some((key) => key.frame === command.fromFrame)) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-missing-keyframe",
							"error",
							`Motion command ${index} cannot find spatial key ${command.fromFrame} for node "${command.nodeId}".`,
							{
								kind: "motion-track",
								id: path?.id ?? `position-path:${command.nodeId}`,
								path: commandPath,
							},
						),
					],
				};
			}
			return {
				compiled: {
					command: retimePositionPathKeyframe(
						command.nodeId,
						command.fromFrame,
						command.toFrame,
					),
					target: { kind: "motion-track", id: path.id, path: commandPath },
				},
				issues: [],
			};
		}
		case "motion/set-source-optics-keyframe":
		case "motion/remove-source-optics-keyframe": {
			const artboard = findArtboardById(
				context.scene,
				command.target.artboardId,
			);
			const descriptor = sourceOpticsParameterDescriptor(
				command.target.parameterId,
			);
			const staticValue = artboard
				? sourceOpticsParameterValue(artboard, command.target)
				: undefined;
			const issueTarget: AgentIssueTarget = {
				kind: "motion-track",
				id: sourceOpticsTrackId(command.target),
				path: commandPath,
			};
			if (!artboard || !descriptor?.keyframable || staticValue === undefined) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-source-optics-target-invalid",
							"error",
							`Motion command ${index} requires an exact, keyframable Source Optics artboard/rig/owner/parameter address.`,
							issueTarget,
						),
					],
				};
			}
			if (command.type === "motion/set-source-optics-keyframe") {
				if (
					!Number.isFinite(command.value) ||
					command.value < descriptor.min ||
					command.value > descriptor.max
				) {
					return {
						issues: [
							createAgentIssue(
								"agent.motion-command-source-optics-value-out-of-range",
								"error",
								`Motion command ${index} value must be within ${descriptor.min}..${descriptor.max}.`,
								issueTarget,
							),
						],
					};
				}
				return {
					compiled: {
						command: upsertSourceOpticsKeyframe(
							command.target,
							command.frame,
							command.value,
						),
						target: issueTarget,
					},
					issues: [],
				};
			}
			const track = context.motion.sourceOpticsTracks?.find(
				(candidate) => candidate.id === sourceOpticsTrackId(command.target),
			);
			const snapped = snapMotionFrame(
				command.frame,
				context.motion.durationFrames,
			);
			if (!track?.keyframes.some((keyframe) => keyframe.time === snapped)) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-missing-keyframe",
							"error",
							`Motion command ${index} cannot find Source Optics keyframe ${snapped}.`,
							issueTarget,
						),
					],
				};
			}
			return {
				compiled: {
					command: removeSourceOpticsKeyframe(command.target, snapped),
					target: issueTarget,
				},
				issues: [],
			};
		}
		case "motion/upsert-keyframe": {
			if (!findNode(context.scene, command.nodeId)) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-missing-node",
							"error",
							`Motion command ${index} targets missing scene node "${command.nodeId}".`,
							{ kind: "node", id: command.nodeId, path: commandPath },
						),
					],
				};
			}
			const existingTrack = findTrackByTarget(
				context.motion,
				command.nodeId,
				command.property,
			);
			const target: AgentIssueTarget = {
				kind: "motion-track",
				id:
					existingTrack?.id ?? trackTargetId(command.nodeId, command.property),
				path: commandPath,
			};
			let easing: KeyframeUpsertEasing | undefined;
			let hold: MotionTimingTemplateKeyframeHold | undefined;
			if (command.easing) {
				const compiledEasing = compileKeyframeEasing(
					command.easing,
					index,
					target,
				);
				if (compiledEasing.issues.length > 0) {
					return { issues: compiledEasing.issues };
				}
				easing = compiledEasing.easing;
				hold = compiledEasing.hold;
			}
			return {
				compiled: {
					command: upsertKeyframeWithEasing(
						command.nodeId,
						command.property,
						command.frame,
						command.value,
						easing,
						hold,
					),
					target,
				},
				issues: [],
			};
		}
		case "motion/retime-keyframe": {
			const track = findTrackById(context.motion, command.trackId);
			if (!track) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-missing-track",
							"error",
							`Motion command ${index} targets missing track "${command.trackId}".`,
							{ kind: "motion-track", id: command.trackId, path: commandPath },
						),
					],
				};
			}
			const keyframe = track.keyframes.find(
				(item) => item.time === command.fromFrame,
			);
			if (!keyframe) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-missing-keyframe",
							"error",
							`Motion command ${index} cannot find keyframe ${command.fromFrame} on track "${command.trackId}".`,
							{ kind: "motion-track", id: command.trackId, path: commandPath },
						),
					],
				};
			}
			const snappedTarget = snapMotionFrame(
				command.toFrame,
				context.motion.durationFrames,
			);
			const occupied = track.keyframes.some(
				(item) => item !== keyframe && item.time === snappedTarget,
			);
			if (occupied) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-keyframe-collision",
							"error",
							`Motion command ${index} would collide with keyframe ${snappedTarget} on track "${command.trackId}".`,
							{ kind: "motion-track", id: command.trackId, path: commandPath },
						),
					],
				};
			}
			return {
				compiled: {
					command: setKeyframeTime(
						command.trackId,
						command.fromFrame,
						command.toFrame,
						`agent-motion-retime:${command.trackId}:${command.fromFrame}:${snappedTarget}`,
					),
					target: {
						kind: "motion-track",
						id: command.trackId,
						path: commandPath,
					},
				},
				issues: [],
			};
		}
		case "motion/set-keyframe-easing": {
			const track = findTrackById(context.motion, command.trackId);
			if (!track) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-missing-track",
							"error",
							`Motion command ${index} targets missing track "${command.trackId}".`,
							{ kind: "motion-track", id: command.trackId, path: commandPath },
						),
					],
				};
			}
			const keyframe = track.keyframes.find(
				(item) => item.time === command.frame,
			);
			if (!keyframe) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-missing-keyframe",
							"error",
							`Motion command ${index} cannot find keyframe ${command.frame} on track "${command.trackId}".`,
							{ kind: "motion-track", id: command.trackId, path: commandPath },
						),
					],
				};
			}
			const target: AgentIssueTarget = {
				kind: "motion-track",
				id: command.trackId,
				path: commandPath,
			};
			const compiledEasing = compileKeyframeEasing(
				command.easing,
				index,
				target,
			);
			if (compiledEasing.issues.length > 0 || !compiledEasing.easing) {
				return { issues: compiledEasing.issues };
			}
			const easingCommand = compiledEasing.hold
				? setKeyframeEasingWithHold(
						command.trackId,
						command.frame,
						compiledEasing.easing,
						compiledEasing.hold,
					)
				: compiledEasing.easing.kind === "preset"
					? setKeyframeEasing(
							command.trackId,
							command.frame,
							compiledEasing.easing.preset,
						)
					: setKeyframeEasingCurve(
							command.trackId,
							command.frame,
							compiledEasing.easing.curve,
						);
			return {
				compiled: { command: easingCommand, target },
				issues: [],
			};
		}
		case "motion/remove-keyframe": {
			const track = findTrackById(context.motion, command.trackId);
			if (!track) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-missing-track",
							"error",
							`Motion command ${index} targets missing track "${command.trackId}".`,
							{ kind: "motion-track", id: command.trackId, path: commandPath },
						),
					],
				};
			}
			if (!track.keyframes.some((item) => item.time === command.frame)) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-missing-keyframe",
							"error",
							`Motion command ${index} cannot find keyframe ${command.frame} on track "${command.trackId}".`,
							{ kind: "motion-track", id: command.trackId, path: commandPath },
						),
					],
				};
			}
			return {
				compiled: {
					command: removeKeyframe(command.trackId, command.frame),
					target: {
						kind: "motion-track",
						id: command.trackId,
						path: commandPath,
					},
				},
				issues: [],
			};
		}
		case "motion/remove-track": {
			if (!findTrackById(context.motion, command.trackId)) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-missing-track",
							"error",
							`Motion command ${index} targets missing track "${command.trackId}".`,
							{ kind: "motion-track", id: command.trackId, path: commandPath },
						),
					],
				};
			}
			return {
				compiled: {
					command: removeTrack(command.trackId),
					target: {
						kind: "motion-track",
						id: command.trackId,
						path: commandPath,
					},
				},
				issues: [],
			};
		}
		case "motion/set-bindable-keyframe": {
			const descriptor = bindablePropertyById(command.propertyId);
			if (!descriptor) {
				return {
					issues: [
						createAgentIssue(
							"agent.bindable-property-unknown",
							"error",
							`Motion command ${index} references unknown bindable property "${command.propertyId}".`,
							{ kind: "node", id: command.nodeId, path: commandPath },
						),
					],
				};
			}
			const channel = descriptor.keyframeChannel;
			if (!channel) {
				return {
					issues: [
						createAgentIssue(
							"agent.bindable-property-not-keyframable",
							"error",
							`Motion command ${index} cannot keyframe non-animatable bindable property "${command.propertyId}".`,
							{ kind: "node", id: command.nodeId, path: commandPath },
						),
					],
				};
			}
			// Delegate to the existing keyframe compiler so node validation and track
			// resolution stay in one place. `channel.property` is already a subset of
			// AnimatableProperty, so motion data still lands only in MotionDocument.
			return compileAgentMotionCommand(
				context,
				{
					type: "motion/upsert-keyframe",
					nodeId: command.nodeId,
					property: channel.property,
					frame: command.frame,
					value: command.value,
				},
				index,
			);
		}
		case "motion/upsert-look-node-keyframe": {
			// Legacy artboardId is adapted at this one boundary. New callers provide a
			// concrete owner so a selection-scoped graph cannot fall through to a broad
			// artboard graph.
			const owner: LookGraphOwnerRef =
				command.owner ??
				(command.artboardId
					? { scope: "artboard", artboardId: command.artboardId }
					: { scope: "scene" });
			const issueTarget: AgentIssueTarget =
				owner.scope === "scene"
					? { kind: "document", id: context.scene.id, path: commandPath }
					: owner.scope === "node"
						? { kind: "node", id: owner.nodeId, path: commandPath }
						: { kind: "artboard", id: owner.artboardId, path: commandPath };
			const trackId = lookNodeTrackId(
				owner,
				command.lookNodeId,
				command.paramKey,
			);
			if (
				(owner.scope === "artboard" || owner.scope === "scoped-overlay") &&
				!findArtboardById(context.scene, owner.artboardId)
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.look-node-keyframe-artboard-missing",
							"error",
							`Motion command ${index} targets missing look-graph artboard "${owner.artboardId}".`,
							issueTarget,
						),
					],
				};
			}
			if (owner.scope === "node" && !findNode(context.scene, owner.nodeId)) {
				return {
					issues: [
						createAgentIssue(
							"agent.look-node-keyframe-owner-node-missing",
							"error",
							`Motion command ${index} targets missing Look owner node "${owner.nodeId}".`,
							issueTarget,
						),
					],
				};
			}
			if (owner.scope === "scoped-overlay") {
				const artboard = findArtboardById(context.scene, owner.artboardId);
				const overlay = artboard
					? scopedLookGraphOverlays(artboard).find(
							(look) => look.id === owner.scopedLookId,
						)
					: undefined;
				if (!overlay) {
					return {
						issues: [
							createAgentIssue(
								"agent.look-node-keyframe-scoped-overlay-missing",
								"error",
								`Motion command ${index} targets missing scoped look overlay "${owner.scopedLookId}".`,
								issueTarget,
							),
						],
					};
				}
				const expectedTargetNodeIds = command.expectedTargetNodeIds;
				const targetSetMatches =
					expectedTargetNodeIds !== undefined &&
					new Set(expectedTargetNodeIds).size ===
						expectedTargetNodeIds.length &&
					expectedTargetNodeIds.length === overlay.targetNodeIds.length &&
					expectedTargetNodeIds.every((nodeId) =>
						overlay.targetNodeIds.includes(nodeId),
					);
				if (!targetSetMatches) {
					return {
						issues: [
							createAgentIssue(
								"agent.look-node-keyframe-scoped-target-set-mismatch",
								"error",
								`Motion command ${index} must supply the exact existing scoped-overlay target set before keyframing it.`,
								issueTarget,
							),
						],
					};
				}
			}
			const graph = lookGraphForLookNodeKeyframeOwner(context.scene, owner);
			if (!graph) {
				return {
					issues: [
						createAgentIssue(
							"agent.look-node-keyframe-graph-missing",
							"error",
							`Motion command ${index} targets an empty look graph.`,
							issueTarget,
						),
					],
				};
			}
			const node = graph.nodes.find((item) => item.id === command.lookNodeId);
			if (!node) {
				return {
					issues: [
						createAgentIssue(
							"agent.look-node-keyframe-node-missing",
							"error",
							`Motion command ${index} targets missing look node "${command.lookNodeId}".`,
							{ kind: "motion-track", id: trackId, path: commandPath },
						),
					],
				};
			}
			const paramSpec = lookGraphNodeParamSpec(node.kind, command.paramKey);
			if (!paramSpec) {
				return {
					issues: [
						createAgentIssue(
							"agent.look-node-keyframe-param-unknown",
							"error",
							`Motion command ${index} references unknown ${node.kind} look-node param "${command.paramKey}".`,
							{ kind: "motion-track", id: trackId, path: commandPath },
						),
					],
				};
			}
			if (!isLookGraphNodeParamKeyframable(node.kind, command.paramKey)) {
				return {
					issues: [
						createAgentIssue(
							"agent.look-node-keyframe-param-not-keyframable",
							"error",
							`Motion command ${index} cannot keyframe ${paramSpec.valueType} look-node param "${command.paramKey}".`,
							{ kind: "motion-track", id: trackId, path: commandPath },
						),
					],
				};
			}
			if (
				node.payload.kind === "blur" &&
				command.paramKey === "radiusY" &&
				node.payload.radiusY === undefined
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.look-node-keyframe-param-linked",
							"error",
							`Motion command ${index} cannot keyframe blur radiusY while X/Y are linked; set an explicit radiusY first.`,
							{ kind: "motion-track", id: trackId, path: commandPath },
						),
					],
				};
			}
			if (!Number.isFinite(command.frame) || !Number.isFinite(command.value)) {
				return {
					issues: [
						createAgentIssue(
							"agent.look-node-keyframe-value-invalid",
							"error",
							`Motion command ${index} must use finite frame and value numbers for look-node keyframes.`,
							{ kind: "motion-track", id: trackId, path: commandPath },
						),
					],
				};
			}
			return {
				compiled: {
					command: upsertLookNodeKeyframe(
						owner,
						command.lookNodeId,
						command.paramKey,
						command.frame,
						command.value,
					),
					target: {
						kind: "motion-track",
						id: trackId,
						path: commandPath,
					},
				},
				issues: [],
			};
		}
		case "motion/remove-look-node-track": {
			// Same owner resolution + validation gates as
			// motion/upsert-look-node-keyframe (artboard, scoped-overlay exact-match,
			// graph, node, param), minus the keyframe-authoring checks
			// (keyframable/blur-linked/finite): removing an orphaned track must
			// succeed even where a new key could not be authored. The decisive gate is
			// that the (owner, node, param) track actually exists.
			const owner: LookGraphOwnerRef = command.owner;
			const issueTarget: AgentIssueTarget =
				owner.scope === "scene"
					? { kind: "document", id: context.scene.id, path: commandPath }
					: owner.scope === "node"
						? { kind: "node", id: owner.nodeId, path: commandPath }
						: { kind: "artboard", id: owner.artboardId, path: commandPath };
			const trackId = lookNodeTrackId(
				owner,
				command.lookNodeId,
				command.paramKey,
			);
			if (
				(owner.scope === "artboard" || owner.scope === "scoped-overlay") &&
				!findArtboardById(context.scene, owner.artboardId)
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.look-node-keyframe-artboard-missing",
							"error",
							`Motion command ${index} targets missing look-graph artboard "${owner.artboardId}".`,
							issueTarget,
						),
					],
				};
			}
			if (owner.scope === "node" && !findNode(context.scene, owner.nodeId)) {
				return {
					issues: [
						createAgentIssue(
							"agent.look-node-keyframe-owner-node-missing",
							"error",
							`Motion command ${index} targets missing Look owner node "${owner.nodeId}".`,
							issueTarget,
						),
					],
				};
			}
			if (owner.scope === "scoped-overlay") {
				const artboard = findArtboardById(context.scene, owner.artboardId);
				const overlay = artboard
					? scopedLookGraphOverlays(artboard).find(
							(look) => look.id === owner.scopedLookId,
						)
					: undefined;
				if (!overlay) {
					return {
						issues: [
							createAgentIssue(
								"agent.look-node-keyframe-scoped-overlay-missing",
								"error",
								`Motion command ${index} targets missing scoped look overlay "${owner.scopedLookId}".`,
								issueTarget,
							),
						],
					};
				}
				const expectedTargetNodeIds = command.expectedTargetNodeIds;
				const targetSetMatches =
					expectedTargetNodeIds !== undefined &&
					new Set(expectedTargetNodeIds).size ===
						expectedTargetNodeIds.length &&
					expectedTargetNodeIds.length === overlay.targetNodeIds.length &&
					expectedTargetNodeIds.every((nodeId) =>
						overlay.targetNodeIds.includes(nodeId),
					);
				if (!targetSetMatches) {
					return {
						issues: [
							createAgentIssue(
								"agent.look-node-keyframe-scoped-target-set-mismatch",
								"error",
								`Motion command ${index} must supply the exact existing scoped-overlay target set before removing its track.`,
								issueTarget,
							),
						],
					};
				}
			}
			const graph = lookGraphForLookNodeKeyframeOwner(context.scene, owner);
			if (!graph) {
				return {
					issues: [
						createAgentIssue(
							"agent.look-node-keyframe-graph-missing",
							"error",
							`Motion command ${index} targets an empty look graph.`,
							issueTarget,
						),
					],
				};
			}
			const node = graph.nodes.find((item) => item.id === command.lookNodeId);
			if (!node) {
				return {
					issues: [
						createAgentIssue(
							"agent.look-node-keyframe-node-missing",
							"error",
							`Motion command ${index} targets missing look node "${command.lookNodeId}".`,
							{ kind: "motion-track", id: trackId, path: commandPath },
						),
					],
				};
			}
			if (!lookGraphNodeParamSpec(node.kind, command.paramKey)) {
				return {
					issues: [
						createAgentIssue(
							"agent.look-node-keyframe-param-unknown",
							"error",
							`Motion command ${index} references unknown ${node.kind} look-node param "${command.paramKey}".`,
							{ kind: "motion-track", id: trackId, path: commandPath },
						),
					],
				};
			}
			if (
				!context.motion.lookNodeTracks?.some((track) => track.id === trackId)
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-missing-track",
							"error",
							`Motion command ${index} targets missing look-node track "${trackId}".`,
							{ kind: "motion-track", id: trackId, path: commandPath },
						),
					],
				};
			}
			return {
				compiled: {
					command: removeLookNodeParamTrack(
						owner,
						command.lookNodeId,
						command.paramKey,
					),
					target: {
						kind: "motion-track",
						id: trackId,
						path: commandPath,
					},
				},
				issues: [],
			};
		}
		case "motion/upsert-camera-keyframe": {
			if (!findSceneCameraRig(context.scene, command.cameraRigId)) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-missing-camera-rig",
							"error",
							`Motion command ${index} targets missing scene camera "${command.cameraRigId}".`,
							{ kind: "document", id: context.scene.id, path: commandPath },
						),
					],
				};
			}
			const existingTrack = findCameraTrackByTarget(
				context.motion,
				command.cameraRigId,
				command.property,
			);
			const target: AgentIssueTarget = {
				kind: "motion-track",
				id:
					existingTrack?.id ??
					cameraRigTrackId(command.cameraRigId, command.property),
				path: commandPath,
			};
			return {
				compiled: {
					command: upsertCameraRigKeyframe(
						command.cameraRigId,
						command.property,
						command.frame,
						command.value,
					),
					target,
				},
				issues: [],
			};
		}
		case "motion/upsert-production-control-keyframe":
		case "motion/remove-production-control-keyframe":
		case "motion/retime-production-control-keyframe":
			return compileAgentProductionControlCommand(
				command,
				context,
				index,
				commandPath,
			);
		case "motion/set-camera-channel-expression":
		case "motion/remove-camera-channel-expression": {
			const target: AgentIssueTarget = {
				kind: "document",
				id: context.scene.id,
				path: commandPath,
			};
			if (!findSceneCameraRig(context.scene, command.cameraRigId)) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-missing-camera-rig",
							"error",
							`Motion command ${index} targets missing scene camera "${command.cameraRigId}".`,
							target,
						),
					],
				};
			}
			if (command.type === "motion/remove-camera-channel-expression") {
				return {
					compiled: {
						command: removeCameraChannelExpression(
							command.cameraRigId,
							command.channel,
						),
						target,
					},
					issues: [],
				};
			}
			const parsed = parseCameraChannelExpression(command.expression);
			if (parsed.kind !== "ok") {
				return {
					issues: [
						createAgentIssue(
							"agent.bindable-expression-invalid",
							"error",
							`Motion command ${index} has invalid camera channel expression: ${parsed.message}`,
							target,
						),
					],
				};
			}
			return {
				compiled: {
					command: setCameraChannelExpression(
						command.cameraRigId,
						command.channel,
						parsed.expr,
					),
					target,
				},
				issues: [],
			};
		}
		case "motion/set-text-animator-offset-expression":
		case "motion/remove-text-animator-offset-expression": {
			const target: AgentIssueTarget = {
				kind: "motion-track",
				id: command.bindingId,
				path: commandPath,
			};
			const binding = context.motion.textAnimators?.find(
				(candidate) => candidate.id === command.bindingId,
			);
			if (!binding?.selectors[command.selectorIndex]) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-missing-track",
							"error",
							`Motion command ${index} targets missing text animator selector "${command.bindingId}[${command.selectorIndex}]".`,
							target,
						),
					],
				};
			}
			if (command.type === "motion/remove-text-animator-offset-expression") {
				return {
					compiled: {
						command: removeTextAnimatorOffsetExpression(
							command.bindingId,
							command.selectorIndex,
						),
						target,
					},
					issues: [],
				};
			}
			const parsed = parseTextAnimatorOffsetExpression(command.expression);
			if (parsed.kind !== "ok") {
				return {
					issues: [
						createAgentIssue(
							"agent.bindable-expression-invalid",
							"error",
							`Motion command ${index} has invalid text offset expression: ${parsed.message}`,
							target,
						),
					],
				};
			}
			return {
				compiled: {
					command: setTextAnimatorOffsetExpression(
						command.bindingId,
						command.selectorIndex,
						parsed.expr,
					),
					target,
				},
				issues: [],
			};
		}
		case "motion/upsert-camera-vector-keyframes": {
			if (!findSceneCameraRig(context.scene, command.cameraRigId)) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-missing-camera-rig",
							"error",
							`Motion command ${index} targets missing scene camera "${command.cameraRigId}".`,
							{ kind: "document", id: context.scene.id, path: commandPath },
						),
					],
				};
			}
			const values = Object.values(command.value);
			if (
				!values.some((value) => Number.isFinite(value)) ||
				!values.every((value) => value === undefined || Number.isFinite(value))
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-invalid-camera-vector",
							"error",
							`Motion command ${index} must include at least one finite camera vector axis.`,
							{ kind: "document", id: context.scene.id, path: commandPath },
						),
					],
				};
			}
			return {
				compiled: {
					command: upsertCameraRigVectorKeyframes(
						command.cameraRigId,
						command.kind,
						command.frame,
						command.value,
					),
					target: {
						kind: "motion-track",
						id: `camera:${command.cameraRigId}:${command.kind}`,
						path: commandPath,
					},
				},
				issues: [],
			};
		}
		case "motion/remove-camera-keyframe": {
			const track = findCameraTrackByTarget(
				context.motion,
				command.cameraRigId,
				command.property,
			);
			const trackId = cameraRigTrackId(command.cameraRigId, command.property);
			if (!track) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-missing-track",
							"error",
							`Motion command ${index} targets missing camera track "${trackId}".`,
							{ kind: "motion-track", id: trackId, path: commandPath },
						),
					],
				};
			}
			if (!track.keyframes.some((item) => item.time === command.frame)) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-missing-keyframe",
							"error",
							`Motion command ${index} cannot find camera keyframe ${command.frame} on track "${track.id}".`,
							{ kind: "motion-track", id: track.id, path: commandPath },
						),
					],
				};
			}
			return {
				compiled: {
					command: removeCameraRigKeyframe(
						command.cameraRigId,
						command.property,
						command.frame,
					),
					target: { kind: "motion-track", id: track.id, path: commandPath },
				},
				issues: [],
			};
		}
		case "motion/remove-camera-track": {
			const track = findCameraTrackByTarget(
				context.motion,
				command.cameraRigId,
				command.property,
			);
			const trackId = cameraRigTrackId(command.cameraRigId, command.property);
			if (!track) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-missing-track",
							"error",
							`Motion command ${index} targets missing camera track "${trackId}".`,
							{ kind: "motion-track", id: trackId, path: commandPath },
						),
					],
				};
			}
			return {
				compiled: {
					command: removeCameraRigTrack(command.cameraRigId, command.property),
					target: { kind: "motion-track", id: track.id, path: commandPath },
				},
				issues: [],
			};
		}
		case "motion/remove-camera-rig-tracks": {
			const hasCameraData =
				context.motion.cameraTracks?.some(
					(track) => track.target.cameraRigId === command.cameraRigId,
				) ||
				context.motion.cameraCuts?.some(
					(segment) => segment.cameraRigId === command.cameraRigId,
				) ||
				false;
			if (!hasCameraData) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-missing-track",
							"error",
							`Motion command ${index} found no camera motion data for scene camera "${command.cameraRigId}".`,
							{ kind: "document", id: context.scene.id, path: commandPath },
						),
					],
				};
			}
			return {
				compiled: {
					command: removeCameraRigTracks(command.cameraRigId),
					target: { kind: "document", id: context.scene.id, path: commandPath },
				},
				issues: [],
			};
		}
		case "motion/upsert-camera-cut": {
			const { segment } = command;
			const target: AgentIssueTarget = {
				kind: "artboard",
				id: segment.artboardId,
				path: commandPath,
			};
			if (!findArtboardById(context.scene, segment.artboardId)) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-missing-artboard",
							"error",
							`Motion command ${index} targets missing camera-cut artboard "${segment.artboardId}".`,
							target,
						),
					],
				};
			}
			const rig = findSceneCameraRig(context.scene, segment.cameraRigId);
			if (!rig) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-missing-camera-rig",
							"error",
							`Motion command ${index} targets missing scene camera "${segment.cameraRigId}".`,
							target,
						),
					],
				};
			}
			if (!cameraRigScopesArtboard(rig, segment.artboardId)) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-camera-scope-mismatch",
							"error",
							`Motion command ${index} cannot use scene camera "${segment.cameraRigId}" on artboard "${segment.artboardId}".`,
							target,
						),
					],
				};
			}
			if (segment.durationFrames <= 0) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-invalid-camera-cut",
							"error",
							`Motion command ${index} must use a positive camera-cut duration.`,
							target,
						),
					],
				};
			}
			return {
				compiled: {
					command: upsertCameraCutSegment(segment),
					target,
				},
				issues: [],
			};
		}
		case "motion/retime-camera-cut": {
			const segment = findCameraCutById(context.motion, command.segmentId);
			const target: AgentIssueTarget = {
				kind: "document",
				id: context.scene.id,
				path: commandPath,
			};
			if (!segment) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-missing-camera-cut",
							"error",
							`Motion command ${index} targets missing camera cut "${command.segmentId}".`,
							target,
						),
					],
				};
			}
			if (
				command.startFrame === undefined &&
				command.durationFrames === undefined
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-invalid-camera-cut",
							"error",
							`Motion command ${index} must retime at least one camera-cut field.`,
							target,
						),
					],
				};
			}
			if (command.durationFrames !== undefined && command.durationFrames <= 0) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-invalid-camera-cut",
							"error",
							`Motion command ${index} must use a positive camera-cut duration.`,
							target,
						),
					],
				};
			}
			return {
				compiled: {
					command: retimeCameraCutSegment(command),
					target: {
						kind: "artboard",
						id: segment.artboardId,
						path: commandPath,
					},
				},
				issues: [],
			};
		}
		case "motion/remove-camera-cut": {
			const segment = findCameraCutById(context.motion, command.segmentId);
			if (!segment) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-missing-camera-cut",
							"error",
							`Motion command ${index} targets missing camera cut "${command.segmentId}".`,
							{ kind: "document", id: context.scene.id, path: commandPath },
						),
					],
				};
			}
			return {
				compiled: {
					command: removeCameraCutSegment(command.segmentId),
					target: {
						kind: "artboard",
						id: segment.artboardId,
						path: commandPath,
					},
				},
				issues: [],
			};
		}
		case "motion/retime-camera-keyframe": {
			const track = findCameraTrackById(context.motion, command.trackId);
			if (!track) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-missing-track",
							"error",
							`Motion command ${index} targets missing camera track "${command.trackId}".`,
							{ kind: "motion-track", id: command.trackId, path: commandPath },
						),
					],
				};
			}
			const keyframe = track.keyframes.find(
				(item) => item.time === command.fromFrame,
			);
			if (!keyframe) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-missing-keyframe",
							"error",
							`Motion command ${index} cannot find camera keyframe ${command.fromFrame} on track "${command.trackId}".`,
							{ kind: "motion-track", id: command.trackId, path: commandPath },
						),
					],
				};
			}
			const snappedTarget = snapMotionFrame(
				command.toFrame,
				context.motion.durationFrames,
			);
			const occupied = track.keyframes.some(
				(item) => item !== keyframe && item.time === snappedTarget,
			);
			if (occupied) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-keyframe-collision",
							"error",
							`Motion command ${index} would collide with camera keyframe ${snappedTarget} on track "${command.trackId}".`,
							{ kind: "motion-track", id: command.trackId, path: commandPath },
						),
					],
				};
			}
			return {
				compiled: {
					command: setCameraRigKeyframeTime(
						command.trackId,
						command.fromFrame,
						command.toFrame,
						`agent-motion-camera-retime:${command.trackId}:${command.fromFrame}:${snappedTarget}`,
					),
					target: {
						kind: "motion-track",
						id: command.trackId,
						path: commandPath,
					},
				},
				issues: [],
			};
		}
		case "motion/set-camera-keyframe-easing": {
			const track = findCameraTrackById(context.motion, command.trackId);
			if (!track) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-missing-track",
							"error",
							`Motion command ${index} targets missing camera track "${command.trackId}".`,
							{ kind: "motion-track", id: command.trackId, path: commandPath },
						),
					],
				};
			}
			if (!track.keyframes.some((item) => item.time === command.frame)) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-missing-keyframe",
							"error",
							`Motion command ${index} cannot find camera keyframe ${command.frame} on track "${command.trackId}".`,
							{ kind: "motion-track", id: command.trackId, path: commandPath },
						),
					],
				};
			}
			const target: AgentIssueTarget = {
				kind: "motion-track",
				id: command.trackId,
				path: commandPath,
			};
			const compiledEasing = compileKeyframeEasing(
				command.easing,
				index,
				target,
			);
			if (compiledEasing.issues.length > 0 || !compiledEasing.easing) {
				return { issues: compiledEasing.issues };
			}
			const easingCommand =
				compiledEasing.easing.kind === "preset"
					? setCameraRigKeyframeEasing(
							command.trackId,
							command.frame,
							compiledEasing.easing.preset,
						)
					: setCameraRigKeyframeEasingCurve(
							command.trackId,
							command.frame,
							compiledEasing.easing.curve,
						);
			return {
				compiled: { command: easingCommand, target },
				issues: [],
			};
		}
		case "motion/apply-text-animator": {
			const node = findNode(context.scene, command.nodeId);
			if (!node) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-missing-node",
							"error",
							`Motion command ${index} targets missing scene node "${command.nodeId}".`,
							{ kind: "node", id: command.nodeId, path: commandPath },
						),
					],
				};
			}
			const target =
				command.target ??
				(node.geometry.kind === "text"
					? "live-text"
					: node.children && node.children.length > 0
						? "outline-group"
						: undefined);
			if (!target) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-invalid-target",
							"error",
							`Motion command ${index} cannot animate node "${command.nodeId}": it is neither a text node nor a group.`,
							{ kind: "node", id: command.nodeId, path: commandPath },
						),
					],
				};
			}
			return {
				compiled: {
					command: setTextAnimator(
						createTextAnimatorPreset(command.preset, {
							nodeId: command.nodeId,
							target,
							durationFrames: command.durationFrames,
						}),
					),
					target: { kind: "node", id: command.nodeId, path: commandPath },
				},
				issues: [],
			};
		}
		case "motion/remove-text-animator": {
			return {
				compiled: {
					command: removeTextAnimator(`text-anim-${command.nodeId}`),
					target: { kind: "node", id: command.nodeId, path: commandPath },
				},
				issues: [],
			};
		}
		case "motion/set-text-animator-enabled": {
			return {
				compiled: {
					command: setTextAnimatorEnabled(
						`text-anim-${command.nodeId}`,
						command.enabled,
					),
					target: { kind: "node", id: command.nodeId, path: commandPath },
				},
				issues: [],
			};
		}
		case "motion/create-clip": {
			const { clip } = command;
			const clipId = clip.id ?? createId("clip");
			const target: AgentIssueTarget = {
				kind: "motion-track",
				id: clipId,
				path: commandPath,
			};
			if (findClipById(context.motion, clipId)) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-clip-id-collision",
							"error",
							`Motion command ${index} cannot create clip: id "${clipId}" already exists.`,
							target,
						),
					],
				};
			}
			// Pre-check against the SAME normalized range createAnimationClip computes
			// internally (normalizeAnimationClipRange runs before its own track
			// sanitization), so this compiler's rejected-track determination cannot
			// diverge from what the factory actually applies.
			const normalizedRange = normalizeAnimationClipRange(
				{ startFrame: clip.startFrame, durationFrames: clip.durationFrames },
				context.motion.durationFrames,
			);
			const validation = validateAnimationClipTrackAssignment(
				context.motion,
				clip.trackIds ?? [],
				{ clipId, range: normalizedRange },
			);
			const issues = validation.rejected.map((rejected) =>
				createAgentIssue(
					"agent.motion-command-clip-track-rejected",
					"warning",
					`Motion command ${index} could not assign track "${rejected.trackId}" to the new clip: ${rejected.reason}.`,
					target,
				),
			);
			return {
				compiled: {
					command: createAnimationClip({
						id: clipId,
						name: clip.name,
						startFrame: clip.startFrame,
						durationFrames: clip.durationFrames,
						trackIds: validation.trackIds,
					}),
					target,
				},
				issues,
			};
		}
		case "motion/rename-clip": {
			if (!findClipById(context.motion, command.clipId)) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-missing-clip",
							"error",
							`Motion command ${index} targets missing clip "${command.clipId}".`,
							{ kind: "motion-track", id: command.clipId, path: commandPath },
						),
					],
				};
			}
			return {
				compiled: {
					command: renameAnimationClip(command.clipId, command.name),
					target: {
						kind: "motion-track",
						id: command.clipId,
						path: commandPath,
					},
				},
				issues: [],
			};
		}
		case "motion/trim-clip": {
			if (!findClipById(context.motion, command.clipId)) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-missing-clip",
							"error",
							`Motion command ${index} targets missing clip "${command.clipId}".`,
							{ kind: "motion-track", id: command.clipId, path: commandPath },
						),
					],
				};
			}
			return {
				compiled: {
					command: trimAnimationClip(command.clipId, {
						startFrame: command.startFrame,
						durationFrames: command.durationFrames,
					}),
					target: {
						kind: "motion-track",
						id: command.clipId,
						path: commandPath,
					},
				},
				issues: [],
			};
		}
		case "motion/assign-clip-tracks": {
			const clip = findClipById(context.motion, command.clipId);
			const target: AgentIssueTarget = {
				kind: "motion-track",
				id: command.clipId,
				path: commandPath,
			};
			if (!clip) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-missing-clip",
							"error",
							`Motion command ${index} targets missing clip "${command.clipId}".`,
							target,
						),
					],
				};
			}
			const validation = validateAnimationClipTrackAssignment(
				context.motion,
				command.trackIds,
				{ clipId: command.clipId, range: clip },
			);
			const issues = validation.rejected.map((rejected) =>
				createAgentIssue(
					"agent.motion-command-clip-track-rejected",
					"warning",
					`Motion command ${index} could not assign track "${rejected.trackId}" to clip "${command.clipId}": ${rejected.reason}.`,
					target,
				),
			);
			return {
				compiled: {
					command: assignAnimationClipTracks(
						command.clipId,
						validation.trackIds,
					),
					target,
				},
				issues,
			};
		}
		case "motion/reorder-clip": {
			const fromIndex = context.motion.clips.findIndex(
				(item) => item.id === command.clipId,
			);
			const target: AgentIssueTarget = {
				kind: "motion-track",
				id: command.clipId,
				path: commandPath,
			};
			if (fromIndex < 0) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-missing-clip",
							"error",
							`Motion command ${index} targets missing clip "${command.clipId}".`,
							target,
						),
					],
				};
			}
			const lastIndex = context.motion.clips.length - 1;
			const targetIndex = Number.isFinite(command.toIndex)
				? Math.min(lastIndex, Math.max(0, Math.round(command.toIndex)))
				: fromIndex;
			if (targetIndex === fromIndex) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-clip-reorder-noop",
							"info",
							`Motion command ${index} did not move clip "${command.clipId}": it is already at index ${targetIndex}.`,
							target,
						),
					],
				};
			}
			return {
				compiled: {
					command: reorderAnimationClip(command.clipId, command.toIndex),
					target,
				},
				issues: [],
			};
		}
		case "motion/delete-clip": {
			if (!findClipById(context.motion, command.clipId)) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-missing-clip",
							"error",
							`Motion command ${index} targets missing clip "${command.clipId}".`,
							{ kind: "motion-track", id: command.clipId, path: commandPath },
						),
					],
				};
			}
			return {
				compiled: {
					command: deleteAnimationClip(command.clipId),
					target: {
						kind: "motion-track",
						id: command.clipId,
						path: commandPath,
					},
				},
				issues: [],
			};
		}
		case "motion/create-automation-track":
		case "motion/update-automation-track": {
			const target: AgentIssueTarget = {
				kind: "document",
				id: context.scene.id,
				path: commandPath,
			};
			const invalidKeyframe = command.track.keyframes.find(
				(keyframe) =>
					!Number.isInteger(keyframe.frame) ||
					keyframe.frame < 0 ||
					keyframe.frame >= context.motion.durationFrames,
			);
			if (invalidKeyframe) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-automation-keyframe-out-of-range",
							"error",
							`Motion command ${index} has automation keyframe ${invalidKeyframe.frame}; frames must be whole values inside 0..${Math.max(0, context.motion.durationFrames - 1)}.`,
							target,
						),
					],
				};
			}
			if (command.type === "motion/update-automation-track") {
				const trackIndex = command.trackIndex;
				if (
					!Number.isInteger(trackIndex) ||
					trackIndex < 0 ||
					trackIndex >= (context.motion.automation?.tracks.length ?? 0)
				) {
					return {
						issues: [
							createAgentIssue(
								"agent.motion-command-missing-automation-track",
								"error",
								`Motion command ${index} targets missing automation track index ${trackIndex}.`,
								target,
							),
						],
					};
				}
				return {
					compiled: {
						command: updateAutomationTrack(trackIndex, command.track),
						target,
					},
					issues: [],
				};
			}
			return {
				compiled: { command: createAutomationTrack(command.track), target },
				issues: [],
			};
		}
		case "motion/remove-automation-track":
		case "motion/reorder-automation-track": {
			const trackCount = context.motion.automation?.tracks.length ?? 0;
			const target: AgentIssueTarget = {
				kind: "document",
				id: context.scene.id,
				path: commandPath,
			};
			if (
				!Number.isInteger(command.trackIndex) ||
				command.trackIndex < 0 ||
				command.trackIndex >= trackCount
			) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-missing-automation-track",
							"error",
							`Motion command ${index} targets missing automation track index ${command.trackIndex}.`,
							target,
						),
					],
				};
			}
			if (command.type === "motion/reorder-automation-track") {
				if (!Number.isInteger(command.toIndex)) {
					return {
						issues: [
							createAgentIssue(
								"agent.motion-command-invalid-automation-index",
								"error",
								`Motion command ${index} requires a whole automation destination index.`,
								target,
							),
						],
					};
				}
				return {
					compiled: {
						command: reorderAutomationTrack(
							command.trackIndex,
							command.toIndex,
						),
						target,
					},
					issues: [],
				};
			}
			return {
				compiled: {
					command: removeAutomationTrack(command.trackIndex),
					target,
				},
				issues: [],
			};
		}
		case "motion/set-automation-enabled": {
			if (!context.motion.automation && !command.enabled) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-automation-missing",
							"error",
							`Motion command ${index} cannot disable automation because the document has no automation recipe.`,
							{ kind: "document", id: context.scene.id, path: commandPath },
						),
					],
				};
			}
			return {
				compiled: {
					command: setAutomationEnabled(command.enabled),
					target: { kind: "document", id: context.scene.id, path: commandPath },
				},
				issues: [],
			};
		}
		case "motion/remove-automation": {
			if (!context.motion.automation) {
				return {
					issues: [
						createAgentIssue(
							"agent.motion-command-automation-missing",
							"error",
							`Motion command ${index} cannot remove automation because the document has no automation recipe.`,
							{ kind: "document", id: context.scene.id, path: commandPath },
						),
					],
				};
			}
			return {
				compiled: {
					command: removeAutomationRecipe(),
					target: { kind: "document", id: context.scene.id, path: commandPath },
				},
				issues: [],
			};
		}
		case "motion/propagate-to-instances": {
			const target = {
				kind: "document",
				id: context.scene.id,
				path: commandPath,
			} as const;
			const requestedSourceIds = command.sourceNodeIds
				? [...new Set(command.sourceNodeIds)]
				: undefined;
			let symbolIds: Set<string> | undefined;
			if (requestedSourceIds) {
				symbolIds = new Set<string>();
				const issues: AgentIssue[] = [];
				for (const sourceNodeId of requestedSourceIds) {
					const symbol = findComponentSymbolBySourceNodeId(
						context.scene,
						sourceNodeId,
					);
					if (!symbol) {
						issues.push(
							createAgentIssue(
								"agent.component-source-missing",
								"error",
								`Motion command ${index} targets "${sourceNodeId}", which is not a component source node.`,
								{ kind: "node", id: sourceNodeId, path: commandPath },
							),
						);
						continue;
					}
					symbolIds.add(symbol.id);
				}
				if (issues.length > 0) return { issues };
			}
			const commands = planMotionPropagation(
				context.scene,
				undefined,
				symbolIds,
			);
			if (commands.length === 0) {
				return {
					issues: [
						createAgentIssue(
							"agent.component-propagation-nothing-to-propagate",
							"error",
							`Motion command ${index} matches no linked component instances to propagate to.`,
							target,
						),
					],
				};
			}
			return {
				compiled: {
					command: combineMotionCommands(commands, {
						type: "motion/propagate-to-instances",
						label: "Propagate component motion",
					}),
					target,
				},
				issues: [],
			};
		}
	}
};

/**
 * C2-R1 D1: reconciles a separate `motion/set-keyframe-easing` that addresses a
 * track CREATED earlier in the SAME batch — by that track's synthetic
 * `${nodeId}:${property}` id — into the creating `motion/upsert-keyframe` as inline
 * easing, then drops the standalone command. `appendTrack` gives a brand-new track a
 * RANDOM id, not the synthetic one, so a by-id easing on a just-created track both
 * fails compile (`missing-track`) and, even if it validated, would miss at apply.
 * `upsertKeyframeWithEasing` instead resolves its track BY TARGET at run time, so the
 * folded form applies faithfully regardless of the random id. The fold fires only when
 * ALL hold: (a) no real track of that synthetic id exists in the pre-batch snapshot,
 * (b) no real track already covers that `(nodeId, property)` (so this really is a
 * batch-created track), and (c) an earlier upsert in this batch set that exact
 * (snapped) frame. A set-keyframe-easing on a pre-existing real-id track is left
 * untouched (that by-id path already applies and is what D2 relies on); an easing on a
 * frame no upsert creates stays an honest typed error. Validation is never weakened.
 */
const foldSameBatchCreatedTrackEasings = (
	context: AgentDocumentContext,
	commands: readonly AgentMotionCommand[],
): readonly AgentMotionCommand[] => {
	const createdTrackFrames = new Map<string, Map<number, number>>();
	commands.forEach((command, index) => {
		if (command.type !== "motion/upsert-keyframe") return;
		if (findTrackByTarget(context.motion, command.nodeId, command.property)) {
			return;
		}
		const synthetic = trackTargetId(command.nodeId, command.property);
		if (findTrackById(context.motion, synthetic)) return;
		const frames =
			createdTrackFrames.get(synthetic) ?? new Map<number, number>();
		frames.set(
			snapMotionFrame(command.frame, context.motion.durationFrames),
			index,
		);
		createdTrackFrames.set(synthetic, frames);
	});
	if (createdTrackFrames.size === 0) return commands;

	const next: AgentMotionCommand[] = commands.map((command) => command);
	const folded = new Set<number>();
	commands.forEach((command, index) => {
		if (command.type !== "motion/set-keyframe-easing") return;
		const frames = createdTrackFrames.get(command.trackId);
		if (!frames) return;
		const upsertIndex = frames.get(
			snapMotionFrame(command.frame, context.motion.durationFrames),
		);
		if (upsertIndex === undefined || upsertIndex >= index) return;
		const upsert = next[upsertIndex];
		if (upsert?.type !== "motion/upsert-keyframe") return;
		next[upsertIndex] = { ...upsert, easing: command.easing };
		folded.add(index);
	});
	if (folded.size === 0) return commands;
	return next.filter((_, index) => !folded.has(index));
};

const compileAgentMotionCommands = (
	context: AgentDocumentContext,
	requestedCommands: readonly AgentMotionCommand[],
): {
	readonly commands: readonly AgentCompiledMotionCommand[];
	readonly issues: readonly AgentIssue[];
	readonly requestedCount: number;
} => {
	const commands = foldSameBatchCreatedTrackEasings(context, requestedCommands);
	const compiled: AgentCompiledMotionCommand[] = [];
	const issues: AgentIssue[] = [];
	// Sequential-draft batch semantics (C2-R1 D2): each command validates against
	// the motion state the PRIOR commands in this batch produce — mirroring the
	// runner's own sequential apply (`runMotionCommands`, and `applyLiveCompound`'s
	// per-command store apply) — so a `set-keyframe-easing`/`retime` addressing a
	// frame an earlier same-batch command created resolves instead of failing
	// against the stale pre-batch snapshot. Only the motion snapshot advances;
	// scene/grammar are unchanged by motion commands. This never suppresses an
	// issue: a command that genuinely fails against the draft still reports its
	// typed error, and a collision an earlier command now makes real surfaces as a
	// typed error rather than a silent runner drop.
	let draftMotion = context.motion;
	for (const [index, command] of commands.entries()) {
		const draftContext: AgentDocumentContext =
			draftMotion === context.motion
				? context
				: { ...context, motion: draftMotion };
		const result = compileAgentMotionCommand(draftContext, command, index);
		issues.push(...result.issues);
		if (result.compiled) {
			compiled.push(result.compiled);
			draftMotion = runMotionCommands(draftMotion, [
				result.compiled.command,
			]).document;
		}
	}
	return { commands: compiled, issues, requestedCount: commands.length };
};

const reviewCompiledMotionCommands = (
	requestedCommandCount: number,
	commands: readonly AgentCompiledMotionCommand[],
	issues: readonly AgentIssue[],
): AgentCommandReviewReport =>
	createCommandReviewReport(
		"motion",
		"apply_motion_commands",
		requestedCommandCount,
		commands.length,
		commands.map((command) => command.target),
		issues,
	);

/**
 * Compiles typed motion command envelopes into MotionDocument command-bus
 * commands. Scene data is only read for target validation; executing the
 * returned commands remains the caller's responsibility.
 */
export function compileAgentMotionCommandBatch(
	context: AgentDocumentContext,
	commands: readonly AgentMotionCommand[],
): AgentCompiledMotionCommandBatch {
	const compiled = compileAgentMotionCommands(context, commands);
	return {
		commands: compiled.commands,
		report: reviewCompiledMotionCommands(
			compiled.requestedCount,
			compiled.commands,
			compiled.issues,
		),
	};
}

/**
 * Reviews typed motion command envelopes against scene and motion snapshots
 * without mutating the motion store. Motion stays a side-car and missing scene
 * targets are reported before any apply path can run.
 */
export function reviewAgentMotionCommands(
	context: AgentDocumentContext,
	commands: readonly AgentMotionCommand[],
): AgentCommandReviewReport {
	return compileAgentMotionCommandBatch(context, commands).report;
}

const documentTimingIssueTarget = (
	context: AgentDocumentContext,
	artboardId?: string,
): AgentIssueTarget =>
	artboardId
		? { kind: "artboard", id: artboardId }
		: { kind: "document", id: context.scene.id };

const generatedWorkspaceNodeIdsForBinding = (
	context: AgentDocumentContext,
	bindingId: string,
): readonly string[] =>
	allNodes(context.scene)
		.filter((node) => {
			const value = node.data?.[MOTION_GRAMMAR_WORKSPACE_ROLE_DATA_KEY];
			if (!value || typeof value !== "object") return false;
			const role = value as Partial<MotionGrammarWorkspaceRoleData>;
			return (
				role.kind === "motion-grammar-workspace-role" &&
				role.schemaVersion === 1 &&
				role.bindingId === bindingId &&
				role.generated === true
			);
		})
		.map((node) => node.id);

const workspaceClipIdsForBinding = (
	context: AgentDocumentContext,
	bindingId: string,
): readonly string[] =>
	context.motion.clips
		.filter((clip) => clip.provenance?.bindingId === bindingId)
		.map((clip) => clip.id);

const compileAgentDocumentCommandBatch = (
	context: AgentDocumentContext,
	commands: readonly AgentDocumentCommand[],
	reportTool:
		| "apply_edit_plan_live"
		| "apply_document_commands" = "apply_edit_plan_live",
): AgentCompiledDocumentCommandBatch => {
	const issues: AgentIssue[] = [];
	const compiled: AgentCompiledDocumentCommand[] = [];
	if (commands.length === 0) {
		issues.push(
			createAgentIssue(
				"agent.document-command-count",
				"error",
				"A document command batch must contain at least one command.",
				{ kind: "document", id: context.scene.id },
			),
		);
	}
	for (const [index, command] of commands.entries()) {
		const commandPath = `commands.${index}`;
		const localIssues: AgentIssue[] = [];
		if (command.type === "document/update-timing") {
			const target = documentTimingIssueTarget(context, command.artboardId);
			if (!findArtboardById(context.scene, command.artboardId)) {
				localIssues.push(
					createAgentIssue(
						"agent.document-timing-artboard-missing",
						"error",
						`Document timing targets missing artboard "${command.artboardId}".`,
						target,
					),
				);
			}
			if (!Number.isInteger(command.fps) || command.fps <= 0) {
				localIssues.push(
					createAgentIssue(
						"agent.document-timing-fps-invalid",
						"error",
						"Document timing fps must be a positive whole number; it is never rounded or clamped.",
						target,
					),
				);
			}
			if (
				!Number.isInteger(command.durationFrames) ||
				command.durationFrames <= 0
			) {
				localIssues.push(
					createAgentIssue(
						"agent.document-timing-duration-invalid",
						"error",
						"Document timing durationFrames must be a positive whole number; it is never rounded or clamped.",
						target,
					),
				);
			}
			if (command.temporalPolicy !== "preserve-frame-indices") {
				localIssues.push(
					createAgentIssue(
						"agent.document-timing-temporal-policy-invalid",
						"error",
						'Document timing only supports temporalPolicy "preserve-frame-indices".',
						target,
					),
				);
			}
			if (command.outOfRangePolicy !== "reject") {
				localIssues.push(
					createAgentIssue(
						"agent.document-timing-out-of-range-policy-invalid",
						"error",
						'Document timing only supports outOfRangePolicy "reject".',
						target,
					),
				);
			}
			if (localIssues.length === 0) {
				for (const issue of motionTimingRangeIssues(
					context.motion,
					command.durationFrames,
				)) {
					localIssues.push(
						createAgentIssue(
							"agent.document-timing-out-of-range",
							"error",
							`Document timing would leave persisted motion address "${issue.path}" outside frame 0–${command.durationFrames - 1}; reject rather than clamp, delete, or retime it.`,
							{
								kind: "document",
								id: context.scene.id,
								path: issue.path,
							},
						),
					);
				}
			}
			const targetArtboard = findArtboardById(
				context.scene,
				command.artboardId,
			);
			const isShrink =
				command.durationFrames < context.motion.durationFrames ||
				(targetArtboard !== undefined &&
					command.durationFrames < targetArtboard.durationFrames);
			if (localIssues.length === 0 && isShrink) {
				const grammarBindingIds = new Set([
					...context.grammar.bindings.map((binding) => binding.id),
					...(context.motion.grammar?.bindings.map((binding) => binding.id) ??
						[]),
				]);
				for (const bindingId of grammarBindingIds) {
					localIssues.push(
						createAgentIssue(
							"agent.document-timing-grammar-timing-unproven",
							"error",
							`Document timing cannot shrink while motion-grammar binding "${bindingId}" is present: its derived timeline range is not persisted as a bounded frame address. Remove or materialize it first; this operation never retimes, clamps, or truncates grammar output.`,
							{
								kind: "motion-grammar-binding",
								id: bindingId,
							},
						),
					);
				}
			}
			if (localIssues.length === 0) {
				compiled.push({
					sceneCommands: [
						createUpdateArtboardCommand(
							command.artboardId,
							{ fps: command.fps, durationFrames: command.durationFrames },
							{ label: "Update document timing" },
						),
					],
					motionCommands: [updateMotionDocumentTiming(command)],
					grammarCommands: [],
					label: "Update document timing",
					targets: [
						{ kind: "artboard", id: command.artboardId },
						{ kind: "document", id: context.scene.id },
					],
				});
			}
		} else if (command.type === "document/apply-stroke-draw-on") {
			const plan = createStrokeDrawOnAuthoringPlan({
				scene: context.scene,
				nodeId: command.nodeId,
				durationFrames: command.durationFrames,
				reverse: command.reverse,
				...(command.bindingId ? { bindingId: command.bindingId } : {}),
			});
			if (plan.status === "blocked") {
				localIssues.push(
					createAgentIssue(
						"agent.stroke-draw-on-blocked",
						"error",
						`Document command ${index} cannot apply Stroke Draw-on: ${plan.reason}`,
						{ kind: "node", id: command.nodeId, path: commandPath },
					),
				);
			} else {
				compiled.push({
					sceneCommands: plan.sceneCommands,
					motionCommands: [],
					grammarCommands: plan.grammarCommands,
					label: "Apply Stroke Draw-on",
					targets: [
						{ kind: "node", id: command.nodeId },
						{ kind: "motion-grammar-binding", id: plan.binding.id },
					],
				});
			}
		} else if (
			command.type === "document/bake-motion-grammar-binding" ||
			command.type === "document/expand-motion-grammar-binding"
		) {
			const binding = context.grammar.bindings.find(
				(item) => item.id === command.bindingId,
			);
			if (!binding) {
				localIssues.push(
					createAgentIssue(
						"agent.motion-grammar-binding-missing",
						"error",
						`Document command ${index} targets missing binding "${command.bindingId}".`,
						{
							kind: "motion-grammar-binding",
							id: command.bindingId,
							path: commandPath,
						},
					),
				);
			} else if (
				describeMotionGrammarAuthoringProfile(binding)?.timeline.bakePolicy ===
				"not-supported"
			) {
				const profile = describeMotionGrammarAuthoringProfile(binding);
				localIssues.push(
					createAgentIssue(
						"agent.motion-grammar-expansion-not-supported",
						"error",
						`Document command ${index} cannot bake or expand ${profile?.label ?? binding.techniqueId}: ${profile?.expansion.description ?? "the owning authoring profile declares live-only output."}`,
						{
							kind: "motion-grammar-binding",
							id: binding.id,
							path: commandPath,
						},
					),
				);
			} else if (binding.techniqueId === "collision-bounce") {
				const collision = createCollisionBounceBakeCommands({
					binding,
					scene: context.scene,
				});
				if (collision.status === "blocked") {
					localIssues.push(
						createAgentIssue(
							"agent.motion-grammar-expansion-blocked",
							"error",
							`Document command ${index} cannot bake Collision Bounce: ${collision.reason}`,
							{
								kind: "motion-grammar-binding",
								id: binding.id,
								path: commandPath,
							},
						),
					);
				} else {
					const removeSource = command.sourceDisposition === "remove";
					const generatedNodeIds = removeSource
						? generatedWorkspaceNodeIdsForBinding(context, binding.id)
						: [];
					const workspaceClipIds = removeSource
						? workspaceClipIdsForBinding(context, binding.id)
						: [];
					compiled.push({
						sceneCommands:
							generatedNodeIds.length > 0
								? [createDeleteNodesCommand(generatedNodeIds)]
								: [],
						motionCommands: [
							...collision.commands,
							...workspaceClipIds.map((clipId) => deleteAnimationClip(clipId)),
						],
						grammarCommands: removeSource
							? [removeGrammarBinding(binding.id)]
							: [],
						label: "Bake Collision Bounce",
						targets: [
							{ kind: "motion-grammar-binding", id: binding.id },
							...binding.targetIds.map(
								(nodeId): AgentIssueTarget => ({ kind: "node", id: nodeId }),
							),
						],
					});
				}
			} else {
				const plan = createMotionGrammarEditableExpansionCommandPlan({
					binding,
					scene: context.scene,
					motion: context.motion,
					sampleStepFrames: command.sampleStepFrames,
					sourceDisposition: command.sourceDisposition,
				});
				if (plan.status === "blocked") {
					for (const reason of plan.reasons) {
						localIssues.push(
							createAgentIssue(
								"agent.motion-grammar-expansion-blocked",
								"error",
								`Document command ${index} cannot create editable motion: ${reason}`,
								{
									kind: "motion-grammar-binding",
									id: binding.id,
									path: commandPath,
								},
							),
						);
					}
				} else {
					compiled.push({
						sceneCommands: plan.sceneCommands,
						motionCommands: plan.motionCommands,
						grammarCommands: plan.grammarCommands,
						label: "Create Editable Motion",
						targets: [
							{ kind: "motion-grammar-binding", id: binding.id },
							...binding.targetIds.map(
								(nodeId): AgentIssueTarget => ({ kind: "node", id: nodeId }),
							),
						],
					});
				}
			}
		} else if (command.type === "document/replace-motion-grammar-role") {
			const binding = context.grammar.bindings.find(
				(item) => item.id === command.bindingId,
			);
			const fromNode = findNode(context.scene, command.fromNodeId);
			const toNode = findNode(context.scene, command.toNodeId);
			if (!binding || !fromNode || !toNode) {
				localIssues.push(
					createAgentIssue(
						"agent.motion-grammar-role-replacement-target-missing",
						"error",
						`Document command ${index} requires an existing binding, source node, and replacement node.`,
						{
							kind: "motion-grammar-binding",
							id: command.bindingId,
							path: commandPath,
						},
					),
				);
			} else {
				const plan = createMotionGrammarRoleReplacementPlan({
					binding,
					motion: context.motion,
					fromNodeId: command.fromNodeId,
					toNodeId: command.toNodeId,
				});
				if (plan.status === "blocked") {
					localIssues.push(
						createAgentIssue(
							`agent.motion-grammar-role-replacement-${plan.code}`,
							"error",
							`Document command ${index} cannot replace the role: ${plan.reason}`,
							{
								kind: "motion-grammar-binding",
								id: binding.id,
								path: commandPath,
							},
						),
					);
				} else {
					const roleData = fromNode.data?.[
						MOTION_GRAMMAR_WORKSPACE_ROLE_DATA_KEY
					] as Partial<MotionGrammarWorkspaceRoleData> | undefined;
					const removeGeneratedSource =
						command.removeGeneratedSource !== false &&
						roleData?.kind === "motion-grammar-workspace-role" &&
						roleData.bindingId === binding.id &&
						roleData.generated === true &&
						roleData.replaceable === true;
					const candidate: MotionGrammarBinding = {
						...binding,
						targetIds: plan.nextTargetIds,
						...(plan.nextRoleMap
							? { roleMap: plan.nextRoleMap }
							: { roleMap: undefined }),
					};
					const bindingIssue = validateMotionGrammarBinding(candidate);
					const versionedIssue =
						validateVersionedMotionExpressionBinding(candidate);
					const adapterIssue =
						candidate.techniqueId === FOLLOW_THROUGH_LEAD_ADAPTER_TECHNIQUE_ID
							? validateFollowThroughLeadAdapterBinding({
									scene: context.scene,
									motion: context.motion,
									binding: candidate,
									activeEndFrameExclusive:
										followThroughLeadAdapterActiveEndFrame(
											context.motion,
											candidate.id,
										),
								})
							: undefined;
					if (bindingIssue || versionedIssue || adapterIssue) {
						localIssues.push(
							createAgentIssue(
								"agent.motion-grammar-role-replacement-invalid",
								"error",
								`Document command ${index} cannot replace the role: ${bindingIssue?.message ?? versionedIssue?.message ?? adapterIssue}`,
								{
									kind: "motion-grammar-binding",
									id: binding.id,
									path: commandPath,
								},
							),
						);
					} else
						compiled.push({
							sceneCommands: removeGeneratedSource
								? [createDeleteNodesCommand([plan.fromNodeId])]
								: [],
							motionCommands:
								plan.retargetTrackIds.length > 0 ||
								plan.retargetClipIds.length > 0
									? [
											retargetMotionNodeReferences({
												fromNodeId: plan.fromNodeId,
												toNodeId: plan.toNodeId,
												bindingId: binding.id,
											}),
										]
									: [],
							grammarCommands: [
								updateGrammarBinding(binding.id, {
									targetIds: plan.nextTargetIds,
									roleMap: plan.nextRoleMap ?? null,
								}),
							],
							label: "Replace motion role",
							targets: [
								{ kind: "motion-grammar-binding", id: binding.id },
								{ kind: "node", id: plan.fromNodeId },
								{ kind: "node", id: plan.toNodeId },
							],
						});
				}
			}
		}
		issues.push(...localIssues);
	}
	return {
		commands: compiled,
		report: createCommandReviewReport(
			"document",
			reportTool,
			commands.length,
			compiled.length,
			compiled.flatMap((command) => command.targets),
			issues,
		),
	};
};

export { compileAgentDocumentCommandBatch };

/** Applies a prevalidated multi-owner bundle as one discard-on-error result. */
export function applyAgentDocumentCommands(
	context: AgentDocumentContext,
	request: Pick<
		AgentApplyDocumentCommandsRequest,
		"commands" | "dryRun" | "transactionId"
	>,
): AgentToolResult<AgentDocumentCommandApplyData> {
	const transactionId =
		request.transactionId?.trim() ||
		`agent-document:${context.scene.id}:${request.commands.length}`;
	const dryRun = request.dryRun ?? false;
	const batch = compileAgentDocumentCommandBatch(
		context,
		request.commands,
		"apply_document_commands",
	);
	if (!batch.report.summary.ok) {
		return {
			contractVersion: AGENT_CONTRACT_VERSION,
			ok: false,
			tool: "apply_document_commands",
			data: {
				transactionId,
				dryRun,
				changed: false,
				appliedSceneCommandCount: 0,
				appliedMotionCommandCount: 0,
				appliedMotionGrammarCommandCount: 0,
				report: batch.report,
				scene: cloneSceneDocument(context.scene),
				motion: cloneMotionDocument(context.motion),
				grammar: structuredClone(context.grammar),
			},
			mutation: {
				transactionId,
				dryRun,
				affected: [],
				undoLabel: "Apply document commands",
			},
			issues: batch.report.issues,
		};
	}

	const sceneCommands = batch.commands.flatMap((item) => item.sceneCommands);
	const motionCommands = batch.commands.flatMap((item) => item.motionCommands);
	const grammarCommands = batch.commands.flatMap(
		(item) => item.grammarCommands,
	);
	const labels = [...new Set(batch.commands.map((item) => item.label))];
	const transaction = {
		coalesceKey: transactionId,
		label: labels.length === 1 ? labels[0] : "Apply document commands",
	};
	const sceneRun = runSceneCommands(context.scene, sceneCommands, {
		transaction,
	});
	const motionRun = runMotionCommands(context.motion, motionCommands, {
		transaction,
	});
	const grammarRun = runMotionGrammarCommands(context.grammar, grammarCommands);
	const runnerIssues = [
		...sceneRun.issues.map(sceneRunnerIssueToAgentIssue),
		...motionRun.issues.map(motionRunnerIssueToAgentIssue),
		...grammarRun.issues.map(motionGrammarRunnerIssueToAgentIssue),
	];
	const runnerFailed = runnerIssues.some((issue) => issue.severity === "error");
	const changed =
		!runnerFailed &&
		(sceneRun.changed || motionRun.changed || grammarRun.changed);
	const resultIssues = runnerFailed
		? [...batch.report.issues, ...runnerIssues]
		: changed
			? batch.report.issues
			: [
					...batch.report.issues,
					createAgentIssue(
						"agent.document-command-no-changes",
						"warning",
						"Document commands were valid but produced no durable changes.",
						{ kind: "document", id: context.scene.id },
					),
				];
	const report = createCommandReviewReport(
		"document",
		"apply_document_commands",
		request.commands.length,
		runnerFailed ? 0 : batch.commands.length,
		batch.commands.flatMap((item) => item.targets),
		resultIssues,
	);

	return {
		contractVersion: AGENT_CONTRACT_VERSION,
		ok: !runnerFailed,
		tool: "apply_document_commands",
		data: {
			transactionId,
			dryRun,
			changed,
			appliedSceneCommandCount: runnerFailed ? 0 : sceneRun.appliedCommandCount,
			appliedMotionCommandCount: runnerFailed
				? 0
				: motionRun.appliedCommandCount,
			appliedMotionGrammarCommandCount: runnerFailed
				? 0
				: grammarRun.appliedCommandCount,
			report,
			scene: cloneSceneDocument(
				runnerFailed ? context.scene : sceneRun.document,
			),
			motion: cloneMotionDocument(
				runnerFailed ? context.motion : motionRun.document,
			),
			grammar: structuredClone(
				runnerFailed ? context.grammar : grammarRun.document,
			),
		},
		mutation: {
			transactionId,
			dryRun,
			affected: changed
				? uniqueTargets(batch.commands.flatMap((item) => item.targets))
				: [],
			undoLabel: transaction.label,
		},
		issues: resultIssues,
	};
}

const AUTHORABLE_MOTION_GRAMMAR_TECHNIQUE_IDS =
	new Set<MotionGrammarTechniqueId>(authorableTechniqueIds());

const safeMotionGrammarIdPart = (value: string): string =>
	value.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "target";

const agentMotionGrammarBindingId = (
	techniqueId: MotionGrammarTechniqueId,
	targetIds: readonly string[],
): string =>
	`agent:${safeMotionGrammarIdPart(techniqueId)}:${targetIds.map(safeMotionGrammarIdPart).join("+")}`;

const defaultMotionGrammarParameters = (
	techniqueId: MotionGrammarTechniqueId,
	context: AgentDocumentContext,
	targetIds: readonly string[],
	initialParameters: Readonly<Record<string, number>>,
): Record<string, number> => {
	const parameters: Record<string, number> = { ...initialParameters };
	if (techniqueId === "time-offset-propagation") {
		const artboard =
			(context.scene.artboards ?? [context.scene.artboard]).find(
				(candidate) => candidate.id === context.scene.currentArtboardId,
			) ??
			context.scene.artboards?.[0] ??
			context.scene.artboard;
		parameters.semanticVersion = GLAMMER_OFFSET_SEMANTIC_VERSION;
		parameters.profileVersion = GLAMMER_OFFSET_STAGGER_CONVEYOR_PROFILE_VERSION;
		parameters.slotCount = targetIds.length;
		parameters.referenceOriginX = artboard.width / 2;
		parameters.referenceOriginY = artboard.height / 2 + 12;
	}
	if (techniqueId === "random-phase-pulse") {
		parameters.pulseFrames = RANDOM_PULSE_PROFILE_DEFAULT.durationFrames;
	}
	return parameters;
};

const motionGrammarParameterIssues = (
	bindingId: string,
	index: number,
	result: ReturnType<typeof normalizeMotionGrammarAuthoringParameterPatch>,
): readonly AgentIssue[] =>
	result.issues.map((issue) =>
		createAgentIssue(
			`agent.motion-grammar-parameter-${issue.code}`,
			issue.code === "clamped-parameter" ? "warning" : "error",
			`Motion grammar command ${index}: ${issue.message}`,
			{
				kind: "motion-grammar-binding",
				id: bindingId,
				path: `commands.${index}.parameters.${issue.key}`,
			},
		),
	);

const missingMotionGrammarTargetIssues = (
	context: AgentDocumentContext,
	command: Extract<
		AgentMotionGrammarCommand,
		{ readonly type: "motion-grammar/apply-technique" }
	>,
	index: number,
): readonly AgentIssue[] =>
	command.targetIds
		.filter((nodeId) => !findNode(context.scene, nodeId))
		.map((nodeId) =>
			createAgentIssue(
				"agent.motion-grammar-command-missing-node",
				"error",
				`Motion grammar command ${index} targets missing scene node "${nodeId}".`,
				{ kind: "node", id: nodeId, path: `commands.${index}.targetIds` },
			),
		);

const compileApplyMotionGrammarTechniqueCommand = (
	context: AgentDocumentContext,
	command: Extract<
		AgentMotionGrammarCommand,
		{ readonly type: "motion-grammar/apply-technique" }
	>,
	index: number,
): {
	readonly compiled?: AgentCompiledMotionGrammarCommand;
	readonly issues: readonly AgentIssue[];
} => {
	const commandPath = `commands.${index}`;
	const bindingId =
		command.bindingId?.trim() ||
		agentMotionGrammarBindingId(command.techniqueId, command.targetIds);
	const entry = findCatalogEntry(command.techniqueId);
	const issues: AgentIssue[] = [];
	if (context.grammar.passthrough.some((binding) => binding.id === bindingId)) {
		issues.push(
			createAgentIssue(
				"agent.motion-grammar-unsupported-binding-id",
				"error",
				`Motion grammar command ${index} cannot replace preserved unsupported binding "${bindingId}". Remove it explicitly before applying a new binding with that id.`,
				{ kind: "motion-grammar-binding", id: bindingId, path: commandPath },
			),
		);
	}
	if (!entry) {
		issues.push(
			createAgentIssue(
				"agent.motion-grammar-technique-unknown",
				"error",
				`Motion grammar command ${index} references unknown technique "${command.techniqueId}".`,
				{ kind: "motion-grammar-binding", id: bindingId, path: commandPath },
			),
		);
	}
	if (!AUTHORABLE_MOTION_GRAMMAR_TECHNIQUE_IDS.has(command.techniqueId)) {
		issues.push(
			createAgentIssue(
				"agent.motion-grammar-technique-not-authorable",
				"error",
				`Motion grammar command ${index} cannot apply non-authorable technique "${command.techniqueId}".`,
				{ kind: "motion-grammar-binding", id: bindingId, path: commandPath },
			),
		);
	}
	if (command.techniqueId === "stroke-draw-on") {
		issues.push(
			createAgentIssue(
				"agent.motion-grammar-technique-requires-document-command",
				"error",
				`Motion grammar command ${index} must apply Stroke Draw-on through document/apply-stroke-draw-on so its scene stroke state and grammar binding commit together.`,
				{ kind: "motion-grammar-binding", id: bindingId, path: commandPath },
			),
		);
	}
	if (entry && command.targetIds.length < entry.minTargets) {
		issues.push(
			createAgentIssue(
				"agent.motion-grammar-target-count-insufficient",
				"error",
				`Motion grammar command ${index} requires at least ${entry.minTargets} target node(s) for "${entry.label}".`,
				{
					kind: "motion-grammar-binding",
					id: bindingId,
					path: `${commandPath}.targetIds`,
				},
			),
		);
	}
	issues.push(...missingMotionGrammarTargetIssues(context, command, index));
	if (command.seed !== undefined && !Number.isFinite(command.seed)) {
		issues.push(
			createAgentIssue(
				"agent.motion-grammar-seed-invalid",
				"error",
				`Motion grammar command ${index} seed must be finite.`,
				{
					kind: "motion-grammar-binding",
					id: bindingId,
					path: `${commandPath}.seed`,
				},
			),
		);
	}
	if (command.randomPulseProfile) {
		const profileIssue = randomPulseProfileIssue(command.randomPulseProfile);
		if (profileIssue) {
			issues.push(
				createAgentIssue(
					"agent.motion-grammar-random-pulse-profile-invalid",
					"error",
					`Motion grammar command ${index} Random Pulse profile is invalid: ${profileIssue}`,
					{
						kind: "motion-grammar-binding",
						id: bindingId,
						path: `${commandPath}.randomPulseProfile`,
					},
				),
			);
		}
	}
	if (
		command.arrangementMapping &&
		command.techniqueId !== "arrangement-transition"
	) {
		issues.push(
			createAgentIssue(
				"agent.motion-grammar-arrangement-mapping-technique-mismatch",
				"error",
				`Motion grammar command ${index} may carry arrangementMapping only for Arrangement.`,
				{
					kind: "motion-grammar-binding",
					id: bindingId,
					path: `${commandPath}.arrangementMapping`,
				},
			),
		);
	}
	if (
		command.arrangementMapping &&
		(!command.arrangementMapping.sourceSnapshotId ||
			!command.arrangementMapping.destinationSnapshotId ||
			Object.keys(command.arrangementMapping.sourceToStage).length === 0 ||
			Object.keys(command.arrangementMapping.stageToDestination).length === 0 ||
			Object.keys(command.arrangementMapping.stageSlots).length === 0 ||
			!Number.isFinite(command.arrangementMapping.pivot.x) ||
			!Number.isFinite(command.arrangementMapping.pivot.y))
	) {
		issues.push(
			createAgentIssue(
				"agent.motion-grammar-arrangement-mapping-invalid",
				"error",
				`Motion grammar command ${index} must provide non-empty snapshot ids, maps, stage slots, and a finite pivot.`,
				{
					kind: "motion-grammar-binding",
					id: bindingId,
					path: `${commandPath}.arrangementMapping`,
				},
			),
		);
	}
	const initialDefaults = createMotionGrammarNewBindingDefaults(
		command.techniqueId,
		command.targetIds,
	);
	if (initialDefaults.status === "blocked") {
		issues.push(
			createAgentIssue(
				"agent.motion-grammar-versioned-defaults-blocked",
				"error",
				`Motion grammar command ${index} cannot create ${entry?.label ?? command.techniqueId}: ${initialDefaults.reason}`,
				{
					kind: "motion-grammar-binding",
					id: bindingId,
					path: `${commandPath}.targetIds`,
				},
			),
		);
	} else if (command.roleMap) {
		const roleIssue = validateVersionedMotionExpressionRoleMap(
			command.techniqueId,
			command.targetIds,
			command.roleMap,
		);
		if (roleIssue) {
			issues.push(
				createAgentIssue(
					"agent.motion-grammar-versioned-role-map-invalid",
					"error",
					`Motion grammar command ${index} has an invalid semantic role map: ${roleIssue}`,
					{
						kind: "motion-grammar-binding",
						id: bindingId,
						path: `${commandPath}.roleMap`,
					},
				),
			);
		}
	}
	if (issues.some((issue) => issue.severity === "error")) {
		return { issues };
	}
	if (initialDefaults.status === "blocked") return { issues };

	const defaultRoleMap =
		command.roleMap ??
		(command.techniqueId === "count-growth"
			? defaultCountGrowthRoleMap(command.targetIds)
			: undefined);
	const binding: MotionGrammarBinding = {
		id: bindingId,
		techniqueId: command.techniqueId,
		targetIds: [...command.targetIds],
		parameters: defaultMotionGrammarParameters(
			command.techniqueId,
			context,
			command.targetIds,
			initialDefaults.parameters,
		),
		effectBinding: { kind: "none" },
		...(defaultRoleMap ? { roleMap: { ...defaultRoleMap } } : {}),
		...(command.arrangementMapping
			? {
					arrangementMapping: {
						...command.arrangementMapping,
						sourceToStage: { ...command.arrangementMapping.sourceToStage },
						stageToDestination: {
							...command.arrangementMapping.stageToDestination,
						},
						stageSlots: Object.fromEntries(
							Object.entries(command.arrangementMapping.stageSlots).map(
								([key, point]) => [key, { ...point }],
							),
						),
						pivot: { ...command.arrangementMapping.pivot },
						...(command.arrangementMapping.stagingDelayFractionBySource
							? {
									stagingDelayFractionBySource: {
										...command.arrangementMapping.stagingDelayFractionBySource,
									},
								}
							: {}),
					},
				}
			: {}),
		...(command.seed === undefined ? {} : { seed: command.seed }),
		...(command.techniqueId === "random-phase-pulse"
			? {
					randomPulseProfile:
						command.randomPulseProfile ?? RANDOM_PULSE_PROFILE_DEFAULT,
				}
			: command.randomPulseProfile
				? { randomPulseProfile: command.randomPulseProfile }
				: {}),
	};
	const normalized = normalizeMotionGrammarAuthoringParameterPatch({
		binding,
		descriptor: describeMotionGrammarAuthoringProfile(binding),
		patch: command.parameters ?? {},
	});
	issues.push(...motionGrammarParameterIssues(bindingId, index, normalized));
	if (issues.some((issue) => issue.severity === "error")) {
		return { issues };
	}

	let compiledBinding: MotionGrammarBinding = {
		...binding,
		parameters: { ...binding.parameters, ...normalized.parameters },
	};
	if (
		compiledBinding.techniqueId === FOLLOW_THROUGH_LEAD_ADAPTER_TECHNIQUE_ID
	) {
		const plan = planFollowThroughLeadAdapterBinding({
			scene: context.scene,
			motion: context.motion,
			bindingId,
			targetIds: compiledBinding.targetIds,
			parameters: compiledBinding.parameters,
			roleMap: compiledBinding.roleMap,
			explicitLeadExitFrame:
				command.parameters?.leadExitFrame === undefined
					? undefined
					: compiledBinding.parameters.leadExitFrame,
		});
		if (plan.status === "blocked") {
			issues.push(
				createAgentIssue(
					"agent.motion-grammar-versioned-defaults-blocked",
					"error",
					`Motion grammar command ${index} cannot apply lead-track Follow-through: ${plan.reason}`,
					{
						kind: "motion-grammar-binding",
						id: bindingId,
						path: commandPath,
					},
				),
			);
			return { issues };
		}
		compiledBinding = plan.binding;
	}
	const bindingIssue = validateMotionGrammarBinding(compiledBinding);
	if (bindingIssue) {
		issues.push(
			createAgentIssue(
				"agent.motion-grammar-binding-invalid",
				"error",
				`Motion grammar command ${index} cannot apply the binding: ${bindingIssue.message}`,
				{
					kind: "motion-grammar-binding",
					id: bindingId,
					path: commandPath,
				},
			),
		);
		return { issues };
	}

	return {
		compiled: {
			command: applyGrammarBinding(compiledBinding),
			target: {
				kind: "motion-grammar-binding",
				id: bindingId,
				path: commandPath,
			},
		},
		issues,
	};
};

const compileApplyAfterimageSelectedSourcesCommand = (
	context: AgentDocumentContext,
	command: Extract<
		AgentMotionGrammarCommand,
		{ readonly type: "motion-grammar/apply-afterimage-selected-sources" }
	>,
	index: number,
): {
	readonly compiled?: AgentCompiledMotionGrammarCommand;
	readonly issues: readonly AgentIssue[];
} => {
	const commandPath = `commands.${index}`;
	const bindingId = command.bindingId.trim();
	const parameters = command.parameters ?? {};
	const plan = planAfterimageSelectedSourceBinding({
		scene: context.scene,
		selectedNodeIds: command.selectedSourceNodeIds,
		bindingId,
		periodFrames: parameters.periodFrames,
		copies: parameters.copies,
		delayFrames: parameters.delayFrames,
		fadePerCopy: parameters.decay,
	});
	if (plan.status === "blocked") {
		return {
			issues: [
				createAgentIssue(
					"agent.afterimage-selected-source-blocked",
					"error",
					`Motion grammar command ${index} cannot apply selected-source Afterimage: ${plan.reason}`,
					{ kind: "motion-grammar-binding", id: bindingId, path: commandPath },
				),
			],
		};
	}
	const normalized = normalizeMotionGrammarAuthoringParameterPatch({
		binding: plan.binding,
		descriptor: describeMotionGrammarAuthoringProfile(plan.binding),
		patch: parameters,
	});
	const issues = motionGrammarParameterIssues(bindingId, index, normalized);
	if (issues.some((issue) => issue.severity === "error")) {
		return { issues };
	}
	const mergedParameters = {
		...plan.binding.parameters,
		...normalized.parameters,
	};
	const compiledBinding: MotionGrammarBinding = {
		...plan.binding,
		parameters: mergedParameters,
		effectBinding: {
			kind: "temporal-echo",
			copies: Math.floor(mergedParameters.copies ?? 0),
			delayFrames: mergedParameters.delayFrames ?? 0,
			decay: mergedParameters.decay ?? 0,
		},
	};
	const bindingIssue = validateMotionGrammarBinding(compiledBinding);
	if (bindingIssue) {
		return {
			issues: [
				...issues,
				createAgentIssue(
					"agent.motion-grammar-binding-invalid",
					"error",
					`Motion grammar command ${index} cannot apply selected-source Afterimage: ${bindingIssue.message}`,
					{ kind: "motion-grammar-binding", id: bindingId, path: commandPath },
				),
			],
		};
	}
	return {
		compiled: {
			command: applyGrammarBinding(compiledBinding),
			target: {
				kind: "motion-grammar-binding",
				id: bindingId,
				path: commandPath,
			},
		},
		issues,
	};
};

const compileUpdateMotionGrammarParametersCommand = (
	context: AgentDocumentContext,
	command: Extract<
		AgentMotionGrammarCommand,
		{ readonly type: "motion-grammar/update-parameters" }
	>,
	index: number,
): {
	readonly compiled?: AgentCompiledMotionGrammarCommand;
	readonly issues: readonly AgentIssue[];
} => {
	const commandPath = `commands.${index}`;
	const binding = context.grammar.bindings.find(
		(item) => item.id === command.bindingId,
	);
	if (!binding) {
		const preserved = context.grammar.passthrough.some(
			(item) => item.id === command.bindingId,
		);
		return {
			issues: [
				createAgentIssue(
					preserved
						? "agent.motion-grammar-binding-unsupported"
						: "agent.motion-grammar-binding-missing",
					"error",
					preserved
						? `Motion grammar command ${index} targets preserved unsupported binding "${command.bindingId}". It is remove-only until a compatible Vecmo version is available.`
						: `Motion grammar command ${index} targets missing binding "${command.bindingId}".`,
					{
						kind: "motion-grammar-binding",
						id: command.bindingId,
						path: commandPath,
					},
				),
			],
		};
	}
	const normalized = normalizeMotionGrammarAuthoringParameterPatch({
		binding,
		descriptor: describeMotionGrammarAuthoringProfile(binding),
		patch: command.parameters,
	});
	const issues = [
		...motionGrammarParameterIssues(command.bindingId, index, normalized),
		...(command.seed !== undefined && !Number.isFinite(command.seed)
			? [
					createAgentIssue(
						"agent.motion-grammar-seed-invalid",
						"error",
						`Motion grammar command ${index} seed must be finite.`,
						{
							kind: "motion-grammar-binding",
							id: command.bindingId,
							path: `${commandPath}.seed`,
						},
					),
				]
			: []),
	];
	if (issues.some((issue) => issue.severity === "error")) {
		return { issues };
	}
	const candidate: MotionGrammarBinding = {
		...binding,
		parameters: { ...binding.parameters, ...normalized.parameters },
		...(command.seed === undefined ? {} : { seed: command.seed }),
	};
	const bindingIssue = validateMotionGrammarBinding(candidate);
	if (bindingIssue) {
		issues.push(
			createAgentIssue(
				"agent.motion-grammar-binding-invalid",
				"error",
				`Motion grammar command ${index} cannot update the binding: ${bindingIssue.message}`,
				{
					kind: "motion-grammar-binding",
					id: candidate.id,
					path: commandPath,
				},
			),
		);
		return { issues };
	}
	if (candidate.techniqueId === FOLLOW_THROUGH_LEAD_ADAPTER_TECHNIQUE_ID) {
		const issue = validateFollowThroughLeadAdapterBinding({
			scene: context.scene,
			motion: context.motion,
			binding: candidate,
			activeEndFrameExclusive: followThroughLeadAdapterActiveEndFrame(
				context.motion,
				candidate.id,
			),
		});
		if (issue) {
			issues.push(
				createAgentIssue(
					"agent.motion-grammar-versioned-defaults-blocked",
					"error",
					`Motion grammar command ${index} cannot update lead-track Follow-through: ${issue}`,
					{
						kind: "motion-grammar-binding",
						id: candidate.id,
						path: commandPath,
					},
				),
			);
			return { issues };
		}
	}
	return {
		compiled: {
			command: updateGrammarBinding(command.bindingId, {
				parameters: normalized.parameters,
				...(command.seed === undefined ? {} : { seed: command.seed }),
			}),
			target: {
				kind: "motion-grammar-binding",
				id: command.bindingId,
				path: commandPath,
			},
		},
		issues,
	};
};

const compileUpdateMotionGrammarBindingCommand = (
	context: AgentDocumentContext,
	command: Extract<
		AgentMotionGrammarCommand,
		{ readonly type: "motion-grammar/update-binding" }
	>,
	index: number,
): {
	readonly compiled?: AgentCompiledMotionGrammarCommand;
	readonly issues: readonly AgentIssue[];
} => {
	const commandPath = `commands.${index}`;
	const binding = context.grammar.bindings.find(
		(item) => item.id === command.bindingId,
	);
	if (!binding) {
		return {
			issues: [
				createAgentIssue(
					"agent.motion-grammar-binding-missing",
					"error",
					`Motion grammar command ${index} targets missing binding "${command.bindingId}".`,
					{
						kind: "motion-grammar-binding",
						id: command.bindingId,
						path: commandPath,
					},
				),
			],
		};
	}
	const hasPatch =
		command.targetIds !== undefined ||
		command.roleMap !== undefined ||
		command.arrangementMapping !== undefined ||
		command.randomPulseProfile !== undefined ||
		command.seed !== undefined ||
		command.effectBinding !== undefined;
	if (!hasPatch) {
		return {
			issues: [
				createAgentIssue(
					"agent.motion-grammar-binding-patch-empty",
					"error",
					`Motion grammar command ${index} has no binding fields to update.`,
					{
						kind: "motion-grammar-binding",
						id: command.bindingId,
						path: commandPath,
					},
				),
			],
		};
	}
	const targetIds = command.targetIds ?? binding.targetIds;
	const roleMap =
		command.roleMap === undefined
			? binding.roleMap
			: command.roleMap === null
				? undefined
				: command.roleMap;
	const arrangementMapping =
		command.arrangementMapping === undefined
			? binding.arrangementMapping
			: command.arrangementMapping === null
				? undefined
				: command.arrangementMapping;
	const randomPulseProfile =
		command.randomPulseProfile === undefined
			? binding.randomPulseProfile
			: command.randomPulseProfile === null
				? undefined
				: command.randomPulseProfile;
	const seed =
		command.seed === undefined
			? binding.seed
			: command.seed === null
				? undefined
				: command.seed;
	const effectBinding =
		command.effectBinding === undefined
			? binding.effectBinding
			: command.effectBinding === null
				? undefined
				: command.effectBinding;
	const candidate: MotionGrammarBinding = {
		...binding,
		targetIds: [...targetIds],
		...(roleMap ? { roleMap: { ...roleMap } } : { roleMap: undefined }),
		...(arrangementMapping
			? { arrangementMapping }
			: { arrangementMapping: undefined }),
		...(randomPulseProfile
			? { randomPulseProfile }
			: { randomPulseProfile: undefined }),
		...(seed === undefined ? { seed: undefined } : { seed }),
		...(effectBinding ? { effectBinding } : { effectBinding: undefined }),
	};
	const issues: AgentIssue[] = [];
	const entry = findCatalogEntry(binding.techniqueId);
	if (new Set(targetIds).size !== targetIds.length) {
		issues.push(
			createAgentIssue(
				"agent.motion-grammar-target-duplicate",
				"error",
				`Motion grammar command ${index} target ids must be unique and ordered.`,
				{
					kind: "motion-grammar-binding",
					id: binding.id,
					path: `${commandPath}.targetIds`,
				},
			),
		);
	}
	if (entry && targetIds.length < entry.minTargets) {
		issues.push(
			createAgentIssue(
				"agent.motion-grammar-target-count-insufficient",
				"error",
				`Motion grammar command ${index} requires at least ${entry.minTargets} target node(s) for "${entry.label}".`,
				{
					kind: "motion-grammar-binding",
					id: binding.id,
					path: `${commandPath}.targetIds`,
				},
			),
		);
	}
	for (const nodeId of targetIds) {
		if (findNode(context.scene, nodeId)) continue;
		issues.push(
			createAgentIssue(
				"agent.motion-grammar-command-missing-node",
				"error",
				`Motion grammar command ${index} targets missing scene node "${nodeId}".`,
				{ kind: "node", id: nodeId, path: `${commandPath}.targetIds` },
			),
		);
	}
	if (arrangementMapping && binding.techniqueId !== "arrangement-transition") {
		issues.push(
			createAgentIssue(
				"agent.motion-grammar-arrangement-mapping-technique-mismatch",
				"error",
				`Motion grammar command ${index} may carry arrangementMapping only for Arrangement.`,
				{
					kind: "motion-grammar-binding",
					id: binding.id,
					path: `${commandPath}.arrangementMapping`,
				},
			),
		);
	}
	if (randomPulseProfile && binding.techniqueId !== "random-phase-pulse") {
		issues.push(
			createAgentIssue(
				"agent.motion-grammar-random-pulse-profile-technique-mismatch",
				"error",
				`Motion grammar command ${index} may carry randomPulseProfile only for Random Pulse.`,
				{
					kind: "motion-grammar-binding",
					id: binding.id,
					path: `${commandPath}.randomPulseProfile`,
				},
			),
		);
	}
	if (randomPulseProfile) {
		const profileIssue = randomPulseProfileIssue(randomPulseProfile);
		if (profileIssue) {
			issues.push(
				createAgentIssue(
					"agent.motion-grammar-random-pulse-profile-invalid",
					"error",
					`Motion grammar command ${index} Random Pulse profile is invalid: ${profileIssue}`,
					{
						kind: "motion-grammar-binding",
						id: binding.id,
						path: `${commandPath}.randomPulseProfile`,
					},
				),
			);
		}
	}
	const bindingIssue = validateMotionGrammarBinding(candidate);
	if (bindingIssue) {
		issues.push(
			createAgentIssue(
				"agent.motion-grammar-binding-invalid",
				"error",
				`Motion grammar command ${index} would invalidate the binding: ${bindingIssue.message}`,
				{
					kind: "motion-grammar-binding",
					id: binding.id,
					path: commandPath,
				},
			),
		);
	}
	const versionedIssue = validateVersionedMotionExpressionBinding(candidate);
	if (versionedIssue) {
		issues.push(
			createAgentIssue(
				"agent.motion-grammar-versioned-binding-invalid",
				"error",
				`Motion grammar command ${index} would invalidate the versioned expression binding: ${versionedIssue.code}.`,
				{
					kind: "motion-grammar-binding",
					id: binding.id,
					path: commandPath,
				},
			),
		);
	}
	if (candidate.techniqueId === FOLLOW_THROUGH_LEAD_ADAPTER_TECHNIQUE_ID) {
		const issue = validateFollowThroughLeadAdapterBinding({
			scene: context.scene,
			motion: context.motion,
			binding: candidate,
			activeEndFrameExclusive: followThroughLeadAdapterActiveEndFrame(
				context.motion,
				candidate.id,
			),
		});
		if (issue) {
			issues.push(
				createAgentIssue(
					"agent.motion-grammar-versioned-defaults-blocked",
					"error",
					`Motion grammar command ${index} cannot update lead-track Follow-through: ${issue}`,
					{
						kind: "motion-grammar-binding",
						id: binding.id,
						path: commandPath,
					},
				),
			);
		}
	}
	if (issues.some((issue) => issue.severity === "error")) return { issues };
	return {
		compiled: {
			command: updateGrammarBinding(binding.id, {
				...(command.targetIds === undefined
					? {}
					: { targetIds: command.targetIds }),
				...(command.roleMap === undefined ? {} : { roleMap: command.roleMap }),
				...(command.arrangementMapping === undefined
					? {}
					: { arrangementMapping: command.arrangementMapping }),
				...(command.randomPulseProfile === undefined
					? {}
					: { randomPulseProfile: command.randomPulseProfile }),
				...(command.seed === undefined ? {} : { seed: command.seed }),
				...(command.effectBinding === undefined
					? {}
					: { effectBinding: command.effectBinding }),
			}),
			target: {
				kind: "motion-grammar-binding",
				id: binding.id,
				path: commandPath,
			},
		},
		issues,
	};
};

const compileReorderMotionGrammarBindingCommand = (
	context: AgentDocumentContext,
	command: Extract<
		AgentMotionGrammarCommand,
		{ readonly type: "motion-grammar/reorder-binding" }
	>,
	index: number,
): {
	readonly compiled?: AgentCompiledMotionGrammarCommand;
	readonly issues: readonly AgentIssue[];
} => {
	const commandPath = `commands.${index}`;
	if (
		!context.grammar.bindings.some(
			(binding) => binding.id === command.bindingId,
		)
	) {
		return {
			issues: [
				createAgentIssue(
					"agent.motion-grammar-binding-missing",
					"error",
					`Motion grammar command ${index} targets missing binding "${command.bindingId}".`,
					{
						kind: "motion-grammar-binding",
						id: command.bindingId,
						path: commandPath,
					},
				),
			],
		};
	}
	if (!Number.isInteger(command.toIndex)) {
		return {
			issues: [
				createAgentIssue(
					"agent.motion-grammar-binding-index-invalid",
					"error",
					`Motion grammar command ${index} toIndex must be a whole number.`,
					{
						kind: "motion-grammar-binding",
						id: command.bindingId,
						path: `${commandPath}.toIndex`,
					},
				),
			],
		};
	}
	return {
		compiled: {
			command: reorderGrammarBinding(command.bindingId, command.toIndex),
			target: {
				kind: "motion-grammar-binding",
				id: command.bindingId,
				path: commandPath,
			},
		},
		issues: [],
	};
};

const compileRemoveMotionGrammarBindingCommand = (
	context: AgentDocumentContext,
	command: Extract<
		AgentMotionGrammarCommand,
		{ readonly type: "motion-grammar/remove-binding" }
	>,
	index: number,
): {
	readonly compiled?: AgentCompiledMotionGrammarCommand;
	readonly issues: readonly AgentIssue[];
} => {
	const commandPath = `commands.${index}`;
	if (
		!context.grammar.bindings.some(
			(binding) => binding.id === command.bindingId,
		) &&
		!context.grammar.passthrough.some(
			(binding) => binding.id === command.bindingId,
		)
	) {
		return {
			issues: [
				createAgentIssue(
					"agent.motion-grammar-binding-missing",
					"error",
					`Motion grammar command ${index} targets missing binding "${command.bindingId}".`,
					{
						kind: "motion-grammar-binding",
						id: command.bindingId,
						path: commandPath,
					},
				),
			],
		};
	}
	return {
		compiled: {
			command: removeGrammarBinding(command.bindingId),
			target: {
				kind: "motion-grammar-binding",
				id: command.bindingId,
				path: commandPath,
			},
		},
		issues: [],
	};
};

const compilePropagateMotionGrammarCommand = (
	context: AgentDocumentContext,
	command: Extract<
		AgentMotionGrammarCommand,
		{ readonly type: "motion-grammar/propagate-to-instances" }
	>,
	index: number,
): {
	readonly compiled?: AgentCompiledMotionGrammarCommand;
	readonly issues: readonly AgentIssue[];
} => {
	const commandPath = `commands.${index}`;
	const target = {
		kind: "document",
		id: context.scene.id,
		path: commandPath,
	} as const;
	const requestedSourceIds = command.sourceNodeIds
		? [...new Set(command.sourceNodeIds)]
		: undefined;
	let symbolIds: Set<string> | undefined;
	if (requestedSourceIds) {
		symbolIds = new Set<string>();
		const issues: AgentIssue[] = [];
		for (const sourceNodeId of requestedSourceIds) {
			const symbol = findComponentSymbolBySourceNodeId(
				context.scene,
				sourceNodeId,
			);
			if (!symbol) {
				issues.push(
					createAgentIssue(
						"agent.component-source-missing",
						"error",
						`Motion grammar command ${index} targets "${sourceNodeId}", which is not a component source node.`,
						{ kind: "node", id: sourceNodeId, path: commandPath },
					),
				);
				continue;
			}
			symbolIds.add(symbol.id);
		}
		if (issues.length > 0) return { issues };
	}
	const commands = planGrammarPropagation(
		context.scene,
		context.grammar,
		symbolIds,
	);
	if (commands.length === 0) {
		return {
			issues: [
				createAgentIssue(
					"agent.component-propagation-nothing-to-propagate",
					"error",
					`Motion grammar command ${index} matches no linked component instances to propagate to (or every match is already in sync).`,
					target,
				),
			],
		};
	}
	return {
		compiled: {
			command: combineMotionGrammarCommands(commands, {
				type: "motion-grammar/propagate-to-instances",
				label: "Propagate component grammar",
			}),
			target,
		},
		issues: [],
	};
};

const compileAgentMotionGrammarCommand = (
	context: AgentDocumentContext,
	command: AgentMotionGrammarCommand,
	index: number,
): {
	readonly compiled?: AgentCompiledMotionGrammarCommand;
	readonly issues: readonly AgentIssue[];
} => {
	switch (command.type) {
		case "motion-grammar/apply-technique":
			return compileApplyMotionGrammarTechniqueCommand(context, command, index);
		case "motion-grammar/apply-afterimage-selected-sources":
			return compileApplyAfterimageSelectedSourcesCommand(
				context,
				command,
				index,
			);
		case "motion-grammar/update-parameters":
			return compileUpdateMotionGrammarParametersCommand(
				context,
				command,
				index,
			);
		case "motion-grammar/update-binding":
			return compileUpdateMotionGrammarBindingCommand(context, command, index);
		case "motion-grammar/reorder-binding":
			return compileReorderMotionGrammarBindingCommand(context, command, index);
		case "motion-grammar/remove-binding":
			return compileRemoveMotionGrammarBindingCommand(context, command, index);
		case "motion-grammar/propagate-to-instances":
			return compilePropagateMotionGrammarCommand(context, command, index);
	}
};

const compileAgentMotionGrammarCommands = (
	context: AgentDocumentContext,
	commands: readonly AgentMotionGrammarCommand[],
): {
	readonly commands: readonly AgentCompiledMotionGrammarCommand[];
	readonly issues: readonly AgentIssue[];
} => {
	const compiled: AgentCompiledMotionGrammarCommand[] = [];
	const issues: AgentIssue[] = [];
	for (const [index, command] of commands.entries()) {
		const result = compileAgentMotionGrammarCommand(context, command, index);
		issues.push(...result.issues);
		if (result.compiled) compiled.push(result.compiled);
	}
	return { commands: compiled, issues };
};

const reviewCompiledMotionGrammarCommands = (
	requestedCommandCount: number,
	commands: readonly AgentCompiledMotionGrammarCommand[],
	issues: readonly AgentIssue[],
): AgentCommandReviewReport =>
	createCommandReviewReport(
		"motion-grammar",
		"apply_motion_grammar_commands",
		requestedCommandCount,
		commands.length,
		commands.map((command) => command.target),
		issues,
	);

export function compileAgentMotionGrammarCommandBatch(
	context: AgentDocumentContext,
	commands: readonly AgentMotionGrammarCommand[],
): AgentCompiledMotionGrammarCommandBatch {
	const compiled = compileAgentMotionGrammarCommands(context, commands);
	return {
		commands: compiled.commands,
		report: reviewCompiledMotionGrammarCommands(
			commands.length,
			compiled.commands,
			compiled.issues,
		),
	};
}

export function reviewAgentMotionGrammarCommands(
	context: AgentDocumentContext,
	commands: readonly AgentMotionGrammarCommand[],
): AgentCommandReviewReport {
	return compileAgentMotionGrammarCommandBatch(context, commands).report;
}

/**
 * Compiles one camera verb by delegating to its pure planner
 * (`entities/camera-motion/model/camera-verbs.ts`) against the current
 * scene+motion, then turning the planner's `blocked` outcome into a typed error
 * issue. The compiled result carries the planner's cross-store command bundle
 * verbatim; the caller applies both arrays under one compound (the
 * `applyCameraVerb` facade, or a future live transport once compound cross-store
 * apply is available). Optional numeric/enum fields pass straight through — the
 * planner owns clamping and projection-dependent defaults.
 */
const compileAgentCameraVerbCommand = (
	context: AgentDocumentContext,
	command: AgentCameraVerbCommand,
	index: number,
): {
	readonly compiled?: AgentCompiledCameraVerbCommand;
	readonly issues: readonly AgentIssue[];
} => {
	const commandPath = `commands.${index}`;
	const artboardId =
		command.artboardId ??
		context.scene.currentArtboardId ??
		context.scene.artboard.id;
	const target: AgentIssueTarget = {
		kind: "artboard",
		id: artboardId,
		path: commandPath,
	};
	let result: CameraVerbResult;
	switch (command.type) {
		case "camera/push-in":
			result = planCameraPushIn({
				scene: context.scene,
				motion: context.motion,
				artboardId,
				subjectIds: command.subjectIds,
				startFrame: command.startFrame,
				durationFrames: command.durationFrames,
				mode: command.mode,
			});
			break;
		case "camera/parallax-establish":
			result = planCameraParallaxEstablish({
				scene: context.scene,
				motion: context.motion,
				artboardId,
				startFrame: command.startFrame,
				durationFrames: command.durationFrames,
				roleGroups: {
					near: command.near,
					mid: command.mid,
					far: command.far,
				},
			});
			break;
		case "camera/orbit":
			result = planCameraOrbit2_5d({
				scene: context.scene,
				motion: context.motion,
				artboardId,
				subjectIds: command.subjectIds,
				startFrame: command.startFrame,
				durationFrames: command.durationFrames,
				sweepDegrees: command.sweepDegrees,
			});
			break;
	}
	if (result.status === "blocked") {
		return {
			issues: [
				createAgentIssue(
					"agent.camera-verb-blocked",
					"error",
					`Camera verb command ${index} (${command.type}) cannot apply: ${result.reason}`,
					target,
				),
			],
		};
	}
	return {
		compiled: {
			sceneCommands: result.sceneCommands,
			motionCommands: result.motionCommands,
			targets: [{ kind: "artboard", id: result.artboardId, path: commandPath }],
		},
		issues: [],
	};
};

const reviewCompiledCameraVerbCommands = (
	requestedCommandCount: number,
	commands: readonly AgentCompiledCameraVerbCommand[],
	issues: readonly AgentIssue[],
): AgentCommandReviewReport =>
	createCommandReviewReport(
		"camera",
		"apply_camera_commands",
		requestedCommandCount,
		commands.length,
		commands.flatMap((command) => command.targets),
		issues,
	);

/**
 * Compiles a batch of camera-verb commands, embedding an
 * {@link AgentCommandReviewReport} (kind `"camera"`, tool
 * `apply_camera_commands`) the same way the scene/motion/motion-grammar
 * batches do. Contract-complete surface for the `camera/*` agent family (kept
 * in sync by `check:agent-contract`). Camera verbs remain a dedicated command
 * surface rather than a `cameraCommands` plan-envelope key; this is no longer a
 * compound-transport limitation. Agents apply verbs in-editor through the
 * `applyCameraVerb` facade or headlessly through `apply_camera_commands`
 * (`applyAgentCameraVerbCommands` below) — both consume this batch.
 */
export function compileAgentCameraVerbCommandBatch(
	context: AgentDocumentContext,
	commands: readonly AgentCameraVerbCommand[],
): AgentCompiledCameraVerbCommandBatch {
	const compiled: AgentCompiledCameraVerbCommand[] = [];
	const issues: AgentIssue[] = [];
	for (const [index, command] of commands.entries()) {
		const result = compileAgentCameraVerbCommand(context, command, index);
		issues.push(...result.issues);
		if (result.compiled) compiled.push(result.compiled);
	}
	return {
		commands: compiled,
		report: reviewCompiledCameraVerbCommands(commands.length, compiled, issues),
	};
}

export function reviewAgentCameraVerbCommands(
	context: AgentDocumentContext,
	commands: readonly AgentCameraVerbCommand[],
): AgentCommandReviewReport {
	return compileAgentCameraVerbCommandBatch(context, commands).report;
}

const createValidationIssueReport = (
	context: AgentDocumentContext,
): AgentIssueReport => {
	const validation = validateAgentDocument(context);
	const issues = validation.data?.issues ?? validation.issues;
	return {
		summary: validation.data?.summary ?? summarizeAgentIssues(issues),
		affected: issueTargets(issues),
		issues,
	};
};

const createPlanStep = (
	report: AgentCommandReviewReport,
): AgentEditPlanStep => ({
	id: `${report.kind}-commands`,
	title:
		report.kind === "scene"
			? "Review and apply scene command envelope"
			: report.kind === "motion"
				? "Review and apply motion command envelope"
				: report.kind === "motion-grammar"
					? "Review and apply motion grammar command envelope"
					: "Review isolated document timing compound",
	status: report.commandCount > 0 && report.summary.ok ? "ready" : "blocked",
	tool: report.tool,
	affected: report.affected,
	issueCodes: report.issues.map((issue) => issue.code),
});

const createValidationStep = (report: AgentIssueReport): AgentEditPlanStep => ({
	id: "validation",
	title: "Review document validation report",
	status: report.summary.ok ? "ready" : "blocked",
	tool: "run_validation",
	affected: report.affected,
	issueCodes: report.issues.map((issue) => issue.code),
});

const createNoCommandStep = (issue: AgentIssue): AgentEditPlanStep => ({
	id: "typed-command-envelope",
	title:
		"Attach a typed document-timing, scene, motion, or motion grammar command envelope",
	status: "blocked",
	affected: issue.target ? [issue.target] : [],
	issueCodes: [issue.code],
});

const nextPlanTool = (
	reports: readonly AgentCommandReviewReport[],
	validation: AgentIssueReport | undefined,
	ready: boolean,
): AgentEditPlan["nextTool"] => {
	if (!ready) {
		return validation?.summary.ok === false ? "run_validation" : undefined;
	}
	return (
		reports.find((report) => report.tool === "apply_edit_plan_live")?.tool ??
		reports.find((report) => report.tool === "apply_scene_commands")?.tool ??
		reports.find((report) => report.tool === "apply_motion_commands")?.tool ??
		reports.find((report) => report.tool === "apply_motion_grammar_commands")
			?.tool ??
		"run_validation"
	);
};

/**
 * Builds a deterministic, reviewable edit plan from already-typed command
 * envelopes. This is intentionally not an LLM planner and never accepts code:
 * it connects an agent's natural-language intent to command validation,
 * affected ids, and the next safe command-bus tool.
 *
 * Created-resource ids (nodes, clips, artboards, frames, etc.) are minted at
 * compile time, so a fresh internal compile mints ids that never match a
 * *different* compile's output. Pass `precompiled` with the exact
 * `AgentCommandReviewReport`s from the batch the caller will actually apply
 * (see `compileAgentSceneCommandBatch` / `compileAgentMotionCommandBatch` /
 * `compileAgentMotionGrammarCommandBatch`) so the returned plan's
 * `steps[].affected` / `affected` mirror the ids that get committed. Without
 * `precompiled`, this function compiles internally and any created-resource
 * id in the result is provisional — it will not match the id produced by a
 * later apply call, which compiles fresh.
 */
export function proposeAgentEditPlan(
	context: AgentDocumentContext,
	request: Pick<
		AgentProposeEditPlanRequest,
		| "intent"
		| "target"
		| "documentCommands"
		| "sceneCommands"
		| "motionCommands"
		| "motionGrammarCommands"
		| "includeValidation"
	>,
	precompiled?: {
		readonly document?: AgentCommandReviewReport;
		readonly scene?: AgentCommandReviewReport;
		readonly motion?: AgentCommandReviewReport;
		readonly motionGrammar?: AgentCommandReviewReport;
	},
): AgentToolResult<AgentEditPlan> {
	const reports: AgentCommandReviewReport[] = [];
	if (request.documentCommands) {
		reports.push(
			precompiled?.document ??
				compileAgentDocumentCommandBatch(context, request.documentCommands)
					.report,
		);
	}
	if (request.sceneCommands) {
		reports.push(
			precompiled?.scene ??
				reviewAgentSceneCommands(context, request.sceneCommands),
		);
	}
	if (request.motionCommands) {
		reports.push(
			precompiled?.motion ??
				reviewAgentMotionCommands(context, request.motionCommands),
		);
	}
	if (request.motionGrammarCommands) {
		reports.push(
			precompiled?.motionGrammar ??
				reviewAgentMotionGrammarCommands(
					context,
					request.motionGrammarCommands,
				),
		);
	}

	const validation =
		request.includeValidation === false
			? undefined
			: createValidationIssueReport(context);
	const noCommandIssue =
		reports.length === 0
			? createAgentIssue(
					"agent.plan-missing-command-envelope",
					"warning",
					"Proposed edit plans require typed documentCommands, sceneCommands, motionCommands, or motionGrammarCommands before apply.",
					request.target ?? { kind: "tool", id: "propose_edit_plan" },
				)
			: undefined;
	const issues = [
		...(noCommandIssue ? [noCommandIssue] : []),
		...reports.flatMap((report) => report.issues),
		...(validation?.issues ?? []),
	];
	const ready =
		reports.length > 0 &&
		reports.every((report) => report.commandCount > 0 && report.summary.ok) &&
		(validation?.summary.ok ?? true);
	const steps = [
		...(validation ? [createValidationStep(validation)] : []),
		...reports.map((report) => createPlanStep(report)),
		...(noCommandIssue ? [createNoCommandStep(noCommandIssue)] : []),
	];
	const nextTool = nextPlanTool(reports, validation, ready);

	const data: AgentEditPlan = {
		intent: request.intent,
		...(request.target ? { target: request.target } : {}),
		ready,
		affected: mergeIssueTargets(
			reports.flatMap((report) => report.affected),
			validation?.affected ?? [],
		),
		summary: summarizeAgentIssues(issues),
		...(validation ? { validation } : {}),
		reports,
		steps,
		...(nextTool ? { nextTool } : {}),
	};

	return createAgentToolResult("propose_edit_plan", data, issues);
}

/**
 * Applies typed agent scene commands through the existing scene command bus.
 * The headless MCP server stays stateless: callers receive the updated
 * `SceneDocument`, while the singleton store is reset after command execution.
 */
export function applyAgentSceneCommands(
	context: AgentDocumentContext,
	request: Pick<
		AgentApplySceneCommandsRequest,
		"commands" | "dryRun" | "transactionId"
	>,
): AgentToolResult<AgentSceneCommandApplyData> {
	const transactionId =
		request.transactionId?.trim() ||
		defaultTransactionId(context.scene, request.commands.length);
	const dryRun = request.dryRun ?? false;
	const { commands, issues } = compileAgentSceneCommands(
		context.scene,
		context.motion,
		request.commands,
		new Set(context.grammar.bindings.flatMap((binding) => binding.targetIds)),
	);
	const report = reviewCompiledSceneCommands(
		request.commands.length,
		commands,
		issues,
	);
	const hasErrors = issues.some((issue) => issue.severity === "error");
	if (hasErrors) {
		return {
			contractVersion: AGENT_CONTRACT_VERSION,
			ok: false,
			tool: "apply_scene_commands",
			data: {
				transactionId,
				dryRun,
				changed: false,
				appliedCommandCount: 0,
				report,
				scene: cloneSceneDocument(context.scene),
			},
			mutation: {
				transactionId,
				dryRun,
				affected: [],
				undoLabel: commandLabel(request.commands.length),
			},
			issues,
		};
	}

	const run = runSceneCommands(
		context.scene,
		commands.map((compiled) => compiled.command),
		{
			transaction: {
				coalesceKey: transactionId,
				label: commandLabel(commands.length),
			},
		},
	);
	const sidecarMotionCommands = commands.flatMap(
		(compiled) => compiled.motionCommands ?? [],
	);
	const motionRun =
		sidecarMotionCommands.length > 0
			? runMotionCommands(
					context.motion,
					sidecarMotionCommands.map((compiled) => compiled.command),
					{
						transaction: {
							coalesceKey: transactionId,
							label: "Preserve detached motion pose",
						},
					},
				)
			: null;
	const runnerIssues = [
		...run.issues.map(sceneRunnerIssueToAgentIssue),
		...(motionRun?.issues.map(motionRunnerIssueToAgentIssue) ?? []),
	];
	const changed = run.changed || (motionRun?.changed ?? false);
	const resultIssues =
		changed || runnerIssues.some((issue) => issue.severity === "error")
			? [...issues, ...runnerIssues]
			: [
					...issues,
					...runnerIssues,
					createAgentIssue(
						"agent.scene-command-no-changes",
						"warning",
						"Scene commands were valid but did not change the document.",
						{ kind: "document", id: context.scene.id },
					),
				];
	const resultReport = reviewCompiledSceneCommands(
		request.commands.length,
		commands,
		resultIssues,
	);

	return {
		contractVersion: AGENT_CONTRACT_VERSION,
		ok: !resultIssues.some((issue) => issue.severity === "error"),
		tool: "apply_scene_commands",
		data: {
			transactionId,
			dryRun,
			changed,
			appliedCommandCount: run.appliedCommandCount,
			...(motionRun
				? {
						appliedMotionCommandCount: motionRun.appliedCommandCount,
						motion: cloneMotionDocument(motionRun.document),
					}
				: {}),
			report: resultReport,
			scene: cloneSceneDocument(run.document),
		},
		mutation: {
			transactionId,
			dryRun,
			affected: changed
				? uniqueTargets(commands.map((command) => command.target))
				: [],
			undoLabel: commandLabel(commands.length),
		},
		issues: resultIssues,
	};
}

/**
 * Applies typed agent motion commands through the existing MotionDocument
 * command bus. Motion remains a side-car; scene data is only read to reject
 * tracks for missing nodes before they enter the motion store.
 */
export function applyAgentMotionCommands(
	context: AgentDocumentContext,
	request: Pick<
		AgentApplyMotionCommandsRequest,
		"commands" | "dryRun" | "transactionId"
	>,
): AgentToolResult<AgentMotionCommandApplyData> {
	const transactionId =
		request.transactionId?.trim() ||
		defaultMotionTransactionId(context.scene, request.commands.length);
	const dryRun = request.dryRun ?? false;
	const { commands, issues, requestedCount } = compileAgentMotionCommands(
		context,
		request.commands,
	);
	const report = reviewCompiledMotionCommands(requestedCount, commands, issues);
	const hasErrors = issues.some((issue) => issue.severity === "error");
	if (hasErrors) {
		return {
			contractVersion: AGENT_CONTRACT_VERSION,
			ok: false,
			tool: "apply_motion_commands",
			data: {
				transactionId,
				dryRun,
				changed: false,
				appliedCommandCount: 0,
				report,
				motion: cloneMotionDocument(context.motion),
			},
			mutation: {
				transactionId,
				dryRun,
				affected: [],
				undoLabel: motionCommandLabel(request.commands.length),
			},
			issues,
		};
	}

	const run = runMotionCommands(
		context.motion,
		commands.map((compiled) => compiled.command),
		{
			transaction: {
				coalesceKey: transactionId,
				label: motionCommandLabel(commands.length),
			},
		},
	);
	const runnerIssues = run.issues.map(motionRunnerIssueToAgentIssue);
	// HEADLESS auto-propagation: the LIVE plan path (`apply_edit_plan_live`)
	// already gets this for free because it applies through the SAME
	// `useMotionStore` the editor's `useMotionPropagation` subscription watches
	// (see that hook's doc comment) — any store commit, regardless of caller,
	// triggers the resync. A headless apply has no live store in the loop at all
	// (it is a pure `MotionDocument` snapshot transform, per this tool's own
	// "HEADLESS... do NOT... touch the live editor" contract), so without this
	// pass an agent editing a component SOURCE's motion through this tool would
	// silently diverge from its instances in the returned document. Running the
	// full (cheap, idempotent) propagation pass unconditionally after every
	// changed apply mirrors the live hook's own unconditional-pass behavior
	// instead of inventing a separate "did this batch touch a source" heuristic.
	const propagationCommands = run.changed
		? planMotionPropagation(context.scene, transactionId)
		: [];
	const propagationRun =
		propagationCommands.length > 0
			? runMotionCommands(run.document, propagationCommands, {
					transaction: {
						coalesceKey: transactionId,
						label: "Propagate component motion",
					},
				})
			: null;
	const resultDocument = propagationRun?.document ?? run.document;
	const changed = run.changed || (propagationRun?.changed ?? false);
	const appliedCommandCount =
		run.appliedCommandCount + (propagationRun?.appliedCommandCount ?? 0);
	const resultIssues =
		changed || runnerIssues.some((issue) => issue.severity === "error")
			? [...issues, ...runnerIssues]
			: [
					...issues,
					...runnerIssues,
					createAgentIssue(
						"agent.motion-command-no-changes",
						"warning",
						"Motion commands were valid but did not change the document.",
						{ kind: "document", id: context.scene.id },
					),
				];
	const resultReport = reviewCompiledMotionCommands(
		requestedCount,
		commands,
		resultIssues,
	);

	return {
		contractVersion: AGENT_CONTRACT_VERSION,
		ok: !resultIssues.some((issue) => issue.severity === "error"),
		tool: "apply_motion_commands",
		data: {
			transactionId,
			dryRun,
			changed,
			appliedCommandCount,
			report: resultReport,
			motion: cloneMotionDocument(resultDocument),
		},
		mutation: {
			transactionId,
			dryRun,
			affected: changed
				? uniqueTargets(commands.map((command) => command.target))
				: [],
			undoLabel: motionCommandLabel(commands.length),
		},
		issues: resultIssues,
	};
}

const cloneMotionGrammarDocument = (
	document: AgentDocumentContext["grammar"],
): AgentDocumentContext["grammar"] => structuredClone(document);

export function applyAgentMotionGrammarCommands(
	context: AgentDocumentContext,
	request: Pick<
		AgentApplyMotionGrammarCommandsRequest,
		"commands" | "dryRun" | "transactionId"
	>,
): AgentToolResult<AgentMotionGrammarCommandApplyData> {
	const transactionId =
		request.transactionId?.trim() ||
		defaultMotionGrammarTransactionId(context.scene, request.commands.length);
	const dryRun = request.dryRun ?? false;
	const { commands, issues } = compileAgentMotionGrammarCommands(
		context,
		request.commands,
	);
	const report = reviewCompiledMotionGrammarCommands(
		request.commands.length,
		commands,
		issues,
	);
	const hasErrors = issues.some((issue) => issue.severity === "error");
	if (hasErrors) {
		return {
			contractVersion: AGENT_CONTRACT_VERSION,
			ok: false,
			tool: "apply_motion_grammar_commands",
			data: {
				transactionId,
				dryRun,
				changed: false,
				appliedCommandCount: 0,
				report,
				grammar: cloneMotionGrammarDocument(context.grammar),
			},
			mutation: {
				transactionId,
				dryRun,
				affected: [],
				undoLabel: motionGrammarCommandLabel(request.commands.length),
			},
			issues,
		};
	}

	const run = runMotionGrammarCommands(
		context.grammar,
		commands.map((compiled) => compiled.command),
	);
	const runnerIssues = run.issues.map(motionGrammarRunnerIssueToAgentIssue);
	// HEADLESS auto-propagation, grammar twin of the resync in
	// `applyAgentMotionCommands` — see that function's comment for the full
	// live-vs-headless rationale.
	const propagationCommands = run.changed
		? planGrammarPropagation(context.scene, run.document)
		: [];
	const propagationRun =
		propagationCommands.length > 0
			? runMotionGrammarCommands(run.document, propagationCommands)
			: null;
	const resultDocument = propagationRun?.document ?? run.document;
	const changed = run.changed || (propagationRun?.changed ?? false);
	const appliedCommandCount =
		run.appliedCommandCount + (propagationRun?.appliedCommandCount ?? 0);
	const resultIssues =
		changed || runnerIssues.some((issue) => issue.severity === "error")
			? [...issues, ...runnerIssues]
			: [
					...issues,
					...runnerIssues,
					createAgentIssue(
						"agent.motion-grammar-command-no-changes",
						"warning",
						"Motion grammar commands were valid but did not change the document.",
						{ kind: "document", id: context.scene.id },
					),
				];
	const resultReport = reviewCompiledMotionGrammarCommands(
		request.commands.length,
		commands,
		resultIssues,
	);

	return {
		contractVersion: AGENT_CONTRACT_VERSION,
		ok: !resultIssues.some((issue) => issue.severity === "error"),
		tool: "apply_motion_grammar_commands",
		data: {
			transactionId,
			dryRun,
			changed,
			appliedCommandCount,
			report: resultReport,
			grammar: cloneMotionGrammarDocument(resultDocument),
		},
		mutation: {
			transactionId,
			dryRun,
			affected: changed
				? uniqueTargets(commands.map((command) => command.target))
				: [],
			undoLabel: motionGrammarCommandLabel(commands.length),
		},
		issues: resultIssues,
	};
}

/**
 * Applies typed `camera/*` verb commands headlessly (P3.3): compiles through
 * {@link compileAgentCameraVerbCommandBatch} (which delegates to the pure
 * planners in `entities/camera-motion/model/camera-verbs.ts`), then runs each
 * compiled command's scene half and motion half against `context.scene` /
 * `context.motion` respectively — independent runner calls under the SAME
 * `transactionId` coalesce key, mirroring `applyAgentSceneCommands`'s primary +
 * sidecar-motion pattern, generalized to every compiled command's pair (a
 * camera verb's scene and motion halves are equally load-bearing, not one a
 * "sidecar" of the other, so both updated documents are always returned; see
 * {@link AgentCameraVerbCommandApplyData}). This is the stateless, doc-in/
 * doc-out counterpart to the in-editor `applyCameraVerb` facade
 * (`features/scene-camera/model/authoring.ts`): it never touches
 * `useSceneStore`/`useMotionStore` and returns the updated snapshots directly,
 * exactly like `apply_scene_commands`/`apply_motion_commands`. The general live
 * plan coordinator now has compound Scene/Motion/Grammar transport; camera
 * verbs remain intentionally outside that envelope and use their dedicated
 * in-editor facade.
 */
export function applyAgentCameraVerbCommands(
	context: AgentDocumentContext,
	request: Pick<
		AgentApplyCameraCommandsRequest,
		"commands" | "dryRun" | "transactionId"
	>,
): AgentToolResult<AgentCameraVerbCommandApplyData> {
	const transactionId =
		request.transactionId?.trim() ||
		defaultCameraVerbTransactionId(context.scene, request.commands.length);
	const dryRun = request.dryRun ?? false;
	const { commands, report } = compileAgentCameraVerbCommandBatch(
		context,
		request.commands,
	);
	const issues = report.issues;
	const hasErrors = issues.some((issue) => issue.severity === "error");
	if (hasErrors) {
		return {
			contractVersion: AGENT_CONTRACT_VERSION,
			ok: false,
			tool: "apply_camera_commands",
			data: {
				transactionId,
				dryRun,
				changed: false,
				appliedSceneCommandCount: 0,
				appliedMotionCommandCount: 0,
				report,
				scene: cloneSceneDocument(context.scene),
				motion: cloneMotionDocument(context.motion),
			},
			mutation: {
				transactionId,
				dryRun,
				affected: [],
				undoLabel: cameraVerbCommandLabel(request.commands.length),
			},
			issues,
		};
	}

	const sceneCommands = commands.flatMap((command) => command.sceneCommands);
	const motionCommands = commands.flatMap((command) => command.motionCommands);
	const label = cameraVerbCommandLabel(commands.length);
	const sceneRun =
		sceneCommands.length > 0
			? runSceneCommands(context.scene, sceneCommands, {
					transaction: { coalesceKey: transactionId, label },
				})
			: null;
	const motionRun =
		motionCommands.length > 0
			? runMotionCommands(context.motion, motionCommands, {
					transaction: { coalesceKey: transactionId, label },
				})
			: null;
	const runnerIssues = [
		...(sceneRun?.issues.map(sceneRunnerIssueToAgentIssue) ?? []),
		...(motionRun?.issues.map(motionRunnerIssueToAgentIssue) ?? []),
	];
	const changed = (sceneRun?.changed ?? false) || (motionRun?.changed ?? false);
	const appliedSceneCommandCount = sceneRun?.appliedCommandCount ?? 0;
	const appliedMotionCommandCount = motionRun?.appliedCommandCount ?? 0;
	const resultIssues =
		changed || runnerIssues.some((issue) => issue.severity === "error")
			? [...issues, ...runnerIssues]
			: [
					...issues,
					...runnerIssues,
					createAgentIssue(
						"agent.camera-verb-no-changes",
						"warning",
						"Camera verb commands were valid but did not change the document.",
						{ kind: "document", id: context.scene.id },
					),
				];
	const resultReport = reviewCompiledCameraVerbCommands(
		request.commands.length,
		commands,
		resultIssues,
	);

	return {
		contractVersion: AGENT_CONTRACT_VERSION,
		ok: !resultIssues.some((issue) => issue.severity === "error"),
		tool: "apply_camera_commands",
		data: {
			transactionId,
			dryRun,
			changed,
			appliedSceneCommandCount,
			appliedMotionCommandCount,
			report: resultReport,
			scene: cloneSceneDocument(sceneRun?.document ?? context.scene),
			motion: cloneMotionDocument(motionRun?.document ?? context.motion),
		},
		mutation: {
			transactionId,
			dryRun,
			affected: changed
				? uniqueTargets(commands.flatMap((command) => command.targets))
				: [],
			undoLabel: label,
		},
		issues: resultIssues,
	};
}
