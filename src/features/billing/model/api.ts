import type {
	AccountBootstrap,
	AuthActionResult,
	BillingEntryResult,
	BillingExportJobRecord,
	BillingExportJobStatus,
	BillingExportJobsResult,
	BillingStatus,
	BillingStatusResult,
	BootstrapResult,
	EmbeddedCheckoutSession,
	PortalCapabilities,
	PortalMutationResult,
	PortalOrderView,
	PortalOverview,
	PortalOverviewResult,
	PortalPendingUpdateView,
	PortalSubscriptionView,
	SignInCredentials,
	SignUpCredentials,
	UpgradeTargetPlan,
} from "./types";

/**
 * Worker route the editor calls once on mount to read account + workspace +
 * usage + entitlements in a single round trip. Auth helper returns JSON 401 when
 * there is no session, which this module maps to the `unauthenticated` state.
 */
const ACCOUNT_BOOTSTRAP_PATH = "/api/account/bootstrap" as const;

/**
 * Worker route for the subscription status row. It carries provider period-end
 * fields that are intentionally absent from bootstrap's entitlement snapshot.
 */
const BILLING_STATUS_PATH = "/api/billing/status" as const;

/**
 * Worker route for recent server export jobs. The billing feature mirrors the
 * small read-only response locally instead of importing from the export feature,
 * keeping feature slices independent.
 */
const EXPORT_JOBS_PATH = "/api/export-jobs" as const;

/**
 * Better Auth email/password sign-in endpoint. The Worker mounts Better Auth at
 * `/api/auth/*`, and the editor talks to it only through HTTP so the Better Auth
 * client package never enters the browser bundle.
 */
const SIGN_IN_EMAIL_PATH = "/api/auth/sign-in/email" as const;

/**
 * Better Auth email/password sign-up endpoint. Sign-up auto-creates a session
 * in the current Worker configuration, so a successful response can be followed
 * by an account bootstrap refresh.
 */
const SIGN_UP_EMAIL_PATH = "/api/auth/sign-up/email" as const;

/**
 * Better Auth sign-out endpoint. The Worker owns session cookie deletion; the
 * client treats any 2xx as success and then refreshes bootstrap state.
 */
const SIGN_OUT_PATH = "/api/auth/sign-out" as const;

/**
 * Worker route for authenticated self-service account deletion (right to
 * erasure). `DELETE` with a `{ confirmEmail }` body that must match the signed-in
 * account; the Worker erases every row owned by the user and the client then
 * clears the session cookie via {@link signOutCurrentSession}.
 */
const ACCOUNT_DELETE_PATH = "/api/account" as const;

/**
 * Better Auth Polar plugin checkout endpoint. Mounted under the auth base path
 * (`/api/auth`) by the worker; `POST` with `{ products | slug }` returns
 * `{ url }` to redirect the browser to a hosted Polar checkout. The client never
 * holds Polar product ids (server-only secret), so it targets a plan `slug`.
 */
const CHECKOUT_PATH = "/api/auth/checkout" as const;

/**
 * Worker-owned embedded checkout session endpoint. It returns the Polar checkout
 * URL and client secret without exposing Polar product ids, the Polar SDK, or
 * Better Auth internals to the browser bundle.
 */
export const EMBEDDED_CHECKOUT_SESSION_PATH =
	"/api/billing/checkout-session" as const;

/**
 * Worker route for the in-app customer-portal overview. Replaces the old hosted
 * `/api/auth/customer/portal` redirect: `GET` returns the sanitized
 * subscription/orders/capabilities envelope the in-app manage dialog renders, so
 * the editor tab never navigates to `polar.sh`.
 */
const PORTAL_OVERVIEW_PATH = "/api/billing/portal/overview" as const;

/**
 * Worker routes for the in-app subscription mutations + the card-update popup
 * mint + per-order hosted invoice link. Each `POST` is same-origin and JSON so
 * it passes the Worker's CSRF guard; the editor tab never navigates to
 * `polar.sh` (only the popup URLs do, in a new window).
 */
const PORTAL_CANCEL_PATH = "/api/billing/portal/subscription/cancel" as const;
const PORTAL_REACTIVATE_PATH =
	"/api/billing/portal/subscription/reactivate" as const;
const PORTAL_CHANGE_PLAN_PATH =
	"/api/billing/portal/subscription/change-plan" as const;
const PORTAL_ORDERS_PATH = "/api/billing/portal/orders" as const;
const PORTAL_MANAGE_PAYMENT_PATH =
	"/api/billing/portal/manage-payment" as const;
