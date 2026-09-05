import type { AiImportAnalysis } from "@/features/import/model/ai-import";
import {
	type ImportedScenePayload,
	type ImportFidelityReport,
	type ImportIssue,
	type ImportIssueAffectedTarget,
	type ImportIssueGroup,
	type ImportIssueSummary,
	summarizeImportedScenePayload,
	summarizeImportIssues,
} from "@/features/import/model/types";
import type { ProjectRestoreResult } from "@/features/project-backup/model/project-backup";

export type TopBarImportReportStatus = "success" | "warning" | "error";

export type TopBarImportFidelitySummary = {
	readonly importedCount: number;
	readonly artboardCount: number;
	readonly approximatedCount: number;
	readonly unsupportedCount: number;
	readonly artboardApproximatedCount: number;
	readonly artboardUnsupportedCount: number;
	readonly warningCount: number;
	readonly errorCount: number;
};

export type TopBarImportReportModel = {
	readonly status: TopBarImportReportStatus;
	readonly title: string;
	readonly sourceName: string;
	readonly sourceFormat: string;
	readonly importedCount: number;
	readonly issues: readonly ImportIssue[];
	readonly fidelity: TopBarImportFidelitySummary;
	readonly issueSummary: ImportIssueSummary;
	readonly issueGroups: readonly ImportIssueGroup[];
	readonly fallbackTypes: readonly string[];
	readonly affectedTargets: readonly ImportIssueAffectedTarget[];
	readonly affectedNodeIds: readonly string[];
	readonly affectedArtboardIds: readonly string[];
	readonly affectedAssetIds: readonly string[];
	readonly note?: string;
};

type TopBarImportReportOptions = {
	readonly sourceName: string;
	readonly sourceFormat: string;
	readonly importedTitle: string;
	readonly emptyTitle: string;
	readonly emptyNote: string;
};

export type TopBarImagePlacementReportInput = {
	readonly sourceName: string;
	readonly sourceFormat: string;
	readonly nodeId: string;
	readonly assetId: string;
	readonly issues?: readonly ImportIssue[];
};

export type TopBarVideoPlacementReportInput = {
	readonly sourceName: string;
	readonly sourceFormat: string;
	readonly nodeId: string;
	readonly assetId: string;
	readonly durationSeconds?: number;
	readonly issues?: readonly ImportIssue[];
};

export type TopBarProgramSurfacePlacementReportInput = {
	readonly sourceName: string;
	readonly sourceFormat: string;
	readonly nodeId: string;
	readonly assetId: string;
	readonly verifiedCompiledDigest: `sha256:${string}`;
};

export type TopBarProgramSurfacePackageRejectedReportInput = {
	readonly sourceName: string;
	readonly sourceFormat: string;
	readonly code: string;
	readonly message: string;
};

export type TopBarProgramSurfacePackageStaleReportInput = {
	readonly sourceName: string;
	readonly sourceFormat: string;
};

type TopBarUnsupportedImageReportInput = {
	readonly sourceName: string;
	readonly sourceFormat: string;
};

type TopBarUnsupportedVideoReportInput = {
	readonly sourceName: string;
	readonly sourceFormat: string;
};

const countIssues = (
	issues: readonly ImportIssue[],
	severity: ImportIssue["severity"],
): number => issues.filter((issue) => issue.severity === severity).length;

const emptyFidelitySummary = (
	issues: readonly ImportIssue[] = [],
): TopBarImportFidelitySummary => ({
	importedCount: 0,
	artboardCount: 0,
	approximatedCount: 0,
	unsupportedCount: countIssues(issues, "error"),
	artboardApproximatedCount: 0,
	artboardUnsupportedCount: 0,
	warningCount: countIssues(issues, "warning"),
	errorCount: countIssues(issues, "error"),
});

const fidelitySummary = (
	report: ImportFidelityReport,
	issues: readonly ImportIssue[],
): TopBarImportFidelitySummary => ({
	importedCount: report.importedCount,
	artboardCount: report.artboardCount,
	approximatedCount: report.approximatedCount,
	unsupportedCount: report.unsupportedCount,
	artboardApproximatedCount: report.artboardSummary.approximated,
	artboardUnsupportedCount: report.artboardSummary.unsupported,
	warningCount: countIssues(issues, "warning"),
	errorCount: countIssues(issues, "error"),
});

