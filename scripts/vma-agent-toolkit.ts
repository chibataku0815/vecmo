import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	AGENT_BRIDGE_PROTOCOL_VERSION,
	type AgentBridgeObserveResult,
	type AgentBridgePreviewObserveResult,
	type AgentBridgeProjectSaveRequest,
	type AgentBridgeProjectSaveResult,
} from "../src/entities/agent/model/bridge-protocol";
import {
	createAgentIssue,
	createAgentToolResult,
	isAgentToolRequest,
} from "../src/entities/agent/model/contracts";
import type { AgentPreviewCaptureTargetIdentity } from "../src/entities/agent/model/preview-capture";
import {
	type AgentDocumentContext,
	observeAgentDocument,
	observeAgentNode,
	validateAgentDocument,
} from "../src/entities/agent/model/read-only";
import type {
	AgentCommandPlanRequest,
	AgentDocumentCommand,
	AgentEditPlan,
	AgentIssue,
	AgentMotionCommand,
	AgentMotionGrammarCommand,
	AgentMotionGrammarCommandApplyData,
	AgentSceneCommand,
	AgentToolName,
	AgentToolResult,
} from "../src/entities/agent/model/types";
import {
	type AgentDocumentCommandApplyData,
	type AgentMotionCommandApplyData,
	type AgentSceneCommandApplyData,
	applyAgentDocumentCommands,
	applyAgentMotionCommands,
	applyAgentMotionGrammarCommands,
	applyAgentSceneCommands,
	proposeAgentEditPlan,
} from "../src/entities/agent/model/write";
import type { SerializedMotionGrammarLayer } from "../src/entities/motion/model/grammar-bridge";
import { initialMotionDocument } from "../src/entities/motion/model/seed-motion";
import type { MotionDocument } from "../src/entities/motion/model/types";
import { parseMotionGrammarLayer } from "../src/entities/motion-grammar/model/parse";
import type { SceneCameraAuthoringSelection } from "../src/entities/scene/model/scene-camera-authoring";
import { initialSceneDocument } from "../src/entities/scene/model/seed-scene";
import type { SceneDocument } from "../src/entities/scene/model/types";
import {
	type ExportArtboardScopeInput,
	resolveExportArtboardScope,
} from "../src/features/export/model/artboards";
import { createExportBundle } from "../src/features/export/model/bundle";
import { restorePortableProject } from "../src/features/project-backup/model/project-backup";
import {
	createReproductionDescriptorSkeleton,
	type MotionReproductionDescriptor,
	type ReproductionDescriptorImportOptions,
	type ReproductionDescriptorImportResult,
} from "../src/features/reproduction-descriptor/model/descriptor-import";
import {
	bridgeDiscoveryPath,
	type readBridgeDiscovery,
} from "./agent-bridge-discovery";
import {
	type AgentBridgeForwardTarget,
	type ForwardLiveOutcome,
	forwardLiveObservation,
	forwardLivePlan,
	forwardLivePreviewObserve,
	forwardLiveProjectSave,
	openLivePreviewCaptureClient,
} from "./agent-bridge-forward";

export type DocumentSource = {
	readonly projectPath?: string;
	readonly scenePath?: string;
	readonly motionPath?: string;
	readonly grammarPath?: string;
};

export type ExportArtboardArgs = {
	readonly source?: DocumentSource;
	readonly scope?: "current" | "selected" | "all";
	readonly artboardIds?: readonly string[];
	readonly formats?: readonly (
		| "manifest"
		| "scene-json"
		| "motion-json"
		| "svg"
		| "pdf"
	)[];
	readonly frame?: number;
};

export type LoadReproductionDescriptorArgs = {
	readonly descriptor?: MotionReproductionDescriptor;
	readonly descriptorPath?: string;
	readonly options?: ReproductionDescriptorImportOptions;
};

export type ApplySceneCommandsArgs = {
	readonly source?: DocumentSource;
	readonly transactionId?: string;
	readonly dryRun?: boolean;
	readonly commands: readonly AgentSceneCommand[];
};

export type ApplyMotionCommandsArgs = {
	readonly source?: DocumentSource;
	readonly transactionId?: string;
	readonly dryRun?: boolean;
	readonly commands: readonly AgentMotionCommand[];
};

export type ApplyMotionGrammarCommandsArgs = {
	readonly source?: DocumentSource;
	readonly transactionId?: string;
	readonly dryRun?: boolean;
	readonly commands: readonly AgentMotionGrammarCommand[];
};

export type LivePlanInput = {
	readonly intent: string;
	readonly planId?: string;
	readonly target?: AgentCommandPlanRequest["target"];
	readonly transactionId?: string;
	readonly documentCommands?: readonly AgentDocumentCommand[];
	readonly sceneCommands?: readonly AgentSceneCommand[];
	readonly motionCommands?: readonly AgentMotionCommand[];
	readonly motionGrammarCommands?: readonly AgentMotionGrammarCommand[];
	readonly includeValidation?: boolean;
	readonly bridge?: AgentBridgeForwardTarget;
};

export type AgentSelectionObservation = {
	/** Node ids selected in the live editor, primary last. Empty when nothing is selected. */
	readonly nodeIds: readonly string[];
	readonly primaryNodeId?: string;
	/** The artboard selected as a canvas object; absent when no artboard is canvas-selected. */
	readonly selectedArtboardId?: string;
	/** Camera rig/body/target/null selection; absent when no camera authoring item is selected. */
	readonly selectedSceneCamera?: SceneCameraAuthoringSelection;
	/** The document's currently focused artboard (`SceneDocument.currentArtboardId`, resolved). */
	readonly currentArtboardId?: string;
	/** Current live editor playhead frame. */
	readonly currentFrame?: number;
};

export type VmactlPlanFile = AgentCommandPlanRequest & {
	readonly source?: DocumentSource;
	readonly bridge?: AgentBridgeForwardTarget;
};

