import { meshBounds } from "./mesh-edit";
import type {
	ResolvedGradientStop,
	ResolvedImageReferencePaint,
	ResolvedNodeStyle,
	ResolvedPaint,
} from "./style-resolve";
import type { ImagePaintFit, PaintTransform } from "./types";

/**
 * Renderable gradient definition for the editing canvas. Coordinates mirror the
 * SVG exporter (`userSpaceOnUse`, node-local paint space) so the canvas preview
 * and the exported asset agree visually for the same paint. (Mesh paints agree at
 * the pixel-buffer level via the shared rasterizer rather than byte-for-byte —
 * two PNG encoders need not match byte-for-byte, only the pixels they encode.)
 */
export type CanvasGradientStop = {
	readonly offset: number;
	readonly color: string;
	readonly opacity: number;
};

/**
 * Renderable mesh definition: a pre-rasterized PNG data-URL placed over the mesh's
 * node-local bounds via a `userSpaceOnUse` `<pattern>`. Mesh has no native SVG
 * paint server, so the bitmap (produced by the canvas/export rasterizer bridge) is
 * the render artifact; `x/y/width/height` map directly to the pattern + image box.
 */
export type CanvasMeshDef = {
	readonly id: string;
	readonly kind: "mesh";
	readonly dataUrl: string;
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
	/** SVG `matrix(...)` string when a paint transform is present (→ patternTransform). */
	readonly transform?: string;
};

export type CanvasGradientDef = {
	readonly id: string;
	readonly kind: "linear" | "radial";
	/** Present for `kind === "linear"`. */
	readonly linear?: {
		readonly x1: number;
		readonly y1: number;
		readonly x2: number;
		readonly y2: number;
	};
	/** Present for `kind === "radial"`. */
	readonly radial?: {
		readonly cx: number;
		readonly cy: number;
		readonly r: number;
	};
	/** SVG `matrix(...)` string when a paint transform is present. */
	readonly transform?: string;
	readonly stops: readonly CanvasGradientStop[];
};

/**
 * Renderable image-fill definition for the editing canvas. Emitted as an SVG
 * `<pattern>` wrapping an `<image>` so an image paint stays a single painted
 * element (`fill="url(#id)"`), matching how gradients already work and keeping
 * the motion-playback paint target single.
 */
export type CanvasImageDef = {
	readonly id: string;
	readonly kind: "image";
	readonly href: string;
	readonly fit: ImagePaintFit;
	/** SVG `matrix(...)` string when a paint transform is present. */
	readonly transform?: string;
};

/** A paint may carry a gradient, image, or mesh definition to emit into `<defs>`. */
export type CanvasPaintDef = CanvasGradientDef | CanvasImageDef | CanvasMeshDef;

/**
 * A single paint role (fill or stroke) resolved for direct use as SVG presentation
 * attributes: `value` is a color or `url(#id)`, `opacity` maps to fill/stroke-opacity,
 * and `def` (when present) must be emitted into `<defs>` next to the shape.
 */
export type CanvasPaint = {
	readonly value: string;
	readonly opacity: number;
	readonly def: CanvasPaintDef | null;
};

/**
 * Resolves an image-reference paint to a concrete href. Provided by the canvas
 * host (which owns the scene document's asset library) so paint resolution stays
 * pure and does not import document state.
 */
export type CanvasImageHrefResolver = (
	paint: ResolvedImageReferencePaint,
) => string | undefined;

const NO_PAINT: CanvasPaint = { value: "none", opacity: 1, def: null };

const isVisibleColor = (value: string): boolean => {
	const normalized = value.trim().toLowerCase();
	return (
		normalized !== "" && normalized !== "none" && normalized !== "transparent"
	);
};

const paintTransformMatrix = (
	transform: PaintTransform | undefined,
): string | undefined =>
	transform
		? `matrix(${transform.a} ${transform.b} ${transform.c} ${transform.d} ${transform.e} ${transform.f})`
		: undefined;

const canvasStops = (
	stops: readonly ResolvedGradientStop[],
): readonly CanvasGradientStop[] =>
	stops.map((stop) => ({
		offset: stop.offset,
		color: stop.color,
		opacity: stop.opacity,
	}));

