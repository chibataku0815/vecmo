import { DEFAULT_BLEND_MODE } from "./style-resolve";
import type {
	BlendMode,
	Effect,
	NodeStyle,
	Paint,
	StrokeAlign,
	StrokeCap,
	StrokeJoin,
	StylePresetAppearance,
	VectorNode,
} from "./types";

/**
 * Renderer-neutral appearance-stack read/patch model. A node's appearance is an
 * ordered stack of fills, strokes and effects (plus the singleton opacity and
 * blend-mode roles). `NodeStyle` stays the persisted contract; this module only
 * adds read helpers (source → display items) and pure patch helpers
 * (style + patch → new style) so the inspector, command bus, and AI bridges share
 * one normalization seam without a second persisted appearance object.
 *
 * Item identity is DERIVED from role + index for the UI; it is never written back
 * into the scene. Indices address the SOURCE arrays (including paints flagged
 * `visible: false`, which the resolver drops from render but the stack keeps), so
 * an edit planned against a read item maps straight onto `NodeStyle`.
 */

/** Stack roles that are ordered, reorderable lists of items. */
export type AppearanceListRole = "fill" | "stroke" | "effect";

/**
 * Every appearance role. `opacity` and `blend` are singleton display/edit roles,
 * not list items: they cannot be added, removed, reordered, or toggled, and the
 * patch normalizer rejects those operations against them.
 */
export type AppearanceRole = AppearanceListRole | "opacity" | "blend";

export type AppearanceItemVisibility = "visible" | "hidden";

/** One fill or stroke entry resolved for display, carrying its source paint. */
export type AppearancePaintItem = {
	readonly id: string;
	readonly role: "fill" | "stroke";
	readonly index: number;
	readonly paint: Paint;
	readonly visibility: AppearanceItemVisibility;
	/**
	 * True when the item is synthesized from the legacy flat `fill`/`stroke` color
	 * because the node has no rich paint list yet. Editing it materializes the list.
	 */
	readonly legacy: boolean;
};

/** One effect entry resolved for display, carrying its source effect. */
export type AppearanceEffectItem = {
	readonly id: string;
	readonly role: "effect";
	readonly index: number;
	readonly effect: Effect;
	readonly visibility: AppearanceItemVisibility;
};

export type AppearanceItem = AppearancePaintItem | AppearanceEffectItem;

/**
 * Ordered appearance of a node. Each list is in persisted order (index 0 = the
 * stack's leading/primary item, which renders on top — see the render adapters).
 */
export type AppearanceStack = {
	readonly fills: readonly AppearancePaintItem[];
	readonly strokes: readonly AppearancePaintItem[];
	readonly effects: readonly AppearanceEffectItem[];
	readonly opacity: number;
	readonly blendMode: BlendMode;
};

/**
 * One undoable appearance edit, expressed against a node's source style. Patches
 * are renderer-neutral; {@link applyAppearanceStackPatch} turns one into a new
 * `NodeStyle`, and A2 commands wrap that for the undo bus.
 */
export type AppearancePatch =
	| {
			readonly op: "add";
			readonly role: "fill" | "stroke";
			readonly paint: Paint;
			/** Insertion index; appended to the end when omitted or out of range. */
			readonly index?: number;
	  }
	| {
			readonly op: "add-effect";
			readonly effect: Effect;
			readonly index?: number;
	  }
	| {
			readonly op: "update";
			readonly role: "fill" | "stroke";
			readonly index: number;
			readonly paint: Paint;
	  }
	| {
			readonly op: "update-effect";
			readonly index: number;
			readonly effect: Effect;
	  }
	| {
			readonly op: "reorder";
			readonly role: AppearanceListRole;
			readonly from: number;
			readonly to: number;
	  }
	| {
			readonly op: "remove";
			readonly role: AppearanceListRole;
			readonly index: number;
	  }
	| {
			readonly op: "set-visibility";
			readonly role: AppearanceListRole;
			readonly index: number;
			readonly visible: boolean;
	  }
	| {
			readonly op: "set-opacity";
			readonly opacity: number;
	  }
	| {
			readonly op: "set-blend-mode";
			readonly blendMode: BlendMode;
	  };

const PAINT_KINDS: readonly Paint["kind"][] = [
	"solid",
	"linear-gradient",
	"radial-gradient",
	"image-reference",
	"mesh-gradient",
];

const EFFECT_KINDS: readonly Effect["kind"][] = [
	"drop-shadow",
	"inner-shadow",
	"layer-blur",
	"background-blur",
];

