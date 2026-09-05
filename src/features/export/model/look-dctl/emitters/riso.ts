import type { RisoBlendMode } from "@/entities/scene/model/look-graph";
import { hexToRgb } from "@/shared/color";
import { type DctlHelperFunction, dctlFloat } from "@/shared/dctl";
import { CHAIN_SIGNATURE_PARAMS, chainCallAt } from "../chain";
import {
	DCTL_HELPER_HASH21,
	DCTL_HELPER_LENGTH2,
	DCTL_HELPER_LUMA709,
	DCTL_HELPER_ROTATE2,
	DCTL_HELPER_SMOOTHSTEP,
} from "../helpers";
import { exposableNumber } from "../params";
import { cappedAverageGridSize } from "../tap-budget";
import type { LookDctlEmitResult, LookDctlEmitter } from "../types";

const DEGREES_TO_RADIANS = Math.PI / 180;
/** Matches `inkCoverage`'s 2x2 area-average tap grid in `FRAGMENT_SHADER_RISO`. */
const IDEAL_GRID = 2;
/** Stand-in for the GLSL's `max(fwidth(dist), 1.2)` — same substitution rationale as `halftone`'s `AA_WIDTH_PX`. */
const AA_WIDTH_PX = 1.2;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** One-argument-pair (`b` = base/source channel, `s` = ink/blend channel) formula per `RisoBlendMode`, an exact port of `blendOver`'s 12 branches in `FRAGMENT_SHADER_RISO`. */
const RISO_BLEND_HELPERS: Record<RisoBlendMode, DctlHelperFunction> = {
	normal: {
		name: "lk_riso_blend_normal",
		source:
			"__DEVICE__ float lk_riso_blend_normal(float b, float s) {\n\treturn s;\n}",
	},
	multiply: {
		name: "lk_riso_blend_multiply",
		source:
			"__DEVICE__ float lk_riso_blend_multiply(float b, float s) {\n\treturn b * s;\n}",
	},
	screen: {
		name: "lk_riso_blend_screen",
		source:
			"__DEVICE__ float lk_riso_blend_screen(float b, float s) {\n\treturn 1.0 - (1.0 - b) * (1.0 - s);\n}",
	},
	overlay: {
		name: "lk_riso_blend_overlay",
		source:
			"__DEVICE__ float lk_riso_blend_overlay(float b, float s) {\n\treturn b < 0.5 ? 2.0 * b * s : 1.0 - 2.0 * (1.0 - b) * (1.0 - s);\n}",
	},
	darken: {
		name: "lk_riso_blend_darken",
		source:
			"__DEVICE__ float lk_riso_blend_darken(float b, float s) {\n\treturn _fminf(b, s);\n}",
	},
	lighten: {
		name: "lk_riso_blend_lighten",
		source:
			"__DEVICE__ float lk_riso_blend_lighten(float b, float s) {\n\treturn _fmaxf(b, s);\n}",
	},
	"color-dodge": {
		name: "lk_riso_blend_color_dodge",
		source:
			"__DEVICE__ float lk_riso_blend_color_dodge(float b, float s) {\n\treturn _clamp(b / _fmaxf(1.0 - s, 0.0001), 0.0, 1.0);\n}",
	},
	"color-burn": {
		name: "lk_riso_blend_color_burn",
		source:
			"__DEVICE__ float lk_riso_blend_color_burn(float b, float s) {\n\treturn 1.0 - _clamp((1.0 - b) / _fmaxf(s, 0.0001), 0.0, 1.0);\n}",
	},
	"hard-light": {
		name: "lk_riso_blend_hard_light",
		source:
			"__DEVICE__ float lk_riso_blend_hard_light(float b, float s) {\n\treturn s < 0.5 ? 2.0 * b * s : 1.0 - 2.0 * (1.0 - b) * (1.0 - s);\n}",
	},
	"soft-light": {
		name: "lk_riso_blend_soft_light",
		source: [
			"__DEVICE__ float lk_riso_blend_soft_light(float b, float s) {",
			"\tfloat d = b < 0.25 ? ((16.0 * b - 12.0) * b + 4.0) * b : _sqrtf(b);",
			"\treturn s < 0.5 ? b - (1.0 - 2.0 * s) * b * (1.0 - b) : b + (2.0 * s - 1.0) * (d - b);",
			"}",
		].join("\n"),
	},
	difference: {
		name: "lk_riso_blend_difference",
		source:
			"__DEVICE__ float lk_riso_blend_difference(float b, float s) {\n\treturn _fabs(b - s);\n}",
	},
	exclusion: {
		name: "lk_riso_blend_exclusion",
		source:
			"__DEVICE__ float lk_riso_blend_exclusion(float b, float s) {\n\treturn b + s - 2.0 * b * s;\n}",
	},
};

