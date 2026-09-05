import { create } from "zustand";
import type { AgentCommandPlanResult } from "./types";

/**
 * Transient read-model for the Motion Copilot panel (Creator 2, C2-L2). It holds
 * the latest full {@link AgentCommandPlanResult} that arrived over the live Agent
 * bridge so the panel can present a plan at authoring depth — instead of the
 * bridge banner's compressed intent/count slot. This is presentation state, not a
 * second document truth: it stores only typed plan/result contracts (never scene,
 * motion, or grammar payloads), is cleared on {@link reset}, and is never
 * persisted. The durable truth stays in the Scene/Motion/Grammar stores behind
 * {@link applyApprovedAgentCommandPlan}.
 *
 * Single active proposal, mirroring the bridge's single pending-approval slot
 * (`approval-store.ts` rejects a second pending): while the tracked proposal is
 * still pending (`proposed`/`applying`), a newer proposal with a different
 * `planId` does not replace the displayed one — its own approval would be
 * rejected by the banner anyway. Once the tracked proposal has settled
 * (`applied`/`rejected`/`superseded`), the next proposal takes over.
 */
export type MotionCopilotSessionStatus =
	| "proposed"
	| "applying"
	| "applied"
	| "rejected"
	/**
	 * Reserved for stale/replaced-plan handling (C2-L4): a pending proposal that
	 * is invalidated before it applies. No transition drives it in C2-L2, but the
	 * panel projection handles it defensively so the terminal exists in the type.
	 */
	| "superseded";

/** One applied plan result kept in the capped history ring. */
export type MotionCopilotAppliedRecord = {
	readonly result: AgentCommandPlanResult;
	readonly recordedAt: number;
};

/** Newest-first cap on the applied-result history ring. */
export const MOTION_COPILOT_APPLIED_HISTORY_LIMIT = 10;

const isPending = (status: MotionCopilotSessionStatus): boolean =>
	status === "proposed" || status === "applying";

type MotionCopilotPlanSessionState = {
	/**
	 * The full result currently displayed. Holds the latest validate-time review
	 * while pending; after a successful apply it is replaced by the richer
	 * apply-time result (which carries `appliedCommands`).
	 */
	readonly proposal: AgentCommandPlanResult | null;
	readonly status: MotionCopilotSessionStatus;
	/**
	 * The `contextRevision` the displayed proposal was BUILT against (C2-L4). For a
	 * composer plan this is the revision the projection was minted with (so drift
	 * during the provider round-trip is caught); for a bridge plan it is minted at
	 * receipt. The staleness watcher compares it to the live revision. Null when no
	 * proposal is tracked, or when the document had no artboard to revision.
	 */
	readonly proposalContextRevision: string | null;
	/** The apply-time result of the tracked proposal, or null before apply. */
	readonly applied: AgentCommandPlanResult | null;
	/** Human-facing note when the tracked proposal was rejected/cancelled. */
	readonly rejectionNote: string | null;
	/**
	 * Whether the applied compound is still the reversible top-of-history, gating
	 * the panel's Undo affordance. Set true on apply, flipped false once any
	 * coordinated store's history moves past the applied compound (a further edit
	 * or undo) — mirrors the activity toast's `undoAvailable` semantics.
	 */
	readonly undoAvailable: boolean;
	readonly history: readonly MotionCopilotAppliedRecord[];
	/**
	 * Records a validate-time review as the displayed proposal (see slot rule),
	 * stamping the `contextRevision` it was built against for staleness detection
	 * (C2-L4). `null` when the document had no artboard to revision.
	 */
	readonly recordProposed: (
		result: AgentCommandPlanResult,
		contextRevision: string | null,
	) => void;
	/** Marks the tracked, still-pending proposal as mutating. */
	readonly markApplying: (planId: string) => void;
	/** Records the apply-time result of the tracked proposal. */
	readonly recordApplied: (result: AgentCommandPlanResult) => void;
	/** Records an approval rejection/cancel for the tracked, still-pending proposal. */
	readonly recordRejected: (planId: string, note?: string) => void;
	/** Flips the applied plan's Undo affordance (id-guarded against a stale flip). */
	readonly setUndoAvailable: (planId: string, available: boolean) => void;
	/**
	 * Drops the currently displayed proposal (C2-L4 stale-card Discard) while
	 * preserving the accepted-delta thread in {@link history} — a discarded stale
	 * plan must not erase the conversation context a later follow-up relies on.
	 * No-op unless a proposal is displayed and still pending or stale-eligible.
	 */
	readonly discardProposal: (planId: string) => void;
	/** Clears all session state; never persisted, so a reload starts empty. */
	readonly reset: () => void;
};

export const useMotionCopilotPlanSession =
	create<MotionCopilotPlanSessionState>()((set, get) => ({
		proposal: null,
		status: "proposed",
		proposalContextRevision: null,
		applied: null,
		rejectionNote: null,
		undoAvailable: false,
		history: [],
		recordProposed: (result, contextRevision) => {
			// Single active proposal: always display the newest bridge review. The
			// bridge's own single pending-approval slot (approval-store rejects a
			// second pending) is the real serializer for *approvals*; this read model
			// just mirrors the latest review at authoring depth. A bare `validate`
			// leaves a "proposed" slot that a later `apply` (different planId) must be
			// able to supersede — so adoption is unconditional. An in-flight apply is
			// synchronous, so no proposal can arrive mid-mutation to interrupt it.
			set({
				proposal: result,
				status: "proposed",
				proposalContextRevision: contextRevision,
				applied: null,
				rejectionNote: null,
				undoAvailable: false,
			});
		},
		markApplying: (planId) => {
			const current = get();
			if (
				!current.proposal ||
				current.proposal.planId !== planId ||
				!isPending(current.status)
			) {
				return;
			}
			set({ status: "applying" });
		},
		recordApplied: (result) => {
			const current = get();
			// Only the tracked proposal can produce an apply (single approval slot);
			// ignore a stray apply result for a plan the panel is not displaying.
			if (current.proposal && current.proposal.planId !== result.planId) return;
			set({
				proposal: result,
				applied: result,
				status: "applied",
				rejectionNote: null,
				undoAvailable: true,
				history: [{ result, recordedAt: Date.now() }, ...current.history].slice(
					0,
					MOTION_COPILOT_APPLIED_HISTORY_LIMIT,
				),
			});
		},
		recordRejected: (planId, note) => {
			const current = get();
			if (
				!current.proposal ||
				current.proposal.planId !== planId ||
				!isPending(current.status)
			) {
				return;
			}
			set({ status: "rejected", rejectionNote: note ?? null });
		},
		setUndoAvailable: (planId, available) => {
			const current = get();
			if (!current.applied || current.applied.planId !== planId) return;
			if (current.undoAvailable === available) return;
			set({ undoAvailable: available });
		},
		discardProposal: (planId) => {
			const current = get();
			// Only a still-displayed, non-applied proposal is discardable. An applied
			// plan owns its Undo path; discarding it here would desync the panel from
			// the durable history. `history` (accepted deltas) is preserved.
			if (!current.proposal || current.proposal.planId !== planId) return;
			if (current.status === "applying") return;
			set({
				proposal: null,
				status: "proposed",
				proposalContextRevision: null,
				applied: null,
				rejectionNote: null,
				undoAvailable: false,
			});
		},
		reset: () =>
			set({
				proposal: null,
				status: "proposed",
				proposalContextRevision: null,
				applied: null,
				rejectionNote: null,
				undoAvailable: false,
				history: [],
			}),
	}));
