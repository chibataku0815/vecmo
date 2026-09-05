import { CAMERA_RIG_ANIMATABLE_PROPERTIES } from "@/entities/motion/model/types";
import {
	BINDABLE_PROPERTY_SOURCE_KINDS,
	BINDABLE_PROPERTY_TARGET_SCOPES,
} from "@/entities/scene/model/bindable-property";
import {
	PIXEL_ART_MAX_HEIGHT,
	PIXEL_ART_MAX_PALETTE_SIZE,
	PIXEL_ART_MAX_WIDTH,
} from "@/entities/scene/model/pixel-art-object";
import {
	AGENT_CONTRACT_VERSION,
	AGENT_ISSUE_TARGET_KINDS,
	AGENT_TOOL_NAMES,
	AGENT_VALIDATION_SCOPES,
	type AgentApplyCameraCommandsRequest,
	type AgentApplyDocumentCommandsRequest,
	type AgentApplyMotionCommandsRequest,
	type AgentApplyMotionGrammarCommandsRequest,
	type AgentApplySceneCommandsRequest,
	type AgentCameraVerbCommand,
	type AgentDocumentCommand,
	type AgentEffectFieldOperation,
	type AgentIssue,
	type AgentIssueSeverity,
	type AgentIssueSummary,
	type AgentIssueTarget,
	type AgentListMotionGrammarRequest,
	type AgentLookGraphOwner,
	type AgentLookGraphTarget,
	type AgentMotionCommand,
	type AgentMotionGrammarCommand,
	type AgentObserveNodeRequest,
	type AgentProposeEditPlanRequest,
	type AgentRunValidationRequest,
	type AgentSceneCommand,
	type AgentToolName,
	type AgentToolRequest,
	type AgentToolResult,
	MUTATING_AGENT_TOOL_NAMES,
	type MutatingAgentToolName,
} from "./types";

