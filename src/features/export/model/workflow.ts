import type { ExportBundleManifest } from "./bundle";
import {
	type ExportReportIssueLike,
	type ExportReportIssueSummary,
	summarizeExportReportIssues,
} from "./issues";
import {
	type CreateExportPackagePlanInput,
	createExportPackagePlan,
	type ExportPackageDelivery,
	type ExportPackageDeliveryDecision,
	type ExportPackagePlan,
	type ExportServerJobContractGap,
	type ExportServerJobIntent,
	type ServerExportJobDenialBody,
	type ServerExportJobError,
	type ServerExportJobRecord,
	type ServerExportJobRequest,
	type ServerExportJobResult,
	type ServerExportJobStatus,
} from "./job";
import {
	artboardIssuesAsReportIssues,
	motionIssuesAsReportIssues,
} from "./preview";

/** Client-visible status shared by local bundle and server export workflows. */
export type ExportWorkflowStatus =
	| "ready"
	| "queued"
	| "running"
	| "succeeded"
	| "failed"
	| "denied"
	| "canceled";

/** Compact severity tone for status badges/cards; issue severity stays separate. */
export type ExportWorkflowStatusTone =
	| "neutral"
	| "progress"
	| "success"
	| "warning"
	| "danger";

/** Next action a UI bridge can expose without re-deriving delivery state. */
export type ExportWorkflowAction =
	| "download-local-bundle"
	| "create-server-job"
	| "poll-server-job"
	| "review-server-result"
	| "retry-server-job"
	| "sign-in"
	| "none";

/** Normalized state fed by server job adapters after create/status reads. */
export type ExportServerJobWorkflowState =
	| {
			readonly kind: "intent";
	  }
	| {
			readonly kind: "created";
			readonly job: ServerExportJobRecord;
			readonly remainingMonthlyServerExportJobs: number;
	  }
	| {
			readonly kind: "record";
			readonly job: ServerExportJobRecord;
	  }
	| {
			readonly kind: "denied";
			readonly status?: 400 | 402 | 403;
			readonly denial: ServerExportJobDenialBody;
	  }
	| {
			readonly kind: "unauthenticated";
			readonly status: 401;
	  }
	| {
			readonly kind: "not-found";
			readonly status: 404;
			readonly jobId: string;
	  }
	| {
			readonly kind: "error";
			readonly status?: number;
			readonly message: string;
			readonly issues?: readonly string[];
	  };

/** Artifact metadata exposed by successful server jobs without inlining bytes. */
export type ExportWorkflowServerArtifact = {
	readonly kind: "svg";
	readonly artifactKey: string;
	readonly byteLength: number;
	readonly width: number;
	readonly height: number;
};

/** Server branch details carried alongside the shared manifest/report summary. */
export type ExportWorkflowServerJob = {
	readonly endpointPath: ExportServerJobIntent["endpointPath"];
	readonly request: ServerExportJobRequest;
	readonly requestBody: string;
	readonly contractGaps: readonly ExportServerJobContractGap[];
	readonly jobId?: string;
	readonly jobStatus?: ServerExportJobStatus;
	readonly result?: ServerExportJobResult;
	readonly error?: ServerExportJobError;
	readonly denial?: ServerExportJobDenialBody;
	readonly httpStatus?: number;
	readonly remainingMonthlyServerExportJobs?: number;
	readonly artifact?: ExportWorkflowServerArtifact;
};

/** Single report model consumed by UI surfaces for either export delivery path. */
export type ExportWorkflowReport = {
	readonly delivery: ExportPackageDelivery;
	readonly decision: ExportPackageDeliveryDecision;
	readonly status: ExportWorkflowStatus;
	readonly statusLabel: string;
	readonly statusTone: ExportWorkflowStatusTone;
	readonly title: string;
	readonly manifest: ExportBundleManifest;
	readonly assetFileNames: readonly string[];
	readonly issueCount: number;
	readonly issues: readonly ExportReportIssueLike[];
	readonly issueSummary: ExportReportIssueSummary;
	readonly primaryAction: ExportWorkflowAction;
	readonly secondaryAction?: ExportWorkflowAction;
	readonly serverJob?: ExportWorkflowServerJob;
};

