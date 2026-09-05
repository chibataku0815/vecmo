import type {
	CameraCutSegment,
	CameraRigAnimatableProperty,
	MotionDocument,
} from "@/entities/motion/model/types";
import { sampleKeyframeTrack } from "@/shared/glammer/keyframe-track";
import {
	applyCameraChannelExpression,
	type CameraExpressionPass,
	createCameraExpressionPass,
} from "./camera-channel-expression";
import {
	applyMotionRelationsToScene,
	type MotionRelationIssue,
	type MotionRelationIssueCode,
	resolveMotionRelations,
	restoreMotionParentBindings,
} from "./motion-relations";
import type { ProductionControlSampler } from "./production-control";
import {
	applyMatrixToPoint,
	composeMatrix,
	IDENTITY_MATRIX,
	invertMatrix,
	type Matrix2D,
	matrixFromTransform,
	transformWithPresentationMatrix,
} from "./rendering";
import {
	findArtboardById,
	selectArtboardIdForNode,
	selectCurrentArtboard,
} from "./selectors";
import {
	type Artboard,
	type ComponentInstanceBinding,
	type ComponentNodeBinding,
	type ComponentNodeOverride,
	type ComponentSymbol,
	type EffectIntent,
	IDENTITY_TRANSFORM,
	type SceneCameraRigContract,
	type SceneDocument,
	type SceneLayer,
	type ScopedEffectLook,
	type Vec2,
	type Vec3,
	type VectorNode,
} from "./types";

export type SceneCameraProjectionIssueCode =
	| "camera-artboard-missing"
	| "active-camera-missing"
	| "camera-target-missing"
	| "camera-controller-missing"
	| "camera-target-degenerate"
	| "camera-basis-degenerate"
	| "camera-node-outside-scope"
	| "camera-node-behind-near"
	| "camera-node-beyond-far"
	| "camera-projection-non-finite"
	| "camera-render-local-singular"
	| MotionRelationIssueCode;

export type SceneCameraProjectionIssue = {
	readonly code: SceneCameraProjectionIssueCode;
	readonly severity: "warning" | "error";
	readonly message: string;
	readonly cameraRigId?: string;
	readonly artboardId?: string;
	readonly nodeId?: string;
};

export type SampledSceneCameraRig = SceneCameraRigContract;

export type RuntimeCameraOverride = {
	readonly mode: "replace";
	readonly channels: Readonly<
		Partial<Record<CameraRigAnimatableProperty, number>>
	>;
};

export type SceneCameraRuntimeControl = {
	readonly activeCameraRigId?: string | null;
	readonly cameraOverrides?: Readonly<Record<string, RuntimeCameraOverride>>;
};

export type RuntimeCameraSelectionSource =
	| "artboard"
	| "cut"
	| "runtime-override";

export type RuntimeCameraCoordinateContract = {
	readonly worldUnits: "scene-pixels";
	readonly angles: "degrees";
	readonly xAxis: "right";
	readonly yAxis: "down";
	readonly zAxis: "scene-depth";
	readonly fovAxis: "vertical";
	readonly handedness: "right-handed";
	readonly projectionVerticalAxis: "down";
};

export type RuntimeCameraProjection =
	| {
			readonly kind: "orthographic";
			readonly zoom: number;
	  }
	| {
			readonly kind: "perspective";
			readonly fovDegrees: number;
			readonly zoom: number;
			readonly near: number;
			readonly far: number | null;
	  };

export type RuntimeCameraView = {
	readonly cameraRigId: string;
	readonly selectionSource: RuntimeCameraSelectionSource;
	readonly overridden: boolean;
	readonly artboardId: string;
	readonly artboard: { readonly width: number; readonly height: number };
	readonly coordinates: RuntimeCameraCoordinateContract;
	readonly body: Vec3;
	readonly target: Vec3;
	readonly basis: {
		readonly right: Vec3;
		readonly up: Vec3;
		readonly down: Vec3;
		readonly forward: Vec3;
		readonly targetDistance: number;
	};
	readonly projection: RuntimeCameraProjection;
	readonly depthOfField: SceneCameraDepthOfFieldResolution;
	readonly fidelity: Exclude<SceneCameraProjectionFidelity, "none">;
	readonly issues: readonly SceneCameraProjectionIssue[];
};

export type RuntimeCameraState =
	| {
			readonly kind: "none";
			readonly artboardId: string;
			readonly fidelity: "none";
			readonly issues: readonly [];
	  }
	| {
			readonly kind: "invalid";
			readonly artboardId: string;
			readonly requestedCameraRigId?: string;
			readonly fidelity: "invalid";
			readonly issues: readonly SceneCameraProjectionIssue[];
	  }
	| { readonly kind: "single"; readonly view: RuntimeCameraView }
	| {
			readonly kind: "crossfade";
			readonly from: RuntimeCameraView;
			readonly to: RuntimeCameraView;
			readonly progress: number;
	  };

export type SceneCameraPresentation = {
	readonly scene: SceneDocument;
	readonly camera: RuntimeCameraState;
	readonly motionRelationIssues?: readonly MotionRelationIssue[];
};

export type SceneCameraProjectionFidelity =
	| "none"
	| "svg-affine"
	| "requires-3d"
	| "invalid";

export type SceneCameraProjectionResolution = {
	readonly activeCameraRigId?: string;
	readonly requestedCameraRigId?: string;
	readonly sampledCameraRig?: SampledSceneCameraRig;
	readonly cameraView?: RuntimeCameraView;
	readonly nodeCameraMatrixById: ReadonlyMap<string, Matrix2D>;
	readonly nodeCameraDepthById: ReadonlyMap<string, number>;
	readonly nodeDepthOfFieldBlurById: ReadonlyMap<string, number>;
	readonly renderLocalMatrixByNodeId: ReadonlyMap<string, Matrix2D>;
	readonly projectionIssues: readonly SceneCameraProjectionIssue[];
	readonly fidelity: SceneCameraProjectionFidelity;
	readonly depthOfField: SceneCameraDepthOfFieldResolution;
};

export type SceneCameraDepthOfFieldResolution = {
	readonly active: boolean;
	readonly focusDistance: number;
	readonly aperture: number;
	readonly maxBlurRadius: number;
	readonly maxCircleOfConfusion: number;
	readonly blurredNodeCount: number;
	readonly nearBlurredNodeCount: number;
	readonly farBlurredNodeCount: number;
	readonly maxBlurNodeId?: string;
	readonly maxBlurDepth?: number;
	readonly fidelity:
		| "none"
		| "svg-layer-blur-approximation"
		| "optical-bokeh-preview-required";
	readonly renderer: "none" | "svg-layer-blur";
	readonly opticalModel: "none" | "thin-lens-normalized-coc";
	readonly bokehShape: "none" | "circular";
};

type NodeTransformIndex = {
	readonly nodeById: ReadonlyMap<string, VectorNode>;
	readonly parentNodeIdById: ReadonlyMap<string, string>;
	readonly structuralWorldById: ReadonlyMap<string, Matrix2D>;
	readonly motionWorldById: ReadonlyMap<string, Matrix2D>;
	readonly depthById: ReadonlyMap<string, number>;
	readonly issues: readonly SceneCameraProjectionIssue[];
};

type CameraBasis = {
	readonly body: Vec3;
	readonly target: Vec3;
	readonly right: Vec3;
	readonly up: Vec3;
	readonly forward: Vec3;
	readonly targetDistance: number;
};

const DEFAULT_CAMERA_FOV_DEGREES = 50;
const DEFAULT_CAMERA_NEAR = 1e-3;
const DEFAULT_ORTHOGRAPHIC_ZOOM = 1;
const DEFAULT_CAMERA_FOCUS_DISTANCE = 1000;
const DEFAULT_DOF_MAX_BLUR_RADIUS = 24;
const DEFAULT_CAMERA_SENSOR_WIDTH_MM = 36;
const DOF_BLUR_THRESHOLD = 0.05;
const DOF_BLUR_SCALE = 8;
const DOF_OPTICAL_BOKEH_BLUR_THRESHOLD = 10;
const DOF_OPTICAL_BOKEH_COC_THRESHOLD = 0.7;

const EMPTY_CAMERA_RESOLUTION: SceneCameraProjectionResolution = {
	nodeCameraMatrixById: new Map(),
	nodeCameraDepthById: new Map(),
	nodeDepthOfFieldBlurById: new Map(),
	renderLocalMatrixByNodeId: new Map(),
	projectionIssues: [],
	fidelity: "none",
	depthOfField: {
		active: false,
		focusDistance: DEFAULT_CAMERA_FOCUS_DISTANCE,
		aperture: 0,
		maxBlurRadius: 0,
		maxCircleOfConfusion: 0,
		blurredNodeCount: 0,
		nearBlurredNodeCount: 0,
		farBlurredNodeCount: 0,
		fidelity: "none",
		renderer: "none",
		opticalModel: "none",
		bokehShape: "none",
	},
};

const issue = (
	code: SceneCameraProjectionIssueCode,
	message: string,
	detail: Omit<SceneCameraProjectionIssue, "code" | "message" | "severity"> & {
		readonly severity?: SceneCameraProjectionIssue["severity"];
	} = {},
): SceneCameraProjectionIssue => {
	const { severity = "warning", ...rest } = detail;
	return { code, severity, message, ...rest };
};

const finite = (value: number): boolean => Number.isFinite(value);

const vec3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

const add3 = (left: Vec3, right: Vec3): Vec3 =>
	vec3(left.x + right.x, left.y + right.y, left.z + right.z);

const sub3 = (left: Vec3, right: Vec3): Vec3 =>
	vec3(left.x - right.x, left.y - right.y, left.z - right.z);

const scale3 = (value: Vec3, scale: number): Vec3 =>
	vec3(value.x * scale, value.y * scale, value.z * scale);

const dot3 = (left: Vec3, right: Vec3): number =>
	left.x * right.x + left.y * right.y + left.z * right.z;

const cross3 = (left: Vec3, right: Vec3): Vec3 =>
	vec3(
		left.y * right.z - left.z * right.y,
		left.z * right.x - left.x * right.z,
		left.x * right.y - left.y * right.x,
	);

const length3 = (value: Vec3): number => Math.hypot(value.x, value.y, value.z);

