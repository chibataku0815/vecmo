export type CloudProjectSummary = {
	readonly id: string;
	readonly name: string;
	readonly byteLength: number;
	readonly revision: number;
	readonly storageProvider: "d1" | "r2";
	readonly contentHash: string | null;
	readonly createdAt: string;
	readonly updatedAt: string;
};

export type CloudProject = CloudProjectSummary & {
	readonly contentType: string;
	readonly documentJson: string;
	readonly documentVersion: number;
};

export type CloudProjectRevisionSummary = {
	readonly projectId: string;
	readonly projectName: string;
	readonly projectUpdatedAt: string;
	readonly revision: number;
	readonly contentType: string;
	readonly storageProvider: "d1" | "r2";
	readonly contentHash: string;
	readonly documentVersion: number;
	readonly byteLength: number;
	readonly createdAt: string;
	readonly current: boolean;
};

export type CloudProjectRevision = CloudProjectRevisionSummary & {
	readonly documentJson: string;
};

export type CloudProjectsResult =
	| { readonly kind: "ok"; readonly projects: readonly CloudProjectSummary[] }
	| { readonly kind: "unauthenticated" }
	| { readonly kind: "error"; readonly message: string };

export type CloudProjectResult =
	| { readonly kind: "ok"; readonly project: CloudProject }
	| { readonly kind: "unauthenticated" }
	| { readonly kind: "not_found" }
	| { readonly kind: "error"; readonly message: string };

export type CloudProjectRevisionsResult =
	| {
			readonly kind: "ok";
			readonly revisions: readonly CloudProjectRevisionSummary[];
	  }
	| { readonly kind: "unauthenticated" }
	| { readonly kind: "not_found" }
	| { readonly kind: "error"; readonly message: string };

export type CloudProjectRevisionResult =
	| { readonly kind: "ok"; readonly revision: CloudProjectRevision }
	| { readonly kind: "unauthenticated" }
	| { readonly kind: "not_found" }
	| { readonly kind: "error"; readonly message: string };

export type SaveCloudProjectInput = {
	readonly name: string;
	readonly documentJson: string;
	readonly baseRevision?: number;
};

export type CloudProjectStorageDeniedResult = {
	readonly kind: "upgrade_required";
	readonly message: string;
	readonly feature?: "cloudProjectStorage" | "cloudProjectHistory";
	readonly reason?: string;
	readonly requiredPlan?: "creator" | "creator_pro";
};

/** Client result for server-side cloud project safety limits. */
export type CloudProjectQuotaExceededResult = {
	readonly kind: "quota_exceeded";
	readonly message: string;
	readonly code?: string;
	readonly limit?: number;
	readonly actual?: number;
	readonly projected?: number;
};

export type SaveCloudProjectResult =
	| { readonly kind: "ok"; readonly project: CloudProject }
	| { readonly kind: "unauthenticated" }
	| { readonly kind: "not_found" }
	| {
			readonly kind: "too_large";
			readonly actualBytes?: number;
			readonly maxBytes?: number;
	  }
	| { readonly kind: "conflict"; readonly project: CloudProjectSummary | null }
	| CloudProjectStorageDeniedResult
	| CloudProjectQuotaExceededResult
	| { readonly kind: "invalid"; readonly message: string }
	| { readonly kind: "error"; readonly message: string };

export type MutateCloudProjectResult =
	| { readonly kind: "ok"; readonly project: CloudProjectSummary }
	| { readonly kind: "unauthenticated" }
	| { readonly kind: "not_found" }
	| CloudProjectStorageDeniedResult
	| CloudProjectQuotaExceededResult
	| { readonly kind: "invalid"; readonly message: string }
	| { readonly kind: "error"; readonly message: string };

export type RestoreCloudProjectRevisionResult =
	| { readonly kind: "ok"; readonly project: CloudProject }
	| { readonly kind: "unauthenticated" }
	| { readonly kind: "not_found" }
	| { readonly kind: "conflict"; readonly project: CloudProjectSummary | null }
	| CloudProjectStorageDeniedResult
	| CloudProjectQuotaExceededResult
	| { readonly kind: "invalid"; readonly message: string }
	| { readonly kind: "error"; readonly message: string };

