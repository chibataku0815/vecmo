import type { MotionDocument } from "@/entities/motion/model/types";
import { motionExpressionBindingState } from "@/entities/motion-grammar/model/expression-registry";
import type { MotionGrammarBinding } from "@/entities/motion-grammar/model/types";
import {
	validateVersionedMotionExpressionBinding,
	versionedMotionExpressionRoleMapContract,
} from "@/entities/motion-grammar/model/versioned-expression-binding";
import type {
	SceneAsset,
	SceneDocument,
	SceneLayer,
	VectorNode,
} from "@/entities/scene/model/types";
import type { ExportBundleAsset } from "./bundle";
import type { StableJsonStringifyOptions } from "./json";
import {
	type ExportMotionGrammarFidelityIssue,
	invalidVersionedMotionGrammarBindingIssue,
	prunedVersionedMotionGrammarBindingIssue,
	unsupportedVersionedMotionGrammarBindingIssue,
} from "./motion-grammar-fidelity";

/** User-facing intent presets for generated runtime/code payloads. */
export type ExportOptimizationProfile =
	| "editable"
	| "web-embed"
	| "production"
	| "debug"
	| "motion-artifact";

/** Packaging shape for generated runtime code and its scene/motion data. */
export type ExportRuntimePackaging =
	| "embedded"
	| "split-data"
	| "shared-runtime";

/** Concrete export knobs derived from a profile before asset generation starts. */
export type ExportOptimizationOptions = {
	readonly profile: ExportOptimizationProfile;
	readonly runtimePackaging: ExportRuntimePackaging;
	readonly numericPrecision: number;
	readonly includeHiddenLayers: boolean;
	readonly includeEditorMetadata: boolean;
	readonly includeFullManifest: boolean;
	readonly includeReactWrapper: boolean;
	readonly includeDebugComments: boolean;
	readonly includeFrameSequenceData: boolean;
	readonly includeRuntimeNames: boolean;
};

/** Byte and projection summary produced by an optimization pass. */
export type ExportOptimizationReport = {
	readonly profile: ExportOptimizationProfile;
	readonly runtimePackaging: ExportRuntimePackaging;
	readonly beforeBytes: number;
	readonly afterBytes: number;
	readonly savedBytes: number;
	readonly savedRatio: number;
	readonly droppedHiddenLayerCount: number;
	readonly droppedHiddenNodeCount: number;
	readonly droppedMetadataFieldCount: number;
	readonly roundedNumberCount: number;
	readonly splitAssetCount: number;
	readonly warnings: readonly string[];
};

/** Internal counters accumulated while projecting runtime payload data. */
export type ProjectionStats = {
	droppedHiddenLayerCount: number;
	droppedHiddenNodeCount: number;
	droppedMetadataFieldCount: number;
	roundedNumberCount: number;
};

type ProjectExportRuntimeDataInput = {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly grammarBindings: readonly MotionGrammarBinding[];
	readonly options: ExportOptimizationOptions;
};

/** Scene/motion/grammar payload after export-only pruning and numeric rounding. */
export type ProjectedExportRuntimeData = {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly grammarBindings: readonly MotionGrammarBinding[];
	/** Source-free degradations caused while preparing this runtime payload. */
	readonly grammarFidelityIssues: readonly ExportMotionGrammarFidelityIssue[];
	readonly stats: ProjectionStats;
};

/** Grammar projection plus any relation that could not remain semantically valid. */
export type ProjectedGrammarBindingsForExport = {
	readonly bindings: readonly MotionGrammarBinding[];
	readonly fidelityIssues: readonly ExportMotionGrammarFidelityIssue[];
};

const encoder = new TextEncoder();

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const exportOptimizationProfileDefaults: Readonly<
	Record<ExportOptimizationProfile, ExportOptimizationOptions>
