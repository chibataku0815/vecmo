#!/usr/bin/env bun

import path from "node:path";
import {
	AGENT_TOOL_NAMES,
	type AgentCommandPlanRequest,
} from "../src/entities/agent/model/types";
import { stableJsonStringify } from "../src/features/export/model/json";
import {
	bridgeDiscoveryPath,
	readBridgeDiscovery,
} from "./agent-bridge-discovery";
import {
	type AgentBridgeForwardTarget,
	listLiveEditors,
} from "./agent-bridge-forward";
import {
	applyHeadlessPlan,
	captureEditorSnapshotResult,
	createLivePlanRequest,
	type DocumentSource,
	exportAgentArtboard,
	forwardLiveAgentPlan,
	loadDocumentContext,
	loadReproductionDescriptor,
	observeDocumentLiveResult,
	observeHeadlessDocument,
	observeHeadlessNode,
	observePreviewStateResult,
	observeSelectionLiveResult,
	parseVmactlPlan,
	proposeHeadlessPlan,
	readJsonFile,
	saveProjectLiveResult,
	validateHeadlessDocument,
} from "./vma-agent-toolkit";

type ParsedArgs = {
	readonly positionals: readonly string[];
	readonly options: ReadonlyMap<string, readonly string[]>;
};

type DescriptorInput = NonNullable<
	Parameters<typeof loadReproductionDescriptor>[0]["descriptor"]
>;

type DescriptorOptions = NonNullable<
	Parameters<typeof loadReproductionDescriptor>[0]["options"]
>;

type ExportScope = "current" | "selected" | "all";
type ExportFormat = "manifest" | "scene-json" | "motion-json" | "svg" | "pdf";
type SaveMode = "save" | "save-as-new" | "save-as-copy";

const EXPORT_SCOPES = new Set<string>(["current", "selected", "all"]);
const EXPORT_FORMATS = new Set<string>([
	"manifest",
	"scene-json",
	"motion-json",
	"svg",
	"pdf",
]);
const SAVE_MODES = new Set<string>(["save", "save-as-new", "save-as-copy"]);

const usage = [
	"vmactl - vector-motion-author agent CLI",
	"",
	"Headless:",
	"  bun run vmactl -- observe [--scene path] [--motion path] [--grammar path] [--detail summary|normal|full]",
	"  bun run vmactl -- node --node-id id [--node-id id2] [--include-geometry]",
	"  bun run vmactl -- validate --plan plan.json",
	"  bun run vmactl -- apply --plan plan.json [--dry-run]",
	"  bun run vmactl -- export [--scope current|selected|all] [--format svg] [--frame 0]",
	"  bun run vmactl -- descriptor --descriptor descriptor.json [--options options.json]",
	"",
	"Live editor bridge:",
	"  bun run vmactl -- live status",
	"  bun run vmactl -- live editors",
	"  bun run vmactl -- live observe-selection",
	"  bun run vmactl -- live observe",
	"  bun run vmactl -- live preview [--editor id] [--working-copy id] [--binding-epoch n]",
	"  bun run vmactl -- live capture --frames 0,9,13,14,23,32,39 [--out dir] [--artboard id] [--editor id] [--working-copy id] [--binding-epoch n]",
	"  bun run vmactl -- live validate --plan plan.json",
	"  bun run vmactl -- live apply --plan plan.json",
	"  bun run vmactl -- live save [--intent text] [--mode save|save-as-new|save-as-copy] [--name name]",
	"",
	"Shared:",
	"  bun run vmactl -- schema",
	"  Add --pretty for formatted JSON. Use --plan - or --descriptor - to read stdin.",
].join("\n");

const parseArgs = (argv: readonly string[]): ParsedArgs => {
	const positionals: string[] = [];
	const options = new Map<string, string[]>();
	let index = 0;
	while (index < argv.length) {
		const token = argv[index];
		if (!token.startsWith("--")) {
			positionals.push(token);
			index += 1;
			continue;
		}
		const withoutPrefix = token.slice(2);
		const inlineEquals = withoutPrefix.indexOf("=");
		const key =
			inlineEquals >= 0 ? withoutPrefix.slice(0, inlineEquals) : withoutPrefix;
		const inlineValue =
			inlineEquals >= 0 ? withoutPrefix.slice(inlineEquals + 1) : undefined;
		const next = argv[index + 1];
		const value =
			inlineValue ??
			(next && !next.startsWith("--")
				? (() => {
						index += 1;
						return next;
					})()
				: "true");
		const values = options.get(key) ?? [];
		values.push(value);
		options.set(key, values);
		index += 1;
	}
	return { positionals, options };
};

