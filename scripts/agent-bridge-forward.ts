import type {
	AgentBridgeObserveResult,
	AgentBridgePreviewObserveResult,
	AgentBridgeProjectSaveRequest,
	AgentBridgeProjectSaveResult,
	AgentBridgeRequestTarget,
} from "../src/entities/agent/model/bridge-protocol";
import type {
	AgentCommandPlanRequest,
	AgentCommandPlanResult,
} from "../src/entities/agent/model/types";
import {
	type AgentBridgeClient,
	type ConnectAgentBridgeOptions,
	connectAgentBridgeClient,
} from "./agent-bridge-client";
import { readBridgeDiscovery } from "./agent-bridge-discovery";

/**
 * Forwards a typed edit plan to the live editor over the local bridge. This is
 * the single code path shared by the MCP `*_edit_plan_live` tools and the poke
 * CLI: discover the relay, connect with the token, send the plan, and await the
 * editor's human-gated result. It never falls back to a sandbox — if no relay or
 * editor is present it returns an honest error so the agent knows nothing landed.
 */
export type ForwardLiveOutcome =
	| { readonly ok: true; readonly result: AgentCommandPlanResult }
	| { readonly ok: false; readonly code: string; readonly error: string };

export type ForwardLiveProjectSaveOutcome =
	| { readonly ok: true; readonly result: AgentBridgeProjectSaveResult }
	| { readonly ok: false; readonly code: string; readonly error: string };

export type ForwardLiveObserveOutcome =
	| { readonly ok: true; readonly result: AgentBridgeObserveResult }
	| { readonly ok: false; readonly code: string; readonly error: string };

/**
 * Extracts the real `agent.*` code the relay/editor embedded in a bridge
 * request error, instead of collapsing every non-allowlisted failure to the
 * generic fallback. `message` is `String(error)` from a `client.request()`
 * rejection, which carries an `Error: ` prefix (`Error.prototype.toString`),
 * so the pattern is intentionally unanchored — an anchored `^agent\.` would
 * never match past that prefix. This only ever matches the code the relay put
 * first in `${code}: ${message}` (see agent-bridge-client.ts's `error` frame
 * handling); a timeout/connection-closed message has no `agent.` token and
 * falls through to the allowlist, then the generic fallback, unchanged.
 */
const bridgeRequestErrorCode = (message: string): string => {
	const embeddedCode = message.match(/agent\.[a-z0-9-]+(?=:)/);
	if (embeddedCode) return embeddedCode[0];
	for (const code of [
		"agent.no-live-editor",
		"agent.editor-target-required",
		"agent.editor-target-not-found",
		"agent.editor-binding-mismatch",
	]) {
		if (message.includes(code)) return code;
	}
	return "agent.bridge-request-failed";
};

export type AgentBridgeForwardTarget =
	| {
			readonly kind: "local";
			readonly port?: number;
			readonly token?: string;
			readonly hostname?: string;
			readonly editorInstanceId?: string;
			readonly workingCopyId?: string;
			readonly projectId?: string | null;
			readonly bindingEpoch?: number;
	  }
	| {
			readonly kind: "remote";
			readonly baseUrl?: string;
			readonly sessionId?: string;
			readonly token: string;
			readonly url?: string;
			readonly editorInstanceId?: string;
			readonly workingCopyId?: string;
			readonly projectId?: string | null;
			readonly bindingEpoch?: number;
	  };

const requestTargetFromBridge = (
	target: AgentBridgeForwardTarget,
): AgentBridgeRequestTarget | undefined =>
	target.editorInstanceId
		? {
				editorInstanceId: target.editorInstanceId,
				...(target.workingCopyId
					? { workingCopyId: target.workingCopyId }
					: {}),
				...(target.projectId !== undefined
					? { projectId: target.projectId }
					: {}),
				...(target.bindingEpoch !== undefined
					? { bindingEpoch: target.bindingEpoch }
					: {}),
			}
		: undefined;

const remoteTargetFromEnv = (): AgentBridgeForwardTarget | null => {
	const token = process.env.VMA_AGENT_BRIDGE_TOKEN;
	const url = process.env.VMA_AGENT_BRIDGE_URL;
	const sessionId = process.env.VMA_AGENT_BRIDGE_SESSION_ID;
	const baseUrl = process.env.VMA_AGENT_BRIDGE_BASE_URL;
	const editorInstanceId = process.env.VMA_AGENT_BRIDGE_EDITOR_ID;
	if (!token) return null;
	if (url)
		return {
			kind: "remote",
			token,
			url,
			...(editorInstanceId ? { editorInstanceId } : {}),
		};
	if (baseUrl && sessionId)
		return {
			kind: "remote",
			baseUrl,
			sessionId,
			token,
			...(editorInstanceId ? { editorInstanceId } : {}),
		};
	return null;
};

