import { isImageDataUrl } from "@/entities/scene/model/assets";
import type {
	PlaceImageNodeInput,
	PlaceImageNodeOptions,
} from "@/entities/scene/model/node-commands";
import {
	allNodes,
	selectCurrentArtboard,
} from "@/entities/scene/model/selectors";
import type {
	Bounds,
	ImageAssetSource,
	SceneDocument,
} from "@/entities/scene/model/types";
import type { ImportIssue } from "@/features/import/model/types";

const SUPPORTED_IMAGE_MIME_TYPES = [
	"image/png",
	"image/jpeg",
	"image/webp",
] as const;

export type SupportedRasterImageMimeType =
	(typeof SUPPORTED_IMAGE_MIME_TYPES)[number];

const IMAGE_EXTENSION_MIME_TYPES: Readonly<
	Record<string, SupportedRasterImageMimeType>
> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
} as const;

const RASTER_IMAGE_EXTENSIONS = new Set([
	...Object.keys(IMAGE_EXTENSION_MIME_TYPES),
	"avif",
	"bmp",
	"gif",
	"heic",
	"heif",
	"tif",
	"tiff",
]);

const IMAGE_MAX_ARTBOARD_RATIO = 0.68;
const FALLBACK_IMAGE_ASPECT_RATIO = 4 / 3;
const MIN_PLACEMENT_SIDE = 24;
const DEFAULT_PLACEMENT_WIDTH = 320;

export type RasterImageIntrinsicSize = {
	readonly width: number;
	readonly height: number;
};

export type RasterImagePlacementPlan = {
	readonly assetId: string;
	readonly nodeId: string;
	readonly sourceName: string;
	readonly sourceFormat: SupportedRasterImageMimeType;
	readonly issues: readonly ImportIssue[];
	readonly commandInput: PlaceImageNodeInput;
	readonly commandOptions: PlaceImageNodeOptions;
};

const extensionFor = (sourceName: string): string => {
	const trimmed = sourceName.trim().toLowerCase();
	const extension = trimmed.split(".").at(-1);
	return extension && extension !== trimmed ? extension : "";
};

const normalizedSourceName = (sourceName: string): string => {
	const trimmed = sourceName.trim();
	return trimmed.length > 0 ? trimmed : "Untitled image";
};

const stemFor = (sourceName: string): string => {
	const name = normalizedSourceName(sourceName);
	const dotIndex = name.lastIndexOf(".");
	const stem = dotIndex > 0 ? name.slice(0, dotIndex) : name;
	const slug = stem
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug.length > 0 ? slug : "image";
};

const uniqueId = (usedIds: ReadonlySet<string>, baseId: string): string => {
	if (!usedIds.has(baseId)) return baseId;
	let suffix = 2;
	let candidate = `${baseId}-${suffix}`;
	while (usedIds.has(candidate)) {
		suffix += 1;
		candidate = `${baseId}-${suffix}`;
	}
	return candidate;
};

const supportedMimeTypeFrom = (
	sourceName: string,
	mimeType?: string,
): SupportedRasterImageMimeType | null => {
	const normalized = mimeType?.trim().toLowerCase();
	if (
		normalized &&
		SUPPORTED_IMAGE_MIME_TYPES.includes(
			normalized as SupportedRasterImageMimeType,
		)
	) {
		return normalized as SupportedRasterImageMimeType;
	}
	return IMAGE_EXTENSION_MIME_TYPES[extensionFor(sourceName)] ?? null;
};

const finitePositive = (value: number | undefined): number | null =>
	Number.isFinite(value) && (value ?? 0) > 0 ? (value ?? 0) : null;

const normalizeIntrinsicSize = (
	size: RasterImageIntrinsicSize | null | undefined,
): RasterImageIntrinsicSize | null => {
	const width = finitePositive(size?.width);
	const height = finitePositive(size?.height);
	return width && height ? { width, height } : null;
};

const roundPlacementValue = (value: number): number =>
	Math.round(value * 100) / 100;

/**
 * Fits the source image into the current artboard without upscaling. Bounds are
 * artboard-local because image nodes carry `artboardId`; pasteboard position is
 * applied later by the canvas/export renderers.
 */
