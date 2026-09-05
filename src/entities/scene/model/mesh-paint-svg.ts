import {
	createMeshRasterCache,
	encodePngDataUrl,
	meshRasterCacheKey,
	rasterizeMesh,
} from "@/shared/mesh-raster";
import { svgIdSegment } from "./effect-filter";
import { coonsPatchesFromMesh, meshBounds } from "./mesh-edit";
import type { ResolvedMeshGradientPaint, ResolvedPaint } from "./style-resolve";
import { resolveNodeStyle } from "./style-resolve";
import type { SceneDocument, VectorNode } from "./types";

/**
 * Single source of truth for rasterizing mesh-gradient paints to a `<pattern>`
 * `<image>` def in the standalone code/runtime export, mirroring the in-app SVG
 * export ({@link ../../../features/export/model/svg.ts} `meshGradientDef`) and the
 * live canvas ({@link ../../../widgets/canvas-shell/model/mesh-raster-bridge.ts}
 * `createMeshStyleRasterizer`) byte-for-byte: same {@link MESH_PAINT_SVG_SCALE},
 * same Coons-patch derivation, same CPU rasterizer, same PNG encoder. Bundled via
 * {@link ../../../features/export/model/runtime-sampler-entry.ts}, so it stays
 * pure and DOM-free (the architecture check scans this directory) — no canvas,
 * no `Image`, no async decode.
 *
 * A mesh paint has no native SVG paint server, so every renderer that wants to
 * show one must rasterize it; this module exists because the runtime player
 * (`code.ts`'s `RUNTIME_PLAYER_SOURCE`) previously read only `style.fill`/
 * `style.stroke` legacy scalar strings and silently dropped the `fills`/
 * `strokes` paint stack entirely — a mesh-gradient fill rendered as `fill="none"`,
 * i.e. invisible. See the "View export result" tutorial gallery bug this fixed:
 * the grainy-gradient-orb export rendered blank.
 */

/**
 * Fixed export raster resolution (device px per node-local unit) for mesh
 * paints, matching `MESH_EXPORT_SCALE` in `svg.ts` and `MESH_DEVICE_SCALE` in
 * `mesh-raster-bridge.ts` so the exported bitmap agrees with the live canvas and
 * the in-app SVG export at the pixel level.
 */
export const MESH_PAINT_SVG_SCALE = 2;

const MESH_RASTER_CACHE_LIMIT = 64;

const rasterCache = createMeshRasterCache<string>(MESH_RASTER_CACHE_LIMIT);

/**
 * Canonical JSON signature over a mesh paint's authored content (grid size,
 * per-point position/color/opacity/handles, opacity, transform) — everything
 * that changes the rasterized bitmap. Deliberately excludes the `dataUrl` cache
 * slot so a paint that already carries one still hashes identically. Mirrors
 * `meshPaintSignature` in `mesh-raster-bridge.ts`; kept as a private duplicate
 * per this module's own "tiny pure helpers may duplicate across renderers"
 * convention (see `mask-svg.ts`), since importing across a widgets/entities
 * layer boundary is not allowed here.
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
			point.handleUp ? [point.handleUp.x, point.handleUp.y] : null,
			point.handleDown ? [point.handleDown.x, point.handleDown.y] : null,
			point.handleLeft ? [point.handleLeft.x, point.handleLeft.y] : null,
			point.handleRight ? [point.handleRight.x, point.handleRight.y] : null,
		]),
	]);

/**
 * Rasterizes (and caches) one mesh paint to a PNG data URL. The module-level
 * `rasterCache` persists across calls — not just within one — because the same
 * static mesh signature recurs every animation frame (`renderFrame` re-samples
 * many times per second via `requestAnimationFrame`), so caching across the
 * whole page's lifetime is what makes this cheap enough for playback; a page
 * reload is the only reset, matching `mesh-raster-bridge.ts`'s canvas-scoped
 * cache lifetime.
 */
const rasterizedMeshDataUrl = (paint: ResolvedMeshGradientPaint): string => {
	const bounds = meshBounds(paint);
	if (bounds.width <= 0 || bounds.height <= 0) return "";
	const key = meshRasterCacheKey({
		meshSignature: meshPaintSignature(paint),
		bounds,
		deviceScale: MESH_PAINT_SVG_SCALE,
	});
	return rasterCache.getOrCreate(key, () => {
		const patches = coonsPatchesFromMesh(paint);
		if (patches.length === 0) return "";
		const raster = rasterizeMesh({
			patches,
			bounds,
			deviceScale: MESH_PAINT_SVG_SCALE,
		});
		return encodePngDataUrl(raster.pixels, raster.width, raster.height);
	});
};

