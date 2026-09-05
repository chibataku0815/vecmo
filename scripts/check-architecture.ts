import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import * as ts from "@typescript/typescript6";
import { GLOBAL_TOOL_SHORTCUTS } from "@/features/tool-selection/model/tool-shortcuts";
import { shortcutSignature } from "@/shared/actions";
import {
	ACTIVATABLE_TOOL_IDS,
	toolReachability,
} from "@/widgets/tool-rail/model/tool-reachability";

const repoRoot = process.cwd();
const srcRoot = path.join(repoRoot, "src");
const workerRoot = path.join(repoRoot, "worker");
const allowedTopLevelFiles = new Set(["src/main.tsx"]);
const sourceExtensions = new Set([".ts", ".tsx"]);
const layerRank = {
	shared: 0,
	entities: 1,
	features: 2,
	widgets: 3,
	pages: 4,
	app: 5,
} as const;
// The Worker never renders UI and must stay independent of the client app
// shell: it may read domain models (`entities`) and pure helpers (`shared`),
// same as any other consumer, but must not reach into client-only layers.
const workerForbiddenLayers = new Set(["app", "pages", "widgets", "features"]);
// Literal (unresolved) import specifiers banned in worker/. These are checked
// against the raw specifier, not a resolved file, because banning "react" as a
// *module* (not a path) is the point — no on-disk file could ever satisfy it.
const workerForbiddenModulePattern = /^react(-dom)?(\/.*)?$/;
// Sub-order within a layer: a slice may only import (at the value level) a
// slice strictly below it, same as the cross-layer rule. Rank is a measured
// topological order of the real dependency DAG (see the empirical edges this
// gate enforces), not an aspirational one — a new lower-level slice must slot
// below every slice that already depends on it, not the other way round.
//
// entities: platform/editor-session (independent roots) -> scene (domain
// nodes/geometry) -> guides (reads scene for snapping) -> motion
// (samples/animates scene nodes) -> camera-motion (cross-store camera plans)
// -> motion-grammar
// (compiles onto motion) -> component-motion (coordinates component
// Scene/Motion/Grammar side-cars) -> agent (reads/writes all of the above
// for the MCP bridge).
const entitiesSliceRank: Record<string, number> = {
	platform: 0,
	"editor-session": 0,
	scene: 1,
	guides: 2,
	motion: 3,
	"camera-motion": 4,
	"motion-grammar": 5,
	"component-motion": 6,
	agent: 7,
};
// widgets: the leaf editor surfaces have no cross-slice dependencies and all
// sit at rank 0; action-surface and inspector compose those leaves; top-bar
// composes action-surface (and reads agent-bridge for MCP status).
const widgetsSliceRank: Record<string, number> = {
	"canvas-shell": 0,
	"layers-panel": 0,
	"tool-rail": 0,
	"agent-bridge": 0,
	"look-workspace": 0,
	"parameter-capture": 0,
	timeline: 0,
	"tool-options": 0,
	"component-motion": 0,
	"tutorial-guide": 0,
	"visual-review-workspace": 0,
	"motion-copilot": 0,
	"gravity-review-guide": 0,
	"action-surface": 1,
	inspector: 1,
	"top-bar": 2,
};
const sameLayerSliceRanks: Partial<Record<LayerName, Record<string, number>>> =
	{
		entities: entitiesSliceRank,
		widgets: widgetsSliceRank,
	};
const domApiPattern =
	/\b(window\.|Document|Element|HTMLElement|SVGElement|PointerEvent|MouseEvent|KeyboardEvent|DOMMatrix|DOMPoint|localStorage|sessionStorage|navigator\.)/;
const testFilePattern = /\.test\.tsx?$/;
const documentStoreHookNames = new Set([
	"useSceneStore",
	"useMotionStore",
	"useMotionGrammarStore",
]);
const documentStoreOwnerFiles = new Set([
	"src/entities/scene/model/store.ts",
	"src/entities/motion/model/store.ts",
	"src/entities/motion-grammar/model/store.ts",
]);
const documentMutatorNames = new Set([
	"copyWithin",
	"fill",
	"pop",
	"push",
	"reverse",
	"shift",
	"sort",
	"splice",
	"unshift",
]);
// One left-to-right pass over string/template literals and comments. Matching
// strings as whole tokens stops a `//` or banned token inside a string from
// being read as code, and vice versa. Regex literals are not matched, so they
// pass through untouched (none of our patterns live inside one in feature code).
const literalOrCommentPattern =
	/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
