/**
 * Camera-motion verbs v1 — sparse `cameraTracks` planners for the three global camera
 * moves the camera-first standard names: `camera-push-in`,
 * `camera-parallax-establish`, `camera-orbit-2_5d`. Each is a PURE function
 * returning a cross-store command bundle (scene: projection / depthPlane /
 * ensure-camera; motion: sparse camera-track keyframes) — never a persistent
 * grammar binding and never a live expression channel (the FROZEN camera-track
 * model already carries the keys, and the sampler bakes them into every renderer
 * and export). Applied atomically the verbs land as one undoable authoring beat;
 * the emitted keys are ordinary camera-track keyframes editable in the Timeline
 * camera lanes.
 *
 * Route decision (P3.2): a NEW agent command family, NOT a motion-grammar
 * technique. `motion-grammar/apply-technique` only mints a persistent binding
 * and by contract never mutates Scene/MotionDocument, and grammar bakes emit
 * only node tracks — neither can express the bindingless cross-store camera
 * output these verbs require. See `docs/product-knowledge/
 * camera-first-motion-standard.md`.
 *
 * Projection dependence is the core risk each planner owns (spec §3.4): under an
 * orthographic camera the projection ignores depth, so a push-in must animate
 * projection `zoom` (body-z would be a no-op) and depth-plane parallax is
 * invisible until the rig is switched to perspective. The admitted output
 * ceiling is screen-facing 2.5D `svg-affine`: verbs NEVER author
 * `bodyRotationX`/`bodyRotationY` because their camera-basis rotation is not
 * the predictable body/target path these first-class recipes promise. Orbit is
 * a positional body arc with the target pinned, not a body rotation.
 */

import {
	upsertCameraRigKeyframe,
	upsertCameraRigVectorKeyframes,
} from "@/entities/motion/model/camera-commands";
import type { MotionCommand } from "@/entities/motion/model/command";
import type { MotionDocument } from "@/entities/motion/model/types";
import type { SceneCommand } from "@/entities/scene/model/command";
import { resolveMotionRelations } from "@/entities/scene/model/motion-relations";
import { applyMatrixToPoint } from "@/entities/scene/model/rendering";
import { findActiveSceneCameraRig } from "@/entities/scene/model/scene-camera";
import {
	buildSceneCameraRigForArtboard,
	createAddSceneCameraCommand,
	createSetNodeDepthPlaneCommand,
	createUpdateSceneCameraCommand,
} from "@/entities/scene/model/scene-camera-commands";
import { findArtboardById, findNode } from "@/entities/scene/model/selectors";
import type {
	Artboard,
	SceneCameraRigContract,
	SceneDocument,
	Vec3,
} from "@/entities/scene/model/types";

// --- Named numeric defaults -------------------------------------------------
//
// AEP-evidence honesty (docs/aep-evidence/crcr): the dossiers are a STRUCTURAL
// CENSUS — camera / 3D-layer / null counts and comp fps/duration — and carry NO
// camera-motion magnitudes (Z travel, zoom ratio, parallax offset, orbit
// degrees, FOV). So the depth-layering STRUCTURE (near/mid/far) and the
// perspective preference are justified by the census (6 of 7 references build
// on 3D cameras; e.g. s06-work2 = 127 3D layers / 13 cameras), and the move
// timescale by the comp envelope (fps 24–60, 20–30s sections). The magnitude
// constants below are principled PROJECTION-GEOMETRY choices — visible depth
// that stays in front of the near plane and inside the frame — NOT numbers read
// from crcr, which does not contain them.

/**
 * Push-in projection-zoom multiplier (orthographic) / dolly proportion target.
 * 1.4 grows the subject ~40% — a readable push without cropping it to the frame
 * edges. Geometry choice (crcr carries no zoom magnitude).
 */
const PUSH_IN_ZOOM_FACTOR = 1.4;

/**
 * Perspective push-in dolly distance as a fraction of the current body→subject
 * distance. 0.3 closes a third of the gap — a dolly-in that reads as depth
 * travel (parallax through the field) while keeping the subject fully framed and
 * the body well in front of the near plane.
 */
const PUSH_IN_DOLLY_FRACTION = 0.3;

/**
 * Orbit sweep (degrees) of the body arc around the pinned subject. 30° is a 2.5D
 * reveal — enough angular change that near and far depth planes separate in
 * opposite screen directions, well short of a disorienting full revolve.
 */
