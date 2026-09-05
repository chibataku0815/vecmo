#!/usr/bin/env bun

import {
	AGENT_BRIDGE_PROTOCOL_VERSION,
	type AgentBridgeMessage,
	encodeAgentBridgeMessage,
	parseAgentBridgeMessage,
} from "../src/entities/agent/model/bridge-protocol";
import type { AgentCommandPlanRequest } from "../src/entities/agent/model/types";
import { useMotionStore } from "../src/entities/motion/model/store";
import { useSceneStore } from "../src/entities/scene/model/store";
import { dispatchAgentBridgeRequest } from "../src/features/agent/model/bridge-dispatch";
import {
	applyApprovedAgentCommandPlan,
	validateAgentCommandPlan,
} from "../src/features/agent/model/review-apply";
import { connectAgentBridgeClient } from "./agent-bridge-client";
import { forwardLivePlan } from "./agent-bridge-forward";
import { startAgentBridgeRelay } from "./agent-bridge-relay";

/**
 * Headless end-to-end proof of the live bridge transport. Unlike the unit tests
 * (which call the pure functions directly), this opens REAL loopback WebSockets:
 * a fake editor that runs the real dispatcher + command bus, and a real agent
 * client. It proves the validate→apply→result round trip, the origin/token
 * gates, and the no-editor failure path before any browser is involved.
 */

const SMOKE_NODE_NAME = "Bridge Smoke Rect";

const appendPlan: AgentCommandPlanRequest = {
	planId: "smoke-append",
	intent: "Append a smoke-test rectangle to the default layer.",
	sceneCommands: [
		{
			type: "scene/append-node",
			node: {
				name: SMOKE_NODE_NAME,
				geometry: {
					kind: "rect",
					bounds: { x: 40, y: 40, width: 120, height: 80 },
				},
			},
		},
	],
	includeValidation: false,
};

const assert = (condition: boolean, message: string): void => {
	if (!condition) throw new Error(`smoke assertion failed: ${message}`);
	process.stdout.write(`  ok: ${message}\n`);
};

const liveSceneNodeNames = (): readonly string[] =>
	useSceneStore
		.getState()
		.document.layers.flatMap((layer) => layer.nodes)
		.map((node) => node.name);

type FakeEditor = { socket: WebSocket; close: () => void };

const startFakeEditor = (
	port: number,
	origin: string,
	approve: boolean,
): Promise<FakeEditor> =>
	new Promise<FakeEditor>((resolve, reject) => {
		const socket = new WebSocket(`ws://127.0.0.1:${port}`, {
			headers: { Origin: origin },
		});
		const timer = setTimeout(
			() => reject(new Error("fake editor connect timed out")),
			5_000,
		);
		const send = (message: AgentBridgeMessage): void =>
			socket.send(encodeAgentBridgeMessage(message));

		socket.addEventListener("open", () => {
			send({
				kind: "hello",
				protocol: AGENT_BRIDGE_PROTOCOL_VERSION,
				role: "editor",
				clientId: "smoke-editor",
			});
		});
		socket.addEventListener("error", () => {
			clearTimeout(timer);
			reject(new Error("fake editor connection error"));
		});
		socket.addEventListener("message", async (event: MessageEvent) => {
			const raw =
				typeof event.data === "string" ? event.data : String(event.data);
			const parsed = parseAgentBridgeMessage(raw);
			if (!parsed.ok) return;
			const message = parsed.message;
			if (message.kind === "hello-ack") {
				clearTimeout(timer);
				if (!message.accepted) {
					reject(new Error(`fake editor rejected: ${message.reason}`));
					return;
				}
				resolve({ socket, close: () => socket.close() });
				return;
			}
			if (message.kind === "request") {
				const response = await dispatchAgentBridgeRequest(message, {
					validate: validateAgentCommandPlan,
					apply: applyApprovedAgentCommandPlan,
					requestApproval: async () => ({
						approved: approve,
						reviewer: "smoke",
					}),
				});
				send(response);
			}
		});
	});

