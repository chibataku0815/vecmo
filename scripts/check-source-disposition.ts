import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import * as ts from "@typescript/typescript6";

const repoRoot = process.cwd();
// A gate input, not a progress record: lives beside the checker in scripts/ so
// it survives the public open-source tree, which ships without docs/progress/.
const manifestPath = "scripts/source-disposition-manifest.json";
const sourcePattern = /\.tsx?$/;

type RuntimeRoot = {
	readonly path: string;
	readonly owner: string;
	readonly entry: string;
	readonly freshness: string;
};

type DispositionRule = {
	readonly pattern: string;
	readonly disposition: "deferred" | "evidence" | "compatibility";
	readonly owner: string;
	readonly entry: string;
	readonly capability?: string;
	readonly evidencePath?: string;
	readonly includeDependencies?: boolean;
	// When set, a rule matching no source file is skipped with a notice rather
	// than failing — for rules covering files absent from a reduced tree (e.g.
	// the public open-source export), still valid when the file is present.
	readonly optional?: boolean;
};

type Manifest = {
	readonly version: number;
	readonly runtimeRoots: readonly RuntimeRoot[];
	readonly rules: readonly DispositionRule[];
};

const walk = (directory: string): string[] =>
	readdirSync(directory).flatMap((entry) => {
		const absolute = path.join(directory, entry);
		const stats = statSync(absolute);
		if (stats.isDirectory()) return walk(absolute);
		return stats.isFile() ? [toRepoPath(absolute)] : [];
	});

const toRepoPath = (file: string): string =>
	path.relative(repoRoot, file).split(path.sep).join("/");

const sourceFiles = walk(path.join(repoRoot, "src")).filter((file) =>
	sourcePattern.test(file),
);
// The public open-source tree ships without worker/ (it stays in the private
// deployment repo): tolerate its absence the same way as scanning it.
const workerRoot = path.join(repoRoot, "worker");
const workerFiles = existsSync(workerRoot)
	? walk(workerRoot).filter((file) => sourcePattern.test(file))
	: [];
const scriptFiles = walk(path.join(repoRoot, "scripts")).filter((file) =>
	sourcePattern.test(file),
);
const allModules = [...sourceFiles, ...workerFiles, ...scriptFiles];
const moduleSet = new Set(allModules);

const resolveCandidate = (base: string): string | null =>
	[
		base,
		`${base}.ts`,
		`${base}.tsx`,
		`${base}/index.ts`,
		`${base}/index.tsx`,
	].find((candidate) => moduleSet.has(candidate)) ?? null;

const resolveImport = (from: string, specifier: string): string | null => {
	if (specifier.startsWith("@/")) {
		return resolveCandidate(`src/${specifier.slice(2)}`);
	}
	if (!specifier.startsWith(".")) return null;
	return resolveCandidate(
		path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier)),
	);
};

