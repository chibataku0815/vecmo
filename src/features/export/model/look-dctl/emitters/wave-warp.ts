import { dctlFloat } from "@/shared/dctl";
import { CHAIN_SIGNATURE_PARAMS, chainCallAt } from "../chain";
import {
	DCTL_HELPER_FRACT,
	DCTL_HELPER_SMOOTHSTEP,
	DCTL_HELPER_STEP,
} from "../helpers";
import { exposableNumber } from "../params";
import type { LookDctlEmitter } from "../types";

/** Matches `MIN_WAVE_WARP_HEIGHT` / `MAX_WAVE_WARP_HEIGHT` in `entities/scene/model/look-graph.ts`. */
const MIN_HEIGHT = 0;
const MAX_HEIGHT = 2000;
const TAU = Math.PI * 2;
const DEGREES_TO_RADIANS = Math.PI / 180;

const clampRange = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));

/**
 * Wave Warp: exact uv-remap port of `FRAGMENT_SHADER_WAVE_WARP`'s travelling
 * transverse ripple (`shared/gpu-lens/surface.ts`), including the edge
 * pin/taper band and the `sine`/`semicircle` profile — reproduced with
 * `p_Width`/`p_Height` standing in for the shader's `uResolution`, matching
 * the plan's aspect-correctness requirement for pixel-space nodes.
 * `height`/`phase` are the hero UI params; `width`/`direction`/`waveType`
 * bake as constants (`waveType` selects which profile expression is emitted,
 * no runtime branch).
 */
export const emitWaveWarp: LookDctlEmitter = (node, ctx) => {
	if (node.payload.kind !== "wave-warp") {
		throw new Error(
			`emitWaveWarp called with mismatched payload kind "${node.payload.kind}".`,
		);
	}
	ctx.builder.addHelper(DCTL_HELPER_SMOOTHSTEP);
	const { waveType, height, width, direction, phase } = node.payload;
	const heightVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_wave_warp_height_${ctx.nodeIndex}`,
		label: "Wave Warp Height",
		default: clampRange(height, MIN_HEIGHT, MAX_HEIGHT),
		min: MIN_HEIGHT,
		max: MAX_HEIGHT,
		step: 1,
	});
	const phaseVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_wave_warp_phase_${ctx.nodeIndex}`,
		label: "Wave Warp Phase",
		default: clampRange(phase, 0, 4),
		min: 0,
		max: 4,
		step: 0.01,
	});
	const waveExpr =
		waveType === "semicircle"
			? [
					"\tfloat wavePos = lk_fract(wavePhase);",
					"\tfloat waveSecond = lk_step(0.5, wavePos);",
					"\tfloat waveCentre = _mix(0.25, 0.75, waveSecond);",
					"\tfloat waveQ = (wavePos - waveCentre) * 4.0;",
					"\tfloat wave = _mix(1.0, -1.0, waveSecond) * _sqrtf(_fmaxf(0.0, 1.0 - waveQ * waveQ));",
				]
			: [`\tfloat wave = _sinf(${dctlFloat(TAU)} * wavePhase);`];
	if (waveType === "semicircle") {
		ctx.builder.addHelper(DCTL_HELPER_STEP);
		ctx.builder.addHelper(DCTL_HELPER_FRACT);
	}
	const directionExpr = exposableNumber(ctx, {
		key: "wave-warp.direction",
		label: "Wave Warp Direction",
		value: direction,
		min: 0,
		max: 360,
		step: 1,
	});
	const widthExpr = exposableNumber(ctx, {
		key: "wave-warp.width",
		label: "Wave Warp Width",
		value: width,
		min: 1,
		max: 4000,
		step: 1,
	});

	const source = [
		`__DEVICE__ float3 ${ctx.fnName}(${CHAIN_SIGNATURE_PARAMS}) {`,
		"\tfloat2 resolution = make_float2(_fmaxf(float(p_Width), 1.0), _fmaxf(float(p_Height), 1.0));",
		`\tfloat angleRadians = ${directionExpr} * ${dctlFloat(DEGREES_TO_RADIANS)};`,
		"\tfloat2 dir = make_float2(_cosf(angleRadians), _sinf(angleRadians));",
		"\tfloat2 perp = make_float2(-dir.y, dir.x);",
		`\tfloat waveScale = _fmaxf(${widthExpr}, 1.0);`,
		`\tfloat wavePhase = (uv.x * resolution.x * dir.x + uv.y * resolution.y * dir.y) / waveScale + ${phaseVar};`,
		...waveExpr,
		"\tfloat2 edge = make_float2(_fminf(uv.x, 1.0 - uv.x) * resolution.x, _fminf(uv.y, 1.0 - uv.y) * resolution.y);",
		`\tfloat band = _fmaxf(_fabs(${heightVar}), waveScale * 0.5);`,
		"\tfloat pin = _fminf(lk_smoothstep(0.0, band, edge.x), lk_smoothstep(0.0, band, edge.y));",
		`\tfloat2 offset = make_float2(perp.x * wave * ${heightVar} * pin / resolution.x, perp.y * wave * ${heightVar} * pin / resolution.y);`,
		"\tfloat2 uv2 = make_float2(_clamp(uv.x + offset.x, 0.0, 1.0), _clamp(uv.y + offset.y, 0.0, 1.0));",
		`\treturn ${chainCallAt(ctx.upstreamFnName, "uv2")};`,
		"}",
	].join("\n");
	return {
		source,
		tapCount: 1,
		fidelity: { nodeId: node.id, kind: "wave-warp", status: "exact" },
	};
};
