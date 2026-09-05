import type {
	MotionDocument,
	ScalarAnimatableProperty,
	SnapshotAnimatableProperty,
} from "@/entities/motion/model/types";
import type { SceneDocument, VectorNode } from "@/entities/scene/model/types";
import {
	CYCLIC_PATH_ORIENT_TO_TANGENT_DEFAULT,
	findCatalogEntry,
	MOTION_GRAMMAR_CATALOG,
} from "./catalog";
import { planPeriodicAfterimageEchoes } from "./evaluator";
import {
	findMotionExpressionDefinition,
	isMotionExpressionBindingActive,
	motionExpressionBindingState,
} from "./expression-registry";
import { isFollowThroughLeadAdapterParameters } from "./follow-through-lead-binding";
import type { MotionGrammarBinding, MotionGrammarTechniqueId } from "./types";

const FIRST_FRAME = 0;
const DEFAULT_SAMPLE_STEP_FRAMES = 1;
const LARGE_TRACK_ESTIMATE_THRESHOLD = 240;
const LARGE_KEYFRAME_ESTIMATE_THRESHOLD = 2_500;
const CYCLIC_PATH_NON_PRIMARY_ROLE_ALIASES = [
	"path",
	"cyclic-path-travel:path",
] as const;
const DRIVER_ROLE_ALIASES = ["driver", "lead", "leader", "source"] as const;
const FOLLOWER_ROLE_ALIASES = [
	"follower",
	"follow",
	"paired",
	"pair",
	"mirror",
	"target",
] as const;

/** Scalar properties the current decomposition contract can express as ordinary `MotionDocument` tracks. */
export const MOTION_GRAMMAR_DECOMPOSABLE_SCALAR_PROPERTIES = [
	"x",
	"y",
	"rotation",
	"scaleX",
	"scaleY",
	"opacity",
] as const satisfies readonly ScalarAnimatableProperty[];

/** Scalar `MotionDocument` property supported by the first decomposition emitters. */
export type MotionGrammarDecomposableScalarProperty =
	(typeof MOTION_GRAMMAR_DECOMPOSABLE_SCALAR_PROPERTIES)[number];

/** Inclusive frame range used by grammar decomposition plans; units are document frames. */
export type MotionGrammarDecompositionFrameRange = {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly durationFrames: number;
};

/**
 * Authored frame range request before normalization. `durationFrames` is a frame
 * count; `startFrame`/`endFrame` are concrete inclusive frame indices.
 */
export type MotionGrammarDecompositionFrameRangeInput = {
	readonly startFrame?: number;
	readonly endFrame?: number;
	readonly durationFrames?: number;
};

/** Value source that a downstream scalar emitter samples from the grammar evaluator. */
export type MotionGrammarScalarSampleChannel =
	| "source-frame"
	| "translate-x"
	| "translate-y"
	| "rotate"
	| "rotation-override"
	| "scale-factor-x"
	| "scale-factor-y"
	| "opacity-factor"
	| "duplicate-source-frame"
	| "duplicate-opacity";

/** How a sampled grammar channel should be composed into an ordinary scalar track. */
export type MotionGrammarScalarComposition =
	| "replace"
	| "add"
	| "multiply"
	| "retime-source";

/** Units downstream emitters must preserve when writing keyframes. */
export type MotionGrammarScalarUnit =
	| "scene-px"
	| "degrees"
	| "scale"
	| "opacity"
	| "frame";

/**
 * Low-level scalar-channel contract for one technique. It maps evaluator output
 * channels onto editable `MotionDocument` properties without emitting values.
 */
export type MotionGrammarScalarTrackCoverage = {
	readonly property: MotionGrammarDecomposableScalarProperty;
	readonly sourceChannel: MotionGrammarScalarSampleChannel;
	readonly composition: MotionGrammarScalarComposition;
	readonly unit: MotionGrammarScalarUnit;
};

/** Node set a coverage entry should expand into scalar outputs. */
export type MotionGrammarDecompositionTargetScope =
	| "none"
	| "all-targets"
	| "primary-role-targets"
	| "ordered-followers"
	| "relational-followers";

/** Generated scene-node strategy required by a technique, if any. */
export type MotionGrammarGeneratedNodeStrategy =
	| "none"
	| "temporal-echo-clones";

/** Clip grouping strategy exposed to downstream timeline writers. */
export type MotionGrammarClipStrategy = "none" | "single-binding-range";

/** Output classes represented in the decomposition IR. */
export type MotionGrammarDecompositionOutputKind =
	| "motion-track"
	| "scene-node"
	| "clip"
	| "editable-artifact";

/** Editable artifact families used when scalar tracks alone cannot carry a technique's semantics. */
export type MotionGrammarEditableArtifactKind =
	| "source-frame-snapshot"
	| "boolean-geometry-state"
	| "projection-pose-state"
	| "shear-state"
	| "effect-automation";

/** Non-scalar channels represented by editable artifact outputs. */
export type MotionGrammarDecompositionChannel =
	| MotionGrammarScalarSampleChannel
	| MotionGrammarDecomposableScalarProperty
	| "pathShape"
	| "meshPaint"
	| "fillGradient"
	| "effect-automation"
	| "active-target-influence"
	| "temporal-echo"
	| "boolean-geometry"
	| "true-3d-depth"
	| "shear-matrix"
	| "generated-scene-node"
	| "clip";

/** Severity for decomposition issues; `error` blocks a trustworthy bake. */
export type MotionGrammarDecompositionIssueSeverity =
	| "info"
	| "warning"
	| "error";

/** Stable issue codes consumed by future Inspector and emitter streams. */
export type MotionGrammarDecompositionIssueCode =
	| "missing-target"
	| "insufficient-targets"
	| "pending-emitter"
	| "large-output-estimate"
	| "empty-output"
	| "expression-bake-unsupported"
	| "expression-version-unsupported";

/** Editable artifact declared by the 18-technique coverage matrix. */
export type MotionGrammarEditableArtifactCoverage = {
	readonly artifactKind: MotionGrammarEditableArtifactKind;
	readonly targetScope: MotionGrammarDecompositionTargetScope;
	readonly channels: readonly MotionGrammarDecompositionChannel[];
	readonly description: string;
};

/**
 * One row of the motion-grammar decomposition coverage matrix. Each implemented
 * technique must have exactly one row so emitters can share the same IR contract.
 */
export type MotionGrammarTechniqueDecompositionCoverage = {
	readonly techniqueId: MotionGrammarTechniqueId;
	readonly outputKinds: readonly MotionGrammarDecompositionOutputKind[];
	readonly targetScope: MotionGrammarDecompositionTargetScope;
	readonly scalarTracks: readonly MotionGrammarScalarTrackCoverage[];
	readonly generatedNodeStrategy: MotionGrammarGeneratedNodeStrategy;
	readonly generatedScalarTracks?: readonly MotionGrammarScalarTrackCoverage[];
	readonly editableArtifacts?: readonly MotionGrammarEditableArtifactCoverage[];
	readonly clipStrategy: MotionGrammarClipStrategy;
};

/** Existing or generated node target used by planned scalar-track outputs. */
export type MotionGrammarDecompositionNodeTarget =
	| {
			readonly kind: "existing-scene-node";
			readonly nodeId: string;
	  }
	| {
			readonly kind: "generated-scene-node";
			readonly nodeIdSeed: string;
			readonly sourceNodeId: string;
	  };

/**
 * Provenance carried by every planned output. It is metadata only: after bake,
 * scene and motion documents remain the source of truth.
 */
export type MotionGrammarDecompositionProvenance = {
	readonly source: "motion-grammar";
	readonly bindingId: string;
	readonly techniqueId: MotionGrammarTechniqueId;
	readonly techniqueLabel: string;
	readonly targetIds: readonly string[];
	readonly parameters: Readonly<Record<string, number>>;
	readonly seed?: number;
	readonly roleMap?: Readonly<Record<string, string>>;
};

