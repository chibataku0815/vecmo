/**
 * Deterministic build-key derivation and admission verdicts for artifacts
 * produced from a linked external production.
 *
 * Two disciplines are load-bearing here:
 * - This module is the SINGLE derivation of a build key. The browser feature
 *   store and the Bun companion both import it, because two ports of the same
 *   canonicalization would turn every canonicalization divergence into an
 *   indistinguishable `digest-mismatch`.
 * - The DESIRED build key is derived, never stored. It is a pure function of
 *   the durable link contract, this machine's freshly observed source digest,
 *   and the producing environment. Undo restores the document, so the desired
 *   key follows the document rather than surviving it.
 *
 * It is POJO-only and dependency-free apart from `production-link`'s types and
 * strict parser, so the Bun companion can import it without pulling any browser
 * runtime. Hashing goes through WebCrypto, which exists in both hosts.
 *
 * Digest convention: every digest on this contract is BARE lowercase hex
 * SHA-256 (64 characters, no `sha256:` prefix). `parseExternalProductionLink`
 * accepts that form unchanged, so a wire digest round-trips into the durable
 * document through `scene/link-production` without transformation.
 */

import {
	type ExternalProductionLink,
	resolveExternalProductionLink,
} from "./production-link";

/**
 * Structural view of one working-copy binding. It is declared here rather than
 * imported so this module stays free of `entities/editor-session`'s storage
 * layer; the registry's `ProductionLinkBinding` satisfies it by shape.
 */
export type ProductionLinkBindingSnapshot = {
	readonly sourceDigest?: string;
};

/**
 * Identifies which adapter produced an artifact. It is a hashed build-key field
 * because a change in export settings or lowering rules changes the output for
 * an otherwise identical source.
 */
export const PRODUCTION_ARTIFACT_ADAPTER_VERSION = "blender-link-companion-1";

/** Bare lowercase hex SHA-256. */
const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const HEX_RADIX = 16;
const HEX_PAIR_WIDTH = 2;

/** Identity of one produced artifact. Both halves are required to admit it. */
export type ProductionArtifactIdentity = {
	readonly linkId: string;
	readonly buildKey: string;
};

/**
 * Producing-environment facts that only a fresh inspect can supply. There is
 * deliberately no fallback: with no companion inspect there is no desired build
 * key at all, which is the honest `Disconnected` state rather than a fabricated
 * `Stale`.
 */
export type ProductionBuildEnvironment = {
	readonly blenderVersion: string;
	/** Build hash, enabled add-ons, color management, host platform. */
	readonly environmentDigest: string;
	/** Engine, resolution, aspect, film transparency, color management. */
	readonly renderSettingsDigest: string;
	/** Observed source-closure digest for the currently bound local file. */
	readonly sourceDigest: string;
	readonly adapterVersion?: string;
};

/** The ten hashed contract fields, in the design's enumerated order. */
export type ProductionBuildKeyFields = {
	readonly sourceDigest: string;
	readonly contractVersion: number;
	readonly adapterVersion: string;
	readonly blenderVersion: string;
	readonly outputProfile: string;
	readonly frameContract: string;
	readonly cameraDigest: string;
	readonly publishedControlDigest: string;
	readonly renderSettingsDigest: string;
	readonly environmentDigest: string;
};

export type ProductionArtifactAdmissionVerdict =
	| { readonly status: "verified"; readonly artifactDigest: string }
	| {
			readonly status: "digest-mismatch";
			readonly expectedDigest: string;
			readonly actualDigest: string;
	  }
	| {
			readonly status: "incomplete";
			readonly reason:
				| "byte-length-mismatch"
				| "empty-payload"
				| "digest-unavailable"
				| "digest-malformed";
	  };

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export const isProductionDigest = (value: unknown): value is string =>
	typeof value === "string" && DIGEST_PATTERN.test(value);

/**
 * Sorted keys, `undefined` dropped, no whitespace. This is the exact semantic
 * of `scripts/blender-link-spike/buildkey.ts`, re-expressed without Bun APIs.
 */
