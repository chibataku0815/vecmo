import { createSceneDerivedCacheKeyInput } from "@/entities/scene/model/cache-keys";
import type { SceneDocument } from "@/entities/scene/model/types";
import {
	type CacheArtifactKeyInput,
	type CacheArtifactManifest,
	type CacheStore,
	type CacheWorkerResponse,
	createCacheArtifactKey,
	createCacheArtifactManifest,
	recordCacheTelemetry,
} from "@/shared/cache";
import {
	canvasBrowserCacheStore,
	canvasCacheWorkerQueue,
	exactArrayBuffer,
	nextCanvasCacheRequestId,
} from "./browser-cache-runtime";
import type { ArtboardBucketContent } from "./gpu-scene-frame";

type PersistentGpuDrawListOptions = {
	readonly sampledDocument: SceneDocument;
	readonly activeArtboardIds: ReadonlySet<string>;
	readonly tolerance: number;
};

type PersistentGpuDrawListPayload = {
	readonly kind: "gpu-draw-list";
	readonly documentHash: string;
	readonly artboards: readonly ArtboardBucketContent[];
};

type PackedFloat32Array = {
	readonly __vmaType: "Float32Array";
	readonly values: readonly number[];
};

const GPU_DRAW_LIST_RENDERER_VERSION = "gpu-draw-list-renderer:v1";
const GPU_DRAW_LIST_CAPABILITY_VERSION = "gpu-draw-list-capability:v1";
const GPU_DRAW_LIST_DEVICE_BUCKET = "ipad-air-m2-plus";
const MEMORY_LIMIT = 24;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const memory = new Map<string, readonly ArtboardBucketContent[]>();
const pendingReads = new Set<string>();
const pendingWrites = new Set<string>();

const toleranceKey = (tolerance: number): string => tolerance.toPrecision(12);

const artifactKeyInput = ({
	sampledDocument,
	activeArtboardIds,
	tolerance,
}: PersistentGpuDrawListOptions): CacheArtifactKeyInput =>
	createSceneDerivedCacheKeyInput({
		artifactKind: "gpu-draw-list",
		scene: sampledDocument,
		input: {
			activeArtboardIds: [...activeArtboardIds].sort(),
			tolerance: toleranceKey(tolerance),
		},
		rendererVersion: GPU_DRAW_LIST_RENDERER_VERSION,
		capabilityVersion: GPU_DRAW_LIST_CAPABILITY_VERSION,
		deviceBucket: GPU_DRAW_LIST_DEVICE_BUCKET,
	});

const trimMemory = (): void => {
	while (memory.size > MEMORY_LIMIT) {
		const oldestKey = memory.keys().next().value;
		if (oldestKey === undefined) break;
		memory.delete(oldestKey);
	}
};

