import type { MotionDocument } from "@/entities/motion/model/types";
import type { MotionGrammarBinding } from "@/entities/motion-grammar/model/types";
import type { SceneDocument } from "@/entities/scene/model/types";
import type { ExportArtboardScopeInput } from "./artboards";
import {
	createExportBundle,
	type ExportBundle,
	type ExportBundleManifest,
	type ExportFrameRangeInput,
	type ExportManifestAsset,
} from "./bundle";
import { stableJsonStringify } from "./json";

/** Stable same-origin Worker route for creating and listing server export jobs. */
export const SERVER_EXPORT_JOBS_ROUTE = "/api/export-jobs" as const;

/** Stable same-origin Worker route for reading one server export job. */
export const serverExportJobStatusRoute = (jobId: string): string =>
	`${SERVER_EXPORT_JOBS_ROUTE}/${encodeURIComponent(jobId)}`;

/** Client mirror of the Worker export-job kind contract. */
export type ServerExportJobKind = "still" | "motion" | "sequence";

/** Client mirror of the Worker export-job format contract. */
export type ServerExportJobFormat =
	| "png"
	| "svg"
	| "pdf"
	| "webm"
	| "mp4"
	| "gif"
	| "lottie"
	| "json";

/**
 * Request body accepted by `POST /api/export-jobs`. Metadata fields gate the
 * job; `document` is the optional source payload the server renderer serializes
 * (SVG still this wave). It is additive — omitting it keeps the metadata-only
 * behavior — and intentionally typed as opaque JSON so this client mirror does
 * not couple to the editor scene model.
 */
export type ServerExportJobRequest = {
	readonly kind: ServerExportJobKind;
	readonly format?: ServerExportJobFormat;
	readonly width?: number;
	readonly height?: number;
	readonly durationFrames?: number;
	readonly idempotencyKey?: string;
	readonly document?: unknown;
};

/** Server job lifecycle values returned by the Worker list/create endpoints. */
export type ServerExportJobStatus =
	| "queued"
	| "running"
	| "succeeded"
	| "failed"
	| "canceled";

/** Metadata-only result persisted when no renderable document was provided. */
export type ServerMetadataOnlyExportJobResult = {
	readonly kind: "metadata_only";
	readonly message: "server_export_runtime_metadata_only";
	readonly format?: ServerExportJobFormat;
	readonly width?: number;
	readonly height?: number;
	readonly durationFrames?: number;
};

/**
 * SVG render result persisted when the server serializer produced an artifact.
 * The artifact bytes live behind the server storage seam; the result carries the
 * `artifactKey` and `byteLength` describing them.
 */
export type ServerSvgExportJobResult = {
	readonly kind: "svg";
	readonly message: "server_export_runtime_svg";
	readonly format: "svg";
	readonly width: number;
	readonly height: number;
	readonly artifactKey: string;
	readonly byteLength: number;
};

/** Result persisted by the server export runtime worker (additive union). */
export type ServerExportJobResult =
	| ServerMetadataOnlyExportJobResult
	| ServerSvgExportJobResult;

/** Failure details persisted by the server export runtime worker. */
export type ServerExportJobError = {
	readonly code: "runner_failed" | "render_failed";
	readonly message: string;
};

/** Public projection of a server export job row returned by the Worker. */
export type ServerExportJobRecord = {
	readonly id: string;
	readonly kind: ServerExportJobKind;
	readonly status: ServerExportJobStatus;
	readonly request: ServerExportJobRequest;
	readonly result?: ServerExportJobResult;
	readonly error?: ServerExportJobError;
	readonly createdAt: string;
	readonly updatedAt: string;
};

/** Success body returned by `POST /api/export-jobs`. */
export type CreateServerExportJobResponse = {
	readonly job: ServerExportJobRecord;
	readonly remainingMonthlyServerExportJobs: number;
};

/** Success body returned by `GET /api/export-jobs`. */
export type ListServerExportJobsResponse = {
	readonly jobs: readonly ServerExportJobRecord[];
};

/** Success body returned by `GET /api/export-jobs/:jobId`. */
export type GetServerExportJobResponse = {
	readonly job: ServerExportJobRecord;
};

/** Client mirror of structured entitlement denial reasons from the Worker. */
export type ServerExportJobDenialReason =
	| "subscription_missing"
	| "subscription_inactive"
	| "subscription_incomplete"
	| "subscription_paused"
	| "payment_required"
	| "plan_feature_unavailable"
	| "monthly_export_limit_reached"
	| "export_size_limit_exceeded"
	| "motion_duration_limit_exceeded"
	| "invalid_export_request";

