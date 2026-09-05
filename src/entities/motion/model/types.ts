export type { AeKeyframe } from "@/shared/glammer/keyframe-track";

import type { LookGraphOwnerRef } from "@/entities/scene/model/look-graph";
import type { SourceOpticsParameterTarget } from "@/entities/scene/model/source-optics";
import type { TextFragmentUnit } from "@/entities/scene/model/text-fragments";
import type {
	BezierShape,
	LinearGradientPaint,
	MeshGradientPaint,
	RadialGradientPaint,
	Vec2,
} from "@/entities/scene/model/types";
import type { ExpressionSource } from "@/shared/expr-dsl";
import type { AeKeyframe } from "@/shared/glammer/keyframe-track";
import type { AutomationRecipe } from "@/shared/vec-core";
import type { SerializedMotionGrammarLayer } from "./grammar-bridge";

export const ANIMATABLE_PROPERTIES = [
	"x",
	"y",
	"anchorX",
	"anchorY",
	"rotation",
	"scaleX",
	"scaleY",
	"opacity",
	"cornerRadius",
	"cornerRadiusTL",
	"cornerRadiusTR",
	"cornerRadiusBR",
	"cornerRadiusBL",
	"cornerSmoothing",
	"pathShape",
	"meshPaint",
	"fillGradient",
] as const;

export type AnimatableProperty = (typeof ANIMATABLE_PROPERTIES)[number];

export type PathShapeProperty = "pathShape";

/**
 * Snapshot-valued animatable properties: the keyframe value is a whole structured
 * snapshot (a path shape, a mesh paint, or a linear/radial gradient paint) tweened
 * by a dedicated interpolator, never the numeric sampler. `meshPaint` animates a
 * mesh-gradient fill between full mesh snapshots of matching topology; `fillGradient`
 * animates a linear/radial gradient fill (geometry + stop colors/offsets/opacity).
 */
export type SnapshotAnimatableProperty =
	| "pathShape"
	| "meshPaint"
	| "fillGradient";

/**
 * Every {@link SnapshotAnimatableProperty} literal, structurally checked against
 * the type by `satisfies` so a new snapshot property added to the type without a
 * matching entry here is a compile error.
 */
export const SNAPSHOT_ANIMATABLE_PROPERTIES = [
	"pathShape",
	"meshPaint",
	"fillGradient",
] as const satisfies readonly SnapshotAnimatableProperty[];

export type ScalarAnimatableProperty = Exclude<
	AnimatableProperty,
	SnapshotAnimatableProperty
>;

const snapshotAnimatablePropertySet: ReadonlySet<AnimatableProperty> = new Set(
	SNAPSHOT_ANIMATABLE_PROPERTIES,
);

/**
 * Every {@link ScalarAnimatableProperty} literal: {@link ANIMATABLE_PROPERTIES}
 * minus the snapshot-valued properties, so this stays derived from the single
 * canonical property list rather than a third hand-typed literal set. The
 * filter's type predicate keeps the result typed as
 * `readonly ScalarAnimatableProperty[]` without an unsafe cast.
 */
export const SCALAR_ANIMATABLE_PROPERTIES = ANIMATABLE_PROPERTIES.filter(
	(property): property is ScalarAnimatableProperty =>
		!snapshotAnimatablePropertySet.has(property),
);

export type AnimatableValue =
	| number
	| BezierShape
	| MeshGradientPaint
	| LinearGradientPaint
	| RadialGradientPaint;

export type KeyframeTrackTarget = {
	readonly nodeId: string;
	readonly property: AnimatableProperty;
};

/**
 * Side-car keyframe track. Time is stored in frames so timeline, sampler, and
 * export adapters do not mix seconds and frame indices.
 */
export type KeyframeTrack<V extends AnimatableValue = AnimatableValue> = {
	readonly id: string;
	readonly target: KeyframeTrackTarget;
	readonly keyframes: readonly AeKeyframe<V>[];
};

export type PositionPathSpatialMode = "corner" | "continuous" | "auto";

/**
 * Spatial metadata attached to one paired X/Y position-key frame. Position
 * values and temporal easing remain owned by the scalar tracks; tangent vectors
 * are artboard-space offsets from that position stop.
 */
export type PositionPathKey = {
	readonly frame: number;
	readonly inTangent: Vec2;
	readonly outTangent: Vec2;
	readonly spatialMode: PositionPathSpatialMode;
	readonly roving?: boolean;
};

/** Camera-independent cubic route metadata for one scene node's position keys. */
export type PositionPathTrack = {
	readonly id: string;
	readonly nodeId: string;
	readonly keys: readonly PositionPathKey[];
};

