/**
 * GPU-active-artboard frame assembly for `GpuSceneCanvas` (E1 S2/S3 — see
 * `docs/gpu-canvas-convergence-e1-plan.md` D4/D5). Bridges the pure
 * `entities/scene/model/gpu/*` compiler and `shared/gpu` tessellator into one
 * `GpuFrameSpec`, imperatively (no React) so `GpuSceneCanvas`'s subscription-
 * driven redraw stays a plain function call. Kept out of `GpuSceneCanvas.tsx`
 * so that component stays focused on the mount/subscribe/dispose lifecycle.
 *
 * S3 widens this module to also assemble uniform-stroke draws
 * (`GpuStrokeDraw`, built fresh every frame via `shared/gpu/stroke-mesh.ts` —
 * see that module's doc comment for why the mesh itself is NOT cached the
 * same way flattened rings are) and to compute each gradient fill's
 * `worldToLocal` projection uniform (the inverse of the entry's
 * `worldTransform` — see `shared/gpu/types.ts::GpuFillDraw`'s doc comment for
 * why this is the ONLY per-draw CPU-side gradient work needed).
 *
 * S4 adds a single-entry ("last value") memo around the whole artboard-loop
 * compile step ({@link buildGpuArtboardFrame}) — see
 * {@link memoizedArtboardsForBucket}'s doc comment for the exact invalidation
 * key and why a pure pan (scale unchanged, so the zoom bucket is unchanged)
 * costs zero recompile while a stroke's `halfWidthWorld`/cover-rect margin
 * (genuinely scale-dependent every frame, not just per bucket) are still
 * recomputed fresh on every call regardless of the cache hit.
 *
 * A post-S4 review pass fixed two bugs (see `docs/gpu-canvas-convergence-e1-
 * plan.md`'s review-findings addendum): (1) {@link compileArtboardsForBucket}
 * used to partition the compiler's one ordered `entries` list into SEPARATE
 * `fills`/`strokeCompiles` arrays, which silently reordered a DIFFERENT
 * node's stroke ahead of a LATER node's fill whenever the two overlapped on
 * screen — `shared/gpu/types.ts::GpuArtboardDraw` replaces that split with
 * one ordered `draws` array, preserving true cross-node paint order; (2) the
 * S4 memo key used `bucketUpperScale` alone, which does not change when only
 * `dpr` changes (e.g. a window dragged to a different-DPR monitor), so a DPR
 * change alone could read a stale, wrong-tolerance compile from the cache —
 * {@link memoizedArtboardsForBucket} now keys on the computed `tolerance`
 * value itself (which already folds in both the bucket AND the clamped dpr,
 * see {@link flattenToleranceForScale}), so either input changing invalidates
 * the cache correctly.
 *
 * S5 widens this module to resolve TWO more paint kinds the compiler can now
 * emit: an already-resolved `GpuPaint.kind === "image"` (needs only a
 * `worldToLocal` inverse, exactly like a gradient; S33 additionally folds an
 * image `patternTransform` inverse into that same matrix) and the compiler's
 * OWN `GpuMeshPendingPaint` (E1 S5 — see `display-list.ts`'s doc comment for
 * why mesh rasterization cannot happen in that entities-layer, widgets-import-
 * forbidden compiler). {@link rasterizeMeshPendingPaint} is the ONE place
 * that resolution happens: it calls the SAME `rasterizeStyleMeshes` module-
 * level singleton `CanvasShell.tsx`'s SVG renderer already calls for every
 * mesh paint, so a mesh rasterizes ONCE (cache-shared) regardless of which
 * renderer asks first, and the resulting bitmap is byte-identical between
 * the two renderers. A mesh whose raster is not yet cached (a genuine cache
 * MISS the first time a given mesh signature is seen) resolves to `undefined`
 * `dataUrl` here — `fillDrawForEntry` demotes such a fill to a fully
 * transparent draw for THIS frame (not a skipped draw — mesh rasterization is
 * synchronous CPU work with no async pop-in of its own, unlike an image
 * paint's texture upload, so by the time `rasterizeStyleMeshes` returns the
 * bitmap already exists or the mesh is genuinely degenerate).
 *
 * S7/S30 widens this module once more to resolve the compiler's `clip-begin`/
 * `clip-end` entries (single-level hard silhouette masks — see
 * `docs/gpu-canvas-convergence-e1-plan.md`'s mask decisions) into frame-ready
 * `GpuClipBegin`/`GpuClipEnd` draws ({@link clipBeginDrawForEntry}/
 * {@link clipEndDrawForEntry}), reusing the SAME `flattenCache`/
 * `fanTriangulateRings`/`worldCoverRect` machinery a fill entry already
 * shares — a clip silhouette's contours flatten exactly like an ordinary
 * fill's, just with no paint to resolve. {@link compileArtboardsForBucket}
 * resolves the document's mask plan ONCE per bucket-level compile (never per
 * artboard, never per frame — see {@link clipMaskCompileInputs}'s doc
 * comment) and narrows it to the admitted single-application hard clip-compatible
 * subset before handing it to `compileArtboardDrawList`.
 *
 * S33 admits narrow image/mesh artboard-background subsets by reusing the same
 * textured cover path as ordinary image and mesh fills. The capability
 * predicate only lets known-opaque rasters reach this path, because SVG
 * artboard chrome still leaves the background underneath the GPU canvas for
 * shadows/borders.
 */

import { buildRoundedRectShape } from "@/entities/scene/model/corner-geometry";
import {
	explicitFrameFilmLookGraphRecipe,
	frameGpuFilmPostEffectParams,
} from "@/entities/scene/model/frame-look-visibility";
import {
	gpuKnownOpaqueImageBackgroundHref,
	gpuMeshBackgroundUsesOpaqueRaster,
} from "@/entities/scene/model/gpu/background-paint";
import type {
	GpuClipBeginEntry,
	GpuClipEndEntry,
	GpuDrawListEntry,
	GpuMeshPendingPaint,
	GpuStrokeDrawListEntry,
	GpuTextPendingPaint,
} from "@/entities/scene/model/gpu/display-list";
import { compileArtboardDrawList } from "@/entities/scene/model/gpu/display-list";
import type { SceneMaskPlan } from "@/entities/scene/model/mask-render";
import {
	maskApplicationUsesHardSilhouette,
	resolveSceneMaskPlan,
} from "@/entities/scene/model/mask-render";
import { meshBounds } from "@/entities/scene/model/mesh-edit";
import { resolveFrameEffectIntent } from "@/entities/scene/model/recipe-resolve";
import {
	applyMatrixToPoint,
	composeMatrix,
	invertMatrix,
	type Matrix2D,
} from "@/entities/scene/model/rendering";
import {
	type NormalizedArtboard,
	selectAllArtboards,
} from "@/entities/scene/model/selectors";
import {
	buildSourceOpticsPresentation,
	type SourceOpticsNodePlan,
} from "@/entities/scene/model/source-optics";
import { compileSourceOpticsRayKernel } from "@/entities/scene/model/source-optics-ray-kernel";
import {
	type ResolvedImageReferencePaint,
	type ResolvedNodeStyle,
	resolvePaints,
} from "@/entities/scene/model/style-resolve";
import {
	textAnchorXForAlign,
	textMetricsForGeometry,
} from "@/entities/scene/model/text-geometry";
import type {
	SceneDocument,
	TextStyle,
	VectorNode,
} from "@/entities/scene/model/types";
import { recordCacheTelemetry } from "@/shared/cache/observability";
import { hexToRgb } from "@/shared/color";
import {
	fanTriangulateRings,
	flattenContoursToRings,
} from "@/shared/geometry-kernel/flatten";
import { buildStrokeMesh } from "@/shared/geometry-kernel/stroke";
import type {
	GpuArtboardChromaticAberrationPostEffect,
	GpuArtboardContent,
	GpuArtboardPostEffect,
	GpuClipBegin,
	GpuClipEnd,
	GpuColor,
	GpuEffectIslandBegin,
	GpuEffectIslandEnd,
	GpuFillDraw,
	GpuGradientStop,
	GpuImageFit,
	GpuNodeEffect,
	GpuPaint,
	GpuQuad,
	GpuStrokeDraw,
} from "@/shared/gpu/types";
import { MAX_GRADIENT_STOPS } from "@/shared/gpu/types";
import {
	DEFAULT_FILM_GRAIN_TEXTURE_HEIGHT,
	encodeGrainOverlayRgba,
	type FilmGrainParams,
	grainSampleField,
} from "@/shared/vec-core";
import { rasterizeStyleMeshes } from "@/widgets/canvas-shell/model/mesh-raster-bridge";
import {
	persistentRasterDataUrl,
	rememberPersistentRasterDataUrl,
} from "@/widgets/canvas-shell/model/persistent-raster-cache";
import {
	persistentGpuDrawListForBucket,
	rememberPersistentGpuDrawListForBucket,
} from "./persistent-gpu-draw-list-cache";

/**
 * Device-pixel flatness target for the flattened stencil geometry (D4's
 * "adaptive-by-zoom-bucket" note). `0.25` device px keeps curve faceting
 * imperceptible at typical viewing distances while avoiding per-zoom-tick
 * re-flattening (see {@link zoomBucketUpperScale}).
 */
