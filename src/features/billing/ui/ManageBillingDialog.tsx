import { Dialog } from "@base-ui/react/dialog";
import { ArrowsClockwise, CreditCard, Receipt, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
	cancelSubscription,
	changeSubscriptionPlan,
	createPaymentMethodSession,
	fetchOrderInvoiceUrl,
	fetchPortalOverview,
	openPaymentMethodPopup,
	pollBillingStatusUntil,
	reactivateSubscription,
} from "../model/api";
import {
	type BillingTone,
	PAYMENT_METHOD_REQUIRED_GUIDANCE,
	type PortalChangeTarget,
	type PortalManageRow,
	type PortalPanelView,
	projectPortalOverview,
} from "../model/presentation";
import type { PortalOverviewResult } from "../model/types";
import { openPaymentMethodEmbed } from "./payment-method-embed";

const BACKDROP_CLASS =
	"fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0";

const DIALOG_CLASS =
	"fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[min(92vw,400px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-2 overflow-hidden rounded-lg border border-white/12 bg-surface-raised/98 p-3 text-fg text-ui shadow-2xl shadow-black/60 outline-none backdrop-blur-xl";

const PRIMARY_BUTTON_CLASS =
	"inline-flex h-7 items-center justify-center gap-1 rounded border border-warn/40 bg-warn-surface/92 px-2 font-medium text-ui text-warn-fg leading-none hover:bg-warn-surface/95 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-warn/60 disabled:opacity-50";

const ACCENT_BUTTON_CLASS =
	"inline-flex h-7 items-center justify-center gap-1 rounded border border-accent/45 bg-accent-surface/80 px-2 font-medium text-accent-fg text-ui leading-none hover:bg-accent-surface/90 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-accent/60 disabled:opacity-50";

const SUBTLE_BUTTON_CLASS =
	"inline-flex h-7 items-center justify-center gap-1 rounded border border-white/12 bg-white/[0.05] px-2 font-medium text-fg-secondary text-ui leading-none hover:bg-white/[0.1] hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-white/55 disabled:opacity-50";

const DANGER_BUTTON_CLASS =
	"inline-flex h-7 items-center justify-center gap-1 rounded border border-danger/35 bg-danger-surface/40 px-2 font-medium text-danger-fg text-ui leading-none hover:bg-danger-surface/55 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-danger/55 disabled:opacity-50";

const ICON_BUTTON_CLASS =
	"inline-flex size-6 items-center justify-center rounded border border-white/10 bg-white/[0.05] text-fg-secondary outline-none hover:bg-white/[0.1] hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-white/55";

const INVOICE_LINK_CLASS =
	"inline-flex items-center gap-1 rounded border border-white/10 bg-white/[0.05] px-1.5 py-0.5 text-fg-secondary text-ui leading-3 hover:bg-white/[0.1] hover:text-white disabled:opacity-50";

const toneTextClass = (tone: BillingTone): string => {
	switch (tone) {
		case "accent":
			return "text-accent-fg";
		case "success":
			return "text-fg";
		case "warning":
			return "text-warn-fg";
		case "danger":
			return "text-danger-fg";
		case "neutral":
			return "text-fg-secondary";
	}
};

/** Tone of a transient action note. */
type NoteTone = "info" | "success" | "danger";

/**
 * Per-action state: idle, a labeled busy spinner, or a terminal note. A note
 * may carry an inline `action` affordance (currently only the card-update
 * flow, for `payment_method_required`) so guidance points at its fix.
 */
type ActionState =
	| { readonly kind: "idle" }
	| { readonly kind: "busy"; readonly label: string }
	| {
			readonly kind: "note";
			readonly tone: NoteTone;
			readonly text: string;
			readonly action?: "update-card";
	  };

const noteToneClass = (tone: NoteTone): string => {
	if (tone === "success") return "border-white/12 bg-black/25 text-fg";
	if (tone === "danger")
		return "border-danger/25 bg-danger-surface/45 text-danger-fg";
	return "border-accent/25 bg-accent-surface/35 text-accent-fg";
};

