import { existsSync } from "node:fs";
import { access, readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MOTION_GRAMMAR_TECHNIQUE_DISPOSITION } from "../src/entities/motion-grammar/model/authoring-capabilities";
import { authorableTechniqueIds } from "../src/entities/motion-grammar/model/catalog";
import { MOTION_GRAMMAR_TECHNIQUE_IDS } from "../src/entities/motion-grammar/model/types";
import {
	BINDABLE_PROPERTY_CAPABILITY_BY_ID,
	EFFECT_DESCRIPTOR_AUTHORING_CAPABILITY_BY_ID,
} from "../src/entities/scene/model/authoring-capabilities";
import { BINDABLE_PROPERTY_DESCRIPTORS } from "../src/entities/scene/model/bindable-property";
import { EFFECT_CAPABILITY_DESCRIPTORS } from "../src/entities/scene/model/effect-capabilities";
import { PROJECT_GUI_AUTHORING_LIMITATIONS } from "../src/features/project-backup/model/authoring-compatibility";
import {
	AUTHORING_EVIDENCE_SURFACES,
	AUTHORING_ORTHOGONAL_DIMENSIONS,
	expandAuthoringGapGroups,
} from "../src/shared/authoring-capability/model";
import {
	AUTHORING_CAPABILITY_MANIFESTS,
	AUTHORING_ORTHOGONAL_EVIDENCE,
	AUTHORING_OUTPUT_EVIDENCE,
	AUTHORING_PARITY_GAP_GROUPS,
	AUTHORING_SURFACE_EVIDENCE,
	COMPOUND_AUTHORING_WORKFLOWS,
} from "./authoring-parity/evidence";

type Baseline = {
	readonly counts: {
		readonly boundedInventoryCapabilityIds: number;
		readonly gapGroups: number;
		readonly totalAtomicGapKeys: number;
	};
	readonly capabilityIds: Readonly<Record<string, readonly string[]>>;
	readonly gapGroups: readonly {
		readonly capabilityId: string;
		readonly surfaces: readonly string[];
		readonly checkIds: readonly string[];
	}[];
};

type Issue = {
	readonly code: string;
	readonly message: string;
};

const baselinePath = fileURLToPath(
	new URL(
		"../docs/progress/gui-model-authoring-parity-phase-0-baseline.json",
		import.meta.url,
	),
);
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

// The public open-source tree ships without docs/progress/ (internal records
// stay in the private deployment repo): treat absence as a no-op pass.
if (!existsSync(baselinePath)) {
	console.log(
		`Notice: ${baselinePath} not found; skipping authoring-parity check.`,
	);
	process.exit(0);
}

const baseline = JSON.parse(await readFile(baselinePath, "utf8")) as Baseline;
const issues: Issue[] = [];

const reportIssue = (code: string, message: string): void => {
	issues.push({ code, message });
};

const readTypeScriptSourceCorpus = async (
	relativeRoot: string,
): Promise<string> => {
	const absoluteRoot = resolve(repositoryRoot, relativeRoot);
	const sourceFiles: string[] = [];
	const visit = async (directory: string): Promise<void> => {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = resolve(directory, entry.name);
			if (entry.isDirectory()) {
				await visit(path);
				continue;
			}
			if (
				entry.isFile() &&
				entry.name.endsWith(".ts") &&
				!entry.name.endsWith(".test.ts") &&
				!entry.name.endsWith(".test-support.ts") &&
				!entry.name.endsWith(".generated.ts") &&
				entry.name !== "authoring-capabilities.ts" &&
				entry.name !== "authoring-presence.ts"
			) {
				sourceFiles.push(path);
			}
		}
	};
	await visit(absoluteRoot);
	return (
		await Promise.all(sourceFiles.map((path) => readFile(path, "utf8")))
	).join("\n");
};

const duplicates = (values: readonly string[]): readonly string[] => {
	const seen = new Set<string>();
	const duplicateValues = new Set<string>();
	for (const value of values) {
		if (seen.has(value)) duplicateValues.add(value);
		seen.add(value);
	}
	return [...duplicateValues].sort();
};

const manifestIds = AUTHORING_CAPABILITY_MANIFESTS.map(
	(manifest) => manifest.id,
);
for (const id of duplicates(manifestIds)) {
	reportIssue("duplicate-capability-id", `Capability id is duplicated: ${id}`);
}

