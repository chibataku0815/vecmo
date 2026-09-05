import {
	MOTION_AUTHORING_CAPABILITIES,
	type MotionAuthoringCapabilityId,
} from "../../src/entities/motion/model/authoring-capabilities";
import {
	MOTION_GRAMMAR_AUTHORING_CAPABILITIES,
	type MotionGrammarAuthoringCapabilityId,
} from "../../src/entities/motion-grammar/model/authoring-capabilities";
import {
	SCENE_AUTHORING_CAPABILITIES,
	type SceneAuthoringCapabilityId,
} from "../../src/entities/scene/model/authoring-capabilities";
import {
	AUTHORING_OUTPUT_RELEVANT_CAPABILITY_IDS,
	AUTHORING_OUTPUT_TIER_DECLARATIONS,
} from "../../src/features/export/model/authoring-output-contract";
import type {
	AuthoringEvidenceState,
	AuthoringGapGroup,
	AuthoringOrthogonalEvidence,
	AuthoringOutputEvidence,
	AuthoringSurfaceEvidence,
	CompoundAuthoringWorkflowContract,
	EntityAuthoringCapabilityManifest,
} from "../../src/shared/authoring-capability/model";

export const AUTHORING_CAPABILITY_MANIFESTS = [
	...SCENE_AUTHORING_CAPABILITIES,
	...MOTION_AUTHORING_CAPABILITIES,
	...MOTION_GRAMMAR_AUTHORING_CAPABILITIES,
] as const satisfies readonly EntityAuthoringCapabilityManifest[];

export type AuthoringCapabilityId =
	| SceneAuthoringCapabilityId
	| MotionAuthoringCapabilityId
	| MotionGrammarAuthoringCapabilityId;

type AuthoringSurfaceStateTriple = readonly [
	gui: AuthoringEvidenceState,
	liveAgent: AuthoringEvidenceState,
	offlineCommand: AuthoringEvidenceState,
];

const surfaceStates = (
	gui: AuthoringEvidenceState,
	liveAgent: AuthoringEvidenceState,
	offlineCommand: AuthoringEvidenceState,
): AuthoringSurfaceStateTriple => [gui, liveAgent, offlineCommand];

/**
 * Source-reviewed surface summaries. This table is deliberately independent of
 * the entity manifests: adding a manifest id cannot inherit "supported" from a
 * default branch and instead makes this exhaustive record fail to compile.
 */