const ORBIT_SWEEP_DEGREES = 30;

/**
 * Interior arc samples for the orbit body path (excluding the two endpoints), so
 * the sparse `bodyX`/`bodyZ` keys trace the constant-radius circle rather than
 * chord across it. One interior key (3 keys total over 30°) keeps the max
 * chord-to-arc deviation to `radius * (1 - cos(7.5°))` ≈ 0.9% — sub-pixel at
 * typical radii — while staying sparse and hand-editable.
 */
const ORBIT_INTERIOR_SAMPLES = 1;

/**
 * Parallax near/far depth-plane offsets expressed as fractions of the camera
 * body→mid (z=0) distance, so the parallax strength is scale-invariant across
 * artboard sizes. Near sits `0.4·d` toward the camera (screen scale
 * `1/(1-0.4)` ≈ 1.67×) and far `0.6·d` away (`1/(1+0.6)` ≈ 0.63×) — clearly
 * layered depth with the near plane still `0.6·d` in front of the body (never
 * behind the near clip). The mid group is pinned to z=0 (the exact-framed
 * plane).
 */
const PARALLAX_NEAR_DEPTH_FRACTION = 0.4;
const PARALLAX_FAR_DEPTH_FRACTION = 0.6;

/**
 * Establishing lateral truck for parallax, as a fraction of artboard width. 0.06
 * is a slow drift — large enough that near/far planes visibly separate, small
 * enough to read as an establishing move, not a whip pan.
 */
const PARALLAX_TRUCK_WIDTH_FRACTION = 0.06;

/**
 * Default perspective vertical FOV (degrees) for a verb that must switch to or
 * create a perspective rig. Matches the projection resolver's
 * `DEFAULT_CAMERA_FOV_DEGREES` and `ensureSceneCamera`'s perspective default.
 */
const CAMERA_PERSPECTIVE_FOV_DEGREES = 50;

const DEGREES_TO_RADIANS = Math.PI / 180;

// --- Public types -----------------------------------------------------------

export type CameraVerbId =
	| "camera-push-in"
	| "camera-parallax-establish"
	| "camera-orbit-2_5d";

export const CAMERA_VERB_IDS = [
	"camera-push-in",
	"camera-parallax-establish",
	"camera-orbit-2_5d",
] as const satisfies readonly CameraVerbId[];

/** Roles for {@link planCameraParallaxEstablish}; each maps to group node id(s). */
export type CameraParallaxRoleGroups = {
	readonly near?: readonly string[];
	readonly mid?: readonly string[];
	readonly far?: readonly string[];
};

type CameraVerbFrameWindow = {
	readonly startFrame?: number;
	readonly durationFrames?: number;
};

export type CameraVerbBlockedResult = {
	readonly status: "blocked";
	readonly reason: string;
};

export type CameraVerbReadyResult = {
	readonly status: "ready";
	readonly cameraRigId: string;
	readonly artboardId: string;
	readonly sceneCommands: readonly SceneCommand[];
	readonly motionCommands: readonly MotionCommand[];
	readonly summary: {
		readonly verbId: CameraVerbId;
		readonly startFrame: number;
		readonly endFrame: number;
		readonly projection: "orthographic" | "perspective";
		readonly cameraCreated: boolean;
		readonly projectionSwitched: boolean;
	};
};

export type CameraVerbResult = CameraVerbBlockedResult | CameraVerbReadyResult;

// --- Shared geometry --------------------------------------------------------

const blocked = (reason: string): CameraVerbBlockedResult => ({
	status: "blocked",
	reason,
});

/** Vertical focal length (scene px) for a perspective rig — the sampler's law. */
const perspectiveFocalPx = (artboard: Artboard, fovDegrees: number): number =>
	artboard.height / 2 / Math.tan((fovDegrees * DEGREES_TO_RADIANS) / 2);

const resolveArtboard = (
	scene: SceneDocument,
	artboardId: string,
): Artboard | undefined => findArtboardById(scene, artboardId);

const artboardCenter = (artboard: Artboard): Vec3 => ({
	x: artboard.width / 2,
	y: artboard.height / 2,
	z: 0,
});

