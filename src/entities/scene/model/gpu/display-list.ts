/**
 * GPU display-list compiler (E1 S2/S3 — see
 * `docs/gpu-canvas-convergence-e1-plan.md` D4/D5). Pure and DOM-free: compiles
 * a SAMPLED (already motion/grammar-sampled by `samplePresentation`) artboard
 * subtree into an ordered, POJO draw list the `shared/gpu` tessellator/renderer
 * consumes. This module knows nothing about motion sampling itself — the
 * caller supplies the sampled document — and nothing about live GPU handles;
 * see this file's sibling `capability.ts` for the (separately-evaluated, on
 * the COMMITTED document) support predicate that gates whether an artboard
 * reaches this compiler at all.
 *
 * Geometry normalization (rect/ellipse -> path contours) is cached by a
 * `WeakMap` keyed on the node's `geometry` object identity, so an unchanged
 * node (Immer structural sharing keeps its `geometry` reference stable across
 * edits that do not touch it) returns the IDENTICAL contour array reference on
 * every recompile — the widget-side flatten cache in `shared/gpu/flatten.ts`
 * keys on that same reference to skip re-tessellating unchanged geometry.
 *
 * S3 widens this compiler to also emit: gradient fill paints (still ONE fill
 * entry, `paint.kind !== "solid"`), a legacy uniform-stroke entry (a SEPARATE
 * `GpuStrokeDrawListEntry`, always immediately after its own node's fill
 * entry in `entries`, mirroring the SVG paint order "stroke draws over its
 * own fill" — see `VectorShape`'s single-`<path>` fast path in
 * `CanvasShell.tsx`), and an E0 width-profile-stroke outline (emitted as an
 * ADDITIONAL fill entry, also immediately after the node's own base-fill
 * entry — matching `VectorShape`'s outline render branch, which paints the
 * base fill THEN the outline path, both as ordinary fills). A node's own two
 * paint entries (fill, then stroke-or-outline) are never interleaved with a
 * DIFFERENT node's entries, so a caller partitioning `entries` by kind while
 * preserving relative order (see `widgets/canvas-shell/model/gpu-scene-
 * frame.ts`) reproduces the correct per-node "stroke over fill" order even
 * though fills and strokes end up in two separate GPU passes.
 *
 * S5 widens this compiler further to also emit: image fill paints (an
 * ORDINARY fill entry whose `paint` is image-like; S33 carries an optional
 * SVG `patternTransform` until the widget-layer frame builder folds it into
 * `worldToLocal`), placed image nodes (`kind: "image"` geometry — routed
 * through the SAME fill-entry construction as `"rect"`/`"ellipse"`, building
 * its rect contour via `buildRoundedRectShape` with zero radii, so no separate
 * quad-draw path exists), and mesh-gradient fill paints (emitted as a
 * `GpuMeshPendingPaint` — a THIRD, entities-layer-only variant of
 * {@link GpuDrawListPaint} carrying the raw mesh definition rather than a
 * resolved `href`, since rasterizing a mesh to a bitmap needs the SAME
 * `shared/mesh-raster`-backed cache the SVG renderer's widget-layer bridge
 * (`widgets/canvas-shell/model/mesh-raster-bridge.ts`) already owns — an
 * entities-layer module may not import that widgets-layer singleton, so the
 * widget-layer frame builder, not this compiler, resolves `GpuMeshPendingPaint`
 * into a real `GpuPaint.kind === "image"` draw before it ever reaches
 * `shared/gpu` — see `gpu-scene-frame.ts`'s doc comment for that resolution
 * step).
 *
 * S7/S30 widens this compiler once more to emit single-level hard silhouette
 * clip scopes (see `docs/gpu-canvas-convergence-e1-plan.md`'s decisions and
 * `entities/scene/model/mask-render.ts`'s `resolveSceneMaskPlan`, the SSOT
 * this feature reads its clip relations from). The caller
 * (`compileArtboardDrawList`) is handed the document's clip plan ALREADY
 * narrowed to single-application hard clip-compatible relations —
 * `clipSilhouetteByContentNodeId` maps a content node id straight to its
 * mask SOURCE node (`def.maskNode`, used AS-IS, matching how the SVG/`mask-
 * render.ts` adapter also reads that field directly with no live-override
 * merge) — so this compiler itself does zero mask-plan resolution or
 * eligibility filtering; it only emits `clip-begin`/`clip-end` around a
 * matched content node's own compile, and skips a `consumedMaskNodeIds`
 * member entirely (it is never painted as ordinary content, mirroring
 * `CanvasShell.tsx`'s `canRenderArtboardNode` guard).
 */
import { isWrapperContainer } from "@/entities/scene/model/appearance-targets";
import {
	imagePaintHref,
	imagePlacementForNode,
} from "@/entities/scene/model/assets";
import {
	type CanvasPaint,
	canvasPaintsForStyle,
} from "@/entities/scene/model/canvas-paint";
import {
	buildRoundedRectShape,
	filletPolygonShape,
	resolveCornerSmoothing,
	starVertices,
} from "@/entities/scene/model/corner-geometry";
import { meshBounds } from "@/entities/scene/model/mesh-edit";
import {
	ellipseToPathGeometry,
	rectToPathGeometry,
} from "@/entities/scene/model/path-boolean/path-conversion";
import {
	composeMatrix,
	getGeometryBounds,
	type Matrix2D,
	matrixFromTransform,
} from "@/entities/scene/model/rendering";
import { selectNodeArtboardMapping } from "@/entities/scene/model/selectors";
import { getStrokeWidthProfileOutline } from "@/entities/scene/model/stroke-outline";
import {
	type ResolvedGradientStop,
	type ResolvedImageReferencePaint,
	type ResolvedMeshGradientPaint,
	type ResolvedNodeStyle,
	resolveNodeStyle,
} from "@/entities/scene/model/style-resolve";
import type {
	BlendMode,
	Bounds,
	FillRule,
	ImageAsset,
	SceneAsset,
	SceneDocument,
	TextGeometry,
	Vec2,
	VectorNode,
} from "@/entities/scene/model/types";
import type { AePoint, AeShape } from "@/shared/glammer/ae-shape";
import {
	type GpuBlendMode,
	type GpuGradientStop,
	type GpuImageFit,
	type GpuImageSourceRect,
	type GpuPaint,
	type GpuStrokePaint,
	MAX_GRADIENT_STOPS,
} from "@/shared/gpu/types";

/** sRGB straight-alpha color, each channel `0..1` — matches `shared/gpu`'s `GpuColor`. */
export type GpuDrawColor = {
	readonly r: number;
	readonly g: number;
	readonly b: number;
	readonly a: number;
};

/**
 * A mesh-gradient fill paint AWAITING rasterization (E1 S5) — this compiler's
 * OWN entities-layer paint representation, never `shared/gpu`'s `GpuPaint`
 * (which has no mesh concept at all; `shared/gpu` only ever sees a resolved
 * `href` once rasterization has happened). `paint` is the raw resolved mesh
 * definition (points/rows/cols/transform — everything
 * `widgets/canvas-shell/model/mesh-raster-bridge.ts`'s
 * `createMeshStyleRasterizer` needs to reproduce the IDENTICAL bitmap the SVG
 * renderer's own call to that same bridge singleton produces, so GPU and SVG
 * share one cache entry and agree at the pixel level); `rect` is the
 * node-local `userSpaceOnUse` placement box (`meshBounds(paint)`, the SAME
 * bounds the SVG `<pattern>` uses). `opacity` is this leaf's full opacity
 * chain (inherited-ancestor product × this leaf's own `style.opacity` × the
 * paint's own `fill.opacity`, mirroring the image-reference branch's
 * `fill.opacity * overallOpacity` fold exactly) — carried here rather than
 * left for the widget-layer frame builder to recompute, since that builder
 * only sees the raw `ResolvedMeshGradientPaint.opacity` (the paint's OWN
 * alpha, not the leaf's full chain) and has no access to `overallOpacity`.
 * The widget-layer frame builder (`gpu-scene-frame.ts`) is the ONLY consumer
 * of this type — it rasterizes `paint` (reusing that same bridge singleton),
 * then constructs an ordinary `GpuPaint.kind === "image"` from the resulting
 * data URL and this `opacity`, before this draw ever reaches `shared/gpu`.
 */