const formatNumber = (value: number): string => {
	if (!Number.isFinite(value)) return "0";
	const rounded = Math.abs(value) < 1e-10 ? 0 : Number(value.toFixed(6));
	return String(rounded);
};

const matrixAttribute = (
	transform: ResolvedMeshGradientPaint["transform"],
): string =>
	transform
		? ` patternTransform="matrix(${[
				transform.a,
				transform.b,
				transform.c,
				transform.d,
				transform.e,
				transform.f,
			]
				.map(formatNumber)
				.join(" ")})"`
		: "";

/**
 * Deterministic href placeholder for one mesh pattern, derived only from the
 * pattern's own id (already deterministic per node per role — see {@link
 * meshPatternId}). No counter/clock, so calling this twice for the same
 * pattern id always yields the same token, and it can never collide with a
 * real `data:image/png;base64,...` URL. An animated mesh whose rasterized
 * bitmap changes frame-to-frame keeps the SAME token across frames; only the
 * `hrefByToken` map entry (the token's resolved value) changes per call, so
 * correctness stays scoped to a single {@link buildSceneMeshPaintSvgArtifacts}
 * call — see that function's JSDoc for why this indirection exists.
 */
const meshPatternHrefToken = (patternId: string): string =>
	`__vm-mesh-href:${patternId}__`;

/**
 * Serializes one mesh paint as a `userSpaceOnUse` `<pattern>` wrapping a
 * rasterized PNG, byte-shape-identical to `meshGradientDef` in `svg.ts`. Returns
 * `null` for a degenerate mesh (no patches / zero-area bounds / empty raster) so
 * the caller can skip the pattern and fall back to a flat color instead of
 * pointing `fill`/`stroke` at an empty def.
 *
 * Exported so {@link ./paint-stack-svg.ts} can reuse the exact same rasterizer
 * and pattern markup for a mesh-gradient paint that appears inside a MULTI-paint
 * stack (this module's own {@link buildSceneMeshPaintSvgArtifacts} only emits a
 * def for the STACK'S FIRST mesh paint, matching the single-mesh legacy
 * behavior) — both callers share the module-level `rasterCache`, so the same
 * mesh signature is rasterized once regardless of which caller asks first;
 * that caller always passes `hrefMode: "inline"` since the in-app SVG paint
 * stack has no frame-loop token-resolution step.
 *
 * `hrefMode: "token"` swaps the inlined data URL for {@link meshPatternHrefToken}'s
 * deterministic placeholder and returns the real URL alongside so the caller can
 * populate `hrefByToken` — see {@link buildSceneMeshPaintSvgArtifacts} for why.
 */
export const meshPatternDef = (
	id: string,
	paint: ResolvedMeshGradientPaint,
	hrefMode: "inline" | "token",
): { readonly def: string; readonly dataUrl: string } | null => {
	const bounds = meshBounds(paint);
	if (bounds.width <= 0 || bounds.height <= 0) return null;
	const dataUrl = rasterizedMeshDataUrl(paint);
	if (!dataUrl) return null;
	const href = hrefMode === "token" ? meshPatternHrefToken(id) : dataUrl;
	const def =
		`<pattern id="${id}" patternUnits="userSpaceOnUse" patternContentUnits="userSpaceOnUse" ` +
		`x="${formatNumber(bounds.x)}" y="${formatNumber(bounds.y)}" ` +
		`width="${formatNumber(bounds.width)}" height="${formatNumber(bounds.height)}"` +
		`${matrixAttribute(paint.transform)}>` +
		`<image href="${href}" x="0" y="0" width="${formatNumber(bounds.width)}" height="${formatNumber(bounds.height)}" preserveAspectRatio="none" /></pattern>`;
	return { def, dataUrl };
};

/** Deterministic per-node-per-role mesh pattern id. No counter/clock. */
const meshPatternId = (nodeId: string, role: "fill" | "stroke"): string =>
	`mesh-paint-${role}-${svgIdSegment(nodeId)}`;

/** Finds the first mesh-gradient paint in a resolved paint stack, if any. */
const firstMeshPaint = (
	paints: readonly ResolvedPaint[],
): ResolvedMeshGradientPaint | undefined =>
	paints.find(
		(paint): paint is ResolvedMeshGradientPaint =>
			paint.kind === "mesh-gradient",
	);

/** The mesh-pattern `<pattern>` defs + which `url(#...)` reference (if any) a
 * node's fill/stroke should use instead of its resolved legacy color string. */
