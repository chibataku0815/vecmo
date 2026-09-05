import {
	buildMotionPresentationFramePlan,
	type MotionPresentationIssue,
	type MotionPresentationIssueCode,
	type MotionPresentationNodeValues,
	sampleMotionPresentationSequence,
} from "@/entities/motion/model/presentation";
import type {
	CameraCutSegment,
	MotionDocument,
} from "@/entities/motion/model/types";
import { parseMotionGrammarLayer } from "@/entities/motion-grammar/model/parse";
import type { MotionGrammarBinding } from "@/entities/motion-grammar/model/types";
import type {
	MotionRelationIssue,
	MotionRelationIssueCode,
} from "@/entities/scene/model/motion-relations";
import { createProductionControlSampler } from "@/entities/scene/model/production-control";
import {
	effectiveCameraCutTransitionDuration,
	findCameraCutSegmentAtFrame,
	resolveCameraCutCrossfadeFrame,
	resolveSceneCameraProjection,
	type SceneCameraProjectionFidelity,
	type SceneCameraProjectionIssue,
	type SceneCameraProjectionIssueCode,
} from "@/entities/scene/model/scene-camera";
import { allNodes } from "@/entities/scene/model/selectors";
import {
	resolveSequenceTimeline,
	type SceneSequenceTimelineIssue,
	type SceneSequenceTimelineIssueCode,
} from "@/entities/scene/model/sequence";
import {
	buildSourceOpticsPresentation,
	sourceOpticsRigsForArtboard,
} from "@/entities/scene/model/source-optics";
import {
	bakeStrokeWidthProfiles,
	type StrokeWidthProfileBakeFallback,
} from "@/entities/scene/model/stroke-outline";
import type { SceneDocument, VectorNode } from "@/entities/scene/model/types";
import {
	type ExportArtboardAssetMetadata,
	type ExportArtboardIssue,
	type ExportArtboardIssueCode,
	type ExportArtboardScopeInput,
	type ExportArtboardScopeMode,
	type ResolvedExportArtboard,
	type ResolvedExportArtboardScope,
	resolveExportArtboardScope,
} from "./artboards";
import {
	createExportBindablePropertiesManifest,
	type ExportBindablePropertiesManifest,
} from "./bindable-fidelity";
import {
	createExportEffectCapabilitiesManifest,
	type ExportEffectCapabilitiesManifest,
} from "./effect-fidelity";
import { clampExportFrame } from "./frame";
import {
	type ExportIssue,
	type ExportIssueSeverity,
	type ExportIssueSummary,
	summarizeExportIssues,
	worstExportIssueSeverity,
} from "./issues";
import {
	createMotionJsonExport,
	createSceneJsonExport,
	type ExportAsset,
	fileStemForScene,
	stableJsonStringify,
} from "./json";
import {
	type ExportMotionGrammarFidelityIssue,
	persistedMotionGrammarFidelityIssuesForExport,
} from "./motion-grammar-fidelity";
import { createPdfExport, type PdfExportAsset } from "./pdf";
import type { ProgramSurfaceDeliveryIssueCode } from "./program-surface-delivery";
import {
	createRasterExportIntents,
	type RasterFormat,
	type RasterIntentExportAsset,
	type RasterScale,
} from "./raster";
import {
	buildExportGrammarSampler,
	buildExportRenderPresentation,
} from "./render-presentation";
import {
	createAnimationSequenceExport,
	type ExportAnimationSequenceJsonAsset,
	type ExportAnimationSequenceManifest,
	type ExportAnimationSequenceSvgAsset,
} from "./sequence";
import type { ExportAppearanceFidelity } from "./style";
import { createSvgExport, type SvgExportAsset } from "./svg";
import {
	createVecCoreRecipeBundleManifest,
	createVecCoreRecipeJsonExport,
	VEC_CORE_RECIPE_PAYLOAD_ASSET_ROLE,
	type VecCoreRecipeAffectedTarget,
	type VecCoreRecipeBundleManifest,
	type VecCoreRecipeExportAsset,
	type VecCoreRecipeIssueCode,
	type VecCoreRecipePayloadManifestEntry,
	type VecCoreRecipePayloadSource,
} from "./vec-core";

const JSON_MIME_TYPE = "application/json;charset=utf-8";
const BUNDLE_MANIFEST_FORMAT = "vector-motion-author/bundle-manifest";

export type ExportManifestAsset = ExportAsset & {
	readonly kind: "manifest-json";
};

export type SceneJsonExportIssueCode =
	| "stroke-width-profile-path-shape-track-unbaked"
	| "stroke-width-profile-visible-fill-unbaked"
	| ProgramSurfaceDeliveryIssueCode;

export type SceneJsonExportIssue = ExportIssue & {
	readonly code: SceneJsonExportIssueCode;
};

export type SceneJsonExportAsset = ExportAsset & {
	readonly kind: "scene-json";
	readonly issues: readonly SceneJsonExportIssue[];
};

/**
 * Canonical motion persistence may carry a forward-compatible grammar sidecar.
 * Its raw bytes stay in the portable document, while this issue list records
 * only the source-free runtime-degrade fact for export review.
 */
export type MotionJsonExportAsset = ExportAsset & {
	readonly kind: "motion-json";
	readonly issues: readonly ExportMotionGrammarFidelityIssue[];
};

export type ExportBundleAsset = (
	| ExportAsset
	| ExportManifestAsset
	| SceneJsonExportAsset
	| MotionJsonExportAsset
	| ExportAnimationSequenceJsonAsset
	| ExportAnimationSequenceSvgAsset
	| VecCoreRecipeExportAsset
	| SvgExportAsset
	| PdfExportAsset
	| RasterIntentExportAsset
) & {
	readonly artboard?: ExportArtboardAssetMetadata;
};

export type ExportArtboardAssetFileNames = {
	readonly svg: string;
	readonly pdf: string;
	readonly recipe?: string;
	readonly animationSequence?: ExportAnimationSequenceAssetFileNames;
	readonly raster?: readonly string[];
};

export type ExportArtboardManifestEntry = ExportArtboardAssetMetadata & {
	readonly assetFileNames: ExportArtboardAssetFileNames;
	readonly animationSequence?: ExportArtboardAnimationSequenceManifestEntry;
};

export type ExportAnimationSequenceAssetFileNames = {
	readonly json: string;
	readonly svg: string;
};

export type ExportArtboardAnimationSequenceManifestEntry =
	ExportArtboardAssetMetadata & {
		readonly assetFileNames: ExportAnimationSequenceAssetFileNames;
		readonly frameCount: number;
		readonly issueCount: number;
		readonly issueCodes: readonly string[];
		readonly motionIssueCount: number;
		readonly motionIssueCodes: readonly MotionPresentationIssueCode[];
		readonly svgIssueCount: number;
		readonly svgIssueCodes: readonly string[];
	};

export type ExportAnimationSequencesManifest = {
	readonly primaryArtboardId: string;
	readonly exportedArtboardIds: readonly string[];
	readonly assetCount: number;
	readonly issueCount: number;
	readonly issueCodes: readonly string[];
	readonly exported: readonly ExportArtboardAnimationSequenceManifestEntry[];
};

/** One resolved scene item in the exported document-level artboard sequence. */
export type ExportSceneSequenceItemManifest = {
	readonly id: string;
	readonly artboardId: string;
	readonly artboardName: string;
	readonly label: string;
	readonly transition: "cut";
	readonly startFrame: number;
	readonly endFrameExclusive: number;
	readonly durationFrames: number;
};

/** Non-fatal sequence issue preserved in the bundle manifest for host UIs. */
export type ExportSceneSequenceIssue = {
	readonly code: SceneSequenceTimelineIssue["code"];
	readonly message: string;
	readonly itemId?: string;
	readonly artboardId?: string;
};

/** Scope-filtered scene sequence metadata consumed by code and video exports. */
export type ExportSceneSequenceManifest = {
	readonly id: string;
	readonly name: string;
	readonly fps: number;
	readonly totalFrames: number;
	readonly itemCount: number;
	readonly issueCount: number;
	readonly issueCodes: readonly SceneSequenceTimelineIssueCode[];
	readonly issues: readonly ExportSceneSequenceIssue[];
	readonly items: readonly ExportSceneSequenceItemManifest[];
};

export type ExportArtboardScopeManifest = {
	readonly scope: ExportArtboardScopeMode;
	readonly requestedArtboardIds: readonly string[];
	readonly defaultArtboardId: string;
	readonly currentArtboardId: string;
	readonly primaryArtboardId: string;
	readonly exportedArtboardIds: readonly string[];
	readonly available: readonly ExportArtboardAssetMetadata[];
	readonly exported: readonly ExportArtboardManifestEntry[];
	readonly issueCount: number;
	readonly issueCodes: readonly ExportArtboardIssueCode[];
	readonly issueSummary: ExportIssueSummary;
	readonly issues: readonly ExportArtboardIssue[];
};

/** Renderer/fidelity discovery for artboard-scoped Source Optics rigs. */
export type ExportSourceOpticsManifest = {
	readonly rigCount: number;
	readonly responseCount: number;
	readonly issueCount: number;
	readonly svg: "native";
	readonly pdf: "unsupported";
	readonly webm: "capture-only";
	readonly directGpu: "deferred";
	readonly generatedRuntime: "native" | "side-car-only";
};

