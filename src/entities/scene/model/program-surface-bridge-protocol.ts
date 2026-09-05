import { parseProgramSurfaceManifest } from "./program-surface";
import type { ProgramSurfaceManifestV1 } from "./types";

/**
 * Transport contract for the opt-in local Program Surface companion. It is
 * intentionally a POJO-only module so a future browser feature and the Bun
 * process can agree on the same fence without importing either runtime.
 */
/**
 * V2 removes all browser-visible local path and companion-authored diagnostic
 * text. V1 discovery records and WebSocket packets intentionally fail closed.
 */
export const PROGRAM_SURFACE_BRIDGE_PROTOCOL_VERSION = 2;

/** The only source descriptor filename the local companion discovers in V1. */
export const PROGRAM_SURFACE_LOCAL_SOURCE_DESCRIPTOR_FILENAME =
	".vecmo-program-surface.json";

/** The bundled entry name stored in the durable Program Surface manifest. */
export const PROGRAM_SURFACE_COMPILED_ENTRY = "program-surface.mjs";

export const PROGRAM_SURFACE_BRIDGE_MAX_CONTROL_MESSAGE_BYTES = 64 * 1024;
export const PROGRAM_SURFACE_BRIDGE_MAX_DIAGNOSTICS = 16;
/** A bridge may hand over one V1 bundle only after explicit candidate approval. */
export const PROGRAM_SURFACE_BRIDGE_MAX_APPROVED_BUNDLE_BYTES = 8 * 1024 * 1024;
export const PROGRAM_SURFACE_BRIDGE_MAX_APPROVED_BUNDLE_BASE64_CHARACTERS =
	4 * Math.ceil(PROGRAM_SURFACE_BRIDGE_MAX_APPROVED_BUNDLE_BYTES / 3);
/**
 * Approved-bundle packets carry bounded base64 bytes plus the ordinary control
 * envelope. All other server packets remain inside the 64 KiB control cap.
 */
export const PROGRAM_SURFACE_BRIDGE_MAX_APPROVED_BUNDLE_MESSAGE_BYTES =
	PROGRAM_SURFACE_BRIDGE_MAX_APPROVED_BUNDLE_BASE64_CHARACTERS +
	PROGRAM_SURFACE_BRIDGE_MAX_CONTROL_MESSAGE_BYTES;

/**
 * Browser-visible bridge diagnostics are deliberately coarse. The companion
 * keeps actionable paths and messages process-local so neither the packet nor
 * DevTools can disclose workspace structure or source-authored text.
 */
export const PROGRAM_SURFACE_BRIDGE_DIAGNOSTIC_CODES = [
	"program-surface-bridge-build-failed",
	"program-surface-bridge-watch-unavailable",
] as const;

export type ProgramSurfaceBridgeDiagnosticCode =
	(typeof PROGRAM_SURFACE_BRIDGE_DIAGNOSTIC_CODES)[number];

/** All fatal companion failures collapse to this source-free browser code. */
export const PROGRAM_SURFACE_BRIDGE_ERROR_CODE =
	"program-surface-bridge-operation-rejected";

export type ProgramSurfaceBridgeDigest = `sha256:${string}`;

/** Exact editor fence; a bridge never follows a tab, copy, or epoch change. */
export type ProgramSurfaceBridgeEditorTarget = {
	readonly editorInstanceId: string;
	readonly workingCopyId: string;
	readonly bindingEpoch: number;
};

/**
 * The local source descriptor is deliberately distinct from the portable
 * `application/vnd.vecmo.program-surface+json` package. It names local source
 * only; the companion derives a reference-only durable manifest from it.
 */
export type ProgramSurfaceSourceDeclaration = {
	readonly inputs: ProgramSurfaceManifestV1["inputs"];
	readonly output: ProgramSurfaceManifestV1["output"];
	readonly timing: ProgramSurfaceManifestV1["timing"];
	readonly space: ProgramSurfaceManifestV1["space"];
	readonly delivery: ProgramSurfaceManifestV1["delivery"];
	/** Required because every bridge candidate is reference-only and portable. */
	readonly fallback: NonNullable<ProgramSurfaceManifestV1["fallback"]>;
};

export type ProgramSurfaceLocalSourceDescriptorV1 = {
	readonly kind: "vecmo-program-surface-source";
	readonly schemaVersion: 1;
	readonly name: string;
	/** Canonical package-relative module path, never an absolute filesystem path. */
	readonly entry: string;
	readonly declaration: ProgramSurfaceSourceDeclaration;
};

export type ProgramSurfaceLocalSourceDescriptorParseResult =
	| {
			readonly ok: true;
			readonly descriptor: ProgramSurfaceLocalSourceDescriptorV1;
	  }
	| {
			readonly ok: false;
			readonly code: "program-surface-source-descriptor-invalid";
			readonly message: string;
	  };

