import {
	primeBlendRefreshCache,
	refreshSceneBlendNodes,
} from "@/entities/scene/model/blend";
import {
	createSceneDerivedCacheKeyInput,
	SCENE_DERIVED_CACHE_RENDERER_VERSION,
	SCENE_DERIVED_CACHE_SCHEMA_VERSION,
	sceneDocumentContentHash,
} from "@/entities/scene/model/cache-keys";
import {
	materializeLayoutFramesForPresentation,
	primeLayoutPresentationCache,
} from "@/entities/scene/model/layout-frame-presentation";
import type { SceneDocument } from "@/entities/scene/model/types";
import {
	type CacheArtifactKind,
	type CacheArtifactManifest,
	type CacheStore,
	type CacheTelemetrySnapshot,
	type CacheWorkerResponse,
	cacheTelemetrySnapshot,
	createCacheArtifactKey,
	createCacheArtifactManifest,
	recordCacheTelemetry,
} from "@/shared/cache";
import { stableJsonStringify } from "@/shared/lib/stable-json";
import {
	canvasBrowserCacheStore,
	canvasCacheWorkerQueue,
	disposeCanvasCacheRuntime,
	exactArrayBuffer,
	nextCanvasCacheRequestId,
} from "./browser-cache-runtime";

type WarmReason = "document-open" | "document-edit" | "manual";

export type CanvasPersistentCacheWarmOptions = {
	readonly scene: SceneDocument;
	readonly activeArtboardIds: ReadonlySet<string>;
	readonly reason: WarmReason;
};

export type CanvasPersistentCacheClient = {
	warmSceneDerivedArtifacts(options: CanvasPersistentCacheWarmOptions): void;
	clearDerivedArtifacts(kind?: CacheArtifactKind): Promise<void>;
	snapshot(): CacheTelemetrySnapshot;
	setInteractionActive(active: boolean): void;
	dispose(): void;
};

type IdleDeadlineLike = {
	readonly didTimeout: boolean;
	timeRemaining(): number;
};

type WindowWithIdleCallback = Window & {
	requestIdleCallback?: (
		callback: (deadline: IdleDeadlineLike) => void,
		options?: { readonly timeout?: number },
	) => number;
	cancelIdleCallback?: (handle: number) => void;
};

type SerializableSceneArtifact = {
	readonly kind: "layout-presentation" | "blend-presentation";
	readonly documentHash: string;
	readonly document: SceneDocument;
};

const CAPABILITY_VERSION = "browser-cache:v1";
const DEVICE_BUCKET = "ipad-air-m2-plus";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const scheduleIdle = (
	callback: (deadline: IdleDeadlineLike) => void,
	timeout = 900,
): (() => void) => {
	if (typeof window === "undefined") return () => {};
	const idleWindow = window as WindowWithIdleCallback;
	if (idleWindow.requestIdleCallback) {
		const handle = idleWindow.requestIdleCallback(callback, { timeout });
		return () => idleWindow.cancelIdleCallback?.(handle);
	}
	const handle = window.setTimeout(
		() =>
			callback({
				didTimeout: true,
				timeRemaining: () => 0,
			}),
		timeout,
	);
	return () => window.clearTimeout(handle);
};

const artifactInput = (scene: SceneDocument, artifactKind: CacheArtifactKind) =>
	createSceneDerivedCacheKeyInput({
		artifactKind,
		scene,
		input: {
			scope: "canvas-shell",
			projection: "full-scene",
		},
		rendererVersion: SCENE_DERIVED_CACHE_RENDERER_VERSION,
		capabilityVersion: CAPABILITY_VERSION,
		deviceBucket: DEVICE_BUCKET,
	});

const artifactManifest = (
	input: ReturnType<typeof artifactInput>,
	byteLength: number,
): CacheArtifactManifest => {
	const key = createCacheArtifactKey(input);
	return createCacheArtifactManifest({
		key,
		artifactKind: input.artifactKind,
		schemaVersion: SCENE_DERIVED_CACHE_SCHEMA_VERSION,
		documentContentHash: input.documentContentHash,
		artifactInputHash: input.artifactInputHash,
		rendererVersion: input.rendererVersion,
		capabilityVersion: input.capabilityVersion,
		deviceBucket: input.deviceBucket,
		dependencyKeys: input.dependencyKeys,
		byteLength,
		blobRef: { kind: "memory", key },
	});
};

const encodeArtifact = (
	kind: SerializableSceneArtifact["kind"],
	scene: SceneDocument,
	document: SceneDocument,
): Uint8Array =>
	encoder.encode(
		stableJsonStringify({
			kind,
			documentHash: sceneDocumentContentHash(scene),
			document,
		} satisfies SerializableSceneArtifact),
	);