const PORTAL_PAYMENT_METHOD_SESSION_PATH =
	"/api/billing/portal/payment-method-session" as const;
const LOCAL_DEV_BILLING_SUBSCRIPTION_PATH =
	"/api/dev/billing/subscription" as const;

const HTTP_UNAUTHORIZED = 401 as const;
const HTTP_PAYMENT_REQUIRED = 402 as const;
const HTTP_FORBIDDEN = 403 as const;
const HTTP_CONFLICT = 409 as const;
const HTTP_UNPROCESSABLE = 422 as const;
const HTTP_BILLING_UNAVAILABLE = 424 as const;

const AUTH_JSON_HEADERS = {
	"content-type": "application/json",
	accept: "application/json",
} as const;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null;
}

const exportJobKinds = ["still", "motion", "sequence"] as const;
const exportJobFormats = [
	"png",
	"svg",
	"pdf",
	"webm",
	"mp4",
	"gif",
	"lottie",
	"json",
] as const;
const exportJobStatuses = [
	"queued",
	"running",
	"succeeded",
	"failed",
	"canceled",
] as const satisfies readonly BillingExportJobStatus[];

const subscriptionStatuses = [
	"none",
	"trialing",
	"active",
	"past_due",
	"canceled",
	"unpaid",
	"incomplete",
	"incomplete_expired",
	"paused",
] as const;

const subscriptionPlans = ["free", "creator", "creator_pro"] as const;
const localDevBillingStatuses = [
	"free",
	"trialing",
	"active",
	"past_due",
	"canceled",
	"incomplete",
] as const;

const isStringIn = <Value extends string>(
	value: unknown,
	values: readonly Value[],
): value is Value =>
	typeof value === "string" && values.includes(value as Value);

const isOptionalNumber = (value: unknown): value is number | undefined =>
	value === undefined || typeof value === "number";

const isBillingStatus = (value: unknown): value is BillingStatus => {
	if (!isRecord(value) || !isRecord(value.entitlements)) return false;
	return (
		isStringIn(value.plan, subscriptionPlans) &&
		isStringIn(value.status, subscriptionStatuses) &&
		typeof value.isPaidPlan === "boolean" &&
		typeof value.cancelAtPeriodEnd === "boolean" &&
		(value.currentPeriodEnd === null ||
			typeof value.currentPeriodEnd === "string")
	);
};

const isBillingExportJobRequest = (
	value: unknown,
): value is BillingExportJobRecord["request"] => {
	if (!isRecord(value)) return false;
	return (
		isStringIn(value.kind, exportJobKinds) &&
		(value.format === undefined ||
			isStringIn(value.format, exportJobFormats)) &&
		isOptionalNumber(value.width) &&
		isOptionalNumber(value.height) &&
		isOptionalNumber(value.durationFrames)
	);
};

const isBillingExportJobRecord = (
	value: unknown,
): value is BillingExportJobRecord => {
	if (!isRecord(value)) return false;
	return (
		typeof value.id === "string" &&
		isStringIn(value.kind, exportJobKinds) &&
		isStringIn(value.status, exportJobStatuses) &&
		isBillingExportJobRequest(value.request) &&
		typeof value.createdAt === "string" &&
		typeof value.updatedAt === "string"
	);
};

const readJson = async (response: Response): Promise<unknown> => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};

const errorMessage = (fallback: string, status?: number): string =>
	status === undefined ? fallback : `${fallback} (${status})`;

function readableErrorValue(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0
		? value.trim()
		: null;
}

async function readAuthFailureMessage(
	response: Response,
	fallback: string,
): Promise<string> {
	try {
		const body = (await response.json()) as unknown;
		if (isRecord(body)) {
			return (
				readableErrorValue(body.message) ??
				readableErrorValue(body.error) ??
				`${fallback} (${response.status})`
			);
		}
	} catch {
		// Non-JSON auth failures still need a compact, deterministic UI message.
	}
	return `${fallback} (${response.status})`;
}

async function postAuthJson(
	path: string,
	payload: object,
	fallback: string,
): Promise<AuthActionResult> {
	try {
		const response = await fetch(path, {
			method: "POST",
			credentials: "same-origin",
			headers: AUTH_JSON_HEADERS,
			body: JSON.stringify(payload),
		});
		if (response.ok) return { ok: true };
		return {
			ok: false,
			message: await readAuthFailureMessage(response, fallback),
		};
	} catch (error) {
		return {
			ok: false,
			message: error instanceof Error ? error.message : fallback,
		};
	}
}

