import { dctlFloat } from "@/shared/dctl";
import { CHAIN_SIGNATURE_PARAMS, chainCallAt } from "../chain";
import { DCTL_HELPER_LUMA709, DCTL_HELPER_MIX3 } from "../helpers";
import type { LookDctlEmitter } from "../types";

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** The 8 non-centre offsets of `FIND_EDGES_KERNEL`'s 3x3 Laplacian, all weight -1 (the centre's +8 is handled separately so it can reuse the `src` tap). */
const NEIGHBOR_OFFSETS: readonly {
	readonly dx: number;
	readonly dy: number;
}[] = [
	{ dx: -1, dy: -1 },
	{ dx: 0, dy: -1 },
	{ dx: 1, dy: -1 },
	{ dx: -1, dy: 0 },
	{ dx: 1, dy: 0 },
	{ dx: -1, dy: 1 },
	{ dx: 0, dy: 1 },
	{ dx: 1, dy: 1 },
];
const CENTER_WEIGHT = 8;
const NEIGHBOR_WEIGHT = -1;

/**
 * Find Edges: exact 9-tap gather port of `findEdgesPrimitives`'s Laplacian
 * edge detection (`entities/scene/model/effect-filter.ts`) — Rec. 709
 * luminance is collapsed and convolved with the same zero-sum 3x3 kernel
 * (`FIND_EDGES_KERNEL`) via 9 direct upstream taps (the centre tap doubles
 * as the `src` color the final `mix` blends against, so this stays a true
 * 9-tap gather rather than 10). `invert` flips the outline (dark-on-white
 * sketch vs bright-on-black); `mix` is the hero UI param.
 */
export const emitFindEdges: LookDctlEmitter = (node, ctx) => {
	if (node.payload.kind !== "find-edges") {
		throw new Error(
			`emitFindEdges called with mismatched payload kind "${node.payload.kind}".`,
		);
	}
	ctx.builder.addHelper(DCTL_HELPER_LUMA709);
	ctx.builder.addHelper(DCTL_HELPER_MIX3);
	const { invert, mix } = node.payload;
	const mixVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_find_edges_mix_${ctx.nodeIndex}`,
		label: "Find Edges Mix",
		default: clamp01(mix),
		min: 0,
		max: 1,
		step: 0.05,
	});

	const neighborLines = NEIGHBOR_OFFSETS.map(({ dx, dy }) => {
		const uvExpr = `make_float2(uv.x + ${dctlFloat(dx)} * texel.x, uv.y + ${dctlFloat(dy)} * texel.y)`;
		return `\tedge += ${dctlFloat(NEIGHBOR_WEIGHT)} * lk_luma709(${chainCallAt(ctx.upstreamFnName, uvExpr)});`;
	});

	const lines: string[] = [
		`__DEVICE__ float3 ${ctx.fnName}(${CHAIN_SIGNATURE_PARAMS}) {`,
		`\tfloat3 src = ${ctx.upstreamCall};`,
		"\tfloat2 texel = make_float2(1.0 / _fmaxf(float(p_Width), 1.0), 1.0 / _fmaxf(float(p_Height), 1.0));",
		`\tfloat edge = ${dctlFloat(CENTER_WEIGHT)} * lk_luma709(src);`,
		...neighborLines,
		"\tedge = _clamp(edge, 0.0, 1.0);",
	];
	if (invert) lines.push("\tedge = 1.0 - edge;");
	lines.push(
		"\tfloat3 outline = make_float3(edge, edge, edge);",
		`\treturn lk_mix3(src, outline, _clamp(${mixVar}, 0.0, 1.0));`,
		"}",
	);

	return {
		source: lines.join("\n"),
		tapCount: 1 + NEIGHBOR_OFFSETS.length,
		fidelity: { nodeId: node.id, kind: "find-edges", status: "exact" },
	};
};
