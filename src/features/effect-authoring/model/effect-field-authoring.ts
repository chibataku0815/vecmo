import type { SceneCommand } from "@/entities/scene/model/command";
import {
	compileEffectFieldRoutesForNode,
	EFFECT_FIELD_TARGET_REGISTRY,
	type EffectFieldTargetDescriptor,
} from "@/entities/scene/model/effect-field-routing";
import { createUpdateEffectIntentCommand } from "@/entities/scene/model/node-commands";
import {
	resolveFrameEffectIntent,
	resolveNodeRecipe,
} from "@/entities/scene/model/recipe-resolve";
import {
	findNode,
	selectNodeArtboardMapping,
} from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import { resolveNodeStyle } from "@/entities/scene/model/style-resolve";
import type { SceneDocument } from "@/entities/scene/model/types";
import {
	attachEffectInfluenceAssignment,
	type EffectFieldDefinition,
	type EffectInfluence,
	type EffectInfluenceAssignment,
	type EffectInfluenceDraft,
	type EffectInfluenceFalloffDraft,
	type EffectInfluenceRecipe,
	type EffectMaskSource,
	type EffectMaskSourceDraft,
	legacyGlowBloomValue,
	legacyGlowRadiusValue,
	linkEffectInfluenceAssignmentField,
	normalizeEffectInfluence,
	normalizeEffectInfluenceAssignment,
	normalizeEffectInfluenceRecipe,
	normalizeEffectMaskSource,
	removeEffectFieldDefinition,
	replaceEffectFieldSource,
	unlinkEffectInfluenceAssignmentField,
	upsertEffectFieldDefinition,
} from "@/shared/vec-core";
import { removeEffectInfluenceMask } from "./effect-influence";

/** Field geometries exposed by the generic Inspector and direct-control tool. */
export type EffectFieldAuthoringMode =
	| "contourGradient"
	| "linearGradient"
	| "radialGradient"
	| "rect"
	| "fieldMesh";

export const EFFECT_FIELD_AUTHORING_MODES = [
	"contourGradient",
	"linearGradient",
	"radialGradient",
	"rect",
	"fieldMesh",
] as const satisfies readonly EffectFieldAuthoringMode[];

/** Read-only projection of one selected node and one registry target. */
export type NodeEffectFieldEditingState = {
	readonly nodeId: string;
	readonly artboardId: string | null;
	readonly descriptor: EffectFieldTargetDescriptor | null;
	readonly assignment: EffectInfluenceAssignment | null;
	readonly field: EffectFieldDefinition | null;
	readonly source: EffectMaskSource | null;
	readonly sourceOrigin: "shared-field" | "inline" | null;
	readonly routeIssues: readonly string[];
	readonly blockedReason: string | null;
	readonly compatibleFields: readonly EffectFieldDefinition[];
};

/** Typed result used to keep blocked/no-op writes out of the scene command bus. */
export type NodeEffectFieldCommandResult =
	| {
			readonly kind: "ready";
			readonly command: SceneCommand;
			readonly artboardId: string;
			readonly recipe: EffectInfluenceRecipe;
	  }
	| { readonly kind: "unchanged" }
	| { readonly kind: "blocked"; readonly reason: string };

const sameJson = (left: unknown, right: unknown): boolean =>
	JSON.stringify(left) === JSON.stringify(right);

const descriptorForId = (
	descriptorId: string,
): EffectFieldTargetDescriptor | null =>
	EFFECT_FIELD_TARGET_REGISTRY.byId.get(descriptorId) ?? null;

const nodeArtboardId = (
	document: SceneDocument,
	nodeId: string,
): string | null =>
	selectNodeArtboardMapping(document).byNodeId[nodeId] ?? null;

const nodeRecipe = (
	document: SceneDocument,
	nodeId: string,
): {
	readonly artboardId: string;
	readonly recipe: EffectInfluenceRecipe;
} | null => {
	const artboardId = nodeArtboardId(document, nodeId);
	if (!artboardId) return null;
	return {
		artboardId,
		recipe: normalizeEffectInfluenceRecipe(
			resolveFrameEffectIntent(document, artboardId).influenceRecipe ??
				undefined,
		),
	};
};

