#!/usr/bin/env bun

import {
	createHash,
	randomBytes,
	randomUUID,
	timingSafeEqual,
} from "node:crypto";
import { type Dirent, type FSWatcher, type Stats, watch } from "node:fs";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import {
	deriveProgramSurfaceReferenceManifest,
	encodeProgramSurfaceBridgeMessage,
	PROGRAM_SURFACE_BRIDGE_ERROR_CODE,
	PROGRAM_SURFACE_BRIDGE_MAX_APPROVED_BUNDLE_BYTES,
	PROGRAM_SURFACE_BRIDGE_PROTOCOL_VERSION,
	PROGRAM_SURFACE_COMPILED_ENTRY,
	PROGRAM_SURFACE_LOCAL_SOURCE_DESCRIPTOR_FILENAME,
	type ProgramSurfaceBridgeBuildCandidateMessage,
	type ProgramSurfaceBridgeClientMessage,
	type ProgramSurfaceBridgeDiagnostic,
	type ProgramSurfaceBridgeDigest,
	type ProgramSurfaceBridgeEditorTarget,
	type ProgramSurfaceBridgeManifestListing,
	type ProgramSurfaceBridgeServerMessage,
	type ProgramSurfaceBuildIdentity,
	type ProgramSurfaceLocalSourceDescriptorV1,
	parseProgramSurfaceBridgeClientMessage,
	parseProgramSurfaceLocalSourceDescriptor,
	serializeProgramSurfaceBridgeCanonicalJson,
	serializeProgramSurfaceBridgeManifest,
} from "../src/entities/scene/model/program-surface-bridge-protocol";
import { inspectProgramSurfaceBundleV1 } from "../src/features/program-surface/model/bundle-static-gate";
import { inspectProgramSurfaceStaticProfile } from "../src/features/program-surface/model/static-profile";
import {
	clearProgramSurfaceBridgeDiscovery,
	programSurfaceBridgeDiscoveryPath,
	writeProgramSurfaceBridgeDiscovery,
} from "./program-surface-bridge-discovery";

/**
 * User-started, loopback-only companion for a single local Program Surface
 * workspace. It deliberately has no scene/document import: it can prepare an
 * explicit candidate, but only a future editor feature may decide to persist
 * or activate the declared asset through the Scene command bus.
 */

const MAX_DESCRIPTOR_BYTES = 128 * 1024;
const MAX_SOURCE_FILE_BYTES = 2 * 1024 * 1024;
const MAX_SOURCE_GRAPH_BYTES = 8 * 1024 * 1024;
const MAX_SOURCE_GRAPH_FILES = 128;
const MAX_DISCOVERED_MANIFESTS = 64;
const MAX_SCANNED_DIRECTORIES = 10_000;
const MAX_BUNDLE_BYTES = PROGRAM_SURFACE_BRIDGE_MAX_APPROVED_BUNDLE_BYTES;
const WATCH_DEBOUNCE_MS = 180;
const HEARTBEAT_TIMEOUT_MS = 30_000;
const PAIRING_FAILURE_LIMIT = 5;
const PAIRING_COOLDOWN_MS = 30_000;

const ignoredWorkspaceDirectories = new Set([
	".git",
	".hg",
	".svn",
	"node_modules",
	"dist",
	"coverage",
]);
const sourceModuleSuffixes = [".js", ".mjs", ".ts", ".tsx", ".jsx"] as const;

type BridgeWs = {
	data: ConnectionData;
	send: (data: string) => unknown;
	close: (code?: number, reason?: string) => void;
};

type ConnectionData = {
	origin: string | null;
	helloPending: boolean;
	tokenConsumed: boolean;
};

type ScannedManifest = {
	readonly id: string;
	readonly descriptorPath: string;
	readonly packageRoot: string;
	readonly workspaceRelativePath: string;
	readonly name: string;
};

type ResolvedSourceFile = {
	readonly absolutePath: string;
	readonly packageRelativePath: string;
	readonly bytes: Uint8Array;
};

/**
 * Companion-only build detail. It may retain an actionable local path and
 * explanatory message for terminal diagnostics, but must never cross the
 * loopback browser protocol.
 */
type PrivateBridgeDiagnostic = {
	readonly code: string;
	readonly message: string;
	readonly path?: string;
};

type ClosedSourceGraph = {
	readonly descriptor: ProgramSurfaceLocalSourceDescriptorV1;
	readonly descriptorBytes: Uint8Array;
	readonly entry: ResolvedSourceFile;
	readonly files: readonly ResolvedSourceFile[];
	readonly snapshotDigest: ProgramSurfaceBridgeDigest;
	readonly inputDigest: ProgramSurfaceBridgeDigest;
};

type Candidate = {
	readonly identity: ProgramSurfaceBuildIdentity;
	/** Matches the durable reference-only manifest source.snapshotDigest. */
	readonly authoringInputDigest: ProgramSurfaceBridgeDigest;
	readonly manifest: ProgramSurfaceBridgeBuildCandidateMessage["manifest"];
	readonly bytes: Uint8Array;
	readonly diagnostics: readonly ProgramSurfaceBridgeDiagnostic[];
	readonly files: readonly ResolvedSourceFile[];
};

type LastKnownGood = Pick<Candidate, "identity" | "manifest" | "bytes">;

type Binding = {
	readonly id: string;
	readonly scanned: ScannedManifest;
	readonly assetId: string;
	generation: number;
	candidate: Candidate | null;
	lastKnownGood: LastKnownGood | null;
	watchers: FSWatcher[];
	watchTimer: ReturnType<typeof setTimeout> | null;
	buildRunning: boolean;
	rebuildQueued: boolean;
};

type ActiveSession = {
	readonly id: string;
	readonly target: ProgramSurfaceBridgeEditorTarget;
	readonly ws: BridgeWs;
	readonly manifests: ReadonlyMap<string, ScannedManifest>;
	binding: Binding | null;
	heartbeatTimer: ReturnType<typeof setTimeout> | null;
};

class BridgeFailure extends Error {
	constructor(readonly diagnostic: PrivateBridgeDiagnostic) {
		super(diagnostic.code);
	}
}

const failure = (
	code: string,
	message: string,
	diagnosticPath?: string,
): BridgeFailure =>
	new BridgeFailure({
		code,
		message,
		...(diagnosticPath ? { path: diagnosticPath } : {}),
	});

const publicDiagnosticFor = (
	diagnostic: PrivateBridgeDiagnostic,
): ProgramSurfaceBridgeDiagnostic => ({
	code:
		diagnostic.code === "program-surface-watch-unavailable"
			? "program-surface-bridge-watch-unavailable"
			: "program-surface-bridge-build-failed",
});

/**
 * Keep actionable path and compiler context on the user-started companion
 * terminal only. JSON encoding prevents an unusual filename from controlling
 * terminal output.
 */
const logPrivateDiagnostic = (diagnostic: PrivateBridgeDiagnostic): void => {
	process.stderr.write(
		`[program-surface-bridge] private diagnostic ${JSON.stringify(diagnostic)}\n`,
	);
};

const isWithin = (root: string, candidate: string): boolean => {
	const relative = path.relative(root, candidate);
	return (
		relative === "" ||
		(!relative.startsWith(`..${path.sep}`) &&
			relative !== ".." &&
			!path.isAbsolute(relative))
	);
};