/**
 * Runs the account-badge refresh on a fresh task instead of inline with a note
 * set. The refresh flips the whole TopBar entry to its loading read; performed
 * in the same commit as `set(note)` it preempts the note so it never paints.
 * Deferring lets the note commit first, then the badge refreshes underneath it.
 */
const refreshStatusSoon = (refresh: () => void): void => {
	setTimeout(refresh, 0);
};

/**
 * Loads the portal overview while the dialog is open and projects it once.
 *
 * Each open (re)fetches and aborts the prior request, so a stale read cannot win
 * after reopening. While closed nothing is fetched; the projection of `null` is
 * the loading state, which is what the dialog should show on the next open.
 * `reload` lets a mutation refresh the overview after it lands.
 */
function usePortalOverview(open: boolean): {
	readonly view: PortalPanelView;
	readonly reload: () => void;
} {
	const [result, setResult] = useState<PortalOverviewResult | null>(null);
	const controllerRef = useRef<AbortController | null>(null);

	const load = useCallback(() => {
		controllerRef.current?.abort();
		const controller = new AbortController();
		controllerRef.current = controller;
		setResult(null);
		void fetchPortalOverview(controller.signal).then((next) => {
			if (!controller.signal.aborted) setResult(next);
		});
	}, []);

	useEffect(() => {
		if (!open) return;
		load();
		return () => {
			controllerRef.current?.abort();
			controllerRef.current = null;
		};
	}, [open, load]);

	return { view: projectPortalOverview(open ? result : null), reload: load };
}

/**
 * Owns the subscription-mutation lifecycle for the manage dialog.
 *
 * Each action shows a busy label, then a calm terminal note. The crucial branch
 * is change-plan: a queued downgrade (`pendingUpdate` set) refreshes the
 * overview and stops — `/api/billing/status` will not flip until period end — so
 * it never polls into a false "still finalizing". An immediate upgrade
 * (`pendingUpdate` null) polls billing status until the new plan is reflected,
 * then refreshes the account badge via {@link onStatusChange}. Typed failure
 * states (`payment_failed`, `payment_method_required`, `subscription_locked`,
 * `changes_disabled`) map to specific copy rather than a generic error;
 * `payment_method_required` additionally offers the card-update flow inline,
 * and `changes_disabled` reloads so the capability-gated controls disappear.
 */