// 1 ToolId = 1 handler: the host's `handlers.find(h => h.tool === activeTool)`
// picks the first match, so two handlers claiming the same tool leaves one as
// dead code (the transform/selection collision that this check would have caught).
const canvasHandlerPattern = /^src\/features\/[^/]+\/canvas\/handler\.ts$/;
const toolOwners = new Map<string, string[]>();

type LayerName = keyof typeof layerRank;

const files = walk(srcRoot).map((absolutePath) => ({
	absolutePath,
	repoPath: toRepoPath(absolutePath),
}));
const fileSet = new Set(files.map((file) => file.repoPath));
const sourceFiles = files.filter((file) =>
	sourceExtensions.has(path.extname(file.repoPath)),
);
// The public open-source tree ships without worker/ (it stays in the private
// deployment repo), so this scan is opt-in: skip it rather than crash when the
// directory is absent, and keep every rule unchanged when it is present.
const workerFiles = existsSync(workerRoot)
	? walk(workerRoot)
			.map((absolutePath) => ({
				absolutePath,
				repoPath: toRepoPath(absolutePath),
			}))
			.filter((file) => sourceExtensions.has(path.extname(file.repoPath)))
	: [];
const moduleFileSet = new Set([
	...fileSet,
	...workerFiles.map((file) => file.repoPath),
]);
const errors: string[] = [];
const valueImportGraph = new Map<string, Set<string>>();

checkSameLayerRankCoverage("entities", entitiesSliceRank);
checkSameLayerRankCoverage("widgets", widgetsSliceRank);

for (const file of sourceFiles) {
	checkTopLevel(file.repoPath);
	const source = readFileSync(file.absolutePath, "utf8");
	if (file.repoPath.startsWith("src/entities/scene/model/")) {
		// Capability labels and model anchors may legitimately describe a "Document"
		// without importing or calling the browser DOM. Ignore quoted metadata and
		// comments, but retain template literals so `${document...}` remains visible.
		const match = stripCommentsAndQuotedStrings(source).match(domApiPattern);
		if (match) {
			errors.push(
				`${file.repoPath}: scene model must stay DOM-free; found "${match[1]}".`,
			);
		}
	}
	const entries = importEntries(file.repoPath, source);
	for (const entry of entries) {
		checkImport(file.repoPath, entry.source);
	}
	for (const entry of entries) {
		checkSameLayerOrder(file.repoPath, entry);
	}
	collectValueImportEdges(file.repoPath, entries);
	checkCommandBusDiscipline(file.repoPath, source);
	collectToolRegistrations(file.repoPath, source);
}

for (const file of workerFiles) {
	const source = readFileSync(file.absolutePath, "utf8");
	const entries = importEntries(file.repoPath, source);
	for (const entry of entries) {
		checkWorkerImport(file.repoPath, entry.source);
	}
	collectValueImportEdges(file.repoPath, entries);
}

checkValueImportCycles();
checkShortcutAuthority();

for (const [toolId, owners] of toolOwners) {
	if (owners.length > 1) {
		errors.push(
			`tool "${toolId}" is registered by more than one handler (${owners.join(", ")}); a ToolId must have exactly one handler (the host picks the first match, the rest become dead code).`,
		);
	}
}

if (errors.length > 0) {
	console.error("Architecture check failed.");
	console.error(
		"Required import direction: app -> pages -> widgets -> features -> entities -> shared.",
	);
	for (const error of errors) console.error(`- ${error}`);
	process.exit(1);
}

console.log("Architecture check passed.");