const importsFor = (file: string): readonly string[] => {
	const source = readFileSync(file, "utf8");
	const sourceFile = ts.createSourceFile(
		file,
		source,
		ts.ScriptTarget.Latest,
		true,
		file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
	);
	const imports = new Set<string>();
	const add = (specifier: string): void => {
		const target = resolveImport(file, specifier);
		if (target) imports.add(target);
	};
	const visit = (node: ts.Node): void => {
		if (
			(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
			node.moduleSpecifier &&
			ts.isStringLiteralLike(node.moduleSpecifier)
		) {
			add(node.moduleSpecifier.text);
		}
		if (
			ts.isCallExpression(node) &&
			node.expression.kind === ts.SyntaxKind.ImportKeyword &&
			node.arguments[0] &&
			ts.isStringLiteralLike(node.arguments[0])
		) {
			add(node.arguments[0].text);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return [...imports];
};

const graph = new Map(allModules.map((file) => [file, importsFor(file)]));
const closure = (roots: readonly string[]): Set<string> => {
	const reached = new Set<string>();
	const pending = [...roots];
	while (pending.length > 0) {
		const file = pending.pop();
		if (!file || reached.has(file) || !moduleSet.has(file)) continue;
		reached.add(file);
		for (const dependency of graph.get(file) ?? []) pending.push(dependency);
	}
	return reached;
};

const parseManifest = (): Manifest => {
	const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
	if (!parsed || typeof parsed !== "object") {
		throw new Error(`${manifestPath} must contain an object.`);
	}
	const candidate = parsed as Partial<Manifest>;
	if (
		candidate.version !== 1 ||
		!Array.isArray(candidate.runtimeRoots) ||
		!Array.isArray(candidate.rules)
	) {
		throw new Error(
			`${manifestPath} must use version 1 with runtimeRoots/rules arrays.`,
		);
	}
	return candidate as Manifest;
};

const manifest = parseManifest();
const errors: string[] = [];
// The public open-source tree ships without docs/progress/ (internal records
// stay in the private deployment repo): skip deferred-rule capability
// validation with a notice rather than failing when the inventory is absent.
const capabilityInventoryPath =
	"docs/progress/codemap-capability-inventory-146a2fa9.md";
const capabilitiesAvailable = existsSync(capabilityInventoryPath);
if (!capabilitiesAvailable) {
	console.log(
		`Notice: ${capabilityInventoryPath} not found; skipping deferred-rule capability validation.`,
	);
}
const capabilities = capabilitiesAvailable
	? readFileSync(capabilityInventoryPath, "utf8")
	: "";

for (const root of manifest.runtimeRoots) {
	if (!moduleSet.has(root.path))
		errors.push(`missing runtime root ${root.path}`);
	if (!root.owner || !root.entry || !root.freshness) {
		errors.push(
			`${root.path}: runtime root requires owner, entry, and freshness.`,
		);
	}
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
	readonly scripts?: Readonly<Record<string, string>>;
};
const packageScriptRoots = new Set<string>();
for (const command of Object.values(packageJson.scripts ?? {})) {
	for (const match of command.matchAll(
		/(?:bun|node|tsx)\s+(scripts\/[\w./-]+\.ts)/g,
	)) {
		if (moduleSet.has(match[1])) packageScriptRoots.add(match[1]);
	}
}

const runtime = closure([
	"src/main.tsx",
	"worker/index.ts",
	...sourceFiles.filter((file) =>
		/\/canvas\/(?:handler|overlay)\.tsx?$/.test(file),
	),
	...manifest.runtimeRoots.map((root) => root.path),
]);
const scriptOwned = closure([...packageScriptRoots]);

const wildcardPattern = (pattern: string): RegExp => {
	const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`^${escaped.replaceAll("*", "[^/]*")}$`);
};

const dispositionByFile = new Map<string, DispositionRule>();
for (const rule of manifest.rules) {
	const matches = sourceFiles.filter((file) =>
		wildcardPattern(rule.pattern).test(file),
	);
	if (matches.length === 0) {
		if (rule.optional) {
			console.log(
				`Notice: ${rule.pattern} matches no source file; skipping optional disposition rule.`,
			);
			continue;
		}
		errors.push(`${rule.pattern}: disposition rule matches no source file.`);
		continue;
	}
	if (!rule.owner || !rule.entry) {
		errors.push(`${rule.pattern}: disposition rule requires owner and entry.`);
	}
	if (rule.disposition === "deferred" && capabilitiesAvailable) {
		if (!rule.capability || !capabilities.includes(rule.capability)) {
			errors.push(
				`${rule.pattern}: deferred rule requires a live Not Yet capability id.`,
			);
		}
	}
	if (rule.disposition === "evidence") {
		if (!rule.evidencePath) {
			errors.push(
				`${rule.pattern}: evidence rule requires an existing evidencePath.`,
			);
		} else if (!existsSync(rule.evidencePath)) {
			if (rule.optional) {
				console.log(
					`Notice: ${rule.evidencePath} not found; skipping optional evidence rule for ${rule.pattern}.`,
				);
			} else {
				errors.push(
					`${rule.pattern}: evidence rule requires an existing evidencePath.`,
				);
			}
		}
	}
	const classified = rule.includeDependencies
		? closure(matches)
		: new Set(matches);
	let classifiedCount = 0;
	for (const file of classified) {
		if (
			!file.startsWith("src/") ||
			runtime.has(file) ||
			scriptOwned.has(file)
		) {
			continue;
		}
		const previous = dispositionByFile.get(file);
		if (previous && previous !== rule) {
			errors.push(`${file}: matches multiple disposition rules.`);
		} else {
			dispositionByFile.set(file, rule);
			classifiedCount += 1;
		}
	}
	if (classifiedCount === 0) {
		errors.push(
			`${rule.pattern}: disposition is stale because every match is now automatically reachable.`,
		);
	}
}

for (const file of scriptFiles) {
	if (path.basename(file).startsWith("_scratch_")) {
		errors.push(
			`${file}: tracked scratch executable is forbidden; promote it to a named, fenced package entry or retain non-executable evidence.`,
		);
	}
}

const unclassified = sourceFiles.filter(
	(file) =>
		!runtime.has(file) &&
		!scriptOwned.has(file) &&
		!dispositionByFile.has(file),
);
for (const file of unclassified) {
	errors.push(`${file}: no runtime, package-script, or manifest disposition.`);
}

if (errors.length > 0) {
	console.error("Source-disposition check failed.");
	for (const error of errors) console.error(`- ${error}`);
	process.exit(1);
}

console.log(
	`Source-disposition check passed (${sourceFiles.length} files; ${runtime.size} runtime/generated, ${scriptOwned.size} script-owned, ${dispositionByFile.size} explicit).`,
);
