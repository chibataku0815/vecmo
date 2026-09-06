import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { deserializeMotionDocument } from "@/entities/motion/model/serialization";
import { parseMotionGrammarLayer } from "@/entities/motion-grammar/model/parse";
import { deserializeSceneDocument } from "@/entities/scene/model/serialization";
import type { SceneDocument } from "@/entities/scene/model/types";
import { createExportBundle } from "@/features/export/model/bundle";
import {
	createMotionArtifactRuntimeAssetWithBudget,
	createMotionCodeExportAssets,
} from "@/features/export/model/code";
import { fileStemForScene } from "@/features/export/model/json";
import { exportOptimizationOptionsForProfile } from "@/features/export/model/optimization";
import { sceneNeedsGpuSurface } from "@/features/export/model/raster-passes";
import { MOTION_RUNTIME_SAMPLER_SOURCE } from "@/features/export/model/runtime-sampler.generated";
import { MOTION_RUNTIME_SAMPLER_CORE_SOURCE } from "@/features/export/model/runtime-sampler-core.generated";
import { MOTION_RUNTIME_SAMPLER_FLAT_SOURCE } from "@/features/export/model/runtime-sampler-flat.generated";
import { MOTION_RUNTIME_SAMPLER_LEAN_SOURCE } from "@/features/export/model/runtime-sampler-lean.generated";
import { sceneHasVideoMedia } from "@/features/export/model/video-frame-materialize";
import {
	findReferenceFixture,
	REFERENCE_SCENE_FIXTURES,
} from "@/features/reference-scenes/fixtures";

/**
 * Headless twin of the editor's "Motion / Code — self-contained embeddable
 * artifact (EMBED)" export. Restores a reference-scene fixture through the SAME
 * deserializers the editor uses on load, runs the SAME
 * `createExportBundle` -> `createMotionCodeExportAssets` pipeline the export
 * menu runs under the `motion-artifact` profile, and writes the emitted assets
 * verbatim — so a consuming project gets genuine export output, not a bespoke
 * headless renderer.
 *
 * Deliberately always takes the SVG-runtime route (`createMotionCodeExportAssets`),
 * never the WebGL player: the goal is the portable `<stem>.runtime.js`
 * artifact. The GPU/video routing predicates the GUI switches on are reported
 * in the stdout JSON (`gpuSurface`, `videoMedia`) so the caller can see when
 * the in-app menu would have chosen the player instead.
 */

const EXPORT_PROFILE = "motion-artifact" as const;
const EXPORT_CURRENT_FRAME = 0;

const RUNTIME_SAMPLER_SOURCE_BY_TIER = {
	full: MOTION_RUNTIME_SAMPLER_SOURCE,
	core: MOTION_RUNTIME_SAMPLER_CORE_SOURCE,
	lean: MOTION_RUNTIME_SAMPLER_LEAN_SOURCE,
	flat: MOTION_RUNTIME_SAMPLER_FLAT_SOURCE,
} as const;

type RuntimeSamplerTier = keyof typeof RUNTIME_SAMPLER_SOURCE_BY_TIER;

// A `function` declaration, not a `const` arrow: TypeScript only applies
// never-returning narrowing (`if (!slug) fail(...)` leaving `slug: string`)
// when it can pin the callee's identity that way.
function fail(message: string): never {
	console.error(`export-motion-artifact: ${message}`);
	process.exit(1);
}

const flagValue = (flag: string): string | undefined => {
	const index = process.argv.indexOf(flag);
	if (index < 0) return undefined;
	return process.argv[index + 1];
};

/**
 * The stem drives every emitted file name AND the cross-references between them
 * (the HTML's `./<stem>.runtime.js` import, the payload's `assetFileNames`), and
 * `MotionCodeExportOptions` exposes no stem knob — `stemFromBundle` derives it
 * from `fileStemForScene(scene)` = `slugify(scene.name)`. So the stem is applied
 * by renaming the restored scene before the bundle is built, never by renaming
 * files afterwards (which would break those references).
 */
const sceneRenamedForStem = (
	scene: SceneDocument,
	stem: string,
): SceneDocument => {
	const renamed = { ...scene, name: stem };
	const applied = fileStemForScene(renamed);
	if (applied !== stem) {
		fail(`stem "${stem}" is not filesystem-safe (slugified to "${applied}").`);
	}
	return renamed;
};

