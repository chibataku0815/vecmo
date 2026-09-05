import {
	coonsPatchesFromMesh,
	meshBounds,
} from "@/entities/scene/model/mesh-edit";
import type {
	ResolvedMeshGradientPaint,
	ResolvedNodeStyle,
	ResolvedPaint,
} from "@/entities/scene/model/style-resolve";
import {
	createMeshRasterCache,
	encodePngDataUrl,
	type MeshRasterCache,
	type MeshRasterRequest,
	type MeshRasterResult,
	meshRasterCacheKey,
	rasterizeMesh,
} from "@/shared/mesh-raster";
import {
	persistentRasterDataUrl,
	rememberPersistentRasterDataUrl,
} from "./persistent-raster-cache";

/**
 * Widget-layer bridge that turns resolved mesh paints into renderable bitmaps. A
 * mesh has no native SVG paint server, so `resolveNodeStyle` (pure, in `entities`)
 * leaves `dataUrl` empty and this DOM-free-but-feature-layer step fills it before
 * `canvasPaintsForStyle` runs. The same shared rasterizer feeds the SVG exporter,
 * so canvas and export agree at the pixel level.
 *
 * Results are memoized in a small bounded cache keyed by mesh content, so a mesh
 * is re-rasterized only when its points/colors/topology change — not on every
 * render — while non-mesh style edits stay live (the style object is rebuilt fresh
 * each call; only the expensive bitmap is cached).
 */

/**
 * Fixed raster resolution (device px per node-local unit). Zoom-adaptive re-raster
 * for crisp high-zoom display is a deferred optimization; at a fixed scale the
 * `userSpaceOnUse` pattern still aligns exactly — it only softens when zoomed in.
 */
const MESH_DEVICE_SCALE = 2;
const MESH_CACHE_LIMIT = 64;

export type MeshStyleRasterizerOptions = {
	readonly cache?: MeshRasterCache<string>;
	readonly rasterize?: (request: MeshRasterRequest) => MeshRasterResult;
	readonly encode?: (
		pixels: Uint8ClampedArray,
		width: number,
		height: number,
	) => string;
};

const optionalPointSignature = (
	point: { readonly x: number; readonly y: number } | undefined,
) => (point ? [point.x, point.y] : null);

/**
 * Canonical paint-side signature for the raster artifact. The ordered array
 * avoids object key-order misses and deliberately excludes `dataUrl`, which is a
 * derived cache value rather than authored mesh state.
 */
const meshPaintSignature = (paint: ResolvedMeshGradientPaint): string =>
	JSON.stringify([
		paint.kind,
		paint.rows,
		paint.cols,
		paint.opacity,
		paint.transform
			? [
					paint.transform.a,
					paint.transform.b,
					paint.transform.c,
					paint.transform.d,
					paint.transform.e,
					paint.transform.f,
				]
			: null,
		paint.points.map((point) => [
			point.point.x,
			point.point.y,
			point.color,
			point.opacity ?? null,
			optionalPointSignature(point.handleUp),
			optionalPointSignature(point.handleDown),
			optionalPointSignature(point.handleLeft),
			optionalPointSignature(point.handleRight),
		]),
	]);

/**
 * Creates the bridge function used by the canvas renderer. The production
 * instance shares a bounded cache; tests inject raster/encode functions so they
 * can assert cache hit/miss behavior without doing expensive CPU raster work.
 */
export function createMeshStyleRasterizer(
	options: MeshStyleRasterizerOptions = {},
): (style: ResolvedNodeStyle) => ResolvedNodeStyle {
	const cache =
		options.cache ?? createMeshRasterCache<string>(MESH_CACHE_LIMIT);
	const rasterize = options.rasterize ?? rasterizeMesh;
	const encode = options.encode ?? encodePngDataUrl;

	const rasterizePaint = (paint: ResolvedPaint): ResolvedPaint => {
		if (paint.kind !== "mesh-gradient") return paint;
		const bounds = meshBounds(paint);
		if (bounds.width <= 0 || bounds.height <= 0) return paint;
		const key = meshRasterCacheKey({
			meshSignature: meshPaintSignature(paint),
			bounds,
			deviceScale: MESH_DEVICE_SCALE,
		});
		const dataUrl = cache.getOrCreate(key, () => {
			const persistent = persistentRasterDataUrl("mesh-raster", key);
			if (persistent) return persistent;
			const patches = coonsPatchesFromMesh(paint);
			if (patches.length === 0) return "";
			const raster = rasterize({
				patches,
				bounds,
				deviceScale: MESH_DEVICE_SCALE,
			});
			const encoded = encode(raster.pixels, raster.width, raster.height);
			rememberPersistentRasterDataUrl("mesh-raster", key, encoded);
			return encoded;
		});
		if (!dataUrl) return paint;
		return { ...paint, dataUrl };
	};

	return (style) => {
		if (!hasMeshPaint(style.fills) && !hasMeshPaint(style.strokes))
			return style;
		return {
			...style,
			fills: style.fills.map(rasterizePaint),
			strokes: style.strokes.map(rasterizePaint),
		};
	};
}

const hasMeshPaint = (paints: readonly ResolvedPaint[]): boolean =>
	paints.some((paint) => paint.kind === "mesh-gradient");

/**
 * Returns a node style whose mesh fills/strokes carry a rasterized `dataUrl`.
 * A no-op (returns the same object) when no role contains a mesh paint, so the
 * common case adds nothing to the render path.
 */
export const rasterizeStyleMeshes = createMeshStyleRasterizer();