/** Inclusive frame window resolved against the motion timeline (whole clip by default). */
const resolveFrameWindow = (
	motion: MotionDocument,
	window: CameraVerbFrameWindow,
): { readonly startFrame: number; readonly endFrame: number } => {
	const lastFrame = Math.max(0, motion.durationFrames - 1);
	const startFrame = Math.min(
		lastFrame,
		Math.max(0, Math.round(window.startFrame ?? 0)),
	);
	const requested =
		window.durationFrames !== undefined &&
		Number.isFinite(window.durationFrames)
			? Math.max(1, Math.round(window.durationFrames))
			: lastFrame - startFrame;
	const endFrame = Math.min(lastFrame, startFrame + Math.max(1, requested));
	return { startFrame, endFrame };
};

/**
 * Rest-pose world centroid (and mean depth) of the subject nodes, using the same
 * motion-relations world graph the projector reads, so the camera targets what
 * the renderer shows. Returns `null` when no subject resolves.
 */
const subjectCentroid = (
	scene: SceneDocument,
	subjectIds: readonly string[],
): Vec3 | null => {
	const relations = resolveMotionRelations({ sampledScene: scene });
	let sumX = 0;
	let sumY = 0;
	let sumZ = 0;
	let count = 0;
	for (const nodeId of subjectIds) {
		const world = relations.worldMatrixByNodeId.get(nodeId);
		const node = findNode(scene, nodeId);
		if (!world || !node) continue;
		const origin = applyMatrixToPoint(world, { x: 0, y: 0 });
		sumX += origin.x;
		sumY += origin.y;
		sumZ += node.depthPlane?.z ?? 0;
		count += 1;
	}
	if (count === 0) return null;
	return { x: sumX / count, y: sumY / count, z: sumZ / count };
};

const rigBodyPosition = (rig: SceneCameraRigContract): Vec3 => ({
	x: rig.body.position.x,
	y: rig.body.position.y,
	z: rig.body.position.z,
});

const rigTargetPoint = (rig: SceneCameraRigContract, fallback: Vec3): Vec3 =>
	rig.target?.point
		? { x: rig.target.point.x, y: rig.target.point.y, z: rig.target.point.z }
		: fallback;

type ResolvedRig = {
	/** The rig the verb keys against — with any pending projection switch folded in. */
	readonly rig: SceneCameraRigContract;
	readonly sceneCommands: readonly SceneCommand[];
	readonly cameraCreated: boolean;
	readonly projectionSwitched: boolean;
};

/**
 * Resolves the artboard's active camera, creating or switching one when the verb
 * needs a specific projection. `want: "perspective"` guarantees a perspective
 * rig whose z=0 plane is exactly framed (`bodyZ = -focal`, `zoom = 1`), so a
 * flat scene is visually unchanged at the switch and only depth planes + camera
 * motion introduce the 3D read. `want: "current"` uses whatever is active (or a
 * default ortho identity rig when none exists). The returned `rig` already
 * reflects any switch, so downstream key math reads correct body/target/z.
 */