const statusForFidelity = (
	fidelity: TopBarImportFidelitySummary,
): TopBarImportReportStatus => {
	if (fidelity.errorCount > 0) return "error";
	if (
		fidelity.warningCount > 0 ||
		(fidelity.importedCount === 0 && fidelity.artboardCount === 0)
	) {
		return "warning";
	}
	return "success";
};

const appendedPayload = (payload: ImportedScenePayload): boolean =>
	payload.layers.length > 0 || (payload.artboards?.length ?? 0) > 0;

const nodeIdsForPayload = (
	payload: ImportedScenePayload,
): readonly string[] => {
	const ids: string[] = [];
	const visit = (nodes: ImportedScenePayload["layers"][number]["nodes"]) => {
		for (const node of nodes) {
			ids.push(node.id);
			if (node.children) visit(node.children);
		}
	};
	for (const layer of payload.layers) visit(layer.nodes);
	return ids.sort();
};

const issueSummaryForPayload = (
	payload: ImportedScenePayload,
	issues: readonly ImportIssue[] = payload.issues,
): ImportIssueSummary =>
	summarizeImportIssues(issues, {
		affectedNodeIds: nodeIdsForPayload(payload),
		affectedArtboardIds:
			payload.artboards?.map((artboard) => artboard.id) ?? [],
		affectedAssetIds: payload.assets?.map((asset) => asset.id) ?? [],
	});

const reportIssueDetails = (issueSummary: ImportIssueSummary) => ({
	issueSummary,
	issueGroups: issueSummary.groups,
	fallbackTypes: issueSummary.fallbackTypes,
	affectedTargets: issueSummary.affectedTargets,
	affectedNodeIds: issueSummary.affectedNodeIds,
	affectedArtboardIds: issueSummary.affectedArtboardIds,
	affectedAssetIds: issueSummary.affectedAssetIds,
});

const issueStatus = (
	issues: readonly ImportIssue[],
	fallback: TopBarImportReportStatus,
): TopBarImportReportStatus => {
	if (countIssues(issues, "error") > 0) return "error";
	if (countIssues(issues, "warning") > 0) return "warning";
	return fallback;
};

const singleNodeImageFidelity = (
	issues: readonly ImportIssue[],
): TopBarImportFidelitySummary => ({
	importedCount: 1,
	artboardCount: 0,
	approximatedCount: 0,
	unsupportedCount: countIssues(issues, "error"),
	artboardApproximatedCount: 0,
	artboardUnsupportedCount: 0,
	warningCount: countIssues(issues, "warning"),
	errorCount: countIssues(issues, "error"),
});

const artboardOnlyNote = (
	payload: ImportedScenePayload,
	fallback: string,
): string | undefined => {
	if (payload.layers.length > 0) return undefined;
	if ((payload.artboards?.length ?? 0) > 0) {
		return "Artboard metadata was appended, but no editable vector layers were found.";
	}
	return fallback;
};

/**
 * Confirms a saved portability backup through the same compact surface, so the
 * "take your work with you" action gives the user explicit reassurance the file
 * was written rather than relying on a silent browser download.
 */
export function createTopBarBackupSavedReport(
	fileName: string,
	layerCount: number,
): TopBarImportReportModel {
	const issueSummary = summarizeImportIssues([]);
	return {
		status: "success",
		title: "Backup saved",
		sourceName: fileName,
		sourceFormat: "backup",
		importedCount: layerCount,
		issues: [],
		fidelity: emptyFidelitySummary([]),
		...reportIssueDetails(issueSummary),
		note: "Scene, motion, and motion-grammar bindings saved to one restorable file. Keep it safe — it reopens here without any account or server.",
	};
}

/**
 * Reports a restore from a portable JSON file. Restores replace the document
 * rather than appending, so the note states exactly what was overwritten and
 * whether the current motion side-car was preserved (scene-only restores).
 */