/**
 * Identifies a numeric parameter of one Look-graph node, addressed by graph owner
 * (scene/artboard/scoped-overlay scope) + the node id within that graph + the
 * payload param key (e.g. `"scale"`, `"levels"`). This is deliberately NOT a
 * {@link KeyframeTrackTarget}: a look-node param has no scene node, so it lives
 * in its own side-car track collection rather than polluting the node-keyed track
 * union (mirroring how `automation`/`grammar` are side-cars).
 */
export type LookNodeParamTrackTarget = {
	readonly owner: LookGraphOwnerRef;
	readonly lookNodeId: string;
	readonly paramKey: string;
};

/** Side-car keyframe track animating one Look-graph node param. Always numeric. */
export type LookNodeParamTrack = {
	readonly id: string;
	readonly target: LookNodeParamTrackTarget;
	readonly keyframes: readonly AeKeyframe<number>[];
};

/** Numeric Source Optics side-car track addressed without a fake scene node. */
export type SourceOpticsParameterTrack = {
	readonly id: string;
	readonly target: SourceOpticsParameterTarget;
	readonly keyframes: readonly AeKeyframe<number>[];
};

export const CAMERA_RIG_ANIMATABLE_PROPERTIES = [
	"bodyX",
	"bodyY",
	"bodyZ",
	"bodyRotationX",
	"bodyRotationY",
	"bodyRotationZ",
	"targetX",
	"targetY",
	"targetZ",
	"fovDegrees",
	"zoom",
	"focusDistance",
	"aperture",
] as const;

export type CameraRigAnimatableProperty =
	(typeof CAMERA_RIG_ANIMATABLE_PROPERTIES)[number];

/**
 * Non-node track target for authored scene cameras. Camera motion must not be
 * encoded as sentinel node ids because cameras are document/artboard rig data,
 * not vector geometry.
 */
export type CameraRigTrackTarget = {
	readonly cameraRigId: string;
	readonly property: CameraRigAnimatableProperty;
};

/** Side-car keyframe track animating one numeric camera-rig channel. */
export type CameraRigTrack = {
	readonly id: string;
	readonly target: CameraRigTrackTarget;
	readonly keyframes: readonly AeKeyframe<number>[];
};

/**
 * Optional expression seam for ONE numeric scene-camera rig channel.
 *
 * A camera rig is not a scene node, so this deliberately does NOT reuse
 * `NativeExpressionBinding` (which is node-id scoped) and does NOT disguise the
 * rig as a node track: the address is the same `(cameraRigId, channel)` pair
 * `CameraRigTrackTarget` already uses, so one channel has at most one keyframe
 * track and at most one expression.
 *
 * Semantics mirror Codeable Native exactly: the expression COMPOSES over the
 * already-sampled channel value, which arrives as `value`. Keyframes (or the
 * authored static channel) therefore remain the base curve and the expression
 * maps base → final. An expression that cannot produce a usable number — most
 * importantly an unresolved `control()` reference — leaves the base value
 * untouched rather than collapsing the channel to a fabricated `0`.
 */
export type CameraChannelExpression = {
	readonly cameraRigId: string;
	readonly channel: CameraRigAnimatableProperty;
	readonly expr: ExpressionSource;
};

/**
 * Non-node track target for one published control of a linked external
 * production. Like {@link CameraRigTrackTarget} it is deliberately NOT a scene
 * node id and NOT a `BindableKeyframeChannel`: a published control is contract
 * data owned by the link, so disguising it as a node track would make the
 * timeline claim a geometry owner that does not exist.
 *
 * `linkId` scopes the control, because control ids are unique only within one
 * link. Static values for the same pair live on the Scene link (`values`); this
 * side-car overrides them at sample time.
 */
export type ProductionControlTrackTarget = {
	readonly linkId: string;
	readonly controlId: string;
};

/** Side-car keyframe track animating one published production control. */
export type ProductionControlTrack = {
	readonly id: string;
	readonly target: ProductionControlTrackTarget;
	readonly keyframes: readonly AeKeyframe<number>[];
};

export type CameraCutTransitionKind = "cut" | "crossfade";

/** One authored camera-cut segment for an artboard timeline. */
export type CameraCutSegment = {
	readonly id: string;
	readonly name?: string;
	readonly artboardId: string;
	readonly cameraRigId: string;
	readonly laneId?: string;
	readonly startFrame: number;
	readonly durationFrames: number;
	readonly transition: CameraCutTransitionKind;
	readonly transitionDurationFrames?: number;
	readonly thumbnailFrame?: number;
};

/**
 * How a Range Selector's edge falls off across the selected range. Mirrors a
 * subset of After Effects' selector shapes: `square` is a hard in/out window,
 * `ramp-up`/`ramp-down` are linear edges, and `smooth` is a smoothstep ramp that
 * removes hard stepping for reveals. AE's `triangle`/`round` are deferred — they
 * are parity polish, not needed for the core reveal vocabulary.
 */
export type TextSelectorShape = "square" | "ramp-up" | "ramp-down" | "smooth";

