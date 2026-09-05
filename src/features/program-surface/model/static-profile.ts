/**
 * Conservative shared static capability gate for every V1 Program Surface
 * bundle. A program receives frame/time/seed through declared host ports; it
 * may not acquire ambient browser, worker, network, storage, environment, or
 * timer authority on its own.
 *
 * This intentionally rejects an identifier even when a source shadows it.
 * That is a safe false-positive tradeoff for a bounded executable asset.
 */

export type ProgramSurfaceStaticProfileIssueCode =
	| "program-surface-static-syntax-unsupported"
	| "program-surface-template-expression-unsupported"
	| "program-surface-dynamic-import-unsupported"
	| "program-surface-capability-unsupported"
	| "program-surface-nondeterministic-random-unsupported"
	| "program-surface-environment-unsupported"
	| "program-surface-bundle-import-unsupported"
	| "program-surface-entry-export-invalid"
	| "program-surface-default-export-unsupported";

export type ProgramSurfaceStaticProfileResult =
	| { readonly ok: true }
	| {
			readonly ok: false;
			readonly issue: {
				readonly code: ProgramSurfaceStaticProfileIssueCode;
				readonly message: string;
			};
	  };

type StaticToken = {
	readonly kind: "word" | "string" | "punctuation";
	readonly value: string;
};

type StaticTokenizationResult =
	| { readonly tokens: readonly StaticToken[] }
	| ProgramSurfaceStaticProfileResult;

const forbiddenParentClockedIdentifiers = new Set([
	"fetch",
	"XMLHttpRequest",
	"WebSocket",
	"WebTransport",
	"EventSource",
	"Worker",
	"SharedWorker",
	"ServiceWorker",
	"OffscreenCanvas",
	"importScripts",
	"BroadcastChannel",
	"MessageChannel",
	"MessagePort",
	"postMessage",
	"setTimeout",
	"setInterval",
	"setImmediate",
	"clearTimeout",
	"clearInterval",
	"clearImmediate",
	"queueMicrotask",
	"Promise",
	"async",
	"await",
	"requestAnimationFrame",
	"cancelAnimationFrame",
	"requestIdleCallback",
	"cancelIdleCallback",
	"requestVideoFrameCallback",
	"cancelVideoFrameCallback",
	"addEventListener",
	"removeEventListener",
	"ResizeObserver",
	"MutationObserver",
	"IntersectionObserver",
	"scheduler",
	"navigator",
	"document",
	"window",
	"location",
	"history",
	"localStorage",
	"sessionStorage",
	"indexedDB",
	"caches",
	"cookieStore",
	"credentials",
	"Credential",
	"PasswordCredential",
	"FederatedCredential",
	"PublicKeyCredential",
	"Notification",
	"RTCPeerConnection",
	"WebAssembly",
	"Atomics",
	"SharedArrayBuffer",
	"URL",
	"URLSearchParams",
	"Image",
	"Audio",
	"AudioContext",
	"FileReader",
	"sendBeacon",
	"process",
	"Bun",
	"Deno",
	"module",
	"exports",
	"Buffer",
	"__dirname",
	"__filename",
	"env",
	"global",
	"globalThis",
	"self",
	"parent",
	"top",
	"opener",
	"frames",
	"require",
	"eval",
	"Function",
	"constructor",
	"Date",
	"performance",
	"crypto",
	"console",
]);

const issue = (
	code: ProgramSurfaceStaticProfileIssueCode,
	message: string,
): ProgramSurfaceStaticProfileResult => ({
	ok: false,
	issue: { code, message },
});

const isWordStart = (value: string): boolean => /[A-Za-z_$]/u.test(value);
const isWordContinue = (value: string): boolean => /[A-Za-z0-9_$]/u.test(value);

const skipQuotedLiteral = (
	source: string,
	startIndex: number,
): number | null => {
	const quote = source[startIndex];
	let index = startIndex + 1;
	while (index < source.length) {
		const current = source[index];
		if (current === quote) return index + 1;
		if (current === "\\") {
			index += 2;
			continue;
		}
		if (current === "\n" || current === "\r") return null;
		index += 1;
	}
	return null;
};

const tokenizeStaticProfile = (source: string): StaticTokenizationResult => {
	const tokens: StaticToken[] = [];
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
				return issue(
					"program-surface-static-syntax-unsupported",
					"Program Surface V1 source has an unterminated block comment.",
				);
			}
			index = end + 2;
			continue;
		}
		if (current === "'" || current === '"') {
			const nextIndex = skipQuotedLiteral(source, index);
			if (nextIndex === null) {
				return issue(
					"program-surface-static-syntax-unsupported",
					"Program Surface V1 source has an unterminated string literal.",
				);
			}
			tokens.push({ kind: "string", value: "" });
			index = nextIndex;
			continue;
		}
		if (current === "`") {
			let cursor = index + 1;
			let closed = false;
			while (cursor < source.length) {
				const value = source[cursor];
				if (value === "\\") {
					cursor += 2;
					continue;
				}
				if (value === "$" && source[cursor + 1] === "{") {
					return issue(
						"program-surface-template-expression-unsupported",
						"Program Surface V1 source does not permit template-expression code.",
					);
				}
				if (value === "`") {
					closed = true;
					cursor += 1;
					break;
				}
				cursor += 1;
			}
			if (!closed) {
				return issue(
					"program-surface-static-syntax-unsupported",
					"Program Surface V1 source has an unterminated template literal.",
				);
			}
			index = cursor;
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
	return { tokens };
};

