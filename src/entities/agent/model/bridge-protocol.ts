import type { SceneCameraAuthoringSelection } from "@/entities/scene/model/scene-camera-authoring";
import type {
	AgentPreviewCaptureRequest,
	AgentPreviewCaptureResult,
	AgentPreviewObservation,
} from "./preview-capture";
import type {
	AgentCommandPlanRequest,
	AgentCommandPlanResult,
	AgentLiveDocumentObservation,
} from "./types";

/**
 * Wire protocol for the local agent ⇄ live-editor bridge (Stage 5). The bridge
 * relays approval-gated edit plans from a headless MCP server to the running
 * editor tab, which applies them through the same command bus a human uses.
 *
 * This module is intentionally transport-free and zod-free: it is shared by the
 * browser hook and the Bun relay/MCP scripts, so it mirrors the POJO + hand
 * rolled guard discipline of `contracts.ts` rather than pulling a schema library
 * into the client bundle. Envelope integrity is checked here; semantic command
 * validation stays in `review-apply.ts`.
 */
export const AGENT_BRIDGE_PROTOCOL_VERSION = 7;

export type AgentBridgeRole = "agent" | "editor";

/**
 * `"observe"` is target-fenced and read-only, like `"validate"`, but returns
 * an {@link AgentBridgeObserveResult} instead of an edit-plan review — it never
 * compiles or reviews commands, so it cannot share the plan request/result
 * shape. See B2 in
 * `docs/gravity-parent-child-study-01-live-mcp-resolution-boundary.md`.
 *
 * `"preview-observe"` and `"preview-capture"` are the Phase D native artboard
 * capture ops: both read-only (no command bus, no undo, no autosave).
 * `"preview-observe"` is a stateless readiness read; `"preview-capture"` drives
 * a begin -> per-frame capture -> end session that renders committed stills.
 * Neither prompts for approval. Unlike the plan/observe ops, the two new ops
 * REQUIRE `workingCopyId` and `bindingEpoch` on the request target (enforced in
 * `features/agent/model/editor-bridge.ts`), since a capture is fenced to one
 * exact live editor working copy.
 */
export type AgentBridgeOp =
	| "validate"
	| "apply"
	| "save-project"
	| "observe"
	| "preview-observe"
	| "preview-capture";

export type AgentBridgeProjectSaveMode =
	| "save"
	| "save-as-new"
	| "save-as-copy";

/**
 * Agent request to persist the live editor document through the app's existing
 * cloud-project save path. The bridge carries only user intent and naming
 * options; the editor remains the source of truth for scene/motion/grammar
 * payloads and active cloud-project identity.
 */
export type AgentBridgeProjectSaveRequest = {
	readonly intent?: string;
	readonly mode?: AgentBridgeProjectSaveMode;
	readonly name?: string;
};

export type AgentBridgeProjectSaveSummary = {
	readonly id: string;
	readonly name: string;
	readonly revision: number;
	readonly updatedAt: string;
	readonly contentHash: string | null;
};

export type AgentBridgeProjectSaveStatus =
	| "saved"
	| "already-saved"
	| "rejected"
	| "busy"
	| "conflict"
	| "unauthenticated"
	| "upgrade-required"
	| "too-large"
	| "quota-exceeded"
	| "not-found"
	| "invalid"
	| "failed";

export type AgentBridgeProjectSaveResult = {
	readonly contractVersion: 1;
	readonly ok: boolean;
	readonly op: "save-project";
	readonly mode: AgentBridgeProjectSaveMode;
	readonly status: AgentBridgeProjectSaveStatus;
	readonly message: string;
	readonly changed: boolean;
	readonly project?: AgentBridgeProjectSaveSummary;
	readonly conflictProject?: AgentBridgeProjectSaveSummary;
};

/** Agent request for the read-only live-document observation. No parameters today. */
export type AgentBridgeObserveRequest = Record<string, never>;

