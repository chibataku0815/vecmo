import type {
	LookGraphNode,
	LookGraphNodeKind,
} from "@/entities/scene/model/look-graph";
import type { DctlSourceBuilder } from "@/shared/dctl";

/**
 * Per-node DCTL export fidelity, mirroring {@link import("@/entities/scene/model/look-graph-compile").LookGraphFidelity}'s
 * vocabulary shape for the DCTL lowering target. `exact` faithfully
 * reproduces the node's math; `approx` is a documented approximation (e.g. a
 * noise field DCTL has no primitive for); `unsupported` nodes still get a
 * closure-chain function (a commented pass-through) so the chain never
 * silently drops a node — only their color contribution is omitted.
 */
export type LookDctlFidelity =
	| {
			readonly nodeId: string;
			readonly kind: LookGraphNodeKind;
			readonly status: "exact";
	  }
	| {
			readonly nodeId: string;
			readonly kind: LookGraphNodeKind;
			readonly status: "approx" | "unsupported";
			/** `dctl-*` reason code + human explanation, mirroring the `LookGraphFidelity` reason convention. */
			readonly reason: string;
	  };

/**
 * Summary of the S3 tap-budget guard's outcome for one export: the fixed
 * budget constant every node's tap count is checked against, and the largest
 * worst-case tap product (how many times the chain root would evaluate in
 * the worst case) reached by any node in the compiled graph. `worstCaseProduct`
 * staying at or under `budget` means no node needed to degrade; a `budget`-
 * bounded `worstCaseProduct` that still equals `budget` on a deep chain means
 * the guard actively capped something (see the per-node `dctl-*-reduced`/
 * `dctl-blur-kernel-truncated` fidelity reasons for which node).
 */
export type LookDctlTapBudgetSummary = {
	readonly budget: number;
	readonly worstCaseProduct: number;
};

/** Full per-node fidelity list plus document-level notes (e.g. the always-present colorspace assumption) and the tap-budget guard's summary. */
export type LookDctlReport = {
	readonly nodes: readonly LookDctlFidelity[];
	readonly notes: readonly string[];
	readonly tapBudget: LookDctlTapBudgetSummary;
};

/**
 * Context passed to a per-node-kind emitter. `upstreamCall` is the fully
 * formed call expression for this node's upstream closure function (e.g.
 * `"lk_node_2(p_TexR, p_TexG, p_TexB, p_Width, p_Height, uv)"`) — pointwise
 * emitters call it once and transform the returned `float3`. `upstreamFnName`
 * is the bare function name backing `upstreamCall`; uv-remap emitters (which
 * must sample upstream at a modified `uv2`) and gather emitters (which sample
 * upstream at several offset coordinates) build their own call expressions
 * from it via {@link import("./chain").chainCallAt} instead of using
 * `upstreamCall` verbatim. `nodeIndex` is this node's position in the
 * compiled topo order, used to mint globally unique UI-param variable names
 * when a graph has more than one node of the same kind. `tapBudget` (S3) is
 * the maximum number of upstream taps this node may spend without pushing
 * the chain's worst-case tap product over {@link import("./tap-budget").DCTL_TAP_BUDGET}
 * — pointwise/uv-remap emitters (one upstream tap) can ignore it; gather
 * emitters must size their kernel/grid to at most this many taps and report
 * `approx` when that means shrinking below their natural/ideal tap count.
 * `exposeAllParams` (S5) is the "expose all numeric parameters" export
 * option: when `true`, emitters should route their otherwise-baked numeric
 * payload fields through {@link import("./params").exposableNumber} instead
 * of a plain `dctlFloat`/`dctlInt` literal, promoting them to additional
 * `DEFINE_UI_PARAMS` sliders (hero params are unaffected — they are already
 * always sliders). Not every baked field is eligible: fields that select a
 * codegen-time branch/helper (e.g. `waveType`, `matrixSize`), size a
 * compile-time loop bound (e.g. `octaves`), or feed a multi-step baked
 * derivation this slice chose not to move to a runtime formula (documented
 * per emitter) stay baked regardless of this flag.
 */
export type LookDctlChainContext = {
	readonly builder: DctlSourceBuilder;
	readonly fnName: string;
	readonly upstreamCall: string;
	readonly upstreamFnName: string;
	readonly nodeIndex: number;
	readonly tapBudget: number;
	readonly exposeAllParams: boolean;
};

/**
 * One fully-formed closure function definition plus this node's fidelity
 * entry. `tapCount` (S3) is how many times this node's function calls its
 * upstream closure — `1` for every pointwise/uv-remap emitter, and the
 * actual (possibly budget-reduced) tap count for a gather emitter; `lower.ts`
 * multiplies it against the upstream chain's accumulated tap product to
 * derive this node's own product, both to size the *next* node's
 * `tapBudget` and to compute the report's overall `tapBudget.worstCaseProduct`.
 */
export type LookDctlEmitResult = {
	readonly source: string;
	readonly fidelity: LookDctlFidelity;
	readonly tapCount: number;
};

/**
 * Per-node-kind DCTL emitter. S1 only registers pointwise emitters (transform
 * the upstream color, ignore geometry) but the signature is generic so later
 * slices can add uv-remap/gather emitters without a contract change.
 */
export type LookDctlEmitter = (
	node: LookGraphNode,
	ctx: LookDctlChainContext,
) => LookDctlEmitResult;
