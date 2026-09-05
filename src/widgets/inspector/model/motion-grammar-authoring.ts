import {
	createAnimationClip,
	deleteAnimationClip,
	retargetMotionNodeReferences,
} from "@/entities/motion/model/commands";
import { useMotionStore } from "@/entities/motion/model/store";
import type { MotionDocument } from "@/entities/motion/model/types";
import {
	createAfterimageSelectedSourceBindingCommand,
	planAfterimageSelectedSourceBinding,
} from "@/entities/motion-grammar/model/afterimage-selected-source-authoring";
import {
	type MotionGrammarAuthoringExpansionCapability,
	type MotionGrammarAuthoringProfileDescriptor,
	normalizeMotionGrammarAuthoringParameterPatch,
} from "@/entities/motion-grammar/model/authoring-profile";
import { describeMotionGrammarAuthoringProfile } from "@/entities/motion-grammar/model/authoring-profile-registry";
import {
	authorableTechniqueIds,
	findCatalogEntry,
} from "@/entities/motion-grammar/model/catalog";
import { createCollisionBounceBakeCommands } from "@/entities/motion-grammar/model/collision-bounce-bake";
import {
	applyGrammarBinding,
	removeGrammarBinding,
	updateGrammarBinding,
} from "@/entities/motion-grammar/model/commands";
import {
	createMotionGrammarDecompositionPlan,
	type MotionGrammarDecompositionIssue,
	type MotionGrammarDecompositionPlan,
	normalizeMotionGrammarDecompositionSampleStep,
} from "@/entities/motion-grammar/model/decomposition";
import { createMotionGrammarEditableExpansionCommandPlan } from "@/entities/motion-grammar/model/editable-expansion";
import {
	FOLLOW_THROUGH_LEAD_ADAPTER_TECHNIQUE_ID,
	followThroughLeadAdapterActiveEndFrame,
	isFollowThroughLeadAdapterParameters,
	planFollowThroughLeadAdapterBinding,
	validateFollowThroughLeadAdapterBinding,
} from "@/entities/motion-grammar/model/follow-through-lead-binding";
import {
	editRandomPulseProfile,
	RANDOM_PULSE_PROFILE_DEFAULT,
	type RandomPulseProfileEdit,
} from "@/entities/motion-grammar/model/random-pulse-profile";
import {
	createMotionGrammarRoleReplacementPlan,
	type MotionGrammarRoleReplacementPlan,
} from "@/entities/motion-grammar/model/replacement";
import { useMotionGrammarStore } from "@/entities/motion-grammar/model/store";
import { createStrokeDrawOnAuthoringPlan } from "@/entities/motion-grammar/model/stroke-draw-on-authoring";
import {
	createMotionGrammarTechniqueWorkspaceClipInput,
	createMotionGrammarTechniqueWorkspaceMotionCommands,
	createMotionGrammarTechniqueWorkspacePreview,
	createMotionGrammarTechniqueWorkspaceSceneCommands,
	type MotionGrammarTechniqueWorkspacePlan,
	motionGrammarTechniqueCommitsOnApply,
	motionGrammarTechniqueWorkspaceCreatedClipId,
	motionGrammarTechniqueWorkspaceInitialFrame,
} from "@/entities/motion-grammar/model/technique-module";
import type {
	MotionGrammarBinding,
	MotionGrammarParamSpec,
	MotionGrammarTechniqueFamily,
	MotionGrammarTechniqueId,
} from "@/entities/motion-grammar/model/types";
import { createMotionGrammarNewBindingDefaults } from "@/entities/motion-grammar/model/versioned-expression-binding";
import {
	MOTION_GRAMMAR_WORKSPACE_ROLE_DATA_KEY,
	type MotionGrammarWorkspaceRoleData,
	motionGrammarWorkspaceRoleLabel,
} from "@/entities/motion-grammar/model/workspace-instance";
import { createDeleteNodesCommand } from "@/entities/scene/model/node-commands";
import {
	allNodes,
	findNode,
	selectArtboardIdForNode,
} from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import type { SceneDocument } from "@/entities/scene/model/types";
import { useMotionClipSelectionStore } from "@/features/motion/model/clip-selection-store";
import { useTransportStore } from "@/features/motion/model/transport-store";
import { ensureSceneCameraBeforeSpatialAuthoring } from "@/features/scene-camera/model/authoring";
import { useSelectionStore } from "@/features/selection/model/store";
import { commitInspectorCompound } from "./compound-authoring";

/**
 * Inspector adapter for motion-grammar authoring. The inspector renders controls;
 * these helpers turn control intent into undoable command-bus operations across
 * the grammar, scene, and motion stores. Kept out of the React component so the
 * mapping stays testable-by-reading and the UI stays declarative.
 */

const AUTHORABLE_TECHNIQUE_IDS = authorableTechniqueIds();

export type MotionGrammarTechniqueOption = {
	readonly id: MotionGrammarTechniqueId;
	readonly label: string;
	readonly family: MotionGrammarTechniqueFamily;
	readonly minTargets: number;
	readonly disabled: boolean;
	readonly needsMoreTargets: boolean;
};

export type MotionGrammarRoleReplacementSelection =
	| {
			readonly status: "blocked";
			readonly reason: string;
	  }
	| {
			readonly status: "ready";
			readonly roleLabel: string;
			readonly plan: Extract<
				MotionGrammarRoleReplacementPlan,
				{ readonly status: "ready" }
			>;
	  };

export type MotionGrammarRoleReplacementCommitResult =
	| {
			readonly status: "blocked";
			readonly reason: string;
	  }
	| {
			readonly status: "replaced";
			readonly roleLabel: string;
			readonly fromNodeId: string;
			readonly toNodeId: string;
	  };

