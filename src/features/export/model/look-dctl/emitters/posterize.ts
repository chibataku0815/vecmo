import { CHAIN_SIGNATURE_PARAMS } from "../chain";
import { DCTL_HELPER_POSTERIZE_CHANNEL } from "../helpers";
import type { LookDctlEmitter } from "../types";

/** Matches `MIN_POSTERIZE_LEVELS` / `MAX_POSTERIZE_LEVELS` in `entities/scene/model/look-graph.ts`. */
const MIN_LEVELS = 2;
const MAX_LEVELS = 32;

/**
 * Posterize: exact port of `posterizePrimitives`'s discrete component-transfer
 * math (per-channel evenly-spaced tone bands). `levels` is the hero UI param.
 */
export const emitPosterize: LookDctlEmitter = (node, ctx) => {
	if (node.payload.kind !== "posterize") {
		throw new Error(
			`emitPosterize called with mismatched payload kind "${node.payload.kind}".`,
		);
	}
	ctx.builder.addHelper(DCTL_HELPER_POSTERIZE_CHANNEL);
	const levelsVar = ctx.builder.declareUiParam({
		kind: "slider-int",
		varName: `p_posterize_levels_${ctx.nodeIndex}`,
		label: "Posterize Levels",
		default: Math.min(
			MAX_LEVELS,
			Math.max(MIN_LEVELS, Math.round(node.payload.levels)),
		),
		min: MIN_LEVELS,
		max: MAX_LEVELS,
		step: 1,
	});
	const source = [
		`__DEVICE__ float3 ${ctx.fnName}(${CHAIN_SIGNATURE_PARAMS}) {`,
		`\tfloat3 src = ${ctx.upstreamCall};`,
		`\tfloat bands = float(${levelsVar});`,
		"\treturn make_float3(",
		"\t\tlk_posterize_channel(src.x, bands),",
		"\t\tlk_posterize_channel(src.y, bands),",
		"\t\tlk_posterize_channel(src.z, bands)",
		"\t);",
		"}",
	].join("\n");
	return {
		source,
		tapCount: 1,
		fidelity: { nodeId: node.id, kind: "posterize", status: "exact" },
	};
};