const BLEND_MODES: readonly BlendMode[] = [
	"normal",
	"multiply",
	"screen",
	"overlay",
	"darken",
	"lighten",
	"color-dodge",
	"color-burn",
	"hard-light",
	"soft-light",
	"difference",
	"exclusion",
	"hue",
	"saturation",
	"color",
	"luminosity",
];

const LIST_ROLES: readonly AppearanceListRole[] = ["fill", "stroke", "effect"];

const isListRole = (value: unknown): value is AppearanceListRole =>
	LIST_ROLES.includes(value as AppearanceListRole);

const isPaintRole = (value: unknown): value is "fill" | "stroke" =>
	value === "fill" || value === "stroke";

const isIndex = (value: unknown): value is number =>
	typeof value === "number" && Number.isInteger(value) && value >= 0;

const isPaint = (value: unknown): value is Paint =>
	typeof value === "object" &&
	value !== null &&
	PAINT_KINDS.includes((value as Paint).kind);

const isEffect = (value: unknown): value is Effect =>
	typeof value === "object" &&
	value !== null &&
	EFFECT_KINDS.includes((value as Effect).kind);

const isBlendMode = (value: unknown): value is BlendMode =>
	BLEND_MODES.includes(value as BlendMode);

const clampOpacity = (value: number): number => Math.min(1, Math.max(0, value));

/** Builds the derived UI id for a stack item (never persisted). */
export function appearanceItemId(
	role: AppearanceListRole,
	index: number,
): string {
	return `${role}:${index}`;
}

/** Parses a derived stack item id back into role + index, or null when malformed. */
export function parseAppearanceItemId(
	id: string,
): { readonly role: AppearanceListRole; readonly index: number } | null {
	const separator = id.indexOf(":");
	if (separator < 0) return null;
	const role = id.slice(0, separator);
	const index = Number(id.slice(separator + 1));
	if (!isListRole(role) || !isIndex(index)) return null;
	return { role, index };
}

const paintVisibility = (paint: Paint): AppearanceItemVisibility =>
	paint.visible === false ? "hidden" : "visible";

const effectVisibility = (effect: Effect): AppearanceItemVisibility =>
	effect.visible === false ? "hidden" : "visible";

const paintItems = (
	paints: readonly Paint[] | undefined,
	role: "fill" | "stroke",
	legacyColor: string,
): readonly AppearancePaintItem[] => {
	if (paints) {
		return paints.map((paint, index) => ({
			id: appearanceItemId(role, index),
			role,
			index,
			paint,
			visibility: paintVisibility(paint),
			legacy: false,
		}));
	}
	// No rich list: present the legacy flat color as a single synthesized item so
	// the stack editor has a uniform model. Editing materializes the real list.
	return [
		{
			id: appearanceItemId(role, 0),
			role,
			index: 0,
			paint: { kind: "solid", color: legacyColor },
			visibility: "visible",
			legacy: true,
		},
	];
};

/**
 * Reads a node's appearance as an ordered, display-ready stack. Rich `fills`/
 * `strokes`/`effects` lists are mapped one-to-one (hidden paints included); a node
 * without a rich list contributes one legacy fill/stroke item derived from its flat
 * color, mirroring the resolver's legacy fallback so the editor and renderer agree.
 */
export function readAppearanceStack(node: VectorNode): AppearanceStack {
	const { style } = node;
	return {
		fills: paintItems(style.fills, "fill", style.fill),
		strokes: paintItems(style.strokes, "stroke", style.stroke),
		effects: (style.effects ?? []).map((effect, index) => ({
			id: appearanceItemId("effect", index),
			role: "effect",
			index,
			effect,
			visibility: effectVisibility(effect),
		})),
		opacity: style.opacity,
		blendMode: style.blendMode ?? DEFAULT_BLEND_MODE,
	};
}

/**
 * Validates and clamps a raw patch (which may originate from AI/MCP callers) into
 * a canonical {@link AppearancePatch}, or returns null when it cannot be honored.
 * List operations are rejected against the singleton `opacity`/`blend` roles, paint
 * and effect payloads are type-checked, indices must be non-negative integers, and
 * opacity is clamped to `[0, 1]`.
 */
