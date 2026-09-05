import type { DctlSourceBuilder } from "@/shared/dctl";
import { dctlFloat } from "@/shared/dctl";
import { CHAIN_SIGNATURE_PARAMS, chainCallAt } from "../chain";
import {
	DCTL_HELPER_FRACT,
	DCTL_HELPER_HASH3,
	DCTL_HELPER_LENGTH2,
	DCTL_HELPER_VNOISE3,
} from "../helpers";
import { exposableNumber } from "../params";
import type { LookDctlEmitResult, LookDctlEmitter } from "../types";

/** Matches `MIN_FLOW_OCTAVES` / `MAX_FLOW_OCTAVES` in `entities/scene/model/look-graph.ts`. */
const MIN_OCTAVES = 1;
const MAX_OCTAVES = 6;
const TAU = Math.PI * 2;
/** Curl finite-difference step, matching `FRAGMENT_SHADER_FLOW`'s `e`. */
const CURL_EPSILON = 0.04;

const clampNonNegative = (value: number): number => Math.max(0, value);

/**
 * Registers this node's private fBm + curl helpers. GLSL's `fbm()` loops
 * `uOctaves` times as a *uniform* int — legal in a fragment shader, which
 * recompiles per parameter edit anyway — but DCTL needs a compile-time loop
 * bound (same constraint `colorama`'s ramp unrolling documents), so each
 * `flow` node instance gets its own `lk_flow_fbm_<i>` with the authored
 * octave count baked into the `for` header, and its own
 * `lk_flow_curl_<i>` built on top of it (the `turbulent` pattern's domain-
 * warped curl-noise flow field).
 */
const registerFlowNoiseHelpers = (
	builder: DctlSourceBuilder,
	nodeIndex: number,
	octaves: number,
): { readonly fbmFnName: string; readonly curlFnName: string } => {
	builder.addHelper(DCTL_HELPER_FRACT);
	builder.addHelper(DCTL_HELPER_HASH3);
	builder.addHelper(DCTL_HELPER_VNOISE3);
	const boundedOctaves = Math.min(
		MAX_OCTAVES,
		Math.max(MIN_OCTAVES, Math.round(octaves)),
	);
	const fbmFnName = `lk_flow_fbm_${nodeIndex}`;
	builder.addHelper({
		name: fbmFnName,
		source: [
			`__DEVICE__ float ${fbmFnName}(float3 p) {`,
			"\tfloat s = 0.0;",
			"\tfloat a = 0.5;",
			"\tfloat norm = 0.0;",
			`\tfor (int i = 0; i < ${boundedOctaves}; i++) {`,
			"\t\ts += a * lk_vnoise3(p);",
			"\t\tnorm += a;",
			"\t\tp = make_float3(p.x * 2.0, p.y * 2.0, p.z * 2.0);",
			"\t\ta *= 0.5;",
			"\t}",
			"\treturn s / _fmaxf(norm, 0.0001);",
			"}",
		].join("\n"),
	});
	const curlFnName = `lk_flow_curl_${nodeIndex}`;
	builder.addHelper({
		name: curlFnName,
		source: [
			`__DEVICE__ float2 ${curlFnName}(float3 p) {`,
			`\tfloat e = ${dctlFloat(CURL_EPSILON)};`,
			`\tfloat n1 = ${fbmFnName}(make_float3(p.x, p.y + e, p.z));`,
			`\tfloat n2 = ${fbmFnName}(make_float3(p.x, p.y - e, p.z));`,
			`\tfloat n3 = ${fbmFnName}(make_float3(p.x + e, p.y, p.z));`,
			`\tfloat n4 = ${fbmFnName}(make_float3(p.x - e, p.y, p.z));`,
			"\treturn make_float2((n1 - n2) / (2.0 * e), -(n3 - n4) / (2.0 * e));",
			"}",
		].join("\n"),
	});
	return { fbmFnName, curlFnName };
};

/**
 * Flow: exact uv-remap port of `FRAGMENT_SHADER_FLOW`'s evolving fBm
 * displacement (`shared/gpu-lens/surface.ts`) — the 3D value-noise fBm, its
 * curl (for the `turbulent` pattern), and the `bulge`/`twist` radial forms
 * are all reproduced verbatim, aspect-corrected the same way the shader is.
 * `amount`/`evolution` are the hero UI params (both keyframable directly in
 * Resolve, matching the exporter's "Resolve keyframes exported params
 * itself" contract — `flow`'s payload has no autonomous `speed`/auto-evolve
 * field the way `noise-source` does, so there is no per-frame rate to derive
 * from `TIMELINE_FRAME_INDEX`; `evolution` is exposed as a plain slider
 * instead). `pattern`/`scale`/`octaves`/`centerX`/`centerY` bake as
 * constants — `pattern` selects which of the three branches below is emitted
 * (no runtime branch, since it cannot change per frame).
 */
