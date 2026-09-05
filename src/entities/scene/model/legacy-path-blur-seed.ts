import { isDefaultPathBlurPayload, type LookGraph } from "./look-graph";
import { selectAllArtboards } from "./selectors";
import type { SceneDocument } from "./types";

/**
 * Legacy Path Blur auto-seed detection. Before the fix landed (commit 17229d7,
 * "Path Blur: don't auto-enable the frame blur on tool activation"), merely
 * picking the Path Blur tool seeded a frame-level `source → path-blur → output`
 * Look graph onto the current artboard. Path Blur is a FRAME-level effect, so
 * documents saved by those builds blur every object drawn on the artboard —
 * users read it as a live bug even on fixed builds. This module is the pure
 * detection half of the repair flow; the undoable removal lives in
 * `features/look-authoring` and the confirmation card in the approval banner.
 */

/**
 * Node id minted ONLY by the deleted auto-seed builder (`buildDefaultPathBlurGraph`,
 * removed in 17229d7). Every current insert path mints owner-prefixed ids
 * (`<owner>-look-path-blur[-n]` via `lookGraphNodeId`), so this exact id dates a
 * node to a pre-fix build — it can never collide with a user-added Path Blur.
 */
export const LEGACY_PATH_BLUR_SEED_NODE_ID = "path-blur:effect";

/** One auto-seeded Path Blur node still present on an artboard's frame Look. */
export type LegacyPathBlurSeed = {
	readonly artboardId: string;
	readonly nodeId: string;
};

export type LegacyPathBlurSeedScan = {
	readonly seeds: readonly LegacyPathBlurSeed[];
	readonly count: number;
};

/**
 * Matches only a node that is bit-for-bit the untouched auto-seed: the legacy
 * fixed id, still enabled, and every parameter at the insert-time default. A
 * user who moved a guide anchor, scrubbed any slider, or eye-off'd the node has
 * expressed intent — such nodes never match, so a deliberately kept Path Blur
 * look always survives detection.
 */
const legacySeedNode = (graph: LookGraph | undefined) =>
	graph?.nodes.find(
		(node) =>
			node.id === LEGACY_PATH_BLUR_SEED_NODE_ID &&
			node.payload.kind === "path-blur" &&
			node.enabled &&
			isDefaultPathBlurPayload(node.payload),
	);

/** Pure scan over every artboard's stored frame Look graph. */
export function scanLegacyPathBlurSeeds(
	document: SceneDocument,
): LegacyPathBlurSeedScan {
	const seeds = selectAllArtboards(document).flatMap((artboard) => {
		const node = legacySeedNode(artboard.effectIntent?.lookGraph);
		return node ? [{ artboardId: artboard.id, nodeId: node.id }] : [];
	});
	return { seeds, count: seeds.length };
}
