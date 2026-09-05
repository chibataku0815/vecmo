/**
 * Binding-aware compatibility seam for versioned Motion Expressions.
 *
 * Some technique ids already had legacy evaluator/catalog behavior before a
 * richer expression law was introduced. A persisted `expressionVersion`
 * marker therefore selects the new law; its absence is meaningful and keeps a
 * historical document on its original parameter and evaluator contract.
 */

import { findCatalogEntry } from "./catalog";
import {
	MOTION_EXPRESSION_VERSION_PARAM_KEY,
	type MotionExpressionDefinition,
} from "./expression-definition";
import {
	findActiveVersionedMotionExpressionDefinition,
	findMotionExpressionDefinition,
	isMotionExpressionBindingActive,
	motionExpressionBindingState,
} from "./expression-registry";
import {
	defaultFollowThroughLeadAdapterRoleMap,
	FOLLOW_THROUGH_FOLLOWER_ROLE,
	FOLLOW_THROUGH_LEAD_ADAPTER_PARAM_SPECS,
	FOLLOW_THROUGH_LEAD_ADAPTER_TECHNIQUE_ID,
	FOLLOW_THROUGH_LEAD_ROLE,
	followThroughLeadAdapterDefaultParameters,
	isFollowThroughLeadAdapterParameters,
	validateFollowThroughLeadAdapterRoleMap,
} from "./follow-through-lead-binding";
import type {
	MotionGrammarBinding,
	MotionGrammarParamSpec,
	MotionGrammarTechniqueId,
} from "./types";

export type MotionGrammarNewBindingDefaults =
	| {
			readonly status: "ready";
			readonly parameters: Readonly<Record<string, number>>;
			readonly roleMap?: Readonly<Record<string, string>>;
	  }
	| { readonly status: "blocked"; readonly reason: string };

/**
 * Read-only contract for an Agent-supplied `nodeId -> role` override. It is
 * intentionally explicit because a semantic role map cannot be guessed from a
 * catalog id or a target's array position alone.
 */
export type VersionedMotionExpressionRoleMapContract = {
	readonly direction: "nodeId-to-role";
	readonly roles: readonly {
		readonly roleId: string;
		readonly label: string;
		readonly acceptedValues: readonly string[];
	}[];
	readonly assignments: readonly {
		readonly targetCount: number;
		readonly roleIds: readonly string[];
	}[];
	readonly overflowRoleId?: string;
	readonly maximumTargetCount?: number;
};

const expressionCatalogParams = (
	definition: MotionExpressionDefinition,
): readonly MotionGrammarParamSpec[] =>
	definition.params.map((param) => ({
		key: param.key,
		label: param.label,
		default: param.default,
		min: param.min,
		max: param.max,
		step: param.step,
		...(param.options === undefined ? {} : { options: param.options }),
	}));

const parametersForDefinition = (
	definition: MotionExpressionDefinition,
): Readonly<Record<string, number>> => ({
	...Object.fromEntries(
		definition.params.map((param) => [param.key, param.default]),
	),
	[MOTION_EXPRESSION_VERSION_PARAM_KEY]: definition.version,
});

const roleKey = (
	definition: MotionExpressionDefinition,
	roleId: string,
): string =>
	definition.roles.find((role) => role.roleId === roleId)?.aliases?.[0] ??
	roleId;

const roleMap = (
	definition: MotionExpressionDefinition,
	targetIds: readonly string[],
	roleIdsForTarget: readonly string[],
): Readonly<Record<string, string>> =>
	Object.fromEntries(
		targetIds.map((nodeId, index) => [
			nodeId,
			roleKey(definition, roleIdsForTarget[index] ?? "member"),
		]),
	);

