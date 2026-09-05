import { sortedSceneFidelityIssueTargets } from "@/entities/scene/model/fidelity-issues";
import type {
	Artboard,
	SceneAsset,
	SceneLayer,
	VectorNode,
} from "@/entities/scene/model/types";

/** Severity level for import diagnostics surfaced to parser, report, and UI code. */
export type ImportIssueSeverity = "info" | "warning" | "error";

export type ImportIssueAffectedTargetKind =
	| "artboard"
	| "asset"
	| "node"
	| "source";

/**
 * Normalized locator for import review surfaces. Parser issues may still carry
 * legacy `nodeId`/`artboardId` fields, but reports should consume this target
 * list so UI code can render one deterministic production-review model across
 * SVG and PDF-compatible AI imports.
 */
export type ImportIssueAffectedTarget = {
	readonly kind: ImportIssueAffectedTargetKind;
	readonly id: string;
	readonly label?: string;
	readonly source?: string;
	readonly ref?: string;
	readonly path?: string;
};

/**
 * Diagnostic emitted while converting an external vector source into scene
 * layers. Importers must report unsupported or approximated content here instead
 * of silently dropping source data.
 */
export type ImportIssue = {
	readonly severity: ImportIssueSeverity;
	readonly code: string;
	readonly message: string;
	/**
	 * Normalized affected targets when one diagnostic applies to multiple scene
	 * objects. Legacy `nodeId`/`artboardId`/`assetId` stay available for compact
	 * one-target issues, while this list lets importers keep compound paths,
	 * flattened masks, and text fallbacks tied to every editable review target.
	 */
	readonly affectedTargets?: readonly ImportIssueAffectedTarget[];
	readonly source?: string;
	readonly ref?: string;
	readonly path?: string;
	readonly nodeId?: string;
	readonly artboardId?: string;
	readonly assetId?: string;
	readonly fallbackType?: string;
};

export type ImportIssueCategory =
	| "approximated"
	| "fallback"
	| "unsupported"
	| "artboard"
	| "other";

export type ImportIssueGroup = {
	readonly category: ImportIssueCategory;
	readonly severity: ImportIssueSeverity;
	readonly count: number;
	readonly reviewLabel: string;
	readonly suggestedAction: string;
	readonly codes: readonly string[];
	readonly fallbackTypes: readonly string[];
	readonly affectedTargets: readonly ImportIssueAffectedTarget[];
	readonly affectedNodeIds: readonly string[];
	readonly affectedArtboardIds: readonly string[];
	readonly affectedAssetIds: readonly string[];
	readonly refs: readonly string[];
	readonly paths: readonly string[];
	readonly sources: readonly string[];
	readonly sampleMessage: string;
	readonly detailMessages: readonly string[];
};

export type ImportIssueSummary = {
	readonly total: number;
	readonly bySeverity: Readonly<Record<ImportIssueSeverity, number>>;
	readonly byCategory: Readonly<Record<ImportIssueCategory, number>>;
	readonly byCode: readonly {
		readonly code: string;
		readonly count: number;
	}[];
	readonly fallbackTypes: readonly string[];
	readonly affectedTargets: readonly ImportIssueAffectedTarget[];
	readonly affectedNodeIds: readonly string[];
	readonly affectedArtboardIds: readonly string[];
	readonly affectedAssetIds: readonly string[];
	readonly refs: readonly string[];
	readonly paths: readonly string[];
	readonly sources: readonly string[];
	readonly groups: readonly ImportIssueGroup[];
};

/**
 * Parser output that can be appended to the scene through the scene command bus.
 * It stays POJO-serializable so imported layers can flow into undo/redo,
 * export, and future Worker adapters without feature-owned runtime state.
 */
export type ImportedScenePayload = {
	readonly layers: readonly SceneLayer[];
	readonly issues: readonly ImportIssue[];
	readonly sourceName?: string;
	readonly sourceFormat?: string;
	/**
	 * Optional SceneDocument-compatible artboards discovered during import.
	 * Import adapters include this when source viewport/page signals can be
	 * mapped without changing the scene schema; command/UI code may merge it
	 * later while older append-only callers continue to read `layers`.
	 */
	readonly artboards?: readonly Artboard[];
	readonly currentArtboardId?: string;
	/**
	 * Optional document-local assets discovered during import. Importers include
	 * data URLs or source references here so editable image nodes can survive
	 * round-trip without storage/upload integration.
	 */
	readonly assets?: readonly SceneAsset[];
};

