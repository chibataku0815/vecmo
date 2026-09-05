import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Design-token discipline: chrome styling must consume semantic tokens declared
// in src/app/styles/index.css, never raw arbitrary values. Tokens stabilize the
// design only if they cannot silently decay back to one-off hex/px — this guard
// is that ratchet. Pairs with the token layer; see
// docs/design-system-tokens-and-headless-ui-plan.md.
const repoRoot = process.cwd();
const srcRoot = path.join(repoRoot, "src");

// Where literal colors are legitimate and must NOT be tokenized:
// - entities/: scene document paint is serialized DATA, not chrome styling
//   (seed-scene/factory/fixtures assert exact hex; tokenizing breaks export).
// - features/*/canvas/, shared/ui/overlay/, widgets/canvas-shell/ui/: the canvas
//   workspace is a separate, zoom-stable palette (grid, artboard shadow, and SVG
//   presentation attributes that cannot resolve var()) deliberately kept out of
//   the chrome token system. See docs/design-system.md for the chrome-vs-canvas
//   palette split.
const isExempt = (repoPath: string): boolean =>
	repoPath.startsWith("src/entities/") ||
	/^src\/features\/[^/]+\/canvas\//.test(repoPath) ||
	repoPath.startsWith("src/shared/ui/overlay/") ||
	repoPath.startsWith("src/widgets/canvas-shell/ui/");

// Strip // and /* */ comments so a banned token named in prose is not flagged.
const commentPattern = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
// Literal color (hex / rgb(a) / hsl(a)) inside a Tailwind arbitrary value, in
// either form: a named utility (shadow-[inset_3px_0_0_#f4c430], bg-[#2ec4b6]) or
// an arbitrary property ([background-image:…rgba(…)], [box-shadow:…#fff]). The
// `utility-[` / `[property:` prefixes scope this to className styling, so SVG
// fill="#.."/stroke="rgba()" attributes, inline style={{}} colors, and data
// arrays like ["#fff"] are intentionally NOT matched (canvas/data — handled by
// the exemptions and documented as known limitations in docs/design-system.md).
const arbitraryColorPattern =
	/(?:[a-z][a-z-]*-\[|\[[a-z-]+:)[^\]]*(?:#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\()[^\]]*\]/g;
// Arbitrary type size, e.g. text-[11px] / text-[0.7rem]. Chrome type is the flat
// "text-ui" token (add --text-micro only for a reviewed dense-cell overflow).
const arbitraryTextSizePattern = /text-\[[\d.]+(?:px|rem|em)\]/g;

const errors: string[] = [];

for (const absolutePath of walk(srcRoot)) {
	const repoPath = path
		.relative(repoRoot, absolutePath)
		.split(path.sep)
		.join("/");
	if (!repoPath.endsWith(".tsx")) continue;
	if (isExempt(repoPath)) continue;
	const source = readFileSync(absolutePath, "utf8").replace(
		commentPattern,
		" ",
	);
	for (const match of source.matchAll(arbitraryColorPattern)) {
		errors.push(
			`${repoPath}: literal color in arbitrary value "${match[0]}" — use a semantic token (e.g. text-fg-muted, bg-accent, border-danger, var(--color-warn)) from src/app/styles/index.css.`,
		);
	}
	for (const match of source.matchAll(arbitraryTextSizePattern)) {
		errors.push(
			`${repoPath}: arbitrary type size "${match[0]}" — chrome type is the flat "text-ui" token (add --text-micro only for a reviewed dense-cell overflow).`,
		);
	}
}

if (errors.length > 0) {
	console.error(
		"Design-token check failed. Chrome must consume semantic tokens, not arbitrary values.",
	);
	for (const error of errors) console.error(`- ${error}`);
	process.exit(1);
}

console.log("Design-token check passed.");

function walk(dir: string): string[] {
	return readdirSync(dir).flatMap((entry) => {
		const absolute = path.join(dir, entry);
		const stats = statSync(absolute);
		if (stats.isDirectory()) return walk(absolute);
		if (stats.isFile()) return [absolute];
		return [];
	});
}