const normalize3 = (value: Vec3): Vec3 | null => {
	const length = length3(value);
	if (!finite(length) || length <= 1e-6) return null;
	return vec3(value.x / length, value.y / length, value.z / length);
};

const degreesToRadians = (degrees: number): number => (degrees * Math.PI) / 180;

const clampNumber = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));

const focalLengthMmFromFov = (fovDegrees: number): number => {
	const fovRadians = degreesToRadians(clampNumber(fovDegrees, 1, 179));
	return DEFAULT_CAMERA_SENSOR_WIDTH_MM / (2 * Math.tan(fovRadians / 2));
};

/**
 * Effective focal length in mm for a sampled rig, against Vecmo's fixed 36mm
 * sensor-width convention: the authored value when present, else derived from
 * the sampled vertical FOV (orthographic rigs fall back to the default FOV).
 * Exported for `runtime-3d.ts`'s `cameraForRig`, which reports the same value
 * on `Runtime3dCamera.focalLengthMm` for renderer-neutral consumers.
 */
export const effectiveFocalLengthMm = (rig: SampledSceneCameraRig): number => {
	const authored = rig.projection.focalLengthMm;
	if (authored !== undefined && finite(authored) && authored > 0) {
		return authored;
	}
	if (rig.projection.kind === "perspective") {
		return focalLengthMmFromFov(
			rig.projection.fovDegrees ?? DEFAULT_CAMERA_FOV_DEGREES,
		);
	}
	return focalLengthMmFromFov(DEFAULT_CAMERA_FOV_DEGREES);
};

const rotateVectorAroundAxis = (
	value: Vec3,
	axis: Vec3,
	degrees: number,
): Vec3 => {
	if (!finite(degrees) || Math.abs(degrees) <= 1e-6) return value;
	const radians = degreesToRadians(degrees);
	const sin = Math.sin(radians);
	const cos = Math.cos(radians);
	return add3(
		add3(scale3(value, cos), scale3(cross3(axis, value), sin)),
		scale3(axis, dot3(axis, value) * (1 - cos)),
	);
};

const rotatedCameraBasis = (
	basis: CameraBasis,
	rotation: Vec3 | undefined,
): CameraBasis | null => {
	if (!rotation || (rotation.x === 0 && rotation.y === 0 && rotation.z === 0)) {
		return basis;
	}
	let { right, up, forward } = basis;
	forward = rotateVectorAroundAxis(forward, right, rotation.x);
	up = rotateVectorAroundAxis(up, right, rotation.x);
	right = rotateVectorAroundAxis(right, up, rotation.y);
	forward = rotateVectorAroundAxis(forward, up, rotation.y);
	right = rotateVectorAroundAxis(right, forward, rotation.z);
	up = rotateVectorAroundAxis(up, forward, rotation.z);
	const normalizedRight = normalize3(right);
	const normalizedUp = normalize3(up);
	const normalizedForward = normalize3(forward);
	if (!normalizedRight || !normalizedUp || !normalizedForward) return null;
	return {
		...basis,
		right: normalizedRight,
		up: normalizedUp,
		forward: normalizedForward,
	};
};

const originForMatrix = (matrix: Matrix2D): Vec2 =>
	applyMatrixToPoint(matrix, { x: 0, y: 0 });

const activeCameraIdForArtboard = (artboard: Artboard): string | undefined =>
	artboard.activeSceneCameraId;

const rigScopesArtboard = (
	rig: SceneCameraRigContract,
	artboardId: string,
): boolean =>
	rig.scope.kind === "scene" ||
	(rig.scope.kind === "artboard" && rig.scope.artboardId === artboardId);

/**
 * Makes a forced runtime camera selection dormant when a sequence cut reaches
 * an artboard outside that rig's scope. Channel overrides remain available and
 * the forced selection resumes if a later item is compatible.
 */
export function runtimeCameraControlForArtboard(
	scene: SceneDocument,
	artboardId: string,
	runtimeControl: SceneCameraRuntimeControl | undefined,
): SceneCameraRuntimeControl | undefined {
	const activeCameraRigId = runtimeControl?.activeCameraRigId;
	if (!activeCameraRigId) return runtimeControl;
	const activeRig = scene.sceneCameras?.find(
		(rig) => rig.id === activeCameraRigId,
	);
	if (!activeRig || rigScopesArtboard(activeRig, artboardId)) {
		return runtimeControl;
	}
	return {
		...runtimeControl,
		activeCameraRigId: null,
	};
}

export function findActiveSceneCameraRig(
	scene: SceneDocument,
	artboardId: string = selectCurrentArtboard(scene).id,
): SceneCameraRigContract | undefined {
	const activeId = activeCameraIdForArtboard(
		findArtboardById(scene, artboardId) ?? selectCurrentArtboard(scene),
	);
	if (!activeId) return undefined;
	return scene.sceneCameras?.find(
		(rig) => rig.id === activeId && rigScopesArtboard(rig, artboardId),
	);
}

/** Returns the winning camera-cut segment covering one artboard frame, if any. */
export function findCameraCutSegmentAtFrame(
	motion: MotionDocument,
	artboardId: string,
	frame: number,
): CameraCutSegment | undefined {
	if (!Number.isFinite(frame)) return undefined;
	let winner: CameraCutSegment | undefined;
	for (const segment of motion.cameraCuts ?? []) {
		if (
			segment.artboardId !== artboardId ||
			frame < segment.startFrame ||
			frame >= segment.startFrame + segment.durationFrames
		) {
			continue;
		}
		if (
			!winner ||
			segment.startFrame > winner.startFrame ||
			(segment.startFrame === winner.startFrame &&
				(segment.durationFrames > winner.durationFrames ||
					(segment.durationFrames === winner.durationFrames &&
						segment.id < winner.id)))
		) {
			winner = segment;
		}
	}
	return winner;
}

const findSceneCameraRigForFrame = ({
	scene,
	motion,
	artboardId,
	frame,
	cameraRigIdOverride,
}: {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly artboardId: string;
	readonly frame: number;
	readonly cameraRigIdOverride?: string | null;
}): {
	readonly requestedCameraRigId?: string;
	readonly rig?: SceneCameraRigContract;
	readonly cut?: CameraCutSegment;
} => {
	const cut = findCameraCutSegmentAtFrame(motion, artboardId, frame);
	const artboard =
		findArtboardById(scene, artboardId) ?? selectCurrentArtboard(scene);
	const requestedCameraRigId =
		cameraRigIdOverride ??
		cut?.cameraRigId ??
		activeCameraIdForArtboard(artboard);
	if (!requestedCameraRigId) return cut ? { cut } : {};
	const rig = scene.sceneCameras?.find(
		(candidate) =>
			candidate.id === requestedCameraRigId &&
			rigScopesArtboard(candidate, artboardId),
	);
	return {
		requestedCameraRigId,
		...(rig ? { rig } : {}),
		...(cut ? { cut } : {}),
	};
};

/**
 * Presentation-only crossfade state for one frame. It identifies the previous
 * and current camera rigs that should be projected separately before their
 * rendered scene layers are opacity-blended; it is not written back to the
 * authored scene or motion documents.
 */
export type CameraCutCrossfadeFrame = {
	readonly segment: CameraCutSegment;
	readonly fromCameraRigId: string;
	readonly toCameraRigId: string;
	readonly fromSelectionSource: "artboard" | "cut";
	readonly progress: number;
};

/**
 * Resolves the effective transition duration used by the presentation sampler.
 * Unsupported or missing transition durations intentionally collapse to a hard
 * cut so legacy camera-cut data keeps deterministic behavior.
 */
export const effectiveCameraCutTransitionDuration = (
	segment: CameraCutSegment,
): number => {
	if (segment.transition !== "crossfade") return 0;
	if (segment.durationFrames < 2) return 0;
	const authored = segment.transitionDurationFrames;
	const duration =
		authored !== undefined && Number.isFinite(authored)
			? Math.round(authored)
			: 0;
	return Math.max(0, Math.min(duration, segment.durationFrames));
};

/**
 * Resolves whether an artboard frame is inside a renderable crossfade cut.
 * The previous camera is sampled from the frame immediately before the cut
 * starts, matching NLE-style camera switching while preserving uncovered-frame
 * fallback to the artboard active camera.
 */
export const resolveCameraCutCrossfadeFrame = ({
	scene,
	motion,
	artboardId,
	frame,
}: {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly artboardId: string;
	readonly frame: number;
}): CameraCutCrossfadeFrame | null => {
	const segment = findCameraCutSegmentAtFrame(motion, artboardId, frame);
	if (segment?.transition !== "crossfade") return null;
	const transitionDuration = effectiveCameraCutTransitionDuration(segment);
	const elapsed = frame - segment.startFrame;
	if (transitionDuration <= 0 || elapsed < 0 || elapsed >= transitionDuration) {
		return null;
	}
	const previousFrame = Math.max(0, segment.startFrame - 1);
	const previousCamera = findSceneCameraRigForFrame({
		scene,
		motion,
		artboardId,
		frame: previousFrame,
	});
	const artboard =
		findArtboardById(scene, artboardId) ?? selectCurrentArtboard(scene);
	const fromCameraRigId =
		previousCamera.requestedCameraRigId ?? activeCameraIdForArtboard(artboard);
	const toCameraRigId = segment.cameraRigId;
	if (!fromCameraRigId || fromCameraRigId === toCameraRigId) return null;
	const denominator = Math.max(1, transitionDuration - 1);
	return {
		segment,
		fromCameraRigId,
		toCameraRigId,
		fromSelectionSource: previousCamera.cut ? "cut" : "artboard",
		progress: clampNumber(elapsed / denominator, 0, 1),
	};
};

export function hasActiveSceneCameraProjection(
	scene: SceneDocument,
	artboardId: string = selectCurrentArtboard(scene).id,
): boolean {
	return Boolean(findActiveSceneCameraRig(scene, artboardId));
}

