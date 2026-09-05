import { dctlFloat } from "@/shared/dctl";
import { CHAIN_SIGNATURE_PARAMS, chainCallAt } from "../chain";
import {
	DCTL_HELPER_MIX3,
	DCTL_HELPER_ROUNDED_BOX_SDF,
	DCTL_HELPER_SMOOTHSTEP,
} from "../helpers";
import { exposableNumber } from "../params";
import { cappedAverageGridSize } from "../tap-budget";
import type { LookDctlEmitter } from "../types";

/** Matches `MIN_PIXEL_GRID_CELL_SIZE` / `MAX_PIXEL_GRID_CELL_SIZE` in `entities/scene/model/look-graph.ts`. */
const MIN_CELL_SIZE = 4;
const MAX_CELL_SIZE = 96;
/** Matches `FRAGMENT_SHADER_PIXEL_GRID`'s 4x4 area-average tap grid. */
const IDEAL_GRID = 4;
/** Stand-in for the GLSL's `max(fwidth(sdf), 0.75)` — same substitution rationale as `halftone`'s `AA_WIDTH_PX`. */
const AA_WIDTH_PX = 0.75;

const clampRange = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * Pixel Grid: exact gather port of `FRAGMENT_SHADER_PIXEL_GRID`'s LED-matrix
 * cell mask (`shared/gpu-lens/surface.ts`) — a stable (non-rotated) cell
 * lattice, the shader's 4x4 area-average tap grid reproduced as direct
 * upstream taps (capped by the tap-budget guard) plus one more for the
 * blend-source `src`, and the exact rounded-box SDF coverage math via
 * {@link DCTL_HELPER_ROUNDED_BOX_SDF}. `cellSize`/`mix` are the hero UI
 * params; `gap`/`roundness`/`brightness`/`contrast` bake as constants.
 */
export const emitPixelGrid: LookDctlEmitter = (node, ctx) => {
	if (node.payload.kind !== "pixel-grid") {
		throw new Error(
			`emitPixelGrid called with mismatched payload kind "${node.payload.kind}".`,
		);
	}
	ctx.builder.addHelper(DCTL_HELPER_ROUNDED_BOX_SDF);
	ctx.builder.addHelper(DCTL_HELPER_SMOOTHSTEP);
	ctx.builder.addHelper(DCTL_HELPER_MIX3);
	const { cellSize, gap, roundness, brightness, contrast, mix } = node.payload;
	const cellSizeVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_pixel_grid_cell_size_${ctx.nodeIndex}`,
		label: "Pixel Grid Cell Size",
		default: clampRange(cellSize, MIN_CELL_SIZE, MAX_CELL_SIZE),
		min: MIN_CELL_SIZE,
		max: MAX_CELL_SIZE,
		step: 1,
	});
	const mixVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_pixel_grid_mix_${ctx.nodeIndex}`,
		label: "Pixel Grid Mix",
		default: clamp01(mix),
		min: 0,
		max: 1,
		step: 0.01,
	});

	const grid = cappedAverageGridSize(IDEAL_GRID, ctx.tapBudget - 1);
	const gapExpr = exposableNumber(ctx, {
		key: "pixel-grid.gap",
		label: "Pixel Grid Gap",
		value: gap,
		min: 0,
		max: 0.6,
		step: 0.01,
	});
	const roundnessExpr = exposableNumber(ctx, {
		key: "pixel-grid.roundness",
		label: "Pixel Grid Roundness",
		value: roundness,
		min: 0,
		max: 1,
		step: 0.01,
	});
	const brightnessExpr = exposableNumber(ctx, {
		key: "pixel-grid.brightness",
		label: "Pixel Grid Brightness",
		value: brightness,
		min: 0,
		max: 2,
		step: 0.01,
	});
	const contrastExpr = exposableNumber(ctx, {
		key: "pixel-grid.contrast",
		label: "Pixel Grid Contrast",
		value: contrast,
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
				`\t\tfloat2 tapPx = make_float2((cellCoord.x + ${dctlFloat(fx)}) * cellSizeVal, (cellCoord.y + ${dctlFloat(fy)}) * cellSizeVal);`,
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
		`\tfloat cellSizeVal = _fmaxf(1.0, ${cellSizeVar});`,
		"\tfloat2 cellCoord = make_float2(_floorf(px.x / cellSizeVal), _floorf(px.y / cellSizeVal));",
		"\tfloat2 cellFrac = make_float2(px.x / cellSizeVal - cellCoord.x, px.y / cellSizeVal - cellCoord.y);",
		"\tfloat2 localPx = make_float2((cellFrac.x - 0.5) * cellSizeVal, (cellFrac.y - 0.5) * cellSizeVal);",
		"\tfloat avgR = 0.0;",
		"\tfloat avgG = 0.0;",
		"\tfloat avgB = 0.0;",
		...tapLines,
		`\tavgR /= ${dctlFloat(grid * grid)};`,
		`\tavgG /= ${dctlFloat(grid * grid)};`,
		`\tavgB /= ${dctlFloat(grid * grid)};`,
		`\tfloat gap = _clamp(${gapExpr}, 0.0, 0.6);`,
		"\tfloat halfLit = _fmaxf(0.5, cellSizeVal * 0.5 * (1.0 - gap));",
		`\tfloat radius = halfLit * _clamp(${roundnessExpr}, 0.0, 1.0);`,
		"\tfloat sdf = lk_rounded_box_sdf(localPx, halfLit, radius);",
		`\tfloat aa = ${dctlFloat(AA_WIDTH_PX)};`,
		"\tfloat coverage = 1.0 - lk_smoothstep(0.0, aa, sdf);",
		`\tfloat gain = _mix(0.8, 2.6, _clamp(${contrastExpr}, 0.0, 1.0));`,
		"\tfloat tonedR = _clamp((avgR - 0.5) * gain + 0.5, 0.0, 1.0);",
		"\tfloat tonedG = _clamp((avgG - 0.5) * gain + 0.5, 0.0, 1.0);",
		"\tfloat tonedB = _clamp((avgB - 0.5) * gain + 0.5, 0.0, 1.0);",
		`\tfloat brightnessAmount = _clamp(${brightnessExpr}, 0.0, 2.0);`,
		"\tfloat litR = _fminf(1.0, tonedR * brightnessAmount) * coverage;",
		"\tfloat litG = _fminf(1.0, tonedG * brightnessAmount) * coverage;",
		"\tfloat litB = _fminf(1.0, tonedB * brightnessAmount) * coverage;",
		`\treturn lk_mix3(src, make_float3(litR, litG, litB), _clamp(${mixVar}, 0.0, 1.0));`,
		"}",
	].join("\n");

	return {
		source,
		tapCount: 1 + grid * grid,
		fidelity:
			grid < IDEAL_GRID
				? {
						nodeId: node.id,
						kind: "pixel-grid",
						status: "approx",
						reason: `dctl-tap-budget-reduced: the ${IDEAL_GRID}x${IDEAL_GRID} area-average tap grid was reduced to ${grid}x${grid} to fit the tap-budget guard given this node's position in the fusion chain.`,
					}
				: { nodeId: node.id, kind: "pixel-grid", status: "exact" },
	};
};
