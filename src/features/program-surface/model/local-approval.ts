import {
	type ProgramSurfaceFallbackReadState,
	programSurfaceFallbackReadModelForAsset,
} from "@/entities/scene/model/assets";
import { parseProgramSurfaceAsset } from "@/entities/scene/model/program-surface";
import {
	hasProgramSurfaceControlCharacter,
	PROGRAM_SURFACE_COMPILED_ENTRY,
	type ProgramSurfaceBridgeEditorTarget,
	type ProgramSurfaceBuildIdentity,
	serializeProgramSurfaceBridgeManifest,
} from "@/entities/scene/model/program-surface-bridge-protocol";
import { useSceneStore } from "@/entities/scene/model/store";
import type {
	ProgramSurfaceAsset,
	ProgramSurfaceInputPort,
	ProgramSurfaceLocalDigestApproval,
	ProgramSurfaceManifestV1,
} from "@/entities/scene/model/types";
import {
	inspectProgramSurfaceBundleV1,
	PROGRAM_SURFACE_V1_MAX_BUNDLE_BYTES,
} from "./bundle-static-gate";

/**
 * Ephemeral data handed from the approval feature to the browser-only canvas
 * host. It intentionally contains a verified bundle and scalar values only;
 * no SceneDocument, store, command, workspace path, or callback crosses this
 * boundary.
 */
export type ApprovedProgramSurfaceProbe = {
	readonly assetId: string;
	readonly digest: string;
	readonly bundleText: string;
	readonly seed: number;
	readonly scalarPorts: Readonly<Record<string, number>>;
	readonly colorPorts: Readonly<Record<string, string>>;
	readonly output: {
		readonly alphaMode: "premultiplied";
		readonly maxPixelWidth: number;
		readonly maxPixelHeight: number;
	};
};

/**
 * A receipt is deliberately feature-local rather than a SceneDocument field.
 * `manifestProjection` prevents a digest-only approval from authorizing a
 * changed host contract that happens to reuse the same compiled digest.
 */
export type ProgramSurfaceBridgeApprovalInput = {
	/** The bridge's exact source-free session binding, never a workspace path. */
	readonly sessionId: string;
	readonly bindingId: string;
	readonly target: ProgramSurfaceBridgeEditorTarget;
	readonly assetId: string;
	readonly identity: ProgramSurfaceBuildIdentity;
	/** Already decoded by the workflow; these bytes are never durable state. */
	readonly bundleText: string;
	readonly bytes: Uint8Array;
};

export type ProgramSurfaceBridgeApprovalReceipt = {
	readonly sessionId: string;
	readonly bindingId: string;
	readonly target: ProgramSurfaceBridgeEditorTarget;
	readonly identity: ProgramSurfaceBuildIdentity;
};

/**
 * Opaque, source-free capability returned by bridge approval preflight. Its
 * object identity is meaningful only to the registry that created it; callers
 * can neither inspect nor reconstruct the staged bundle from these fields.
 */
export type ProgramSurfacePreparedBridgeApproval = Readonly<{
	readonly assetId: string;
	readonly compiledDigest: string;
}>;

export type ProgramSurfaceBridgeApprovalPreparation =
	| {
			readonly status: "prepared";
			readonly prepared: ProgramSurfacePreparedBridgeApproval;
	  }
	| Extract<ProgramSurfaceProbeResolution, { readonly status: "fallback" }>;

/**
 * Public, source-free local approval metadata. Bridge bytes deliberately live
 * only in a private registry record; callers may inspect this receipt but can
 * never recover executable source from it.
 */
export type ProgramSurfaceLocalApprovalReceipt =
	| {
			readonly source: "self-contained";
			readonly approval: ProgramSurfaceLocalDigestApproval;
			readonly manifestProjection: string;
	  }
	| {
			readonly source: "bridge";
			readonly approval: ProgramSurfaceLocalDigestApproval;
			readonly manifestProjection: string;
			readonly bridge: ProgramSurfaceBridgeApprovalReceipt;
	  };

export type ProgramSurfaceProbeResolution =
	| {
			readonly status: "approved";
			readonly probe: ApprovedProgramSurfaceProbe;
			readonly receipt: ProgramSurfaceLocalApprovalReceipt;
	  }
	| {
			readonly status: "fallback";
			readonly code:
				| "program-surface.asset-invalid"
				| "program-surface.approval-required"
				| "program-surface.approval-manifest-mismatch"
				| "program-surface.host-profile-unsupported"
				| "program-surface.bundle-data-url-invalid"
				| "program-surface.bundle-encoding-unsupported"
				| "program-surface.bundle-too-large"
				| "program-surface.sha256-unavailable"
				| "program-surface.digest-mismatch"
				| "program-surface.bridge-session-mismatch"
				| "program-surface.bridge-identity-mismatch"
				| "program-surface.bridge-reference-invalid"
				| "program-surface.bridge-bundle-invalid"
				| "program-surface.fallback-required";
			readonly message: string;
	  };

export type ProgramSurfaceLocalApprovalRegistry = {
	/** Returns only the narrow entity-facing digest approvals, never source. */
	readonly approvals: () => readonly ProgramSurfaceLocalDigestApproval[];
	/** Returns the local receipt used by host resolution, if one exists. */
	readonly receiptFor: (
		assetId: string,
	) => ProgramSurfaceLocalApprovalReceipt | undefined;
	/**
	 * Records an explicit session-local approval only after the current data URL,
	 * both durable digests, and V1 host profile have been checked. Async bundle
	 * verification is followed by a fresh durable source/manifest/fallback check,
	 * so an approval cannot race a Scene asset replacement.
	 */
	readonly approve: (
		asset: ProgramSurfaceAsset,
	) => Promise<ProgramSurfaceProbeResolution>;
	/**
	 * Records an explicitly approved bridge bundle only in this browser session.
	 * It accepts a reference-only asset and never writes source bytes to the
	 * SceneDocument or exposes them through `receiptFor` / `approvals`.
	 */
	readonly approveBridge: (
		asset: ProgramSurfaceAsset,
		input: ProgramSurfaceBridgeApprovalInput,
	) => Promise<ProgramSurfaceProbeResolution>;
	/**
	 * Verifies and stages bridge-only session state without changing the public
	 * receipt map. The workflow uses this before its one durable scene command.
	 */
	readonly prepareBridgeApproval: (
		asset: ProgramSurfaceAsset,
		input: ProgramSurfaceBridgeApprovalInput,
	) => Promise<ProgramSurfaceBridgeApprovalPreparation>;
	/**
	 * Synchronously publishes a prepared receipt after the matching scene command
	 * has been staged. The caller must finalize or roll it back with the paired
	 * Scene transaction; it never performs another asynchronous byte verification.
	 */
	readonly commitPreparedBridgeApproval: (
		prepared: ProgramSurfacePreparedBridgeApproval,
		asset: ProgramSurfaceAsset,
	) => ProgramSurfaceProbeResolution;
	/**
	 * Releases a replaced local receipt only after the paired Scene transaction
	 * has committed. It does not change the currently approved receipt.
	 */
	readonly finalizeCommittedBridgeApproval: (
		prepared: ProgramSurfacePreparedBridgeApproval,
	) => void;
	/**
	 * Restores the prior local receipt when the paired Scene transaction aborts
	 * before it commits. This is the compensation half of bridge approval.
	 */
	readonly rollbackCommittedBridgeApproval: (
		prepared: ProgramSurfacePreparedBridgeApproval,
	) => void;
	/** Releases a private staged bridge bundle when its durable update is aborted. */
	readonly discardPreparedBridgeApproval: (
		prepared: ProgramSurfacePreparedBridgeApproval,
	) => void;
	/** Removes execution authority without touching the durable document. */
	readonly revoke: (assetId: string) => void;
	/** Clears every local receipt without touching the durable document. */
	readonly clear: () => void;
	/**
	 * Fences approvals to the current editor instance / working copy / binding
	 * epoch. A rebind clears prior receipts before a new host can resolve them.
	 */
	readonly bindSession: (scope: ProgramSurfaceApprovalScope) => void;
	/** Lets a host react to a user approval without introducing an asset store. */
	readonly subscribe: (listener: () => void) => () => void;
	/** Re-validates a stored receipt before returning executable host input. */
	readonly resolve: (
		asset: ProgramSurfaceAsset,
	) => Promise<ProgramSurfaceProbeResolution>;
};