export type GpuMeshPendingPaint = {
	readonly kind: "mesh-pending";
	readonly paint: ResolvedMeshGradientPaint;
	readonly rect: Bounds;
	readonly opacity: number;
};

export type GpuDrawListImagePaint = Extract<
	GpuPaint,
	{ readonly kind: "image" }
> & {
	/**
	 * SVG `patternTransform` in node-local paint space. The widget-layer frame
	 * builder folds its inverse into `worldToLocal` before handing the paint to
	 * `shared/gpu`, so the RHI stays scene-agnostic and transform-free.
	 */
	readonly transform?: Matrix2D;
};

type GpuDrawListDirectPaint =
	| Exclude<GpuPaint, { readonly kind: "image" }>
	| GpuDrawListImagePaint;

/**
 * One static text node awaiting widget-layer Canvas2D rasterization (S9.x/S29).
 * The entities-layer display-list compiler stays DOM-free: it carries the scene
 * text geometry plus resolved fill/stroke facts, while `gpu-scene-frame.ts`
 * owns browser canvas measurement/raster output and then resolves this to a
 * regular `GpuPaint.kind === "image"` draw for `shared/gpu`.
 */
type GpuTextRasterPaint =
	| { readonly kind: "solid"; readonly color: GpuDrawColor }
	| {
			readonly kind: "linear-gradient";
			readonly from: Vec2;
			readonly to: Vec2;
			readonly stops: readonly GpuGradientStop[];
	  }
	| {
			readonly kind: "radial-gradient";
			readonly center: Vec2;
			readonly radius: number;
			readonly stops: readonly GpuGradientStop[];
	  }
	| {
			readonly kind: "image";
			readonly href: string;
			readonly fit: GpuImageFit;
	  }
	| {
			readonly kind: "mesh";
			readonly paint: ResolvedMeshGradientPaint;
			readonly rect: Bounds;
	  };

type GpuTextRasterStroke = {
	readonly paint: Exclude<
		GpuTextRasterPaint,
		{ readonly kind: "image" } | { readonly kind: "mesh" }
	>;
	readonly opacity: number;
	readonly width: number;
	readonly cap: ResolvedNodeStyle["strokeCap"];
	readonly join: ResolvedNodeStyle["strokeJoin"];
	readonly miterLimit: number;
};

export type GpuTextPendingPaint = {
	readonly kind: "text-pending";
	readonly geometry: TextGeometry;
	readonly rasterBounds: Bounds;
	readonly fill: GpuTextRasterPaint | null;
	readonly stroke: GpuTextRasterStroke | null;
	readonly fillOpacity: number;
	readonly opacity: number;
};

type GpuTextRasterFill = NonNullable<GpuTextPendingPaint["fill"]>;

/**
 * One fill's paint as emitted by THIS compiler — `shared/gpu`'s `GpuPaint`
 * (solid, linear/radial gradient, or an already-resolved image — S3/S5)
 * widened with the paint kinds that need a widget-layer rasterization step
 * before they become a real `GpuPaint`: {@link GpuMeshPendingPaint} (mesh
 * gradients) and {@link GpuTextPendingPaint} (S9.0 static text). Kept as a
 * SEPARATE type (not folded into `shared/gpu/types.ts::GpuPaint` itself)
 * because `shared/gpu` must stay scene-agnostic and rasterization-free — see
 * this file's top doc comment.
 */
export type GpuDrawListPaint =
	| GpuDrawListDirectPaint
	| GpuMeshPendingPaint
	| GpuTextPendingPaint;

export type GpuStrokeDrawListPaint =
	| Exclude<GpuStrokePaint, { readonly kind: "image" }>
	| GpuDrawListImagePaint;

/**
 * One fill path draw, in document paint order. `paint` is either a direct GPU
 * paint (solid, linear/radial gradient, or image; S33 image paints may carry
 * a temporary draw-list-only `patternTransform`) or a {@link GpuMeshPendingPaint}
 * awaiting widget-layer rasterization, with gradient/image coordinates kept in
 * NODE-LOCAL space (see `GpuPaint`'s doc comment for why no world-space
 * projection happens here); every stop's alpha and a solid paint's `color.a`
 * already fold in this leaf's full opacity chain (inherited-ancestor product
 * × this leaf's own `style.opacity` × the paint's own `fill.opacity` from
 * `canvasPaintsForStyle`), so `shared/gpu` never needs a separate paint-level
 * opacity scalar.
 *
 * `blendMode` (E1 S6/S31) is set only when the node's resolved `BlendMode` is one
 * of the {@link GpuBlendMode} fixed-function values AND the capability
 * predicate (`capability.ts`) has already admitted the artboard — this
 * compiler does not itself re-check the S6/S31 gates, mirroring how it already
 * trusts the capability predicate for every other fail-closed reason (an
 * artboard reaching this compiler is, by construction, one the predicate
 * already approved). `undefined` means ordinary "normal" source-over.
 */
export type GpuDrawListEntry = {
	readonly kind: "fill";
	readonly nodeId: string;
	/** Node-local-geometry -> world (document/pasteboard) space affine matrix. */
	readonly worldTransform: Matrix2D;
	/** Node-local-geometry-space contours (outer + holes), pre-normalization to world space. */
	readonly contours: readonly AeShape[];
	readonly fillRule: FillRule;
	readonly paint: GpuDrawListPaint;
	/** Node-local-geometry-space tight paint bounds for the cover-pass quad. */
	readonly coverBounds: Bounds;
	/** Fixed-function blend variant this fill (or E0 outline) draws with; `undefined` means "normal". Never set on a {@link GpuStrokeDrawListEntry}. */
	readonly blendMode?: GpuBlendMode;
};

/**
 * Normalizes a resolved (already positive-filtered, see
 * `style-resolve.ts::normalizeStrokeDash`) `strokeDash` array to SVG
 * `stroke-dasharray` semantics (E1 S8 — see
 * `docs/gpu-canvas-convergence-e1-plan.md`'s S8 decisions): an odd-length
 * pattern is repeated once to become even (`[a,b,c]` -> `[a,b,c,a,b,c]`, so
 * the dash/gap alternation completes a whole period), and an empty array
 * passes through unchanged (undashed). This is done ONCE here — at
 * display-list compile time, in SCREEN-px authored units — rather than
 * per-frame; the resulting even-length array is what `capability.ts`'s
 * `"stroke_dash"` gate measures against {@link MAX_DASH_PATTERN_ENTRIES}, and
 * what `buildStrokeEntry` stores on the compiled stroke entry, so both
 * consumers agree on the exact same normalized shape.
 */
export function normalizeDashPattern(
	strokeDash: readonly number[],
): readonly number[] {
	if (strokeDash.length === 0) return strokeDash;
	return strokeDash.length % 2 === 0
		? strokeDash
		: [...strokeDash, ...strokeDash];
}

