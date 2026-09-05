import { castDraft, type Draft } from "immer";
import type { SceneCommand } from "@/entities/scene/model/command";
import { createDeleteNodesCommand } from "@/entities/scene/model/node-commands";
import { objectNoiseGradientScopedLookId } from "@/entities/scene/model/noise-gradient-look";
import { objectPathBlurScopedLookId } from "@/entities/scene/model/path-blur-look";
import {
	allNodes,
	findNode,
	findRenderableNodeEntry,
} from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import {
	type BezierShape,
	type EffectIntent,
	IDENTITY_TRANSFORM,
	type NodeStyle,
	type Paint,
	type PathGeometry,
	type SceneDocument,
	type SceneLayer,
	type ScopedEffectLook,
	type Transform,
	type VectorNode,
} from "@/entities/scene/model/types";
import { type Arrangement, withBridgeFaces } from "./arrangement";
import { SHAPE_BUILDER_OUTPUT_DETAIL_DEFAULT } from "./output-detail";
import {
	buildShapeBuilderFaceGeometries,
	compoundShapeBuilderPathGeometries,
} from "./output-geometry";

/**
 * Commits a Shape Builder operation as ONE scene command (= one Cmd+Z), using an
 * affected-source model tuned for clean construction:
 *
 * - Decompose the selection into faces. Let `S` = the swept faces.
 * - Click EXTRACT and ERASE only replace sources that cover a swept face, so
 *   unrelated selected art stays untouched, and reconstruct those affected
 *   sources as `union(its faces − S)` — precise, divide-like editing that keeps
 *   intentional remainders.
 * - Drag/marquee MERGE is a construction operation: every source that
 *   participates in the sweep (covers at least one face in `S`, after
 *   gap-bridge expansion) is consumed WHOLLY, not just the faces the trace
 *   touched. The generated node is
 *   `union(whole participating shapes ∪ swept gap faces ∪ bridge necks)` —
 *   see `expandShapeBuilderMergeFaces` — emitted as exactly ONE compound node.
 *   Merge never leaves remainders or cleanup candidates for the participating
 *   sources; the generated node is the sole selection after commit. Selected
 *   art that never contributed to the merge stays untouched.
 *
 * Result nodes replace the affected source nodes at the first affected source's
 * layer slot. Atomic undo comes from the single `apply` (not `compoundId`).
 */

const FALLBACK_STYLE: NodeStyle = {
	fill: "#cccccc",
	stroke: "none",
	strokeWidth: 0,
	opacity: 1,
};

const solidPaint = (color: string): Paint => ({ kind: "solid", color });

const cloneIdentity = (): Transform => ({
	position: { ...IDENTITY_TRANSFORM.position },
	rotation: IDENTITY_TRANSFORM.rotation,
	scale: { ...IDENTITY_TRANSFORM.scale },
	anchor: { ...IDENTITY_TRANSFORM.anchor },
});

const facesCoveredBy = (arrangement: Arrangement, sourceId: string): number[] =>
	arrangement.faces
		.filter((f) => f.coveredBy.includes(sourceId))
		.map((f) => f.index);

const sourceIdsTouchedByFaces = (
	arrangement: Arrangement,
	faceIndices: ReadonlySet<number>,
): Set<string> => {
	const ids = new Set<string>();
	for (const face of arrangement.faces) {
		if (!faceIndices.has(face.index)) continue;
		for (const id of face.coveredBy) ids.add(id);
	}
	return ids;
};

export type ShapeBuilderMergeExpansion = {
	readonly participatingSourceIds: ReadonlySet<string>;
	readonly outputFaceIndices: readonly number[];
};

