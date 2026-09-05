import {
	type CacheArtifactKeyInput,
	type CacheArtifactManifest,
	type CacheStore,
	type CacheWorkerResponse,
	createCacheArtifactKey,
	createCacheArtifactManifest,
	recordCacheTelemetry,
	stableHashString,
} from "@/shared/cache";
import {
	canvasBrowserCacheStore,
	canvasCacheWorkerQueue,
	exactArrayBuffer,
	nextCanvasCacheRequestId,
} from "./browser-cache-runtime";

type PersistentRasterKind = "text-raster" | "mesh-raster" | "gpu-upload-source";

type RasterArtifactPayload = {
	readonly sourceKey: string;
	readonly dataUrl: string;
};

const RASTER_CACHE_SCHEMA_VERSION = "canvas-raster-cache:v1";
const RASTER_RENDERER_VERSION = "canvas-raster-renderer:v1";
const RASTER_CAPABILITY_VERSION = "browser-raster-cache:v1";
const RASTER_DEVICE_BUCKET = "ipad-air-m2-plus";
const MEMORY_LIMIT = 192;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const memory = new Map<string, string>();
const pendingReads = new Set<string>();
const pendingWrites = new Set<string>();

const memoryKey = (kind: PersistentRasterKind, sourceKey: string): string =>
	`${kind}:${sourceKey}`;

const trimMemory = (): void => {
	while (memory.size > MEMORY_LIMIT) {
		const oldestKey = memory.keys().next().value;
		if (oldestKey === undefined) break;
		memory.delete(oldestKey);
	}
};

const artifactKeyInput = (
	kind: PersistentRasterKind,
	sourceKey: string,
): CacheArtifactKeyInput => ({
	schemaVersion: RASTER_CACHE_SCHEMA_VERSION,
	artifactKind: kind,
	documentContentHash: "raster-source",
	artifactInputHash: stableHashString(sourceKey),
	rendererVersion: RASTER_RENDERER_VERSION,
	capabilityVersion: RASTER_CAPABILITY_VERSION,
	deviceBucket: RASTER_DEVICE_BUCKET,
	dependencyKeys: [sourceKey],
});

const artifactKey = (kind: PersistentRasterKind, sourceKey: string): string =>
	createCacheArtifactKey(artifactKeyInput(kind, sourceKey));

const encodePayload = (payload: RasterArtifactPayload): Uint8Array =>
	encoder.encode(JSON.stringify(payload));

const decodePayload = (
	bytes: Uint8Array,
	sourceKey: string,
): RasterArtifactPayload | null => {
	try {
		const parsed = JSON.parse(
			decoder.decode(bytes),
		) as Partial<RasterArtifactPayload>;
		if (parsed.sourceKey !== sourceKey || typeof parsed.dataUrl !== "string") {
			return null;
		}
		return { sourceKey: parsed.sourceKey, dataUrl: parsed.dataUrl };
	} catch {
		return null;
	}
};

