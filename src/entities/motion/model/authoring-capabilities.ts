import type { TextFragmentUnit } from "@/entities/scene/model/text-fragments";
import type { EntityAuthoringCapabilityManifest } from "@/shared/authoring-capability/model";
import type {
	AnimatableProperty,
	CameraCutTransitionKind,
	CameraRigAnimatableProperty,
	MotionDocument,
	PositionPathSpatialMode,
	TextAnimatorTarget,
	TextSelectorMode,
	TextSelectorShape,
} from "./types";

const motionCapability = <
	const TManifest extends Omit<EntityAuthoringCapabilityManifest, "owner">,
>(
	manifest: TManifest,
): TManifest & { readonly owner: "motion" } => ({
	...manifest,
	owner: "motion",
});

export const MOTION_AUTHORING_CAPABILITIES = [
	motionCapability({
		id: "motion.schema-version",
		label: "Motion schema version",
		classification: "system_managed",
		kind: "atomic",
		modelAnchorIds: ["MotionDocument.schemaVersion"],
		requiredOperations: ["read"],
		commandPlannerIds: [],
		classificationReason: "Serialization owns schema versions.",
	}),
	motionCapability({
		id: "motion.timing",
		label: "Timeline timing",
		classification: "authorable",
		kind: "timeline",
		modelAnchorIds: ["MotionDocument.fps", "MotionDocument.durationFrames"],
		requiredOperations: ["read", "update"],
		commandPlannerIds: ["updateMotionDocumentTiming"],
		presenceProbeId: "motion.timing",
	}),
	motionCapability({
		id: "motion.track.scalar",
		label: "Scalar keyframe tracks",
		classification: "authorable",
		kind: "timeline",
		modelAnchorIds: ["MotionDocument.tracks", "ScalarAnimatableProperty"],
		requiredOperations: ["read", "create", "update", "remove", "retime"],
		commandPlannerIds: [
			"motion/upsert-keyframe",
			"motion/remove-keyframe",
			"motion/retime-keyframe",
			"motion/set-easing",
		],
		presenceProbeId: "motion.track.scalar",
	}),
	motionCapability({
		id: "motion.track.path-shape",
		label: "Path-shape snapshot tracks",
		classification: "authorable",
		kind: "timeline",
		modelAnchorIds: ["MotionDocument.tracks", "AnimatableProperty.pathShape"],
		requiredOperations: ["read", "create", "update", "remove", "retime"],
		commandPlannerIds: ["motion/upsert-keyframe", "motion/remove-keyframe"],
		presenceProbeId: "motion.track.path-shape",
	}),
	motionCapability({
		id: "motion.track.mesh-paint",
		label: "Mesh-paint snapshot tracks",
		classification: "authorable",
		kind: "timeline",
		modelAnchorIds: ["MotionDocument.tracks", "AnimatableProperty.meshPaint"],
		requiredOperations: ["read", "create", "update", "remove", "retime"],
		commandPlannerIds: ["motion/upsert-keyframe", "motion/remove-keyframe"],
		presenceProbeId: "motion.track.mesh-paint",
	}),
	motionCapability({
		id: "motion.track.fill-gradient",
		label: "Fill-gradient snapshot tracks",
		classification: "authorable",
		kind: "timeline",
		modelAnchorIds: [
			"MotionDocument.tracks",
			"AnimatableProperty.fillGradient",
		],
		requiredOperations: ["read", "create", "update", "remove", "retime"],
		commandPlannerIds: ["motion/upsert-keyframe", "motion/remove-keyframe"],
		presenceProbeId: "motion.track.fill-gradient",
	}),
	motionCapability({
		id: "motion.position-path",
		label: "Spatial position paths",
		classification: "authorable",
		kind: "timeline",
		modelAnchorIds: ["MotionDocument.positionPaths", "PositionPathTrack"],
		requiredOperations: ["read", "create", "update", "remove", "retime"],
		commandPlannerIds: [
			"motion/update-position-path-key",
			"motion/set-position-path-mode",
			"motion/remove-position-path",
			"motion/retime-position-path-keyframe",
		],
		presenceProbeId: "motion.position-path",
	}),
	motionCapability({
		id: "motion.look-node-track",
		label: "Look-node parameter tracks",
		classification: "authorable",
		kind: "timeline",
		modelAnchorIds: ["MotionDocument.lookNodeTracks", "LookNodeParamTrack"],
		requiredOperations: ["read", "create", "update", "remove", "retime"],
		commandPlannerIds: [
			"motion/upsert-look-node-keyframe",
			"motion/remove-look-node-track",
		],
		presenceProbeId: "motion.look-node-track",
	}),
	motionCapability({
		id: "motion.source-optics-track",
		label: "Source Optics parameter tracks",
		classification: "authorable",
		kind: "timeline",
		modelAnchorIds: [
			"MotionDocument.sourceOpticsTracks",
			"SourceOpticsParameterTrack",
		],
		requiredOperations: ["read", "create", "update", "remove", "retime"],
		commandPlannerIds: [
			"motion/upsert-source-optics-keyframe",
			"motion/remove-source-optics-track",
		],
		presenceProbeId: "motion.source-optics-track",
	}),
	motionCapability({
		id: "motion.camera-track",
		label: "Scene-camera tracks",
		classification: "authorable",
		kind: "timeline",
		modelAnchorIds: [
			"MotionDocument.cameraTracks",
			"CameraRigTrack",
			"MotionDocument.cameraChannelExpressions",
			"CameraChannelExpression",
		],
		requiredOperations: ["read", "create", "update", "remove", "retime"],
		commandPlannerIds: [
			"motion/upsert-camera-keyframe",
			"motion/remove-camera-track",
			"motion/set-camera-channel-expression",
			"motion/remove-camera-channel-expression",
		],
		presenceProbeId: "motion.camera-track",
	}),
	motionCapability({
		id: "motion.production-control-track",
		label: "Published production control tracks",
		classification: "authorable",
		kind: "timeline",
		modelAnchorIds: [
			"MotionDocument.productionControlTracks",
			"ProductionControlTrack",
		],
		requiredOperations: ["read", "create", "update", "remove", "retime"],
		commandPlannerIds: [
			"motion/upsert-production-control-keyframe",
			"motion/remove-production-control-keyframe",
			"motion/retime-production-control-keyframe",
		],
		presenceProbeId: "motion.production-control-track",
	}),
	motionCapability({
		id: "motion.camera-cut",
		label: "Camera cuts",
		classification: "authorable",
		kind: "timeline",
		modelAnchorIds: ["MotionDocument.cameraCuts", "CameraCutSegment"],
		requiredOperations: [
			"read",
			"create",
			"update",
			"remove",
			"reorder",
			"retime",
		],
		commandPlannerIds: [
			"motion/upsert-camera-cut",
			"motion/retime-camera-cut",
			"motion/remove-camera-cut",
		],
		presenceProbeId: "motion.camera-cut",
	}),
	motionCapability({
		id: "motion.text-animator",
		label: "Text animators",
		classification: "authorable",
		kind: "timeline",
		modelAnchorIds: [
			"MotionDocument.textAnimators",
			"TextAnimatorBinding",
			"RangeTextSelector.offsetExpression",
		],
		requiredOperations: ["read", "create", "update", "remove"],
		commandPlannerIds: [
			"motion/set-text-animator",
			"motion/remove-text-animator",
			"motion/set-text-animator-offset-expression",
			"motion/remove-text-animator-offset-expression",
		],
		presenceProbeId: "motion.text-animator",
	}),
	motionCapability({
		id: "motion.clips",
		label: "Animation clips",
		classification: "authorable",
		kind: "timeline",
		modelAnchorIds: ["MotionDocument.clips", "AnimationClip"],
		requiredOperations: [
			"read",
			"create",
			"update",
			"remove",
			"reorder",
			"retime",
		],
		commandPlannerIds: [
			"motion/create-clip",
			"motion/rename-clip",
			"motion/trim-clip",
			"motion/delete-clip",
		],
		presenceProbeId: "motion.clips",
	}),
	motionCapability({
		id: "motion.automation",
		label: "Automation recipe",
		classification: "authorable",
		kind: "timeline",
		modelAnchorIds: ["MotionDocument.automation", "AutomationRecipe"],
		requiredOperations: ["read", "create", "update", "remove", "reorder"],
		commandPlannerIds: [
			"motion/create-automation-track",
			"motion/update-automation-track",
			"motion/remove-automation-track",
			"motion/reorder-automation-track",
			"motion/remove-automation",
		],
		presenceProbeId: "motion.automation",
	}),
	motionCapability({
		id: "motion.grammar-compatibility",
		label: "Serialized grammar compatibility layer",
		classification: "system_managed",
		kind: "structure",
		modelAnchorIds: ["MotionDocument.grammar", "SerializedMotionGrammarLayer"],
		requiredOperations: ["read"],
		commandPlannerIds: [],
		presenceProbeId: "motion.grammar-compatibility",
		classificationReason:
			"The Motion Grammar store owns edits; this field is its serialized compatibility projection.",
	}),
] as const satisfies readonly EntityAuthoringCapabilityManifest[];

