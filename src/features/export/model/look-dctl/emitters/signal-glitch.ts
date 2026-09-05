import { NOISE_SOURCE_EVOLVE_PER_FRAME } from "@/entities/scene/model/look-graph";
import { dctlFloat } from "@/shared/dctl";
import { CHAIN_SIGNATURE_PARAMS, chainCallAt } from "../chain";
import {
	DCTL_HELPER_FRACT,
	DCTL_HELPER_HASH3,
	DCTL_HELPER_STEP,
} from "../helpers";
import { exposableNumber } from "../params";
import type { LookDctlEmitter } from "../types";

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const clampRange = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));

/** Matches the shader constant in `FRAGMENT_SHADER_SIGNAL_GLITCH` (`shared/gpu-lens/surface.ts`). */
const ROLL_DRIFT_RATE = 0.35;
/** Matches `MIN_SIGNAL_GLITCH_CHANNEL_SHIFT`/`MAX_SIGNAL_GLITCH_CHANNEL_SHIFT` in `entities/scene/model/look-graph.ts`. */
const MIN_CHANNEL_SHIFT = 0;
const MAX_CHANNEL_SHIFT = 32;
const MAX_TEAR_STRENGTH = 200;

/**
 * Signal Glitch: exact 3-tap gather port of `FRAGMENT_SHADER_SIGNAL_GLITCH`
 * (`shared/gpu-lens/surface.ts`) — see that shader's doc comment for the
 * shared math. `channelShift`/`tearStrength`/`mix` are the hero UI params;
 * `rollAmount`/`tearDensity`/`speed`/`seed` bake as constants. Time is driven
 * from `TIMELINE_FRAME_INDEX`, the same convention `vhs-tracking`/`vhs-noise`
 * use (see those emitters' doc comments for why this differs from the
 * editor GLSL path's pre-folded `evolution`).
 */
export const emitSignalGlitch: LookDctlEmitter = (node, ctx) => {
	if (node.payload.kind !== "signal-glitch") {
		throw new Error(
			`emitSignalGlitch called with mismatched payload kind "${node.payload.kind}".`,
		);
	}
	ctx.builder.addHelper(DCTL_HELPER_FRACT);
	ctx.builder.addHelper(DCTL_HELPER_HASH3);
	ctx.builder.addHelper(DCTL_HELPER_STEP);
	const {
		channelShift,
		rollAmount,
		tearDensity,
		tearStrength,
		speed,
		seed,
		mix,
	} = node.payload;
	const channelShiftVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_signal_glitch_channel_shift_${ctx.nodeIndex}`,
		label: "Signal Glitch Channel Shift",
		default: clampRange(channelShift, MIN_CHANNEL_SHIFT, MAX_CHANNEL_SHIFT),
		min: MIN_CHANNEL_SHIFT,
		max: MAX_CHANNEL_SHIFT,
		step: 0.5,
	});
	const tearStrengthVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_signal_glitch_tear_strength_${ctx.nodeIndex}`,
		label: "Signal Glitch Tear Strength",
		default: clampRange(tearStrength, 0, MAX_TEAR_STRENGTH),
		min: 0,
		max: MAX_TEAR_STRENGTH,
		step: 1,
	});
	const mixVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_signal_glitch_mix_${ctx.nodeIndex}`,
		label: "Signal Glitch Mix",
		default: clamp01(mix),
		min: 0,
		max: 1,
		step: 0.05,
	});

	const rollAmountExpr = exposableNumber(ctx, {
		key: "signal-glitch.rollAmount",
		label: "Signal Glitch Roll Amount",
		value: rollAmount,
		min: 0,
		max: 1,
		step: 0.01,
	});
	const tearDensityExpr = exposableNumber(ctx, {
		key: "signal-glitch.tearDensity",
		label: "Signal Glitch Tear Density",
		value: clamp01(tearDensity),
		min: 0,
		max: 1,
		step: 0.01,
	});
	const speedExpr = exposableNumber(ctx, {
		key: "signal-glitch.speed",
		label: "Signal Glitch Speed",
		value: speed,
		min: 0,
		max: 10,
		step: 0.1,
	});
	const seedExpr = exposableNumber(ctx, {
		key: "signal-glitch.seed",
		label: "Signal Glitch Seed",
		value: seed,
		min: 0,
		max: 64,
		step: 1,
	});
	const source = [
		`__DEVICE__ float3 ${ctx.fnName}(${CHAIN_SIGNATURE_PARAMS}) {`,
		"\tfloat2 resolution = make_float2(_fmaxf(float(p_Width), 1.0), _fmaxf(float(p_Height), 1.0));",
		`\tfloat time = float(TIMELINE_FRAME_INDEX) * ${speedExpr} * ${dctlFloat(NOISE_SOURCE_EVOLVE_PER_FRAME)};`,
		`\tfloat mixAmount = _clamp(${mixVar}, 0.0, 1.0);`,
		`\tfloat seedConst = ${seedExpr};`,
		"",
		`\tfloat rollPhase = lk_fract(${rollAmountExpr} + time * ${dctlFloat(ROLL_DRIFT_RATE)}) * mixAmount;`,
		"",
		"\tfloat row = _floorf(uv.y * resolution.y);",
		"\tfloat tearHash = lk_hash3(make_float3(row, seedConst, time));",
		`\tfloat isTear = lk_step(1.0 - _clamp(${tearDensityExpr}, 0.0, 1.0), tearHash);`,
		"\tfloat tearOffsetHash = lk_hash3(make_float3(row, seedConst + 7.0, time)) * 2.0 - 1.0;",
		`\tfloat tearPx = isTear * tearOffsetHash * ${tearStrengthVar} * mixAmount;`,
		"",
		"\tfloat srcX = lk_fract(uv.x + tearPx / resolution.x);",
		"\tfloat srcY = lk_fract(uv.y + rollPhase);",
		"",
		`\tfloat shiftUv = (${channelShiftVar} * 0.5 * mixAmount) / resolution.x;`,
		`\tfloat3 sampleR = ${chainCallAt(ctx.upstreamFnName, "make_float2(lk_fract(srcX - shiftUv), srcY)")};`,
		`\tfloat3 sampleG = ${chainCallAt(ctx.upstreamFnName, "make_float2(srcX, srcY)")};`,
		`\tfloat3 sampleB = ${chainCallAt(ctx.upstreamFnName, "make_float2(lk_fract(srcX + shiftUv), srcY)")};`,
		"\treturn make_float3(sampleR.x, sampleG.y, sampleB.z);",
		"}",
	].join("\n");

	return {
		source,
		tapCount: 3,
		fidelity: { nodeId: node.id, kind: "signal-glitch", status: "exact" },
	};
};