const FLATTEN_TOLERANCE_DEVICE_PX = 0.25;
const MAX_TEXT_RASTER_SCALE = 8;
const MAX_TEXT_RASTER_DIMENSION_PX = 4096;
const TEXT_RASTER_CACHE_LIMIT = 128;
const TEXT_RASTER_IMAGE_CACHE_LIMIT = 64;
const FRAME_GRAIN_TEXTURE_CACHE_LIMIT = 128;
const ZERO_CORNER_RADII = { tl: 0, tr: 0, br: 0, bl: 0 } as const;

/** Zoom-bucket scale range clamp — mirrors `features/viewport/model/camera.ts`'s `MIN_ZOOM=2`/`MAX_ZOOM=6400` (as `scale = zoom/100`). */
const MIN_BUCKET_SCALE = 2 / 100;
const MAX_BUCKET_SCALE = 6400 / 100;

/**
 * Rounds `scale` UP to the nearest power-of-two "zoom bucket" upper bound, so
 * a continuous zoom drag only crosses a bucket boundary occasionally instead
 * of on every tick. Re-flattening (see {@link flattenToleranceForScale}) only
 * needs to happen when the bucket itself changes, not every frame's exact
 * scale — the bucket's UPPER bound is used as the tolerance denominator so
 * quality never drops below target anywhere within the bucket (a scale at the
 * bucket's lower edge still flattens at least as fine as the bucket's own
 * worst case).
 */
export function zoomBucketUpperScale(scale: number): number {
	const clamped = Math.min(MAX_BUCKET_SCALE, Math.max(MIN_BUCKET_SCALE, scale));
	return 2 ** Math.ceil(Math.log2(clamped));
}

/** World-unit flattening tolerance for a given zoom bucket + backing-store DPR. */
export function flattenToleranceForScale(scale: number, dpr: number): number {
	const bucketUpperScale = zoomBucketUpperScale(scale);
	const clampedDpr = Math.max(1, dpr);
	return FLATTEN_TOLERANCE_DEVICE_PX / (bucketUpperScale * clampedDpr);
}

/**
 * One path's cached flattened+fanned triangles, keyed by the exact `tolerance`
 * they were built for (a post-S4 review fix — see this module's top doc
 * comment's "bug (2)" and {@link memoizedArtboardsForBucket}'s doc comment:
 * `tolerance` already folds in both the zoom bucket AND the clamped DPR, see
 * {@link flattenToleranceForScale}, so keying on `bucketUpperScale` alone —
 * the pre-fix behavior — would silently reuse stale, wrong-DPR-tolerance
 * rings on a DPR-only change even after the OUTER `memoizedArtboardsForBucket`
 * cache correctly misses and recompiles).
 */
type FlattenCacheEntry = {
	readonly tolerance: number;
	readonly rings: readonly Float32Array[];
};

/**
 * Caches flattened (pre-fan) rings per contour-array reference, invalidated
 * only when `tolerance` changes — NOT on every zoom tick within the same
 * bucket/DPR, and NOT when only the node's transform changes (the compiler
 * returns the SAME `contours` array reference for an unchanged node's
 * geometry, see `display-list.ts::contoursForGeometry`'s doc comment). Shared
 * by fill AND stroke draws (S3) — a node's fill/stroke/outline entries all
 * reference the SAME `contours` array (see `display-list.ts`'s
 * `compileNode`), so a stroke draw for a node whose fill was already
 * flattened this frame reuses the identical cached rings.
 */
const flattenCache = new WeakMap<
	GpuDrawListEntry["contours"],
	FlattenCacheEntry
>();

/**
 * World-space axis-aligned bounding rect of a node-local `Bounds` under its
 * `worldTransform` (the node's geometry-local paint bounds may rotate/skew
 * into a non-axis-aligned world quad, so all four corners must be projected
 * and re-bounded — a plain min/max of the two opposite corners would be wrong
 * under rotation). Shared by fills and strokes (S3) — both draw kinds carry a
 * node-local `coverBounds`/`worldTransform` pair with the identical shape.
 */
function worldCoverRect(
	coverBounds: GpuDrawListEntry["coverBounds"],
	worldTransform: Matrix2D,
): {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
} {
	const corners = [
		{ x: coverBounds.x, y: coverBounds.y },
		{ x: coverBounds.x + coverBounds.width, y: coverBounds.y },
		{ x: coverBounds.x, y: coverBounds.y + coverBounds.height },
		{
			x: coverBounds.x + coverBounds.width,
			y: coverBounds.y + coverBounds.height,
		},
	].map((point) => applyMatrixToPoint(worldTransform, point));
	const xs = corners.map((point) => point.x);
	const ys = corners.map((point) => point.y);
	const minX = Math.min(...xs);
	const minY = Math.min(...ys);
	return {
		x: minX,
		y: minY,
		width: Math.max(...xs) - minX,
		height: Math.max(...ys) - minY,
	};
}

/**
 * Placeholder `ResolvedNodeStyle` fields `rasterizeStyleMeshes` never reads
 * for a single-mesh-fill synthetic style (it only inspects `fills`/`strokes`
 * looking for `paint.kind === "mesh-gradient"`, see that function's doc
 * comment) — kept in one constant so {@link rasterizeMeshPendingPaint} stays
 * readable.
 */
const MESH_RASTER_STYLE_PLACEHOLDER = {
	fill: "none",
	stroke: "none",
	strokeWidth: 0,
	opacity: 1,
	strokes: [],
	effects: [],
	blendMode: "normal",
	strokeAlign: "center",
	strokeDash: [],
	strokeDashoffset: 0,
	strokeCap: "butt",
	strokeJoin: "miter",
	strokeMiterLimit: 4,
	strokeBlurRadius: 0,
} as const satisfies Omit<ResolvedNodeStyle, "fills">;

/**
 * Rasterizes ONE pending mesh paint via `rasterizeStyleMeshes` — the SAME
 * module-level cached bridge `CanvasShell.tsx`'s SVG renderer calls for every
 * mesh paint (see this module's top doc comment for why sharing that ONE
 * singleton, rather than rasterizing independently, is what makes GPU/SVG
 * mesh bitmaps agree byte-for-byte and never double-rasterize). Wraps the
 * single paint in a minimal synthetic `ResolvedNodeStyle` (`fills: [paint]`)
 * since that bridge operates on a whole style's `fills`/`strokes` arrays, not
 * a bare paint. Returns `undefined` when the mesh is degenerate (zero
 * patches — `rasterizeStyleMeshes` leaves `dataUrl` unset in that case, same
 * as `mesh-raster-bridge.ts`'s own degenerate-mesh contract).
 */
function rasterizeMeshPendingPaint(
	pending: GpuMeshPendingPaint,
): string | undefined {
	const style: ResolvedNodeStyle = {
		...MESH_RASTER_STYLE_PLACEHOLDER,
		fills: [pending.paint],
	};
	const rasterized = rasterizeStyleMeshes(style);
	const resolvedFill = rasterized.fills[0];
	return resolvedFill?.kind === "mesh-gradient"
		? resolvedFill.dataUrl
		: undefined;
}

const textRasterCache = new Map<string, string>();
const textRasterImageCache = new Map<
	string,
	| { readonly status: "loading"; readonly image: HTMLImageElement }
	| { readonly status: "ready"; readonly image: HTMLImageElement }
	| { readonly status: "failed" }
>();
const frameGrainTextureCache = new Map<string, string>();

const frameFilmGrainTextureSize = (
	size: Pick<GpuQuad["rect"], "width" | "height">,
): { readonly width: number; readonly height: number } => {
	const regionHeight = Math.max(1, size.height);
	const height = DEFAULT_FILM_GRAIN_TEXTURE_HEIGHT;
	return {
		width: Math.max(1, Math.round((height * size.width) / regionHeight)),
		height,
	};
};

const frameFilmGrainTextureHref = (
	params: FilmGrainParams,
	frame: number,
	rect: GpuQuad["rect"],
): string | null => {
	if (typeof document === "undefined") return null;
	const textureSize = frameFilmGrainTextureSize(rect);
	const cacheKey = JSON.stringify({
		frame,
		seed: params.seed,
		seedNamespace: params.seedNamespace,
		strength: params.strength,
		width: textureSize.width,
		height: textureSize.height,
	});
	const cached = frameGrainTextureCache.get(cacheKey);
	if (cached) {
		recordCacheTelemetry({
			kind: "hit",
			artifactKind: "gpu-upload-source",
			cacheKey,
			tier: "gpu",
		});
		return cached;
	}
	const persistent = persistentRasterDataUrl("gpu-upload-source", cacheKey);
	if (persistent) {
		frameGrainTextureCache.set(cacheKey, persistent);
		return persistent;
	}

	const temporalSeed = `${params.seedNamespace}-g${params.seed}-${frame}`;
	const data = encodeGrainOverlayRgba(
		grainSampleField(
			temporalSeed,
			textureSize.width,
			textureSize.height,
			params.strength,
		),
	);
	const canvas = document.createElement("canvas");
	canvas.width = textureSize.width;
	canvas.height = textureSize.height;
	const context = canvas.getContext("2d");
	if (!context) return null;
	context.putImageData(
		new ImageData(
			new Uint8ClampedArray(data),
			textureSize.width,
			textureSize.height,
		),
		0,
		0,
	);
	const href = canvas.toDataURL("image/png");
	if (frameGrainTextureCache.size >= FRAME_GRAIN_TEXTURE_CACHE_LIMIT) {
		frameGrainTextureCache.clear();
	}
	frameGrainTextureCache.set(cacheKey, href);
	rememberPersistentRasterDataUrl("gpu-upload-source", cacheKey, href);
	recordCacheTelemetry({
		kind: "put",
		artifactKind: "gpu-upload-source",
		cacheKey,
		tier: "gpu",
		bytes: data.byteLength,
	});
	return href;
};

