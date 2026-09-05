/**
 * Artboard composite plan V1 — the renderer-neutral partition that 経路A
 * (SVG double raster) needs, owned by the Scene entity so the editor canvas and
 * every export adapter read exactly one answer.
 *
 * The adopted composite order (see the design doc's "Composite ownership"
 * section) is:
 *
 *   1. Vecmo vector/text BACK run
 *   2. one linked/external 3D band
 *   3. Vecmo vector/text FRONT run
 *   4. artboard/frame-level finish, applied AFTER the 3D band composition
 *   5. editor-only chrome and selection overlays
 *
 * This module owns steps 1-3 only: it says WHICH top-level nodes belong to the
 * back run, which one carries the band, and which belong to the front run. It
 * is DOM-free, Babylon-free, and renderer-free on purpose — the editor SVG
 * stage, the browser raster export, and any later rendered-package compositor
 * must all partition identically or the surfaces cannot be compared.
 *
 * Partition rules (V1, deliberate and documented):
 *
 * - Paint order is authoring order: layers in array order, top-level nodes in
 *   array order. Later paints on top, so later == "in front".
 * - The band splits the order at the TOP-LEVEL position of the top-level
 *   ancestor that contains the first 3D placement. A 3D node nested inside a
 *   group therefore takes its whole top-level group with it, and that group is
 *   assigned to the BACK run: its non-3D content renders underneath the band.
 *   When that group also holds visible painted content that paints AFTER the
 *   placement, the authored intent is genuinely unreachable with one band, so
 *   the plan reports a typed z-order issue instead of pretending.
 * - The band may span a contiguous run of top-level entries that carry only 3D
 *   placements. Visible vector content BETWEEN two 3D entries is alternating
 *   interleave: typed unsupported, and the plan degrades to "everything back"
 *   (which is exactly the pre-S3c behaviour — the overlay on top of everything)
 *   so an unsupported document keeps rendering rather than losing content.
 * - Hidden 3D nodes are not placements, so they produce no band.
 * - A document with no 3D at all yields `band: null`, `front` empty, and a back
 *   run holding every top-level node. Callers MUST treat that as "render
 *   exactly as before"; it is the compatibility invariant this slice protects.
 */
import type { Runtime3dFidelityIssue } from "@/shared/runtime-3d/types";
import {
	externalSceneAssetForGeometry,
	hrefForExternalSceneAsset,
} from "./assets";
import { selectAllArtboards, selectArtboardIdForNode } from "./selectors";
import type { SceneDocument, VectorNode } from "./types";

/** One top-level entry in an artboard's paint order. */
export type ArtboardCompositeEntry = {
	readonly layerId: string;
	readonly nodeId: string;
};

export type ArtboardCompositeBand = {
	/** The first visible 3D placement node inside the band. */
	readonly placementNodeId: string;
	/** The top-level node whose position in paint order splits back from front. */
	readonly topLevelNodeId: string;
	readonly assetId: string;
	/** Every top-level entry the contiguous band spans, in paint order. */
	readonly entries: readonly ArtboardCompositeEntry[];
};

export type ArtboardCompositePlan = {
	readonly artboardId: string;
	/** Top-level entries painted BEFORE the band, in paint order. */
	readonly back: readonly ArtboardCompositeEntry[];
	readonly band: ArtboardCompositeBand | null;
	/** Top-level entries painted AFTER the band, in paint order. */
	readonly front: readonly ArtboardCompositeEntry[];
	readonly issues: readonly Runtime3dFidelityIssue[];
};

/** The whole document's partition: one plan per artboard plus merged node sets. */
export type SceneCompositePlan = {
	readonly artboards: readonly ArtboardCompositePlan[];
	/** Top-level node ids that must render in the back run (band entries included). */
	readonly backTopLevelNodeIds: ReadonlySet<string>;
	/** Top-level node ids that must render ABOVE the 3D band. */
	readonly frontTopLevelNodeIds: ReadonlySet<string>;
	/** True when at least one artboard forms a band AND has front content. */
	readonly hasFrontRun: boolean;
	/** True when at least one artboard forms a band. */
	readonly hasBand: boolean;
	readonly issues: readonly Runtime3dFidelityIssue[];
};