export type ProgramSurfaceBuildIdentity = {
	/**
	 * SHA-256 of canonical durable ProgramSurfaceManifestV1 JSON: recursively
	 * sorted UTF-16 object keys, standard JSON scalars, and no whitespace.
	 */
	readonly manifestDigest: ProgramSurfaceBridgeDigest;
	/** SHA-256 of canonical local descriptor plus the closed source graph. */
	readonly inputDigest: ProgramSurfaceBridgeDigest;
	/** SHA-256 of exact emitted browser ESM bytes. */
	readonly compiledDigest: ProgramSurfaceBridgeDigest;
	readonly generation: number;
};

/** Source-free browser diagnostic. Detailed diagnostics stay in the companion. */
export type ProgramSurfaceBridgeDiagnostic = {
	readonly code: ProgramSurfaceBridgeDiagnosticCode;
};

export type ProgramSurfaceBridgeManifestListing = {
	readonly id: string;
	readonly name: string;
};

export type ProgramSurfaceBridgeHelloMessage = {
	readonly kind: "hello";
	readonly protocol: typeof PROGRAM_SURFACE_BRIDGE_PROTOCOL_VERSION;
	readonly bridgeId: string;
	readonly token: string;
	readonly target: ProgramSurfaceBridgeEditorTarget;
};

export type ProgramSurfaceBridgeBindMessage = {
	readonly kind: "bind";
	readonly sessionId: string;
	readonly target: ProgramSurfaceBridgeEditorTarget;
	readonly assetId: string;
	/** Opaque id returned by the companion scan; never a browser-supplied path. */
	readonly manifestId: string;
};

export type ProgramSurfaceBridgeApproveCandidateMessage = {
	readonly kind: "approve-candidate";
	readonly sessionId: string;
	readonly bindingId: string;
	readonly target: ProgramSurfaceBridgeEditorTarget;
	readonly assetId: string;
	readonly identity: ProgramSurfaceBuildIdentity;
};

export type ProgramSurfaceBridgeHeartbeatMessage = {
	readonly kind: "heartbeat";
	readonly sessionId: string;
	readonly target: ProgramSurfaceBridgeEditorTarget;
	readonly bindingId?: string;
};

export type ProgramSurfaceBridgeCloseMessage = {
	readonly kind: "close";
	readonly sessionId: string;
	readonly target: ProgramSurfaceBridgeEditorTarget;
	readonly bindingId?: string;
};

export type ProgramSurfaceBridgeClientMessage =
	| ProgramSurfaceBridgeHelloMessage
	| ProgramSurfaceBridgeBindMessage
	| ProgramSurfaceBridgeApproveCandidateMessage
	| ProgramSurfaceBridgeHeartbeatMessage
	| ProgramSurfaceBridgeCloseMessage;

export type ProgramSurfaceBridgeHelloAckMessage = {
	readonly kind: "hello-ack";
	readonly protocol: typeof PROGRAM_SURFACE_BRIDGE_PROTOCOL_VERSION;
	readonly accepted: boolean;
	readonly sessionId?: string;
	readonly manifests?: readonly ProgramSurfaceBridgeManifestListing[];
};

export type ProgramSurfaceBridgeBindAckMessage = {
	readonly kind: "bind-ack";
	readonly sessionId: string;
	readonly bindingId: string;
	readonly target: ProgramSurfaceBridgeEditorTarget;
	readonly assetId: string;
	readonly manifestId: string;
};

export type ProgramSurfaceBridgeBuildStatus =
	| "bound-clean"
	| "building"
	| "candidate-awaiting-approval"
	| "active-last-known-good"
	| "build-failed-last-known-good";

export type ProgramSurfaceBridgeBuildStatusMessage = {
	readonly kind: "build-status";
	readonly sessionId: string;
	readonly bindingId: string;
	readonly target: ProgramSurfaceBridgeEditorTarget;
	readonly assetId: string;
	readonly status: ProgramSurfaceBridgeBuildStatus;
};

/**
 * A successful candidate carries only declarations and digests. Its bundle is
 * intentionally absent until the exact identity receives a local approval.
 */
export type ProgramSurfaceBridgeBuildCandidateMessage = {
	readonly kind: "build-candidate";
	readonly sessionId: string;
	readonly bindingId: string;
	readonly target: ProgramSurfaceBridgeEditorTarget;
	readonly assetId: string;
	readonly manifestId: string;
	readonly identity: ProgramSurfaceBuildIdentity;
	readonly manifest: ProgramSurfaceManifestV1;
	readonly byteLength: number;
	readonly diagnostics: readonly ProgramSurfaceBridgeDiagnostic[];
};

export type ProgramSurfaceBridgeBuildDiagnosticsMessage = {
	readonly kind: "build-diagnostics";
	readonly sessionId: string;
	readonly bindingId: string;
	readonly target: ProgramSurfaceBridgeEditorTarget;
	readonly assetId: string;
	readonly generation: number;
	readonly diagnostics: readonly ProgramSurfaceBridgeDiagnostic[];
	readonly hasLastKnownGood: boolean;
};

