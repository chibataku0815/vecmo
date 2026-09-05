import { dctlFloat } from "@/shared/dctl";
import { CHAIN_SIGNATURE_PARAMS, chainCallAt } from "../chain";
import { DCTL_HELPER_LENGTH2 } from "../helpers";
import { exposableNumber } from "../params";
import type { LookDctlEmitter } from "../types";

/** Bipolar strength UI range, matching the payload's own `-1..1`. */
const STRENGTH_RANGE = 1;
/**
 * Displacement gain tuning constants (approximated, not ported — `warp` has
 * no GLSL reference; `warpPrimitives`' SVG-tier math is an image-space
 * quadratic displacement map at a different unit scale — `MAX_WARP_DISPLACEMENT`
 * geometry-local px vs. this emitter's aspect-corrected normalized uv — so
 * there is no faithful byte-for-byte port target). Chosen so `strength: ±1`
 * at a frame corner produces a clearly visible but non-destructive bulge/
 * swirl, the same "standard" visual weight `lens`/`flow` use.
 */
const RADIAL_GAIN = 0.9;
const TWIRL_GAIN = 0.8;
const TWIRL_REACH = 0.7;

const clampRange = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));

/**
 * Warp: aspect-corrected uv-remap standing in for `warpPrimitives`' SVG-tier
 * displacement-map bulge/pinch (`mode: "radial"`) and swirl (`mode: "twirl"`)
 * — there is no GLSL reference to port (`warp` is SVG-only, never GPU-raster;
 * see `isGpuRasterKind`), so this is a closed-form "standard" reproduction of
 * the same two field shapes rather than an exact port: `radial` scales the
 * aspect-corrected offset from centre by its own (quadratic) distance,
 * `twirl` rotates tangentially with a falloff fading to zero by
 * `TWIRL_REACH`, mirroring `warpMapDataUrl`'s two field shapes qualitatively.
 * `strength` is the hero UI param; `mode`/`centerX`/`centerY` bake as
 * constants (`mode` selects which branch is emitted, no runtime switch).
 */
export const emitWarp: LookDctlEmitter = (node, ctx) => {
	if (node.payload.kind !== "warp") {
		throw new Error(
			`emitWarp called with mismatched payload kind "${node.payload.kind}".`,
		);
	}
	ctx.builder.addHelper(DCTL_HELPER_LENGTH2);
	const { mode, strength, centerX, centerY } = node.payload;
	const strengthVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_warp_strength_${ctx.nodeIndex}`,
		label: "Warp Strength",
		default: clampRange(strength, -STRENGTH_RANGE, STRENGTH_RANGE),
		min: -STRENGTH_RANGE,
		max: STRENGTH_RANGE,
		step: 0.02,
	});
	const centerXExpr = exposableNumber(ctx, {
		key: "warp.centerX",
		label: "Warp Center X",
		value: centerX,
		min: 0,
		max: 1,
		step: 0.01,
	});
	const centerYExpr = exposableNumber(ctx, {
		key: "warp.centerY",
		label: "Warp Center Y",
		value: centerY,
		min: 0,
		max: 1,
		step: 0.01,
	});
	const lines: string[] = [
		`__DEVICE__ float3 ${ctx.fnName}(${CHAIN_SIGNATURE_PARAMS}) {`,
		"\tfloat aspect = float(p_Width) / _fmaxf(float(p_Height), 1.0);",
		`\tfloat2 center = make_float2(${centerXExpr}, ${centerYExpr});`,
		"\tfloat2 d = make_float2((uv.x - center.x) * aspect, uv.y - center.y);",
	];
	if (mode === "twirl") {
		lines.push(
			"\tfloat dist = lk_length2(d);",
			`\tfloat falloff = _clamp(1.0 - dist / ${dctlFloat(TWIRL_REACH)}, 0.0, 1.0);`,
			"\tfloat2 tangent = make_float2(-d.y, d.x);",
			`\tfloat k = ${strengthVar} * ${dctlFloat(TWIRL_GAIN)} * falloff;`,
			"\tfloat2 offset = make_float2(tangent.x * k, tangent.y * k);",
			"\tfloat2 uv2 = make_float2(uv.x + offset.x / aspect, uv.y + offset.y);",
		);
	} else {
		lines.push(
			"\tfloat dist = lk_length2(d);",
			`\tfloat k = ${strengthVar} * ${dctlFloat(RADIAL_GAIN)} * dist;`,
			"\tfloat2 offset = make_float2(d.x * k, d.y * k);",
			"\tfloat2 uv2 = make_float2(uv.x + offset.x / aspect, uv.y + offset.y);",
		);
	}
	lines.push(`\treturn ${chainCallAt(ctx.upstreamFnName, "uv2")};`, "}");
	return {
		source: lines.join("\n"),
		tapCount: 1,
		fidelity: {
			nodeId: node.id,
			kind: "warp",
			status: "approx",
			reason:
				"dctl-warp-uv-approximated: warp has no GLSL reference (SVG-tier only); this reproduces the radial-bulge/twirl field shapes with a closed-form aspect-corrected uv remap rather than a byte-for-byte port of the SVG's image-space quadratic displacement map.",
		},
	};
};
