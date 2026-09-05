/**
 * Headless Blender render job for the rendered-RGBA lane (S4-B).
 *
 * This is a sibling of `blender-link-companion.ts`, not a fork of it. It honors
 * the same disciplines — build keys come from the SINGLE derivation in
 * `entities/scene/model/production-artifacts.ts`, no absolute path ever reaches
 * a returned value, the source `.blend` is never written, and every failure is a
 * typed code rather than a message — while keeping the render lane out of the
 * live protocol until S4-C wires an owner to it. Adding a render message to
 * `production-link-protocol.ts` would widen what protocol v1 accepts on the
 * wire, so that stays a deliberate later step.
 *
 * The division of labour with `blender-link-companion/render_frames.py` is
 * exact: Python renders and reports what it observed, and this module hashes the
 * bytes and builds the manifest. Digests are computed in ONE place for the whole
 * product, so a frame digest and an artifact digest cannot drift apart.
 *
 * CLI (probe and operator use):
 *   bun scripts/blender-link-render-job.ts \
 *     --source <absolute .blend> --out <output dir> \
 *     --link <link.json> --frames 120 [--width 640] [--height 360] \
 *     [--codec webp-lossless] [--seed 0] [--blender <path>]
 */

import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	canonicalProductionJson,
	deriveProductionBuildKey,
	deriveProductionBuildKeyFields,
	PRODUCTION_ARTIFACT_ADAPTER_VERSION,
	type ProductionBuildEnvironment,
	productionDigestOfBytes,
	productionDigestOfText,
	productionSourceClosureDigest,
} from "../src/entities/scene/model/production-artifacts";
import {
	PRODUCTION_FRAME_PACKAGE_SCHEMA_VERSION,
	type ProductionFramePackageCodec,
	type ProductionFramePackageColorDeclaration,
	type ProductionFramePackageIssueCode,
	type ProductionFramePackageManifest,
	parseProductionFramePackageManifest,
} from "../src/entities/scene/model/production-frame-package";
import {
	type AllowlistedBindingDescriptor,
	type ExternalProductionLink,
	parseExternalProductionLink,
} from "../src/entities/scene/model/production-link";
import type { ProductionLinkDiagnosticCode } from "../src/entities/scene/model/production-link-protocol";

const DEFAULT_BLENDER_BINARY =
	"/Applications/Blender.app/Contents/MacOS/Blender";
const RENDER_SCRIPT = path.join(
	import.meta.dir,
	"blender-link-companion",
	"render_frames.py",
);
const JOB_VERSION = 1;
const DEFAULT_RENDER_TIMEOUT_MS = 3_600_000;
/**
 * Diagnostics are bounded before they leave this process. Blender's stderr can
 * name absolute paths and source text, so it is truncated AND path-redacted; the
 * untruncated form only ever reaches this process's own console.
 */
const MAX_DIAGNOSTIC_DETAIL_CHARS = 512;
const MAX_STDERR_RETAINED_CHARS = 16_384;
const PROGRESS_PREFIX = "VECMO-PROGRESS ";

export type ProductionRenderJobCameraPose = {
	readonly position: {
		readonly x: number;
		readonly y: number;
		readonly z: number;
	};
	readonly target: {
		readonly x: number;
		readonly y: number;
		readonly z: number;
	};
	readonly up?: { readonly x: number; readonly y: number; readonly z: number };
};

export type ProductionRenderJobControlInput = {
	readonly binding: AllowlistedBindingDescriptor;
	/** One value per package-local frame index. Length must equal `frameCount`. */
	readonly valuesByIndex: readonly number[];
};

export type ProductionRenderJobProgress = {
	readonly index: number;
	readonly blenderFrame: number;
	readonly elapsedMs: number;
	readonly frameCount: number;
};

export type ProductionRenderJobRequest = {
	readonly sourcePath: string;
	readonly outputDirectory: string;
	readonly link: ExternalProductionLink;
	readonly environment: ProductionBuildEnvironment;
	readonly frameCount: number;
	readonly width: number;
	readonly height: number;
	readonly codec: ProductionFramePackageCodec;
	readonly color: ProductionFramePackageColorDeclaration;
	readonly seed?: number;
	readonly camera?: {
		readonly posesByIndex: readonly ProductionRenderJobCameraPose[];
	};
	readonly controls?: readonly ProductionRenderJobControlInput[];
	readonly blenderBinary?: string;
	readonly timeoutMs?: number;
	readonly signal?: AbortSignal;
	readonly onProgress?: (progress: ProductionRenderJobProgress) => void;
};

