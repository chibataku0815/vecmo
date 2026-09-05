import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { validateAgentDocument } from "@/entities/agent/model/read-only";
import { deserializeMotionDocument } from "@/entities/motion/model/serialization";
import { parseMotionGrammarLayer } from "@/entities/motion-grammar/model/parse";
import { deserializeSceneDocument } from "@/entities/scene/model/serialization";
import { buildExportRenderPresentation } from "@/features/export/model/render-presentation";
import { renderSceneSvgWithIssues } from "@/features/export/model/svg";
import { REFERENCE_SCENE_FIXTURES } from "@/features/reference-scenes/fixtures";
import { REFERENCE_SCENES } from "@/features/reference-scenes/model/registry";
import { TUTORIAL_CONTENT } from "@/features/reference-scenes/model/tutorial-content";

/**
 * Quality gate for the reference-scene fixture library. Bundled scene data has
 * rotted before (the editor still carries `isLegacyDemoSeedDocument` to wipe an
 * out-of-date seeded localStorage doc); a whole library multiplies that risk.
 *
 * Each fixture is run through the SAME runtime deserialize path the editor uses
 * on load, then validated, rendered, and (for motion) checked for liveness, so a
 * fixture that drifts out of the current schema, references a missing node, uses
 * an unrecognized grammar technique, fails to render, or stops animating fails
 * the build instead of silently shipping a broken tutorial. Storing fixtures as
 * serialized strings is what makes this meaningful: a typed object literal would
 * be coerced to the current types at compile time and never trip here.
 */

let failed = false;

const fail = (slug: string, message: string): void => {
	failed = true;
	console.error(`✗ ${slug}: ${message}`);
};

const EXPORT_DEMO_DIR = "public/tutorial-exports";
const MIN_EXPORT_DEMO_HTML_BYTES = 500;
const RUNTIME_IMPORT_SPECIFIER_PATTERN = /from\s+["']\.\/([^"']+)["']/u;

/**
 * Verifies a registry entry's "View export result" gallery affordance points
 * at a real, non-trivial export artifact: the `exportDemo` HTML file exists
 * under `public/tutorial-exports/` and is large enough to be genuine export
 * output (not an empty/truncated write), and the `./<runtime>` sibling its
 * `<script type="module">` imports also exists — so a page that would 404 or
 * fail to mount on open is caught here instead of shipping to the gallery.
 * Does not re-render or execute the artifact; that liveness proof is a
 * dev-server + browser step in the verification ladder, not a static gate.
 */
const checkExportDemo = (slug: string, exportDemo: string): void => {
	const htmlPath = path.join(EXPORT_DEMO_DIR, exportDemo);
	if (!existsSync(htmlPath)) {
		fail(slug, `export-demo HTML is missing: ${htmlPath}`);
		return;
	}
	const htmlBytes = statSync(htmlPath).size;
	if (htmlBytes < MIN_EXPORT_DEMO_HTML_BYTES) {
		fail(
			slug,
			`export-demo HTML at ${htmlPath} is only ${htmlBytes} bytes (expected at least ${MIN_EXPORT_DEMO_HTML_BYTES}) — likely empty or truncated.`,
		);
	}
	const html = readFileSync(htmlPath, "utf8");
	const match = html.match(RUNTIME_IMPORT_SPECIFIER_PATTERN);
	if (!match) {
		fail(
			slug,
			`export-demo HTML at ${htmlPath} has no \`from "./<runtime>"\` module import to verify.`,
		);
		return;
	}
	const runtimeFileName = match[1];
	const runtimePath = path.join(path.dirname(htmlPath), runtimeFileName);
	if (!existsSync(runtimePath)) {
		fail(
			slug,
			`export-demo HTML at ${htmlPath} imports "./${runtimeFileName}", but ${runtimePath} does not exist.`,
		);
	}
};