const rgb01FromHex = (hex: string): readonly [number, number, number] => {
	const rgb = hexToRgb(hex);
	return rgb ? [rgb.r / 255, rgb.g / 255, rgb.b / 255] : [0, 0, 0];
};

/**
 * Riso: gather port of `FRAGMENT_SHADER_RISO`'s 1-3 spot-ink duotone/tritone
 * print (`shared/gpu-lens/surface.ts`) — each authored ink's `inkCoverage`
 * (its own rotated dot screen, registration offset, and tonal bias) is
 * reproduced exactly, including the 2x2 area-average tap grid (capped by the
 * tap-budget guard) and the subtractive `riso *= mix(white, inkColor, cov)`
 * overprint. `field`'s linear/radial gradient reads the same frame-normalized
 * 0..1 convention `lens`/`kaleidoscope`'s centres use (`dctl-uv-orientation-
 * assumed`) rather than a per-object bounds this exporter has no access to.
 * `amount`/`mix` are the hero UI params (matching the plan); `cellSize`/
 * `dotSize`/`contrast`/`grain`/`bloomProgress`/`field.softness`/
 * `field.radius` (radial mode only) bake as constants by default and become
 * additional sliders under "expose all numeric parameters". Everything else
 * — `blendMode`, `field.mode`/positions, each ink's `color`/`angle`/
 * `offsetX`/`offsetY` — bakes as a constant always: the ink count, field
 * shape, and blend formula are resolved to concrete unrolled code at export
 * time (`blendMode` selects exactly one of the 12 {@link RISO_BLEND_HELPERS},
 * not a runtime switch), and per-ink numeric fields were judged out of scope
 * for this pass (they would need per-ink-indexed param keys on top of the
 * per-node-index suffix every other exposable field already uses).
 */
