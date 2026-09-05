/**
 * Freshness gate for the committed runtime-sampler bundles (full + core). Re-bundles
 * each sampler entry from source and compares it to the committed generated module;
 * fails if any differ so the motion/code export can never ship a stale or
 * hand-edited sampler that drifts from the editor.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
	bundleRuntimeSamplerSource,
	RUNTIME_SAMPLER_BUNDLES,
	renderGeneratedModule,
} from "./runtime-sampler-bundle";

let failed = false;

for (const bundle of RUNTIME_SAMPLER_BUNDLES) {
	const relative = path.relative(process.cwd(), bundle.generatedFile);
	if (!existsSync(bundle.generatedFile)) {
		console.error("Runtime-sampler check failed.");
		console.error(`Missing ${relative}. Run: bun run gen:runtime-sampler`);
		failed = true;
		continue;
	}
	const expected = renderGeneratedModule(
		await bundleRuntimeSamplerSource(bundle.entry),
		bundle,
	);
	const actual = readFileSync(bundle.generatedFile, "utf8");
	if (expected !== actual) {
		console.error("Runtime-sampler check failed.");
		console.error(
			`${relative} is out of date with the sampler source. Run: bun run gen:runtime-sampler`,
		);
		failed = true;
	}
}

if (failed) process.exit(1);

console.log("Runtime-sampler check passed.");