const assignmentMatches = (
	assignment: EffectInfluenceAssignment,
	nodeId: string,
	descriptor: EffectFieldTargetDescriptor,
): boolean =>
	(assignment.target.scope === "object" ||
		assignment.target.scope === "group") &&
	assignment.target.id === nodeId &&
	(assignment.effect.id === descriptor.id ||
		assignment.effect.path === descriptor.effectPath);

const uniqueId = (base: string, used: ReadonlySet<string>): string => {
	if (!used.has(base)) return base;
	let suffix = 2;
	while (used.has(`${base}-${suffix}`)) suffix += 1;
	return `${base}-${suffix}`;
};

const authoringSupportReason = (
	descriptor: EffectFieldTargetDescriptor,
): string | null => {
	if (descriptor.disabledReason) return descriptor.disabledReason;
	const fidelity = descriptor.support["editor-svg"];
	return fidelity.status === "native" || fidelity.status === "approximated"
		? null
		: (fidelity.reason ?? `${descriptor.label} has no editor field adapter.`);
};

const ownerAvailabilityReason = (
	document: SceneDocument,
	nodeId: string,
	descriptor: EffectFieldTargetDescriptor,
): string | null => {
	const node = findNode(document, nodeId);
	if (descriptor.id === "recipe.glow.bloom") {
		const recipe = node ? resolveNodeRecipe(node) : null;
		return recipe &&
			legacyGlowBloomValue(recipe.glow) > 0 &&
			legacyGlowRadiusValue(recipe.glow) > 0
			? null
			: "Enable a non-zero node Glow before adding its wet-mix field.";
	}
	if (descriptor.id !== "style.effects.layer-blur") return null;
	const layerBlur = node
		? resolveNodeStyle(node.style).effects.find(
				(effect) =>
					effect.kind === "layer-blur" &&
					effect.visible !== false &&
					(effect.radius > 0 || (effect.radiusY ?? effect.radius) > 0),
			)
		: null;
	return layerBlur
		? null
		: "Enable Layer blur on the selected object before adding its wet-mix field.";
};

/** Default field geometry only; no artwork, material, or style-specific values. */
export function defaultEffectFieldSource(
	mode: EffectFieldAuthoringMode,
): EffectMaskSource {
	switch (mode) {
		case "contourGradient":
			return normalizeEffectMaskSource({
				kind: "contourGradient",
				space: "objectBoundingBox",
				width: 0.18,
				side: "both",
			});
		case "linearGradient":
			return normalizeEffectMaskSource({
				kind: "linearGradient",
				space: "objectBoundingBox",
				x1: 0.5,
				y1: 0,
				x2: 0.5,
				y2: 1,
				stops: [
					{ offset: 0, alpha: 1 },
					{ offset: 1, alpha: 0 },
				],
			});
		case "radialGradient":
			return normalizeEffectMaskSource({
				kind: "radialGradient",
				space: "objectBoundingBox",
				cx: 0.5,
				cy: 0.5,
				radius: 0.4,
				rx: 0.4,
				ry: 0.4,
				rotation: 0,
				stops: [
					{ offset: 0, alpha: 1 },
					{ offset: 1, alpha: 0 },
				],
			});
		case "rect":
			return normalizeEffectMaskSource({
				kind: "rect",
				space: "objectBoundingBox",
				x: 0.15,
				y: 0.2,
				width: 0.7,
				height: 0.6,
				cornerRadius: 0.08,
				rotation: 0,
			});
		case "fieldMesh":
			return normalizeEffectMaskSource({
				kind: "fieldMesh",
				space: "objectBoundingBox",
			});
	}
}

const compatibleField = (
	descriptor: EffectFieldTargetDescriptor,
	field: EffectFieldDefinition,
): boolean =>
	descriptor.eligibleSourceKinds.includes(field.source.kind) &&
	descriptor.coordinateSpaces.includes(field.source.space);

/**
 * Projects one selected node/property pair without choosing a first duplicate.
 * Duplicate routes or fields are surfaced as blockers, never silently repaired.
 */