export function createRasterImagePlacementBounds(
	artboard: { readonly width: number; readonly height: number },
	intrinsicSize: RasterImageIntrinsicSize | null | undefined,
): Bounds {
	const artboardWidth =
		finitePositive(artboard.width) ?? DEFAULT_PLACEMENT_WIDTH;
	const artboardHeight =
		finitePositive(artboard.height) ??
		DEFAULT_PLACEMENT_WIDTH / FALLBACK_IMAGE_ASPECT_RATIO;
	const normalizedIntrinsic = normalizeIntrinsicSize(intrinsicSize);
	const sourceWidth = normalizedIntrinsic?.width ?? DEFAULT_PLACEMENT_WIDTH;
	const sourceHeight =
		normalizedIntrinsic?.height ??
		DEFAULT_PLACEMENT_WIDTH / FALLBACK_IMAGE_ASPECT_RATIO;
	const maxWidth = Math.max(
		MIN_PLACEMENT_SIDE,
		artboardWidth * IMAGE_MAX_ARTBOARD_RATIO,
	);
	const maxHeight = Math.max(
		MIN_PLACEMENT_SIDE,
		artboardHeight * IMAGE_MAX_ARTBOARD_RATIO,
	);
	const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight);
	const width = Math.max(MIN_PLACEMENT_SIDE, sourceWidth * scale);
	const height = Math.max(MIN_PLACEMENT_SIDE, sourceHeight * scale);

	return {
		x: roundPlacementValue((artboardWidth - width) / 2),
		y: roundPlacementValue((artboardHeight - height) / 2),
		width: roundPlacementValue(width),
		height: roundPlacementValue(height),
	};
}

/** Returns true when the editor can place the selected file as a local image node. */
export function isRasterImagePlacementFile(
	sourceName: string,
	mimeType?: string,
): boolean {
	return supportedMimeTypeFrom(sourceName, mimeType) !== null;
}

/**
 * Detects raster image files that reached import routing but are outside the current
 * local-placement subset, so they get a visible report instead of falling into
 * the SVG/AI unsupported copy.
 */
export function isUnsupportedRasterImageFile(
	sourceName: string,
	mimeType?: string,
): boolean {
	if (isRasterImagePlacementFile(sourceName, mimeType)) return false;
	const normalized = mimeType?.trim().toLowerCase();
	if (normalized === "image/svg+xml") return false;
	if (normalized?.startsWith("image/")) return true;
	return RASTER_IMAGE_EXTENSIONS.has(extensionFor(sourceName));
}

/**
 * Creates a command-bus-ready plan for placing one local or referenced raster
 * image. The plan owns deterministic ids and placement math; callers still
 * apply the returned command through the scene store.
 */
export function createRasterImagePlacementPlan(input: {
	readonly scene: SceneDocument;
	readonly sourceName: string;
	readonly sourceType?: string;
	readonly source: ImageAssetSource;
	readonly intrinsicSize?: RasterImageIntrinsicSize | null;
}): RasterImagePlacementPlan | null {
	if (input.scene.layers.length === 0) return null;
	const sourceFormat = supportedMimeTypeFrom(
		input.sourceName,
		input.sourceType,
	);
	if (!sourceFormat) return null;

	const sourceName = normalizedSourceName(input.sourceName);
	const stem = stemFor(sourceName);
	const usedNodeIds = new Set(allNodes(input.scene).map((node) => node.id));
	const usedAssetIds = new Set(
		input.scene.assets?.map((asset) => asset.id) ?? [],
	);
	const assetId = uniqueId(usedAssetIds, `asset-image-${stem}`);
	const nodeId = uniqueId(usedNodeIds, `node-image-${stem}`);
	const artboard = selectCurrentArtboard(input.scene);
	const intrinsicSize = normalizeIntrinsicSize(input.intrinsicSize);
	const bounds = createRasterImagePlacementBounds(artboard, intrinsicSize);
	const issues: ImportIssue[] = [];

	if (!intrinsicSize) {
		issues.push({
			severity: "warning",
			code: "image.metadata-unavailable",
			message:
				"Image dimensions were not available, so the image was placed with default artboard-scaled bounds.",
			source: sourceName,
			nodeId,
			assetId,
			fallbackType: "image-bounds-fallback",
		});
	}

	if (
		input.source.kind === "data-url" &&
		!isImageDataUrl(input.source.dataUrl)
	) {
		issues.push({
			severity: "warning",
			code: "image.invalid-data-url",
			message:
				"Image source data was not a valid image data URL; export will use the deterministic image placeholder fallback.",
			source: sourceName,
			nodeId,
			assetId,
			fallbackType: "image-source-placeholder",
		});
	}

	return {
		assetId,
		nodeId,
		sourceName,
		sourceFormat,
		issues,
		commandInput: {
			assetId,
			nodeId,
			name: sourceName,
			bounds,
			source: input.source,
			artboardId: artboard.id,
			mimeType: sourceFormat,
			...(intrinsicSize
				? {
						width: intrinsicSize.width,
						height: intrinsicSize.height,
					}
				: {}),
		},
		commandOptions: {
			label: `Place ${sourceName}`,
		},
	};
}
