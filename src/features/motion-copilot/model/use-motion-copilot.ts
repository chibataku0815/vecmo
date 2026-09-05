import { useMemo } from "react";
import { computeContextRevision } from "@/entities/agent/model/plan-context-revision";
import { useMotionCopilotPlanSession } from "@/entities/agent/model/plan-session";
import { useMotionStore } from "@/entities/motion/model/store";
import { findNode } from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import { useEditorChromeStore } from "@/shared/editor-chrome/model/store";
import {
	type MotionCopilotView,
	projectAppliedCard,
	projectPlanCard,
} from "./projection";

/**
 * The Motion Copilot user workflow over the plan session (Creator 2, C2-L2).
 * Projects the live `entities/agent` plan session into card view-models and
 * exposes only the workflow actions that stay within `entities/agent` +
 * `shared/editor-chrome` — no `features/agent` import. Approve/reject (bridge
 * approval slot) and Undo (global history) are composed by the widget, which is
 * allowed to combine both features; this feature must not.
 */
export type MotionCopilotWorkflow = {
	/** Projected panel view, or null when no plan has been proposed this session. */
	readonly view: MotionCopilotView | null;
	/** Focuses the Value/Speed Graph on an applied motion track via editor-chrome. */
	readonly openInGraph: (trackId: string) => void;
	/**
	 * Discards the displayed (proposed/stale) plan while preserving the accepted-
	 * delta thread (C2-L4 stale-card Discard). No-op when there is no plan id.
	 */
	readonly discardProposal: () => void;
	/** Collapses the Motion Copilot panel (editor chrome only). */
	readonly close: () => void;
	/** Clears the transient session read model. */
	readonly reset: () => void;
};

export function useMotionCopilot(): MotionCopilotWorkflow {
	const proposal = useMotionCopilotPlanSession((state) => state.proposal);
	const status = useMotionCopilotPlanSession((state) => state.status);
	const proposalContextRevision = useMotionCopilotPlanSession(
		(state) => state.proposalContextRevision,
	);
	const applied = useMotionCopilotPlanSession((state) => state.applied);
	const rejectionNote = useMotionCopilotPlanSession(
		(state) => state.rejectionNote,
	);
	const undoAvailable = useMotionCopilotPlanSession(
		(state) => state.undoAvailable,
	);
	const historyCount = useMotionCopilotPlanSession(
		(state) => state.history.length,
	);
	const reset = useMotionCopilotPlanSession((state) => state.reset);
	const discard = useMotionCopilotPlanSession((state) => state.discardProposal);
	const requestGraphFocus = useEditorChromeStore(
		(state) => state.requestGraphFocus,
	);
	const setMotionCopilotOpen = useEditorChromeStore(
		(state) => state.setMotionCopilotOpen,
	);
	// Subscribe to the WHOLE motion + scene documents (not just tracks): the applied
	// card resolves live track labels, AND the staleness watcher recomputes the live
	// context revision — which must react to fps/duration drifts as well as any
	// per-keyframe value/time/easing edit (C2-L4). The document reference changes on
	// any of those, so this subscription IS the watcher.
	const motionDocument = useMotionStore((state) => state.document);
	const sceneDocument = useSceneStore((state) => state.document);

	const view = useMemo<MotionCopilotView | null>(() => {
		if (!proposal) return null;
		// Staleness: a proposed plan whose recorded build-time revision no longer
		// matches the live revision has drifted (a manual Graph edit, an external
		// change, or an intervening apply). Only meaningful while `proposed`; an
		// applied/rejected plan owns its own terminal.
		const liveRevision = computeContextRevision(sceneDocument, motionDocument);
		const stale =
			status === "proposed" &&
			proposalContextRevision !== null &&
			liveRevision !== null &&
			liveRevision !== proposalContextRevision;
		// Map an affected motion-track id to a live focusable track. The id may be a
		// real live track id, or the synthetic `nodeId:property` address minted for a
		// freshly-created track (see agent write.ts `trackTargetId`); resolving the
		// latter against the live tracks yields the REAL id so "Open in Graph" seeds
		// MotionTimeline with an id it can find. Null (no live match) drops it.
		const resolveFocusTrack = (
			affectedId: string,
		): { readonly trackId: string; readonly label: string } | null => {
			const track =
				motionDocument.tracks.find(
					(candidate) => candidate.id === affectedId,
				) ??
				motionDocument.tracks.find(
					(candidate) =>
						`${candidate.target.nodeId}:${candidate.target.property}` ===
						affectedId,
				);
			if (!track) return null;
			const node = findNode(sceneDocument, track.target.nodeId);
			return {
				trackId: track.id,
				label: `${node?.name ?? track.target.nodeId} · ${track.target.property}`,
			};
		};
		return {
			status,
			planCard: projectPlanCard(proposal),
			appliedCard: applied
				? projectAppliedCard(applied, resolveFocusTrack)
				: null,
			rejectionNote,
			undoAvailable,
			appliedHistoryCount: historyCount,
			stale,
		};
	}, [
		proposal,
		status,
		proposalContextRevision,
		applied,
		rejectionNote,
		undoAvailable,
		historyCount,
		motionDocument,
		sceneDocument,
	]);

	return {
		view,
		openInGraph: (trackId) => requestGraphFocus({ trackId }),
		discardProposal: () => {
			if (proposal) discard(proposal.planId);
		},
		close: () => setMotionCopilotOpen(false),
		reset,
	};
}