export function createTopBarBackupRestoreReport(
	fileName: string,
	result: ProjectRestoreResult,
): TopBarImportReportModel {
	if (result.status === "failed") {
		const issues: readonly ImportIssue[] = result.issues.map((entry) => ({
			severity: "error",
			code: `backup.${entry.code}`,
			message: entry.message,
			source: fileName,
		}));
		const issueSummary = summarizeImportIssues(issues);
		return {
			status: "error",
			title: "Restore failed",
			sourceName: fileName,
			sourceFormat: "backup",
			importedCount: 0,
			issues,
			fidelity: emptyFidelitySummary(issues),
			...reportIssueDetails(issueSummary),
			note: "The document was left unchanged.",
		};
	}

	const restoredMotion = result.motion !== undefined;
	const restoredGrammar = result.grammar !== undefined;
	const restoreNote =
		result.format === "project-backup" ||
		result.format === "legacy-time-delay-master-instances"
			? restoredGrammar
				? "Scene, motion, and motion-grammar bindings were replaced from the backup."
				: "Scene and motion were replaced from the backup; motion-grammar bindings were cleared."
			: restoredMotion
				? "Scene and motion were replaced."
				: "Scene was replaced; current motion and motion-grammar bindings were left unchanged.";
	const compatibilityIssues: readonly ImportIssue[] =
		result.compatibility.entries
			.filter((entry) => entry.state !== "editable")
			.map((entry) => ({
				severity: "warning",
				code: `backup.authoring-compatibility.${entry.state}.${entry.capabilityId}`,
				message: `${entry.label}: ${entry.reason ?? "This capability is not fully editable in the current GUI."}`,
				source: fileName,
			}));
	const issueSummary = summarizeImportIssues(compatibilityIssues);
	const compatibilityNote =
		compatibilityIssues.length > 0
			? ` ${result.compatibility.partialCapabilityCount} partial and ${result.compatibility.blockedCapabilityCount} blocked GUI capability rows are listed instead of being loaded invisibly.`
			: " All present authorable capability rows are currently GUI-editable.";
	return {
		status: compatibilityIssues.length > 0 ? "warning" : "success",
		title:
			result.format === "project-backup" ||
			result.format === "legacy-time-delay-master-instances"
				? compatibilityIssues.length > 0
					? "Backup restored with authoring limits"
					: "Backup restored"
				: "Scene restored",
		sourceName: fileName,
		sourceFormat: result.format,
		importedCount: result.scene.layers.length,
		issues: compatibilityIssues,
		fidelity: emptyFidelitySummary(compatibilityIssues),
		...reportIssueDetails(issueSummary),
		note: `${restoreNote}${compatibilityNote}`,
	};
}

/**
 * Reports a local raster placement through the same compact import surface used
 * by SVG/AI. The image itself is now scene content, while affected node/asset
 * ids keep later export fallback diagnostics traceable.
 */
export function createTopBarImagePlacementReport({
	sourceName,
	sourceFormat,
	nodeId,
	assetId,
	issues = [],
}: TopBarImagePlacementReportInput): TopBarImportReportModel {
	const issueSummary = summarizeImportIssues(issues, {
		affectedNodeIds: [nodeId],
		affectedAssetIds: [assetId],
	});
	const status = issueStatus(issues, "success");
	return {
		status,
		title: status === "success" ? "Image placed" : "Image placed with fallback",
		sourceName,
		sourceFormat,
		importedCount: 1,
		issues,
		fidelity: singleNodeImageFidelity(issues),
		...reportIssueDetails(issueSummary),
	};
}

/**
 * Reports a local video placement through the same compact import surface used
 * by image placement. Frame extraction happens in browser render/export paths,
 * so the report stays focused on the new scene node and asset.
 */
export function createTopBarVideoPlacementReport({
	sourceName,
	sourceFormat,
	nodeId,
	assetId,
	durationSeconds,
	issues = [],
}: TopBarVideoPlacementReportInput): TopBarImportReportModel {
	const issueSummary = summarizeImportIssues(issues, {
		affectedNodeIds: [nodeId],
		affectedAssetIds: [assetId],
	});
	const status = issueStatus(issues, "success");
	const duration =
		durationSeconds && Number.isFinite(durationSeconds)
			? `${Math.round(durationSeconds * 10) / 10}s`
			: null;
	return {
		status,
		title: status === "success" ? "Video placed" : "Video placed with fallback",
		sourceName,
		sourceFormat,
		importedCount: 1,
		issues,
		fidelity: singleNodeImageFidelity(issues),
		...reportIssueDetails(issueSummary),
		...(duration ? { note: `Duration ${duration}` } : {}),
	};
}

const compactProgramSurfaceDigest = (digest: `sha256:${string}`): string =>
	`${digest.slice(0, 15)}…${digest.slice(-8)}`;

/**
 * Reports one verified-but-inert Program Surface placement. Approval and host
 * readiness remain separate Inspector/runtime concerns, so this report never
 * claims that the selected JavaScript is running.
 */
