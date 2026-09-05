import type {
	Entitlements,
	ExportJobFormat,
	ExportJobKind,
	SubscriptionPlan,
	SubscriptionStatus,
} from "@/entities/platform/model/types";

/**
 * Client-local mirrors of the platform Worker response envelopes.
 *
 * These intentionally re-declare the documented JSON shapes of
 * `GET /api/account/bootstrap` and `GET /api/billing/status` instead of importing
 * the Worker response types. The Worker modules transitively pull server-only
 * dependencies (`drizzle-orm`, `better-auth`, `@polar-sh/*`) that must never enter
 * the client bundle, so the client/Worker boundary is crossed by HTTP only. The
 * one shared, bundle-safe contract is the pure entitlement type module
 * (`@/entities/platform/model/types`), which carries no runtime imports.
 *
 * If the Worker contracts change, update these mirrors to match — they are an
 * over-the-wire contract, not a structural type import.
 */

/** Mirror of the `account` block from `GET /api/account/bootstrap`. */
export type BootstrapAccount = {
	readonly userId: string;
	readonly email: string | null;
	readonly name: string | null;
	readonly avatarUrl: string | null;
};

/** Mirror of the `workspace` block from `GET /api/account/bootstrap`. */
export type BootstrapWorkspace = {
	readonly id: string;
	readonly kind: "personal";
	readonly displayName: string;
	readonly createdAt: string;
	readonly updatedAt: string;
};

/** Mirror of the `usage` block from `GET /api/account/bootstrap`. */
export type BootstrapUsage = {
	readonly periodKey: string;
	readonly serverExportJobsCreated: number;
	readonly aiCreditsUsed: number;
};

/** Full mirror of the `GET /api/account/bootstrap` JSON envelope. */
export type AccountBootstrap = {
	readonly account: BootstrapAccount;
	readonly workspace: BootstrapWorkspace;
	readonly usage: BootstrapUsage;
	readonly entitlements: Entitlements;
};

/** Full mirror of the `GET /api/billing/status` JSON envelope. */
export type BillingStatus = {
	readonly plan: SubscriptionPlan;
	readonly status: SubscriptionStatus;
	readonly isPaidPlan: boolean;
	readonly cancelAtPeriodEnd: boolean;
	readonly currentPeriodEnd: string | null;
	readonly entitlements: Entitlements;
};

/** Client-local mirror of the server export job status values shown in billing. */
export type BillingExportJobStatus =
	| "queued"
	| "running"
	| "succeeded"
	| "failed"
	| "canceled";

/** Minimal public request metadata needed for recent-job account presentation. */
export type BillingExportJobRequest = {
	readonly kind: ExportJobKind;
	readonly format?: ExportJobFormat;
	readonly width?: number;
	readonly height?: number;
	readonly durationFrames?: number;
};

/** Read-only export job projection consumed by the compact account panel. */
export type BillingExportJobRecord = {
	readonly id: string;
	readonly kind: ExportJobKind;
	readonly status: BillingExportJobStatus;
	readonly request: BillingExportJobRequest;
	readonly createdAt: string;
	readonly updatedAt: string;
};

/** Result of the billing feature's read-only `GET /api/billing/status` helper. */
export type BillingStatusResult =
	| { readonly kind: "ok"; readonly status: BillingStatus }
	| { readonly kind: "unauthenticated"; readonly statusCode: 401 }
	| {
			readonly kind: "error";
			readonly statusCode?: number;
			readonly message: string;
	  };

/** Result of the billing feature's read-only `GET /api/export-jobs` helper. */
export type BillingExportJobsResult =
	| { readonly kind: "ok"; readonly jobs: readonly BillingExportJobRecord[] }
	| { readonly kind: "unauthenticated"; readonly statusCode: 401 }
	| {
			readonly kind: "error";
			readonly statusCode?: number;
			readonly message: string;
	  };

/**
 * Combined read model for the compact account/billing panel.
 *
 * Bootstrap stays the source for account, workspace, usage, and entitlement
 * defaults. Billing status and export jobs are additive reads: failures there
 * degrade only the affected panel rows instead of replacing the editor surface.
 */
export type BillingEntrySnapshot = {
	readonly bootstrap: AccountBootstrap;
	readonly billingStatus: BillingStatus | null;
	readonly billingStatusError: string | null;
	readonly exportJobs: BillingExportJobsResult;
};

/**
 * Resolved result of an account bootstrap fetch. `unauthenticated` is a first
 * class state (HTTP 401) rather than an error, because the editor must degrade
 * gracefully for signed-out users instead of treating "no session" as a failure.
 */
export type BootstrapResult =
	| { readonly kind: "ok"; readonly bootstrap: AccountBootstrap }
	| { readonly kind: "unauthenticated" }
	| { readonly kind: "error"; readonly message: string };

/** Fetch result consumed by the billing entry view projection. */
export type BillingEntryResult =
	| { readonly kind: "ok"; readonly snapshot: BillingEntrySnapshot }
	| { readonly kind: "unauthenticated" }
	| { readonly kind: "error"; readonly message: string };

