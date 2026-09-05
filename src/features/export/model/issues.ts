import { sortedSceneFidelityIssueTargets } from "@/entities/scene/model/fidelity-issues";

export type ExportIssueSeverity = "info" | "warning" | "error";

export type ExportIssueCategory =
	| "approximated"
	| "fallback"
	| "invalid"
	| "normalized"
	| "rasterized"
	| "unsupported";

export type ExportIssueFallback =
	| "default-color"
	| "declared-raster-fallback"
	| "external-image-reference"
	| "fixed-text-style"
	| "font-substitution"
	| "local-raster-required"
	| "motion-grammar-omitted"
	| "normalized-value"
	| "preview-image"
	/**
	 * The export fell back from a frame-driven WebCodecs capture to the
	 * real-time `MediaRecorder`/`captureStream` path, because WebCodecs (or the
	 * requested codec config) is unavailable in this browser, or the
	 * frame-driven encoder failed mid-export.
	 */
	| "real-time-capture"
	/**
	 * S4-D: a rendered Blender frame package was composed into this capture, but
	 * the capture cannot stand behind frame identity — the wall-clock sampled
	 * encoder was used, a composed package was stale or not reproducible, or
	 * fewer frames carried package pixels than were requested. The pixels ship;
	 * the EXACT claim does not.
	 */
	| "frame-package-exactness-blocked"
	| "rasterized-bitmap"
	| "unclipped-vector"
	| "uniform-stroke-width"
	| "vector-placeholder"
	/**
	 * S5a minimal audio lane: the mixed audio track could not be decoded/muxed
	 * (or this browser cannot encode the audio codec), so the WebM export
	 * completed video-only. Recorded rather than silent so a missing audio
	 * track is always visible in the export report.
	 */
	| "audio-track-omitted";

export type ExportIssueAffectedTargetKind =
	| "artboard"
	| "asset"
	| "layer"
	| "node"
	| "requested-artboard"
	| "source"
	| "track";

/**
 * Normalized locator for export review surfaces. SVG/PDF renderers still emit
 * their compact typed issue fields, while reports and manifests use this target
 * list to render one deterministic fidelity-review workflow.
 */
export type ExportIssueAffectedTarget = {
	readonly kind: ExportIssueAffectedTargetKind;
	readonly id: string;
	readonly label?: string;
	readonly role?: string;
};

/**
 * Format-neutral export degradation entry. SVG and PDF adapters specialize the
 * `code` union, but the shared fields let bundle manifests and UI report code
 * group approximations, fallbacks, and unsupported content without parsing
 * format bytes.
 */
export type ExportIssue = {
	readonly severity: ExportIssueSeverity;
	readonly category: ExportIssueCategory;
	readonly code: string;
	readonly message: string;
	readonly fallback: ExportIssueFallback;
	readonly layerId?: string;
	readonly nodeId?: string;
	readonly assetId?: string;
	readonly artboardId?: string;
	readonly requestedArtboardId?: string;
	readonly trackId?: string;
	/**
	 * Stable source-document paths carried from imported appearance metadata.
	 * Export manifests keep these beside scene ids so review surfaces can jump
	 * from a degraded export issue back to the imported SVG/PDF feature.
	 */
	readonly sourcePaths?: readonly string[];
	readonly assetFileName?: string;
	readonly assetRole?: string;
};

type ExportIssueCategoryCounts = Readonly<
	Record<Exclude<ExportIssueCategory, "rasterized">, number> &
		Partial<Record<Extract<ExportIssueCategory, "rasterized">, number>>
>;

export type ExportIssueSummary = {
	readonly total: number;
	readonly bySeverity: Readonly<Record<ExportIssueSeverity, number>>;
	readonly byCategory: ExportIssueCategoryCounts;
	readonly byCode: readonly {
		readonly code: string;
		readonly count: number;
	}[];
	readonly affectedTargets: readonly ExportIssueAffectedTarget[];
	readonly affectedLayerIds: readonly string[];
	readonly affectedNodeIds: readonly string[];
	readonly affectedAssetIds: readonly string[];
};

export type ExportReportIssueLike = {
	readonly severity: ExportIssueSeverity;
	readonly category: ExportIssueCategory | "motion";
	readonly code: string;
	readonly message: string;
	readonly fallback?: ExportIssueFallback;
	readonly layerId?: string;
	readonly nodeId?: string;
	readonly assetId?: string;
	readonly artboardId?: string;
	readonly requestedArtboardId?: string;
	readonly trackId?: string;
	readonly sourcePaths?: readonly string[];
	readonly assetFileName?: string;
	readonly assetRole?: string;
};