export type MotionAuthoringCapabilityId =
	(typeof MOTION_AUTHORING_CAPABILITIES)[number]["id"];

export const MOTION_DOCUMENT_CAPABILITY_BY_KEY = {
	schemaVersion: "motion.schema-version",
	fps: "motion.timing",
	durationFrames: "motion.timing",
	tracks: "discriminant:AnimatableProperty",
	positionPaths: "motion.position-path",
	lookNodeTracks: "motion.look-node-track",
	sourceOpticsTracks: "motion.source-optics-track",
	cameraTracks: "motion.camera-track",
	cameraChannelExpressions: "motion.camera-track",
	productionControlTracks: "motion.production-control-track",
	cameraCuts: "motion.camera-cut",
	textAnimators: "motion.text-animator",
	clips: "motion.clips",
	automation: "motion.automation",
	grammar: "motion.grammar-compatibility",
} as const satisfies Record<
	keyof MotionDocument,
	MotionAuthoringCapabilityId | "discriminant:AnimatableProperty"
>;

export const ANIMATABLE_PROPERTY_CAPABILITY = {
	x: "motion.track.scalar",
	y: "motion.track.scalar",
	anchorX: "motion.track.scalar",
	anchorY: "motion.track.scalar",
	rotation: "motion.track.scalar",
	scaleX: "motion.track.scalar",
	scaleY: "motion.track.scalar",
	opacity: "motion.track.scalar",
	cornerRadius: "motion.track.scalar",
	cornerRadiusTL: "motion.track.scalar",
	cornerRadiusTR: "motion.track.scalar",
	cornerRadiusBR: "motion.track.scalar",
	cornerRadiusBL: "motion.track.scalar",
	cornerSmoothing: "motion.track.scalar",
	pathShape: "motion.track.path-shape",
	meshPaint: "motion.track.mesh-paint",
	fillGradient: "motion.track.fill-gradient",
} as const satisfies Record<AnimatableProperty, MotionAuthoringCapabilityId>;

