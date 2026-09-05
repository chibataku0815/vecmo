import type { ColoramaStop } from "@/entities/scene/model/look-graph";
import { dctlFloat, dctlFloat3FromHex } from "@/shared/dctl";
import { CHAIN_SIGNATURE_PARAMS } from "../chain";
import {
	DCTL_HELPER_FRACT,
	DCTL_HELPER_LUMA709,
	DCTL_HELPER_MIX3,
} from "../helpers";
import { exposableNumber } from "../params";
import type { LookDctlEmitResult, LookDctlEmitter } from "../types";

/**
 * UI slider bounds for `phase` (authored value is unclamped "turns", `fract()`
 * makes any offset land correctly — the bound is display-range only).
 */
const PHASE_UI_RANGE = 4;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const clampRange = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));

/**
 * Builds the per-node ramp function, an exact unrolled port of
 * `FRAGMENT_SHADER_COLORAMA`'s `rampAt(t)` in `shared/gpu-lens/surface.ts`.
 * The GLSL version needs a runtime `for` loop bounded by a fixed capacity
 * (12) because a WebGL shader is compiled once and reused across edits; DCTL
 * is regenerated per export, so the authored stop count is a codegen-time
 * constant and the loop unrolls into `stops.length - 1` sequential `if`
 * blocks instead — DCTL loop bounds must be compile-time constants, and this
 * sidesteps the question entirely.
 */
const rampFunctionSource = (
	fnName: string,
	stops: readonly ColoramaStop[],
): string => {
	if (stops.length === 0) {
		return [
			`__DEVICE__ float3 ${fnName}(float t) {`,
			"\treturn make_float3(t, t, t);",
			"}",
		].join("\n");
	}
	const first = stops[0];
	if (!first) {
		throw new Error("unreachable: stops.length > 0 guarantees stops[0]");
	}
	if (stops.length === 1) {
		return [
			`__DEVICE__ float3 ${fnName}(float t) {`,
			`\treturn ${dctlFloat3FromHex(first.color)};`,
			"}",
		].join("\n");
	}
	const lines: string[] = [`__DEVICE__ float3 ${fnName}(float t) {`];
	lines.push(
		`\tfloat firstOffset = _clamp(${dctlFloat(first.offset)}, 0.0, 1.0);`,
	);
	lines.push(`\tfloat3 firstColor = ${dctlFloat3FromHex(first.color)};`);
	lines.push("\tfloat previousOffset = firstOffset;");
	lines.push("\tfloat3 previousColor = firstColor;");
	lines.push("\tbool resolved = false;");
	lines.push("\tfloat3 result = firstColor;");
	for (let index = 1; index < stops.length; index += 1) {
		const stop = stops[index];
		if (!stop) continue;
		lines.push("\t{");
		lines.push(
			`\t\tfloat offset = _clamp(${dctlFloat(stop.offset)}, 0.0, 1.0);`,
		);
		lines.push(`\t\tfloat3 color = ${dctlFloat3FromHex(stop.color)};`);
		lines.push("\t\tif (!resolved && t >= previousOffset && t <= offset) {");
		lines.push("\t\t\tfloat span = _fmaxf(offset - previousOffset, 0.00001);");
		lines.push(
			"\t\t\tresult = lk_mix3(previousColor, color, (t - previousOffset) / span);",
		);
		lines.push("\t\t\tresolved = true;");
		lines.push("\t\t}");
		lines.push("\t\tpreviousOffset = offset;");
		lines.push("\t\tpreviousColor = color;");
		lines.push("\t}");
	}
	lines.push("\tif (resolved) return result;");
	lines.push(
		"\tfloat wrapSpan = _fmaxf((firstOffset + 1.0) - previousOffset, 0.00001);",
	);
	lines.push(
		"\tfloat travel = (t < firstOffset ? t + 1.0 : t) - previousOffset;",
	);
	lines.push(
		"\treturn lk_mix3(previousColor, firstColor, _clamp(travel / wrapSpan, 0.0, 1.0));",
	);
	lines.push("}");
	return lines.join("\n");
};

/**
 * Colorama: cyclic luminance→ramp mapping, an exact port of the GPU-tier
 * shader's math. `mix`/`phase` are the hero UI params; `repetitions` bakes as
 * a constant by default and becomes an additional slider under "expose all
 * numeric parameters". `inputPhase: "alpha"` cannot be honored — DCTL's `transform()`
 * entry point has no alpha texture input (only `p_TexR/G/B`) — so that case
 * falls back to luminance phase and is reported `approx`.
 */
export const emitColorama: LookDctlEmitter = (
	node,
	ctx,
): LookDctlEmitResult => {
	if (node.payload.kind !== "colorama") {
		throw new Error(
			`emitColorama called with mismatched payload kind "${node.payload.kind}".`,
		);
	}
	ctx.builder.addHelper(DCTL_HELPER_LUMA709);
	ctx.builder.addHelper(DCTL_HELPER_MIX3);
	ctx.builder.addHelper(DCTL_HELPER_FRACT);
	const { stops, phase, repetitions, inputPhase, mix } = node.payload;
	const rampFnName = `lk_colorama_ramp_${ctx.nodeIndex}`;
	ctx.builder.addHelper({
		name: rampFnName,
		source: rampFunctionSource(rampFnName, stops),
	});
	const mixVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_colorama_mix_${ctx.nodeIndex}`,
		label: "Colorama Mix",
		default: clamp01(mix),
		min: 0,
		max: 1,
		step: 0.01,
	});
	const phaseVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_colorama_phase_${ctx.nodeIndex}`,
		label: "Colorama Phase",
		default: Math.min(PHASE_UI_RANGE, Math.max(-PHASE_UI_RANGE, phase)),
		min: -PHASE_UI_RANGE,
		max: PHASE_UI_RANGE,
		step: 0.01,
	});
	const repetitionsExpr = exposableNumber(ctx, {
		key: "colorama.repetitions",
		label: "Colorama Repetitions",
		value: Math.round(clampRange(repetitions, 1, 32)),
		min: 1,
		max: 32,
		step: 1,
		kind: "int",
	});
	const source = [
		`__DEVICE__ float3 ${ctx.fnName}(${CHAIN_SIGNATURE_PARAMS}) {`,
		`\tfloat3 src = ${ctx.upstreamCall};`,
		"\tfloat luma = lk_luma709(src);",
		`\tfloat t = lk_fract(luma * ${repetitionsExpr} + ${phaseVar});`,
		`\tfloat3 mapped = ${rampFnName}(t);`,
		`\treturn lk_mix3(src, mapped, _clamp(${mixVar}, 0.0, 1.0));`,
		"}",
	].join("\n");
	const fidelity: LookDctlEmitResult["fidelity"] =
		inputPhase === "alpha"
			? {
					nodeId: node.id,
					kind: "colorama",
					status: "approx",
					reason:
						"dctl-alpha-phase-unavailable: DCTL's transform() entry point has no alpha texture input, so an alpha-phase Colorama falls back to luminance phase.",
				}
			: { nodeId: node.id, kind: "colorama", status: "exact" };
	return { source, tapCount: 1, fidelity };
};
