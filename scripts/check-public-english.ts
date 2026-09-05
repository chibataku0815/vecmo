import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const publicEnglishTargets = [
	"README.md",
	"docs/product-knowledge",
	"docs/public-english-surface-plan.md",
	"src/pages/public",
	"src/pages/checkout",
	"src/pages/legal",
	"src/pages/updates",
	"src/pages/tutorials",
	// Tutorial goal/step copy rendered on the public gallery AND in the in-editor
	// guide panel — gated here rather than the whole `reference-scenes` slice,
	// which also holds non-prose fixture/registry data out of this gate's scope.
	"src/features/reference-scenes/model/tutorial-content.ts",
] as const;

const textExtensions = new Set([".md", ".ts", ".tsx"]);
const japaneseTextPattern = /[\u3040-\u30ff\u3400-\u9fff]/u;
const errors: string[] = [];

for (const target of publicEnglishTargets) {
	const absolute = path.join(repoRoot, target);
	for (const file of walkExisting(absolute)) {
		if (!textExtensions.has(path.extname(file))) continue;
		const source = readFileSync(file, "utf8");
		const lines = source.split("\n");
		for (const [index, line] of lines.entries()) {
			if (!japaneseTextPattern.test(line)) continue;
			const repoPath = path.relative(repoRoot, file).split(path.sep).join("/");
			errors.push(`${repoPath}:${index + 1}: ${line.trim()}`);
		}
	}
}

if (errors.length > 0) {
	console.error("Public-English check failed.");
	console.error(
		"Public-facing product copy must stay English until multilingual support exists.",
	);
	for (const error of errors.slice(0, 40)) console.error(`- ${error}`);
	if (errors.length > 40) {
		console.error(`- ...and ${errors.length - 40} more`);
	}
	process.exit(1);
}

console.log("Public-English check passed.");

function walkExisting(target: string): string[] {
	try {
		const stats = statSync(target);
		if (stats.isFile()) return [target];
		if (!stats.isDirectory()) return [];
		return readdirSync(target).flatMap((entry) =>
			walkExisting(path.join(target, entry)),
		);
	} catch {
		return [];
	}
}
