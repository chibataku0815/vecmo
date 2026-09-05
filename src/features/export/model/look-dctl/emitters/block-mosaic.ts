import { dctlFloat } from "@/shared/dctl";
import { CHAIN_SIGNATURE_PARAMS, chainCallAt } from "../chain";
import {
	DCTL_HELPER_HASH21,
	DCTL_HELPER_LUMA709,
	DCTL_HELPER_MIX3,
	DCTL_HELPER_SMOOTHSTEP,
} from "../helpers";
import { exposableNumber } from "../params";
import { cappedAverageGridSize } from "../tap-budget";
import type { LookDctlEmitter } from "../types";

/** Matches `MIN_BLOCK_MOSAIC_CELL_SIZE` / `MAX_BLOCK_MOSAIC_CELL_SIZE` in `entities/scene/model/look-graph.ts`. */
const MIN_CELL_SIZE = 8;
const MAX_CELL_SIZE = 128;
const DEGREES_TO_RADIANS = Math.PI / 180;
/** Matches `FRAGMENT_SHADER_BLOCK_MOSAIC`'s 4x4 area-average tap grid. */
const IDEAL_GRID = 4;

const clampRange = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * Block Mosaic: exact gather port of `FRAGMENT_SHADER_BLOCK_MOSAIC`'s
 * beveled-tile relief (`shared/gpu-lens/surface.ts`) — the shader's 4x4
 * area-average tap grid reproduced as direct upstream taps (capped by the
 * tap-budget guard) plus one more for the blend-source `src`, and the exact
 * grout/bevel/lighting math. `cellSize`/`mix` are the hero UI params;
 * `gap`/`bevel`/`relief`/`contrast`/`variation` bake as constants by default
 * and become additional sliders under "expose all numeric parameters"
 * (each feeds only a single runtime formula, so no restructuring is needed).
 * `lightAngle`/`lightElevation` stay baked always, even under "expose all" —
 * `lightDir` collapses to a fully baked `make_float3` since both angle and
 * elevation are combined and normalized once at export time, sidestepping a
 * runtime 3-vector `normalize()`; moving that combination to a runtime
 * formula was judged out of scope for this pass. The shader's
 * `fwidth(localUv)`-based bevel anti-alias width (DCTL has no screen-space
 * derivative) is approximated with `1 / cellSize`, which tracks how fast
 * `localUv` actually changes per source pixel far better than a fixed
 * constant would across this node's 8..128px cell-size range.
 */
