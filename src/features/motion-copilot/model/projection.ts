import type { MotionCopilotSessionStatus } from "@/entities/agent/model/plan-session";
import type {
	AgentCommandPlanResult,
	AgentCommandTransactionPolicy,
	AgentCommandTransactionStore,
	AgentEditPlanStepStatus,
	AgentIssue,
	AgentIssueSeverity,
	AgentIssueTargetKind,
} from "@/entities/agent/model/types";

/**
 * Pure projection of a live Agent plan/result (`entities/agent`) into Motion
 * Copilot card view-models (Creator 2, C2-L2). No feature imports, no store
 * reads, no document mutation — just typed contracts in, view-models out. The
 * widget renders these; the hook (`use-motion-copilot.ts`) supplies the live
 * session and a track-label resolver.
 */

/** Human labels for the durable command stores a plan can write. */
export const MOTION_COPILOT_STORE_LABEL: Record<
	AgentCommandTransactionStore,
	string
> = {
	scene: "Scene",
	motion: "Motion",
	"motion-grammar": "Motion Grammar",
};

/** Severity render order — errors first so a blocking issue reads at the top. */
const ISSUE_SEVERITY_ORDER: readonly AgentIssueSeverity[] = [
	"error",
	"warning",
	"info",
];

export type MotionCopilotStepView = {
	readonly id: string;
	readonly title: string;
	readonly status: AgentEditPlanStepStatus;
	readonly affectedCount: number;
};

export type MotionCopilotAffectedGroup = {
	readonly kind: AgentIssueTargetKind;
	readonly count: number;
};

export type MotionCopilotStoreCount = {
	readonly store: AgentCommandTransactionStore;
	readonly label: string;
	readonly commandCount: number;
};

export type MotionCopilotIssueGroup = {
	readonly severity: AgentIssueSeverity;
	readonly issues: readonly AgentIssue[];
};

export type MotionCopilotPlanCard = {
	readonly planId: string;
	readonly intent: string;
	readonly ready: boolean;
	readonly blockedReason: string | null;
	readonly steps: readonly MotionCopilotStepView[];
	readonly affectedByKind: readonly MotionCopilotAffectedGroup[];
	readonly storeCounts: readonly MotionCopilotStoreCount[];
	readonly issueGroups: readonly MotionCopilotIssueGroup[];
	/** One-line summary of the compound Undo boundary this plan would create. */
	readonly undoBoundaryLine: string;
	readonly crossStoreUndo: AgentCommandTransactionPolicy["crossStoreUndo"];
};

export type MotionCopilotFocusableTrack = {
	readonly trackId: string;
	readonly label: string;
};

export type MotionCopilotAppliedStore = {
	readonly store: AgentCommandTransactionStore;
	readonly label: string;
	readonly commandCount: number;
	readonly changed: boolean;
	readonly affectedCount: number;
};

export type MotionCopilotAppliedCard = {
	readonly changed: boolean;
	readonly stores: readonly MotionCopilotAppliedStore[];
	readonly focusableTracks: readonly MotionCopilotFocusableTrack[];
};

export type MotionCopilotView = {
	readonly status: MotionCopilotSessionStatus;
	readonly planCard: MotionCopilotPlanCard | null;
	readonly appliedCard: MotionCopilotAppliedCard | null;
	readonly rejectionNote: string | null;
	readonly undoAvailable: boolean;
	readonly appliedHistoryCount: number;
	/**
	 * The displayed proposal was built against a document that has since drifted
	 * (C2-L4). True only while a proposal is `proposed` and its recorded
	 * `contextRevision` no longer matches the live one. A stale plan cannot be
	 * applied optimistically — the panel offers Replan/Discard instead of Apply,
	 * and the apply spine's fresh re-validation remains the last line of defense.
	 */
	readonly stale: boolean;
};

const groupAffectedByKind = (
	result: AgentCommandPlanResult,
): readonly MotionCopilotAffectedGroup[] => {
	const counts = new Map<AgentIssueTargetKind, number>();
	for (const target of result.affected) {
		counts.set(target.kind, (counts.get(target.kind) ?? 0) + 1);
	}
	return [...counts.entries()].map(([kind, count]) => ({ kind, count }));
};

