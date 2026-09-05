import { readFileSync } from "node:fs";
import path from "node:path";

// The agent command contract is manually mirrored across four places: the
// AgentSceneCommand/AgentMotionCommand/AgentMotionGrammarCommand discriminated
// unions in entities/agent/model/types.ts, the compile switches in
// entities/agent/model/write.ts, the runtime narrowing guards in
// entities/agent/model/contracts.ts, and the Zod wire schemas in
// scripts/vma-agent-mcp.ts. A kind added to one and forgotten in another compiles
// fine (the union/switch/guard/schema are each individually well-typed) but drifts
// silently at the MCP boundary — this check is the ratchet that catches that.
// It also checks the smaller AGENT_TOOL_NAMES vs. server.registerTool(...) pairing
// for the same reason (a declared-but-unregistered tool, or vice versa).
const repoRoot = process.cwd();
const errors: string[] = [];

type CommandFamily = {
	readonly label: string;
	/** `write.ts` switch function name anchors: the compile function starts here... */
	readonly writeFunctionStart: RegExp;
	/** ...and ends right before the next top-level declaration (exclusive). */
	readonly writeFunctionEnd: RegExp;
	/** `contracts.ts` guard function name anchor (same start/end scoping). */
	readonly contractsFunctionStart: RegExp;
	readonly contractsFunctionEnd: RegExp;
	/** Case-label / Zod-literal prefix that scopes extraction to this family only,
	 * so a nested sub-switch's unrelated literals (e.g. `"add"`, `"scene"`) never
	 * get mistaken for a top-level command kind. */
	readonly kindPrefix: string;
	/** Exported Zod schema in vma-agent-mcp.ts to introspect at runtime. */
	readonly schemaExportName: string;
};