const toPortableRelativePath = (root: string, candidate: string): string => {
	if (!isWithin(root, candidate)) {
		throw failure(
			"program-surface-path-escape",
			"Program Surface source resolved outside the authorized workspace.",
		);
	}
	const relative = path.relative(root, candidate).split(path.sep).join("/");
	return relative || ".";
};

const isAllowedSourceModulePath = (value: string): boolean =>
	!value.endsWith(".d.ts") &&
	sourceModuleSuffixes.some((suffix) => value.endsWith(suffix));

const sha256 = (value: Uint8Array | string): ProgramSurfaceBridgeDigest =>
	`sha256:${createHash("sha256").update(value).digest("hex")}` as ProgramSurfaceBridgeDigest;

const appendDigestRecord = (
	hash: ReturnType<typeof createHash>,
	label: string,
	bytes: Uint8Array,
): void => {
	hash.update(
		Buffer.from(`${Buffer.byteLength(label, "utf8")}:${label}:`, "utf8"),
	);
	hash.update(Buffer.from(`${bytes.byteLength}:`, "utf8"));
	hash.update(bytes);
	hash.update(Buffer.from("\n", "utf8"));
};

/** Locale-independent ordering keeps source and manifest digests portable. */
const compareCanonicalText = (left: string, right: string): number =>
	left === right ? 0 : left < right ? -1 : 1;

const sortedGraphFiles = (
	files: readonly ResolvedSourceFile[],
): readonly ResolvedSourceFile[] =>
	[...files].sort((left, right) =>
		compareCanonicalText(left.packageRelativePath, right.packageRelativePath),
	);

const graphSnapshotDigest = (
	entry: ResolvedSourceFile,
	files: readonly ResolvedSourceFile[],
): ProgramSurfaceBridgeDigest => {
	const hash = createHash("sha256");
	hash.update("vecmo-program-surface-source-graph-v1\n");
	appendDigestRecord(
		hash,
		"entry",
		Buffer.from(entry.packageRelativePath, "utf8"),
	);
	for (const file of sortedGraphFiles(files)) {
		appendDigestRecord(hash, file.packageRelativePath, file.bytes);
	}
	return `sha256:${hash.digest("hex")}` as ProgramSurfaceBridgeDigest;
};

const graphInputDigest = (
	descriptorBytes: Uint8Array,
	files: readonly ResolvedSourceFile[],
): ProgramSurfaceBridgeDigest => {
	const hash = createHash("sha256");
	hash.update("vecmo-program-surface-input-v1\n");
	appendDigestRecord(hash, "descriptor", descriptorBytes);
	for (const file of sortedGraphFiles(files)) {
		appendDigestRecord(hash, file.packageRelativePath, file.bytes);
	}
	return `sha256:${hash.digest("hex")}` as ProgramSurfaceBridgeDigest;
};

const decodeSourceText = (
	bytes: Uint8Array,
	diagnosticPath: string,
): string => {
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		throw failure(
			"program-surface-source-not-utf8",
			"Program Surface source modules must be valid UTF-8 text.",
			diagnosticPath,
		);
	}
};

const readCanonicalRegularFile = async (
	candidate: string,
	packageRoot: string,
	maximumBytes: number,
	diagnosticPath: string,
): Promise<ResolvedSourceFile> => {
	if (!isWithin(packageRoot, candidate)) {
		throw failure(
			"program-surface-path-escape",
			"Program Surface source import resolved outside its package root.",
			diagnosticPath,
		);
	}
	let initialStats: Stats;
	try {
		initialStats = await lstat(candidate);
	} catch {
		throw failure(
			"program-surface-source-missing",
			"Program Surface source module is unavailable.",
			diagnosticPath,
		);
	}
	if (!initialStats.isFile()) {
		throw failure(
			"program-surface-source-not-file",
			"Program Surface source modules must be regular local files.",
			diagnosticPath,
		);
	}
	if (initialStats.size > maximumBytes) {
		throw failure(
			"program-surface-source-too-large",
			"Program Surface source module exceeds the V1 size limit.",
			diagnosticPath,
		);
	}

	let canonicalPath: string;
	try {
		canonicalPath = await realpath(candidate);
	} catch {
		throw failure(
			"program-surface-source-missing",
			"Program Surface source module is unavailable.",
			diagnosticPath,
		);
	}
	if (!isWithin(packageRoot, canonicalPath)) {
		throw failure(
			"program-surface-symlink-escape",
			"Program Surface source module escaped its package root after resolution.",
			diagnosticPath,
		);
	}
	let bytes: Uint8Array;
	try {
		bytes = new Uint8Array(await readFile(canonicalPath));
	} catch {
		throw failure(
			"program-surface-source-unreadable",
			"Program Surface source module could not be read.",
			diagnosticPath,
		);
	}
	if (bytes.byteLength > maximumBytes) {
		throw failure(
			"program-surface-source-too-large",
			"Program Surface source module exceeds the V1 size limit.",
			diagnosticPath,
		);
	}
	return {
		absolutePath: canonicalPath,
		packageRelativePath: toPortableRelativePath(packageRoot, canonicalPath),
		bytes,
	};
};

const readDescriptor = async (
	scanned: ScannedManifest,
): Promise<{
	readonly descriptor: ProgramSurfaceLocalSourceDescriptorV1;
	readonly descriptorBytes: Uint8Array;
	readonly entry: ResolvedSourceFile;
}> => {
	let descriptorStats: Stats;
	try {
		descriptorStats = await lstat(scanned.descriptorPath);
	} catch {
		throw failure(
			"program-surface-descriptor-missing",
			"Program Surface source descriptor is unavailable.",
			scanned.workspaceRelativePath,
		);
	}
	if (
		!descriptorStats.isFile() ||
		descriptorStats.size > MAX_DESCRIPTOR_BYTES
	) {
		throw failure(
			"program-surface-descriptor-invalid",
			"Program Surface source descriptor must be a bounded regular file.",
			scanned.workspaceRelativePath,
		);
	}
	let canonicalDescriptorPath: string;
	try {
		canonicalDescriptorPath = await realpath(scanned.descriptorPath);
	} catch {
		throw failure(
			"program-surface-descriptor-missing",
			"Program Surface source descriptor is unavailable.",
			scanned.workspaceRelativePath,
		);
	}
	if (
		canonicalDescriptorPath !== scanned.descriptorPath ||
		path.dirname(canonicalDescriptorPath) !== scanned.packageRoot
	) {
		throw failure(
			"program-surface-descriptor-moved",
			"Program Surface source descriptor no longer resolves inside its authorized package root.",
			scanned.workspaceRelativePath,
		);
	}
	let rawDescriptor: Uint8Array;
	try {
		rawDescriptor = new Uint8Array(await readFile(canonicalDescriptorPath));
	} catch {
		throw failure(
			"program-surface-descriptor-unreadable",
			"Program Surface source descriptor could not be read.",
			scanned.workspaceRelativePath,
		);
	}
	if (rawDescriptor.byteLength > MAX_DESCRIPTOR_BYTES) {
		throw failure(
			"program-surface-descriptor-invalid",
			"Program Surface source descriptor exceeds the V1 size limit.",
			scanned.workspaceRelativePath,
		);
	}
	let parsedJson: unknown;
	try {
		parsedJson = JSON.parse(
			decodeSourceText(rawDescriptor, scanned.workspaceRelativePath),
		);
	} catch (error) {
		if (error instanceof BridgeFailure) throw error;
		throw failure(
			"program-surface-descriptor-invalid-json",
			"Program Surface source descriptor must contain valid JSON.",
			scanned.workspaceRelativePath,
		);
	}
	const parsed = parseProgramSurfaceLocalSourceDescriptor(parsedJson);
	if (!parsed.ok) {
		throw failure(parsed.code, parsed.message, scanned.workspaceRelativePath);
	}
	const canonicalDescriptorBytes = Buffer.from(
		serializeProgramSurfaceBridgeCanonicalJson(parsed.descriptor),
		"utf8",
	);
	const entryCandidate = path.resolve(
		scanned.packageRoot,
		parsed.descriptor.entry,
	);
	const entryDiagnosticPath = toPortableRelativePath(
		scanned.packageRoot,
		entryCandidate,
	);
	const entry = await readCanonicalRegularFile(
		entryCandidate,
		scanned.packageRoot,
		MAX_SOURCE_FILE_BYTES,
		entryDiagnosticPath,
	);
	if (!isAllowedSourceModulePath(entry.packageRelativePath)) {
		throw failure(
			"program-surface-entry-invalid",
			"Program Surface entry must be a JavaScript or TypeScript source module.",
			entry.packageRelativePath,
		);
	}
	return {
		descriptor: parsed.descriptor,
		descriptorBytes: canonicalDescriptorBytes,
		entry,
	};
};

