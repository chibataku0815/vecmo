/**
 * Transport contract for the opt-in local production companion (Blender first).
 * It is a POJO-only module so the browser feature and the Bun companion agree
 * on one fence without importing either runtime.
 *
 * Four disciplines are load-bearing and each one is a rule, not a preference:
 *
 * 1. Every editor-bound message is SOURCE-FREE. It carries a display name,
 *    digests, bounded numbers, and typed diagnostic codes. It never carries an
 *    absolute path, source bytes, companion-authored free text, or the pairing
 *    token after pairing. A leak here would put a filesystem location inside
 *    browser memory, which is the exact thing the working-copy registry split
 *    exists to prevent.
 * 2. Every companion-bound request carries the fence tuple
 *    `{editorInstanceId, workingCopyId, bindingEpoch}` plus the `linkId`. The
 *    companion rejects any request whose tuple does not match the bound target,
 *    so a second tab, a forked working copy, or a relink cannot inherit an
 *    approval that was granted to a different binding.
 * 3. Artifacts are NOT inline bytes. A build result carries
 *    `{buildKey, artifactDigest, byteLength, fetchToken}`; the client fetches
 *    the GLB with a one-time token over HTTP on the same loopback origin and
 *    verifies the digest after the fetch. Control frames therefore stay inside
 *    a small bounded envelope no matter how large the artifact is.
 * 4. Digests are BARE lowercase hex SHA-256 (64 characters, no `sha256:`
 *    prefix), matching `production-artifacts.ts` and accepted unchanged by
 *    `parseExternalProductionLink`, so a wire digest round-trips into the
 *    durable document without transformation.
 */

import type {
	AllowlistedBindingDescriptor,
	ExternalProductionOutputProfile,
	PublishedControl,
	PublishedControlUnit,
} from "./production-link";

/** V1 is the only wire contract this build accepts; a bump is explicit. */
export const PRODUCTION_LINK_PROTOCOL_VERSION = 1;

/** Loopback discovery record, served as JSON over plain HTTP GET. */
export const PRODUCTION_LINK_DISCOVERY_PATH = "/__vecmo-production-link";
/** One-time-token artifact fetch endpoint on the same loopback origin. */
export const PRODUCTION_LINK_ARTIFACT_PATH =
	"/__vecmo-production-link/artifact";
/** Named default so neither side hard-codes a port literal at a call site. */
export const PRODUCTION_LINK_DEFAULT_PORT = 43_219;

export const PRODUCTION_LINK_MAX_CONTROL_MESSAGE_BYTES = 64 * 1024;
export const PRODUCTION_LINK_MAX_DIAGNOSTICS = 16;
export const PRODUCTION_LINK_MAX_PUBLISHED_CONTROLS = 128;
/** Bounded artifact allowance. A larger produced GLB fails closed, never truncates. */
export const PRODUCTION_LINK_MAX_ARTIFACT_BYTES = 128 * 1024 * 1024;
export const PRODUCTION_LINK_ARTIFACT_MIME_TYPE = "model/gltf-binary";

/**
 * Browser-visible diagnostics are deliberately coarse and closed. Actionable
 * detail (paths, Blender stderr, Python tracebacks) stays process-local in the
 * companion, where it cannot reach DevTools or a cloud document.
 */
export const PRODUCTION_LINK_DIAGNOSTIC_CODES = [
	"production-link-source-unreadable",
	/** The source is readable but moved since the inspect this build was keyed to. */
	"production-link-source-drifted",
	"production-link-adapter-unavailable",
	"production-link-adapter-timeout",
	"production-link-inspect-failed",
	"production-link-build-failed",
	"production-link-profile-unsupported",
	"production-link-artifact-empty",
	"production-link-cancelled",
] as const;

export type ProductionLinkDiagnosticCode =
	(typeof PRODUCTION_LINK_DIAGNOSTIC_CODES)[number];

/** All fatal companion failures collapse to this one source-free browser code. */
export const PRODUCTION_LINK_ERROR_CODE = "production-link-operation-rejected";

export type ProductionLinkDiagnostic = {
	readonly code: ProductionLinkDiagnosticCode;
};

/** Exact editor fence; the companion never follows a tab, copy, or epoch change. */
export type ProductionLinkEditorTarget = {
	readonly editorInstanceId: string;
	readonly workingCopyId: string;
	readonly bindingEpoch: number;
};

/** Producing-environment facts a fresh inspect measured. */
export type ProductionLinkEnvironmentReport = {
	readonly blenderVersion: string;
	readonly environmentDigest: string;
	readonly renderSettingsDigest: string;
};

export type ProductionLinkFrameReport = {
	readonly fps: number;
	readonly durationFrames: number;
	readonly blenderFrameStart: number;
};

export type ProductionLinkBuildState =
	| "queued"
	| "inspecting"
	| "exporting"
	| "hashing"
	| "produced"
	| "cancelled"
	| "failed";

