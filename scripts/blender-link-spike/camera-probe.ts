/**
 * S0a camera-mapping probe, Vecmo side.
 *
 * Ports the minimal Vecmo perspective projection exactly as the runtime
 * defines it, then compares it against Blender's `world_to_camera_view`
 * output produced by `camera_probe.py`.
 *
 * Authoritative sources (read-only):
 * - `src/shared/runtime-3d/types.ts` — `Runtime3dCoordinateContract`:
 *   right-handed, X right, Y down, Z scene-depth, `fovAxis: "vertical"`.
 * - `src/entities/scene/model/runtime-3d.ts` — the sampled rig emits
 *   `up = { x: 0, y: -1, z: 0 }`, `verticalFovRadians = fovDegrees * PI / 180`,
 *   `aspect = viewport.width / max(1, viewport.height)`.
 * - `src/shared/babylon/runtime.ts` — `configureCamera` maps the Vecmo camera
 *   into Babylon world space as `(x, -y, -z)` for position, target and up,
 *   with `scene.useRightHandedSystem = true`,
 *   `fovMode = FOVMODE_VERTICAL_FIXED`, `fov = verticalFovRadians`.
 *
 * The projection below therefore reproduces Babylon's `LookAtRH` +
 * `PerspectiveFovRH` with a fixed vertical FOV, in Babylon world space.
 *
 * IMPORTANT — what the delta test does and does not prove.
 * Applying the same proper rotation `M` to the camera pose and to the probe
 * points leaves the camera-relative geometry invariant, so the deltas would
 * agree for ANY proper rotation. The delta comparison therefore validates the
 * PROJECTION convention (vertical FOV axis, non-square aspect handling, the
 * Y-down -> bottom-origin v flip, and behind-camera classification). The
 * ROTATION choice is pinned separately by the absolute axis assertions in
 * `axisAssertions()` plus the screen-side chirality checks.
 *
 * Run:
 *   bun scripts/blender-link-spike/camera-probe.ts \
 *     --spec <camera-probe-spec.json> \
 *     --blender <camera-probe-blender.json> --out <camera-probe.json>
 */

/** Vecmo -> Blender axis matrix, rows. `(x, y, z) -> (x, z, -y)`. */
export const AXIS_MATRIX: readonly (readonly [number, number, number])[] = [
	[1, 0, 0],
	[0, 0, 1],
	[0, -1, 0],
];

export const NORMALIZED_TOLERANCE = 1e-3;
/** Blender stores `camera.data.lens` as float32; see the assertion comment. */
export const FLOAT32_FOV_TOLERANCE = 1e-6;
/** `DEFAULT_CAMERA_SENSOR_WIDTH_MM` in `src/entities/scene/model/scene-camera.ts`. */
export const VECMO_SENSOR_WIDTH_MM = 36;

type Vec3 = { readonly x: number; readonly y: number; readonly z: number };

const sub = (a: Vec3, b: Vec3): Vec3 => ({
	x: a.x - b.x,
	y: a.y - b.y,
	z: a.z - b.z,
});
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({
	x: a.y * b.z - a.z * b.y,
	y: a.z * b.x - a.x * b.z,
	z: a.x * b.y - a.y * b.x,
});
const normalize = (a: Vec3): Vec3 => {
	const length = Math.hypot(a.x, a.y, a.z) || 1;
	return { x: a.x / length, y: a.y / length, z: a.z / length };
};

/** `configureCamera` in `src/shared/babylon/runtime.ts`. */
const toBabylon = (a: Vec3): Vec3 => ({ x: a.x, y: -a.y, z: -a.z });

const applyAxisMatrix = (a: Vec3, scale: number): Vec3 => ({
	x:
		scale *
		(AXIS_MATRIX[0][0] * a.x +
			AXIS_MATRIX[0][1] * a.y +
			AXIS_MATRIX[0][2] * a.z),
	y:
		scale *
		(AXIS_MATRIX[1][0] * a.x +
			AXIS_MATRIX[1][1] * a.y +
			AXIS_MATRIX[1][2] * a.z),
	z:
		scale *
		(AXIS_MATRIX[2][0] * a.x +
			AXIS_MATRIX[2][1] * a.y +
			AXIS_MATRIX[2][2] * a.z),
});