const textRasterScaleForTolerance = (
	tolerance: number,
	bounds: { readonly width: number; readonly height: number },
): number => {
	if (bounds.width <= 0 || bounds.height <= 0) return 1;
	const bucketDeviceScale = FLATTEN_TOLERANCE_DEVICE_PX / tolerance;
	const dimensionScale = Math.min(
		MAX_TEXT_RASTER_DIMENSION_PX / bounds.width,
		MAX_TEXT_RASTER_DIMENSION_PX / bounds.height,
	);
	const qualityScale = Math.max(
		1,
		Math.min(bucketDeviceScale, MAX_TEXT_RASTER_SCALE),
	);
	return Math.min(qualityScale, dimensionScale);
};

const textFontShorthand = (style: TextStyle): string =>
	`${style.italic ? "italic " : ""}${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`;

type GpuTextRasterColor = Extract<
	NonNullable<GpuTextPendingPaint["fill"]>,
	{ readonly kind: "solid" }
>["color"];
type CanvasTextRasterFill = Exclude<
	NonNullable<GpuTextPendingPaint["fill"]>,
	{ readonly kind: "image" } | { readonly kind: "mesh" }
>;

const rgbaCss = (color: GpuTextRasterColor): string => {
	const channel = (value: number): number =>
		Math.round(Math.min(1, Math.max(0, value)) * 255);
	return `rgba(${channel(color.r)}, ${channel(color.g)}, ${channel(color.b)}, ${Math.min(1, Math.max(0, color.a))})`;
};

const trimTextRasterImageCache = (): void => {
	while (textRasterImageCache.size > TEXT_RASTER_IMAGE_CACHE_LIMIT) {
		const oldestKey = textRasterImageCache.keys().next().value;
		if (oldestKey === undefined) break;
		textRasterImageCache.delete(oldestKey);
	}
};

const textRasterImageForHref = (
	href: string,
	onReady: (() => void) | undefined,
): HTMLImageElement | null => {
	if (typeof Image === "undefined") return null;
	const cached = textRasterImageCache.get(href);
	if (cached?.status === "ready") return cached.image;
	if (cached) return null;

	const image = new Image();
	image.crossOrigin = "anonymous";
	image.decoding = "async";
	image.onload = () => {
		textRasterImageCache.set(href, { status: "ready", image });
		lastBucketCompile = null;
		onReady?.();
	};
	image.onerror = () => {
		textRasterImageCache.set(href, { status: "failed" });
	};
	textRasterImageCache.set(href, { status: "loading", image });
	trimTextRasterImageCache();
	image.src = href;
	if (image.complete && image.naturalWidth > 0) {
		textRasterImageCache.set(href, { status: "ready", image });
		return image;
	}
	return null;
};

const textFillStyle = (
	context: CanvasRenderingContext2D,
	fill: CanvasTextRasterFill,
	fillOpacity: number,
): string | CanvasGradient => {
	if (fill.kind === "solid") {
		return rgbaCss({ ...fill.color, a: fill.color.a * fillOpacity });
	}
	const gradient =
		fill.kind === "linear-gradient"
			? context.createLinearGradient(
					fill.from.x,
					fill.from.y,
					fill.to.x,
					fill.to.y,
				)
			: context.createRadialGradient(
					fill.center.x,
					fill.center.y,
					0,
					fill.center.x,
					fill.center.y,
					fill.radius,
				);
	for (const stop of fill.stops) {
		gradient.addColorStop(
			stop.offset,
			rgbaCss({ ...stop.color, a: stop.color.a * fillOpacity }),
		);
	}
	return gradient;
};

const measuredCanvasLineWidth = (
	context: CanvasRenderingContext2D,
	text: string,
	style: TextStyle,
): number =>
	context.measureText(text).width +
	Array.from(text).length * style.letterSpacing;

const lineStartX = (
	anchorX: number,
	width: number,
	align: TextStyle["align"],
): number => {
	if (align === "center") return anchorX - width / 2;
	if (align === "right") return anchorX - width;
	return anchorX;
};

type TextGlyphDrawMode = "fill" | "stroke";

const drawCanvasText = (
	context: CanvasRenderingContext2D,
	mode: TextGlyphDrawMode,
	text: string,
	x: number,
	y: number,
): void => {
	if (mode === "stroke") {
		context.strokeText(text, x, y);
		return;
	}
	context.fillText(text, x, y);
};

const drawTextLine = (
	context: CanvasRenderingContext2D,
	text: string,
	anchorX: number,
	baseline: number,
	style: TextStyle,
	mode: TextGlyphDrawMode,
): void => {
	const letterSpacingContext = context as CanvasRenderingContext2D & {
		letterSpacing?: string;
	};
	if ("letterSpacing" in letterSpacingContext) {
		letterSpacingContext.letterSpacing = `${style.letterSpacing}px`;
		context.textAlign = style.align;
		drawCanvasText(context, mode, text, anchorX, baseline);
		return;
	}

	const glyphs = Array.from(text);
	const width = measuredCanvasLineWidth(context, text, style);
	let penX = lineStartX(anchorX, width, style.align);
	context.textAlign = "left";
	for (const glyph of glyphs) {
		drawCanvasText(context, mode, glyph, penX, baseline);
		penX += context.measureText(glyph).width + style.letterSpacing;
	}
};

const drawTextUnderline = (
	context: CanvasRenderingContext2D,
	text: string,
	anchorX: number,
	baseline: number,
	style: TextStyle,
): void => {
	const width = measuredCanvasLineWidth(context, text, style);
	const startX = lineStartX(anchorX, width, style.align);
	const thickness = Math.max(1, style.fontSize / 16);
	const y = baseline + Math.max(1, style.fontSize / 10);
	context.fillRect(startX, y, width, thickness);
};

const drawTextGlyphs = (
	context: CanvasRenderingContext2D,
	metrics: ReturnType<typeof textMetricsForGeometry>,
	bounds: GpuTextPendingPaint["geometry"]["bounds"],
	mode: TextGlyphDrawMode = "fill",
): void => {
	const anchorX = textAnchorXForAlign(bounds, metrics.style.align);
	for (const line of metrics.lineMetrics) {
		if (line.text.length === 0) continue;
		drawTextLine(
			context,
			line.text,
			anchorX,
			line.baseline,
			metrics.style,
			mode,
		);
		if (mode === "fill" && metrics.style.underline) {
			drawTextUnderline(
				context,
				line.text,
				anchorX,
				line.baseline,
				metrics.style,
			);
		}
	}
};

const drawTextImageFill = (
	context: CanvasRenderingContext2D,
	image: HTMLImageElement,
	bounds: GpuTextPendingPaint["geometry"]["bounds"],
	fit: Extract<GpuTextPendingPaint["fill"], { readonly kind: "image" }>["fit"],
): boolean => {
	const sourceWidth = image.naturalWidth || image.width;
	const sourceHeight = image.naturalHeight || image.height;
	if (
		sourceWidth <= 0 ||
		sourceHeight <= 0 ||
		bounds.width <= 0 ||
		bounds.height <= 0
	) {
		return false;
	}
	if (fit === "fit") {
		const sourceAspect = sourceWidth / sourceHeight;
		const destAspect = bounds.width / bounds.height;
		let width = bounds.width;
		let height = bounds.height;
		let x = bounds.x;
		let y = bounds.y;
		if (sourceAspect > destAspect) {
			height = bounds.width / sourceAspect;
			y += (bounds.height - height) * 0.5;
		} else {
			width = bounds.height * sourceAspect;
			x += (bounds.width - width) * 0.5;
		}
		context.drawImage(image, x, y, width, height);
		return true;
	}
	if (fit === "crop") {
		const sourceAspect = sourceWidth / sourceHeight;
		const destAspect = bounds.width / bounds.height;
		let sx = 0;
		let sy = 0;
		let sw = sourceWidth;
		let sh = sourceHeight;
		if (sourceAspect > destAspect) {
			sw = sourceHeight * destAspect;
			sx = (sourceWidth - sw) * 0.5;
		} else {
			sh = sourceWidth / destAspect;
			sy = (sourceHeight - sh) * 0.5;
		}
		context.drawImage(
			image,
			sx,
			sy,
			sw,
			sh,
			bounds.x,
			bounds.y,
			bounds.width,
			bounds.height,
		);
		return true;
	}
	context.drawImage(image, bounds.x, bounds.y, bounds.width, bounds.height);
	return true;
};

const drawTextMeshFill = (
	context: CanvasRenderingContext2D,
	image: HTMLImageElement,
	rect: Extract<GpuTextPendingPaint["fill"], { readonly kind: "mesh" }>["rect"],
): boolean => {
	if (rect.width <= 0 || rect.height <= 0) return false;
	context.drawImage(image, rect.x, rect.y, rect.width, rect.height);
	return true;
};

