/**
 * Generic runtime sampling adapter for motion-expression definitions. ONE adapter
 * projects any definition's `sample` output onto `GrammarNodeSample`, so promoting
 * a new technique never adds an evaluator switch case.
 *
 * Validation here guards the COMPUTED output (finite scalar/vector components,
 * structural object channels, declared-channel-only); input parameter clamping is
 * NOT done here — that already happens in `normalizeMotionGrammarAuthoringParameterPatch`
 * against each param's min/max envelope. The sampler is pure: it reads the scene
 * for rest positions only and never writes a store or command bus.
 */

import type {
	GrammarNodeSample,
	GrammarPresentationIssue,
} from "@/entities/motion/model/grammar-bridge";
import { sampleNodePathMetric } from "@/entities/scene/model/path-metrics";
import {
	getGeometryBounds,
	getNodeParentBounds,
} from "@/entities/scene/model/rendering";
import { findNode } from "@/entities/scene/model/selectors";
import type { SceneDocument } from "@/entities/scene/model/types";
import type {
	ExpressionChannelEmit,
	ExpressionSampleEnv,
	ExpressionVector2,
	MotionExpressionDefinition,
} from "./expression-definition";
import type { MotionGrammarBinding } from "./types";

const ZERO_POSITION: ExpressionVector2 = { x: 0, y: 0 };

const isFiniteNumber = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

const isFiniteVector = (value: ExpressionVector2): boolean =>
	isFiniteNumber(value.x) && isFiniteNumber(value.y);

const isRecipeLike = (value: unknown): boolean =>
	typeof value === "object" && value !== null;

const aliasesForRole = (
	role: MotionExpressionDefinition["roles"][number],
): readonly string[] => [role.roleId, ...(role.aliases ?? [])];

const uniquePush = (items: string[], value: string): void => {
	if (!items.includes(value)) items.push(value);
};

const pushResolvedRoleNode = (
	resolved: Map<string, string[]>,
	roleId: string,
	nodeId: string,
): void => {
	const nodeIds = resolved.get(roleId);
	if (!nodeIds) return;
	uniquePush(nodeIds, nodeId);
};

const primaryRoleIdForDefinition = (
	definition: MotionExpressionDefinition,
): string => {
	const expansion = definition.roleExpansion;
	return expansion.mode === "per-target"
		? expansion.roleId
		: expansion.sourceRoleId;
};

/**
 * Resolves declared expression roles from the binding's persisted `roleMap`.
 * Both historical conventions are supported: `nodeId -> roleKey` from workspace
 * systems and `roleKey -> nodeId` from authored role slots. The expansion role
 * remains the family role: every target not claimed by a non-primary role is
 * included there, so extra generated/selected members still move as one family.
 */
const resolveRoleNodeIds = (
	definition: MotionExpressionDefinition,
	binding: MotionGrammarBinding,
): ReadonlyMap<string, readonly string[]> => {
	const resolved = new Map<string, string[]>();
	const roleIdByAlias = new Map<string, string>();
	const targetIds = new Set(binding.targetIds);
	const primaryRoleId = primaryRoleIdForDefinition(definition);

	for (const role of definition.roles) {
		resolved.set(role.roleId, []);
		for (const alias of aliasesForRole(role)) {
			roleIdByAlias.set(alias, role.roleId);
		}
	}

	if (binding.roleMap) {
		for (const nodeId of binding.targetIds) {
			const roleId = roleIdByAlias.get(binding.roleMap[nodeId] ?? "");
			if (roleId) pushResolvedRoleNode(resolved, roleId, nodeId);
		}
		for (const role of definition.roles) {
			for (const alias of aliasesForRole(role)) {
				const nodeId = binding.roleMap[alias];
				if (nodeId && targetIds.has(nodeId)) {
					pushResolvedRoleNode(resolved, role.roleId, nodeId);
				}
			}
		}
	}

	const nonPrimaryRoleNodeIds = new Set<string>();
	for (const [roleId, nodeIds] of resolved) {
		if (roleId === primaryRoleId) continue;
		for (const nodeId of nodeIds) nonPrimaryRoleNodeIds.add(nodeId);
	}
	const primaryNodeIds = resolved.get(primaryRoleId) ?? [];
	for (const nodeId of binding.targetIds) {
		if (binding.roleMap && nonPrimaryRoleNodeIds.has(nodeId)) continue;
		uniquePush(primaryNodeIds, nodeId);
	}
	resolved.set(primaryRoleId, primaryNodeIds);

	return new Map(
		[...resolved.entries()].map(([roleId, nodeIds]) => [roleId, [...nodeIds]]),
	);
};

/**
 * Builds the pure sampling environment for one definition/binding pair.
 * Exported so bake-side emitters (e.g. `collision-bounce-bake.ts`) resolve
 * roles and rest positions identically to live sampling — role resolution
 * (alias handling, non-primary-role exclusion) is nontrivial enough that a
 * bake emitter must reuse it rather than re-derive it, or the two could
 * silently disagree on which nodes count as which role.
 */
