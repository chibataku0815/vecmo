import { touchCacheArtifactManifest } from "./key";
import type {
	CacheArtifactKind,
	CacheArtifactManifest,
	CacheArtifactRecord,
	CacheStore,
	CacheStoreEstimate,
	CacheSweepOptions,
	CacheSweepResult,
} from "./types";

const DEFAULT_DB_NAME = "vma-derived-cache";
const DB_VERSION = 1;
const ARTIFACTS_STORE = "artifacts";
const PAYLOADS_STORE = "payloads";

type PayloadRow = {
	readonly key: string;
	readonly bytes: ArrayBuffer;
};

export type IndexedDbCacheOptions = {
	readonly dbName?: string;
};

export type IndexedDbCacheRegistry = {
	getManifest(key: string): Promise<CacheArtifactManifest | null>;
	putManifest(manifest: CacheArtifactManifest): Promise<void>;
	deleteManifest(key: string): Promise<void>;
	listManifests(
		kind?: CacheArtifactKind,
	): Promise<readonly CacheArtifactManifest[]>;
};

const exactArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
};

const isDomExceptionName = (error: unknown, name: string): boolean =>
	error instanceof DOMException && error.name === name;

const requestToPromise = <T>(request: IDBRequest<T>): Promise<T> =>
	new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});

const transactionDone = (transaction: IDBTransaction): Promise<void> =>
	new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onabort = () =>
			reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
		transaction.onerror = () =>
			reject(transaction.error ?? new Error("IndexedDB transaction failed."));
	});

const openCacheDatabase = (dbName = DEFAULT_DB_NAME): Promise<IDBDatabase> => {
	if (typeof indexedDB === "undefined") {
		return Promise.reject(new Error("IndexedDB is not available."));
	}
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(dbName, DB_VERSION);
		request.onupgradeneeded = () => {
			const database = request.result;
			if (!database.objectStoreNames.contains(ARTIFACTS_STORE)) {
				const artifacts = database.createObjectStore(ARTIFACTS_STORE, {
					keyPath: "key",
				});
				artifacts.createIndex("kind", "kind", { unique: false });
				artifacts.createIndex("lastAccessedAt", "lastAccessedAt", {
					unique: false,
				});
			}
			if (!database.objectStoreNames.contains(PAYLOADS_STORE)) {
				database.createObjectStore(PAYLOADS_STORE, { keyPath: "key" });
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
		request.onblocked = () =>
			reject(new Error("IndexedDB cache schema upgrade is blocked."));
	});
};

const artifactStore = (
	database: IDBDatabase,
	mode: IDBTransactionMode,
): { readonly store: IDBObjectStore; readonly transaction: IDBTransaction } => {
	const transaction = database.transaction(ARTIFACTS_STORE, mode);
	return { transaction, store: transaction.objectStore(ARTIFACTS_STORE) };
};

const isManifest = (value: unknown): value is CacheArtifactManifest =>
	typeof value === "object" &&
	value !== null &&
	"key" in value &&
	"kind" in value &&
	"schemaVersion" in value &&
	"blobRef" in value;

const isPayloadRow = (value: unknown): value is PayloadRow =>
	typeof value === "object" &&
	value !== null &&
	"key" in value &&
	"bytes" in value &&
	(value as { readonly bytes?: unknown }).bytes instanceof ArrayBuffer;

export function createIndexedDbCacheRegistry(
	options: IndexedDbCacheOptions = {},
): IndexedDbCacheRegistry {
	const databasePromise = openCacheDatabase(options.dbName);

	return {
		async getManifest(key) {
			const database = await databasePromise;
			const { store } = artifactStore(database, "readonly");
			const result = await requestToPromise<unknown>(store.get(key));
			return isManifest(result) ? result : null;
		},
		async putManifest(manifest) {
			const database = await databasePromise;
			const { store, transaction } = artifactStore(database, "readwrite");
			store.put(manifest);
			await transactionDone(transaction);
		},
		async deleteManifest(key) {
			const database = await databasePromise;
			const { store, transaction } = artifactStore(database, "readwrite");
			store.delete(key);
			await transactionDone(transaction);
		},
		async listManifests(kind) {
			const database = await databasePromise;
			const { store } = artifactStore(database, "readonly");
			const result = await requestToPromise<unknown[]>(store.getAll());
			return result
				.filter(isManifest)
				.filter((manifest) => !kind || manifest.kind === kind);
		},
	};
}