const firstOption = (
	args: ParsedArgs,
	...names: readonly string[]
): string | undefined => {
	for (const name of names) {
		const value = args.options.get(name)?.at(-1);
		if (value && value !== "true") return value;
	}
	return undefined;
};

const optionValues = (
	args: ParsedArgs,
	...names: readonly string[]
): readonly string[] =>
	names.flatMap((name) =>
		(args.options.get(name) ?? []).filter((value) => value !== "true"),
	);

const hasFlag = (args: ParsedArgs, name: string): boolean =>
	args.options.has(name) && args.options.get(name)?.at(-1) !== "false";

const parseNumberOption = (
	args: ParsedArgs,
	name: string,
): number | undefined => {
	const raw = firstOption(args, name);
	if (!raw) return undefined;
	const value = Number(raw);
	if (!Number.isFinite(value)) {
		throw new Error(`--${name} must be a finite number.`);
	}
	return value;
};

const parseSource = (args: ParsedArgs): DocumentSource | undefined => {
	const projectPath = firstOption(args, "project", "project-path");
	const scenePath = firstOption(args, "scene", "scene-path");
	const motionPath = firstOption(args, "motion", "motion-path");
	const grammarPath = firstOption(args, "grammar", "grammar-path");
	const source: DocumentSource = {
		...(projectPath ? { projectPath } : {}),
		...(scenePath ? { scenePath } : {}),
		...(motionPath ? { motionPath } : {}),
		...(grammarPath ? { grammarPath } : {}),
	};
	return Object.keys(source).length > 0 ? source : undefined;
};

const parseBridge = (
	args: ParsedArgs,
): AgentBridgeForwardTarget | undefined => {
	const kind = firstOption(args, "bridge-kind");
	const port = parseNumberOption(args, "port");
	const token = firstOption(args, "token");
	const hostname = firstOption(args, "hostname");
	const url = firstOption(args, "url", "bridge-url");
	const baseUrl = firstOption(args, "base-url", "bridge-base-url");
	const sessionId = firstOption(args, "session-id", "bridge-session-id");
	const editorInstanceId = firstOption(args, "editor", "editor-instance-id");
	const workingCopyId = firstOption(args, "working-copy", "working-copy-id");
	const projectId = firstOption(args, "project", "project-id");
	const bindingEpoch = parseNumberOption(args, "binding-epoch");
	if (
		bindingEpoch !== undefined &&
		(!Number.isInteger(bindingEpoch) || bindingEpoch < 1)
	) {
		throw new Error("--binding-epoch must be a positive integer.");
	}
	if (kind === "remote" || url || baseUrl || sessionId) {
		if (!token) {
			throw new Error("Remote bridge targets require --token.");
		}
		return {
			kind: "remote",
			token,
			...(url ? { url } : {}),
			...(baseUrl ? { baseUrl } : {}),
			...(sessionId ? { sessionId } : {}),
			...(editorInstanceId ? { editorInstanceId } : {}),
			...(workingCopyId ? { workingCopyId } : {}),
			...(projectId ? { projectId } : {}),
			...(bindingEpoch === undefined ? {} : { bindingEpoch }),
		};
	}
	if (
		kind === "local" ||
		port ||
		token ||
		hostname ||
		editorInstanceId ||
		workingCopyId ||
		projectId ||
		bindingEpoch !== undefined
	) {
		return {
			kind: "local",
			...(port === undefined ? {} : { port }),
			...(token ? { token } : {}),
			...(hostname ? { hostname } : {}),
			...(editorInstanceId ? { editorInstanceId } : {}),
			...(workingCopyId ? { workingCopyId } : {}),
			...(projectId ? { projectId } : {}),
			...(bindingEpoch === undefined ? {} : { bindingEpoch }),
		};
	}
	return undefined;
};

