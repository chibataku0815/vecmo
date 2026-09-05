import type { SceneDocument } from "@/entities/scene/model/types";
import type {
	ExportArtboardAssetMetadata,
	ExportArtboardScopeMode,
} from "./artboards";
import type {
	ExportIssue,
	ExportIssueFallback,
	ExportIssueSummary,
} from "./issues";
import { summarizeExportIssues } from "./issues";
import type { ExportAsset } from "./json";
import { fileStemForScene, stableJsonStringify } from "./json";

export type RasterFormat = "png" | "jpeg";

export type RasterScale = 1 | 2 | 3 | 4;

export type RasterQuality = {
	readonly format: RasterFormat;
	readonly scale: RasterScale;
	readonly jpegQuality?: number;
};

const RASTER_SCALES: readonly RasterScale[] = [1, 2, 3, 4];

const DEFAULT_JPEG_QUALITY = 0.92;
const MAX_RASTER_DIMENSION = 16384;

export type RasterIssueCode =
	| "raster-dimension-exceeds-limit"
	| "raster-image-reference-unresolved"
	| "raster-blend-mode-unsupported"
	| "raster-effect-unsupported"
	| "raster-font-unavailable"
	| "raster-gradient-mesh-unsupported";

export type RasterIssue = ExportIssue & {
	readonly code: RasterIssueCode;
};

const RASTER_ISSUE_FALLBACKS: Readonly<
	Record<RasterIssueCode, ExportIssueFallback>
> = {
	"raster-dimension-exceeds-limit": "normalized-value",
	"raster-image-reference-unresolved": "external-image-reference",
	"raster-blend-mode-unsupported": "default-color",
	"raster-effect-unsupported": "default-color",
	"raster-font-unavailable": "font-substitution",
	"raster-gradient-mesh-unsupported": "default-color",
};

export type RasterSliceTarget = {
	readonly artboard: ExportArtboardAssetMetadata;
	readonly format: RasterFormat;
	readonly scale: RasterScale;
	readonly outputWidth: number;
	readonly outputHeight: number;
	readonly fileName: string;
	readonly mimeType: string;
	readonly jpegQuality?: number;
	readonly issues: readonly RasterIssue[];
	readonly issueSummary: ExportIssueSummary;
};

export type RasterExportIntent = {
	readonly scope: ExportArtboardScopeMode;
	readonly formats: readonly RasterFormat[];
	readonly scales: readonly RasterScale[];
	readonly maxDimension: number;
	readonly slices: readonly RasterSliceTarget[];
	readonly issueCount: number;
	readonly issueCodes: readonly RasterIssueCode[];
	readonly issueSummary: ExportIssueSummary;
};

export type RasterIntentExportAsset = ExportAsset & {
	readonly kind: "raster-intent-json";
	readonly rasterIntent: RasterExportIntent;
};

export type CreateRasterExportIntentsInput = {
	readonly scene: SceneDocument;
	readonly targets: readonly ExportArtboardAssetMetadata[];
	readonly scope?: ExportArtboardScopeMode;
	readonly formats?: readonly RasterFormat[];
	readonly scales?: readonly RasterScale[];
	readonly jpegQuality?: number;
};

const mimeTypeForFormat = (format: RasterFormat): string => {
	switch (format) {
		case "png":
			return "image/png";
		case "jpeg":
			return "image/jpeg";
	}
};

const extensionForFormat = (format: RasterFormat): string => {
	switch (format) {
		case "png":
			return "png";
		case "jpeg":
			return "jpg";
	}
};

const scaleSuffix = (scale: RasterScale): string =>
	scale === 1 ? "" : `@${scale}x`;

const clampDimension = (value: number): number =>
	Math.min(Math.max(Math.round(value), 1), MAX_RASTER_DIMENSION);