export type ProgramSurfaceApprovalScope = {
	readonly editorInstanceId: string;
	readonly workingCopyId: string;
	readonly bindingEpoch: number;
};

type DecodedBundle = {
	readonly bundleText: string;
	/** Exact UTF-8 data-url bytes used for the durable digest comparison. */
	readonly bytes: Uint8Array;
};

const javascriptMediaTypes = new Set([
	"application/javascript",
	"text/javascript",
]);

/** Both encoded payload and decoded UTF-8 bundle are bounded before execution. */
export const PROGRAM_SURFACE_MAX_BUNDLE_BYTES =
	PROGRAM_SURFACE_V1_MAX_BUNDLE_BYTES;
const PROGRAM_SURFACE_MAX_BASE64_PAYLOAD_CHARACTERS =
	4 * Math.ceil(PROGRAM_SURFACE_MAX_BUNDLE_BYTES / 3);
const PROGRAM_SURFACE_MAX_DATA_URL_METADATA_CHARACTERS = 1_024;
const PROGRAM_SURFACE_MAX_DATA_URL_CHARACTERS =
	PROGRAM_SURFACE_MAX_BUNDLE_BYTES * 3 +
	PROGRAM_SURFACE_MAX_DATA_URL_METADATA_CHARACTERS;

const digestHex = (digest: string): string | null => {
	const normalized = digest.trim().toLowerCase();
	const hex = normalized.startsWith("sha256:")
		? normalized.slice("sha256:".length)
		: normalized;
	return /^[a-f0-9]{64}$/u.test(hex) ? hex : null;
};

const digestMatches = (
	declaredDigest: string,
	actualDigestHex: string,
): boolean => digestHex(declaredDigest) === actualDigestHex;

const PROGRAM_SURFACE_BRIDGE_REFERENCE_PREFIX = "vma-program-surface-bridge/";

/**
 * Creates the only reference label V1 permits for a session-only bridge bundle.
 * It is an inert identifier, not a path, URL, or promise that a later editor
 * session can resolve the source again.
 */
export const programSurfaceBridgeReferenceHref = (
	compiledDigest: string,
): string | null => {
	const hex = digestHex(compiledDigest);
	return hex ? `${PROGRAM_SURFACE_BRIDGE_REFERENCE_PREFIX}${hex}` : null;
};

const unsupported = (
	code: Extract<
		ProgramSurfaceProbeResolution,
		{ readonly status: "fallback" }
	>["code"],
	message: string,
): Extract<ProgramSurfaceProbeResolution, { readonly status: "fallback" }> => ({
	status: "fallback",
	code,
	message,
});

const immutableApproval = (
	approval: ProgramSurfaceLocalDigestApproval,
): ProgramSurfaceLocalDigestApproval =>
	Object.freeze({
		assetId: approval.assetId,
		compiledDigest: approval.compiledDigest,
	});

function immutableReceipt(
	receipt: Extract<
		ProgramSurfaceLocalApprovalReceipt,
		{ readonly source: "self-contained" }
	>,
): Extract<
	ProgramSurfaceLocalApprovalReceipt,
	{ readonly source: "self-contained" }
>;
function immutableReceipt(
	receipt: Extract<
		ProgramSurfaceLocalApprovalReceipt,
		{ readonly source: "bridge" }
	>,
): Extract<ProgramSurfaceLocalApprovalReceipt, { readonly source: "bridge" }>;
function immutableReceipt(
	receipt: ProgramSurfaceLocalApprovalReceipt,
): ProgramSurfaceLocalApprovalReceipt {
	if (receipt.source === "self-contained") {
		return Object.freeze({
			source: "self-contained",
			approval: immutableApproval(receipt.approval),
			manifestProjection: receipt.manifestProjection,
		});
	}
	return Object.freeze({
		source: "bridge",
		approval: immutableApproval(receipt.approval),
		manifestProjection: receipt.manifestProjection,
		bridge: Object.freeze({
			sessionId: receipt.bridge.sessionId,
			bindingId: receipt.bridge.bindingId,
			target: Object.freeze({
				editorInstanceId: receipt.bridge.target.editorInstanceId,
				workingCopyId: receipt.bridge.target.workingCopyId,
				bindingEpoch: receipt.bridge.target.bindingEpoch,
			}),
			identity: Object.freeze({
				manifestDigest: receipt.bridge.identity.manifestDigest,
				inputDigest: receipt.bridge.identity.inputDigest,
				compiledDigest: receipt.bridge.identity.compiledDigest,
				generation: receipt.bridge.identity.generation,
			}),
		}),
	});
}

const stablePortProjection = (port: ProgramSurfaceInputPort) => {
	switch (port.kind) {
		case "scalar":
			return {
				id: port.id,
				kind: port.kind,
				label: port.label ?? null,
				defaultValue: port.defaultValue ?? null,
				min: port.min ?? null,
				max: port.max ?? null,
			};
		case "color":
			return {
				id: port.id,
				kind: port.kind,
				label: port.label ?? null,
				defaultValue: port.defaultValue ?? null,
			};
		default:
			return { id: port.id, kind: port.kind, label: port.label ?? null };
	}
};

/**
 * Serializes every field that changes the V1 program-facing authority. It is
 * not persisted and is intentionally separate from the compiled bundle hash:
 * a matching bundle must not inherit approval after its ports, timing, output,
 * camera policy, delivery declaration, or fallback route changes.
 */
export const programSurfaceHostManifestProjection = (
	manifest: ProgramSurfaceManifestV1,
): string =>
	JSON.stringify({
		runtime: {
			kind: manifest.runtime.kind,
			entry: manifest.runtime.entry,
			compiledDigest: manifest.runtime.compiledDigest,
		},
		source: {
			snapshotDigest: manifest.source.snapshotDigest,
			portability: manifest.source.portability,
		},
		inputs: manifest.inputs.map(stablePortProjection),
		output: {
			kind: manifest.output.kind,
			alphaMode: manifest.output.alphaMode,
			width: manifest.output.width,
			height: manifest.output.height,
		},
		timing: {
			seed: manifest.timing.seed,
			deterministicAtFrame: manifest.timing.deterministicAtFrame,
		},
		space: { cameraSpacePolicy: manifest.space.cameraSpacePolicy },
		delivery: {
			editor: manifest.delivery.editor,
			webglPlayer: manifest.delivery.webglPlayer,
			svgPdf: manifest.delivery.svgPdf,
			video: manifest.delivery.video,
		},
		fallback: manifest.fallback
			? {
					assetId: manifest.fallback.assetId,
					frame: manifest.fallback.frame ?? null,
				}
			: null,
	});