const Z_ORDER_UNSUPPORTED_CODE = "runtime-3d-svg-z-order-unsupported" as const;

/**
 * Mirrors `runtime-3d.ts`'s placement admission for the fields that decide
 * whether a node BECOMES a Babylon placement: a visible image node bound to a
 * `model-3d` glb/gltf external asset with a resolvable source. The runtime
 * compiler may additionally substitute a resolver-provided href, which can only
 * ever keep a source resolvable, never remove one — so partitioning without a
 * resolver yields the same band as partitioning with one.
 */
const placementAssetId = (
	document: SceneDocument,
	node: VectorNode,
): string | null => {
	if (!node.visible) return null;
	if (node.geometry.kind !== "image") return null;
	const asset = externalSceneAssetForGeometry(document, node.geometry);
	if (asset?.kind !== "model-3d") return null;
	if (asset.format !== "glb" && asset.format !== "gltf") return null;
	if (!asset.production && !hrefForExternalSceneAsset(asset)) return null;
	return asset.id;
};

type SubtreeScan = {
	readonly placementNodeIds: readonly string[];
	readonly placementAssetIds: readonly string[];
	/** Visible painted content that paints AFTER the first placement in this subtree. */
	readonly vectorAfterPlacement: boolean;
	readonly hasVectorContent: boolean;
};

const scanSubtree = (
	document: SceneDocument,
	node: VectorNode,
): SubtreeScan => {
	const placementNodeIds: string[] = [];
	const placementAssetIds: string[] = [];
	let vectorAfterPlacement = false;
	let hasVectorContent = false;
	const visit = (current: VectorNode): void => {
		if (!current.visible || current.style.opacity <= 0) return;
		const assetId = placementAssetId(document, current);
		if (assetId) {
			placementNodeIds.push(current.id);
			placementAssetIds.push(assetId);
			return;
		}
		// A container is judged by its children, not by itself. The Scene model has
		// no `group` geometry kind — a group is an ordinary node carrying
		// `children` (see `group-commands.ts`, which builds one as a degenerate
		// `line`) — so "has children" is the only container signal available
		// without re-deriving paint resolution here. A frame that paints its own
		// fill AND holds children therefore does not self-count; that can only
		// under-report interleave, never invent one, which is the safe direction:
		// the plan keeps composing rather than degrading a valid sandwich.
		const children = current.children ?? [];
		if (children.length === 0) {
			hasVectorContent = true;
			if (placementNodeIds.length > 0) vectorAfterPlacement = true;
			return;
		}
		for (const child of children) visit(child);
	};
	visit(node);
	return {
		placementNodeIds,
		placementAssetIds,
		vectorAfterPlacement,
		hasVectorContent,
	};
};

type ScannedEntry = ArtboardCompositeEntry & {
	readonly scan: SubtreeScan;
};

const emptyPlanFor = (artboardId: string): ArtboardCompositePlan => ({
	artboardId,
	back: [],
	band: null,
	front: [],
	issues: [],
});

/**
 * Builds the composite plan for one artboard from a sampled Scene. "Sampled"
 * matters: visibility and opacity are read as presented, so a node animated to
 * invisible at this frame does not hold a band open.
 */
