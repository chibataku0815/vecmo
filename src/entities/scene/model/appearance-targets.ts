import { resolveSceneMaskPlan } from "./mask-render";
import { getGeometryBounds, getNodeLocalPaintBounds } from "./rendering";
import { findNode, isFrameNode } from "./selectors";
import type { Bounds, SceneDocument, VectorNode } from "./types";

/**
 * Reports whether a node's own paint is meaningless for rendering because it is
 * a wrapper container: group and Blend nodes hold their members in `children`
 * but paint a degenerate zero-length line with a fixed placeholder style (see
 * `GROUP_WRAPPER_STYLE` in `features/grouping/model/command.ts` and
 * `entities/scene/model/blend.ts`) that `CanvasShell` never composites
 * meaningfully. A frame is the one container kind with real own geometry and a
 * paintable background, so it is excluded — frames keep editing their own
 * fill/stroke like a leaf node. Exported so per-row appearance-stack UI (which
 * edits one node's own paint list directly) can hide itself for a container
 * whose own paint list would be meaningless to edit.
 *
 * This is a narrower concept than {@link hasSubtreeCarrier}: this predicate asks
 * whether a node's OWN paint is worth editing (drives paint-target expansion and
 * per-row appearance-stack UI), while `hasSubtreeCarrier` asks whether a node's
 * opacity/effects should composite over its whole subtree (drives carrier
 * emission in the renderers). A frame answers "no" here (its own fill/stroke
 * stays directly editable) but "yes" there (its opacity/effects still fade its
 * children as one unit, matching Figma frame semantics) — do not conflate the
 * two or collapse them into one predicate.
 */
export function isWrapperContainer(node: VectorNode): boolean {
	return Boolean(node.children?.length) && !isFrameNode(node);
}

/**
 * Reports whether a node's opacity and effects should composite over its entire
 * subtree via the render-part "subtree" carrier (see `SVG_RENDER_PARTS.subtree`
 * in `shared/lib/svg-render-parts.ts`), instead of applying only to the node's
 * own painted shape. True for every node that has children — group, Blend, AND
 * frame containers alike — because in all three cases children render as
 * additional visual content stacked with (group/Blend: a degenerate invisible
 * placeholder; frame: a real paintable background) the node's own shape, so an
 * opacity/filter left on that own shape alone would never reach the children
 * (see `CanvasShell.tsx` `SceneNode`, `features/export/model/svg.ts`
 * `renderNode`, and `features/export/model/code.ts`
 * `hasSubtreeCarrierNode`/`renderNode` for the four render surfaces this drives).
 *
 * See {@link isWrapperContainer}'s doc for how this differs from that narrower,
 * paint-editing-scoped predicate — frames are excluded there but included here.
 */
export function hasSubtreeCarrier(node: VectorNode): boolean {
	return Boolean(node.children?.length);
}

/**
 * Geometry-local bounds an effect filter region should be built from, shared by
 * the canvas renderer and the SVG exporter so the two adapters can never diverge
 * on where a node's shadow/blur region sits (see `buildEffectFilter`'s `bounds`
 * parameter). A leaf node's own filter is geometry-local, so it uses
 * {@link getGeometryBounds} directly, unchanged from before subtree carriers
 * existed.
 *
 * A {@link hasSubtreeCarrier} node's filter region must cover everything the
 * carrier composites: {@link getNodeLocalPaintBounds} unions a node's own
 * geometry with its transformed children, which is correct for all three
 * carrier-bearing kinds — group/Blend's own geometry is a fixed degenerate
 * placeholder so the union reduces to the children's bounds (unchanged
 * behavior from when this used {@link getNodeLocalBounds}, which omits own
 * geometry entirely), while a frame's own geometry is a real, independently
 * resizable background rect that is NOT guaranteed to enclose its children (it
 * only starts coincident with their union at "Wrap in frame" time — see
 * `frameBoundsForNodes` in `entities/scene/model/node-commands.ts` — and can
 * drift via a later resize or a child added/moved after), so it must be folded
 * into the union rather than discarded.
 *
 * Frames do not currently clip their children in any renderer (`clipsContent`
 * on `VectorNode.frame` — see `frameClipsContent` in `./selectors` — is wired
 * only to a Layers-panel badge, not to a `clipPath`/`overflow` in
 * `CanvasShell.tsx`, `features/export/model/svg.ts`, or
 * `features/export/model/code.ts`), so the composite visual extent is not
 * bounded by the frame's own rect and must include the full children union.
 * Stroke width is intentionally excluded here: both callers add it as a
 * separate region margin (`buildEffectFilter`'s `strokeWidth` argument), so
 * folding it into these bounds would double-count it.
 */
export function effectFilterBoundsForNode(node: VectorNode): Bounds {
	return hasSubtreeCarrier(node)
		? getNodeLocalPaintBounds(node)
		: getGeometryBounds(node.geometry);
}

/**
 * Expands paint-scoped target ids so fill/stroke reads and writes reach the
 * drawable leaves a group or Blend container visually represents, instead of
 * the container's own meaningless wrapper paint (see {@link isWrapperContainer}).
 *
 * Each input id resolves to itself when it names a leaf or a frame (frames own
 * a real, paintable background); a wrapper container instead contributes its
 * descendant leaves, found by recursing depth-first and stopping at the first
 * non-wrapper node on each branch (a frame nested inside a group still keeps
 * its own paint, so it becomes exactly one target, not its children). A leaf
 * that is a CONSUMED mask source (see `resolveSceneMaskPlan`'s
 * `consumedMaskNodeIds` — it is silhouette-only and never painted as ordinary
 * geometry, matching Figma/Illustrator "use as mask") is skipped when reached
 * through this group-expansion path, because a bulk paint write through it would
 * be a silent no-op that only confuses the edit; the exclusion is scoped to
 * expansion ONLY — directly selecting the mask source node by itself (a single
 * id naming it, not reached via a wrapper ancestor) still resolves to itself and
 * stays editable through other code paths. Unknown ids are skipped. An empty
 * group, or one whose only leaves are excluded mask sources, contributes
 * nothing. The result dedupes while preserving first-occurrence order, so
 * callers can pass it straight to `uniqueNodeIds`-style command helpers without
 * a second pass.
 */
export function expandPaintTargetIds(
	document: SceneDocument,
	nodeIds: readonly string[],
): readonly string[] {
	const consumedMaskNodeIds =
		resolveSceneMaskPlan(document).consumedMaskNodeIds;
	const seen = new Set<string>();
	const result: string[] = [];

	const collectLeaves = (node: VectorNode, viaWrapper: boolean): void => {
		if (!isWrapperContainer(node)) {
			if (viaWrapper && consumedMaskNodeIds.has(node.id)) return;
			if (seen.has(node.id)) return;
			seen.add(node.id);
			result.push(node.id);
			return;
		}
		for (const child of node.children ?? []) collectLeaves(child, true);
	};

	for (const nodeId of nodeIds) {
		const node = findNode(document, nodeId);
		if (!node) continue;
		collectLeaves(node, false);
	}

	return result;
}
