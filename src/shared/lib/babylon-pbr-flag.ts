import { readLocalStorageTextSync } from "@/shared/lib/persistence";

/**
 * Flag-gated Babylon PBR/IBL candidate path (P6-A). See
 * `src/shared/babylon/runtime.ts` for the decided rollout — this flag gates
 * neutral-studio image-based lighting and Khronos PBR Neutral tone mapping
 * behind an explicit opt-in so the default (Hemispheric + Directional, no
 * environment) lighting rig never changes. There is no settings UI yet;
 * enabling is a URL query param or a persisted localStorage value, mirroring
 * `isGpuCanvasEnabled` in `gpu-canvas-flag.ts`.
 */
export const BABYLON_PBR_STORAGE_KEY = "vma:babylon-pbr";

const BABYLON_PBR_QUERY_PARAM = "babylonPbr";
const BABYLON_PBR_ENABLED_VALUE = "1";

/**
 * Whether the Babylon PBR/IBL candidate path should be used. Checked once per
 * `createBabylonRuntimeSurface` call (never per-frame), so toggling the URL
 * or storage mid-session requires a fresh surface — consistent with other
 * one-shot editor flags. Returns `false` outside a browser (SSR/build-time
 * evaluation, tests).
 */
export function isBabylonPbrEnabled(): boolean {
	if (typeof window === "undefined") return false;
	const params = new URLSearchParams(window.location.search);
	if (params.get(BABYLON_PBR_QUERY_PARAM) === BABYLON_PBR_ENABLED_VALUE) {
		return true;
	}
	return (
		readLocalStorageTextSync({ key: BABYLON_PBR_STORAGE_KEY }) ===
		BABYLON_PBR_ENABLED_VALUE
	);
}

/**
 * Shadow filtering mode for the P6-B shadow generator inside the same
 * `pbrEnabled` candidate path (`src/shared/babylon/runtime.ts`). This
 * selection only has any effect when the PBR candidate path is on; there is
 * no independent shadow feature flag (see the P6-B plan's design decision 1).
 */
export type BabylonShadowFilterMode = "pcf" | "pcss";

export const BABYLON_SHADOW_STORAGE_KEY = "vma:babylon-shadow";

const BABYLON_SHADOW_QUERY_PARAM = "babylonShadow";
const DEFAULT_BABYLON_SHADOW_FILTER_MODE: BabylonShadowFilterMode = "pcf";

const isBabylonShadowFilterMode = (
	value: string | null,
): value is BabylonShadowFilterMode => value === "pcf" || value === "pcss";

/**
 * Reads the P6-B shadow filtering mode, same query/storage precedence as
 * `isBabylonPbrEnabled`. Invalid or missing values fall back to `"pcf"`.
 * Returns the default outside a browser (SSR/build-time evaluation, tests).
 */
export function getBabylonShadowFilterMode(): BabylonShadowFilterMode {
	if (typeof window === "undefined") {
		return DEFAULT_BABYLON_SHADOW_FILTER_MODE;
	}
	const params = new URLSearchParams(window.location.search);
	const queryValue = params.get(BABYLON_SHADOW_QUERY_PARAM);
	if (isBabylonShadowFilterMode(queryValue)) return queryValue;
	const storedValue = readLocalStorageTextSync({
		key: BABYLON_SHADOW_STORAGE_KEY,
	});
	if (isBabylonShadowFilterMode(storedValue)) return storedValue;
	return DEFAULT_BABYLON_SHADOW_FILTER_MODE;
}
