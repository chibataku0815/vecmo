import type { MotionDocument } from "@/entities/motion/model/types";
import { parseMotionGrammarLayer } from "@/entities/motion-grammar/model/parse";
import type { MotionGrammarBinding } from "@/entities/motion-grammar/model/types";
import { readAppearanceMaskRelations } from "@/entities/scene/model/appearance";
import { containsBlendNode } from "@/entities/scene/model/blend";
import { allNodes } from "@/entities/scene/model/selectors";
import type {
	InteractionDefinition,
	Paint,
	SceneDocument,
} from "@/entities/scene/model/types";
import type {
	ExportBundle,
	ExportBundleAsset,
	ExportSceneSequenceManifest,
	SceneJsonExportAsset,
} from "./bundle";
import {
	buildComponentPropsExport,
	buildComponentPropsManifest,
	type ComponentPropsExportResult,
} from "./component-props-export";
import type { ExportEffectCapabilitiesManifest } from "./effect-fidelity";
import {
	buildInteractionsExport,
	buildInteractionsManifest,
	type InteractionsExportResult,
} from "./interactions-export";
import type { ExportIssue } from "./issues";
import { stableJsonStringify } from "./json";
import {
	createMotionArtifactBudgetReport,
	type MotionArtifactBudgetReport,
} from "./motion-artifact-budget";
import {
	type ExportOptimizationOptions,
	type ExportOptimizationProfile,
	exportOptimizationOptionsForProfile,
	projectExportRuntimeData,
	projectGrammarBindingsForExport,
	projectMotionForExport,
	projectRuntimeManifest,
	projectSceneForExport,
	stableJsonOptionsForExport,
} from "./optimization";
import { buildPaletteManifest } from "./palette-manifest";
import {
	type MotionCodeProgramSurfaceDeliveryManifest,
	projectProgramSurfacesForMotionCode,
} from "./program-surface-motion-code";
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
import { MOTION_RUNTIME_SAMPLER_SOURCE } from "./runtime-sampler.generated";
import { MOTION_RUNTIME_SAMPLER_CORE_SOURCE } from "./runtime-sampler-core.generated";
import { MOTION_RUNTIME_SAMPLER_FLAT_SOURCE } from "./runtime-sampler-flat.generated";
import { MOTION_RUNTIME_SAMPLER_LEAN_SOURCE } from "./runtime-sampler-lean.generated";

const RUNTIME_JS_MIME_TYPE = "text/javascript;charset=utf-8";
const RUNTIME_DATA_MIME_TYPE = "application/json;charset=utf-8";
const SHARED_RUNTIME_FILE_NAME = "vector-motion-runtime.js";

export const MOTION_CODE_RUNTIME_FORMAT =
	"vector-motion-author/motion-code-runtime" as const;

export type MotionCodeRuntimeAsset = {
	readonly kind: "runtime-js";
	readonly fileName: string;
	readonly mimeType: typeof RUNTIME_JS_MIME_TYPE;
	readonly contents: string;
	/** Delivery degradation facts for an embedded payload, empty when none apply. */
	readonly issues: readonly ExportIssue[];
};

/** Shared runtime JS reused by production data payloads from the same page. */
export type MotionCodeSharedRuntimeAsset = {
	readonly kind: "runtime-shared-js";
	readonly fileName: typeof SHARED_RUNTIME_FILE_NAME;
	readonly mimeType: typeof RUNTIME_JS_MIME_TYPE;
	readonly contents: string;
};

/** Scene/motion payload loaded by split-data and shared-runtime exports. */
export type MotionCodeDataAsset = {
	readonly kind: "runtime-data-json";
	readonly fileName: string;
	readonly mimeType: typeof RUNTIME_DATA_MIME_TYPE;
	readonly contents: string;
	/** Delivery degradation facts for a split runtime payload, empty when none apply. */
	readonly issues: readonly ExportIssue[];
};

const RUNTIME_HTML_MIME_TYPE = "text/html;charset=utf-8";
const RUNTIME_REACT_MIME_TYPE = "text/typescript;charset=utf-8";

export type MotionCodeHtmlAsset = {
	readonly kind: "runtime-html";
	readonly fileName: string;
	readonly mimeType: typeof RUNTIME_HTML_MIME_TYPE;
	readonly contents: string;
};

export type MotionCodeReactAsset = {
	readonly kind: "runtime-react";
	readonly fileName: string;
	readonly mimeType: typeof RUNTIME_REACT_MIME_TYPE;
	readonly contents: string;
};

export type MotionCodeExportAsset =
	| ExportBundleAsset
	| MotionCodeRuntimeAsset
	| MotionCodeSharedRuntimeAsset
	| MotionCodeDataAsset
	| MotionCodeHtmlAsset
	| MotionCodeReactAsset
	| RuntimeTypesAsset
	| RuntimeAssetManifestAsset;

export type MotionCodeRuntimePayload = {
	readonly exportFormat: typeof MOTION_CODE_RUNTIME_FORMAT;
	readonly manifest: unknown;
	readonly effectCapabilities?: ExportEffectCapabilitiesManifest;
	readonly scene: unknown;
	readonly motion: unknown;
	readonly grammarBindings?: readonly MotionGrammarBinding[];
	readonly recipes?: readonly unknown[];
	readonly animationSequences?: readonly unknown[];
	readonly sceneSequence?: ExportSceneSequenceManifest;
	readonly assetFileNames?: readonly string[];
	/**
	 * Motion/Code never executes Program Surface source. This report records the
	 * declared raster-fallback or deterministic-placeholder decision that was
	 * applied while stripping executable source bytes from `scene`.
	 */
	readonly programSurfaceDelivery?: MotionCodeProgramSurfaceDeliveryManifest;
	/**
	 * Motion Component export props (T2-S2): schema + compiled runtime applier
	 * instructions for the document's `componentProps` library, resolved
	 * against the PROJECTED scene shipped in THIS payload. Always included when
	 * the document defines at least one prop, regardless of optimization
	 * profile — unlike `manifest`, this block is runtime-consumed (
	 * `resolvePayloadState`/`player.setProps` read it directly), not a
	 * diagnostic/debug artifact, so it is never subject to
	 * `includeFullManifest`-style compaction. Omitted entirely when the
	 * document defines no component props, matching the `grammarBindings`/
	 * `recipes` omit-when-empty convention below.
	 */
	readonly componentProps?: ComponentPropsExportResult;
	/**
	 * Interactive Motion (T3-S2): export-validated surviving interactions (see
	 * `interactions-export.ts`'s `buildInteractionsExport`), resolved against
	 * the PROJECTED scene/motion/component-props shipped in THIS payload.
	 * `RUNTIME_PLAYER_SOURCE`'s `createVectorMotionPlayer` reads this directly
	 * to instantiate the interaction engine — same runtime-consumed,
	 * never-compacted convention as `componentProps` above. Omitted entirely
	 * when the document defines no interactions OR every authored interaction
	 * was dropped by the export gate, matching the omit-when-empty convention
	 * used throughout this payload.
	 */
	readonly interactions?: readonly InteractionDefinition[];
};

export type MotionCodeExportOptions = {
	readonly optimization?: ExportOptimizationOptions;
};

const assetByKind = (
	bundle: ExportBundle,
	kind: ExportBundleAsset["kind"],
): ExportBundleAsset | undefined =>
	bundle.assets.find((asset) => asset.kind === kind);

const MOTION_CODE_SUPPORT_ASSET_KINDS = new Set<ExportBundleAsset["kind"]>([
	"scene-json",
	"motion-json",
	"recipe-json",
	"svg",
	"animation-sequence-json",
	"animation-sequence-svg",
]);

const isSceneJsonExportAsset = (
	asset: ExportBundleAsset,
): asset is SceneJsonExportAsset =>
	asset.kind === "scene-json" && "issues" in asset;

/**
 * The editable/debug support scene is a downloadable runtime input, so it must
 * receive the same source-stripping projection as embedded and split payloads.
 * Returning a cloned asset keeps the source bundle immutable for SVG/PDF and
 * future generated-runtime routes.
 */
const motionCodeSafeSupportAsset = (
	asset: ExportBundleAsset,
	options: ExportOptimizationOptions,
): ExportBundleAsset => {
	if (!isSceneJsonExportAsset(asset)) return asset;
	const sourceScene = JSON.parse(asset.contents) as SceneDocument;
	const projectedScene = projectSceneForExport(sourceScene, options);
	const programSurfaces = projectProgramSurfacesForMotionCode(projectedScene);
	return {
		...asset,
		contents: stableJsonStringify(
			programSurfaces.scene,
			stableJsonOptionsForExport(options),
		),
		issues: [...asset.issues, ...programSurfaces.issues],
	};
};

const motionCodeSupportAssets = (
	bundle: ExportBundle,
	options: ExportOptimizationOptions,
): readonly ExportBundleAsset[] =>
	options.profile === "editable" || options.profile === "debug"
		? bundle.assets
				.filter((asset) => MOTION_CODE_SUPPORT_ASSET_KINDS.has(asset.kind))
				.map((asset) => motionCodeSafeSupportAsset(asset, options))
		: [];

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const filteredManifestArray = (
	value: unknown,
	fileNames: ReadonlySet<string>,
): readonly unknown[] =>
	Array.isArray(value)
		? value.filter(
				(entry) =>
					isRecord(entry) &&
					typeof entry.fileName === "string" &&
					fileNames.has(entry.fileName),
			)
		: [];

const shouldDropManifestRecord = (
	value: Record<string, unknown>,
	fileNames: ReadonlySet<string>,
): boolean => {
	if (typeof value.fileName === "string") return !fileNames.has(value.fileName);
	return (
		value.kind === "asset" &&
		typeof value.id === "string" &&
		value.id.includes(".") &&
		!fileNames.has(value.id)
	);
};

const sanitizeManifestReferences = (
	value: unknown,
	fileNames: ReadonlySet<string>,
): unknown => {
	if (Array.isArray(value)) {
		return value
			.map((entry) => sanitizeManifestReferences(entry, fileNames))
			.filter((entry) => entry !== undefined);
	}
	if (!isRecord(value)) return value;
	if (shouldDropManifestRecord(value, fileNames)) return undefined;
	const result: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (key === "pdf" && typeof entry === "string" && !fileNames.has(entry)) {
			continue;
		}
		if (key === "exportRenderers" && Array.isArray(entry)) {
			result[key] = entry.filter((renderer) => renderer !== "pdf");
			continue;
		}
		const next = sanitizeManifestReferences(entry, fileNames);
		if (next !== undefined) result[key] = next;
	}
	return result;
};

const sanitizeManifestFileNames = (
	value: unknown,
	fileNames: ReadonlySet<string>,
): unknown => {
	if (!isRecord(value)) return value;
	const result: Record<string, unknown> = { ...value };
	if (Array.isArray(result.assets)) {
		const assets = filteredManifestArray(result.assets, fileNames);
		result.assets = assets;
		result.assetCount = assets.length;
	}
	if (Array.isArray(result.issues)) {
		const issues = filteredManifestArray(result.issues, fileNames);
		result.issues = issues;
		result.issueCount = issues.length;
	}
	return result;
};

const motionCodeManifest = (
	bundle: ExportBundle,
	assets: readonly ExportBundleAsset[],
	options: ExportOptimizationOptions,
): unknown => {
	const manifestAsset = assetByKind(bundle, "manifest-json");
	if (!manifestAsset) {
		throw new Error("Motion/code export requires a bundle manifest.");
	}
	const fileNames = new Set(assets.map((asset) => asset.fileName));
	const rawManifest = JSON.parse(manifestAsset.contents) as unknown;
	const manifest = sanitizeManifestReferences(
		sanitizeManifestFileNames(rawManifest, fileNames),
		fileNames,
	);
	if (!isRecord(manifest)) return manifest;
	const rawIssueFields =
		!options.includeFullManifest && isRecord(rawManifest)
			? {
					issueCount: rawManifest.issueCount,
					issueSummary: rawManifest.issueSummary,
					issues: rawManifest.issues,
				}
			: {};
	const previewExport = sanitizeManifestFileNames(
		manifest.previewExport,
		fileNames,
	);
	return projectRuntimeManifest(
		{
			...manifest,
			...rawIssueFields,
			previewExport,
		},
		options,
	);
};

const jsonAssetsByKind = (
	bundle: ExportBundle,
	kind: ExportBundleAsset["kind"],
	options: ExportOptimizationOptions,
): readonly unknown[] => {
	if (!options.includeFullManifest && kind === "recipe-json") return [];
	if (!options.includeFrameSequenceData && kind === "animation-sequence-json") {
		return [];
	}
	return bundle.assets
		.filter((asset) => asset.kind === kind)
		.map((asset) => JSON.parse(asset.contents) as unknown);
};

const stemFromBundle = (bundle: ExportBundle): string => {
	const manifest = assetByKind(bundle, "manifest-json");
	if (!manifest) return "motion-code-export";
	return manifest.fileName.replace(/\.manifest\.json$/u, "");
};

const motionCodeDataFileName = (stem: string): string => `${stem}.data.json`;

const motionCodeRuntimeManifestFileName = (stem: string): string =>
	`${stem}.runtime-manifest.json`;

const motionCodeRuntimeFileName = (
	stem: string,
	options: ExportOptimizationOptions,
): string =>
	options.runtimePackaging === "shared-runtime"
		? SHARED_RUNTIME_FILE_NAME
		: `${stem}.runtime.js`;

const motionCodeGeneratedFileNames = (
	stem: string,
	options: ExportOptimizationOptions,
): readonly string[] => {
	const htmlFileName = `${stem}.html`;
	const reactFileName = `${stem}.react.tsx`;
	if (options.runtimePackaging === "embedded") {
		return [
			`${stem}.runtime.js`,
			runtimeTypesFileName(`${stem}.runtime.js`),
			htmlFileName,
			...(options.includeReactWrapper ? [reactFileName] : []),
			motionCodeRuntimeManifestFileName(stem),
		];
	}
	return [
		motionCodeRuntimeFileName(stem, options),
		runtimeTypesFileName(motionCodeRuntimeFileName(stem, options)),
		motionCodeDataFileName(stem),
		htmlFileName,
		...(options.includeReactWrapper ? [reactFileName] : []),
		motionCodeRuntimeManifestFileName(stem),
	];
};

/**
 * Core player, part A: `createVectorMotionPlayer`/`mountVectorMotion`/the
 * embeddable `mount()` surface up through `buildFramePresentationMarkup`,
 * with NO `fetch(`/`new URL(`/URL-loading function — safe to ship alone for
 * the motion-artifact profile, which always embeds its payload and never
 * needs to load one from a URL. `mountVectorMotion`'s `source.kind === "url"`
 * branch still lazily references `loadVectorMotionPayload` (defined only in
 * {@link RUNTIME_PLAYER_URL_LOADER_ADDON_SOURCE} below); that is a dead
 * reference for motion-artifact callers specifically, since the motion-
 * artifact profile only ever constructs an `"embedded"`/`"payload"` source,
 * never a `"url"` one — see {@link createMotionCodeRuntimeAsset}.
 *
 * Split into `RUNTIME_PLAYER_HEAD_MAIN_{A,B,C}_SOURCE` plus the standalone
 * one-shot render wrappers and the legacy sequence alias (each its own
 * constant below) so {@link motionArtifactPlayerSource} can omit the latter
 * two for the motion-artifact profile — `RUNTIME_PLAYER_CORE_HEAD_SOURCE`
 * re-concatenates all of them in original order, so every non-motion-artifact
 * profile's assembled player is byte-identical to before this split.
 */
const RUNTIME_PLAYER_HEAD_MAIN_A_SOURCE = String.raw`
const RUNTIME_SAMPLER = __vectorMotionRuntimeSampler;

const embeddedPayload = () =>
	typeof vectorMotionExport === "undefined" ? undefined : vectorMotionExport;

const looksLikePayload = (value) =>
	value &&
	typeof value === "object" &&
	"scene" in value &&
	"motion" in value;

const resolvePayloadState = (payload) => {
	const resolved = payload ?? embeddedPayload();
	if (!looksLikePayload(resolved)) {
		throw new Error("Vector motion runtime requires scene and motion payload data.");
	}
	return {
		payload: resolved,
		scene: resolved.scene,
		motion: resolved.motion,
		grammarBindings: resolved.grammarBindings ?? [],
	};
};

const numberOr = (value, fallback) =>
	Number.isFinite(Number(value)) ? Number(value) : fallback;
`;

/**
 * Component-props (`player.setProps`/`.props`/`.propSchema`) API. Called
 * unconditionally by `createVectorMotionPlayer` (`initializeComponentProps`
 * at construction, `installComponentPropsApi` right after `api` is built) —
 * unlike the interaction-wiring block below, there is no existing `if`
 * gate around these call sites, so {@link RUNTIME_PLAYER_COMPONENT_PROPS_
 * STUB_SOURCE} must define both names with a safe, always-callable no-op
 * body rather than omitting them outright. Included in the motion-artifact
 * slim player only when the export's payload actually has a non-empty
 * `componentProps.schema` (see `sceneAssembliesForMotionArtifact` in this
 * file); every other profile always embeds this block via
 * `RUNTIME_PLAYER_CORE_HEAD_SOURCE`.
 */
