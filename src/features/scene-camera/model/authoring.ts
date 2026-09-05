import {
	type CameraParallaxRoleGroups,
	type CameraVerbResult,
	planCameraOrbit2_5d,
	planCameraParallaxEstablish,
	planCameraPushIn,
} from "@/entities/camera-motion/model/camera-verbs";
import {
	removeCameraCutSegment,
	removeCameraRigKeyframe,
	removeCameraRigTrack,
	removeCameraRigTracks,
	retimeCameraCutSegment,
	upsertCameraCutSegment,
	upsertCameraRigKeyframe,
	upsertCameraRigVectorKeyframes,
} from "@/entities/motion/model/camera-commands";
import type { MotionCommand } from "@/entities/motion/model/command";
import { useMotionStore } from "@/entities/motion/model/store";
import type {
	CameraCutSegment,
	CameraRigAnimatableProperty,
	MotionDocument,
} from "@/entities/motion/model/types";
import type { SceneCommand } from "@/entities/scene/model/command";
import { findActiveSceneCameraRig } from "@/entities/scene/model/scene-camera";
import {
	readSceneCameraAuthoringState,
	type SceneCameraDepthPreset,
	sceneCameraDepthPlaneForPreset,
} from "@/entities/scene/model/scene-camera-authoring";
import {
	type BuildMotionControllerNodeOptions,
	type BuildSceneCameraRigOptions,
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
	type SceneCameraRigPatch,
} from "@/entities/scene/model/scene-camera-commands";
import { findArtboardById } from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import type {
	MotionParentBinding,
	SceneCameraRigContract,
	SceneDocument,
} from "@/entities/scene/model/types";
import { createId } from "@/shared/lib/id";

/** Pure command bundle returned by camera UI and agent/MCP authoring actions. */
export type SceneCameraAuthoringCommandPlan = {
	readonly sceneCommands: readonly SceneCommand[];
	readonly motionCommands: readonly MotionCommand[];
	readonly sceneTransaction?: {
		readonly coalesceKey: string;
		readonly label: string;
	};
	readonly cameraRigId?: string;
	readonly targetControllerNodeId?: string;
	readonly controllerNodeId?: string;
	readonly artboardId?: string;
};

/**
 * Applies a scene-camera authoring plan through the existing scene/motion command
 * buses. Plans that touch both stores receive a shared compound id so global undo
 * keeps camera deletion and any side-car track cleanup atomic.
 */
export function commitSceneCameraAuthoringPlan(
	plan: SceneCameraAuthoringCommandPlan,
): void {
	const sceneStore = useSceneStore.getState();
	const motionStore = useMotionStore.getState();
	const hasSceneCommands = plan.sceneCommands.length > 0;
	const hasMotionCommands = plan.motionCommands.length > 0;
	const compoundId =
		hasSceneCommands && hasMotionCommands
			? createId("scene-camera")
			: undefined;

	const sceneCommands = compoundId
		? plan.sceneCommands.map((command) => ({ ...command, compoundId }))
		: plan.sceneCommands;
	const motionCommands = compoundId
		? plan.motionCommands.map((command) => ({ ...command, compoundId }))
		: plan.motionCommands;

	if (sceneCommands.length === 1 || !plan.sceneTransaction || compoundId) {
		for (const command of sceneCommands) sceneStore.apply(command);
	} else if (sceneCommands.length > 1) {
		sceneStore.beginTransaction(
			plan.sceneTransaction.coalesceKey,
			plan.sceneTransaction.label,
		);
		for (const command of sceneCommands) sceneStore.apply(command);
		sceneStore.commit();
	}

	for (const command of motionCommands) motionStore.apply(command);
}

/** Options for the first-create camera action. */
export type CreateSceneCameraAuthoringPlanOptions =
	BuildSceneCameraRigOptions & {
		readonly withTargetController?: boolean;
		readonly targetController?: BuildMotionControllerNodeOptions;
	};