export type ListLiveEditorsOutcome =
	| {
			readonly ok: true;
			readonly editors: ReturnType<
				Awaited<ReturnType<typeof connectAgentBridgeClient>>["editors"]
			>;
	  }
	| { readonly ok: false; readonly code: string; readonly error: string };

/** Returns the routable editor descriptors currently registered by a relay. */
export const listLiveEditors = async (
	target?: AgentBridgeForwardTarget,
): Promise<ListLiveEditorsOutcome> => {
	const resolved = target ?? remoteTargetFromEnv();
	const discovery = resolved ? null : await readBridgeDiscovery();
	if (!resolved && !discovery) {
		return {
			ok: false,
			code: "agent.bridge-relay-not-running",
			error: "No agent bridge relay is running.",
		};
	}
	const url = resolved?.kind === "remote" ? remoteWebSocketUrl(resolved) : null;
	try {
		const client = await connectAgentBridgeClient(
			resolved?.kind === "remote"
				? { url: url as string, token: resolved.token }
				: resolved?.kind === "local"
					? {
							port: resolved.port ?? discovery?.port,
							token: resolved.token ?? discovery?.token ?? "",
							hostname: resolved.hostname,
						}
					: { port: discovery?.port, token: discovery?.token ?? "" },
		);
		const editors = client.editors();
		client.close();
		return { ok: true, editors };
	} catch (error) {
		return {
			ok: false,
			code: "agent.bridge-connect-failed",
			error: String(error),
		};
	}
};

const remoteWebSocketUrl = (
	target: Extract<AgentBridgeForwardTarget, { readonly kind: "remote" }>,
): string | null => {
	if (target.url) return target.url;
	if (!target.baseUrl || !target.sessionId) return null;
	const url = new URL(
		`/api/agent-bridge/${encodeURIComponent(target.sessionId)}`,
		target.baseUrl,
	);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	url.searchParams.set("role", "agent");
	return url.toString();
};

type ResolvedForwardConnection =
	| { readonly ok: true; readonly options: ConnectAgentBridgeOptions }
	| { readonly ok: false; readonly code: string; readonly error: string };

/**
 * Resolves an explicit target, the env remote target, or local discovery into
 * {@link ConnectAgentBridgeOptions}. Extracted so the Phase D preview ops reuse
 * the same discover/target logic without duplicating the three-branch connect
 * body of the plan/save/observe forwards above.
 */
const resolveForwardConnection = async (
	target: AgentBridgeForwardTarget | null | undefined,
): Promise<ResolvedForwardConnection> => {
	const resolvedTarget = target === undefined ? remoteTargetFromEnv() : target;
	if (
		resolvedTarget?.kind === "local" &&
		resolvedTarget.port !== undefined &&
		resolvedTarget.token !== undefined
	) {
		return {
			ok: true,
			options: {
				port: resolvedTarget.port,
				token: resolvedTarget.token,
				hostname: resolvedTarget.hostname,
				target: requestTargetFromBridge(resolvedTarget),
			},
		};
	}
	if (resolvedTarget?.kind === "remote") {
		const url = remoteWebSocketUrl(resolvedTarget);
		if (!url) {
			return {
				ok: false,
				code: "agent.bridge-remote-target-invalid",
				error:
					"Remote bridge config must provide either url or baseUrl plus sessionId.",
			};
		}
		return {
			ok: true,
			options: {
				url,
				token: resolvedTarget.token,
				target: requestTargetFromBridge(resolvedTarget),
			},
		};
	}
	const discovery = await readBridgeDiscovery();
	if (!discovery) {
		return {
			ok: false,
			code: "agent.bridge-relay-not-running",
			error:
				"No agent bridge relay is running. Start it with `bun run agent:bridge`, then open the editor in a dev browser tab.",
		};
	}
	return {
		ok: true,
		options: {
			port: discovery.port,
			token: discovery.token,
			...(resolvedTarget?.kind === "local" && resolvedTarget.editorInstanceId
				? { target: requestTargetFromBridge(resolvedTarget) }
				: process.env.VMA_AGENT_BRIDGE_EDITOR_ID
					? {
							target: {
								editorInstanceId: process.env.VMA_AGENT_BRIDGE_EDITOR_ID,
							},
						}
					: {}),
		},
	};
};

