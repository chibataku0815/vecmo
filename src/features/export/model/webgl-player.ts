import type { MotionDocument } from "@/entities/motion/model/types";
import type { MotionGrammarBinding } from "@/entities/motion-grammar/model/types";
import type {
	InteractionDefinition,
	SceneDocument,
} from "@/entities/scene/model/types";
import type { ExportBundle, ExportBundleAsset } from "./bundle";
import {
	buildComponentPropsExport,
	buildComponentPropsManifest,
	type ComponentPropsExportResult,
	type ExportComponentPropsManifest,
} from "./component-props-export";
import {
	buildInteractionsExport,
	interactionHasNodeTrigger,
} from "./interactions-export";
import type { ExportIssue } from "./issues";
import { stableJsonStringify } from "./json";
import {
	type ExportOptimizationOptions,
	exportOptimizationOptionsForProfile,
	projectExportRuntimeData,
	stableJsonOptionsForExport,
} from "./optimization";
import { buildPaletteManifest } from "./palette-manifest";
import {
	type ProgramSurfaceStaticOutputDeliveryManifest,
	projectProgramSurfacesForWebglPlayer,
} from "./program-surface-static-output";
import {
	createRuntimeAssetManifestAsset,
	type RuntimeAssetManifestAsset,
} from "./runtime-manifest";
import {
	createRuntimeTypesAsset,
	type RuntimeTypesAsset,
	runtimeTypesFileName,
} from "./runtime-player-declarations";
import { createRuntimeReactComponentContents } from "./runtime-react-template";
import { WEBGL_PLAYER_RUNTIME_SOURCE } from "./webgl-player.generated";

const WEBGL_PLAYER_JS_MIME_TYPE = "text/javascript;charset=utf-8";
const WEBGL_PLAYER_HTML_MIME_TYPE = "text/html;charset=utf-8";
const WEBGL_PLAYER_DATA_MIME_TYPE = "application/json;charset=utf-8";
const WEBGL_PLAYER_REACT_MIME_TYPE = "text/typescript;charset=utf-8";
const WEBGL_SHARED_RUNTIME_FILE_NAME = "vector-motion-webgl-runtime.js";

/** Stable format id for generated transparent WebGL player modules. */
export const WEBGL_PLAYER_RUNTIME_FORMAT =
	"vector-motion-author/webgl-player-runtime" as const;

/** Downloadable JS module asset that embeds scene/motion data and the player runtime. */
export type WebglPlayerRuntimeAsset = {
	readonly kind: "webgl-runtime-js";
	readonly fileName: string;
	readonly mimeType: typeof WEBGL_PLAYER_JS_MIME_TYPE;
	/** Delivery degradation facts for this embedded payload, empty when none apply. */
	readonly issues: readonly ExportIssue[];
	readonly contents: string;
};

/** Shared browser WebGL runtime reused by production WebGL payloads. */
export type WebglPlayerSharedRuntimeAsset = {
	readonly kind: "webgl-shared-runtime-js";
	readonly fileName: typeof WEBGL_SHARED_RUNTIME_FILE_NAME;
	readonly mimeType: typeof WEBGL_PLAYER_JS_MIME_TYPE;
	readonly contents: string;
};

/** Scene/motion payload loaded by split-data and shared WebGL runtime modules. */
export type WebglPlayerDataAsset = {
	readonly kind: "webgl-data-json";
	readonly fileName: string;
	readonly mimeType: typeof WEBGL_PLAYER_DATA_MIME_TYPE;
	/** Delivery degradation facts for this split payload, empty when none apply. */
	readonly issues: readonly ExportIssue[];
	readonly contents: string;
};

/** Minimal HTML wrapper that imports and mounts the generated WebGL player module. */
export type WebglPlayerHtmlAsset = {
	readonly kind: "webgl-runtime-html";
	readonly fileName: string;
	readonly mimeType: typeof WEBGL_PLAYER_HTML_MIME_TYPE;
	readonly contents: string;
};

export type WebglPlayerReactAsset = {
	readonly kind: "webgl-runtime-react";
	readonly fileName: string;
	readonly mimeType: typeof WEBGL_PLAYER_REACT_MIME_TYPE;
	readonly contents: string;
};