/**
 * Geometry-only check for whether `rig` projects `artboard` as the untouched 2D
 * identity — i.e. rendering with this rig active is indistinguishable from having
 * no camera at all. `buildSceneCameraRigForArtboard`'s default (no-options) output
 * always satisfies this. Shared by the P2 `agent.scene-camera-unused` validation issue
 * and the P3.0 fast/rich playback gate so both read one definition instead of two
 * drifting copies.
 *
 * Takes only `(rig, artboard)` — no scene/node index — so it cannot resolve
 * `nodeId`/`parentControllerNodeId` bindings on the body or target; their mere
 * presence conservatively fails the predicate (an unresolvable binding might move
 * the effective position away from center). Track/cut usage is deliberately out of
 * scope; callers compose that separately (this stays pure geometry).
 *
 * The ortho branch of `projectPoint` ignores depth entirely, so any distance
 * magnitude is identity-safe — but the *sign* of `target.z - body.z` is not: it
 * fixes which way `cameraBasis`'s forward vector points, and reversing it mirrors
 * the projected x axis (`cameraBasis`/`rotatedCameraBasis`). That is why this
 * checks `body.position.z < targetPoint.z` (the factory's body-behind-target
 * convention) rather than merely rejecting exact equality.
 */
export function isIdentitySceneCameraRigForArtboard(
	rig: SceneCameraRigContract,
	artboard: Artboard,
): boolean {
	if (rig.projection.kind !== "orthographic") return false;
	const authoredZoom = rig.projection.zoom;
	const effectiveZoom =
		authoredZoom !== undefined && finite(authoredZoom) && authoredZoom > 0
			? authoredZoom
			: DEFAULT_ORTHOGRAPHIC_ZOOM;
	if (effectiveZoom !== 1) return false;

	const rotation = rig.body.rotation;
	if (rotation && (rotation.x !== 0 || rotation.y !== 0 || rotation.z !== 0)) {
		return false;
	}
	if (rig.body.parentControllerNodeId || rig.parentControllerNodeId) {
		return false;
	}

	const center = vec3(artboard.width / 2, artboard.height / 2, 0);
	if (rig.body.position.x !== center.x || rig.body.position.y !== center.y) {
		return false;
	}

	if (rig.target?.nodeId || rig.target?.parentControllerNodeId) {
		return false;
	}
	const targetPoint = rig.target?.point ?? center;
	if (targetPoint.x !== center.x || targetPoint.y !== center.y) {
		return false;
	}

	return rig.body.position.z < targetPoint.z;
}

/**
 * True when any authored camera-rig track for `cameraRigId` carries at least one
 * keyframe. Scoped to the rig id (not a specific property) because the fast/rich
 * playback gate only needs "is this rig animated at all", not which channel.
 */
const hasAnyCameraTrackKeyframeForRig = (
	motion: MotionDocument,
	cameraRigId: string,
): boolean =>
	motion.cameraTracks?.some(
		(track) =>
			track.target.cameraRigId === cameraRigId && track.keyframes.length > 0,
	) ?? false;

/**
 * Effect-based playback gate: does the artboard's scene camera actually change
 * what gets rendered, so playback must take the rich (projected) presentation
 * path instead of the imperative fast path? Returns true when a camera cut
 * targets the artboard (a cut projects the scene through its own rig regardless
 * of the artboard active camera, so this preserves the pre-existing
 * cut-segment trigger and generalizes it from "cut at this frame" to "any cut
 * for this artboard" — a superset that never loses a trigger and lets the gate
 * be frame-independent), or the active rig is a non-identity projection
 * ({@link isIdentitySceneCameraRigForArtboard}), or the active rig carries any
 * camera-track keyframe.
 *
 * A resident identity + trackless camera with no cuts — e.g. the just-in-time
 * camera auto-supplied on a flat 2D document — returns false, so it never drags
 * node-only motion onto the projected path and playback stays on the fast path.
 *
 * Distinct from {@link hasActiveSceneCameraProjection}, a pure presence check
 * retained for correctness consumers that must project whenever a rig is active
 * at all; this predicate is a performance gate that additionally requires the
 * rig to have an observable effect. It shares the identity geometry predicate
 * with the P2 `agent.scene-camera-unused` validation issue so both read one
 * definition instead of two drifting copies.
 */
export function sceneCameraAffectsPlayback(
	scene: SceneDocument,
	motion: MotionDocument,
	artboardId: string = selectCurrentArtboard(scene).id,
): boolean {
	const hasCutForArtboard =
		motion.cameraCuts?.some((segment) => segment.artboardId === artboardId) ??
		false;
	if (hasCutForArtboard) return true;
	const activeRig = findActiveSceneCameraRig(scene, artboardId);
	if (!activeRig) return false;
	const artboard =
		findArtboardById(scene, artboardId) ?? selectCurrentArtboard(scene);
	if (!isIdentitySceneCameraRigForArtboard(activeRig, artboard)) return true;
	return hasAnyCameraTrackKeyframeForRig(motion, activeRig.id);
}

const numericCameraKeyframes = (
	motion: MotionDocument,
	cameraRigId: string,
	property: CameraRigAnimatableProperty,
) =>
	motion.cameraTracks
		?.find(
			(track) =>
				track.target.cameraRigId === cameraRigId &&
				track.target.property === property,
		)
		?.keyframes.filter(
			(keyframe) =>
				finite(keyframe.time) &&
				typeof keyframe.value === "number" &&
				finite(keyframe.value),
		) ?? [];

/**
 * Samples one camera channel, then composes its optional expression over the
 * sampled value. Order is load-bearing and matches Codeable Native: keyframes
 * (or the authored static channel) produce the base, the expression maps base →
 * final. A failed expression returns the base, so an unresolved `control()`
 * leaves the shot where the author put it instead of collapsing it to `0`.
 */
const sampleCameraChannel = (
	motion: MotionDocument,
	cameraRigId: string,
	property: CameraRigAnimatableProperty,
	base: number,
	frame: number,
	expressions?: CameraExpressionPass,
): number => {
	const keyframes = numericCameraKeyframes(motion, cameraRigId, property);
	const sampled =
		keyframes.length > 0 ? sampleKeyframeTrack(keyframes, frame) : base;
	if (!expressions || expressions.index.isEmpty) return sampled;
	return applyCameraChannelExpression(
		expressions.index.get(cameraRigId, property),
		sampled,
		expressions.context,
	).value;
};

/**
 * Does this rig channel carry an expression? Presence gates whether an optional
 * projection channel is emitted at all: a channel driven ONLY by an expression
 * has neither an authored static value nor keyframes, and would otherwise be
 * omitted from the sampled projection and never evaluated.
 */
const hasCameraChannelExpression = (
	expressions: CameraExpressionPass | undefined,
	cameraRigId: string,
	property: CameraRigAnimatableProperty,
): boolean => expressions?.index.has(cameraRigId, property) ?? false;

const buildNodeTransformIndex = (scene: SceneDocument): NodeTransformIndex => {
	const nodeById = new Map<string, VectorNode>();
	const parentNodeIdById = new Map<string, string>();
	const structuralWorldById = new Map<string, Matrix2D>();
	const depthById = new Map<string, number>();
	const issues: SceneCameraProjectionIssue[] = [];

	const visit = (
		node: VectorNode,
		parentWorld: Matrix2D,
		parentNodeId: string | null,
		inheritedDepth: number,
	): void => {
		nodeById.set(node.id, node);
		if (parentNodeId) parentNodeIdById.set(node.id, parentNodeId);
		const world = composeMatrix(
			parentWorld,
			matrixFromTransform(node.transform),
		);
		structuralWorldById.set(node.id, world);
		const depth = node.depthPlane?.z ?? inheritedDepth;
		depthById.set(node.id, depth);
		for (const child of node.children ?? [])
			visit(child, world, node.id, depth);
	};

	for (const layer of scene.layers) {
		for (const node of layer.nodes) visit(node, IDENTITY_MATRIX, null, 0);
	}

	const relationResolution = resolveMotionRelations({ sampledScene: scene });
	const motionWorldById = relationResolution.worldMatrixByNodeId;
	issues.push(
		...relationResolution.issues.map((entry) => ({
			code: entry.code,
			severity: entry.severity,
			message: entry.message,
			nodeId: entry.nodeId,
		})),
	);

	return {
		nodeById,
		parentNodeIdById,
		structuralWorldById,
		motionWorldById,
		depthById,
		issues,
	};
};

const controllerPoint = (
	index: NodeTransformIndex,
	nodeId: string | undefined,
): Vec3 | null => {
	if (!nodeId) return null;
	const matrix = index.motionWorldById.get(nodeId);
	if (!matrix) return null;
	const point = originForMatrix(matrix);
	return vec3(point.x, point.y, index.depthById.get(nodeId) ?? 0);
};

const targetPointForRig = (
	artboard: Artboard,
	index: NodeTransformIndex,
	rig: SceneCameraRigContract,
	issues: SceneCameraProjectionIssue[],
): Vec3 => {
	const explicitTarget =
		rig.target?.point ?? vec3(artboard.width / 2, artboard.height / 2, 0);
	const targetNodeId = rig.target?.nodeId;
	if (targetNodeId) {
		const matrix = index.motionWorldById.get(targetNodeId);
		if (matrix) {
			const point = originForMatrix(matrix);
			return vec3(point.x, point.y, index.depthById.get(targetNodeId) ?? 0);
		}
		issues.push(
			issue(
				"camera-target-missing",
				`Camera target node "${targetNodeId}" is missing.`,
				{ cameraRigId: rig.id, nodeId: targetNodeId },
			),
		);
	}
	const targetController = controllerPoint(
		index,
		rig.target?.parentControllerNodeId,
	);
	if (rig.target?.parentControllerNodeId && !targetController) {
		issues.push(
			issue(
				"camera-controller-missing",
				`Camera target controller "${rig.target.parentControllerNodeId}" is missing.`,
				{ cameraRigId: rig.id, nodeId: rig.target.parentControllerNodeId },
			),
		);
	}
	const sceneTarget = targetController
		? add3(targetController, explicitTarget)
		: explicitTarget;
	if (finite(sceneTarget.x) && finite(sceneTarget.y) && finite(sceneTarget.z)) {
		return sceneTarget;
	}
	return vec3(artboard.width / 2, artboard.height / 2, 0);
};

/**
 * Resolves effective target points with the same transform index used by camera
 * projection. Authoring surfaces consume this batch form so multiple cameras do
 * not rebuild the scene transform graph independently.
 */