const agentToolNames = new Set<string>(AGENT_TOOL_NAMES);
const mutatingAgentToolNames = new Set<string>(MUTATING_AGENT_TOOL_NAMES);
const agentIssueTargetKinds = new Set<string>(AGENT_ISSUE_TARGET_KINDS);
const agentValidationScopes = new Set<string>(AGENT_VALIDATION_SCOPES);
const bindablePropertyTargetScopes = new Set<string>(
	BINDABLE_PROPERTY_TARGET_SCOPES,
);
const bindablePropertySourceKinds = new Set<string>(
	BINDABLE_PROPERTY_SOURCE_KINDS,
);
const cameraRigAnimatableProperties = new Set<string>(
	CAMERA_RIG_ANIMATABLE_PROPERTIES,
);
const externalSceneAssetFormats = new Set<string>([
	"gltf",
	"glb",
	"three-scene-json",
	"module",
	"html",
	"unknown",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const isString = (value: unknown): value is string => typeof value === "string";

const isOptionalString = (value: unknown): value is string | undefined =>
	value === undefined || isString(value);

const isFiniteNumber = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

const isNonNegativeInteger = (value: unknown): value is number =>
	typeof value === "number" && Number.isInteger(value) && value >= 0;

const isBooleanOrUndefined = (value: unknown): value is boolean | undefined =>
	value === undefined || typeof value === "boolean";

const hasString = (record: Record<string, unknown>, key: string): boolean =>
	isString(record[key]) && record[key].length > 0;

const isFiniteNumberRecord = (value: unknown): boolean =>
	isRecord(value) && Object.values(value).every((item) => isFiniteNumber(item));

const isStringRecord = (value: unknown): boolean =>
	isRecord(value) && Object.values(value).every((item) => isString(item));

const isRandomPulseProfile = (value: unknown): boolean => {
	if (!isRecord(value) || value.version !== 1) return false;
	if (!isFiniteNumber(value.durationFrames) || !Array.isArray(value.segments)) {
		return false;
	}
	return value.segments.every(
		(segment) =>
			isRecord(segment) &&
			isFiniteNumber(segment.fromFrame) &&
			isFiniteNumber(segment.toFrame) &&
			isFiniteNumber(segment.fromValue) &&
			isFiniteNumber(segment.toValue) &&
			Array.isArray(segment.easing) &&
			segment.easing.length === 4 &&
			segment.easing.every((coordinate) => isFiniteNumber(coordinate)),
	);
};

const isArrangementMapping = (value: unknown): boolean => {
	if (!isRecord(value)) return false;
	if (
		!hasString(value, "sourceSnapshotId") ||
		!hasString(value, "destinationSnapshotId") ||
		!isStringRecord(value.sourceToStage) ||
		!isStringRecord(value.stageToDestination) ||
		!isRecord(value.stageSlots) ||
		Object.keys(value.stageSlots).length === 0 ||
		!isRecord(value.pivot) ||
		!isFiniteNumber(value.pivot.x) ||
		!isFiniteNumber(value.pivot.y)
	) {
		return false;
	}
	const stageSlots = value.stageSlots;
	if (
		!Object.values(stageSlots).every(
			(point) =>
				isRecord(point) && isFiniteNumber(point.x) && isFiniteNumber(point.y),
		)
	) {
		return false;
	}
	return (
		value.stagingDelayFractionBySource === undefined ||
		isFiniteNumberRecord(value.stagingDelayFractionBySource)
	);
};

const isBounds = (value: unknown): boolean =>
	isRecord(value) &&
	isFiniteNumber(value.x) &&
	isFiniteNumber(value.y) &&
	isFiniteNumber(value.width) &&
	isFiniteNumber(value.height);

const isVec2 = (value: unknown): boolean =>
	isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);

const isPositionPathSpatialMode = (value: unknown): boolean =>
	value === "corner" || value === "continuous" || value === "auto";

const isPositionPathKey = (value: unknown): boolean =>
	isRecord(value) &&
	isFiniteNumber(value.frame) &&
	isVec2(value.position) &&
	(value.inTangent === undefined || isVec2(value.inTangent)) &&
	(value.outTangent === undefined || isVec2(value.outTangent)) &&
	(value.spatialMode === undefined ||
		isPositionPathSpatialMode(value.spatialMode)) &&
	isBooleanOrUndefined(value.roving);

const isDotMatrixStyle = (value: unknown): boolean =>
	isRecord(value) &&
	(value.fill === undefined || isString(value.fill)) &&
	(value.stroke === undefined || isString(value.stroke)) &&
	(value.strokeWidth === undefined || isFiniteNumber(value.strokeWidth)) &&
	(value.opacity === undefined || isFiniteNumber(value.opacity)) &&
	Object.keys(value).every((key) =>
		["fill", "stroke", "strokeWidth", "opacity"].includes(key),
	);

const isSceneMediaSource = (value: unknown): boolean =>
	isRecord(value) &&
	((value.kind === "data-url" && isString(value.dataUrl)) ||
		(value.kind === "reference" && isString(value.href)));

const isOptionalNullableString = (
	value: unknown,
): value is string | null | undefined =>
	value === null || value === undefined || isString(value);

const isVec3Patch = (value: unknown): boolean =>
	isRecord(value) &&
	(value.x === undefined || isFiniteNumber(value.x)) &&
	(value.y === undefined || isFiniteNumber(value.y)) &&
	(value.z === undefined || isFiniteNumber(value.z));

const isAffineMatrix2D = (value: unknown): boolean =>
	isRecord(value) &&
	["a", "b", "c", "d", "e", "f"].every((key) => isFiniteNumber(value[key]));

const isSceneCameraProjectionPatch = (value: unknown): boolean =>
	isRecord(value) &&
	(value.kind === undefined ||
		value.kind === "orthographic" ||
		value.kind === "perspective") &&
	(value.fovDegrees === undefined || isFiniteNumber(value.fovDegrees)) &&
	(value.zoom === undefined || isFiniteNumber(value.zoom)) &&
	(value.focalLengthMm === undefined || isFiniteNumber(value.focalLengthMm)) &&
	(value.focusDistance === undefined || isFiniteNumber(value.focusDistance)) &&
	(value.aperture === undefined || isFiniteNumber(value.aperture)) &&
	(value.near === undefined || isFiniteNumber(value.near)) &&
	(value.far === undefined || isFiniteNumber(value.far));

const isCameraScope = (value: unknown): boolean =>
	isRecord(value) &&
	(value.kind === "scene" ||
		(value.kind === "artboard" && hasString(value, "artboardId")));

const isSceneCameraSpec = (value: unknown): boolean =>
	isRecord(value) &&
	isOptionalString(value.id) &&
	isOptionalString(value.name) &&
	isOptionalNullableString(value.artboardId) &&
	(value.targetPoint === undefined || isVec3Patch(value.targetPoint)) &&
	(value.bodyPosition === undefined || isVec3Patch(value.bodyPosition)) &&
	(value.projection === undefined ||
		isSceneCameraProjectionPatch(value.projection)) &&
	isOptionalNullableString(value.targetControllerNodeId);

const isSceneCameraRigPatch = (value: unknown): boolean =>
	isRecord(value) &&
	isOptionalString(value.name) &&
	(value.scope === undefined || isCameraScope(value.scope)) &&
	(value.projection === undefined ||
		isSceneCameraProjectionPatch(value.projection)) &&
	(value.body === undefined ||
		(isRecord(value.body) &&
			(value.body.position === undefined || isVec3Patch(value.body.position)) &&
			(value.body.rotation === undefined || isVec3Patch(value.body.rotation)) &&
			isOptionalNullableString(value.body.parentControllerNodeId))) &&
	(value.target === undefined ||
		value.target === null ||
		(isRecord(value.target) &&
			(value.target.point === undefined || isVec3Patch(value.target.point)) &&
			isOptionalNullableString(value.target.nodeId) &&
			isOptionalNullableString(value.target.parentControllerNodeId))) &&
	isOptionalNullableString(value.parentControllerNodeId);

const isSceneDepthPlaneSpec = (value: unknown): boolean =>
	isRecord(value) &&
	isFiniteNumber(value.z) &&
	(value.billboarding === undefined ||
		value.billboarding === "screen-facing" ||
		value.billboarding === "plane") &&
	isOptionalString(value.cameraRigId);

const isMotionControllerSpec = (value: unknown): boolean =>
	isRecord(value) &&
	isOptionalString(value.id) &&
	isOptionalString(value.name) &&
	isOptionalNullableString(value.artboardId) &&
	(value.position === undefined || isVec3Patch(value.position)) &&
	(value.handleRadius === undefined || isFiniteNumber(value.handleRadius)) &&
	isBooleanOrUndefined(value.visible);

const isMotionParentBindingSpec = (value: unknown): boolean =>
	isRecord(value) &&
	hasString(value, "parentNodeId") &&
	(value.bindMatrix === undefined || isAffineMatrix2D(value.bindMatrix));

const transformConstraintChannels = new Set(["position", "rotation", "scale"]);
const transformConstraintSpaces = new Set(["local", "world"]);
const relationNumericProperties = new Set([
	"style.opacity",
	"geometry.cornerRadius",
	"geometry.cornerSmoothing",
]);

const isTransformConstraintChannels = (value: unknown): boolean =>
	Array.isArray(value) &&
	value.length > 0 &&
	value.every(
		(channel) =>
			typeof channel === "string" && transformConstraintChannels.has(channel),
	);

const isPropertyRelationSpec = (value: unknown): boolean =>
	isRecord(value) &&
	hasString(value, "sourceNodeId") &&
	typeof value.sourceProperty === "string" &&
	relationNumericProperties.has(value.sourceProperty) &&
	typeof value.targetProperty === "string" &&
	relationNumericProperties.has(value.targetProperty) &&
	(value.id === undefined || isString(value.id)) &&
	(value.scale === undefined || isFiniteNumber(value.scale)) &&
	(value.offset === undefined || isFiniteNumber(value.offset)) &&
	(value.clamp === undefined ||
		(isRecord(value.clamp) &&
			isFiniteNumber(value.clamp.min) &&
			isFiniteNumber(value.clamp.max) &&
			value.clamp.min <= value.clamp.max));

const isExternalSceneAssetSpec = (value: unknown): boolean =>
	isRecord(value) &&
	(value.kind === "external-scene" ||
		value.kind === "model-3d" ||
		value.kind === "code-module") &&
	hasString(value, "name") &&
	isSceneMediaSource(value.source) &&
	isBounds(value.bounds) &&
	isOptionalString(value.assetId) &&
	isOptionalString(value.nodeId) &&
	isOptionalString(value.artboardId) &&
	(value.format === undefined ||
		(isString(value.format) && externalSceneAssetFormats.has(value.format))) &&
	isOptionalString(value.mimeType) &&
	(value.width === undefined || isFiniteNumber(value.width)) &&
	(value.height === undefined || isFiniteNumber(value.height)) &&
	isOptionalString(value.previewAssetId) &&
	(value.capabilities === undefined ||
		(Array.isArray(value.capabilities) &&
			value.capabilities.every(isString))) &&
	(value.issues === undefined ||
		(Array.isArray(value.issues) &&
			value.issues.every(
				(issue) =>
					isRecord(issue) &&
					(issue.severity === "info" ||
						issue.severity === "warning" ||
						issue.severity === "error") &&
					hasString(issue, "code") &&
					isOptionalString(issue.message),
			)));

const isCameraRigAnimatableProperty = (value: unknown): boolean =>
	isString(value) && cameraRigAnimatableProperties.has(value);

const isCameraVectorValue = (value: unknown): boolean =>
	isRecord(value) &&
	(value.x === undefined || isFiniteNumber(value.x)) &&
	(value.y === undefined || isFiniteNumber(value.y)) &&
	(value.z === undefined || isFiniteNumber(value.z));

const isCameraCutSegment = (value: unknown): boolean =>
	isRecord(value) &&
	hasString(value, "id") &&
	isOptionalString(value.name) &&
	hasString(value, "artboardId") &&
	hasString(value, "cameraRigId") &&
	isOptionalString(value.laneId) &&
	isFiniteNumber(value.startFrame) &&
	isFiniteNumber(value.durationFrames) &&
	(value.transition === "cut" || value.transition === "crossfade") &&
	(value.transitionDurationFrames === undefined ||
		isFiniteNumber(value.transitionDurationFrames)) &&
	(value.thumbnailFrame === undefined || isFiniteNumber(value.thumbnailFrame));

const isAgentIssueTarget = (value: unknown): value is AgentIssueTarget =>
	isRecord(value) &&
	isString(value.kind) &&
	agentIssueTargetKinds.has(value.kind) &&
	isOptionalString(value.id) &&
	isOptionalString(value.path);

const isBindableEffectTarget = (value: unknown): boolean => {
	if (!isRecord(value) || !isString(value.scope)) return false;
	switch (value.scope) {
		case "scene":
		case "current-artboard":
		case "default-artboard":
			return true;
		case "artboard":
			return hasString(value, "artboardId");
		default:
			return false;
	}
};

const isAgentLookGraphTarget = (
	value: unknown,
): value is AgentLookGraphTarget => {
	if (isBindableEffectTarget(value)) return true;
	return (
		isRecord(value) &&
		value.scope === "scoped-overlay" &&
		hasString(value, "artboardId") &&
		hasString(value, "scopedLookId")
	);
};

const isAgentLookGraphOwner = (
	value: unknown,
): value is AgentLookGraphOwner => {
	if (!isRecord(value)) return false;
	switch (value.scope) {
		case "scene":
			return true;
		case "artboard":
			return hasString(value, "artboardId");
		case "node":
			return hasString(value, "nodeId");
		case "scoped-overlay":
			return hasString(value, "artboardId") && hasString(value, "scopedLookId");
		default:
			return false;
	}
};

const isEffectLayerStackOperation = (value: unknown): boolean => {
	if (!isRecord(value) || !isString(value.kind)) return false;
	switch (value.kind) {
		case "add":
			return isRecord(value.layer) && hasString(value.layer, "id");
		case "update":
			return hasString(value, "layerId") && isRecord(value.patch);
		case "remove":
			return hasString(value, "layerId");
		case "reorder":
			return hasString(value, "layerId") && isFiniteNumber(value.toIndex);
		default:
			return false;
	}
};

const isLookGraphEndpoint = (value: unknown): boolean =>
	isRecord(value) && hasString(value, "nodeId") && hasString(value, "portId");

const isLookGraphOperation = (value: unknown): boolean => {
	if (!isRecord(value) || !isString(value.kind)) return false;
	switch (value.kind) {
		case "add-node":
			return isRecord(value.node) && hasString(value.node, "id");
		case "update-node":
			return hasString(value, "nodeId") && isRecord(value.patch);
		case "remove-node":
		case "set-output":
			return hasString(value, "nodeId");
		case "move-node":
			return hasString(value, "nodeId") && isRecord(value.position);
		case "connect":
			return isLookGraphEndpoint(value.from) && isLookGraphEndpoint(value.to);
		case "disconnect":
			return hasString(value, "edgeId");
		default:
			return false;
	}
};

const effectFieldSpaces = new Set(["scene", "target", "objectBoundingBox"]);

const isEffectFieldGradientStop = (value: unknown): boolean =>
	isRecord(value) &&
	isFiniteNumber(value.offset) &&
	isFiniteNumber(value.alpha);

const isEffectFieldSource = (value: unknown): boolean => {
	if (!isRecord(value) || !isString(value.kind)) return false;
	if (
		value.space !== undefined &&
		(!isString(value.space) || !effectFieldSpaces.has(value.space))
	) {
		return false;
	}
	switch (value.kind) {
		case "contourGradient":
			return (
				(value.width === undefined || isFiniteNumber(value.width)) &&
				(value.side === undefined ||
					value.side === "inside" ||
					value.side === "outside" ||
					value.side === "both")
			);
		case "linearGradient":
			return (
				(value.x1 === undefined || isFiniteNumber(value.x1)) &&
				(value.y1 === undefined || isFiniteNumber(value.y1)) &&
				(value.x2 === undefined || isFiniteNumber(value.x2)) &&
				(value.y2 === undefined || isFiniteNumber(value.y2)) &&
				(value.stops === undefined ||
					(Array.isArray(value.stops) &&
						value.stops.every(isEffectFieldGradientStop)))
			);
		case "fieldMesh":
			return (
				value.fieldMesh === undefined ||
				(isRecord(value.fieldMesh) &&
					isFiniteNumber(value.fieldMesh.rows) &&
					Number.isInteger(value.fieldMesh.rows) &&
					value.fieldMesh.rows >= 2 &&
					value.fieldMesh.rows <= 8 &&
					isFiniteNumber(value.fieldMesh.cols) &&
					Number.isInteger(value.fieldMesh.cols) &&
					value.fieldMesh.cols >= 2 &&
					value.fieldMesh.cols <= 8 &&
					Array.isArray(value.fieldMesh.points) &&
					value.fieldMesh.points.every(
						(point) =>
							isRecord(point) &&
							isFiniteNumber(point.x) &&
							isFiniteNumber(point.y) &&
							isFiniteNumber(point.value),
					))
			);
		default:
			return false;
	}
};

const isEffectFieldFalloff = (value: unknown): boolean =>
	isRecord(value) &&
	(value.kind === undefined ||
		value.kind === "linear" ||
		value.kind === "smoothstep" ||
		value.kind === "gamma" ||
		value.kind === "threshold") &&
	(value.inputMin === undefined || isFiniteNumber(value.inputMin)) &&
	(value.inputMax === undefined || isFiniteNumber(value.inputMax)) &&
	(value.gamma === undefined || isFiniteNumber(value.gamma)) &&
	(value.softness === undefined || isFiniteNumber(value.softness));

const isEffectFieldInfluence = (value: unknown): boolean =>
	isRecord(value) &&
	isEffectFieldSource(value.source) &&
	(value.enabled === undefined || typeof value.enabled === "boolean") &&
	(value.strength === undefined || isFiniteNumber(value.strength)) &&
	(value.invert === undefined || typeof value.invert === "boolean") &&
	(value.featherRadius === undefined || isFiniteNumber(value.featherRadius)) &&
	(value.falloff === undefined || isEffectFieldFalloff(value.falloff));

const isEffectFieldTargetRef = (value: unknown): boolean => {
	if (!isRecord(value) || !isString(value.scope)) return false;
	switch (value.scope) {
		case "scene":
			return value.id === undefined || isString(value.id);
		case "object":
		case "group":
		case "layer":
			return hasString(value, "id");
		default:
			return false;
	}
};

const isEffectFieldAssignment = (value: unknown): boolean =>
	isRecord(value) &&
	hasString(value, "id") &&
	isOptionalString(value.label) &&
	isEffectFieldTargetRef(value.target) &&
	isRecord(value.effect) &&
	hasString(value.effect, "id") &&
	hasString(value.effect, "path") &&
	isEffectFieldInfluence(value.influence) &&
	isOptionalString(value.fieldId);

const isEffectFieldInfluencePatch = (value: unknown): boolean =>
	isRecord(value) &&
	(value.enabled === undefined || typeof value.enabled === "boolean") &&
	(value.strength === undefined || isFiniteNumber(value.strength)) &&
	(value.invert === undefined || typeof value.invert === "boolean") &&
	(value.featherRadius === undefined || isFiniteNumber(value.featherRadius)) &&
	(value.falloff === undefined || isEffectFieldFalloff(value.falloff));

const isAgentEffectFieldOperation = (
	value: unknown,
): value is AgentEffectFieldOperation => {
	if (!isRecord(value) || !isString(value.kind)) return false;
	switch (value.kind) {
		case "upsert-field":
			return (
				isRecord(value.field) &&
				hasString(value.field, "id") &&
				isOptionalString(value.field.label) &&
				isEffectFieldSource(value.field.source)
			);
		case "remove-field":
			return hasString(value, "fieldId");
		case "attach-route":
			return isEffectFieldAssignment(value.assignment);
		case "remove-route":
		case "unlink-route":
			return hasString(value, "assignmentId");
		case "link-route":
			return hasString(value, "assignmentId") && hasString(value, "fieldId");
		case "replace-field-source":
			return hasString(value, "fieldId") && isEffectFieldSource(value.source);
		case "update-influence":
			return (
				hasString(value, "assignmentId") &&
				isEffectFieldInfluencePatch(value.patch)
			);
		default:
			return false;
	}
};

const isAgentObjectNoiseGradientLinearField = (value: unknown): boolean =>
	isRecord(value) &&
	isFiniteNumber(value.x1) &&
	isFiniteNumber(value.y1) &&
	isFiniteNumber(value.x2) &&
	isFiniteNumber(value.y2) &&
	(value.plateau === undefined || isFiniteNumber(value.plateau));

const isAgentVec2 = (value: unknown): boolean =>
	isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);

