/**
 * Target-agnostic DCTL (DaVinci Resolve color transform language) codegen
 * primitives: a deduplicated helper-function / `DEFINE_UI_PARAMS` registry and
 * source assembler, plus numeric/identifier formatting. Pure string/number
 * math only — no entity or feature imports, so this stays a leaf `shared`
 * module. Look Graph-specific lowering (which node kinds map to which DCTL,
 * fidelity reporting) lives in `features/export/model/look-dctl`.
 */

export {
	createDctlSourceBuilder,
	DCTL_UI_PARAM_TYPE_LIMIT,
	type DctlSourceBuilder,
} from "./builder";
export {
	dctlFloat,
	dctlFloat3,
	dctlFloat3FromHex,
	dctlIdentifierSegment,
	dctlInt,
} from "./numeric";
export type { DctlHelperFunction, DctlUiParam } from "./types";