/**
 * Loads the account bootstrap payload for the current session.
 *
 * Same-origin `fetch` so the Better Auth session cookie is sent automatically;
 * `credentials` is left at the default rather than forced, because forcing
 * `omit` would strip the cookie and turn every authenticated user into a false
 * 401. A 401 is a normal signed-out state, not an error, so it is surfaced as a
 * distinct `unauthenticated` result the editor can render without blocking the
 * canvas. Any other non-2xx or thrown network/JSON failure collapses to `error`.
 */
export async function fetchAccountBootstrap(
	signal?: AbortSignal,
): Promise<BootstrapResult> {
	try {
		const response = await fetch(ACCOUNT_BOOTSTRAP_PATH, {
			headers: { accept: "application/json" },
			...(signal ? { signal } : {}),
		});
		if (response.status === HTTP_UNAUTHORIZED) {
			return { kind: "unauthenticated" };
		}
		if (!response.ok) {
			return {
				kind: "error",
				message: `Bootstrap failed (${response.status})`,
			};
		}
		const bootstrap = (await response.json()) as AccountBootstrap;
		return { kind: "ok", bootstrap };
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError") {
			return { kind: "error", message: "aborted" };
		}
		return {
			kind: "error",
			message: error instanceof Error ? error.message : "Bootstrap failed",
		};
	}
}

/**
 * Reads provider-backed billing status for the compact account panel.
 *
 * This is intentionally separate from account bootstrap: bootstrap is the
 * signed-in gate and entitlement fallback, while billing status adds renewal and
 * cancellation details when the Worker can reach the billing tables.
 */
export async function fetchBillingStatus(
	signal?: AbortSignal,
): Promise<BillingStatusResult> {
	try {
		const response = await fetch(BILLING_STATUS_PATH, {
			headers: { accept: "application/json" },
			...(signal ? { signal } : {}),
		});
		const body = await readJson(response);
		if (response.status === HTTP_UNAUTHORIZED) {
			return { kind: "unauthenticated", statusCode: HTTP_UNAUTHORIZED };
		}
		if (!response.ok) {
			return {
				kind: "error",
				statusCode: response.status,
				message: errorMessage("Billing status failed", response.status),
			};
		}
		if (!isBillingStatus(body)) {
			return {
				kind: "error",
				statusCode: response.status,
				message: "Billing status response did not match the expected contract.",
			};
		}
		return { kind: "ok", status: body };
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError") {
			return { kind: "error", message: "aborted" };
		}
		return {
			kind: "error",
			message: error instanceof Error ? error.message : "Billing status failed",
		};
	}
}

/**
 * Lists recent server export jobs for the compact account panel.
 *
 * The panel only needs read-only metadata (kind, status, request, timestamps), so
 * this helper validates that minimal public contract and ignores artifact/result
 * payloads owned by the export feature.
 */
export async function fetchBillingExportJobs(
	signal?: AbortSignal,
): Promise<BillingExportJobsResult> {
	try {
		const response = await fetch(EXPORT_JOBS_PATH, {
			headers: { accept: "application/json" },
			...(signal ? { signal } : {}),
		});
		const body = await readJson(response);
		if (response.status === HTTP_UNAUTHORIZED) {
			return { kind: "unauthenticated", statusCode: HTTP_UNAUTHORIZED };
		}
		if (!response.ok) {
			return {
				kind: "error",
				statusCode: response.status,
				message: errorMessage("Export job list failed", response.status),
			};
		}
		if (!isRecord(body) || !Array.isArray(body.jobs)) {
			return {
				kind: "error",
				statusCode: response.status,
				message:
					"Export job list response did not match the expected contract.",
			};
		}
		if (!body.jobs.every(isBillingExportJobRecord)) {
			return {
				kind: "error",
				statusCode: response.status,
				message:
					"Export job list response did not match the expected contract.",
			};
		}
		return { kind: "ok", jobs: body.jobs };
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError") {
			return { kind: "error", message: "aborted" };
		}
		return {
			kind: "error",
			message:
				error instanceof Error ? error.message : "Export job list failed",
		};
	}
}

/**
 * Loads the full account-panel read model without introducing global state.
 *
 * Account bootstrap is the only blocking read: signed-out users should not pay
 * the extra billing/jobs round trips. Once signed in, status and recent jobs are
 * fetched in parallel and can fail independently; those failures become compact
 * panel rows instead of replacing the editor workspace.
 */