/**
 * Rasterizes one static text node into a data URL for the existing image-fill
 * pipeline (S9.0). The raster scale follows the same zoom-bucket/DPR cadence as
 * geometry flattening, so pan-only redraws reuse the cached bitmap while a real
 * bucket/DPR change creates a crisper texture for the new zoom tier.
 */
function rasterizeTextPendingPaint(
	pending: GpuTextPendingPaint,
	tolerance: number,
	onRasterAssetReady?: () => void,
): GpuPaint | null {
	const { bounds } = pending.geometry;
	const { rasterBounds } = pending;
	if (
		rasterBounds.width <= 0 ||
		rasterBounds.height <= 0 ||
		pending.opacity <= 0
	) {
		return null;
	}
	if (typeof document === "undefined") return null;

	const rasterScale = textRasterScaleForTolerance(tolerance, rasterBounds);
	const pixelWidth = Math.max(1, Math.ceil(rasterBounds.width * rasterScale));
	const pixelHeight = Math.max(1, Math.ceil(rasterBounds.height * rasterScale));
	const metrics = textMetricsForGeometry(pending.geometry);
	const cacheKey = JSON.stringify({
		geometry: pending.geometry,
		rasterBounds,
		fill: pending.fill,
		stroke: pending.stroke,
		fillOpacity: pending.fillOpacity,
		rasterScale,
		pixelWidth,
		pixelHeight,
	});
	const cached = textRasterCache.get(cacheKey);
	if (cached) {
		recordCacheTelemetry({
			kind: "hit",
			artifactKind: "text-raster",
			cacheKey,
			tier: "memory",
		});
		return {
			kind: "image",
			href: cached,
			rect: rasterBounds,
			opacity: pending.opacity,
		};
	}
	const persistent = persistentRasterDataUrl("text-raster", cacheKey);
	if (persistent) {
		textRasterCache.set(cacheKey, persistent);
		return {
			kind: "image",
			href: persistent,
			rect: rasterBounds,
			opacity: pending.opacity,
		};
	}
	recordCacheTelemetry({
		kind: "miss",
		artifactKind: "text-raster",
		cacheKey,
		tier: "memory",
	});

	const canvas = document.createElement("canvas");
	canvas.width = pixelWidth;
	canvas.height = pixelHeight;
	const context = canvas.getContext("2d");
	if (!context) return null;
	context.scale(rasterScale, rasterScale);
	context.translate(-rasterBounds.x, -rasterBounds.y);
	context.font = textFontShorthand(metrics.style);
	context.textBaseline = "alphabetic";

	if (pending.fill) {
		if (pending.fill.kind === "image" || pending.fill.kind === "mesh") {
			const href =
				pending.fill.kind === "image"
					? pending.fill.href
					: rasterizeMeshPendingPaint({
							kind: "mesh-pending",
							paint: pending.fill.paint,
							rect: pending.fill.rect,
							opacity: 1,
						});
			if (!href) return null;
			const image = textRasterImageForHref(href, onRasterAssetReady);
			if (!image) return null;
			try {
				const didDraw =
					pending.fill.kind === "image"
						? drawTextImageFill(context, image, bounds, pending.fill.fit)
						: drawTextMeshFill(context, image, pending.fill.rect);
				if (!didDraw) return null;
			} catch {
				return null;
			}
			context.globalCompositeOperation = "destination-in";
			context.fillStyle = rgbaCss({ r: 0, g: 0, b: 0, a: pending.fillOpacity });
			drawTextGlyphs(context, metrics, bounds);
			context.globalCompositeOperation = "source-over";
		} else {
			context.fillStyle = textFillStyle(
				context,
				pending.fill,
				pending.fillOpacity,
			);
			drawTextGlyphs(context, metrics, bounds);
		}
	}

	if (pending.stroke) {
		context.strokeStyle = textFillStyle(
			context,
			pending.stroke.paint,
			pending.stroke.opacity,
		);
		context.lineWidth = pending.stroke.width;
		context.lineCap = pending.stroke.cap;
		context.lineJoin = pending.stroke.join;
		context.miterLimit = pending.stroke.miterLimit;
		drawTextGlyphs(context, metrics, bounds, "stroke");
	}

	let dataUrl: string;
	try {
		dataUrl = canvas.toDataURL("image/png");
	} catch (error) {
		if (import.meta.env.DEV) {
			console.info("[gpu-canvas] text image-fill raster failed.", error);
		}
		return null;
	}
	if (textRasterCache.size >= TEXT_RASTER_CACHE_LIMIT) {
		textRasterCache.clear();
	}
	textRasterCache.set(cacheKey, dataUrl);
	rememberPersistentRasterDataUrl("text-raster", cacheKey, dataUrl);
	recordCacheTelemetry({
		kind: "put",
		artifactKind: "text-raster",
		cacheKey,
		tier: "memory",
		bytes: dataUrl.length,
	});
	return {
		kind: "image",
		href: dataUrl,
		rect: rasterBounds,
		opacity: pending.opacity,
	};
}

/**
 * Resolves this compiler's own {@link GpuDrawListEntry.paint} (`shared/gpu`'s
 * `GpuPaint` verbatim, OR a {@link GpuMeshPendingPaint} awaiting
 * rasterization) into a plain `GpuPaint` `shared/gpu` can draw — `null` when
 * a mesh's raster is not (yet) available (degenerate mesh; see
 * {@link rasterizeMeshPendingPaint}), which `fillDrawForEntry` treats as a
 * fully-transparent draw for this frame, same fail-open contract already
 * used for a degenerate `worldTransform`.
 */
function resolveDrawListPaint(
	paint: GpuDrawListEntry["paint"],
	tolerance: number,
	onRasterAssetReady?: () => void,
): GpuFramePaint | null {
	if (paint.kind === "text-pending") {
		return rasterizeTextPendingPaint(paint, tolerance, onRasterAssetReady);
	}
	if (paint.kind !== "mesh-pending") return paint;
	const dataUrl = rasterizeMeshPendingPaint(paint);
	if (!dataUrl) return null;
	return {
		kind: "image",
		href: dataUrl,
		rect: paint.rect,
		// `paint.opacity` is the compiler's already-folded leaf opacity chain
		// (inherited-ancestor product × this leaf's own `style.opacity` × the
		// paint's own `fill.opacity`, see `GpuMeshPendingPaint`'s doc comment) —
		// NOT `paint.paint.opacity` (the raw `ResolvedMeshGradientPaint`'s own
		// alpha alone), which would drop the ancestor/leaf opacity fold
		// entirely rather than double-count it.
		opacity: paint.opacity,
	};
}

type GpuFramePaint =
	| GpuPaint
	| (Extract<GpuPaint, { readonly kind: "image" }> & {
			readonly transform?: Matrix2D;
	  });

function paintSpaceWorldToLocal(
	paint: GpuFramePaint,
	worldTransform: Matrix2D,
): Matrix2D | null | undefined {
	if (paint.kind === "solid") return undefined;
	const worldToLocal = invertMatrix(worldTransform);
	if (!worldToLocal) return null;
	const imageTransform =
		paint.kind === "image" && "transform" in paint
			? paint.transform
			: undefined;
	if (!imageTransform) return worldToLocal;
	const paintToLocal = invertMatrix(imageTransform);
	return paintToLocal ? composeMatrix(paintToLocal, worldToLocal) : null;
}

function gpuPaintWithoutDrawListTransform(paint: GpuFramePaint): GpuPaint {
	if (paint.kind !== "image" || !("transform" in paint)) return paint;
	return {
		kind: "image",
		href: paint.href,
		rect: paint.rect,
		...(paint.fit ? { fit: paint.fit } : {}),
		...(paint.sourceRect ? { sourceRect: paint.sourceRect } : {}),
		opacity: paint.opacity,
	};
}

/**
 * Resolves one fill entry's flattened+fanned world-space stencil triangles,
 * reusing the ring cache across an unchanged `tolerance` (bucket + DPR, see
 * {@link flattenToleranceForScale}), plus (S3) a `worldToLocal` inverse for a
 * gradient OR image paint (E1 S5) — `undefined` for a solid paint (no
 * per-fragment re-projection needed) and, defensively, when the entry's
 * `worldTransform` is (near-)singular (a degenerate zero-scale node): rather
 * than crash, this demotes the paint to fully transparent — an extreme edge
 * case the S3 capability predicate does not special-case (evaluated on the
 * COMMITTED transform, which is realistically never exactly zero-scale for a
 * visible node; a mid-animation keyframe COULD pass through zero-scale
 * transiently, which is what this guards). A pending mesh paint whose raster
 * is not (yet) resolvable ({@link resolveDrawListPaint} returning `null`)
 * takes the SAME fully-transparent fallback path.
 *
 * `entry.blendMode` (E1 S6) passes straight through to every return branch's
 * `GpuFillDraw.blendMode`, including the transparent-fallback branches — a
 * transparent draw's blend mode has no visible effect, but keeping the field
 * always populated from its source entry (rather than only on the "happy
 * path") avoids a silent divergence if a future change makes one of those
 * fallback draws non-transparent.
 */
