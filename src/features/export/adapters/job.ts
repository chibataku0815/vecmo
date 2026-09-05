import {
	type CreateServerExportJobResponse,
	type GetServerExportJobResponse,
	type ListServerExportJobsResponse,
	SERVER_EXPORT_JOBS_ROUTE,
	type ServerExportJobDenialBody,
	type ServerExportJobDenialReason,
	type ServerExportJobRecord,
	type ServerExportJobRequest,
	serverExportJobStatusRoute,
} from "../model/job";
import type { ExportServerJobWorkflowState } from "../model/workflow";

export type CreateServerExportJobResult =
	| {
			readonly kind: "created";
			readonly response: CreateServerExportJobResponse;
	  }
	| {
			readonly kind: "denied";
			readonly status: 400 | 402 | 403;
			readonly denial: ServerExportJobDenialBody;
	  }
	| {
			readonly kind: "unauthenticated";
			readonly status: 401;
	  }
	| {
			readonly kind: "error";
			readonly status?: number;
			readonly message: string;
			readonly issues?: readonly string[];
	  };

export type ListServerExportJobsResult =
	| {
			readonly kind: "ok";
			readonly response: ListServerExportJobsResponse;
	  }
	| {
			readonly kind: "unauthenticated";
			readonly status: 401;
	  }
	| {
			readonly kind: "error";
			readonly status?: number;
			readonly message: string;
	  };

export type GetServerExportJobResult =
	| {
			readonly kind: "ok";
			readonly response: GetServerExportJobResponse;
	  }
	| {
			readonly kind: "unauthenticated";
			readonly status: 401;
	  }
	| {
			readonly kind: "not_found";
			readonly status: 404;
	  }
	| {
			readonly kind: "error";
			readonly status?: number;
			readonly message: string;
	  };

/**
 * Converts create-job adapter outcomes into the export workflow state model so
 * UI callers can update the report without duplicating HTTP/status branching.
 */
export function serverJobWorkflowStateFromCreateResult(
	result: CreateServerExportJobResult,
): ExportServerJobWorkflowState {
	switch (result.kind) {
		case "created":
			return {
				kind: "created",
				job: result.response.job,
				remainingMonthlyServerExportJobs:
					result.response.remainingMonthlyServerExportJobs,
			};
		case "denied":
			return {
				kind: "denied",
				status: result.status,
				denial: result.denial,
			};
		case "unauthenticated":
			return { kind: "unauthenticated", status: result.status };
		case "error":
			return {
				kind: "error",
				...(result.status !== undefined ? { status: result.status } : {}),
				message: result.message,
				...(result.issues ? { issues: result.issues } : {}),
			};
	}
}

/**
 * Converts status-read adapter outcomes into the export workflow state model.
 * A 404 includes the requested job id so report surfaces can show deterministic
 * missing-job diagnostics without leaking tenant existence.
 */
