import { sceneSpatialEntries } from "@/entities/scene/model/spatial";
import { resolveNodeStyle } from "@/entities/scene/model/style-resolve";
import type { SceneDocument, VectorNode } from "@/entities/scene/model/types";
import { normalizeHex } from "@/shared/color";
import { RADIX_SCALES } from "@/shared/color/radix-palette";
import { DEFAULT_SHAPE_BUILDER_FILL } from "./store";

/** Origin bucket for a Shape Builder cursor swatch, ordered by workflow priority. */
export type ShapeBuilderSwatchSource = "selection" | "recent" | "radix";

/** Value-copy colour option used by the Shape Builder cursor and options strip. */
export type ShapeBuilderSwatch = {
	readonly id: string;
	readonly color: string;
	readonly label: string;
	readonly source: ShapeBuilderSwatchSource;
};

const FALLBACK_SCALE_NAMES = [
	"tomato",
	"amber",
	"yellow",
	"grass",
	"teal",
	"cyan",
	"blue",
	"indigo",
	"violet",
	"pink",
	"gray",
] as const;

const RADIX_SOLID_STEP_INDEX = 8;
const MAX_PALETTE_SIZE = 28;

const visibleHex = (value: string | undefined): string | null => {
	if (!value) return null;
	const hex = normalizeHex(value);
	if (!hex) return null;
	if (hex === "none" || hex === "transparent") return null;
	return hex;
};

const firstSolidFill = (node: VectorNode): string | null => {
	const style = resolveNodeStyle(node.style);
	for (const paint of style.fills) {
		if (paint.kind !== "solid" || paint.opacity <= 0) continue;
		const color = visibleHex(paint.color);
		if (color) return color;
	}
	return visibleHex(style.fill);
};

const selectedNodesFrontToBack = (
	document: SceneDocument,
	nodeIds: readonly string[],
): readonly VectorNode[] => {
	const selected = new Set(nodeIds);
	if (selected.size === 0) return [];
	return sceneSpatialEntries(document)
		.filter((entry) => selected.has(entry.nodeId))
		.reverse()
		.map((entry) => entry.node);
};

const fallbackSwatches = (): readonly ShapeBuilderSwatch[] =>
	FALLBACK_SCALE_NAMES.flatMap((name) => {
		const scale = RADIX_SCALES.find((entry) => entry.name === name);
		const color = scale?.steps[RADIX_SOLID_STEP_INDEX];
		return color
			? [
					{
						id: `radix:${name}`,
						color,
						label: scale.label,
						source: "radix" as const,
					},
				]
			: [];
	});

const pushUnique = (
	out: ShapeBuilderSwatch[],
	seen: Set<string>,
	swatch: ShapeBuilderSwatch,
): void => {
	const color = visibleHex(swatch.color);
	if (!color || seen.has(color)) return;
	seen.add(color);
	out.push({ ...swatch, color });
};

/**
 * Shape Builder's compact cursor palette. It deliberately value-copies plain
 * sRGB fills first: full document swatches/global colours can plug into this
 * provider later without changing the canvas gesture code.
 */
export function buildShapeBuilderPalette(options: {
	readonly document: SceneDocument;
	readonly nodeIds: readonly string[];
	readonly recents: readonly string[];
}): readonly ShapeBuilderSwatch[] {
	const out: ShapeBuilderSwatch[] = [];
	const seen = new Set<string>();

	for (const node of selectedNodesFrontToBack(
		options.document,
		options.nodeIds,
	)) {
		const color = firstSolidFill(node);
		if (!color) continue;
		pushUnique(out, seen, {
			id: `selection:${node.id}`,
			color,
			label: node.name || "Selected fill",
			source: "selection",
		});
	}

	for (const recent of options.recents) {
		pushUnique(out, seen, {
			id: `recent:${recent}`,
			color: recent,
			label: recent,
			source: "recent",
		});
	}

	for (const swatch of fallbackSwatches()) pushUnique(out, seen, swatch);

	if (out.length === 0) {
		pushUnique(out, seen, {
			id: "fallback:shape-builder",
			color: DEFAULT_SHAPE_BUILDER_FILL,
			label: "Shape Builder fill",
			source: "radix",
		});
	}

	return out.slice(0, MAX_PALETTE_SIZE);
}

/**
 * Resolves the active swatch index for a fill while preserving keyboard cycle
 * position when the active colour is a custom value outside the current palette.
 */
export function swatchIndexForFill(
	palette: readonly ShapeBuilderSwatch[],
	fill: string,
	fallbackIndex: number,
): number {
	const color = visibleHex(fill);
	const index = color
		? palette.findIndex((swatch) => swatch.color === color)
		: -1;
	if (index >= 0) return index;
	if (palette.length === 0) return 0;
	return ((fallbackIndex % palette.length) + palette.length) % palette.length;
}

/** Steps through the Shape Builder palette and returns the fill/index pair to store. */
export function cycleShapeBuilderSwatch(options: {
	readonly palette: readonly ShapeBuilderSwatch[];
	readonly activeFill: string;
	readonly activeSwatchIndex: number;
	readonly direction: -1 | 1;
	readonly step?: number;
}): { readonly fill: string; readonly index: number } {
	const { palette } = options;
	if (palette.length === 0) {
		return { fill: DEFAULT_SHAPE_BUILDER_FILL, index: 0 };
	}
	const current = swatchIndexForFill(
		palette,
		options.activeFill,
		options.activeSwatchIndex,
	);
	const step = Math.max(1, Math.floor(options.step ?? 1));
	const index =
		(current + options.direction * step + palette.length * step) %
		palette.length;
	return { fill: palette[index]?.color ?? DEFAULT_SHAPE_BUILDER_FILL, index };
}
