import { createBabylonRuntimeSurface } from "@/shared/babylon";
import type {
	Runtime3dCamera,
	Runtime3dCoordinateContract,
	Runtime3dExternalSource,
	Runtime3dFrame,
	Runtime3dPlacement,
	Runtime3dWorldMatrix,
} from "@/shared/runtime-3d/types";

/**
 * Throwaway, dev-only QA harness for the P6-A Babylon PBR/IBL A/B
 * (`src/shared/babylon/runtime.ts`, flag `?babylonPbr=1` /
 * `localStorage["vma:babylon-pbr"]`). It drives the real
 * `createBabylonRuntimeSurface` adapter with one hand-built `Runtime3dFrame`
 * placing `public/runtime-3d/qa-material-probe.glb` (see
 * `scripts/gen-babylon-qa-probe.ts`), so a human can screenshot baseline vs
 * candidate without the editor's live document. Never imported by product
 * code; not part of any build entry.
 */

const CANVAS_ID = "probe-canvas";
const STATUS_ELEMENT_ID = "status";
const GLB_HREF = "/runtime-3d/qa-material-probe.glb";
const QA_ARTBOARD_ID = "qa-babylon-probe-artboard";
const QA_ASSET_ID = "qa-material-probe";
const QA_NODE_ID = "qa-material-probe-node";
const QA_BACK_ROW_NODE_ID = "qa-material-probe-node-back-row";

const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 720;
const VIEWPORT_DPR = 1;

/**
 * Uniform world-space scale applied to the normalized, origin-centered model
 * (`createBabylonRuntimeSurface`'s adapter re-centers and rescales every
 * loaded GLB to a unit-max-extent cube before this matrix is applied — see
 * `normalizeInstance` in `src/shared/babylon/runtime.ts`). The 8-sphere row
 * is the model's longest axis, so this scale is also its final world width.
 * Kept narrower than the frame's horizontal extent at `CAMERA_DISTANCE_Z` so
 * the first and last spheres sit inside the frame with margin.
 */
const MODEL_WORLD_SCALE = 6;

/** Camera height above the row. Negative because this contract is Y-down. */
const CAMERA_HEIGHT_Y = -1.4;
/** Camera distance in front of the row along the contract's Z axis. */
const CAMERA_DISTANCE_Z = -5.5;
const CAMERA_VERTICAL_FOV_DEGREES = 42;
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 50;
const DEGREES_TO_RADIANS = Math.PI / 180;

/**
 * P6-C candidate: a second placement of the same probe GLB, offset backward
 * along the camera's Z axis (larger pseudo-depth) and slightly up/right so
 * both rows are visible without overlapping. Camera-axis distance (i.e. the
 * value a `?dofFocus=` URL param would need to bring THIS row into focus) is
 * `dot(BACK_ROW_TRANSLATION - CAMERA_POSITION, forward)`, worked out in this
 * module's own doc comment: ≈9.40 scene units, vs. the front row's ≈5.68 (the
 * camera-to-target distance, since the front row sits at the origin/target).
 */
const BACK_ROW_TRANSLATION_X = 2;
const BACK_ROW_TRANSLATION_Y = -0.5;
const BACK_ROW_TRANSLATION_Z = 4;
/** Smaller than the front row's so the two rows read as distinct depths, not just distinct sizes, at a glance. */
const BACK_ROW_MODEL_WORLD_SCALE = 4;

/**
 * Front-row camera-axis distance from `buildCamera()`'s position to the
 * origin (where the front row sits) — i.e. `CAMERA_HEIGHT_Y`/`CAMERA_DISTANCE_Z`'s
 * own vector length, since the front row is exactly at the camera's target.
 * Documented here (not just left implicit) so a browser QA call reading this
 * source knows what `?dofFocus=` value focuses which row.
 */
const FRONT_ROW_CAMERA_AXIS_DISTANCE = Math.hypot(
	CAMERA_HEIGHT_Y,
	CAMERA_DISTANCE_Z,
);

/** Reads `?dofFocus=<sceneUnits>&dofAperture=<strength>` from the harness URL. Absent (or non-finite/non-positive `dofAperture`) means no DOF: `apertureStrength` stays `0`, matching `Runtime3dCameraBase`'s "0 = disabled" contract. */
const readDofParamsFromUrl = (): {
	readonly focusDistance: number;
	readonly apertureStrength: number;
} => {
	const params = new URLSearchParams(window.location.search);
	const focusParam = Number.parseFloat(params.get("dofFocus") ?? "");
	const apertureParam = Number.parseFloat(params.get("dofAperture") ?? "");
	return {
		focusDistance: Number.isFinite(focusParam)
			? focusParam
			: FRONT_ROW_CAMERA_AXIS_DISTANCE,
		apertureStrength:
			Number.isFinite(apertureParam) && apertureParam > 0 ? apertureParam : 0,
	};
};

/**
 * Same fixed contract tag `entities/scene/model/runtime-3d.ts` attaches to
 * every compiled camera; it is descriptive metadata only (`configureCamera`
 * in `runtime.ts` reads `position`/`target`/`up`, not this field), but every
 * `Runtime3dCamera` carries it, so this harness reproduces it exactly.
 */
const COORDINATES: Runtime3dCoordinateContract = {
	handedness: "right-handed",
	xAxis: "right",
	yAxis: "down",
	zAxis: "scene-depth",
	fovAxis: "vertical",
};

const statusElement = document.getElementById(STATUS_ELEMENT_ID);