/**
 * Planned scalar track. It describes target/property/channel/provenance and a
 * normalized sampling range, but intentionally carries no keyframe values.
 */
export type MotionGrammarScalarTrackPlan = {
	readonly kind: "motion-track";
	readonly idSeed: string;
	readonly target: MotionGrammarDecompositionNodeTarget;
	readonly property: MotionGrammarDecomposableScalarProperty;
	readonly sourceChannel: MotionGrammarScalarSampleChannel;
	readonly composition: MotionGrammarScalarComposition;
	readonly unit: MotionGrammarScalarUnit;
	readonly frameRange: MotionGrammarDecompositionFrameRange;
	readonly sampleStepFrames: number;
	readonly sampleFrames: readonly number[];
	readonly emitter: "scalar-track";
	readonly status: "pending-emitter";
	readonly provenance: MotionGrammarDecompositionProvenance;
};

/**
 * Planned generated scene node. Materializers must clone the source node into an
 * editable scene node, then attach the referenced scalar tracks to the new id.
 */
export type MotionGrammarSceneNodePlan = {
	readonly kind: "scene-node";
	readonly idSeed: string;
	readonly sourceNodeId: string;
	readonly strategy: "clone-source-node";
	readonly role: "temporal-echo";
	readonly copyIndex: number;
	readonly previewSourceFrameAtRangeStart: number;
	readonly opacityMultiplier: number;
	readonly placement: {
		readonly kind: "after-source-node";
		readonly sourceNodeId: string;
	};
	readonly scalarTrackIdSeeds: readonly string[];
	readonly emitter: "scene-node-materializer";
	readonly status: "pending-emitter";
	readonly provenance: MotionGrammarDecompositionProvenance;
};

/** Compact artifact reference embedded in generated clip provenance. */
export type MotionGrammarClipEditableArtifactRef = {
	readonly idSeed: string;
	readonly artifactKind: MotionGrammarEditableArtifactKind;
	readonly targetIds: readonly string[];
	readonly channels: readonly MotionGrammarDecompositionChannel[];
	readonly description: string;
};

/** Ordinary snapshot track emitted from an editable artifact plan. */
export type MotionGrammarEditableArtifactTrackPlan = {
	readonly idSeed: string;
	readonly target: MotionGrammarDecompositionNodeTarget;
	readonly property: SnapshotAnimatableProperty;
};

/**
 * Planned timeline clip grouping. Track ids are deterministic seeds until a
 * downstream writer turns the plan into concrete `AnimationClip` ids.
 */
export type MotionGrammarClipPlan = {
	readonly kind: "clip";
	readonly idSeed: string;
	readonly name: string;
	readonly frameRange: MotionGrammarDecompositionFrameRange;
	readonly trackIdSeeds: readonly string[];
	readonly generatedNodeIdSeeds: readonly string[];
	readonly editableArtifacts: readonly MotionGrammarClipEditableArtifactRef[];
	readonly emitter: "clip-provenance-writer";
	readonly status: "pending-emitter";
	readonly provenance: MotionGrammarDecompositionProvenance;
};

/**
 * Planned editable artifact for non-scalar grammar semantics. Downstream streams
 * materialize these into concrete Vecmo data rather than treating the technique
 * as unsupported or lossy.
 */
export type MotionGrammarEditableArtifactPlan = {
	readonly kind: "editable-artifact";
	readonly idSeed: string;
	readonly artifactKind: MotionGrammarEditableArtifactKind;
	readonly targets: readonly MotionGrammarDecompositionNodeTarget[];
	readonly channels: readonly MotionGrammarDecompositionChannel[];
	readonly trackPlans: readonly MotionGrammarEditableArtifactTrackPlan[];
	readonly description: string;
	readonly frameRange: MotionGrammarDecompositionFrameRange;
	readonly sampleStepFrames: number;
	readonly sampleFrames: readonly number[];
	readonly emitter: "editable-artifact-materializer";
	readonly status: "pending-emitter";
	readonly provenance: MotionGrammarDecompositionProvenance;
};

/** Union of every output class in a decomposition plan. */
export type MotionGrammarDecompositionOutput =
	| MotionGrammarScalarTrackPlan
	| MotionGrammarSceneNodePlan
	| MotionGrammarClipPlan
	| MotionGrammarEditableArtifactPlan;

/** Concrete issue emitted while building a plan for a binding. */
export type MotionGrammarDecompositionIssue = {
	readonly code: MotionGrammarDecompositionIssueCode;
	readonly severity: MotionGrammarDecompositionIssueSeverity;
	readonly bindingId: string;
	readonly techniqueId: MotionGrammarTechniqueId;
	readonly message: string;
	readonly nodeId?: string;
	readonly property?: MotionGrammarDecomposableScalarProperty;
	readonly channel?: MotionGrammarDecompositionChannel;
	readonly outputKind?: MotionGrammarDecompositionOutputKind;
};

/** Output-size estimate used by Inspector previews and safety caps. */
export type MotionGrammarDecompositionEstimate = {
	readonly generatedNodeCount: number;
	readonly scalarTrackCount: number;
	readonly editableArtifactTrackCount: number;
	readonly clipCount: number;
	readonly editableArtifactCount: number;
	readonly sampleFrameCount: number;
	readonly scalarKeyframeCount: number;
	readonly editableArtifactKeyframeCount: number;
	readonly keyframeCount: number;
	readonly issueCount: number;
	readonly warningCount: number;
	readonly errorCount: number;
};

/** Result of validating a binding's target ids against a scene document. */
export type MotionGrammarDecompositionTargetValidation = {
	readonly targetIds: readonly string[];
	readonly existingTargetIds: readonly string[];
	readonly missingTargetIds: readonly string[];
	readonly minTargets: number;
	readonly hasEnoughTargets: boolean;
};

/**
 * Pure decomposition plan for one grammar binding. The plan is serializable and
 * side-effect-free; emitters must write scene/motion documents through their own
 * command surfaces.
 */
export type MotionGrammarDecompositionPlan = {
	readonly schemaVersion: 1;
	readonly bindingId: string;
	readonly techniqueId: MotionGrammarTechniqueId;
	readonly frameRange: MotionGrammarDecompositionFrameRange;
	readonly sampleStepFrames: number;
	readonly sampleFrames: readonly number[];
	readonly targetValidation: MotionGrammarDecompositionTargetValidation;
	readonly coverage: MotionGrammarTechniqueDecompositionCoverage;
	readonly outputs: readonly MotionGrammarDecompositionOutput[];
	readonly issues: readonly MotionGrammarDecompositionIssue[];
	readonly estimates: MotionGrammarDecompositionEstimate;
	readonly provenance: MotionGrammarDecompositionProvenance;
};

/** Input for the pure decomposition plan builder. */
export type CreateMotionGrammarDecompositionPlanInput = {
	readonly binding: MotionGrammarBinding;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly frameRange?: MotionGrammarDecompositionFrameRangeInput;
	readonly sampleStepFrames?: number;
	readonly includeClip?: boolean;
};

function unitForProperty(
	property: MotionGrammarDecomposableScalarProperty,
): MotionGrammarScalarUnit {
	switch (property) {
		case "x":
		case "y":
			return "scene-px";
		case "rotation":
			return "degrees";
		case "scaleX":
		case "scaleY":
			return "scale";
		case "opacity":
			return "opacity";
	}
}

const scalarTrack = (
	property: MotionGrammarDecomposableScalarProperty,
	sourceChannel: MotionGrammarScalarSampleChannel,
	composition: MotionGrammarScalarComposition,
	unit: MotionGrammarScalarUnit = unitForProperty(property),
): MotionGrammarScalarTrackCoverage => ({
	property,
	sourceChannel,
	composition,
	unit,
});

