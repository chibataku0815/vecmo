import type { EntityAuthoringCapabilityManifest } from "@/shared/authoring-capability/model";
import type { MotionGrammarStoreDocument } from "./command";
import type {
	MotionGrammarBinding,
	MotionGrammarEffectBinding,
	MotionGrammarTechniqueId,
} from "./types";

const grammarCapability = <
	const TManifest extends Omit<EntityAuthoringCapabilityManifest, "owner">,
>(
	manifest: TManifest,
): TManifest & { readonly owner: "motion-grammar" } => ({
	...manifest,
	owner: "motion-grammar",
});

const techniqueCapability = <const TTechnique extends MotionGrammarTechniqueId>(
	techniqueId: TTechnique,
) =>
	grammarCapability({
		id: `grammar.technique.${techniqueId}` as const,
		label: `Motion Grammar technique: ${techniqueId}`,
		classification: "authorable" as const,
		kind: "structure" as const,
		modelAnchorIds: [
			`MotionGrammarTechniqueId.${techniqueId}`,
			`MOTION_GRAMMAR_CATALOG.${techniqueId}`,
		],
		requiredOperations: ["read", "create", "update", "remove"] as const,
		commandPlannerIds: [
			"applyGrammarBinding",
			"updateGrammarBinding",
			"removeGrammarBinding",
		],
		presenceProbeId: `grammar.technique.${techniqueId}`,
	});

export const MOTION_GRAMMAR_STORE_AUTHORING_CAPABILITIES = [
	grammarCapability({
		id: "grammar.bindings",
		label: "Motion Grammar bindings",
		classification: "authorable",
		kind: "collection",
		modelAnchorIds: [
			"MotionGrammarStoreDocument.bindings",
			"MotionGrammarBinding",
		],
		requiredOperations: [
			"read",
			"create",
			"update",
			"remove",
			"reorder",
			"bind",
			"unbind",
		],
		commandPlannerIds: [
			"applyGrammarBinding",
			"updateGrammarBinding",
			"removeGrammarBinding",
			"reorderGrammarBinding",
		],
		presenceProbeId: "grammar.bindings",
	}),
	grammarCapability({
		id: "grammar.technique-profile",
		label: "Motion Grammar technique profiles",
		classification: "authorable",
		kind: "structure",
		modelAnchorIds: [
			"MotionGrammarAuthoringProfile",
			"MotionGrammarTechniqueModule",
		],
		requiredOperations: [
			"read",
			"create",
			"update",
			"remove",
			"bake",
			"expand",
		],
		commandPlannerIds: [
			"applyGrammarBinding",
			"updateGrammarBinding",
			"createMotionGrammarEditableExpansionCommandPlan",
			"createCollisionBounceBakeCommands",
			"createStrokeDrawOnAuthoringPlan",
			"createMotionGrammarRoleReplacementPlan",
		],
		presenceProbeId: "grammar.technique-profile",
	}),
	grammarCapability({
		id: "grammar.passthrough",
		label: "Unknown-technique passthrough bindings",
		classification: "system_managed",
		kind: "collection",
		modelAnchorIds: ["MotionGrammarStoreDocument.passthrough"],
		requiredOperations: ["read", "remove"],
		commandPlannerIds: ["removeGrammarBinding"],
		presenceProbeId: "grammar.passthrough",
		classificationReason:
			"Unknown serialized bindings are preserved inertly and may only be removed.",
	}),
	grammarCapability({
		id: "grammar.diagnostics",
		label: "Motion Grammar diagnostics",
		classification: "diagnostic",
		kind: "collection",
		modelAnchorIds: ["MotionGrammarStoreDocument.diagnostics"],
		requiredOperations: ["read"],
		commandPlannerIds: [],
		presenceProbeId: "grammar.diagnostics",
		classificationReason:
			"Diagnostics are session-only source-free facts and are never persisted authoring state.",
	}),
] as const satisfies readonly EntityAuthoringCapabilityManifest[];