export function serverJobWorkflowStateFromGetResult(
	jobId: string,
	result: GetServerExportJobResult,
): ExportServerJobWorkflowState {
	switch (result.kind) {
		case "ok":
			return { kind: "record", job: result.response.job };
		case "unauthenticated":
			return { kind: "unauthenticated", status: result.status };
		case "not_found":
			return { kind: "not-found", status: result.status, jobId };
		case "error":
			return {
				kind: "error",
				...(result.status !== undefined ? { status: result.status } : {}),
				message: result.message,
			};
	}
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const serverExportJobKinds = ["still", "motion", "sequence"] as const;
const serverExportJobFormats = [
	"png",
	"svg",
	"pdf",
	"webm",
	"mp4",
	"gif",
	"lottie",
	"json",
] as const;
const serverExportJobStatuses = [
	"queued",
	"running",
	"succeeded",
	"failed",
	"canceled",
] as const;
const serverExportJobDenialReasons = [
	"subscription_missing",
	"subscription_inactive",
	"subscription_incomplete",
	"subscription_paused",
	"payment_required",
	"plan_feature_unavailable",
	"monthly_export_limit_reached",
	"export_size_limit_exceeded",
	"motion_duration_limit_exceeded",
	"invalid_export_request",
] as const satisfies readonly ServerExportJobDenialReason[];

const isStringIn = <Value extends string>(
	value: unknown,
	values: readonly Value[],
): value is Value =>
	typeof value === "string" && values.includes(value as Value);

const isServerExportJobRequest = (
	value: unknown,
): value is ServerExportJobRequest => {
	if (!isRecord(value)) return false;
	return isStringIn(value.kind, serverExportJobKinds);
};

const isOptionalNumber = (value: unknown): value is number | undefined =>
	value === undefined || typeof value === "number";

const isMetadataOnlyResult = (value: Record<string, unknown>): boolean =>
	value.kind === "metadata_only" &&
	value.message === "server_export_runtime_metadata_only" &&
	(value.format === undefined ||
		isStringIn(value.format, serverExportJobFormats)) &&
	isOptionalNumber(value.width) &&
	isOptionalNumber(value.height) &&
	isOptionalNumber(value.durationFrames);

const isSvgResult = (value: Record<string, unknown>): boolean =>
	value.kind === "svg" &&
	value.message === "server_export_runtime_svg" &&
	value.format === "svg" &&
	typeof value.width === "number" &&
	typeof value.height === "number" &&
	typeof value.artifactKey === "string" &&
	typeof value.byteLength === "number";

const isServerExportJobResult = (value: unknown): boolean => {
	if (!isRecord(value)) return false;
	return value.kind === "svg"
		? isSvgResult(value)
		: isMetadataOnlyResult(value);
};

const serverExportJobErrorCodes = ["runner_failed", "render_failed"] as const;

const isServerExportJobError = (value: unknown): boolean => {
	if (!isRecord(value)) return false;
	return (
		isStringIn(value.code, serverExportJobErrorCodes) &&
		typeof value.message === "string"
	);
};

const isServerExportJobRecord = (
	value: unknown,
): value is ServerExportJobRecord => {
	if (!isRecord(value)) return false;
	return (
		typeof value.id === "string" &&
		isStringIn(value.kind, serverExportJobKinds) &&
		isStringIn(value.status, serverExportJobStatuses) &&
		isServerExportJobRequest(value.request) &&
		(value.result === undefined || isServerExportJobResult(value.result)) &&
		(value.error === undefined || isServerExportJobError(value.error)) &&
		typeof value.createdAt === "string" &&
		typeof value.updatedAt === "string"
	);
};

const isCreateResponse = (
	value: unknown,
): value is CreateServerExportJobResponse => {
	if (!isRecord(value)) return false;
	return (
		isServerExportJobRecord(value.job) &&
		typeof value.remainingMonthlyServerExportJobs === "number"
	);
};

const isListResponse = (
	value: unknown,
): value is ListServerExportJobsResponse => {
	if (!isRecord(value) || !Array.isArray(value.jobs)) return false;
	return value.jobs.every(isServerExportJobRecord);
};

const isGetResponse = (value: unknown): value is GetServerExportJobResponse => {
	if (!isRecord(value)) return false;
	return isServerExportJobRecord(value.job);
};

const isDenialBody = (value: unknown): value is ServerExportJobDenialBody => {
	if (!isRecord(value)) return false;
	return (
		value.error === "export_job_denied" &&
		isStringIn(value.reason, serverExportJobDenialReasons)
	);
};

const readJson = async (response: Response): Promise<unknown> => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};

const invalidRequestIssues = (body: unknown): readonly string[] | undefined => {
	if (!isRecord(body) || body.error !== "invalid_export_request") {
		return undefined;
	}
	if (!Array.isArray(body.issues)) return undefined;
	const issues = body.issues.filter(
		(issue): issue is string => typeof issue === "string",
	);
	return issues.length > 0 ? issues : undefined;
};

