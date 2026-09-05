/**
 * S0a deterministic build key.
 *
 * Implements the ten hashed fields enumerated in
 * `docs/plans/active/blender-vecmo-integrated-motion-design.html` #contract:
 *
 *   buildKey = sha256(canonicalJSON({
 *     sourceDigest, contractVersion, adapterVersion, blenderVersion,
 *     outputProfile, frameContract, cameraDigest, publishedControlDigest,
 *     renderSettingsDigest, environmentDigest
 *   }))
 *
 * No npm dependencies: hashing is `Bun.CryptoHasher`.
 *
 * Run:
 *   bun scripts/blender-link-spike/buildkey.ts \
 *     --manifest <manifest.json> --blend <source.blend> \
 *     --camera-spec <camera-probe-spec.json> --out <buildkey-run.json>
 */

export const CONTRACT_VERSION = 1;
export const ADAPTER_VERSION = "blender-link-spike-0.1.0";

const GLTF_DISQUALIFIERS = [
	{ key: "hasDrivers", reason: "drivers-not-representable-in-gltf" },
	{ key: "hasParticleSystems", reason: "particle-systems-not-exported" },
	{ key: "hasPhysics", reason: "physics-simulation-not-exported" },
	{ key: "hasSimulationNodes", reason: "simulation-nodes-not-exported" },
	{
		key: "usesProceduralTexturesOnly",
		reason: "procedural-shader-graph-not-exported",
	},
] as const;

const GLTF_SIGNAL_ONLY = ["hasShapeKeys", "hasNla"] as const;

export type JsonValue =
	| string
	| number
	| boolean
	| null
	| readonly JsonValue[]
	| { readonly [key: string]: JsonValue };

/** Sorted keys, `undefined` dropped, no whitespace. */
export const canonicalJSON = (value: unknown): string => {
	if (value === null) return "null";
	if (Array.isArray(value)) {
		return `[${value.map((entry) => canonicalJSON(entry)).join(",")}]`;
	}
	if (typeof value === "object") {
		const record = value as Record<string, unknown>;
		const entries = Object.keys(record)
			.sort()
			.filter((key) => record[key] !== undefined)
			.map((key) => `${JSON.stringify(key)}:${canonicalJSON(record[key])}`);
		return `{${entries.join(",")}}`;
	}
	if (typeof value === "number" && !Number.isFinite(value)) {
		throw new Error("canonicalJSON refuses non-finite numbers");
	}
	if (value === undefined) {
		throw new Error("canonicalJSON refuses undefined");
	}
	return JSON.stringify(value);
};

export const sha256Hex = (input: string | Uint8Array): string =>
	new Bun.CryptoHasher("sha256").update(input).digest("hex");

const digestOf = (value: unknown): string => sha256Hex(canonicalJSON(value));

type Manifest = {
	readonly blender: {
		readonly versionString: string;
		readonly buildDate: string;
		readonly buildHash: string;
		readonly buildPlatform: string;
	};
	readonly host: { readonly platform: string; readonly machine: string };
	readonly environment: { readonly enabledAddons: readonly string[] };
	readonly scene: {
		readonly fps: number;
		readonly durationFrames: number;
		readonly frameStart: number;
	};
	readonly render: Record<string, unknown>;
	readonly publishedControlCandidates: readonly Record<string, unknown>[];
	readonly gltfSignals: Record<string, unknown>;
	readonly linkedLibraryCount: number;
	readonly externalDependencies: {
		readonly contentDigests: readonly string[];
		readonly missingCount: number;
	};
};

export type OutputProfileVerdict = {
	readonly outputProfile: "interactive-glb" | "rendered-rgba-sequence";
	readonly verdict: "eligible-interactive-glb" | "rendered-required";
	readonly provisional: boolean;
	readonly verdictScope: string;
	readonly deferredVerifications: readonly string[];
	readonly reasonCodes: readonly string[];
	readonly nonDisqualifyingSignals: readonly string[];
};

/**
 * S0a measures REPRESENTABILITY SIGNALS only. An `eligible-interactive-glb`
 * verdict here is provisional: nothing in this spike exports a GLB, so nothing
 * confirms that the interactive mode's actual premise holds — that a keyframed
 * object action arrives as a named, seekable Babylon animation group. Design §9
 * forbids silently degrading an unsupported source into GLB, and an empty
 * `reasonCodes` list must not be read as "nothing stands in the way".
 */
const VERDICT_SCOPE =
	"Representability signals only. This verdict does not verify that keyframed object animation round-trips through io_scene_gltf2 into a named, seekable Babylon animation group, nor that the Principled BSDF survives glTF material lowering. An eligible verdict is provisional until those are measured (S1).";

const DEFERRED_VERIFICATIONS = [
	"object-level location action -> glTF animation channel round-trip (spike source has actionCount 1, no armature, no NLA track)",
	"glTF animation -> named Babylon animation group addressable by explicit seek from the Vecmo frame",
	"Principled BSDF base color + metallic -> glTF PBR material lowering fidelity",
] as const;

/**
 * Fail closed: any unknown or missing signal forces `rendered-required`.
 * Design §9 forbids silently degrading an unsupported source into GLB.
 */
