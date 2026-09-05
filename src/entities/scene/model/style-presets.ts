import { createId } from "@/shared/lib/id";
import {
	applyGraphicStyleToNode,
	captureGraphicStyleFromNode,
	normalizeGraphicStyleAppearance,
} from "./appearance-stack";
import { normalizeTextGeometry, normalizeTextStyle } from "./text-geometry";
import type {
	NodeStyle,
	SceneDocument,
	StylePreset,
	StylePresetAppearance,
	StylePresetKind,
	StylePresetPaint,
	StylePresetTypography,
	TextStyle,
	VectorNode,
} from "./types";

/**
 * Pure style-preset model. This file owns the document-scoped preset library
 * contract (read, create, apply, rename, remove) as side-effect-free helpers so
 * the command bus, future inspector adapters, exporters, and AI bridges all share
 * one normalization seam. Nothing here mutates a live document; commands wrap
 * these helpers to produce undoable Immer patches.
 *
 * Read helpers live here, never in `selectors.ts`, to keep the shared
 * `scene/model` directory free of cross-stream merge collisions.
 */

const clampFinite = (value: number, fallback: number): number =>
	Number.isFinite(value) ? value : fallback;

/** Clamps opacity to the scene paint contract. Matches `createUpdateNodeStyleCommand`. */
export const clampPaintOpacity = (opacity: number): number =>
	Math.min(1, Math.max(0, clampFinite(opacity, 1)));

/** Clamps stroke width to non-negative. Matches `createUpdateNodeStyleCommand`. */
export const clampPaintStrokeWidth = (value: number): number =>
	Math.max(0, clampFinite(value, 0));

const normalizedLabel = (value: string): string | null => {
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
};

const PRESET_KINDS: readonly StylePresetKind[] = ["node", "text"];

const isPresetKind = (value: unknown): value is StylePresetKind =>
	PRESET_KINDS.includes(value as StylePresetKind);

/**
 * Normalizes a paint payload to only the supported, clamped fields. Returns null
 * when the payload contributes nothing so callers can avoid empty presets.
 */
export function normalizeStylePresetPaint(
	paint: StylePresetPaint | undefined,
): StylePresetPaint | null {
	if (!paint) return null;
	const next: { -readonly [K in keyof StylePresetPaint]: StylePresetPaint[K] } =
		{};
	if (typeof paint.fill === "string") next.fill = paint.fill;
	if (typeof paint.stroke === "string") next.stroke = paint.stroke;
	if (
		typeof paint.strokeWidth === "number" &&
		Number.isFinite(paint.strokeWidth)
	) {
		next.strokeWidth = clampPaintStrokeWidth(paint.strokeWidth);
	}
	if (typeof paint.opacity === "number" && Number.isFinite(paint.opacity)) {
		next.opacity = clampPaintOpacity(paint.opacity);
	}
	return Object.keys(next).length > 0 ? next : null;
}

/**
 * Normalizes a typography payload, dropping unknown keys and non-finite numbers.
 * Returns null when nothing survives so type-only presets stay minimal.
 */
export function normalizeStylePresetTypography(
	typography: StylePresetTypography | undefined,
): StylePresetTypography | null {
	if (!typography) return null;
	const next: {
		-readonly [K in keyof StylePresetTypography]: StylePresetTypography[K];
	} = {};
	if (typeof typography.fontFamily === "string") {
		const fontFamily = normalizedLabel(typography.fontFamily);
		if (fontFamily) next.fontFamily = fontFamily;
	}
	if (typeof typography.align === "string") next.align = typography.align;
	if (typeof typography.fontSize === "number" && typography.fontSize > 0) {
		next.fontSize = typography.fontSize;
	}
	if (typeof typography.lineHeight === "number" && typography.lineHeight > 0) {
		next.lineHeight = typography.lineHeight;
	}
	if (typeof typography.fontWeight === "number" && typography.fontWeight > 0) {
		next.fontWeight = Math.round(typography.fontWeight);
	}
	return Object.keys(next).length > 0 ? next : null;
}

/**
 * Reads the document preset library as a normalized array. Legacy documents that
 * omit `stylePresets` read as empty, and malformed entries (blank name/id,
 * unknown kind, no payload) are dropped so downstream readers never branch on
 * partially valid presets.
 */
export function readStylePresets(
	document: Pick<SceneDocument, "stylePresets">,
): readonly StylePreset[] {
	const presets = document.stylePresets;
	if (!presets || presets.length === 0) return [];
	const seenIds = new Set<string>();
	const result: StylePreset[] = [];
	for (const preset of presets) {
		const normalized = normalizeStylePreset(preset);
		if (!normalized || seenIds.has(normalized.id)) continue;
		seenIds.add(normalized.id);
		result.push(normalized);
	}
	return result;
}

/**
 * Normalizes a single preset record. Returns null when the preset carries no
 * usable payload or has a blank id/name, so the library never stores no-op presets.
 */
export function normalizeStylePreset(
	preset: StylePreset | undefined,
): StylePreset | null {
	if (!preset) return null;
	const id = normalizedLabel(preset.id);
	const name = normalizedLabel(preset.name);
	if (!id || !name) return null;
	const kind = isPresetKind(preset.kind) ? preset.kind : "node";
	const paint = normalizeStylePresetPaint(preset.paint);
	const typography = normalizeStylePresetTypography(preset.typography);
	const appearance = preset.appearance
		? normalizeGraphicStyleAppearance(preset.appearance)
		: null;
	if (!paint && !typography && !appearance) return null;
	return {
		id,
		name,
		kind,
		...(paint ? { paint } : {}),
		...(typography ? { typography } : {}),
		...(appearance ? { appearance } : {}),
	};
}

