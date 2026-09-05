import type { ShapeKind } from "./shape";

/**
 * Ordered shape kinds the single shape tool authors, and the order the `R`
 * shortcut cycles through. This is the one place the sequence is declared;
 * the ToolRail flyout derives its variant order from it, so the on-screen
 * grouping and the keyboard cycle can never drift apart.
 */
export const SHAPE_TOOL_KINDS = [
	"rect",
	"ellipse",
	"line",
	"polygon",
	"star",
] as const satisfies readonly ShapeKind[];

/** Advances to the next shape kind, wrapping star → rect. */
export function nextShapeKind(current: ShapeKind): ShapeKind {
	const index = SHAPE_TOOL_KINDS.indexOf(current);
	// A kind that is somehow off-list restarts the cycle at the first entry
	// rather than returning `undefined`.
	const nextIndex = index < 0 ? 0 : (index + 1) % SHAPE_TOOL_KINDS.length;
	return SHAPE_TOOL_KINDS[nextIndex];
}

/**
 * Resolves the shape kind that pressing the shape shortcut (`R`) should land on.
 * Entering the shape tool from another tool keeps the current/last kind so the
 * rail selection is honored; pressing `R` again while the shape tool is already
 * active advances to the next kind — this is the Figma-style single-key cycle.
 */
export function shapeShortcutTargetKind(
	shapeToolAlreadyActive: boolean,
	current: ShapeKind,
): ShapeKind {
	return shapeToolAlreadyActive ? nextShapeKind(current) : current;
}
