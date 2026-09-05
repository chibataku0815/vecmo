import {
	AGENT_BRIDGE_PROTOCOL_VERSION,
	type AgentBridgeErrorMessage,
	type AgentBridgeObserveResult,
	type AgentBridgeProjectSaveRequest,
	type AgentBridgeProjectSaveResult,
	type AgentBridgeRequestMessage,
	type AgentBridgeResponseMessage,
	encodeAgentBridgeMessage,
	parseAgentBridgeMessage,
} from "@/entities/agent/model/bridge-protocol";
import { computeContextRevision } from "@/entities/agent/model/plan-context-revision";
import { useMotionCopilotPlanSession } from "@/entities/agent/model/plan-session";
import type { AgentPreviewCaptureCapability } from "@/entities/agent/model/preview-capture";
import { observeAgentLiveDocument } from "@/entities/agent/model/read-only";
import type {
	AgentCommandPlanApplyRequest,
	AgentCommandPlanApproval,
	AgentCommandPlanRequest,
	AgentCommandPlanResult,
	AgentCommandTransactionStore,
	AgentLiveDocumentIdentity,
} from "@/entities/agent/model/types";
import {
	captureEditorBindingFence,
	getEditorSessionDescriptor,
	isEditorBindingFenceCurrent,
	subscribeEditorSessionDescriptor,
} from "@/entities/editor-session/model/session";
import { useMotionStore } from "@/entities/motion/model/store";
import { useMotionGrammarStore } from "@/entities/motion-grammar/model/store";
import type { SceneCameraAuthoringSelection } from "@/entities/scene/model/scene-camera-authoring";
import { useSceneStore } from "@/entities/scene/model/store";
import { useAgentBridgeStore } from "./approval-store";
import {
	type AgentBridgeDispatchDeps,
	dispatchAgentBridgeRequest,
} from "./bridge-dispatch";
import {
	applyApprovedAgentCommandPlan,
	currentAgentContext,
	validateAgentCommandPlan,
} from "./review-apply";

/**
 * Browser (editor-leg) connection for the local agent bridge. This runs only in
 * dev: it discovers the relay port through the Vite middleware, dials the
 * loopback relay outbound (the browser sends its own dev Origin, which the relay
 * checks), and answers proposed plans by running the real review/apply path
 * behind the editor-owned approval policy. Local dev auto-approves apply/save;
 * production bridge sessions remain human-gated. The relay token never reaches
 * the browser — the editor leg is gated by Origin, the agent leg by token.
 */

const DISCOVERY_ENDPOINT = "/__agent-bridge";
const PRODUCTION_SESSION_ENDPOINT = "/api/agent-bridge/session";
const RECONNECT_DELAY_MS = 4_000;

const currentBridgeEditorDescriptor = () => ({
	...getEditorSessionDescriptor(),
	documentName: useSceneStore.getState().document.name,
});

/**
 * Editor-side handler for the read-only `"observe"` bridge op (B2): builds the
 * live identity + a fresh `AgentDocumentContext` from the live scene/motion/
 * grammar stores (the "live documentSource" adapter — entities must not import
 * these stores, so this glue lives here) and delegates the actual read to the
 * pure `observeAgentLiveDocument` entity function. No store writes, no undo
 * entry, no transaction: this can only ever read.
 */
const observeLiveDocument = (): AgentBridgeObserveResult => {
	// Built explicitly (not a bare spread of currentBridgeEditorDescriptor())
	// so the wire payload matches AgentLiveDocumentIdentity's declared fields
	// exactly rather than silently leaking editorInstanceId — the agent already
	// knows that id; it is how the request was targeted.
	const descriptor = currentBridgeEditorDescriptor();
	const identity: AgentLiveDocumentIdentity = {
		documentName: descriptor.documentName,
		workingCopyId: descriptor.workingCopyId,
		projectId: descriptor.projectId,
		bindingEpoch: descriptor.bindingEpoch,
	};
	const result = observeAgentLiveDocument(currentAgentContext(), identity);
	if (!result.data) {
		// observeAgentLiveDocument has no failure path today (a document always
		// has a current artboard, and identity is always supplied above) — this
		// can only mean the entity contract changed without this adapter being
		// updated, so fail loudly instead of returning a bogus empty observation.
		throw new Error(
			"observeAgentLiveDocument returned no data; the live-observe adapter is out of sync with the entity contract.",
		);
	}
	return { op: "observe", ...result.data };
};