const decodeArtifact = (
	bytes: Uint8Array,
): SerializableSceneArtifact | null => {
	try {
		const parsed = JSON.parse(
			decoder.decode(bytes),
		) as Partial<SerializableSceneArtifact>;
		if (
			parsed.kind !== "layout-presentation" &&
			parsed.kind !== "blend-presentation"
		) {
			return null;
		}
		if (typeof parsed.documentHash !== "string" || !parsed.document) {
			return null;
		}
		return parsed as SerializableSceneArtifact;
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

class CanvasPersistentCacheClientImpl implements CanvasPersistentCacheClient {
	#cancelIdle: (() => void) | null = null;
	#lastScheduledScene: SceneDocument | null = null;
	#lastScheduledScope = "";
	#pendingWarm: CanvasPersistentCacheWarmOptions | null = null;
	#interactionActive = false;
	#disposed = false;

	warmSceneDerivedArtifacts(options: CanvasPersistentCacheWarmOptions): void {
		if (this.#disposed) return;
		if (this.#interactionActive) {
			this.#pendingWarm = options;
			return;
		}
		const scheduleScope = `${options.reason}:${[...options.activeArtboardIds]
			.sort()
			.join(",")}`;
		if (
			this.#lastScheduledScene === options.scene &&
			this.#lastScheduledScope === scheduleScope
		) {
			return;
		}
		this.#lastScheduledScene = options.scene;
		this.#lastScheduledScope = scheduleScope;
		this.#cancelIdle?.();
		this.#cancelIdle = scheduleIdle(() => {
			void this.#warmNow(options).catch((error) => {
				recordCacheTelemetry({
					kind: "error",
					message: error instanceof Error ? error.message : String(error),
				});
			});
		});
	}

	async clearDerivedArtifacts(kind?: CacheArtifactKind): Promise<void> {
		const { store } = await canvasBrowserCacheStore();
		const result = await store.clearDerivedArtifacts(kind);
		recordCacheTelemetry({
			kind: "sweep",
			artifactKind: kind,
			tier: store.mode,
			bytes: result.deletedBytes,
			message: `clear:${result.deletedArtifacts}`,
		});
	}

	snapshot(): CacheTelemetrySnapshot {
		return cacheTelemetrySnapshot();
	}

	setInteractionActive(active: boolean): void {
		const wasActive = this.#interactionActive;
		this.#interactionActive = active;
		if (active) {
			this.#cancelIdle?.();
			this.#cancelIdle = null;
			this.#lastScheduledScene = null;
			this.#lastScheduledScope = "";
			return;
		}
		if (wasActive && this.#pendingWarm) {
			const pending = this.#pendingWarm;
			this.#pendingWarm = null;
			this.warmSceneDerivedArtifacts(pending);
		}
	}

	dispose(): void {
		this.#disposed = true;
		this.#cancelIdle?.();
		disposeCanvasCacheRuntime();
	}

	async #warmNow(options: CanvasPersistentCacheWarmOptions): Promise<void> {
		if (this.#disposed || this.#interactionActive) return;
		const { store } = await canvasBrowserCacheStore();
		await this.#warmLayoutPresentation(store, options);
		await this.#warmBlendPresentation(store, options);
		await store.sweep({ maxArtifacts: 512, maxBytes: 96 * 1024 * 1024 });
	}

	async #warmLayoutPresentation(
		store: CacheStore,
		options: CanvasPersistentCacheWarmOptions,
	): Promise<void> {
		const input = artifactInput(options.scene, "layout-presentation");
		const key = createCacheArtifactKey(input);
		const cached = await this.#readArtifact(store, key, "layout-presentation");
		if (cached && this.#primeSceneArtifact(options.scene, cached)) return;
		const materialized = materializeLayoutFramesForPresentation(options.scene);
		const bytes = encodeArtifact(
			"layout-presentation",
			options.scene,
			materialized,
		);
		await this.#writeArtifact(
			store,
			artifactManifest(input, bytes.byteLength),
			bytes,
		);
	}

	async #warmBlendPresentation(
		store: CacheStore,
		options: CanvasPersistentCacheWarmOptions,
	): Promise<void> {
		const input = artifactInput(options.scene, "blend-presentation");
		const key = createCacheArtifactKey(input);
		const cached = await this.#readArtifact(store, key, "blend-presentation");
		if (cached && this.#primeSceneArtifact(options.scene, cached)) return;
		const refreshed = refreshSceneBlendNodes(options.scene);
		const bytes = encodeArtifact(
			"blend-presentation",
			options.scene,
			refreshed,
		);
		await this.#writeArtifact(
			store,
			artifactManifest(input, bytes.byteLength),
			bytes,
		);
	}

	#primeSceneArtifact(
		scene: SceneDocument,
		artifact: SerializableSceneArtifact,
	): boolean {
		if (artifact.documentHash !== sceneDocumentContentHash(scene)) return false;
		if (artifact.kind === "layout-presentation") {
			primeLayoutPresentationCache(scene, artifact.document);
			return true;
		}
		primeBlendRefreshCache(scene, artifact.document);
		return true;
	}

	async #readArtifact(
		store: CacheStore,
		key: string,
		artifactKind: CacheArtifactKind,
	): Promise<SerializableSceneArtifact | null> {
		const start = performance.now();
		const record = await this.#readArtifactRecord(store, key);
		if (!record) {
			recordCacheTelemetry({
				kind: "miss",
				artifactKind,
				cacheKey: key,
				tier: store.mode,
				durationMs: performance.now() - start,
			});
			return null;
		}
		const artifact = decodeArtifact(record.bytes);
		if (!artifact) {
			await store.deleteArtifact(key);
			recordCacheTelemetry({
				kind: "error",
				artifactKind,
				cacheKey: key,
				tier: store.mode,
				message: "corrupt-artifact",
			});
			return null;
		}
		recordCacheTelemetry({
			kind: "hit",
			artifactKind,
			cacheKey: key,
			tier: store.mode,
			bytes: record.bytes.byteLength,
			durationMs: performance.now() - start,
		});
		return artifact;
	}

	async #readArtifactRecord(
		store: CacheStore,
		key: string,
	): Promise<{ readonly bytes: Uint8Array } | null> {
		const queue = canvasCacheWorkerQueue();
		if (queue) {
			try {
				const response = await queue.request(
					{
						id: nextCanvasCacheRequestId("get"),
						kind: "get-artifact",
						key,
					},
					{ priority: 10 },
				);
				if (isGetArtifactResult(response)) {
					return response.result
						? { bytes: new Uint8Array(response.result.bytes) }
						: null;
				}
			} catch {
				// Fall back to direct store reads.
			}
		}
		const record = await store.getArtifact(key);
		return record ? { bytes: record.bytes } : null;
	}

	async #writeArtifact(
		store: CacheStore,
		manifest: CacheArtifactManifest,
		bytes: Uint8Array,
	): Promise<void> {
		const queue = canvasCacheWorkerQueue();
		if (queue) {
			try {
				const response = await queue.request(
					{
						id: nextCanvasCacheRequestId("put"),
						kind: "put-artifact",
						manifest,
						bytes: exactArrayBuffer(bytes),
					},
					{ priority: 4, estimatedBytes: bytes.byteLength },
				);
				if (response.ok) {
					recordCacheTelemetry({
						kind: "put",
						artifactKind: manifest.kind,
						cacheKey: manifest.key,
						tier: "worker",
						bytes: bytes.byteLength,
					});
					return;
				}
			} catch {
				// Fall back to direct store writes.
			}
		}
		const stored = await store.putArtifact(manifest, bytes);
		recordCacheTelemetry({
			kind: "put",
			artifactKind: stored.kind,
			cacheKey: stored.key,
			tier: store.mode,
			bytes: bytes.byteLength,
		});
	}
}

