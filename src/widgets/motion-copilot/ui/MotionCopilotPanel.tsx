import {
	ArrowClockwise,
	ArrowUUpLeft,
	ChartLine,
	CheckCircle,
	CircleNotch,
	PaperPlaneRight,
	Sparkle,
	Warning,
	X,
} from "@phosphor-icons/react";
import { useCallback, useRef, useState } from "react";
import type { AgentCommandPlanRequest } from "@/entities/agent/model/types";
import type { AgentBridgeStatus } from "@/features/agent/model/approval-store";
import { useAgentBridgeStore } from "@/features/agent/model/approval-store";
import {
	applyWithActivityTracking,
	validateWithSessionTracking,
} from "@/features/agent/model/editor-bridge";
import { globalUndo } from "@/features/history/model/undo-coordinator";
import { useTransportStore } from "@/features/motion/model/transport-store";
import {
	type ComposerSelectionContext,
	type MotionComposer,
	type MotionComposerStatus,
	type MotionCopilotPlanCard,
	type MotionCopilotView,
	useMotionComposer,
	useMotionCopilot,
} from "@/features/motion-copilot/model";
import { useSelectionStore } from "@/features/selection/model/store";
import { useEditorChromeStore } from "@/shared/editor-chrome/model/store";
import { usePanelResize } from "@/shared/editor-chrome/model/use-panel-resize";
import { cn } from "@/shared/lib/cn";
import { PanelResizeHandle } from "@/shared/ui/PanelResizeHandle";

const BRIDGE_STATUS_LABEL: Record<AgentBridgeStatus, string> = {
	idle: "Bridge idle",
	connecting: "Connecting…",
	connected: "Bridge connected",
	disconnected: "Bridge offline",
};

const bridgeDotClass = (status: AgentBridgeStatus): string => {
	if (status === "connected") return "bg-accent";
	if (status === "connecting") return "bg-fg-secondary";
	return "bg-fg-subtle";
};

const planStatusLabel = (view: MotionCopilotView): string => {
	if (view.stale && view.status === "proposed") return "Stale";
	switch (view.status) {
		case "proposed":
			return view.planCard?.ready ? "Ready to apply" : "Blocked";
		case "applying":
			return "Applying…";
		case "applied":
			return "Applied";
		case "rejected":
			return "Rejected";
		case "superseded":
			return "Superseded";
	}
};

const planStatusToneClass = (view: MotionCopilotView): string => {
	if (view.stale && view.status === "proposed")
		return "border-warn/45 text-warn-fg";
	if (view.status === "applied") return "border-accent/45 text-accent-fg";
	if (view.status === "rejected") return "border-danger/45 text-danger-fg";
	if (view.status === "proposed" && !view.planCard?.ready)
		return "border-danger/45 text-danger-fg";
	return "border-white/12 text-fg-secondary";
};

const SECTION_LABEL_CLASS = "text-fg-subtle text-ui uppercase tracking-wide";