export function normalizeAppearancePatch(
	patch: AppearancePatch,
): AppearancePatch | null {
	switch (patch.op) {
		case "add":
			if (!isPaintRole(patch.role) || !isPaint(patch.paint)) return null;
			return {
				op: "add",
				role: patch.role,
				paint: patch.paint,
				...(isIndex(patch.index) ? { index: patch.index } : {}),
			};
		case "add-effect":
			if (!isEffect(patch.effect)) return null;
			return {
				op: "add-effect",
				effect: patch.effect,
				...(isIndex(patch.index) ? { index: patch.index } : {}),
			};
		case "update":
			if (
				!isPaintRole(patch.role) ||
				!isIndex(patch.index) ||
				!isPaint(patch.paint)
			)
				return null;
			return {
				op: "update",
				role: patch.role,
				index: patch.index,
				paint: patch.paint,
			};
		case "update-effect":
			if (!isIndex(patch.index) || !isEffect(patch.effect)) return null;
			return { op: "update-effect", index: patch.index, effect: patch.effect };
		case "reorder":
			if (!isListRole(patch.role) || !isIndex(patch.from) || !isIndex(patch.to))
				return null;
			return {
				op: "reorder",
				role: patch.role,
				from: patch.from,
				to: patch.to,
			};
		case "remove":
			if (!isListRole(patch.role) || !isIndex(patch.index)) return null;
			return { op: "remove", role: patch.role, index: patch.index };
		case "set-visibility":
			if (!isListRole(patch.role) || !isIndex(patch.index)) return null;
			return {
				op: "set-visibility",
				role: patch.role,
				index: patch.index,
				visible: patch.visible === true,
			};
		case "set-opacity":
			if (!Number.isFinite(patch.opacity)) return null;
			return { op: "set-opacity", opacity: clampOpacity(patch.opacity) };
		case "set-blend-mode":
			if (!isBlendMode(patch.blendMode)) return null;
			return { op: "set-blend-mode", blendMode: patch.blendMode };
		default:
			return null;
	}
}

const sourcePaints = (
	style: NodeStyle,
	role: "fill" | "stroke",
): readonly Paint[] | undefined =>
	role === "fill" ? style.fills : style.strokes;

const legacyColor = (style: NodeStyle, role: "fill" | "stroke"): string =>
	role === "fill" ? style.fill : style.stroke;

/**
 * Materializes the source paint list for a role: the rich list when present, else
 * the legacy flat color promoted to a single solid paint. This is the legacy →
 * rich bridge so the first stack edit on a legacy node keeps its visible color.
 */
const materializePaints = (
	style: NodeStyle,
	role: "fill" | "stroke",
): Paint[] => {
	const paints = sourcePaints(style, role);
	if (paints) return [...paints];
	return [{ kind: "solid", color: legacyColor(style, role) }];
};

const firstSolidColor = (paints: readonly Paint[]): string | null => {
	for (const paint of paints) {
		if (paint.kind === "solid") return paint.color;
	}
	return null;
};

/**
 * Writes a role's paint list back onto the style, keeping the legacy flat color
 * coherent with the leading solid paint (so code paths that still read the legacy
 * field — and the resolver fallback for a future cleared list — stay in sync).
 */
const withRolePaints = (
	style: NodeStyle,
	role: "fill" | "stroke",
	paints: readonly Paint[],
): NodeStyle => {
	const legacy = firstSolidColor(paints);
	if (role === "fill") {
		return {
			...style,
			fills: paints,
			...(legacy !== null ? { fill: legacy } : {}),
		};
	}
	return {
		...style,
		strokes: paints,
		...(legacy !== null ? { stroke: legacy } : {}),
	};
};

const sourceEffects = (style: NodeStyle): readonly Effect[] =>
	style.effects ?? [];

const withEffects = (
	style: NodeStyle,
	effects: readonly Effect[],
): NodeStyle => ({
	...style,
	effects,
});

const moveItem = <T>(
	items: readonly T[],
	from: number,
	to: number,
): readonly T[] => {
	if (from === to || from >= items.length) return items;
	const clampedTo = Math.min(Math.max(to, 0), items.length - 1);
	if (from === clampedTo) return items;
	const next = [...items];
	const [moved] = next.splice(from, 1);
	if (moved === undefined) return items;
	next.splice(clampedTo, 0, moved);
	return next;
};

const setPaintVisible = (paint: Paint, visible: boolean): Paint =>
	visible ? omitPaintVisible(paint) : { ...paint, visible: false };

/** Drops an explicit `visible` flag so a re-shown paint matches a never-hidden one. */
const omitPaintVisible = (paint: Paint): Paint => {
	if (paint.visible === undefined) return paint;
	const { visible: _visible, ...rest } = paint;
	return rest as Paint;
};

const setEffectVisible = (effect: Effect, visible: boolean): Effect =>
	({ ...effect, visible }) as Effect;

