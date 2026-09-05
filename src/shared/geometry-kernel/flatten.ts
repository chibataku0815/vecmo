import type { AeShape } from "@/shared/glammer/ae-shape";
import {
	type FlattenMatrix2D,
	fanTriangulateRings as fanTriangulateRingsTypeScript,
	flattenContoursToRings as flattenContoursToRingsTypeScript,
} from "@/shared/gpu/flatten";

export type GeometryKernelBackend = "typescript";

/**
 * Active geometry-kernel backend for the GPU frame compiler.
 *
 * This deliberately starts as a zero-behavior-change TypeScript facade. A
 * future Rust/WASM implementation can sit behind this module only if profiling
 * proves that flatten/fan work is hot enough and the boundary cost is lower
 * than the saved JavaScript work.
 */
export const ACTIVE_GEOMETRY_KERNEL_BACKEND: GeometryKernelBackend =
	"typescript";

/**
 * Flattens scene-agnostic AE contours through the active geometry kernel.
 *
 * Callers keep ownership of cache invalidation and tolerance selection. The
 * facade's contract is intentionally narrow so no scene document, renderer
 * policy, command history, or React state crosses a future WASM boundary.
 */
export function flattenContoursToRings(
	contours: readonly AeShape[],
	tolerance: number,
): readonly Float32Array[] {
	return flattenContoursToRingsTypeScript(contours, tolerance);
}

/**
 * Fans already-flattened rings into world-space stencil triangles through the
 * active geometry kernel.
 *
 * The output format matches `shared/gpu/flatten` exactly: an interleaved
 * `Float32Array` of triangle vertices that WebGPU consumes without scene-model
 * knowledge.
 */
export function fanTriangulateRings(
	rings: readonly Float32Array[],
	worldTransform: FlattenMatrix2D,
): Float32Array {
	return fanTriangulateRingsTypeScript(rings, worldTransform);
}

export type { FlattenMatrix2D };
