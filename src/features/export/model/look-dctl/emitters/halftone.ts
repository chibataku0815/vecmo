import { dctlFloat } from "@/shared/dctl";
import { CHAIN_SIGNATURE_PARAMS, chainCallAt } from "../chain";
import {
	DCTL_HELPER_LENGTH2,
	DCTL_HELPER_LUMA709,
	DCTL_HELPER_MIX3,
	DCTL_HELPER_ROTATE2,
	DCTL_HELPER_SMOOTHSTEP,
} from "../helpers";
import { exposableNumber } from "../params";
import { cappedAverageGridSize } from "../tap-budget";
import type { LookDctlEmitter } from "../types";

/** Matches `MIN_HALFTONE_CELL_SIZE` / `MAX_HALFTONE_CELL_SIZE` in `entities/scene/model/look-graph.ts`. */
const MIN_CELL_SIZE = 4;
const MAX_CELL_SIZE = 80;
const DEGREES_TO_RADIANS = Math.PI / 180;
/** Matches `FRAGMENT_SHADER_HALFTONE`'s 4x4 area-average tap grid. */
const IDEAL_GRID = 4;
/** Stand-in for the GLSL's `max(fwidth(dist), 0.75)` screen-space-derivative anti-alias width — DCTL has no `fwidth()`, and this is the shader's own floor value (the common case for a 1px-per-source-pixel mapping). */
const AA_WIDTH_PX = 0.75;

const clampRange = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * Halftone: exact gather port of `FRAGMENT_SHADER_HALFTONE`'s rotated-cell
 * dot screen (`shared/gpu-lens/surface.ts`) — a rotated lattice is built from
 * `uv`/`p_Width`/`p_Height` exactly as the shader builds it from `vUv`/
 * `uResolution` (this exporter's DCTL `uv` already matches the shader's
 * "image space" convention, per the always-present
 * `dctl-uv-orientation-assumed` note), then the shader's own 4x4 area-average
 * tap grid is reproduced as {@link IDEAL_GRID} direct upstream taps (capped
 * by the S3 tap-budget guard), plus one more upstream tap for the `src`
 * color the final `mix` blends against. `cellSize`/`mix` are the hero UI
 * params; `dotSize`/`contrast`/`angle` bake as constants by default and
 * become additional sliders under the "expose all numeric parameters" export
 * option (`angle` is always a plain runtime rotation, never a codegen-time
 * branch, so exposing it needs no extra structure).
 */
