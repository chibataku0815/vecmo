import type { Icon } from "@phosphor-icons/react";
import {
	Circle,
	LineSegment,
	Polygon,
	Square,
	Star,
} from "@phosphor-icons/react";
import type { ShapeKind } from "@/features/draw/model/shape";
import { SHAPE_TOOL_KINDS } from "@/features/draw/model/shape-tool";

/** Rail-facing chrome for one shape kind in the grouped shape tool flyout. */
export type ShapeToolVariant = {
	readonly kind: ShapeKind;
	readonly label: string;
	readonly Icon: Icon;
};

const SHAPE_VARIANT_CHROME = {
	rect: { label: "Rectangle", Icon: Square },
	ellipse: { label: "Ellipse", Icon: Circle },
	line: { label: "Line", Icon: LineSegment },
	polygon: { label: "Polygon", Icon: Polygon },
	star: { label: "Star", Icon: Star },
} as const satisfies Record<
	ShapeKind,
	{ readonly label: string; readonly Icon: Icon }
>;

/**
 * The shape tool's flyout variants, ordered by {@link SHAPE_TOOL_KINDS} so the
 * on-screen row and the `R` keyboard cycle advance through the shapes in the
 * exact same sequence.
 */
export const SHAPE_TOOL_VARIANTS: readonly ShapeToolVariant[] =
	SHAPE_TOOL_KINDS.map((kind) => ({ kind, ...SHAPE_VARIANT_CHROME[kind] }));

const variantByKind = new Map<ShapeKind, ShapeToolVariant>(
	SHAPE_TOOL_VARIANTS.map((variant) => [variant.kind, variant]),
);

/** Resolves the flyout chrome for the currently selected shape kind. */
export function shapeToolVariant(kind: ShapeKind): ShapeToolVariant {
	const variant = variantByKind.get(kind);
	if (!variant) throw new Error(`Missing shape tool variant for ${kind}`);
	return variant;
}
