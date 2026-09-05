/**
 * S0a falsification-spike harness.
 *
 * Run:
 *   bun scripts/blender-link-spike/run.ts [--fresh]
 *
 * Sequence:
 *   1. build `generated/spike-source.blend` ONCE (see note below),
 *   2. inspect it twice into `evidence/manifest-run{1,2}.json`,
 *   3. require the two manifests to be byte-identical (no timestamps are ever
 *      emitted, so this is an exact comparison, not a normalized one),
 *   4. compute the build key twice into `evidence/buildkey.json`,
 *   5. run the Blender camera probe and the ported Vecmo projection,
 *   6. write `evidence/S0A-REPORT.json`.
 *
 * Why the .blend is built once: Blender does not produce byte-identical
 * .blend files across saves of an identical scene, so regenerating the source
 * between the two build-key computations would make `stable: false` an
 * artifact of this harness rather than a finding. `sourceDigest` is stable per
 * saved file, not across re-saves — recorded in the report.
 *
 * Every Blender invocation uses `--background --factory-startup
 * --python-exit-code 1`. Without `--python-exit-code` a raising script can
 * still exit 0 and silently pass.
 */

import { statSync, unlinkSync } from "node:fs";
import { computeBuildKey, sha256Hex } from "./buildkey.ts";

const BLENDER = "/opt/homebrew/bin/blender";
const TIMEOUT_MS = 120_000;
const HERE = new URL(".", import.meta.url).pathname;
const GENERATED = `${HERE}generated`;
const EVIDENCE = `${HERE}evidence`;
const BLEND_PATH = `${GENERATED}/spike-source.blend`;
const CAMERA_SPEC = `${HERE}camera-probe-spec.json`;

type RunResult = {
	readonly label: string;
	readonly exitCode: number | null;
	readonly timedOut: boolean;
	readonly stderrTail: string;
};

const runs: RunResult[] = [];

const runBlender = async (
	label: string,
	args: readonly string[],
): Promise<RunResult> => {
	const proc = Bun.spawn(
		[
			BLENDER,
			"--background",
			"--factory-startup",
			"--python-exit-code",
			"1",
			...args,
		],
		{
			stdout: "pipe",
			stderr: "pipe",
			signal: AbortSignal.timeout(TIMEOUT_MS),
		},
	);
	let timedOut = false;
	let exitCode: number | null = null;
	let stderr = "";
	try {
		exitCode = await proc.exited;
		stderr = await new Response(proc.stderr).text();
	} catch (error) {
		timedOut = true;
		proc.kill();
		stderr = String(error);
	}
	const result: RunResult = {
		label,
		exitCode,
		timedOut,
		stderrTail: stderr.trim().split("\n").slice(-8).join("\n"),
	};
	runs.push(result);
	if (timedOut) {
		throw new Error(
			`${label}: Blender exceeded ${TIMEOUT_MS}ms and was killed`,
		);
	}
	if (exitCode !== 0) {
		throw new Error(
			`${label}: Blender exited ${exitCode}\n${result.stderrTail}`,
		);
	}
	return result;
};