export type ExportBundle = {
	readonly sceneSchemaVersion: SceneDocument["schemaVersion"];
	readonly motionSchemaVersion: MotionDocument["schemaVersion"];
	readonly frame: number;
	readonly frameRange: ExportFrameRangeManifest;
	readonly artboards: ExportArtboardScopeManifest;
	readonly motionPresentation: ExportMotionPresentationManifest;
	readonly sceneCamera: ExportSceneCameraManifest;
	readonly sourceOptics: ExportSourceOpticsManifest;
	readonly animationSequence?: ExportAnimationSequenceManifest;
	readonly animationSequences?: ExportAnimationSequencesManifest;
	readonly sceneSequence?: ExportSceneSequenceManifest;
	readonly vecCore?: VecCoreRecipeBundleManifest;
	readonly effectCapabilities?: ExportEffectCapabilitiesManifest;
	readonly assets: readonly ExportBundleAsset[];
};

type ExportManifestAssetRole =
	| "bundle-manifest"
	| "scene-document"
	| "motion-document"
	| "vec-core-recipe-payload"
	| "frame-svg"
	| "frame-pdf"
	| "animation-sequence-json"
	| "animation-sequence-svg"
	| "raster-intent";

type ExportManifestIssueAssetKind = ExportBundleAsset["kind"];
type ExportManifestIssueAssetRole = ExportManifestAssetRole;

export type ExportManifestAssetEntry = {
	readonly kind: ExportBundleAsset["kind"];
	readonly fileName: string;
	readonly mimeType: string;
	readonly role: ExportManifestAssetRole;
	readonly artboard?: ExportArtboardAssetMetadata;
	readonly appearance?: ExportAppearanceFidelity;
	readonly issueCount: number;
	readonly issueSeverity: ExportIssueSeverity | null;
	readonly issueCodes: readonly string[];
	readonly issueSummary: ExportIssueSummary;
	readonly vecCore?: VecCoreRecipePayloadManifestEntry;
};

export type ExportManifestIssue = ExportIssue & {
	readonly index: number;
	readonly assetFileName: string;
	readonly assetKind: ExportManifestIssueAssetKind;
	readonly assetRole: ExportManifestIssueAssetRole;
	readonly artboardId?: string;
	readonly artboardName?: string;
	readonly frame?: number;
	readonly frameIndex?: number;
};

/**
 * Optional inclusive frame range requested by preview/export callers. Assets are
 * still emitted for `currentFrame`; the range is captured as deterministic
 * metadata for UI review and future multi-frame export adapters.
 */
export type ExportFrameRangeInput = {
	readonly startFrame?: number;
	readonly endFrame?: number;
	readonly stepFrames?: number;
};

export type ExportFrameRangeMode = "current-frame" | "frame-range";

/** Resolved frame plan after clamping against the side-car motion duration. */
export type ExportFrameRangeManifest = {
	readonly mode: ExportFrameRangeMode;
	readonly currentFrame: number;
	readonly fps: number;
	readonly durationFrames: number;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly stepFrames: number;
	readonly frameCount: number;
	readonly frames: readonly number[];
};

export type ExportMotionPresentationIssueSummary = {
	readonly total: number;
	readonly bySeverity: Readonly<
		Record<MotionPresentationIssue["severity"], number>
	>;
	readonly byCode: readonly {
		readonly code: MotionPresentationIssueCode;
		readonly count: number;
	}[];
	readonly affectedNodeIds: readonly string[];
	readonly affectedTrackIds: readonly string[];
};

/**
 * Compact sampled motion payload embedded in the bundle manifest. It preserves
 * side-car ownership by serializing sampled values and diagnostics, never by
 * writing presentation state back into SceneDocument.
 */
export type ExportMotionPresentationFrameManifest = {
	readonly frame: number;
	readonly sampledValueCount: number;
	readonly animatedNodeIds: readonly string[];
	readonly values: readonly MotionPresentationNodeValues[];
	readonly issueCount: number;
	readonly issueCodes: readonly MotionPresentationIssueCode[];
	readonly issueSummary: ExportMotionPresentationIssueSummary;
	readonly issues: readonly MotionPresentationIssue[];
	readonly relationIssueCount: number;
	readonly relationIssueCodes: readonly MotionRelationIssueCode[];
	readonly relationIssues: readonly MotionRelationIssue[];
};

export type ExportMotionPresentationRangeFrameManifest = {
	readonly frame: number;
	readonly sampledValueCount: number;
	readonly animatedNodeIds: readonly string[];
	readonly issueCount: number;
	readonly issueCodes: readonly MotionPresentationIssueCode[];
	readonly relationIssueCount: number;
	readonly relationIssueCodes: readonly MotionRelationIssueCode[];
};

export type ExportMotionPresentationRangeManifest = {
	readonly frameCount: number;
	readonly frames: readonly ExportMotionPresentationRangeFrameManifest[];
};

export type ExportMotionPresentationManifest = {
	readonly included: boolean;
	readonly currentFrame: ExportMotionPresentationFrameManifest;
	readonly range: ExportMotionPresentationRangeManifest;
};

export type ExportSceneCameraIssueCode =
	| SceneCameraProjectionIssueCode
	| "camera-projection-requires-3d"
	| "camera-depth-of-field-approximated";

export type ExportSceneCameraIssue = {
	readonly code: ExportSceneCameraIssueCode;
	readonly severity: SceneCameraProjectionIssue["severity"];
	readonly category: Extract<
		ExportIssue["category"],
		"approximated" | "invalid" | "unsupported"
	>;
	readonly message: string;
	readonly cameraRigId?: string;
	readonly artboardId?: string;
	readonly artboardName?: string;
	readonly nodeId?: string;
};

export type ExportSceneCameraArtboardManifest = {
	readonly artboardId: string;
	readonly artboardName: string;
	readonly requestedCameraRigId?: string;
	readonly activeCameraRigId?: string;
	readonly activeCameraSource: "cut" | "artboard" | "none";
	readonly activeTransition?: {
		readonly kind: "crossfade";
		readonly cutId: string;
		readonly fromCameraRigId: string;
		readonly toCameraRigId: string;
		readonly progress: number;
		readonly durationFrames: number;
	};
	readonly fidelity: SceneCameraProjectionFidelity;
	readonly projectedNodeCount: number;
	readonly depthOfField?: {
		readonly active: boolean;
		readonly focusDistance: number;
		readonly aperture: number;
		readonly maxBlurRadius: number;
		readonly maxCircleOfConfusion: number;
		readonly blurredNodeCount: number;
		readonly nearBlurredNodeCount: number;
		readonly farBlurredNodeCount: number;
		readonly maxBlurNodeId?: string;
		readonly maxBlurDepth?: number;
		readonly fidelity:
			| "none"
			| "svg-layer-blur-approximation"
			| "optical-bokeh-preview-required";
		readonly renderer: "none" | "svg-layer-blur";
		readonly opticalModel: "none" | "thin-lens-normalized-coc";
		readonly bokehShape: "none" | "circular";
	};
	readonly issueCount: number;
	readonly issueCodes: readonly ExportSceneCameraIssueCode[];
	readonly issues: readonly ExportSceneCameraIssue[];
};

export type ExportSceneCameraCutManifest = Pick<
	CameraCutSegment,
	| "id"
	| "name"
	| "artboardId"
	| "cameraRigId"
	| "laneId"
	| "startFrame"
	| "durationFrames"
	| "transition"
	| "transitionDurationFrames"
	| "thumbnailFrame"
>;

export type ExportSceneCameraManifest = {
	readonly included: boolean;
	readonly supportedFidelity: "svg-affine";
	readonly fidelity: SceneCameraProjectionFidelity;
	readonly cameraCount: number;
	readonly activeCameraCount: number;
	readonly depthNodeCount: number;
	readonly cameraTrackCount: number;
	readonly cameraCutCount: number;
	readonly cameraCuts: readonly ExportSceneCameraCutManifest[];
	readonly exportedArtboardIds: readonly string[];
	readonly activeCameraRigIds: readonly string[];
	readonly artboards: readonly ExportSceneCameraArtboardManifest[];
	readonly issueCount: number;
	readonly issueCodes: readonly ExportSceneCameraIssueCode[];
	readonly issues: readonly ExportSceneCameraIssue[];
};

/**
 * Connective metadata for explaining where Preview and downloaded assets can
 * diverge. Preview and SVG export intentionally share the SVG renderer; PDF and
 * motion-presentation degradations are exposed here as issue codes.
 */
export type ExportPreviewExportManifest = {
	readonly previewRenderer: "svg";
	readonly exportRenderers: readonly ("svg" | "pdf")[];
	readonly currentFrame: number;
	readonly sameSvgSamplingContract: boolean;
	readonly vecCore: ExportPreviewVecCoreIntentManifest;
	readonly artboardScope: ExportArtboardScopeMode;
	readonly primaryArtboardId: string;
	readonly exportedFrameFileNames: {
		readonly svg: string;
		readonly pdf: string;
		readonly recipe?: string;
	};
	readonly exportedArtboardFrameFileNames: readonly (ExportArtboardAssetFileNames & {
		readonly artboardId: string;
		readonly artboardName: string;
	})[];
	readonly exportedArtboardSequenceFileNames?: readonly (ExportAnimationSequenceAssetFileNames & {
		readonly artboardId: string;
		readonly artboardName: string;
	})[];
	readonly differenceIssueCount: number;
	readonly differenceIssueCodes: readonly string[];
	readonly motionPresentationIssueCount: number;
	readonly formatIssueCount: number;
};

