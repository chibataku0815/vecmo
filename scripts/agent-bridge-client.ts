import { randomUUID } from "node:crypto";
import {
	AGENT_BRIDGE_PROTOCOL_VERSION,
	type AgentBridgeEditorDescriptor,
	type AgentBridgeObserveRequest,
	type AgentBridgeObserveResult,
	type AgentBridgeOp,
	type AgentBridgePreviewCaptureRequest,
	type AgentBridgePreviewCaptureResult,
	type AgentBridgePreviewObserveRequest,
	type AgentBridgePreviewObserveResult,
	type AgentBridgeProjectSaveRequest,
	type AgentBridgeProjectSaveResult,
	type AgentBridgeRequestTarget,
	type AgentBridgeResponseResult,
	encodeAgentBridgeMessage,
	parseAgentBridgeMessage,
} from "../src/entities/agent/model/bridge-protocol";
import type {
	AgentCommandPlanRequest,
	AgentCommandPlanResult,
} from "../src/entities/agent/model/types";

/**
 * Agent-leg connector for the local bridge. Wraps a loopback WebSocket as a
 * promise-based request channel so the MCP server (and the poke CLI / smoke) can
 * forward an edit plan to the live editor and await the human-gated result. The
 * agent never approves: it proposes, and the editor's human decides.
 */
export type AgentBridgeClient = {
	editorConnected(): boolean;
	editors(): readonly AgentBridgeEditorDescriptor[];
	request(
		op: "validate" | "apply",
		plan: AgentCommandPlanRequest,
		timeoutMs?: number,
	): Promise<AgentCommandPlanResult>;
	saveProject(
		request: AgentBridgeProjectSaveRequest,
		timeoutMs?: number,
	): Promise<AgentBridgeProjectSaveResult>;
	/** Read-only live-document observation (B2) — never mutates, never prompts. */
	observe(
		request?: AgentBridgeObserveRequest,
		timeoutMs?: number,
	): Promise<AgentBridgeObserveResult>;
	/** Read-only native-capture readiness read (Phase D) — never mutates, never prompts. */
	observePreview(
		request?: AgentBridgePreviewObserveRequest,
		timeoutMs?: number,
	): Promise<AgentBridgePreviewObserveResult>;
	/**
	 * One step of a read-only native artboard capture session (Phase D). The
	 * begin/capture/end loop must run over a SINGLE client connection: the editor
	 * restores playback when its bridge socket closes, so a per-request reconnect
	 * would tear down the session between frames.
	 */
	capturePreview(
		request: AgentBridgePreviewCaptureRequest,
		timeoutMs?: number,
	): Promise<AgentBridgePreviewCaptureResult>;
	close(): void;
};

type PendingRequest = {
	resolve: (result: AgentBridgeResponseResult) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
};

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;

export type ConnectAgentBridgeOptions = {
	readonly token: string;
	readonly clientId?: string;
	readonly port?: number;
	readonly url?: string;
	readonly hostname?: string;
	readonly connectTimeoutMs?: number;
	readonly onEditorStatus?: (connected: boolean) => void;
	readonly target?: AgentBridgeRequestTarget;
};