/** One legacy uniform-stroke draw, in document paint order — see this file's doc comment for ordering relative to its own node's fill entry. */
export type GpuStrokeDrawListEntry = {
	readonly kind: "stroke";
	readonly nodeId: string;
	readonly worldTransform: Matrix2D;
	readonly contours: readonly AeShape[];
	readonly paint: GpuStrokeDrawListPaint;
	readonly strokeWidth: number;
	readonly cap: ResolvedNodeStyle["strokeCap"];
	readonly join: ResolvedNodeStyle["strokeJoin"];
	readonly miterLimit: number;
	/** Node-local-geometry-space tight paint bounds (own geometry only, unexpanded — the frame assembler adds the miter-reach margin in world space, see `gpu-scene-frame.ts`). */
	readonly coverBounds: Bounds;
	/**
	 * Normalized (even-length, see {@link normalizeDashPattern}) SCREEN-px dash
	 * pattern (E1 S8), present only when the capability gate has admitted this
	 * node's dash (`strokeCap === "butt"` and normalized length `<=
	 * MAX_DASH_PATTERN_ENTRIES` — see `capability.ts`'s `"stroke_dash"` gate).
	 * Absent means undashed.
	 */
	readonly dashPattern?: readonly number[];
	/** SCREEN-px dash phase offset (E1 S8), only meaningful alongside {@link dashPattern}. */
	readonly dashOffset?: number;
};

/**
 * Opens a single-level hard clip-path scope (E1 S7 — see
 * `docs/gpu-canvas-convergence-e1-plan.md`'s S7 decisions). Emitted
 * immediately before the masked content node's own compile in
 * {@link compileNode}, carrying the mask SOURCE node's own contours/fillRule/
 * transform/bounds — NEVER the content node's — so the frame builder
 * (`gpu-scene-frame.ts`) can flatten/fan the silhouette exactly like an
 * ordinary fill entry (reusing the SAME `flattenCache`/`fanTriangulateRings`
 * path) before handing it to `shared/gpu`'s stencil-materialize pass.
 */
export type GpuClipBeginEntry = {
	readonly kind: "clip-begin";
	/** Node-local-geometry -> world (document/pasteboard) space affine matrix for the MASK SOURCE node (an artboard-origin-seeded transform — see {@link compileNode}'s clip-scope branch for why this is never the content node's own ancestor chain). */
	readonly worldTransform: Matrix2D;
	/** The mask source's own node-local-geometry-space contours (outer + holes). */
	readonly contours: readonly AeShape[];
	readonly fillRule: FillRule;
	/** The mask source's own node-local-geometry-space tight bounds (`getGeometryBounds(maskNode.geometry)`), pre-world-transform — mirrors {@link GpuDrawListEntry.coverBounds}'s contract exactly. */
	readonly coverBounds: Bounds;
};

/**
 * Closes the clip scope opened by the preceding {@link GpuClipBeginEntry} for
 * the SAME masked content node (E1 S7). Carries the identical
 * `worldTransform`/`coverBounds` its own `clip-begin` used (the SAME mask
 * source silhouette, not recomputed) so the frame builder can size the
 * clear-pass cover quad without threading extra state between the two
 * entries — see {@link GpuClipBeginEntry}'s doc comment.
 */
export type GpuClipEndEntry = {
	readonly kind: "clip-end";
	readonly worldTransform: Matrix2D;
	readonly contours: readonly AeShape[];
	readonly fillRule: FillRule;
	readonly coverBounds: Bounds;
};

export type GpuDrawListPaintEntry =
	| GpuDrawListEntry
	| GpuStrokeDrawListEntry
	| GpuClipBeginEntry
	| GpuClipEndEntry;

export type GpuDrawList = {
	readonly artboardId: string;
	readonly entries: readonly GpuDrawListPaintEntry[];
};

type ContourCacheEntry = {
	readonly contours: readonly AeShape[];
	readonly fillRule: FillRule;
};

/**
 * Per-node-geometry contour cache. Keyed on the `NodeGeometry` object itself
 * (not the owning `VectorNode`, which changes reference on every unrelated
 * edit via Immer's per-field structural sharing) so an edit to a DIFFERENT
 * node, or a transform-only edit to THIS node, never invalidates the cached
 * contours.
 */
const contourCache = new WeakMap<VectorNode["geometry"], ContourCacheEntry>();
const zeroAePoint = (): AePoint => [0, 0];

/**
 * Normalizes a node's own geometry to path contours (outer + holes), or
 * `null` when the geometry kind is not GPU-normalizable in S2 (the caller —
 * `capability.ts` — is expected to have already excluded the artboard in that
 * case; this returns `null` rather than throwing so the compiler stays total
 * for any document it is handed).
 */
function contoursForGeometry(
	geometry: VectorNode["geometry"],
): ContourCacheEntry | null {
	const cached = contourCache.get(geometry);
	if (cached) return cached;

	let entry: ContourCacheEntry | null;
	switch (geometry.kind) {
		case "rect": {
			const path = rectToPathGeometry(geometry);
			entry = {
				contours: [path.shape, ...(path.subpaths ?? [])],
				fillRule: path.fillRule ?? "nonzero",
			};
			break;
		}
		case "ellipse": {
			const path = ellipseToPathGeometry(geometry);
			entry = {
				contours: [path.shape, ...(path.subpaths ?? [])],
				fillRule: path.fillRule ?? "nonzero",
			};
			break;
		}
		case "line": {
			entry = {
				contours: [
					{
						type: "Shape",
						closed: false,
						vertices: [
							[geometry.start.x, geometry.start.y],
							[geometry.end.x, geometry.end.y],
						],
						inTangents: [zeroAePoint(), zeroAePoint()],
						outTangents: [zeroAePoint(), zeroAePoint()],
					},
				],
				fillRule: "nonzero",
			};
			break;
		}
		case "polygon": {
			entry = {
				contours: [
					filletPolygonShape(
						geometry.points,
						geometry.cornerRadius ?? 0,
						resolveCornerSmoothing(geometry),
					),
				],
				fillRule: "nonzero",
			};
			break;
		}
		case "star": {
			entry = {
				contours: [
					filletPolygonShape(
						starVertices(geometry),
						geometry.cornerRadius ?? 0,
						resolveCornerSmoothing(geometry),
					),
				],
				fillRule: "nonzero",
			};
			break;
		}
		case "path": {
			entry = {
				contours: [geometry.shape, ...(geometry.subpaths ?? [])],
				fillRule: geometry.fillRule ?? "nonzero",
			};
			break;
		}
		case "text": {
			const shape = buildRoundedRectShape(geometry.bounds, {
				radii: { tl: 0, tr: 0, br: 0, bl: 0 },
			});
			entry = { contours: [shape], fillRule: "nonzero" };
			break;
		}
		case "image": {
			// A placed image node (E1 S5) is a plain axis-aligned rect placement —
			// `ImageGeometry` has no `cornerRadius` field at all (unlike
			// `RectGeometry`), so this calls `buildRoundedRectShape` directly with
			// all-zero radii rather than going through `rectToPathGeometry` (which
			// requires a full `RectGeometry`), matching `PlacedImageNode`'s own
			// SVG render in `CanvasShell.tsx` (a plain `<image>`/`<rect>`, never
			// rounded).
			const shape = buildRoundedRectShape(geometry.bounds, {
				radii: { tl: 0, tr: 0, br: 0, bl: 0 },
			});
			entry = { contours: [shape], fillRule: "nonzero" };
			break;
		}
		default:
			entry = null;
	}

	if (entry) contourCache.set(geometry, entry);
	return entry;
}

/**
 * Resolves the live geometry+transform for one entry: `override` (when
 * provided by the caller) replaces the base node, mirroring `SceneNode`'s
 * `override ?? baseNode` rule — including the duplicate-intent guard, which
 * the caller is expected to have already applied when building `overrides`
 * (see `GpuSceneCanvas.tsx`).
 */
function resolvedNode(
	baseNode: VectorNode,
	overrides: ReadonlyMap<string, VectorNode> | null,
): VectorNode {
	return overrides?.get(baseNode.id) ?? baseNode;
}