const determinant = (
	m: readonly (readonly [number, number, number])[],
): number =>
	m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
	m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
	m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);

const vecEquals = (a: Vec3, b: Vec3): boolean =>
	Math.abs(a.x - b.x) < 1e-12 &&
	Math.abs(a.y - b.y) < 1e-12 &&
	Math.abs(a.z - b.z) < 1e-12;

export type Assertion = {
	readonly id: string;
	readonly detail: string;
	readonly pass: boolean;
};

/**
 * Absolute assertions that pin the rotation itself. Without these the delta
 * comparison is invariant under any proper rotation and would report PASS on
 * a mapping that renders the user's Blender content sideways.
 */
export const axisAssertions = (): readonly Assertion[] => {
	const det = determinant(AXIS_MATRIX);
	const mapped = (v: Vec3): Vec3 => applyAxisMatrix(v, 1);
	const vecmoUp = { x: 0, y: -1, z: 0 };
	const vecmoDepth = { x: 0, y: 0, z: 1 };
	const vecmoRight = { x: 1, y: 0, z: 0 };
	return [
		{
			id: "det-is-plus-one",
			detail: `det(M) = ${det}`,
			pass: Math.abs(det - 1) < 1e-12,
		},
		{
			id: "vecmo-up-maps-to-blender-z-up",
			detail: `M @ (0,-1,0) = ${JSON.stringify(mapped(vecmoUp))}`,
			pass: vecEquals(mapped(vecmoUp), { x: 0, y: 0, z: 1 }),
		},
		{
			id: "vecmo-depth-maps-to-blender-plus-y",
			detail: `M @ (0,0,1) = ${JSON.stringify(mapped(vecmoDepth))}`,
			pass: vecEquals(mapped(vecmoDepth), { x: 0, y: 1, z: 0 }),
		},
		{
			id: "vecmo-right-maps-to-blender-plus-x",
			detail: `M @ (1,0,0) = ${JSON.stringify(mapped(vecmoRight))}`,
			pass: vecEquals(mapped(vecmoRight), { x: 1, y: 0, z: 0 }),
		},
	];
};

export type Projection = {
	readonly u: number;
	readonly v: number;
	readonly clipW: number;
	readonly behindCamera: boolean;
};

/**
 * Babylon `LookAtRH` + `PerspectiveFovRH` with `FOVMODE_VERTICAL_FIXED`,
 * evaluated in Babylon world space. Returns bottom-origin normalized screen
 * coordinates so it is directly comparable with `world_to_camera_view`.
 */
export const projectVecmoPoint = (
	point: Vec3,
	camera: {
		readonly position: Vec3;
		readonly target: Vec3;
		readonly up: Vec3;
		readonly verticalFovRadians: number;
		readonly aspect: number;
	},
): Projection => {
	const position = toBabylon(camera.position);
	const target = toBabylon(camera.target);
	const up = normalize(toBabylon(camera.up));
	// Babylon Matrix.LookAtRH: zAxis = normalize(eye - target).
	const zAxis = normalize(sub(position, target));
	const xAxis = normalize(cross(up, zAxis));
	const yAxis = cross(zAxis, xAxis);
	const relative = sub(toBabylon(point), position);
	const viewX = dot(relative, xAxis);
	const viewY = dot(relative, yAxis);
	const viewZ = dot(relative, zAxis);
	// RH view space looks down -Z, so the clip w is -viewZ.
	const clipW = -viewZ;
	const cot = 1 / Math.tan(camera.verticalFovRadians / 2);
	const ndcX = ((cot / camera.aspect) * viewX) / clipW;
	const ndcY = (cot * viewY) / clipW;
	return {
		u: (ndcX + 1) / 2,
		v: (ndcY + 1) / 2,
		clipW,
		behindCamera: clipW <= 0,
	};
};