const RUNTIME_PLAYER_COMPONENT_PROPS_API_SOURCE = String.raw`
// --- Motion Component export props (player.setProps) ---
//
// The applier table (payload.componentProps, built by
// component-props-export.ts at export time) already resolved every binding
// down to a node id + field path; this runtime section only executes those
// instructions against the CURRENT payload's scene, cloning just the objects
// on the path being written (clone-on-first-write) so repeated setProps calls
// stay cheap and never mutate a frozen/shared payload object in place.

const componentPropSchema = (state) => state.payload.componentProps?.schema ?? [];

const componentPropAppliers = (state) =>
	state.payload.componentProps?.appliers ?? [];

// Built once per setProps call (never cached across calls): the scene object
// backing it may be replaced by an earlier clone-on-first-write in the SAME
// call, so a stale cache keyed by the old scene reference would silently
// write into a discarded object.
const buildNodeIndex = (scene) => {
	const index = new Map();
	const visit = (node) => {
		if (!node) return;
		index.set(node.id, node);
		for (const child of node.children ?? []) visit(child);
	};
	for (const layer of scene.layers ?? []) {
		for (const node of layer.nodes ?? []) visit(node);
	}
	return index;
};

// Clones every object along the given path (but not off-path siblings),
// replacing the leaf with value; returns the new root. Mirrors the plain
// nested-spread semantics withValueAtPath uses in the editor
// (recipe-controls.ts) but stays local to the runtime since that module is
// not importable here.
const withValueAtFieldPath = (root, path, value) => {
	if (path.length === 0) return value;
	const [head, ...rest] = path;
	const source = root && typeof root === "object" ? root : {};
	return { ...source, [head]: withValueAtFieldPath(source[head], rest, value) };
};

const applySceneFieldInstruction = (scene, nodeIndex, instruction, value) => {
	const node = nodeIndex.get(instruction.nodeId);
	if (!node || typeof value !== "number") return scene;
	const nextNode = withValueAtFieldPath(node, instruction.fieldPath, value);
	nodeIndex.set(instruction.nodeId, nextNode);
	return replaceNodeInScene(scene, instruction.nodeId, nextNode);
};

const applyStyleColorLegacyInstruction = (scene, nodeIndex, instruction, value) => {
	const node = nodeIndex.get(instruction.nodeId);
	if (!node || typeof value !== "string") return scene;
	const nextNode = withValueAtFieldPath(node, ["style", instruction.field], value);
	nodeIndex.set(instruction.nodeId, nextNode);
	return replaceNodeInScene(scene, instruction.nodeId, nextNode);
};

const applyStyleColorPaintInstruction = (scene, nodeIndex, instruction, value) => {
	const node = nodeIndex.get(instruction.nodeId);
	if (!node || typeof value !== "string") return scene;
	const list = node.style?.[instruction.role];
	if (!Array.isArray(list) || !list[instruction.index]) return scene;
	const nextList = list.map((paint, index) =>
		index === instruction.index ? { ...paint, color: value } : paint,
	);
	const nextNode = withValueAtFieldPath(node, ["style", instruction.role], nextList);
	nodeIndex.set(instruction.nodeId, nextNode);
	return replaceNodeInScene(scene, instruction.nodeId, nextNode);
};

const applyTextContentInstruction = (scene, nodeIndex, instruction, value) => {
	const node = nodeIndex.get(instruction.nodeId);
	if (!node || typeof value !== "string") return scene;
	const nextNode = withValueAtFieldPath(node, ["geometry", "text"], value);
	nodeIndex.set(instruction.nodeId, nextNode);
	return replaceNodeInScene(scene, instruction.nodeId, nextNode);
};

// Rebuilds the layer/children arrays down to nodeId, cloning only the path
// from the scene root to that node (siblings keep their original references),
// so unrelated subtrees never re-render needlessly and later instructions in
// the same setProps call keep working against whichever objects are still
// live in scene.
const replaceNodeInScene = (scene, nodeId, nextNode) => {
	const replaceInList = (nodes) => {
		let changed = false;
		const next = (nodes ?? []).map((node) => {
			if (node.id === nodeId) {
				changed = true;
				return nextNode;
			}
			if (node.children && node.children.length > 0) {
				const nextChildren = replaceInList(node.children);
				if (nextChildren !== node.children) {
					changed = true;
					return { ...node, children: nextChildren };
				}
			}
			return node;
		});
		return changed ? next : nodes;
	};
	const nextLayers = (scene.layers ?? []).map((layer) => {
		const nextNodes = replaceInList(layer.nodes);
		return nextNodes === layer.nodes ? layer : { ...layer, nodes: nextNodes };
	});
	return { ...scene, layers: nextLayers };
};

const applyComponentPropInstruction = (scene, nodeIndex, instruction, value) => {
	if (instruction.kind === "scene-field") {
		return applySceneFieldInstruction(scene, nodeIndex, instruction, value);
	}
	if (instruction.kind === "style-color-legacy") {
		return applyStyleColorLegacyInstruction(scene, nodeIndex, instruction, value);
	}
	if (instruction.kind === "style-color-paint") {
		return applyStyleColorPaintInstruction(scene, nodeIndex, instruction, value);
	}
	if (instruction.kind === "text-content") {
		return applyTextContentInstruction(scene, nodeIndex, instruction, value);
	}
	return scene;
};

// Conservative coercion matching the schema's declared type: numbers go
// through Number()+finite-check+min/max clamp (never NaN/Infinity into the
// scene), color/text pass through as strings. Returns undefined (never sets)
// when the raw value cannot be coerced, so a bad host-supplied value cannot
// corrupt the scene with a non-primitive or NaN.
const coerceComponentPropValue = (schemaEntry, rawValue) => {
	if (schemaEntry.type === "number") {
		const numeric = Number(rawValue);
		if (!Number.isFinite(numeric)) return undefined;
		const min = typeof schemaEntry.min === "number" ? schemaEntry.min : -Infinity;
		const max = typeof schemaEntry.max === "number" ? schemaEntry.max : Infinity;
		return Math.min(max, Math.max(min, numeric));
	}
	if (rawValue === undefined || rawValue === null) return undefined;
	return String(rawValue);
};

// Applies partial against state's CURRENT effective payload: validates prop
// names against the schema (unknown -> console.warn + ignore), coerces each
// value, applies every surviving instruction for that prop (clone-on-first-
// write via replaceNodeInScene), and stores the coerced value in
// state.propValues regardless of whether any instruction could apply (so
// player.props always reflects what the host set, even for a supported:false
// schema entry) -- but a known, supported:false prop ALSO console.warns
// (distinct message from the unknown-prop case), since setting it is
// otherwise a silent no-op, e.g. a binding the export compiler dropped for
// targeting a node+property that already has a keyframe track. Mutates
// state.payload in place (assigns a new .scene when at least one instruction
// changed it) so the next renderFrame call already builds its presentation
// from the mutated scene.
const applyComponentProps = (state, partial) => {
	const schema = componentPropSchema(state);
	const schemaByName = new Map(schema.map((entry) => [entry.name, entry]));
	const appliersByName = new Map(
		componentPropAppliers(state).map((entry) => [entry.name, entry.instructions]),
	);
	let scene = state.payload.scene;
	let nodeIndex = null;
	let changed = false;
	for (const [name, rawValue] of Object.entries(partial ?? {})) {
		const schemaEntry = schemaByName.get(name);
		if (!schemaEntry) {
			console.warn('Vector motion runtime: unknown component prop "' + name + '".');
			continue;
		}
		const coerced = coerceComponentPropValue(schemaEntry, rawValue);
		if (coerced === undefined) {
			console.warn('Vector motion runtime: invalid value for component prop "' + name + '".');
			continue;
		}
		state.propValues[name] = coerced;
		if (schemaEntry.supported === false) {
			console.warn(
				'Vector motion runtime: component prop "' +
					name +
					'" has no runtime-applicable binding (dropped at export time, e.g. an unsupported source or a conflicting keyframe track); the value is stored but will not change the render output.',
			);
			continue;
		}
		const instructions = appliersByName.get(name) ?? [];
		if (instructions.length === 0) continue;
		if (!nodeIndex) nodeIndex = buildNodeIndex(scene);
		for (const instruction of instructions) {
			const next = applyComponentPropInstruction(scene, nodeIndex, instruction, coerced);
			if (next !== scene) {
				scene = next;
				// Replacing a descendant clones every ancestor on its path. Refresh the
				// complete index so a later instruction targeting one of those ancestors
				// cannot restore its stale pre-write child subtree.
				nodeIndex = buildNodeIndex(scene);
				changed = true;
			}
		}
	}
	if (changed) state.payload = { ...state.payload, scene };
};

// Seeds state.propValues from the schema's declared defaults, then layers
// initialProps (constructor options.props) on top, applying each through the
// same coerce/apply path as a later setProps call so an initial value takes
// effect in the very first renderFrame.
const initializeComponentProps = (state, initialProps) => {
	state.propValues = {};
	const schema = componentPropSchema(state);
	if (schema.length === 0) return;
	for (const entry of schema) state.propValues[entry.name] = entry.defaultValue.value;
	if (initialProps) applyComponentProps(state, initialProps);
};

// Installs setProps/props/propSchema directly onto the player's api object
// via defineProperties (NOT Object.assign: assigning a getter/setter pair with
// Object.assign evaluates it once and copies the RESULT as a static data
// property, silently freezing props/propSchema to their construction-time
// snapshot forever -- defineProperties preserves the accessor itself, so every
// later read re-evaluates against live state).
// renderCurrentFrame is the owning player's own renderFrame bound to its
// current frame (passed in rather than closed over api directly, since api is
// still being constructed at the call site in both player factories) --
// setProps re-renders so a host sees its change immediately without a
// separate manual renderFrame() call, matching the spec contract.
const installComponentPropsApi = (api, state, renderCurrentFrame) => {
	Object.defineProperties(api, {
		setProps: {
			value(partial) {
				applyComponentProps(state, partial);
				renderCurrentFrame();
			},
			enumerable: true,
		},
		props: {
			get() {
				return Object.freeze({ ...state.propValues });
			},
			enumerable: true,
		},
		propSchema: {
			get() {
				return componentPropSchema(state);
			},
			enumerable: true,
		},
	});
};
`;

/**
 * Inert stand-in for {@link RUNTIME_PLAYER_COMPONENT_PROPS_API_SOURCE},
 * substituted for the motion-artifact slim player when the export's payload
 * has no component props. `initializeComponentProps` still safely sets
 * `state.propValues = {}` (byte-for-byte the same effective behavior as the
 * real function's own `schema.length === 0` early-return branch — the only
 * branch reachable when nothing ever populates `payload.componentProps`);
 * `installComponentPropsApi` installs nothing, so `setProps`/`props`/
 * `propSchema` are genuinely ABSENT from the player (matches the paired
 * `.d.ts`'s `includeComponentPropsApi: false` — see `runtime-player-
 * declarations.ts`) rather than present-but-silently-inert. A host calling
 * `player.setProps(...)` on such an export gets a plain "not a function"
 * TypeError — fail-loud, not a masked no-op.
 */
const RUNTIME_PLAYER_COMPONENT_PROPS_STUB_SOURCE = String.raw`
const initializeComponentProps = (state) => {
	state.propValues = {};
};
const installComponentPropsApi = () => {};
`;