function usePortalActions(args: {
	readonly reload: () => void;
	readonly onStatusChange: () => void;
}): {
	readonly state: ActionState;
	readonly changesDisabled: boolean;
	readonly changePlan: (
		subscriptionId: string,
		target: PortalChangeTarget,
	) => void;
	readonly cancel: (subscriptionId: string) => void;
	readonly reactivate: (subscriptionId: string) => void;
	readonly updateCard: () => void;
	readonly openInvoice: (orderId: string) => void;
	readonly reset: () => void;
} {
	const { reload, onStatusChange } = args;
	const [state, setState] = useState<ActionState>({ kind: "idle" });
	// Latched once any mutation returns `changes_disabled`. The overview endpoint
	// reports capabilities optimistically (the org "customer-initiated changes
	// disabled" flag is not reliably observable on a read — it surfaces on the
	// write), so a fresh reload cannot hide the gated controls on its own; this
	// mutation-403 signal is authoritative and latches them off for the session.
	// It resets on the next dialog open (a deliberate re-probe), since it is hook
	// state cleared by `reset`.
	const [changesDisabled, setChangesDisabled] = useState(false);
	const mountedRef = useRef(true);
	useEffect(
		() => () => {
			mountedRef.current = false;
		},
		[],
	);
	const set = useCallback((next: ActionState) => {
		if (mountedRef.current) setState(next);
	}, []);
	const latchChangesDisabled = useCallback(() => {
		if (mountedRef.current) setChangesDisabled(true);
	}, []);

	const reset = useCallback(() => {
		set({ kind: "idle" });
		if (mountedRef.current) setChangesDisabled(false);
	}, [set]);

	const changePlan = useCallback(
		(subscriptionId: string, target: PortalChangeTarget) => {
			set({ kind: "busy", label: `Switching to ${target.label}…` });
			void changeSubscriptionPlan(subscriptionId, target.plan).then(
				async (result) => {
					if (result.kind === "payment_failed") {
						set({
							kind: "note",
							tone: "danger",
							text: "That change couldn't be charged. Check your card and try again.",
						});
						return;
					}
					if (result.kind === "payment_method_required") {
						set({
							kind: "note",
							tone: "info",
							text: PAYMENT_METHOD_REQUIRED_GUIDANCE.text,
							action: "update-card",
						});
						return;
					}
					if (result.kind === "subscription_locked") {
						reload();
						set({
							kind: "note",
							tone: "info",
							text: "A plan change is already pending — it applies at the period boundary.",
						});
						return;
					}
					if (result.kind === "changes_disabled") {
						latchChangesDisabled();
						reload();
						set({
							kind: "note",
							tone: "info",
							text: "Subscription changes aren't available here right now.",
						});
						return;
					}
					if (result.kind === "error") {
						set({ kind: "note", tone: "danger", text: result.message });
						return;
					}
					reload();
					if (result.pendingUpdate) {
						set({
							kind: "note",
							tone: "info",
							text: `Your plan changes to ${target.label} at the end of the current period.`,
						});
						return;
					}
					set({ kind: "busy", label: "Confirming your subscription…" });
					const poll = await pollBillingStatusUntil(
						(status) => status.plan === target.plan,
					);
					set(
						poll.settled
							? {
									kind: "note",
									tone: "success",
									text: `You're on ${target.label}. Upgrades take effect right away.`,
								}
							: {
									kind: "note",
									tone: "info",
									text: "Your change is confirmed and will appear shortly — refresh in a moment.",
								},
					);
					// Refresh the account badge on a fresh tick: the badge read flips the
					// whole TopBar entry to its loading state, and doing it in the same
					// commit as the note set leaves the note unrendered.
					refreshStatusSoon(onStatusChange);
				},
			);
		},
		[set, reload, onStatusChange, latchChangesDisabled],
	);

	const runCancelLike = useCallback(
		(
			run: Promise<Awaited<ReturnType<typeof cancelSubscription>>>,
			busyLabel: string,
			successText: string,
		) => {
			set({ kind: "busy", label: busyLabel });
			void run.then((result) => {
				if (result.kind === "changes_disabled") {
					latchChangesDisabled();
					reload();
					set({
						kind: "note",
						tone: "info",
						text: "Subscription changes aren't available here right now.",
					});
					return;
				}
				if (result.kind === "ok") {
					reload();
					set({ kind: "note", tone: "success", text: successText });
					refreshStatusSoon(onStatusChange);
					return;
				}
				const text =
					result.kind === "error"
						? result.message
						: "That didn't go through. Refresh and try again.";
				set({ kind: "note", tone: "danger", text });
			});
		},
		[set, reload, onStatusChange, latchChangesDisabled],
	);

	const cancel = useCallback(
		(subscriptionId: string) => {
			runCancelLike(
				cancelSubscription(subscriptionId),
				"Canceling…",
				"Your subscription is set to cancel at the period end. No more charges.",
			);
		},
		[runCancelLike],
	);

	const reactivate = useCallback(
		(subscriptionId: string) => {
			runCancelLike(
				reactivateSubscription(subscriptionId),
				"Resuming…",
				"Subscription resumed — it will renew normally.",
			);
		},
		[runCancelLike],
	);

	const updateCard = useCallback(() => {
		set({ kind: "busy", label: "Opening card update…" });
		// Fallback to the hosted popup if the embed session can't be minted or the
		// embed library fails to load. The popup still keeps the editor tab put.
		const fallbackToPopup = () => {
			void openPaymentMethodPopup().then((result) => {
				set(
					result.ok
						? { kind: "idle" }
						: { kind: "note", tone: "danger", text: result.message },
				);
			});
		};
		void createPaymentMethodSession().then(async (token) => {
			if (!token) {
				fallbackToPopup();
				return;
			}
			// Holder so the success/close handlers (created before the embed) can
			// close it, and so a `close` fired by our own `close()` after success
			// does not wipe the success note.
			const holder = { close: () => {}, succeeded: false };
			try {
				const handle = await openPaymentMethodEmbed(token, {
					onSuccess: () => {
						holder.succeeded = true;
						holder.close();
						reload();
						set({
							kind: "note",
							tone: "success",
							text: "Your card is updated.",
						});
						refreshStatusSoon(onStatusChange);
					},
					onClose: () => {
						if (!holder.succeeded) set({ kind: "idle" });
					},
					onError: () => {
						holder.close();
						set({
							kind: "note",
							tone: "danger",
							text: "That card couldn't be saved. Check the details and try again.",
						});
					},
				});
				holder.close = handle.close;
				// The modal is open; clear the "Opening…" label.
				set({ kind: "idle" });
			} catch {
				fallbackToPopup();
			}
		});
	}, [set, reload, onStatusChange]);

	const openInvoice = useCallback(
		(orderId: string) => {
			set({ kind: "busy", label: "Opening invoice…" });
			void fetchOrderInvoiceUrl(orderId).then((url) => {
				if (url) {
					window.open(url, "_blank", "noopener,noreferrer");
					set({ kind: "idle" });
					return;
				}
				set({
					kind: "note",
					tone: "info",
					text: "That invoice isn't available yet. Try again in a moment.",
				});
			});
		},
		[set],
	);

	return {
		state,
		changesDisabled,
		changePlan,
		cancel,
		reactivate,
		updateCard,
		openInvoice,
		reset,
	};
}