/**
 * Format-neutral fidelity counters for import results. The counts are derived
 * from scene nodes plus typed issue codes so callers can compare SVG and
 * PDF-compatible AI outcomes without changing scene document contracts.
 */
export type ImportFidelityReport = {
	readonly accepted: boolean;
	readonly sourceName?: string;
	readonly sourceFormat?: string;
	readonly importedCount: number;
	readonly approximatedCount: number;
	readonly unsupportedCount: number;
	readonly artboardCount: number;
	readonly artboardSummary: {
		readonly imported: number;
		readonly approximated: number;
		readonly unsupported: number;
	};
	readonly summary: {
		readonly imported: number;
		readonly approximated: number;
		readonly unsupported: number;
	};
	readonly issueCounts: Readonly<Record<ImportIssueSeverity, number>>;
	readonly issueCodes: readonly string[];
};

/**
 * Practical fidelity topic an import diagnostic belongs to. These are the
 * user-facing buckets ("what part of my artwork is affected") rather than the
 * raw parser code namespace, so SVG and PDF-compatible AI issues that mean the
 * same thing collapse into one explainable row.
 */
export type ImportFidelityTopic =
	| "component"
	| "gradient"
	| "clipping"
	| "compound-path"
	| "opacity"
	| "text"
	| "stroke-detail"
	| "color"
	| "transform"
	| "blend-mode"
	| "mask"
	| "image"
	| "artboard"
	| "structure"
	| "other";

/**
 * Practical outcome for a fidelity topic. `imported` means the source content
 * survived intact; `approximated` means it was kept but changed; `unsupported`
 * means it could not be represented and was dropped or replaced.
 */
export type ImportFidelityOutcome = "imported" | "approximated" | "unsupported";

/**
 * Plain-language explanation of one fidelity topic. The import report can render
 * these rows to describe what an import actually preserved, changed, or dropped
 * without exposing raw issue codes or JSON to the user.
 */
export type ImportFidelityExplanation = {
	readonly topic: ImportFidelityTopic;
	readonly outcome: ImportFidelityOutcome;
	readonly severity: ImportIssueSeverity;
	readonly count: number;
	/** Short user-facing title, e.g. "Gradients approximated". */
	readonly headline: string;
	/** One sentence describing what happened to the artwork. */
	readonly detail: string;
	/** Actionable next step, or `undefined` when nothing useful can be done. */
	readonly recommendation?: string;
	readonly codes: readonly string[];
	/**
	 * Source-element references (e.g. SVG `id`) for the issues in this topic, when
	 * the parser recorded them. Reliable locators back into the source artwork.
	 */
	readonly refs: readonly string[];
	/**
	 * Source paths (e.g. `/svg[0]/defs/linearGradient[0]`) for the issues in this
	 * topic. Reliable locators even when the source had no id.
	 */
	readonly paths: readonly string[];
	/**
	 * Imported scene node ids attributed to this topic. Only populated from issues
	 * that carry a `nodeId`; never the full imported-node list, so a row never
	 * falsely claims to affect every node.
	 */
	readonly affectedNodeIds: readonly string[];
	/**
	 * Imported scene artboard ids attributed to this topic. Populated from issues
	 * that carry an `artboardId`, plus caller-supplied artboard ids for the
	 * `artboard` topic only.
	 */
	readonly affectedArtboardIds: readonly string[];
};

const countNodes = (nodes: readonly VectorNode[]): number =>
	nodes.reduce((count, node) => count + 1 + countNodes(node.children ?? []), 0);

const countLayerNodes = (layers: readonly SceneLayer[]): number =>
	layers.reduce((count, layer) => count + countNodes(layer.nodes), 0);

const isApproximatedIssue = (issue: ImportIssue): boolean =>
	issue.code === "ai.pdf_page_box_missing" ||
	issue.code.includes(".approximated") ||
	issue.code.includes("_approximated_") ||
	issue.code.endsWith("_split");

const explicitUnsupportedIssueCodes = new Set([
	"ai.pdf_content_stream_missing",
	"ai.pdf_multiple_pages_unsupported",
	"ai.pdf_payload_missing",
]);

