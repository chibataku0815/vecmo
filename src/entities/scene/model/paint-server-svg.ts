/**
 * Single source of truth for serializing a resolved gradient/image paint to an
 * SVG paint-server `<def>` (`<linearGradient>`/`<radialGradient>`/`<pattern>`),
 * extracted verbatim from {@link ../../../features/export/model/svg.ts} so the
 * in-app SVG export and the standalone code/runtime export
 * ({@link ./paint-stack-svg.ts}, bundled via
 * {@link ../../../features/export/model/runtime-sampler-entry.ts}) emit
 * byte-identical def markup for the same paint. `svg.ts` imports these defs
 * instead of keeping its own copies.
 *
 * The small SVG-string primitives below are kept module-private and mirror the
 * equivalents in `svg.ts`/`mask-svg.ts`/`mesh-paint-svg.ts`; the codebase
 * already tolerates these tiny pure helpers being duplicated across renderers
 * (see `mask-svg.ts`'s module doc) — what must not diverge is the actual
 * paint-server markup, single-sourced here.
 */

import type {
	ResolvedImageReferencePaint,
	ResolvedLinearGradientPaint,
	ResolvedPaint,
	ResolvedRadialGradientPaint,
} from "./style-resolve";

export type SvgAttributeValue = string | number | boolean | null | undefined;

// --- SVG-string primitives (module-private; mirror svg.ts) ---------------------

const escapeText = (value: string): string =>
	value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");

const escapeAttribute = (value: string): string =>
	escapeText(value).replaceAll('"', "&quot;");

const formatNumber = (value: number): string => {
	if (!Number.isFinite(value)) return "0";
	const rounded = Math.abs(value) < 1e-10 ? 0 : Number(value.toFixed(6));
	return String(rounded);
};

const renderAttributes = (
	attributes: readonly (readonly [string, SvgAttributeValue])[],
): string =>
	attributes
		.flatMap(([name, value]) => {
			if (value === null || value === undefined || value === false) return [];
			const normalized =
				typeof value === "number" ? formatNumber(value) : String(value);
			return [`${name}="${escapeAttribute(normalized)}"`];
		})
		.join(" ");

const element = (
	tag: string,
	attributes: readonly (readonly [string, SvgAttributeValue])[],
): string => `<${tag} ${renderAttributes(attributes)} />`;

// --- Paint-server defs -----------------------------------------------------

/** Formats a paint's `PaintTransform` as an SVG `gradientTransform`/`patternTransform` matrix value. */
export const paintTransformAttribute = (
	transform:
		| {
				readonly a: number;
				readonly b: number;
				readonly c: number;
				readonly d: number;
				readonly e: number;
				readonly f: number;
		  }
		| undefined,
): string | undefined =>
	transform
		? `matrix(${[
				transform.a,
				transform.b,
				transform.c,
				transform.d,
				transform.e,
				transform.f,
			]
				.map(formatNumber)
				.join(" ")})`
		: undefined;

/** Serializes a gradient's stop list as `<stop>` elements, "\n"-joined. */
export const gradientStopElements = (
	stops: ResolvedLinearGradientPaint["stops"],
): string =>
	stops
		.map((stop) =>
			element("stop", [
				["offset", `${formatNumber(stop.offset * 100)}%`],
				["stop-color", stop.color],
				["stop-opacity", stop.opacity === 1 ? undefined : stop.opacity],
			]),
		)
		.join("\n");

/** Serializes a resolved linear-gradient paint as a `userSpaceOnUse` `<linearGradient>` def. */
export const linearGradientDef = (
	id: string,
	paint: ResolvedLinearGradientPaint,
): string => `<linearGradient ${renderAttributes([
	["id", id],
	["gradientUnits", "userSpaceOnUse"],
	["x1", paint.from.x],
	["y1", paint.from.y],
	["x2", paint.to.x],
	["y2", paint.to.y],
	["gradientTransform", paintTransformAttribute(paint.transform)],
])}>
${gradientStopElements(paint.stops)}
</linearGradient>`;

/** Serializes a resolved radial-gradient paint as a `userSpaceOnUse` `<radialGradient>` def. */
export const radialGradientDef = (
	id: string,
	paint: ResolvedRadialGradientPaint,
): string => `<radialGradient ${renderAttributes([
	["id", id],
	["gradientUnits", "userSpaceOnUse"],
	["cx", paint.center.x],
	["cy", paint.center.y],
	["r", Math.max(paint.radius.x, paint.radius.y, 0)],
	["gradientTransform", paintTransformAttribute(paint.transform)],
])}>
${gradientStopElements(paint.stops)}
</radialGradient>`;

/** Serializes a resolved image-reference paint as an `objectBoundingBox` `<pattern>` def wrapping the resolved href. */
export const imagePatternDef = (
	id: string,
	href: string,
	paint: ResolvedImageReferencePaint,
): string => `<pattern ${renderAttributes([
	["id", id],
	["patternUnits", "objectBoundingBox"],
	["patternContentUnits", "objectBoundingBox"],
	["width", 1],
	["height", 1],
	["patternTransform", paintTransformAttribute(paint.transform)],
])}>
${element("image", [
	["href", href],
	["width", 1],
	["height", 1],
	["preserveAspectRatio", preserveAspectRatioForImageFit(paint.fit)],
])}
</pattern>`;

/**
 * Maps an image paint fit mode to the SVG `preserveAspectRatio` value used for
 * the `<image>` inside the generated fill pattern. `fill` stretches to the
 * shape bounds; `fit`/`crop` letterbox/cover; `tile` has no faithful
 * single-pattern representation here and is approximated as `fill` (documented
 * limitation). Duplicated from `./assets.ts` (already the entities-layer home
 * of the canonical version) so this module's def builders are self-contained;
 * the mapping is a fixed 3-way switch with no independent behavior to drift.
 */
const preserveAspectRatioForImageFit = (
	fit: ResolvedImageReferencePaint["fit"],
): string => {
	switch (fit) {
		case "fit":
			return "xMidYMid meet";
		case "crop":
			return "xMidYMid slice";
		default:
			return "none";
	}
};

/**
 * Reports whether a resolved paint stack needs the multi-layer stacked-shape
 * rendering path (one geometry element per paint) rather than the single-paint
 * fast path. An empty stack is `false` (nothing to render — the caller falls
 * back to the legacy scalar color/`"none"`). A single paint is `false` unless
 * it is a solid with non-1 opacity (the fast path has no per-paint opacity
 * attribute slot) — a lone mesh-gradient is also `false` because
 * {@link ./mesh-paint-svg.ts} already owns single-mesh rendering via its own
 * pattern-ref map, and promoting it here would just duplicate that def.
 */
export function paintStackNeedsLayerRendering(
	paints: readonly ResolvedPaint[],
): boolean {
	if (paints.length > 1) return true;
	const [only] = paints;
	if (!only) return false;
	return only.kind === "solid"
		? only.opacity !== 1
		: only.kind !== "mesh-gradient";
}
