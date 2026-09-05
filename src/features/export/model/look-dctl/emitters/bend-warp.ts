import { CHAIN_SIGNATURE_PARAMS, chainCallAt } from "../chain";
import { exposableNumber } from "../params";
import type { LookDctlEmitter } from "../types";

const clampRange = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));

/**
 * Bend Warp: uv-remap port of `FRAGMENT_SHADER_BEND_WARP`'s arc bend +
 * horizontal/vertical shear (`shared/gpu-lens/surface.ts`). `bend` is the
 * hero UI param; `distortionH`/`distortionV`/`scale` bake as constants by
 * default and become additional sliders when the export's "expose all
 * numeric parameters" option is on (see `exposableNumber`).
 *
 * The shader reveals empty (fully transparent) space wherever the remapped
 * source lands outside `[0, 1]` on either axis, composited over the artboard
 * background by the surface's caller. DCTL's `transform()` returns opaque
 * `float3` only — no alpha, no background input — so this emitter renders
 * black there instead of clamping to the edge (a hard clamp would smear the
 * boundary row/column outward, which is visually wrong in the opposite
 * direction from the shader's intent); reported `approx` for that gap, since
 * the bend/shear remap itself is otherwise an exact port.
 */
export const emitBendWarp: LookDctlEmitter = (node, ctx) => {
	if (node.payload.kind !== "bend-warp") {
		throw new Error(
			`emitBendWarp called with mismatched payload kind "${node.payload.kind}".`,
		);
	}
	const { bend, distortionH, distortionV, scale } = node.payload;
	const bendVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_bend_warp_bend_${ctx.nodeIndex}`,
		label: "Bend Warp Bend",
		default: clampRange(bend, -1, 1),
		min: -1,
		max: 1,
		step: 0.01,
	});
	const scaleExpr = exposableNumber(ctx, {
		key: "bend-warp.scale",
		label: "Bend Warp Scale",
		value: scale,
		min: 0.25,
		max: 4,
		step: 0.01,
	});
	const distortionHExpr = exposableNumber(ctx, {
		key: "bend-warp.distortionH",
		label: "Bend Warp Distortion H",
		value: distortionH,
		min: -1,
		max: 1,
		step: 0.01,
	});
	const distortionVExpr = exposableNumber(ctx, {
		key: "bend-warp.distortionV",
		label: "Bend Warp Distortion V",
		value: distortionV,
		min: -1,
		max: 1,
		step: 0.01,
	});
	const source = [
		`__DEVICE__ float3 ${ctx.fnName}(${CHAIN_SIGNATURE_PARAMS}) {`,
		`\tfloat zoomScale = _fmaxf(${scaleExpr}, 0.25);`,
		"\tfloat2 ivz = make_float2(0.5 + (uv.x - 0.5) / zoomScale, 0.5 + (uv.y - 0.5) / zoomScale);",
		`\tfloat arc = ${bendVar} * 0.4 * 4.0 * ivz.x * (1.0 - ivz.x);`,
		"\tfloat2 uv2 = make_float2(",
		`\t\tivz.x + ${distortionHExpr} * 0.5 * (ivz.y - 0.5),`,
		`\t\tivz.y - arc + ${distortionVExpr} * 0.5 * (ivz.x - 0.5)`,
		"\t);",
		"\tif (uv2.x < 0.0 || uv2.x > 1.0 || uv2.y < 0.0 || uv2.y > 1.0) {",
		"\t\treturn make_float3(0.0, 0.0, 0.0);",
		"\t}",
		`\treturn ${chainCallAt(ctx.upstreamFnName, "uv2")};`,
		"}",
	].join("\n");
	return {
		source,
		tapCount: 1,
		fidelity: {
			nodeId: node.id,
			kind: "bend-warp",
			status: "approx",
			reason:
				"dctl-bend-warp-alpha-unavailable: DCTL's transform() returns opaque RGB only, so pixels the bend/shear remap pushes outside the source rect render black instead of transparent/artboard-composited.",
		},
	};
};