const resolveRig = (
	scene: SceneDocument,
	artboard: Artboard,
	want: "current" | "perspective",
): ResolvedRig => {
	const active = findActiveSceneCameraRig(scene, artboard.id);
	const center = artboardCenter(artboard);

	if (!active) {
		if (want === "perspective") {
			const focal = perspectiveFocalPx(
				artboard,
				CAMERA_PERSPECTIVE_FOV_DEGREES,
			);
			const rig = buildSceneCameraRigForArtboard(scene, {
				artboardId: artboard.id,
				projection: {
					kind: "perspective",
					fovDegrees: CAMERA_PERSPECTIVE_FOV_DEGREES,
					zoom: 1,
				},
				bodyPosition: { z: -focal },
			});
			if (!rig) throw new Error("perspective rig build failed");
			return {
				rig,
				sceneCommands: [
					createAddSceneCameraCommand(rig, { activateArtboardId: artboard.id }),
				],
				cameraCreated: true,
				projectionSwitched: false,
			};
		}
		const rig = buildSceneCameraRigForArtboard(scene, {
			artboardId: artboard.id,
		});
		if (!rig) throw new Error("default rig build failed");
		return {
			rig,
			sceneCommands: [
				createAddSceneCameraCommand(rig, { activateArtboardId: artboard.id }),
			],
			cameraCreated: true,
			projectionSwitched: false,
		};
	}

	if (want === "perspective" && active.projection.kind !== "perspective") {
		const focal = perspectiveFocalPx(artboard, CAMERA_PERSPECTIVE_FOV_DEGREES);
		const switched: SceneCameraRigContract = {
			...active,
			projection: {
				kind: "perspective",
				fovDegrees: CAMERA_PERSPECTIVE_FOV_DEGREES,
				zoom: 1,
			},
			body: {
				...active.body,
				position: { x: center.x, y: center.y, z: -focal },
			},
			target: {
				...active.target,
				point: { x: center.x, y: center.y, z: 0 },
			},
		};
		return {
			rig: switched,
			sceneCommands: [
				createUpdateSceneCameraCommand(
					active.id,
					{
						projection: {
							kind: "perspective",
							fovDegrees: CAMERA_PERSPECTIVE_FOV_DEGREES,
							zoom: 1,
						},
						// Recenter the body onto the optical axis through the artboard
						// center (full x/y/z), matching `switched.body.position` — patching
						// z only would leave an off-center existing camera's stale x/y, so
						// the applied rig would diverge from the rig these keys assume.
						body: { position: { x: center.x, y: center.y, z: -focal } },
						target: { point: { x: center.x, y: center.y, z: 0 } },
					},
					{ label: "Switch camera to perspective" },
				),
			],
			cameraCreated: false,
			projectionSwitched: true,
		};
	}

	return {
		rig: active,
		sceneCommands: [],
		cameraCreated: false,
		projectionSwitched: false,
	};
};

// --- Verb planners ----------------------------------------------------------

export type PlanCameraPushInInput = CameraVerbFrameWindow & {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly artboardId?: string;
	readonly subjectIds: readonly string[];
	/**
	 * `"dolly"` forces a perspective body-z dolly (switching projection if
	 * needed); `"zoom"` forces an orthographic projection-zoom push. Omitted
	 * (default) respects the active camera: perspective ⇒ dolly, otherwise zoom.
	 */
	readonly mode?: "zoom" | "dolly";
};

/**
 * Push-in: converge on the subject with a terminal-eased move. Under an
 * orthographic rig the projection ignores depth, so this animates projection
 * `zoom` (a body-z dolly would be a visual no-op) and pans the target onto the
 * subject centroid. Under (or forced to) a perspective rig it dollies the body
 * toward the subject along the optical axis (`bodyZ`), which grows the subject
 * through true depth travel. The two mandatory endpoint keys carry the sampler's
 * default slow-in/slow-out easing, so the arrival at the final value decelerates
 * (no hard stop).
 */
export function planCameraPushIn(
	input: PlanCameraPushInInput,
): CameraVerbResult {
	const artboardId =
		input.artboardId ??
		input.scene.currentArtboardId ??
		input.scene.artboard.id;
	const artboard = resolveArtboard(input.scene, artboardId);
	if (!artboard) return blocked(`Artboard "${artboardId}" is missing.`);
	if (input.subjectIds.length === 0)
		return blocked("Push-in needs at least one subject node.");
	const centroid = subjectCentroid(input.scene, input.subjectIds);
	if (!centroid) return blocked("Push-in subject nodes did not resolve.");

	const want = input.mode === "dolly" ? "perspective" : "current";
	const resolved = resolveRig(input.scene, artboard, want);
	const { rig } = resolved;
	const perspective = rig.projection.kind === "perspective";
	const dolly =
		input.mode === "dolly" || (input.mode !== "zoom" && perspective);
	const { startFrame, endFrame } = resolveFrameWindow(input.motion, input);
	const body = rigBodyPosition(rig);
	const target = rigTargetPoint(rig, artboardCenter(artboard));
	const motionCommands: MotionCommand[] = [];

	// Pan the target onto the subject so the push converges on it (both paths).
	motionCommands.push(
		upsertCameraRigVectorKeyframes(rig.id, "target", startFrame, {
			x: target.x,
			y: target.y,
		}),
		upsertCameraRigVectorKeyframes(rig.id, "target", endFrame, {
			x: centroid.x,
			y: centroid.y,
		}),
	);

	if (dolly) {
		// Perspective dolly: close PUSH_IN_DOLLY_FRACTION of the body→subject gap
		// along the optical axis. The subject depth is the target/subject z.
		const subjectDepth = centroid.z;
		const bodyToSubjectZ = subjectDepth - body.z; // > 0 (body behind subject)
		const endBodyZ = body.z + bodyToSubjectZ * PUSH_IN_DOLLY_FRACTION;
		motionCommands.push(
			upsertCameraRigVectorKeyframes(rig.id, "body", startFrame, { z: body.z }),
			upsertCameraRigVectorKeyframes(rig.id, "body", endFrame, { z: endBodyZ }),
		);
	} else {
		// Orthographic zoom: depth is ignored, so grow the projection zoom.
		const startZoom = rig.projection.zoom ?? 1;
		motionCommands.push(
			upsertCameraRigKeyframe(rig.id, "zoom", startFrame, startZoom),
			upsertCameraRigKeyframe(
				rig.id,
				"zoom",
				endFrame,
				startZoom * PUSH_IN_ZOOM_FACTOR,
			),
		);
	}

	return {
		status: "ready",
		cameraRigId: rig.id,
		artboardId,
		sceneCommands: resolved.sceneCommands,
		motionCommands,
		summary: {
			verbId: "camera-push-in",
			startFrame,
			endFrame,
			projection: rig.projection.kind,
			cameraCreated: resolved.cameraCreated,
			projectionSwitched: resolved.projectionSwitched,
		},
	};
}

