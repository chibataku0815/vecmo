export type GpuSourceArtifactKind =
	| "texture-source"
	| "draw-list-source"
	| "buffer-source";

export type GpuSourceArtifactDescriptor = {
	readonly key: string;
	readonly kind: GpuSourceArtifactKind;
	readonly capabilityVersion: string;
	readonly shaderVersion: string;
	readonly byteLength: number;
};

export type GpuLiveResourceKeyInput = {
	readonly sourceKey: string;
	readonly deviceGeneration: number;
	readonly usage: "texture" | "buffer" | "pipeline";
};

export type GpuResourceCachePolicy = {
	readonly deviceGeneration: number;
	liveResourceKey(
		input: Omit<GpuLiveResourceKeyInput, "deviceGeneration">,
	): string;
	markDeviceLost(): void;
};

/**
 * Separates persistent GPU source artifacts from live `GPUDevice` resources.
 * Callers may persist the source descriptor, but live texture/buffer/pipeline
 * keys always include the current device generation so device-loss recovery
 * cannot accidentally reuse an object from a destroyed device.
 */
export function createGpuResourceCachePolicy(): GpuResourceCachePolicy {
	let deviceGeneration = 0;
	return {
		get deviceGeneration() {
			return deviceGeneration;
		},
		liveResourceKey(input) {
			return ["gpu-live", deviceGeneration, input.usage, input.sourceKey].join(
				":",
			);
		},
		markDeviceLost() {
			deviceGeneration += 1;
		},
	};
}