export type VmactlHeadlessApplyResult = {
	readonly mode: "headless";
	readonly ok: boolean;
	readonly planId: string;
	readonly intent: string;
	readonly dryRun: boolean;
	readonly proposal: AgentToolResult<AgentEditPlan>;
	readonly results: {
		readonly document?: AgentToolResult<AgentDocumentCommandApplyData>;
		readonly scene?: AgentToolResult<AgentSceneCommandApplyData>;
		readonly motion?: AgentToolResult<AgentMotionCommandApplyData>;
		readonly motionGrammar?: AgentToolResult<AgentMotionGrammarCommandApplyData>;
	};
	readonly documents: {
		readonly scene: SceneDocument;
		readonly motion: MotionDocument;
		readonly grammar: AgentDocumentContext["grammar"];
	};
	readonly issues: readonly AgentIssue[];
};

export type VmactlBridgeStatus = {
	readonly discoveryPath: string;
	readonly relay: null | Awaited<ReturnType<typeof readBridgeDiscovery>>;
	readonly localRelay: {
		readonly configured: boolean;
		readonly discoveryPath: string;
		readonly relay: null | Awaited<ReturnType<typeof readBridgeDiscovery>>;
	};
	readonly remoteEnv: {
		readonly configured: boolean;
		readonly target: "url" | "session" | null;
		readonly url?: string;
		readonly baseUrl?: string;
		readonly sessionId?: string;
		readonly hasToken: boolean;
		readonly missing: readonly string[];
	};
	readonly defaultTarget: "remote-env" | "local-relay" | "none";
};

export type LoadedReproductionDescriptorData =
	ReproductionDescriptorImportResult & {
		readonly summary: {
			readonly sceneId: string;
			readonly artboardId: string;
			readonly layerCount: number;
			readonly roleCount: number;
			readonly motionTrackCount: number;
			readonly motionClipCount: number;
			readonly grammarBindingCount: number;
			readonly issueCount: number;
			readonly acceptanceCheckCount: number;
		};
	};

type ParsedPlanIssue = {
	readonly code: string;
	readonly message: string;
};