const runtimeSamplerTier = (runtimeContents: string): RuntimeSamplerTier => {
	const matches = Object.entries(RUNTIME_SAMPLER_SOURCE_BY_TIER).filter(
		([, source]) => runtimeContents.includes(source),
	);
	if (matches.length !== 1) {
		return fail(
			`expected exactly one embedded sampler tier, matched ${matches.length} (${matches.map(([tier]) => tier).join(", ") || "none"}).`,
		);
	}
	return matches[0][0] as RuntimeSamplerTier;
};

const slug = flagValue("--ref");
const outDir = flagValue("--out");
if (!slug) fail("--ref <slug> is required.");
if (!outDir) fail("--out <dir> is required.");
const stem = flagValue("--stem") ?? slug;

const fixture = findReferenceFixture(slug);
if (!fixture) {
	fail(
		`unknown reference slug "${slug}". Known: ${REFERENCE_SCENE_FIXTURES.map((entry) => entry.slug).join(", ")}.`,
	);
}

const sceneResult = deserializeSceneDocument(fixture.sceneEnvelope);
if (sceneResult.status === "failed") {
	fail(
		`scene failed to deserialize (${sceneResult.issues.map((issue) => issue.code).join(", ")}).`,
	);
}
const motionResult = deserializeMotionDocument(fixture.motionEnvelope);
if (motionResult.status === "failed") {
	fail(
		`motion failed to deserialize (${motionResult.issues.map((issue) => issue.code).join(", ")}).`,
	);
}

// Same split `check:reference-scenes` performs: the grammar layer rides inside
// the motion envelope, and the bundle takes it as a separate binding list.
const { grammar: serializedGrammar, ...motion } = motionResult.document;
const parsedGrammar = parseMotionGrammarLayer(serializedGrammar);
if (parsedGrammar.issues.length > 0) {
	fail(
		`motion-grammar parse issues: ${parsedGrammar.issues.map((issue) => `${issue.code} (${issue.bindingId})`).join(", ")}.`,
	);
}
if (parsedGrammar.passthrough.length > 0) {
	fail(
		`motion-grammar has ${parsedGrammar.passthrough.length} unrecognized (passthrough) binding(s) — an artifact would silently drop the technique.`,
	);
}

const naturalStem = fileStemForScene(sceneResult.document);
const scene = sceneRenamedForStem(sceneResult.document, stem);
const bundle = createExportBundle({
	scene,
	motion,
	currentFrame: EXPORT_CURRENT_FRAME,
	artboardScope: "current",
	grammarBindings: parsedGrammar.bindings,
});
const assets = createMotionCodeExportAssets(bundle, parsedGrammar.bindings, {
	optimization: exportOptimizationOptionsForProfile(EXPORT_PROFILE),
});

mkdirSync(outDir, { recursive: true });
const files = assets.map((asset) => {
	writeFileSync(path.join(outDir, asset.fileName), asset.contents, "utf8");
	return {
		name: asset.fileName,
		bytes: Buffer.byteLength(asset.contents, "utf8"),
	};
});

const runtimeAsset = assets.find((asset) => asset.kind === "runtime-js");
if (!runtimeAsset) fail("export produced no runtime-js asset.");
const { budget, asset: budgetAsset } =
	await createMotionArtifactRuntimeAssetWithBudget(
		bundle,
		parsedGrammar.bindings,
	);
// `CompressionStream` can be absent; the budget report then reports `null`
// rather than a fake estimate, so fall back to an independently measured gzip.
const gzipMeasured = budget.gzipBytes === null;
const gzipBytes =
	budget.gzipBytes ??
	gzipSync(Buffer.from(runtimeAsset.contents, "utf8")).length;

console.log(
	JSON.stringify({
		slug,
		stem,
		naturalStem,
		profile: EXPORT_PROFILE,
		outDir,
		files,
		runtime: {
			fileName: runtimeAsset.fileName,
			rawBytes: budget.rawBytes,
			gzipBytes,
			gzipIndependentlyMeasured: gzipMeasured,
			tier: runtimeSamplerTier(runtimeAsset.contents),
			budgetAssetMatchesWrittenRuntime:
				budgetAsset.contents === runtimeAsset.contents,
			withinTargetGzip: budget.budget.withinTarget,
			withinStretchGzip: budget.budget.withinStretch,
			externalFetch: budget.externalFetch,
		},
		gpuSurface: sceneNeedsGpuSurface(scene),
		videoMedia: sceneHasVideoMedia(scene),
		deterministic: createHash("sha256")
			.update(runtimeAsset.contents, "utf8")
			.digest("hex"),
	}),
);
