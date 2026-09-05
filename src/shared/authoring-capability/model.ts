/** Stable owners of Vecmo's durable authoring semantics. */
export type AuthoringOwner = "scene" | "motion" | "motion-grammar";

export type AuthoringCapabilityClassification =
	| "authorable"
	| "derived"
	| "system_managed"
	| "diagnostic";

export type AuthoringCapabilityKind =
	| "atomic"
	| "collection"
	| "structure"
	| "relationship"
	| "timeline";

export const AUTHORING_OPERATIONS = [
	"read",
	"create",
	"update",
	"remove",
	"reorder",
	"bind",
	"unbind",
	"retime",
	"bake",
	"expand",
] as const;

export type AuthoringOperation = (typeof AUTHORING_OPERATIONS)[number];

/**
 * Entity-owned capability identity. Surface support is deliberately absent: it
 * is supplied by independent GUI/headless evidence adapters.
 */
export type EntityAuthoringCapabilityManifest = {
	readonly id: string;
	readonly label: string;
	readonly owner: AuthoringOwner;
	readonly classification: AuthoringCapabilityClassification;
	readonly kind: AuthoringCapabilityKind;
	readonly modelAnchorIds: readonly string[];
	readonly requiredOperations: readonly AuthoringOperation[];
	readonly commandPlannerIds: readonly string[];
	readonly presenceProbeId?: string;
	readonly classificationReason?: string;
};

export const AUTHORING_EVIDENCE_SURFACES = [
	"gui",
	"live_agent",
	"offline_command",
	"import_bootstrap",
	"readback",
] as const;

export type AuthoringEvidenceSurface =
	(typeof AUTHORING_EVIDENCE_SURFACES)[number];

export type AuthoringEvidenceState =
	| "supported"
	| "partial"
	| "blocked"
	| "not_applicable";

/** Independent evidence for one operation or narrower semantic check. */
export type AuthoringSurfaceEvidence = {
	readonly capabilityId: string;
	readonly surface: AuthoringEvidenceSurface;
	readonly checkId: string;
	readonly operation?: AuthoringOperation;
	readonly state: AuthoringEvidenceState;
	readonly adapterId: string;
	readonly sourceAnchorIds: readonly string[];
	readonly reason?: string;
};

export const AUTHORING_ORTHOGONAL_DIMENSIONS = [
	"history",
	"persistence",
	"presentation",
	"conflict_policy",
	"output_declaration",
] as const;

export type AuthoringOrthogonalDimension =
	(typeof AUTHORING_ORTHOGONAL_DIMENSIONS)[number];

export type AuthoringOrthogonalEvidence = {
	readonly capabilityId: string;
	readonly dimension: AuthoringOrthogonalDimension;
	readonly state: AuthoringEvidenceState;
	readonly adapterId: string;
	readonly sourceAnchorIds: readonly string[];
	readonly reason?: string;
};

export const AUTHORING_OUTPUT_FIDELITIES = [
	"native",
	"approximated",
	"side-car-only",
	"capture-only",
	"unsupported",
	"not_applicable",
] as const;

export type AuthoringOutputFidelity =
	(typeof AUTHORING_OUTPUT_FIDELITIES)[number];

export type AuthoringOutputEvidence = {
	readonly capabilityId: string;
	readonly outputId: string;
	readonly fidelity: AuthoringOutputFidelity;
	readonly limitationVisible: boolean;
	readonly adapterId: string;
	readonly sourceAnchorIds: readonly string[];
};

export type CompoundAuthoringWorkflowContract = {
	readonly id: string;
	readonly coordinatorId: string;
	readonly participantOwners: readonly AuthoringOwner[];
	readonly requiredEvidenceIds: readonly string[];
	readonly supportedExceptionIds: readonly string[];
	readonly state: "supported" | "partial" | "blocked";
	readonly destinationPhase: string;
	readonly exposure: "internal-blocked" | "typed-limitation" | "user-visible";
};

export type AuthoringGapGroup = {
	readonly capabilityId: string;
	readonly surfaces: readonly AuthoringEvidenceSurface[];
	readonly checkIds: readonly string[];
	readonly owner: string;
	readonly destinationPhase: string;
	readonly exposurePolicy: string;
	readonly cause: string;
};

/** Expands compact baseline groups into the only keys the ratchet compares. */
export const expandAuthoringGapGroups = (
	groups: readonly AuthoringGapGroup[],
): readonly string[] =>
	groups.flatMap((group) =>
		group.surfaces.flatMap((surface) =>
			group.checkIds.map(
				(checkId) => `${group.capabilityId}::${surface}::${checkId}`,
			),
		),
	);