/**
 * Creates the first GUI-facing command plan for a scene camera. It returns
 * pre-minted ids so UI surfaces can select the camera/controller after applying
 * the commands without reading private command internals.
 */
export function createSceneCameraForArtboardAuthoringPlan(
	scene: SceneDocument,
	options: CreateSceneCameraAuthoringPlanOptions = {},
): SceneCameraAuthoringCommandPlan | null {
	const targetControllerArtboardId =
		options.artboardId ?? options.targetController?.artboardId;
	const targetController = options.withTargetController
		? buildMotionControllerNode(scene, {
				...options.targetController,
				...(targetControllerArtboardId
					? { artboardId: targetControllerArtboardId }
					: {}),
				name: options.targetController?.name ?? "Camera Target",
			})
		: null;
	const targetControllerNodeId =
		targetController?.id ?? options.targetControllerNodeId;
	const rig = buildSceneCameraRigForArtboard(scene, {
		...options,
		...(targetControllerNodeId ? { targetControllerNodeId } : {}),
	});
	if (!rig) return null;
	const artboardId =
		rig.scope.kind === "artboard" ? rig.scope.artboardId : undefined;
	return {
		sceneCommands: [
			...(targetController
				? [createAddMotionControllerNodeCommand(targetController)]
				: []),
			createAddSceneCameraCommand(rig, {
				activateArtboardId:
					rig.scope.kind === "artboard" ? rig.scope.artboardId : null,
			}),
		],
		motionCommands: [],
		...(targetController
			? {
					sceneTransaction: {
						coalesceKey: `scene-camera:create:${rig.id}`,
						label: "Create scene camera",
					},
				}
			: {}),
		cameraRigId: rig.id,
		...(targetController
			? { targetControllerNodeId: targetController.id }
			: {}),
		...(artboardId ? { artboardId } : {}),
	};
}

/**
 * Default vertical field of view (degrees) for a perspective camera created by
 * {@link ensureSceneCamera}. Matches the projection resolver's
 * `DEFAULT_CAMERA_FOV_DEGREES` so a freshly ensured perspective rig frames the
 * scene the same way the sampler's own fallback does.
 */
const ENSURE_PERSPECTIVE_FOV_DEGREES = 50;

/** Options for {@link ensureSceneCamera} / {@link createEnsureSceneCameraAuthoringPlan}. */
export type EnsureSceneCameraOptions = {
	/** Artboard to ensure a camera for; defaults to the document's current artboard. */
	readonly artboardId?: string;
	/**
	 * Projection applied ONLY when a new camera is created. `"orthographic"`
	 * (default) yields the identity rig `buildSceneCameraRigForArtboard` produces;
	 * `"perspective"` yields the z=0 exact-framing rig. Ignored when an active
	 * camera already exists — ensure only guarantees a camera exists, it never
	 * reconfigures the projection of an existing one (that would break idempotency).
	 */
	readonly projection?: "orthographic" | "perspective";
};

/** Result of {@link ensureSceneCamera}. */
export type EnsureSceneCameraResult = {
	readonly cameraRigId: string;
	/** `false` when an active camera already existed (the call was a no-op). */
	readonly created: boolean;
	readonly artboardId: string;
};

/**
 * Builds a perspective rig whose z=0 plane stays exactly framed — screen-space
 * scale 1, no shift — versus the identity ortho camera, so switching a flat
 * scene to perspective is visually neutral until depth planes or camera motion
 * are added.
 *
 * From the projection sampler's perspective branch, a point at camera-space
 * depth `d` renders at scale `focal * zoom / d`, with
 * `focal = artboard.height / 2 / tan(fov / 2)`. The rig looks down the optical
 * axis through the artboard center at the z=0 center target, so the z=0 plane
 * sits at camera-space depth `|bodyZ|`. Choosing `zoom = 1` and `bodyZ = -focal`
 * makes that depth's scale `focal * 1 / focal = 1` — the spec's
 * `body distance = focal / zoom` exact-framing law.
 */