const isUnsupportedIssue = (issue: ImportIssue): boolean =>
	issue.severity === "error" ||
	explicitUnsupportedIssueCodes.has(issue.code) ||
	issue.code.includes(".unsupported") ||
	issue.code.includes("_unsupported_") ||
	issue.code.includes("unsupported-");

const isArtboardFidelityIssue = (issue: ImportIssue): boolean =>
	issue.code.includes("artboard") ||
	issue.code === "ai.pdf_multiple_pages_unsupported" ||
	issue.code === "ai.pdf_page_box_missing";

const issueCategories = [
	"approximated",
	"fallback",
	"unsupported",
	"artboard",
	"other",
] as const;

const severityRank: Readonly<Record<ImportIssueSeverity, number>> = {
	error: 2,
	warning: 1,
	info: 0,
};

const categoryRank: Readonly<Record<ImportIssueCategory, number>> = {
	unsupported: 4,
	fallback: 3,
	approximated: 2,
	artboard: 1,
	other: 0,
};

const targetKindRank: Readonly<Record<ImportIssueAffectedTargetKind, number>> =
	{
		artboard: 0,
		node: 1,
		asset: 2,
		source: 3,
	};

const importReviewCopy: Readonly<
	Record<
		ImportIssueCategory,
		{
			readonly reviewLabel: string;
			readonly suggestedAction: string;
		}
	>
> = {
	unsupported: {
		reviewLabel: "Review unsupported import",
		suggestedAction:
			"Re-create or replace affected source artwork after import.",
	},
	fallback: {
		reviewLabel: "Review import fallback",
		suggestedAction:
			"Compare fallback output with the source and replace with native artwork when needed.",
	},
	approximated: {
		reviewLabel: "Review approximation",
		suggestedAction:
			"Inspect affected editable content against the source before production export.",
	},
	artboard: {
		reviewLabel: "Review artboard mapping",
		suggestedAction:
			"Check imported artboard bounds, page ownership, and content placement.",
	},
	other: {
		reviewLabel: "Review import note",
		suggestedAction: "Inspect the reported source locator before publishing.",
	},
};

const sortedUnique = (
	values: readonly (string | undefined)[],
): readonly string[] =>
	[
		...new Set(values.filter((value): value is string => Boolean(value))),
	].sort();

const sortedUniqueTargets = (
	targets: readonly (ImportIssueAffectedTarget | undefined)[],
): readonly ImportIssueAffectedTarget[] =>
	sortedSceneFidelityIssueTargets(targets, targetKindRank);

const targetsForIssue = (
	issue: ImportIssue,
): readonly ImportIssueAffectedTarget[] => {
	const explicitTargets: ImportIssueAffectedTarget[] = [
		...(issue.affectedTargets ?? []),
		...(issue.artboardId
			? [
					{
						kind: "artboard",
						id: issue.artboardId,
					} satisfies ImportIssueAffectedTarget,
				]
			: []),
		...(issue.nodeId
			? [{ kind: "node", id: issue.nodeId } satisfies ImportIssueAffectedTarget]
			: []),
		...(issue.assetId
			? [
					{
						kind: "asset",
						id: issue.assetId,
					} satisfies ImportIssueAffectedTarget,
				]
			: []),
	];
	if (explicitTargets.length > 0) return explicitTargets;

	const sourceId = issue.ref ?? issue.path ?? issue.source;
	return sourceId
		? [
				{
					kind: "source",
					id: sourceId,
					...(issue.source ? { source: issue.source } : {}),
					...(issue.ref ? { ref: issue.ref } : {}),
					...(issue.path ? { path: issue.path } : {}),
				},
			]
		: [];
};

const targetIdsForIssue = (
	issue: ImportIssue,
	kind: ImportIssueAffectedTargetKind,
): readonly string[] =>
	targetsForIssue(issue).flatMap((target) =>
		target.kind === kind ? [target.id] : [],
	);

const targetsFromIds = ({
	artboardIds = [],
	nodeIds = [],
	assetIds = [],
}: {
	readonly artboardIds?: readonly string[];
	readonly nodeIds?: readonly string[];
	readonly assetIds?: readonly string[];
}): readonly ImportIssueAffectedTarget[] =>
	sortedUniqueTargets([
		...artboardIds.map(
			(id) => ({ kind: "artboard", id }) satisfies ImportIssueAffectedTarget,
		),
		...nodeIds.map(
			(id) => ({ kind: "node", id }) satisfies ImportIssueAffectedTarget,
		),
		...assetIds.map(
			(id) => ({ kind: "asset", id }) satisfies ImportIssueAffectedTarget,
		),
	]);