type ModuleToken =
	| { readonly kind: "word"; readonly value: string }
	| { readonly kind: "string"; readonly value: string }
	| { readonly kind: "punctuation"; readonly value: string };

const isWordStart = (value: string): boolean => /[A-Za-z_$]/u.test(value);
const isWordContinue = (value: string): boolean => /[A-Za-z0-9_$]/u.test(value);

const decodeEscape = (
	source: string,
	index: number,
	diagnosticPath: string,
): { readonly value: string; readonly nextIndex: number } => {
	const escaped = source[index];
	if (!escaped) {
		throw failure(
			"program-surface-source-syntax-unsupported",
			"Program Surface source has an unterminated string escape.",
			diagnosticPath,
		);
	}
	const simpleEscapes: Record<string, string> = {
		b: "\b",
		f: "\f",
		n: "\n",
		r: "\r",
		t: "\t",
		v: "\v",
		"0": "\0",
	};
	if (Object.hasOwn(simpleEscapes, escaped)) {
		return { value: simpleEscapes[escaped] ?? "", nextIndex: index + 1 };
	}
	if (escaped === "x") {
		const hex = source.slice(index + 1, index + 3);
		if (!/^[a-f0-9]{2}$/iu.test(hex)) {
			throw failure(
				"program-surface-source-syntax-unsupported",
				"Program Surface source has an invalid string escape.",
				diagnosticPath,
			);
		}
		return {
			value: String.fromCharCode(Number.parseInt(hex, 16)),
			nextIndex: index + 3,
		};
	}
	if (escaped === "u") {
		if (source[index + 1] === "{") {
			const end = source.indexOf("}", index + 2);
			const hex = end === -1 ? "" : source.slice(index + 2, end);
			const codePoint = /^[a-f0-9]{1,6}$/iu.test(hex)
				? Number.parseInt(hex, 16)
				: Number.NaN;
			if (!Number.isSafeInteger(codePoint) || codePoint > 0x10ffff) {
				throw failure(
					"program-surface-source-syntax-unsupported",
					"Program Surface source has an invalid string escape.",
					diagnosticPath,
				);
			}
			return {
				value: String.fromCodePoint(codePoint),
				nextIndex: end + 1,
			};
		}
		const hex = source.slice(index + 1, index + 5);
		if (!/^[a-f0-9]{4}$/iu.test(hex)) {
			throw failure(
				"program-surface-source-syntax-unsupported",
				"Program Surface source has an invalid string escape.",
				diagnosticPath,
			);
		}
		return {
			value: String.fromCharCode(Number.parseInt(hex, 16)),
			nextIndex: index + 5,
		};
	}
	return { value: escaped, nextIndex: index + 1 };
};

const readQuotedToken = (
	source: string,
	startIndex: number,
	diagnosticPath: string,
): { readonly token: ModuleToken; readonly nextIndex: number } => {
	const quote = source[startIndex];
	let index = startIndex + 1;
	let value = "";
	while (index < source.length) {
		const current = source[index];
		if (current === quote) {
			return { token: { kind: "string", value }, nextIndex: index + 1 };
		}
		if (current === "\\") {
			const decoded = decodeEscape(source, index + 1, diagnosticPath);
			value += decoded.value;
			index = decoded.nextIndex;
			continue;
		}
		if (current === "\n" || current === "\r") {
			break;
		}
		value += current;
		index += 1;
	}
	throw failure(
		"program-surface-source-syntax-unsupported",
		"Program Surface source has an unterminated string literal.",
		diagnosticPath,
	);
};

const skipTemplateLiteral = (
	source: string,
	startIndex: number,
	diagnosticPath: string,
): number => {
	let index = startIndex + 1;
	while (index < source.length) {
		const current = source[index];
		if (current === "\\") {
			index += 2;
			continue;
		}
		if (current === "`") return index + 1;
		if (current === "$" && source[index + 1] === "{") {
			throw failure(
				"program-surface-template-expression-unsupported",
				"Program Surface V1 source does not permit template-expression code.",
				diagnosticPath,
			);
		}
		index += 1;
	}
	throw failure(
		"program-surface-source-syntax-unsupported",
		"Program Surface source has an unterminated template literal.",
		diagnosticPath,
	);
};

/**
 * Conservative module lexer. V1 permits only static literal ESM imports and
 * rejects dynamic import / require before Bun gets a chance to resolve them.
 */
const tokenizeModule = (
	source: string,
	diagnosticPath: string,
): readonly ModuleToken[] => {
	const tokens: ModuleToken[] = [];
	let index = 0;
	while (index < source.length) {
		const current = source[index] ?? "";
		if (/\s/u.test(current)) {
			index += 1;
			continue;
		}
		if (current === "/" && source[index + 1] === "/") {
			index += 2;
			while (index < source.length && source[index] !== "\n") index += 1;
			continue;
		}
		if (current === "/" && source[index + 1] === "*") {
			const end = source.indexOf("*/", index + 2);
			if (end === -1) {
				throw failure(
					"program-surface-source-syntax-unsupported",
					"Program Surface source has an unterminated block comment.",
					diagnosticPath,
				);
			}
			index = end + 2;
			continue;
		}
		if (current === "'" || current === '"') {
			const parsed = readQuotedToken(source, index, diagnosticPath);
			tokens.push(parsed.token);
			index = parsed.nextIndex;
			continue;
		}
		if (current === "`") {
			index = skipTemplateLiteral(source, index, diagnosticPath);
			continue;
		}
		if (isWordStart(current)) {
			let end = index + 1;
			while (end < source.length && isWordContinue(source[end] ?? "")) end += 1;
			tokens.push({ kind: "word", value: source.slice(index, end) });
			index = end;
			continue;
		}
		tokens.push({ kind: "punctuation", value: current });
		index += 1;
	}
	return tokens;
};