function collectSliceIssues(
	artboard: ExportArtboardAssetMetadata,
	scale: RasterScale,
	outputWidth: number,
	outputHeight: number,
): readonly RasterIssue[] {
	const issues: RasterIssue[] = [];

	if (
		outputWidth > MAX_RASTER_DIMENSION ||
		outputHeight > MAX_RASTER_DIMENSION
	) {
		issues.push({
			severity: "warning",
			category: "normalized",
			code: "raster-dimension-exceeds-limit",
			message: `Artboard "${artboard.name}" at ${scale}x produces ${outputWidth}×${outputHeight} which exceeds the ${MAX_RASTER_DIMENSION}px limit; output will be clamped.`,
			fallback: RASTER_ISSUE_FALLBACKS["raster-dimension-exceeds-limit"],
			artboardId: artboard.id,
		});
	}

	return issues;
}

function buildSliceTarget(
	artboard: ExportArtboardAssetMetadata,
	fileStem: string,
	format: RasterFormat,
	scale: RasterScale,
	jpegQuality: number | undefined,
): RasterSliceTarget {
	const rawWidth = artboard.width * scale;
	const rawHeight = artboard.height * scale;
	const issues = collectSliceIssues(artboard, scale, rawWidth, rawHeight);
	const outputWidth = clampDimension(rawWidth);
	const outputHeight = clampDimension(rawHeight);
	const ext = extensionForFormat(format);
	const suffix = scaleSuffix(scale);
	const artboardSlug =
		artboard.name
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || artboard.id;
	const fileName = `${fileStem}-${artboardSlug}${suffix}.${ext}`;

	return {
		artboard,
		format,
		scale,
		outputWidth,
		outputHeight,
		fileName,
		mimeType: mimeTypeForFormat(format),
		...(format === "jpeg"
			? { jpegQuality: jpegQuality ?? DEFAULT_JPEG_QUALITY }
			: {}),
		issues,
		issueSummary: summarizeExportIssues(issues),
	};
}

export function createRasterExportIntents({
	scene,
	targets,
	scope = "all",
	formats = ["png"],
	scales = [1],
	jpegQuality,
}: CreateRasterExportIntentsInput): RasterIntentExportAsset {
	const fileStem = fileStemForScene(scene);
	const validScales = scales.filter((s): s is RasterScale =>
		RASTER_SCALES.includes(s as RasterScale),
	);
	const effectiveScales = validScales.length > 0 ? validScales : ([1] as const);

	const slices: RasterSliceTarget[] = [];
	for (const target of targets) {
		for (const format of formats) {
			for (const scale of effectiveScales) {
				slices.push(
					buildSliceTarget(target, fileStem, format, scale, jpegQuality),
				);
			}
		}
	}

	const allIssues = slices.flatMap((slice) => slice.issues);
	const issueCodes = [
		...new Set(allIssues.map((issue) => issue.code as RasterIssueCode)),
	].sort();

	const rasterIntent: RasterExportIntent = {
		scope,
		formats: [...new Set(formats)].sort(),
		scales: [...effectiveScales].sort((a, b) => a - b),
		maxDimension: MAX_RASTER_DIMENSION,
		slices,
		issueCount: allIssues.length,
		issueCodes,
		issueSummary: summarizeExportIssues(allIssues),
	};

	return {
		kind: "raster-intent-json",
		fileName: `${fileStem}.raster-intent.json`,
		mimeType: "application/json;charset=utf-8",
		contents: stableJsonStringify(rasterIntent),
		rasterIntent,
	};
}

export function rasterFileNamesForArtboard(
	artboard: ExportArtboardAssetMetadata,
	fileStem: string,
	formats: readonly RasterFormat[],
	scales: readonly RasterScale[],
): readonly string[] {
	const names: string[] = [];
	for (const format of formats) {
		for (const scale of scales) {
			const ext = extensionForFormat(format);
			const suffix = scaleSuffix(scale);
			const artboardSlug =
				artboard.name
					.trim()
					.toLowerCase()
					.replace(/[^a-z0-9]+/g, "-")
					.replace(/^-+|-+$/g, "") || artboard.id;
			names.push(`${fileStem}-${artboardSlug}${suffix}.${ext}`);
		}
	}
	return names;
}