/** Input for reporting an already-created package plan and optional job state. */
export type CreateExportWorkflowReportInput = {
	readonly plan: ExportPackagePlan;
	readonly serverJobState?: ExportServerJobWorkflowState;
};

/** Input for building a package plan and workflow report in one client call. */
export type CreateExportClientWorkflowInput = CreateExportPackagePlanInput & {
	readonly serverJobState?: ExportServerJobWorkflowState;
};

const statusCopy: Readonly<
	Record<
		ExportWorkflowStatus,
		{
			readonly label: string;
			readonly tone: ExportWorkflowStatusTone;
			readonly title: string;
		}
	>
> = {
	ready: {
		label: "Ready",
		tone: "neutral",
		title: "Server export ready",
	},
	queued: {
		label: "Queued",
		tone: "progress",
		title: "Server export queued",
	},
	running: {
		label: "Running",
		tone: "progress",
		title: "Server export running",
	},
	succeeded: {
		label: "Succeeded",
		tone: "success",
		title: "Export ready",
	},
	failed: {
		label: "Failed",
		tone: "danger",
		title: "Server export failed",
	},
	denied: {
		label: "Denied",
		tone: "warning",
		title: "Server export unavailable",
	},
	canceled: {
		label: "Canceled",
		tone: "warning",
		title: "Server export canceled",
	},
};

const denialMessages: Readonly<
	Record<ServerExportJobDenialBody["reason"], string>
> = {
	subscription_missing:
		"Server export requires an active Creator subscription.",
	subscription_inactive:
		"Server export is unavailable because the subscription is inactive.",
	subscription_incomplete:
		"Server export is unavailable until subscription setup is complete.",
	subscription_paused:
		"Server export is unavailable while the subscription is paused.",
	payment_required: "Server export is unavailable until payment is resolved.",
	plan_feature_unavailable: "Server export is unavailable on the current plan.",
	monthly_export_limit_reached:
		"Server export is unavailable because the monthly export limit is reached.",
	export_size_limit_exceeded:
		"Server export is unavailable because the export exceeds the plan size limit.",
	motion_duration_limit_exceeded:
		"Server export is unavailable because the motion duration exceeds the plan limit.",
	invalid_export_request:
		"Server export request was rejected by the Worker contract.",
};

const assetFileNamesForManifest = (
	manifest: ExportBundleManifest,
): readonly string[] => manifest.assets.map((asset) => asset.fileName);

const manifestIssuesAsReportIssues = (
	manifest: ExportBundleManifest,
): readonly ExportReportIssueLike[] => [
	...manifest.issues.map((issue) => ({
		severity: issue.severity,
		category: issue.category,
		code: issue.code,
		message: issue.message,
		fallback: issue.fallback,
		layerId: issue.layerId,
		nodeId: issue.nodeId,
		assetId: issue.assetId,
		artboardId: issue.artboardId,
		requestedArtboardId: issue.requestedArtboardId,
		trackId: issue.trackId,
		assetFileName: issue.assetFileName,
		assetRole: issue.assetRole,
	})),
	...artboardIssuesAsReportIssues(manifest.artboards.issues),
	...motionIssuesAsReportIssues(
		manifest.motionPresentation.currentFrame.issues,
	),
];

const decisionIssuesForPlan = (
	plan: ExportPackagePlan,
): readonly ExportReportIssueLike[] => {
	if (plan.decision.reason !== "server-job-unavailable") return [];
	return [
		{
			severity: "warning",
			category: "unsupported",
			code: "server-job-unavailable",
			message:
				"Server export jobs are unavailable, so the workflow will use the local bundle.",
			assetRole: "server-job",
		},
	];
};

const contractGapIssuesForIntent = (
	intent: ExportServerJobIntent,
): readonly ExportReportIssueLike[] =>
	intent.contractGaps.map((gap) => ({
		severity: gap.severity,
		category: gap.severity === "warning" ? "unsupported" : "normalized",
		code: gap.code,
		message: gap.message,
		assetFileName: gap.endpointPath,
		assetRole: "server-job-contract",
	}));

const deniedIssue = (
	denial: ServerExportJobDenialBody,
): ExportReportIssueLike => ({
	severity: denial.reason === "invalid_export_request" ? "error" : "warning",
	category:
		denial.reason === "invalid_export_request" ? "invalid" : "unsupported",
	code: `server-job-denied-${denial.reason}`,
	message: denialMessages[denial.reason],
	assetRole: denial.feature ?? "server-job",
});