const extractStaticImportSpecifiers = (
	source: string,
	diagnosticPath: string,
): readonly string[] => {
	const staticProfile = inspectProgramSurfaceStaticProfile(source);
	if (!staticProfile.ok) {
		throw failure(
			staticProfile.issue.code,
			staticProfile.issue.message,
			diagnosticPath,
		);
	}
	const tokens = tokenizeModule(source, diagnosticPath);
	const specifiers = new Set<string>();
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token?.kind !== "word") continue;
		if (token.value === "import") {
			const next = tokens[index + 1];
			if (next?.value === ".") continue;
			if (next?.value === "(") {
				throw failure(
					"program-surface-dynamic-import-unsupported",
					"Program Surface V1 source does not permit dynamic import().",
					diagnosticPath,
				);
			}
			if (next?.kind === "string") {
				specifiers.add(next.value);
				continue;
			}
			let found = false;
			for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
				const candidate = tokens[cursor];
				if (!candidate || candidate.value === ";") break;
				if (
					candidate.kind === "word" &&
					candidate.value === "from" &&
					tokens[cursor + 1]?.kind === "string"
				) {
					specifiers.add(tokens[cursor + 1]?.value ?? "");
					found = true;
					break;
				}
			}
			if (!found) {
				throw failure(
					"program-surface-static-import-invalid",
					"Program Surface V1 imports must use literal ESM module specifiers.",
					diagnosticPath,
				);
			}
		}
		if (token.value === "export") {
			for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
				const candidate = tokens[cursor];
				if (!candidate || candidate.value === ";") break;
				if (
					candidate.kind === "word" &&
					candidate.value === "from" &&
					tokens[cursor + 1]?.kind === "string"
				) {
					specifiers.add(tokens[cursor + 1]?.value ?? "");
					break;
				}
			}
		}
	}
	return [...specifiers];
};

const resolveStaticImport = async (
	specifier: string,
	importer: ResolvedSourceFile,
	packageRoot: string,
): Promise<ResolvedSourceFile> => {
	if (
		(!specifier.startsWith("./") && !specifier.startsWith("../")) ||
		specifier.includes("\\") ||
		specifier.includes("\u0000") ||
		specifier.includes("?") ||
		specifier.includes("#") ||
		specifier.includes(":") ||
		specifier.endsWith("/")
	) {
		throw failure(
			"program-surface-import-not-relative",
			"Program Surface V1 permits only explicit relative local ESM imports.",
			importer.packageRelativePath,
		);
	}
	const candidate = path.resolve(
		path.dirname(importer.absolutePath),
		specifier,
	);
	if (!isWithin(packageRoot, candidate)) {
		throw failure(
			"program-surface-import-path-escape",
			"Program Surface source import escaped its package root.",
			importer.packageRelativePath,
		);
	}
	const diagnosticPath = toPortableRelativePath(packageRoot, candidate);
	if (!isAllowedSourceModulePath(diagnosticPath)) {
		throw failure(
			"program-surface-import-extension-invalid",
			"Program Surface V1 imports must name an explicit JavaScript or TypeScript module file.",
			importer.packageRelativePath,
		);
	}
	return readCanonicalRegularFile(
		candidate,
		packageRoot,
		MAX_SOURCE_FILE_BYTES,
		diagnosticPath,
	);
};

const buildClosedSourceGraph = async (
	scanned: ScannedManifest,
): Promise<ClosedSourceGraph> => {
	const descriptorState = await readDescriptor(scanned);
	const files = new Map<string, ResolvedSourceFile>();
	const pending: ResolvedSourceFile[] = [descriptorState.entry];
	let totalBytes = 0;

	while (pending.length > 0) {
		const file = pending.pop();
		if (!file || files.has(file.absolutePath)) continue;
		if (files.size >= MAX_SOURCE_GRAPH_FILES) {
			throw failure(
				"program-surface-source-graph-too-large",
				"Program Surface source graph exceeds the V1 module limit.",
				file.packageRelativePath,
			);
		}
		totalBytes += file.bytes.byteLength;
		if (totalBytes > MAX_SOURCE_GRAPH_BYTES) {
			throw failure(
				"program-surface-source-graph-too-large",
				"Program Surface source graph exceeds the V1 byte limit.",
				file.packageRelativePath,
			);
		}
		files.set(file.absolutePath, file);
		const source = decodeSourceText(file.bytes, file.packageRelativePath);
		for (const specifier of extractStaticImportSpecifiers(
			source,
			file.packageRelativePath,
		)) {
			pending.push(
				await resolveStaticImport(specifier, file, scanned.packageRoot),
			);
		}
	}

	const graphFiles = sortedGraphFiles([...files.values()]);
	return {
		descriptor: descriptorState.descriptor,
		descriptorBytes: descriptorState.descriptorBytes,
		entry: descriptorState.entry,
		files: graphFiles,
		snapshotDigest: graphSnapshotDigest(descriptorState.entry, graphFiles),
		inputDigest: graphInputDigest(descriptorState.descriptorBytes, graphFiles),
	};
};

const scanWorkspace = async (
	workspaceRoot: string,
): Promise<ReadonlyMap<string, ScannedManifest>> => {
	const manifests = new Map<string, ScannedManifest>();
	let scannedDirectories = 0;

	const scanDirectory = async (directory: string): Promise<void> => {
		if (
			scannedDirectories >= MAX_SCANNED_DIRECTORIES ||
			manifests.size >= MAX_DISCOVERED_MANIFESTS
		) {
			return;
		}
		scannedDirectories += 1;
		let entries: Dirent[];
		try {
			entries = await readdir(directory, { withFileTypes: true });
		} catch {
			return;
		}
		entries.sort((left, right) => compareCanonicalText(left.name, right.name));
		for (const entry of entries) {
			if (manifests.size >= MAX_DISCOVERED_MANIFESTS) return;
			const absolutePath = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				if (!ignoredWorkspaceDirectories.has(entry.name)) {
					await scanDirectory(absolutePath);
				}
				continue;
			}
			if (
				!entry.isFile() ||
				entry.name !== PROGRAM_SURFACE_LOCAL_SOURCE_DESCRIPTOR_FILENAME
			) {
				continue;
			}
			try {
				const stats = await lstat(absolutePath);
				if (!stats.isFile() || stats.size > MAX_DESCRIPTOR_BYTES) continue;
				const descriptorPath = await realpath(absolutePath);
				const packageRoot = await realpath(directory);
				if (
					!isWithin(workspaceRoot, descriptorPath) ||
					!isWithin(workspaceRoot, packageRoot) ||
					path.dirname(descriptorPath) !== packageRoot
				) {
					continue;
				}
				const raw = new Uint8Array(await readFile(descriptorPath));
				if (raw.byteLength > MAX_DESCRIPTOR_BYTES) continue;
				const json = JSON.parse(
					decodeSourceText(
						raw,
						toPortableRelativePath(workspaceRoot, descriptorPath),
					),
				) as unknown;
				const parsed = parseProgramSurfaceLocalSourceDescriptor(json);
				if (!parsed.ok) continue;
				const id = randomUUID();
				manifests.set(id, {
					id,
					descriptorPath,
					packageRoot,
					workspaceRelativePath: toPortableRelativePath(
						workspaceRoot,
						descriptorPath,
					),
					name: parsed.descriptor.name,
				});
			} catch {
				// A malformed package is simply not eligible to bind in this session.
			}
		}
	};

	await scanDirectory(workspaceRoot);
	return manifests;
};

const compileCandidate = async (
	binding: Binding,
	generation: number,
	initialGraph?: ClosedSourceGraph,
): Promise<
	| { readonly kind: "raced" }
	| { readonly kind: "candidate"; readonly candidate: Candidate }
