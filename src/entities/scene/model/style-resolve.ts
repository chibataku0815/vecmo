import type {
	BlendMode,
	BlurEffect,
	Effect,
	GradientStop,
	ImagePaintFit,
	ImageReferencePaint,
	LinearGradientPaint,
	MeshGradientPaint,
	MeshPoint,
	NodeStyle,
	Paint,
	PaintTransform,
	RadialGradientPaint,
	ShadowEffect,
	StrokeAlign,
	StrokeCap,
	StrokeJoin,
	Vec2,
} from "./types";

export const DEFAULT_BLEND_MODE = "normal" satisfies BlendMode;
export const DEFAULT_STROKE_ALIGN = "center" satisfies StrokeAlign;
export const DEFAULT_STROKE_CAP = "butt" satisfies StrokeCap;
export const DEFAULT_STROKE_JOIN = "miter" satisfies StrokeJoin;
export const DEFAULT_STROKE_MITER_LIMIT = 4;

export type ResolvedGradientStop = {
	readonly offset: number;
	readonly color: string;
	readonly opacity: number;
};

export type ResolvedSolidPaint = {
	readonly kind: "solid";
	readonly color: string;
	readonly opacity: number;
};

export type ResolvedLinearGradientPaint = Omit<
	LinearGradientPaint,
	"stops" | "opacity" | "transform"
> & {
	readonly stops: readonly ResolvedGradientStop[];
	readonly opacity: number;
	readonly transform?: PaintTransform;
};

export type ResolvedRadialGradientPaint = Omit<
	RadialGradientPaint,
	"stops" | "opacity" | "transform"
> & {
	readonly stops: readonly ResolvedGradientStop[];
	readonly opacity: number;
	readonly transform?: PaintTransform;
};

export type ResolvedImageReferencePaint = Omit<
	ImageReferencePaint,
	"fit" | "opacity" | "transform"
> & {
	readonly fit: ImagePaintFit;
	readonly opacity: number;
	readonly transform?: PaintTransform;
};

/**
 * Resolved mesh paint. `dataUrl` is a render-cache slot left `undefined` by the
 * pure {@link resolveNodeStyle} and populated downstream by the canvas/export
 * rasterizer bridge (a mesh has no native SVG paint server); consumers without a
 * bitmap fall back to the first mesh point's color so the fill is never invisible.
 */
export type ResolvedMeshGradientPaint = Omit<MeshGradientPaint, "opacity"> & {
	readonly opacity: number;
	readonly dataUrl?: string;
};

export type ResolvedPaint =
	| ResolvedSolidPaint
	| ResolvedLinearGradientPaint
	| ResolvedRadialGradientPaint
	| ResolvedImageReferencePaint
	| ResolvedMeshGradientPaint;

export type ResolvedShadowEffect = Omit<
	ShadowEffect,
	"offset" | "radius" | "opacity" | "spread" | "visible" | "blendMode"
> & {
	readonly offset: Vec2;
	readonly radius: number;
	readonly opacity: number;
	readonly spread: number;
	readonly visible: boolean;
	readonly blendMode: BlendMode;
};

export type ResolvedBlurEffect = Omit<BlurEffect, "radius" | "visible"> & {
	readonly radius: number;
	readonly visible: boolean;
};

export type ResolvedEffect = ResolvedShadowEffect | ResolvedBlurEffect;

export type ResolvedNodeStyle = {
	readonly fill: string;
	readonly stroke: string;
	readonly strokeWidth: number;
	readonly opacity: number;
	readonly fills: readonly ResolvedPaint[];
	readonly strokes: readonly ResolvedPaint[];
	readonly effects: readonly ResolvedEffect[];
	readonly blendMode: BlendMode;
	readonly strokeAlign: StrokeAlign;
	readonly strokeDash: readonly number[];
	/**
	 * Phase offset into {@link strokeDash} (authored scene units). Any finite
	 * value is meaningful, including negative — {@link NodeStyle.strokeDashoffset}'s
	 * own doc comment describes the motion-expression runtime driving this per
	 * frame for a travelling-stroke animation, which sweeps in either direction
	 * — so this is NOT clamped non-negative like {@link strokeWidth} or
	 * {@link strokeMiterLimit}; only non-finite input falls back to `0`. Never
	 * resolved before S8's GPU dash-offset work — the presentation layer only
	 * ever read {@link strokeDash} — which left canvas/export silently ignoring
	 * `NodeStyle.strokeDashoffset` while the GPU dash mesh (added alongside this
	 * field) correctly applied it, producing a canvas/GPU divergence.
	 */
	readonly strokeDashoffset: number;
	readonly strokeCap: StrokeCap;
	readonly strokeJoin: StrokeJoin;
	readonly strokeMiterLimit: number;
	/**
	 * Resolved stroke-only blur radius (authored scene units, `>= 0`). Flattened
	 * off `style.strokeSoftness.blurRadius` so renderers can branch on a single
	 * number; `0` keeps the byte-identical single-element fill+stroke fast path.
	 */
	readonly strokeBlurRadius: number;
};