function ManageRow({ row }: { readonly row: PortalManageRow }) {
	return (
		<div className="grid grid-cols-[6rem_minmax(0,1fr)] items-start gap-2 rounded border border-white/8 bg-black/20 px-2 py-1">
			<div className="truncate text-fg-muted text-ui leading-4">
				{row.label}
			</div>
			<div className="min-w-0">
				<div
					className={`truncate font-medium text-ui leading-4 ${toneTextClass(row.tone)}`}
				>
					{row.value}
				</div>
				{row.detail ? (
					<div className="truncate text-fg-muted text-ui leading-3">
						{row.detail}
					</div>
				) : null}
			</div>
		</div>
	);
}

function DialogStatus({ message }: { readonly message: string }) {
	return (
		<div className="rounded border border-white/8 bg-black/20 px-2 py-2 text-fg-muted text-ui leading-4">
			{message}
		</div>
	);
}

function ActionNote({
	state,
	onUpdateCard,
}: {
	readonly state: ActionState;
	/** Card-update handler; the inline affordance renders only when provided. */
	readonly onUpdateCard?: () => void;
}) {
	if (state.kind === "busy") {
		return (
			<div className="rounded border border-white/12 bg-black/25 px-2 py-1.5 text-fg-secondary text-ui leading-4">
				{state.label}
			</div>
		);
	}
	if (state.kind === "note") {
		return (
			<div
				className={`rounded border px-2 py-1.5 text-ui leading-4 ${noteToneClass(state.tone)}`}
			>
				{state.text}
				{state.action === "update-card" && onUpdateCard ? (
					<div className="mt-1.5">
						<button
							type="button"
							className={SUBTLE_BUTTON_CLASS}
							onClick={onUpdateCard}
						>
							<CreditCard aria-hidden="true" size={13} />
							{PAYMENT_METHOD_REQUIRED_GUIDANCE.actionLabel}
						</button>
					</div>
				) : null}
			</div>
		);
	}
	return null;
}