const baselineCapabilityIds = Object.values(baseline.capabilityIds).flat();
const manifestIdSet = new Set(manifestIds);
const baselineCapabilityIdSet = new Set(baselineCapabilityIds);

for (const id of baselineCapabilityIds) {
	if (!manifestIdSet.has(id)) {
		reportIssue(
			"missing-baseline-capability",
			`Baseline capability is missing: ${id}`,
		);
	}
}
for (const id of manifestIds) {
	if (!baselineCapabilityIdSet.has(id)) {
		reportIssue(
			"unreviewed-capability",
			`Capability is absent from the reviewed Phase 0 baseline: ${id}`,
		);
	}
}

if (
	manifestIds.length !== baseline.counts.boundedInventoryCapabilityIds ||
	baselineCapabilityIds.length !== baseline.counts.boundedInventoryCapabilityIds
) {
	reportIssue(
		"capability-count-drift",
		`Expected ${baseline.counts.boundedInventoryCapabilityIds} reviewed capabilities; found ${manifestIds.length} manifests and ${baselineCapabilityIds.length} baseline ids.`,
	);
}

const bindablePropertyIds = BINDABLE_PROPERTY_DESCRIPTORS.map(
	(descriptor) => descriptor.id,
);
for (const id of duplicates(bindablePropertyIds)) {
	reportIssue(
		"duplicate-bindable-property-id",
		`Bindable property id is duplicated: ${id}`,
	);
}
for (const id of bindablePropertyIds) {
	if (!BINDABLE_PROPERTY_CAPABILITY_BY_ID[id]) {
		reportIssue(
			"unmapped-bindable-property",
			`Bindable property does not resolve to an authoring capability: ${id}`,
		);
	}
}

const effectDescriptorIds = EFFECT_CAPABILITY_DESCRIPTORS.map(
	(descriptor) => descriptor.id,
);
for (const id of duplicates(effectDescriptorIds)) {
	reportIssue(
		"duplicate-effect-capability-id",
		`Effect capability id is duplicated: ${id}`,
	);
}
for (const id of effectDescriptorIds) {
	if (!EFFECT_DESCRIPTOR_AUTHORING_CAPABILITY_BY_ID[id]) {
		reportIssue(
			"unmapped-effect-capability",
			`Effect capability does not resolve to an authoring capability: ${id}`,
		);
	}
}

const promotedTechniqueIds = new Set(authorableTechniqueIds());
for (const techniqueId of MOTION_GRAMMAR_TECHNIQUE_IDS) {
	const disposition = MOTION_GRAMMAR_TECHNIQUE_DISPOSITION[techniqueId];
	if (disposition === "promoted" && !promotedTechniqueIds.has(techniqueId)) {
		reportIssue(
			"grammar-disposition-drift",
			`Technique ${techniqueId} is marked promoted but is absent from the production authorable set.`,
		);
	}
}

for (const manifest of AUTHORING_CAPABILITY_MANIFESTS) {
	if (manifest.modelAnchorIds.length === 0) {
		reportIssue(
			"missing-model-anchor",
			`Capability ${manifest.id} has no model anchor.`,
		);
	}
	if (manifest.requiredOperations.length === 0) {
		reportIssue(
			"missing-required-operation",
			`Capability ${manifest.id} has no required operation.`,
		);
	}
	if (
		manifest.classification === "authorable" &&
		manifest.commandPlannerIds.length === 0
	) {
		reportIssue(
			"missing-command-planner",
			`Authorable capability ${manifest.id} has no owning command planner.`,
		);
	}
	if (
		manifest.classification !== "authorable" &&
		!manifest.classificationReason
	) {
		reportIssue(
			"missing-classification-reason",
			`Non-authorable capability ${manifest.id} has no owner reason.`,
		);
	}
}