const RUNTIME_PLAYER_HEAD_MAIN_A2_SOURCE = String.raw`
const escapeText = (value) =>
	String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");

const escapeAttribute = (value) =>
	escapeText(value).replaceAll('"', "&quot;");

const attribute = (name, value) =>
	value === undefined || value === null || value === false
		? ""
		: " " + name + '="' + escapeAttribute(value) + '"';

// Reads the already-composed transform of a sampled node (keyframe pose + grammar
// channels were applied by RUNTIME_SAMPLER); the numberOr guards only defend
// against malformed embedded JSON, they never re-sample.
const nodeTransform = (transform) => {
	const source = transform ?? {};
	const position = source.position ?? { x: 0, y: 0 };
	const scale = source.scale ?? { x: 1, y: 1 };
	const anchor = source.anchor ?? { x: 0, y: 0 };
	return {
		position: { x: numberOr(position.x, 0), y: numberOr(position.y, 0) },
		rotation: numberOr(source.rotation, 0),
		scale: { x: numberOr(scale.x, 1), y: numberOr(scale.y, 1) },
		anchor: { x: numberOr(anchor.x, 0), y: numberOr(anchor.y, 0) },
	};
};

const transformAttribute = (transform) => {
	const parts = [];
	if (transform.position.x !== 0 || transform.position.y !== 0) {
		parts.push("translate(" + transform.position.x + " " + transform.position.y + ")");
	}
	if (transform.rotation !== 0) {
		parts.push(
			"rotate(" +
				transform.rotation +
				" " +
				transform.anchor.x +
				" " +
				transform.anchor.y +
				")",
		);
	}
	if (transform.scale.x !== 1 || transform.scale.y !== 1) {
		parts.push(
			"translate(" +
				transform.anchor.x +
				" " +
				transform.anchor.y +
				") scale(" +
				transform.scale.x +
				" " +
				transform.scale.y +
				") translate(" +
				-transform.anchor.x +
				" " +
				-transform.anchor.y +
				")",
		);
	}
	return parts.join(" ");
};

const paintValue = (value, fallback) =>
	typeof value === "string" && value.length > 0 ? value : fallback;

// Stroke sub-option defaults, mirroring style-resolve.ts. The sampled node style
// is a raw NodeStyle where these fields are optional, so defaults are applied
// inline here rather than pre-resolved (the sampler only ever spreads opacity/
// fills onto the raw style — see presentation.ts's sampledStyle/sampleNode).
const DEFAULT_STROKE_CAP = "butt";
const DEFAULT_STROKE_JOIN = "miter";
const DEFAULT_STROKE_MITER_LIMIT = 4;

// Filters a stroke-dash array with the same semantics as style-resolve's
// normalizeStrokeDash: coerce each entry, keep only finite positive values, then
// join with single spaces. Returns undefined when nothing survives so the
// attribute is skipped (matching strokePresentation, which omits an empty dash).
const strokeDasharrayValue = (strokeDash) => {
	const entries = Array.isArray(strokeDash) ? strokeDash : [];
	const filtered = [];
	for (const entry of entries) {
		const value = numberOr(entry, 0);
		if (value > 0) filtered.push(value);
	}
	return filtered.length > 0 ? filtered.join(" ") : undefined;
};

// Mirrors strokePresentation (style-presentation.ts) for the standalone runtime,
// used at every element that paints a stroke: the base single-element leaf
// (styleAttributes), each paint-stack stroke-layer element (renderPaintStackLayers),
// and the stroke-blur leaf's stroke shape. hasStroke is supplied by the caller
// because its exact gate differs by site (byte-matching svg.ts's own per-site
// hasStroke: paintAttributes gates on strokeWidth>0 too, renderStackedShape's is
// "this stroke layer exists", buildSceneStrokeBlurArtifacts already implies both).
// Dash (and its offset) is emitted whenever a dash is present (a dash on a
// zero-width stroke is simply invisible) while cap/join/miter are meaningless
// without a painted stroke and so gate on hasStroke and diverge from their
// defaults, matching strokePresentation exactly. A single instance of
// dash/dashoffset/cap/join/miter is computed once per node and reused across every
// stroke-layer element on the paint-stack path — mirroring renderStackedShape,
// which likewise derives one strokeParts and applies it to every stroke layer
// rather than resolving per layer (the schema has no per-stroke geometry: layers
// share one weight/dash/cap/join).
const strokeSubOptionAttributes = (source, hasStroke) => {
	const cap =
		hasStroke && source.strokeCap !== undefined && source.strokeCap !== DEFAULT_STROKE_CAP
			? source.strokeCap
			: undefined;
	const join =
		hasStroke &&
		source.strokeJoin !== undefined &&
		source.strokeJoin !== DEFAULT_STROKE_JOIN
			? source.strokeJoin
			: undefined;
	// Effective join is the default "miter" when unset; miterlimit only bites there.
	const joinIsMiter =
		source.strokeJoin === undefined || source.strokeJoin === DEFAULT_STROKE_JOIN;
	const miterLimit =
		hasStroke &&
		joinIsMiter &&
		source.strokeMiterLimit !== undefined &&
		source.strokeMiterLimit !== DEFAULT_STROKE_MITER_LIMIT
			? source.strokeMiterLimit
			: undefined;
	// A dash offset is meaningless without a dash pattern; strokePresentation nests
	// its dashoffset gate inside the dasharray one, so derive the dash once and reuse
	// its presence. Emit the offset only when a dash survives AND the offset is a
	// finite nonzero value (a zero offset is the identity; negatives are meaningful —
	// they march a travelling-stroke window backwards). numberOr coerces
	// undefined/non-finite to 0 so those skip too, matching strokePresentation.
	const dashArray = strokeDasharrayValue(source.strokeDash);
	const dashOffset = numberOr(source.strokeDashoffset, 0);
	return (
		attribute("stroke-dasharray", dashArray) +
		attribute(
			"stroke-dashoffset",
			dashArray !== undefined && dashOffset !== 0 ? dashOffset : undefined,
		) +
		attribute("stroke-linecap", cap) +
		attribute("stroke-linejoin", join) +
		attribute("stroke-miterlimit", miterLimit)
	);
};

// True for any node with children — group, Blend, and frame containers alike —
// mirrors hasSubtreeCarrier in entities/scene/model/appearance-targets.ts. A
// group/Blend own shape is a fixed invisible placeholder (a zero-length line)
// with real content living in children, not its own paint; a frame own shape is
// real background paint, but it renders as a sibling of its children, not their
// ancestor, so it is included here too — otherwise a frame own opacity/effect
// filter would never reach its children. The runtime has no blend-mode or
// background-blur support, but node effect filters (layer-blur, drop/inner
// shadow, node-look/recipe textures) and gradient/image paint stacks are
// rendered via RUNTIME_SAMPLER.buildSceneEffectFilterArtifacts/
// buildScenePaintSvgArtifacts (see renderFrame) — see renderNode for how the
// subtree carrier below also carries the node's own effect filter.
const hasSubtreeCarrierNode = (node) =>
	Boolean(node.children && node.children.length > 0);

// Reads the already-composed style of a sampled node (sampled opacity + grammar
// opacity were applied by RUNTIME_SAMPLER). paintOpacity overrides the style's
// own opacity; a subtree-carrier node's own shape passes 1 here because
// renderNode already wraps it plus its children in an opacity-carrying group
// element — see that function's comment for why (a DOM-cleanliness override for
// a group/Blend's always-invisible placeholder shape, but load-bearing for a
// frame's real background paint, which would otherwise double-apply opacity).
//
// meshFillRef/meshStrokeRef are url(#pattern-id) references built by
// RUNTIME_SAMPLER.buildSceneMeshPaintSvgArtifacts (see renderFrame) for a node
// whose resolved fill/stroke is a mesh-gradient paint; when present they take
// priority over the legacy fill/stroke color string, which for a mesh-painted
// node is always "none" (the paint stack has no legacy scalar representation).
// Without this a mesh-gradient fill renders as fill="none" — invisible.
const styleAttributes = (style, paintOpacity, meshFillRef, meshStrokeRef) => {
	const source = style ?? {};
	const strokeValue = meshStrokeRef || paintValue(source.stroke, "none");
	const strokeWidth = numberOr(source.strokeWidth, 0);
	// Mirrors svg.ts's paintAttributes hasStroke gate exactly (resolved stroke
	// value, mesh ref included, non-"none" AND a nonzero width — a zero-width
	// stroke paints nothing regardless of paint).
	const hasStroke = strokeValue !== "none" && strokeWidth > 0;
	return (
		attribute("fill", meshFillRef || paintValue(source.fill, "none")) +
		attribute("stroke", strokeValue) +
		attribute("stroke-width", strokeWidth) +
		attribute(
			"opacity",
			paintOpacity !== undefined ? paintOpacity : numberOr(source.opacity, 1),
		) +
		strokeSubOptionAttributes(source, hasStroke)
	);
};

const pathForShape = (shape) => {
	const vertices = shape?.vertices ?? [];
	if (vertices.length === 0) return "";
	const inTangents = shape.inTangents ?? [];
	const outTangents = shape.outTangents ?? [];
	const parts = ["M " + vertices[0][0] + " " + vertices[0][1]];
	for (let index = 1; index < vertices.length; index += 1) {
		const previous = vertices[index - 1];
		const current = vertices[index];
		const out = outTangents[index - 1] ?? [0, 0];
		const input = inTangents[index] ?? [0, 0];
		parts.push(
			"C " +
				(previous[0] + out[0]) +
				" " +
				(previous[1] + out[1]) +
				" " +
				(current[0] + input[0]) +
				" " +
				(current[1] + input[1]) +
				" " +
				current[0] +
				" " +
				current[1],
		);
	}
	if (shape.closed && vertices.length > 1) {
		const previous = vertices[vertices.length - 1];
		const current = vertices[0];
		const out = outTangents[vertices.length - 1] ?? [0, 0];
		const input = inTangents[0] ?? [0, 0];
		parts.push(
			"C " +
				(previous[0] + out[0]) +
				" " +
				(previous[1] + out[1]) +
				" " +
				(current[0] + input[0]) +
				" " +
				(current[1] + input[1]) +
				" " +
				current[0] +
				" " +
				current[1] +
				" Z",
		);
	}
	return parts.join(" ");
};

const pathForGeometry = (geometry) =>
	[geometry?.shape, ...(geometry?.subpaths ?? [])]
		.map(pathForShape)
		.filter((path) => path.length > 0)
		.join(" ");

const pathForPoints = (points) => {
	const vertices = points ?? [];
	if (vertices.length === 0) return "";
	const first = vertices[0];
	const parts = ["M " + numberOr(first.x, 0) + " " + numberOr(first.y, 0)];
	for (let index = 1; index < vertices.length; index += 1) {
		const point = vertices[index];
		parts.push("L " + numberOr(point.x, 0) + " " + numberOr(point.y, 0));
	}
	parts.push("Z");
	return parts.join(" ");
};

const pathForStar = (geometry) => {
	const center = geometry?.center ?? { x: 0, y: 0 };
	const points = Math.max(0, Math.floor(numberOr(geometry?.points, 0)));
	const total = points * 2;
	if (total < 4) return "";
	const vertices = [];
	for (let index = 0; index < total; index += 1) {
		const radius =
			index % 2 === 0
				? numberOr(geometry.outerRadius, 0)
				: numberOr(geometry.innerRadius, 0);
		const angle = -Math.PI / 2 + (index / total) * Math.PI * 2;
		vertices.push({
			x: numberOr(center.x, 0) + Math.cos(angle) * radius,
			y: numberOr(center.y, 0) + Math.sin(angle) * radius,
		});
	}
	return pathForPoints(vertices);
};

const imageHrefForGeometry = (scene, geometry) => {
	const assetId = geometry?.assetId;
	if (!assetId) return undefined;
	const asset = (scene.assets ?? []).find(
		(candidate) => candidate?.kind === "image" && candidate.id === assetId,
	);
	if (asset?.source?.kind === "data-url") return asset.source.dataUrl;
	if (asset?.source?.kind === "reference") return asset.source.href;
	return undefined;
};

const programSurfaceDeliveryForGeometry = (state, geometry) => {
	const assetId = geometry?.assetId;
	const deliveries = state?.payload?.programSurfaceDelivery?.deliveries;
	if (!assetId || !Array.isArray(deliveries)) return undefined;
	return deliveries.find(
		(delivery) =>
			delivery &&
			typeof delivery === "object" &&
			delivery.assetId === assetId,
	);
};

const renderText = (geometry, attrs) => {
	const bounds = geometry.bounds ?? { x: 0, y: 0, width: 0, height: 0 };
	const textStyle = geometry.style ?? {};
	const fontSize = numberOr(textStyle.fontSize, Math.max(12, bounds.height / 2));
	const lineHeight = numberOr(textStyle.lineHeight, fontSize * 1.2);
	const lines = String(geometry.text ?? "").split("\n");
	const tspans = lines
		.map(
			(line, index) =>
				"<tspan" +
				attribute("x", bounds.x) +
				attribute("dy", index === 0 ? 0 : lineHeight) +
				">" +
				escapeText(line) +
				"</tspan>",
		)
		.join("");
	return (
		"<text" +
		attrs +
		attribute("x", bounds.x) +
		attribute("y", bounds.y + fontSize) +
		attribute("font-family", textStyle.fontFamily ?? "Inter, system-ui, sans-serif") +
		attribute("font-size", fontSize) +
		attribute("font-weight", numberOr(textStyle.fontWeight, 700)) +
		">" +
		tspans +
		"</text>"
	);
};

const renderGeometry = (state, geometry, attrs) => {
	if (!geometry) return "";
	if (geometry.kind === "rect") {
		const bounds = geometry.bounds ?? {};
		return (
			"<rect" +
			attrs +
			attribute("x", bounds.x) +
			attribute("y", bounds.y) +
			attribute("width", bounds.width) +
			attribute("height", bounds.height) +
			attribute("rx", geometry.cornerRadius || undefined) +
			"/>"
		);
	}
	if (geometry.kind === "ellipse") {
		const bounds = geometry.bounds ?? {};
		return (
			"<ellipse" +
			attrs +
			attribute("cx", numberOr(bounds.x, 0) + numberOr(bounds.width, 0) / 2) +
			attribute("cy", numberOr(bounds.y, 0) + numberOr(bounds.height, 0) / 2) +
			attribute("rx", numberOr(bounds.width, 0) / 2) +
			attribute("ry", numberOr(bounds.height, 0) / 2) +
			"/>"
		);
	}
	if (geometry.kind === "path") {
		return (
			"<path" +
			attrs +
			attribute("d", pathForGeometry(geometry)) +
			attribute(
				"fill-rule",
				geometry.fillRule === "evenodd" ? "evenodd" : undefined,
			) +
			"/>"
		);
	}
	if (geometry.kind === "polygon") {
		return "<path" + attrs + attribute("d", pathForPoints(geometry.points)) + "/>";
	}
	if (geometry.kind === "star") {
		return "<path" + attrs + attribute("d", pathForStar(geometry)) + "/>";
	}
	if (geometry.kind === "line") {
		return (
			"<line" +
			attrs +
			attribute("x1", geometry.start?.x) +
			attribute("y1", geometry.start?.y) +
			attribute("x2", geometry.end?.x) +
			attribute("y2", geometry.end?.y) +
			"/>"
		);
	}
	if (geometry.kind === "image") {
		const bounds = geometry.bounds ?? {};
		const programSurfaceDelivery = programSurfaceDeliveryForGeometry(
			state,
			geometry,
		);
		const href = imageHrefForGeometry(state.scene, geometry);
		if (!href) {
			return (
				"<rect" +
				attrs +
				attribute("x", bounds.x) +
				attribute("y", bounds.y) +
				attribute("width", bounds.width) +
				attribute("height", bounds.height) +
				attribute("data-missing-image-asset-id", geometry.assetId) +
				attribute("data-program-surface-delivery", programSurfaceDelivery?.route) +
				attribute(
					"data-program-surface-fidelity-issue",
					programSurfaceDelivery?.issue?.code,
				) +
				"/>"
			);
		}
		return (
			"<image" +
			attrs +
			attribute("href", href) +
			attribute("x", bounds.x) +
			attribute("y", bounds.y) +
			attribute("width", bounds.width) +
			attribute("height", bounds.height) +
			attribute("preserveAspectRatio", "none") +
			attribute("data-program-surface-delivery", programSurfaceDelivery?.route) +
			attribute(
				"data-program-surface-fallback-asset-id",
				programSurfaceDelivery?.fallbackAssetId,
			) +
			attribute(
				"data-program-surface-fallback-frame",
				programSurfaceDelivery?.fallbackFrame,
			) +
			attribute(
				"data-program-surface-fidelity-issue",
				programSurfaceDelivery?.issue?.code,
			) +
			"/>"
		);
	}
	if (geometry.kind === "text") return renderText(geometry, attrs);
	return "";
};

const primaryArtboard = (state) => {
	const { payload, scene } = state;
	const artboardId =
		payload.manifest?.artboards?.primaryArtboardId ??
		scene.currentArtboardId ??
		scene.artboard?.id;
	return artboardById(scene, artboardId) ?? scene.artboard;
};

const artboardById = (scene, artboardId) => {
	return (
		(scene.artboards ?? []).find((artboard) => artboard.id === artboardId) ??
		(scene.artboard?.id === artboardId ? scene.artboard : undefined)
	);
};

const sceneSequenceForState = (state) =>
	state.payload.sceneSequence ?? state.payload.manifest?.sceneSequence;

const resolveSequenceFrame = (state, frame = 0) => {
	const sequence = sceneSequenceForState(state);
	const items = sequence?.items ?? [];
	if (!sequence || items.length === 0) return null;
	const address = RUNTIME_SAMPLER.resolveSequenceFrameAddress(sequence, frame);
	if (!address) return null;
	const item = items.find((candidate) => candidate.id === address.itemId);
	if (!item) return null;
	const artboard = artboardById(state.scene, address.artboardId);
	if (!artboard) return null;
	return {
		sequence,
		item,
		artboard,
		...address,
	};
};

// Untransformed clip/mask wrapper(s) so the artboard-space def is not skewed by
// the node's own transform; mirrors the in-app SVG export's reduce order exactly.
const wrapMaskApplications = (markup, applications) =>
	(applications ?? []).reduce(
		(inner, attr) => "<g " + attr + ">" + inner + "</g>",
		markup,
	);

// Renders a paint-stack role (fill or stroke) as one geometry element per
// layer, mirroring renderStackedShape in svg.ts's per-layer element structure
// and opacity placement: each fill layer paints "stroke=none", each stroke
// layer paints "fill=none" plus the node's uniform stroke-width, and every
// layer carries its own fill-opacity/stroke-opacity (omitted when 1) instead
// of a single shared opacity attribute. strokeSubOptions is a single
// precomputed dash/cap/join/miter attribute string reused across every stroke
// layer — mirroring renderStackedShape, which likewise derives one
// strokeParts and applies it identically to each stroke element rather than
// resolving per layer (the schema has no per-stroke geometry: every layer in
// a role shares the node's one weight/dash/cap/join). Always "" for the fill
// role. "layers" is RUNTIME_SAMPLER.buildScenePaintSvgArtifacts's per-node
// fill/stroke layer list (see renderFrame) - already in bottom-to-top render
// order.
const renderPaintStackLayers = (
	state,
	node,
	dataAttrs,
	role,
	layers,
	strokeWidth,
	strokeSubOptions,
) =>
	layers
		.map((layer) => {
			const attrs =
				role === "fill"
					? dataAttrs +
						attribute("fill", layer.value) +
						attribute("fill-opacity", layer.opacity === 1 ? undefined : layer.opacity) +
						attribute("stroke", "none")
					: dataAttrs +
						attribute("fill", "none") +
						attribute("stroke", layer.value) +
						attribute("stroke-opacity", layer.opacity === 1 ? undefined : layer.opacity) +
						attribute("stroke-width", strokeWidth) +
						strokeSubOptions;
			return renderGeometry(state, node.geometry, attrs);
		})
		.join("");

const renderNode = (
	state,
	node,
	artboardId,
	maskApplications,
	strokeBlurFilters,
	consumedNodeIds,
	meshFillRefs,
	meshStrokeRefs,
	fillLayersByNodeId,
	strokeLayersByNodeId,
	effectFilters,
) => {
	if (!node || node.visible === false) return "";
	if (node.artboardId && artboardId && node.artboardId !== artboardId) return "";
	// A node consumed as a representable mask source is not painted as ordinary
	// geometry; only its silhouette lives inside the mask def (use-as-mask).
	if (consumedNodeIds && consumedNodeIds.has(node.id)) return "";
	const hasCarrier = hasSubtreeCarrierNode(node);
	const transformValue = transformAttribute(nodeTransform(node.transform));
	const dataAttrs =
		attribute("data-node-id", node.id) + attribute("data-node-name", node.name);
	const strokeBlurFilterId = strokeBlurFilters
		? strokeBlurFilters[node.id]
		: undefined;
	const meshFillRef = meshFillRefs ? meshFillRefs[node.id] : undefined;
	const meshStrokeRef = meshStrokeRefs ? meshStrokeRefs[node.id] : undefined;
	// Node effect filter (layer-blur, drop/inner shadow, node-look/recipe
	// textures), built by RUNTIME_SAMPLER.buildSceneEffectFilterArtifacts (see
	// renderFrame) from the SAME buildEffectFilter chain the in-app SVG export
	// uses. Raw filter id (no url(#...) wrapper yet) so both the leaf and
	// carrier branches below can build their own reference.
	const nodeFilterId = effectFilters ? effectFilters[node.id] : undefined;
	const nodeFilterAttr = nodeFilterId ? "url(#" + nodeFilterId + ")" : undefined;
	const stackFills = fillLayersByNodeId ? fillLayersByNodeId[node.id] : undefined;
	const stackStrokes = strokeLayersByNodeId
		? strokeLayersByNodeId[node.id]
		: undefined;
	let body;
	// Opacity the OUTER (transformed, data-node-id) <g> itself carries. Stays
	// undefined (omitted) in every path except the legacy stroke-blur-without-
	// node-filter path, which byte-identically reproduces this runtime's
	// pre-existing output (opacity on the outer <g>, not an inner wrapper).
	let outerGroupOpacity;
	if (stackFills || stackStrokes) {
		// Multi-paint stack (or a single non-plain paint, e.g. a gradient with
		// paint-opacity < 1): one element per layer instead of a single element
		// carrying both fill and stroke, mirroring renderStackedShape in svg.ts.
		// A missing role falls back to ONE synthesized layer from the legacy
		// scalar/mesh-ref, skipped when it resolves to "none" — a node whose fill
		// is stack-owned but stroke is a plain legacy color still paints its
		// stroke, and vice versa.
		const source = node.style ?? {};
		const strokeWidth = numberOr(source.strokeWidth, 0);
		const fillLayers =
			stackFills ??
			(() => {
				const value = meshFillRef || paintValue(source.fill, "none");
				return value === "none" ? [] : [{ value, opacity: 1 }];
			})();
		const strokeLayers =
			stackStrokes ??
			(() => {
				const value = meshStrokeRef || paintValue(source.stroke, "none");
				return value === "none" ? [] : [{ value, opacity: 1 }];
			})();
		// Mirrors renderStackedShape's hasStroke gate exactly: "this stroke layer
		// list is non-empty" (buildScenePaintSvgArtifacts/the synthesized fallback
		// above already both fold strokeWidth>0 into whether strokeLayers has any
		// entries, so this needs no separate width check here).
		const hasStroke = strokeLayers.length > 0;
		const strokeSubOptions = strokeSubOptionAttributes(source, hasStroke);
		const fillMarkup = renderPaintStackLayers(
			state,
			node,
			dataAttrs,
			"fill",
			fillLayers,
			strokeWidth,
			"",
		);
		const strokeMarkup = renderPaintStackLayers(
			state,
			node,
			dataAttrs,
			"stroke",
			strokeLayers,
			strokeWidth,
			strokeSubOptions,
		);
		body =
			fillMarkup +
			(strokeBlurFilterId && strokeMarkup
				? "<g" + attribute("filter", "url(#" + strokeBlurFilterId + ")") + ">" + strokeMarkup + "</g>"
				: strokeMarkup);
		// The stack wrapper owns node opacity and the node effect filter for the
		// COMBINED result (matching renderStackedShape); a subtree-carrier node's
		// own stack-owned shape instead renders at opacity 1 with no filter here,
		// because the carrier <g> below already owns both for the whole subtree.
		const paintOpacity = hasCarrier ? 1 : numberOr(source.opacity, 1);
		body =
			"<g" +
			attribute("opacity", paintOpacity) +
			attribute("filter", hasCarrier ? undefined : nodeFilterAttr) +
			">" +
			body +
			"</g>";
	} else if (strokeBlurFilterId) {
		// Stroke-only blur: keep the fill sharp and Gaussian-blur just the stroke in
		// its own group; node opacity (and the node effect filter, if any) rides the
		// outer <g> so it applies to the combined result, mirroring the in-app SVG
		// export. A subtree-carrier node cannot reach this path (stroke blur is
		// leaf-only), so groupOpacity here is always the node's own final opacity,
		// matching the non-blur hasCarrier branch below.
		const source = node.style ?? {};
		const fillAttrs =
			dataAttrs +
			attribute("fill", meshFillRef || paintValue(source.fill, "none"));
			// hasStroke is unconditionally true on this path: reaching strokeBlurFilterId
			// already means buildSceneStrokeBlurArtifacts found strokeWidth>0 and a
			// visible stroke (mesh or legacy) on this node — see that helper's doc.
		const strokeAttrs =
			dataAttrs +
			attribute("fill", "none") +
			attribute("stroke", meshStrokeRef || paintValue(source.stroke, "none")) +
			attribute("stroke-width", numberOr(source.strokeWidth, 0)) +
			strokeSubOptionAttributes(source, true);
		const blurredBody =
			renderGeometry(state, node.geometry, fillAttrs) +
			"<g" +
			attribute("filter", "url(#" + strokeBlurFilterId + ")") +
			">" +
			renderGeometry(state, node.geometry, strokeAttrs) +
			"</g>";
		const nodeOpacity = numberOr(source.opacity, 1);
		if (nodeFilterAttr) {
			body =
				"<g" +
				attribute("opacity", nodeOpacity) +
				attribute("filter", nodeFilterAttr) +
				">" +
				blurredBody +
				"</g>";
		} else {
			body = blurredBody;
			outerGroupOpacity = nodeOpacity;
		}
	} else {
		const attrs =
			dataAttrs +
			styleAttributes(
				node.style,
				hasCarrier ? 1 : undefined,
				meshFillRef,
				meshStrokeRef,
			) +
			(hasCarrier ? "" : attribute("filter", nodeFilterAttr));
		body = renderGeometry(state, node.geometry, attrs);
	}
	const children = (node.children ?? [])
		.map((child) =>
			renderNode(
				state,
				child,
				artboardId,
				maskApplications,
				strokeBlurFilters,
				consumedNodeIds,
				meshFillRefs,
				meshStrokeRefs,
				fillLayersByNodeId,
				strokeLayersByNodeId,
				effectFilters,
			),
		)
		.join("");
	// A subtree-carrier node's (group, Blend, or frame) own opacity AND effect
	// filter would be visually dead if left only on its own shape (body above):
	// for group/Blend that shape is an invisible placeholder and children render
	// as SIBLINGS of it, not descendants; for a frame that shape is real
	// background paint but is likewise just a sibling of its children, not their
	// ancestor. Always emitting the carrier (even at opacity 1, no filter) keeps
	// this element's presence independent of the sampled value, matching the
	// live canvas/SVG-export carrier contract. Stroke-blur and stack-path leaf
	// nodes are leaves (no carrier), so their own wrapper already carries the
	// node's own opacity/filter correctly.
	const content = hasCarrier
		? "<g" +
			attribute("opacity", numberOr((node.style || {}).opacity, 1)) +
			attribute("filter", nodeFilterAttr) +
			">" +
			body +
			children +
			"</g>"
		: body + children;
	const group =
		"<g" +
		attribute("data-node-id", node.id) +
		attribute("transform", transformValue || undefined) +
		attribute("opacity", outerGroupOpacity) +
		">" +
		content +
		"</g>";
	return wrapMaskApplications(
		group,
		maskApplications ? maskApplications[node.id] : undefined,
	);
};

// One fully-composed presentation per frame from the shared sampler: keyframe
// pose, every motion-grammar channel, and afterimage duplicate nodes are already
// applied, so the serializer just walks geometry and applies the shared mask plan.
const presentationForFrame = (
	state,
	frame,
	artboardId,
	cameraRuntimeControl,
) =>
	RUNTIME_SAMPLER.buildExportRenderPresentation({
		scene: state.scene,
		motion: state.motion,
		frame,
		artboardId,
		grammarBindings: state.grammarBindings,
		cameraRuntimeControl,
	});

const sceneFrameScopeForPresentation = (presentation) => ({
	kind: "scene",
	artboardId:
		presentation.camera.kind === "single"
			? presentation.camera.view.artboardId
			: presentation.camera.kind === "crossfade"
				? presentation.camera.from.artboardId
				: presentation.camera.artboardId,
	localFrame: presentation.frame,
});

// Builds one frame's SVG markup plus (in "token" mode) the mesh-pattern
// href-token map, shared by the public renderFrame export (always "inline",
// byte-identical to this file's pre-token-mode output) and
// createVectorMotionPlayer's steady-state DOM path (always "token" — see
// patchContainerSvg's own comment, further below, for why). Splitting the
// markup-building BODY out from renderFrame itself (rather than making
// renderFrame accept an hrefMode parameter) keeps every existing public
// export's signature and return type (a plain string) untouched.
function buildFramePresentationMarkup(frame, payload, hrefMode, cameraRuntimeControl) {
	const state = resolvePayloadState(payload);
	const artboard = primaryArtboard(state);
	const width = numberOr(artboard?.width, 1);
	const height = numberOr(artboard?.height, 1);
	const presentation = presentationForFrame(
		state,
		frame,
		artboard?.id,
		cameraRuntimeControl,
	);
	const composedScene = presentation.scene;
	// Mask defs + per-node clip/mask applications come from the SAME pure helper
	// the in-app SVG export uses (renderMotion/frame are the presentation's), so
	// masks never drift between the editor canvas, in-app export, and playback.
	const maskArtifacts = RUNTIME_SAMPLER.buildSceneMaskSvgArtifacts(
		composedScene,
		presentation.renderMotion,
		presentation.frame,
		{
			effectiveShape: RUNTIME_SAMPLER.effectiveShape,
			effectiveTransform: RUNTIME_SAMPLER.effectiveTransform,
		},
	);
	const strokeBlurArtifacts =
		RUNTIME_SAMPLER.buildSceneStrokeBlurArtifacts(composedScene);
	// Mesh-gradient pattern defs + per-node fill/stroke pattern refs, same pure
	// helper the in-app SVG export uses — see buildSceneMeshPaintSvgArtifacts's own
	// doc for why a mesh paint needs this (no native SVG paint server). hrefMode
	// is forwarded verbatim: "inline" (the public renderFrame path) embeds the
	// real data URL exactly as before this indirection existed; "token" (the
	// player's steady-state DOM path) gets a short placeholder instead, so this
	// markup string never carries a multi-megabyte data URL for
	// patchContainerSvg's diff walk to look at.
	const meshPaintArtifacts = RUNTIME_SAMPLER.buildSceneMeshPaintSvgArtifacts(
		composedScene,
		{ hrefMode },
	);
	// Gradient/image paint-stack defs + per-node fill/stroke layer lists, same
	// pure helper the in-app SVG export uses — generalizes meshPaintArtifacts to
	// every other paint kind and to multi-paint stacks. Not token-indirected:
	// only the mesh-gradient raster path produces the multi-megabyte data URLs
	// that motivate hrefMode in the first place.
	const paintArtifacts = RUNTIME_SAMPLER.buildScenePaintSvgArtifacts(composedScene);
	// Node effect filter (layer-blur, drop/inner shadow, node-look/recipe
	// textures) defs + per-node filter id, from the SAME buildEffectFilter chain
	// the in-app SVG export uses. frameTimeSeconds mirrors svg.ts's
	// state.fps > 0 ? state.frame / state.fps : 0 so an animated filter
	// primitive (e.g. an explicit keyframed feTurbulence seed) samples the same
	// value both renderers would use for this frame.
	const fps = numberOr(presentation.sourceMotion?.fps, 0);
	const effectFilterArtifacts = RUNTIME_SAMPLER.buildSceneEffectFilterArtifacts(
		composedScene,
		fps > 0 ? presentation.frame / fps : 0,
	);
	const defsBody = [
		maskArtifacts.defs,
		strokeBlurArtifacts.defs,
		meshPaintArtifacts.defs,
		paintArtifacts.defs,
		effectFilterArtifacts.defs,
	]
		.filter(Boolean)
		.join("\n");
	const defs = defsBody ? "<defs>" + defsBody + "</defs>" : "";
	const consumedNodeIds = new Set(maskArtifacts.consumedNodeIds);
	const background =
		artboard?.background && artboard.background !== "transparent"
			? "<rect width=\"100%\" height=\"100%\"" +
				attribute("fill", artboard.background) +
				"/>"
			: "";
	const layers = (composedScene.layers ?? [])
		.filter((layer) => layer.visible !== false)
		.flatMap((layer) => layer.nodes ?? [])
		.map((node) =>
			renderNode(
				state,
				node,
				artboard?.id,
				maskArtifacts.applicationsByNodeId,
				strokeBlurArtifacts.filterIdByNodeId,
				consumedNodeIds,
				meshPaintArtifacts.fillPatternRefByNodeId,
				meshPaintArtifacts.strokePatternRefByNodeId,
				paintArtifacts.fillLayersByNodeId,
				paintArtifacts.strokeLayersByNodeId,
				effectFilterArtifacts.filterIdByNodeId,
			),
		)
		.join("");
	const markup =
		"<svg xmlns=\"http://www.w3.org/2000/svg\"" +
		attribute("viewBox", "0 0 " + width + " " + height) +
		attribute("width", width) +
		attribute("height", height) +
		attribute("data-vector-motion-runtime", state.payload.exportFormat) +
		">" +
		defs +
		background +
		layers +
		"</svg>";
	return { markup, hrefByToken: meshPaintArtifacts.hrefByToken, presentation };
}
`;