/** The capability-gated mutation controls + a cancel confirmation step. */
function ManageActions({
	view,
	actions,
}: {
	readonly view: Extract<PortalPanelView, { kind: "ready" }>;
	readonly actions: ReturnType<typeof usePortalActions>;
}) {
	const [confirmingCancel, setConfirmingCancel] = useState(false);
	const busy = actions.state.kind === "busy";
	const { capabilities, changeTarget, subscriptionId } = view;

	// When a mutation has latched `changes_disabled`, hide the three subscription-
	// change controls but KEEP card update — it is the only path the org leaves
	// open, and `resolvePortalCapabilities({changesEnabled:false})` encodes exactly
	// this (the three `can*` false, `paymentMethodUpdate:"popup"`). The capability
	// value "popup" means "card update is available"; the action opens the on-
	// domain embed and only falls back to a popup if that cannot load.
	const disabled = actions.changesDisabled;
	const showChange = !disabled && changeTarget !== null;
	const showReactivate = !disabled && capabilities.canReactivate;
	const showCancel = !disabled && capabilities.canCancel;
	const showCardUpdate = capabilities.paymentMethodUpdate === "popup";

	const showAny = showChange || showCancel || showReactivate || showCardUpdate;
	if (!showAny && actions.state.kind === "idle") return null;

	return (
		<section className="flex flex-col gap-2 border-white/10 border-t pt-2">
			{showChange && changeTarget !== null ? (
				<button
					type="button"
					className={ACCENT_BUTTON_CLASS}
					disabled={busy}
					onClick={() => actions.changePlan(subscriptionId, changeTarget)}
				>
					<ArrowsClockwise aria-hidden="true" size={13} />
					{changeTarget.direction === "upgrade"
						? `Switch to ${changeTarget.label}`
						: `Downgrade to ${changeTarget.label}`}
				</button>
			) : null}

			{showReactivate ? (
				<button
					type="button"
					className={PRIMARY_BUTTON_CLASS}
					disabled={busy}
					onClick={() => actions.reactivate(subscriptionId)}
				>
					Keep my subscription
				</button>
			) : null}

			{showCancel && !confirmingCancel ? (
				<button
					type="button"
					className={SUBTLE_BUTTON_CLASS}
					disabled={busy}
					onClick={() => setConfirmingCancel(true)}
				>
					Cancel subscription
				</button>
			) : null}

			{showCancel && confirmingCancel ? (
				<div className="flex flex-col gap-1.5 rounded border border-white/10 bg-black/25 p-2">
					<div className="text-fg-secondary text-ui leading-4">
						You'll keep {view.planLabel}
						{view.periodEndLabel ? ` until ${view.periodEndLabel}` : ""}, then
						move to Free. No more charges.
					</div>
					<div className="flex gap-1.5">
						<button
							type="button"
							className={DANGER_BUTTON_CLASS}
							disabled={busy}
							onClick={() => {
								setConfirmingCancel(false);
								actions.cancel(subscriptionId);
							}}
						>
							Confirm cancellation
						</button>
						<button
							type="button"
							className={SUBTLE_BUTTON_CLASS}
							disabled={busy}
							onClick={() => setConfirmingCancel(false)}
						>
							Keep it
						</button>
					</div>
				</div>
			) : null}

			{showCardUpdate ? (
				<button
					type="button"
					className={SUBTLE_BUTTON_CLASS}
					disabled={busy}
					onClick={actions.updateCard}
					title="Update your saved card securely in this app. Your card details never touch this app."
				>
					<CreditCard aria-hidden="true" size={13} />
					Update card
				</button>
			) : null}

			<ActionNote
				state={actions.state}
				onUpdateCard={showCardUpdate ? actions.updateCard : undefined}
			/>
		</section>
	);
}

