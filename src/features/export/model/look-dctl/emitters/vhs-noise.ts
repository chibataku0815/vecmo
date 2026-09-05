import { NOISE_SOURCE_EVOLVE_PER_FRAME } from "@/entities/scene/model/look-graph";
import { dctlFloat } from "@/shared/dctl";
import { CHAIN_SIGNATURE_PARAMS, chainCallAt } from "../chain";
import {
	DCTL_HELPER_ADD3,
	DCTL_HELPER_FRACT,
	DCTL_HELPER_HASH3,
	DCTL_HELPER_MIX3,
	DCTL_HELPER_SCALE3,
	DCTL_HELPER_STEP,
} from "../helpers";
import { exposableNumber } from "../params";
import type { LookDctlEmitter } from "../types";

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const clampRange = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));

/** Matches the shader constants in `FRAGMENT_SHADER_VHS_NOISE` (`shared/gpu-lens/surface.ts`). */
const SOFTEN_MAX_PX = 2;
const DESAT_MAX = 0.6;
const CRUSH_MAX = 0.3;
const SNOW_STRENGTH = 0.5;
const DROPOUT_MAX_PROB = 0.08;
const DROPOUT_COLOR = 0.92;
/** Matches `MIN_VHS_NOISE_DROPOUT_LENGTH`/`MAX_VHS_NOISE_DROPOUT_LENGTH` in `entities/scene/model/look-graph.ts`. */
const MIN_DROPOUT_LENGTH = 1;
const MAX_DROPOUT_LENGTH = 200;
const MIN_GENERATION = 1;
const MAX_GENERATION = 5;

/**
 * VHS Noise: exact port of `FRAGMENT_SHADER_VHS_NOISE`
 * (`shared/gpu-lens/surface.ts`) — see that shader's doc comment for the
 * shared math. Mostly pointwise + hash noise; `generation`'s softness is the
 * one gather part (a fixed plus-shaped 5-tap box average, so this is a true
 * 5-tap gather rather than pointwise, matching the shader). `snow`/
 * `dropout`/`mix` are the hero UI params; `dropoutLength`/`generation`/
 * `speed`/`seed` bake as constants. Time is driven from
 * `TIMELINE_FRAME_INDEX`, same convention as `vhs-tracking` (see that
 * emitter's doc comment for why this differs from the editor GLSL path's
 * pre-folded `evolution`).
 */
