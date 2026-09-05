import { readLocalStorageTextSync } from "@/shared/lib/persistence";

/**
 * Experimental WebGPU canvas strangler (E1). See
 * `docs/gpu-canvas-convergence-e1-plan.md` (D9) for the decided rollout — this
 * flag gates the entire GPU canvas surface behind an explicit opt-in so the
 * default editor experience (SVG-only) never changes. There is no settings UI
 * yet; enabling is a URL query param or a persisted localStorage value.
 */
export const GPU_CANVAS_STORAGE_KEY = "vma:gpu-canvas";

const GPU_CANVAS_QUERY_PARAM = "gpuCanvas";
const GPU_CANVAS_ENABLED_VALUE = "1";

/**
 * Whether the experimental GPU canvas should mount. Checked once per
 * `CanvasShell` mount (never per-render), so toggling the URL or storage mid-
 * session requires a reload — consistent with other one-shot editor flags.
 * Returns `false` outside a browser (SSR/build-time evaluation, tests).
 */
export function isGpuCanvasEnabled(): boolean {
	if (typeof window === "undefined") return false;
	const params = new URLSearchParams(window.location.search);
	if (params.get(GPU_CANVAS_QUERY_PARAM) === GPU_CANVAS_ENABLED_VALUE) {
		return true;
	}
	return (
		readLocalStorageTextSync({ key: GPU_CANVAS_STORAGE_KEY }) ===
		GPU_CANVAS_ENABLED_VALUE
	);
}

/**
 * Experimental GPU/SVG parity diff mode (E1 S4 — see
 * `docs/gpu-canvas-convergence-e1-plan.md` D7 verification tooling). Only
 * meaningful when {@link isGpuCanvasEnabled} is also true — this flag never
 * mounts the GPU surface by itself. When on, `CanvasShell` stops suppressing
 * SVG content for GPU-active artboards (so both renderers draw the same
 * pixels) and `GpuSceneCanvas` applies `mix-blend-mode: difference` to its
 * `<canvas>` element, so identical output composites to black and any
 * mismatch glows — a dev parity tool, not a product feature.
 */
export const GPU_CANVAS_DIFF_STORAGE_KEY = "vma:gpu-canvas-diff";

const GPU_CANVAS_DIFF_QUERY_PARAM = "gpuDiff";

/**
 * Whether the GPU/SVG diff overlay should be active. Checked once per
 * `CanvasShell` mount, same one-shot contract as {@link isGpuCanvasEnabled}.
 */
export function isGpuDiffEnabled(): boolean {
	if (typeof window === "undefined") return false;
	const params = new URLSearchParams(window.location.search);
	if (params.get(GPU_CANVAS_DIFF_QUERY_PARAM) === GPU_CANVAS_ENABLED_VALUE) {
		return true;
	}
	return (
		readLocalStorageTextSync({ key: GPU_CANVAS_DIFF_STORAGE_KEY }) ===
		GPU_CANVAS_ENABLED_VALUE
	);
}

/**
 * Experimental GPU frame-cost HUD (E1 S4 — see
 * `docs/gpu-canvas-convergence-e1-plan.md` D7 verification tooling). Only
 * meaningful when {@link isGpuCanvasEnabled} is also true. Shows rolling
 * compile/draw timings and draw counts for the last frames rendered by
 * `GpuSceneCanvas` — annotates existing draws, never drives its own loop.
 */
export const GPU_CANVAS_HUD_STORAGE_KEY = "vma:gpu-canvas-hud";

const GPU_CANVAS_HUD_QUERY_PARAM = "gpuHud";

/**
 * Whether the GPU frame-cost HUD should render. Checked once per
 * `CanvasShell`/`GpuSceneCanvas` mount, same one-shot contract as
 * {@link isGpuCanvasEnabled}.
 */
export function isGpuHudEnabled(): boolean {
	if (typeof window === "undefined") return false;
	const params = new URLSearchParams(window.location.search);
	if (params.get(GPU_CANVAS_HUD_QUERY_PARAM) === GPU_CANVAS_ENABLED_VALUE) {
		return true;
	}
	return (
		readLocalStorageTextSync({ key: GPU_CANVAS_HUD_STORAGE_KEY }) ===
		GPU_CANVAS_ENABLED_VALUE
	);
}
