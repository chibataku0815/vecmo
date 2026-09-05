import { create } from "zustand";
import type {
	AgentCommandPlanApproval,
	AgentCommandTransactionStore,
} from "@/entities/agent/model/types";
import type { LegacyPathBlurSeedScan } from "@/entities/scene/model/legacy-path-blur-seed";
import type { DocumentMotionHealth } from "./orphan-motion";
import {
	persistAutoApplyEdits,
	readPersistedAutoApplyEdits,
} from "./trust-persistence";

/**
 * UI state for the live agent bridge. The editor receives proposed edit plans
 * over the bridge, reviews them without mutating, and parks them here until a
 * human approves or rejects — the load-bearing human checkpoint that keeps
 * "approval-gated" honest. One approval is surfaced at a time; a second arriving
 * while one is pending is rejected with a note rather than silently dropped.
 */
export type AgentBridgeStatus =
	| "idle"
	| "connecting"
	| "connected"
	| "disconnected";

export type AgentBridgeEditPlanPendingApproval = {
	readonly kind: "edit-plan";
	readonly id: string;
	readonly intent: string;
	readonly affectedCount: number;
	readonly warningCount: number;
	readonly documentCommandCount: number;
	readonly sceneCommandCount: number;
	readonly motionCommandCount: number;
};

export type AgentBridgeProjectSavePendingApproval = {
	readonly kind: "project-save";
	readonly id: string;
	readonly intent: string;
	readonly mode: "save" | "save-as-new" | "save-as-copy";
	readonly projectName: string;
	readonly activeProjectName: string | null;
};

export type AgentBridgePendingApproval =
	| AgentBridgeEditPlanPendingApproval
	| AgentBridgeProjectSavePendingApproval;

export type AgentBridgeRemoteSession = {
	readonly baseUrl: string;
	readonly sessionId: string;
	readonly token: string;
	readonly expiresAt: number;
};

/**
 * Which transport this tab's editor leg is using. Set once, synchronously, by
 * whichever of `createEditorBridgeConnection` (`"local"`) or
 * `createProductionEditorBridgeConnection` (`"remote"`) `useAgentBridge` calls,
 * and cleared back to `null` on disposal. This is deliberately a separate,
 * authoritative fact rather than something inferred from `remoteSession`
 * nullability: `remoteSession` also reverts to `null` when a production bridge
 * session fetch fails, and `remoteError` is reused by both transports for an
 * unrelated "edit blocked" message, so neither can reliably answer "which
 * transport is this" on its own — inferring from them mislabels a failed
 * remote session as local in the chip.
 */
export type AgentBridgeTransportKind = "local" | "remote";

/**
 * One non-blocking activity toast recorded when an edit plan applied through
 * the auto-apply trust path (never for a manually-approved plan — the human
 * already saw that decision in the approval banner). Runtime-only: `activity`
 * is never persisted, so a reload starts with an empty log rather than
 * resurfacing stale toasts. `undoAvailable` starts true and is flipped to
 * false the moment the owning store's history changes again (see
 * `recordActivity`), gating the "取り消す" button in the newest entry.
 */
export type AgentBridgeActivityEntry = {
	readonly id: string;
	readonly intent: string;
	readonly storeKind: AgentCommandTransactionStore;
	readonly commandCount: number;
	readonly warningCount: number;
	readonly undoAvailable: boolean;
};

const ACTIVITY_LIMIT = 5;

type ApprovalResolver = (decision: AgentCommandPlanApproval) => void;

