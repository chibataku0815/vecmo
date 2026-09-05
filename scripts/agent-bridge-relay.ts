#!/usr/bin/env bun

import { randomUUID } from "node:crypto";
import {
	AGENT_BRIDGE_PROTOCOL_VERSION,
	type AgentBridgeEditorDescriptor,
	type AgentBridgeMessage,
	encodeAgentBridgeMessage,
	isLocalBridgeOrigin,
	parseAgentBridgeMessage,
} from "../src/entities/agent/model/bridge-protocol";
import {
	clearBridgeDiscovery,
	writeBridgeDiscovery,
} from "./agent-bridge-discovery";

/**
 * Local relay for the agent ⇄ live-editor bridge (Stage 5). The browser editor
 * cannot accept inbound connections, so both legs dial this loopback relay: the
 * editor tab connects outbound (gated by a local-origin allowlist) and the
 * headless agent (MCP server / poke) connects outbound with the discovery token.
 * The relay only routes envelopes — it never inspects or applies edits, which
 * keeps the command bus and approval gate entirely inside the editor.
 */

type ConnData = {
	origin: string | null;
	role: "agent" | "editor" | null;
	clientId: string | null;
	editorInstanceId: string | null;
};

/** Structural view of the Bun ServerWebSocket members this relay uses. */
type Ws = {
	data: ConnData;
	send: (data: string) => void;
	close: () => void;
};

export type AgentBridgeRelay = {
	readonly port: number;
	readonly token: string;
	readonly stop: () => Promise<void>;
};

export type StartAgentBridgeRelayOptions = {
	readonly port?: number;
	readonly token?: string;
	readonly hostname?: string;
	readonly writeDiscovery?: boolean;
};