type GuardedPlanRequest = {
	readonly intent: string;
	readonly target?: AgentCommandPlanRequest["target"];
	readonly documentCommands?: readonly AgentDocumentCommand[];
	readonly sceneCommands?: readonly AgentSceneCommand[];
	readonly motionCommands?: readonly AgentMotionCommand[];
	readonly motionGrammarCommands?: readonly AgentMotionGrammarCommand[];
	readonly includeValidation?: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const isString = (value: unknown): value is string => typeof value === "string";

const optionalString = (
	record: Record<string, unknown>,
	key: string,
): string | undefined => {
	const value = record[key];
	return typeof value === "string" && value.trim().length > 0
		? value
		: undefined;
};

const parseDocumentSource = (
	value: unknown,
	issues: ParsedPlanIssue[],
): DocumentSource | undefined => {
	if (value === undefined) return undefined;
	if (!isRecord(value)) {
		issues.push({
			code: "agent.source-invalid",
			message:
				"source must be an object with optional projectPath, scenePath, motionPath, and grammarPath.",
		});
		return undefined;
	}
	const projectPath = optionalString(value, "projectPath");
	const scenePath = optionalString(value, "scenePath");
	const motionPath = optionalString(value, "motionPath");
	const grammarPath = optionalString(value, "grammarPath");
	const source: DocumentSource = {
		...(projectPath ? { projectPath } : {}),
		...(scenePath ? { scenePath } : {}),
		...(motionPath ? { motionPath } : {}),
		...(grammarPath ? { grammarPath } : {}),
	};
	return Object.keys(source).length > 0 ? source : undefined;
};

const parseBridgeTarget = (
	value: unknown,
	issues: ParsedPlanIssue[],
): AgentBridgeForwardTarget | undefined => {
	if (value === undefined) return undefined;
	if (!isRecord(value)) {
		issues.push({
			code: "agent.bridge-invalid",
			message: "bridge must be a local or remote bridge target object.",
		});
		return undefined;
	}
	if (value.kind === "local") {
		const token = optionalString(value, "token");
		const hostname = optionalString(value, "hostname");
		const editorInstanceId = optionalString(value, "editorInstanceId");
		const workingCopyId = optionalString(value, "workingCopyId");
		const projectId = optionalString(value, "projectId");
		return {
			kind: "local",
			...(typeof value.port === "number" ? { port: value.port } : {}),
			...(token ? { token } : {}),
			...(hostname ? { hostname } : {}),
			...(editorInstanceId ? { editorInstanceId } : {}),
			...(workingCopyId ? { workingCopyId } : {}),
			...(projectId ? { projectId } : {}),
			...(typeof value.bindingEpoch === "number"
				? { bindingEpoch: value.bindingEpoch }
				: {}),
		};
	}
	if (value.kind === "remote" && isString(value.token)) {
		const baseUrl = optionalString(value, "baseUrl");
		const sessionId = optionalString(value, "sessionId");
		const url = optionalString(value, "url");
		const editorInstanceId = optionalString(value, "editorInstanceId");
		const workingCopyId = optionalString(value, "workingCopyId");
		const projectId = optionalString(value, "projectId");
		return {
			kind: "remote",
			token: value.token,
			...(baseUrl ? { baseUrl } : {}),
			...(sessionId ? { sessionId } : {}),
			...(url ? { url } : {}),
			...(editorInstanceId ? { editorInstanceId } : {}),
			...(workingCopyId ? { workingCopyId } : {}),
			...(projectId ? { projectId } : {}),
			...(typeof value.bindingEpoch === "number"
				? { bindingEpoch: value.bindingEpoch }
				: {}),
		};
	}
	issues.push({
		code: "agent.bridge-invalid",
		message: "bridge.kind must be local, or remote with a token.",
	});
	return undefined;
};

export const readJsonFile = async <T>(filePath: string): Promise<T> => {
	const absolutePath = path.resolve(process.cwd(), filePath);
	const contents = await readFile(absolutePath, "utf8");
	return JSON.parse(contents) as T;
};

/**
 * Loads a scene/motion/grammar snapshot from disk or seeded defaults. This is
 * the shared headless document entry for MCP and `vmactl`; it never reaches into
 * browser stores or writes files.
 */
export const loadDocumentContext = async (
	source?: DocumentSource,
): Promise<AgentDocumentContext> => {
	if (source?.projectPath) {
		if (source.scenePath || source.motionPath || source.grammarPath) {
			throw new Error(
				"projectPath cannot be combined with scenePath, motionPath, or grammarPath.",
			);
		}
		const absolutePath = path.resolve(process.cwd(), source.projectPath);
		const restored = restorePortableProject(
			await readFile(absolutePath, "utf8"),
		);
		if (restored.status === "failed") {
			throw new Error(
				restored.issues.map((restoreIssue) => restoreIssue.message).join(" "),
			);
		}
		if (!restored.motion) {
			throw new Error(
				"Portable project source must include MotionDocument data for headless authoring.",
			);
		}
		return {
			scene: restored.scene,
			motion: restored.motion,
			grammar: restored.grammar ?? { bindings: [], passthrough: [] },
		};
	}
	const scene = source?.scenePath
		? await readJsonFile<SceneDocument>(source.scenePath)
		: structuredClone(initialSceneDocument);
	const motion = source?.motionPath
		? await readJsonFile<MotionDocument>(source.motionPath)
		: structuredClone(initialMotionDocument);
	const serializedGrammar = source?.grammarPath
		? await readJsonFile<SerializedMotionGrammarLayer>(source.grammarPath)
		: motion.grammar;
	const grammar = parseMotionGrammarLayer(serializedGrammar);
	return {
		scene,
		motion,
		grammar: {
			bindings: grammar.bindings,
			passthrough: grammar.passthrough,
		},
	};
};

export const agentErrorResult = <TData>(
	tool: AgentToolName,
	code: string,
	message: string,
): AgentToolResult<TData | null> =>
	createAgentToolResult(tool, null, [
		createAgentIssue(code, "error", message, { kind: "tool", id: tool }),
	]);

/**
 * Runs a pure headless document reader/writer against a loaded snapshot and
 * converts load/handler failures into the standard agent result envelope.
 */
export const runWithDocument = async <TData>(
	tool: AgentToolName,
	source: DocumentSource | undefined,
	handler: (context: AgentDocumentContext) => AgentToolResult<TData>,
): Promise<AgentToolResult<TData | null>> => {
	let context: AgentDocumentContext;
	try {
		context = await loadDocumentContext(source);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return agentErrorResult(tool, "agent.document-load-failed", message);
	}
	try {
		return handler(context);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return agentErrorResult(tool, "agent.command-execution-failed", message);
	}
};

const assetFormat = (
	kind: string,
): "manifest" | "scene-json" | "motion-json" | "svg" | "pdf" | "other" => {
	switch (kind) {
		case "manifest-json":
			return "manifest";
		case "scene-json":
			return "scene-json";
		case "motion-json":
			return "motion-json";
		case "svg":
			return "svg";
		case "pdf":
			return "pdf";
		default:
			return "other";
	}
};

/**
 * Builds deterministic export metadata and asset summaries from a headless
 * document context without writing files.
 */
export const exportAgentArtboard = (
	context: AgentDocumentContext,
	args: ExportArtboardArgs,
): AgentToolResult<{
	readonly frame: number;
	readonly frameRange: ReturnType<typeof createExportBundle>["frameRange"];
	readonly assets: readonly {
		readonly kind: string;
		readonly fileName: string;
		readonly mimeType: string;
		readonly byteLength: number;
	}[];
	readonly manifest: unknown;
}> => {
	const artboardScope: ExportArtboardScopeInput | undefined = args.scope
		? { mode: args.scope, artboardIds: args.artboardIds ?? [] }
		: undefined;
	const resolvedScope = resolveExportArtboardScope(
		context.scene,
		artboardScope,
	);
	const issues: AgentIssue[] = resolvedScope.issues.map((issue) =>
		createAgentIssue(
			`agent.export-${issue.code}`,
			issue.severity,
			issue.message,
			{
				kind: "export",
			},
		),
	);

	const bundle = createExportBundle({
		scene: context.scene,
		motion: context.motion,
		frame: args.frame,
		artboardScope,
	});
	const requestedFormats = new Set(args.formats ?? []);
	const assets = bundle.assets.filter((asset) => {
		if (requestedFormats.size === 0) return true;
		return requestedFormats.has(assetFormat(asset.kind));
	});
	const manifestAsset = bundle.assets.find(
		(asset) => asset.kind === "manifest-json",
	);
	const manifest = manifestAsset ? JSON.parse(manifestAsset.contents) : null;

	return createAgentToolResult(
		"export_artboard",
		{
			frame: bundle.frame,
			frameRange: bundle.frameRange,
			assets: assets.map((asset) => ({
				kind: asset.kind,
				fileName: asset.fileName,
				mimeType: asset.mimeType,
				byteLength: new TextEncoder().encode(asset.contents).byteLength,
			})),
			manifest,
		},
		issues,
	);
};

const isMotionReproductionDescriptor = (
	value: unknown,
): value is MotionReproductionDescriptor =>
	isRecord(value) &&
	isString(value.schema) &&
	isString(value.version) &&
	isString(value.id);

/**
 * Converts an upstream reproduction descriptor into editable scene/motion/
 * grammar skeletons. The CLI path keeps validation deliberately structural; the
 * imported documents still carry unmapped/lossy claims as typed issues.
 */
export const loadReproductionDescriptor = async (
	args: LoadReproductionDescriptorArgs,
): Promise<AgentToolResult<LoadedReproductionDescriptorData | null>> => {
	if (Boolean(args.descriptor) === Boolean(args.descriptorPath)) {
		return agentErrorResult(
			"load_reproduction_descriptor",
			"agent.reproduction-descriptor-source-ambiguous",
			"Provide exactly one of descriptor or descriptorPath.",
		);
	}
	let descriptor: MotionReproductionDescriptor;
	try {
		const value =
			args.descriptor ??
			(await readJsonFile<unknown>(args.descriptorPath ?? ""));
		if (!isMotionReproductionDescriptor(value)) {
			return agentErrorResult(
				"load_reproduction_descriptor",
				"agent.reproduction-descriptor-invalid",
				"Descriptor must include string schema, version, and id fields.",
			);
		}
		descriptor = value;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return agentErrorResult(
			"load_reproduction_descriptor",
			"agent.reproduction-descriptor-load-failed",
			message,
		);
	}

	const imported = createReproductionDescriptorSkeleton(
		descriptor,
		args.options ?? {},
	);
	const issues = imported.issues.map((issue) =>
		createAgentIssue(
			`agent.reproduction-descriptor-${issue.code}`,
			issue.severity,
			issue.message,
			{
				kind: "tool",
				id: "load_reproduction_descriptor",
				path: [
					issue.responsibleLayer,
					issue.roleId ? `role:${issue.roleId}` : "",
					issue.beatId ? `beat:${issue.beatId}` : "",
				]
					.filter(Boolean)
					.join("/"),
			},
		),
	);
	return createAgentToolResult(
		"load_reproduction_descriptor",
		{
			...imported,
			summary: {
				sceneId: imported.scene.id,
				artboardId:
					imported.scene.currentArtboardId ?? imported.scene.artboard.id,
				layerCount: imported.scene.layers.length,
				roleCount: Object.keys(imported.roleNodeIds).length,
				motionTrackCount: imported.motion.tracks.length,
				motionClipCount: imported.motion.clips.length,
				grammarBindingCount: imported.grammar.bindings.length,
				issueCount: imported.issues.length,
				acceptanceCheckCount: imported.acceptanceScaffold.length,
			},
		},
		issues,
	);
};

export const createLivePlanRequest = (
	input: LivePlanInput,
): AgentCommandPlanRequest => ({
	planId: input.planId ?? `live:${randomUUID()}`,
	intent: input.intent,
	...(input.target ? { target: input.target } : {}),
	...(input.transactionId ? { transactionId: input.transactionId } : {}),
	...(input.documentCommands
		? { documentCommands: input.documentCommands }
		: {}),
	...(input.sceneCommands ? { sceneCommands: input.sceneCommands } : {}),
	...(input.motionCommands ? { motionCommands: input.motionCommands } : {}),
	...(input.motionGrammarCommands
		? { motionGrammarCommands: input.motionGrammarCommands }
		: {}),
	...(input.includeValidation === undefined
		? {}
		: { includeValidation: input.includeValidation }),
});

/**
 * Forwards a typed plan to the live editor. This is transport-only; mutation
 * still depends on the editor-side approval policy (local dev auto-approval or
 * production human approval).
 */
export const forwardLiveAgentPlan = async (
	op: "validate" | "apply",
	input: LivePlanInput,
): Promise<ForwardLiveOutcome> =>
	forwardLivePlan(op, createLivePlanRequest(input), input.bridge);

/**
 * Reads live editor selection through the non-mutating validate bridge path.
 */
export const observeSelectionLiveResult = async (
	bridge: AgentBridgeForwardTarget | undefined,
): Promise<AgentToolResult<AgentSelectionObservation | null>> => {
	const outcome = await forwardLivePlan(
		"validate",
		{
			planId: `observe-selection:${randomUUID()}`,
			intent: "Observe the live editor's current selection.",
			includeValidation: false,
		},
		bridge,
	);
	if (!outcome.ok) {
		return createAgentToolResult("observe_selection", null, [
			createAgentIssue(outcome.code, "error", outcome.error),
		]);
	}
	const result = outcome.result;
	const nodeIds = result.selectedNodeIds ?? [];
	const data: AgentSelectionObservation = {
		nodeIds,
		...(nodeIds.length > 0 ? { primaryNodeId: nodeIds.at(-1) } : {}),
		...(result.selectedArtboardId
			? { selectedArtboardId: result.selectedArtboardId }
			: {}),
		...(result.selectedSceneCamera
			? { selectedSceneCamera: result.selectedSceneCamera }
			: {}),
		...(result.currentArtboardId
			? { currentArtboardId: result.currentArtboardId }
			: {}),
		...(typeof result.currentFrame === "number"
			? { currentFrame: result.currentFrame }
			: {}),
	};
	return createAgentToolResult("observe_selection", data);
};

/** Captured once when this module first loads, i.e. when the long-running MCP
 * server (or a one-shot vmactl invocation) starts, so `observe_bridge_status`
 * can report this process's own age relative to the checkout on disk. */
const AGENT_PROCESS_STARTED_AT = new Date().toISOString();

export type AgentBridgeStatusObservation = {
	/** `AGENT_BRIDGE_PROTOCOL_VERSION` as imported into this running process at startup. */
	readonly compiledProtocolVersion: number;
	/** The same constant freshly read from `bridge-protocol.ts` on disk, or null if it could not be read/parsed. */
	readonly diskProtocolVersion: number | null;
	/** True only when both versions are known and differ — never true on a failed disk read (see the accompanying issue instead). */
	readonly stale: boolean;
	readonly cwd: string;
	readonly processStartedAt: string;
	/** `git rev-parse --short HEAD` in `cwd`, or null if this is not a git checkout or git is unavailable. */
	readonly diskGitHead: string | null;
	readonly discoveryPath: string;
	readonly discoveryPresent: boolean;
};

/**
 * Reports whether *this running* MCP/vmactl process is stale relative to the
 * checkout on disk. A long-running `bun scripts/vma-agent-mcp.ts` process keeps
 * whatever `AGENT_BRIDGE_PROTOCOL_VERSION` it imported at startup in memory;
 * `bridge-protocol.ts` on disk may have moved on since (a protocol bump, a
 * relay/client fix). Stale MCP server processes are the most repeated
 * live-bridge failure class, and comparing the compiled-in value against a
 * fresh disk read lets an agent tell "my MCP server needs a restart" apart
 * from "no relay is running" instead of guessing. Never throws: every field
 * that can fail independently degrades to `null` with a matching issue
 * instead of rejecting the call.
 */
export const observeAgentBridgeStatus = async (): Promise<
	AgentToolResult<AgentBridgeStatusObservation>
> => {
	const issues: AgentIssue[] = [];
	const cwd = process.cwd();

	let diskProtocolVersion: number | null = null;
	try {
		const source = await readFile(
			path.join(cwd, "src/entities/agent/model/bridge-protocol.ts"),
			"utf8",
		);
		const match = /export const AGENT_BRIDGE_PROTOCOL_VERSION = (\d+)/.exec(
			source,
		);
		diskProtocolVersion = match ? Number(match[1]) : null;
		if (diskProtocolVersion === null) {
			issues.push(
				createAgentIssue(
					"agent.bridge-status-disk-protocol-unreadable",
					"warning",
					"Could not find AGENT_BRIDGE_PROTOCOL_VERSION in bridge-protocol.ts on disk.",
				),
			);
		}
	} catch (error) {
		issues.push(
			createAgentIssue(
				"agent.bridge-status-disk-protocol-unreadable",
				"warning",
				`Could not read bridge-protocol.ts from disk: ${error instanceof Error ? error.message : String(error)}`,
			),
		);
	}

	let diskGitHead: string | null = null;
	try {
		const result = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], {
			cwd,
		});
		diskGitHead =
			result.exitCode === 0 ? result.stdout.toString().trim() || null : null;
		if (diskGitHead === null) {
			issues.push(
				createAgentIssue(
					"agent.bridge-status-git-head-unavailable",
					"info",
					"Could not resolve the current git HEAD (not a git checkout, or git is unavailable).",
				),
			);
		}
	} catch (error) {
		issues.push(
			createAgentIssue(
				"agent.bridge-status-git-head-unavailable",
				"info",
				`Could not resolve the current git HEAD: ${error instanceof Error ? error.message : String(error)}`,
			),
		);
	}

	const discoveryPath = bridgeDiscoveryPath();
	const discoveryPresent = await access(discoveryPath).then(
		() => true,
		() => false,
	);

	const data: AgentBridgeStatusObservation = {
		compiledProtocolVersion: AGENT_BRIDGE_PROTOCOL_VERSION,
		diskProtocolVersion,
		stale:
			diskProtocolVersion !== null &&
			diskProtocolVersion !== AGENT_BRIDGE_PROTOCOL_VERSION,
		cwd,
		processStartedAt: AGENT_PROCESS_STARTED_AT,
		diskGitHead,
		discoveryPath,
		discoveryPresent,
	};

	return createAgentToolResult("observe_bridge_status", data, issues);
};

