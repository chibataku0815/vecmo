/**
 * Codeable Effect: binds an expression-bindable vec-core recipe/influence control
 * to a DSL expression instead of a constant, then resolves it per frame.
 *
 * The binding stores only ids, a canonical {@link RecipeControlPath}, a target ref,
 * and an inert {@link ExpressionSource} AST — never executable code. Recipe
 * resolution is pure: it exposes the prior constant as `value`, evaluates the AST,
 * and writes the clamped scalar back through the SAME {@link applyRecipePathPatch}
 * the constant Inspector uses. Frame influence resolution uses the same pattern
 * against the normalized influence assignment fields.
 */

import { type ExpressionSource, evaluateExpr } from "@/shared/expr-dsl";
import {
	type EffectInfluenceRecipe,
	normalizeEffectInfluenceRecipe,
	type VisualRecipe,
} from "@/shared/vec-core";
import { bindableEffectPropertyForCapabilityId } from "./bindable-property";
import {
	type EffectCapabilityDescriptor,
	type EffectCapabilityTargetScope,
	effectCapabilityById,
	type FrameEffectCapabilityInfluenceNumberField,
} from "./effect-capabilities";
import {
	DEFAULT_FRAME_INFLUENCE_ASSIGNMENT_ID,
	defaultFrameInfluenceRecipe,
} from "./frame-effect-defaults";
import {
	applyRecipePathPatch,
	type RecipeControlPath,
	readRecipeControlValue,
} from "./recipe-controls";

/** Where one effect-expression binding writes. */
export type EffectExpressionTargetRef =
	| { readonly kind: "node"; readonly nodeId: string }
	| { readonly kind: "artboard"; readonly artboardId: string }
	| { readonly kind: "scene" };

/**
 * Shared fields for expression rows. Bindings store inert DSL ASTs and stable
 * capability ids; they never store executable JavaScript.
 */
type EffectExpressionBindingBase = {
	readonly id: string;
	readonly capabilityId: string;
	readonly targetScope: EffectCapabilityTargetScope;
	readonly targetRef: EffectExpressionTargetRef;
	readonly expr: ExpressionSource;
};

/**
 * Scene side-car row binding a vec-core recipe control to an expression.
 * `recipePath` is stored alongside `capabilityId` so the pure resolver needs no
 * registry lookup; the authoring command keeps the two consistent.
 */
export type EffectRecipeExpressionBinding = EffectExpressionBindingBase & {
	readonly recipePath: RecipeControlPath;
	readonly influenceField?: never;
};

/**
 * Scene side-car row binding a frame influence number field to an expression.
 * Influence fields are not recipe paths, so they carry the normalized vec-core
 * field name used by the influence recipe assignment.
 */
export type EffectInfluenceExpressionBinding = EffectExpressionBindingBase & {
	readonly influenceField: FrameEffectCapabilityInfluenceNumberField;
	readonly recipePath?: never;
};

export type EffectExpressionBinding =
	| EffectRecipeExpressionBinding
	| EffectInfluenceExpressionBinding;

/** Clip-local frame inputs; the resolver fills `value`/`i`/`count`/`seed` itself. */
export type EffectExpressionFrameContext = {
	readonly time: number;
	readonly frame: number;
};

/**
 * Returns the underlying vec-core capability only when the bindable property
 * registry marks it expression-bindable and the capability writes a recipe
 * control. This is the authoring gate that keeps non-bindable controls (e.g. the
 * Analog Film preset) out of Effect Code.
 */
export function expressionBindableCapability(
	capabilityId: string,
): EffectCapabilityDescriptor | null {
	const property = bindableEffectPropertyForCapabilityId(capabilityId);
	if (!property?.control.expressionBindable) return null;
	const capability = effectCapabilityById(capabilityId);
	if (!capability) return null;
	if (!capability.targetScopes.some((scope) => scope === "node")) return null;
	if (capability.source.kind !== "recipe-control") return null;
	if (!capability.control.expressionBindable) return null;
	return capability;
}

/**
 * Returns a frame-level vec-core capability only when it can be driven by a safe
 * expression on the requested scene/artboard target. Frame bindings share the
 * Codeable-Effect side-car with node recipe bindings but may write either a
 * recipe scalar or an influence scalar.
 */
