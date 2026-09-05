export type ModifierState = {
	readonly constrain: boolean;
	readonly fromCenter: boolean;
	readonly breakHandleSymmetry: boolean;
	readonly additiveSelection: boolean;
	readonly pan: boolean;
};

/**
 * Normalizes keyboard modifiers for editor tools. Shift constrains geometry,
 * Alt edits from center and breaks Bezier symmetry, Shift also owns additive
 * selection unless a feature overrides it at a higher level.
 */
export function modifierStateFromEvent(event: {
	readonly shiftKey: boolean;
	readonly altKey: boolean;
	readonly metaKey: boolean;
	readonly ctrlKey: boolean;
	readonly code?: string;
}): ModifierState {
	return {
		constrain: event.shiftKey,
		fromCenter: event.altKey,
		breakHandleSymmetry: event.altKey,
		additiveSelection: event.shiftKey,
		pan: event.code === "Space" || event.metaKey || event.ctrlKey,
	};
}