export const resolveOutputProfile = (
	manifest: Manifest,
): OutputProfileVerdict => {
	const signals = manifest.gltfSignals as Record<string, unknown>;
	const reasonCodes: string[] = [];
	for (const { key, reason } of GLTF_DISQUALIFIERS) {
		const value = signals[key];
		if (typeof value !== "boolean") {
			reasonCodes.push(`inspection-incomplete:${key}`);
			continue;
		}
		if (value) reasonCodes.push(reason);
	}
	const unknownSignals = signals.unknownSignals;
	if (!Array.isArray(unknownSignals)) {
		reasonCodes.push("inspection-incomplete:unknownSignals");
	} else {
		for (const entry of unknownSignals) {
			reasonCodes.push(`inspection-incomplete:${String(entry)}`);
		}
	}
	if (manifest.linkedLibraryCount > 0) {
		reasonCodes.push("linked-libraries-require-closure-resolution");
	}
	if (manifest.externalDependencies.missingCount > 0) {
		reasonCodes.push("external-dependency-unresolved");
	}
	const nonDisqualifyingSignals = GLTF_SIGNAL_ONLY.filter(
		(key) => signals[key] === true,
	);
	const eligible = reasonCodes.length === 0;
	return {
		outputProfile: eligible ? "interactive-glb" : "rendered-rgba-sequence",
		verdict: eligible ? "eligible-interactive-glb" : "rendered-required",
		provisional: eligible,
		verdictScope: VERDICT_SCOPE,
		deferredVerifications: [...DEFERRED_VERIFICATIONS],
		reasonCodes: [...reasonCodes].sort(),
		nonDisqualifyingSignals,
	};
};

/**
 * Closure digest: `.blend` bytes plus the sorted content digests of every
 * external dependency inspect.py resolved. The spike source has none, so the
 * closure reduces to the file bytes — recorded explicitly so a future source
 * with textures/libraries cannot silently reuse a bytes-only key.
 */
export const computeSourceDigest = (
	blendBytes: Uint8Array,
	externalDigests: readonly string[],
): string => {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update("blend-bytes:");
	hasher.update(blendBytes);
	hasher.update("external-closure:");
	for (const digest of [...externalDigests].sort()) {
		hasher.update(digest);
	}
	return hasher.digest("hex");
};

export type BuildKeyFields = {
	readonly sourceDigest: string;
	readonly contractVersion: number;
	readonly adapterVersion: string;
	readonly blenderVersion: string;
	readonly outputProfile: string;
	readonly frameContract: string;
	readonly cameraDigest: string;
	readonly publishedControlDigest: string;
	readonly renderSettingsDigest: string;
	readonly environmentDigest: string;
};

export type BuildKeyResult = {
	readonly buildKey: string;
	readonly fields: BuildKeyFields;
	readonly outputProfileVerdict: OutputProfileVerdict;
	readonly reproducible: boolean;
};

export const computeBuildKey = (
	manifest: Manifest,
	blendBytes: Uint8Array,
	cameraSpec: Record<string, unknown>,
): BuildKeyResult => {
	const outputProfileVerdict = resolveOutputProfile(manifest);
	const camera = cameraSpec.camera as Record<string, unknown>;
	const fields: BuildKeyFields = {
		sourceDigest: computeSourceDigest(
			blendBytes,
			manifest.externalDependencies.contentDigests,
		),
		contractVersion: CONTRACT_VERSION,
		adapterVersion: ADAPTER_VERSION,
		blenderVersion: manifest.blender.versionString,
		outputProfile: outputProfileVerdict.outputProfile,
		frameContract: digestOf({
			fps: manifest.scene.fps,
			durationFrames: manifest.scene.durationFrames,
			blenderFrameStart: manifest.scene.frameStart,
		}),
		cameraDigest: digestOf({
			mode: "vecmo-shot-camera",
			position: camera.position,
			target: camera.target,
			up: camera.up,
			near: camera.near,
			far: camera.far,
			verticalFovRadians: (Number(camera.verticalFovDegrees) * Math.PI) / 180,
			sceneUnitsPerPixel: cameraSpec.sceneUnitsPerPixel,
			sensorFit: "VERTICAL",
			resolution: cameraSpec.resolution,
		}),
		publishedControlDigest: digestOf(manifest.publishedControlCandidates),
		renderSettingsDigest: digestOf(manifest.render),
		environmentDigest: digestOf({
			blenderVersionString: manifest.blender.versionString,
			blenderBuildDate: manifest.blender.buildDate,
			blenderBuildHash: manifest.blender.buildHash,
			blenderBuildPlatform: manifest.blender.buildPlatform,
			enabledAddons: [...manifest.environment.enabledAddons].sort(),
			hostPlatform: manifest.host.platform,
			hostMachine: manifest.host.machine,
		}),
	};
	return {
		buildKey: sha256Hex(canonicalJSON(fields)),
		fields,
		outputProfileVerdict,
		// The spike source has no simulation or bake dependency, so the build
		// request is reproducible in the design §6 sense. This flag is
		// artifact-level and deliberately NOT a hash input.
		reproducible: true,
	};
};

const argValue = (flag: string): string => {
	const index = Bun.argv.indexOf(flag);
	if (index < 0 || index + 1 >= Bun.argv.length) {
		throw new Error(`buildkey.ts requires ${flag} <path>`);
	}
	return Bun.argv[index + 1] as string;
};

export const runCli = async (): Promise<void> => {
	const manifest = (await Bun.file(argValue("--manifest")).json()) as Manifest;
	const cameraSpec = (await Bun.file(
		argValue("--camera-spec"),
	).json()) as Record<string, unknown>;
	const blendBytes = new Uint8Array(
		await Bun.file(argValue("--blend")).arrayBuffer(),
	);
	const result = computeBuildKey(manifest, blendBytes, cameraSpec);
	const serialized = `${JSON.stringify(result, null, 2)}\n`;
	await Bun.write(argValue("--out"), serialized);
	console.log(`[buildkey] ${result.buildKey}`);
};

if (import.meta.main) {
	await runCli();
}