/**
 * Expands a swept face set into the drag/marquee MERGE output contract: every
 * source that participates in the sweep is consumed WHOLLY, not just the faces
 * the trace happened to touch. This is what prevents "leftover" source faces
 * (e.g. an untouched lobe of an L-shaped source) from surviving a merge.
 *
 * Steps:
 * 1. `swept` = the input faces plus any gap-bridge necks they already join.
 * 2. `participating` = every source that covers at least one swept face.
 * 3. `expanded` = `swept` plus every face (anywhere in the arrangement) covered
 *    by ANY participating source — i.e. the union of the WHOLE participating
 *    shapes, not just their swept portions.
 * 4. Output keeps only the bridge necks pulled in by the ORIGINAL swept set.
 *    Re-running bridge expansion after whole-source expansion would add every
 *    bridge between the now-large participating sources, including necks the
 *    user never traced near (the failure mode that appears when adding the 5th
 *    circle to an already-large compound source).
 *
 * CORRECTNESS TRAP: `participating` MUST be computed only from the initial
 * `swept` set, never recomputed from `expanded`. `expanded` also contains faces
 * of NON-participating neighbours (e.g. participating source B overlaps
 * non-participating source C — the B∩C face enters `expanded` because B covers
 * it). Recomputing participation from `expanded` would pull C's coveredBy ids
 * in too and wrongly consume C, even though the sweep never touched it.
 */
export function expandShapeBuilderMergeFaces(
	arrangement: Arrangement,
	sweptFaceIndices: readonly number[],
): ShapeBuilderMergeExpansion {
	const swept = new Set(withBridgeFaces(arrangement, sweptFaceIndices));
	const participating = sourceIdsTouchedByFaces(arrangement, swept);
	const expanded = new Set(swept);
	for (const face of arrangement.faces) {
		if (face.coveredBy.some((id) => participating.has(id)))
			expanded.add(face.index);
	}
	return {
		participatingSourceIds: participating,
		outputFaceIndices: [...expanded],
	};
}

const editableSource = (
	document: SceneDocument,
	sourceId: string,
): VectorNode | null => {
	const entry = findRenderableNodeEntry(document, sourceId);
	return entry && !entry.locked && entry.parentIds.length === 0
		? entry.node
		: null;
};

const prunableEmptyContainer = (node: Draft<VectorNode>): boolean => {
	const children = node.children;
	return (
		children !== undefined &&
		children.length === 0 &&
		(node.geometry.kind === "line" ||
			(node.style.fill === "none" &&
				node.style.stroke === "none" &&
				node.style.strokeWidth === 0))
	);
};

const collectDraftSubtreeNodeIds = (
	node: Draft<VectorNode>,
	output: Set<string>,
): void => {
	output.add(node.id);
	for (const child of node.children ?? [])
		collectDraftSubtreeNodeIds(child, output);
};

const scopedLookIdForShapeBuilderTargets = (
	look: ScopedEffectLook,
	targetNodeIds: readonly string[],
): string => {
	const soleTargetId = targetNodeIds.length === 1 ? targetNodeIds[0] : null;
	if (!soleTargetId || look.kind !== "look-graph-overlay") return look.id;
	if (look.source === "object-path-blur")
		return objectPathBlurScopedLookId(soleTargetId);
	if (look.source === "object-noise-gradient")
		return objectNoiseGradientScopedLookId(soleTargetId);
	return look.id;
};

const remapShapeBuilderScopedLookTargets = (
	scopedLooks: readonly ScopedEffectLook[] | undefined,
	removedNodeIds: ReadonlySet<string>,
	replacementNodeIdsBySourceId: ReadonlyMap<string, readonly string[]>,
): readonly ScopedEffectLook[] | null => {
	if (
		!scopedLooks?.some((look) =>
			look.targetNodeIds.some(
				(nodeId) =>
					removedNodeIds.has(nodeId) ||
					replacementNodeIdsBySourceId.has(nodeId),
			),
		)
	) {
		return null;
	}
	return scopedLooks.flatMap((look): ScopedEffectLook[] => {
		const targetNodeIds = look.targetNodeIds.flatMap((nodeId) => {
			const replacements = replacementNodeIdsBySourceId.get(nodeId);
			if (replacements) return [...replacements];
			return removedNodeIds.has(nodeId) ? [] : [nodeId];
		});
		if (targetNodeIds.length === 0) return [];
		if (
			targetNodeIds.length === look.targetNodeIds.length &&
			targetNodeIds.every(
				(nodeId, index) => nodeId === look.targetNodeIds[index],
			)
		) {
			return [look];
		}
		return [
			{
				...look,
				id: scopedLookIdForShapeBuilderTargets(look, targetNodeIds),
				targetNodeIds,
			},
		];
	});
};

