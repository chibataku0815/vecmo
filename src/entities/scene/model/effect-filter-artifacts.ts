/**
 * Single source of truth for building per-node SVG `<filter>` defs for style
 * effects (layer-blur, drop/inner shadow) and node-look/recipe textures (grain,
 * color grade, …), shared by the in-app SVG export
 * ({@link ../../../features/export/model/svg.ts} `renderNode`, which calls
 * {@link ./effect-filter.ts}'s `buildEffectFilter` directly) and the standalone
 * code/runtime export (bundled via
 * {@link ../../../features/export/model/runtime-sampler-entry.ts}). Both walk
 * the SAME composed scene through the SAME `buildEffectFilter` chain, so an
 * exported filter can never drift from the editor canvas or the in-app export.
 *
 * This module exists because the runtime player (`code.ts`'s
 * `RUNTIME_PLAYER_SOURCE`) previously had no filter pipeline at all — a node
 * effect or attached vec-core recipe (e.g. grain) silently vanished from
 * exported playback even though the in-app SVG export already rendered it.
 *
 * Pure and DOM-free so it bundles into the standalone runtime unchanged (the
 * architecture check scans this directory for browser/DOM globals).
 */

import { effectFilterBoundsForNode } from "./appearance-targets";
import { compileEffectFieldRoutesForNode } from "./effect-field-routing";
import { buildEffectFilter, serializeEffectFilter } from "./effect-filter";
import { resolveFrameEffectIntent, resolveNodeRecipe } from "./recipe-resolve";
import {
	buildSourceOpticsPresentation,
	type SourceOpticsIssue,
} from "./source-optics";
import { resolveNodeStyle } from "./style-resolve";
import type { SceneDocument, VectorNode } from "./types";

/**
 * The effect-filter `<filter>` defs + which filter id (if any) each node's
 * rendered shape/subtree-carrier should reference. Ids are raw (`effect-<seg>`
 * — see `nodeFilterId` in {@link ./effect-filter.ts}), NOT wrapped in
 * `url(#...)`, mirroring {@link ./mask-svg.ts}'s
 * `SceneStrokeBlurSvgArtifacts.filterIdByNodeId` so callers build the `url()`
 * reference themselves at the point of use.
 */
export type SceneEffectFilterArtifacts = {
	/** Concatenated `<filter>` defs, "\n"-joined. */
	readonly defs: string;
	/** Filter id ({@link nodeFilterId}) per node id with a renderable effect filter. */
	readonly filterIdByNodeId: Readonly<Record<string, string>>;
	/** Typed source/target identity or field issues for runtime fidelity reports. */
	readonly sourceOpticsIssues: readonly SourceOpticsIssue[];
};

/**
 * Walks the (composed) scene and serializes an effect `<filter>` def for every
 * visible node whose resolved style effects and/or attached vec-core recipe
 * produce at least one renderable filter primitive, using the SAME resolution
 * (`resolveNodeStyle`, `resolveNodeRecipe`, `effectFilterBoundsForNode`) and
 * filter-build function (`buildEffectFilter`) the in-app SVG export uses — so
 * the filter region/primitives are byte-identical wherever both emit.
 *
 * A node hidden by `visible: false` is skipped along with its whole subtree
 * (matching `renderNode`'s early return in both `svg.ts` and the runtime
 * player), since neither renderer paints it or its descendants. A spec whose
 * only effects are deferred (currently background-blur) is intentionally
 * omitted from the result — background-blur has no SVG filter primitive to
 * reference here, matching the in-app SVG export's dropped-effect handling.
 */
export function buildSceneEffectFilterArtifacts(
	scene: SceneDocument,
	frameTimeSeconds = 0,
): SceneEffectFilterArtifacts {
	const defParts: string[] = [];
	const filterIdByNodeId: Record<string, string> = {};
	const influenceRecipe = resolveFrameEffectIntent(
		scene,
		scene.artboard.id,
	).influenceRecipe;
	const sourceOpticsPresentation = buildSourceOpticsPresentation(
		scene,
		scene.artboard.id,
		"runtime-svg",
	);
	const visit = (nodes: readonly VectorNode[]): void => {
		for (const node of nodes) {
			if (!node.visible) continue;
			const style = resolveNodeStyle(node.style);
			const recipe = resolveNodeRecipe(node);
			const fieldRouting = compileEffectFieldRoutesForNode(
				influenceRecipe,
				node.id,
				"runtime-svg",
			);
			const spec = buildEffectFilter(
				node.id,
				style.effects,
				effectFilterBoundsForNode(node),
				style.strokeWidth,
				recipe,
				false,
				frameTimeSeconds,
				fieldRouting.routes,
				sourceOpticsPresentation.nodePlans[node.id],
			);
			if (spec && spec.primitives.length > 0) {
				defParts.push(serializeEffectFilter(spec));
				filterIdByNodeId[node.id] = spec.id;
			}
			if (node.children) visit(node.children);
		}
	};
	for (const layer of scene.layers) visit(layer.nodes);
	return {
		defs: defParts.join("\n"),
		filterIdByNodeId,
		sourceOpticsIssues: sourceOpticsPresentation.issues,
	};
}
