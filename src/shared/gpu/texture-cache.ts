/**
 * Async GPU texture cache for image-backed paints (E1 S5 — see
 * `docs/gpu-canvas-convergence-e1-plan.md`'s S5 decisions). Scene-agnostic and
 * WebGPU-only, like the rest of `shared/gpu`: this module knows nothing about
 * `SceneDocument`/paints/nodes, only "given a string key and a way to fetch an
 * `ImageBitmap`, get me a `GPUTexture` for it, synchronously if already loaded."
 *
 * SYNC-HIT / ASYNC-MISS CONTRACT: {@link GpuTextureCache.get} never awaits — a
 * cache hit returns the `GPUTexture` immediately (same tick), a cache miss
 * returns `undefined` and kicks off exactly ONE in-flight `Promise` for that
 * key (deduplicated: a second `get` call for the same key while the first
 * load is in flight does not start a second load). This is what lets the
 * frame-builder (`gpu-scene-frame.ts`) stay a plain synchronous function: it
 * calls `get`, and on `undefined` simply omits that one draw for this frame
 * (pop-in parity with the SVG renderer's own `<image>` decode latency — see
 * `docs/gpu-canvas-convergence-e1-plan.md`'s pop-in note) rather than blocking
 * the whole frame on a network/decode round-trip. `onReady` fires once the
 * texture actually uploads, so the caller can schedule exactly one more
 * redraw to pick the now-available texture up.
 *
 * UPLOAD: `createImageBitmap(blob)` -> `device.queue.copyExternalImageToTexture`.
 * `copyExternalImageToTexture` does NOT accept an `HTMLImageElement` directly
 * (a decoded `ImageBitmap` is the only accepted `GPUImageCopyExternalImage`
 * source alongside `HTMLCanvasElement`/`OffscreenCanvas`/`VideoFrame`), so
 * `createImageBitmap` is not just a performance nicety here, it is required.
 * This differs from `shared/gpu-lens/surface.ts::decodeSvgImage`'s
 * `new Image()+decode()` pattern deliberately: that path exists because
 * `createImageBitmap` is Safari-unreliable specifically for SVG data URLs
 * (see that module's doc comment); the sources this cache decodes are always
 * raster bitmaps (PNG/JPEG data URLs, or the mesh rasterizer's own PNG
 * output — never an SVG string), where `createImageBitmap` has no such
 * reliability gap and is the ONLY WebGPU-accepted upload path anyway.
 *
 * SIZE CAP: a source bitmap wider or taller than {@link MAX_TEXTURE_DIMENSION}
 * is downscaled via `createImageBitmap`'s own `resizeWidth`/`resizeHeight`
 * options (decode-time resize, no extra canvas round-trip) — a defensive cap
 * against a huge embedded photo exhausting GPU memory or exceeding
 * `device.limits.maxTextureDimension2D` and losing the whole device.
 *
 * EVICTION: a simple size-bounded LRU (`TEXTURE_CACHE_LIMIT` entries) mirrors
 * `shared/mesh-raster/cache.ts`'s policy one layer up the stack (bitmaps
 * there, live `GPUTexture` handles here) — eviction here additionally calls
 * `texture.destroy()`, which a JS-object cache eviction never needs to.
 */

import {
	type BrowserCacheStore,
	createBrowserCacheStore,
} from "@/shared/cache/browser-store";
import { stableHashString } from "@/shared/cache/hash";
import {
	createCacheArtifactKey,
	createCacheArtifactManifest,
} from "@/shared/cache/key";
import { recordCacheTelemetry } from "@/shared/cache/observability";
import type {
	CacheArtifactKeyInput,
	CacheArtifactManifest,
} from "@/shared/cache/types";

/** Backing-store dimension cap per uploaded texture (width or height) — protects against `device.limits.maxTextureDimension2D` device loss on a huge embedded image. */
export const MAX_TEXTURE_DIMENSION = 4096;