const isAgentGradientStop = (value: unknown): boolean =>
	isRecord(value) &&
	isOptionalString(value.id) &&
	isFiniteNumber(value.offset) &&
	isString(value.color) &&
	(value.opacity === undefined || isFiniteNumber(value.opacity));

/**
 * Shallow structural narrowing for `scene/author-object-noise-gradient`'s
 * `revealPaint`, mirroring the shallow-not-deep rigor `append-node`'s `style`
 * gets elsewhere in this file (a basic shape check; the real semantic reject
 * of image/mesh kinds and gradient-shape correctness happens in `write.ts`,
 * matching how `blendMode` is only string-checked here and enum-checked
 * there). Accepts solid/linear-gradient/radial-gradient only — the
 * `RevealPaint` model type already excludes image/mesh, so a caller sending
 * one of those kinds fails this guard rather than reaching write.ts.
 */
const isAgentRevealPaint = (value: unknown): boolean => {
	if (!isRecord(value)) return false;
	const opacityOk =
		value.opacity === undefined || isFiniteNumber(value.opacity);
	const visibleOk =
		value.visible === undefined || typeof value.visible === "boolean";
	if (!opacityOk || !visibleOk) return false;
	switch (value.kind) {
		case "solid":
			return isString(value.color);
		case "linear-gradient":
			return (
				isAgentVec2(value.from) &&
				isAgentVec2(value.to) &&
				Array.isArray(value.stops) &&
				value.stops.every(isAgentGradientStop)
			);
		case "radial-gradient":
			return (
				isAgentVec2(value.center) &&
				isAgentVec2(value.radius) &&
				Array.isArray(value.stops) &&
				value.stops.every(isAgentGradientStop)
			);
		default:
			return false;
	}
};

const isAgentAnimationClipSpec = (value: unknown): boolean =>
	isRecord(value) &&
	isOptionalString(value.id) &&
	isString(value.name) &&
	isFiniteNumber(value.startFrame) &&
	isFiniteNumber(value.durationFrames) &&
	(value.trackIds === undefined ||
		(Array.isArray(value.trackIds) && value.trackIds.every(isString)));

const isAgentKeyframeEasing = (value: unknown): boolean => {
	if (!isRecord(value) || !isString(value.kind)) return false;
	switch (value.kind) {
		case "template":
			return isString(value.templateId);
		case "preset":
			return isString(value.preset);
		case "custom":
			return (
				isFiniteNumber(value.x1) &&
				(value.y1 === undefined || isFiniteNumber(value.y1)) &&
				isFiniteNumber(value.x2) &&
				(value.y2 === undefined || isFiniteNumber(value.y2))
			);
		default:
			return false;
	}
};