const subscribeBridgeDescriptorUpdates = (
	readSocket: () => WebSocket | null,
): (() => void) => {
	const send = (): void => {
		const socket = readSocket();
		if (socket?.readyState !== WebSocket.OPEN) return;
		socket.send(
			encodeAgentBridgeMessage({
				kind: "editor-descriptor",
				editor: currentBridgeEditorDescriptor(),
			}),
		);
	};
	const unsubscribeSession = subscribeEditorSessionDescriptor(send);
	const unsubscribeScene = useSceneStore.subscribe((state, previous) => {
		if (state.document.name !== previous.document.name) send();
	});
	return () => {
		unsubscribeSession();
		unsubscribeScene();
	};
};

const bindingMismatchError = (id: string): AgentBridgeErrorMessage => ({
	kind: "error",
	id,
	code: "agent.editor-binding-mismatch",
	message:
		"The editor binding changed after the target was selected; refresh targets and retry.",
});

const validateBridgeRequestTarget = (
	message: AgentBridgeRequestMessage,
): AgentBridgeErrorMessage | null => {
	// The Phase D capture ops are fenced to one exact live working copy, so they
	// must carry both `workingCopyId` and `bindingEpoch`; an absent field is a
	// mismatch here rather than the plan/observe ops' "unspecified means any".
	const requiresFullTarget =
		message.op === "preview-observe" || message.op === "preview-capture";
	if (!message.target) {
		return requiresFullTarget ? bindingMismatchError(message.id) : null;
	}
	if (
		requiresFullTarget &&
		(message.target.workingCopyId === undefined ||
			message.target.bindingEpoch === undefined)
	) {
		return bindingMismatchError(message.id);
	}
	const current = getEditorSessionDescriptor();
	const matches =
		message.target.editorInstanceId === current.editorInstanceId &&
		(message.target.workingCopyId === undefined ||
			message.target.workingCopyId === current.workingCopyId) &&
		(message.target.projectId === undefined ||
			message.target.projectId === current.projectId) &&
		(message.target.bindingEpoch === undefined ||
			message.target.bindingEpoch === current.bindingEpoch);
	return matches ? null : bindingMismatchError(message.id);
};

const bindingFencedApproval = async (
	fence: ReturnType<typeof captureEditorBindingFence>,
	approval: Promise<AgentCommandPlanApproval>,
): Promise<AgentCommandPlanApproval> => {
	const result = await approval;
	return isEditorBindingFenceCurrent(fence)
		? result
		: {
				approved: false,
				note: "The editor changed projects while approval was pending.",
			};
};

type AgentBridgeApprovalOptions = {
	/**
	 * Local development bridge convenience. When true in a Vite dev build, edit
	 * plans and project-save requests are approved without parking a banner.
	 * Production sessions never enable this by default.
	 */
	readonly developmentAutoApprove?: boolean;
};

/**
 * Editor UI selection state at the moment a bridge response is stamped:
 * selected node ids, camera-authoring selection, the artboard selected as a
 * canvas object, the document's persisted focused artboard, and the playhead
 * frame. The getter is injected from the app layer because `features/agent`
 * must not import `features/selection` or motion transport stores.
 */
export type LiveSelectionSnapshot = {
	readonly nodeIds: readonly string[];
	readonly selectedArtboardId: string | null;
	readonly selectedSceneCamera: SceneCameraAuthoringSelection | null;
	readonly currentArtboardId: string;
	readonly currentFrame: number;
};

const liveSelectionStamp = (snapshot: LiveSelectionSnapshot) => ({
	selectedNodeIds: [...snapshot.nodeIds],
	selectedArtboardId: snapshot.selectedArtboardId,
	selectedSceneCamera: snapshot.selectedSceneCamera,
	currentArtboardId: snapshot.currentArtboardId,
	currentFrame: snapshot.currentFrame,
});

/**
 * Stamps a live review response — or a live `"observe"` result — with the
 * editor's current selection, so an agent can author against what the user
 * selected instead of being told an internal node id, camera rig id, or
 * artboard id through a separate document round-trip. Errors pass through
 * untouched. `planId` and `op === "observe"` are the two response shapes that
 * carry this stamp; `AgentBridgeProjectSaveResult` (no `planId`, `op ===
 * "save-project"`) is deliberately left untouched, matching its existing
 * behavior.
 */
