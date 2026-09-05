/**
 * Single source of truth for serializing a resolved fill/stroke PAINT STACK
 * (`style.fills`/`style.strokes`, plural, as opposed to the single legacy
 * `style.fill`/`style.stroke` color) into per-layer SVG paint values, shared by
 * the in-app SVG export ({@link ../../../features/export/model/svg.ts}
 * `resolveSvgPaintLayer`/`renderStackedShape`) and the standalone code/runtime
 * export (bundled via
 * {@link ../../../features/export/model/runtime-sampler-entry.ts}).
 *
 * This module exists because the runtime player (`code.ts`'s
 * `RUNTIME_PLAYER_SOURCE`) previously read only the legacy `style.fill`/
 * `style.stroke` scalar strings: a gradient/image paint anywhere in the stack
 * (or a stack with more than one paint) silently dropped out of exported
 * playback even though the in-app SVG export already rendered it in full.
 * {@link ./mesh-paint-svg.ts} fixed the single-mesh-paint case earlier; this
 * module generalizes to every paint kind and to multi-paint stacks.
 *
 * Pure and DOM-free so it bundles into the standalone runtime unchanged (the
 * architecture check scans this directory for browser/DOM globals).
 */

import { imagePaintHref } from "./assets";
import { svgIdSegment } from "./effect-filter";
import { meshPatternDef } from "./mesh-paint-svg";
import {
	imagePatternDef,
	linearGradientDef,
	paintStackNeedsLayerRendering,
	radialGradientDef,
} from "./paint-server-svg";
import type {
	ResolvedMeshGradientPaint,
	ResolvedNodeStyle,
	ResolvedPaint,
} from "./style-resolve";
import { resolveNodeStyle } from "./style-resolve";
import type { SceneDocument, VectorNode } from "./types";

/** The two roles a resolved paint stack can fill on a node, matching `ExportPaintRole` in `features/export/model/style.ts`. */
export type PaintStackRole = "fill" | "stroke";

/** One resolved, render-ready paint layer: an SVG paint value plus its own opacity. */
export type RuntimePaintLayer = {
	readonly value: string;
	readonly opacity: number;
};

/**
 * Matches {@link meshPatternDef}'s signature exactly. Injected into
 * {@link resolvePaintLayer} (via {@link createScenePaintSvgArtifactsBuilder})
 * rather than called directly, so a lean/flat runtime-sampler tier can supply
 * a fail-loud no-op instead of the real mesh-rasterizing implementation,
 * letting `mesh-paint-svg.ts` and the `shared/mesh-raster/*` PNG/DEFLATE
 * encoder it needs tree-shake out of a tier the motion-artifact tier
 * predicate has already confirmed has no mesh-gradient paint anywhere.
 */
export type MeshPatternDefResolver = (
	id: string,
	paint: ResolvedMeshGradientPaint,
	hrefMode: "inline" | "token",
) => { readonly def: string; readonly dataUrl: string } | null;

const SVG_STYLE_FALLBACK_COLOR = "#000000";

const isVisibleColor = (value: string): boolean => {
	const normalized = value.trim().toLowerCase();
	return (
		normalized !== "" && normalized !== "none" && normalized !== "transparent"
	);
};

const paintListForRole = (
	style: ResolvedNodeStyle,
	role: PaintStackRole,
): readonly ResolvedPaint[] => (role === "fill" ? style.fills : style.strokes);

const legacyColorForRole = (
	style: ResolvedNodeStyle,
	role: PaintStackRole,
): string => (role === "fill" ? style.fill : style.stroke);

/**
 * Chooses a deterministic visible fallback color without inventing renderer
 * behavior: solid paint, first gradient/mesh stop, legacy color, then the
 * caller default. Duplicated from `features/export/model/style.ts`'s
 * `fallbackColorForRole` (a features-layer module entities may not import) —
 * this entities-layer copy is a pure function of `ResolvedNodeStyle` with no
 * other dependency, so it cannot drift in behavior even though it is a second
 * copy of the same logic.
 */