/**
 * Keeps object-scoped look targets coherent for Shape Builder's replace-in-place
 * command. Rebuilt source fragments inherit their source's scoped-look targets;
 * truly consumed source ids are dropped. Shape Builder cannot call
 * `createDeleteNodesCommand` for its main merge/extract/erase path because it
 * removes sources and inserts generated output atomically in one command.
 */
const remapDraftScopedLookTargetsForShapeBuilder = (
	draft: Draft<SceneDocument>,
	removedNodeIds: ReadonlySet<string>,
	replacementNodeIdsBySourceId: ReadonlyMap<string, readonly string[]>,
): void => {
	if (removedNodeIds.size === 0) return;
	const targets: Draft<{ effectIntent?: EffectIntent }>[] = [
		draft,
		draft.artboard,
		...(draft.artboards ?? []),
	];
	for (const target of targets) {
		const remappedScopedLooks = remapShapeBuilderScopedLookTargets(
			target.effectIntent?.scopedLooks,
			removedNodeIds,
			replacementNodeIdsBySourceId,
		);
		if (remappedScopedLooks === null) continue;
		const { scopedLooks: _scopedLooks, ...withoutScopedLooks } =
			target.effectIntent ?? {};
		const nextIntent: EffectIntent = {
			...withoutScopedLooks,
			...(remappedScopedLooks.length > 0
				? { scopedLooks: remappedScopedLooks }
				: {}),
		};
		if (Object.keys(nextIntent).length > 0) {
			target.effectIntent = castDraft(nextIntent);
			continue;
		}
		delete target.effectIntent;
	}
};

type DraftRemoval = {
	readonly removed: boolean;
	readonly topLevelIndex: number | null;
};

const removeDraftNode = (
	nodes: Draft<VectorNode[]>,
	nodeId: string,
	removedNodeIds: Set<string>,
): DraftRemoval => {
	const directIndex = nodes.findIndex((node) => node.id === nodeId);
	if (directIndex >= 0) {
		collectDraftSubtreeNodeIds(nodes[directIndex], removedNodeIds);
		nodes.splice(directIndex, 1);
		return { removed: true, topLevelIndex: directIndex };
	}
	for (let index = 0; index < nodes.length; index++) {
		const node = nodes[index];
		if (!node?.children) continue;
		const childRemoval = removeDraftNode(node.children, nodeId, removedNodeIds);
		if (!childRemoval.removed) continue;
		if (prunableEmptyContainer(node)) {
			removedNodeIds.add(node.id);
			nodes.splice(index, 1);
			return { removed: true, topLevelIndex: index };
		}
		return { removed: true, topLevelIndex: null };
	}
	return { removed: false, topLevelIndex: null };
};

type DraftTopLevelEditableSource = {
	readonly layer: Draft<SceneLayer>;
	readonly index: number;
	readonly node: Draft<VectorNode>;
};

const findDraftTopLevelEditableSource = (
	draft: Draft<SceneDocument>,
	nodeId: string,
): DraftTopLevelEditableSource | null => {
	for (const layer of draft.layers) {
		if (!layer.visible || layer.locked) continue;
		const index = layer.nodes.findIndex((node) => node.id === nodeId);
		if (index < 0) continue;
		const node = layer.nodes[index];
		if (!node?.visible || node.locked || node.children?.length) {
			return null;
		}
		return { layer, index, node };
	}
	return null;
};

export type ShapeBuilderMode = "merge" | "erase";

export type ShapeBuilderOperationIntent = "extract" | "merge" | "erase";

export type ShapeBuilderRemainderPolicy =
	| "preserve-affected"
	| "discard-affected";

