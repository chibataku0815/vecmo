import { dctlFloat } from "@/shared/dctl";
import { CHAIN_SIGNATURE_PARAMS, chainCallAt } from "../chain";
import {
	DCTL_HELPER_ASCII_GLYPH_MASK,
	DCTL_HELPER_ASCII_GLYPH_ROW,
	DCTL_HELPER_ASCII_ROW_AT,
	DCTL_HELPER_GL_MOD,
	DCTL_HELPER_LUMA709,
	DCTL_HELPER_MIX3,
} from "../helpers";
import { exposableNumber } from "../params";
import { cappedAverageGridSize } from "../tap-budget";
import type { LookDctlEmitter } from "../types";

/** Matches `MIN_ASCII_GLYPH_CELL_SIZE` / `MAX_ASCII_GLYPH_CELL_SIZE` in `entities/scene/model/look-graph.ts`. */
const MIN_CELL_SIZE = 8;
const MAX_CELL_SIZE = 96;
/** Matches `FRAGMENT_SHADER_ASCII_GLYPH`'s character-cell aspect (`cellHeight * 0.72`). */
const CELL_ASPECT = 0.72;
/** Matches `FRAGMENT_SHADER_ASCII_GLYPH`'s 4x4 area-average tap grid. */
const IDEAL_GRID = 4;

const clampRange = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * ASCII Glyph: exact gather port of `FRAGMENT_SHADER_ASCII_GLYPH`'s 5x7
 * density-glyph mosaic (`shared/gpu-lens/surface.ts`) — the shader's 4x4
 * area-average tap grid over each character cell reproduced as direct
 * upstream taps (capped by the tap-budget guard) plus one more for the
 * blend-source `src`, and the exact tone -> glyph-index -> bitmap-mask
 * pipeline via {@link DCTL_HELPER_ASCII_GLYPH_MASK}. `cellSize`/`mix` are
 * the hero UI params; `glyphScale`/`contrast`/`brightness`/`densityBias`/
 * `invert` bake as constants.
 */
export const emitAsciiGlyph: LookDctlEmitter = (node, ctx) => {
	if (node.payload.kind !== "ascii-glyph") {
		throw new Error(
			`emitAsciiGlyph called with mismatched payload kind "${node.payload.kind}".`,
		);
	}
	ctx.builder.addHelper(DCTL_HELPER_ASCII_ROW_AT);
	ctx.builder.addHelper(DCTL_HELPER_ASCII_GLYPH_ROW);
	ctx.builder.addHelper(DCTL_HELPER_GL_MOD);
	ctx.builder.addHelper(DCTL_HELPER_ASCII_GLYPH_MASK);
	ctx.builder.addHelper(DCTL_HELPER_LUMA709);
	ctx.builder.addHelper(DCTL_HELPER_MIX3);
	const {
		cellSize,
		glyphScale,
		contrast,
		brightness,
		densityBias,
		invert,
		mix,
	} = node.payload;
	const cellSizeVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_ascii_glyph_cell_size_${ctx.nodeIndex}`,
		label: "ASCII Glyph Cell Size",
		default: clampRange(cellSize, MIN_CELL_SIZE, MAX_CELL_SIZE),
		min: MIN_CELL_SIZE,
		max: MAX_CELL_SIZE,
		step: 1,
	});
	const mixVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_ascii_glyph_mix_${ctx.nodeIndex}`,
		label: "ASCII Glyph Mix",
		default: clamp01(mix),
		min: 0,
		max: 1,
		step: 0.01,
	});

	const grid = cappedAverageGridSize(IDEAL_GRID, ctx.tapBudget - 1);
	const glyphScaleExpr = exposableNumber(ctx, {
		key: "ascii-glyph.glyphScale",
		label: "ASCII Glyph Scale",
		value: glyphScale,
		min: 0.5,
		max: 1.15,
		step: 0.01,
	});
	const contrastExpr = exposableNumber(ctx, {
		key: "ascii-glyph.contrast",
		label: "ASCII Glyph Contrast",
		value: contrast,
		min: 0,
		max: 1,
		step: 0.01,
	});
	const brightnessExpr = exposableNumber(ctx, {
		key: "ascii-glyph.brightness",
		label: "ASCII Glyph Brightness",
		value: brightness,
		min: 0,
		max: 2,
		step: 0.01,
	});
	const densityBiasExpr = exposableNumber(ctx, {
		key: "ascii-glyph.densityBias",
		label: "ASCII Glyph Density Bias",
		value: densityBias,
		min: -1,
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
				`\t\tfloat2 tapPx = make_float2((cellCoord.x + ${dctlFloat(fx)}) * cellPitch.x, (cellCoord.y + ${dctlFloat(fy)}) * cellPitch.y);`,
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
		`\tfloat cellHeight = _fmaxf(4.0, ${cellSizeVar});`,
		`\tfloat2 cellPitch = make_float2(cellHeight * ${dctlFloat(CELL_ASPECT)}, cellHeight);`,
		"\tfloat2 cellCoord = make_float2(_floorf(px.x / cellPitch.x), _floorf(px.y / cellPitch.y));",
		"\tfloat2 localUv = make_float2(px.x / cellPitch.x - cellCoord.x, px.y / cellPitch.y - cellCoord.y);",
		"\tfloat avgR = 0.0;",
		"\tfloat avgG = 0.0;",
		"\tfloat avgB = 0.0;",
		...tapLines,
		`\tavgR /= ${dctlFloat(grid * grid)};`,
		`\tavgG /= ${dctlFloat(grid * grid)};`,
		`\tavgB /= ${dctlFloat(grid * grid)};`,
		`\tfloat gain = _mix(0.75, 2.75, _clamp(${contrastExpr}, 0.0, 1.0));`,
		"\tfloat3 toned = make_float3(",
		"\t\t_clamp((avgR - 0.5) * gain + 0.5, 0.0, 1.0),",
		"\t\t_clamp((avgG - 0.5) * gain + 0.5, 0.0, 1.0),",
		"\t\t_clamp((avgB - 0.5) * gain + 0.5, 0.0, 1.0)",
		"\t);",
		"\tfloat tone = lk_luma709(toned);",
		`\ttone = _clamp(tone + _clamp(${densityBiasExpr}, -1.0, 1.0), 0.0, 1.0);`,
		invert ? "\ttone = 1.0 - tone;" : null,
		"\tfloat glyph = _floorf(_clamp(tone, 0.0, 0.999) * 10.0);",
		`\tfloat mask = lk_ascii_glyph_mask(glyph, localUv, _clamp(${glyphScaleExpr}, 0.35, 1.25));`,
		`\tfloat lit = _fminf(1.0, mask * _clamp(${brightnessExpr}, 0.0, 2.0));`,
		`\treturn lk_mix3(src, make_float3(lit, lit, lit), _clamp(${mixVar}, 0.0, 1.0));`,
		"}",
	]
		.filter((line): line is string => line !== null)
		.join("\n");

	return {
		source,
		tapCount: 1 + grid * grid,
		fidelity:
			grid < IDEAL_GRID
				? {
						nodeId: node.id,
						kind: "ascii-glyph",
						status: "approx",
						reason: `dctl-tap-budget-reduced: the ${IDEAL_GRID}x${IDEAL_GRID} area-average tap grid was reduced to ${grid}x${grid} to fit the tap-budget guard given this node's position in the fusion chain.`,
					}
				: { nodeId: node.id, kind: "ascii-glyph", status: "exact" },
	};
};