export function resolveSceneCameraTargetPoints(
	scene: SceneDocument,
	rigs: readonly SceneCameraRigContract[],
	artboardId: string = selectCurrentArtboard(scene).id,
): ReadonlyMap<string, Vec3> {
	const artboard =
		findArtboardById(scene, artboardId) ?? selectCurrentArtboard(scene);
	const index = buildNodeTransformIndex(scene);
	return new Map(
		rigs.map((rig) => [rig.id, targetPointForRig(artboard, index, rig, [])]),
	);
}

const sampledCameraRig = (
	artboard: Artboard,
	motion: MotionDocument,
	rig: SceneCameraRigContract,
	frame: number,
	index: NodeTransformIndex,
	issues: SceneCameraProjectionIssue[],
	expressions?: CameraExpressionPass,
): SampledSceneCameraRig => {
	const bodyControllerId =
		rig.body.parentControllerNodeId ?? rig.parentControllerNodeId;
	const controller = controllerPoint(index, bodyControllerId);
	if (bodyControllerId && !controller) {
		issues.push(
			issue(
				"camera-controller-missing",
				`Camera body controller "${bodyControllerId}" is missing.`,
				{ cameraRigId: rig.id, nodeId: bodyControllerId },
			),
		);
	}
	const bodyBase = controller
		? add3(controller, rig.body.position)
		: rig.body.position;
	const targetBase = targetPointForRig(artboard, index, rig, issues);
	const fovKeyframes = numericCameraKeyframes(motion, rig.id, "fovDegrees");
	const zoomKeyframes = numericCameraKeyframes(motion, rig.id, "zoom");
	const focusKeyframes = numericCameraKeyframes(
		motion,
		rig.id,
		"focusDistance",
	);
	const apertureKeyframes = numericCameraKeyframes(motion, rig.id, "aperture");
	const rotationBase = rig.body.rotation ?? { x: 0, y: 0, z: 0 };
	const rotationXKeyframes = numericCameraKeyframes(
		motion,
		rig.id,
		"bodyRotationX",
	);
	const rotationYKeyframes = numericCameraKeyframes(
		motion,
		rig.id,
		"bodyRotationY",
	);
	const rotationZKeyframes = numericCameraKeyframes(
		motion,
		rig.id,
		"bodyRotationZ",
	);
	const expressed = (property: CameraRigAnimatableProperty): boolean =>
		hasCameraChannelExpression(expressions, rig.id, property);
	const hasAuthoredRotation =
		rig.body.rotation !== undefined ||
		rotationXKeyframes.length > 0 ||
		rotationYKeyframes.length > 0 ||
		rotationZKeyframes.length > 0 ||
		expressed("bodyRotationX") ||
		expressed("bodyRotationY") ||
		expressed("bodyRotationZ");
	const targetBaseContract = rig.target ?? { point: targetBase };
	return {
		...rig,
		projection: {
			...rig.projection,
			...(rig.projection.fovDegrees !== undefined ||
			fovKeyframes.length > 0 ||
			expressed("fovDegrees")
				? {
						fovDegrees: sampleCameraChannel(
							motion,
							rig.id,
							"fovDegrees",
							rig.projection.fovDegrees ?? DEFAULT_CAMERA_FOV_DEGREES,
							frame,
							expressions,
						),
					}
				: {}),
			...(rig.projection.zoom !== undefined ||
			zoomKeyframes.length > 0 ||
			expressed("zoom")
				? {
						zoom: sampleCameraChannel(
							motion,
							rig.id,
							"zoom",
							rig.projection.zoom ?? DEFAULT_ORTHOGRAPHIC_ZOOM,
							frame,
							expressions,
						),
					}
				: {}),
			...(rig.projection.focusDistance !== undefined ||
			focusKeyframes.length > 0 ||
			expressed("focusDistance")
				? {
						focusDistance: sampleCameraChannel(
							motion,
							rig.id,
							"focusDistance",
							rig.projection.focusDistance ?? DEFAULT_CAMERA_FOCUS_DISTANCE,
							frame,
							expressions,
						),
					}
				: {}),
			...(rig.projection.aperture !== undefined ||
			apertureKeyframes.length > 0 ||
			expressed("aperture")
				? {
						aperture: Math.max(
							0,
							sampleCameraChannel(
								motion,
								rig.id,
								"aperture",
								rig.projection.aperture ?? 0,
								frame,
								expressions,
							),
						),
					}
				: {}),
		},
		body: {
			...rig.body,
			position: {
				x: sampleCameraChannel(
					motion,
					rig.id,
					"bodyX",
					bodyBase.x,
					frame,
					expressions,
				),
				y: sampleCameraChannel(
					motion,
					rig.id,
					"bodyY",
					bodyBase.y,
					frame,
					expressions,
				),
				z: sampleCameraChannel(
					motion,
					rig.id,
					"bodyZ",
					bodyBase.z,
					frame,
					expressions,
				),
			},
			...(hasAuthoredRotation
				? {
						rotation: {
							x: sampleCameraChannel(
								motion,
								rig.id,
								"bodyRotationX",
								rotationBase.x,
								frame,
								expressions,
							),
							y: sampleCameraChannel(
								motion,
								rig.id,
								"bodyRotationY",
								rotationBase.y,
								frame,
								expressions,
							),
							z: sampleCameraChannel(
								motion,
								rig.id,
								"bodyRotationZ",
								rotationBase.z,
								frame,
								expressions,
							),
						},
					}
				: {}),
		},
		target: {
			...targetBaseContract,
			point: {
				x: sampleCameraChannel(
					motion,
					rig.id,
					"targetX",
					targetBase.x,
					frame,
					expressions,
				),
				y: sampleCameraChannel(
					motion,
					rig.id,
					"targetY",
					targetBase.y,
					frame,
					expressions,
				),
				z: sampleCameraChannel(
					motion,
					rig.id,
					"targetZ",
					targetBase.z,
					frame,
					expressions,
				),
			},
		},
	};
};

const runtimeCameraChannel = (
	override: RuntimeCameraOverride | undefined,
	property: CameraRigAnimatableProperty,
	fallback: number,
): number => {
	const value = override?.channels[property];
	return value !== undefined && finite(value) ? value : fallback;
};

const hasRuntimeCameraChannel = (
	override: RuntimeCameraOverride,
	property: CameraRigAnimatableProperty,
): boolean => override.channels[property] !== undefined;

const applyRuntimeCameraOverride = (
	rig: SampledSceneCameraRig,
	override: RuntimeCameraOverride | undefined,
): SampledSceneCameraRig => {
	if (override?.mode !== "replace") return rig;
	const rotation = rig.body.rotation ?? { x: 0, y: 0, z: 0 };
	const target = rig.target ?? { point: vec3(0, 0, 0) };
	const hasRotationOverride =
		hasRuntimeCameraChannel(override, "bodyRotationX") ||
		hasRuntimeCameraChannel(override, "bodyRotationY") ||
		hasRuntimeCameraChannel(override, "bodyRotationZ");
	return {
		...rig,
		projection: {
			...rig.projection,
			...(hasRuntimeCameraChannel(override, "fovDegrees")
				? {
						fovDegrees: runtimeCameraChannel(
							override,
							"fovDegrees",
							rig.projection.fovDegrees ?? DEFAULT_CAMERA_FOV_DEGREES,
						),
					}
				: {}),
			...(hasRuntimeCameraChannel(override, "zoom")
				? {
						zoom: runtimeCameraChannel(
							override,
							"zoom",
							rig.projection.zoom ?? DEFAULT_ORTHOGRAPHIC_ZOOM,
						),
					}
				: {}),
			...(hasRuntimeCameraChannel(override, "focusDistance")
				? {
						focusDistance: runtimeCameraChannel(
							override,
							"focusDistance",
							rig.projection.focusDistance ?? DEFAULT_CAMERA_FOCUS_DISTANCE,
						),
					}
				: {}),
			...(hasRuntimeCameraChannel(override, "aperture")
				? {
						aperture: Math.max(
							0,
							runtimeCameraChannel(
								override,
								"aperture",
								rig.projection.aperture ?? 0,
							),
						),
					}
				: {}),
		},
		body: {
			...rig.body,
			position: {
				x: runtimeCameraChannel(override, "bodyX", rig.body.position.x),
				y: runtimeCameraChannel(override, "bodyY", rig.body.position.y),
				z: runtimeCameraChannel(override, "bodyZ", rig.body.position.z),
			},
			...(hasRotationOverride
				? {
						rotation: {
							x: runtimeCameraChannel(override, "bodyRotationX", rotation.x),
							y: runtimeCameraChannel(override, "bodyRotationY", rotation.y),
							z: runtimeCameraChannel(override, "bodyRotationZ", rotation.z),
						},
					}
				: {}),
		},
		target: {
			...target,
			point: {
				x: runtimeCameraChannel(override, "targetX", target.point.x),
				y: runtimeCameraChannel(override, "targetY", target.point.y),
				z: runtimeCameraChannel(override, "targetZ", target.point.z),
			},
		},
	};
};

const cameraBasis = (
	rig: SampledSceneCameraRig,
	issues: SceneCameraProjectionIssue[],
): CameraBasis | null => {
	const body = rig.body.position;
	const target = rig.target?.point ?? vec3(0, 0, 0);
	const forward = normalize3(sub3(target, body));
	if (!forward) {
		issues.push(
			issue("camera-target-degenerate", "Camera body and target coincide.", {
				cameraRigId: rig.id,
				severity: "error",
			}),
		);
		return null;
	}
	const screenDown = vec3(0, 1, 0);
	const right = normalize3(cross3(screenDown, forward));
	if (!right) {
		issues.push(
			issue("camera-basis-degenerate", "Camera basis is degenerate.", {
				cameraRigId: rig.id,
				severity: "error",
			}),
		);
		return null;
	}
	const up = normalize3(cross3(forward, right));
	if (!up) {
		issues.push(
			issue("camera-basis-degenerate", "Camera up vector is degenerate.", {
				cameraRigId: rig.id,
				severity: "error",
			}),
		);
		return null;
	}
	const rotatedBasis = rotatedCameraBasis(
		{
			body,
			target,
			right,
			up,
			forward,
			targetDistance: Math.max(
				DEFAULT_CAMERA_NEAR,
				dot3(sub3(target, body), forward),
			),
		},
		rig.body.rotation,
	);
	if (!rotatedBasis) {
		issues.push(
			issue("camera-basis-degenerate", "Camera rotation made basis invalid.", {
				cameraRigId: rig.id,
				severity: "error",
			}),
		);
		return null;
	}
	return rotatedBasis;
};

