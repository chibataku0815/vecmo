import type {
	EasingPreset,
	MotionTimingTemplateId,
} from "@/entities/motion/model/easing";
import type { TextAnimatorPresetId } from "@/entities/motion/model/text-animator";
import type {
	AnimatableProperty,
	AnimatableValue,
	CameraCutSegment,
	CameraRigAnimatableProperty,
	PositionPathSpatialMode,
} from "@/entities/motion/model/types";
import type { MotionGrammarStoreDocument } from "@/entities/motion-grammar/model/command";
import type {
	MotionGrammarArrangementMapping,
	MotionGrammarEffectBinding,
	MotionGrammarImplementationStatus,
	MotionGrammarParamSpec,
	MotionGrammarRandomPulseProfile,
	MotionGrammarTechniqueFamily,
	MotionGrammarTechniqueId,
} from "@/entities/motion-grammar/model/types";
import type {
	AppearanceMaskRelationKind,
	AppearanceMaskRelationSettings,
	MaskRelationPropertyId,
} from "@/entities/scene/model/appearance";
import type { ObjectAppearanceEffect } from "@/entities/scene/model/appearance-effects";
import type {
	BindableDirectManipulation,
	BindableKeyframeChannel,
	BindablePropertyControl,
	BindablePropertyEligibility,
	BindablePropertySource,
	BindablePropertySupportMatrix,
	BindablePropertyTargetScope,
} from "@/entities/scene/model/bindable-property";
import type { ComponentPropUpdatePatch } from "@/entities/scene/model/component-prop-commands";
import type { CreateComponentPropOptions } from "@/entities/scene/model/component-props";
import type {
	ComponentNodeOverrideInput,
	ComponentOverrideResetFilter,
	CreateComponentInstanceOptions,
	CreateComponentSymbolOptions,
} from "@/entities/scene/model/component-symbols";
import type { EffectLayerStackOperation } from "@/entities/scene/model/effect-layer-stack";
import type { InteractionUpdatePatch } from "@/entities/scene/model/interaction-commands";
import type { CreateInteractionOptions } from "@/entities/scene/model/interactions";
import type {
	LookGraphIssue,
	LookGraphNodeKind,
	LookGraphNodeParamSpec,
	LookGraphNodePayload,
	LookGraphOwnerRef,
	LookGraphPortSpec,
} from "@/entities/scene/model/look-graph";
import type { LookGraphExportManifest } from "@/entities/scene/model/look-graph-export";
import type { LookGraphOperation } from "@/entities/scene/model/look-graph-operations";
import type { PathOperation } from "@/entities/scene/model/path-boolean/types";
import type { SceneCameraAuthoringSelection } from "@/entities/scene/model/scene-camera-authoring";
import type {
	SourceOpticsParameterDescriptor,
	SourceOpticsParameterTarget,
	SourceOpticsResponseDraft,
} from "@/entities/scene/model/source-optics";
import type {
	SourceOpticsResponsePatch,
	SourceOpticsRigPatch,
} from "@/entities/scene/model/source-optics-commands";
import type { CreateStylePresetOptions } from "@/entities/scene/model/style-presets";
import type { TextFragmentUnit } from "@/entities/scene/model/text-fragments";
import type {
	AffineMatrix2D,
	Artboard,
	BezierShape,
	BlendMode,
	BlendOrientation,
	BlendSpacing,
	BlendSpine,
	BlendStackingOrder,
	Bounds,
	CameraSpacePolicy,
	ComponentPropBinding,
	ComponentPropType,
	ComponentPropValue,
	CornerRadii,
	Effect,
	FillRule,
	InteractionAction,
	InteractionTriggerKind,
	LayoutCellPlacement,
	LayoutFrameAutoFlow,
	LayoutFrameContract,
	LayoutFrameGap,
	LayoutFramePadding,
	LayoutFramePresetId,
	LayoutFrameVariantContract,
	LayoutFrameVariantMode,
	LookGraphScopedEffectLook,
	NodeGeometry,
	NodeStyle,
	Paint,
	RelationNumericProperty,
	RevealPaint,
	SceneAsset,
	SceneCameraRigContract,
	SceneDepthPlaneContract,
	SceneDocument,
	SceneMediaSource,
	StylePreset,
	TextStyle,
	Transform,
	TransformConstraintChannel,
	TransformConstraintSpace,
	Vec2,
	Vec3,
	VectorNode,
} from "@/entities/scene/model/types";
import type {
	StrokeWidthProfilePresetId,
	StrokeWidthProfileStop,
} from "@/shared/stroke/width-profile";
import type {
	AutomationTrack,
	EffectFieldDefinitionDraft,
	EffectInfluenceAssignmentDraft,
	EffectInfluenceFalloffDraft,
	EffectMaskSourceDraft,
} from "@/shared/vec-core";

export const AGENT_CONTRACT_VERSION = 1 as const;

/**
 * Every MCP tool the server actually registers. `import_file` is future work
 * (SVG/AI/JSON import fidelity reporting) — do not add it back here until
 * `scripts/vma-agent-mcp.ts` registers it, or `check-agent-contract.ts` will
 * flag the drift. `observe_preview_state` and `capture_editor_snapshot` are the
 * read-only Phase D native artboard capture tools (bridge ops `preview-observe`
 * / `preview-capture`); their capability and result types live in
 * `./preview-capture`, and they are deliberately absent from
 * {@link MUTATING_AGENT_TOOL_NAMES} because they never write the document.
 */
export const AGENT_TOOL_NAMES = [
	"observe_document",
	"observe_selection",
	"observe_node",
	"observe_bridge_status",
	"list_layers",
	"list_artboards",
	"list_bindable_properties",
	"list_appearance_effects",
	"list_motion_grammar",
	"list_look_graph",
	"list_look_node_capabilities",
	"load_reproduction_descriptor",
	"propose_edit_plan",
	"observe_document_live",
	"validate_edit_plan_live",
	"apply_edit_plan_live",
	"save_project_live",
	"observe_preview_state",
	"capture_editor_snapshot",
	"apply_scene_commands",
	"apply_motion_commands",
	"apply_motion_grammar_commands",
	"apply_document_commands",
	"apply_camera_commands",
	"export_artboard",
	"run_validation",
] as const;

export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

export const MUTATING_AGENT_TOOL_NAMES = [
	"apply_scene_commands",
	"apply_motion_commands",
	"apply_motion_grammar_commands",
	"apply_document_commands",
	"apply_camera_commands",
	"apply_edit_plan_live",
	"save_project_live",
] as const satisfies readonly AgentToolName[];

export type MutatingAgentToolName = (typeof MUTATING_AGENT_TOOL_NAMES)[number];

export type AgentIssueSeverity = "info" | "warning" | "error";

export const AGENT_ISSUE_TARGET_KINDS = [
	"document",
	"artboard",
	"layer",
	"node",
	"motion-track",
	"motion-grammar-binding",
	"selection",
	"export",
	"asset",
	"tool",
] as const;

export type AgentIssueTargetKind = (typeof AGENT_ISSUE_TARGET_KINDS)[number];

export type AgentIssueTarget = {
	readonly kind: AgentIssueTargetKind;
	readonly id?: string;
	readonly path?: string;
};

export type AgentIssue = {
	readonly code: string;
	readonly severity: AgentIssueSeverity;
	readonly message: string;
	readonly target?: AgentIssueTarget;
};

export type AgentIssueSummary = {
	readonly ok: boolean;
	readonly issueCount: number;
	readonly errorCount: number;
	readonly warningCount: number;
	readonly infoCount: number;
};

export type AgentIssueReport = {
	readonly summary: AgentIssueSummary;
	readonly affected: readonly AgentIssueTarget[];
	readonly issues: readonly AgentIssue[];
};

export type AgentObservationDetail = "summary" | "normal" | "full";

export type AgentObservationLimits = {
	readonly maxLayers?: number;
	readonly maxNodes?: number;
	readonly maxTracks?: number;
};

/**
 * Compact Grid/Bento health reported before agents request the heavier layer
 * tree. Drift means stored child geometry no longer matches resolved layout
 * intent; render/export can still project the layout, but geometry-based writes
 * should reapply first.
 */
export type AgentLayoutMaterializationSummary = {
	readonly frameCount: number;
	readonly managedChildCount: number;
	readonly driftedFrameCount: number;
	readonly driftedChildCount: number;
	readonly maxDrift?: number;
};

/**
 * Discovery-only style-preset summary so an agent can find preset ids/names
 * before calling `scene/apply-style-preset` or `scene/rename-style-preset`,
 * without a heavier full-library read tool. Paint/typography/appearance parts
 * are not included here — read `list_layers`/`observe_node` for a node's
 * current style if a preset's exact payload is needed.
 */
export type AgentStylePresetSummary = {
	readonly id: string;
	readonly name: string;
	readonly kind: StylePreset["kind"];
	readonly hasPaint: boolean;
	readonly hasTypography: boolean;
	readonly hasAppearance: boolean;
};

/**
 * Discovery-only component-symbol summary so an agent can find a symbol id
 * before calling `scene/insert-component-instance-from-symbol`, and gauge blast
 * radius (`instanceCount`) before editing the source. Mirrors
 * {@link AgentStylePresetSummary}'s omit-when-absent convention.
 */
export type AgentComponentSymbolSummary = {
	readonly id: string;
	readonly name: string;
	readonly sourceNodeId: string;
	readonly instanceCount: number;
};

/**
 * Discovery-only component-prop summary so an agent can find a prop id/name
 * before calling `scene/update-component-prop`/`scene/remove-component-prop`,
 * and gauge whether it is already wired to nodes (`bindingCount`) before
 * editing it. Mirrors {@link AgentStylePresetSummary}'s omit-when-absent
 * convention. Does not include the prop's `bindings` payload itself — read
 * `observe_node`'s `componentPropBindings` for a specific node's wiring, or a
 * future dedicated read if the full binding list is needed.
 */
export type AgentComponentPropSummary = {
	readonly id: string;
	readonly name: string;
	readonly type: ComponentPropType;
	readonly defaultValue: ComponentPropValue;
	readonly bindingCount: number;
};

/**
 * Discovery-only interaction summary so an agent can find an interaction
 * id/name before calling `scene/update-interaction`/`scene/remove-interaction`
 * (Interactive Motion program, T3-S1). Mirrors {@link AgentStylePresetSummary}'s
 * omit-when-absent convention. Reports the trigger's `kind`/`nodeId` and the
 * `kind` of every action (not the full action payload) — enough to decide
 * whether an interaction needs editing without a heavier read; `observe_node`'s
 * per-node interaction list additionally scopes this to interactions whose
 * trigger targets one specific node.
 */
export type AgentInteractionSummary = {
	readonly id: string;
	readonly name?: string;
	readonly triggerKind: InteractionTriggerKind;
	readonly triggerNodeId?: string;
	readonly actionKinds: readonly InteractionAction["kind"][];
};

/**
 * Compact scene-camera discovery row for agents. It exposes the authoring ids
 * needed to plan camera/depth edits without forcing callers to inspect the full
 * frozen scene-camera contract first.
 */
export type AgentSceneCameraRigSummary = {
	readonly id: string;
	readonly name: string;
	readonly scope: SceneCameraRigContract["scope"];
	readonly projectionKind: SceneCameraRigContract["projection"]["kind"];
	readonly projection: SceneCameraRigContract["projection"];
	readonly bodyPosition: SceneCameraRigContract["body"]["position"];
	readonly bodyRotation?: NonNullable<
		SceneCameraRigContract["body"]["rotation"]
	>;
	readonly targetPoint?: NonNullable<SceneCameraRigContract["target"]>["point"];
	readonly scopedArtboardIds: readonly string[];
	readonly activeArtboardIds: readonly string[];
	readonly targetNodeId?: string;
	readonly bodyControllerNodeId?: string;
	readonly targetControllerNodeId?: string;
	readonly depthNodeCount: number;
	readonly cameraTrackCount: number;
	readonly cameraTrackProperties: readonly string[];
	readonly cameraCutCount: number;
};

/** Cut-only camera switch segment exposed to agents without timeline internals. */
export type AgentSceneCameraCutSummary = Pick<
	CameraCutSegment,
	| "id"
	| "name"
	| "artboardId"
	| "cameraRigId"
	| "laneId"
	| "startFrame"
	| "durationFrames"
	| "transition"
	| "transitionDurationFrames"
	| "thumbnailFrame"
>;

/**
 * Document-level camera/depth/motion summary returned by `observe_document` when
 * the scene contains authored camera-space data.
 */
export type AgentSceneCameraSummary = {
	readonly cameraCount: number;
	readonly activeCameraRigIds: readonly string[];
	readonly depthNodeCount: number;
	readonly cameraTrackCount: number;
	readonly cameraCutCount: number;
	readonly rigs: readonly AgentSceneCameraRigSummary[];
	readonly cuts: readonly AgentSceneCameraCutSummary[];
};

/**
 * Compact document-asset discovery row. Placement stays node-owned; this row
 * only tells an agent what source metadata exists and how many nodes reference it.
 */
export type AgentSceneAssetEntrySummary = {
	readonly id: string;
	readonly kind: SceneAsset["kind"];
	readonly name: string;
	readonly sourceKind: SceneMediaSource["kind"];
	/** Present only for a source-free Program Surface declaration. */
	readonly programSurface?: AgentProgramSurfaceAssetSummary;
	readonly format?: Extract<
		SceneAsset,
		{ readonly kind: "external-scene" | "model-3d" | "code-module" }
	>["format"];
	readonly previewAssetId?: string;
	readonly previewRole?: "thumbnail" | "editor-preview" | "export-fallback";
	readonly capabilities?: readonly string[];
	readonly issueCount?: number;
	readonly issueCodes?: readonly string[];
	readonly runtimeWebglCapable?: boolean;
	readonly exportFallbackCapable?: boolean;
	readonly mimeType?: string;
	readonly width?: number;
	readonly height?: number;
	readonly durationSeconds?: number;
	readonly placedNodeCount: number;
	readonly placedNodeIds?: readonly string[];
};

/**
 * Source-free Program Surface facts safe to expose through `observe_document`.
 * The asset's JavaScript bytes, data URL, inert reference label, local approval,
 * and live runtime state deliberately remain outside this observation contract.
 */
export type AgentProgramSurfaceAssetSummary = {
	readonly runtimeKind: "webgl2";
	readonly compiledDigest: string;
	readonly snapshotDigest: string;
	readonly sourcePortability: "self-contained" | "reference-only";
	readonly output: {
		readonly kind: "rgba-texture";
		readonly alphaMode: "premultiplied" | "straight";
		readonly width: number;
		readonly height: number;
	};
	readonly timing: {
		readonly seed: number;
		readonly deterministicAtFrame: boolean;
	};
	readonly cameraSpacePolicy: "screen_2d" | "resolved-scene-camera";
	readonly delivery: {
		readonly editor: "live" | "fallback";
		readonly webglPlayer: "live" | "fallback" | "unsupported";
		readonly svgPdf: "raster-fallback" | "unsupported";
		readonly video: "capture" | "raster-fallback" | "unsupported";
	};
	readonly fallback?: {
		readonly assetId: string;
		readonly frame?: number;
	};
};

/**
 * Document-level asset-library summary returned by `observe_document` when the
 * scene carries image/video asset metadata.
 */
export type AgentSceneAssetSummary = {
	readonly assetCount: number;
	readonly imageCount: number;
	readonly videoCount: number;
	readonly externalAssetCount: number;
	readonly model3dCount: number;
	readonly codeModuleCount: number;
	readonly programSurfaceCount: number;
	readonly placedNodeCount: number;
	readonly assets: readonly AgentSceneAssetEntrySummary[];
};

/** Compact document-level discovery for Source Optics authoring. */
export type AgentSourceOpticsSummary = {
	readonly rigCount: number;
	readonly responseCount: number;
	readonly issueCount: number;
	readonly motionTrackCount: number;
	readonly parameters: readonly SourceOpticsParameterDescriptor[];
	readonly motionTracks: readonly {
		readonly id: string;
		readonly target: SourceOpticsParameterTarget;
		readonly keyframeCount: number;
		readonly staticValue?: number;
		readonly sampledFrame: number;
		readonly sampledValue?: number;
	}[];
	readonly surfaceFidelity: readonly {
		readonly artboardId: string;
		readonly editorSvg:
			| "native"
			| "approximated"
			| "capture-only"
			| "side-car-only"
			| "deferred"
			| "unsupported";
		readonly webgpu:
			| "native"
			| "approximated"
			| "capture-only"
			| "side-car-only"
			| "deferred"
			| "unsupported";
		readonly runtimeSvg:
			| "native"
			| "approximated"
			| "capture-only"
			| "side-car-only"
			| "deferred"
			| "unsupported";
	}[];
	readonly rigs: readonly {
		readonly id: string;
		readonly name: string;
		readonly artboardId: string;
		readonly sourceNodeId: string;
		readonly enabled: boolean;
		readonly responseCount: number;
	}[];
};