function fillDrawForEntry(
	entry: GpuDrawListEntry,
	tolerance: number,
	onRasterAssetReady?: () => void,
): GpuFillDraw {
	const cached = flattenCache.get(entry.contours);
	const rings =
		cached && cached.tolerance === tolerance
			? cached.rings
			: flattenContoursToRings(entry.contours, tolerance);
	if (!cached || cached.tolerance !== tolerance) {
		flattenCache.set(entry.contours, { tolerance, rings });
	}
	const triangles = fanTriangulateRings(rings, entry.worldTransform);
	const coverRect = worldCoverRect(entry.coverBounds, entry.worldTransform);

	const resolvedPaint = resolveDrawListPaint(
		entry.paint,
		tolerance,
		onRasterAssetReady,
	);
	const transparentFallback: GpuPaint = {
		kind: "solid",
		color: { r: 0, g: 0, b: 0, a: 0 },
	};
	const paint = resolvedPaint ?? transparentFallback;

	if (paint.kind === "solid") {
		return {
			kind: "fill",
			ownerId: entry.nodeId,
			triangles,
			fillRule: entry.fillRule,
			coverRect,
			paint,
			blendMode: entry.blendMode,
		};
	}

	const worldToLocal = paintSpaceWorldToLocal(paint, entry.worldTransform);
	if (!worldToLocal) {
		return {
			kind: "fill",
			ownerId: entry.nodeId,
			triangles,
			fillRule: entry.fillRule,
			coverRect,
			paint: transparentFallback,
			blendMode: entry.blendMode,
		};
	}
	return {
		kind: "fill",
		ownerId: entry.nodeId,
		triangles,
		fillRule: entry.fillRule,
		coverRect,
		paint: gpuPaintWithoutDrawListTransform(paint),
		worldToLocal,
		blendMode: entry.blendMode,
	};
}

/**
 * Resolves one `clip-begin`/`clip-end` entry's flattened+fanned world-space
 * stencil triangles (E1 S7), reusing the SAME `tolerance`-keyed
 * {@link flattenCache} and {@link fanTriangulateRings}/{@link worldCoverRect}
 * helpers a fill entry already shares — a clip silhouette's own contours are
 * flattened exactly like an ordinary fill's, just without any paint. Unlike
 * {@link fillDrawForEntry}, this result carries NO scale-dependent field (no
 * `halfWidthWorld` equivalent), so it is fully frame-ready the moment the
 * bucket-level compile produces it — {@link buildGpuArtboardFrame}'s
 * per-frame remap passes a `clip-begin`/`clip-end` draw through unchanged,
 * mirroring how a `GpuFillDraw` already needs no further per-frame work
 * either. `fanTriangulateRings` on an EMPTY contour list (an unrepresentable
 * silhouette geometry — see `display-list.ts`'s clip-scope branch) returns an
 * empty `Float32Array` by construction, which is the exact "empty clip"
 * degenerate case `shared/gpu/webgpu.ts`'s materialize pass is built to
 * handle totally (see this module's top doc comment's S7 addition and
 * `docs/gpu-canvas-convergence-e1-plan.md`'s S7 decisions).
 */
function clipTrianglesAndCoverRect(
	entry: GpuClipBeginEntry | GpuClipEndEntry,
	tolerance: number,
): {
	readonly triangles: Float32Array;
	readonly coverRect: GpuFillDraw["coverRect"];
} {
	const cached = flattenCache.get(entry.contours);
	const rings =
		cached && cached.tolerance === tolerance
			? cached.rings
			: flattenContoursToRings(entry.contours, tolerance);
	if (!cached || cached.tolerance !== tolerance) {
		flattenCache.set(entry.contours, { tolerance, rings });
	}
	const triangles = fanTriangulateRings(rings, entry.worldTransform);
	const coverRect = worldCoverRect(entry.coverBounds, entry.worldTransform);
	return { triangles, coverRect };
}

/** Builds a frame-ready {@link GpuClipBegin} from a compiler `clip-begin` entry (E1 S7) — see {@link clipTrianglesAndCoverRect}'s doc comment. */
function clipBeginDrawForEntry(
	entry: GpuClipBeginEntry,
	tolerance: number,
): GpuClipBegin {
	const { triangles, coverRect } = clipTrianglesAndCoverRect(entry, tolerance);
	return { kind: "clip-begin", triangles, fillRule: entry.fillRule, coverRect };
}

/** Builds a frame-ready {@link GpuClipEnd} from a compiler `clip-end` entry (E1 S7) — see {@link clipTrianglesAndCoverRect}'s doc comment. Only `coverRect` is actually used by the renderer's clear pass; the flatten/fan work is still shared through the SAME `flattenCache` entry its matching `clip-begin` already populated. */
function clipEndDrawForEntry(
	entry: GpuClipEndEntry,
	tolerance: number,
): GpuClipEnd {
	const { coverRect } = clipTrianglesAndCoverRect(entry, tolerance);
	return { kind: "clip-end", coverRect };
}

/**
 * One uniform-stroke entry's BUCKET-cacheable mesh compile — everything about
 * a stroke draw that depends only on geometry and the zoom bucket (S4), never
 * on the raw per-frame `scale`. Split out of the (still exported-shape)
 * `GpuStrokeDraw` so {@link memoizedArtboardsForBucket} can cache exactly this
 * piece while {@link strokeDrawFromCompile} still recomputes the genuinely
 * scale-dependent `halfWidthWorld`/cover-rect margin fresh every call (see
 * that function's doc comment).
 */
export type StrokeMeshCompile = {
	readonly ownerId: string;
	readonly mesh: Float32Array;
	readonly coverRect: {
		readonly x: number;
		readonly y: number;
		readonly width: number;
		readonly height: number;
	};
	readonly miterLimit: number;
	readonly paint: GpuStrokeDraw["paint"];
	readonly worldToLocal?: GpuStrokeDraw["worldToLocal"];
	/**
	 * SCREEN-px dash pattern/offset (E1 S8), carried through the bucket cache
	 * UNCHANGED — these are zoom-independent authored inputs (mirroring
	 * `strokeWidth`'s own screen-px authored contract), so only their per-frame
	 * WORLD-unit conversion in {@link strokeDrawFromCompile} depends on `scale`,
	 * never the compile step itself.
	 */
	readonly dashPattern?: readonly number[];
	readonly dashOffset?: number;
};

/**
 * Resolves one uniform-stroke entry's WORLD-space extrusion mesh (E1 S3),
 * reusing the SAME `tolerance`-keyed ring cache the fill path already
 * populates (`flattenCache`, keyed on `entry.contours` — a node's fill and
 * stroke entries share the identical `contours` reference, see
 * `display-list.ts`'s `compileNode`) for the expensive Bezier-flattening
 * step; the mesh itself (segment quads + joins + caps) is rebuilt only when
 * the CALLER's own bucket-level memo ({@link memoizedArtboardsForBucket})
 * misses — see `shared/gpu/stroke-mesh.ts`'s doc comment for why rebuilding
 * it on a genuine bucket/DPR change is correct and cheap, not a performance
 * regression.
 */
function strokeMeshCompileForEntry(
	entry: GpuStrokeDrawListEntry,
	tolerance: number,
): StrokeMeshCompile {
	const cached = flattenCache.get(entry.contours);
	const rings =
		cached && cached.tolerance === tolerance
			? cached.rings
			: flattenContoursToRings(entry.contours, tolerance);
	if (!cached || cached.tolerance !== tolerance) {
		flattenCache.set(entry.contours, { tolerance, rings });
	}

	const contours = rings.map((ring, index) => ({
		ring,
		closed: entry.contours[index]?.closed ?? false,
	}));
	const mesh = buildStrokeMesh(contours, entry.worldTransform, {
		cap: entry.cap,
		join: entry.join,
		miterLimit: entry.miterLimit,
	});
	const worldToLocal = paintSpaceWorldToLocal(
		entry.paint,
		entry.worldTransform,
	);
	const paint: GpuStrokeDraw["paint"] =
		entry.paint.kind === "solid" || worldToLocal
			? gpuPaintWithoutDrawListTransform(entry.paint)
			: { kind: "solid", color: { r: 0, g: 0, b: 0, a: 0 } };

	return {
		ownerId: entry.nodeId,
		mesh,
		coverRect: worldCoverRect(entry.coverBounds, entry.worldTransform),
		miterLimit: entry.miterLimit,
		paint,
		...(worldToLocal && paint.kind !== "solid" ? { worldToLocal } : {}),
		...(entry.dashPattern ? { dashPattern: entry.dashPattern } : {}),
		...(entry.dashOffset !== undefined ? { dashOffset: entry.dashOffset } : {}),
	};
}

/**
 * Assembles one stroke draw's final, per-frame-fresh fields from a (possibly
 * bucket-cached) {@link StrokeMeshCompile}. `halfWidthWorld = (strokeWidth /
 * 2) / scale` is the WORLD-space half-width that reproduces a SCREEN-constant
 * (`non-scaling-stroke`) width at the CURRENT camera scale, and the cover
 * rect is the compiled paint bounds expanded by `halfWidthWorld *
 * max(1, miterLimit)` — a cheap, conservative bound on the worst-case miter
 * reach the mesh (built with a `miterLimit`-respecting fallback-to-bevel, see
 * `stroke-mesh.ts::pushJoin`) can ever actually emit. Both are single
 * divisions/multiplications — recomputed on EVERY call, memoized or not, so a
 * cache HIT on the mesh never staleness-leaks a scale that changed within the
 * same zoom bucket.
 *
 * (E1 S8) `dashPatternWorld`/`dashOffsetWorld` divide the compiled SCREEN-px
 * dash fields by `scale`, the SAME per-frame conversion cadence as
 * `halfWidthWorld` — a zoom/pan change never re-tessellates the mesh for the
 * dash either, only these two cheap divisions. Both are omitted entirely when
 * `compile.dashPattern` is absent (undashed), so a `GpuStrokeDraw` for an
 * undashed stroke is byte-identical to pre-S8 output.
 */
