import { CHAIN_SIGNATURE_PARAMS, chainCallAt } from "../chain";
import type { LookDctlEmitter } from "../types";

/** Matches the payload's own `amount` range in `entities/scene/model/look-graph.ts` (`unit: "scene-px"`). */
const MIN_AMOUNT = 0;
const MAX_AMOUNT = 10;

const clampRange = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));

/**
 * RGB Fringe: exact 3-tap gather port of `chromaticFringePrimitives`'s
 * channel-offset chromatic aberration (`entities/scene/model/effect-filter.ts`).
 * The SVG chain isolates R/G/B, shifts the isolated R channel by `+amount/2`
 * and B by `-amount/2` (an `feOffset`, i.e. `result(p) = channel(p - shift)`),
 * then recombines with `screen` blends; algebraically that recombination
 * reduces to exactly "R sampled `amount/2` one way, G unshifted, B sampled
 * `amount/2` the other way" (each channel isolation zeroes the other two, so
 * `screen`'s `1-(1-a)(1-b)` always resolves to whichever operand is
 * non-zero) — this emitter samples the upstream function three times at
 * those offsets and recombines their channels directly, with the same
 * result. `amount` (authored in `scene-px`, the same geometry-local/pixel
 * space `p_Width`/`p_Height` are assumed to match) is the hero UI param.
 */
export const emitChromaticFringe: LookDctlEmitter = (node, ctx) => {
	if (node.payload.kind !== "chromatic-fringe") {
		throw new Error(
			`emitChromaticFringe called with mismatched payload kind "${node.payload.kind}".`,
		);
	}
	const { amount } = node.payload;
	const amountVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_chromatic_fringe_amount_${ctx.nodeIndex}`,
		label: "RGB Fringe Amount",
		default: clampRange(amount, MIN_AMOUNT, MAX_AMOUNT),
		min: MIN_AMOUNT,
		max: MAX_AMOUNT,
		step: 0.1,
	});
	const source = [
		`__DEVICE__ float3 ${ctx.fnName}(${CHAIN_SIGNATURE_PARAMS}) {`,
		`\tfloat shiftUv = (${amountVar} * 0.5) / _fmaxf(float(p_Width), 1.0);`,
		"\tfloat2 uvR = make_float2(uv.x - shiftUv, uv.y);",
		"\tfloat2 uvB = make_float2(uv.x + shiftUv, uv.y);",
		`\tfloat3 sampleR = ${chainCallAt(ctx.upstreamFnName, "uvR")};`,
		`\tfloat3 sampleG = ${ctx.upstreamCall};`,
		`\tfloat3 sampleB = ${chainCallAt(ctx.upstreamFnName, "uvB")};`,
		"\treturn make_float3(sampleR.x, sampleG.y, sampleB.z);",
		"}",
	].join("\n");
	return {
		source,
		tapCount: 3,
		fidelity: { nodeId: node.id, kind: "chromatic-fringe", status: "exact" },
	};
};