/** Structured 4xx body returned when the Worker denies an export job. */
export type ServerExportJobDenialBody = {
	readonly error: "export_job_denied";
	readonly reason: ServerExportJobDenialReason;
	readonly requiredPlan?: "creator" | "creator_pro";
	readonly feature?: string;
	readonly limit?: number;
	readonly actual?: number;
};

export type ExportPackageDelivery = "local-bundle" | "server-job";
export type ExportPackageDeliveryPreference =
	| "auto"
	| "local-bundle"
	| "server-job";

/** Deterministic delivery decision made before executing an export package. */
export type ExportPackageDeliveryDecision = {
	readonly delivery: ExportPackageDelivery;
	readonly reason:
		| "auto-local"
		| "auto-server-job"
		| "requested-local"
		| "requested-server-job"
		| "server-job-unavailable";
};

export type ExportServerJobContractGapCode =
	| "server-job-artboard-scope-report-only"
	| "server-job-assets-report-only"
	| "server-job-frame-range-report-only"
	| "server-job-issues-report-only"
	| "server-job-manifest-report-only"
	| "server-job-source-payload-report-only";

/**
 * Report-only gap between the rich client export manifest and the smaller
 * existing Worker job endpoint. These entries are intentionally not sent to the
 * Worker; they tell UI/orchestration which follow-up API contract is missing.
 */
export type ExportServerJobContractGap = {
	readonly code: ExportServerJobContractGapCode;
	readonly severity: "info" | "warning";
	readonly endpointPath: typeof SERVER_EXPORT_JOBS_ROUTE;
	readonly reportOnly: true;
	readonly fields: readonly string[];
	readonly message: string;
};

/** Optional caller overrides for the server job request derivation. */
export type ExportServerJobIntentOptions = {
	readonly kind?: ServerExportJobKind;
	readonly format?: ServerExportJobFormat;
	readonly idempotencyKey?: string;
	readonly includeSourceDocument?: boolean;
};

/**
 * Server-job branch of an export package. The request is what the Worker accepts
 * today; the manifest and gaps preserve local export metadata for review and
 * future Worker contract expansion.
 */
export type ExportServerJobIntent = {
	readonly endpointPath: typeof SERVER_EXPORT_JOBS_ROUTE;
	readonly request: ServerExportJobRequest;
	readonly requestBody: string;
	readonly manifest: ExportBundleManifest;
	readonly assetFileNames: readonly string[];
	readonly issueCodes: readonly string[];
	readonly contractGaps: readonly ExportServerJobContractGap[];
};

export type CreateExportPackagePlanInput = {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly frame?: number;
	readonly currentFrame?: number;
	readonly frameRange?: ExportFrameRangeInput;
	readonly artboardScope?: ExportArtboardScopeInput;
	readonly includeMotionMetadata?: boolean;
	readonly grammarBindings?: readonly MotionGrammarBinding[];
	readonly deliveryPreference?: ExportPackageDeliveryPreference;
	readonly serverJobsAvailable?: boolean;
	readonly serverJob?: ExportServerJobIntentOptions;
};

export type ExportLocalPackagePlan = {
	readonly delivery: "local-bundle";
	readonly decision: ExportPackageDeliveryDecision;
	readonly bundle: ExportBundle;
	readonly manifest: ExportBundleManifest;
};

export type ExportServerJobPackagePlan = {
	readonly delivery: "server-job";
	readonly decision: ExportPackageDeliveryDecision;
	readonly bundle: ExportBundle;
	readonly manifest: ExportBundleManifest;
	readonly serverJob: ExportServerJobIntent;
	readonly localFallback: {
		readonly bundle: ExportBundle;
		readonly manifest: ExportBundleManifest;
		readonly reason: "server-job-request-failed";
	};
};

/** Export plan a UI adapter can execute without rebuilding export metadata. */
export type ExportPackagePlan =
	| ExportLocalPackagePlan
	| ExportServerJobPackagePlan;

const motionOutputFormats: ReadonlySet<ServerExportJobFormat> = new Set([
	"gif",
	"lottie",
	"mp4",
	"webm",
]);

const positiveIntegerEstimate = (value: number): number | undefined => {
	if (!Number.isFinite(value) || value <= 0) return undefined;
	return Math.max(1, Math.ceil(value));
};

const inferServerJobKind = (
	manifest: ExportBundleManifest,
	options?: ExportServerJobIntentOptions,
): ServerExportJobKind => {
	if (options?.kind) return options.kind;
	if (options?.format && motionOutputFormats.has(options.format))
		return "motion";
	if (manifest.frameRange.mode === "frame-range") return "sequence";
	return "still";
};

