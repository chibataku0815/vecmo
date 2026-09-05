import {
	removePositionPath,
	removeSourceOpticsTrack,
	removeTrack,
} from "@/entities/motion/model/commands";
import { useMotionStore } from "@/entities/motion/model/store";
import type { MotionDocument } from "@/entities/motion/model/types";
import type { MotionGrammarStoreDocument } from "@/entities/motion-grammar/model/command";
import { removeGrammarBinding } from "@/entities/motion-grammar/model/commands";
import { useMotionGrammarStore } from "@/entities/motion-grammar/model/store";
import { allNodes, selectAllArtboards } from "@/entities/scene/model/selectors";
import { sourceOpticsParameterValue } from "@/entities/scene/model/source-optics";
import { useSceneStore } from "@/entities/scene/model/store";
import type { Artboard, SceneDocument } from "@/entities/scene/model/types";

/**
 * Orphaned motion data = a motion track whose `target.nodeId`, or a grammar
 * binding any of whose `targetIds`, points at a scene node that no longer
 * exists. Scene node deletion is scene-only (it never touches the motion or
 * grammar stores), so deleting a node strands its timing data. The agent
 * validator then flags every stranded reference as an ERROR and the whole
 * document fails the apply gate, hard-blocking even unrelated agent edits —
 * with no way to remove an orphan through the agent bridge, because that path
 * self-blocks on the very errors a removal would clear. The fix runs through
 * the editor's own command stores instead. This module is the pure detection +
 * editor-store recovery; the wiring lives in `app` and the surface in the
 * approval banner.
 */

/** Distinct-entity health summary surfaced to the user. */
export type DocumentMotionHealth = {
	/** Orphan tracks + orphan bindings (distinct entities, not validator errors). */
	readonly count: number;
	readonly trackCount: number;
	readonly sourceOpticsTrackCount: number;
	readonly positionPathCount: number;
	readonly bindingCount: number;
};

export type OrphanMotionScan = {
	readonly orphanTrackIds: readonly string[];
	readonly orphanSourceOpticsTrackIds: readonly string[];
	readonly orphanPositionPathNodeIds: readonly string[];
	readonly orphanBindingIds: readonly string[];
	readonly count: number;
};

const EMPTY_SCAN: OrphanMotionScan = {
	orphanTrackIds: [],
	orphanSourceOpticsTrackIds: [],
	orphanPositionPathNodeIds: [],
	orphanBindingIds: [],
	count: 0,
};

/** Live scene node-id set — the same membership the agent validator checks. */
export function liveSceneNodeIds(scene: SceneDocument): ReadonlySet<string> {
	return new Set(allNodes(scene).map((node) => node.id));
}

/**
 * Pure orphan scan. Scopes strictly to `motion.tracks` (NEVER `lookNodeTracks`,
 * which key Look-graph nodes in a different id space) and leaves
 * `grammar.passthrough` untouched (unknown-technique bindings are never
 * validated and must round-trip verbatim). A grammar binding is orphaned when
 * ANY of its targets is gone — the whole binding is removed rather than its dead
 * ids filtered, because `targetIds` order is load-bearing for wavefront
 * techniques and silently re-ordering it corrupts the surviving targets' timing.
 *
 * Safety: a document with live motion/grammar but ZERO live scene nodes is a
 * persistence load race/failure (scene and motion restore on independent async
 * callbacks), never a legitimate prune target — report clean so the false
 * "repair" card can never appear and never offer to wipe all motion.
 */