export type ExportIssueGroup = {
	readonly category: ExportReportIssueLike["category"];
	readonly severity: ExportIssueSeverity;
	readonly count: number;
	readonly reviewLabel: string;
	readonly suggestedAction: string;
	readonly codes: readonly string[];
	readonly fallbackTypes: readonly ExportIssueFallback[];
	readonly affectedTargets: readonly ExportIssueAffectedTarget[];
	readonly affectedLayerIds: readonly string[];
	readonly affectedNodeIds: readonly string[];
	readonly affectedAssetIds: readonly string[];
	readonly affectedArtboardIds: readonly string[];
	readonly requestedArtboardIds: readonly string[];
	readonly affectedTrackIds: readonly string[];
	readonly assetFileNames: readonly string[];
	readonly assetRoles: readonly string[];
	readonly sampleMessage: string;
	readonly detailMessages: readonly string[];
};

export type ExportReportIssueSummary = {
	readonly total: number;
	readonly bySeverity: Readonly<Record<ExportIssueSeverity, number>>;
	readonly byCategory: readonly {
		readonly category: ExportReportIssueLike["category"];
		readonly count: number;
	}[];
	readonly byCode: readonly {
		readonly code: string;
		readonly count: number;
	}[];
	readonly groups: readonly ExportIssueGroup[];
	readonly fallbackTypes: readonly ExportIssueFallback[];
	readonly affectedTargets: readonly ExportIssueAffectedTarget[];
	readonly affectedLayerIds: readonly string[];
	readonly affectedNodeIds: readonly string[];
	readonly affectedAssetIds: readonly string[];
	readonly affectedArtboardIds: readonly string[];
	readonly requestedArtboardIds: readonly string[];
	readonly affectedTrackIds: readonly string[];
	readonly assetRoles: readonly string[];
};

const issueSeverities = ["info", "warning", "error"] as const;
const issueCategories = [
	"approximated",
	"fallback",
	"invalid",
	"normalized",
	"rasterized",
	"unsupported",
] as const;

const severityRank: Readonly<Record<ExportIssueSeverity, number>> = {
	error: 2,
	warning: 1,
	info: 0,
};

const categoryRank: Readonly<
	Record<ExportReportIssueLike["category"], number>
> = {
	unsupported: 6,
	invalid: 5,
	fallback: 4,
	rasterized: 3,
	approximated: 2,
	normalized: 1,
	motion: 0,
};

const targetKindRank: Readonly<Record<ExportIssueAffectedTargetKind, number>> =
	{
		artboard: 0,
		node: 1,
		layer: 2,
		asset: 3,
		source: 4,
		track: 5,
		"requested-artboard": 6,
	};

const exportReviewCopy: Readonly<
	Record<
		ExportReportIssueLike["category"],
		{
			readonly reviewLabel: string;
			readonly suggestedAction: string;
		}
	>
> = {
	unsupported: {
		reviewLabel: "Review unsupported export",
		suggestedAction:
			"Inspect placeholders or unclipped output and replace unsupported artwork before delivery.",
	},
	invalid: {
		reviewLabel: "Repair invalid export input",
		suggestedAction:
			"Fix invalid geometry, artboard, or source values and export again.",
	},
	fallback: {
		reviewLabel: "Review export fallback",
		suggestedAction:
			"Compare fallback output against the editor scene and approve or replace it.",
	},
	approximated: {
		reviewLabel: "Review export approximation",
		suggestedAction:
			"Check the affected asset visually before using it in production.",
	},
	rasterized: {
		reviewLabel: "Review rasterized export",
		suggestedAction:
			"Check bitmap-backed paint at the intended delivery resolution before using it in production.",
	},
	normalized: {
		reviewLabel: "Review normalized export value",
		suggestedAction:
			"Confirm clamped or normalized values still match the intended artwork.",
	},
	motion: {
		reviewLabel: "Review motion presentation",
		suggestedAction:
			"Fix missing motion targets or track data before relying on exported animation metadata.",
	},
};

const countBy = <Key extends string>(
	keys: readonly Key[],
	values: readonly Key[],
): Readonly<Record<Key, number>> => {
	const counts = Object.fromEntries(keys.map((key) => [key, 0])) as Record<
		Key,
		number
	>;
	for (const value of values) counts[value] += 1;
	return counts;
};