const defaultRoleMap = (
	definition: MotionExpressionDefinition,
	targetIds: readonly string[],
): Readonly<Record<string, string>> | string | undefined => {
	switch (definition.expressionId) {
		case "ring-wave-interference":
			return roleMap(definition, targetIds, [
				"driver",
				"follower",
				"field-center",
				...targetIds.slice(3).map(() => "follower"),
			]);
		case "merge-split-cycle":
			return roleMap(definition, targetIds, [
				"core",
				...targetIds.slice(1).map(() => "member"),
			]);
		case "mirror-symmetric-scale":
			if (targetIds.length > 5) {
				return "Symmetry v1 supports two to five explicitly named roles; split a larger selection into separate symmetry systems.";
			}
			// A three-target symmetry is an outer pair plus a center. Do not
			// assign only one inner role: that would pass creation with a marker
			// but fail the paired-relation contract and leave one target inert.
			return roleMap(
				definition,
				targetIds,
				targetIds.length === 3
					? ["left-outer", "right-outer", "center"]
					: [
							"left-outer",
							"right-outer",
							"left-inner",
							"right-inner",
							"center",
						],
			);
		case "size-speed-parallax":
			return roleMap(definition, targetIds, [
				"foreground",
				"midground",
				...targetIds.slice(2).map(() => "background"),
			]);
		default:
			return undefined;
	}
};

const roleMapAssignmentContract = (
	definition: MotionExpressionDefinition,
): Omit<VersionedMotionExpressionRoleMapContract, "roles"> | undefined => {
	switch (definition.expressionId) {
		case "ring-wave-interference":
			return {
				direction: "nodeId-to-role",
				assignments: [
					{ targetCount: 3, roleIds: ["driver", "follower", "field-center"] },
				],
				overflowRoleId: "follower",
			};
		case "merge-split-cycle":
			return {
				direction: "nodeId-to-role",
				assignments: [{ targetCount: 2, roleIds: ["core", "member"] }],
				overflowRoleId: "member",
			};
		case "mirror-symmetric-scale":
			return {
				direction: "nodeId-to-role",
				assignments: [
					{ targetCount: 2, roleIds: ["left-outer", "right-outer"] },
					{
						targetCount: 3,
						roleIds: ["left-outer", "right-outer", "center"],
					},
					{
						targetCount: 4,
						roleIds: ["left-outer", "right-outer", "left-inner", "right-inner"],
					},
					{
						targetCount: 5,
						roleIds: [
							"left-outer",
							"right-outer",
							"left-inner",
							"right-inner",
							"center",
						],
					},
				],
				maximumTargetCount: 5,
			};
		case "size-speed-parallax":
			return {
				direction: "nodeId-to-role",
				assignments: [{ targetCount: 2, roleIds: ["foreground", "midground"] }],
				overflowRoleId: "background",
			};
		default:
			return undefined;
	}
};

/**
 * Returns the legal direct role-map shape for a new versioned expression. The
 * caller still supplies actual node ids; role arrays are ordered by `targetIds`.
 */
export function versionedMotionExpressionRoleMapContract(
	techniqueId: MotionGrammarTechniqueId,
): VersionedMotionExpressionRoleMapContract | undefined {
	if (techniqueId === FOLLOW_THROUGH_LEAD_ADAPTER_TECHNIQUE_ID) {
		return {
			direction: "nodeId-to-role",
			roles: [
				{
					roleId: FOLLOW_THROUGH_LEAD_ROLE,
					label: "Lead",
					acceptedValues: [
						FOLLOW_THROUGH_LEAD_ROLE,
						`${FOLLOW_THROUGH_LEAD_ADAPTER_TECHNIQUE_ID}:${FOLLOW_THROUGH_LEAD_ROLE}`,
					],
				},
				{
					roleId: FOLLOW_THROUGH_FOLLOWER_ROLE,
					label: "Follower",
					acceptedValues: [
						FOLLOW_THROUGH_FOLLOWER_ROLE,
						`${FOLLOW_THROUGH_LEAD_ADAPTER_TECHNIQUE_ID}:${FOLLOW_THROUGH_FOLLOWER_ROLE}`,
					],
				},
			],
			assignments: [
				{
					targetCount: 2,
					roleIds: [FOLLOW_THROUGH_LEAD_ROLE, FOLLOW_THROUGH_FOLLOWER_ROLE],
				},
			],
			overflowRoleId: FOLLOW_THROUGH_FOLLOWER_ROLE,
		};
	}
	const definition = findMotionExpressionDefinition(techniqueId);
	if (definition?.activation !== "versioned") return undefined;
	const assignment = roleMapAssignmentContract(definition);
	if (!assignment) return undefined;
	return {
		...assignment,
		roles: definition.roles.map((role) => ({
			roleId: role.roleId,
			label: role.label,
			acceptedValues: [role.roleId, ...(role.aliases ?? [])],
		})),
	};
}