export const AUTHORING_SURFACE_STATE_BY_CAPABILITY = {
	"scene.document.id": surfaceStates("supported", "supported", "supported"),
	"scene.document.name": surfaceStates("supported", "supported", "supported"),
	"scene.document.schema-version": surfaceStates(
		"supported",
		"supported",
		"supported",
	),
	"scene.artboards": surfaceStates("supported", "supported", "supported"),
	"scene.current-artboard": surfaceStates(
		"supported",
		"supported",
		"supported",
	),
	"scene.sequence": surfaceStates("supported", "supported", "supported"),
	"scene.layers": surfaceStates("supported", "supported", "supported"),
	"scene.node.identity": surfaceStates("supported", "supported", "supported"),
	"scene.node.visibility-lock": surfaceStates(
		"supported",
		"supported",
		"supported",
	),
	"scene.node.hierarchy": surfaceStates("supported", "supported", "supported"),
	"scene.geometry.rect": surfaceStates("supported", "supported", "supported"),
	"scene.geometry.ellipse": surfaceStates(
		"supported",
		"supported",
		"supported",
	),
	"scene.geometry.line": surfaceStates("supported", "supported", "supported"),
	"scene.geometry.polygon": surfaceStates(
		"supported",
		"supported",
		"supported",
	),
	"scene.geometry.star": surfaceStates("supported", "supported", "supported"),
	"scene.geometry.path": surfaceStates("supported", "supported", "supported"),
	"scene.geometry.text": surfaceStates("supported", "supported", "supported"),
	"scene.geometry.image": surfaceStates("supported", "supported", "supported"),
	"scene.node.transform": surfaceStates("supported", "supported", "supported"),
	"scene.appearance.basic": surfaceStates(
		"supported",
		"supported",
		"supported",
	),
	"scene.appearance.rich": surfaceStates("supported", "supported", "supported"),
	"scene.appearance.look": surfaceStates("supported", "supported", "supported"),
	"scene.appearance.mask": surfaceStates("supported", "supported", "supported"),
	"scene.assets": surfaceStates("supported", "supported", "supported"),
	"scene.components": surfaceStates("supported", "supported", "supported"),
	"scene.component-props": surfaceStates("supported", "supported", "supported"),
	"scene.style-presets": surfaceStates("supported", "supported", "supported"),
	"scene.expressions": surfaceStates("supported", "supported", "supported"),
	"scene.duplicate-generators": surfaceStates(
		"supported",
		"supported",
		"supported",
	),
	"scene.layout-frame": surfaceStates("supported", "supported", "supported"),
	"scene.blend": surfaceStates("supported", "supported", "supported"),
	"scene.motion-parent": surfaceStates("supported", "supported", "supported"),
	"scene.constraints": surfaceStates("supported", "supported", "supported"),
	"scene.camera-depth": surfaceStates("supported", "supported", "supported"),
	"scene.source-optics": surfaceStates("supported", "supported", "supported"),
	"scene.interactions": surfaceStates("supported", "supported", "supported"),
	"scene.arrangement-snapshots": surfaceStates(
		"supported",
		"supported",
		"supported",
	),
	"scene.node.provenance-data": surfaceStates("partial", "partial", "partial"),
	"scene.generated-roles": surfaceStates("supported", "supported", "supported"),
	"motion.schema-version": surfaceStates("supported", "supported", "supported"),
	"motion.timing": surfaceStates("supported", "supported", "supported"),
	"motion.track.scalar": surfaceStates("supported", "supported", "supported"),
	"motion.track.path-shape": surfaceStates(
		"supported",
		"supported",
		"supported",
	),
	"motion.track.mesh-paint": surfaceStates(
		"supported",
		"supported",
		"supported",
	),
	"motion.track.fill-gradient": surfaceStates(
		"supported",
		"supported",
		"supported",
	),
	"motion.position-path": surfaceStates("supported", "supported", "supported"),
	"motion.look-node-track": surfaceStates(
		"supported",
		"supported",
		"supported",
	),
	"motion.source-optics-track": surfaceStates(
		"supported",
		"supported",
		"supported",
	),
	"motion.camera-track": surfaceStates("supported", "supported", "supported"),
	"motion.production-control-track": surfaceStates(
		"supported",
		"supported",
		"supported",
	),
	"motion.camera-cut": surfaceStates("supported", "supported", "supported"),
	"motion.text-animator": surfaceStates("supported", "supported", "supported"),
	"motion.clips": surfaceStates("supported", "supported", "supported"),
	"motion.automation": surfaceStates("supported", "supported", "supported"),
	"motion.grammar-compatibility": surfaceStates(
		"supported",
		"supported",
		"supported",
	),
	"grammar.bindings": surfaceStates("supported", "supported", "supported"),
	"grammar.technique-profile": surfaceStates(
		"supported",
		"supported",
		"supported",
	),
	"grammar.passthrough": surfaceStates("supported", "supported", "supported"),
	"grammar.diagnostics": surfaceStates("supported", "supported", "supported"),
	"grammar.technique.time-delay": surfaceStates(
		"supported",
		"supported",
		"supported",
	),
	"grammar.technique.random-phase-pulse": surfaceStates(
		"supported",
		"supported",
		"supported",
	),
	"grammar.technique.mirror-symmetric-scale": surfaceStates(
		"supported",
		"supported",
		"supported",
	),
	"grammar.technique.time-offset-propagation": surfaceStates(
		"supported",
		"supported",
		"supported",
	),
	"grammar.technique.ring-wave-interference": surfaceStates(
		"supported",
		"supported",
		"supported",
	),
	"grammar.technique.planar-solid-tumble": surfaceStates(
		"supported",
		"supported",
		"supported",
	),
	"grammar.technique.boolean-difference-rotation": surfaceStates(
		"supported",
		"supported",
		"supported",
	),
	"grammar.technique.inverse-proportion-link": surfaceStates(
		"supported",
		"supported",
		"supported",
	),
	"grammar.technique.arrangement-transition": surfaceStates(
		"supported",
		"supported",
		"supported",
	),
	"grammar.technique.shear-split": surfaceStates(
		"supported",
		"supported",
		"supported",
	),
	"grammar.technique.merge-split-cycle": surfaceStates(
		"supported",
		"supported",
		"supported",
	),
	"grammar.technique.count-growth": surfaceStates(
		"supported",
		"supported",
		"supported",
	),
	"grammar.technique.periodic-afterimage": surfaceStates(
		"supported",
		"supported",
		"supported",
	),
	"grammar.technique.cyclic-path-travel": surfaceStates(
		"supported",
		"supported",
		"supported",
	),
	"grammar.technique.auto-orient-along-path": surfaceStates(
		"supported",
		"supported",
		"supported",
	),
	"grammar.technique.size-speed-parallax": surfaceStates(
		"supported",
		"supported",
		"supported",
	),
	"grammar.technique.reactive-neighbor-displacement": surfaceStates(
		"supported",
		"supported",
		"supported",
	),
	"grammar.technique.lag-follow-through": surfaceStates(
		"supported",
		"supported",
		"supported",
	),
	"grammar.technique.noise-wipe": surfaceStates(
		"supported",
		"supported",
		"supported",
	),
	"grammar.technique.stroke-draw-on": surfaceStates(
		"supported",
		"supported",
		"supported",
	),
	"grammar.technique.collision-bounce": surfaceStates(
		"supported",
		"supported",
		"supported",
	),
} as const satisfies Record<AuthoringCapabilityId, AuthoringSurfaceStateTriple>;

