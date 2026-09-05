import type {
	AgentCaptureFramePacket,
	AgentPreviewCaptureBeginResult,
	AgentPreviewCaptureCapability,
	AgentPreviewCaptureEndResult,
	AgentPreviewCaptureFrameResult,
	AgentPreviewCaptureFrameStatus,
	AgentPreviewCaptureRequest,
	AgentPreviewCaptureTargetIdentity,
	AgentPreviewObservation,
	AgentPreviewPresentationState,
} from "@/entities/agent/model/preview-capture";
import type { AgentLiveArtboardSummary } from "@/entities/agent/model/types";
import { getEditorSessionDescriptor } from "@/entities/editor-session/model/session";
import { cloneMotionDocument } from "@/entities/motion/model/seed-motion";
import { useMotionStore } from "@/entities/motion/model/store";
import type { MotionDocument } from "@/entities/motion/model/types";
import { useMotionGrammarStore } from "@/entities/motion-grammar/model/store";
import type { MotionGrammarBinding } from "@/entities/motion-grammar/model/types";
import { cloneSceneDocument } from "@/entities/scene/model/factory";
import { selectCurrentArtboard } from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import type { SceneDocument } from "@/entities/scene/model/types";
import { linkedProductionResolverForScene } from "@/features/blender-link/model/workflow";
import { captureRasterStillFrame } from "@/features/export/adapters/video";
import { scopeSceneToArtboard } from "@/features/export/model/artboards";
import {
	type TransportState,
	useTransportStore,
} from "@/features/motion/model/transport-store";
import { stableHashValue } from "@/shared/cache";

/**
 * Read-only, target-fenced native artboard capture engine (Phase D). This is
 * the WIDGET-owned implementation of {@link AgentPreviewCaptureCapability}: it
 * may reach into the export raster path (`captureRasterStillFrame`) and the
 * feature transport store, which entities and `features/agent` must not do, so
 * the app injects the built capability into the editor bridge and
 * `features/agent` only forwards the request. See `docs/architecture.md`
 * (downward import graph) and the spec seam constraint.
 *
 * The engine renders committed stills off a FROZEN clone of the live document
 * (never the mounted DOM canvas — scoped Deep Glow lives on a separate WebGL
 * canvas and selection chrome would contaminate a DOM read), scoped to the
 * current artboard. It writes nothing durable: no command-bus call, no undo
 * entry, no autosave/cloud save. The only live-store touch is a transient
 * transport pause/restore, which is transient playback state, not document
 * state.
 */

const RENDERER_SOURCE = "vecmo-svg-gpu-still";
/** Renders at artboard CSS pixels; the still path uses no device-pixel upscale. */
const CAPTURE_PIXEL_RATIO = 1;
const CAPTURE_SCALE = 1;
/** The 2D canvas the still path draws into is sRGB. */
const CAPTURE_COLOR_SPACE = "srgb";
/**
 * If neither a `capture` nor an `end` arrives within this window, the editor
 * auto-restores playback and closes the session so a crashed or disconnected
 * agent never strands the transport paused. Any `capture`/`begin` resets it.
 */
const CAPTURE_INACTIVITY_TIMEOUT_MS = 45_000;

/** Full transport state read verbatim so the session can restore it exactly. */
const transportStateSnapshot = (): TransportState => {
	const transport = useTransportStore.getState();
	return {
		currentFrame: transport.currentFrame,
		isPlaying: transport.isPlaying,
		loop: transport.loop,
		recording: transport.recording,
		interactionPreview: transport.interactionPreview,
		preInteractionPreviewFrame: transport.preInteractionPreviewFrame,
		performing: transport.performing,
	};
};

/** The presentation-relevant subset of transport, for capture provenance. */
const presentationSnapshot = (): AgentPreviewPresentationState => {
	const transport = useTransportStore.getState();
	return {
		currentFrame: transport.currentFrame,
		isPlaying: transport.isPlaying,
		interactionPreview: transport.interactionPreview,
		performing: transport.performing,
		recording: transport.recording,
		loop: transport.loop,
	};
};