const sortedUnique = (
	values: readonly (string | undefined)[],
): readonly string[] =>
	[
		...new Set(values.filter((value): value is string => Boolean(value))),
	].sort();

const sortedUniqueTargets = (
	targets: readonly (ExportIssueAffectedTarget | undefined)[],
): readonly ExportIssueAffectedTarget[] =>
	sortedSceneFidelityIssueTargets(targets, targetKindRank);

const targetsForIssue = (
	issue: ExportReportIssueLike,
): readonly ExportIssueAffectedTarget[] =>
	sortedUniqueTargets([
		issue.artboardId ? { kind: "artboard", id: issue.artboardId } : undefined,
		issue.nodeId ? { kind: "node", id: issue.nodeId } : undefined,
		issue.layerId ? { kind: "layer", id: issue.layerId } : undefined,
		issue.assetId ? { kind: "asset", id: issue.assetId } : undefined,
		issue.assetFileName
			? {
					kind: "asset",
					id: issue.assetFileName,
					...(issue.assetRole ? { role: issue.assetRole } : {}),
				}
			: undefined,
		issue.trackId ? { kind: "track", id: issue.trackId } : undefined,
		...(issue.sourcePaths ?? []).map((sourcePath) => ({
			kind: "source" as const,
			id: sourcePath,
		})),
		issue.requestedArtboardId
			? {
					kind: "requested-artboard",
					id: issue.requestedArtboardId,
				}
			: undefined,
	]);

const worstIssueSeverity = (
	issues: readonly ExportReportIssueLike[],
): ExportIssueSeverity => {
	if (issues.some((issue) => issue.severity === "error")) return "error";
	if (issues.some((issue) => issue.severity === "warning")) return "warning";
	return "info";
};

const codeCounts = (
	issues: readonly ExportIssue[],
): ExportIssueSummary["byCode"] => {
	const counts = new Map<string, number>();
	for (const issue of issues) {
		counts.set(issue.code, (counts.get(issue.code) ?? 0) + 1);
	}
	return [...counts.entries()]
		.sort(([leftCode], [rightCode]) => leftCode.localeCompare(rightCode))
		.map(([code, count]) => ({ code, count }));
};

const reportCodeCounts = (
	issues: readonly ExportReportIssueLike[],
): ExportReportIssueSummary["byCode"] => {
	const counts = new Map<string, number>();
	for (const issue of issues) {
		counts.set(issue.code, (counts.get(issue.code) ?? 0) + 1);
	}
	return [...counts.entries()]
		.sort(([leftCode], [rightCode]) => leftCode.localeCompare(rightCode))
		.map(([code, count]) => ({ code, count }));
};

const reportCategoryCounts = (
	issues: readonly ExportReportIssueLike[],
): ExportReportIssueSummary["byCategory"] => {
	const counts = new Map<ExportReportIssueLike["category"], number>();
	for (const issue of issues) {
		counts.set(issue.category, (counts.get(issue.category) ?? 0) + 1);
	}
	return [...counts.entries()]
		.sort(([leftCategory], [rightCategory]) =>
			leftCategory.localeCompare(rightCategory),
		)
		.map(([category, count]) => ({ category, count }));
};

/**
 * Produces a stable issue summary for export reports. The summary is derived
 * entirely from typed issues so future UI surfaces can render counters and
 * affected-node affordances without duplicating classification heuristics.
 */
export function summarizeExportIssues(
	issues: readonly ExportIssue[],
): ExportIssueSummary {
	return {
		total: issues.length,
		bySeverity: countBy(
			issueSeverities,
			issues.map((issue) => issue.severity),
		),
		byCategory: countBy(
			issueCategories,
			issues.map((issue) => issue.category),
		),
		byCode: codeCounts(issues),
		affectedTargets: sortedUniqueTargets(issues.flatMap(targetsForIssue)),
		affectedLayerIds: sortedUnique(issues.map((issue) => issue.layerId)),
		affectedNodeIds: sortedUnique(issues.map((issue) => issue.nodeId)),
		affectedAssetIds: sortedUnique(issues.map((issue) => issue.assetId)),
	};
}

/**
 * Groups typed export diagnostics for compact report surfaces. Callers can pass
 * regular asset issues, artboard-scope issues, or motion presentation issues as
 * long as they preserve the shared category/code/fallback/affected-id fields.
 */