/** JSON payload embedded beside the browser runtime inside `*.webgl-player.js`. */
export type WebglPlayerRuntimePayload = {
	readonly exportFormat: typeof WEBGL_PLAYER_RUNTIME_FORMAT;
	readonly scene: unknown;
	readonly motion: unknown;
	readonly grammarBindings?: readonly MotionGrammarBinding[];
	readonly sceneSequence?: ExportBundle["sceneSequence"];
	readonly assetFileNames?: readonly string[];
	/**
	 * Generated WebGL never executes Program Surface source in V1. This report
	 * records the declared raster fallback or deterministic placeholder used
	 * while stripping every Program Surface source package from `scene`.
	 */
	readonly programSurfaceDelivery?: ProgramSurfaceStaticOutputDeliveryManifest<"webgl-player">;
	/**
	 * Motion Component export props (T2-S3): schema + compiled runtime applier
	 * instructions for the document's `componentProps` library, resolved
	 * against the PROJECTED scene shipped in THIS payload. Same contract as
	 * `MotionCodeRuntimePayload.componentProps` in `code.ts` — always included
	 * when the document defines at least one prop, never compacted by
	 * optimization profile (the WebGL player's `player.setProps` reads it
	 * directly, so it is runtime-consumed, not a diagnostic artifact). Omitted
	 * entirely when the document defines no component props.
	 */
	readonly componentProps?: ComponentPropsExportResult;
	/**
	 * Diagnostic/tooling manifest for the same `componentProps` library (see
	 * `ExportComponentPropsManifest`'s JSDoc). Mirrors how `effectCapabilities`
	 * rides as a payload-root sibling field in `MotionCodeRuntimePayload`, only
	 * present when `optimization.includeFullManifest` is set — the WebGL
	 * player has no `manifest` field of its own to nest this inside (unlike
	 * the motion/code payload), so it is a top-level field here.
	 */
	readonly componentPropsManifest?: ExportComponentPropsManifest;
	/**
	 * Interactive Motion (T3-S3): export-validated surviving interactions,
	 * NARROWED to component-level triggers only — a node-scoped interaction
	 * (`trigger.nodeId` present) is excluded here rather than shipped inert,
	 * since the WebGL player has no per-node DOM element to ever fire it (see
	 * `interactions-export.ts`'s `interactionHasNodeTrigger` JSDoc). The
	 * export report separately surfaces one
	 * `interaction-node-trigger-webgl-unsupported` issue per excluded
	 * interaction (`export-report.ts`'s
	 * `interactionsRuntimeUnsupportedIssuesForExport`), so this field's
	 * silence about the exclusion is not a silent drop — it is reported
	 * elsewhere. Same runtime-consumed, never-compacted, omit-when-empty
	 * convention as `componentProps` above.
	 */
	readonly interactions?: readonly InteractionDefinition[];
};

export type WebglPlayerExportAsset =
	| WebglPlayerRuntimeAsset
	| WebglPlayerSharedRuntimeAsset
	| WebglPlayerDataAsset
	| WebglPlayerHtmlAsset
	| WebglPlayerReactAsset
	| RuntimeTypesAsset
	| RuntimeAssetManifestAsset;

/** Optional single-artboard payload override for scoped WebGL player exports. */
export type WebglPlayerExportOptions = {
	readonly scene?: SceneDocument;
	readonly fileStem?: string;
	readonly optimization?: ExportOptimizationOptions;
};

const assetByKind = (
	bundle: ExportBundle,
	kind: ExportBundleAsset["kind"],
): ExportBundleAsset | undefined =>
	bundle.assets.find((asset) => asset.kind === kind);

const safeStem = (value: string): string =>
	value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

const stemFromBundle = (bundle: ExportBundle): string => {
	const manifest = assetByKind(bundle, "manifest-json");
	if (!manifest) return "vector-motion-webgl";
	const raw = manifest.fileName.replace(/\.manifest\.json$/i, "");
	return safeStem(raw) || "vector-motion-webgl";
};

const webglDataFileName = (stem: string): string =>
	`${stem}.webgl-player.data.json`;

const webglRuntimeManifestFileName = (stem: string): string =>
	`${stem}.webgl-player.runtime-manifest.json`;