const manifestForPayload = (
	kind: PersistentRasterKind,
	sourceKey: string,
	bytes: Uint8Array,
): CacheArtifactManifest => {
	const input = artifactKeyInput(kind, sourceKey);
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

const isGetArtifactResult = (
	response: CacheWorkerResponse,
): response is Extract<CacheWorkerResponse, { readonly ok: true }> & {
	readonly result: {
		readonly manifest: CacheArtifactManifest;
		readonly bytes: ArrayBuffer;
	} | null;
} =>
	response.ok &&
	(response.result === null ||
		(typeof response.result === "object" &&
			"manifest" in response.result &&
			"bytes" in response.result &&
			response.result.bytes instanceof ArrayBuffer));

const readArtifactBytes = async (
	store: CacheStore,
	key: string,
): Promise<Uint8Array | null> => {
	const workerQueue = canvasCacheWorkerQueue();
	if (workerQueue) {
		try {
			const response = await workerQueue.request(
				{
					id: nextCanvasCacheRequestId("raster-get"),
					kind: "get-artifact",
					key,
				},
				{ priority: 2 },
			);
			if (isGetArtifactResult(response)) {
				return response.result ? new Uint8Array(response.result.bytes) : null;
			}
		} catch {
			// Fall back to direct store reads.
		}
	}
	const record = await store.getArtifact(key);
	return record?.bytes ?? null;
};

const writeArtifactBytes = async (
	store: CacheStore,
	manifest: CacheArtifactManifest,
	bytes: Uint8Array,
): Promise<void> => {
	const workerQueue = canvasCacheWorkerQueue();
	if (workerQueue) {
		try {
			const response = await workerQueue.request(
				{
					id: nextCanvasCacheRequestId("raster-put"),
					kind: "put-artifact",
					manifest,
					bytes: exactArrayBuffer(bytes),
				},
				{ priority: 1, estimatedBytes: bytes.byteLength },
			);
			if (response.ok) return;
		} catch {
			// Fall back to direct store writes.
		}
	}
	await store.putArtifact(manifest, bytes);
};

const hydrate = (kind: PersistentRasterKind, sourceKey: string): void => {
	const key = artifactKey(kind, sourceKey);
	if (pendingReads.has(key)) return;
	pendingReads.add(key);
	void canvasBrowserCacheStore()
		.then(async ({ store }) => {
			const bytes = await readArtifactBytes(store, key);
			if (!bytes) {
				recordCacheTelemetry({
					kind: "miss",
					artifactKind: kind,
					cacheKey: key,
					tier: store.mode,
				});
				return;
			}
			const payload = decodePayload(bytes, sourceKey);
			if (!payload) {
				await store.deleteArtifact(key);
				recordCacheTelemetry({
					kind: "error",
					artifactKind: kind,
					cacheKey: key,
					tier: store.mode,
					message: "corrupt-raster-artifact",
				});
				return;
			}
			memory.set(memoryKey(kind, sourceKey), payload.dataUrl);
			trimMemory();
			recordCacheTelemetry({
				kind: "hit",
				artifactKind: kind,
				cacheKey: key,
				tier: store.mode,
				bytes: bytes.byteLength,
			});
		})
		.catch((error) => {
			recordCacheTelemetry({
				kind: "error",
				artifactKind: kind,
				cacheKey: key,
				message: error instanceof Error ? error.message : String(error),
			});
		})
		.finally(() => pendingReads.delete(key));
};

/** Returns a synchronously-available persistent raster hit, or schedules hydrate. */
export function persistentRasterDataUrl(
	kind: PersistentRasterKind,
	sourceKey: string,
): string | undefined {
	const cached = memory.get(memoryKey(kind, sourceKey));
	if (cached) return cached;
	hydrate(kind, sourceKey);
	return undefined;
}

/** Stores a freshly generated raster artifact without blocking the render path. */
export function rememberPersistentRasterDataUrl(
	kind: PersistentRasterKind,
	sourceKey: string,
	dataUrl: string,
): void {
	const key = artifactKey(kind, sourceKey);
	const cacheKey = memoryKey(kind, sourceKey);
	memory.delete(cacheKey);
	memory.set(cacheKey, dataUrl);
	trimMemory();
	if (pendingWrites.has(key)) return;
	pendingWrites.add(key);
	const bytes = encodePayload({ sourceKey, dataUrl });
	const manifest = manifestForPayload(kind, sourceKey, bytes);
	void canvasBrowserCacheStore()
		.then(async ({ store }) => {
			await writeArtifactBytes(store, manifest, bytes);
			recordCacheTelemetry({
				kind: "put",
				artifactKind: kind,
				cacheKey: key,
				tier: store.mode,
				bytes: bytes.byteLength,
			});
		})
		.catch((error) => {
			recordCacheTelemetry({
				kind: "error",
				artifactKind: kind,
				cacheKey: key,
				message: error instanceof Error ? error.message : String(error),
			});
		})
		.finally(() => pendingWrites.delete(key));
}