const PROJECTS_PATH = "/api/projects" as const;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_PAYMENT_REQUIRED = 402;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_PAYLOAD_TOO_LARGE = 413;

const JSON_HEADERS = {
	"content-type": "application/json",
	accept: "application/json",
} as const;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
	typeof value === "object" && value !== null;

const isProjectSummary = (value: unknown): value is CloudProjectSummary =>
	isRecord(value) &&
	typeof value.id === "string" &&
	typeof value.name === "string" &&
	typeof value.byteLength === "number" &&
	Number.isInteger(value.revision) &&
	(value.storageProvider === "d1" || value.storageProvider === "r2") &&
	(value.contentHash === null || typeof value.contentHash === "string") &&
	typeof value.createdAt === "string" &&
	typeof value.updatedAt === "string";

const isProject = (value: unknown): value is CloudProject => {
	if (!isRecord(value) || !isProjectSummary(value)) return false;
	const record = value as CloudProjectSummary &
		Readonly<Record<string, unknown>>;
	return (
		typeof record.contentType === "string" &&
		typeof record.documentJson === "string" &&
		typeof record.documentVersion === "number"
	);
};

const isProjectRevisionSummary = (
	value: unknown,
): value is CloudProjectRevisionSummary =>
	isRecord(value) &&
	typeof value.projectId === "string" &&
	typeof value.projectName === "string" &&
	typeof value.projectUpdatedAt === "string" &&
	Number.isInteger(value.revision) &&
	typeof value.contentType === "string" &&
	(value.storageProvider === "d1" || value.storageProvider === "r2") &&
	typeof value.contentHash === "string" &&
	typeof value.documentVersion === "number" &&
	typeof value.byteLength === "number" &&
	typeof value.createdAt === "string" &&
	typeof value.current === "boolean";

const isProjectRevision = (value: unknown): value is CloudProjectRevision => {
	if (!isRecord(value) || !isProjectRevisionSummary(value)) return false;
	const record = value as CloudProjectRevisionSummary &
		Readonly<Record<string, unknown>>;
	return typeof record.documentJson === "string";
};

const readJson = async (response: Response): Promise<unknown> => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};

const messageFromBody = (body: unknown, fallback: string): string => {
	if (!isRecord(body)) return fallback;
	if (typeof body.message === "string" && body.message.trim().length > 0) {
		return body.message.trim();
	}
	if (typeof body.error === "string" && body.error.trim().length > 0) {
		return body.error.trim();
	}
	return fallback;
};

const storageDeniedFromBody = (
	body: unknown,
): CloudProjectStorageDeniedResult | null => {
	if (
		!isRecord(body) ||
		body.error !== "cloud_project_storage_denied" ||
		(body.feature !== "cloudProjectStorage" &&
			body.feature !== "cloudProjectHistory")
	) {
		return null;
	}
	const feature = body.feature;
	const requiredPlan =
		body.requiredPlan === "creator" || body.requiredPlan === "creator_pro"
			? body.requiredPlan
			: undefined;
	const reason = typeof body.reason === "string" ? body.reason : undefined;
	const message =
		reason === "payment_required"
			? feature === "cloudProjectHistory"
				? "Update billing to restore cloud project history."
				: "Update billing to keep saving cloud projects."
			: reason !== undefined && reason !== "plan_feature_unavailable"
				? feature === "cloudProjectHistory"
					? "Manage billing to restore cloud project history."
					: "Manage billing to keep saving cloud projects."
				: feature === "cloudProjectHistory"
					? "Upgrade to Creator Pro to restore cloud project history."
					: `Upgrade to ${requiredPlan === "creator_pro" ? "Creator Pro" : "Creator"} to save cloud projects.`;
	return {
		kind: "upgrade_required",
		message,
		feature,
		...(reason ? { reason } : {}),
		...(requiredPlan ? { requiredPlan } : {}),
	};
};

const quotaMessage = (code: string | undefined): string => {
	switch (code) {
		case "active_project_limit_reached":
			return "Cloud project count reached the workspace safety limit. Archive old projects before saving another cloud copy.";
		case "project_revision_limit_reached":
			return "This cloud project reached the revision safety limit. Save a new cloud copy or download a local backup.";
		case "workspace_revision_storage_limit_reached":
			return "Cloud project storage reached the workspace safety limit. Download a local backup and continue locally before saving more cloud revisions.";
		default:
			return "Cloud project storage reached a safety limit.";
	}
};

