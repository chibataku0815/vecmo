import { useMotionStore } from "@/entities/motion/model/store";
import type { MotionDocument } from "@/entities/motion/model/types";
import type { MotionGrammarStoreDocument } from "@/entities/motion-grammar/model/command";
import { useMotionGrammarStore } from "@/entities/motion-grammar/model/store";
import type { MotionGrammarBinding } from "@/entities/motion-grammar/model/types";
import { useSceneStore } from "@/entities/scene/model/store";
import type { SceneDocument } from "@/entities/scene/model/types";
import {
	downloadAssets,
	downloadTextAssetArchive,
} from "@/features/export/adapters/download";
import type { ExportBundleAsset } from "@/features/export/model/bundle";
import type {
	MotionCodeDataAsset,
	MotionCodeHtmlAsset,
	MotionCodeReactAsset,
	MotionCodeRuntimeAsset,
	MotionCodeSharedRuntimeAsset,
} from "@/features/export/model/code";
import type { ExportIssue } from "@/features/export/model/issues";
import {
	type ExportMotionGrammarFidelityIssue,
	persistedMotionGrammarFidelityIssuesForExport,
} from "@/features/export/model/motion-grammar-fidelity";
import {
	type ExportOptimizationOptions,
	type ExportOptimizationProfile,
	projectExportRuntimeData,
} from "@/features/export/model/optimization";
import type { RuntimeAssetManifestAsset } from "@/features/export/model/runtime-manifest";
import type { RuntimeTypesAsset } from "@/features/export/model/runtime-player-declarations";
import type {
	WebglPlayerDataAsset,
	WebglPlayerHtmlAsset,
	WebglPlayerReactAsset,
	WebglPlayerRuntimeAsset,
	WebglPlayerSharedRuntimeAsset,
} from "@/features/export/model/webgl-player";
import { useTransportStore } from "@/features/motion/model/transport-store";
import type {
	ExportReportAssetRole,
	ExportReportModel,
	ExportReportOptimization,
} from "./export-report";

export type ExportSnapshot = {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly grammarBindings: readonly MotionGrammarBinding[];
	readonly grammar: MotionGrammarStoreDocument;
	/** Safe export diagnostics for durable passthrough grammar only. */
	readonly grammarFidelityIssues: readonly ExportMotionGrammarFidelityIssue[];
	readonly frame: number;
};

export type ExportFrameRangeReport = ExportReportModel["frameRange"];
export type ExportArtboardScopeReport = ExportReportModel["artboardScope"];

export const currentExportSnapshot = (): ExportSnapshot => {
	const grammar = useMotionGrammarStore.getState().document;
	return {
		scene: useSceneStore.getState().document,
		motion: useMotionStore.getState().document,
		grammar,
		grammarBindings: grammar.bindings,
		grammarFidelityIssues: persistedMotionGrammarFidelityIssuesForExport({
			passthrough: grammar.passthrough,
			diagnostics: grammar.diagnostics,
		}),
		frame: useTransportStore.getState().currentFrame,
	};
};

export const currentFrameRangeReport = ({
	motion,
	frame,
}: ExportSnapshot): ExportFrameRangeReport => ({
	mode: "current-frame",
	currentFrame: frame,
	fps: motion.fps,
	durationFrames: motion.durationFrames,
	startFrame: frame,
	endFrame: frame,
	stepFrames: 1,
	frameCount: 1,
	frames: [frame],
});

export const fullMotionFrameRangeReport = ({
	motion,
	frame,
}: ExportSnapshot): ExportFrameRangeReport => {
	const frameCount = Math.max(1, Math.trunc(motion.durationFrames));
	const endFrame = Math.max(0, frameCount - 1);
	return {
		mode: "frame-range",
		currentFrame: frame,
		fps: motion.fps,
		durationFrames: motion.durationFrames,
		startFrame: 0,
		endFrame,
		stepFrames: 1,
		frameCount,
		frames: Array.from({ length: frameCount }, (_, index) => index),
	};
};

/**
 * Replays the same source-free grammar projection used by runtime generators so
 * the TopBar can report a hidden-scope relation omission without inspecting or
 * serializing a passthrough binding's raw parameters.
 */
export const motionCodeGrammarFidelityIssuesForExport = (
	snapshot: ExportSnapshot,
	options: ExportOptimizationOptions,
): readonly ExportMotionGrammarFidelityIssue[] => [
	...snapshot.grammarFidelityIssues,
	...projectExportRuntimeData({
		scene: snapshot.scene,
		motion: snapshot.motion,
		grammarBindings: snapshot.grammarBindings,
		options,
	}).grammarFidelityIssues,
];

export const standaloneScopeReport = ({
	mode,
	targetCount,
	targetNames,
}: {
	readonly mode: ExportArtboardScopeReport["mode"];
	readonly targetCount: number;
	readonly targetNames: readonly string[];
}): ExportArtboardScopeReport => ({
	mode,
	requestedCount: targetCount,
	availableCount: targetCount,
	exportedCount: targetCount,
	issueCount: 0,
	currentArtboardId: "",
	primaryArtboardId: "",
	exportedArtboardNames: targetNames,
});

export type MotionCodeReportAsset =
	| ExportBundleAsset
	| MotionCodeRuntimeAsset
	| MotionCodeSharedRuntimeAsset
	| MotionCodeDataAsset
	| MotionCodeHtmlAsset
	| MotionCodeReactAsset
	| RuntimeTypesAsset
	| RuntimeAssetManifestAsset
	| WebglPlayerRuntimeAsset
	| WebglPlayerSharedRuntimeAsset
	| WebglPlayerDataAsset
	| WebglPlayerHtmlAsset
	| WebglPlayerReactAsset;