export type AgentDocumentSummary = {
	readonly id: string;
	readonly name: string;
	readonly schemaVersion: SceneDocument["schemaVersion"];
	readonly artboardCount: number;
	readonly layerCount: number;
	readonly nodeCount: number;
	readonly motionTrackCount: number;
	readonly motionGrammarBindingCount: number;
	readonly arrangementLayoutSnapshots?: readonly AgentArrangementLayoutSnapshotSummary[];
	readonly layout?: AgentLayoutMaterializationSummary;
	readonly stylePresets?: readonly AgentStylePresetSummary[];
	readonly componentSymbols?: readonly AgentComponentSymbolSummary[];
	readonly componentProps?: readonly AgentComponentPropSummary[];
	readonly interactions?: readonly AgentInteractionSummary[];
	readonly sceneCamera?: AgentSceneCameraSummary;
	readonly assets?: AgentSceneAssetSummary;
	readonly sourceOptics?: AgentSourceOpticsSummary;
};

/** Compact discovery/readback shape for durable Arrangement A/B snapshots. */
export type AgentArrangementLayoutSnapshotSummary = {
	readonly id: string;
	readonly name: string;
	readonly artboardId: string;
	readonly coordinateSpace: "artboard-local";
	readonly memberNodeIds: readonly string[];
	readonly captureToken: string;
	readonly capturedArtboardSize: {
		readonly width: number;
		readonly height: number;
	};
	readonly status: "valid" | "stale";
	readonly staleReasons: readonly string[];
};

export type AgentSelectionSummary = {
	readonly nodeIds: readonly string[];
	readonly primaryNodeId?: string;
	readonly artboardId?: string;
	readonly sceneCamera?: SceneCameraAuthoringSelection;
};

export type AgentDocumentObservation = {
	readonly contractVersion: typeof AGENT_CONTRACT_VERSION;
	readonly detail: AgentObservationDetail;
	readonly document: AgentDocumentSummary;
	readonly selection: AgentSelectionSummary;
	readonly issues: readonly AgentIssue[];
};

/**
 * Same identity fields as `AgentBridgeEditorDescriptor` (bridge-protocol.ts),
 * duplicated here as plain data rather than importing the bridge/live-store
 * types into this pure entity module — see {@link AgentLiveDocumentObservation}.
 */
export type AgentLiveDocumentIdentity = {
	readonly documentName: string;
	readonly workingCopyId: string;
	readonly projectId: string | null;
	readonly bindingEpoch: number;
};

export type AgentLiveArtboardSummary = {
	readonly id: string;
	readonly name: string;
	readonly width: number;
	readonly height: number;
	readonly fps: number;
	readonly durationFrames: number;
	readonly background: string;
	readonly cameraSpacePolicy?: CameraSpacePolicy;
};

export type AgentLiveMotionDocumentSummary = {
	readonly fps: number;
	readonly durationFrames: number;
};

/** One `motion.tracks` entry, bounded to ids/counts — no keyframe values. */
export type AgentLiveMotionTrackSummary = {
	readonly id: string;
	readonly targetNodeId?: string;
	readonly property: AnimatableProperty;
	readonly keyframeCount: number;
	readonly maxKeyframeFrame: number;
};

/**
 * One `motion.lookNodeTracks` entry, bounded to ids/counts — no keyframe
 * values. `owner` is the storage-level `LookGraphOwnerRef`
 * (scene/artboard/node/scoped-overlay). The summary remains a bounded read model
 * rather than a write-eligibility contract for {@link AgentLookGraphOwner}.
 */
export type AgentLiveLookNodeTrackSummary = {
	readonly id: string;
	readonly owner: LookGraphOwnerRef;
	readonly lookNodeId: string;
	readonly paramKey: string;
	readonly keyframeCount: number;
	readonly maxFrame: number;
};

/**
 * Bounded motion-document inventory for live pre-mutation proof: the full
 * per-track list for `motion.tracks` and `motion.lookNodeTracks` (ids/counts
 * only), plus simple counts for `clips`/`textAnimators`/`automation.tracks` —
 * enough to confirm what motion data already exists on a target without
 * reading any keyframe value.
 */
export type AgentLiveMotionInventory = {
	readonly tracks: readonly AgentLiveMotionTrackSummary[];
	readonly lookNodeTrackCount: number;
	readonly clipCount: number;
	readonly textAnimatorCount: number;
	readonly automationTrackCount: number;
	readonly lookNodeTracks: readonly AgentLiveLookNodeTrackSummary[];
};

/** One scene node, bounded to id/name/kind — no geometry or style. */
export type AgentLiveNodeSummary = {
	readonly id: string;
	readonly name: string;
	readonly kind: VectorNode["geometry"]["kind"];
};

/**
 * One Look-graph node inside a scoped overlay. `payload` is included for
 * every kind (every {@link LookGraphNodePayload} variant is a small,
 * scalar-parameter object — e.g. Deep Glow's — never embedded pixel/image data).
 */
export type AgentLiveLookGraphNodeSummary = {
	readonly id: string;
	readonly kind: LookGraphNodeKind;
	readonly payload: LookGraphNodePayload;
};

/** One artboard-scoped Look-graph overlay (`scene/set-scoped-look-graph-overlay`'s target shape). */
export type AgentLiveScopedLookOverlaySummary = {
	readonly id: string;
	readonly source: LookGraphScopedEffectLook["source"];
	readonly targetNodeIds: readonly string[];
	readonly graphNodes: readonly AgentLiveLookGraphNodeSummary[];
};

/**
 * Read-only snapshot of a LIVE editor's open document over the agent bridge
 * (op `"observe"`), distinct from {@link AgentDocumentObservation}: that
 * headless read summarizes a loaded snapshot for planning, while this one lets
 * an agent prove which live editor instance/working copy it is about to
 * mutate — document identity, the current artboard, motion document timing,
 * a bounded motion inventory, the current artboard's nodes, and its scoped
 * Look-graph overlays — before sending a document-timing or scoped-look
 * plan. See `docs/gravity-parent-child-study-01-live-mcp-resolution-boundary.md`
 * (blocker B2) for why this exists: `observe_document`/`list_look_graph` are
 * headless-snapshot reads and cannot serve as live pre-mutation proof.
 * Every field is bounded to ids, counts, and small typed payloads; no
 * keyframe values and no full node geometry.
 */
export type AgentLiveDocumentObservation = {
	readonly contractVersion: typeof AGENT_CONTRACT_VERSION;
	readonly identity: AgentLiveDocumentIdentity;
	readonly artboard: AgentLiveArtboardSummary;
	readonly motionDocument: AgentLiveMotionDocumentSummary;
	readonly motionInventory: AgentLiveMotionInventory;
	readonly nodes: readonly AgentLiveNodeSummary[];
	readonly scopedLookOverlays: readonly AgentLiveScopedLookOverlaySummary[];
};

export type AgentNodeTransformPatch = {
	readonly transform?: Partial<Transform>;
};

/**
 * Style fields an agent can write through the scene command bus. Legacy scalar
 * colors remain supported, `fills`/`strokes` expose the richer paint stack
 * required for mesh-gradient/multi-stroke authoring, and `effects`/`blendMode`
 * let an agent finish a node's appearance (drop/inner shadow, layer blur, and
 * Figma-style blend) end-to-end. The `stroke*` sub-options (`strokeAlign`,
 * dash pattern + offset, cap, join, miter limit) complete the stroke surface
 * alongside `strokeSoftness` (stroke-only blur) and `strokeWidthProfile`
 * (variable-width stroke, plus the `strokeWidthProfilePreset` sugar — see
 * below). Every field here is already consumed by
 * {@link createUpdateNodeStyleCommand} and the node factory (`AgentNodeStylePatch`
 * mirrors the editor's own `NodeStylePatch` exactly), so widening this boundary
 * type — and mirroring it in the MCP Zod schema — is all that is required: a
 * field present on `NodeStyle` but missing from this contract (or its Zod
 * mirror) is silently stripped, so an agent edit reports success while dropping
 * the write.
 */
export type AgentNodeStylePatch = Partial<
	Pick<
		NodeStyle,
		| "fill"
		| "stroke"
		| "strokeWidth"
		| "opacity"
		| "strokeAlign"
		| "strokeDash"
		| "strokeDashoffset"
		| "strokeCap"
		| "strokeJoin"
		| "strokeMiterLimit"
		| "strokeSoftness"
	> & {
		readonly fills: readonly Paint[];
		readonly strokes: readonly Paint[];
		readonly effects: readonly Effect[];
		readonly blendMode: BlendMode;
		/**
		 * `null` clears the profile, an array sets it directly (rejected as a typed
		 * ERROR issue if it fails `validateStrokeWidthProfile`). When
		 * `strokeWidthProfilePreset` is also present on the same patch, the preset
		 * wins and this field is ignored with a typed WARNING issue — see
		 * `compileAgentSceneCommand`'s `scene/update-node-style` case.
		 */
		readonly strokeWidthProfile: readonly StrokeWidthProfileStop[] | null;
		/**
		 * Sugar over `strokeWidthProfile`: resolves to one of
		 * `STROKE_WIDTH_PROFILE_PRESETS`, or clears the profile when `"none"`.
		 */
		readonly strokeWidthProfilePreset: StrokeWidthProfilePresetId | "none";
	}
>;

export type AgentTextNodePatch = {
	readonly text?: string;
	readonly bounds?: Bounds;
	readonly style?: Partial<TextStyle>;
};

/**
 * Artboard fields an agent can author through `scene/add-artboard`. `width`/`height`
 * are required (a new artboard needs dimensions); the compiler mints an `id`,
 * defaults `background`/`fps`/`durationFrames`/`name`, and places a missing
 * `position` to the right of the rightmost existing artboard so a created artboard
 * does not overlap the current one. Invalid dimensions or a duplicate `id` are
 * rejected as typed issues rather than the engine's silent no-op.
 */
export type AgentArtboardSpec = {
	readonly id?: string;
	readonly name?: string;
	readonly width: number;
	readonly height: number;
	readonly background?: string;
	readonly position?: Vec2;
	readonly fps?: number;
	readonly durationFrames?: number;
	readonly cameraSpacePolicy?: CameraSpacePolicy;
};

/** Artboard fields an agent can edit through `scene/update-artboard`. */
export type AgentArtboardPatch = Partial<
	Pick<
		Artboard,
		| "name"
		| "position"
		| "width"
		| "height"
		| "background"
		| "fps"
		| "durationFrames"
	>
> & {
	/** `undefined` preserves; `null` explicitly returns to undeclared. */
	readonly cameraSpacePolicy?: CameraSpacePolicy | null;
};

/** Empty top-level layer created through the Scene entity command bus. */
export type AgentLayerSpec = {
	readonly id?: string;
	readonly name?: string;
	readonly toIndex?: number;
};

/** Editable layer metadata; node membership is handled by reparent commands. */
export type AgentLayerPatch = {
	readonly name?: string;
	readonly visible?: boolean;
	readonly locked?: boolean;
};

/** Document-level sequence metadata patch. `null` clears an optional override. */
export type AgentSceneSequencePatch = {
	readonly name?: string;
	readonly fps?: number | null;
	readonly exportSize?: {
		readonly width: number;
		readonly height: number;
	} | null;
};

/** One sequence item patch. `null` restores the artboard-derived fallback. */
export type AgentSceneSequenceItemPatch = {
	readonly label?: string | null;
	readonly durationFrames?: number | null;
};

/** Safe expression-source input for one Codeable Duplicate binding. */
export type AgentDuplicateGeneratorSpec = {
	readonly sourceNodeId: string;
	readonly count: string;
	readonly seed?: number;
	readonly instance?: {
		readonly x?: string;
		readonly y?: string;
		readonly rotation?: string;
	};
};

/**
 * Geometry an agent can author through `scene/append-node`. A deliberately
 * explicit `NodeGeometry` input: every durable geometry kind remains semantic
 * and editable instead of forcing polygon/star/image data through a path or raw
 * JSON fallback. `cornerRadius` defaults to `0`; text `style` merges over the
 * scene text defaults. The `path` `shape` is a full {@link BezierShape}; the compiler rejects
 * degenerate shapes (fewer than two vertices, mismatched tangent counts, or
 * non-finite coordinates) as a typed issue rather than appending a broken node.
 */
export type AgentAppendNodeGeometry =
	| {
			readonly kind: "rect";
			readonly bounds: Bounds;
			readonly cornerRadius?: number;
			/** Optional per-corner radii (overrides `cornerRadius`). */
			readonly cornerRadii?: CornerRadii;
			/** Optional whole-shape corner smoothing (squircle), `0..1`. */
			readonly cornerSmoothing?: number;
	  }
	| { readonly kind: "ellipse"; readonly bounds: Bounds }
	| { readonly kind: "line"; readonly start: Vec2; readonly end: Vec2 }
	| {
			readonly kind: "polygon";
			readonly points: readonly Vec2[];
			readonly cornerRadius?: number;
			readonly cornerSmoothing?: number;
	  }
	| {
			readonly kind: "star";
			readonly center: Vec2;
			readonly points: number;
			readonly innerRadius: number;
			readonly outerRadius: number;
			readonly cornerRadius?: number;
			readonly cornerSmoothing?: number;
	  }
	| {
			readonly kind: "text";
			readonly bounds: Bounds;
			readonly text: string;
			readonly style?: Partial<TextStyle>;
	  }
	| {
			readonly kind: "path";
			readonly shape: BezierShape;
			/** Optional inner contours (holes) for a compound path. */
			readonly subpaths?: readonly BezierShape[];
			/** Fill rule for resolving holes; defaults to `"nonzero"`. */
			readonly fillRule?: FillRule;
	  }
	| {
			readonly kind: "image";
			readonly bounds: Bounds;
			readonly assetId: string;
	  };

/**
 * Node an agent can create. The scene node factory supplies the id, identity
 * transform, and base style defaults so agent-created nodes are indistinguishable
 * from tool-created ones.
 */
export type AgentNodeSpec = {
	readonly name?: string;
	readonly style?: AgentNodeStylePatch;
	readonly transform?: Partial<Transform>;
	readonly geometry: AgentAppendNodeGeometry;
};

/**
 * Bounded occupancy-grid input for one editable circle-cell compound path. `#`
 * creates one circular contour and `.` preserves internal negative space. A
 * single shared style keeps the generated object in one motif family instead of
 * inventing unrelated per-cell decoration.
 */
export type AgentDotMatrixSpec = {
	readonly name?: string;
	readonly origin: Vec2;
	readonly rows: readonly string[];
	readonly cellSize: number;
	readonly gap?: number;
	readonly style?: Partial<
		Pick<NodeStyle, "fill" | "stroke" | "strokeWidth" | "opacity">
	>;
};

/**
 * Compact indexed square-pixel payload emitted by Codex or another agent after
 * semantic image generation. `.` is transparent; `0-9a-v` address up to 32
 * palette entries. The compiler lowers the field into one group of contiguous
 * run-compressed paths in a single undoable scene command.
 */
export type AgentPixelArtObjectSpec = {
	readonly name: string;
	readonly origin: Vec2;
	readonly rows: readonly string[];
	readonly palette: readonly string[];
	readonly pixelSize: number;
	readonly artboardId?: string;
};

/** Generic Effect Field mutation; target descriptors stay registry-owned. */
export type AgentEffectFieldOperation =
	| {
			readonly kind: "upsert-field";
			readonly field: EffectFieldDefinitionDraft;
	  }
	| { readonly kind: "remove-field"; readonly fieldId: string }
	| {
			readonly kind: "attach-route";
			readonly assignment: EffectInfluenceAssignmentDraft;
	  }
	| { readonly kind: "remove-route"; readonly assignmentId: string }
	| {
			readonly kind: "link-route";
			readonly assignmentId: string;
			readonly fieldId: string;
	  }
	| { readonly kind: "unlink-route"; readonly assignmentId: string }
	| {
			readonly kind: "replace-field-source";
			readonly fieldId: string;
			readonly source: EffectMaskSourceDraft;
	  }
	| {
			readonly kind: "update-influence";
			readonly assignmentId: string;
			readonly patch: {
				readonly enabled?: boolean;
				readonly strength?: number;
				readonly invert?: boolean;
				readonly featherRadius?: number;
				readonly falloff?: EffectInfluenceFalloffDraft;
			};
	  };

/**
 * Sparse Grid/Bento layout edit exposed through MCP. Mirrors the scene layout
 * patch while keeping the agent contract JSON-shaped and explicit.
 */