export const emitVhsNoise: LookDctlEmitter = (node, ctx) => {
	if (node.payload.kind !== "vhs-noise") {
		throw new Error(
			`emitVhsNoise called with mismatched payload kind "${node.payload.kind}".`,
		);
	}
	ctx.builder.addHelper(DCTL_HELPER_FRACT);
	ctx.builder.addHelper(DCTL_HELPER_HASH3);
	ctx.builder.addHelper(DCTL_HELPER_ADD3);
	ctx.builder.addHelper(DCTL_HELPER_SCALE3);
	ctx.builder.addHelper(DCTL_HELPER_MIX3);
	ctx.builder.addHelper(DCTL_HELPER_STEP);
	const { snow, dropout, dropoutLength, generation, speed, seed, mix } =
		node.payload;
	const snowVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_vhs_noise_snow_${ctx.nodeIndex}`,
		label: "VHS Noise Snow",
		default: clamp01(snow),
		min: 0,
		max: 1,
		step: 0.01,
	});
	const dropoutVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_vhs_noise_dropout_${ctx.nodeIndex}`,
		label: "VHS Noise Dropout",
		default: clamp01(dropout),
		min: 0,
		max: 1,
		step: 0.01,
	});
	const mixVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_vhs_noise_mix_${ctx.nodeIndex}`,
		label: "VHS Noise Mix",
		default: clamp01(mix),
		min: 0,
		max: 1,
		step: 0.05,
	});
	const generationExpr = exposableNumber(ctx, {
		key: "vhs-noise.generation",
		label: "VHS Noise Generation",
		value: clampRange(generation, MIN_GENERATION, MAX_GENERATION),
		min: MIN_GENERATION,
		max: MAX_GENERATION,
		step: 1,
	});
	const dropoutLengthExpr = exposableNumber(ctx, {
		key: "vhs-noise.dropoutLength",
		label: "VHS Noise Dropout Length",
		value: Math.max(
			1,
			clampRange(dropoutLength, MIN_DROPOUT_LENGTH, MAX_DROPOUT_LENGTH),
		),
		min: MIN_DROPOUT_LENGTH,
		max: MAX_DROPOUT_LENGTH,
		step: 1,
	});
	const speedExpr = exposableNumber(ctx, {
		key: "vhs-noise.speed",
		label: "VHS Noise Speed",
		value: speed,
		min: 0,
		max: 10,
		step: 0.1,
	});
	const seedExpr = exposableNumber(ctx, {
		key: "vhs-noise.seed",
		label: "VHS Noise Seed",
		value: seed,
		min: 0,
		max: 64,
		step: 1,
	});

	const source = [
		`__DEVICE__ float3 ${ctx.fnName}(${CHAIN_SIGNATURE_PARAMS}) {`,
		"\tfloat2 texel = make_float2(1.0 / _fmaxf(float(p_Width), 1.0), 1.0 / _fmaxf(float(p_Height), 1.0));",
		`\tfloat time = float(TIMELINE_FRAME_INDEX) * ${speedExpr} * ${dctlFloat(NOISE_SOURCE_EVOLVE_PER_FRAME)};`,
		`\tfloat seedConst = ${seedExpr};`,
		// Runtime formula (not a JS-baked scalar): `genT` normalizes `generation`
		// (1..5) to 0..1 so an exposed slider changes the soften/desat/crush
		// amounts live in Resolve, matching `generation`'s baked-value formula.
		`\tfloat genT = _clamp((${generationExpr} - 1.0) / 4.0, 0.0, 1.0);`,
		`\tfloat softPx = genT * ${dctlFloat(SOFTEN_MAX_PX)};`,
		`\tfloat3 centerRgb = ${ctx.upstreamCall};`,
		"\tfloat3 blurSum = centerRgb;",
		`\tblurSum = lk_add3(blurSum, ${chainCallAt(ctx.upstreamFnName, "make_float2(uv.x + texel.x * softPx, uv.y)")});`,
		`\tblurSum = lk_add3(blurSum, ${chainCallAt(ctx.upstreamFnName, "make_float2(uv.x - texel.x * softPx, uv.y)")});`,
		`\tblurSum = lk_add3(blurSum, ${chainCallAt(ctx.upstreamFnName, "make_float2(uv.x, uv.y + texel.y * softPx)")});`,
		`\tblurSum = lk_add3(blurSum, ${chainCallAt(ctx.upstreamFnName, "make_float2(uv.x, uv.y - texel.y * softPx)")});`,
		"\tfloat3 softened = lk_scale3(blurSum, 1.0 / 5.0);",
		"",
		"\tfloat luma = softened.x * 0.299 + softened.y * 0.587 + softened.z * 0.114;",
		`\tfloat3 desat = lk_mix3(softened, make_float3(luma, luma, luma), genT * ${dctlFloat(DESAT_MAX)});`,
		`\tfloat3 crushed = lk_mix3(desat, make_float3(0.5, 0.5, 0.5), genT * ${dctlFloat(CRUSH_MAX)});`,
		"",
		"\tfloat snowNoise = lk_hash3(make_float3(uv.x * float(p_Width), uv.y * float(p_Height), time + seedConst)) * 2.0 - 1.0;",
		`\tfloat snowDelta = snowNoise * ${snowVar} * ${dctlFloat(SNOW_STRENGTH)};`,
		"\tfloat3 snowed = make_float3(",
		"\t\t_clamp(crushed.x + snowDelta, 0.0, 1.0),",
		"\t\t_clamp(crushed.y + snowDelta, 0.0, 1.0),",
		"\t\t_clamp(crushed.z + snowDelta, 0.0, 1.0)",
		"\t);",
		"",
		`\tfloat segmentIndex = _floorf(uv.x * float(p_Width) / _fmaxf(1.0, ${dropoutLengthExpr}));`,
		"\tfloat rowIndex = _floorf(uv.y * float(p_Height));",
		"\tfloat dropoutHash = lk_hash3(make_float3(segmentIndex, rowIndex, time + seedConst * 1.37));",
		`\tfloat isDropout = lk_step(dropoutHash, ${dropoutVar} * ${dctlFloat(DROPOUT_MAX_PROB)});`,
		`\tfloat3 dropped = lk_mix3(snowed, make_float3(${dctlFloat(DROPOUT_COLOR)}, ${dctlFloat(DROPOUT_COLOR)}, ${dctlFloat(DROPOUT_COLOR)}), isDropout);`,
		"",
		`\treturn lk_mix3(centerRgb, dropped, _clamp(${mixVar}, 0.0, 1.0));`,
		"}",
	].join("\n");

	return {
		source,
		tapCount: 5,
		fidelity: { nodeId: node.id, kind: "vhs-noise", status: "exact" },
	};
};