> = {
	editable: {
		profile: "editable",
		runtimePackaging: "embedded",
		numericPrecision: 6,
		includeHiddenLayers: true,
		includeEditorMetadata: true,
		includeFullManifest: true,
		includeReactWrapper: true,
		includeDebugComments: true,
		includeFrameSequenceData: true,
		includeRuntimeNames: true,
	},
	"web-embed": {
		profile: "web-embed",
		runtimePackaging: "split-data",
		numericPrecision: 4,
		includeHiddenLayers: false,
		includeEditorMetadata: false,
		includeFullManifest: false,
		includeReactWrapper: true,
		includeDebugComments: false,
		includeFrameSequenceData: false,
		includeRuntimeNames: true,
	},
	production: {
		profile: "production",
		runtimePackaging: "shared-runtime",
		numericPrecision: 3,
		includeHiddenLayers: false,
		includeEditorMetadata: false,
		includeFullManifest: false,
		includeReactWrapper: false,
		includeDebugComments: false,
		includeFrameSequenceData: false,
		includeRuntimeNames: false,
	},
	debug: {
		profile: "debug",
		runtimePackaging: "embedded",
		numericPrecision: 6,
		includeHiddenLayers: true,
		includeEditorMetadata: true,
		includeFullManifest: true,
		includeReactWrapper: true,
		includeDebugComments: true,
		includeFrameSequenceData: true,
		includeRuntimeNames: true,
	},
	// Same projection as `production` (numericPrecision 3, hidden layers/editor
	// metadata/debug comments/frame-sequence data stripped) but packaged as one
	// self-contained embedded file rather than a shared runtime + split data
	// file, for the Embeddable Motion Artifact handoff. This is the only
	// profile whose embedded runtime picks a sampler tier narrower than FULL
	// (see `code.ts`'s motion-artifact tier selection) — every other embedded
	// profile keeps the `embedded -> always FULL` gate.
	"motion-artifact": {
		profile: "motion-artifact",
		runtimePackaging: "embedded",
		numericPrecision: 3,
		includeHiddenLayers: false,
		includeEditorMetadata: false,
		includeFullManifest: false,
		includeReactWrapper: false,
		includeDebugComments: false,
		includeFrameSequenceData: false,
		includeRuntimeNames: false,
	},
};

export const exportOptimizationProfileLabel: Readonly<
	Record<ExportOptimizationProfile, string>
> = {
	editable: "Editable",
	"web-embed": "Web Embed",
	production: "Production",
	debug: "Debug",
	"motion-artifact": "Motion Artifact",
};

export const exportOptimizationProfileDescription: Readonly<
	Record<ExportOptimizationProfile, string>
> = {
	editable: "full handoff bundle",
	"web-embed": "compact web runtime",
	production: "smallest runtime bundle",
	debug: "readable diagnostic bundle",
	"motion-artifact": "self-contained embeddable artifact",
};

/** Returns the immutable default knobs for a user-facing export profile. */
export function exportOptimizationOptionsForProfile(
	profile: ExportOptimizationProfile,
	overrides: Partial<ExportOptimizationOptions> = {},
): ExportOptimizationOptions {
	return {
		...exportOptimizationProfileDefaults[profile],
		...overrides,
		profile,
	};
}

/** Chooses byte-stable pretty or compact JSON formatting for an export profile. */
export function stableJsonOptionsForExport(
	options: ExportOptimizationOptions,
): StableJsonStringifyOptions {
	return {
		pretty: options.profile === "editable" || options.profile === "debug",
	};
}

/** Measures UTF-8 output bytes, matching what the browser download writes. */
export function exportAssetByteLength(asset: {
	readonly contents: string;
}): number {
	return encoder.encode(asset.contents).byteLength;
}

/** Sums UTF-8 bytes for a generated asset collection. */
export function measureExportAssets(
	assets: readonly { readonly contents: string }[],
): number {
	return assets.reduce(
		(total, asset) => total + exportAssetByteLength(asset),
		0,
	);
}

const createStats = (): ProjectionStats => ({
	droppedHiddenLayerCount: 0,
	droppedHiddenNodeCount: 0,
	droppedMetadataFieldCount: 0,
	roundedNumberCount: 0,
});

const countNodes = (nodes: readonly VectorNode[]): number =>
	nodes.reduce((total, node) => total + 1 + countNodes(node.children ?? []), 0);

const deleteExportMetadataField = (
	output: Record<string, unknown>,
	key: string,
	stats: ProjectionStats,
): void => {
	if (!(key in output)) return;
	delete output[key];
	stats.droppedMetadataFieldCount += 1;
};

const roundNumber = (
	value: number,
	precision: number,
	stats: ProjectionStats,
): number => {
	if (!Number.isFinite(value)) return value;
	const factor = 10 ** precision;
	const rounded = Math.round(value * factor) / factor;
	const normalized = Object.is(rounded, -0) ? 0 : rounded;
	if (normalized !== value || Object.is(value, -0))
		stats.roundedNumberCount += 1;
	return normalized;
};