export type SceneMeshPaintSvgArtifacts = {
	/** Concatenated mesh `<pattern>` defs, "\n"-joined. */
	readonly defs: string;
	/** `url(#pattern-id)` per node id whose resolved fill is a mesh gradient. */
	readonly fillPatternRefByNodeId: Readonly<Record<string, string>>;
	/** `url(#pattern-id)` per node id whose resolved stroke is a mesh gradient. */
	readonly strokePatternRefByNodeId: Readonly<Record<string, string>>;
	/**
	 * Token → real data URL, populated only when `hrefMode: "token"` was
	 * requested; empty in the default `"inline"` mode (kept as one return shape
	 * rather than an optional field so every caller can read it unconditionally).
	 */
	readonly hrefByToken: Readonly<Record<string, string>>;
};

/**
 * Optional per-call knobs for {@link buildSceneMeshPaintSvgArtifacts}.
 * `hrefMode` defaults to `"inline"` (today's byte-identical behavior: the
 * `<pattern>` def's `<image href>` carries the real, potentially multi-
 * megabyte, `data:image/png;base64,...` URL). `"token"` substitutes a
 * deterministic placeholder for that URL instead — see {@link
 * buildSceneMeshPaintSvgArtifacts}'s own JSDoc for why a caller would want
 * this.
 */
export type SceneMeshPaintSvgOptions = {
	readonly hrefMode?: "inline" | "token";
};

/**
 * Walks the (composed) scene and serializes a `<pattern>` def for every node
 * whose resolved fill or stroke is a mesh-gradient paint, using the same
 * resolution ({@link resolveNodeStyle}) the in-app SVG export and stroke-blur
 * artifacts already use. A node with a degenerate mesh (see {@link
 * meshPatternDef}) is omitted from both maps, so its caller falls back to the
 * node's resolved legacy fill/stroke color exactly as before this module
 * existed — a mesh paint can never regress a node from "wrong color" to
 * "invisible" relative to the pre-mesh-support runtime.
 *
 * `options.hrefMode` defaults to `"inline"`, whose output is byte-identical to
 * this function's behavior before the mode existed — the in-app SVG export,
 * poster frames, and every other caller besides the runtime player keep
 * getting the real data URL inline and can ignore `hrefByToken` entirely.
 * `"token"` exists ONLY for the motion/code runtime player (`code.ts`'s
 * `RUNTIME_PLAYER_SOURCE`): that player re-renders a frame by building the
 * FULL SVG markup string and running it through `DOMParser.parseFromString`
 * every frame, but a mesh pattern's data URL is frame-invariant (the raster
 * cache is content-keyed, not frame-keyed — see {@link rasterizedMeshDataUrl}),
 * so re-parsing megabytes of base64 every frame is pure waste. In `"token"`
 * mode the `<image href>` carries a short deterministic placeholder (see
 * {@link meshPatternHrefToken}) instead, and the real URL comes back via
 * `hrefByToken` so the caller can substitute it back in on the rare path that
 * actually touches the DOM (initial mount / structure-mismatch fallback),
 * while the steady-state per-frame diff never has to look at, let alone
 * re-parse, the multi-megabyte string at all.
 */
export function buildSceneMeshPaintSvgArtifacts(
	scene: SceneDocument,
	options?: SceneMeshPaintSvgOptions,
): SceneMeshPaintSvgArtifacts {
	const hrefMode = options?.hrefMode ?? "inline";
	const defParts: string[] = [];
	const fillPatternRefByNodeId: Record<string, string> = {};
	const strokePatternRefByNodeId: Record<string, string> = {};
	const hrefByToken: Record<string, string> = {};
	const visit = (nodes: readonly VectorNode[]): void => {
		for (const node of nodes) {
			const style = resolveNodeStyle(node.style);
			const meshFill = firstMeshPaint(style.fills);
			if (meshFill) {
				const id = meshPatternId(node.id, "fill");
				const result = meshPatternDef(id, meshFill, hrefMode);
				if (result) {
					defParts.push(result.def);
					fillPatternRefByNodeId[node.id] = `url(#${id})`;
					if (hrefMode === "token") {
						hrefByToken[meshPatternHrefToken(id)] = result.dataUrl;
					}
				}
			}
			const meshStroke = firstMeshPaint(style.strokes);
			if (meshStroke) {
				const id = meshPatternId(node.id, "stroke");
				const result = meshPatternDef(id, meshStroke, hrefMode);
				if (result) {
					defParts.push(result.def);
					strokePatternRefByNodeId[node.id] = `url(#${id})`;
					if (hrefMode === "token") {
						hrefByToken[meshPatternHrefToken(id)] = result.dataUrl;
					}
				}
			}
			if (node.children) visit(node.children);
		}
	};
	for (const layer of scene.layers) visit(layer.nodes);
	return {
		defs: defParts.join("\n"),
		hrefByToken,
		fillPatternRefByNodeId,
		strokePatternRefByNodeId,
	};
}