const main = async (): Promise<void> => {
	useSceneStore.getState().reset();
	useMotionStore.getState().reset();

	const relay = await startAgentBridgeRelay({ writeDiscovery: false });
	process.stdout.write(`relay on ws://127.0.0.1:${relay.port}\n`);

	try {
		process.stdout.write("token gate:\n");
		let tokenRejected = false;
		try {
			await connectAgentBridgeClient({
				port: relay.port,
				token: "wrong-token",
			});
		} catch {
			tokenRejected = true;
		}
		assert(tokenRejected, "relay rejects an agent presenting an invalid token");

		process.stdout.write("no-editor path:\n");
		const lonely = await connectAgentBridgeClient({
			port: relay.port,
			token: relay.token,
		});
		assert(
			!lonely.editorConnected(),
			"agent reports no editor before one connects",
		);
		let noEditorError = false;
		try {
			await lonely.request("validate", appendPlan, 3_000);
		} catch (error) {
			noEditorError = String(error).includes("no-live-editor");
		}
		assert(
			noEditorError,
			"a request without a live editor returns no-live-editor",
		);
		lonely.close();

		const editor = await startFakeEditor(
			relay.port,
			"http://localhost:5173",
			true,
		);

		process.stdout.write("validate (no mutation):\n");
		const agent = await connectAgentBridgeClient({
			port: relay.port,
			token: relay.token,
		});
		assert(
			agent.editorConnected(),
			"agent sees the live editor after it connects",
		);
		const sceneBefore = useSceneStore.getState().document;
		const validateResult = await agent.request("validate", appendPlan);
		assert(validateResult.ready, "validate review is ready");
		assert(!validateResult.applied, "validate does not apply");
		assert(
			useSceneStore.getState().document === sceneBefore,
			"validate left the live scene document untouched",
		);
		assert(
			!liveSceneNodeNames().includes(SMOKE_NODE_NAME),
			"validate did not create the node",
		);

		process.stdout.write("forward adapter validate:\n");
		const forwardedValidate = await forwardLivePlan("validate", appendPlan, {
			kind: "local",
			port: relay.port,
			token: relay.token,
		});
		assert(forwardedValidate.ok, "forwardLivePlan reaches the live editor");
		if (forwardedValidate.ok) {
			assert(
				forwardedValidate.result.ready,
				"forwardLivePlan returns the editor validation result",
			);
			assert(
				!forwardedValidate.result.applied,
				"forwardLivePlan validate remains non-mutating",
			);
		}

		process.stdout.write("apply (human-approved):\n");
		const applyResult = await agent.request("apply", appendPlan);
		assert(applyResult.applied, "apply reports applied");
		assert(applyResult.changed, "apply changed the document");
		assert(
			liveSceneNodeNames().includes(SMOKE_NODE_NAME),
			"the agent-created rectangle is present in the live scene",
		);

		// Created-resource id contract: the apply result is built from ONE compile,
		// so plan.steps must name the same committed ids as appliedCommands, and
		// those ids must exist in the live document.
		const appliedScene = applyResult.appliedCommands.find(
			(entry) => entry.store === "scene",
		);
		const appliedIds = (appliedScene?.affected ?? []).map(
			(target) => target.id,
		);
		assert(
			appliedIds.length === appendPlan.sceneCommands?.length,
			"appliedCommands[].affected has one committed target per command",
		);
		const sceneStep = applyResult.plan.steps.find(
			(step) => step.id === "scene-commands",
		);
		assert(
			sceneStep !== undefined &&
				sceneStep.affected.length > 0 &&
				sceneStep.affected.every((target) => appliedIds.includes(target.id)),
			"plan.steps carries the same committed ids as appliedCommands (single compile)",
		);
		const createdId = appliedIds[0];
		assert(
			createdId !== undefined &&
				useSceneStore
					.getState()
					.document.layers.flatMap((layer) => layer.nodes)
					.some((node) => node.id === createdId),
			"the appliedCommands id resolves to a real node in the live scene",
		);

		agent.close();
		editor.close();
		process.stdout.write("\nagent-bridge smoke PASSED\n");
	} finally {
		await relay.stop();
	}
};

await main();