const withLiveSelection = (
	response: AgentBridgeResponseMessage | AgentBridgeErrorMessage,
	getLiveSelectionSnapshot: (() => LiveSelectionSnapshot) | undefined,
): AgentBridgeResponseMessage | AgentBridgeErrorMessage => {
	if (response.kind !== "response" || !getLiveSelectionSnapshot)
		return response;
	if ("planId" in response.result) {
		return {
			...response,
			result: {
				...response.result,
				...liveSelectionStamp(getLiveSelectionSnapshot()),
			},
		};
	}
	if ("op" in response.result && response.result.op === "observe") {
		return {
			...response,
			result: {
				...response.result,
				...liveSelectionStamp(getLiveSelectionSnapshot()),
			},
		};
	}
	return response;
};

/**
 * Reviews and applies an edit plan either through the approval banner, through
 * the editor's persisted "auto-apply" trust mode, or through the local dev
 * bridge auto-approval path. The agent itself never sets `autoApplied`; only
 * these editor-owned short-circuits do, so the approval object honestly reports
 * whether a human clicked "承認" or the editor granted standing/development
 * trust.
 */
const requestApproval = (
	review: AgentCommandPlanResult,
	request: AgentCommandPlanRequest,
	options: AgentBridgeApprovalOptions = {},
): Promise<AgentCommandPlanApproval> => {
	if (import.meta.env.DEV && options.developmentAutoApprove) {
		return Promise.resolve({
			approved: true,
			reviewer: "dev-editor",
			autoApplied: true,
			note: "Auto-approved: local development bridge.",
		});
	}
	if (useAgentBridgeStore.getState().autoApplyEdits) {
		return Promise.resolve({
			approved: true,
			autoApplied: true,
			note: "Auto-applied: editor trust mode is enabled.",
		});
	}
	return new Promise<AgentCommandPlanApproval>((resolve) => {
		const accepted = useAgentBridgeStore.getState().enqueueApproval(
			{
				kind: "edit-plan",
				id: request.planId,
				intent: request.intent,
				affectedCount: review.affected.length,
				warningCount: review.issues.filter(
					(issue) => issue.severity === "warning",
				).length,
				documentCommandCount: review.dryRunSummary.documentCommandCount,
				sceneCommandCount: review.dryRunSummary.sceneCommandCount,
				motionCommandCount: review.dryRunSummary.motionCommandCount,
			},
			resolve,
		);
		if (!accepted) {
			resolve({
				approved: false,
				note: "Another agent approval is already pending in the editor.",
			});
		}
	});
};

const coordinatedUndoStores: Readonly<
	Record<
		AgentCommandTransactionStore,
		{
			readonly getUndoStackLength: () => number;
			readonly subscribe: (onChange: () => void) => () => void;
			readonly undo: () => void;
		}
	>
> = {
	scene: {
		getUndoStackLength: () => useSceneStore.getState().undoStack.length,
		subscribe: (onChange) => useSceneStore.subscribe(onChange),
		undo: () => useSceneStore.getState().undo(),
	},
	motion: {
		getUndoStackLength: () => useMotionStore.getState().undoStack.length,
		subscribe: (onChange) => useMotionStore.subscribe(onChange),
		undo: () => useMotionStore.getState().undo(),
	},
	"motion-grammar": {
		getUndoStackLength: () => useMotionGrammarStore.getState().undoStack.length,
		subscribe: (onChange) => useMotionGrammarStore.subscribe(onChange),
		undo: () => useMotionGrammarStore.getState().undo(),
	},
};

/**
 * Undoes one auto-applied activity entry by dispatching directly to the store
 * it recorded (`storeKind`), rather than the global Cmd+Z cross-store
 * arbitrator (`features/history/model/undo-coordinator.ts`). For a single-store
 * edit — the only kind that can produce an activity entry. The isolated
 * `document/update-timing` compound intentionally records no activity entry,
 * because its one-step undo belongs to the global cross-store coordinator.
 * For a single-store entry, popping that store's top-of-stack entry is the
 * identical primitive the coordinator would run
 * once it picked the same store, so this is behaviorally equivalent to
 * pressing Cmd+Z immediately after this activity was recorded.
 */
export function undoAgentBridgeActivity(
	storeKind: AgentCommandTransactionStore,
): void {
	coordinatedUndoStores[storeKind].undo();
}