/* ------------------------------------------------------------------ */
/* Editor -> companion                                                 */
/* ------------------------------------------------------------------ */

export type ProductionLinkHelloMessage = {
	readonly kind: "hello";
	readonly protocol: typeof PRODUCTION_LINK_PROTOCOL_VERSION;
	readonly clientId: string;
	/** One-time pairing token. It is never echoed back after pairing. */
	readonly token: string;
	readonly target: ProductionLinkEditorTarget;
};

export type ProductionLinkBindMessage = {
	readonly kind: "bind";
	readonly sessionId: string;
	readonly target: ProductionLinkEditorTarget;
	readonly linkId: string;
	/**
	 * Opaque local handle previously chosen by the user through the companion.
	 * The browser only ever replays a token it received; it cannot mint one, so
	 * this field cannot become a browser-supplied filesystem path.
	 */
	readonly localPathToken: string;
};

export type ProductionLinkInspectMessage = {
	readonly kind: "inspect";
	readonly sessionId: string;
	readonly target: ProductionLinkEditorTarget;
	readonly linkId: string;
	readonly requestId: string;
};

export type ProductionLinkBuildMessage = {
	readonly kind: "build";
	readonly sessionId: string;
	readonly target: ProductionLinkEditorTarget;
	readonly linkId: string;
	readonly requestId: string;
	/**
	 * The editor's desired key. V1 treats it as an opaque label the companion
	 * stamps on the artifact it produces: the key's `cameraDigest` comes from the
	 * durable link, which is not on this wire, so the companion cannot re-derive
	 * it. What the companion does guarantee is a fresh inspect before every
	 * export and a fail-closed refusal when the source moved since the inspect
	 * the key was derived from. Companion-side re-derivation waits for the link
	 * to travel with the request.
	 */
	readonly buildKey: string;
	readonly outputProfile: ExternalProductionOutputProfile;
};

export type ProductionLinkCancelMessage = {
	readonly kind: "cancel";
	readonly sessionId: string;
	readonly target: ProductionLinkEditorTarget;
	readonly linkId: string;
	readonly requestId: string;
};

export type ProductionLinkStatusMessage = {
	readonly kind: "status";
	readonly sessionId: string;
	readonly target: ProductionLinkEditorTarget;
};

export type ProductionLinkDisconnectMessage = {
	readonly kind: "disconnect";
	readonly sessionId: string;
	readonly target: ProductionLinkEditorTarget;
};

export type ProductionLinkClientMessage =
	| ProductionLinkHelloMessage
	| ProductionLinkBindMessage
	| ProductionLinkInspectMessage
	| ProductionLinkBuildMessage
	| ProductionLinkCancelMessage
	| ProductionLinkStatusMessage
	| ProductionLinkDisconnectMessage;

/* ------------------------------------------------------------------ */
/* Companion -> editor                                                 */
/* ------------------------------------------------------------------ */

export type ProductionLinkHelloAckMessage = {
	readonly kind: "hello-ack";
	readonly protocol: typeof PRODUCTION_LINK_PROTOCOL_VERSION;
	readonly accepted: boolean;
	readonly sessionId?: string;
	readonly adapterVersion?: string;
};

export type ProductionLinkBindAckMessage = {
	readonly kind: "bind-ack";
	readonly sessionId: string;
	readonly target: ProductionLinkEditorTarget;
	readonly linkId: string;
	readonly bindingId: string;
	/** Basename-style label only; `isProductionLinkDisplayName` rejects paths. */
	readonly displayName: string;
};

/**
 * A fresh inspect. The companion re-reads the source every time and never
 * trusts a descriptor the document handed it, so this is the only evidence a
 * build key may be derived from.
 */
export type ProductionLinkInspectResultMessage = {
	readonly kind: "inspect-result";
	readonly sessionId: string;
	readonly target: ProductionLinkEditorTarget;
	readonly linkId: string;
	readonly requestId: string;
	readonly displayName: string;
	readonly sourceDigest: string;
	readonly environment: ProductionLinkEnvironmentReport;
	readonly frame: ProductionLinkFrameReport;
	readonly outputProfile: ExternalProductionOutputProfile;
	readonly controls: readonly PublishedControl[];
	readonly diagnostics: readonly ProductionLinkDiagnostic[];
};

export type ProductionLinkBuildStatusMessage = {
	readonly kind: "build-status";
	readonly sessionId: string;
	readonly target: ProductionLinkEditorTarget;
	readonly linkId: string;
	readonly requestId: string;
	readonly state: ProductionLinkBuildState;
};

/**
 * Delivery metadata only. The bytes travel over a one-time-token HTTP GET on
 * the same loopback origin, so a large artifact never widens this envelope.
 */
