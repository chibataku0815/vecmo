import { dctlFloat } from "@/shared/dctl";
import { CHAIN_SIGNATURE_PARAMS, chainCallAt } from "../chain";
import {
	DCTL_HELPER_FRACT,
	DCTL_HELPER_GL_MOD,
	DCTL_HELPER_STEP,
} from "../helpers";
import { exposableNumber } from "../params";
import type { LookDctlEmitter } from "../types";

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const clampRange = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));

/** Matches the shader constants in `FRAGMENT_SHADER_INTERLACE` (`shared/gpu-lens/surface.ts`). */
const COMB_DARKEN_MAX = 0.6;
const FLICKER_RANGE = 0.15;
/** Matches `MAX_INTERLACE_FIELD_OFFSET` in `entities/scene/model/look-graph.ts`. */
const MAX_FIELD_OFFSET = 40;

/**
 * Interlace: exact single-tap port of `FRAGMENT_SHADER_INTERLACE`
 * (`shared/gpu-lens/surface.ts`) — see that shader's doc comment for the
 * shared math. `strength`/`mix` are the hero UI params; `fieldOffset`/
 * `flicker`/`speed` bake as constants. Unlike the GLSL preview (which
 * recovers `frameCount = evolution / EVOLVE_PER_FRAME` from the pre-folded
 * `evolution` uniform, since this leaf `shared/gpu-lens` module cannot
 * import `NOISE_SOURCE_EVOLVE_PER_FRAME`), this emitter computes
 * `frameCount = TIMELINE_FRAME_INDEX * speed` directly — algebraically the
 * same quantity, without the per-frame-increment round-trip.
 */
export const emitInterlace: LookDctlEmitter = (node, ctx) => {
	if (node.payload.kind !== "interlace") {
		throw new Error(
			`emitInterlace called with mismatched payload kind "${node.payload.kind}".`,
		);
	}
	ctx.builder.addHelper(DCTL_HELPER_FRACT);
	ctx.builder.addHelper(DCTL_HELPER_GL_MOD);
	ctx.builder.addHelper(DCTL_HELPER_STEP);
	const { strength, fieldOffset, flicker, speed, mix } = node.payload;
	const strengthVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_interlace_strength_${ctx.nodeIndex}`,
		label: "Interlace Strength",
		default: clamp01(strength),
		min: 0,
		max: 1,
		step: 0.01,
	});
	const mixVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_interlace_mix_${ctx.nodeIndex}`,
		label: "Interlace Mix",
		default: clamp01(mix),
		min: 0,
		max: 1,
		step: 0.05,
	});
	const fieldOffsetExpr = exposableNumber(ctx, {
		key: "interlace.fieldOffset",
		label: "Interlace Field Offset",
		value: clampRange(fieldOffset, 0, MAX_FIELD_OFFSET),
		min: 0,
		max: MAX_FIELD_OFFSET,
		step: 0.5,
	});
	const flickerExpr = exposableNumber(ctx, {
		key: "interlace.flicker",
		label: "Interlace Flicker",
		value: clamp01(flicker),
		min: 0,
		max: 1,
		step: 0.01,
	});
	const speedExpr = exposableNumber(ctx, {
		key: "interlace.speed",
		label: "Interlace Speed",
		value: speed,
		min: 0,
		max: 10,
		step: 0.1,
	});

	const source = [
		`__DEVICE__ float3 ${ctx.fnName}(${CHAIN_SIGNATURE_PARAMS}) {`,
		"\tfloat2 resolution = make_float2(_fmaxf(float(p_Width), 1.0), _fmaxf(float(p_Height), 1.0));",
		`\tfloat mixAmount = _clamp(${mixVar}, 0.0, 1.0);`,
		`\tfloat frameCount = float(TIMELINE_FRAME_INDEX) * ${speedExpr};`,
		"\tfloat fieldParity = lk_gl_mod(_floorf(frameCount), 2.0);",
		"",
		"\tfloat row = _floorf(uv.y * resolution.y);",
		"\tfloat rowParity = lk_gl_mod(row, 2.0);",
		"\tfloat isOffField = lk_step(0.5, _fabs(rowParity - fieldParity));",
		"",
		`\tfloat srcX = lk_fract(uv.x + _clamp(${fieldOffsetExpr}, 0.0, ${dctlFloat(MAX_FIELD_OFFSET)}) * isOffField * mixAmount / resolution.x);`,
		`\tfloat3 sampled = ${chainCallAt(ctx.upstreamFnName, "make_float2(srcX, uv.y)")};`,
		"",
		`\tfloat dim = 1.0 - _clamp(${strengthVar}, 0.0, 1.0) * isOffField * mixAmount * ${dctlFloat(COMB_DARKEN_MAX)};`,
		`\tfloat flick = 1.0 + (fieldParity * 2.0 - 1.0) * _clamp(${flickerExpr}, 0.0, 1.0) * mixAmount * ${dctlFloat(FLICKER_RANGE)};`,
		"",
		"\treturn make_float3(",
		"\t\t_clamp(sampled.x * dim * flick, 0.0, 1.0),",
		"\t\t_clamp(sampled.y * dim * flick, 0.0, 1.0),",
		"\t\t_clamp(sampled.z * dim * flick, 0.0, 1.0)",
		"\t);",
		"}",
	].join("\n");

	return {
		source,
		tapCount: 1,
		fidelity: { nodeId: node.id, kind: "interlace", status: "exact" },
	};
};
