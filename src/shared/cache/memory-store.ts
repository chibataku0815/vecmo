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

type MemoryEntry = {
	readonly manifest: CacheArtifactManifest;
	readonly bytes: Uint8Array;
};

const cloneBytes = (bytes: Uint8Array): Uint8Array => bytes.slice();

const shouldDeleteForSweep = (
	entry: MemoryEntry,
	now: number,
	options: CacheSweepOptions,
): boolean =>
	options.olderThanMs !== undefined &&
	now - entry.manifest.lastAccessedAt > options.olderThanMs;

const emptySweepResult: CacheSweepResult = {
	deletedArtifacts: 0,
	deletedBytes: 0,
};

/** In-memory implementation of the derived-cache store contract. */
export function createMemoryCacheStore(): CacheStore {
	const entries = new Map<string, MemoryEntry>();

	const deleteKeys = (keys: readonly string[]): CacheSweepResult => {
		let deletedArtifacts = 0;
		let deletedBytes = 0;
		for (const key of keys) {
			const entry = entries.get(key);
			if (!entry) continue;
			deletedArtifacts += 1;
			deletedBytes += entry.manifest.byteLength;
			entries.delete(key);
		}
		return { deletedArtifacts, deletedBytes };
	};

	return {
		mode: "memory",
		async getManifest(key) {
			const entry = entries.get(key);
			return entry ? entry.manifest : null;
		},
		async getArtifact(key): Promise<CacheArtifactRecord | null> {
			const entry = entries.get(key);
			if (!entry) return null;
			const manifest = touchCacheArtifactManifest(entry.manifest);
			entries.delete(key);
			entries.set(key, { manifest, bytes: entry.bytes });
			return { manifest, bytes: cloneBytes(entry.bytes) };
		},
		async putArtifact(manifest, bytes) {
			const storedManifest: CacheArtifactManifest = {
				...manifest,
				blobRef:
					manifest.blobRef.kind === "memory"
						? manifest.blobRef
						: { kind: "memory", key: manifest.key },
				byteLength: bytes.byteLength,
				status: "ready",
			};
			entries.set(manifest.key, {
				manifest: storedManifest,
				bytes: cloneBytes(bytes),
			});
			return storedManifest;
		},
		async deleteArtifact(key) {
			entries.delete(key);
		},
		async listManifests(kind?: CacheArtifactKind) {
			return [...entries.values()]
				.map((entry) => entry.manifest)
				.filter((manifest) => !kind || manifest.kind === kind);
		},
		async clearDerivedArtifacts(kind?: CacheArtifactKind) {
			const keys = [...entries.values()]
				.filter((entry) => !kind || entry.manifest.kind === kind)
				.map((entry) => entry.manifest.key);
			return deleteKeys(keys);
		},
		async sweep(options: CacheSweepOptions = {}) {
			if (
				options.maxArtifacts === undefined &&
				options.maxBytes === undefined &&
				options.olderThanMs === undefined
			) {
				return emptySweepResult;
			}
			const now = Date.now();
			const oldestFirst = [...entries.values()].sort(
				(a, b) => a.manifest.lastAccessedAt - b.manifest.lastAccessedAt,
			);
			const keys = new Set<string>();
			for (const entry of oldestFirst) {
				if (shouldDeleteForSweep(entry, now, options)) {
					keys.add(entry.manifest.key);
				}
			}
			let retained = oldestFirst.filter(
				(entry) => !keys.has(entry.manifest.key),
			);
			if (options.maxArtifacts !== undefined) {
				while (retained.length > options.maxArtifacts) {
					const [entry] = retained;
					if (!entry) break;
					keys.add(entry.manifest.key);
					retained = retained.slice(1);
				}
			}
			if (options.maxBytes !== undefined) {
				let bytes = retained.reduce(
					(sum, entry) => sum + entry.manifest.byteLength,
					0,
				);
				while (bytes > options.maxBytes && retained.length > 0) {
					const [entry] = retained;
					if (!entry) break;
					keys.add(entry.manifest.key);
					bytes -= entry.manifest.byteLength;
					retained = retained.slice(1);
				}
			}
			return deleteKeys([...keys]);
		},
		async estimate(): Promise<CacheStoreEstimate> {
			return {
				mode: "memory",
				artifacts: entries.size,
				bytes: [...entries.values()].reduce(
					(sum, entry) => sum + entry.manifest.byteLength,
					0,
				),
				quota: null,
			};
		},
	};
}
