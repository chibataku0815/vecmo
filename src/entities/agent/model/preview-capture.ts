import type {
	AgentLiveArtboardSummary,
	AgentLiveDocumentIdentity,
} from "./types";

/**
 * Transport-safe types for the read-only, target-fenced native artboard capture
 * capability (Phase D). An agent asks the live editor to render committed
 * artboard stills without mutating the document: no command-bus write, no undo
 * entry, no autosave. These types are the seam between the WIDGET that owns the
 * capture engine (`widgets/canvas-shell/model/agent-preview-capture.ts`, which
 * may touch the transport store and the export raster path) and
 * `features/agent`, which only forwards the injected capability over the bridge.
 * This module imports no widget, feature, or store code so it can be shared by
 * the browser hook and the Bun relay/MCP scripts, mirroring `bridge-protocol.ts`.
 *
 * `contractVersion` is the literal {@link AgentLiveDocumentIdentity}-era agent
 * contract version (`AGENT_CONTRACT_VERSION`, currently `1`); it is written as
 * the literal here to avoid a value import into this type-only module.
 */

/**
 * Target identity a capture packet is fenced to — the same editor-instance,
 * working-copy, and binding-epoch triple the bridge request target carries, so
 * an agent can prove which live editor produced a given still. `projectId` and
 * `documentName` round out the human-facing identity. This is
 * {@link AgentLiveDocumentIdentity} plus the `editorInstanceId` the bridge uses
 * for routing.
 */
export type AgentPreviewCaptureTargetIdentity = AgentLiveDocumentIdentity & {
	readonly editorInstanceId: string;
};

/**
 * Transient playback state captured the moment a capture session begins (and
 * re-read at each committed frame), proving the still was rendered against a
 * paused, non-interactive transport. Mirrors the transport store's
 * `TransportState` playback fields the session must restore on end; kept as
 * plain data so this entity module never imports the feature transport store.
 */
export type AgentPreviewPresentationState = {
	readonly currentFrame: number;
	readonly isPlaying: boolean;
	readonly interactionPreview: boolean;
	readonly performing: boolean;
	readonly recording: boolean;
	readonly loop: boolean;
};

/**
 * Read-only snapshot of a live editor's capture readiness (bridge op
 * `"preview-observe"`). Stateless: it opens no capture session and pauses
 * nothing. It reports the current transport, the current artboard's timing (so
 * an agent can choose valid frames before it captures), and whether a committed
 * still could be rendered right now. `captureReady` is false while the transport
 * is playing (the only presentation gate) or when no capturable artboard or
 * browser renderer is available; `notReadyReasons` explains why.
 * `activeSessionId` is the id of an in-flight capture session, or `null`.
 */
export type AgentPreviewObservation = {
	readonly contractVersion: 1;
	readonly identity: AgentPreviewCaptureTargetIdentity;
	readonly presentation: AgentPreviewPresentationState;
	readonly artboard: AgentLiveArtboardSummary;
	readonly activeSessionId: string | null;
	readonly rendererSource: string;
	readonly captureReady: boolean;
	readonly notReadyReasons: readonly string[];
};

export type AgentPreviewCaptureAction = "begin" | "capture" | "end";

/**
 * One step of the stateful capture packet (bridge op `"preview-capture"`).
 * `begin` opens a session and pauses playback, `capture` renders one committed
 * still for `frame`, `end` restores playback and closes the session. The
 * begin -> per-frame capture -> end loop is driven CLIENT-side (the MCP
 * toolkit), so one bridge envelope ever carries at most one PNG.
 */
export type AgentPreviewCaptureRequest = {
	readonly action: AgentPreviewCaptureAction;
	/** Required for `capture` and `end`; ignored for `begin`. */
	readonly sessionId?: string;
	/** Zero-based frame to render; required for `capture`. */
	readonly frame?: number;
};

/**
 * Per-frame provenance for one committed artboard still — everything an agent
 * needs to trust the pixels EXCEPT the pixels. `requestedFrame === sampledFrame`
 * is structural (the frame is an explicit sample argument), reported for
 * honesty rather than derived from any React/DOM state. `sha256` is the hex
 * SHA-256 of the PNG bytes, `colorSpace` notes the canvas color space, and
 * `issues` carries any renderer issue codes. This is the half of a packet the
 * MCP tool result returns to the model — never the bytes.
 */