export async function fetchBillingEntrySnapshot(
	signal?: AbortSignal,
): Promise<BillingEntryResult> {
	const bootstrap = await fetchAccountBootstrap(signal);
	if (bootstrap.kind === "unauthenticated") return { kind: "unauthenticated" };
	if (bootstrap.kind === "error") {
		return { kind: "error", message: bootstrap.message };
	}

	const [billingStatus, exportJobs] = await Promise.all([
		fetchBillingStatus(signal),
		fetchBillingExportJobs(signal),
	]);

	if (billingStatus.kind === "unauthenticated") {
		return { kind: "unauthenticated" };
	}

	return {
		kind: "ok",
		snapshot: {
			bootstrap: bootstrap.bootstrap,
			billingStatus: billingStatus.kind === "ok" ? billingStatus.status : null,
			billingStatusError:
				billingStatus.kind === "error" ? billingStatus.message : null,
			exportJobs,
		},
	};
}

/**
 * Signs in through Better Auth's headless email/password endpoint.
 *
 * Success means the Worker accepted the credentials and set its session cookie;
 * callers should refresh account bootstrap immediately afterward. Failures are
 * collapsed to a short message so the TopBar can keep the editor usable instead
 * of replacing the canvas with an auth page.
 */
export async function signInWithEmail(
	credentials: SignInCredentials,
): Promise<AuthActionResult> {
	return postAuthJson(
		SIGN_IN_EMAIL_PATH,
		{
			email: credentials.email,
			password: credentials.password,
			rememberMe: true,
		},
		"Sign in failed",
	);
}

/**
 * Creates an account through Better Auth's headless email/password endpoint.
 *
 * The Worker remains the authority for password policy, duplicate email
 * handling, and session creation. The client only posts the compact form fields
 * and reports JSON/non-JSON failures inline.
 */
export async function signUpWithEmail(
	credentials: SignUpCredentials,
): Promise<AuthActionResult> {
	return postAuthJson(
		SIGN_UP_EMAIL_PATH,
		{
			name: credentials.name,
			email: credentials.email,
			password: credentials.password,
			rememberMe: true,
		},
		"Sign up failed",
	);
}

/**
 * Signs out the current Better Auth session.
 *
 * Better Auth returns success even when there is no active session cookie; that
 * is acceptable for this compact entry because the next bootstrap refresh is the
 * source of truth for signed-in vs signed-out presentation.
 */
export async function signOutCurrentSession(): Promise<AuthActionResult> {
	return postAuthJson(SIGN_OUT_PATH, {}, "Sign out failed");
}

export type LocalDevBillingPlan = (typeof subscriptionPlans)[number];
export type LocalDevBillingStatus = (typeof localDevBillingStatuses)[number];

const localDevBillingStatusForPlan = (
	plan: LocalDevBillingPlan,
): LocalDevBillingStatus => (plan === "free" ? "free" : "active");

/**
 * Localhost-only helper for exercising paid entitlement paths in development.
 * The production Worker returns 404 for this route; callers should only show the
 * control on local hosts and refresh account bootstrap after success.
 */
export async function applyLocalDevBillingOverride(
	plan: LocalDevBillingPlan,
): Promise<AuthActionResult> {
	return postAuthJson(
		LOCAL_DEV_BILLING_SUBSCRIPTION_PATH,
		{
			plan,
			status: localDevBillingStatusForPlan(plan),
		},
		"Local billing override failed",
	);
}

/**
 * Permanently deletes the signed-in account and every record owned by it.
 *
 * The Worker re-checks that `confirmEmail` matches the session email, so this is
 * the network half of the UI's "re-type your email" safeguard; the client still
 * gates the action on a match first for immediate feedback. On success the caller
 * should clear the now-dead session via {@link signOutCurrentSession} and refresh
 * account state. This action is irreversible.
 */
export async function deleteCurrentAccount(
	confirmEmail: string,
): Promise<AuthActionResult> {
	try {
		const response = await fetch(ACCOUNT_DELETE_PATH, {
			method: "DELETE",
			credentials: "same-origin",
			headers: AUTH_JSON_HEADERS,
			body: JSON.stringify({ confirmEmail }),
		});
		if (response.ok) return { ok: true };
		return {
			ok: false,
			message: await readAuthFailureMessage(
				response,
				"Account deletion failed",
			),
		};
	} catch (error) {
		return {
			ok: false,
			message:
				error instanceof Error ? error.message : "Account deletion failed",
		};
	}
}