/**
 * Requests a live editor project save over the bridge while preserving the same
 * editor-side approval policy as the MCP tool.
 */
export const saveProjectLiveResult = async (
	request: AgentBridgeProjectSaveRequest,
	bridge: AgentBridgeForwardTarget | undefined,
): Promise<AgentToolResult<AgentBridgeProjectSaveResult | null>> => {
	const outcome = await forwardLiveProjectSave(request, bridge);
	if (!outcome.ok) {
		return createAgentToolResult("save_project_live", null, [
			createAgentIssue(outcome.code, "error", outcome.error, {
				kind: "tool",
				id: "save_project_live",
			}),
		]);
	}
	const result = outcome.result;
	return createAgentToolResult(
		"save_project_live",
		result,
		result.ok
			? []
			: [
					createAgentIssue(
						`agent.project-save-${result.status}`,
						"error",
						result.message,
						{ kind: "tool", id: "save_project_live" },
					),
				],
	);
};

/**
 * Reads the LIVE editor's open document over the target-fenced, read-only
 * `"observe"` bridge op (B2) — document identity, current artboard, motion
 * timing/inventory, artboard nodes, and scoped Look-graph overlays. Never
 * mutates and never prompts a human, mirroring `observeSelectionLiveResult`.
 */
export const observeDocumentLiveResult = async (
	bridge: AgentBridgeForwardTarget | undefined,
): Promise<AgentToolResult<AgentBridgeObserveResult | null>> => {
	const outcome = await forwardLiveObservation(bridge);
	if (!outcome.ok) {
		return createAgentToolResult("observe_document_live", null, [
			createAgentIssue(outcome.code, "error", outcome.error, {
				kind: "tool",
				id: "observe_document_live",
			}),
		]);
	}
	return createAgentToolResult("observe_document_live", outcome.result);
};