export const CAMERA_PROPERTY_CAPABILITY = {
	bodyX: "motion.camera-track",
	bodyY: "motion.camera-track",
	bodyZ: "motion.camera-track",
	bodyRotationX: "motion.camera-track",
	bodyRotationY: "motion.camera-track",
	bodyRotationZ: "motion.camera-track",
	targetX: "motion.camera-track",
	targetY: "motion.camera-track",
	targetZ: "motion.camera-track",
	fovDegrees: "motion.camera-track",
	zoom: "motion.camera-track",
	focusDistance: "motion.camera-track",
	aperture: "motion.camera-track",
} as const satisfies Record<CameraRigAnimatableProperty, "motion.camera-track">;

export const POSITION_PATH_SPATIAL_MODE_CAPABILITY = {
	corner: "motion.position-path",
	continuous: "motion.position-path",
	auto: "motion.position-path",
} as const satisfies Record<PositionPathSpatialMode, "motion.position-path">;

export const CAMERA_CUT_TRANSITION_CAPABILITY = {
	cut: "motion.camera-cut",
	crossfade: "motion.camera-cut",
} as const satisfies Record<CameraCutTransitionKind, "motion.camera-cut">;

export const TEXT_SELECTOR_MODE_CAPABILITY = {
	add: "motion.text-animator",
	subtract: "motion.text-animator",
	intersect: "motion.text-animator",
	min: "motion.text-animator",
	max: "motion.text-animator",
} as const satisfies Record<TextSelectorMode, "motion.text-animator">;

export const TEXT_SELECTOR_SHAPE_CAPABILITY = {
	square: "motion.text-animator",
	"ramp-up": "motion.text-animator",
	"ramp-down": "motion.text-animator",
	smooth: "motion.text-animator",
} as const satisfies Record<TextSelectorShape, "motion.text-animator">;

export const TEXT_ANIMATOR_TARGET_CAPABILITY = {
	"live-text": "motion.text-animator",
	"outline-group": "motion.text-animator",
} as const satisfies Record<TextAnimatorTarget["kind"], "motion.text-animator">;

export const TEXT_FRAGMENT_UNIT_CAPABILITY = {
	grapheme: "motion.text-animator",
	character: "motion.text-animator",
	"character-no-spaces": "motion.text-animator",
	word: "motion.text-animator",
	line: "motion.text-animator",
} as const satisfies Record<TextFragmentUnit, "motion.text-animator">;
