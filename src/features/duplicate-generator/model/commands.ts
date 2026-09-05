/**
 * Feature bridge for authoring Codeable-Duplicate generators. The planner is pure
 * (text fields → generator or typed per-field error); commit/remove dispatch through
 * the scene command bus for one-edit-one-undo. Features must not import other
 * features, so this depends only on entities/shared.
 */

import type { DuplicateGeneratorBinding } from "@/entities/scene/model/duplicate-generator";
import {
	createRemoveDuplicateGeneratorCommand,
	createSetDuplicateGeneratorCommand,
	duplicateGeneratorIdForNode,
} from "@/entities/scene/model/duplicate-generator-commands";
import { useSceneStore } from "@/entities/scene/model/store";
import {
	DUPLICATE_EXPR_VARS,
	type ExpressionSource,
	type ParseError,
	parseExpression,
} from "@/shared/expr-dsl";

export type DuplicateGeneratorChannelKey = "count" | "x" | "y" | "rotation";

export type DuplicateGeneratorFields = {
	readonly count: string;
	readonly x?: string;
	readonly y?: string;
	readonly rotation?: string;
};

export type DuplicateGeneratorPlan =
	| { readonly kind: "ok"; readonly generator: DuplicateGeneratorBinding }
	| {
			readonly kind: "error";
			readonly field: DuplicateGeneratorChannelKey;
			readonly error: ParseError;
	  };

type OptionalChannel =
	| { readonly ok: true; readonly value?: ExpressionSource }
	| { readonly ok: false; readonly error: ParseError };

const parseOptionalChannel = (source: string | undefined): OptionalChannel => {
	if (!source || source.trim().length === 0) return { ok: true };
	const parsed = parseExpression(source, DUPLICATE_EXPR_VARS);
	if (parsed.kind !== "ok") return { ok: false, error: parsed };
	return { ok: true, value: parsed.expr };
};

/**
 * Plans a duplicate generator from the Inspector text fields. `count` is required;
 * `x`/`y`/`rotation` are optional (blank ⇒ no channel). Returns the first failing
 * field's typed error. Pure — no document mutation.
 */
export function planDuplicateGenerator(
	nodeId: string,
	fields: DuplicateGeneratorFields,
): DuplicateGeneratorPlan {
	const count = parseExpression(fields.count, DUPLICATE_EXPR_VARS);
	if (count.kind !== "ok") {
		return { kind: "error", field: "count", error: count };
	}
	const x = parseOptionalChannel(fields.x);
	if (!x.ok) return { kind: "error", field: "x", error: x.error };
	const y = parseOptionalChannel(fields.y);
	if (!y.ok) return { kind: "error", field: "y", error: y.error };
	const rotation = parseOptionalChannel(fields.rotation);
	if (!rotation.ok) {
		return { kind: "error", field: "rotation", error: rotation.error };
	}
	return {
		kind: "ok",
		generator: {
			id: duplicateGeneratorIdForNode(nodeId),
			sourceNodeId: nodeId,
			count: count.expr,
			instance: {
				...(x.value ? { x: x.value } : {}),
				...(y.value ? { y: y.value } : {}),
				...(rotation.value ? { rotation: rotation.value } : {}),
			},
		},
	};
}

/** Dispatches a planned generator through the command bus. */
export function commitDuplicateGenerator(
	plan: DuplicateGeneratorPlan,
): boolean {
	if (plan.kind !== "ok") return false;
	useSceneStore
		.getState()
		.apply(createSetDuplicateGeneratorCommand(plan.generator));
	return true;
}

/** Removes the duplicate generator on one node. */
export function removeDuplicateGenerator(nodeId: string): void {
	useSceneStore
		.getState()
		.apply(
			createRemoveDuplicateGeneratorCommand(
				duplicateGeneratorIdForNode(nodeId),
			),
		);
}
