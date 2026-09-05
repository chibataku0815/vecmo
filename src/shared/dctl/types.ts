/**
 * One `DEFINE_UI_PARAMS` declaration. DaVinci Resolve's DCTL preprocessor
 * expects one macro invocation per exposed parameter (not a single call with
 * a parameter list), so each variant here maps to exactly one emitted line —
 * see {@link import("./builder").createDctlSourceBuilder}.
 */
export type DctlUiParam =
	| {
			readonly kind: "slider-float";
			readonly varName: string;
			readonly label: string;
			readonly default: number;
			readonly min: number;
			readonly max: number;
			readonly step: number;
	  }
	| {
			readonly kind: "slider-int";
			readonly varName: string;
			readonly label: string;
			readonly default: number;
			readonly min: number;
			readonly max: number;
			readonly step: number;
	  }
	| {
			readonly kind: "check-box";
			readonly varName: string;
			readonly label: string;
			readonly default: boolean;
	  }
	| {
			readonly kind: "combo-box";
			readonly varName: string;
			readonly label: string;
			readonly default: number;
			readonly options: readonly string[];
	  };

/** One deduplicated `__DEVICE__` helper function, keyed by `name` for reuse across emitters. */
export type DctlHelperFunction = {
	readonly name: string;
	readonly source: string;
};