export type AgentLayoutFramePatch = Partial<{
	readonly columns: number;
	readonly rows: number | "auto";
	readonly gap: Partial<LayoutFrameGap>;
	readonly padding: Partial<LayoutFramePadding>;
	readonly autoFlow: LayoutFrameAutoFlow;
	readonly allowOverlap: boolean | null;
	readonly preset: LayoutFramePresetId | null;
	readonly placements: Readonly<Record<string, LayoutCellPlacement>> | null;
	readonly variantMode: LayoutFrameVariantMode | null;
	readonly activeVariantId: string | null;
	readonly variants: readonly LayoutFrameVariantContract[] | null;
}>;

/** Layout creation payload accepted by `scene/create-layout-frame`. */
export type AgentLayoutFrameSpec = AgentLayoutFramePatch & {
	readonly kind?: LayoutFrameContract["kind"];
	readonly version?: LayoutFrameContract["version"];
};

/** Agent-facing patch for the authored scene-camera projection block. */
export type AgentSceneCameraProjectionPatch = Partial<
	SceneCameraRigContract["projection"]
>;

/**
 * JSON-safe scene-camera creation payload. The compiler builds the actual rig
 * from the current document so default body/target positions stay artboard-aware.
 */
export type AgentSceneCameraSpec = {
	readonly id?: string;
	readonly name?: string;
	readonly artboardId?: string | null;
	readonly targetPoint?: Partial<Vec3>;
	readonly bodyPosition?: Partial<Vec3>;
	readonly projection?: AgentSceneCameraProjectionPatch;
	readonly targetControllerNodeId?: string | null;
};

/**
 * JSON-safe scene-camera edit payload. Null clears optional bindings while
 * omitted fields leave the current rig value untouched.
 */
export type AgentSceneCameraRigPatch = {
	readonly name?: string;
	readonly scope?: SceneCameraRigContract["scope"];
	readonly projection?: AgentSceneCameraProjectionPatch;
	readonly body?: {
		readonly position?: Partial<Vec3>;
		readonly rotation?: Partial<Vec3>;
		readonly parentControllerNodeId?: string | null;
	};
	readonly target?: {
		readonly point?: Partial<Vec3>;
		readonly nodeId?: string | null;
		readonly parentControllerNodeId?: string | null;
	} | null;
	readonly parentControllerNodeId?: string | null;
};

export type AgentExternalSceneAssetSpec = {
	readonly assetId?: string;
	readonly nodeId?: string;
	readonly kind: Extract<
		SceneAsset["kind"],
		"external-scene" | "model-3d" | "code-module"
	>;
	readonly name: string;
	readonly source: SceneMediaSource;
	readonly bounds: Bounds;
	readonly artboardId?: string;
	readonly format?: Extract<
		SceneAsset,
		{ readonly kind: "external-scene" | "model-3d" | "code-module" }
	>["format"];
	readonly mimeType?: string;
	readonly width?: number;
	readonly height?: number;
	readonly previewAssetId?: string;
	readonly capabilities?: readonly string[];
	readonly issues?: readonly {
		readonly severity: AgentIssueSeverity;
		readonly code: string;
		readonly message?: string;
	}[];
};

export type AgentExistingSceneAssetPlacement = {
	readonly assetId: string;
	readonly nodeId?: string;
	readonly name?: string;
	readonly bounds: Bounds;
	readonly artboardId?: string;
	readonly layerId?: string;
};

/** Depth-plane payload agents can assign to ordinary vector nodes. */
export type AgentSceneDepthPlaneSpec = {
	readonly z: number;
	readonly billboarding?: SceneDepthPlaneContract["billboarding"];
	readonly cameraRigId?: string;
};

/** Creation payload for a scene node marked as a motion/null controller. */
export type AgentMotionControllerSpec = {
	readonly id?: string;
	readonly name?: string;
	readonly artboardId?: string | null;
	readonly position?: Partial<Vec3>;
	readonly handleRadius?: number;
	readonly visible?: boolean;
};

/** Motion/null parent binding payload; omitted matrix is derived at `frame`. */
export type AgentMotionParentBindingSpec = {
	readonly parentNodeId: string;
	readonly bindMatrix?: AffineMatrix2D;
};

/** Durable Arrangement A/B snapshot commands use explicit capture tokens so a stale snapshot is never silently recomputed. */
export type AgentArrangementLayoutSnapshotCaptureSpec = {
	readonly snapshotId: string;
	readonly name: string;
	readonly artboardId: string;
	readonly nodeIds: readonly string[];
	readonly captureToken: string;
};

export type AgentArrangementLayoutSnapshotRecaptureSpec = {
	readonly snapshotId: string;
	readonly captureToken: string;
	readonly nodeIds?: readonly string[];
	readonly name?: string;
};

/** Which camera vector triple an agent is keyframing in cameraTracks. */
export type AgentCameraVectorKeyframeKind = "body" | "target" | "bodyRotation";

