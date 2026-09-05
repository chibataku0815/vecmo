import { dctlFloat, dctlFloat3FromHex } from "@/shared/dctl";
import { CHAIN_SIGNATURE_PARAMS, chainCallAt } from "../chain";
import {
	DCTL_HELPER_GL_MOD,
	DCTL_HELPER_HASH21,
	DCTL_HELPER_LUMA709,
	DCTL_HELPER_MIX3,
} from "../helpers";
import { exposableNumber } from "../params";
import { cappedAverageGridSize } from "../tap-budget";
import type { LookDctlEmitter } from "../types";

/** Matches `FRAGMENT_SHADER_ORDERED_DITHER`'s 4x4 area-average tap grid. */
const IDEAL_GRID = 4;

const clampRange = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const BAYER2_HELPER = {
	name: "lk_bayer2_value",
	source: [
		"__DEVICE__ float lk_bayer2_value(float2 p) {",
		"\tfloat qx = _floorf(lk_gl_mod(p.x, 2.0));",
		"\tfloat qy = _floorf(lk_gl_mod(p.y, 2.0));",
		"\tif (qy < 0.5) return qx < 0.5 ? 0.0 : 2.0;",
		"\treturn qx < 0.5 ? 3.0 : 1.0;",
		"}",
	].join("\n"),
};

const BAYER4_HELPER = {
	name: "lk_bayer4_value",
	source: [
		"__DEVICE__ float lk_bayer4_value(float2 p) {",
		"\tfloat qx = _floorf(lk_gl_mod(p.x, 4.0));",
		"\tfloat qy = _floorf(lk_gl_mod(p.y, 4.0));",
		"\tfloat q2x = lk_gl_mod(qx, 2.0);",
		"\tfloat q2y = lk_gl_mod(qy, 2.0);",
		"\tfloat halfx = _floorf(qx / 2.0);",
		"\tfloat halfy = _floorf(qy / 2.0);",
		"\treturn 4.0 * lk_bayer2_value(make_float2(q2x, q2y)) + lk_bayer2_value(make_float2(halfx, halfy));",
		"}",
	].join("\n"),
};

const BAYER8_HELPER = {
	name: "lk_bayer8_value",
	source: [
		"__DEVICE__ float lk_bayer8_value(float2 p) {",
		"\tfloat qx = _floorf(lk_gl_mod(p.x, 8.0));",
		"\tfloat qy = _floorf(lk_gl_mod(p.y, 8.0));",
		"\tfloat q4x = lk_gl_mod(qx, 4.0);",
		"\tfloat q4y = lk_gl_mod(qy, 4.0);",
		"\tfloat halfx = _floorf(qx / 4.0);",
		"\tfloat halfy = _floorf(qy / 4.0);",
		"\treturn 4.0 * lk_bayer4_value(make_float2(q4x, q4y)) + lk_bayer2_value(make_float2(halfx, halfy));",
		"}",
	].join("\n"),
};

const ORDERED_QUANTIZE_HELPER = {
	name: "lk_ordered_quantize",
	source: [
		"__DEVICE__ float lk_ordered_quantize(float value, float activeThreshold, float steps) {",
		"\tfloat scaled = _clamp(value, 0.0, 1.0) * (steps - 1.0);",
		"\tfloat base = _floorf(scaled);",
		"\tfloat fractional = scaled - base;",
		"\tfloat raised = fractional >= activeThreshold ? 1.0 : 0.0;",
		"\treturn _clamp((base + raised) / (steps - 1.0), 0.0, 1.0);",
		"}",
	].join("\n"),
};

/**
 * Ordered Dither: gather port of `FRAGMENT_SHADER_ORDERED_DITHER`'s
 * area-average -> tone-pipeline -> threshold-quantize chain
 * (`shared/gpu-lens/surface.ts`). The `bayer` pattern is exact — its 2x2/4x4/
 * 8x8 matrices are unrolled DCTL functions ported 1:1 (`lk_bayer2/4/8_value`),
 * selected at codegen time since `matrixSize` bakes as a constant, not a
 * hero param. The `blue-noise` pattern has no DCTL texture-sampling
 * primitive to hold the embedded 64x64 tile, so it is approximated with a
 * position hash (`dctl-blue-noise-approximated`, called out in the plan) —
 * per-node fidelity always reports this when authored, regardless of the
 * tap-budget outcome. `strength`/`mix` are the hero UI params (matching the
 * plan); `cellSize`/`levels`/`contrast`/`threshold`/`brightness`/`gamma` bake
 * as constants by default and become additional sliders under "expose all
 * numeric parameters" — each of `gain`/`invGamma`/`thresholdVal`/`steps` is
 * computed as a runtime DCTL formula (not a JS-baked scalar) precisely so an
 * exposed slider actually changes the result live in Resolve. `mode`/`ink`/
 * `paper` always bake (`mode` selects the emitted branch, not a runtime
 * switch; `ink`/`paper` are colors, out of this option's numeric scope).
 */