> => {
	const before =
		initialGraph ?? (await buildClosedSourceGraph(binding.scanned));
	let result: Awaited<ReturnType<typeof Bun.build>>;
	try {
		result = await Bun.build({
			entrypoints: [before.entry.absolutePath],
			bundle: true,
			target: "browser",
			format: "esm",
			sourcemap: "none",
			splitting: false,
			write: false,
		});
	} catch {
		throw failure(
			"program-surface-build-failed",
			"Program Surface browser ESM build failed.",
		);
	}
	if (!result.success || result.outputs.length !== 1) {
		throw failure(
			"program-surface-build-failed",
			"Program Surface browser ESM build failed.",
		);
	}
	const output = result.outputs[0];
	if (!output) {
		throw failure(
			"program-surface-build-output-invalid",
			"Program Surface build emitted no browser module.",
		);
	}
	let bytes: Uint8Array;
	try {
		bytes = new Uint8Array(await output.arrayBuffer());
	} catch {
		throw failure(
			"program-surface-build-output-invalid",
			"Program Surface build output could not be read.",
		);
	}
	if (bytes.byteLength === 0 || bytes.byteLength > MAX_BUNDLE_BYTES) {
		throw failure(
			"program-surface-build-output-invalid",
			"Program Surface build output exceeds the V1 bundle limit.",
		);
	}
	const emittedBundleGate = inspectProgramSurfaceBundleV1(
		decodeSourceText(bytes, PROGRAM_SURFACE_COMPILED_ENTRY),
	);
	if (emittedBundleGate.status === "rejected") {
		throw failure(
			emittedBundleGate.code,
			"Program Surface emitted bundle is outside the V1 parent-clocked execution profile.",
		);
	}

	const after = await buildClosedSourceGraph(binding.scanned);
	if (
		before.snapshotDigest !== after.snapshotDigest ||
		before.inputDigest !== after.inputDigest
	) {
		return { kind: "raced" };
	}
	const compiledDigest = sha256(bytes);
	const manifest = deriveProgramSurfaceReferenceManifest(before.descriptor, {
		compiledDigest,
		// Durable reference-only manifests identify the complete authoring input:
		// canonical descriptor declaration plus its closed source graph. This is
		// intentionally the exact identity.inputDigest, not merely module bytes.
		snapshotDigest: before.inputDigest,
	});
	const identity: ProgramSurfaceBuildIdentity = {
		manifestDigest: sha256(
			Buffer.from(serializeProgramSurfaceBridgeManifest(manifest), "utf8"),
		),
		inputDigest: before.inputDigest,
		compiledDigest,
		generation,
	};
	if (manifest.fallback?.assetId === binding.assetId) {
		throw failure(
			"program-surface-fallback-invalid",
			"Program Surface fallback may not reference the bound Program Surface itself.",
		);
	}
	return {
		kind: "candidate",
		candidate: {
			identity,
			authoringInputDigest: before.inputDigest,
			manifest,
			bytes,
			diagnostics: [],
			files: after.files,
		},
	};
};

const sameTarget = (
	left: ProgramSurfaceBridgeEditorTarget,
	right: ProgramSurfaceBridgeEditorTarget,
): boolean =>
	left.editorInstanceId === right.editorInstanceId &&
	left.workingCopyId === right.workingCopyId &&
	left.bindingEpoch === right.bindingEpoch;

const sameIdentity = (
	left: ProgramSurfaceBuildIdentity,
	right: ProgramSurfaceBuildIdentity,
): boolean =>
	left.manifestDigest === right.manifestDigest &&
	left.inputDigest === right.inputDigest &&
	left.compiledDigest === right.compiledDigest &&
	left.generation === right.generation;

const isExactLocalEditorOrigin = (value: string): string | null => {
	try {
		const parsed = new URL(value);
		const hostname = parsed.hostname.toLowerCase();
		if (
			parsed.protocol !== "http:" ||
			(parsed.pathname !== "/" && parsed.pathname !== "") ||
			parsed.search !== "" ||
			parsed.hash !== "" ||
			parsed.username !== "" ||
			parsed.password !== "" ||
			!(["localhost", "127.0.0.1", "::1", "[::1]"] as const).includes(
				hostname as "localhost" | "127.0.0.1" | "::1" | "[::1]",
			)
		) {
			return null;
		}
		return parsed.origin;
	} catch {
		return null;
	}
};

const canonicalWorkspace = async (workspace: string): Promise<string> => {
	let candidate: string;
	try {
		candidate = path.resolve(workspace);
		const stats = await lstat(candidate);
		if (!stats.isDirectory()) throw new Error("not-directory");
		return await realpath(candidate);
	} catch {
		throw new Error(
			"Program Surface bridge workspace must be an existing local directory.",
		);
	}
};

export type StartProgramSurfaceBridgeOptions = {
	readonly workspace: string;
	readonly editorOrigin: string;
	readonly port?: number;
	/** Defaults to a token-free record in the canonical workspace root. */
	readonly discoveryPath?: string;
	readonly writeDiscovery?: boolean;
};

export type ProgramSurfaceBridge = {
	readonly bridgeId: string;
	readonly port: number;
	readonly editorOrigin: string;
	/** Terminal-only pairing secret. It is never put into a discovery record. */
	readonly pairingToken: string;
	readonly stop: () => Promise<void>;
};