export type AgentSceneCommand =
	| {
			readonly type: "scene/rename-document";
			readonly name: string;
	  }
	| {
			readonly type: "scene/reorder-artboard";
			readonly artboardId: string;
			readonly toIndex: number;
	  }
	| {
			readonly type: "scene/initialize-sequence";
			readonly name?: string;
	  }
	| {
			readonly type: "scene/update-sequence";
			readonly patch: AgentSceneSequencePatch;
	  }
	| {
			readonly type: "scene/update-sequence-item";
			readonly itemId: string;
			readonly patch: AgentSceneSequenceItemPatch;
	  }
	| {
			readonly type: "scene/reorder-sequence-item";
			readonly itemId: string;
			readonly toIndex: number;
	  }
	| {
			readonly type: "scene/remove-sequence-item";
			readonly itemId: string;
	  }
	| {
			readonly type: "scene/remove-sequence";
	  }
	| {
			readonly type: "scene/add-layer";
			readonly layer?: AgentLayerSpec;
	  }
	| {
			readonly type: "scene/update-layer";
			readonly layerId: string;
			readonly patch: AgentLayerPatch;
	  }
	| {
			readonly type: "scene/remove-layer";
			readonly layerId: string;
			readonly fallbackLayerId?: string;
	  }
	| {
			readonly type: "scene/rename-node";
			readonly nodeId: string;
			readonly name: string;
	  }
	| {
			readonly type: "scene/set-node-visibility";
			readonly nodeId: string;
			readonly visible: boolean;
	  }
	| {
			readonly type: "scene/set-node-locked";
			readonly nodeId: string;
			readonly locked: boolean;
	  }
	| {
			/** Same-kind geometry replacement; conversions require a named planner. */
			readonly type: "scene/update-node-geometry";
			readonly nodeId: string;
			readonly geometry: AgentAppendNodeGeometry;
	  }
	| {
			readonly type: "scene/create-blend";
			readonly sourceNodeIds: readonly string[];
			readonly spacing?: BlendSpacing;
			readonly orientation?: BlendOrientation;
	  }
	| {
			readonly type: "scene/update-blend";
			readonly blendNodeId: string;
			readonly patch: {
				readonly spacing?: BlendSpacing;
				readonly orientation?: BlendOrientation;
				readonly spine?: BlendSpine | null;
				readonly stacking?: BlendStackingOrder;
			};
	  }
	| {
			readonly type: "scene/remove-blend";
			readonly blendNodeId: string;
	  }
	| {
			readonly type: "scene/update-node-transform";
			readonly nodeId: string;
			readonly patch: AgentNodeTransformPatch;
	  }
	| {
			// Set the node's rotate/scale pivot to its geometry centre so a bound or
			// keyframed rotation spins the node in place instead of orbiting the local
			// origin (the default anchor is {0,0}). The editor computes the centre
			// from the live geometry, so the agent needs no bounds.
			readonly type: "scene/center-node-anchor";
			readonly nodeId: string;
	  }
	| {
			readonly type: "scene/update-node-style";
			readonly nodeId: string;
			readonly patch: AgentNodeStylePatch;
	  }
	| {
			readonly type: "scene/patch-effect-field";
			readonly target: AgentBindableEffectTarget;
			readonly operation: AgentEffectFieldOperation;
	  }
	| {
			readonly type: "scene/update-text-node";
			readonly nodeId: string;
			readonly patch: AgentTextNodePatch;
	  }
	| {
			// Uniform corner radius for a roundable primitive (rect/star/polygon).
			readonly type: "scene/update-corner-radius";
			readonly nodeId: string;
			readonly cornerRadius: number;
	  }
	| {
			// Per-corner radii for a rect/frame (merged over current).
			readonly type: "scene/update-rect-corner-radii";
			readonly nodeId: string;
			readonly radii: Partial<CornerRadii>;
	  }
	| {
			// Whole-shape corner smoothing (squircle, 0..1) for a roundable primitive.
			readonly type: "scene/update-corner-smoothing";
			readonly nodeId: string;
			readonly cornerSmoothing: number;
	  }
	| {
			readonly type: "scene/reorder-layer";
			readonly layerId: string;
			readonly toIndex: number;
	  }
	| {
			readonly type: "scene/reorder-node-within-layer";
			readonly layerId: string;
			readonly nodeId: string;
			readonly toIndex: number;
	  }
	| {
			readonly type: "scene/append-node";
			readonly layerId?: string;
			readonly node: AgentNodeSpec;
	  }
	| {
			/** Creates or replaces the generator bound to `sourceNodeId`. */
			readonly type: "scene/set-duplicate-generator";
			readonly generator: AgentDuplicateGeneratorSpec;
	  }
	| {
			/**
			 * Creates a bounded `#`/`.` occupancy grid as one editable compound
			 * path of circular contours. This is the preferred agent surface for a
			 * visible circle-cell study; ordinary `scene/append-node` remains the
			 * low-level primitive for diagnostics and bespoke geometry.
			 */
			readonly type: "scene/append-dot-matrix";
			readonly layerId?: string;
			readonly matrix: AgentDotMatrixSpec;
	  }
	| {
			/** Creates native editable objects from a compact indexed pixel field. */
			readonly type: "scene/append-pixel-art-objects";
			readonly layerId?: string;
			readonly pixelArt: AgentPixelArtObjectSpec;
	  }
	| {
			readonly type: "scene/place-external-asset";
			readonly asset: AgentExternalSceneAssetSpec;
			readonly layerId?: string;
	  }
	| {
			/** Creates or replaces one same-kind document asset entry. */
			readonly type: "scene/upsert-asset";
			readonly asset: SceneAsset;
	  }
	| {
			readonly type: "scene/place-asset";
			readonly placement: AgentExistingSceneAssetPlacement;
	  }
	| {
			/** Only unreferenced assets can be removed. */
			readonly type: "scene/remove-unused-asset";
			readonly assetId: string;
	  }
	| {
			readonly type: "scene/add-scene-camera";
			readonly camera: AgentSceneCameraSpec;
			readonly activateArtboardId?: string | null;
	  }
	| {
			readonly type: "scene/update-scene-camera";
			readonly cameraRigId: string;
			readonly patch: AgentSceneCameraRigPatch;
	  }
	| {
			readonly type: "scene/remove-scene-camera";
			readonly cameraRigId: string;
	  }
	| {
			readonly type: "scene/set-active-scene-camera";
			readonly artboardId: string;
			readonly cameraRigId: string | null;
	  }
	| {
			readonly type: "scene/set-node-depth-plane";
			readonly nodeIds: readonly string[];
			readonly depthPlane: AgentSceneDepthPlaneSpec | null;
	  }
	| {
			readonly type: "scene/add-motion-controller";
			readonly controller: AgentMotionControllerSpec;
			readonly layerId?: string;
	  }
	| {
			readonly type: "scene/set-motion-controller";
			readonly nodeId: string;
			readonly controller: { readonly handleRadius?: number } | null;
	  }
	| {
			readonly type: "scene/set-motion-parent";
			readonly nodeId: string;
			readonly binding: AgentMotionParentBindingSpec | null;
			/** Frame used to derive a keep-pose bind or coordinated detach plan. */
			readonly frame?: number;
	  }
	| {
			readonly type: "scene/set-transform-constraint";
			readonly nodeId: string;
			readonly sourceNodeId: string | null;
			readonly channels?: readonly TransformConstraintChannel[];
			readonly strength?: number;
			readonly sourceSpace?: TransformConstraintSpace;
			readonly destinationSpace?: TransformConstraintSpace;
			readonly maintainOffset?: boolean;
			readonly frame?: number;
	  }
	| {
			readonly type: "scene/set-property-relation";
			readonly nodeId: string;
			readonly relation: {
				readonly id?: string;
				readonly sourceNodeId: string;
				readonly sourceProperty: RelationNumericProperty;
				readonly targetProperty: RelationNumericProperty;
				readonly scale?: number;
				readonly offset?: number;
				readonly clamp?: { readonly min: number; readonly max: number };
			} | null;
			readonly relationId?: string;
	  }
	| {
			readonly type: "scene/bind-camera-target-node";
			readonly cameraRigId: string;
			readonly nodeId: string | null;
	  }
	| {
			readonly type: "scene/bind-camera-target-controller";
			readonly cameraRigId: string;
			readonly controllerNodeId: string | null;
	  }
	| {
			readonly type: "scene/bind-camera-body-controller";
			readonly cameraRigId: string;
			readonly controllerNodeId: string | null;
	  }
	| {
			readonly type: "scene/create-layout-frame";
			readonly frameNodeId?: string;
			readonly layerId?: string;
			readonly parentNodeId?: string | null;
			readonly sourceNodeIds: readonly string[];
			readonly layout?: AgentLayoutFrameSpec;
			readonly preset?: LayoutFramePresetId;
			readonly name?: string;
			readonly bounds?: Bounds;
	  }
	| {
			readonly type: "scene/update-layout-frame";
			readonly frameNodeId: string;
			readonly patch: AgentLayoutFramePatch;
	  }
	| {
			readonly type: "scene/set-layout-child-placement";
			readonly frameNodeId: string;
			readonly childNodeId: string;
			readonly placement: LayoutCellPlacement;
	  }
	| {
			readonly type: "scene/set-layout-children-placements";
			readonly frameNodeId: string;
			readonly placements: readonly {
				readonly childNodeId: string;
				readonly placement: LayoutCellPlacement;
			}[];
	  }
	| {
			readonly type: "scene/apply-layout-preset";
			readonly frameNodeId: string;
			readonly preset: LayoutFramePresetId;
	  }
	| {
			readonly type: "scene/pack-layout-frame";
			readonly frameNodeId: string;
	  }
	| {
			readonly type: "scene/reapply-layout-frame";
			readonly frameNodeId?: string;
	  }
	| {
			readonly type: "scene/capture-arrangement-layout-snapshot";
			readonly snapshot: AgentArrangementLayoutSnapshotCaptureSpec;
	  }
	| {
			readonly type: "scene/recapture-arrangement-layout-snapshot";
			readonly snapshot: AgentArrangementLayoutSnapshotRecaptureSpec;
	  }
	| {
			readonly type: "scene/remove-arrangement-layout-snapshot";
			readonly snapshotId: string;
	  }
	| {
			readonly type: "scene/delete-nodes";
			readonly nodeIds: readonly string[];
	  }
	| {
			/**
			 * Code-native object mask write: set one scalar property on an existing
			 * native mask relation. The relation metadata remains the canonical state
			 * owner; Effect Layer controls may proxy this later, but must compile back
			 * to this relation path instead of duplicating the value.
			 */
			readonly type: "scene/set-mask-relation-property";
			readonly contentNodeId: string;
			readonly relationId: string;
			readonly propertyId: MaskRelationPropertyId;
			readonly value: number;
	  }
	| {
			/**
			 * Code-native authoring write: set one bindable scene property by its
			 * stable registry id (see `entities/scene/model/bindable-property.ts`).
			 * The compiler validates the id against the bindable registry and
			 * compiles supported sources into the existing scene command bus: native
			 * `scene-property` paths, node-targeted numeric `effect-capability`
			 * recipe controls, and `duplicate-generator` numeric channels. This
			 * command never writes motion keyframes — it only sets scene authoring
			 * state and procedural scene side-cars.
			 * Batching multiple position/anchor vector axes for one node in a single
			 * apply is rejected (each axis rebuilds a full nested transform vector
			 * from the pre-apply snapshot); send them as separate applies instead.
			 */
			readonly type: "scene/set-bindable-property";
			readonly nodeId: string;
			readonly propertyId: string;
			readonly value: number;
	  }
	| {
			/**
			 * Code-native expression write: bind a safe DSL expression to one
			 * expression-bindable property id. Current node-scoped targets are native
			 * transform/opacity/corner geometry scalars (`transform.x/y`,
			 * `transform.anchorX/Y`, `transform.rotation`, `style.opacity`,
			 * `geometry.cornerRadius`, `geometry.cornerRadii.*`,
			 * `geometry.cornerSmoothing`), Codeable Effect recipe controls
			 * (`effect.node-look.*`), and Codeable Duplicate generator channels
			 * (`duplicate.*`).
			 */
			readonly type: "scene/set-bindable-expression";
			readonly nodeId: string;
			readonly propertyId: string;
			readonly expression: string;
	  }
	| {
			/**
			 * Clears the expression side-car for one bindable property id on a node.
			 * Native and Codeable Effect clear the per-target binding; Codeable
			 * Duplicate clears an optional channel or returns required count to its
			 * default numeric expression.
			 */
			readonly type: "scene/clear-bindable-expression";
			readonly nodeId: string;
			readonly propertyId: string;
	  }
	| {
			/**
			 * Code-native frame/scene look write: set one bindable effect property by
			 * stable registry id against scene or artboard effect-intent state. This
			 * targets frame-level vec-core recipe controls (`effect.frame-look.*`)
			 * and frame influence controls (`effect.frame-influence.*`), then compiles
			 * to `scene/update-effect-intent`; node-local look writes stay on
			 * `scene/set-bindable-property`.
			 */
			readonly type: "scene/set-bindable-effect-property";
			readonly target: AgentBindableEffectTarget;
			readonly propertyId: string;
			readonly value: number;
	  }
	| {
			/**
			 * Code-native frame/scene expression write: bind a safe DSL expression to
			 * a frame-level effect property id on a scene or artboard target. This
			 * targets `effect.frame-look.*` recipe controls and
			 * `effect.frame-influence.*` mask controls.
			 */
			readonly type: "scene/set-bindable-effect-expression";
			readonly target: AgentBindableEffectTarget;
			readonly propertyId: string;
			readonly expression: string;
	  }
	| {
			/**
			 * Clears a frame-level effect expression binding for one scene or artboard
			 * target. Static effect-intent values remain authored in normal scene
			 * state; only the expression side-car is removed.
			 */
			readonly type: "scene/clear-bindable-effect-expression";
			readonly target: AgentBindableEffectTarget;
			readonly propertyId: string;
	  }
	| {
			/**
			 * Code-native effect-stack write: add, update, remove, or reorder one
			 * typed effect layer on a scene/artboard target. Layer payloads wrap
			 * canonical vec-core recipe data with stable ids and ordering; no arbitrary
			 * JavaScript, shader, or filter graph is accepted.
			 */
			readonly type: "scene/patch-effect-stack";
			readonly target: AgentBindableEffectTarget;
			readonly operation: EffectLayerStackOperation;
	  }
	| {
			/**
			 * Code-native layer property write: set one numeric effect capability on
			 * an existing effect layer by stable property id. The property id must
			 * resolve through the bindable/effect capability registry.
			 */
			readonly type: "scene/set-effect-layer-property";
			readonly target: AgentBindableEffectTarget;
			readonly layerId: string;
			readonly propertyId: string;
			readonly value: number;
	  }
	| {
			/**
			 * Graph-first Look authoring write: apply one typed node-graph operation
			 * (add/update/remove node, connect/disconnect edge, move, set-output) to a
			 * scene/artboard target. Node payloads wrap canonical vec-core recipe data
			 * with stable ids and ports; topology is re-validated and invalid wires or
			 * unknown node ids are rejected as typed issues. No arbitrary JavaScript,
			 * shader, or filter graph is accepted.
			 */
			readonly type: "scene/patch-look-graph";
			readonly target: AgentLookGraphTarget;
			readonly operation: LookGraphOperation;
	  }
	| {
			// Mark an existing group as an ordered text-motion fragment group: its
			// children become the fragments a Range Selector sweeps (e.g. imported
			// outlined-text paths). Children are ordered by reading order; `unit`
			// defaults to `character`.
			readonly type: "scene/mark-text-fragments";
			readonly groupId: string;
			readonly unit?: TextFragmentUnit;
	  }
	| {
			/**
			 * Removes the Codeable-Duplicate generator bound to a node (generator id
			 * is `gen:<nodeId>`), reverting it to a plain node. A missing generator id
			 * is a typed no-op. Use `scene/set-duplicate-generator` for an explicit
			 * create/replace operation, or the bindable-property commands for one
			 * channel at a time.
			 */
			readonly type: "scene/remove-duplicate-generator";
			readonly nodeId: string;
	  }
	| {
			/**
			 * Creates a new artboard from an {@link AgentArtboardSpec} and focuses it.
			 * Invalid dimensions or a duplicate id are rejected as typed issues.
			 */
			readonly type: "scene/add-artboard";
			readonly artboard: AgentArtboardSpec;
	  }
	| {
			/** Edits one existing artboard (resize / background / rename / move / timing). */
			readonly type: "scene/update-artboard";
			readonly artboardId: string;
			readonly patch: AgentArtboardPatch;
	  }
	| {
			readonly type: "scene/add-source-optics-rig";
			readonly artboardId: string;
			readonly sourceNodeId: string;
			readonly id?: string;
			readonly name?: string;
	  }
	| {
			readonly type: "scene/update-source-optics-rig";
			readonly artboardId: string;
			readonly rigId: string;
			readonly patch: SourceOpticsRigPatch;
	  }
	| {
			readonly type: "scene/remove-source-optics-rig";
			readonly artboardId: string;
			readonly rigId: string;
	  }
	| {
			readonly type: "scene/bind-source-optics-response";
			readonly artboardId: string;
			readonly rigId: string;
			readonly targetNodeId: string;
			readonly id?: string;
			readonly response?: Omit<
				SourceOpticsResponseDraft,
				"id" | "targetNodeId"
			>;
	  }
	| {
			readonly type: "scene/update-source-optics-response";
			readonly artboardId: string;
			readonly rigId: string;
			readonly bindingId: string;
			readonly patch: SourceOpticsResponsePatch;
	  }
	| {
			readonly type: "scene/unbind-source-optics-response";
			readonly artboardId: string;
			readonly rigId: string;
			readonly bindingId: string;
	  }
	| {
			/**
			 * Removes an artboard. The last remaining artboard and unknown ids are
			 * rejected as typed issues; nodes on the removed artboard fall back to the
			 * optional `fallbackArtboardId` (or the engine default).
			 */
			readonly type: "scene/remove-artboard";
			readonly artboardId: string;
			readonly fallbackArtboardId?: string;
	  }
	| {
			/** Focuses an existing artboard; an unknown id is rejected as a typed issue. */
			readonly type: "scene/set-current-artboard";
			readonly artboardId: string;
	  }
	| {
			/**
			 * Moves one or more nodes to a new parent (`targetParentNodeId: null`
			 * selects the destination layer's top level). `targetLayerId` defaults to
			 * the destination parent's owning layer (or the first moved node's current
			 * layer for a same-layer top-level move); `toIndex` defaults to appending
			 * after the destination's current children, so an agent need not compute a
			 * drag-and-drop gap index. Missing node/parent/layer ids, a locked
			 * source/ancestor/destination, and reparent-into-own-descendant cycles are
			 * rejected as typed issues rather than silently dropping the affected ids.
			 */
			readonly type: "scene/reparent-nodes";
			readonly nodeIds: readonly string[];
			readonly targetParentNodeId: string | null;
			readonly targetLayerId?: string;
			readonly toIndex?: number;
	  }
	| {
			/**
			 * Wraps top-level nodes from one layer in a new frame container node
			 * (mirrors the canvas "Wrap in frame" action). `layerId` defaults to the
			 * first source node's owning layer; `frameNodeId` mints an id when
			 * omitted. Missing/nested/cross-layer sources and an empty or
			 * already-taken `frameNodeId` are rejected as typed issues.
			 */
			readonly type: "scene/frame-nodes";
			readonly sourceNodeIds: readonly string[];
			readonly layerId?: string;
			readonly frameNodeId?: string;
			readonly name?: string;
			readonly clipsContent?: boolean;
			readonly artboardId?: string;
	  }
	| {
			/**
			 * Replaces a top-level frame node with its current children — the inverse
			 * of `scene/frame-nodes`. A missing node, a node that is not a frame
			 * container, or a nested/non-top-level frame is rejected as a typed issue
			 * instead of silently no-op'ing (unlike the underlying factory, which only
			 * inspects the `frame.kind` discriminator).
			 */
			readonly type: "scene/unframe-node";
			readonly frameNodeId: string;
	  }
	| {
			/**
			 * Groups two or more top-level, same-layer nodes into a new group node
			 * (mirrors the editor's Group action, `Cmd+G`). Compiles through the same
			 * `buildGroupNodesCommand` planner the Inspector uses, so nested/missing/
			 * cross-layer/locked/hidden/duplicate sources are rejected with the same
			 * typed `grouping.*` issue codes the UI surfaces as disabled reasons.
			 */
			readonly type: "scene/group-nodes";
			readonly nodeIds: readonly string[];
	  }
	| {
			/**
			 * Replaces a top-level group node with its current children — the inverse
			 * of `scene/group-nodes` (mirrors `Cmd+Shift+G`). Compiles through
			 * `buildUngroupNodeCommand`; a missing/locked/hidden/non-group node is
			 * rejected with the same typed `grouping.*` issue codes as the UI.
			 */
			readonly type: "scene/ungroup-node";
			readonly groupNodeId: string;
	  }
	| {
			/**
			 * Authors a "use as mask" relation: `maskNodeId`'s shape becomes the mask
			 * for `contentNodeIds`. Source and content may cross layer/nesting boundaries
			 * inside one artboard; missing, locked, hidden, cross-artboard, or recursive
			 * source-subtree targets fail closed.
			 */
			readonly type: "scene/use-node-as-mask";
			readonly maskNodeId: string;
			readonly contentNodeIds: readonly string[];
			readonly kind?: AppearanceMaskRelationKind;
	  }
	| {
			/**
			 * Enables object Noise Gradient on a node from scratch in one call: sets
			 * the node's recipe to a particle Noise-Gradient material (optionally a
			 * Linear field with explicit target-space endpoints), then converts it to
			 * the scoped-look-graph overlay form the product uses (mirrors the
			 * Inspector's "Open Graph" action), reusing
			 * `createConvertNodeNoiseGradientToScopedLookGraphCommand` rather than
			 * hand-building the scoped look. `fieldMode` defaults to `"linear"`;
			 * `linearField` is only meaningful when `fieldMode` resolves to `"linear"`.
			 * `amount` sets `texture.grain.densityCoupling` — a coverage-threshold
			 * bias (denser near 1), not an intensity multiplier. `blendMode` defaults
			 * to `"hard-light"` when omitted, matching the Inspector/tool's own
			 * fresh-enable default: the noise composites OVER the object's fill
			 * (mirrors {@link NOISE_GRADIENT_FRESH_ENABLE_BLEND_MODE}). Pass the
			 * explicit `"dissolve"` enum value to opt into the legacy path where the
			 * fill itself erodes into particles instead. `mode` selects the material
			 * type: `"particle"` (default) or `"mixed"`, which layers a film-grain
			 * pass over the particle overlay. `overlayColor` (hex) tints the overlay
			 * noise. `grainStrength` is inert for `mode: "particle"`; for
			 * `mode: "mixed"` it sets the film-grain-layer strength (defaults to
			 * {@link OBJECT_NOISE_GRADIENT_DEFAULT_MIXED_GRAIN} when omitted).
			 * Note: `mode: "mixed"` combined with `blendMode: "dissolve"` routes to
			 * the dissolve erosion path and renders NO grain layer (dissolve wins),
			 * so mixed's grain is only visible with a non-dissolve blend mode.
			 * `materialStrength` and `particleContrast` only affect the `"dissolve"`
			 * blend mode and are inert on every other (overlay) blend mode.
			 * `revealPaint` (solid, linear-gradient, or radial-gradient only — an
			 * image/mesh paint is rejected) renders a second color/gradient UNDER
			 * the object's own fill wherever the dissolve erodes it away, so one
			 * node's own fill + this appearance renders the two-color
			 * interpenetrating grain that otherwise needs a second plate node
			 * stacked beneath it. It is only visible under `blendMode: "dissolve"`
			 * (every other blend mode has no "hole" for it to show through) and is
			 * reset-style: an omitted `revealPaint` on a fresh-enable call leaves
			 * the graph without one, matching the command's other params.
			 * Re-authoring an ALREADY-CONVERTED node (calling this again with the
			 * same `nodeId`) refreshes the existing scoped Look Graph's particle
			 * texture and `revealPaint` in place from this call's params, rather
			 * than leaving the graph untouched — this is what makes an AI
			 * iteration loop (tweak params, re-author, observe) actually change
			 * the rendered result. Any OTHER customization already present in that
			 * node's Look Graph (a node the user added/rewired in the Look
			 * workspace) is preserved. This differs from the Inspector's "Open
			 * Graph" action, which never touches an existing graph at all.
			 */
			readonly type: "scene/author-object-noise-gradient";
			readonly nodeId: string;
			readonly fieldMode?: "contour" | "linear" | "mesh";
			readonly linearField?: {
				readonly x1: number;
				readonly y1: number;
				readonly x2: number;
				readonly y2: number;
				readonly plateau?: number;
			};
			readonly amount?: number;
			readonly grainStrength?: number;
			readonly materialStrength?: number;
			readonly particleContrast?: number;
			readonly blendMode?: string;
			readonly mode?: "particle" | "mixed";
			readonly overlayColor?: string;
			readonly revealPaint?: RevealPaint;
	  }
	| {
			/**
			 * Releases every native "use as mask" relation pointing at `maskNodeId`
			 * (the inverse of `scene/use-node-as-mask`) so its former content renders
			 * unclipped again. A missing/unreferenced mask node id is a typed no-op
			 * issue (the underlying factory silently no-ops with no history entry).
			 */
			readonly type: "scene/release-mask";
			readonly maskNodeId: string;
	  }
	| {
			/**
			 * Attaches or replaces a native mask relation's full settings in one
			 * write: `kind`, the optional mask source (`maskNodeId`, or `value` for a
			 * source-metadata relation), and the additive
			 * {@link AppearanceMaskRelationSettings} bucket (`featherRadius` >=0 px,
			 * `opacity` 0..1, `expand` signed px, `invert`). Ranges match the
			 * Inspector's own clamps; an out-of-range value is a typed error rather
			 * than a silent alternate clamp. For a single scalar edit prefer
			 * `scene/set-mask-relation-property`, which this command's ranges mirror
			 * exactly. Rejects an unresolvable content node or an invalid relation
			 * `kind`/missing source as typed issues.
			 */
			readonly type: "scene/set-mask-relation-settings";
			readonly contentNodeId: string;
			readonly kind: AppearanceMaskRelationKind;
			readonly maskNodeId?: string;
			readonly value?: string;
			readonly relationId?: string;
			readonly settings?: AppearanceMaskRelationSettings;
	  }
	| {
			/**
			 * Mints and adds a new preset to the document's reusable style-preset
			 * library from a fresh payload (paint/typography/appearance parts).
			 * A payload that normalizes to nothing (no usable part survives
			 * normalization) is rejected as a typed issue rather than silently adding
			 * an empty preset.
			 */
			readonly type: "scene/add-style-preset";
			readonly options?: CreateStylePresetOptions;
			readonly label?: string;
	  }
	| {
			/**
			 * Inserts an already-fully-specified preset (deterministic id/name) into
			 * the library. Unlike `scene/add-style-preset`, a colliding id or name is
			 * rejected as a typed issue instead of silently dropping the insert.
			 */
			readonly type: "scene/insert-style-preset";
			readonly preset: StylePreset;
			readonly label?: string;
	  }
	| {
			/**
			 * Applies one preset's paint/appearance/typography parts to a set of
			 * nodes as one undoable edit (typography only reaches text-geometry
			 * nodes; non-text targets keep their paint/appearance part). A missing
			 * preset id or an empty resolved node list is a typed issue.
			 */
			readonly type: "scene/apply-style-preset";
			readonly presetId: string;
			readonly nodeIds: readonly string[];
			readonly label?: string;
	  }
	| {
			/**
			 * Renames a preset. A blank name, a missing preset id, or a name that
			 * collides with another preset in the library is a typed issue.
			 */
			readonly type: "scene/rename-style-preset";
			readonly presetId: string;
			readonly name: string;
	  }
	| {
			/**
			 * Replaces a preset's reusable payload with a freshly supplied one while
			 * keeping its id and name (the Inspector's "update style" action). A
			 * missing preset id or a payload that normalizes to nothing is a typed
			 * issue.
			 */
			readonly type: "scene/replace-style-preset";
			readonly presetId: string;
			readonly options: CreateStylePresetOptions;
	  }
	| {
			/**
			 * Replaces a preset's typography part only. A missing preset id or a
			 * typography payload that normalizes to nothing is a typed issue (the
			 * underlying factory deliberately refuses to let an invalid edit wipe a
			 * preset's last usable typography).
			 */
			readonly type: "scene/update-style-preset-typography";
			readonly presetId: string;
			readonly typography: StylePreset["typography"];
	  }
	| {
			/**
			 * Removes a preset from the document library. A missing preset id is a
			 * typed issue. Nodes that already applied the preset keep their
			 * value-copied styles — presets are not live links, so removal never
			 * reverts node appearance.
			 */
			readonly type: "scene/remove-style-preset";
			readonly presetId: string;
	  }
	| {
			/** Moves a preset to a zero-based position in the durable library order. */
			readonly type: "scene/reorder-style-preset";
			readonly presetId: string;
			readonly toIndex: number;
	  }
	| {
			/**
			 * Computes a destructive Boolean path operation (Pathfinder UI parity):
			 * `nodeIds[0]` is the primary node and receives the resulting geometry
			 * (transform reset to identity, baked into artboard coordinates; its
			 * style, layer position, visibility, lock state, and name are
			 * preserved); every other listed node is removed. Requires 2+ resolvable,
			 * unlocked, visible source nodes; fewer than two unique sources, a
			 * missing/hidden/locked source, or a geometry the engine cannot resolve
			 * (e.g. exactly-overlapping edges) is a typed error rather than a silent
			 * no-op. Non-error engine issues (e.g. curve flattening) still compile
			 * successfully and are reported alongside `ok:true`.
			 */
			readonly type: "scene/apply-path-operation";
			readonly operation: PathOperation;
			readonly nodeIds: readonly string[];
	  }
	| {
			/**
			 * Marks an existing scene node as a reusable component source, minting a
			 * document-library `ComponentSymbol` entry in the same undoable edit. A
			 * node that is already a source is a typed no-op issue (idempotent
			 * re-marking is not silently accepted); a node that is itself an instance
			 * cannot become a source. Call `observe_document` afterward (or read the
			 * returned `symbolId` via the compiled command's target) to get the minted
			 * symbol id for `scene/insert-component-instance-from-symbol`.
			 */
			readonly type: "scene/create-component-source";
			readonly sourceNodeId: string;
			readonly options?: CreateComponentSymbolOptions;
			readonly label?: string;
	  }
	| {
			/**
			 * Clones a new instance from a component symbol's source subtree and
			 * inserts it at an optional explicit placement. Omitted `layerId`/
			 * `artboardId` default to the source's own layer/artboard; omitted
			 * `toIndex` defaults to just after the source (or the end of the target
			 * layer when the target layer differs from the source's layer). `transform`
			 * is a partial patch merged onto the cloned root's transform (position/
			 * rotation/scale/anchor), so an agent can place the instance without a
			 * follow-up `scene/update-node-transform`. A missing symbol id, a source
			 * whose node no longer exists, or a source that has itself become an
			 * instance is a typed issue. This maps the factory pairing
			 * `planComponentInstance` + `createInsertComponentInstanceCommand`
			 * (`entities/scene/model/component-symbols.ts` /
			 * `component-symbol-commands.ts`) into one agent-addressable write; the
			 * lower-level plan-then-insert primitive is not separately exposed because
			 * this command already covers its full input contract.
			 *
			 * NOTE: this command does not carry the instance's motion — a freshly
			 * inserted instance has no keyframe tracks or grammar bindings of its own
			 * until the source is edited (which propagates automatically on the LIVE
			 * plan path) or `motion/propagate-to-instances` is called explicitly (see
			 * `apply_motion_commands`'s tool description for the propagation contract).
			 */
			readonly type: "scene/insert-component-instance-from-symbol";
			readonly symbolId: string;
			readonly options?: CreateComponentInstanceOptions;
			readonly label?: string;
	  }
	| {
			/**
			 * Sets a linked instance's per-instance motion timing offset in frames
			 * (the "wave" stagger). This records the offset on the instance's scene
			 * binding only; pair it with a `motion/upsert-keyframe`-independent track
			 * re-copy by calling `motion/propagate-to-instances` (or wait for the next
			 * source motion edit's automatic propagation) so the baked keyframe times
			 * actually shift by the new offset. A target that is not a component
			 * instance is a typed issue.
			 */
			readonly type: "scene/set-component-timing-offset";
			readonly instanceRootNodeId: string;
			readonly offsetFrames: number;
			readonly label?: string;
	  }
	| {
			/**
			 * Detaches a component instance: removes its component binding (and every
			 * descendant's binding) while preserving current geometry/style/transform/
			 * layer position, matching the editor's Detach action. The source symbol
			 * and library entry are untouched (other instances are unaffected). A
			 * target that is not a component instance is a typed issue.
			 */
			readonly type: "scene/detach-component-instance";
			readonly instanceRootNodeId: string;
			readonly label?: string;
	  }
	| {
			/**
			 * Applies one node-level override (name/style/transform/text) to a node
			 * inside a component instance, recording it on the instance root's binding
			 * so future resets/inspection can find it. `instanceNodeId` must be a node
			 * inside `instanceRootNodeId`'s source-to-instance id map (the instance
			 * root itself, or one of its remapped descendants) — a node outside that
			 * map, a non-instance root, or an override payload that normalizes to
			 * nothing (e.g. an empty style patch) is a typed issue. `text` overrides
			 * only apply when both the source and target node are text geometry.
			 */
			readonly type: "scene/apply-component-override";
			readonly instanceRootNodeId: string;
			readonly instanceNodeId: string;
			readonly override: ComponentNodeOverrideInput;
			readonly label?: string;
	  }
	| {
			/**
			 * Resets tracked component overrides on an instance, copying each matching
			 * override's current source-node value back onto the instance node and then
			 * clearing the override metadata. `filter` narrows by `instanceNodeId` and/
			 * or override `kind`; an omitted filter resets every tracked override on the
			 * instance. A target that is not a component instance, or a filter that
			 * matches zero tracked overrides, is a typed issue.
			 */
			readonly type: "scene/reset-component-override";
			readonly instanceRootNodeId: string;
			readonly filter?: ComponentOverrideResetFilter;
			readonly label?: string;
	  }
	| {
			/**
			 * Adds a host-settable Motion Component prop to the document library.
			 * Exported SVG/WebGL runtimes consume surviving typed bindings, and color
			 * props may also be authored through Inspector Shared colors.
			 * `options.id` is minted (`prop-*`) when
			 * omitted; a supplied id that collides with an existing prop is a typed
			 * issue rather than silently re-minting a different one. Every refusal
			 * condition `createComponentProp` encodes is pre-checked as a distinct
			 * typed issue: blank/invalid-identifier/reserved/colliding `options.name`,
			 * a `defaultValue.type` that does not match `options.type`, and (per
			 * binding in `options.bindings`) a missing target node, a binding `kind`
			 * incompatible with `options.type`, an unknown/non-numeric/non-eligible
			 * `bindable` propertyId, a non-SOLID `style-color` paint target, or a
			 * `text-content` target that is not a text node.
			 */
			readonly type: "scene/add-component-prop";
			readonly options: CreateComponentPropOptions;
			readonly label?: string;
	  }
	| {
			/**
			 * Applies a partial patch to an existing component prop —
			 * `patch.bindings`, when present, REPLACES the prop's full binding list
			 * rather than merging into it (send the complete desired list, not a
			 * delta). A missing `propId` is a typed issue. A `patch.name` is
			 * pre-checked against {@link validateComponentPropName}'s rules
			 * (excluding the prop's own current name from the collision check, so
			 * re-sending the same name is not a self-collision) and, if present, a
			 * `patch.defaultValue` is pre-checked against the prop's (non-patchable)
			 * `type`; each `patch.bindings` entry is pre-checked exactly like
			 * `scene/add-component-prop`'s binding conditions.
			 */
			readonly type: "scene/update-component-prop";
			readonly propId: string;
			readonly patch: ComponentPropUpdatePatch;
			readonly label?: string;
	  }
	| {
			/**
			 * Removes a component prop from the document library. A missing `propId`
			 * is a typed issue. Nodes referenced by the prop's bindings are
			 * untouched — bindings describe which nodes a prop drives, not a
			 * structural relationship the removed prop owns.
			 */
			readonly type: "scene/remove-component-prop";
			readonly propId: string;
			readonly label?: string;
	  }
	| {
			/**
			 * Adds an authored trigger -> action interaction to the document library
			 * (Interactive Motion program, T3-S1: document model + agent authoring
			 * only — no renderer/exporter/editor-preview consumes this yet).
			 * `options.id` is minted (`interaction-*`) when omitted; a supplied id
			 * that collides with an existing interaction is a typed issue rather than
			 * silently re-minting a different one. Pre-checked as distinct typed
			 * issues: an empty `options.actions` list, a `trigger.nodeId` that does
			 * not resolve in the scene, an out-of-range `trigger.threshold`, a
			 * `scroll-progress` trigger whose `actions` is not exactly one
			 * `{kind:"seek", progress}`/`{kind:"play-clip"}` entry, an invalid `seek`
			 * action (not exactly one of `frame`/`progress`, or an out-of-range
			 * value), and a `set-prop` action whose `value` type mismatches an
			 * EXISTING component prop's declared type. An unresolved `play-clip`/
			 * `toggle-clip` `clipId` or `set-prop` `propName` is a WARNING (the clip/
			 * prop may be authored later), not a refusal.
			 */
			readonly type: "scene/add-interaction";
			readonly options: CreateInteractionOptions;
			readonly label?: string;
	  }
	| {
			/**
			 * Applies a partial patch to an existing interaction — `patch.trigger`/
			 * `patch.actions`, when present, REPLACE the interaction's trigger/action
			 * list wholesale rather than merging into it (send the complete desired
			 * value, not a delta). A missing `interactionId` is a typed issue. Each
			 * present field is pre-checked exactly like `scene/add-interaction`'s
			 * conditions (evaluated against the patched result, not just the delta).
			 */
			readonly type: "scene/update-interaction";
			readonly interactionId: string;
			readonly patch: InteractionUpdatePatch;
			readonly label?: string;
	  }
	| {
			/**
			 * Removes an interaction from the document library. A missing
			 * `interactionId` is a typed issue.
			 */
			readonly type: "scene/remove-interaction";
			readonly interactionId: string;
			readonly label?: string;
	  };