/**
 * Watches one store's undo-stack length and flips the named activity entry's
 * `undoAvailable` to false the first time it changes (a further undo/redo, or
 * a new edit growing the stack) — after that, popping the store's top entry
 * would no longer undo the recorded activity's own edit. Uses each store's
 * existing `undoStack` field (already read this way by the Cmd+Z arbitrator)
 * rather than a new public API. Auto-unsubscribes after the first change.
 */
function watchActivityUndoAvailability(
	id: string,
	storeKind: AgentCommandTransactionStore,
): void {
	const coordinated = coordinatedUndoStores[storeKind];
	const lengthAtRecordTime = coordinated.getUndoStackLength();
	const unsubscribe = coordinated.subscribe(() => {
		if (coordinated.getUndoStackLength() === lengthAtRecordTime) return;
		unsubscribe();
		useAgentBridgeStore.getState().setActivityUndoAvailable(id, false);
	});
}

/**
 * The compound (or single-store) transaction id that a successful apply stamped
 * onto every participating history entry. Every `appliedCommands` entry shares
 * one id (see `applyLiveCompound`), so the first changed entry is representative.
 */
const appliedCompoundId = (
	result: AgentCommandPlanResult,
): string | undefined =>
	result.appliedCommands.find((item) => item.commandCount > 0)?.transactionId;

/**
 * The `compoundId` of the current reversible top-of-history across the
 * coordinated stores — the exact entry the global Cmd+Z arbitrator would revert
 * next (largest `seq` wins). Used to decide whether an applied plan is still the
 * thing a single Undo would remove.
 */
const latestTopCompoundId = (): string | undefined => {
	const tops = [
		useSceneStore.getState().undoStack.at(-1),
		useMotionStore.getState().undoStack.at(-1),
		useMotionGrammarStore.getState().undoStack.at(-1),
	];
	let bestSeq = Number.NEGATIVE_INFINITY;
	let bestCompoundId: string | undefined;
	for (const top of tops) {
		if (top && top.seq > bestSeq) {
			bestSeq = top.seq;
			bestCompoundId = top.meta.compoundId;
		}
	}
	return bestCompoundId;
};

/**
 * Watches the coordinated stores' history and flips the Motion Copilot plan
 * session's `undoAvailable` to false the moment the applied compound is no
 * longer the reversible top — a further edit, or the plan's own Undo. Compound
 * analogue of {@link watchActivityUndoAvailability}; it reuses the same
 * globalUndo mechanism the panel's Undo action dispatches to, so the gate and
 * the action stay consistent. Auto-unsubscribes once the compound diverges.
 */
const watchPlanSessionUndoAvailability = (
	result: AgentCommandPlanResult,
): void => {
	const compoundId = appliedCompoundId(result);
	if (!compoundId) return;
	if (latestTopCompoundId() !== compoundId) {
		useMotionCopilotPlanSession
			.getState()
			.setUndoAvailable(result.planId, false);
		return;
	}
	const unsubscribers: (() => void)[] = [];
	const check = (): void => {
		if (latestTopCompoundId() === compoundId) return;
		for (const unsubscribe of unsubscribers) unsubscribe();
		useMotionCopilotPlanSession
			.getState()
			.setUndoAvailable(result.planId, false);
	};
	unsubscribers.push(
		useSceneStore.subscribe(check),
		useMotionStore.subscribe(check),
		useMotionGrammarStore.subscribe(check),
	);
};

/**
 * Records the plan session outcome of an apply into the Motion Copilot read
 * model (`entities/agent`): a successful apply becomes the applied result (with
 * its Undo watcher), and an explicit rejection/cancel is recorded as such. A
 * blocked/no-op apply that was never approved leaves the earlier proposed record
 * untouched, since that review already carries the blocking reason. This runs
 * for BOTH manual approvals and compound applies, closing the applied-delta gap
 * the auto-apply-only activity toast leaves open.
 */
const recordPlanSessionOutcome = (
	request: AgentCommandPlanApplyRequest,
	result: AgentCommandPlanResult,
): void => {
	const session = useMotionCopilotPlanSession.getState();
	if (result.applied) {
		session.recordApplied(result);
		watchPlanSessionUndoAvailability(result);
		return;
	}
	if (request.approval && request.approval.approved === false) {
		session.recordRejected(request.planId, request.approval.note);
	}
};