/**
 * Resolves the `{ url }` redirect target from a Better Auth Polar plugin
 * response. Both the checkout and portal endpoints answer with the same shape
 * (`{ url, redirect }`); on a non-2xx or a missing url this returns `null` so the
 * caller can keep the editor usable and surface a compact error instead of
 * navigating to `undefined`.
 */
async function readRedirectUrl(response: Response): Promise<string | null> {
	if (!response.ok) return null;
	try {
		const body = (await response.json()) as { url?: unknown };
		return typeof body.url === "string" && body.url.length > 0
			? body.url
			: null;
	} catch {
		return null;
	}
}

function isEmbeddedCheckoutSession(
	value: unknown,
): value is EmbeddedCheckoutSession {
	if (typeof value !== "object" || value === null) return false;
	const envelope = value as Readonly<Record<string, unknown>>;
	if (envelope.provider !== "polar") return false;
	if (envelope.plan !== "creator" && envelope.plan !== "creator_pro") {
		return false;
	}
	const checkout = envelope.checkout;
	if (typeof checkout !== "object" || checkout === null) return false;
	const session = checkout as Readonly<Record<string, unknown>>;
	return (
		typeof session.id === "string" &&
		session.id.length > 0 &&
		typeof session.url === "string" &&
		session.url.length > 0 &&
		typeof session.clientSecret === "string" &&
		session.clientSecret.length > 0 &&
		typeof session.expiresAt === "string" &&
		session.expiresAt.length > 0 &&
		typeof session.embedOrigin === "string" &&
		session.embedOrigin.length > 0
	);
}

const currentReturnPath = (): string => {
	const location = globalThis.location;
	return `${location.pathname}${location.search}${location.hash}`;
};

/**
 * Creates a Worker-owned embedded Polar checkout session for a paid plan.
 *
 * This is the bundle-safe client mirror of the Worker endpoint: it posts only
 * the internal paid plan plus an optional same-origin return path, and it
 * accepts only the stable JSON envelope. Callers that still want hosted
 * navigation can use the returned `checkout.url`; future embedded checkout UI can
 * use the same payload's `clientSecret` without importing Polar browser SDK code.
 */
export async function createEmbeddedCheckoutSession(
	plan: UpgradeTargetPlan,
	returnPath = currentReturnPath(),
): Promise<EmbeddedCheckoutSession | null> {
	try {
		const response = await fetch(EMBEDDED_CHECKOUT_SESSION_PATH, {
			method: "POST",
			credentials: "same-origin",
			headers: {
				"content-type": "application/json",
				accept: "application/json",
			},
			body: JSON.stringify({ plan, returnPath }),
		});
		if (!response.ok) return null;
		const body = (await response.json()) as unknown;
		return isEmbeddedCheckoutSession(body) ? body : null;
	} catch {
		return null;
	}
}

/**
 * Resolves a hosted Polar checkout URL for a plan via the Better Auth Polar
 * plugin route. This is the degraded fallback the embedded-checkout flow offers
 * as a clickable affordance when an embed session cannot be created or the embed
 * library fails to load — the URL opens in a popup window on a fresh user
 * gesture, never via top-level navigation. The client still sends only a plan
 * slug; product ids and Polar SDK code stay on the Worker side.
 */
export async function createHostedCheckoutUrl(
	plan: UpgradeTargetPlan,
): Promise<string | null> {
	const response = await fetch(CHECKOUT_PATH, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json",
		},
		body: JSON.stringify({ slug: plan }),
	});
	return readRedirectUrl(response);
}

const DEFAULT_POLL_ATTEMPTS = 8 as const;
const DEFAULT_POLL_INTERVAL_MS = 1500 as const;

const abortError = (): DOMException =>
	new DOMException("aborted", "AbortError");

/**
 * Abortable delay used between billing-status poll attempts. Rejects with an
 * `AbortError` if the signal fires so the caller can stop polling immediately on
 * unmount or dismissal.
 */
const wait = (ms: number, signal?: AbortSignal): Promise<void> =>
	new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(abortError());
			return;
		}
		const onAbort = () => {
			clearTimeout(timer);
			reject(abortError());
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
	});

export type BillingStatusPollResult = {
	readonly settled: boolean;
	readonly status: BillingStatus | null;
};