const webglRuntimeFileName = (
	stem: string,
	options: ExportOptimizationOptions,
): string =>
	options.runtimePackaging === "shared-runtime"
		? WEBGL_SHARED_RUNTIME_FILE_NAME
		: `${stem}.webgl-player.js`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const positiveFiniteNumber = (value: unknown, fallback: number): number =>
	typeof value === "number" && Number.isFinite(value) && value > 0
		? value
		: fallback;

const escapeHtml = (value: string): string =>
	value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");

const sceneName = (
	scene: SceneDocument | unknown | undefined,
	fallback: string,
): string => {
	if (!isRecord(scene) || typeof scene.name !== "string") return fallback;
	const name = scene.name.trim();
	return name || fallback;
};

const sceneDimensions = (
	scene: SceneDocument | unknown | undefined,
): { readonly width: number; readonly height: number } => {
	if (!isRecord(scene) || !isRecord(scene.artboard)) {
		return { width: 1280, height: 720 };
	}
	return {
		width: Math.max(
			1,
			Math.round(positiveFiniteNumber(scene.artboard.width, 1280)),
		),
		height: Math.max(
			1,
			Math.round(positiveFiniteNumber(scene.artboard.height, 720)),
		),
	};
};

const webglGeneratedFileNames = (
	stem: string,
	options: ExportOptimizationOptions,
): readonly string[] =>
	options.runtimePackaging === "embedded"
		? [
				`${stem}.webgl-player.js`,
				runtimeTypesFileName(`${stem}.webgl-player.js`),
				`${stem}.webgl-player.html`,
				...(options.includeReactWrapper
					? [`${stem}.webgl-player.react.tsx`]
					: []),
				webglRuntimeManifestFileName(stem),
			]
		: [
				webglRuntimeFileName(stem, options),
				runtimeTypesFileName(webglRuntimeFileName(stem, options)),
				webglDataFileName(stem),
				`${stem}.webgl-player.html`,
				...(options.includeReactWrapper
					? [`${stem}.webgl-player.react.tsx`]
					: []),
				webglRuntimeManifestFileName(stem),
			];

const webglRuntimeHeader = (
	options: ExportOptimizationOptions,
): readonly string[] =>
	options.includeDebugComments
		? [
				"// Generated by vector-motion-author.",
				"// This module contains the shared transparent WebGL player runtime.",
			]
		: ["// Generated by vector-motion-author."];

const webglRuntimeOnlyContents = (options: ExportOptimizationOptions): string =>
	[
		...webglRuntimeHeader(options),
		WEBGL_PLAYER_RUNTIME_SOURCE,
		"export const webglRuntime = __vectorMotionWebglPlayerRuntime;",
		"export const createVectorMotionWebglPlayer = webglRuntime.createVectorMotionWebglPlayer;",
		"export const mountVectorMotionWebglOverlayRuntime = webglRuntime.mountVectorMotionWebglOverlay;",
		"export function mount(container, payload, options = {}) {",
		"  return webglRuntime.mount(container, payload, options);",
		"}",
		"export class VectorMotionMountError extends Error {",
		'  constructor(issue) { super(issue?.message ?? "Vector motion mount failed."); this.name = "VectorMotionMountError"; this.issue = issue ?? { code: "mount-failed", message: this.message }; }',
		"}",
		"export async function loadVectorMotionWebglPayload(url) {",
		"  const response = await fetch(url);",
		'  if (!response.ok) throw new Error("Vector motion WebGL payload failed to load: " + response.status);',
		"  return response.json();",
		"}",
		"export function mountVectorMotionWebglPlayer(container, payload, options = {}) {",
		"  return createVectorMotionWebglPlayer(container, {",
		"    scene: payload.scene,",
		"    motion: payload.motion,",
		"    grammarBindings: payload.grammarBindings ?? [],",
		"    sceneSequence: payload.sceneSequence,",
		"    componentProps: payload.componentProps,",
		"    interactions: payload.interactions,",
		"  }, options);",
		"}",
		"export async function mountVectorMotionWebglPlayerFromUrl(container, url, options = {}) {",
		"  const payload = await loadVectorMotionWebglPayload(url);",
		"  return mountVectorMotionWebglPlayer(container, payload, options);",
		"}",
		"export async function mountVectorMotion(container, options = {}) {",
		"  try {",
		"  const source = options.source;",
		"  const { source: _source, ...playerOptions } = options;",
		'  if (source?.kind === "payload") return mountVectorMotionWebglPlayer(container, source.payload, playerOptions);',
		'  if (source?.kind === "url") return mountVectorMotionWebglPlayerFromUrl(container, source.url, playerOptions);',
		'  throw new VectorMotionMountError({ code: "runtime-source-missing", message: "This WebGL runtime requires a payload or URL source." });',
		"  } catch (error) {",
		"    if (error instanceof VectorMotionMountError) throw error;",
		'    throw new VectorMotionMountError({ code: "mount-failed", message: error instanceof Error ? error.message : String(error) });',
		"  }",
		"}",
		"export function mountVectorMotionWebglOverlay(container, payload, options = {}) {",
		"  return mountVectorMotionWebglOverlayRuntime(container, {",
		"    scene: payload.scene,",
		"    motion: payload.motion,",
		"    grammarBindings: payload.grammarBindings ?? [],",
		"    sceneSequence: payload.sceneSequence,",
		"    componentProps: payload.componentProps,",
		"    interactions: payload.interactions,",
		"  }, options);",
		"}",
		"export async function mountVectorMotionWebglOverlayFromUrl(container, url, options = {}) {",
		"  const payload = await loadVectorMotionWebglPayload(url);",
		"  return mountVectorMotionWebglOverlay(container, payload, options);",
		"}",
		"",
	].join("\n");