export type ExportPreviewVecCoreIntentManifest = {
	readonly included: boolean;
	readonly assetRole: typeof VEC_CORE_RECIPE_PAYLOAD_ASSET_ROLE;
	readonly source: VecCoreRecipePayloadSource | null;
	readonly payloadAssetCount: number;
	readonly payloadFileNames: readonly string[];
	readonly frameIntentCount: number;
	readonly activeFrameIntentCount: number;
	readonly targetCount: number;
	readonly activeTargetCount: number;
	readonly influenceIncluded: boolean;
	readonly influenceAssignmentCount: number;
	readonly issueCount: number;
	readonly issueCodes: readonly VecCoreRecipeIssueCode[];
	readonly affectedTargets: readonly VecCoreRecipeAffectedTarget[];
};

export type ExportBundleRasterManifest = {
	readonly included: boolean;
	readonly scope: ExportArtboardScopeMode;
	readonly formats: readonly RasterFormat[];
	readonly scales: readonly RasterScale[];
	readonly sliceCount: number;
	readonly issueCount: number;
};

/**
 * Stable index for the files emitted by an export bundle. It keeps frame,
 * schema, and fidelity issue metadata beside the assets so future UI and
 * Worker paths can inspect degradation without parsing SVG/PDF bytes.
 */
export type ExportBundleManifest = {
	readonly exportFormat: typeof BUNDLE_MANIFEST_FORMAT;
	readonly sceneSchemaVersion: SceneDocument["schemaVersion"];
	readonly motionSchemaVersion: MotionDocument["schemaVersion"];
	readonly frame: number;
	readonly frameRange: ExportFrameRangeManifest;
	readonly assetCount: number;
	readonly issueCount: number;
	readonly scene: {
		readonly id: string;
		readonly name: string;
		readonly schemaVersion: SceneDocument["schemaVersion"];
		readonly layerCount: number;
		readonly visibleLayerCount: number;
		readonly nodeCount: number;
		readonly visibleNodeCount: number;
		readonly artboard: {
			readonly id: string;
			readonly width: number;
			readonly height: number;
			readonly fps: number;
			readonly durationFrames: number;
		};
	};
	readonly motion: {
		readonly schemaVersion: MotionDocument["schemaVersion"];
		readonly fps: number;
		readonly durationFrames: number;
		readonly trackCount: number;
		readonly clipCount: number;
		readonly animatedNodeIds: readonly string[];
	};
	readonly motionPresentation: ExportMotionPresentationManifest;
	readonly sceneCamera: ExportSceneCameraManifest;
	readonly sourceOptics: ExportSourceOpticsManifest;
	readonly animationSequence?: ExportAnimationSequenceManifest;
	readonly animationSequences?: ExportAnimationSequencesManifest;
	readonly sceneSequence?: ExportSceneSequenceManifest;
	readonly vecCore?: VecCoreRecipeBundleManifest;
	readonly effectCapabilities?: ExportEffectCapabilitiesManifest;
	readonly bindableProperties?: ExportBindablePropertiesManifest;
	readonly raster?: ExportBundleRasterManifest;
	readonly artboards: ExportArtboardScopeManifest;
	readonly previewExport: ExportPreviewExportManifest;
	readonly issueSummary: ExportIssueSummary;
	readonly assets: readonly ExportManifestAssetEntry[];
	readonly issues: readonly ExportManifestIssue[];
};

export type RasterExportOption = {
	readonly formats?: readonly RasterFormat[];
	readonly scales?: readonly RasterScale[];
	readonly jpegQuality?: number;
};

type CreateExportBundleInput = {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly frame?: number;
	readonly currentFrame?: number;
	readonly frameRange?: ExportFrameRangeInput;
	readonly artboardScope?: ExportArtboardScopeInput;
	readonly includeMotionMetadata?: boolean;
	readonly grammarBindings?: readonly MotionGrammarBinding[];
	/** Source-free facts for persisted grammar entries omitted from runtime use. */
	readonly grammarFidelityIssues?: readonly ExportMotionGrammarFidelityIssue[];
	readonly rasterExport?: RasterExportOption;
};

type ExportArtboardFrameAssets = {
	readonly target: ResolvedExportArtboard;
	readonly svgAsset: SvgExportAsset & {
		readonly artboard: ExportArtboardAssetMetadata;
	};
	readonly pdfAsset: PdfExportAsset & {
		readonly artboard: ExportArtboardAssetMetadata;
	};
};

type ExportArtboardSequenceAssets = {
	readonly target: ResolvedExportArtboard;
	readonly manifest: ExportAnimationSequenceManifest;
	readonly jsonAsset: ExportAnimationSequenceJsonAsset & {
		readonly artboard: ExportArtboardAssetMetadata;
	};
	readonly svgAsset: ExportAnimationSequenceSvgAsset & {
		readonly artboard: ExportArtboardAssetMetadata;
	};
};

type ExportArtboardRecipeAsset = {
	readonly target: ResolvedExportArtboard;
	readonly recipeAsset: VecCoreRecipeExportAsset & {
		readonly artboard: ExportArtboardAssetMetadata;
	};
};

const countNodes = (nodes: readonly VectorNode[]): number =>
	nodes.reduce((total, node) => total + 1 + countNodes(node.children ?? []), 0);

const countVisibleNodes = (nodes: readonly VectorNode[]): number =>
	nodes.reduce((total, node) => {
		if (!node.visible) return total;
		return total + 1 + countVisibleNodes(node.children ?? []);
	}, 0);

const roleForAssetKind = (
	kind: ExportBundleAsset["kind"],
): ExportManifestAssetRole => {
	switch (kind) {
		case "manifest-json":
			return "bundle-manifest";
		case "scene-json":
			return "scene-document";
		case "motion-json":
			return "motion-document";
		case "recipe-json":
			return VEC_CORE_RECIPE_PAYLOAD_ASSET_ROLE;
		case "svg":
			return "frame-svg";
		case "pdf":
			return "frame-pdf";
		case "animation-sequence-json":
			return "animation-sequence-json";
		case "animation-sequence-svg":
			return "animation-sequence-svg";
		case "raster-intent-json":
			return "raster-intent";
	}
};

const issueRoleForAssetKind = (
	kind: ExportManifestIssueAssetKind,
): ExportManifestIssueAssetRole => roleForAssetKind(kind);

type IssueBearingExportAsset = ExportBundleAsset & {
	readonly issues: readonly ExportIssue[];
};

const hasIssueList = (
	asset: ExportBundleAsset,
): asset is IssueBearingExportAsset =>
	"issues" in asset &&
	Array.isArray((asset as { readonly issues?: unknown }).issues);

const issuesForAsset = (asset: ExportBundleAsset): readonly ExportIssue[] =>
	hasIssueList(asset) ? asset.issues : [];

const hasAppearanceFidelity = (
	asset: ExportBundleAsset,
): asset is (SvgExportAsset | PdfExportAsset) & {
	readonly appearance: ExportAppearanceFidelity;
} => (asset.kind === "svg" || asset.kind === "pdf") && "appearance" in asset;

const hasAppearanceDetails = (appearance: ExportAppearanceFidelity): boolean =>
	appearance.preserved.length > 0 ||
	appearance.approximated.length > 0 ||
	appearance.unsupported.length > 0;

const issueCodes = (
	issues: readonly {
		readonly code: string;
	}[],
): readonly string[] => [...new Set(issues.map((issue) => issue.code))].sort();

const issueCodesForAsset = (asset: ExportBundleAsset): readonly string[] =>
	issueCodes(issuesForAsset(asset));

const manifestEntryForAsset = (
	asset: ExportBundleAsset,
	vecCorePayloadByFileName: ReadonlyMap<
		string,
		VecCoreRecipePayloadManifestEntry
	>,
): ExportManifestAssetEntry => {
	const appearance =
		hasAppearanceFidelity(asset) && hasAppearanceDetails(asset.appearance)
			? asset.appearance
			: undefined;
	const vecCore = vecCorePayloadByFileName.get(asset.fileName);
	return {
		kind: asset.kind,
		fileName: asset.fileName,
		mimeType: asset.mimeType,
		role: roleForAssetKind(asset.kind),
		...(asset.artboard ? { artboard: asset.artboard } : {}),
		...(appearance ? { appearance } : {}),
		issueCount: issuesForAsset(asset).length,
		issueSeverity: worstExportIssueSeverity(issuesForAsset(asset)),
		issueCodes: issueCodesForAsset(asset),
		issueSummary: summarizeExportIssues(issuesForAsset(asset)),
		...(vecCore ? { vecCore } : {}),
	};
};

const manifestIssuesForAssets = (
	assets: readonly ExportBundleAsset[],
): readonly ExportManifestIssue[] => {
	const issues: ExportManifestIssue[] = [];
	for (const asset of assets) {
		if (!hasIssueList(asset)) continue;
		for (const issue of asset.issues) {
			issues.push({
				...issue,
				index: issues.length,
				assetFileName: asset.fileName,
				assetKind: asset.kind,
				assetRole: issueRoleForAssetKind(asset.kind),
				...(asset.artboard
					? {
							artboardId: asset.artboard.id,
							artboardName: asset.artboard.name,
						}
					: {}),
			});
		}
	}
	return issues;
};