export const emitOrderedDither: LookDctlEmitter = (node, ctx) => {
	if (node.payload.kind !== "ordered-dither") {
		throw new Error(
			`emitOrderedDither called with mismatched payload kind "${node.payload.kind}".`,
		);
	}
	ctx.builder.addHelper(DCTL_HELPER_MIX3);
	if (node.payload.mode !== "rgb") ctx.builder.addHelper(DCTL_HELPER_LUMA709);
	const {
		cellSize,
		pattern,
		matrixSize,
		levels,
		mode,
		brightness,
		contrast,
		gamma,
		threshold,
		strength,
		ink,
		paper,
		mix,
	} = node.payload;
	const strengthVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_ordered_dither_strength_${ctx.nodeIndex}`,
		label: "Ordered Dither Strength",
		default: clamp01(strength),
		min: 0,
		max: 1,
		step: 0.01,
	});
	const mixVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_ordered_dither_mix_${ctx.nodeIndex}`,
		label: "Ordered Dither Mix",
		default: clamp01(mix),
		min: 0,
		max: 1,
		step: 0.01,
	});

	const grid = cappedAverageGridSize(IDEAL_GRID, ctx.tapBudget - 1);
	const cellSizeExpr = exposableNumber(ctx, {
		key: "ordered-dither.cellSize",
		label: "Ordered Dither Cell Size",
		value: Math.max(1, cellSize),
		min: 2,
		max: 32,
		step: 1,
	});
	const brightnessExpr = exposableNumber(ctx, {
		key: "ordered-dither.brightness",
		label: "Ordered Dither Brightness",
		value: brightness,
		min: -1,
		max: 1,
		step: 0.01,
	});
	const contrastExpr = exposableNumber(ctx, {
		key: "ordered-dither.contrast",
		label: "Ordered Dither Contrast",
		value: clamp01(contrast),
		min: 0,
		max: 1,
		step: 0.01,
	});
	const gammaExpr = exposableNumber(ctx, {
		key: "ordered-dither.gamma",
		label: "Ordered Dither Gamma",
		value: clampRange(gamma, 0.25, 2.5),
		min: 0.25,
		max: 2.5,
		step: 0.01,
	});
	const thresholdExpr = exposableNumber(ctx, {
		key: "ordered-dither.threshold",
		label: "Ordered Dither Threshold",
		value: clampRange(threshold, 0, 1),
		min: 0,
		max: 1,
		step: 0.01,
	});
	const levelsExpr = exposableNumber(ctx, {
		key: "ordered-dither.levels",
		label: "Ordered Dither Levels",
		value: Math.max(2, Math.round(clampRange(levels, 2, 8))),
		min: 2,
		max: 8,
		step: 1,
		kind: "int",
	});

	let matrixThresholdExpr: string;
	if (pattern === "bayer") {
		const resolvedMatrixSize = matrixSize < 3 ? 2 : matrixSize < 6 ? 4 : 8;
		ctx.builder.addHelper(DCTL_HELPER_GL_MOD);
		ctx.builder.addHelper(BAYER2_HELPER);
		if (resolvedMatrixSize >= 4) ctx.builder.addHelper(BAYER4_HELPER);
		if (resolvedMatrixSize >= 8) ctx.builder.addHelper(BAYER8_HELPER);
		matrixThresholdExpr =
			resolvedMatrixSize === 2
				? "(lk_bayer2_value(cellCoord) + 0.5) / 4.0"
				: resolvedMatrixSize === 4
					? "(lk_bayer4_value(cellCoord) + 0.5) / 16.0"
					: "(lk_bayer8_value(cellCoord) + 0.5) / 64.0";
	} else {
		ctx.builder.addHelper(DCTL_HELPER_HASH21);
		matrixThresholdExpr = "lk_hash21(cellCoord)";
	}

	ctx.builder.addHelper(ORDERED_QUANTIZE_HELPER);

	const tapLines: string[] = [];
	for (let ty = 0; ty < grid; ty += 1) {
		for (let tx = 0; tx < grid; tx += 1) {
			const fx = (tx + 0.5) / grid;
			const fy = (ty + 0.5) / grid;
			tapLines.push(
				"\t{",
				`\t\tfloat2 tapPx = make_float2((cellCoord.x + ${dctlFloat(fx)}) * cellVal, (cellCoord.y + ${dctlFloat(fy)}) * cellVal);`,
				"\t\tfloat2 tapUv = make_float2(_clamp(tapPx.x / resolution.x, 0.0, 1.0), _clamp(tapPx.y / resolution.y, 0.0, 1.0));",
				`\t\tfloat3 tap = ${chainCallAt(ctx.upstreamFnName, "tapUv")};`,
				"\t\tavgR += tap.x;",
				"\t\tavgG += tap.y;",
				"\t\tavgB += tap.z;",
				"\t}",
			);
		}
	}

	const modeLines =
		mode === "rgb"
			? [
					"\tfloat3 result = make_float3(",
					"\t\tlk_ordered_quantize(tonedR, activeThreshold, steps),",
					"\t\tlk_ordered_quantize(tonedG, activeThreshold, steps),",
					"\t\tlk_ordered_quantize(tonedB, activeThreshold, steps)",
					"\t);",
				]
			: [
					"\tfloat lumaVal = lk_luma709(make_float3(tonedR, tonedG, tonedB));",
					"\tfloat ramp = lk_ordered_quantize(lumaVal, activeThreshold, steps);",
					`\tfloat3 result = lk_mix3(${dctlFloat3FromHex(ink)}, ${dctlFloat3FromHex(paper)}, ramp);`,
				];

	const source = [
		`__DEVICE__ float3 ${ctx.fnName}(${CHAIN_SIGNATURE_PARAMS}) {`,
		`\tfloat3 src = ${ctx.upstreamCall};`,
		"\tfloat2 resolution = make_float2(_fmaxf(float(p_Width), 1.0), _fmaxf(float(p_Height), 1.0));",
		"\tfloat2 px = make_float2(uv.x * resolution.x, uv.y * resolution.y);",
		`\tfloat cellVal = _fmaxf(1.0, ${cellSizeExpr});`,
		"\tfloat2 cellCoord = make_float2(_floorf(px.x / cellVal), _floorf(px.y / cellVal));",
		"\tfloat avgR = 0.0;",
		"\tfloat avgG = 0.0;",
		"\tfloat avgB = 0.0;",
		...tapLines,
		`\tavgR /= ${dctlFloat(grid * grid)};`,
		`\tavgG /= ${dctlFloat(grid * grid)};`,
		`\tavgB /= ${dctlFloat(grid * grid)};`,
		`\tfloat gain = _mix(0.8, 2.8, _clamp(${contrastExpr}, 0.0, 1.0));`,
		`\tfloat tonedR = _clamp((avgR + ${brightnessExpr} - 0.5) * gain + 0.5, 0.0, 1.0);`,
		`\tfloat tonedG = _clamp((avgG + ${brightnessExpr} - 0.5) * gain + 0.5, 0.0, 1.0);`,
		`\tfloat tonedB = _clamp((avgB + ${brightnessExpr} - 0.5) * gain + 0.5, 0.0, 1.0);`,
		`\tfloat invGamma = 1.0 / _fmaxf(${gammaExpr}, 0.01);`,
		"\ttonedR = _powf(tonedR, invGamma);",
		"\ttonedG = _powf(tonedG, invGamma);",
		"\ttonedB = _powf(tonedB, invGamma);",
		`\tfloat matrixThreshold = ${matrixThresholdExpr};`,
		`\tfloat thresholdVal = _clamp(matrixThreshold + _clamp(${thresholdExpr}, 0.0, 1.0) - 0.5, 0.0, 1.0);`,
		`\tfloat activeThreshold = _mix(0.5, thresholdVal, _clamp(${strengthVar}, 0.0, 1.0));`,
		`\tfloat steps = _fmaxf(2.0, _floorf(${levelsExpr} + 0.5));`,
		...modeLines,
		`\treturn lk_mix3(src, result, _clamp(${mixVar}, 0.0, 1.0));`,
		"}",
	].join("\n");

	const gridReduced = grid < IDEAL_GRID;
	const fidelity =
		pattern === "blue-noise"
			? {
					nodeId: node.id,
					kind: "ordered-dither" as const,
					status: "approx" as const,
					reason:
						"dctl-blue-noise-approximated: DCTL has no texture-sampling primitive to hold the embedded 64x64 blue-noise tile, so the per-cell threshold is a deterministic position hash instead of the organic blue-noise field.",
				}
			: gridReduced
				? {
						nodeId: node.id,
						kind: "ordered-dither" as const,
						status: "approx" as const,
						reason: `dctl-tap-budget-reduced: the ${IDEAL_GRID}x${IDEAL_GRID} area-average tap grid was reduced to ${grid}x${grid} to fit the tap-budget guard given this node's position in the fusion chain.`,
					}
				: {
						nodeId: node.id,
						kind: "ordered-dither" as const,
						status: "exact" as const,
					};

	return { source, tapCount: 1 + grid * grid, fidelity };
};
