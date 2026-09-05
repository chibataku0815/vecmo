import { CHAIN_SIGNATURE_PARAMS, chainCallAt } from "../chain";
import { DCTL_HELPER_LENGTH2 } from "../helpers";
import { exposableNumber } from "../params";
import type { LookDctlEmitter } from "../types";

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * Lens: exact uv-remap port of `FRAGMENT_SHADER_LENS`'s spherical-magnify
 * math (`shared/gpu-lens/surface.ts`) — aspect-corrected (via `p_Width`/
 * `p_Height`, matching the shader's `uAspect = canvas.width / canvas.height`)
 * so the lens stays circular on non-square frames. `convergence` is the hero
 * UI param; `size`/`centerX`/`centerY` bake as constants.
 *
 * `clipToRim`'s hard cutout (replacing everything outside the lens radius
 * with the artboard background, anti-aliased) is NOT reproduced: DCTL's
 * `transform()` returns opaque `float3` only, with no alpha channel and no
 * artboard-background input to composite against. When authored, the lens
 * instead passes the source through beyond its radius (same as
 * `clipToRim: false`) and the node is reported `approx` for that gap; the
 * magnify math itself stays byte-faithful either way.
 */
export const emitLens: LookDctlEmitter = (node, ctx) => {
	if (node.payload.kind !== "lens") {
		throw new Error(
			`emitLens called with mismatched payload kind "${node.payload.kind}".`,
		);
	}
	ctx.builder.addHelper(DCTL_HELPER_LENGTH2);
	const { size, convergence, centerX, centerY, clipToRim } = node.payload;
	const convergenceVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_lens_convergence_${ctx.nodeIndex}`,
		label: "Lens Convergence",
		default: clamp01(convergence),
		min: 0,
		max: 1,
		step: 0.01,
	});
	const centerXExpr = exposableNumber(ctx, {
		key: "lens.centerX",
		label: "Lens Center X",
		value: centerX,
		min: 0,
		max: 1,
		step: 0.01,
	});
	const centerYExpr = exposableNumber(ctx, {
		key: "lens.centerY",
		label: "Lens Center Y",
		value: centerY,
		min: 0,
		max: 1,
		step: 0.01,
	});
	const sizeExpr = exposableNumber(ctx, {
		key: "lens.size",
		label: "Lens Size",
		value: size,
		min: 0,
		max: 1,
		step: 0.01,
	});
	const source = [
		`__DEVICE__ float3 ${ctx.fnName}(${CHAIN_SIGNATURE_PARAMS}) {`,
		"\tfloat aspect = float(p_Width) / _fmaxf(float(p_Height), 1.0);",
		`\tfloat2 center = make_float2(${centerXExpr}, ${centerYExpr});`,
		"\tfloat2 d = make_float2(uv.x - center.x, uv.y - center.y);",
		"\tfloat2 da = make_float2(d.x * aspect, d.y);",
		`\tfloat radius = _fmaxf(${sizeExpr}, 0.0001);`,
		"\tfloat r = lk_length2(da) / radius;",
		"\tfloat2 uv2 = uv;",
		"\tif (r < 1.0) {",
		"\t\tfloat z = _sqrtf(_fmaxf(0.0, 1.0 - r * r));",
		`\t\tfloat k = _mix(1.0, z, ${convergenceVar});`,
		"\t\tfloat2 srcA = make_float2(da.x * k, da.y * k);",
		"\t\tuv2 = make_float2(center.x + srcA.x / aspect, center.y + srcA.y);",
		"\t}",
		`\treturn ${chainCallAt(ctx.upstreamFnName, "uv2")};`,
		"}",
	].join("\n");
	return {
		source,
		tapCount: 1,
		fidelity: clipToRim
			? {
					nodeId: node.id,
					kind: "lens",
					status: "approx",
					reason:
						"dctl-lens-cliptorim-unsupported: DCTL's transform() has no alpha output or artboard-background input to composite the rim cutout, so Clip To Rim is not applied — the lens passes the source through beyond its radius instead of hard-cutting to the background.",
				}
			: { nodeId: node.id, kind: "lens", status: "exact" },
	};
};
