import { dctlFloat } from "@/shared/dctl";
import { CHAIN_SIGNATURE_PARAMS, chainCallAt } from "../chain";
import { DCTL_HELPER_HASH21, DCTL_HELPER_VALUE_NOISE21 } from "../helpers";
import { exposableNumber } from "../params";
import type { LookDctlEmitter } from "../types";

/** Matches `MIN_DISPLACE_OCTAVES` / `MAX_DISPLACE_OCTAVES` in `entities/scene/model/look-graph.ts`. */
const MIN_OCTAVES = 1;
const MAX_OCTAVES = 5;
/** Matches the payload's own `scale` range (`unit: "scene-px"`). */
const MIN_SCALE = 0;
const MAX_SCALE = 60;
/** Decorrelates the y-displacement fBm sample from the x one (same technique as `FRAGMENT_SHADER_FLOW`'s `curl` offsetting `p` before re-sampling). */
const Y_NOISE_OFFSET_X = 91.7;
const Y_NOISE_OFFSET_Y = 37.2;

const clampRange = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));

/**
 * Static Displace: uv-remap approximation of `displacePrimitives`'s
 * `feTurbulence`-driven `feDisplacementMap` (`entities/scene/model/effect-filter.ts`,
 * R→x/G→y channel offsets, peak reach `scale/2`). DCTL has no fractal-noise
 * primitive, so a deterministic 2D value-noise fBm (bilinear-interpolated
 * hash noise, {@link DCTL_HELPER_VALUE_NOISE21}) stands in for the Perlin-based
 * turbulence field — same substitution and `dctl-noise-approximated` reason
 * `scanline`'s emitter already documents. `frequency` (spatial frequency,
 * applied in `p_Width`/`p_Height` pixel space to mirror the SVG's user-space
 * `baseFrequency`) and `octaves` (baked as this node's fBm loop bound, since
 * DCTL loops need a compile-time-constant bound) bake as constants; `scale`
 * is the hero UI param.
 */
export const emitDisplace: LookDctlEmitter = (node, ctx) => {
	if (node.payload.kind !== "displace") {
		throw new Error(
			`emitDisplace called with mismatched payload kind "${node.payload.kind}".`,
		);
	}
	ctx.builder.addHelper(DCTL_HELPER_HASH21);
	ctx.builder.addHelper(DCTL_HELPER_VALUE_NOISE21);
	const { scale, frequency, octaves } = node.payload;
	const boundedOctaves = Math.min(
		MAX_OCTAVES,
		Math.max(MIN_OCTAVES, Math.round(octaves)),
	);
	const fbmFnName = `lk_displace_fbm_${ctx.nodeIndex}`;
	ctx.builder.addHelper({
		name: fbmFnName,
		source: [
			`__DEVICE__ float ${fbmFnName}(float2 p) {`,
			"\tfloat s = 0.0;",
			"\tfloat a = 0.5;",
			"\tfloat norm = 0.0;",
			`\tfor (int i = 0; i < ${boundedOctaves}; i++) {`,
			"\t\ts += a * lk_value_noise21(p);",
			"\t\tnorm += a;",
			"\t\tp = make_float2(p.x * 2.0, p.y * 2.0);",
			"\t\ta *= 0.5;",
			"\t}",
			"\treturn s / _fmaxf(norm, 0.0001);",
			"}",
		].join("\n"),
	});
	const scaleVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_displace_scale_${ctx.nodeIndex}`,
		label: "Displace Scale",
		default: clampRange(scale, MIN_SCALE, MAX_SCALE),
		min: MIN_SCALE,
		max: MAX_SCALE,
		step: 1,
	});
	const frequencyExpr = exposableNumber(ctx, {
		key: "displace.frequency",
		label: "Displace Frequency",
		value: frequency,
		min: 0.005,
		max: 0.2,
		step: 0.005,
	});
	const source = [
		`__DEVICE__ float3 ${ctx.fnName}(${CHAIN_SIGNATURE_PARAMS}) {`,
		`\tfloat freq = ${frequencyExpr};`,
		"\tfloat2 noiseP = make_float2(uv.x * float(p_Width) * freq, uv.y * float(p_Height) * freq);",
		`\tfloat nx = ${fbmFnName}(noiseP) - 0.5;`,
		`\tfloat ny = ${fbmFnName}(make_float2(noiseP.x + ${dctlFloat(Y_NOISE_OFFSET_X)}, noiseP.y + ${dctlFloat(Y_NOISE_OFFSET_Y)})) - 0.5;`,
		`\tfloat2 uv2 = make_float2(uv.x + nx * ${scaleVar} / _fmaxf(float(p_Width), 1.0), uv.y + ny * ${scaleVar} / _fmaxf(float(p_Height), 1.0));`,
		`\treturn ${chainCallAt(ctx.upstreamFnName, "uv2")};`,
		"}",
	].join("\n");
	return {
		source,
		tapCount: 1,
		fidelity: {
			nodeId: node.id,
			kind: "displace",
			status: "approx",
			reason:
				"dctl-noise-approximated: the source displacement field is fractal Perlin/simplex feTurbulence noise, which DCTL has no primitive for; a deterministic value-noise fBm stands in with a matching scale/octave shape, not identical grain.",
		},
	};
};