export function nodeEffectFieldEditingState(
	document: SceneDocument,
	nodeId: string,
	descriptorId: string,
): NodeEffectFieldEditingState {
	const descriptor = descriptorForId(descriptorId);
	const resolved = nodeRecipe(document, nodeId);
	if (!descriptor || !resolved) {
		return {
			nodeId,
			artboardId: resolved?.artboardId ?? null,
			descriptor,
			assignment: null,
			field: null,
			source: null,
			sourceOrigin: null,
			routeIssues: [],
			blockedReason: descriptor
				? "The selected node has no stable artboard owner."
				: "The requested Effect Field target is not registered.",
			compatibleFields: [],
		};
	}
	const matches = resolved.recipe.assignments.filter((assignment) =>
		assignmentMatches(assignment, nodeId, descriptor),
	);
	const assignment = matches.length === 1 ? (matches[0] ?? null) : null;
	const linkedFields = assignment?.fieldId
		? (resolved.recipe.fields ?? []).filter(
				(field) => field.id === assignment.fieldId,
			)
		: [];
	const field = linkedFields.length === 1 ? (linkedFields[0] ?? null) : null;
	const routing = compileEffectFieldRoutesForNode(
		resolved.recipe,
		nodeId,
		"editor-svg",
	);
	const supportReason =
		authoringSupportReason(descriptor) ??
		ownerAvailabilityReason(document, nodeId, descriptor);
	const duplicateReason =
		matches.length > 1
			? "Multiple assignments address this node and target; resolve the duplicate before editing."
			: linkedFields.length > 1
				? "The linked field id is duplicated; resolve field identity before editing."
				: null;
	return {
		nodeId,
		artboardId: resolved.artboardId,
		descriptor,
		assignment,
		field,
		source: field?.source ?? assignment?.influence.source ?? null,
		sourceOrigin: field ? "shared-field" : assignment ? "inline" : null,
		routeIssues: routing.issues.map(
			(issue) => `${issue.code}: ${issue.detail}`,
		),
		blockedReason: duplicateReason ?? supportReason,
		compatibleFields: (resolved.recipe.fields ?? []).filter((candidate) =>
			compatibleField(descriptor, candidate),
		),
	};
}

const commandForRecipe = (
	document: SceneDocument,
	nodeId: string,
	nextRecipe: EffectInfluenceRecipe,
	label: string,
): NodeEffectFieldCommandResult => {
	const current = nodeRecipe(document, nodeId);
	if (!current) {
		return {
			kind: "blocked",
			reason: "The selected node has no artboard owner.",
		};
	}
	if (sameJson(current.recipe, nextRecipe)) return { kind: "unchanged" };
	return {
		kind: "ready",
		artboardId: current.artboardId,
		recipe: nextRecipe,
		command: createUpdateEffectIntentCommand(
			{ scope: "artboard", artboardId: current.artboardId },
			{ influenceRecipe: nextRecipe },
			{ label },
		),
	};
};