// Keys whose numeric value is NOT pixel-scale display geometry and must never be
// quantized: `seed` is a discrete permutation input (the grammar evaluator hashes
// String(seed), so a rounded fractional seed changes the exported fire-order), and
// `offset` is a normalized [0,1] ramp coordinate (rounding can collapse two
// near-adjacent gradient stops onto one offset, erasing a hard color band).
const ROUND_EXEMPT_KEYS = new Set<string>(["seed", "offset"]);

const AFFINE_MATRIX_KEYS = ["a", "b", "c", "d", "e", "f"] as const;
// The a/b/c/d coefficients of an affine paint transform carry rotation/scale as
// sub-unit fractions whose error is amplified by paint-coordinate magnitude; the
// e/f translate terms stay at coordinate scale and round normally.
const PRESERVED_AFFINE_COEFFICIENT_KEYS = new Set<string>(["a", "b", "c", "d"]);

const isAffineMatrixRecord = (value: Record<string, unknown>): boolean =>
	AFFINE_MATRIX_KEYS.every((key) => typeof value[key] === "number");

const roundUnknown = (
	value: unknown,
	precision: number,
	stats: ProjectionStats,
	key?: string,
): unknown => {
	if (typeof value === "number") {
		if (key !== undefined && ROUND_EXEMPT_KEYS.has(key)) return value;
		return roundNumber(value, precision, stats);
	}
	if (Array.isArray(value)) {
		return value.map((entry) => roundUnknown(entry, precision, stats, key));
	}
	if (!isRecord(value)) return value;
	const preserveCoefficients = isAffineMatrixRecord(value);
	const output: Record<string, unknown> = {};
	for (const [entryKey, entry] of Object.entries(value)) {
		if (entry === undefined) continue;
		if (
			preserveCoefficients &&
			PRESERVED_AFFINE_COEFFICIENT_KEYS.has(entryKey)
		) {
			output[entryKey] = entry;
			continue;
		}
		output[entryKey] = roundUnknown(entry, precision, stats, entryKey);
	}
	return output;
};

const collectAssetIds = (value: unknown, assetIds: Set<string>): void => {
	if (Array.isArray(value)) {
		for (const entry of value) collectAssetIds(entry, assetIds);
		return;
	}
	if (!isRecord(value)) return;
	for (const [key, entry] of Object.entries(value)) {
		if (key === "assetId" && typeof entry === "string") {
			assetIds.add(entry);
			continue;
		}
		collectAssetIds(entry, assetIds);
	}
};

const visibleNodeIds = (
	nodes: readonly VectorNode[],
	ids: Set<string>,
): void => {
	for (const node of nodes) {
		ids.add(node.id);
		visibleNodeIds(node.children ?? [], ids);
	}
};

const nodeIdsForLayers = (
	layers: readonly SceneLayer[],
): ReadonlySet<string> => {
	const ids = new Set<string>();
	for (const layer of layers) visibleNodeIds(layer.nodes, ids);
	return ids;
};

const pruneNode = (
	node: VectorNode,
	options: ExportOptimizationOptions,
	stats: ProjectionStats,
): VectorNode | null => {
	if (!options.includeHiddenLayers && !node.visible) {
		stats.droppedHiddenNodeCount += 1 + countNodes(node.children ?? []);
		return null;
	}
	const children = (node.children ?? [])
		.map((child) => pruneNode(child, options, stats))
		.filter((child): child is VectorNode => child !== null);
	const output: Record<string, unknown> = { ...node };
	if (children.length > 0) output.children = children;
	else delete output.children;
	if (!options.includeEditorMetadata) {
		deleteExportMetadataField(output, "data", stats);
		deleteExportMetadataField(output, "locked", stats);
		deleteExportMetadataField(output, "component", stats);
	}
	if (!options.includeRuntimeNames) {
		deleteExportMetadataField(output, "name", stats);
	}
	return output as VectorNode;
};

