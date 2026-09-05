import {
	type ProductionArtifactIdentity,
	productionArtifactCacheKey,
	sameProductionArtifactIdentity,
} from "@/entities/scene/model/production-artifacts";
import type { ProductionFramePackageManifest } from "@/entities/scene/model/production-frame-package";
import { productionFramePackageByteLength } from "@/entities/scene/model/production-frame-package";

/**
 * In-memory cache of verified production artifacts, keyed by the exact artifact
 * identity `{linkId, buildKey}`.
 *
 * Two rules make this safe to hand to the renderer:
 * - Only digest-verified bytes are admitted. Admission happens in the workflow;
 *   this module deliberately owns no verification of its own, so there is one
 *   place where "verified" is decided rather than two that could disagree.
 * - Eviction never revokes an object URL a pinned identity is currently
 *   resolving to. A revoked URL still looks like a valid string to the compiler
 *   and to Babylon, so LRU pressure would otherwise surface as an unexplained
 *   blank placement rather than as a cache miss.
 */

/** Total object-URL budget. Beyond it the least recently used entry is dropped. */
const ARTIFACT_CACHE_BYTE_BUDGET = 512 * 1024 * 1024;

/**
 * Per-build-key ceiling for ONE rendered frame package.
 *
 * A rendered package is hundreds of files, not one artifact: the plan measures
 * ~8.3MB/frame raw at 1080p and ~995MB for 120 frames before encoding, and a
 * new build key is minted on every published-control edit. Without a per-key
 * ceiling a single package could exceed the whole cache budget, at which point
 * `evictToBudget` would evict every OTHER entry and still be over budget —
 * eviction pressure showing up as unrelated bands going blank.
 */
const FRAME_PACKAGE_BYTE_BUDGET = 192 * 1024 * 1024;

/**
 * Typed refusals for the rendered lane. A cache that cannot fit a package must
 * SAY so: the alternative is admitting it, blowing the budget, and surfacing
 * the consequence as an unexplained blank placement somewhere else entirely.
 */
export const PRODUCTION_CACHE_QUOTA_CODES = [
	/** This single package is larger than the per-build-key ceiling. */
	"production-cache-package-exceeds-key-budget",
	/** The package fits the ceiling, but nothing evictable frees enough room. */
	"production-cache-quota-exhausted",
	/** The manifest declared frames the caller supplied no bytes for. */
	"production-cache-package-incomplete",
] as const;
export type ProductionCacheQuotaCode =
	(typeof PRODUCTION_CACHE_QUOTA_CODES)[number];

export type ProductionArtifactCacheEntry = {
	readonly identity: ProductionArtifactIdentity;
	readonly href: string;
	readonly byteLength: number;
	readonly artifactDigest: string;
	readonly admittedAt: number;
};

/**
 * One admitted frame package. `frameHrefs` is index-addressed and dense — entry
 * `i` is the object URL for package-local frame `i` — so a consumer addresses a
 * frame by the same index the manifest uses and never by filename or by time.
 */
export type ProductionFramePackageCacheEntry = {
	readonly identity: ProductionArtifactIdentity;
	readonly manifest: ProductionFramePackageManifest;
	readonly frameHrefs: readonly string[];
	readonly byteLength: number;
	readonly admittedAt: number;
};

export type ProductionFramePackageAdmitResult =
	| { readonly ok: true; readonly entry: ProductionFramePackageCacheEntry }
	| { readonly ok: false; readonly code: ProductionCacheQuotaCode };

/** What one eviction pass actually did. Returned so a caller can observe it. */
export type ProductionCacheEvictionOutcome = {
	readonly evictedKeys: readonly string[];
	readonly freedBytes: number;
	/** True when the pass ended still over budget with nothing left to drop. */
	readonly quotaExhausted: boolean;
};