/**
 * Live pre-mutation proof (B2): the observation payload plus the same
 * live-selection stamp `withLiveSelection` adds to a plan result — see
 * {@link AgentLiveDocumentObservation} for what it contains and why it exists.
 * `op` distinguishes it from {@link AgentCommandPlanResult} at the response
 * boundary the same way `AgentBridgeProjectSaveResult.op` does.
 */
export type AgentBridgeObserveResult = AgentLiveDocumentObservation & {
	readonly op: "observe";
	readonly selectedNodeIds?: readonly string[];
	readonly selectedArtboardId?: string | null;
	readonly selectedSceneCamera?: SceneCameraAuthoringSelection | null;
	readonly currentArtboardId?: string;
	readonly currentFrame?: number;
};

/** Agent request for the stateless capture-readiness read. No parameters today. */
export type AgentBridgePreviewObserveRequest = Record<string, never>;

/**
 * Read-only capture-readiness snapshot (`preview-observe`). Wraps the pure
 * {@link AgentPreviewObservation} with the `op` discriminant the response
 * boundary narrows on, exactly like {@link AgentBridgeObserveResult}.
 */
export type AgentBridgePreviewObserveResult = AgentPreviewObservation & {
	readonly op: "preview-observe";
};

/**
 * One step of the stateful capture packet (`preview-capture`): begin, capture a
 * single frame, or end. The domain shape lives in `preview-capture.ts` so the
 * widget engine and the scripts share it without importing this transport module.
 */
export type AgentBridgePreviewCaptureRequest = AgentPreviewCaptureRequest;

/**
 * Result of one capture step (`preview-capture`). Carries at most ONE base64 PNG
 * (inside `AgentPreviewCaptureFrameResult.frame`), so a single envelope stays
 * under the relay's default max payload. Wraps {@link AgentPreviewCaptureResult}
 * with the `op` discriminant.
 */
export type AgentBridgePreviewCaptureResult = AgentPreviewCaptureResult & {
	readonly op: "preview-capture";
};

export type AgentBridgeResponseResult =
	| AgentCommandPlanResult
	| AgentBridgeProjectSaveResult
	| AgentBridgeObserveResult
	| AgentBridgePreviewObserveResult
	| AgentBridgePreviewCaptureResult;

export type AgentBridgeEditorDescriptor = {
	readonly editorInstanceId: string;
	readonly workingCopyId: string;
	readonly projectId: string | null;
	readonly bindingEpoch: number;
	readonly documentName?: string;
};

export type AgentBridgeRequestTarget = {
	readonly editorInstanceId: string;
	readonly workingCopyId?: string;
	readonly projectId?: string | null;
	readonly bindingEpoch?: number;
};

/** Client → relay handshake. `token` is required for the `agent` role only. */
export type AgentBridgeHelloMessage = {
	readonly kind: "hello";
	readonly protocol: number;
	readonly role: AgentBridgeRole;
	readonly clientId: string;
	readonly token?: string;
	readonly editor?: AgentBridgeEditorDescriptor;
};

/** Relay → client handshake result. */
export type AgentBridgeHelloAckMessage = {
	readonly kind: "hello-ack";
	readonly protocol: number;
	readonly accepted: boolean;
	readonly sessionId?: string;
	readonly editorConnected?: boolean;
	readonly editors?: readonly AgentBridgeEditorDescriptor[];
	readonly reason?: string;
};

/**
 * Agent → editor (routed by relay). The agent never grants approval; it only
 * proposes a plan. The editor's human grants approval before any mutation.
 */
export type AgentBridgeRequestMessage = {
	readonly kind: "request";
	readonly id: string;
	readonly target?: AgentBridgeRequestTarget;
} & (
	| {
			readonly op: "validate" | "apply";
			readonly request: AgentCommandPlanRequest;
	  }
	| {
			readonly op: "save-project";
			readonly request: AgentBridgeProjectSaveRequest;
	  }
	| {
			readonly op: "observe";
			readonly request: AgentBridgeObserveRequest;
	  }
	| {
			readonly op: "preview-observe";
			readonly request: AgentBridgePreviewObserveRequest;
	  }
	| {
			readonly op: "preview-capture";
			readonly request: AgentBridgePreviewCaptureRequest;
	  }
);