const buildPerspectiveExactFramingRig = (
	scene: SceneDocument,
	artboardId: string,
): SceneCameraRigContract | null => {
	const artboard = findArtboardById(scene, artboardId);
	if (!artboard) return null;
	const halfFovRadians = (ENSURE_PERSPECTIVE_FOV_DEGREES * Math.PI) / 360;
	const focal = artboard.height / 2 / Math.tan(halfFovRadians);
	return buildSceneCameraRigForArtboard(scene, {
		artboardId,
		projection: {
			kind: "perspective",
			fovDegrees: ENSURE_PERSPECTIVE_FOV_DEGREES,
			zoom: 1,
		},
		bodyPosition: { z: -focal },
	});
};

/**
 * Idempotent plan for guaranteeing one artboard has an active scene camera.
 * Returns an empty (no-op) plan carrying the existing rig id when the artboard
 * already has an active camera; otherwise a single add-and-activate command for
 * a fresh default rig (ortho identity, or the perspective exact-framing rig when
 * `options.projection === "perspective"`). Pure — callers commit via
 * {@link commitSceneCameraAuthoringPlan}; the `created` flag reports whether the
 * plan carries work. Returns `null` only when the artboard is missing or the rig
 * cannot be built.
 */
export function createEnsureSceneCameraAuthoringPlan(
	scene: SceneDocument,
	options: EnsureSceneCameraOptions = {},
): // Narrow the optional plan ids to required: this builder always resolves both.
	| (SceneCameraAuthoringCommandPlan & {
			readonly cameraRigId: string;
			readonly artboardId: string;
			readonly created: boolean;
	  })
	| null {
	const artboardId =
		options.artboardId ?? scene.currentArtboardId ?? scene.artboard.id;
	const existing = findActiveSceneCameraRig(scene, artboardId);
	if (existing) {
		return {
			sceneCommands: [],
			motionCommands: [],
			cameraRigId: existing.id,
			artboardId,
			created: false,
		};
	}
	const rig =
		options.projection === "perspective"
			? buildPerspectiveExactFramingRig(scene, artboardId)
			: buildSceneCameraRigForArtboard(scene, { artboardId });
	if (!rig) return null;
	return {
		sceneCommands: [
			createAddSceneCameraCommand(rig, { activateArtboardId: artboardId }),
		],
		motionCommands: [],
		cameraRigId: rig.id,
		artboardId,
		created: true,
	};
}

/**
 * Idempotent facade guaranteeing the (current or given) artboard has an active
 * scene camera, applying one undoable command-bus transaction only when a camera
 * must be created and no-op — returning the existing rig id with `created:
 * false` — when an active camera is already present. Returns `null` when the
 * artboard is missing or the rig cannot be built.
 *
 * `options.projection` only affects a freshly created camera (see
 * {@link EnsureSceneCameraOptions}); an existing camera's projection is never
 * changed. Reserved for the just-in-time supply point (Phase P4) and camera-verb
 * preconditions — deliberately not a new agent command kind (the existing
 * `scene/add-scene-camera` + `scene/set-active-scene-camera` pair covers agents).
 */
export function ensureSceneCamera(
	options: EnsureSceneCameraOptions = {},
): EnsureSceneCameraResult | null {
	const scene = useSceneStore.getState().document;
	const plan = createEnsureSceneCameraAuthoringPlan(scene, options);
	if (!plan) return null;
	if (plan.created) commitSceneCameraAuthoringPlan(plan);
	return {
		cameraRigId: plan.cameraRigId,
		created: plan.created,
		artboardId: plan.artboardId,
	};
}

/** Input for {@link ensureSceneCameraBeforeSpatialAuthoring}. */
export type JustInTimeSceneCameraOptions = {
	readonly artboardId: string;
	/**
	 * Whether the write this call guards is spatial motion (per
	 * `entities/motion/model/camera-standard.ts`'s shared vocabulary, or — for
	 * motion-grammar technique application — the plan's uniform-over-trigger
	 * choice; see the call site). `false` short-circuits to a no-op so
	 * opacity/look-only authoring never provisions a camera.
	 */
	readonly isSpatial: boolean;
};