const isAgentSceneCommand = (value: unknown): value is AgentSceneCommand => {
	if (!isRecord(value) || !isString(value.type)) return false;
	switch (value.type) {
		case "scene/rename-document":
			return hasString(value, "name");
		case "scene/reorder-artboard":
			return hasString(value, "artboardId") && isFiniteNumber(value.toIndex);
		case "scene/initialize-sequence":
			return isOptionalString(value.name);
		case "scene/update-sequence":
			return isRecord(value.patch);
		case "scene/update-sequence-item":
			return hasString(value, "itemId") && isRecord(value.patch);
		case "scene/reorder-sequence-item":
			return hasString(value, "itemId") && isFiniteNumber(value.toIndex);
		case "scene/remove-sequence-item":
			return hasString(value, "itemId");
		case "scene/remove-sequence":
			return true;
		case "scene/add-layer":
			return value.layer === undefined || isRecord(value.layer);
		case "scene/update-layer":
			return hasString(value, "layerId") && isRecord(value.patch);
		case "scene/remove-layer":
			return (
				hasString(value, "layerId") && isOptionalString(value.fallbackLayerId)
			);
		case "scene/rename-node":
			return hasString(value, "nodeId") && hasString(value, "name");
		case "scene/set-node-visibility":
			return hasString(value, "nodeId") && typeof value.visible === "boolean";
		case "scene/set-node-locked":
			return hasString(value, "nodeId") && typeof value.locked === "boolean";
		case "scene/update-node-geometry":
			return hasString(value, "nodeId") && isRecord(value.geometry);
		case "scene/create-blend":
			return (
				Array.isArray(value.sourceNodeIds) &&
				value.sourceNodeIds.every(isString)
			);
		case "scene/update-blend":
			return hasString(value, "blendNodeId") && isRecord(value.patch);
		case "scene/remove-blend":
			return hasString(value, "blendNodeId");
		case "scene/update-node-transform":
		case "scene/update-node-style":
		case "scene/update-text-node":
			return hasString(value, "nodeId") && isRecord(value.patch);
		case "scene/center-node-anchor":
			return hasString(value, "nodeId");
		case "scene/update-corner-radius":
			return hasString(value, "nodeId") && isFiniteNumber(value.cornerRadius);
		case "scene/update-rect-corner-radii":
			return hasString(value, "nodeId") && isRecord(value.radii);
		case "scene/update-corner-smoothing":
			return (
				hasString(value, "nodeId") && isFiniteNumber(value.cornerSmoothing)
			);
		case "scene/reorder-layer":
			return hasString(value, "layerId") && isFiniteNumber(value.toIndex);
		case "scene/reorder-node-within-layer":
			return (
				hasString(value, "layerId") &&
				hasString(value, "nodeId") &&
				isFiniteNumber(value.toIndex)
			);
		case "scene/append-node":
			return (
				isRecord(value.node) &&
				isRecord((value.node as Record<string, unknown>).geometry)
			);
		case "scene/set-duplicate-generator":
			return (
				isRecord(value.generator) &&
				hasString(value.generator, "sourceNodeId") &&
				hasString(value.generator, "count") &&
				(value.generator.seed === undefined ||
					isFiniteNumber(value.generator.seed)) &&
				(value.generator.instance === undefined ||
					(isRecord(value.generator.instance) &&
						isOptionalString(value.generator.instance.x) &&
						isOptionalString(value.generator.instance.y) &&
						isOptionalString(value.generator.instance.rotation)))
			);
		case "scene/append-dot-matrix":
			return (
				isRecord(value.matrix) &&
				isVec2(value.matrix.origin) &&
				Array.isArray(value.matrix.rows) &&
				value.matrix.rows.every(isString) &&
				isFiniteNumber(value.matrix.cellSize) &&
				(value.matrix.gap === undefined || isFiniteNumber(value.matrix.gap)) &&
				(value.matrix.name === undefined || isString(value.matrix.name)) &&
				(value.matrix.style === undefined ||
					isDotMatrixStyle(value.matrix.style)) &&
				isOptionalString(value.layerId)
			);
		case "scene/append-pixel-art-objects": {
			if (!isRecord(value.pixelArt)) return false;
			if (
				!isString(value.pixelArt.name) ||
				value.pixelArt.name.trim().length === 0 ||
				value.pixelArt.name.length > 160 ||
				!isVec2(value.pixelArt.origin) ||
				!Array.isArray(value.pixelArt.rows) ||
				value.pixelArt.rows.length === 0 ||
				value.pixelArt.rows.length > PIXEL_ART_MAX_HEIGHT ||
				!value.pixelArt.rows.every(isString)
			) {
				return false;
			}
			const rowWidth = value.pixelArt.rows[0]?.length ?? 0;
			return (
				rowWidth > 0 &&
				rowWidth <= PIXEL_ART_MAX_WIDTH &&
				value.pixelArt.rows.every((row) => row.length === rowWidth) &&
				Array.isArray(value.pixelArt.palette) &&
				value.pixelArt.palette.length > 0 &&
				value.pixelArt.palette.length <= PIXEL_ART_MAX_PALETTE_SIZE &&
				value.pixelArt.palette.every(
					(color) => isString(color) && /^#[0-9a-f]{6}$/i.test(color),
				) &&
				isFiniteNumber(value.pixelArt.pixelSize) &&
				Number.isInteger(value.pixelArt.pixelSize) &&
				value.pixelArt.pixelSize >= 1 &&
				value.pixelArt.pixelSize <= 32 &&
				(value.pixelArt.artboardId === undefined ||
					(isString(value.pixelArt.artboardId) &&
						value.pixelArt.artboardId.length > 0 &&
						value.pixelArt.artboardId.length <= 256)) &&
				isOptionalString(value.layerId)
			);
		}
		case "scene/place-external-asset":
			return (
				isExternalSceneAssetSpec(value.asset) && isOptionalString(value.layerId)
			);
		case "scene/add-scene-camera":
			return (
				isSceneCameraSpec(value.camera) &&
				isOptionalNullableString(value.activateArtboardId)
			);
		case "scene/update-scene-camera":
			return (
				hasString(value, "cameraRigId") && isSceneCameraRigPatch(value.patch)
			);
		case "scene/remove-scene-camera":
			return hasString(value, "cameraRigId");
		case "scene/set-active-scene-camera":
			return (
				hasString(value, "artboardId") &&
				(value.cameraRigId === null || hasString(value, "cameraRigId"))
			);
		case "scene/set-node-depth-plane":
			return (
				Array.isArray(value.nodeIds) &&
				value.nodeIds.every(isString) &&
				(value.depthPlane === null || isSceneDepthPlaneSpec(value.depthPlane))
			);
		case "scene/add-motion-controller":
			return (
				isMotionControllerSpec(value.controller) &&
				isOptionalString(value.layerId)
			);
		case "scene/upsert-asset":
			return (
				isRecord(value.asset) &&
				hasString(value.asset, "id") &&
				hasString(value.asset, "kind") &&
				hasString(value.asset, "name")
			);
		case "scene/place-asset":
			return (
				isRecord(value.placement) &&
				hasString(value.placement, "assetId") &&
				isRecord(value.placement.bounds)
			);
		case "scene/remove-unused-asset":
			return hasString(value, "assetId");
		case "scene/set-motion-controller":
			return (
				hasString(value, "nodeId") &&
				(value.controller === null ||
					(isRecord(value.controller) &&
						(value.controller.handleRadius === undefined ||
							isFiniteNumber(value.controller.handleRadius))))
			);
		case "scene/set-motion-parent":
			return (
				hasString(value, "nodeId") &&
				(value.binding === null || isMotionParentBindingSpec(value.binding)) &&
				(value.frame === undefined || isFiniteNumber(value.frame))
			);
		case "scene/set-transform-constraint":
			return (
				hasString(value, "nodeId") &&
				(value.sourceNodeId === null || hasString(value, "sourceNodeId")) &&
				(value.channels === undefined ||
					isTransformConstraintChannels(value.channels)) &&
				(value.strength === undefined || isFiniteNumber(value.strength)) &&
				(value.sourceSpace === undefined ||
					(typeof value.sourceSpace === "string" &&
						transformConstraintSpaces.has(value.sourceSpace))) &&
				(value.destinationSpace === undefined ||
					(typeof value.destinationSpace === "string" &&
						transformConstraintSpaces.has(value.destinationSpace))) &&
				isBooleanOrUndefined(value.maintainOffset) &&
				(value.frame === undefined || isFiniteNumber(value.frame))
			);
		case "scene/set-property-relation":
			return (
				hasString(value, "nodeId") &&
				(value.relation === null || isPropertyRelationSpec(value.relation)) &&
				(value.relationId === undefined || isString(value.relationId)) &&
				(value.relation !== null || hasString(value, "relationId"))
			);
		case "scene/bind-camera-target-node":
			return (
				hasString(value, "cameraRigId") &&
				(value.nodeId === null || hasString(value, "nodeId"))
			);
		case "scene/bind-camera-target-controller":
			return (
				hasString(value, "cameraRigId") &&
				(value.controllerNodeId === null ||
					hasString(value, "controllerNodeId"))
			);
		case "scene/bind-camera-body-controller":
			return (
				hasString(value, "cameraRigId") &&
				(value.controllerNodeId === null ||
					hasString(value, "controllerNodeId"))
			);
		case "scene/create-layout-frame":
			return (
				(value.parentNodeId === undefined ||
					value.parentNodeId === null ||
					typeof value.parentNodeId === "string") &&
				Array.isArray(value.sourceNodeIds) &&
				value.sourceNodeIds.every(isString)
			);
		case "scene/update-layout-frame":
			return hasString(value, "frameNodeId") && isRecord(value.patch);
		case "scene/set-layout-child-placement":
			return (
				hasString(value, "frameNodeId") &&
				hasString(value, "childNodeId") &&
				isRecord(value.placement)
			);
		case "scene/set-layout-children-placements":
			return (
				hasString(value, "frameNodeId") &&
				Array.isArray(value.placements) &&
				value.placements.every(
					(item) =>
						isRecord(item) &&
						hasString(item, "childNodeId") &&
						isRecord(item.placement),
				)
			);
		case "scene/apply-layout-preset":
			return hasString(value, "frameNodeId") && hasString(value, "preset");
		case "scene/pack-layout-frame":
			return hasString(value, "frameNodeId");
		case "scene/reapply-layout-frame":
			return (
				value.frameNodeId === undefined || typeof value.frameNodeId === "string"
			);
		case "scene/capture-arrangement-layout-snapshot":
			return (
				isRecord(value.snapshot) &&
				hasString(value.snapshot, "snapshotId") &&
				hasString(value.snapshot, "name") &&
				hasString(value.snapshot, "artboardId") &&
				hasString(value.snapshot, "captureToken") &&
				Array.isArray(value.snapshot.nodeIds) &&
				value.snapshot.nodeIds.every(isString)
			);
		case "scene/recapture-arrangement-layout-snapshot":
			return (
				isRecord(value.snapshot) &&
				hasString(value.snapshot, "snapshotId") &&
				hasString(value.snapshot, "captureToken") &&
				(value.snapshot.name === undefined || isString(value.snapshot.name)) &&
				(value.snapshot.nodeIds === undefined ||
					(Array.isArray(value.snapshot.nodeIds) &&
						value.snapshot.nodeIds.every(isString)))
			);
		case "scene/remove-arrangement-layout-snapshot":
			return hasString(value, "snapshotId");
		case "scene/delete-nodes":
			return Array.isArray(value.nodeIds) && value.nodeIds.every(isString);
		case "scene/set-mask-relation-property":
			return (
				hasString(value, "contentNodeId") &&
				hasString(value, "relationId") &&
				hasString(value, "propertyId") &&
				isFiniteNumber(value.value)
			);
		case "scene/set-bindable-property":
			return (
				hasString(value, "nodeId") &&
				hasString(value, "propertyId") &&
				isFiniteNumber(value.value)
			);
		case "scene/set-bindable-expression":
			return (
				hasString(value, "nodeId") &&
				hasString(value, "propertyId") &&
				hasString(value, "expression")
			);
		case "scene/clear-bindable-expression":
			return hasString(value, "nodeId") && hasString(value, "propertyId");
		case "scene/set-bindable-effect-property":
			return (
				isBindableEffectTarget(value.target) &&
				hasString(value, "propertyId") &&
				isFiniteNumber(value.value)
			);
		case "scene/set-bindable-effect-expression":
			return (
				isBindableEffectTarget(value.target) &&
				hasString(value, "propertyId") &&
				hasString(value, "expression")
			);
		case "scene/clear-bindable-effect-expression":
			return (
				isBindableEffectTarget(value.target) && hasString(value, "propertyId")
			);
		case "scene/patch-effect-stack":
			return (
				isBindableEffectTarget(value.target) &&
				isEffectLayerStackOperation(value.operation)
			);
		case "scene/patch-effect-field":
			return (
				isBindableEffectTarget(value.target) &&
				isAgentEffectFieldOperation(value.operation)
			);
		case "scene/set-effect-layer-property":
			return (
				isBindableEffectTarget(value.target) &&
				hasString(value, "layerId") &&
				hasString(value, "propertyId") &&
				isFiniteNumber(value.value)
			);
		case "scene/patch-look-graph":
			return (
				isAgentLookGraphTarget(value.target) &&
				isLookGraphOperation(value.operation)
			);
		case "scene/mark-text-fragments":
			return (
				hasString(value, "groupId") &&
				(value.unit === undefined || isString(value.unit))
			);
		case "scene/remove-duplicate-generator":
			return hasString(value, "nodeId");
		case "scene/add-artboard":
			return (
				isRecord(value.artboard) &&
				isFiniteNumber(value.artboard.width) &&
				isFiniteNumber(value.artboard.height)
			);
		case "scene/update-artboard":
			return hasString(value, "artboardId") && isRecord(value.patch);
		case "scene/add-source-optics-rig":
			return (
				hasString(value, "artboardId") &&
				hasString(value, "sourceNodeId") &&
				isOptionalString(value.id) &&
				isOptionalString(value.name)
			);
		case "scene/update-source-optics-rig":
			return (
				hasString(value, "artboardId") &&
				hasString(value, "rigId") &&
				isRecord(value.patch)
			);
		case "scene/remove-source-optics-rig":
			return hasString(value, "artboardId") && hasString(value, "rigId");
		case "scene/bind-source-optics-response":
			return (
				hasString(value, "artboardId") &&
				hasString(value, "rigId") &&
				hasString(value, "targetNodeId") &&
				isOptionalString(value.id) &&
				(value.response === undefined || isRecord(value.response))
			);
		case "scene/update-source-optics-response":
			return (
				hasString(value, "artboardId") &&
				hasString(value, "rigId") &&
				hasString(value, "bindingId") &&
				isRecord(value.patch)
			);
		case "scene/unbind-source-optics-response":
			return (
				hasString(value, "artboardId") &&
				hasString(value, "rigId") &&
				hasString(value, "bindingId")
			);
		case "scene/remove-artboard":
			return (
				hasString(value, "artboardId") &&
				isOptionalString(value.fallbackArtboardId)
			);
		case "scene/set-current-artboard":
			return hasString(value, "artboardId");
		case "scene/reparent-nodes":
			return (
				Array.isArray(value.nodeIds) &&
				value.nodeIds.every(isString) &&
				(value.targetParentNodeId === null ||
					isString(value.targetParentNodeId)) &&
				isOptionalString(value.targetLayerId) &&
				(value.toIndex === undefined || isFiniteNumber(value.toIndex))
			);
		case "scene/frame-nodes":
			return (
				Array.isArray(value.sourceNodeIds) &&
				value.sourceNodeIds.every(isString) &&
				isOptionalString(value.layerId) &&
				isOptionalString(value.frameNodeId) &&
				isOptionalString(value.name) &&
				isBooleanOrUndefined(value.clipsContent) &&
				isOptionalString(value.artboardId)
			);
		case "scene/unframe-node":
			return hasString(value, "frameNodeId");
		case "scene/group-nodes":
			return Array.isArray(value.nodeIds) && value.nodeIds.every(isString);
		case "scene/ungroup-node":
			return hasString(value, "groupNodeId");
		case "scene/use-node-as-mask":
			return (
				hasString(value, "maskNodeId") &&
				Array.isArray(value.contentNodeIds) &&
				value.contentNodeIds.every(isString) &&
				(value.kind === undefined ||
					value.kind === "clip-path" ||
					value.kind === "mask" ||
					value.kind === "soft-mask")
			);
		case "scene/author-object-noise-gradient":
			return (
				hasString(value, "nodeId") &&
				(value.fieldMode === undefined ||
					value.fieldMode === "contour" ||
					value.fieldMode === "linear" ||
					value.fieldMode === "mesh") &&
				(value.linearField === undefined ||
					isAgentObjectNoiseGradientLinearField(value.linearField)) &&
				(value.amount === undefined || isFiniteNumber(value.amount)) &&
				(value.grainStrength === undefined ||
					isFiniteNumber(value.grainStrength)) &&
				(value.materialStrength === undefined ||
					isFiniteNumber(value.materialStrength)) &&
				(value.particleContrast === undefined ||
					isFiniteNumber(value.particleContrast)) &&
				(value.blendMode === undefined || isString(value.blendMode)) &&
				(value.mode === undefined ||
					value.mode === "particle" ||
					value.mode === "mixed") &&
				(value.overlayColor === undefined || isString(value.overlayColor)) &&
				(value.revealPaint === undefined ||
					isAgentRevealPaint(value.revealPaint))
			);
		case "scene/release-mask":
			return hasString(value, "maskNodeId");
		case "scene/set-mask-relation-settings":
			return (
				hasString(value, "contentNodeId") &&
				isString(value.kind) &&
				isOptionalString(value.maskNodeId) &&
				isOptionalString(value.value) &&
				isOptionalString(value.relationId) &&
				(value.settings === undefined || isRecord(value.settings))
			);
		case "scene/add-style-preset":
			return (
				(value.options === undefined || isRecord(value.options)) &&
				isOptionalString(value.label)
			);
		case "scene/insert-style-preset":
			return isRecord(value.preset) && hasString(value.preset, "id");
		case "scene/apply-style-preset":
			return (
				hasString(value, "presetId") &&
				Array.isArray(value.nodeIds) &&
				value.nodeIds.every(isString) &&
				isOptionalString(value.label)
			);
		case "scene/rename-style-preset":
			return hasString(value, "presetId") && hasString(value, "name");
		case "scene/replace-style-preset":
			return hasString(value, "presetId") && isRecord(value.options);
		case "scene/update-style-preset-typography":
			return hasString(value, "presetId") && isRecord(value.typography);
		case "scene/remove-style-preset":
			return hasString(value, "presetId");
		case "scene/reorder-style-preset":
			return hasString(value, "presetId") && isFiniteNumber(value.toIndex);
		case "scene/apply-path-operation":
			return (
				isString(value.operation) &&
				(value.operation === "union" ||
					value.operation === "subtract" ||
					value.operation === "intersect" ||
					value.operation === "exclude") &&
				Array.isArray(value.nodeIds) &&
				value.nodeIds.every(isString)
			);
		case "scene/create-component-source":
			return (
				hasString(value, "sourceNodeId") &&
				(value.options === undefined || isRecord(value.options)) &&
				isOptionalString(value.label)
			);
		case "scene/insert-component-instance-from-symbol":
			return (
				hasString(value, "symbolId") &&
				(value.options === undefined || isRecord(value.options)) &&
				isOptionalString(value.label)
			);
		case "scene/set-component-timing-offset":
			return (
				hasString(value, "instanceRootNodeId") &&
				isFiniteNumber(value.offsetFrames) &&
				isOptionalString(value.label)
			);
		case "scene/detach-component-instance":
			return (
				hasString(value, "instanceRootNodeId") && isOptionalString(value.label)
			);
		case "scene/apply-component-override":
			return (
				hasString(value, "instanceRootNodeId") &&
				hasString(value, "instanceNodeId") &&
				isRecord(value.override) &&
				isString(value.override.kind) &&
				isOptionalString(value.label)
			);
		case "scene/reset-component-override":
			return (
				hasString(value, "instanceRootNodeId") &&
				(value.filter === undefined || isRecord(value.filter)) &&
				isOptionalString(value.label)
			);
		case "scene/add-component-prop":
			return isRecord(value.options) && isOptionalString(value.label);
		case "scene/update-component-prop":
			return (
				hasString(value, "propId") &&
				isRecord(value.patch) &&
				isOptionalString(value.label)
			);
		case "scene/remove-component-prop":
			return hasString(value, "propId") && isOptionalString(value.label);
		case "scene/add-interaction":
			return isRecord(value.options) && isOptionalString(value.label);
		case "scene/update-interaction":
			return (
				hasString(value, "interactionId") &&
				isRecord(value.patch) &&
				isOptionalString(value.label)
			);
		case "scene/remove-interaction":
			return hasString(value, "interactionId") && isOptionalString(value.label);
		default:
			return false;
	}
};