const sourceAnchorsByOwner = {
	scene: [
		"src/widgets/inspector",
		"src/features/agent/model/review-apply.ts",
		"src/entities/scene/model/runner.ts",
	],
	motion: [
		"src/features/motion/ui/MotionTimeline.tsx",
		"src/features/agent/model/review-apply.ts",
		"src/entities/motion/model/runner.ts",
	],
	"motion-grammar": [
		"src/widgets/inspector",
		"src/features/agent/model/review-apply.ts",
		"src/entities/motion-grammar/model/runner.ts",
	],
} as const;

const manifestById = new Map(
	AUTHORING_CAPABILITY_MANIFESTS.map((manifest) => [manifest.id, manifest]),
);

export const AUTHORING_SURFACE_EVIDENCE: readonly AuthoringSurfaceEvidence[] =
	Object.entries(AUTHORING_SURFACE_STATE_BY_CAPABILITY).flatMap(
		([capabilityId, [gui, liveAgent, offlineCommand]]) => {
			const manifest = manifestById.get(capabilityId);
			const anchors = manifest ? sourceAnchorsByOwner[manifest.owner] : [];
			return [
				...(manifest?.requiredOperations ?? []).flatMap((operation) => [
					{
						capabilityId,
						surface: "gui" as const,
						checkId: "operation",
						operation,
						state: gui,
						adapterId: "source-reviewed-gui-adapter",
						sourceAnchorIds: [anchors[0] ?? "missing-owner-anchor"],
					},
					{
						capabilityId,
						surface: "live_agent" as const,
						checkId: "operation",
						operation,
						state: liveAgent,
						adapterId: "source-reviewed-live-agent-adapter",
						sourceAnchorIds: [anchors[1] ?? "missing-owner-anchor"],
					},
					{
						capabilityId,
						surface: "offline_command" as const,
						checkId: "operation",
						operation,
						state: offlineCommand,
						adapterId: "source-reviewed-offline-command-adapter",
						sourceAnchorIds: [anchors[2] ?? "missing-owner-anchor"],
					},
				]),
				{
					capabilityId,
					surface: "import_bootstrap" as const,
					checkId: "portable-ingestion",
					state:
						manifest?.classification === "diagnostic"
							? "not_applicable"
							: "supported",
					adapterId: "portable-project-restore",
					sourceAnchorIds: [
						"src/features/project-backup/model/project-backup.ts",
					],
					reason:
						"Import/bootstrap is ingestion evidence and never contributes to headless mutation support.",
				},
				{
					capabilityId,
					surface: "readback" as const,
					checkId: "typed-observation",
					state: "supported",
					adapterId: "agent-read-model",
					sourceAnchorIds: ["src/entities/agent/model/read-only.ts"],
				},
			];
		},
	);