/**
 * How a selector combines with the running selection of the selectors before it
 * in an animator group (AE's selector mode). The first selector folds against a
 * base of 0, so `add` is the natural mode for a lone selector.
 */
export type TextSelectorMode = "add" | "subtract" | "intersect" | "min" | "max";

/**
 * A Range Selector: the window `[start, end]` (shifted by `offset`) projected onto
 * the ordered fragments, shaped by `shape`, scaled by `amount`. `offset` is the
 * keyframeable axis — a reveal animates `offsetKeyframes` to sweep the window
 * across the fragments while everything else stays fixed. Keyframes, when present,
 * override the static `offset` (same override rule as node scalar tracks).
 *
 * `units` selects how `start`/`end`/`offset` are read: `percent` are 0..100 of the
 * whole fragment run; `index` are absolute selectable-unit counts.
 */
export type RangeTextSelector = {
	readonly kind: "range";
	readonly mode: TextSelectorMode;
	readonly units: "percent" | "index";
	readonly start: number;
	readonly end: number;
	readonly offset: number;
	readonly offsetKeyframes?: readonly AeKeyframe<number>[];
	/**
	 * Optional expression over the sampled Offset. It COMPOSES rather than
	 * replaces: the keyframe/static offset arrives as `value`, so the authored
	 * reveal curve stays the base and the expression maps base → final. This is
	 * the seam a `control("id")` reference uses to make a published production
	 * control retime a text reveal without a second set of keyframes.
	 *
	 * An expression that yields no usable number (unresolved `control()`, NaN)
	 * leaves the sampled offset untouched — never a fabricated `0`, which would
	 * silently snap the selection window back to the start of the run.
	 */
	readonly offsetExpression?: ExpressionSource;
	readonly amount: number;
	readonly shape: TextSelectorShape;
};

/**
 * Per-fragment deltas an animator applies at full influence (1). Position/rotation
 * are additive deltas; scale/opacity are targets interpolated from rest (1) toward
 * the given value by influence. `trackingOffset`/`blurRadius` are carried as
 * side-car metadata first — they round-trip and drive the Capture readout before a
 * tracking/blur render path exists, so no fidelity is silently dropped.
 */
export type TextAnimatorProperties = {
	readonly opacity?: number;
	readonly positionX?: number;
	readonly positionY?: number;
	readonly scaleX?: number;
	readonly scaleY?: number;
	readonly rotation?: number;
	readonly trackingOffset?: number;
	readonly blurRadius?: number;
};

/**
 * What an animator binding drives. `live-text` resolves fragments from the text
 * node's geometry and renders them by splitting the `<text>`; `outline-group`
 * resolves fragments from outline/imported sub-node membership held on the scene
 * and poses those real nodes. The evaluator is identical for both — only fragment
 * resolution and pose realization differ — which is why the unit lives here, not
 * on a live-text-only shape.
 */
export type TextAnimatorTarget =
	| { readonly kind: "live-text"; readonly nodeId: string }
	| { readonly kind: "outline-group"; readonly nodeId: string };

/**
 * One text animator group: a target, a Based-On unit, the property deltas, and one
 * or more selectors. This is a motion side-car keyed to a scene node — generated
 * fragments are never stored here or in the SceneDocument; they are resolved at
 * sample time. `clip` optionally scopes the animator to a frame window.
 */
export type TextAnimatorBinding = {
	readonly id: string;
	readonly name: string;
	readonly enabled: boolean;
	readonly target: TextAnimatorTarget;
	readonly unit: TextFragmentUnit;
	readonly clip?: {
		readonly startFrame: number;
		readonly durationFrames: number;
	};
	readonly properties: TextAnimatorProperties;
	readonly selectors: readonly RangeTextSelector[];
};

/**
 * Stable authoring address for one Range Selector Offset key. Selectors have no
 * independent durable id, so the binding id plus ordered selector index is the
 * complete owner identity; `frame` addresses an existing key within that owner.
 */
export type TextAnimatorOffsetKeyAddress = {
	readonly bindingId: string;
	readonly selectorIndex: number;
	readonly frame: number;
};

/** Persisted summary of a non-scalar grammar artifact carried by a baked clip. */
export type AnimationClipEditableArtifactProvenance = {
	readonly id: string;
	readonly kind: string;
	readonly targetIds: readonly string[];
	readonly channels: readonly string[];
	readonly description: string;
};

/**
 * Lightweight provenance attached to baked timeline clips. It is descriptive
 * metadata only: samplers and exporters must continue to read ordinary tracks
 * and scene nodes after a grammar expansion has been materialized.
 */