export const forwardLivePlan = async (
	op: "validate" | "apply",
	plan: AgentCommandPlanRequest,
	target?: AgentBridgeForwardTarget | null,
): Promise<ForwardLiveOutcome> => {
	const resolvedTarget = target === undefined ? remoteTargetFromEnv() : target;
	if (
		resolvedTarget?.kind === "local" &&
		resolvedTarget.port !== undefined &&
		resolvedTarget.token !== undefined
	) {
		let client: Awaited<ReturnType<typeof connectAgentBridgeClient>>;
		try {
			client = await connectAgentBridgeClient({
				port: resolvedTarget.port,
				token: resolvedTarget.token,
				hostname: resolvedTarget.hostname,
				target: requestTargetFromBridge(resolvedTarget),
			});
		} catch (error) {
			return {
				ok: false,
				code: "agent.bridge-connect-failed",
				error: `Failed to connect to the agent bridge relay: ${String(error)}`,
			};
		}

		try {
			const result = await client.request(op, plan);
			return { ok: true, result };
		} catch (error) {
			const message = String(error);
			const code = bridgeRequestErrorCode(message);
			return { ok: false, code, error: message };
		} finally {
			client.close();
		}
	}

	if (resolvedTarget?.kind === "remote") {
		const url = remoteWebSocketUrl(resolvedTarget);
		if (!url) {
			return {
				ok: false,
				code: "agent.bridge-remote-target-invalid",
				error:
					"Remote bridge config must provide either url or baseUrl plus sessionId.",
			};
		}

		let client: Awaited<ReturnType<typeof connectAgentBridgeClient>>;
		try {
			client = await connectAgentBridgeClient({
				url,
				token: resolvedTarget.token,
				target: requestTargetFromBridge(resolvedTarget),
			});
		} catch (error) {
			return {
				ok: false,
				code: "agent.bridge-connect-failed",
				error: `Failed to connect to the remote agent bridge: ${String(error)}`,
			};
		}

		try {
			const result = await client.request(op, plan);
			return { ok: true, result };
		} catch (error) {
			const message = String(error);
			const code = bridgeRequestErrorCode(message);
			return { ok: false, code, error: message };
		} finally {
			client.close();
		}
	}

	const discovery = await readBridgeDiscovery();
	if (!discovery) {
		return {
			ok: false,
			code: "agent.bridge-relay-not-running",
			error:
				"No agent bridge relay is running. Start it with `bun run agent:bridge`, then open the editor in a dev browser tab.",
		};
	}

	let client: Awaited<ReturnType<typeof connectAgentBridgeClient>>;
	try {
		client = await connectAgentBridgeClient({
			port: discovery.port,
			token: discovery.token,
			...(resolvedTarget?.kind === "local" && resolvedTarget.editorInstanceId
				? { target: requestTargetFromBridge(resolvedTarget) }
				: process.env.VMA_AGENT_BRIDGE_EDITOR_ID
					? {
							target: {
								editorInstanceId: process.env.VMA_AGENT_BRIDGE_EDITOR_ID,
							},
						}
					: {}),
		});
	} catch (error) {
		return {
			ok: false,
			code: "agent.bridge-connect-failed",
			error: `Failed to connect to the agent bridge relay: ${String(error)}`,
		};
	}

	try {
		const result = await client.request(op, plan);
		return { ok: true, result };
	} catch (error) {
		const message = String(error);
		const code = bridgeRequestErrorCode(message);
		return { ok: false, code, error: message };
	} finally {
		client.close();
	}
};

