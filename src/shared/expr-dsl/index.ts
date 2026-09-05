/**
 * Vecmo expression DSL — a tiny, safe, deterministic formula language whose AST is
 * stored as inert document data and evaluated identically in the editor and in the
 * exported standalone runtime. This barrel is the single public entry; nothing
 * outside `shared/expr-dsl` should import its internal modules directly.
 */

export {
	DUPLICATE_EXPR_VARS,
	EFFECT_EXPR_VARS,
	EXPR_CONTROL_FN_NAME,
	EXPR_CONTROL_ID_PATTERN,
	EXPR_FN_ARITY,
	EXPR_FN_NAMES,
	EXPR_VAR_NAMES,
	EXPRESSION_DSL_VERSION,
	type ExprBinaryOp,
	type ExpressionSource,
	type ExprFnName,
	type ExprNode,
	type ExprVarName,
} from "./ast";
export { applyBuiltin } from "./builtins";
export {
	type ExprEvalContext,
	type ExprEvalIssue,
	type ExprEvalResult,
	evaluateExpr,
	evaluateExprResult,
} from "./evaluate";
export { expressionFrameTime } from "./frame-time";
export {
	EXPR_MAX_SOURCE_LENGTH,
	type ParseError,
	type ParseResult,
	parseExpression,
} from "./parse";
export {
	type ExprGrammarOptions,
	normalizeExpressionSource,
	normalizeExprNode,
} from "./serialize";