const manifestForPayload = (
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

const isPackedFloat32Array = (value: unknown): value is PackedFloat32Array => {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return (
		record.__vmaType === "Float32Array" &&
		Array.isArray(record.values) &&
		record.values.every((entry) => typeof entry === "number")
	);
};

const encodePayload = (payload: PersistentGpuDrawListPayload): Uint8Array =>
	encoder.encode(
		JSON.stringify(payload, (_key, value: unknown) =>
			value instanceof Float32Array
				? ({
						__vmaType: "Float32Array",
						values: Array.from(value),
					} satisfies PackedFloat32Array)
				: value,
		),
	);

const decodePayload = (
	bytes: Uint8Array,
	documentHash: string,
): PersistentGpuDrawListPayload | null => {
	try {
		const parsed = JSON.parse(decoder.decode(bytes), (_key, value: unknown) =>
			isPackedFloat32Array(value) ? new Float32Array(value.values) : value,
		) as Partial<PersistentGpuDrawListPayload>;
		if (
			parsed.kind !== "gpu-draw-list" ||
			parsed.documentHash !== documentHash ||
			!Array.isArray(parsed.artboards)
		) {
			return null;
		}
		return {
			kind: "gpu-draw-list",
			documentHash: parsed.documentHash,
			artboards: parsed.artboards as readonly ArtboardBucketContent[],
		};
	} catch {
		return null;
	}
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
	const queue = canvasCacheWorkerQueue();
	if (queue) {
		try {
			const response = await queue.request(
				{
					id: nextCanvasCacheRequestId("gpu-draw-list-get"),
					kind: "get-artifact",
					key,
				},
				{ priority: 6 },
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
	const queue = canvasCacheWorkerQueue();
	if (queue) {
		try {
			const response = await queue.request(
				{
					id: nextCanvasCacheRequestId("gpu-draw-list-put"),
					kind: "put-artifact",
					manifest,
					bytes: exactArrayBuffer(bytes),
				},
				{ priority: 3, estimatedBytes: bytes.byteLength },
			);
			if (response.ok) return;
		} catch {
			// Fall back to direct store writes.
		}
	}
	await store.putArtifact(manifest, bytes);
};

const hydrate = (
	input: CacheArtifactKeyInput,
	onReady: (() => void) | undefined,
): void => {
	const key = createCacheArtifactKey(input);
	if (pendingReads.has(key) || memory.has(key)) return;
	pendingReads.add(key);
	void canvasBrowserCacheStore()
		.then(async ({ store }) => {
			const bytes = await readArtifactBytes(store, key);
			if (!bytes) {
				recordCacheTelemetry({
					kind: "miss",
					artifactKind: "gpu-draw-list",
					cacheKey: key,
					tier: store.mode,
				});
				return;
			}
			const payload = decodePayload(bytes, input.documentContentHash);
			if (!payload) {
				await store.deleteArtifact(key);
				recordCacheTelemetry({
					kind: "error",
					artifactKind: "gpu-draw-list",
					cacheKey: key,
					tier: store.mode,
					message: "corrupt-gpu-draw-list-artifact",
				});
				return;
			}
			memory.set(key, payload.artboards);
			trimMemory();
			recordCacheTelemetry({
				kind: "hit",
				artifactKind: "gpu-draw-list",
				cacheKey: key,
				tier: store.mode,
				bytes: bytes.byteLength,
			});
			onReady?.();
		})
		.catch((error) => {
			recordCacheTelemetry({
				kind: "error",
				artifactKind: "gpu-draw-list",
				cacheKey: key,
				message: error instanceof Error ? error.message : String(error),
			});
		})
		.finally(() => pendingReads.delete(key));
};

/**
 * Returns a synchronously available persisted GPU draw-list source artifact.
 * Misses schedule a background hydrate and never block the frame builder.
 */
export function persistentGpuDrawListForBucket(
	options: PersistentGpuDrawListOptions,
	onReady?: () => void,
): readonly ArtboardBucketContent[] | undefined {
	const input = artifactKeyInput(options);
	const key = createCacheArtifactKey(input);
	const cached = memory.get(key);
	if (cached) {
		recordCacheTelemetry({
			kind: "hit",
			artifactKind: "gpu-draw-list",
			cacheKey: key,
			tier: "memory",
		});
		return cached;
	}
	hydrate(input, onReady);
	return undefined;
}

/** Persists a freshly compiled draw-list source artifact off the frame path. */
export function rememberPersistentGpuDrawListForBucket(
	options: PersistentGpuDrawListOptions,
	artboards: readonly ArtboardBucketContent[],
): void {
	const input = artifactKeyInput(options);
	const key = createCacheArtifactKey(input);
	memory.delete(key);
	memory.set(key, artboards);
	trimMemory();
	if (pendingWrites.has(key)) return;
	pendingWrites.add(key);
	const bytes = encodePayload({
		kind: "gpu-draw-list",
		documentHash: input.documentContentHash,
		artboards,
	});
	const manifest = manifestForPayload(input, bytes);
	void canvasBrowserCacheStore()
		.then(async ({ store }) => {
			await writeArtifactBytes(store, manifest, bytes);
			recordCacheTelemetry({
				kind: "put",
				artifactKind: "gpu-draw-list",
				cacheKey: key,
				tier: store.mode,
				bytes: bytes.byteLength,
			});
		})
		.catch((error) => {
			recordCacheTelemetry({
				kind: "error",
				artifactKind: "gpu-draw-list",
				cacheKey: key,
				message: error instanceof Error ? error.message : String(error),
			});
		})
		.finally(() => pendingWrites.delete(key));
}