export type MotionGrammarWorkspaceInstancePreview =
	| {
			readonly status: "blocked";
			readonly reason: string;
	  }
	| {
			readonly status: "ready";
			readonly label: string;
			readonly plan: MotionGrammarTechniqueWorkspacePlan;
	  };

export type MotionGrammarWorkspaceInstanceCommitResult =
	| {
			readonly status: "blocked";
			readonly reason: string;
	  }
	| {
			readonly status: "created";
			readonly label: string;
			readonly generatedNodeCount: number;
			readonly selectedNodeIds: readonly string[];
	  };

export type MotionGrammarRoleItem = {
	readonly nodeId: string;
	readonly label: string;
	readonly nodeName: string;
};

/** Source-binding outcome previewed for a future decomposition bake. */
export type MotionGrammarExpansionSourceDisposition = "archive" | "remove";

/** Visual severity token used by compact Inspector decomposition issue chips. */
export type MotionGrammarExpansionIssueTone =
	| "accent"
	| "danger"
	| "muted"
	| "warn";

/** Compact display model for one decomposition warning, blocker, or pending emitter. */
export type MotionGrammarExpansionIssueItem = {
	readonly key: string;
	readonly label: string;
	readonly title: string;
	readonly tone: MotionGrammarExpansionIssueTone;
};

/** Compact display model for generated output estimates. */
export type MotionGrammarExpansionEstimateItem = {
	readonly label: string;
	readonly value: string;
	readonly title: string;
};

/** Read-only Inspector view of a binding's shared decomposition plan. */
export type MotionGrammarExpansionPreview = {
	readonly plan: MotionGrammarDecompositionPlan;
	readonly expansion: MotionGrammarAuthoringExpansionCapability;
	readonly sourceDisposition: MotionGrammarExpansionSourceDisposition;
	readonly sourceDispositionLabel: string;
	readonly sourceDispositionTitle: string;
	readonly frameRangeLabel: string;
	readonly sampleStepLabel: string;
	readonly estimateItems: readonly MotionGrammarExpansionEstimateItem[];
	readonly issueItems: readonly MotionGrammarExpansionIssueItem[];
	readonly blockerLabels: readonly string[];
	readonly canBake: boolean;
	readonly bakeStatusLabel: string;
	readonly bakeButtonTitle: string;
};

/** UI-facing bake request state; blocked requests intentionally perform no store writes. */
export type MotionGrammarBakeRequest =
	| {
			readonly status: "blocked";
			readonly plan: MotionGrammarDecompositionPlan;
			readonly blockerLabels: readonly string[];
	  }
	| {
			readonly status: "ready";
			readonly plan: MotionGrammarDecompositionPlan;
			readonly sourceDisposition: MotionGrammarExpansionSourceDisposition;
	  };

export type MotionGrammarEditableExpansionRequest = MotionGrammarBakeRequest;

/** Result of applying one Inspector bake request through scene/motion stores. */
export type MotionGrammarBakeCommitResult =
	| {
			readonly status: "blocked";
			readonly blockerLabels: readonly string[];
	  }
	| {
			readonly status: "committed";
			readonly generatedNodeCount: number;
			readonly scalarTrackCount: number;
			readonly snapshotTrackCount: number;
			readonly automationTrackCount: number;
			readonly clipCount: number;
			readonly editableArtifactCount: number;
			readonly warningCount: number;
	  };

export type MotionGrammarEditableExpansionCommitResult =
	MotionGrammarBakeCommitResult;

const PARAMETER_LABELS: Readonly<Record<string, string>> = {
	angleOffset: "Angle offset deg",
	cadenceFrames: "Cadence frames",
	copies: "Copies",
	decay: "Opacity decay",
	delayFrames: "Delay frames",
	growFrames: "Grow frames",
	lookAheadFrames: "Look-ahead frames",
	maxScaleBoost: "Max scale boost",
	minProjection: "Projection floor",
	offsetMultiplier: "Offset multiplier",
	opacityFloor: "Opacity floor",
	periodFrames: "Period frames",
	phaseStaggerFrames: "Phase stagger frames",
	phaseStepDegrees: "Phase step deg",
	pulseFrames: "Pulse frames",
	radius: "Radius px",
	radiusPx: "Radius px",
	response: "Response",
	rotationDegrees: "Rotation deg",
	scaleAmplitude: "Scale amplitude",
	scaleFloor: "Scale floor",
	scalePerSpeed: "Scale per speed",
	splitDistance: "Split distance px",
	staggerFrames: "Stagger frames",
	strength: "Strength",
	tiltDegrees: "Tilt deg",
	wavelengthPx: "Wavelength px",
};

/** Returns whether the current ordered selection can apply the given technique. */
export function isTechniqueApplicableToTargetCount(
	techniqueId: MotionGrammarTechniqueId,
	targetCount: number,
): boolean {
	if (techniqueId === "stroke-draw-on" && targetCount !== 1) return false;
	const entry = findCatalogEntry(techniqueId);
	if (entry?.status !== "implemented" || targetCount < entry.minTargets) {
		return false;
	}
	return (
		createMotionGrammarNewBindingDefaults(
			techniqueId,
			Array.from({ length: targetCount }, (_value, index) => `target-${index}`),
		).status === "ready"
	);
}

/**
 * Technique ids that can be applied without changing the current selection.
 * Disabled picker options still come from the full catalog; this helper drives
 * the default/fallback so the Inspector never lands on an impossible action.
 */
export function applicableTechniqueIdsForTargetCount(
	targetCount: number,
): readonly MotionGrammarTechniqueId[] {
	return AUTHORABLE_TECHNIQUE_IDS.filter((id) =>
		isTechniqueApplicableToTargetCount(id, targetCount),
	);
}