/**
 * Standalone one-shot render-to-string wrappers. Never called by
 * `createVectorMotionPlayer`/`mount()` (both call
 * `buildFramePresentationMarkup`/`buildSequenceFramePresentationMarkup`
 * directly — see their call sites further below), so the motion-artifact
 * profile's embed-only player never needs them: excluded from
 * {@link motionArtifactPlayerSource}, kept for every other profile via
 * `RUNTIME_PLAYER_CORE_HEAD_SOURCE`.
 */
const RUNTIME_PLAYER_RENDER_FRAME_WRAPPER_SOURCE = String.raw`
export function renderFrame(frame = 0, payload) {
	return buildFramePresentationMarkup(frame, payload, "inline").markup;
}

export const renderVectorMotionFrame = (payload, frame = 0) =>
	renderFrame(frame, payload);
`;

const RUNTIME_PLAYER_HEAD_MAIN_B_SOURCE = String.raw`
// Same split as buildFramePresentationMarkup above, for the sequence player.
function buildSequenceFramePresentationMarkup(
	frame,
	payload,
	hrefMode,
	cameraRuntimeControl,
) {
	const state = resolvePayloadState(payload);
	const address = resolveSequenceFrame(state, frame);
	if (!address) {
		const result = buildFramePresentationMarkup(
			frame,
			payload,
			hrefMode,
			cameraRuntimeControl,
		);
		return {
			...result,
			scope: sceneFrameScopeForPresentation(result.presentation),
		};
	}
	const {
		artboard,
		item,
		globalFrame,
		localFrame,
		sequenceId,
		itemStartFrame,
		itemEndFrameExclusive,
	} = address;
	const width = numberOr(artboard?.width, 1);
	const height = numberOr(artboard?.height, 1);
	const effectiveCameraRuntimeControl =
		RUNTIME_SAMPLER.runtimeCameraControlForArtboard(
			state.scene,
			artboard.id,
			cameraRuntimeControl,
		);
	const presentation = presentationForFrame(
		state,
		localFrame,
		artboard.id,
		effectiveCameraRuntimeControl,
	);
	const composedScene = presentation.scene;
	// Same shared mask/stroke-blur artifact pipeline as renderFrame, so sequence
	// playback never drops soft masks or stroke blur that the non-sequence export
	// renders.
	const maskArtifacts = RUNTIME_SAMPLER.buildSceneMaskSvgArtifacts(
		composedScene,
		presentation.renderMotion,
		presentation.frame,
		{
			effectiveShape: RUNTIME_SAMPLER.effectiveShape,
			effectiveTransform: RUNTIME_SAMPLER.effectiveTransform,
		},
	);
	const strokeBlurArtifacts =
		RUNTIME_SAMPLER.buildSceneStrokeBlurArtifacts(composedScene);
	// Same mesh-gradient pipeline as renderFrame, so sequence playback never
	// drops a mesh fill/stroke that the non-sequence export renders. See
	// buildFramePresentationMarkup's comment for what hrefMode controls.
	const meshPaintArtifacts = RUNTIME_SAMPLER.buildSceneMeshPaintSvgArtifacts(
		composedScene,
		{ hrefMode },
	);
	// Same gradient/image paint-stack and effect-filter pipelines as renderFrame,
	// so sequence playback never drops a gradient/image paint stack or a node
	// effect/recipe filter that the non-sequence export renders. Not
	// token-indirected, same reasoning as buildFramePresentationMarkup.
	const paintArtifacts = RUNTIME_SAMPLER.buildScenePaintSvgArtifacts(composedScene);
	const fps = numberOr(presentation.sourceMotion?.fps, 0);
	const effectFilterArtifacts = RUNTIME_SAMPLER.buildSceneEffectFilterArtifacts(
		composedScene,
		fps > 0 ? presentation.frame / fps : 0,
	);
	const defsBody = [
		maskArtifacts.defs,
		strokeBlurArtifacts.defs,
		meshPaintArtifacts.defs,
		paintArtifacts.defs,
		effectFilterArtifacts.defs,
	]
		.filter(Boolean)
		.join("\n");
	const defs = defsBody ? "<defs>" + defsBody + "</defs>" : "";
	const consumedNodeIds = new Set(maskArtifacts.consumedNodeIds);
	const background =
		artboard?.background && artboard.background !== "transparent"
			? "<rect width=\"100%\" height=\"100%\"" +
				attribute("fill", artboard.background) +
				"/>"
			: "";
	const layers = (composedScene.layers ?? [])
		.filter((layer) => layer.visible !== false)
		.flatMap((layer) => layer.nodes ?? [])
		.map((node) =>
			renderNode(
				state,
				node,
				artboard.id,
				maskArtifacts.applicationsByNodeId,
				strokeBlurArtifacts.filterIdByNodeId,
				consumedNodeIds,
				meshPaintArtifacts.fillPatternRefByNodeId,
				meshPaintArtifacts.strokePatternRefByNodeId,
				paintArtifacts.fillLayersByNodeId,
				paintArtifacts.strokeLayersByNodeId,
				effectFilterArtifacts.filterIdByNodeId,
			),
		)
		.join("");
	const markup =
		"<svg xmlns=\"http://www.w3.org/2000/svg\"" +
		attribute("viewBox", "0 0 " + width + " " + height) +
		attribute("width", width) +
		attribute("height", height) +
		attribute("data-vector-motion-runtime", state.payload.exportFormat) +
		attribute("data-sequence-id", address.sequence.id) +
		attribute("data-sequence-item-id", item.id) +
		attribute("data-sequence-artboard-id", artboard.id) +
		attribute("data-sequence-frame", globalFrame) +
		attribute("data-local-frame", localFrame) +
		">" +
		defs +
		background +
		layers +
		"</svg>";
	return {
		markup,
		hrefByToken: meshPaintArtifacts.hrefByToken,
		presentation,
		scope: {
			kind: "scene-sequence",
			sequenceId,
			itemId: item.id,
			artboardId: artboard.id,
			globalFrame,
			localFrame,
			itemStartFrame,
			itemEndFrameExclusive,
		},
	};
}
`;

/**
 * Standalone one-shot sequence render-to-string wrappers — same reasoning as
 * {@link RUNTIME_PLAYER_RENDER_FRAME_WRAPPER_SOURCE}: never called by
 * `createVectorMotionPlayer`/`mount()`, excluded from
 * {@link motionArtifactPlayerSource}.
 */
const RUNTIME_PLAYER_RENDER_SEQUENCE_FRAME_WRAPPER_SOURCE = String.raw`
export function renderSequenceFrame(frame = 0, payload) {
	return buildSequenceFramePresentationMarkup(frame, payload, "inline").markup;
}

export const renderVectorMotionSequenceFrame = (payload, frame = 0) =>
	renderSequenceFrame(frame, payload);
`;

const RUNTIME_PLAYER_HEAD_MAIN_C_SOURCE = String.raw`
// hrefByToken resolves a mesh-pattern href TOKEN (see mesh-paint-svg.ts's
// meshPatternHrefToken) back to its real data URL — see
// resolveHrefTokenMarkup's own comment for why the live DOM must never
// actually contain a token. An attribute value that is not a known token
// (the overwhelming majority: every non-mesh-pattern attribute in the whole
// document) passes through unchanged, so a lookup miss is the expected,
// cheap common case, not an error.
const resolvedAttributeValue = (value, hrefByToken) =>
	hrefByToken && Object.hasOwn(hrefByToken, value) ? hrefByToken[value] : value;

// Compares/writes using the RESOLVED value on both sides (current already
// holds a resolved real URL from a previous patch — see patchContainerSvg's
// own comment — and next may hold either a token or, on an untouched
// attribute, the real value already). Never assigns a raw token into the
// live DOM: a live href/src must always be either the original untouched
// value or a real data URL, never the raw mesh-pattern href-token text a
// browser would try to load as a literal (broken) image source.
const syncAttributes = (current, next, hrefByToken) => {
	for (const attribute of Array.from(current.attributes)) {
		if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
	}
	for (const attribute of Array.from(next.attributes)) {
		const resolvedNextValue = resolvedAttributeValue(attribute.value, hrefByToken);
		// Steady-state no-op: an unchanged mesh href resolves to the SAME real
		// URL every frame (the raster cache is content-keyed, not frame-keyed),
		// so this comparison — against the already-resolved live value — skips
		// the write on every steady-state frame, not just the first one.
		if (current.getAttribute(attribute.name) !== resolvedNextValue) {
			current.setAttribute(attribute.name, resolvedNextValue);
		}
	}
};

const syncElementTree = (current, next, hrefByToken) => {
	if (current.tagName !== next.tagName) return false;
	const currentChildren = Array.from(current.children);
	const nextChildren = Array.from(next.children);
	if (currentChildren.length !== nextChildren.length) return false;
	syncAttributes(current, next, hrefByToken);
	if (nextChildren.length === 0 && current.textContent !== next.textContent) {
		current.textContent = next.textContent;
	}
	for (let index = 0; index < nextChildren.length; index += 1) {
		if (!syncElementTree(currentChildren[index], nextChildren[index], hrefByToken)) {
			return false;
		}
	}
	return true;
};

// Substitutes every hrefByToken entry into svgMarkup, for the RARE fallback
// paths only (initial mount / structure-mismatch / patchDom:false) that
// actually assign container.innerHTML — see this function's call sites. The
// steady-state per-frame path (syncElementTree/syncAttributes above) never
// calls this: it resolves tokens attribute-by-attribute as it walks the
// ALREADY-PARSED small token-mode markup, so the multi-megabyte substitution
// below only ever runs once per structural change, not once per frame.
const resolveHrefTokenMarkup = (svgMarkup, hrefByToken) => {
	if (!hrefByToken) return svgMarkup;
	const tokens = Object.keys(hrefByToken);
	if (tokens.length === 0) return svgMarkup;
	let resolved = svgMarkup;
	for (const token of tokens) {
		resolved = resolved.split(token).join(hrefByToken[token]);
	}
	return resolved;
};

// Parses svgMarkup (small: mesh-pattern hrefs are still tokens at this point,
// not real data URLs — see buildFramePresentationMarkup's hrefMode) and
// attempts an in-place attribute/structure diff against the currently
// mounted <svg>, falling back to a full innerHTML replace (with tokens
// resolved to real URLs first — a token must never reach the live DOM,
// see resolveHrefTokenMarkup) when the element tree shape changed too much
// to diff. hrefByToken is optional: renderVectorMotionFrame/
// renderVectorMotionSequenceFrame's public (inline-mode) callers never pass
// one, so patchContainerSvg still behaves exactly as it did before this
// indirection existed for anyone calling it with inline-mode markup.
const patchContainerSvg = (container, svgMarkup, hrefByToken) => {
	const current = container.firstElementChild;
	if (!current || current.tagName.toLowerCase() !== "svg") {
		container.innerHTML = resolveHrefTokenMarkup(svgMarkup, hrefByToken);
		return;
	}
	const nextDocument = new DOMParser().parseFromString(svgMarkup, "image/svg+xml");
	const next = nextDocument.documentElement;
	if (!next || next.tagName.toLowerCase() !== "svg") {
		container.innerHTML = resolveHrefTokenMarkup(svgMarkup, hrefByToken);
		return;
	}
	if (!syncElementTree(current, next, hrefByToken)) {
		container.innerHTML = resolveHrefTokenMarkup(svgMarkup, hrefByToken);
	}
};

// --- Interactive Motion (player.on / DOM event wiring / engine bridge) ---
//
// The engine itself (RUNTIME_SAMPLER.createInteractionEngine) is pure and
// DOM-free; everything below is the standalone SVG player's HOST side: turning
// real DOM events into the engine's semantic InteractionEngineEvent shape,
// turning the engine's InteractionEngineOutputEvent stream into either a
// player.setProps call (for "set-prop") or a player.on(...) subscriber
// notification (for "frame"/"clipStart"/"clipEnd"/"ended"/"stateChange"), and
// owning the DOM listener/observer lifecycle so destroy() leaves nothing
// attached. Only createVectorMotionPlayer (the standard, single-artboard
// player) wires this — createVectorMotionSequencePlayer's global-frame model
// spans multiple artboards and conflicts with a clip window addressed in a
// single artboard's local frame space, so it is intentionally left
// unconnected this slice (see interactions-export.ts's
// "interaction-sequence-unsupported" export-report issue, which fires when a
// sequence export carries surviving interactions).
`;

/**
 * Interaction-wiring-adjacent constant, grouped with (and included/excluded
 * alongside) {@link RUNTIME_PLAYER_INTERACTION_WIRING_SOURCE} below since it
 * documents the event-kind vocabulary that block's DOM listeners produce.
 */
const RUNTIME_PLAYER_INTERACTIONS_PRE_SOURCE = String.raw`
const INTERACTION_EVENT_NAMES = ["frame", "clipStart", "clipEnd", "ended", "stateChange"];
`;

/**
 * `player.on`'s pub/sub backing. Unlike the interaction-wiring block below,
 * this is constructed UNCONDITIONALLY by `createVectorMotionPlayer`
 * (`const eventEmitter = createEventEmitter();`, with no `if` gate) and
 * `.on()`/`.clear()` are used regardless of whether this export has any
 * interactions — `.emit()` simply never fires for an interactions-free
 * export, since nothing besides `dispatchEngineEvents` (interaction-only)
 * ever calls it. Always included, for every profile and every motion-
 * artifact export regardless of scene content.
 */
const RUNTIME_PLAYER_EVENT_EMITTER_SOURCE = String.raw`
// Minimal synchronous pub/sub: player.on(name, cb) returns an unsubscribe
// function, matching the spec's "() => unsubscribe" contract. Unknown event
// names are accepted (forward-compatible) but never fire.
const createEventEmitter = () => {
	const listenersByName = new Map();
	return {
		on(name, callback) {
			if (typeof callback !== "function") return () => {};
			const listeners = listenersByName.get(name) ?? new Set();
			listeners.add(callback);
			listenersByName.set(name, listeners);
			return () => {
				listeners.delete(callback);
			};
		},
		emit(name, payload) {
			for (const callback of listenersByName.get(name) ?? []) {
				callback(payload);
			}
		},
		clear() {
			listenersByName.clear();
		},
	};
};
`;

/**
 * Interaction-wiring + emitter dispatch: `nodeIdForEventTarget`,
 * `dispatchEngineEvents`, `scrollProgressForContainer`, and
 * `installInteractionWiring`. Every reference to these four names inside
 * `createVectorMotionPlayer`'s body is already gated behind `if (engine)`
 * (`engine` is non-null only when `state.payload.interactions` is non-empty
 * — see `createVectorMotionPlayer`'s own `interactionsEnabled` check), so
 * this block is provably dead weight for any export whose payload has no
 * interactions, at any sampler tier. Included in the motion-artifact slim
 * player exactly when `sceneHasAuthoredInteractions` — the SAME predicate
 * that bumps the sampler tier to CORE — is true for the source scene; every
 * other profile always embeds this block via `RUNTIME_PLAYER_CORE_HEAD_
 * SOURCE`.
 */