export const startAgentBridgeRelay = async (
	options: StartAgentBridgeRelayOptions = {},
): Promise<AgentBridgeRelay> => {
	const token = options.token ?? randomUUID();
	const writeDiscovery = options.writeDiscovery !== false;
	const editors = new Map<
		string,
		{ readonly ws: Ws; readonly descriptor: AgentBridgeEditorDescriptor }
	>();
	const agents = new Set<Ws>();
	const pending = new Map<
		string,
		{ readonly agent: Ws; readonly editor: Ws }
	>();

	const send = (ws: Ws, message: AgentBridgeMessage): void =>
		ws.send(encodeAgentBridgeMessage(message));

	const reject = (ws: Ws, reason: string): void => {
		send(ws, {
			kind: "hello-ack",
			protocol: AGENT_BRIDGE_PROTOCOL_VERSION,
			accepted: false,
			reason,
		});
		ws.close();
	};

	const broadcastEditorStatus = (): void => {
		const descriptors = [...editors.values()].map((entry) => entry.descriptor);
		for (const agent of agents) {
			send(agent, {
				kind: "editor-status",
				editorConnected: descriptors.length > 0,
				editors: descriptors,
			});
		}
	};

	const handleHello = (ws: Ws, message: AgentBridgeMessage): void => {
		if (message.kind !== "hello") {
			reject(ws, "expected a hello handshake first");
			return;
		}
		if (message.protocol !== AGENT_BRIDGE_PROTOCOL_VERSION) {
			reject(
				ws,
				`bridge protocol version mismatch: relay protocol ${AGENT_BRIDGE_PROTOCOL_VERSION}, client offered ${message.protocol}. Restart the MCP server or Claude session so it reloads current code, or run \`bun run vmactl\` from this checkout.`,
			);
			return;
		}
		if (message.role === "editor") {
			if (!isLocalBridgeOrigin(ws.data.origin)) {
				reject(ws, "editor origin is not a local dev origin");
				return;
			}
			const descriptor = message.editor ?? {
				editorInstanceId: message.clientId,
				workingCopyId: `legacy:${message.clientId}`,
				projectId: null,
				bindingEpoch: 0,
			};
			ws.data.role = "editor";
			ws.data.clientId = message.clientId;
			ws.data.editorInstanceId = descriptor.editorInstanceId;
			const previous = editors.get(descriptor.editorInstanceId);
			if (previous && previous.ws !== ws) previous.ws.close();
			editors.set(descriptor.editorInstanceId, {
				ws,
				descriptor,
			});
			send(ws, {
				kind: "hello-ack",
				protocol: AGENT_BRIDGE_PROTOCOL_VERSION,
				accepted: true,
				sessionId: randomUUID(),
			});
			broadcastEditorStatus();
			return;
		}
		if (message.role === "agent") {
			if (message.token !== token) {
				reject(ws, "invalid bridge token");
				return;
			}
			ws.data.role = "agent";
			ws.data.clientId = message.clientId;
			agents.add(ws);
			send(ws, {
				kind: "hello-ack",
				protocol: AGENT_BRIDGE_PROTOCOL_VERSION,
				accepted: true,
				sessionId: randomUUID(),
				editorConnected: editors.size > 0,
				editors: [...editors.values()].map((entry) => entry.descriptor),
			});
			send(ws, {
				kind: "editor-status",
				editorConnected: editors.size > 0,
				editors: [...editors.values()].map((entry) => entry.descriptor),
			});
			return;
		}
		reject(ws, "unknown bridge role");
	};

	const route = (ws: Ws, message: AgentBridgeMessage): void => {
		if (ws.data.role === "agent") {
			if (message.kind !== "request") return;
			if (editors.size === 0) {
				send(ws, {
					kind: "error",
					id: message.id,
					code: "agent.no-live-editor",
					message: "no live editor is connected to the bridge",
				});
				return;
			}
			const target = message.target?.editorInstanceId
				? editors.get(message.target.editorInstanceId)
				: editors.size === 1
					? editors.values().next().value
					: undefined;
			if (!target) {
				send(ws, {
					kind: "error",
					id: message.id,
					code: message.target
						? "agent.editor-target-not-found"
						: "agent.editor-target-required",
					message: message.target
						? "the requested live editor is not connected"
						: "multiple live editors are connected; specify editorInstanceId",
				});
				return;
			}
			pending.set(message.id, {
				agent: ws,
				editor: target.ws,
			});
			send(target.ws, {
				...message,
				target: {
					editorInstanceId: target.descriptor.editorInstanceId,
					workingCopyId:
						message.target?.workingCopyId ?? target.descriptor.workingCopyId,
					projectId:
						message.target?.projectId !== undefined
							? message.target.projectId
							: target.descriptor.projectId,
					bindingEpoch:
						message.target?.bindingEpoch ?? target.descriptor.bindingEpoch,
				},
			});
			return;
		}
		if (message.kind === "editor-descriptor") {
			if (message.editor.editorInstanceId !== ws.data.editorInstanceId) return;
			editors.set(message.editor.editorInstanceId, {
				ws,
				descriptor: message.editor,
			});
			broadcastEditorStatus();
			return;
		}
		if (message.kind !== "response" && message.kind !== "error") return;
		const id = message.id;
		if (!id) return;
		const waiting = pending.get(id);
		if (waiting?.editor !== ws) return;
		pending.delete(id);
		if (waiting) send(waiting.agent, message);
	};

	const handleClose = (ws: Ws): void => {
		if (ws.data.role === "editor" && ws.data.editorInstanceId) {
			const registered = editors.get(ws.data.editorInstanceId);
			if (registered?.ws === ws) {
				editors.delete(ws.data.editorInstanceId);
				broadcastEditorStatus();
			}
			for (const [id, waiting] of pending) {
				if (waiting.editor !== ws) continue;
				send(waiting.agent, {
					kind: "error",
					id,
					code: "agent.live-editor-disconnected",
					message: "the live editor disconnected before responding",
				});
				pending.delete(id);
			}
			return;
		}
		if (ws.data.role === "agent") {
			agents.delete(ws);
			// Deleting the current key during Map iteration is spec-safe.
			for (const [id, waiting] of pending) {
				if (waiting.agent === ws) pending.delete(id);
			}
		}
	};

	const server = Bun.serve<ConnData, undefined>({
		port: options.port ?? 0,
		hostname: options.hostname ?? "127.0.0.1",
		fetch(request, bunServer) {
			const origin = request.headers.get("origin");
			const upgraded = bunServer.upgrade(request, {
				data: {
					origin,
					role: null,
					clientId: null,
					editorInstanceId: null,
				},
			});
			if (upgraded) return undefined;
			return new Response("vector-motion-author agent bridge relay", {
				status: 426,
			});
		},
		websocket: {
			message(ws, raw) {
				const text = typeof raw === "string" ? raw : raw.toString();
				const parsed = parseAgentBridgeMessage(text);
				if (!parsed.ok) {
					send(ws, {
						kind: "error",
						code: "agent.bridge-bad-frame",
						message: parsed.error,
					});
					return;
				}
				if (ws.data.role === null) {
					handleHello(ws, parsed.message);
					return;
				}
				route(ws, parsed.message);
			},
			close(ws) {
				handleClose(ws);
			},
		},
	});

	const port = server.port ?? 0;
	if (writeDiscovery) {
		await writeBridgeDiscovery({
			port,
			token,
			pid: process.pid,
			protocol: AGENT_BRIDGE_PROTOCOL_VERSION,
			startedAt: new Date().toISOString(),
		});
	}

	return {
		port,
		token,
		stop: async () => {
			server.stop(true);
			if (writeDiscovery) await clearBridgeDiscovery();
		},
	};
};

if (import.meta.main) {
	const relay = await startAgentBridgeRelay();
	process.stderr.write(
		`[agent-bridge] relay listening on ws://127.0.0.1:${relay.port} (token in .vma-agent-bridge)\n`,
	);
	const shutdown = async (): Promise<void> => {
		await relay.stop();
		process.exit(0);
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
}
