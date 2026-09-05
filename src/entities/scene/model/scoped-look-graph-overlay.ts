import { castDraft, type Draft } from "immer";
import type { SceneCommand } from "./command";
import {
	type EffectFilterSpec,
	nodeVisualMargin,
	svgIdSegment,
} from "./effect-filter";
import {
	type LookGraph,
	type LookGraphDraft,
	normalizeLookGraph,
} from "./look-graph";
import {
	compileLookGraph,
	type LookGraphFidelity,
	lookGraphPlanToEffectFilter,
} from "./look-graph-compile";
import { resolveNodeRecipe } from "./recipe-resolve";
import {
	getNodeParentPaintBounds,
	getNodeParentPaintBoundsForTransform,
	type Matrix2D,
	matrixFromTransform,
	unionBounds,
} from "./rendering";
import { resolveEffects } from "./style-resolve";
import type {
	Artboard,
	Bounds,
	LookGraphScopedEffectLook,
	ScopedEffectLook,
	VectorNode,
} from "./types";

export type ScopedLookGraphOverlay = LookGraphScopedEffectLook;

/** Narrows a scoped look to the graph-overlay variant used for node-set replacement. */
export const isScopedLookGraphOverlay = (
	look: ScopedEffectLook,
): look is ScopedLookGraphOverlay => look.kind === "look-graph-overlay";

/** Returns authored graph overlays in storage order. Later conflict policy is renderer-owned. */
export const scopedLookGraphOverlays = (
	artboard: Artboard,
): readonly ScopedLookGraphOverlay[] =>
	artboard.effectIntent?.scopedLooks?.filter(isScopedLookGraphOverlay) ?? [];

const replaceScopedLookGraphOverlay = (
	scopedLooks: readonly ScopedEffectLook[] | undefined,
	scopedLookId: string,
	lookGraph: LookGraph,
): readonly ScopedEffectLook[] | null => {
	if (!scopedLooks) return null;
	let changed = false;
	const next = scopedLooks.map((look) => {
		if (!isScopedLookGraphOverlay(look) || look.id !== scopedLookId) {
			return look;
		}
		changed = true;
		return { ...look, lookGraph };
	});
	return changed ? next : null;
};

const updateScopedLookGraphOverlayArtboard = (
	artboard: Draft<Artboard>,
	scopedLookId: string,
	lookGraph: LookGraph,
): void => {
	const nextScopedLooks = replaceScopedLookGraphOverlay(
		artboard.effectIntent?.scopedLooks,
		scopedLookId,
		lookGraph,
	);
	if (!nextScopedLooks) return;
	artboard.effectIntent = castDraft({
		...artboard.effectIntent,
		scopedLooks: nextScopedLooks,
	});
};

/**
 * Replaces the Look graph inside one scoped graph overlay without projecting it
 * into frame-level compatibility slots. Scoped overlays are explicit replacement
 * effects over target node runs, so their graph edits must not become broad
 * scene/artboard looks.
 */
export const createSetScopedLookGraphOverlayCommand = (
	artboardId: string,
	scopedLookId: string,
	graph: LookGraph | LookGraphDraft,
	options: { readonly label?: string; readonly coalesceKey?: string } = {},
): SceneCommand => {
	const normalized = normalizeLookGraph(graph);
	return {
		type: "scene/set-scoped-look-graph-overlay",
		label: options.label ?? "Edit scoped look graph",
		coalesceKey: options.coalesceKey,
		run: (draft) => {
			if (!normalized) return;
			if (draft.artboard.id === artboardId) {
				updateScopedLookGraphOverlayArtboard(
					draft.artboard,
					scopedLookId,
					normalized,
				);
			}
			for (const artboard of draft.artboards ?? []) {
				if (artboard.id !== artboardId) continue;
				updateScopedLookGraphOverlayArtboard(
					artboard,
					scopedLookId,
					normalized,
				);
			}
		},
	};
};

/**
 * Builds the first-writer target index for scoped graph overlays. One target node
 * can only be replaced by one graph overlay in a render pass; keeping storage
 * order deterministic avoids silent double filtering.
 */