type Base64DecodeResult =
	| {
			readonly status: "decoded";
			readonly bundleText: string;
			readonly bytes: Uint8Array;
	  }
	| { readonly status: "invalid" }
	| { readonly status: "too-large" };

/**
 * Returns a safe upper bound of the UTF-8 bytes produced by a percent-decoded
 * data-url payload before `decodeURIComponent` allocates its result. `%HH`
 * sequences become one byte; raw Unicode is conservatively counted as its
 * direct UTF-8 representation.
 */
const percentPayloadUtf8UpperBound = (payload: string): number => {
	let bytes = 0;
	for (let index = 0; index < payload.length; index += 1) {
		if (
			payload[index] === "%" &&
			/^[a-f0-9]{2}$/iu.test(payload.slice(index + 1, index + 3))
		) {
			bytes += 1;
			index += 2;
		} else {
			const codePoint = payload.codePointAt(index) ?? 0;
			bytes +=
				codePoint <= 0x7f
					? 1
					: codePoint <= 0x7ff
						? 2
						: codePoint <= 0xffff
							? 3
							: 4;
			if (codePoint > 0xffff) index += 1;
		}
		if (bytes > PROGRAM_SURFACE_MAX_BUNDLE_BYTES) return bytes;
	}
	return bytes;
};

const decodeBase64Utf8 = (payload: string): Base64DecodeResult => {
	if (typeof atob !== "function" || typeof TextDecoder === "undefined") {
		return { status: "invalid" };
	}
	// Validate the maximum decoded byte count before `atob`/`TextDecoder` can
	// allocate. This intentionally accepts a small false-negative surface for
	// malformed base64; `atob` remains the exact syntax validator below.
	const unpaddedLength = payload.replace(/=+$/u, "").length;
	if (Math.floor((unpaddedLength * 3) / 4) > PROGRAM_SURFACE_MAX_BUNDLE_BYTES) {
		return { status: "too-large" };
	}
	try {
		const binary = atob(payload);
		const bytes = Uint8Array.from(
			binary,
			(character) => character.codePointAt(0) ?? 0,
		);
		if (bytes.byteLength > PROGRAM_SURFACE_MAX_BUNDLE_BYTES) {
			return { status: "too-large" };
		}
		return {
			status: "decoded",
			// Keep a UTF-8 BOM in the source string if present so Blob execution is
			// byte-equivalent to the digest-checked data URL.
			bundleText: new TextDecoder("utf-8", {
				fatal: true,
				ignoreBOM: true,
			}).decode(bytes),
			bytes,
		};
	} catch {
		return { status: "invalid" };
	}
};

const decodeSelfContainedBundle = (
	dataUrl: string,
):
	| DecodedBundle
	| Extract<ProgramSurfaceProbeResolution, { readonly status: "fallback" }> => {
	if (dataUrl.length > PROGRAM_SURFACE_MAX_DATA_URL_CHARACTERS) {
		return unsupported(
			"program-surface.bundle-too-large",
			"The Program Surface data URL exceeds the V1 bundle limit.",
		);
	}
	const match = /^data:([^,]*),(.*)$/isu.exec(dataUrl);
	if (!match) {
		return unsupported(
			"program-surface.bundle-data-url-invalid",
			"The approved Program Surface source is not a valid data URL.",
		);
	}
	const metadata = match[1] ?? "";
	const payload = match[2] ?? "";
	if (metadata.length > PROGRAM_SURFACE_MAX_DATA_URL_METADATA_CHARACTERS) {
		return unsupported(
			"program-surface.bundle-data-url-invalid",
			"The Program Surface data URL metadata exceeds the V1 bundle limit.",
		);
	}
	const [rawMediaType = "", ...parameters] = metadata
		.split(";")
		.map((part) => part.trim());
	const mediaType = rawMediaType.toLowerCase();
	if (!javascriptMediaTypes.has(mediaType)) {
		return unsupported(
			"program-surface.bundle-data-url-invalid",
			"The approved Program Surface bundle must be a JavaScript data URL.",
		);
	}
	const normalizedParameters = parameters.map((parameter) =>
		parameter.toLowerCase(),
	);
	const acceptedParameters = new Set(["base64", "charset=utf-8"]);
	if (
		normalizedParameters.some(
			(parameter) => !acceptedParameters.has(parameter),
		) ||
		new Set(normalizedParameters).size !== normalizedParameters.length
	) {
		return unsupported(
			"program-surface.bundle-encoding-unsupported",
			"The Program Surface data URL may declare only UTF-8 and base64 encoding.",
		);
	}
	const base64 = normalizedParameters.includes("base64");
	const payloadLimit = base64
		? PROGRAM_SURFACE_MAX_BASE64_PAYLOAD_CHARACTERS
		: PROGRAM_SURFACE_MAX_BUNDLE_BYTES * 3;
	if (payload.length > payloadLimit) {
		return unsupported(
			"program-surface.bundle-too-large",
			"The Program Surface data URL payload exceeds the V1 bundle limit.",
		);
	}
	if (
		!base64 &&
		percentPayloadUtf8UpperBound(payload) > PROGRAM_SURFACE_MAX_BUNDLE_BYTES
	) {
		return unsupported(
			"program-surface.bundle-too-large",
			"The decoded Program Surface bundle exceeds the V1 UTF-8 byte limit.",
		);
	}
	const charset = normalizedParameters.find((parameter) =>
		parameter.startsWith("charset="),
	);
	if (charset && charset !== "charset=utf-8") {
		return unsupported(
			"program-surface.bundle-encoding-unsupported",
			"The Program Surface data URL must use UTF-8 bundle text.",
		);
	}
	const base64Result = base64 ? decodeBase64Utf8(payload) : null;
	if (base64Result?.status === "too-large") {
		return unsupported(
			"program-surface.bundle-too-large",
			"The decoded Program Surface bundle exceeds the V1 bundle limit.",
		);
	}
	const decodedBase64 =
		base64Result?.status === "decoded" ? base64Result : null;
	const bundleText = base64
		? decodedBase64
			? decodedBase64.bundleText
			: null
		: (() => {
				try {
					return decodeURIComponent(payload);
				} catch {
					return null;
				}
			})();
	if (bundleText === null) {
		return unsupported(
			"program-surface.bundle-data-url-invalid",
			"The Program Surface data URL could not be decoded as UTF-8 bundle text.",
		);
	}
	if (bundleText.length > PROGRAM_SURFACE_MAX_BUNDLE_BYTES) {
		return unsupported(
			"program-surface.bundle-too-large",
			"The decoded Program Surface bundle exceeds the V1 bundle limit.",
		);
	}
	if (typeof TextEncoder === "undefined") {
		return unsupported(
			"program-surface.bundle-encoding-unsupported",
			"This browser cannot verify UTF-8 Program Surface bundle bytes.",
		);
	}
	const bytes = decodedBase64?.bytes ?? new TextEncoder().encode(bundleText);
	if (bytes.byteLength > PROGRAM_SURFACE_MAX_BUNDLE_BYTES) {
		return unsupported(
			"program-surface.bundle-too-large",
			"The decoded Program Surface bundle exceeds the V1 UTF-8 byte limit.",
		);
	}
	return { bundleText, bytes };
};

const sha256Bytes = async (bytes: Uint8Array): Promise<string | null> => {
	if (typeof globalThis.crypto?.subtle?.digest !== "function") {
		return null;
	}
	try {
		const exactBytes = new Uint8Array(bytes.byteLength);
		exactBytes.set(bytes);
		const digest = await globalThis.crypto.subtle.digest(
			"SHA-256",
			exactBytes.buffer,
		);
		return Array.from(new Uint8Array(digest), (byte) =>
			byte.toString(16).padStart(2, "0"),
		).join("");
	} catch {
		return null;
	}
};