/** Editor → agent (routed by relay). */
export type AgentBridgeResponseMessage = {
	readonly kind: "response";
	readonly id: string;
	readonly result: AgentBridgeResponseResult;
};

export type AgentBridgeErrorMessage = {
	readonly kind: "error";
	readonly id?: string;
	readonly code: string;
	readonly message: string;
};

/** Relay → agent: the live editor connected or disconnected. */
export type AgentBridgeEditorStatusMessage = {
	readonly kind: "editor-status";
	readonly editorConnected: boolean;
	readonly editors?: readonly AgentBridgeEditorDescriptor[];
};

/** Editor → relay identity refresh after a cloud-project rebind. */
export type AgentBridgeEditorDescriptorMessage = {
	readonly kind: "editor-descriptor";
	readonly editor: AgentBridgeEditorDescriptor;
};

export type AgentBridgeMessage =
	| AgentBridgeHelloMessage
	| AgentBridgeHelloAckMessage
	| AgentBridgeRequestMessage
	| AgentBridgeResponseMessage
	| AgentBridgeErrorMessage
	| AgentBridgeEditorStatusMessage
	| AgentBridgeEditorDescriptorMessage;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const isString = (value: unknown): value is string => typeof value === "string";

const isBoolean = (value: unknown): value is boolean =>
	typeof value === "boolean";

const isBridgeRole = (value: unknown): value is AgentBridgeRole =>
	value === "agent" || value === "editor";

const isBridgeOp = (value: unknown): value is AgentBridgeOp =>
	value === "validate" ||
	value === "apply" ||
	value === "save-project" ||
	value === "observe" ||
	value === "preview-observe" ||
	value === "preview-capture";

const isEditorDescriptor = (
	value: unknown,
): value is AgentBridgeEditorDescriptor =>
	isRecord(value) &&
	isString(value.editorInstanceId) &&
	isString(value.workingCopyId) &&
	(value.projectId === null || isString(value.projectId)) &&
	typeof value.bindingEpoch === "number" &&
	Number.isInteger(value.bindingEpoch) &&
	(value.documentName === undefined || isString(value.documentName));

const isRequestTarget = (value: unknown): value is AgentBridgeRequestTarget =>
	isRecord(value) &&
	isString(value.editorInstanceId) &&
	(value.workingCopyId === undefined || isString(value.workingCopyId)) &&
	(value.projectId === undefined ||
		value.projectId === null ||
		isString(value.projectId)) &&
	(value.bindingEpoch === undefined ||
		(typeof value.bindingEpoch === "number" &&
			Number.isInteger(value.bindingEpoch)));

const isProjectSaveMode = (
	value: unknown,
): value is AgentBridgeProjectSaveMode =>
	value === "save" || value === "save-as-new" || value === "save-as-copy";

/**
 * Shallow envelope guard. Command-level validity is the editor's job via
 * `review-apply.ts`; here we only confirm the request carries a plan identity
 * and command arrays of the right kind.
 */
const isPlanRequestShape = (
	value: unknown,
): value is AgentCommandPlanRequest => {
	if (!isRecord(value)) return false;
	if (!isString(value.planId) || value.planId.length === 0) return false;
	if (!isString(value.intent)) return false;
	if (
		value.documentCommands !== undefined &&
		!Array.isArray(value.documentCommands)
	) {
		return false;
	}
	if (
		value.sceneCommands !== undefined &&
		!Array.isArray(value.sceneCommands)
	) {
		return false;
	}
	if (
		value.motionCommands !== undefined &&
		!Array.isArray(value.motionCommands)
	) {
		return false;
	}
	if (
		value.motionGrammarCommands !== undefined &&
		!Array.isArray(value.motionGrammarCommands)
	) {
		return false;
	}
	return true;
};