const fallbackColorForRole = (
	style: ResolvedNodeStyle,
	role: PaintStackRole,
	defaultColor: string,
): string => {
	for (const paint of paintListForRole(style, role)) {
		if (paint.kind === "solid" && isVisibleColor(paint.color))
			return paint.color;
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
	const legacy = legacyColorForRole(style, role);
	return isVisibleColor(legacy) ? legacy : defaultColor;
};

/**
 * Resolves one paint in a role's stack into a render-ready SVG paint layer,
 * pushing any def it needs into `defs` with an index-qualified id
 * (`paint-<node>-<role>-<i>`, matching `resolveSvgPaintLayer` in `svg.ts` so
 * both renderers mint the same ids for the same node/role/index). Mirrors that
 * function's per-kind fallback semantics exactly, minus fidelity-issue
 * recording (the runtime player has no export-issue report to write to).
 */
const resolvePaintLayer = (
	defs: string[],
	node: VectorNode,
	paint: ResolvedPaint,
	role: PaintStackRole,
	paintIndex: number,
	style: ResolvedNodeStyle,
	assets: SceneDocument["assets"],
	resolveMeshPatternDef: MeshPatternDefResolver,
): RuntimePaintLayer => {
	const id = `paint-${svgIdSegment(node.id)}-${role}-${paintIndex}`;
	switch (paint.kind) {
		case "solid":
			return { value: paint.color, opacity: paint.opacity };
		case "linear-gradient": {
			if (paint.stops.length === 0) {
				return {
					value: fallbackColorForRole(style, role, SVG_STYLE_FALLBACK_COLOR),
					opacity: paint.opacity,
				};
			}
			defs.push(linearGradientDef(id, paint));
			return { value: `url(#${id})`, opacity: paint.opacity };
		}
		case "radial-gradient": {
			if (paint.stops.length === 0) {
				return {
					value: fallbackColorForRole(style, role, SVG_STYLE_FALLBACK_COLOR),
					opacity: paint.opacity,
				};
			}
			defs.push(radialGradientDef(id, paint));
			return { value: `url(#${id})`, opacity: paint.opacity };
		}
		case "image-reference": {
			const href = imagePaintHref(paint, assets);
			if (!href) {
				return {
					value: fallbackColorForRole(style, role, SVG_STYLE_FALLBACK_COLOR),
					opacity: paint.opacity,
				};
			}
			defs.push(imagePatternDef(id, href, paint));
			return { value: `url(#${id})`, opacity: paint.opacity };
		}
		case "mesh-gradient": {
			// Always "inline": this module has no hrefMode plumbing of its own (it
			// serves the in-app SVG export and the runtime player's non-token-mode
			// bundling alike), so it always wants the real data URL inlined —
			// matching every other paint kind's def in this function.
			const result = resolveMeshPatternDef(id, paint, "inline");
			if (!result) {
				return {
					value: fallbackColorForRole(style, role, SVG_STYLE_FALLBACK_COLOR),
					opacity: paint.opacity,
				};
			}
			defs.push(result.def);
			return { value: `url(#${id})`, opacity: paint.opacity };
		}
	}
};

/**
 * Resolves every visible paint of a role into render-ready layers, in render
 * (bottom→top) order — the leading source paint (index 0) is drawn LAST so it
 * sits on top, matching `resolveSvgPaintLayers` in `svg.ts`. Defs are pushed in
 * source order; only the returned layer list is reversed.
 */
const resolvePaintLayers = (
	defs: string[],
	node: VectorNode,
	style: ResolvedNodeStyle,
	role: PaintStackRole,
	assets: SceneDocument["assets"],
	resolveMeshPatternDef: MeshPatternDefResolver,
): readonly RuntimePaintLayer[] =>
	paintListForRole(style, role)
		.map((paint, index) =>
			resolvePaintLayer(
				defs,
				node,
				paint,
				role,
				index,
				style,
				assets,
				resolveMeshPatternDef,
			),
		)
		.reverse();

/**
 * The paint-server defs for every stack-owned fill/stroke role in the scene,
 * plus the ordered render-ready layers per role per node id. A role is present
 * in the corresponding map IFF {@link paintStackNeedsLayerRendering} is true for
 * that stack (fill), or additionally `style.strokeWidth > 0` (stroke — a
 * zero-width stroke paints nothing regardless of stack shape).
 */
export type ScenePaintSvgArtifacts = {
	/** Concatenated paint-server `<def>`s (gradients/patterns), "\n"-joined. */
	readonly defs: string;
	/** Ordered fill layers per node id, for nodes whose fill stack is stack-owned. */
	readonly fillLayersByNodeId: Readonly<
		Record<string, readonly RuntimePaintLayer[]>
	>;
	/** Ordered stroke layers per node id, for nodes whose stroke stack is stack-owned. */
	readonly strokeLayersByNodeId: Readonly<
		Record<string, readonly RuntimePaintLayer[]>
	>;
};

/**
 * Builds a {@link buildScenePaintSvgArtifacts}-shaped function bound to the
 * given mesh-pattern resolver. Factored out (rather than calling
 * {@link meshPatternDef} directly inside the walk) so the FULL/CORE/LEAN/FLAT
 * runtime-sampler entries can each bind their own resolver while the exported
 * function keeps the single-argument `(scene) => ScenePaintSvgArtifacts`
 * shape `RuntimeSamplerApi` requires: the default export below binds the real
 * {@link meshPatternDef}; a lean/flat entry instead calls this factory with a
 * fail-loud no-op, so the real resolver (and the `mesh-paint-svg.ts` +
 * `shared/mesh-raster/*` PNG/DEFLATE encoder graph it needs) never gets
 * statically referenced from a tier the motion-artifact tier predicate has
 * already confirmed has no mesh-gradient paint to resolve.
 */
export function createScenePaintSvgArtifactsBuilder(
	resolveMeshPatternDef: MeshPatternDefResolver,
): (scene: SceneDocument) => ScenePaintSvgArtifacts {
	return function buildScenePaintSvgArtifacts(
		scene: SceneDocument,
	): ScenePaintSvgArtifacts {
		const defParts: string[] = [];
		const fillLayersByNodeId: Record<string, readonly RuntimePaintLayer[]> = {};
		const strokeLayersByNodeId: Record<string, readonly RuntimePaintLayer[]> =
			{};
		const visit = (nodes: readonly VectorNode[]): void => {
			for (const node of nodes) {
				// Matches buildSceneEffectFilterArtifacts's early return: neither renderer
				// paints an invisible subtree, so its paint-stack defs would be dead weight.
				if (!node.visible) continue;
				const style = resolveNodeStyle(node.style);
				if (paintStackNeedsLayerRendering(style.fills)) {
					fillLayersByNodeId[node.id] = resolvePaintLayers(
						defParts,
						node,
						style,
						"fill",
						scene.assets,
						resolveMeshPatternDef,
					);
				}
				if (
					style.strokeWidth > 0 &&
					paintStackNeedsLayerRendering(style.strokes)
				) {
					strokeLayersByNodeId[node.id] = resolvePaintLayers(
						defParts,
						node,
						style,
						"stroke",
						scene.assets,
						resolveMeshPatternDef,
					);
				}
				if (node.children) visit(node.children);
			}
		};
		for (const layer of scene.layers) visit(layer.nodes);
		return {
			defs: defParts.join("\n"),
			fillLayersByNodeId,
			strokeLayersByNodeId,
		};
	};
}

/**
 * Walks the (composed) scene and resolves every fill/stroke paint stack that
 * needs multi-layer rendering (see {@link paintStackNeedsLayerRendering}) into
 * render-ready SVG paint layers, using the same resolution
 * ({@link resolveNodeStyle}) the in-app SVG export and other scene-artifact
 * builders already use. A node whose stack does not need stacked rendering
 * (empty, or a single plain paint) is omitted from both maps, so its caller
 * falls back to the node's resolved legacy fill/stroke color exactly as before
 * this module existed. Bound to the real {@link meshPatternDef}; this is the
 * instance the FULL/CORE runtime-sampler entries (and `code.ts` through
 * them) use, and its behavior is unchanged by the lean/flat injection seam
 * above. `svg.ts`/`pdf.ts` do not call this module at all — they resolve
 * paint stacks through their own `resolveSvgPaintLayer`.
 */
export const buildScenePaintSvgArtifacts: (
	scene: SceneDocument,
) => ScenePaintSvgArtifacts =
	/* @__PURE__ */ createScenePaintSvgArtifactsBuilder(meshPatternDef);
