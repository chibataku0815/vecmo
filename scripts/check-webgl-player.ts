/**
 * Freshness gate for the committed WebGL player bundle. Re-bundles the browser
 * entry and fails when the generated module no longer matches its dependency graph.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
	bundleWebglPlayerSource,
	renderGeneratedWebglPlayerModule,
	WEBGL_PLAYER_GENERATED_FILE,
} from "./webgl-player-bundle";

const relative = path.relative(process.cwd(), WEBGL_PLAYER_GENERATED_FILE);
if (!existsSync(WEBGL_PLAYER_GENERATED_FILE)) {
	console.error("WebGL-player check failed.");
	console.error(
		`Missing ${relative}. Run: bun scripts/generate-webgl-player.ts`,
	);
	process.exit(1);
}

const expected = renderGeneratedWebglPlayerModule(
	await bundleWebglPlayerSource(),
);
const actual = readFileSync(WEBGL_PLAYER_GENERATED_FILE, "utf8");
if (expected !== actual) {
	console.error("WebGL-player check failed.");
	console.error(
		`${relative} is out of date. Run: bun scripts/generate-webgl-player.ts`,
	);
	process.exit(1);
}

console.log("WebGL-player check passed.");