export const forwardLiveProjectSave = async (
	request: AgentBridgeProjectSaveRequest,
	target?: AgentBridgeForwardTarget | null,
): Promise<ForwardLiveProjectSaveOutcome> => {
	const resolvedTarget = target === undefined ? remoteTargetFromEnv() : target;
	if (
		resolvedTarget?.kind === "local" &&
		resolvedTarget.port !== undefined &&
		resolvedTarget.token !== undefined
	) {
		let client: Awaited<ReturnType<typeof connectAgentBridgeClient>>;
		try {
			client = await connectAgentBridgeClient({
				port: resolvedTarget.port,
				token: resolvedTarget.token,
				hostname: resolvedTarget.hostname,
				target: requestTargetFromBridge(resolvedTarget),
			});
		} catch (error) {
			return {
				ok: false,
				code: "agent.bridge-connect-failed",
				error: `Failed to connect to the agent bridge relay: ${String(error)}`,
			};
		}

		try {
			const result = await client.saveProject(request);
			return { ok: true, result };
		} catch (error) {
			const message = String(error);
			const code = bridgeRequestErrorCode(message);
			return { ok: false, code, error: message };
		} finally {
			client.close();
		}
	}

	if (resolvedTarget?.kind === "remote") {
		const url = remoteWebSocketUrl(resolvedTarget);
		if (!url) {
			return {
				ok: false,
				code: "agent.bridge-remote-target-invalid",
				error:
					"Remote bridge config must provide either url or baseUrl plus sessionId.",
			};
		}

		let client: Awaited<ReturnType<typeof connectAgentBridgeClient>>;
		try {
			client = await connectAgentBridgeClient({
				url,
				token: resolvedTarget.token,
				target: requestTargetFromBridge(resolvedTarget),
			});
		} catch (error) {
			return {
				ok: false,
				code: "agent.bridge-connect-failed",
				error: `Failed to connect to the remote agent bridge: ${String(error)}`,
			};
		}

		try {
			const result = await client.saveProject(request);
			return { ok: true, result };
		} catch (error) {
			const message = String(error);
			const code = bridgeRequestErrorCode(message);
			return { ok: false, code, error: message };
		} finally {
			client.close();
		}
	}

	const discovery = await readBridgeDiscovery();
	if (!discovery) {
		return {
			ok: false,
			code: "agent.bridge-relay-not-running",
			error:
				"No agent bridge relay is running. Start it with `bun run agent:bridge`, then open the editor in a dev browser tab.",
		};
	}

	let client: Awaited<ReturnType<typeof connectAgentBridgeClient>>;
	try {
		client = await connectAgentBridgeClient({
			port: discovery.port,
			token: discovery.token,
			...(resolvedTarget?.kind === "local" && resolvedTarget.editorInstanceId
				? { target: requestTargetFromBridge(resolvedTarget) }
				: process.env.VMA_AGENT_BRIDGE_EDITOR_ID
					? {
							target: {
								editorInstanceId: process.env.VMA_AGENT_BRIDGE_EDITOR_ID,
							},
						}
					: {}),
		});
	} catch (error) {
		return {
			ok: false,
			code: "agent.bridge-connect-failed",
			error: `Failed to connect to the agent bridge relay: ${String(error)}`,
		};
	}

	try {
		const result = await client.saveProject(request);
		return { ok: true, result };
	} catch (error) {
		const message = String(error);
		const code = bridgeRequestErrorCode(message);
		return { ok: false, code, error: message };
	} finally {
		client.close();
	}
};

/**
 * Forwards the read-only live-document observation (B2) to the live editor.
 * Same target-fenced connect/discover/error shape as {@link forwardLiveProjectSave}
 * and {@link forwardLivePlan} — never falls back to a headless snapshot.
 */