const codeCounts = (
	issues: readonly ImportIssue[],
): ImportIssueSummary["byCode"] => {
	const counts = new Map<string, number>();
	for (const issue of issues) {
		counts.set(issue.code, (counts.get(issue.code) ?? 0) + 1);
	}
	return [...counts.entries()]
		.sort(([leftCode], [rightCode]) => leftCode.localeCompare(rightCode))
		.map(([code, count]) => ({ code, count }));
};

const worstImportIssueSeverity = (
	issues: readonly ImportIssue[],
): ImportIssueSeverity => {
	if (issues.some((issue) => issue.severity === "error")) return "error";
	if (issues.some((issue) => issue.severity === "warning")) return "warning";
	return "info";
};

const isFallbackIssue = (issue: ImportIssue): boolean => {
	const text = `${issue.code} ${issue.message}`.toLowerCase();
	return Boolean(issue.fallbackType) || text.includes("fallback");
};

const importIssueCategory = (issue: ImportIssue): ImportIssueCategory => {
	if (isUnsupportedIssue(issue)) return "unsupported";
	if (isFallbackIssue(issue)) return "fallback";
	if (isApproximatedIssue(issue)) return "approximated";
	if (isArtboardFidelityIssue(issue)) return "artboard";
	return "other";
};

const fallbackTypesForIssue = (issue: ImportIssue): readonly string[] => {
	if (issue.fallbackType) return [issue.fallbackType];

	const text = `${issue.code} ${issue.message}`.toLowerCase();
	const fallbackTypes: string[] = [];
	if (
		text.includes("component") ||
		text.includes("symbol") ||
		text.includes("use element") ||
		text.includes("use instance")
	) {
		fallbackTypes.push("component-reference");
	}
	if (
		text.includes("image") ||
		text.includes("xobject") ||
		text.includes("pattern") ||
		text.includes("asset")
	) {
		fallbackTypes.push("image-asset");
	}
	if (text.includes("page_box") || text.includes("fallback import artboard")) {
		fallbackTypes.push("fallback-artboard");
	}
	if (text.includes("font") && text.includes("fallback")) {
		fallbackTypes.push("font-substitution");
	}
	if (
		text.includes("text-spans") ||
		text.includes("rich text") ||
		text.includes("spans were flattened") ||
		text.includes("spacing adjustments")
	) {
		fallbackTypes.push("rich-text-flattened");
	}
	if (
		text.includes("gradient") ||
		text.includes("paint") ||
		text.includes("solid")
	) {
		fallbackTypes.push("default-color");
	}
	if (
		text.includes("clip") ||
		text.includes("filter") ||
		text.includes("effect")
	) {
		fallbackTypes.push("unclipped-vector");
	}
	if (text.includes("marker")) {
		fallbackTypes.push("stroke-detail");
	}
	if (text.includes("alpha-source") || text.includes("extgstate")) {
		fallbackTypes.push("appearance-fallback");
	}
	if (
		text.includes("compound") ||
		text.includes("split") ||
		text.includes("normalized")
	) {
		fallbackTypes.push("normalized-value");
	}
	if (issue.code === "import.unsupported-file-type") {
		fallbackTypes.push("unsupported-file");
	}
	return sortedUnique(fallbackTypes);
};

const countByImportCategory = (
	issues: readonly ImportIssue[],
): Readonly<Record<ImportIssueCategory, number>> => {
	const counts = Object.fromEntries(
		issueCategories.map((category) => [category, 0]),
	) as Record<ImportIssueCategory, number>;
	for (const issue of issues) counts[importIssueCategory(issue)] += 1;
	return counts;
};