const defaultScalarValue = (
	port: Extract<ProgramSurfaceInputPort, { readonly kind: "scalar" }>,
): number => {
	if (port.defaultValue !== undefined) return port.defaultValue;
	const minimum = port.min ?? Number.NEGATIVE_INFINITY;
	const maximum = port.max ?? Number.POSITIVE_INFINITY;
	return Math.min(maximum, Math.max(minimum, 0));
};

const normalizeColor = (value: string): string | null => {
	const hex = value.trim().toLowerCase();
	const shorthand = /^#([a-f0-9]{3}|[a-f0-9]{4})$/u.exec(hex)?.[1];
	if (shorthand) {
		const expanded = [...shorthand]
			.map((component) => `${component}${component}`)
			.join("");
		return `#${expanded.length === 6 ? `${expanded}ff` : expanded}`;
	}
	const full = /^#([a-f0-9]{6}|[a-f0-9]{8})$/u.exec(hex)?.[1];
	if (!full) return null;
	return `#${full.length === 6 ? `${full}ff` : full}`;
};

const initialPorts = (
	inputs: readonly ProgramSurfaceInputPort[],
):
	| {
			readonly scalarPorts: Readonly<Record<string, number>>;
			readonly colorPorts: Readonly<Record<string, string>>;
	  }
	| Extract<ProgramSurfaceProbeResolution, { readonly status: "fallback" }> => {
	const scalarPorts: Record<string, number> = {};
	const colorPorts: Record<string, string> = {};
	for (const port of inputs) {
		if (port.kind === "scalar") {
			const value = defaultScalarValue(port);
			if (!Number.isFinite(value)) {
				return unsupported(
					"program-surface.host-profile-unsupported",
					`Program Surface scalar port "${port.id}" has no finite initial value.`,
				);
			}
			scalarPorts[port.id] = value;
			continue;
		}
		if (port.kind === "color") {
			const value = normalizeColor(port.defaultValue ?? "#00000000");
			if (!value) {
				return unsupported(
					"program-surface.host-profile-unsupported",
					`Program Surface color port "${port.id}" must use a hexadecimal default color.`,
				);
			}
			colorPorts[port.id] = value;
			continue;
		}
		if (port.kind === "time" || port.kind === "frame" || port.kind === "seed") {
			// These facts are supplied by the host's top-level render input, not
			// copied into a mutable named-port map.
			continue;
		}
		return unsupported(
			"program-surface.host-profile-unsupported",
			`Program Surface port "${port.id}" is outside the V1 scalar/color/time/frame/seed host profile.`,
		);
	}
	return { scalarPorts, colorPorts };
};

type StoredProgramSurfaceApproval =
	| {
			readonly kind: "self-contained";
			readonly receipt: Extract<
				ProgramSurfaceLocalApprovalReceipt,
				{ readonly source: "self-contained" }
			>;
	  }
	| {
			readonly kind: "bridge";
			readonly receipt: Extract<
				ProgramSurfaceLocalApprovalReceipt,
				{ readonly source: "bridge" }
			>;
			/** Private session-only source; never returned by any public registry API. */
			bundleText: string;
	  };

type PreparedProgramSurfaceBridgeApproval = {
	readonly prepared: ProgramSurfacePreparedBridgeApproval;
	readonly assetId: string;
	readonly startingApprovalEpoch: number;
	readonly stored: Extract<
		StoredProgramSurfaceApproval,
		{ readonly kind: "bridge" }
	>;
	readonly resolution: Extract<
		ProgramSurfaceProbeResolution,
		{ readonly status: "approved" }
	>;
};

/**
 * A synchronous, compensatable receipt publication. Its old bridge bundle is
 * intentionally retained only until the paired Scene transaction commits or
 * aborts, so a failed durable commit can restore the exact prior authority.
 */
type CommittedProgramSurfaceBridgeApproval = {
	readonly prepared: ProgramSurfacePreparedBridgeApproval;
	readonly assetId: string;
	readonly stored: Extract<
		StoredProgramSurfaceApproval,
		{ readonly kind: "bridge" }
	>;
	readonly previous: StoredProgramSurfaceApproval | undefined;
};

type ProbeBundle = {
	readonly bundleText: string;
	readonly bytes: Uint8Array;
};

const sameApprovalScope = (
	left: ProgramSurfaceApprovalScope,
	right: ProgramSurfaceBridgeEditorTarget,
): boolean =>
	left.editorInstanceId === right.editorInstanceId &&
	left.workingCopyId === right.workingCopyId &&
	left.bindingEpoch === right.bindingEpoch;

const sameBytes = (left: Uint8Array, right: Uint8Array): boolean => {
	if (left.byteLength !== right.byteLength) return false;
	for (let index = 0; index < left.byteLength; index += 1) {
		if (left[index] !== right[index]) return false;
	}
	return true;
};

const sameProgramSurfaceSource = (
	left: ProgramSurfaceAsset["source"],
	right: ProgramSurfaceAsset["source"],
): boolean => {
	if (left.kind !== right.kind) return false;
	if (left.kind === "data-url" && right.kind === "data-url") {
		return left.dataUrl === right.dataUrl;
	}
	return (
		left.kind === "reference" &&
		right.kind === "reference" &&
		left.href === right.href
	);
};

/**
 * Compares the durable facts that can grant V1 execution authority. Presentation
 * metadata such as an asset name deliberately does not invalidate an already
 * verified bundle, while a source, host contract, or fallback-route change does.
 */
const sameProgramSurfaceAuthority = (
	left: ProgramSurfaceAsset,
	right: ProgramSurfaceAsset,
): boolean =>
	sameProgramSurfaceSource(left.source, right.source) &&
	programSurfaceHostManifestProjection(left.manifest) ===
		programSurfaceHostManifestProjection(right.manifest);

/**
 * Re-reads the durable asset after an async local verification. This keeps the
 * session-only receipt aligned with the currently renderable Scene contract
 * without granting the feature a document-write path.
 */
const currentProgramSurfaceAuthority = (
	asset: ProgramSurfaceAsset,
): ProgramSurfaceAsset | null => {
	const current = useSceneStore
		.getState()
		.document.assets?.find((entry) => entry.id === asset.id);
	return current?.kind === "program-surface" &&
		sameProgramSurfaceAuthority(current, asset)
		? current
		: null;
};

const fallbackStateForCurrentScene = (
	asset: ProgramSurfaceAsset,
): ProgramSurfaceFallbackReadState =>
	programSurfaceFallbackReadModelForAsset(
		useSceneStore.getState().document,
		asset,
	).state;

const fallbackActivationIssue = (
	asset: ProgramSurfaceAsset,
): Extract<
	ProgramSurfaceProbeResolution,
	{ readonly status: "fallback" }
> | null => {
	let state: ProgramSurfaceFallbackReadState;
	try {
		state = fallbackStateForCurrentScene(asset);
	} catch {
		return unsupported(
			"program-surface.fallback-required",
			"Program Surface V1 local activation requires a readable distinct image fallback.",
		);
	}
	if (state === "ready") return null;
	const reason =
		state === "not-declared"
			? "has no named raster fallback"
			: state === "missing"
				? "names a fallback asset that is unavailable"
				: state === "invalid"
					? "names a fallback that is not a usable image"
					: "does not have a readable raster fallback";
	return unsupported(
		"program-surface.fallback-required",
		`Program Surface V1 local activation is blocked because it ${reason}.`,
	);
};