export const buildExpressionSampleEnv = (
	definition: MotionExpressionDefinition,
	binding: MotionGrammarBinding,
	input: {
		readonly scene: SceneDocument;
		readonly frame: number;
		readonly samplePositionAt?: (
			nodeId: string,
			frame: number,
		) => ExpressionVector2;
		readonly sampleScaleAt?: (
			nodeId: string,
			frame: number,
		) => ExpressionVector2;
		readonly restCircleRadiusOf?: (nodeId: string) => number | null;
	},
): ExpressionSampleEnv => ({
	frame: input.frame,
	resolvedRoleNodeIds: resolveRoleNodeIds(definition, binding),
	parameters: binding.parameters,
	seed: binding.seed,
	randomPulseProfile: binding.randomPulseProfile,
	restPositionOf: (nodeId) =>
		findNode(input.scene, nodeId)?.transform.position ?? ZERO_POSITION,
	samplePositionAt: input.samplePositionAt,
	sampleScaleAt: input.sampleScaleAt,
	restCircleRadiusOf:
		input.restCircleRadiusOf ??
		((nodeId) => {
			const node = findNode(input.scene, nodeId);
			if (node?.geometry.kind !== "ellipse") return null;
			const bounds = getGeometryBounds(node.geometry);
			return bounds.width === bounds.height && bounds.width > 0
				? bounds.width / 2
				: null;
		}),
	restPointOf: (nodeId) => {
		const node = findNode(input.scene, nodeId);
		if (!node) return ZERO_POSITION;
		const bounds = getNodeParentBounds(node);
		return {
			x: bounds.x + bounds.width / 2,
			y: bounds.y + bounds.height / 2,
		};
	},
	pathSampleAt: (nodeId, progress, options) => {
		const node = findNode(input.scene, nodeId);
		return node ? sampleNodePathMetric(node, progress, options) : null;
	},
});

const canEmitRecipeOverride = (
	definition: MotionExpressionDefinition,
	env: ExpressionSampleEnv,
	emit: ExpressionChannelEmit,
): boolean => {
	if (emit.kind !== "recipeOverride") return true;
	const hooks = (definition.lookHooks ?? []).filter(
		(hook) => hook.outputChannel === "recipeOverride",
	);
	if (hooks.length === 0) return false;
	return hooks.some((hook) => {
		if (!hook.targetRoleId) return true;
		return (env.resolvedRoleNodeIds.get(hook.targetRoleId) ?? []).some(
			(nodeId) => nodeId === emit.nodeId,
		);
	});
};

const isEmitValueValid = (emit: ExpressionChannelEmit): boolean => {
	switch (emit.kind) {
		case "translate":
		case "scaleFactor":
			return isFiniteVector(emit.value);
		case "recipeOverride":
			return isRecipeLike(emit.value);
		default:
			return isFiniteNumber(emit.value);
	}
};

const mergeEmit = (
	base: GrammarNodeSample,
	emit: ExpressionChannelEmit,
): GrammarNodeSample => {
	switch (emit.kind) {
		case "translate":
			return { ...base, translate: emit.value };
		case "scaleFactor":
			return { ...base, scaleFactor: emit.value };
		case "sourceFrame":
			return { ...base, sourceFrame: emit.value };
		case "rotate":
			return { ...base, rotate: emit.value };
		case "opacityFactor":
			return { ...base, opacityFactor: emit.value };
		case "opacityOverride":
			return { ...base, opacityOverride: emit.value };
		case "rotationOverride":
			return { ...base, rotationOverride: emit.value };
		case "strokeDashoffset":
			return { ...base, strokeDashoffset: emit.value };
		case "recipeOverride":
			return { ...base, recipeOverride: emit.value };
	}
};

const applyEmit = (
	out: Map<string, GrammarNodeSample>,
	emit: ExpressionChannelEmit,
	binding: MotionGrammarBinding,
	definition: MotionExpressionDefinition,
	env: ExpressionSampleEnv,
	issues: GrammarPresentationIssue[] | undefined,
): void => {
	if (!canEmitRecipeOverride(definition, env, emit)) {
		issues?.push({
			code: "undeclared-expression-look-hook",
			bindingId: binding.id,
			nodeId: emit.nodeId,
			techniqueId: binding.techniqueId,
		});
		return;
	}
	if (!isEmitValueValid(emit)) {
		issues?.push({
			code: "non-finite-expression-output",
			bindingId: binding.id,
			nodeId: emit.nodeId,
			techniqueId: binding.techniqueId,
		});
		return;
	}
	out.set(
		emit.nodeId,
		mergeEmit(out.get(emit.nodeId) ?? { nodeId: emit.nodeId }, emit),
	);
};

/**
 * Samples one expression-backed binding for one (already clip-local) frame and
 * composes its typed channel emits into `out`. Emits whose `kind` is not in the
 * definition's declared `outputs`, and emits with non-finite/malformed values,
 * are rejected (recorded in `issues` when provided) rather than written.
 */
export const sampleExpressionBinding = (
	definition: MotionExpressionDefinition,
	binding: MotionGrammarBinding,
	input: {
		readonly scene: SceneDocument;
		readonly frame: number;
		readonly samplePositionAt?: (
			nodeId: string,
			frame: number,
		) => ExpressionVector2;
		readonly sampleScaleAt?: (
			nodeId: string,
			frame: number,
		) => ExpressionVector2;
		readonly restCircleRadiusOf?: (nodeId: string) => number | null;
	},
	out: Map<string, GrammarNodeSample>,
	issues?: GrammarPresentationIssue[],
): void => {
	const declared = new Set(definition.outputs);
	const env = buildExpressionSampleEnv(definition, binding, input);
	for (const emit of definition.sample(env)) {
		if (!declared.has(emit.kind)) {
			issues?.push({
				code: "unknown-expression-output",
				bindingId: binding.id,
				nodeId: emit.nodeId,
				techniqueId: binding.techniqueId,
			});
			continue;
		}
		applyEmit(out, emit, binding, definition, env, issues);
	}
};
