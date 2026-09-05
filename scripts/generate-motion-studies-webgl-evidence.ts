/**
 * Generates a standalone browser harness for Motion Studies WebGL evidence.
 *
 * The harness uses the same candidate fixture as the selected structural
 * packet, packages it through the maintained WebGL export path, and exposes a
 * small window-level result object for a real browser to record. It is an
 * evidence adapter, not a product runtime or a test suite.
 *
 * Usage:
 *   bun scripts/generate-motion-studies-webgl-evidence.ts /tmp/vecmo-webgl-evidence random
 *   bun scripts/generate-motion-studies-webgl-evidence.ts /tmp/vecmo-webgl-evidence count-growth
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createCountGrowthCandidateFixture } from "../src/entities/motion-grammar/model/count-growth-candidate-fixture";
import { createRandomPulseCandidateFixture } from "../src/entities/motion-grammar/model/random-pulse-candidate-fixture";
import { createExportBundle } from "../src/features/export/model/bundle";
import { exportOptimizationOptionsForProfile } from "../src/features/export/model/optimization";
import {
	createWebglPlayerExportAssets,
	type WebglPlayerRuntimeAsset,
} from "../src/features/export/model/webgl-player";

const outputDirectory = path.resolve(
	process.argv[2] ?? "artifacts/motion-studies-webgl-evidence-20260716",
);
const studyId = process.argv[3] ?? "random";
const study =
	studyId === "count-growth"
		? {
				label: "Count Growth",
				fileStem: "motion-studies-count-growth",
				criticalFrames: [0, 6, 12, 24, 45, 60, 90, 119] as const,
				fixture: createCountGrowthCandidateFixture(),
			}
		: studyId === "random"
			? {
					label: "Random Pulse",
					fileStem: "motion-studies-random-pulse",
					criticalFrames: [0, 6, 12, 24, 45, 70, 71] as const,
					fixture: createRandomPulseCandidateFixture(),
				}
			: null;

if (!study) {
	throw new Error(
		`Unknown Motion Studies WebGL evidence study '${studyId}'. Use 'random' or 'count-growth'.`,
	);
}

const { fileStem, label, criticalFrames, fixture } = study;
const bundle = createExportBundle({
	scene: fixture.scene,
	motion: fixture.motion,
	frame: 0,
	grammarBindings: fixture.bindings,
});
const assets = createWebglPlayerExportAssets(bundle, fixture.bindings, {
	fileStem,
	optimization: exportOptimizationOptionsForProfile("editable"),
});
const runtime = assets.find(
	(asset): asset is WebglPlayerRuntimeAsset =>
		asset.kind === "webgl-runtime-js",
);
if (!runtime) {
	throw new Error(
		"The WebGL evidence package did not emit an embedded runtime.",
	);
}

const exportSurfaceEvidence = bundle.assets
	.filter((asset) => asset.kind === "svg" || asset.kind === "pdf")
	.map((asset) => ({
		kind: asset.kind,
		fileName: asset.fileName,
		mimeType: asset.mimeType,
		byteLength: new TextEncoder().encode(asset.contents).byteLength,
		issues:
			"issues" in asset && Array.isArray(asset.issues) ? asset.issues : [],
	}));

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Motion Studies ${label} WebGL evidence</title>
    <style>
      html, body { margin: 0; min-height: 100%; background: #f4f3ef; }
      body { display: grid; place-items: center; }
      #player { width: min(92vw, 520px); aspect-ratio: 520 / 360; }
      #player > canvas { display: block; width: 100%; height: auto; }
      #status { position: fixed; inset: 8px auto auto 8px; font: 12px monospace; white-space: pre; }
    </style>
  </head>
  <body>
    <div id="status">pending</div>
    <div id="player" aria-label="Motion Studies ${label} WebGL evidence"></div>
    <script type="module">
      import { mountVectorMotionWebglPlayer } from "./${runtime.fileName}";

      const requestedFrames = ${JSON.stringify(criticalFrames)};
      const status = document.getElementById("status");
      const container = document.getElementById("player");
      const record = (value) => {
        window.__motionStudiesWebglEvidence = value;
        status.textContent = JSON.stringify(value, null, 2);
        document.documentElement.dataset.state = value.status;
      };

      try {
        const player = await mountVectorMotionWebglPlayer(container, { autoplay: false });
        const canvas = container.querySelector("canvas");
        const gl = canvas?.getContext("webgl2") ?? canvas?.getContext("webgl");
        const samples = [];
        for (const requestedFrame of requestedFrames) {
          const result = await player.seekFrame(requestedFrame);
          samples.push({
            requestedFrame,
            status: result.status,
            committedFrame: result.status === "committed" ? result.snapshot.frame : null,
            revision: result.status === "committed" ? result.snapshot.revision : null,
          });
        }
        record({
          status: "ready",
          renderer: player.renderer,
          durationFrames: player.durationFrames,
          fps: player.fps,
          canvas: canvas ? { width: canvas.width, height: canvas.height } : null,
          webgl: gl ? {
            version: gl.getParameter(gl.VERSION),
            shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
            renderer: gl.getParameter(gl.RENDERER),
            vendor: gl.getParameter(gl.VENDOR),
          } : null,
          samples,
        });
        player.dispose();
      } catch (error) {
        record({
          status: "failed",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    </script>
  </body>
</html>
`;

mkdirSync(outputDirectory, { recursive: true });
for (const asset of assets) {
	writeFileSync(
		path.join(outputDirectory, asset.fileName),
		asset.contents,
		"utf8",
	);
}
writeFileSync(path.join(outputDirectory, "index.html"), html, "utf8");
writeFileSync(
	path.join(outputDirectory, "generation.json"),
	JSON.stringify(
		{
			studyId,
			fixture: fixture.scene.id,
			fileStem,
			criticalFrames,
			exportSurfaceEvidence,
			runtime: runtime.fileName,
			assetKinds: assets.map((asset) => asset.kind),
			artboard: {
				width: fixture.scene.artboard.width,
				height: fixture.scene.artboard.height,
				durationFrames: fixture.motion.durationFrames,
				fps: fixture.motion.fps,
			},
		},
		null,
		2,
	),
	"utf8",
);

console.log(`Generated ${path.relative(process.cwd(), outputDirectory)}.`);
