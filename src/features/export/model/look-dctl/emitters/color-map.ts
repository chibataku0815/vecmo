import { dctlFloat3FromHex } from "@/shared/dctl";
import { CHAIN_SIGNATURE_PARAMS } from "../chain";
import { DCTL_HELPER_LUMA709, DCTL_HELPER_MIX3 } from "../helpers";
import type { LookDctlEmitter } from "../types";

/**
 * Color Map: exact port of `colorMapPrimitives`'s luminance gradient-map math
 * — Rec. 709 luminance piecewise-linearly interpolated across the 2 or 3
 * authored stops, then blended over the source by `mix` (the hero UI param).
 * `shadow`/`midtone`/`highlight` bake as `make_float3` constants, matching
 * the "hex colors parsed at codegen time" contract.
 */
export const emitColorMap: LookDctlEmitter = (node, ctx) => {
	if (node.payload.kind !== "color-map") {
		throw new Error(
			`emitColorMap called with mismatched payload kind "${node.payload.kind}".`,
		);
	}
	ctx.builder.addHelper(DCTL_HELPER_LUMA709);
	ctx.builder.addHelper(DCTL_HELPER_MIX3);
	const { shadow, midtone, highlight, mix } = node.payload;
	const mixVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_color_map_mix_${ctx.nodeIndex}`,
		label: "Color Map Mix",
		default: Math.min(1, Math.max(0, mix)),
		min: 0,
		max: 1,
		step: 0.01,
	});
	const rampLines: string[] =
		midtone === null
			? ["\tfloat3 mapped = lk_mix3(shadow, highlight, luma);"]
			: [
					`\tfloat3 midtone = ${dctlFloat3FromHex(midtone)};`,
					"\tfloat3 mapped;",
					"\tif (luma < 0.5) {",
					"\t\tmapped = lk_mix3(shadow, midtone, luma * 2.0);",
					"\t} else {",
					"\t\tmapped = lk_mix3(midtone, highlight, (luma - 0.5) * 2.0);",
					"\t}",
				];
	const source = [
		`__DEVICE__ float3 ${ctx.fnName}(${CHAIN_SIGNATURE_PARAMS}) {`,
		`\tfloat3 src = ${ctx.upstreamCall};`,
		"\tfloat luma = lk_luma709(src);",
		`\tfloat3 shadow = ${dctlFloat3FromHex(shadow)};`,
		`\tfloat3 highlight = ${dctlFloat3FromHex(highlight)};`,
		...rampLines,
		`\treturn lk_mix3(src, mapped, _clamp(${mixVar}, 0.0, 1.0));`,
		"}",
	].join("\n");
	return {
		source,
		tapCount: 1,
		fidelity: { nodeId: node.id, kind: "color-map", status: "exact" },
	};
};
