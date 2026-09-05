import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const errors: string[] = [];

if (args.includes("--help") || args.includes("-h")) {
	printUsage();
	process.exit(0);
}

if (args.length !== 1) {
	errors.push("Provide exactly one sample-production brief path.");
} else {
	preflight(args[0]);
}

if (errors.length > 0) {
	console.error("Sample-production preflight failed.");
	for (const error of errors) console.error(`- ${error}`);
	console.error(
		"Repair the recorded source selection or contract before mutating scene or motion data. This sensor does not grant aesthetic acceptance.",
	);
	process.exit(1);
}

console.log("Sample-production preflight passed.");
console.log(
	"Recorded source-selection, visual-kit admission, and visual-lock checks passed; user pixel review remains required.",
);

/**
 * Verifies the recorded boundaries that keep a sample from becoming an
 * unbounded colour, material, or complex-shape exploration. The script checks
 * only the explicit contracts; it never infers beauty or substitutes for the
 * user's selection or aesthetic decision.
 */
function preflight(briefArgument: string): void {
	const briefPath = resolveRepoPath(briefArgument, "sample brief");
	if (!briefPath) return;
	const briefSource = readMarkdown(briefPath, "sample brief");
	if (!briefSource) return;

	const brief = parseFrontMatter(briefSource, toRepoPath(briefPath));
	if (!brief) return;

	requireFrontMatterValues(brief, toRepoPath(briefPath), [
		"sample_id",
		"status",
		"sample_lane",
		"visual_kit",
		"visual_kit_approval_id",
		"visual_kit_scope",
		"producer",
		"review_authority",
	]);

	if (brief.get("sample_lane") !== "sample-production") {
		errors.push(
			`${toRepoPath(briefPath)}: sample_lane must be "sample-production". Use the visual-foundation lane instead when colour, material, or shape work is still open.`,
		);
	}
	if (brief.get("review_authority") !== "user") {
		errors.push(
			`${toRepoPath(briefPath)}: review_authority must be "user"; a producer cannot accept its own visual result.`,
		);
	}

	requireSections(briefSource, toRepoPath(briefPath), [
		"Purpose",
		"Motion Concept",
		"Visual Lock",
		"First Artifact Packet",
		"Review Contract",
		"Capability Escape Hatch",
		"Producer Declaration",
	]);
	requireLabeledValues(briefSource, toRepoPath(briefPath), [
		"Feature / motion goal",
		"Viewer sentence",
		"Motion thesis",
		"Signature law",
		"Permitted sample axis",
		"Frozen controls",
		"Opening still",
		"Decisive pose",
		"Terminal pose",
		"Pixel-only review packet",
		"Final acceptance authority",
		"Missing capability",
		"If discovered during production",
		"Producer declaration",
	]);

	const allowedVisualChange = labeledValue(
		briefSource,
		"Allowed visual change",
	);
	if (allowedVisualChange !== "none") {
		errors.push(
			`${toRepoPath(briefPath)}: "Allowed visual change" must be exactly "none". Revise the visual kit in the visual-foundation lane instead.`,
		);
	}
	const finalAuthority = labeledValue(
		briefSource,
		"Final acceptance authority",
	);
	if (finalAuthority !== "user") {
		errors.push(
			`${toRepoPath(briefPath)}: "Final acceptance authority" must be "user".`,
		);
	}
	const capabilityAction = labeledValue(
		briefSource,
		"If discovered during production",
	);
	if (!capabilityAction?.includes("capability_blocked")) {
		errors.push(
			`${toRepoPath(briefPath)}: the capability escape hatch must explicitly use "capability_blocked".`,
		);
	}

	const visualKitPath = brief.get("visual_kit");
	if (!visualKitPath || isPlaceholder(visualKitPath)) return;
	const kitPath = resolveRepoPath(visualKitPath, "visual kit");
	if (!kitPath) return;
	const kitSource = readMarkdown(kitPath, "visual kit");
	if (!kitSource) return;
	const kit = parseFrontMatter(kitSource, toRepoPath(kitPath));
	if (!kit) return;

	requireFrontMatterValues(kit, toRepoPath(kitPath), [
		"visual_kit_id",
		"status",
		"user_approval_id",
		"source_selection_card",
		"accepted_scope",
		"approval_evidence",
		"frozen_palette_roles",
		"frozen_material_roles",
		"frozen_carrier_set",
	]);
	requireSections(kitSource, toRepoPath(kitPath), [
		"Visual Thesis",
		"Reference Selection Evidence",
		"Locked Visual Roles",
		"Evidence Packet",
		"Scope And Freeze",
		"User Decision",
	]);
	requireLabeledValues(kitSource, toRepoPath(kitPath), [
		"Viewer sentence",
		"Quality thesis",
		"Signature law",
		"Fit-scale legibility claim",
		"Quality nucleus carried forward",
		"Authored distinction carried forward",
		"Carrier simplicity carried forward",
		"Material-primary relation carried forward",
		"Native ownership / permitted reduction carried forward",
		"Intentional loss boundary",
		"Material causal chain",
		"Permitted carrier set",
		"Forbidden carrier / representation moves",
		"Opening or object still",
		"Known rejected comparison or automatic rejectors",
		"Included sample behaviours",
		"Excluded uses",
		"Frozen composition facts",
		"User disposition",
		"User decision note",
		"Acceptance date",
	]);

	const selectionCardValue = kit.get("source_selection_card");
	if (selectionCardValue && !isPlaceholder(selectionCardValue)) {
		const selectionCardPath = resolveRepoPath(
			selectionCardValue,
			"source selection card",
		);
		if (selectionCardPath) {
			const selectionSource = readMarkdown(
				selectionCardPath,
				"source selection card",
			);
			if (selectionSource) {
				const selection = parseFrontMatter(
					selectionSource,
					toRepoPath(selectionCardPath),
				);
				if (selection) {
					requireFrontMatterValues(selection, toRepoPath(selectionCardPath), [
						"selection_id",
						"selection_status",
						"source_url_or_user_asset",
						"source_kind",
						"review_scope",
						"carrier_complexity_disposition",
						"quality_primary_disposition",
						"classification",
						"design_specificity_disposition",
						"selection_decision",
						"user_disposition",
						"next_permitted_action",
					]);
					requireSections(selectionSource, toRepoPath(selectionCardPath), [
						"Visible Quality Nucleus",
						"Representation Audit",
						"Carrier And Material Direction",
						"Design Specificity Audit",
						"Classification",
						"User Gate",
					]);
					requireLabeledValues(selectionSource, toRepoPath(selectionCardPath), [
						"Viewer sentence",
						"Load-bearing observations",
						"Quality nucleus",
						"Excluded generic readings",
						"No-copy boundary",
						"Minimum first proof",
						"Current native owners",
						"Required representation not currently owned",
						"Permitted reduction",
						"Loss boundary",
						"Forbidden substitute",
						"Carrier simplicity",
						"Material quality nucleus",
						"Named material owners",
						"Geometry escalation boundary",
						"First-read hierarchy",
						"Authored distinction",
						"Exchangeability test",
						"Template read to avoid",
						"Decision evidence",
						"User note",
					]);
					if (selection.get("selection_status") !== "candidate_direction") {
						errors.push(
							`${toRepoPath(selectionCardPath)}: selection_status must be "candidate_direction" before a visual kit can consume it.`,
						);
					}
					if (
						selection.get("classification") !== "direct_native" &&
						selection.get("classification") !== "bounded_native_approximation"
					) {
						errors.push(
							`${toRepoPath(selectionCardPath)}: classification must be "direct_native" or "bounded_native_approximation"; capability_blocked sources cannot enter a visual kit.`,
						);
					}
					if (selection.get("design_specificity_disposition") !== "distinct") {
						errors.push(
							`${toRepoPath(selectionCardPath)}: design_specificity_disposition must be "distinct"; generic_rejected sources cannot enter a visual kit.`,
						);
					}
					const carrierDisposition = selection.get(
						"carrier_complexity_disposition",
					);
					if (
						carrierDisposition !== "simple_primitive" &&
						carrierDisposition !== "user_approved_complex_contour"
					) {
						errors.push(
							`${toRepoPath(selectionCardPath)}: carrier_complexity_disposition must be "simple_primitive" or "user_approved_complex_contour"; complex_carrier_rejected sources cannot enter a visual kit.`,
						);
					}
					const qualityDisposition = selection.get(
						"quality_primary_disposition",
					);
					if (
						qualityDisposition !== "material_first" &&
						qualityDisposition !== "user_approved_composition_primary"
					) {
						errors.push(
							`${toRepoPath(selectionCardPath)}: quality_primary_disposition must be "material_first" or "user_approved_composition_primary"; composition_primary_rejected sources cannot enter a visual kit.`,
						);
					}
					if (
						selection.get("source_kind") ===
							"agent_found_with_user_permission" &&
						carrierDisposition !== "simple_primitive"
					) {
						errors.push(
							`${toRepoPath(selectionCardPath)}: an agent-found source must use "simple_primitive" carrier complexity unless the user supplied an explicit complex-contour direction.`,
						);
					}
					if (
						selection.get("source_kind") ===
							"agent_found_with_user_permission" &&
						qualityDisposition !== "material_first"
					) {
						errors.push(
							`${toRepoPath(selectionCardPath)}: an agent-found source must be "material_first" unless the user supplied an explicit composition-primary direction.`,
						);
					}
					const selectionDecision = selection.get("selection_decision");
					const materialCalibrationAdmission =
						selection.get("reference_role") === "material_calibration" &&
						selectionDecision === "prepare_material_first_brief";
					if (
						selectionDecision !== "present_as_candidate_direction" &&
						!materialCalibrationAdmission
					) {
						errors.push(
							`${toRepoPath(selectionCardPath)}: selection_decision must be "present_as_candidate_direction" before a visual kit can consume it; only reference_role "material_calibration" may instead use "prepare_material_first_brief".`,
						);
					}
					if (selection.get("user_disposition") !== "selected") {
						errors.push(
							`${toRepoPath(selectionCardPath)}: user_disposition must be "selected" before a visual kit can consume it.`,
						);
					}
				}
			}
		}
	}
	if (kit.get("status") !== "user_accepted") {
		errors.push(
			`${toRepoPath(kitPath)}: status must be "user_accepted" before a sample can consume this kit. A draft or producer-approved kit stays in visual foundation.`,
		);
	}
	if (labeledValue(kitSource, "User disposition") !== "accepted") {
		errors.push(
			`${toRepoPath(kitPath)}: "User disposition" must be "accepted" before a sample can consume this kit.`,
		);
	}
	if (brief.get("visual_kit_approval_id") !== kit.get("user_approval_id")) {
		errors.push(
			`${toRepoPath(briefPath)}: visual_kit_approval_id must exactly match ${toRepoPath(kitPath)} user_approval_id.`,
		);
	}
	if (brief.get("visual_kit_scope") !== kit.get("accepted_scope")) {
		errors.push(
			`${toRepoPath(briefPath)}: visual_kit_scope must exactly match ${toRepoPath(kitPath)} accepted_scope; do not broaden an approval by implication.`,
		);
	}
}