/**
 * Narrows a resolved {@link BlendMode} to its {@link GpuBlendMode} pipeline
 * variant, or `undefined` for "normal" or any of the other modes outside
 * the E1 S6/S31 fixed-function subset (see `shared/gpu/types.ts::GpuBlendMode`'s
 * doc comment). The capability predicate (`capability.ts`) has already
 * excluded every artboard where a non-subset mode would reach this compiler
 * on an admitted leaf — this is a total, explicit switch (no unchecked cast)
 * so a FUTURE `BlendMode` addition fails closed (falls through to `undefined`
 * / "normal") rather than silently widening what this compiler emits.
 */
function gpuBlendModeFor(mode: BlendMode): GpuBlendMode | undefined {
	switch (mode) {
		case "multiply":
		case "screen":
		case "darken":
		case "lighten":
		case "exclusion":
			return mode;
		default:
			return undefined;
	}
}

/** Parses `#rrggbb`/`#rgb` into unit-scale (0..1) sRGB channels, or `null` if unparsable. */
function hexToUnitRgb(
	value: string,
): { readonly r: number; readonly g: number; readonly b: number } | null {
	const hex = value.trim();
	const match = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex);
	if (!match) return null;
	const digits = match[1];
	const expand = (short: string): string => short + short;
	const full =
		digits.length === 3 ? digits.split("").map(expand).join("") : digits;
	return {
		r: Number.parseInt(full.slice(0, 2), 16) / 255,
		g: Number.parseInt(full.slice(2, 4), 16) / 255,
		b: Number.parseInt(full.slice(4, 6), 16) / 255,
	};
}

/**
 * Builds one fill's {@link GpuDrawListPaint} from `resolvedStyle`'s LEADING
 * paint (the caller has already verified — via the S3/S5 capability
 * predicate — that the artboard has zero or one fill, so
 * `resolvedStyle.fills[0]` is the only paint that can ever reach here).
 * `overallOpacity` is this leaf's full opacity chain (inherited-ancestor
 * product × this leaf's own `style.opacity` × the paint's own alpha from
 * `canvasPaintsForStyle`) — folded directly into every solid color's/gradient
 * stop's alpha here so `shared/gpu` never needs a separate opacity scalar
 * (see `GpuDrawListEntry`'s doc comment). Returns `null` when the leading
 * paint is unresolvable (capability already excluded these — an unparsable
 * solid/stop color, or an image paint whose href does not resolve) — same
 * fail-closed contract as S2 — a node whose fill cannot be resolved to a
 * drawable paint simply contributes no fill entry, exactly like S2's
 * `hexToUnitRgb` failure path did.
 *
 * The mesh-gradient branch is checked BEFORE the `!fill.def` solid fallback
 * below (a post-S5-review fix): `canvasPaintsForStyle` never rasterizes a
 * mesh itself (see `canvasPaint`'s "no dataUrl yet" fallback branch), so
 * `fill.def` is ALWAYS `null` for a mesh-gradient leading paint — checking
 * `!fill.def` first would unconditionally short-circuit into the solid
 * fallback for every mesh paint, making the `GpuMeshPendingPaint` branch
 * below permanently unreachable.
 */
function buildFillPaint(
	resolvedStyle: ResolvedNodeStyle,
	overallOpacity: number,
	geometryBounds: Bounds,
	resolveImageHref: (paint: ResolvedImageReferencePaint) => string | undefined,
): GpuDrawListPaint | null {
	const { fill } = canvasPaintsForStyle(
		resolvedStyle,
		"gpu-display-list",
		resolveImageHref,
	);
	if (fill.value === "none") return null;

	// Reading the RAW resolved paint (rather than `fill.def`, which is
	// SVG-string-encoded) keeps every field a plain number/string, mirroring
	// how the gradient branch below already does this.
	const leadingPaint = resolvedStyle.fills[0];
	if (!leadingPaint) return null;

	if (leadingPaint.kind === "mesh-gradient") {
		if (leadingPaint.transform) return null;
		// Deferred to the widget-layer frame builder — see `GpuMeshPendingPaint`'s
		// doc comment for why rasterization cannot happen in this DOM-free,
		// widgets-import-forbidden compiler. `meshBounds` is the SAME
		// `userSpaceOnUse` rect the SVG `<pattern>` uses (`canvas-paint.ts`'s
		// `"mesh-gradient"` branch), computed fresh here rather than read off
		// `fill.def` (mesh raster hasn't happened yet, so `fill.def` is `null` at
		// this point — see `canvasPaint`'s "no dataUrl yet" fallback branch).
		return {
			kind: "mesh-pending",
			paint: leadingPaint,
			rect: meshBounds(leadingPaint),
			opacity: fill.opacity * overallOpacity,
		};
	}

	if (!fill.def) {
		const rgb = hexToUnitRgb(fill.value);
		if (!rgb) return null;
		return {
			kind: "solid",
			color: { r: rgb.r, g: rgb.g, b: rgb.b, a: fill.opacity * overallOpacity },
		};
	}

	if (leadingPaint.kind === "image-reference") {
		// This branch is only reachable when `fill.def` exists (the `!fill.def`
		// check above already returned otherwise) — `fill.def` is built by
		// `canvasPaintsForStyle`'s call to `resolveImageHref` a few lines up, so
		// `fill.def.kind === "image"` here means that SAME resolve already
		// succeeded, and `fill.def.href` is its resolved href. An
		// image-reference fill whose href does NOT resolve never reaches this
		// branch at all — it takes the `!fill.def` fallback path above instead,
		// producing the SAME fallback color/none the SVG renderer paints for
		// that node (both renderers resolve paints through this one shared
		// `canvasPaintsForStyle` call), which is why the S5 capability
		// predicate does not need an `"image_asset"` check for FILL paints —
		// that reason token is only emitted for a placed-image NODE's own
		// unresolvable asset (see `capability.ts`'s `geometry.kind === "image"`
		// branch), a structurally different case from a fill paint role.
		// `rect` is this leaf's OWN geometry bounds. The image shader applies
		// `fit`/`crop` from this same normalized 0..1 box, matching the SVG
		// renderer's `objectBoundingBox` pattern + preserveAspectRatio mapping.
		if (fill.def.kind !== "image") return null;
		return {
			kind: "image",
			href: fill.def.href,
			rect: geometryBounds,
			fit: gpuImageFit(leadingPaint.fit),
			...(leadingPaint.transform ? { transform: leadingPaint.transform } : {}),
			opacity: fill.opacity * overallOpacity,
		};
	}

	if (
		leadingPaint.kind !== "linear-gradient" &&
		leadingPaint.kind !== "radial-gradient"
	) {
		return null;
	}
	if (
		leadingPaint.transform ||
		leadingPaint.stops.length > MAX_GRADIENT_STOPS
	) {
		return null;
	}
	const stops = gpuGradientStops(
		leadingPaint.stops,
		fill.opacity * overallOpacity,
	);
	if (!stops) return null;

	return leadingPaint.kind === "linear-gradient"
		? {
				kind: "linear-gradient",
				from: { x: leadingPaint.from.x, y: leadingPaint.from.y },
				to: { x: leadingPaint.to.x, y: leadingPaint.to.y },
				stops,
			}
		: {
				kind: "radial-gradient",
				center: { x: leadingPaint.center.x, y: leadingPaint.center.y },
				// Mirrors the SVG/canvas renderer's own circular-radius contract
				// exactly (`canvasPaintsForStyle`/the SVG exporter's
				// `radialGradientDef` both use `Math.max(radius.x, radius.y, 0)`)
				// — an elliptical radius is never represented, on ANY render
				// surface, including this one.
				radius: Math.max(leadingPaint.radius.x, leadingPaint.radius.y, 0),
				stops,
			};
}