/** Starts one loopback-only, one-editor Program Surface companion instance. */
export const startProgramSurfaceBridge = async (
	options: StartProgramSurfaceBridgeOptions,
): Promise<ProgramSurfaceBridge> => {
	const workspace = await canonicalWorkspace(options.workspace);
	const editorOrigin = isExactLocalEditorOrigin(options.editorOrigin);
	if (!editorOrigin) {
		throw new Error(
			"Program Surface bridge editor origin must be one exact http://localhost or loopback origin.",
		);
	}
	if (
		options.port !== undefined &&
		(!Number.isSafeInteger(options.port) ||
			options.port < 0 ||
			options.port > 65535)
	) {
		throw new Error(
			"Program Surface bridge port must be a valid local TCP port.",
		);
	}

	const bridgeId = randomUUID();
	const pairingToken = randomBytes(32).toString("base64url");
	const writeDiscovery = options.writeDiscovery !== false;
	const requestedDiscoveryPath =
		options.discoveryPath ??
		process.env.VMA_PROGRAM_SURFACE_BRIDGE_DISCOVERY_PATH ??
		path.join(workspace, ".vma-program-surface-bridge");
	const discoveryPath = programSurfaceBridgeDiscoveryPath(
		requestedDiscoveryPath,
	);
	const startedAt = new Date().toISOString();
	let livePairingToken: string | null = pairingToken;
	let activeSocket: BridgeWs | null = null;
	let pendingUpgrade = false;
	let session: ActiveSession | null = null;
	let stopped = false;
	let failedPairings = 0;
	let pairingCooldownUntil = 0;
	let server: {
		readonly port?: number;
		stop: (closeActiveConnections?: boolean) => void;
	} | null = null;

	const send = (
		ws: BridgeWs,
		message: ProgramSurfaceBridgeServerMessage,
	): void => {
		try {
			ws.send(encodeProgramSurfaceBridgeMessage(message));
		} catch {
			// A peer closed between routing and send; close handling owns cleanup.
		}
	};

	const disposeBinding = (binding: Binding): void => {
		if (binding.watchTimer) clearTimeout(binding.watchTimer);
		binding.watchTimer = null;
		for (const watcher of binding.watchers) watcher.close();
		binding.watchers = [];
		binding.candidate = null;
	};

	const disposeSession = (): void => {
		if (!session) return;
		if (session.heartbeatTimer) clearTimeout(session.heartbeatTimer);
		if (session.binding) disposeBinding(session.binding);
		session = null;
	};

	const stop = async (): Promise<void> => {
		if (stopped) return;
		stopped = true;
		disposeSession();
		server?.stop(true);
		if (writeDiscovery) {
			await clearProgramSurfaceBridgeDiscovery(bridgeId, discoveryPath);
		}
	};

	const endSession = (ws: BridgeWs): void => {
		if (session?.ws !== ws) {
			ws.close();
			return;
		}
		void stop();
	};

	const fatal = (ws: BridgeWs, code: string, message: string): void => {
		logPrivateDiagnostic({ code, message });
		send(ws, {
			kind: "error",
			code: PROGRAM_SURFACE_BRIDGE_ERROR_CODE,
		});
		if (session?.ws === ws) {
			endSession(ws);
			return;
		}
		ws.close();
	};

	const resetHeartbeat = (active: ActiveSession): void => {
		if (active.heartbeatTimer) clearTimeout(active.heartbeatTimer);
		active.heartbeatTimer = setTimeout(() => {
			if (session?.id !== active.id) return;
			fatal(
				active.ws,
				"program-surface-heartbeat-expired",
				"Program Surface bridge session expired without a heartbeat.",
			);
		}, HEARTBEAT_TIMEOUT_MS);
	};

	const activeForBinding = (binding: Binding): ActiveSession | null =>
		session?.binding === binding ? session : null;

	const sendBuildStatus = (
		binding: Binding,
		status:
			| "bound-clean"
			| "building"
			| "candidate-awaiting-approval"
			| "active-last-known-good"
			| "build-failed-last-known-good",
	): void => {
		const active = activeForBinding(binding);
		if (!active) return;
		send(active.ws, {
			kind: "build-status",
			sessionId: active.id,
			bindingId: binding.id,
			target: active.target,
			assetId: binding.assetId,
			status,
		});
	};

	const sendBuildDiagnostics = (
		binding: Binding,
		generation: number,
		diagnostic: PrivateBridgeDiagnostic,
	): void => {
		const active = activeForBinding(binding);
		if (!active) return;
		send(active.ws, {
			kind: "build-diagnostics",
			sessionId: active.id,
			bindingId: binding.id,
			target: active.target,
			assetId: binding.assetId,
			generation,
			diagnostics: [publicDiagnosticFor(diagnostic)],
			hasLastKnownGood: binding.lastKnownGood !== null,
		});
	};

	const installWatchers = (
		binding: Binding,
		files: readonly ResolvedSourceFile[],
		onChange: () => void,
	): void => {
		for (const watcher of binding.watchers) watcher.close();
		binding.watchers = [];
		const locations = new Set<string>([
			binding.scanned.descriptorPath,
			...files.map((file) => file.absolutePath),
		]);
		for (const location of locations) {
			try {
				const watcher = watch(location, { persistent: false }, onChange);
				watcher.on("error", () => {
					sendBuildDiagnostics(binding, binding.generation, {
						code: "program-surface-watch-unavailable",
						message:
							"Program Surface source watch is unavailable; rebind after editing.",
					});
				});
				binding.watchers.push(watcher);
			} catch {
				sendBuildDiagnostics(binding, binding.generation, {
					code: "program-surface-watch-unavailable",
					message:
						"Program Surface source watch is unavailable; rebind after editing.",
				});
			}
		}
	};

	const scheduleRebuild = (binding: Binding): void => {
		if (!activeForBinding(binding)) return;
		binding.candidate = null;
		if (binding.watchTimer) clearTimeout(binding.watchTimer);
		binding.watchTimer = setTimeout(() => {
			binding.watchTimer = null;
			void requestBuild(binding);
		}, WATCH_DEBOUNCE_MS);
	};

	const requestBuild = async (binding: Binding): Promise<void> => {
		if (!activeForBinding(binding)) return;
		if (binding.buildRunning) {
			binding.rebuildQueued = true;
			return;
		}
		binding.buildRunning = true;
		binding.rebuildQueued = false;
		binding.generation += 1;
		const generation = binding.generation;
		sendBuildStatus(binding, "building");
		try {
			const graph = await buildClosedSourceGraph(binding.scanned);
			installWatchers(binding, graph.files, () => scheduleRebuild(binding));
			const compiled = await compileCandidate(binding, generation, graph);
			if (!activeForBinding(binding)) return;
			if (compiled.kind === "raced") {
				binding.candidate = null;
				binding.rebuildQueued = true;
				return;
			}

			const candidate = compiled.candidate;
			const isCurrentLastKnownGood =
				binding.lastKnownGood !== null &&
				binding.lastKnownGood.identity.manifestDigest ===
					candidate.identity.manifestDigest &&
				binding.lastKnownGood.identity.inputDigest ===
					candidate.identity.inputDigest &&
				binding.lastKnownGood.identity.compiledDigest ===
					candidate.identity.compiledDigest;
			installWatchers(binding, candidate.files, () => scheduleRebuild(binding));
			if (isCurrentLastKnownGood) {
				binding.candidate = null;
				sendBuildStatus(binding, "active-last-known-good");
				return;
			}
			binding.candidate = candidate;
			const active = activeForBinding(binding);
			if (!active) return;
			send(active.ws, {
				kind: "build-candidate",
				sessionId: active.id,
				bindingId: binding.id,
				target: active.target,
				assetId: binding.assetId,
				manifestId: binding.scanned.id,
				identity: candidate.identity,
				manifest: candidate.manifest,
				byteLength: candidate.bytes.byteLength,
				diagnostics: candidate.diagnostics,
			});
			sendBuildStatus(binding, "candidate-awaiting-approval");
		} catch (error) {
			if (!activeForBinding(binding)) return;
			binding.candidate = null;
			const diagnostic =
				error instanceof BridgeFailure
					? error.diagnostic
					: {
							code: "program-surface-build-failed",
							message: "Program Surface browser ESM build failed.",
						};
			logPrivateDiagnostic(diagnostic);
			sendBuildDiagnostics(binding, generation, diagnostic);
			sendBuildStatus(binding, "build-failed-last-known-good");
		} finally {
			binding.buildRunning = false;
			if (binding.rebuildQueued && activeForBinding(binding)) {
				binding.rebuildQueued = false;
				void requestBuild(binding);
			}
		}
	};

	const manifestListings = (
		manifests: ReadonlyMap<string, ScannedManifest>,
	): readonly ProgramSurfaceBridgeManifestListing[] =>
		[...manifests.values()]
			.sort((left, right) =>
				compareCanonicalText(
					left.workspaceRelativePath,
					right.workspaceRelativePath,
				),
			)
			.map((manifest) => ({ id: manifest.id, name: manifest.name }));

	const registerPairingFailure = (): void => {
		failedPairings += 1;
		if (failedPairings < PAIRING_FAILURE_LIMIT) return;
		failedPairings = 0;
		pairingCooldownUntil = Date.now() + PAIRING_COOLDOWN_MS;
	};

	const pairingTokenMatches = (candidate: string): boolean => {
		const expected = livePairingToken;
		if (!expected) return false;
		const expectedBytes = Buffer.from(expected, "utf8");
		const candidateBytes = Buffer.from(candidate, "utf8");
		return (
			expectedBytes.byteLength === candidateBytes.byteLength &&
			timingSafeEqual(expectedBytes, candidateBytes)
		);
	};

	const handleHello = async (
		ws: BridgeWs,
		message: Extract<
			ProgramSurfaceBridgeClientMessage,
			{ readonly kind: "hello" }
		>,
	): Promise<void> => {
		if (ws.data.helloPending || session || stopped) {
			fatal(
				ws,
				"program-surface-pairing-already-consumed",
				"Program Surface bridge pairing is no longer available.",
			);
			return;
		}
		if (Date.now() < pairingCooldownUntil) {
			registerPairingFailure();
			fatal(
				ws,
				"program-surface-pairing-rate-limited",
				"Program Surface bridge pairing is temporarily rate-limited.",
			);
			return;
		}
		if (
			message.protocol !== PROGRAM_SURFACE_BRIDGE_PROTOCOL_VERSION ||
			message.bridgeId !== bridgeId ||
			ws.data.origin !== editorOrigin ||
			!pairingTokenMatches(message.token)
		) {
			registerPairingFailure();
			fatal(
				ws,
				"program-surface-pairing-rejected",
				"Program Surface bridge pairing was rejected.",
			);
			return;
		}

		ws.data.helloPending = true;
		// A successful hello consumes the only pairing secret before touching disk.
		livePairingToken = null;
		ws.data.tokenConsumed = true;
		let manifests: ReadonlyMap<string, ScannedManifest>;
		try {
			manifests = await scanWorkspace(workspace);
		} catch {
			fatal(
				ws,
				"program-surface-scan-failed",
				"Program Surface workspace scan failed.",
			);
			return;
		}
		if (stopped || activeSocket !== ws) return;
		const active: ActiveSession = {
			id: randomUUID(),
			target: message.target,
			ws,
			manifests,
			binding: null,
			heartbeatTimer: null,
		};
		session = active;
		ws.data.helloPending = false;
		send(ws, {
			kind: "hello-ack",
			protocol: PROGRAM_SURFACE_BRIDGE_PROTOCOL_VERSION,
			accepted: true,
			sessionId: active.id,
			manifests: manifestListings(manifests),
		});
		resetHeartbeat(active);
	};

	const isMessageForActiveSession = (
		active: ActiveSession,
		message: Exclude<
			ProgramSurfaceBridgeClientMessage,
			{ readonly kind: "hello" }
		>,
	): boolean =>
		message.sessionId === active.id &&
		sameTarget(message.target, active.target);

	const handleBind = (
		active: ActiveSession,
		message: Extract<
			ProgramSurfaceBridgeClientMessage,
			{ readonly kind: "bind" }
		>,
	): void => {
		if (active.binding) {
			fatal(
				active.ws,
				"program-surface-second-binding-rejected",
				"Program Surface bridge permits one bound asset per paired session.",
			);
			return;
		}
		const scanned = active.manifests.get(message.manifestId);
		if (!scanned) {
			fatal(
				active.ws,
				"program-surface-manifest-not-eligible",
				"Program Surface source package is not eligible for this paired session.",
			);
			return;
		}
		const binding: Binding = {
			id: randomUUID(),
			scanned,
			assetId: message.assetId,
			generation: 0,
			candidate: null,
			lastKnownGood: null,
			watchers: [],
			watchTimer: null,
			buildRunning: false,
			rebuildQueued: false,
		};
		active.binding = binding;
		installWatchers(binding, [], () => scheduleRebuild(binding));
		send(active.ws, {
			kind: "bind-ack",
			sessionId: active.id,
			bindingId: binding.id,
			target: active.target,
			assetId: binding.assetId,
			manifestId: scanned.id,
		});
		sendBuildStatus(binding, "bound-clean");
		void requestBuild(binding);
	};

	const candidateStillMatchesWorkspace = async (
		binding: Binding,
		candidate: Candidate,
	): Promise<boolean> => {
		const graph = await buildClosedSourceGraph(binding.scanned);
		if (
			graph.inputDigest !== candidate.identity.inputDigest ||
			graph.inputDigest !== candidate.authoringInputDigest
		) {
			return false;
		}
		const manifest = deriveProgramSurfaceReferenceManifest(graph.descriptor, {
			compiledDigest: candidate.identity.compiledDigest,
			snapshotDigest: graph.inputDigest,
		});
		return (
			sha256(
				Buffer.from(serializeProgramSurfaceBridgeManifest(manifest), "utf8"),
			) === candidate.identity.manifestDigest
		);
	};

	const handleCandidateApproval = async (
		active: ActiveSession,
		message: Extract<
			ProgramSurfaceBridgeClientMessage,
			{ readonly kind: "approve-candidate" }
		>,
	): Promise<void> => {
		const binding = active.binding;
		if (
			!binding ||
			binding.id !== message.bindingId ||
			binding.assetId !== message.assetId ||
			!binding.candidate ||
			!sameIdentity(binding.candidate.identity, message.identity)
		) {
			fatal(
				active.ws,
				"program-surface-candidate-mismatch",
				"Program Surface candidate no longer matches this exact binding.",
			);
			return;
		}
		const candidate = binding.candidate;
		// Consume the approval slot before awaiting the graph rescan. A duplicate
		// approval is therefore a binding mismatch, never a second byte delivery.
		binding.candidate = null;
		try {
			if (!(await candidateStillMatchesWorkspace(binding, candidate))) {
				fatal(
					active.ws,
					"program-surface-candidate-stale",
					"Program Surface candidate became stale before approval.",
				);
				return;
			}
		} catch {
			fatal(
				active.ws,
				"program-surface-candidate-stale",
				"Program Surface candidate could not be revalidated before approval.",
			);
			return;
		}
		if (session?.id !== active.id || active.binding !== binding) return;
		if (binding.candidate !== null) {
			fatal(
				active.ws,
				"program-surface-candidate-stale",
				"Program Surface candidate changed while approval was being revalidated.",
			);
			return;
		}
		binding.lastKnownGood = {
			identity: candidate.identity,
			manifest: candidate.manifest,
			bytes: candidate.bytes,
		};
		send(active.ws, {
			kind: "approved-bundle",
			sessionId: active.id,
			bindingId: binding.id,
			target: active.target,
			assetId: binding.assetId,
			identity: candidate.identity,
			bundle: {
				encoding: "base64",
				mimeType: "text/javascript",
				data: Buffer.from(candidate.bytes).toString("base64"),
			},
		});
		sendBuildStatus(binding, "active-last-known-good");
	};

	const handleActiveMessage = (
		ws: BridgeWs,
		message: Exclude<
			ProgramSurfaceBridgeClientMessage,
			{ readonly kind: "hello" }
		>,
	): void => {
		const active = session;
		if (
			!active ||
			active.ws !== ws ||
			!isMessageForActiveSession(active, message)
		) {
			fatal(
				ws,
				"program-surface-session-mismatch",
				"Program Surface bridge session or editor target no longer matches.",
			);
			return;
		}
		resetHeartbeat(active);
		switch (message.kind) {
			case "bind":
				handleBind(active, message);
				return;
			case "approve-candidate":
				void handleCandidateApproval(active, message);
				return;
			case "heartbeat": {
				const expectedBindingId = active.binding?.id;
				if (message.bindingId !== expectedBindingId) {
					fatal(
						ws,
						"program-surface-binding-mismatch",
						"Program Surface bridge binding no longer matches.",
					);
					return;
				}
				send(ws, {
					kind: "heartbeat-ack",
					sessionId: active.id,
					...(expectedBindingId ? { bindingId: expectedBindingId } : {}),
				});
				return;
			}
			case "close": {
				const expectedBindingId = active.binding?.id;
				if (message.bindingId !== expectedBindingId) {
					fatal(
						ws,
						"program-surface-binding-mismatch",
						"Program Surface bridge binding no longer matches.",
					);
					return;
				}
				endSession(ws);
				return;
			}
		}
	};

	server = Bun.serve<ConnectionData, undefined>({
		port: options.port ?? 0,
		hostname: "127.0.0.1",
		fetch(request, bunServer) {
			if (stopped) {
				return new Response("Program Surface bridge stopped", { status: 503 });
			}
			if (request.method !== "GET") {
				return new Response("Program Surface bridge requires WebSocket GET", {
					status: 405,
				});
			}
			if (request.headers.get("origin") !== editorOrigin) {
				return new Response("Program Surface bridge origin rejected", {
					status: 403,
				});
			}
			if (activeSocket || pendingUpgrade || session) {
				return new Response(
					"Program Surface bridge already has an editor target",
					{
						status: 409,
					},
				);
			}
			pendingUpgrade = true;
			const upgraded = bunServer.upgrade(request, {
				data: {
					origin: request.headers.get("origin"),
					helloPending: false,
					tokenConsumed: false,
				},
			});
			if (upgraded) {
				return undefined;
			}
			pendingUpgrade = false;
			return new Response(
				"Program Surface bridge requires a WebSocket upgrade",
				{
					status: 426,
				},
			);
		},
		websocket: {
			open(ws) {
				pendingUpgrade = false;
				if (activeSocket) {
					ws.close();
					return;
				}
				activeSocket = ws;
			},
			message(ws, raw) {
				if (activeSocket !== ws || stopped) {
					ws.close();
					return;
				}
				if (typeof raw !== "string") {
					fatal(
						ws,
						"program-surface-binary-control-frame-rejected",
						"Program Surface bridge accepts JSON text control frames only.",
					);
					return;
				}
				const parsed = parseProgramSurfaceBridgeClientMessage(raw);
				if (!parsed.ok) {
					if (!session) registerPairingFailure();
					fatal(
						ws,
						"program-surface-control-frame-invalid",
						"Program Surface bridge control frame is invalid.",
					);
					return;
				}
				if (!session) {
					if (parsed.message.kind !== "hello" || ws.data.helloPending) {
						registerPairingFailure();
						fatal(
							ws,
							"program-surface-hello-required",
							"Program Surface bridge requires one hello pairing frame.",
						);
						return;
					}
					void handleHello(ws, parsed.message);
					return;
				}
				if (parsed.message.kind === "hello") {
					fatal(
						ws,
						"program-surface-second-hello-rejected",
						"Program Surface bridge accepts one editor pairing only.",
					);
					return;
				}
				handleActiveMessage(ws, parsed.message);
			},
			close(ws) {
				if (activeSocket === ws) activeSocket = null;
				pendingUpgrade = false;
				if (session?.ws === ws || ws.data.tokenConsumed) {
					void stop();
				}
			},
		},
	});

	const port = server.port ?? 0;
	if (!Number.isSafeInteger(port) || port <= 0) {
		server.stop(true);
		throw new Error("Program Surface bridge could not bind a loopback port.");
	}
	if (writeDiscovery) {
		try {
			await writeProgramSurfaceBridgeDiscovery(
				{
					protocol: PROGRAM_SURFACE_BRIDGE_PROTOCOL_VERSION,
					bridgeId,
					port,
					editorOrigin,
					startedAt,
					pid: process.pid,
				},
				discoveryPath,
			);
		} catch {
			await stop();
			throw new Error(
				"Program Surface bridge could not write its discovery record.",
			);
		}
	}

	return { bridgeId, port, editorOrigin, pairingToken, stop };
};

