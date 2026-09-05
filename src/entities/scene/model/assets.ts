import {
	type ProgramSurfaceLocalApprovalState,
	parseProgramSurfaceAsset,
	programSurfaceLocalApprovalState,
} from "./program-surface";
import type {
	Bounds,
	ExternalSceneAsset,
	ExternalSceneAssetCapability,
	ExternalSceneAssetFormat,
	ExternalSceneAssetKind,
	ExternalSceneAssetSource,
	ImageAsset,
	ImageAssetSource,
	ImageGeometry,
	ImagePaintFit,
	NodeStyle,
	ProgramSurfaceAsset,
	ProgramSurfaceLocalDigestApproval,
	ProgramSurfaceManifestV1,
	SceneAsset,
	SceneAssetFidelityIssue,
	SceneDocument,
	SceneMediaSource,
	VectorNode,
	VideoAsset,
	VideoAssetSource,
} from "./types";
import { IDENTITY_TRANSFORM } from "./types";

export const IMAGE_NODE_DEFAULT_STYLE = {
	fill: "none",
	stroke: "none",
	strokeWidth: 0,
	opacity: 1,
} as const satisfies NodeStyle;

export const IMAGE_PLACEMENT_DATA_KEY = "imagePlacement" as const;
export const EXTERNAL_ASSET_PLACEMENT_DATA_KEY =
	"externalAssetPlacement" as const;

/** Source-image crop rectangle stored in source image coordinate units. */
export type ImageCropMetadata = Bounds;

/**
 * Optional image placement metadata carried in `VectorNode.data`. Bounds stay
 * in `ImageGeometry.bounds`; crop is side metadata so image authoring can land
 * without changing the frozen scene geometry contract.
 */
export type ImagePlacementMetadata = {
	readonly kind: "image-placement";
	readonly crop?: ImageCropMetadata;
};

/** Editable image placement read model for future canvas and inspector bridges. */
export type ImageNodePlacement = {
	readonly assetId: string;
	readonly bounds: Bounds;
	readonly crop?: ImageCropMetadata;
};

export type ExternalAssetPlacementMetadata = {
	readonly kind: "external-asset-placement";
	readonly assetId?: string;
	readonly assetKind: ExternalSceneAssetKind;
	readonly format?: ExternalSceneAssetFormat;
	readonly sourceKind?: ExternalSceneAssetSource["kind"];
	readonly previewAssetId?: string;
	readonly capabilitySummary?: readonly ExternalSceneAssetCapability[];
	readonly issueCount?: number;
};

/**
 * Typed image source resolution used by renderers/exporters. Keeping this union
 * in the scene entity layer lets adapters handle missing, invalid, external,
 * and embedded assets explicitly instead of each path inventing string checks.
 */
export type ImageAssetReferenceResolution =
	| {
			readonly status: "missing";
			readonly assetId: string;
	  }
	| {
			readonly status: "unsupported-asset";
			readonly asset: Exclude<SceneAsset, ImageAsset>;
			readonly reason:
				| "video-frame-required"
				| "external-preview-required"
				| "external-preview-invalid";
	  }
	| {
			readonly status: "external-preview";
			readonly asset: ExternalSceneAsset;
			readonly previewAsset: ImageAsset;
			readonly href: string;
	  }
	| {
			readonly status: "invalid-source";
			readonly asset: ImageAsset;
			readonly reason: "empty-source" | "invalid-data-url";
	  }
	| {
			readonly status: "data-url";
			readonly asset: ImageAsset;
			readonly href: string;
	  }
	| {
			readonly status: "reference";
			readonly asset: ImageAsset;
			readonly href: string;
	  };

export type ProgramSurfaceFallbackReadState =
	/** Only used when the Program Surface declaration itself cannot be read. */
	| "not-required"
	/** A valid inert declaration has not yet named a raster fallback. */
	| "not-declared"
	| "ready"
	| "missing"
	| "invalid";

/**
 * Non-executing read model for one Program Surface. Canvas, export, Inspector,
 * and agent adapters consume this same declaration later; this entity helper
 * never mounts a host or treats approval as permission to execute code.
 */