export type PlanCameraParallaxEstablishInput = CameraVerbFrameWindow & {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly artboardId?: string;
	readonly roleGroups: CameraParallaxRoleGroups;
};

/**
 * Parallax-establish: the one-shot flat→3D conversion. It MUST run under
 * perspective (orthographic ignores depth, making depth-plane parallax a
 * no-op), so it switches/creates a perspective rig, assigns named depth planes
 * to the near/mid/far role groups (children inherit statically down the group
 * tree), and writes a slow lateral truck drift — body AND target move together
 * so orientation is constant and the differential screen shift between near and
 * far planes IS the parallax.
 */
export function planCameraParallaxEstablish(
	input: PlanCameraParallaxEstablishInput,
): CameraVerbResult {
	const artboardId =
		input.artboardId ??
		input.scene.currentArtboardId ??
		input.scene.artboard.id;
	const artboard = resolveArtboard(input.scene, artboardId);
	if (!artboard) return blocked(`Artboard "${artboardId}" is missing.`);
	const near = input.roleGroups.near ?? [];
	const mid = input.roleGroups.mid ?? [];
	const far = input.roleGroups.far ?? [];
	if (near.length === 0 && far.length === 0) {
		return blocked(
			"Parallax-establish needs near and/or far role groups to layer depth.",
		);
	}

	const resolved = resolveRig(input.scene, artboard, "perspective");
	const { rig } = resolved;
	const bodyDistance = Math.abs(rig.body.position.z); // body → z=0 mid plane
	const nearZ = -bodyDistance * PARALLAX_NEAR_DEPTH_FRACTION;
	const farZ = bodyDistance * PARALLAX_FAR_DEPTH_FRACTION;

	const sceneCommands: SceneCommand[] = [...resolved.sceneCommands];
	const depthPlane = (z: number) => ({
		kind: "depth-plane" as const,
		version: 1 as const,
		z,
	});
	if (near.length > 0) {
		sceneCommands.push(
			createSetNodeDepthPlaneCommand([...near], depthPlane(nearZ)),
		);
	}
	if (mid.length > 0) {
		sceneCommands.push(createSetNodeDepthPlaneCommand([...mid], depthPlane(0)));
	}
	if (far.length > 0) {
		sceneCommands.push(
			createSetNodeDepthPlaneCommand([...far], depthPlane(farZ)),
		);
	}

	const { startFrame, endFrame } = resolveFrameWindow(input.motion, input);
	const truckPx = artboard.width * PARALLAX_TRUCK_WIDTH_FRACTION;
	const body = rigBodyPosition(rig);
	const target = rigTargetPoint(rig, artboardCenter(artboard));
	// Pure lateral truck: body and target both slide +truckPx in x, keeping the
	// optical axis parallel so every plane translates and only their depths
	// differentiate the on-screen speed (parallax).
	const motionCommands: MotionCommand[] = [
		upsertCameraRigVectorKeyframes(rig.id, "body", startFrame, { x: body.x }),
		upsertCameraRigVectorKeyframes(rig.id, "body", endFrame, {
			x: body.x + truckPx,
		}),
		upsertCameraRigVectorKeyframes(rig.id, "target", startFrame, {
			x: target.x,
		}),
		upsertCameraRigVectorKeyframes(rig.id, "target", endFrame, {
			x: target.x + truckPx,
		}),
	];

	return {
		status: "ready",
		cameraRigId: rig.id,
		artboardId,
		sceneCommands,
		motionCommands,
		summary: {
			verbId: "camera-parallax-establish",
			startFrame,
			endFrame,
			projection: "perspective",
			cameraCreated: resolved.cameraCreated,
			projectionSwitched: resolved.projectionSwitched,
		},
	};
}