function strokeDrawFromCompile(
	compile: StrokeMeshCompile,
	strokeWidth: number,
	scale: number,
): GpuStrokeDraw {
	const halfWidthWorld = strokeWidth / 2 / scale;
	const margin = halfWidthWorld * Math.max(1, compile.miterLimit);
	return {
		kind: "stroke",
		ownerId: compile.ownerId,
		mesh: compile.mesh,
		halfWidthWorld,
		coverRect: {
			x: compile.coverRect.x - margin,
			y: compile.coverRect.y - margin,
			width: compile.coverRect.width + margin * 2,
			height: compile.coverRect.height + margin * 2,
		},
		paint: compile.paint,
		...(compile.worldToLocal ? { worldToLocal: compile.worldToLocal } : {}),
		...(compile.dashPattern
			? {
					dashPatternWorld: compile.dashPattern.map((value) => value / scale),
				}
			: {}),
		...(compile.dashPattern && compile.dashOffset !== undefined
			? { dashOffsetWorld: compile.dashOffset / scale }
			: {}),
	};
}

const unitColorFromHex = (color: string, alpha: number): GpuColor | null => {
	const rgb = hexToRgb(color);
	if (!rgb) return null;
	return { r: rgb.r / 255, g: rgb.g / 255, b: rgb.b / 255, a: alpha };
};

const WHITE_GPU_COLOR: GpuColor = { r: 1, g: 1, b: 1, a: 1 };

const expandWorldRect = (
	rect: GpuQuad["rect"],
	amount: number,
): GpuQuad["rect"] => ({
	x: rect.x - amount,
	y: rect.y - amount,
	width: rect.width + amount * 2,
	height: rect.height + amount * 2,
});

const unionWorldRects = (
	left: GpuQuad["rect"],
	right: GpuQuad["rect"],
): GpuQuad["rect"] => {
	const x = Math.min(left.x, right.x);
	const y = Math.min(left.y, right.y);
	const rightEdge = Math.max(left.x + left.width, right.x + right.width);
	const bottomEdge = Math.max(left.y + left.height, right.y + right.height);
	return { x, y, width: rightEdge - x, height: bottomEdge - y };
};

const bucketDrawOwnerId = (draw: ArtboardBucketDraw): string | undefined => {
	if (draw.kind === "fill") return draw.ownerId;
	if (draw.kind === "stroke") return draw.compile.ownerId;
	return undefined;
};

const bucketDrawBounds = (
	draw: ArtboardBucketDraw,
): GpuQuad["rect"] | undefined => {
	if (draw.kind === "fill") return draw.coverRect;
	if (draw.kind === "stroke") return draw.compile.coverRect;
	return undefined;
};

const gpuEffectForSourceOpticsPlan = (
	plan: SourceOpticsNodePlan,
	bounds: GpuQuad["rect"],
): GpuNodeEffect | null => {
	if (plan.source) {
		return {
			kind: "radiance-field",
			bounds: expandWorldRect(bounds, plan.source.outwardReach),
			threshold: plan.source.bloom.threshold,
			bloom: {
				enabled: plan.source.bloom.enabled,
				radiusX: plan.source.bloom.radiusX,
				radiusY: plan.source.bloom.radiusY ?? plan.source.bloom.radiusX,
				intensity: plan.source.bloom.intensity,
			},
			rays: plan.source.rays.slice(0, 4).map((ray) => {
				const kernel = compileSourceOpticsRayKernel(ray);
				return {
					enabled: ray.enabled,
					direction: kernel.direction,
					intensity: ray.intensity,
					bridgeSigma: kernel.bridgeSigma,
					samples: kernel.samples,
				};
			}),
			...(plan.source.atmosphere
				? {
						atmosphere: {
							enabled: plan.source.atmosphere.enabled,
							direction: plan.source.atmosphereDirection,
							mix: plan.source.atmosphere.mix,
							falloff: plan.source.atmosphere.falloff,
							reach: plan.source.atmosphere.reach,
							tint:
								unitColorFromHex(plan.source.atmosphere.tint ?? "#ffffff", 1) ??
								WHITE_GPU_COLOR,
						},
					}
				: {}),
			...(plan.source.lens ? { lens: plan.source.lens } : {}),
			blendMode: plan.source.bloom.blendMode === "screen" ? "screen" : "normal",
		};
	}
	if (!plan.target) return null;
	const { binding } = plan.target;
	const worldDirectionDelta = {
		x: plan.target.sourceCenter.x - plan.target.targetCenter.x,
		y: plan.target.sourceCenter.y - plan.target.targetCenter.y,
	};
	const worldDirectionLength = Math.max(
		1e-6,
		Math.hypot(worldDirectionDelta.x, worldDirectionDelta.y),
	);
	return {
		kind: "surface-response-field",
		bounds,
		direction: {
			x: worldDirectionDelta.x / worldDirectionLength,
			y: worldDirectionDelta.y / worldDirectionLength,
		},
		...(binding.surface
			? {
					surface: {
						...binding.surface,
						tint:
							unitColorFromHex(binding.surface.tint ?? "#ffffff", 1) ??
							WHITE_GPU_COLOR,
					},
				}
			: {}),
		...(binding.diffusion
			? {
					diffusion: {
						...binding.diffusion,
						tint:
							unitColorFromHex(binding.diffusion.tint ?? "#ffffff", 1) ??
							WHITE_GPU_COLOR,
					},
				}
			: {}),
		...(binding.edge
			? {
					edge: {
						...binding.edge,
						tint:
							unitColorFromHex(binding.edge.tint ?? "#ffffff", 1) ??
							WHITE_GPU_COLOR,
					},
				}
			: {}),
		microstructureAmount: plan.target.hasExistingMicrostructure
			? (binding.microstructure?.amount ?? 0)
			: 0,
		...(binding.spectral ? { spectral: binding.spectral } : {}),
	};
};

const wrapSourceOpticsEffectIslands = (
	draws: readonly ArtboardBucketDraw[],
	nodePlans: Readonly<Record<string, SourceOpticsNodePlan>>,
): readonly ArtboardBucketDraw[] => {
	const wrapped: ArtboardBucketDraw[] = [];
	let index = 0;
	while (index < draws.length) {
		const first = draws[index];
		if (!first) break;
		const ownerId = bucketDrawOwnerId(first);
		const plan = ownerId ? nodePlans[ownerId] : undefined;
		if (!ownerId || !plan) {
			wrapped.push(first);
			index += 1;
			continue;
		}
		const group: ArtboardBucketDraw[] = [];
		let bounds = bucketDrawBounds(first);
		while (index < draws.length) {
			const candidate = draws[index];
			if (!candidate || bucketDrawOwnerId(candidate) !== ownerId) break;
			group.push(candidate);
			const candidateBounds = bucketDrawBounds(candidate);
			if (candidateBounds) {
				bounds = bounds
					? unionWorldRects(bounds, candidateBounds)
					: candidateBounds;
			}
			index += 1;
		}
		const effect = bounds ? gpuEffectForSourceOpticsPlan(plan, bounds) : null;
		if (!effect) {
			wrapped.push(...group);
			continue;
		}
		const islandId = `node-effect:${ownerId}`;
		wrapped.push(
			{ kind: "effect-island-begin", id: islandId, effect },
			...group,
			{ kind: "effect-island-end", id: islandId },
		);
	}
	return wrapped;
};

/**
 * Per-artboard opaque background quad, matching `GpuSceneCanvas`'s S1 rule
 * (`hexToRgb` only accepts fully-opaque hex; an unsupported background is
 * simply omitted — `computeGpuArtboardSupport` already excluded such
 * artboards from `activeArtboardIds` upstream, so this is a total function
 * regardless).
 */
function backgroundQuadForArtboard(
	artboard: NormalizedArtboard,
): GpuQuad | undefined {
	const [paint, ...rest] = resolvePaints(artboard.fills, artboard.background);
	if (rest.length > 0 || paint?.kind !== "solid" || paint.opacity !== 1) {
		return undefined;
	}
	const color = unitColorFromHex(paint.color, 1);
	if (!color) return undefined;
	return {
		rect: {
			x: artboard.position.x,
			y: artboard.position.y,
			width: artboard.width,
			height: artboard.height,
		},
		color,
	};
}

const backgroundGradientStops = (
	stops: readonly {
		readonly offset: number;
		readonly color: string;
		readonly opacity: number;
	}[],
): readonly GpuGradientStop[] | null => {
	if (stops.length === 0 || stops.length > MAX_GRADIENT_STOPS) return null;
	const converted: GpuGradientStop[] = [];
	for (const stop of stops) {
		if (stop.opacity !== 1) return null;
		const color = unitColorFromHex(stop.color, 1);
		if (!color) return null;
		converted.push({ offset: stop.offset, color });
	}
	return converted.length > 0 ? converted : null;
};