const pruneLayer = (
	layer: SceneLayer,
	options: ExportOptimizationOptions,
	stats: ProjectionStats,
): SceneLayer | null => {
	if (!options.includeHiddenLayers && !layer.visible) {
		stats.droppedHiddenLayerCount += 1;
		stats.droppedHiddenNodeCount += countNodes(layer.nodes);
		return null;
	}
	const output: Record<string, unknown> = {
		...layer,
		nodes: layer.nodes
			.map((node) => pruneNode(node, options, stats))
			.filter((node): node is VectorNode => node !== null),
	};
	if (!options.includeEditorMetadata) {
		deleteExportMetadataField(output, "locked", stats);
	}
	if (!options.includeRuntimeNames) {
		deleteExportMetadataField(output, "name", stats);
	}
	return output as SceneLayer;
};

const pruneAssets = (
	scene: SceneDocument,
	assets: readonly SceneAsset[] | undefined,
	layers: readonly SceneLayer[],
	options: ExportOptimizationOptions,
): readonly SceneAsset[] | undefined => {
	if (options.includeEditorMetadata || !assets) return assets;
	const assetIds = new Set<string>();
	collectAssetIds(layers, assetIds);
	collectAssetIds(scene.artboard, assetIds);
	collectAssetIds(scene.artboards, assetIds);
	collectAssetIds(scene.effectIntent, assetIds);
	return assets.filter((asset) => assetIds.has(asset.id));
};

const projectArtboardForExport = (
	artboard: SceneDocument["artboard"],
	options: ExportOptimizationOptions,
	stats: ProjectionStats,
): SceneDocument["artboard"] => {
	const output: Record<string, unknown> = { ...artboard };
	if (!options.includeRuntimeNames) {
		deleteExportMetadataField(output, "name", stats);
	}
	return output as SceneDocument["artboard"];
};

/**
 * Builds the scene payload used by generated runtimes without mutating the live
 * editor document. Production profiles remove hidden content and editor-only
 * metadata, then round serialized numeric values.
 */
export function projectSceneForExport(
	scene: SceneDocument,
	options: ExportOptimizationOptions,
	stats: ProjectionStats = createStats(),
): SceneDocument {
	const layers = scene.layers
		.map((layer) => pruneLayer(layer, options, stats))
		.filter((layer): layer is SceneLayer => layer !== null);
	const output: Record<string, unknown> = {
		...scene,
		artboard: projectArtboardForExport(scene.artboard, options, stats),
		...(scene.artboards
			? {
					artboards: scene.artboards.map((artboard) =>
						projectArtboardForExport(artboard, options, stats),
					),
				}
			: {}),
		layers,
	};
	const assets = pruneAssets(scene, scene.assets, layers, options);
	if (assets && assets.length > 0) output.assets = assets;
	else if (!options.includeEditorMetadata) {
		deleteExportMetadataField(output, "assets", stats);
	}
	if (!options.includeRuntimeNames) {
		deleteExportMetadataField(output, "name", stats);
	}
	if (!options.includeEditorMetadata) {
		const nodeIds = nodeIdsForLayers(layers);
		if (scene.effectExpressionBindings) {
			const bindings = scene.effectExpressionBindings.filter(
				(binding) =>
					binding.targetRef.kind !== "node" ||
					nodeIds.has(binding.targetRef.nodeId),
			);
			if (bindings.length > 0) output.effectExpressionBindings = bindings;
			else deleteExportMetadataField(output, "effectExpressionBindings", stats);
			stats.droppedMetadataFieldCount +=
				scene.effectExpressionBindings.length - bindings.length;
		}
		if (scene.nativeExpressionBindings) {
			const bindings = scene.nativeExpressionBindings.filter((binding) =>
				nodeIds.has(binding.nodeId),
			);
			if (bindings.length > 0) output.nativeExpressionBindings = bindings;
			else deleteExportMetadataField(output, "nativeExpressionBindings", stats);
			stats.droppedMetadataFieldCount +=
				scene.nativeExpressionBindings.length - bindings.length;
		}
		if (scene.duplicateGenerators) {
			const bindings = scene.duplicateGenerators.filter((binding) =>
				nodeIds.has(binding.sourceNodeId),
			);
			if (bindings.length > 0) output.duplicateGenerators = bindings;
			else deleteExportMetadataField(output, "duplicateGenerators", stats);
			stats.droppedMetadataFieldCount +=
				scene.duplicateGenerators.length - bindings.length;
		}
		deleteExportMetadataField(output, "stylePresets", stats);
		deleteExportMetadataField(output, "componentSymbols", stats);
	}
	return roundUnknown(output, options.numericPrecision, stats) as SceneDocument;
}

