import type { CrtDisplayMaskType } from "@/entities/scene/model/look-graph";
import { dctlFloat } from "@/shared/dctl";
import { CHAIN_SIGNATURE_PARAMS, chainCallAt } from "../chain";
import {
	DCTL_HELPER_GL_MOD,
	DCTL_HELPER_LENGTH2,
	DCTL_HELPER_MIX3,
	DCTL_HELPER_MUL3,
	DCTL_HELPER_SMOOTHSTEP,
} from "../helpers";
import { exposableNumber } from "../params";
import type { LookDctlEmitter } from "../types";

/** Matches the shader constants in `FRAGMENT_SHADER_CRT_DISPLAY` (`shared/gpu-lens/surface.ts`). */
const CURVATURE_MAX = 0.4;
const VIGNETTE_INNER = 0.2;
const VIGNETTE_OUTER = 0.75;
/** Matches `MIN_CRT_DISPLAY_MASK_SCALE`/`MAX_CRT_DISPLAY_MASK_SCALE` in `entities/scene/model/look-graph.ts`. */
const MIN_MASK_SCALE = 1;
const MAX_MASK_SCALE = 24;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const clampRange = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));

const RGB_TINT_EXPR =
	"cellX < cell ? make_float3(1.0, 0.2, 0.2) : (cellX < cell * 2.0 ? make_float3(0.2, 1.0, 0.2) : make_float3(0.2, 0.2, 1.0))";

/**
 * The `tint`/`fall` computation for one `maskType` branch, given `cell` and
 * `px` already in scope — an exact port of `crtMaskTint`'s corresponding
 * `if`/`else if`/`else` branch in `FRAGMENT_SHADER_CRT_DISPLAY`. `maskType`
 * bakes as a codegen-time branch (only the selected pattern's math is
 * emitted, matching `wave-warp`'s `waveType` precedent) since DCTL export
 * has no live-switching requirement the editor's runtime `uMaskType` int
 * branch exists for.
 */
const maskTintLines = (maskType: CrtDisplayMaskType): readonly string[] => {
	switch (maskType) {
		case "slot":
			return [
				"\tfloat rowPair = _floorf(px.y / (cell * 2.0));",
				"\tfloat rowOffset = lk_gl_mod(rowPair, 2.0) * (cell * 1.5);",
				"\tfloat cellX = lk_gl_mod(px.x + rowOffset, cell * 3.0);",
				`\tfloat3 tint = ${RGB_TINT_EXPR};`,
				"\tfloat fall = 1.0;",
			];
		case "shadow":
			return [
				"\tfloat2 cellCoord = make_float2(_floorf(px.x / cell), _floorf(px.y / cell));",
				"\tfloat rowOffset = lk_gl_mod(cellCoord.y, 2.0) * 1.5;",
				"\tfloat cellX = lk_gl_mod(cellCoord.x + rowOffset, 3.0);",
				"\tfloat3 tint = cellX < 1.0 ? make_float3(1.0, 0.2, 0.2) : (cellX < 2.0 ? make_float3(0.2, 1.0, 0.2) : make_float3(0.2, 0.2, 1.0));",
				"\tfloat dotY = lk_gl_mod(px.y / cell, 1.0);",
				"\tfloat fall = 1.0 - lk_smoothstep(0.25, 0.85, _fabs(dotY - 0.5) * 2.0);",
			];
		default:
			return [
				"\tfloat cellX = lk_gl_mod(px.x, cell * 3.0);",
				`\tfloat3 tint = ${RGB_TINT_EXPR};`,
				"\tfloat fall = 1.0;",
			];
	}
};

/**
 * CRT Display: exact single-tap port of `FRAGMENT_SHADER_CRT_DISPLAY`
 * (`shared/gpu-lens/surface.ts`) — see that shader's doc comment for the
 * shared math. `maskStrength`/`curvature`/`mix` are the hero UI params;
 * `maskType`/`maskScale`/`cornerRadius`/`vignette` bake as constants
 * (`maskType` selects which mask-pattern branch is emitted at codegen time).
 * Every contribution (curvature, corner crop, mask, vignette) is pre-scaled
 * by `mix`, so `mix` 0 is an exact passthrough with no second "clean" tap.
 */