export const MOTION_GRAMMAR_TECHNIQUE_AUTHORING_CAPABILITIES = [
	techniqueCapability("time-delay"),
	techniqueCapability("random-phase-pulse"),
	techniqueCapability("mirror-symmetric-scale"),
	techniqueCapability("time-offset-propagation"),
	techniqueCapability("ring-wave-interference"),
	techniqueCapability("planar-solid-tumble"),
	techniqueCapability("boolean-difference-rotation"),
	techniqueCapability("inverse-proportion-link"),
	techniqueCapability("arrangement-transition"),
	techniqueCapability("shear-split"),
	techniqueCapability("merge-split-cycle"),
	techniqueCapability("count-growth"),
	techniqueCapability("periodic-afterimage"),
	techniqueCapability("cyclic-path-travel"),
	techniqueCapability("auto-orient-along-path"),
	techniqueCapability("size-speed-parallax"),
	techniqueCapability("reactive-neighbor-displacement"),
	techniqueCapability("lag-follow-through"),
	techniqueCapability("noise-wipe"),
	techniqueCapability("stroke-draw-on"),
	techniqueCapability("collision-bounce"),
] as const satisfies readonly EntityAuthoringCapabilityManifest[];

export const MOTION_GRAMMAR_AUTHORING_CAPABILITIES = [
	...MOTION_GRAMMAR_STORE_AUTHORING_CAPABILITIES,
	...MOTION_GRAMMAR_TECHNIQUE_AUTHORING_CAPABILITIES,
] as const satisfies readonly EntityAuthoringCapabilityManifest[];

export type MotionGrammarStoreAuthoringCapabilityId =
	(typeof MOTION_GRAMMAR_STORE_AUTHORING_CAPABILITIES)[number]["id"];
export type MotionGrammarTechniqueAuthoringCapabilityId =
	(typeof MOTION_GRAMMAR_TECHNIQUE_AUTHORING_CAPABILITIES)[number]["id"];
export type MotionGrammarAuthoringCapabilityId =
	(typeof MOTION_GRAMMAR_AUTHORING_CAPABILITIES)[number]["id"];

export const MOTION_GRAMMAR_STORE_CAPABILITY_BY_KEY = {
	bindings: "grammar.bindings",
	passthrough: "grammar.passthrough",
	diagnostics: "grammar.diagnostics",
} as const satisfies Record<
	keyof MotionGrammarStoreDocument,
	MotionGrammarStoreAuthoringCapabilityId
>;

export const MOTION_GRAMMAR_BINDING_CAPABILITY_BY_KEY = {
	id: "grammar.bindings",
	techniqueId: "grammar.technique-profile",
	targetIds: "grammar.bindings",
	randomPulseProfile: "grammar.technique-profile",
	roleMap: "grammar.bindings",
	arrangementMapping: "grammar.bindings",
	parameters: "grammar.technique-profile",
	seed: "grammar.technique-profile",
	effectBinding: "grammar.bindings",
} as const satisfies Record<
	keyof MotionGrammarBinding,
	MotionGrammarStoreAuthoringCapabilityId
>;

export const MOTION_GRAMMAR_EFFECT_BINDING_CAPABILITY_BY_KIND = {
	none: "grammar.bindings",
	"active-target-influence": "grammar.bindings",
	"automation-param": "grammar.bindings",
	"temporal-echo": "grammar.bindings",
} as const satisfies Record<
	MotionGrammarEffectBinding["kind"],
	"grammar.bindings"
>;

export type MotionGrammarTechniqueDisposition = "promoted";

export const MOTION_GRAMMAR_TECHNIQUE_DISPOSITION = {
	"time-delay": "promoted",
	"random-phase-pulse": "promoted",
	"mirror-symmetric-scale": "promoted",
	"time-offset-propagation": "promoted",
	"ring-wave-interference": "promoted",
	"planar-solid-tumble": "promoted",
	"boolean-difference-rotation": "promoted",
	"inverse-proportion-link": "promoted",
	"arrangement-transition": "promoted",
	"shear-split": "promoted",
	"merge-split-cycle": "promoted",
	"count-growth": "promoted",
	"periodic-afterimage": "promoted",
	"cyclic-path-travel": "promoted",
	"auto-orient-along-path": "promoted",
	"size-speed-parallax": "promoted",
	"reactive-neighbor-displacement": "promoted",
	"lag-follow-through": "promoted",
	"noise-wipe": "promoted",
	"stroke-draw-on": "promoted",
	"collision-bounce": "promoted",
} as const satisfies Record<
	MotionGrammarTechniqueId,
	MotionGrammarTechniqueDisposition
>;
