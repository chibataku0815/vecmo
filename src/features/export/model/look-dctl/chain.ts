/**
 * Closure-chain function signature shared by every Look Graph node's DCTL
 * function, including the fixed root sampler. Every node — pointwise now,
 * uv-remap/gather in later slices — receives the full texture/resolution
 * context because a later uv-remap node must be free to hand a *modified*
 * `uv` down to an upstream sampler; threading only "needed args" per node
 * would make that impossible without changing every signature later.
 */
export const CHAIN_SIGNATURE_PARAMS =
	"__TEXTURE__ p_TexR, __TEXTURE__ p_TexG, __TEXTURE__ p_TexB, int p_Width, int p_Height, float2 uv";

/** Argument list matching {@link CHAIN_SIGNATURE_PARAMS}, for building call expressions. */
export const CHAIN_CALL_ARGS = "p_TexR, p_TexG, p_TexB, p_Width, p_Height, uv";

/** Fixed name of the chain-root function that samples the source texture. */
export const ROOT_FN_NAME = "lk_source";

/** The `lk_node_<i>` function name for the node at topo-order index `i`. */
export const chainFnName = (index: number): string => `lk_node_${index}`;

/** A full call expression for a chain function, e.g. `lk_node_2(p_TexR, ..., uv)`. */
export const chainCall = (fnName: string): string =>
	`${fnName}(${CHAIN_CALL_ARGS})`;

/**
 * A call expression for a chain function with an explicit `float2` uv
 * expression substituted for the trailing `uv` argument — used by uv-remap
 * emitters (which must sample upstream at a *modified* coordinate, e.g.
 * `uv2`) and gather emitters (which sample upstream at several offset
 * coordinates). {@link chainCall} is the `uvExpr === "uv"` special case.
 */
export const chainCallAt = (fnName: string, uvExpr: string): string =>
	`${fnName}(p_TexR, p_TexG, p_TexB, p_Width, p_Height, ${uvExpr})`;