export type ProgramSurfaceAssetReadModel = {
	readonly assetId: string;
	readonly status:
		| "missing"
		| "invalid"
		| "fallback-required"
		| "awaiting-local-approval"
		| "approved-for-host";
	readonly asset?: ProgramSurfaceAsset;
	readonly manifest?: ProgramSurfaceManifestV1;
	readonly approval?: ProgramSurfaceLocalApprovalState;
	readonly fallback: {
		readonly state: ProgramSurfaceFallbackReadState;
		readonly assetId?: string;
		readonly frame?: number;
		readonly href?: string;
	};
	readonly issues: readonly SceneAssetFidelityIssue[];
};

const imageDataUrlPattern = /^data:(image\/[a-z0-9.+-]+)(?:;[^,]*)?,/iu;
const videoDataUrlPattern =
	/^data:((?:video|application)\/[a-z0-9.+-]+)(?:;[^,]*)?,/iu;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

const boundsFromRecord = (value: unknown): Bounds | undefined => {
	if (!isRecord(value)) return undefined;
	const { x, y, width, height } = value;
	if (
		!isFiniteNumber(x) ||
		!isFiniteNumber(y) ||
		!isFiniteNumber(width) ||
		!isFiniteNumber(height) ||
		width <= 0 ||
		height <= 0
	) {
		return undefined;
	}
	return { x, y, width, height };
};

/** Returns true when a source string can be embedded as an image data URL. */
export function isImageDataUrl(value: string): boolean {
	return imageDataUrlPattern.test(value.trim());
}

/**
 * Extracts the MIME type carried by an image data URL. The helper intentionally
 * does not decode bytes; it only preserves metadata available from the URL
 * header so it remains safe for browser, Worker, and test environments.
 */
export function mimeTypeFromImageDataUrl(value: string): string | undefined {
	return imageDataUrlPattern.exec(value.trim())?.[1]?.toLowerCase();
}

/** Returns true when a source string can be embedded as a video data URL. */
export function isVideoDataUrl(value: string): boolean {
	return videoDataUrlPattern.test(value.trim());
}

/**
 * Extracts the MIME type carried by a video data URL without decoding bytes.
 * The result is metadata only; browser support still depends on the runtime.
 */
export function mimeTypeFromVideoDataUrl(value: string): string | undefined {
	return videoDataUrlPattern.exec(value.trim())?.[1]?.toLowerCase();
}