const countByMotionSeverity = (
	issues: readonly MotionPresentationIssue[],
): Readonly<Record<MotionPresentationIssue["severity"], number>> => {
	const counts: Record<MotionPresentationIssue["severity"], number> = {
		error: 0,
		warning: 0,
	};
	for (const issue of issues) counts[issue.severity] += 1;
	return counts;
};

const motionIssueCodes = (
	issues: readonly MotionPresentationIssue[],
): readonly MotionPresentationIssueCode[] =>
	issueCodes(issues) as readonly MotionPresentationIssueCode[];

const sortedUnique = <T extends string>(
	values: readonly (T | undefined)[],
): readonly T[] =>
	[
		...new Set(values.filter((value): value is T => value !== undefined)),
	].sort();

const nodeIdSetForScene = (scene: SceneDocument): ReadonlySet<string> =>
	new Set(allNodes(scene).map((node) => node.id));

const scopedMotionForSequence = ({
	sourceScene,
	targetScene,
	motion,
}: {
	readonly sourceScene: SceneDocument;
	readonly targetScene: SceneDocument;
	readonly motion: MotionDocument;
}): MotionDocument => {
	const sourceNodeIds = nodeIdSetForScene(sourceScene);
	const targetNodeIds = nodeIdSetForScene(targetScene);
	const tracks = motion.tracks.filter(
		(track) =>
			targetNodeIds.has(track.target.nodeId) ||
			!sourceNodeIds.has(track.target.nodeId),
	);
	if (tracks.length === motion.tracks.length) return motion;
	return { ...motion, tracks };
};

const summarizeMotionPresentationIssues = (
	issues: readonly MotionPresentationIssue[],
): ExportMotionPresentationIssueSummary => {
	const counts = new Map<MotionPresentationIssueCode, number>();
	for (const issue of issues) {
		counts.set(issue.code, (counts.get(issue.code) ?? 0) + 1);
	}

	return {
		total: issues.length,
		bySeverity: countByMotionSeverity(issues),
		byCode: [...counts.entries()]
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([code, count]) => ({ code, count })),
		affectedNodeIds: sortedUnique(issues.map((issue) => issue.nodeId)),
		affectedTrackIds: sortedUnique(issues.map((issue) => issue.trackId)),
	};
};

const animatedNodeIdsForValues = (
	values: readonly MotionPresentationNodeValues[],
): readonly string[] => sortedUnique(values.map((value) => value.nodeId));

const emptyMotionPresentationFrameManifest = (
	frame: number,
): ExportMotionPresentationFrameManifest => ({
	frame,
	sampledValueCount: 0,
	animatedNodeIds: [],
	values: [],
	issueCount: 0,
	issueCodes: [],
	issueSummary: summarizeMotionPresentationIssues([]),
	issues: [],
	relationIssueCount: 0,
	relationIssueCodes: [],
	relationIssues: [],
});

const createMotionPresentationFrameManifest = ({
	scene,
	motion,
	frame,
	grammarBindings,
}: Required<Pick<CreateExportBundleInput, "scene" | "motion">> & {
	readonly frame: number;
	readonly grammarBindings?: readonly MotionGrammarBinding[];
}): ExportMotionPresentationFrameManifest => {
	const presentation = buildExportRenderPresentation({
		scene,
		motion,
		frame,
		grammarBindings,
	}).presentation;
	return {
		frame: presentation.frame,
		sampledValueCount: presentation.values.length,
		animatedNodeIds: animatedNodeIdsForValues(presentation.values),
		values: presentation.values,
		issueCount: presentation.issues.length,
		issueCodes: motionIssueCodes(presentation.issues),
		issueSummary: summarizeMotionPresentationIssues(presentation.issues),
		issues: presentation.issues,
		relationIssueCount: presentation.relationIssues.length,
		relationIssueCodes: sortedUnique(
			presentation.relationIssues.map((issue) => issue.code),
		),
		relationIssues: presentation.relationIssues,
	};
};

const createMotionPresentationRangeManifest = ({
	scene,
	motion,
	frameRange,
	includeMotionMetadata,
	grammarBindings,
}: Required<Pick<CreateExportBundleInput, "scene" | "motion">> & {
	readonly frameRange: ExportFrameRangeManifest;
	readonly includeMotionMetadata: boolean;
	readonly grammarBindings?: readonly MotionGrammarBinding[];
}): ExportMotionPresentationRangeManifest => {
	if (!includeMotionMetadata) {
		return {
			frameCount: frameRange.frameCount,
			frames: frameRange.frames.map((frame) => ({
				frame,
				sampledValueCount: 0,
				animatedNodeIds: [],
				issueCount: 0,
				issueCodes: [],
				relationIssueCount: 0,
				relationIssueCodes: [],
			})),
		};
	}

	const sequence = sampleMotionPresentationSequence({
		scene,
		motion,
		startFrame: frameRange.startFrame,
		endFrame: frameRange.endFrame,
		stepFrames: frameRange.stepFrames,
		grammar: buildExportGrammarSampler({ grammarBindings, scene, motion }),
	});
	return {
		frameCount: sequence.frames.length,
		frames: sequence.samples.map((sample) => ({
			frame: sample.frame,
			sampledValueCount: sample.values.length,
			animatedNodeIds: animatedNodeIdsForValues(sample.values),
			issueCount: sample.issues.length,
			issueCodes: motionIssueCodes(sample.issues),
			relationIssueCount: sample.relationIssues.length,
			relationIssueCodes: sortedUnique(
				sample.relationIssues.map((issue) => issue.code),
			),
		})),
	};
};

const createMotionPresentationManifest = ({
	scene,
	motion,
	frameRange,
	includeMotionMetadata,
	grammarBindings,
}: Required<Pick<CreateExportBundleInput, "scene" | "motion">> & {
	readonly frameRange: ExportFrameRangeManifest;
	readonly includeMotionMetadata: boolean;
	readonly grammarBindings?: readonly MotionGrammarBinding[];
}): ExportMotionPresentationManifest => ({
	included: includeMotionMetadata,
	currentFrame: includeMotionMetadata
		? createMotionPresentationFrameManifest({
				scene,
				motion,
				frame: frameRange.currentFrame,
				grammarBindings,
			})
		: emptyMotionPresentationFrameManifest(frameRange.currentFrame),
	range: createMotionPresentationRangeManifest({
		scene,
		motion,
		frameRange,
		includeMotionMetadata,
		grammarBindings,
	}),
});

const sceneCameraIssueCategory = (
	issue: Pick<ExportSceneCameraIssue, "severity">,
): ExportSceneCameraIssue["category"] =>
	issue.severity === "error" ? "invalid" : "approximated";

const sceneCameraProjectionIssue = ({
	issue,
	target,
}: {
	readonly issue: SceneCameraProjectionIssue;
	readonly target: ResolvedExportArtboard;
}): ExportSceneCameraIssue => ({
	code: issue.code,
	severity: issue.severity,
	category: sceneCameraIssueCategory(issue),
	message: issue.message,
	...(issue.cameraRigId ? { cameraRigId: issue.cameraRigId } : {}),
	artboardId: issue.artboardId ?? target.metadata.id,
	artboardName: target.metadata.name,
	...(issue.nodeId ? { nodeId: issue.nodeId } : {}),
});

const activeSceneCameraMissingIssue = ({
	target,
	cameraRigId,
}: {
	readonly target: ResolvedExportArtboard;
	readonly cameraRigId: string;
}): ExportSceneCameraIssue => ({
	code: "active-camera-missing",
	severity: "error",
	category: "invalid",
	message: `Artboard "${target.metadata.name}" points at missing scene camera "${cameraRigId}".`,
	cameraRigId,
	artboardId: target.metadata.id,
	artboardName: target.metadata.name,
});

const sceneCameraRequires3dIssue = ({
	target,
	cameraRigId,
}: {
	readonly target: ResolvedExportArtboard;
	readonly cameraRigId?: string;
}): ExportSceneCameraIssue => ({
	code: "camera-projection-requires-3d",
	severity: "warning",
	category: "unsupported",
	message: `Scene camera projection for "${target.metadata.name}" requires future true-3D export support; the admitted export subset is svg-affine.`,
	...(cameraRigId ? { cameraRigId } : {}),
	artboardId: target.metadata.id,
	artboardName: target.metadata.name,
});

const sceneCameraDepthOfFieldIssue = ({
	target,
	cameraRigId,
}: {
	readonly target: ResolvedExportArtboard;
	readonly cameraRigId: string;
}): ExportSceneCameraIssue => ({
	code: "camera-depth-of-field-approximated",
	severity: "warning",
	category: "approximated",
	message: `Scene camera "${cameraRigId}" uses depth of field; export resolves a normalized circle-of-confusion profile and renders the admitted vector subset with depth-driven layer blur while exact optical bokeh remains future renderer fidelity.`,
	cameraRigId,
	artboardId: target.metadata.id,
	artboardName: target.metadata.name,
});

const sceneCameraIssueCodes = (
	issues: readonly ExportSceneCameraIssue[],
): readonly ExportSceneCameraIssueCode[] =>
	sortedUnique(
		issues.map((issue) => issue.code),
	) as readonly ExportSceneCameraIssueCode[];