const orthogonalState = (
	manifest: EntityAuthoringCapabilityManifest,
	dimension: AuthoringOrthogonalEvidence["dimension"],
): AuthoringEvidenceState => {
	if (manifest.classification === "diagnostic") {
		return dimension === "presentation" ? "supported" : "not_applicable";
	}
	if (manifest.classification !== "authorable") return "not_applicable";
	if (dimension === "presentation") {
		return AUTHORING_SURFACE_STATE_BY_CAPABILITY[
			manifest.id as AuthoringCapabilityId
		][0];
	}
	if (dimension === "output_declaration") return "supported";
	return "supported";
};

/**
 * Complete orthogonal schema evidence. Phase 5 per-output fidelity rows back
 * every supported output declaration; missing rows are never treated as an
 * allowlisted operation gap.
 */
export const AUTHORING_ORTHOGONAL_EVIDENCE: readonly AuthoringOrthogonalEvidence[] =
	AUTHORING_CAPABILITY_MANIFESTS.flatMap((manifest) =>
		(
			[
				"history",
				"persistence",
				"presentation",
				"conflict_policy",
				"output_declaration",
			] as const
		).map((dimension) => ({
			capabilityId: manifest.id,
			dimension,
			state: orthogonalState(manifest, dimension),
			adapterId: `source-reviewed-${dimension}`,
			sourceAnchorIds:
				dimension === "persistence"
					? ["src/features/project-backup/model/project-backup.ts"]
					: dimension === "output_declaration"
						? [
								"docs/archive/gui-model-authoring-parity/gui-model-authoring-parity-plan.md#phase-5",
							]
						: sourceAnchorsByOwner[manifest.owner],
		})),
	);

const OUTPUT_RELEVANT_CAPABILITIES = new Set<AuthoringCapabilityId>(
	AUTHORING_OUTPUT_RELEVANT_CAPABILITY_IDS,
);

/** Phase 5 per-output declarations; every non-native tier is surfaced in Export Report. */
export const AUTHORING_OUTPUT_EVIDENCE: readonly AuthoringOutputEvidence[] =
	AUTHORING_CAPABILITY_MANIFESTS.flatMap((manifest) => {
		const outputRelevant = OUTPUT_RELEVANT_CAPABILITIES.has(
			manifest.id as AuthoringCapabilityId,
		);
		if (!outputRelevant) {
			return [
				{
					capabilityId: manifest.id,
					outputId: "not-applicable",
					fidelity: "not_applicable" as const,
					limitationVisible: true,
					adapterId: "non-rendered-authoring-capability",
					sourceAnchorIds: [
						"docs/archive/gui-model-authoring-parity/gui-model-authoring-parity-plan.md#full-parity-contract",
					],
				},
			];
		}
		return AUTHORING_OUTPUT_TIER_DECLARATIONS.map((evidence) => ({
			...evidence,
			capabilityId: manifest.id,
			limitationVisible: true,
		}));
	});

export const COMPOUND_AUTHORING_WORKFLOWS = [
	{
		id: "workflow.agent.cross-store-plan",
		coordinatorId: "features/agent/model/review-apply",
		participantOwners: ["scene", "motion", "motion-grammar"],
		requiredEvidenceIds: [
			"preflight",
			"apply-or-no-change",
			"rollback-after-later-store-failure",
			"single-global-history-unit",
		],
		supportedExceptionIds: [],
		state: "supported",
		destinationPhase: "4",
		exposure: "typed-limitation",
	},
] as const satisfies readonly CompoundAuthoringWorkflowContract[];

export const AUTHORING_PARITY_GAP_GROUPS =
	[] as const satisfies readonly AuthoringGapGroup[];