export function scanOrphanedMotion(
	liveNodeIds: ReadonlySet<string>,
	motion: MotionDocument,
	grammar: MotionGrammarStoreDocument,
	sceneForSourceOpticsScan?: SceneDocument,
): OrphanMotionScan {
	if (
		liveNodeIds.size === 0 &&
		(motion.tracks.length > 0 ||
			(motion.positionPaths?.length ?? 0) > 0 ||
			grammar.bindings.length > 0)
	) {
		return EMPTY_SCAN;
	}
	const orphanTrackIds = motion.tracks
		.filter((track) => !liveNodeIds.has(track.target.nodeId))
		.map((track) => track.id);
	const orphanPositionPathNodeIds = (motion.positionPaths ?? [])
		.filter((path) => !liveNodeIds.has(path.nodeId))
		.map((path) => path.nodeId);
	const artboards = new Map<string, Artboard>();
	for (const artboard of sceneForSourceOpticsScan
		? selectAllArtboards(sceneForSourceOpticsScan)
		: []) {
		artboards.set(artboard.id, artboard);
	}
	const orphanSourceOpticsTrackIds = (motion.sourceOpticsTracks ?? [])
		.filter((track) => {
			if (!sceneForSourceOpticsScan) return false;
			const artboard = artboards.get(track.target.artboardId);
			return (
				!artboard ||
				sourceOpticsParameterValue(artboard, track.target) === undefined
			);
		})
		.map((track) => track.id);
	const orphanBindingIds = grammar.bindings
		.filter((binding) => binding.targetIds.some((id) => !liveNodeIds.has(id)))
		.map((binding) => binding.id);
	return {
		orphanTrackIds,
		orphanSourceOpticsTrackIds,
		orphanPositionPathNodeIds,
		orphanBindingIds,
		count:
			orphanTrackIds.length +
			orphanSourceOpticsTrackIds.length +
			orphanPositionPathNodeIds.length +
			orphanBindingIds.length,
	};
}

/** Reads the three editor stores and reports motion health (null when clean). */
export function scanDocumentMotionHealth(): DocumentMotionHealth | null {
	const scene = useSceneStore.getState().document;
	const motion = useMotionStore.getState().document;
	const grammar = useMotionGrammarStore.getState().document;
	const scan = scanOrphanedMotion(
		liveSceneNodeIds(scene),
		motion,
		grammar,
		scene,
	);
	if (scan.count === 0) return null;
	return {
		count: scan.count,
		trackCount: scan.orphanTrackIds.length,
		sourceOpticsTrackCount: scan.orphanSourceOpticsTrackIds.length,
		positionPathCount: scan.orphanPositionPathNodeIds.length,
		bindingCount: scan.orphanBindingIds.length,
	};
}

const PRUNE_COALESCE_KEY = "prune-orphan-motion";
const PRUNE_LABEL = "Clean up orphaned motion";

/**
 * Removes orphaned tracks + grammar bindings through the editor's OWN command
 * stores (bypassing the self-blocking agent gate). One undo entry per store
 * (motion + grammar are separate stacks; Cmd+Z reverts each in turn — there is
 * no compound cross-store undo). Re-derives the scan at call time, then hard-
 * bails inside `scanOrphanedMotion` on a zero-node load failure, so it can
 * never wipe a fully-loaded motion document against a not-yet-loaded scene.
 */
export function pruneOrphanedMotion(): void {
	const scene = useSceneStore.getState().document;
	const liveNodeIds = liveSceneNodeIds(scene);
	const scan = scanOrphanedMotion(
		liveNodeIds,
		useMotionStore.getState().document,
		useMotionGrammarStore.getState().document,
		scene,
	);
	if (scan.count === 0) return;
	if (
		scan.orphanTrackIds.length > 0 ||
		scan.orphanSourceOpticsTrackIds.length > 0 ||
		scan.orphanPositionPathNodeIds.length > 0
	) {
		const motionStore = useMotionStore.getState();
		motionStore.beginTransaction(PRUNE_COALESCE_KEY, PRUNE_LABEL);
		for (const trackId of scan.orphanTrackIds) {
			motionStore.apply(removeTrack(trackId));
		}
		for (const trackId of scan.orphanSourceOpticsTrackIds) {
			motionStore.apply(removeSourceOpticsTrack(trackId));
		}
		for (const nodeId of scan.orphanPositionPathNodeIds) {
			motionStore.apply(removePositionPath(nodeId));
		}
		motionStore.commit();
	}
	if (scan.orphanBindingIds.length > 0) {
		const grammarStore = useMotionGrammarStore.getState();
		grammarStore.beginTransaction(PRUNE_COALESCE_KEY, PRUNE_LABEL);
		for (const bindingId of scan.orphanBindingIds) {
			grammarStore.apply(removeGrammarBinding(bindingId));
		}
		grammarStore.commit();
	}
}