const directRoleIdsForTargets = (
	definition: MotionExpressionDefinition,
	targetIds: readonly string[],
	roleMapValue: Readonly<Record<string, string>>,
): readonly string[] | string => {
	const roleIdByAlias = new Map<string, string>();
	for (const role of definition.roles) {
		roleIdByAlias.set(role.roleId, role.roleId);
		for (const alias of role.aliases ?? []) {
			roleIdByAlias.set(alias, role.roleId);
		}
	}
	const resolved: string[] = [];
	for (const targetId of targetIds) {
		const roleId = roleIdByAlias.get(roleMapValue[targetId] ?? "");
		if (!roleId) {
			return `Versioned ${definition.label} requires an explicit known role for target "${targetId}".`;
		}
		resolved.push(roleId);
	}
	return resolved;
};

const roleCount = (roleIds: readonly string[], roleId: string): number =>
	roleIds.filter((candidate) => candidate === roleId).length;

/**
 * Validates the direct `nodeId -> role` map accepted by the Agent boundary.
 * Workspace and Inspector creation use the deterministic map above; this guard
 * prevents an Agent override from creating a marker-enabled but inert relation.
 */
export function validateVersionedMotionExpressionRoleMap(
	techniqueId: MotionGrammarTechniqueId,
	targetIds: readonly string[],
	roleMapValue: Readonly<Record<string, string>>,
): string | undefined {
	if (techniqueId === FOLLOW_THROUGH_LEAD_ADAPTER_TECHNIQUE_ID) {
		return validateFollowThroughLeadAdapterRoleMap(targetIds, roleMapValue);
	}
	const definition = findMotionExpressionDefinition(techniqueId);
	if (definition?.activation !== "versioned") return undefined;
	if (new Set(targetIds).size !== targetIds.length) {
		return "Versioned expressions require each target id exactly once.";
	}
	const targetIdSet = new Set(targetIds);
	const extraKey = Object.keys(roleMapValue).find(
		(key) => !targetIdSet.has(key),
	);
	if (extraKey) {
		return `Versioned ${definition.label} accepts only a direct nodeId-to-role map; "${extraKey}" is not a target id.`;
	}
	if (Object.keys(roleMapValue).length !== targetIds.length) {
		return `Versioned ${definition.label} requires one direct role value for every target id.`;
	}
	if (
		definition.expressionId === "mirror-symmetric-scale" &&
		targetIds.length > 5
	) {
		return "Symmetry v1 supports two to five explicitly named roles; split a larger selection into separate symmetry systems.";
	}
	const roleIds = directRoleIdsForTargets(definition, targetIds, roleMapValue);
	if (typeof roleIds === "string") return roleIds;
	switch (definition.expressionId) {
		case "ring-wave-interference":
			return roleCount(roleIds, "driver") === 1 &&
				roleCount(roleIds, "follower") >= 1 &&
				roleCount(roleIds, "field-center") <= 1
				? undefined
				: "Interference requires exactly one driver, at least one follower, and at most one field center.";
		case "merge-split-cycle":
			return roleCount(roleIds, "core") === 1 &&
				roleCount(roleIds, "member") >= 1
				? undefined
				: "Merge & Split requires exactly one core and at least one member.";
		case "mirror-symmetric-scale": {
			const outerPair =
				roleCount(roleIds, "left-outer") === 1 &&
				roleCount(roleIds, "right-outer") === 1;
			const leftInner = roleCount(roleIds, "left-inner");
			const rightInner = roleCount(roleIds, "right-inner");
			return outerPair &&
				leftInner === rightInner &&
				leftInner <= 1 &&
				roleCount(roleIds, "center") <= 1 &&
				roleCount(roleIds, "member") === 0
				? undefined
				: "Symmetry requires one left/right outer pair, an optional matched inner pair, and at most one center.";
		}
		case "size-speed-parallax":
			return roleCount(roleIds, "foreground") === 1 &&
				roleCount(roleIds, "midground") === 1 &&
				roleCount(roleIds, "background") >= 0
				? undefined
				: "Parallax requires one foreground and one midground role; remaining targets are background roles.";
		default:
			return undefined;
	}
}

export type VersionedMotionExpressionBindingValidationIssue = {
	readonly code:
		| "unsupported-expression-version"
		| "invalid-versioned-role-map"
		| "invalid-versioned-parameters";
	readonly message: string;
};