export type ProductionLinkBuildResultMessage = {
	readonly kind: "build-result";
	readonly sessionId: string;
	readonly target: ProductionLinkEditorTarget;
	readonly linkId: string;
	readonly requestId: string;
	readonly buildKey: string;
	readonly artifactDigest: string;
	readonly byteLength: number;
	readonly fetchToken: string;
	/** `false` downgrades an exact claim; it is never a build-key input. */
	readonly reproducible: boolean;
	readonly diagnostics: readonly ProductionLinkDiagnostic[];
};

export type ProductionLinkBuildFailedMessage = {
	readonly kind: "build-failed";
	readonly sessionId: string;
	readonly target: ProductionLinkEditorTarget;
	readonly linkId: string;
	readonly requestId: string;
	readonly diagnostics: readonly ProductionLinkDiagnostic[];
};

export type ProductionLinkStatusReportMessage = {
	readonly kind: "status-report";
	readonly sessionId: string;
	readonly bound: boolean;
	readonly linkId?: string;
	readonly busy: boolean;
};

export type ProductionLinkErrorMessage = {
	readonly kind: "error";
	readonly code: typeof PRODUCTION_LINK_ERROR_CODE;
};

export type ProductionLinkServerMessage =
	| ProductionLinkHelloAckMessage
	| ProductionLinkBindAckMessage
	| ProductionLinkInspectResultMessage
	| ProductionLinkBuildStatusMessage
	| ProductionLinkBuildResultMessage
	| ProductionLinkBuildFailedMessage
	| ProductionLinkStatusReportMessage
	| ProductionLinkErrorMessage;

/* ------------------------------------------------------------------ */
/* Guards and parsers                                                  */
/* ------------------------------------------------------------------ */

const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;
const CONTROL_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/iu;
const PROPERTY_NAME_PATTERN = /^[a-z_][a-z0-9_]{0,63}$/iu;
const TOKEN_MIN_LENGTH = 43;
const TOKEN_MAX_LENGTH = 512;
const DISPLAY_NAME_MAX_LENGTH = 128;
const VERSION_TEXT_MAX_LENGTH = 64;
const MAX_VERTICAL_FOV_RADIANS = Math.PI;
const UNSAFE_NAME_CHARACTERS = new Set(["[", "]", '"', "'", "\\", "/"]);
const FIRST_PRINTABLE_CODE_UNIT = 0x20;
const DELETE_CODE_UNIT = 0x7f;
const UTF8_TWO_BYTE_CEILING = 0x7ff;
const SURROGATE_HIGH_START = 0xd800;
const SURROGATE_HIGH_END = 0xdbff;
const SURROGATE_LOW_START = 0xdc00;
const SURROGATE_LOW_END = 0xdfff;

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

export const hasProductionLinkControlCharacter = (value: string): boolean => {
	for (let index = 0; index < value.length; index += 1) {
		const codeUnit = value.charCodeAt(index);
		if (codeUnit < FIRST_PRINTABLE_CODE_UNIT || codeUnit === DELETE_CODE_UNIT) {
			return true;
		}
	}
	return false;
};

const isIdentifier = (value: unknown): value is string =>
	typeof value === "string" && IDENTIFIER_PATTERN.test(value);

const isDigest = (value: unknown): value is string =>
	typeof value === "string" && DIGEST_PATTERN.test(value);

const isBoundedText = (value: unknown, maxLength: number): value is string =>
	typeof value === "string" &&
	value.length > 0 &&
	value.length <= maxLength &&
	value.trim() === value &&
	!hasProductionLinkControlCharacter(value);

/**
 * Rejects anything that reads as a filesystem location. This is the single
 * guard standing between a companion-side path and browser memory.
 */
export const isProductionLinkDisplayName = (
	value: unknown,
): value is string => {
	if (!isBoundedText(value, DISPLAY_NAME_MAX_LENGTH)) return false;
	if (value.startsWith("~") || value.startsWith(".")) return false;
	if (/^[a-z]:[\\/]/iu.test(value)) return false;
	if (/^\w+:/u.test(value)) return false;
	return ![...value].some((character) => UNSAFE_NAME_CHARACTERS.has(character));
};

const isTarget = (value: unknown): value is ProductionLinkEditorTarget =>
	isRecord(value) &&
	hasOnlyKeys(value, ["editorInstanceId", "workingCopyId", "bindingEpoch"]) &&
	isIdentifier(value.editorInstanceId) &&
	isIdentifier(value.workingCopyId) &&
	typeof value.bindingEpoch === "number" &&
	Number.isSafeInteger(value.bindingEpoch) &&
	value.bindingEpoch >= 0;

export const sameProductionLinkTarget = (
	left: ProductionLinkEditorTarget,
	right: ProductionLinkEditorTarget,
): boolean =>
	left.editorInstanceId === right.editorInstanceId &&
	left.workingCopyId === right.workingCopyId &&
	left.bindingEpoch === right.bindingEpoch;