export function frameExpressionBindableCapability(
	capabilityId: string,
	targetScope: Extract<EffectCapabilityTargetScope, "artboard" | "scene">,
): EffectCapabilityDescriptor | null {
	const property = bindableEffectPropertyForCapabilityId(capabilityId);
	if (!property?.control.expressionBindable) return null;
	const capability = effectCapabilityById(capabilityId);
	if (!capability) return null;
	if (!capability.targetScopes.some((scope) => scope === targetScope)) {
		return null;
	}
	if (
		capability.source.kind !== "recipe-control" &&
		capability.source.kind !== "influence-control"
	) {
		return null;
	}
	if (!capability.control.expressionBindable) return null;
	return capability;
}

const isRecipeExpressionBinding = (
	binding: EffectExpressionBinding,
): binding is EffectRecipeExpressionBinding => "recipePath" in binding;

const isInfluenceExpressionBinding = (
	binding: EffectExpressionBinding,
): binding is EffectInfluenceExpressionBinding => "influenceField" in binding;

/**
 * Resolves one binding against a node's base recipe at a frame.
 *
 * @returns the overridden recipe (clamped + normalized by the canonical patch), or
 *   `null` when the path is invalid (the caller then emits no override). An
 *   `unchanged` result still returns the recipe so a no-op expression is a stable
 *   identity rather than a dropped frame.
 */
export function resolveEffectExpression(
	binding: EffectExpressionBinding,
	baseRecipe: VisualRecipe,
	frame: EffectExpressionFrameContext,
): VisualRecipe | null {
	if (!isRecipeExpressionBinding(binding)) return null;
	const prior = readRecipeControlValue(baseRecipe, binding.recipePath);
	const value = typeof prior === "number" ? prior : 0;
	const scalar = evaluateExpr(binding.expr.ast, {
		time: frame.time,
		frame: frame.frame,
		value,
		i: 0,
		count: 1,
		seed: 0,
	});
	const result = applyRecipePathPatch(baseRecipe, {
		path: binding.recipePath,
		value: scalar,
	});
	if (result.kind === "applied" || result.kind === "unchanged") {
		return result.recipe;
	}
	return null;
}

const primaryInfluenceAssignmentId = (
	recipe: EffectInfluenceRecipe,
): string | null =>
	recipe.assignments.find(
		(assignment) => assignment.id === DEFAULT_FRAME_INFLUENCE_ASSIGNMENT_ID,
	)?.id ??
	recipe.assignments.find(
		(assignment) =>
			assignment.target.scope === "scene" &&
			assignment.effect.path.startsWith("recipe"),
	)?.id ??
	null;

/**
 * Resolves one frame-influence binding against an influence recipe at a frame.
 * When no recipe exists yet, the shared frame-influence default is used so code
 * can author strength/feather directly from an empty document.
 */
export function resolveEffectInfluenceExpression(
	binding: EffectExpressionBinding,
	baseRecipe: EffectInfluenceRecipe | null | undefined,
	frame: EffectExpressionFrameContext,
): EffectInfluenceRecipe | null {
	if (!isInfluenceExpressionBinding(binding)) return null;
	const current = normalizeEffectInfluenceRecipe(baseRecipe ?? undefined);
	const recipe =
		current.assignments.length > 0 ? current : defaultFrameInfluenceRecipe();
	const assignmentId = primaryInfluenceAssignmentId(recipe);
	if (!assignmentId) return null;
	const assignment = recipe.assignments.find(
		(item) => item.id === assignmentId,
	);
	if (!assignment) return null;
	const prior = assignment.influence[binding.influenceField];
	const scalar = evaluateExpr(binding.expr.ast, {
		time: frame.time,
		frame: frame.frame,
		value: typeof prior === "number" ? prior : 0,
		i: 0,
		count: 1,
		seed: 0,
	});
	return normalizeEffectInfluenceRecipe({
		enabled: true,
		...(recipe.fields ? { fields: recipe.fields } : {}),
		assignments: recipe.assignments.map((item) =>
			item.id === assignmentId
				? {
						...item,
						influence: {
							...item.influence,
							[binding.influenceField]: scalar,
						},
					}
				: item,
		),
	});
}