export function createTopBarProgramSurfacePlacementReport({
	sourceName,
	sourceFormat,
	nodeId,
	assetId,
	verifiedCompiledDigest,
}: TopBarProgramSurfacePlacementReportInput): TopBarImportReportModel {
	const issues: readonly ImportIssue[] = [];
	const issueSummary = summarizeImportIssues(issues, {
		affectedNodeIds: [nodeId],
		affectedAssetIds: [assetId],
	});
	return {
		status: "success",
		title: "Program Surface placed",
		sourceName,
		sourceFormat,
		importedCount: 1,
		issues,
		fidelity: singleNodeImageFidelity(issues),
		...reportIssueDetails(issueSummary),
		note: `Verified ${compactProgramSurfaceDigest(verifiedCompiledDigest)}. The surface is inactive; inspect its manifest and declared fallback before explicit local approval.`,
	};
}

/**
 * Uses the existing import-report surface for bounded Program Surface intake
 * failures. The caller supplies only verifier-owned static messages, never raw
 * source text or an exception message.
 */
export function createTopBarProgramSurfacePackageRejectedReport({
	sourceName,
	sourceFormat,
	code,
	message,
}: TopBarProgramSurfacePackageRejectedReportInput): TopBarImportReportModel {
	const issues: readonly ImportIssue[] = [
		{
			severity: "error",
			code,
			message,
			source: sourceName,
		},
	];
	const issueSummary = summarizeImportIssues(issues);
	return {
		status: "error",
		title: "Program Surface package not imported",
		sourceName,
		sourceFormat,
		importedCount: 0,
		issues,
		fidelity: emptyFidelitySummary(issues),
		...reportIssueDetails(issueSummary),
		note: "No Program Surface asset, placement, or approval was created.",
	};
}

/**
 * A binding-fence miss is not a malformed package. Keep it visible as a
 * warning while making clear that the delayed result made no scene change.
 */
export function createTopBarProgramSurfacePackageStaleReport({
	sourceName,
	sourceFormat,
}: TopBarProgramSurfacePackageStaleReportInput): TopBarImportReportModel {
	const issues: readonly ImportIssue[] = [
		{
			severity: "warning",
			code: "program-surface-package-editor-changed",
			message:
				"Editor changed while the Program Surface package was being read. No scene changes were made.",
			source: sourceName,
		},
	];
	const issueSummary = summarizeImportIssues(issues);
	return {
		status: "warning",
		title: "Program Surface package not imported",
		sourceName,
		sourceFormat,
		importedCount: 0,
		issues,
		fidelity: emptyFidelitySummary(issues),
		...reportIssueDetails(issueSummary),
		note: "The delayed package result was discarded for this editor.",
	};
}

/**
 * Creates the compact TopBar import report from parser payload metadata. The UI
 * needs one format-neutral summary for SVG and PDF-compatible AI without
 * inspecting parser-specific issue codes inside the React component.
 */
export function createTopBarImportReportFromPayload(
	payload: ImportedScenePayload,
	options: TopBarImportReportOptions,
): TopBarImportReportModel {
	const report = summarizeImportedScenePayload(payload);
	const fidelity = fidelitySummary(report, payload.issues);
	const issueSummary = issueSummaryForPayload(payload);
	const appended = appendedPayload(payload);
	const note = artboardOnlyNote(payload, appended ? "" : options.emptyNote);
	return {
		status: statusForFidelity(fidelity),
		title: appended ? options.importedTitle : options.emptyTitle,
		sourceName: options.sourceName,
		sourceFormat: payload.sourceFormat ?? options.sourceFormat,
		importedCount: report.importedCount,
		issues: payload.issues,
		fidelity,
		...reportIssueDetails(issueSummary),
		...(note ? { note } : {}),
	};
}

/**
 * Converts `.ai` analysis into the same compact report shape used by SVG
 * imports. PDF-compatible payloads report imported scene fidelity, while native
 * or legacy AI files keep unsupported diagnostics visible without mutating the
 * scene.
 */