const failedJobIssue = (
	error: ServerExportJobError,
): ExportReportIssueLike => ({
	severity: "error",
	category: "invalid",
	code: `server-job-${error.code}`,
	message: error.message,
	assetRole: "server-job",
});

const artifactDownloadIssue = (
	result: ServerExportJobResult,
): ExportReportIssueLike | undefined => {
	if (result.kind !== "svg") return undefined;
	return {
		severity: "warning",
		category: "unsupported",
		code: "server-job-artifact-download-missing",
		message:
			"Server export returned artifact metadata, but the current Worker contract does not expose an artifact download route.",
		assetId: result.artifactKey,
		assetRole: "server-job-artifact",
	};
};

const requestErrorIssues = (
	state: Extract<ExportServerJobWorkflowState, { readonly kind: "error" }>,
): readonly ExportReportIssueLike[] => [
	{
		severity: "error",
		category: "invalid",
		code: "server-job-request-error",
		message: state.message,
		assetRole: "server-job",
	},
	...(state.issues ?? []).map((message, index) => ({
		severity: "error" as const,
		category: "invalid" as const,
		code: `server-job-request-issue-${index + 1}`,
		message,
		assetRole: "server-job-contract",
	})),
];

const stateIssues = (
	state: ExportServerJobWorkflowState | undefined,
): readonly ExportReportIssueLike[] => {
	if (state === undefined || state.kind === "intent") return [];
	if (state.kind === "denied") return [deniedIssue(state.denial)];
	if (state.kind === "unauthenticated") {
		return [
			{
				severity: "warning",
				category: "unsupported",
				code: "server-job-unauthenticated",
				message: "Sign in before starting a server export job.",
				assetRole: "server-job",
			},
		];
	}
	if (state.kind === "not-found") {
		return [
			{
				severity: "error",
				category: "invalid",
				code: "server-job-not-found",
				message: "Server export job was not found for this workspace.",
				assetId: state.jobId,
				assetRole: "server-job",
			},
		];
	}
	if (state.kind === "error") return requestErrorIssues(state);
	const error = state.job.error;
	if (state.job.status === "failed" && error !== undefined) {
		return [failedJobIssue(error)];
	}
	const artifactIssue =
		state.job.status === "succeeded" && state.job.result !== undefined
			? artifactDownloadIssue(state.job.result)
			: undefined;
	return artifactIssue === undefined ? [] : [artifactIssue];
};

const statusForState = (
	plan: ExportPackagePlan,
	state: ExportServerJobWorkflowState | undefined,
): ExportWorkflowStatus => {
	if (plan.delivery === "local-bundle") return "succeeded";
	if (state === undefined || state.kind === "intent") return "ready";
	if (state.kind === "created" || state.kind === "record") {
		return state.job.status;
	}
	if (state.kind === "denied" || state.kind === "unauthenticated") {
		return "denied";
	}
	return "failed";
};

const primaryActionForStatus = (
	delivery: ExportPackageDelivery,
	status: ExportWorkflowStatus,
	state: ExportServerJobWorkflowState | undefined,
): ExportWorkflowAction => {
	if (delivery === "local-bundle") return "download-local-bundle";
	if (state?.kind === "unauthenticated") return "sign-in";
	switch (status) {
		case "ready":
			return "create-server-job";
		case "queued":
		case "running":
			return "poll-server-job";
		case "succeeded":
			return "review-server-result";
		case "failed":
		case "denied":
		case "canceled":
			return "download-local-bundle";
	}
};

const secondaryActionForStatus = (
	delivery: ExportPackageDelivery,
	status: ExportWorkflowStatus,
	state: ExportServerJobWorkflowState | undefined,
): ExportWorkflowAction | undefined => {
	if (delivery === "local-bundle") return undefined;
	if (state?.kind === "unauthenticated") return "download-local-bundle";
	const job = jobFromState(state);
	if (status === "succeeded" && job?.result?.kind === "svg") {
		return "download-local-bundle";
	}
	return status === "failed" || status === "canceled"
		? "retry-server-job"
		: undefined;
};