/**
 * Polls `/api/billing/status` until the entitlement mirror reflects a settled
 * state or the attempt budget is exhausted.
 *
 * Entitlement truth is webhook-driven (Polar → D1), so a freshly completed
 * embedded checkout flips the plan only once the webhook lands. The embedded
 * checkout flow calls this after the iframe reports `success` to detect the plan
 * change without leaving the editor; a `settled: false` result is the webhook-lag
 * case the UI surfaces as a terminal "refresh in a moment" state rather than an
 * error. `delay` and `fetchStatus` are injectable so the loop is unit-testable
 * without timers or a network.
 */
export async function pollBillingStatusUntil(
	isSettled: (status: BillingStatus) => boolean,
	options: {
		readonly attempts?: number;
		readonly intervalMs?: number;
		readonly signal?: AbortSignal;
		readonly delay?: (ms: number, signal?: AbortSignal) => Promise<void>;
		readonly fetchStatus?: (
			signal?: AbortSignal,
		) => Promise<BillingStatusResult>;
	} = {},
): Promise<BillingStatusPollResult> {
	const attempts = options.attempts ?? DEFAULT_POLL_ATTEMPTS;
	const intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
	const delay = options.delay ?? wait;
	const fetchStatus = options.fetchStatus ?? fetchBillingStatus;
	let latest: BillingStatus | null = null;

	for (let attempt = 0; attempt < attempts; attempt += 1) {
		if (options.signal?.aborted) break;
		const result = await fetchStatus(options.signal);
		if (result.kind === "ok") {
			latest = result.status;
			if (isSettled(result.status)) {
				return { settled: true, status: result.status };
			}
		}
		if (attempt < attempts - 1) {
			try {
				await delay(intervalMs, options.signal);
			} catch {
				break;
			}
		}
	}
	return { settled: false, status: latest };
}

const isPortalCapabilities = (value: unknown): value is PortalCapabilities => {
	if (!isRecord(value)) return false;
	return (
		typeof value.canChangePlan === "boolean" &&
		typeof value.canCancel === "boolean" &&
		typeof value.canReactivate === "boolean" &&
		(value.paymentMethodUpdate === "popup" ||
			value.paymentMethodUpdate === "none")
	);
};

const isNullableString = (value: unknown): value is string | null =>
	value === null || typeof value === "string";

const isPortalSubscriptionView = (
	value: unknown,
): value is PortalSubscriptionView => {
	if (!isRecord(value)) return false;
	return (
		typeof value.id === "string" &&
		isStringIn(value.plan, subscriptionPlans) &&
		isStringIn(value.status, subscriptionStatuses) &&
		typeof value.amount === "number" &&
		typeof value.currency === "string" &&
		isNullableString(value.currentPeriodEnd) &&
		typeof value.cancelAtPeriodEnd === "boolean" &&
		isNullableString(value.canceledAt) &&
		isNullableString(value.endsAt)
	);
};

const isPortalOrderView = (value: unknown): value is PortalOrderView => {
	if (!isRecord(value)) return false;
	return (
		typeof value.id === "string" &&
		typeof value.createdAt === "string" &&
		typeof value.amount === "number" &&
		typeof value.currency === "string" &&
		typeof value.status === "string" &&
		typeof value.paid === "boolean" &&
		typeof value.invoiceAvailable === "boolean"
	);
};

function isPortalOverview(value: unknown): value is PortalOverview {
	if (!isRecord(value) || value.provider !== "polar") return false;
	if (!isPortalCapabilities(value.capabilities)) return false;
	if (!Array.isArray(value.orders) || !value.orders.every(isPortalOrderView)) {
		return false;
	}
	return (
		value.subscription === null || isPortalSubscriptionView(value.subscription)
	);
}

/**
 * Reads the in-app customer-portal overview for the signed-in user.
 *
 * Replaces the old hosted-portal redirect: this fetches the sanitized
 * subscription/orders/capabilities envelope the manage dialog renders, so the
 * editor tab stays on its own origin. A `401` is the signed-out state; a `424`
 * (billing disabled, no Polar customer, or portal unavailable) folds to
 * `no-customer` so the dialog offers checkout. The subscription is `null` for a
 * signed-in customer with no live subscription — also a checkout offer, not an
 * error.
 */