const commandSourceCorpusByOwner = {
	scene: await readTypeScriptSourceCorpus("src/entities/scene/model"),
	motion: await readTypeScriptSourceCorpus("src/entities/motion/model"),
	"motion-grammar": await readTypeScriptSourceCorpus(
		"src/entities/motion-grammar/model",
	),
} as const;
for (const manifest of AUTHORING_CAPABILITY_MANIFESTS) {
	for (const plannerId of manifest.commandPlannerIds) {
		if (!commandSourceCorpusByOwner[manifest.owner].includes(plannerId)) {
			reportIssue(
				"missing-command-planner-reference",
				`Capability ${manifest.id} references ${plannerId}, but that command type or planner symbol is absent from the owning ${manifest.owner} entity source.`,
			);
		}
	}
}

const outputEvidenceKeys = AUTHORING_OUTPUT_EVIDENCE.map(
	(evidence) => `${evidence.capabilityId}::${evidence.outputId}`,
);
const requiredOutputIds = [
	"svg-export",
	"pdf-export",
	"video-capture",
	"motion-runtime-code",
] as const;
for (const key of duplicates(outputEvidenceKeys)) {
	reportIssue(
		"duplicate-output-evidence",
		`Output evidence is duplicated: ${key}`,
	);
}
for (const manifest of AUTHORING_CAPABILITY_MANIFESTS) {
	const evidence = AUTHORING_OUTPUT_EVIDENCE.filter(
		(candidate) => candidate.capabilityId === manifest.id,
	);
	if (evidence.length === 0) {
		reportIssue(
			"missing-output-evidence",
			`Capability ${manifest.id} has no output-fidelity evidence.`,
		);
	}
	for (const record of evidence) {
		if (record.sourceAnchorIds.length === 0) {
			reportIssue(
				"missing-output-source-anchor",
				`Output evidence ${record.capabilityId}/${record.outputId} has no source anchor.`,
			);
		}
		if (
			record.fidelity !== "native" &&
			record.fidelity !== "not_applicable" &&
			!record.limitationVisible
		) {
			reportIssue(
				"hidden-output-limitation",
				`Output ${record.capabilityId}/${record.outputId} is ${record.fidelity} without a visible limitation.`,
			);
		}
		if (record.outputId === "canvas-and-supported-export-tiers") {
			reportIssue(
				"aggregate-output-placeholder",
				`Capability ${record.capabilityId} still uses the Phase 0 aggregate output placeholder.`,
			);
		}
	}
	const outputRelevant = evidence.some(
		(record) => record.fidelity !== "not_applicable",
	);
	if (outputRelevant) {
		for (const outputId of requiredOutputIds) {
			if (!evidence.some((record) => record.outputId === outputId)) {
				reportIssue(
					"missing-concrete-output-tier",
					`Output-relevant capability ${manifest.id} has no ${outputId} fidelity declaration.`,
				);
			}
		}
	}
}

const surfaceEvidenceKeys = AUTHORING_SURFACE_EVIDENCE.map(
	(evidence) =>
		`${evidence.capabilityId}::${evidence.surface}::${evidence.checkId}::${evidence.operation ?? "all"}`,
);
for (const key of duplicates(surfaceEvidenceKeys)) {
	reportIssue(
		"duplicate-surface-evidence",
		`Surface evidence is duplicated: ${key}`,
	);
}

for (const manifest of AUTHORING_CAPABILITY_MANIFESTS) {
	for (const surface of AUTHORING_EVIDENCE_SURFACES) {
		const evidence = AUTHORING_SURFACE_EVIDENCE.filter(
			(candidate) =>
				candidate.capabilityId === manifest.id && candidate.surface === surface,
		);
		if (evidence.length === 0) {
			reportIssue(
				"missing-surface-evidence",
				`Capability ${manifest.id} has no ${surface} evidence.`,
			);
		}
		if (
			surface === "gui" ||
			surface === "live_agent" ||
			surface === "offline_command"
		) {
			for (const operation of manifest.requiredOperations) {
				if (!evidence.some((record) => record.operation === operation)) {
					reportIssue(
						"missing-operation-evidence",
						`Capability ${manifest.id} has no ${surface}/${operation} evidence.`,
					);
				}
			}
		}
		for (const record of evidence) {
			if (record.sourceAnchorIds.length === 0) {
				reportIssue(
					"missing-surface-source-anchor",
					`Evidence ${record.capabilityId}/${record.surface}/${record.checkId} has no source anchor.`,
				);
			}
		}
	}
}