const RUNTIME_PLAYER_INTERACTION_WIRING_SOURCE = String.raw`
// Walks up from a DOM event target to the nearest data-node-id ancestor
// within container (renderNode stamps this attribute on every node's group
// wrapper — see code.ts's renderNode), for node-scoped trigger matching via
// event delegation. Returns undefined for a click/hover that lands on the
// container background (no node ancestor) or outside container entirely.
const nodeIdForEventTarget = (container, target) => {
	let element = target;
	while (element && element !== container) {
		if (element.nodeType === 1 && element.hasAttribute("data-node-id")) {
			return element.getAttribute("data-node-id");
		}
		element = element.parentNode;
	}
	return undefined;
};

// Reads engine output events, routing "set-prop" through applySetProp (the
// existing component-props write path) and every other kind through
// emitter.emit under its own kind name, matching player.on's documented
// event-name set.
const dispatchEngineEvents = (events, emitter, applySetProp) => {
	for (const event of events) {
		if (event.kind === "set-prop") {
			applySetProp(event.propName, event.value);
			continue;
		}
		emitter.emit(event.kind, event);
	}
};

// scroll-progress trigger mapping: t = clamp01((viewportHeight - rect.top) /
// (viewportHeight + rect.height)) from container.getBoundingClientRect() — 0
// when the container has not yet entered the viewport from below, 1 once it
// has fully exited above, matching a standard enter-to-exit scroll fraction.
const scrollProgressForContainer = (container) => {
	const rect = container.getBoundingClientRect();
	const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 1;
	const denominator = viewportHeight + rect.height;
	if (denominator <= 0) return 0;
	const fraction = (viewportHeight - rect.top) / denominator;
	return Math.min(1, Math.max(0, fraction));
};

// Installs every DOM listener/observer the engine's trigger kinds need,
// dispatching each matched real event into engine.handleEvent and forwarding
// the resulting output events. interactions is the SAME list the engine was
// constructed with, passed separately since the engine itself exposes no
// authored-interaction introspection (it is pure state, not a document
// reader) — this function only reads trigger.kind/nodeId/threshold from it to
// decide which observers/listeners to install, never to re-derive engine
// state. Returns a dispose() that removes everything installed here —
// destroy() calls it unconditionally so a player mounted with an inert
// (no-interactions) payload still gets a no-op dispose.
//
// loopControl closes the render/play-loop gap between the interaction path
// and the host's own clock: an interaction-fired action (play-clip,
// toggle-clip, seek, pause, resume) mutates engine state and returns output
// events, but nothing about that call touches the DOM or the rAF loop by
// itself (engine.tick() — the only thing that renders and advances frames —
// runs exclusively from inside tick(), which is itself gated on playing).
// Without this, a paused/static player (autoplay:false) that receives a
// click -> play-clip never repaints and never starts progressing, even
// though the engine's own frame pointer and clipStart/stateChange events are
// already correct. loopControl.renderNow re-paints the engine's CURRENT
// frame through the same DOM-only path api.renderFrame's tick() branch uses
// (never api.renderFrame itself, which would re-run engine.seek() and wipe
// the segment engine.handleEvent just established — see applyRenderFrame's
// own comment). loopControl.syncStateChange starts the rAF loop the exact
// same way api.play() does (shared body, so the two call sites cannot drift)
// when the engine's post-event state is no longer "paused" and the loop
// isn't already running, and stops it when the engine just became "paused"
// while the loop WAS running — otherwise a pause action would leave tick()
// scheduling itself forever (engine.tick() no-ops while paused, so nothing
// ever changes, but the rAF loop would still spin doing useless work every
// frame indefinitely).
const installInteractionWiring = (container, engine, interactions, emitter, applySetProp, loopControl) => {
	const disposers = [];
	const handle = (engineEvent) => {
		const events = engine.handleEvent(engineEvent);
		dispatchEngineEvents(events, emitter, applySetProp);
		// A set-prop-only event list is already re-rendered by applySetProp's
		// own api.setProps -> applyRenderFrame chain (see
		// installComponentPropsApi) — rendering again here would be a harmless
		// but wasted duplicate paint, so only trigger loopControl.renderNow for
		// an event list containing at least one non-"set-prop" kind.
		const needsRender = events.some((event) => event.kind !== "set-prop");
		if (needsRender) loopControl.renderNow();
		const stateChange = events.find((event) => event.kind === "stateChange");
		if (stateChange) loopControl.syncStateChange(stateChange.state);
	};

	const onClick = (domEvent) => {
		handle({ kind: "click", nodeId: nodeIdForEventTarget(container, domEvent.target) });
	};
	const onPointerOver = (domEvent) => {
		handle({ kind: "hover-in", nodeId: nodeIdForEventTarget(container, domEvent.target) });
	};
	const onPointerOut = (domEvent) => {
		handle({ kind: "hover-out", nodeId: nodeIdForEventTarget(container, domEvent.target) });
	};
	container.addEventListener("click", onClick);
	container.addEventListener("pointerover", onPointerOver);
	container.addEventListener("pointerout", onPointerOut);
	disposers.push(() => {
		container.removeEventListener("click", onClick);
		container.removeEventListener("pointerover", onPointerOver);
		container.removeEventListener("pointerout", onPointerOut);
	});

	if (typeof IntersectionObserver === "function") {
		// One observer per distinct threshold: a component-level in-view trigger
		// (no nodeId) observes container itself; a node-scoped trigger observes
		// that node's rendered element by data-node-id, re-arming (both
		// directions) so the trigger can fire again after the target leaves and
		// re-enters view, matching a typical "animate on (re-)enter" contract.
		const observers = [];
		const observeTarget = (element, nodeId, threshold) => {
			const observer = new IntersectionObserver(
				(entries) => {
					for (const entry of entries) {
						if (entry.isIntersecting) handle({ kind: "in-view", nodeId });
					}
				},
				{ threshold: Math.min(1, Math.max(0, threshold)) },
			);
			observer.observe(element);
			observers.push(observer);
		};
		for (const interaction of interactions) {
			if (interaction.trigger.kind !== "in-view") continue;
			const threshold = interaction.trigger.threshold ?? 0.5;
			if (interaction.trigger.nodeId) {
				const element = container.querySelector('[data-node-id="' + interaction.trigger.nodeId + '"]');
				if (element) observeTarget(element, interaction.trigger.nodeId, threshold);
			} else {
				observeTarget(container, undefined, threshold);
			}
		}
		disposers.push(() => {
			for (const observer of observers) observer.disconnect();
		});
	}

	const hasScrollProgressTrigger = interactions.some(
		(interaction) => interaction.trigger.kind === "scroll-progress",
	);
	if (hasScrollProgressTrigger) {
		const onScroll = () => {
			handle({ kind: "scroll-progress", value: scrollProgressForContainer(container) });
		};
		window.addEventListener("scroll", onScroll, { passive: true });
		window.addEventListener("resize", onScroll);
		onScroll();
		disposers.push(() => {
			window.removeEventListener("scroll", onScroll);
			window.removeEventListener("resize", onScroll);
		});
	}

	return () => {
		for (const dispose of disposers) dispose();
	};
};
`;

/**
 * Inert stand-in for {@link RUNTIME_PLAYER_INTERACTION_WIRING_SOURCE},
 * substituted for the motion-artifact slim player when the export's scene
 * has no authored interactions. Both names are only ever called from inside
 * `if (engine)` branches in `createVectorMotionPlayer`'s body, and `engine`
 * is structurally always null in that case (see the real block's own
 * comment) — so in normal operation neither stub is ever invoked. They throw
 * rather than silently no-op ONLY as a fail-loud guard against the
 * inclusion decision and the sampler-tier decision (both driven by the same
 * `sceneHasAuthoredInteractions` predicate) ever disagreeing for a given
 * export — which should never happen, but "throw a clear error" is strictly
 * safer than "silently do nothing" if it somehow did.
 */
const RUNTIME_PLAYER_INTERACTION_WIRING_STUB_SOURCE = String.raw`
const dispatchEngineEvents = () => {
	throw new Error("Interactions are not available in this export.");
};
const installInteractionWiring = () => {
	throw new Error("Interactions are not available in this export.");
};
`;

const RUNTIME_PLAYER_HEAD_MAIN_C2_SOURCE = String.raw`
export function createVectorMotionPlayer(container, payloadOrOptions = {}, maybeOptions = {}) {
	if (!container) throw new Error("Vector motion runtime requires a container.");
	const payload = looksLikePayload(payloadOrOptions) ? payloadOrOptions : undefined;
	const options = payload ? maybeOptions ?? {} : payloadOrOptions ?? {};
	const state = resolvePayloadState(payload);
	initializeComponentProps(state, options.props);
	const sequence = sceneSequenceForState(state);
	const hasSceneSequence = (sequence?.items ?? []).length > 0;
	let currentFrame = numberOr(options.frame, 0);
	const initialAddress = hasSceneSequence
		? resolveSequenceFrame(state, currentFrame)
		: null;
	const artboard = initialAddress?.artboard ?? primaryArtboard(state);
	const fps = Math.max(
		1,
		numberOr(
			options.fps,
			hasSceneSequence
				? sequence?.fps ?? state.motion.fps ?? artboard?.fps ?? 30
				: state.motion.fps ?? artboard?.fps ?? 30,
		),
	);
	const durationFrames = Math.max(
		1,
		numberOr(
			options.durationFrames,
			hasSceneSequence
				? sequence?.totalFrames ?? state.motion.durationFrames ?? 1
				: state.motion.durationFrames ?? artboard?.durationFrames ?? 1,
		),
	);
	let loop = options.loop !== false;
	let playbackRateValue = numberOr(options.playbackRate, 1);
	const playbackRate = () => playbackRateValue;
	let playing = false;
	let rafId = 0;
	let lastTime = 0;
	let disposed = false;

	// Interactive Motion (T3-S2): an engine is instantiated only when the
	// payload actually carries surviving interactions (export-compiled by
	// interactions-export.ts) AND the host has not explicitly opted out via
	// options.interactions === false. A payload with no interactions never
	// pays the engine/listener/observer cost.
	const authoredInteractions = state.payload.interactions ?? [];
	const interactionsEnabled =
		!hasSceneSequence &&
		authoredInteractions.length > 0 &&
		options.interactions !== false;
	const engine = interactionsEnabled
		? RUNTIME_SAMPLER.createInteractionEngine({
				interactions: authoredInteractions,
				clips: state.motion.clips ?? [],
				fps,
				durationFrames,
				loop,
			})
		: null;
	const eventEmitter = createEventEmitter();
	let disposeInteractionWiring = null;
	const cameraCatalog = (state.scene.sceneCameras ?? []).map((rig) => ({
		cameraRigId: rig.id,
		name: rig.name,
		...(rig.scope?.kind === "artboard" ? { artboardId: rig.scope.artboardId } : {}),
		projectionKind: rig.projection.kind,
	}));
	const control = RUNTIME_SAMPLER.createRuntimePlayerControl({
		renderer: "svg",
		fps,
		durationFrames,
		initialFrame: currentFrame,
		initialCamera: {
			kind: "none",
			artboardId: artboard?.id ?? "",
			fidelity: "none",
			issues: [],
		},
		initialFrameScope: initialAddress
			? {
					kind: "scene-sequence",
					sequenceId: initialAddress.sequenceId,
					itemId: initialAddress.itemId,
					artboardId: initialAddress.artboardId,
					globalFrame: initialAddress.globalFrame,
					localFrame: initialAddress.localFrame,
					itemStartFrame: initialAddress.itemStartFrame,
					itemEndFrameExclusive: initialAddress.itemEndFrameExclusive,
				}
			: {
					kind: "scene",
					artboardId: artboard?.id ?? "",
					localFrame: currentFrame,
				},
		cameraCatalog,
		initialCameraOverrides: options.cameraOverrides,
		initialActiveCameraOverride: options.activeCameraOverride,
		onFrameSampled: options.onFrameSampled,
		onFrameRendered: options.onFrameRendered,
		render(request) {
			const result = hasSceneSequence
				? buildSequenceFramePresentationMarkup(
						request.requestedFrame,
						state.payload,
						"token",
						request.cameraRuntimeControl,
					)
				: (() => {
						const frameResult = buildFramePresentationMarkup(
							request.requestedFrame,
							state.payload,
							"token",
							request.cameraRuntimeControl,
						);
						return {
							...frameResult,
							scope: sceneFrameScopeForPresentation(frameResult.presentation),
						};
					})();
			const { markup, hrefByToken, presentation, scope } = result;
			const committedFrame =
				scope.kind === "scene-sequence"
					? scope.globalFrame
					: presentation.frame;
			if (!request.sample(committedFrame, presentation.camera, scope)) {
				throw new Error("Vector motion render request was disposed before commit.");
			}
			const hasRuntimeCameraControl =
				request.cameraRuntimeControl.activeCameraRigId != null ||
				Object.keys(request.cameraRuntimeControl.cameraOverrides ?? {}).length > 0;
			if (hasRuntimeCameraControl && presentation.camera.kind === "invalid") {
				throw new Error("Runtime camera control produced an invalid camera state.");
			}
			if (!request.isActive()) {
				throw new Error("Vector motion render request is no longer active.");
			}
			if (options.patchDom === false) {
				container.innerHTML = resolveHrefTokenMarkup(markup, hrefByToken);
			} else {
				patchContainerSvg(container, markup, hrefByToken);
			}
			currentFrame = committedFrame;
			return {
				frame: committedFrame,
				scope,
				camera: presentation.camera,
			};
		},
	});
	const renderCurrentFrame = () => {
		void control.rerenderCommittedFrame();
	};

	// Shared by api.play() and the interaction path (installInteractionWiring's
	// loopControl.syncStateChange below) so a play-clip/toggle-clip/resume
	// action starts the rAF loop THE EXACT SAME WAY an explicit api.play() call
	// does — one body, so the two call sites can never drift apart.
	const startLoop = () => {
		if (playing || disposed) return;
		playing = true;
		lastTime = 0;
		rafId = requestAnimationFrame(tick);
	};
	const stopLoop = () => {
		playing = false;
		if (rafId) cancelAnimationFrame(rafId);
		rafId = 0;
		lastTime = 0;
	};

	const api = {
		renderer: "svg",
		get frame() {
			return control.getSnapshot().frame;
		},
		get progress() {
			return control.getSnapshot().progress;
		},
		set progress(value) {
			void api.seekProgress(value);
		},
		fps,
		durationFrames,
			duration: durationFrames / fps,
			get loop() {
				return loop;
			},
			setLoop(nextLoop) {
				loop = nextLoop !== false;
				engine?.setLoop(loop);
			},
			get playbackRate() {
				return playbackRateValue;
			},
			setPlaybackRate(nextPlaybackRate) {
				playbackRateValue = numberOr(nextPlaybackRate, 1);
			},
		seekFrame(frame = currentFrame) {
			currentFrame = Math.max(0, Math.min(durationFrames - 1, numberOr(frame, 0)));
			if (engine) engine.seek(currentFrame);
			return control.requestFrame(currentFrame);
		},
		seekProgress(progress) {
			const nextProgress = Math.max(0, Math.min(1, numberOr(progress, 0)));
			return api.seekFrame(nextProgress * (durationFrames - 1));
		},
		renderFrame(frame = currentFrame) {
			void api.seekFrame(frame);
			return currentFrame;
		},
		seek(progress) {
			const nextProgress = Math.max(0, Math.min(1, numberOr(progress, 0)));
			api.renderFrame(nextProgress * (durationFrames - 1));
			return currentFrame;
		},
		play: startLoop,
		pause: stopLoop,
		getSnapshot: control.getSnapshot,
		getCameraState: control.getCameraState,
		getCameraCatalog: control.getCameraCatalog,
		subscribe: control.subscribe,
		onFrameSampled: control.onFrameSampled,
		onFrameRendered: control.onFrameRendered,
		setCameraOverride: control.setCameraOverride,
		clearCameraOverrides: control.clearCameraOverrides,
		setActiveCameraOverride: control.setActiveCameraOverride,
		on(eventName, callback) {
			return eventEmitter.on(eventName, callback);
		},
		destroy() {
			if (disposed) return;
			disposed = true;
			api.pause();
			if (disposeInteractionWiring) disposeInteractionWiring();
			control.destroy();
			eventEmitter.clear();
			container.innerHTML = "";
		},
		dispose() {
			api.destroy();
		},
	};
	installComponentPropsApi(api, state, renderCurrentFrame);
	if (engine) {
		disposeInteractionWiring = installInteractionWiring(
			container,
			engine,
			authoredInteractions,
			eventEmitter,
			(propName, value) => api.setProps({ [propName]: value }),
			{
				renderNow: () => {
					currentFrame = engine.frame;
					void control.requestFrame(currentFrame);
				},
				syncStateChange: (engineState) => {
					if (engineState === "paused") {
						if (playing) stopLoop();
						return;
					}
					startLoop();
				},
			},
		);
	}

	function tick(timestamp) {
		if (!playing || disposed) return;
		if (!lastTime) lastTime = timestamp;
		const deltaSeconds = (timestamp - lastTime) / 1000;
		lastTime = timestamp;
		if (engine) {
			const result = engine.tick(deltaSeconds * playbackRate());
			dispatchEngineEvents(result.events, eventEmitter, (propName, value) =>
				api.setProps({ [propName]: value }),
			);
			currentFrame = result.frame;
			void control.requestFrame(currentFrame);
			if (result.ended) {
				stopLoop();
				return;
			}
			rafId = requestAnimationFrame(tick);
			return;
		}
		currentFrame += deltaSeconds * fps * playbackRate();
		if (currentFrame > durationFrames - 1) {
			if (loop) currentFrame %= durationFrames;
			else {
				currentFrame = durationFrames - 1;
				api.renderFrame(currentFrame);
				api.pause();
				return;
			}
		}
		void control.requestFrame(currentFrame);
		rafId = requestAnimationFrame(tick);
	}

	api.ready = control.requestFrame(currentFrame);
	if (options.autoplay) api.play();
	return api;
}

export class VectorMotionMountError extends Error {
	constructor(issue) {
		super(issue?.message ?? "Vector motion mount failed.");
		this.name = "VectorMotionMountError";
		this.issue = issue ?? { code: "mount-failed", message: this.message };
	}
}

export async function mountVectorMotion(container, options = {}) {
	const source = options.source ?? { kind: "embedded" };
	let payload;
	if (source.kind === "payload") payload = source.payload;
	else if (source.kind === "url") {
		try {
			payload = await loadVectorMotionPayload(source.url);
		} catch (error) {
			throw new VectorMotionMountError({
				code: "runtime-source-load-failed",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}
	else if (source.kind === "embedded") payload = embeddedPayload();
	else {
		throw new VectorMotionMountError({
			code: "runtime-source-invalid",
			message: "Vector motion runtime source is invalid.",
		});
	}
	if (!payload) {
		throw new VectorMotionMountError({
			code: "runtime-source-missing",
			message: "This runtime module requires a payload or URL source.",
		});
	}
	const { source: _source, ...playerOptions } = options;
	let player;
	try {
		player = createVectorMotionPlayer(container, payload, playerOptions);
	} catch (error) {
		throw new VectorMotionMountError({
			code: "initial-control-invalid",
			message: error instanceof Error ? error.message : String(error),
		});
	}
	const result = await player.ready;
	if (result.status !== "committed") {
		player.destroy();
		throw new VectorMotionMountError(
			result.issue ?? {
				code: "initial-render-failed",
				message: "Initial render ended with status " + result.status + ".",
			},
		);
	}
	return player;
}
`;

