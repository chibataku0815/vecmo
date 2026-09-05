import { mkdir, writeFile } from "node:fs/promises";
import { MOTION_EXPRESSION_VERSION_PARAM_KEY } from "@/entities/motion-grammar/model/expression-definition";
import {
	findMotionExpressionDefinition,
	isMotionExpressionBindingActive,
} from "@/entities/motion-grammar/model/expression-registry";
import {
	parseMotionGrammarLayer,
	serializeMotionGrammarLayer,
} from "@/entities/motion-grammar/model/parse";
import type {
	MotionGrammarBinding,
	MotionGrammarTechniqueId,
} from "@/entities/motion-grammar/model/types";
import { createMotionGrammarNewBindingDefaults } from "@/entities/motion-grammar/model/versioned-expression-binding";

const outputPath =
	process.argv[2] ??
	"artifacts/versioned-expression-binding-contract-20260716.json";

const cases: readonly {
	readonly caseId: string;
	readonly techniqueId: MotionGrammarTechniqueId;
	readonly targetIds: readonly string[];
}[] = [
	{
		caseId: "interference-four-roles",
		techniqueId: "ring-wave-interference",
		targetIds: ["driver", "follower-a", "center", "follower-b"],
	},
	{
		caseId: "merge-split-three-roles",
		techniqueId: "merge-split-cycle",
		targetIds: ["core", "member-a", "member-b"],
	},
	{
		caseId: "symmetry-two-roles",
		techniqueId: "mirror-symmetric-scale",
		targetIds: ["left-outer", "right-outer"],
	},
	{
		caseId: "symmetry-three-roles",
		techniqueId: "mirror-symmetric-scale",
		targetIds: ["left-outer", "right-outer", "center"],
	},
	{
		caseId: "symmetry-four-roles",
		techniqueId: "mirror-symmetric-scale",
		targetIds: ["left-outer", "right-outer", "left-inner", "right-inner"],
	},
	{
		caseId: "symmetry-five-roles",
		techniqueId: "mirror-symmetric-scale",
		targetIds: [
			"left-outer",
			"right-outer",
			"left-inner",
			"right-inner",
			"center",
		],
	},
	{
		caseId: "parallax-three-roles",
		techniqueId: "size-speed-parallax",
		targetIds: ["foreground", "midground", "background"],
	},
];

const rejectedCases: readonly {
	readonly caseId: string;
	readonly techniqueId: MotionGrammarTechniqueId;
	readonly targetIds: readonly string[];
}[] = [
	{
		caseId: "symmetry-six-roles",
		techniqueId: "mirror-symmetric-scale",
		targetIds: [
			"left-outer",
			"right-outer",
			"left-inner",
			"right-inner",
			"center",
			"extra",
		],
	},
];

const recordEquals = (
	left: Readonly<Record<string, string>> | undefined,
	right: Readonly<Record<string, string>> | undefined,
): boolean => JSON.stringify(left ?? {}) === JSON.stringify(right ?? {});

const defaults = cases.map((entry) => ({
	...entry,
	defaults: createMotionGrammarNewBindingDefaults(
		entry.techniqueId,
		entry.targetIds,
	),
}));

const rejectedDefaults = rejectedCases.map((entry) => ({
	...entry,
	defaults: createMotionGrammarNewBindingDefaults(
		entry.techniqueId,
		entry.targetIds,
	),
}));

const readyDefaults = defaults.filter(
	(
		entry,
	): entry is typeof entry & {
		readonly defaults: Extract<
			typeof entry.defaults,
			{ readonly status: "ready" }
		>;
	} => entry.defaults.status === "ready",
);

const bindings: readonly MotionGrammarBinding[] = readyDefaults.map(
	(entry) => ({
		id: `versioned-contract:${entry.caseId}`,
		techniqueId: entry.techniqueId,
		targetIds: [...entry.targetIds],
		parameters: entry.defaults.parameters,
		effectBinding: { kind: "none" },
		...(entry.defaults.roleMap ? { roleMap: entry.defaults.roleMap } : {}),
	}),
);

const parsedNew = parseMotionGrammarLayer(
	serializeMotionGrammarLayer(bindings),
);
const newBindings = cases.map((entry) => {
	const defaultsForCase = defaults.find(
		(candidate) => candidate.caseId === entry.caseId,
	)?.defaults;
	const parsed = parsedNew.bindings.find(
		(binding) => binding.id === `versioned-contract:${entry.caseId}`,
	);
	const definition = findMotionExpressionDefinition(entry.techniqueId);
	const expectedMarker = definition?.version;
	return {
		caseId: entry.caseId,
		techniqueId: entry.techniqueId,
		defaultsStatus: defaultsForCase?.status ?? "blocked",
		marker: parsed?.parameters[MOTION_EXPRESSION_VERSION_PARAM_KEY] ?? null,
		expectedMarker: expectedMarker ?? null,
		active:
			Boolean(definition && parsed) &&
			isMotionExpressionBindingActive(
				definition as NonNullable<typeof definition>,
				parsed as MotionGrammarBinding,
			),
		roleMapRoundTrip:
			defaultsForCase?.status === "ready" &&
			recordEquals(parsed?.roleMap, defaultsForCase.roleMap),
	};
});

const parsedLegacy = parseMotionGrammarLayer({
	schemaVersion: 1,
	bindings: cases.map((entry) => ({
		id: `legacy-contract:${entry.caseId}`,
		techniqueId: entry.techniqueId,
		targetIds: [...entry.targetIds],
		parameters: { periodFrames: 96 },
	})),
});
const legacyBindings = cases.map((entry) => {
	const parsed = parsedLegacy.bindings.find(
		(binding) => binding.id === `legacy-contract:${entry.caseId}`,
	);
	const definition = findMotionExpressionDefinition(entry.techniqueId);
	return {
		caseId: entry.caseId,
		techniqueId: entry.techniqueId,
		markerPresent:
			parsed?.parameters[MOTION_EXPRESSION_VERSION_PARAM_KEY] !== undefined,
		active:
			Boolean(definition && parsed) &&
			isMotionExpressionBindingActive(
				definition as NonNullable<typeof definition>,
				parsed as MotionGrammarBinding,
			),
	};
});

const rejectedBindingDefaults = rejectedDefaults.map((entry) => ({
	caseId: entry.caseId,
	techniqueId: entry.techniqueId,
	status: entry.defaults.status,
	...(entry.defaults.status === "blocked"
		? { reason: entry.defaults.reason }
		: {}),
}));

const status =
	readyDefaults.length === cases.length &&
	parsedNew.issues.length === 0 &&
	newBindings.every(
		(entry) =>
			entry.marker === entry.expectedMarker &&
			entry.active &&
			entry.roleMapRoundTrip,
	) &&
	legacyBindings.every((entry) => !entry.markerPresent && !entry.active) &&
	rejectedDefaults.every((entry) => entry.defaults.status === "blocked")
		? "ready"
		: "blocked";

const packet = {
	status,
	scope:
		"Versioned binding creation and persistence only; it is not a renderer, pixel, export, or user-acceptance packet.",
	newBindingParseIssues: parsedNew.issues,
	legacyBindingParseIssues: parsedLegacy.issues,
	newBindings,
	legacyBindings,
	rejectedBindingDefaults,
};

await mkdir(outputPath.slice(0, outputPath.lastIndexOf("/")) || ".", {
	recursive: true,
});
await writeFile(outputPath, `${JSON.stringify(packet, null, 2)}\n`, "utf8");
console.log(`Wrote ${outputPath}`);
console.log(`status=${status}`);
if (status !== "ready") process.exitCode = 1;