export type ShapeBuilderSourceDisposition =
	| {
			readonly sourceId: string;
			readonly kind: "untouched";
	  }
	| {
			readonly sourceId: string;
			readonly kind: "rebuilt";
			readonly faceIndices: readonly number[];
			readonly resultNodeIds: readonly string[];
	  }
	| {
			readonly sourceId: string;
			readonly kind: "consumed";
	  };

export type ShapeBuilderOperationMetrics = {
	readonly generatedNodeCount: number;
	readonly remainderNodeCount: number;
	readonly resultNodeCount: number;
	readonly generatedContourCount: number;
	readonly remainderContourCount: number;
	readonly generatedAnchorCount: number;
	readonly remainderAnchorCount: number;
	readonly consumedSourceCount: number;
	readonly rebuiltSourceCount: number;
	readonly untouchedSourceCount: number;
};

export type ShapeBuilderOperationPlan = {
	readonly operationId: string;
	readonly intent: ShapeBuilderOperationIntent;
	readonly sweptFaceIndices: readonly number[];
	/**
	 * Face set the generated/committed geometry is actually built from. For
	 * extract/erase this equals `[...swept]` (the bridge-included swept set, same
	 * as `sweptFaceIndices`). For merge it is the expanded set from
	 * `expandShapeBuilderMergeFaces`: every face of every participating source,
	 * not just the faces the trace swept.
	 */
	readonly outputFaceIndices: readonly number[];
	readonly affectedSourceIds: readonly string[];
	readonly sourceDispositions: readonly ShapeBuilderSourceDisposition[];
	readonly committedNodeIds: readonly string[];
	readonly generatedNodeIds: readonly string[];
	readonly remainderNodeIds: readonly string[];
	readonly cleanupCandidateNodeIds: readonly string[];
	readonly selectionNodeIds: readonly string[];
	readonly metrics: ShapeBuilderOperationMetrics;
	readonly command: SceneCommand;
};

export type ShapeBuilderCommitResult = {
	/** True once a scene command was applied, even when erase leaves no replacements. */
	readonly didCommit: boolean;
	/** Stable id for the committed Shape Builder operation, used by ephemeral cleanup state. */
	readonly operationId: string | null;
	/** User-facing operation intent; distinguishes click Extract from drag Merge. */
	readonly intent: ShapeBuilderOperationIntent | null;
	/** Per-source fate for preview, layer outcome, cleanup, and later diagnostics. */
	readonly sourceDispositions: readonly ShapeBuilderSourceDisposition[];
	/** Counts that make output complexity observable instead of implied by UI labels. */
	readonly metrics: ShapeBuilderOperationMetrics | null;
	/** Nodes created by the command, excluding untouched sources left in place. */
	readonly committedNodeIds: readonly string[];
	/** Merge/extract regions generated from the swept faces. Empty for erase. */
	readonly generatedNodeIds: readonly string[];
	/** Reconstructed affected-source fragments kept around the generated result. */
	readonly remainderNodeIds: readonly string[];
	/** Remainders that are safe to offer as manual construction cleanup targets. */
	readonly cleanupCandidateNodeIds: readonly string[];
	/** Focus target for the canvas/layers selection after the command commits. */
	readonly selectionNodeIds: readonly string[];
	/** Face set the committed geometry was built from — see `ShapeBuilderOperationPlan.outputFaceIndices`. */
	readonly outputFaceIndices: readonly number[];
};

const EMPTY_COMMIT_RESULT: ShapeBuilderCommitResult = {
	didCommit: false,
	operationId: null,
	intent: null,
	sourceDispositions: [],
	metrics: null,
	committedNodeIds: [],
	generatedNodeIds: [],
	remainderNodeIds: [],
	cleanupCandidateNodeIds: [],
	selectionNodeIds: [],
	outputFaceIndices: [],
};

/**
 * Style contract for Shape Builder's generated swept-region nodes. Leftover
 * reconstructed source pieces intentionally keep their original source styles.
 */
export type ShapeBuilderGeneratedStyle =
	| { readonly kind: "inherit-artwork" }
	| {
			readonly kind: "solid-fill";
			readonly fill: string;
			readonly strokePolicy: "none";
	  };