/**
 * Legacy sequence-player alias: `createVectorMotionSequencePlayer` is a
 * thin passthrough to `createVectorMotionPlayer` (which already handles
 * sequence scenes natively), kept only for pre-existing callers using the
 * old name. Nothing else in this module references it, so it is excluded
 * from {@link motionArtifactPlayerSource}.
 */
const RUNTIME_PLAYER_SEQUENCE_ALIAS_SOURCE = String.raw`
export function createVectorMotionSequencePlayer(container, payloadOrOptions = {}, maybeOptions = {}) {
	return createVectorMotionPlayer(container, payloadOrOptions, maybeOptions);
}

export const mountVectorMotionSequence = createVectorMotionSequencePlayer;
`;

/**
 * URL-loader addon: the `fetch(`/`new URL(`-based remote payload loading
 * surface, split out of the core player so the motion-artifact profile can
 * ship without any live network-fetch capability. Concatenated after
 * {@link RUNTIME_PLAYER_CORE_HEAD_SOURCE} and before
 * {@link RUNTIME_PLAYER_CORE_TAIL_SOURCE} for every other profile (see
 * `RUNTIME_PLAYER_SOURCE` below) — same order as before the split, so the
 * concatenation reproduces today's single-file player exactly.
 */
const RUNTIME_PLAYER_URL_LOADER_ADDON_SOURCE = String.raw`
export async function loadVectorMotionPayload(url) {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error("Vector motion payload failed to load: " + response.status);
	}
	return response.json();
}

export async function mountVectorMotionFromUrl(container, url, options = {}) {
	const payload = await loadVectorMotionPayload(url);
	return mountVectorMotion(container, {
		...options,
		source: { kind: "payload", payload },
	});
}

export async function mountVectorMotionSequenceFromUrl(container, url, options = {}) {
	return mountVectorMotionFromUrl(container, url, options);
}
`;

const RUNTIME_PLAYER_CORE_TAIL_SOURCE = String.raw`
// --- Embeddable Motion Artifact: mount(el, opts) (F1/F2) ---
//
// A synchronous-return wrapper around mountVectorMotion for the "drop this
// script tag into any page" embedding contract: a variable-size, full-bleed
// hero background is the primary target, never a fixed-aspect demo box.
// mount() itself never awaits anything — it returns { play, pause, seek,
// destroy, ready } immediately, queues play/pause/seek intent recorded
// before the underlying player exists, and applies it once ready resolves.
// destroy() called before ready cancels initialization (the in-flight
// mountVectorMotion call still resolves, but its player is destroyed
// immediately instead of being handed back) so nothing leaks regardless of
// when a host tears down.
//
// Mirrors normalizeColorToken/resolvePaletteReplacements/
// applyPaletteReplacements in palette-manifest.ts verbatim — duplicated here
// (rather than imported) because RUNTIME_PLAYER_SOURCE ships as a
// self-contained string template, not a bundled module. Keep both copies in
// sync on any change to either. Only the recognition/canonicalization half of
// normalizeColorToken is needed here (no role-scoring math): role assignment
// already happened at build time and is baked into the static
// paletteManifest this runtime receives.
const PALETTE_HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{3,8}$/;

// Closed, anchored function-name list matching PALETTE_COLOR_FUNCTION_PATTERN
// in palette-manifest.ts — applyPaletteReplacements below tests every string
// in the payload, so a permissive match would false-positive on unrelated
// function-shaped strings (a transform, an easing curve, a paint-server url()).
const PALETTE_COLOR_FUNCTION_PATTERN = /^(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\((.+)\)$/i;

const canonicalizeColorFunctionArgs = (rawArgs) => {
	const args = rawArgs
		.split(",")
		.map((part) => part.trim())
		.filter((part) => part.length > 0)
		.join(" ")
		.replace(/\s*\/\s*/g, " / ")
		.replace(/\s+/g, " ")
		.trim();
	return args.length > 0 ? args : null;
};

const normalizeColorToken = (value) => {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (PALETTE_HEX_COLOR_PATTERN.test(trimmed)) {
		const lower = trimmed.toLowerCase();
		const digits = lower.slice(1);
		if (digits.length === 3 || digits.length === 4) {
			return "#" + digits.split("").map((digit) => digit + digit).join("");
		}
		return lower;
	}
	const match = PALETTE_COLOR_FUNCTION_PATTERN.exec(trimmed);
	if (!match) return null;
	const name = match[1] ? match[1].toLowerCase() : null;
	const args = match[2] ? canonicalizeColorFunctionArgs(match[2]) : null;
	return name && args ? name + "(" + args + ")" : null;
};

// manifest may be undefined (non-embedded/shared packaging never declares
// paletteManifest at all — see embeddedPayload's identical typeof guard
// above). A role name (background/night/paper/accent) and an auto slot name
// (color1..colorN) are both just flat entries of the same manifest object,
// so one lookup resolves either; a key absent from the manifest is treated
// as a literal color token instead.
const resolvePaletteReplacements = (manifest, palette) => {
	const replacements = new Map();
	if (!palette) return replacements;
	for (const key of Object.keys(palette)) {
		const requestedReplacement = palette[key];
		if (requestedReplacement === undefined) continue;
		const sourceColor = manifest && Object.hasOwn(manifest, key)
			? normalizeColorToken(manifest[key])
			: normalizeColorToken(key);
		if (sourceColor) replacements.set(sourceColor, requestedReplacement);
	}
	return replacements;
};

const applyPaletteReplacements = (value, replacements) => {
	if (replacements.size === 0) return value;
	if (typeof value === "string") {
		const normalized = normalizeColorToken(value);
		const replacement = normalized ? replacements.get(normalized) : undefined;
		return replacement === undefined ? value : replacement;
	}
	if (Array.isArray(value)) {
		return value.map((item) => applyPaletteReplacements(item, replacements));
	}
	if (value && typeof value === "object") {
		const next = {};
		for (const key of Object.keys(value)) next[key] = applyPaletteReplacements(value[key], replacements);
		return next;
	}
	return value;
};

// Inline <svg> is NOT a replaced element, so CSS object-fit/object-position
// (which DO work on <canvas>, see the WebGL runtime's parity mount()) are
// inert on it; preserveAspectRatio="xMidYMid slice" is the native cover
// analog but only offers 9 discrete alignments, not a continuous
// densityCenter. This computes the same result CSS object-fit:cover +
// object-position would produce on a replaced element: scale up so both
// axes cover the container, then clamp the focal point to the container's
// center unless that would reveal empty space at an edge (matching
// object-position's own clamping behavior).
const applyCoverLayout = (svg, containerWidth, containerHeight, densityCenter) => {
	if (!svg || containerWidth <= 0 || containerHeight <= 0) return;
	const artboardWidth = Number(svg.getAttribute("width")) || 0;
	const artboardHeight = Number(svg.getAttribute("height")) || 0;
	if (artboardWidth <= 0 || artboardHeight <= 0) return;
	const scale = Math.max(containerWidth / artboardWidth, containerHeight / artboardHeight);
	const renderedWidth = artboardWidth * scale;
	const renderedHeight = artboardHeight * scale;
	const focalX = Math.min(1, Math.max(0, densityCenter.x));
	const focalY = Math.min(1, Math.max(0, densityCenter.y));
	const idealLeft = containerWidth / 2 - focalX * renderedWidth;
	const idealTop = containerHeight / 2 - focalY * renderedHeight;
	const left = Math.min(0, Math.max(containerWidth - renderedWidth, idealLeft));
	const top = Math.min(0, Math.max(containerHeight - renderedHeight, idealTop));
	svg.style.position = "absolute";
	svg.style.left = left + "px";
	svg.style.top = top + "px";
	svg.style.width = renderedWidth + "px";
	svg.style.height = renderedHeight + "px";
	svg.style.maxWidth = "none";
	svg.style.maxHeight = "none";
};

const CONTAINER_POSITIONING_CONTEXTS = ["relative", "absolute", "fixed", "sticky"];

const ensureContainerIsPositioningContext = (container) => {
	container.style.overflow = "hidden";
	const computedPosition = typeof window !== "undefined" && window.getComputedStyle
		? window.getComputedStyle(container).position
		: "static";
	if (CONTAINER_POSITIONING_CONTEXTS.indexOf(computedPosition) === -1) {
		container.style.position = "relative";
	}
};

export function mount(container, opts = {}) {
	const options = opts ?? {};
	const reducedMotion = options.reducedMotion === true;
	const wantsAutoplay = options.autoplay !== false;
	const loop = options.loop !== false;
	const densityCenter = {
		x: numberOr(options.densityCenter && options.densityCenter.x, 0.5),
		y: numberOr(options.densityCenter && options.densityCenter.y, 0.5),
	};

	let player = null;
	let destroyed = false;
	let cancelled = false;
	let pendingSeek = null;
	let intent = !reducedMotion && wantsAutoplay ? "playing" : "paused";
	// Starts suspended whenever IntersectionObserver exists so autoplay never
	// spins the rAF loop for the handful of frames before the observer's own
	// first (always-fires-on-observe) callback confirms real visibility —
	// otherwise a below-the-fold hero would burn idle CPU for that window,
	// exactly what "Idle CPU ~= 0" is guarding against.
	let suspendedByVisibility = typeof IntersectionObserver !== "undefined";
	let visibilityObserver = null;
	let resizeObserver = null;
	let unsubscribeFrameSync = null;
	let lastStyledSvg = null;
	let lastContainerWidth = 0;
	let lastContainerHeight = 0;

	const disconnectObservers = () => {
		if (visibilityObserver) {
			visibilityObserver.disconnect();
			visibilityObserver = null;
		}
		if (resizeObserver) {
			resizeObserver.disconnect();
			resizeObserver = null;
		}
		if (unsubscribeFrameSync) {
			unsubscribeFrameSync();
			unsubscribeFrameSync = null;
		}
	};

	const applyLayoutNow = () => {
		const svg = container.firstElementChild;
		if (!svg) return;
		lastStyledSvg = svg;
		if (lastContainerWidth > 0 && lastContainerHeight > 0) {
			applyCoverLayout(svg, lastContainerWidth, lastContainerHeight, densityCenter);
		}
	};

	// ResizeObserver fires once as soon as observe() starts (even with no
	// prior size on record), which doubles as the initial layout pass — no
	// separate synchronous call needed. This never touches play/pause state:
	// re-covering an already-rasterized SVG is pure CSS positioning, so it
	// can never wake a paused rAF loop, and it re-renders zero frames (the
	// SVG's own pixels never change on a container resize, only their
	// on-screen crop/placement do).
	const installResizeTracking = () => {
		ensureContainerIsPositioningContext(container);
		if (typeof ResizeObserver === "undefined") {
			lastContainerWidth = container.clientWidth;
			lastContainerHeight = container.clientHeight;
			applyLayoutNow();
			return;
		}
		resizeObserver = new ResizeObserver((entries) => {
			const entry = entries[entries.length - 1];
			if (!entry) return;
			const width = entry.contentRect.width;
			const height = entry.contentRect.height;
			if (width <= 0 || height <= 0) return;
			lastContainerWidth = width;
			lastContainerHeight = height;
			applyLayoutNow();
		});
		resizeObserver.observe(container);
	};

	const applyIntent = () => {
		if (!player || destroyed || reducedMotion) return;
		if (intent === "playing" && !suspendedByVisibility) player.play();
		else player.pause();
	};

	const installVisibilityGate = () => {
		if (typeof IntersectionObserver === "undefined") return;
		visibilityObserver = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (!player || destroyed) continue;
					if (entry.isIntersecting) {
						if (suspendedByVisibility) {
							suspendedByVisibility = false;
							applyIntent();
						}
					} else if (!suspendedByVisibility) {
						suspendedByVisibility = true;
						player.pause();
					}
				}
			},
			{ threshold: 0 },
		);
		visibilityObserver.observe(container);
	};

	const ready = (async () => {
		const sourcePayload = embeddedPayload();
		const manifest = typeof paletteManifest === "undefined" ? undefined : paletteManifest;
		const replacements = resolvePaletteReplacements(manifest, options.palette);
		const payload = sourcePayload && replacements.size > 0
			? applyPaletteReplacements(sourcePayload, replacements)
			: sourcePayload;
		const nextPlayer = await mountVectorMotion(container, {
			source: payload ? { kind: "payload", payload } : { kind: "embedded" },
			autoplay: false,
			loop,
		});
		if (cancelled) {
			nextPlayer.destroy();
			throw new Error("Vector motion mount was destroyed before it became ready.");
		}
		player = nextPlayer;
		if (pendingSeek !== null) {
			const target = pendingSeek;
			pendingSeek = null;
			await player.seekProgress(target);
		} else if (reducedMotion) {
			await player.seekProgress(1);
		}
		// Cover-layout tracking is orthogonal to reducedMotion/play state: a
		// frozen final-frame hero still needs to fill and crop to its
		// container.
		installResizeTracking();
		unsubscribeFrameSync = player.subscribe(() => {
			const svg = container.firstElementChild;
			if (svg && svg !== lastStyledSvg) applyLayoutNow();
		});
		if (!reducedMotion) {
			installVisibilityGate();
			applyIntent();
		}
	})();
	ready.catch(() => {});

	return {
		play() {
			if (destroyed || reducedMotion) return;
			intent = "playing";
			applyIntent();
		},
		pause() {
			if (destroyed) return;
			intent = "paused";
			if (player) player.pause();
		},
		seek(progress) {
			if (destroyed) return;
			const clamped = Math.max(0, Math.min(1, numberOr(progress, 0)));
			if (player) {
				pendingSeek = null;
				void player.seekProgress(clamped);
			} else {
				pendingSeek = clamped;
			}
		},
		destroy() {
			if (destroyed) return;
			destroyed = true;
			cancelled = true;
			disconnectObservers();
			if (player) {
				player.destroy();
				player = null;
			}
		},
		ready,
	};
}
`;

/**
 * Reassembly of every HEAD_MAIN/component-props/interaction-wiring piece
 * (always the REAL, non-stub variant of the latter two) plus the standalone
 * render wrappers and the legacy sequence alias, in original declaration
 * order — byte-identical to the single template this was split from. Used by
 * {@link RUNTIME_PLAYER_SOURCE} (every profile other than motion-artifact,
 * which always ships every capability regardless of what a given scene
 * happens to use).
 */
const RUNTIME_PLAYER_CORE_HEAD_SOURCE =
	RUNTIME_PLAYER_HEAD_MAIN_A_SOURCE +
	RUNTIME_PLAYER_COMPONENT_PROPS_API_SOURCE +
	RUNTIME_PLAYER_HEAD_MAIN_A2_SOURCE +
	RUNTIME_PLAYER_RENDER_FRAME_WRAPPER_SOURCE +
	RUNTIME_PLAYER_HEAD_MAIN_B_SOURCE +
	RUNTIME_PLAYER_RENDER_SEQUENCE_FRAME_WRAPPER_SOURCE +
	RUNTIME_PLAYER_HEAD_MAIN_C_SOURCE +
	RUNTIME_PLAYER_INTERACTIONS_PRE_SOURCE +
	RUNTIME_PLAYER_EVENT_EMITTER_SOURCE +
	RUNTIME_PLAYER_INTERACTION_WIRING_SOURCE +
	RUNTIME_PLAYER_HEAD_MAIN_C2_SOURCE +
	RUNTIME_PLAYER_SEQUENCE_ALIAS_SOURCE;

/**
 * Full player (core + URL-loader addon), in the same order as the
 * single-file player before the split — every profile other than
 * motion-artifact embeds this, reproducing today's player exactly.
 */
const RUNTIME_PLAYER_SOURCE =
	RUNTIME_PLAYER_CORE_HEAD_SOURCE +
	RUNTIME_PLAYER_URL_LOADER_ADDON_SOURCE +
	RUNTIME_PLAYER_CORE_TAIL_SOURCE;

/**
 * Assembles the motion-artifact profile's player, scene-conditionally.
 * Mirrors the sampler-tier philosophy (`selectMotionArtifactRuntimeSamplerTier`):
 * a capability's code is included exactly when the SOURCE SCENE actually
 * authors it, never based on the profile alone — the motion-artifact public
 * contract is mount/play/pause/seek/destroy, with setProps/interactions as
 * scene-driven additions rather than a fixed subset, so an export never
 * silently ships a player that can't do what its own payload needs (nor pays
 * for capability code its payload structurally cannot use). Always omits the
 * URL-loader addon, the standalone render wrappers, and the legacy sequence
 * alias — see `RUNTIME_PLAYER_HEAD_MAIN_A_SOURCE`'s own doc comment for why
 * those three are safe to drop unconditionally for this profile.
 *
 * `includeComponentPropsApi`/`includeInteractionsSurface` must be computed
 * from the SAME scene/payload the sampler tier itself was selected from (see
 * `createMotionCodeRuntimeAsset`'s call site) — `includeInteractionsSurface`
 * in particular MUST use `sceneHasAuthoredInteractions`, the identical
 * predicate `selectMotionArtifactRuntimeSamplerTier` uses to decide whether
 * the sampler bundles a real interaction engine, so the player and the
 * sampler it is paired with can never disagree about whether this export
 * has a live interaction engine.
 */
const motionArtifactPlayerSource = ({
	includeComponentPropsApi,
	includeInteractionsSurface,
}: {
	readonly includeComponentPropsApi: boolean;
	readonly includeInteractionsSurface: boolean;
}): string =>
	RUNTIME_PLAYER_HEAD_MAIN_A_SOURCE +
	(includeComponentPropsApi
		? RUNTIME_PLAYER_COMPONENT_PROPS_API_SOURCE
		: RUNTIME_PLAYER_COMPONENT_PROPS_STUB_SOURCE) +
	RUNTIME_PLAYER_HEAD_MAIN_A2_SOURCE +
	RUNTIME_PLAYER_HEAD_MAIN_B_SOURCE +
	RUNTIME_PLAYER_HEAD_MAIN_C_SOURCE +
	(includeInteractionsSurface ? RUNTIME_PLAYER_INTERACTIONS_PRE_SOURCE : "") +
	RUNTIME_PLAYER_EVENT_EMITTER_SOURCE +
	(includeInteractionsSurface
		? RUNTIME_PLAYER_INTERACTION_WIRING_SOURCE
		: RUNTIME_PLAYER_INTERACTION_WIRING_STUB_SOURCE) +
	RUNTIME_PLAYER_HEAD_MAIN_C2_SOURCE +
	RUNTIME_PLAYER_CORE_TAIL_SOURCE;

const sceneNameFromBundle = (bundle: ExportBundle): string => {
	const stem = stemFromBundle(bundle);
	const sceneAsset = assetByKind(bundle, "scene-json");
	if (!sceneAsset) return stem;
	return (
		((JSON.parse(sceneAsset.contents) as { readonly name?: string }).name ??
			stem) ||
		stem
	);
};

const bundleHasSceneSequence = (bundle: ExportBundle): boolean =>
	(bundle.sceneSequence?.items.length ?? 0) > 0;