/** Ephemeral bytes for the exact approved candidate; never a durable package. */
export type ProgramSurfaceBridgeApprovedBundleMessage = {
	readonly kind: "approved-bundle";
	readonly sessionId: string;
	readonly bindingId: string;
	readonly target: ProgramSurfaceBridgeEditorTarget;
	readonly assetId: string;
	readonly identity: ProgramSurfaceBuildIdentity;
	readonly bundle: {
		readonly encoding: "base64";
		readonly mimeType: "text/javascript";
		readonly data: string;
	};
};

export type ProgramSurfaceBridgeHeartbeatAckMessage = {
	readonly kind: "heartbeat-ack";
	readonly sessionId: string;
	readonly bindingId?: string;
};

export type ProgramSurfaceBridgeErrorMessage = {
	readonly kind: "error";
	readonly code: typeof PROGRAM_SURFACE_BRIDGE_ERROR_CODE;
};

export type ProgramSurfaceBridgeServerMessage =
	| ProgramSurfaceBridgeHelloAckMessage
	| ProgramSurfaceBridgeBindAckMessage
	| ProgramSurfaceBridgeBuildStatusMessage
	| ProgramSurfaceBridgeBuildCandidateMessage
	| ProgramSurfaceBridgeBuildDiagnosticsMessage
	| ProgramSurfaceBridgeApprovedBundleMessage
	| ProgramSurfaceBridgeHeartbeatAckMessage
	| ProgramSurfaceBridgeErrorMessage;

const zeroDigest = `sha256:${"0".repeat(64)}` as ProgramSurfaceBridgeDigest;
const digestPattern = /^sha256:[a-f0-9]{64}$/iu;
const sourceModuleSuffixes = [".js", ".mjs", ".ts", ".tsx", ".jsx"] as const;
const canonicalBase64Pattern =
	/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const hasOnlyKeys = (
	value: Record<string, unknown>,
	required: readonly string[],
	optional: readonly string[] = [],
): boolean => {
	if (!required.every((key) => Object.hasOwn(value, key))) return false;
	const allowed = new Set([...required, ...optional]);
	return Object.keys(value).every((key) => allowed.has(key));
};

/** Returns whether bridge text contains a C0 or DEL control character. */
export const hasProgramSurfaceControlCharacter = (value: string): boolean => {
	for (let index = 0; index < value.length; index += 1) {
		const codeUnit = value.charCodeAt(index);
		if (codeUnit <= 0x1f || codeUnit === 0x7f) return true;
	}
	return false;
};

const isOpaqueText = (
	value: unknown,
	minimumLength = 1,
	maximumLength = 256,
): value is string =>
	typeof value === "string" &&
	value.length >= minimumLength &&
	value.length <= maximumLength &&
	value.trim() === value &&
	!hasProgramSurfaceControlCharacter(value);

const isBoundedText = (
	value: unknown,
	maximumLength: number,
	minimumLength = 1,
): value is string =>
	typeof value === "string" &&
	value.length >= minimumLength &&
	value.length <= maximumLength &&
	!hasProgramSurfaceControlCharacter(value);

const isDigest = (value: unknown): value is ProgramSurfaceBridgeDigest =>
	typeof value === "string" && digestPattern.test(value);

const isTarget = (value: unknown): value is ProgramSurfaceBridgeEditorTarget =>
	isRecord(value) &&
	hasOnlyKeys(value, ["editorInstanceId", "workingCopyId", "bindingEpoch"]) &&
	isOpaqueText(value.editorInstanceId) &&
	isOpaqueText(value.workingCopyId) &&
	typeof value.bindingEpoch === "number" &&
	Number.isSafeInteger(value.bindingEpoch) &&
	value.bindingEpoch >= 0;

const isBuildIdentity = (
	value: unknown,
): value is ProgramSurfaceBuildIdentity =>
	isRecord(value) &&
	hasOnlyKeys(value, [
		"manifestDigest",
		"inputDigest",
		"compiledDigest",
		"generation",
	]) &&
	isDigest(value.manifestDigest) &&
	isDigest(value.inputDigest) &&
	isDigest(value.compiledDigest) &&
	typeof value.generation === "number" &&
	Number.isSafeInteger(value.generation) &&
	value.generation > 0;

const isProgramSurfaceBridgeDiagnosticCode = (
	value: unknown,
): value is ProgramSurfaceBridgeDiagnosticCode =>
	typeof value === "string" &&
	PROGRAM_SURFACE_BRIDGE_DIAGNOSTIC_CODES.some((code) => code === value);

