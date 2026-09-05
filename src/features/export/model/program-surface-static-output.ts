import type {
	ImageAsset,
	ImageGeometry,
	ProgramSurfaceAsset,
	SceneDocument,
} from "@/entities/scene/model/types";
import {
	type ProgramSurfaceDeliveryCapabilities,
	type ProgramSurfaceDeliveryDecision,
	type ProgramSurfaceDeliveryIssue,
	resolveProgramSurfaceDeliveryForGeometry,
} from "./program-surface-delivery";

/**
 * Static-output targets which must never receive or execute Program Surface
 * source. Generated WebGL currently uses an ordinary Vecmo raster host, while
 * video uses SVG/canvas capture; neither is an isolated Program Surface host.
 */
export type ProgramSurfaceStaticOutputTarget = "webgl-player" | "video";

/**
 * Serializable delivery fact retained beside a static output. It contains no
 * source bytes, local path, approval, or execution capability.
 */
export type ProgramSurfaceStaticOutputDelivery = {
	readonly assetId: string;
	readonly route: "raster-fallback" | "unsupported";
	readonly fallbackAssetId?: string;
	readonly fallbackFrame?: number;
	readonly issue: ProgramSurfaceDeliveryIssue;
};

/**
 * Explicit fidelity contract for a generated WebGL payload or captured video.
 * `execution: "none"` is intentional: a future isolated host must add a
 * separate route instead of silently changing this static projection.
 */
export type ProgramSurfaceStaticOutputDeliveryManifest<
	Target extends ProgramSurfaceStaticOutputTarget,
> = {
	readonly target: Target;
	readonly execution: "none";
	readonly surfaceCount: number;
	readonly fallbackCount: number;
	readonly placeholderCount: number;
	readonly issueCount: number;
	readonly deliveries: readonly ProgramSurfaceStaticOutputDelivery[];
	readonly issues: readonly ProgramSurfaceDeliveryIssue[];
};

/** Non-persisted scene projection used only by one output adapter. */
export type ProgramSurfaceStaticOutputProjection<
	Target extends ProgramSurfaceStaticOutputTarget,
> = {
	readonly scene: SceneDocument;
	readonly manifest?: ProgramSurfaceStaticOutputDeliveryManifest<Target>;
	readonly issues: readonly ProgramSurfaceDeliveryIssue[];
};

const STATIC_OUTPUT_CAPABILITIES = {
	editorHost: false,
	isolatedWebglPlayerHost: false,
	videoCaptureHost: false,
} as const satisfies ProgramSurfaceDeliveryCapabilities;

const probeGeometry = (assetId: string): ImageGeometry => ({
	kind: "image",
	assetId,
	bounds: { x: 0, y: 0, width: 0, height: 0 },
});

const placeholderIssue = (
	assetId: string,
	target: ProgramSurfaceStaticOutputTarget,
): ProgramSurfaceDeliveryIssue => ({
	severity: "warning",
	category: "unsupported",
	code: "program-surface-static-output-unsupported",
	message: `Program Surface "${assetId}" cannot be represented by ${target} output and is emitted as a deterministic placeholder.`,
	fallback: "vector-placeholder",
	assetId,
});

const issueForDecision = (
	delivery: ProgramSurfaceDeliveryDecision,
	target: ProgramSurfaceStaticOutputTarget,
): ProgramSurfaceDeliveryIssue =>
	delivery.issue ?? placeholderIssue(delivery.assetId, target);

const fallbackImageAlias = (
	surface: ProgramSurfaceAsset,
	delivery: ProgramSurfaceDeliveryDecision,
): ImageAsset | undefined => {
	if (delivery.route !== "raster-fallback" || !delivery.fallback) {
		return undefined;
	}
	const fallback = delivery.fallback.asset;
	return {
		id: surface.id,
		kind: "image",
		name: surface.name,
		source: fallback.source,
		...(fallback.mimeType ? { mimeType: fallback.mimeType } : {}),
		...(fallback.width !== undefined ? { width: fallback.width } : {}),
		...(fallback.height !== undefined ? { height: fallback.height } : {}),
	};
};

const deliveryForSurface = (
	document: Pick<SceneDocument, "assets">,
	surface: ProgramSurfaceAsset,
	target: ProgramSurfaceStaticOutputTarget,
): ProgramSurfaceDeliveryDecision => {
	const delivery = resolveProgramSurfaceDeliveryForGeometry({
		document,
		geometry: probeGeometry(surface.id),
		target,
		// Static output must remain source-free even if a future runtime enables
		// a live host elsewhere. A new output adapter must opt in explicitly.
		capabilities: STATIC_OUTPUT_CAPABILITIES,
	});
	if (delivery) return delivery;
	return {
		assetId: surface.id,
		target,
		route: "unsupported",
		issue: placeholderIssue(surface.id, target),
	};
};

/**
 * Removes all Program Surface source from a static-output scene. A valid,
 * target-declared fallback is re-keyed to the placed Program Surface id so
 * ordinary image geometry preserves placement; every other surface keeps its
 * geometry but loses the asset, which reaches the renderer's deterministic
 * missing-image placeholder path.
 */
export const projectProgramSurfacesForStaticOutput = <
	Target extends ProgramSurfaceStaticOutputTarget,
>(
	scene: SceneDocument,
	target: Target,
): ProgramSurfaceStaticOutputProjection<Target> => {
	const assets = scene.assets;
	const surfaces = assets?.filter(
		(asset): asset is ProgramSurfaceAsset => asset.kind === "program-surface",
	);
	if (!assets || !surfaces || surfaces.length === 0) {
		return { scene, issues: [] };
	}

	const deliveries = new Map<string, ProgramSurfaceStaticOutputDelivery>();
	const projectedAssets = assets.flatMap((asset) => {
		if (asset.kind !== "program-surface") return [asset];
		const delivery = deliveryForSurface(scene, asset, target);
		const issue = issueForDecision(delivery, target);
		const fallback = fallbackImageAlias(asset, delivery);
		deliveries.set(asset.id, {
			assetId: asset.id,
			route: fallback ? "raster-fallback" : "unsupported",
			...(fallback && delivery.fallback
				? {
						fallbackAssetId: delivery.fallback.assetId,
						...(delivery.fallback.frame !== undefined
							? { fallbackFrame: delivery.fallback.frame }
							: {}),
					}
				: {}),
			issue,
		});
		return fallback ? [fallback] : [];
	});
	const deliveryValues = [...deliveries.values()];
	const issues = deliveryValues.map((delivery) => delivery.issue);
	const fallbackCount = deliveryValues.filter(
		(delivery) => delivery.route === "raster-fallback",
	).length;
	const manifest = {
		target,
		execution: "none" as const,
		surfaceCount: deliveryValues.length,
		fallbackCount,
		placeholderCount: deliveryValues.length - fallbackCount,
		issueCount: issues.length,
		deliveries: deliveryValues,
		issues,
	} satisfies ProgramSurfaceStaticOutputDeliveryManifest<Target>;

	return {
		scene: { ...scene, assets: projectedAssets },
		manifest,
		issues,
	};
};

/** Source-free projection for generated WebGL player payloads. */
export const projectProgramSurfacesForWebglPlayer = (
	scene: SceneDocument,
): ProgramSurfaceStaticOutputProjection<"webgl-player"> =>
	projectProgramSurfacesForStaticOutput(scene, "webgl-player");

/** Source-free projection for canvas/WebM and still-capture output. */
export const projectProgramSurfacesForVideo = (
	scene: SceneDocument,
): ProgramSurfaceStaticOutputProjection<"video"> =>
	projectProgramSurfacesForStaticOutput(scene, "video");