/** Result of {@link ensureSceneCameraBeforeSpatialAuthoring}. */
export type JustInTimeSceneCameraResult =
	| { readonly ensured: false }
	| {
			readonly ensured: true;
			readonly cameraRigId: string;
			/** Fold this onto the caller's own about-to-commit command(s) — see the function doc. */
			readonly compoundId: string;
	  };

/**
 * Just-in-time camera-first guard for GUI authoring entries (Phase P4:
 * `docs/3d-camera-motion-standards-plan.md` §4 P4). Widget-layer authoring
 * entries call this immediately before committing spatial motion — a
 * transform/opacity keyframe restricted to a spatial field, a motion-grammar
 * technique apply, or a position-path enable — so a scene camera exists the
 * moment spatial motion authoring starts on an artboard, never at
 * document/artboard creation (`seed-scene.ts` stays untouched; this product is
 * also an illustration tool and a static logo document must not grow a
 * camera).
 *
 * No-ops (`{ ensured: false }`, no store write) when `options.isSpatial` is
 * false, the artboard is missing, the artboard already has an active camera
 * ({@link createEnsureSceneCameraAuthoringPlan}'s own idempotence — repeat
 * calls on the same artboard are free), or the artboard declares
 * `cameraSpacePolicy: "screen_2d"` (the same escape hatch the
 * `agent.motion-without-scene-camera` validation rule recognizes).
 *
 * When a camera must be created, this commits it immediately as its own
 * scene-store history entry tagged with a fresh `compoundId`, then returns
 * that id. Callers MUST fold the returned `compoundId` onto their own
 * about-to-commit write for the compound-undo precedent
 * (`commitSceneCameraAuthoringPlan`/`applyCameraVerb` in this file;
 * `features/motion-parenting/model/authoring.ts`'s
 * `commitMotionRelationAuthoringPlan`) to apply here too: spread it onto a
 * single command (`{ ...command, compoundId }`) before `apply`, or — when
 * coalescing more than one command into one history entry — pass it as
 * `beginTransaction`'s third argument instead (tagging individual commands
 * inside an open transaction has no effect on the coalesced entry's own
 * metadata; the transaction's own `compoundId` argument is what the store
 * records). Either way the global undo coordinator
 * (`features/history/model/undo-coordinator.ts`) then reverts the camera and
 * the authored motion together in one step, since it fans a compound across
 * stores by matching each store's top-of-stack `compoundId`.
 */
export function ensureSceneCameraBeforeSpatialAuthoring(
	options: JustInTimeSceneCameraOptions,
): JustInTimeSceneCameraResult {
	if (!options.isSpatial) return { ensured: false };
	const scene = useSceneStore.getState().document;
	const artboard = findArtboardById(scene, options.artboardId);
	if (!artboard || artboard.cameraSpacePolicy === "screen_2d") {
		return { ensured: false };
	}
	const plan = createEnsureSceneCameraAuthoringPlan(scene, {
		artboardId: options.artboardId,
	});
	if (!plan?.created) return { ensured: false };
	const compoundId = createId("camera-just-in-time");
	for (const command of plan.sceneCommands) {
		useSceneStore.getState().apply({ ...command, compoundId });
	}
	return { ensured: true, cameraRigId: plan.cameraRigId, compoundId };
}

/** Discriminated input for {@link applyCameraVerb}, one variant per camera verb. */
export type ApplyCameraVerbInput =
	| {
			readonly verbId: "camera-push-in";
			readonly subjectIds: readonly string[];
			readonly artboardId?: string;
			readonly startFrame?: number;
			readonly durationFrames?: number;
			readonly mode?: "zoom" | "dolly";
	  }
	| {
			readonly verbId: "camera-parallax-establish";
			readonly roleGroups: CameraParallaxRoleGroups;
			readonly artboardId?: string;
			readonly startFrame?: number;
			readonly durationFrames?: number;
	  }
	| {
			readonly verbId: "camera-orbit-2_5d";
			readonly subjectIds: readonly string[];
			readonly artboardId?: string;
			readonly startFrame?: number;
			readonly durationFrames?: number;
			readonly sweepDegrees?: number;
	  };