type Spec = {
	readonly sceneUnitsPerPixel: number;
	readonly resolution: { readonly width: number; readonly height: number };
	readonly camera: {
		readonly position: Vec3;
		readonly target: Vec3;
		readonly up: Vec3;
		readonly near: number;
		readonly far: number;
		readonly verticalFovDegrees: number;
	};
	readonly frame: {
		readonly blenderFrameStart: number;
		readonly durationFrames: number;
		readonly vecmoFrames: readonly number[];
	};
	readonly probePoints: readonly {
		readonly id: string;
		readonly point: Vec3;
		readonly expect: "visible" | "behind";
		readonly chirality: {
			readonly u: "greater" | "less" | null;
			readonly v: "greater" | "less" | null;
		} | null;
	}[];
};

type BlenderProbe = {
	readonly axisMatrixRows: readonly (readonly number[])[];
	readonly sceneUnitsPerPixel: number;
	readonly resolution: {
		readonly width: number;
		readonly height: number;
		readonly pixelAspectX: number;
		readonly pixelAspectY: number;
	};
	readonly cameraReadback: {
		readonly sensorFit: string;
		readonly sensorWidthMm: number;
		readonly sensorHeightMm: number;
		readonly lensMm: number;
		readonly angleYRadians: number;
		readonly angleYRoundTripError: number;
		readonly basisForwardError: number;
		readonly effectiveFromViewFrame: {
			readonly verticalFovRadians: number;
			readonly horizontalFovRadians: number;
		};
	};
	readonly points: readonly {
		readonly id: string;
		readonly u: number;
		readonly v: number;
		readonly cameraDepth: number;
		readonly behindCamera: boolean;
	}[];
	readonly frameMapping: readonly {
		readonly vecmoFrame: number;
		readonly expectedBlenderFrame: number;
		readonly observedBlenderFrame: number;
		readonly identity: boolean;
	}[];
};

const chiralityCheck = (
	value: number,
	rule: "greater" | "less" | null,
): boolean => {
	if (rule === null) return true;
	return rule === "greater" ? value > 0.5 : value < 0.5;
};