/**
 * Creates a queued server export job through the existing same-origin Worker
 * endpoint. The adapter validates the small public JSON response shape and
 * returns typed client states instead of throwing into editor UI code.
 */
export async function createServerExportJob(
	request: ServerExportJobRequest,
	signal?: AbortSignal,
): Promise<CreateServerExportJobResult> {
	try {
		const response = await fetch(SERVER_EXPORT_JOBS_ROUTE, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json",
			},
			body: JSON.stringify(request),
			...(signal ? { signal } : {}),
		});
		const body = await readJson(response);
		if (response.status === 401) {
			return { kind: "unauthenticated", status: 401 };
		}
		if (
			(response.status === 400 ||
				response.status === 402 ||
				response.status === 403) &&
			isDenialBody(body)
		) {
			return { kind: "denied", status: response.status, denial: body };
		}
		if (!response.ok) {
			return {
				kind: "error",
				status: response.status,
				message: `Export job failed (${response.status})`,
				...(invalidRequestIssues(body)
					? { issues: invalidRequestIssues(body) }
					: {}),
			};
		}
		if (!isCreateResponse(body)) {
			return {
				kind: "error",
				status: response.status,
				message: "Export job response did not match the expected contract.",
			};
		}
		return { kind: "created", response: body };
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError") {
			return { kind: "error", message: "aborted" };
		}
		return {
			kind: "error",
			message:
				error instanceof Error ? error.message : "Export job request failed.",
		};
	}
}

/**
 * Lists the current workspace's server export jobs using the existing Worker
 * endpoint. This is intentionally read-only and has no dependency on account or
 * billing UI state.
 */
export async function listServerExportJobs(
	signal?: AbortSignal,
): Promise<ListServerExportJobsResult> {
	try {
		const response = await fetch(SERVER_EXPORT_JOBS_ROUTE, {
			method: "GET",
			headers: { accept: "application/json" },
			...(signal ? { signal } : {}),
		});
		const body = await readJson(response);
		if (response.status === 401) {
			return { kind: "unauthenticated", status: 401 };
		}
		if (!response.ok) {
			return {
				kind: "error",
				status: response.status,
				message: `Export job list failed (${response.status})`,
			};
		}
		if (!isListResponse(body)) {
			return {
				kind: "error",
				status: response.status,
				message:
					"Export job list response did not match the expected contract.",
			};
		}
		return { kind: "ok", response: body };
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError") {
			return { kind: "error", message: "aborted" };
		}
		return {
			kind: "error",
			message:
				error instanceof Error
					? error.message
					: "Export job list request failed.",
		};
	}
}

/**
 * Reads one server export job by id from the authenticated workspace. A 404 is
 * used for both missing rows and rows owned by another workspace.
 */
export async function getServerExportJob(
	jobId: string,
	signal?: AbortSignal,
): Promise<GetServerExportJobResult> {
	try {
		const response = await fetch(serverExportJobStatusRoute(jobId), {
			method: "GET",
			headers: { accept: "application/json" },
			...(signal ? { signal } : {}),
		});
		const body = await readJson(response);
		if (response.status === 401) {
			return { kind: "unauthenticated", status: 401 };
		}
		if (response.status === 404) {
			return { kind: "not_found", status: 404 };
		}
		if (!response.ok) {
			return {
				kind: "error",
				status: response.status,
				message: `Export job status failed (${response.status})`,
			};
		}
		if (!isGetResponse(body)) {
			return {
				kind: "error",
				status: response.status,
				message:
					"Export job status response did not match the expected contract.",
			};
		}
		return { kind: "ok", response: body };
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError") {
			return { kind: "error", message: "aborted" };
		}
		return {
			kind: "error",
			message:
				error instanceof Error
					? error.message
					: "Export job status request failed.",
		};
	}
}