export const emitHalftone: LookDctlEmitter = (node, ctx) => {
	if (node.payload.kind !== "halftone") {
		throw new Error(
			`emitHalftone called with mismatched payload kind "${node.payload.kind}".`,
		);
	}
	ctx.builder.addHelper(DCTL_HELPER_ROTATE2);
	ctx.builder.addHelper(DCTL_HELPER_LUMA709);
	ctx.builder.addHelper(DCTL_HELPER_MIX3);
	ctx.builder.addHelper(DCTL_HELPER_SMOOTHSTEP);
	ctx.builder.addHelper(DCTL_HELPER_LENGTH2);
	const { cellSize, dotSize, contrast, angle, mix } = node.payload;
	const cellSizeVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_halftone_cell_size_${ctx.nodeIndex}`,
		label: "Halftone Cell Size",
		default: clampRange(cellSize, MIN_CELL_SIZE, MAX_CELL_SIZE),
		min: MIN_CELL_SIZE,
		max: MAX_CELL_SIZE,
		step: 1,
	});
	const mixVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_halftone_mix_${ctx.nodeIndex}`,
		label: "Halftone Mix",
		default: clamp01(mix),
		min: 0,
		max: 1,
		step: 0.01,
	});

	const grid = cappedAverageGridSize(IDEAL_GRID, ctx.tapBudget - 1);
	const dotSizeExpr = exposableNumber(ctx, {
		key: "halftone.dotSize",
		label: "Halftone Dot Size",
		value: dotSize,
		min: 0.25,
		max: 1.5,
		step: 0.01,
	});
	const contrastExpr = exposableNumber(ctx, {
		key: "halftone.contrast",
		label: "Halftone Contrast",
		value: contrast,
		min: 0,
		max: 1,
		step: 0.01,
	});
	const angleExpr = exposableNumber(ctx, {
		key: "halftone.angle",
		label: "Halftone Angle",
		value: angle,
		min: -90,
		max: 90,
		step: 1,
	});

	const tapLines: string[] = [];
	for (let ty = 0; ty < grid; ty += 1) {
		for (let tx = 0; tx < grid; tx += 1) {
			const fx = (tx + 0.5) / grid;
			const fy = (ty + 0.5) / grid;
			tapLines.push(
				"\t{",
				`\t\tfloat2 tapGridPx = make_float2((cellCoord.x + ${dctlFloat(fx)}) * cellSizeVal, (cellCoord.y + ${dctlFloat(fy)}) * cellSizeVal);`,
				"\t\tfloat2 tapPaperPx = lk_rotate2(tapGridPx, angleRadians);",
				"\t\tfloat2 tapUv = make_float2(_clamp((tapPaperPx.x + origin.x) / resolution.x, 0.0, 1.0), _clamp((tapPaperPx.y + origin.y) / resolution.y, 0.0, 1.0));",
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
		"\tfloat2 origin = make_float2(resolution.x * 0.5, resolution.y * 0.5);",
		`\tfloat cellSizeVal = _fmaxf(1.0, ${cellSizeVar});`,
		`\tfloat angleRadians = ${angleExpr} * ${dctlFloat(DEGREES_TO_RADIANS)};`,
		"\tfloat2 centered = make_float2(px.x - origin.x, px.y - origin.y);",
		"\tfloat2 gridPx = lk_rotate2(centered, -angleRadians);",
		"\tfloat2 cellCoord = make_float2(_floorf(gridPx.x / cellSizeVal), _floorf(gridPx.y / cellSizeVal));",
		"\tfloat2 gridFrac = make_float2(gridPx.x / cellSizeVal - cellCoord.x, gridPx.y / cellSizeVal - cellCoord.y);",
		"\tfloat2 localPx = make_float2((gridFrac.x - 0.5) * cellSizeVal, (gridFrac.y - 0.5) * cellSizeVal);",
		"\tfloat avgR = 0.0;",
		"\tfloat avgG = 0.0;",
		"\tfloat avgB = 0.0;",
		...tapLines,
		`\tavgR /= ${dctlFloat(grid * grid)};`,
		`\tavgG /= ${dctlFloat(grid * grid)};`,
		`\tavgB /= ${dctlFloat(grid * grid)};`,
		"\tfloat3 tonal = make_float3(avgR, avgG, avgB);",
		"\tfloat luma = lk_luma709(tonal);",
		`\tfloat gain = _mix(0.75, 2.5, _clamp(${contrastExpr}, 0.0, 1.0));`,
		"\tfloat tone = _clamp((luma - 0.5) * gain + 0.5, 0.0, 1.0);",
		`\tfloat radius = _sqrtf(_fmaxf(0.0, 1.0 - tone)) * 0.5 * cellSizeVal * _clamp(${dotSizeExpr}, 0.0, 1.5);`,
		"\tfloat dist = lk_length2(localPx);",
		`\tfloat aa = ${dctlFloat(AA_WIDTH_PX)};`,
		"\tfloat coverage = 1.0 - lk_smoothstep(radius - aa, radius + aa, dist);",
		"\tcoverage = coverage * lk_smoothstep(0.01, 0.5, radius);",
		"\tfloat3 halftoneRgb = lk_mix3(make_float3(1.0, 1.0, 1.0), tonal, _clamp(coverage, 0.0, 1.0));",
		`\treturn lk_mix3(src, halftoneRgb, _clamp(${mixVar}, 0.0, 1.0));`,
		"}",
	].join("\n");

	return {
		source,
		tapCount: 1 + grid * grid,
		fidelity:
			grid < IDEAL_GRID
				? {
						nodeId: node.id,
						kind: "halftone",
						status: "approx",
						reason: `dctl-tap-budget-reduced: the ${IDEAL_GRID}x${IDEAL_GRID} area-average tap grid was reduced to ${grid}x${grid} to fit the tap-budget guard given this node's position in the fusion chain.`,
					}
				: { nodeId: node.id, kind: "halftone", status: "exact" },
	};
};