export type AgentBindableEffectTarget =
	| { readonly scope: "scene" }
	| { readonly scope: "current-artboard" }
	| { readonly scope: "default-artboard" }
	| { readonly scope: "artboard"; readonly artboardId: string };

/**
 * Look graphs additionally have persistent selection-scoped owners. This stays
 * separate from {@link AgentBindableEffectTarget}: effect fields and layer stacks
 * do not own an arbitrary selected-node replacement graph.
 */
export type AgentLookGraphTarget =
	| AgentBindableEffectTarget
	| {
			readonly scope: "scoped-overlay";
			readonly artboardId: string;
			readonly scopedLookId: string;
	  };

/** Concrete owner persisted by a Look-node MotionDocument track. */
export type AgentLookGraphOwner =
	| { readonly scope: "scene" }
	| { readonly scope: "artboard"; readonly artboardId: string }
	| { readonly scope: "node"; readonly nodeId: string }
	| {
			readonly scope: "scoped-overlay";
			readonly artboardId: string;
			readonly scopedLookId: string;
	  };

/**
 * Easing an agent can apply to the segment LEAVING a keyframe. `template` is the
 * preferred semantic path for authored intent; `preset` is the legacy CSS-style
 * vocabulary; `custom` exposes the exact normalized cubic sampled by Vecmo.
 * Optional y handles preserve backward compatibility with older x-only callers.
 */
export type AgentKeyframeEasing =
	| { readonly kind: "template"; readonly templateId: MotionTimingTemplateId }
	| { readonly kind: "preset"; readonly preset: EasingPreset }
	| {
			readonly kind: "custom";
			readonly x1: number;
			readonly y1?: number;
			readonly x2: number;
			readonly y2?: number;
	  };

/**
 * Fields an agent can author when creating an animation clip through
 * `motion/create-clip`. `provenance` is intentionally excluded from this
 * boundary type even though {@link AnimationClip} carries it: it marks a clip
 * as motion-grammar-generated, which is not something an agent should be able
 * to fabricate.
 */
export type AgentAnimationClipSpec = {
	readonly id?: string;
	readonly name: string;
	readonly startFrame: number;
	readonly durationFrames: number;
	readonly trackIds?: readonly string[];
};