const clampFinite = (value: number | undefined, fallback: number): number =>
	typeof value === "number" && Number.isFinite(value) ? value : fallback;

const clampNonNegative = (value: number | undefined, fallback = 0): number =>
	Math.max(0, clampFinite(value, fallback));

const clampPositive = (value: number | undefined, fallback: number): number => {
	const finite = clampFinite(value, fallback);
	return finite > 0 ? finite : fallback;
};

const clampUnit = (value: number | undefined, fallback = 1): number =>
	Math.min(1, Math.max(0, clampFinite(value, fallback)));

const normalizeVec2 = (value: Vec2): Vec2 => ({
	x: clampFinite(value.x, 0),
	y: clampFinite(value.y, 0),
});

const normalizePaintTransform = (
	transform: PaintTransform | undefined,
): PaintTransform | undefined => {
	if (!transform) return undefined;
	return {
		a: clampFinite(transform.a, 1),
		b: clampFinite(transform.b, 0),
		c: clampFinite(transform.c, 0),
		d: clampFinite(transform.d, 1),
		e: clampFinite(transform.e, 0),
		f: clampFinite(transform.f, 0),
	};
};

const sortedGradientStops = (
	stops: readonly GradientStop[],
): readonly ResolvedGradientStop[] =>
	stops
		.map((stop, index) => ({
			index,
			offset: clampUnit(stop.offset, 0),
			color: stop.color,
			opacity: clampUnit(stop.opacity),
		}))
		.sort(
			(left, right) => left.offset - right.offset || left.index - right.index,
		)
		.map(({ offset, color, opacity }) => ({ offset, color, opacity }));

/**
 * Keeps a handle only when both coords are finite; a non-finite handle is dropped
 * (→ a straight edge) rather than clamped to `{0,0}`, which would masquerade as a
 * real, degenerate tangent. Only reachable via a programmatic/corrupt input.
 */
const finiteHandle = (handle: Vec2 | undefined): Vec2 | undefined =>
	handle && Number.isFinite(handle.x) && Number.isFinite(handle.y)
		? { x: handle.x, y: handle.y }
		: undefined;

const normalizeMeshPoint = (meshPoint: MeshPoint): MeshPoint => {
	const handleUp = finiteHandle(meshPoint.handleUp);
	const handleDown = finiteHandle(meshPoint.handleDown);
	const handleLeft = finiteHandle(meshPoint.handleLeft);
	const handleRight = finiteHandle(meshPoint.handleRight);
	return {
		point: normalizeVec2(meshPoint.point),
		color: meshPoint.color,
		...(meshPoint.opacity === undefined
			? {}
			: { opacity: clampUnit(meshPoint.opacity) }),
		...(handleUp ? { handleUp } : {}),
		...(handleDown ? { handleDown } : {}),
		...(handleLeft ? { handleLeft } : {}),
		...(handleRight ? { handleRight } : {}),
	};
};

const normalizePaint = (paint: Paint): ResolvedPaint => {
	switch (paint.kind) {
		case "solid":
			return {
				kind: "solid",
				color: paint.color,
				opacity: clampUnit(paint.opacity),
			};
		case "linear-gradient":
			return {
				kind: "linear-gradient",
				from: normalizeVec2(paint.from),
				to: normalizeVec2(paint.to),
				stops: sortedGradientStops(paint.stops),
				opacity: clampUnit(paint.opacity),
				...(paint.transform
					? { transform: normalizePaintTransform(paint.transform) }
					: {}),
			};
		case "radial-gradient":
			return {
				kind: "radial-gradient",
				center: normalizeVec2(paint.center),
				radius: normalizeVec2(paint.radius),
				stops: sortedGradientStops(paint.stops),
				opacity: clampUnit(paint.opacity),
				...(paint.transform
					? { transform: normalizePaintTransform(paint.transform) }
					: {}),
			};
		case "image-reference":
			return {
				kind: "image-reference",
				...(paint.assetId ? { assetId: paint.assetId } : {}),
				...(paint.href ? { href: paint.href } : {}),
				fit: paint.fit ?? "fill",
				opacity: clampUnit(paint.opacity),
				...(paint.transform
					? { transform: normalizePaintTransform(paint.transform) }
					: {}),
			};
		case "mesh-gradient":
			return {
				kind: "mesh-gradient",
				rows: paint.rows,
				cols: paint.cols,
				points: paint.points.map(normalizeMeshPoint),
				opacity: clampUnit(paint.opacity),
				...(paint.transform
					? { transform: normalizePaintTransform(paint.transform) }
					: {}),
			};
	}
};