const cameraPoint = (point: Vec3, basis: CameraBasis): Vec3 => {
	const offset = sub3(point, basis.body);
	return vec3(
		dot3(offset, basis.right),
		dot3(offset, basis.up),
		dot3(offset, basis.forward),
	);
};

const effectiveRuntimeProjection = (
	rig: SampledSceneCameraRig,
	basis: CameraBasis,
	artboard: Artboard,
): RuntimeCameraProjection => {
	if (rig.projection.kind === "orthographic") {
		const authoredZoom = rig.projection.zoom;
		return {
			kind: "orthographic",
			zoom:
				authoredZoom !== undefined && finite(authoredZoom) && authoredZoom > 0
					? authoredZoom
					: DEFAULT_ORTHOGRAPHIC_ZOOM,
		};
	}
	const authoredFov = rig.projection.fovDegrees;
	const fovDegrees = clampNumber(
		authoredFov !== undefined && finite(authoredFov)
			? authoredFov
			: DEFAULT_CAMERA_FOV_DEGREES,
		1,
		179,
	);
	const focal = artboard.height / 2 / Math.tan((fovDegrees * Math.PI) / 360);
	const authoredZoom = rig.projection.zoom;
	const authoredNear = rig.projection.near;
	const near =
		authoredNear !== undefined && finite(authoredNear) && authoredNear > 0
			? authoredNear
			: DEFAULT_CAMERA_NEAR;
	const authoredFar = rig.projection.far;
	return {
		kind: "perspective",
		fovDegrees,
		zoom:
			authoredZoom !== undefined && finite(authoredZoom) && authoredZoom > 0
				? authoredZoom
				: basis.targetDistance / focal,
		near,
		far:
			authoredFar !== undefined && finite(authoredFar) && authoredFar > near
				? authoredFar
				: null,
	};
};

const projectPoint = ({
	point,
	rig,
	basis,
	artboard,
	issues,
	nodeId,
}: {
	readonly point: Vec3;
	readonly rig: SampledSceneCameraRig;
	readonly basis: CameraBasis;
	readonly artboard: Artboard;
	readonly issues: SceneCameraProjectionIssue[];
	readonly nodeId: string;
}): Vec2 | null => {
	const camera = cameraPoint(point, basis);
	const center = { x: artboard.width / 2, y: artboard.height / 2 };
	const targetCamera = cameraPoint(basis.target, basis);
	const projection = effectiveRuntimeProjection(rig, basis, artboard);
	if (projection.kind === "orthographic") {
		return {
			x: center.x + (camera.x - targetCamera.x) * projection.zoom,
			y: center.y + (camera.y - targetCamera.y) * projection.zoom,
		};
	}
	if (camera.z <= projection.near) {
		issues.push(
			issue(
				"camera-node-behind-near",
				`Node "${nodeId}" is behind the camera near plane.`,
				{
					cameraRigId: rig.id,
					nodeId,
				},
			),
		);
		return null;
	}
	if (projection.far !== null && camera.z >= projection.far) {
		issues.push(
			issue(
				"camera-node-beyond-far",
				`Node "${nodeId}" is beyond the camera far plane.`,
				{
					cameraRigId: rig.id,
					nodeId,
				},
			),
		);
		return null;
	}
	const radians = (projection.fovDegrees * Math.PI) / 180;
	const focal = artboard.height / 2 / Math.tan(radians / 2);
	const scale = (focal * projection.zoom) / camera.z;
	const projected = {
		x: center.x + (camera.x - targetCamera.x) * scale,
		y: center.y + (camera.y - targetCamera.y) * scale,
	};
	return finite(projected.x) && finite(projected.y) ? projected : null;
};

const projectMatrix = ({
	matrix,
	depth,
	rig,
	basis,
	artboard,
	issues,
	nodeId,
}: {
	readonly matrix: Matrix2D;
	readonly depth: number;
	readonly rig: SampledSceneCameraRig;
	readonly basis: CameraBasis;
	readonly artboard: Artboard;
	readonly issues: SceneCameraProjectionIssue[];
	readonly nodeId: string;
}): Matrix2D | null => {
	const origin = applyMatrixToPoint(matrix, { x: 0, y: 0 });
	const unitX = applyMatrixToPoint(matrix, { x: 1, y: 0 });
	const unitY = applyMatrixToPoint(matrix, { x: 0, y: 1 });
	const projectedOrigin = projectPoint({
		point: vec3(origin.x, origin.y, depth),
		rig,
		basis,
		artboard,
		issues,
		nodeId,
	});
	const projectedX = projectPoint({
		point: vec3(unitX.x, unitX.y, depth),
		rig,
		basis,
		artboard,
		issues,
		nodeId,
	});
	const projectedY = projectPoint({
		point: vec3(unitY.x, unitY.y, depth),
		rig,
		basis,
		artboard,
		issues,
		nodeId,
	});
	if (!projectedOrigin || !projectedX || !projectedY) return null;
	const projected = {
		a: projectedX.x - projectedOrigin.x,
		b: projectedX.y - projectedOrigin.y,
		c: projectedY.x - projectedOrigin.x,
		d: projectedY.y - projectedOrigin.y,
		e: projectedOrigin.x,
		f: projectedOrigin.y,
	};
	if (
		!finite(projected.a) ||
		!finite(projected.b) ||
		!finite(projected.c) ||
		!finite(projected.d) ||
		!finite(projected.e) ||
		!finite(projected.f)
	) {
		issues.push(
			issue(
				"camera-projection-non-finite",
				`Node "${nodeId}" projected to a non-finite matrix.`,
				{
					cameraRigId: rig.id,
					nodeId,
					severity: "error",
				},
			),
		);
		return null;
	}
	return projected;
};

const resolveDepthOfField = (
	rig: SampledSceneCameraRig,
	nodeCameraDepthById: ReadonlyMap<string, number>,
): {
	readonly summary: SceneCameraDepthOfFieldResolution;
	readonly blurByNodeId: ReadonlyMap<string, number>;
} => {
	const aperture = Math.max(0, rig.projection.aperture ?? 0);
	const focusDistance = Math.max(
		DEFAULT_CAMERA_NEAR,
		rig.projection.focusDistance ??
			Math.abs(rig.body.position.z - (rig.target?.point?.z ?? 0)),
	);
	if (aperture <= 0 || nodeCameraDepthById.size === 0) {
		return {
			summary: {
				active: false,
				focusDistance,
				aperture,
				maxBlurRadius: 0,
				maxCircleOfConfusion: 0,
				blurredNodeCount: 0,
				nearBlurredNodeCount: 0,
				farBlurredNodeCount: 0,
				fidelity: "none",
				renderer: "none",
				opticalModel: "none",
				bokehShape: "none",
			},
			blurByNodeId: new Map(),
		};
	}
	const blurByNodeId = new Map<string, number>();
	let maxBlurRadius = 0;
	let maxCircleOfConfusion = 0;
	let nearBlurredNodeCount = 0;
	let farBlurredNodeCount = 0;
	let maxBlurNodeId: string | undefined;
	let maxBlurDepth: number | undefined;
	const focalLengthMm = effectiveFocalLengthMm(rig);
	const focalLengthScale = clampNumber(focalLengthMm / 50, 0.35, 3);
	const apertureScale = Math.log1p(aperture);
	for (const [nodeId, depth] of nodeCameraDepthById) {
		if (!finite(depth)) continue;
		const focusDelta = Math.abs(depth - focusDistance);
		const subjectDistance = Math.max(DEFAULT_CAMERA_NEAR, Math.abs(depth));
		const focusRatio = focusDelta / Math.max(subjectDistance, focusDistance, 1);
		const nearFieldBoost = subjectDistance < focusDistance ? 1.35 : 1;
		const circleOfConfusion =
			focusRatio * focalLengthScale * apertureScale * nearFieldBoost;
		const blurRadius = Math.min(
			DEFAULT_DOF_MAX_BLUR_RADIUS,
			circleOfConfusion * DOF_BLUR_SCALE,
		);
		if (blurRadius <= DOF_BLUR_THRESHOLD) continue;
		const rounded = Number(blurRadius.toFixed(3));
		blurByNodeId.set(nodeId, rounded);
		const roundedCircleOfConfusion = Number(circleOfConfusion.toFixed(4));
		maxCircleOfConfusion = Math.max(
			maxCircleOfConfusion,
			roundedCircleOfConfusion,
		);
		if (depth < focusDistance) nearBlurredNodeCount += 1;
		else farBlurredNodeCount += 1;
		if (rounded > maxBlurRadius) {
			maxBlurNodeId = nodeId;
			maxBlurDepth = Number(depth.toFixed(3));
		}
		maxBlurRadius = Math.max(maxBlurRadius, rounded);
	}
	const opticalBokehRequired =
		maxBlurRadius >= DOF_OPTICAL_BOKEH_BLUR_THRESHOLD ||
		maxCircleOfConfusion >= DOF_OPTICAL_BOKEH_COC_THRESHOLD;
	return {
		summary: {
			active: blurByNodeId.size > 0,
			focusDistance,
			aperture,
			maxBlurRadius,
			maxCircleOfConfusion,
			blurredNodeCount: blurByNodeId.size,
			nearBlurredNodeCount,
			farBlurredNodeCount,
			...(maxBlurNodeId ? { maxBlurNodeId } : {}),
			...(maxBlurDepth !== undefined ? { maxBlurDepth } : {}),
			fidelity:
				blurByNodeId.size === 0
					? "none"
					: opticalBokehRequired
						? "optical-bokeh-preview-required"
						: "svg-layer-blur-approximation",
			renderer: blurByNodeId.size > 0 ? "svg-layer-blur" : "none",
			opticalModel: blurByNodeId.size > 0 ? "thin-lens-normalized-coc" : "none",
			bokehShape: blurByNodeId.size > 0 ? "circular" : "none",
		},
		blurByNodeId,
	};
};

