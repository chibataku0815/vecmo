import { dctlFloat } from "@/shared/dctl";
import { CHAIN_SIGNATURE_PARAMS, chainCallAt } from "../chain";
import { buildGaussianBlurKernel } from "../tap-budget";
import type { LookDctlEmitter } from "../types";

/** Matches the payload's `radius`/`radiusY` catalog bounds in `entities/scene/model/look-graph.ts`. */
const MIN_RADIUS = 0;
const MAX_RADIUS = 80;
/** Matches `BLUR_SIGMA_DIVISOR` in `entities/scene/model/effect-filter.ts` — radius (px) -> sigma. */
const BLUR_SIGMA_DIVISOR = 2;
/** Floor for the runtime radius/authored-radius scale ratio, so an authored 0 radius never divides by zero. */
const MIN_NORMALIZER = 0.0001;

const clampRange = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));

/**
 * Blur: a Gaussian blur has no exact single-pass DCTL form (a real
 * `feGaussianBlur` is separable across two full-resolution passes, which the
 * one-input/one-pass `transform()` contract cannot express) — this emitter
 * instead bakes a fixed 2D kernel via {@link buildGaussianBlurKernel}, an
 * axis-aligned product-of-1D-Gaussians kernel truncated at the standard
 * ±3-sigma reach (matching `REGION_SIGMA_REACH` in
 * `entities/scene/model/effect-filter.ts`'s SVG blur-reach estimate) and
 * capped by the S3 tap-budget guard. `radius` is the hero UI param; because
 * the kernel's tap positions and weights are baked at export time (DCTL loop
 * bounds — and here, kernel shape — must be compile-time constants), the
 * live slider cannot resize or reweight the kernel at runtime — instead it
 * scales every baked tap's offset distance by `radiusVar / authoredRadius`,
 * so the slider dilates/contracts the same fixed tap pattern uniformly
 * across both axes (preserving the authored radius/radiusY anisotropy
 * ratio) rather than changing its shape. `radiusY` bakes as a constant
 * (only `radius` is hero, matching every other multi-field node's
 * one-hero-param convention).
 */
export const emitBlur: LookDctlEmitter = (node, ctx) => {
	if (node.payload.kind !== "blur") {
		throw new Error(
			`emitBlur called with mismatched payload kind "${node.payload.kind}".`,
		);
	}
	const { radius, radiusY } = node.payload;
	const rx = Math.max(radius, 0);
	const ry = Math.max(radiusY ?? radius, 0);
	const sigmaX = rx / BLUR_SIGMA_DIVISOR;
	const sigmaY = ry / BLUR_SIGMA_DIVISOR;
	const kernel = buildGaussianBlurKernel(sigmaX, sigmaY, ctx.tapBudget);
	const normalizer = Math.max(rx, ry, MIN_NORMALIZER);
	const radiusVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_blur_radius_${ctx.nodeIndex}`,
		label: "Blur Radius",
		default: clampRange(radius, MIN_RADIUS, MAX_RADIUS),
		min: MIN_RADIUS,
		max: MAX_RADIUS,
		step: 1,
	});

	const tapLines = kernel.taps.flatMap((tap) => {
		const uvExpr =
			tap.dx === 0 && tap.dy === 0
				? "uv"
				: `make_float2(uv.x + ${dctlFloat(tap.dx)} * texel.x * radiusScale, uv.y + ${dctlFloat(tap.dy)} * texel.y * radiusScale)`;
		return [
			"\t{",
			`\t\tfloat3 tap = ${chainCallAt(ctx.upstreamFnName, uvExpr)};`,
			`\t\taccumR += ${dctlFloat(tap.weight)} * tap.x;`,
			`\t\taccumG += ${dctlFloat(tap.weight)} * tap.y;`,
			`\t\taccumB += ${dctlFloat(tap.weight)} * tap.z;`,
			"\t}",
		];
	});

	const source = [
		`__DEVICE__ float3 ${ctx.fnName}(${CHAIN_SIGNATURE_PARAMS}) {`,
		`\tfloat radiusScale = ${radiusVar} / ${dctlFloat(normalizer)};`,
		"\tfloat2 texel = make_float2(1.0 / _fmaxf(float(p_Width), 1.0), 1.0 / _fmaxf(float(p_Height), 1.0));",
		"\tfloat accumR = 0.0;",
		"\tfloat accumG = 0.0;",
		"\tfloat accumB = 0.0;",
		...tapLines,
		"\treturn make_float3(accumR, accumG, accumB);",
		"}",
	].join("\n");

	return {
		source,
		tapCount: kernel.taps.length,
		fidelity: kernel.reduced
			? {
					nodeId: node.id,
					kind: "blur",
					status: "approx",
					reason:
						"dctl-blur-kernel-truncated: the tap-budget guard capped this blur's baked kernel below the size its authored radius/radiusY would otherwise use (this node's position in the fusion chain — downstream gather nodes already multiplying the tap count — left less than the full 3-sigma kernel's worth of budget), so its falloff is softer/coarser than an isolated blur of the same radius.",
				}
			: { nodeId: node.id, kind: "blur", status: "exact" },
	};
};