const COMMAND_FAMILIES: readonly CommandFamily[] = [
	{
		label: "AgentSceneCommand",
		writeFunctionStart: /^const compileAgentSceneCommand = \(/m,
		writeFunctionEnd: /^export function compileAgentSceneCommandBatch\(/m,
		contractsFunctionStart: /^const isAgentSceneCommand = \(value: unknown\)/m,
		contractsFunctionEnd: /^const isAgentMotionCommand = \(value: unknown\)/m,
		kindPrefix: "scene/",
		schemaExportName: "sceneCommandSchema",
	},
	{
		label: "AgentMotionCommand",
		writeFunctionStart: /^const compileAgentMotionCommand = \(/m,
		writeFunctionEnd: /^export function compileAgentMotionCommandBatch\(/m,
		contractsFunctionStart: /^const isAgentMotionCommand = \(value: unknown\)/m,
		contractsFunctionEnd: /^const isAgentMotionGrammarCommand = \(\s*$/m,
		kindPrefix: "motion/",
		schemaExportName: "motionCommandSchema",
	},
	{
		label: "AgentMotionGrammarCommand",
		writeFunctionStart: /^const compileAgentMotionGrammarCommand = \(/m,
		writeFunctionEnd:
			/^export function compileAgentMotionGrammarCommandBatch\(/m,
		contractsFunctionStart: /^const isAgentMotionGrammarCommand = \(\s*$/m,
		contractsFunctionEnd: /^const hasCommandArray = </m,
		kindPrefix: "motion-grammar/",
		schemaExportName: "motionGrammarCommandSchema",
	},
	{
		label: "AgentCameraVerbCommand",
		writeFunctionStart: /^const compileAgentCameraVerbCommand = \(/m,
		writeFunctionEnd: /^export function compileAgentCameraVerbCommandBatch\(/m,
		contractsFunctionStart: /^export const isAgentCameraVerbCommand = \(/m,
		contractsFunctionEnd: /^const isAgentDocumentCommand = \(/m,
		kindPrefix: "camera/",
		schemaExportName: "cameraVerbCommandSchema",
	},
];

// One left-to-right pass over string/template literals and comments, same
// technique as check-architecture.ts, so a `case "..."` mentioned in prose or a
// commented-out branch is not read as a live case label.
const literalOrCommentPattern =
	/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;

function stripComments(source: string): string {
	return source.replace(literalOrCommentPattern, (match) =>
		match.startsWith("/") ? " " : match,
	);
}

function readSource(relativePath: string): string {
	return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

/** Slices `source` between two anchor regexes (end exclusive), for scoping
 * extraction to one function's body without a full brace-matching parser. */
function sliceBetween(source: string, start: RegExp, end: RegExp): string {
	const startMatch = start.exec(source);
	if (!startMatch) {
		errors.push(
			`check-agent-contract: anchor ${start} not found — file structure moved, update the script's anchors.`,
		);
		return "";
	}
	const endMatch = end.exec(source);
	if (!endMatch || endMatch.index <= startMatch.index) {
		errors.push(
			`check-agent-contract: anchor ${end} not found after ${start} — file structure moved, update the script's anchors.`,
		);
		return "";
	}
	return source.slice(startMatch.index, endMatch.index);
}

/** Extracts every `case "<prefix>...">` label's string literal from a switch
 * body region. Scoping by prefix means a nested sub-switch's bare-word case
 * labels (`case "add"`, `case "scene"`) never collide with a top-level command
 * kind, without needing to track brace nesting depth. */
function extractCaseLabels(
	regionSource: string,
	kindPrefix: string,
): Set<string> {
	const stripped = stripComments(regionSource);
	const escapedPrefix = kindPrefix.replace(/[/-]/g, "\\$&");
	const pattern = new RegExp(`case "(${escapedPrefix}[a-z-]+)"`, "g");
	const found = new Set<string>();
	for (const match of stripped.matchAll(pattern)) {
		found.add(match[1]);
	}
	return found;
}

/** Extracts every prefixed literal from a `readonly type: ...;` declaration. */
function extractTypeLiterals(
	regionSource: string,
	kindPrefix: string,
): Set<string> {
	const stripped = stripComments(regionSource);
	const escapedPrefix = kindPrefix.replace(/[/-]/g, "\\$&");
	const literalPattern = new RegExp(`"(${escapedPrefix}[a-z-]+)"`, "g");
	const found = new Set<string>();
	for (const declaration of stripped.matchAll(
		/readonly type:\s*([\s\S]*?);/g,
	)) {
		for (const match of declaration[1].matchAll(literalPattern)) {
			found.add(match[1]);
		}
	}
	return found;
}

/** Extracts every `<object>.type === "<prefix>..."` direct comparison. */
function extractEqualityLiterals(
	regionSource: string,
	objectName: string,
	kindPrefix: string,
): Set<string> {
	const stripped = stripComments(regionSource);
	const escapedObjectName = objectName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const escapedPrefix = kindPrefix.replace(/[/-]/g, "\\$&");
	const pattern = new RegExp(
		`${escapedObjectName}\\.type === "(${escapedPrefix}[a-z-]+)"`,
		"g",
	);
	const found = new Set<string>();
	for (const match of stripped.matchAll(pattern)) {
		found.add(match[1]);
	}
	return found;
}

/** Extracts every `server.registerTool("...", ...)` first-argument literal. */
function extractRegisteredToolNames(source: string): Set<string> {
	const stripped = stripComments(source);
	const found = new Set<string>();
	for (const match of stripped.matchAll(
		/server\.registerTool\(\s*"([a-z_]+)"/g,
	)) {
		found.add(match[1]);
	}
	return found;
}

/** Reports the literals present in `have` but absent from `want`, and vice
 * versa, against a family label and two named sources. */
function reportSetDiff(
	familyLabel: string,
	sourceLabel: string,
	sourceKinds: ReadonlySet<string>,
	referenceLabel: string,
	referenceKinds: ReadonlySet<string>,
): void {
	const missingFromSource = [...referenceKinds].filter(
		(kind) => !sourceKinds.has(kind),
	);
	const extraInSource = [...sourceKinds].filter(
		(kind) => !referenceKinds.has(kind),
	);
	for (const kind of missingFromSource) {
		errors.push(
			`${familyLabel} "${kind}": present in ${referenceLabel} but missing from ${sourceLabel}.`,
		);
	}
	for (const kind of extraInSource) {
		errors.push(
			`${familyLabel} "${kind}": present in ${sourceLabel} but missing from ${referenceLabel}.`,
		);
	}
}

async function checkCommandFamilies(): Promise<void> {
	const typesSource = readSource("src/entities/agent/model/types.ts");
	const writeSource = readSource("src/entities/agent/model/write.ts");
	const contractsSource = readSource("src/entities/agent/model/contracts.ts");
	// Dynamic import (not readFileSync) for the Zod schemas: they are real
	// z.discriminatedUnion/z.union instances, so importing the module and reading
	// each member's literal `type` value off the schema is a genuine runtime
	// introspection of the wire contract, not a second hand-copied literal list.
	// scripts/vma-agent-mcp.ts guards its stdio transport connect behind
	// `import.meta.main`, so importing it here does not start an MCP server.
	const mcpModule = (await import(
		path.join(repoRoot, "scripts/vma-agent-mcp.ts")
	)) as Record<string, unknown>;

	// types.ts has no canonical `as const` array for these three unions (unlike
	// AGENT_TOOL_NAMES) — each member is an anonymous object type, so there is no
	// runtime value to import. The union's own `readonly type: "kind"` literals are
	// extracted from source the same way as the write.ts/contracts.ts case labels,
	// scoped to the union's declaration by anchoring on its `export type ... =`
	// start and the next top-level `export type`/`export function` declaration.
	const typeUnionAnchors: Record<
		CommandFamily["label"],
		{ readonly start: RegExp; readonly end: RegExp }
	> = {
		AgentSceneCommand: {
			start: /^export type AgentSceneCommand =$/m,
			end: /^export type AgentBindableEffectTarget =/m,
		},
		AgentMotionCommand: {
			start: /^export type AgentMotionCommand =$/m,
			end: /^export type AgentApplySceneCommandsRequest = \{/m,
		},
		AgentMotionGrammarCommand: {
			start: /^export type AgentMotionGrammarCommand =$/m,
			end: /^export type AgentApplyMotionGrammarCommandsRequest = \{/m,
		},
		AgentCameraVerbCommand: {
			start: /^export type AgentCameraVerbCommand =$/m,
			end: /^export type AgentDocumentCommand =$/m,
		},
	};

	for (const family of COMMAND_FAMILIES) {
		const anchors = typeUnionAnchors[family.label];
		const typeRegion = sliceBetween(typesSource, anchors.start, anchors.end);
		const typeKinds = extractTypeLiterals(typeRegion, family.kindPrefix);

		const writeRegion = sliceBetween(
			writeSource,
			family.writeFunctionStart,
			family.writeFunctionEnd,
		);
		const writeKinds = extractCaseLabels(writeRegion, family.kindPrefix);

		const contractsRegion = sliceBetween(
			contractsSource,
			family.contractsFunctionStart,
			family.contractsFunctionEnd,
		);
		const contractsKinds = extractCaseLabels(
			contractsRegion,
			family.kindPrefix,
		);

		const schema = mcpModule[family.schemaExportName] as
			| { readonly options: readonly unknown[] }
			| undefined;
		if (!schema || !Array.isArray(schema.options)) {
			errors.push(
				`check-agent-contract: scripts/vma-agent-mcp.ts does not export a Zod union "${family.schemaExportName}" (or its shape changed) — update the script.`,
			);
			continue;
		}
		const schemaKinds = new Set<string>();
		for (const option of schema.options) {
			const literalDef = (
				option as {
					readonly shape?: {
						readonly type?: {
							readonly def?: { readonly values?: readonly string[] };
						};
					};
				}
			).shape?.type?.def?.values;
			const literal = literalDef?.[0];
			if (
				typeof literal === "string" &&
				literal.startsWith(family.kindPrefix)
			) {
				schemaKinds.add(literal);
			}
		}

		if (typeKinds.size === 0) {
			errors.push(
				`check-agent-contract: extracted zero "${family.kindPrefix}" kinds from ${family.label}'s type declaration in types.ts — anchor regex likely stale.`,
			);
			continue;
		}

		// types.ts is the source of truth (the union declaration); the other three
		// are checked against it, and against each other transitively.
		reportSetDiff(family.label, "write.ts", writeKinds, "types.ts", typeKinds);
		reportSetDiff(
			family.label,
			"contracts.ts",
			contractsKinds,
			"types.ts",
			typeKinds,
		);
		reportSetDiff(
			family.label,
			"vma-agent-mcp.ts Zod schema",
			schemaKinds,
			"types.ts",
			typeKinds,
		);
	}
}

function checkToolNames(): void {
	const typesSource = readSource("src/entities/agent/model/types.ts");
	const mcpSource = readSource("scripts/vma-agent-mcp.ts");

	const declaredMatch =
		/export const AGENT_TOOL_NAMES = \[([\s\S]*?)\] as const;/.exec(
			typesSource,
		);
	if (!declaredMatch) {
		errors.push(
			"check-agent-contract: AGENT_TOOL_NAMES declaration not found in types.ts — update the script's anchor.",
		);
		return;
	}
	const declaredNames = new Set<string>();
	for (const match of declaredMatch[1].matchAll(/"([a-z_]+)"/g)) {
		declaredNames.add(match[1]);
	}
	if (declaredNames.size === 0) {
		errors.push(
			"check-agent-contract: parsed zero tool names from AGENT_TOOL_NAMES — anchor regex likely stale.",
		);
		return;
	}

	const registeredNames = extractRegisteredToolNames(mcpSource);
	reportSetDiff(
		"AgentToolName",
		"vma-agent-mcp.ts server.registerTool(...) calls",
		registeredNames,
		"AGENT_TOOL_NAMES",
		declaredNames,
	);
}

/**
 * Checks the cross-owner `document/` family across its type union, compiler,
 * runtime guard, Zod wire schema, and CLI plan envelope.
 */
async function checkDocumentCommandFamily(): Promise<void> {
	const typesSource = readSource("src/entities/agent/model/types.ts");
	const writeSource = readSource("src/entities/agent/model/write.ts");
	const contractsSource = readSource("src/entities/agent/model/contracts.ts");

	const typeRegion = sliceBetween(
		typesSource,
		/^export type AgentDocumentCommand =$/m,
		/^export type AgentCommandReviewKind =$/m,
	);
	const typeKinds = extractTypeLiterals(typeRegion, "document/");
	if (typeKinds.size === 0) {
		errors.push(
			'check-agent-contract: extracted zero "document/" kinds from AgentDocumentCommand\'s type declaration in types.ts — anchor regex likely stale.',
		);
		return;
	}

	const contractsRegion = sliceBetween(
		contractsSource,
		/^const isAgentDocumentCommand = \(/m,
		/^const hasCommandArray = </m,
	);
	const contractsKinds = extractCaseLabels(contractsRegion, "document/");
	reportSetDiff(
		"AgentDocumentCommand",
		"contracts.ts",
		contractsKinds,
		"types.ts",
		typeKinds,
	);

	const writeRegion = sliceBetween(
		writeSource,
		/^const compileAgentDocumentCommandBatch = \(/m,
		/^export \{ compileAgentDocumentCommandBatch \};/m,
	);
	const writeKinds = extractEqualityLiterals(
		writeRegion,
		"command",
		"document/",
	);
	reportSetDiff(
		"AgentDocumentCommand",
		"write.ts",
		writeKinds,
		"types.ts",
		typeKinds,
	);

	// Same dynamic-import rationale as checkCommandFamilies: introspect the real
	// discriminated union rather than maintaining another literal list here.
	const mcpModule = (await import(
		path.join(repoRoot, "scripts/vma-agent-mcp.ts")
	)) as Record<string, unknown>;
	const schema = mcpModule.documentCommandSchema as
		| { readonly options: readonly unknown[] }
		| undefined;
	if (!schema || !Array.isArray(schema.options)) {
		errors.push(
			'check-agent-contract: scripts/vma-agent-mcp.ts does not export a Zod union "documentCommandSchema" (or its shape changed) — update the script.',
		);
	} else {
		const schemaKinds = new Set<string>();
		for (const option of schema.options) {
			const literal = (
				option as {
					readonly shape?: {
						readonly type?: {
							readonly def?: { readonly values?: readonly string[] };
						};
					};
				}
			).shape?.type?.def?.values?.[0];
			if (typeof literal === "string" && literal.startsWith("document/")) {
				schemaKinds.add(literal);
			}
		}
		reportSetDiff(
			"AgentDocumentCommand",
			"vma-agent-mcp.ts Zod schema",
			schemaKinds,
			"types.ts",
			typeKinds,
		);
	}

	// The CLI's plan envelope is plain documentation strings, not a runtime
	// schema, and vmactl.ts calls its CLI `main()` unconditionally at module
	// load (unlike vma-agent-mcp.ts, which guards its server start behind
	// `import.meta.main`) — a dynamic import here would run `main()` against
	// this script's own argv and could exit the process before returning. Read
	// it as plain source text instead.
	const vmactlSource = readSource("scripts/vmactl.ts");
	const envelopeRegion = sliceBetween(
		vmactlSource,
		/^\tplanEnvelope: \{$/m,
		/^\tcommands: \[$/m,
	);
	if (envelopeRegion && !/\bdocumentCommands:/.test(envelopeRegion)) {
		errors.push(
			'AgentDocumentCommand "document/update-timing": present in types.ts but missing from scripts/vmactl.ts commandSchema.planEnvelope (documentCommands key) — parseVmactlPlan already forwards documentCommands, so the documented envelope must mention it too.',
		);
	}
}

await checkCommandFamilies();
checkToolNames();
await checkDocumentCommandFamily();

if (errors.length > 0) {
	console.error("Agent contract check failed.");
	console.error(
		"A command kind or tool name is out of sync across entities/agent/model/{types,write,contracts}.ts and scripts/vma-agent-mcp.ts.",
	);
	for (const error of errors) console.error(`- ${error}`);
	process.exit(1);
}

console.log("Agent contract check passed.");