const planCameraVerbForInput = (
	scene: SceneDocument,
	motion: MotionDocument,
	input: ApplyCameraVerbInput,
): CameraVerbResult => {
	switch (input.verbId) {
		case "camera-push-in":
			return planCameraPushIn({ scene, motion, ...input });
		case "camera-parallax-establish":
			return planCameraParallaxEstablish({ scene, motion, ...input });
		case "camera-orbit-2_5d":
			return planCameraOrbit2_5d({ scene, motion, ...input });
	}
};

/** Blocked or applied outcome of {@link applyCameraVerb}. */
export type ApplyCameraVerbResult =
	| {
			readonly status: "ready";
			readonly cameraRigId: string;
			readonly artboardId: string;
	  }
	| { readonly status: "blocked"; readonly reason: string };

const CAMERA_VERB_LABELS: Record<ApplyCameraVerbInput["verbId"], string> = {
	"camera-push-in": "Camera push-in",
	"camera-parallax-establish": "Camera parallax establish",
	"camera-orbit-2_5d": "Camera orbit",
};

/**
 * Applies one camera verb (push-in / parallax-establish / orbit) as a single
 * undoable authoring beat. Runs the pure planner against the live scene+motion
 * documents, then commits each store's slice of the verb as a compound-tagged
 * transaction (so multiple commands per store collapse into one entry) under a
 * shared compound id. The global undo coordinator reverses every store that
 * shares that id atomically, so one undo reverts the whole verb — the scene side
 * (projection switch / depth-plane / ensure-camera), the motion side (sparse
 * camera-track keys), or both, including the motion-only case (a push-in on an
 * already-compatible camera emits no scene command). The emitted keys are
 * ordinary camera-track keyframes, editable in the Timeline camera lanes.
 * Returns the planner's blocked reason instead of mutating when it cannot
 * proceed (e.g. no resolvable subject).
 */
export function applyCameraVerb(
	input: ApplyCameraVerbInput,
): ApplyCameraVerbResult {
	const scene = useSceneStore.getState().document;
	const motion = useMotionStore.getState().document;
	const result = planCameraVerbForInput(scene, motion, input);
	if (result.status === "blocked") {
		return { status: "blocked", reason: result.reason };
	}
	const compoundId = createId("camera-verb");
	const label = CAMERA_VERB_LABELS[input.verbId];
	const sceneStore = useSceneStore.getState();
	const motionStore = useMotionStore.getState();
	if (result.sceneCommands.length > 0) {
		sceneStore.beginTransaction(
			`camera-verb-scene:${compoundId}`,
			label,
			compoundId,
		);
		for (const command of result.sceneCommands) sceneStore.apply(command);
		sceneStore.commit();
	}
	if (result.motionCommands.length > 0) {
		motionStore.beginTransaction(
			`camera-verb-motion:${compoundId}`,
			label,
			compoundId,
		);
		for (const command of result.motionCommands) motionStore.apply(command);
		motionStore.commit();
	}
	return {
		status: "ready",
		cameraRigId: result.cameraRigId,
		artboardId: result.artboardId,
	};
}

/** Builds the command plan for creating a standalone camera/null controller. */
export function createMotionControllerAuthoringPlan(
	scene: SceneDocument,
	options: BuildMotionControllerNodeOptions = {},
): SceneCameraAuthoringCommandPlan | null {
	const controller = buildMotionControllerNode(scene, options);
	if (!controller) return null;
	return {
		sceneCommands: [createAddMotionControllerNodeCommand(controller)],
		motionCommands: [],
		controllerNodeId: controller.id,
		...(controller.artboardId ? { artboardId: controller.artboardId } : {}),
	};
}