/**
 * Parses `--frames 0,9,13` (comma-separated; repeatable) into a validated list
 * of non-negative integer frames for `live capture`.
 */
const parseFrames = (args: ParsedArgs): readonly number[] => {
	const frames: number[] = [];
	for (const token of optionValues(args, "frames", "frame")) {
		for (const part of token.split(",")) {
			const trimmed = part.trim();
			if (trimmed === "") continue;
			const value = Number(trimmed);
			if (!Number.isInteger(value) || value < 0) {
				throw new Error(
					`--frames must be a comma-separated list of non-negative integers; got "${part}".`,
				);
			}
			frames.push(value);
		}
	}
	return frames;
};

/**
 * Resolves the capture output directory. `--out` is honored as-is; otherwise the
 * CLI defaults to a timestamped folder under `artifacts/agent-captures/` (the MCP
 * tool requires an explicit outDir instead, so it never writes outside intent).
 */
const captureOutDir = (args: ParsedArgs): string => {
	const explicit = firstOption(args, "out", "out-dir", "outDir");
	if (explicit) return path.resolve(process.cwd(), explicit);
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	return path.resolve(process.cwd(), "artifacts", "agent-captures", timestamp);
};

const remoteBridgeEnvStatus = (): {
	readonly configured: boolean;
	readonly target: "url" | "session" | null;
	readonly url?: string;
	readonly baseUrl?: string;
	readonly sessionId?: string;
	readonly hasToken: boolean;
	readonly missing: readonly string[];
} => {
	const token = process.env.VMA_AGENT_BRIDGE_TOKEN;
	const url = process.env.VMA_AGENT_BRIDGE_URL;
	const baseUrl = process.env.VMA_AGENT_BRIDGE_BASE_URL;
	const sessionId = process.env.VMA_AGENT_BRIDGE_SESSION_ID;
	if (url && token) {
		return {
			configured: true,
			target: "url",
			url,
			hasToken: true,
			missing: [],
		};
	}
	if (baseUrl && sessionId && token) {
		return {
			configured: true,
			target: "session",
			baseUrl,
			sessionId,
			hasToken: true,
			missing: [],
		};
	}
	const missing: string[] = [];
	if (!token) missing.push("VMA_AGENT_BRIDGE_TOKEN");
	if (!url && !baseUrl) {
		missing.push("VMA_AGENT_BRIDGE_URL or VMA_AGENT_BRIDGE_BASE_URL");
	}
	if (!url && !sessionId) missing.push("VMA_AGENT_BRIDGE_SESSION_ID");
	return {
		configured: false,
		target: null,
		hasToken: Boolean(token),
		missing,
	};
};

const parseExportScope = (args: ParsedArgs): ExportScope | undefined => {
	const scope = firstOption(args, "scope");
	if (!scope) return undefined;
	if (!EXPORT_SCOPES.has(scope)) {
		throw new Error("--scope must be current, selected, or all.");
	}
	return scope as ExportScope;
};

const parseExportFormats = (args: ParsedArgs): readonly ExportFormat[] => {
	const formats = optionValues(args, "format", "formats").flatMap((value) =>
		value
			.split(",")
			.map((item) => item.trim())
			.filter(Boolean),
	);
	const invalid = formats.find((format) => !EXPORT_FORMATS.has(format));
	if (invalid) {
		throw new Error(
			"--format must be one of manifest, scene-json, motion-json, svg, or pdf.",
		);
	}
	return formats as readonly ExportFormat[];
};

const parseSaveMode = (args: ParsedArgs): SaveMode | undefined => {
	const mode = firstOption(args, "mode");
	if (!mode) return undefined;
	if (!SAVE_MODES.has(mode)) {
		throw new Error("--mode must be save, save-as-new, or save-as-copy.");
	}
	return mode as SaveMode;
};

const readStdin = async (): Promise<string> =>
	new Promise((resolve, reject) => {
		let data = "";
		process.stdin.setEncoding("utf8");
		process.stdin.on("data", (chunk) => {
			data += chunk;
		});
		process.stdin.on("end", () => resolve(data));
		process.stdin.on("error", reject);
	});

const readJsonInput = async <T>(filePath: string): Promise<T> => {
	if (filePath === "-") {
		return JSON.parse(await readStdin()) as T;
	}
	return readJsonFile<T>(filePath);
};

