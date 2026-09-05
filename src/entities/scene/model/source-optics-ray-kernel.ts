import type { SourceOpticsRayContract, Vec2 } from "./types";

/** Fixed bound shared by every angle-preserving ray lowering. */
export const SOURCE_OPTICS_RAY_SIDE_SAMPLE_COUNT = 8;

export type SourceOpticsRayKernelSample = {
	readonly offset: Vec2;
	readonly weight: number;
};

export type SourceOpticsRayKernel = {
	readonly direction: Vec2;
	readonly bridgeSigma: readonly [number, number];
	readonly samples: readonly SourceOpticsRayKernelSample[];
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * Compiles one authored ray into a deterministic sampled directional kernel.
 * Offsets stay collinear with the exact authored vector; normalized weights keep
 * total energy stable when the bounded sample count changes in a future version.
 */
export function compileSourceOpticsRayKernel(
	ray: Pick<
		SourceOpticsRayContract,
		"angle" | "length" | "width" | "falloff" | "oppositeSideRatio"
	>,
): SourceOpticsRayKernel {
	const radians = (ray.angle * Math.PI) / 180;
	const direction = { x: Math.cos(radians), y: Math.sin(radians) };
	const length = Math.max(0, ray.length);
	const width = Math.max(0.1, ray.width);
	const falloffExponent = 0.45 + clamp01(ray.falloff) * 3.55;
	const oppositeSideRatio = clamp01(ray.oppositeSideRatio);
	const weighted: SourceOpticsRayKernelSample[] = [
		{ offset: { x: 0, y: 0 }, weight: 1 },
	];
	for (
		let index = 1;
		index <= SOURCE_OPTICS_RAY_SIDE_SAMPLE_COUNT;
		index += 1
	) {
		const progress = index / SOURCE_OPTICS_RAY_SIDE_SAMPLE_COUNT;
		const distance = length * progress;
		const envelope = Math.max(0.015, (1 - progress) ** falloffExponent);
		weighted.push({
			offset: {
				x: direction.x * distance,
				y: direction.y * distance,
			},
			weight: envelope,
		});
		if (oppositeSideRatio > 0) {
			weighted.push({
				offset: {
					x: -direction.x * distance,
					y: -direction.y * distance,
				},
				weight: envelope * oppositeSideRatio,
			});
		}
	}
	const totalWeight = weighted.reduce(
		(total, sample) => total + sample.weight,
		0,
	);
	const step = length / SOURCE_OPTICS_RAY_SIDE_SAMPLE_COUNT;
	const bridgeAlong = Math.max(0.1, step * 0.42);
	const bridgeAcross = Math.max(0.1, width / 3);
	return {
		direction,
		bridgeSigma: [
			Math.max(
				0.1,
				Math.abs(direction.x) * bridgeAlong +
					Math.abs(direction.y) * bridgeAcross,
			),
			Math.max(
				0.1,
				Math.abs(direction.y) * bridgeAlong +
					Math.abs(direction.x) * bridgeAcross,
			),
		],
		samples: weighted.map((sample) => ({
			...sample,
			weight: sample.weight / Math.max(totalWeight, 1e-6),
		})),
	};
}