let singleton: CanvasPersistentCacheClient | null = null;

export function getCanvasPersistentCacheClient(): CanvasPersistentCacheClient {
	singleton ??= new CanvasPersistentCacheClientImpl();
	return singleton;
}

type CanvasCacheDiagnosticsGlobal = {
	readonly snapshot: () => CacheTelemetrySnapshot;
	readonly clear: (kind?: CacheArtifactKind) => Promise<void>;
};

type GlobalWithCanvasCacheDiagnostics = typeof globalThis & {
	__vmaCanvasCache?: CanvasCacheDiagnosticsGlobal;
};

/**
 * Dev/diagnostic product control for derived cache state. It intentionally
 * exposes only snapshot and derived-artifact clear, never document/project data.
 */
export function registerCanvasCacheDiagnosticsGlobal(): () => void {
	const globalObject = globalThis as GlobalWithCanvasCacheDiagnostics;
	const client = getCanvasPersistentCacheClient();
	const controls: CanvasCacheDiagnosticsGlobal = {
		snapshot: () => client.snapshot(),
		clear: (kind) => client.clearDerivedArtifacts(kind),
	};
	globalObject.__vmaCanvasCache = controls;
	return () => {
		if (globalObject.__vmaCanvasCache === controls) {
			delete globalObject.__vmaCanvasCache;
		}
	};
}