const RETIMED_SCALAR_TRACKS: readonly MotionGrammarScalarTrackCoverage[] =
	MOTION_GRAMMAR_DECOMPOSABLE_SCALAR_PROPERTIES.map((property) =>
		scalarTrack(property, "source-frame", "retime-source"),
	);

const DUPLICATE_SCALAR_TRACKS: readonly MotionGrammarScalarTrackCoverage[] = [
	scalarTrack("x", "duplicate-source-frame", "replace"),
	scalarTrack("y", "duplicate-source-frame", "replace"),
	scalarTrack("rotation", "duplicate-source-frame", "replace"),
	scalarTrack("scaleX", "duplicate-source-frame", "replace"),
	scalarTrack("scaleY", "duplicate-source-frame", "replace"),
	scalarTrack("opacity", "duplicate-opacity", "replace"),
] as const;

const TRANSLATE_TRACKS = [
	scalarTrack("x", "translate-x", "add"),
	scalarTrack("y", "translate-y", "add"),
] as const;

const SCALE_FACTOR_TRACKS = [
	scalarTrack("scaleX", "scale-factor-x", "multiply"),
	scalarTrack("scaleY", "scale-factor-y", "multiply"),
] as const;

const ROTATE_TRACK = [scalarTrack("rotation", "rotate", "add")] as const;

const ROTATION_OVERRIDE_TRACK = [
	scalarTrack("rotation", "rotation-override", "replace"),
] as const;

const OPACITY_FACTOR_TRACK = [
	scalarTrack("opacity", "opacity-factor", "multiply"),
] as const;

const TRANSFORM_FACTOR_TRACKS = [
	...TRANSLATE_TRACKS,
	...ROTATE_TRACK,
	...SCALE_FACTOR_TRACKS,
] as const;

const SOURCE_FRAME_SNAPSHOT_ARTIFACT = {
	artifactKind: "source-frame-snapshot",
	targetScope: "all-targets",
	channels: ["pathShape", "meshPaint"],
	description:
		"Editable source-frame geometry/style snapshots for retimed source sampling.",
} as const satisfies MotionGrammarEditableArtifactCoverage;

const SOURCE_FRAME_SNAPSHOT_ARTIFACTS = [
	SOURCE_FRAME_SNAPSHOT_ARTIFACT,
] as const satisfies readonly MotionGrammarEditableArtifactCoverage[];

const BOOLEAN_GEOMETRY_ARTIFACTS = [
	{
		artifactKind: "boolean-geometry-state",
		targetScope: "relational-followers",
		channels: ["boolean-geometry"],
		description:
			"Editable relation-driven boolean geometry state for difference motion.",
	},
] as const satisfies readonly MotionGrammarEditableArtifactCoverage[];

const PROJECTION_POSE_ARTIFACTS = [
	{
		artifactKind: "projection-pose-state",
		targetScope: "all-targets",
		channels: ["true-3d-depth"],
		description:
			"Editable projected pose/depth state for planar tumble motion.",
	},
] as const satisfies readonly MotionGrammarEditableArtifactCoverage[];

const SHEAR_STATE_ARTIFACTS = [
	{
		artifactKind: "shear-state",
		targetScope: "all-targets",
		channels: ["shear-matrix"],
		description: "Editable shear/split deformation state for split motion.",
	},
] as const satisfies readonly MotionGrammarEditableArtifactCoverage[];