/** Chooses the first catalog-backed action that is valid for the target count. */
export function defaultTechniqueIdForTargetCount(
	targetCount: number,
): MotionGrammarTechniqueId {
	return (
		applicableTechniqueIdsForTargetCount(targetCount)[0] ??
		AUTHORABLE_TECHNIQUE_IDS[0] ??
		"time-delay"
	);
}

/**
 * Picker options annotate target-count eligibility without hiding techniques.
 * Apply remains gated by target count; workspace-instance techniques may still
 * create their role-bearing object system from an underspecified selection.
 */
export function techniqueOptionsForTargetCount(
	targetCount: number,
): readonly MotionGrammarTechniqueOption[] {
	return AUTHORABLE_TECHNIQUE_IDS.map((id) => {
		const entry = findCatalogEntry(id);
		const minTargets = entry?.minTargets ?? 1;
		const applicable = isTechniqueApplicableToTargetCount(id, targetCount);
		return {
			id,
			label: entry?.label ?? id,
			family: entry?.family ?? "temporal-placement",
			minTargets,
			disabled: !applicable,
			needsMoreTargets: targetCount < minTargets,
		};
	});
}

/** First binding that governs any node in the current selection, if any. */
export function grammarBindingForNodes(
	bindings: readonly MotionGrammarBinding[],
	nodeIds: readonly string[],
): MotionGrammarBinding | undefined {
	const selected = new Set(nodeIds);
	return bindings.find((binding) => {
		if (binding.targetIds.some((id) => selected.has(id))) return true;
		return Object.keys(binding.roleMap ?? {}).some((id) => selected.has(id));
	});
}

const uniqueNodeIds = (nodeIds: readonly string[]): readonly string[] => [
	...new Set(nodeIds),
];

const roleLabelForNode = (
	binding: MotionGrammarBinding,
	nodeId: string,
): string => {
	const explicitRole = binding.roleMap?.[nodeId];
	if (explicitRole) {
		return motionGrammarWorkspaceRoleLabel(binding.techniqueId, explicitRole);
	}
	const index = binding.targetIds.indexOf(nodeId);
	return index >= 0 ? `target ${index + 1}` : "role";
};

/** Compact role readout for selected nodes inside a materialized grammar binding. */
export function selectedMotionGrammarRoleItems({
	binding,
	scene,
	selectedNodeIds,
}: {
	readonly binding: MotionGrammarBinding;
	readonly scene: SceneDocument;
	readonly selectedNodeIds: readonly string[];
}): readonly MotionGrammarRoleItem[] {
	const bindingMemberIds = new Set([
		...binding.targetIds,
		...Object.keys(binding.roleMap ?? {}),
	]);
	const orderedNodeIds = uniqueNodeIds(selectedNodeIds).filter((nodeId) =>
		bindingMemberIds.has(nodeId),
	);
	return orderedNodeIds.map((nodeId) => ({
		nodeId,
		label: roleLabelForNode(binding, nodeId),
		nodeName: findNode(scene, nodeId)?.name ?? nodeId,
	}));
}

const isMotionGrammarWorkspaceRoleData = (
	value: unknown,
): value is MotionGrammarWorkspaceRoleData => {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<MotionGrammarWorkspaceRoleData>;
	return (
		candidate.kind === "motion-grammar-workspace-role" &&
		candidate.schemaVersion === 1 &&
		typeof candidate.bindingId === "string" &&
		typeof candidate.role === "string" &&
		typeof candidate.generated === "boolean" &&
		typeof candidate.replaceable === "boolean"
	);
};

const replacementShouldRemoveGeneratedSource = ({
	binding,
	scene,
	fromNodeId,
}: {
	readonly binding: MotionGrammarBinding;
	readonly scene: SceneDocument;
	readonly fromNodeId: string;
}): boolean => {
	const node = findNode(scene, fromNodeId);
	const roleData = isMotionGrammarWorkspaceRoleData(
		node?.data?.[MOTION_GRAMMAR_WORKSPACE_ROLE_DATA_KEY],
	)
		? node.data[MOTION_GRAMMAR_WORKSPACE_ROLE_DATA_KEY]
		: undefined;
	return Boolean(
		roleData &&
			roleData.bindingId === binding.id &&
			roleData.techniqueId === binding.techniqueId &&
			roleData.generated &&
			roleData.replaceable,
	);
};

/**
 * Resolves the compact Inspector gesture for role replacement: select exactly
 * one object already participating in the binding and one object outside the
 * binding. The outside object can be imported artwork once import has produced a
 * normal scene node.
 */
export function motionGrammarRoleReplacementForSelection({
	binding,
	motion,
	selectedNodeIds,
}: {
	readonly binding: MotionGrammarBinding;
	readonly motion: MotionDocument;
	readonly selectedNodeIds: readonly string[];
}): MotionGrammarRoleReplacementSelection {
	const uniqueSelection = uniqueNodeIds(selectedNodeIds);
	const bindingMemberIds = new Set([
		...binding.targetIds,
		...Object.keys(binding.roleMap ?? {}),
	]);
	const roleNodeIds = uniqueSelection.filter((nodeId) =>
		binding.targetIds.includes(nodeId),
	);
	const replacementNodeIds = uniqueSelection.filter(
		(nodeId) => !bindingMemberIds.has(nodeId),
	);
	if (roleNodeIds.length !== 1 || replacementNodeIds.length !== 1) {
		return {
			status: "blocked",
			reason:
				"Select one motion role object and one replacement object to replace a role.",
		};
	}
	const plan = createMotionGrammarRoleReplacementPlan({
		binding,
		motion,
		fromNodeId: roleNodeIds[0],
		toNodeId: replacementNodeIds[0],
	});
	if (plan.status === "blocked") {
		return { status: "blocked", reason: plan.reason };
	}
	return {
		status: "ready",
		roleLabel: roleLabelForNode(binding, plan.fromNodeId),
		plan,
	};
}