const validBridgeOpaqueId = (value: string): boolean =>
	value.length > 0 &&
	value.length <= 256 &&
	value.trim() === value &&
	!hasProgramSurfaceControlCharacter(value);

const validBridgeDigest = (value: string): boolean =>
	/^sha256:[a-f0-9]{64}$/iu.test(value);

const v1HostProfileIssue = (
	asset: ProgramSurfaceAsset,
	source: "self-contained" | "bridge",
): Extract<
	ProgramSurfaceProbeResolution,
	{ readonly status: "fallback" }
> | null => {
	const { manifest } = asset;
	if (source === "self-contained") {
		if (
			asset.source.kind !== "data-url" ||
			manifest.source.portability !== "self-contained"
		) {
			return unsupported(
				"program-surface.host-profile-unsupported",
				"V1 host execution requires a self-contained data URL bundle.",
			);
		}
	} else {
		if (manifest.runtime.entry !== PROGRAM_SURFACE_COMPILED_ENTRY) {
			return unsupported(
				"program-surface.bridge-reference-invalid",
				"The Program Surface bridge receipt does not use the V1 compiled entry contract.",
			);
		}
		const expectedHref = programSurfaceBridgeReferenceHref(
			manifest.runtime.compiledDigest,
		);
		if (
			asset.source.kind !== "reference" ||
			manifest.source.portability !== "reference-only" ||
			!expectedHref ||
			asset.source.href !== expectedHref
		) {
			return unsupported(
				"program-surface.bridge-reference-invalid",
				"The Program Surface bridge receipt no longer matches its inert reference label.",
			);
		}
	}
	if (manifest.runtime.kind !== "webgl2") {
		return unsupported(
			"program-surface.host-profile-unsupported",
			"V1 host execution requires a WebGL2 runtime.",
		);
	}
	if (manifest.delivery.editor !== "live") {
		return unsupported(
			"program-surface.host-profile-unsupported",
			"The Program Surface does not declare live editor delivery.",
		);
	}
	if (
		manifest.output.kind !== "rgba-texture" ||
		manifest.output.alphaMode !== "premultiplied"
	) {
		return unsupported(
			"program-surface.host-profile-unsupported",
			"V1 host execution requires a premultiplied RGBA texture output.",
		);
	}
	if (manifest.space.cameraSpacePolicy !== "screen_2d") {
		return unsupported(
			"program-surface.host-profile-unsupported",
			"V1 host execution supports only explicit screen_2d placement.",
		);
	}
	return null;
};

const receiptIssue = (
	asset: ProgramSurfaceAsset,
	receipt: ProgramSurfaceLocalApprovalReceipt | undefined,
): Extract<
	ProgramSurfaceProbeResolution,
	{ readonly status: "fallback" }
> | null => {
	if (!receipt) {
		return unsupported(
			"program-surface.approval-required",
			"This Program Surface digest has not been approved in the local session.",
		);
	}
	if (
		receipt.approval.assetId !== asset.id ||
		receipt.approval.compiledDigest !== asset.manifest.runtime.compiledDigest
	) {
		return unsupported(
			"program-surface.approval-required",
			"The local Program Surface approval does not match the current asset digest.",
		);
	}
	if (
		receipt.manifestProjection !==
		programSurfaceHostManifestProjection(asset.manifest)
	) {
		return unsupported(
			"program-surface.approval-manifest-mismatch",
			"The Program Surface host manifest changed after local approval and needs reapproval.",
		);
	}
	return null;
};

const probeFromBundle = (
	asset: ProgramSurfaceAsset,
	receipt: ProgramSurfaceLocalApprovalReceipt,
	bundle: ProbeBundle,
): ProgramSurfaceProbeResolution => {
	const ports = initialPorts(asset.manifest.inputs);
	if ("status" in ports) return ports;
	return {
		status: "approved",
		receipt,
		probe: {
			assetId: asset.id,
			digest: asset.manifest.runtime.compiledDigest,
			bundleText: bundle.bundleText,
			seed: asset.manifest.timing.seed >>> 0,
			scalarPorts: ports.scalarPorts,
			colorPorts: ports.colorPorts,
			output: {
				alphaMode: "premultiplied",
				maxPixelWidth: asset.manifest.output.width,
				maxPixelHeight: asset.manifest.output.height,
			},
		},
	};
};

const verifyStaticBundle = async (
	bundleText: string,
	bytes: Uint8Array,
	expectedDigest: string,
	source: "self-contained" | "bridge",
): Promise<
	| ProbeBundle
	| Extract<ProgramSurfaceProbeResolution, { readonly status: "fallback" }>
> => {
	if (
		bundleText.length === 0 ||
		bundleText.length > PROGRAM_SURFACE_MAX_BUNDLE_BYTES ||
		bytes.byteLength === 0 ||
		bytes.byteLength > PROGRAM_SURFACE_MAX_BUNDLE_BYTES ||
		typeof TextEncoder === "undefined"
	) {
		return unsupported(
			source === "bridge"
				? "program-surface.bridge-bundle-invalid"
				: "program-surface.bundle-encoding-unsupported",
			"The Program Surface bundle cannot be verified inside the V1 byte boundary.",
		);
	}
	const encoded = new TextEncoder().encode(bundleText);
	if (!sameBytes(encoded, bytes)) {
		return unsupported(
			source === "bridge"
				? "program-surface.bridge-bundle-invalid"
				: "program-surface.bundle-data-url-invalid",
			"The Program Surface bundle text does not match its exact UTF-8 bytes.",
		);
	}
	if (inspectProgramSurfaceBundleV1(bundleText).status === "rejected") {
		return unsupported(
			"program-surface.host-profile-unsupported",
			"The Program Surface bundle is outside the V1 parent-clocked execution profile.",
		);
	}
	const actualDigest = await sha256Bytes(bytes);
	if (!actualDigest) {
		return unsupported(
			"program-surface.sha256-unavailable",
			"This browser cannot verify the Program Surface bundle digest.",
		);
	}
	if (!digestMatches(expectedDigest, actualDigest)) {
		return unsupported(
			source === "bridge"
				? "program-surface.bridge-identity-mismatch"
				: "program-surface.digest-mismatch",
			"The Program Surface bundle does not match its declared compiled digest.",
		);
	}
	return { bundleText, bytes: encoded };
};

const bridgeManifestDigest = async (
	manifest: ProgramSurfaceManifestV1,
): Promise<string | null> => {
	if (typeof TextEncoder === "undefined") return null;
	try {
		return sha256Bytes(
			new TextEncoder().encode(serializeProgramSurfaceBridgeManifest(manifest)),
		);
	} catch {
		return null;
	}
};