export type AgentCaptureFrameMetadata = {
	readonly editorInstanceId: string;
	readonly workingCopyId: string;
	readonly bindingEpoch: number;
	readonly requestedFrame: number;
	readonly sampledFrame: number;
	readonly presentation: AgentPreviewPresentationState;
	readonly width: number;
	readonly height: number;
	readonly pixelRatio: number;
	readonly scale: number;
	readonly colorSpace: string;
	readonly sha256: string;
	readonly rendererSource: string;
	readonly issues: readonly string[];
};

/**
 * A metadata row plus the base64-encoded PNG bytes. The bytes cross ONLY the
 * WebSocket bridge (relay default max payload is 16MB, so at most one packet per
 * envelope) and are written to disk by the toolkit; they are never returned into
 * the model context. Keeping bytes on a separate type from
 * {@link AgentCaptureFrameMetadata} makes returning them to the model
 * structurally awkward, which is the point.
 */
export type AgentCaptureFramePacket = AgentCaptureFrameMetadata & {
	readonly pngBase64: string;
};

/**
 * Result of a `begin` step. On `"begun"` every session field is present; on
 * `"unavailable"` the editor could not open a session (no capturable artboard,
 * or no browser canvas renderer) and `message` explains why. Beginning always
 * first restores any prior in-flight session, so there is no "busy" state.
 */
export type AgentPreviewCaptureBeginResult = {
	readonly action: "begin";
	readonly ok: boolean;
	readonly status: "begun" | "unavailable";
	readonly message: string;
	readonly rendererSource: string;
	readonly sessionId?: string;
	readonly identity?: AgentPreviewCaptureTargetIdentity;
	readonly artboard?: AgentLiveArtboardSummary;
	/** Transport state AFTER the session paused playback. */
	readonly presentation?: AgentPreviewPresentationState;
	/** Stable hash of the frozen scene/motion/grammar the session renders. */
	readonly sourceHash?: string;
	/** `durationFrames` of the frozen motion document, so the client can bound frames. */
	readonly durationFrames?: number;
};

/**
 * `frame-out-of-range` is a non-terminal REJECT: the session stays open so the
 * agent can retry with a valid frame (the frame is never silently clamped).
 * `drift` (scene/motion/grammar hash changed), `epoch-mismatch` (the editor
 * rebound projects), `renderer-inactive` (no browser canvas runtime), and
 * `gpu-uncommitted` (the still could not be committed after the built-in retry)
 * are terminal: each restores the transport and closes the session (`restored`
 * is `true`). `session-not-found` means the id does not match the open session
 * (a fail-closed error after an auto-restore).
 */
export type AgentPreviewCaptureFrameStatus =
	| "captured"
	| "frame-out-of-range"
	| "session-not-found"
	| "drift"
	| "epoch-mismatch"
	| "renderer-inactive"
	| "gpu-uncommitted"
	| "capture-failed";

export type AgentPreviewCaptureFrameResult = {
	readonly action: "capture";
	readonly ok: boolean;
	readonly status: AgentPreviewCaptureFrameStatus;
	readonly message: string;
	/** Present only when `status === "captured"`. */
	readonly frame?: AgentCaptureFramePacket;
	/** Echoed on `frame-out-of-range` so the caller sees the valid bound. */
	readonly requestedFrame?: number;
	readonly durationFrames?: number;
	/** `true` when this failure restored the transport and closed the session. */
	readonly restored?: boolean;
};

/**
 * Result of an `end` step. `session-not-found` is not an error condition —
 * ending an already-closed session (e.g. after a terminal capture failure
 * auto-restored it) is idempotent, so the toolkit's `finally` can always call
 * `end` without a fail-closed error.
 */
export type AgentPreviewCaptureEndResult = {
	readonly action: "end";
	readonly ok: boolean;
	readonly status: "ended" | "session-not-found";
	readonly message: string;
	readonly restored: boolean;
	readonly capturedFrameCount?: number;
};

export type AgentPreviewCaptureResult =
	| AgentPreviewCaptureBeginResult
	| AgentPreviewCaptureFrameResult
	| AgentPreviewCaptureEndResult;

/**
 * The narrowly-typed functions the widget capture engine exposes and the app
 * injects into the editor bridge. `features/agent` calls these but never
 * imports the widget that implements them (nor the transport/export code they
 * reach into). `observePreview` is a synchronous read; `capture` renders and so
 * is async; `abandonActiveSession` is the editor's restore hook for a WebSocket
 * close or an inactivity watchdog.
 */
export type AgentPreviewCaptureCapability = {
	readonly observePreview: () => AgentPreviewObservation;
	readonly capture: (
		request: AgentPreviewCaptureRequest,
	) => Promise<AgentPreviewCaptureResult>;
	readonly abandonActiveSession: (reason: string) => void;
};
