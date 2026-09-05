import type {
	Entitlements,
	SubscriptionPlan,
	SubscriptionStatus,
} from "@/entities/platform/model/types";
import type {
	AccountBootstrap,
	BillingEntryResult,
	BillingEntrySnapshot,
	BillingExportJobRecord,
	BillingExportJobsResult,
	PortalCapabilities,
	PortalOverviewResult,
	UpgradeTargetPlan,
} from "./types";

/** Human-readable plan labels for the compact badge. */
const PLAN_LABELS: Record<SubscriptionPlan, string> = {
	free: "Free",
	creator: "Creator",
	creator_pro: "Creator Pro",
};

const STATUS_LABELS: Record<SubscriptionStatus, string> = {
	none: "No subscription",
	trialing: "Trial",
	active: "Active",
	past_due: "Past due",
	canceled: "Canceled",
	unpaid: "Unpaid",
	incomplete: "Incomplete",
	incomplete_expired: "Expired",
	paused: "Paused",
};

const MONTH_LABELS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
] as const;

const MAX_RECENT_JOBS = 4 as const;

/** Plan a Free user is offered as the single compact upgrade target. */
const FREE_UPGRADE_TARGET: UpgradeTargetPlan = "creator";

/** Returns the display label for a plan id. */
export function planLabel(plan: SubscriptionPlan): string {
	return PLAN_LABELS[plan];
}

/**
 * The primary action a billing entry offers given the current state. `signIn`
 * keeps signed-out users unblocked, `upgrade` is shown for non-paid sessions, and
 * `manage` opens the portal for paid sessions. `none` is used while loading or on
 * a transient error so the editor never shows a misleading action.
 */
export type BillingAction = "signIn" | "upgrade" | "manage" | "none";

/**
 * Session state exposed to the compact entry. `unknown` covers loading and
 * transient bootstrap failures so the UI does not offer sign-out from stale
 * assumptions.
 */
export type BillingAuthState = "unknown" | "signedOut" | "signedIn";

/** Visual tone for compact billing panel rows and status chips. */
export type BillingTone =
	| "neutral"
	| "accent"
	| "success"
	| "warning"
	| "danger";

/** Stable account details shown inside the compact panel. */
export type BillingAccountView = {
	readonly name: string;
	readonly email: string | null;
	readonly label: string;
	readonly avatarLabel: string;
};

/** One label/value row in the compact account panel. */
export type BillingPanelRow = {
	readonly label: string;
	readonly value: string;
	readonly detail: string | null;
	readonly tone: BillingTone;
	readonly title: string | null;
};

/** Plan-change affordance shown in the panel. */
export type BillingPlanActionView =
	| {
			readonly kind: "checkout";
			readonly label: "Upgrade" | "Change plan";
			readonly targetPlan: UpgradeTargetPlan;
			readonly title: string;
	  }
	| {
			readonly kind: "portal";
			readonly label: "Change plan";
			readonly title: string;
	  }
	| { readonly kind: "none"; readonly label: null; readonly title: null };

/** Render-ready recent server export job summary. */
export type BillingRecentJobView = {
	readonly id: string;
	readonly title: string;
	readonly meta: string;
	readonly timestamp: string;
	readonly statusLabel: string;
	readonly statusTone: BillingTone;
};

/** Recent-job section state for the compact panel. */
export type BillingRecentJobsView =
	| {
			readonly state: "hidden" | "loading" | "empty";
			readonly items: readonly [];
	  }
	| {
			readonly state: "error";
			readonly items: readonly [];
			readonly message: string;
	  }
	| {
			readonly state: "ready";
			readonly items: readonly BillingRecentJobView[];
	  };

/**
 * Compact, render-ready view of billing/usage state for the TopBar entry.
 *
 * This is the pure projection layer: it turns a {@link BillingEntryResult} into
 * badge text, account rows, usage rows, recent jobs, and panel actions, so the
 * component holds no plan/usage branching of its own. `usageText` is only
 * promoted to the compact badge when `usageOver` needs attention; `panelRows`
 * carries the fuller account panel state when a session is signed in.
 */