export type ProductionArtifactCache = {
	readonly get: (
		identity: ProductionArtifactIdentity,
	) => ProductionArtifactCacheEntry | null;
	readonly admit: (input: {
		readonly identity: ProductionArtifactIdentity;
		readonly bytes: Uint8Array;
		readonly artifactDigest: string;
		readonly mimeType: string;
	}) => ProductionArtifactCacheEntry;
	/** Marks the identities the renderer may currently be resolving to. */
	readonly pin: (identities: readonly ProductionArtifactIdentity[]) => void;
	readonly admitFramePackage: (input: {
		readonly identity: ProductionArtifactIdentity;
		readonly manifest: ProductionFramePackageManifest;
		/** Frame bytes in package-local index order. */
		readonly frames: readonly Uint8Array[];
		readonly mimeType: string;
	}) => ProductionFramePackageAdmitResult;
	readonly getFramePackage: (
		identity: ProductionArtifactIdentity,
	) => ProductionFramePackageCacheEntry | null;
	readonly evictLink: (linkId: string) => void;
	readonly totalBytes: () => number;
	/** Runs one eviction pass and reports it. Exposed so eviction is observable. */
	readonly evictToBudget: () => ProductionCacheEvictionOutcome;
	readonly dispose: () => void;
};

type MutableEntry = {
	identity: ProductionArtifactIdentity;
	/** Every object URL this entry owns: one for a GLB, N for a frame package. */
	hrefs: string[];
	byteLength: number;
	artifactDigest: string;
	admittedAt: number;
	lastUsedAt: number;
	manifest?: ProductionFramePackageManifest;
};

const createObjectUrl = (bytes: Uint8Array, mimeType: string): string => {
	// A fresh exact-length copy detaches the artifact from any pooled buffer the
	// fetch path may reuse, so a later overwrite cannot mutate a cached blob.
	const exact = new Uint8Array(bytes.byteLength);
	exact.set(bytes);
	return URL.createObjectURL(new Blob([exact], { type: mimeType }));
};