/** Exhaustive coverage matrix for every implemented motion-grammar technique. */
export const MOTION_GRAMMAR_DECOMPOSITION_COVERAGE = [
	{
		techniqueId: "time-delay",
		outputKinds: ["motion-track", "clip", "editable-artifact"],
		targetScope: "all-targets",
		scalarTracks: RETIMED_SCALAR_TRACKS,
		generatedNodeStrategy: "none",
		editableArtifacts: SOURCE_FRAME_SNAPSHOT_ARTIFACTS,
		clipStrategy: "single-binding-range",
	},
	{
		techniqueId: "time-offset-propagation",
		outputKinds: ["motion-track", "clip"],
		targetScope: "ordered-followers",
		scalarTracks: TRANSFORM_FACTOR_TRACKS,
		generatedNodeStrategy: "none",
		clipStrategy: "single-binding-range",
	},
	{
		techniqueId: "periodic-afterimage",
		outputKinds: ["scene-node", "motion-track", "clip", "editable-artifact"],
		targetScope: "none",
		scalarTracks: [],
		generatedNodeStrategy: "temporal-echo-clones",
		generatedScalarTracks: DUPLICATE_SCALAR_TRACKS,
		clipStrategy: "single-binding-range",
	},
	{
		techniqueId: "cyclic-path-travel",
		outputKinds: ["motion-track", "clip"],
		targetScope: "primary-role-targets",
		scalarTracks: [...TRANSLATE_TRACKS, ...ROTATION_OVERRIDE_TRACK],
		generatedNodeStrategy: "none",
		clipStrategy: "single-binding-range",
	},
	{
		techniqueId: "random-phase-pulse",
		outputKinds: ["motion-track", "clip"],
		targetScope: "all-targets",
		scalarTracks: [...SCALE_FACTOR_TRACKS, ...OPACITY_FACTOR_TRACK],
		generatedNodeStrategy: "none",
		clipStrategy: "single-binding-range",
	},
	{
		techniqueId: "ring-wave-interference",
		outputKinds: ["motion-track", "clip"],
		targetScope: "all-targets",
		scalarTracks: [...SCALE_FACTOR_TRACKS, ...OPACITY_FACTOR_TRACK],
		generatedNodeStrategy: "none",
		clipStrategy: "single-binding-range",
	},
	{
		techniqueId: "arrangement-transition",
		outputKinds: ["motion-track", "clip"],
		targetScope: "all-targets",
		scalarTracks: [...TRANSLATE_TRACKS, ...SCALE_FACTOR_TRACKS],
		generatedNodeStrategy: "none",
		clipStrategy: "single-binding-range",
	},
	{
		techniqueId: "merge-split-cycle",
		outputKinds: ["motion-track", "clip"],
		targetScope: "all-targets",
		scalarTracks: [
			...TRANSLATE_TRACKS,
			...SCALE_FACTOR_TRACKS,
			...OPACITY_FACTOR_TRACK,
		],
		generatedNodeStrategy: "none",
		clipStrategy: "single-binding-range",
	},
	{
		techniqueId: "count-growth",
		outputKinds: ["motion-track", "clip"],
		targetScope: "all-targets",
		scalarTracks: [...SCALE_FACTOR_TRACKS, ...OPACITY_FACTOR_TRACK],
		generatedNodeStrategy: "none",
		clipStrategy: "single-binding-range",
	},
	{
		techniqueId: "mirror-symmetric-scale",
		outputKinds: ["motion-track", "clip"],
		targetScope: "relational-followers",
		scalarTracks: SCALE_FACTOR_TRACKS,
		generatedNodeStrategy: "none",
		clipStrategy: "single-binding-range",
	},
	{
		techniqueId: "boolean-difference-rotation",
		outputKinds: ["motion-track", "clip", "editable-artifact"],
		targetScope: "relational-followers",
		scalarTracks: ROTATE_TRACK,
		generatedNodeStrategy: "none",
		editableArtifacts: BOOLEAN_GEOMETRY_ARTIFACTS,
		clipStrategy: "single-binding-range",
	},
	{
		techniqueId: "inverse-proportion-link",
		outputKinds: ["motion-track", "clip"],
		targetScope: "relational-followers",
		scalarTracks: SCALE_FACTOR_TRACKS,
		generatedNodeStrategy: "none",
		clipStrategy: "single-binding-range",
	},
	{
		techniqueId: "reactive-neighbor-displacement",
		outputKinds: ["motion-track", "clip"],
		targetScope: "relational-followers",
		scalarTracks: TRANSLATE_TRACKS,
		generatedNodeStrategy: "none",
		clipStrategy: "single-binding-range",
	},
	{
		techniqueId: "lag-follow-through",
		outputKinds: ["motion-track", "clip"],
		targetScope: "ordered-followers",
		scalarTracks: [...TRANSLATE_TRACKS, ...ROTATE_TRACK],
		generatedNodeStrategy: "none",
		clipStrategy: "single-binding-range",
	},
	{
		techniqueId: "planar-solid-tumble",
		outputKinds: ["motion-track", "clip", "editable-artifact"],
		targetScope: "all-targets",
		scalarTracks: [...ROTATE_TRACK, ...SCALE_FACTOR_TRACKS],
		generatedNodeStrategy: "none",
		editableArtifacts: PROJECTION_POSE_ARTIFACTS,
		clipStrategy: "single-binding-range",
	},
	{
		techniqueId: "shear-split",
		outputKinds: ["motion-track", "clip", "editable-artifact"],
		targetScope: "all-targets",
		scalarTracks: [...TRANSLATE_TRACKS, ...ROTATE_TRACK],
		generatedNodeStrategy: "none",
		editableArtifacts: SHEAR_STATE_ARTIFACTS,
		clipStrategy: "single-binding-range",
	},
	{
		techniqueId: "auto-orient-along-path",
		outputKinds: ["motion-track", "clip"],
		targetScope: "all-targets",
		scalarTracks: ROTATION_OVERRIDE_TRACK,
		generatedNodeStrategy: "none",
		clipStrategy: "single-binding-range",
	},
	{
		techniqueId: "size-speed-parallax",
		outputKinds: ["motion-track", "clip"],
		targetScope: "all-targets",
		scalarTracks: [...TRANSLATE_TRACKS, ...SCALE_FACTOR_TRACKS],
		generatedNodeStrategy: "none",
		clipStrategy: "single-binding-range",
	},
	{
		// noise-wipe writes its own `texture.material.reveal.progress` automation
		// track directly (see createNoiseWipeMotionCommands) instead of going
		// through this decomposition IR's scalar-track/generated-node/clip
		// machinery, and its binding always carries `effectBinding: {kind:"none"}`
		// so the generic effect-automation artifact path (effectAutomationArtifact)
		// also contributes nothing. This row exists only so the coverage lookup
		// does not throw; an all-empty plan degrades to the ordinary "No planned
		// outputs" blocked state (expansionBlockerLabels), not a crash.
		techniqueId: "noise-wipe",
		outputKinds: [],
		targetScope: "none",
		scalarTracks: [],
		generatedNodeStrategy: "none",
		clipStrategy: "none",
	},
	{
		// stroke-draw-on writes the semantic `stroke.drawOn.progress` channel
		// directly through Scene + Motion Grammar commands. MotionDocument has no
		// equivalent editable scalar property, so the authoring profile exposes a
		// live-only limitation instead of pretending an ordinary-track expansion.
		// This empty row keeps the exhaustive coverage lookup total; the document
		// compiler rejects explicit bake/expand requests from the profile contract.
		techniqueId: "stroke-draw-on",
		outputKinds: [],
		targetScope: "none",
		scalarTracks: [],
		generatedNodeStrategy: "none",
		clipStrategy: "none",
	},
	{
		// collision-bounce samples live through the expression registry
		// (`COLLISION_BOUNCE_V1.sample`, see expression-runtime.ts) exactly like
		// cyclic-path-travel, but unlike cyclic-path-travel its explicit bake does
		// NOT go through this decomposition IR's generic scalar-track/
		// generated-node/clip pipeline: that pipeline only emits dense per-frame
		// LINEAR keys (`emitMotionGrammarScalarTracks`), the representation
		// `docs/knowledge/bounce-canonical-representation.md` explicitly rejects
		// for bounce (candidate (b), "no `outTemporalCurve`, no semantic handle").
		// The real bake is `collision-bounce-bake.ts`'s sparse beat-anchored
		// emitter, triggered from the Inspector's Collision Bounce bake action
		// (`commitBakeCollisionBounce` in `motion-grammar-authoring.ts`), which
		// walks the same `ballistic-bounce.ts` schedule/envelope math as the live
		// sampler and writes cubic `outTemporalCurve` keys directly through the
		// motion command bus. This row exists only so the coverage lookup does
		// not throw (mirrors noise-wipe's ccf4fd66 fix — MotionExpansionControls
		// unconditionally builds a decomposition preview for any cataloged
		// technique); the generic "Create Editable Motion" Inspector button
		// honestly reports "No planned outputs" / blocked for collision-bounce
		// instead of silently emitting the rejected dense representation.
		techniqueId: "collision-bounce",
		outputKinds: [],
		targetScope: "none",
		scalarTracks: [],
		generatedNodeStrategy: "none",
		clipStrategy: "none",
	},
] as const satisfies readonly MotionGrammarTechniqueDecompositionCoverage[];

const finiteRoundedFrame = (
	value: number | undefined,
	fallback: number,
): number =>
	typeof value === "number" && Number.isFinite(value)
		? Math.round(value)
		: fallback;

const normalizeDocumentEndFrame = (durationFrames: number): number =>
	Math.max(FIRST_FRAME, finiteRoundedFrame(durationFrames, FIRST_FRAME));

const clampFrame = (frame: number, documentEndFrame: number): number =>
	Math.min(documentEndFrame, Math.max(FIRST_FRAME, frame));

/**
 * Normalizes an authored bake range to finite inclusive document frames. If start
 * and end are reversed, they are swapped after clamping so callers can pass drag
 * handle ranges without pre-sorting.
 */
export function normalizeMotionGrammarDecompositionFrameRange(
	input: MotionGrammarDecompositionFrameRangeInput | undefined,
	documentDurationFrames: number,
): MotionGrammarDecompositionFrameRange {
	const documentEndFrame = normalizeDocumentEndFrame(documentDurationFrames);
	const start = finiteRoundedFrame(input?.startFrame, FIRST_FRAME);
	const endFromDuration =
		input?.durationFrames === undefined
			? undefined
			: start + Math.max(1, finiteRoundedFrame(input.durationFrames, 1)) - 1;
	const end = finiteRoundedFrame(
		input?.endFrame ?? endFromDuration,
		documentEndFrame,
	);
	const clampedStart = clampFrame(start, documentEndFrame);
	const clampedEnd = clampFrame(end, documentEndFrame);
	const startFrame = Math.min(clampedStart, clampedEnd);
	const endFrame = Math.max(clampedStart, clampedEnd);
	return {
		startFrame,
		endFrame,
		durationFrames: endFrame - startFrame + 1,
	};
}

/** Normalizes a sampling cadence to a positive whole-frame step. */
export function normalizeMotionGrammarDecompositionSampleStep(
	sampleStepFrames: number | undefined,
): number {
	if (
		typeof sampleStepFrames !== "number" ||
		!Number.isFinite(sampleStepFrames)
	) {
		return DEFAULT_SAMPLE_STEP_FRAMES;
	}
	return Math.max(DEFAULT_SAMPLE_STEP_FRAMES, Math.round(sampleStepFrames));
}

/**
 * Returns deterministic sample frames for a normalized range. The inclusive end
 * frame is always present even when the cadence does not land on it exactly.
 */
export function motionGrammarDecompositionSampleFrames(
	range: MotionGrammarDecompositionFrameRange,
	sampleStepFrames: number,
): readonly number[] {
	const step = normalizeMotionGrammarDecompositionSampleStep(sampleStepFrames);
	const frames: number[] = [];
	for (let frame = range.startFrame; frame <= range.endFrame; frame += step) {
		frames.push(frame);
	}
	if (frames[frames.length - 1] !== range.endFrame) {
		frames.push(range.endFrame);
	}
	return frames;
}