const groupIssuesBySeverity = (
	issues: readonly AgentIssue[],
): readonly MotionCopilotIssueGroup[] =>
	ISSUE_SEVERITY_ORDER.flatMap((severity) => {
		const matching = issues.filter((issue) => issue.severity === severity);
		return matching.length > 0 ? [{ severity, issues: matching }] : [];
	});

const undoBoundaryLine = (policy: AgentCommandTransactionPolicy): string => {
	const total = policy.entries.reduce(
		(sum, entry) => sum + entry.commandCount,
		0,
	);
	if (policy.entries.length === 0) return "No durable command to undo.";
	if (policy.crossStoreUndo === "compound-command-stores") {
		const stores = policy.entries
			.map((entry) => MOTION_COPILOT_STORE_LABEL[entry.store])
			.join(" + ");
		return `One Undo reverts all ${total} command${
			total === 1 ? "" : "s"
		} across ${stores} together.`;
	}
	const entry = policy.entries[0];
	const label = entry ? MOTION_COPILOT_STORE_LABEL[entry.store] : "";
	return `One Undo reverts ${total} ${label} command${total === 1 ? "" : "s"}.`;
};

/** Projects the plan/review half of a result into the plan card. */
export const projectPlanCard = (
	result: AgentCommandPlanResult,
): MotionCopilotPlanCard => ({
	planId: result.planId,
	intent: result.intent,
	ready: result.ready,
	blockedReason: result.blockedReason ?? null,
	steps: result.plan.steps.map((step) => ({
		id: step.id,
		title: step.title,
		status: step.status,
		affectedCount: step.affected.length,
	})),
	affectedByKind: groupAffectedByKind(result),
	storeCounts: result.transactionPolicy.entries.map((entry) => ({
		store: entry.store,
		label: MOTION_COPILOT_STORE_LABEL[entry.store],
		commandCount: entry.commandCount,
	})),
	issueGroups: groupIssuesBySeverity(result.issues),
	undoBoundaryLine: undoBoundaryLine(result.transactionPolicy),
	crossStoreUndo: result.transactionPolicy.crossStoreUndo,
});

/**
 * The motion-track ids a successful apply touched, in apply order, deduplicated.
 * These are the "Open in Graph" candidates — motion-track affected targets from
 * `appliedCommands` (the canonical post-apply mapping; validate-time created ids
 * are never chained here).
 */
export const appliedFocusableTrackIds = (
	result: AgentCommandPlanResult,
): readonly string[] => {
	const seen = new Set<string>();
	const ids: string[] = [];
	for (const applied of result.appliedCommands) {
		for (const target of applied.affected) {
			if (target.kind !== "motion-track" || !target.id) continue;
			if (seen.has(target.id)) continue;
			seen.add(target.id);
			ids.push(target.id);
		}
	}
	return ids;
};

/**
 * Projects the applied half of a result into the applied card. `resolveFocusTrack`
 * maps an affected motion-track id to a live, graph-focusable track (its real live
 * id + display label), or null if no live track matches (fail closed — a vanished
 * or unresolvable track is dropped, so "Open in Graph" never points at a stale
 * id). The affected id may be a real track id OR a synthetic `nodeId:property`
 * address for a freshly-created track, so the resolver — not this projection —
 * owns that lookup against the live MotionDocument. Returns null when nothing
 * applied.
 */
export const projectAppliedCard = (
	result: AgentCommandPlanResult,
	resolveFocusTrack: (affectedId: string) => MotionCopilotFocusableTrack | null,
): MotionCopilotAppliedCard | null => {
	if (!result.applied || result.appliedCommands.length === 0) return null;
	const focusableTracks: MotionCopilotFocusableTrack[] = [];
	const seen = new Set<string>();
	for (const affectedId of appliedFocusableTrackIds(result)) {
		const track = resolveFocusTrack(affectedId);
		if (!track || seen.has(track.trackId)) continue;
		seen.add(track.trackId);
		focusableTracks.push(track);
	}
	return {
		changed: result.changed,
		stores: result.appliedCommands.map((applied) => ({
			store: applied.store,
			label: MOTION_COPILOT_STORE_LABEL[applied.store],
			commandCount: applied.commandCount,
			changed: applied.changed,
			affectedCount: applied.affected.length,
		})),
		focusableTracks,
	};
};