// Foreign-key integrity: every fixture has a registry entry and vice versa, the
// slugs line up, and each registry entry points at a product-knowledge doc that
// exists. Without this, a renamed slug or a missing how-to ships a card that
// links nowhere or a fixture the gallery never lists.
const fixtureSlugs = new Set(REFERENCE_SCENE_FIXTURES.map((f) => f.slug));
const registrySlugs = new Set(REFERENCE_SCENES.map((s) => s.slug));
const posterFrameBySlug = new Map(
	REFERENCE_SCENES.map((s) => [s.slug, s.posterFrame]),
);
const tutorialContentBySlug = new Map(
	TUTORIAL_CONTENT.map((entry) => [entry.slug, entry]),
);
const MIN_TUTORIAL_STEPS = 3;

for (const fixture of REFERENCE_SCENE_FIXTURES) {
	if (!registrySlugs.has(fixture.slug)) {
		fail(
			fixture.slug,
			"fixture has no matching registry entry (REFERENCE_SCENES).",
		);
	}
}
for (const meta of REFERENCE_SCENES) {
	if (!fixtureSlugs.has(meta.slug)) {
		fail(meta.slug, "registry entry has no matching fixture.");
	}
	const docPath = `docs/product-knowledge/${meta.productKnowledge}`;
	if (!existsSync(docPath)) {
		fail(meta.slug, `product-knowledge doc is missing: ${docPath}`);
	}

	checkExportDemo(meta.slug, meta.exportDemo);

	// The gallery's tutorial content (goal + steps) is a second FK off the same
	// registry slug — a scene without real step copy is not actually a tutorial,
	// just a browsable preview, so this is checked as strictly as the fixture/doc
	// pairing above.
	const tutorial = tutorialContentBySlug.get(meta.slug);
	if (!tutorial) {
		fail(meta.slug, "registry entry has no matching TUTORIAL_CONTENT entry.");
		continue;
	}
	if (tutorial.goal.trim().length === 0) {
		fail(meta.slug, "tutorial content has an empty goal.");
	}
	if (
		!Number.isInteger(tutorial.estimatedMinutes) ||
		tutorial.estimatedMinutes < 1
	) {
		fail(
			meta.slug,
			`tutorial estimatedMinutes must be an integer >= 1, got ${tutorial.estimatedMinutes}.`,
		);
	}
	if (tutorial.steps.length < MIN_TUTORIAL_STEPS) {
		fail(
			meta.slug,
			`tutorial content has ${tutorial.steps.length} step(s), needs at least ${MIN_TUTORIAL_STEPS}.`,
		);
	}
	tutorial.steps.forEach((step, index) => {
		if (step.title.trim().length === 0) {
			fail(meta.slug, `tutorial step ${index + 1} has an empty title.`);
		}
		if (step.detail.trim().length === 0) {
			fail(meta.slug, `tutorial step ${index + 1} has an empty detail.`);
		}
	});
}
for (const tutorial of TUTORIAL_CONTENT) {
	if (!registrySlugs.has(tutorial.slug)) {
		fail(
			tutorial.slug,
			"TUTORIAL_CONTENT entry has no matching registry entry (REFERENCE_SCENES).",
		);
	}
}