export async function fetchPortalOverview(
	signal?: AbortSignal,
): Promise<PortalOverviewResult> {
	try {
		const response = await fetch(PORTAL_OVERVIEW_PATH, {
			headers: { accept: "application/json" },
			...(signal ? { signal } : {}),
		});
		if (response.status === HTTP_UNAUTHORIZED) {
			return { kind: "unauthenticated" };
		}
		if (response.status === HTTP_BILLING_UNAVAILABLE) {
			return { kind: "no-customer" };
		}
		if (!response.ok) {
			return {
				kind: "error",
				message: `Billing portal failed (${response.status})`,
			};
		}
		const body = await readJson(response);
		if (!isPortalOverview(body)) {
			return {
				kind: "error",
				message: "Billing portal response did not match the expected contract.",
			};
		}
		return { kind: "ok", overview: body };
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError") {
			return { kind: "error", message: "aborted" };
		}
		return {
			kind: "error",
			message: error instanceof Error ? error.message : "Billing portal failed",
		};
	}
}

const isPortalPendingUpdateView = (
	value: unknown,
): value is PortalPendingUpdateView => {
	if (!isRecord(value)) return false;
	return (
		(value.plan === null || isStringIn(value.plan, subscriptionPlans)) &&
		isNullableString(value.effectiveAt)
	);
};

/**
 * Maps a mutation route's HTTP response to a {@link PortalMutationResult}. The
 * Worker tags typed states with a `code` field; the client keys off `code` (with
 * status as the fallback) so a `402`/`422`/`409`/`403` becomes a specific, calm
 * UI state rather than a generic error. A `200` validates the subscription view and
 * threads through any `pendingUpdate` (present only on change-plan).
 */
async function mapMutationResponse(
	response: Response,
): Promise<PortalMutationResult> {
	if (response.ok) {
		const body = await readJson(response);
		if (!isRecord(body) || !isPortalSubscriptionView(body.subscription)) {
			return { kind: "error", message: "Unexpected billing response." };
		}
		// A present-but-malformed pendingUpdate must fail closed, not coerce to
		// null: coercing a queued downgrade to null would route change-plan into
		// the immediate-upgrade poll that waits for a flip that never lands.
		// `null` is the legitimate immediate-upgrade value and is allowed through.
		if (
			body.pendingUpdate !== undefined &&
			body.pendingUpdate !== null &&
			!isPortalPendingUpdateView(body.pendingUpdate)
		) {
			return { kind: "error", message: "Unexpected billing response." };
		}
		const pendingUpdate = body.pendingUpdate as
			| PortalPendingUpdateView
			| null
			| undefined;
		return { kind: "ok", subscription: body.subscription, pendingUpdate };
	}

	const body = await readJson(response).catch(() => null);
	const code = isRecord(body) && typeof body.code === "string" ? body.code : "";

	if (response.status === HTTP_PAYMENT_REQUIRED || code === "payment_failed") {
		return { kind: "payment_failed" };
	}
	// Only the typed code splits off this state: other 422 causes (unknown plan,
	// provider validation) stay on the generic error path with the Worker's copy.
	if (
		response.status === HTTP_UNPROCESSABLE &&
		code === "payment_method_required"
	) {
		return { kind: "payment_method_required" };
	}
	if (response.status === HTTP_CONFLICT && code === "subscription_locked") {
		return { kind: "subscription_locked" };
	}
	if (
		response.status === HTTP_FORBIDDEN &&
		code === "customer-changes-disabled"
	) {
		return { kind: "changes_disabled" };
	}
	const message =
		isRecord(body) && typeof body.error === "string"
			? body.error
			: `Billing portal failed (${response.status})`;
	return { kind: "error", message };
}

const postMutation = async (
	path: string,
	payload: Record<string, unknown>,
): Promise<PortalMutationResult> => {
	try {
		const response = await fetch(path, {
			method: "POST",
			credentials: "same-origin",
			headers: AUTH_JSON_HEADERS,
			body: JSON.stringify(payload),
		});
		return await mapMutationResponse(response);
	} catch (error) {
		return {
			kind: "error",
			message: error instanceof Error ? error.message : "Billing portal failed",
		};
	}
};

/**
 * Cancels the subscription at period end (the customer keeps access until the
 * current period ends). `reason`/`comment` are optional telemetry passed through
 * to Polar. Stays on-domain; the editor tab never navigates.
 */
export function cancelSubscription(
	subscriptionId: string,
	options: { readonly reason?: string; readonly comment?: string } = {},
): Promise<PortalMutationResult> {
	return postMutation(PORTAL_CANCEL_PATH, {
		subscriptionId,
		...(options.reason ? { reason: options.reason } : {}),
		...(options.comment ? { comment: options.comment } : {}),
	});
}

/** Clears a pending cancellation so the subscription renews normally. */
export function reactivateSubscription(
	subscriptionId: string,
): Promise<PortalMutationResult> {
	return postMutation(PORTAL_REACTIVATE_PATH, { subscriptionId });
}