/** Returns the href-like export source for an image asset, if it is non-empty. */
export function hrefForImageAsset(asset: ImageAsset): string | undefined {
	const href =
		asset.source.kind === "data-url" ? asset.source.dataUrl : asset.source.href;
	const trimmed = href.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/** Returns the href-like browser source for a video asset, if it is non-empty. */
export function hrefForVideoAsset(asset: VideoAsset): string | undefined {
	const href =
		asset.source.kind === "data-url" ? asset.source.dataUrl : asset.source.href;
	const trimmed = href.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/** Returns the href-like browser/source reference for an external scene asset. */
export function hrefForExternalSceneAsset(
	asset: ExternalSceneAsset,
): string | undefined {
	const href =
		asset.source.kind === "data-url" ? asset.source.dataUrl : asset.source.href;
	const trimmed = href.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Normalizes editable image node bounds. Invalid dimensions return `null`
 * rather than silently creating a zero-area node that cannot be selected.
 */
export function normalizeImageBounds(bounds: Bounds): Bounds | null {
	const normalized = boundsFromRecord(bounds);
	return normalized ?? null;
}

/**
 * Normalizes optional crop metadata in source image coordinates. Crop origin is
 * clamped to zero, while invalid or empty crop dimensions are omitted.
 */
export function normalizeImageCrop(
	crop: Bounds | null | undefined,
): ImageCropMetadata | undefined {
	if (!crop) return undefined;
	const width =
		Number.isFinite(crop.width) && crop.width > 0 ? crop.width : null;
	const height =
		Number.isFinite(crop.height) && crop.height > 0 ? crop.height : null;
	if (width === null || height === null) return undefined;
	return {
		x: Number.isFinite(crop.x) ? Math.max(0, crop.x) : 0,
		y: Number.isFinite(crop.y) ? Math.max(0, crop.y) : 0,
		width,
		height,
	};
}

/** Reads typed image placement metadata from a node's open-ended data bag. */
export function imagePlacementMetadataForNode(
	node: VectorNode,
): ImagePlacementMetadata | undefined {
	const metadata = node.data?.[IMAGE_PLACEMENT_DATA_KEY];
	if (!isRecord(metadata)) return undefined;
	const crop = normalizeImageCrop(boundsFromRecord(metadata.crop) ?? undefined);
	if (!crop && metadata.kind !== "image-placement") return undefined;
	return {
		kind: "image-placement",
		...(crop ? { crop } : {}),
	};
}

/** Reads external/code/3D placement metadata carried on an image-geometry node. */
export function externalAssetPlacementMetadataForNode(
	node: VectorNode,
): ExternalAssetPlacementMetadata | undefined {
	const metadata = node.data?.[EXTERNAL_ASSET_PLACEMENT_DATA_KEY];
	if (!isRecord(metadata) || metadata.kind !== "external-asset-placement") {
		return undefined;
	}
	const assetKind =
		metadata.assetKind === "external-scene" ||
		metadata.assetKind === "model-3d" ||
		metadata.assetKind === "code-module"
			? metadata.assetKind
			: undefined;
	if (!assetKind) return undefined;
	const format =
		metadata.format === "gltf" ||
		metadata.format === "glb" ||
		metadata.format === "three-scene-json" ||
		metadata.format === "module" ||
		metadata.format === "html" ||
		metadata.format === "unknown"
			? metadata.format
			: undefined;
	const sourceKind =
		metadata.sourceKind === "data-url" || metadata.sourceKind === "reference"
			? metadata.sourceKind
			: undefined;
	const capabilitySummary = Array.isArray(metadata.capabilitySummary)
		? metadata.capabilitySummary.filter(
				(capability): capability is ExternalSceneAssetCapability =>
					capability === "preview" ||
					capability === "runtime-webgl" ||
					capability === "runtime-sandbox" ||
					capability === "agent-generated" ||
					capability === "import-placeholder" ||
					capability === "depth-plane-ready" ||
					capability === "export-fallback",
			)
		: undefined;
	return {
		kind: "external-asset-placement",
		...(typeof metadata.assetId === "string"
			? { assetId: metadata.assetId }
			: {}),
		assetKind,
		...(format ? { format } : {}),
		...(sourceKind ? { sourceKind } : {}),
		...(typeof metadata.previewAssetId === "string"
			? { previewAssetId: metadata.previewAssetId }
			: {}),
		...(capabilitySummary && capabilitySummary.length > 0
			? { capabilitySummary }
			: {}),
		...(isFiniteNumber(metadata.issueCount)
			? { issueCount: Math.max(0, Math.round(metadata.issueCount)) }
			: {}),
	};
}

/** Returns geometry bounds plus crop metadata for editable image nodes. */
export function imagePlacementForNode(
	node: VectorNode,
): ImageNodePlacement | undefined {
	if (node.geometry.kind !== "image") return undefined;
	const metadata = imagePlacementMetadataForNode(node);
	return {
		assetId: node.geometry.assetId,
		bounds: node.geometry.bounds,
		...(metadata?.crop ? { crop: metadata.crop } : {}),
	};
}

/**
 * Returns a serializable node data bag with image placement metadata replaced.
 * Passing no crop clears the metadata key while preserving unrelated import data.
 */
export function imageDataWithCropMetadata(
	data: Record<string, unknown> | undefined,
	crop: Bounds | null | undefined,
): Record<string, unknown> | undefined {
	const next = { ...data };
	const normalizedCrop = normalizeImageCrop(crop);
	if (normalizedCrop) {
		next[IMAGE_PLACEMENT_DATA_KEY] = {
			kind: "image-placement",
			crop: normalizedCrop,
		} satisfies ImagePlacementMetadata;
	} else {
		delete next[IMAGE_PLACEMENT_DATA_KEY];
	}
	return Object.keys(next).length > 0 ? next : undefined;
}

/** Marks an image-geometry placement node as the visible handle for an external asset. */
export function imageDataWithExternalAssetPlacementMetadata(
	data: Record<string, unknown> | undefined,
	asset: Pick<
		ExternalSceneAsset,
		"id" | "kind" | "source" | "format" | "preview" | "capabilities" | "issues"
	>,
): Record<string, unknown> {
	return {
		...data,
		[EXTERNAL_ASSET_PLACEMENT_DATA_KEY]: {
			kind: "external-asset-placement",
			assetId: asset.id,
			assetKind: asset.kind,
			...(asset.format ? { format: asset.format } : {}),
			sourceKind: asset.source.kind,
			...(asset.preview?.assetId
				? { previewAssetId: asset.preview.assetId }
				: {}),
			...(asset.capabilities ? { capabilitySummary: asset.capabilities } : {}),
			...(asset.issues ? { issueCount: asset.issues.length } : {}),
		} satisfies ExternalAssetPlacementMetadata,
	};
}

/** Looks up the image asset referenced by editable image geometry. */
export function imageAssetForGeometry(
	document: Pick<SceneDocument, "assets">,
	geometry: ImageGeometry,
): ImageAsset | undefined {
	return document.assets?.find(
		(asset): asset is ImageAsset =>
			asset.kind === "image" && asset.id === geometry.assetId,
	);
}

/** Looks up the raw scene asset referenced by editable media/image geometry. */
export function sceneAssetForGeometry(
	document: Pick<SceneDocument, "assets">,
	geometry: ImageGeometry,
): SceneAsset | undefined {
	return document.assets?.find((asset) => asset.id === geometry.assetId);
}

/** Looks up the video asset referenced by editable media/image geometry. */
export function videoAssetForGeometry(
	document: Pick<SceneDocument, "assets">,
	geometry: ImageGeometry,
): VideoAsset | undefined {
	return document.assets?.find(
		(asset): asset is VideoAsset =>
			asset.kind === "video" && asset.id === geometry.assetId,
	);
}

/** Looks up the external/code/3D asset referenced by editable image geometry. */
export function externalSceneAssetForGeometry(
	document: Pick<SceneDocument, "assets">,
	geometry: ImageGeometry,
): ExternalSceneAsset | undefined {
	return document.assets?.find(
		(asset): asset is ExternalSceneAsset =>
			(asset.kind === "external-scene" ||
				asset.kind === "model-3d" ||
				asset.kind === "code-module") &&
			asset.id === geometry.assetId,
	);
}

/** Looks up a Program Surface declaration referenced by normal image geometry. */
export function programSurfaceAssetForGeometry(
	document: Pick<SceneDocument, "assets">,
	geometry: ImageGeometry,
): ProgramSurfaceAsset | undefined {
	return document.assets?.find(
		(asset): asset is ProgramSurfaceAsset =>
			asset.kind === "program-surface" && asset.id === geometry.assetId,
	);
}

const fallbackReadModelForProgramSurface = (
	document: Pick<SceneDocument, "assets">,
	manifest: ProgramSurfaceManifestV1,
): {
	readonly fallback: ProgramSurfaceAssetReadModel["fallback"];
	readonly issues: readonly SceneAssetFidelityIssue[];
} => {
	if (!manifest.fallback) {
		return {
			fallback: { state: "not-declared" },
			issues: [
				{
					severity: "warning",
					code: "program-surface-fallback-required",
					message:
						"Program Surface V1 local activation requires a distinct ready image fallback.",
				},
			],
		};
	}
	const declaredFallback = document.assets?.find(
		(asset) => asset.id === manifest.fallback?.assetId,
	);
	if (!declaredFallback) {
		return {
			fallback: {
				state: "missing",
				assetId: manifest.fallback.assetId,
				...(manifest.fallback.frame !== undefined
					? { frame: manifest.fallback.frame }
					: {}),
			},
			issues: [
				{
					severity: "warning",
					code: "program-surface-fallback-missing",
					message: `Program Surface fallback asset "${manifest.fallback.assetId}" is unavailable.`,
				},
			],
		};
	}
	if (declaredFallback.kind !== "image") {
		return {
			fallback: {
				state: "invalid",
				assetId: declaredFallback.id,
				...(manifest.fallback.frame !== undefined
					? { frame: manifest.fallback.frame }
					: {}),
			},
			issues: [
				{
					severity: "warning",
					code: "program-surface-fallback-invalid",
					message: `Program Surface fallback asset "${declaredFallback.id}" must be an image asset.`,
				},
			],
		};
	}
	const fallbackAsset = declaredFallback;
	const href = hrefForImageAsset(fallbackAsset);
	if (
		!href ||
		(fallbackAsset.source.kind === "data-url" &&
			!isImageDataUrl(fallbackAsset.source.dataUrl))
	) {
		return {
			fallback: {
				state: "invalid",
				assetId: fallbackAsset.id,
				...(manifest.fallback.frame !== undefined
					? { frame: manifest.fallback.frame }
					: {}),
			},
			issues: [
				{
					severity: "warning",
					code: "program-surface-fallback-invalid",
					message: `Program Surface fallback asset "${fallbackAsset.id}" has no usable image source.`,
				},
			],
		};
	}
	return {
		fallback: {
			state: "ready",
			assetId: fallbackAsset.id,
			...(manifest.fallback.frame !== undefined
				? { frame: manifest.fallback.frame }
				: {}),
			href,
		},
		issues: [],
	};
};

/**
 * Resolves only the distinct raster-fallback readiness needed to activate a
 * Program Surface. It is safe for feature session logic to read: no approval,
 * source bytes, or renderer/host capability crosses this entity boundary.
 */
export function programSurfaceFallbackReadModelForAsset(
	document: Pick<SceneDocument, "assets">,
	asset: Pick<ProgramSurfaceAsset, "manifest">,
): ProgramSurfaceAssetReadModel["fallback"] {
	return fallbackReadModelForProgramSurface(document, asset.manifest).fallback;
}

/**
 * Resolves durable Program Surface facts and an optional fallback without any
 * renderer or host dependency. A local approval only changes eligibility for a
 * future host; it does not execute the persisted source.
 */
export function programSurfaceAssetReadModel(
	document: Pick<SceneDocument, "assets">,
	assetId: string,
	approvals?: readonly ProgramSurfaceLocalDigestApproval[],
): ProgramSurfaceAssetReadModel {
	const rawAsset = document.assets?.find((asset) => asset.id === assetId);
	if (rawAsset?.kind !== "program-surface") {
		return {
			assetId,
			status: "missing",
			fallback: { state: "not-required" },
			issues: [
				{
					severity: "warning",
					code: "program-surface-asset-missing",
					message: `Program Surface asset "${assetId}" is unavailable.`,
				},
			],
		};
	}
	const parsed = parseProgramSurfaceAsset(rawAsset);
	if (parsed.status === "invalid") {
		return {
			assetId,
			status: "invalid",
			fallback: { state: "not-required" },
			issues: parsed.issues,
		};
	}
	const fallback = fallbackReadModelForProgramSurface(
		document,
		parsed.asset.manifest,
	);
	const approval = programSurfaceLocalApprovalState(parsed.asset, approvals);
	const approvalIssue: SceneAssetFidelityIssue | undefined =
		approval === "approved"
			? undefined
			: {
					severity: approval === "digest-mismatch" ? "warning" : "info",
					code:
						approval === "digest-mismatch"
							? "program-surface-digest-mismatch"
							: "program-surface-local-approval-required",
					message:
						approval === "digest-mismatch"
							? `Program Surface "${parsed.asset.id}" approval does not match its compiled digest.`
							: `Program Surface "${parsed.asset.id}" needs local approval for its compiled digest.`,
				};
	return {
		assetId,
		status:
			fallback.fallback.state !== "ready"
				? "fallback-required"
				: approval === "approved"
					? "approved-for-host"
					: "awaiting-local-approval",
		asset: parsed.asset,
		manifest: parsed.asset.manifest,
		approval,
		fallback: fallback.fallback,
		issues: [
			...(parsed.asset.issues ?? []),
			...fallback.issues,
			...(approvalIssue ? [approvalIssue] : []),
		],
	};
}

/** Looks up the image asset referenced by a scene node when it is image geometry. */
export function imageAssetForNode(
	document: SceneDocument,
	node: VectorNode,
): ImageAsset | undefined {
	if (node.geometry.kind !== "image") return undefined;
	return imageAssetForGeometry(document, node.geometry);
}

/** Resolves an image geometry reference into an explicit export/render status. */
export function resolveImageAssetReference(
	document: Pick<SceneDocument, "assets">,
	geometry: ImageGeometry,
): ImageAssetReferenceResolution {
	const rawAsset = sceneAssetForGeometry(document, geometry);
	if (rawAsset?.kind === "program-surface") {
		const program = programSurfaceAssetReadModel(document, rawAsset.id);
		const fallbackAsset =
			program.fallback.state === "ready" && program.fallback.assetId
				? document.assets?.find(
						(asset): asset is ImageAsset =>
							asset.kind === "image" && asset.id === program.fallback.assetId,
					)
				: undefined;
		const fallbackHref = fallbackAsset
			? hrefForImageAsset(fallbackAsset)
			: undefined;
		if (fallbackAsset && fallbackHref) {
			return fallbackAsset.source.kind === "data-url"
				? { status: "data-url", asset: fallbackAsset, href: fallbackHref }
				: { status: "reference", asset: fallbackAsset, href: fallbackHref };
		}
		// No host exists in Loop 1. A missing/invalid named fallback intentionally
		// remains a deterministic placeholder until a later renderer consumes the
		// richer `programSurfaceAssetReadModel` diagnostics.
		return { status: "missing", assetId: rawAsset.id };
	}
	if (rawAsset?.kind === "video") {
		return {
			status: "unsupported-asset",
			asset: rawAsset,
			reason: "video-frame-required",
		};
	}
	if (
		rawAsset?.kind === "external-scene" ||
		rawAsset?.kind === "model-3d" ||
		rawAsset?.kind === "code-module"
	) {
		if (!rawAsset.preview?.assetId) {
			return {
				status: "unsupported-asset",
				asset: rawAsset,
				reason: "external-preview-required",
			};
		}
		const previewAsset = document.assets?.find(
			(asset): asset is ImageAsset =>
				asset.kind === "image" && asset.id === rawAsset.preview?.assetId,
		);
		const previewHref = previewAsset
			? hrefForImageAsset(previewAsset)
			: undefined;
		if (!previewAsset || !previewHref) {
			return {
				status: "unsupported-asset",
				asset: rawAsset,
				reason: "external-preview-invalid",
			};
		}
		return {
			status: "external-preview",
			asset: rawAsset,
			previewAsset,
			href: previewHref,
		};
	}
	const asset = rawAsset?.kind === "image" ? rawAsset : undefined;
	if (!asset) return { status: "missing", assetId: geometry.assetId };

	const href = hrefForImageAsset(asset);
	if (!href) return { status: "invalid-source", asset, reason: "empty-source" };
	if (asset.source.kind === "data-url" && !isImageDataUrl(href)) {
		return { status: "invalid-source", asset, reason: "invalid-data-url" };
	}
	return asset.source.kind === "data-url"
		? { status: "data-url", asset, href }
		: { status: "reference", asset, href };
}

/**
 * Resolves an image-reference paint to a concrete href/data-url. A paint that
 * names a document asset (`assetId`) resolves through the asset library; an
 * inline `href` is the fallback. Returns undefined when nothing resolves, so the
 * canvas renderer and the SVG exporter degrade to the same fallback color rather
 * than disagreeing. Shared by both so an image fill paints identically in either.
 */
export function imagePaintHref(
	paint: { readonly assetId?: string; readonly href?: string },
	assets: readonly SceneAsset[] | undefined,
): string | undefined {
	if (paint.assetId) {
		const asset = assets?.find(
			(candidate): candidate is ImageAsset =>
				candidate.kind === "image" && candidate.id === paint.assetId,
		);
		const href = asset ? hrefForImageAsset(asset) : undefined;
		if (href) return href;
	}
	const inline = paint.href?.trim();
	return inline ? inline : undefined;
}

const OPAQUE_RASTER_MIME_TYPES = new Set(["image/jpeg", "image/jpg"]);

const normalizedImageMimeType = (
	value: string | undefined,
): string | undefined => {
	const normalized = value?.trim().toLowerCase();
	return normalized && normalized.length > 0 ? normalized : undefined;
};

/**
 * Resolves an image-reference paint only when its raster source is known to be
 * fully opaque from document metadata or an inline data URL MIME header. GPU
 * artboard backgrounds use this narrower helper because the SVG artboard
 * background remains underneath GPU-active content for chrome/shadow layering;
 * transparent image pixels would otherwise be composited twice.
 */
export function opaqueImagePaintHref(
	paint: { readonly assetId?: string; readonly href?: string },
	assets: readonly SceneAsset[] | undefined,
): string | undefined {
	const href = imagePaintHref(paint, assets);
	if (!href) return undefined;
	const asset =
		paint.assetId && assets
			? assets.find(
					(candidate): candidate is ImageAsset =>
						candidate.kind === "image" && candidate.id === paint.assetId,
				)
			: undefined;
	const mimeType =
		mimeTypeFromImageDataUrl(href) ?? normalizedImageMimeType(asset?.mimeType);
	return mimeType && OPAQUE_RASTER_MIME_TYPES.has(mimeType) ? href : undefined;
}

/**
 * Maps an image paint fit mode to the SVG `preserveAspectRatio` value used for
 * the `<image>` inside the generated fill pattern. `fill` stretches to the shape
 * bounds; `fit`/`crop` letterbox/cover; `tile` has no faithful single-pattern
 * representation here and is approximated as `fill` (documented limitation).
 */
export function preserveAspectRatioForImageFit(fit: ImagePaintFit): string {
	switch (fit) {
		case "fit":
			return "xMidYMid meet";
		case "crop":
			return "xMidYMid slice";
		default:
			return "none";
	}
}

/**
 * Builds a serializable image asset plus editable scene node from known
 * placement metadata. This is the domain seam future UI/import commands can use
 * without coupling asset creation to upload, storage, or tenant persistence.
 */
export function createImageAssetNode(input: {
	readonly assetId: string;
	readonly nodeId: string;
	readonly name: string;
	readonly bounds: Bounds;
	readonly source: ImageAssetSource;
	readonly artboardId?: string;
	readonly mimeType?: string;
	readonly width?: number;
	readonly height?: number;
	readonly crop?: Bounds;
}): { readonly asset: ImageAsset; readonly node: VectorNode } {
	const mimeType =
		input.mimeType ??
		(input.source.kind === "data-url"
			? mimeTypeFromImageDataUrl(input.source.dataUrl)
			: undefined);
	const asset: ImageAsset = {
		id: input.assetId,
		kind: "image",
		name: input.name,
		source: input.source,
		...(mimeType ? { mimeType } : {}),
		...(input.width !== undefined ? { width: input.width } : {}),
		...(input.height !== undefined ? { height: input.height } : {}),
	};
	const data = imageDataWithCropMetadata(undefined, input.crop);
	const node: VectorNode = {
		id: input.nodeId,
		name: input.name,
		...(input.artboardId ? { artboardId: input.artboardId } : {}),
		geometry: {
			kind: "image",
			bounds: input.bounds,
			assetId: input.assetId,
		},
		transform: IDENTITY_TRANSFORM,
		style: IMAGE_NODE_DEFAULT_STYLE,
		visible: true,
		locked: false,
		...(data ? { data } : {}),
	};
	return { asset, node };
}

/**
 * Builds a serializable video asset plus editable rectangular placement node.
 * Video deliberately reuses image geometry for v1 so selection, transforms,
 * artboard ownership, and scoped Look targeting stay on the proven path; browser
 * render/export adapters materialize a frame image when pixels are required.
 */
export function createVideoAssetNode(input: {
	readonly assetId: string;
	readonly nodeId: string;
	readonly name: string;
	readonly bounds: Bounds;
	readonly source: VideoAssetSource;
	readonly artboardId?: string;
	readonly mimeType?: string;
	readonly width?: number;
	readonly height?: number;
	readonly durationSeconds?: number;
}): { readonly asset: VideoAsset; readonly node: VectorNode } {
	const mimeType =
		input.mimeType ??
		(input.source.kind === "data-url"
			? mimeTypeFromVideoDataUrl(input.source.dataUrl)
			: undefined);
	const asset: VideoAsset = {
		id: input.assetId,
		kind: "video",
		name: input.name,
		source: input.source,
		...(mimeType ? { mimeType } : {}),
		...(input.width !== undefined ? { width: input.width } : {}),
		...(input.height !== undefined ? { height: input.height } : {}),
		...(input.durationSeconds !== undefined
			? { durationSeconds: input.durationSeconds }
			: {}),
	};
	const node: VectorNode = {
		id: input.nodeId,
		name: input.name,
		...(input.artboardId ? { artboardId: input.artboardId } : {}),
		geometry: {
			kind: "image",
			bounds: input.bounds,
			assetId: input.assetId,
		},
		transform: IDENTITY_TRANSFORM,
		style: IMAGE_NODE_DEFAULT_STYLE,
		visible: true,
		locked: false,
	};
	return { asset, node };
}

/**
 * Builds externally generated asset metadata plus a rectangular placement node.
 * The node deliberately uses image geometry so selection, transform, depth, and
 * export fallback reuse the existing placement path without executing code.
 */
export function createExternalSceneAssetNode(input: {
	readonly assetId: string;
	readonly nodeId: string;
	readonly kind: ExternalSceneAssetKind;
	readonly name: string;
	readonly bounds: Bounds;
	readonly source: ExternalSceneAssetSource;
	readonly artboardId?: string;
	readonly format?: ExternalSceneAssetFormat;
	readonly mimeType?: string;
	readonly width?: number;
	readonly height?: number;
	readonly preview?: ExternalSceneAsset["preview"];
	readonly capabilities?: readonly ExternalSceneAssetCapability[];
	readonly issues?: ExternalSceneAsset["issues"];
}): { readonly asset: ExternalSceneAsset; readonly node: VectorNode } {
	const asset: ExternalSceneAsset = {
		id: input.assetId,
		kind: input.kind,
		name: input.name,
		source: input.source,
		...(input.format ? { format: input.format } : {}),
		...(input.mimeType ? { mimeType: input.mimeType } : {}),
		...(input.width !== undefined ? { width: input.width } : {}),
		...(input.height !== undefined ? { height: input.height } : {}),
		...(input.preview ? { preview: input.preview } : {}),
		...(input.capabilities ? { capabilities: input.capabilities } : {}),
		...(input.issues ? { issues: input.issues } : {}),
	};
	const node: VectorNode = {
		id: input.nodeId,
		name: input.name,
		...(input.artboardId ? { artboardId: input.artboardId } : {}),
		geometry: {
			kind: "image",
			bounds: input.bounds,
			assetId: input.assetId,
		},
		transform: IDENTITY_TRANSFORM,
		style: IMAGE_NODE_DEFAULT_STYLE,
		visible: true,
		locked: false,
		data: imageDataWithExternalAssetPlacementMetadata(undefined, asset),
	};
	return { asset, node };
}

/**
 * Builds one inert Program Surface declaration plus a normal rectangular scene
 * placement. The source remains document data only: this factory neither loads
 * nor executes it, and deliberately writes no opaque program state into
 * `VectorNode.data`.
 */
export function createProgramSurfaceAssetNode(input: {
	readonly assetId: string;
	readonly nodeId: string;
	readonly name: string;
	readonly bounds: Bounds;
	readonly source: SceneMediaSource;
	readonly manifest: unknown;
	readonly artboardId?: string;
	readonly mimeType?: string;
	readonly issues?: readonly SceneAssetFidelityIssue[];
}): { readonly asset: ProgramSurfaceAsset; readonly node: VectorNode } | null {
	const parsed = parseProgramSurfaceAsset({
		id: input.assetId,
		kind: "program-surface",
		name: input.name,
		source: input.source,
		manifest: input.manifest,
		...(input.mimeType ? { mimeType: input.mimeType } : {}),
		...(input.issues ? { issues: input.issues } : {}),
	});
	if (parsed.status === "invalid") return null;
	const node: VectorNode = {
		id: input.nodeId,
		name: parsed.asset.name,
		...(input.artboardId ? { artboardId: input.artboardId } : {}),
		geometry: {
			kind: "image",
			bounds: input.bounds,
			assetId: parsed.asset.id,
		},
		transform: IDENTITY_TRANSFORM,
		style: IMAGE_NODE_DEFAULT_STYLE,
		visible: true,
		locked: false,
	};
	return { asset: parsed.asset, node };
}