/**
 * Deterministic visible fallback color, parallel to the SVG exporter's
 * `fallbackColorForRole`: first solid paint, then any gradient's first stop,
 * then the legacy color. Used when a paint cannot be drawn as a vector gradient
 * (image references, or a gradient with no stops).
 */
const fallbackColor = (
	paints: readonly ResolvedPaint[],
	legacyColor: string,
): string => {
	for (const paint of paints) {
		if (paint.kind === "solid" && isVisibleColor(paint.color)) {
			return paint.color;
		}
		if (
			(paint.kind === "linear-gradient" || paint.kind === "radial-gradient") &&
			paint.stops[0] &&
			isVisibleColor(paint.stops[0].color)
		) {
			return paint.stops[0].color;
		}
		if (
			paint.kind === "mesh-gradient" &&
			paint.points[0] &&
			isVisibleColor(paint.points[0].color)
		) {
			return paint.points[0].color;
		}
	}
	return isVisibleColor(legacyColor) ? legacyColor : "none";
};

/**
 * Resolves the first paint of a role into canvas presentation data, mirroring the
 * SVG exporter's first-paint semantics (only the leading paint of a stack is drawn
 * on a single vector element). An empty list paints nothing; image references and
 * stop-less gradients degrade to the deterministic fallback color so the canvas
 * never disagrees with what export would emit.
 *
 * @param paints Resolved paint stack for one role (`fills` or `strokes`).
 * @param legacyColor Legacy flat color backing the role, used for fallback.
 * @param idSeed Unique, DOM-safe seed for the generated gradient element id.
 */
export function canvasPaint(
	paints: readonly ResolvedPaint[],
	legacyColor: string,
	idSeed: string,
	resolveImageHref?: CanvasImageHrefResolver,
): CanvasPaint {
	const [paint] = paints;
	if (!paint) return NO_PAINT;
	return resolvedCanvasPaint(
		paint,
		fallbackColor(paints, legacyColor),
		idSeed,
		resolveImageHref,
	);
}

/**
 * Resolves ONE already-resolved paint into canvas presentation data. `fallback`
 * is the deterministic color used when the paint cannot be drawn as a vector paint
 * server (image with no href, stop-less gradient, un-rasterized mesh); the caller
 * precomputes it from the full role stack so every layer degrades identically.
 */
function resolvedCanvasPaint(
	paint: ResolvedPaint,
	fallback: string,
	idSeed: string,
	resolveImageHref?: CanvasImageHrefResolver,
): CanvasPaint {
	switch (paint.kind) {
		case "solid":
			return { value: paint.color, opacity: paint.opacity, def: null };
		case "linear-gradient": {
			if (paint.stops.length === 0) {
				return { value: fallback, opacity: paint.opacity, def: null };
			}
			const id = `${idSeed}`;
			return {
				value: `url(#${id})`,
				opacity: paint.opacity,
				def: {
					id,
					kind: "linear",
					linear: {
						x1: paint.from.x,
						y1: paint.from.y,
						x2: paint.to.x,
						y2: paint.to.y,
					},
					...(paint.transform
						? { transform: paintTransformMatrix(paint.transform) }
						: {}),
					stops: canvasStops(paint.stops),
				},
			};
		}
		case "radial-gradient": {
			if (paint.stops.length === 0) {
				return { value: fallback, opacity: paint.opacity, def: null };
			}
			const id = `${idSeed}`;
			return {
				value: `url(#${id})`,
				opacity: paint.opacity,
				def: {
					id,
					kind: "radial",
					radial: {
						cx: paint.center.x,
						cy: paint.center.y,
						r: Math.max(paint.radius.x, paint.radius.y, 0),
					},
					...(paint.transform
						? { transform: paintTransformMatrix(paint.transform) }
						: {}),
					stops: canvasStops(paint.stops),
				},
			};
		}
		case "image-reference": {
			const href = resolveImageHref?.(paint);
			if (!href) {
				return { value: fallback, opacity: paint.opacity, def: null };
			}
			const id = `${idSeed}`;
			return {
				value: `url(#${id})`,
				opacity: paint.opacity,
				def: {
					id,
					kind: "image",
					href,
					fit: paint.fit,
					...(paint.transform
						? { transform: paintTransformMatrix(paint.transform) }
						: {}),
				},
			};
		}
		case "mesh-gradient": {
			// Without a rasterized bitmap (the bridge has not run, or the mesh is
			// degenerate) degrade to the first point's color so the fill is visible.
			if (!paint.dataUrl) {
				return { value: fallback, opacity: paint.opacity, def: null };
			}
			const bounds = meshBounds(paint);
			const id = `${idSeed}`;
			return {
				value: `url(#${id})`,
				opacity: paint.opacity,
				def: {
					id,
					kind: "mesh",
					dataUrl: paint.dataUrl,
					x: bounds.x,
					y: bounds.y,
					width: bounds.width,
					height: bounds.height,
					...(paint.transform
						? { transform: paintTransformMatrix(paint.transform) }
						: {}),
				},
			};
		}
	}
}