/** Commits one role replacement through grammar and motion command surfaces. */
export function commitReplaceMotionGrammarRole({
	binding,
	motion,
	selectedNodeIds,
}: {
	readonly binding: MotionGrammarBinding;
	readonly motion: MotionDocument;
	readonly selectedNodeIds: readonly string[];
}): MotionGrammarRoleReplacementCommitResult {
	const selection = motionGrammarRoleReplacementForSelection({
		binding,
		motion,
		selectedNodeIds,
	});
	if (selection.status === "blocked") return selection;

	const { plan } = selection;
	const candidate: MotionGrammarBinding = {
		...binding,
		targetIds: [...plan.nextTargetIds],
		...(plan.nextRoleMap ? { roleMap: { ...plan.nextRoleMap } } : {}),
	};
	if (
		isFollowThroughLeadAdapterParameters(
			candidate.techniqueId,
			candidate.parameters,
		)
	) {
		const scene = useSceneStore.getState().document;
		const issue = validateFollowThroughLeadAdapterBinding({
			scene,
			motion,
			binding: candidate,
			activeEndFrameExclusive: followThroughLeadAdapterActiveEndFrame(
				motion,
				candidate.id,
			),
		});
		if (issue) return { status: "blocked", reason: issue };
	}
	const transactionKey = `motion-grammar:replace-role:${binding.id}:${plan.fromNodeId}:${plan.toNodeId}`;
	const transactionLabel = "Replace motion role";
	const removeGeneratedSource = replacementShouldRemoveGeneratedSource({
		binding,
		scene: useSceneStore.getState().document,
		fromNodeId: plan.fromNodeId,
	});
	commitInspectorCompound({
		compoundId: transactionKey,
		label: transactionLabel,
		sceneCommands: removeGeneratedSource
			? [createDeleteNodesCommand([plan.fromNodeId])]
			: [],
		motionCommands:
			plan.retargetTrackIds.length > 0 || plan.retargetClipIds.length > 0
				? [
						retargetMotionNodeReferences({
							fromNodeId: plan.fromNodeId,
							toNodeId: plan.toNodeId,
							bindingId: binding.id,
						}),
					]
				: [],
		grammarCommands: [
			updateGrammarBinding(binding.id, {
				targetIds: plan.nextTargetIds,
				roleMap: plan.nextRoleMap,
			}),
		],
	});
	if (removeGeneratedSource) {
		useSelectionStore.getState().setSelection([plan.toNodeId], plan.toNodeId);
	}

	return {
		status: "replaced",
		roleLabel: selection.roleLabel,
		fromNodeId: plan.fromNodeId,
		toNodeId: plan.toNodeId,
	};
}

/** Plans an editable workspace system for the selected preset, when supported. */
export function motionGrammarWorkspaceInstanceForSelection({
	techniqueId,
	scene,
	selectedNodeIds,
}: {
	readonly techniqueId: MotionGrammarTechniqueId;
	readonly scene: SceneDocument;
	readonly selectedNodeIds: readonly string[];
}): MotionGrammarWorkspaceInstancePreview {
	return createMotionGrammarTechniqueWorkspacePreview({
		techniqueId,
		scene,
		selectedNodeIds,
	});
}

/** Commits a role-bearing workspace system through scene and grammar commands. */
export function commitCreateMotionGrammarWorkspaceInstance({
	techniqueId,
	scene,
	selectedNodeIds,
}: {
	readonly techniqueId: MotionGrammarTechniqueId;
	readonly scene: SceneDocument;
	readonly selectedNodeIds: readonly string[];
}): MotionGrammarWorkspaceInstanceCommitResult {
	const preview = motionGrammarWorkspaceInstanceForSelection({
		techniqueId,
		scene,
		selectedNodeIds,
	});
	if (preview.status === "blocked") return preview;

	const transactionKey = `motion-grammar:create-workspace-instance:${preview.plan.binding.id}`;
	const transactionLabel = `Create ${preview.label}`;
	const sceneCommands = createMotionGrammarTechniqueWorkspaceSceneCommands({
		plan: preview.plan,
		label: transactionLabel,
		coalesceKey: transactionKey,
	});
	const motionCommands = createMotionGrammarTechniqueWorkspaceMotionCommands({
		plan: preview.plan,
		label: transactionLabel,
		coalesceKey: transactionKey,
	});
	const workspaceClip = createMotionGrammarTechniqueWorkspaceClipInput(
		preview.plan,
	);
	commitInspectorCompound({
		compoundId: transactionKey,
		label: transactionLabel,
		sceneCommands,
		motionCommands: [
			...motionCommands,
			...(workspaceClip ? [createAnimationClip(workspaceClip)] : []),
		],
		grammarCommands: [applyGrammarBinding(preview.plan.binding)],
	});

	useSelectionStore
		.getState()
		.setSelection(
			preview.plan.nextSelectionNodeIds,
			preview.plan.nextSelectionNodeIds.at(-1) ?? null,
		);
	const selectedClipId =
		workspaceClip?.id ??
		motionGrammarTechniqueWorkspaceCreatedClipId(preview.plan);
	if (selectedClipId) {
		useMotionClipSelectionStore.getState().setSelectedClipId(selectedClipId);
	}
	const initialFrame = motionGrammarTechniqueWorkspaceInitialFrame(
		preview.plan,
	);
	if (initialFrame !== null)
		useTransportStore.getState().setFrame(initialFrame);

	return {
		status: "created",
		label: preview.label,
		generatedNodeCount: preview.plan.generatedNodes.length,
		selectedNodeIds: preview.plan.nextSelectionNodeIds,
	};
}

/** Expands terse catalog labels into Inspector labels that remain clear out of context. */
export function grammarParameterLabel(spec: MotionGrammarParamSpec): string {
	return PARAMETER_LABELS[spec.key] ?? spec.label;
}