const generatedStyle = (
	base: NodeStyle,
	override: ShapeBuilderGeneratedStyle | undefined,
): NodeStyle => {
	if (!override || override.kind === "inherit-artwork") return base;
	return {
		...base,
		fill: override.fill,
		fills: [solidPaint(override.fill)],
		stroke: "none",
		strokes: [],
		strokeWidth: 0,
	};
};

let operationSeq = 0;

const nextOperationId = (): string => `shape-builder:${++operationSeq}`;

const contourCount = (geometry: PathGeometry): number =>
	1 + (geometry.subpaths?.length ?? 0);

const anchorCount = (shape: BezierShape): number => shape.vertices.length;

const geometryAnchorCount = (geometry: PathGeometry): number =>
	anchorCount(geometry.shape) +
	(geometry.subpaths ?? []).reduce(
		(total, subpath) => total + anchorCount(subpath),
		0,
	);

// `metricsFor` only ever receives nodes built by `makeNode` with a `PathGeometry`
// (Shape Builder output is always a flat path/compound path), but the nodes are
// held as `VectorNode[]` whose `geometry` is the broader `NodeGeometry` union, so
// contour/anchor counting narrows by the `"path"` discriminant rather than assuming.
const nodeContourCount = (node: VectorNode): number =>
	node.geometry.kind === "path" ? contourCount(node.geometry) : 0;

const nodeAnchorCount = (node: VectorNode): number =>
	node.geometry.kind === "path" ? geometryAnchorCount(node.geometry) : 0;

const metricsFor = (
	generatedResults: readonly VectorNode[],
	remainderResults: readonly VectorNode[],
	sourceDispositions: readonly ShapeBuilderSourceDisposition[],
): ShapeBuilderOperationMetrics => ({
	generatedNodeCount: generatedResults.length,
	remainderNodeCount: remainderResults.length,
	resultNodeCount: generatedResults.length + remainderResults.length,
	generatedContourCount: generatedResults.reduce(
		(total, node) => total + nodeContourCount(node),
		0,
	),
	remainderContourCount: remainderResults.reduce(
		(total, node) => total + nodeContourCount(node),
		0,
	),
	generatedAnchorCount: generatedResults.reduce(
		(total, node) => total + nodeAnchorCount(node),
		0,
	),
	remainderAnchorCount: remainderResults.reduce(
		(total, node) => total + nodeAnchorCount(node),
		0,
	),
	consumedSourceCount: sourceDispositions.filter((d) => d.kind === "consumed")
		.length,
	rebuiltSourceCount: sourceDispositions.filter((d) => d.kind === "rebuilt")
		.length,
	untouchedSourceCount: sourceDispositions.filter((d) => d.kind === "untouched")
		.length,
});

/**
 * Builds the complete Shape Builder operation contract without mutating the
 * scene. The plan is the single source of truth for source fate, output ids,
 * cleanup candidates, selection, and output complexity metrics.
 *
 * Only sources whose coverage intersects the swept faces are replaced. Unaffected
 * selected sources can stay in their original layer slots with their original ids.
 *
 * Click EXTRACT and ERASE are face-precise: they rebuild each affected source as
 * `union(its faces − swept)`, so intentional remainders survive alongside the
 * generated/erased result.
 *
 * Drag/marquee MERGE (`mode: "merge"` with `remainderPolicy: "discard-affected"`)
 * consumes every participating source WHOLLY via `expandShapeBuilderMergeFaces`
 * and emits `union(whole participating shapes ∪ swept gap faces ∪ bridge necks)`
 * as exactly ONE compound node — no remainders, no cleanup candidates, and the
 * generated node is the sole selection.
 */