const runtimeCameraView = ({
	rig,
	basis,
	artboard,
	selectionSource,
	overridden,
	depthOfField,
	fidelity,
	issues,
}: {
	readonly rig: SampledSceneCameraRig;
	readonly basis: CameraBasis;
	readonly artboard: Artboard;
	readonly selectionSource: RuntimeCameraSelectionSource;
	readonly overridden: boolean;
	readonly depthOfField: SceneCameraDepthOfFieldResolution;
	readonly fidelity: Exclude<SceneCameraProjectionFidelity, "none">;
	readonly issues: readonly SceneCameraProjectionIssue[];
}): RuntimeCameraView => {
	const target = rig.target?.point ?? vec3(0, 0, 0);
	const projection = effectiveRuntimeProjection(rig, basis, artboard);
	return {
		cameraRigId: rig.id,
		selectionSource,
		overridden,
		artboardId: artboard.id,
		artboard: { width: artboard.width, height: artboard.height },
		coordinates: {
			worldUnits: "scene-pixels",
			angles: "degrees",
			xAxis: "right",
			yAxis: "down",
			zAxis: "scene-depth",
			fovAxis: "vertical",
			handedness: "right-handed",
			projectionVerticalAxis: "down",
		},
		body: basis.body,
		target,
		basis: {
			right: basis.right,
			up: scale3(basis.up, -1),
			down: basis.up,
			forward: basis.forward,
			targetDistance: basis.targetDistance,
		},
		projection,
		depthOfField,
		fidelity,
		issues: [...issues],
	};
};

export function resolveSceneCameraProjection({
	scene,
	motion,
	frame,
	artboardId = selectCurrentArtboard(scene).id,
	cameraRigIdOverride,
	runtimeControl,
	selectionSourceOverride,
	controls,
}: {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly frame: number;
	readonly artboardId?: string | null;
	readonly cameraRigIdOverride?: string | null;
	readonly runtimeControl?: SceneCameraRuntimeControl;
	readonly selectionSourceOverride?: RuntimeCameraSelectionSource;
	/**
	 * Injected published-control sampler for `control("id")` inside camera-channel
	 * expressions. Built by the layer that owns the documents
	 * (`createProductionControlSampler`), exactly like
	 * `MotionPresentationInput.controls`. Absent → every control reference is
	 * unresolved and the channel keeps its keyframed/authored value.
	 */
	readonly controls?: ProductionControlSampler;
}): SceneCameraProjectionResolution {
	const resolvedArtboardId = artboardId ?? selectCurrentArtboard(scene).id;
	const artboard = findArtboardById(scene, resolvedArtboardId);
	if (!artboard) return EMPTY_CAMERA_RESOLUTION;
	const runtimeCameraRigId = runtimeControl?.activeCameraRigId;
	const hasRuntimeCameraRigId =
		runtimeCameraRigId !== undefined && runtimeCameraRigId !== null;
	const frameCamera = findSceneCameraRigForFrame({
		scene,
		motion,
		artboardId: resolvedArtboardId,
		frame,
		cameraRigIdOverride: hasRuntimeCameraRigId
			? runtimeCameraRigId
			: cameraRigIdOverride,
	});
	const selectionSource: RuntimeCameraSelectionSource =
		selectionSourceOverride ??
		(hasRuntimeCameraRigId
			? "runtime-override"
			: cameraRigIdOverride !== undefined && cameraRigIdOverride !== null
				? "runtime-override"
				: frameCamera.cut
					? "cut"
					: "artboard");
	const activeCameraRig = frameCamera.rig;
	if (!activeCameraRig) {
		if (!frameCamera.requestedCameraRigId) return EMPTY_CAMERA_RESOLUTION;
		return {
			...EMPTY_CAMERA_RESOLUTION,
			requestedCameraRigId: frameCamera.requestedCameraRigId,
			projectionIssues: [
				issue(
					"active-camera-missing",
					`Frame camera "${frameCamera.requestedCameraRigId}" is missing for artboard "${resolvedArtboardId}".`,
					{
						cameraRigId: frameCamera.requestedCameraRigId,
						artboardId: resolvedArtboardId,
						severity: "error",
					},
				),
			],
			fidelity: "invalid",
		};
	}

	const index = buildNodeTransformIndex(scene);
	const issues = [...index.issues];
	const runtimeOverride = runtimeControl?.cameraOverrides?.[activeCameraRig.id];
	const sampledRig = applyRuntimeCameraOverride(
		sampledCameraRig(
			artboard,
			motion,
			activeCameraRig,
			frame,
			index,
			issues,
			createCameraExpressionPass(motion, frame, controls),
		),
		runtimeOverride,
	);
	const basis = cameraBasis(sampledRig, issues);
	if (!basis) {
		return {
			activeCameraRigId: activeCameraRig.id,
			requestedCameraRigId: frameCamera.requestedCameraRigId,
			sampledCameraRig: sampledRig,
			nodeCameraMatrixById: new Map(),
			nodeCameraDepthById: new Map(),
			nodeDepthOfFieldBlurById: new Map(),
			renderLocalMatrixByNodeId: new Map(),
			projectionIssues: issues,
			fidelity: "invalid",
			depthOfField: {
				active: false,
				focusDistance:
					sampledRig.projection.focusDistance ?? DEFAULT_CAMERA_FOCUS_DISTANCE,
				aperture: sampledRig.projection.aperture ?? 0,
				maxBlurRadius: 0,
				maxCircleOfConfusion: 0,
				blurredNodeCount: 0,
				nearBlurredNodeCount: 0,
				farBlurredNodeCount: 0,
				fidelity: "none",
				renderer: "none",
				opticalModel: "none",
				bokehShape: "none",
			},
		};
	}

	const projectedWorldById = new Map<string, Matrix2D>();
	const nodeDepthById = new Map<string, number>();
	for (const [nodeId, node] of index.nodeById) {
		if (selectArtboardIdForNode(scene, nodeId) !== resolvedArtboardId) {
			if (node.depthPlane?.cameraRigId === activeCameraRig.id) {
				issues.push(
					issue(
						"camera-node-outside-scope",
						[
							`Node "${nodeId}" has a depth plane for camera`,
							`"${activeCameraRig.id}" but is outside the active artboard.`,
						].join(" "),
						{
							cameraRigId: activeCameraRig.id,
							artboardId: resolvedArtboardId,
							nodeId,
						},
					),
				);
			}
			continue;
		}
		if (
			node.depthPlane?.cameraRigId &&
			node.depthPlane.cameraRigId !== activeCameraRig.id
		) {
			continue;
		}
		const depth = index.depthById.get(nodeId) ?? 0;
		const world = index.motionWorldById.get(nodeId);
		if (!world) continue;
		const projected = projectMatrix({
			matrix: world,
			depth,
			rig: sampledRig,
			basis,
			artboard,
			issues,
			nodeId,
		});
		if (!projected) continue;
		projectedWorldById.set(nodeId, projected);
		const origin = originForMatrix(world);
		nodeDepthById.set(
			nodeId,
			cameraPoint(vec3(origin.x, origin.y, depth), basis).z,
		);
	}

	const renderLocalById = new Map<string, Matrix2D>();
	for (const [nodeId, projectedWorld] of projectedWorldById) {
		const parentNodeId = index.parentNodeIdById.get(nodeId);
		const parentWorld = parentNodeId
			? (projectedWorldById.get(parentNodeId) ??
				index.structuralWorldById.get(parentNodeId) ??
				IDENTITY_MATRIX)
			: IDENTITY_MATRIX;
		const inverseParent = invertMatrix(parentWorld);
		if (!inverseParent) {
			issues.push(
				issue(
					"camera-render-local-singular",
					`Projected parent matrix for node "${nodeId}" is singular.`,
					{ cameraRigId: activeCameraRig.id, nodeId, severity: "error" },
				),
			);
			continue;
		}
		renderLocalById.set(nodeId, composeMatrix(inverseParent, projectedWorld));
	}
	const depthOfField = resolveDepthOfField(sampledRig, nodeDepthById);
	const fidelity: Exclude<SceneCameraProjectionFidelity, "none"> = issues.some(
		(entry) => entry.severity === "error",
	)
		? "invalid"
		: "svg-affine";

	return {
		activeCameraRigId: activeCameraRig.id,
		requestedCameraRigId: frameCamera.requestedCameraRigId,
		sampledCameraRig: sampledRig,
		cameraView: runtimeCameraView({
			rig: sampledRig,
			basis,
			artboard,
			selectionSource,
			overridden: runtimeOverride !== undefined,
			depthOfField: depthOfField.summary,
			fidelity,
			issues,
		}),
		nodeCameraMatrixById: projectedWorldById,
		nodeCameraDepthById: nodeDepthById,
		nodeDepthOfFieldBlurById: depthOfField.blurByNodeId,
		renderLocalMatrixByNodeId: renderLocalById,
		projectionIssues: issues,
		fidelity,
		depthOfField: depthOfField.summary,
	};
}

const projectNode = (
	node: VectorNode,
	matrices: ReadonlyMap<string, Matrix2D>,
	blurById: ReadonlyMap<string, number>,
): VectorNode => {
	const children = node.children?.map((child) =>
		projectNode(child, matrices, blurById),
	);
	const childrenChanged =
		children?.some((child, index) => child !== node.children?.[index]) ?? false;
	const matrix = matrices.get(node.id);
	const blurRadius = blurById.get(node.id);
	const shouldApplyDepthOfField =
		blurRadius !== undefined &&
		blurRadius > 0 &&
		(node.children?.length ?? 0) === 0;
	if (!matrix && !childrenChanged && !shouldApplyDepthOfField) return node;
	const next = {
		...node,
		...(matrix
			? {
					transform: transformWithPresentationMatrix(
						matrix,
						node.transform.anchor,
					),
				}
			: {}),
		...(shouldApplyDepthOfField
			? {
					style: {
						...node.style,
						effects: [
							...(node.style.effects ?? []),
							{
								kind: "layer-blur" as const,
								radius: blurRadius,
								visible: true,
							},
						],
					},
				}
			: {}),
		...(childrenChanged && children ? { children } : {}),
	};
	return next;
};

/**
 * Writes the keyframe-sampled projection channels (`fovDegrees`, `zoom`,
 * `focusDistance`, `aperture`) for the active camera rig back into the
 * presentation document's own `scene.sceneCameras` entry, so any adapter that
 * reads `SceneDocument.sceneCameras` directly on the sampled presentation
 * scene — today only `compileRuntime3dFrame`'s `cameraForRig`
 * (`entities/scene/model/runtime-3d.ts`) — observes the same per-frame values
 * the 2D camera-projection path above already computed, instead of the raw
 * authored (unsampled) rig. The authored rig contract on the INPUT scene is
 * never mutated; only this presentation copy's entry is replaced.
 */