/** Formats stored grammar numbers without trailing floating-point dust. */
export function formatGrammarParameterValue(value: number): string {
	return Number.isInteger(value)
		? String(value)
		: String(Number(value.toFixed(4)));
}

/** Applies the catalog min/max envelope to an Inspector parameter edit. */
export function clampGrammarParameterValue(
	value: number,
	spec: MotionGrammarParamSpec,
): number {
	return Math.min(Math.max(value, spec.min), spec.max);
}

/** Parses a typed parameter draft; invalid or empty input means "revert". */
export function parseGrammarParameterDraft(
	draft: string,
	spec: MotionGrammarParamSpec,
): number | null {
	const trimmed = draft.trim();
	if (trimmed.length === 0) return null;
	const parsed = Number(trimmed);
	if (!Number.isFinite(parsed)) return null;
	return clampGrammarParameterValue(parsed, spec);
}

/** Normalizes Inspector sample-step input before building a decomposition preview. */
export function normalizeMotionGrammarExpansionSampleStep(
	value: number | undefined,
): number {
	return normalizeMotionGrammarDecompositionSampleStep(value);
}

const issueSubject = (issue: MotionGrammarDecompositionIssue): string =>
	issue.channel ?? issue.outputKind ?? issue.property ?? issue.code;

const issueTone = (
	issue: MotionGrammarDecompositionIssue,
): MotionGrammarExpansionIssueTone => {
	if (issue.severity === "error") return "danger";
	if (issue.code === "large-output-estimate") return "warn";
	if (issue.code === "pending-emitter") return "accent";
	return "muted";
};

const issueLabel = (issue: MotionGrammarDecompositionIssue): string => {
	const subject = issueSubject(issue);
	switch (issue.code) {
		case "missing-target":
			return "Missing target";
		case "insufficient-targets":
			return "Insufficient targets";
		case "pending-emitter":
			return `Pending ${subject}`;
		case "large-output-estimate":
			return "Large output";
		case "empty-output":
			return "No output";
		case "expression-bake-unsupported":
			return "Live-only expression";
		case "expression-version-unsupported":
			return "Unsupported expression version";
	}
};

const expansionIssueItems = (
	plan: MotionGrammarDecompositionPlan,
): readonly MotionGrammarExpansionIssueItem[] =>
	plan.issues.map((issue, index) => ({
		key: `${issue.code}:${issueSubject(issue)}:${index}`,
		label: issueLabel(issue),
		title: issue.message,
		tone: issueTone(issue),
	}));

const plural = (
	count: number,
	singular: string,
	pluralLabel: string,
): string => (count === 1 ? singular : pluralLabel);

const expansionBlockerLabels = (
	plan: MotionGrammarDecompositionPlan,
): readonly string[] => {
	const blockers: string[] = [];
	const errorCount = plan.issues.filter(
		(issue) => issue.severity === "error",
	).length;
	if (errorCount > 0) {
		blockers.push(
			`${errorCount} ${plural(errorCount, "blocking issue", "blocking issues")}`,
		);
	}
	if (plan.outputs.length === 0) blockers.push("No planned outputs");
	return blockers;
};

const sourceDispositionTitle = (
	disposition: MotionGrammarExpansionSourceDisposition,
): string =>
	disposition === "archive"
		? "Original grammar binding will remain available after editable motion is created."
		: "Original grammar binding will be removed after editable motion is created.";

const fallbackExpansionCapability: MotionGrammarAuthoringExpansionCapability = {
	mode: "editable-motion",
	label: "Editable output",
	actionLabel: "Create editable motion",
	previewLabel: "Preview editable output",
	description:
		"Creates editable scene, timeline, and artifact output from the motion grammar decomposition plan.",
	outputSummary:
		"Decomposition output becomes ordinary editable Vecmo motion artifacts.",
};

/**
 * Creates the Inspector-facing expansion preview from the shared decomposition
 * IR. This is intentionally read-only: downstream emitters must materialize the
 * returned plan through scene/motion command surfaces before editable output can
 * mutate stores.
 */
export function createMotionGrammarExpansionPreview({
	binding,
	scene,
	motion,
	profile,
	sampleStepFrames,
	sourceDisposition,
}: {
	readonly binding: MotionGrammarBinding;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly profile?: MotionGrammarAuthoringProfileDescriptor;
	readonly sampleStepFrames?: number;
	readonly sourceDisposition: MotionGrammarExpansionSourceDisposition;
}): MotionGrammarExpansionPreview {
	const plan = createMotionGrammarDecompositionPlan({
		binding,
		scene,
		motion,
		sampleStepFrames,
		includeClip: true,
	});
	const blockerLabels = expansionBlockerLabels(plan);
	const canBake = blockerLabels.length === 0;
	const expansion = profile?.expansion ?? fallbackExpansionCapability;
	const sourceDispositionLabel =
		sourceDisposition === "archive" ? "Archive" : "Remove";
	const frameRangeLabel = `${plan.frameRange.startFrame}-${plan.frameRange.endFrame}f`;
	const sampleStepLabel = `${plan.sampleStepFrames}f`;
	const editableTrackCount =
		plan.estimates.scalarTrackCount + plan.estimates.editableArtifactTrackCount;
	const estimateItems: readonly MotionGrammarExpansionEstimateItem[] = [
		{
			label: "Nodes",
			value: String(plan.estimates.generatedNodeCount),
			title: "Estimated generated scene nodes",
		},
		{
			label: "Tracks",
			value: String(editableTrackCount),
			title: "Estimated editable scalar and snapshot motion tracks",
		},
		{
			label: "Clips",
			value: String(plan.estimates.clipCount),
			title: "Estimated timeline clips",
		},
		{
			label: "Artifacts",
			value: String(plan.estimates.editableArtifactCount),
			title: "Estimated editable non-scalar artifacts",
		},
		{
			label: "Keys",
			value: `<=${plan.estimates.keyframeCount}`,
			title: "Upper-bound keyframes before emitter coalescing",
		},
	];

	return {
		plan,
		expansion,
		sourceDisposition,
		sourceDispositionLabel,
		sourceDispositionTitle: sourceDispositionTitle(sourceDisposition),
		frameRangeLabel,
		sampleStepLabel,
		estimateItems,
		issueItems: expansionIssueItems(plan),
		blockerLabels,
		canBake,
		bakeStatusLabel: canBake ? "Ready" : "Blocked",
		bakeButtonTitle: canBake
			? `${expansion.actionLabel} for ${frameRangeLabel}; source ${sourceDispositionLabel.toLowerCase()}`
			: `${expansion.label} blocked: ${blockerLabels.join("; ")}`,
	};
}