const isDiagnostic = (
	value: unknown,
): value is ProgramSurfaceBridgeDiagnostic =>
	isRecord(value) &&
	hasOnlyKeys(value, ["code"]) &&
	isProgramSurfaceBridgeDiagnosticCode(value.code);

const isDiagnostics = (
	value: unknown,
): value is readonly ProgramSurfaceBridgeDiagnostic[] =>
	Array.isArray(value) &&
	value.length <= PROGRAM_SURFACE_BRIDGE_MAX_DIAGNOSTICS &&
	value.every(isDiagnostic);

const isManifestListing = (
	value: unknown,
): value is ProgramSurfaceBridgeManifestListing =>
	isRecord(value) &&
	hasOnlyKeys(value, ["id", "name"]) &&
	isOpaqueText(value.id) &&
	isBoundedText(value.name, 120);

const isManifestListings = (
	value: unknown,
): value is readonly ProgramSurfaceBridgeManifestListing[] =>
	Array.isArray(value) && value.length <= 64 && value.every(isManifestListing);

const isBuildStatus = (
	value: unknown,
): value is ProgramSurfaceBridgeBuildStatus =>
	value === "bound-clean" ||
	value === "building" ||
	value === "candidate-awaiting-approval" ||
	value === "active-last-known-good" ||
	value === "build-failed-last-known-good";

const decodedBase64ByteLength = (value: string): number | null => {
	if (!canonicalBase64Pattern.test(value)) return null;
	const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
	const bytes = (value.length / 4) * 3 - padding;
	return Number.isSafeInteger(bytes) ? bytes : null;
};

const isApprovedBundle = (
	value: unknown,
): value is ProgramSurfaceBridgeApprovedBundleMessage["bundle"] => {
	if (
		!isRecord(value) ||
		!hasOnlyKeys(value, ["encoding", "mimeType", "data"]) ||
		value.encoding !== "base64" ||
		value.mimeType !== "text/javascript" ||
		typeof value.data !== "string" ||
		value.data.length === 0 ||
		value.data.length >
			PROGRAM_SURFACE_BRIDGE_MAX_APPROVED_BUNDLE_BASE64_CHARACTERS
	) {
		return false;
	}
	const byteLength = decodedBase64ByteLength(value.data);
	return (
		byteLength !== null &&
		byteLength > 0 &&
		byteLength <= PROGRAM_SURFACE_BRIDGE_MAX_APPROVED_BUNDLE_BYTES
	);
};

const utf8ByteLengthIsWithin = (raw: string, maximumBytes: number): boolean => {
	// Avoid allocating a decoded copy for hostile WebSocket input. Unpaired
	// surrogates have the same three-byte replacement behavior as TextEncoder.
	if (raw.length > maximumBytes) return false;
	let bytes = 0;
	for (let index = 0; index < raw.length; index += 1) {
		const code = raw.charCodeAt(index);
		if (code <= 0x7f) {
			bytes += 1;
		} else if (code <= 0x7ff) {
			bytes += 2;
		} else if (
			code >= 0xd800 &&
			code <= 0xdbff &&
			index + 1 < raw.length &&
			raw.charCodeAt(index + 1) >= 0xdc00 &&
			raw.charCodeAt(index + 1) <= 0xdfff
		) {
			bytes += 4;
			index += 1;
		} else {
			bytes += 3;
		}
		if (bytes > maximumBytes) return false;
	}
	return true;
};

/**
 * Canonical JSON used in the bridge identity. It accepts only JSON scalars,
 * arrays, and plain object records; no source text is introduced by this
 * serializer. Object keys use the same code-unit ordering in Bun and browser.
 */