const writeSampledCameraRigProjection = (
	scene: SceneDocument,
	sampledRig: SampledSceneCameraRig | undefined,
): SceneDocument => {
	if (!sampledRig || !scene.sceneCameras) return scene;
	const index = scene.sceneCameras.findIndex(
		(candidate) => candidate.id === sampledRig.id,
	);
	const existing = index === -1 ? undefined : scene.sceneCameras[index];
	if (!existing) return scene;
	const nextProjection = {
		...existing.projection,
		fovDegrees: sampledRig.projection.fovDegrees,
		zoom: sampledRig.projection.zoom,
		focusDistance: sampledRig.projection.focusDistance,
		aperture: sampledRig.projection.aperture,
	};
	const unchanged =
		nextProjection.fovDegrees === existing.projection.fovDegrees &&
		nextProjection.zoom === existing.projection.zoom &&
		nextProjection.focusDistance === existing.projection.focusDistance &&
		nextProjection.aperture === existing.projection.aperture;
	if (unchanged) return scene;
	const sceneCameras = [...scene.sceneCameras];
	sceneCameras[index] = { ...existing, projection: nextProjection };
	return { ...scene, sceneCameras };
};

const applySceneCameraProjection = (
	scene: SceneDocument,
	projection: SceneCameraProjectionResolution,
): SceneDocument => {
	const sceneWithSampledRig = writeSampledCameraRigProjection(
		scene,
		projection.sampledCameraRig,
	);
	if (
		projection.renderLocalMatrixByNodeId.size === 0 &&
		projection.nodeDepthOfFieldBlurById.size === 0
	) {
		return sceneWithSampledRig;
	}
	let changed = false;
	const layers = sceneWithSampledRig.layers.map((layer) => {
		const nodes = layer.nodes.map((node) =>
			projectNode(
				node,
				projection.renderLocalMatrixByNodeId,
				projection.nodeDepthOfFieldBlurById,
			),
		);
		if (nodes.every((node, index) => node === layer.nodes[index])) return layer;
		changed = true;
		return { ...layer, nodes };
	});
	return changed ? { ...sceneWithSampledRig, layers } : sceneWithSampledRig;
};

const cloneIdentityTransform = (): typeof IDENTITY_TRANSFORM => ({
	position: { ...IDENTITY_TRANSFORM.position },
	rotation: IDENTITY_TRANSFORM.rotation,
	scale: { ...IDENTITY_TRANSFORM.scale },
	anchor: { ...IDENTITY_TRANSFORM.anchor },
});

const CROSSFADE_GROUP_STYLE = {
	fill: "#000000",
	stroke: "#000000",
	strokeWidth: 0,
	opacity: 1,
} as const satisfies VectorNode["style"];

const collectNodeIds = (
	nodes: readonly VectorNode[],
	target: Map<string, string>,
	suffix: string,
): void => {
	for (const node of nodes) {
		target.set(node.id, `${node.id}${suffix}`);
		if (node.children) collectNodeIds(node.children, target, suffix);
	}
};

const remapUnknownNodeReferences = (
	value: unknown,
	idMap: ReadonlyMap<string, string>,
): unknown => {
	if (typeof value === "string") return idMap.get(value) ?? value;
	if (Array.isArray(value)) {
		return value.map((item) => remapUnknownNodeReferences(item, idMap));
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [
				key,
				remapUnknownNodeReferences(item, idMap),
			]),
		);
	}
	return value;
};

const remapCrossfadeComponentOverride = (
	override: ComponentNodeOverride,
	idMap: ReadonlyMap<string, string>,
): ComponentNodeOverride => ({
	...override,
	sourceNodeId: idMap.get(override.sourceNodeId) ?? override.sourceNodeId,
	instanceNodeId: idMap.get(override.instanceNodeId) ?? override.instanceNodeId,
});

const remapCrossfadeInstanceBinding = (
	binding: ComponentInstanceBinding,
	idMap: ReadonlyMap<string, string>,
	symbolIdMap: ReadonlyMap<string, string>,
): ComponentInstanceBinding => ({
	...binding,
	symbolId: symbolIdMap.get(binding.symbolId) ?? binding.symbolId,
	sourceNodeId: idMap.get(binding.sourceNodeId) ?? binding.sourceNodeId,
	sourceToInstanceNodeIds: Object.fromEntries(
		Object.entries(binding.sourceToInstanceNodeIds).map(
			([sourceNodeId, instanceNodeId]) => [
				idMap.get(sourceNodeId) ?? sourceNodeId,
				idMap.get(instanceNodeId) ?? instanceNodeId,
			],
		),
	),
	...(binding.overrides
		? {
				overrides: binding.overrides.map((override) =>
					remapCrossfadeComponentOverride(override, idMap),
				),
			}
		: {}),
});

const remapCrossfadeComponentBinding = (
	component: ComponentNodeBinding | undefined,
	idMap: ReadonlyMap<string, string>,
	symbolIdMap: ReadonlyMap<string, string>,
): ComponentNodeBinding | undefined => {
	if (!component) return undefined;
	if (component.kind === "source") {
		return {
			...component,
			symbolId: symbolIdMap.get(component.symbolId) ?? component.symbolId,
		};
	}
	return remapCrossfadeInstanceBinding(component, idMap, symbolIdMap);
};

const suffixedNode = (
	node: VectorNode,
	idMap: ReadonlyMap<string, string>,
	symbolIdMap: ReadonlyMap<string, string>,
): VectorNode => ({
	...node,
	id: idMap.get(node.id) ?? node.id,
	...(node.component
		? {
				component: remapCrossfadeComponentBinding(
					node.component,
					idMap,
					symbolIdMap,
				),
			}
		: {}),
	...(node.motionParent
		? {
				motionParent: {
					...node.motionParent,
					parentNodeId:
						idMap.get(node.motionParent.parentNodeId) ??
						node.motionParent.parentNodeId,
				},
			}
		: {}),
	...(node.textFragmentGroup
		? {
				textFragmentGroup: {
					...node.textFragmentGroup,
					members: node.textFragmentGroup.members.map((member) => ({
						...member,
						nodeId: idMap.get(member.nodeId) ?? member.nodeId,
					})),
				},
			}
		: {}),
	...(node.blend
		? {
				blend: {
					...node.blend,
					sourceNodeIds: node.blend.sourceNodeIds.map(
						(nodeId) => idMap.get(nodeId) ?? nodeId,
					),
					generatedNodeIds: node.blend.generatedNodeIds.map(
						(nodeId) => idMap.get(nodeId) ?? nodeId,
					),
					...(node.blend.sourceStops
						? {
								sourceStops: node.blend.sourceStops.map((stop) => ({
									...stop,
									nodeId: idMap.get(stop.nodeId) ?? stop.nodeId,
								})),
							}
						: {}),
				},
			}
		: {}),
	...(node.blendStep
		? {
				blendStep: {
					...node.blendStep,
					blendNodeId:
						idMap.get(node.blendStep.blendNodeId) ?? node.blendStep.blendNodeId,
				},
			}
		: {}),
	...(node.data
		? {
				data: remapUnknownNodeReferences(node.data, idMap) as Record<
					string,
					unknown
				>,
			}
		: {}),
	...(node.children
		? {
				children: node.children.map((child) =>
					suffixedNode(child, idMap, symbolIdMap),
				),
			}
		: {}),
});

const crossfadeGroupNode = ({
	id,
	name,
	nodes,
	opacity,
	role,
}: {
	readonly id: string;
	readonly name: string;
	readonly nodes: readonly VectorNode[];
	readonly opacity: number;
	readonly role: "from" | "to";
}): VectorNode => ({
	id,
	name,
	geometry: {
		kind: "line",
		start: { x: 0, y: 0 },
		end: { x: 0, y: 0 },
	},
	transform: cloneIdentityTransform(),
	style: { ...CROSSFADE_GROUP_STYLE, opacity },
	visible: true,
	locked: true,
	children: nodes,
	data: {
		sceneCameraCrossfade: {
			role,
			opacity,
		},
	},
});

const crossfadeSuffix = (role: "from" | "to"): string =>
	`__camera_crossfade_${role}`;

/**
 * Maps a sampled camera-crossfade copy back to its durable Vecmo node id.
 * Presentation copies remain renderer-only; selection must never persist them.
 */
export const sourceNodeIdForCameraCrossfadePresentation = (
	nodeId: string,
): string => {
	for (const role of ["from", "to"] as const) {
		const suffix = crossfadeSuffix(role);
		if (nodeId.endsWith(suffix)) return nodeId.slice(0, -suffix.length);
	}
	return nodeId;
};

const crossfadeNodeIdMap = (
	scene: SceneDocument,
	role: "from" | "to",
): ReadonlyMap<string, string> => {
	const idMap = new Map<string, string>();
	const suffix = crossfadeSuffix(role);
	for (const layer of scene.layers) collectNodeIds(layer.nodes, idMap, suffix);
	return idMap;
};

const crossfadeSymbolIdMap = (
	scene: SceneDocument,
	role: "from" | "to",
): ReadonlyMap<string, string> => {
	const idMap = new Map<string, string>();
	const suffix = crossfadeSuffix(role);
	for (const symbol of scene.componentSymbols ?? []) {
		idMap.set(symbol.id, `${symbol.id}${suffix}`);
	}
	return idMap;
};

const crossfadeLayersForScene = (
	scene: SceneDocument,
	role: "from" | "to",
	opacity: number,
	idMap: ReadonlyMap<string, string>,
	symbolIdMap: ReadonlyMap<string, string>,
): readonly SceneLayer[] => {
	const suffix = crossfadeSuffix(role);
	return scene.layers.map((layer) => {
		const nodes = layer.nodes.map((node) =>
			suffixedNode(node, idMap, symbolIdMap),
		);
		return {
			...layer,
			id: `${layer.id}${suffix}`,
			name: `${layer.name} ${role === "from" ? "Camera A" : "Camera B"}`,
			nodes:
				nodes.length > 0
					? [
							crossfadeGroupNode({
								id: `${layer.id}${suffix}_group`,
								name: `${layer.name} camera ${role}`,
								nodes,
								opacity,
								role,
							}),
						]
					: [],
		};
	});
};