/**
 * Resolves a paint list with legacy fallback. An explicit empty list is
 * preserved as "no paint"; only an omitted list falls back to the legacy color.
 *
 * Paints flagged `visible: false` are dropped here so every render/export/fallback
 * consumer skips them with no per-renderer code, while the persisted stack keeps
 * the hidden paint for the appearance-stack editor (which reads source, not
 * resolved, state). A list whose paints are all hidden resolves to "no paint"
 * (empty) rather than falling back to the legacy color, because an explicit list —
 * even an all-hidden one — overrides the legacy single color.
 */
export function resolvePaints(
	paints: readonly Paint[] | undefined,
	legacyColor: string,
): readonly ResolvedPaint[] {
	if (paints) {
		return paints
			.filter((paint) => paint.visible !== false)
			.map(normalizePaint);
	}
	return [{ kind: "solid", color: legacyColor, opacity: 1 }];
}

/**
 * The single source of truth for "does this artboard have a transparent
 * background" — built on the exact same {@link resolvePaints} decision the
 * SVG exporter's `renderArtboardBackground` (`src/features/export/model/svg.ts`)
 * uses to decide whether to emit a background `<rect>` at all: an explicit
 * empty `fills` array (or a `fills` list whose every paint is hidden) resolves
 * to "no paint" and is transparent; an omitted `fills` list falls back to the
 * legacy solid `background` color and is opaque; any non-empty `fills` list —
 * including a gradient, image, or mesh paint — is opaque, because a fill with
 * content always covers the artboard even where `background`'s own scalar
 * hex would otherwise suggest black/white/etc.
 *
 * Other consumers that need an "is this artboard opaque" answer (e.g. the GPU
 * raster export path's alpha-preservation opt-in) MUST call this rather than
 * re-deriving their own transparency check, so the SVG renderer and every
 * other exporter agree on exactly one definition.
 */
export function artboardBackgroundIsTransparent(artboard: {
	readonly fills?: readonly Paint[];
	readonly background: string;
}): boolean {
	return resolvePaints(artboard.fills, artboard.background).length === 0;
}

const normalizeEffect = (effect: Effect): ResolvedEffect => {
	switch (effect.kind) {
		case "drop-shadow":
		case "inner-shadow":
			return {
				kind: effect.kind,
				offset: normalizeVec2(effect.offset),
				radius: clampNonNegative(effect.radius),
				color: effect.color,
				opacity: clampUnit(effect.opacity),
				spread: clampFinite(effect.spread, 0),
				visible: effect.visible ?? true,
				blendMode: effect.blendMode ?? DEFAULT_BLEND_MODE,
			};
		case "layer-blur":
		case "background-blur":
			return {
				kind: effect.kind,
				radius: clampNonNegative(effect.radius),
				// Preserve a directional y-axis radius; omit when isotropic so output
				// stays byte-identical to the scalar form.
				...(effect.radiusY === undefined
					? {}
					: { radiusY: clampNonNegative(effect.radiusY) }),
				visible: effect.visible ?? true,
			};
	}
};

/**
 * Resolves a node's effect list in isolation, for render adapters (canvas and
 * worker export) that only need effects — not the full paint/stroke style — to
 * build their SVG filter. Mirrors the `effects` field of {@link resolveNodeStyle}
 * exactly so all three renderers feed `buildEffectFilter` identical input.
 */
export function resolveEffects(
	effects: readonly Effect[] | undefined,
): readonly ResolvedEffect[] {
	return (effects ?? []).map(normalizeEffect);
}

const normalizeStrokeDash = (
	strokeDash: readonly number[] | undefined,
): readonly number[] => {
	if (!strokeDash) return [];
	return strokeDash
		.map((value) => clampNonNegative(value))
		.filter((value) => value > 0);
};

/**
 * Resolves the complete node style contract into deterministic plain data.
 * Legacy colors remain on the resolved object for existing render/export paths,
 * while `fills` and `strokes` expose the new source-of-truth paint lists.
 */
export function resolveNodeStyle(style: NodeStyle): ResolvedNodeStyle {
	return {
		fill: style.fill,
		stroke: style.stroke,
		strokeWidth: clampNonNegative(style.strokeWidth),
		opacity: clampUnit(style.opacity),
		fills: resolvePaints(style.fills, style.fill),
		strokes: resolvePaints(style.strokes, style.stroke),
		effects: resolveEffects(style.effects),
		blendMode: style.blendMode ?? DEFAULT_BLEND_MODE,
		strokeAlign: style.strokeAlign ?? DEFAULT_STROKE_ALIGN,
		strokeDash: normalizeStrokeDash(style.strokeDash),
		strokeDashoffset: clampFinite(style.strokeDashoffset, 0),
		strokeCap: style.strokeCap ?? DEFAULT_STROKE_CAP,
		strokeJoin: style.strokeJoin ?? DEFAULT_STROKE_JOIN,
		strokeMiterLimit: clampPositive(
			style.strokeMiterLimit,
			DEFAULT_STROKE_MITER_LIMIT,
		),
		strokeBlurRadius: clampNonNegative(style.strokeSoftness?.blurRadius),
	};
}
