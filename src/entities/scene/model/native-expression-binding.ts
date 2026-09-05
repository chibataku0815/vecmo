/**
 * Codeable Native Property: binds a safe expression DSL to core node scalars
 * such as position, transform anchor, rotation, opacity, and rounded-corner
 * geometry. Bindings are side-cars: they never rewrite scene state per frame,
 * and presentation/export evaluate them over the current sampled value.
 */

import {
	type ExprEvalIssue,
	type ExpressionSource,
	evaluateExprResult,
} from "@/shared/expr-dsl";

/**
 * Native scalar properties that can currently be driven by Codeable Native.
 * Paint fields stay out until their sampled semantics are explicit.
 */
export const NATIVE_EXPRESSION_PROPERTY_IDS = [
	"transform.x",
	"transform.y",
	"transform.anchorX",
	"transform.anchorY",
	"transform.rotation",
	"style.opacity",
	"geometry.cornerRadius",
	"geometry.cornerRadii.tl",
	"geometry.cornerRadii.tr",
	"geometry.cornerRadii.br",
	"geometry.cornerRadii.bl",
	"geometry.cornerSmoothing",
] as const;

/** Stable id subset accepted by native expression binding commands. */
export type NativeExpressionPropertyId =
	(typeof NATIVE_EXPRESSION_PROPERTY_IDS)[number];

/** Scene side-car row binding one node-native scalar to a DSL expression. */
export type NativeExpressionBinding = {
	readonly id: string;
	readonly nodeId: string;
	readonly propertyId: NativeExpressionPropertyId;
	readonly expr: ExpressionSource;
};

/**
 * Frame/time values exposed to Codeable Native expression evaluation, plus the
 * optional published-control resolver.
 *
 * The resolver rides on the frame context rather than on a new parameter so the
 * sampling layer threads it in ONE place: every evaluation site already receives
 * this record, and none of them has to learn what a linked production is.
 * Absent resolver → every `control()` reference is unresolved and the binding
 * fails closed.
 */
export type NativeExpressionFrameContext = {
	readonly time: number;
	readonly frame: number;
	readonly controls?: (controlId: string) => number | undefined;
};

const nativeExpressionPropertyIdSet = new Set<string>(
	NATIVE_EXPRESSION_PROPERTY_IDS,
);

/** Narrows a bindable property id to the native expression subset. */
export function nativeExpressionPropertyIdFromBindableId(
	propertyId: string,
): NativeExpressionPropertyId | null {
	return nativeExpressionPropertyIdSet.has(propertyId)
		? (propertyId as NativeExpressionPropertyId)
		: null;
}

/** Deterministic binding id for the one-expression-per-node-property model. */
export function nativeExpressionBindingId(
	nodeId: string,
	propertyId: NativeExpressionPropertyId,
): string {
	return `${propertyId}@node:${nodeId}`;
}

const clampNativeExpressionValue = (
	propertyId: NativeExpressionPropertyId,
	value: number,
): number | null => {
	if (!Number.isFinite(value)) return null;
	if (propertyId === "style.opacity") return Math.min(1, Math.max(0, value));
	if (propertyId === "geometry.cornerSmoothing") {
		return Math.min(1, Math.max(0, value));
	}
	if (
		propertyId === "geometry.cornerRadius" ||
		propertyId.startsWith("geometry.cornerRadii.")
	) {
		return Math.max(0, value);
	}
	return value;
};

/**
 * Evaluates one native expression over the already-sampled scalar. `value` is
 * the current presentation value, so authored constants, keyframes, and grammar
 * composition can be used as the base before code overrides it.
 *
 * Returns `null` when the expression produced no usable value — including the
 * case where a `control()` reference could not be resolved. `null` means "the
 * binding does not apply at this frame", so the base value survives untouched
 * instead of collapsing to a number nobody authored.
 */
export function evaluateNativeExpression(
	binding: NativeExpressionBinding,
	baseValue: number,
	frame: NativeExpressionFrameContext,
): number | null {
	return evaluateNativeExpressionDetailed(binding, baseValue, frame).value;
}

/**
 * Same evaluation, but reporting WHY it produced nothing. Surfaces that can show
 * an authoring diagnostic (Inspector, agent validation) use this; per-frame
 * sampling uses the plain form and simply leaves the value alone.
 */
export function evaluateNativeExpressionDetailed(
	binding: NativeExpressionBinding,
	baseValue: number,
	frame: NativeExpressionFrameContext,
): { readonly value: number | null; readonly issue?: ExprEvalIssue } {
	const result = evaluateExprResult(binding.expr.ast, {
		time: frame.time,
		frame: frame.frame,
		value: baseValue,
		i: 0,
		count: 1,
		seed: 0,
		...(frame.controls ? { controls: frame.controls } : {}),
	});
	if (!result.ok) return { value: null, issue: result.issue };
	return {
		value: clampNativeExpressionValue(binding.propertyId, result.value),
	};
}