const groupImportIssues = (
	issues: readonly ImportIssue[],
): readonly ImportIssueGroup[] => {
	const groups = new Map<ImportIssueCategory, ImportIssue[]>();
	for (const issue of issues) {
		const category = importIssueCategory(issue);
		groups.set(category, [...(groups.get(category) ?? []), issue]);
	}

	return [...groups.entries()]
		.map(([category, groupIssues]) => ({
			category,
			severity: worstImportIssueSeverity(groupIssues),
			count: groupIssues.length,
			reviewLabel: importReviewCopy[category].reviewLabel,
			suggestedAction: importReviewCopy[category].suggestedAction,
			codes: sortedUnique(groupIssues.map((issue) => issue.code)),
			fallbackTypes: sortedUnique(groupIssues.flatMap(fallbackTypesForIssue)),
			affectedTargets: sortedUniqueTargets(
				groupIssues.flatMap(targetsForIssue),
			),
			affectedNodeIds: sortedUnique(
				groupIssues.flatMap((issue) => targetIdsForIssue(issue, "node")),
			),
			affectedArtboardIds: sortedUnique(
				groupIssues.flatMap((issue) => targetIdsForIssue(issue, "artboard")),
			),
			affectedAssetIds: sortedUnique(
				groupIssues.flatMap((issue) => targetIdsForIssue(issue, "asset")),
			),
			refs: sortedUnique(groupIssues.map((issue) => issue.ref)),
			paths: sortedUnique(groupIssues.map((issue) => issue.path)),
			sources: sortedUnique(groupIssues.map((issue) => issue.source)),
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
};

/**
 * Groups import diagnostics into the compact report contract used by import UI
 * surfaces. The helper keeps parser semantics unchanged: it only summarizes
 * existing issue metadata plus known imported node/artboard ids supplied by the
 * caller.
 */
export function summarizeImportIssues(
	issues: readonly ImportIssue[],
	options: {
		readonly affectedNodeIds?: readonly string[];
		readonly affectedArtboardIds?: readonly string[];
		readonly affectedAssetIds?: readonly string[];
	} = {},
): ImportIssueSummary {
	const groups = groupImportIssues(issues);
	const affectedTargets = sortedUniqueTargets([
		...targetsFromIds({
			nodeIds: options.affectedNodeIds,
			artboardIds: options.affectedArtboardIds,
			assetIds: options.affectedAssetIds,
		}),
		...issues.flatMap(targetsForIssue),
	]);
	return {
		total: issues.length,
		bySeverity: issueCounts(issues),
		byCategory: countByImportCategory(issues),
		byCode: codeCounts(issues),
		fallbackTypes: sortedUnique(groups.flatMap((group) => group.fallbackTypes)),
		affectedTargets,
		affectedNodeIds: sortedUnique([
			...(options.affectedNodeIds ?? []),
			...issues.flatMap((issue) => targetIdsForIssue(issue, "node")),
		]),
		affectedArtboardIds: sortedUnique([
			...(options.affectedArtboardIds ?? []),
			...issues.flatMap((issue) => targetIdsForIssue(issue, "artboard")),
		]),
		affectedAssetIds: sortedUnique([
			...(options.affectedAssetIds ?? []),
			...issues.flatMap((issue) => targetIdsForIssue(issue, "asset")),
		]),
		refs: sortedUnique(issues.map((issue) => issue.ref)),
		paths: sortedUnique(issues.map((issue) => issue.path)),
		sources: sortedUnique(issues.map((issue) => issue.source)),
		groups,
	};
}

const issueCounts = (
	issues: readonly ImportIssue[],
): Readonly<Record<ImportIssueSeverity, number>> => ({
	info: issues.filter((issue) => issue.severity === "info").length,
	warning: issues.filter((issue) => issue.severity === "warning").length,
	error: issues.filter((issue) => issue.severity === "error").length,
});

/**
 * Builds a stable, format-neutral fidelity summary from import parser output.
 * Import adapters can keep specialized reports, but this helper gives fixtures
 * and UI/reporting code one count contract for imported, approximated, and
 * unsupported source content without changing scene schema.
 */
export function summarizeImportedScenePayload(
	payload: ImportedScenePayload,
): ImportFidelityReport {
	const importedCount = countLayerNodes(payload.layers);
	const approximatedCount = payload.issues.filter(isApproximatedIssue).length;
	const unsupportedCount = payload.issues.filter(isUnsupportedIssue).length;
	const artboardCount = payload.artboards?.length ?? 0;
	const artboardIssues = payload.issues.filter(isArtboardFidelityIssue);
	return {
		accepted: importedCount > 0,
		...(payload.sourceName ? { sourceName: payload.sourceName } : {}),
		...(payload.sourceFormat ? { sourceFormat: payload.sourceFormat } : {}),
		importedCount,
		approximatedCount,
		unsupportedCount,
		artboardCount,
		artboardSummary: {
			imported: artboardCount,
			approximated: artboardIssues.filter(isApproximatedIssue).length,
			unsupported: artboardIssues.filter(isUnsupportedIssue).length,
		},
		summary: {
			imported: importedCount,
			approximated: approximatedCount,
			unsupported: unsupportedCount,
		},
		issueCounts: issueCounts(payload.issues),
		issueCodes: payload.issues.map((issue) => issue.code),
	};
}

const fidelityTopicOrder: readonly ImportFidelityTopic[] = [
	"component",
	"gradient",
	"clipping",
	"compound-path",
	"opacity",
	"text",
	"stroke-detail",
	"color",
	"transform",
	"blend-mode",
	"mask",
	"image",
	"artboard",
	"structure",
	"other",
];

const fidelityTopicRank: Readonly<Record<ImportFidelityTopic, number>> =
	Object.fromEntries(
		fidelityTopicOrder.map((topic, index) => [
			topic,
			fidelityTopicOrder.length - index,
		]),
	) as Record<ImportFidelityTopic, number>;

const outcomeRank: Readonly<Record<ImportFidelityOutcome, number>> = {
	unsupported: 2,
	approximated: 1,
	imported: 0,
};

/**
 * Maps a raw parser issue to the user-facing fidelity topic. Keyed on stable
 * code substrings so both `svg.*` and `ai.pdf_*` diagnostics that describe the
 * same loss collapse into one explainable row. Order is intentional: more
 * specific topics (gradient, clipping) are checked before generic ones.
 */
const fidelityTopicForIssue = (issue: ImportIssue): ImportFidelityTopic => {
	const code = issue.code;
	if (
		code.includes("component") ||
		code.includes("symbol") ||
		code.includes("unsupported-use")
	) {
		return "component";
	}
	if (code.includes("gradient") || code.includes("shading")) return "gradient";
	if (code.includes("clip")) return "clipping";
	if (code.includes("compound")) return "compound-path";
	if (code.includes("opacity")) return "opacity";
	if (code.includes("text") || code.includes("font")) return "text";
	if (code.includes("stroke") || code.includes("dash") || code.includes("cap"))
		return "stroke-detail";
	if (code.includes("marker")) return "stroke-detail";
	if (
		code.includes("color") ||
		code.includes("cmyk") ||
		code.includes("paint-server") ||
		code.includes("fill-rule") ||
		code.includes("fill_rule")
	) {
		return "color";
	}
	if (code.includes("transform")) return "transform";
	if (code.includes("blend")) return "blend-mode";
	if (code.includes("extgstate")) return "opacity";
	if (
		code.includes("mask") ||
		code.includes("transparency") ||
		code.includes("filter") ||
		code.includes("effect")
	) {
		return "mask";
	}
	if (
		code.includes("image") ||
		code.includes("xobject") ||
		code.includes("pattern") ||
		code.includes("asset")
	) {
		return "image";
	}
	if (isArtboardFidelityIssue(issue) || code.includes("viewbox")) {
		return "artboard";
	}
	if (
		code.includes("unclosed") ||
		code.includes("mismatched") ||
		code.includes("multiple-roots") ||
		code.includes("missing-root") ||
		code.includes("content_stream") ||
		code.includes("payload") ||
		code.includes("invalid") ||
		code.includes("operator") ||
		code.includes("private_data") ||
		code.includes("degenerate") ||
		code.includes("empty")
	) {
		return "structure";
	}
	return "other";
};

const fidelityOutcomeForIssue = (issue: ImportIssue): ImportFidelityOutcome => {
	if (isUnsupportedIssue(issue)) return "unsupported";
	if (isApproximatedIssue(issue) || isFallbackIssue(issue)) {
		return "approximated";
	}
	return "imported";
};

const worstOutcome = (
	outcomes: readonly ImportFidelityOutcome[],
): ImportFidelityOutcome =>
	outcomes.reduce<ImportFidelityOutcome>(
		(worst, outcome) =>
			outcomeRank[outcome] > outcomeRank[worst] ? outcome : worst,
		"imported",
	);

type TopicCopy = {
	readonly label: string;
	readonly approximated: string;
	readonly unsupported: string;
	/** Detail shown when the topic was imported losslessly (outcome `imported`). */
	readonly imported?: string;
	readonly recommendation?: string;
};

const topicCopy: Readonly<Record<ImportFidelityTopic, TopicCopy>> = {
	component: {
		label: "Components and symbols",
		approximated:
			"Component or symbol metadata was recognized, but the reusable source/instance relationship is only retained as import diagnostics.",
		unsupported:
			"SVG symbols, use instances, or component-style references are not represented in the scene model yet, so reusable instances were skipped.",
		recommendation:
			"Rebuild reusable components from imported editable shapes after import.",
	},
	gradient: {
		label: "Gradients",
		approximated:
			"Some gradient fills were approximated to a solid color because the gradient had fewer than two color stops.",
		unsupported:
			"A gradient or paint server reference could not be resolved to a usable color and was dropped.",
		imported:
			"Gradient fills and strokes were imported as editable gradient paint with stops, direction, and transforms preserved.",
		recommendation:
			"Check approximated fills against the source and re-apply the original gradient if needed.",
	},
	clipping: {
		label: "Clipping paths",
		approximated:
			"Clipping was approximated; some content may extend past its original clip region.",
		unsupported:
			"Clipping paths are not represented in the scene model, so clipped content is imported unclipped.",
		recommendation: "Mask or trim affected shapes manually after import.",
	},
	"compound-path": {
		label: "Compound paths",
		approximated:
			"A compound path with multiple outer shapes was split into separate editable paths, so a nested hole is no longer cut.",
		unsupported: "A compound path could not be represented and was dropped.",
		imported:
			"Holes (donut, letter counter, window cutout) were imported as a single editable path that preserves the cutout via fill rule.",
		recommendation:
			"Split shapes render correctly on their own; rebuild a cross-shape hole manually if one is missing.",
	},
	opacity: {
		label: "Opacity",
		approximated:
			"Group opacity was pushed down to child nodes; overlapping children may not composite exactly as the source.",
		unsupported: "An opacity value could not be parsed and was ignored.",
		recommendation: "Review overlapping translucent shapes after import.",
	},
	text: {
		label: "Text",
		approximated:
			"Text was imported as editable text with approximated bounds; font metrics, rich spans, or spacing are not preserved.",
		unsupported: "Some text could not be imported and was dropped.",
		recommendation: "Verify text size and line breaks against the source.",
	},
	"stroke-detail": {
		label: "Stroke detail",
		approximated:
			"Dash pattern, line cap, line join, or miter limit were stored on node metadata but render as a solid default stroke.",
		unsupported: "A stroke detail value was invalid and was ignored.",
		recommendation: "Re-create dashed or special-cap strokes if needed.",
	},
	color: {
		label: "Color",
		approximated:
			"Colors outside the scene RGB model (e.g. CMYK) or alternate fill rules were converted to an approximate equivalent.",
		unsupported:
			"A custom color space or paint server could not be converted and was dropped.",
		recommendation: "Check brand colors against the source.",
	},
	transform: {
		label: "Transforms",
		approximated:
			"A skewed or complex transform was approximated as translate, rotate, and scale.",
		unsupported: "A transform value was invalid and was reset to identity.",
		recommendation: "Verify placement of skewed elements.",
	},
	"blend-mode": {
		label: "Blend modes",
		approximated:
			"An unrecognized blend mode was approximated as normal compositing.",
		unsupported:
			"An unrecognized blend mode could not be mapped and was ignored.",
		imported:
			"Blend modes were imported and stored in node styles for faithful compositing.",
		recommendation: "Re-apply blending in a later compositing step.",
	},
	mask: {
		label: "Masks and effects",
		approximated:
			"Masks, soft masks, transparency groups, or filters were approximated; the visual result may differ.",
		unsupported:
			"Masks, soft masks, transparency groups, or filters are not imported, so affected content appears without them.",
		recommendation: "Re-build masking or effects after import if required.",
	},
	image: {
		label: "Image assets",
		approximated:
			"Raster image, XObject, or pattern asset metadata was detected but only approximated by the import subset.",
		unsupported:
			"Raster image assets, XObjects, or patterns are not imported in this subset and were skipped.",
		recommendation: "Place raster assets separately after import.",
	},
	artboard: {
		label: "Artboards and pages",
		approximated:
			"Artboard or page bounds were approximated from available metadata or a fallback box.",
		unsupported:
			"Some artboard, page, or viewport metadata could not be mapped, so affected content stayed on the inherited artboard.",
		recommendation:
			"Adjust artboard bounds after import if placement looks off.",
	},
	structure: {
		label: "Document structure",
		approximated:
			"Part of the source structure was recovered with approximations.",
		unsupported:
			"Part of the source document could not be parsed and was skipped.",
		recommendation:
			"Re-export the source from its authoring app if content is missing.",
	},
	other: {
		label: "Other fidelity notes",
		approximated: "Some source content was approximated during import.",
		unsupported: "Some source content could not be imported.",
	},
};

const headlineFor = (
	topic: ImportFidelityTopic,
	outcome: ImportFidelityOutcome,
): string => {
	const label = topicCopy[topic].label;
	if (outcome === "unsupported") return `${label} not imported`;
	if (outcome === "approximated") return `${label} approximated`;
	return `${label} imported`;
};

const detailFor = (
	topic: ImportFidelityTopic,
	outcome: ImportFidelityOutcome,
): string => {
	const copy = topicCopy[topic];
	if (outcome === "unsupported") return copy.unsupported;
	if (outcome === "imported") return copy.imported ?? copy.approximated;
	return copy.approximated;
};

/**
 * Translates raw import diagnostics into plain-language fidelity explanations
 * the import report can show directly. Each returned row covers one practical
 * topic (gradients, clipping, text, ...) with what happened to the artwork and
 * what the user can do, so fidelity loss is explainable without raw JSON or
 * opaque issue codes. Pure: it only reads existing issue metadata.
 *
 * Per-topic `affectedNodeIds`/`affectedArtboardIds` come from the topic's own
 * issues, never from a global imported-id list, so a row never falsely claims to
 * affect every imported node. `affectedArtboardIds` additionally accepts
 * caller-supplied ids for the `artboard` topic only (e.g. fallback artboards the
 * parser created), which is the one place a global id is genuinely attributable.
 */
export function explainImportFidelity(
	issues: readonly ImportIssue[],
	options: {
		readonly affectedArtboardIds?: readonly string[];
	} = {},
): readonly ImportFidelityExplanation[] {
	const buckets = new Map<ImportFidelityTopic, ImportIssue[]>();
	for (const issue of issues) {
		const topic = fidelityTopicForIssue(issue);
		buckets.set(topic, [...(buckets.get(topic) ?? []), issue]);
	}

	return [...buckets.entries()]
		.map(([topic, topicIssues]) => {
			const outcome = worstOutcome(topicIssues.map(fidelityOutcomeForIssue));
			const severity = worstImportIssueSeverity(topicIssues);
			const recommendation = topicCopy[topic].recommendation;
			return {
				topic,
				outcome,
				severity,
				count: topicIssues.length,
				headline: headlineFor(topic, outcome),
				detail: detailFor(topic, outcome),
				...(recommendation && outcome !== "imported" ? { recommendation } : {}),
				codes: sortedUnique(topicIssues.map((issue) => issue.code)),
				refs: sortedUnique(topicIssues.map((issue) => issue.ref)),
				paths: sortedUnique(topicIssues.map((issue) => issue.path)),
				affectedNodeIds: sortedUnique(
					topicIssues.flatMap((issue) => targetIdsForIssue(issue, "node")),
				),
				affectedArtboardIds: sortedUnique([
					...(topic === "artboard" ? (options.affectedArtboardIds ?? []) : []),
					...topicIssues.flatMap((issue) =>
						targetIdsForIssue(issue, "artboard"),
					),
				]),
			} satisfies ImportFidelityExplanation;
		})
		.sort((left, right) => {
			const severityDelta =
				severityRank[right.severity] - severityRank[left.severity];
			if (severityDelta !== 0) return severityDelta;
			const outcomeDelta =
				outcomeRank[right.outcome] - outcomeRank[left.outcome];
			if (outcomeDelta !== 0) return outcomeDelta;
			const countDelta = right.count - left.count;
			if (countDelta !== 0) return countDelta;
			return fidelityTopicRank[right.topic] - fidelityTopicRank[left.topic];
		});
}