export type PlanCameraOrbit2_5dInput = CameraVerbFrameWindow & {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly artboardId?: string;
	readonly subjectIds: readonly string[];
	/** Signed sweep override in degrees; defaults to +{@link ORBIT_SWEEP_DEGREES}. */
	readonly sweepDegrees?: number;
};

/**
 * Orbit (2.5D): pin the target at the subject and arc the body around it on a
 * constant-radius circle in the horizontal (x/z) plane — sparse `bodyX`/`bodyZ`
 * keys sampled along the arc, never a body rotation (bodyRotationX/Y trip
 * requires-3d). Depth separation appears because the viewing angle changes:
 * near and far planes shift in OPPOSITE screen directions around the subject.
 * Works under orthographic (the rotating basis reveals depth) and perspective
 * alike; it uses whatever projection is active.
 */
export function planCameraOrbit2_5d(
	input: PlanCameraOrbit2_5dInput,
): CameraVerbResult {
	const artboardId =
		input.artboardId ??
		input.scene.currentArtboardId ??
		input.scene.artboard.id;
	const artboard = resolveArtboard(input.scene, artboardId);
	if (!artboard) return blocked(`Artboard "${artboardId}" is missing.`);
	if (input.subjectIds.length === 0)
		return blocked("Orbit needs at least one subject node.");
	const centroid = subjectCentroid(input.scene, input.subjectIds);
	if (!centroid) return blocked("Orbit subject nodes did not resolve.");

	const resolved = resolveRig(input.scene, artboard, "current");
	const { rig } = resolved;
	const body = rigBodyPosition(rig);
	// Target is pinned at the subject (x/z arc plane); keep the body's own height.
	const pivot = { x: centroid.x, z: centroid.z };
	const radius = Math.hypot(body.x - pivot.x, body.z - pivot.z);
	if (radius <= 1e-6)
		return blocked("Camera body coincides with the subject; cannot orbit.");
	const startAngle = Math.atan2(body.x - pivot.x, -(body.z - pivot.z)); // 0 = body behind target
	const sweep =
		(input.sweepDegrees ?? ORBIT_SWEEP_DEGREES) * DEGREES_TO_RADIANS;
	const sampleCount = ORBIT_INTERIOR_SAMPLES + 2; // endpoints + interior

	const { startFrame, endFrame } = resolveFrameWindow(input.motion, input);
	const sceneCommands: SceneCommand[] = [
		...resolved.sceneCommands,
		// Static target pin at the subject (x/y/z) — one scene edit, not per-frame keys.
		createUpdateSceneCameraCommand(
			rig.id,
			{ target: { point: { x: centroid.x, y: centroid.y, z: centroid.z } } },
			{ label: "Pin camera target to orbit subject" },
		),
	];

	const motionCommands: MotionCommand[] = [];
	for (let index = 0; index < sampleCount; index += 1) {
		const t = index / (sampleCount - 1);
		const angle = startAngle + sweep * t;
		const bodyX = pivot.x + radius * Math.sin(angle);
		const bodyZ = pivot.z - radius * Math.cos(angle);
		const frame = Math.round(startFrame + (endFrame - startFrame) * t);
		motionCommands.push(
			upsertCameraRigVectorKeyframes(rig.id, "body", frame, {
				x: bodyX,
				z: bodyZ,
			}),
		);
	}

	return {
		status: "ready",
		cameraRigId: rig.id,
		artboardId,
		sceneCommands,
		motionCommands,
		summary: {
			verbId: "camera-orbit-2_5d",
			startFrame,
			endFrame,
			projection: rig.projection.kind,
			cameraCreated: resolved.cameraCreated,
			projectionSwitched: resolved.projectionSwitched,
		},
	};
}
