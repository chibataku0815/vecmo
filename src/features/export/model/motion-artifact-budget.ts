/**
 * F4 budget report for the motion-artifact export profile's generated
 * `*.runtime.js` artifact — a companion to {@link createMotionCodeRuntimeAsset}
 * (`code.ts`) rather than a field folded into its (synchronous) return value:
 * gzip measurement is inherently async (`CompressionStream` is a streaming
 * API), and `createMotionCodeRuntimeAsset`/`createMotionCodeExportAssets` have
 * existing synchronous callers (`widgets/top-bar/ui/TopBar.tsx`) this task
 * does not touch. A caller that generated a motion-artifact asset calls
 * {@link createMotionArtifactBudgetReport} with its `contents` to get the
 * report; there is no new UI wiring this file's own doc comment can promise
 * for you — see `docs/product-knowledge/motion-code-runtime-export.md`.
 *
 * Follows the existing report precedent, `createExportOptimizationReport`
 * (`optimization.ts`): a plain data-in/data-out summary, no side effects.
 */

/** Loose (comfortable) gzip budget for a motion-artifact runtime: 80KiB. */
export const MOTION_ARTIFACT_TARGET_GZIP_BYTES = 81920;
/** Stretch (aspirational) gzip budget for a motion-artifact runtime: 50KiB. */
export const MOTION_ARTIFACT_STRETCH_GZIP_BYTES = 51200;

/**
 * Structural capabilities that always indicate live network/dynamic-import
 * reach — unlike a bare URL literal (see {@link ALLOWLISTED_NAMESPACE_URIS}),
 * there is no static-identifier reading of `fetch(`/`new URL(`/`import(`, so
 * these are never allowlisted.
 */