const writeJson = (value: unknown, pretty: boolean): void => {
	process.stdout.write(
		`${pretty ? JSON.stringify(value, null, 2) : stableJsonStringify(value)}\n`,
	);
};

const fail = (message: string): never => {
	process.stderr.write(`${message}\n\n${usage}\n`);
	process.exit(1);
};

const requirePlan = async (
	args: ParsedArgs,
): Promise<{
	readonly plan: AgentCommandPlanRequest;
	readonly source?: DocumentSource;
	readonly bridge?: AgentBridgeForwardTarget;
}> => {
	const planPath = firstOption(args, "plan");
	if (!planPath) fail("Missing --plan.");
	const parsed = await parseVmactlPlan(await readJsonInput<unknown>(planPath), {
		source: parseSource(args),
		bridge: parseBridge(args),
		intent: firstOption(args, "intent"),
		planId: firstOption(args, "plan-id"),
	});
	if (!parsed.ok || !parsed.data) {
		writeJson(parsed, hasFlag(args, "pretty"));
		process.exit(1);
	}
	const { source, bridge, ...plan } = parsed.data;
	return { plan, source, bridge };
};

const commandSchema = {
	transportStrategy: {
		primary: "vmactl CLI for high-bandwidth local/headless/live agent work",
		compatibility:
			"MCP remains a thin discovery and live-edit compatibility layer",
	},
	planEnvelope: {
		planId: "string optional in plan file; vmactl mints one when absent",
		intent: "string",
		source: {
			projectPath: "optional path to canonical .vecmo-backup.json",
			scenePath: "optional path to SceneDocument JSON",
			motionPath: "optional path to MotionDocument JSON",
			grammarPath: "optional path to serialized motion grammar JSON",
		},
		target: "optional AgentIssueTarget",
		transactionId: "optional coalesce/undo transaction id",
		documentCommands: "optional AgentDocumentCommand[]",
		sceneCommands: "optional AgentSceneCommand[]",
		motionCommands: "optional AgentMotionCommand[]",
		motionGrammarCommands: "optional AgentMotionGrammarCommand[]",
		includeValidation: "optional boolean",
		bridge: "optional local/remote bridge target for live commands",
	},
	commands: [
		"observe",
		"node",
		"validate",
		"apply",
		"export",
		"descriptor",
		"live status",
		"live editors",
		"live observe-selection",
		"live observe",
		"live preview",
		"live capture",
		"live validate",
		"live apply",
		"live save",
		"schema",
	],
	mcpTools: AGENT_TOOL_NAMES,
};