const evidenceSourceAnchorIds = [
	...AUTHORING_SURFACE_EVIDENCE.flatMap((record) => record.sourceAnchorIds),
	...AUTHORING_ORTHOGONAL_EVIDENCE.flatMap((record) => record.sourceAnchorIds),
	...AUTHORING_OUTPUT_EVIDENCE.flatMap((record) => record.sourceAnchorIds),
];
for (const sourceAnchorId of new Set(evidenceSourceAnchorIds)) {
	const sourcePath = sourceAnchorId.split("#", 1)[0]?.trim();
	if (!sourcePath || sourcePath === "missing-owner-anchor") {
		reportIssue(
			"invalid-evidence-source-anchor",
			`Evidence source anchor is invalid: ${sourceAnchorId}`,
		);
		continue;
	}
	try {
		await access(resolve(repositoryRoot, sourcePath));
	} catch {
		reportIssue(
			"missing-evidence-source-anchor",
			`Evidence source anchor does not exist: ${sourceAnchorId}`,
		);
	}
}

const orthogonalEvidenceKeys = AUTHORING_ORTHOGONAL_EVIDENCE.map(
	(evidence) => `${evidence.capabilityId}::${evidence.dimension}`,
);
for (const key of duplicates(orthogonalEvidenceKeys)) {
	reportIssue(
		"duplicate-orthogonal-evidence",
		`Orthogonal evidence is duplicated: ${key}`,
	);
}
for (const manifest of AUTHORING_CAPABILITY_MANIFESTS) {
	for (const dimension of AUTHORING_ORTHOGONAL_DIMENSIONS) {
		if (!orthogonalEvidenceKeys.includes(`${manifest.id}::${dimension}`)) {
			reportIssue(
				"missing-orthogonal-evidence",
				`Capability ${manifest.id} has no ${dimension} evidence.`,
			);
		}
	}
}

const currentGapKeys = [
	...expandAuthoringGapGroups(AUTHORING_PARITY_GAP_GROUPS),
].sort();
const baselineGapKeys = [
	...baseline.gapGroups.flatMap((group) =>
		group.surfaces.flatMap((surface) =>
			group.checkIds.map(
				(checkId) => `${group.capabilityId}::${surface}::${checkId}`,
			),
		),
	),
].sort();
const baselineGapKeySet = new Set(baselineGapKeys);

for (const key of duplicates(currentGapKeys)) {
	reportIssue("duplicate-gap-key", `Atomic gap key is duplicated: ${key}`);
}
for (const key of currentGapKeys) {
	if (!baselineGapKeySet.has(key)) {
		reportIssue(
			"new-authoring-gap",
			`Gap is not in the reviewed monotonic allowlist: ${key}`,
		);
	}
}
for (const group of AUTHORING_PARITY_GAP_GROUPS) {
	if (
		!manifestIdSet.has(group.capabilityId) &&
		!group.capabilityId.startsWith("workflow.")
	) {
		reportIssue(
			"unknown-gap-capability",
			`Gap group references an unknown capability: ${group.capabilityId}`,
		);
	}
	if (
		!group.owner ||
		!group.destinationPhase ||
		!group.exposurePolicy ||
		!group.cause
	) {
		reportIssue(
			"incomplete-gap-contract",
			`Gap group ${group.capabilityId} is missing owner, phase, exposure, or cause.`,
		);
	}
}
for (const workflow of COMPOUND_AUTHORING_WORKFLOWS) {
	if (
		!AUTHORING_PARITY_GAP_GROUPS.some(
			(group) => group.capabilityId === workflow.id,
		) &&
		workflow.state !== "supported"
	) {
		reportIssue(
			"missing-workflow-gap",
			`Non-supported compound workflow has no ratcheted gap: ${workflow.id}`,
		);
	}
}

if (baselineGapKeys.length !== baseline.counts.totalAtomicGapKeys) {
	reportIssue(
		"baseline-gap-count-drift",
		`Baseline declares ${baseline.counts.totalAtomicGapKeys} atomic gaps but expands to ${baselineGapKeys.length}.`,
	);
}
if (baseline.gapGroups.length !== baseline.counts.gapGroups) {
	reportIssue(
		"baseline-group-count-drift",
		`Baseline declares ${baseline.counts.gapGroups} groups but contains ${baseline.gapGroups.length}.`,
	);
}

