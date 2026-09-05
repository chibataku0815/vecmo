/**
 * Feature bridge for Codeable Native Property bindings. Plans are pure; commit
 * and clear dispatch through the scene command bus so each edit remains one
 * undoable document mutation.
 */

import {
	bindablePropertiesForGeometryKind,
	bindablePropertyById,
} from "@/entities/scene/model/bindable-property";
import {
	type NativeExpressionBinding,
	type NativeExpressionPropertyId,
	nativeExpressionBindingId,
	nativeExpressionPropertyIdFromBindableId,
} from "@/entities/scene/model/native-expression-binding";
import {
	createClearNativeExpressionBindingCommand,
	createSetNativeExpressionBindingCommand,
} from "@/entities/scene/model/native-expression-commands";
import { findNode } from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import {
	EFFECT_EXPR_VARS,
	type ParseError,
	parseExpression,
} from "@/shared/expr-dsl";

export type NativeExpressionPlan =
	| { readonly kind: "ok"; readonly binding: NativeExpressionBinding }
	| { readonly kind: "error"; readonly error: ParseError }
	| { readonly kind: "unknown-property" }
	| { readonly kind: "ineligible-target" };

const nativeExpressionProperty = (
	propertyId: string,
): NativeExpressionPropertyId | null => {
	const descriptor = bindablePropertyById(propertyId);
	if (
		descriptor?.source.kind !== "scene-property" ||
		!descriptor.control.expressionBindable
	) {
		return null;
	}
	return nativeExpressionPropertyIdFromBindableId(descriptor.id);
};

const nativeExpressionPropertyCanTargetNode = (
	propertyId: NativeExpressionPropertyId,
	nodeId: string,
): boolean => {
	const node = findNode(useSceneStore.getState().document, nodeId);
	if (!node) return false;
	return bindablePropertiesForGeometryKind(node.geometry.kind).some(
		(descriptor) => descriptor.id === propertyId,
	);
};

/**
 * Plans a native transform/opacity/rounded-corner expression for one node.
 * `value` resolves to the current sampled scalar at presentation time.
 */
export function planNativeExpression(
	propertyId: string,
	nodeId: string,
	source: string,
): NativeExpressionPlan {
	const property = nativeExpressionProperty(propertyId);
	if (!property) return { kind: "unknown-property" };
	if (!nativeExpressionPropertyCanTargetNode(property, nodeId)) {
		return { kind: "ineligible-target" };
	}
	const parsed = parseExpression(source, EFFECT_EXPR_VARS);
	if (parsed.kind !== "ok") return { kind: "error", error: parsed };
	return {
		kind: "ok",
		binding: {
			id: nativeExpressionBindingId(nodeId, property),
			nodeId,
			propertyId: property,
			expr: parsed.expr,
		},
	};
}

/** Dispatches a planned native expression through the command bus. */
export function commitNativeExpression(plan: NativeExpressionPlan): boolean {
	if (plan.kind !== "ok") return false;
	useSceneStore
		.getState()
		.apply(createSetNativeExpressionBindingCommand(plan.binding));
	return true;
}

/** Clears one native expression binding for one node/property pair. */
export function clearNativeExpression(
	propertyId: NativeExpressionPropertyId,
	nodeId: string,
): void {
	useSceneStore
		.getState()
		.apply(createClearNativeExpressionBindingCommand(nodeId, propertyId));
}