export type AgentMotionCommand =
	| {
			readonly type: "motion/apply-clip-timing-template";
			readonly clipId: string;
			readonly templateId: MotionTimingTemplateId;
	  }
	| {
			readonly type: "motion/repair-path-morph-topology";
			readonly trackId: string;
	  }
	| {
			readonly type: "motion/set-path-morph-first-vertex";
			readonly trackId: string;
			readonly frame: number;
			readonly firstVertexIndex: number;
	  }
	| {
			readonly type: "motion/reverse-path-morph-winding";
			readonly trackId: string;
			readonly frame: number;
	  }
	| {
			/** Creates paired X/Y stops plus editable spatial cubic metadata. */
			readonly type: "motion/enable-position-path";
			readonly nodeId: string;
			readonly keys: readonly {
				readonly frame: number;
				readonly position: Vec2;
				readonly inTangent?: Vec2;
				readonly outTangent?: Vec2;
				readonly spatialMode?: PositionPathSpatialMode;
				readonly roving?: boolean;
			}[];
	  }
	| {
			/** Patches one existing spatial key without changing scalar values/ease. */
			readonly type: "motion/update-position-path-key";
			readonly nodeId: string;
			readonly frame: number;
			readonly inTangent?: Vec2;
			readonly outTangent?: Vec2;
			readonly spatialMode?: PositionPathSpatialMode;
			readonly roving?: boolean;
	  }
	| {
			/** Retimes paired X/Y values and their spatial key atomically. */
			readonly type: "motion/retime-position-path-key";
			readonly nodeId: string;
			readonly fromFrame: number;
			readonly toFrame: number;
	  }
	| {
			/** Sets one numeric optical key through the exact rig/ray/binding address. */
			readonly type: "motion/set-source-optics-keyframe";
			readonly target: SourceOpticsParameterTarget;
			readonly frame: number;
			readonly value: number;
	  }
	| {
			/** Removes one numeric optical key through the exact owner address. */
			readonly type: "motion/remove-source-optics-keyframe";
			readonly target: SourceOpticsParameterTarget;
			readonly frame: number;
	  }
	| {
			/**
			 * `easing` (optional) sets the timing of the segment leaving THIS
			 * keyframe at insert/replace time — equivalent to upserting the key and
			 * then issuing `motion/set-keyframe-easing` for it in one call. Omit it to
			 * keep the engine's default (a new key eases in/out symmetrically; an
			 * existing key's easing is left untouched when only its value changes).
			 */
			readonly type: "motion/upsert-keyframe";
			readonly nodeId: string;
			readonly property: AnimatableProperty;
			readonly frame: number;
			readonly value: AnimatableValue;
			readonly easing?: AgentKeyframeEasing;
	  }
	| {
			/**
			 * Rewrites the easing of the segment leaving an EXISTING keyframe without
			 * touching its value, addressed the same way as `motion/retime-keyframe`
			 * (`trackId` + the left keyframe's current `frame`). Use
			 * `motion/upsert-keyframe`'s `easing` field instead when creating a new key.
			 */
			readonly type: "motion/set-keyframe-easing";
			readonly trackId: string;
			readonly frame: number;
			readonly easing: AgentKeyframeEasing;
	  }
	| {
			readonly type: "motion/retime-keyframe";
			readonly trackId: string;
			readonly fromFrame: number;
			readonly toFrame: number;
	  }
	| {
			readonly type: "motion/remove-keyframe";
			readonly trackId: string;
			readonly frame: number;
	  }
	| {
			/**
			 * Removes one existing motion track and all of its keyframes. An unknown
			 * `trackId` is a typed issue rather than a no-op, so a plan that lists
			 * legacy track ids explicitly fails loudly if one is already gone.
			 */
			readonly type: "motion/remove-track";
			readonly trackId: string;
	  }
	| {
			/**
			 * Code-native motion write: upsert a keyframe by stable bindable-property
			 * id. The compiler resolves the id's keyframe channel (an
			 * `AnimatableProperty`) through the bindable registry and delegates to
			 * `motion/upsert-keyframe`, so motion data stays in `MotionDocument` and
			 * never enters `SceneDocument`. Ids without a keyframe channel
			 * (effect-capability, duplicate-generator) are rejected as non-keyframable.
			 */
			readonly type: "motion/set-bindable-keyframe";
			readonly nodeId: string;
			readonly propertyId: string;
			readonly frame: number;
			readonly value: number;
	  }
	| {
			/**
			 * Legacy look-node keyframe address. Omitted `artboardId` means the scene
			 * graph and a present id means that artboard graph. New callers should use
			 * the typed `owner` form below so scoped overlays cannot be misaddressed.
			 */
			readonly type: "motion/upsert-look-node-keyframe";
			readonly lookNodeId: string;
			readonly paramKey: string;
			readonly frame: number;
			readonly value: number;
			readonly artboardId?: string;
			readonly owner?: never;
			readonly expectedTargetNodeIds?: readonly string[];
	  }
	| {
			/**
			 * Keyframes one numeric param in a concrete Look graph owner. The owner is
			 * deliberately not a broad bindable-effect target: it can address scene,
			 * artboard, node-recipe, or one existing scoped overlay without widening
			 * unrelated effect field/stack commands. When supplied for a scoped overlay, the expected
			 * target set is checked before the key can enter MotionDocument.
			 */
			readonly type: "motion/upsert-look-node-keyframe";
			readonly lookNodeId: string;
			readonly paramKey: string;
			readonly frame: number;
			readonly value: number;
			readonly owner: AgentLookGraphOwner;
			readonly artboardId?: never;
			readonly expectedTargetNodeIds?: readonly string[];
	  }
	| {
			/**
			 * Removes an entire Look-node parameter track (every keyframe) under a
			 * concrete owner. Mirrors the `motion/upsert-look-node-keyframe` owner
			 * form: `owner` is required, and a scoped overlay must present the exact
			 * existing `expectedTargetNodeIds` set before its track can be removed.
			 * An unknown owner/graph/node/param, or an absent track, is a typed issue.
			 */
			readonly type: "motion/remove-look-node-track";
			readonly owner: AgentLookGraphOwner;
			readonly lookNodeId: string;
			readonly paramKey: string;
			readonly expectedTargetNodeIds?: readonly string[];
	  }
	| {
			readonly type: "motion/upsert-camera-keyframe";
			readonly cameraRigId: string;
			readonly property: CameraRigAnimatableProperty;
			readonly frame: number;
			readonly value: number;
	  }
	| {
			/**
			 * Binds one numeric scene-camera rig channel to an expression. The
			 * expression composes over the sampled channel (which arrives as `value`)
			 * and may read `control("id")` for a published control of a linked
			 * production, so one control edit can move the camera.
			 */
			readonly type: "motion/set-camera-channel-expression";
			readonly cameraRigId: string;
			readonly channel: CameraRigAnimatableProperty;
			readonly expression: string;
	  }
	| {
			/** Clears the expression on one scene-camera rig channel. */
			readonly type: "motion/remove-camera-channel-expression";
			readonly cameraRigId: string;
			readonly channel: CameraRigAnimatableProperty;
	  }
	| {
			/**
			 * Binds one Range Selector's Offset to an expression, addressed by the
			 * animator binding id plus the ordered selector index. The sampled Offset
			 * arrives as `value`; `control("id")` is allowed.
			 */
			readonly type: "motion/set-text-animator-offset-expression";
			readonly bindingId: string;
			readonly selectorIndex: number;
			readonly expression: string;
	  }
	| {
			/** Clears one Range Selector's Offset expression. */
			readonly type: "motion/remove-text-animator-offset-expression";
			readonly bindingId: string;
			readonly selectorIndex: number;
	  }
	| {
			readonly type: "motion/upsert-production-control-keyframe";
			readonly linkId: string;
			readonly controlId: string;
			readonly frame: number;
			readonly value: number;
	  }
	| {
			readonly type: "motion/remove-production-control-keyframe";
			readonly linkId: string;
			readonly controlId: string;
			readonly frame: number;
	  }
	| {
			readonly type: "motion/retime-production-control-keyframe";
			readonly linkId: string;
			readonly controlId: string;
			readonly fromFrame: number;
			readonly toFrame: number;
	  }
	| {
			readonly type: "motion/upsert-camera-vector-keyframes";
			readonly cameraRigId: string;
			readonly kind: AgentCameraVectorKeyframeKind;
			readonly frame: number;
			readonly value: Partial<Record<"x" | "y" | "z", number>>;
	  }
	| {
			readonly type: "motion/remove-camera-keyframe";
			readonly cameraRigId: string;
			readonly property: CameraRigAnimatableProperty;
			readonly frame: number;
	  }
	| {
			readonly type: "motion/remove-camera-track";
			readonly cameraRigId: string;
			readonly property: CameraRigAnimatableProperty;
	  }
	| {
			readonly type: "motion/remove-camera-rig-tracks";
			readonly cameraRigId: string;
	  }
	| {
			readonly type: "motion/upsert-camera-cut";
			readonly segment: CameraCutSegment;
	  }
	| {
			readonly type: "motion/retime-camera-cut";
			readonly segmentId: string;
			readonly startFrame?: number;
			readonly durationFrames?: number;
	  }
	| {
			readonly type: "motion/remove-camera-cut";
			readonly segmentId: string;
	  }
	| {
			readonly type: "motion/retime-camera-keyframe";
			readonly trackId: string;
			readonly fromFrame: number;
			readonly toFrame: number;
	  }
	| {
			readonly type: "motion/set-camera-keyframe-easing";
			readonly trackId: string;
			readonly frame: number;
			readonly easing: AgentKeyframeEasing;
	  }
	| {
			// Apply a text-animator preset (Range Selector reveal) to a text node
			// (live-text split render) or a marked group (outline fragments). `target`
			// is inferred from the node when omitted: text → live-text, group →
			// outline-group. Motion stays a side-car; SceneDocument is untouched.
			readonly type: "motion/apply-text-animator";
			readonly nodeId: string;
			readonly preset: TextAnimatorPresetId;
			readonly target?: "live-text" | "outline-group";
			readonly durationFrames?: number;
	  }
	| {
			// Remove the text animator bound to a node (binding id is `text-anim-<nodeId>`).
			readonly type: "motion/remove-text-animator";
			readonly nodeId: string;
	  }
	| {
			// Toggles the text animator bound to a node (binding id is
			// `text-anim-<nodeId>`) on/off without touching its selectors or preset
			// choice. A missing binding is a no-op, mirroring
			// `motion/remove-text-animator`'s no-op-on-missing-id contract.
			readonly type: "motion/set-text-animator-enabled";
			readonly nodeId: string;
			readonly enabled: boolean;
	  }
	| {
			/**
			 * Creates an authorable timeline clip in the MotionDocument side-car.
			 * `id` is optional (the compiler mints one); a supplied duplicate id is
			 * rejected as a typed issue rather than silently no-oping. `trackIds`
			 * defaults to empty — a clip may block timing before tracks are assigned.
			 * `provenance` is deliberately not agent-authorable: it marks a clip as
			 * motion-grammar-generated, which an agent-created clip is not.
			 */
			readonly type: "motion/create-clip";
			readonly clip: AgentAnimationClipSpec;
	  }
	| {
			/** Renames a clip. An empty name is sanitized to a placeholder by the engine, never rejected. */
			readonly type: "motion/rename-clip";
			readonly clipId: string;
			readonly name: string;
	  }
	| {
			/** Retimes a clip to a normalized document-local frame range (whole frames). */
			readonly type: "motion/trim-clip";
			readonly clipId: string;
			readonly startFrame: number;
			readonly durationFrames: number;
	  }
	| {
			/**
			 * Replaces a clip's track membership. Missing track ids, duplicates, and
			 * tracks already assigned to another clip whose range overlaps this one
			 * are typed issues (not a silent partial assignment): the agent gets an
			 * explicit reason for each rejected id instead of guessing why fewer
			 * tracks landed than requested.
			 */
			readonly type: "motion/assign-clip-tracks";
			readonly clipId: string;
			readonly trackIds: readonly string[];
	  }
	| {
			/** Reorders a clip within the clip lane; `toIndex` is clamped to the current clip count. */
			readonly type: "motion/reorder-clip";
			readonly clipId: string;
			readonly toIndex: number;
	  }
	| {
			/** Deletes a clip. Tracks and SceneDocument are untouched. */
			readonly type: "motion/delete-clip";
			readonly clipId: string;
	  }
	| {
			/** Adds one complete vec-core automation track to the durable Motion side-car. */
			readonly type: "motion/create-automation-track";
			readonly track: AutomationTrack;
	  }
	| {
			/** Replaces one automation track addressed by its current stack index. */
			readonly type: "motion/update-automation-track";
			readonly trackIndex: number;
			readonly track: AutomationTrack;
	  }
	| {
			/** Removes one automation track addressed by its current stack index. */
			readonly type: "motion/remove-automation-track";
			readonly trackIndex: number;
	  }
	| {
			/** Reorders one automation track within its durable stack. */
			readonly type: "motion/reorder-automation-track";
			readonly trackIndex: number;
			readonly toIndex: number;
	  }
	| {
			/** Enables or disables automation without discarding authored tracks. */
			readonly type: "motion/set-automation-enabled";
			readonly enabled: boolean;
	  }
	| {
			/** Removes the complete automation recipe and all of its tracks. */
			readonly type: "motion/remove-automation";
	  }
	| {
			/**
			 * Explicitly resyncs every linked component instance's keyframe tracks from
			 * its source, mapping {@link planMotionPropagation}
			 * (`entities/component-motion/model/propagate-motion.ts`). The LIVE plan
			 * path (`apply_edit_plan_live`) already runs this automatically after every
			 * source motion commit — the editor's `useMotionPropagation` store
			 * subscription fires on any `useMotionStore` undo-stack growth regardless of
			 * caller, so a live source edit already reaches its instances with no
			 * separate call. The HEADLESS path (`apply_motion_commands` against a
			 * loaded document snapshot) has no live store subscription to piggyback on,
			 * so `applyAgentMotionCommands` appends this same propagation automatically
			 * after every headless batch that edits a source's tracks — this command
			 * exists for recovery (a document saved before propagation existed, or
			 * edited by another tool) and for forcing a resync without touching the
			 * source itself. Idempotent: re-running when instances already match their
			 * source is a no-op. `sourceNodeIds` narrows to specific component sources;
			 * omitted propagates every source in the document. A `sourceNodeIds` entry
			 * that is not a component source (e.g. missing, a plain node, or an
			 * instance) is a typed issue; a fully valid request with nothing to
			 * propagate (no linked instances) is a typed info issue, not silent
			 * `ok:true`.
			 */
			readonly type: "motion/propagate-to-instances";
			readonly sourceNodeIds?: readonly string[];
	  };

export type AgentMotionGrammarCommand =
	| {
			/**
			 * Applies one authorable motion-grammar technique to an ordered target set.
			 * This writes only the motion-grammar side-car: it does not bake tracks,
			 * create workspace nodes, or mutate SceneDocument/MotionDocument.
			 */
			readonly type: "motion-grammar/apply-technique";
			readonly techniqueId: MotionGrammarTechniqueId;
			readonly targetIds: readonly string[];
			readonly bindingId?: string;
			readonly roleMap?: Readonly<Record<string, string>>;
			readonly parameters?: Readonly<Record<string, number>>;
			readonly arrangementMapping?: MotionGrammarArrangementMapping;
			readonly seed?: number;
			/** Optional explicit Random Pulse envelope; omitted uses the promoted default. */
			readonly randomPulseProfile?: MotionGrammarRandomPulseProfile;
	  }
	| {
			/**
			 * Applies Afterimage to explicitly selected existing source nodes. The
			 * planner preserves those ids, verifies one artboard, and keeps echoes as
			 * presentation artifacts; it never clears or clones Scene nodes.
			 */
			readonly type: "motion-grammar/apply-afterimage-selected-sources";
			readonly selectedSourceNodeIds: readonly string[];
			readonly bindingId: string;
			readonly parameters?: Readonly<Record<string, number>>;
	  }
	| {
			/** Updates authorable numeric parameters and optional binding-level seed. */
			readonly type: "motion-grammar/update-parameters";
			readonly bindingId: string;
			readonly parameters: Readonly<Record<string, number>>;
			readonly seed?: number;
	  }
	| {
			/**
			 * Patches structural binding semantics without replacing the technique id.
			 * `null` explicitly clears optional fields; omission preserves them.
			 */
			readonly type: "motion-grammar/update-binding";
			readonly bindingId: string;
			readonly targetIds?: readonly string[];
			readonly roleMap?: Readonly<Record<string, string>> | null;
			readonly arrangementMapping?: MotionGrammarArrangementMapping | null;
			readonly randomPulseProfile?: MotionGrammarRandomPulseProfile | null;
			readonly seed?: number | null;
			readonly effectBinding?: MotionGrammarEffectBinding | null;
	  }
	| {
			/** Reorders one binding in the durable evaluation/authoring stack. */
			readonly type: "motion-grammar/reorder-binding";
			readonly bindingId: string;
			readonly toIndex: number;
	  }
	| {
			/** Removes one motion-grammar binding by id. */
			readonly type: "motion-grammar/remove-binding";
			readonly bindingId: string;
	  }
	| {
			/**
			 * Grammar twin of `motion/propagate-to-instances`: explicitly re-derives
			 * every linked component instance's cloned grammar bindings from its
			 * source, mapping {@link planGrammarPropagation}
			 * (`entities/component-motion/model/propagate-grammar.ts`). Same automatic-
			 * on-LIVE / automatic-after-HEADLESS-batch / recovery-tool contract as the
			 * motion command — see its doc comment. Idempotent (deep-equal skip); a
			 * `sourceNodeIds` entry that is not a component source is a typed issue; a
			 * fully valid request with nothing to propagate is a typed info issue.
			 */
			readonly type: "motion-grammar/propagate-to-instances";
			readonly sourceNodeIds?: readonly string[];
	  };

/**
 * Camera verbs v1 — global camera moves that write SPARSE `cameraTracks`
 * keyframes plus their projection/depth-plane scene setup. Each verb is a
 * cross-store authoring beat compiled through the pure planners in
 * `entities/camera-motion/model/camera-verbs.ts`; the compiled bundle carries
 * both scene and motion command arrays and is applied under one compound undo
 * (the `applyCameraVerb` facade in `features/scene-camera/model/authoring.ts`).
 * NOT motion-grammar techniques and NOT live expression channels — the FROZEN
 * camera-track model already carries the keys, which stay editable in the
 * Timeline camera lanes.
 */
export type AgentCameraVerbCommand =
	| {
			/**
			 * Converge on the subject(s): orthographic projection-zoom (depth is
			 * ignored under ortho, so body-z would be a no-op) or a perspective
			 * body-z dolly. Terminal-eased (no hard stop). Always pans the target
			 * onto the subject centroid.
			 */
			readonly type: "camera/push-in";
			readonly subjectIds: readonly string[];
			readonly artboardId?: string;
			readonly startFrame?: number;
			readonly durationFrames?: number;
			readonly mode?: "zoom" | "dolly";
	  }
	| {
			/**
			 * The one-shot flat→3D conversion. Switches/creates a perspective rig
			 * (orthographic makes depth-plane parallax a no-op), assigns near/mid/far
			 * depth planes to the role groups (children inherit down the group tree),
			 * and writes a slow lateral truck so near/far planes separate on screen.
			 */
			readonly type: "camera/parallax-establish";
			readonly artboardId?: string;
			readonly startFrame?: number;
			readonly durationFrames?: number;
			readonly near?: readonly string[];
			readonly mid?: readonly string[];
			readonly far?: readonly string[];
	  }
	| {
			/**
			 * Pin the target at the subject and arc the body around it on a
			 * constant-radius circle in the x/z plane (sparse `bodyX`/`bodyZ` keys) —
			 * a POSITIONAL arc, never a `bodyRotationX/Y`; camera verbs reserve
			 * camera-basis rotation for an explicitly reviewed advanced use rather
			 * than treating it as a general 3D-plane recipe.
			 */
			readonly type: "camera/orbit";
			readonly subjectIds: readonly string[];
			readonly artboardId?: string;
			readonly startFrame?: number;
			readonly durationFrames?: number;
			readonly sweepDegrees?: number;
	  };

/**
 * Typed cross-store document operations. The live review/apply coordinator
 * commits every affected Scene, Motion, and Motion Grammar owner under one
 * compound undo id; the headless adapter returns all updated snapshots or
 * discards all of them when any runner rejects the batch.
 */
export type AgentDocumentCommand =
	| {
			readonly type: "document/update-timing";
			readonly artboardId: string;
			readonly fps: number;
			readonly durationFrames: number;
			readonly temporalPolicy: "preserve-frame-indices";
			readonly outOfRangePolicy: "reject";
	  }
	| {
			/** Converts one path to the same semantic draw-on used by Pencil GUI. */
			readonly type: "document/apply-stroke-draw-on";
			readonly nodeId: string;
			readonly durationFrames: number;
			readonly reverse?: boolean;
			readonly bindingId?: string;
	  }
	| {
			/** Materializes a grammar binding as ordinary editable artifacts. */
			readonly type:
				| "document/bake-motion-grammar-binding"
				| "document/expand-motion-grammar-binding";
			readonly bindingId: string;
			readonly sampleStepFrames?: number;
			readonly sourceDisposition: "archive" | "remove";
	  }
	| {
			/** Replaces one semantic role and retargets binding-owned motion. */
			readonly type: "document/replace-motion-grammar-role";
			readonly bindingId: string;
			readonly fromNodeId: string;
			readonly toNodeId: string;
			readonly removeGeneratedSource?: boolean;
	  };