export const emitCrtDisplay: LookDctlEmitter = (node, ctx) => {
	if (node.payload.kind !== "crt-display") {
		throw new Error(
			`emitCrtDisplay called with mismatched payload kind "${node.payload.kind}".`,
		);
	}
	ctx.builder.addHelper(DCTL_HELPER_GL_MOD);
	ctx.builder.addHelper(DCTL_HELPER_SMOOTHSTEP);
	ctx.builder.addHelper(DCTL_HELPER_LENGTH2);
	ctx.builder.addHelper(DCTL_HELPER_MIX3);
	ctx.builder.addHelper(DCTL_HELPER_MUL3);
	const {
		maskType,
		maskScale,
		maskStrength,
		curvature,
		cornerRadius,
		vignette,
		mix,
	} = node.payload;
	const maskStrengthVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_crt_display_mask_strength_${ctx.nodeIndex}`,
		label: "CRT Mask Strength",
		default: clamp01(maskStrength),
		min: 0,
		max: 1,
		step: 0.01,
	});
	const curvatureVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_crt_display_curvature_${ctx.nodeIndex}`,
		label: "CRT Curvature",
		default: clamp01(curvature),
		min: 0,
		max: 1,
		step: 0.01,
	});
	const mixVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_crt_display_mix_${ctx.nodeIndex}`,
		label: "CRT Mix",
		default: clamp01(mix),
		min: 0,
		max: 1,
		step: 0.05,
	});
	const cellExpr = exposableNumber(ctx, {
		key: "crt-display.maskScale",
		label: "CRT Mask Scale",
		value: clampRange(maskScale, MIN_MASK_SCALE, MAX_MASK_SCALE),
		min: MIN_MASK_SCALE,
		max: MAX_MASK_SCALE,
		step: 1,
	});
	const cornerRadiusExpr = exposableNumber(ctx, {
		key: "crt-display.cornerRadius",
		label: "CRT Corner Radius",
		value: clamp01(cornerRadius),
		min: 0,
		max: 1,
		step: 0.01,
	});
	const vignetteExpr = exposableNumber(ctx, {
		key: "crt-display.vignette",
		label: "CRT Vignette",
		value: clamp01(vignette),
		min: 0,
		max: 1,
		step: 0.01,
	});

	const source = [
		`__DEVICE__ float3 ${ctx.fnName}(${CHAIN_SIGNATURE_PARAMS}) {`,
		"\tfloat2 resolution = make_float2(_fmaxf(float(p_Width), 1.0), _fmaxf(float(p_Height), 1.0));",
		`\tfloat mixAmount = _clamp(${mixVar}, 0.0, 1.0);`,
		"\tfloat2 cc = make_float2(uv.x * 2.0 - 1.0, uv.y * 2.0 - 1.0);",
		`\tfloat k = _clamp(${curvatureVar}, 0.0, 1.0) * ${dctlFloat(CURVATURE_MAX)} * mixAmount;`,
		"\tfloat2 warped = make_float2(cc.x * (1.0 + k * cc.y * cc.y), cc.y * (1.0 + k * cc.x * cc.x));",
		"\twarped = make_float2(warped.x * 0.5 + 0.5, warped.y * 0.5 + 0.5);",
		"",
		"\tfloat2 halfSize = make_float2(resolution.x * 0.5, resolution.y * 0.5);",
		"\tfloat2 pxCoord = make_float2((warped.x - 0.5) * resolution.x, (warped.y - 0.5) * resolution.y);",
		`\tfloat radiusPx = _clamp(${cornerRadiusExpr}, 0.0, 1.0) * mixAmount * _fminf(halfSize.x, halfSize.y);`,
		"\tfloat2 q = make_float2(_fabs(pxCoord.x) - (halfSize.x - radiusPx), _fabs(pxCoord.y) - (halfSize.y - radiusPx));",
		"\tfloat outsideLen = lk_length2(make_float2(_fmaxf(q.x, 0.0), _fmaxf(q.y, 0.0)));",
		"\tfloat insideMin = _fminf(_fmaxf(q.x, q.y), 0.0);",
		"\tfloat sdf = outsideLen + insideMin - radiusPx;",
		"\tbool outsideBounds = sdf > 0.0 || warped.x < 0.0 || warped.x > 1.0 || warped.y < 0.0 || warped.y > 1.0;",
		`\tfloat3 sampled = outsideBounds ? make_float3(0.0, 0.0, 0.0) : ${chainCallAt(ctx.upstreamFnName, "warped")};`,
		"",
		"\tfloat2 px = make_float2(uv.x * resolution.x, uv.y * resolution.y);",
		`\tfloat cell = ${cellExpr};`,
		...maskTintLines(maskType),
		`\tfloat3 maskTint = lk_mix3(make_float3(1.0, 1.0, 1.0), tint, _clamp(${maskStrengthVar}, 0.0, 1.0) * mixAmount * _mix(0.6, 1.0, fall));`,
		"\tfloat3 masked = lk_mul3(sampled, maskTint);",
		"",
		"\tfloat2 vd = make_float2(uv.x - 0.5, (uv.y - 0.5) * (resolution.y / resolution.x));",
		"\tfloat vignetteDist = lk_length2(vd);",
		`\tfloat vig = 1.0 - _clamp(${vignetteExpr}, 0.0, 1.0) * mixAmount * lk_smoothstep(${dctlFloat(VIGNETTE_INNER)}, ${dctlFloat(VIGNETTE_OUTER)}, vignetteDist);`,
		"",
		"\treturn make_float3(",
		"\t\t_clamp(masked.x * vig, 0.0, 1.0),",
		"\t\t_clamp(masked.y * vig, 0.0, 1.0),",
		"\t\t_clamp(masked.z * vig, 0.0, 1.0)",
		"\t);",
		"}",
	].join("\n");

	return {
		source,
		tapCount: 1,
		fidelity: { nodeId: node.id, kind: "crt-display", status: "exact" },
	};
};