function walk(dir: string): string[] {
	return readdirSync(dir).flatMap((entry) => {
		const absolute = path.join(dir, entry);
		const stats = statSync(absolute);
		if (stats.isDirectory()) return walk(absolute);
		if (stats.isFile()) return [absolute];
		return [];
	});
}

function toRepoPath(file: string): string {
	return path.relative(repoRoot, file).split(path.sep).join("/");
}

function checkTopLevel(file: string): void {
	const parts = file.split("/");
	if (parts.length === 2) {
		if (!allowedTopLevelFiles.has(file)) {
			errors.push(`${file}: top-level source file is not allowed.`);
		}
		return;
	}
	const topLevel = parts[1];
	if (!isLayerName(topLevel)) {
		errors.push(`${file}: src/${topLevel} is not an allowed top-level layer.`);
	}
}

// Comments removed (→ space), string/template literals kept verbatim. Used by the
// tool-ownership scan, which must READ the `tool: "..."` literal but ignore the
// rule documented in prose.
function stripComments(source: string): string {
	return source.replace(literalOrCommentPattern, (match) =>
		match.startsWith("/") ? " " : match,
	);
}

// Comments and ordinary quoted strings removed, template literals retained.
// The scene DOM gate uses this narrower mask so executable `${...}` expressions
// cannot hide a browser global while descriptive metadata stays
// false-positive free.
function stripCommentsAndQuotedStrings(source: string): string {
	return source.replace(literalOrCommentPattern, (match) => {
		if (match.startsWith("`")) return match;
		return match.startsWith("/") ? " " : '""';
	});
}