export type AgentCommandReviewKind =
	| "scene"
	| "motion"
	| "motion-grammar"
	| "camera"
	| "document";

export type AgentCommandReviewReport = AgentIssueReport & {
	readonly kind: AgentCommandReviewKind;
	readonly tool:
		| "apply_scene_commands"
		| "apply_motion_commands"
		| "apply_motion_grammar_commands"
		| "apply_document_commands"
		| "apply_camera_commands"
		| "apply_edit_plan_live";
	readonly commandCount: number;
	readonly validCommandCount: number;
};

export type AgentEditPlanStepStatus = "ready" | "blocked";

export type AgentEditPlanStep = {
	readonly id: string;
	readonly title: string;
	readonly status: AgentEditPlanStepStatus;
	readonly tool?: AgentToolName;
	readonly affected: readonly AgentIssueTarget[];
	readonly issueCodes: readonly string[];
};

export type AgentEditPlan = {
	readonly intent: string;
	readonly target?: AgentIssueTarget;
	readonly ready: boolean;
	readonly affected: readonly AgentIssueTarget[];
	readonly summary: AgentIssueSummary;
	readonly validation?: AgentIssueReport;
	readonly reports: readonly AgentCommandReviewReport[];
	readonly steps: readonly AgentEditPlanStep[];
	readonly nextTool?: AgentToolName;
};

export type AgentCommandPlanMode = "validate" | "apply";

export type AgentCommandPlanApproval = {
	readonly approved: boolean;
	readonly reviewer?: string;
	readonly note?: string;
	/**
	 * True when the editor short-circuited a per-request click, either through
	 * the human-granted "auto-apply" trust mode or through the local development
	 * bridge auto-approval path. The agent never sets this — only editor-owned
	 * approval wrappers do. Optional and additive: existing callers that never
	 * populate it keep `approved: true` behavior unchanged.
	 */
	readonly autoApplied?: boolean;
};

export type AgentCommandPlanRequest = {
	readonly planId: string;
	readonly intent: string;
	readonly target?: AgentIssueTarget;
	readonly transactionId?: string;
	readonly documentCommands?: readonly AgentDocumentCommand[];
	readonly sceneCommands?: readonly AgentSceneCommand[];
	readonly motionCommands?: readonly AgentMotionCommand[];
	readonly motionGrammarCommands?: readonly AgentMotionGrammarCommand[];
	readonly includeValidation?: boolean;
};

export type AgentCommandPlanApplyRequest = AgentCommandPlanRequest & {
	readonly approval?: AgentCommandPlanApproval;
};

export type AgentCommandTransactionStore =
	| "scene"
	| "motion"
	| "motion-grammar";

export type AgentCommandTransactionEntry = {
	readonly store: AgentCommandTransactionStore;
	readonly transactionId: string;
	readonly label: string;
	readonly commandCount: number;
	readonly undoUnit: "single-transaction";
};

export type AgentCommandTransactionPolicy = {
	readonly entries: readonly AgentCommandTransactionEntry[];
	readonly coalesce:
		| "none"
		| "commands-in-each-store-are-wrapped-in-one-transaction";
	readonly crossStoreUndo: "single-store" | "compound-command-stores";
	readonly note: string;
};

export type AgentCommandPlanDryRunSummary = {
	readonly mode: AgentCommandPlanMode;
	readonly wouldApply: boolean;
	readonly documentCommandCount: number;
	readonly sceneCommandCount: number;
	readonly motionCommandCount: number;
	readonly motionGrammarCommandCount: number;
	readonly validDocumentCommandCount: number;
	readonly validSceneCommandCount: number;
	readonly validMotionCommandCount: number;
	readonly validMotionGrammarCommandCount: number;
	readonly affected: readonly AgentIssueTarget[];
	readonly transactionPolicy: AgentCommandTransactionPolicy;
	readonly blockedReason?: string;
};

export type AgentAppliedCommandSummary = {
	readonly store: AgentCommandTransactionStore;
	readonly transactionId: string;
	readonly commandCount: number;
	readonly changed: boolean;
	readonly affected: readonly AgentIssueTarget[];
};

export type AgentCommandPlanResult = {
	readonly contractVersion: typeof AGENT_CONTRACT_VERSION;
	readonly mode: AgentCommandPlanMode;
	readonly planId: string;
	readonly intent: string;
	readonly approved: boolean;
	readonly ready: boolean;
	readonly applied: boolean;
	readonly changed: boolean;
	readonly affected: readonly AgentIssueTarget[];
	readonly summary: AgentIssueSummary;
	readonly issues: readonly AgentIssue[];
	readonly dryRunSummary: AgentCommandPlanDryRunSummary;
	readonly transactionPolicy: AgentCommandTransactionPolicy;
	readonly plan: AgentEditPlan;
	readonly appliedCommands: readonly AgentAppliedCommandSummary[];
	readonly blockedReason?: string;
	/**
	 * Node ids selected in the live editor when this review was produced, primary
	 * last. Lets an agent author against the user's current selection instead of
	 * requiring a human to read out internal node ids. Only the live bridge
	 * populates it (the editor knows the selection); headless reviews omit it.
	 */
	readonly selectedNodeIds?: readonly string[];
	/**
	 * The artboard selected as a canvas object (not a node), if any. Mutually
	 * exclusive with a non-empty `selectedNodeIds`. Only the live bridge
	 * populates it.
	 */
	readonly selectedArtboardId?: string | null;
	/**
	 * Camera-specific editor selection, if the user focused an authored scene
	 * camera rig, body/target handle, or motion/null controller instead of a
	 * vector node/artboard. Optional so older live clients can ignore it.
	 */
	readonly selectedSceneCamera?: SceneCameraAuthoringSelection | null;
	/**
	 * The document's focused artboard (`SceneDocument.currentArtboardId`,
	 * resolved through the same fallback `list_artboards` uses) when this review
	 * was produced. Distinct from `selectedArtboardId`: this is the document's
	 * persisted focus, not a canvas selection. Only the live bridge populates it.
	 */
	readonly currentArtboardId?: string;
	/**
	 * Current live editor playhead frame when the response was stamped. Optional
	 * because headless document reads and older bridge clients do not own UI
	 * transport state.
	 */
	readonly currentFrame?: number;
};

export type AgentObserveDocumentRequest = {
	readonly tool: "observe_document";
	readonly detail?: AgentObservationDetail;
	readonly limits?: AgentObservationLimits;
};

export type AgentObserveSelectionRequest = {
	readonly tool: "observe_selection";
	readonly detail?: AgentObservationDetail;
};

/** Hard cap on `observe_node`'s `nodeIds`: a full-fidelity per-node read is
 * heavier than the other list tools' summaries, so the tool bounds batch size
 * instead of paginating. */
export const MAX_OBSERVE_NODE_IDS = 20;

export type AgentObserveNodeRequest = {
	readonly tool: "observe_node";
	readonly nodeIds: readonly string[];
	/**
	 * When true, path/polygon/star/line/rect geometry includes full coordinates
	 * (vertices, tangents, points). Defaults to false: geometry reports kind and
	 * compact key params (bounds, anchor/vertex counts) only, since raw
	 * coordinate arrays are the heaviest possible field in this payload and most
	 * callers only need to know a node's shape category and size.
	 */
	readonly includeGeometry?: boolean;
};

/** One property's motion attachment for `observe_node`: how many keyframes it
 * has, and whether any motion-grammar binding also targets this node/property
 * pair (a binding targets a node, not a property, but its technique implies
 * which properties it drives — see `AgentNodeMotionSummary.grammarBindingIds`
 * for the node-level, not property-level, binding list). */
export type AgentNodeMotionPropertySummary = {
	readonly property: AnimatableProperty;
	readonly keyframeCount: number;
};

/** Exact typed keyframe address/value readback for one node motion track. */
export type AgentNodeMotionTrackReadback = {
	readonly id: string;
	readonly property: AnimatableProperty;
	readonly keyframes: readonly {
		readonly frame: number;
		readonly value: AnimatableValue;
	}[];
};

export type AgentNodeMotionSummary = {
	readonly properties: readonly AgentNodeMotionPropertySummary[];
	readonly tracks: readonly AgentNodeMotionTrackReadback[];
	readonly spatialPath?: {
		readonly trackId: string;
		readonly keyCount: number;
		readonly rovingKeyCount: number;
		readonly frames: readonly number[];
	};
	readonly morphTopology?: {
		readonly trackId: string;
		readonly keyCount: number;
		readonly compatible: boolean;
		readonly vertexCounts: readonly number[];
		readonly closedStates: readonly boolean[];
		readonly issueCodes: readonly string[];
	};
	readonly textAnimatorBindingIds: readonly string[];
	readonly grammarBindingIds: readonly string[];
};

/** Compact recipe identity — never the full nested `VisualRecipe` (11 sub-recipe
 * categories), which belongs in a dedicated look/recipe read tool if one is ever
 * needed; `observe_node` reports only enough to tell an agent a look is present
 * and roughly what kind, matching every other field's "summary, not dump" budget. */
export type AgentNodeRecipeSummary = {
	readonly present: boolean;
	readonly id?: string;
	readonly label?: string;
	readonly intent?: string;
	readonly recipeRef?: string;
};

/**
 * Component-role detail for one node's `AgentNodeRoleSummary.component`. A
 * source reports the symbol it defines and how many live instances exist
 * (blast-radius signal before editing it); an instance reports which symbol/
 * source it was cloned from, its tracked override count (whether it has
 * diverged and by how much — not the override payloads themselves; use
 * `scene/reset-component-override`'s `filter` or a future dedicated read for
 * the full list), and its baked motion timing offset in frames. Scalars only,
 * matching `AgentNodeRoleSummary`'s "which roles, not a full role dump"
 * contract — this is enough for an agent to decide whether to insert, edit the
 * source, apply/reset an override, detach, or re-stagger without a second
 * round trip for the common cases.
 */
export type AgentNodeComponentRole =
	| {
			readonly kind: "source";
			readonly symbolId: string;
			readonly instanceCount: number;
	  }
	| {
			readonly kind: "instance";
			readonly symbolId: string;
			readonly sourceNodeId: string;
			readonly overrideCount: number;
			readonly timingOffsetFrames: number;
	  };

/** Roles carried by `VectorNode` optional fields, reported by presence/kind only
 * (never the full nested contract) — an agent that needs the full component/
 * frame/blend contract can read it from `observe_document`'s scene export or a
 * dedicated tool; this is a map of "which roles does this node have" for
 * planning, not a full role dump. */
export type AgentNodeRoleSummary = {
	readonly component?: AgentNodeComponentRole;
	readonly frame?: { readonly clipsContent: boolean };
	readonly blend?: { readonly kind: "blend" | "blend-step" };
	readonly motionController?: { readonly kind: "motion-controller" };
	readonly motionParent?: { readonly parentNodeId: string };
	readonly transformConstraint?: {
		readonly id: string;
		readonly sourceNodeId: string;
		readonly channels: readonly TransformConstraintChannel[];
		readonly strength: number;
		readonly sourceSpace: TransformConstraintSpace;
		readonly destinationSpace: TransformConstraintSpace;
		readonly maintainOffset: boolean;
	};
	readonly propertyRelations?: readonly {
		readonly id: string;
		readonly sourceNodeId: string;
		readonly sourceProperty: RelationNumericProperty;
		readonly targetProperty: RelationNumericProperty;
		readonly scale: number;
		readonly offset: number;
	}[];
	readonly textFragmentGroup: boolean;
	readonly maskRelationCount: number;
};

export type AgentNodeGeometrySummary = {
	readonly kind: NodeGeometry["kind"];
	readonly bounds?: Bounds;
	/** Anchor/vertex count for path geometry: the main contour's vertex count,
	 * plus one entry per compound-path subpath (hole) vertex count. Omitted for
	 * non-path geometry. */
	readonly anchorCounts?: {
		readonly main: number;
		readonly subpaths: readonly number[];
	};
	/** Full text content and resolved style for text geometry — always included
	 * regardless of `includeGeometry`, since text content (unlike raw path
	 * coordinates) is exactly what most text-editing agent calls need to read
	 * before writing. */
	readonly text?: {
		readonly content: string;
		readonly style?: Partial<TextStyle>;
	};
	/** Present only when the request set `includeGeometry: true`. Carries the
	 * full geometry payload (vertices/points/tangents) for the kinds that have
	 * them; rect/ellipse/image only ever need `bounds`, already reported above. */
	readonly full?: NodeGeometry;
};

/**
 * One component prop's binding onto the observed node (id/name from the
 * document library, plus that specific binding's `kind`) — the smallest read
 * an agent needs to answer "which host-settable props already drive this
 * node?" before adding a new prop/binding or deciding whether an edit here
 * would fight an existing one. A node can appear for more than one prop, and
 * a prop can appear more than once for the same node (e.g. two `bindable`
 * bindings targeting different `propertyId`s on it) — this list is per
 * binding, not deduplicated per prop.
 */
export type AgentNodeComponentPropBindingSummary = {
	readonly propId: string;
	readonly propName: string;
	readonly bindingKind: ComponentPropBinding["kind"];
};

/**
 * One interaction whose `trigger.nodeId` targets the observed node (Interactive
 * Motion program, T3-S1) — the smallest read an agent needs to answer "which
 * interactions already fire from this node?" before adding a new trigger or
 * deciding whether an edit here would conflict with an existing one. Component-
 * level interactions (`trigger.nodeId` omitted) never appear here — they show
 * up only in `observe_document`'s `document.interactions`.
 */
export type AgentNodeInteractionSummary = {
	readonly interactionId: string;
	readonly triggerKind: InteractionTriggerKind;
};

export type AgentNodeObservation = {
	readonly nodeId: string;
	readonly name: string;
	readonly artboardId?: string;
	readonly transform: Transform;
	readonly style: NodeStyle;
	readonly geometry: AgentNodeGeometrySummary;
	readonly visible: boolean;
	readonly locked: boolean;
	readonly roles: AgentNodeRoleSummary;
	readonly recipe: AgentNodeRecipeSummary;
	readonly motion: AgentNodeMotionSummary;
	readonly bindablePropertyIds: readonly string[];
	readonly componentPropBindings: readonly AgentNodeComponentPropBindingSummary[];
	readonly interactions: readonly AgentNodeInteractionSummary[];
	readonly sourceOptics?: {
		readonly sourceRigIds: readonly string[];
		readonly responseBindings: readonly {
			readonly rigId: string;
			readonly bindingId: string;
			readonly sourceNodeId: string;
		}[];
	};
};

export type AgentObserveNodeResult = {
	readonly nodes: readonly AgentNodeObservation[];
};

export type AgentListLayersRequest = {
	readonly tool: "list_layers";
	readonly offset?: number;
	readonly limit?: number;
};

export type AgentListArtboardsRequest = {
	readonly tool: "list_artboards";
	readonly detail?: AgentObservationDetail;
};

export type AgentBindablePropertyCommandAvailability = {
	readonly supported: boolean;
	readonly tool: "apply_scene_commands" | "apply_motion_commands";
	readonly commandType:
		| "scene/set-bindable-property"
		| "scene/set-bindable-expression"
		| "scene/clear-bindable-expression"
		| "scene/set-bindable-effect-property"
		| "scene/set-bindable-effect-expression"
		| "scene/clear-bindable-effect-expression"
		| "motion/set-bindable-keyframe";
	readonly reason?: string;
};

export type AgentBindablePropertyNodeEligibility = {
	readonly nodeId: string;
	readonly eligible: boolean;
	readonly geometryKind?: NodeGeometry["kind"];
	readonly requiredMode?: "rect-per-corner";
	readonly reason?: string;
};

/**
 * Whether one bindable-property descriptor targets the scene camera named by
 * `cameraRigId` in a `list_bindable_properties` request. Unlike
 * {@link AgentBindablePropertyNodeEligibility}, eligibility here does not vary
 * per rig (any existing rig accepts every `scene-camera`-scoped channel), so
 * this is a uniform scope gate: `eligible` is true for every descriptor whose
 * `targetScopes` includes `"scene-camera"`, false (with `reason`) otherwise.
 */
export type AgentBindablePropertyCameraEligibility = {
	readonly cameraRigId: string;
	readonly eligible: boolean;
	readonly reason?: string;
};

/**
 * One scene-camera rig channel's live numeric value, attached to a
 * `scene-camera`-scoped {@link AgentBindablePropertySummary} row when
 * `list_bindable_properties` is scoped to an existing `cameraRigId`. Read
 * directly off the rig's `SceneCameraRigContract` (position/rotation/target/
 * projection fields); omitted (not zero-filled) when the underlying rig field
 * is itself unset, mirroring `observe_document`'s scene-camera summary's
 * omit-when-absent convention.
 */
export type AgentBindablePropertyCameraChannelValue = {
	readonly cameraRigId: string;
	readonly property: CameraRigAnimatableProperty;
	readonly value: number;
};

