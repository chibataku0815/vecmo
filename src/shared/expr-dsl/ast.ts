/**
 * Typed AST for the Vecmo expression DSL — the ONLY "code" a user authors that is
 * serialized into a document. Every node is a plain JSON-able POJO: there is no
 * closure, no `Function`, and no host reference anywhere in this union, so storing
 * an {@link ExpressionSource} cannot smuggle executable JavaScript into scene state
 * (the frozen "no executable code in documents" invariant). The text the user types
 * is parsed to this AST at authoring time ({@link ../parse}); per-frame evaluation
 * walks the AST against a sandboxed {@link ExprEvalContext} ({@link ../evaluate}).
 *
 * The same AST is evaluated by the editor sampler AND by the exported standalone
 * runtime (this module is bundled into the exported runtime by
 * `scripts/runtime-sampler-bundle.ts`), which is the
 * structural guarantee that editor preview and external reproduction match.
 */

/**
 * Bumped when the node union grows; rides as data, never executed.
 *
 * v2 adds the `control` node (`control("id")`). It is a widening: every v1 AST
 * normalizes unchanged under v2, while a v2 AST that contains a control
 * reference is deliberately NOT readable by a v1 build — `normalizeExprNode`
 * there returns `null`, so an older build degrades to "no binding" instead of
 * evaluating a reference it cannot resolve.
 */
export const EXPRESSION_DSL_VERSION = 2 as const;

/**
 * Whitelisted variable names. Effect Code and Duplicate Code expose different
 * subsets (see `EFFECT_EXPR_VARS` / `DUPLICATE_EXPR_VARS`); the parser rejects any
 * identifier outside the subset it is given, so an expression cannot read a host
 * global. The interpreter reads ONLY these names from its flat context record.
 *
 * - `time`  clip-local seconds (`frame / fps`)
 * - `frame` clip-local frame number
 * - `value` the bound param's prior constant (Effect Code only)
 * - `i`     instance index 0..count-1 (Duplicate Code only)
 * - `count` resolved instance count (Duplicate Code only)
 * - `seed`  binding seed (Duplicate Code only)
 */
export type ExprVarName = "time" | "frame" | "value" | "i" | "count" | "seed";

export const EXPR_VAR_NAMES = [
	"time",
	"frame",
	"value",
	"i",
	"count",
	"seed",
] as const satisfies readonly ExprVarName[];

/** Variables Effect Code may reference (no per-instance `i`/`count`/`seed`). */
export const EFFECT_EXPR_VARS = ["time", "frame", "value"] as const;

/** Variables Duplicate Code may reference (per-instance fan-out context). */
export const DUPLICATE_EXPR_VARS = [
	"time",
	"frame",
	"i",
	"count",
	"seed",
] as const;

/**
 * Whitelisted function names. The set is closed: the parser rejects any other
 * callee, and the interpreter resolves names only against the frozen builtins
 * table ({@link ../builtins}). All are pure and deterministic; `random` is a
 * seeded integer hash, never `Math.random`. `noise` is a seeded trilinear value
 * noise built from the same integer-lattice-hash mixing as `random`, so it
 * shares the same byte-identical-across-engines guarantee (see `builtins.ts`).
 */
export type ExprFnName =
	| "sin"
	| "cos"
	| "abs"
	| "min"
	| "max"
	| "floor"
	| "mod"
	| "clamp"
	| "lerp"
	| "smoothstep"
	| "random"
	| "noise";

export const EXPR_FN_NAMES = [
	"sin",
	"cos",
	"abs",
	"min",
	"max",
	"floor",
	"mod",
	"clamp",
	"lerp",
	"smoothstep",
	"random",
	"noise",
] as const satisfies readonly ExprFnName[];

/**
 * Exact argument count for each builtin. The parser enforces arity so an
 * ill-formed call is a typed authoring error, never a runtime surprise. `min`/`max`
 * are fixed at 2 in v1 (no variadics) to keep the grammar and the inlined runtime
 * twin trivial. `noise` is fixed at 4 (`x, y, t, seed`) for the same reason.
 */
export const EXPR_FN_ARITY = {
	sin: 1,
	cos: 1,
	abs: 1,
	floor: 1,
	min: 2,
	max: 2,
	mod: 2,
	clamp: 3,
	lerp: 3,
	smoothstep: 3,
	random: 1,
	noise: 4,
} as const satisfies Readonly<Record<ExprFnName, number>>;

/** Binary arithmetic operators, in the DSL's only two precedence tiers. */
export type ExprBinaryOp = "+" | "-" | "*" | "/";

/**
 * Reference form for a published production control: `control("hero_impact")`.
 *
 * It is a DEDICATED node rather than a generic string-literal argument, which
 * keeps strings out of the value grammar entirely — an expression still has no
 * way to produce, concatenate, or compare text, so the only string an AST can
 * carry is this bounded, pattern-checked id.
 *
 * The id grammar mirrors `PublishedControl.id` in
 * `entities/scene/model/production-link.ts`. Resolution is a lookup supplied by
 * the evaluation context; the DSL never learns what a linked production is.
 */
export const EXPR_CONTROL_FN_NAME = "control" as const;
export const EXPR_CONTROL_ID_MAX_LENGTH = 64;
export const EXPR_CONTROL_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/iu;

/**
 * Closed POJO node union. NOTE the deliberate ABSENCE of member access (`.`),
 * indexing (`[]`), assignment, and any statement form: without those productions
 * there is no syntactic path to a prototype-chain escape or to mutation, so the
 * sandbox boundary is structural rather than enforced by runtime checks.
 */
export type ExprNode =
	| { readonly type: "num"; readonly value: number }
	| { readonly type: "var"; readonly name: ExprVarName }
	| { readonly type: "control"; readonly controlId: string }
	| { readonly type: "unary"; readonly op: "-"; readonly operand: ExprNode }
	| {
			readonly type: "binary";
			readonly op: ExprBinaryOp;
			readonly left: ExprNode;
			readonly right: ExprNode;
	  }
	| {
			readonly type: "call";
			readonly fn: ExprFnName;
			readonly args: readonly ExprNode[];
	  };

/**
 * Stored binding payload. `source` is the user's text (kept so the field can be
 * re-edited and re-displayed verbatim); `ast` is the executed truth. Only this pair
 * persists — there is no function reference to serialize.
 */
export type ExpressionSource = {
	readonly source: string;
	readonly ast: ExprNode;
};
