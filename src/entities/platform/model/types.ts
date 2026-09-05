/** Billing provider ids are stored for auditability but do not change entitlements. */
export type BillingProvider = "polar" | "stripe" | "manual";

/** Commercial plan ids used across platform API, UI, and billing sync streams. */
export type SubscriptionPlan = "free" | "creator" | "creator_pro";

/**
 * Provider-neutral subscription lifecycle. Only `trialing` and `active` grant
 * paid access because this pure layer has no period-end clock or provider grace
 * policy to consult.
 */
export type SubscriptionStatus =
	| "none"
	| "trialing"
	| "active"
	| "past_due"
	| "canceled"
	| "unpaid"
	| "incomplete"
	| "incomplete_expired"
	| "paused";

export type EntitlementDowngradeReason =
	| "subscription_missing"
	| "subscription_inactive"
	| "subscription_incomplete"
	| "subscription_paused"
	| "payment_required";

/**
 * Feature switches that downstream routes and compact UI can consume without
 * understanding provider products. Editor editing and local export intentionally
 * stay true for every plan/status.
 */
export type EntitlementFeatures = {
	readonly editorEditing: boolean;
	readonly localFileExport: boolean;
	readonly cloudProjectStorage: boolean;
	readonly cloudProjectHistory: boolean;
	readonly serverExportJobs: boolean;
	readonly motionExportJobs: boolean;
	readonly sequenceExportJobs: boolean;
	readonly futureAiUsage: boolean;
	readonly priorityExportQueue: boolean;
};

/**
 * Usage limits are monthly counters in the account/workspace platform boundary.
 * Frame limits are expressed in document frames to match the motion domain.
 */
export type EntitlementUsageLimits = {
	readonly monthlyServerExportJobs: number;
	readonly monthlyAiCredits: number;
	readonly maxExportPixels: number;
	readonly maxMotionDurationFrames: number;
};

/**
 * Resolved entitlement snapshot. `sourcePlan`/`status` describe billing input,
 * while `plan` is the effective access tier after status downgrade.
 */
export type Entitlements = {
	readonly sourcePlan: SubscriptionPlan;
	readonly plan: SubscriptionPlan;
	readonly status: SubscriptionStatus;
	readonly billingProvider?: BillingProvider;
	readonly isSubscriptionActive: boolean;
	readonly isPaidPlan: boolean;
	readonly downgradeReason?: EntitlementDowngradeReason;
	readonly features: EntitlementFeatures;
	readonly limits: EntitlementUsageLimits;
};

/** Raw subscription state read from billing sync or account bootstrap storage. */
export type ResolveEntitlementsInput = {
	readonly plan?: SubscriptionPlan | null;
	readonly status?: SubscriptionStatus | null;
	readonly billingProvider?: BillingProvider | null;
};

/**
 * Current usage counters for the entitlement period. `periodKey` is intentionally
 * opaque so repositories can use a `YYYY-MM`, Polar period id, or future window id.
 */
export type UsageSnapshot = {
	readonly periodKey?: string;
	readonly serverExportJobsCreated: number;
	readonly aiCreditsUsed: number;
};

export type ExportJobKind = "still" | "motion" | "sequence";

export type ExportJobFormat =
	| "png"
	| "svg"
	| "pdf"
	| "webm"
	| "mp4"
	| "gif"
	| "lottie"
	| "json";

/**
 * Request metadata needed to decide if a server-side export job may be created.
 * Undefined dimensions or duration mean that a downstream validator has not yet
 * provided that estimate, so only available fields participate in limit checks.
 * `idempotencyKey` is optional; when supplied, the Worker uses it to collapse a
 * retry of the same create request onto the original job and usage charge.
 */
export type CreateExportJobRequest = {
	readonly kind: ExportJobKind;
	readonly format?: ExportJobFormat;
	readonly width?: number;
	readonly height?: number;
	readonly durationFrames?: number;
	readonly idempotencyKey?: string;
	/**
	 * Optional source document payload for a real server render. Carried as opaque
	 * JSON (not the `SceneDocument` type) so the platform request contract stays
	 * decoupled from the editor's scene model; the export runtime narrows it
	 * defensively before serializing. Additive: existing callers that send only
	 * metadata keep working, and the runtime degrades to metadata-only when it is
	 * absent or unrenderable.
	 */
	readonly document?: unknown;
};

export type ExportJobDenialReason =
	| EntitlementDowngradeReason
	| "plan_feature_unavailable"
	| "monthly_export_limit_reached"
	| "export_size_limit_exceeded"
	| "motion_duration_limit_exceeded"
	| "invalid_export_request";

export type ExportJobDenialDetail = {
	readonly reason: ExportJobDenialReason;
	readonly requiredPlan?: SubscriptionPlan;
	readonly limit?: number;
	readonly actual?: number;
	readonly feature?: keyof EntitlementFeatures;
};

export type CanCreateExportJobResult =
	| {
			readonly ok: true;
			readonly remainingMonthlyServerExportJobs: number;
	  }
	| ({
			readonly ok: false;
	  } & ExportJobDenialDetail);

export type CloudProjectStorageDenialDetail = {
	readonly reason: EntitlementDowngradeReason | "plan_feature_unavailable";
	readonly requiredPlan?: SubscriptionPlan;
	readonly feature: "cloudProjectStorage";
};

export type CanUseCloudProjectStorageResult =
	| { readonly ok: true }
	| ({
			readonly ok: false;
	  } & CloudProjectStorageDenialDetail);

export type CloudProjectHistoryDenialDetail = {
	readonly reason: EntitlementDowngradeReason | "plan_feature_unavailable";
	readonly requiredPlan?: SubscriptionPlan;
	readonly feature: "cloudProjectHistory";
};

export type CanUseCloudProjectHistoryResult =
	| { readonly ok: true }
	| ({
			readonly ok: false;
	  } & CloudProjectHistoryDenialDetail);
