/**
 * Writes the committed generated runtime-sampler modules (full + core). Run after
 * changing a sampler entry or any module in its pure dependency graph:
 *
 *   bun run gen:runtime-sampler
 *
 * `bun run check` (via `check:runtime-sampler`) fails if a committed module is
 * stale, so this never silently drifts.
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import {
	bundleRuntimeSamplerSource,
	RUNTIME_SAMPLER_BUNDLES,
	renderGeneratedModule,
} from "./runtime-sampler-bundle";

for (const bundle of RUNTIME_SAMPLER_BUNDLES) {
	const iifeSource = await bundleRuntimeSamplerSource(bundle.entry);
	const moduleSource = renderGeneratedModule(iifeSource, bundle);
	writeFileSync(bundle.generatedFile, moduleSource, "utf8");
	console.log(
		`Generated ${path.relative(process.cwd(), bundle.generatedFile)} (${(
			moduleSource.length / 1024
		).toFixed(1)}KB).`,
	);
}