function printUsage(): void {
	console.log(`Usage: bun run sample:preflight -- <sample-production-brief.md>

Validates a recorded sample-production contract, source-selection feasibility, and visual-kit admission.
It does not judge pixels or grant user acceptance.`);
}

function resolveRepoPath(value: string, label: string): string | undefined {
	if (isPlaceholder(value)) {
		errors.push(`${label} path is missing or still a placeholder.`);
		return undefined;
	}
	const absolutePath = path.resolve(repoRoot, value);
	const relativePath = path.relative(repoRoot, absolutePath);
	if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
		errors.push(`${label} path must stay inside the repository: ${value}.`);
		return undefined;
	}
	if (!existsSync(absolutePath)) {
		errors.push(`${label} file does not exist: ${toRepoPath(absolutePath)}.`);
		return undefined;
	}
	return absolutePath;
}

function readMarkdown(filePath: string, label: string): string | undefined {
	if (!filePath.endsWith(".md")) {
		errors.push(`${label} must be a Markdown file: ${toRepoPath(filePath)}.`);
		return undefined;
	}
	try {
		return readFileSync(filePath, "utf8");
	} catch (error) {
		errors.push(
			`${label} could not be read (${toRepoPath(filePath)}): ${errorMessage(error)}.`,
		);
		return undefined;
	}
}

