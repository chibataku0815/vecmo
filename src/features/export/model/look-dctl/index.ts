/**
 * Look Graph -> DCTL exporter (S1 pointwise pilot + S2 uv-remap fusion).
 * Lowers the compiled Look Graph IR (`entities/scene/model/look-graph-compile`)
 * into a DaVinci Resolve `.dctl` closure chain via `shared/dctl`'s
 * target-agnostic builder. `exportLookAsDctl` is the public entry; everything
 * else in this folder is lowering internals.
 */

export type {
	LookDctlExportAsset,
	LookDctlExportOptions,
	LookDctlExportResult,
} from "./export";
export { exportLookAsDctl } from "./export";
export type { LookDctlFidelity, LookDctlReport } from "./types";
