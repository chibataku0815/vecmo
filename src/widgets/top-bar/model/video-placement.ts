import { isVideoDataUrl } from "@/entities/scene/model/assets";
import type {
	PlaceVideoNodeInput,
	PlaceVideoNodeOptions,
} from "@/entities/scene/model/node-commands";
import {
	allNodes,
	selectCurrentArtboard,
} from "@/entities/scene/model/selectors";
import type {
	SceneDocument,
	VideoAssetSource,
} from "@/entities/scene/model/types";
import {
	createRasterImagePlacementBounds,
	type RasterImageIntrinsicSize,
} from "@/features/import/model/image-placement";
import type { ImportIssue } from "@/features/import/model/types";

const SUPPORTED_VIDEO_MIME_TYPES = [
	"video/mp4",
	"video/webm",
	"video/quicktime",
	"video/x-m4v",
	"video/ogg",
] as const;

export type SupportedTopBarVideoMimeType =
	(typeof SUPPORTED_VIDEO_MIME_TYPES)[number];

const VIDEO_EXTENSION_MIME_TYPES: Readonly<
	Record<string, SupportedTopBarVideoMimeType>
> = {
	mp4: "video/mp4",
	m4v: "video/x-m4v",
	mov: "video/quicktime",
	webm: "video/webm",
	ogv: "video/ogg",
} as const;

const VIDEO_EXTENSIONS = new Set(Object.keys(VIDEO_EXTENSION_MIME_TYPES));

export type TopBarVideoIntrinsicMetadata = RasterImageIntrinsicSize & {
	readonly durationSeconds?: number;
};

export type TopBarVideoPlacementPlan = {
	readonly assetId: string;
	readonly nodeId: string;
	readonly sourceName: string;
	readonly sourceFormat: SupportedTopBarVideoMimeType;
	readonly issues: readonly ImportIssue[];
	readonly commandInput: PlaceVideoNodeInput;
	readonly commandOptions: PlaceVideoNodeOptions;
};

const extensionFor = (sourceName: string): string => {
	const trimmed = sourceName.trim().toLowerCase();
	const extension = trimmed.split(".").at(-1);
	return extension && extension !== trimmed ? extension : "";
};

const normalizedSourceName = (sourceName: string): string => {
	const trimmed = sourceName.trim();
	return trimmed.length > 0 ? trimmed : "Untitled video";
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
	return slug.length > 0 ? slug : "video";
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
): SupportedTopBarVideoMimeType | null => {
	const normalized = mimeType?.trim().toLowerCase();
	if (
		normalized &&
		SUPPORTED_VIDEO_MIME_TYPES.includes(
			normalized as SupportedTopBarVideoMimeType,
		)
	) {
		return normalized as SupportedTopBarVideoMimeType;
	}
	if (normalized && normalized !== "application/octet-stream") return null;
	return VIDEO_EXTENSION_MIME_TYPES[extensionFor(sourceName)] ?? null;
};

const finitePositive = (value: number | undefined): number | null =>
	Number.isFinite(value) && (value ?? 0) > 0 ? (value ?? 0) : null;

const dataUrlHeaderPattern = /^data:([^;,]*)([^,]*),/iu;

const dataUrlWithVideoMimeType = (
	dataUrl: string,
	mimeType: SupportedTopBarVideoMimeType,
): string =>
	dataUrl.replace(
		dataUrlHeaderPattern,
		(_match, _currentMimeType: string, parameters: string) =>
			`data:${mimeType}${parameters},`,
	);

const normalizedVideoSource = (
	source: VideoAssetSource,
	mimeType: SupportedTopBarVideoMimeType,
): VideoAssetSource => {
	if (source.kind !== "data-url") return source;
	return {
		...source,
		dataUrl: dataUrlWithVideoMimeType(source.dataUrl, mimeType),
	};
};

const normalizeMetadata = (
	metadata: TopBarVideoIntrinsicMetadata | null | undefined,
): TopBarVideoIntrinsicMetadata | null => {
	const width = finitePositive(metadata?.width);
	const height = finitePositive(metadata?.height);
	if (!width || !height) return null;
	const durationSeconds = finitePositive(metadata?.durationSeconds);
	return {
		width,
		height,
		...(durationSeconds ? { durationSeconds } : {}),
	};
};

/** Returns true when TopBar can place the selected file as local video media. */
export function isTopBarVideoPlacementFile(
	sourceName: string,
	mimeType?: string,
): boolean {
	return supportedMimeTypeFrom(sourceName, mimeType) !== null;
}

/** Detects video files outside the current browser-placement subset. */
export function isUnsupportedTopBarVideoFile(
	sourceName: string,
	mimeType?: string,
): boolean {
	if (isTopBarVideoPlacementFile(sourceName, mimeType)) return false;
	const normalized = mimeType?.trim().toLowerCase();
	if (normalized?.startsWith("video/")) return true;
	return VIDEO_EXTENSIONS.has(extensionFor(sourceName));
}

/** Creates a command-bus-ready plan for placing a local video media source. */
export function createTopBarVideoPlacementPlan(input: {
	readonly scene: SceneDocument;
	readonly sourceName: string;
	readonly sourceType?: string;
	readonly source: VideoAssetSource;
	readonly metadata?: TopBarVideoIntrinsicMetadata | null;
}): TopBarVideoPlacementPlan | null {
	if (input.scene.layers.length === 0) return null;
	const sourceFormat = supportedMimeTypeFrom(
		input.sourceName,
		input.sourceType,
	);
	if (!sourceFormat) return null;
	const source = normalizedVideoSource(input.source, sourceFormat);

	const sourceName = normalizedSourceName(input.sourceName);
	const stem = stemFor(sourceName);
	const usedNodeIds = new Set(allNodes(input.scene).map((node) => node.id));
	const usedAssetIds = new Set(
		input.scene.assets?.map((asset) => asset.id) ?? [],
	);
	const assetId = uniqueId(usedAssetIds, `asset-video-${stem}`);
	const nodeId = uniqueId(usedNodeIds, `node-video-${stem}`);
	const artboard = selectCurrentArtboard(input.scene);
	const metadata = normalizeMetadata(input.metadata);
	const bounds = createRasterImagePlacementBounds(artboard, metadata);
	const issues: ImportIssue[] = [];

	if (!metadata) {
		issues.push({
			severity: "warning",
			code: "video.metadata-unavailable",
			message:
				"Video dimensions were not available, so the video was placed with default artboard-scaled bounds.",
			source: sourceName,
			nodeId,
			assetId,
			fallbackType: "video-bounds-fallback",
		});
	}

	if (source.kind === "data-url" && !isVideoDataUrl(source.dataUrl)) {
		issues.push({
			severity: "warning",
			code: "video.invalid-data-url",
			message:
				"Video source data was not a valid video data URL; static exports will use the media placeholder fallback.",
			source: sourceName,
			nodeId,
			assetId,
			fallbackType: "video-source-placeholder",
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
			source,
			artboardId: artboard.id,
			mimeType: sourceFormat,
			...(metadata
				? {
						width: metadata.width,
						height: metadata.height,
						...(metadata.durationSeconds
							? { durationSeconds: metadata.durationSeconds }
							: {}),
					}
				: {}),
		},
		commandOptions: {
			label: `Place ${sourceName}`,
		},
	};
}