function backgroundGradientPaintForArtboard(
	artboard: NormalizedArtboard,
): GpuPaint | null {
	const [paint, ...rest] = resolvePaints(artboard.fills, artboard.background);
	if (
		rest.length > 0 ||
		!paint ||
		paint.opacity !== 1 ||
		(paint.kind !== "linear-gradient" && paint.kind !== "radial-gradient") ||
		paint.transform
	) {
		return null;
	}
	const stops = backgroundGradientStops(paint.stops);
	if (!stops) return null;
	return paint.kind === "linear-gradient"
		? {
				kind: "linear-gradient",
				from: { x: paint.from.x, y: paint.from.y },
				to: { x: paint.to.x, y: paint.to.y },
				stops,
			}
		: {
				kind: "radial-gradient",
				center: { x: paint.center.x, y: paint.center.y },
				radius: Math.max(paint.radius.x, paint.radius.y, 0),
				stops,
			};
}

const gpuImageFit = (fit: ResolvedImageReferencePaint["fit"]): GpuImageFit =>
	fit === "fit" || fit === "crop" ? fit : "fill";

function backgroundImagePaintForArtboard(
	artboard: NormalizedArtboard,
	assets: SceneDocument["assets"],
): GpuPaint | null {
	const [paint, ...rest] = resolvePaints(artboard.fills, artboard.background);
	if (
		rest.length > 0 ||
		!paint ||
		paint.kind !== "image-reference" ||
		paint.opacity !== 1 ||
		paint.fit === "tile" ||
		paint.transform
	) {
		return null;
	}
	const href = gpuKnownOpaqueImageBackgroundHref(paint, assets);
	if (!href) return null;
	return {
		kind: "image",
		href,
		rect: { x: 0, y: 0, width: artboard.width, height: artboard.height },
		fit: gpuImageFit(paint.fit),
		opacity: 1,
	};
}

function backgroundMeshPaintForArtboard(
	artboard: NormalizedArtboard,
): GpuMeshPendingPaint | null {
	const [paint, ...rest] = resolvePaints(artboard.fills, artboard.background);
	if (
		rest.length > 0 ||
		!paint ||
		paint.kind !== "mesh-gradient" ||
		!gpuMeshBackgroundUsesOpaqueRaster(paint)
	) {
		return null;
	}
	return {
		kind: "mesh-pending",
		paint,
		rect: meshBounds(paint),
		opacity: 1,
	};
}

/**
 * Builds an opaque linear/radial/image/mesh artboard background as the FIRST
 * content draw. Solid backgrounds stay on the cheaper quad path above;
 * transparent, multi-paint, transformed, tiled, or not-known-opaque raster
 * backgrounds never reach here because the capability predicate keeps those
 * artboards on SVG.
 */
function backgroundFillDrawForArtboard(
	artboard: NormalizedArtboard,
	tolerance: number,
	assets: SceneDocument["assets"],
): GpuFillDraw | null {
	const paint =
		backgroundGradientPaintForArtboard(artboard) ??
		backgroundImagePaintForArtboard(artboard, assets) ??
		backgroundMeshPaintForArtboard(artboard);
	if (!paint) return null;
	const bounds = { x: 0, y: 0, width: artboard.width, height: artboard.height };
	const entry: GpuDrawListEntry = {
		kind: "fill",
		nodeId: `${artboard.id}:background`,
		worldTransform: {
			a: 1,
			b: 0,
			c: 0,
			d: 1,
			e: artboard.position.x,
			f: artboard.position.y,
		},
		contours: [buildRoundedRectShape(bounds, { radii: ZERO_CORNER_RADII })],
		fillRule: "nonzero",
		paint,
		coverBounds: bounds,
	};
	return fillDrawForEntry(entry, tolerance);
}

/**
 * One artboard-bucket-cacheable draw entry, IN DOCUMENT PAINT ORDER — a
 * frame-ready {@link GpuFillDraw} (fills need no further per-frame work), a
 * tagged stroke-mesh compile (the genuinely scale-dependent
 * `halfWidthWorld`/cover-rect margin is still assembled fresh every frame by
 * {@link strokeDrawFromCompile}, never cached — see that function's doc
 * comment), or (E1 S7) a frame-ready {@link GpuClipBegin}/{@link GpuClipEnd}
 * (a clip scope's triangles/coverRect are geometry-and-tolerance-only, same
 * as a fill's, so they need no per-frame reassembly either). Tagging each
 * branch with its own `kind` (mirroring `GpuFillDraw`'s own `kind: "fill"`)
 * lets {@link buildGpuArtboardFrame} map this ONE ordered array 1:1 into
 * `GpuArtboardContent.draws` without a second partitioning pass.
 */
export type ArtboardBucketDraw =
	| GpuFillDraw
	| {
			readonly kind: "stroke";
			readonly compile: StrokeMeshCompile;
			readonly strokeWidth: number;
	  }
	| GpuClipBegin
	| GpuClipEnd
	| GpuEffectIslandBegin
	| GpuEffectIslandEnd;

/** One artboard's bucket-cacheable compile output — everything except the genuinely per-frame stroke assembly (see {@link strokeDrawFromCompile}). */
export type ArtboardBucketContent = {
	readonly id: string;
	readonly rect: GpuQuad["rect"];
	readonly backgroundQuad: GpuQuad | undefined;
	readonly draws: readonly ArtboardBucketDraw[];
};

const gpuChromaticAberrationPostEffect = (
	params: NonNullable<
		ReturnType<typeof frameGpuFilmPostEffectParams>
	>["chromaticAberration"],
): GpuArtboardChromaticAberrationPostEffect | undefined =>
	params && params.maxShiftPx > 0
		? {
				kind: "chromatic-aberration",
				fringing: params.fringing,
				maxShiftPx: params.maxShiftPx,
				centerX: params.centerX,
				centerY: params.centerY,
			}
		: undefined;

const gpuPostEffectsForArtboard = (
	document: SceneDocument,
	artboardId: string,
	rect: GpuQuad["rect"],
	frame: number,
): readonly GpuArtboardPostEffect[] | undefined => {
	const intent = resolveFrameEffectIntent(document, artboardId);
	if (intent.influenceRecipe) return undefined;
	const recipe = intent.lookGraph
		? explicitFrameFilmLookGraphRecipe(intent.lookGraph)
		: intent.visualRecipe;
	const params = frameGpuFilmPostEffectParams(recipe);
	if (!params) return undefined;
	const chromaticAberration = gpuChromaticAberrationPostEffect(
		params.chromaticAberration,
	);
	const effects: GpuArtboardPostEffect[] = [];
	if (chromaticAberration) effects.push(chromaticAberration);
	if (params.grain) {
		const href = frameFilmGrainTextureHref(params.grain, frame, rect);
		if (!href) return effects.length > 0 ? effects : undefined;
		effects.push({
			kind: "film-grain",
			href,
			backgroundWeight: params.grain.backgroundWeight,
			objectWeight: params.grain.objectWeight,
			...(chromaticAberration ? { chromaticAberration } : {}),
		});
	}
	return effects.length > 0 ? effects : undefined;
};

/**
 * Narrows a document's full {@link SceneMaskPlan} (E1 S7 — see
 * `docs/gpu-canvas-convergence-e1-plan.md`'s S7 decisions) down to the two
 * inputs `compileArtboardDrawList` needs, applying the SAME admission filter
 * `capability.ts`'s `computeGpuArtboardSupport` independently applies for its
 * own capability check: a content node's applications array must have
 * EXACTLY ONE entry, and that entry must be a hard-silhouette relation the GPU
 * can represent with the existing clip stencil path (`clip` or default
 * `alpha-mask` with no soft settings). Both call sites read from the identical
 * `resolveSceneMaskPlan` shape, so they can never disagree about which
 * relations are admitted — this function does not itself decide admission
 * policy, only reproduces the shared rule for the compiler's own consumption.
 * `def.maskNode` (the resolved sibling source, looked up by the application's
 * own `defKey`) is threaded straight through unchanged — the SAME "no
 * live-override merge" contract `entities/scene/model/mask-render.ts`'s
 * `MaskSilhouette` reader already follows for the SVG adapter.
 */
function clipMaskCompileInputs(maskPlan: SceneMaskPlan): {
	readonly clipSilhouetteByContentNodeId: ReadonlyMap<string, VectorNode>;
	readonly consumedMaskNodeIds: ReadonlySet<string>;
} {
	const defByKey = new Map(maskPlan.defs.map((def) => [def.key, def]));
	const clipSilhouetteByContentNodeId = new Map<string, VectorNode>();
	for (const [
		contentNodeId,
		applications,
	] of maskPlan.applicationsByContentNodeId) {
		if (applications.length !== 1) continue;
		const [application] = applications;
		if (application === undefined) continue;
		const def = defByKey.get(application.defKey);
		if (!def?.directGpuCompatible) continue;
		if (!maskApplicationUsesHardSilhouette(application, def)) {
			continue;
		}
		clipSilhouetteByContentNodeId.set(contentNodeId, def.maskNode);
	}
	return {
		clipSilhouetteByContentNodeId,
		consumedMaskNodeIds: maskPlan.consumedMaskNodeIds,
	};
}