/**
 * Reads the LIVE editor's capture readiness over the read-only `preview-observe`
 * bridge op (Phase D): target identity, the current transport (is-playing is the
 * only gate on a committed still), the current artboard's timing (valid frame
 * range), and whether a still could be captured right now. Never mutates and
 * never prompts a human, mirroring {@link observeDocumentLiveResult}.
 */
export const observePreviewStateResult = async (
	bridge: AgentBridgeForwardTarget | undefined,
): Promise<AgentToolResult<AgentBridgePreviewObserveResult | null>> => {
	const outcome = await forwardLivePreviewObserve(bridge);
	if (!outcome.ok) {
		return createAgentToolResult("observe_preview_state", null, [
			createAgentIssue(outcome.code, "error", outcome.error, {
				kind: "tool",
				id: "observe_preview_state",
			}),
		]);
	}
	return createAgentToolResult("observe_preview_state", outcome.result);
};

export type CaptureEditorSnapshotArgs = {
	readonly frames: readonly number[];
	readonly outDir: string;
	/**
	 * Verify-only: when set and the live current artboard differs, the capture is
	 * aborted rather than switching artboards (switching would be a mutation).
	 */
	readonly artboardId?: string;
	readonly bridge?: AgentBridgeForwardTarget;
};

/** One captured frame's on-disk artifacts + provenance (never the PNG bytes). */
export type CaptureEditorSnapshotFrameArtifact = {
	readonly frame: number;
	readonly status: string;
	readonly message: string;
	readonly sampledFrame?: number;
	readonly sha256?: string;
	readonly width?: number;
	readonly height?: number;
	readonly issues?: readonly string[];
	readonly pngPath?: string;
	readonly metadataPath?: string;
};

/**
 * The `capture_editor_snapshot` result the MCP tool returns to the model:
 * metadata + on-disk paths only. The base64 PNG bytes cross ONLY the WS bridge
 * and are written to `<outDir>/frame-<NNNN>.png`; they never enter this
 * structure. This same object is serialized to `<outDir>/packet.json`, so
 * `issues`/`failureReason` (adversarial review N1) are included here — not just
 * on the outer `AgentToolResult` — so an on-disk packet carries durable
 * provenance of WHY it is `partial`/`failed` even after the tool result itself
 * is gone.
 */