/**
 * Reviews an agent command plan and records it as the displayed proposal in the
 * Motion Copilot plan session. Wraps `validateAgentCommandPlan` so both a bare
 * `validate` op and the internal review the `apply` op runs surface the full
 * plan at authoring depth, while the ambient approval banner keeps its compact
 * slot. The `validate` op never mutates.
 */
export const validateWithSessionTracking = (
	request: AgentCommandPlanRequest,
	contextRevision?: string | null,
): AgentCommandPlanResult => {
	const review = validateAgentCommandPlan(request);
	// Staleness anchor (C2-L4): a composer plan passes the revision its projection
	// was BUILT against (so drift during the provider round-trip is caught); the
	// bridge omits it, so we mint the revision at RECEIPT from the live documents —
	// drift after an external plan is displayed is still detected. Both derive from
	// the one `computeContextRevision`, so the watcher's live compare is apples-to-
	// apples.
	const revision =
		contextRevision !== undefined
			? contextRevision
			: computeContextRevision(
					useSceneStore.getState().document,
					useMotionStore.getState().document,
				);
	useMotionCopilotPlanSession.getState().recordProposed(review, revision);
	return review;
};

/**
 * Wraps the real apply dependency so a plan that applied via the auto-apply
 * trust path (never a manually-approved one — the human already saw that
 * decision in the banner) records a non-blocking activity entry. It also records
 * the full applied/rejected outcome into the Motion Copilot plan session (for
 * manual approvals and compound applies alike). Shared by both the local
 * (`createEditorBridgeConnection`) and remote
 * (`createProductionEditorBridgeConnection`) connections so trust applies
 * identically on either transport.
 */
export const applyWithActivityTracking = (
	request: AgentCommandPlanApplyRequest,
): AgentCommandPlanResult => {
	if (request.approval?.approved) {
		useMotionCopilotPlanSession.getState().markApplying(request.planId);
	}
	const result = applyApprovedAgentCommandPlan(request);
	recordPlanSessionOutcome(request, result);
	if (result.applied && request.approval?.autoApplied) {
		const applied = result.appliedCommands.filter(
			(item) => item.commandCount > 0,
		);
		if (applied.length === 1) {
			const [activity] = applied;
			if (!activity) return result;
			useAgentBridgeStore.getState().recordActivity({
				intent: request.intent,
				storeKind: activity.store,
				commandCount: activity.commandCount,
				warningCount: result.summary.warningCount,
			});
			const recorded = useAgentBridgeStore.getState().activity[0];
			if (recorded) {
				watchActivityUndoAvailability(recorded.id, activity.store);
			}
		}
	}
	return result;
};

export type AgentBridgeProjectSaveHandler = (
	request: AgentBridgeProjectSaveRequest,
	approval: AgentCommandPlanApproval,
) => Promise<AgentBridgeProjectSaveResult>;

type EditorBridgeConnectionOptions = {
	readonly developmentAutoApprove?: boolean;
	readonly getLiveSelectionSnapshot?: () => LiveSelectionSnapshot;
	readonly getProjectSaveApprovalPreview?: (
		request: AgentBridgeProjectSaveRequest,
	) => {
		readonly projectName: string;
		readonly activeProjectName: string | null;
	};
	readonly saveProject?: AgentBridgeProjectSaveHandler;
	/**
	 * Read-only native artboard capture capability (Phase D), built and injected
	 * from the app layer because it reaches into the widget capture engine.
	 * `features/agent` only forwards it over the bridge; it never imports the
	 * widget, the transport store, or the export raster path directly.
	 */
	readonly previewCapture?: AgentPreviewCaptureCapability;
};

/**
 * Binds the injected capture capability into the two read-only dispatch deps,
 * wrapping each domain result with its bridge `op` discriminant. Returns an
 * empty object when no capability was injected, so the dispatch reports a
 * fail-closed "unavailable" error rather than treating the ops as present.
 * Shared by both bridge legs so capture wires identically on either transport.
 */
const previewCaptureDeps = (
	capability: AgentPreviewCaptureCapability | undefined,
): Pick<AgentBridgeDispatchDeps, "observePreview" | "capturePreview"> => {
	if (!capability) return {};
	return {
		observePreview: () => ({
			op: "preview-observe",
			...capability.observePreview(),
		}),
		capturePreview: async (request) => ({
			op: "preview-capture",
			...(await capability.capture(request)),
		}),
	};
};

