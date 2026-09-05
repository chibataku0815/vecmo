import { castDraft } from "immer";
import type { SceneCommand } from "./command";
import { getGeometryBounds } from "./rendering";
import { findDraftNode } from "./selectors";
import type {
	TextFragmentGroupMember,
	TextFragmentUnit,
} from "./text-fragments";

/**
 * Fraction of the median glyph height used to band children into reading rows. Two
 * children whose top edges differ by less than this are treated as the same line and
 * ordered left-to-right; larger gaps start a new line ordered top-to-bottom.
 */
const READING_ROW_RATIO = 0.6;

type PlacedChild = {
	readonly id: string;
	readonly leftX: number;
	readonly topY: number;
	readonly height: number;
};

const placedChild = (
	nodeId: string,
	bounds: { x: number; y: number; height: number },
	position: { x: number; y: number },
): PlacedChild => ({
	id: nodeId,
	// Group-space top-left: imported outline glyphs carry placement in `transform`
	// (geometry stays local), so reading order must add the child's position offset.
	leftX: position.x + bounds.x,
	topY: position.y + bounds.y,
	height: bounds.height,
});

const medianHeight = (children: readonly PlacedChild[]): number => {
	const heights = children.map((child) => child.height).sort((a, b) => a - b);
	return heights[Math.floor(heights.length / 2)] ?? 1;
};

const byReadingOrder = (
	rowBand: number,
): ((a: PlacedChild, b: PlacedChild) => number) => {
	const row = (child: PlacedChild): number => Math.round(child.topY / rowBand);
	return (a, b) => {
		const rowDelta = row(a) - row(b);
		return rowDelta !== 0 ? rowDelta : a.leftX - b.leftX;
	};
};

/**
 * Marks an existing group node as an ordered text-motion fragment group so an
 * `outline-group` text animator can pose its children (e.g. imported outlined-text
 * paths) with a Range Selector. Children are ordered by reading order — banded into
 * rows by vertical position, then left-to-right within each row — and all marked
 * selectable. This is the mainline creation path for imported outlines: outline text
 * in Figma/Illustrator, import, group the glyphs, then mark the group.
 *
 * Bounded by design: order is the load-bearing output (the selector sweeps it), so
 * word-clustering, space-from-gap detection, and unit inference are deliberately left
 * out — the caller picks `unit` (default `character`) and every glyph is selectable.
 */
export function markGroupAsTextFragments(
	groupId: string,
	unit: TextFragmentUnit = "character",
): SceneCommand {
	return {
		type: "scene/mark-text-fragments",
		label: "Mark as text fragments",
		run: (draft) => {
			const group = findDraftNode(draft, groupId);
			if (!group?.children || group.children.length === 0) return;
			const placed = group.children.map((child) =>
				placedChild(child.id, getGeometryBounds(child.geometry), {
					x: child.transform.position.x,
					y: child.transform.position.y,
				}),
			);
			const rowBand = Math.max(1, medianHeight(placed) * READING_ROW_RATIO);
			const members: TextFragmentGroupMember[] = [...placed]
				.sort(byReadingOrder(rowBand))
				.map((child, orderIndex) => ({
					nodeId: child.id,
					orderIndex,
					selectable: true,
				}));
			group.textFragmentGroup = castDraft({ unit, members });
		},
	};
}

/** Clears text-fragment provenance from a group (the inverse of marking). */
export function clearTextFragmentGroup(groupId: string): SceneCommand {
	return {
		type: "scene/clear-text-fragments",
		label: "Clear text fragments",
		run: (draft) => {
			const group = findDraftNode(draft, groupId);
			if (!group?.textFragmentGroup) return;
			group.textFragmentGroup = undefined;
		},
	};
}