export type CaptureEditorSnapshotData = {
	readonly ok: boolean;
	readonly status: "captured" | "partial" | "failed";
	readonly outDir: string;
	readonly packetPath: string;
	readonly sessionId: string | null;
	readonly target: AgentPreviewCaptureTargetIdentity | null;
	readonly artboardId: string | null;
	readonly requestedFrames: readonly number[];
	readonly capturedFrameCount: number;
	readonly frames: readonly CaptureEditorSnapshotFrameArtifact[];
	readonly issues: readonly AgentIssue[];
	/** Present whenever `status !== "captured"`; a one-line summary of `issues`. */
	readonly failureReason?: string;
};

const captureFrameFileStem = (frame: number): string =>
	`frame-${String(frame).padStart(4, "0")}`;

/**
 * Drives the read-only native artboard capture packet over ONE persistent bridge
 * connection (Phase D): begin -> per-frame capture -> end in a try/finally, so a
 * failure still ends the session and closes the socket (the editor's ~45s
 * inactivity watchdog is the backstop if the agent crashes before `finally`).
 * Each frame writes `frame-<NNNN>.png` (bytes) and `frame-<NNNN>.json`
 * (metadata, no bytes); an overall `packet.json` records target identity, the
 * per-frame hashes, and status. A terminal per-frame failure (drift, epoch,
 * renderer, GPU) restored the session server-side, so the loop stops there.
 */
export const captureEditorSnapshotResult = async ({
	frames,
	outDir,
	artboardId,
	bridge,
}: CaptureEditorSnapshotArgs): Promise<
	AgentToolResult<CaptureEditorSnapshotData | null>
> => {
	const captureIssue = (code: string, message: string): AgentIssue =>
		createAgentIssue(code, "error", message, {
			kind: "tool",
			id: "capture_editor_snapshot",
		});

	if (frames.length === 0) {
		return createAgentToolResult("capture_editor_snapshot", null, [
			captureIssue(
				"agent.capture-no-frames",
				"At least one frame is required.",
			),
		]);
	}
	const invalidFrame = frames.find(
		(frame) => !Number.isInteger(frame) || frame < 0,
	);
	if (invalidFrame !== undefined) {
		return createAgentToolResult("capture_editor_snapshot", null, [
			captureIssue(
				"agent.capture-frame-invalid",
				`Frames must be non-negative integers; received ${String(invalidFrame)}.`,
			),
		]);
	}

	const opened = await openLivePreviewCaptureClient(bridge);
	if (!opened.ok) {
		return createAgentToolResult("capture_editor_snapshot", null, [
			captureIssue(opened.code, opened.error),
		]);
	}
	const client = opened.client;
	try {
		await mkdir(outDir, { recursive: true });
	} catch (error) {
		client.close();
		return createAgentToolResult("capture_editor_snapshot", null, [
			captureIssue("agent.capture-outdir-failed", String(error)),
		]);
	}

	const frameArtifacts: CaptureEditorSnapshotFrameArtifact[] = [];
	const issues: AgentIssue[] = [];
	let sessionId: string | null = null;
	let target: AgentPreviewCaptureTargetIdentity | null = null;
	let capturedFrameCount = 0;

	try {
		const begin = await client.capturePreview({ action: "begin" });
		if (begin.action !== "begin" || begin.status !== "begun") {
			issues.push(
				captureIssue(
					"agent.capture-begin-failed",
					begin.action === "begin"
						? begin.message
						: "Capture session did not begin.",
				),
			);
		} else if (!begin.sessionId) {
			issues.push(
				captureIssue(
					"agent.capture-begin-failed",
					"Capture session began without a sessionId.",
				),
			);
		} else if (
			artboardId &&
			begin.artboard &&
			begin.artboard.id !== artboardId
		) {
			// Verify-only guard: never switch artboards (a mutation).
			sessionId = begin.sessionId;
			target = begin.identity ?? null;
			issues.push(
				captureIssue(
					"agent.capture-artboard-mismatch",
					`Requested artboard "${artboardId}" but the live current artboard is "${begin.artboard.id}"; focus it in the editor before capturing.`,
				),
			);
		} else {
			sessionId = begin.sessionId;
			target = begin.identity ?? null;
			for (const frame of frames) {
				const result = await client.capturePreview({
					action: "capture",
					sessionId,
					frame,
				});
				if (
					result.action === "capture" &&
					result.status === "captured" &&
					result.frame
				) {
					const { pngBase64, ...metadata } = result.frame;
					const stem = captureFrameFileStem(frame);
					const pngPath = path.join(outDir, `${stem}.png`);
					const metadataPath = path.join(outDir, `${stem}.json`);
					await writeFile(pngPath, Buffer.from(pngBase64, "base64"));
					await writeFile(metadataPath, JSON.stringify(metadata, null, 2));
					capturedFrameCount += 1;
					frameArtifacts.push({
						frame,
						status: result.status,
						message: result.message,
						sampledFrame: metadata.sampledFrame,
						sha256: metadata.sha256,
						width: metadata.width,
						height: metadata.height,
						issues: metadata.issues,
						pngPath,
						metadataPath,
					});
				} else {
					const message =
						result.action === "capture"
							? result.message
							: "Unexpected capture result.";
					frameArtifacts.push({ frame, status: result.status, message });
					issues.push(
						captureIssue(
							`agent.capture-${result.status}`,
							`Frame ${frame}: ${message}`,
						),
					);
					// A terminal failure (drift/epoch/renderer/GPU) restored and closed
					// the session server-side; stop, since further captures would be
					// session-not-found.
					if (result.action === "capture" && result.restored) break;
				}
			}
		}
	} catch (error) {
		// A rejected bridge request (relay up but no editor attached ->
		// `agent.no-live-editor`, multi-editor target-required, binding-mismatch,
		// or an older editor without the capability) throws out of capturePreview.
		// Turn it into a typed issue so this tool returns the same clean
		// {status, issues} shape as the other live tools instead of an unhandled
		// throw. Any frames captured before the throw are preserved (both arrays
		// live outside the try); the finally still ends the session and closes.
		const message = error instanceof Error ? error.message : String(error);
		const embeddedCode = message.match(/agent\.[a-z0-9-]+/);
		issues.push(
			captureIssue(embeddedCode?.[0] ?? "agent.capture-bridge-error", message),
		);
	} finally {
		// Always end the session (idempotent server-side) then close the single
		// connection. If the agent crashes before this runs, the editor's ~45s
		// inactivity watchdog restores playback.
		if (sessionId) {
			try {
				await client.capturePreview({ action: "end", sessionId });
			} catch {
				// Best-effort restore; the editor watchdog is the backstop.
			}
		}
		client.close();
	}

	const status: CaptureEditorSnapshotData["status"] =
		capturedFrameCount === frames.length
			? "captured"
			: capturedFrameCount > 0
				? "partial"
				: "failed";
	const packetPath = path.join(outDir, "packet.json");
	const failureReason =
		status === "captured"
			? undefined
			: issues.length > 0
				? issues.map((issue) => `${issue.code}: ${issue.message}`).join("; ")
				: `Captured ${capturedFrameCount} of ${frames.length} requested frames.`;
	const data: CaptureEditorSnapshotData = {
		ok: status !== "failed",
		status,
		outDir,
		packetPath,
		sessionId,
		target,
		artboardId: artboardId ?? null,
		requestedFrames: [...frames],
		capturedFrameCount,
		frames: frameArtifacts,
		issues,
		...(failureReason !== undefined ? { failureReason } : {}),
	};
	try {
		await writeFile(packetPath, JSON.stringify(data, null, 2));
	} catch (error) {
		issues.push(
			captureIssue("agent.capture-packet-write-failed", String(error)),
		);
	}
	return createAgentToolResult("capture_editor_snapshot", data, issues);
};