const resolutionForSelfContainedReceipt = async (
	asset: ProgramSurfaceAsset,
	receipt:
		| Extract<
				ProgramSurfaceLocalApprovalReceipt,
				{ readonly source: "self-contained" }
		  >
		| undefined,
): Promise<ProgramSurfaceProbeResolution> => {
	const parsed = parseProgramSurfaceAsset(asset);
	if (parsed.status === "invalid") {
		return unsupported(
			"program-surface.asset-invalid",
			"The Program Surface asset no longer satisfies its durable manifest contract.",
		);
	}
	const fallbackIssue = fallbackActivationIssue(parsed.asset);
	if (fallbackIssue) return fallbackIssue;
	const profileIssue = v1HostProfileIssue(parsed.asset, "self-contained");
	if (profileIssue) return profileIssue;
	const approvalIssue = receiptIssue(parsed.asset, receipt);
	if (approvalIssue) return approvalIssue;
	if (parsed.asset.source.kind !== "data-url" || !receipt) {
		return unsupported(
			"program-surface.approval-required",
			"This Program Surface needs a matching self-contained approval receipt.",
		);
	}
	const decoded = decodeSelfContainedBundle(parsed.asset.source.dataUrl);
	if ("status" in decoded) return decoded;
	const verified = await verifyStaticBundle(
		decoded.bundleText,
		decoded.bytes,
		parsed.asset.manifest.runtime.compiledDigest,
		"self-contained",
	);
	if ("status" in verified) return verified;
	const sourceDigest = await sha256Bytes(verified.bytes);
	if (
		!sourceDigest ||
		!digestMatches(parsed.asset.manifest.source.snapshotDigest, sourceDigest)
	) {
		return unsupported(
			"program-surface.digest-mismatch",
			"The self-contained Program Surface bundle does not match its declared source digest.",
		);
	}
	return probeFromBundle(parsed.asset, receipt, verified);
};

const resolutionForBridgeReceipt = async (
	asset: ProgramSurfaceAsset,
	stored: Extract<StoredProgramSurfaceApproval, { readonly kind: "bridge" }>,
	isCurrentBridgeSession: () => boolean,
): Promise<ProgramSurfaceProbeResolution> => {
	const parsed = parseProgramSurfaceAsset(asset);
	if (parsed.status === "invalid") {
		return unsupported(
			"program-surface.asset-invalid",
			"The Program Surface asset no longer satisfies its durable manifest contract.",
		);
	}
	const fallbackIssue = fallbackActivationIssue(parsed.asset);
	if (fallbackIssue) return fallbackIssue;
	const profileIssue = v1HostProfileIssue(parsed.asset, "bridge");
	if (profileIssue) return profileIssue;
	const approvalIssue = receiptIssue(parsed.asset, stored.receipt);
	if (approvalIssue) return approvalIssue;
	if (!isCurrentBridgeSession()) {
		return unsupported(
			"program-surface.bridge-session-mismatch",
			"The Program Surface bridge receipt belongs to a different editor session.",
		);
	}
	if (
		stored.receipt.bridge.identity.compiledDigest !==
			parsed.asset.manifest.runtime.compiledDigest ||
		stored.receipt.bridge.identity.inputDigest !==
			parsed.asset.manifest.source.snapshotDigest
	) {
		return unsupported(
			"program-surface.bridge-identity-mismatch",
			"The Program Surface bridge receipt does not match the current compiled digest.",
		);
	}
	const manifestDigest = await bridgeManifestDigest(parsed.asset.manifest);
	if (
		!manifestDigest ||
		!digestMatches(
			stored.receipt.bridge.identity.manifestDigest,
			manifestDigest,
		)
	) {
		return unsupported(
			"program-surface.bridge-identity-mismatch",
			"The Program Surface bridge manifest identity no longer matches this asset.",
		);
	}
	if (typeof TextEncoder === "undefined") {
		return unsupported(
			"program-surface.bridge-bundle-invalid",
			"This browser cannot reconstruct verified Program Surface bridge bytes.",
		);
	}
	const verified = await verifyStaticBundle(
		stored.bundleText,
		new TextEncoder().encode(stored.bundleText),
		parsed.asset.manifest.runtime.compiledDigest,
		"bridge",
	);
	if ("status" in verified) return verified;
	if (!isCurrentBridgeSession()) {
		return unsupported(
			"program-surface.bridge-session-mismatch",
			"The Program Surface bridge receipt belongs to a different editor session.",
		);
	}
	return probeFromBundle(parsed.asset, stored.receipt, verified);
};

/**
 * Resolves one executable self-contained probe only when an already-recorded
 * public receipt still matches. Bridge receipts require the registry's private
 * session bundle and therefore cannot resolve through this source-free helper.
 */
export const resolveApprovedProgramSurfaceProbe = (
	asset: ProgramSurfaceAsset,
	receipt: ProgramSurfaceLocalApprovalReceipt | undefined,
): Promise<ProgramSurfaceProbeResolution> =>
	resolutionForSelfContainedReceipt(
		asset,
		receipt?.source === "self-contained" ? receipt : undefined,
	);

/**
 * Creates a session-local digest registry. It retains only source-free public
 * receipts plus, for one explicitly approved bridge receipt, a private bundle
 * string that is cleared on finalize, staged-discard, revoke, clear, or session
 * rebind. It never retains assets, editor state, workspace locations, or
 * pairing credentials.
 */