type CliArguments = {
	readonly workspace: string;
	readonly editorOrigin: string;
	readonly port?: number;
	readonly discoveryPath?: string;
};

const readCliValue = (
	argumentsList: readonly string[],
	index: number,
): string => {
	const value = argumentsList[index + 1];
	if (!value || value.startsWith("--")) {
		throw new Error("Program Surface bridge option requires a value.");
	}
	return value;
};

const parseCliArguments = (argumentsList: readonly string[]): CliArguments => {
	let workspace: string | null = null;
	let editorOrigin: string | null = null;
	let discoveryPath: string | undefined;
	let port: number | undefined;
	for (let index = 0; index < argumentsList.length; index += 1) {
		const argument = argumentsList[index];
		switch (argument) {
			case "--workspace": {
				if (workspace)
					throw new Error("Program Surface bridge accepts one workspace.");
				workspace = readCliValue(argumentsList, index);
				index += 1;
				break;
			}
			case "--editor-origin": {
				if (editorOrigin)
					throw new Error("Program Surface bridge accepts one editor origin.");
				editorOrigin = readCliValue(argumentsList, index);
				index += 1;
				break;
			}
			case "--port": {
				if (port !== undefined)
					throw new Error("Program Surface bridge accepts one port.");
				const rawPort = readCliValue(argumentsList, index);
				const parsedPort = Number(rawPort);
				if (
					!Number.isSafeInteger(parsedPort) ||
					parsedPort < 0 ||
					parsedPort > 65535
				) {
					throw new Error(
						"Program Surface bridge port must be an integer in 0..65535.",
					);
				}
				port = parsedPort;
				index += 1;
				break;
			}
			case "--discovery": {
				if (discoveryPath) {
					throw new Error("Program Surface bridge accepts one discovery path.");
				}
				discoveryPath = readCliValue(argumentsList, index);
				index += 1;
				break;
			}
			case "--help":
				throw new Error("Program Surface bridge help requested.");
			default:
				throw new Error(
					"Program Surface bridge received an unsupported option.",
				);
		}
	}
	if (!workspace || !editorOrigin) {
		throw new Error(
			"Program Surface bridge requires --workspace and --editor-origin.",
		);
	}
	return {
		workspace,
		editorOrigin,
		...(port === undefined ? {} : { port }),
		...(discoveryPath ? { discoveryPath } : {}),
	};
};