/**
 * Converts a resolved gradient's stops to `shared/gpu`'s straight-alpha
 * `GpuGradientStop[]`, folding `overallPaintOpacity` (this fill's opacity
 * chain, see {@link buildFillPaint}) into every stop's own alpha — `null` if
 * ANY stop's color is unparsable (fail-closed; the S3 capability predicate is
 * expected to have already excluded this document, so this is a total-
 * function safety net, not the primary gate).
 */
function gpuGradientStops(
	stops: readonly ResolvedGradientStop[],
	overallPaintOpacity: number,
): readonly GpuGradientStop[] | null {
	const converted: GpuGradientStop[] = [];
	for (const stop of stops) {
		const rgb = hexToUnitRgb(stop.color);
		if (!rgb) return null;
		converted.push({
			offset: stop.offset,
			color: {
				r: rgb.r,
				g: rgb.g,
				b: rgb.b,
				a: stop.opacity * overallPaintOpacity,
			},
		});
	}
	return converted;
}

/**
 * Builds one node's legacy uniform-stroke entry, or `null` when the node has
 * no uniform stroke to draw (no visible stroke paint, zero width, an
 * unsupported stroke paint server, or an active E0 profile outline REPLACING
 * the uniform stroke — see `getStrokeWidthProfileOutline`'s doc and this
 * file's top comment). Reads the SAME `contourEntry`/`resolvedStyle` the fill
 * entry was built from so a uniform stroke always strokes the identical
 * geometry its own fill filled (both entries share one `worldTransform` and
 * one `contours` reference, matching `renderVectorGeometry`'s single shared
 * `<path d=...>` in `CanvasShell.tsx`). `overallOpacity` is this leaf's full
 * opacity chain (see {@link buildFillPaint}'s doc comment) — folded into the
 * solid color alpha or every gradient stop alongside the stroke paint's own
 * opacity.
 */
function buildStrokeEntry(
	node: VectorNode,
	worldTransform: Matrix2D,
	contourEntry: ContourCacheEntry,
	resolvedStyle: ResolvedNodeStyle,
	overallOpacity: number,
	resolveImageHref: (paint: ResolvedImageReferencePaint) => string | undefined,
): GpuStrokeDrawListEntry | null {
	const { stroke } = canvasPaintsForStyle(
		resolvedStyle,
		"gpu-display-list",
		resolveImageHref,
	);
	if (stroke.value === "none" || resolvedStyle.strokeWidth <= 0) return null;
	const leadingPaint = resolvedStyle.strokes[0];
	if (!leadingPaint) return null;
	const coverBounds = getGeometryBounds(node.geometry);
	let paint: GpuStrokePaint | null = null;
	if (!stroke.def) {
		const rgb = hexToUnitRgb(stroke.value);
		if (!rgb) return null;
		paint = {
			kind: "solid",
			color: {
				r: rgb.r,
				g: rgb.g,
				b: rgb.b,
				a: stroke.opacity * overallOpacity,
			},
		};
	} else if (
		leadingPaint.kind === "linear-gradient" ||
		leadingPaint.kind === "radial-gradient"
	) {
		if (
			leadingPaint.transform ||
			leadingPaint.stops.length > MAX_GRADIENT_STOPS
		) {
			return null;
		}
		const stops = gpuGradientStops(
			leadingPaint.stops,
			stroke.opacity * overallOpacity,
		);
		if (!stops) return null;
		paint =
			leadingPaint.kind === "linear-gradient"
				? {
						kind: "linear-gradient",
						from: { x: leadingPaint.from.x, y: leadingPaint.from.y },
						to: { x: leadingPaint.to.x, y: leadingPaint.to.y },
						stops,
					}
				: {
						kind: "radial-gradient",
						center: { x: leadingPaint.center.x, y: leadingPaint.center.y },
						radius: Math.max(leadingPaint.radius.x, leadingPaint.radius.y, 0),
						stops,
					};
	} else if (
		leadingPaint.kind === "image-reference" &&
		stroke.def.kind === "image"
	) {
		if (
			leadingPaint.fit === "tile" ||
			coverBounds.width <= 0 ||
			coverBounds.height <= 0
		) {
			return null;
		}
		paint = {
			kind: "image",
			href: stroke.def.href,
			rect: coverBounds,
			fit: gpuImageFit(leadingPaint.fit),
			...(leadingPaint.transform ? { transform: leadingPaint.transform } : {}),
			opacity: stroke.opacity * overallOpacity,
		};
	}
	if (!paint) return null;

	// E1 S8: `resolvedStyle.strokeDash` is already positive-filtered (see
	// `style-resolve.ts::normalizeStrokeDash`); this compiler trusts that
	// `capability.ts` has already admitted the artboard (butt cap, normalized
	// length <= MAX_DASH_PATTERN_ENTRIES, straight-segment geometry — see that
	// predicate's `"stroke_dash"` gate) exactly like every other fail-closed
	// reason this file's top doc comment already documents, so no re-check
	// happens here. `dashOffset` reads the RESOLVED
	// `resolvedStyle.strokeDashoffset` (finite-clamped, sign PRESERVED, by
	// `style-resolve.ts::resolveNodeStyle`) rather than the raw
	// `node.style.strokeDashoffset`, matching the SAME resolved source the SVG
	// canvas/export presentation path reads (`style-presentation.ts::
	// strokePresentation`) — a single resolved source keeps GPU and SVG in
	// phase agreement. Emitted whenever non-zero (not just when positive): a
	// negative offset is a real, documented "reversed sweep" phase both SVG's
	// native `stroke-dashoffset` and this GPU path accept — `!== 0`, not
	// `> 0`, mirrors `strokePresentation`'s identical non-default-value gate.
	const dashPattern = normalizeDashPattern(resolvedStyle.strokeDash);

	return {
		kind: "stroke",
		nodeId: node.id,
		worldTransform,
		contours: contourEntry.contours,
		paint,
		strokeWidth: resolvedStyle.strokeWidth,
		cap: resolvedStyle.strokeCap,
		join: resolvedStyle.strokeJoin,
		miterLimit: resolvedStyle.strokeMiterLimit,
		coverBounds,
		...(dashPattern.length > 0 ? { dashPattern } : {}),
		...(dashPattern.length > 0 && resolvedStyle.strokeDashoffset !== 0
			? { dashOffset: resolvedStyle.strokeDashoffset }
			: {}),
	};
}

const textRasterStops = (
	stops: readonly {
		readonly offset: number;
		readonly color: string;
		readonly opacity: number;
	}[],
): readonly GpuGradientStop[] | null => {
	const resolved: GpuGradientStop[] = [];
	for (const stop of stops) {
		const rgb = hexToUnitRgb(stop.color);
		if (!rgb) return null;
		resolved.push({
			offset: stop.offset,
			color: { r: rgb.r, g: rgb.g, b: rgb.b, a: stop.opacity },
		});
	}
	return resolved;
};

function buildTextRasterFill(
	fill: CanvasPaint,
	leadingPaint: ResolvedNodeStyle["fills"][number] | undefined,
): GpuTextRasterFill | null {
	if (fill.value === "none") return null;
	if (leadingPaint?.kind === "mesh-gradient") {
		if (leadingPaint.transform) return null;
		return {
			kind: "mesh",
			paint: leadingPaint,
			rect: meshBounds(leadingPaint),
		};
	}
	if (!fill.def) {
		const rgb = hexToUnitRgb(fill.value);
		return rgb ? { kind: "solid", color: { ...rgb, a: 1 } } : null;
	}
	if (fill.def.kind === "linear" && fill.def.linear) {
		const stops = textRasterStops(fill.def.stops);
		if (!stops || stops.length === 0) return null;
		return {
			kind: "linear-gradient",
			from: { x: fill.def.linear.x1, y: fill.def.linear.y1 },
			to: { x: fill.def.linear.x2, y: fill.def.linear.y2 },
			stops,
		};
	}
	if (fill.def.kind === "radial" && fill.def.radial) {
		const stops = textRasterStops(fill.def.stops);
		if (!stops || stops.length === 0) return null;
		return {
			kind: "radial-gradient",
			center: { x: fill.def.radial.cx, y: fill.def.radial.cy },
			radius: fill.def.radial.r,
			stops,
		};
	}
	if (
		fill.def.kind === "image" &&
		fill.def.fit !== "tile" &&
		!fill.def.transform
	) {
		return {
			kind: "image",
			href: fill.def.href,
			fit: gpuImageFit(fill.def.fit),
		};
	}
	return null;
}