const runBun = async (
	label: string,
	args: readonly string[],
): Promise<number | null> => {
	const proc = Bun.spawn([process.execPath, ...args], {
		stdout: "inherit",
		stderr: "pipe",
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	const exitCode = await proc.exited;
	const stderr = (await new Response(proc.stderr).text()).trim();
	runs.push({
		label,
		exitCode,
		timedOut: false,
		stderrTail: stderr.split("\n").slice(-8).join("\n"),
	});
	return exitCode;
};

const main = async (): Promise<void> => {
	const fresh = Bun.argv.includes("--fresh");
	const blendExists = await Bun.file(BLEND_PATH).exists();
	if (fresh || !blendExists) {
		await runBlender("make_test_blend", [
			"--python",
			`${HERE}make_test_blend.py`,
			"--",
			"--out",
			BLEND_PATH,
		]);
	}

	// Measure, rather than assume, whether Blender writes byte-identical
	// .blend files for an identical scene. This decides what `sourceDigest`
	// can honestly mean and feeds design §6's artifact-level `reproducible`.
	const resaveDigests: string[] = [];
	for (const index of [1, 2]) {
		const path = `${GENERATED}/resave-probe-${index}.blend`;
		await runBlender(`resave_probe_${index}`, [
			"--python",
			`${HERE}make_test_blend.py`,
			"--",
			"--out",
			path,
		]);
		resaveDigests.push(
			sha256Hex(new Uint8Array(await Bun.file(path).arrayBuffer())),
		);
		unlinkSync(path);
	}
	const resaveDeterminism = {
		question:
			"Does Blender write byte-identical .blend files for an identical scene?",
		digests: resaveDigests,
		byteIdenticalAcrossSaves: resaveDigests[0] === resaveDigests[1],
		consequence:
			"sourceDigest is stable per SAVED FILE, not across re-saves of an identical scene. A rebuild must be keyed off the file the user actually saved; re-authoring an equivalent scene changes the build key.",
	};

	const sourceBytesBefore = new Uint8Array(
		await Bun.file(BLEND_PATH).arrayBuffer(),
	);
	const digestBefore = sha256Hex(sourceBytesBefore);
	const mtimeBefore = statSync(BLEND_PATH).mtimeMs;

	const manifestPaths = [
		`${EVIDENCE}/manifest-run1.json`,
		`${EVIDENCE}/manifest-run2.json`,
	];
	for (const [index, out] of manifestPaths.entries()) {
		await runBlender(`inspect_run${index + 1}`, [
			BLEND_PATH,
			"--python",
			`${HERE}inspect.py`,
			"--",
			"--out",
			out,
		]);
	}
	const manifestTexts = await Promise.all(
		manifestPaths.map((path) => Bun.file(path).text()),
	);
	const manifestIdentical = manifestTexts[0] === manifestTexts[1];

	const blendBytes = new Uint8Array(await Bun.file(BLEND_PATH).arrayBuffer());
	const cameraSpec = (await Bun.file(CAMERA_SPEC).json()) as Record<
		string,
		unknown
	>;
	const keyResults = manifestTexts.map((text) =>
		// biome-ignore lint/suspicious/noExplicitAny: spike-local manifest shape
		computeBuildKey(JSON.parse(text) as any, blendBytes, cameraSpec),
	);
	const buildKeyStable = keyResults[0].buildKey === keyResults[1].buildKey;
	await Bun.write(
		`${EVIDENCE}/buildkey.json`,
		`${JSON.stringify(
			{
				run1: keyResults[0],
				run2: keyResults[1],
				stable: buildKeyStable,
				note: "Both runs hash the same saved .blend. Blender does not write byte-identical .blend files across saves of an identical scene, so sourceDigest is stable per saved file, not across re-saves.",
			},
			null,
			2,
		)}\n`,
	);

	const blenderProbePath = `${EVIDENCE}/camera-probe-blender.json`;
	await runBlender("camera_probe", [
		"--python",
		`${HERE}camera_probe.py`,
		"--",
		"--spec",
		CAMERA_SPEC,
		"--out",
		blenderProbePath,
	]);
	const cameraExit = await runBun("camera-probe-compare", [
		`${HERE}camera-probe.ts`,
		"--spec",
		CAMERA_SPEC,
		"--blender",
		blenderProbePath,
		"--out",
		`${EVIDENCE}/camera-probe.json`,
	]);
	const cameraProbe = (await Bun.file(
		`${EVIDENCE}/camera-probe.json`,
	).json()) as {
		verdict: string;
		maxAbsoluteDelta: number;
		axisMatrixRows: number[][];
		axisMapping: string;
		fovConvention: string;
		deltaTestScope: string;
		focalLengthEvidence: Record<string, unknown>;
		assertions: { id: string; pass: boolean; detail: string }[];
		points: Record<string, unknown>[];
		frameMappingPass: boolean;
		frameMapping: unknown;
	};

	// Negative control. Feeding a DIFFERENT proper rotation (identity: Vecmo
	// up would land on Blender -Y instead of +Z, i.e. content rendered
	// sideways) must leave every per-point delta inside tolerance, because the
	// deltas are invariant when camera and points are rotated together. Only
	// the absolute axis assertion may reject it. This is what stops a ~1e-7
	// delta from reading as "mapping verified".
	const negativeControlRows = [
		[1, 0, 0],
		[0, 1, 0],
		[0, 0, 1],
	];
	const negativeBlenderPath = `${EVIDENCE}/camera-probe-negative-control-blender.json`;
	const negativeComparePath = `${EVIDENCE}/camera-probe-negative-control.json`;
	await runBlender("camera_probe_negative_control", [
		"--python",
		`${HERE}camera_probe.py`,
		"--",
		"--spec",
		CAMERA_SPEC,
		"--axis-rows",
		JSON.stringify(negativeControlRows),
		"--out",
		negativeBlenderPath,
	]);
	await runBun("camera-probe-negative-control-compare", [
		`${HERE}camera-probe.ts`,
		"--spec",
		CAMERA_SPEC,
		"--blender",
		negativeBlenderPath,
		"--out",
		negativeComparePath,
	]);
	const negative = (await Bun.file(negativeComparePath).json()) as {
		verdict: string;
		maxAbsoluteDelta: number;
		assertions: { id: string; pass: boolean }[];
		points: { pass: boolean }[];
	};
	const negativeFailingAssertions = negative.assertions
		.filter((entry) => !entry.pass)
		.map((entry) => entry.id);
	const negativeControl = {
		purpose:
			"Prove the per-point delta comparison cannot distinguish rotations, so the axis matrix is established by absolute assertions rather than by the deltas.",
		axisMatrixRows: negativeControlRows,
		maxAbsoluteDelta: negative.maxAbsoluteDelta,
		allPointsStillPassed: negative.points.every((entry) => entry.pass),
		verdict: negative.verdict,
		caughtOnlyBy: negativeFailingAssertions,
		behavedAsPredicted:
			negative.verdict === "fail" &&
			negative.points.every((entry) => entry.pass) &&
			negative.maxAbsoluteDelta <= 1e-3 &&
			negativeFailingAssertions.length > 0,
	};

	const stopConditions: string[] = [];
	if (!manifestIdentical) {
		stopConditions.push("read-only inspection is not reproducible");
	}
	if (!buildKeyStable) {
		stopConditions.push("build identity is not stable for identical input");
	}
	if (cameraProbe.verdict !== "pass" || cameraExit !== 0) {
		stopConditions.push(
			"camera mapping cannot be uniquely tied to the existing Vecmo projection",
		);
	}
	if (!negativeControl.behavedAsPredicted) {
		stopConditions.push(
			"camera-probe negative control did not behave as predicted; the axis evidence is not trustworthy",
		);
	}

	const report = {
		slice: "S0a",
		title: "Blender CLI adapter falsification spike",
		blenderVersion: keyResults[0].fields.blenderVersion,
		manifestStability: {
			verdict: manifestIdentical ? "stable" : "unstable",
			byteIdentical: manifestIdentical,
			comparison: "exact byte comparison; no timestamps are emitted",
			runs: manifestPaths.map((path) => path.split("/").slice(-1)[0]),
		},
		buildKeyStability: {
			verdict: buildKeyStable ? "stable" : "unstable",
			buildKey: keyResults[0].buildKey,
			fields: keyResults[0].fields,
			reproducible: keyResults[0].reproducible,
			caveat:
				"sourceDigest is stable per saved .blend file, not across re-saves of an identical scene; Blender embeds non-reproducible bytes on save.",
			resaveDeterminism,
		},
		cameraMapping: {
			verdict: cameraProbe.verdict,
			axisMatrixRows: cameraProbe.axisMatrixRows,
			axisMapping: cameraProbe.axisMapping,
			fovConvention: cameraProbe.fovConvention,
			deltaTestScope: cameraProbe.deltaTestScope,
			maxAbsoluteDelta: cameraProbe.maxAbsoluteDelta,
			focalLengthEvidence: cameraProbe.focalLengthEvidence,
			assertions: cameraProbe.assertions,
			points: cameraProbe.points,
			frameMappingPass: cameraProbe.frameMappingPass,
			frameMapping: cameraProbe.frameMapping,
			rotationNegativeControl: negativeControl,
		},
		glbEligibility: keyResults[0].outputProfileVerdict,
		readOnlyGuarantee: {
			statement:
				"inspect.py contains no save-operator call site and asserts at runtime that it contains none. Headless Python always mutates in-memory datablocks, so the guarantee is 'never saves over the user's file', not 'never changes anything'.",
			sourceDigestBeforeInspects: digestBefore,
			sourceDigestAfterInspects: sha256Hex(blendBytes),
			sourceUnchanged: digestBefore === sha256Hex(blendBytes),
			mtimeUnchanged: mtimeBefore === statSync(BLEND_PATH).mtimeMs,
			manifestPathLeakAssertion:
				"inspect.py fails closed if the manifest contains the source path, its realpath, any non-generic ancestor directory, the home directory, or the OS username.",
		},
		apiObservations: [
			"Blender 5.2 id_properties_ui(key).as_dict() ALWAYS returns min/max/soft_min/soft_max/default. An undeclared range comes back as +/-FLT_MAX (3.4028234663852886e38) and an undeclared default as 0.0, which contradicts the property's own value. inspect.py therefore reports rangeDeclared and defaultIsAmbiguous instead of trusting those keys.",
			"isinstance(True, int) is True in Python, so a boolean custom property enumerates as numeric unless bool is excluded explicitly. inspect.py rejects it with reason boolean-not-v1-numeric (the spike source carries spikeDebugFlag to keep that branch exercised).",
			"world_to_camera_view returns z <= 0 for points behind the camera and mirrors u/v for them, so behind-camera points are compared by classification only, never by coordinates.",
			"mathutils.Matrix(...) takes ROWS while the camera basis vectors are COLUMNS; camera_probe.py asserts matrix_world @ (0,0,-1) == forward immediately after assignment to catch the transpose.",
			"camera.data.lens is float32, so angle_y cannot round-trip a double better than float32 eps (observed 4.4e-9 rad). sensor_fit must be set BEFORE angle_y so the setter uses sensor_height.",
			"--factory-startup in Blender 5.2 still enables the bundled add-ons, including io_scene_gltf2 (observed enabledAddons: bl_pkg, cycles, io_anim_bvh, io_curve_svg, io_mesh_uv_layout, io_scene_fbx, io_scene_gltf2, pose_library).",
			"Blender 5.2 reports render engine BLENDER_EEVEE (not BLENDER_EEVEE_NEXT) and a default view transform of AgX; both are S0c legal-value inputs.",
			"bpy.ops.wm.save_as_mainfile writes a `.blend1` backup sibling next to its target (observed: generated/spike-source.blend1). The companion must never save near a user's source: doing so would create or overwrite a `.blend1` beside their file, which the 'never saves over the user's file' guarantee does not cover. Temp copies belong in an adapter-owned directory.",
		],
		statedLimitations: [
			"--factory-startup keeps Blender's BUNDLED default add-on set (io_scene_gltf2 included, observed) but drops every user-installed extension, so environmentDigest's enabledAddons set here is the factory set, not necessarily the production adapter's environment. S1+ must digest the adapter's real add-on set.",
			"Headless EEVEE/GPU motion-blur + DOF render feasibility is NOT covered by S0a; it remains an open S0 stop-condition.",
			"aperture -> f-stop conversion is declared unresolved; the probe carries no aperture value.",
			"Color-management legal values (view transform, primaries, EOTF, alpha mode) are reported by inspect.py but are adjudicated in S0c, not here.",
		],
		stopConditionsTriggered: stopConditions,
		runtimeStatus: stopConditions.length === 0 ? "Ready" : "Blocked",
		invocations: runs,
	};
	await Bun.write(
		`${EVIDENCE}/S0A-REPORT.json`,
		`${JSON.stringify(report, null, 2)}\n`,
	);
	console.log(
		`[run] manifestStable=${manifestIdentical} buildKeyStable=${buildKeyStable} camera=${cameraProbe.verdict} status=${report.runtimeStatus}`,
	);
	if (stopConditions.length > 0) process.exitCode = 1;
};

await main();