const sceneCameraFidelityRank: Readonly<
	Record<SceneCameraProjectionFidelity, number>
> = {
	none: 0,
	"svg-affine": 1,
	"requires-3d": 2,
	invalid: 3,
};

const worstSceneCameraFidelity = (
	fidelities: readonly SceneCameraProjectionFidelity[],
): SceneCameraProjectionFidelity => {
	if (fidelities.length === 0) return "none";
	return fidelities.reduce<SceneCameraProjectionFidelity>(
		(worst, value) =>
			sceneCameraFidelityRank[value] > sceneCameraFidelityRank[worst]
				? value
				: worst,
		"none",
	);
};

const sceneCameraCutManifest = (
	segment: CameraCutSegment,
): ExportSceneCameraCutManifest => ({
	id: segment.id,
	...(segment.name ? { name: segment.name } : {}),
	artboardId: segment.artboardId,
	cameraRigId: segment.cameraRigId,
	...(segment.laneId ? { laneId: segment.laneId } : {}),
	startFrame: segment.startFrame,
	durationFrames: segment.durationFrames,
	transition: segment.transition,
	...(segment.transitionDurationFrames !== undefined
		? { transitionDurationFrames: segment.transitionDurationFrames }
		: {}),
	...(segment.thumbnailFrame !== undefined
		? { thumbnailFrame: segment.thumbnailFrame }
		: {}),
});

const createSceneCameraManifest = ({
	scene,
	motion,
	frame,
	targets,
}: Required<Pick<CreateExportBundleInput, "scene" | "motion">> & {
	readonly frame: number;
	readonly targets: readonly ResolvedExportArtboard[];
}): ExportSceneCameraManifest => {
	const cameraCount = scene.sceneCameras?.length ?? 0;
	const exportedNodeIds = new Set(
		targets.flatMap((target) => allNodes(target.scene).map((node) => node.id)),
	);
	const depthNodeCount = allNodes(scene).filter(
		(node) => node.depthPlane && exportedNodeIds.has(node.id),
	).length;
	const cameraTrackCount = motion.cameraTracks?.length ?? 0;
	const cameraCutCount = motion.cameraCuts?.length ?? 0;
	const cameraCuts = (motion.cameraCuts ?? []).map(sceneCameraCutManifest);
	const artboards = targets.map((target) => {
		const activeCut = findCameraCutSegmentAtFrame(
			motion,
			target.metadata.id,
			frame,
		);
		const activeCrossfade = resolveCameraCutCrossfadeFrame({
			scene: target.scene,
			motion,
			artboardId: target.metadata.id,
			frame,
		});
		const requestedCameraRigId =
			activeCut?.cameraRigId ?? target.scene.artboard.activeSceneCameraId;
		const resolution = resolveSceneCameraProjection({
			scene: target.scene,
			motion,
			frame,
			artboardId: target.metadata.id,
			controls: createProductionControlSampler(target.scene, motion),
		});
		const issues = [
			...resolution.projectionIssues.map((issue) =>
				sceneCameraProjectionIssue({ issue, target }),
			),
			...(requestedCameraRigId && !resolution.activeCameraRigId
				? [
						activeSceneCameraMissingIssue({
							target,
							cameraRigId: requestedCameraRigId,
						}),
					]
				: []),
			...(resolution.fidelity === "requires-3d"
				? [
						sceneCameraRequires3dIssue({
							target,
							...(resolution.activeCameraRigId
								? { cameraRigId: resolution.activeCameraRigId }
								: {}),
						}),
					]
				: []),
			...(resolution.depthOfField.active && resolution.activeCameraRigId
				? [
						sceneCameraDepthOfFieldIssue({
							target,
							cameraRigId: resolution.activeCameraRigId,
						}),
					]
				: []),
		];
		const activeCameraSource: ExportSceneCameraArtboardManifest["activeCameraSource"] =
			activeCut ? "cut" : resolution.activeCameraRigId ? "artboard" : "none";
		return {
			artboardId: target.metadata.id,
			artboardName: target.metadata.name,
			...(requestedCameraRigId ? { requestedCameraRigId } : {}),
			...(resolution.activeCameraRigId
				? { activeCameraRigId: resolution.activeCameraRigId }
				: {}),
			activeCameraSource,
			...(activeCrossfade
				? {
						activeTransition: {
							kind: "crossfade" as const,
							cutId: activeCrossfade.segment.id,
							fromCameraRigId: activeCrossfade.fromCameraRigId,
							toCameraRigId: activeCrossfade.toCameraRigId,
							progress: activeCrossfade.progress,
							durationFrames: effectiveCameraCutTransitionDuration(
								activeCrossfade.segment,
							),
						},
					}
				: {}),
			fidelity: resolution.fidelity,
			projectedNodeCount: resolution.renderLocalMatrixByNodeId.size,
			depthOfField: resolution.depthOfField,
			issueCount: issues.length,
			issueCodes: sceneCameraIssueCodes(issues),
			issues,
		};
	});
	const issues = artboards.flatMap((artboard) => artboard.issues);
	const activeCameraRigIds = sortedUnique(
		artboards.map((artboard) => artboard.activeCameraRigId),
	);
	const included =
		cameraCount > 0 ||
		depthNodeCount > 0 ||
		cameraTrackCount > 0 ||
		cameraCutCount > 0 ||
		activeCameraRigIds.length > 0 ||
		issues.length > 0;

	return {
		included,
		supportedFidelity: "svg-affine",
		fidelity: included
			? worstSceneCameraFidelity(artboards.map((artboard) => artboard.fidelity))
			: "none",
		cameraCount,
		activeCameraCount: artboards.filter(
			(artboard) => artboard.activeCameraRigId,
		).length,
		depthNodeCount,
		cameraTrackCount,
		cameraCutCount,
		cameraCuts,
		exportedArtboardIds: targets.map((target) => target.metadata.id),
		activeCameraRigIds,
		artboards,
		issueCount: issues.length,
		issueCodes: sceneCameraIssueCodes(issues),
		issues,
	};
};

const createFrameRangeManifest = ({
	motion,
	currentFrame,
	frameRange,
}: Required<Pick<CreateExportBundleInput, "motion">> & {
	readonly currentFrame: number;
	readonly frameRange?: ExportFrameRangeInput;
}): ExportFrameRangeManifest => {
	const plan = buildMotionPresentationFramePlan({
		motion,
		startFrame: frameRange?.startFrame ?? currentFrame,
		endFrame: frameRange?.endFrame ?? currentFrame,
		stepFrames: frameRange?.stepFrames ?? 1,
	});
	return {
		mode: frameRange ? "frame-range" : "current-frame",
		currentFrame,
		fps: plan.fps,
		durationFrames: plan.durationFrames,
		startFrame: plan.startFrame,
		endFrame: plan.endFrame,
		stepFrames: plan.stepFrames,
		frameCount: plan.frames.length,
		frames: plan.frames,
	};
};

const previewVecCoreIntentManifest = (
	vecCore: VecCoreRecipeBundleManifest | undefined,
): ExportPreviewVecCoreIntentManifest => {
	if (!vecCore) {
		return {
			included: false,
			assetRole: VEC_CORE_RECIPE_PAYLOAD_ASSET_ROLE,
			source: null,
			payloadAssetCount: 0,
			payloadFileNames: [],
			frameIntentCount: 0,
			activeFrameIntentCount: 0,
			targetCount: 0,
			activeTargetCount: 0,
			influenceIncluded: false,
			influenceAssignmentCount: 0,
			issueCount: 0,
			issueCodes: [],
			affectedTargets: [],
		};
	}
	return {
		included: true,
		assetRole: VEC_CORE_RECIPE_PAYLOAD_ASSET_ROLE,
		source: vecCore.source,
		payloadAssetCount: vecCore.payloadAssetCount,
		payloadFileNames: vecCore.payloadFileNames,
		frameIntentCount: vecCore.frameIntentCount,
		activeFrameIntentCount: vecCore.activeFrameIntentCount,
		targetCount: vecCore.targetCount,
		activeTargetCount: vecCore.activeTargetCount,
		influenceIncluded: vecCore.influenceIncluded,
		influenceAssignmentCount: vecCore.influenceAssignmentCount,
		issueCount: vecCore.issueCount,
		issueCodes: vecCore.issueCodes,
		affectedTargets: vecCore.affectedTargets,
	};
};