function buildTextRasterStroke(
	stroke: CanvasPaint,
	leadingPaint: ResolvedNodeStyle["strokes"][number] | undefined,
	resolvedStyle: ResolvedNodeStyle,
): GpuTextRasterStroke | null {
	if (stroke.value === "none" || resolvedStyle.strokeWidth <= 0) return null;
	const paint = buildTextRasterFill(stroke, leadingPaint);
	if (!paint || paint.kind === "image" || paint.kind === "mesh") return null;
	return {
		paint,
		opacity: stroke.opacity,
		width: resolvedStyle.strokeWidth,
		cap: resolvedStyle.strokeCap,
		join: resolvedStyle.strokeJoin,
		miterLimit: resolvedStyle.strokeMiterLimit,
	};
}

const expandBounds = (bounds: Bounds, amount: number): Bounds =>
	amount > 0
		? {
				x: bounds.x - amount,
				y: bounds.y - amount,
				width: bounds.width + amount * 2,
				height: bounds.height + amount * 2,
			}
		: bounds;

const textStrokeRasterOutset = (stroke: GpuTextRasterStroke | null): number => {
	if (!stroke) return 0;
	return Math.max(stroke.width, (stroke.width * stroke.miterLimit) / 2);
};

const gpuImageFit = (fit: ResolvedImageReferencePaint["fit"]): GpuImageFit =>
	fit === "fit" || fit === "crop" ? fit : "fill";

const finitePositive = (value: number | undefined): number | undefined =>
	typeof value === "number" && Number.isFinite(value) && value > 0
		? value
		: undefined;

const imageAssetDimensions = (
	assetId: string,
	assets: readonly SceneAsset[] | undefined,
): { readonly width?: number; readonly height?: number } => {
	const asset = assets?.find(
		(candidate): candidate is ImageAsset =>
			candidate.kind === "image" && candidate.id === assetId,
	);
	return {
		width: finitePositive(asset?.width),
		height: finitePositive(asset?.height),
	};
};

const placedImageSourceRect = (
	node: VectorNode,
	assets: readonly SceneAsset[] | undefined,
): GpuImageSourceRect | undefined => {
	const placement = imagePlacementForNode(node);
	const crop = placement?.crop;
	if (!crop) return undefined;
	const dimensions = imageAssetDimensions(placement.assetId, assets);
	const sourceWidth = dimensions.width ?? crop.width;
	const sourceHeight = dimensions.height ?? crop.height;
	if (sourceWidth <= 0 || sourceHeight <= 0) return undefined;
	return {
		x: crop.x / sourceWidth,
		y: crop.y / sourceHeight,
		width: crop.width / sourceWidth,
		height: crop.height / sourceHeight,
	};
};

/**
 * Builds one static text node as a pending raster fill/stroke bitmap (S9.x/S29),
 * or `null` when the text has no visible supported paint. Capability has already
 * excluded text cases this raster path intentionally does not model yet: active
 * text animators, dashed/blurred/profile text strokes, image/mesh stroke paints,
 * underlined stroked text, image `tile`/transform, and unsupported blend modes.
 * This compiler therefore only needs to carry the authored text geometry and
 * resolved paint facts into the widget layer, which will rasterize it with
 * Canvas2D at the current zoom bucket/DPR before handing `shared/gpu` a regular
 * image fill.
 */
function buildTextEntry(
	node: VectorNode,
	worldTransform: Matrix2D,
	contourEntry: ContourCacheEntry,
	resolvedStyle: ResolvedNodeStyle,
	overallOpacity: number,
	resolveImageHref: (paint: ResolvedImageReferencePaint) => string | undefined,
): GpuDrawListEntry | null {
	if (node.geometry.kind !== "text") return null;
	const { fill, stroke } = canvasPaintsForStyle(
		resolvedStyle,
		"gpu-display-list",
		resolveImageHref,
	);
	const textFill =
		fill.value === "none"
			? null
			: buildTextRasterFill(fill, resolvedStyle.fills[0]);
	const textStroke = buildTextRasterStroke(
		stroke,
		resolvedStyle.strokes[0],
		resolvedStyle,
	);
	if (fill.value !== "none" && !textFill) return null;
	if (stroke.value !== "none" && resolvedStyle.strokeWidth > 0 && !textStroke) {
		return null;
	}
	if (!textFill && !textStroke) return null;
	const rasterBounds = expandBounds(
		getGeometryBounds(node.geometry),
		textStrokeRasterOutset(textStroke),
	);
	return {
		kind: "fill",
		nodeId: node.id,
		worldTransform,
		contours: textStroke
			? [
					buildRoundedRectShape(rasterBounds, {
						radii: { tl: 0, tr: 0, br: 0, bl: 0 },
					}),
				]
			: contourEntry.contours,
		fillRule: contourEntry.fillRule,
		paint: {
			kind: "text-pending",
			geometry: node.geometry,
			rasterBounds,
			fill: textFill,
			stroke: textStroke,
			fillOpacity: fill.opacity,
			opacity: overallOpacity,
		},
		coverBounds: rasterBounds,
	};
}

/**
 * Builds one node's E0 width-profile-stroke outline as an ADDITIONAL fill
 * entry (see this file's top comment for the SVG paint-order this mirrors:
 * base fill, then the outline, both as ordinary fills). The outline paints
 * with the RAW legacy `style.stroke` color (never the resolved `stroke`
 * paint — an explicit empty `strokes[]` stack resolves to `"none"` even
 * though the legacy color a profile expands is still real, exactly matching
 * `VectorShape`'s own outline branch in `CanvasShell.tsx`), at THIS leaf's
 * full opacity chain (`overallOpacity`) since the outline is a second paint
 * layer under the SAME node opacity, not a separately-opacity'd child.
 *
 * `blendMode` (E1 S6/S31) is set on this entry too — an E0 outline is a
 * stroke-equivalent, and gate (c) in `capability.ts` admits an
 * outline-as-the-leaf's-only-visible-paint case for the five fixed-function
 * blend modes, so the outline draw itself must carry the same blend variant
 * the leaf's (absent) fill would have carried.
 */
function buildOutlineEntry(
	node: VectorNode,
	worldTransform: Matrix2D,
	outline: AeShape,
	overallOpacity: number,
	blendMode: GpuBlendMode | undefined,
): GpuDrawListEntry | null {
	const rgb = hexToUnitRgb(node.style.stroke);
	if (!rgb) return null;
	return {
		kind: "fill",
		nodeId: node.id,
		worldTransform,
		contours: [outline],
		fillRule: "nonzero",
		paint: {
			kind: "solid",
			color: { r: rgb.r, g: rgb.g, b: rgb.b, a: overallOpacity },
		},
		coverBounds: getGeometryBounds({ kind: "path", shape: outline }),
		blendMode,
	};
}