const quotaExceededFromBody = (
	body: unknown,
): CloudProjectQuotaExceededResult | null => {
	if (
		!isRecord(body) ||
		body.error !== "cloud_project_quota_exceeded" ||
		!isRecord(body.quota)
	) {
		return null;
	}
	const quota = body.quota;
	const code = typeof quota.code === "string" ? quota.code : undefined;
	const fallbackMessage =
		typeof quota.message === "string" && quota.message.trim().length > 0
			? quota.message.trim()
			: "Cloud project storage reached a safety limit.";
	return {
		kind: "quota_exceeded",
		message: code === undefined ? fallbackMessage : quotaMessage(code),
		...(code ? { code } : {}),
		...(typeof quota.limit === "number" ? { limit: quota.limit } : {}),
		...(typeof quota.actual === "number" ? { actual: quota.actual } : {}),
		...(typeof quota.projected === "number"
			? { projected: quota.projected }
			: {}),
	};
};

const projectPath = (projectId: string): string =>
	`${PROJECTS_PATH}/${encodeURIComponent(projectId)}`;

const projectRevisionsPath = (projectId: string): string =>
	`${projectPath(projectId)}/revisions`;

const projectRevisionPath = (projectId: string, revision: number): string =>
	`${projectRevisionsPath(projectId)}/${encodeURIComponent(String(revision))}`;

export async function listCloudProjects(
	signal?: AbortSignal,
): Promise<CloudProjectsResult> {
	try {
		const response = await fetch(PROJECTS_PATH, {
			headers: { accept: "application/json" },
			credentials: "same-origin",
			...(signal ? { signal } : {}),
		});
		const body = await readJson(response);
		if (response.status === HTTP_UNAUTHORIZED)
			return { kind: "unauthenticated" };
		if (!response.ok) {
			return {
				kind: "error",
				message: messageFromBody(
					body,
					`Cloud projects failed (${response.status})`,
				),
			};
		}
		if (!isRecord(body) || !Array.isArray(body.projects)) {
			return {
				kind: "error",
				message:
					"Cloud project list response did not match the expected contract.",
			};
		}
		if (!body.projects.every(isProjectSummary)) {
			return {
				kind: "error",
				message:
					"Cloud project list response did not match the expected contract.",
			};
		}
		return { kind: "ok", projects: body.projects };
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError") {
			return { kind: "error", message: "aborted" };
		}
		return {
			kind: "error",
			message: error instanceof Error ? error.message : "Cloud projects failed",
		};
	}
}

export async function readCloudProject(
	projectId: string,
	signal?: AbortSignal,
): Promise<CloudProjectResult> {
	try {
		const response = await fetch(projectPath(projectId), {
			headers: { accept: "application/json" },
			credentials: "same-origin",
			...(signal ? { signal } : {}),
		});
		const body = await readJson(response);
		if (response.status === HTTP_UNAUTHORIZED)
			return { kind: "unauthenticated" };
		if (response.status === HTTP_NOT_FOUND) return { kind: "not_found" };
		if (!response.ok) {
			return {
				kind: "error",
				message: messageFromBody(
					body,
					`Cloud project failed (${response.status})`,
				),
			};
		}
		if (!isRecord(body) || !isProject(body.project)) {
			return {
				kind: "error",
				message: "Cloud project response did not match the expected contract.",
			};
		}
		return { kind: "ok", project: body.project };
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError") {
			return { kind: "error", message: "aborted" };
		}
		return {
			kind: "error",
			message: error instanceof Error ? error.message : "Cloud project failed",
		};
	}
}

