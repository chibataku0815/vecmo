import { dctlFloat } from "@/shared/dctl";
import { CHAIN_SIGNATURE_PARAMS } from "../chain";
import { DCTL_HELPER_HASH21, DCTL_HELPER_SCALE3 } from "../helpers";
import { exposableNumber } from "../params";
import type { LookDctlEmitter } from "../types";

/** Matches `MIN_SCANLINE_DENSITY` / `MAX_SCANLINE_DENSITY` in `entities/scene/model/look-graph.ts`. */
const MIN_DENSITY = 4;
const MAX_DENSITY = 240;
/** Matches `SCANLINE_MIN_SLOPE` / `SCANLINE_MAX_SLOPE` in `entities/scene/model/effect-filter.ts`. */
const MIN_SLOPE = 2;
const MAX_SLOPE = 40;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * Scanline: `intensity`/`density` are the hero UI params; `softness` bakes as
 * a constant threshold slope/intercept (same linear-transfer shape as
 * `scanlinePrimitives`'s `thresholdFn`). The SVG/GPU original darkens bands
 * with a `feTurbulence`/Perlin field, which DCTL has no primitive for — this
 * emitter substitutes a deterministic sine band keyed to `uv.y` (approximating
 * the near-horizontal band structure, not the organic waver) and, when
 * `noiseMix` is authored, a position hash standing in for the static/flicker
 * layer. Reported `approx` for that reason.
 */
export const emitScanline: LookDctlEmitter = (node, ctx) => {
	if (node.payload.kind !== "scanline") {
		throw new Error(
			`emitScanline called with mismatched payload kind "${node.payload.kind}".`,
		);
	}
	ctx.builder.addHelper(DCTL_HELPER_SCALE3);
	const { density, intensity, softness, noiseMix } = node.payload;
	const intensityVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_scanline_intensity_${ctx.nodeIndex}`,
		label: "Scanline Intensity",
		default: clamp01(intensity),
		min: 0,
		max: 1,
		step: 0.01,
	});
	const densityVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_scanline_density_${ctx.nodeIndex}`,
		label: "Scanline Density",
		default: Math.min(MAX_DENSITY, Math.max(MIN_DENSITY, density)),
		min: MIN_DENSITY,
		max: MAX_DENSITY,
		step: 1,
	});
	const noiseMixClamped = clamp01(noiseMix);
	const softnessExpr = exposableNumber(ctx, {
		key: "scanline.softness",
		label: "Scanline Softness",
		value: softness,
		min: 0,
		max: 1,
		step: 0.01,
	});
	// Runtime formula (not a JS-baked scalar) so an exposed `softness` slider
	// actually changes the band shape live in Resolve: slope = MIN..MAX
	// inverse-lerped by softness, intercept keeps the mask centered.
	const lines: string[] = [
		`__DEVICE__ float3 ${ctx.fnName}(${CHAIN_SIGNATURE_PARAMS}) {`,
		`\tfloat3 src = ${ctx.upstreamCall};`,
		`\tfloat freqY = _fmaxf(${densityVar} / 100.0, 0.0001);`,
		"\tfloat bandPhase = uv.y * float(p_Height) * freqY * 6.28318530718;",
		"\tfloat field = _sinf(bandPhase) * 0.5 + 0.5;",
		`\tfloat slope = _mix(${dctlFloat(MAX_SLOPE)}, ${dctlFloat(MIN_SLOPE)}, _clamp(${softnessExpr}, 0.0, 1.0));`,
		"\tfloat intercept = 0.5 * (1.0 - slope);",
		"\tfloat mask = _clamp(field * slope + intercept, 0.0, 1.0);",
		`\tfloat darken = _clamp(mask * ${intensityVar} + (1.0 - ${intensityVar}), 0.0, 1.0);`,
		"\tfloat3 result = lk_scale3(src, darken);",
	];
	if (noiseMixClamped > 0 || ctx.exposeAllParams) {
		ctx.builder.addHelper(DCTL_HELPER_HASH21);
		const noiseMixExpr = exposableNumber(ctx, {
			key: "scanline.noiseMix",
			label: "Scanline Noise Mix",
			value: noiseMixClamped,
			min: 0,
			max: 1,
			step: 0.01,
		});
		lines.push(
			"\tfloat staticField = lk_hash21(make_float2(uv.x * float(p_Width), uv.y * float(p_Height)));",
			`\tfloat noiseMixAmount = _clamp(${noiseMixExpr}, 0.0, 1.0);`,
			"\tfloat noiseDarken = _clamp(staticField * noiseMixAmount + (1.0 - noiseMixAmount), 0.0, 1.0);",
			"\tresult = lk_scale3(result, noiseDarken);",
		);
	}
	lines.push("\treturn result;", "}");

	return {
		source: lines.join("\n"),
		tapCount: 1,
		fidelity: {
			nodeId: node.id,
			kind: "scanline",
			status: "approx",
			reason:
				"dctl-noise-approximated: the source scanline field is Perlin-based feTurbulence noise, which DCTL has no primitive for; the band pattern is reproduced with a deterministic sine band (plus a position hash for the static/flicker layer) instead.",
		},
	};
};
