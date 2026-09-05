import { probeBrowserCacheCapabilities } from "./capabilities";
import { createIndexedDbCacheStore } from "./indexeddb-store";
import { createMemoryCacheStore } from "./memory-store";
import { createOpfsBackedCacheStore } from "./opfs-store";
import type {
	CacheCapabilityProbe,
	CacheStore,
	CacheStoreEstimate,
} from "./types";

export type BrowserCacheStoreOptions = {
	readonly dbName?: string;
	readonly rootDirectoryName?: string;
	readonly probe?: CacheCapabilityProbe;
};

export type BrowserCacheStore = {
	readonly probe: CacheCapabilityProbe;
	readonly store: CacheStore;
	estimate(): Promise<CacheStoreEstimate>;
};

/**
 * Selects the strongest browser cache store supported by the current runtime:
 * OPFS blobs with IndexedDB metadata, IndexedDB Blob fallback, then memory.
 */
export async function createBrowserCacheStore(
	options: BrowserCacheStoreOptions = {},
): Promise<BrowserCacheStore> {
	const probe = options.probe ?? (await probeBrowserCacheCapabilities());
	if (probe.policy.persistent === "opfs") {
		try {
			const store = createOpfsBackedCacheStore({
				dbName: options.dbName,
				rootDirectoryName: options.rootDirectoryName,
			});
			await store.estimate();
			return { probe, store, estimate: () => store.estimate() };
		} catch {
			// Fall through to IndexedDB. OPFS failure should never be product-fatal.
		}
	}
	if (probe.policy.persistent !== "memory") {
		try {
			const store = createIndexedDbCacheStore({ dbName: options.dbName });
			await store.estimate();
			return { probe, store, estimate: () => store.estimate() };
		} catch {
			// Fall through to memory.
		}
	}
	const store = createMemoryCacheStore();
	return { probe, store, estimate: () => store.estimate() };
}