const listKeysForDeletion = (
	manifests: readonly CacheArtifactManifest[],
	options: CacheSweepOptions,
): readonly string[] => {
	const now = Date.now();
	const keys = new Set<string>();
	const oldestFirst = [...manifests].sort(
		(a, b) => a.lastAccessedAt - b.lastAccessedAt,
	);
	for (const manifest of oldestFirst) {
		if (
			options.olderThanMs !== undefined &&
			now - manifest.lastAccessedAt > options.olderThanMs
		) {
			keys.add(manifest.key);
		}
	}
	let retained = oldestFirst.filter((manifest) => !keys.has(manifest.key));
	if (options.maxArtifacts !== undefined) {
		while (retained.length > options.maxArtifacts) {
			const [manifest] = retained;
			if (!manifest) break;
			keys.add(manifest.key);
			retained = retained.slice(1);
		}
	}
	if (options.maxBytes !== undefined) {
		let bytes = retained.reduce(
			(sum, manifest) => sum + manifest.byteLength,
			0,
		);
		while (bytes > options.maxBytes && retained.length > 0) {
			const [manifest] = retained;
			if (!manifest) break;
			keys.add(manifest.key);
			bytes -= manifest.byteLength;
			retained = retained.slice(1);
		}
	}
	return [...keys];
};

export function createIndexedDbCacheStore(
	options: IndexedDbCacheOptions = {},
): CacheStore {
	const databasePromise = openCacheDatabase(options.dbName);
	const registry = createIndexedDbCacheRegistry(options);

	const deleteArtifactRows = async (
		keys: readonly string[],
	): Promise<CacheSweepResult> => {
		if (keys.length === 0) return { deletedArtifacts: 0, deletedBytes: 0 };
		const manifests = await registry.listManifests();
		const bytesByKey = new Map(
			manifests.map((manifest) => [manifest.key, manifest.byteLength]),
		);
		const database = await databasePromise;
		const transaction = database.transaction(
			[ARTIFACTS_STORE, PAYLOADS_STORE],
			"readwrite",
		);
		const artifacts = transaction.objectStore(ARTIFACTS_STORE);
		const payloads = transaction.objectStore(PAYLOADS_STORE);
		for (const key of keys) {
			artifacts.delete(key);
			payloads.delete(key);
		}
		await transactionDone(transaction);
		return {
			deletedArtifacts: keys.length,
			deletedBytes: keys.reduce(
				(sum, key) => sum + (bytesByKey.get(key) ?? 0),
				0,
			),
		};
	};

	return {
		mode: "indexeddb-blob",
		getManifest: registry.getManifest,
		async getArtifact(key): Promise<CacheArtifactRecord | null> {
			const manifest = await registry.getManifest(key);
			if (manifest?.status !== "ready") return null;
			const database = await databasePromise;
			const transaction = database.transaction(PAYLOADS_STORE, "readonly");
			const payloads = transaction.objectStore(PAYLOADS_STORE);
			const row = await requestToPromise<unknown>(payloads.get(key));
			if (!isPayloadRow(row)) return null;
			const touched = touchCacheArtifactManifest(manifest);
			await registry.putManifest(touched);
			return { manifest: touched, bytes: new Uint8Array(row.bytes.slice(0)) };
		},
		async putArtifact(manifest, bytes) {
			const database = await databasePromise;
			const storedManifest: CacheArtifactManifest = {
				...manifest,
				blobRef: { kind: "indexeddb", key: manifest.key },
				byteLength: bytes.byteLength,
				status: "ready",
			};
			const transaction = database.transaction(
				[ARTIFACTS_STORE, PAYLOADS_STORE],
				"readwrite",
			);
			transaction
				.objectStore(PAYLOADS_STORE)
				.put({ key: manifest.key, bytes: exactArrayBuffer(bytes) });
			transaction.objectStore(ARTIFACTS_STORE).put(storedManifest);
			try {
				await transactionDone(transaction);
				return storedManifest;
			} catch (error) {
				if (isDomExceptionName(error, "QuotaExceededError")) throw error;
				throw error;
			}
		},
		async deleteArtifact(key) {
			await deleteArtifactRows([key]);
		},
		listManifests: registry.listManifests,
		async clearDerivedArtifacts(kind) {
			const manifests = await registry.listManifests(kind);
			return deleteArtifactRows(manifests.map((manifest) => manifest.key));
		},
		async sweep(options = {}) {
			const manifests = await registry.listManifests();
			return deleteArtifactRows(listKeysForDeletion(manifests, options));
		},
		async estimate(): Promise<CacheStoreEstimate> {
			const manifests = await registry.listManifests();
			const storageEstimate =
				typeof navigator !== "undefined" && navigator.storage?.estimate
					? await navigator.storage.estimate()
					: null;
			return {
				mode: "indexeddb-blob",
				artifacts: manifests.length,
				bytes: manifests.reduce(
					(sum, manifest) => sum + manifest.byteLength,
					0,
				),
				quota: storageEstimate?.quota ?? null,
			};
		},
	};
}