/**
 * Same editor and same working copy, ignoring the binding epoch.
 *
 * The tuple mixes two different things: WHO is talking (editor instance plus
 * working copy) and HOW FRESH their authorization is (binding epoch). Session
 * ownership is the first question only — a session belongs to one editor for
 * its whole life, and no epoch change makes it belong to somebody else.
 */
export const sameProductionLinkTargetOwner = (
	left: ProductionLinkEditorTarget,
	right: ProductionLinkEditorTarget,
): boolean =>
	left.editorInstanceId === right.editorInstanceId &&
	left.workingCopyId === right.workingCopyId;

/**
 * The freshness half of the fence, and the one rule that makes an epoch advance
 * survivable inside a live session.
 *
 * `bindingEpoch` is a monotonically increasing local counter: it moves whenever
 * this editor re-points a link at a different source, unlinks one, or changes
 * cloud identity. Requiring exact equality against the epoch a session PAIRED
 * at made every such advance kill the whole session — and because the pairing
 * token is single use, "kill" meant "restart the companion". Relinking a source
 * is an ordinary authoring act, so that is a defect, not a safety property.
 *
 * Accepting `candidate.bindingEpoch >= held.bindingEpoch` keeps the property
 * the fence actually exists for. A genuinely stale authorization — an in-flight
 * result minted before the advance — carries a strictly LOWER epoch and is
 * still rejected. Only a message minted at or after the current epoch passes,
 * and the holder re-stamps to it, so the fence never moves backwards.
 */
export const productionLinkTargetIsCurrentOrNewer = (
	candidate: ProductionLinkEditorTarget,
	held: ProductionLinkEditorTarget,
): boolean =>
	sameProductionLinkTargetOwner(candidate, held) &&
	candidate.bindingEpoch >= held.bindingEpoch;

const isDiagnosticCode = (
	value: unknown,
): value is ProductionLinkDiagnosticCode =>
	typeof value === "string" &&
	PRODUCTION_LINK_DIAGNOSTIC_CODES.some((code) => code === value);

const isDiagnostic = (value: unknown): value is ProductionLinkDiagnostic =>
	isRecord(value) &&
	hasOnlyKeys(value, ["code"]) &&
	isDiagnosticCode(value.code);

const isDiagnostics = (
	value: unknown,
): value is readonly ProductionLinkDiagnostic[] =>
	Array.isArray(value) &&
	value.length <= PRODUCTION_LINK_MAX_DIAGNOSTICS &&
	value.every(isDiagnostic);

const isOutputProfile = (
	value: unknown,
): value is ExternalProductionOutputProfile =>
	value === "interactive-glb" || value === "rendered-rgba-sequence";

const isBuildState = (value: unknown): value is ProductionLinkBuildState =>
	value === "queued" ||
	value === "inspecting" ||
	value === "exporting" ||
	value === "hashing" ||
	value === "produced" ||
	value === "cancelled" ||
	value === "failed";

const isSafeName = (value: unknown): value is string =>
	isBoundedText(value, DISPLAY_NAME_MAX_LENGTH) &&
	![...value].some((character) => UNSAFE_NAME_CHARACTERS.has(character));

const isControlUnit = (value: unknown): value is PublishedControlUnit =>
	value === "scalar" ||
	value === "degrees" ||
	value === "scene-unit" ||
	value === "frames";

const parseBindingDescriptor = (
	value: unknown,
): AllowlistedBindingDescriptor | null => {
	if (
		!isRecord(value) ||
		!hasOnlyKeys(value, ["kind", "ownerType", "ownerName", "propertyName"])
	) {
		return null;
	}
	if (value.kind !== "custom-property") return null;
	if (value.ownerType !== "OBJECT" && value.ownerType !== "SCENE") return null;
	if (!isSafeName(value.ownerName)) return null;
	if (
		typeof value.propertyName !== "string" ||
		!PROPERTY_NAME_PATTERN.test(value.propertyName)
	) {
		return null;
	}
	return {
		kind: "custom-property",
		ownerType: value.ownerType,
		ownerName: value.ownerName,
		propertyName: value.propertyName,
	};
};

/**
 * Wire-side published control parser. It mirrors `production-link.ts` field for
 * field on purpose: a control that cannot become durable must be rejected at
 * the transport boundary rather than discovered later by the command bus.
 */