/** Runtime/data assets whose issues describe the exact shipped payload. */
export type RuntimePayloadIssueAsset =
	| MotionCodeRuntimeAsset
	| MotionCodeDataAsset
	| WebglPlayerRuntimeAsset
	| WebglPlayerDataAsset;

export type RuntimePayloadExportIssue = {
	readonly asset: RuntimePayloadIssueAsset;
	readonly issue: ExportIssue;
};

export const motionCodeReportAssetRole = (
	asset: MotionCodeReportAsset,
): ExportReportAssetRole => {
	switch (asset.kind) {
		case "manifest-json":
			return "bundle-manifest";
		case "scene-json":
			return "scene-document";
		case "motion-json":
			return "motion-document";
		case "recipe-json":
			return "vec-core-recipe-payload";
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
		case "runtime-js":
			return "runtime-code";
		case "runtime-shared-js":
			return "runtime-code";
		case "runtime-data-json":
			return "runtime-code";
		case "runtime-html":
			return "runtime-code";
		case "runtime-react":
		case "runtime-types":
			return "runtime-code";
		case "runtime-manifest-json":
			return "runtime-code";
		case "webgl-runtime-js":
			return "runtime-code";
		case "webgl-shared-runtime-js":
			return "runtime-code";
		case "webgl-data-json":
			return "runtime-code";
		case "webgl-runtime-html":
		case "webgl-runtime-react":
			return "runtime-code";
	}
};

export const textAssetByteLength = (asset: {
	readonly contents: string;
}): number => new TextEncoder().encode(asset.contents).byteLength;

export const textAssetsByteLength = (
	assets: readonly { readonly contents: string }[],
): number =>
	assets.reduce((total, asset) => total + textAssetByteLength(asset), 0);

const motionCodeArchiveFileName = (
	assets: readonly { readonly fileName: string }[],
): string => {
	const entry =
		assets.find(
			(asset) =>
				asset.fileName.endsWith(".html") ||
				asset.fileName.endsWith(".runtime-manifest.json"),
		) ?? assets[0];
	const stem =
		entry?.fileName
			.replace(/\.runtime-manifest\.json$/u, "")
			.replace(/\.html$/u, "") || "motion-code-export";
	return `${stem}.zip`;
};

export const downloadMotionCodeAssets = (
	assets: readonly MotionCodeReportAsset[],
): void => {
	if (assets.length <= 1) {
		downloadAssets(assets);
		return;
	}
	downloadTextAssetArchive(motionCodeArchiveFileName(assets), assets);
};

export const createMotionCodeOptimizationSummary = ({
	profile,
	runtimePackaging,
	beforeBytes,
	afterBytes,
}: {
	readonly profile: ExportOptimizationProfile;
	readonly runtimePackaging: ExportReportOptimization["runtimePackaging"];
	readonly beforeBytes: number;
	readonly afterBytes: number;
}): ExportReportOptimization => {
	const savedBytes = Math.max(0, beforeBytes - afterBytes);
	return {
		profile,
		runtimePackaging,
		beforeBytes,
		afterBytes,
		savedBytes,
		savedRatio: beforeBytes > 0 ? savedBytes / beforeBytes : 0,
	};
};

const isSharedRuntimeAsset = (asset: MotionCodeReportAsset): boolean =>
	asset.kind === "runtime-shared-js" ||
	asset.kind === "webgl-shared-runtime-js" ||
	(asset.kind === "runtime-types" && asset.shared);

export const dedupeDownloadAssets = <Asset extends MotionCodeReportAsset>(
	assets: readonly Asset[],
): readonly Asset[] => {
	const seen = new Set<string>();
	const deduped: Asset[] = [];
	for (const asset of assets) {
		if (!isSharedRuntimeAsset(asset)) {
			deduped.push(asset);
			continue;
		}
		const key = `${asset.kind}:${asset.fileName}`;
		if (seen.has(key)) continue;
		seen.add(key);
		deduped.push(asset);
	}
	return deduped;
};

export const motionCodeReportIssueCodes = (
	asset: MotionCodeReportAsset,
): readonly string[] =>
	"issues" in asset
		? [...new Set(asset.issues.map((issue) => issue.code))]
		: [];

export const motionCodeReportIssueCount = (
	asset: MotionCodeReportAsset,
): number => ("issues" in asset ? asset.issues.length : 0);

const isRuntimePayloadIssueAsset = (
	asset: MotionCodeReportAsset,
): asset is RuntimePayloadIssueAsset =>
	asset.kind === "runtime-js" ||
	asset.kind === "runtime-data-json" ||
	asset.kind === "webgl-runtime-js" ||
	asset.kind === "webgl-data-json";

/**
 * Returns fidelity issues once from the concrete embedded/data payload that
 * ships them. Support assets intentionally stay out so editable Motion/Code
 * archives do not duplicate the same delivery fact in the TopBar report.
 */
export const motionCodeRuntimePayloadIssues = (
	assets: readonly MotionCodeReportAsset[],
): readonly RuntimePayloadExportIssue[] =>
	assets.flatMap((asset) =>
		isRuntimePayloadIssueAsset(asset)
			? asset.issues.map((issue) => ({ asset, issue }))
			: [],
	);
