import {
	buildStrokeMesh as buildStrokeMeshTypeScript,
	type StrokeMeshOptions,
} from "@/shared/gpu/stroke-mesh";

export type StrokeMeshContour = {
	readonly ring: Float32Array;
	readonly closed: boolean;
};

export type StrokeMeshTransform = {
	readonly a: number;
	readonly b: number;
	readonly c: number;
	readonly d: number;
	readonly e: number;
	readonly f: number;
};

/**
 * Builds a stroke extrusion mesh through the active geometry-kernel seam.
 *
 * The current backend is intentionally the existing TypeScript implementation.
 * This facade exists because stroke-heavy documents can make mesh extrusion a
 * measurable GPU-frame compile cost, while still keeping scene, style, cache,
 * and renderer policy outside any future WASM boundary.
 */
export function buildStrokeMesh(
	contours: readonly StrokeMeshContour[],
	worldTransform: StrokeMeshTransform,
	options: StrokeMeshOptions,
): Float32Array {
	return buildStrokeMeshTypeScript(contours, worldTransform, options);
}

export type { StrokeMeshOptions };