const parseWireControl = (value: unknown): PublishedControl | null => {
	if (
		!isRecord(value) ||
		!hasOnlyKeys(
			value,
			[
				"id",
				"label",
				"valueType",
				"unit",
				"defaultValue",
				"rangeDeclared",
				"defaultIsAmbiguous",
				"blenderBinding",
			],
			["min", "max"],
		)
	) {
		return null;
	}
	if (value.valueType !== "number") return null;
	if (typeof value.id !== "string" || !CONTROL_ID_PATTERN.test(value.id)) {
		return null;
	}
	if (!isBoundedText(value.label, DISPLAY_NAME_MAX_LENGTH)) return null;
	if (!isControlUnit(value.unit)) return null;
	if (
		typeof value.defaultValue !== "number" ||
		!Number.isFinite(value.defaultValue)
	) {
		return null;
	}
	if (
		typeof value.rangeDeclared !== "boolean" ||
		typeof value.defaultIsAmbiguous !== "boolean"
	) {
		return null;
	}
	const min = value.min;
	const max = value.max;
	if (min !== undefined && (typeof min !== "number" || !Number.isFinite(min))) {
		return null;
	}
	if (max !== undefined && (typeof max !== "number" || !Number.isFinite(max))) {
		return null;
	}
	if (typeof min === "number" && typeof max === "number" && min > max)
		return null;
	const blenderBinding = parseBindingDescriptor(value.blenderBinding);
	if (!blenderBinding) return null;
	return {
		id: value.id,
		label: value.label,
		valueType: "number",
		unit: value.unit,
		defaultValue: value.defaultValue,
		...(typeof min === "number" ? { min } : {}),
		...(typeof max === "number" ? { max } : {}),
		rangeDeclared: value.rangeDeclared,
		defaultIsAmbiguous: value.defaultIsAmbiguous,
		blenderBinding,
	};
};

const parseWireControls = (
	value: unknown,
): readonly PublishedControl[] | null => {
	if (
		!Array.isArray(value) ||
		value.length > PRODUCTION_LINK_MAX_PUBLISHED_CONTROLS
	) {
		return null;
	}
	const controls: PublishedControl[] = [];
	const seen = new Set<string>();
	for (const candidate of value) {
		const control = parseWireControl(candidate);
		if (!control || seen.has(control.id)) return null;
		seen.add(control.id);
		controls.push(control);
	}
	return controls;
};

const isEnvironmentReport = (
	value: unknown,
): value is ProductionLinkEnvironmentReport =>
	isRecord(value) &&
	hasOnlyKeys(value, [
		"blenderVersion",
		"environmentDigest",
		"renderSettingsDigest",
	]) &&
	isBoundedText(value.blenderVersion, VERSION_TEXT_MAX_LENGTH) &&
	isDigest(value.environmentDigest) &&
	isDigest(value.renderSettingsDigest);

const isFrameReport = (value: unknown): value is ProductionLinkFrameReport =>
	isRecord(value) &&
	hasOnlyKeys(value, ["fps", "durationFrames", "blenderFrameStart"]) &&
	typeof value.fps === "number" &&
	Number.isFinite(value.fps) &&
	value.fps > 0 &&
	typeof value.durationFrames === "number" &&
	Number.isSafeInteger(value.durationFrames) &&
	value.durationFrames > 0 &&
	typeof value.blenderFrameStart === "number" &&
	Number.isSafeInteger(value.blenderFrameStart);

/**
 * A vertical field of view is a strictly positive angle below a half turn.
 * Exported so the companion can validate a camera contract it is asked to
 * honor without duplicating the bound.
 */
export const isProductionLinkVerticalFov = (value: unknown): value is number =>
	typeof value === "number" &&
	Number.isFinite(value) &&
	value > 0 &&
	value < MAX_VERTICAL_FOV_RADIANS;

