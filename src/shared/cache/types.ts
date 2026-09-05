export type CacheArtifactKind =
	| "layout-presentation"
	| "layout-motion-presentation"
	| "blend-presentation"
	| "hit-index"
	| "text-raster"
	| "mesh-raster"
	| "image-decode"
	| "look-graph-compile"
	| "gpu-draw-list"
	| "gpu-upload-source";

export type CachePersistenceMode = "opfs" | "indexeddb-blob" | "memory";
export type CacheParallelMode = "worker" | "main-thread-budgeted";
export type CacheGpuMode = "webgpu" | "svg-fallback";

export type CacheCapabilityPolicy = {
	readonly persistent: CachePersistenceMode;
	readonly parallel: CacheParallelMode;
	readonly gpu: CacheGpuMode;
};

export type CacheStorageEstimate = {
	readonly usage: number | null;
	readonly quota: number | null;
	readonly available: number | null;
	readonly persisted: boolean | null;
	readonly canRequestPersistence: boolean;
};

export type CacheCapabilityProbe = {
	readonly checkedAt: number;
	readonly secureContext: boolean;
	readonly indexedDb: boolean;
	readonly storageEstimate: CacheStorageEstimate;
	readonly opfs: {
		readonly available: boolean;
		readonly syncAccessHandleInWorker: boolean;
		readonly failureReason?: string;
	};
	readonly worker: {
		readonly available: boolean;
		readonly moduleWorker: boolean;
	};
	readonly offscreenCanvas: {
		readonly available: boolean;
		readonly transferable: boolean;
	};
	readonly webgpu: {
		readonly available: boolean;
		readonly adapter: "available" | "unavailable" | "not-requested";
		readonly device: "available" | "unavailable" | "not-requested";
		readonly limitsBucket?: string;
	};
	readonly policy: CacheCapabilityPolicy;
};

export type CacheBlobRef =
	| {
			readonly kind: "opfs";
			readonly path: string;
	  }
	| {
			readonly kind: "indexeddb";
			readonly key: string;
	  }
	| {
			readonly kind: "memory";
			readonly key: string;
	  };

export type CacheArtifactManifest = {
	readonly key: string;
	readonly kind: CacheArtifactKind;
	readonly schemaVersion: string;
	readonly inputHash: string;
	readonly rendererVersion: string;
	readonly capabilityVersion: string;
	readonly deviceBucket: string;
	readonly dependencyKeys: readonly string[];
	readonly byteLength: number;
	readonly createdAt: number;
	readonly lastAccessedAt: number;
	readonly status: "ready" | "pending" | "corrupt";
	readonly blobRef: CacheBlobRef;
};

export type CacheArtifactRecord = {
	readonly manifest: CacheArtifactManifest;
	readonly bytes: Uint8Array;
};

export type CacheStoreEstimate = {
	readonly mode: CachePersistenceMode;
	readonly artifacts: number;
	readonly bytes: number;
	readonly quota: number | null;
};

export type CacheSweepOptions = {
	readonly maxBytes?: number;
	readonly maxArtifacts?: number;
	readonly olderThanMs?: number;
};

export type CacheSweepResult = {
	readonly deletedArtifacts: number;
	readonly deletedBytes: number;
};

export type CacheStore = {
	readonly mode: CachePersistenceMode;
	getManifest(key: string): Promise<CacheArtifactManifest | null>;
	getArtifact(key: string): Promise<CacheArtifactRecord | null>;
	putArtifact(
		manifest: CacheArtifactManifest,
		bytes: Uint8Array,
	): Promise<CacheArtifactManifest>;
	deleteArtifact(key: string): Promise<void>;
	listManifests(
		kind?: CacheArtifactKind,
	): Promise<readonly CacheArtifactManifest[]>;
	clearDerivedArtifacts(kind?: CacheArtifactKind): Promise<CacheSweepResult>;
	sweep(options?: CacheSweepOptions): Promise<CacheSweepResult>;
	estimate(): Promise<CacheStoreEstimate>;
};

export type CacheArtifactKeyInput = {
	readonly schemaVersion: string;
	readonly artifactKind: CacheArtifactKind;
	readonly documentContentHash: string;
	readonly artifactInputHash: string;
	readonly rendererVersion: string;
	readonly capabilityVersion: string;
	readonly deviceBucket: string;
	readonly dependencyKeys?: readonly string[];
};

export type CacheManifestInput = CacheArtifactKeyInput & {
	readonly key: string;
	readonly byteLength: number;
	readonly blobRef: CacheBlobRef;
	readonly now?: number;
	readonly status?: CacheArtifactManifest["status"];
};