/** Lists revision metadata only; document bodies are fetched per revision. */
export async function listCloudProjectRevisions(
	projectId: string,
	signal?: AbortSignal,
): Promise<CloudProjectRevisionsResult> {
	try {
		const response = await fetch(projectRevisionsPath(projectId), {
			headers: { accept: "application/json" },
			credentials: "same-origin",
			...(signal ? { signal } : {}),
		});
		const body = await readJson(response);
		if (response.status === HTTP_UNAUTHORIZED)
			return { kind: "unauthenticated" };
		if (response.status === HTTP_NOT_FOUND) return { kind: "not_found" };
		if (!response.ok) {
			return {
				kind: "error",
				message: messageFromBody(
					body,
					`Cloud project history failed (${response.status})`,
				),
			};
		}
		if (!isRecord(body) || !Array.isArray(body.revisions)) {
			return {
				kind: "error",
				message:
					"Cloud project history response did not match the expected contract.",
			};
		}
		if (!body.revisions.every(isProjectRevisionSummary)) {
			return {
				kind: "error",
				message:
					"Cloud project history response did not match the expected contract.",
			};
		}
		return { kind: "ok", revisions: body.revisions };
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError") {
			return { kind: "error", message: "aborted" };
		}
		return {
			kind: "error",
			message:
				error instanceof Error ? error.message : "Cloud project history failed",
		};
	}
}

/** Reads one revision body for preview/open/download recovery flows. */
export async function readCloudProjectRevision(
	projectId: string,
	revision: number,
	signal?: AbortSignal,
): Promise<CloudProjectRevisionResult> {
	try {
		const response = await fetch(projectRevisionPath(projectId, revision), {
			headers: { accept: "application/json" },
			credentials: "same-origin",
			...(signal ? { signal } : {}),
		});
		const body = await readJson(response);
		if (response.status === HTTP_UNAUTHORIZED)
			return { kind: "unauthenticated" };
		if (response.status === HTTP_NOT_FOUND) return { kind: "not_found" };
		if (!response.ok) {
			return {
				kind: "error",
				message: messageFromBody(
					body,
					`Cloud project revision failed (${response.status})`,
				),
			};
		}
		if (!isRecord(body) || !isProjectRevision(body.revision)) {
			return {
				kind: "error",
				message:
					"Cloud project revision response did not match the expected contract.",
			};
		}
		return { kind: "ok", revision: body.revision };
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError") {
			return { kind: "error", message: "aborted" };
		}
		return {
			kind: "error",
			message:
				error instanceof Error
					? error.message
					: "Cloud project revision failed",
		};
	}
}

async function saveCloudProject(
	path: string,
	method: "POST" | "PUT",
	input: SaveCloudProjectInput,
): Promise<SaveCloudProjectResult> {
	try {
		const response = await fetch(path, {
			method,
			credentials: "same-origin",
			headers: JSON_HEADERS,
			body: JSON.stringify(input),
		});
		const body = await readJson(response);
		if (response.status === HTTP_UNAUTHORIZED)
			return { kind: "unauthenticated" };
		if (response.status === HTTP_NOT_FOUND) return { kind: "not_found" };
		if (
			response.status === HTTP_PAYMENT_REQUIRED ||
			response.status === HTTP_FORBIDDEN
		) {
			const denied = storageDeniedFromBody(body);
			if (denied !== null) return denied;
		}
		if (response.status === HTTP_PAYLOAD_TOO_LARGE) {
			return {
				kind: "too_large",
				actualBytes:
					isRecord(body) && typeof body.actualBytes === "number"
						? body.actualBytes
						: undefined,
				maxBytes:
					isRecord(body) && typeof body.maxBytes === "number"
						? body.maxBytes
						: undefined,
			};
		}
		if (response.status === HTTP_CONFLICT) {
			return {
				kind: "conflict",
				project:
					isRecord(body) && isProjectSummary(body.project)
						? body.project
						: null,
			};
		}
		if (response.status === HTTP_TOO_MANY_REQUESTS) {
			const quota = quotaExceededFromBody(body);
			if (quota !== null) return quota;
		}
		if (!response.ok) {
			return {
				kind: response.status === 400 ? "invalid" : "error",
				message: messageFromBody(
					body,
					`Cloud save failed (${response.status})`,
				),
			};
		}
		if (!isRecord(body) || !isProject(body.project)) {
			return {
				kind: "error",
				message: "Cloud save response did not match the expected contract.",
			};
		}
		return { kind: "ok", project: body.project };
	} catch (error) {
		return {
			kind: "error",
			message: error instanceof Error ? error.message : "Cloud save failed",
		};
	}
}

export function createCloudProject(
	input: SaveCloudProjectInput,
): Promise<SaveCloudProjectResult> {
	return saveCloudProject(PROJECTS_PATH, "POST", input);
}