/** Resolves fill and stroke canvas paints from a resolved node style. */
export function canvasPaintsForStyle(
	style: ResolvedNodeStyle,
	idSeed: string,
	resolveImageHref?: CanvasImageHrefResolver,
): { readonly fill: CanvasPaint; readonly stroke: CanvasPaint } {
	return {
		fill: canvasPaint(
			style.fills,
			style.fill,
			`${idSeed}-fill`,
			resolveImageHref,
		),
		stroke: canvasPaint(
			style.strokes,
			style.stroke,
			`${idSeed}-stroke`,
			resolveImageHref,
		),
	};
}

/**
 * One paintable layer in a node's stacked appearance, ready to render as its own
 * geometry element. `key` is a stable, DOM-safe id derived from the role and the
 * SOURCE index (so it survives the bottom→top emit reordering), and doubles as the
 * paint def id. Returned by {@link canvasPaintLayersForStyle} only for nodes that
 * carry more than one fill or stroke; the single-paint path keeps using
 * {@link canvasPaintsForStyle} so its rendered element stays byte-identical.
 */
export type CanvasPaintLayer = {
	readonly key: string;
	readonly role: "fill" | "stroke";
	readonly paint: CanvasPaint;
};

const paintLayersForRole = (
	paints: readonly ResolvedPaint[],
	legacyColor: string,
	role: "fill" | "stroke",
	idSeed: string,
	resolveImageHref?: CanvasImageHrefResolver,
): readonly CanvasPaintLayer[] => {
	const fallback = fallbackColor(paints, legacyColor);
	return (
		paints
			.map((paint, index) => {
				const key = `${idSeed}-${role}-${index}`;
				return {
					key,
					role,
					paint: resolvedCanvasPaint(paint, fallback, key, resolveImageHref),
				};
			})
			// Skip layers that paint nothing (e.g. a stop-less gradient whose fallback is
			// "none") so the renderer never emits an inert element.
			.filter((layer) => layer.paint.value !== "none")
			// Source index 0 is the leading/primary paint and renders ON TOP, so emit in
			// reverse: the last source paint is drawn first (bottom), index 0 last (top).
			.reverse()
	);
};

/**
 * Resolves the FULL ordered fill and stroke stacks for a node, each in render
 * (bottom→top) order. Used for nodes with more than one fill/stroke; each layer
 * becomes its own geometry element so multiple paints are visible instead of
 * collapsing to the leading paint.
 */
export function canvasPaintLayersForStyle(
	style: ResolvedNodeStyle,
	idSeed: string,
	resolveImageHref?: CanvasImageHrefResolver,
): {
	readonly fills: readonly CanvasPaintLayer[];
	readonly strokes: readonly CanvasPaintLayer[];
} {
	return {
		fills: paintLayersForRole(
			style.fills,
			style.fill,
			"fill",
			idSeed,
			resolveImageHref,
		),
		strokes: paintLayersForRole(
			style.strokes,
			style.stroke,
			"stroke",
			idSeed,
			resolveImageHref,
		),
	};
}

/** Resolves an arbitrary fill paint stack in render (bottom→top) order. */
export function canvasPaintLayersForPaints(
	paints: readonly ResolvedPaint[],
	legacyColor: string,
	idSeed: string,
	resolveImageHref?: CanvasImageHrefResolver,
): readonly CanvasPaintLayer[] {
	return paintLayersForRole(
		paints,
		legacyColor,
		"fill",
		idSeed,
		resolveImageHref,
	);
}