const EXTERNAL_FETCH_PATTERNS: readonly {
	readonly label: string;
	readonly pattern: RegExp;
}[] = [
	{ label: "fetch(", pattern: /\bfetch\(/ },
	{ label: "new URL(", pattern: /\bnew URL\(/ },
	{ label: "import(", pattern: /\bimport\(/ },
];

/**
 * Exact W3C XML namespace URI literals. The player's own SVG markup builder
 * and CORE/FULL's `effect-filter.ts`/`effect-field-filter.ts` SVG-filter
 * builders embed these as static `xmlns`/`xmlns:xlink` identifiers — never
 * dereferenced over the network by any SVG/XML implementation, but textually
 * indistinguishable from a live URL to a substring scan. A match is exempt
 * ONLY when the ENTIRE matched URL literal (see {@link URL_LITERAL_PATTERN})
 * equals one of these constants exactly, so e.g.
 * `http://www.w3.org/2000/svg/evil` still flags. Only the SVG entry has been
 * observed in a generated bundle to date (grepped across every
 * `runtime-sampler-*.generated.ts` and `code.ts`'s player source — see
 * `docs/product-knowledge/motion-code-runtime-export.md`); the other two ride
 * along as the same W3C-reserved namespace family, one appearance-effect/
 * mesh-paint change away from becoming reachable.
 */
const ALLOWLISTED_NAMESPACE_URIS: ReadonlySet<string> = new Set([
	"http://www.w3.org/2000/svg",
	"http://www.w3.org/1999/xlink",
	"http://www.w3.org/1999/xhtml",
]);

/**
 * Captures a full `http(s)://` URL literal, stopping at the first
 * whitespace, quote (single or double), backtick, or backslash — the
 * delimiters that terminate a URL literal embedded in a JS/TS string,
 * including the escaped-quote form (`\"`) a minified bundle emits for a
 * double-quoted attribute value.
 */
const URL_LITERAL_PATTERN = /https?:\/\/[^\s"'`\\]+/g;

/**
 * Partitions every distinct `http(s)://` URL literal in `body` into ones that
 * exactly match {@link ALLOWLISTED_NAMESPACE_URIS} and ones that don't. Only
 * the latter counts toward `externalFetch`.
 */
const scanUrlLiterals = (
	body: string,
): {
	readonly flagged: readonly string[];
	readonly allowlisted: readonly string[];
} => {
	const distinctUrls = new Set(body.match(URL_LITERAL_PATTERN) ?? []);
	const flagged: string[] = [];
	const allowlisted: string[] = [];
	for (const url of distinctUrls) {
		(ALLOWLISTED_NAMESPACE_URIS.has(url) ? allowlisted : flagged).push(url);
	}
	return { flagged: flagged.sort(), allowlisted: allowlisted.sort() };
};

export type MotionArtifactBudget = {
	readonly targetGzip: number;
	readonly stretchGzip: number;
	/** `null` when `gzipBytes` could not be measured — undecided, not failing. */
	readonly withinTarget: boolean | null;
	readonly withinStretch: boolean | null;
};

export type MotionArtifactBudgetReport = {
	readonly rawBytes: number;
	/** `null` when `CompressionStream` is unavailable — never a fake estimate. */
	readonly gzipBytes: number | null;
	readonly externalFetch: boolean;
	/** Which patterns/URL literals actually count toward `externalFetch`. */
	readonly externalFetchPatterns: readonly string[];
	/**
	 * URL literals that matched the `http(s)://` scan but were exempted by
	 * {@link ALLOWLISTED_NAMESPACE_URIS} — kept separate (not folded into
	 * `externalFetchPatterns`, and never counted toward `externalFetch`) so
	 * the report stays fully honest about what actually matched, even when
	 * exempted.
	 */
	readonly allowlistedMatches: readonly string[];
	readonly budget: MotionArtifactBudget;
};

/**
 * Drops the artifact's own leading `// ...` header comment lines
 * (`runtimeSourceHeader`/`header` in `code.ts`) before the external-fetch
 * scan, so a comment mentioning "https://" in prose can never itself trip the
 * scan.
 */
const withoutLeadingHeaderComment = (artifactText: string): string => {
	const lines = artifactText.split("\n");
	let index = 0;
	while (index < lines.length && lines[index].trimStart().startsWith("//")) {
		index += 1;
	}
	return lines.slice(index).join("\n");
};

/**
 * Scans for patterns that would make this artifact reach outside its own
 * bundle at runtime (a live `fetch`/dynamic `import`/hardcoded URL) — the
 * motion-artifact profile promises a self-contained handoff, so any match here
 * is a fidelity fact for the caller to surface, not a silent pass. A bare
 * `http(s)://` URL literal is exempted from `externalFetch` ONLY when it
 * exactly equals a {@link ALLOWLISTED_NAMESPACE_URIS} entry (returned
 * separately as `allowlistedMatches`, never silently dropped); `fetch(`,
 * `new URL(`, and `import(` are never exempted.
 */
export function scanMotionArtifactExternalFetch(artifactText: string): {
	readonly externalFetch: boolean;
	readonly patterns: readonly string[];
	readonly allowlistedMatches: readonly string[];
} {
	const body = withoutLeadingHeaderComment(artifactText);
	const structuralMatches = EXTERNAL_FETCH_PATTERNS.filter(({ pattern }) =>
		pattern.test(body),
	).map(({ label }) => label);
	const { flagged, allowlisted } = scanUrlLiterals(body);
	const patterns = [...structuralMatches, ...flagged];
	return {
		externalFetch: patterns.length > 0,
		patterns,
		allowlistedMatches: allowlisted,
	};
}

/**
 * Gzips `text` via `CompressionStream("gzip")` when available (browser and
 * modern Node/Bun runtimes both implement it). Returns `null` — never a fake
 * estimate — when the API is unavailable; a Bun script measuring the same
 * artifact offline should use `Bun.gzipSync` directly instead of this helper.
 */
export async function gzipByteLengthIfAvailable(
	text: string,
): Promise<number | null> {
	if (typeof CompressionStream === "undefined") return null;
	// Write and read must run concurrently, not write-then-read: a
	// poorly-compressible, multi-hundred-KB payload (e.g. embedded
	// base64 raster data) fills the transform's internal buffer well
	// past its high-water mark, and awaiting `writer.write`/`writer.close`
	// before any `reader.read()` call deadlocks on that backpressure.
	// `Blob#stream()` piped through the compressor sidesteps manual
	// writer/reader coordination (and its backpressure footgun) entirely.
	const encoder = new TextEncoder();
	const compressed = new Blob([encoder.encode(text)])
		.stream()
		.pipeThrough(new CompressionStream("gzip"));
	const reader = compressed.getReader();
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value) total += value.byteLength;
	}
	return total;
}

/**
 * Builds the F4 budget report for a motion-artifact `*.runtime.js` artifact's
 * full contents (the same string `createMotionCodeRuntimeAsset` returns as
 * `.contents` for the `"motion-artifact"` profile).
 */
export async function createMotionArtifactBudgetReport(
	artifactText: string,
): Promise<MotionArtifactBudgetReport> {
	const rawBytes = new TextEncoder().encode(artifactText).byteLength;
	const gzipBytes = await gzipByteLengthIfAvailable(artifactText);
	const { externalFetch, patterns, allowlistedMatches } =
		scanMotionArtifactExternalFetch(artifactText);
	return {
		rawBytes,
		gzipBytes,
		externalFetch,
		externalFetchPatterns: patterns,
		allowlistedMatches,
		budget: {
			targetGzip: MOTION_ARTIFACT_TARGET_GZIP_BYTES,
			stretchGzip: MOTION_ARTIFACT_STRETCH_GZIP_BYTES,
			withinTarget:
				gzipBytes === null
					? null
					: gzipBytes <= MOTION_ARTIFACT_TARGET_GZIP_BYTES,
			withinStretch:
				gzipBytes === null
					? null
					: gzipBytes <= MOTION_ARTIFACT_STRETCH_GZIP_BYTES,
		},
	};
}