const PREVIEW_CAPTURE_PRODUCTION_UNSUPPORTED_MESSAGE =
	"agent.preview-unsupported-transport: Native artboard capture is local-relay-only; connect through the local dev bridge (`bun run agent:bridge` + `/editor`) instead of a production bridge session.";

/**
 * Fail-closed preview/capture deps for the production bridge leg (adversarial
 * review S1). Native capture is local-relay-only — a captured PNG can exceed
 * the production Durable Object bridge's ~1MiB message cap (see
 * `worker/agent-bridge/session.ts`) — so this leg never wires the real
 * injected capability, regardless of whether the caller passed one: both deps
 * immediately reject with a distinct `agent.preview-unsupported-transport`
 * code instead of the generic "not registered" fallback, so a caller learns
 * this is an intentional transport boundary, not a wiring bug. The rejection
 * propagates through `dispatchAgentBridgeRequest`'s catch-all via the
 * `${code}: ${message}` convention the CLI/MCP forward layer's
 * `bridgeRequestErrorCode` (`scripts/agent-bridge-forward.ts`) already parses.
 * Neither dep begins a session or touches playback.
 */
const productionPreviewCaptureDeps = (): Pick<
	AgentBridgeDispatchDeps,
	"observePreview" | "capturePreview"
> => ({
	observePreview: () => {
		throw new Error(PREVIEW_CAPTURE_PRODUCTION_UNSUPPORTED_MESSAGE);
	},
	capturePreview: async () => {
		throw new Error(PREVIEW_CAPTURE_PRODUCTION_UNSUPPORTED_MESSAGE);
	},
});

const requestProjectSaveApproval = (
	request: AgentBridgeProjectSaveRequest,
	options: EditorBridgeConnectionOptions,
): Promise<AgentCommandPlanApproval> => {
	if (import.meta.env.DEV && options.developmentAutoApprove) {
		return Promise.resolve({
			approved: true,
			reviewer: "dev-editor",
			autoApplied: true,
			note: "Auto-approved: local development bridge.",
		});
	}
	return new Promise<AgentCommandPlanApproval>((resolve) => {
		const preview = options.getProjectSaveApprovalPreview?.(request);
		const projectName =
			preview?.projectName ?? request.name?.trim() ?? "Untitled";
		const accepted = useAgentBridgeStore.getState().enqueueApproval(
			{
				kind: "project-save",
				id: crypto.randomUUID(),
				intent: request.intent ?? "Save the live editor project to cloud.",
				mode: request.mode ?? "save",
				projectName,
				activeProjectName: preview?.activeProjectName ?? null,
			},
			resolve,
		);
		if (!accepted) {
			resolve({
				approved: false,
				note: "Another agent approval is already pending in the editor.",
			});
		}
	});
};

const discoverRelayPort = async (): Promise<number | null> => {
	try {
		const response = await fetch(DISCOVERY_ENDPOINT, { cache: "no-store" });
		if (!response.ok) return null;
		const info = (await response.json()) as { port?: unknown };
		return typeof info.port === "number" ? info.port : null;
	} catch {
		return null;
	}
};

type ProductionBridgeSessionResponse = {
	readonly editorWebSocketUrl: string;
	readonly expiresAt: number;
	readonly bridge: {
		readonly kind: "remote";
		readonly baseUrl: string;
		readonly sessionId: string;
		readonly token: string;
	};
};

const isProductionBridgeSessionResponse = (
	value: unknown,
): value is ProductionBridgeSessionResponse => {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Record<string, unknown>;
	const bridge = record.bridge;
	if (typeof bridge !== "object" || bridge === null) return false;
	const bridgeRecord = bridge as Record<string, unknown>;
	return (
		typeof record.editorWebSocketUrl === "string" &&
		typeof record.expiresAt === "number" &&
		bridgeRecord.kind === "remote" &&
		typeof bridgeRecord.baseUrl === "string" &&
		typeof bridgeRecord.sessionId === "string" &&
		typeof bridgeRecord.token === "string"
	);
};

const createBridgeSession =
	async (): Promise<ProductionBridgeSessionResponse> => {
		const response = await fetch(PRODUCTION_SESSION_ENDPOINT, {
			method: "POST",
			credentials: "same-origin",
			headers: { Accept: "application/json" },
		});
		if (!response.ok) {
			throw new Error(`bridge session request failed: ${response.status}`);
		}
		const value: unknown = await response.json();
		if (!isProductionBridgeSessionResponse(value)) {
			throw new Error("bridge session response had an unexpected shape");
		}
		return value;
	};