const projectClipTrackIds = (
	trackIds: readonly string[],
	remainingTrackIds: ReadonlySet<string>,
): readonly string[] =>
	trackIds.filter((trackId) => remainingTrackIds.has(trackId));

const projectMotionRecordForRuntime = <Value extends object>(
	value: Value,
	options: ExportOptimizationOptions,
	stats: ProjectionStats,
): Value => {
	const output: Record<string, unknown> = {
		...(value as Record<string, unknown>),
	};
	if (!options.includeRuntimeNames) {
		deleteExportMetadataField(output, "name", stats);
	}
	return output as Value;
};

const clipCarriesRuntimeGrammarWindow = (clip: {
	readonly provenance?: { readonly bindingId?: string };
}): boolean => typeof clip.provenance?.bindingId === "string";

/**
 * Builds the motion payload paired with a projected scene, pruning tracks whose
 * target nodes are no longer present in the runtime scene. The raw persisted
 * grammar sidecar is always removed: runtime playback consumes the separately
 * projected rich bindings, never forward-compatible authoring payload bytes.
 */
export function projectMotionForExport(
	motion: MotionDocument,
	visibleNodeIdSet: ReadonlySet<string>,
	options: ExportOptimizationOptions,
	stats: ProjectionStats = createStats(),
): MotionDocument {
	if (options.includeHiddenLayers) {
		const output: Record<string, unknown> = { ...motion };
		deleteExportMetadataField(output, "grammar", stats);
		return roundUnknown(
			output,
			options.numericPrecision,
			stats,
		) as MotionDocument;
	}
	const tracks = motion.tracks.filter((track) =>
		visibleNodeIdSet.has(track.target.nodeId),
	);
	const remainingTrackIds = new Set(tracks.map((track) => track.id));
	const clips = motion.clips
		.map((clip) =>
			projectMotionRecordForRuntime(
				{
					...clip,
					trackIds: projectClipTrackIds(clip.trackIds, remainingTrackIds),
				},
				options,
				stats,
			),
		)
		.filter(
			(clip) =>
				clip.trackIds.length > 0 || clipCarriesRuntimeGrammarWindow(clip),
		);
	const textAnimators = motion.textAnimators
		?.filter((animator) => {
			const target =
				animator.target.kind === "live-text" ||
				animator.target.kind === "outline-group"
					? animator.target.nodeId
					: undefined;
			return target === undefined || visibleNodeIdSet.has(target);
		})
		.map((animator) => projectMotionRecordForRuntime(animator, options, stats));
	const output: Record<string, unknown> = {
		...motion,
		tracks,
		clips,
	};
	if (motion.textAnimators) {
		if (textAnimators && textAnimators.length > 0) {
			output.textAnimators = textAnimators;
		} else {
			deleteExportMetadataField(output, "textAnimators", stats);
		}
	}
	deleteExportMetadataField(output, "grammar", stats);
	return roundUnknown(
		output,
		options.numericPrecision,
		stats,
	) as MotionDocument;
}

const isActiveDirectVersionedRoleMap = (
	binding: MotionGrammarBinding,
): boolean =>
	motionExpressionBindingState(binding.techniqueId, binding.parameters) ===
		"active" &&
	versionedMotionExpressionRoleMapContract(binding.techniqueId)?.direction ===
		"nodeId-to-role";

const projectGrammarRoleMap = (
	binding: MotionGrammarBinding,
	visibleNodeIdSet: ReadonlySet<string>,
): Readonly<Record<string, string>> | undefined => {
	if (!binding.roleMap) return undefined;
	const directVersionedRoleMap = isActiveDirectVersionedRoleMap(binding);
	return Object.fromEntries(
		Object.entries(binding.roleMap).filter(
			directVersionedRoleMap
				? ([nodeId]) => visibleNodeIdSet.has(nodeId)
				: ([, targetId]) => visibleNodeIdSet.has(targetId),
		),
	);
};

const projectGrammarBinding = (
	binding: MotionGrammarBinding,
	visibleNodeIdSet: ReadonlySet<string>,
	options: ExportOptimizationOptions,
): MotionGrammarBinding => {
	if (options.includeHiddenLayers) return binding;
	const roleMap = projectGrammarRoleMap(binding, visibleNodeIdSet);
	return {
		...binding,
		targetIds: binding.targetIds.filter((targetId) =>
			visibleNodeIdSet.has(targetId),
		),
		...(roleMap === undefined ? {} : { roleMap }),
	};
};