function PlanCardBody({ card }: { readonly card: MotionCopilotPlanCard }) {
	return (
		<div className="space-y-3">
			<div className="space-y-1">
				<div className={SECTION_LABEL_CLASS}>Intent</div>
				<p className="text-fg text-ui">{card.intent}</p>
			</div>

			{card.steps.length > 0 ? (
				<div className="space-y-1">
					<div className={SECTION_LABEL_CLASS}>Plan steps</div>
					<ul className="space-y-1">
						{card.steps.map((step) => (
							<li
								key={step.id}
								className="flex items-center gap-2 rounded border border-white/8 bg-black/15 px-2 py-1 text-ui"
							>
								<span
									className={cn(
										"size-1.5 shrink-0 rounded-full",
										step.status === "ready" ? "bg-accent" : "bg-danger",
									)}
									aria-hidden="true"
								/>
								<span className="min-w-0 flex-1 truncate text-fg-secondary">
									{step.title}
								</span>
								{step.affectedCount > 0 ? (
									<span className="shrink-0 font-mono text-fg-muted">
										{step.affectedCount}
									</span>
								) : null}
							</li>
						))}
					</ul>
				</div>
			) : null}

			{card.storeCounts.length > 0 ? (
				<div className="space-y-1">
					<div className={SECTION_LABEL_CLASS}>Command stores</div>
					<div className="flex flex-wrap gap-1">
						{card.storeCounts.map((store) => (
							<span
								key={store.store}
								className="rounded border border-white/10 bg-black/15 px-1.5 py-0.5 text-fg-secondary text-ui"
							>
								{store.label}
								<span className="ml-1 font-mono text-fg-muted">
									{store.commandCount}
								</span>
							</span>
						))}
					</div>
				</div>
			) : null}

			{card.affectedByKind.length > 0 ? (
				<div className="space-y-1">
					<div className={SECTION_LABEL_CLASS}>Affected targets</div>
					<div className="flex flex-wrap gap-1">
						{card.affectedByKind.map((group) => (
							<span
								key={group.kind}
								className="rounded border border-white/10 bg-black/15 px-1.5 py-0.5 text-fg-muted text-ui"
							>
								{group.kind}
								<span className="ml-1 font-mono text-fg-secondary">
									{group.count}
								</span>
							</span>
						))}
					</div>
				</div>
			) : null}

			{card.issueGroups.length > 0 ? (
				<div className="space-y-1">
					<div className={SECTION_LABEL_CLASS}>Warnings</div>
					<ul className="space-y-1">
						{card.issueGroups.flatMap((group) =>
							group.issues.map((issue) => (
								<li
									key={`${group.severity}:${issue.code}:${issue.message}`}
									className={cn(
										"flex items-start gap-1.5 rounded border px-2 py-1 text-ui",
										group.severity === "error"
											? "border-danger/40 text-danger-fg"
											: "border-white/12 text-fg-secondary",
									)}
								>
									<Warning
										aria-hidden="true"
										size={12}
										className="mt-0.5 shrink-0"
									/>
									<span className="min-w-0 flex-1">{issue.message}</span>
								</li>
							)),
						)}
					</ul>
				</div>
			) : null}

			<p className="text-fg-muted text-ui">{card.undoBoundaryLine}</p>
		</div>
	);
}

const composerStatusMessage = (
	status: MotionComposerStatus,
): { readonly tone: "info" | "danger"; readonly text: string } | null => {
	switch (status.kind) {
		case "idle":
		case "planning":
			return null;
		case "unsupported":
			return { tone: "info", text: status.reason };
		case "clarification":
			return { tone: "info", text: status.question };
		case "quota_exceeded": {
			const scope = status.window === "month" ? "Monthly" : "Daily";
			const retry = status.window === "month" ? "next month" : "tomorrow";
			return {
				tone: "danger",
				text: status.limit
					? `${scope} motion planning limit reached (${status.limit}). Try again ${retry}.`
					: `${scope} motion planning limit reached. Try again ${retry}.`,
			};
		}
		case "unauthenticated":
			return { tone: "danger", text: "Sign in to plan motion from a prompt." };
		case "plan_required":
			return {
				tone: "danger",
				text: "An active Creator plan is required to plan motion from a prompt.",
			};
		case "disabled":
			return {
				tone: "info",
				text: "Prompt-to-plan is not enabled in this environment.",
			};
		case "invalid":
			return {
				tone: "danger",
				text: "The planning request was rejected. Try rephrasing.",
			};
		case "provider_unavailable":
			return { tone: "danger", text: status.message };
		case "no_context":
			return {
				tone: "danger",
				text: "Open an artboard before planning motion.",
			};
	}
};

/**
 * The native prompt composer region (Creator 2, C2-L3). Lives inside the Loop 2
 * panel: the user types motion language, and a validated candidate plan is handed
 * to the same plan session the bridge feeds — review/apply/Graph/Undo are the
 * existing spine. The document is never touched on a planning failure, cancel, or
 * unsupported request.
 */