export const emitFlow: LookDctlEmitter = (node, ctx): LookDctlEmitResult => {
	if (node.payload.kind !== "flow") {
		throw new Error(
			`emitFlow called with mismatched payload kind "${node.payload.kind}".`,
		);
	}
	const { pattern, amount, scale, octaves, evolution, centerX, centerY } =
		node.payload;
	const { fbmFnName, curlFnName } = registerFlowNoiseHelpers(
		ctx.builder,
		ctx.nodeIndex,
		octaves,
	);
	const amountVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_flow_amount_${ctx.nodeIndex}`,
		label: "Flow Amount",
		default: Math.min(0.5, clampNonNegative(amount)),
		min: 0,
		max: 0.5,
		step: 0.005,
	});
	const evolutionVar = ctx.builder.declareUiParam({
		kind: "slider-float",
		varName: `p_flow_evolution_${ctx.nodeIndex}`,
		label: "Flow Evolution",
		default: Math.min(4, Math.max(0, evolution)),
		min: 0,
		max: 4,
		step: 0.01,
	});
	const scaleExpr = exposableNumber(ctx, {
		key: "flow.scale",
		label: "Flow Detail Scale",
		value: scale,
		min: 0.5,
		max: 16,
		step: 0.1,
	});
	const centerXExpr = exposableNumber(ctx, {
		key: "flow.centerX",
		label: "Flow Center X",
		value: centerX,
		min: 0,
		max: 1,
		step: 0.01,
	});
	const centerYExpr = exposableNumber(ctx, {
		key: "flow.centerY",
		label: "Flow Center Y",
		value: centerY,
		min: 0,
		max: 1,
		step: 0.01,
	});
	const lines: string[] = [
		`__DEVICE__ float3 ${ctx.fnName}(${CHAIN_SIGNATURE_PARAMS}) {`,
		"\tfloat aspect = float(p_Width) / _fmaxf(float(p_Height), 1.0);",
		`\tfloat3 np = make_float3(uv.x * ${scaleExpr}, uv.y * ${scaleExpr}, ${evolutionVar});`,
	];
	if (pattern === "turbulent") {
		lines.push(
			`\tfloat2 q = make_float2(${fbmFnName}(np), ${fbmFnName}(make_float3(np.x + 5.2, np.y + 1.3, np.z + 2.1)));`,
			"\tfloat3 warped = make_float3(np.x + 3.0 * q.x, np.y + 3.0 * q.y, np.z);",
			`\tfloat2 curlValue = ${curlFnName}(warped);`,
			`\tfloat2 uv2 = make_float2(uv.x + curlValue.x * ${amountVar} * 0.5, uv.y + curlValue.y * ${amountVar} * 0.5);`,
		);
	} else if (pattern === "bulge") {
		ctx.builder.addHelper(DCTL_HELPER_LENGTH2);
		lines.push(
			`\tfloat2 center = make_float2(${centerXExpr}, ${centerYExpr});`,
			"\tfloat2 d = make_float2((uv.x - center.x) * aspect, uv.y - center.y);",
			`\tfloat n = ${fbmFnName}(np) - 0.5;`,
			"\tfloat2 dEps = make_float2(d.x + 0.00001, d.y + 0.00001);",
			"\tfloat dEpsLen = _fmaxf(lk_length2(dEps), 0.0000001);",
			"\tfloat2 dir = make_float2(dEps.x / dEpsLen, dEps.y / dEpsLen);",
			`\tfloat2 off = make_float2(dir.x * n * 2.0 * ${amountVar}, dir.y * n * 2.0 * ${amountVar});`,
			"\tfloat2 uv2 = make_float2(uv.x + off.x / aspect, uv.y + off.y);",
		);
	} else {
		lines.push(
			`\tfloat2 center = make_float2(${centerXExpr}, ${centerYExpr});`,
			"\tfloat2 d = make_float2((uv.x - center.x) * aspect, uv.y - center.y);",
			`\tfloat ang = (${fbmFnName}(np) - 0.5) * 2.0 * ${amountVar} * ${dctlFloat(TAU)};`,
			"\tfloat c = _cosf(ang);",
			"\tfloat s = _sinf(ang);",
			"\tfloat2 rd = make_float2(d.x * c - d.y * s, d.x * s + d.y * c);",
			"\tfloat2 uv2 = make_float2(center.x + rd.x / aspect, center.y + rd.y);",
		);
	}
	lines.push(`\treturn ${chainCallAt(ctx.upstreamFnName, "uv2")};`, "}");

	return {
		source: lines.join("\n"),
		tapCount: 1,
		fidelity: { nodeId: node.id, kind: "flow", status: "exact" },
	};
};
