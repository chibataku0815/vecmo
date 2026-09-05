/**
 * Pure projection from a {@link MotionExpressionDefinition} into the existing
 * {@link MotionGrammarAuthoringProfileDescriptor}. This is the step that stops
 * per-technique Inspector property growth: the Inspector renders the descriptor
 * generically, so a new technique declares its params/roles/timeline once and the
 * controls, role slots, and clip-duration sync all fall out of this one function
 * with no widget edits.
 */

import { effectCapabilityById } from "@/entities/scene/model/effect-capabilities";
import type {
	MotionGrammarAuthoringInstanceDescriptor,
	MotionGrammarAuthoringInstanceKind,
	MotionGrammarAuthoringInstanceReference,
	MotionGrammarAuthoringLookHookDescriptor,
	MotionGrammarAuthoringParameterGroup,
	MotionGrammarAuthoringParameterSpec,
	MotionGrammarAuthoringProfileDescriptor,
	MotionGrammarAuthoringTimelineMode,
} from "./authoring-profile";
import type {
	ExpressionParamSpec,
	ExpressionRoleDeclaration,
	ExpressionRoleKind,
	MotionExpressionDefinition,
} from "./expression-definition";
import type { MotionGrammarBinding } from "./types";

const INSTANCE_KIND_BY_ROLE: Record<
	ExpressionRoleKind,
	MotionGrammarAuthoringInstanceKind
> = {
	"scene-node": "body",
	"generated-scene-node": "satellite",
	"presentation-artifact": "artifact",
};

const toAuthoringParameterSpec = (
	param: ExpressionParamSpec,
): MotionGrammarAuthoringParameterSpec => ({
	key: param.key,
	label: param.label,
	default: param.default,
	min: param.min,
	max: param.max,
	step: param.step,
	role: param.role,
	...(param.options === undefined ? {} : { options: param.options }),
	...(param.advanced === undefined ? {} : { advanced: param.advanced }),
});

const aliasesForRole = (role: ExpressionRoleDeclaration): readonly string[] => [
	role.roleId,
	...(role.aliases ?? []),
];

const roleMatchesKey = (
	role: ExpressionRoleDeclaration,
	roleKey: string | undefined,
): boolean => Boolean(roleKey && aliasesForRole(role).includes(roleKey));

const roleForMappedNode = (
	definition: MotionExpressionDefinition,
	binding: MotionGrammarBinding,
	nodeId: string,
): ExpressionRoleDeclaration | undefined => {
	const mappedRole = binding.roleMap?.[nodeId];
	const nodeRole = definition.roles.find((role) =>
		roleMatchesKey(role, mappedRole),
	);
	if (nodeRole) return nodeRole;
	return definition.roles.find((role) =>
		aliasesForRole(role).some((alias) => binding.roleMap?.[alias] === nodeId),
	);
};

const projectParameterGroups = (
	definition: MotionExpressionDefinition,
): readonly MotionGrammarAuthoringParameterGroup[] => {
	const orderedGroupIds = definition.params
		.map((param) => param.groupId)
		.filter((groupId, index, all) => all.indexOf(groupId) === index);
	return orderedGroupIds.map((groupId) => {
		const groupParams = definition.params.filter(
			(param) => param.groupId === groupId,
		);
		return {
			id: groupId,
			label: groupParams[0]?.groupLabel ?? groupId,
			intent: "",
			parameters: groupParams.map(toAuthoringParameterSpec),
		};
	});
};

const roleReference = (
	role: ExpressionRoleDeclaration | undefined,
	nodeId: string,
): MotionGrammarAuthoringInstanceReference => {
	switch (role?.kind) {
		case "generated-scene-node":
			return { kind: "generated-scene-node", nodeId };
		case "presentation-artifact":
			return {
				kind: "presentation-artifact",
				artifactId: nodeId,
				sourceNodeId: nodeId,
				lifecycle: "runtime-evaluated",
			};
		default:
			return { kind: "scene-node", nodeId };
	}
};

const instanceKindForRole = (
	role: ExpressionRoleDeclaration | undefined,
): MotionGrammarAuthoringInstanceKind => {
	if (!role) return "body";
	if (role.roleId === "path") return "source";
	return INSTANCE_KIND_BY_ROLE[role.kind];
};

const projectInstances = (
	definition: MotionExpressionDefinition,
	binding: MotionGrammarBinding,
): readonly MotionGrammarAuthoringInstanceDescriptor[] => {
	const expansion = definition.roleExpansion;
	const roleId =
		expansion.mode === "per-target" ? expansion.roleId : expansion.sourceRoleId;
	const fallbackRole = definition.roles.find(
		(entry) => entry.roleId === roleId,
	);
	return binding.targetIds.map((nodeId, index) => {
		const role = roleForMappedNode(definition, binding, nodeId) ?? fallbackRole;
		const resolvedRoleId = role?.roleId ?? roleId;
		return {
			index,
			slotId: `${resolvedRoleId}:${index + 1}`,
			reference: roleReference(role, nodeId),
			nodeId,
			role: resolvedRoleId,
			roleLabel: role?.label ?? roleId,
			kind: instanceKindForRole(role),
			editable: role?.editable ?? true,
			replaceable: role?.replaceable ?? false,
			sourceProfileIndex: index,
		};
	});
};