function ComposerRegion({ composer }: { readonly composer: MotionComposer }) {
	const planning = composer.status.kind === "planning";
	// C2-R2: a signed-in user without an active paid Creator entitlement cannot
	// submit; the honest state routes to the existing account/billing surface.
	const planRequired = composer.status.kind === "plan_required";
	const requestAccountMenuOpen = useEditorChromeStore(
		(state) => state.requestAccountMenuOpen,
	);
	const message = composerStatusMessage(composer.status);
	const canSubmit =
		composer.prompt.trim().length > 0 && !planning && !planRequired;

	return (
		<div className="space-y-2 rounded border border-white/10 bg-black/15 p-2">
			<label className="sr-only" htmlFor="motion-copilot-prompt">
				Describe the motion to author
			</label>
			<textarea
				id="motion-copilot-prompt"
				value={composer.prompt}
				onChange={(event) => composer.setPrompt(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
						event.preventDefault();
						if (canSubmit) composer.submit();
					}
				}}
				disabled={planning}
				rows={2}
				placeholder="Describe the motion — e.g. “ease the logo in over 12 frames, then settle”"
				className="chrome-scrollbar-thin w-full resize-none rounded border border-white/10 bg-black/20 px-2 py-1.5 text-fg text-ui placeholder:text-fg-subtle focus-visible:border-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60 disabled:opacity-60"
			/>
			<div className="flex items-center gap-2">
				{planning ? (
					<button
						type="button"
						onClick={composer.cancel}
						className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded border border-white/12 bg-black/20 px-2 text-fg-secondary text-ui transition hover:border-white/25 hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/70"
					>
						<CircleNotch
							aria-hidden="true"
							size={13}
							className="animate-spin"
						/>
						Planning… Cancel
					</button>
				) : (
					<button
						type="button"
						onClick={() => composer.submit()}
						disabled={!canSubmit}
						className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded border border-accent/55 bg-accent-surface px-2 text-accent-fg text-ui transition hover:border-accent disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/70"
					>
						<PaperPlaneRight aria-hidden="true" size={13} />
						Plan motion
					</button>
				)}
				{composer.remaining !== null ? (
					<span className="shrink-0 text-fg-subtle text-ui">
						{composer.remaining} left today
					</span>
				) : null}
			</div>
			{message ? (
				<div
					className={cn(
						"flex items-start gap-1.5 rounded border px-2 py-1 text-ui",
						message.tone === "danger"
							? "border-danger/40 text-danger-fg"
							: "border-white/12 text-fg-secondary",
					)}
				>
					<Warning aria-hidden="true" size={12} className="mt-0.5 shrink-0" />
					<span className="min-w-0 flex-1">{message.text}</span>
					{planRequired ? (
						<button
							type="button"
							onClick={requestAccountMenuOpen}
							className="shrink-0 rounded border border-accent/55 px-1.5 py-0.5 font-medium text-accent-fg text-ui leading-none transition hover:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/70"
						>
							Upgrade
						</button>
					) : null}
					<button
						type="button"
						aria-label="Dismiss"
						onClick={composer.dismiss}
						className="shrink-0 text-fg-subtle hover:text-fg"
					>
						<X aria-hidden="true" size={11} />
					</button>
				</div>
			) : null}
		</div>
	);
}

/**
 * The persistent Motion Copilot panel (Creator 2, C2-L2). A stable editor
 * surface that renders a live Agent plan at authoring depth — intent, steps,
 * affected targets, per-store command counts, warnings, and the compound Undo
 * boundary — then routes review → apply → applied delta → Open in Graph → Undo
 * through native state. It composes BOTH features: approve/reject resolve the
 * SAME `features/agent` bridge approval slot the ambient banner uses (no second
 * decision point), Undo dispatches the reused global compound-undo mechanism,
 * and Open in Graph requests an editor-chrome graph-focus intent for an applied
 * motion track. It never blankets the canvas.
 */