if (import.meta.main) {
	try {
		const argumentsList = process.argv.slice(2);
		if (argumentsList.includes("--help")) {
			process.stdout.write(
				"Usage: bun run program-surface:bridge -- --workspace <local-directory> --editor-origin <exact-local-vite-origin> [--port <0..65535>] [--discovery <token-free-record-path>]\n",
			);
		} else {
			const bridge = await startProgramSurfaceBridge(
				parseCliArguments(argumentsList),
			);
			process.stderr.write(
				`[program-surface-bridge] listening on ws://127.0.0.1:${bridge.port} for ${bridge.editorOrigin}\n`,
			);
			process.stderr.write(
				`[program-surface-bridge] bridge id: ${bridge.bridgeId}\n`,
			);
			process.stderr.write(
				`[program-surface-bridge] pairing token (terminal-only): ${bridge.pairingToken}\n`,
			);
			let shuttingDown = false;
			const shutdown = async (): Promise<void> => {
				if (shuttingDown) return;
				shuttingDown = true;
				await bridge.stop();
			};
			process.on("SIGINT", shutdown);
			process.on("SIGTERM", shutdown);
		}
	} catch (error) {
		const message =
			error instanceof Error &&
			error.message !== "Program Surface bridge help requested."
				? error.message
				: "Program Surface bridge could not start.";
		process.stderr.write(`[program-surface-bridge] ${message}\n`);
		process.exitCode = 1;
	}
}