export type ProductionRenderJobDiagnostic = {
	readonly code: ProductionLinkDiagnosticCode | ProductionFramePackageIssueCode;
	/** Bounded, path-redacted. Safe to surface; never the raw adapter stderr. */
	readonly detail?: string;
};

export type ProductionRenderJobResult =
	| {
			readonly ok: true;
			readonly manifest: ProductionFramePackageManifest;
			/** Where the frames landed. Local only; never put on a manifest. */
			readonly outputDirectory: string;
			readonly totalByteLength: number;
	  }
	| { readonly ok: false; readonly diagnostic: ProductionRenderJobDiagnostic };

const failure = (
	code: ProductionRenderJobDiagnostic["code"],
	detail?: string,
): ProductionRenderJobResult => ({
	ok: false,
	diagnostic: { code, ...(detail ? { detail: boundedDetail(detail) } : {}) },
});

/**
 * Strips anything that reads as a filesystem location, then truncates. Both
 * halves matter: a truncated path is still a path, and an untruncated redaction
 * is still an unbounded diagnostic.
 */
const boundedDetail = (text: string): string =>
	text
		.replace(/(?:\/[\w.@-]+)+/gu, "<path>")
		.replace(/[a-z]:[\\/][^\s]*/giu, "<path>")
		.slice(0, MAX_DIAGNOSTIC_DETAIL_CHARS);

/**
 * Runs the render script. Cancellation and timeout are the same mechanism — an
 * aborted signal — so a cancelled job and a timed-out job cannot take different
 * cleanup paths and leave different amounts of partial output behind.
 */
const runRenderScript = async ({
	binary,
	sourcePath,
	jobPath,
	timeoutMs,
	signal,
	frameCount,
	onProgress,
}: {
	readonly binary: string;
	readonly sourcePath: string;
	readonly jobPath: string;
	readonly timeoutMs: number;
	readonly signal?: AbortSignal;
	readonly frameCount: number;
	readonly onProgress?: (progress: ProductionRenderJobProgress) => void;
}): Promise<
	| { readonly ok: true }
	| {
			readonly ok: false;
			readonly timedOut: boolean;
			readonly cancelled: boolean;
			readonly stderr: string;
	  }
> => {
	const timeout = AbortSignal.timeout(timeoutMs);
	const composed = signal ? AbortSignal.any([timeout, signal]) : timeout;
	const proc = Bun.spawn(
		[
			binary,
			"--background",
			"--factory-startup",
			"--python-exit-code",
			"1",
			sourcePath,
			"--python",
			RENDER_SCRIPT,
			"--",
			"--job",
			jobPath,
		],
		{ stdout: "pipe", stderr: "pipe", signal: composed },
	);

	// Progress is consumed as it streams. Reading stdout only after exit would
	// turn a long render into a silent one and would deadlock on a full pipe.
	const readProgress = (async () => {
		let carry = "";
		const decoder = new TextDecoder();
		for await (const chunk of proc.stdout) {
			carry += decoder.decode(chunk, { stream: true });
			const lines = carry.split("\n");
			carry = lines.pop() ?? "";
			for (const line of lines) {
				if (!line.startsWith(PROGRESS_PREFIX)) continue;
				try {
					const parsed = JSON.parse(line.slice(PROGRESS_PREFIX.length));
					onProgress?.({
						index: Number(parsed.index),
						blenderFrame: Number(parsed.blenderFrame),
						elapsedMs: Number(parsed.elapsedMs),
						frameCount,
					});
				} catch {
					// A malformed progress line is not a render failure.
				}
			}
		}
	})();

	try {
		const exitCode = await proc.exited;
		await readProgress;
		const stderr = (await new Response(proc.stderr).text()).slice(
			-MAX_STDERR_RETAINED_CHARS,
		);
		if (exitCode === 0) return { ok: true };
		// Detail stays process-local here: it can name paths and source text.
		if (stderr.trim().length > 0) {
			console.error(`[render-job] adapter stderr:\n${stderr.trim()}`);
		}
		return { ok: false, timedOut: false, cancelled: false, stderr };
	} catch {
		proc.kill();
		return {
			ok: false,
			timedOut: timeout.aborted,
			cancelled: Boolean(signal?.aborted),
			stderr: "",
		};
	}
};