export function MotionCopilotPanel() {
	const { view, openInGraph, discardProposal, close } = useMotionCopilot();
	const resize = usePanelResize("motion-copilot");
	const bridgeStatus = useAgentBridgeStore((state) => state.status);
	const pending = useAgentBridgeStore((state) => state.pending);
	const approve = useAgentBridgeStore((state) => state.approve);
	const reject = useAgentBridgeStore((state) => state.reject);

	// Native composer wiring (C2-L3). The widget composes both features that the
	// feature layer may not import each other's: it reads the live selection
	// (features/selection) + playhead (features/motion) for the projection, and it
	// runs features/agent validate/apply against the entities/agent plan session.
	const [composerPlanId, setComposerPlanId] = useState<string | null>(null);
	const latestRequestRef = useRef<AgentCommandPlanRequest | null>(null);
	const repairUsedRef = useRef(false);
	const composerSubmitRef = useRef<MotionComposer["submit"]>(() => undefined);

	const getSelectionContext = useCallback((): ComposerSelectionContext => {
		const nodeIds = useSelectionStore.getState().nodeIds;
		return {
			nodeIds,
			// Primary is the last-selected node by the editor's convention.
			...(nodeIds.length > 0
				? { primaryNodeId: nodeIds[nodeIds.length - 1] }
				: {}),
			playheadFrame: useTransportStore.getState().currentFrame,
		};
	}, []);

	const onPlanReady = useCallback(
		(
			request: AgentCommandPlanRequest,
			meta: { readonly isRepair: boolean; readonly contextRevision: string },
		) => {
			if (!meta.isRepair) repairUsedRef.current = false;
			latestRequestRef.current = request;
			setComposerPlanId(request.planId);
			// Validate against the live document and record the proposal into the
			// SAME Loop 2 plan session the bridge feeds (never a second truth). Stamp
			// the revision the projection was BUILT against so a document change during
			// the provider round-trip is caught as staleness (C2-L4).
			const review = validateWithSessionTracking(request, meta.contextRevision);
			const errorIssues = review.issues.filter(
				(issue) => issue.severity === "error",
			);
			// One bounded repair round: if the candidate failed compile with
			// error-severity issues, re-send once with them attached. A second
			// failure surfaces the blocked plan honestly in the panel (no loop).
			if (errorIssues.length > 0 && !repairUsedRef.current) {
				repairUsedRef.current = true;
				composerSubmitRef.current({
					repairIssues: errorIssues.map((issue) => issue.message),
				});
			}
		},
		[],
	);

	const composer = useMotionComposer({ getSelectionContext, onPlanReady });
	composerSubmitRef.current = composer.submit;

	// The panel's Approve/Reject resolve the SAME single bridge approval slot —
	// only when the pending decision is the edit-plan this panel is displaying.
	const matchedPending =
		pending?.kind === "edit-plan" &&
		view?.planCard &&
		pending.id === view.planCard.planId
			? pending
			: null;

	// Staleness (C2-L4): a displayed proposal whose build-time context has drifted
	// is never applied optimistically — Apply is suppressed and the panel offers
	// Replan/Discard. The apply spine's fresh re-validation remains the last line of
	// defense even so.
	const stale = view?.stale === true && view.status === "proposed";
	// Replan re-sends the SAME intent against a FRESH projection — but only for a
	// composer-originated plan (the panel owns that transport). A bridge plan has no
	// panel-drivable re-plan, so its stale card offers Discard only (per contract §4:
	// bridge plans get staleness treatment "at display time", not a working Replan).
	const isComposerPlan = view?.planCard?.planId === composerPlanId;
	const canReplan = stale && isComposerPlan;

	// A composer-originated proposal applies through the panel's explicit Apply
	// action (the manual approve path — no bridge auto-approve). Gated on the
	// displayed proposal being this composer's ready plan with no pending bridge
	// decision (so a bridge bare-validate is never mistaken for a composer plan) and
	// not stale.
	const composerApplyReady =
		!matchedPending &&
		!stale &&
		view?.status === "proposed" &&
		view.planCard?.ready === true &&
		view.planCard.planId === composerPlanId;

	const applyComposerPlan = useCallback(() => {
		const request = latestRequestRef.current;
		if (!request || request.planId !== composerPlanId) return;
		applyWithActivityTracking({
			...request,
			approval: { approved: true, reviewer: "motion-copilot-composer" },
		});
	}, [composerPlanId]);

	const replanStalePlan = useCallback(() => {
		const intent = view?.planCard?.intent;
		if (!intent) return;
		// Drop the stale card, then re-plan the same intent against the fresh
		// document. The composer mirrors the intent into the prompt box.
		discardProposal();
		composer.submit({ intentOverride: intent });
	}, [view?.planCard?.intent, discardProposal, composer]);

	const discardStalePlan = useCallback(() => {
		// Keep the bridge approval slot and the panel in sync: a stale bridge plan
		// with a pending human approval is rejected as it is discarded.
		if (matchedPending) reject();
		discardProposal();
	}, [matchedPending, reject, discardProposal]);

	return (
		<aside className="motion-copilot-panel relative flex flex-col overflow-hidden rounded-md border border-white/10 bg-surface-raised/88 shadow-2xl shadow-black/35 backdrop-blur-xl">
			<header className="flex h-10 shrink-0 items-center gap-2 border-white/10 border-b px-3">
				<Sparkle aria-hidden="true" size={15} className="text-accent-fg" />
				<span className="text-fg text-ui">Motion Copilot</span>
				<span className="flex items-center gap-1.5">
					<span
						className={cn(
							"size-1.5 rounded-full",
							bridgeDotClass(bridgeStatus),
						)}
						aria-hidden="true"
					/>
					<span className="text-fg-muted text-ui">
						{BRIDGE_STATUS_LABEL[bridgeStatus]}
					</span>
				</span>
				<button
					type="button"
					aria-label="Close Motion Copilot"
					title="Close Motion Copilot"
					onClick={close}
					className="ml-auto grid size-6 place-items-center rounded border border-white/10 bg-black/15 text-fg-muted transition hover:border-white/20 hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/70"
				>
					<X aria-hidden="true" size={12} />
				</button>
			</header>

			<div className="chrome-scrollbar-thin min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden px-3 py-3">
				<ComposerRegion composer={composer} />
				{view ? (
					<div className="space-y-3">
						<div className="flex items-center gap-2">
							<span
								className={cn(
									"rounded border px-1.5 py-0.5 font-medium text-ui",
									planStatusToneClass(view),
								)}
							>
								{planStatusLabel(view)}
							</span>
							{view.appliedHistoryCount > 0 ? (
								<span className="text-fg-subtle text-ui">
									{view.appliedHistoryCount} applied this session
								</span>
							) : null}
						</div>

						{stale ? (
							<div className="flex items-start gap-1.5 rounded border border-warn/45 bg-warn-surface/40 px-2 py-1.5 text-ui text-warn-fg">
								<Warning
									aria-hidden="true"
									size={13}
									className="mt-0.5 shrink-0"
								/>
								<span className="min-w-0 flex-1">
									The document changed since this plan was proposed
									{isComposerPlan
										? " — replan against the current document, or discard it."
										: " — discard it and prompt again."}
								</span>
							</div>
						) : null}

						{view.planCard ? <PlanCardBody card={view.planCard} /> : null}

						{view.planCard?.blockedReason ? (
							<div className="flex items-start gap-1.5 rounded border border-danger/40 bg-danger-surface/40 px-2 py-1.5 text-danger-fg text-ui">
								<Warning
									aria-hidden="true"
									size={13}
									className="mt-0.5 shrink-0"
								/>
								<span className="min-w-0 flex-1">
									{view.planCard.blockedReason}
								</span>
							</div>
						) : null}

						{view.status === "rejected" && view.rejectionNote ? (
							<p className="text-fg-muted text-ui">{view.rejectionNote}</p>
						) : null}

						{view.appliedCard ? (
							<div className="space-y-2 rounded border border-accent/30 bg-accent-surface/25 px-2 py-2">
								<div className="flex items-center gap-1.5 text-accent-fg text-ui">
									<CheckCircle aria-hidden="true" size={13} />
									<span className="font-medium">
										{view.appliedCard.changed
											? "Applied to the document"
											: "Applied (no document change)"}
									</span>
								</div>
								<div className="flex flex-wrap gap-1">
									{view.appliedCard.stores.map((store) => (
										<span
											key={store.store}
											className="rounded border border-white/10 bg-black/15 px-1.5 py-0.5 text-fg-secondary text-ui"
										>
											{store.label}
											<span className="ml-1 font-mono text-fg-muted">
												{store.commandCount}
											</span>
											{!store.changed ? (
												<span className="ml-1 text-fg-subtle">·no-op</span>
											) : null}
										</span>
									))}
								</div>
								{view.appliedCard.focusableTracks.length > 0 ? (
									<div className="space-y-1">
										<div className={SECTION_LABEL_CLASS}>
											Open affected track in Graph
										</div>
										<div className="flex flex-wrap gap-1">
											{view.appliedCard.focusableTracks.map((track) => (
												<button
													key={track.trackId}
													type="button"
													onClick={() => openInGraph(track.trackId)}
													title={`Open ${track.label} in the Value / Speed Graph`}
													className="flex items-center gap-1 rounded border border-white/10 bg-black/15 px-1.5 py-0.5 text-fg-secondary text-ui transition hover:border-accent/50 hover:text-accent-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/70"
												>
													<ChartLine aria-hidden="true" size={12} />
													<span className="min-w-0 max-w-40 truncate">
														{track.label}
													</span>
												</button>
											))}
										</div>
									</div>
								) : null}
							</div>
						) : null}
					</div>
				) : (
					<div className="space-y-1 text-ui">
						<p className="text-fg-secondary">No motion plan yet.</p>
						<p className="text-fg-muted">
							Propose a motion plan through the Agent bridge to review it here
							at authoring depth, then apply it as native keyframes.
						</p>
					</div>
				)}
			</div>

			{view ? (
				<footer className="flex shrink-0 items-center gap-2 border-white/10 border-t px-3 py-2">
					{stale ? (
						<>
							{canReplan ? (
								<button
									type="button"
									onClick={replanStalePlan}
									className="flex h-7 flex-1 items-center justify-center gap-1 rounded border border-accent/55 bg-accent-surface px-2 text-accent-fg text-ui transition hover:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/70"
								>
									<ArrowClockwise aria-hidden="true" size={13} />
									Replan
								</button>
							) : null}
							<button
								type="button"
								onClick={discardStalePlan}
								className={cn(
									"flex h-7 items-center justify-center gap-1 rounded border border-white/12 bg-black/15 px-2 text-fg-secondary text-ui transition hover:border-danger/50 hover:text-danger-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/70",
									canReplan ? "" : "flex-1",
								)}
							>
								<X aria-hidden="true" size={12} />
								Discard
							</button>
						</>
					) : matchedPending ? (
						<>
							<button
								type="button"
								onClick={approve}
								className="flex h-7 flex-1 items-center justify-center gap-1 rounded border border-accent/55 bg-accent-surface px-2 text-accent-fg text-ui transition hover:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/70"
							>
								<CheckCircle aria-hidden="true" size={13} />
								Approve &amp; apply
							</button>
							<button
								type="button"
								onClick={reject}
								className="flex h-7 items-center justify-center gap-1 rounded border border-danger/40 bg-danger-surface/40 px-2 text-danger-fg text-ui transition hover:border-danger/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/70"
							>
								<X aria-hidden="true" size={12} />
								Reject
							</button>
						</>
					) : composerApplyReady ? (
						<button
							type="button"
							onClick={applyComposerPlan}
							className="flex h-7 flex-1 items-center justify-center gap-1 rounded border border-accent/55 bg-accent-surface px-2 text-accent-fg text-ui transition hover:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/70"
						>
							<CheckCircle aria-hidden="true" size={13} />
							Apply plan
						</button>
					) : view.status === "applied" ? (
						<button
							type="button"
							onClick={globalUndo}
							disabled={!view.undoAvailable}
							title={
								view.undoAvailable
									? "Undo the applied plan as one step"
									: "The applied plan is no longer the most recent edit"
							}
							className="flex h-7 items-center justify-center gap-1 rounded border border-white/12 bg-black/15 px-2 text-fg-secondary text-ui transition hover:border-accent/50 hover:text-accent-fg disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/70"
						>
							<ArrowUUpLeft aria-hidden="true" size={13} />
							Undo
						</button>
					) : (
						<span className="text-fg-subtle text-ui">
							{view.status === "proposed" && view.planCard?.ready
								? "Awaiting approval in the bridge checkpoint."
								: view.status === "applying"
									? "Applying the plan…"
									: "No action available."}
						</span>
					)}
				</footer>
			) : null}

			<PanelResizeHandle panelName="Motion Copilot" {...resize} />
		</aside>
	);
}