export function buildArtboardCompositePlan({
	scene,
	artboardId,
}: {
	readonly scene: SceneDocument;
	readonly artboardId: string;
}): ArtboardCompositePlan {
	const entries: ScannedEntry[] = [];
	for (const layer of scene.layers) {
		if (!layer.visible) continue;
		for (const node of layer.nodes) {
			if (selectArtboardIdForNode(scene, node.id) !== artboardId) continue;
			entries.push({
				layerId: layer.id,
				nodeId: node.id,
				scan: scanSubtree(scene, node),
			});
		}
	}
	if (entries.length === 0) return emptyPlanFor(artboardId);
	const toEntry = (entry: ScannedEntry): ArtboardCompositeEntry => ({
		layerId: entry.layerId,
		nodeId: entry.nodeId,
	});
	const allBack = (
		issues: readonly Runtime3dFidelityIssue[],
	): ArtboardCompositePlan => ({
		artboardId,
		back: entries.map(toEntry),
		band: null,
		front: [],
		issues,
	});
	const firstBandIndex = entries.findIndex(
		(entry) => entry.scan.placementNodeIds.length > 0,
	);
	if (firstBandIndex < 0) return allBack([]);
	let lastBandIndex = firstBandIndex;
	for (let index = entries.length - 1; index > firstBandIndex; index -= 1) {
		if ((entries[index]?.scan.placementNodeIds.length ?? 0) > 0) {
			lastBandIndex = index;
			break;
		}
	}
	const interleaved = entries
		.slice(firstBandIndex, lastBandIndex + 1)
		.some(
			(entry) =>
				entry.scan.placementNodeIds.length === 0 && entry.scan.hasVectorContent,
		);
	if (interleaved) {
		// More than one band: the authored order alternates vector / 3D / vector /
		// 3D, which one contiguous band cannot express. Degrade to the pre-S3c
		// composite (everything in the SVG run, overlay on top) and say so.
		return allBack([
			{
				code: Z_ORDER_UNSUPPORTED_CODE,
				severity: "warning",
				message:
					"This artboard alternates vector content and 3D placements more than once; V1 composes exactly one contiguous 3D band, so the 3D content stays in front of every vector run.",
				artboardId,
			},
		]);
	}
	const bandEntries = entries.slice(firstBandIndex, lastBandIndex + 1);
	const issues: Runtime3dFidelityIssue[] = [];
	for (const entry of bandEntries) {
		if (!entry.scan.vectorAfterPlacement) continue;
		issues.push({
			code: Z_ORDER_UNSUPPORTED_CODE,
			severity: "warning",
			message:
				"A 3D placement shares its top-level group with vector content authored above it; the whole group composes behind the 3D band, so that content renders under the 3D pixels.",
			artboardId,
			nodeId: entry.nodeId,
		});
	}
	const headEntry = bandEntries[0];
	const placementNodeId = headEntry?.scan.placementNodeIds[0];
	const assetId = headEntry?.scan.placementAssetIds[0];
	if (!headEntry || !placementNodeId || !assetId) return allBack(issues);
	return {
		artboardId,
		back: entries.slice(0, lastBandIndex + 1).map(toEntry),
		band: {
			placementNodeId,
			topLevelNodeId: headEntry.nodeId,
			assetId,
			entries: bandEntries.map(toEntry),
		},
		front: entries.slice(lastBandIndex + 1).map(toEntry),
		issues,
	};
}

/** Whole-document partition. Artboards own disjoint node sets, so the merged sets are unambiguous. */
export function buildSceneCompositePlan(
	scene: SceneDocument,
): SceneCompositePlan {
	const artboards = selectAllArtboards(scene).map((artboard) =>
		buildArtboardCompositePlan({ scene, artboardId: artboard.id }),
	);
	const backTopLevelNodeIds = new Set<string>();
	const frontTopLevelNodeIds = new Set<string>();
	const issues: Runtime3dFidelityIssue[] = [];
	for (const plan of artboards) {
		for (const entry of plan.back) backTopLevelNodeIds.add(entry.nodeId);
		for (const entry of plan.front) frontTopLevelNodeIds.add(entry.nodeId);
		issues.push(...plan.issues);
	}
	return {
		artboards,
		backTopLevelNodeIds,
		frontTopLevelNodeIds,
		hasFrontRun: artboards.some(
			(plan) => plan.band !== null && plan.front.length > 0,
		),
		hasBand: artboards.some((plan) => plan.band !== null),
		issues,
	};
}

export type CompositeRun = "back" | "front";

/**
 * Returns the same Scene with the OTHER run's top-level nodes forced invisible,
 * so one SVG renderer call paints exactly one run. Hiding at top level is
 * sufficient and deliberate: the partition is defined at top level, and hiding
 * an ancestor removes its whole subtree from every renderer that honours
 * `visible` (which the SVG exporter and the canvas both do).
 *
 * Returns the input unchanged when nothing needs hiding, so a document without
 * a band never allocates a second Scene and never diverges from today's render.
 */