const isSourceOpticsParameterTarget = (value: unknown): boolean => {
	if (
		!isRecord(value) ||
		!hasString(value, "artboardId") ||
		!hasString(value, "rigId") ||
		!hasString(value, "parameterId")
	) {
		return false;
	}
	if (value.kind === "rig") return true;
	if (value.kind === "ray") return hasString(value, "rayId");
	if (value.kind === "binding") return hasString(value, "bindingId");
	return false;
};

const isAutomationEffectTarget = (value: unknown): boolean =>
	isRecord(value) &&
	(value.scope === "scene" ||
		value.scope === "selection" ||
		value.scope === "group" ||
		value.scope === "object" ||
		value.scope === "layer") &&
	(value.id === undefined || isString(value.id));

const isAutomationEffectSlot = (value: unknown): boolean =>
	isRecord(value) &&
	hasString(value, "id") &&
	hasString(value, "path") &&
	(value.label === undefined || isString(value.label));

const isMotionGrammarEffectBinding = (value: unknown): boolean => {
	if (!isRecord(value) || !isString(value.kind)) return false;
	switch (value.kind) {
		case "none":
			return true;
		case "active-target-influence":
			return (
				isAutomationEffectSlot(value.effect) &&
				(value.targetScope === undefined ||
					value.targetScope === "scene" ||
					value.targetScope === "selection" ||
					value.targetScope === "group" ||
					value.targetScope === "object" ||
					value.targetScope === "layer") &&
				(value.strength === undefined || isFiniteNumber(value.strength))
			);
		case "automation-param":
			return (
				isAutomationEffectSlot(value.effect) &&
				hasString(value, "path") &&
				(value.mode === undefined ||
					value.mode === "additive" ||
					value.mode === "replace")
			);
		case "temporal-echo":
			return (
				isFiniteNumber(value.copies) &&
				isFiniteNumber(value.delayFrames) &&
				isFiniteNumber(value.decay)
			);
		default:
			return false;
	}
};