export const createProductionArtifactCache = ({
	byteBudget = ARTIFACT_CACHE_BYTE_BUDGET,
	framePackageByteBudget = FRAME_PACKAGE_BYTE_BUDGET,
	now = () => Date.now(),
}: {
	readonly byteBudget?: number;
	readonly framePackageByteBudget?: number;
	readonly now?: () => number;
} = {}): ProductionArtifactCache => {
	const entries = new Map<string, MutableEntry>();
	let pinned: readonly ProductionArtifactIdentity[] = [];
	let usageCounter = 0;

	const isPinned = (identity: ProductionArtifactIdentity): boolean =>
		pinned.some((candidate) =>
			sameProductionArtifactIdentity(candidate, identity),
		);

	const revoke = (entry: MutableEntry): void => {
		// Every URL the entry owns, not just the first. A frame package holds one
		// per frame, and revoking only one would leak the rest for the lifetime of
		// the document.
		for (const href of entry.hrefs) URL.revokeObjectURL(href);
	};

	const totalBytes = (): number => {
		let total = 0;
		for (const entry of entries.values()) total += entry.byteLength;
		return total;
	};

	const evictToBudget = (): ProductionCacheEvictionOutcome => {
		const evictedKeys: string[] = [];
		let freedBytes = 0;
		if (totalBytes() <= byteBudget) {
			return { evictedKeys, freedBytes, quotaExhausted: false };
		}
		const evictable = [...entries.entries()]
			.filter(([, entry]) => !isPinned(entry.identity))
			.sort(([, left], [, right]) => left.lastUsedAt - right.lastUsedAt);
		for (const [key, entry] of evictable) {
			if (totalBytes() <= byteBudget) break;
			entries.delete(key);
			revoke(entry);
			evictedKeys.push(key);
			freedBytes += entry.byteLength;
		}
		// Ending over budget is a real state, not a rounding detail: it means
		// everything left is pinned. Reporting it is what lets the rendered lane
		// fail closed instead of quietly running over quota.
		return {
			evictedKeys,
			freedBytes,
			quotaExhausted: totalBytes() > byteBudget,
		};
	};

	/**
	 * Frees room for `incomingBytes` without admitting anything yet. Returns
	 * false when the incoming package cannot fit even after dropping everything
	 * evictable, which is the caller's cue to refuse rather than overrun.
	 */
	const evictToBudgetFor = (
		incomingBytes: number,
		incoming: ProductionArtifactIdentity,
	): boolean => {
		if (totalBytes() + incomingBytes <= byteBudget) return true;
		const evictable = [...entries.entries()]
			.filter(
				([, entry]) =>
					!isPinned(entry.identity) &&
					!sameProductionArtifactIdentity(entry.identity, incoming),
			)
			.sort(([, left], [, right]) => left.lastUsedAt - right.lastUsedAt);
		for (const [key, entry] of evictable) {
			if (totalBytes() + incomingBytes <= byteBudget) return true;
			entries.delete(key);
			revoke(entry);
		}
		return totalBytes() + incomingBytes <= byteBudget;
	};

	return {
		get: (identity) => {
			const entry = entries.get(productionArtifactCacheKey(identity));
			if (!entry) return null;
			usageCounter += 1;
			entry.lastUsedAt = usageCounter;
			return {
				identity: entry.identity,
				href: entry.hrefs[0] ?? "",
				byteLength: entry.byteLength,
				artifactDigest: entry.artifactDigest,
				admittedAt: entry.admittedAt,
			};
		},
		admit: ({ identity, bytes, artifactDigest, mimeType }) => {
			const key = productionArtifactCacheKey(identity);
			const previous = entries.get(key);
			if (previous) {
				entries.delete(key);
				revoke(previous);
			}
			usageCounter += 1;
			const entry: MutableEntry = {
				identity,
				hrefs: [createObjectUrl(bytes, mimeType)],
				byteLength: bytes.byteLength,
				artifactDigest,
				admittedAt: now(),
				lastUsedAt: usageCounter,
			};
			entries.set(key, entry);
			evictToBudget();
			return {
				identity: entry.identity,
				href: entry.hrefs[0] ?? "",
				byteLength: entry.byteLength,
				artifactDigest: entry.artifactDigest,
				admittedAt: entry.admittedAt,
			};
		},
		admitFramePackage: ({ identity, manifest, frames, mimeType }) => {
			// The manifest is the authority on how many frames there are; a caller
			// that supplies a different number is not admitted with the difference
			// papered over, because a short package would silently become held
			// frames at playback.
			if (frames.length !== manifest.frameCount) {
				return { ok: false, code: "production-cache-package-incomplete" };
			}
			const declaredBytes = productionFramePackageByteLength(manifest);
			const suppliedBytes = frames.reduce(
				(total, frame) => total + frame.byteLength,
				0,
			);
			if (suppliedBytes !== declaredBytes) {
				return { ok: false, code: "production-cache-package-incomplete" };
			}
			if (declaredBytes > framePackageByteBudget) {
				return {
					ok: false,
					code: "production-cache-package-exceeds-key-budget",
				};
			}
			const key = productionArtifactCacheKey(identity);
			const previous = entries.get(key);
			if (previous) {
				entries.delete(key);
				revoke(previous);
			}
			// Room is made BEFORE the URLs exist. Creating them first and evicting
			// afterwards would let a package that cannot fit still allocate every
			// blob it needs, which is the allocation this refusal exists to avoid.
			const headroom = evictToBudgetFor(declaredBytes, identity);
			if (!headroom) {
				return { ok: false, code: "production-cache-quota-exhausted" };
			}
			usageCounter += 1;
			const entry: MutableEntry = {
				identity,
				hrefs: frames.map((frame) => createObjectUrl(frame, mimeType)),
				byteLength: declaredBytes,
				artifactDigest: manifest.buildKey,
				admittedAt: now(),
				lastUsedAt: usageCounter,
				manifest,
			};
			entries.set(key, entry);
			return {
				ok: true,
				entry: {
					identity: entry.identity,
					manifest,
					frameHrefs: [...entry.hrefs],
					byteLength: entry.byteLength,
					admittedAt: entry.admittedAt,
				},
			};
		},
		getFramePackage: (identity) => {
			const entry = entries.get(productionArtifactCacheKey(identity));
			if (!entry?.manifest) return null;
			usageCounter += 1;
			entry.lastUsedAt = usageCounter;
			return {
				identity: entry.identity,
				manifest: entry.manifest,
				frameHrefs: [...entry.hrefs],
				byteLength: entry.byteLength,
				admittedAt: entry.admittedAt,
			};
		},
		evictToBudget,
		pin: (identities) => {
			pinned = [...identities];
		},
		evictLink: (linkId) => {
			// The doomed set is materialized before any deletion, because deleting
			// from a Map that is still being iterated is how an eviction silently
			// leaves a revoked object URL reachable.
			const doomed = [...entries].filter(
				([, entry]) => entry.identity.linkId === linkId,
			);
			for (const [key, entry] of doomed) {
				entries.delete(key);
				revoke(entry);
			}
		},
		totalBytes,
		dispose: () => {
			for (const entry of entries.values()) revoke(entry);
			entries.clear();
			pinned = [];
		},
	};
};
