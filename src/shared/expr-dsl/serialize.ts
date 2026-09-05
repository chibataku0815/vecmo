/**
 * Load-boundary validation for stored expression ASTs.
 *
 * A document is untrusted input: its expression-bearing side-cars
 * (`nativeExpressionBindings`, `effectExpressionBindings`, and
 * `duplicateGenerators`) carry an {@link ExprNode} that a hand-edited or
 * forward-version file could malform. {@link normalizeExprNode} structurally
 * re-validates an `unknown` value against the closed node union, the frozen
 * builtin names/arities, and the caller-supplied variable subset, returning
 * `null` on ANY deviation so callers degrade to "no binding" rather than
 * evaluating a malformed tree. Because the grammar has no executable node form,
 * a structurally-valid AST is by construction inert data — this function is the
 * deserialization counterpart to the parser's authoring-time guarantees.
 */

import {
	EXPR_CONTROL_ID_PATTERN,
	EXPR_FN_ARITY,
	EXPR_FN_NAMES,
	type ExprBinaryOp,
	type ExpressionSource,
	type ExprFnName,
	type ExprNode,
	type ExprVarName,
} from "./ast";

/**
 * Per-surface grammar options. `allowControlReferences` defaults to `false`, so
 * a surface with no control resolver can neither parse nor re-admit a stored
 * `control()` node it would be unable to evaluate.
 */
export type ExprGrammarOptions = {
	readonly allowControlReferences?: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isFnName = (text: string): text is ExprFnName =>
	(EXPR_FN_NAMES as readonly string[]).includes(text);

const isBinaryOp = (text: unknown): text is ExprBinaryOp =>
	text === "+" || text === "-" || text === "*" || text === "/";

/**
 * Validates and reconstructs a stored AST against the closed node union plus the
 * allowed variable subset. Returns a fresh canonical node (dropping any extra
 * fields) or `null` if the input is not a well-formed, in-whitelist expression.
 */
export function normalizeExprNode(
	value: unknown,
	allowedVars: readonly ExprVarName[],
	options: ExprGrammarOptions = {},
): ExprNode | null {
	if (!isRecord(value) || typeof value.type !== "string") return null;
	switch (value.type) {
		case "num":
			return typeof value.value === "number" && Number.isFinite(value.value)
				? { type: "num", value: value.value }
				: null;
		case "var":
			return typeof value.name === "string" &&
				(allowedVars as readonly string[]).includes(value.name)
				? { type: "var", name: value.name as ExprVarName }
				: null;
		case "control":
			return options.allowControlReferences === true &&
				typeof value.controlId === "string" &&
				EXPR_CONTROL_ID_PATTERN.test(value.controlId)
				? { type: "control", controlId: value.controlId }
				: null;
		case "unary": {
			if (value.op !== "-") return null;
			const operand = normalizeExprNode(value.operand, allowedVars, options);
			return operand ? { type: "unary", op: "-", operand } : null;
		}
		case "binary": {
			if (!isBinaryOp(value.op)) return null;
			const left = normalizeExprNode(value.left, allowedVars, options);
			const right = normalizeExprNode(value.right, allowedVars, options);
			return left && right
				? { type: "binary", op: value.op, left, right }
				: null;
		}
		case "call": {
			if (typeof value.fn !== "string" || !isFnName(value.fn)) return null;
			if (!Array.isArray(value.args)) return null;
			if (value.args.length !== EXPR_FN_ARITY[value.fn]) return null;
			const args: ExprNode[] = [];
			for (const rawArg of value.args) {
				const arg = normalizeExprNode(rawArg, allowedVars, options);
				if (!arg) return null;
				args.push(arg);
			}
			return { type: "call", fn: value.fn, args };
		}
		default:
			return null;
	}
}

/**
 * Validates a stored {@link ExpressionSource}: a string `source` plus an AST that
 * normalizes against `allowedVars`. Returns a canonical source or `null`.
 */
export function normalizeExpressionSource(
	value: unknown,
	allowedVars: readonly ExprVarName[],
	options: ExprGrammarOptions = {},
): ExpressionSource | null {
	if (!isRecord(value) || typeof value.source !== "string") return null;
	const ast = normalizeExprNode(value.ast, allowedVars, options);
	return ast ? { source: value.source, ast } : null;
}