/**
 * Opens the editor-leg bridge connection and returns a disposer. Reconnects on
 * drop so starting the relay after the editor still attaches without a reload.
 */
export const createEditorBridgeConnection = (
	options: EditorBridgeConnectionOptions = {},
): (() => void) => {
	const connectionOptions: EditorBridgeConnectionOptions = {
		...options,
		developmentAutoApprove: options.developmentAutoApprove ?? true,
	};
	const store = useAgentBridgeStore.getState();
	store.setTransportKind("local");
	const previewCapture = connectionOptions.previewCapture;
	let disposed = false;
	let socket: WebSocket | null = null;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	const unsubscribeDescriptor = subscribeBridgeDescriptorUpdates(() => socket);

	const scheduleReconnect = (): void => {
		if (disposed || reconnectTimer) return;
		reconnectTimer = setTimeout(() => {
			reconnectTimer = null;
			void connect();
		}, RECONNECT_DELAY_MS);
	};

	const connect = async (): Promise<void> => {
		if (disposed) return;
		store.setStatus("connecting");
		store.setRemoteError(null);
		const port = await discoverRelayPort();
		if (disposed) return;
		if (port === null) {
			store.setStatus("disconnected");
			scheduleReconnect();
			return;
		}

		const ws = new WebSocket(`ws://127.0.0.1:${port}`);
		socket = ws;

		ws.addEventListener("open", () => {
			ws.send(
				encodeAgentBridgeMessage({
					kind: "hello",
					protocol: AGENT_BRIDGE_PROTOCOL_VERSION,
					role: "editor",
					clientId: crypto.randomUUID(),
					editor: currentBridgeEditorDescriptor(),
				}),
			);
		});

		ws.addEventListener("message", async (event: MessageEvent) => {
			const raw =
				typeof event.data === "string" ? event.data : String(event.data);
			const parsed = parseAgentBridgeMessage(raw);
			if (!parsed.ok) return;
			const message = parsed.message;
			if (message.kind === "hello-ack") {
				store.setStatus(message.accepted ? "connected" : "disconnected");
				return;
			}
			if (message.kind === "request") {
				const targetError = validateBridgeRequestTarget(message);
				if (targetError) {
					ws.send(encodeAgentBridgeMessage(targetError));
					return;
				}
				const requestFence = captureEditorBindingFence();
				const response = await dispatchAgentBridgeRequest(message, {
					validate: validateWithSessionTracking,
					apply: applyWithActivityTracking,
					observe: observeLiveDocument,
					requestApproval: (review, request) =>
						bindingFencedApproval(
							requestFence,
							requestApproval(review, request, connectionOptions),
						),
					requestProjectSaveApproval: (request) =>
						bindingFencedApproval(
							requestFence,
							requestProjectSaveApproval(request, connectionOptions),
						),
					saveProject: connectionOptions.saveProject,
					...previewCaptureDeps(previewCapture),
					notifyBlocked: (review) =>
						store.setRemoteError(
							review.blockedReason ?? "エージェント編集がブロックされました",
						),
				});
				ws.send(
					encodeAgentBridgeMessage(
						withLiveSelection(
							response,
							connectionOptions.getLiveSelectionSnapshot,
						),
					),
				);
			}
		});

		ws.addEventListener("close", () => {
			if (socket === ws) socket = null;
			// The editor owns capture-session restore: a dropped bridge must put
			// playback back even mid-teardown, so this runs before the disposed
			// early-return. The watchdog is a further backstop.
			previewCapture?.abandonActiveSession("bridge connection closed");
			if (disposed) return;
			store.cancelPending("Agent bridge disconnected before approval.");
			store.setStatus("disconnected");
			scheduleReconnect();
		});

		ws.addEventListener("error", () => {
			store.cancelPending("Agent bridge connection failed before approval.");
			ws.close();
		});
	};

	void connect();

	return () => {
		disposed = true;
		if (reconnectTimer) clearTimeout(reconnectTimer);
		unsubscribeDescriptor();
		socket?.close();
		store.cancelPending("Agent bridge was closed before approval.");
		store.setStatus("idle");
		store.setTransportKind(null);
	};
};

/**
 * Opens the production editor leg for an explicitly requested bridge session.
 * This is opt-in from `/editor?agentBridge=1`: normal production users do not
 * create bridge grants, while users who do get a short-lived config for their
 * local stdio MCP server. The editor still performs validation and approval.
 */