const durationFramesForServerJob = (
	kind: ServerExportJobKind,
	manifest: ExportBundleManifest,
): number | undefined => {
	if (kind === "still") return undefined;
	if (manifest.frameRange.mode !== "frame-range") {
		return positiveIntegerEstimate(manifest.frameRange.durationFrames);
	}
	const span = manifest.frameRange.endFrame - manifest.frameRange.startFrame;
	return positiveIntegerEstimate(Math.max(1, span));
};

const manifestAssetForBundle = (bundle: ExportBundle): ExportManifestAsset => {
	const asset = bundle.assets.find(
		(candidate): candidate is ExportManifestAsset =>
			candidate.kind === "manifest-json",
	);
	if (!asset) {
		throw new Error("Export bundle is missing its manifest asset.");
	}
	return asset;
};

const manifestForBundle = (bundle: ExportBundle): ExportBundleManifest =>
	JSON.parse(manifestAssetForBundle(bundle).contents) as ExportBundleManifest;

const serverJobRequestForManifest = (
	manifest: ExportBundleManifest,
	options?: ExportServerJobIntentOptions,
): ServerExportJobRequest => {
	const kind = inferServerJobKind(manifest, options);
	const primaryArtboard = manifest.artboards.exported[0];
	const width =
		primaryArtboard === undefined
			? undefined
			: positiveIntegerEstimate(primaryArtboard.width);
	const height =
		primaryArtboard === undefined
			? undefined
			: positiveIntegerEstimate(primaryArtboard.height);
	const durationFrames = durationFramesForServerJob(kind, manifest);
	return {
		kind,
		...(options?.format ? { format: options.format } : {}),
		...(width !== undefined ? { width } : {}),
		...(height !== undefined ? { height } : {}),
		...(durationFrames !== undefined ? { durationFrames } : {}),
		...(options?.idempotencyKey
			? { idempotencyKey: options.idempotencyKey }
			: {}),
	};
};

const supportsServerSourceDocument = (
	request: ServerExportJobRequest,
): boolean => request.kind === "still" && request.format === "svg";

const shouldIncludeSourceDocument = (
	request: ServerExportJobRequest,
	options?: ExportServerJobIntentOptions,
): boolean =>
	supportsServerSourceDocument(request) &&
	options?.includeSourceDocument !== false;

const sourceDocumentForBundle = (bundle: ExportBundle): unknown | undefined => {
	const asset = bundle.assets.find(
		(candidate) => candidate.kind === "scene-json",
	);
	return asset === undefined ? undefined : JSON.parse(asset.contents);
};

const contractGap = ({
	code,
	severity = "info",
	fields,
	message,
}: Omit<
	ExportServerJobContractGap,
	"endpointPath" | "reportOnly" | "severity"
> & {
	readonly severity?: ExportServerJobContractGap["severity"];
}): ExportServerJobContractGap => ({
	code,
	severity,
	endpointPath: SERVER_EXPORT_JOBS_ROUTE,
	reportOnly: true,
	fields,
	message,
});

const contractGapsForManifest = (
	manifest: ExportBundleManifest,
	{
		sourceDocumentIncluded = false,
	}: {
		readonly sourceDocumentIncluded?: boolean;
	} = {},
): readonly ExportServerJobContractGap[] => {
	const sourcePayloadFields = sourceDocumentIncluded
		? ["motion", "assets"]
		: ["scene", "motion", "assets"];
	const gaps: ExportServerJobContractGap[] = [
		contractGap({
			code: "server-job-source-payload-report-only",
			severity: "warning",
			fields: sourcePayloadFields,
			message: sourceDocumentIncluded
				? "The server export job endpoint accepts the scene document for SVG still renders; motion and bundled asset payloads remain local report data."
				: "The existing server export job endpoint queues request metadata only; scene, motion, and rendered asset payloads remain local report data.",
		}),
		contractGap({
			code: "server-job-manifest-report-only",
			fields: ["manifest", "assetCount", "issueSummary"],
			message:
				"Bundle manifest metadata is available to the client but is not accepted by the current server export job endpoint.",
		}),
		contractGap({
			code: "server-job-assets-report-only",
			fields: ["assetFileNames", "assets"],
			message:
				"Local asset file names and asset roles are report-only until the server job contract accepts a render manifest.",
		}),
	];

	if (
		manifest.artboards.scope !== "current" ||
		manifest.artboards.exportedArtboardIds.length !== 1 ||
		manifest.artboards.requestedArtboardIds.length > 0
	) {
		gaps.push(
			contractGap({
				code: "server-job-artboard-scope-report-only",
				fields: ["artboards", "artboardScope", "exportedArtboardIds"],
				message:
					"Artboard scope is preserved in the client manifest but cannot yet be submitted to the server export job endpoint.",
			}),
		);
	}

	if (manifest.frameRange.mode === "frame-range") {
		gaps.push(
			contractGap({
				code: "server-job-frame-range-report-only",
				fields: ["frameRange", "frames", "stepFrames"],
				message:
					"Frame-range details are preserved in the client manifest; the server job endpoint currently accepts only a duration estimate.",
			}),
		);
	}

	if (manifest.issueCount > 0) {
		gaps.push(
			contractGap({
				code: "server-job-issues-report-only",
				fields: ["issues", "issueSummary", "issueCodes"],
				message:
					"Export fidelity issues are visible in the client manifest but are not submitted with the current server job request body.",
			}),
		);
	}

	return gaps;
};