export type BillingEntryView = {
	readonly kind: "loading" | "ready";
	readonly authState: BillingAuthState;
	readonly accountLabel: string | null;
	readonly account: BillingAccountView | null;
	readonly planLabel: string;
	readonly statusNote: string | null;
	readonly usageText: string | null;
	readonly usageOver: boolean;
	readonly panelRows: readonly BillingPanelRow[];
	readonly planAction: BillingPlanActionView;
	readonly canManageBilling: boolean;
	readonly canSignOut: boolean;
	readonly recentJobs: BillingRecentJobsView;
	readonly action: BillingAction;
	readonly upgradeTarget: UpgradeTargetPlan;
	readonly title: string;
};

const LOADING_VIEW: BillingEntryView = {
	kind: "loading",
	authState: "unknown",
	accountLabel: null,
	account: null,
	planLabel: "…",
	statusNote: null,
	usageText: null,
	usageOver: false,
	panelRows: [],
	planAction: { kind: "none", label: null, title: null },
	canManageBilling: false,
	canSignOut: false,
	recentJobs: { state: "loading", items: [] },
	action: "none",
	upgradeTarget: FREE_UPGRADE_TARGET,
	title: "Loading plan",
};

const statusTone = (status: SubscriptionStatus): BillingTone => {
	switch (status) {
		case "trialing":
			return "accent";
		case "active":
			return "success";
		case "past_due":
		case "unpaid":
		case "incomplete":
		case "incomplete_expired":
			return "danger";
		case "paused":
			return "warning";
		case "none":
		case "canceled":
			return "neutral";
	}
};