const jobFromState = (
	state: ExportServerJobWorkflowState | undefined,
): ServerExportJobRecord | undefined => {
	if (state?.kind === "created" || state?.kind === "record") return state.job;
	return undefined;
};

const svgArtifactForResult = (
	result: ServerExportJobResult | undefined,
): ExportWorkflowServerArtifact | undefined => {
	if (result?.kind !== "svg") return undefined;
	return {
		kind: "svg",
		artifactKey: result.artifactKey,
		byteLength: result.byteLength,
		width: result.width,
		height: result.height,
	};
};

const serverJobForReport = (
	plan: ExportPackagePlan,
	state: ExportServerJobWorkflowState | undefined,
): ExportWorkflowServerJob | undefined => {
	if (plan.delivery !== "server-job") return undefined;
	const job = jobFromState(state);
	const httpStatus =
		state?.kind === "denied" ||
		state?.kind === "unauthenticated" ||
		state?.kind === "not-found" ||
		state?.kind === "error"
			? state.status
			: undefined;
	return {
		endpointPath: plan.serverJob.endpointPath,
		request: plan.serverJob.request,
		requestBody: plan.serverJob.requestBody,
		contractGaps: plan.serverJob.contractGaps,
		...(job ? { jobId: job.id, jobStatus: job.status } : {}),
		...(job?.result ? { result: job.result } : {}),
		...(job?.error ? { error: job.error } : {}),
		...(state?.kind === "denied" ? { denial: state.denial } : {}),
		...(httpStatus !== undefined ? { httpStatus } : {}),
		...(state?.kind === "created"
			? {
					remainingMonthlyServerExportJobs:
						state.remainingMonthlyServerExportJobs,
				}
			: {}),
		...(svgArtifactForResult(job?.result)
			? { artifact: svgArtifactForResult(job?.result) }
			: {}),
	};
};

const reportIssuesForPlan = (
	plan: ExportPackagePlan,
	state: ExportServerJobWorkflowState | undefined,
): readonly ExportReportIssueLike[] => [
	...manifestIssuesAsReportIssues(plan.manifest),
	...decisionIssuesForPlan(plan),
	...(plan.delivery === "server-job"
		? contractGapIssuesForIntent(plan.serverJob)
		: []),
	...(plan.delivery === "server-job" ? stateIssues(state) : []),
];

/**
 * Builds the single client-side report shape that local bundle and server job
 * UI can consume. It keeps manifest, issue grouping, status, and fallback action
 * derivation in the export feature so widgets do not duplicate export logic.
 */
export function createExportWorkflowReport({
	plan,
	serverJobState,
}: CreateExportWorkflowReportInput): ExportWorkflowReport {
	const status = statusForState(plan, serverJobState);
	const copy = statusCopy[status];
	const issues = reportIssuesForPlan(plan, serverJobState);
	const issueSummary = summarizeExportReportIssues(issues);
	return {
		delivery: plan.delivery,
		decision: plan.decision,
		status,
		statusLabel: copy.label,
		statusTone: copy.tone,
		title:
			plan.delivery === "local-bundle" && plan.decision.reason !== "auto-local"
				? "Local export bundle ready"
				: copy.title,
		manifest: plan.manifest,
		assetFileNames: assetFileNamesForManifest(plan.manifest),
		issueCount: issueSummary.total,
		issues,
		issueSummary,
		primaryAction: primaryActionForStatus(
			plan.delivery,
			status,
			serverJobState,
		),
		...(secondaryActionForStatus(plan.delivery, status, serverJobState)
			? {
					secondaryAction: secondaryActionForStatus(
						plan.delivery,
						status,
						serverJobState,
					),
				}
			: {}),
		...(serverJobForReport(plan, serverJobState)
			? { serverJob: serverJobForReport(plan, serverJobState) }
			: {}),
	};
}

/**
 * Convenience bridge for UI callers that need to choose local/server delivery
 * and get the normalized report in one step. The generated package plan remains
 * the source of truth, so local fallback and server intent share one manifest.
 */
export function createExportClientWorkflow({
	serverJobState,
	...input
}: CreateExportClientWorkflowInput): ExportWorkflowReport {
	return createExportWorkflowReport({
		plan: createExportPackagePlan(input),
		...(serverJobState ? { serverJobState } : {}),
	});
}