const crossfadeComponentSymbolsForScene = (
	scene: SceneDocument,
	role: "from" | "to",
	idMap: ReadonlyMap<string, string>,
	symbolIdMap: ReadonlyMap<string, string>,
): readonly ComponentSymbol[] =>
	(scene.componentSymbols ?? []).map((symbol) => ({
		...symbol,
		id: symbolIdMap.get(symbol.id) ?? symbol.id,
		sourceNodeId: idMap.get(symbol.sourceNodeId) ?? symbol.sourceNodeId,
		name: `${symbol.name} ${role === "from" ? "Camera A" : "Camera B"}`,
	}));

const remapScopedLookTargets = (
	look: ScopedEffectLook,
	idMap: ReadonlyMap<string, string>,
	role: "from" | "to",
): ScopedEffectLook => ({
	...look,
	id: `${look.id}${crossfadeSuffix(role)}`,
	targetNodeIds: look.targetNodeIds.map(
		(nodeId) => idMap.get(nodeId) ?? nodeId,
	),
});

const remapEffectIntentScopedLooks = (
	intent: EffectIntent | undefined,
	fromIdMap: ReadonlyMap<string, string>,
	toIdMap: ReadonlyMap<string, string>,
): EffectIntent | undefined => {
	if (!intent?.scopedLooks) return intent;
	return {
		...intent,
		scopedLooks: [
			...intent.scopedLooks.map((look) =>
				remapScopedLookTargets(look, fromIdMap, "from"),
			),
			...intent.scopedLooks.map((look) =>
				remapScopedLookTargets(look, toIdMap, "to"),
			),
		],
	};
};

const remapArtboardEffectIntentScopedLooks = (
	artboard: Artboard,
	fromIdMap: ReadonlyMap<string, string>,
	toIdMap: ReadonlyMap<string, string>,
): Artboard => {
	const effectIntent = remapEffectIntentScopedLooks(
		artboard.effectIntent,
		fromIdMap,
		toIdMap,
	);
	return effectIntent === artboard.effectIntent
		? artboard
		: { ...artboard, effectIntent };
};

const projectSceneForCameraRig = ({
	scene,
	motion,
	frame,
	artboardId,
	cameraRigId,
	runtimeControl,
	selectionSource,
	controls,
}: {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly frame: number;
	readonly artboardId?: string | null;
	readonly cameraRigId: string;
	readonly runtimeControl?: SceneCameraRuntimeControl;
	readonly selectionSource: "artboard" | "cut";
	readonly controls?: ProductionControlSampler;
}): {
	readonly scene: SceneDocument;
	readonly resolution: SceneCameraProjectionResolution;
} => {
	const resolution = resolveSceneCameraProjection({
		scene,
		motion,
		frame,
		artboardId,
		cameraRigIdOverride: cameraRigId,
		runtimeControl: {
			cameraOverrides: runtimeControl?.cameraOverrides,
		},
		selectionSourceOverride: selectionSource,
		controls,
	});
	return {
		scene: applySceneCameraProjection(scene, resolution),
		resolution,
	};
};

const cameraStateFromResolution = (
	resolution: SceneCameraProjectionResolution,
	artboardId: string,
): RuntimeCameraState => {
	if (resolution.cameraView) {
		return { kind: "single", view: resolution.cameraView };
	}
	if (!resolution.requestedCameraRigId) {
		return { kind: "none", artboardId, fidelity: "none", issues: [] };
	}
	return {
		kind: "invalid",
		artboardId,
		requestedCameraRigId: resolution.requestedCameraRigId,
		fidelity: "invalid",
		issues: resolution.projectionIssues,
	};
};

const projectSceneThroughCameraCrossfade = ({
	scene,
	motion,
	frame,
	artboardId,
	crossfade,
	runtimeControl,
	controls,
}: {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly frame: number;
	readonly artboardId?: string | null;
	readonly crossfade: CameraCutCrossfadeFrame;
	readonly runtimeControl?: SceneCameraRuntimeControl;
	readonly controls?: ProductionControlSampler;
}): SceneCameraPresentation => {
	const resolvedArtboardId = artboardId ?? selectCurrentArtboard(scene).id;
	const progress = clampNumber(crossfade.progress, 0, 1);
	const from = projectSceneForCameraRig({
		scene,
		motion,
		frame,
		artboardId,
		cameraRigId: crossfade.fromCameraRigId,
		runtimeControl,
		selectionSource: crossfade.fromSelectionSource,
		controls,
	});
	const to = projectSceneForCameraRig({
		scene,
		motion,
		frame,
		artboardId,
		cameraRigId: crossfade.toCameraRigId,
		runtimeControl,
		selectionSource: "cut",
	});
	const fromScene = from.scene;
	const toScene = to.scene;
	const fromIdMap = crossfadeNodeIdMap(fromScene, "from");
	const toIdMap = crossfadeNodeIdMap(toScene, "to");
	const fromSymbolIdMap = crossfadeSymbolIdMap(fromScene, "from");
	const toSymbolIdMap = crossfadeSymbolIdMap(toScene, "to");
	const sceneEffectIntent = remapEffectIntentScopedLooks(
		scene.effectIntent,
		fromIdMap,
		toIdMap,
	);
	const componentSymbols = [
		...crossfadeComponentSymbolsForScene(
			fromScene,
			"from",
			fromIdMap,
			fromSymbolIdMap,
		),
		...crossfadeComponentSymbolsForScene(toScene, "to", toIdMap, toSymbolIdMap),
	];
	const blendedScene: SceneDocument = {
		...scene,
		artboard: remapArtboardEffectIntentScopedLooks(
			scene.artboard,
			fromIdMap,
			toIdMap,
		),
		...(scene.artboards
			? {
					artboards: scene.artboards.map((artboard) =>
						remapArtboardEffectIntentScopedLooks(artboard, fromIdMap, toIdMap),
					),
				}
			: {}),
		...(sceneEffectIntent ? { effectIntent: sceneEffectIntent } : {}),
		...(componentSymbols.length > 0 ? { componentSymbols } : {}),
		layers: [
			...crossfadeLayersForScene(
				fromScene,
				"from",
				1 - progress,
				fromIdMap,
				fromSymbolIdMap,
			),
			...crossfadeLayersForScene(
				toScene,
				"to",
				progress,
				toIdMap,
				toSymbolIdMap,
			),
		],
	};
	const projectedScene =
		progress <= 0 ? fromScene : progress >= 1 ? toScene : blendedScene;
	const fromView = from.resolution.cameraView;
	const toView = to.resolution.cameraView;
	if (!fromView || !toView) {
		return {
			scene: projectedScene,
			camera: {
				kind: "invalid",
				artboardId: resolvedArtboardId,
				requestedCameraRigId: !fromView
					? crossfade.fromCameraRigId
					: crossfade.toCameraRigId,
				fidelity: "invalid",
				issues: [
					...from.resolution.projectionIssues,
					...to.resolution.projectionIssues,
				],
			},
		};
	}
	return {
		scene: projectedScene,
		camera: { kind: "crossfade", from: fromView, to: toView, progress },
	};
};

export function sampleSceneCameraPresentation({
	scene,
	motion,
	frame,
	artboardId,
	runtimeControl,
	motionRelationRestScene,
	controls,
}: {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly frame: number;
	readonly artboardId?: string | null;
	readonly runtimeControl?: SceneCameraRuntimeControl;
	readonly motionRelationRestScene?: SceneDocument;
	/** Injected published-control sampler; see `resolveSceneCameraProjection`. */
	readonly controls?: ProductionControlSampler;
}): SceneCameraPresentation {
	const relationPresentation = applyMotionRelationsToScene({
		restScene: motionRelationRestScene,
		sampledScene: scene,
		stripBindings: true,
	});
	const presentationScene = relationPresentation.scene;
	const resolvedArtboardId =
		artboardId ?? selectCurrentArtboard(presentationScene).id;
	if (!findArtboardById(presentationScene, resolvedArtboardId)) {
		return {
			scene: restoreMotionParentBindings(scene, presentationScene),
			motionRelationIssues: relationPresentation.resolution.issues,
			camera: {
				kind: "invalid",
				artboardId: resolvedArtboardId,
				fidelity: "invalid",
				issues: [
					issue(
						"camera-artboard-missing",
						`Camera presentation artboard "${resolvedArtboardId}" is missing.`,
						{ artboardId: resolvedArtboardId, severity: "error" },
					),
				],
			},
		};
	}
	if (
		runtimeControl?.activeCameraRigId === undefined ||
		runtimeControl.activeCameraRigId === null
	) {
		const crossfade = resolveCameraCutCrossfadeFrame({
			scene: presentationScene,
			motion,
			artboardId: resolvedArtboardId,
			frame,
		});
		if (crossfade) {
			const presentation = projectSceneThroughCameraCrossfade({
				scene: presentationScene,
				motion,
				frame,
				artboardId: resolvedArtboardId,
				crossfade,
				runtimeControl,
				controls,
			});
			return {
				...presentation,
				scene: restoreMotionParentBindings(scene, presentation.scene),
				motionRelationIssues: relationPresentation.resolution.issues,
			};
		}
	}
	const projection = resolveSceneCameraProjection({
		scene: presentationScene,
		motion,
		frame,
		artboardId: resolvedArtboardId,
		runtimeControl,
		controls,
	});
	return {
		scene: restoreMotionParentBindings(
			scene,
			applySceneCameraProjection(presentationScene, projection),
		),
		camera: cameraStateFromResolution(projection, resolvedArtboardId),
		motionRelationIssues: relationPresentation.resolution.issues,
	};
}

export function projectSceneThroughActiveCamera({
	scene,
	motion,
	frame,
	artboardId,
	controls,
}: {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly frame: number;
	readonly artboardId?: string | null;
	/** Injected published-control sampler; see `resolveSceneCameraProjection`. */
	readonly controls?: ProductionControlSampler;
}): SceneDocument {
	return sampleSceneCameraPresentation({
		scene,
		motion,
		frame,
		artboardId,
		controls,
	}).scene;
}
