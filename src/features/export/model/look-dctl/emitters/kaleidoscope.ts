import { dctlFloat } from "@/shared/dctl";
import { CHAIN_SIGNATURE_PARAMS, chainCallAt } from "../chain";
import {
	DCTL_HELPER_FRACT,
	DCTL_HELPER_GL_MOD,
	DCTL_HELPER_LENGTH2,
} from "../helpers";
import { exposableNumber } from "../params";
import type { LookDctlEmitter } from "../types";

/** Matches `MIN_KALEIDOSCOPE_SEGMENTS` / `MAX_KALEIDOSCOPE_SEGMENTS` in `entities/scene/model/look-graph.ts`. */
const MIN_SEGMENTS = 2;
const MAX_SEGMENTS = 24;
/** Wider than the payload's own 0..1 "one turn" range so a Resolve keyframe can spin the roll across several turns, same reasoning as `colorama`'s phase slider. */
const ROLL_UI_RANGE = 4;
const TAU = Math.PI * 2;

/**
 * Kaleidoscope: exact uv-remap port of `FRAGMENT_SHADER_KALEIDOSCOPE`'s
 * wedge-fold math (`shared/gpu-lens/surface.ts`) — aspect-corrected so the
 * symmetry axes stay radial on non-square frames. `segments`/`roll` are the
 * hero UI params; `centerX`/`centerY` bake as constants.
 *
 * The GLSL shader relies on `REPEAT` texture wrapping for the folded radius,
 * which routinely overshoots `[0, 1]`; DCTL's closure chain bottoms out at
 * `lk_source`, which CLAMPS to the frame edge (there is no wrap mode to set
 * on a closure call). This emitter reproduces `REPEAT` exactly by wrapping
 * its own outgoing `uv2` into `[0, 1)` with `lk_fract` before calling
 * upstream, so the eventual `lk_source` clamp never triggers — the chain
 * tiles instead of smearing the edge, matching the shader.
 */
export const emitKaleidoscope: LookDctlEmitter = (node, ctx) => {
	if (node.payload.kind !== "kaleidoscope") {
		throw new Error(
			`emitKaleidoscope called with mismatched payload kind "${node.payload.kind}".`,
		);
	}
	ctx.builder.addHelper(DCTL_HELPER_LENGTH2);
	ctx.builder.addHelper(DCTL_HELPER_GL_MOD);
	ctx.builder.addHelper(DCTL_HELPER_FRACT);
	const { segments, centerX, centerY, roll } = node.payload;
	const segmentsVar = ctx.builder.declareUiParam({
		kind: "slider-int",
		varName: `p_kaleidoscope_segments_${ctx.nodeIndex}`,
		label: "Kaleidoscope Segments",
		default: Math.min(
			MAX_SEGMENTS,
			Math.max(MIN_SEGMENTS, Math.round(segments)),
		),
		min: MIN_SEGMENTS,
		max: MAX_SEGMENTS,
		step: 1,
	});
	const rollVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_kaleidoscope_roll_${ctx.nodeIndex}`,
		label: "Kaleidoscope Roll",
		default: Math.min(ROLL_UI_RANGE, Math.max(-ROLL_UI_RANGE, roll)),
		min: -ROLL_UI_RANGE,
		max: ROLL_UI_RANGE,
		step: 0.01,
	});
	const centerXExpr = exposableNumber(ctx, {
		key: "kaleidoscope.centerX",
		label: "Kaleidoscope Center X",
		value: centerX,
		min: 0,
		max: 1,
		step: 0.01,
	});
	const centerYExpr = exposableNumber(ctx, {
		key: "kaleidoscope.centerY",
		label: "Kaleidoscope Center Y",
		value: centerY,
		min: 0,
		max: 1,
		step: 0.01,
	});
	const source = [
		`__DEVICE__ float3 ${ctx.fnName}(${CHAIN_SIGNATURE_PARAMS}) {`,
		"\tfloat aspect = float(p_Width) / _fmaxf(float(p_Height), 1.0);",
		`\tfloat2 center = make_float2(${centerXExpr}, ${centerYExpr});`,
		"\tfloat2 da = make_float2((uv.x - center.x) * aspect, uv.y - center.y);",
		`\tfloat ang = _atan2f(da.y, da.x) + ${rollVar} * ${dctlFloat(TAU)};`,
		"\tfloat rad = lk_length2(da);",
		`\tfloat segCount = _fmaxf(float(${segmentsVar}), 1.0);`,
		`\tfloat seg = ${dctlFloat(TAU)} / segCount;`,
		"\tfloat a = lk_gl_mod(ang, seg);",
		"\ta = _fabs(a - seg * 0.5);",
		"\tfloat2 dir = make_float2(_cosf(a), _sinf(a));",
		"\tfloat2 src = make_float2(center.x + rad * dir.x / aspect, center.y + rad * dir.y);",
		"\tfloat2 uv2 = make_float2(lk_fract(src.x), lk_fract(src.y));",
		`\treturn ${chainCallAt(ctx.upstreamFnName, "uv2")};`,
		"}",
	].join("\n");
	return {
		source,
		tapCount: 1,
		fidelity: { nodeId: node.id, kind: "kaleidoscope", status: "exact" },
	};
};