export function updateCloudProject(
	projectId: string,
	input: SaveCloudProjectInput,
): Promise<SaveCloudProjectResult> {
	return saveCloudProject(projectPath(projectId), "PUT", input);
}

/**
 * Asks the Worker to append the selected immutable revision as the new current
 * project revision. The request body is intentionally empty so ownership and
 * content source stay server-scoped.
 */
export async function restoreCloudProjectRevision(
	projectId: string,
	revision: number,
): Promise<RestoreCloudProjectRevisionResult> {
	try {
		const response = await fetch(
			`${projectRevisionPath(projectId, revision)}/restore`,
			{
				method: "POST",
				credentials: "same-origin",
				headers: JSON_HEADERS,
				body: JSON.stringify({}),
			},
		);
		const body = await readJson(response);
		if (response.status === HTTP_UNAUTHORIZED)
			return { kind: "unauthenticated" };
		if (response.status === HTTP_NOT_FOUND) return { kind: "not_found" };
		if (
			response.status === HTTP_PAYMENT_REQUIRED ||
			response.status === HTTP_FORBIDDEN
		) {
			const denied = storageDeniedFromBody(body);
			if (denied !== null) return denied;
		}
		if (response.status === HTTP_CONFLICT) {
			return {
				kind: "conflict",
				project:
					isRecord(body) && isProjectSummary(body.project)
						? body.project
						: null,
			};
		}
		if (response.status === HTTP_TOO_MANY_REQUESTS) {
			const quota = quotaExceededFromBody(body);
			if (quota !== null) return quota;
		}
		if (!response.ok) {
			return {
				kind: response.status === HTTP_BAD_REQUEST ? "invalid" : "error",
				message: messageFromBody(
					body,
					`Cloud project restore failed (${response.status})`,
				),
			};
		}
		if (!isRecord(body) || !isProject(body.project)) {
			return {
				kind: "error",
				message:
					"Cloud project restore response did not match the expected contract.",
			};
		}
		return { kind: "ok", project: body.project };
	} catch (error) {
		return {
			kind: "error",
			message:
				error instanceof Error ? error.message : "Cloud project restore failed",
		};
	}
}

async function mutateCloudProject(
	path: string,
	method: "DELETE" | "PATCH" | "POST",
	body?: unknown,
): Promise<MutateCloudProjectResult> {
	try {
		const response = await fetch(path, {
			method,
			credentials: "same-origin",
			headers:
				body === undefined ? { accept: "application/json" } : JSON_HEADERS,
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
		const responseBody = await readJson(response);
		if (response.status === HTTP_UNAUTHORIZED)
			return { kind: "unauthenticated" };
		if (response.status === HTTP_NOT_FOUND) return { kind: "not_found" };
		if (
			response.status === HTTP_PAYMENT_REQUIRED ||
			response.status === HTTP_FORBIDDEN
		) {
			const denied = storageDeniedFromBody(responseBody);
			if (denied !== null) return denied;
		}
		if (response.status === HTTP_TOO_MANY_REQUESTS) {
			const quota = quotaExceededFromBody(responseBody);
			if (quota !== null) return quota;
		}
		if (!response.ok) {
			return {
				kind: response.status === 400 ? "invalid" : "error",
				message: messageFromBody(
					responseBody,
					`Cloud project update failed (${response.status})`,
				),
			};
		}
		if (!isRecord(responseBody) || !isProjectSummary(responseBody.project)) {
			return {
				kind: "error",
				message:
					"Cloud project update response did not match the expected contract.",
			};
		}
		return { kind: "ok", project: responseBody.project };
	} catch (error) {
		return {
			kind: "error",
			message:
				error instanceof Error ? error.message : "Cloud project update failed",
		};
	}
}

export function renameCloudProject(
	projectId: string,
	name: string,
): Promise<MutateCloudProjectResult> {
	return mutateCloudProject(projectPath(projectId), "PATCH", { name });
}

export function archiveCloudProject(
	projectId: string,
): Promise<MutateCloudProjectResult> {
	return mutateCloudProject(projectPath(projectId), "DELETE");
}

export function duplicateCloudProject(
	projectId: string,
): Promise<MutateCloudProjectResult> {
	return mutateCloudProject(`${projectPath(projectId)}/duplicate`, "POST", {});
}
