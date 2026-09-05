#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const requiredFiles = [
	".codex/config.toml",
	".codex/hooks/restore-working-state.mjs",
	"docs/current/WORKING_STATE.md",
];
const requiredHeadings = [
	"## Authority",
	"## Repository snapshot",
	"## Current objective",
	"## Confirmed decisions",
	"## Evidence and canonical links",
	"## Open gates",
	"## Next action",
	"## Verification status",
	"## Handoff discipline",
];
const requiredAuthorityLinks = [
	"AGENTS.md",
	"docs/codemap.md",
	"docs/plans/README.md",
	"docs/progress/README.md",
];
const errors = [];

for (const file of requiredFiles) {
	try {
		readFileSync(path.join(repoRoot, file), "utf8");
	} catch {
		errors.push(`Missing required continuity file: ${file}`);
	}
}

if (errors.length === 0) {
	const config = read(".codex/config.toml");
	const workingState = read("docs/current/WORKING_STATE.md");
	const hook = read(".codex/hooks/restore-working-state.mjs");
	const workingStateLines = workingState.split(/\r?\n/).length;

	if (!config.includes("[[hooks.SessionStart]]")) {
		errors.push("SessionStart is not configured in .codex/config.toml.");
	}
	if (!/^\s*hooks\s*=\s*true\s*$/m.test(config)) {
		errors.push("Repository lifecycle hooks are not enabled.");
	}
	if (!config.includes("startup|resume|compact")) {
		errors.push(
			"SessionStart must cover startup, resume, and compact sources.",
		);
	}
	if (/^\s*model_auto_compact_token_limit\s*=/m.test(config)) {
		errors.push(
			"Do not pin model_auto_compact_token_limit without measured repository evidence.",
		);
	}
	if (!config.includes("restore-working-state.mjs")) {
		errors.push("SessionStart does not invoke the restoration hook.");
	}
	if (!hook.includes('hookEventName: "SessionStart"')) {
		errors.push("The restoration hook does not emit SessionStart context.");
	}
	if (workingStateLines > 120) {
		errors.push(
			`WORKING_STATE.md is ${workingStateLines} lines; the limit is 120.`,
		);
	}
	for (const heading of requiredHeadings) {
		if (!workingState.includes(heading)) {
			errors.push(`WORKING_STATE.md is missing required heading: ${heading}`);
		}
	}
	for (const authorityLink of requiredAuthorityLinks) {
		if (!workingState.includes(authorityLink)) {
			errors.push(
				`WORKING_STATE.md is missing authority link: ${authorityLink}`,
			);
		}
	}
}

if (errors.length > 0) {
	console.error("Continuity-harness check failed.");
	for (const error of errors) console.error(`- ${error}`);
	process.exit(1);
}

console.log("Continuity-harness check passed.");

function read(relativePath) {
	return readFileSync(path.join(repoRoot, relativePath), "utf8");
}