/**
 * Converts the current preview into a bake request state. The request remains
 * blocked while the shared IR reports invalid targets or empty output.
 */
export function createMotionGrammarBakeRequest(
	preview: MotionGrammarExpansionPreview,
): MotionGrammarBakeRequest {
	if (!preview.canBake) {
		return {
			status: "blocked",
			plan: preview.plan,
			blockerLabels: preview.blockerLabels,
		};
	}
	return {
		status: "ready",
		plan: preview.plan,
		sourceDisposition: preview.sourceDisposition,
	};
}

/** Creates the command-facade request used by product UI wording. */
export function createMotionGrammarEditableExpansionRequest(
	preview: MotionGrammarExpansionPreview,
): MotionGrammarEditableExpansionRequest {
	return createMotionGrammarBakeRequest(preview);
}

/**
 * Materializes the current expansion plan into ordinary scene nodes, motion
 * tracks, and timeline clips. Store mutation stays behind the existing command
 * buses; the function coordinates transaction labels only.
 */
export function commitBakeMotionGrammarExpansion({
	binding,
	scene,
	motion,
	preview,
}: {
	readonly binding: MotionGrammarBinding;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly preview: MotionGrammarExpansionPreview;
}): MotionGrammarBakeCommitResult {
	const plan = createMotionGrammarEditableExpansionCommandPlan({
		binding,
		scene,
		motion,
		sampleStepFrames: preview.plan.sampleStepFrames,
		sourceDisposition: preview.sourceDisposition,
	});
	if (plan.status === "blocked") {
		return { status: "blocked", blockerLabels: plan.reasons };
	}
	const transactionKey = `motion-grammar:expand:${binding.id}`;
	const transactionLabel = "Create Editable Motion";
	commitInspectorCompound({
		compoundId: transactionKey,
		label: transactionLabel,
		sceneCommands: plan.sceneCommands,
		motionCommands: plan.motionCommands,
		grammarCommands: plan.grammarCommands,
	});
	return { status: "committed", ...plan.summary };
}

/** Result of the collision-bounce-specific sparse bake action. */
export type CollisionBounceBakeCommitResult =
	| { readonly status: "blocked"; readonly reason: string }
	| {
			readonly status: "committed";
			readonly targetCount: number;
			readonly keyCount: number;
	  };

/** Generated scene-node ids this binding owns (support guide etc.), per the same role-data tag `commitCreateMotionGrammarWorkspaceInstance` stamps on Create System. */
const generatedNodeIdsForBinding = (
	scene: SceneDocument,
	bindingId: string,
): readonly string[] =>
	allNodes(scene)
		.filter((node) => {
			const roleData = node.data?.[MOTION_GRAMMAR_WORKSPACE_ROLE_DATA_KEY];
			return (
				isMotionGrammarWorkspaceRoleData(roleData) &&
				roleData.bindingId === bindingId &&
				roleData.generated
			);
		})
		.map((node) => node.id);

/** Workspace clip id(s) this binding created via `createProfileBackedWorkspaceClipInput`'s provenance tag, if any. */
const workspaceClipIdsForBinding = (
	motion: MotionDocument,
	bindingId: string,
): readonly string[] =>
	motion.clips
		.filter((clip) => clip.provenance?.bindingId === bindingId)
		.map((clip) => clip.id);

/**
 * Collision Bounce's own explicit bake, distinct from
 * {@link commitBakeMotionGrammarExpansion}: that generic path decomposes
 * through `createMotionGrammarDecompositionPlan`'s dense per-frame LINEAR
 * pipeline, which `docs/knowledge/bounce-canonical-representation.md`
 * rejects for this verb (collision-bounce's decomposition-coverage row is
 * intentionally empty so the generic button always reports "blocked", never
 * silently emitting that representation). This commits
 * `createCollisionBounceBakeCommands`'s sparse beat-anchored MotionCommands
 * instead, through the same motion-store transaction pattern every other
 * technique-module commit in this file uses, then removes the live binding
 * so the new tracks become sole source of truth (mirrors
 * `createApplyMotionGrammarScalarTracksCommand`'s "post-bake source of
 * truth" contract).
 *
 * Also cascade-removes any Create-System-generated workspace artifacts this
 * binding owns (a generated `support` guide node, its workspace clip) in the
 * SAME `transactionKey` as the bake and binding removal, mirroring
 * `commitBakeMotionGrammarExpansion`'s cross-store transaction pattern — a
 * baked bounce has no further use for a floating, now-inert guide node or an
 * empty authoring clip, and leaving them behind would silently orphan scene
 * content. A binding whose support role is a pre-existing (non-generated)
 * scene node, or `supportMode: floor-line` with no support role at all,
 * naturally has nothing to cascade (`generatedNodeIdsForBinding` returns
 * empty) — that plain-apply/floor-line path is otherwise untouched. Because
 * every store shares one `transactionKey`, undo restores the binding, the
 * generated node(s), and the workspace clip, and removes the baked keys, as
 * one user-visible step. User-triggered only; nothing calls this
 * automatically on apply or Create System.
 */