type AgentBridgeUiState = {
	readonly status: AgentBridgeStatus;
	readonly remoteSession: AgentBridgeRemoteSession | null;
	readonly remoteError: string | null;
	/** See {@link AgentBridgeTransportKind}. Null before a connection attempt starts. */
	readonly transportKind: AgentBridgeTransportKind | null;
	readonly pending: AgentBridgePendingApproval | null;
	readonly resolver: ApprovalResolver | null;
	/**
	 * Orphaned-motion health for the open document, independent of the bridge so
	 * a broken doc surfaces (and self-heals via the banner) even with no agent
	 * connected. Null when clean.
	 */
	readonly documentHealth: DocumentMotionHealth | null;
	/**
	 * Pre-fix auto-seeded frame Path Blur nodes still stored in the open document
	 * (see `entities/scene/model/legacy-path-blur-seed`). Like `documentHealth`,
	 * independent of the bridge — the repair card surfaces on plain editor
	 * sessions. Null when clean.
	 */
	readonly legacyPathBlurSeeds: LegacyPathBlurSeedScan | null;
	/**
	 * True once the scene persistence load has settled. Health scanning is gated
	 * on this: scene and motion restore on independent async callbacks, so a scan
	 * before the scene resolves would compare live motion against a blank node set
	 * and report every track as orphaned. Stays false until the scene is real.
	 */
	readonly sceneHydrated: boolean;
	/**
	 * Human-granted standing trust: when true, `requestApproval` in
	 * `editor-bridge.ts` short-circuits edit-plan approval instead of enqueueing
	 * the banner. Hydrated synchronously from localStorage at store creation
	 * (see `trust-persistence.ts`) so a reload does not flash the default before
	 * the persisted choice loads. Never affects `requestProjectSaveApproval`;
	 * project saves only skip the banner through the separate local development
	 * bridge auto-approval policy.
	 */
	readonly autoApplyEdits: boolean;
	/** Runtime-only log of edits applied via the auto-apply trust path (see {@link AgentBridgeActivityEntry}). Newest first, capped at {@link ACTIVITY_LIMIT}. */
	readonly activity: readonly AgentBridgeActivityEntry[];
	readonly setStatus: (status: AgentBridgeStatus) => void;
	readonly setRemoteSession: (session: AgentBridgeRemoteSession | null) => void;
	readonly setRemoteError: (message: string | null) => void;
	readonly setTransportKind: (kind: AgentBridgeTransportKind | null) => void;
	readonly setDocumentHealth: (health: DocumentMotionHealth | null) => void;
	readonly setLegacyPathBlurSeeds: (
		scan: LegacyPathBlurSeedScan | null,
	) => void;
	readonly setSceneHydrated: (hydrated: boolean) => void;
	/** Toggles the auto-apply trust mode and persists the new value. */
	readonly setAutoApplyEdits: (enabled: boolean) => void;
	/**
	 * Parks an approval for human review. Returns false when one is already
	 * pending so the caller can reject the newcomer instead of overwriting.
	 */
	readonly enqueueApproval: (
		pending: AgentBridgePendingApproval,
		resolve: ApprovalResolver,
	) => boolean;
	readonly approve: () => void;
	readonly reject: () => void;
	readonly cancelPending: (note: string) => void;
	/** Prepends a new auto-apply activity entry, dropping the oldest past {@link ACTIVITY_LIMIT}. */
	readonly recordActivity: (
		entry: Omit<AgentBridgeActivityEntry, "id" | "undoAvailable">,
	) => void;
	/** Marks an activity entry's undo affordance as no longer valid (the owning store's history moved on) or removes it entirely on manual/auto dismiss. */
	readonly setActivityUndoAvailable: (id: string, available: boolean) => void;
	readonly dismissActivity: (id: string) => void;
};

export const useAgentBridgeStore = create<AgentBridgeUiState>()((set, get) => ({
	status: "idle",
	remoteSession: null,
	remoteError: null,
	transportKind: null,
	pending: null,
	resolver: null,
	documentHealth: null,
	legacyPathBlurSeeds: null,
	sceneHydrated: false,
	autoApplyEdits: readPersistedAutoApplyEdits(),
	activity: [],
	setStatus: (status) => set({ status }),
	setRemoteSession: (remoteSession) => set({ remoteSession }),
	setRemoteError: (remoteError) => set({ remoteError }),
	setTransportKind: (transportKind) => set({ transportKind }),
	setDocumentHealth: (documentHealth) => set({ documentHealth }),
	setLegacyPathBlurSeeds: (legacyPathBlurSeeds) => set({ legacyPathBlurSeeds }),
	setSceneHydrated: (sceneHydrated) => set({ sceneHydrated }),
	setAutoApplyEdits: (autoApplyEdits) => {
		set({ autoApplyEdits });
		persistAutoApplyEdits(autoApplyEdits);
	},
	enqueueApproval: (pending, resolve) => {
		if (get().pending) return false;
		set({ pending, resolver: resolve });
		return true;
	},
	approve: () => {
		get().resolver?.({ approved: true, reviewer: "editor" });
		set({ pending: null, resolver: null });
	},
	reject: () => {
		get().resolver?.({ approved: false, note: "Rejected in the editor." });
		set({ pending: null, resolver: null });
	},
	cancelPending: (note) => {
		get().resolver?.({ approved: false, note });
		set({ pending: null, resolver: null });
	},
	recordActivity: (entry) => {
		const next: AgentBridgeActivityEntry = {
			...entry,
			id: crypto.randomUUID(),
			undoAvailable: true,
		};
		set({ activity: [next, ...get().activity].slice(0, ACTIVITY_LIMIT) });
	},
	setActivityUndoAvailable: (id, available) => {
		const activity = get().activity;
		const target = activity.find((item) => item.id === id);
		// A store watcher may outlive its entry (dismissed/evicted first) — a
		// stale or unchanged flip must not publish a new array and re-render.
		if (!target || target.undoAvailable === available) return;
		set({
			activity: activity.map((item) =>
				item.id === id ? { ...item, undoAvailable: available } : item,
			),
		});
	},
	dismissActivity: (id) => {
		set({ activity: get().activity.filter((item) => item.id !== id) });
	},
}));