const createPreviewExportManifest = ({
	frame,
	motionPresentation,
	artboardScope,
	vecCore,
	frameAssets,
	recipeAssets,
	sequenceAssets,
}: {
	readonly frame: number;
	readonly motionPresentation: ExportMotionPresentationManifest;
	readonly artboardScope: ExportArtboardScopeManifest;
	readonly vecCore?: VecCoreRecipeBundleManifest;
	readonly frameAssets: readonly ExportArtboardFrameAssets[];
	readonly recipeAssets: readonly ExportArtboardRecipeAsset[];
	readonly sequenceAssets: readonly ExportArtboardSequenceAssets[];
}): ExportPreviewExportManifest => {
	const formatIssues = frameAssets.flatMap(({ svgAsset, pdfAsset }) => [
		...svgAsset.issues,
		...pdfAsset.issues,
	]);
	const differenceCodes = issueCodes([
		...formatIssues,
		...motionPresentation.currentFrame.issues,
		...motionPresentation.currentFrame.relationIssues,
		...(vecCore?.issueCodes.map((code) => ({ code })) ?? []),
	]);
	const primaryFrameAssets = frameAssets[0];
	if (!primaryFrameAssets) {
		throw new Error("Export requires at least one resolved artboard target.");
	}
	const recipeByArtboardId = new Map(
		recipeAssets.map(
			({ target, recipeAsset }) =>
				[target.metadata.id, recipeAsset.fileName] as const,
		),
	);
	const primaryRecipe = recipeByArtboardId.get(
		primaryFrameAssets.target.metadata.id,
	);
	return {
		previewRenderer: "svg",
		exportRenderers: ["svg", "pdf"],
		currentFrame: frame,
		sameSvgSamplingContract: true,
		vecCore: previewVecCoreIntentManifest(vecCore),
		artboardScope: artboardScope.scope,
		primaryArtboardId: artboardScope.primaryArtboardId,
		exportedFrameFileNames: {
			svg: primaryFrameAssets.svgAsset.fileName,
			pdf: primaryFrameAssets.pdfAsset.fileName,
			...(primaryRecipe ? { recipe: primaryRecipe } : {}),
		},
		exportedArtboardFrameFileNames: frameAssets.map(
			({ target, svgAsset, pdfAsset }) => ({
				artboardId: target.metadata.id,
				artboardName: target.metadata.name,
				svg: svgAsset.fileName,
				pdf: pdfAsset.fileName,
				...(recipeByArtboardId.get(target.metadata.id)
					? { recipe: recipeByArtboardId.get(target.metadata.id) }
					: {}),
			}),
		),
		...(sequenceAssets.length > 0
			? {
					exportedArtboardSequenceFileNames: sequenceAssets.map(
						({ target, jsonAsset, svgAsset }) => ({
							artboardId: target.metadata.id,
							artboardName: target.metadata.name,
							json: jsonAsset.fileName,
							svg: svgAsset.fileName,
						}),
					),
				}
			: {}),
		differenceIssueCount:
			formatIssues.length +
			motionPresentation.currentFrame.issueCount +
			motionPresentation.currentFrame.relationIssueCount,
		differenceIssueCodes: differenceCodes,
		motionPresentationIssueCount:
			motionPresentation.currentFrame.issueCount +
			motionPresentation.currentFrame.relationIssueCount,
		formatIssueCount: formatIssues.length,
	};
};

const artboardIssueCodes = (
	issues: readonly ExportArtboardIssue[],
): readonly ExportArtboardIssueCode[] =>
	issueCodes(issues) as readonly ExportArtboardIssueCode[];

const sequenceManifestIssueCodes = (
	manifest: ExportAnimationSequenceManifest,
): readonly string[] =>
	sortedUnique([...manifest.motionIssueCodes, ...manifest.svgIssueCodes]);

const createArtboardAnimationSequenceManifestEntry = ({
	target,
	manifest,
}: ExportArtboardSequenceAssets): ExportArtboardAnimationSequenceManifestEntry => {
	const issueCodes = sequenceManifestIssueCodes(manifest);
	return {
		...target.metadata,
		assetFileNames: manifest.assetFileNames,
		frameCount: manifest.frameCount,
		issueCount: manifest.motionIssueCount + manifest.svgIssueCount,
		issueCodes,
		motionIssueCount: manifest.motionIssueCount,
		motionIssueCodes: manifest.motionIssueCodes,
		svgIssueCount: manifest.svgIssueCount,
		svgIssueCodes: manifest.svgIssueCodes,
	};
};

const createAnimationSequencesManifest = (
	sequenceAssets: readonly ExportArtboardSequenceAssets[],
): ExportAnimationSequencesManifest | undefined => {
	const primary = sequenceAssets[0];
	if (!primary) return undefined;

	const exported = sequenceAssets.map((sequence) =>
		createArtboardAnimationSequenceManifestEntry(sequence),
	);
	return {
		primaryArtboardId: primary.target.metadata.id,
		exportedArtboardIds: sequenceAssets.map(({ target }) => target.metadata.id),
		assetCount: sequenceAssets.length * 2,
		issueCount: exported.reduce(
			(total, sequence) => total + sequence.issueCount,
			0,
		),
		issueCodes: sortedUnique(
			exported.flatMap((sequence) => sequence.issueCodes),
		),
		exported,
	};
};

const sceneSequenceIssue = (
	issue: SceneSequenceTimelineIssue,
): ExportSceneSequenceIssue => ({
	code: issue.code,
	message: issue.message,
	...(issue.itemId ? { itemId: issue.itemId } : {}),
	...(issue.artboardId ? { artboardId: issue.artboardId } : {}),
});

const createSceneSequenceManifest = ({
	scene,
	motion,
	allowedArtboardIds,
}: {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly allowedArtboardIds: ReadonlySet<string>;
}): ExportSceneSequenceManifest | undefined => {
	if (!scene.sequence) return undefined;
	const scopedSequence = {
		...scene.sequence,
		items: scene.sequence.items.filter((item) =>
			allowedArtboardIds.has(item.artboardId),
		),
	};
	if (scopedSequence.items.length === 0) return undefined;
	const timeline = resolveSequenceTimeline({
		scene,
		sequence: scopedSequence,
		motion,
	});
	if (timeline.items.length <= 1) return undefined;
	return {
		id: scopedSequence.id,
		name: scopedSequence.name,
		fps: timeline.fps,
		totalFrames: timeline.totalFrames,
		itemCount: timeline.items.length,
		issueCount: timeline.issues.length,
		issueCodes: timeline.issueCodes,
		issues: timeline.issues.map(sceneSequenceIssue),
		items: timeline.items.map((item) => ({
			id: item.item.id,
			artboardId: item.artboard.id,
			artboardName: item.artboard.name,
			label: item.label,
			transition: item.transition.kind,
			startFrame: item.startFrame,
			endFrameExclusive: item.endFrameExclusive,
			durationFrames: item.durationFrames,
		})),
	};
};

const createArtboardScopeManifest = ({
	resolved,
	frameAssets,
	recipeAssets,
	sequenceAssets,
	rasterIntent,
	issues,
}: {
	readonly resolved: ResolvedExportArtboardScope;
	readonly frameAssets: readonly ExportArtboardFrameAssets[];
	readonly recipeAssets: readonly ExportArtboardRecipeAsset[];
	readonly sequenceAssets: readonly ExportArtboardSequenceAssets[];
	readonly rasterIntent?: RasterIntentExportAsset;
	readonly issues: readonly ExportArtboardIssue[];
}): ExportArtboardScopeManifest => {
	const primary = frameAssets[0];
	if (!primary) {
		throw new Error("Export requires at least one resolved artboard target.");
	}
	const sequenceByArtboardId = new Map(
		sequenceAssets.map(
			(sequence) => [sequence.target.metadata.id, sequence] as const,
		),
	);
	const recipeByArtboardId = new Map(
		recipeAssets.map(
			({ target, recipeAsset }) =>
				[target.metadata.id, recipeAsset.fileName] as const,
		),
	);
	const rasterFileNamesByArtboardId = rasterIntent
		? new Map(
				rasterIntent.rasterIntent.slices
					.reduce<Map<string, string[]>>((acc, slice) => {
						const names = acc.get(slice.artboard.id) ?? [];
						names.push(slice.fileName);
						acc.set(slice.artboard.id, names);
						return acc;
					}, new Map())
					.entries(),
			)
		: new Map<string, string[]>();

	return {
		scope: resolved.scope,
		requestedArtboardIds: resolved.requestedArtboardIds,
		defaultArtboardId: resolved.defaultArtboardId,
		currentArtboardId: resolved.currentArtboardId,
		primaryArtboardId: primary.target.metadata.id,
		exportedArtboardIds: frameAssets.map(({ target }) => target.metadata.id),
		available: resolved.available,
		exported: frameAssets.map(({ target, svgAsset, pdfAsset }) => {
			const sequence = sequenceByArtboardId.get(target.metadata.id);
			const animationSequence = sequence
				? createArtboardAnimationSequenceManifestEntry(sequence)
				: undefined;
			const rasterNames = rasterFileNamesByArtboardId.get(target.metadata.id);
			return {
				...target.metadata,
				assetFileNames: {
					svg: svgAsset.fileName,
					pdf: pdfAsset.fileName,
					...(recipeByArtboardId.get(target.metadata.id)
						? { recipe: recipeByArtboardId.get(target.metadata.id) }
						: {}),
					...(animationSequence
						? { animationSequence: animationSequence.assetFileNames }
						: {}),
					...(rasterNames ? { raster: rasterNames } : {}),
				},
				...(animationSequence ? { animationSequence } : {}),
			};
		}),
		issueCount: issues.length,
		issueCodes: artboardIssueCodes(issues),
		issueSummary: summarizeExportIssues(issues),
		issues,
	};
};

