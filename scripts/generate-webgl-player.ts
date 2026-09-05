/**
 * Writes the committed browser-runtime bundle used by webgl-player JS exports.
 *
 * Run after changing the WebGL player runtime entry or its browser dependency graph:
 *
 *   bun scripts/generate-webgl-player.ts
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import {
	bundleWebglPlayerSource,
	renderGeneratedWebglPlayerModule,
	WEBGL_PLAYER_GENERATED_FILE,
} from "./webgl-player-bundle";

const iifeSource = await bundleWebglPlayerSource();
const moduleSource = renderGeneratedWebglPlayerModule(iifeSource);
writeFileSync(WEBGL_PLAYER_GENERATED_FILE, moduleSource, "utf8");

console.log(
	`Generated ${path.relative(process.cwd(), WEBGL_PLAYER_GENERATED_FILE)} (${(
		moduleSource.length / 1024
	).toFixed(1)}KB).`,
);