/**
 * Recursively compiles one node's own paint (leaf-only — a wrapper
 * container's own placeholder geometry never paints, matching
 * `isWrapperContainer`) and its children, accumulating `worldTransform` via
 * `composeMatrix(parentWorld, ownMatrix)` (outer-then-inner, the same
 * convention `matrixFromTransform`/`composeMatrix` already use across the
 * codebase).
 *
 * `inheritedOpacity` is the running product of every ANCESTOR carrier's own
 * `style.opacity` (a wrapper container/frame's opacity composites its whole
 * subtree in SVG via a group `<g opacity>`, per `hasSubtreeCarrier`'s
 * contract). Each recursive call multiplies its OWN `node.style.opacity` in
 * before passing the result to its children, so a leaf's final paint alpha is
 * `inheritedOpacity(from every ancestor) × node.style.opacity(this leaf) ×
 * the paint's own alpha` — deliberate multiply-through: exact for
 * non-overlapping children under one carrier, approximate (over-darkened) if
 * siblings under that carrier visually overlap, since SVG composites the
 * whole subtree as one flattened group rather than multiplying each
 * descendant's own alpha independently. This is a defense-in-depth safety
 * net, not this module's primary opacity-correctness mechanism: the
 * capability predicate (`capability.ts`) already excludes any artboard with a
 * committed carrier opacity < 1, an animated committed carrier-opacity
 * keyframe, a committed grammar binding driving carrier opacity, OR (S3) a
 * LEAF whose own combined fill+stroke composite can go sub-unity opacity
 * (`"combined_paint_opacity"`) — this threading only matters for opacity that
 * slips past every one of those checks (e.g. a fill-only or stroke-only
 * leaf's own `style.opacity`, never in scope for the capability checks
 * above), keeping such cases "approximately right" instead of "fade ignored
 * entirely."
 *
 * A node's own fill entry (if any) is pushed BEFORE its own stroke-or-outline
 * entry (if any) — see this file's top doc comment for why this order,
 * preserved even after `gpu-scene-frame.ts` partitions fills from strokes,
 * reproduces the correct "stroke paints over its own fill" SVG paint order.
 *
 * S7 (clip masks): `consumedMaskNodeIds` is checked FIRST, before the
 * visibility check even — a mask SOURCE node is never painted as ordinary
 * content once consumed (matching `CanvasShell.tsx`'s `canRenderArtboardNode`
 * guard exactly), regardless of its own `visible` flag or geometry. Then, for
 * a node with a single-application hard clip-compatible mask relation
 * (`clipSilhouetteByContentNodeId.has(node.id)`), this function wraps the
 * node's own ordinary compile (fill/stroke entries plus its full subtree) in
 * a `clip-begin`/`clip-end` pair built from the SILHOUETTE node's own
 * contours/transform/bounds — never the content node's. The silhouette's
 * `worldTransform` is seeded from `artboardOrigin` (an extra parameter
 * threaded down purely for this branch), NOT `parentWorld`: a mask source is
 * guaranteed by `resolveSceneMaskPlan` to be a TOP-LEVEL sibling in the SAME
 * layer/artboard as its content (never nested under the content node's own
 * ancestor chain), so its world transform is `artboardOrigin ∘
 * matrixFromTransform(maskNode.transform)` regardless of how deep the
 * CONTENT node itself is nested.
 */
function compileNode(
	baseNode: VectorNode,
	parentWorld: Matrix2D,
	inheritedOpacity: number,
	overrides: ReadonlyMap<string, VectorNode> | null,
	resolveImageHref: (paint: ResolvedImageReferencePaint) => string | undefined,
	assets: readonly SceneAsset[] | undefined,
	artboardOrigin: Matrix2D,
	clipSilhouetteByContentNodeId: ReadonlyMap<string, VectorNode>,
	consumedMaskNodeIds: ReadonlySet<string>,
	into: GpuDrawListPaintEntry[],
): void {
	if (consumedMaskNodeIds.has(baseNode.id)) return;

	const node = resolvedNode(baseNode, overrides);
	if (!node.visible) return;

	const ownMatrix = matrixFromTransform(node.transform);
	const worldTransform = composeMatrix(parentWorld, ownMatrix);
	const effectiveOpacity = inheritedOpacity * node.style.opacity;
	if (node.motionController) {
		for (const child of node.children ?? []) {
			compileNode(
				child,
				worldTransform,
				effectiveOpacity,
				overrides,
				resolveImageHref,
				assets,
				artboardOrigin,
				clipSilhouetteByContentNodeId,
				consumedMaskNodeIds,
				into,
			);
		}
		return;
	}

	// S7/S30: this node is single-application hard-masked content — wrap its own
	// compile (below, plus its children) in a clip scope built from the
	// silhouette node, matched by ORIGINAL id (`baseNode.id` — the plan is
	// resolved off the committed document, so overrides never change which
	// node a clip relation targets, only its geometry/transform).
	const clipSilhouette = clipSilhouetteByContentNodeId.get(baseNode.id);
	if (clipSilhouette) {
		const silhouetteContourEntry = contoursForGeometry(clipSilhouette.geometry);
		const silhouetteWorldTransform = composeMatrix(
			artboardOrigin,
			matrixFromTransform(clipSilhouette.transform),
		);
		const silhouetteCoverBounds = getGeometryBounds(clipSilhouette.geometry);
		into.push({
			kind: "clip-begin",
			worldTransform: silhouetteWorldTransform,
			contours: silhouetteContourEntry?.contours ?? [],
			fillRule: silhouetteContourEntry?.fillRule ?? "nonzero",
			coverBounds: silhouetteCoverBounds,
		});
		compileNodeOwnPaintAndChildren(
			node,
			worldTransform,
			effectiveOpacity,
			overrides,
			resolveImageHref,
			assets,
			artboardOrigin,
			clipSilhouetteByContentNodeId,
			consumedMaskNodeIds,
			into,
		);
		into.push({
			kind: "clip-end",
			worldTransform: silhouetteWorldTransform,
			contours: silhouetteContourEntry?.contours ?? [],
			fillRule: silhouetteContourEntry?.fillRule ?? "nonzero",
			coverBounds: silhouetteCoverBounds,
		});
		return;
	}

	compileNodeOwnPaintAndChildren(
		node,
		worldTransform,
		effectiveOpacity,
		overrides,
		resolveImageHref,
		assets,
		artboardOrigin,
		clipSilhouetteByContentNodeId,
		consumedMaskNodeIds,
		into,
	);
}

/**
 * The part of {@link compileNode} that actually emits `node`'s own fill/
 * stroke/outline entries and recurses into its children — split out (E1 S7)
 * so the clip-scope branch above can wrap exactly this piece in a
 * `clip-begin`/`clip-end` pair without duplicating the fill/stroke/recursion
 * logic itself. `node` here is ALREADY the resolved (override-applied) node
 * and `worldTransform`/`effectiveOpacity` are already computed — this
 * function does no resolution of its own, mirroring how `compileNode`'s
 * pre-S7 body read `node`/`worldTransform`/`effectiveOpacity` directly.
 */