function parseFrontMatter(
	source: string,
	repoPath: string,
): Map<string, string> | undefined {
	const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
	if (!match) {
		errors.push(`${repoPath}: Markdown front matter is required.`);
		return undefined;
	}

	const values = new Map<string, string>();
	for (const line of match[1].split(/\r?\n/)) {
		if (!line.trim() || line.trimStart().startsWith("#")) continue;
		const field = line.match(/^([a-z][a-z0-9_]*):\s*(.*?)\s*$/i);
		if (!field) {
			errors.push(`${repoPath}: front-matter line is not key: value: ${line}.`);
			continue;
		}
		const key = field[1];
		if (values.has(key)) {
			errors.push(`${repoPath}: duplicate front-matter key: ${key}.`);
			continue;
		}
		values.set(key, stripWrappingQuotes(field[2]));
	}
	return values;
}

function requireFrontMatterValues(
	values: ReadonlyMap<string, string>,
	repoPath: string,
	keys: readonly string[],
): void {
	for (const key of keys) {
		const value = values.get(key);
		if (!value || isPlaceholder(value)) {
			errors.push(`${repoPath}: front-matter value "${key}" is required.`);
		}
	}
}

function requireSections(
	source: string,
	repoPath: string,
	sections: readonly string[],
): void {
	const found = new Set(
		Array.from(source.matchAll(/^##\s+(.+?)\s*$/gm), (match) =>
			match[1].trim().toLowerCase(),
		),
	);
	for (const section of sections) {
		if (!found.has(section.toLowerCase())) {
			errors.push(`${repoPath}: required section "${section}" is missing.`);
		}
	}
}

function requireLabeledValues(
	source: string,
	repoPath: string,
	labels: readonly string[],
): void {
	for (const label of labels) {
		const value = labeledValue(source, label);
		if (!value || isPlaceholder(value)) {
			errors.push(`${repoPath}: labeled value "${label}" is required.`);
		}
	}
}

function labeledValue(source: string, label: string): string | undefined {
	const expression = new RegExp(
		`^[\\t ]*[-*][\\t ]+\\*\\*${escapeRegExp(label)}:\\*\\*[\\t ]*([^\\r\\n]*?)[\\t ]*\\r?$`,
		"im",
	);
	const match = source.match(expression);
	const value = match?.[1]?.trim();
	return value ? stripWrappingQuotes(value) : undefined;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripWrappingQuotes(value: string): string {
	return value.trim().replace(/^(["'`])(.+)\1$/u, "$2");
}

function isPlaceholder(value: string): boolean {
	const normalized = value.trim().toLowerCase();
	return (
		normalized.length === 0 ||
		normalized === "tbd" ||
		normalized === "pending" ||
		normalized === "draft" ||
		/^<[^>]+>$/.test(normalized)
	);
}

function toRepoPath(absolutePath: string): string {
	return path.relative(repoRoot, absolutePath).split(path.sep).join("/");
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
