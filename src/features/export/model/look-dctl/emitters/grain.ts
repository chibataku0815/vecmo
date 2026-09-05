import { dctlFloat } from "@/shared/dctl";
import { legacyTextureGrainValue } from "@/shared/vec-core";
import { CHAIN_SIGNATURE_PARAMS } from "../chain";
import { DCTL_HELPER_HASH21 } from "../helpers";
import { exposableNumber } from "../params";
import type { LookDctlEmitter } from "../types";

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
/**
 * Visible-strength tuning constant: the SVG grain path's noise contributes to
 * a `feBlend`, not a flat additive offset, so `strength: 1` there does not
 * mean "the same numeric delta" here — this is chosen so `strength: 1`
 * produces a clearly visible but non-destructive speckle, the same
 * "standard visual weight" tuning precedent `warp`'s `RADIAL_GAIN` documents.
 */
const GRAIN_GAIN = 0.35;
/** Hash-noise sample frequency at `texture.grain.size = 1` (normalized "coarseness"), tuned for a fine-grain look at the default size. */
const BASE_NOISE_FREQUENCY = 0.6;

/**
 * Grain: pointwise approximation of `grainPrimitives`'s SVG film-grain
 * composite (`entities/scene/model/effect-filter.ts`) — that primitive is
 * fractal `feTurbulence` noise flattened to grayscale, faded by an optional
 * field ramp, clipped to the fill silhouette, and composited over the fill
 * via an arbitrary CSS/SVG blend mode; DCTL has no turbulence primitive, no
 * silhouette/alpha input, and (out of this slice's scope) no general blend-
 * mode library, so this substitutes a deterministic hash-noise speckle
 * (same substitution as `scanline`'s `dctl-noise-approximated`) added
 * directly to every channel (monochrome, matching the SVG's own
 * equal-weight-per-channel luma flatten) and skips the field-ramp/blend-mode
 * nuance entirely. `texture.grain.strength` (via {@link legacyTextureGrainValue},
 * the same legacy scalar read the SVG path uses) is the hero UI param —
 * "grain's primary intensity-like field" per the plan; `texture.grain.size`
 * bakes as the noise frequency.
 *
 * When `revealPaint` is authored, the SVG renderer draws it as an UNFILTERED
 * sibling layer beneath the node's own fill (see the payload's own doc
 * comment in `entities/scene/model/look-graph.ts`) — a second compositing
 * layer a single-input DCTL pass has no way to represent at all — so this
 * emitter reports the whole node `unsupported` and passes the source through
 * unchanged rather than rendering a grain speckle without its paired reveal.
 */
export const emitGrain: LookDctlEmitter = (node, ctx) => {
	if (node.payload.kind !== "grain") {
		throw new Error(
			`emitGrain called with mismatched payload kind "${node.payload.kind}".`,
		);
	}
	if (node.payload.revealPaint) {
		const source = [
			`__DEVICE__ float3 ${ctx.fnName}(${CHAIN_SIGNATURE_PARAMS}) {`,
			"\t// revealPaint is an unfiltered sibling underlay in the SVG/canvas renderers; a single-pass DCTL has no second compositing layer to hold it, so this node passes the source through unchanged.",
			`\treturn ${ctx.upstreamCall};`,
			"}",
		].join("\n");
		return {
			source,
			tapCount: 1,
			fidelity: {
				nodeId: node.id,
				kind: "grain",
				status: "unsupported",
				reason:
					"dctl-grain-reveal-unsupported: this grain node authors a revealPaint (a second sibling underlay color/gradient the SVG/canvas renderers draw beneath the fill), which a single-input DCTL pass has no way to composite as a separate layer, so the node is passed through unchanged.",
			},
		};
	}

	ctx.builder.addHelper(DCTL_HELPER_HASH21);
	const { texture } = node.payload;
	const strength = clamp01(legacyTextureGrainValue(texture));
	const strengthVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_grain_strength_${ctx.nodeIndex}`,
		label: "Grain Strength",
		default: strength,
		min: 0,
		max: 1,
		step: 0.01,
	});
	const sizeExpr = exposableNumber(ctx, {
		key: "grain.size",
		label: "Grain Size",
		value: clamp01(texture.grain.size),
		min: 0,
		max: 1,
		step: 0.01,
	});

	const source = [
		`__DEVICE__ float3 ${ctx.fnName}(${CHAIN_SIGNATURE_PARAMS}) {`,
		`\tfloat3 src = ${ctx.upstreamCall};`,
		`\tfloat noiseFrequency = ${dctlFloat(BASE_NOISE_FREQUENCY)} / _fmaxf(${sizeExpr}, 0.05);`,
		"\tfloat n = lk_hash21(make_float2(uv.x * float(p_Width) * noiseFrequency, uv.y * float(p_Height) * noiseFrequency));",
		`\tfloat delta = (n - 0.5) * ${strengthVar} * ${dctlFloat(GRAIN_GAIN)};`,
		"\treturn make_float3(",
		"\t\t_clamp(src.x + delta, 0.0, 1.0),",
		"\t\t_clamp(src.y + delta, 0.0, 1.0),",
		"\t\t_clamp(src.z + delta, 0.0, 1.0)",
		"\t);",
		"}",
	].join("\n");

	return {
		source,
		tapCount: 1,
		fidelity: {
			nodeId: node.id,
			kind: "grain",
			status: "approx",
			reason:
				"dctl-noise-approximated: the source grain field is fractal feTurbulence noise faded by an optional field ramp and composited via an arbitrary blend mode, none of which DCTL has a primitive for; a deterministic monochrome hash-noise speckle stands in, added directly to every channel.",
		},
	};
};