const currentIdentity = (): AgentPreviewCaptureTargetIdentity => {
	const descriptor = getEditorSessionDescriptor();
	return {
		editorInstanceId: descriptor.editorInstanceId,
		workingCopyId: descriptor.workingCopyId,
		projectId: descriptor.projectId,
		bindingEpoch: descriptor.bindingEpoch,
		documentName: useSceneStore.getState().document.name,
	};
};

const currentArtboardSummary = (): AgentLiveArtboardSummary => {
	const artboard = selectCurrentArtboard(useSceneStore.getState().document);
	return {
		id: artboard.id,
		name: artboard.name,
		width: artboard.width,
		height: artboard.height,
		fps: artboard.fps,
		durationFrames: artboard.durationFrames,
		background: artboard.background,
	};
};

/**
 * Single stable hash of the live scene/motion/grammar triple. Frozen at
 * `begin`, re-read at each `capture`; any change is drift, and a drifted
 * capture would misrepresent the live document.
 */
const liveDocumentHash = (): string =>
	stableHashValue({
		scene: useSceneStore.getState().document,
		motion: useMotionStore.getState().document,
		grammar: useMotionGrammarStore.getState().document,
	});

const blobToBase64 = async (blob: Blob): Promise<string> => {
	const bytes = new Uint8Array(await blob.arrayBuffer());
	let binary = "";
	const chunkSize = 0x8000;
	for (let offset = 0; offset < bytes.length; offset += chunkSize) {
		binary += String.fromCharCode(
			...bytes.subarray(offset, offset + chunkSize),
		);
	}
	return btoa(binary);
};

const sha256Hex = async (blob: Blob): Promise<string> => {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		await blob.arrayBuffer(),
	);
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
};

/**
 * Classifies a `captureRasterStillFrame` throw into a terminal frame status.
 * The still path throws a browser-runtime message when no canvas is available,
 * and a blank/GPU message when the committed frame could not be produced after
 * its built-in retry; anything else is an honest generic capture failure.
 */
const classifyCaptureFailure = (
	message: string,
): AgentPreviewCaptureFrameStatus => {
	if (/browser canvas runtime|cannot create a still canvas/i.test(message)) {
		return "renderer-inactive";
	}
	if (/blank|committed still frame|gpu|context/i.test(message)) {
		return "gpu-uncommitted";
	}
	return "capture-failed";
};

type CaptureSession = {
	readonly sessionId: string;
	readonly identity: AgentPreviewCaptureTargetIdentity;
	/** Frozen, artboard-scoped clone the stills are rendered from. */
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly grammarBindings: readonly MotionGrammarBinding[];
	/** Live-document hash at `begin`; compared on every `capture` for drift. */
	readonly sourceHash: string;
	readonly bindingEpoch: number;
	/** Transport state before this session paused playback, for restore. */
	readonly transportSnapshot: TransportState;
	readonly artboard: AgentLiveArtboardSummary;
	capturedFrameCount: number;
	watchdog: ReturnType<typeof setTimeout> | null;
};

/**
 * Builds a fresh capture capability. One session is held at a time; the app
 * injects the returned object into both editor-bridge legs.
 */