export type AnimationClipProvenance = {
	readonly source: "motion-grammar";
	readonly label: string;
	readonly bindingId: string;
	readonly techniqueId: string;
	readonly techniqueLabel: string;
	readonly targetIds: readonly string[];
	readonly generatedNodeIds: readonly string[];
	readonly editableArtifacts?: readonly AnimationClipEditableArtifactProvenance[];
};

export type AnimationClip = {
	readonly id: string;
	readonly name: string;
	readonly startFrame: number;
	readonly durationFrames: number;
	readonly trackIds: readonly string[];
	readonly provenance?: AnimationClipProvenance;
};

/**
 * The only timing rewrite accepted by the document-level live-MCP compound
 * path. Frame coordinates are the durable timeline address, so this operation
 * deliberately preserves them rather than converting through seconds.
 */
export type MotionTimingUpdateInput = {
	readonly fps: number;
	readonly durationFrames: number;
	readonly temporalPolicy: "preserve-frame-indices";
	readonly outOfRangePolicy: "reject";
};

/** A durable timing address that prevents a shorter document timeline. */
export type MotionTimingRangeIssue = {
	readonly path: string;
	readonly frame?: number;
	readonly endFrameExclusive?: number;
};

/**
 * Motion data is keyed by scene node id and never embedded in SceneDocument.
 * This keeps geometry and timing patches independent for parallel streams.
 */
export type MotionDocument = {
	readonly schemaVersion: 1;
	readonly fps: number;
	readonly durationFrames: number;
	readonly tracks: readonly KeyframeTrack[];
	/**
	 * Optional spatial geometry for paired X/Y position keys. This side-car never
	 * duplicates position values or temporal easing; invalid/orphaned entries fall
	 * back to ordinary scalar sampling with typed presentation issues.
	 */
	readonly positionPaths?: readonly PositionPathTrack[];
	/**
	 * Optional side-car of Look-graph node-param keyframe tracks. Additive and
	 * composed at sample time (like `automation`/`grammar`), so `schemaVersion`
	 * stays `1` and node-keyed `tracks` are untouched. Absent on documents with no
	 * animated look-node params.
	 */
	readonly lookNodeTracks?: readonly LookNodeParamTrack[];
	/**
	 * Optional numeric Source Optics parameter tracks. Static rig data remains in
	 * SceneDocument; this side-car overlays sampled values by stable owner id.
	 */
	readonly sourceOpticsTracks?: readonly SourceOpticsParameterTrack[];
	/**
	 * Optional authored scene-camera tracks. Additive and sampled at presentation
	 * time, so schemaVersion stays `1` and node-keyed tracks remain unchanged.
	 */
	readonly cameraTracks?: readonly CameraRigTrack[];
	/**
	 * Optional expression side-car for scene-camera rig channels. It sits next to
	 * `cameraTracks` because it shares that side-car's address and its owner: the
	 * rig, not a node. Additive and evaluated inside camera sampling, so
	 * `schemaVersion` stays `1` and every camera consumer (editor preview,
	 * playback, export presentation, and the runtime 3D camera adapter, which all
	 * read one `resolveSceneCameraProjection`) sees the same expressed value.
	 */
	readonly cameraChannelExpressions?: readonly CameraChannelExpression[];
	/**
	 * Optional hard camera-cut sequencing. Segments choose which authored scene
	 * camera reads an artboard at a frame; the artboard's active camera remains the
	 * fallback when no segment covers the frame.
	 */
	readonly cameraCuts?: readonly CameraCutSegment[];
	/**
	 * Optional published-control side-car for linked external productions. It
	 * mirrors `cameraTracks`: additive, sampled next to its owner rather than in
	 * presentation, and absent on every document that has never keyframed a
	 * control, so `schemaVersion` stays `1`.
	 */
	readonly productionControlTracks?: readonly ProductionControlTrack[];
	/**
	 * Optional text-animator side-car. Each binding turns one text node (or, later,
	 * an outline group) into per-fragment motion via a Range Selector. Additive and
	 * resolved at sample time like `lookNodeTracks`/`grammar`, so `schemaVersion`
	 * stays `1` and node-keyed `tracks` are untouched. Absent on documents with no
	 * text animators.
	 */
	readonly textAnimators?: readonly TextAnimatorBinding[];
	readonly clips: readonly AnimationClip[];
	/**
	 * Optional vec-core automation side-car. It is authored as timeline data, not
	 * scene state: presentation/export bridges compose it over resolved effect
	 * intent or node appearance at sample time.
	 */
	readonly automation?: AutomationRecipe;
	/**
	 * Optional motion-grammar authoring layer. Persisted alongside tracks/clips
	 * (round-trips byte-stably through `structuredClone` + stable JSON without a
	 * serializer change) but never read during sampling — the live sampling source
	 * is the grammar store's parsed bindings. Absent on documents authored before
	 * the grammar layer; `schemaVersion` stays `1` because the field is additive.
	 */
	readonly grammar?: SerializedMotionGrammarLayer;
};