/**
 * Re-derives the full component-props export result (schema + appliers +
 * issues) from a bundle, which (like `sceneNameFromBundle` above) runs
 * independently of `createMotionCodeRuntimePayload` and so re-parses
 * `scene-json`/`motion-json` rather than sharing that function's already-
 * projected scene/motion. Projects the scene first (mirroring
 * `createMotionCodeRuntimePayload`'s ordering), then the motion document
 * against the projected scene's surviving node ids, so a prop bound to a
 * node this profile prunes — or to a node+property with an animated-conflict
 * track — is correctly reported/absent, matching what the shipped runtime
 * payload will actually expose. `motion-json` is always created alongside
 * `scene-json` for every bundle (see `bundle.ts`'s `createSceneJsonExport`/
 * `createMotionJsonExport` pairing), so a bundle with one but not the other
 * is treated as malformed and degrades to an empty result exactly like a
 * missing `scene-json` already does. Exported so both the React wrapper
 * generator (schema only) and the export-report builder (schema + issues,
 * for a UI-facing degrade summary) share one projection instead of drifting.
 */
export const componentPropsExportResultFromBundle = (
	bundle: ExportBundle,
	options: ExportOptimizationOptions,
	grammarBindings?: readonly MotionGrammarBinding[],
): ComponentPropsExportResult => {
	const sceneAsset = assetByKind(bundle, "scene-json");
	const motionAsset = assetByKind(bundle, "motion-json");
	if (!sceneAsset || !motionAsset)
		return { schema: [], appliers: [], issues: [] };
	const sourceScene = JSON.parse(sceneAsset.contents) as SceneDocument;
	const sourceMotion = JSON.parse(motionAsset.contents) as MotionDocument;
	const projectedScene = projectSceneForExport(sourceScene, options);
	const visibleNodeIdSet = new Set(
		allNodes(projectedScene).map((node) => node.id),
	);
	const projectedMotion = projectMotionForExport(
		sourceMotion,
		visibleNodeIdSet,
		options,
	);
	const projectedGrammarBindings = projectGrammarBindingsForExport(
		grammarBindings ?? parseMotionGrammarLayer(sourceMotion.grammar).bindings,
		visibleNodeIdSet,
		options,
	);
	return buildComponentPropsExport(projectedScene, projectedMotion, {
		componentProps: sourceScene.componentProps,
		layers: sourceScene.layers,
		nativeExpressionBindings: sourceScene.nativeExpressionBindings,
		grammarTargetNodeIds: new Set(
			projectedGrammarBindings.flatMap((binding) => binding.targetIds),
		),
	});
};

/**
 * Re-derives the full interactions export result (surviving interactions +
 * drop issues) from a bundle, mirroring
 * `componentPropsExportResultFromBundle`'s independent-re-projection shape
 * exactly (same reasons: this runs outside `createMotionCodeRuntimePayload`,
 * so it re-parses and re-projects `scene-json`/`motion-json` rather than
 * sharing that function's already-projected scene/motion). Exported so the
 * export-report builder can surface dropped interactions (a dangling
 * trigger node, clip, or component prop) without duplicating the projection
 * or the export-gate logic.
 */
export const interactionsExportResultFromBundle = (
	bundle: ExportBundle,
	options: ExportOptimizationOptions,
): InteractionsExportResult => {
	const sceneAsset = assetByKind(bundle, "scene-json");
	const motionAsset = assetByKind(bundle, "motion-json");
	if (!sceneAsset || !motionAsset) return { interactions: [], issues: [] };
	const sourceScene = JSON.parse(sceneAsset.contents) as SceneDocument;
	const sourceMotion = JSON.parse(motionAsset.contents) as MotionDocument;
	const projectedScene = projectSceneForExport(sourceScene, options);
	const visibleNodeIdSet = new Set(
		allNodes(projectedScene).map((node) => node.id),
	);
	const projectedMotion = projectMotionForExport(
		sourceMotion,
		visibleNodeIdSet,
		options,
	);
	return buildInteractionsExport(projectedScene, {
		clips: projectedMotion.clips,
	});
};

const escapeHtml = (value: string): string =>
	value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");

const runtimeSourceHeader = (
	options: ExportOptimizationOptions,
): readonly string[] =>
	options.includeDebugComments
		? [
				"// Generated by vector-motion-author.",
				"// This module contains the shared motion sampler and SVG player runtime.",
			]
		: ["// Generated by vector-motion-author."];

const runtimeSamplerSource = (preferCoreRuntime: boolean): string =>
	preferCoreRuntime
		? MOTION_RUNTIME_SAMPLER_CORE_SOURCE
		: MOTION_RUNTIME_SAMPLER_SOURCE;

/**
 * The motion-artifact profile always constructs an embedded/payload source
 * (never a `"url"` one) and never calls the standalone render wrappers or
 * legacy sequence alias (it only ever mounts via `mount()`/`mountVectorMotion`),
 * so it embeds the fetch/URL-loader-free, wrapper-free player alone, with the
 * component-props API and interaction-wiring sections included or stubbed
 * per `hasComponentProps`/`hasAuthoredInteractions` (see
 * `motionArtifactPlayerSource`'s own doc comment); every other profile
 * embeds the full player (core + addon, every capability unconditionally),
 * byte-identical to the pre-split single-file player.
 */
const runtimePlayerSourceForProfile = (
	profile: ExportOptimizationProfile,
	motionArtifactCapabilities: {
		readonly hasComponentProps: boolean;
		readonly hasAuthoredInteractions: boolean;
	},
): string =>
	profile === "motion-artifact"
		? motionArtifactPlayerSource({
				includeComponentPropsApi: motionArtifactCapabilities.hasComponentProps,
				includeInteractionsSurface:
					motionArtifactCapabilities.hasAuthoredInteractions,
			})
		: RUNTIME_PLAYER_SOURCE;

const runtimeOnlyContents = (
	options: ExportOptimizationOptions,
	preferCoreRuntime: boolean,
): string =>
	[
		...runtimeSourceHeader(options),
		runtimeSamplerSource(preferCoreRuntime),
		RUNTIME_PLAYER_SOURCE.trim(),
		"",
	].join("\n");

/**
 * The core runtime omits the motion-grammar evaluator and expression sampler. It is
 * byte-identical to the full runtime when the scene has no grammar bindings, no
 * effect-expression bindings, and no duplicate generators — the case where the full
 * sampler already runs with `grammar: undefined` (see render-presentation.ts) — so
 * selecting it for those scenes just drops dead weight from the shipped runtime.
 */
const motionCodeRuntimeFavorsCore = (
	scene: SceneDocument,
	grammarBindings: readonly MotionGrammarBinding[],
): boolean =>
	grammarBindings.length === 0 &&
	(scene.effectExpressionBindings?.length ?? 0) === 0 &&
	(scene.duplicateGenerators?.length ?? 0) === 0;

const sceneFromBundle = (bundle: ExportBundle): SceneDocument | null => {
	const sceneAsset = assetByKind(bundle, "scene-json");
	return sceneAsset ? (JSON.parse(sceneAsset.contents) as SceneDocument) : null;
};

const motionFromBundle = (bundle: ExportBundle): MotionDocument | null => {
	const motionAsset = assetByKind(bundle, "motion-json");
	return motionAsset
		? (JSON.parse(motionAsset.contents) as MotionDocument)
		: null;
};

/**
 * Whether to embed the smaller core runtime. Only for the size-conscious split-data
 * and shared-runtime packagings (the embedded developer-handoff bundle always ships
 * the full sampler API), and only when the scene uses no grammar/expression features.
 */
const exportPrefersCoreRuntime = (
	bundle: ExportBundle,
	grammarBindings: readonly MotionGrammarBinding[],
	options: ExportOptimizationOptions,
): boolean => {
	if (options.runtimePackaging === "embedded") return false;
	const scene = sceneFromBundle(bundle);
	return scene ? motionCodeRuntimeFavorsCore(scene, grammarBindings) : false;
};

/** The four sampler bundles `code.ts` can embed. */
type RuntimeSamplerTier = "full" | "core" | "lean" | "flat";

const runtimeSamplerSourceForTier = (tier: RuntimeSamplerTier): string => {
	if (tier === "flat") return MOTION_RUNTIME_SAMPLER_FLAT_SOURCE;
	if (tier === "lean") return MOTION_RUNTIME_SAMPLER_LEAN_SOURCE;
	if (tier === "core") return MOTION_RUNTIME_SAMPLER_CORE_SOURCE;
	return MOTION_RUNTIME_SAMPLER_SOURCE;
};

const paintStackHasMeshGradient = (
	paints: readonly Paint[] | undefined,
): boolean => (paints ?? []).some((paint) => paint.kind === "mesh-gradient");

/** Any node anywhere in the document has a representable mask relation (`appearance.ts`'s mask authoring seam). */
const sceneHasRepresentableMask = (scene: SceneDocument): boolean =>
	allNodes(scene).some((node) => readAppearanceMaskRelations(node).length > 0);

/** Any node's fill/stroke paint stack contains a mesh-gradient paint. */
const sceneHasMeshGradientPaint = (scene: SceneDocument): boolean =>
	allNodes(scene).some(
		(node) =>
			paintStackHasMeshGradient(node.style?.fills) ||
			paintStackHasMeshGradient(node.style?.strokes),
	);

/**
 * Any node anywhere in the document is a Blend container. Mis-tiering this is
 * SILENT visual loss: a tier that skips the blend-refresh presentation stage
 * (CORE and LEAN both do — see `presentation-stage-blend.ts`) leaves the
 * Blend container's generated in-between children stale rather than absent,
 * which does not surface as a missing-content warning anywhere downstream.
 * Fail-closed on this specifically rather than a cheaper proxy.
 */
const sceneHasBlendNode = (scene: SceneDocument): boolean =>
	scene.layers.some((layer) => containsBlendNode(layer.nodes));

const sceneHasAuthoredInteractions = (scene: SceneDocument): boolean =>
	(scene.interactions?.length ?? 0) > 0;

/**
 * Any scene/artboard/node-scoped vec-core effect intent, appearance-stack
 * effect, or Source Optics rig — the capability set the source-optics/
 * effect-expression/look-graph presentation stages exist to serve, all three
 * of which LEAN (and the motion-artifact CORE fallback below it) skip.
 */
const sceneHasEffectsOrLookGraphCapability = (scene: SceneDocument): boolean =>
	Boolean(scene.effectIntent) ||
	Boolean(scene.artboard.effectIntent) ||
	(scene.artboard.sourceOpticsRigs?.length ?? 0) > 0 ||
	(scene.artboards ?? []).some(
		(artboard) =>
			Boolean(artboard.effectIntent) ||
			(artboard.sourceOpticsRigs?.length ?? 0) > 0,
	) ||
	allNodes(scene).some(
		(node) =>
			Boolean(node.recipe) ||
			Boolean(node.recipeRef) ||
			(node.style?.effects?.length ?? 0) > 0,
	);

/**
 * Any artboard anywhere in the document has activated a scene camera —
 * fail-closed across the whole scene (not just the export target artboard),
 * matching {@link sceneHasEffectsOrLookGraphCapability}'s document-wide scan
 * style: a camera rig scoped `"scene"` can apply outside its authoring
 * artboard, so scanning only the export target artboard would be unsound.
 */
const sceneHasActiveSceneCamera = (scene: SceneDocument): boolean =>
	Boolean(scene.artboard.activeSceneCameraId) ||
	(scene.artboards ?? []).some((artboard) =>
		Boolean(artboard.activeSceneCameraId),
	);

/**
 * FLAT (LEAN minus real camera projection) is only safe when the document has
 * no scene-camera rig anywhere, no artboard has activated one, no motion
 * camera-cut segment exists, AND the export target artboard has explicitly
 * declared `cameraSpacePolicy: "screen_2d"`. An undeclared policy reads as
 * ambiguous elsewhere in this codebase (see `Artboard.cameraSpacePolicy`'s doc
 * comment: "validation treats undeclared plus spatial motion plus no active
 * camera as a warning, not an error"), so this fails closed to LEAN rather
 * than assuming 2D from absence alone.
 *
 * The `motion.cameraCuts` check exists because
 * {@link resolveCameraCutCrossfadeFrame} in `scene-camera.ts` can resolve a
 * non-null crossfade purely from a previous cut segment's `cameraRigId` (via
 * `findSceneCameraRigForFrame`'s `requestedCameraRigId`), independent of
 * whether that rig id actually exists in `scene.sceneCameras` or any artboard
 * has activated it. Without this check, a scene with camera-cut segments but
 * zero scene cameras (an unusual but not impossible authoring state) could
 * qualify for FLAT while the real `sampleSceneCameraPresentation` still takes
 * the camera-crossfade branch — a silent behavioral divergence FLAT's
 * identity-camera path never replicates.
 */
const sceneQualifiesForFlatTier = (
	scene: SceneDocument,
	motion: MotionDocument,
): boolean =>
	(scene.sceneCameras?.length ?? 0) === 0 &&
	!sceneHasActiveSceneCamera(scene) &&
	(motion.cameraCuts?.length ?? 0) === 0 &&
	scene.artboard.cameraSpacePolicy === "screen_2d";

/**
 * Whether the motion-artifact profile must force FULL regardless of every
 * other predicate below. Grammar bindings and effect-expression bindings both
 * force FULL — unlike {@link motionCodeRuntimeFavorsCore} (the generic
 * CORE-vs-FULL gate shared with non-motion-artifact exports), this
 * deliberately does NOT check `duplicateGenerators`: LEAN/FLAT's render
 * presentation modules (`render-presentation-lean.ts`, `render-presentation-flat.ts`)
 * now wire in `buildDuplicateOnlyFrameSampler`, so a duplicate-bearing scene
 * with no other capability need can select LEAN/FLAT. This is intentionally a
 * separate predicate from `motionCodeRuntimeFavorsCore` rather than a reuse of
 * it: `motionCodeRuntimeFavorsCore` also gates `exportPrefersCoreRuntime` for
 * every other export profile, whose CORE runtime (`render-presentation-core.ts`)
 * omits `grammar` entirely and has no duplicate-generator support — loosening
 * that shared gate would silently drop duplicates from non-motion-artifact
 * CORE exports.
 */
const motionArtifactForcesFullTier = (
	scene: SceneDocument,
	grammarBindings: readonly MotionGrammarBinding[],
): boolean =>
	grammarBindings.length > 0 ||
	(scene.effectExpressionBindings?.length ?? 0) > 0;

/**
 * Fail-closed tier selection for the motion-artifact export profile: an
 * undecidable or capability-bearing scene always falls back to a fatter tier,
 * never to LEAN/FLAT or (for a source/parse failure) even CORE. Grammar/
 * effect-expression use forces FULL via {@link motionArtifactForcesFullTier};
 * every other predicate below falls back to CORE, which — unlike LEAN/FLAT —
 * still runs every presentation stage and every scene-artifact builder.
 * `duplicateGenerators` alone never forces FULL, but a duplicate-bearing scene
 * that also needs CORE for another reason (mask, mesh-gradient paint, blend
 * node, interactions, effects/look-graph, source-optics/look-node tracks)
 * still forces FULL rather than CORE: CORE's render presentation
 * (`render-presentation-core.ts`) omits `grammar` entirely, so it cannot carry
 * duplicate instances the way LEAN/FLAT now do.
 */
const selectMotionArtifactRuntimeSamplerTier = (
	bundle: ExportBundle,
	grammarBindings: readonly MotionGrammarBinding[],
): RuntimeSamplerTier => {
	const scene = sceneFromBundle(bundle);
	const motion = motionFromBundle(bundle);
	if (!scene || !motion) return "full";
	if (motionArtifactForcesFullTier(scene, grammarBindings)) return "full";
	const hasDuplicateGenerators = (scene.duplicateGenerators?.length ?? 0) > 0;
	const needsCore =
		sceneHasRepresentableMask(scene) ||
		sceneHasMeshGradientPaint(scene) ||
		sceneHasBlendNode(scene) ||
		sceneHasAuthoredInteractions(scene) ||
		sceneHasEffectsOrLookGraphCapability(scene) ||
		(motion.sourceOpticsTracks?.length ?? 0) > 0 ||
		(motion.lookNodeTracks?.length ?? 0) > 0;
	if (needsCore) return hasDuplicateGenerators ? "full" : "core";
	return sceneQualifiesForFlatTier(scene, motion) ? "flat" : "lean";
};