const collectSceneNodeIds = (
	nodes: readonly VectorNode[],
	out: Set<string>,
): void => {
	for (const node of nodes) {
		out.add(node.id);
		if (node.children) collectSceneNodeIds(node.children, out);
	}
};

const collectSceneNodes = (
	nodes: readonly VectorNode[],
	out: Map<string, VectorNode>,
): void => {
	for (const node of nodes) {
		out.set(node.id, node);
		if (node.children) collectSceneNodes(node.children, out);
	}
};

const sceneNodeIds = (scene: SceneDocument): ReadonlySet<string> => {
	const ids = new Set<string>();
	for (const layer of scene.layers) collectSceneNodeIds(layer.nodes, ids);
	return ids;
};

const sceneNodesById = (
	scene: SceneDocument,
): ReadonlyMap<string, VectorNode> => {
	const nodes = new Map<string, VectorNode>();
	for (const layer of scene.layers) collectSceneNodes(layer.nodes, nodes);
	return nodes;
};

/**
 * Validates the binding's ordered target ids against the current scene. The
 * output preserves binding order so wavefront and relational emitters can use it
 * directly after checking `hasEnoughTargets`.
 */
export function validateMotionGrammarDecompositionTargets(
	binding: MotionGrammarBinding,
	scene: SceneDocument,
): MotionGrammarDecompositionTargetValidation {
	const ids = sceneNodeIds(scene);
	const entry = findCatalogEntry(binding.techniqueId);
	const existingTargetIds = binding.targetIds.filter((id) => ids.has(id));
	const missingTargetIds = binding.targetIds.filter((id) => !ids.has(id));
	const minTargets = entry?.minTargets ?? 1;
	return {
		targetIds: binding.targetIds,
		existingTargetIds,
		missingTargetIds,
		minTargets,
		hasEnoughTargets: existingTargetIds.length >= minTargets,
	};
}

/**
 * Returns the coverage row for one technique. Missing rows indicate a broken
 * contract matrix and should fail tests before downstream streams begin.
 */
export function motionGrammarDecompositionCoverageForTechnique(
	techniqueId: MotionGrammarTechniqueId,
): MotionGrammarTechniqueDecompositionCoverage {
	const coverage = MOTION_GRAMMAR_DECOMPOSITION_COVERAGE.find(
		(entry) => entry.techniqueId === techniqueId,
	);
	if (!coverage) {
		throw new Error(
			`Missing motion-grammar decomposition coverage: ${techniqueId}`,
		);
	}
	return coverage;
}

const roleTargetIds = (
	binding: MotionGrammarBinding,
	roles: readonly string[],
): readonly string[] => {
	if (!binding.roleMap) return [];
	const targetSet = new Set(binding.targetIds);
	const ordered: string[] = [];
	const seen = new Set<string>();
	const add = (nodeId: string | undefined): void => {
		if (!nodeId || !targetSet.has(nodeId) || seen.has(nodeId)) return;
		seen.add(nodeId);
		ordered.push(nodeId);
	};
	for (const role of roles) {
		add(binding.roleMap[role]);
	}
	for (const role of roles) {
		for (const targetId of binding.targetIds) {
			if (binding.roleMap[targetId] === role) add(targetId);
		}
	}
	return ordered;
};

const roleTargetId = (
	binding: MotionGrammarBinding,
	roles: readonly string[],
): string | undefined => {
	return roleTargetIds(binding, roles)[0];
};

const relationalTargetIds = (
	binding: MotionGrammarBinding,
): readonly string[] => {
	const ordered: string[] = [];
	const seen = new Set<string>();
	const add = (nodeId: string | undefined): void => {
		if (!nodeId || seen.has(nodeId) || !binding.targetIds.includes(nodeId)) {
			return;
		}
		seen.add(nodeId);
		ordered.push(nodeId);
	};
	add(roleTargetId(binding, DRIVER_ROLE_ALIASES) ?? binding.targetIds[0]);
	add(roleTargetId(binding, FOLLOWER_ROLE_ALIASES));
	for (const nodeId of binding.targetIds) add(nodeId);
	return ordered;
};

const targetIdsForScope = (
	binding: MotionGrammarBinding,
	validation: MotionGrammarDecompositionTargetValidation,
	scope: MotionGrammarDecompositionTargetScope,
): readonly string[] => {
	const existing = new Set(validation.existingTargetIds);
	switch (scope) {
		case "none":
			return [];
		case "all-targets":
			return binding.targetIds.filter((id) => existing.has(id));
		case "primary-role-targets": {
			const nonPrimary =
				binding.techniqueId === "cyclic-path-travel"
					? new Set(
							roleTargetIds(binding, CYCLIC_PATH_NON_PRIMARY_ROLE_ALIASES),
						)
					: new Set<string>();
			return binding.targetIds.filter(
				(id) => existing.has(id) && !nonPrimary.has(id),
			);
		}
		case "ordered-followers":
			return binding.targetIds.slice(1).filter((id) => existing.has(id));
		case "relational-followers":
			return relationalTargetIds(binding)
				.slice(1)
				.filter((id) => existing.has(id));
	}
};

const stableIdPart = (value: string): string =>
	value.replace(/[^a-zA-Z0-9_-]+/g, "_");

const nodeTargetIdPart = (
	target: MotionGrammarDecompositionNodeTarget,
): string => {
	switch (target.kind) {
		case "existing-scene-node":
			return stableIdPart(target.nodeId);
		case "generated-scene-node":
			return stableIdPart(target.nodeIdSeed);
	}
};

const scalarTrackIdSeed = (
	binding: MotionGrammarBinding,
	target: MotionGrammarDecompositionNodeTarget,
	track: MotionGrammarScalarTrackCoverage,
): string =>
	[
		"grammar",
		stableIdPart(binding.id),
		stableIdPart(binding.techniqueId),
		nodeTargetIdPart(target),
		track.property,
		stableIdPart(track.sourceChannel),
	].join(":");

const generatedNodeIdSeed = (
	binding: MotionGrammarBinding,
	sourceNodeId: string,
	copyIndex: number,
): string =>
	[
		"grammar",
		stableIdPart(binding.id),
		"echo",
		stableIdPart(sourceNodeId),
		String(copyIndex),
	].join(":");

const clipIdSeed = (
	binding: MotionGrammarBinding,
	range: MotionGrammarDecompositionFrameRange,
): string =>
	[
		"grammar",
		stableIdPart(binding.id),
		stableIdPart(binding.techniqueId),
		"clip",
		String(range.startFrame),
		String(range.endFrame),
	].join(":");

const editableArtifactIdSeed = (
	binding: MotionGrammarBinding,
	artifactKind: MotionGrammarEditableArtifactKind,
	range: MotionGrammarDecompositionFrameRange,
	index: number,
): string =>
	[
		"grammar",
		stableIdPart(binding.id),
		stableIdPart(binding.techniqueId),
		"artifact",
		stableIdPart(artifactKind),
		String(range.startFrame),
		String(range.endFrame),
		String(index),
	].join(":");

const generatedEditableArtifactIdSeed = (
	generatedNodeSeed: string,
	artifactKind: MotionGrammarEditableArtifactKind,
): string =>
	[generatedNodeSeed, "artifact", stableIdPart(artifactKind)].join(":");

const editableArtifactTrackIdSeed = (
	artifactIdSeed: string,
	target: MotionGrammarDecompositionNodeTarget,
	property: SnapshotAnimatableProperty,
): string =>
	[artifactIdSeed, "track", nodeTargetIdPart(target), property].join(":");