export const forwardLiveObservation = async (
	target?: AgentBridgeForwardTarget | null,
): Promise<ForwardLiveObserveOutcome> => {
	const resolvedTarget = target === undefined ? remoteTargetFromEnv() : target;
	if (
		resolvedTarget?.kind === "local" &&
		resolvedTarget.port !== undefined &&
		resolvedTarget.token !== undefined
	) {
		let client: Awaited<ReturnType<typeof connectAgentBridgeClient>>;
		try {
			client = await connectAgentBridgeClient({
				port: resolvedTarget.port,
				token: resolvedTarget.token,
				hostname: resolvedTarget.hostname,
				target: requestTargetFromBridge(resolvedTarget),
			});
		} catch (error) {
			return {
				ok: false,
				code: "agent.bridge-connect-failed",
				error: `Failed to connect to the agent bridge relay: ${String(error)}`,
			};
		}

		try {
			const result = await client.observe();
			return { ok: true, result };
		} catch (error) {
			const message = String(error);
			const code = bridgeRequestErrorCode(message);
			return { ok: false, code, error: message };
		} finally {
			client.close();
		}
	}

	if (resolvedTarget?.kind === "remote") {
		const url = remoteWebSocketUrl(resolvedTarget);
		if (!url) {
			return {
				ok: false,
				code: "agent.bridge-remote-target-invalid",
				error:
					"Remote bridge config must provide either url or baseUrl plus sessionId.",
			};
		}

		let client: Awaited<ReturnType<typeof connectAgentBridgeClient>>;
		try {
			client = await connectAgentBridgeClient({
				url,
				token: resolvedTarget.token,
				target: requestTargetFromBridge(resolvedTarget),
			});
		} catch (error) {
			return {
				ok: false,
				code: "agent.bridge-connect-failed",
				error: `Failed to connect to the remote agent bridge: ${String(error)}`,
			};
		}

		try {
			const result = await client.observe();
			return { ok: true, result };
		} catch (error) {
			const message = String(error);
			const code = bridgeRequestErrorCode(message);
			return { ok: false, code, error: message };
		} finally {
			client.close();
		}
	}

	const discovery = await readBridgeDiscovery();
	if (!discovery) {
		return {
			ok: false,
			code: "agent.bridge-relay-not-running",
			error:
				"No agent bridge relay is running. Start it with `bun run agent:bridge`, then open the editor in a dev browser tab.",
		};
	}

	let client: Awaited<ReturnType<typeof connectAgentBridgeClient>>;
	try {
		client = await connectAgentBridgeClient({
			port: discovery.port,
			token: discovery.token,
			...(resolvedTarget?.kind === "local" && resolvedTarget.editorInstanceId
				? { target: requestTargetFromBridge(resolvedTarget) }
				: process.env.VMA_AGENT_BRIDGE_EDITOR_ID
					? {
							target: {
								editorInstanceId: process.env.VMA_AGENT_BRIDGE_EDITOR_ID,
							},
						}
					: {}),
		});
	} catch (error) {
		return {
			ok: false,
			code: "agent.bridge-connect-failed",
			error: `Failed to connect to the agent bridge relay: ${String(error)}`,
		};
	}

	try {
		const result = await client.observe();
		return { ok: true, result };
	} catch (error) {
		const message = String(error);
		const code = bridgeRequestErrorCode(message);
		return { ok: false, code, error: message };
	} finally {
		client.close();
	}
};

type ResolvedPreviewTargetOutcome =
	| { readonly ok: true; readonly target: AgentBridgeForwardTarget }
	| { readonly ok: false; readonly code: string; readonly error: string };

/**
 * Fail-closed target pinning for the Phase D preview/capture ops (adversarial
 * review M1-2, and the follow-up live-smoke fence defect). The relay/Durable
 * Object backfill (`message.target?.workingCopyId ?? descriptor.workingCopyId`)
 * means an UNPINNED request would silently dispatch against whatever document
 * is currently bound at delivery time — so every `preview-observe`/
 * `preview-capture` request must already carry `editorInstanceId` +
 * `workingCopyId` + `bindingEpoch` before this module ever opens a
 * connection, turning a later document/epoch switch into a hard
 * `agent.editor-binding-mismatch` instead of a silent retarget. Three cases:
 * (a) all three supplied — used VERBATIM, including a wrong value, so a bad
 * pin fails closed at the editor's own fence instead of being "corrected"
 * (see `agent-bridge-client.ts`'s hello-ack handler, which used to
 * unconditionally overwrite the whole target from the connected editor's
 * descriptor whenever `editorInstanceId` matched — the actual root cause of
 * that defect — and now only backfills fields the caller left unspecified);
 * (b) some but not all three supplied — a typed `agent.preview-target-incomplete`
 * failure BEFORE connecting, never completed from discovery; (c) none
 * supplied — discovers connected editors on the same target (env remote
 * target or local relay discovery, via {@link listLiveEditors}) and pins the
 * sole result; zero or multiple candidates is a typed
 * `agent.preview-target-required` failure listing what was found. Does not
 * touch the relay or worker backfill logic itself.
 */
