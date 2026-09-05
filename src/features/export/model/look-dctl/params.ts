import { dctlFloat, dctlIdentifierSegment, dctlInt } from "@/shared/dctl";
import type { LookDctlChainContext } from "./types";

/**
 * One numeric payload field eligible for the "expose all numeric parameters"
 * export option. `key` is a stable `"kind.field"` dotted path (mirroring
 * `features/look-authoring/model/look-graph-editor.ts`'s `sliderSpec` key
 * convention, though this module does not import that feature — reusing the
 * naming convention only) that combines with the node's index to mint a
 * unique `DEFINE_UI_PARAMS` variable name. `min`/`max`/`step` are display-only
 * UI bounds (the payload's own `normalizePayload()` clamp is the durable
 * source of truth; Resolve does not re-validate slider bounds against it).
 */
export type LookDctlExposableField = {
	readonly key: string;
	readonly label: string;
	readonly value: number;
	readonly min: number;
	readonly max: number;
	readonly step: number;
	readonly kind?: "float" | "int";
};

/**
 * Returns either a baked DCTL literal (default — matches every emitter's
 * pre-S5 behavior) or a live `DEFINE_UI_PARAMS` slider variable name for one
 * numeric payload field, depending on {@link LookDctlChainContext.exposeAllParams}.
 * Both return shapes are valid inline DCTL operand expressions, so callers
 * can drop the result directly into the same template position a
 * `dctlFloat`/`dctlInt` call used to occupy — no surrounding restructuring
 * needed for fields that are already plain runtime operands.
 *
 * Falls back to a baked literal (never throws, never returns a value that
 * would break codegen) when {@link import("@/shared/dctl").DCTL_UI_PARAM_TYPE_LIMIT}
 * is already spent for this control kind by hero params plus earlier
 * exposed fields in the same export — an "expose all" export on a very large
 * graph still always produces a loadable `.dctl`, just with some fields
 * silently staying baked past the 64-per-type budget.
 */
export function exposableNumber(
	ctx: LookDctlChainContext,
	field: LookDctlExposableField,
): string {
	const kind = field.kind ?? "float";
	if (!ctx.exposeAllParams) {
		return kind === "int" ? dctlInt(field.value) : dctlFloat(field.value);
	}
	const varName = `p_${dctlIdentifierSegment(field.key)}_${ctx.nodeIndex}`;
	const declared = ctx.builder.tryDeclareUiParam(
		kind === "int"
			? {
					kind: "slider-int",
					varName,
					label: field.label,
					default: Math.round(field.value),
					min: Math.round(field.min),
					max: Math.round(field.max),
					step: Math.max(1, Math.round(field.step)),
				}
			: {
					kind: "slider-float",
					varName,
					label: field.label,
					default: field.value,
					min: field.min,
					max: field.max,
					step: field.step,
				},
	);
	return (
		declared ?? (kind === "int" ? dctlInt(field.value) : dctlFloat(field.value))
	);
}