/**
 * Switches the subscription to another plan (Creator ↔ Creator Pro). An upgrade
 * typically applies immediately (`pendingUpdate: null`); a downgrade is queued
 * to the period end (`pendingUpdate` set), which the caller uses to choose
 * between "right away" and "on {date}" copy and whether to poll for the flip.
 */
export function changeSubscriptionPlan(
	subscriptionId: string,
	plan: UpgradeTargetPlan,
): Promise<PortalMutationResult> {
	return postMutation(PORTAL_CHANGE_PLAN_PATH, { subscriptionId, plan });
}

/**
 * Resolves the hosted invoice URL for an order, for opening in a popup. Returns
 * null when the invoice is not available yet (e.g. still generating, or missing
 * billing details). The URL is short-lived and MUST NOT be logged or cached.
 */
export async function fetchOrderInvoiceUrl(
	orderId: string,
): Promise<string | null> {
	try {
		const response = await fetch(
			`${PORTAL_ORDERS_PATH}/${encodeURIComponent(orderId)}/invoice`,
			{ credentials: "same-origin", headers: { accept: "application/json" } },
		);
		if (!response.ok) return null;
		const body = await readJson(response);
		return isRecord(body) && typeof body.url === "string" ? body.url : null;
	} catch {
		return null;
	}
}

/**
 * Mints a customer-session token for Polar's on-domain payment-method embed.
 * Returns the short-lived token (the user's own customer-scoped credential) or
 * null on failure, in which case the caller falls back to the hosted card popup.
 * The token MUST be handed straight to the embed and never logged or cached.
 */
export async function createPaymentMethodSession(): Promise<string | null> {
	try {
		const response = await fetch(PORTAL_PAYMENT_METHOD_SESSION_PATH, {
			method: "POST",
			credentials: "same-origin",
			headers: AUTH_JSON_HEADERS,
			body: "{}",
		});
		if (!response.ok) return null;
		const body = await readJson(response);
		return isRecord(body) && typeof body.sessionToken === "string"
			? body.sessionToken
			: null;
	} catch {
		return null;
	}
}

/**
 * Opens Polar's hosted card-update surface in a popup window on the user's
 * gesture. The blank popup is opened synchronously (so the gesture is not lost
 * across the `await`) and its `opener` is severed for security; the minted URL
 * (which carries its own short-lived credential) is set as the popup's location
 * and is never logged. Returns a calm failure when the mint fails or the popup
 * is blocked.
 *
 * The two-step open cannot pass `noreferrer` in a window-features string the way
 * the blocked-popup fallback does, so a `no-referrer` policy is written into the
 * blank document before navigation to keep the `Referer` header off the request
 * to `polar.sh`. (Even without it the leak would be only the bare origin, which
 * Polar already knows, and never any credential — `opener` is already severed.)
 */
export async function openPaymentMethodPopup(): Promise<
	{ readonly ok: true } | { readonly ok: false; readonly message: string }
> {
	const popup = window.open("about:blank", "_blank");
	if (popup) {
		popup.opener = null;
		try {
			popup.document.write('<meta name="referrer" content="no-referrer">');
		} catch {
			// Some browsers disallow writing to the blank popup; the origin-only
			// Referer fallback is harmless, so ignore and continue to navigate.
		}
	}
	try {
		const response = await fetch(PORTAL_MANAGE_PAYMENT_PATH, {
			method: "POST",
			credentials: "same-origin",
			headers: AUTH_JSON_HEADERS,
			body: "{}",
		});
		if (!response.ok) {
			popup?.close();
			return { ok: false, message: "Couldn't open the card update window." };
		}
		const body = await readJson(response);
		if (!isRecord(body) || typeof body.url !== "string") {
			popup?.close();
			return { ok: false, message: "Couldn't open the card update window." };
		}
		if (popup) {
			popup.location.href = body.url;
		} else {
			// The sync pre-open was blocked (e.g. this is the fallback after the
			// embed timed out and the click gesture is gone). A second open here is
			// also gesture-less and may be blocked — surface that instead of
			// silently reporting success.
			const fallback = window.open(body.url, "_blank", "noopener,noreferrer");
			if (!fallback) {
				return {
					ok: false,
					message:
						"Couldn't open the card update window. Allow popups for this site and try again.",
				};
			}
		}
		return { ok: true };
	} catch {
		popup?.close();
		return { ok: false, message: "Couldn't open the card update window." };
	}
}