const isAutomationBinding = (value: unknown): boolean => {
	if (!isRecord(value) || !hasString(value, "channel")) return false;
	if (value.channel === "effectInfluence") {
		return hasString(value, "assignmentId") && hasString(value, "path");
	}
	if (value.channel === "effectParam") {
		return (
			isAutomationEffectTarget(value.target) &&
			isAutomationEffectSlot(value.effect) &&
			hasString(value, "path")
		);
	}
	if (value.channel === "transform") {
		return isAutomationEffectTarget(value.target) && hasString(value, "path");
	}
	return false;
};

const isAutomationTrack = (value: unknown): boolean =>
	isRecord(value) &&
	isAutomationBinding(value.binding) &&
	(value.mode === undefined ||
		value.mode === "additive" ||
		value.mode === "replace") &&
	Array.isArray(value.keyframes) &&
	value.keyframes.length > 0 &&
	value.keyframes.every(
		(keyframe) =>
			isRecord(keyframe) &&
			isFiniteNumber(keyframe.frame) &&
			isFiniteNumber(keyframe.value) &&
			(keyframe.easing === undefined ||
				keyframe.easing === "linear" ||
				keyframe.easing === "easeInOut" ||
				keyframe.easing === "hold"),
	);

const isAgentMotionCommand = (value: unknown): value is AgentMotionCommand => {
	if (!isRecord(value) || !isString(value.type)) return false;
	switch (value.type) {
		case "motion/apply-clip-timing-template":
			return hasString(value, "clipId") && hasString(value, "templateId");
		case "motion/repair-path-morph-topology":
			return hasString(value, "trackId");
		case "motion/set-path-morph-first-vertex":
			return (
				hasString(value, "trackId") &&
				isFiniteNumber(value.frame) &&
				isFiniteNumber(value.firstVertexIndex)
			);
		case "motion/reverse-path-morph-winding":
			return hasString(value, "trackId") && isFiniteNumber(value.frame);
		case "motion/enable-position-path":
			return (
				hasString(value, "nodeId") &&
				Array.isArray(value.keys) &&
				value.keys.length >= 2 &&
				value.keys.every(isPositionPathKey)
			);
		case "motion/update-position-path-key":
			return (
				hasString(value, "nodeId") &&
				isFiniteNumber(value.frame) &&
				(value.inTangent === undefined || isVec2(value.inTangent)) &&
				(value.outTangent === undefined || isVec2(value.outTangent)) &&
				(value.spatialMode === undefined ||
					isPositionPathSpatialMode(value.spatialMode)) &&
				isBooleanOrUndefined(value.roving)
			);
		case "motion/retime-position-path-key":
			return (
				hasString(value, "nodeId") &&
				isFiniteNumber(value.fromFrame) &&
				isFiniteNumber(value.toFrame)
			);
		case "motion/set-source-optics-keyframe":
			return (
				isSourceOpticsParameterTarget(value.target) &&
				isFiniteNumber(value.frame) &&
				isFiniteNumber(value.value)
			);
		case "motion/remove-source-optics-keyframe":
			return (
				isSourceOpticsParameterTarget(value.target) &&
				isFiniteNumber(value.frame)
			);
		case "motion/upsert-keyframe":
			return (
				hasString(value, "nodeId") &&
				isString(value.property) &&
				isFiniteNumber(value.frame) &&
				value.value !== undefined &&
				(value.easing === undefined || isAgentKeyframeEasing(value.easing))
			);
		case "motion/set-keyframe-easing":
			return (
				hasString(value, "trackId") &&
				isFiniteNumber(value.frame) &&
				isAgentKeyframeEasing(value.easing)
			);
		case "motion/retime-keyframe":
			return (
				hasString(value, "trackId") &&
				isFiniteNumber(value.fromFrame) &&
				isFiniteNumber(value.toFrame)
			);
		case "motion/remove-keyframe":
			return hasString(value, "trackId") && isFiniteNumber(value.frame);
		case "motion/remove-track":
			return hasString(value, "trackId");
		case "motion/set-bindable-keyframe":
			return (
				hasString(value, "nodeId") &&
				hasString(value, "propertyId") &&
				isFiniteNumber(value.frame) &&
				isFiniteNumber(value.value)
			);
		case "motion/upsert-look-node-keyframe":
			return (
				hasString(value, "lookNodeId") &&
				hasString(value, "paramKey") &&
				isFiniteNumber(value.frame) &&
				isFiniteNumber(value.value) &&
				(value.expectedTargetNodeIds === undefined ||
					(Array.isArray(value.expectedTargetNodeIds) &&
						value.expectedTargetNodeIds.every(isString))) &&
				((value.owner === undefined &&
					(value.artboardId === undefined || isString(value.artboardId))) ||
					(isAgentLookGraphOwner(value.owner) &&
						value.artboardId === undefined))
			);
		case "motion/remove-look-node-track":
			return (
				hasString(value, "lookNodeId") &&
				hasString(value, "paramKey") &&
				isAgentLookGraphOwner(value.owner) &&
				(value.expectedTargetNodeIds === undefined ||
					(Array.isArray(value.expectedTargetNodeIds) &&
						value.expectedTargetNodeIds.every(isString)))
			);
		case "motion/upsert-camera-keyframe":
			return (
				hasString(value, "cameraRigId") &&
				isCameraRigAnimatableProperty(value.property) &&
				isFiniteNumber(value.frame) &&
				isFiniteNumber(value.value)
			);
		case "motion/set-camera-channel-expression":
			return (
				hasString(value, "cameraRigId") &&
				isCameraRigAnimatableProperty(value.channel) &&
				hasString(value, "expression")
			);
		case "motion/remove-camera-channel-expression":
			return (
				hasString(value, "cameraRigId") &&
				isCameraRigAnimatableProperty(value.channel)
			);
		case "motion/set-text-animator-offset-expression":
			return (
				hasString(value, "bindingId") &&
				isNonNegativeInteger(value.selectorIndex) &&
				hasString(value, "expression")
			);
		case "motion/remove-text-animator-offset-expression":
			return (
				hasString(value, "bindingId") &&
				isNonNegativeInteger(value.selectorIndex)
			);
		case "motion/upsert-production-control-keyframe":
			return (
				hasString(value, "linkId") &&
				hasString(value, "controlId") &&
				isFiniteNumber(value.frame) &&
				isFiniteNumber(value.value)
			);
		case "motion/remove-production-control-keyframe":
			return (
				hasString(value, "linkId") &&
				hasString(value, "controlId") &&
				isFiniteNumber(value.frame)
			);
		case "motion/retime-production-control-keyframe":
			return (
				hasString(value, "linkId") &&
				hasString(value, "controlId") &&
				isFiniteNumber(value.fromFrame) &&
				isFiniteNumber(value.toFrame)
			);
		case "motion/upsert-camera-vector-keyframes":
			return (
				hasString(value, "cameraRigId") &&
				(value.kind === "body" ||
					value.kind === "target" ||
					value.kind === "bodyRotation") &&
				isFiniteNumber(value.frame) &&
				isCameraVectorValue(value.value)
			);
		case "motion/remove-camera-keyframe":
			return (
				hasString(value, "cameraRigId") &&
				isCameraRigAnimatableProperty(value.property) &&
				isFiniteNumber(value.frame)
			);
		case "motion/remove-camera-track":
			return (
				hasString(value, "cameraRigId") &&
				isCameraRigAnimatableProperty(value.property)
			);
		case "motion/remove-camera-rig-tracks":
			return hasString(value, "cameraRigId");
		case "motion/upsert-camera-cut":
			return isCameraCutSegment(value.segment);
		case "motion/retime-camera-cut":
			return (
				hasString(value, "segmentId") &&
				(value.startFrame === undefined || isFiniteNumber(value.startFrame)) &&
				(value.durationFrames === undefined ||
					isFiniteNumber(value.durationFrames))
			);
		case "motion/remove-camera-cut":
			return hasString(value, "segmentId");
		case "motion/retime-camera-keyframe":
			return (
				hasString(value, "trackId") &&
				isFiniteNumber(value.fromFrame) &&
				isFiniteNumber(value.toFrame)
			);
		case "motion/set-camera-keyframe-easing":
			return (
				hasString(value, "trackId") &&
				isFiniteNumber(value.frame) &&
				isAgentKeyframeEasing(value.easing)
			);
		case "motion/apply-text-animator":
			return (
				hasString(value, "nodeId") &&
				isString(value.preset) &&
				(value.target === undefined || isString(value.target)) &&
				(value.durationFrames === undefined ||
					isFiniteNumber(value.durationFrames))
			);
		case "motion/remove-text-animator":
			return hasString(value, "nodeId");
		case "motion/set-text-animator-enabled":
			return hasString(value, "nodeId") && typeof value.enabled === "boolean";
		case "motion/create-clip":
			return isAgentAnimationClipSpec(value.clip);
		case "motion/rename-clip":
			return hasString(value, "clipId") && isString(value.name);
		case "motion/trim-clip":
			return (
				hasString(value, "clipId") &&
				isFiniteNumber(value.startFrame) &&
				isFiniteNumber(value.durationFrames)
			);
		case "motion/assign-clip-tracks":
			return (
				hasString(value, "clipId") &&
				Array.isArray(value.trackIds) &&
				value.trackIds.every(isString)
			);
		case "motion/reorder-clip":
			return hasString(value, "clipId") && isFiniteNumber(value.toIndex);
		case "motion/delete-clip":
			return hasString(value, "clipId");
		case "motion/create-automation-track":
			return isAutomationTrack(value.track);
		case "motion/update-automation-track":
			return isFiniteNumber(value.trackIndex) && isAutomationTrack(value.track);
		case "motion/remove-automation-track":
			return isFiniteNumber(value.trackIndex);
		case "motion/reorder-automation-track":
			return isFiniteNumber(value.trackIndex) && isFiniteNumber(value.toIndex);
		case "motion/set-automation-enabled":
			return typeof value.enabled === "boolean";
		case "motion/remove-automation":
			return true;
		case "motion/propagate-to-instances":
			return (
				value.sourceNodeIds === undefined ||
				(Array.isArray(value.sourceNodeIds) &&
					value.sourceNodeIds.every(isString))
			);
		default:
			return false;
	}
};