const formatUtcDate = (value: string | null): string | null => {
	if (value === null) return null;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return null;
	return `${MONTH_LABELS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
};

const formatUtcDateTime = (value: string): string => {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "unknown";
	const hours = `${date.getUTCHours()}`.padStart(2, "0");
	const minutes = `${date.getUTCMinutes()}`.padStart(2, "0");
	return `${MONTH_LABELS[date.getUTCMonth()]} ${date.getUTCDate()} ${hours}:${minutes} UTC`;
};

const accountProjection = (bootstrap: AccountBootstrap): BillingAccountView => {
	const name = bootstrap.account.name?.trim() || "Signed in";
	const email = bootstrap.account.email?.trim() || null;
	const label = email ?? name;
	const avatarSource = name !== "Signed in" ? name : (email ?? "Account");
	return {
		name,
		email,
		label,
		avatarLabel: avatarSource.slice(0, 1).toUpperCase(),
	};
};

/**
 * Builds the server-export usage line (`used/limit jobs`) when the plan exposes a
 * positive monthly limit, otherwise returns `null`. `usageOver` flags a reached
 * limit so the entry can hint that an upgrade unlocks more server export jobs.
 */
function usageProjection(
	bootstrap: AccountBootstrap,
	entitlements: Entitlements,
): {
	readonly text: string | null;
	readonly panelValue: string;
	readonly detail: string | null;
	readonly over: boolean;
} {
	const limit = entitlements.limits.monthlyServerExportJobs;
	const used = Math.max(0, Math.trunc(bootstrap.usage.serverExportJobsCreated));
	if (!Number.isFinite(limit)) {
		return {
			text: "Unlimited export jobs",
			panelValue: "Unlimited",
			detail: `${used} used this period`,
			over: false,
		};
	}
	const normalizedLimit = Math.max(0, Math.trunc(limit));
	const remaining = Math.max(0, normalizedLimit - used);
	return {
		text: normalizedLimit > 0 ? `${used}/${normalizedLimit} export jobs` : null,
		panelValue: `${remaining}/${normalizedLimit} remaining`,
		detail: `${used} used in ${bootstrap.usage.periodKey}`,
		over: used >= normalizedLimit,
	};
}

const subscriptionLabel = (
	status: SubscriptionStatus,
	cancelAtPeriodEnd: boolean,
): string => {
	if (cancelAtPeriodEnd && (status === "active" || status === "trialing")) {
		return "Canceling";
	}
	return STATUS_LABELS[status];
};

const hasBillingRelationship = (entitlements: Entitlements): boolean =>
	entitlements.sourcePlan !== "free" ||
	entitlements.downgradeReason !== undefined;

const planActionFor = (entitlements: Entitlements): BillingPlanActionView => {
	if (entitlements.sourcePlan === "free") {
		return {
			kind: "checkout",
			label: "Upgrade",
			targetPlan: "creator",
			title: "Upgrade to Creator",
		};
	}

	if (
		entitlements.sourcePlan === "creator" &&
		entitlements.isSubscriptionActive
	) {
		return {
			kind: "checkout",
			label: "Change plan",
			targetPlan: "creator_pro",
			title: "Change to Creator Pro",
		};
	}

	return {
		kind: "portal",
		label: "Change plan",
		title: "Open billing portal to change plan",
	};
};

const jobStatusTone = (
	status: BillingExportJobRecord["status"],
): BillingTone => {
	switch (status) {
		case "queued":
			return "neutral";
		case "running":
			return "accent";
		case "succeeded":
			return "success";
		case "failed":
			return "danger";
		case "canceled":
			return "warning";
	}
};

const jobTitle = (job: BillingExportJobRecord): string => {
	const format = job.request.format ?? "export";
	return `${job.kind} ${format}`;
};

const jobMeta = (job: BillingExportJobRecord): string => {
	const parts = [job.id.slice(0, 8)];
	if (job.request.width !== undefined && job.request.height !== undefined) {
		parts.push(`${job.request.width}x${job.request.height}`);
	}
	if (job.request.durationFrames !== undefined) {
		parts.push(`${job.request.durationFrames}f`);
	}
	return parts.join(" - ");
};

const recentJobsProjection = (
	result: BillingExportJobsResult,
): BillingRecentJobsView => {
	if (result.kind === "unauthenticated") {
		return { state: "hidden", items: [] };
	}
	if (result.kind === "error") {
		return { state: "error", items: [], message: result.message };
	}
	if (result.jobs.length === 0) {
		return { state: "empty", items: [] };
	}

	const items = [...result.jobs]
		.sort(
			(left, right) =>
				new Date(right.createdAt).getTime() -
				new Date(left.createdAt).getTime(),
		)
		.slice(0, MAX_RECENT_JOBS)
		.map(
			(job): BillingRecentJobView => ({
				id: job.id,
				title: jobTitle(job),
				meta: jobMeta(job),
				timestamp: formatUtcDateTime(job.createdAt),
				statusLabel: job.status,
				statusTone: jobStatusTone(job.status),
			}),
		);

	return { state: "ready", items };
};

const panelRowsFor = (
	snapshot: BillingEntrySnapshot,
	entitlements: Entitlements,
	displayPlan: string,
	usage: ReturnType<typeof usageProjection>,
): readonly BillingPanelRow[] => {
	const { billingStatus } = snapshot;
	const status = billingStatus?.status ?? entitlements.status;
	const cancelAtPeriodEnd = billingStatus?.cancelAtPeriodEnd ?? false;
	const periodEnd = formatUtcDate(billingStatus?.currentPeriodEnd ?? null);
	const periodLabel =
		entitlements.sourcePlan === "free"
			? "Renewal"
			: cancelAtPeriodEnd
				? "Current period end"
				: "Renewal";
	const periodValue =
		entitlements.sourcePlan === "free"
			? "No renewal"
			: (periodEnd ?? "Unavailable");

	return [
		{
			label: "Plan",
			value: displayPlan,
			detail:
				entitlements.plan !== entitlements.sourcePlan
					? `${planLabel(entitlements.plan)} access`
					: null,
			tone: "neutral",
			title: null,
		},
		{
			label: "Subscription",
			value: subscriptionLabel(status, cancelAtPeriodEnd),
			detail: snapshot.billingStatusError,
			tone: statusTone(status),
			title: snapshot.billingStatusError,
		},
		{
			label: periodLabel,
			value: periodValue,
			detail: null,
			tone: periodValue === "Unavailable" ? "warning" : "neutral",
			title: billingStatus?.currentPeriodEnd ?? null,
		},
		{
			label: "Server exports",
			value: usage.panelValue,
			detail: usage.detail,
			tone: usage.over ? "warning" : "neutral",
			title: "Monthly server export remaining/limit",
		},
	];
};

/**
 * Projects the account-panel snapshot fetch result onto the compact view model.
 *
 * Pure and total over every {@link BillingEntryResult} branch: loading and error
 * keep the editor unblocked, unauthenticated offers a non-blocking sign-in
 * panel, and authenticated sessions show account rows, subscription period,
 * monthly export usage, recent jobs, and billing actions. Billing-status or job
 * subreads can fail independently without replacing the editor workspace.
 */
export function projectBillingEntry(
	result: BillingEntryResult | null,
): BillingEntryView {
	if (result === null) return LOADING_VIEW;

	if (result.kind === "unauthenticated") {
		return {
			kind: "ready",
			authState: "signedOut",
			accountLabel: null,
			account: null,
			planLabel: "Guest",
			statusNote: null,
			usageText: null,
			usageOver: false,
			panelRows: [],
			planAction: { kind: "none", label: null, title: null },
			canManageBilling: false,
			canSignOut: false,
			recentJobs: { state: "hidden", items: [] },
			action: "signIn",
			upgradeTarget: FREE_UPGRADE_TARGET,
			title: "Sign in to manage your plan",
		};
	}

	if (result.kind === "error") {
		return {
			kind: "ready",
			authState: "unknown",
			accountLabel: null,
			account: null,
			planLabel: "Plan",
			statusNote: "offline",
			usageText: null,
			usageOver: false,
			panelRows: [],
			planAction: { kind: "none", label: null, title: null },
			canManageBilling: false,
			canSignOut: false,
			recentJobs: { state: "hidden", items: [] },
			action: "none",
			upgradeTarget: FREE_UPGRADE_TARGET,
			title: "Billing status unavailable",
		};
	}

	const { snapshot } = result;
	const { bootstrap } = snapshot;
	const entitlements =
		snapshot.billingStatus?.entitlements ?? bootstrap.entitlements;
	const usage = usageProjection(bootstrap, entitlements);
	const account = accountProjection(bootstrap);
	const displayPlan = planLabel(
		snapshot.billingStatus?.plan ?? entitlements.sourcePlan,
	);
	const statusNote =
		snapshot.billingStatusError !== null
			? "status offline"
			: entitlements.downgradeReason !== undefined
				? "needs attention"
				: null;

	// "Manage" must reach the portal for anyone who has ever purchased, not just
	// those whose access is currently active: `isPaidPlan` is false for a
	// `past_due`/`canceled` Creator, yet that user needs the portal precisely to
	// fix payment. `sourcePlan` is the purchased tier (vs effective `plan` after
	// downgrade), and a `downgradeReason` likewise marks a lapsed paid customer —
	// either routes them to manage instead of offering a fresh checkout.
	const billingRelationship = hasBillingRelationship(entitlements);
	const planAction = planActionFor(entitlements);

	return {
		kind: "ready",
		authState: "signedIn",
		accountLabel: account.label,
		account,
		planLabel: displayPlan,
		statusNote,
		usageText: usage.text,
		usageOver: usage.over,
		panelRows: panelRowsFor(snapshot, entitlements, displayPlan, usage),
		planAction,
		canManageBilling: billingRelationship,
		canSignOut: true,
		recentJobs: recentJobsProjection(snapshot.exportJobs),
		action: billingRelationship ? "manage" : "upgrade",
		upgradeTarget: FREE_UPGRADE_TARGET,
		title: billingRelationship
			? `${displayPlan} plan — manage billing`
			: `${displayPlan} plan — upgrade for more`,
	};
}

/**
 * Guidance for a plan change Polar rejected with `payment_method_required`:
 * the subscription holds no payment method (e.g. it was started through a
 * 100% discount), so the switch cannot be charged. The dialog renders
 * `text` as the action note and offers the existing card-update flow —
 * available whenever `PortalCapabilities.paymentMethodUpdate` is `"popup"` —
 * as an inline `actionLabel` affordance.
 */
export const PAYMENT_METHOD_REQUIRED_GUIDANCE = {
	text: "Add a payment method before switching plans.",
	actionLabel: "Update card",
} as const;

/** One label/value row in the in-app manage-billing dialog. */
export type PortalManageRow = {
	readonly label: string;
	readonly value: string;
	readonly detail: string | null;
	readonly tone: BillingTone;
};

/** One recent-order row in the in-app manage-billing dialog. */
export type PortalManageOrderRow = {
	readonly id: string;
	readonly date: string;
	readonly status: string;
	readonly invoiceAvailable: boolean;
};

/**
 * Render-ready projection of the portal overview for the manage dialog. Total
 * over every {@link PortalOverviewResult} branch plus the loading (`null`) state,
 * so the dialog holds no billing branching of its own. A signed-in customer with
 * no live subscription, and the Worker's folded 424 states, both resolve to
 * `empty` so the dialog offers checkout rather than an error.
 */
export type PortalPanelView =
	| { readonly kind: "loading" }
	| { readonly kind: "unauthenticated" }
	| { readonly kind: "error"; readonly message: string }
	| { readonly kind: "empty"; readonly message: string }
	| {
			readonly kind: "ready";
			readonly subscriptionId: string;
			readonly planLabel: string;
			readonly periodEndLabel: string | null;
			readonly rows: readonly PortalManageRow[];
			readonly orders: readonly PortalManageOrderRow[];
			readonly capabilities: PortalCapabilities;
			readonly changeTargetLabel: string | null;
			readonly changeTarget: PortalChangeTarget | null;
	  };

/** The plan a change-plan action targets, with its upgrade/downgrade direction. */
export type PortalChangeTarget = {
	readonly plan: UpgradeTargetPlan;
	readonly label: string;
	readonly direction: "upgrade" | "downgrade";
};

const NO_SUBSCRIPTION_MESSAGE = "Start a subscription to manage billing here.";

/** The single alternate paid plan, mirroring the Worker's `planChangeTarget`. */
const changeTargetPlan = (plan: SubscriptionPlan): SubscriptionPlan | null => {
	if (plan === "creator") return "creator_pro";
	if (plan === "creator_pro") return "creator";
	return null;
};

/** Ordinal plan tier, so a change target's direction (up/down) is derivable. */
const PLAN_RANK: Record<SubscriptionPlan, number> = {
	free: 0,
	creator: 1,
	creator_pro: 2,
};
const planRank = (plan: SubscriptionPlan): number => PLAN_RANK[plan];

export function projectPortalOverview(
	result: PortalOverviewResult | null,
): PortalPanelView {
	if (result === null) return { kind: "loading" };
	if (result.kind === "unauthenticated") return { kind: "unauthenticated" };
	if (result.kind === "error") {
		return { kind: "error", message: result.message };
	}
	if (result.kind === "no-customer") {
		return { kind: "empty", message: NO_SUBSCRIPTION_MESSAGE };
	}

	const { subscription, orders, capabilities } = result.overview;
	if (subscription === null) {
		return { kind: "empty", message: NO_SUBSCRIPTION_MESSAGE };
	}

	const periodEnd = formatUtcDate(subscription.currentPeriodEnd);
	const rows: PortalManageRow[] = [
		{
			label: "Plan",
			value: planLabel(subscription.plan),
			detail: null,
			tone: "neutral",
		},
		{
			label: "Status",
			value: subscriptionLabel(
				subscription.status,
				subscription.cancelAtPeriodEnd,
			),
			detail: null,
			tone: statusTone(subscription.status),
		},
		{
			label: subscription.cancelAtPeriodEnd ? "Access ends" : "Renews",
			value: periodEnd ?? "Unavailable",
			detail: null,
			tone: periodEnd === null ? "warning" : "neutral",
		},
	];

	if (subscription.pendingUpdate !== null) {
		const pendingPlan = subscription.pendingUpdate.plan;
		const pendingDate = formatUtcDate(subscription.pendingUpdate.effectiveAt);
		rows.push({
			label: "Pending change",
			value: pendingPlan === null ? "Scheduled change" : planLabel(pendingPlan),
			detail: pendingDate === null ? null : `Applies ${pendingDate}`,
			tone: "accent",
		});
	}

	const target = changeTargetPlan(subscription.plan);
	const changeTarget: PortalChangeTarget | null =
		capabilities.canChangePlan && target !== null && target !== "free"
			? {
					plan: target,
					label: planLabel(target),
					direction:
						planRank(target) > planRank(subscription.plan)
							? "upgrade"
							: "downgrade",
				}
			: null;

	return {
		kind: "ready",
		subscriptionId: subscription.id,
		planLabel: planLabel(subscription.plan),
		periodEndLabel: periodEnd,
		rows,
		orders: orders.map((order) => ({
			id: order.id,
			date: formatUtcDate(order.createdAt) ?? order.createdAt,
			status: order.status,
			invoiceAvailable: order.invoiceAvailable,
		})),
		capabilities,
		changeTargetLabel: changeTarget?.label ?? null,
		changeTarget,
	};
}