type RenderReport = {
	readonly frameStart: number;
	readonly frameCount: number;
	readonly codec: string;
	readonly width: number;
	readonly height: number;
	readonly frames: readonly {
		readonly index: number;
		readonly blenderFrame: number;
		readonly fileName: string;
		readonly byteLength: number;
	}[];
	readonly controls: { readonly unresolved: readonly unknown[] };
	readonly simulationFeatures: readonly Record<string, unknown>[];
	readonly settings: Record<string, unknown>;
	readonly camera: Record<string, unknown>;
	readonly seed: Record<string, unknown>;
};

/**
 * Renders one frame package and returns its manifest.
 *
 * The manifest is round-tripped through `parseProductionFramePackageManifest`
 * before it is returned: this producer must satisfy the same hard gate a
 * consumer applies, so a producer bug surfaces here as a typed code instead of
 * downstream as an unexplained playback artefact.
 */
export const runProductionRenderJob = async (
	request: ProductionRenderJobRequest,
): Promise<ProductionRenderJobResult> => {
	const sourcePath = path.resolve(request.sourcePath);
	const outputDirectory = path.resolve(request.outputDirectory);
	if (path.dirname(sourcePath) === outputDirectory) {
		// Belt and braces: the Python side asserts this too, but a job that would
		// write beside the user's source must never reach Blender at all.
		return failure(
			"production-link-build-failed",
			"output directory is the source directory",
		);
	}
	try {
		const info = await stat(sourcePath);
		if (!info.isFile()) {
			return failure("production-link-source-unreadable");
		}
	} catch {
		return failure("production-link-source-unreadable");
	}

	const frameCount = request.frameCount;
	if (!Number.isSafeInteger(frameCount) || frameCount <= 0) {
		return failure("frame-package-malformed", "frameCount must be positive");
	}
	for (const control of request.controls ?? []) {
		if (control.valuesByIndex.length !== frameCount) {
			return failure(
				"frame-package-malformed",
				"one control value per frame is required",
			);
		}
	}
	if (request.camera && request.camera.posesByIndex.length !== frameCount) {
		return failure(
			"frame-package-malformed",
			"one camera pose per frame is required",
		);
	}

	// The single derivation. `deriveProductionBuildKeyFields` is called for the
	// camera digest and `deriveProductionBuildKey` for the key itself; both are
	// the same public contract, so nothing is re-ported here.
	const fields = await deriveProductionBuildKeyFields(
		request.link,
		request.environment,
	);
	const buildKey = await deriveProductionBuildKey(
		request.link,
		request.environment,
	);
	if (!fields || !buildKey) {
		return failure(
			"production-link-build-failed",
			"build key derivation failed",
		);
	}

	await mkdir(outputDirectory, { recursive: true });
	const jobPath = path.join(outputDirectory, "render-job.json");
	const reportPath = path.join(outputDirectory, "render-report.json");
	const job = {
		jobVersion: JOB_VERSION,
		outputDirectory,
		reportPath,
		frameStart: request.link.frame.blenderFrameStart,
		frameCount,
		width: request.width,
		height: request.height,
		fps: request.link.frame.fps,
		codec: request.codec,
		seed: request.seed ?? null,
		filmTransparent: true,
		viewTransform: request.color.viewTransform,
		camera: request.camera
			? {
					verticalFovRadians: request.link.camera.verticalFovRadians,
					sceneUnitsPerPixel: request.link.camera.sceneUnitsPerPixel,
					sensorFit: request.link.camera.sensorFit,
					aperture: request.link.camera.aperture ?? null,
					posesByIndex: request.camera.posesByIndex,
				}
			: null,
		controls: (request.controls ?? []).map((control) => ({
			binding: control.binding,
			valuesByIndex: control.valuesByIndex,
		})),
	};
	await Bun.write(jobPath, JSON.stringify(job, null, 2));

	const run = await runRenderScript({
		binary: request.blenderBinary ?? DEFAULT_BLENDER_BINARY,
		sourcePath,
		jobPath,
		timeoutMs: request.timeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS,
		signal: request.signal,
		frameCount,
		onProgress: request.onProgress,
	});
	if (!run.ok) {
		if (run.cancelled) return failure("production-link-cancelled");
		if (run.timedOut) return failure("production-link-adapter-timeout");
		return failure(
			"production-link-build-failed",
			run.stderr.trim().slice(-256),
		);
	}

	let report: RenderReport;
	try {
		report = JSON.parse(await readFile(reportPath, "utf8")) as RenderReport;
	} catch {
		return failure("production-link-build-failed", "render report unreadable");
	}
	// The producing side reports the resolution it actually configured. Comparing
	// it is not ceremony: this whole contract is about exact frame delivery, and
	// a manifest that declares a size the pixels do not have is the silent
	// corruption every other rule here is written to prevent.
	if (
		report.settings.resolutionX !== request.width ||
		report.settings.resolutionY !== request.height ||
		report.settings.resolutionPercentage !== 100
	) {
		return failure(
			"frame-package-malformed",
			"rendered resolution disagrees with the requested size",
		);
	}
	if (report.controls.unresolved.length > 0) {
		// A control the producing side could not resolve means the build did not
		// evaluate what the document asked for. Admitting it would put a package
		// under a build key that describes inputs it never received.
		return failure(
			"production-link-build-failed",
			"a published control binding did not resolve",
		);
	}
	// The report claims a frame count; the filesystem is what decides it. Every
	// byte length is re-observed and every digest is taken here, so a truncated
	// or vanished frame cannot be inherited from the producer's own bookkeeping.
	const frames: {
		index: number;
		blenderFrame: number;
		fileName: string;
		byteLength: number;
		digest: string;
	}[] = [];
	let totalByteLength = 0;
	for (const entry of report.frames) {
		const framePath = path.join(outputDirectory, entry.fileName);
		let bytes: Buffer;
		try {
			bytes = await readFile(framePath);
		} catch {
			return failure("frame-package-frame-missing", `index ${entry.index}`);
		}
		const digest = await productionDigestOfBytes(new Uint8Array(bytes));
		if (!digest) {
			return failure(
				"production-link-build-failed",
				"frame digest unavailable",
			);
		}
		totalByteLength += bytes.byteLength;
		frames.push({
			index: entry.index,
			blenderFrame: entry.blenderFrame,
			fileName: entry.fileName,
			byteLength: bytes.byteLength,
			digest,
		});
	}

	const parsed = parseProductionFramePackageManifest({
		schemaVersion: PRODUCTION_FRAME_PACKAGE_SCHEMA_VERSION,
		adapter: "blender",
		outputProfile: "rendered-rgba-sequence",
		linkId: request.link.linkId,
		buildKey,
		codec: request.codec,
		width: request.width,
		height: request.height,
		fps: request.link.frame.fps,
		frameCount,
		blenderFrameStart: request.link.frame.blenderFrameStart,
		color: request.color,
		cameraDigest: fields.cameraDigest,
		// Derived from an UNCONDITIONAL scan of the scene's state-carrying
		// features, never from whether a seed was requested. Reading it off the
		// seed record would fail open: a scene full of particle systems would be
		// called reproducible precisely because nobody passed `--seed`. S0's rule
		// is that an unmeasured nondeterminism downgrades the claim rather than
		// moving the build key, so this must be computed, not asserted.
		reproducible: report.simulationFeatures.length === 0,
		frames,
	});
	if (!parsed.ok) {
		return failure(parsed.code, `frame index ${parsed.index ?? "n/a"}`);
	}
	await rm(jobPath, { force: true });
	return {
		ok: true,
		manifest: parsed.manifest,
		outputDirectory,
		totalByteLength,
	};
};

