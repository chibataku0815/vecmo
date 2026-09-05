import type { RasterBounds } from "./raster";

export type MeshRasterCacheKeyInput = {
	readonly meshSignature: string;
	readonly bounds: RasterBounds;
	readonly deviceScale: number;
	readonly tolerance?: number;
	readonly dither?: boolean;
};

export type MeshRasterCache<T> = {
	readonly size: number;
	getOrCreate(key: string, create: () => T): T;
	clear(): void;
};

const DEFAULT_CACHE_LIMIT = 64;

const finitePositiveInteger = (value: number | undefined): number => {
	if (value === undefined || !Number.isFinite(value) || value <= 0) {
		return DEFAULT_CACHE_LIMIT;
	}
	return Math.max(1, Math.floor(value));
};

/**
 * Builds the stable identity for one raster artifact. `meshSignature` is owned by
 * callers that understand the stored paint model; this shared layer appends the
 * raster options that change pixels or bitmap dimensions. Keeping `dataUrl` out
 * of the key lets already-rasterized paints re-enter the bridge without forcing
 * another CPU raster + PNG encode pass.
 */
export function meshRasterCacheKey(input: MeshRasterCacheKeyInput): string {
	return JSON.stringify([
		"mesh-raster:v1",
		input.meshSignature,
		[input.bounds.x, input.bounds.y, input.bounds.width, input.bounds.height],
		input.deviceScale,
		input.tolerance ?? null,
		input.dither ?? true,
	]);
}

/**
 * Small LRU cache for expensive mesh raster artifacts. Values are generic so the
 * canvas bridge can cache PNG data URLs while export or Worker adapters can cache
 * whatever representation they need without duplicating eviction behavior.
 */
export function createMeshRasterCache<T>(
	limit = DEFAULT_CACHE_LIMIT,
): MeshRasterCache<T> {
	const maxEntries = finitePositiveInteger(limit);
	const values = new Map<string, T>();

	return {
		get size() {
			return values.size;
		},
		getOrCreate(key, create) {
			if (values.has(key)) {
				const cached = values.get(key) as T;
				values.delete(key);
				values.set(key, cached);
				return cached;
			}
			const created = create();
			values.set(key, created);
			while (values.size > maxEntries) {
				const oldest = values.keys().next().value;
				if (oldest === undefined) break;
				values.delete(oldest);
			}
			return created;
		},
		clear() {
			values.clear();
		},
	};
}
