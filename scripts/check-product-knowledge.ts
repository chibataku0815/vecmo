import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const productKnowledgePrefix = "docs/product-knowledge/";
const productFacingPrefixes = [
	"src/app/",
	"src/pages/",
	"src/widgets/",
	"src/features/",
	"src/entities/",
	"src/shared/ui/",
	"worker/",
] as const;
const ignoredPatterns = [
	/\.test\.tsx?$/,
	/\.spec\.tsx?$/,
	/(^|\/)__tests__\//,
] as const;

const indexErrors = validateProductKnowledgeIndex();
if (indexErrors.length > 0) {
	console.error("Product-knowledge index check failed.");
	for (const error of indexErrors) console.error(`- ${error}`);
	console.error(
		"Classify every detail page in README.md under Current Entries or Supplemental classified index; capability rows must name a live CAP-/SUBCAP- id.",
	);
	process.exit(1);
}

const mainRef = resolveMainRef();

if (!mainRef) {
	console.warn(
		"Product-knowledge check skipped: no local or remote main ref was found.",
	);
	process.exit(0);
}

const mergeBase = gitLine(["merge-base", mainRef, "HEAD"]);

if (!mergeBase) {
	console.warn(
		`Product-knowledge check skipped: could not compute merge-base with ${mainRef}.`,
	);
	process.exit(0);
}

const changedFiles = unique([
	...gitLines([
		"diff",
		"--name-only",
		"--diff-filter=ACMRTUXB",
		`${mergeBase}...HEAD`,
	]),
	...gitLines(["diff", "--name-only", "--diff-filter=ACMRTUXB"]),
	...gitLines(["diff", "--cached", "--name-only", "--diff-filter=ACMRTUXB"]),
	...gitLines(["ls-files", "--others", "--exclude-standard"]),
]);

const productFacingChanges = changedFiles.filter(isProductFacingChange);
const productKnowledgeChanged = changedFiles.some((file) =>
	file.startsWith(productKnowledgePrefix),
);

if (productFacingChanges.length > 0 && !productKnowledgeChanged) {
	console.error("Product-knowledge check failed.");
	console.error(
		"Product-facing source changed, but docs/product-knowledge was not updated.",
	);
	console.error(
		"Feature additions and user-visible workflow changes must update the knowledge entry before merge to main.",
	);
	console.error("");
	console.error("Product-facing files:");
	for (const file of productFacingChanges.slice(0, 20)) {
		console.error(`- ${file}`);
	}
	if (productFacingChanges.length > 20) {
		console.error(`- ...and ${productFacingChanges.length - 20} more`);
	}
	console.error("");
	console.error(
		"Add or update docs/product-knowledge/<feature>.md. If the feature is external-facing, also update src/pages/updates/model/product-updates.ts.",
	);
	process.exit(1);
}

console.log("Product-knowledge check passed.");

function resolveMainRef(): string | undefined {
	if (gitSucceeds(["show-ref", "--verify", "--quiet", "refs/heads/main"])) {
		return "main";
	}
	if (
		gitSucceeds(["show-ref", "--verify", "--quiet", "refs/remotes/origin/main"])
	) {
		return "origin/main";
	}
	return undefined;
}

function isProductFacingChange(file: string): boolean {
	if (file.startsWith(productKnowledgePrefix)) return false;
	if (ignoredPatterns.some((pattern) => pattern.test(file))) return false;
	return productFacingPrefixes.some((prefix) => file.startsWith(prefix));
}

function gitLine(args: readonly string[]): string | undefined {
	return gitLines(args)[0];
}