const main = async (): Promise<void> => {
	const args = parseArgs(process.argv.slice(2));
	const pretty = hasFlag(args, "pretty");
	const [command, subcommand] = args.positionals;
	if (!command || command === "help" || command === "--help") {
		process.stdout.write(`${usage}\n`);
		return;
	}

	if (command === "schema") {
		writeJson(commandSchema, pretty);
		return;
	}

	if (command === "observe") {
		const detailRaw = firstOption(args, "detail");
		const detail =
			detailRaw === "summary" || detailRaw === "normal" || detailRaw === "full"
				? detailRaw
				: undefined;
		writeJson(await observeHeadlessDocument(parseSource(args), detail), pretty);
		return;
	}

	if (command === "node") {
		const nodeIds = [
			...optionValues(args, "node-id"),
			...optionValues(args, "node-ids").flatMap((value) =>
				value
					.split(",")
					.map((item) => item.trim())
					.filter(Boolean),
			),
		];
		if (nodeIds.length === 0) fail("Missing --node-id.");
		writeJson(
			await observeHeadlessNode(
				parseSource(args),
				nodeIds,
				hasFlag(args, "include-geometry"),
			),
			pretty,
		);
		return;
	}

	if (command === "validate") {
		const { plan, source } = await requirePlan(args);
		writeJson(await proposeHeadlessPlan(plan, source), pretty);
		return;
	}

	if (command === "apply") {
		const { plan, source } = await requirePlan(args);
		writeJson(
			await applyHeadlessPlan(plan, source, hasFlag(args, "dry-run")),
			pretty,
		);
		return;
	}

	if (command === "export") {
		const source = parseSource(args);
		const context = await loadDocumentContext(source);
		writeJson(
			exportAgentArtboard(context, {
				source,
				scope: parseExportScope(args),
				artboardIds: optionValues(args, "artboard-id", "artboard-ids").flatMap(
					(value) =>
						value
							.split(",")
							.map((item) => item.trim())
							.filter(Boolean),
				),
				formats: parseExportFormats(args),
				frame: parseNumberOption(args, "frame"),
			}),
			pretty,
		);
		return;
	}

	if (command === "descriptor") {
		const descriptorPath = firstOption(args, "descriptor");
		if (!descriptorPath) fail("Missing --descriptor.");
		const optionsPath = firstOption(args, "options");
		const options = optionsPath
			? await readJsonInput<DescriptorOptions>(optionsPath)
			: undefined;
		writeJson(
			await loadReproductionDescriptor(
				descriptorPath === "-"
					? {
							descriptor: await readJsonInput<DescriptorInput>("-"),
							...(options ? { options } : {}),
						}
					: {
							descriptorPath,
							...(options ? { options } : {}),
						},
			),
			pretty,
		);
		return;
	}

	if (command === "run-validation") {
		writeJson(await validateHeadlessDocument(parseSource(args)), pretty);
		return;
	}

	if (command === "live") {
		if (subcommand === "editors") {
			writeJson(await listLiveEditors(parseBridge(args)), pretty);
			return;
		}
		if (subcommand === "status") {
			const relay = await readBridgeDiscovery();
			const remoteEnv = remoteBridgeEnvStatus();
			writeJson(
				{
					discoveryPath: bridgeDiscoveryPath(),
					relay,
					localRelay: {
						configured: relay !== null,
						discoveryPath: bridgeDiscoveryPath(),
						relay,
					},
					remoteEnv,
					defaultTarget: remoteEnv.configured
						? "remote-env"
						: relay
							? "local-relay"
							: "none",
				},
				pretty,
			);
			return;
		}
		if (subcommand === "observe-selection") {
			writeJson(await observeSelectionLiveResult(parseBridge(args)), pretty);
			return;
		}
		if (subcommand === "observe") {
			writeJson(await observeDocumentLiveResult(parseBridge(args)), pretty);
			return;
		}
		if (subcommand === "preview") {
			// `parseBridge` already reads --editor/--working-copy/--binding-epoch
			// generically; when any is omitted, `resolvePinnedPreviewTarget`
			// (`agent-bridge-forward.ts`) auto-pins from discovery or fails closed.
			writeJson(await observePreviewStateResult(parseBridge(args)), pretty);
			return;
		}
		if (subcommand === "capture") {
			const frames = parseFrames(args);
			if (frames.length === 0) {
				fail("live capture requires --frames <comma-separated frame list>.");
			}
			const artboardId = firstOption(args, "artboard", "artboard-id");
			// Same auto-pin-from-discovery/fail-closed semantics as `preview` above.
			const bridge = parseBridge(args);
			writeJson(
				await captureEditorSnapshotResult({
					frames,
					outDir: captureOutDir(args),
					...(artboardId ? { artboardId } : {}),
					...(bridge ? { bridge } : {}),
				}),
				pretty,
			);
			return;
		}
		if (subcommand === "validate" || subcommand === "apply") {
			const { plan, bridge } = await requirePlan(args);
			const livePlan = createLivePlanRequest({
				...plan,
				bridge,
			});
			writeJson(
				await forwardLiveAgentPlan(subcommand, {
					...livePlan,
					bridge,
				}),
				pretty,
			);
			return;
		}
		if (subcommand === "save") {
			const mode = parseSaveMode(args);
			const intent = firstOption(args, "intent");
			const name = firstOption(args, "name");
			writeJson(
				await saveProjectLiveResult(
					{
						...(intent ? { intent } : {}),
						...(mode ? { mode } : {}),
						...(name ? { name } : {}),
					},
					parseBridge(args),
				),
				pretty,
			);
			return;
		}
		fail("Unknown live subcommand.");
	}

	fail(`Unknown command: ${command}`);
};

try {
	await main();
} catch (error) {
	process.stderr.write(
		`${error instanceof Error ? error.message : String(error)}\n`,
	);
	process.exit(1);
}