const resolvePinnedPreviewTarget = async (
	target: AgentBridgeForwardTarget | null | undefined,
): Promise<ResolvedPreviewTargetOutcome> => {
	if (
		target?.editorInstanceId &&
		target.workingCopyId &&
		target.bindingEpoch !== undefined
	) {
		return { ok: true, target };
	}
	const suppliedAnyPin =
		Boolean(target?.editorInstanceId) ||
		Boolean(target?.workingCopyId) ||
		target?.bindingEpoch !== undefined;
	if (suppliedAnyPin) {
		return {
			ok: false,
			code: "agent.preview-target-incomplete",
			error:
				"Native capture requires editorInstanceId, workingCopyId, and bindingEpoch together — a partial target is rejected rather than silently completed from discovery. Supply all three (see `live editors`), or omit all three to auto-pin the sole connected editor.",
		};
	}
	const discovered = await listLiveEditors(target ?? undefined);
	if (!discovered.ok) {
		return { ok: false, code: discovered.code, error: discovered.error };
	}
	if (discovered.editors.length !== 1) {
		const found =
			discovered.editors.length === 0
				? "No live editor is connected."
				: `Multiple live editors are connected (${discovered.editors
						.map(
							(editor) =>
								`${editor.editorInstanceId} [workingCopyId=${editor.workingCopyId}, bindingEpoch=${editor.bindingEpoch}]`,
						)
						.join("; ")}).`;
		return {
			ok: false,
			code: "agent.preview-target-required",
			error: `${found} Native capture requires an unambiguous target: pass editorInstanceId, workingCopyId, and bindingEpoch explicitly (see \`live editors\`).`,
		};
	}
	const editor = discovered.editors[0];
	const resolvedBase: AgentBridgeForwardTarget =
		target === undefined
			? (remoteTargetFromEnv() ?? { kind: "local" })
			: (target ?? { kind: "local" });
	return {
		ok: true,
		target: {
			...resolvedBase,
			editorInstanceId: editor.editorInstanceId,
			workingCopyId: editor.workingCopyId,
			bindingEpoch: editor.bindingEpoch,
			projectId: editor.projectId,
		},
	};
};

export type ForwardLivePreviewObserveOutcome =
	| { readonly ok: true; readonly result: AgentBridgePreviewObserveResult }
	| { readonly ok: false; readonly code: string; readonly error: string };

/**
 * Forwards the read-only capture-readiness read (`preview-observe`) to the live
 * editor. Single-shot: connect, read, close — the same discover/target and error
 * shape as {@link forwardLiveObservation}, reusing {@link resolveForwardConnection}.
 * Pins the target (see {@link resolvePinnedPreviewTarget}) before connecting.
 */
export const forwardLivePreviewObserve = async (
	target?: AgentBridgeForwardTarget | null,
): Promise<ForwardLivePreviewObserveOutcome> => {
	const pinned = await resolvePinnedPreviewTarget(target);
	if (!pinned.ok) return pinned;
	const resolved = await resolveForwardConnection(pinned.target);
	if (!resolved.ok) return resolved;
	let client: AgentBridgeClient;
	try {
		client = await connectAgentBridgeClient(resolved.options);
	} catch (error) {
		return {
			ok: false,
			code: "agent.bridge-connect-failed",
			error: `Failed to connect to the agent bridge relay: ${String(error)}`,
		};
	}
	try {
		const result = await client.observePreview();
		return { ok: true, result };
	} catch (error) {
		const message = String(error);
		const code = bridgeRequestErrorCode(message);
		return { ok: false, code, error: message };
	} finally {
		client.close();
	}
};

export type OpenLivePreviewCaptureOutcome =
	| { readonly ok: true; readonly client: AgentBridgeClient }
	| { readonly ok: false; readonly code: string; readonly error: string };

/**
 * Opens a SINGLE persistent agent-leg connection for a native artboard capture
 * session (Phase D). The begin/capture/end loop must reuse one connection: the
 * editor restores playback when its bridge socket closes, so a per-request
 * reconnect would tear down the session between frames. The caller owns closing
 * the returned client (via try/finally) after ending the session. Pins the
 * target (see {@link resolvePinnedPreviewTarget}) before connecting.
 */
export const openLivePreviewCaptureClient = async (
	target?: AgentBridgeForwardTarget | null,
): Promise<OpenLivePreviewCaptureOutcome> => {
	const pinned = await resolvePinnedPreviewTarget(target);
	if (!pinned.ok) return pinned;
	const resolved = await resolveForwardConnection(pinned.target);
	if (!resolved.ok) return resolved;
	try {
		const client = await connectAgentBridgeClient(resolved.options);
		return { ok: true, client };
	} catch (error) {
		return {
			ok: false,
			code: "agent.bridge-connect-failed",
			error: `Failed to connect to the agent bridge relay: ${String(error)}`,
		};
	}
};