export const scopedLookGraphOverlayTargetMap = (
	overlays: readonly ScopedLookGraphOverlay[],
): ReadonlyMap<string, ScopedLookGraphOverlay> => {
	const targetMap = new Map<string, ScopedLookGraphOverlay>();
	for (const overlay of overlays) {
		for (const nodeId of overlay.targetNodeIds) {
			if (!targetMap.has(nodeId)) targetMap.set(nodeId, overlay);
		}
	}
	return targetMap;
};

export const scopedLookGraphOverlayFilterId = ({
	artboardId,
	overlay,
	runIndex,
}: {
	readonly artboardId: string;
	readonly overlay: ScopedLookGraphOverlay;
	readonly runIndex: number;
}): string =>
	`vecmo-scoped-look-graph-${svgIdSegment(artboardId)}-${svgIdSegment(overlay.id)}-${runIndex}`;

export type ScopedLookGraphOverlayFilter = {
	readonly spec: EffectFilterSpec;
	readonly fidelity: readonly LookGraphFidelity[];
};

const scaleForMatrix = (matrix: Matrix2D): number =>
	Math.max(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d), 1);

const paddedBounds = (bounds: Bounds, padding: number): Bounds => ({
	x: bounds.x - padding,
	y: bounds.y - padding,
	width: bounds.width + padding * 2,
	height: bounds.height + padding * 2,
});

const nodePaintMargin = (node: VectorNode): number =>
	nodeVisualMargin(
		resolveEffects(node.style.effects),
		Math.max(0, node.style.strokeWidth),
		resolveNodeRecipe(node),
	);

export const scopedLookGraphNodeBounds = (node: VectorNode): Bounds => {
	const matrix = matrixFromTransform(node.transform);
	return paddedBounds(
		getNodeParentPaintBounds(node),
		nodePaintMargin(node) * scaleForMatrix(matrix),
	);
};

export const scopedLookGraphNodeBoundsForTransform = (
	node: VectorNode,
	transform: VectorNode["transform"],
): Bounds => {
	const matrix = matrixFromTransform(transform);
	return paddedBounds(
		getNodeParentPaintBoundsForTransform(node, transform),
		nodePaintMargin(node) * scaleForMatrix(matrix),
	);
};

export const scopedLookGraphRunBounds = (
	nodes: readonly VectorNode[],
): Bounds => unionBounds(nodes.map((node) => scopedLookGraphNodeBounds(node)));

export const scopedLookGraphRunBoundsForTransform = (
	nodes: readonly {
		readonly node: VectorNode;
		readonly transform: VectorNode["transform"];
	}[],
): Bounds =>
	unionBounds(
		nodes.map(({ node, transform }) =>
			scopedLookGraphNodeBoundsForTransform(node, transform),
		),
	);

/**
 * Compiles one scoped graph overlay run. The surrounding renderer applies the
 * returned filter to the target node run, making that run the SVG
 * `SourceGraphic`/`SourceAlpha` instead of the whole artboard.
 */
export const compileScopedLookGraphOverlayFilter = ({
	artboardId,
	overlay,
	bounds,
	id,
	rasterSafe = false,
	deferGpuRasterEffects = false,
	frameTimeSeconds,
}: {
	readonly artboardId: string;
	readonly overlay: ScopedLookGraphOverlay;
	readonly bounds: Bounds;
	readonly id: string;
	readonly rasterSafe?: boolean;
	readonly deferGpuRasterEffects?: boolean;
	readonly frameTimeSeconds?: number;
}): ScopedLookGraphOverlayFilter | null => {
	const plan = compileLookGraph(overlay.lookGraph, {
		owner: { scope: "scoped-overlay", artboardId, scopedLookId: overlay.id },
		bounds,
		rasterSafe,
		deferGpuRasterEffects,
		...(frameTimeSeconds !== undefined ? { frameTimeSeconds } : {}),
	});
	const spec = lookGraphPlanToEffectFilter(plan, { id, bounds });
	return spec ? { spec, fidelity: plan.fidelity } : null;
};