/**
 * Compiles every GPU-active artboard's content EXCEPT the final per-frame
 * stroke assembly — the piece {@link memoizedArtboardsForBucket} caches (S4).
 * A GPU-INACTIVE artboard contributes zero pixels here — no background quad,
 * no draws — so the SVG scene layer beneath (its own background rect plus
 * real node content) shows through the transparent canvas untouched. This is
 * the fallback honesty contract (D2): the active/inactive gate is the only
 * thing deciding what the GPU paints, never a z-order trick.
 *
 * The compiler's single ordered `entries` list (fills, strokes/outlines, and
 * — E1 S7 — clip-scope boundaries, all interleaved per node, see
 * `display-list.ts`'s doc comment) is mapped here into ONE ordered `draws`
 * array, preserving that SAME relative order end to end (a post-S4 review
 * fix — see this module's top doc comment's "bug (1)": the PREVIOUS version
 * partitioned this list into separate `fills`/`strokeCompiles` arrays, which
 * silently reordered a DIFFERENT node's stroke ahead of a LATER node's fill
 * whenever the two overlapped on screen, since the renderer then drew "every
 * artboard's fills, then every artboard's strokes" instead of replaying the
 * compiler's true cross-node paint order).
 *
 * `resolveSceneMaskPlan` runs ONCE for the whole `sampledDocument` (E1 S7),
 * not once per artboard — the document-level mask plan is artboard-agnostic
 * (a relation's content/source nodes are always resolved to the SAME
 * artboard by construction, per `mask-render.ts`'s sibling-scope invariant),
 * and this function is itself already gated behind
 * {@link memoizedArtboardsForBucket}'s single-entry memo, so the resolve
 * cost is paid at most once per genuine document/tolerance change, never per
 * frame.
 */
function compileArtboardsForBucket(
	sampledDocument: SceneDocument,
	activeArtboardIds: ReadonlySet<string>,
	liveOverrides: ReadonlyMap<string, VectorNode> | null,
	tolerance: number,
	onRasterAssetReady?: () => void,
): readonly ArtboardBucketContent[] {
	const allArtboards = selectAllArtboards(sampledDocument);
	const artboards: ArtboardBucketContent[] = [];
	const { clipSilhouetteByContentNodeId, consumedMaskNodeIds } =
		clipMaskCompileInputs(resolveSceneMaskPlan(sampledDocument));

	for (const artboard of allArtboards) {
		if (!activeArtboardIds.has(artboard.id)) continue;
		const backgroundQuad = backgroundQuadForArtboard(artboard);
		const backgroundDraw = backgroundFillDrawForArtboard(
			artboard,
			tolerance,
			sampledDocument.assets,
		);
		const drawList = compileArtboardDrawList(
			sampledDocument,
			artboard.id,
			artboard.position,
			liveOverrides,
			clipSilhouetteByContentNodeId,
			consumedMaskNodeIds,
		);
		const plainDraws: ArtboardBucketDraw[] = drawList.entries.map((entry) => {
			if (entry.kind === "fill")
				return fillDrawForEntry(entry, tolerance, onRasterAssetReady);
			if (entry.kind === "clip-begin")
				return clipBeginDrawForEntry(entry, tolerance);
			if (entry.kind === "clip-end")
				return clipEndDrawForEntry(entry, tolerance);
			return {
				kind: "stroke",
				compile: strokeMeshCompileForEntry(entry, tolerance),
				strokeWidth: entry.strokeWidth,
			};
		});
		const sourceOptics = buildSourceOpticsPresentation(
			sampledDocument,
			artboard.id,
			"webgpu",
		);
		const draws = wrapSourceOpticsEffectIslands(
			plainDraws,
			sourceOptics.nodePlans,
		);
		artboards.push({
			id: artboard.id,
			rect: {
				x: artboard.position.x,
				y: artboard.position.y,
				width: artboard.width,
				height: artboard.height,
			},
			backgroundQuad,
			draws: backgroundDraw ? [backgroundDraw, ...draws] : draws,
		});
	}

	return artboards;
}

/**
 * Single-entry ("last value") memo around {@link compileArtboardsForBucket}
 * (E1 S4 — see `docs/gpu-canvas-convergence-e1-plan.md` D7 verification
 * tooling and this module's top doc comment). Keyed on REFERENCE identity of
 * `sampledDocument`/`activeArtboardIds`/`liveOverrides` plus the computed
 * `tolerance` value (a post-S4 review fix — see this module's top doc
 * comment's "bug (2)": the PREVIOUS key used `bucketUpperScale` alone, which
 * does not change when only `dpr` changes, e.g. a browser window dragged to a
 * different-DPR monitor — silently reusing a stale, wrong-tolerance compile
 * in that case. `tolerance` already folds in both the zoom bucket AND the
 * clamped dpr, see {@link flattenToleranceForScale}, so it is a strictly
 * FINER-grained key than `bucketUpperScale` alone: a pan or a within-bucket
 * zoom tick at a STABLE dpr is still a guaranteed cache HIT, exactly as
 * before, while a genuine bucket OR dpr change is now a guaranteed MISS). A
 * genuine document edit, undo/redo, live-drag tick, or playback frame change
 * produces a NEW `sampledDocument` reference (motion/grammar sampling always
 * allocates a fresh `SceneDocument` — see `samplePresentation`), so none of
 * those can ever silently read a stale compile: identity is the correctness
 * mechanism, not a manual invalidation flag. Not an unbounded cache — exactly
 * one retained entry, replaced on every miss.
 */
let lastBucketCompile: {
	readonly sampledDocument: SceneDocument;
	readonly activeArtboardIds: ReadonlySet<string>;
	readonly liveOverrides: ReadonlyMap<string, VectorNode> | null;
	readonly tolerance: number;
	readonly artboards: readonly ArtboardBucketContent[];
} | null = null;

function memoizedArtboardsForBucket(
	sampledDocument: SceneDocument,
	activeArtboardIds: ReadonlySet<string>,
	liveOverrides: ReadonlyMap<string, VectorNode> | null,
	tolerance: number,
	onRasterAssetReady?: () => void,
): {
	readonly artboards: readonly ArtboardBucketContent[];
	readonly hit: boolean;
} {
	const cached = lastBucketCompile;
	if (
		cached &&
		cached.sampledDocument === sampledDocument &&
		cached.activeArtboardIds === activeArtboardIds &&
		cached.liveOverrides === liveOverrides &&
		cached.tolerance === tolerance
	) {
		recordCacheTelemetry({
			kind: "hit",
			artifactKind: "gpu-draw-list",
			tier: "memory",
		});
		return { artboards: cached.artboards, hit: true };
	}

	const canUsePersistentDrawList =
		liveOverrides === null && activeArtboardIds.size > 0;
	if (canUsePersistentDrawList) {
		const persistent = persistentGpuDrawListForBucket(
			{ sampledDocument, activeArtboardIds, tolerance },
			onRasterAssetReady,
		);
		if (persistent) {
			lastBucketCompile = {
				sampledDocument,
				activeArtboardIds,
				liveOverrides,
				tolerance,
				artboards: persistent,
			};
			return { artboards: persistent, hit: true };
		}
	}

	const artboards = compileArtboardsForBucket(
		sampledDocument,
		activeArtboardIds,
		liveOverrides,
		tolerance,
		onRasterAssetReady,
	);
	lastBucketCompile = {
		sampledDocument,
		activeArtboardIds,
		liveOverrides,
		tolerance,
		artboards,
	};
	if (canUsePersistentDrawList) {
		rememberPersistentGpuDrawListForBucket(
			{ sampledDocument, activeArtboardIds, tolerance },
			artboards,
		);
	}
	recordCacheTelemetry({
		kind: "miss",
		artifactKind: "gpu-draw-list",
		tier: "memory",
	});
	return { artboards, hit: false };
}

/**
 * Remaps the bucket-cached compile output into a frame-ready
 * `GpuArtboardContent[]`, reassembling only the genuinely per-frame stroke
 * fields ({@link strokeDrawFromCompile}) — a `GpuFillDraw` or (E1 S7) a
 * `GpuClipBegin`/`GpuClipEnd` needs no such reassembly (their geometry
 * depends only on tolerance, already baked in by the bucket-level compile),
 * so the `else` branch below passes those three kinds straight through
 * unchanged.
 */
export function buildGpuArtboardFrame(
	sampledDocument: SceneDocument,
	activeArtboardIds: ReadonlySet<string>,
	liveOverrides: ReadonlyMap<string, VectorNode> | null,
	frame: number,
	scale: number,
	dpr: number,
	onRasterAssetReady?: () => void,
): {
	readonly artboards: readonly GpuArtboardContent[];
	/** Whether this call reused the S4 bucket-level compile cache — exposed for the dev-only frame HUD, never read for correctness. */
	readonly compileCacheHit: boolean;
} {
	const tolerance = flattenToleranceForScale(scale, dpr);
	const { artboards: bucketArtboards, hit } = memoizedArtboardsForBucket(
		sampledDocument,
		activeArtboardIds,
		liveOverrides,
		tolerance,
		onRasterAssetReady,
	);

	const artboards: GpuArtboardContent[] = bucketArtboards.map((artboard) => {
		const postEffects = gpuPostEffectsForArtboard(
			sampledDocument,
			artboard.id,
			artboard.rect,
			frame,
		);
		return {
			rect: artboard.rect,
			backgroundQuad: artboard.backgroundQuad,
			draws: artboard.draws.map((draw) =>
				draw.kind === "stroke"
					? strokeDrawFromCompile(draw.compile, draw.strokeWidth, scale)
					: draw,
			),
			...(postEffects ? { postEffects } : {}),
		};
	});

	return { artboards, compileCacheHit: hit };
}
