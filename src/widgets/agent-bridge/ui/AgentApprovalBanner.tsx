import { X } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import type { AgentBridgeActivityEntry } from "@/features/agent/model/approval-store";
import { useAgentBridgeStore } from "@/features/agent/model/approval-store";
import { undoAgentBridgeActivity } from "@/features/agent/model/editor-bridge";
import { pruneOrphanedMotion } from "@/features/agent/model/orphan-motion";
import { repairLegacyPathBlurSeeds } from "@/features/look-authoring/model/legacy-path-blur-repair";

/** Auto-dismiss delay for a non-blocking activity toast. */
const ACTIVITY_TOAST_DISMISS_MS = 7_000;
/** Max activity toasts shown at once (the store itself caps the underlying log at 5; the banner narrows further so old auto-applies don't crowd the decision slot). */
const ACTIVITY_TOAST_VISIBLE_LIMIT = 3;

const STORE_KIND_LABEL: Record<AgentBridgeActivityEntry["storeKind"], string> =
	{
		scene: "シーン編集",
		motion: "モーション編集",
		"motion-grammar": "モーショングラマー編集",
	};

/**
 * One non-blocking "an auto-applied edit just landed" toast. Unlike the
 * pending decision cards in {@link AgentApprovalBanner}, this never blocks —
 * it self-dismisses after {@link ACTIVITY_TOAST_DISMISS_MS} unless the human
 * dismisses it first. Only the newest entry *per command store* gets the Undo
 * affordance (`isNewestForStore`): undoing an older auto-applied entry while a
 * newer one sits on top of the *same* store's stack would undo the wrong edit,
 * but an entry for a different store stays undoable — its own stack top is
 * still this entry's transaction (validity is additionally gated per entry by
 * `undoAvailable`, which watches the owning store).
 */
function ActivityToast({
	entry,
	isNewestForStore,
	onDismiss,
}: {
	readonly entry: AgentBridgeActivityEntry;
	readonly isNewestForStore: boolean;
	readonly onDismiss: (id: string) => void;
}) {
	const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		dismissTimer.current = setTimeout(() => {
			onDismiss(entry.id);
		}, ACTIVITY_TOAST_DISMISS_MS);
		return () => {
			if (dismissTimer.current) clearTimeout(dismissTimer.current);
		};
	}, [entry.id, onDismiss]);

	return (
		<div
			className="pointer-events-auto flex items-center gap-3 rounded-lg border border-hairline bg-surface-raised/95 px-3 py-2 text-ui shadow-2xl shadow-scrim/55 backdrop-blur-xl"
			role="status"
		>
			<div className="min-w-0 flex-1">
				<span className="min-w-0 truncate text-fg">{entry.intent}</span>
				<div className="mt-0.5 text-fg-muted">
					{[
						`${STORE_KIND_LABEL[entry.storeKind]} ${entry.commandCount}件適用`,
						entry.warningCount > 0 ? `警告 ${entry.warningCount}` : null,
					]
						.filter((part): part is string => part !== null)
						.join(" · ")}
				</div>
			</div>
			{isNewestForStore && entry.undoAvailable ? (
				<button
					type="button"
					onClick={() => {
						undoAgentBridgeActivity(entry.storeKind);
						onDismiss(entry.id);
					}}
					className="shrink-0 rounded border border-hairline px-2 py-1 text-fg-secondary hover:bg-surface-sunken"
				>
					取り消す
				</button>
			) : null}
			<button
				type="button"
				aria-label="通知を閉じる"
				onClick={() => onDismiss(entry.id)}
				className="grid size-5 shrink-0 place-items-center rounded border border-white/10 bg-white/5 text-fg-secondary hover:bg-white/10 hover:text-white"
			>
				<X aria-hidden="true" size={11} />
			</button>
		</div>
	);
}

/**
 * Transient human checkpoints for the live agent bridge: the orphaned-motion
 * repair prompt, the legacy auto-seeded Path Blur repair prompt, the
 * edit-approval gate, and non-blocking auto-apply activity toasts. The first
 * three demand a decision now, so they earn the prominent bottom-center slot —
 * lifted clear of the tool-rail and timeline controls; activity toasts share
 * the slot but never block (they auto-dismiss and never withhold a `承認`/`却下`
 * choice from the human).
 *
 * Persistent bridge status (the session id + connect config, and any connection
 * error) lives in the ambient {@link McpBridgeChip} in the top chrome instead,
 * so this slot never blankets the bottom controls. The wrapper is
 * `pointer-events-none`; only each card takes pointer events.
 */