export function buildShapeBuilderOperationPlan(options: {
	readonly document: SceneDocument;
	readonly arrangement: Arrangement;
	readonly sweptFaceIndices: readonly number[];
	readonly mode: ShapeBuilderMode;
	/** Source whose style the merged node inherits (Illustrator's mouse-down art style). */
	readonly mergeStyleSourceId: string | null;
	/** Optional style for generated swept-region nodes; leftovers keep source style. */
	readonly generatedStyle?: ShapeBuilderGeneratedStyle;
	/** Whether affected source remainders should be rebuilt or consumed. */
	readonly remainderPolicy?: ShapeBuilderRemainderPolicy;
	/** User-facing path detail for generated/reconstructed output. */
	readonly outputDetail?: number;
}): ShapeBuilderOperationPlan | null {
	const { document, arrangement, mode } = options;
	if (options.sweptFaceIndices.length === 0) return null;
	// Pull in gap-bridge neck faces that join swept shapes across a gap, so a
	// merge unites into one shape regardless of whether the drag crossed the
	// (thin) neck. No-op when there are no gaps; affected-source cleanup below
	// is unaffected (necks belong to no source, so they are never a source face).
	const swept = new Set(withBridgeFaces(arrangement, options.sweptFaceIndices));
	if (swept.size === 0) return null;
	const sourceIds = arrangement._dcel.sources.map((s) => s.id);
	const affected = sourceIdsTouchedByFaces(arrangement, swept);
	const affectedSourceIds = sourceIds.filter((id) => affected.has(id));
	if (affectedSourceIds.length === 0) return null;
	if (affectedSourceIds.some((id) => !editableSource(document, id)))
		return null;
	const primaryId = affectedSourceIds[0];
	const shouldPreserveRemainders =
		mode === "erase" ||
		(options.remainderPolicy ?? "preserve-affected") === "preserve-affected";
	const outputDetail =
		options.outputDetail ?? SHAPE_BUILDER_OUTPUT_DETAIL_DEFAULT;
	const intent: ShapeBuilderOperationIntent =
		mode === "erase" ? "erase" : shouldPreserveRemainders ? "extract" : "merge";
	const operationId = nextOperationId();

	let counter = 0;
	const existingNodeIds = new Set(allNodes(document).map((node) => node.id));
	const nextShapeBuilderNodeId = (): string => {
		let id = `${primaryId}-sb${counter++}`;
		while (existingNodeIds.has(id)) id = `${primaryId}-sb${counter++}`;
		existingNodeIds.add(id);
		return id;
	};
	// Non-structural fields that should survive reconstruction (a reconstructed
	// source is "the original object minus a region"): owning artboard, look/recipe,
	// and free-form data. Structural fields (children, component, frame,
	// textFragmentGroup) are intentionally dropped — the result is a flat path.
	const preserved = (src: VectorNode | undefined): Partial<VectorNode> =>
		src
			? {
					...(src.artboardId !== undefined
						? { artboardId: src.artboardId }
						: {}),
					...(src.recipe !== undefined ? { recipe: src.recipe } : {}),
					...(src.recipeRef !== undefined ? { recipeRef: src.recipeRef } : {}),
					...(src.data !== undefined ? { data: src.data } : {}),
				}
			: {};
	const makeNode = (
		base: Partial<VectorNode>,
		name: string,
		style: NodeStyle,
		geometry: PathGeometry,
		flags: { visible: boolean; locked: boolean },
	): VectorNode => ({
		...base,
		id: nextShapeBuilderNodeId(),
		name,
		geometry,
		transform: cloneIdentity(),
		style,
		visible: flags.visible,
		locked: flags.locked,
	});

	const remainderResults: VectorNode[] = [];
	const rebuiltBySource = new Map<
		string,
		{ readonly faceIndices: readonly number[]; readonly nodeId: string }
	>();
	// Affected-source remainder reconstruction (faces it covers, minus the swept
	// set) keeps source style, name, owning artboard, and look for extract/erase.
	if (shouldPreserveRemainders) {
		for (const id of affectedSourceIds) {
			const src = findNode(document, id);
			const kept = facesCoveredBy(arrangement, id).filter((i) => !swept.has(i));
			const geometry = compoundShapeBuilderPathGeometries(
				buildShapeBuilderFaceGeometries(arrangement, kept, outputDetail),
			);
			if (geometry) {
				const node = makeNode(
					preserved(src),
					src?.name ?? "Shape",
					src?.style ?? FALLBACK_STYLE,
					geometry,
					{
						visible: src?.visible ?? true,
						locked: src?.locked ?? false,
					},
				);
				remainderResults.push(node);
				rebuiltBySource.set(id, { faceIndices: kept, nodeId: node.id });
			}
		}
	}
	// `outputFaceIndices` is the face set the generated/committed geometry is
	// actually built from: the plain bridge-included swept set for extract/erase,
	// or the merge expansion (whole participating shapes) for construction merge.
	// Merge-intent expansion is computed once here so both the geometry build below
	// and the returned plan/commit result see the same face set.
	//
	// `intent === "merge"` is `mode === "merge"` restricted to construction-merge
	// gestures (drag/marquee with `remainderPolicy: "discard-affected"`) — a plain
	// click still uses `mode === "merge"` but resolves to `intent === "extract"`
	// (see `shouldPreserveRemainders` above), so it must keep using the plain swept
	// set, not the expansion.
	const mergeExpansion =
		intent === "merge"
			? expandShapeBuilderMergeFaces(arrangement, options.sweptFaceIndices)
			: null;
	// `mergeExpansion.participatingSourceIds` is set-equal to `affected` by
	// construction (both derive from the same `withBridgeFaces` +
	// `sourceIdsTouchedByFaces` pass over `options.sweptFaceIndices`); only the
	// geometry face set differs.
	const outputFaceIndices: readonly number[] =
		mergeExpansion?.outputFaceIndices ?? [...swept];
	// merge: the swept faces become one compound object, inheriting the mouse-down
	// source's style and owning artboard (so it cannot jump artboards). Disconnected
	// islands are kept as subpaths instead of separate layer rows.
	const generatedResults: VectorNode[] = [];
	if (mode === "merge") {
		const styleSrc =
			findNode(document, options.mergeStyleSourceId ?? primaryId) ??
			findNode(document, primaryId);
		const mergedBase: Partial<VectorNode> =
			styleSrc?.artboardId !== undefined
				? { artboardId: styleSrc.artboardId }
				: {};
		const geometry = compoundShapeBuilderPathGeometries(
			buildShapeBuilderFaceGeometries(
				arrangement,
				outputFaceIndices,
				outputDetail,
			),
		);
		if (geometry) {
			const style = generatedStyle(
				styleSrc?.style ?? FALLBACK_STYLE,
				options.generatedStyle,
			);
			generatedResults.push(
				makeNode(mergedBase, "Shape Builder", style, geometry, {
					visible: true,
					locked: false,
				}),
			);
		}
	}
	if (mode === "merge" && generatedResults.length === 0) return null;
	if (intent === "merge" && remainderResults.length > 0) return null;
	const results = [...remainderResults, ...generatedResults];
	const sourceDispositions: ShapeBuilderSourceDisposition[] = sourceIds.map(
		(id) => {
			if (!affected.has(id)) return { sourceId: id, kind: "untouched" };
			const rebuilt = rebuiltBySource.get(id);
			if (rebuilt) {
				return {
					sourceId: id,
					kind: "rebuilt",
					faceIndices: rebuilt.faceIndices,
					resultNodeIds: [rebuilt.nodeId],
				};
			}
			return { sourceId: id, kind: "consumed" };
		},
	);
	const replacementNodeIdsBySourceId = new Map(
		sourceDispositions.flatMap((disposition) =>
			disposition.kind === "rebuilt"
				? [[disposition.sourceId, disposition.resultNodeIds] as const]
				: [],
		),
	);

	const command: SceneCommand = {
		type: `shape-builder/${intent}`,
		label:
			intent === "extract"
				? "Shape Builder extract"
				: intent === "merge"
					? "Shape Builder merge"
					: "Shape Builder erase",
		run: (draft) => {
			const sourceLocations = affectedSourceIds.map((id) =>
				findDraftTopLevelEditableSource(draft, id),
			);
			if (sourceLocations.some((location) => !location)) return;
			const primaryLocation = sourceLocations.find(
				(location) => location?.node.id === primaryId,
			);
			if (!primaryLocation) return;
			const layer = primaryLocation.layer;
			const removedNodeIds = new Set<string>();
			let insertIndex = primaryLocation.index;
			// Remove only sources that actually contributed to the merged/erased
			// faces, keeping unrelated selected construction art intact.
			for (const id of affectedSourceIds) {
				for (const l of draft.layers) {
					const removal = removeDraftNode(l.nodes, id, removedNodeIds);
					if (!removal.removed) continue;
					if (
						l === layer &&
						removal.topLevelIndex !== null &&
						removal.topLevelIndex < insertIndex
					)
						insertIndex -= 1;
					break;
				}
			}
			remapDraftScopedLookTargetsForShapeBuilder(
				draft,
				removedNodeIds,
				replacementNodeIdsBySourceId,
			);
			layer.nodes.splice(
				insertIndex,
				0,
				...results.map((node) => castDraft(node)),
			);
		},
	};
	const committedNodeIds = results.map((node) => node.id);
	const generatedNodeIds = generatedResults.map((node) => node.id);
	const remainderNodeIds = remainderResults.map((node) => node.id);
	const cleanupCandidateNodeIds = intent === "extract" ? remainderNodeIds : [];
	return {
		operationId,
		intent,
		sweptFaceIndices: [...swept],
		outputFaceIndices,
		affectedSourceIds,
		sourceDispositions,
		committedNodeIds,
		generatedNodeIds,
		remainderNodeIds,
		cleanupCandidateNodeIds,
		selectionNodeIds:
			generatedNodeIds.length > 0 ? generatedNodeIds : committedNodeIds,
		metrics: metricsFor(generatedResults, remainderResults, sourceDispositions),
		command,
	};
}