const createSourceOpticsManifest = (
	targets: readonly ResolvedExportArtboard[],
): ExportSourceOpticsManifest => {
	const rigs = targets.flatMap((target) =>
		sourceOpticsRigsForArtboard(target.scene.artboard),
	);
	return {
		rigCount: rigs.length,
		responseCount: rigs.reduce((total, rig) => total + rig.responses.length, 0),
		issueCount: targets.reduce(
			(total, target) =>
				total +
				buildSourceOpticsPresentation(
					target.scene,
					target.scene.artboard.id,
					"svg-export",
				).issues.length,
			0,
		),
		svg: "native",
		pdf: "unsupported",
		webm: "capture-only",
		directGpu: "deferred",
		generatedRuntime: "native",
	};
};

const createExportBundleManifest = ({
	scene,
	motion,
	frame,
	frameRange,
	motionPresentation,
	sceneCamera,
	sourceOptics,
	animationSequence,
	animationSequences,
	sceneSequence,
	vecCore,
	effectCapabilities,
	artboards,
	previewExport,
	assets,
}: CreateExportBundleInput & {
	readonly frame: number;
	readonly frameRange: ExportFrameRangeManifest;
	readonly motionPresentation: ExportMotionPresentationManifest;
	readonly sceneCamera: ExportSceneCameraManifest;
	readonly sourceOptics: ExportSourceOpticsManifest;
	readonly animationSequence?: ExportAnimationSequenceManifest;
	readonly animationSequences?: ExportAnimationSequencesManifest;
	readonly sceneSequence?: ExportSceneSequenceManifest;
	readonly vecCore?: VecCoreRecipeBundleManifest;
	readonly effectCapabilities?: ExportEffectCapabilitiesManifest;
	readonly artboards: ExportArtboardScopeManifest;
	readonly previewExport: ExportPreviewExportManifest;
	readonly assets: readonly ExportBundleAsset[];
}): ExportBundleManifest => {
	const visibleLayers = scene.layers.filter((layer) => layer.visible);
	const animatedNodeIds = [
		...new Set(motion.tracks.map((track) => track.target.nodeId)),
	].sort();
	const issues = manifestIssuesForAssets(assets);
	const vecCorePayloadByFileName = new Map(
		(vecCore?.payloads ?? []).map(
			(payload) => [payload.fileName, payload] as const,
		),
	);
	const rasterAsset = assets.find(
		(a): a is RasterIntentExportAsset => a.kind === "raster-intent-json",
	);
	const raster: ExportBundleRasterManifest | undefined = rasterAsset
		? {
				included: true,
				scope: rasterAsset.rasterIntent.scope,
				formats: rasterAsset.rasterIntent.formats,
				scales: rasterAsset.rasterIntent.scales,
				sliceCount: rasterAsset.rasterIntent.slices.length,
				issueCount: rasterAsset.rasterIntent.issueCount,
			}
		: undefined;

	return {
		exportFormat: BUNDLE_MANIFEST_FORMAT,
		sceneSchemaVersion: scene.schemaVersion,
		motionSchemaVersion: motion.schemaVersion,
		frame,
		frameRange,
		assetCount: assets.length,
		issueCount: issues.length,
		scene: {
			id: scene.id,
			name: scene.name,
			schemaVersion: scene.schemaVersion,
			layerCount: scene.layers.length,
			visibleLayerCount: visibleLayers.length,
			nodeCount: scene.layers.reduce(
				(total, layer) => total + countNodes(layer.nodes),
				0,
			),
			visibleNodeCount: visibleLayers.reduce(
				(total, layer) => total + countVisibleNodes(layer.nodes),
				0,
			),
			artboard: {
				id: scene.artboard.id,
				width: scene.artboard.width,
				height: scene.artboard.height,
				fps: scene.artboard.fps,
				durationFrames: scene.artboard.durationFrames,
			},
		},
		motion: {
			schemaVersion: motion.schemaVersion,
			fps: motion.fps,
			durationFrames: motion.durationFrames,
			trackCount: motion.tracks.length,
			clipCount: motion.clips.length,
			animatedNodeIds,
		},
		motionPresentation,
		sceneCamera,
		sourceOptics,
		...(animationSequence ? { animationSequence } : {}),
		...(animationSequences ? { animationSequences } : {}),
		...(sceneSequence ? { sceneSequence } : {}),
		...(vecCore ? { vecCore } : {}),
		...(effectCapabilities ? { effectCapabilities } : {}),
		bindableProperties: createExportBindablePropertiesManifest(),
		...(raster ? { raster } : {}),
		artboards,
		previewExport,
		issueSummary: summarizeExportIssues(issues),
		assets: assets.map((asset) =>
			manifestEntryForAsset(asset, vecCorePayloadByFileName),
		),
		issues,
	};
};

const createManifestAsset = ({
	scene,
	motion,
	frame,
	frameRange,
	motionPresentation,
	sceneCamera,
	sourceOptics,
	animationSequence,
	animationSequences,
	sceneSequence,
	vecCore,
	effectCapabilities,
	artboards,
	previewExport,
	payloadAssets,
}: CreateExportBundleInput & {
	readonly frame: number;
	readonly frameRange: ExportFrameRangeManifest;
	readonly motionPresentation: ExportMotionPresentationManifest;
	readonly sceneCamera: ExportSceneCameraManifest;
	readonly sourceOptics: ExportSourceOpticsManifest;
	readonly animationSequence?: ExportAnimationSequenceManifest;
	readonly animationSequences?: ExportAnimationSequencesManifest;
	readonly sceneSequence?: ExportSceneSequenceManifest;
	readonly vecCore?: VecCoreRecipeBundleManifest;
	readonly effectCapabilities?: ExportEffectCapabilitiesManifest;
	readonly artboards: ExportArtboardScopeManifest;
	readonly previewExport: ExportPreviewExportManifest;
	readonly payloadAssets: readonly ExportBundleAsset[];
}): ExportManifestAsset => {
	const manifestShell: ExportManifestAsset = {
		kind: "manifest-json",
		fileName: `${fileStemForScene(scene)}.manifest.json`,
		mimeType: JSON_MIME_TYPE,
		contents: "",
	};
	const assets = [manifestShell, ...payloadAssets];
	const manifest = createExportBundleManifest({
		scene,
		motion,
		frame,
		frameRange,
		motionPresentation,
		sceneCamera,
		sourceOptics,
		animationSequence,
		animationSequences,
		...(sceneSequence ? { sceneSequence } : {}),
		vecCore,
		effectCapabilities,
		artboards,
		previewExport,
		assets,
	});

	return {
		...manifestShell,
		contents: stableJsonStringify(manifest),
	};
};

const createArtboardFrameAssets = ({
	targets,
	motion,
	frame,
	grammarBindings,
}: {
	readonly targets: readonly ResolvedExportArtboard[];
	readonly motion: MotionDocument;
	readonly frame: number;
	readonly grammarBindings?: readonly MotionGrammarBinding[];
}): readonly ExportArtboardFrameAssets[] =>
	targets.map((target) => {
		const renderPresentation = buildExportRenderPresentation({
			scene: target.scene,
			motion,
			frame,
			grammarBindings,
		});
		const svgAsset = {
			...createSvgExport({
				scene: target.scene,
				motion,
				frame,
				fileNameStem: target.fileStem,
				renderPresentation,
			}),
			artboard: target.metadata,
		};
		const pdfAsset = {
			...createPdfExport({
				scene: target.scene,
				motion,
				frame,
				fileNameStem: target.fileStem,
				renderPresentation,
			}),
			artboard: target.metadata,
		};
		return { target, svgAsset, pdfAsset };
	});

const createArtboardSequenceAssets = ({
	sourceScene,
	targets,
	motion,
	frameRange,
	includeMotionMetadata,
	grammarBindings,
}: {
	readonly sourceScene: SceneDocument;
	readonly targets: readonly ResolvedExportArtboard[];
	readonly motion: MotionDocument;
	readonly frameRange: ExportFrameRangeManifest;
	readonly includeMotionMetadata: boolean;
	readonly grammarBindings?: readonly MotionGrammarBinding[];
}): readonly ExportArtboardSequenceAssets[] =>
	targets.map((target) => {
		const sequenceMotion = scopedMotionForSequence({
			sourceScene,
			targetScene: target.scene,
			motion,
		});
		const sequence = createAnimationSequenceExport({
			scene: target.scene,
			motion: sequenceMotion,
			frameRange,
			includeMotionMetadata,
			fileNameStem: target.fileStem,
			grammarBindings,
		});
		return {
			target,
			manifest: sequence.manifest,
			jsonAsset: {
				...sequence.jsonAsset,
				artboard: target.metadata,
			},
			svgAsset: {
				...sequence.svgAsset,
				artboard: target.metadata,
			},
		};
	});

const createArtboardRecipeAssets = ({
	targets,
	motion,
	frame,
	grammarBindings,
}: {
	readonly targets: readonly ResolvedExportArtboard[];
	readonly motion: MotionDocument;
	readonly frame: number;
	readonly grammarBindings?: readonly MotionGrammarBinding[];
}): readonly ExportArtboardRecipeAsset[] =>
	targets.flatMap((target) => {
		const renderPresentation = buildExportRenderPresentation({
			scene: target.scene,
			motion,
			frame,
			grammarBindings,
		});
		const recipeAsset = createVecCoreRecipeJsonExport({
			scene: renderPresentation.scene,
			frame,
			fileNameStem: target.fileStem,
		});
		if (!recipeAsset) return [];
		return [
			{
				target,
				recipeAsset: {
					...recipeAsset,
					artboard: target.metadata,
				},
			},
		];
	});