const isAgentMotionGrammarCommand = (
	value: unknown,
): value is AgentMotionGrammarCommand => {
	if (!isRecord(value) || !isString(value.type)) return false;
	switch (value.type) {
		case "motion-grammar/apply-technique":
			return (
				hasString(value, "techniqueId") &&
				Array.isArray(value.targetIds) &&
				value.targetIds.every(isString) &&
				(value.bindingId === undefined || isString(value.bindingId)) &&
				(value.roleMap === undefined || isStringRecord(value.roleMap)) &&
				(value.parameters === undefined ||
					isFiniteNumberRecord(value.parameters)) &&
				(value.arrangementMapping === undefined ||
					isArrangementMapping(value.arrangementMapping)) &&
				(value.seed === undefined || isFiniteNumber(value.seed)) &&
				(value.randomPulseProfile === undefined ||
					isRandomPulseProfile(value.randomPulseProfile))
			);
		case "motion-grammar/apply-afterimage-selected-sources":
			return (
				Array.isArray(value.selectedSourceNodeIds) &&
				value.selectedSourceNodeIds.every(isString) &&
				hasString(value, "bindingId") &&
				(value.parameters === undefined ||
					isFiniteNumberRecord(value.parameters))
			);
		case "motion-grammar/update-parameters":
			return (
				hasString(value, "bindingId") &&
				isFiniteNumberRecord(value.parameters) &&
				(value.seed === undefined || isFiniteNumber(value.seed))
			);
		case "motion-grammar/update-binding":
			return (
				hasString(value, "bindingId") &&
				(value.targetIds === undefined ||
					(Array.isArray(value.targetIds) &&
						value.targetIds.every(isString))) &&
				(value.roleMap === undefined ||
					value.roleMap === null ||
					isStringRecord(value.roleMap)) &&
				(value.arrangementMapping === undefined ||
					value.arrangementMapping === null ||
					isArrangementMapping(value.arrangementMapping)) &&
				(value.randomPulseProfile === undefined ||
					value.randomPulseProfile === null ||
					isRandomPulseProfile(value.randomPulseProfile)) &&
				(value.seed === undefined ||
					value.seed === null ||
					isFiniteNumber(value.seed)) &&
				(value.effectBinding === undefined ||
					value.effectBinding === null ||
					isMotionGrammarEffectBinding(value.effectBinding))
			);
		case "motion-grammar/reorder-binding":
			return hasString(value, "bindingId") && isFiniteNumber(value.toIndex);
		case "motion-grammar/remove-binding":
			return hasString(value, "bindingId");
		case "motion-grammar/propagate-to-instances":
			return (
				value.sourceNodeIds === undefined ||
				(Array.isArray(value.sourceNodeIds) &&
					value.sourceNodeIds.every(isString))
			);
		default:
			return false;
	}
};

/**
 * Runtime narrowing guard for the `camera/*` agent command family. Exported as
 * contract-ready surface: `check:agent-contract` keeps its kinds in sync with
 * the type union, compile switch, and Zod schema, and a future propose/live
 * transport can consume it directly. Framing fields (`artboardId`/`startFrame`/
 * `durationFrames`) are optional on every verb; the planner owns defaults.
 */
export const isAgentCameraVerbCommand = (
	value: unknown,
): value is AgentCameraVerbCommand => {
	if (!isRecord(value) || !isString(value.type)) return false;
	const isStringArray = (input: unknown): boolean =>
		Array.isArray(input) && input.every(isString);
	const isOptionalStringArray = (input: unknown): boolean =>
		input === undefined || isStringArray(input);
	const framing =
		isOptionalString(value.artboardId) &&
		(value.startFrame === undefined || isFiniteNumber(value.startFrame)) &&
		(value.durationFrames === undefined ||
			isFiniteNumber(value.durationFrames));
	switch (value.type) {
		case "camera/push-in":
			return (
				framing &&
				isStringArray(value.subjectIds) &&
				(value.mode === undefined ||
					value.mode === "zoom" ||
					value.mode === "dolly")
			);
		case "camera/parallax-establish":
			return (
				framing &&
				isOptionalStringArray(value.near) &&
				isOptionalStringArray(value.mid) &&
				isOptionalStringArray(value.far)
			);
		case "camera/orbit":
			return (
				framing &&
				isStringArray(value.subjectIds) &&
				(value.sweepDegrees === undefined || isFiniteNumber(value.sweepDegrees))
			);
		default:
			return false;
	}
};

