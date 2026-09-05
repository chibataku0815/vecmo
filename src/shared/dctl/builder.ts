import { dctlFloat, dctlInt } from "./numeric";
import type { DctlHelperFunction, DctlUiParam } from "./types";

const formatUiParamLine = (param: DctlUiParam): string => {
	switch (param.kind) {
		case "slider-float":
			return `DEFINE_UI_PARAMS(${param.varName}, ${param.label}, DCTLUI_SLIDER_FLOAT, ${dctlFloat(
				param.default,
			)}, ${dctlFloat(param.min)}, ${dctlFloat(param.max)}, ${dctlFloat(param.step)})`;
		case "slider-int":
			return `DEFINE_UI_PARAMS(${param.varName}, ${param.label}, DCTLUI_SLIDER_INT, ${dctlInt(
				param.default,
			)}, ${dctlInt(param.min)}, ${dctlInt(param.max)}, ${dctlInt(param.step)})`;
		case "check-box":
			return `DEFINE_UI_PARAMS(${param.varName}, ${param.label}, DCTLUI_CHECK_BOX, ${
				param.default ? 1 : 0
			})`;
		case "combo-box":
			return `DEFINE_UI_PARAMS(${param.varName}, ${param.label}, DCTLUI_COMBO_BOX, ${dctlInt(
				param.default,
			)}, {${param.options.map((_, index) => index).join(", ")}}, {${param.options
				.map((option) => `"${option}"`)
				.join(", ")}})`;
	}
};

const uiParamsEqual = (a: DctlUiParam, b: DctlUiParam): boolean =>
	JSON.stringify(a) === JSON.stringify(b);

/**
 * Practical per-control-type budget for `DEFINE_UI_PARAMS` in a single DCTL
 * file: DaVinci Resolve's DCTL preprocessor supports up to 64 UI controls of
 * each type (float slider, int slider, check box, combo box). Only the
 * optional "expose all numeric parameters" path
 * ({@link import("../../features/export/model/look-dctl/params").exposableNumber})
 * checks against this via {@link DctlSourceBuilder.tryDeclareUiParam} — hero
 * params (`declareUiParam`) always succeed, since they are a curated,
 * bounded-by-construction set.
 */
export const DCTL_UI_PARAM_TYPE_LIMIT = 64;

/**
 * Target-agnostic DCTL source assembler: a registry of deduplicated
 * `__DEVICE__` helper functions plus `DEFINE_UI_PARAMS` declarations, and
 * final assembly into one complete `.dctl` source string. Two callers
 * registering the same helper/param name with an identical definition is a
 * no-op (expected — several Look Graph nodes can share a math helper);
 * registering the same name with a *different* definition throws, since that
 * would silently pick one caller's semantics over another's.
 */
export type DctlSourceBuilder = {
	/** Registers (or reuses) a UI-exposed slider/checkbox/combo; returns its `varName` for convenience chaining. Never fails — for curated hero params only. */
	readonly declareUiParam: (param: DctlUiParam) => string;
	/**
	 * Same contract as {@link declareUiParam}, but returns `null` instead of
	 * registering a genuinely new param once {@link DCTL_UI_PARAM_TYPE_LIMIT}
	 * controls of that `kind` are already declared (across both this method
	 * and `declareUiParam`) — callers should fall back to a baked constant.
	 * Re-declaring an already-registered `varName` with identical
	 * configuration still succeeds regardless of the count.
	 */
	readonly tryDeclareUiParam: (param: DctlUiParam) => string | null;
	/** Registers (or reuses) a shared `__DEVICE__` helper function by name. */
	readonly addHelper: (helper: DctlHelperFunction) => void;
	/**
	 * Assembles the final `.dctl` text: header comment, `DEFINE_UI_PARAMS`
	 * block, helper functions (registration order), then the caller-supplied
	 * body sections (typically the closure-chain node functions and the
	 * `transform()` entry point) in the given order.
	 */
	readonly build: (options: {
		readonly headerComment: string;
		readonly bodySections: readonly string[];
	}) => string;
};

export function createDctlSourceBuilder(): DctlSourceBuilder {
	const uiParams = new Map<string, DctlUiParam>();
	const helpers = new Map<string, string>();
	const countByKind: Record<DctlUiParam["kind"], number> = {
		"slider-float": 0,
		"slider-int": 0,
		"check-box": 0,
		"combo-box": 0,
	};

	const registerParam = (param: DctlUiParam): void => {
		uiParams.set(param.varName, param);
		countByKind[param.kind] += 1;
	};

	return {
		declareUiParam(param) {
			const existing = uiParams.get(param.varName);
			if (existing && !uiParamsEqual(existing, param)) {
				throw new Error(
					`DCTL UI param "${param.varName}" was declared twice with different configuration.`,
				);
			}
			if (!existing) registerParam(param);
			return param.varName;
		},
		tryDeclareUiParam(param) {
			const existing = uiParams.get(param.varName);
			if (existing) {
				if (!uiParamsEqual(existing, param)) {
					throw new Error(
						`DCTL UI param "${param.varName}" was declared twice with different configuration.`,
					);
				}
				return param.varName;
			}
			if (countByKind[param.kind] >= DCTL_UI_PARAM_TYPE_LIMIT) return null;
			registerParam(param);
			return param.varName;
		},
		addHelper(helper) {
			const existing = helpers.get(helper.name);
			if (existing !== undefined && existing !== helper.source) {
				throw new Error(
					`DCTL helper function "${helper.name}" was declared twice with different bodies.`,
				);
			}
			if (existing === undefined) helpers.set(helper.name, helper.source);
		},
		build({ headerComment, bodySections }) {
			const sections: string[] = [headerComment];
			if (uiParams.size > 0) {
				sections.push([...uiParams.values()].map(formatUiParamLine).join("\n"));
			}
			if (helpers.size > 0) {
				sections.push([...helpers.values()].join("\n\n"));
			}
			sections.push(...bodySections);
			return `${sections.join("\n\n")}\n`;
		},
	};
}