/**
 * Inspect-lite: the environment facts the build key needs, observed fresh from
 * the source rather than trusted from a document. This mirrors the companion's
 * `inspectSource` for the fields the render lane requires; the companion's full
 * inspect remains the wire path.
 */
export const observeRenderEnvironment = async ({
	sourcePath,
	blenderBinary,
}: {
	readonly sourcePath: string;
	readonly blenderBinary?: string;
}): Promise<ProductionBuildEnvironment | null> => {
	const inspectScript = path.join(
		import.meta.dir,
		"blender-link-companion",
		"inspect.py",
	);
	// The OS temp directory, never anywhere near the source: Blender writes
	// siblings beside what it touches, and an inspect artifact placed in the
	// user's own tree is the same defect class the companion's export guard
	// exists to prevent.
	const manifestPath = path.join(
		tmpdir(),
		`vecmo-render-inspect-${crypto.randomUUID()}.json`,
	);
	const proc = Bun.spawn(
		[
			blenderBinary ?? DEFAULT_BLENDER_BINARY,
			"--background",
			"--factory-startup",
			"--python-exit-code",
			"1",
			path.resolve(sourcePath),
			"--python",
			inspectScript,
			"--",
			"--out",
			manifestPath,
		],
		{ stdout: "pipe", stderr: "pipe" },
	);
	if ((await proc.exited) !== 0) {
		console.error(await new Response(proc.stderr).text());
		return null;
	}
	try {
		const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
		const blendBytes = await readFile(path.resolve(sourcePath));
		const blendDigest = await productionDigestOfBytes(
			new Uint8Array(blendBytes),
		);
		if (!blendDigest) return null;
		const sourceDigest = await productionSourceClosureDigest(
			blendDigest,
			manifest.externalDependencies.contentDigests,
		);
		const environmentDigest = await productionDigestOfText(
			canonicalProductionJson({
				blenderVersionString: manifest.blender.versionString,
				blenderBuildDate: manifest.blender.buildDate,
				blenderBuildHash: manifest.blender.buildHash,
				blenderBuildPlatform: manifest.blender.buildPlatform,
				enabledAddons: [...manifest.environment.enabledAddons].sort(),
				hostPlatform: manifest.host.platform,
				hostMachine: manifest.host.machine,
			}),
		);
		const renderSettingsDigest = await productionDigestOfText(
			canonicalProductionJson(manifest.render),
		);
		if (!sourceDigest || !environmentDigest || !renderSettingsDigest)
			return null;
		return {
			blenderVersion: manifest.blender.versionString,
			environmentDigest,
			renderSettingsDigest,
			sourceDigest,
			adapterVersion: PRODUCTION_ARTIFACT_ADAPTER_VERSION,
		};
	} catch {
		return null;
	} finally {
		await rm(manifestPath, { force: true });
	}
};