const issueCodesForManifest = (
	manifest: ExportBundleManifest,
): readonly string[] =>
	[...new Set(manifest.issues.map((issue) => issue.code))].sort();

/**
 * Chooses whether an export package should execute locally or through a server
 * job. Entitlement/account UI can pass `serverJobsAvailable`; this feature keeps
 * local export as the deterministic fallback when that signal is false/unknown.
 */
export function chooseExportPackageDelivery({
	preference = "local-bundle",
	serverJobsAvailable = false,
}: {
	readonly preference?: ExportPackageDeliveryPreference;
	readonly serverJobsAvailable?: boolean;
} = {}): ExportPackageDeliveryDecision {
	if (preference === "local-bundle") {
		return { delivery: "local-bundle", reason: "requested-local" };
	}
	if (serverJobsAvailable) {
		return {
			delivery: "server-job",
			reason:
				preference === "auto" ? "auto-server-job" : "requested-server-job",
		};
	}
	return {
		delivery: "local-bundle",
		reason: preference === "auto" ? "auto-local" : "server-job-unavailable",
	};
}

/**
 * Builds the server-job intent from the already-created export bundle manifest.
 * This is the key no-duplication seam: local download and server intent consume
 * one canonical manifest/issue report instead of deriving export metadata twice.
 */
export function createServerExportJobIntent(
	bundle: ExportBundle,
	options?: ExportServerJobIntentOptions,
): ExportServerJobIntent {
	const manifest = manifestForBundle(bundle);
	const baseRequest = serverJobRequestForManifest(manifest, options);
	const sourceDocument = shouldIncludeSourceDocument(baseRequest, options)
		? sourceDocumentForBundle(bundle)
		: undefined;
	const request =
		sourceDocument === undefined
			? baseRequest
			: { ...baseRequest, document: sourceDocument };
	return {
		endpointPath: SERVER_EXPORT_JOBS_ROUTE,
		request,
		requestBody: stableJsonStringify(request),
		manifest,
		assetFileNames: manifest.assets.map((asset) => asset.fileName),
		issueCodes: issueCodesForManifest(manifest),
		contractGaps: contractGapsForManifest(manifest, {
			sourceDocumentIncluded: sourceDocument !== undefined,
		}),
	};
}

/**
 * Creates one executable export package plan. Both delivery paths share the same
 * generated bundle and parsed manifest, so a UI can switch local/server delivery
 * without reimplementing export, artboard, motion, or issue metadata logic.
 */
export function createExportPackagePlan({
	scene,
	motion,
	frame,
	currentFrame,
	frameRange,
	artboardScope,
	includeMotionMetadata,
	grammarBindings,
	deliveryPreference,
	serverJobsAvailable,
	serverJob,
}: CreateExportPackagePlanInput): ExportPackagePlan {
	const bundle = createExportBundle({
		scene,
		motion,
		...(frame !== undefined ? { frame } : {}),
		...(currentFrame !== undefined ? { currentFrame } : {}),
		...(frameRange ? { frameRange } : {}),
		...(artboardScope ? { artboardScope } : {}),
		...(includeMotionMetadata !== undefined ? { includeMotionMetadata } : {}),
		...(grammarBindings ? { grammarBindings } : {}),
	});
	const manifest = manifestForBundle(bundle);
	const decision = chooseExportPackageDelivery({
		preference: deliveryPreference,
		serverJobsAvailable,
	});

	if (decision.delivery === "local-bundle") {
		return {
			delivery: "local-bundle",
			decision,
			bundle,
			manifest,
		};
	}

	return {
		delivery: "server-job",
		decision,
		bundle,
		manifest,
		serverJob: createServerExportJobIntent(bundle, serverJob),
		localFallback: {
			bundle,
			manifest,
			reason: "server-job-request-failed",
		},
	};
}