const projectTimeline = (
	definition: MotionExpressionDefinition,
): MotionGrammarAuthoringProfileDescriptor["timeline"] => {
	const paramKeys = new Set(definition.params.map((param) => param.key));
	const { mode, bakePolicy, clipLabel, durationParameterKey } =
		definition.timeline;
	const timelineMode: MotionGrammarAuthoringTimelineMode = mode;
	// Defensive: a durationParameterKey that does not name a real param would make
	// the clip silently collapse to one frame, so it is dropped here and reported
	// by validateMotionExpressionDefinition rather than silently honored.
	const validDurationKey =
		durationParameterKey && paramKeys.has(durationParameterKey)
			? durationParameterKey
			: undefined;
	return {
		mode: timelineMode,
		bakePolicy,
		...(clipLabel === undefined ? {} : { clipLabel }),
		...(validDurationKey === undefined
			? {}
			: { durationParameterKey: validDurationKey }),
	};
};

const projectLookHooks = (
	definition: MotionExpressionDefinition,
): readonly MotionGrammarAuthoringLookHookDescriptor[] | undefined =>
	definition.lookHooks?.map((hook) => ({
		id: hook.id,
		label: hook.label,
		capabilityId: hook.capabilityId,
		targetScope: hook.targetScope,
		...(hook.targetRoleId === undefined
			? {}
			: { targetRoleId: hook.targetRoleId }),
		...(hook.parameterKey === undefined
			? {}
			: { parameterKey: hook.parameterKey }),
		...(hook.outputChannel === undefined
			? {}
			: { outputChannel: hook.outputChannel }),
	}));

/**
 * Projects a definition + its binding into the Inspector descriptor. Returns
 * undefined when the binding is not owned by this definition (mirrors the
 * hand-written profile guards), so a technique module can chain safely.
 */
export function projectMotionExpressionAuthoringProfile(
	definition: MotionExpressionDefinition,
	binding: MotionGrammarBinding,
): MotionGrammarAuthoringProfileDescriptor | undefined {
	if (binding.techniqueId !== definition.expressionId) return undefined;
	const instances = projectInstances(definition, binding);
	const lookHooks = projectLookHooks(definition);
	return {
		bindingId: binding.id,
		techniqueId: definition.expressionId,
		label: definition.label,
		summary: definition.summary,
		kind: definition.kind,
		timeline: projectTimeline(definition),
		expansion: definition.expansion,
		...(definition.seedControl === undefined
			? {}
			: { seedControl: definition.seedControl }),
		parameterGroups: projectParameterGroups(definition),
		...(definition.profileControls === undefined
			? {}
			: { profileControls: definition.profileControls }),
		instances,
		roleSlots: instances,
		...(lookHooks === undefined ? {} : { lookHooks }),
		...(definition.timingTemplates === undefined
			? {}
			: { timingTemplates: definition.timingTemplates }),
		...(definition.recipeRoles === undefined
			? {}
			: { recipeRoles: definition.recipeRoles }),
	};
}

/**
 * Pure structural validation of a built-in definition. Returns human-readable
 * issues; an empty array means the definition is well-formed. Built-ins should
 * pass with zero issues — this guards the frozen invariants (duration key names a
 * real param, the expansion role exists, outputs are declared).
 */
export function validateMotionExpressionDefinition(
	definition: MotionExpressionDefinition,
): readonly string[] {
	const issues: string[] = [];
	const paramKeys = new Set(definition.params.map((param) => param.key));
	const { durationParameterKey } = definition.timeline;
	if (durationParameterKey && !paramKeys.has(durationParameterKey)) {
		issues.push(
			`timeline.durationParameterKey "${durationParameterKey}" is not a declared parameter.`,
		);
	}
	const roleIds = new Set(definition.roles.map((role) => role.roleId));
	const expansionRoleId =
		definition.roleExpansion.mode === "per-target"
			? definition.roleExpansion.roleId
			: definition.roleExpansion.sourceRoleId;
	if (!roleIds.has(expansionRoleId)) {
		issues.push(
			`roleExpansion role "${expansionRoleId}" is not a declared role.`,
		);
	}
	if (definition.outputs.length === 0) {
		issues.push("definition declares no output channels.");
	}
	for (const hook of definition.lookHooks ?? []) {
		const capability = effectCapabilityById(hook.capabilityId);
		if (!capability) {
			issues.push(
				`lookHook "${hook.id}" references unknown effect capability "${hook.capabilityId}".`,
			);
			continue;
		}
		if (!capability.targetScopes.some((scope) => scope === hook.targetScope)) {
			issues.push(
				`lookHook "${hook.id}" targetScope "${hook.targetScope}" is not supported by capability "${hook.capabilityId}".`,
			);
		}
		if (!capability.control.expressionBindable) {
			issues.push(
				`lookHook "${hook.id}" references non-expression-bindable capability "${hook.capabilityId}".`,
			);
		}
		if (hook.targetRoleId && !roleIds.has(hook.targetRoleId)) {
			issues.push(
				`lookHook "${hook.id}" targetRoleId "${hook.targetRoleId}" is not a declared role.`,
			);
		}
		if (hook.parameterKey && !paramKeys.has(hook.parameterKey)) {
			issues.push(
				`lookHook "${hook.id}" parameterKey "${hook.parameterKey}" is not a declared parameter.`,
			);
		}
		if (
			hook.outputChannel &&
			!definition.outputs.some((output) => output === hook.outputChannel)
		) {
			issues.push(
				`lookHook "${hook.id}" outputChannel "${hook.outputChannel}" is not declared in outputs.`,
			);
		}
	}
	return issues;
}