const framePayloadAssets = (
	frameAssets: readonly ExportArtboardFrameAssets[],
): readonly ExportBundleAsset[] =>
	frameAssets.flatMap(({ svgAsset, pdfAsset }) => [svgAsset, pdfAsset]);

const sequencePayloadAssets = (
	sequenceAssets: readonly ExportArtboardSequenceAssets[],
): readonly ExportBundleAsset[] =>
	sequenceAssets.flatMap(({ jsonAsset, svgAsset }) => [jsonAsset, svgAsset]);

const recipePayloadAssets = (
	recipeAssets: readonly ExportArtboardRecipeAsset[],
): readonly ExportBundleAsset[] =>
	recipeAssets.map(({ recipeAsset }) => recipeAsset);

const STROKE_WIDTH_PROFILE_BAKE_FALLBACK_MESSAGE: Readonly<
	Record<StrokeWidthProfileBakeFallback["reason"], string>
> = {
	"path-shape-track":
		"This node keeps its tapered stroke outline in the editor and in SVG/PDF export, but a live pathShape keyframe track re-samples its original open spine every frame; baking a static outline here would freeze or hide the shape animation, so this runtime export falls back to a uniform-width stroke for this node.",
	"visible-fill":
		"This node keeps its tapered stroke outline in the editor and in SVG/PDF export, but it also paints a visible fill alongside the profiled stroke; a bake can only represent one filled shape per node, which would drop the fill or misapply its color, so this runtime export falls back to a uniform-width stroke for this node.",
};

const sceneJsonIssueCodeForBakeFallbackReason = (
	reason: StrokeWidthProfileBakeFallback["reason"],
): SceneJsonExportIssueCode =>
	reason === "path-shape-track"
		? "stroke-width-profile-path-shape-track-unbaked"
		: "stroke-width-profile-visible-fill-unbaked";

/**
 * Converts {@link bakeStrokeWidthProfiles}'s excluded-node facts into typed
 * export issues on the `scene-json` asset, mirroring how `svg.ts`/`pdf.ts`
 * report their own appearance fallbacks — see `stroke-outline.ts`'s
 * `hasPathShapeTrack`/`hasVisibleFill` for why these two node classes fall
 * back to a uniform stroke in Motion/Code and WebGL runtime exports even
 * though the editor canvas and SVG/PDF export keep rendering the taper.
 */
const sceneJsonIssuesForStrokeWidthProfileBakeFallbacks = (
	fallbacks: readonly StrokeWidthProfileBakeFallback[],
): readonly SceneJsonExportIssue[] =>
	fallbacks.map((fallback) => ({
		severity: "warning",
		category: "fallback",
		code: sceneJsonIssueCodeForBakeFallbackReason(fallback.reason),
		message: STROKE_WIDTH_PROFILE_BAKE_FALLBACK_MESSAGE[fallback.reason],
		fallback: "uniform-stroke-width",
		layerId: fallback.layerId,
		nodeId: fallback.nodeId,
	}));

/**
 * Builds the first-class deliverables for the preview/export stream: canonical
 * manifest JSON, scene JSON, side-car motion JSON, frame-sampled SVG, and PDF.
 * The returned bundle is deterministic for the same scene, motion, frame range,
 * and metadata options.
 */
export function createExportBundle({
	scene,
	motion,
	frame,
	currentFrame,
	frameRange: requestedFrameRange,
	artboardScope: requestedArtboardScope,
	includeMotionMetadata = true,
	grammarBindings,
	grammarFidelityIssues = [],
	rasterExport,
}: CreateExportBundleInput): ExportBundle {
	const persistedGrammarFidelityIssues =
		grammarFidelityIssues.length > 0
			? grammarFidelityIssues
			: (() => {
					const parsed = parseMotionGrammarLayer(motion.grammar);
					return persistedMotionGrammarFidelityIssuesForExport({
						passthrough: parsed.passthrough,
						diagnostics: parsed.issues,
					});
				})();
	const sampledFrame = clampExportFrame(
		currentFrame ?? frame ?? 0,
		motion.durationFrames,
	);
	const resolvedArtboards = resolveExportArtboardScope(
		scene,
		requestedArtboardScope,
	);
	const frameAssets = createArtboardFrameAssets({
		targets: resolvedArtboards.targets,
		motion,
		frame: sampledFrame,
		grammarBindings,
	});
	const recipeAssets = createArtboardRecipeAssets({
		targets: resolvedArtboards.targets,
		motion,
		frame: sampledFrame,
		grammarBindings,
	});
	const primaryTarget = frameAssets[0]?.target;
	if (!primaryTarget) {
		throw new Error("Export requires at least one resolved artboard target.");
	}
	const frameRange = createFrameRangeManifest({
		motion,
		currentFrame: sampledFrame,
		frameRange: requestedFrameRange,
	});
	const motionPresentation = createMotionPresentationManifest({
		scene,
		motion,
		frameRange,
		includeMotionMetadata,
		grammarBindings,
	});
	const sequenceAssets = requestedFrameRange
		? createArtboardSequenceAssets({
				sourceScene: scene,
				targets: resolvedArtboards.targets,
				motion,
				frameRange,
				includeMotionMetadata,
				grammarBindings,
			})
		: [];
	const animationSequences = createAnimationSequencesManifest(sequenceAssets);
	const animationSequence = sequenceAssets[0]?.manifest;
	const sceneSequence = createSceneSequenceManifest({
		scene,
		motion,
		allowedArtboardIds: new Set(
			resolvedArtboards.targets.map((target) => target.metadata.id),
		),
	});
	const vecCore = createVecCoreRecipeBundleManifest(
		recipeAssets.map(({ recipeAsset }) => recipeAsset),
	);
	const effectCapabilities = createExportEffectCapabilitiesManifest(
		recipeAssets.map(({ recipeAsset }) => recipeAsset.payload),
	);
	const rasterIntentAsset = rasterExport
		? createRasterExportIntents({
				scene,
				targets: resolvedArtboards.targets.map((t) => t.metadata),
				scope: resolvedArtboards.scope,
				formats: rasterExport.formats,
				scales: rasterExport.scales,
				jpegQuality: rasterExport.jpegQuality,
			})
		: undefined;
	const artboards = createArtboardScopeManifest({
		resolved: resolvedArtboards,
		frameAssets,
		recipeAssets,
		sequenceAssets,
		rasterIntent: rasterIntentAsset,
		issues: resolvedArtboards.issues,
	});
	const sceneCamera = createSceneCameraManifest({
		scene,
		motion,
		frame: sampledFrame,
		targets: resolvedArtboards.targets,
	});
	const sourceOptics = createSourceOpticsManifest(resolvedArtboards.targets);
	// Bake variable-width stroke profiles into plain closed-path geometry ONLY for
	// the embedded scene-json payload the generated runtime code/WebGL players
	// consume (see `bakeStrokeWidthProfiles`'s doc) — this is the single point
	// `scene` is serialized into that payload. Every other consumer of `scene` in
	// this function (frame SVG/PDF, vec-core recipes, sequences, manifests) keeps
	// the real profiled document, so the SVG export path still renders profiled
	// strokes as tapered outlines natively via `svg.ts`'s own outline branch.
	const strokeWidthProfileBake = bakeStrokeWidthProfiles(scene, motion);
	const sceneAsset: SceneJsonExportAsset = {
		...createSceneJsonExport(strokeWidthProfileBake.document),
		kind: "scene-json",
		issues: sceneJsonIssuesForStrokeWidthProfileBakeFallbacks(
			strokeWidthProfileBake.fallbacks,
		),
	};
	const motionAsset: MotionJsonExportAsset = {
		...createMotionJsonExport(scene, motion),
		kind: "motion-json",
		issues: persistedGrammarFidelityIssues,
	};
	const previewExport = createPreviewExportManifest({
		frame: sampledFrame,
		motionPresentation,
		artboardScope: artboards,
		vecCore,
		frameAssets,
		recipeAssets,
		sequenceAssets,
	});
	const payloadAssets = [
		sceneAsset,
		motionAsset,
		...recipePayloadAssets(recipeAssets),
		...framePayloadAssets(frameAssets),
		...sequencePayloadAssets(sequenceAssets),
		...(rasterIntentAsset ? [rasterIntentAsset] : []),
	] satisfies readonly ExportBundleAsset[];
	const manifestAsset = createManifestAsset({
		scene,
		motion,
		frame: sampledFrame,
		frameRange,
		motionPresentation,
		sceneCamera,
		sourceOptics,
		animationSequence,
		animationSequences,
		...(sceneSequence ? { sceneSequence } : {}),
		vecCore,
		effectCapabilities,
		artboards,
		previewExport,
		payloadAssets,
	});

	return {
		sceneSchemaVersion: scene.schemaVersion,
		motionSchemaVersion: motion.schemaVersion,
		frame: sampledFrame,
		frameRange,
		artboards,
		motionPresentation,
		sceneCamera,
		sourceOptics,
		...(animationSequence ? { animationSequence } : {}),
		...(animationSequences ? { animationSequences } : {}),
		...(sceneSequence ? { sceneSequence } : {}),
		...(vecCore ? { vecCore } : {}),
		...(effectCapabilities ? { effectCapabilities } : {}),
		assets: [manifestAsset, ...payloadAssets],
	};
}