const isProjectSaveRequestShape = (
	value: unknown,
): value is AgentBridgeProjectSaveRequest => {
	if (!isRecord(value)) return false;
	if (value.intent !== undefined && !isString(value.intent)) return false;
	if (value.mode !== undefined && !isProjectSaveMode(value.mode)) return false;
	if (value.name !== undefined && !isString(value.name)) return false;
	return true;
};

/** `AgentBridgeObserveRequest` carries no fields today; any record is valid. */
const isObserveRequestShape = (
	value: unknown,
): value is AgentBridgeObserveRequest => isRecord(value);

/** `AgentBridgePreviewObserveRequest` carries no fields today. */
const isPreviewObserveRequestShape = (
	value: unknown,
): value is AgentBridgePreviewObserveRequest => isRecord(value);

/**
 * Shallow guard for a `preview-capture` step: confirms a known `action` and,
 * when present, well-typed `sessionId`/`frame`. The capability enforces the
 * per-action requirements (a `capture` needs `sessionId` + an in-range integer
 * `frame`) and rejects with a typed status rather than dropping the request here.
 */
const isPreviewCaptureRequestShape = (
	value: unknown,
): value is AgentBridgePreviewCaptureRequest =>
	isRecord(value) &&
	(value.action === "begin" ||
		value.action === "capture" ||
		value.action === "end") &&
	(value.sessionId === undefined || isString(value.sessionId)) &&
	(value.frame === undefined || typeof value.frame === "number");

const isProjectSaveSummaryShape = (
	value: unknown,
): value is AgentBridgeProjectSaveSummary =>
	isRecord(value) &&
	isString(value.id) &&
	isString(value.name) &&
	typeof value.revision === "number" &&
	Number.isInteger(value.revision) &&
	isString(value.updatedAt) &&
	(value.contentHash === null || isString(value.contentHash));

const isProjectSaveStatus = (
	value: unknown,
): value is AgentBridgeProjectSaveStatus =>
	value === "saved" ||
	value === "already-saved" ||
	value === "rejected" ||
	value === "busy" ||
	value === "conflict" ||
	value === "unauthenticated" ||
	value === "upgrade-required" ||
	value === "too-large" ||
	value === "quota-exceeded" ||
	value === "not-found" ||
	value === "invalid" ||
	value === "failed";

const isResultShape = (value: unknown): value is AgentCommandPlanResult =>
	isRecord(value) && isString(value.planId) && isRecord(value.plan);

const isProjectSaveResultShape = (
	value: unknown,
): value is AgentBridgeProjectSaveResult =>
	isRecord(value) &&
	value.op === "save-project" &&
	typeof value.ok === "boolean" &&
	isProjectSaveMode(value.mode) &&
	isProjectSaveStatus(value.status) &&
	isString(value.message) &&
	typeof value.changed === "boolean" &&
	(value.project === undefined || isProjectSaveSummaryShape(value.project)) &&
	(value.conflictProject === undefined ||
		isProjectSaveSummaryShape(value.conflictProject));

/**
 * Shallow guard for {@link AgentBridgeObserveResult}: confirms the `"observe"`
 * discriminant and every top-level required section is present, without
 * descending into their fields — the same envelope-only depth as
 * `isPlanRequestShape`/`isProjectSaveResultShape` above.
 */
const isObserveResultShape = (
	value: unknown,
): value is AgentBridgeObserveResult =>
	isRecord(value) &&
	value.op === "observe" &&
	isRecord(value.identity) &&
	isRecord(value.artboard) &&
	isRecord(value.motionDocument) &&
	isRecord(value.motionInventory) &&
	Array.isArray(value.nodes) &&
	Array.isArray(value.scopedLookOverlays);

/**
 * Shallow guard for {@link AgentBridgePreviewObserveResult}: the
 * `"preview-observe"` discriminant plus the top-level required sections, without
 * descending into their fields — the same envelope-only depth as
 * `isObserveResultShape`.
 */
const isPreviewObserveResultShape = (
	value: unknown,
): value is AgentBridgePreviewObserveResult =>
	isRecord(value) &&
	value.op === "preview-observe" &&
	isRecord(value.identity) &&
	isRecord(value.presentation) &&
	isRecord(value.artboard) &&
	Array.isArray(value.notReadyReasons);