/** Max resident `GPUTexture` entries before the oldest (LRU) is destroyed and evicted. */
export const TEXTURE_CACHE_LIMIT = 64;

/** Uploaded texture format — values are treated as sRGB-encoded, matching the sRGB compositing convention `webgpu.ts`'s solid/gradient paths already use (no linear re-encoding). */
const TEXTURE_FORMAT: GPUTextureFormat = "rgba8unorm";
const IMAGE_SOURCE_SCHEMA_VERSION = "gpu-image-source-cache:v1";
const IMAGE_SOURCE_RENDERER_VERSION = "gpu-texture-cache:v1";
const IMAGE_SOURCE_CAPABILITY_VERSION = "createImageBitmap:v1";
const IMAGE_SOURCE_DEVICE_BUCKET = `max-texture:${MAX_TEXTURE_DIMENSION}`;

let imageSourceStorePromise: Promise<BrowserCacheStore> | null = null;

const imageSourceStore = (): Promise<BrowserCacheStore> => {
	imageSourceStorePromise ??= createBrowserCacheStore();
	return imageSourceStorePromise;
};

const dataImageContentType = (href: string): string => {
	const match = /^data:([^;,]+)/i.exec(href);
	return match?.[1] ?? "image/png";
};

const canPersistImageSource = (href: string): boolean =>
	/^data:image\//i.test(href);

const exactArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
};

const imageSourceArtifactInput = (href: string): CacheArtifactKeyInput => {
	const hrefHash = stableHashString(href);
	return {
		schemaVersion: IMAGE_SOURCE_SCHEMA_VERSION,
		artifactKind: "image-decode",
		documentContentHash: `image-source:${hrefHash}`,
		artifactInputHash: hrefHash,
		rendererVersion: IMAGE_SOURCE_RENDERER_VERSION,
		capabilityVersion: IMAGE_SOURCE_CAPABILITY_VERSION,
		deviceBucket: IMAGE_SOURCE_DEVICE_BUCKET,
		dependencyKeys: [`href:${hrefHash}`],
	};
};

const imageSourceManifest = (
	input: CacheArtifactKeyInput,
	bytes: Uint8Array,
): CacheArtifactManifest => {
	const key = createCacheArtifactKey(input);
	return createCacheArtifactManifest({
		key,
		artifactKind: input.artifactKind,
		schemaVersion: input.schemaVersion,
		documentContentHash: input.documentContentHash,
		artifactInputHash: input.artifactInputHash,
		rendererVersion: input.rendererVersion,
		capabilityVersion: input.capabilityVersion,
		deviceBucket: input.deviceBucket,
		dependencyKeys: input.dependencyKeys,
		byteLength: bytes.byteLength,
		blobRef: { kind: "memory", key },
	});
};