export const serializeProgramSurfaceBridgeCanonicalJson = (
	value: unknown,
): string => {
	if (value === null) return "null";
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value === "boolean") return value ? "true" : "false";
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new TypeError(
				"Program Surface bridge canonical JSON rejects non-finite numbers.",
			);
		}
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map(serializeProgramSurfaceBridgeCanonicalJson).join(",")}]`;
	}
	if (isRecord(value)) {
		return `{${Object.keys(value)
			.sort((left, right) => (left === right ? 0 : left < right ? -1 : 1))
			.map(
				(key) =>
					`${JSON.stringify(key)}:${serializeProgramSurfaceBridgeCanonicalJson(value[key])}`,
			)
			.join(",")}}`;
	}
	throw new TypeError(
		"Program Surface bridge canonical JSON rejects non-JSON values.",
	);
};

/**
 * The manifest identity is intentionally source-free: it covers declared
 * ports, delivery/fallback contract, and bundle digests, never workspace paths
 * or bundle bytes. Both the companion and browser use this exact serializer.
 */
export const serializeProgramSurfaceBridgeManifest = (
	manifest: ProgramSurfaceManifestV1,
): string => serializeProgramSurfaceBridgeCanonicalJson(manifest);

const isAllowedSourceModule = (value: string): boolean =>
	!value.endsWith(".d.ts") &&
	sourceModuleSuffixes.some((suffix) => value.endsWith(suffix));

/**
 * Normalizes a descriptor entry to a safe package-relative source module path.
 * Import-specifier resolution has its own stricter filesystem fence in the Bun
 * companion; this guard prevents an entry itself becoming a URL or traversal.
 */
export const normalizeProgramSurfaceSourceEntry = (
	value: unknown,
): string | null => {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (
		trimmed.length === 0 ||
		trimmed.length > 256 ||
		hasProgramSurfaceControlCharacter(trimmed) ||
		trimmed.includes("\\") ||
		trimmed.includes("?") ||
		trimmed.includes("#") ||
		trimmed.includes(":") ||
		trimmed.startsWith("/") ||
		trimmed.startsWith("~")
	) {
		return null;
	}
	const normalized = trimmed.replace(/^(?:\.\/)+/u, "");
	if (
		normalized.length === 0 ||
		normalized.endsWith("/") ||
		normalized.includes("//") ||
		normalized
			.split("/")
			.some((segment) => segment === "." || segment === "..") ||
		!isAllowedSourceModule(normalized)
	) {
		return null;
	}
	return normalized;
};

const invalidDescriptor = (
	message: string,
): ProgramSurfaceLocalSourceDescriptorParseResult => ({
	ok: false,
	code: "program-surface-source-descriptor-invalid",
	message,
});

/**
 * Strictly parses the local-only descriptor and lowers its declaration through
 * the durable manifest parser. The returned declaration therefore has exactly
 * the same typed port/output semantics as a stored Program Surface asset.
 */
export const parseProgramSurfaceLocalSourceDescriptor = (
	value: unknown,
): ProgramSurfaceLocalSourceDescriptorParseResult => {
	if (
		!isRecord(value) ||
		!hasOnlyKeys(value, [
			"kind",
			"schemaVersion",
			"name",
			"entry",
			"declaration",
		])
	) {
		return invalidDescriptor(
			"Program Surface source descriptor has an unexpected shape.",
		);
	}
	if (
		value.kind !== "vecmo-program-surface-source" ||
		value.schemaVersion !== 1
	) {
		return invalidDescriptor(
			"Program Surface source descriptor must declare kind vecmo-program-surface-source and schemaVersion 1.",
		);
	}
	const name =
		typeof value.name === "string" &&
		value.name.trim().length > 0 &&
		value.name.trim().length <= 120 &&
		!hasProgramSurfaceControlCharacter(value.name)
			? value.name.trim()
			: null;
	if (!name) {
		return invalidDescriptor(
			"Program Surface source descriptor name must be a bounded non-empty string.",
		);
	}
	const entry = normalizeProgramSurfaceSourceEntry(value.entry);
	if (!entry) {
		return invalidDescriptor(
			"Program Surface source descriptor entry must be a relative JavaScript or TypeScript module path.",
		);
	}
	const declaration = value.declaration;
	if (
		!isRecord(declaration) ||
		!hasOnlyKeys(
			declaration,
			["inputs", "output", "timing", "space", "delivery"],
			["fallback"],
		)
	) {
		return invalidDescriptor(
			"Program Surface source descriptor declaration has an unexpected shape.",
		);
	}
	if (declaration.fallback === undefined) {
		return invalidDescriptor(
			"Program Surface reference-only source descriptors must declare an explicit export fallback.",
		);
	}

	const parsed = parseProgramSurfaceManifest({
		schemaVersion: 1,
		runtime: {
			kind: "webgl2",
			entry: PROGRAM_SURFACE_COMPILED_ENTRY,
			compiledDigest: zeroDigest,
		},
		source: { snapshotDigest: zeroDigest, portability: "reference-only" },
		inputs: declaration.inputs,
		output: declaration.output,
		timing: declaration.timing,
		space: declaration.space,
		delivery: declaration.delivery,
		...(declaration.fallback === undefined
			? {}
			: { fallback: declaration.fallback }),
	});
	if (parsed.status !== "valid") {
		return invalidDescriptor(
			parsed.issues[0]?.message ??
				"Program Surface source descriptor declaration is invalid.",
		);
	}
	const fallback = parsed.manifest.fallback;
	if (!fallback) {
		return invalidDescriptor(
			"Program Surface reference-only source descriptors must declare an explicit export fallback.",
		);
	}

	return {
		ok: true,
		descriptor: {
			kind: "vecmo-program-surface-source",
			schemaVersion: 1,
			name,
			entry,
			declaration: {
				inputs: parsed.manifest.inputs,
				output: parsed.manifest.output,
				timing: parsed.manifest.timing,
				space: parsed.manifest.space,
				delivery: parsed.manifest.delivery,
				fallback,
			},
		},
	};
};

/**
 * Derives the durable reference-only declaration for a local candidate. This
 * function never embeds local source locations or bundle bytes.
 */
export const deriveProgramSurfaceReferenceManifest = (
	descriptor: ProgramSurfaceLocalSourceDescriptorV1,
	identity: Pick<ProgramSurfaceBuildIdentity, "compiledDigest"> & {
		readonly snapshotDigest: ProgramSurfaceBridgeDigest;
	},
): ProgramSurfaceManifestV1 => {
	const parsed = parseProgramSurfaceManifest({
		schemaVersion: 1,
		runtime: {
			kind: "webgl2",
			entry: PROGRAM_SURFACE_COMPILED_ENTRY,
			compiledDigest: identity.compiledDigest,
		},
		source: {
			snapshotDigest: identity.snapshotDigest,
			portability: "reference-only",
		},
		inputs: descriptor.declaration.inputs,
		output: descriptor.declaration.output,
		timing: descriptor.declaration.timing,
		space: descriptor.declaration.space,
		delivery: descriptor.declaration.delivery,
		fallback: descriptor.declaration.fallback,
	});
	if (parsed.status !== "valid") {
		throw new Error(
			"Program Surface bridge attempted to derive an invalid manifest.",
		);
	}
	return parsed.manifest;
};

/** Incoming WebSocket envelope parser. Server packets are typed at construction. */
export const parseProgramSurfaceBridgeClientMessage = (
	raw: string,
):
	| { readonly ok: true; readonly message: ProgramSurfaceBridgeClientMessage }
	| { readonly ok: false; readonly error: string } => {
	if (
		!utf8ByteLengthIsWithin(
			raw,
			PROGRAM_SURFACE_BRIDGE_MAX_CONTROL_MESSAGE_BYTES,
		)
	) {
		return {
			ok: false,
			error: "bridge control frame exceeds the maximum size",
		};
	}
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return { ok: false, error: "bridge control frame is not JSON" };
	}
	if (!isRecord(value) || typeof value.kind !== "string") {
		return { ok: false, error: "bridge control frame has no kind" };
	}

	switch (value.kind) {
		case "hello":
			if (
				hasOnlyKeys(value, [
					"kind",
					"protocol",
					"bridgeId",
					"token",
					"target",
				]) &&
				value.protocol === PROGRAM_SURFACE_BRIDGE_PROTOCOL_VERSION &&
				isOpaqueText(value.bridgeId) &&
				isOpaqueText(value.token, 43, 512) &&
				isTarget(value.target)
			) {
				return {
					ok: true,
					message: {
						kind: "hello",
						protocol: PROGRAM_SURFACE_BRIDGE_PROTOCOL_VERSION,
						bridgeId: value.bridgeId,
						token: value.token,
						target: value.target,
					},
				};
			}
			break;
		case "bind":
			if (
				hasOnlyKeys(value, [
					"kind",
					"sessionId",
					"target",
					"assetId",
					"manifestId",
				]) &&
				isOpaqueText(value.sessionId) &&
				isTarget(value.target) &&
				isOpaqueText(value.assetId) &&
				isOpaqueText(value.manifestId)
			) {
				return {
					ok: true,
					message: {
						kind: "bind",
						sessionId: value.sessionId,
						target: value.target,
						assetId: value.assetId,
						manifestId: value.manifestId,
					},
				};
			}
			break;
		case "approve-candidate":
			if (
				hasOnlyKeys(value, [
					"kind",
					"sessionId",
					"bindingId",
					"target",
					"assetId",
					"identity",
				]) &&
				isOpaqueText(value.sessionId) &&
				isOpaqueText(value.bindingId) &&
				isTarget(value.target) &&
				isOpaqueText(value.assetId) &&
				isBuildIdentity(value.identity)
			) {
				return {
					ok: true,
					message: {
						kind: "approve-candidate",
						sessionId: value.sessionId,
						bindingId: value.bindingId,
						target: value.target,
						assetId: value.assetId,
						identity: value.identity,
					},
				};
			}
			break;
		case "heartbeat":
			if (
				hasOnlyKeys(value, ["kind", "sessionId", "target"], ["bindingId"]) &&
				isOpaqueText(value.sessionId) &&
				isTarget(value.target) &&
				(value.bindingId === undefined || isOpaqueText(value.bindingId))
			) {
				return {
					ok: true,
					message: {
						kind: "heartbeat",
						sessionId: value.sessionId,
						target: value.target,
						...(value.bindingId === undefined
							? {}
							: { bindingId: value.bindingId }),
					},
				};
			}
			break;
		case "close":
			if (
				hasOnlyKeys(value, ["kind", "sessionId", "target"], ["bindingId"]) &&
				isOpaqueText(value.sessionId) &&
				isTarget(value.target) &&
				(value.bindingId === undefined || isOpaqueText(value.bindingId))
			) {
				return {
					ok: true,
					message: {
						kind: "close",
						sessionId: value.sessionId,
						target: value.target,
						...(value.bindingId === undefined
							? {}
							: { bindingId: value.bindingId }),
					},
				};
			}
			break;
		default:
			return { ok: false, error: "bridge control frame kind is unsupported" };
	}

	return { ok: false, error: "bridge control frame has an invalid shape" };
};

const parseBridgeCandidateManifest = (
	value: unknown,
): ProgramSurfaceManifestV1 | null => {
	const parsed = parseProgramSurfaceManifest(value);
	if (parsed.status !== "valid") return null;
	try {
		// The wire declaration must already be its exact durable canonical form.
		// This rejects unknown keys and case/shape normalizations before the browser
		// ever stores a candidate in its ephemeral bridge snapshot.
		if (
			serializeProgramSurfaceBridgeCanonicalJson(value) !==
			serializeProgramSurfaceBridgeManifest(parsed.manifest)
		) {
			return null;
		}
	} catch {
		return null;
	}
	return parsed.manifest;
};

const isExactServerEnvelope = (
	value: Record<string, unknown>,
	required: readonly string[],
	optional: readonly string[] = [],
): boolean => hasOnlyKeys(value, required, optional);

/**
 * Strict browser-side parser for companion packets. Approved bundle packets
 * receive their own bounded allowance; no other packet can use that larger
 * channel. Callers still independently decode/hash the bundle before durable
 * metadata changes or local host approval.
 */
export const parseProgramSurfaceBridgeServerMessage = (
	raw: string,
):
	| { readonly ok: true; readonly message: ProgramSurfaceBridgeServerMessage }
	| { readonly ok: false; readonly error: string } => {
	if (
		!utf8ByteLengthIsWithin(
			raw,
			PROGRAM_SURFACE_BRIDGE_MAX_APPROVED_BUNDLE_MESSAGE_BYTES,
		)
	) {
		return { ok: false, error: "bridge server frame exceeds the maximum size" };
	}
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return { ok: false, error: "bridge server frame is not JSON" };
	}
	if (!isRecord(value) || typeof value.kind !== "string") {
		return { ok: false, error: "bridge server frame has no kind" };
	}

	const controlOnly = (): boolean =>
		utf8ByteLengthIsWithin(
			raw,
			PROGRAM_SURFACE_BRIDGE_MAX_CONTROL_MESSAGE_BYTES,
		);

	switch (value.kind) {
		case "hello-ack": {
			if (
				!controlOnly() ||
				!isExactServerEnvelope(
					value,
					["kind", "protocol", "accepted"],
					["sessionId", "manifests"],
				) ||
				value.protocol !== PROGRAM_SURFACE_BRIDGE_PROTOCOL_VERSION ||
				typeof value.accepted !== "boolean"
			) {
				break;
			}
			if (value.accepted) {
				if (
					!isOpaqueText(value.sessionId) ||
					!isManifestListings(value.manifests)
				) {
					break;
				}
				return {
					ok: true,
					message: {
						kind: "hello-ack",
						protocol: PROGRAM_SURFACE_BRIDGE_PROTOCOL_VERSION,
						accepted: true,
						sessionId: value.sessionId,
						manifests: value.manifests,
					},
				};
			}
			if (value.sessionId !== undefined || value.manifests !== undefined) {
				break;
			}
			return {
				ok: true,
				message: {
					kind: "hello-ack",
					protocol: PROGRAM_SURFACE_BRIDGE_PROTOCOL_VERSION,
					accepted: false,
				},
			};
		}
		case "bind-ack":
			if (
				controlOnly() &&
				isExactServerEnvelope(value, [
					"kind",
					"sessionId",
					"bindingId",
					"target",
					"assetId",
					"manifestId",
				]) &&
				isOpaqueText(value.sessionId) &&
				isOpaqueText(value.bindingId) &&
				isTarget(value.target) &&
				isOpaqueText(value.assetId) &&
				isOpaqueText(value.manifestId)
			) {
				return {
					ok: true,
					message: {
						kind: "bind-ack",
						sessionId: value.sessionId,
						bindingId: value.bindingId,
						target: value.target,
						assetId: value.assetId,
						manifestId: value.manifestId,
					},
				};
			}
			break;
		case "build-status":
			if (
				controlOnly() &&
				isExactServerEnvelope(value, [
					"kind",
					"sessionId",
					"bindingId",
					"target",
					"assetId",
					"status",
				]) &&
				isOpaqueText(value.sessionId) &&
				isOpaqueText(value.bindingId) &&
				isTarget(value.target) &&
				isOpaqueText(value.assetId) &&
				isBuildStatus(value.status)
			) {
				return {
					ok: true,
					message: {
						kind: "build-status",
						sessionId: value.sessionId,
						bindingId: value.bindingId,
						target: value.target,
						assetId: value.assetId,
						status: value.status,
					},
				};
			}
			break;
		case "build-candidate": {
			if (
				!controlOnly() ||
				!isExactServerEnvelope(value, [
					"kind",
					"sessionId",
					"bindingId",
					"target",
					"assetId",
					"manifestId",
					"identity",
					"manifest",
					"byteLength",
					"diagnostics",
				]) ||
				!isOpaqueText(value.sessionId) ||
				!isOpaqueText(value.bindingId) ||
				!isTarget(value.target) ||
				!isOpaqueText(value.assetId) ||
				!isOpaqueText(value.manifestId) ||
				!isBuildIdentity(value.identity) ||
				typeof value.byteLength !== "number" ||
				!Number.isSafeInteger(value.byteLength) ||
				value.byteLength <= 0 ||
				value.byteLength > PROGRAM_SURFACE_BRIDGE_MAX_APPROVED_BUNDLE_BYTES ||
				!isDiagnostics(value.diagnostics)
			) {
				break;
			}
			const manifest = parseBridgeCandidateManifest(value.manifest);
			if (
				!manifest ||
				manifest.runtime.entry !== PROGRAM_SURFACE_COMPILED_ENTRY ||
				manifest.source.portability !== "reference-only" ||
				!manifest.fallback ||
				manifest.fallback.assetId === value.assetId ||
				manifest.source.snapshotDigest !== value.identity.inputDigest ||
				manifest.runtime.compiledDigest !== value.identity.compiledDigest
			) {
				break;
			}
			return {
				ok: true,
				message: {
					kind: "build-candidate",
					sessionId: value.sessionId,
					bindingId: value.bindingId,
					target: value.target,
					assetId: value.assetId,
					manifestId: value.manifestId,
					identity: value.identity,
					manifest,
					byteLength: value.byteLength,
					diagnostics: value.diagnostics,
				},
			};
		}
		case "build-diagnostics":
			if (
				controlOnly() &&
				isExactServerEnvelope(value, [
					"kind",
					"sessionId",
					"bindingId",
					"target",
					"assetId",
					"generation",
					"diagnostics",
					"hasLastKnownGood",
				]) &&
				isOpaqueText(value.sessionId) &&
				isOpaqueText(value.bindingId) &&
				isTarget(value.target) &&
				isOpaqueText(value.assetId) &&
				typeof value.generation === "number" &&
				Number.isSafeInteger(value.generation) &&
				value.generation > 0 &&
				isDiagnostics(value.diagnostics) &&
				typeof value.hasLastKnownGood === "boolean"
			) {
				return {
					ok: true,
					message: {
						kind: "build-diagnostics",
						sessionId: value.sessionId,
						bindingId: value.bindingId,
						target: value.target,
						assetId: value.assetId,
						generation: value.generation,
						diagnostics: value.diagnostics,
						hasLastKnownGood: value.hasLastKnownGood,
					},
				};
			}
			break;
		case "approved-bundle":
			if (
				isExactServerEnvelope(value, [
					"kind",
					"sessionId",
					"bindingId",
					"target",
					"assetId",
					"identity",
					"bundle",
				]) &&
				isOpaqueText(value.sessionId) &&
				isOpaqueText(value.bindingId) &&
				isTarget(value.target) &&
				isOpaqueText(value.assetId) &&
				isBuildIdentity(value.identity) &&
				isApprovedBundle(value.bundle)
			) {
				return {
					ok: true,
					message: {
						kind: "approved-bundle",
						sessionId: value.sessionId,
						bindingId: value.bindingId,
						target: value.target,
						assetId: value.assetId,
						identity: value.identity,
						bundle: value.bundle,
					},
				};
			}
			break;
		case "heartbeat-ack":
			if (
				controlOnly() &&
				isExactServerEnvelope(value, ["kind", "sessionId"], ["bindingId"]) &&
				isOpaqueText(value.sessionId) &&
				(value.bindingId === undefined || isOpaqueText(value.bindingId))
			) {
				return {
					ok: true,
					message: {
						kind: "heartbeat-ack",
						sessionId: value.sessionId,
						...(value.bindingId === undefined
							? {}
							: { bindingId: value.bindingId }),
					},
				};
			}
			break;
		case "error":
			if (
				controlOnly() &&
				isExactServerEnvelope(value, ["kind", "code"]) &&
				value.code === PROGRAM_SURFACE_BRIDGE_ERROR_CODE
			) {
				return {
					ok: true,
					message: {
						kind: "error",
						code: PROGRAM_SURFACE_BRIDGE_ERROR_CODE,
					},
				};
			}
			break;
		default:
			return { ok: false, error: "bridge server frame kind is unsupported" };
	}

	return { ok: false, error: "bridge server frame has an invalid shape" };
};

export const encodeProgramSurfaceBridgeMessage = (
	message:
		| ProgramSurfaceBridgeClientMessage
		| ProgramSurfaceBridgeServerMessage,
): string => JSON.stringify(message);