export function createTopBarAiImportReport(
	analysis: AiImportAnalysis,
): TopBarImportReportModel {
	if (analysis.kind === "unsupported") {
		const fidelity = fidelitySummary(analysis.fidelityReport, analysis.issues);
		const issueSummary = summarizeImportIssues(analysis.issues);
		return {
			status: "error",
			title: "AI import unsupported",
			sourceName: analysis.sourceName ?? "Untitled AI import",
			sourceFormat: analysis.sourceFormat,
			importedCount: 0,
			issues: analysis.issues,
			fidelity,
			...reportIssueDetails(issueSummary),
			note: "No scene layers or artboards were appended.",
		};
	}

	const payload = analysis.scenePayload;
	const fidelity = fidelitySummary(analysis.fidelityReport, analysis.issues);
	const issueSummary = issueSummaryForPayload(payload, analysis.issues);
	const appended = appendedPayload(payload);
	const note = artboardOnlyNote(
		payload,
		"No scene layers or artboards were appended from this PDF-compatible AI payload.",
	);
	return {
		status: statusForFidelity(fidelity),
		title: appended ? "AI payload imported" : "AI payload inspected",
		sourceName: analysis.sourceName ?? "Untitled AI import",
		sourceFormat: analysis.sourceFormat,
		importedCount: analysis.fidelityReport.importedCount,
		issues: analysis.issues,
		fidelity,
		...reportIssueDetails(issueSummary),
		...(note ? { note } : {}),
	};
}

/**
 * Builds an error report for file-read and unexpected import failures while
 * preserving the same metric contract as parser-backed reports.
 */
export function createTopBarImportErrorReport(
	sourceName: string,
	error: unknown,
): TopBarImportReportModel {
	const issues: readonly ImportIssue[] = [
		{
			severity: "error",
			code: "import.unhandled-error",
			message:
				error instanceof Error
					? error.message
					: "The selected file could not be imported.",
			source: sourceName,
		},
	];
	const issueSummary = summarizeImportIssues(issues);
	return {
		status: "error",
		title: "Import failed",
		sourceName,
		sourceFormat: "unknown",
		importedCount: 0,
		issues,
		fidelity: emptyFidelitySummary(issues),
		...reportIssueDetails(issueSummary),
	};
}

/**
 * Normalizes unsupported file-reader results into the TopBar report contract.
 */
export function createTopBarUnsupportedImportReport({
	sourceName,
	sourceFormat,
	issues,
}: {
	readonly sourceName: string;
	readonly sourceFormat: string;
	readonly issues: readonly ImportIssue[];
}): TopBarImportReportModel {
	const issueSummary = summarizeImportIssues(issues);
	return {
		status: "error",
		title: "Import unsupported",
		sourceName,
		sourceFormat,
		importedCount: 0,
		issues,
		fidelity: emptyFidelitySummary(issues),
		...reportIssueDetails(issueSummary),
		note: "No scene layers or artboards were appended.",
	};
}

/**
 * Keeps unsupported raster imports visible while the local placement bridge
 * intentionally supports PNG/JPEG/WebP only and does not add upload/storage.
 */
export function createTopBarUnsupportedImageReport({
	sourceName,
	sourceFormat,
}: TopBarUnsupportedImageReportInput): TopBarImportReportModel {
	const issues: readonly ImportIssue[] = [
		{
			severity: "error",
			code: "image.unsupported-file-type",
			message:
				"Only PNG, JPEG, and WebP images can be placed as local scene assets here.",
			source: sourceName,
			fallbackType: "unsupported-file",
		},
	];
	const issueSummary = summarizeImportIssues(issues);
	return {
		status: "error",
		title: "Image import unsupported",
		sourceName,
		sourceFormat,
		importedCount: 0,
		issues,
		fidelity: emptyFidelitySummary(issues),
		...reportIssueDetails(issueSummary),
		note: "No image asset or scene node was appended.",
	};
}

/** Reports a video file that the local browser placement bridge cannot decode. */
export function createTopBarUnsupportedVideoReport({
	sourceName,
	sourceFormat,
}: TopBarUnsupportedVideoReportInput): TopBarImportReportModel {
	const issues: readonly ImportIssue[] = [
		{
			severity: "error",
			code: "video.unsupported-file-type",
			message:
				"Only browser-playable MP4, WebM, MOV, M4V, and Ogg video files can be placed as local scene media here.",
			source: sourceName,
			fallbackType: "unsupported-file",
		},
	];
	const issueSummary = summarizeImportIssues(issues);
	return {
		status: "error",
		title: "Video import unsupported",
		sourceName,
		sourceFormat,
		importedCount: 0,
		issues,
		fidelity: emptyFidelitySummary(issues),
		...reportIssueDetails(issueSummary),
		note: "No video asset or scene node was appended.",
	};
}