const setStatus = (text: string): void => {
	if (statusElement) statusElement.textContent = text;
};

const appendStatus = (text: string): void => {
	if (statusElement)
		statusElement.textContent = `${statusElement.textContent}\n${text}`;
};

/**
 * Column-major 4x4 identity scaled uniformly by `scale`, then translated by
 * `(tx, ty, tz)`. The normalized model is already centered at the origin, so
 * the front row (translation `0,0,0`) is framed around the camera's own
 * target with no further offset.
 */
const buildWorldMatrix = (
	scale: number,
	tx = 0,
	ty = 0,
	tz = 0,
): Runtime3dWorldMatrix => [
	scale,
	0,
	0,
	0,
	0,
	scale,
	0,
	0,
	0,
	0,
	scale,
	0,
	tx,
	ty,
	tz,
	1,
];

const buildCamera = (): Runtime3dCamera => ({
	kind: "perspective",
	coordinates: COORDINATES,
	position: { x: 0, y: CAMERA_HEIGHT_Y, z: CAMERA_DISTANCE_Z },
	target: { x: 0, y: 0, z: 0 },
	up: { x: 0, y: -1, z: 0 },
	near: CAMERA_NEAR,
	far: CAMERA_FAR,
	verticalFovRadians: CAMERA_VERTICAL_FOV_DEGREES * DEGREES_TO_RADIANS,
	aspect: VIEWPORT_WIDTH / VIEWPORT_HEIGHT,
});

/**
 * P6-C candidate: the sampled Vecmo scene-camera rig `compileRuntime3dFrame`
 * would attach as `Runtime3dFrame.sourceCamera` in the real editor path. This
 * harness has no separate baked-2D-projection/orthographic-presentation-camera
 * scheme (unlike the real path, `frame.camera` above IS the actual rendering
 * camera), so the most honest stand-in is the same position/target/up as
 * `buildCamera()`, plus the optics fields the real sampled rig would carry.
 */
const buildSourceCamera = (
	focusDistance: number,
	apertureStrength: number,
): Runtime3dCamera => ({
	...buildCamera(),
	focusDistance,
	apertureStrength,
	focalLengthMm: 50,
});

const buildSource = (): Runtime3dExternalSource => {
	const kind = "reference" as const;
	const format = "glb" as const;
	return {
		variant: "model",
		kind,
		uri: GLB_HREF,
		format,
		cacheKey: `${kind}:${format}:${GLB_HREF}`,
	};
};

const buildPlacement = (): Runtime3dPlacement => ({
	nodeId: QA_NODE_ID,
	sourceNodeId: QA_NODE_ID,
	assetId: QA_ASSET_ID,
	artboardId: QA_ARTBOARD_ID,
	source: buildSource(),
	worldMatrix: buildWorldMatrix(MODEL_WORLD_SCALE),
	opacity: 1,
	visible: true,
	pickable: true,
});

/** P6-C candidate: the back row, see `BACK_ROW_TRANSLATION_*`'s doc comment. */
const buildBackRowPlacement = (): Runtime3dPlacement => ({
	nodeId: QA_BACK_ROW_NODE_ID,
	sourceNodeId: QA_BACK_ROW_NODE_ID,
	assetId: QA_ASSET_ID,
	artboardId: QA_ARTBOARD_ID,
	source: buildSource(),
	worldMatrix: buildWorldMatrix(
		BACK_ROW_MODEL_WORLD_SCALE,
		BACK_ROW_TRANSLATION_X,
		BACK_ROW_TRANSLATION_Y,
		BACK_ROW_TRANSLATION_Z,
	),
	opacity: 1,
	visible: true,
	pickable: true,
});

const buildFrame = (): Runtime3dFrame => {
	const dofParams = readDofParamsFromUrl();
	return {
		frame: 0,
		viewport: {
			width: VIEWPORT_WIDTH,
			height: VIEWPORT_HEIGHT,
			dpr: VIEWPORT_DPR,
		},
		camera: buildCamera(),
		sourceCamera: buildSourceCamera(
			dofParams.focusDistance,
			dofParams.apertureStrength,
		),
		artboardClips: [],
		placements: [buildPlacement(), buildBackRowPlacement()],
		vectorPlanes: [],
		issues: [],
	};
};

const main = async (): Promise<void> => {
	const canvas = document.getElementById(CANVAS_ID);
	if (!(canvas instanceof HTMLCanvasElement)) {
		setStatus("error: #probe-canvas is not a canvas element");
		return;
	}
	canvas.width = VIEWPORT_WIDTH;
	canvas.height = VIEWPORT_HEIGHT;

	setStatus("creating Babylon runtime surface…");
	const surface = await createBabylonRuntimeSurface(
		canvas,
		(error) => {
			appendStatus(
				`onError: ${error instanceof Error ? error.message : String(error)}`,
			);
		},
		{
			// Kept readable (not the live-preview default) so this harness's own
			// determinism check (P6-B verification: two fresh loads' canvases
			// must read back pixel-identical) can read the committed frame back
			// out of the WebGL backbuffer instead of the already-cleared default.
			preserveDrawingBuffer: true,
			onIssue: (issue) => {
				appendStatus(
					`onIssue: ${issue.severity} ${issue.code} — ${issue.message}`,
				);
			},
		},
	);

	setStatus("rendering probe frame…");
	await surface.renderFrame(buildFrame());

	document.title = "probe-ready";
	appendStatus("probe-ready");
};

void main();