/** Finds a preset by id from the normalized library, or undefined. */
export function findStylePreset(
	document: Pick<SceneDocument, "stylePresets">,
	presetId: string | null | undefined,
): StylePreset | undefined {
	if (!presetId) return undefined;
	return readStylePresets(document).find((preset) => preset.id === presetId);
}

const uniqueLabel = (
	existing: ReadonlySet<string>,
	base: string,
	separator: string,
): string => {
	if (!existing.has(base)) return base;
	let suffix = 2;
	let candidate = `${base}${separator}${suffix}`;
	while (existing.has(candidate)) {
		suffix += 1;
		candidate = `${base}${separator}${suffix}`;
	}
	return candidate;
};

/**
 * Options for minting a new preset. The id and name are deterministic bases that
 * still receive suffixes when they would collide with the existing library.
 */
export type CreateStylePresetOptions = {
	readonly id?: string;
	readonly name?: string;
	readonly kind?: StylePresetKind;
	readonly paint?: StylePresetPaint;
	readonly typography?: StylePresetTypography;
	readonly appearance?: StylePresetAppearance;
};

/**
 * Mints a normalized, collision-free preset against an existing library. Returns
 * null when the requested payload normalizes to nothing, so the caller never adds
 * an empty preset to the document. The factory lives here (not `factory.ts`) to
 * keep shared scene files free of cross-stream edits.
 */
export function createStylePreset(
	existingPresets: readonly StylePreset[],
	options: CreateStylePresetOptions = {},
): StylePreset | null {
	const paint = normalizeStylePresetPaint(options.paint);
	const typography = normalizeStylePresetTypography(options.typography);
	const appearance = options.appearance
		? normalizeGraphicStyleAppearance(options.appearance)
		: null;
	if (!paint && !typography && !appearance) return null;

	const kind =
		options.kind && isPresetKind(options.kind)
			? options.kind
			: typography
				? "text"
				: "node";
	const existingIds = new Set(existingPresets.map((preset) => preset.id));
	const existingNames = new Set(existingPresets.map((preset) => preset.name));
	const idBase = normalizedLabel(options.id ?? "") ?? createId("preset");
	const id = uniqueLabel(existingIds, idBase, "-");
	const nameBase =
		normalizedLabel(options.name ?? "") ??
		(kind === "text" ? "Text style" : "Style");
	const name = uniqueLabel(existingNames, nameBase, " ");

	return {
		id,
		name,
		kind,
		...(paint ? { paint } : {}),
		...(typography ? { typography } : {}),
		...(appearance ? { appearance } : {}),
	};
}

/**
 * Captures a preset payload from a node's current appearance. Text nodes also
 * capture typography (and keep their fill as paint) so a single text preset can
 * reproduce both color and type. Returns options ready for `createStylePreset`.
 */
export function captureStylePresetFromNode(
	node: VectorNode,
): CreateStylePresetOptions {
	const paint: StylePresetPaint = {
		fill: node.style.fill,
		stroke: node.style.stroke,
		strokeWidth: node.style.strokeWidth,
		opacity: node.style.opacity,
	};
	// The rich appearance (fill/stroke stacks, effects, blend, stroke geometry) is
	// captured alongside the legacy paint part so reapplying reproduces a
	// visual-equivalent stack; null for pure-legacy nodes (paint part suffices).
	const appearance = captureGraphicStyleFromNode(node) ?? undefined;
	if (node.geometry.kind === "text") {
		const typography = normalizeTextGeometry(node.geometry).style;
		return {
			kind: "text",
			name: `${node.name} style`,
			paint,
			typography,
			...(appearance ? { appearance } : {}),
		};
	}
	return {
		kind: "node",
		name: `${node.name} style`,
		paint,
		...(appearance ? { appearance } : {}),
	};
}

/**
 * Applies a preset's paint part onto an existing node style, returning a new
 * style object. Clamping matches the scene paint command so applying a preset is
 * value-identical to editing the same fields directly. Returns the input
 * reference unchanged when the preset has no paint part.
 */
export function applyStylePresetPaint(
	style: NodeStyle,
	preset: StylePreset,
): NodeStyle {
	const paint = preset.paint;
	if (!paint) return style;
	return {
		...style,
		...(paint.fill !== undefined ? { fill: paint.fill } : {}),
		...(paint.stroke !== undefined ? { stroke: paint.stroke } : {}),
		...(paint.strokeWidth !== undefined
			? { strokeWidth: clampPaintStrokeWidth(paint.strokeWidth) }
			: {}),
		...(paint.opacity !== undefined
			? { opacity: clampPaintOpacity(paint.opacity) }
			: {}),
	};
}

/**
 * Merges a preset's typography part over an existing (already normalized) text
 * style. Returns a new fully-populated `TextStyle`; callers should normalize the
 * result through the text geometry helper before persisting bounds.
 */
export function applyStylePresetTypography(
	style: TextStyle,
	preset: StylePreset,
): TextStyle {
	const typography = preset.typography;
	if (!typography) return style;
	return normalizeTextStyle({ ...style, ...typography });
}

/**
 * Applies a preset's rich appearance part (fill/stroke stacks, effects, blend,
 * stroke geometry) onto a node style, returning a new style — or the input
 * reference when the preset carries no appearance part. Value-copy, like the other
 * apply helpers; the command path additionally re-clamps through the node-style command.
 */
export function applyStylePresetAppearance(
	style: NodeStyle,
	preset: StylePreset,
): NodeStyle {
	const appearance = preset.appearance;
	if (!appearance) return style;
	return applyGraphicStyleToNode(style, appearance);
}