const isAgentDocumentCommand = (
	value: unknown,
): value is AgentDocumentCommand => {
	if (!isRecord(value) || !isString(value.type)) return false;
	switch (value.type) {
		case "document/update-timing":
			return (
				hasString(value, "artboardId") &&
				isFiniteNumber(value.fps) &&
				isFiniteNumber(value.durationFrames) &&
				value.temporalPolicy === "preserve-frame-indices" &&
				value.outOfRangePolicy === "reject"
			);
		case "document/apply-stroke-draw-on":
			return (
				hasString(value, "nodeId") &&
				isFiniteNumber(value.durationFrames) &&
				(value.reverse === undefined || typeof value.reverse === "boolean") &&
				isOptionalString(value.bindingId)
			);
		case "document/bake-motion-grammar-binding":
		case "document/expand-motion-grammar-binding":
			return (
				hasString(value, "bindingId") &&
				(value.sampleStepFrames === undefined ||
					isFiniteNumber(value.sampleStepFrames)) &&
				(value.sourceDisposition === "archive" ||
					value.sourceDisposition === "remove")
			);
		case "document/replace-motion-grammar-role":
			return (
				hasString(value, "bindingId") &&
				hasString(value, "fromNodeId") &&
				hasString(value, "toNodeId") &&
				(value.removeGeneratedSource === undefined ||
					typeof value.removeGeneratedSource === "boolean")
			);
		default:
			return false;
	}
};

const hasCommandArray = <TCommand>(
	value: unknown,
	guard: (item: unknown) => item is TCommand,
): value is readonly TCommand[] =>
	Array.isArray(value) && value.every((item) => guard(item));

const hasOptionalCommandArray = <TCommand>(
	value: unknown,
	guard: (item: unknown) => item is TCommand,
): value is readonly TCommand[] | undefined =>
	value === undefined || hasCommandArray(value, guard);

const isApplySceneCommandsRequest = (
	value: Record<string, unknown>,
): value is AgentApplySceneCommandsRequest =>
	isOptionalString(value.transactionId) &&
	isBooleanOrUndefined(value.dryRun) &&
	hasCommandArray(value.commands, isAgentSceneCommand);

const isApplyMotionCommandsRequest = (
	value: Record<string, unknown>,
): value is AgentApplyMotionCommandsRequest =>
	isOptionalString(value.transactionId) &&
	isBooleanOrUndefined(value.dryRun) &&
	hasCommandArray(value.commands, isAgentMotionCommand);

const isApplyMotionGrammarCommandsRequest = (
	value: Record<string, unknown>,
): value is AgentApplyMotionGrammarCommandsRequest =>
	isOptionalString(value.transactionId) &&
	isBooleanOrUndefined(value.dryRun) &&
	hasCommandArray(value.commands, isAgentMotionGrammarCommand);

const isApplyCameraCommandsRequest = (
	value: Record<string, unknown>,
): value is AgentApplyCameraCommandsRequest =>
	isOptionalString(value.transactionId) &&
	isBooleanOrUndefined(value.dryRun) &&
	hasCommandArray(value.commands, isAgentCameraVerbCommand);

const isApplyDocumentCommandsRequest = (
	value: Record<string, unknown>,
): value is AgentApplyDocumentCommandsRequest =>
	isOptionalString(value.transactionId) &&
	isBooleanOrUndefined(value.dryRun) &&
	hasCommandArray(value.commands, isAgentDocumentCommand);

const isProposeEditPlanRequest = (
	value: Record<string, unknown>,
): value is AgentProposeEditPlanRequest =>
	hasString(value, "intent") &&
	(value.target === undefined || isAgentIssueTarget(value.target)) &&
	isBooleanOrUndefined(value.includeValidation) &&
	hasOptionalCommandArray(value.documentCommands, isAgentDocumentCommand) &&
	hasOptionalCommandArray(value.sceneCommands, isAgentSceneCommand) &&
	hasOptionalCommandArray(value.motionCommands, isAgentMotionCommand) &&
	hasOptionalCommandArray(
		value.motionGrammarCommands,
		isAgentMotionGrammarCommand,
	);

const isRunValidationRequest = (
	value: Record<string, unknown>,
): value is AgentRunValidationRequest =>
	value.scope === undefined ||
	(isString(value.scope) && agentValidationScopes.has(value.scope));

const isListBindablePropertiesRequest = (
	value: Record<string, unknown>,
): boolean =>
	(value.targetScope === undefined ||
		(isString(value.targetScope) &&
			bindablePropertyTargetScopes.has(value.targetScope))) &&
	(value.sourceKind === undefined ||
		(isString(value.sourceKind) &&
			bindablePropertySourceKinds.has(value.sourceKind))) &&
	isOptionalString(value.nodeId) &&
	isOptionalString(value.cameraRigId) &&
	isBooleanOrUndefined(value.sceneWritableOnly) &&
	isBooleanOrUndefined(value.keyframableOnly) &&
	isBooleanOrUndefined(value.includeIneligible);

const isListMotionGrammarRequest = (
	value: Record<string, unknown>,
): value is AgentListMotionGrammarRequest =>
	isOptionalString(value.techniqueId) &&
	isOptionalString(value.nodeId) &&
	isBooleanOrUndefined(value.authorableOnly) &&
	isBooleanOrUndefined(value.implementedOnly) &&
	isBooleanOrUndefined(value.includeBindings) &&
	isBooleanOrUndefined(value.includeIneligibleTargets);

const isObserveNodeRequest = (
	value: Record<string, unknown>,
): value is AgentObserveNodeRequest =>
	Array.isArray(value.nodeIds) &&
	value.nodeIds.every(isString) &&
	isBooleanOrUndefined(value.includeGeometry);

/**
 * Narrows an unknown MCP payload into the serializable agent request contract.
 * This deliberately validates only the stable envelope here; command execution
 * handlers still perform semantic checks against the current document snapshot.
 */
export function isAgentToolRequest(value: unknown): value is AgentToolRequest {
	if (!isRecord(value) || !isAgentToolName(value.tool)) return false;
	switch (value.tool) {
		case "apply_scene_commands":
			return isApplySceneCommandsRequest(value);
		case "apply_motion_commands":
			return isApplyMotionCommandsRequest(value);
		case "apply_motion_grammar_commands":
			return isApplyMotionGrammarCommandsRequest(value);
		case "apply_document_commands":
			return isApplyDocumentCommandsRequest(value);
		case "apply_camera_commands":
			return isApplyCameraCommandsRequest(value);
		case "propose_edit_plan":
			return isProposeEditPlanRequest(value);
		case "run_validation":
			return isRunValidationRequest(value);
		case "list_bindable_properties":
			return isListBindablePropertiesRequest(value);
		case "list_motion_grammar":
			return isListMotionGrammarRequest(value);
		case "observe_node":
			return isObserveNodeRequest(value);
		default:
			return true;
	}
}

export function isAgentToolName(value: unknown): value is AgentToolName {
	return isString(value) && agentToolNames.has(value);
}

/** Returns true when a tool can mutate scene, motion, or imported document state. */
export function isMutatingAgentToolName(
	value: AgentToolName,
): value is MutatingAgentToolName {
	return mutatingAgentToolNames.has(value);
}

/** Mutating tools need an approval/review boundary before live editor apply. */
export function agentToolRequiresApproval(tool: AgentToolName): boolean {
	return isMutatingAgentToolName(tool);
}

/** Checks the approval requirement after a payload has passed agent request narrowing. */
export function agentRequestRequiresApproval(
	request: AgentToolRequest,
): boolean {
	return agentToolRequiresApproval(request.tool);
}

/** Creates a serializable issue shared by MCP tools, validation, and export reports. */
export function createAgentIssue(
	code: string,
	severity: AgentIssueSeverity,
	message: string,
	target?: AgentIssue["target"],
): AgentIssue {
	return target
		? { code, severity, message, target }
		: { code, severity, message };
}

/** Summarizes an issue list for reviewable validation and command reports. */
export function summarizeAgentIssues(
	issues: readonly AgentIssue[],
): AgentIssueSummary {
	return {
		ok: !issues.some((issue) => issue.severity === "error"),
		issueCount: issues.length,
		errorCount: issues.filter((issue) => issue.severity === "error").length,
		warningCount: issues.filter((issue) => issue.severity === "warning").length,
		infoCount: issues.filter((issue) => issue.severity === "info").length,
	};
}

/** Wraps tool output in the stable agent result envelope. */
export function createAgentToolResult<TData>(
	tool: AgentToolName,
	data: TData,
	issues: readonly AgentIssue[] = [],
): AgentToolResult<TData> {
	return {
		contractVersion: AGENT_CONTRACT_VERSION,
		ok: !issues.some((issue) => issue.severity === "error"),
		tool,
		data,
		issues,
	};
}