export const canonicalProductionJson = (value: unknown): string => {
	if (value === null) return "null";
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value === "boolean") return value ? "true" : "false";
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new TypeError(
				"Production canonical JSON rejects non-finite numbers.",
			);
		}
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map(canonicalProductionJson).join(",")}]`;
	}
	if (isRecord(value)) {
		const entries = Object.keys(value)
			.sort((left, right) => (left === right ? 0 : left < right ? -1 : 1))
			.filter((key) => value[key] !== undefined)
			.map(
				(key) =>
					`${JSON.stringify(key)}:${canonicalProductionJson(value[key])}`,
			);
		return `{${entries.join(",")}}`;
	}
	throw new TypeError("Production canonical JSON rejects non-JSON values.");
};

const hex = (buffer: ArrayBuffer): string =>
	Array.from(new Uint8Array(buffer), (byte) =>
		byte.toString(HEX_RADIX).padStart(HEX_PAIR_WIDTH, "0"),
	).join("");

const subtleDigest = async (bytes: Uint8Array): Promise<string | null> => {
	if (typeof globalThis.crypto?.subtle?.digest !== "function") return null;
	try {
		// A fresh exact-length copy avoids hashing a pooled buffer's slack.
		const exact = new Uint8Array(bytes.byteLength);
		exact.set(bytes);
		return hex(await globalThis.crypto.subtle.digest("SHA-256", exact.buffer));
	} catch {
		return null;
	}
};

/** SHA-256 over raw bytes. Returns `null` where WebCrypto is unavailable. */
export const productionDigestOfBytes = (
	bytes: Uint8Array,
): Promise<string | null> => subtleDigest(bytes);

/** SHA-256 over UTF-8 text. Returns `null` where WebCrypto is unavailable. */
export const productionDigestOfText = (text: string): Promise<string | null> =>
	subtleDigest(new TextEncoder().encode(text));

const digestOfCanonical = (value: unknown): Promise<string | null> =>
	productionDigestOfText(canonicalProductionJson(value));

/**
 * Closure digest over the `.blend` bytes plus every resolved external
 * dependency. Recorded explicitly so a source that later grows textures or
 * linked libraries cannot silently reuse a bytes-only key.
 */
export const productionSourceClosureDigest = async (
	blendBytesDigest: string,
	externalDigests: readonly string[],
): Promise<string | null> =>
	productionDigestOfText(
		canonicalProductionJson({
			blendBytes: blendBytesDigest,
			externalClosure: [...externalDigests].sort(),
		}),
	);

/**
 * Motion-owned half of a control's state, projected to plain JSON by
 * `entities/scene/model/production-control.ts`. It is passed in rather than read
 * here so this module keeps importing nothing but `production-link`, which is
 * what lets the Bun companion derive the same key without a browser runtime.
 *
 * Omitting it is NOT the same as passing an empty array only by accident: an
 * absent argument and an empty track set both canonicalize to `[]`, so a
 * document with no control keyframes keeps the key it had before this field
 * existed.
 */
export type ProductionControlTracksDigestInput = readonly unknown[];

/**
 * Derives the ten hashed fields. The camera, frame, and control digests come
 * from the durable link (Vecmo is authoritative for those); the environment,
 * render, and source digests come from a fresh inspect.
 *
 * `publishedControlDigest` covers the declared controls, the authored STATIC
 * values, and the control KEYFRAME tracks. All three change what the producing
 * side is asked to evaluate, so any control edit must move the desired build key
 * — otherwise a rebuilt artifact could be admitted under a key that no longer
 * describes it.
 */
export const deriveProductionBuildKeyFields = async (
	link: ExternalProductionLink,
	environment: ProductionBuildEnvironment,
	controlTracks: ProductionControlTracksDigestInput = [],
): Promise<ProductionBuildKeyFields | null> => {
	const frameContract = await digestOfCanonical(link.frame);
	const cameraDigest = await digestOfCanonical(link.camera);
	const publishedControlDigest = await digestOfCanonical({
		controls: link.controls.map((control) => ({
			id: control.id,
			unit: control.unit,
			valueType: control.valueType,
			defaultValue: control.defaultValue,
			min: control.min,
			max: control.max,
			rangeDeclared: control.rangeDeclared,
			defaultIsAmbiguous: control.defaultIsAmbiguous,
			binding: control.blenderBinding,
		})),
		values: link.values ?? [],
		tracks: controlTracks,
	});
	if (!frameContract || !cameraDigest || !publishedControlDigest) return null;
	if (
		!isProductionDigest(environment.sourceDigest) ||
		!isProductionDigest(environment.environmentDigest) ||
		!isProductionDigest(environment.renderSettingsDigest)
	) {
		return null;
	}
	return {
		sourceDigest: environment.sourceDigest,
		contractVersion: link.contractVersion,
		adapterVersion:
			environment.adapterVersion ?? PRODUCTION_ARTIFACT_ADAPTER_VERSION,
		blenderVersion: environment.blenderVersion,
		outputProfile: link.outputProfile,
		frameContract,
		cameraDigest,
		publishedControlDigest,
		renderSettingsDigest: environment.renderSettingsDigest,
		environmentDigest: environment.environmentDigest,
	};
};

/** `sha256(canonicalJSON(tenFields))`. Returns `null` when derivation failed. */
export const deriveProductionBuildKey = async (
	link: ExternalProductionLink,
	environment: ProductionBuildEnvironment,
	controlTracks: ProductionControlTracksDigestInput = [],
): Promise<string | null> => {
	const fields = await deriveProductionBuildKeyFields(
		link,
		environment,
		controlTracks,
	);
	return fields
		? productionDigestOfText(canonicalProductionJson(fields))
		: null;
};

/**
 * Derives the desired key for one asset. The observed digest from this
 * machine's working-copy binding wins over the digest recorded in the document,
 * which is exactly what makes a re-saved source produce a different desired key
 * — and therefore a visible `Stale` — before any rebuild happens.
 *
 * Returns `null` whenever the asset carries no parseable link or no fresh
 * environment is available. A missing desired key is `Disconnected`, never
 * `Ready`.
 *
 * `controlTracks` is the caller's projection of the Motion side-car for THIS
 * link (see `productionControlTrackDigestInput`). It is optional so existing
 * call sites keep compiling, but a caller that has the Motion document and omits
 * it will not see `Stale` after a control keyframe edit.
 */
export const desiredBuildKeyForAsset = async (
	asset: { readonly production?: unknown } | null | undefined,
	binding: ProductionLinkBindingSnapshot | null | undefined,
	environment: Omit<ProductionBuildEnvironment, "sourceDigest"> & {
		readonly sourceDigest?: string;
	},
	controlTracks: ProductionControlTracksDigestInput = [],
): Promise<ProductionArtifactIdentity | null> => {
	const link = resolveExternalProductionLink(asset);
	// Both handoff profiles derive a key. `outputProfile` is itself one of the
	// ten hashed fields, so a GLB<->rendered switch MOVES the key by
	// construction while keeping `linkId` — which is exactly the identity split
	// the one-3D-band contract needs: the link and its controls survive the
	// switch, the artifact does not. Gating this to `interactive-glb` would have
	// made a rendered link permanently Disconnected rather than Stale.
	if (!link) return null;
	const sourceDigest =
		environment.sourceDigest ??
		binding?.sourceDigest ??
		link.source.sourceDigest;
	if (!isProductionDigest(sourceDigest)) return null;
	const buildKey = await deriveProductionBuildKey(
		link,
		{
			...environment,
			sourceDigest,
		},
		controlTracks,
	);
	return buildKey ? { linkId: link.linkId, buildKey } : null;
};

/** Stable cache key for one artifact identity. */
export const productionArtifactCacheKey = (
	identity: ProductionArtifactIdentity,
): string => `${identity.linkId}\u0000${identity.buildKey}`;

/**
 * The only gate that may admit produced bytes to the artifact cache. A partial
 * file, an unhashable host, or any digest disagreement fails closed; there is
 * no partial admission, because a half-verified artifact is precisely what a
 * `Ready` badge must never stand for.
 */
export const verifyProductionArtifact = async ({
	bytes,
	expectedDigest,
	expectedByteLength,
}: {
	readonly bytes: Uint8Array;
	readonly expectedDigest: string;
	readonly expectedByteLength: number;
}): Promise<ProductionArtifactAdmissionVerdict> => {
	if (!isProductionDigest(expectedDigest)) {
		return { status: "incomplete", reason: "digest-malformed" };
	}
	if (bytes.byteLength === 0) {
		return { status: "incomplete", reason: "empty-payload" };
	}
	if (bytes.byteLength !== expectedByteLength) {
		return { status: "incomplete", reason: "byte-length-mismatch" };
	}
	const actualDigest = await productionDigestOfBytes(bytes);
	if (!actualDigest) {
		return { status: "incomplete", reason: "digest-unavailable" };
	}
	if (actualDigest !== expectedDigest) {
		return { status: "digest-mismatch", expectedDigest, actualDigest };
	}
	return { status: "verified", artifactDigest: actualDigest };
};

/**
 * Byte-level equality helper used where a caller has to prove two digests refer
 * to the same artifact without exposing either to string coercion surprises.
 */
export const sameProductionArtifactIdentity = (
	left: ProductionArtifactIdentity | null | undefined,
	right: ProductionArtifactIdentity | null | undefined,
): boolean =>
	Boolean(
		left &&
			right &&
			left.linkId === right.linkId &&
			left.buildKey === right.buildKey,
	);

/** Guard used by the companion before it trusts a browser-supplied build key. */
export const isProductionBuildKey = (value: unknown): value is string =>
	isProductionDigest(value);