export function groupExportIssues(
	issues: readonly ExportReportIssueLike[],
): readonly ExportIssueGroup[] {
	const groups = new Map<
		ExportReportIssueLike["category"],
		ExportReportIssueLike[]
	>();
	for (const issue of issues) {
		groups.set(issue.category, [...(groups.get(issue.category) ?? []), issue]);
	}

	return [...groups.entries()]
		.map(([category, groupIssues]) => ({
			category,
			severity: worstIssueSeverity(groupIssues),
			count: groupIssues.length,
			reviewLabel: exportReviewCopy[category].reviewLabel,
			suggestedAction: exportReviewCopy[category].suggestedAction,
			codes: sortedUnique(groupIssues.map((issue) => issue.code)),
			fallbackTypes: sortedUnique(
				groupIssues.map((issue) => issue.fallback),
			) as readonly ExportIssueFallback[],
			affectedTargets: sortedUniqueTargets(
				groupIssues.flatMap(targetsForIssue),
			),
			affectedLayerIds: sortedUnique(groupIssues.map((issue) => issue.layerId)),
			affectedNodeIds: sortedUnique(groupIssues.map((issue) => issue.nodeId)),
			affectedAssetIds: sortedUnique(groupIssues.map((issue) => issue.assetId)),
			affectedArtboardIds: sortedUnique(
				groupIssues.map((issue) => issue.artboardId),
			),
			requestedArtboardIds: sortedUnique(
				groupIssues.map((issue) => issue.requestedArtboardId),
			),
			affectedTrackIds: sortedUnique(groupIssues.map((issue) => issue.trackId)),
			assetFileNames: sortedUnique(
				groupIssues.map((issue) => issue.assetFileName),
			),
			assetRoles: sortedUnique(groupIssues.map((issue) => issue.assetRole)),
			sampleMessage: groupIssues[0]?.message ?? "",
			detailMessages: sortedUnique(groupIssues.map((issue) => issue.message)),
		}))
		.sort((left, right) => {
			const severityDelta =
				severityRank[right.severity] - severityRank[left.severity];
			if (severityDelta !== 0) return severityDelta;
			const countDelta = right.count - left.count;
			if (countDelta !== 0) return countDelta;
			const categoryDelta =
				categoryRank[right.category] - categoryRank[left.category];
			if (categoryDelta !== 0) return categoryDelta;
			return left.category.localeCompare(right.category);
		});
}

/**
 * Summarizes asset, artboard-scope, and motion export diagnostics for report UI
 * without duplicating category, affected-target, fallback, or grouping logic in
 * widget code. The returned groups are sorted with the same severity/count
 * ordering as manifest groups.
 */
export function summarizeExportReportIssues(
	issues: readonly ExportReportIssueLike[],
): ExportReportIssueSummary {
	const groups = groupExportIssues(issues);
	return {
		total: issues.length,
		bySeverity: {
			info: issues.filter((issue) => issue.severity === "info").length,
			warning: issues.filter((issue) => issue.severity === "warning").length,
			error: issues.filter((issue) => issue.severity === "error").length,
		},
		byCategory: reportCategoryCounts(issues),
		byCode: reportCodeCounts(issues),
		groups,
		fallbackTypes: sortedUnique(
			issues.map((issue) => issue.fallback),
		) as readonly ExportIssueFallback[],
		affectedTargets: sortedUniqueTargets(issues.flatMap(targetsForIssue)),
		affectedLayerIds: sortedUnique(issues.map((issue) => issue.layerId)),
		affectedNodeIds: sortedUnique(issues.map((issue) => issue.nodeId)),
		affectedAssetIds: sortedUnique(issues.map((issue) => issue.assetId)),
		affectedArtboardIds: sortedUnique(issues.map((issue) => issue.artboardId)),
		requestedArtboardIds: sortedUnique(
			issues.map((issue) => issue.requestedArtboardId),
		),
		affectedTrackIds: sortedUnique(issues.map((issue) => issue.trackId)),
		assetRoles: sortedUnique(issues.map((issue) => issue.assetRole)),
	};
}

/**
 * Returns the highest-severity issue in a stable order suitable for compact
 * asset rows. `null` means the asset can be treated as clean by report UI.
 */
export function worstExportIssueSeverity(
	issues: readonly ExportIssue[],
): ExportIssueSeverity | null {
	if (issues.some((issue) => issue.severity === "error")) return "error";
	if (issues.some((issue) => issue.severity === "warning")) return "warning";
	if (issues.some((issue) => issue.severity === "info")) return "info";
	return null;
}