/** Creates a target/null controller and binds it to an existing scene camera. */
export function createTargetControllerForSceneCameraAuthoringPlan(
	scene: SceneDocument,
	cameraRigId: string,
	options: BuildMotionControllerNodeOptions = {},
): SceneCameraAuthoringCommandPlan | null {
	const camera = readSceneCameraAuthoringState(
		scene,
		options.artboardId ?? undefined,
	).cameras.find((candidate) => candidate.rig.id === cameraRigId);
	if (!camera) return null;
	const controller = buildMotionControllerNode(scene, {
		name: "Camera Target",
		...options,
		position: options.position ?? camera.target.point,
	});
	if (!controller) return null;
	const controllerPosition = {
		x: controller.transform.position.x,
		y: controller.transform.position.y,
		z: controller.depthPlane?.z ?? 0,
	};
	const localTargetPoint = {
		x: camera.target.point.x - controllerPosition.x,
		y: camera.target.point.y - controllerPosition.y,
		z: camera.target.point.z - controllerPosition.z,
	};
	return {
		sceneCommands: [
			createAddMotionControllerNodeCommand(controller),
			createUpdateSceneCameraCommand(
				cameraRigId,
				{
					target: {
						point: localTargetPoint,
						nodeId: null,
						parentControllerNodeId: controller.id,
					},
				},
				{ label: "Bind camera target null" },
			),
		],
		motionCommands: [],
		sceneTransaction: {
			coalesceKey: `scene-camera:create-target-controller:${cameraRigId}:${controller.id}`,
			label: "Create camera target null",
		},
		cameraRigId,
		targetControllerNodeId: controller.id,
		controllerNodeId: controller.id,
		...(controller.artboardId ? { artboardId: controller.artboardId } : {}),
	};
}

/** Clears any target binding while preserving its current effective position. */
export function createClearSceneCameraTargetAuthoringPlan(
	scene: SceneDocument,
	cameraRigId: string,
): SceneCameraAuthoringCommandPlan {
	const target = readSceneCameraAuthoringState(scene).cameras.find(
		(candidate) => candidate.rig.id === cameraRigId,
	)?.target.point;
	return {
		sceneCommands: [
			createUpdateSceneCameraCommand(
				cameraRigId,
				{
					target: {
						...(target ? { point: target } : {}),
						nodeId: null,
						parentControllerNodeId: null,
					},
				},
				{ label: "Clear camera target" },
			),
		],
		motionCommands: [],
		cameraRigId,
	};
}

/** Builds the command plan for marking or unmarking an existing node as a null. */
export function createSetMotionControllerAuthoringPlan({
	nodeId,
	enabled,
	handleRadius,
}: {
	readonly nodeId: string;
	readonly enabled: boolean;
	readonly handleRadius?: number;
}): SceneCameraAuthoringCommandPlan {
	return {
		sceneCommands: [
			createSetMotionControllerCommand(
				nodeId,
				enabled
					? {
							kind: "motion-controller",
							...(handleRadius !== undefined ? { handleRadius } : {}),
						}
					: null,
			),
		],
		motionCommands: [],
		controllerNodeId: nodeId,
	};
}

/** Builds the command plan for parenting a node to a motion/null controller. */
export function createSetMotionParentAuthoringPlan({
	nodeId,
	binding,
}: {
	readonly nodeId: string;
	readonly binding: MotionParentBinding | null;
}): SceneCameraAuthoringCommandPlan {
	return {
		sceneCommands: [createSetMotionParentCommand(nodeId, binding)],
		motionCommands: [],
		...(binding?.parentNodeId
			? { controllerNodeId: binding.parentNodeId }
			: {}),
	};
}