export const createProgramSurfaceLocalApprovalRegistry =
	(): ProgramSurfaceLocalApprovalRegistry => {
		const receipts = new Map<string, StoredProgramSurfaceApproval>();
		const preparedBridgeApprovals = new Map<
			ProgramSurfacePreparedBridgeApproval,
			PreparedProgramSurfaceBridgeApproval
		>();
		const committedBridgeApprovals = new Map<
			ProgramSurfacePreparedBridgeApproval,
			CommittedProgramSurfaceBridgeApproval
		>();
		const listeners = new Set<() => void>();
		let sessionKey: string | null = null;
		let sessionScope: ProgramSurfaceApprovalScope | null = null;
		let approvalEpoch = 0;
		const notify = (): void => {
			for (const listener of listeners) {
				try {
					listener();
				} catch {
					// Observers are advisory only; an Inspector refresh must not split a
					// successfully committed local approval from its Scene transaction.
				}
			}
		};
		const eraseStoredApproval = (
			stored: StoredProgramSurfaceApproval,
		): void => {
			if (stored.kind === "bridge") {
				// A string cannot be cryptographically wiped from a JS heap, but clearing
				// the sole registry-held reference makes future resolve attempts fail and
				// releases the session-only bytes for collection immediately.
				stored.bundleText = "";
			}
		};
		const discardPreparedBridgeApproval = (
			prepared: ProgramSurfacePreparedBridgeApproval,
		): boolean => {
			const staged = preparedBridgeApprovals.get(prepared);
			if (!staged) return false;
			preparedBridgeApprovals.delete(prepared);
			eraseStoredApproval(staged.stored);
			return true;
		};
		const clearPreparedBridgeApprovals = (): boolean => {
			let changed = false;
			for (const prepared of [...preparedBridgeApprovals.keys()]) {
				changed = discardPreparedBridgeApproval(prepared) || changed;
			}
			return changed;
		};
		const clearPreparedBridgeApprovalsForAsset = (assetId: string): boolean => {
			let changed = false;
			for (const [prepared, staged] of preparedBridgeApprovals) {
				if (staged.assetId !== assetId) continue;
				changed = discardPreparedBridgeApproval(prepared) || changed;
			}
			return changed;
		};
		const releaseCommittedBridgeApproval = (
			prepared: ProgramSurfacePreparedBridgeApproval,
		): boolean => {
			const committed = committedBridgeApprovals.get(prepared);
			if (!committed) return false;
			committedBridgeApprovals.delete(prepared);
			const current = receipts.get(committed.assetId);
			if (current !== committed.stored) eraseStoredApproval(committed.stored);
			if (committed.previous && current !== committed.previous) {
				eraseStoredApproval(committed.previous);
			}
			return true;
		};
		const releaseCommittedBridgeApprovalsForAsset = (
			assetId: string,
		): boolean => {
			let changed = false;
			for (const [prepared, committed] of committedBridgeApprovals) {
				if (committed.assetId !== assetId) continue;
				changed = releaseCommittedBridgeApproval(prepared) || changed;
			}
			return changed;
		};
		const releaseCommittedBridgeApprovals = (): boolean => {
			let changed = false;
			for (const prepared of [...committedBridgeApprovals.keys()]) {
				changed = releaseCommittedBridgeApproval(prepared) || changed;
			}
			return changed;
		};
		const clearReceipts = (): boolean => {
			if (receipts.size === 0) return false;
			for (const stored of receipts.values()) eraseStoredApproval(stored);
			receipts.clear();
			return true;
		};
		const bridgeInputIssue = (
			asset: ProgramSurfaceAsset,
			input: ProgramSurfaceBridgeApprovalInput,
		): Extract<
			ProgramSurfaceProbeResolution,
			{ readonly status: "fallback" }
		> | null => {
			if (
				!validBridgeOpaqueId(input.sessionId) ||
				!validBridgeOpaqueId(input.bindingId) ||
				!validBridgeOpaqueId(input.assetId) ||
				!input.target ||
				!input.identity ||
				!validBridgeOpaqueId(input.target.editorInstanceId) ||
				!validBridgeOpaqueId(input.target.workingCopyId) ||
				!Number.isSafeInteger(input.target.bindingEpoch) ||
				input.target.bindingEpoch < 0 ||
				!validBridgeDigest(input.identity.manifestDigest) ||
				!validBridgeDigest(input.identity.inputDigest) ||
				!validBridgeDigest(input.identity.compiledDigest) ||
				!Number.isSafeInteger(input.identity.generation) ||
				input.identity.generation <= 0
			) {
				return unsupported(
					"program-surface.bridge-identity-mismatch",
					"The Program Surface bridge approval has an invalid identity envelope.",
				);
			}
			if (!sessionScope || !sameApprovalScope(sessionScope, input.target)) {
				return unsupported(
					"program-surface.bridge-session-mismatch",
					"The Program Surface bridge approval is not bound to the current editor session.",
				);
			}
			if (
				input.assetId !== asset.id ||
				input.identity.compiledDigest !==
					asset.manifest.runtime.compiledDigest ||
				input.identity.inputDigest !== asset.manifest.source.snapshotDigest
			) {
				return unsupported(
					"program-surface.bridge-identity-mismatch",
					"The Program Surface bridge approval does not match the selected asset digest.",
				);
			}
			return null;
		};
		const prepareBridgeApproval = async (
			asset: ProgramSurfaceAsset,
			input: ProgramSurfaceBridgeApprovalInput,
		): Promise<ProgramSurfaceBridgeApprovalPreparation> => {
			const parsed = parseProgramSurfaceAsset(asset);
			if (parsed.status === "invalid") {
				return unsupported(
					"program-surface.asset-invalid",
					"The Program Surface asset no longer satisfies its durable manifest contract.",
				);
			}
			const inputIssue = bridgeInputIssue(parsed.asset, input);
			if (inputIssue) return inputIssue;
			const fallbackIssue = fallbackActivationIssue(parsed.asset);
			if (fallbackIssue) return fallbackIssue;
			const startingApprovalEpoch = approvalEpoch;
			const profileIssue = v1HostProfileIssue(parsed.asset, "bridge");
			if (profileIssue) return profileIssue;
			if (
				typeof input.bundleText !== "string" ||
				!(input.bytes instanceof Uint8Array)
			) {
				return unsupported(
					"program-surface.bridge-bundle-invalid",
					"The Program Surface bridge bundle is not valid UTF-8 byte input.",
				);
			}
			const manifestDigest = await bridgeManifestDigest(parsed.asset.manifest);
			if (
				!manifestDigest ||
				!digestMatches(input.identity.manifestDigest, manifestDigest)
			) {
				return unsupported(
					"program-surface.bridge-identity-mismatch",
					"The Program Surface bridge candidate manifest identity does not match this asset.",
				);
			}
			const verified = await verifyStaticBundle(
				input.bundleText,
				input.bytes,
				parsed.asset.manifest.runtime.compiledDigest,
				"bridge",
			);
			if ("status" in verified) return verified;
			const receipt = immutableReceipt({
				source: "bridge",
				approval: {
					assetId: parsed.asset.id,
					compiledDigest: parsed.asset.manifest.runtime.compiledDigest,
				},
				manifestProjection: programSurfaceHostManifestProjection(
					parsed.asset.manifest,
				),
				bridge: {
					sessionId: input.sessionId,
					bindingId: input.bindingId,
					target: input.target,
					identity: input.identity,
				},
			});
			if (receipt.source !== "bridge") {
				return unsupported(
					"program-surface.bridge-identity-mismatch",
					"The Program Surface bridge receipt could not be created.",
				);
			}
			const stored: Extract<
				StoredProgramSurfaceApproval,
				{ readonly kind: "bridge" }
			> = {
				kind: "bridge",
				receipt,
				bundleText: verified.bundleText,
			};
			const resolution = await resolutionForBridgeReceipt(
				parsed.asset,
				stored,
				() =>
					approvalEpoch === startingApprovalEpoch &&
					Boolean(
						sessionScope &&
							sameApprovalScope(sessionScope, stored.receipt.bridge.target),
					),
			);
			if (resolution.status !== "approved") {
				eraseStoredApproval(stored);
				return resolution;
			}
			const prepared = Object.freeze({
				assetId: parsed.asset.id,
				compiledDigest: parsed.asset.manifest.runtime.compiledDigest,
			}) satisfies ProgramSurfacePreparedBridgeApproval;
			preparedBridgeApprovals.set(prepared, {
				prepared,
				assetId: parsed.asset.id,
				startingApprovalEpoch,
				stored,
				resolution,
			});
			return { status: "prepared", prepared };
		};
		const commitPreparedBridgeApproval = (
			prepared: ProgramSurfacePreparedBridgeApproval,
			asset: ProgramSurfaceAsset,
		): ProgramSurfaceProbeResolution => {
			const staged = preparedBridgeApprovals.get(prepared);
			if (!staged) {
				return unsupported(
					"program-surface.approval-required",
					"The prepared Program Surface bridge approval is no longer available.",
				);
			}
			preparedBridgeApprovals.delete(prepared);
			const rejectPrepared = (
				code: Extract<
					ProgramSurfaceProbeResolution,
					{ readonly status: "fallback" }
				>["code"],
				message: string,
			): ProgramSurfaceProbeResolution => {
				eraseStoredApproval(staged.stored);
				return unsupported(code, message);
			};
			if (
				approvalEpoch !== staged.startingApprovalEpoch ||
				!sessionScope ||
				!sameApprovalScope(sessionScope, staged.stored.receipt.bridge.target)
			) {
				return rejectPrepared(
					"program-surface.bridge-session-mismatch",
					"The Program Surface bridge session changed before the prepared approval could commit.",
				);
			}
			const parsed = parseProgramSurfaceAsset(asset);
			if (parsed.status === "invalid") {
				return rejectPrepared(
					"program-surface.asset-invalid",
					"The Program Surface asset no longer satisfies its durable manifest contract.",
				);
			}
			const current = useSceneStore
				.getState()
				.document.assets?.find((entry) => entry.id === parsed.asset.id);
			if (current?.kind !== "program-surface") {
				return rejectPrepared(
					"program-surface.approval-required",
					"The durable Program Surface asset changed before the prepared approval could commit.",
				);
			}
			if (!sameProgramSurfaceAuthority(current, parsed.asset)) {
				return rejectPrepared(
					"program-surface.approval-required",
					"The durable Program Surface asset changed before the prepared approval could commit.",
				);
			}
			if (
				parsed.asset.id !== staged.assetId ||
				parsed.asset.id !== staged.prepared.assetId ||
				parsed.asset.manifest.runtime.compiledDigest !==
					staged.prepared.compiledDigest ||
				parsed.asset.manifest.runtime.compiledDigest !==
					staged.stored.receipt.bridge.identity.compiledDigest ||
				parsed.asset.manifest.source.snapshotDigest !==
					staged.stored.receipt.bridge.identity.inputDigest
			) {
				return rejectPrepared(
					"program-surface.bridge-identity-mismatch",
					"The prepared Program Surface bridge approval no longer matches the durable asset identity.",
				);
			}
			const fallbackIssue = fallbackActivationIssue(parsed.asset);
			if (fallbackIssue) {
				eraseStoredApproval(staged.stored);
				return fallbackIssue;
			}
			const profileIssue = v1HostProfileIssue(parsed.asset, "bridge");
			if (profileIssue) {
				eraseStoredApproval(staged.stored);
				return profileIssue;
			}
			const receiptMismatch = receiptIssue(parsed.asset, staged.stored.receipt);
			if (receiptMismatch) {
				eraseStoredApproval(staged.stored);
				return receiptMismatch;
			}
			const previous = receipts.get(parsed.asset.id);
			receipts.set(parsed.asset.id, staged.stored);
			committedBridgeApprovals.set(prepared, {
				prepared,
				assetId: parsed.asset.id,
				stored: staged.stored,
				previous,
			});
			clearPreparedBridgeApprovals();
			approvalEpoch += 1;
			notify();
			if (!committedBridgeApprovals.has(prepared)) {
				return unsupported(
					"program-surface.approval-required",
					"The local Program Surface approval changed while the bridge receipt was being published.",
				);
			}
			return staged.resolution;
		};
		const finalizeCommittedBridgeApproval = (
			prepared: ProgramSurfacePreparedBridgeApproval,
		): void => {
			releaseCommittedBridgeApproval(prepared);
		};
		const rollbackCommittedBridgeApproval = (
			prepared: ProgramSurfacePreparedBridgeApproval,
		): void => {
			const committed = committedBridgeApprovals.get(prepared);
			if (!committed) return;
			committedBridgeApprovals.delete(prepared);
			const current = receipts.get(committed.assetId);
			if (current !== committed.stored) {
				eraseStoredApproval(committed.stored);
				if (committed.previous && current !== committed.previous) {
					eraseStoredApproval(committed.previous);
				}
				return;
			}
			if (committed.previous) {
				receipts.set(committed.assetId, committed.previous);
			} else {
				receipts.delete(committed.assetId);
			}
			eraseStoredApproval(committed.stored);
			approvalEpoch += 1;
			notify();
		};
		return {
			approvals: () =>
				Object.freeze(
					[...receipts.values()].map((stored) =>
						immutableApproval(stored.receipt.approval),
					),
				),
			receiptFor: (assetId) => receipts.get(assetId)?.receipt,
			approve: async (asset) => {
				const startingApprovalEpoch = approvalEpoch;
				const receipt = immutableReceipt({
					source: "self-contained",
					approval: {
						assetId: asset.id,
						compiledDigest: asset.manifest.runtime.compiledDigest,
					},
					manifestProjection: programSurfaceHostManifestProjection(
						asset.manifest,
					),
				});
				const resolution = await resolutionForSelfContainedReceipt(
					asset,
					receipt,
				);
				if (resolution.status !== "approved") return resolution;
				const current = currentProgramSurfaceAuthority(asset);
				if (!current) {
					return unsupported(
						"program-surface.approval-required",
						"The durable Program Surface asset changed before this bundle could be recorded.",
					);
				}
				const fallbackIssue = fallbackActivationIssue(current);
				if (fallbackIssue) return fallbackIssue;
				if (approvalEpoch !== startingApprovalEpoch) {
					return unsupported(
						"program-surface.approval-required",
						"The local Program Surface approval changed before this bundle could be recorded.",
					);
				}
				clearPreparedBridgeApprovals();
				const previous = receipts.get(asset.id);
				if (previous) eraseStoredApproval(previous);
				receipts.set(asset.id, { kind: "self-contained", receipt });
				releaseCommittedBridgeApprovalsForAsset(asset.id);
				approvalEpoch += 1;
				notify();
				return resolution;
			},
			approveBridge: async (asset, input) => {
				const preparation = await prepareBridgeApproval(asset, input);
				if (preparation.status !== "prepared") return preparation;
				const resolution = commitPreparedBridgeApproval(
					preparation.prepared,
					asset,
				);
				if (resolution.status === "approved") {
					finalizeCommittedBridgeApproval(preparation.prepared);
				}
				return resolution;
			},
			prepareBridgeApproval,
			commitPreparedBridgeApproval,
			finalizeCommittedBridgeApproval,
			rollbackCommittedBridgeApproval,
			discardPreparedBridgeApproval: (prepared) => {
				discardPreparedBridgeApproval(prepared);
			},
			revoke: (assetId) => {
				const stored = receipts.get(assetId);
				const removedPrepared = clearPreparedBridgeApprovalsForAsset(assetId);
				const removedCommitted =
					releaseCommittedBridgeApprovalsForAsset(assetId);
				if (!stored && !removedPrepared && !removedCommitted) return;
				if (stored) {
					eraseStoredApproval(stored);
					receipts.delete(assetId);
				}
				approvalEpoch += 1;
				if (stored) notify();
			},
			clear: () => {
				releaseCommittedBridgeApprovals();
				const changed = clearReceipts();
				clearPreparedBridgeApprovals();
				approvalEpoch += 1;
				if (changed) notify();
			},
			bindSession: (scope) => {
				const nextKey =
					JSON.stringify([
						scope.editorInstanceId,
						scope.workingCopyId,
						String(scope.bindingEpoch),
					]) ?? "";
				if (sessionKey === nextKey) return;
				sessionKey = nextKey;
				sessionScope = {
					editorInstanceId: scope.editorInstanceId,
					workingCopyId: scope.workingCopyId,
					bindingEpoch: scope.bindingEpoch,
				};
				releaseCommittedBridgeApprovals();
				const changed = clearReceipts();
				clearPreparedBridgeApprovals();
				approvalEpoch += 1;
				if (changed) notify();
			},
			subscribe: (listener) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			resolve: async (asset) => {
				const stored = receipts.get(asset.id);
				if (!stored) {
					return resolutionForSelfContainedReceipt(asset, undefined);
				}
				const startingApprovalEpoch = approvalEpoch;
				const resolution =
					stored.kind === "bridge"
						? await resolutionForBridgeReceipt(
								asset,
								stored,
								() =>
									approvalEpoch === startingApprovalEpoch &&
									Boolean(
										sessionScope &&
											sameApprovalScope(
												sessionScope,
												stored.receipt.bridge.target,
											),
									),
							)
						: await resolutionForSelfContainedReceipt(asset, stored.receipt);
				if (
					resolution.status === "approved" &&
					(approvalEpoch !== startingApprovalEpoch ||
						receipts.get(asset.id) !== stored)
				) {
					return unsupported(
						"program-surface.approval-required",
						"The local Program Surface approval changed before this probe could be resolved.",
					);
				}
				return resolution;
			},
		};
	};

/** Page-session singleton for future user-authorized Program Surface controls. */
export const programSurfaceLocalApprovalRegistry =
	createProgramSurfaceLocalApprovalRegistry();