function compileNodeOwnPaintAndChildren(
	node: VectorNode,
	worldTransform: Matrix2D,
	effectiveOpacity: number,
	overrides: ReadonlyMap<string, VectorNode> | null,
	resolveImageHref: (paint: ResolvedImageReferencePaint) => string | undefined,
	assets: readonly SceneAsset[] | undefined,
	artboardOrigin: Matrix2D,
	clipSilhouetteByContentNodeId: ReadonlyMap<string, VectorNode>,
	consumedMaskNodeIds: ReadonlySet<string>,
	into: GpuDrawListPaintEntry[],
): void {
	if (!isWrapperContainer(node)) {
		const contourEntry = contoursForGeometry(node.geometry);
		if (contourEntry) {
			// Resolved once per node (rather than separately in the image vs.
			// non-image branches below) since both need `blendMode` off it.
			const resolvedStyle = resolveNodeStyle(node.style);
			// E1 S6/S31 — this node's fixed-function blend variant (or `undefined`
			// for "normal"/an out-of-subset mode), shared by its fill entry and
			// its own E0 outline entry (never its stroke entry — see
			// `gpuBlendModeFor`'s doc comment).
			const blendMode = gpuBlendModeFor(resolvedStyle.blendMode);
			if (node.geometry.kind === "text") {
				const textEntry = buildTextEntry(
					node,
					worldTransform,
					contourEntry,
					resolvedStyle,
					effectiveOpacity,
					resolveImageHref,
				);
				if (textEntry) into.push({ ...textEntry, blendMode });
			} else if (node.geometry.kind === "image") {
				// A placed image node (E1 S5) paints ITS geometry's own asset, not a
				// role paint — mirrors `PlacedImageNode` in `CanvasShell.tsx`
				// exactly: href resolves via `imagePaintHref({assetId}, assets)`
				// (the SAME resolver `resolveImageHref` wraps), the placement rect
				// is the geometry's own `bounds`, and opacity is `node.style.opacity`
				// directly (no separate fill-paint opacity layer — a placed image
				// node has no `fills[]` stack to fold in). No stroke/outline branch
				// applies (image geometry never carries a stroke in the SVG
				// renderer either).
				const href = imagePaintHref({ assetId: node.geometry.assetId }, assets);
				if (href) {
					const sourceRect = placedImageSourceRect(node, assets);
					into.push({
						kind: "fill",
						nodeId: node.id,
						worldTransform,
						contours: contourEntry.contours,
						fillRule: contourEntry.fillRule,
						paint: {
							kind: "image",
							href,
							rect: node.geometry.bounds,
							...(sourceRect ? { sourceRect } : {}),
							opacity: effectiveOpacity,
						},
						coverBounds: getGeometryBounds(node.geometry),
						blendMode,
					});
				}
			} else if (node.geometry.kind === "line") {
				const strokeEntry = buildStrokeEntry(
					node,
					worldTransform,
					contourEntry,
					resolvedStyle,
					effectiveOpacity,
					resolveImageHref,
				);
				if (strokeEntry) into.push(strokeEntry);
			} else {
				const paint = buildFillPaint(
					resolvedStyle,
					effectiveOpacity,
					getGeometryBounds(node.geometry),
					resolveImageHref,
				);
				if (paint) {
					into.push({
						kind: "fill",
						nodeId: node.id,
						worldTransform,
						contours: contourEntry.contours,
						fillRule: contourEntry.fillRule,
						paint,
						// This node's OWN geometry bounds — never
						// `getNodeLocalPaintBounds`, which unions in child bounds
						// too; children are separately compiled with their own
						// `coverBounds` entries, so including them here would
						// double-cover the same pixels across two draws.
						coverBounds: getGeometryBounds(node.geometry),
						blendMode,
					});
				}

				const profileOutline = getStrokeWidthProfileOutline(node);
				if (profileOutline) {
					const outlineEntry = buildOutlineEntry(
						node,
						worldTransform,
						profileOutline,
						effectiveOpacity,
						blendMode,
					);
					if (outlineEntry) into.push(outlineEntry);
				} else {
					const strokeEntry = buildStrokeEntry(
						node,
						worldTransform,
						contourEntry,
						resolvedStyle,
						effectiveOpacity,
						resolveImageHref,
					);
					if (strokeEntry) into.push(strokeEntry);
				}
			}
		}
	}

	for (const child of node.children ?? []) {
		compileNode(
			child,
			worldTransform,
			effectiveOpacity,
			overrides,
			resolveImageHref,
			assets,
			artboardOrigin,
			clipSilhouetteByContentNodeId,
			consumedMaskNodeIds,
			into,
		);
	}
}

/**
 * Seeds the recursion's ancestor transform with the artboard's own pasteboard
 * translation, matching the SVG renderer's `<g transform="translate(x, y)">`
 * wrapper around each artboard's content (`CanvasShell.tsx`'s
 * `renderArtboardLayerNodes` call site) and `backgroundQuadForArtboard`'s use
 * of the SAME `artboard.position` in `gpu-scene-frame.ts`. Every
 * `GpuDrawListEntry.worldTransform` this module emits is genuinely in
 * document/pasteboard space (as this file's exported types promise) only
 * because this is the seed, not identity — a multi-artboard document's
 * non-origin artboards would otherwise compile their content at the WRONG
 * world position relative to their own (correctly offset) background quad.
 */
function pasteboardOriginMatrix(position: Vec2): Matrix2D {
	return { a: 1, b: 0, c: 0, d: 1, e: position.x, f: position.y };
}

/**
 * Compiles one artboard's content subtree (already motion/grammar-SAMPLED —
 * see this module's doc comment) into a GPU draw list. `overrides` is the
 * live-drag override map (`null` when no drag is in progress); the caller is
 * responsible for the `duplicateIntent` source-node suppression rule (see
 * `SceneNode` in `CanvasShell.tsx`) before passing it in, so this compiler can
 * apply `overrides.get(nodeId)` unconditionally. `artboardPosition` is the
 * artboard's own pasteboard-space translation (see
 * {@link pasteboardOriginMatrix}).
 *
 * `clipSilhouetteByContentNodeId` (E1 S7) maps a content node's id straight to
 * its resolved mask SOURCE node (`ResolvedMaskDef.maskNode`) for every
 * single-application hard clip-compatible relation the caller has ALREADY narrowed
 * `resolveSceneMaskPlan`'s output down to (see this file's top doc comment) —
 * this compiler performs no plan resolution or mode/multi-application
 * filtering of its own. `consumedMaskNodeIds` is the plan's own
 * `consumedMaskNodeIds` verbatim (every mask source ever consumed by ANY
 * represented relation, clip or alpha-mask alike — a source consumed by a
 * non-admitted soft alpha-mask is still never painted as ordinary content, even
 * though its content target keeps the whole artboard on SVG via
 * `capability.ts`'s `"mask"` reason). Both default to empty so a caller
 * compiling an artboard with zero masks (the overwhelming majority) pays no
 * extra cost and this function behaves byte-identically to its pre-S7 shape.
 *
 * Iterates `document.layers` directly (skipping hidden layers, matching the
 * SVG renderer's `renderArtboardLayerNodes`) rather than reading
 * `selectNodeArtboardMapping().byArtboardId`, whose entries are a FLATTENED
 * list of every node at every depth (not just layer-level roots) — walking
 * that list here while ALSO recursing into `.children` inside `compileNode`
 * would visit every nested node twice, once with the wrong (identity)
 * ancestor transform. `byNodeId` (a per-node lookup, not a flattened list) is
 * still the correct source for top-level root membership.
 */
export function compileArtboardDrawList(
	document: SceneDocument,
	artboardId: string,
	artboardPosition: Vec2,
	overrides: ReadonlyMap<string, VectorNode> | null,
	clipSilhouetteByContentNodeId: ReadonlyMap<string, VectorNode> = new Map(),
	consumedMaskNodeIds: ReadonlySet<string> = new Set(),
): GpuDrawList {
	const entries: GpuDrawListPaintEntry[] = [];
	const byNodeId = selectNodeArtboardMapping(document).byNodeId;
	const originMatrix = pasteboardOriginMatrix(artboardPosition);
	// Built once per artboard compile (not per-node): the SAME `imagePaintHref`
	// resolution the capability predicate (`capability.ts`) and every other
	// renderer use, closed over `document.assets` (E1 S5).
	const resolveImageHref = (
		paint: ResolvedImageReferencePaint,
	): string | undefined => imagePaintHref(paint, document.assets);
	for (const layer of document.layers) {
		if (!layer.visible) continue;
		for (const node of layer.nodes) {
			if (byNodeId[node.id] !== artboardId) continue;
			compileNode(
				node,
				originMatrix,
				1,
				overrides,
				resolveImageHref,
				document.assets,
				originMatrix,
				clipSilhouetteByContentNodeId,
				consumedMaskNodeIds,
				entries,
			);
		}
	}
	return { artboardId, entries };
}
