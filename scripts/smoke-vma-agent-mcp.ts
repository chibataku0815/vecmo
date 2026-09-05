import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";

type JsonRpcResponse = {
	readonly jsonrpc: "2.0";
	readonly id?: number | string | null;
	readonly result?: unknown;
	readonly error?: unknown;
};

const child = spawn("bun", ["scripts/vma-agent-mcp.ts"], {
	cwd: process.cwd(),
	stdio: ["pipe", "pipe", "pipe"],
});

const responses = new Map<number | string, JsonRpcResponse>();
const stdout = createInterface({ input: child.stdout });
const stderrChunks: string[] = [];
let childExited = false;

child.once("exit", () => {
	childExited = true;
});

child.stderr.on("data", (chunk) => {
	stderrChunks.push(String(chunk));
});

stdout.on("line", (line) => {
	if (!line.trim()) return;
	const message = JSON.parse(line) as JsonRpcResponse;
	if (message.id !== undefined && message.id !== null) {
		responses.set(message.id, message);
	}
});

let nextId = 1;

const request = async (
	method: string,
	params?: unknown,
): Promise<JsonRpcResponse> => {
	const id = nextId;
	nextId += 1;
	child.stdin.write(
		`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
	);
	const started = Date.now();
	while (Date.now() - started < 5000) {
		const response = responses.get(id);
		if (response) return response;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error(`Timed out waiting for ${method}`);
};

const notify = (method: string, params?: unknown): void => {
	child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
};

const toolNamesFrom = (value: unknown): ReadonlySet<string> => {
	if (typeof value !== "object" || value === null) return new Set();
	const tools = (value as { readonly tools?: unknown }).tools;
	if (!Array.isArray(tools)) return new Set();
	return new Set(
		tools
			.map((tool) =>
				typeof tool === "object" && tool !== null
					? (tool as { readonly name?: unknown }).name
					: undefined,
			)
			.filter((name): name is string => typeof name === "string"),
	);
};

const stopChild = async (): Promise<void> => {
	if (childExited) return;
	child.kill();
	await once(child, "exit").catch(() => undefined);
};

try {
	const initialize = await request("initialize", {
		protocolVersion: "2025-06-18",
		capabilities: {},
		clientInfo: { name: "vma-agent-smoke", version: "0.1.0" },
	});
	if (initialize.error)
		throw new Error(`initialize failed: ${JSON.stringify(initialize.error)}`);
	notify("notifications/initialized");

	const tools = await request("tools/list", {});
	if (tools.error)
		throw new Error(`tools/list failed: ${JSON.stringify(tools.error)}`);
	const toolNames = toolNamesFrom(tools.result);
	for (const expected of [
		"observe_document",
		"list_layers",
		"list_artboards",
		"list_motion_grammar",
		"propose_edit_plan",
		"validate_edit_plan_live",
		"apply_edit_plan_live",
		"apply_scene_commands",
		"apply_motion_commands",
		"apply_motion_grammar_commands",
		"run_validation",
		"export_artboard",
	]) {
		if (!toolNames.has(expected)) {
			throw new Error(`tools/list did not include ${expected}`);
		}
	}

	const observe = await request("tools/call", {
		name: "observe_document",
		arguments: {},
	});
	if (observe.error)
		throw new Error(
			`observe_document failed: ${JSON.stringify(observe.error)}`,
		);
	if (!JSON.stringify(observe.result).includes("scene-primary")) {
		throw new Error("observe_document did not return the seed scene summary");
	}

	const sceneApply = await request("tools/call", {
		name: "apply_scene_commands",
		arguments: {
			transactionId: "mcp-smoke-scene-edit",
			commands: [
				{
					type: "scene/update-node-style",
					nodeId: "node-panel",
					patch: { fill: "#ffffff", opacity: 0.5 },
				},
				{
					type: "scene/update-text-node",
					nodeId: "node-title",
					patch: { text: "MCP\nEDIT" },
				},
				{
					type: "scene/append-node",
					node: {
						name: "MCP Rect",
						geometry: {
							kind: "rect",
							bounds: { x: 8, y: 8, width: 24, height: 16 },
						},
					},
				},
			],
		},
	});
	if (sceneApply.error) {
		throw new Error(
			`apply_scene_commands failed: ${JSON.stringify(sceneApply.error)}`,
		);
	}
	const sceneApplyJson = JSON.stringify(sceneApply.result);
	if (!sceneApplyJson.includes("mcp-smoke-scene-edit")) {
		throw new Error(
			"apply_scene_commands did not include transaction metadata",
		);
	}
	if (!sceneApplyJson.includes("MCP\\nEDIT")) {
		throw new Error("apply_scene_commands did not return updated scene data");
	}
	if (!sceneApplyJson.includes("MCP Rect")) {
		throw new Error("apply_scene_commands did not append the new node");
	}

	const motionApply = await request("tools/call", {
		name: "apply_motion_commands",
		arguments: {
			transactionId: "mcp-smoke-motion-edit",
			commands: [
				{
					type: "motion/upsert-keyframe",
					nodeId: "node-panel",
					property: "x",
					frame: 0,
					value: 0,
				},
				{
					type: "motion/upsert-keyframe",
					nodeId: "node-panel",
					property: "x",
					frame: 12,
					value: 120,
				},
			],
		},
	});
	if (motionApply.error) {
		throw new Error(
			`apply_motion_commands failed: ${JSON.stringify(motionApply.error)}`,
		);
	}
	const motionApplyJson = JSON.stringify(motionApply.result);
	if (!motionApplyJson.includes("mcp-smoke-motion-edit")) {
		throw new Error(
			"apply_motion_commands did not include transaction metadata",
		);
	}
	if (!motionApplyJson.includes('"property":"x"')) {
		throw new Error("apply_motion_commands did not return updated motion data");
	}

	const grammarList = await request("tools/call", {
		name: "list_motion_grammar",
		arguments: { nodeId: "node-panel" },
	});
	if (grammarList.error) {
		throw new Error(
			`list_motion_grammar failed: ${JSON.stringify(grammarList.error)}`,
		);
	}
	const grammarListJson = JSON.stringify(grammarList.result);
	if (!grammarListJson.includes("periodic-afterimage")) {
		throw new Error(
			"list_motion_grammar did not include authorable techniques",
		);
	}
	if (!grammarListJson.includes("node-panel")) {
		throw new Error(
			"list_motion_grammar did not echo the requested node filter",
		);
	}

	const grammarApply = await request("tools/call", {
		name: "apply_motion_grammar_commands",
		arguments: {
			transactionId: "mcp-smoke-motion-grammar-edit",
			commands: [
				{
					type: "motion-grammar/apply-technique",
					techniqueId: "periodic-afterimage",
					targetIds: ["node-panel"],
					parameters: { copies: 2, delayFrames: 4, decay: 0.5 },
				},
			],
		},
	});
	if (grammarApply.error) {
		throw new Error(
			`apply_motion_grammar_commands failed: ${JSON.stringify(grammarApply.error)}`,
		);
	}
	const grammarApplyJson = JSON.stringify(grammarApply.result);
	if (!grammarApplyJson.includes("mcp-smoke-motion-grammar-edit")) {
		throw new Error(
			"apply_motion_grammar_commands did not include transaction metadata",
		);
	}
	if (!grammarApplyJson.includes("periodic-afterimage")) {
		throw new Error(
			"apply_motion_grammar_commands did not return updated grammar data",
		);
	}

	const validation = await request("tools/call", {
		name: "run_validation",
		arguments: {},
	});
	if (validation.error) {
		throw new Error(
			`run_validation failed: ${JSON.stringify(validation.error)}`,
		);
	}

	const exported = await request("tools/call", {
		name: "export_artboard",
		arguments: { formats: ["manifest", "svg"], frame: 0 },
	});
	if (exported.error)
		throw new Error(
			`export_artboard failed: ${JSON.stringify(exported.error)}`,
		);
	if (!JSON.stringify(exported.result).includes(".manifest.json")) {
		throw new Error("export_artboard did not include manifest metadata");
	}

	await stopChild();
	console.log("vma-agent MCP smoke passed.");
} catch (error) {
	await stopChild();
	if (stderrChunks.length > 0) {
		console.error(stderrChunks.join(""));
	}
	throw error;
}