const isDirectRoleMap = (
	value: unknown,
): value is Readonly<Record<string, string>> =>
	typeof value === "object" &&
	value !== null &&
	!Array.isArray(value) &&
	Object.values(value).every((role) => typeof role === "string");

const isStepAligned = (
	value: number,
	spec: MotionGrammarParamSpec,
): boolean => {
	if (!Number.isFinite(spec.step) || spec.step <= 0) return false;
	const stepIndex = (value - spec.min) / spec.step;
	return (
		Math.abs(stepIndex - Math.round(stepIndex)) <=
		1e-8 * Math.max(1, Math.abs(stepIndex))
	);
};

const versionedBindingParameterIssue = (
	parameters: Readonly<Record<string, number>>,
	specs: readonly MotionGrammarParamSpec[],
): string | undefined => {
	const specsByKey = new Map(specs.map((spec) => [spec.key, spec]));
	for (const key of Object.keys(parameters)) {
		if (key === MOTION_EXPRESSION_VERSION_PARAM_KEY) continue;
		if (!specsByKey.has(key)) {
			return `Versioned motion expression does not declare parameter "${key}".`;
		}
	}
	for (const spec of specs) {
		const value = parameters[spec.key];
		if (typeof value !== "number" || !Number.isFinite(value)) {
			return `Versioned motion expression parameter "${spec.key}" must be a finite number.`;
		}
		if (value < spec.min || value > spec.max) {
			return `Versioned motion expression parameter "${spec.key}" must remain between ${spec.min} and ${spec.max}.`;
		}
		if (
			spec.options &&
			!spec.options.some((option) => option.value === value)
		) {
			return `Versioned motion expression parameter "${spec.key}" must use one declared option.`;
		}
		if (!isStepAligned(value, spec)) {
			return `Versioned motion expression parameter "${spec.key}" must align to its declared step ${spec.step}.`;
		}
	}
	return undefined;
};

/**
 * Validates the entire durable contract selected by a version marker before a
 * command-bus write. Missing markers preserve legacy behavior; an unsupported
 * marker or an active versioned expression never falls through to legacy
 * evaluation. Scene/Motion-dependent eligibility belongs to its owning planner,
 * not this source-free grammar boundary.
 */
export function validateVersionedMotionExpressionBinding(
	binding: MotionGrammarBinding,
): VersionedMotionExpressionBindingValidationIssue | undefined {
	const state = motionExpressionBindingState(
		binding.techniqueId,
		binding.parameters,
	);
	if (state === "unsupported") {
		return {
			code: "unsupported-expression-version",
			message:
				"Motion expression version is unsupported or malformed; the binding was not written.",
		};
	}
	if (state !== "active") return undefined;

	const followThrough = isFollowThroughLeadAdapterParameters(
		binding.techniqueId,
		binding.parameters,
	);
	const definition = findActiveVersionedMotionExpressionDefinition(
		binding.techniqueId,
		binding.parameters,
	);
	const activeVersionedDefinition =
		definition?.activation === "versioned" &&
		isMotionExpressionBindingActive(definition, binding)
			? definition
			: undefined;
	if (!followThrough && !activeVersionedDefinition) return undefined;

	if (!isDirectRoleMap(binding.roleMap)) {
		return {
			code: "invalid-versioned-role-map",
			message:
				"Versioned motion binding requires an explicit direct nodeId-to-role map; the binding was not written.",
		};
	}
	const roleIssue = validateVersionedMotionExpressionRoleMap(
		binding.techniqueId,
		binding.targetIds,
		binding.roleMap,
	);
	if (roleIssue) {
		return {
			code: "invalid-versioned-role-map",
			message: `${roleIssue} The binding was not written.`,
		};
	}

	const parameterSpecs = followThrough
		? FOLLOW_THROUGH_LEAD_ADAPTER_PARAM_SPECS
		: activeVersionedDefinition
			? expressionCatalogParams(activeVersionedDefinition)
			: [];
	const parameterIssue = versionedBindingParameterIssue(
		binding.parameters,
		parameterSpecs,
	);
	return parameterIssue
		? {
				code: "invalid-versioned-parameters",
				message: `${parameterIssue} The binding was not written.`,
			}
		: undefined;
}