/**
 * Plans and commits a Shape Builder op through the scene command bus.
 */
export function applyShapeBuilderOp(
	options: Parameters<typeof buildShapeBuilderOperationPlan>[0],
): ShapeBuilderCommitResult {
	const plan = buildShapeBuilderOperationPlan(options);
	if (!plan) return EMPTY_COMMIT_RESULT;
	useSceneStore.getState().apply(plan.command);
	return {
		didCommit: true,
		operationId: plan.operationId,
		intent: plan.intent,
		sourceDispositions: plan.sourceDispositions,
		metrics: plan.metrics,
		committedNodeIds: plan.committedNodeIds,
		generatedNodeIds: plan.generatedNodeIds,
		remainderNodeIds: plan.remainderNodeIds,
		cleanupCandidateNodeIds: plan.cleanupCandidateNodeIds,
		selectionNodeIds: plan.selectionNodeIds,
		outputFaceIndices: plan.outputFaceIndices,
	};
}

/**
 * Deletes exact Shape Builder remainder ids via the normal scene command path so
 * manual cleanup stays undoable and does not infer candidates from names/layers.
 */
export function cleanupShapeBuilderRemainders(
	nodeIds: readonly string[],
): readonly string[] {
	const uniqueNodeIds = [...new Set(nodeIds)];
	if (uniqueNodeIds.length === 0) return [];
	useSceneStore.getState().apply(createDeleteNodesCommand(uniqueNodeIds));
	return uniqueNodeIds;
}

/**
 * Deletes ONE whole shape (not a face-precise erase) as a single undoable scene
 * command, via the normal delete-nodes path. Backs the Shape Builder tool's
 * Alt-click-on-a-shape-outside-the-current-arrangement contract: with the mesh
 * live from a working set, Alt-clicking an object that never joined that set
 * removes the whole object in one gesture, enabling ⌥click, ⌥click, ⌥click
 * across separate objects without a re-selection round-trip. Returns `true`
 * once the delete command was applied, `false` for an empty id (no-op, so
 * callers can decide whether to touch selection/arrangement caching).
 */
export function deleteShapeBuilderTarget(nodeId: string): boolean {
	if (!nodeId) return false;
	useSceneStore.getState().apply(createDeleteNodesCommand([nodeId]));
	return true;
}
