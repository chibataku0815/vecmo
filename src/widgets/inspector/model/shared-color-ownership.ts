import {
	type ComponentPropStyleColorOwnershipConflictKind,
	componentPropStyleColorOwnershipConflictKind,
} from "@/entities/scene/model/component-props";
import type {
	ComponentPropBindingStyleColor,
	SceneDocument,
} from "@/entities/scene/model/types";

export type InspectorSharedColorOwnershipConflict = {
	readonly kind: ComponentPropStyleColorOwnershipConflictKind;
	readonly reason: string;
};

const CONFLICT_REASONS = {
	"component-override":
		"A component override and a shared color claim this paint role. Reset the override or remove the shared color.",
	"duplicate-color-prop":
		"Multiple shared colors claim this paint address. Remove the duplicate driver.",
	"component-override-and-duplicate-color-prop":
		"A component override and multiple shared colors claim this paint role. Remove the override and duplicate drivers.",
} as const satisfies Record<
	ComponentPropStyleColorOwnershipConflictKind,
	string
>;

/** Maps the entity ownership classification to one consistent Inspector remedy. */
export function sharedColorOwnershipConflictForInspector(
	document: SceneDocument,
	binding: ComponentPropBindingStyleColor,
	excludePropId?: string,
): InspectorSharedColorOwnershipConflict | null {
	const kind = componentPropStyleColorOwnershipConflictKind(
		document,
		binding,
		excludePropId,
	);
	return kind ? { kind, reason: CONFLICT_REASONS[kind] } : null;
}