/** Builds the command plan for exact camera body/target/projection edits. */
export function createUpdateSceneCameraAuthoringPlan({
	cameraRigId,
	patch,
	label,
	coalesceKey,
}: {
	readonly cameraRigId: string;
	readonly patch: SceneCameraRigPatch;
	readonly label?: string;
	readonly coalesceKey?: string;
}): SceneCameraAuthoringCommandPlan {
	return {
		sceneCommands: [
			createUpdateSceneCameraCommand(cameraRigId, patch, {
				...(label ? { label } : {}),
				...(coalesceKey ? { coalesceKey } : {}),
			}),
		],
		motionCommands: [],
		cameraRigId,
	};
}

/** Builds the command plan for binding or clearing a camera target node. */
export function createBindSceneCameraTargetNodeAuthoringPlan({
	cameraRigId,
	nodeId,
}: {
	readonly cameraRigId: string;
	readonly nodeId: string | null;
}): SceneCameraAuthoringCommandPlan {
	return {
		sceneCommands: [
			createBindSceneCameraTargetNodeCommand(cameraRigId, nodeId),
		],
		motionCommands: [],
		cameraRigId,
	};
}

/** Builds the command plan for binding or clearing a camera target null. */
export function createBindSceneCameraTargetControllerAuthoringPlan({
	cameraRigId,
	controllerNodeId,
}: {
	readonly cameraRigId: string;
	readonly controllerNodeId: string | null;
}): SceneCameraAuthoringCommandPlan {
	return {
		sceneCommands: [
			createBindSceneCameraTargetControllerCommand(
				cameraRigId,
				controllerNodeId,
			),
		],
		motionCommands: [],
		cameraRigId,
		...(controllerNodeId
			? {
					targetControllerNodeId: controllerNodeId,
					controllerNodeId,
				}
			: {}),
	};
}

/** Builds the command plan for binding or clearing a camera body null. */
export function createBindSceneCameraBodyControllerAuthoringPlan({
	cameraRigId,
	controllerNodeId,
}: {
	readonly cameraRigId: string;
	readonly controllerNodeId: string | null;
}): SceneCameraAuthoringCommandPlan {
	return {
		sceneCommands: [
			createBindSceneCameraBodyControllerCommand(cameraRigId, controllerNodeId),
		],
		motionCommands: [],
		cameraRigId,
		...(controllerNodeId ? { controllerNodeId } : {}),
	};
}

/** Builds the command plan for assigning a friendly depth preset to nodes. */
export function createAssignSceneCameraDepthPresetPlan({
	nodeIds,
	preset,
	cameraRigId,
}: {
	readonly nodeIds: readonly string[];
	readonly preset: SceneCameraDepthPreset;
	readonly cameraRigId?: string | null;
}): SceneCameraAuthoringCommandPlan {
	return {
		sceneCommands: [
			createSetNodeDepthPlaneCommand(
				nodeIds,
				sceneCameraDepthPlaneForPreset(preset, cameraRigId),
			),
		],
		motionCommands: [],
		...(cameraRigId ? { cameraRigId } : {}),
	};
}

/** Builds the command plan for assigning an exact Z depth value to nodes. */
export function createAssignSceneCameraDepthValuePlan({
	nodeIds,
	z,
	cameraRigId,
}: {
	readonly nodeIds: readonly string[];
	readonly z: number;
	readonly cameraRigId?: string | null;
}): SceneCameraAuthoringCommandPlan {
	const finiteZ = Number.isFinite(z) ? z : 0;
	return {
		sceneCommands: [
			createSetNodeDepthPlaneCommand(nodeIds, {
				kind: "depth-plane",
				version: 1,
				z: finiteZ,
				...(cameraRigId ? { cameraRigId } : {}),
			}),
		],
		motionCommands: [],
		...(cameraRigId ? { cameraRigId } : {}),
	};
}