const argValue = (flag: string, fallback?: string): string => {
	const index = Bun.argv.indexOf(flag);
	const value = index >= 0 ? Bun.argv[index + 1] : undefined;
	if (value === undefined && fallback === undefined) {
		throw new Error(`blender-link-render-job requires ${flag}`);
	}
	return value ?? (fallback as string);
};

const main = async (): Promise<void> => {
	const sourcePath = argValue("--source");
	const outputDirectory = argValue("--out");
	const blenderBinary = argValue("--blender", DEFAULT_BLENDER_BINARY);
	const linkPath = argValue("--link");
	const frameCount = Number(argValue("--frames", "120"));
	const width = Number(argValue("--width", "640"));
	const height = Number(argValue("--height", "360"));
	const codec = argValue(
		"--codec",
		"webp-lossless",
	) as ProductionFramePackageCodec;
	const seedText = argValue("--seed", "");

	const link = parseExternalProductionLink(
		JSON.parse(await readFile(path.resolve(linkPath), "utf8")),
	);
	if (!link) throw new Error("link contract did not parse");

	const environment = await observeRenderEnvironment({
		sourcePath,
		blenderBinary,
	});
	if (!environment) throw new Error("environment observation failed");

	const started = Bun.nanoseconds();
	const result = await runProductionRenderJob({
		sourcePath,
		outputDirectory,
		link,
		environment,
		frameCount,
		width,
		height,
		codec,
		color: {
			colorPrimaries: "bt709",
			whitePoint: "d65",
			transferFunction: "srgb",
			viewTransform: "Standard",
			alphaMode: "straight",
			dynamicRange: "sdr",
			bitsPerChannel: 8,
		},
		...(seedText ? { seed: Number(seedText) } : {}),
		blenderBinary,
		onProgress: (progress) => {
			if (progress.index % 10 === 0 || progress.index === frameCount - 1) {
				console.log(
					`[render-job] ${progress.index + 1}/${progress.frameCount} blenderFrame=${progress.blenderFrame} ${progress.elapsedMs}ms`,
				);
			}
		},
	});
	const elapsedMs = Math.round((Bun.nanoseconds() - started) / 1e6);
	if (!result.ok) {
		console.error(`[render-job] failed: ${JSON.stringify(result.diagnostic)}`);
		process.exitCode = 1;
		return;
	}
	await Bun.write(
		path.join(result.outputDirectory, "manifest.json"),
		`${JSON.stringify(result.manifest, null, 2)}\n`,
	);
	console.log(
		`[render-job] ok frames=${result.manifest.frameCount} bytes=${result.totalByteLength} elapsedMs=${elapsedMs}`,
	);
};

if (import.meta.main) {
	await main();
}
