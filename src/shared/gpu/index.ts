/**
 * Public entry point for the WebGPU RHI-lite. This is the module boundary the
 * `gpuCanvas`-flag glue reaches via a dynamic `import("@/shared/gpu")` — never
 * a static import — so the WebGPU device/pipeline code lands in its own
 * Rollup chunk instead of the app's eager entry chunk (`bun run build && bun
 * run check:bundle` verifies this per slice; see
 * `docs/gpu-canvas-convergence-e1-plan.md` D3).
 */

export {
	fanTriangulateRings,
	flattenAeShapeToRing,
	flattenContoursToRings,
} from "./flatten";
export {
	createGpuResourceCachePolicy,
	type GpuLiveResourceKeyInput,
	type GpuResourceCachePolicy,
	type GpuSourceArtifactDescriptor,
	type GpuSourceArtifactKind,
} from "./resource-cache";
export type {
	StrokeCapStyle,
	StrokeJoinStyle,
	StrokeMeshOptions,
} from "./stroke-mesh";
export { buildStrokeMesh, STROKE_VERTEX_FLOAT_COUNT } from "./stroke-mesh";
export type {
	GpuArtboardContent,
	GpuArtboardDraw,
	GpuArtboardPostEffect,
	GpuCamera,
	GpuCanvasStatus,
	GpuCanvasSurface,
	GpuColor,
	GpuEffectIslandBegin,
	GpuEffectIslandEnd,
	GpuFillDraw,
	GpuFrameSpec,
	GpuGradientStop,
	GpuLocalPoint,
	GpuMatrix2D,
	GpuNodeEffect,
	GpuPaint,
	GpuQuad,
	GpuRadianceFieldEffect,
	GpuStrokeDraw,
	GpuStrokePaint,
	GpuSurfaceConfig,
	GpuSurfaceResponseFieldEffect,
	GpuWorldRect,
} from "./types";
export { MAX_GRADIENT_STOPS } from "./types";
export { createGpuCanvasSurface, MAX_BACKING_DPR } from "./webgpu";
