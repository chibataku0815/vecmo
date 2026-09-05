/**
 * Feature bridge for authoring Codeable-Effect bindings. The planner is pure (text →
 * binding or typed error) so the Inspector can surface parse errors before touching
 * the document; the commit/clear helpers dispatch through the scene command bus
 * (single-writer), giving one-edit-one-undo. Features must not import other features,
 * so this depends only on entities/shared.
 */

import {
	type EffectExpressionBinding,
	type EffectExpressionTargetRef,
	expressionBindableCapability,
	frameExpressionBindableCapability,
} from "@/entities/scene/model/effect-expression-binding";
import {
	createClearEffectExpressionBindingCommand,
	createSetEffectExpressionBindingCommand,
} from "@/entities/scene/model/effect-expression-commands";
import { useSceneStore } from "@/entities/scene/model/store";
import {
	EFFECT_EXPR_VARS,
	type ParseError,
	parseExpression,
} from "@/shared/expr-dsl";

export type EffectExpressionPlan =
	| { readonly kind: "ok"; readonly binding: EffectExpressionBinding }
	| { readonly kind: "error"; readonly error: ParseError }
	| { readonly kind: "unknown-capability" };

export type FrameEffectExpressionTargetRef = Extract<
	EffectExpressionTargetRef,
	{ readonly kind: "artboard" } | { readonly kind: "scene" }
>;

const frameExpressionTargetKey = (
	targetRef: FrameEffectExpressionTargetRef,
): string =>
	targetRef.kind === "scene" ? "scene" : `artboard:${targetRef.artboardId}`;

/**
 * Plans a node-scoped effect expression: validates the capability is an
 * expression-bindable recipe control and the text parses against the Effect Code
 * variable subset. Pure — no document mutation.
 */
export function planNodeEffectExpression(
	capabilityId: string,
	nodeId: string,
	source: string,
): EffectExpressionPlan {
	const capability = expressionBindableCapability(capabilityId);
	if (capability?.source.kind !== "recipe-control") {
		return { kind: "unknown-capability" };
	}
	const parsed = parseExpression(source, EFFECT_EXPR_VARS);
	if (parsed.kind !== "ok") return { kind: "error", error: parsed };
	return {
		kind: "ok",
		binding: {
			id: `${capabilityId}@node:${nodeId}`,
			capabilityId,
			recipePath: capability.source.recipePath,
			targetScope: "node",
			targetRef: { kind: "node", nodeId },
			expr: parsed.expr,
		},
	};
}

/**
 * Plans a scene/artboard-scoped effect expression. This accepts the frame-level
 * vec-core controls surfaced as `effect.frame-look.*` and
 * `effect.frame-influence.*` bindable properties, then emits the same inert
 * side-car binding shape the renderer/export sampler already consumes.
 */
export function planFrameEffectExpression(
	capabilityId: string,
	targetRef: FrameEffectExpressionTargetRef,
	source: string,
): EffectExpressionPlan {
	const capability = frameExpressionBindableCapability(
		capabilityId,
		targetRef.kind,
	);
	if (!capability) return { kind: "unknown-capability" };
	const parsed = parseExpression(source, EFFECT_EXPR_VARS);
	if (parsed.kind !== "ok") return { kind: "error", error: parsed };
	const targetKey = frameExpressionTargetKey(targetRef);
	if (capability.source.kind === "recipe-control") {
		return {
			kind: "ok",
			binding: {
				id: `${capabilityId}@${targetKey}`,
				capabilityId,
				recipePath: capability.source.recipePath,
				targetScope: targetRef.kind,
				targetRef,
				expr: parsed.expr,
			},
		};
	}
	if (capability.source.kind !== "influence-control") {
		return { kind: "unknown-capability" };
	}
	return {
		kind: "ok",
		binding: {
			id: `${capabilityId}@${targetKey}`,
			capabilityId,
			influenceField: capability.source.field,
			targetScope: targetRef.kind,
			targetRef,
			expr: parsed.expr,
		},
	};
}

/** Dispatches a planned effect binding through the command bus. */
export function commitNodeEffectExpression(
	plan: EffectExpressionPlan,
): boolean {
	if (plan.kind !== "ok") return false;
	useSceneStore
		.getState()
		.apply(createSetEffectExpressionBindingCommand(plan.binding));
	return true;
}

/** Dispatches a planned frame effect binding through the command bus. */
export function commitFrameEffectExpression(
	plan: EffectExpressionPlan,
): boolean {
	if (plan.kind !== "ok") return false;
	useSceneStore
		.getState()
		.apply(createSetEffectExpressionBindingCommand(plan.binding));
	return true;
}

/** Clears the effect expression bound to one capability on one node. */
export function clearNodeEffectExpression(
	capabilityId: string,
	nodeId: string,
): void {
	useSceneStore.getState().apply(
		createClearEffectExpressionBindingCommand(capabilityId, {
			kind: "node",
			nodeId,
		}),
	);
}

/** Clears the frame effect expression bound to one capability on a scene/artboard. */
export function clearFrameEffectExpression(
	capabilityId: string,
	targetRef: FrameEffectExpressionTargetRef,
): void {
	useSceneStore
		.getState()
		.apply(createClearEffectExpressionBindingCommand(capabilityId, targetRef));
}