const runtimeHtmlContents = ({
	runtimeFileName,
	dataFileName,
	sceneName,
	options,
}: {
	readonly runtimeFileName: string;
	readonly dataFileName?: string;
	readonly sceneName: string;
	readonly options: ExportOptimizationOptions;
}): string => {
	const moduleScript =
		options.runtimePackaging === "embedded"
			? `    import { mountVectorMotion } from "./${runtimeFileName}";

    await mountVectorMotion(document.getElementById("motion"), {
      autoplay: true,
      loop: true
    });`
			: `    import { mountVectorMotion } from "./${runtimeFileName}";

    await mountVectorMotion(document.getElementById("motion"), {
      source: { kind: "url", url: "./${dataFileName}" },
      autoplay: true,
      loop: true
    });`;
	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(sceneName)}</title>
  <style>
    html, body { margin: 0; min-height: 100%; background: #111; }
    body { display: grid; place-items: center; min-height: 100vh; }
    #motion { width: min(100vw, 1280px); }
    #motion svg { display: block; width: 100%; height: auto; }
  </style>
</head>
<body>
  <div id="motion" aria-label="${escapeHtml(sceneName)} motion"></div>
  <script type="module">
${moduleScript}
  </script>
</body>
</html>
`;
};

const reactComponentContents = ({
	runtimeFileName,
	dataFileName,
	sceneName,
	options,
	componentPropSchema,
}: {
	readonly runtimeFileName: string;
	readonly dataFileName?: string;
	readonly sceneName: string;
	readonly options: ExportOptimizationOptions;
	readonly componentPropSchema: readonly ComponentPropsExportResult["schema"][number][];
}): string =>
	createRuntimeReactComponentContents({
		runtimeFileName,
		sourceExpression:
			options.runtimePackaging === "embedded"
				? '{ kind: "embedded" as const }'
				: `{ kind: "url" as const, url: new URL("./${dataFileName}", import.meta.url) }`,
		ariaLabel: `${sceneName} motion`,
		propsModel: { kind: "named", fields: componentPropSchema },
	});

const createMotionCodeRuntimePayload = ({
	bundle,
	grammarBindings,
	options,
	assetFileNames,
}: {
	readonly bundle: ExportBundle;
	readonly grammarBindings: readonly MotionGrammarBinding[];
	readonly options: ExportOptimizationOptions;
	readonly assetFileNames: readonly string[];
}): MotionCodeRuntimePayload => {
	const sceneAsset = assetByKind(bundle, "scene-json");
	const motionAsset = assetByKind(bundle, "motion-json");
	if (!sceneAsset || !motionAsset) {
		throw new Error("Motion/code export requires scene and motion JSON.");
	}
	const sourceScene = JSON.parse(sceneAsset.contents) as SceneDocument;
	const sourceMotion = JSON.parse(motionAsset.contents) as MotionDocument;
	const runtimeProjection = projectExportRuntimeData({
		scene: sourceScene,
		motion: sourceMotion,
		grammarBindings,
		options,
	});
	const programSurfaceProjection = projectProgramSurfacesForMotionCode(
		runtimeProjection.scene,
	);
	const projected = {
		...runtimeProjection,
		scene: programSurfaceProjection.scene,
	};
	const supportAssets = motionCodeSupportAssets(bundle, options);
	const baseManifest = motionCodeManifest(bundle, supportAssets, options);
	const effectCapabilities =
		isRecord(baseManifest) &&
		"effectCapabilities" in baseManifest &&
		baseManifest.effectCapabilities !== undefined
			? (baseManifest.effectCapabilities as ExportEffectCapabilitiesManifest)
			: undefined;
	const sceneSequence =
		isRecord(baseManifest) &&
		"sceneSequence" in baseManifest &&
		baseManifest.sceneSequence !== undefined
			? (baseManifest.sceneSequence as ExportSceneSequenceManifest)
			: bundle.sceneSequence;
	const recipes = jsonAssetsByKind(bundle, "recipe-json", options);
	const animationSequences = jsonAssetsByKind(
		bundle,
		"animation-sequence-json",
		options,
	);
	// Target survival and animated-conflict checks use the PROJECTED scene and
	// motion so drops match this exact payload. Competing-owner checks use the
	// unprojected source scene, where component override metadata still exists.
	// See `buildComponentPropsExport`'s JSDoc.
	const componentPropOwnership = {
		componentProps: sourceScene.componentProps,
		layers: sourceScene.layers,
		nativeExpressionBindings: sourceScene.nativeExpressionBindings,
		grammarTargetNodeIds: new Set(
			projected.grammarBindings.flatMap((binding) => binding.targetIds),
		),
	};
	const componentProps = buildComponentPropsExport(
		projected.scene,
		projected.motion,
		componentPropOwnership,
	);
	// Diagnostic manifest (contractVersion 1): support/pruning uses the
	// PROJECTED scene while competing-owner checks use the source scene. Unlike
	// `effectCapabilities` (sourced from profile-invariant
	// recipe payloads at the `bundle.ts` level), a componentProps manifest's
	// `supported`/pruning IS profile-sensitive (a hidden node this profile
	// drops changes a binding's `supported` flag), so it cannot be attached at
	// `bundle.ts`'s unprojected-scene manifest layer without risking
	// divergence from what THIS payload ships. Merged into `manifest` here,
	// gated on `includeFullManifest` the same as `effectCapabilities` is
	// (`motionCodeManifest` already ran `projectRuntimeManifest`'s Web
	// Embed/Production compaction above, so merging unconditionally would
	// silently bypass that compaction for compact profiles).
	const componentPropsManifest = buildComponentPropsManifest(
		projected.scene,
		projected.motion,
		componentPropOwnership,
	);
	// Interactive Motion (T3-S2): resolved against the SAME projected
	// scene/motion as componentProps above (component-prop names the
	// interaction export gate resolves set-prop actions against come from
	// projected.scene.componentProps, and play-clip/toggle-clip clipIds
	// resolve against projected.motion.clips), so a dropped/surviving
	// interaction always matches what this exact payload ships.
	const interactionsResult = buildInteractionsExport(projected.scene, {
		clips: projected.motion.clips,
	});
	// Diagnostic manifest (contractVersion 1), gated on includeFullManifest
	// the same as componentPropsManifest just above — one row per SURVIVING
	// interaction (buildInteractionsManifest internally re-derives survivors
	// from the SAME buildInteractionsExport call this file already ran, so
	// the manifest can never list an interaction the payload's own
	// `interactions` block dropped).
	const interactionsManifest = buildInteractionsManifest(projected.scene, {
		clips: projected.motion.clips,
	});
	const manifest = isRecord(baseManifest)
		? {
				...baseManifest,
				...(programSurfaceProjection.manifest
					? { programSurfaceDelivery: programSurfaceProjection.manifest }
					: {}),
				...(options.includeFullManifest && componentPropsManifest.propCount > 0
					? { componentProps: componentPropsManifest }
					: {}),
				...(options.includeFullManifest &&
				interactionsManifest.interactionCount > 0
					? { interactions: interactionsManifest }
					: {}),
			}
		: baseManifest;
	return {
		exportFormat: MOTION_CODE_RUNTIME_FORMAT,
		manifest,
		...(effectCapabilities && options.includeFullManifest
			? { effectCapabilities }
			: {}),
		scene: projected.scene,
		motion: projected.motion,
		...(projected.grammarBindings.length > 0 || options.includeFullManifest
			? { grammarBindings: projected.grammarBindings }
			: {}),
		...(recipes.length > 0 || options.includeFullManifest ? { recipes } : {}),
		...(animationSequences.length > 0 || options.includeFullManifest
			? { animationSequences }
			: {}),
		...(sceneSequence ? { sceneSequence } : {}),
		...(programSurfaceProjection.manifest
			? { programSurfaceDelivery: programSurfaceProjection.manifest }
			: {}),
		...(componentProps.schema.length > 0 ? { componentProps } : {}),
		...(interactionsResult.interactions.length > 0
			? { interactions: interactionsResult.interactions }
			: {}),
		...(options.includeFullManifest ? { assetFileNames } : {}),
	};
};

/**
 * Builds an executable ES module payload for developer handoff exports.
 *
 * The module intentionally embeds the canonical scene/motion JSON outputs rather
 * than inventing a second runtime schema. Consumers can import the module, read
 * `scene`, `motion`, and `manifest`, then choose their own renderer or adapter.
 */
export function createMotionCodeRuntimeAsset(
	bundle: ExportBundle,
	grammarBindings: readonly MotionGrammarBinding[] = [],
	optionsInput: MotionCodeExportOptions = {},
): MotionCodeRuntimeAsset {
	const options =
		optionsInput.optimization ??
		exportOptimizationOptionsForProfile("editable");
	const preferCoreRuntime = exportPrefersCoreRuntime(
		bundle,
		grammarBindings,
		options,
	);
	// Only the motion-artifact profile picks a tier narrower than FULL/CORE;
	// every other embedded profile keeps the `embedded -> always FULL` gate
	// (preferCoreRuntime is always false for embedded packaging otherwise, so
	// this maps to "full" for them, matching prior behavior exactly).
	const tier: RuntimeSamplerTier =
		options.profile === "motion-artifact"
			? selectMotionArtifactRuntimeSamplerTier(bundle, grammarBindings)
			: preferCoreRuntime
				? "core"
				: "full";
	const stem = stemFromBundle(bundle);
	const runtimeFileName = `${stem}.runtime.js`;
	if (options.runtimePackaging !== "embedded") {
		return {
			kind: "runtime-js",
			fileName: runtimeFileName,
			mimeType: RUNTIME_JS_MIME_TYPE,
			issues: [],
			contents: runtimeOnlyContents(options, preferCoreRuntime),
		};
	}
	const supportAssets = motionCodeSupportAssets(bundle, options);
	const payload = createMotionCodeRuntimePayload({
		bundle,
		grammarBindings,
		options,
		assetFileNames: [
			...supportAssets.map((asset) => asset.fileName),
			...motionCodeGeneratedFileNames(stem, options),
		],
	});
	const serialized = stableJsonStringify(
		payload,
		stableJsonOptionsForExport(options),
	).trim();
	const paletteManifest = buildPaletteManifest(payload);
	const header = options.includeDebugComments
		? [
				"// Generated by vector-motion-author. The embedded JSON remains the source of truth.",
				"// The motion sampler below (assigned to __vectorMotionRuntimeSampler) is the",
				"// SAME pure code the editor and in-app SVG/PDF export use, bundled here so the",
				"// standalone runtime reproduces every motion-grammar technique without drift.",
			]
		: ["// Generated by vector-motion-author."];
	// Re-parsed independently rather than threaded out of
	// createMotionCodeRuntimePayload (same pattern as selectMotionArtifactRuntimeSamplerTier's
	// own sceneFromBundle call above) — guaranteed non-null here since
	// createMotionCodeRuntimePayload already parsed the same scene-json asset
	// successfully to build `payload`.
	const sourceSceneForPlayerAssembly = sceneFromBundle(bundle);
	return {
		kind: "runtime-js",
		fileName: runtimeFileName,
		mimeType: RUNTIME_JS_MIME_TYPE,
		issues: payload.programSurfaceDelivery?.issues ?? [],
		contents: [
			...header,
			runtimeSamplerSourceForTier(tier),
			`export const vectorMotionExport = ${serialized};`,
			"export const scene = vectorMotionExport.scene;",
			"export const motion = vectorMotionExport.motion;",
			"export const grammarBindings = vectorMotionExport.grammarBindings ?? [];",
			"export const manifest = vectorMotionExport.manifest;",
			"export const effectCapabilities = vectorMotionExport.effectCapabilities ?? vectorMotionExport.manifest?.effectCapabilities;",
			"export const recipes = vectorMotionExport.recipes ?? [];",
			"export const animationSequences = vectorMotionExport.animationSequences ?? [];",
			"export const sceneSequence = vectorMotionExport.sceneSequence ?? vectorMotionExport.manifest?.sceneSequence;",
			"export const programSurfaceDelivery = vectorMotionExport.programSurfaceDelivery;",
			"export const motionRuntime = __vectorMotionRuntimeSampler;",
			`export const paletteManifest = ${JSON.stringify(paletteManifest)};`,
			runtimePlayerSourceForProfile(options.profile, {
				// Same predicate `selectMotionArtifactRuntimeSamplerTier` uses to
				// bump the sampler to CORE, so the player and its paired sampler
				// bundle can never disagree about whether this export has a live
				// interaction engine (see `motionArtifactPlayerSource`'s doc
				// comment). Irrelevant for every other profile (always the full
				// player regardless of these flags). Fails toward INCLUDING the
				// section (never omit on uncertainty) in the structurally
				// unreachable case where the scene fails to re-parse here.
				hasAuthoredInteractions: sourceSceneForPlayerAssembly
					? sceneHasAuthoredInteractions(sourceSceneForPlayerAssembly)
					: true,
				// The exact field `componentPropSchema`/`installComponentPropsApi`
				// read at runtime (`state.payload.componentProps?.schema`) — omitted
				// entirely from `payload` when the document defines no component
				// props (see `MotionCodeRuntimePayload.componentProps`'s own doc
				// comment), so this is the authoritative "does the shipped payload
				// actually have props" signal, not a re-derived approximation.
				hasComponentProps: (payload.componentProps?.schema?.length ?? 0) > 0,
			}).trim(),
			"export default vectorMotionExport;",
			"",
		].join("\n"),
	};
}

/** Creates the data-only payload consumed by split-data and shared runtime modules. */
export function createMotionCodeDataAsset(
	bundle: ExportBundle,
	grammarBindings: readonly MotionGrammarBinding[] = [],
	optionsInput: MotionCodeExportOptions = {},
): MotionCodeDataAsset {
	const options =
		optionsInput.optimization ??
		exportOptimizationOptionsForProfile("web-embed");
	const stem = stemFromBundle(bundle);
	const supportAssets = motionCodeSupportAssets(bundle, options);
	const payload = createMotionCodeRuntimePayload({
		bundle,
		grammarBindings,
		options,
		assetFileNames: [
			...supportAssets.map((asset) => asset.fileName),
			...motionCodeGeneratedFileNames(stem, options),
		],
	});
	return {
		kind: "runtime-data-json",
		fileName: motionCodeDataFileName(stem),
		mimeType: RUNTIME_DATA_MIME_TYPE,
		issues: payload.programSurfaceDelivery?.issues ?? [],
		contents: stableJsonStringify(payload, stableJsonOptionsForExport(options)),
	};
}

/** Creates the framework-independent runtime shared by production payloads. */
export function createMotionCodeSharedRuntimeAsset(
	optionsInput: MotionCodeExportOptions = {},
	preferCoreRuntime = false,
): MotionCodeSharedRuntimeAsset {
	const options =
		optionsInput.optimization ??
		exportOptimizationOptionsForProfile("production");
	return {
		kind: "runtime-shared-js",
		fileName: SHARED_RUNTIME_FILE_NAME,
		mimeType: RUNTIME_JS_MIME_TYPE,
		contents: runtimeOnlyContents(options, preferCoreRuntime),
	};
}

export function createMotionCodeHtmlAsset(
	bundle: ExportBundle,
	optionsInput: MotionCodeExportOptions = {},
): MotionCodeHtmlAsset {
	const options =
		optionsInput.optimization ??
		exportOptimizationOptionsForProfile("editable");
	const stem = stemFromBundle(bundle);
	const runtimeFileName = motionCodeRuntimeFileName(stem, options);
	const sceneName = sceneNameFromBundle(bundle);
	return {
		kind: "runtime-html",
		fileName: `${stem}.html`,
		mimeType: RUNTIME_HTML_MIME_TYPE,
		contents: runtimeHtmlContents({
			runtimeFileName,
			...(options.runtimePackaging === "embedded"
				? {}
				: { dataFileName: motionCodeDataFileName(stem) }),
			sceneName,
			options,
		}),
	};
}

export function createMotionCodeReactAsset(
	bundle: ExportBundle,
	optionsInput: MotionCodeExportOptions = {},
	grammarBindings?: readonly MotionGrammarBinding[],
): MotionCodeReactAsset {
	const options =
		optionsInput.optimization ??
		exportOptimizationOptionsForProfile("editable");
	const stem = stemFromBundle(bundle);
	const runtimeFileName = motionCodeRuntimeFileName(stem, options);
	return {
		kind: "runtime-react",
		fileName: `${stem}.react.tsx`,
		mimeType: RUNTIME_REACT_MIME_TYPE,
		contents: reactComponentContents({
			runtimeFileName,
			...(options.runtimePackaging === "embedded"
				? {}
				: { dataFileName: motionCodeDataFileName(stem) }),
			sceneName: sceneNameFromBundle(bundle),
			options,
			componentPropSchema: componentPropsExportResultFromBundle(
				bundle,
				options,
				grammarBindings,
			).schema,
		}),
	};
}

export function createMotionCodeRuntimeTypesAsset(
	bundle: ExportBundle,
	optionsInput: MotionCodeExportOptions = {},
): RuntimeTypesAsset {
	const options =
		optionsInput.optimization ??
		exportOptimizationOptionsForProfile("editable");
	const runtimeFileName = motionCodeRuntimeFileName(
		stemFromBundle(bundle),
		options,
	);
	const isMotionArtifact = options.profile === "motion-artifact";
	// Only computed for motion-artifact: every other profile's .d.ts always
	// declares the full VectorMotionPlayer surface regardless of scene
	// content, matching its runtime.js (which always embeds every
	// capability unconditionally — see `motionArtifactPlayerSource`'s doc
	// comment for why only this profile varies by scene).
	const scene = isMotionArtifact ? sceneFromBundle(bundle) : null;
	return createRuntimeTypesAsset({
		runtimeFileName,
		renderer: "svg",
		shared: options.runtimePackaging === "shared-runtime",
		embedded: options.runtimePackaging === "embedded",
		includeUrlLoader: !isMotionArtifact,
		includeStandaloneRenderSurface: !isMotionArtifact,
		includeComponentPropsApi:
			!isMotionArtifact ||
			componentPropsExportResultFromBundle(bundle, options).schema.length > 0,
		includeInteractionsSurface:
			!isMotionArtifact || (scene ? sceneHasAuthoredInteractions(scene) : true),
	});
}

/** Creates the file map consumed by hosts that package split/shared runtime exports. */
export function createMotionCodeRuntimeManifestAsset(
	bundle: ExportBundle,
	optionsInput: MotionCodeExportOptions = {},
): RuntimeAssetManifestAsset {
	const options =
		optionsInput.optimization ??
		exportOptimizationOptionsForProfile("editable");
	const stem = stemFromBundle(bundle);
	const supportAssets = motionCodeSupportAssets(bundle, options);
	const hasSceneSequence = bundleHasSceneSequence(bundle);
	return createRuntimeAssetManifestAsset({
		fileName: motionCodeRuntimeManifestFileName(stem),
		runtimeFormat: MOTION_CODE_RUNTIME_FORMAT,
		renderer: "motion-code-svg",
		options,
		files: {
			runtimeFileName: motionCodeRuntimeFileName(stem, options),
			typesFileName: runtimeTypesFileName(
				motionCodeRuntimeFileName(stem, options),
			),
			...(options.runtimePackaging === "embedded"
				? {}
				: { dataFileName: motionCodeDataFileName(stem) }),
			htmlFileName: `${stem}.html`,
			...(options.includeReactWrapper
				? { reactFileName: `${stem}.react.tsx` }
				: {}),
			supportFileNames: supportAssets.map((asset) => asset.fileName),
		},
		entrypoints: {
			mountExport: "mountVectorMotion",
			...(options.runtimePackaging === "embedded"
				? {}
				: { dataLoaderExport: "loadVectorMotionPayload" }),
		},
		sceneSequence: hasSceneSequence,
	});
}

/**
 * Selects the bundle assets that belong to motion/code handoff and appends the
 * runtime module. PDF/raster intent assets stay out of this mode because they
 * are print/raster planning outputs rather than reusable motion/code payloads.
 */
export function createMotionCodeExportAssets(
	bundle: ExportBundle,
	grammarBindings: readonly MotionGrammarBinding[] = [],
	optionsInput: MotionCodeExportOptions = {},
): readonly MotionCodeExportAsset[] {
	const options =
		optionsInput.optimization ??
		exportOptimizationOptionsForProfile("editable");
	const preferCoreRuntime = exportPrefersCoreRuntime(
		bundle,
		grammarBindings,
		options,
	);
	const runtimeAssets =
		options.runtimePackaging === "embedded"
			? [
					createMotionCodeRuntimeAsset(bundle, grammarBindings, {
						optimization: options,
					}),
				]
			: [
					...(options.runtimePackaging === "shared-runtime"
						? [
								createMotionCodeSharedRuntimeAsset(
									{ optimization: options },
									preferCoreRuntime,
								),
							]
						: [
								createMotionCodeRuntimeAsset(bundle, grammarBindings, {
									optimization: options,
								}),
							]),
					createMotionCodeDataAsset(bundle, grammarBindings, {
						optimization: options,
					}),
				];
	return [
		...motionCodeSupportAssets(bundle, options),
		...runtimeAssets,
		createMotionCodeRuntimeTypesAsset(bundle, { optimization: options }),
		createMotionCodeHtmlAsset(bundle, { optimization: options }),
		...(options.includeReactWrapper
			? [
					createMotionCodeReactAsset(
						bundle,
						{ optimization: options },
						grammarBindings,
					),
				]
			: []),
		createMotionCodeRuntimeManifestAsset(bundle, {
			optimization: options,
		}),
	];
}

/**
 * Creates the motion-artifact profile's embedded runtime asset together with
 * its F4 budget report (`motion-artifact-budget.ts`). A separate async
 * function rather than a field on {@link MotionCodeRuntimeAsset} itself: gzip
 * measurement is inherently async (`CompressionStream` streams), while
 * `createMotionCodeRuntimeAsset`/`createMotionCodeExportAssets` stay
 * synchronous for their existing callers (`widgets/top-bar/ui/TopBar.tsx`).
 * Model-level only — no UI wiring.
 */
export async function createMotionArtifactRuntimeAssetWithBudget(
	bundle: ExportBundle,
	grammarBindings: readonly MotionGrammarBinding[] = [],
): Promise<{
	readonly asset: MotionCodeRuntimeAsset;
	readonly budget: MotionArtifactBudgetReport;
}> {
	const asset = createMotionCodeRuntimeAsset(bundle, grammarBindings, {
		optimization: exportOptimizationOptionsForProfile("motion-artifact"),
	});
	const budget = await createMotionArtifactBudgetReport(asset.contents);
	return { asset, budget };
}