const provenanceForBinding = (
	binding: MotionGrammarBinding,
): MotionGrammarDecompositionProvenance => {
	const entry = findCatalogEntry(binding.techniqueId);
	return {
		source: "motion-grammar",
		bindingId: binding.id,
		techniqueId: binding.techniqueId,
		techniqueLabel: entry?.label ?? binding.techniqueId,
		targetIds: binding.targetIds,
		parameters: binding.parameters,
		...(binding.seed === undefined ? {} : { seed: binding.seed }),
		...(binding.roleMap === undefined ? {} : { roleMap: binding.roleMap }),
	};
};

const createScalarTrackPlans = ({
	binding,
	targets,
	tracks,
	range,
	sampleStepFrames,
	sampleFrames,
	provenance,
}: {
	readonly binding: MotionGrammarBinding;
	readonly targets: readonly MotionGrammarDecompositionNodeTarget[];
	readonly tracks: readonly MotionGrammarScalarTrackCoverage[];
	readonly range: MotionGrammarDecompositionFrameRange;
	readonly sampleStepFrames: number;
	readonly sampleFrames: readonly number[];
	readonly provenance: MotionGrammarDecompositionProvenance;
}): readonly MotionGrammarScalarTrackPlan[] => {
	const outputs: MotionGrammarScalarTrackPlan[] = [];
	for (const target of targets) {
		for (const track of tracks) {
			outputs.push({
				kind: "motion-track",
				idSeed: scalarTrackIdSeed(binding, target, track),
				target,
				property: track.property,
				sourceChannel: track.sourceChannel,
				composition: track.composition,
				unit: track.unit,
				frameRange: range,
				sampleStepFrames,
				sampleFrames,
				emitter: "scalar-track",
				status: "pending-emitter",
				provenance,
			});
		}
	}
	return outputs;
};

const numericBindingParameter = (
	binding: MotionGrammarBinding,
	key: string,
	fallback: number,
): number => {
	const value = binding.parameters[key];
	return Number.isFinite(value) ? value : fallback;
};

const scalarTracksForBinding = (
	coverage: MotionGrammarTechniqueDecompositionCoverage,
	binding: MotionGrammarBinding,
): readonly MotionGrammarScalarTrackCoverage[] => {
	if (
		binding.techniqueId !== "cyclic-path-travel" ||
		numericBindingParameter(
			binding,
			"orientToTangent",
			CYCLIC_PATH_ORIENT_TO_TANGENT_DEFAULT,
		) >= 0.5
	) {
		return coverage.scalarTracks;
	}
	return coverage.scalarTracks.filter(
		(track) => track.sourceChannel !== "rotation-override",
	);
};

const snapshotPropertiesForTarget = (
	target: MotionGrammarDecompositionNodeTarget,
	channels: readonly MotionGrammarDecompositionChannel[],
	nodes: ReadonlyMap<string, VectorNode>,
): readonly SnapshotAnimatableProperty[] => {
	const sourceNodeId =
		target.kind === "existing-scene-node" ? target.nodeId : target.sourceNodeId;
	const node = nodes.get(sourceNodeId);
	if (!node) return [];
	const channelSet = new Set(channels);
	const properties: SnapshotAnimatableProperty[] = [];
	if (channelSet.has("pathShape") && node.geometry.kind === "path") {
		properties.push("pathShape");
	}
	if (
		channelSet.has("meshPaint") &&
		node.style.fills?.[0]?.kind === "mesh-gradient"
	) {
		properties.push("meshPaint");
	}
	return properties;
};

const createEditableArtifactTrackPlans = ({
	artifactIdSeed,
	artifact,
	targets,
	nodes,
}: {
	readonly artifactIdSeed: string;
	readonly artifact: MotionGrammarEditableArtifactCoverage;
	readonly targets: readonly MotionGrammarDecompositionNodeTarget[];
	readonly nodes: ReadonlyMap<string, VectorNode>;
}): readonly MotionGrammarEditableArtifactTrackPlan[] => {
	if (artifact.artifactKind !== "source-frame-snapshot") return [];
	return targets.flatMap((target) =>
		snapshotPropertiesForTarget(target, artifact.channels, nodes).map(
			(property): MotionGrammarEditableArtifactTrackPlan => ({
				idSeed: editableArtifactTrackIdSeed(artifactIdSeed, target, property),
				target,
				property,
			}),
		),
	);
};

const createEditableArtifactPlan = ({
	idSeed,
	artifact,
	targets,
	range,
	sampleStepFrames,
	sampleFrames,
	provenance,
	nodes,
}: {
	readonly idSeed: string;
	readonly artifact: MotionGrammarEditableArtifactCoverage;
	readonly targets: readonly MotionGrammarDecompositionNodeTarget[];
	readonly range: MotionGrammarDecompositionFrameRange;
	readonly sampleStepFrames: number;
	readonly sampleFrames: readonly number[];
	readonly provenance: MotionGrammarDecompositionProvenance;
	readonly nodes: ReadonlyMap<string, VectorNode>;
}): MotionGrammarEditableArtifactPlan | undefined => {
	if (targets.length === 0) return undefined;
	const trackPlans = createEditableArtifactTrackPlans({
		artifactIdSeed: idSeed,
		artifact,
		targets,
		nodes,
	});
	if (
		artifact.artifactKind === "source-frame-snapshot" &&
		trackPlans.length === 0
	) {
		return undefined;
	}
	const materializedTargets =
		artifact.artifactKind === "source-frame-snapshot"
			? targets.filter((target) =>
					trackPlans.some((trackPlan) => trackPlan.target === target),
				)
			: targets;
	const materializedChannels =
		artifact.artifactKind === "source-frame-snapshot"
			? [...new Set(trackPlans.map((trackPlan) => trackPlan.property))]
			: artifact.channels;
	return {
		kind: "editable-artifact",
		idSeed,
		artifactKind: artifact.artifactKind,
		targets: materializedTargets,
		channels: materializedChannels,
		trackPlans,
		description: artifact.description,
		frameRange: range,
		sampleStepFrames,
		sampleFrames,
		emitter: "editable-artifact-materializer",
		status: "pending-emitter",
		provenance,
	};
};

const createEditableArtifactPlans = ({
	binding,
	validation,
	artifacts,
	range,
	sampleStepFrames,
	sampleFrames,
	provenance,
	nodes,
	indexOffset = 0,
}: {
	readonly binding: MotionGrammarBinding;
	readonly validation: MotionGrammarDecompositionTargetValidation;
	readonly artifacts: readonly MotionGrammarEditableArtifactCoverage[];
	readonly range: MotionGrammarDecompositionFrameRange;
	readonly sampleStepFrames: number;
	readonly sampleFrames: readonly number[];
	readonly provenance: MotionGrammarDecompositionProvenance;
	readonly nodes: ReadonlyMap<string, VectorNode>;
	readonly indexOffset?: number;
}): readonly MotionGrammarEditableArtifactPlan[] =>
	artifacts
		.map((artifact, index): MotionGrammarEditableArtifactPlan | undefined => {
			const targetIds = targetIdsForScope(
				binding,
				validation,
				artifact.targetScope,
			);
			return createEditableArtifactPlan({
				idSeed: editableArtifactIdSeed(
					binding,
					artifact.artifactKind,
					range,
					indexOffset + index,
				),
				artifact,
				targets: targetIds.map((nodeId) => ({
					kind: "existing-scene-node",
					nodeId,
				})),
				range,
				sampleStepFrames,
				sampleFrames,
				provenance,
				nodes,
			});
		})
		.filter((plan): plan is MotionGrammarEditableArtifactPlan => Boolean(plan));