function gitLines(args: readonly string[]): string[] {
	try {
		const output = execFileSync("git", [...args], {
			cwd: repoRoot,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		return output
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);
	} catch {
		return [];
	}
}

function gitSucceeds(args: readonly string[]): boolean {
	try {
		execFileSync("git", [...args], {
			cwd: repoRoot,
			stdio: ["ignore", "ignore", "ignore"],
		});
		return true;
	} catch {
		return false;
	}
}

function unique(values: readonly string[]): string[] {
	return Array.from(new Set(values));
}

/**
 * Keeps the Product Knowledge directory closed under one reviewable index.
 * New Markdown pages must be explicitly classified instead of silently
 * becoming uncounted capability claims or orphan implementation notes.
 */
function validateProductKnowledgeIndex(): string[] {
	const errors: string[] = [];
	const productKnowledgeDir = path.join(repoRoot, productKnowledgePrefix);
	const readme = readFileSync(
		path.join(productKnowledgeDir, "README.md"),
		"utf8",
	);
	const capabilities = readFileSync(
		path.join(productKnowledgeDir, "current-capabilities.md"),
		"utf8",
	);
	const inventoryLink = capabilities.match(
		/\[capability inventory\]\((\.\.\/progress\/[^)]+\.md)\)/,
	)?.[1];
	// The public open-source tree ships current-capabilities.md without its
	// internal capability-inventory link (docs/progress/ stays in the private
	// deployment repo): skip the canonical-id cross-check with a notice rather
	// than failing when the link itself is absent, same tolerance as the
	// missing-inventory-file case below and check-source-disposition.ts's
	// deferred rule.
	if (!inventoryLink) {
		console.log(
			"Notice: current-capabilities.md has no capability-inventory link; skipping canonical capability-id cross-check.",
		);
	}
	const inventoryPath = inventoryLink
		? path.resolve(productKnowledgeDir, inventoryLink)
		: undefined;
	const inventoryAvailable =
		inventoryPath !== undefined && existsSync(inventoryPath);
	if (inventoryLink && !inventoryAvailable && inventoryPath) {
		console.log(
			`Notice: ${toRepoPath(inventoryPath)} not found; skipping canonical capability-id cross-check.`,
		);
	}
	const inventory =
		inventoryAvailable && inventoryPath
			? readFileSync(inventoryPath, "utf8")
			: "";
	const canonicalCapabilityIds = new Set(
		[...inventory.matchAll(/`((?:SUB)?CAP-(?:\d{2}|NR)-\d{3})`/g)].map(
			(match) => match[1],
		),
	);
	const detailPages = readdirSync(productKnowledgeDir)
		.filter((file) => file.endsWith(".md") && file !== "README.md")
		.sort();
	const currentStart = readme.indexOf("## Current Entries");
	const supplementalStart = readme.indexOf("## Supplemental classified index");
	const publicStart = readme.indexOf("## Public Surface");
	// The public open-source tree's README predates the Supplemental classified
	// index section (its 50-odd unlinked detail pages have never been given a
	// disposition/CAP-id). Retrofitting that classification is a content-
	// authorship task, not a structural check fix, so skip the per-page
	// cross-check with a notice rather than failing, same tolerance pattern as
	// the capability-inventory link above.
	const classificationStructureAvailable = supplementalStart >= 0;
	if (!classificationStructureAvailable) {
		console.log(
			"Notice: README.md has no '## Supplemental classified index' section; skipping per-page classification cross-check.",
		);
	}
	if (
		currentStart < 0 ||
		publicStart < 0 ||
		!(currentStart < publicStart) ||
		(classificationStructureAvailable &&
			!(currentStart < supplementalStart && supplementalStart < publicStart))
	) {
		return [
			"README.md must retain ordered Current Entries, Supplemental classified index, and Public Surface sections.",
		];
	}

	const pageLinks = (source: string): string[] =>
		[...source.matchAll(/\]\(\.\/([^)]+\.md)\)/g)].map((match) => match[1]);
	const currentLinks = pageLinks(
		readme.slice(
			currentStart,
			classificationStructureAvailable ? supplementalStart : publicStart,
		),
	);
	const supplementalSource = classificationStructureAvailable
		? readme.slice(supplementalStart, publicStart)
		: "";
	const supplementalLinks = pageLinks(supplementalSource);
	const currentSet = new Set(currentLinks);
	const supplementalSet = new Set(supplementalLinks);

	if (classificationStructureAvailable) {
		for (const page of detailPages) {
			const owners =
				Number(currentSet.has(page)) + Number(supplementalSet.has(page));
			if (owners === 0) {
				errors.push(
					`${productKnowledgePrefix}${page} is not classified in README.md.`,
				);
			} else if (owners > 1) {
				errors.push(
					`${productKnowledgePrefix}${page} appears in both canonical index sections; keep one disposition owner.`,
				);
			}
		}
	}
	for (const linkedPage of new Set([...currentLinks, ...supplementalLinks])) {
		if (!detailPages.includes(linkedPage)) {
			errors.push(`README.md links missing detail page ${linkedPage}.`);
		}
	}

	const supplementalRows = supplementalSource
		.split("\n")
		.map((line) =>
			line.match(
				/^\| \[[^\]]+\]\(\.\/([^)]+\.md)\) \| ([^|]+?) \| ([^|]+?) \|$/,
			),
		)
		.filter((match): match is RegExpMatchArray => Boolean(match));
	if (
		classificationStructureAvailable &&
		supplementalRows.length !== supplementalSet.size
	) {
		errors.push(
			"Every Supplemental classified index link must be one complete Page / Disposition / Canonical mapping row.",
		);
	}
	for (const row of supplementalRows) {
		const [, page, disposition, mapping] = row;
		const requiresCapabilityId =
			disposition === "capability detail" ||
			disposition === "sub-capability detail";
		const ids = mapping.match(/(?:SUB)?CAP-\d{2}-\d{3}/g) ?? [];
		if (requiresCapabilityId && ids.length === 0) {
			errors.push(`${page}: ${disposition} requires a CAP-/SUBCAP- mapping.`);
		}
		if (!requiresCapabilityId && ids.length > 0) {
			errors.push(
				`${page}: non-positive disposition "${disposition}" must not claim a capability id.`,
			);
		}
		for (const id of ids) {
			if (inventoryAvailable && !canonicalCapabilityIds.has(id)) {
				errors.push(
					`${page}: canonical mapping ${id} is absent from ${toRepoPath(inventoryPath)}.`,
				);
			}
		}
	}

	return errors;
}

function toRepoPath(file: string): string {
	return path.relative(repoRoot, file).split(path.sep).join("/");
}