const nonFullAuthoringRows = AUTHORING_SURFACE_EVIDENCE.filter(
	(evidence) =>
		AUTHORING_CAPABILITY_MANIFESTS.some(
			(manifest) =>
				manifest.id === evidence.capabilityId &&
				manifest.classification === "authorable",
		) &&
		(evidence.surface === "gui" ||
			evidence.surface === "live_agent" ||
			evidence.surface === "offline_command") &&
		evidence.state !== "supported",
);
const nonFullOrthogonalAuthoringRows = AUTHORING_ORTHOGONAL_EVIDENCE.filter(
	(evidence) =>
		AUTHORING_CAPABILITY_MANIFESTS.some(
			(manifest) =>
				manifest.id === evidence.capabilityId &&
				manifest.classification === "authorable",
		) && evidence.state !== "supported",
);
const outputDeclarationRows = AUTHORING_ORTHOGONAL_EVIDENCE.filter(
	(evidence) => evidence.dimension === "output_declaration",
);
const incompleteOutputDeclarations = outputDeclarationRows.filter(
	(evidence) =>
		evidence.state !== "supported" && evidence.state !== "not_applicable",
);
const nonFullGuiCapabilityIds = new Set(
	nonFullAuthoringRows
		.filter((evidence) => evidence.surface === "gui")
		.map((evidence) => evidence.capabilityId),
);
for (const capabilityId of Object.keys(PROJECT_GUI_AUTHORING_LIMITATIONS)) {
	if (!nonFullGuiCapabilityIds.has(capabilityId)) {
		reportIssue(
			"stale-restore-compatibility-limitation",
			`Restore compatibility marks ${capabilityId} limited while GUI operation evidence is full.`,
		);
	}
}
for (const capabilityId of nonFullGuiCapabilityIds) {
	if (!(capabilityId in PROJECT_GUI_AUTHORING_LIMITATIONS)) {
		reportIssue(
			"missing-restore-compatibility-limitation",
			`GUI-limited capability ${capabilityId} has no visible restore compatibility reason.`,
		);
	}
}

if (nonFullAuthoringRows.length > 0) {
	reportIssue(
		"non-full-authoring-row",
		`${nonFullAuthoringRows.length} GUI/live/offline authoring rows remain partial or blocked.`,
	);
}
if (nonFullOrthogonalAuthoringRows.length > 0) {
	reportIssue(
		"non-full-orthogonal-authoring-row",
		`${nonFullOrthogonalAuthoringRows.length} authorable history/persistence/presentation/conflict/output rows remain incomplete.`,
	);
}
if (incompleteOutputDeclarations.length > 0) {
	reportIssue(
		"incomplete-output-declaration",
		`${incompleteOutputDeclarations.length} output declarations remain incomplete.`,
	);
}
if (AUTHORING_PARITY_GAP_GROUPS.length > 0) {
	reportIssue(
		"remaining-authoring-gap",
		`${AUTHORING_PARITY_GAP_GROUPS.length} authoring gap groups remain.`,
	);
}

const report = {
	status: issues.length === 0 ? "ratchet-pass" : "ratchet-fail",
	capabilities: manifestIds.length,
	surfaceEvidenceRecords: AUTHORING_SURFACE_EVIDENCE.length,
	orthogonalEvidenceRecords: AUTHORING_ORTHOGONAL_EVIDENCE.length,
	outputEvidenceRecords: AUTHORING_OUTPUT_EVIDENCE.length,
	compoundWorkflows: COMPOUND_AUTHORING_WORKFLOWS.length,
	nonFullAuthoringRows: nonFullAuthoringRows.length,
	nonFullOrthogonalAuthoringRows: nonFullOrthogonalAuthoringRows.length,
	incompleteOutputDeclarations: incompleteOutputDeclarations.length,
	gapGroups: AUTHORING_PARITY_GAP_GROUPS.length,
	atomicGapKeys: currentGapKeys.length,
	removedBaselineGapKeys: baselineGapKeys.filter(
		(key) => !currentGapKeys.includes(key),
	).length,
	issues,
};

console.log(JSON.stringify(report, null, 2));
if (issues.length > 0) process.exitCode = 1;