const effectAutomationArtifact = ({
	binding,
	validation,
	range,
	sampleStepFrames,
	sampleFrames,
	provenance,
	index,
}: {
	readonly binding: MotionGrammarBinding;
	readonly validation: MotionGrammarDecompositionTargetValidation;
	readonly range: MotionGrammarDecompositionFrameRange;
	readonly sampleStepFrames: number;
	readonly sampleFrames: readonly number[];
	readonly provenance: MotionGrammarDecompositionProvenance;
	readonly index: number;
}): MotionGrammarEditableArtifactPlan | undefined => {
	const effect = binding.effectBinding;
	if (!effect || effect.kind === "none") return undefined;
	if (
		binding.techniqueId === "periodic-afterimage" &&
		effect.kind === "temporal-echo"
	) {
		return undefined;
	}
	const channel: MotionGrammarDecompositionChannel =
		effect.kind === "active-target-influence"
			? "active-target-influence"
			: effect.kind === "automation-param"
				? "effect-automation"
				: "temporal-echo";
	return {
		kind: "editable-artifact",
		idSeed: editableArtifactIdSeed(binding, "effect-automation", range, index),
		artifactKind: "effect-automation",
		targets: validation.existingTargetIds.map((nodeId) => ({
			kind: "existing-scene-node",
			nodeId,
		})),
		channels: [channel],
		trackPlans: [],
		description:
			"Editable automation artifact for grammar-bound effect channels.",
		frameRange: range,
		sampleStepFrames,
		sampleFrames,
		emitter: "editable-artifact-materializer",
		status: "pending-emitter",
		provenance,
	};
};

const createTemporalEchoOutputs = ({
	binding,
	coverage,
	validation,
	range,
	sampleStepFrames,
	sampleFrames,
	provenance,
	nodes,
}: {
	readonly binding: MotionGrammarBinding;
	readonly coverage: MotionGrammarTechniqueDecompositionCoverage;
	readonly validation: MotionGrammarDecompositionTargetValidation;
	readonly range: MotionGrammarDecompositionFrameRange;
	readonly sampleStepFrames: number;
	readonly sampleFrames: readonly number[];
	readonly provenance: MotionGrammarDecompositionProvenance;
	readonly nodes: ReadonlyMap<string, VectorNode>;
}): readonly MotionGrammarDecompositionOutput[] => {
	if (coverage.generatedNodeStrategy !== "temporal-echo-clones") return [];
	const generatedScalarTracks = coverage.generatedScalarTracks ?? [];
	const echoPlans = planPeriodicAfterimageEchoes(binding, range.startFrame);
	const outputs: MotionGrammarDecompositionOutput[] = [];
	for (const sourceNodeId of validation.existingTargetIds) {
		for (const [echoIndex, echo] of echoPlans.entries()) {
			const copyIndex = echoIndex + 1;
			const idSeed = generatedNodeIdSeed(binding, sourceNodeId, copyIndex);
			const target: MotionGrammarDecompositionNodeTarget = {
				kind: "generated-scene-node",
				nodeIdSeed: idSeed,
				sourceNodeId,
			};
			const scalarTracks = createScalarTrackPlans({
				binding,
				targets: [target],
				tracks: generatedScalarTracks,
				range,
				sampleStepFrames,
				sampleFrames,
				provenance,
			});
			const artifact = createEditableArtifactPlan({
				idSeed: generatedEditableArtifactIdSeed(
					idSeed,
					SOURCE_FRAME_SNAPSHOT_ARTIFACT.artifactKind,
				),
				artifact: {
					...SOURCE_FRAME_SNAPSHOT_ARTIFACT,
					description:
						"Editable source-frame geometry/style snapshots for temporal echo clones.",
				},
				targets: [target],
				range,
				sampleStepFrames,
				sampleFrames,
				provenance,
				nodes,
			});
			outputs.push({
				kind: "scene-node",
				idSeed,
				sourceNodeId,
				strategy: "clone-source-node",
				role: "temporal-echo",
				copyIndex,
				previewSourceFrameAtRangeStart: echo.sourceFrame,
				opacityMultiplier: echo.opacityFactor,
				placement: {
					kind: "after-source-node",
					sourceNodeId,
				},
				scalarTrackIdSeeds: scalarTracks.map((track) => track.idSeed),
				emitter: "scene-node-materializer",
				status: "pending-emitter",
				provenance,
			});
			outputs.push(...scalarTracks);
			if (artifact) outputs.push(artifact);
		}
	}
	return outputs;
};

const createClipPlan = ({
	binding,
	outputs,
	range,
	provenance,
}: {
	readonly binding: MotionGrammarBinding;
	readonly outputs: readonly MotionGrammarDecompositionOutput[];
	readonly range: MotionGrammarDecompositionFrameRange;
	readonly provenance: MotionGrammarDecompositionProvenance;
}): MotionGrammarClipPlan | undefined => {
	const trackIdSeeds = outputs.flatMap((output) => {
		if (output.kind === "motion-track") return [output.idSeed];
		if (output.kind === "editable-artifact") {
			return output.trackPlans.map((trackPlan) => trackPlan.idSeed);
		}
		return [];
	});
	const generatedNodeIdSeeds = outputs
		.filter((output): output is MotionGrammarSceneNodePlan => {
			return output.kind === "scene-node";
		})
		.map((node) => node.idSeed);
	const editableArtifacts = outputs
		.filter((output): output is MotionGrammarEditableArtifactPlan => {
			return output.kind === "editable-artifact";
		})
		.map(
			(artifact): MotionGrammarClipEditableArtifactRef => ({
				idSeed: artifact.idSeed,
				artifactKind: artifact.artifactKind,
				targetIds: artifact.targets.flatMap((target) =>
					target.kind === "existing-scene-node"
						? [target.nodeId]
						: [target.nodeIdSeed],
				),
				channels: artifact.channels,
				description: artifact.description,
			}),
		);
	if (
		trackIdSeeds.length === 0 &&
		generatedNodeIdSeeds.length === 0 &&
		editableArtifacts.length === 0
	) {
		return undefined;
	}
	return {
		kind: "clip",
		idSeed: clipIdSeed(binding, range),
		name: `${provenance.techniqueLabel} expansion`,
		frameRange: range,
		trackIdSeeds,
		generatedNodeIdSeeds,
		editableArtifacts,
		emitter: "clip-provenance-writer",
		status: "pending-emitter",
		provenance,
	};
};

const targetValidationIssues = (
	binding: MotionGrammarBinding,
	validation: MotionGrammarDecompositionTargetValidation,
): readonly MotionGrammarDecompositionIssue[] => {
	const issues: MotionGrammarDecompositionIssue[] =
		validation.missingTargetIds.map((nodeId) => ({
			code: "missing-target",
			severity: "error",
			bindingId: binding.id,
			techniqueId: binding.techniqueId,
			nodeId,
			message: `Target "${nodeId}" is not present in the scene document.`,
		}));
	if (!validation.hasEnoughTargets) {
		issues.push({
			code: "insufficient-targets",
			severity: "error",
			bindingId: binding.id,
			techniqueId: binding.techniqueId,
			message: `Technique requires at least ${validation.minTargets} existing target(s), but ${validation.existingTargetIds.length} are available.`,
		});
	}
	return issues;
};

/**
 * Computes output-size estimates from a planned output list. `scalarKeyframeCount`
 * is an upper bound: emitters may collapse identical adjacent values later.
 */