/**
 * Reports whether module text stays inside the V1 static parent-clocked
 * capability profile. It is deliberately source-text only and has no runtime
 * or filesystem dependency, so portable-package verification can call it too.
 */
export const inspectProgramSurfaceStaticProfile = (
	source: string,
): ProgramSurfaceStaticProfileResult => {
	const tokenized = tokenizeStaticProfile(source);
	if ("ok" in tokenized) return tokenized;
	const tokens = tokenized.tokens;
	for (const [index, token] of tokens.entries()) {
		if (
			token.kind === "word" &&
			forbiddenParentClockedIdentifiers.has(token.value)
		) {
			return issue(
				"program-surface-capability-unsupported",
				"Program Surface V1 source exceeds the static parent-clocked capability profile.",
			);
		}
		const next = tokens[index + 1];
		const afterNext = tokens[index + 2];
		const afterAfterNext = tokens[index + 3];
		const final = tokens[index + 4];
		if (token.value === "import" && next?.value === "(") {
			return issue(
				"program-surface-dynamic-import-unsupported",
				"Program Surface V1 source does not permit dynamic import().",
			);
		}
		if (
			token.value === "Math" &&
			next?.value === "." &&
			afterNext?.value === "random"
		) {
			return issue(
				"program-surface-nondeterministic-random-unsupported",
				"Program Surface V1 source must receive deterministic seed values from a declared port.",
			);
		}
		if (
			token.value === "import" &&
			next?.value === "." &&
			afterNext?.value === "meta" &&
			afterAfterNext?.value === "." &&
			(final?.value === "env" || final?.value === "resolve")
		) {
			return issue(
				"program-surface-environment-unsupported",
				"Program Surface V1 source cannot read environment or module-resolution state.",
			);
		}
	}
	return { ok: true };
};

const hasNamedCreateProgramSurfaceExport = (
	tokens: readonly StaticToken[],
): boolean => {
	for (let index = 0; index < tokens.length; index += 1) {
		if (tokens[index]?.value !== "export") continue;
		const next = tokens[index + 1];
		if (
			next?.value === "function" ||
			next?.value === "const" ||
			next?.value === "let" ||
			next?.value === "var"
		) {
			if (tokens[index + 2]?.value === "createProgramSurface") return true;
			continue;
		}
		if (next?.value === "async" && tokens[index + 2]?.value === "function") {
			if (tokens[index + 3]?.value === "createProgramSurface") return true;
			continue;
		}
		if (next?.value !== "{") continue;
		for (let cursor = index + 2; cursor < tokens.length; cursor += 1) {
			const candidate = tokens[cursor];
			if (!candidate || candidate.value === "}") break;
			if (candidate.value !== "createProgramSurface") continue;
			if (tokens[cursor - 1]?.value === "as") return true;
			if (tokens[cursor + 1]?.value !== "as") return true;
			if (tokens[cursor + 2]?.value === "createProgramSurface") return true;
		}
	}
	return false;
};

const hasDefaultExport = (tokens: readonly StaticToken[]): boolean => {
	for (let index = 0; index < tokens.length; index += 1) {
		if (tokens[index]?.value !== "export") continue;
		const next = tokens[index + 1];
		if (next?.value === "default") return true;
		if (next?.value !== "{") continue;
		for (let cursor = index + 2; cursor < tokens.length; cursor += 1) {
			const token = tokens[cursor];
			if (!token || token.value === "}") break;
			if (token.value === "default") return true;
		}
	}
	return false;
};

/**
 * Applies the same parent-clocked capability policy to a compiled one-file
 * bundle, then requires its explicit host factory and no remaining ESM import.
 * Manual portable intake and the local companion use this exact gate.
 */
export const inspectProgramSurfaceBundleStaticProfile = (
	source: string,
): ProgramSurfaceStaticProfileResult => {
	const base = inspectProgramSurfaceStaticProfile(source);
	if (!base.ok) return base;
	const tokenized = tokenizeStaticProfile(source);
	if ("ok" in tokenized) return tokenized;
	const tokens = tokenized.tokens;
	for (let index = 0; index < tokens.length; index += 1) {
		if (tokens[index]?.value !== "import") continue;
		return issue(
			"program-surface-bundle-import-unsupported",
			"Program Surface compiled bundles must not retain ESM imports or import metadata.",
		);
	}
	for (let index = 0; index < tokens.length; index += 1) {
		if (tokens[index]?.value !== "export") continue;
		for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
			const token = tokens[cursor];
			if (!token || token.value === ";") break;
			if (token.value !== "from" || tokens[cursor + 1]?.kind !== "string") {
				continue;
			}
			return issue(
				"program-surface-bundle-import-unsupported",
				"Program Surface compiled bundles must not retain ESM module references.",
			);
		}
	}
	if (hasDefaultExport(tokens)) {
		return issue(
			"program-surface-default-export-unsupported",
			"Program Surface compiled bundles must not expose a default export.",
		);
	}
	if (!hasNamedCreateProgramSurfaceExport(tokens)) {
		return issue(
			"program-surface-entry-export-invalid",
			"Program Surface compiled bundles must named-export createProgramSurface.",
		);
	}
	return { ok: true };
};