export const emitRiso: LookDctlEmitter = (node, ctx): LookDctlEmitResult => {
	if (node.payload.kind !== "riso") {
		throw new Error(
			`emitRiso called with mismatched payload kind "${node.payload.kind}".`,
		);
	}
	ctx.builder.addHelper(DCTL_HELPER_ROTATE2);
	ctx.builder.addHelper(DCTL_HELPER_LENGTH2);
	ctx.builder.addHelper(DCTL_HELPER_LUMA709);
	ctx.builder.addHelper(DCTL_HELPER_SMOOTHSTEP);
	ctx.builder.addHelper(DCTL_HELPER_HASH21);
	const {
		cellSize,
		dotSize,
		contrast,
		grain,
		mix,
		bloomProgress,
		blendMode,
		inks,
		amount,
		field,
	} = node.payload;

	const amountVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_riso_amount_${ctx.nodeIndex}`,
		label: "Riso Amount",
		default: clamp01(amount),
		min: 0,
		max: 1,
		step: 0.01,
	});
	const mixVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_riso_mix_${ctx.nodeIndex}`,
		label: "Riso Mix",
		default: clamp01(mix),
		min: 0,
		max: 1,
		step: 0.01,
	});

	const inkCount = Math.max(1, Math.min(3, inks.length));
	const perInkBudget = Math.max(1, Math.floor((ctx.tapBudget - 1) / inkCount));
	const grid = cappedAverageGridSize(IDEAL_GRID, perInkBudget);
	const cellSizeExpr = exposableNumber(ctx, {
		key: "riso.cellSize",
		label: "Riso Cell Size",
		value: Math.max(1, cellSize),
		min: 2,
		max: 64,
		step: 1,
	});
	const dotSizeExpr = exposableNumber(ctx, {
		key: "riso.dotSize",
		label: "Riso Dot Size",
		value: dotSize,
		min: 0,
		max: 1.5,
		step: 0.01,
	});
	const contrastExpr = exposableNumber(ctx, {
		key: "riso.contrast",
		label: "Riso Contrast",
		value: contrast,
		min: 0,
		max: 1,
		step: 0.01,
	});
	const grainExpr = exposableNumber(ctx, {
		key: "riso.grain",
		label: "Riso Grain",
		value: clamp01(grain),
		min: 0,
		max: 1,
		step: 0.01,
	});
	const bloomProgressExpr = exposableNumber(ctx, {
		key: "riso.bloomProgress",
		label: "Riso Print On",
		value: clamp01(bloomProgress),
		min: 0,
		max: 1,
		step: 0.01,
	});

	const blendHelper = RISO_BLEND_HELPERS[blendMode];
	ctx.builder.addHelper(blendHelper);

	const lines: string[] = [
		`__DEVICE__ float3 ${ctx.fnName}(${CHAIN_SIGNATURE_PARAMS}) {`,
		`\tfloat3 src = ${ctx.upstreamCall};`,
		"\tfloat2 resolution = make_float2(_fmaxf(float(p_Width), 1.0), _fmaxf(float(p_Height), 1.0));",
		"\tfloat2 imageUv = uv;",
		"\tfloat2 origin = make_float2(resolution.x * 0.5, resolution.y * 0.5);",
	];

	if (field.mode === "uniform") {
		lines.push(`\tfloat amt = _clamp(${amountVar}, 0.0, 1.0);`);
	} else {
		const fieldA: readonly [number, number] =
			field.mode === "radial" ? [field.cx, field.cy] : [field.x1, field.y1];
		const fieldB: readonly [number, number] = [field.x2, field.y2];
		lines.push(
			"\tfloat2 fieldPos = make_float2(imageUv.x * resolution.x, imageUv.y * resolution.y);",
			`\tfloat2 fieldA = make_float2(${dctlFloat(fieldA[0])}, ${dctlFloat(fieldA[1])});`,
		);
		if (field.mode === "linear") {
			lines.push(
				`\tfloat2 fieldB = make_float2(${dctlFloat(fieldB[0])}, ${dctlFloat(fieldB[1])});`,
				"\tfloat2 ab = make_float2(fieldB.x - fieldA.x, fieldB.y - fieldA.y);",
				"\tfloat2 pa = make_float2(fieldPos.x - fieldA.x, fieldPos.y - fieldA.y);",
				"\tfloat fv = _clamp((pa.x * ab.x + pa.y * ab.y) / _fmaxf(ab.x * ab.x + ab.y * ab.y, 0.00001), 0.0, 1.0);",
			);
		} else {
			const fieldRadiusExpr = exposableNumber(ctx, {
				key: "riso.field.radius",
				label: "Riso Field Radius",
				value: field.radius,
				min: 0.01,
				max: 3,
				step: 0.01,
			});
			lines.push(
				`\tfloat fieldRadius = _fmaxf(${fieldRadiusExpr}, 0.001);`,
				"\tfloat2 pa = make_float2(fieldPos.x - fieldA.x, fieldPos.y - fieldA.y);",
				"\tfloat fieldDist = _sqrtf(pa.x * pa.x + pa.y * pa.y) / fieldRadius;",
				"\tfloat fv = 1.0 - _clamp(fieldDist, 0.0, 1.0);",
			);
		}
		const fieldSoftnessExpr = exposableNumber(ctx, {
			key: "riso.fieldSoftness",
			label: "Riso Field Softness",
			value: field.softness,
			min: 0,
			max: 1,
			step: 0.01,
		});
		lines.push(
			`\tfv = _mix(lk_smoothstep(0.42, 0.58, fv), lk_smoothstep(0.0, 1.0, fv), _clamp(${fieldSoftnessExpr}, 0.0, 1.0));`,
		);
		if (field.invert) lines.push("\tfv = 1.0 - fv;");
		lines.push(
			"\tfv = _clamp(fv, 0.0, 1.0);",
			`\tfloat amt = _clamp(${amountVar}, 0.0, 1.0) * fv;`,
		);
	}
	lines.push(
		`\tfloat dotScale = amt * lk_smoothstep(0.0, 1.0, _clamp(${bloomProgressExpr}, 0.0, 1.0));`,
	);
	lines.push(
		"\tfloat risoR = 1.0;",
		"\tfloat risoG = 1.0;",
		"\tfloat risoB = 1.0;",
	);

	inks.slice(0, inkCount).forEach((ink, index) => {
		const angleRadians = ink.angle * DEGREES_TO_RADIANS;
		const toneBias = (index - 0.5 * (inkCount - 1)) * 0.22;
		const [inkR, inkG, inkB] = rgb01FromHex(ink.color);
		const grainOffset = index * 17;
		const tapLines: string[] = [];
		for (let ty = 0; ty < grid; ty += 1) {
			for (let tx = 0; tx < grid; tx += 1) {
				const fx = (tx + 0.5) / grid;
				const fy = (ty + 0.5) / grid;
				tapLines.push(
					"\t\t{",
					`\t\t\tfloat2 tapGridPx = make_float2((cellCoord.x + ${dctlFloat(fx)}) * cellVal, (cellCoord.y + ${dctlFloat(fy)}) * cellVal);`,
					`\t\t\tfloat2 tapPaperPx = lk_rotate2(tapGridPx, ${dctlFloat(angleRadians)});`,
					"\t\t\tfloat2 tapUv = make_float2(_clamp((tapPaperPx.x + origin.x) / resolution.x, 0.0, 1.0), _clamp((tapPaperPx.y + origin.y) / resolution.y, 0.0, 1.0));",
					`\t\t\tfloat3 tap = ${chainCallAt(ctx.upstreamFnName, "tapUv")};`,
					"\t\t\tavgR += tap.x;",
					"\t\t\tavgG += tap.y;",
					"\t\t\tavgB += tap.z;",
					"\t\t}",
				);
			}
		}
		lines.push(
			"\t{",
			`\t\tfloat2 q = make_float2(imageUv.x * resolution.x - ${dctlFloat(ink.offsetX)}, imageUv.y * resolution.y - ${dctlFloat(ink.offsetY)});`,
			"\t\tfloat2 centered = make_float2(q.x - origin.x, q.y - origin.y);",
			`\t\tfloat2 gridPx = lk_rotate2(centered, ${dctlFloat(-angleRadians)});`,
			`\t\tfloat cellVal = ${cellSizeExpr};`,
			"\t\tfloat2 cellCoord = make_float2(_floorf(gridPx.x / cellVal), _floorf(gridPx.y / cellVal));",
			"\t\tfloat2 gridFrac = make_float2(gridPx.x / cellVal - cellCoord.x, gridPx.y / cellVal - cellCoord.y);",
			"\t\tfloat2 localPx = make_float2((gridFrac.x - 0.5) * cellVal, (gridFrac.y - 0.5) * cellVal);",
			"\t\tfloat avgR = 0.0;",
			"\t\tfloat avgG = 0.0;",
			"\t\tfloat avgB = 0.0;",
			...tapLines,
			`\t\tavgR /= ${dctlFloat(grid * grid)};`,
			`\t\tavgG /= ${dctlFloat(grid * grid)};`,
			`\t\tavgB /= ${dctlFloat(grid * grid)};`,
			"\t\tfloat luma = lk_luma709(make_float3(avgR, avgG, avgB));",
			`\t\tfloat gain = _mix(0.75, 2.5, _clamp(${contrastExpr}, 0.0, 1.0));`,
			`\t\tfloat tone = _clamp((luma - 0.5) * gain + 0.5 + ${dctlFloat(toneBias)}, 0.0, 1.0);`,
			`\t\tfloat radius = _sqrtf(_fmaxf(0.0, 1.0 - tone)) * 0.5 * cellVal * _clamp(${dotSizeExpr}, 0.0, 1.5) * dotScale;`,
			"\t\tfloat dist = lk_length2(localPx);",
			`\t\tfloat aa = ${dctlFloat(AA_WIDTH_PX)};`,
			"\t\tfloat cov = (1.0 - lk_smoothstep(radius - aa, radius + aa, dist)) * lk_smoothstep(0.01, 0.5, radius);",
			"\t\tcov = _clamp(cov, 0.0, 1.0);",
			`\t\tfloat grainN = lk_hash21(make_float2(imageUv.x * resolution.x * 0.4 + ${dctlFloat(grainOffset)}, imageUv.y * resolution.y * 0.4 + ${dctlFloat(grainOffset)}));`,
			`\t\tcov = cov * _mix(1.0, grainN, _clamp(${grainExpr}, 0.0, 1.0) * 0.7);`,
			`\t\trisoR = risoR * _mix(1.0, ${dctlFloat(inkR)}, cov);`,
			`\t\trisoG = risoG * _mix(1.0, ${dctlFloat(inkG)}, cov);`,
			`\t\trisoB = risoB * _mix(1.0, ${dctlFloat(inkB)}, cov);`,
			"\t}",
		);
	});

	lines.push(
		`\tfloat compositedR = ${blendHelper.name}(src.x, risoR);`,
		`\tfloat compositedG = ${blendHelper.name}(src.y, risoG);`,
		`\tfloat compositedB = ${blendHelper.name}(src.z, risoB);`,
		"\tfloat3 printed = make_float3(compositedR, compositedG, compositedB);",
		`\tfloat blendAmount = _clamp(${mixVar}, 0.0, 1.0) * amt;`,
		"\treturn make_float3(",
		"\t\t_mix(src.x, printed.x, blendAmount),",
		"\t\t_mix(src.y, printed.y, blendAmount),",
		"\t\t_mix(src.z, printed.z, blendAmount)",
		"\t);",
		"}",
	);

	return {
		source: lines.join("\n"),
		tapCount: 1 + inkCount * grid * grid,
		fidelity:
			grid < IDEAL_GRID
				? {
						nodeId: node.id,
						kind: "riso",
						status: "approx",
						reason: `dctl-tap-budget-reduced: each ink's ${IDEAL_GRID}x${IDEAL_GRID} area-average tap grid was reduced to ${grid}x${grid} to fit the tap-budget guard given this node's position in the fusion chain and its ${inkCount}-ink tap multiplier.`,
					}
				: { nodeId: node.id, kind: "riso", status: "exact" },
	};
};