/**
 * Parses the agent plan file used by `vmactl`. It deliberately validates the
 * stable envelope only; semantic command checks remain in the command compilers.
 *
 * Camera-first reminder: spatial motion (push-in, parallax, establish, orbit,
 * drift) should ride scene-camera tracks (`scene/add-scene-camera` +
 * `motion/upsert-camera-keyframe`), not correlated per-node transforms — see
 * AGENTS.md's Camera-First Motion Standard.
 */
export const parseVmactlPlan = (
	value: unknown,
	fallback?: {
		readonly intent?: string;
		readonly planId?: string;
		readonly source?: DocumentSource;
		readonly bridge?: AgentBridgeForwardTarget;
	},
): AgentToolResult<VmactlPlanFile | null> => {
	const issues: ParsedPlanIssue[] = [];
	if (!isRecord(value)) {
		return agentErrorResult(
			"propose_edit_plan",
			"agent.plan-invalid",
			"Plan file must be a JSON object.",
		);
	}
	const intent =
		optionalString(value, "intent") ??
		fallback?.intent ??
		"Agent-authored vecmo edit plan.";
	const planId =
		optionalString(value, "planId") ??
		fallback?.planId ??
		`vmactl:${randomUUID()}`;
	const transactionId = optionalString(value, "transactionId");
	const source = fallback?.source ?? parseDocumentSource(value.source, issues);
	const bridge = fallback?.bridge ?? parseBridgeTarget(value.bridge, issues);
	const includeValidation =
		typeof value.includeValidation === "boolean"
			? value.includeValidation
			: undefined;

	const requestForGuard = {
		tool: "propose_edit_plan",
		intent,
		...(value.target ? { target: value.target } : {}),
		...(value.documentCommands
			? { documentCommands: value.documentCommands }
			: {}),
		...(value.sceneCommands ? { sceneCommands: value.sceneCommands } : {}),
		...(value.motionCommands ? { motionCommands: value.motionCommands } : {}),
		...(value.motionGrammarCommands
			? { motionGrammarCommands: value.motionGrammarCommands }
			: {}),
		...(includeValidation === undefined ? {} : { includeValidation }),
	};
	if (!isAgentToolRequest(requestForGuard)) {
		issues.push({
			code: "agent.plan-contract-invalid",
			message:
				"Plan envelope failed the agent command contract guard. Check intent, target, and command array shapes.",
		});
	}
	if (
		transactionId === undefined &&
		typeof value.transactionId !== "undefined"
	) {
		issues.push({
			code: "agent.plan-transaction-invalid",
			message: "transactionId must be a non-empty string when provided.",
		});
	}
	if (issues.length > 0) {
		return createAgentToolResult(
			"propose_edit_plan",
			null,
			issues.map((issue) =>
				createAgentIssue(issue.code, "error", issue.message, {
					kind: "tool",
					id: "propose_edit_plan",
				}),
			),
		);
	}

	const request = requestForGuard as GuardedPlanRequest;
	const plan: VmactlPlanFile = {
		planId,
		intent: request.intent,
		...(request.target ? { target: request.target } : {}),
		...(transactionId ? { transactionId } : {}),
		...(request.documentCommands
			? { documentCommands: request.documentCommands }
			: {}),
		...(request.sceneCommands ? { sceneCommands: request.sceneCommands } : {}),
		...(request.motionCommands
			? { motionCommands: request.motionCommands }
			: {}),
		...(request.motionGrammarCommands
			? { motionGrammarCommands: request.motionGrammarCommands }
			: {}),
		...(request.includeValidation === undefined
			? {}
			: { includeValidation: request.includeValidation }),
		...(source ? { source } : {}),
		...(bridge ? { bridge } : {}),
	};
	return createAgentToolResult("propose_edit_plan", plan);
};

/**
 * Reviews a plan against a headless document snapshot without mutation.
 */
export const proposeHeadlessPlan = async (
	plan: AgentCommandPlanRequest,
	source?: DocumentSource,
): Promise<AgentToolResult<AgentEditPlan | null>> =>
	runWithDocument("propose_edit_plan", source, (context) =>
		proposeAgentEditPlan(context, {
			intent: plan.intent,
			...(plan.target ? { target: plan.target } : {}),
			...(plan.documentCommands
				? { documentCommands: plan.documentCommands }
				: {}),
			...(plan.sceneCommands ? { sceneCommands: plan.sceneCommands } : {}),
			...(plan.motionCommands ? { motionCommands: plan.motionCommands } : {}),
			...(plan.motionGrammarCommands
				? { motionGrammarCommands: plan.motionGrammarCommands }
				: {}),
			...(plan.includeValidation === undefined
				? {}
				: { includeValidation: plan.includeValidation }),
		}),
	);

/**
 * Applies a typed command plan to a headless snapshot. Scene commands run first
 * so later motion/grammar compilation sees newly updated scene state; no files
 * or live editor stores are mutated.
 */