export function estimateMotionGrammarDecompositionPlan(
	outputs: readonly MotionGrammarDecompositionOutput[],
	sampleFrameCount: number,
	issues: readonly MotionGrammarDecompositionIssue[] = [],
): MotionGrammarDecompositionEstimate {
	const scalarTrackCount = outputs.filter(
		(output) => output.kind === "motion-track",
	).length;
	const generatedNodeCount = outputs.filter(
		(output) => output.kind === "scene-node",
	).length;
	const clipCount = outputs.filter((output) => output.kind === "clip").length;
	const editableArtifactCount = outputs.filter(
		(output) => output.kind === "editable-artifact",
	).length;
	const editableArtifactTrackCount = outputs.flatMap((output) =>
		output.kind === "editable-artifact" ? output.trackPlans : [],
	).length;
	const scalarKeyframeCount = scalarTrackCount * sampleFrameCount;
	const editableArtifactKeyframeCount =
		editableArtifactTrackCount * sampleFrameCount;
	return {
		generatedNodeCount,
		scalarTrackCount,
		editableArtifactTrackCount,
		clipCount,
		editableArtifactCount,
		sampleFrameCount,
		scalarKeyframeCount,
		editableArtifactKeyframeCount,
		keyframeCount: scalarKeyframeCount + editableArtifactKeyframeCount,
		issueCount: issues.length,
		warningCount: issues.filter((issue) => issue.severity === "warning").length,
		errorCount: issues.filter((issue) => issue.severity === "error").length,
	};
}

const outputEstimateIssue = (
	binding: MotionGrammarBinding,
	estimate: MotionGrammarDecompositionEstimate,
): MotionGrammarDecompositionIssue | undefined => {
	if (
		estimate.scalarTrackCount + estimate.editableArtifactTrackCount <=
			LARGE_TRACK_ESTIMATE_THRESHOLD &&
		estimate.keyframeCount <= LARGE_KEYFRAME_ESTIMATE_THRESHOLD
	) {
		return undefined;
	}
	return {
		code: "large-output-estimate",
		severity: "warning",
		bindingId: binding.id,
		techniqueId: binding.techniqueId,
		message: `Expansion may create ${estimate.scalarTrackCount + estimate.editableArtifactTrackCount} track(s) and up to ${estimate.keyframeCount} keyframe(s).`,
	};
};

/**
 * Builds the pure decomposition plan for a grammar binding. It validates targets,
 * normalizes frame/sample settings, describes scalar/scene/clip outputs for all
 * implemented techniques, and reports unsupported or lossy channels explicitly.
 */
export function createMotionGrammarDecompositionPlan({
	binding,
	scene,
	motion,
	frameRange,
	sampleStepFrames,
	includeClip = true,
}: CreateMotionGrammarDecompositionPlanInput): MotionGrammarDecompositionPlan {
	const range = normalizeMotionGrammarDecompositionFrameRange(
		frameRange,
		motion.durationFrames,
	);
	const normalizedSampleStep =
		normalizeMotionGrammarDecompositionSampleStep(sampleStepFrames);
	const sampleFrames = motionGrammarDecompositionSampleFrames(
		range,
		normalizedSampleStep,
	);
	const coverage = motionGrammarDecompositionCoverageForTechnique(
		binding.techniqueId,
	);
	const targetValidation = validateMotionGrammarDecompositionTargets(
		binding,
		scene,
	);
	const nodes = sceneNodesById(scene);
	const provenance = provenanceForBinding(binding);
	const expressionVersionUnsupported =
		motionExpressionBindingState(binding.techniqueId, binding.parameters) ===
		"unsupported";
	const expressionDefinition = findMotionExpressionDefinition(
		binding.techniqueId,
	);
	const followThroughLeadAdapter = isFollowThroughLeadAdapterParameters(
		binding.techniqueId,
		binding.parameters,
	);
	const expressionBakeUnsupported =
		!expressionVersionUnsupported &&
		(followThroughLeadAdapter ||
			(expressionDefinition?.activation === "versioned" &&
				isMotionExpressionBindingActive(expressionDefinition, binding) &&
				expressionDefinition.timeline.bakePolicy === "not-supported"));
	const liveOnlyExpressionLabel = followThroughLeadAdapter
		? "Lead-track Follow-through"
		: (expressionDefinition?.label ?? "Motion expression");
	const issues: MotionGrammarDecompositionIssue[] = [
		...targetValidationIssues(binding, targetValidation),
		...(expressionVersionUnsupported
			? [
					{
						code: "expression-version-unsupported" as const,
						severity: "error" as const,
						bindingId: binding.id,
						techniqueId: binding.techniqueId,
						message:
							"Motion expression version is unsupported or malformed; Bake is blocked to preserve the binding losslessly.",
					},
				]
			: []),
		...(expressionBakeUnsupported
			? [
					{
						code: "expression-bake-unsupported" as const,
						severity: "error" as const,
						bindingId: binding.id,
						techniqueId: binding.techniqueId,
						message: `${liveOnlyExpressionLabel} is a live-only versioned expression and does not support editable bake output.`,
					},
				]
			: []),
	];

	const outputs: MotionGrammarDecompositionOutput[] = [];
	const canBuildOutputs =
		targetValidation.missingTargetIds.length === 0 &&
		targetValidation.hasEnoughTargets &&
		!expressionVersionUnsupported &&
		!expressionBakeUnsupported;
	if (canBuildOutputs) {
		const targetIds = targetIdsForScope(
			binding,
			targetValidation,
			coverage.targetScope,
		);
		const scalarTracks = scalarTracksForBinding(coverage, binding);
		outputs.push(
			...createScalarTrackPlans({
				binding,
				targets: targetIds.map((nodeId) => ({
					kind: "existing-scene-node",
					nodeId,
				})),
				tracks: scalarTracks,
				range,
				sampleStepFrames: normalizedSampleStep,
				sampleFrames,
				provenance,
			}),
		);
		outputs.push(
			...createEditableArtifactPlans({
				binding,
				validation: targetValidation,
				artifacts: coverage.editableArtifacts ?? [],
				range,
				sampleStepFrames: normalizedSampleStep,
				sampleFrames,
				provenance,
				nodes,
			}),
		);
		outputs.push(
			...createTemporalEchoOutputs({
				binding,
				coverage,
				validation: targetValidation,
				range,
				sampleStepFrames: normalizedSampleStep,
				sampleFrames,
				provenance,
				nodes,
			}),
		);
		const effectArtifact = effectAutomationArtifact({
			binding,
			validation: targetValidation,
			range,
			sampleStepFrames: normalizedSampleStep,
			sampleFrames,
			provenance,
			index: coverage.editableArtifacts?.length ?? 0,
		});
		if (effectArtifact) outputs.push(effectArtifact);
		if (includeClip && coverage.clipStrategy === "single-binding-range") {
			const clip = createClipPlan({
				binding,
				outputs,
				range,
				provenance,
			});
			if (clip) outputs.push(clip);
		}
		if (outputs.length === 0) {
			issues.push({
				code: "empty-output",
				severity: "warning",
				bindingId: binding.id,
				techniqueId: binding.techniqueId,
				message:
					"Technique is valid, but this decomposition range produced no planned outputs.",
			});
		}
	}

	const estimateBeforeSizeWarning = estimateMotionGrammarDecompositionPlan(
		outputs,
		sampleFrames.length,
		issues,
	);
	const sizeIssue = outputEstimateIssue(binding, estimateBeforeSizeWarning);
	if (sizeIssue) issues.push(sizeIssue);
	const estimates = estimateMotionGrammarDecompositionPlan(
		outputs,
		sampleFrames.length,
		issues,
	);

	return {
		schemaVersion: 1,
		bindingId: binding.id,
		techniqueId: binding.techniqueId,
		frameRange: range,
		sampleStepFrames: normalizedSampleStep,
		sampleFrames,
		targetValidation,
		coverage,
		outputs,
		issues,
		estimates,
		provenance,
	};
}

/** Implemented catalog ids that do not yet have a decomposition coverage row. */
export function missingMotionGrammarDecompositionCoverageIds(): readonly MotionGrammarTechniqueId[] {
	const covered = new Set<MotionGrammarTechniqueId>(
		MOTION_GRAMMAR_DECOMPOSITION_COVERAGE.map((entry) => entry.techniqueId),
	);
	return MOTION_GRAMMAR_CATALOG.filter(
		(entry) => entry.status === "implemented" && !covered.has(entry.id),
	).map((entry) => entry.id);
}