export function AgentApprovalBanner() {
	const pending = useAgentBridgeStore((state) => state.pending);
	const documentHealth = useAgentBridgeStore((state) => state.documentHealth);
	const legacyPathBlurSeeds = useAgentBridgeStore(
		(state) => state.legacyPathBlurSeeds,
	);
	const activity = useAgentBridgeStore((state) => state.activity);
	const approve = useAgentBridgeStore((state) => state.approve);
	const reject = useAgentBridgeStore((state) => state.reject);
	const setAutoApplyEdits = useAgentBridgeStore(
		(state) => state.setAutoApplyEdits,
	);
	const dismissActivity = useAgentBridgeStore((state) => state.dismissActivity);

	const visibleActivity = activity.slice(0, ACTIVITY_TOAST_VISIBLE_LIMIT);
	const documentHealthDetail = documentHealth
		? [
				documentHealth.trackCount > 0
					? `motion ${documentHealth.trackCount}`
					: null,
				documentHealth.bindingCount > 0
					? `grammar ${documentHealth.bindingCount}`
					: null,
			]
				.filter((part): part is string => part !== null)
				.join(" · ")
		: "";

	if (
		!pending &&
		!documentHealth &&
		!legacyPathBlurSeeds &&
		visibleActivity.length === 0
	) {
		return null;
	}

	// A document-timing compound (`documentCommandCount > 0`) is always sent
	// isolated from scene/motion/grammar commands (`review-apply.ts`'s
	// `documentTimingIsolationIssue` blocks the plan before approval otherwise),
	// so `sceneCommandCount`/`motionCommandCount` never carry independent
	// request-level writes alongside it — they would otherwise underreport (scene
	// stays 0 because the write is compiled from `documentCommands`, not
	// `sceneCommands`) or duplicate the same compound (motion's count already
	// comes from the compound half). The dedicated chip below is the honest
	// summary for this case instead.
	const isDocumentTimingPlan =
		pending?.kind === "edit-plan" && pending.documentCommandCount > 0;
	const counts =
		pending?.kind === "edit-plan"
			? [
					`${pending.affectedCount} 要素`,
					isDocumentTimingPlan
						? `document ${pending.documentCommandCount} · scene+motion`
						: null,
					!isDocumentTimingPlan && pending.sceneCommandCount > 0
						? `scene ${pending.sceneCommandCount}`
						: null,
					!isDocumentTimingPlan && pending.motionCommandCount > 0
						? `motion ${pending.motionCommandCount}`
						: null,
					pending.warningCount > 0 ? `警告 ${pending.warningCount}` : null,
				]
					.filter((part): part is string => part !== null)
					.join(" · ")
			: "";
	const projectSaveDetail =
		pending?.kind === "project-save"
			? [
					pending.mode === "save-as-copy"
						? "クラウドコピーとして保存"
						: pending.mode === "save-as-new"
							? "新しいクラウドプロジェクトとして保存"
							: pending.activeProjectName
								? "現在のクラウドプロジェクトを更新"
								: "新しいクラウドプロジェクトとして保存",
					pending.projectName,
				].join(" · ")
			: "";

	return (
		<div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4">
			<div className="flex w-full max-w-lg flex-col gap-2">
				{documentHealth ? (
					<div
						className="pointer-events-auto flex items-center gap-3 rounded-lg border border-hairline bg-surface-raised/95 px-3 py-2 text-ui shadow-2xl shadow-scrim/55 backdrop-blur-xl"
						role="status"
					>
						<div className="min-w-0 flex-1">
							<span className="font-medium text-fg">
								削除済み要素を参照するモーション
							</span>
							<span className="text-fg-muted"> ({documentHealth.count})</span>
							<div className="mt-0.5 text-fg-muted">
								{documentHealthDetail
									? `${documentHealthDetail} · 修復するとエージェント編集を再開できます`
									: "修復するとエージェント編集を再開できます"}
							</div>
						</div>
						<button
							type="button"
							onClick={pruneOrphanedMotion}
							className="shrink-0 rounded bg-accent px-2 py-1 font-medium text-accent-fg hover:bg-accent-strong"
						>
							修復
						</button>
					</div>
				) : null}
				{legacyPathBlurSeeds ? (
					<div
						className="pointer-events-auto flex items-center gap-3 rounded-lg border border-hairline bg-surface-raised/95 px-3 py-2 text-ui shadow-2xl shadow-scrim/55 backdrop-blur-xl"
						role="status"
					>
						<div className="min-w-0 flex-1">
							<span className="font-medium text-fg">
								旧バージョンが自動追加した Path Blur
							</span>
							<span className="text-fg-muted">
								{" "}
								({legacyPathBlurSeeds.count})
							</span>
							<div className="mt-0.5 text-fg-muted">
								アートボード全体をぼかしています。修復は取り消せます
							</div>
						</div>
						<button
							type="button"
							onClick={repairLegacyPathBlurSeeds}
							className="shrink-0 rounded bg-accent px-2 py-1 font-medium text-accent-fg hover:bg-accent-strong"
						>
							修復
						</button>
					</div>
				) : null}
				{pending ? (
					<div
						className="pointer-events-auto flex items-center gap-3 rounded-lg border border-accent/45 bg-accent-surface/80 px-3 py-2 text-ui shadow-2xl shadow-scrim/55 backdrop-blur-xl"
						role="status"
					>
						<div className="min-w-0 flex-1">
							<div className="flex items-center gap-1.5">
								<span className="shrink-0 font-medium text-accent-fg">
									{pending.kind === "project-save"
										? "エージェントの保存リクエスト"
										: "エージェントの編集提案"}
								</span>
								<span className="min-w-0 truncate text-fg">
									{pending.intent}
								</span>
							</div>
							<div className="mt-0.5 text-fg-muted">
								{pending.kind === "project-save" ? projectSaveDetail : counts}
							</div>
						</div>
						<button
							type="button"
							onClick={reject}
							className="shrink-0 rounded border border-hairline px-2 py-1 text-fg-secondary hover:bg-surface-sunken"
						>
							却下
						</button>
						{pending.kind === "edit-plan" ? (
							<button
								type="button"
								onClick={() => {
									setAutoApplyEdits(true);
									approve();
								}}
								className="shrink-0 rounded border border-hairline px-2 py-1 text-fg-secondary hover:bg-surface-sunken"
							>
								承認して以後自動適用
							</button>
						) : null}
						<button
							type="button"
							onClick={approve}
							className="shrink-0 rounded bg-accent px-2 py-1 font-medium text-accent-fg hover:bg-accent-strong"
						>
							承認
						</button>
					</div>
				) : null}
				{visibleActivity.map((entry) => (
					<ActivityToast
						key={entry.id}
						entry={entry}
						isNewestForStore={
							activity.find((item) => item.storeKind === entry.storeKind)
								?.id === entry.id
						}
						onDismiss={dismissActivity}
					/>
				))}
			</div>
		</div>
	);
}