export const applyHeadlessPlan = async (
	plan: AgentCommandPlanRequest,
	source: DocumentSource | undefined,
	dryRun: boolean,
): Promise<VmactlHeadlessApplyResult> => {
	const context = await loadDocumentContext(source);
	const proposal = proposeAgentEditPlan(context, {
		intent: plan.intent,
		...(plan.target ? { target: plan.target } : {}),
		...(plan.documentCommands
			? { documentCommands: plan.documentCommands }
			: {}),
		...(plan.sceneCommands ? { sceneCommands: plan.sceneCommands } : {}),
		...(plan.motionCommands ? { motionCommands: plan.motionCommands } : {}),
		...(plan.motionGrammarCommands
			? { motionGrammarCommands: plan.motionGrammarCommands }
			: {}),
		...(plan.includeValidation === undefined
			? {}
			: { includeValidation: plan.includeValidation }),
	});
	if (
		plan.documentCommands &&
		plan.documentCommands.length > 0 &&
		((plan.sceneCommands?.length ?? 0) > 0 ||
			(plan.motionCommands?.length ?? 0) > 0 ||
			(plan.motionGrammarCommands?.length ?? 0) > 0)
	) {
		const issue = createAgentIssue(
			"agent.document-timing-plan-must-be-isolated",
			"error",
			"document/update-timing must be isolated so its Scene and Motion halves remain one atomic headless operation.",
			{ kind: "tool", id: "apply_document_commands" },
		);
		return {
			mode: "headless",
			ok: false,
			planId: plan.planId,
			intent: plan.intent,
			dryRun,
			proposal,
			results: {},
			documents: {
				scene: context.scene,
				motion: context.motion,
				grammar: context.grammar,
			},
			issues: [...proposal.issues, issue],
		};
	}
	if (plan.documentCommands && plan.documentCommands.length > 0) {
		const documentResult = applyAgentDocumentCommands(context, {
			commands: plan.documentCommands,
			dryRun,
			transactionId: plan.transactionId,
		});
		return {
			mode: "headless",
			ok: documentResult.ok,
			planId: plan.planId,
			intent: plan.intent,
			dryRun,
			proposal,
			results: { document: documentResult },
			documents: {
				scene: documentResult.data?.scene ?? context.scene,
				motion: documentResult.data?.motion ?? context.motion,
				grammar: context.grammar,
			},
			issues: [...proposal.issues, ...documentResult.issues],
		};
	}
	let scene = context.scene;
	let motion = context.motion;
	let grammar = context.grammar;
	const sceneResult = plan.sceneCommands
		? applyAgentSceneCommands(context, {
				commands: plan.sceneCommands,
				dryRun,
				transactionId: plan.transactionId,
			})
		: undefined;
	if (sceneResult?.data?.scene && sceneResult.ok)
		scene = sceneResult.data.scene;
	const skippedIssues: AgentIssue[] = [];
	const sceneFailed = sceneResult !== undefined && !sceneResult.ok;
	const motionContext: AgentDocumentContext = { scene, motion, grammar };
	const motionResult =
		plan.motionCommands && !sceneFailed
			? applyAgentMotionCommands(motionContext, {
					commands: plan.motionCommands,
					dryRun,
					transactionId: plan.transactionId,
				})
			: undefined;
	if (plan.motionCommands && sceneFailed) {
		skippedIssues.push(
			createAgentIssue(
				"agent.headless-motion-skipped-after-scene-error",
				"error",
				"Motion commands were skipped because the scene command batch failed.",
				{ kind: "tool", id: "apply_motion_commands" },
			),
		);
	}
	if (motionResult?.data?.motion && motionResult.ok)
		motion = motionResult.data.motion;
	const motionFailed = motionResult !== undefined && !motionResult.ok;
	const grammarContext: AgentDocumentContext = { scene, motion, grammar };
	const motionGrammarResult =
		plan.motionGrammarCommands && !sceneFailed && !motionFailed
			? applyAgentMotionGrammarCommands(grammarContext, {
					commands: plan.motionGrammarCommands,
					dryRun,
					transactionId: plan.transactionId,
				})
			: undefined;
	if (plan.motionGrammarCommands && (sceneFailed || motionFailed)) {
		skippedIssues.push(
			createAgentIssue(
				"agent.headless-motion-grammar-skipped-after-prior-error",
				"error",
				"Motion-grammar commands were skipped because an earlier command batch failed.",
				{ kind: "tool", id: "apply_motion_grammar_commands" },
			),
		);
	}
	if (motionGrammarResult?.data?.grammar && motionGrammarResult.ok) {
		grammar = motionGrammarResult.data.grammar;
	}
	const results = {
		...(sceneResult ? { scene: sceneResult } : {}),
		...(motionResult ? { motion: motionResult } : {}),
		...(motionGrammarResult ? { motionGrammar: motionGrammarResult } : {}),
	};
	const issues = [
		...proposal.issues,
		...(sceneResult?.issues ?? []),
		...(motionResult?.issues ?? []),
		...(motionGrammarResult?.issues ?? []),
		...skippedIssues,
	];
	return {
		mode: "headless",
		ok: !issues.some((issue) => issue.severity === "error"),
		planId: plan.planId,
		intent: plan.intent,
		dryRun,
		proposal,
		results,
		documents: { scene, motion, grammar },
		issues,
	};
};

export const observeHeadlessDocument = async (
	source: DocumentSource | undefined,
	detail: "summary" | "normal" | "full" | undefined,
): Promise<AgentToolResult<unknown | null>> =>
	runWithDocument("observe_document", source, (context) =>
		observeAgentDocument(context, detail),
	);

export const observeHeadlessNode = async (
	source: DocumentSource | undefined,
	nodeIds: readonly string[],
	includeGeometry?: boolean,
): Promise<AgentToolResult<unknown | null>> =>
	runWithDocument("observe_node", source, (context) =>
		observeAgentNode(context, {
			tool: "observe_node",
			nodeIds,
			...(includeGeometry === undefined ? {} : { includeGeometry }),
		}),
	);

export const validateHeadlessDocument = async (
	source: DocumentSource | undefined,
): Promise<AgentToolResult<unknown | null>> =>
	runWithDocument("run_validation", source, (context) =>
		validateAgentDocument(context),
	);