export const evaluate = (spec: Spec, blender: BlenderProbe) => {
	const verticalFovRadians = (spec.camera.verticalFovDegrees * Math.PI) / 180;
	const aspect = spec.resolution.width / Math.max(1, spec.resolution.height);
	const camera = { ...spec.camera, verticalFovRadians, aspect };

	const assertions: Assertion[] = [...axisAssertions()];
	assertions.push({
		id: "blender-uses-same-axis-matrix",
		detail: JSON.stringify(blender.axisMatrixRows),
		pass:
			JSON.stringify(blender.axisMatrixRows) ===
			JSON.stringify(AXIS_MATRIX.map((row) => [...row])),
	});
	assertions.push({
		id: "sensor-fit-vertical",
		detail: blender.cameraReadback.sensorFit,
		pass: blender.cameraReadback.sensorFit === "VERTICAL",
	});
	// Blender stores `camera.data.lens` as float32, so a radian round-trip
	// through `angle_y` cannot resolve better than ~6e-8 relative (float32
	// eps). The threshold below is set to float32 reality, not to whatever
	// makes the run green: the resulting screen displacement is ~1e-9 in
	// normalized coordinates, six orders below the 1e-3 PASS gate that
	// actually decides this probe.
	assertions.push({
		id: "angle-y-round-trip-within-float32",
		detail: `error = ${blender.cameraReadback.angleYRoundTripError} rad; float32 relative eps = ${2 ** -24}; lens readback = ${blender.cameraReadback.lensMm} mm`,
		pass: blender.cameraReadback.angleYRoundTripError < FLOAT32_FOV_TOLERANCE,
	});
	assertions.push({
		id: "effective-vertical-fov-matches-request",
		detail: `effective = ${blender.cameraReadback.effectiveFromViewFrame.verticalFovRadians}, requested = ${verticalFovRadians}`,
		pass:
			Math.abs(
				blender.cameraReadback.effectiveFromViewFrame.verticalFovRadians -
					verticalFovRadians,
			) < 1e-6,
	});
	const expectedHorizontal =
		2 * Math.atan(Math.tan(verticalFovRadians / 2) * aspect);
	assertions.push({
		id: "effective-horizontal-fov-follows-non-square-aspect",
		detail: `effective = ${blender.cameraReadback.effectiveFromViewFrame.horizontalFovRadians}, expected = ${expectedHorizontal}`,
		pass:
			Math.abs(
				blender.cameraReadback.effectiveFromViewFrame.horizontalFovRadians -
					expectedHorizontal,
			) < 1e-6,
	});
	assertions.push({
		id: "camera-basis-not-transposed",
		detail: `forward error = ${blender.cameraReadback.basisForwardError}`,
		pass: blender.cameraReadback.basisForwardError < 1e-6,
	});
	assertions.push({
		id: "square-pixel-aspect",
		detail: `${blender.resolution.pixelAspectX} / ${blender.resolution.pixelAspectY}`,
		pass: blender.resolution.pixelAspectX === blender.resolution.pixelAspectY,
	});
	assertions.push({
		id: "scene-units-per-pixel-agree",
		detail: `${blender.sceneUnitsPerPixel} vs ${spec.sceneUnitsPerPixel}`,
		pass: blender.sceneUnitsPerPixel === spec.sceneUnitsPerPixel,
	});

	// Direct falsification of "just pass focalLengthMm": Vecmo's value is
	// derived against a fixed 36mm SENSOR WIDTH, while Blender's VERTICAL
	// sensor fit consumes sensor_height (24mm). Feeding Vecmo's number into
	// `camera.data.lens` yields a different vertical FOV by exactly the
	// 36/24 sensor ratio.
	const halfTan = Math.tan(verticalFovRadians / 2);
	const vecmoFocalLengthMm = VECMO_SENSOR_WIDTH_MM / (2 * halfTan);
	const fovIfFocalLengthWerePassed =
		2 *
		Math.atan(blender.cameraReadback.sensorHeightMm / (2 * vecmoFocalLengthMm));
	const focalLengthEvidence = {
		claim:
			"focalLengthMm must not be passed to Blender; verticalFovRadians is authoritative",
		vecmoFocalLengthMm,
		vecmoSensorWidthMm: VECMO_SENSOR_WIDTH_MM,
		blenderSensorHeightMm: blender.cameraReadback.sensorHeightMm,
		blenderLensMmUnderVerticalFit: blender.cameraReadback.lensMm,
		lensRatio: vecmoFocalLengthMm / blender.cameraReadback.lensMm,
		verticalFovIfFocalLengthWerePassedRadians: fovIfFocalLengthWerePassed,
		verticalFovIfFocalLengthWerePassedDegrees:
			(fovIfFocalLengthWerePassed * 180) / Math.PI,
		requestedVerticalFovDegrees: spec.camera.verticalFovDegrees,
	};
	assertions.push({
		id: "focal-length-mm-would-be-wrong",
		detail: `Vecmo ${vecmoFocalLengthMm.toFixed(3)}mm vs Blender VERTICAL-fit ${blender.cameraReadback.lensMm.toFixed(3)}mm (ratio ${focalLengthEvidence.lensRatio.toFixed(4)}); passing it would give ${focalLengthEvidence.verticalFovIfFocalLengthWerePassedDegrees.toFixed(3)} deg instead of ${spec.camera.verticalFovDegrees} deg`,
		pass: Math.abs(fovIfFocalLengthWerePassed - verticalFovRadians) > 1e-3,
	});

	const blenderById = new Map(blender.points.map((p) => [p.id, p]));
	const points = spec.probePoints.map((entry) => {
		const observed = blenderById.get(entry.id);
		if (!observed) {
			return {
				id: entry.id,
				pass: false,
				failure: "missing-blender-point",
			};
		}
		const expected = projectVecmoPoint(entry.point, camera);
		const classificationAgrees =
			expected.behindCamera === observed.behindCamera &&
			expected.behindCamera === (entry.expect === "behind");
		if (entry.expect === "behind") {
			// world_to_camera_view mirrors u/v for points behind the camera
			// (it divides by v.z/z), so only the classification is comparable.
			return {
				id: entry.id,
				expect: entry.expect,
				expectedBehind: expected.behindCamera,
				observedBehind: observed.behindCamera,
				observedCameraDepth: observed.cameraDepth,
				expectedClipW: expected.clipW,
				comparedCoordinates: false,
				pass: classificationAgrees,
			};
		}
		const deltaU = Math.abs(expected.u - observed.u);
		const deltaV = Math.abs(expected.v - observed.v);
		const chirality = entry.chirality ?? { u: null, v: null };
		const chiralityPass =
			chiralityCheck(observed.u, chirality.u) &&
			chiralityCheck(observed.v, chirality.v);
		return {
			id: entry.id,
			expect: entry.expect,
			expectedU: expected.u,
			expectedV: expected.v,
			observedU: observed.u,
			observedV: observed.v,
			deltaU,
			deltaV,
			observedCameraDepth: observed.cameraDepth,
			comparedCoordinates: true,
			chiralityRule: chirality,
			chiralityPass,
			classificationAgrees,
			pass:
				classificationAgrees &&
				chiralityPass &&
				deltaU <= NORMALIZED_TOLERANCE &&
				deltaV <= NORMALIZED_TOLERANCE,
		};
	});

	const frameMappingPass = blender.frameMapping.every(
		(entry) =>
			entry.identity &&
			entry.expectedBlenderFrame ===
				spec.frame.blenderFrameStart + entry.vecmoFrame,
	);
	const assertionsPass = assertions.every((entry) => entry.pass);
	const pointsPass = points.every((entry) => entry.pass);
	const maxDelta = points.reduce((max, entry) => {
		const deltas = [
			(entry as { deltaU?: number }).deltaU ?? 0,
			(entry as { deltaV?: number }).deltaV ?? 0,
		];
		return Math.max(max, ...deltas);
	}, 0);

	return {
		probeVersion: 1,
		tolerance: NORMALIZED_TOLERANCE,
		axisMatrixRows: AXIS_MATRIX.map((row) => [...row]),
		axisMapping:
			"blenderPoint = sceneUnitsPerPixel * (x_vecmo, z_vecmo, -y_vecmo)",
		fovConvention:
			"vertical FOV is authoritative; Blender sensor_fit=VERTICAL with camera.data.angle_y = verticalFovRadians; horizontal FOV follows the render aspect",
		screenConvention:
			"Vecmo Y-down projects to bottom-origin v; +Y_vecmo lands at v < 0.5",
		sceneUnitsPerPixel: spec.sceneUnitsPerPixel,
		aspect,
		verticalFovRadians,
		deltaTestScope:
			"The per-point delta validates the projection convention only. Applying the same proper rotation to camera and points is invariant, so the rotation choice is pinned by the absolute axis assertions and the screen-side chirality checks, not by the deltas.",
		focalLengthEvidence,
		assertions,
		points,
		frameMapping: blender.frameMapping,
		frameMappingPass,
		maxAbsoluteDelta: maxDelta,
		verdict: assertionsPass && pointsPass && frameMappingPass ? "pass" : "fail",
	};
};

const argValue = (flag: string): string => {
	const index = Bun.argv.indexOf(flag);
	if (index < 0 || index + 1 >= Bun.argv.length) {
		throw new Error(`camera-probe.ts requires ${flag} <path>`);
	}
	return Bun.argv[index + 1] as string;
};

export const runCli = async (): Promise<void> => {
	const spec = (await Bun.file(argValue("--spec")).json()) as Spec;
	const blender = (await Bun.file(
		argValue("--blender"),
	).json()) as BlenderProbe;
	const result = evaluate(spec, blender);
	await Bun.write(argValue("--out"), `${JSON.stringify(result, null, 2)}\n`);
	console.log(
		`[camera-probe] verdict=${result.verdict} maxDelta=${result.maxAbsoluteDelta}`,
	);
	if (result.verdict !== "pass") process.exitCode = 1;
};

if (import.meta.main) {
	await runCli();
}