const createWebglPlayerRuntimePayload = ({
	bundle,
	grammarBindings,
	options,
	optimization,
}: {
	readonly bundle: ExportBundle;
	readonly grammarBindings: readonly MotionGrammarBinding[];
	readonly options: WebglPlayerExportOptions;
	readonly optimization: ExportOptimizationOptions;
}): WebglPlayerRuntimePayload => {
	const sceneAsset = assetByKind(bundle, "scene-json");
	const motionAsset = assetByKind(bundle, "motion-json");
	if (!sceneAsset || !motionAsset) {
		throw new Error("WebGL player export requires scene and motion JSON.");
	}
	const stem = safeStem(options.fileStem ?? "") || stemFromBundle(bundle);
	const sourceScene =
		options.scene ?? (JSON.parse(sceneAsset.contents) as SceneDocument);
	const projected = projectExportRuntimeData({
		scene: sourceScene,
		motion: JSON.parse(motionAsset.contents) as MotionDocument,
		grammarBindings,
		options: optimization,
	});
	const programSurfaceProjection = projectProgramSurfacesForWebglPlayer(
		projected.scene,
	);
	const programSafeProjection = {
		...projected,
		scene: programSurfaceProjection.scene,
	};
	// Target survival and animated-conflict checks use the PROJECTED scene and
	// motion; competing-owner checks use the unprojected source scene. This
	// matches `createMotionCodeRuntimePayload` in code.ts — see that call site's
	// comment and `buildComponentPropsExport`'s JSDoc.
	const componentPropOwnership = {
		componentProps: sourceScene.componentProps,
		layers: sourceScene.layers,
		nativeExpressionBindings: sourceScene.nativeExpressionBindings,
		grammarTargetNodeIds: new Set(
			programSafeProjection.grammarBindings.flatMap(
				(binding) => binding.targetIds,
			),
		),
	};
	const componentProps = buildComponentPropsExport(
		programSafeProjection.scene,
		programSafeProjection.motion,
		componentPropOwnership,
	);
	// Diagnostic manifest, gated on `includeFullManifest` the same as
	// `effectCapabilities` is at the motion/code payload root — see
	// `WebglPlayerRuntimePayload.componentPropsManifest`'s JSDoc.
	const componentPropsManifest = buildComponentPropsManifest(
		programSafeProjection.scene,
		programSafeProjection.motion,
		componentPropOwnership,
	);
	// Interactive Motion (T3-S3): resolved against the SAME projected
	// scene/motion `componentProps` above uses, matching
	// `createMotionCodeRuntimePayload`'s ordering in code.ts. Narrowed to
	// component-level triggers only — see
	// `WebglPlayerRuntimePayload.interactions`'s JSDoc for why a node-scoped
	// interaction is excluded here rather than shipped inert.
	const webglInteractions = buildInteractionsExport(
		programSafeProjection.scene,
		{
			clips: programSafeProjection.motion.clips,
		},
	).interactions.filter(
		(interaction) => !interactionHasNodeTrigger(interaction),
	);
	return {
		exportFormat: WEBGL_PLAYER_RUNTIME_FORMAT,
		scene: programSafeProjection.scene,
		motion: programSafeProjection.motion,
		...(programSafeProjection.grammarBindings.length > 0 ||
		optimization.includeFullManifest
			? { grammarBindings: programSafeProjection.grammarBindings }
			: {}),
		...(!options.scene && bundle.sceneSequence
			? { sceneSequence: bundle.sceneSequence }
			: {}),
		...(componentProps.schema.length > 0 ? { componentProps } : {}),
		...(componentPropsManifest.propCount > 0 && optimization.includeFullManifest
			? { componentPropsManifest }
			: {}),
		...(webglInteractions.length > 0
			? { interactions: webglInteractions }
			: {}),
		...(programSurfaceProjection.manifest
			? { programSurfaceDelivery: programSurfaceProjection.manifest }
			: {}),
		...(optimization.includeFullManifest
			? { assetFileNames: webglGeneratedFileNames(stem, optimization) }
			: {}),
	};
};

