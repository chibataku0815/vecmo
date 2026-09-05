import { NOISE_SOURCE_EVOLVE_PER_FRAME } from "@/entities/scene/model/look-graph";
import { dctlFloat } from "@/shared/dctl";
import { CHAIN_SIGNATURE_PARAMS, chainCallAt } from "../chain";
import {
	DCTL_HELPER_FRACT,
	DCTL_HELPER_HASH3,
	DCTL_HELPER_SMOOTHSTEP,
} from "../helpers";
import { exposableNumber } from "../params";
import type { LookDctlEmitter } from "../types";

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** Matches the shader constants in `FRAGMENT_SHADER_VHS_TRACKING` (`shared/gpu-lens/surface.ts`). */
const TAU = Math.PI * 2;
const JITTER_MAX_PX = 6;
const WOBBLE_MAX_PX = 10;
const WOBBLE_FREQ = 2;
const WOBBLE_RATE = 1.7;
const TEAR_BAND_HEIGHT = 0.08;
const TEAR_MAX_PX = 40;
const BAND_HALF_WIDTH = 0.035;
const BAND_MAX_PX = 18;
const BAND_NOISE_STRENGTH = 0.35;

/**
 * VHS Tracking: exact uv-remap + noise-overlay port of
 * `FRAGMENT_SHADER_VHS_TRACKING` (`shared/gpu-lens/surface.ts`) — see that
 * shader's doc comment for the shared math. `jitter`/`tear`/`mix` are the
 * hero UI params; `wobble`/`band`/`bandPosition`/`speed`/`seed` bake as
 * constants. Unlike the editor GLSL preview (which gets its per-frame
 * `evolution` pre-folded from `speed * frame` by
 * `presentation-stage-look-graph.ts`, since Resolve keyframes exported
 * params itself rather than this exporter — see the plan's non-goals), this
 * emitter drives time directly from Resolve's `TIMELINE_FRAME_INDEX` global
 * (Resolve 19.1+) times the baked `speed`, at the SAME per-frame rate
 * ({@link NOISE_SOURCE_EVOLVE_PER_FRAME}) the editor's auto-evolve pass
 * uses, so DCTL playback advances at the same visual rate as the editor.
 */
