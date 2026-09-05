import { dctlFloat } from "@/shared/dctl";
import { CHAIN_SIGNATURE_PARAMS, chainCallAt } from "../chain";
import {
	DCTL_HELPER_MIX3,
	DCTL_HELPER_RGB2YUV601,
	DCTL_HELPER_YUV2RGB601,
} from "../helpers";
import { exposableNumber } from "../params";
import type { LookDctlEmitter } from "../types";

/** Matches `MIN_VHS_COLOR_BLEED`/`MAX_VHS_COLOR_BLEED` in `entities/scene/model/look-graph.ts`. */
const MIN_BLEED = 0;
const MAX_BLEED = 32;
/** Fixed chroma-lowpass tap count — the SAME fixed count `FRAGMENT_SHADER_VHS_COLOR` uses, so GLSL and DCTL run identical discrete math. */
const TAPS = 9;

const clampRange = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * VHS Color: exact 9-tap gather port of `FRAGMENT_SHADER_VHS_COLOR`
 * (`shared/gpu-lens/surface.ts`) — see that shader's doc comment for the
 * shared math. `bleed`/`mix` are the hero UI params; `subsample`/
 * `colorUnder` bake as constants. The chroma lowpass's tap COUNT is fixed at
 * export time (unrolled, matching `find-edges`'/`halftone`'s fixed-kernel
 * precedent), so the DCTL output does not soften further as `bleed` grows
 * past what 9 taps can resolve — same shape as the GLSL preview, which uses
 * the identical fixed tap count.
 */
export const emitVhsColor: LookDctlEmitter = (node, ctx) => {
	if (node.payload.kind !== "vhs-color") {
		throw new Error(
			`emitVhsColor called with mismatched payload kind "${node.payload.kind}".`,
		);
	}
	ctx.builder.addHelper(DCTL_HELPER_RGB2YUV601);
	ctx.builder.addHelper(DCTL_HELPER_YUV2RGB601);
	ctx.builder.addHelper(DCTL_HELPER_MIX3);
	const { bleed, subsample, colorUnder, mix } = node.payload;
	const bleedVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_vhs_color_bleed_${ctx.nodeIndex}`,
		label: "VHS Color Bleed",
		default: clampRange(bleed, MIN_BLEED, MAX_BLEED),
		min: MIN_BLEED,
		max: MAX_BLEED,
		step: 1,
	});
	const mixVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_vhs_color_mix_${ctx.nodeIndex}`,
		label: "VHS Color Mix",
		default: clamp01(mix),
		min: 0,
		max: 1,
		step: 0.05,
	});
	const subsampleExpr = exposableNumber(ctx, {
		key: "vhs-color.subsample",
		label: "VHS Color Subsample",
		value: Math.max(1, subsample),
		min: 1,
		max: 8,
		step: 1,
	});
	const colorUnderExpr = exposableNumber(ctx, {
		key: "vhs-color.colorUnder",
		label: "VHS Color Under",
		value: clamp01(colorUnder),
		min: 0,
		max: 1,
		step: 0.01,
	});

	const tapLines = Array.from({ length: TAPS }, (_, i) => {
		const t = i / (TAPS - 1) - 0.5;
		const tapExpr = `_clamp(quantizedX + ${dctlFloat(t * 2)} * ${bleedVar} * texel.x, 0.0, 1.0)`;
		const uvExpr = `make_float2(${tapExpr}, uv.y)`;
		return [
			"\t{",
			`\t\tfloat3 tapYuv = lk_rgb2yuv601(${chainCallAt(ctx.upstreamFnName, uvExpr)});`,
			"\t\tchromaSumU += tapYuv.y;",
			"\t\tchromaSumV += tapYuv.z;",
			"\t}",
		].join("\n");
	});

	const source = [
		`__DEVICE__ float3 ${ctx.fnName}(${CHAIN_SIGNATURE_PARAMS}) {`,
		`\tfloat3 centerRgb = ${ctx.upstreamCall};`,
		"\tfloat3 centerYuv = lk_rgb2yuv601(centerRgb);",
		"\tfloat2 texel = make_float2(1.0 / _fmaxf(float(p_Width), 1.0), 1.0 / _fmaxf(float(p_Height), 1.0));",
		"\tfloat pxX = uv.x * float(p_Width);",
		`\tfloat subsamplePx = _fmaxf(1.0, ${subsampleExpr});`,
		"\tfloat quantizedX = ((_floorf(pxX / subsamplePx) + 0.5) * subsamplePx) * texel.x;",
		"\tfloat chromaSumU = 0.0;",
		"\tfloat chromaSumV = 0.0;",
		...tapLines,
		`\tfloat2 chroma = make_float2(chromaSumU / ${dctlFloat(TAPS)}, chromaSumV / ${dctlFloat(TAPS)});`,
		`\tfloat levels = _mix(64.0, 6.0, _clamp(${colorUnderExpr}, 0.0, 1.0));`,
		"\tchroma = make_float2(_floorf(chroma.x * levels + 0.5) / levels, _floorf(chroma.y * levels + 0.5) / levels);",
		"\tfloat3 recombined = lk_yuv2rgb601(make_float3(centerYuv.x, chroma.x, chroma.y));",
		`\treturn lk_mix3(centerRgb, recombined, _clamp(${mixVar}, 0.0, 1.0));`,
		"}",
	].join("\n");

	return {
		source,
		tapCount: TAPS,
		fidelity: { nodeId: node.id, kind: "vhs-color", status: "exact" },
	};
};