export function sceneForCompositeRun(
	scene: SceneDocument,
	plan: SceneCompositePlan,
	run: CompositeRun,
): SceneDocument {
	if (!plan.hasFrontRun) return scene;
	const hidden =
		run === "back" ? plan.frontTopLevelNodeIds : plan.backTopLevelNodeIds;
	if (hidden.size === 0) return scene;
	let changed = false;
	const layers = scene.layers.map((layer) => {
		let layerChanged = false;
		const nodes = layer.nodes.map((node) => {
			if (!hidden.has(node.id)) return node;
			const suppressed = withoutMaskAuthoring(node);
			if (suppressed === node && !node.visible) return node;
			layerChanged = true;
			return { ...suppressed, visible: false };
		});
		if (!layerChanged) return layer;
		changed = true;
		return { ...layer, nodes };
	});
	return changed ? { ...scene, layers } : scene;
}

/**
 * Drops the mask-authoring buckets from a subtree that this run is not drawing.
 *
 * Hiding a run is a compositing decision, not an authoring change — but the SVG
 * renderer resolves the mask plan over whatever scene it is handed, and a
 * relation whose mask source has just been hidden classifies as unrepresentable.
 * Left in place, the back pass would report `mask-relation-fallback` for a mask
 * the FRONT pass renders perfectly, i.e. the double raster would invent a
 * fidelity issue out of its own bookkeeping. The relations travel with the run
 * that actually paints them.
 */
const withoutMaskAuthoring = (node: VectorNode): VectorNode => {
	const children = node.children?.map(withoutMaskAuthoring);
	const appearance = node.data?.appearance;
	const strippedAppearance =
		appearance && typeof appearance === "object" && !Array.isArray(appearance)
			? Object.fromEntries(
					Object.entries(appearance).filter(
						([key]) => key !== "maskRelations" && key !== "clipMaskRelations",
					),
				)
			: appearance;
	const appearanceChanged = strippedAppearance !== appearance;
	const childrenChanged = Boolean(
		children?.some((child, index) => child !== node.children?.[index]),
	);
	if (!appearanceChanged && !childrenChanged) return node;
	return {
		...node,
		...(appearanceChanged
			? { data: { ...node.data, appearance: strippedAppearance } }
			: {}),
		...(childrenChanged && children ? { children } : {}),
	};
};

/**
 * Every node id inside a front-run subtree (top-level entries plus descendants).
 *
 * Picking needs this, not just the top-level set: with 経路A the front run is
 * genuinely painted ABOVE the 3D band, so a pointer landing on front-run content
 * must resolve to that content even when the Babylon picker also reports a mesh
 * hit at the same point. Without it the 3D pick keeps winning and an author
 * cannot select the text they can plainly see on top of the model.
 */
export function frontRunNodeIds(
	scene: SceneDocument,
	plan: SceneCompositePlan,
): ReadonlySet<string> {
	const ids = new Set<string>();
	if (plan.frontTopLevelNodeIds.size === 0) return ids;
	const collect = (node: VectorNode): void => {
		ids.add(node.id);
		for (const child of node.children ?? []) collect(child);
	};
	for (const layer of scene.layers) {
		for (const node of layer.nodes) {
			if (plan.frontTopLevelNodeIds.has(node.id)) collect(node);
		}
	}
	return ids;
}

/** Minimal, report-shaped summary of a composite plan for export fidelity records. */
export type CompositePlanReport = {
	readonly band: boolean;
	readonly backCount: number;
	readonly frontCount: number;
	readonly artboardCount: number;
};

export const compositePlanReport = (
	plan: SceneCompositePlan,
): CompositePlanReport => ({
	band: plan.hasBand,
	backCount: plan.artboards.reduce(
		(total, item) => total + item.back.length,
		0,
	),
	frontCount: plan.artboards.reduce(
		(total, item) => total + item.front.length,
		0,
	),
	artboardCount: plan.artboards.length,
});