/**
 * Shallow guard for {@link AgentBridgePreviewCaptureResult}: the
 * `"preview-capture"` discriminant plus the `action`/`status` string
 * discriminants every step result carries. The per-frame `frame` packet (the
 * base64 PNG) is not descended into here — the capability builds it.
 */
const isPreviewCaptureResultShape = (
	value: unknown,
): value is AgentBridgePreviewCaptureResult =>
	isRecord(value) &&
	value.op === "preview-capture" &&
	isString(value.action) &&
	isString(value.status);

const isResponseResultShape = (
	value: unknown,
): value is AgentBridgeResponseResult =>
	isResultShape(value) ||
	isProjectSaveResultShape(value) ||
	isObserveResultShape(value) ||
	isPreviewObserveResultShape(value) ||
	isPreviewCaptureResultShape(value);

/** Narrows an unknown value to a transport message without trusting the wire. */
export const isAgentBridgeMessage = (
	value: unknown,
): value is AgentBridgeMessage => {
	if (!isRecord(value) || !isString(value.kind)) return false;
	switch (value.kind) {
		case "hello":
			return (
				isBridgeRole(value.role) &&
				isString(value.clientId) &&
				(value.token === undefined || isString(value.token)) &&
				(value.editor === undefined || isEditorDescriptor(value.editor))
			);
		case "hello-ack":
			return (
				isBoolean(value.accepted) &&
				(value.editors === undefined ||
					(Array.isArray(value.editors) &&
						value.editors.every(isEditorDescriptor)))
			);
		case "request":
			if (
				!isString(value.id) ||
				!isBridgeOp(value.op) ||
				(value.target !== undefined && !isRequestTarget(value.target))
			) {
				return false;
			}
			if (value.op === "save-project") {
				return isProjectSaveRequestShape(value.request);
			}
			if (value.op === "observe") {
				return isObserveRequestShape(value.request);
			}
			if (value.op === "preview-observe") {
				return isPreviewObserveRequestShape(value.request);
			}
			if (value.op === "preview-capture") {
				return isPreviewCaptureRequestShape(value.request);
			}
			return isPlanRequestShape(value.request);
		case "response":
			return isString(value.id) && isResponseResultShape(value.result);
		case "error":
			return isString(value.code) && isString(value.message);
		case "editor-status":
			return (
				isBoolean(value.editorConnected) &&
				(value.editors === undefined ||
					(Array.isArray(value.editors) &&
						value.editors.every(isEditorDescriptor)))
			);
		case "editor-descriptor":
			return isEditorDescriptor(value.editor);
		default:
			return false;
	}
};

export const encodeAgentBridgeMessage = (message: AgentBridgeMessage): string =>
	JSON.stringify(message);

export type AgentBridgeParseResult =
	| { readonly ok: true; readonly message: AgentBridgeMessage }
	| { readonly ok: false; readonly error: string };

/** Parses a raw frame into a message without throwing. */
export const parseAgentBridgeMessage = (
	raw: string,
): AgentBridgeParseResult => {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, error: `invalid json: ${message}` };
	}
	if (!isAgentBridgeMessage(value)) {
		return { ok: false, error: "unrecognized bridge message shape" };
	}
	return { ok: true, message: value };
};

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Origin allowlist for the editor (browser) leg. The relay binds loopback only,
 * but a forged web page could still attempt a cross-site WebSocket connection,
 * so editor connections must originate from a local dev origin (CSWSH / DNS
 * rebind guard). The agent leg has no `Origin` header and is gated by token.
 */
export const isLocalBridgeOrigin = (
	origin: string | null | undefined,
): boolean => {
	if (!origin) return false;
	try {
		const url = new URL(origin);
		if (url.protocol !== "http:" && url.protocol !== "https:") return false;
		return LOCAL_HOSTNAMES.has(url.hostname);
	} catch {
		return false;
	}
};