const utf8ByteLengthIsWithin = (raw: string, maximumBytes: number): boolean => {
	if (raw.length > maximumBytes) return false;
	let bytes = 0;
	for (let index = 0; index < raw.length; index += 1) {
		const code = raw.charCodeAt(index);
		if (code <= DELETE_CODE_UNIT) {
			bytes += 1;
		} else if (code <= UTF8_TWO_BYTE_CEILING) {
			bytes += 2;
		} else if (
			code >= SURROGATE_HIGH_START &&
			code <= SURROGATE_HIGH_END &&
			index + 1 < raw.length &&
			raw.charCodeAt(index + 1) >= SURROGATE_LOW_START &&
			raw.charCodeAt(index + 1) <= SURROGATE_LOW_END
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

type ParseResult<T> =
	| { readonly ok: true; readonly message: T }
	| { readonly ok: false; readonly error: string };

const invalid = <T>(error: string): ParseResult<T> => ({ ok: false, error });

const decodeFrame = (
	raw: string,
): { readonly ok: true; readonly value: Record<string, unknown> } | null => {
	if (!utf8ByteLengthIsWithin(raw, PRODUCTION_LINK_MAX_CONTROL_MESSAGE_BYTES)) {
		return null;
	}
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!isRecord(value) || typeof value.kind !== "string") return null;
	return { ok: true, value };
};

/**
 * Companion-side parser for editor packets. Every accepted request carries the
 * fence tuple; the companion still compares it against the bound target, since
 * a well-formed tuple is a claim, not an authorization.
 */
export const parseProductionLinkClientMessage = (
	raw: string,
): ParseResult<ProductionLinkClientMessage> => {
	const decoded = decodeFrame(raw);
	if (!decoded) return invalid("production link client frame is invalid");
	const value = decoded.value;

	switch (value.kind) {
		case "hello":
			if (
				hasOnlyKeys(value, [
					"kind",
					"protocol",
					"clientId",
					"token",
					"target",
				]) &&
				value.protocol === PRODUCTION_LINK_PROTOCOL_VERSION &&
				isIdentifier(value.clientId) &&
				typeof value.token === "string" &&
				value.token.length >= TOKEN_MIN_LENGTH &&
				value.token.length <= TOKEN_MAX_LENGTH &&
				!hasProductionLinkControlCharacter(value.token) &&
				isTarget(value.target)
			) {
				return {
					ok: true,
					message: {
						kind: "hello",
						protocol: PRODUCTION_LINK_PROTOCOL_VERSION,
						clientId: value.clientId,
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
					"linkId",
					"localPathToken",
				]) &&
				isIdentifier(value.sessionId) &&
				isTarget(value.target) &&
				isIdentifier(value.linkId) &&
				isIdentifier(value.localPathToken)
			) {
				return {
					ok: true,
					message: {
						kind: "bind",
						sessionId: value.sessionId,
						target: value.target,
						linkId: value.linkId,
						localPathToken: value.localPathToken,
					},
				};
			}
			break;
		case "inspect":
			if (
				hasOnlyKeys(value, [
					"kind",
					"sessionId",
					"target",
					"linkId",
					"requestId",
				]) &&
				isIdentifier(value.sessionId) &&
				isTarget(value.target) &&
				isIdentifier(value.linkId) &&
				isIdentifier(value.requestId)
			) {
				return {
					ok: true,
					message: {
						kind: "inspect",
						sessionId: value.sessionId,
						target: value.target,
						linkId: value.linkId,
						requestId: value.requestId,
					},
				};
			}
			break;
		case "build":
			if (
				hasOnlyKeys(value, [
					"kind",
					"sessionId",
					"target",
					"linkId",
					"requestId",
					"buildKey",
					"outputProfile",
				]) &&
				isIdentifier(value.sessionId) &&
				isTarget(value.target) &&
				isIdentifier(value.linkId) &&
				isIdentifier(value.requestId) &&
				isDigest(value.buildKey) &&
				isOutputProfile(value.outputProfile)
			) {
				return {
					ok: true,
					message: {
						kind: "build",
						sessionId: value.sessionId,
						target: value.target,
						linkId: value.linkId,
						requestId: value.requestId,
						buildKey: value.buildKey,
						outputProfile: value.outputProfile,
					},
				};
			}
			break;
		case "cancel":
			if (
				hasOnlyKeys(value, [
					"kind",
					"sessionId",
					"target",
					"linkId",
					"requestId",
				]) &&
				isIdentifier(value.sessionId) &&
				isTarget(value.target) &&
				isIdentifier(value.linkId) &&
				isIdentifier(value.requestId)
			) {
				return {
					ok: true,
					message: {
						kind: "cancel",
						sessionId: value.sessionId,
						target: value.target,
						linkId: value.linkId,
						requestId: value.requestId,
					},
				};
			}
			break;
		case "status":
		case "disconnect":
			if (
				hasOnlyKeys(value, ["kind", "sessionId", "target"]) &&
				isIdentifier(value.sessionId) &&
				isTarget(value.target)
			) {
				return {
					ok: true,
					message: {
						kind: value.kind === "status" ? "status" : "disconnect",
						sessionId: value.sessionId,
						target: value.target,
					},
				};
			}
			break;
		default:
			return invalid("production link client frame kind is unsupported");
	}
	return invalid("production link client frame has an invalid shape");
};

/**
 * Browser-side parser for companion packets. It is the boundary that keeps a
 * compromised or buggy companion from putting a path, an unbounded string, or
 * an unparseable control into the editor.
 */
export const parseProductionLinkServerMessage = (
	raw: string,
): ParseResult<ProductionLinkServerMessage> => {
	const decoded = decodeFrame(raw);
	if (!decoded) return invalid("production link server frame is invalid");
	const value = decoded.value;

	switch (value.kind) {
		case "hello-ack": {
			if (
				!hasOnlyKeys(
					value,
					["kind", "protocol", "accepted"],
					["sessionId", "adapterVersion"],
				) ||
				value.protocol !== PRODUCTION_LINK_PROTOCOL_VERSION ||
				typeof value.accepted !== "boolean"
			) {
				break;
			}
			if (!value.accepted) {
				if (
					value.sessionId !== undefined ||
					value.adapterVersion !== undefined
				) {
					break;
				}
				return {
					ok: true,
					message: {
						kind: "hello-ack",
						protocol: PRODUCTION_LINK_PROTOCOL_VERSION,
						accepted: false,
					},
				};
			}
			if (
				!isIdentifier(value.sessionId) ||
				!isBoundedText(value.adapterVersion, VERSION_TEXT_MAX_LENGTH)
			) {
				break;
			}
			return {
				ok: true,
				message: {
					kind: "hello-ack",
					protocol: PRODUCTION_LINK_PROTOCOL_VERSION,
					accepted: true,
					sessionId: value.sessionId,
					adapterVersion: value.adapterVersion,
				},
			};
		}
		case "bind-ack":
			if (
				hasOnlyKeys(value, [
					"kind",
					"sessionId",
					"target",
					"linkId",
					"bindingId",
					"displayName",
				]) &&
				isIdentifier(value.sessionId) &&
				isTarget(value.target) &&
				isIdentifier(value.linkId) &&
				isIdentifier(value.bindingId) &&
				isProductionLinkDisplayName(value.displayName)
			) {
				return {
					ok: true,
					message: {
						kind: "bind-ack",
						sessionId: value.sessionId,
						target: value.target,
						linkId: value.linkId,
						bindingId: value.bindingId,
						displayName: value.displayName,
					},
				};
			}
			break;
		case "inspect-result": {
			if (
				!hasOnlyKeys(value, [
					"kind",
					"sessionId",
					"target",
					"linkId",
					"requestId",
					"displayName",
					"sourceDigest",
					"environment",
					"frame",
					"outputProfile",
					"controls",
					"diagnostics",
				]) ||
				!isIdentifier(value.sessionId) ||
				!isTarget(value.target) ||
				!isIdentifier(value.linkId) ||
				!isIdentifier(value.requestId) ||
				!isProductionLinkDisplayName(value.displayName) ||
				!isDigest(value.sourceDigest) ||
				!isEnvironmentReport(value.environment) ||
				!isFrameReport(value.frame) ||
				!isOutputProfile(value.outputProfile) ||
				!isDiagnostics(value.diagnostics)
			) {
				break;
			}
			const controls = parseWireControls(value.controls);
			if (!controls) break;
			return {
				ok: true,
				message: {
					kind: "inspect-result",
					sessionId: value.sessionId,
					target: value.target,
					linkId: value.linkId,
					requestId: value.requestId,
					displayName: value.displayName,
					sourceDigest: value.sourceDigest,
					environment: value.environment,
					frame: value.frame,
					outputProfile: value.outputProfile,
					controls,
					diagnostics: value.diagnostics,
				},
			};
		}
		case "build-status":
			if (
				hasOnlyKeys(value, [
					"kind",
					"sessionId",
					"target",
					"linkId",
					"requestId",
					"state",
				]) &&
				isIdentifier(value.sessionId) &&
				isTarget(value.target) &&
				isIdentifier(value.linkId) &&
				isIdentifier(value.requestId) &&
				isBuildState(value.state)
			) {
				return {
					ok: true,
					message: {
						kind: "build-status",
						sessionId: value.sessionId,
						target: value.target,
						linkId: value.linkId,
						requestId: value.requestId,
						state: value.state,
					},
				};
			}
			break;
		case "build-result":
			if (
				hasOnlyKeys(value, [
					"kind",
					"sessionId",
					"target",
					"linkId",
					"requestId",
					"buildKey",
					"artifactDigest",
					"byteLength",
					"fetchToken",
					"reproducible",
					"diagnostics",
				]) &&
				isIdentifier(value.sessionId) &&
				isTarget(value.target) &&
				isIdentifier(value.linkId) &&
				isIdentifier(value.requestId) &&
				isDigest(value.buildKey) &&
				isDigest(value.artifactDigest) &&
				typeof value.byteLength === "number" &&
				Number.isSafeInteger(value.byteLength) &&
				value.byteLength > 0 &&
				value.byteLength <= PRODUCTION_LINK_MAX_ARTIFACT_BYTES &&
				typeof value.fetchToken === "string" &&
				value.fetchToken.length >= TOKEN_MIN_LENGTH &&
				value.fetchToken.length <= TOKEN_MAX_LENGTH &&
				!hasProductionLinkControlCharacter(value.fetchToken) &&
				typeof value.reproducible === "boolean" &&
				isDiagnostics(value.diagnostics)
			) {
				return {
					ok: true,
					message: {
						kind: "build-result",
						sessionId: value.sessionId,
						target: value.target,
						linkId: value.linkId,
						requestId: value.requestId,
						buildKey: value.buildKey,
						artifactDigest: value.artifactDigest,
						byteLength: value.byteLength,
						fetchToken: value.fetchToken,
						reproducible: value.reproducible,
						diagnostics: value.diagnostics,
					},
				};
			}
			break;
		case "build-failed":
			if (
				hasOnlyKeys(value, [
					"kind",
					"sessionId",
					"target",
					"linkId",
					"requestId",
					"diagnostics",
				]) &&
				isIdentifier(value.sessionId) &&
				isTarget(value.target) &&
				isIdentifier(value.linkId) &&
				isIdentifier(value.requestId) &&
				isDiagnostics(value.diagnostics)
			) {
				return {
					ok: true,
					message: {
						kind: "build-failed",
						sessionId: value.sessionId,
						target: value.target,
						linkId: value.linkId,
						requestId: value.requestId,
						diagnostics: value.diagnostics,
					},
				};
			}
			break;
		case "status-report":
			if (
				hasOnlyKeys(
					value,
					["kind", "sessionId", "bound", "busy"],
					["linkId"],
				) &&
				isIdentifier(value.sessionId) &&
				typeof value.bound === "boolean" &&
				typeof value.busy === "boolean" &&
				(value.linkId === undefined || isIdentifier(value.linkId))
			) {
				return {
					ok: true,
					message: {
						kind: "status-report",
						sessionId: value.sessionId,
						bound: value.bound,
						busy: value.busy,
						...(value.linkId === undefined ? {} : { linkId: value.linkId }),
					},
				};
			}
			break;
		case "error":
			if (
				hasOnlyKeys(value, ["kind", "code"]) &&
				value.code === PRODUCTION_LINK_ERROR_CODE
			) {
				return {
					ok: true,
					message: { kind: "error", code: PRODUCTION_LINK_ERROR_CODE },
				};
			}
			break;
		default:
			return invalid("production link server frame kind is unsupported");
	}
	return invalid("production link server frame has an invalid shape");
};

export const encodeProductionLinkMessage = (
	message: ProductionLinkClientMessage | ProductionLinkServerMessage,
): string => JSON.stringify(message);

/**
 * One source the companion's operator has already made available. The token is
 * opaque and companion-minted: the browser can only ever replay a token it was
 * handed, so a page cannot name a filesystem location by constructing one.
 */
export type ProductionLinkSourceOffer = {
	readonly localPathToken: string;
	readonly displayName: string;
};

/**
 * Discovery record served over plain HTTP before any WebSocket upgrade. The
 * companion answers it only for its configured editor origin, so the offered
 * display names are not readable by an arbitrary page that can reach loopback.
 */
export type ProductionLinkDiscoveryRecord = {
	readonly protocol: typeof PRODUCTION_LINK_PROTOCOL_VERSION;
	readonly companionId: string;
	readonly port: number;
	readonly adapterVersion: string;
	readonly startedAt: string;
	readonly sources: readonly ProductionLinkSourceOffer[];
};

const MAX_SOURCE_OFFERS = 64;

const parseSourceOffers = (
	value: unknown,
): readonly ProductionLinkSourceOffer[] | null => {
	if (!Array.isArray(value) || value.length > MAX_SOURCE_OFFERS) return null;
	const offers: ProductionLinkSourceOffer[] = [];
	for (const candidate of value) {
		if (
			!isRecord(candidate) ||
			!hasOnlyKeys(candidate, ["localPathToken", "displayName"]) ||
			!isIdentifier(candidate.localPathToken) ||
			!isProductionLinkDisplayName(candidate.displayName)
		) {
			return null;
		}
		offers.push({
			localPathToken: candidate.localPathToken,
			displayName: candidate.displayName,
		});
	}
	return offers;
};

const MAX_TCP_PORT = 65_535;
const ISO_TIMESTAMP_MAX_LENGTH = 32;

export const parseProductionLinkDiscoveryRecord = (
	value: unknown,
): ProductionLinkDiscoveryRecord | null => {
	if (
		!isRecord(value) ||
		!hasOnlyKeys(value, [
			"protocol",
			"companionId",
			"port",
			"adapterVersion",
			"startedAt",
			"sources",
		]) ||
		value.protocol !== PRODUCTION_LINK_PROTOCOL_VERSION ||
		!isIdentifier(value.companionId) ||
		typeof value.port !== "number" ||
		!Number.isSafeInteger(value.port) ||
		value.port <= 0 ||
		value.port > MAX_TCP_PORT ||
		!isBoundedText(value.adapterVersion, VERSION_TEXT_MAX_LENGTH) ||
		!isBoundedText(value.startedAt, ISO_TIMESTAMP_MAX_LENGTH)
	) {
		return null;
	}
	const sources = parseSourceOffers(value.sources);
	if (!sources) return null;
	return {
		protocol: PRODUCTION_LINK_PROTOCOL_VERSION,
		companionId: value.companionId,
		port: value.port,
		adapterVersion: value.adapterVersion,
		startedAt: value.startedAt,
		sources,
	};
};
