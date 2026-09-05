/**
 * Pure, deterministic tree-walk evaluator for the expression DSL.
 *
 * `evaluateExpr(ast, ctx)` reads ONLY the flat {@link ExprEvalContext} record and
 * the frozen builtins table — there is no scope object, no `this`, and no host
 * reachability by construction, so an expression cannot observe or mutate anything
 * outside its sandbox. Every node result passes through {@link finiteOr0}, so the
 * output is ALWAYS a finite number (division by zero, `NaN`, `±Infinity` all
 * collapse to 0 deterministically) — the editor and the inlined runtime twin make
 * the identical choice, so they cannot diverge on degenerate input.
 *
 * A step budget bounds total node visits as a backstop; ASTs are produced only by
 * the bounded parser, so this guards against a hand-built or corrupted AST, not
 * normal authoring.
 */

import type { ExprNode } from "./ast";
import { applyBuiltin } from "./builtins";

/**
 * Sandbox: the complete set of names an expression can read. A flat record of
 * whitelisted variables only — no prototype, no methods, no host globals. Effect
 * Code leaves `i`/`count`/`seed` at their defaults; Duplicate Code leaves `value`
 * at its default. The parser guarantees an AST never references a name absent from
 * the subset it was parsed against.
 */
export type ExprEvalContext = {
	readonly time: number;
	readonly frame: number;
	readonly value: number;
	readonly i: number;
	readonly count: number;
	readonly seed: number;
	/**
	 * Resolver for `control("id")`. It is a pure lookup supplied by the host —
	 * built from the Scene link's static value plus the Motion control track — so
	 * the DSL still reads nothing beyond its own flat context.
	 *
	 * `undefined` means UNRESOLVED, which is deliberately not zero: the evaluation
	 * is reported as failed and the caller keeps its base value. An absent
	 * resolver makes every control reference unresolved, which is why a surface
	 * that cannot resolve controls must also refuse to parse them.
	 */
	readonly controls?: (controlId: string) => number | undefined;
};

/** Why one evaluation produced no usable number. */
export type ExprEvalIssue = {
	readonly kind: "unresolved-control";
	readonly controlId: string;
};

export type ExprEvalResult =
	| { readonly ok: true; readonly value: number }
	| { readonly ok: false; readonly issue: ExprEvalIssue };

/** Backstop on total node visits for a single evaluation. */
const MAX_EVAL_STEPS = 10_000;

/** Collapses any non-finite intermediate to 0 so output is always finite. */
const finiteOr0 = (value: number): number =>
	Number.isFinite(value) ? value : 0;

const readVar = (
	name: ExprNode & { type: "var" },
	ctx: ExprEvalContext,
): number => {
	switch (name.name) {
		case "time":
			return ctx.time;
		case "frame":
			return ctx.frame;
		case "value":
			return ctx.value;
		case "i":
			return ctx.i;
		case "count":
			return ctx.count;
		case "seed":
			return ctx.seed;
	}
};

const applyBinary = (
	op: "+" | "-" | "*" | "/",
	left: number,
	right: number,
): number => {
	switch (op) {
		case "+":
			return left + right;
		case "-":
			return left - right;
		case "*":
			return left * right;
		case "/":
			return right === 0 ? 0 : left / right;
	}
};

/**
 * Evaluates one AST against a sandboxed context, returning a finite number.
 *
 * When a `control()` reference cannot be resolved this returns the context's
 * base `value` — the "leave it as it was" outcome — rather than a fabricated 0.
 * Callers that must DISTINGUISH "unchanged" from "failed" use
 * {@link evaluateExprResult}.
 *
 * @param ast bounded expression AST from {@link ../parse}
 * @param ctx whitelisted variable values for this frame/instance
 * @returns a finite number (never `NaN`/`Infinity`)
 */
export const evaluateExpr = (ast: ExprNode, ctx: ExprEvalContext): number => {
	const result = evaluateExprResult(ast, ctx);
	return result.ok ? result.value : finiteOr0(ctx.value);
};

/**
 * Evaluates one AST and reports WHY it failed when it did.
 *
 * An unresolved `control("id")` aborts the whole evaluation instead of
 * contributing a substitute number: a control reference that quietly evaluated
 * to 0 would move every dependent element to a pose the author never asked for,
 * which is exactly the silent-failure mode the fan-out design forbids. Callers
 * fail closed by keeping their base value.
 *
 * @param ast bounded expression AST from {@link ../parse}
 * @param ctx whitelisted variable values plus the optional control resolver
 */
export const evaluateExprResult = (
	ast: ExprNode,
	ctx: ExprEvalContext,
): ExprEvalResult => {
	let steps = 0;
	let issue: ExprEvalIssue | null = null;
	const walk = (node: ExprNode): number => {
		steps += 1;
		if (steps > MAX_EVAL_STEPS) return 0;
		switch (node.type) {
			case "num":
				return finiteOr0(node.value);
			case "var":
				return finiteOr0(readVar(node, ctx));
			case "control": {
				const resolved = ctx.controls?.(node.controlId);
				if (resolved === undefined || !Number.isFinite(resolved)) {
					issue ??= { kind: "unresolved-control", controlId: node.controlId };
					return 0;
				}
				return resolved;
			}
			case "unary":
				return finiteOr0(-walk(node.operand));
			case "binary":
				return finiteOr0(
					applyBinary(node.op, walk(node.left), walk(node.right)),
				);
			case "call":
				return finiteOr0(applyBuiltin(node.fn, node.args.map(walk)));
		}
	};
	const value = walk(ast);
	return issue ? { ok: false, issue } : { ok: true, value };
};