/**
 * Applies one appearance patch to a node style, returning a NEW style — or the
 * SAME style reference when the patch is a no-op (invalid, or it changes nothing),
 * so command callers can skip empty undo entries. Paint indices address the source
 * list; a fill/stroke edit on a legacy node first materializes the real list.
 */
export function applyAppearanceStackPatch(
	style: NodeStyle,
	patch: AppearancePatch,
): NodeStyle {
	const normalized = normalizeAppearancePatch(patch);
	if (!normalized) return style;

	switch (normalized.op) {
		case "add": {
			const paints = materializePaints(style, normalized.role);
			const at =
				normalized.index === undefined
					? paints.length
					: Math.min(normalized.index, paints.length);
			paints.splice(at, 0, normalized.paint);
			return withRolePaints(style, normalized.role, paints);
		}
		case "add-effect": {
			const effects = [...sourceEffects(style)];
			const at =
				normalized.index === undefined
					? effects.length
					: Math.min(normalized.index, effects.length);
			effects.splice(at, 0, normalized.effect);
			return withEffects(style, effects);
		}
		case "update": {
			const paints = materializePaints(style, normalized.role);
			if (normalized.index >= paints.length) return style;
			paints[normalized.index] = normalized.paint;
			return withRolePaints(style, normalized.role, paints);
		}
		case "update-effect": {
			const effects = [...sourceEffects(style)];
			if (normalized.index >= effects.length) return style;
			effects[normalized.index] = normalized.effect;
			return withEffects(style, effects);
		}
		case "remove": {
			if (normalized.role === "effect") {
				const effects = sourceEffects(style);
				if (normalized.index >= effects.length) return style;
				return withEffects(
					style,
					effects.filter((_, index) => index !== normalized.index),
				);
			}
			const paints = materializePaints(style, normalized.role);
			if (normalized.index >= paints.length) return style;
			return withRolePaints(
				style,
				normalized.role,
				paints.filter((_, index) => index !== normalized.index),
			);
		}
		case "reorder": {
			if (normalized.role === "effect") {
				const effects = sourceEffects(style);
				const next = moveItem(effects, normalized.from, normalized.to);
				return next === effects ? style : withEffects(style, next);
			}
			const paints = materializePaints(style, normalized.role);
			const next = moveItem(paints, normalized.from, normalized.to);
			return next === paints && sourcePaints(style, normalized.role)
				? style
				: withRolePaints(style, normalized.role, next);
		}
		case "set-visibility": {
			if (normalized.role === "effect") {
				const effects = sourceEffects(style);
				if (normalized.index >= effects.length) return style;
				const target = effects[normalized.index];
				if (
					!target ||
					effectVisibility(target) ===
						(normalized.visible ? "visible" : "hidden")
				)
					return style;
				return withEffects(
					style,
					effects.map((effect, index) =>
						index === normalized.index
							? setEffectVisible(effect, normalized.visible)
							: effect,
					),
				);
			}
			const paints = materializePaints(style, normalized.role);
			if (normalized.index >= paints.length) return style;
			const target = paints[normalized.index];
			if (!target) return style;
			paints[normalized.index] = setPaintVisible(target, normalized.visible);
			return withRolePaints(style, normalized.role, paints);
		}
		case "set-opacity":
			return Object.is(style.opacity, normalized.opacity)
				? style
				: { ...style, opacity: normalized.opacity };
		case "set-blend-mode":
			return (style.blendMode ?? DEFAULT_BLEND_MODE) === normalized.blendMode
				? style
				: { ...style, blendMode: normalized.blendMode };
		default:
			return style;
	}
}

/** Reorders a fill/stroke/effect item. Thin wrapper over the reorder patch. */
export function reorderAppearanceItem(
	style: NodeStyle,
	role: AppearanceListRole,
	from: number,
	to: number,
): NodeStyle {
	return applyAppearanceStackPatch(style, { op: "reorder", role, from, to });
}

/** Removes a stack item addressed by its derived id (`role:index`). */
export function removeAppearanceItem(
	style: NodeStyle,
	itemId: string,
): NodeStyle {
	const parsed = parseAppearanceItemId(itemId);
	if (!parsed) return style;
	return applyAppearanceStackPatch(style, {
		op: "remove",
		role: parsed.role,
		index: parsed.index,
	});
}

// --- Graphic styles (full appearance capture/apply) -------------------------

const STROKE_ALIGNS: readonly StrokeAlign[] = ["inside", "center", "outside"];
const STROKE_CAPS: readonly StrokeCap[] = ["butt", "round", "square"];
const STROKE_JOINS: readonly StrokeJoin[] = ["miter", "round", "bevel"];