/**
 * Upgrade target plans the compact billing entry can start a checkout for. Free
 * is excluded because it is never a paid purchase target.
 */
export type UpgradeTargetPlan = Exclude<SubscriptionPlan, "free">;

/**
 * Mirror of one subscription's pending plan change from
 * `GET /api/billing/portal/overview`.
 */
export type PortalPendingUpdateView = {
	readonly plan: SubscriptionPlan | null;
	readonly effectiveAt: string | null;
};

/** Mirror of the sanitized subscription summary from the portal overview. */
export type PortalSubscriptionView = {
	readonly id: string;
	readonly plan: SubscriptionPlan;
	readonly status: SubscriptionStatus;
	readonly amount: number;
	readonly currency: string;
	readonly currentPeriodEnd: string | null;
	readonly cancelAtPeriodEnd: boolean;
	readonly canceledAt: string | null;
	readonly endsAt: string | null;
	readonly pendingUpdate: PortalPendingUpdateView | null;
};

/** Mirror of one order/invoice row from the portal overview. */
export type PortalOrderView = {
	readonly id: string;
	readonly createdAt: string;
	readonly amount: number;
	readonly currency: string;
	readonly status: string;
	readonly paid: boolean;
	readonly invoiceAvailable: boolean;
};

/** Mirror of what the in-app portal may offer, given org config + state. */
export type PortalCapabilities = {
	readonly canChangePlan: boolean;
	readonly canCancel: boolean;
	readonly canReactivate: boolean;
	readonly paymentMethodUpdate: "popup" | "none";
};

/** Full mirror of the `GET /api/billing/portal/overview` JSON envelope. */
export type PortalOverview = {
	readonly provider: "polar";
	readonly subscription: PortalSubscriptionView | null;
	readonly orders: readonly PortalOrderView[];
	readonly capabilities: PortalCapabilities;
};

/**
 * Result of the billing feature's `GET /api/billing/portal/overview` helper.
 * `no-customer` folds the Worker's 424 states (billing disabled, no Polar
 * customer, portal unavailable) into the one client outcome that offers checkout.
 */
export type PortalOverviewResult =
	| { readonly kind: "ok"; readonly overview: PortalOverview }
	| { readonly kind: "unauthenticated" }
	| { readonly kind: "no-customer" }
	| { readonly kind: "error"; readonly message: string };

/**
 * Result of a subscription mutation (cancel / reactivate / change-plan).
 *
 * `payment_failed` (a `402` when an immediate prorated charge is declined),
 * `payment_method_required` (a `422` when Polar holds no payment method for
 * the subscription — e.g. it was started through a 100% discount — so a paid
 * switch cannot be charged), `subscription_locked` (a `409` change-plan
 * blocked by an already-pending update), and `changes_disabled` (a `403` when
 * the org turned off customer-initiated changes) are first-class states the UI
 * renders as calm, specific copy — never generic failures. `ok` carries the
 * updated subscription and, for a change-plan, the `pendingUpdate` that
 * distinguishes an immediate upgrade (`null`) from a queued downgrade
 * (effective at period end).
 */
export type PortalMutationResult =
	| {
			readonly kind: "ok";
			readonly subscription: PortalSubscriptionView;
			readonly pendingUpdate?: PortalPendingUpdateView | null;
	  }
	| { readonly kind: "payment_failed" }
	| { readonly kind: "payment_method_required" }
	| { readonly kind: "subscription_locked" }
	| { readonly kind: "changes_disabled" }
	| { readonly kind: "error"; readonly message: string };

/** Mirror of `POST /api/billing/checkout-session` for embedded Polar checkout. */
export type EmbeddedCheckoutSession = {
	readonly provider: "polar";
	readonly plan: UpgradeTargetPlan;
	readonly checkout: {
		readonly id: string;
		readonly url: string;
		readonly clientSecret: string;
		readonly expiresAt: string;
		readonly embedOrigin: string;
	};
};

/**
 * Email/password payload sent to Better Auth's headless sign-in endpoint.
 *
 * This stays feature-local rather than importing Better Auth client types so the
 * editor bundle keeps the auth SDK, Drizzle adapter, and Worker-only modules out
 * of the browser graph.
 */
export type SignInCredentials = {
	readonly email: string;
	readonly password: string;
};

/**
 * Email/password payload sent to Better Auth's headless sign-up endpoint.
 *
 * Better Auth requires `name` for email sign-up. The compact editor form owns
 * collecting that field; the Worker remains the authority for validation and
 * duplicate-account handling.
 */
export type SignUpCredentials = SignInCredentials & {
	readonly name: string;
};

/**
 * Compact result used by auth entry actions.
 *
 * Auth endpoints can fail with JSON API errors, non-JSON gateway errors, or
 * network failures. The UI only needs a success flag plus a short message that
 * can be rendered inline without blocking the canvas.
 */
export type AuthActionResult =
	| { readonly ok: true }
	| { readonly ok: false; readonly message: string };
