import type {
	ImageAsset,
	ImageGeometry,
	ProgramSurfaceAsset,
	SceneDocument,
} from "@/entities/scene/model/types";
import {
	type ProgramSurfaceDeliveryDecision,
	type ProgramSurfaceDeliveryIssue,
	resolveProgramSurfaceDeliveryForGeometry,
} from "./program-surface-delivery";

/**
 * Serializable delivery fact shipped beside a Motion/Code runtime payload.
 * It intentionally contains neither Program Surface source bytes nor a host
 * capability: this renderer can only draw a declared image fallback or its
 * deterministic missing-image placeholder.
 */
export type MotionCodeProgramSurfaceDelivery = {
	readonly assetId: string;
	readonly route: "raster-fallback" | "unsupported";
	readonly fallbackAssetId?: string;
	readonly fallbackFrame?: number;
	readonly issue: ProgramSurfaceDeliveryIssue;
};

/** Explicit runtime/export report for the Program Surfaces present in one payload. */
export type MotionCodeProgramSurfaceDeliveryManifest = {
	readonly target: "motion-code";
	readonly execution: "none";
	readonly surfaceCount: number;
	readonly fallbackCount: number;
	readonly placeholderCount: number;
	readonly issueCount: number;
	readonly deliveries: readonly MotionCodeProgramSurfaceDelivery[];
	readonly issues: readonly ProgramSurfaceDeliveryIssue[];
};

export type MotionCodeProgramSurfaceProjection = {
	readonly scene: SceneDocument;
	readonly manifest?: MotionCodeProgramSurfaceDeliveryManifest;
	readonly issues: readonly ProgramSurfaceDeliveryIssue[];
};

const programSurfaceProbeGeometry = (assetId: string): ImageGeometry => ({
	kind: "image",
	assetId,
	bounds: { x: 0, y: 0, width: 0, height: 0 },
});

const explicitPlaceholderIssue = (
	assetId: string,
): ProgramSurfaceDeliveryIssue => ({
	severity: "warning",
	category: "unsupported",
	code: "program-surface-static-output-unsupported",
	message: `Program Surface "${assetId}" cannot be represented by Motion/Code and is emitted as a deterministic placeholder.`,
	fallback: "vector-placeholder",
	assetId,
});

const issueForDecision = (
	delivery: ProgramSurfaceDeliveryDecision,
): ProgramSurfaceDeliveryIssue =>
	delivery.issue ?? explicitPlaceholderIssue(delivery.assetId);

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
): ProgramSurfaceDeliveryDecision => {
	const delivery = resolveProgramSurfaceDeliveryForGeometry({
		document,
		geometry: programSurfaceProbeGeometry(surface.id),
		target: "motion-code",
	});
	if (delivery) return delivery;
	return {
		assetId: surface.id,
		target: "motion-code",
		route: "unsupported",
		issue: {
			severity: "warning",
			category: "unsupported",
			code: "program-surface-static-output-unsupported",
			message: `Program Surface "${surface.id}" cannot be resolved for Motion/Code output.`,
			fallback: "vector-placeholder",
			assetId: surface.id,
		},
	};
};

/**
 * Removes every executable Program Surface source from a Motion/Code scene
 * payload. A declared and valid fallback becomes an image asset under the
 * original id so ordinary image geometry keeps its placement; every other
 * Program Surface is removed so the runtime emits its established missing-image
 * rectangle. This is an export-only projection and never changes the document.
 */
export const projectProgramSurfacesForMotionCode = (
	scene: SceneDocument,
): MotionCodeProgramSurfaceProjection => {
	const assets = scene.assets;
	const surfaces = assets?.filter(
		(asset): asset is ProgramSurfaceAsset => asset.kind === "program-surface",
	);
	if (!assets || !surfaces || surfaces.length === 0) {
		return { scene, issues: [] };
	}

	const deliveries = new Map<string, MotionCodeProgramSurfaceDelivery>();
	const projectedAssets = assets.flatMap((asset) => {
		if (asset.kind !== "program-surface") return [asset];
		const delivery = deliveryForSurface(scene, asset);
		const issue = issueForDecision(delivery);
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
		target: "motion-code" as const,
		execution: "none" as const,
		surfaceCount: deliveryValues.length,
		fallbackCount,
		placeholderCount: deliveryValues.length - fallbackCount,
		issueCount: issues.length,
		deliveries: deliveryValues,
		issues,
	} satisfies MotionCodeProgramSurfaceDeliveryManifest;

	return {
		scene: { ...scene, assets: projectedAssets },
		manifest,
		issues,
	};
};