/**
 * Filters grammar bindings to the nodes preserved in the runtime scene. V1
 * role maps are direct `nodeId -> role` contracts, while markerless legacy maps
 * retain their historical reverse-map projection. A projected V1 relation is
 * retained only when its remaining direct map still validates; otherwise it is
 * omitted with a source-free fidelity fact instead.
 */
export function projectGrammarBindingsForExportWithFidelity(
	grammarBindings: readonly MotionGrammarBinding[],
	visibleNodeIdSet: ReadonlySet<string>,
	options: ExportOptimizationOptions,
	stats: ProjectionStats = createStats(),
): ProjectedGrammarBindingsForExport {
	const bindings: MotionGrammarBinding[] = [];
	const fidelityIssues: ExportMotionGrammarFidelityIssue[] = [];
	for (const binding of grammarBindings) {
		const projected = projectGrammarBinding(binding, visibleNodeIdSet, options);
		const validationIssue = validateVersionedMotionExpressionBinding(projected);
		if (validationIssue) {
			if (validationIssue.code === "unsupported-expression-version") {
				fidelityIssues.push(unsupportedVersionedMotionGrammarBindingIssue());
			} else if (
				isActiveDirectVersionedRoleMap(binding) &&
				!options.includeHiddenLayers &&
				projected.targetIds.length !== binding.targetIds.length
			) {
				fidelityIssues.push(prunedVersionedMotionGrammarBindingIssue());
			} else {
				fidelityIssues.push(invalidVersionedMotionGrammarBindingIssue());
			}
			continue;
		}
		if (projected.targetIds.length === 0) continue;
		bindings.push(projected);
	}
	return {
		bindings: roundUnknown(
			bindings,
			options.numericPrecision,
			stats,
		) as readonly MotionGrammarBinding[],
		fidelityIssues,
	};
}

/** Backward-compatible binding-only view for existing export adapters. */
export function projectGrammarBindingsForExport(
	grammarBindings: readonly MotionGrammarBinding[],
	visibleNodeIdSet: ReadonlySet<string>,
	options: ExportOptimizationOptions,
	stats: ProjectionStats = createStats(),
): readonly MotionGrammarBinding[] {
	return projectGrammarBindingsForExportWithFidelity(
		grammarBindings,
		visibleNodeIdSet,
		options,
		stats,
	).bindings;
}

/** Projects scene, motion, and grammar data as one internally consistent runtime payload. */
export function projectExportRuntimeData({
	scene,
	motion,
	grammarBindings,
	options,
}: ProjectExportRuntimeDataInput): ProjectedExportRuntimeData {
	const stats = createStats();
	const projectedScene = projectSceneForExport(scene, options, stats);
	const nodeIds = new Set<string>();
	for (const layer of projectedScene.layers)
		visibleNodeIds(layer.nodes, nodeIds);
	const grammarProjection = projectGrammarBindingsForExportWithFidelity(
		grammarBindings,
		nodeIds,
		options,
		stats,
	);
	return {
		scene: projectedScene,
		motion: projectMotionForExport(motion, nodeIds, options, stats),
		grammarBindings: grammarProjection.bindings,
		grammarFidelityIssues: grammarProjection.fidelityIssues,
		stats,
	};
}

const compactMotionPresentation = (value: unknown): unknown => {
	if (!isRecord(value)) return value;
	const currentFrame = isRecord(value.currentFrame) ? value.currentFrame : {};
	const range = isRecord(value.range) ? value.range : {};
	return {
		included: value.included,
		currentFrame: {
			frame: currentFrame.frame,
			sampledValueCount: currentFrame.sampledValueCount,
			animatedNodeIds: currentFrame.animatedNodeIds,
			issueCount: currentFrame.issueCount,
			issueCodes: currentFrame.issueCodes,
			issueSummary: currentFrame.issueSummary,
			...(Array.isArray(currentFrame.issues) && currentFrame.issues.length > 0
				? { issues: currentFrame.issues }
				: {}),
		},
		range: {
			frameCount: range.frameCount,
		},
	};
};

