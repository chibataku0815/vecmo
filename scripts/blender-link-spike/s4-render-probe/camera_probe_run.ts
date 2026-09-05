/**
 * Exercises the render job's Vecmo-camera lane (S0a axis matrix M, sensor_fit
 * VERTICAL, verticalFovRadians -- never focalLengthMm).
 *
 * Vecmo world units are scene pixels, so the poses are in pixels and
 * sceneUnitsPerPixel scales them into Blender units. Up is Vecmo (0,-1,0),
 * which M carries to Blender +Z.
 */
import { parseExternalProductionLink } from "../../../src/entities/scene/model/production-link";
import {
	observeRenderEnvironment,
	runProductionRenderJob,
} from "../../blender-link-render-job";

/**
 * Working directory holding `s4-probe.blend` and the render output. It is an
 * argument rather than a constant because the fixture is scratchpad material:
 * a `.blend` must never be authored or re-saved inside the repo.
 *
 * Run: bun scripts/blender-link-spike/s4-render-probe/camera_probe_run.ts <dir>
 */
const S4 = Bun.argv[2];
if (!S4) throw new Error("camera_probe_run requires a working directory");
const link = parseExternalProductionLink(
	JSON.parse(await Bun.file(`${S4}/link.json`).text()),
);
const environment = await observeRenderEnvironment({
	sourcePath: `${S4}/blend/s4-probe.blend`,
});
const FRAMES = 4;
const posesByIndex = Array.from({ length: FRAMES }, (_, index) => ({
	position: { x: index * 40, y: 0, z: 900 },
	target: { x: 0, y: 0, z: 0 },
	up: { x: 0, y: -1, z: 0 },
}));
const result = await runProductionRenderJob({
	sourcePath: `${S4}/blend/s4-probe.blend`,
	outputDirectory: `${S4}/out-camera`,
	link,
	environment,
	frameCount: FRAMES,
	width: 320,
	height: 180,
	codec: "webp-lossless",
	color: {
		colorPrimaries: "bt709",
		whitePoint: "d65",
		transferFunction: "srgb",
		viewTransform: "Standard",
		alphaMode: "straight",
		dynamicRange: "sdr",
		bitsPerChannel: 8,
	},
	camera: { posesByIndex },
});
console.log(
	JSON.stringify(
		{
			ok: result.ok,
			...(result.ok
				? {
						frameCount: result.manifest.frameCount,
						cameraDigest: result.manifest.cameraDigest,
						totalByteLength: result.totalByteLength,
					}
				: { diagnostic: result.diagnostic }),
		},
		null,
		2,
	),
);