export function commitBakeCollisionBounce({
	binding,
	scene,
}: {
	readonly binding: MotionGrammarBinding;
	readonly scene: SceneDocument;
}): CollisionBounceBakeCommitResult {
	const result = createCollisionBounceBakeCommands({ binding, scene });
	if (result.status === "blocked") {
		return { status: "blocked", reason: result.reason };
	}
	if (result.commands.length === 0) {
		return { status: "blocked", reason: "Nothing to bake." };
	}

	const transactionKey = `motion-grammar:bake-collision-bounce:${binding.id}`;
	const transactionLabel = "Bake Collision Bounce";
	const motion = useMotionStore.getState().document;

	const generatedNodeIds = generatedNodeIdsForBinding(scene, binding.id);
	commitInspectorCompound({
		compoundId: transactionKey,
		label: transactionLabel,
		sceneCommands:
			generatedNodeIds.length > 0
				? [createDeleteNodesCommand(generatedNodeIds)]
				: [],
		motionCommands: [
			...result.commands,
			...workspaceClipIdsForBinding(motion, binding.id).map((clipId) =>
				deleteAnimationClip(clipId),
			),
		],
		grammarCommands: [removeGrammarBinding(binding.id)],
	});

	const keyCount = result.targets.reduce(
		(sum, target) =>
			sum +
			target.positionKeyCount * 2 +
			target.deformationKeyCount * 2 +
			target.rotationKeyCount,
		0,
	);
	return { status: "committed", targetCount: result.targets.length, keyCount };
}

/** Applies a profile-visible editable expansion through the shared command buses. */
export function commitCreateMotionGrammarEditableExpansion(input: {
	readonly binding: MotionGrammarBinding;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly preview: MotionGrammarExpansionPreview;
}): MotionGrammarEditableExpansionCommitResult {
	return commitBakeMotionGrammarExpansion(input);
}

/**
 * Camera-first just-in-time guard for motion-grammar technique application
 * (Phase P4: `docs/3d-camera-motion-standards-plan.md` §4 P4). Every
 * technique application counts as spatial motion uniformly, regardless of
 * technique — mirroring `agent.motion-without-scene-camera`'s own choice not
 * to classify per-technique output channels (deliberately NOT the
 * decomposition coverage matrix: `collision-bounce`'s coverage row in
 * `decomposition.ts` is empty for bake-representation reasons even though it
 * is a canonical spatial position+rotation technique, so a coverage-based
 * classifier would wrongly skip the one technique this standard cares about
 * most; harmless-over-trigger is the same tradeoff the validation rule
 * already accepts, with `cameraSpacePolicy: "screen_2d"` as the escape
 * hatch). Ensures one camera per distinct target artboard that lacks one.
 * Returns the last-created compound id, if any, for the caller to fold onto
 * its own commit for a shared undo step; multiple target artboards each
 * needing a fresh camera fall back to separate undo steps per artboard
 * (rare — most technique applies target one artboard).
 */
const ensureSceneCamerasForGrammarTargets = (
	scene: SceneDocument,
	nodeIds: readonly string[],
): string | undefined => {
	const artboardIds = new Set(
		nodeIds
			.map((nodeId) => selectArtboardIdForNode(scene, nodeId))
			.filter((artboardId): artboardId is string => artboardId !== undefined),
	);
	let compoundId: string | undefined;
	for (const artboardId of artboardIds) {
		const result = ensureSceneCameraBeforeSpatialAuthoring({
			artboardId,
			isSpatial: true,
		});
		if (result.ensured) compoundId = result.compoundId;
	}
	return compoundId;
};

/**
 * Applies a technique to the ordered selection as one undoable unit. Most
 * promoted techniques are sample-driven (`evaluator.ts`'s per-frame sampler
 * reads the binding directly), so recording a bare
 * {@link MotionGrammarBinding} is already a complete, correct apply — this is
 * also the path used for every non-promoted catalog technique. A technique
 * whose module sets {@link MotionGrammarTechniqueModule.commitsOnApply}
 * (currently only noise-wipe) has no such live sampler entry: its effect only
 * exists once its module's scene/motion commands run, so this delegates to
 * the same workspace-plan pipeline `commitCreateMotionGrammarWorkspaceInstance`
 * uses, seeding the target's recipe and writing the animated automation track
 * in the same transaction as the binding.
 */
export type MotionGrammarApplyCommitResult =
	| { readonly status: "applied"; readonly bindingId?: string }
	| { readonly status: "blocked"; readonly reason: string };

