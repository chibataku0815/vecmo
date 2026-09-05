import type { RasterExportIntent, RasterSliceTarget } from "../model/raster";

export type RasterRenderResult = {
	readonly slice: RasterSliceTarget;
	readonly blob: Blob;
};

/**
 * Rasterizes a single slice target to a Blob via OffscreenCanvas/Canvas2D.
 * The SVG source is rendered at the slice's output dimensions and encoded to
 * the requested format. Actual implementation deferred to the browser bridge —
 * this stub declares the contract so downstream wiring can type-check.
 */
export async function rasterizeSlice(
	_svgSource: string,
	_slice: RasterSliceTarget,
): Promise<RasterRenderResult> {
	throw new Error(
		"rasterizeSlice is not yet implemented — use the raster intent model for deterministic export planning.",
	);
}

/**
 * Rasterizes all slices in a raster intent to downloadable Blobs.
 * Deferred to the browser bridge — this stub declares the batch contract.
 */
export async function rasterizeIntent(
	_svgSources: ReadonlyMap<string, string>,
	_intent: RasterExportIntent,
): Promise<readonly RasterRenderResult[]> {
	throw new Error(
		"rasterizeIntent is not yet implemented — use the raster intent model for deterministic export planning.",
	);
}
