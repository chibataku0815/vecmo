import { effectFieldMattePrimitives } from "./effect-field-filter";
import type { DeferredEffect, FilterPrimitive } from "./effect-filter";
import type {
	SourceOpticsNodePlan,
	SourceOpticsSourcePlan,
	SourceOpticsTargetPlan,
} from "./source-optics";
import { compileSourceOpticsRayKernel } from "./source-optics-ray-kernel";
import type { Bounds, Vec2 } from "./types";

export type SourceOpticsFilterLowering = {
	readonly primitives: readonly FilterPrimitive[];
	readonly output: string;
	readonly outwardReach: number;
	readonly deferred: readonly DeferredEffect[];
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const safeColor = (value: string | undefined): string =>
	value?.trim() || "#ffffff";

const alphaSlope = (
	input: string,
	slope: number,
	result: string,
): FilterPrimitive => ({
	kind: "component-transfer",
	in: input,
	functions: {
		a: { type: "linear", slope: Math.max(0, slope), intercept: 0 },
	},
	result,
});

const tintedMask = (
	mask: string,
	color: string,
	opacity: number,
	prefix: string,
): readonly FilterPrimitive[] => [
	{
		kind: "flood",
		floodColor: safeColor(color),
		floodOpacity: clamp01(opacity),
		result: `${prefix}-color`,
	},
	{
		kind: "composite",
		operator: "in",
		in: `${prefix}-color`,
		in2: mask,
		result: prefix,
	},
];

const sourceLowering = (
	plan: SourceOpticsSourcePlan,
	bounds: Bounds,
	input: string,
	prefix: string,
): SourceOpticsFilterLowering => {
	const primitives: FilterPrimitive[] = [];
	const deferred: DeferredEffect[] = [];
	const layers: string[] = [];
	const hasActiveChannel =
		(plan.bloom.enabled && plan.bloom.intensity > 0) ||
		plan.rays.some((ray) => ray.enabled && ray.intensity > 0) ||
		Boolean(plan.atmosphere?.enabled && plan.atmosphere.mix > 0) ||
		Boolean(plan.lens?.enabled && plan.lens.mix > 0 && plan.lens.chroma > 0);
	if (!hasActiveChannel) {
		return { primitives, output: input, outwardReach: 0, deferred };
	}
	const emissionLuma = `${prefix}-emission-luma`;
	const emissionInput = `${prefix}-emission`;
	const thresholdSpan = Math.max(0.001, 1 - clamp01(plan.bloom.threshold));
	primitives.push(
		{
			kind: "color-matrix",
			matrixType: "matrix",
			values: [
				1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0.2126, 0.7152, 0.0722, 0,
				0,
			],
			in: input,
			result: emissionLuma,
		},
		{
			kind: "component-transfer",
			in: emissionLuma,
			functions: {
				a: {
					type: "linear",
					slope: 1 / thresholdSpan,
					intercept: -clamp01(plan.bloom.threshold) / thresholdSpan,
				},
			},
			result: emissionInput,
		},
	);
	if (plan.bloom.enabled && plan.bloom.intensity > 0) {
		const sx = Math.max(0, plan.bloom.radiusX / 3);
		const sy = Math.max(0, (plan.bloom.radiusY ?? plan.bloom.radiusX) / 3);
		primitives.push(
			{
				kind: "gaussian-blur",
				in: emissionInput,
				stdDeviation: sx === sy ? sx : ([sx, sy] as const),
				result: `${prefix}-bloom-blur`,
			},
			{
				kind: "component-transfer",
				in: `${prefix}-bloom-blur`,
				functions: {
					a: {
						type: "linear",
						slope: plan.bloom.intensity,
						intercept: 0,
					},
				},
				result: `${prefix}-bloom`,
			},
		);
		layers.push(`${prefix}-bloom`);
	}

	for (const [index, ray] of plan.rays.entries()) {
		if (!ray.enabled || ray.intensity <= 0) continue;
		const kernel = compileSourceOpticsRayKernel(ray);
		const rayPrefix = `${prefix}-ray-${index}`;
		const seed = `${rayPrefix}-seed`;
		primitives.push({
			kind: "gaussian-blur",
			in: emissionInput,
			stdDeviation: kernel.bridgeSigma,
			result: seed,
		});
		const sampleLayers: string[] = [];
		for (const [sampleIndex, sample] of kernel.samples.entries()) {
			const offset = `${rayPrefix}-sample-${sampleIndex}-offset`;
			const weighted = `${rayPrefix}-sample-${sampleIndex}`;
			primitives.push(
				{
					kind: "offset",
					in: seed,
					dx: sample.offset.x,
					dy: sample.offset.y,
					result: offset,
				},
				alphaSlope(offset, sample.weight * ray.intensity, weighted),
			);
			sampleLayers.push(weighted);
		}
		primitives.push({ kind: "merge", inputs: sampleLayers, result: rayPrefix });
		layers.push(rayPrefix);
	}

	if (
		plan.atmosphere?.enabled &&
		plan.atmosphere.mix > 0 &&
		plan.atmosphereFieldRoute
	) {
		const atmospherePrefix = `${prefix}-atmosphere`;
		const direction = plan.atmosphereDirection;
		const alongX = Math.max(
			0.1,
			plan.atmosphere.reach * (0.18 + Math.abs(direction.x) * 0.22),
		);
		const alongY = Math.max(
			0.1,
			plan.atmosphere.reach * (0.18 + Math.abs(direction.y) * 0.22),
		);
		primitives.push({
			kind: "gaussian-blur",
			in: emissionInput,
			stdDeviation: [alongX, alongY],
			result: `${atmospherePrefix}-blur`,
		});
		const fieldBounds: Bounds = {
			x: bounds.x - plan.atmosphere.reach,
			y: bounds.y - plan.atmosphere.reach,
			width: bounds.width + plan.atmosphere.reach * 2,
			height: bounds.height + plan.atmosphere.reach * 2,
		};
		const matte = effectFieldMattePrimitives(
			plan.atmosphereFieldRoute,
			fieldBounds,
			`${atmospherePrefix}-field`,
		);
		if (matte) {
			primitives.push(...matte.primitives, {
				kind: "composite",
				operator: "in",
				in: `${atmospherePrefix}-blur`,
				in2: matte.output,
				result: `${atmospherePrefix}-mask`,
			});
			if (plan.atmosphere.tint) {
				primitives.push(
					...tintedMask(
						`${atmospherePrefix}-mask`,
						plan.atmosphere.tint,
						1,
						atmospherePrefix,
					),
				);
			} else {
				primitives.push({
					kind: "component-transfer",
					in: `${atmospherePrefix}-mask`,
					functions: {
						a: {
							type: "gamma",
							amplitude: 1,
							exponent: 0.5 + plan.atmosphere.falloff,
							offset: 0,
						},
					},
					result: atmospherePrefix,
				});
			}
			layers.push(atmospherePrefix);
		} else {
			deferred.push({
				kind: "source-optics",
				reason: "Atmosphere Effect Field could not be lowered on this surface.",
			});
		}
	}

	if (plan.lens?.enabled && plan.lens.mix > 0 && plan.lens.chroma > 0) {
		const lensPrefix = `${prefix}-lens`;
		const lensInput = `${lensPrefix}-soft`;
		primitives.push({
			kind: "gaussian-blur",
			in: emissionInput,
			stdDeviation: Math.max(0.1, plan.lens.reach / 6),
			result: lensInput,
		});
		const channel = (
			name: "r" | "b",
			dx: number,
			matrix: readonly number[],
		): void => {
			primitives.push(
				{
					kind: "color-matrix",
					matrixType: "matrix",
					values: matrix,
					in: lensInput,
					result: `${lensPrefix}-${name}-channel`,
				},
				{
					kind: "offset",
					in: `${lensPrefix}-${name}-channel`,
					dx,
					dy: 0,
					result: `${lensPrefix}-${name}-offset`,
				},
				alphaSlope(
					`${lensPrefix}-${name}-offset`,
					plan.lens?.mix ?? 0,
					`${lensPrefix}-${name}`,
				),
			);
		};
		channel(
			"r",
			-plan.lens.chroma,
			[1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
		);
		channel(
			"b",
			plan.lens.chroma,
			[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0],
		);
		layers.push(`${lensPrefix}-r`, `${lensPrefix}-b`);
	}

	if (layers.length === 0) {
		return {
			primitives,
			output: input,
			outwardReach: plan.outwardReach,
			deferred,
		};
	}
	const opticalLayers = `${prefix}-optical-layers`;
	const output = `${prefix}-output`;
	primitives.push(
		{ kind: "merge", inputs: layers, result: opticalLayers },
		{
			kind: "blend",
			mode: plan.bloom.blendMode,
			in: opticalLayers,
			in2: input,
			result: output,
		},
	);
	return {
		primitives,
		output,
		outwardReach: plan.outwardReach,
		deferred,
	};
};

const directionalBand = (options: {
	readonly direction: Vec2;
	readonly width: number;
	readonly softness: number;
	readonly prefix: string;
}): {
	readonly primitives: readonly FilterPrimitive[];
	readonly output: string;
} => {
	const shifted = `${options.prefix}-shifted`;
	const raw = `${options.prefix}-raw`;
	const output = `${options.prefix}-band`;
	const primitives: FilterPrimitive[] = [
		{
			kind: "offset",
			in: "SourceAlpha",
			dx: -options.direction.x * options.width,
			dy: -options.direction.y * options.width,
			result: shifted,
		},
		{
			kind: "composite",
			operator: "out",
			in: "SourceAlpha",
			in2: shifted,
			result: raw,
		},
	];
	if (options.softness > 0) {
		primitives.push({
			kind: "gaussian-blur",
			in: raw,
			stdDeviation: options.softness / 3,
			result: output,
		});
	} else {
		primitives.push(alphaSlope(raw, 1, output));
	}
	return { primitives, output };
};

const microstructureMask = (
	plan: SourceOpticsTargetPlan,
	input: string,
	mask: string,
	prefix: string,
): {
	readonly primitives: readonly FilterPrimitive[];
	readonly output: string;
} => {
	const amount = plan.hasExistingMicrostructure
		? clamp01(plan.binding.microstructure?.amount ?? 0)
		: 0;
	if (amount <= 0) return { primitives: [], output: mask };
	const primitives: FilterPrimitive[] = [
		{
			kind: "color-matrix",
			matrixType: "matrix",
			values: [
				0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.2126, 0.7152, 0.0722, 0,
				0,
			],
			in: input,
			result: `${prefix}-luma`,
		},
		{
			kind: "composite",
			operator: "in",
			in: mask,
			in2: `${prefix}-luma`,
			result: `${prefix}-modulated`,
		},
		alphaSlope(mask, 1 - amount, `${prefix}-base`),
		alphaSlope(`${prefix}-modulated`, amount, `${prefix}-detail`),
		{
			kind: "merge",
			inputs: [`${prefix}-base`, `${prefix}-detail`],
			result: `${prefix}-microstructure`,
		},
	];
	return { primitives, output: `${prefix}-microstructure` };
};

const targetLowering = (
	plan: SourceOpticsTargetPlan,
	bounds: Bounds,
	input: string,
	prefix: string,
): SourceOpticsFilterLowering => {
	const primitives: FilterPrimitive[] = [];
	const deferred: DeferredEffect[] = [];
	const layers: string[] = [input];
	const hasVisibleResponse =
		(plan.binding.surface?.amount ?? 0) > 0 ||
		(plan.binding.diffusion?.amount ?? 0) > 0 ||
		(plan.binding.edge?.amount ?? 0) > 0;
	if (!hasVisibleResponse) {
		if (
			(plan.binding.microstructure?.amount ?? 0) > 0 &&
			!plan.hasExistingMicrostructure
		) {
			deferred.push({
				kind: "source-optics",
				reason: `Response "${plan.binding.id}" requested microstructure coupling, but the target has no eligible existing texture owner.`,
			});
		}
		return { primitives, output: input, outwardReach: 0, deferred };
	}
	const field = effectFieldMattePrimitives(
		plan.fieldRoute,
		bounds,
		`${prefix}-field`,
	);
	if (!field) {
		return {
			primitives,
			output: input,
			outwardReach: 0,
			deferred: [
				{
					kind: "source-optics",
					reason: `Response "${plan.binding.id}" field could not be lowered on this surface.`,
				},
			],
		};
	}
	primitives.push(...field.primitives);

	const applyField = (mask: string, result: string): void => {
		primitives.push({
			kind: "composite",
			operator: "in",
			in: mask,
			in2: field.output,
			result,
		});
	};

	let spectralMask: string | null = null;
	const surface = plan.binding.surface;
	if (surface && surface.amount > 0) {
		const band = directionalBand({
			direction: plan.sourceDirection,
			width: surface.width,
			softness: surface.softness,
			prefix: `${prefix}-surface`,
		});
		primitives.push(...band.primitives);
		applyField(band.output, `${prefix}-surface-field`);
		const detailed = microstructureMask(
			plan,
			input,
			`${prefix}-surface-field`,
			`${prefix}-surface`,
		);
		primitives.push(...detailed.primitives);
		primitives.push(
			...tintedMask(
				detailed.output,
				surface.tint ?? "#ffffff",
				surface.amount,
				`${prefix}-surface-color`,
			),
		);
		layers.push(`${prefix}-surface-color`);
		spectralMask = detailed.output;
	}

	const diffusion = plan.binding.diffusion;
	if (diffusion && diffusion.amount > 0) {
		const band = directionalBand({
			direction: plan.sourceDirection,
			width: diffusion.depth,
			softness: diffusion.softness,
			prefix: `${prefix}-diffusion`,
		});
		primitives.push(
			...band.primitives,
			{
				kind: "gaussian-blur",
				in: band.output,
				stdDeviation: Math.max(0.1, diffusion.depth / 4),
				result: `${prefix}-diffusion-soft`,
			},
			{
				kind: "composite",
				operator: "in",
				in: `${prefix}-diffusion-soft`,
				in2: "SourceAlpha",
				result: `${prefix}-diffusion-inside`,
			},
		);
		applyField(`${prefix}-diffusion-inside`, `${prefix}-diffusion-field`);
		primitives.push(
			...tintedMask(
				`${prefix}-diffusion-field`,
				diffusion.tint ?? "#ffffff",
				diffusion.amount,
				`${prefix}-diffusion-color`,
			),
		);
		layers.push(`${prefix}-diffusion-color`);
		if (!spectralMask) spectralMask = `${prefix}-diffusion-field`;
	}

	const edge = plan.binding.edge;
	if (edge && edge.amount > 0) {
		const band = directionalBand({
			direction: plan.sourceDirection,
			width: edge.width,
			softness: edge.softness,
			prefix: `${prefix}-edge`,
		});
		primitives.push(...band.primitives);
		applyField(band.output, `${prefix}-edge-field`);
		primitives.push(
			...tintedMask(
				`${prefix}-edge-field`,
				edge.tint ?? "#ffffff",
				edge.amount,
				`${prefix}-edge-color`,
			),
		);
		layers.push(`${prefix}-edge-color`);
		if (!spectralMask) spectralMask = `${prefix}-edge-field`;
	}

	const spectral = plan.binding.spectral;
	if (spectral && spectral.amount > 0 && spectral.offset > 0 && spectralMask) {
		const red = `${prefix}-spectral-red`;
		const blue = `${prefix}-spectral-blue`;
		primitives.push(
			...tintedMask(spectralMask, "#ff3355", spectral.amount, `${red}-color`),
			{
				kind: "offset",
				in: `${red}-color`,
				dx: -plan.sourceDirection.y * spectral.offset,
				dy: plan.sourceDirection.x * spectral.offset,
				result: red,
			},
			...tintedMask(spectralMask, "#33aaff", spectral.amount, `${blue}-color`),
			{
				kind: "offset",
				in: `${blue}-color`,
				dx: plan.sourceDirection.y * spectral.offset,
				dy: -plan.sourceDirection.x * spectral.offset,
				result: blue,
			},
		);
		layers.push(red, blue);
	}

	if (plan.binding.microstructure && !plan.hasExistingMicrostructure) {
		deferred.push({
			kind: "source-optics",
			reason: `Response "${plan.binding.id}" requested microstructure coupling, but the target has no eligible existing texture owner.`,
		});
	}

	if (layers.length === 1) {
		return { primitives, output: input, outwardReach: 0, deferred };
	}
	const output = `${prefix}-output`;
	primitives.push({ kind: "merge", inputs: layers, result: output });
	return { primitives, output, outwardReach: 0, deferred };
};

/** Lowers one source or target node plan into the existing node filter chain. */
export function sourceOpticsFilterPrimitives(
	plan: SourceOpticsNodePlan | null | undefined,
	bounds: Bounds,
	input: string,
	resultPrefix = "source-optics",
): SourceOpticsFilterLowering {
	if (!plan) {
		return { primitives: [], output: input, outwardReach: 0, deferred: [] };
	}
	let output = input;
	let outwardReach = 0;
	const primitives: FilterPrimitive[] = [];
	const deferred: DeferredEffect[] = [];
	if (plan.source) {
		const source = sourceLowering(
			plan.source,
			bounds,
			output,
			`${resultPrefix}-source`,
		);
		primitives.push(...source.primitives);
		deferred.push(...source.deferred);
		output = source.output;
		outwardReach = Math.max(outwardReach, source.outwardReach);
	}
	if (plan.target) {
		const target = targetLowering(
			plan.target,
			bounds,
			output,
			`${resultPrefix}-target`,
		);
		primitives.push(...target.primitives);
		deferred.push(...target.deferred);
		output = target.output;
		outwardReach = Math.max(outwardReach, target.outwardReach);
	}
	return { primitives, output, outwardReach, deferred };
}