const readPersistentImageSourceBlob = async (
	href: string,
): Promise<Blob | null> => {
	if (!canPersistImageSource(href)) return null;
	const input = imageSourceArtifactInput(href);
	const key = createCacheArtifactKey(input);
	try {
		const { store } = await imageSourceStore();
		const record = await store.getArtifact(key);
		if (!record) {
			recordCacheTelemetry({
				kind: "miss",
				artifactKind: "image-decode",
				cacheKey: key,
				tier: store.mode,
			});
			return null;
		}
		recordCacheTelemetry({
			kind: "hit",
			artifactKind: "image-decode",
			cacheKey: key,
			tier: store.mode,
			bytes: record.bytes.byteLength,
		});
		return new Blob([exactArrayBuffer(record.bytes)], {
			type: dataImageContentType(href),
		});
	} catch (error) {
		recordCacheTelemetry({
			kind: "error",
			artifactKind: "image-decode",
			cacheKey: key,
			message: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
};

const rememberPersistentImageSourceBlob = (href: string, blob: Blob): void => {
	if (!canPersistImageSource(href)) return;
	const input = imageSourceArtifactInput(href);
	const key = createCacheArtifactKey(input);
	void blob
		.arrayBuffer()
		.then(async (buffer) => {
			const bytes = new Uint8Array(buffer);
			const { store } = await imageSourceStore();
			await store.putArtifact(imageSourceManifest(input, bytes), bytes);
			recordCacheTelemetry({
				kind: "put",
				artifactKind: "image-decode",
				cacheKey: key,
				tier: store.mode,
				bytes: bytes.byteLength,
			});
		})
		.catch((error) => {
			recordCacheTelemetry({
				kind: "error",
				artifactKind: "image-decode",
				cacheKey: key,
				message: error instanceof Error ? error.message : String(error),
			});
		});
};

/**
 * Live cache entry: the uploaded texture, a matching sampler (created once
 * per texture — trivial cost, avoids a second cache), and the bitmap's own
 * (possibly downscaled) pixel size, which the caller needs to compute UV
 * mapping independent of the SOURCE image's un-downscaled dimensions.
 */
export type GpuCachedTexture = {
	readonly texture: GPUTexture;
	readonly sampler: GPUSampler;
	readonly width: number;
	readonly height: number;
};

/**
 * The texture cache's public surface. `get` is the hot synchronous path a
 * frame-builder calls every frame; `dispose` releases every resident texture
 * (called once, on GPU surface teardown, alongside every other GPU resource
 * `webgpu.ts::dispose` already frees).
 */
export type GpuTextureCache = {
	/**
	 * Synchronous cache lookup. A hit returns the cached `GpuCachedTexture`
	 * immediately. A miss returns `undefined` and, unless a load for this
	 * exact `key` is already in flight, starts exactly one `loadBitmap()` call;
	 * `onReady(key)` fires after that load's texture is uploaded and cached
	 * (never on a load that fails or was superseded by `dispose`).
	 */
	readonly get: (
		key: string,
		loadBitmap: () => Promise<ImageBitmap>,
	) => GpuCachedTexture | undefined;
	/** Releases every resident `GPUTexture` and clears the cache. The cache must not be used after this call. */
	readonly dispose: () => void;
};

/**
 * Downscale target for a bitmap wider/taller than {@link MAX_TEXTURE_DIMENSION},
 * preserving aspect ratio; `undefined` when no resize is needed (the common
 * case), so the caller can pass `createImageBitmap`'s resize options only when
 * actually shrinking.
 */
function clampedResizeOptions(
	width: number,
	height: number,
): ImageBitmapOptions | undefined {
	const largestDimension = Math.max(width, height);
	if (largestDimension <= MAX_TEXTURE_DIMENSION) return undefined;
	const scale = MAX_TEXTURE_DIMENSION / largestDimension;
	return {
		resizeWidth: Math.max(1, Math.round(width * scale)),
		resizeHeight: Math.max(1, Math.round(height * scale)),
		resizeQuality: "high",
	};
}

/**
 * Creates a texture cache bound to one `GPUDevice`. `onReady` is called
 * (asynchronously, after the caller's current synchronous frame has already
 * returned) once per successful load, passing the key that became ready —
 * the caller (`GpuSceneCanvas.tsx`) wires this straight to its existing
 * `scheduleRedraw`, so a newly-available texture triggers exactly one more
 * coalesced redraw, matching this codebase's "frame reader, one clock"
 * discipline (D6) — this cache never redraws anything itself.
 */
export function createGpuTextureCache(
	device: GPUDevice,
	onReady: (key: string) => void,
): GpuTextureCache {
	const entries = new Map<string, GpuCachedTexture>();
	const inFlight = new Set<string>();
	let disposed = false;

	const touch = (key: string, entry: GpuCachedTexture): void => {
		// Re-insert to move this key to the Map's most-recently-used end (Map
		// iteration order is insertion order; `delete` + `set` is the standard
		// idiom for bumping an entry's LRU position without a second index).
		entries.delete(key);
		entries.set(key, entry);
	};

	const evictOldestIfOverLimit = (): void => {
		while (entries.size > TEXTURE_CACHE_LIMIT) {
			const oldestKey = entries.keys().next().value;
			if (oldestKey === undefined) break;
			const evicted = entries.get(oldestKey);
			entries.delete(oldestKey);
			evicted?.texture.destroy();
		}
	};

	const startLoad = (
		key: string,
		loadBitmap: () => Promise<ImageBitmap>,
	): void => {
		inFlight.add(key);
		void loadBitmap()
			.then((bitmap) => {
				if (disposed) {
					bitmap.close();
					return;
				}
				const resize = clampedResizeOptions(bitmap.width, bitmap.height);
				// A resize needs a SECOND `createImageBitmap` call: the WebGPU spec's
				// `copyExternalImageToTexture` source is the bitmap itself (no
				// separate "upload region" concept), so downscaling has to happen
				// before upload, not during it.
				return resize ? createImageBitmap(bitmap, resize) : bitmap;
			})
			.then((bitmap) => {
				if (!bitmap || disposed) return;
				const texture = device.createTexture({
					size: { width: bitmap.width, height: bitmap.height },
					format: TEXTURE_FORMAT,
					usage:
						GPUTextureUsage.TEXTURE_BINDING |
						GPUTextureUsage.COPY_DST |
						GPUTextureUsage.RENDER_ATTACHMENT,
				});
				device.queue.copyExternalImageToTexture(
					{ source: bitmap },
					{ texture, premultipliedAlpha: true },
					{ width: bitmap.width, height: bitmap.height },
				);
				bitmap.close();
				const sampler = device.createSampler({
					addressModeU: "clamp-to-edge",
					addressModeV: "clamp-to-edge",
					magFilter: "linear",
					minFilter: "linear",
				});
				const entry: GpuCachedTexture = {
					texture,
					sampler,
					width: bitmap.width,
					height: bitmap.height,
				};
				touch(key, entry);
				recordCacheTelemetry({
					kind: "put",
					artifactKind: "image-decode",
					cacheKey: key,
					tier: "gpu",
					bytes: bitmap.width * bitmap.height * 4,
				});
				evictOldestIfOverLimit();
				inFlight.delete(key);
				onReady(key);
			})
			.catch((error) => {
				inFlight.delete(key);
				if (import.meta.env.DEV) {
					console.info(`[gpu-canvas] texture load failed for "${key}".`, error);
				}
			});
	};

	return {
		get(key, loadBitmap) {
			const cached = entries.get(key);
			if (cached) {
				touch(key, cached);
				recordCacheTelemetry({
					kind: "hit",
					artifactKind: "image-decode",
					cacheKey: key,
					tier: "gpu",
				});
				return cached;
			}
			if (!inFlight.has(key)) {
				recordCacheTelemetry({
					kind: "miss",
					artifactKind: "image-decode",
					cacheKey: key,
					tier: "gpu",
				});
				startLoad(key, loadBitmap);
			}
			return undefined;
		},
		dispose() {
			disposed = true;
			for (const entry of entries.values()) entry.texture.destroy();
			entries.clear();
			inFlight.clear();
		},
	};
}

/**
 * Default `loadBitmap` source: fetches `href` (a `data:` URL or an external
 * `http(s)://` URL — both are valid `fetch()` targets) into a `Blob`, then
 * decodes it with `createImageBitmap`. This is the SAME href identity every
 * other renderer resolves to (`hrefForImageAsset`/`imagePaintHref`), so the
 * texture cache decodes byte-identical source bytes to whatever the SVG
 * renderer's `<image href=...>` displays.
 */
export async function loadImageBitmapFromHref(
	href: string,
): Promise<ImageBitmap> {
	const cachedBlob = await readPersistentImageSourceBlob(href);
	if (cachedBlob) return createImageBitmap(cachedBlob);
	const response = await fetch(href);
	const blob = await response.blob();
	rememberPersistentImageSourceBlob(href, blob);
	return createImageBitmap(blob);
}
