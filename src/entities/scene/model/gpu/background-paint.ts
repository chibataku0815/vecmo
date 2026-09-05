import { opaqueImagePaintHref } from "@/entities/scene/model/assets";
import {
	coonsPatchesFromMesh,
	meshBounds,
} from "@/entities/scene/model/mesh-edit";
import type {
	ResolvedImageReferencePaint,
	ResolvedMeshGradientPaint,
} from "@/entities/scene/model/style-resolve";
import type { SceneAsset } from "@/entities/scene/model/types";
import { hexToRgb } from "@/shared/color";

/**
 * Returns a concrete image href only for the narrow image-background subset
 * that can be safely drawn above the retained SVG artboard chrome in E1:
 * fully opaque paint, no transform, non-tiled fit, and a statically opaque
 * raster source. Capability and frame assembly both read this helper so the
 * fallback boundary cannot drift.
 */
export function gpuKnownOpaqueImageBackgroundHref(
	paint: ResolvedImageReferencePaint,
	assets: readonly SceneAsset[] | undefined,
): string | undefined {
	if (paint.opacity !== 1 || paint.fit === "tile" || paint.transform) {
		return undefined;
	}
	return opaqueImagePaintHref(paint, assets);
}

/**
 * True when a mesh-gradient artboard background rasterizes to a fully opaque
 * bitmap and can therefore be drawn above E1's retained SVG artboard
 * background without double-compositing transparent pixels.
 */
export function gpuMeshBackgroundUsesOpaqueRaster(
	paint: ResolvedMeshGradientPaint,
): boolean {
	if (paint.opacity !== 1 || paint.transform) return false;
	const bounds = meshBounds(paint);
	if (bounds.width <= 0 || bounds.height <= 0) return false;
	if (coonsPatchesFromMesh(paint).length === 0) return false;
	return paint.points.every(
		(point) =>
			hexToRgb(point.color) !== null &&
			(point.opacity === undefined || point.opacity === 1),
	);
}