/**
 * Returns defaults for a newly authored binding. Versioned expressions replace
 * the legacy catalog defaults wholesale, so stale legacy parameters never
 * appear in a new document. All other techniques preserve their catalog path.
 */
export function createMotionGrammarNewBindingDefaults(
	techniqueId: MotionGrammarTechniqueId,
	targetIds: readonly string[],
): MotionGrammarNewBindingDefaults {
	if (techniqueId === FOLLOW_THROUGH_LEAD_ADAPTER_TECHNIQUE_ID) {
		const roleMap = defaultFollowThroughLeadAdapterRoleMap(targetIds);
		const roleIssue = validateFollowThroughLeadAdapterRoleMap(
			targetIds,
			roleMap,
		);
		return roleIssue
			? { status: "blocked", reason: roleIssue }
			: {
					status: "ready",
					parameters: followThroughLeadAdapterDefaultParameters(),
					roleMap,
				};
	}
	const definition = findMotionExpressionDefinition(techniqueId);
	if (definition?.activation === "versioned") {
		const mappedRoles = defaultRoleMap(definition, targetIds);
		if (typeof mappedRoles === "string") {
			return { status: "blocked", reason: mappedRoles };
		}
		const minimumTargetCount = findCatalogEntry(techniqueId)?.minTargets ?? 0;
		if (mappedRoles && targetIds.length >= minimumTargetCount) {
			const roleIssue = validateVersionedMotionExpressionRoleMap(
				techniqueId,
				targetIds,
				mappedRoles,
			);
			if (roleIssue) return { status: "blocked", reason: roleIssue };
		}
		return {
			status: "ready",
			parameters: parametersForDefinition(definition),
			...(mappedRoles === undefined ? {} : { roleMap: mappedRoles }),
		};
	}
	return {
		status: "ready",
		parameters: Object.fromEntries(
			(findCatalogEntry(techniqueId)?.params ?? []).map((param) => [
				param.key,
				param.default,
			]),
		),
	};
}

/** Parameter specs selected by a fully parsed binding. */
export function motionGrammarParameterSpecsForBinding(
	binding: MotionGrammarBinding,
): readonly MotionGrammarParamSpec[] {
	const state = motionExpressionBindingState(
		binding.techniqueId,
		binding.parameters,
	);
	if (state === "unsupported") return [];
	if (
		isFollowThroughLeadAdapterParameters(
			binding.techniqueId,
			binding.parameters,
		)
	) {
		return FOLLOW_THROUGH_LEAD_ADAPTER_PARAM_SPECS;
	}
	const definition = findActiveVersionedMotionExpressionDefinition(
		binding.techniqueId,
		binding.parameters,
	);
	if (definition && isMotionExpressionBindingActive(definition, binding)) {
		return expressionCatalogParams(definition);
	}
	return findCatalogEntry(binding.techniqueId)?.params ?? [];
}

/** Parameter specs selected before parsing has built a rich binding. */
export function motionGrammarParameterSpecsForSerializedBinding(
	techniqueId: MotionGrammarTechniqueId,
	parameters: Readonly<Record<string, unknown>>,
): readonly MotionGrammarParamSpec[] {
	if (motionExpressionBindingState(techniqueId, parameters) === "unsupported") {
		return [];
	}
	if (isFollowThroughLeadAdapterParameters(techniqueId, parameters)) {
		return FOLLOW_THROUGH_LEAD_ADAPTER_PARAM_SPECS;
	}
	const definition = findActiveVersionedMotionExpressionDefinition(
		techniqueId,
		parameters,
	);
	return definition
		? expressionCatalogParams(definition)
		: (findCatalogEntry(techniqueId)?.params ?? []);
}

/** Parameter specs that an authorable picker must advertise for a new binding. */
export function motionGrammarParameterSpecsForNewBinding(
	techniqueId: MotionGrammarTechniqueId,
): readonly MotionGrammarParamSpec[] {
	if (techniqueId === FOLLOW_THROUGH_LEAD_ADAPTER_TECHNIQUE_ID) {
		return FOLLOW_THROUGH_LEAD_ADAPTER_PARAM_SPECS;
	}
	const definition = findMotionExpressionDefinition(techniqueId);
	return definition?.activation === "versioned"
		? expressionCatalogParams(definition)
		: (findCatalogEntry(techniqueId)?.params ?? []);
}