// Comments AND string/template literals removed. Used by the command-bus scan, so
// a string or comment that merely names `useSceneStore.setState` is not flagged.
function checkCommandBusDiscipline(file: string, source: string): void {
	if (testFilePattern.test(file)) return;
	if (documentStoreOwnerFiles.has(file)) return;

	const sourceFile = ts.createSourceFile(
		file,
		source,
		ts.ScriptTarget.Latest,
		true,
		file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
	);
	const storeAliases = new Set<string>();
	const stateAliases = new Set<string>();
	const documentAliases = new Set<string>();
	const declarations: ts.VariableDeclaration[] = [];

	const visitDeclarations = (node: ts.Node): void => {
		if (ts.isImportDeclaration(node) && node.importClause?.namedBindings) {
			const bindings = node.importClause.namedBindings;
			if (ts.isNamedImports(bindings)) {
				for (const element of bindings.elements) {
					const importedName = element.propertyName?.text ?? element.name.text;
					if (documentStoreHookNames.has(importedName)) {
						storeAliases.add(element.name.text);
					}
				}
			}
		}
		if (ts.isVariableDeclaration(node)) declarations.push(node);
		ts.forEachChild(node, visitDeclarations);
	};
	visitDeclarations(sourceFile);

	const unwrap = (expression: ts.Expression): ts.Expression => {
		let current = expression;
		while (
			ts.isParenthesizedExpression(current) ||
			ts.isAsExpression(current) ||
			ts.isTypeAssertionExpression(current) ||
			ts.isNonNullExpression(current) ||
			ts.isSatisfiesExpression(current)
		) {
			current = current.expression;
		}
		return current;
	};
	const isStore = (expression: ts.Expression): boolean => {
		const current = unwrap(expression);
		return ts.isIdentifier(current) && storeAliases.has(current.text);
	};
	const isGetStateCall = (expression: ts.Expression): boolean => {
		const current = unwrap(expression);
		return (
			ts.isCallExpression(current) &&
			ts.isPropertyAccessExpression(current.expression) &&
			current.expression.name.text === "getState" &&
			isStore(current.expression.expression)
		);
	};
	const isState = (expression: ts.Expression): boolean => {
		const current = unwrap(expression);
		return (
			(ts.isIdentifier(current) && stateAliases.has(current.text)) ||
			isGetStateCall(current)
		);
	};
	const isDocumentRoot = (expression: ts.Expression): boolean => {
		const current = unwrap(expression);
		if (ts.isIdentifier(current)) return documentAliases.has(current.text);
		if (ts.isPropertyAccessExpression(current)) {
			return current.name.text === "document" && isState(current.expression);
		}
		return false;
	};
	const isDocument = (expression: ts.Expression): boolean => {
		const current = unwrap(expression);
		if (isDocumentRoot(current)) return true;
		if (
			ts.isPropertyAccessExpression(current) ||
			ts.isElementAccessExpression(current)
		) {
			return isDocument(current.expression);
		}
		return false;
	};
	const addBindingNames = (
		name: ts.BindingName,
		target: Set<string>,
	): boolean => {
		if (ts.isIdentifier(name)) {
			const before = target.size;
			target.add(name.text);
			return target.size !== before;
		}
		let changed = false;
		for (const element of name.elements) {
			if (ts.isOmittedExpression(element)) continue;
			changed = addBindingNames(element.name, target) || changed;
		}
		return changed;
	};

	let aliasesChanged = true;
	while (aliasesChanged) {
		aliasesChanged = false;
		for (const declaration of declarations) {
			if (!declaration.initializer) continue;
			const initializer = declaration.initializer;
			if (isStore(initializer)) {
				aliasesChanged =
					addBindingNames(declaration.name, storeAliases) || aliasesChanged;
				continue;
			}
			if (isState(initializer)) {
				if (ts.isObjectBindingPattern(declaration.name)) {
					for (const element of declaration.name.elements) {
						if (
							(element.propertyName ?? element.name).getText(sourceFile) ===
							"document"
						) {
							aliasesChanged =
								addBindingNames(element.name, documentAliases) ||
								aliasesChanged;
						}
					}
				} else {
					aliasesChanged =
						addBindingNames(declaration.name, stateAliases) || aliasesChanged;
				}
				continue;
			}
			// Only alias the document object itself. A descendant such as
			// `store.getState().document.name` is a scalar and must not taint its
			// binding as a mutable document reference.
			if (isDocumentRoot(initializer)) {
				aliasesChanged =
					addBindingNames(declaration.name, documentAliases) || aliasesChanged;
			}
		}
	}

	const report = (node: ts.Node, operation: string): void => {
		const position = sourceFile.getLineAndCharacterOfPosition(
			node.getStart(sourceFile),
		);
		errors.push(
			`${file}:${position.line + 1}: document store bypass (${operation}); Scene, Motion, and Motion Grammar writes must use the owning command bus.`,
		);
	};
	const isAssignmentOperator = (kind: ts.SyntaxKind): boolean =>
		kind >= ts.SyntaxKind.FirstAssignment &&
		kind <= ts.SyntaxKind.LastAssignment;
	const visitMutations = (node: ts.Node): void => {
		if (
			ts.isCallExpression(node) &&
			ts.isPropertyAccessExpression(node.expression)
		) {
			const receiver = node.expression.expression;
			const method = node.expression.name.text;
			if (method === "setState" && isStore(receiver)) {
				report(node, "raw setState");
			} else if (documentMutatorNames.has(method) && isDocument(receiver)) {
				report(node, `nested ${method}()`);
			} else if (
				method === "assign" &&
				node.expression.expression.getText(sourceFile) === "Object" &&
				node.arguments[0] &&
				isDocument(node.arguments[0])
			) {
				report(node, "Object.assign(document)");
			}
		}
		if (
			ts.isBinaryExpression(node) &&
			isAssignmentOperator(node.operatorToken.kind) &&
			isDocument(node.left)
		) {
			report(node, "document assignment");
		}
		if (
			(ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
			(node.operator === ts.SyntaxKind.PlusPlusToken ||
				node.operator === ts.SyntaxKind.MinusMinusToken) &&
			isDocument(node.operand)
		) {
			report(node, "document increment/decrement");
		}
		if (ts.isDeleteExpression(node) && isDocument(node.expression)) {
			report(node, "document delete");
		}
		ts.forEachChild(node, visitMutations);
	};
	visitMutations(sourceFile);
}

function collectToolRegistrations(file: string, source: string): void {
	if (!canvasHandlerPattern.test(file)) return;
	const seen = new Set<string>();
	for (const line of stripComments(source).split("\n")) {
		// Skip type annotations (`readonly tool: "select"`); only value
		// registrations (`tool: "select"`) bind a handler to a tool at runtime.
		// Anchored to line start so a trailing `readonly` can't suppress a value.
		if (/^\s*readonly\b/.test(line)) continue;
		const match = line.match(/\btool:\s*"([a-z][a-z-]*)"/);
		if (!match || seen.has(match[1])) continue;
		seen.add(match[1]);
		const owners = toolOwners.get(match[1]) ?? [];
		owners.push(file);
		toolOwners.set(match[1], owners);
	}
	// A handler the host loads must declare its tool as a readable string literal,
	// else ownership cannot be checked — a const/computed/re-exported tool is
	// invisible here and could silently collide (the host picks the first match).
	if (seen.size === 0) {
		errors.push(
			`${file}: a canvas handler must register its tool as a string literal (tool: "..."), so ToolId ownership is statically checkable; none was found.`,
		);
	}
}

type ImportEntry = { source: string; isTypeOnly: boolean };

/** Reads static imports/exports and preserves their emitted-value semantics. */
function importEntries(file: string, source: string): ImportEntry[] {
	const sourceFile = ts.createSourceFile(
		file,
		source,
		ts.ScriptTarget.Latest,
		true,
		file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
	);
	const entries: ImportEntry[] = [];
	for (const statement of sourceFile.statements) {
		if (
			ts.isImportDeclaration(statement) &&
			ts.isStringLiteralLike(statement.moduleSpecifier)
		) {
			const clause = statement.importClause;
			const namedBindings = clause?.namedBindings;
			const namedBindingsAreTypeOnly =
				namedBindings !== undefined &&
				ts.isNamedImports(namedBindings) &&
				namedBindings.elements.length > 0 &&
				namedBindings.elements.every((element) => element.isTypeOnly);
			entries.push({
				source: statement.moduleSpecifier.text,
				isTypeOnly:
					Boolean(clause?.isTypeOnly) ||
					(Boolean(clause) && !clause?.name && namedBindingsAreTypeOnly),
			});
			continue;
		}
		if (
			ts.isExportDeclaration(statement) &&
			statement.moduleSpecifier &&
			ts.isStringLiteralLike(statement.moduleSpecifier)
		) {
			const exportClause = statement.exportClause;
			const namedExportsAreTypeOnly =
				exportClause !== undefined &&
				ts.isNamedExports(exportClause) &&
				exportClause.elements.length > 0 &&
				exportClause.elements.every((element) => element.isTypeOnly);
			entries.push({
				source: statement.moduleSpecifier.text,
				isTypeOnly: statement.isTypeOnly || namedExportsAreTypeOnly,
			});
		}
	}
	return entries;
}

/** Collects production value-import edges for the cycle invariant. */
function collectValueImportEdges(
	file: string,
	entries: readonly ImportEntry[],
): void {
	if (testFilePattern.test(file)) return;
	const edges = valueImportGraph.get(file) ?? new Set<string>();
	valueImportGraph.set(file, edges);
	for (const entry of entries) {
		if (entry.isTypeOnly) continue;
		const target = resolveImport(file, entry.source);
		if (!target || testFilePattern.test(target)) continue;
		if (!sourceExtensions.has(path.extname(target))) continue;
		edges.add(target);
		if (!valueImportGraph.has(target)) valueImportGraph.set(target, new Set());
	}
}

/** Rejects every production value-import SCC, including Worker modules. */
function checkValueImportCycles(): void {
	let nextIndex = 0;
	const indexByFile = new Map<string, number>();
	const lowLinkByFile = new Map<string, number>();
	const stack: string[] = [];
	const onStack = new Set<string>();

	const visit = (file: string): void => {
		const index = nextIndex;
		nextIndex += 1;
		indexByFile.set(file, index);
		lowLinkByFile.set(file, index);
		stack.push(file);
		onStack.add(file);

		for (const target of valueImportGraph.get(file) ?? []) {
			if (!indexByFile.has(target)) {
				visit(target);
				lowLinkByFile.set(
					file,
					Math.min(
						lowLinkByFile.get(file) ?? index,
						lowLinkByFile.get(target) ?? index,
					),
				);
			} else if (onStack.has(target)) {
				lowLinkByFile.set(
					file,
					Math.min(
						lowLinkByFile.get(file) ?? index,
						indexByFile.get(target) ?? index,
					),
				);
			}
		}

		if (lowLinkByFile.get(file) !== indexByFile.get(file)) return;
		const component: string[] = [];
		let member: string | undefined;
		do {
			member = stack.pop();
			if (!member) break;
			onStack.delete(member);
			component.push(member);
		} while (member !== file);

		const selfCycle =
			component.length === 1 &&
			(valueImportGraph.get(component[0])?.has(component[0]) ?? false);
		if (component.length > 1 || selfCycle) {
			errors.push(
				`production value-import cycle: ${component.sort().join(" -> ")}. Move shared read/command behavior to its stable lower owner; type-only edges are already excluded.`,
			);
		}
	};

	for (const file of valueImportGraph.keys()) {
		if (!indexByFile.has(file)) visit(file);
	}
}

/** Ensures global tool runtime/display declarations resolve to one shortcut. */
function checkShortcutAuthority(): void {
	const activatable = new Set<string>(ACTIVATABLE_TOOL_IDS);
	const canonical = new Set<string>(Object.keys(GLOBAL_TOOL_SHORTCUTS));
	for (const toolId of new Set([...activatable, ...canonical])) {
		if (!activatable.has(toolId) || !canonical.has(toolId)) {
			errors.push(
				`tool shortcut authority mismatch for "${toolId}": GLOBAL_TOOL_SHORTCUTS and ACTIVATABLE_TOOL_IDS must contain the same tools.`,
			);
			continue;
		}
		const reachability = toolReachability(
			toolId as (typeof ACTIVATABLE_TOOL_IDS)[number],
		);
		const declared =
			GLOBAL_TOOL_SHORTCUTS[toolId as keyof typeof GLOBAL_TOOL_SHORTCUTS];
		if (
			reachability.kind !== "activatable" ||
			!reachability.shortcut ||
			shortcutSignature(reachability.shortcut) !== shortcutSignature(declared)
		) {
			errors.push(
				`tool shortcut authority mismatch for "${toolId}": reachability/runtime/display must derive from GLOBAL_TOOL_SHORTCUTS.`,
			);
		}
	}

	const ownerByShortcut = new Map<string, string>();
	for (const [toolId, shortcut] of Object.entries(GLOBAL_TOOL_SHORTCUTS)) {
		const signature = shortcutSignature(shortcut);
		const previous = ownerByShortcut.get(signature);
		if (previous) {
			errors.push(
				`duplicate global tool shortcut ${signature}: ${previous} and ${toolId}.`,
			);
		} else {
			ownerByShortcut.set(signature, toolId);
		}
	}
}

function checkImport(file: string, importSource: string): void {
	const target = resolveImport(file, importSource);
	if (!target) return;
	const sourceLayer = layerOf(file);
	const targetLayer = layerOf(target);
	if (!sourceLayer || !targetLayer) return;
	if (layerRank[sourceLayer] < layerRank[targetLayer]) {
		errors.push(
			`${file}: ${sourceLayer} must not import upward from ${target}.`,
		);
	}
	if (sourceLayer === "features" && targetLayer === "features") {
		const sourceFeature = file.split("/")[2];
		const targetFeature = target.split("/")[2];
		if (sourceFeature && targetFeature && sourceFeature !== targetFeature) {
			errors.push(`${file}: feature-to-feature import is banned (${target}).`);
		}
	}
}

/** Keeps the rank authority closed over every real same-layer slice. */
function checkSameLayerRankCoverage(
	layer: "entities" | "widgets",
	ranks: Readonly<Record<string, number>>,
): void {
	const slicePrefix = `src/${layer}/`;
	const sourceSlices = new Set(
		sourceFiles
			.map((file) => file.repoPath)
			.filter((file) => file.startsWith(slicePrefix))
			.map((file) => file.split("/")[2])
			.filter((slice): slice is string => Boolean(slice)),
	);
	for (const slice of sourceSlices) {
		if (ranks[slice] === undefined) {
			errors.push(
				`src/${layer}/${slice}: slice is missing from the ${layer} rank map.`,
			);
		}
	}
	for (const slice of Object.keys(ranks)) {
		if (!sourceSlices.has(slice)) {
			errors.push(
				`src/${layer}/${slice}: stale ${layer} rank entry has no source slice.`,
			);
		}
	}
}

// Sub-order within a single layer (entities, widgets): a slice may import
// another slice in the same layer only at a strictly lower rank, and only at
// the value level. Type-only imports are exempt (verbatimModuleSyntax erases
// them, and the codebase has a known legitimate type-only coupling between
// entities/scene and entities/motion for the grammar-bridge types) — an
// upward or same-rank *type* import does not create a runtime dependency.
function checkSameLayerOrder(file: string, entry: ImportEntry): void {
	if (entry.isTypeOnly) return;
	const target = resolveImport(file, entry.source);
	if (!target) return;
	const layer = layerOf(file);
	if (!layer) return;
	const ranks = sameLayerSliceRanks[layer];
	if (!ranks) return;
	if (layerOf(target) !== layer) return;
	const sourceSlice = file.split("/")[2];
	const targetSlice = target.split("/")[2];
	if (!sourceSlice || !targetSlice || sourceSlice === targetSlice) return;
	const sourceRank = ranks[sourceSlice];
	const targetRank = ranks[targetSlice];
	if (sourceRank === undefined || targetRank === undefined) {
		errors.push(
			`${file}: src/${layer}/${sourceSlice} or src/${layer}/${targetSlice} is missing from the ${layer} slice rank map; add it before this import can be checked.`,
		);
		return;
	}
	if (sourceRank <= targetRank) {
		errors.push(
			`${file}: src/${layer}/${sourceSlice} (rank ${sourceRank}) must not import src/${layer}/${targetSlice} (rank ${targetRank}); a slice may only import a strictly lower-ranked sibling in the same layer.`,
		);
	}
}

// The Worker must stay a plain server boundary: no client-app layers, no React
// (it renders nothing), regardless of whether the import is a type or a value
// (verbatimModuleSyntax erases type-only imports at build time, but both forms
// still indicate the file was written assuming a client-side dependency).
function checkWorkerImport(file: string, importSource: string): void {
	if (workerForbiddenModulePattern.test(importSource)) {
		errors.push(
			`${file}: worker must not import "${importSource}"; the Worker never renders UI.`,
		);
		return;
	}
	const target = resolveImport(file, importSource);
	if (!target) return;
	const targetLayer = layerOf(target);
	if (targetLayer && workerForbiddenLayers.has(targetLayer)) {
		errors.push(
			`${file}: worker must not import from src/${targetLayer} (${target}); only entities/shared are allowed.`,
		);
	}
}

function resolveImport(file: string, importSource: string): string | undefined {
	if (importSource.startsWith("@/")) {
		return resolveCandidate(`src/${importSource.slice(2)}`);
	}
	if (importSource.startsWith(".")) {
		return resolveCandidate(
			normalizeRepoPath(path.join(path.dirname(file), importSource)),
		);
	}
	return undefined;
}

function resolveCandidate(base: string): string | undefined {
	const candidates = [
		base,
		`${base}.ts`,
		`${base}.tsx`,
		`${base}.css`,
		`${base}/index.ts`,
		`${base}/index.tsx`,
	];
	return candidates.find((candidate) => moduleFileSet.has(candidate));
}

function normalizeRepoPath(value: string): string {
	return path.normalize(value).split(path.sep).join("/");
}

function layerOf(file: string): LayerName | undefined {
	if (file === "src/main.tsx") return undefined;
	const layer = file.split("/")[1];
	return isLayerName(layer) ? layer : undefined;
}

function isLayerName(value: string | undefined): value is LayerName {
	return Boolean(value && value in layerRank);
}
