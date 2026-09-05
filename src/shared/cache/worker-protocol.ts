import type {
	CacheArtifactKind,
	CacheArtifactManifest,
	CacheCapabilityProbe,
	CacheStoreEstimate,
	CacheSweepOptions,
	CacheSweepResult,
} from "./types";

export type CacheWorkerRequest =
	| {
			readonly id: string;
			readonly kind: "probe";
	  }
	| {
			readonly id: string;
			readonly kind: "get-artifact";
			readonly key: string;
	  }
	| {
			readonly id: string;
			readonly kind: "put-artifact";
			readonly manifest: CacheArtifactManifest;
			readonly bytes: ArrayBuffer;
	  }
	| {
			readonly id: string;
			readonly kind: "delete-artifact";
			readonly key: string;
	  }
	| {
			readonly id: string;
			readonly kind: "clear";
			readonly artifactKind?: CacheArtifactKind;
	  }
	| {
			readonly id: string;
			readonly kind: "sweep";
			readonly options?: CacheSweepOptions;
	  }
	| {
			readonly id: string;
			readonly kind: "estimate";
	  };

export type CacheWorkerResultByKind = {
	readonly probe: CacheCapabilityProbe;
	readonly "get-artifact": {
		readonly manifest: CacheArtifactManifest;
		readonly bytes: ArrayBuffer;
	} | null;
	readonly "put-artifact": CacheArtifactManifest;
	readonly "delete-artifact": null;
	readonly clear: CacheSweepResult;
	readonly sweep: CacheSweepResult;
	readonly estimate: CacheStoreEstimate;
};

export type CacheWorkerResponse =
	| {
			readonly id: string;
			readonly ok: true;
			readonly result:
				| CacheCapabilityProbe
				| CacheWorkerResultByKind["get-artifact"]
				| CacheArtifactManifest
				| CacheSweepResult
				| CacheStoreEstimate
				| null;
	  }
	| {
			readonly id: string;
			readonly ok: false;
			readonly error: string;
	  };

export type CacheWorkerQueuedRequest = {
	readonly request: CacheWorkerRequest;
	readonly priority: number;
	readonly estimatedBytes: number;
};

export const cacheWorkerTransferables = (
	message: CacheWorkerRequest | CacheWorkerResponse,
): readonly Transferable[] => {
	if ("kind" in message && message.kind === "put-artifact")
		return [message.bytes];
	if ("ok" in message && message.ok && message.result) {
		const result = message.result;
		if (
			typeof result === "object" &&
			"bytes" in result &&
			result.bytes instanceof ArrayBuffer
		) {
			return [result.bytes];
		}
	}
	return [];
};