export const emitBlockMosaic: LookDctlEmitter = (node, ctx) => {
	if (node.payload.kind !== "block-mosaic") {
		throw new Error(
			`emitBlockMosaic called with mismatched payload kind "${node.payload.kind}".`,
		);
	}
	ctx.builder.addHelper(DCTL_HELPER_HASH21);
	ctx.builder.addHelper(DCTL_HELPER_LUMA709);
	ctx.builder.addHelper(DCTL_HELPER_SMOOTHSTEP);
	ctx.builder.addHelper(DCTL_HELPER_MIX3);
	const {
		cellSize,
		gap,
		bevel,
		relief,
		lightAngle,
		lightElevation,
		contrast,
		variation,
		mix,
	} = node.payload;
	const cellSizeVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_block_mosaic_cell_size_${ctx.nodeIndex}`,
		label: "Block Mosaic Cell Size",
		default: clampRange(cellSize, MIN_CELL_SIZE, MAX_CELL_SIZE),
		min: MIN_CELL_SIZE,
		max: MAX_CELL_SIZE,
		step: 1,
	});
	const mixVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_block_mosaic_mix_${ctx.nodeIndex}`,
		label: "Block Mosaic Mix",
		default: clamp01(mix),
		min: 0,
		max: 1,
		step: 0.01,
	});

	const grid = cappedAverageGridSize(IDEAL_GRID, ctx.tapBudget - 1);
	const angleRadians = lightAngle * DEGREES_TO_RADIANS;
	const elevationMix = 0.22 + (1.6 - 0.22) * clamp01(lightElevation);
	const lightRaw: readonly [number, number, number] = [
		Math.cos(angleRadians),
		Math.sin(angleRadians),
		elevationMix,
	];
	const lightLen = Math.hypot(lightRaw[0], lightRaw[1], lightRaw[2]) || 1;
	const lightDir: readonly [number, number, number] = [
		lightRaw[0] / lightLen,
		lightRaw[1] / lightLen,
		lightRaw[2] / lightLen,
	];
	const gapExpr = exposableNumber(ctx, {
		key: "block-mosaic.gap",
		label: "Block Mosaic Gap",
		value: clampRange(gap, 0, 0.55),
		min: 0,
		max: 0.55,
		step: 0.01,
	});
	const bevelExpr = exposableNumber(ctx, {
		key: "block-mosaic.bevel",
		label: "Block Mosaic Bevel",
		value: clamp01(bevel),
		min: 0,
		max: 1,
		step: 0.01,
	});
	const reliefExpr = exposableNumber(ctx, {
		key: "block-mosaic.relief",
		label: "Block Mosaic Relief",
		value: clamp01(relief),
		min: 0,
		max: 1,
		step: 0.01,
	});
	const contrastExpr = exposableNumber(ctx, {
		key: "block-mosaic.contrast",
		label: "Block Mosaic Contrast",
		value: clamp01(contrast),
		min: 0,
		max: 1,
		step: 0.01,
	});
	const variationExpr = exposableNumber(ctx, {
		key: "block-mosaic.variation",
		label: "Block Mosaic Variation",
		value: clamp01(variation),
		min: 0,
		max: 1,
		step: 0.01,
	});

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

	const source = [
		`__DEVICE__ float3 ${ctx.fnName}(${CHAIN_SIGNATURE_PARAMS}) {`,
		`\tfloat3 src = ${ctx.upstreamCall};`,
		"\tfloat2 resolution = make_float2(_fmaxf(float(p_Width), 1.0), _fmaxf(float(p_Height), 1.0));",
		"\tfloat2 px = make_float2(uv.x * resolution.x, uv.y * resolution.y);",
		`\tfloat cellVal = _fmaxf(4.0, ${cellSizeVar});`,
		"\tfloat2 cellCoord = make_float2(_floorf(px.x / cellVal), _floorf(px.y / cellVal));",
		"\tfloat2 localUv = make_float2(px.x / cellVal - cellCoord.x, px.y / cellVal - cellCoord.y);",
		"\tfloat avgR = 0.0;",
		"\tfloat avgG = 0.0;",
		"\tfloat avgB = 0.0;",
		...tapLines,
		`\tavgR /= ${dctlFloat(grid * grid)};`,
		`\tavgG /= ${dctlFloat(grid * grid)};`,
		`\tavgB /= ${dctlFloat(grid * grid)};`,
		`\tfloat gain = _mix(0.72, 2.65, _clamp(${contrastExpr}, 0.0, 1.0));`,
		"\tfloat tonedR = _clamp((avgR - 0.5) * gain + 0.5, 0.0, 1.0);",
		"\tfloat tonedG = _clamp((avgG - 0.5) * gain + 0.5, 0.0, 1.0);",
		"\tfloat tonedB = _clamp((avgB - 0.5) * gain + 0.5, 0.0, 1.0);",
		"\tfloat tileNoise = lk_hash21(cellCoord);",
		`\tfloat variationFactor = 1.0 + (tileNoise - 0.5) * _clamp(${variationExpr}, 0.0, 1.0) * 0.34;`,
		"\ttonedR = _clamp(tonedR * variationFactor, 0.0, 1.0);",
		"\ttonedG = _clamp(tonedG * variationFactor, 0.0, 1.0);",
		"\ttonedB = _clamp(tonedB * variationFactor, 0.0, 1.0);",
		"\tfloat3 toned = make_float3(tonedR, tonedG, tonedB);",
		"\tfloat luma = lk_luma709(toned);",
		`\tfloat inset = _clamp(${gapExpr}, 0.0, 0.55) * 0.5;`,
		"\tfloat aaX = _fmaxf(1.0 / cellVal, 0.001);",
		"\tfloat aaY = aaX;",
		"\tfloat maskX = lk_smoothstep(inset, inset + aaX, localUv.x) * (1.0 - lk_smoothstep(1.0 - inset - aaX, 1.0 - inset, localUv.x));",
		"\tfloat maskY = lk_smoothstep(inset, inset + aaY, localUv.y) * (1.0 - lk_smoothstep(1.0 - inset - aaY, 1.0 - inset, localUv.y));",
		"\tfloat faceMask = _clamp(maskX * maskY, 0.0, 1.0);",
		"\tfloat faceDenom = _fmaxf(1.0 - inset * 2.0, 0.001);",
		"\tfloat faceUvX = _clamp((localUv.x - inset) / faceDenom, 0.0, 1.0);",
		"\tfloat faceUvY = _clamp((localUv.y - inset) / faceDenom, 0.0, 1.0);",
		`\tfloat bevelWidth = _mix(0.018, 0.28, _clamp(${bevelExpr}, 0.0, 1.0));`,
		"\tfloat left = 1.0 - lk_smoothstep(0.0, bevelWidth, faceUvX);",
		"\tfloat right = 1.0 - lk_smoothstep(0.0, bevelWidth, 1.0 - faceUvX);",
		"\tfloat top = 1.0 - lk_smoothstep(0.0, bevelWidth, faceUvY);",
		"\tfloat bottom = 1.0 - lk_smoothstep(0.0, bevelWidth, 1.0 - faceUvY);",
		"\tfloat edgeBand = _clamp(_fmaxf(_fmaxf(left, right), _fmaxf(top, bottom)), 0.0, 1.0);",
		"\tfloat edgeNormalX = right - left;",
		"\tfloat edgeNormalY = bottom - top;",
		"\tfloat edgeNormalLen = _fmaxf(_sqrtf(edgeNormalX * edgeNormalX + edgeNormalY * edgeNormalY), 0.0001);",
		"\tedgeNormalX = edgeNormalX / edgeNormalLen;",
		"\tedgeNormalY = edgeNormalY / edgeNormalLen;",
		`\tfloat relief = _clamp(${reliefExpr}, 0.0, 1.0);`,
		`\tfloat3 lightDir = make_float3(${dctlFloat(lightDir[0])}, ${dctlFloat(lightDir[1])}, ${dctlFloat(lightDir[2])});`,
		"\tfloat3 bevelNormalRaw = make_float3(edgeNormalX * edgeBand * relief * 1.35, edgeNormalY * edgeBand * relief * 1.35, 1.0);",
		"\tfloat bevelNormalLen = _fmaxf(_sqrtf(bevelNormalRaw.x * bevelNormalRaw.x + bevelNormalRaw.y * bevelNormalRaw.y + bevelNormalRaw.z * bevelNormalRaw.z), 0.0001);",
		"\tfloat3 bevelNormal = make_float3(bevelNormalRaw.x / bevelNormalLen, bevelNormalRaw.y / bevelNormalLen, bevelNormalRaw.z / bevelNormalLen);",
		"\tfloat dotN = bevelNormal.x * lightDir.x + bevelNormal.y * lightDir.y + bevelNormal.z * lightDir.z;",
		"\tfloat diffuse = _clamp(dotN * 0.5 + 0.5, 0.0, 1.0);",
		"\tfloat bevelShade = _mix(0.62, 1.34, diffuse);",
		"\tfloat topShade = _mix(0.94, 1.12, luma);",
		"\tfloat shade = _mix(topShade, bevelShade, edgeBand * relief);",
		"\tfloat cornerDarken = _fminf(left + top, right + bottom) * 0.12 * relief;",
		"\tfloat shadeAmount = _fmaxf(0.0, shade - cornerDarken);",
		"\tfloat3 blockRgb = make_float3(_clamp(tonedR * shadeAmount, 0.0, 1.0), _clamp(tonedG * shadeAmount, 0.0, 1.0), _clamp(tonedB * shadeAmount, 0.0, 1.0));",
		"\tfloat groutMixAmount = 0.25 + luma * 0.2;",
		"\tfloat3 groutRgb = lk_mix3(make_float3(0.035, 0.035, 0.035), make_float3(tonedR * 0.22, tonedG * 0.22, tonedB * 0.22), groutMixAmount);",
		"\tfloat3 mosaicRgb = lk_mix3(groutRgb, blockRgb, faceMask);",
		`\treturn lk_mix3(src, mosaicRgb, _clamp(${mixVar}, 0.0, 1.0));`,
		"}",
	].join("\n");

	return {
		source,
		tapCount: 1 + grid * grid,
		fidelity:
			grid < IDEAL_GRID
				? {
						nodeId: node.id,
						kind: "block-mosaic",
						status: "approx",
						reason: `dctl-tap-budget-reduced: the ${IDEAL_GRID}x${IDEAL_GRID} area-average tap grid was reduced to ${grid}x${grid} to fit the tap-budget guard given this node's position in the fusion chain.`,
					}
				: { nodeId: node.id, kind: "block-mosaic", status: "exact" },
	};
};