for (const fixture of REFERENCE_SCENE_FIXTURES) {
	const sceneResult = deserializeSceneDocument(fixture.sceneEnvelope);
	if (sceneResult.status === "failed") {
		fail(
			fixture.slug,
			`scene failed to deserialize (${sceneResult.issues.map((issue) => issue.code).join(", ")}).`,
		);
		continue;
	}

	const motionResult = deserializeMotionDocument(fixture.motionEnvelope);
	if (motionResult.status === "failed") {
		fail(
			fixture.slug,
			`motion failed to deserialize (${motionResult.issues.map((issue) => issue.code).join(", ")}).`,
		);
		continue;
	}

	const { grammar: serializedGrammar, ...motion } = motionResult.document;
	const parsed = parseMotionGrammarLayer(serializedGrammar);

	// The grammar layer must parse cleanly. Unrecognized techniques are preserved
	// as `passthrough` and excluded from `bindings`, so they would silently slip
	// past the motion-liveness check below — fail instead, so a typo or a removed
	// technique cannot ship as a flat, unrecognized binding.
	if (parsed.issues.length > 0) {
		fail(
			fixture.slug,
			`motion-grammar parse issues: ${parsed.issues.map((issue) => `${issue.code} (${issue.bindingId})`).join(", ")}.`,
		);
	}
	if (parsed.passthrough.length > 0) {
		fail(
			fixture.slug,
			`motion-grammar has ${parsed.passthrough.length} unrecognized (passthrough) binding(s) — an unknown or removed technique.`,
		);
	}

	const report = validateAgentDocument({
		scene: sceneResult.document,
		motion,
		grammar: { bindings: parsed.bindings, passthrough: parsed.passthrough },
	});

	const errorCount = report.data?.summary.errorCount ?? 0;
	if (errorCount > 0) {
		const detail = report.issues
			.filter((issue) => issue.severity === "error")
			.map((issue) => `${issue.code}: ${issue.message}`)
			.join("\n    ");
		fail(fixture.slug, `failed document validation:\n    ${detail}`);
	}

	// The poster MUST render — for every scene, motion or static. A render failure
	// would otherwise ship a blank gallery thumbnail. Look effects the SVG can only
	// approximate are surfaced as a non-fatal warning (the editor renders them
	// fully); only a hard render failure fails the build.
	const posterFrame = posterFrameBySlug.get(fixture.slug) ?? 0;
	try {
		const poster = renderSceneSvgWithIssues({
			scene: sceneResult.document,
			motion,
			frame: posterFrame,
			grammarBindings: parsed.bindings,
		});
		if (poster.contents.length < 100) {
			fail(
				fixture.slug,
				`poster render produced an empty/invalid SVG at frame ${posterFrame}.`,
			);
		}
		if (poster.issues.length > 0) {
			console.warn(
				`  ⚠ ${fixture.slug}: SVG poster approximates ${poster.issues.length} look effect(s); the editor renders them fully.`,
			);
		}
	} catch (error) {
		fail(
			fixture.slug,
			`poster render failed at frame ${posterFrame}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	// A grammar-bearing fixture must actually animate. Sample the scene at a few
	// frames through the real export pipeline and require the rendered geometry to
	// change; this turns a future evaluator regression (a renamed, disabled, or
	// no-longer-moving technique) into a build failure instead of a silently flat
	// tutorial — schema validation alone would not catch a fixture that stopped
	// moving. Comparison is over the sampled layers, not the SVG string, because
	// the SVG embeds the frame number and would always differ even when static.
	if (parsed.bindings.length > 0) {
		const frames = [0, 11, 23, 37];
		try {
			const snapshots = frames.map((frame) =>
				JSON.stringify(
					buildExportRenderPresentation({
						scene: sceneResult.document,
						motion,
						frame,
						grammarBindings: parsed.bindings,
					}).scene.layers,
				),
			);
			if (new Set(snapshots).size <= 1) {
				fail(
					fixture.slug,
					`has ${parsed.bindings.length} motion-grammar binding(s) but the sampled scene is identical across frames ${frames.join("/")} — the motion is not animating.`,
				);
			}
		} catch (error) {
			fail(
				fixture.slug,
				`failed to sample with grammar bindings: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
}

if (failed) {
	console.error("");
	console.error("Reference-scenes check failed.");
	console.error(
		"A reference scene drifted out of the current schema, references a missing node, uses an unrecognized grammar technique, lost its registry/doc link, failed to render, or no longer animates. Re-author it (gen:reference-scenes) or fix the underlying model.",
	);
	process.exit(1);
}

const count = REFERENCE_SCENE_FIXTURES.length;
console.log(
	`Reference-scenes check passed (${count} ${count === 1 ? "scene" : "scenes"}).`,
);