const isStrokeAlign = (value: unknown): value is StrokeAlign =>
	STROKE_ALIGNS.includes(value as StrokeAlign);
const isStrokeCap = (value: unknown): value is StrokeCap =>
	STROKE_CAPS.includes(value as StrokeCap);
const isStrokeJoin = (value: unknown): value is StrokeJoin =>
	STROKE_JOINS.includes(value as StrokeJoin);

const isFiniteNumber = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

type MutableAppearance = {
	-readonly [K in keyof StylePresetAppearance]: StylePresetAppearance[K];
};

/**
 * Validates and clamps a graphic-style appearance payload (which may originate from
 * AI/MCP/hand-authored presets) to the same rules the node-style command enforces:
 * invalid paints/effects are dropped, enums must be known, numbers are clamped.
 * Returns null when nothing usable remains so callers never store an empty part.
 * An explicit empty `fills`/`strokes` array is preserved — it means "no paint".
 */
export function normalizeGraphicStyleAppearance(
	appearance: StylePresetAppearance,
): StylePresetAppearance | null {
	const next: MutableAppearance = {};
	if (appearance.fills !== undefined) {
		next.fills = appearance.fills.filter(isPaint);
	}
	if (appearance.strokes !== undefined) {
		next.strokes = appearance.strokes.filter(isPaint);
	}
	if (appearance.effects !== undefined) {
		next.effects = appearance.effects.filter(isEffect);
	}
	if (isBlendMode(appearance.blendMode)) next.blendMode = appearance.blendMode;
	if (isStrokeAlign(appearance.strokeAlign)) {
		next.strokeAlign = appearance.strokeAlign;
	}
	if (appearance.strokeDash !== undefined) {
		next.strokeDash = appearance.strokeDash
			.filter(isFiniteNumber)
			.map((value) => Math.max(0, value))
			.filter((value) => value > 0);
	}
	if (isStrokeCap(appearance.strokeCap)) next.strokeCap = appearance.strokeCap;
	if (isStrokeJoin(appearance.strokeJoin)) {
		next.strokeJoin = appearance.strokeJoin;
	}
	if (
		isFiniteNumber(appearance.strokeMiterLimit) &&
		appearance.strokeMiterLimit > 0
	) {
		next.strokeMiterLimit = appearance.strokeMiterLimit;
	}
	if (isFiniteNumber(appearance.opacity)) {
		next.opacity = clampOpacity(appearance.opacity);
	}
	return Object.keys(next).length > 0 ? next : null;
}

/**
 * Captures a node's full appearance (rich paint stacks, effects, blend, stroke
 * geometry) as a reusable graphic-style payload. Returns null for a pure-legacy node
 * (flat `fill`/`stroke` only, no rich fields), whose preset is covered by the legacy
 * paint part instead. When rich fields exist, `opacity` is included so the captured
 * stack reproduces the source exactly.
 */
export function captureGraphicStyleFromNode(
	node: VectorNode,
): StylePresetAppearance | null {
	const style = node.style;
	const captured: MutableAppearance = {};
	if (style.fills !== undefined) captured.fills = style.fills;
	if (style.strokes !== undefined) captured.strokes = style.strokes;
	if (style.effects !== undefined) captured.effects = style.effects;
	if (style.blendMode !== undefined) captured.blendMode = style.blendMode;
	if (style.strokeAlign !== undefined) captured.strokeAlign = style.strokeAlign;
	if (style.strokeDash !== undefined) captured.strokeDash = style.strokeDash;
	if (style.strokeCap !== undefined) captured.strokeCap = style.strokeCap;
	if (style.strokeJoin !== undefined) captured.strokeJoin = style.strokeJoin;
	if (style.strokeMiterLimit !== undefined) {
		captured.strokeMiterLimit = style.strokeMiterLimit;
	}
	if (Object.keys(captured).length === 0) return null;
	captured.opacity = style.opacity;
	return normalizeGraphicStyleAppearance(captured);
}

/**
 * Value-copies a graphic-style appearance onto a node style, returning a new style
 * (or the same reference when the payload normalizes to nothing). Legacy `fill`/
 * `stroke` are left untouched — the resolver reads the rich `fills`/`strokes` when
 * present, and a preset's separate paint part keeps the legacy colors coherent.
 */
export function applyGraphicStyleToNode(
	style: NodeStyle,
	appearance: StylePresetAppearance,
): NodeStyle {
	const normalized = normalizeGraphicStyleAppearance(appearance);
	if (!normalized) return style;
	return { ...style, ...normalized };
}
