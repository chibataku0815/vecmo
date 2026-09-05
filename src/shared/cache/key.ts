import { stableHashValue } from "./hash";
import type {
	CacheArtifactKeyInput,
	CacheArtifactManifest,
	CacheManifestInput,
} from "./types";

const KEY_PREFIX = "vma-cache";

const sortedDependencyKeys = (
	keys: readonly string[] | undefined,
): readonly string[] => [...(keys ?? [])].sort();

/**
 * Builds a content-addressed key for a derived cache artifact. The key payload
 * deliberately includes renderer/capability/device buckets so old or
 * unsupported artifacts fail closed as misses instead of being manually
 * invalidated.
 */
export function createCacheArtifactKey(input: CacheArtifactKeyInput): string {
	const identity = {
		schemaVersion: input.schemaVersion,
		artifactKind: input.artifactKind,
		documentContentHash: input.documentContentHash,
		artifactInputHash: input.artifactInputHash,
		rendererVersion: input.rendererVersion,
		capabilityVersion: input.capabilityVersion,
		deviceBucket: input.deviceBucket,
		dependencyKeys: sortedDependencyKeys(input.dependencyKeys),
	};
	return `${KEY_PREFIX}:${input.artifactKind}:${stableHashValue(identity)}`;
}

/** Creates the manifest stored beside every binary payload. */
export function createCacheArtifactManifest(
	input: CacheManifestInput,
): CacheArtifactManifest {
	const now = input.now ?? Date.now();
	return {
		key: input.key,
		kind: input.artifactKind,
		schemaVersion: input.schemaVersion,
		inputHash: input.artifactInputHash,
		rendererVersion: input.rendererVersion,
		capabilityVersion: input.capabilityVersion,
		deviceBucket: input.deviceBucket,
		dependencyKeys: sortedDependencyKeys(input.dependencyKeys),
		byteLength: input.byteLength,
		createdAt: now,
		lastAccessedAt: now,
		status: input.status ?? "ready",
		blobRef: input.blobRef,
	};
}

/** Returns a copy with an updated access time without mutating the manifest. */
export function touchCacheArtifactManifest(
	manifest: CacheArtifactManifest,
	now = Date.now(),
): CacheArtifactManifest {
	return { ...manifest, lastAccessedAt: now };
}
