import { createIndexedDbCacheRegistry } from "./indexeddb-store";
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

const CACHE_ROOT_DIR = "vma-cache";

type DirectoryHandleLike = {
	getDirectoryHandle(
		name: string,
		options?: { readonly create?: boolean },
	): Promise<DirectoryHandleLike>;
	getFileHandle(
		name: string,
		options?: { readonly create?: boolean },
	): Promise<FileHandleLike>;
	removeEntry(
		name: string,
		options?: { readonly recursive?: boolean },
	): Promise<void>;
};

type FileHandleLike = {
	getFile(): Promise<Blob>;
	createWritable?(): Promise<WritableFileLike>;
	createSyncAccessHandle?: (options?: {
		readonly mode?: "read-only" | "readwrite" | "readwrite-unsafe";
	}) => Promise<SyncAccessHandleLike>;
};

type WritableFileLike = {
	write(data: BufferSource | Blob | string): Promise<void>;
	close(): Promise<void>;
};

type SyncAccessHandleLike = {
	getSize(): number;
	read(buffer: BufferSource, options?: { readonly at?: number }): number;
	truncate(size: number): void;
	write(buffer: BufferSource, options?: { readonly at?: number }): number;
	flush(): void;
	close(): void;
};

type StorageManagerWithDirectory = StorageManager & {
	getDirectory?: () => Promise<DirectoryHandleLike>;
};

export type OpfsCacheStoreOptions = {
	readonly dbName?: string;
	readonly rootDirectoryName?: string;
};

const encodedFileName = (key: string): string =>
	`${encodeURIComponent(key)}.bin`;

const opfsRoot = async (
	rootDirectoryName: string,
): Promise<DirectoryHandleLike> => {
	if (typeof navigator === "undefined") {
		throw new Error("OPFS is not available outside a browser context.");
	}
	const storage = navigator.storage as StorageManagerWithDirectory | undefined;
	const root = await storage?.getDirectory?.();
	if (!root) throw new Error("OPFS root directory is not available.");
	return root.getDirectoryHandle(rootDirectoryName, { create: true });
};

const kindDirectory = async (
	rootDirectoryName: string,
	kind: CacheArtifactKind,
): Promise<DirectoryHandleLike> => {
	const root = await opfsRoot(rootDirectoryName);
	return root.getDirectoryHandle(kind, { create: true });
};

const blobPath = (kind: CacheArtifactKind, key: string): string =>
	`${kind}/${encodedFileName(key)}`;

const exactArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
};

const writeBlob = async (
	rootDirectoryName: string,
	manifest: CacheArtifactManifest,
	bytes: Uint8Array,
): Promise<string> => {
	const directory = await kindDirectory(rootDirectoryName, manifest.kind);
	const fileName = encodedFileName(manifest.key);
	const file = await directory.getFileHandle(fileName, { create: true });
	const buffer = exactArrayBuffer(bytes);
	if (file.createSyncAccessHandle) {
		let handle: SyncAccessHandleLike | null = null;
		try {
			handle = await file.createSyncAccessHandle();
			handle.truncate(0);
			handle.write(buffer, { at: 0 });
			handle.flush();
			return blobPath(manifest.kind, manifest.key);
		} catch {
			// Main-thread OPFS or lock contention can reject; fall back below.
		} finally {
			handle?.close();
		}
	}
	const writable = await file.createWritable?.();
	if (!writable) throw new Error("OPFS writable file stream is not available.");
	await writable.write(buffer);
	await writable.close();
	return blobPath(manifest.kind, manifest.key);
};

const readBlob = async (
	rootDirectoryName: string,
	manifest: CacheArtifactManifest,
): Promise<Uint8Array | null> => {
	if (manifest.blobRef.kind !== "opfs") return null;
	const directory = await kindDirectory(rootDirectoryName, manifest.kind);
	const fileName = encodedFileName(manifest.key);
	try {
		const file = await directory.getFileHandle(fileName);
		if (file.createSyncAccessHandle) {
			let handle: SyncAccessHandleLike | null = null;
			try {
				handle = await file.createSyncAccessHandle({ mode: "read-only" });
				const bytes = new Uint8Array(handle.getSize());
				handle.read(bytes, { at: 0 });
				return bytes;
			} catch {
				// Fall back to async file reads below.
			} finally {
				handle?.close();
			}
		}
		return new Uint8Array(await (await file.getFile()).arrayBuffer());
	} catch {
		return null;
	}
};

const deleteBlob = async (
	rootDirectoryName: string,
	manifest: CacheArtifactManifest,
): Promise<void> => {
	const directory = await kindDirectory(rootDirectoryName, manifest.kind);
	try {
		await directory.removeEntry(encodedFileName(manifest.key));
	} catch {
		// Missing blobs are already equivalent to cache misses.
	}
};

const deletionKeysForSweep = (
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

export function createOpfsBackedCacheStore(
	options: OpfsCacheStoreOptions = {},
): CacheStore {
	const rootDirectoryName = options.rootDirectoryName ?? CACHE_ROOT_DIR;
	const registry = createIndexedDbCacheRegistry({ dbName: options.dbName });

	const deleteArtifacts = async (
		keys: readonly string[],
	): Promise<CacheSweepResult> => {
		if (keys.length === 0) return { deletedArtifacts: 0, deletedBytes: 0 };
		const manifests = await registry.listManifests();
		const byKey = new Map(
			manifests.map((manifest) => [manifest.key, manifest]),
		);
		let deletedBytes = 0;
		for (const key of keys) {
			const manifest = byKey.get(key);
			if (!manifest) continue;
			deletedBytes += manifest.byteLength;
			await deleteBlob(rootDirectoryName, manifest);
			await registry.deleteManifest(key);
		}
		return { deletedArtifacts: keys.length, deletedBytes };
	};

	return {
		mode: "opfs",
		getManifest: registry.getManifest,
		async getArtifact(key): Promise<CacheArtifactRecord | null> {
			const manifest = await registry.getManifest(key);
			if (manifest?.status !== "ready") return null;
			const bytes = await readBlob(rootDirectoryName, manifest);
			if (!bytes) return null;
			const touched = touchCacheArtifactManifest(manifest);
			await registry.putManifest(touched);
			return { manifest: touched, bytes };
		},
		async putArtifact(manifest, bytes) {
			const path = await writeBlob(rootDirectoryName, manifest, bytes);
			const storedManifest: CacheArtifactManifest = {
				...manifest,
				blobRef: { kind: "opfs", path },
				byteLength: bytes.byteLength,
				status: "ready",
			};
			await registry.putManifest(storedManifest);
			return storedManifest;
		},
		async deleteArtifact(key) {
			await deleteArtifacts([key]);
		},
		listManifests: registry.listManifests,
		async clearDerivedArtifacts(kind) {
			const manifests = await registry.listManifests(kind);
			return deleteArtifacts(manifests.map((manifest) => manifest.key));
		},
		async sweep(options = {}) {
			const manifests = await registry.listManifests();
			return deleteArtifacts(deletionKeysForSweep(manifests, options));
		},
		async estimate(): Promise<CacheStoreEstimate> {
			const manifests = await registry.listManifests();
			const storageEstimate =
				typeof navigator !== "undefined" && navigator.storage?.estimate
					? await navigator.storage.estimate()
					: null;
			return {
				mode: "opfs",
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