const compactPreviewExport = (value: unknown): unknown => {
	if (!isRecord(value)) return value;
	return {
		previewRenderer: value.previewRenderer,
		exportRenderers: value.exportRenderers,
		currentFrame: value.currentFrame,
		sameSvgSamplingContract: value.sameSvgSamplingContract,
		vecCore: value.vecCore,
		artboardScope: value.artboardScope,
		primaryArtboardId: value.primaryArtboardId,
		differenceIssueCount: value.differenceIssueCount,
		differenceIssueCodes: value.differenceIssueCodes,
		motionPresentationIssueCount: value.motionPresentationIssueCount,
		formatIssueCount: value.formatIssueCount,
	};
};

const compactManifestScene = (
	value: unknown,
	options: ExportOptimizationOptions,
): unknown => {
	if (!isRecord(value) || options.includeRuntimeNames) return value;
	const output: Record<string, unknown> = { ...value };
	delete output.name;
	return output;
};

const compactManifestArtboards = (
	value: unknown,
	options: ExportOptimizationOptions,
): unknown => {
	if (!isRecord(value) || options.includeRuntimeNames) return value;
	const issueCount =
		typeof value.issueCount === "number" ? value.issueCount : 0;
	return {
		scope: value.scope,
		primaryArtboardId: value.primaryArtboardId,
		exportedArtboardIds: value.exportedArtboardIds,
		issueCount,
		issueCodes: value.issueCodes,
		issueSummary: value.issueSummary,
		...(issueCount > 0 ? { issues: value.issues } : {}),
	};
};

/**
 * Compacts the runtime manifest while preserving fidelity issues. The generated
 * runtime needs playback/report metadata, not the full downloadable bundle index.
 */
export function projectRuntimeManifest(
	manifest: unknown,
	options: ExportOptimizationOptions,
	stats: ProjectionStats = createStats(),
): unknown {
	if (options.includeFullManifest || !isRecord(manifest)) {
		return roundUnknown(manifest, options.numericPrecision, stats);
	}
	const issueCount =
		typeof manifest.issueCount === "number" ? manifest.issueCount : 0;
	const compact = {
		exportFormat: manifest.exportFormat,
		sceneSchemaVersion: manifest.sceneSchemaVersion,
		motionSchemaVersion: manifest.motionSchemaVersion,
		frame: manifest.frame,
		frameRange: manifest.frameRange,
		scene: compactManifestScene(manifest.scene, options),
		motion: manifest.motion,
		motionPresentation: compactMotionPresentation(manifest.motionPresentation),
		...(manifest.sceneSequence
			? { sceneSequence: manifest.sceneSequence }
			: {}),
		artboards: compactManifestArtboards(manifest.artboards, options),
		previewExport: compactPreviewExport(manifest.previewExport),
		effectCapabilities: manifest.effectCapabilities,
		issueCount,
		issueSummary: manifest.issueSummary,
		assets: manifest.assets,
		...(issueCount > 0 ? { issues: manifest.issues } : {}),
	};
	return roundUnknown(compact, options.numericPrecision, stats);
}

/** Creates a numeric summary that report surfaces can show beside generated assets. */
export function createExportOptimizationReport({
	options,
	beforeAssets,
	afterAssets,
	stats,
}: {
	readonly options: ExportOptimizationOptions;
	readonly beforeAssets: readonly ExportBundleAsset[];
	readonly afterAssets: readonly { readonly contents: string }[];
	readonly stats: ProjectionStats;
}): ExportOptimizationReport {
	const beforeBytes = measureExportAssets(beforeAssets);
	const afterBytes = measureExportAssets(afterAssets);
	const savedBytes = Math.max(0, beforeBytes - afterBytes);
	return {
		profile: options.profile,
		runtimePackaging: options.runtimePackaging,
		beforeBytes,
		afterBytes,
		savedBytes,
		savedRatio: beforeBytes > 0 ? savedBytes / beforeBytes : 0,
		droppedHiddenLayerCount: stats.droppedHiddenLayerCount,
		droppedHiddenNodeCount: stats.droppedHiddenNodeCount,
		droppedMetadataFieldCount: stats.droppedMetadataFieldCount,
		roundedNumberCount: stats.roundedNumberCount,
		splitAssetCount: options.runtimePackaging === "embedded" ? 0 : 1,
		warnings: [
			...(options.includeHiddenLayers
				? []
				: ["Hidden layers and nodes are excluded from this runtime payload."]),
			...(options.includeFullManifest
				? []
				: [
						"Runtime manifest is compacted to the fields needed for playback and reporting.",
					]),
		],
	};
}