/** Adds or changes a field mode in one scene command and one undo entry. */
export function createSetNodeEffectFieldModeCommand(
	document: SceneDocument,
	nodeId: string,
	descriptorId: string,
	mode: EffectFieldAuthoringMode,
): NodeEffectFieldCommandResult {
	const descriptor = descriptorForId(descriptorId);
	const current = nodeRecipe(document, nodeId);
	if (!descriptor || !current) {
		return {
			kind: "blocked",
			reason: "The field target or node owner is missing.",
		};
	}
	const supportReason = authoringSupportReason(descriptor);
	const ownerReason = ownerAvailabilityReason(document, nodeId, descriptor);
	if (supportReason || ownerReason) {
		return {
			kind: "blocked",
			reason: supportReason ?? ownerReason ?? "Unavailable.",
		};
	}
	const assignments = current.recipe.assignments.filter((assignment) =>
		assignmentMatches(assignment, nodeId, descriptor),
	);
	if (assignments.length > 1) {
		return {
			kind: "blocked",
			reason: "Duplicate active routes must be resolved before authoring.",
		};
	}
	const source = defaultEffectFieldSource(mode);
	const assignment = assignments[0];
	if (
		assignment?.fieldId &&
		(current.recipe.fields ?? []).filter(
			(field) => field.id === assignment.fieldId,
		).length > 1
	) {
		return {
			kind: "blocked",
			reason:
				"The linked field id is duplicated; resolve field identity first.",
		};
	}
	const usedFieldIds = new Set(
		(current.recipe.fields ?? []).map((field) => field.id),
	);
	const fieldId =
		assignment?.fieldId ??
		uniqueId(`field:${nodeId}:${descriptor.id}`, usedFieldIds);
	let next = upsertEffectFieldDefinition(current.recipe, {
		id: fieldId,
		label: `${descriptor.label} field`,
		source,
	});
	if (assignment) {
		next = linkEffectInfluenceAssignmentField(next, assignment.id, fieldId);
	} else {
		const assignmentId = uniqueId(
			`route:${nodeId}:${descriptor.id}`,
			new Set(next.assignments.map((candidate) => candidate.id)),
		);
		next = attachEffectInfluenceAssignment(next, {
			id: assignmentId,
			label: descriptor.label,
			target: { scope: "object", id: nodeId },
			effect: { id: descriptor.id, path: descriptor.effectPath },
			influence: { enabled: true, source, strength: 1 },
			fieldId,
		});
		next = linkEffectInfluenceAssignmentField(next, assignmentId, fieldId);
	}
	return commandForRecipe(
		document,
		nodeId,
		next,
		`Set ${descriptor.label} field`,
	);
}

const uniqueAssignment = (
	recipe: EffectInfluenceRecipe,
	nodeId: string,
	descriptor: EffectFieldTargetDescriptor,
): EffectInfluenceAssignment | null => {
	const matches = recipe.assignments.filter((assignment) =>
		assignmentMatches(assignment, nodeId, descriptor),
	);
	return matches.length === 1 ? (matches[0] ?? null) : null;
};

/** Replaces field geometry while refreshing every linked fallback atomically. */
export function createUpdateNodeEffectFieldSourceCommand(
	document: SceneDocument,
	nodeId: string,
	descriptorId: string,
	sourceDraft: EffectMaskSourceDraft,
): NodeEffectFieldCommandResult {
	const descriptor = descriptorForId(descriptorId);
	const current = nodeRecipe(document, nodeId);
	if (!descriptor || !current) {
		return {
			kind: "blocked",
			reason: "The field target or node owner is missing.",
		};
	}
	const assignment = uniqueAssignment(current.recipe, nodeId, descriptor);
	if (!assignment) {
		return { kind: "blocked", reason: "Exactly one field route is required." };
	}
	const source = normalizeEffectMaskSource(sourceDraft);
	if (!compatibleField(descriptor, { id: "candidate", label: "", source })) {
		return {
			kind: "blocked",
			reason: `${source.kind}/${source.space} is not eligible for ${descriptor.label}.`,
		};
	}
	let next: EffectInfluenceRecipe;
	if (assignment.fieldId) {
		next = replaceEffectFieldSource(current.recipe, assignment.fieldId, source);
	} else {
		next = {
			...current.recipe,
			assignments: current.recipe.assignments.map((candidate) =>
				candidate.id === assignment.id
					? normalizeEffectInfluenceAssignment({
							...candidate,
							influence: { ...candidate.influence, source },
						})
					: candidate,
			),
		};
	}
	return commandForRecipe(
		document,
		nodeId,
		next,
		`Edit ${descriptor.label} field`,
	);
}