export function createAgentPreviewCaptureCapability(): AgentPreviewCaptureCapability {
	let session: CaptureSession | null = null;

	const restoreTransport = (snapshot: TransportState): void => {
		useTransportStore.getState().restoreSnapshot(snapshot);
	};

	/** Clears the watchdog, closes the session, and restores playback. */
	const disposeSession = (): void => {
		const active = session;
		if (!active) return;
		if (active.watchdog !== null) clearTimeout(active.watchdog);
		session = null;
		restoreTransport(active.transportSnapshot);
	};

	const armWatchdog = (sessionId: string): void => {
		const active = session;
		if (!active || active.sessionId !== sessionId) return;
		if (active.watchdog !== null) clearTimeout(active.watchdog);
		active.watchdog = setTimeout(() => {
			if (session?.sessionId === sessionId) disposeSession();
		}, CAPTURE_INACTIVITY_TIMEOUT_MS);
	};

	const observePreview = (): AgentPreviewObservation => {
		const presentation = presentationSnapshot();
		const notReadyReasons: string[] = [];
		if (presentation.isPlaying) {
			notReadyReasons.push(
				"transport is playing; a committed still needs playback paused first",
			);
		}
		if (typeof document === "undefined") {
			notReadyReasons.push("no browser canvas runtime is available");
		}
		return {
			contractVersion: 1,
			identity: currentIdentity(),
			presentation,
			artboard: currentArtboardSummary(),
			activeSessionId: session?.sessionId ?? null,
			rendererSource: RENDERER_SOURCE,
			captureReady: notReadyReasons.length === 0,
			notReadyReasons,
		};
	};

	const beginSession = (): AgentPreviewCaptureBeginResult => {
		// Restore any prior in-flight session BEFORE snapshotting this one's
		// baseline — otherwise a prior begin's paused transport would be frozen as
		// this session's "original" state and the user's real playback lost.
		disposeSession();

		if (typeof document === "undefined") {
			return {
				action: "begin",
				ok: false,
				status: "unavailable",
				message: "Still capture requires a browser canvas runtime.",
				rendererSource: RENDERER_SOURCE,
			};
		}

		const liveScene = useSceneStore.getState().document;
		const artboardMeta = selectCurrentArtboard(liveScene);
		const scopedScene = scopeSceneToArtboard(
			cloneSceneDocument(liveScene),
			artboardMeta.id,
		);
		if (!scopedScene) {
			return {
				action: "begin",
				ok: false,
				status: "unavailable",
				message: `The current artboard "${artboardMeta.id}" could not be scoped for capture.`,
				rendererSource: RENDERER_SOURCE,
			};
		}

		const motion = cloneMotionDocument(useMotionStore.getState().document);
		const grammarBindings = structuredClone(
			useMotionGrammarStore.getState().document.bindings,
		);
		const transportSnapshot = transportStateSnapshot();
		const identity = currentIdentity();
		const artboard = currentArtboardSummary();
		const sourceHash = liveDocumentHash();

		// Pause the ONLY presentation gate and clear interaction/perform so the
		// shared transport is in a committed, non-driven state for the session.
		// Capture itself takes an explicit frame and never reads presentation
		// state, but leaving playback running would let the user keep driving the
		// transport underneath the session.
		const transport = useTransportStore.getState();
		transport.pause();
		transport.setInteractionPreview(false);
		transport.disarmPerform();

		const sessionId = crypto.randomUUID();
		session = {
			sessionId,
			identity,
			scene: scopedScene,
			motion,
			grammarBindings,
			sourceHash,
			bindingEpoch: identity.bindingEpoch,
			transportSnapshot,
			artboard,
			capturedFrameCount: 0,
			watchdog: null,
		};
		armWatchdog(sessionId);

		return {
			action: "begin",
			ok: true,
			status: "begun",
			message: "Capture session started; playback paused.",
			rendererSource: RENDERER_SOURCE,
			sessionId,
			identity,
			artboard,
			presentation: presentationSnapshot(),
			sourceHash,
			durationFrames: motion.durationFrames,
		};
	};

	const captureFrame = async (
		request: AgentPreviewCaptureRequest,
	): Promise<AgentPreviewCaptureFrameResult> => {
		const active = session;
		if (!active || request.sessionId !== active.sessionId) {
			return {
				action: "capture",
				ok: false,
				status: "session-not-found",
				message:
					"No open capture session matches this sessionId; begin a new session.",
				restored: false,
			};
		}
		armWatchdog(active.sessionId);

		// Both reads are wrapped in one try (adversarial review N4): either
		// throwing (e.g. an unreadable live document/session) must still restore
		// transport immediately, not wait out the 45s inactivity watchdog.
		let readinessSourceHash: string;
		let readinessBindingEpoch: number;
		try {
			readinessSourceHash = liveDocumentHash();
			readinessBindingEpoch = getEditorSessionDescriptor().bindingEpoch;
		} catch (error) {
			disposeSession();
			return {
				action: "capture",
				ok: false,
				status: "capture-failed",
				message: `Could not read live document/session state; the session was restored: ${error instanceof Error ? error.message : String(error)}`,
				restored: true,
			};
		}
		if (readinessSourceHash !== active.sourceHash) {
			disposeSession();
			return {
				action: "capture",
				ok: false,
				status: "drift",
				message:
					"The live document changed after this capture session began; the session was restored.",
				restored: true,
			};
		}
		if (readinessBindingEpoch !== active.bindingEpoch) {
			disposeSession();
			return {
				action: "capture",
				ok: false,
				status: "epoch-mismatch",
				message:
					"The editor binding epoch changed after this capture session began; the session was restored.",
				restored: true,
			};
		}

		const durationFrames = active.motion.durationFrames;
		const frame = request.frame;
		// REJECT (never clamp) an out-of-range frame; this is a caller error, so the
		// session stays open for a retry with a valid frame.
		if (
			frame === undefined ||
			!Number.isInteger(frame) ||
			frame < 0 ||
			frame > durationFrames - 1
		) {
			return {
				action: "capture",
				ok: false,
				status: "frame-out-of-range",
				message: `Frame must be an integer in [0, ${durationFrames - 1}]; received ${String(frame)}.`,
				requestedFrame: frame,
				durationFrames,
				restored: false,
			};
		}

		try {
			const resolveProductionArtifact = linkedProductionResolverForScene(
				active.scene,
			);
			const raster = await captureRasterStillFrame({
				scene: active.scene,
				motion: active.motion,
				frame,
				grammarBindings: active.grammarBindings,
				...(resolveProductionArtifact ? { resolveProductionArtifact } : {}),
			});
			// Re-verify after the async render: a concurrent begin/end could have
			// replaced the session, or an edit could have drifted the document.
			if (session !== active) {
				return {
					action: "capture",
					ok: false,
					status: "session-not-found",
					message:
						"The capture session was replaced or ended while a frame was rendering.",
					restored: false,
				};
			}
			if (liveDocumentHash() !== active.sourceHash) {
				disposeSession();
				return {
					action: "capture",
					ok: false,
					status: "drift",
					message:
						"The live document changed while a frame was rendering; the session was restored.",
					restored: true,
				};
			}

			const packet: AgentCaptureFramePacket = {
				editorInstanceId: active.identity.editorInstanceId,
				workingCopyId: active.identity.workingCopyId,
				bindingEpoch: active.identity.bindingEpoch,
				requestedFrame: frame,
				sampledFrame: frame,
				presentation: presentationSnapshot(),
				width: raster.width,
				height: raster.height,
				pixelRatio: CAPTURE_PIXEL_RATIO,
				scale: CAPTURE_SCALE,
				colorSpace: CAPTURE_COLOR_SPACE,
				sha256: await sha256Hex(raster.blob),
				rendererSource: RENDERER_SOURCE,
				issues: [...new Set(raster.issues.map((issue) => issue.code))],
				pngBase64: await blobToBase64(raster.blob),
			};
			active.capturedFrameCount += 1;
			armWatchdog(active.sessionId);
			return {
				action: "capture",
				ok: true,
				status: "captured",
				message: `Captured committed frame ${frame}.`,
				frame: packet,
				requestedFrame: frame,
				durationFrames,
				restored: false,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			disposeSession();
			return {
				action: "capture",
				ok: false,
				status: classifyCaptureFailure(message),
				message,
				restored: true,
			};
		}
	};

	const endSession = (
		request: AgentPreviewCaptureRequest,
	): AgentPreviewCaptureEndResult => {
		const active = session;
		if (!active || request.sessionId !== active.sessionId) {
			// Idempotent: ending an already-closed session (e.g. after a terminal
			// capture failure auto-restored it) is not an error.
			return {
				action: "end",
				ok: true,
				status: "session-not-found",
				message: "No open capture session matches this sessionId.",
				restored: false,
			};
		}
		const capturedFrameCount = active.capturedFrameCount;
		disposeSession();
		return {
			action: "end",
			ok: true,
			status: "ended",
			message: "Capture session ended; playback restored.",
			restored: true,
			capturedFrameCount,
		};
	};

	return {
		observePreview,
		capture: (request) => {
			if (request.action === "begin") return Promise.resolve(beginSession());
			if (request.action === "capture") return captureFrame(request);
			return Promise.resolve(endSession(request));
		},
		// `reason` is accepted for caller intent (WS close vs. watchdog) but the
		// restore path is identical, so it is not consumed today.
		abandonActiveSession: () => disposeSession(),
	};
}