export const createProductionEditorBridgeConnection = (
	options: EditorBridgeConnectionOptions = {},
): (() => void) => {
	const store = useAgentBridgeStore.getState();
	store.setTransportKind("remote");
	// Native capture is local-relay-only (see `productionPreviewCaptureDeps`):
	// this leg deliberately never reads `options.previewCapture`.
	let disposed = false;
	let socket: WebSocket | null = null;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let session: ProductionBridgeSessionResponse | null = null;
	const unsubscribeDescriptor = subscribeBridgeDescriptorUpdates(() => socket);

	const scheduleReconnect = (): void => {
		if (disposed || reconnectTimer) return;
		reconnectTimer = setTimeout(() => {
			reconnectTimer = null;
			void connect();
		}, RECONNECT_DELAY_MS);
	};

	const connect = async (): Promise<void> => {
		if (disposed) return;
		store.setStatus("connecting");
		store.setRemoteError(null);
		try {
			if (!session || session.expiresAt <= Date.now() + RECONNECT_DELAY_MS) {
				session = await createBridgeSession();
				store.setRemoteSession({
					baseUrl: session.bridge.baseUrl,
					sessionId: session.bridge.sessionId,
					token: session.bridge.token,
					expiresAt: session.expiresAt,
				});
			}
		} catch {
			if (!disposed) {
				store.setStatus("disconnected");
				store.setRemoteSession(null);
				store.setRemoteError(
					"MCP bridge session could not be created. Sign in and reload this editor with ?agentBridge=1.",
				);
				scheduleReconnect();
			}
			return;
		}

		const ws = new WebSocket(session.editorWebSocketUrl);
		socket = ws;

		ws.addEventListener("open", () => {
			ws.send(
				encodeAgentBridgeMessage({
					kind: "hello",
					protocol: AGENT_BRIDGE_PROTOCOL_VERSION,
					role: "editor",
					clientId: crypto.randomUUID(),
					editor: currentBridgeEditorDescriptor(),
				}),
			);
		});

		ws.addEventListener("message", async (event: MessageEvent) => {
			const raw =
				typeof event.data === "string" ? event.data : String(event.data);
			const parsed = parseAgentBridgeMessage(raw);
			if (!parsed.ok) return;
			const message = parsed.message;
			if (message.kind === "hello-ack") {
				store.setStatus(message.accepted ? "connected" : "disconnected");
				return;
			}
			if (message.kind === "request") {
				const targetError = validateBridgeRequestTarget(message);
				if (targetError) {
					ws.send(encodeAgentBridgeMessage(targetError));
					return;
				}
				const requestFence = captureEditorBindingFence();
				const response = await dispatchAgentBridgeRequest(message, {
					validate: validateWithSessionTracking,
					apply: applyWithActivityTracking,
					observe: observeLiveDocument,
					requestApproval: (review, request) =>
						bindingFencedApproval(
							requestFence,
							requestApproval(review, request),
						),
					requestProjectSaveApproval: (request) =>
						bindingFencedApproval(
							requestFence,
							requestProjectSaveApproval(request, options),
						),
					saveProject: options.saveProject,
					...productionPreviewCaptureDeps(),
					notifyBlocked: (review) =>
						store.setRemoteError(
							review.blockedReason ?? "エージェント編集がブロックされました",
						),
				});
				ws.send(
					encodeAgentBridgeMessage(
						withLiveSelection(response, options.getLiveSelectionSnapshot),
					),
				);
			}
		});

		ws.addEventListener("close", () => {
			if (socket === ws) socket = null;
			// No capture session can ever begin on this leg (see
			// `productionPreviewCaptureDeps`), so there is nothing to abandon here,
			// unlike the local leg's close handler.
			if (disposed) return;
			store.cancelPending("Agent bridge disconnected before approval.");
			store.setStatus("disconnected");
			scheduleReconnect();
		});

		ws.addEventListener("error", () => {
			store.cancelPending("Agent bridge connection failed before approval.");
			ws.close();
		});
	};

	void connect();

	return () => {
		disposed = true;
		if (reconnectTimer) clearTimeout(reconnectTimer);
		unsubscribeDescriptor();
		socket?.close();
		store.cancelPending("Agent bridge was closed before approval.");
		store.setRemoteSession(null);
		store.setStatus("idle");
		store.setTransportKind(null);
	};
};