export const emitVhsTracking: LookDctlEmitter = (node, ctx) => {
	if (node.payload.kind !== "vhs-tracking") {
		throw new Error(
			`emitVhsTracking called with mismatched payload kind "${node.payload.kind}".`,
		);
	}
	ctx.builder.addHelper(DCTL_HELPER_FRACT);
	ctx.builder.addHelper(DCTL_HELPER_HASH3);
	ctx.builder.addHelper(DCTL_HELPER_SMOOTHSTEP);
	const { jitter, wobble, tear, band, bandPosition, speed, seed, mix } =
		node.payload;
	const jitterVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_vhs_tracking_jitter_${ctx.nodeIndex}`,
		label: "VHS Tracking Jitter",
		default: clamp01(jitter),
		min: 0,
		max: 1,
		step: 0.01,
	});
	const tearVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_vhs_tracking_tear_${ctx.nodeIndex}`,
		label: "VHS Tracking Tear",
		default: clamp01(tear),
		min: 0,
		max: 1,
		step: 0.01,
	});
	const mixVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_vhs_tracking_mix_${ctx.nodeIndex}`,
		label: "VHS Tracking Mix",
		default: clamp01(mix),
		min: 0,
		max: 1,
		step: 0.05,
	});

	const wobbleExpr = exposableNumber(ctx, {
		key: "vhs-tracking.wobble",
		label: "VHS Tracking Wobble",
		value: wobble,
		min: 0,
		max: 1,
		step: 0.01,
	});
	const bandExpr = exposableNumber(ctx, {
		key: "vhs-tracking.band",
		label: "VHS Tracking Band",
		value: band,
		min: 0,
		max: 1,
		step: 0.01,
	});
	const bandPositionExpr = exposableNumber(ctx, {
		key: "vhs-tracking.bandPosition",
		label: "VHS Tracking Band Position",
		value: bandPosition,
		min: 0,
		max: 1,
		step: 0.01,
	});
	const speedExpr = exposableNumber(ctx, {
		key: "vhs-tracking.speed",
		label: "VHS Tracking Speed",
		value: speed,
		min: 0,
		max: 10,
		step: 0.1,
	});
	const seedExpr = exposableNumber(ctx, {
		key: "vhs-tracking.seed",
		label: "VHS Tracking Seed",
		value: seed,
		min: 0,
		max: 64,
		step: 1,
	});
	const source = [
		`__DEVICE__ float3 ${ctx.fnName}(${CHAIN_SIGNATURE_PARAMS}) {`,
		"\tfloat row = _floorf(uv.y * float(p_Height));",
		`\tfloat time = float(TIMELINE_FRAME_INDEX) * ${speedExpr} * ${dctlFloat(NOISE_SOURCE_EVOLVE_PER_FRAME)};`,
		`\tfloat mixAmount = _clamp(${mixVar}, 0.0, 1.0);`,
		`\tfloat seedConst = ${seedExpr};`,
		"",
		"\tfloat jitterNoise = lk_hash3(make_float3(row, seedConst, time)) * 2.0 - 1.0;",
		`\tfloat jitterPx = jitterNoise * ${jitterVar} * ${dctlFloat(JITTER_MAX_PX)};`,
		"",
		`\tfloat wobblePx = _sinf(uv.y * ${dctlFloat(WOBBLE_FREQ)} * ${dctlFloat(TAU)} + time * ${dctlFloat(WOBBLE_RATE)} + seedConst) * ${wobbleExpr} * ${dctlFloat(WOBBLE_MAX_PX)};`,
		"",
		`\tfloat tearEnv = lk_smoothstep(${dctlFloat(1 - TEAR_BAND_HEIGHT)}, 1.0, uv.y);`,
		"\tfloat tearNoise = lk_hash3(make_float3(row, time, seedConst + 11.0)) * 2.0 - 1.0;",
		`\tfloat tearPx = tearNoise * tearEnv * ${tearVar} * ${dctlFloat(TEAR_MAX_PX)};`,
		"",
		`\tfloat bandWindow = 1.0 - lk_smoothstep(0.0, ${dctlFloat(BAND_HALF_WIDTH)}, _fabs(uv.y - ${bandPositionExpr}));`,
		"\tfloat bandNoise = lk_hash3(make_float3(row, time, seedConst + 23.0)) * 2.0 - 1.0;",
		`\tfloat bandPx = bandNoise * bandWindow * ${bandExpr} * ${dctlFloat(BAND_MAX_PX)};`,
		"",
		"\tfloat dxPx = (jitterPx + wobblePx + tearPx + bandPx) * mixAmount;",
		"\tfloat srcX = lk_fract(uv.x + dxPx / _fmaxf(float(p_Width), 1.0));",
		`\tfloat3 sampled = ${chainCallAt(ctx.upstreamFnName, "make_float2(srcX, uv.y)")};`,
		"",
		"\tfloat overlayNoise = lk_hash3(make_float3(uv.x * float(p_Width), row, time + seedConst)) * 2.0 - 1.0;",
		`\tfloat overlay = overlayNoise * bandWindow * ${bandExpr} * ${dctlFloat(BAND_NOISE_STRENGTH)} * mixAmount;`,
		"",
		"\treturn make_float3(",
		"\t\t_clamp(sampled.x + overlay, 0.0, 1.0),",
		"\t\t_clamp(sampled.y + overlay, 0.0, 1.0),",
		"\t\t_clamp(sampled.z + overlay, 0.0, 1.0)",
		"\t);",
		"}",
	].join("\n");

	return {
		source,
		tapCount: 1,
		fidelity: { nodeId: node.id, kind: "vhs-tracking", status: "exact" },
	};
};