/** Builds a motion-only command plan for setting one camera channel key. */
export function createCameraChannelKeyframePlan({
	cameraRigId,
	property,
	frame,
	value,
}: {
	readonly cameraRigId: string;
	readonly property: CameraRigAnimatableProperty;
	readonly frame: number;
	readonly value: number;
}): SceneCameraAuthoringCommandPlan {
	return {
		sceneCommands: [],
		motionCommands: [
			upsertCameraRigKeyframe(cameraRigId, property, frame, value),
		],
		cameraRigId,
	};
}

/** Builds a motion-only command plan for body, rotation, or target X/Y/Z keys. */
export function createCameraVectorKeyframePlan({
	cameraRigId,
	kind,
	frame,
	value,
}: {
	readonly cameraRigId: string;
	readonly kind: "body" | "target" | "bodyRotation";
	readonly frame: number;
	readonly value: Partial<Record<"x" | "y" | "z", number>>;
}): SceneCameraAuthoringCommandPlan {
	return {
		sceneCommands: [],
		motionCommands: [
			upsertCameraRigVectorKeyframes(cameraRigId, kind, frame, value),
		],
		cameraRigId,
	};
}

/** Builds a motion-only command plan for removing one camera keyframe. */
export function createRemoveCameraChannelKeyframePlan({
	cameraRigId,
	property,
	frame,
}: {
	readonly cameraRigId: string;
	readonly property: CameraRigAnimatableProperty;
	readonly frame: number;
}): SceneCameraAuthoringCommandPlan {
	return {
		sceneCommands: [],
		motionCommands: [removeCameraRigKeyframe(cameraRigId, property, frame)],
		cameraRigId,
	};
}

/** Builds a motion-only command plan for removing one camera channel. */
export function createRemoveCameraChannelTrackPlan({
	cameraRigId,
	property,
}: {
	readonly cameraRigId: string;
	readonly property: CameraRigAnimatableProperty;
}): SceneCameraAuthoringCommandPlan {
	return {
		sceneCommands: [],
		motionCommands: [removeCameraRigTrack(cameraRigId, property)],
		cameraRigId,
	};
}

/** Builds the cross-store cleanup plan for deleting a camera rig. */
export function createRemoveSceneCameraAuthoringPlan(
	cameraRigId: string,
): SceneCameraAuthoringCommandPlan {
	return {
		sceneCommands: [createRemoveSceneCameraCommand(cameraRigId)],
		motionCommands: [removeCameraRigTracks(cameraRigId)],
		cameraRigId,
	};
}

/** Builds a motion-only plan for adding or replacing a hard camera cut. */
export function createUpsertCameraCutAuthoringPlan(
	segment: CameraCutSegment,
): SceneCameraAuthoringCommandPlan {
	return {
		sceneCommands: [],
		motionCommands: [upsertCameraCutSegment(segment)],
		cameraRigId: segment.cameraRigId,
		artboardId: segment.artboardId,
	};
}

/** Builds a motion-only plan for retiming one hard camera cut. */
export function createRetimeCameraCutAuthoringPlan(options: {
	readonly segmentId: string;
	readonly startFrame?: number;
	readonly durationFrames?: number;
}): SceneCameraAuthoringCommandPlan {
	return {
		sceneCommands: [],
		motionCommands: [retimeCameraCutSegment(options)],
	};
}

/** Builds a motion-only plan for deleting one hard camera cut. */
export function createRemoveCameraCutAuthoringPlan(
	segmentId: string,
): SceneCameraAuthoringCommandPlan {
	return {
		sceneCommands: [],
		motionCommands: [removeCameraCutSegment(segmentId)],
	};
}

/** Builds the scene-only command plan for active-camera switching. */
export function createSetActiveSceneCameraAuthoringPlan({
	artboardId,
	cameraRigId,
}: {
	readonly artboardId: string;
	readonly cameraRigId: string | null;
}): SceneCameraAuthoringCommandPlan {
	return {
		sceneCommands: [createSetActiveSceneCameraCommand(artboardId, cameraRigId)],
		motionCommands: [],
		...(cameraRigId ? { cameraRigId } : {}),
		artboardId,
	};
}