export const connectAgentBridgeClient = (
	options: ConnectAgentBridgeOptions,
): Promise<AgentBridgeClient> => {
	const clientId = options.clientId ?? randomUUID();
	const host = options.hostname ?? "127.0.0.1";
	const socketUrl =
		options.url ?? (options.port ? `ws://${host}:${options.port}` : null);
	if (!socketUrl) {
		throw new Error("agent bridge client requires either url or port");
	}
	const socket = new WebSocket(socketUrl, {
		headers: {
			Authorization: `Bearer ${options.token}`,
			"x-vecmo-agent-token": options.token,
		},
	});
	const pending = new Map<string, PendingRequest>();
	let editorConnected = false;
	let editors: readonly AgentBridgeEditorDescriptor[] = [];
	let requestTarget = options.target;

	return new Promise<AgentBridgeClient>((resolve, rejectConnect) => {
		let connected = false;
		const connectTimer = setTimeout(() => {
			connected = true;
			socket.close();
			rejectConnect(new Error("agent bridge connect timed out"));
		}, options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS);

		const failAll = (error: Error): void => {
			for (const [, entry] of pending) {
				clearTimeout(entry.timer);
				entry.reject(error);
			}
			pending.clear();
		};

		socket.addEventListener("open", () => {
			socket.send(
				encodeAgentBridgeMessage({
					kind: "hello",
					protocol: AGENT_BRIDGE_PROTOCOL_VERSION,
					role: "agent",
					clientId,
					token: options.token,
				}),
			);
		});

		socket.addEventListener("close", () => {
			clearTimeout(connectTimer);
			if (!connected) {
				connected = true;
				rejectConnect(new Error("agent bridge connection closed"));
			}
			failAll(new Error("agent bridge connection closed"));
		});

		socket.addEventListener("error", () => {
			clearTimeout(connectTimer);
			if (!connected) {
				connected = true;
				rejectConnect(new Error("agent bridge connection error"));
			}
		});

		socket.addEventListener("message", (event: MessageEvent) => {
			const raw =
				typeof event.data === "string" ? event.data : String(event.data);
			const parsed = parseAgentBridgeMessage(raw);
			if (!parsed.ok) return;
			const message = parsed.message;
			if (message.kind === "hello-ack") {
				clearTimeout(connectTimer);
				if (!message.accepted) {
					if (!connected) {
						connected = true;
						rejectConnect(
							new Error(
								`agent bridge rejected: ${message.reason ?? "unknown"}`,
							),
						);
					}
					socket.close();
					return;
				}
				connected = true;
				editorConnected = message.editorConnected ?? false;
				editors = message.editors ?? [];
				if (requestTarget) {
					// Backfill ONLY the fields the caller left unspecified from the
					// matched editor's live descriptor — this is what lets an ordinary
					// live-apply/observe caller pass just `editorInstanceId` (per
					// `docs/live-mcp-agent-runbook.md`'s Multi-Editor Target Gate) and
					// have `workingCopyId`/`projectId`/`bindingEpoch` resolved for them.
					// A field the caller DID supply must survive untouched: the Phase D
					// native-capture ops require a wrong supplied pin to fail closed
					// with a binding mismatch, not get silently "corrected" to the real
					// value here before the request ever reaches the editor's own fence
					// (`validateBridgeRequestTarget`) — see
					// `resolvePinnedPreviewTarget` in `agent-bridge-forward.ts`.
					const descriptor = editors.find(
						(editor) =>
							editor.editorInstanceId === requestTarget?.editorInstanceId,
					);
					if (descriptor) {
						requestTarget = {
							editorInstanceId: requestTarget.editorInstanceId,
							workingCopyId:
								requestTarget.workingCopyId ?? descriptor.workingCopyId,
							projectId: requestTarget.projectId ?? descriptor.projectId,
							bindingEpoch:
								requestTarget.bindingEpoch ?? descriptor.bindingEpoch,
						};
					}
				}
				resolve({
					editorConnected: () => editorConnected,
					editors: () => editors,
					request: (op, plan, timeoutMs) =>
						sendRequest(op, plan, timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS).then(
							(result) => {
								if ("planId" in result) return result;
								throw new Error(
									"agent bridge returned project-save result for edit-plan request",
								);
							},
						),
					saveProject: (request, timeoutMs) =>
						sendRequest(
							"save-project",
							request,
							timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
						).then((result) => {
							if ("op" in result && result.op === "save-project") {
								return result;
							}
							throw new Error(
								"agent bridge returned edit-plan result for project-save request",
							);
						}),
					observe: (request, timeoutMs) =>
						sendRequest(
							"observe",
							request ?? {},
							timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
						).then((result) => {
							if ("op" in result && result.op === "observe") {
								return result;
							}
							throw new Error(
								"agent bridge returned a non-observe result for an observe request",
							);
						}),
					observePreview: (request, timeoutMs) =>
						sendRequest(
							"preview-observe",
							request ?? {},
							timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
						).then((result) => {
							if ("op" in result && result.op === "preview-observe") {
								return result;
							}
							throw new Error(
								"agent bridge returned a non-preview-observe result for a preview-observe request",
							);
						}),
					capturePreview: (request, timeoutMs) =>
						sendRequest(
							"preview-capture",
							request,
							timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
						).then((result) => {
							if ("op" in result && result.op === "preview-capture") {
								return result;
							}
							throw new Error(
								"agent bridge returned a non-preview-capture result for a preview-capture request",
							);
						}),
					close: () => socket.close(),
				});
				return;
			}
			if (message.kind === "editor-status") {
				editorConnected = message.editorConnected;
				editors = message.editors ?? [];
				options.onEditorStatus?.(message.editorConnected);
				return;
			}
			if (message.kind === "response") {
				const entry = pending.get(message.id);
				if (!entry) return;
				clearTimeout(entry.timer);
				pending.delete(message.id);
				entry.resolve(message.result);
				return;
			}
			if (message.kind === "error" && message.id) {
				const entry = pending.get(message.id);
				if (!entry) return;
				clearTimeout(entry.timer);
				pending.delete(message.id);
				entry.reject(new Error(`${message.code}: ${message.message}`));
			}
		});

		const sendRequest = (
			op: AgentBridgeOp,
			request:
				| AgentCommandPlanRequest
				| AgentBridgeProjectSaveRequest
				| AgentBridgeObserveRequest
				| AgentBridgePreviewObserveRequest
				| AgentBridgePreviewCaptureRequest,
			timeoutMs: number,
		): Promise<AgentBridgeResponseResult> =>
			new Promise<AgentBridgeResponseResult>(
				(resolveRequest, rejectRequest) => {
					const id = randomUUID();
					const timer = setTimeout(() => {
						pending.delete(id);
						rejectRequest(new Error(`agent bridge request ${op} timed out`));
					}, timeoutMs);
					pending.set(id, {
						resolve: resolveRequest,
						reject: rejectRequest,
						timer,
					});
					const message =
						op === "save-project"
							? ({
									kind: "request",
									id,
									op,
									request: request as AgentBridgeProjectSaveRequest,
									...(requestTarget ? { target: requestTarget } : {}),
								} as const)
							: op === "observe"
								? ({
										kind: "request",
										id,
										op,
										request: request as AgentBridgeObserveRequest,
										...(requestTarget ? { target: requestTarget } : {}),
									} as const)
								: op === "preview-observe"
									? ({
											kind: "request",
											id,
											op,
											request: request as AgentBridgePreviewObserveRequest,
											...(requestTarget ? { target: requestTarget } : {}),
										} as const)
									: op === "preview-capture"
										? ({
												kind: "request",
												id,
												op,
												request: request as AgentBridgePreviewCaptureRequest,
												...(requestTarget ? { target: requestTarget } : {}),
											} as const)
										: ({
												kind: "request",
												id,
												op,
												request: request as AgentCommandPlanRequest,
												...(requestTarget ? { target: requestTarget } : {}),
											} as const);
					socket.send(encodeAgentBridgeMessage(message));
				},
			);
	});
};