function ReadyBody({
	view,
	actions,
}: {
	readonly view: Extract<PortalPanelView, { kind: "ready" }>;
	readonly actions: ReturnType<typeof usePortalActions>;
}) {
	return (
		<div className="flex min-h-0 flex-col gap-2 overflow-y-auto pr-1">
			<section className="grid gap-1">
				{view.rows.map((row) => (
					<ManageRow key={row.label} row={row} />
				))}
			</section>

			<ManageActions view={view} actions={actions} />

			{view.orders.length > 0 ? (
				<section className="border-white/10 border-t pt-2">
					<div className="mb-1 font-medium text-fg-secondary text-ui leading-4">
						Recent orders
					</div>
					<ul className="space-y-1">
						{view.orders.map((order) => (
							<li
								key={order.id}
								className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded border border-white/8 bg-black/20 px-2 py-1"
							>
								<div className="min-w-0">
									<div className="truncate font-medium text-fg text-ui leading-4">
										{order.date}
									</div>
									<div className="truncate text-fg-muted text-ui leading-3">
										{order.status}
									</div>
								</div>
								{order.invoiceAvailable ? (
									<button
										type="button"
										className={INVOICE_LINK_CLASS}
										disabled={actions.state.kind === "busy"}
										onClick={() => actions.openInvoice(order.id)}
									>
										<Receipt aria-hidden="true" size={12} />
										Invoice ↗
									</button>
								) : null}
							</li>
						))}
					</ul>
				</section>
			) : null}
		</div>
	);
}

/**
 * In-app customer-portal dialog.
 *
 * Opens over the editor instead of navigating to the hosted `polar.sh` portal,
 * fetching the sanitized overview and rendering the subscription summary,
 * capability-gated mutations (change plan / cancel / reactivate), recent orders
 * with hosted-invoice links, and card update. A signed-in customer with no live
 * subscription is offered checkout via {@link onStartCheckout}. Every action
 * stays on the app's own origin: card update opens Polar's on-domain embed
 * overlay (a popup only if the embed cannot load), and invoice links open the
 * hosted invoice in a new window.
 */
export function ManageBillingDialog({
	open,
	onOpenChange,
	onStartCheckout,
	onStatusChange,
}: {
	readonly open: boolean;
	readonly onOpenChange: (open: boolean) => void;
	readonly onStartCheckout: () => void;
	readonly onStatusChange: () => void;
}) {
	const { view, reload } = usePortalOverview(open);
	const actions = usePortalActions({ reload, onStatusChange });

	const startCheckout = useCallback(() => {
		onOpenChange(false);
		onStartCheckout();
	}, [onOpenChange, onStartCheckout]);

	// Clear any terminal note when the dialog is reopened, so a stale note from a
	// previous session does not greet the next open. Guard on the closed→open
	// transition with a ref: without it the effect re-runs on ordinary re-renders
	// and resets `actions.state` to idle every render, so the busy spinner and the
	// action notes never paint.
	const reset = actions.reset;
	const wasOpen = useRef(false);
	useEffect(() => {
		if (open && !wasOpen.current) reset();
		wasOpen.current = open;
	}, [open, reset]);

	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Backdrop className={BACKDROP_CLASS} />
				<Dialog.Popup className={DIALOG_CLASS}>
					<header className="flex items-center justify-between gap-2">
						<Dialog.Title className="flex items-center gap-1.5 font-medium text-fg text-ui leading-4">
							<CreditCard aria-hidden="true" size={14} />
							Billing
						</Dialog.Title>
						<Dialog.Close className={ICON_BUTTON_CLASS} aria-label="Close">
							<X aria-hidden="true" size={12} />
						</Dialog.Close>
					</header>

					{view.kind === "loading" ? (
						<DialogStatus message="Loading your billing details…" />
					) : null}
					{view.kind === "unauthenticated" ? (
						<DialogStatus message="Sign in to manage your billing." />
					) : null}
					{view.kind === "error" ? (
						<div className="rounded border border-danger/25 bg-danger-surface/50 px-2 py-2 text-danger-fg text-ui leading-4">
							Billing details are unavailable right now. The editor is
							unaffected.
						</div>
					) : null}
					{view.kind === "empty" ? (
						<div className="flex flex-col gap-2">
							<DialogStatus message={view.message} />
							<button
								type="button"
								className={PRIMARY_BUTTON_CLASS}
								onClick={startCheckout}
							>
								Start a subscription
							</button>
						</div>
					) : null}
					{view.kind === "ready" ? (
						<ReadyBody view={view} actions={actions} />
					) : null}
				</Dialog.Popup>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