/** Updates the scalar response without changing field geometry or ownership. */
export function createUpdateNodeEffectFieldInfluenceCommand(
	document: SceneDocument,
	nodeId: string,
	descriptorId: string,
	patch: EffectInfluenceDraft & {
		readonly falloff?: EffectInfluenceFalloffDraft;
	},
): NodeEffectFieldCommandResult {
	const descriptor = descriptorForId(descriptorId);
	const current = nodeRecipe(document, nodeId);
	if (!descriptor || !current) {
		return {
			kind: "blocked",
			reason: "The field target or node owner is missing.",
		};
	}
	const assignment = uniqueAssignment(current.recipe, nodeId, descriptor);
	if (!assignment) {
		return { kind: "blocked", reason: "Exactly one field route is required." };
	}
	const influence: EffectInfluence = normalizeEffectInfluence({
		...assignment.influence,
		...patch,
		source: assignment.influence.source,
		falloff: {
			...assignment.influence.falloff,
			...patch.falloff,
		},
	});
	const next = {
		...current.recipe,
		assignments: current.recipe.assignments.map((candidate) =>
			candidate.id === assignment.id ? { ...candidate, influence } : candidate,
		),
	};
	return commandForRecipe(
		document,
		nodeId,
		next,
		`Tune ${descriptor.label} field`,
	);
}

/** Links the route to an existing compatible shared field. */
export function createLinkNodeEffectFieldCommand(
	document: SceneDocument,
	nodeId: string,
	descriptorId: string,
	fieldId: string,
): NodeEffectFieldCommandResult {
	const descriptor = descriptorForId(descriptorId);
	const current = nodeRecipe(document, nodeId);
	if (!descriptor || !current) {
		return {
			kind: "blocked",
			reason: "The field target or node owner is missing.",
		};
	}
	const assignment = uniqueAssignment(current.recipe, nodeId, descriptor);
	const fields = (current.recipe.fields ?? []).filter(
		(field) => field.id === fieldId,
	);
	if (!assignment || fields.length !== 1 || !fields[0]) {
		return {
			kind: "blocked",
			reason: "The route or shared field is ambiguous.",
		};
	}
	if (!compatibleField(descriptor, fields[0])) {
		return { kind: "blocked", reason: "That shared field is not compatible." };
	}
	return commandForRecipe(
		document,
		nodeId,
		linkEffectInfluenceAssignmentField(current.recipe, assignment.id, fieldId),
		`Link ${descriptor.label} field`,
	);
}

/** Unlinks the route while retaining its last valid inline field snapshot. */
export function createUnlinkNodeEffectFieldCommand(
	document: SceneDocument,
	nodeId: string,
	descriptorId: string,
): NodeEffectFieldCommandResult {
	const descriptor = descriptorForId(descriptorId);
	const current = nodeRecipe(document, nodeId);
	if (!descriptor || !current) {
		return {
			kind: "blocked",
			reason: "The field target or node owner is missing.",
		};
	}
	const assignment = uniqueAssignment(current.recipe, nodeId, descriptor);
	if (!assignment)
		return { kind: "blocked", reason: "The field route is ambiguous." };
	return commandForRecipe(
		document,
		nodeId,
		unlinkEffectInfluenceAssignmentField(current.recipe, assignment.id),
		`Unlink ${descriptor.label} field`,
	);
}

/** Removes one unique route and prunes its now-unreferenced field definition. */
export function createRemoveNodeEffectFieldCommand(
	document: SceneDocument,
	nodeId: string,
	descriptorId: string,
): NodeEffectFieldCommandResult {
	const descriptor = descriptorForId(descriptorId);
	const current = nodeRecipe(document, nodeId);
	if (!descriptor || !current) {
		return {
			kind: "blocked",
			reason: "The field target or node owner is missing.",
		};
	}
	const assignment = uniqueAssignment(current.recipe, nodeId, descriptor);
	if (!assignment)
		return { kind: "blocked", reason: "The field route is ambiguous." };
	let next = removeEffectInfluenceMask(current.recipe, assignment.id);
	if (
		assignment.fieldId &&
		!next.assignments.some(
			(candidate) => candidate.fieldId === assignment.fieldId,
		)
	) {
		next = removeEffectFieldDefinition(next, assignment.fieldId);
	}
	return commandForRecipe(
		document,
		nodeId,
		next,
		`Remove ${descriptor.label} field`,
	);
}

/** Applies a planned field mutation through the scene command bus. */
export function commitNodeEffectFieldCommand(
	result: NodeEffectFieldCommandResult,
): boolean {
	if (result.kind !== "ready") return false;
	useSceneStore.getState().apply(result.command);
	return true;
}