const webglPlayerHtmlContents = ({
	runtimeFileName,
	dataFileName,
	title,
	width,
	height,
	options,
}: {
	readonly runtimeFileName: string;
	readonly dataFileName?: string;
	readonly title: string;
	readonly width: number;
	readonly height: number;
	readonly options: ExportOptimizationOptions;
}): string => {
	const moduleScript =
		options.runtimePackaging === "embedded"
			? `      import { mountVectorMotionWebglPlayer } from "./${runtimeFileName}";
      const container = document.getElementById("player");
      await mountVectorMotionWebglPlayer(container, { autoplay: true });`
			: `      import { mountVectorMotionWebglPlayerFromUrl } from "./${runtimeFileName}";
      const container = document.getElementById("player");
      await mountVectorMotionWebglPlayerFromUrl(
        container,
        "./${dataFileName}",
        { autoplay: true }
      );`;
	return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} WebGL Player</title>
    <style>
      html, body { margin: 0; width: 100%; min-height: 100%; background: transparent; }
      body { min-height: 100vh; display: grid; place-items: center; overflow: hidden; }
      #player { width: 100vw; aspect-ratio: ${width} / ${height}; overflow: hidden; }
      @media (min-aspect-ratio: ${width}/${height}) {
        #player { width: auto; height: 100vh; }
      }
      #player > canvas { display: block; width: 100%; height: auto; }
    </style>
  </head>
  <body>
    <div id="player" aria-label="${escapeHtml(title)} WebGL player"></div>
    <script type="module">
${moduleScript}
    </script>
  </body>