export function commitApplyTechnique(
	techniqueId: MotionGrammarTechniqueId,
	nodeIds: readonly string[],
	scene: SceneDocument,
	motion: MotionDocument,
): MotionGrammarApplyCommitResult {
	if (techniqueId === "stroke-draw-on") {
		const nodeId = nodeIds[0];
		if (!nodeId) return { status: "blocked", reason: "Select one path." };
		const plan = createStrokeDrawOnAuthoringPlan({
			scene,
			nodeId,
			durationFrames: motion.durationFrames,
		});
		if (plan.status === "blocked") return plan;
		const compoundId = `motion-grammar:apply-stroke-draw-on:${plan.binding.id}`;
		commitInspectorCompound({
			compoundId,
			label: "Apply Stroke Draw-on",
			sceneCommands: plan.sceneCommands,
			grammarCommands: plan.grammarCommands,
		});
		return { status: "applied", bindingId: plan.binding.id };
	}
	if (techniqueId === FOLLOW_THROUGH_LEAD_ADAPTER_TECHNIQUE_ID) {
		const bindingId = crypto.randomUUID();
		const plan = planFollowThroughLeadAdapterBinding({
			scene,
			motion,
			bindingId,
			targetIds: nodeIds,
		});
		if (plan.status === "blocked") return plan;
		useMotionGrammarStore.getState().apply(applyGrammarBinding(plan.binding));
		return { status: "applied", bindingId };
	}
	if (motionGrammarTechniqueCommitsOnApply(techniqueId)) {
		// Camera-first just-in-time supply (Phase P4) precedes this as a
		// separate undo step: `commitCreateMotionGrammarWorkspaceInstance`
		// already commits scene/motion/grammar as several independent history
		// entries (no shared compoundId) rather than one compound, so there is
		// no single downstream commit to fold a shared id onto here.
		ensureSceneCamerasForGrammarTargets(scene, nodeIds);
		const result = commitCreateMotionGrammarWorkspaceInstance({
			techniqueId,
			scene,
			selectedNodeIds: nodeIds,
		});
		return result.status === "created"
			? { status: "applied" }
			: { status: "blocked", reason: result.reason };
	}
	if (techniqueId === "periodic-afterimage") {
		const bindingId = crypto.randomUUID();
		const plan = planAfterimageSelectedSourceBinding({
			scene,
			selectedNodeIds: nodeIds,
			bindingId,
		});
		if (plan.status === "blocked") return plan;
		const compoundId = ensureSceneCamerasForGrammarTargets(scene, nodeIds);
		const command = createAfterimageSelectedSourceBindingCommand(plan);
		useMotionGrammarStore
			.getState()
			.apply(compoundId ? { ...command, compoundId } : command);
		return { status: "applied", bindingId };
	}
	const defaults = createMotionGrammarNewBindingDefaults(techniqueId, nodeIds);
	if (defaults.status === "blocked") return defaults;
	const compoundId = ensureSceneCamerasForGrammarTargets(scene, nodeIds);
	const binding: MotionGrammarBinding = {
		id: crypto.randomUUID(),
		techniqueId,
		targetIds: [...nodeIds],
		parameters: defaults.parameters,
		effectBinding: { kind: "none" },
		...(defaults.roleMap ? { roleMap: defaults.roleMap } : {}),
		...(techniqueId === "random-phase-pulse"
			? { seed: 13, randomPulseProfile: RANDOM_PULSE_PROFILE_DEFAULT }
			: {}),
	};
	const command = applyGrammarBinding(binding);
	useMotionGrammarStore
		.getState()
		.apply(compoundId ? { ...command, compoundId } : command);
	return { status: "applied", bindingId: binding.id };
}

export function commitRemoveBinding(id: string): void {
	useMotionGrammarStore.getState().apply(removeGrammarBinding(id));
}

export type MotionGrammarParameterCommitResult =
	| { readonly status: "updated" }
	| { readonly status: "blocked"; readonly reason: string }
	| { readonly status: "unchanged" };

/**
 * Commits one parameter edit as a discrete undo step (no coalesce key). V1
 * Follow-through rechecks its canonical lead-track and active-window contract
 * before writing, so a valid binding cannot become silently inert through the
 * Inspector after it was initially planned.
 */
export function commitBindingParameter(
	id: string,
	key: string,
	value: number,
): MotionGrammarParameterCommitResult {
	const grammarStore = useMotionGrammarStore.getState();
	const binding = grammarStore.document.bindings.find((item) => item.id === id);
	if (!binding) {
		return { status: "blocked", reason: "Motion binding is unavailable." };
	}
	if (key === "seed") {
		if (!Number.isFinite(value)) {
			return { status: "blocked", reason: "Motion seed must be finite." };
		}
		grammarStore.apply(updateGrammarBinding(id, { seed: value }));
		return { status: "updated" };
	}
	const patch = normalizeMotionGrammarAuthoringParameterPatch({
		binding,
		descriptor: describeMotionGrammarAuthoringProfile(binding),
		patch: { [key]: value },
	});
	if (Object.keys(patch.parameters).length === 0 || !patch.changed) {
		return { status: "unchanged" };
	}
	const candidate: MotionGrammarBinding = {
		...binding,
		parameters: { ...binding.parameters, ...patch.parameters },
	};
	if (
		isFollowThroughLeadAdapterParameters(
			candidate.techniqueId,
			candidate.parameters,
		)
	) {
		const issue = validateFollowThroughLeadAdapterBinding({
			scene: useSceneStore.getState().document,
			motion: useMotionStore.getState().document,
			binding: candidate,
			activeEndFrameExclusive: followThroughLeadAdapterActiveEndFrame(
				useMotionStore.getState().document,
				candidate.id,
			),
		});
		if (issue) return { status: "blocked", reason: issue };
	}
	grammarStore.apply(
		updateGrammarBinding(id, { parameters: patch.parameters }),
	);
	return { status: "updated" };
}

/**
 * Commits a declarative profile edit through the Motion Grammar command bus.
 * The entity helper validates the complete envelope first, so Inspector edits
 * cannot persist broken continuity, rest, undershoot, peak, or hold invariants.
 */
export function commitMotionGrammarProfileEdit({
	id,
	edit,
}: {
	readonly id: string;
	readonly edit: RandomPulseProfileEdit;
}):
	| { readonly status: "updated" }
	| { readonly status: "blocked"; readonly reason: string } {
	const grammarStore = useMotionGrammarStore.getState();
	const binding = grammarStore.document.bindings.find((item) => item.id === id);
	if (binding?.techniqueId !== "random-phase-pulse") {
		return {
			status: "blocked",
			reason: "Random Pulse binding is unavailable.",
		};
	}
	const result = editRandomPulseProfile(
		binding.randomPulseProfile ?? RANDOM_PULSE_PROFILE_DEFAULT,
		edit,
	);
	if (result.status === "blocked") return result;
	grammarStore.apply(
		updateGrammarBinding(id, { randomPulseProfile: result.profile }),
	);
	return { status: "updated" };
}