export type AgentBindablePropertySummary = {
	readonly id: string;
	readonly label: string;
	readonly source: BindablePropertySource;
	readonly targetScopes: readonly BindablePropertyTargetScope[];
	readonly eligibility: BindablePropertyEligibility;
	readonly control: BindablePropertyControl;
	readonly keyframeChannel?: BindableKeyframeChannel;
	readonly directManipulation?: readonly BindableDirectManipulation[];
	readonly support: BindablePropertySupportMatrix;
	readonly commands: {
		readonly sceneSetBindableProperty: AgentBindablePropertyCommandAvailability;
		readonly sceneSetBindableExpression: AgentBindablePropertyCommandAvailability;
		readonly sceneClearBindableExpression: AgentBindablePropertyCommandAvailability;
		readonly sceneSetBindableEffectProperty: AgentBindablePropertyCommandAvailability;
		readonly sceneSetBindableEffectExpression: AgentBindablePropertyCommandAvailability;
		readonly sceneClearBindableEffectExpression: AgentBindablePropertyCommandAvailability;
		readonly motionSetBindableKeyframe: AgentBindablePropertyCommandAvailability;
	};
	readonly nodeEligibility?: AgentBindablePropertyNodeEligibility;
	readonly cameraEligibility?: AgentBindablePropertyCameraEligibility;
	readonly cameraChannelValue?: AgentBindablePropertyCameraChannelValue;
};

export type AgentBindablePropertyList = {
	readonly filters: {
		readonly targetScope: BindablePropertyTargetScope | undefined;
		readonly sourceKind: BindablePropertySource["kind"] | undefined;
		readonly nodeId: string | undefined;
		readonly cameraRigId: string | undefined;
		readonly sceneWritableOnly: boolean;
		readonly keyframableOnly: boolean;
		readonly includeIneligible: boolean;
	};
	readonly total: number;
	readonly properties: readonly AgentBindablePropertySummary[];
};

export type AgentAppearanceEffectsList = {
	readonly filters: {
		readonly nodeId: string | undefined;
	};
	readonly total: number;
	readonly effects: readonly ObjectAppearanceEffect[];
};

export type AgentMotionGrammarTechniqueSummary = {
	readonly id: MotionGrammarTechniqueId;
	readonly label: string;
	readonly family: MotionGrammarTechniqueFamily;
	readonly status: MotionGrammarImplementationStatus;
	readonly implemented: boolean;
	readonly authorable: boolean;
	readonly minTargets: number;
	readonly usesSeed: boolean;
	readonly params: readonly MotionGrammarParamSpec[];
	/** Direct semantic map contract required when this versioned technique names roles. */
	readonly roleMapContract?: {
		readonly direction: "nodeId-to-role";
		readonly roles: readonly {
			readonly roleId: string;
			readonly label: string;
			readonly acceptedValues: readonly string[];
		}[];
		readonly assignments: readonly {
			readonly targetCount: number;
			readonly roleIds: readonly string[];
		}[];
		readonly overflowRoleId?: string;
		readonly maximumTargetCount?: number;
	};
	readonly commands: {
		readonly applyTechnique: {
			readonly supported: boolean;
			readonly tool: "apply_motion_grammar_commands";
			readonly commandType: "motion-grammar/apply-technique";
			readonly reason?: string;
		};
		readonly applyAfterimageSelectedSources?: {
			readonly supported: boolean;
			readonly tool: "apply_motion_grammar_commands";
			readonly commandType: "motion-grammar/apply-afterimage-selected-sources";
			readonly reason?: string;
		};
	};
};

export type AgentMotionGrammarBindingTargetSummary = {
	readonly nodeId: string;
	readonly exists: boolean;
	readonly name?: string;
	readonly kind?: NodeGeometry["kind"];
	readonly visible?: boolean;
	readonly locked?: boolean;
};

/**
 * Agent-facing timing-template descriptor for motion-grammar bindings. This is a
 * read boundary copy of the authoring profile metadata, so agent clients do not
 * depend on the Inspector/profile implementation type.
 */
export type AgentMotionGrammarTimingTemplateDescriptor = {
	readonly templateId: MotionTimingTemplateId;
	readonly role: string;
	readonly note: string;
	readonly parameterKeys?: readonly string[];
};

export type AgentMotionGrammarBindingSummary = {
	readonly id: string;
	readonly techniqueId: MotionGrammarTechniqueId;
	readonly techniqueLabel: string;
	readonly targetIds: readonly string[];
	readonly targets: readonly AgentMotionGrammarBindingTargetSummary[];
	readonly parameters: Readonly<Record<string, number>>;
	/** Durable nodeId-to-semantic-role assignments, when the law has named roles. */
	readonly roleMap?: Readonly<Record<string, string>>;
	/** Versioned expression identity; omitted for a legacy binding of the same id. */
	readonly expressionVersion?: number;
	readonly randomPulseProfile?: MotionGrammarRandomPulseProfile;
	readonly arrangementMapping?: MotionGrammarArrangementMapping;
	readonly params: readonly MotionGrammarParamSpec[];
	readonly authoringProfile?: {
		readonly kind:
			| "master-instances"
			| "source-followers"
			| "presentation-duplicates"
			| "baked-tracks";
		readonly summary: string;
		readonly timeline: {
			readonly mode:
				| "trackless-expression"
				| "scalar-tracks"
				| "presentation-only";
			readonly bakePolicy: "explicit-command" | "not-supported";
		};
		readonly expansion: {
			readonly mode:
				| "live-only"
				| "editable-motion"
				| "editable-nodes"
				| "specialized-artifacts";
			readonly label: string;
			readonly description: string;
			readonly outputSummary: string;
		};
	};
	readonly timingTemplates?: readonly AgentMotionGrammarTimingTemplateDescriptor[];
	readonly seedControl?: MotionGrammarParamSpec;
	readonly seed?: number;
	readonly effectBindingKind?: string;
	readonly effectBinding?: MotionGrammarEffectBinding;
	readonly commands: {
		readonly updateParameters: {
			readonly supported: boolean;
			readonly tool: "apply_motion_grammar_commands";
			readonly commandType: "motion-grammar/update-parameters";
		};
		readonly updateBinding: {
			readonly supported: boolean;
			readonly tool: "apply_motion_grammar_commands";
			readonly commandType: "motion-grammar/update-binding";
		};
		readonly reorderBinding: {
			readonly supported: boolean;
			readonly tool: "apply_motion_grammar_commands";
			readonly commandType: "motion-grammar/reorder-binding";
		};
		readonly bakeBinding: {
			readonly supported: boolean;
			readonly tool: "apply_document_commands";
			readonly commandType: "document/bake-motion-grammar-binding";
			readonly reason?: string;
		};
		readonly expandBinding: {
			readonly supported: boolean;
			readonly tool: "apply_document_commands";
			readonly commandType: "document/expand-motion-grammar-binding";
			readonly reason?: string;
		};
		readonly replaceRole: {
			readonly supported: boolean;
			readonly tool: "apply_document_commands";
			readonly commandType: "document/replace-motion-grammar-role";
			readonly reason?: string;
		};
		readonly removeBinding: {
			readonly supported: boolean;
			readonly tool: "apply_motion_grammar_commands";
			readonly commandType: "motion-grammar/remove-binding";
		};
	};
};

/**
 * A source-free view of a serialized binding that Vecmo deliberately preserves
 * but cannot run. It is remove-only: editing it could destroy an unknown future
 * contract, so an Agent must wait for a compatible Vecmo version or remove it.
 */
export type AgentMotionGrammarUnsupportedBindingSummary = {
	readonly id: string;
	readonly techniqueId: string;
	readonly expressionVersion?: number;
	readonly reason: string;
	readonly commands: {
		readonly updateParameters: {
			readonly supported: false;
			readonly tool: "apply_motion_grammar_commands";
			readonly commandType: "motion-grammar/update-parameters";
			readonly reason: string;
		};
		readonly removeBinding: {
			readonly supported: true;
			readonly tool: "apply_motion_grammar_commands";
			readonly commandType: "motion-grammar/remove-binding";
		};
	};
};

export type AgentMotionGrammarList = {
	readonly filters: {
		readonly techniqueId: MotionGrammarTechniqueId | undefined;
		readonly nodeId: string | undefined;
		readonly authorableOnly: boolean;
		readonly implementedOnly: boolean;
		readonly includeBindings: boolean;
		readonly includeIneligibleTargets: boolean;
	};
	readonly techniqueCount: number;
	readonly bindingCount: number;
	readonly passthroughBindingCount: number;
	readonly techniques: readonly AgentMotionGrammarTechniqueSummary[];
	readonly bindings: readonly AgentMotionGrammarBindingSummary[];
	readonly unsupportedBindings: readonly AgentMotionGrammarUnsupportedBindingSummary[];
};

export type AgentListBindablePropertiesRequest = {
	readonly tool: "list_bindable_properties";
	readonly targetScope?: BindablePropertyTargetScope;
	readonly sourceKind?: BindablePropertySource["kind"];
	readonly nodeId?: string;
	/**
	 * Existing scene-camera rig id. When present, `scene-camera`-scoped
	 * descriptors additionally carry `cameraEligibility`/`cameraChannelValue`
	 * for this rig, and (unless `includeIneligible`) non-camera descriptors are
	 * filtered out the same way a `nodeId` filters out node-ineligible ones. A
	 * `cameraRigId` that does not resolve on the document is a typed
	 * `agent.bindable-property-camera-missing` error, mirroring the existing
	 * `nodeId`-missing behavior.
	 */
	readonly cameraRigId?: string;
	readonly sceneWritableOnly?: boolean;
	readonly keyframableOnly?: boolean;
	readonly includeIneligible?: boolean;
};

export type AgentListAppearanceEffectsRequest = {
	readonly tool: "list_appearance_effects";
	readonly nodeId?: string;
};

export type AgentListMotionGrammarRequest = {
	readonly tool: "list_motion_grammar";
	readonly techniqueId?: MotionGrammarTechniqueId;
	readonly nodeId?: string;
	readonly authorableOnly?: boolean;
	readonly implementedOnly?: boolean;
	readonly includeBindings?: boolean;
	readonly includeIneligibleTargets?: boolean;
};

export type AgentListLookGraphRequest = {
	readonly tool: "list_look_graph";
	readonly target?: AgentLookGraphTarget;
};

export type AgentListLookNodeCapabilitiesRequest = {
	readonly tool: "list_look_node_capabilities";
};

/**
 * Read view of the graph-first Look resolved for one scene/artboard target. The
 * `graph` manifest (reused from the export adapter) carries node ids/kinds/labels,
 * edges, per-node canonical payloads, and honest per-node fidelity; `issues`
 * reports current topology health (e.g. missing output node, residual cycle).
 */
export type AgentLookGraphView = {
	readonly target: AgentLookGraphTarget;
	readonly present: boolean;
	readonly derivedFrom:
		| "explicit-graph"
		| "effect-layer-stack"
		| "visual-recipe"
		| null;
	/** Included only when the requested target is a persisted scoped overlay. */
	readonly scopedOverlay?: {
		readonly source:
			| "object-noise-gradient"
			| "object-path-blur"
			| "selection-look-graph";
		readonly targetNodeIds: readonly string[];
	};
	readonly graph?: LookGraphExportManifest;
	readonly issues: readonly LookGraphIssue[];
};

export type AgentLookNodeParamCapability = LookGraphNodeParamSpec & {
	readonly keyframable: boolean;
};

/** One graph-first Look node kind the agent can author, with typed ports/params. */
export type AgentLookNodeCapability = {
	readonly kind: LookGraphNodeKind;
	readonly label: string;
	readonly inputs: readonly LookGraphPortSpec[];
	readonly outputs: readonly LookGraphPortSpec[];
	readonly params: readonly AgentLookNodeParamCapability[];
};

export type AgentLookNodeCapabilityList = {
	/** Deterministic port id format so agents can address ports they will create. */
	readonly portIdScheme: string;
	readonly nodeKinds: readonly AgentLookNodeCapability[];
};

export type AgentProposeEditPlanRequest = {
	readonly tool: "propose_edit_plan";
	readonly intent: string;
	readonly target?: AgentIssueTarget;
	readonly documentCommands?: readonly AgentDocumentCommand[];
	readonly sceneCommands?: readonly AgentSceneCommand[];
	readonly motionCommands?: readonly AgentMotionCommand[];
	readonly motionGrammarCommands?: readonly AgentMotionGrammarCommand[];
	readonly includeValidation?: boolean;
};

export type AgentApplySceneCommandsRequest = {
	readonly tool: "apply_scene_commands";
	readonly transactionId?: string;
	readonly dryRun?: boolean;
	readonly commands: readonly AgentSceneCommand[];
};

export type AgentApplyMotionCommandsRequest = {
	readonly tool: "apply_motion_commands";
	readonly transactionId?: string;
	readonly dryRun?: boolean;
	readonly commands: readonly AgentMotionCommand[];
};

export type AgentApplyMotionGrammarCommandsRequest = {
	readonly tool: "apply_motion_grammar_commands";
	readonly transactionId?: string;
	readonly dryRun?: boolean;
	readonly commands: readonly AgentMotionGrammarCommand[];
};

/** Atomic headless adapter for typed commands spanning durable document owners. */
export type AgentApplyDocumentCommandsRequest = {
	readonly tool: "apply_document_commands";
	readonly transactionId?: string;
	readonly dryRun?: boolean;
	readonly commands: readonly AgentDocumentCommand[];
};

/**
 * Headless request for the `camera/*` verb family (P3.3). Mirrors
 * `AgentApplySceneCommandsRequest` exactly: `apply_camera_commands` is stateless
 * (loads a scene/motion snapshot, compiles+applies, returns both updated
 * documents) — it does not touch the live editor's stores.
 */
export type AgentApplyCameraCommandsRequest = {
	readonly tool: "apply_camera_commands";
	readonly transactionId?: string;
	readonly dryRun?: boolean;
	readonly commands: readonly AgentCameraVerbCommand[];
};

export type AgentSaveProjectLiveRequest = {
	readonly tool: "save_project_live";
	readonly intent?: string;
	readonly mode?: "save" | "save-as-new" | "save-as-copy";
	readonly name?: string;
};

export type AgentExportArtboardRequest = {
	readonly tool: "export_artboard";
	readonly scope: "current" | "selected" | "all";
	readonly artboardIds?: readonly string[];
	readonly formats?: readonly ("svg" | "pdf" | "json" | "manifest")[];
};

export type AgentLoadReproductionDescriptorRequest = {
	readonly tool: "load_reproduction_descriptor";
	readonly descriptor?: unknown;
	readonly descriptorPath?: string;
	readonly options?: {
		readonly sceneId?: string;
		readonly sceneName?: string;
		readonly artboardId?: string;
		readonly artboardSize?: {
			readonly width: number;
			readonly height: number;
		};
		readonly fps?: number;
	};
};

export const AGENT_VALIDATION_SCOPES = [
	"document",
	"selection",
	"export",
] as const;

export type AgentValidationScope = (typeof AGENT_VALIDATION_SCOPES)[number];

export type AgentRunValidationRequest = {
	readonly tool: "run_validation";
	readonly scope?: AgentValidationScope;
};

export type AgentToolRequest =
	| AgentObserveDocumentRequest
	| AgentObserveSelectionRequest
	| AgentObserveNodeRequest
	| AgentListLayersRequest
	| AgentListArtboardsRequest
	| AgentListBindablePropertiesRequest
	| AgentListAppearanceEffectsRequest
	| AgentListMotionGrammarRequest
	| AgentListLookGraphRequest
	| AgentListLookNodeCapabilitiesRequest
	| AgentProposeEditPlanRequest
	| AgentApplySceneCommandsRequest
	| AgentApplyMotionCommandsRequest
	| AgentApplyMotionGrammarCommandsRequest
	| AgentApplyDocumentCommandsRequest
	| AgentApplyCameraCommandsRequest
	| AgentSaveProjectLiveRequest
	| AgentExportArtboardRequest
	| AgentLoadReproductionDescriptorRequest
	| AgentRunValidationRequest;

export type AgentMutationSummary = {
	readonly transactionId: string;
	readonly dryRun: boolean;
	readonly affected: readonly AgentIssueTarget[];
	readonly undoLabel?: string;
};

export type AgentMotionGrammarCommandApplyData = {
	readonly transactionId: string;
	readonly dryRun: boolean;
	readonly changed: boolean;
	readonly appliedCommandCount: number;
	readonly report: AgentCommandReviewReport;
	readonly grammar: MotionGrammarStoreDocument;
};

export type AgentToolResult<TData = unknown> = {
	readonly contractVersion: typeof AGENT_CONTRACT_VERSION;
	readonly ok: boolean;
	readonly tool: AgentToolName;
	readonly data?: TData;
	readonly mutation?: AgentMutationSummary;
	readonly issues: readonly AgentIssue[];
};