</html>
`;
};

/**
 * Creates a self-contained JS module carrying the real browser WebGL runtime plus
 * canonical scene/motion payload. The module exports `mountVectorMotionWebglPlayer`
 * for drop-in use from plain HTML, GSAP, or a host app.
 */
export function createWebglPlayerRuntimeAsset(
	bundle: ExportBundle,
	grammarBindings: readonly MotionGrammarBinding[] = [],
	options: WebglPlayerExportOptions = {},
): WebglPlayerRuntimeAsset {
	const optimization =
		options.optimization ?? exportOptimizationOptionsForProfile("editable");
	const stem = safeStem(options.fileStem ?? "") || stemFromBundle(bundle);
	const runtimeFileName = `${stem}.webgl-player.js`;
	if (optimization.runtimePackaging !== "embedded") {
		return {
			kind: "webgl-runtime-js",
			fileName: runtimeFileName,
			mimeType: WEBGL_PLAYER_JS_MIME_TYPE,
			issues: [],
			contents: webglRuntimeOnlyContents(optimization),
		};
	}
	const payload = createWebglPlayerRuntimePayload({
		bundle,
		grammarBindings,
		options,
		optimization,
	});
	const serialized = stableJsonStringify(
		payload,
		stableJsonOptionsForExport(optimization),
	).trim();
	const paletteManifest = buildPaletteManifest(payload);
	const header = optimization.includeDebugComments
		? [
				"// Generated by vector-motion-author. The embedded JSON remains the source of truth.",
				"// This module includes the browser WebGL player runtime and mounts one transparent canvas.",
			]
		: ["// Generated by vector-motion-author."];
	return {
		kind: "webgl-runtime-js",
		fileName: runtimeFileName,
		mimeType: WEBGL_PLAYER_JS_MIME_TYPE,
		issues: payload.programSurfaceDelivery?.issues ?? [],
		contents: [
			...header,
			WEBGL_PLAYER_RUNTIME_SOURCE,
			`export const vectorMotionWebglExport = ${serialized};`,
			"export const scene = vectorMotionWebglExport.scene;",
			"export const motion = vectorMotionWebglExport.motion;",
			"export const grammarBindings = vectorMotionWebglExport.grammarBindings ?? [];",
			"export const sceneSequence = vectorMotionWebglExport.sceneSequence;",
			"export const componentProps = vectorMotionWebglExport.componentProps;",
			"export const interactions = vectorMotionWebglExport.interactions;",
			"export const programSurfaceDelivery = vectorMotionWebglExport.programSurfaceDelivery;",
			`export const paletteManifest = ${JSON.stringify(paletteManifest)};`,
			"export const webglRuntime = __vectorMotionWebglPlayerRuntime;",
			"export const createVectorMotionWebglPlayer = webglRuntime.createVectorMotionWebglPlayer;",
			"export const mountVectorMotionWebglOverlayRuntime = webglRuntime.mountVectorMotionWebglOverlay;",
			"export function mount(container, options = {}) {",
			"  return webglRuntime.mount(container, { scene, motion, grammarBindings, sceneSequence, componentProps, interactions, paletteManifest }, options);",
			"}",
			"export class VectorMotionMountError extends Error {",
			'  constructor(issue) { super(issue?.message ?? "Vector motion mount failed."); this.name = "VectorMotionMountError"; this.issue = issue ?? { code: "mount-failed", message: this.message }; }',
			"}",
			"export function mountVectorMotionWebglPlayer(container, options = {}) {",
			"  return createVectorMotionWebglPlayer(container, { scene, motion, grammarBindings, sceneSequence, componentProps, interactions }, options);",
			"}",
			"export async function mountVectorMotion(container, options = {}) {",
			"  try {",
			'  const source = options.source ?? { kind: "embedded" };',
			"  const { source: _source, ...playerOptions } = options;",
			'  if (source.kind === "embedded") return mountVectorMotionWebglPlayer(container, playerOptions);',
			'  if (source.kind === "payload") return createVectorMotionWebglPlayer(container, { scene: source.payload.scene, motion: source.payload.motion, grammarBindings: source.payload.grammarBindings ?? [], sceneSequence: source.payload.sceneSequence, componentProps: source.payload.componentProps, interactions: source.payload.interactions }, playerOptions);',
			'  if (source.kind === "url") return mountVectorMotionWebglPlayerFromUrl(container, source.url, playerOptions);',
			'  throw new VectorMotionMountError({ code: "runtime-source-invalid", message: "Vector motion WebGL runtime source is invalid." });',
			"  } catch (error) {",
			"    if (error instanceof VectorMotionMountError) throw error;",
			'    throw new VectorMotionMountError({ code: "mount-failed", message: error instanceof Error ? error.message : String(error) });',
			"  }",
			"}",
			"export function mountVectorMotionWebglOverlay(container, options = {}) {",
			"  return mountVectorMotionWebglOverlayRuntime(container, { scene, motion, grammarBindings, sceneSequence, componentProps, interactions }, options);",
			"}",
			"export async function loadVectorMotionWebglPayload(url) {",
			"  const response = await fetch(url);",
			'  if (!response.ok) throw new Error("Vector motion WebGL payload failed to load: " + response.status);',
			"  return response.json();",
			"}",
			"export async function mountVectorMotionWebglPlayerFromUrl(container, url, options = {}) {",
			"  const payload = await loadVectorMotionWebglPayload(url);",
			"  return createVectorMotionWebglPlayer(container, { scene: payload.scene, motion: payload.motion, grammarBindings: payload.grammarBindings ?? [], sceneSequence: payload.sceneSequence, componentProps: payload.componentProps, interactions: payload.interactions }, options);",
			"}",
			"export async function mountVectorMotionWebglOverlayFromUrl(container, url, options = {}) {",
			"  const payload = await loadVectorMotionWebglPayload(url);",
			"  return mountVectorMotionWebglOverlayRuntime(container, { scene: payload.scene, motion: payload.motion, grammarBindings: payload.grammarBindings ?? [], sceneSequence: payload.sceneSequence, componentProps: payload.componentProps, interactions: payload.interactions }, options);",
			"}",
			"export default vectorMotionWebglExport;",
			"",
		].join("\n"),
	};
}

/** Creates the data-only payload consumed by split-data and shared WebGL runtimes. */
export function createWebglPlayerDataAsset(
	bundle: ExportBundle,
	grammarBindings: readonly MotionGrammarBinding[] = [],
	options: WebglPlayerExportOptions = {},
): WebglPlayerDataAsset {
	const optimization =
		options.optimization ?? exportOptimizationOptionsForProfile("web-embed");
	const stem = safeStem(options.fileStem ?? "") || stemFromBundle(bundle);
	const payload = createWebglPlayerRuntimePayload({
		bundle,
		grammarBindings,
		options,
		optimization,
	});
	return {
		kind: "webgl-data-json",
		fileName: webglDataFileName(stem),
		mimeType: WEBGL_PLAYER_DATA_MIME_TYPE,
		issues: payload.programSurfaceDelivery?.issues ?? [],
		contents: stableJsonStringify(
			payload,
			stableJsonOptionsForExport(optimization),
		),
	};
}

/** Creates the framework-independent WebGL runtime shared by production payloads. */
export function createWebglPlayerSharedRuntimeAsset(
	options: WebglPlayerExportOptions = {},
): WebglPlayerSharedRuntimeAsset {
	const optimization =
		options.optimization ?? exportOptimizationOptionsForProfile("production");
	return {
		kind: "webgl-shared-runtime-js",
		fileName: WEBGL_SHARED_RUNTIME_FILE_NAME,
		mimeType: WEBGL_PLAYER_JS_MIME_TYPE,
		contents: webglRuntimeOnlyContents(optimization),
	};
}

/** Creates the minimal HTML wrapper that imports and mounts the generated WebGL player. */
export function createWebglPlayerHtmlAsset(
	bundle: ExportBundle,
	options: WebglPlayerExportOptions = {},
): WebglPlayerHtmlAsset {
	const optimization =
		options.optimization ?? exportOptimizationOptionsForProfile("editable");
	const stem = safeStem(options.fileStem ?? "") || stemFromBundle(bundle);
	const runtimeFileName = webglRuntimeFileName(stem, optimization);
	const sceneAsset = assetByKind(bundle, "scene-json");
	const scene =
		options.scene ??
		(sceneAsset ? (JSON.parse(sceneAsset.contents) as unknown) : undefined);
	const { width, height } = sceneDimensions(scene);
	const title = sceneName(scene, stem);
	return {
		kind: "webgl-runtime-html",
		fileName: `${stem}.webgl-player.html`,
		mimeType: WEBGL_PLAYER_HTML_MIME_TYPE,
		contents: webglPlayerHtmlContents({
			runtimeFileName,
			...(optimization.runtimePackaging === "embedded"
				? {}
				: { dataFileName: webglDataFileName(stem) }),
			title,
			width,
			height,
			options: optimization,
		}),
	};
}

export function createWebglPlayerRuntimeTypesAsset(
	bundle: ExportBundle,
	options: WebglPlayerExportOptions = {},
): RuntimeTypesAsset {
	const optimization =
		options.optimization ?? exportOptimizationOptionsForProfile("editable");
	const stem = safeStem(options.fileStem ?? "") || stemFromBundle(bundle);
	return createRuntimeTypesAsset({
		runtimeFileName: webglRuntimeFileName(stem, optimization),
		renderer: "webgl",
		shared: optimization.runtimePackaging === "shared-runtime",
		embedded: optimization.runtimePackaging === "embedded",
	});
}

export function createWebglPlayerReactAsset(
	bundle: ExportBundle,
	options: WebglPlayerExportOptions = {},
): WebglPlayerReactAsset {
	const optimization =
		options.optimization ?? exportOptimizationOptionsForProfile("editable");
	const stem = safeStem(options.fileStem ?? "") || stemFromBundle(bundle);
	const runtimeFileName = webglRuntimeFileName(stem, optimization);
	const source =
		optimization.runtimePackaging === "embedded"
			? '{ kind: "embedded" as const }'
			: `{ kind: "url" as const, url: new URL("./${webglDataFileName(stem)}", import.meta.url) }`;
	return {
		kind: "webgl-runtime-react",
		fileName: `${stem}.webgl-player.react.tsx`,
		mimeType: WEBGL_PLAYER_REACT_MIME_TYPE,
		contents: createRuntimeReactComponentContents({
			runtimeFileName,
			sourceExpression: source,
			ariaLabel: `${stem} motion`,
			propsModel: { kind: "record" },
		}),
	};
}

/** Creates the file map consumed by hosts that package WebGL runtime exports. */
export function createWebglPlayerRuntimeManifestAsset(
	bundle: ExportBundle,
	options: WebglPlayerExportOptions = {},
): RuntimeAssetManifestAsset {
	const optimization =
		options.optimization ?? exportOptimizationOptionsForProfile("editable");
	const stem = safeStem(options.fileStem ?? "") || stemFromBundle(bundle);
	return createRuntimeAssetManifestAsset({
		fileName: webglRuntimeManifestFileName(stem),
		runtimeFormat: WEBGL_PLAYER_RUNTIME_FORMAT,
		renderer: "webgl-player",
		options: optimization,
		files: {
			runtimeFileName: webglRuntimeFileName(stem, optimization),
			typesFileName: runtimeTypesFileName(
				webglRuntimeFileName(stem, optimization),
			),
			...(optimization.runtimePackaging === "embedded"
				? {}
				: { dataFileName: webglDataFileName(stem) }),
			htmlFileName: `${stem}.webgl-player.html`,
			...(optimization.includeReactWrapper
				? { reactFileName: `${stem}.webgl-player.react.tsx` }
				: {}),
		},
		entrypoints: {
			mountExport: "mountVectorMotion",
			overlayMountExport:
				optimization.runtimePackaging === "embedded"
					? "mountVectorMotionWebglOverlay"
					: "mountVectorMotionWebglOverlayFromUrl",
			...(optimization.runtimePackaging === "embedded"
				? {}
				: { dataLoaderExport: "loadVectorMotionWebglPayload" }),
		},
		sceneSequence: !options.scene && Boolean(bundle.sceneSequence),
		capabilities: {
			transparentBackgroundDefault: true,
			hostCompositing: true,
			programSurfaces: {
				execution: "none",
				delivery: "declared-raster-fallback-or-placeholder",
			},
			overlay: {
				alphaMode: "straight-transparent",
				fitModes: ["cover", "contain", "fill", "intrinsic"],
				pointerEventsDefault: "none",
			},
		},
	});
}

/** Returns the two code assets needed to embed the transparent WebGL player. */
export function createWebglPlayerExportAssets(
	bundle: ExportBundle,
	grammarBindings: readonly MotionGrammarBinding[] = [],
	options: WebglPlayerExportOptions = {},
): readonly WebglPlayerExportAsset[] {
	const optimization =
		options.optimization ?? exportOptimizationOptionsForProfile("editable");
	const runtimeAssets =
		optimization.runtimePackaging === "embedded"
			? [createWebglPlayerRuntimeAsset(bundle, grammarBindings, options)]
			: [
					...(optimization.runtimePackaging === "shared-runtime"
						? [createWebglPlayerSharedRuntimeAsset(options)]
						: [
								createWebglPlayerRuntimeAsset(bundle, grammarBindings, options),
							]),
					createWebglPlayerDataAsset(bundle, grammarBindings, options),
				];
	return [
		...runtimeAssets,
		createWebglPlayerRuntimeTypesAsset(bundle, options),
		createWebglPlayerHtmlAsset(bundle, options),
		...(optimization.includeReactWrapper
			? [createWebglPlayerReactAsset(bundle, options)]
			: []),
		createWebglPlayerRuntimeManifestAsset(bundle, options),
	];
}
