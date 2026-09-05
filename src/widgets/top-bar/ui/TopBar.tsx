import { Popover } from "@base-ui/react/popover";
import {
	ArrowsOutSimple,
	ClockClockwise,
	ClockCounterClockwise,
	CloudArrowUp,
	CloudCheck,
	Command,
	CopySimple,
	DownloadSimple,
	FileCode,
	FilePdf,
	FilmStrip,
	FloppyDisk,
	FolderOpen,
	Graph,
	Keyboard,
	Minus,
	Plus,
	Selection,
	Sidebar,
	SlidersHorizontal,
	Sparkle,
	Stack,
	Timer,
	UploadSimple,
	UserCircle,
	X,
} from "@phosphor-icons/react";
import type { ChangeEvent, MouseEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	canWriteCloudProject,
	requestCloudWriterTakeover,
	useCloudWriterLeaseStore,
} from "@/entities/editor-session/model/cloud-writer-lease";
import {
	captureEditorBindingFence,
	createEditorOpenUrl,
	isEditorBindingFenceCurrent,
} from "@/entities/editor-session/model/session";
import { useMotionStore } from "@/entities/motion/model/store";
import { useMotionGrammarStore } from "@/entities/motion-grammar/model/store";
import { createRenameDocumentCommand } from "@/entities/scene/model/node-commands";
import { useSceneStore } from "@/entities/scene/model/store";
import { fetchAccountBootstrap } from "@/features/billing/model/api";
import { BillingEntry } from "@/features/billing/ui/BillingEntry";
import { linkedProductionResolverForScene } from "@/features/blender-link/model/workflow";
import {
	type CloudProject,
	type CloudProjectRevisionSummary,
	createCloudProject,
	listCloudProjectRevisions,
	readCloudProjectRevision,
	restoreCloudProjectRevision,
	updateCloudProject,
} from "@/features/cloud-projects/model/api";
import {
	type ActiveCloudProject,
	type EditorCloudSaveFailureReason,
	type EditorCloudSaveStatus,
	useEditorCloudProjectStore,
} from "@/features/cloud-projects/model/editor-cloud-project-store";
import { cloudProjectFingerprint } from "@/features/cloud-projects/model/project-fingerprint";
import {
	downloadAsset,
	downloadAssets,
} from "@/features/export/adapters/download";
import { recordAndDownloadWebmVideoExport } from "@/features/export/adapters/video";
import { resolveExportArtboardScope } from "@/features/export/model/artboards";
import {
	createProjectAuthoringOutputReport,
	type ProjectAuthoringOutputReport,
} from "@/features/export/model/authoring-output-report";
import { createExportBundle } from "@/features/export/model/bundle";
import { createMotionCodeExportAssets } from "@/features/export/model/code";
import { exportLookAsDctl } from "@/features/export/model/look-dctl";
import {
	type ExportOptimizationProfile,
	exportOptimizationOptionsForProfile,
	exportOptimizationProfileDescription,
	exportOptimizationProfileLabel,
} from "@/features/export/model/optimization";
import { sceneNeedsGpuSurface } from "@/features/export/model/raster-passes";
import { createIndividualVectorSvgExports } from "@/features/export/model/vector-assets";
import { sceneHasVideoMedia } from "@/features/export/model/video-frame-materialize";
import {
	globalRedo,
	globalUndo,
} from "@/features/history/model/undo-coordinator";
import { analyzeAiImport } from "@/features/import/model/ai-import";
import { readImportFile } from "@/features/import/model/client-read-file";
import {
	isRasterImagePlacementFile,
	isUnsupportedRasterImageFile,
} from "@/features/import/model/image-placement";
import { parseSvgToImportedScenePayload } from "@/features/import/model/svg-import";
import {
	explainImportFidelity,
	type ImportFidelityExplanation,
} from "@/features/import/model/types";
import { useTransportStore } from "@/features/motion/model/transport-store";
import {
	programSurfacePackageAccept,
	programSurfacePackageMimeType,
	readManualProgramSurfacePackage,
} from "@/features/program-surface/model/package-intake";
import {
	isPortableProjectFile,
	type ProjectRestoreResult,
	projectBackupFileName,
	projectBackupMimeType,
	restorePortableProject,
	serializeProjectBackup,
} from "@/features/project-backup/model/project-backup";
import { useSelectionStore } from "@/features/selection/model/store";
import { useViewportStore } from "@/features/viewport/model/store";
import { useEditorChromeStore } from "@/shared/editor-chrome/model/store";
import { downloadTextFile, readFileAsText } from "@/shared/lib/download";
import { platformCapabilities } from "@/shared/platform/mode";
import { IconButton } from "@/shared/ui/IconButton";
import { Tooltip, TooltipProvider } from "@/shared/ui/Tooltip";
import { McpBridgeChip } from "@/widgets/agent-bridge/ui/McpBridgeChip";
import {
	createTopBarExportArtboardScope,
	selectedArtboardIdsForNodes,
	TOP_BAR_ARTBOARD_SCOPE_MODES,
	type TopBarArtboardScopeMode,
} from "../model/artboard-scope";
import {
	compactExportReportSourcePath,
	componentPropsIssuesForExport,
	createStandaloneExportReport,
	type ExportReportFidelityCategory,
	type ExportReportIssue,
	type ExportReportModel,
	interactionsIssuesForExport,
	interactionsRuntimeUnsupportedIssuesForExport,
	lookDctlIssuesForReport,
} from "../model/export-report";
import {
	createMotionCodeOptimizationSummary,
	currentExportSnapshot,
	currentFrameRangeReport,
	dedupeDownloadAssets,
	downloadMotionCodeAssets,
	type ExportSnapshot,
	fullMotionFrameRangeReport,
	type MotionCodeReportAsset,
	motionCodeGrammarFidelityIssuesForExport,
	motionCodeReportAssetRole,
	motionCodeReportIssueCodes,
	motionCodeReportIssueCount,
	motionCodeRuntimePayloadIssues,
	standaloneScopeReport,
	textAssetByteLength,
	textAssetsByteLength,
} from "../model/export-workflow";
import {
	type CloudAccountAccess,
	type CloudProjectNotice,
	type CompactIssueGroup,
	cloudAccountAccessClass,
	cloudAccountAccessFromBootstrap,
	cloudFlowDetail,
	cloudFlowTitle,
	cloudLocationDetail,
	cloudLocationLabel,
	cloudPrimaryActionDetailForAccess,
	cloudPrimaryActionLabelForAccess,
	cloudPrimaryIconClass,
	cloudPrimaryItemClass,
	cloudProjectUpgradeDetail,
	cloudSaveStateDetail,
	cloudSaveStateLabel,
	cloudStatusClass,
	cloudStatusLabel,
	cloudTriggerActionLabel,
	cloudTriggerToneClass,
	compactList,
	compactTargets,
	formatBytes,
	formatTimestamp,
	issueCategoryClass,
	issueCategoryLabel,
	issueSeverityClass,
	type ReportTargetLike,
	reportToneClass,
	scopeButtonIcon,
	scopeButtonTitle,
	type VersionHistoryState,
} from "../model/format-labels";
import {
	appendImportedPayload,
	placeImageFile,
	placeManualProgramSurfacePackage,
	placeVideoFile,
} from "../model/import-io";
import {
	createTopBarAiImportReport,
	createTopBarBackupRestoreReport,
	createTopBarBackupSavedReport,
	createTopBarImportErrorReport,
	createTopBarImportReportFromPayload,
	createTopBarProgramSurfacePackageRejectedReport,
	createTopBarProgramSurfacePackageStaleReport,
	createTopBarUnsupportedImageReport,
	createTopBarUnsupportedImportReport,
	createTopBarUnsupportedVideoReport,
	type TopBarImportReportModel,
} from "../model/import-report";
import {
	isTopBarVideoPlacementFile,
	isUnsupportedTopBarVideoFile,
} from "../model/video-placement";

const reportCardClass =
	"pointer-events-auto absolute top-8 right-0 z-40 w-[min(90vw,318px)] rounded-md border bg-surface-raised/96 p-2 shadow-2xl shadow-black/40 backdrop-blur-xl";

const reportCloseButtonClass =
	"grid size-5 shrink-0 place-items-center rounded border border-white/10 bg-white/5 text-fg-secondary hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-white/55";

const reportMetricClass =
	"rounded border border-white/8 bg-white/[0.035] px-1.5 py-0.5";

const reportIssueRowClass =
	"grid grid-cols-[auto_minmax(0,1fr)] items-start gap-1.5 rounded border border-white/8 bg-black/20 px-1.5 py-1 text-fg-secondary";

const reportDetailPillClass =
	"min-w-0 truncate rounded border border-white/8 bg-white/[0.035] px-1.5 py-0.5 text-fg-muted text-ui leading-3";

const topBarActionButtonClass =
	"inline-flex h-8 w-8 min-w-8 shrink-0 items-center justify-center gap-1 rounded-md border px-0 font-medium text-ui leading-none shadow-2xl shadow-black/35 backdrop-blur-xl focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 2xl:w-auto 2xl:px-2";

const topBarNewProjectButtonClass =
	"pointer-events-auto inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-1 rounded-md border border-accent/35 bg-accent-surface/92 px-0 font-medium text-accent-fg text-ui leading-none shadow-2xl shadow-black/35 backdrop-blur-xl transition hover:bg-accent-surface hover:text-accent-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent md:w-auto md:px-2.5";

const exportMenuPanelClass =
	"z-50 w-[min(88vw,270px)] rounded-md border border-hairline/12 bg-surface-raised/96 p-1.5 text-ui shadow-2xl shadow-scrim/45 outline-none backdrop-blur-xl";

const cloudMenuPanelClass =
	"z-50 w-[min(90vw,316px)] rounded-md border border-hairline/12 bg-surface-raised/96 p-1.5 text-ui shadow-2xl shadow-scrim/45 outline-none backdrop-blur-xl";

const exportMenuItemClass =
	"grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-ui leading-3 hover:bg-white/8 focus-visible:outline focus-visible:outline-1 focus-visible:outline-white/55 disabled:cursor-not-allowed disabled:opacity-45";

const cloudSectionLabelClass =
	"px-1.5 pt-1 pb-0.5 font-medium text-fg-muted text-ui leading-3";

const historyDrawerActionButtonClass =
	"inline-flex h-6 shrink-0 items-center gap-1 rounded border border-hairline/12 bg-surface-raised px-1.5 font-medium text-fg-secondary text-ui leading-none hover:bg-white/8 hover:text-fg focus-visible:outline focus-visible:outline-1 focus-visible:outline-white/55 disabled:cursor-not-allowed disabled:opacity-45";

const historyDrawerPrimaryButtonClass =
	"inline-flex h-6 shrink-0 items-center gap-1 rounded border border-accent/35 bg-accent-surface px-1.5 font-medium text-accent-fg text-ui leading-none hover:bg-accent-surface/80 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent/60 disabled:cursor-not-allowed disabled:opacity-45";

const cloudRecoveryItemClass =
	"grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-ui leading-3 hover:bg-white/8 focus-visible:outline focus-visible:outline-1 focus-visible:outline-white/55 disabled:cursor-not-allowed disabled:opacity-45";

const cloudNewProjectItemClass =
	"grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-md border border-accent/30 bg-accent-surface/30 px-1.5 py-1.5 text-left text-ui leading-3 hover:bg-accent-surface/45 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent/60";

function ExportFidelityOutcomes({
	outcomes,
}: {
	readonly outcomes: readonly {
		readonly category: ExportReportFidelityCategory;
		readonly label: string;
		readonly count: number;
		readonly title: string;
	}[];
}) {
	return (
		<div className="mt-1 grid grid-cols-4 gap-1 text-center">
			{outcomes.map((outcome) => (
				<div
					key={outcome.category}
					className={`${reportMetricClass} ${issueCategoryClass(outcome.category)}`}
					title={outcome.title}
				>
					<div className="font-mono text-ui leading-4">{outcome.count}</div>
					<div className="text-ui leading-3">{outcome.label}</div>
				</div>
			))}
		</div>
	);
}

function IssueGroupDetailChips({
	fallbackTypes,
	affectedTargets,
}: {
	readonly fallbackTypes: readonly string[];
	readonly affectedTargets: readonly ReportTargetLike[];
}) {
	const targetSummary = compactTargets(affectedTargets);
	if (fallbackTypes.length === 0 && !targetSummary) return null;
	return (
		<div className="mt-0.5 flex min-w-0 flex-wrap gap-1">
			{fallbackTypes.length > 0 ? (
				<span
					className={reportDetailPillClass}
					title={`fallback: ${fallbackTypes.join(", ")}`}
				>
					fallback: {compactList(fallbackTypes)}
				</span>
			) : null}
			{targetSummary ? (
				<span className={reportDetailPillClass} title={targetSummary.title}>
					{targetSummary.label}
				</span>
			) : null}
		</div>
	);
}

function ReportIssueGroupRow({ group }: { readonly group: CompactIssueGroup }) {
	const fallbackSummary =
		group.fallbackTypes.length > 0
			? `fallback: ${group.fallbackTypes.join(", ")}`
			: "";
	const targetSummary = compactTargets(group.affectedTargets);
	const title = [
		`${group.severity} / ${group.category}: ${group.detailMessages.join(" ")}`,
		fallbackSummary,
		targetSummary ? `affected: ${targetSummary.title}` : "",
	]
		.filter(Boolean)
		.join("\n");
	return (
		<li key={group.category} className={reportIssueRowClass} title={title}>
			<span
				className={`rounded border px-1 font-mono text-ui uppercase leading-3 ${issueSeverityClass(group.severity)}`}
			>
				{group.severity}
			</span>
			<span className="min-w-0 leading-4">
				<span className="block truncate">
					<span
						className={`rounded border px-1 font-mono text-ui leading-3 ${issueCategoryClass(group.category)}`}
					>
						{issueCategoryLabel(group.category)}
					</span>
					{" / "}
					{group.count} issue{group.count === 1 ? "" : "s"} /{" "}
					{compactList(group.codes)}
				</span>
				<IssueGroupDetailChips
					fallbackTypes={group.fallbackTypes}
					affectedTargets={group.affectedTargets}
				/>
			</span>
		</li>
	);
}

/**
 * Renders one plain-language fidelity explanation from `explainImportFidelity`.
 * Shows the headline, what happened to the artwork, an optional next step, and
 * source locators (refs/paths) so the user can find affected artwork without
 * reading raw issue codes or JSON.
 */
function ImportFidelityRow({
	explanation,
}: {
	readonly explanation: ImportFidelityExplanation;
}) {
	const locators = [...explanation.refs, ...explanation.paths];
	return (
		<li
			className="rounded border border-white/8 bg-black/20 px-1.5 py-1 text-fg-secondary"
			title={explanation.detail}
		>
			<div className="flex items-center gap-1.5">
				<span
					className={`shrink-0 rounded border px-1 font-mono text-ui uppercase leading-3 ${issueSeverityClass(explanation.severity)}`}
				>
					{explanation.outcome}
				</span>
				<span className="min-w-0 flex-1 truncate font-medium leading-4">
					{explanation.headline}
				</span>
				{explanation.count > 1 ? (
					<span className="shrink-0 font-mono text-fg-muted text-ui leading-3">
						×{explanation.count}
					</span>
				) : null}
			</div>
			<p className="mt-0.5 line-clamp-2 text-fg-muted text-ui leading-3">
				{explanation.detail}
			</p>
			{explanation.recommendation ? (
				<p className="mt-0.5 truncate text-accent-fg/80 text-ui leading-3">
					{explanation.recommendation}
				</p>
			) : null}
			{locators.length > 0 ? (
				<p
					className="mt-0.5 truncate font-mono text-fg-subtle text-ui leading-3"
					title={locators.join(", ")}
				>
					{compactList(locators)}
				</p>
			) : null}
		</li>
	);
}

function ImportReportCard({
	report,
	onClose,
}: {
	readonly report: TopBarImportReportModel;
	readonly onClose: () => void;
}) {
	const fidelityExplanations = explainImportFidelity(report.issues, {
		affectedArtboardIds: report.affectedArtboardIds,
	});
	const visibleExplanations = fidelityExplanations.slice(0, 3);
	const visibleGroups = report.issueGroups.slice(0, 3);
	const affectedIds = [
		...report.affectedArtboardIds,
		...report.affectedNodeIds,
	];

	return (
		<section
			aria-label="Import report"
			className={`${reportCardClass} ${reportToneClass(report.status)}`}
		>
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0">
					<div className="flex min-w-0 items-center gap-1.5">
						<p
							className="truncate font-medium text-ui leading-4"
							title={report.title}
						>
							{report.title}
						</p>
						<span
							className={`shrink-0 rounded border px-1 font-mono text-ui uppercase leading-3 ${reportToneClass(report.status)}`}
						>
							{report.status}
						</span>
					</div>
					<p
						className="mt-0.5 truncate text-fg-muted text-ui leading-3"
						title={`${report.sourceName} / ${report.sourceFormat}`}
					>
						{report.sourceName} / {report.sourceFormat}
					</p>
				</div>
				<button
					type="button"
					aria-label="Dismiss import report"
					className={reportCloseButtonClass}
					onClick={onClose}
				>
					<X aria-hidden="true" size={11} />
				</button>
			</div>

			<div className="mt-1.5 grid grid-cols-4 gap-1 text-center">
				<div className={reportMetricClass}>
					<div className="font-mono text-fg text-ui leading-4">
						{report.importedCount}
					</div>
					<div className="text-fg-muted text-ui leading-3">imported</div>
				</div>
				<div className={reportMetricClass}>
					<div className="font-mono text-fg text-ui leading-4">
						{report.fidelity.artboardCount}
					</div>
					<div className="text-fg-muted text-ui leading-3">boards</div>
				</div>
				<div className={reportMetricClass}>
					<div className="font-mono text-fg text-ui leading-4">
						{report.fidelity.approximatedCount}
					</div>
					<div className="text-fg-muted text-ui leading-3">approx</div>
				</div>
				<div className={reportMetricClass}>
					<div className="font-mono text-fg text-ui leading-4">
						{report.fidelity.unsupportedCount}
					</div>
					<div className="text-fg-muted text-ui leading-3">unsup</div>
				</div>
			</div>

			{report.note ? (
				<p
					className="mt-1.5 truncate text-fg-secondary text-ui leading-4"
					title={report.note}
				>
					{report.note}
				</p>
			) : null}

			{report.fallbackTypes.length > 0 || affectedIds.length > 0 ? (
				<div className="mt-1.5 grid grid-cols-2 gap-1">
					{report.fallbackTypes.length > 0 ? (
						<div
							className={reportDetailPillClass}
							title={`fallback: ${report.fallbackTypes.join(", ")}`}
						>
							fallback: {compactList(report.fallbackTypes)}
						</div>
					) : null}
					{affectedIds.length > 0 ? (
						<div
							className={reportDetailPillClass}
							title={`affected: ${affectedIds.join(", ")}`}
						>
							ids: {compactList(affectedIds)}
						</div>
					) : null}
				</div>
			) : null}

			{visibleGroups.length > 0 ? (
				<ul className="mt-1.5 max-h-24 space-y-1 overflow-auto pr-1 text-ui">
					{visibleGroups.map((group) => (
						<ReportIssueGroupRow key={group.category} group={group} />
					))}
					{report.issueGroups.length > visibleGroups.length ? (
						<li className="px-1.5 text-fg-muted text-ui leading-4">
							+{report.issueGroups.length - visibleGroups.length} more group
						</li>
					) : null}
				</ul>
			) : null}

			{visibleExplanations.length > 0 ? (
				<ul className="mt-1.5 max-h-32 space-y-1 overflow-auto pr-1 text-ui">
					{visibleExplanations.map((explanation) => (
						<ImportFidelityRow
							key={explanation.topic}
							explanation={explanation}
						/>
					))}
					{fidelityExplanations.length > visibleExplanations.length ? (
						<li className="px-1.5 text-fg-muted text-ui leading-4">
							+{fidelityExplanations.length - visibleExplanations.length} more
							fidelity note
						</li>
					) : null}
				</ul>
			) : null}
		</section>
	);
}

function ExportReportCard({
	report,
	onClose,
}: {
	readonly report: ExportReportModel;
	readonly onClose: () => void;
}) {
	const authoringOutput = report.authoringOutput;
	const visibleAssets = report.assets.slice(0, 5);
	const visibleGroups = report.issueGroups.slice(0, 3);
	const artboardScope = report.artboardScope;
	const artboardNames = artboardScope.exportedArtboardNames.join(", ");
	const affectedTargetSummary = compactTargets(report.affectedTargets, 3);
	const compactSourcePaths = report.affectedSourcePaths.map((path) =>
		compactExportReportSourcePath(path),
	);
	const totalBytes = report.assets.reduce(
		(total, asset) => total + (asset.byteLength ?? 0),
		0,
	);
	const hasByteLengths = report.assets.some(
		(asset) => asset.byteLength !== undefined,
	);
	const optimization = report.optimization;
	const optimizationSavedPercent = optimization
		? `${Math.round(optimization.savedRatio * 100)}%`
		: "";

	return (
		<section
			aria-label="Export report"
			className={`${reportCardClass} ${reportToneClass(report.status)}`}
		>
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0">
					<div className="flex min-w-0 items-center gap-1.5">
						<p
							className="truncate font-medium text-ui leading-4"
							title={report.title}
						>
							{report.title}
						</p>
						<span
							className={`shrink-0 rounded border px-1 font-mono text-ui uppercase leading-3 ${reportToneClass(report.status)}`}
						>
							{report.status}
						</span>
					</div>
					<p
						className="mt-0.5 truncate text-fg-muted text-ui leading-3"
						title={`frame ${report.frame} / ${artboardScope.mode} / ${artboardNames}`}
					>
						frame {report.frame} / {artboardScope.mode} /{" "}
						{artboardScope.exportedCount} {report.targetLabel}
					</p>
				</div>
				<button
					type="button"
					aria-label="Dismiss export report"
					className={reportCloseButtonClass}
					onClick={onClose}
				>
					<X aria-hidden="true" size={11} />
				</button>
			</div>

			<div className="mt-1.5 grid grid-cols-4 gap-1 text-center">
				<div className={reportMetricClass}>
					<div
						className="truncate font-mono text-fg text-ui uppercase leading-4"
						title={artboardScope.mode}
					>
						{artboardScope.mode}
					</div>
					<div className="text-fg-muted text-ui leading-3">scope</div>
				</div>
				<div className={reportMetricClass}>
					<div className="font-mono text-fg text-ui leading-4">
						{artboardScope.exportedCount}/{artboardScope.availableCount}
					</div>
					<div className="text-fg-muted text-ui leading-3">
						{report.targetLabel}
					</div>
				</div>
				<div className={reportMetricClass}>
					<div className="font-mono text-fg text-ui leading-4">
						{report.assetCount}
					</div>
					<div className="text-fg-muted text-ui leading-3">assets</div>
				</div>
				<div className={reportMetricClass}>
					<div className="font-mono text-fg text-ui leading-4">
						{hasByteLengths ? formatBytes(totalBytes) : report.issueCount}
					</div>
					<div className="text-fg-muted text-ui leading-3">
						{hasByteLengths ? "size" : "issues"}
					</div>
				</div>
			</div>

			{optimization ? (
				<div
					className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5 rounded border border-accent/20 bg-accent-surface/40 px-1.5 py-1 text-ui leading-3"
					title={`${formatBytes(optimization.beforeBytes)} baseline -> ${formatBytes(optimization.afterBytes)} ${optimization.profile}/${optimization.runtimePackaging}`}
				>
					<span className="font-mono text-accent-fg uppercase">
						{optimization.profile}
					</span>
					<span className="truncate text-fg-secondary">
						{optimization.runtimePackaging} /{" "}
						{formatBytes(optimization.beforeBytes)}
						{" -> "}
						{formatBytes(optimization.afterBytes)}
					</span>
					<span className="font-mono text-accent-fg">
						-{formatBytes(optimization.savedBytes)} {optimizationSavedPercent}
					</span>
				</div>
			) : null}

			<ExportFidelityOutcomes outcomes={report.fidelity.outcomes} />

			{authoringOutput ? (
				<details className="mt-1.5 rounded border border-white/8 bg-black/20 px-1.5 py-1 text-ui">
					<summary className="cursor-pointer text-fg-secondary leading-4">
						Authoring output contract:{" "}
						{authoringOutput.outputRelevantCapabilityCount}
						{" rendered / "}
						{authoringOutput.nonOutputCapabilityCount} non-output
					</summary>
					<p className="mt-1 text-fg-muted leading-4">
						Conservative capability declarations; generated-asset issues above
						remain the exact result for this export.
					</p>
					<ul className="mt-1 max-h-28 space-y-1 overflow-auto pr-1">
						{authoringOutput.entries.map((entry) => (
							<li
								key={entry.capabilityId}
								className="rounded border border-white/8 bg-black/20 px-1.5 py-1"
								title={entry.capabilityId}
							>
								<div className="truncate text-fg-secondary leading-4">
									{entry.label}
								</div>
								<div className="mt-0.5 flex flex-wrap gap-1 font-mono text-fg-muted leading-3">
									{entry.declarations.map((declaration) => (
										<span
											key={declaration.outputId}
											className={reportDetailPillClass}
											title={`${declaration.outputId}: ${declaration.fidelity}`}
										>
											{declaration.outputId}: {declaration.fidelity}
										</span>
									))}
								</div>
							</li>
						))}
					</ul>
				</details>
			) : null}

			<ul className="mt-1.5 max-h-20 space-y-1 overflow-auto pr-1 text-ui">
				{visibleAssets.map((asset) => (
					<li
						key={`${asset.kind}:${asset.fileName}`}
						className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5 rounded border border-white/8 bg-black/20 px-1.5 py-1"
						title={`${asset.fileName} / ${asset.kind}${
							asset.issueCount > 0 ? ` / ${asset.issueCount} issues` : ""
						}`}
					>
						<span className="truncate text-fg-secondary leading-4">
							{asset.fileName}
						</span>
						<span className="font-mono text-fg-muted text-ui leading-3">
							{asset.byteLength !== undefined
								? formatBytes(asset.byteLength)
								: asset.role}
							{asset.issueCount > 0 ? ` / ${asset.issueCount}` : ""}
						</span>
					</li>
				))}
			</ul>

			{report.fallbackTypes.length > 0 ||
			affectedTargetSummary ||
			report.affectedSourcePaths.length > 0 ||
			report.assetRoles.length > 0 ? (
				<div className="mt-1.5 grid grid-cols-2 gap-1">
					{report.fallbackTypes.length > 0 ? (
						<div
							className={reportDetailPillClass}
							title={`fallback: ${report.fallbackTypes.join(", ")}`}
						>
							fallback: {compactList(report.fallbackTypes)}
						</div>
					) : null}
					{affectedTargetSummary ? (
						<div
							className={reportDetailPillClass}
							title={affectedTargetSummary.title}
						>
							{affectedTargetSummary.label}
						</div>
					) : null}
					{report.affectedSourcePaths.length > 0 ? (
						<div
							className={reportDetailPillClass}
							title={`sources: ${report.affectedSourcePaths.join(", ")}`}
						>
							sources: {compactList(compactSourcePaths)}
						</div>
					) : null}
					{report.assetRoles.length > 0 ? (
						<div
							className={reportDetailPillClass}
							title={`roles: ${report.assetRoles.join(", ")}`}
						>
							roles: {compactList(report.assetRoles)}
						</div>
					) : null}
				</div>
			) : null}

			{visibleGroups.length > 0 ? (
				<ul className="mt-1.5 max-h-24 space-y-1 overflow-auto pr-1 text-ui">
					{visibleGroups.map((group) => (
						<ReportIssueGroupRow key={group.category} group={group} />
					))}
					{report.issueGroups.length > visibleGroups.length ? (
						<li className="px-1.5 text-fg-muted text-ui leading-4">
							+{report.issueGroups.length - visibleGroups.length} more group
						</li>
					) : null}
				</ul>
			) : null}
		</section>
	);
}

function VersionHistoryDrawer({
	busyKey,
	notice,
	onClose,
	onDownload,
	onOpenRevision,
	onRefresh,
	onRestoreCancel,
	onRestoreConfirm,
	onRestoreRequest,
	pendingRestore,
	project,
	saveStatus,
	state,
}: {
	readonly busyKey: string | null;
	readonly notice: CloudProjectNotice | null;
	readonly onClose: () => void;
	readonly onDownload: (revision: CloudProjectRevisionSummary) => void;
	readonly onOpenRevision: (revision: CloudProjectRevisionSummary) => void;
	readonly onRefresh: () => void;
	readonly onRestoreCancel: () => void;
	readonly onRestoreConfirm: (revision: CloudProjectRevisionSummary) => void;
	readonly onRestoreRequest: (revision: CloudProjectRevisionSummary) => void;
	readonly pendingRestore: CloudProjectRevisionSummary | null;
	readonly project: ActiveCloudProject | null;
	readonly saveStatus: EditorCloudSaveStatus;
	readonly state: VersionHistoryState;
}) {
	const historyActionBlocked =
		saveStatus === "dirty" ||
		saveStatus === "saving" ||
		saveStatus === "failed" ||
		saveStatus === "conflict";
	const currentRevision = project?.revision ?? null;

	return (
		<aside className="pointer-events-auto fixed top-10 right-3 bottom-3 z-40 flex w-[min(92vw,360px)] flex-col overflow-hidden rounded-md border border-hairline/12 bg-surface-raised/96 text-fg text-ui shadow-2xl shadow-scrim/45 outline-none backdrop-blur-xl [color-scheme:dark]">
			<header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 border-hairline/10 border-b px-2 py-2">
				<div className="min-w-0">
					<div className="flex min-w-0 items-center gap-1.5">
						<ClockCounterClockwise
							aria-hidden="true"
							size={13}
							className="shrink-0 text-accent-fg"
						/>
						<div className="truncate font-medium text-fg leading-4">
							Version history
						</div>
					</div>
					<div
						className="truncate text-fg-muted leading-3"
						title={project?.name ?? "No cloud project"}
					>
						{project
							? `${project.name} · current r${project.revision}`
							: "Save to cloud to start revision history"}
					</div>
				</div>
				<button
					type="button"
					className={reportCloseButtonClass}
					aria-label="Close version history"
					onClick={onClose}
				>
					<X aria-hidden="true" size={12} />
				</button>
			</header>

			{historyActionBlocked ? (
				<div className="mx-2 mt-2 rounded border border-warn/35 bg-warn-surface/30 px-2 py-1.5 text-warn-fg leading-3">
					Save or resolve the current cloud state before opening or restoring a
					revision. Downloads stay available.
				</div>
			) : null}

			{notice ? (
				<div
					className={`mx-2 mt-2 rounded border bg-surface-sunken/60 px-2 py-1.5 leading-3 ${reportToneClass(notice.status)}`}
				>
					<div className="font-medium">{notice.title}</div>
					{notice.detail ? (
						<div className="mt-0.5 text-fg-secondary">{notice.detail}</div>
					) : null}
				</div>
			) : null}

			<div className="flex items-center justify-between gap-2 border-hairline/10 border-b px-2 py-1.5">
				<div className="text-fg-muted leading-3">
					{state.status === "loaded"
						? `${state.revisions.length} revisions`
						: "Cloud revisions"}
				</div>
				<button
					type="button"
					className={reportCloseButtonClass}
					aria-label="Refresh version history"
					disabled={!project || state.status === "loading"}
					onClick={onRefresh}
				>
					<ClockClockwise aria-hidden="true" size={12} />
				</button>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto p-2">
				{!project ? (
					<div className="rounded border border-hairline/10 bg-surface-sunken/55 px-2 py-2 text-fg-muted leading-3">
						This document is local. Save it as a cloud project to keep version
						history.
					</div>
				) : state.status === "idle" || state.status === "loading" ? (
					<div className="rounded border border-hairline/10 bg-surface-sunken/55 px-2 py-2 text-fg-muted leading-3">
						Loading revisions...
					</div>
				) : state.status === "error" ? (
					<div className="rounded border border-danger/35 bg-danger-surface px-2 py-2 text-danger-fg leading-3">
						{state.message}
					</div>
				) : state.status === "loaded" && state.revisions.length === 0 ? (
					<div className="rounded border border-hairline/10 bg-surface-sunken/55 px-2 py-2 text-fg-muted leading-3">
						No revisions found for this project.
					</div>
				) : state.status === "loaded" ? (
					<ul className="grid gap-1">
						{state.revisions.map((revision) => {
							const revisionKey = `${revision.revision}`;
							const current = revision.revision === currentRevision;
							const busy = busyKey?.startsWith(`${revisionKey}:`) ?? false;
							return (
								<li
									key={revision.revision}
									className="rounded border border-hairline/10 bg-surface-sunken/55 px-2 py-1.5"
								>
									<div className="flex min-w-0 items-start justify-between gap-2">
										<div className="min-w-0">
											<div className="flex min-w-0 flex-wrap items-center gap-1.5">
												<span className="font-medium text-fg leading-3">
													r{revision.revision}
												</span>
												{current ? (
													<span className="rounded border border-accent/35 bg-accent-surface px-1.5 text-accent-fg leading-4">
														Current
													</span>
												) : null}
												<span className="text-fg-muted leading-3">
													{formatTimestamp(revision.createdAt)}
												</span>
											</div>
											<div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-fg-muted leading-3">
												<span>{formatBytes(revision.byteLength)}</span>
												<span>{revision.storageProvider.toUpperCase()}</span>
												<span className="font-mono">
													{revision.contentHash.slice(0, 10)}
												</span>
											</div>
										</div>
									</div>
									<div className="mt-1 flex flex-wrap items-center gap-1">
										<button
											type="button"
											className={historyDrawerActionButtonClass}
											disabled={busy || historyActionBlocked}
											onClick={() => onOpenRevision(revision)}
										>
											<FolderOpen aria-hidden="true" size={12} />
											<span className="truncate">Open</span>
										</button>
										<button
											type="button"
											className={historyDrawerActionButtonClass}
											disabled={busy}
											onClick={() => onDownload(revision)}
										>
											<DownloadSimple aria-hidden="true" size={12} />
											<span className="truncate">
												{busyKey === `${revisionKey}:download`
													? "Downloading"
													: "Download"}
											</span>
										</button>
										<button
											type="button"
											className={historyDrawerPrimaryButtonClass}
											disabled={busy || current || historyActionBlocked}
											onClick={() => onRestoreRequest(revision)}
										>
											<ClockCounterClockwise
												aria-hidden="true"
												size={12}
												className="text-accent-fg"
											/>
											<span className="truncate">
												{busyKey === `${revisionKey}:restore`
													? "Restoring"
													: "Restore"}
											</span>
										</button>
									</div>
									{pendingRestore?.revision === revision.revision ? (
										<div className="mt-1.5 rounded border border-warn/35 bg-warn-surface/25 px-2 py-1.5 text-warn-fg leading-3">
											<div className="font-medium">
												Restore r{revision.revision}?
											</div>
											<div className="mt-0.5 text-fg-secondary">
												This creates a new current revision, then opens it in
												the editor.
											</div>
											<div className="mt-1 flex items-center gap-1">
												<button
													type="button"
													className={historyDrawerActionButtonClass}
													disabled={busy}
													onClick={onRestoreCancel}
												>
													<X aria-hidden="true" size={12} />
													<span>Cancel</span>
												</button>
												<button
													type="button"
													className={historyDrawerPrimaryButtonClass}
													disabled={busy}
													onClick={() => onRestoreConfirm(revision)}
												>
													<ClockCounterClockwise
														aria-hidden="true"
														size={12}
														className="text-accent-fg"
													/>
													<span>Restore</span>
												</button>
											</div>
										</div>
									) : null}
								</li>
							);
						})}
					</ul>
				) : null}
			</div>
		</aside>
	);
}

type TopBarProps = {
	readonly onFitArtboard: () => void;
	readonly layersPanelShortcutLabel: string;
	readonly inspectorPanelShortcutLabel: string;
	readonly sidePanelsShortcutLabel: string;
	readonly timelineShortcutLabel: string;
	readonly commandPaletteShortcutTitle: string;
};

/**
 * The document-name line of the brand chip. `document.name` drives export
 * filenames, PDF metadata, and AI context, so it is the file identity — click to
 * rename inline. Commit once on Enter/blur (a single undo entry); Escape cancels.
 * The command itself trims, rejects blank, and no-ops unchanged names, so an
 * empty or unchanged edit silently reverts to the current name.
 */
function DocumentTitle({
	onVersionHistory,
}: {
	readonly onVersionHistory: () => void;
}) {
	const documentName = useSceneStore((state) => state.document.name);
	const activeCloudProject = useEditorCloudProjectStore(
		(state) => state.activeProject,
	);
	const cloudSaveStatus = useEditorCloudProjectStore(
		(state) => state.saveStatus,
	);
	const cloudSaveFailureReason = useEditorCloudProjectStore(
		(state) => state.saveFailureReason,
	);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(documentName);

	const beginEdit = () => {
		setDraft(documentName);
		setEditing(true);
	};
	const commit = () => {
		setEditing(false);
		useSceneStore.getState().apply(createRenameDocumentCommand(draft));
	};
	// Stable ref callback so it runs only on mount/unmount (not every keystroke),
	// focusing and selecting the freshly swapped-in input so the user can type to
	// replace. More reliable than `autoFocus`, which does not select the text.
	const focusAndSelect = useCallback((input: HTMLInputElement | null) => {
		if (!input) return;
		input.focus();
		input.select();
	}, []);

	if (editing) {
		return (
			<input
				ref={focusAndSelect}
				type="text"
				value={draft}
				aria-label="Document name"
				className="w-full truncate bg-transparent text-fg text-ui leading-3 outline-none"
				onChange={(event) => setDraft(event.currentTarget.value)}
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						commit();
					} else if (event.key === "Escape") {
						event.preventDefault();
						setEditing(false);
					}
				}}
			/>
		);
	}

	return (
		<div className="flex min-w-0 items-center gap-1.5">
			<button
				type="button"
				title={documentName}
				className="min-w-0 flex-1 cursor-text truncate text-left text-fg-muted text-ui leading-3 hover:text-fg"
				onClick={beginEdit}
			>
				{documentName}
			</button>
			<span
				className={`shrink-0 text-ui leading-3 ${cloudStatusClass(cloudSaveStatus)}`}
				title={
					activeCloudProject
						? cloudSaveFailureReason === "project-not-found"
							? `${activeCloudProject.name} is unavailable`
							: `${activeCloudProject.name} · r${activeCloudProject.revision}`
						: "Local browser document"
				}
			>
				{cloudStatusLabel(
					cloudSaveStatus,
					activeCloudProject,
					cloudSaveFailureReason,
				)}
			</span>
			{activeCloudProject ? (
				<button
					type="button"
					className="grid size-4 shrink-0 place-items-center rounded text-fg-muted hover:bg-white/8 hover:text-accent-fg focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent/60"
					aria-label="Version history"
					title="Version history"
					onClick={onVersionHistory}
				>
					<ClockCounterClockwise aria-hidden="true" size={10} />
				</button>
			) : null}
		</div>
	);
}

export function TopBar({
	onFitArtboard,
	layersPanelShortcutLabel,
	inspectorPanelShortcutLabel,
	sidePanelsShortcutLabel,
	timelineShortcutLabel,
	commandPaletteShortcutTitle,
}: TopBarProps) {
	const [importReport, setImportReport] =
		useState<TopBarImportReportModel | null>(null);
	const [exportReport, setExportReport] = useState<ExportReportModel | null>(
		null,
	);
	const [artboardScopeMode, setArtboardScopeMode] =
		useState<TopBarArtboardScopeMode>("current");
	const [exportMenuOpen, setExportMenuOpen] = useState(false);
	const [exportBusyLabel, setExportBusyLabel] = useState<string | null>(null);
	const [accountMenuOpen, setAccountMenuOpen] = useState(false);
	// Creator 2 (C2-R2): a non-entitled Motion Copilot composer routes the user to
	// the existing account/billing surface via a one-shot editor-chrome intent.
	const accountMenuOpenIntent = useEditorChromeStore(
		(state) => state.accountMenuOpenIntent,
	);
	const consumeAccountMenuOpen = useEditorChromeStore(
		(state) => state.consumeAccountMenuOpen,
	);
	useEffect(() => {
		if (!accountMenuOpenIntent) return;
		setAccountMenuOpen(true);
		consumeAccountMenuOpen();
	}, [accountMenuOpenIntent, consumeAccountMenuOpen]);
	/** S5 "expose all numeric parameters" DCTL export option; default off (hero params only). */
	const [dctlExposeAllParams, setDctlExposeAllParams] = useState(false);
	const [cloudMenuOpen, setCloudMenuOpen] = useState(false);
	const [cloudBusyLabel, setCloudBusyLabel] = useState<string | null>(null);
	const [cloudNotice, setCloudNotice] = useState<CloudProjectNotice | null>(
		null,
	);
	const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
	const [versionHistoryState, setVersionHistoryState] =
		useState<VersionHistoryState>({ status: "idle" });
	const [versionHistoryNotice, setVersionHistoryNotice] =
		useState<CloudProjectNotice | null>(null);
	const [versionHistoryBusyKey, setVersionHistoryBusyKey] = useState<
		string | null
	>(null);
	const [pendingVersionRestore, setPendingVersionRestore] =
		useState<CloudProjectRevisionSummary | null>(null);
	const [cloudAccountAccess, setCloudAccountAccess] =
		useState<CloudAccountAccess>({
			kind: "checking",
			tone: "muted",
			label: "Checking cloud save access",
			detail: "Local editing and export are available now.",
		});
	const importInputRef = useRef<HTMLInputElement | null>(null);
	const programSurfacePackageInputRef = useRef<HTMLInputElement | null>(null);
	const commandTriggerRef = useRef<HTMLButtonElement | null>(null);
	const commandWasOpenRef = useRef(false);
	const accountWasOpenRef = useRef(false);
	const cloudAccountRequestRef = useRef<AbortController | null>(null);
	const cloudBusyAttemptRef = useRef<number | null>(null);
	const panelsOpen = useEditorChromeStore((state) => state.panelsOpen);
	const layersOpen = useEditorChromeStore((state) => state.layersOpen);
	const inspectorOpen = useEditorChromeStore((state) => state.inspectorOpen);
	const timelineOpen = useEditorChromeStore((state) => state.timelineOpen);
	const lookWorkspaceOpen = useEditorChromeStore(
		(state) => state.lookWorkspaceOpen,
	);
	const motionCopilotOpen = useEditorChromeStore(
		(state) => state.motionCopilotOpen,
	);
	const visualReviewOpen = useEditorChromeStore(
		(state) => state.visualReviewOpen,
	);
	const commandPaletteOpen = useEditorChromeStore(
		(state) => state.commandPaletteOpen,
	);
	const cloudWriterMode = useCloudWriterLeaseStore((state) => state.mode);
	const cloudWriterProjectId = useCloudWriterLeaseStore(
		(state) => state.projectId,
	);
	const togglePanels = useEditorChromeStore((state) => state.togglePanels);
	const toggleLayersPanel = useEditorChromeStore(
		(state) => state.toggleLayersPanel,
	);
	const toggleInspectorPanel = useEditorChromeStore(
		(state) => state.toggleInspectorPanel,
	);
	const toggleTimeline = useEditorChromeStore((state) => state.toggleTimeline);
	const toggleLookWorkspace = useEditorChromeStore(
		(state) => state.toggleLookWorkspace,
	);
	const toggleMotionCopilot = useEditorChromeStore(
		(state) => state.toggleMotionCopilot,
	);
	const toggleVisualReview = useEditorChromeStore(
		(state) => state.toggleVisualReview,
	);
	const toggleCommandPalette = useEditorChromeStore(
		(state) => state.toggleCommandPalette,
	);
	const shortcutHelpOpen = useEditorChromeStore(
		(state) => state.shortcutHelpOpen,
	);
	const toggleShortcutHelp = useEditorChromeStore(
		(state) => state.toggleShortcutHelp,
	);
	const zoom = useViewportStore((state) => state.zoom);
	const zoomStepIn = useViewportStore((state) => state.zoomStepIn);
	const zoomStepOut = useViewportStore((state) => state.zoomStepOut);
	const sceneCanUndo = useSceneStore((state) => state.canUndo);
	const sceneCanRedo = useSceneStore((state) => state.canRedo);
	const motionCanUndo = useMotionStore((state) => state.canUndo);
	const motionCanRedo = useMotionStore((state) => state.canRedo);
	const grammarCanUndo = useMotionGrammarStore((state) => state.canUndo);
	const grammarCanRedo = useMotionGrammarStore((state) => state.canRedo);
	const canUndo = sceneCanUndo || motionCanUndo || grammarCanUndo;
	const canRedo = sceneCanRedo || motionCanRedo || grammarCanRedo;
	const sceneDocument = useSceneStore((state) => state.document);
	const selectedNodeIds = useSelectionStore((state) => state.nodeIds);
	const selectedArtboardIds = selectedArtboardIdsForNodes(
		sceneDocument,
		selectedNodeIds,
	);
	const activeCloudProject = useEditorCloudProjectStore(
		(state) => state.activeProject,
	);
	const cloudSaveStatus = useEditorCloudProjectStore(
		(state) => state.saveStatus,
	);
	const cloudErrorMessage = useEditorCloudProjectStore(
		(state) => state.errorMessage,
	);
	const cloudSaveFailureReason = useEditorCloudProjectStore(
		(state) => state.saveFailureReason,
	);
	const cloudConflictProject = useEditorCloudProjectStore(
		(state) => state.conflictProject,
	);
	const clearActiveCloudProject = useEditorCloudProjectStore(
		(state) => state.clearActiveProject,
	);
	// The command palette popover lives in the action-surface; when it closes,
	// return focus to this trigger so keyboard users are never stranded.
	useEffect(() => {
		if (commandPaletteOpen) {
			commandWasOpenRef.current = true;
		} else if (commandWasOpenRef.current) {
			commandWasOpenRef.current = false;
			commandTriggerRef.current?.focus();
		}
	}, [commandPaletteOpen]);
	const refreshCloudAccountAccess = useCallback(() => {
		if (!platformCapabilities.account) return;
		cloudAccountRequestRef.current?.abort();
		const controller = new AbortController();
		cloudAccountRequestRef.current = controller;
		void fetchAccountBootstrap(controller.signal)
			.then((result) => {
				if (controller.signal.aborted) return;
				setCloudAccountAccess(cloudAccountAccessFromBootstrap(result));
			})
			.finally(() => {
				if (cloudAccountRequestRef.current === controller) {
					cloudAccountRequestRef.current = null;
				}
			});
	}, []);
	useEffect(() => {
		refreshCloudAccountAccess();
		return () => {
			cloudAccountRequestRef.current?.abort();
			cloudAccountRequestRef.current = null;
		};
	}, [refreshCloudAccountAccess]);
	useEffect(() => {
		if (accountMenuOpen) {
			accountWasOpenRef.current = true;
			return;
		}
		if (!accountWasOpenRef.current) return;
		accountWasOpenRef.current = false;
		refreshCloudAccountAccess();
	}, [accountMenuOpen, refreshCloudAccountAccess]);
	const loadVersionHistory = useCallback(() => {
		if (!activeCloudProject) {
			setVersionHistoryState({ status: "idle" });
			setVersionHistoryNotice(null);
			return;
		}
		const projectId = activeCloudProject.id;
		setVersionHistoryState({ status: "loading" });
		setVersionHistoryNotice(null);
		void listCloudProjectRevisions(projectId).then((result) => {
			if (
				useEditorCloudProjectStore.getState().activeProject?.id !== projectId
			) {
				return;
			}
			if (result.kind === "ok") {
				setVersionHistoryState({
					status: "loaded",
					revisions: result.revisions,
				});
				return;
			}
			setVersionHistoryState({
				status: "error",
				message:
					result.kind === "error"
						? result.message
						: result.kind === "unauthenticated"
							? "Sign in to view project history."
							: "Project history could not be found.",
			});
		});
	}, [activeCloudProject]);
	useEffect(() => {
		if (!versionHistoryOpen) return;
		loadVersionHistory();
	}, [loadVersionHistory, versionHistoryOpen]);
	const openVersionHistory = useCallback(() => {
		setCloudMenuOpen(false);
		setVersionHistoryOpen(true);
	}, []);
	const openVersionHistoryRevision = (
		revision: CloudProjectRevisionSummary,
	) => {
		if (!activeCloudProject) return;
		globalThis.open(
			createEditorOpenUrl({
				projectId: activeCloudProject.id,
				revision: revision.revision,
			}),
			"_blank",
			"noopener",
		);
	};
	const downloadVersionHistoryRevision = (
		revision: CloudProjectRevisionSummary,
	) => {
		if (!activeCloudProject) return;
		const project = activeCloudProject;
		setVersionHistoryBusyKey(`${revision.revision}:download`);
		setVersionHistoryNotice(null);
		void readCloudProjectRevision(project.id, revision.revision).then(
			(result) => {
				setVersionHistoryBusyKey(null);
				if (result.kind !== "ok") {
					setVersionHistoryNotice({
						status: "error",
						title: "Revision backup could not download",
						detail:
							result.kind === "error"
								? result.message
								: "The revision could not be opened for download.",
					});
					return;
				}
				downloadTextFile(
					projectBackupFileName(`${project.name} r${revision.revision}`),
					projectBackupMimeType(),
					result.revision.documentJson,
				);
				setVersionHistoryNotice({
					status: "success",
					title: "Revision backup downloaded",
					detail: `r${revision.revision}`,
				});
			},
		);
	};
	const restoreVersionHistoryRevision = (
		revision: CloudProjectRevisionSummary,
	) => {
		if (!activeCloudProject) return;
		if (!canWriteCloudProject(activeCloudProject.id)) {
			setVersionHistoryNotice({
				status: "warning",
				title: "This editor is in review mode",
				detail: "Take over writing before restoring cloud history.",
			});
			return;
		}
		const restoreFence = captureEditorBindingFence();
		const projectId = activeCloudProject.id;
		setVersionHistoryBusyKey(`${revision.revision}:restore`);
		setVersionHistoryNotice(null);
		void restoreCloudProjectRevision(projectId, revision.revision).then(
			(result) => {
				setVersionHistoryBusyKey(null);
				setPendingVersionRestore(null);
				if (!isEditorBindingFenceCurrent(restoreFence)) {
					setVersionHistoryNotice({
						status: "warning",
						title: "Editor changed before restore completed",
						detail: "The delayed result was not opened in this editor.",
					});
					return;
				}
				if (result.kind === "ok") {
					globalThis.location.assign(
						`/editor?cloudProject=${encodeURIComponent(result.project.id)}`,
					);
					return;
				}
				setVersionHistoryNotice({
					status:
						result.kind === "invalid" ||
						result.kind === "upgrade_required" ||
						result.kind === "quota_exceeded" ||
						result.kind === "conflict"
							? "warning"
							: "error",
					title:
						result.kind === "upgrade_required"
							? "Restore requires Creator Pro"
							: result.kind === "quota_exceeded"
								? "Cloud storage safety limit reached"
								: "Restore failed",
					detail:
						result.kind === "error" || result.kind === "invalid"
							? result.message
							: result.kind === "upgrade_required" ||
									result.kind === "quota_exceeded"
								? `${result.message} Open or download this revision for recovery.`
								: result.kind === "conflict"
									? "Cloud changed while restoring. Refresh history and try again."
									: result.kind === "unauthenticated"
										? "Sign in to restore project history."
										: "The revision could not be found.",
				});
			},
		);
	};
	const exportArtboardScope = (snapshot: ExportSnapshot) =>
		createTopBarExportArtboardScope(
			snapshot.scene,
			useSelectionStore.getState().nodeIds,
			artboardScopeMode,
		);
	const authoringOutputForSnapshot = (
		snapshot: ExportSnapshot,
	): ProjectAuthoringOutputReport =>
		createProjectAuthoringOutputReport({
			scene: snapshot.scene,
			motion: snapshot.motion,
			grammar: snapshot.grammar,
		});
	const exportMotionCode = (profile: ExportOptimizationProfile) => {
		setExportMenuOpen(false);
		void (async () => {
			const optimization = exportOptimizationOptionsForProfile(profile);
			const baselineOptimization =
				exportOptimizationOptionsForProfile("editable");
			const snapshot = currentExportSnapshot();
			const artboardScope = exportArtboardScope(snapshot);
			const bundle = createExportBundle({
				...snapshot,
				artboardScope,
			});
			const hasSceneSequence = (bundle.sceneSequence?.items.length ?? 0) > 0;
			const scoped = resolveExportArtboardScope(snapshot.scene, artboardScope);
			const needsWebglPlayer = scoped.targets.some(
				(target) =>
					sceneNeedsGpuSurface(target.scene) ||
					sceneHasVideoMedia(target.scene),
			);
			let assets: readonly MotionCodeReportAsset[];
			let baselineAssets: readonly MotionCodeReportAsset[];
			if (needsWebglPlayer) {
				const { createWebglPlayerExportAssets } = await import(
					"@/features/export/model/webgl-player"
				);
				assets = hasSceneSequence
					? createWebglPlayerExportAssets(bundle, snapshot.grammarBindings, {
							optimization,
						})
					: scoped.targets.flatMap((target) =>
							createWebglPlayerExportAssets(bundle, snapshot.grammarBindings, {
								scene: target.scene,
								fileStem: target.fileStem,
								optimization,
							}),
						);
				baselineAssets =
					profile === "editable"
						? assets
						: hasSceneSequence
							? createWebglPlayerExportAssets(
									bundle,
									snapshot.grammarBindings,
									{ optimization: baselineOptimization },
								)
							: scoped.targets.flatMap((target) =>
									createWebglPlayerExportAssets(
										bundle,
										snapshot.grammarBindings,
										{
											scene: target.scene,
											fileStem: target.fileStem,
											optimization: baselineOptimization,
										},
									),
								);
			} else {
				assets = createMotionCodeExportAssets(
					bundle,
					snapshot.grammarBindings,
					{ optimization },
				);
				baselineAssets =
					profile === "editable"
						? assets
						: createMotionCodeExportAssets(bundle, snapshot.grammarBindings, {
								optimization: baselineOptimization,
							});
			}
			assets = dedupeDownloadAssets(assets);
			baselineAssets = dedupeDownloadAssets(baselineAssets);
			const afterBytes = textAssetsByteLength(assets);
			const beforeBytes =
				profile === "editable"
					? afterBytes
					: textAssetsByteLength(baselineAssets);
			const grammarFidelityAsset =
				assets.find(
					(asset) =>
						asset.kind === "runtime-data-json" ||
						asset.kind === "webgl-data-json",
				) ??
				assets.find(
					(asset) =>
						asset.kind === "runtime-js" || asset.kind === "webgl-runtime-js",
				);
			const grammarFidelityIssues = motionCodeGrammarFidelityIssuesForExport(
				snapshot,
				optimization,
			);
			downloadMotionCodeAssets(assets);
			setImportReport(null);
			setExportReport(
				createStandaloneExportReport({
					title: needsWebglPlayer
						? `Motion / Code WebGL ${exportOptimizationProfileLabel[profile]} export ready`
						: `Motion / Code ${exportOptimizationProfileLabel[profile]} export ready`,
					targetLabel: "files",
					frame: snapshot.frame,
					frameRange: currentFrameRangeReport(snapshot),
					artboardScope: standaloneScopeReport({
						mode: bundle.artboards.scope,
						targetCount: bundle.artboards.exportedArtboardIds.length,
						targetNames: bundle.artboards.exported.map(
							(artboard) => artboard.name,
						),
					}),
					assets: assets.map((asset) => ({
						kind: asset.kind,
						fileName: asset.fileName,
						role: motionCodeReportAssetRole(asset),
						byteLength: textAssetByteLength(asset),
						issueCount: motionCodeReportIssueCount(asset),
						issueCodes: motionCodeReportIssueCodes(asset),
					})),
					// Reads the SAME projected componentProps result the shipped
					// runtime/data/react assets were just built from (see
					// componentPropsExportResultFromBundle's JSDoc), so this report
					// row set can never diverge from what actually got downloaded.
					// The WebGL player now applies the same compiled appliers as the
					// SVG runtime, so this no longer branches on needsWebglPlayer.
					// interactionsIssuesForExport reports dropped interactions
					// (dangling trigger node/clip/prop); interactionsRuntimeUnsupported
					// IssuesForExport separately reports the honest-degrade case where
					// a SURVIVING interaction rides a runtime/trigger-scope combination
					// that cannot execute it: a NODE-scoped interaction routed through
					// the WebGL player (Interactive Motion T3-S3 wires every
					// COMPONENT-level interaction there natively via the same
					// createInteractionEngine the SVG runtime uses, but a canvas has no
					// per-node DOM element to fire a node-scoped trigger from — one row
					// per excluded interaction), or ANY interaction routed through the
					// scene-sequence player (never wired, per
					// createVectorMotionPlayer-only wiring — see code.ts's
					// installInteractionWiring comment).
					issues: [
						...motionCodeRuntimePayloadIssues(assets).map(
							({ asset, issue }) =>
								({
									...issue,
									assetFileName: asset.fileName,
									assetKind: asset.kind,
									assetRole: motionCodeReportAssetRole(asset),
								}) satisfies ExportReportIssue,
						),
						...grammarFidelityIssues.map(
							(issue) =>
								({
									...issue,
									assetFileName:
										grammarFidelityAsset?.fileName ?? "runtime motion grammar",
									assetKind:
										grammarFidelityAsset?.kind ??
										(needsWebglPlayer ? "webgl-runtime-js" : "runtime-js"),
									assetRole: grammarFidelityAsset
										? motionCodeReportAssetRole(grammarFidelityAsset)
										: "runtime-code",
								}) satisfies ExportReportIssue,
						),
						...componentPropsIssuesForExport({
							bundle,
							options: optimization,
							grammarBindings: snapshot.grammarBindings,
						}),
						...interactionsIssuesForExport({ bundle, options: optimization }),
						...interactionsRuntimeUnsupportedIssuesForExport({
							bundle,
							options: optimization,
							needsWebglPlayer,
							hasSceneSequence,
						}),
					],
					optimization: createMotionCodeOptimizationSummary({
						profile,
						runtimePackaging: optimization.runtimePackaging,
						beforeBytes,
						afterBytes,
					}),
					authoringOutput: authoringOutputForSnapshot(snapshot),
				}),
			);
		})();
	};
	const exportIndividualVectors = () => {
		setExportMenuOpen(false);
		const snapshot = currentExportSnapshot();
		const result = createIndividualVectorSvgExports({
			...snapshot,
			nodeIds: useSelectionStore.getState().nodeIds,
		});
		if (result.assets.length === 0) {
			window.alert(
				result.issues[0]?.message ??
					"Select at least one vector object before exporting.",
			);
			return;
		}
		downloadAssets(result.assets);
		const vectorIssues: ExportReportIssue[] = result.assets.flatMap((asset) =>
			asset.issues.map(
				(issue) =>
					({
						...issue,
						assetFileName: asset.fileName,
						assetKind: "svg",
						assetRole: "individual-vector",
					}) satisfies ExportReportIssue,
			),
		);
		setImportReport(null);
		setExportReport(
			createStandaloneExportReport({
				title: "Vector SVG export ready",
				targetLabel: "vectors",
				frame: snapshot.frame,
				frameRange: currentFrameRangeReport(snapshot),
				artboardScope: standaloneScopeReport({
					mode: "selected",
					targetCount: result.exportedNodeIds.length,
					targetNames: result.assets.map((asset) => asset.fileName),
				}),
				assets: result.assets.map((asset) => ({
					kind: "svg",
					fileName: asset.fileName,
					role: "individual-vector",
					issueCount: asset.issues.length,
					issueCodes: [...new Set(asset.issues.map((issue) => issue.code))],
				})),
				issues: vectorIssues,
				authoringOutput: authoringOutputForSnapshot(snapshot),
			}),
		);
	};
	const exportPdfFrame = () => {
		setExportMenuOpen(false);
		const snapshot = currentExportSnapshot();
		const artboardScope = exportArtboardScope(snapshot);
		const bundle = createExportBundle({
			...snapshot,
			artboardScope,
		});
		const pdfAssets = bundle.assets.filter((asset) => asset.kind === "pdf");
		if (pdfAssets.length === 0) {
			window.alert("No artboard is available for PDF export.");
			return;
		}
		downloadAssets(pdfAssets);
		const pdfIssues: ExportReportIssue[] = pdfAssets.flatMap((asset) =>
			("issues" in asset ? asset.issues : []).map(
				(issue) =>
					({
						...issue,
						assetFileName: asset.fileName,
						assetKind: "pdf",
						assetRole: "frame-pdf",
					}) satisfies ExportReportIssue,
			),
		);
		setImportReport(null);
		setExportReport(
			createStandaloneExportReport({
				title: "PDF export ready",
				targetLabel: "PDFs",
				frame: bundle.frame,
				frameRange: currentFrameRangeReport({
					...snapshot,
					frame: bundle.frame,
				}),
				artboardScope: standaloneScopeReport({
					mode: bundle.artboards.scope,
					targetCount: bundle.artboards.exportedArtboardIds.length,
					targetNames: bundle.artboards.exported.map(
						(artboard) => artboard.name,
					),
				}),
				assets: pdfAssets.map((asset) => ({
					kind: "pdf",
					fileName: asset.fileName,
					role: "frame-pdf",
					byteLength: textAssetByteLength(asset),
					issueCount: motionCodeReportIssueCount(asset),
					issueCodes: motionCodeReportIssueCodes(asset),
				})),
				issues: pdfIssues,
				authoringOutput: authoringOutputForSnapshot(snapshot),
			}),
		);
	};
	const exportLookDctl = () => {
		setExportMenuOpen(false);
		const snapshot = currentExportSnapshot();
		const result = exportLookAsDctl(snapshot.scene, {
			exposeAllParams: dctlExposeAllParams,
		});
		if (!result.ok) {
			window.alert(result.reason);
			return;
		}
		downloadAsset(result.asset);
		const dctlIssues = lookDctlIssuesForReport(
			result.report,
			result.asset.fileName,
		);
		setImportReport(null);
		setExportReport(
			createStandaloneExportReport({
				title: "Look DCTL export ready",
				targetLabel: "DCTL",
				frame: snapshot.frame,
				frameRange: currentFrameRangeReport(snapshot),
				artboardScope: standaloneScopeReport({
					mode: "selected",
					targetCount: 1,
					targetNames: [result.asset.fileName],
				}),
				assets: [
					{
						kind: "dctl",
						fileName: result.asset.fileName,
						role: "look-dctl",
						byteLength: textAssetByteLength(result.asset),
						issueCount: dctlIssues.length,
						issueCodes: [...new Set(dctlIssues.map((issue) => issue.code))],
					},
				],
				issues: dctlIssues,
				authoringOutput: authoringOutputForSnapshot(snapshot),
			}),
		);
	};
	const exportVideoWebm = async () => {
		setExportMenuOpen(false);
		const snapshot = currentExportSnapshot();
		setExportBusyLabel("Video");
		try {
			// S3c: export resolves linked production artifacts through the same
			// entity contract the canvas uses. Undefined for a document that links
			// nothing, which keeps every ordinary export on the untouched path.
			const resolveProductionArtifact = linkedProductionResolverForScene(
				snapshot.scene,
			);
			const results = await recordAndDownloadWebmVideoExport({
				...snapshot,
				artboardScope: exportArtboardScope(snapshot),
				...(resolveProductionArtifact ? { resolveProductionArtifact } : {}),
			});
			const videoIssues: ExportReportIssue[] = results.flatMap((result) =>
				result.issues.map(
					(issue) =>
						({
							...issue,
							assetFileName: result.fileName,
							assetKind: "video-webm",
							assetRole: "video-file",
						}) satisfies ExportReportIssue,
				),
			);
			setImportReport(null);
			setExportReport(
				createStandaloneExportReport({
					title: "Video WebM export ready",
					targetLabel: "videos",
					frame: snapshot.frame,
					frameRange: fullMotionFrameRangeReport(snapshot),
					artboardScope: standaloneScopeReport({
						mode: artboardScopeMode,
						targetCount: results.length,
						targetNames: results.map((result) => result.fileName),
					}),
					assets: results.map((result) => ({
						kind: "video-webm",
						fileName: result.fileName,
						role: "video-file",
						issueCount: result.issues.length,
						issueCodes: [...new Set(result.issues.map((issue) => issue.code))],
					})),
					issues: videoIssues,
					authoringOutput: authoringOutputForSnapshot(snapshot),
					// S4-D: present only when a capture actually composed a rendered
					// Blender frame package, so the exact claim stays attached to the
					// one delivery that can support it.
					framePackageDeliveries: results.flatMap((result) =>
						result.framePackageDelivery ? [result.framePackageDelivery] : [],
					),
				}),
			);
		} catch (error) {
			window.alert(
				error instanceof Error ? error.message : "Video export failed.",
			);
		} finally {
			setExportBusyLabel(null);
		}
	};
	// The full project — scene plus its motion side-car — saved as one restorable
	// file. This is the durable hedge: the user's work reopens here with no
	// account or server, so the editor going away never strands their documents.
	const saveProjectBackup = () => {
		const scene = useSceneStore.getState().document;
		const motion = useMotionStore.getState().document;
		const grammar = useMotionGrammarStore.getState().document;
		const fileName = projectBackupFileName(scene.name);
		downloadTextFile(
			fileName,
			projectBackupMimeType(),
			serializeProjectBackup(scene, motion, { grammar }),
		);
		setExportReport(null);
		setImportReport(
			createTopBarBackupSavedReport(fileName, scene.layers.length),
		);
	};
	const applyProjectRestoreResult = (result: ProjectRestoreResult) => {
		if (result.status === "ok") {
			useSceneStore.getState().reset(result.scene);
			if (result.motion) useMotionStore.getState().reset(result.motion);
			if (result.grammar) {
				useMotionGrammarStore.getState().load(result.grammar);
			} else if (
				result.format === "project-backup" ||
				result.format === "legacy-time-delay-master-instances"
			) {
				useMotionGrammarStore.getState().reset();
			}
			useSelectionStore.getState().clearSelection();
			useTransportStore.getState().stop();
		}
	};
	const restoreProjectBackup = async (file: File) => {
		const result = restorePortableProject(await readFileAsText(file));
		applyProjectRestoreResult(result);
		if (result.status === "ok") {
			clearActiveCloudProject();
		}
		setImportReport(
			createTopBarBackupRestoreReport(file.name || "Untitled backup", result),
		);
	};
	const currentCloudProjectPayload = () => {
		const scene = useSceneStore.getState().document;
		const motion = useMotionStore.getState().document;
		const grammar = useMotionGrammarStore.getState().document;
		return {
			name: scene.name,
			documentJson: serializeProjectBackup(scene, motion, { grammar }),
			fingerprint: cloudProjectFingerprint({ scene, motion, grammar }),
		};
	};
	const beginCloudBusyAttempt = (label: string): number => {
		const attemptId = useEditorCloudProjectStore.getState().beginSave();
		cloudBusyAttemptRef.current = attemptId;
		setCloudBusyLabel(label);
		return attemptId;
	};
	const releaseCloudBusyAttempt = (attemptId: number): void => {
		if (cloudBusyAttemptRef.current !== attemptId) return;
		cloudBusyAttemptRef.current = null;
		setCloudBusyLabel(null);
	};
	const finishCurrentCloudProjectSave = (
		project: CloudProject,
		fingerprint: string,
		title: string,
		attemptId: number,
	): boolean => {
		const accepted = useEditorCloudProjectStore.getState().finishSave(
			{
				id: project.id,
				name: project.name,
				revision: project.revision,
				contentHash: project.contentHash,
				updatedAt: project.updatedAt,
			},
			fingerprint,
			attemptId,
		);
		releaseCloudBusyAttempt(attemptId);
		if (!accepted) return false;
		setCloudNotice({
			status: "success",
			title,
			detail: `${project.name} · r${project.revision}`,
		});
		return true;
	};
	const createCurrentCloudProjectFromEditor = async ({
		busyLabel,
		failureReason,
		failureTitle,
		nameForProject,
		successTitle,
	}: {
		readonly busyLabel: string;
		readonly failureReason?: EditorCloudSaveFailureReason;
		readonly failureTitle: string;
		readonly nameForProject: (documentName: string) => string;
		readonly successTitle: string;
	}) => {
		const payload = currentCloudProjectPayload();
		const saveFence = captureEditorBindingFence();
		setCloudNotice(null);
		const saveAttemptId = beginCloudBusyAttempt(busyLabel);
		const result = await createCloudProject({
			name: nameForProject(payload.name),
			documentJson: payload.documentJson,
		});
		if (!isEditorBindingFenceCurrent(saveFence)) {
			const accepted = useEditorCloudProjectStore
				.getState()
				.failSave(
					"The editor changed before the cloud save completed.",
					"generic",
					saveAttemptId,
				);
			releaseCloudBusyAttempt(saveAttemptId);
			if (!accepted) return;
			setCloudNotice({
				status: "warning",
				title: "Editor changed before save completed",
				detail: "The delayed cloud result was not attached to this editor.",
			});
			return;
		}
		if (result.kind === "ok") {
			if (
				!finishCurrentCloudProjectSave(
					result.project,
					payload.fingerprint,
					successTitle,
					saveAttemptId,
				)
			) {
				return;
			}
			return;
		}

		const message =
			result.kind === "error" || result.kind === "invalid"
				? result.message
				: result.kind === "upgrade_required"
					? result.message
					: result.kind === "quota_exceeded"
						? result.message
						: result.kind === "too_large"
							? "This project is larger than the cloud project limit."
							: result.kind === "not_found"
								? "Cloud projects are not available right now."
								: result.kind === "conflict"
									? "Cloud changed while saving."
									: "Sign in to save cloud projects.";
		const accepted = useEditorCloudProjectStore
			.getState()
			.failSave(message, failureReason ?? "generic", saveAttemptId);
		releaseCloudBusyAttempt(saveAttemptId);
		if (!accepted) return;
		setCloudNotice({
			status:
				result.kind === "too_large" ||
				result.kind === "invalid" ||
				result.kind === "upgrade_required" ||
				result.kind === "quota_exceeded" ||
				result.kind === "conflict"
					? "warning"
					: "error",
			title:
				result.kind === "upgrade_required"
					? "Cloud saves require Creator"
					: result.kind === "quota_exceeded"
						? "Cloud storage safety limit reached"
						: failureTitle,
			detail:
				result.kind === "error" || result.kind === "invalid"
					? result.message
					: result.kind === "upgrade_required"
						? cloudProjectUpgradeDetail(result)
						: result.kind === "quota_exceeded"
							? `${result.message} Keep editing locally or download a backup.`
							: result.kind === "too_large"
								? "Download a local backup for this project."
								: result.kind === "not_found"
									? "Keep editing locally or download a backup."
									: result.kind === "conflict"
										? "Save again or download a backup before replacing work."
										: "Sign in to save cloud projects, or keep working locally.",
		});
	};
	const saveCurrentCloudProject = async () => {
		if (activeCloudProject && !canWriteCloudProject(activeCloudProject.id)) {
			setCloudNotice({
				status: "warning",
				title: "This editor is in review mode",
				detail: "Take over writing or save this work as a cloud copy.",
			});
			return;
		}
		const payload = currentCloudProjectPayload();
		const saveFence = captureEditorBindingFence();
		setCloudNotice(null);
		const saveAttemptId = beginCloudBusyAttempt("Saving");
		const result = activeCloudProject
			? await updateCloudProject(activeCloudProject.id, {
					name: payload.name,
					documentJson: payload.documentJson,
					baseRevision: activeCloudProject.revision,
				})
			: await createCloudProject({
					name: payload.name,
					documentJson: payload.documentJson,
				});
		if (!isEditorBindingFenceCurrent(saveFence)) {
			const accepted = useEditorCloudProjectStore
				.getState()
				.failSave(
					"The editor changed before the cloud save completed.",
					"generic",
					saveAttemptId,
				);
			releaseCloudBusyAttempt(saveAttemptId);
			if (!accepted) return;
			setCloudNotice({
				status: "warning",
				title: "Editor changed before save completed",
				detail: "The delayed cloud result was not attached to this editor.",
			});
			return;
		}
		if (activeCloudProject && !canWriteCloudProject(activeCloudProject.id)) {
			const accepted = useEditorCloudProjectStore
				.getState()
				.failSave(
					"Writer ownership changed during save.",
					"generic",
					saveAttemptId,
				);
			releaseCloudBusyAttempt(saveAttemptId);
			if (!accepted) return;
			setCloudNotice({
				status: "warning",
				title: "Writer ownership changed during save",
				detail: "Refresh cloud state before saving again.",
			});
			return;
		}

		if (result.kind === "ok") {
			if (
				!finishCurrentCloudProjectSave(
					result.project,
					payload.fingerprint,
					"Saved to cloud",
					saveAttemptId,
				)
			) {
				return;
			}
			return;
		}

		if (result.kind === "unauthenticated") {
			const accepted = useEditorCloudProjectStore
				.getState()
				.failSave("Sign in to save cloud projects.", "generic", saveAttemptId);
			releaseCloudBusyAttempt(saveAttemptId);
			if (!accepted) return;
			setCloudNotice({
				status: "warning",
				title: "Sign in to save cloud projects",
				detail:
					"Keep editing locally, download a backup, or sign in from the account menu.",
			});
			return;
		}
		if (result.kind === "upgrade_required") {
			const accepted = useEditorCloudProjectStore
				.getState()
				.failSave(result.message, "generic", saveAttemptId);
			releaseCloudBusyAttempt(saveAttemptId);
			if (!accepted) return;
			setCloudNotice({
				status: "warning",
				title: "Cloud saves require Creator",
				detail: cloudProjectUpgradeDetail(result),
			});
			return;
		}
		if (result.kind === "too_large") {
			const accepted = useEditorCloudProjectStore
				.getState()
				.failSave(
					"This project is larger than the cloud project limit.",
					"generic",
					saveAttemptId,
				);
			releaseCloudBusyAttempt(saveAttemptId);
			if (!accepted) return;
			const actual =
				result.actualBytes === undefined
					? null
					: formatBytes(result.actualBytes);
			const limit =
				result.maxBytes === undefined ? null : formatBytes(result.maxBytes);
			setCloudNotice({
				status: "warning",
				title: "Project is too large for cloud save",
				detail:
					actual && limit
						? `${actual} exceeds the ${limit} MVP limit. Download a backup instead.`
						: "Download a local backup for this project.",
			});
			return;
		}
		if (result.kind === "quota_exceeded") {
			const accepted = useEditorCloudProjectStore
				.getState()
				.failSave(result.message, "generic", saveAttemptId);
			releaseCloudBusyAttempt(saveAttemptId);
			if (!accepted) return;
			setCloudNotice({
				status: "warning",
				title: "Cloud storage safety limit reached",
				detail: `${result.message} Keep editing locally or download a backup.`,
			});
			return;
		}
		if (result.kind === "conflict") {
			const accepted = useEditorCloudProjectStore
				.getState()
				.conflictSave(result.project, saveAttemptId);
			releaseCloudBusyAttempt(saveAttemptId);
			if (!accepted) return;
			setCloudNotice({
				status: "warning",
				title: "Cloud project changed elsewhere",
				detail:
					"Save this work as a cloud copy, open the latest revision, or download a backup.",
			});
			return;
		}
		if (result.kind === "not_found") {
			const accepted = useEditorCloudProjectStore
				.getState()
				.failSave(
					"This cloud project is no longer available. Your document is still local in this editor.",
					"project-not-found",
					saveAttemptId,
				);
			releaseCloudBusyAttempt(saveAttemptId);
			if (!accepted) return;
			setCloudNotice({
				status: "warning",
				title: "Cloud project unavailable",
				detail:
					"Save as a new cloud project, download a backup, or work locally.",
			});
			return;
		}
		const accepted = useEditorCloudProjectStore
			.getState()
			.failSave(result.message, "generic", saveAttemptId);
		releaseCloudBusyAttempt(saveAttemptId);
		if (!accepted) return;
		setCloudNotice({
			status: result.kind === "invalid" ? "warning" : "error",
			title: "Cloud save failed",
			detail: `${result.message} Keep editing locally or download a backup.`,
		});
	};
	const saveCurrentCloudProjectAsCopy = async () => {
		await createCurrentCloudProjectFromEditor({
			busyLabel: "Saving copy",
			failureTitle: "Cloud copy failed",
			nameForProject: (documentName) => `${documentName} copy`,
			successTitle: "Saved as cloud copy",
		});
	};
	const saveCurrentCloudProjectAsNewProject = async () => {
		await createCurrentCloudProjectFromEditor({
			busyLabel: "Saving",
			failureReason: "project-not-found",
			failureTitle: "Cloud save failed",
			nameForProject: (documentName) => documentName,
			successTitle: "Saved as new cloud project",
		});
	};
	const detachCurrentCloudProject = () => {
		clearActiveCloudProject();
		setCloudNotice({
			status: "warning",
			title: "Working locally",
			detail:
				"Cloud autosave is detached for this tab; the document stays in the editor.",
		});
	};
	const importFile = async (file: File) => {
		setExportReport(null);
		try {
			if (isPortableProjectFile(file.name, file.type)) {
				await restoreProjectBackup(file);
				return;
			}

			if (isTopBarVideoPlacementFile(file.name, file.type)) {
				setImportReport(await placeVideoFile(file));
				return;
			}

			if (isRasterImagePlacementFile(file.name, file.type)) {
				setImportReport(await placeImageFile(file));
				return;
			}

			if (isUnsupportedTopBarVideoFile(file.name, file.type)) {
				setImportReport(
					createTopBarUnsupportedVideoReport({
						sourceName: file.name || "Untitled video",
						sourceFormat: file.type || "video/unknown",
					}),
				);
				return;
			}

			if (isUnsupportedRasterImageFile(file.name, file.type)) {
				setImportReport(
					createTopBarUnsupportedImageReport({
						sourceName: file.name || "Untitled image",
						sourceFormat: file.type || "image/unknown",
					}),
				);
				return;
			}

			const importedFile = await readImportFile(file);

			if (importedFile.kind === "unsupported") {
				setImportReport(
					createTopBarUnsupportedImportReport({
						sourceName: importedFile.sourceName,
						sourceFormat: importedFile.sourceFormat,
						issues: importedFile.issues,
					}),
				);
				return;
			}

			if (importedFile.kind === "ai") {
				const analysis = analyzeAiImport(importedFile.bytes, {
					sourceName: importedFile.sourceName,
				});
				if (analysis.kind === "pdf-compatible") {
					appendImportedPayload(analysis.scenePayload);
				}
				setImportReport(createTopBarAiImportReport(analysis));
				return;
			}

			const payload = parseSvgToImportedScenePayload(importedFile.text, {
				sourceName: importedFile.sourceName,
				layerName: importedFile.sourceName,
			});
			appendImportedPayload(payload);
			setImportReport(
				createTopBarImportReportFromPayload(payload, {
					sourceName: importedFile.sourceName,
					sourceFormat: importedFile.sourceFormat,
					importedTitle: "SVG imported",
					emptyTitle: "SVG not imported",
					emptyNote:
						"No scene layers or artboards were appended from this SVG.",
				}),
			);
		} catch (error) {
			setImportReport(
				createTopBarImportErrorReport(file.name || "Untitled import", error),
			);
		}
	};
	const openImportPicker = () => importInputRef.current?.click();
	const onImportChange = (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.currentTarget.files?.[0];
		event.currentTarget.value = "";
		if (file) void importFile(file);
	};
	const importProgramSurfacePackage = async (file: File) => {
		setExportReport(null);
		setImportReport(null);
		const fence = captureEditorBindingFence();
		try {
			const result = await readManualProgramSurfacePackage(file);
			const source =
				result.status === "accepted"
					? result.package
					: {
							sourceName: result.sourceName,
							sourceFormat: result.sourceFormat,
						};
			if (!isEditorBindingFenceCurrent(fence)) {
				setImportReport(
					createTopBarProgramSurfacePackageStaleReport({
						sourceName: source.sourceName,
						sourceFormat: source.sourceFormat,
					}),
				);
				return;
			}
			if (result.status === "rejected") {
				setImportReport(
					createTopBarProgramSurfacePackageRejectedReport({
						sourceName: result.sourceName,
						sourceFormat: result.sourceFormat,
						code: result.error.code,
						message: result.error.message,
					}),
				);
				return;
			}
			try {
				setImportReport(placeManualProgramSurfacePackage(result.package));
				if (!useEditorChromeStore.getState().inspectorOpen) {
					useEditorChromeStore.getState().toggleInspectorPanel();
				}
			} catch {
				setImportReport(
					createTopBarProgramSurfacePackageRejectedReport({
						sourceName: result.package.sourceName,
						sourceFormat: result.package.sourceFormat,
						code: "program-surface-placement-failed",
						message:
							"The verified Program Surface could not be placed in the current scene.",
					}),
				);
			}
		} catch {
			const report = createTopBarProgramSurfacePackageRejectedReport({
				sourceName: "Program Surface package",
				sourceFormat: programSurfacePackageMimeType,
				code: "program-surface-package-read-failed",
				message: "The Program Surface package could not be read.",
			});
			if (!isEditorBindingFenceCurrent(fence)) {
				setImportReport(
					createTopBarProgramSurfacePackageStaleReport({
						sourceName: report.sourceName,
						sourceFormat: report.sourceFormat,
					}),
				);
				return;
			}
			setImportReport(report);
		}
	};
	const openProgramSurfacePackagePicker = () =>
		programSurfacePackageInputRef.current?.click();
	const onProgramSurfacePackageChange = (
		event: ChangeEvent<HTMLInputElement>,
	) => {
		const file = event.currentTarget.files?.[0];
		event.currentTarget.value = "";
		if (file) void importProgramSurfacePackage(file);
	};
	const navigateToNewProject = (event: MouseEvent<HTMLAnchorElement>) => {
		if (
			event.button !== 0 ||
			event.metaKey ||
			event.ctrlKey ||
			event.shiftKey ||
			event.altKey
		) {
			return;
		}
		event.preventDefault();
		setCloudMenuOpen(false);
		globalThis.history.pushState(null, "", "/editor?newProject=1");
		globalThis.dispatchEvent(new PopStateEvent("popstate"));
	};
	const CloudTriggerIcon = activeCloudProject ? CloudCheck : CloudArrowUp;
	const cloudTriggerLabel =
		cloudBusyLabel ??
		cloudTriggerActionLabel(
			cloudSaveStatus,
			activeCloudProject,
			cloudSaveFailureReason,
		);
	const cloudLocation = cloudLocationLabel(activeCloudProject);
	const cloudLocationMeta = cloudLocationDetail(activeCloudProject);
	const cloudSaveState = cloudSaveStateLabel(
		cloudSaveStatus,
		activeCloudProject,
		cloudSaveFailureReason,
	);
	const cloudSaveStateMeta = cloudSaveStateDetail(
		cloudSaveStatus,
		activeCloudProject,
		cloudSaveFailureReason,
	);
	const cloudPrimaryLabel = cloudPrimaryActionLabelForAccess(
		cloudSaveStatus,
		activeCloudProject,
		cloudAccountAccess,
		cloudSaveFailureReason,
	);
	const cloudPrimaryDetail = cloudPrimaryActionDetailForAccess(
		cloudSaveStatus,
		activeCloudProject,
		cloudAccountAccess,
		cloudSaveFailureReason,
	);
	const cloudProjectMissing =
		cloudSaveStatus === "failed" &&
		cloudSaveFailureReason === "project-not-found";
	const cloudTriggerTooltip = activeCloudProject
		? cloudProjectMissing
			? `Cloud project unavailable: ${activeCloudProject.name}`
			: `Cloud project: ${activeCloudProject.name}`
		: "Local document. Save as a cloud project";
	const cloudNeedsRecovery =
		cloudSaveStatus === "failed" || cloudSaveStatus === "conflict";
	const cloudAccessChecking = cloudAccountAccess.kind === "checking";
	const cloudAccessBlocksSave =
		cloudAccountAccess.kind === "sign-in-required" ||
		cloudAccountAccess.kind === "creator-required";
	const cloudProjectsVisible = cloudAccountAccess.kind !== "sign-in-required";
	const cloudProjectSaved =
		activeCloudProject !== null && cloudSaveStatus === "saved";
	const cloudPrimarySectionLabel = cloudAccessChecking
		? "Checking"
		: cloudAccessBlocksSave
			? "Account step"
			: cloudProjectMissing
				? "Reconnect"
				: cloudNeedsRecovery
					? "Recovery"
					: cloudProjectSaved
						? "Revision history"
						: "Next action";
	const cloudSummaryTitle = cloudFlowTitle(
		cloudSaveStatus,
		activeCloudProject,
		cloudSaveFailureReason,
	);
	const cloudSummaryDetail = cloudFlowDetail(
		cloudSaveStatus,
		activeCloudProject,
		cloudSaveFailureReason,
	);
	const CloudPrimaryIcon =
		cloudAccessChecking || cloudAccessBlocksSave
			? UserCircle
			: cloudProjectSaved
				? ClockCounterClockwise
				: cloudSaveStatus === "conflict" || cloudProjectMissing
					? CopySimple
					: CloudArrowUp;
	const displayedCloudNotice =
		cloudNotice ??
		(cloudProjectMissing
			? {
					status: "warning" as const,
					title: "Cloud project unavailable",
					detail:
						cloudErrorMessage ??
						"Save as a new cloud project, download a backup, or work locally.",
				}
			: cloudSaveStatus === "failed" && cloudErrorMessage
				? {
						status: "error" as const,
						title: "Cloud save failed",
						detail: cloudErrorMessage,
					}
				: null);
	const runCloudPrimaryAction = () => {
		if (cloudAccountAccess.kind === "checking") return;
		if (cloudAccountAccess.kind === "sign-in-required") {
			setCloudMenuOpen(false);
			setAccountMenuOpen(true);
			return;
		}
		if (cloudAccountAccess.kind === "creator-required") {
			setCloudMenuOpen(false);
			setAccountMenuOpen(true);
			return;
		}
		if (cloudProjectMissing) {
			return saveCurrentCloudProjectAsNewProject();
		}
		if (cloudProjectSaved && activeCloudProject) {
			openVersionHistory();
			return;
		}
		return cloudSaveStatus === "conflict"
			? saveCurrentCloudProjectAsCopy()
			: saveCurrentCloudProject();
	};

	return (
		<TooltipProvider>
			<header className="top-bar grid h-8 min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2">
				<div className="flex w-full min-w-0 items-start gap-1">
					<div className="pointer-events-auto flex h-8 w-8 min-w-8 items-center justify-center gap-1.5 rounded-md border border-white/10 bg-surface-raised/86 px-0 shadow-2xl shadow-black/35 backdrop-blur-xl sm:w-auto sm:min-w-0 sm:max-w-80 sm:flex-1 sm:justify-start sm:px-2">
						<div className="grid size-5 shrink-0 place-items-center rounded border border-warn/45 bg-warn/12">
							<Sparkle
								aria-hidden="true"
								size={12}
								weight="duotone"
								className="text-warn"
							/>
						</div>
						<div className="hidden min-w-0 flex-1 sm:block">
							<p
								className="truncate font-medium text-fg text-ui leading-3"
								title="Vecmo"
							>
								Vecmo
							</p>
							<DocumentTitle onVersionHistory={openVersionHistory} />
						</div>
					</div>
					<Tooltip
						label={commandPaletteShortcutTitle}
						side="bottom"
						align="start"
					>
						<button
							ref={commandTriggerRef}
							type="button"
							data-command-palette-trigger="true"
							aria-label="Actions"
							aria-haspopup="listbox"
							aria-expanded={commandPaletteOpen}
							className="pointer-events-auto grid size-8 place-items-center rounded-md border border-white/10 bg-surface-raised/86 text-fg-secondary shadow-2xl shadow-black/35 backdrop-blur-xl transition hover:border-accent/45 hover:text-accent-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
							onClick={toggleCommandPalette}
						>
							<Command aria-hidden="true" size={15} />
						</button>
					</Tooltip>
					<Tooltip label="Start a new project" side="bottom" align="start">
						<a
							href="/editor?newProject=1"
							aria-label="New project"
							className={topBarNewProjectButtonClass}
							onClick={navigateToNewProject}
						>
							<Plus aria-hidden="true" size={15} weight="bold" />
							<span className="hidden md:inline">New project</span>
						</a>
					</Tooltip>
					{cloudWriterProjectId ? (
						<Tooltip
							label={
								cloudWriterMode === "review"
									? "Review mode · click to take over cloud writing"
									: "Cloud writer ownership for this editor"
							}
							side="bottom"
							align="start"
						>
							<button
								type="button"
								disabled={cloudWriterMode !== "review"}
								className={`pointer-events-auto h-8 rounded-md border px-2 font-medium text-ui shadow-2xl shadow-black/35 backdrop-blur-xl ${
									cloudWriterMode === "writer"
										? "border-accent/35 bg-accent-surface text-accent-fg"
										: "border-warn/35 bg-warn-surface text-warn-fg"
								}`}
								onClick={() => {
									if (!activeCloudProject) return;
									const confirmed = globalThis.confirm(
										`Take over cloud writing for ${activeCloudProject.name} r${activeCloudProject.revision}? The current writer will switch to review mode. This editor is ${cloudSaveStatus === "saved" ? "synced" : "unsaved"}.`,
									);
									if (confirmed) requestCloudWriterTakeover();
								}}
							>
								{cloudWriterMode === "writer"
									? `Writer · r${activeCloudProject?.revision ?? "—"}`
									: cloudWriterMode === "review"
										? `Review r${activeCloudProject?.revision ?? "—"} · Take over`
										: "Claiming writer…"}
							</button>
						</Tooltip>
					) : null}
				</div>

				<div className="pointer-events-auto hidden items-center gap-0.5 justify-self-center rounded-md border border-white/10 bg-surface-raised/86 p-0.5 shadow-2xl shadow-black/35 backdrop-blur-xl xl:flex">
					<IconButton
						icon={Sidebar}
						label={`Side panels (${sidePanelsShortcutLabel})`}
						active={panelsOpen}
						size="compact"
						tooltipSide="bottom"
						onClick={togglePanels}
					/>
					<IconButton
						icon={Stack}
						label={`Layers (${layersPanelShortcutLabel})`}
						active={layersOpen}
						size="compact"
						tooltipSide="bottom"
						onClick={toggleLayersPanel}
					/>
					<IconButton
						icon={SlidersHorizontal}
						label={`Inspector (${inspectorPanelShortcutLabel})`}
						active={inspectorOpen}
						size="compact"
						tooltipSide="bottom"
						onClick={toggleInspectorPanel}
					/>
					<IconButton
						icon={FilmStrip}
						label={`Timeline (${timelineShortcutLabel})`}
						active={timelineOpen}
						size="compact"
						tooltipSide="bottom"
						onClick={toggleTimeline}
					/>
					<IconButton
						icon={Graph}
						label="Look graph workspace"
						active={lookWorkspaceOpen}
						size="compact"
						tooltipSide="bottom"
						onClick={toggleLookWorkspace}
					/>
					{platformCapabilities.copilotServerPlanner ? (
						<IconButton
							icon={Sparkle}
							label="Motion Copilot"
							active={motionCopilotOpen}
							size="compact"
							tooltipSide="bottom"
							onClick={toggleMotionCopilot}
						/>
					) : null}
					<IconButton
						icon={Selection}
						label="Visual review"
						active={visualReviewOpen}
						size="compact"
						tooltipSide="bottom"
						onClick={toggleVisualReview}
					/>
					<IconButton
						icon={Keyboard}
						label="Keyboard shortcuts (?)"
						active={shortcutHelpOpen}
						size="compact"
						tooltipSide="bottom"
						onClick={toggleShortcutHelp}
					/>
					<div className="mx-0.5 h-4 w-px bg-white/10" />
					<IconButton
						icon={ClockCounterClockwise}
						label="Undo"
						disabled={!canUndo}
						size="compact"
						tooltipSide="bottom"
						onClick={globalUndo}
					/>
					<IconButton
						icon={ClockClockwise}
						label="Redo"
						disabled={!canRedo}
						size="compact"
						tooltipSide="bottom"
						onClick={globalRedo}
					/>
					<div className="mx-0.5 h-4 w-px bg-white/10" />
					<IconButton
						icon={Minus}
						label="Zoom out"
						size="compact"
						tooltipSide="bottom"
						onClick={() => zoomStepOut()}
					/>
					<div className="min-w-10 text-center font-mono text-fg-secondary text-ui">
						{Math.round(zoom)}%
					</div>
					<IconButton
						icon={Plus}
						label="Zoom in"
						size="compact"
						tooltipSide="bottom"
						onClick={() => zoomStepIn()}
					/>
					<IconButton
						icon={ArrowsOutSimple}
						label="Fit artboard"
						size="compact"
						tooltipSide="bottom"
						onClick={onFitArtboard}
					/>
				</div>

				<div className="pointer-events-auto relative flex min-w-0 items-center justify-end gap-0.5 justify-self-end">
					<McpBridgeChip />
					{platformCapabilities.account ? (
						<div className="mr-0.5">
							<BillingEntry
								open={accountMenuOpen}
								onOpenChange={setAccountMenuOpen}
							/>
						</div>
					) : null}
					{platformCapabilities.cloudProjects ? (
						<Popover.Root
							open={cloudMenuOpen}
							onOpenChange={(open) => {
								setCloudMenuOpen(open);
							}}
							modal={false}
						>
							<Tooltip
								label={cloudTriggerTooltip}
								side="bottom"
								align="end"
								disabled={cloudBusyLabel !== null}
							>
								<Popover.Trigger
									type="button"
									aria-label="Cloud projects"
									disabled={cloudBusyLabel !== null}
									className={`${topBarActionButtonClass} ${cloudTriggerToneClass(cloudSaveStatus, activeCloudProject)} disabled:cursor-not-allowed disabled:opacity-55`}
								>
									<CloudTriggerIcon aria-hidden="true" size={11} />
									<span className="top-bar-wide-label max-w-24 truncate text-ui leading-none">
										{cloudTriggerLabel}
									</span>
								</Popover.Trigger>
							</Tooltip>
							<Popover.Portal>
								<Popover.Positioner
									className="z-50 outline-none"
									side="bottom"
									align="end"
									sideOffset={6}
									collisionPadding={8}
								>
									<Popover.Popup className={cloudMenuPanelClass}>
										<div className="px-1.5 pb-1">
											<div className="min-w-0">
												<div className="truncate font-medium text-fg text-ui leading-4">
													{cloudSummaryTitle}
												</div>
												<div className="truncate text-fg-muted text-ui leading-3">
													{cloudSummaryDetail}
												</div>
											</div>
										</div>
										{activeCloudProject ? (
											<div className="mx-1 mb-1 grid gap-1 rounded border border-hairline/10 bg-surface-sunken/60 px-1.5 py-1 text-ui leading-3">
												<div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
													<div className="min-w-0">
														<div className="font-medium text-fg">
															{cloudLocation}
														</div>
														<div className="text-fg-muted">
															{cloudLocationMeta}
														</div>
													</div>
													<div
														className={`shrink-0 font-medium ${cloudStatusClass(cloudSaveStatus)}`}
													>
														{cloudSaveState}
													</div>
												</div>
												<div className="text-fg-muted">
													{cloudSaveStateMeta}
												</div>
											</div>
										) : null}
										{!cloudAccessBlocksSave ? (
											<div
												className={`mx-1 mb-1 rounded border bg-surface-sunken/60 px-1.5 py-1 text-ui leading-3 ${cloudAccountAccessClass(cloudAccountAccess.tone)}`}
											>
												<div className="font-medium">
													{cloudAccountAccess.label}
												</div>
												<div className="mt-0.5 text-fg-secondary">
													{cloudAccountAccess.detail}
												</div>
											</div>
										) : null}
										{displayedCloudNotice ? (
											<div
												className={`mx-1 mb-1 rounded border bg-surface-sunken/60 px-1.5 py-1 text-ui leading-3 ${reportToneClass(displayedCloudNotice.status)}`}
											>
												<div className="font-medium">
													{displayedCloudNotice.title}
												</div>
												{displayedCloudNotice.detail ? (
													<div className="mt-0.5 text-fg-secondary">
														{displayedCloudNotice.detail}
													</div>
												) : null}
											</div>
										) : null}
										<div className={cloudSectionLabelClass}>
											{cloudPrimarySectionLabel}
										</div>
										<button
											type="button"
											className={cloudPrimaryItemClass(cloudAccountAccess)}
											disabled={cloudBusyLabel !== null || cloudAccessChecking}
											onClick={() => void runCloudPrimaryAction()}
										>
											<CloudPrimaryIcon
												aria-hidden="true"
												size={13}
												className={cloudPrimaryIconClass(cloudAccountAccess)}
											/>
											<span className="min-w-0">
												<span className="block truncate font-medium text-fg">
													{cloudPrimaryLabel}
												</span>
												<span className="block truncate text-fg-muted">
													{cloudPrimaryDetail}
												</span>
											</span>
										</button>
										{cloudSaveStatus === "conflict" ? (
											<div className="mx-1 mt-1 rounded border border-warn/35 bg-warn-surface/20 p-1 text-ui leading-3">
												<div className="px-0.5 pb-0.5 font-medium text-warn-fg">
													{cloudConflictProject
														? `Revision ${cloudConflictProject.revision} is latest in cloud`
														: "Cloud has a newer revision"}
												</div>
												<button
													type="button"
													className={cloudRecoveryItemClass}
													disabled={!activeCloudProject}
													onClick={() => {
														if (!activeCloudProject) return;
														globalThis.open(
															createEditorOpenUrl({
																projectId: activeCloudProject.id,
															}),
															"_blank",
															"noopener",
														);
													}}
												>
													<FolderOpen
														aria-hidden="true"
														size={13}
														className="text-fg-muted"
													/>
													<span className="min-w-0">
														<span className="block truncate font-medium text-fg">
															Open latest cloud revision
														</span>
														<span className="block truncate text-fg-muted">
															Review before replacing local work
														</span>
													</span>
												</button>
											</div>
										) : null}
										{activeCloudProject && cloudNeedsRecovery ? (
											<button
												type="button"
												className={cloudRecoveryItemClass}
												disabled={cloudBusyLabel !== null}
												onClick={detachCurrentCloudProject}
											>
												<X
													aria-hidden="true"
													size={13}
													className="text-fg-muted"
												/>
												<span className="min-w-0">
													<span className="block truncate font-medium text-fg">
														Work locally
													</span>
													<span className="block truncate text-fg-muted">
														{cloudProjectMissing
															? "Detach stale link; the document stays local"
															: "Detach this tab; the document stays local"}
													</span>
												</span>
											</button>
										) : null}
										{activeCloudProject && cloudWriterMode === "review" ? (
											<button
												type="button"
												className={cloudRecoveryItemClass}
												disabled={cloudBusyLabel !== null}
												onClick={() => void saveCurrentCloudProjectAsCopy()}
											>
												<CopySimple
													aria-hidden="true"
													size={13}
													className="text-fg-muted"
												/>
												<span className="min-w-0">
													<span className="block truncate font-medium text-fg">
														Save as cloud copy
													</span>
													<span className="block truncate text-fg-muted">
														Keep the current writer and fork this editor
													</span>
												</span>
											</button>
										) : null}
										{activeCloudProject && !cloudNeedsRecovery ? (
											<button
												type="button"
												className={cloudRecoveryItemClass}
												disabled={cloudBusyLabel !== null}
												onClick={detachCurrentCloudProject}
											>
												<X
													aria-hidden="true"
													size={13}
													className="text-fg-muted"
												/>
												<span className="min-w-0">
													<span className="block truncate font-medium text-fg">
														Work locally
													</span>
													<span className="block truncate text-fg-muted">
														Detach this tab; the document stays local
													</span>
												</span>
											</button>
										) : null}
										{cloudProjectsVisible ? (
											<>
												<div className={cloudSectionLabelClass}>Projects</div>
												<a
													className={cloudNewProjectItemClass}
													href="/editor?newProject=1"
													onClick={navigateToNewProject}
												>
													<Plus
														aria-hidden="true"
														size={13}
														weight="bold"
														className="text-accent-fg"
													/>
													<span className="min-w-0">
														<span className="block truncate font-medium text-fg">
															New project
														</span>
														<span className="block truncate text-fg-muted">
															Start with a blank editable document
														</span>
													</span>
												</a>
												{activeCloudProject && !cloudProjectSaved ? (
													<button
														type="button"
														className={cloudRecoveryItemClass}
														onClick={openVersionHistory}
													>
														<ClockCounterClockwise
															aria-hidden="true"
															size={13}
															className="text-fg-muted"
														/>
														<span className="min-w-0">
															<span className="block truncate font-medium text-fg">
																Version history
															</span>
															<span className="block truncate text-fg-muted">
																Open or restore saved revisions
															</span>
														</span>
													</button>
												) : null}
												<a
													className={cloudRecoveryItemClass}
													href="/projects"
													onClick={() => setCloudMenuOpen(false)}
												>
													<FolderOpen
														aria-hidden="true"
														size={13}
														className="text-fg-muted"
													/>
													<span className="min-w-0">
														<span className="block truncate font-medium text-fg">
															Open projects
														</span>
														<span className="block truncate text-fg-muted">
															Open, recover, or review version history
														</span>
													</span>
												</a>
											</>
										) : null}
									</Popover.Popup>
								</Popover.Positioner>
							</Popover.Portal>
						</Popover.Root>
					) : null}
					<input
						ref={importInputRef}
						type="file"
						accept=".json,.svg,.ai,.png,.jpg,.jpeg,.webp,.mp4,.m4v,.mov,.webm,.ogv,application/json,image/svg+xml,image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime,video/x-m4v,video/ogg,application/postscript"
						className="sr-only"
						onChange={onImportChange}
					/>
					<input
						ref={programSurfacePackageInputRef}
						type="file"
						accept={programSurfacePackageAccept}
						className="sr-only"
						onChange={onProgramSurfacePackageChange}
					/>
					<fieldset
						aria-label="Artboard scope"
						className="m-0 hidden h-8 min-w-0 items-center rounded-md border border-white/10 bg-surface-raised/86 p-0.5 shadow-2xl shadow-black/35 backdrop-blur-xl sm:inline-flex"
					>
						{TOP_BAR_ARTBOARD_SCOPE_MODES.map((mode) => {
							const active = artboardScopeMode === mode;
							const ScopeIcon = scopeButtonIcon(mode);
							const title = scopeButtonTitle(mode, selectedArtboardIds.length);
							return (
								<Tooltip key={mode} label={title} side="bottom">
									<button
										type="button"
										aria-label={title}
										aria-pressed={active}
										className={`grid size-7 place-items-center rounded text-ui leading-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-white/55 ${
											active
												? "bg-white/14 text-fg"
												: "text-fg-muted hover:bg-white/8 hover:text-fg-secondary"
										}`}
										onClick={() => setArtboardScopeMode(mode)}
									>
										<ScopeIcon aria-hidden="true" size={13} weight="regular" />
									</button>
								</Tooltip>
							);
						})}
					</fieldset>
					<Tooltip
						label="Import SVG / AI / image / video · or restore a .json backup"
						side="bottom"
						align="end"
					>
						<button
							type="button"
							aria-label="Import"
							className={`${topBarActionButtonClass} border-warn/35 bg-warn-surface/92 text-warn-fg hover:bg-warn-surface/95 hover:text-warn-fg focus-visible:outline-warn/60`}
							onClick={openImportPicker}
						>
							<UploadSimple aria-hidden="true" size={12} />
							<span className="top-bar-wide-label max-w-16 truncate text-ui leading-none">
								Import
							</span>
						</button>
					</Tooltip>
					<Tooltip
						label="Import Program Surface package — WebGL2 manifest and bundled snapshot"
						side="bottom"
						align="end"
					>
						<button
							type="button"
							aria-label="Import Program Surface package"
							className={`${topBarActionButtonClass} border-accent/35 bg-accent-surface/92 text-accent-fg hover:bg-accent-surface/95 hover:text-accent-fg focus-visible:outline-accent/60`}
							onClick={openProgramSurfacePackagePicker}
						>
							<Stack aria-hidden="true" size={12} />
							<span className="top-bar-wide-label max-w-16 truncate text-ui leading-none">
								Surface
							</span>
						</button>
					</Tooltip>
					<Tooltip
						label="Save a restorable backup (.json) — scene + motion in one file"
						side="bottom"
						align="end"
					>
						<button
							type="button"
							aria-label="Backup"
							className={`${topBarActionButtonClass} hidden border-white/12 bg-surface-raised/92 text-fg-secondary hover:border-accent/50 hover:bg-surface hover:text-fg focus-visible:outline-accent/60 sm:inline-flex`}
							onClick={saveProjectBackup}
						>
							<FloppyDisk aria-hidden="true" size={12} />
							<span className="top-bar-wide-label max-w-16 truncate text-ui leading-none">
								Backup
							</span>
						</button>
					</Tooltip>
					<Popover.Root
						open={exportMenuOpen}
						onOpenChange={setExportMenuOpen}
						modal={false}
					>
						<Tooltip
							label={exportBusyLabel ?? "Export"}
							side="bottom"
							align="end"
							disabled={exportBusyLabel !== null}
						>
							<Popover.Trigger
								type="button"
								aria-label="Export"
								disabled={exportBusyLabel !== null}
								className={`${topBarActionButtonClass} border-danger/35 bg-danger-surface/92 text-danger-fg hover:bg-danger-surface/95 hover:text-danger-fg focus-visible:outline-danger/60 disabled:cursor-not-allowed disabled:opacity-55`}
							>
								<DownloadSimple aria-hidden="true" size={12} />
								<span className="top-bar-wide-label max-w-16 truncate text-ui leading-none">
									{exportBusyLabel ?? "Export"}
								</span>
							</Popover.Trigger>
						</Tooltip>
						<Popover.Portal>
							<Popover.Positioner
								className="z-50 outline-none"
								side="bottom"
								align="end"
								sideOffset={6}
								collisionPadding={8}
							>
								<Popover.Popup className={exportMenuPanelClass}>
									<button
										type="button"
										className={exportMenuItemClass}
										onClick={() => exportMotionCode("motion-artifact")}
									>
										<Command
											aria-hidden="true"
											size={13}
											className="text-fg-muted"
										/>
										<span className="min-w-0">
											<span className="block truncate font-medium text-fg">
												Motion / Code
											</span>
											<span className="block truncate text-fg-muted">
												{
													exportOptimizationProfileDescription[
														"motion-artifact"
													]
												}
											</span>
										</span>
										<span className="font-mono text-fg-muted">EMBED</span>
									</button>
									<button
										type="button"
										className={exportMenuItemClass}
										onClick={() => exportMotionCode("web-embed")}
									>
										<Command
											aria-hidden="true"
											size={13}
											className="text-fg-muted"
										/>
										<span className="min-w-0">
											<span className="block truncate font-medium text-fg">
												Motion / Code
											</span>
											<span className="block truncate text-fg-muted">
												{exportOptimizationProfileDescription["web-embed"]}
											</span>
										</span>
										<span className="font-mono text-fg-muted">WEB</span>
									</button>
									<button
										type="button"
										className={exportMenuItemClass}
										onClick={exportPdfFrame}
									>
										<FilePdf
											aria-hidden="true"
											size={13}
											className="text-fg-muted"
										/>
										<span className="min-w-0">
											<span className="block truncate font-medium text-fg">
												PDF frame
											</span>
											<span className="block truncate text-fg-muted">
												current frame for the selected scope
											</span>
										</span>
										<span className="font-mono text-fg-muted">PDF</span>
									</button>
									<button
										type="button"
										className={exportMenuItemClass}
										onClick={() => exportMotionCode("production")}
									>
										<Command
											aria-hidden="true"
											size={13}
											className="text-fg-muted"
										/>
										<span className="min-w-0">
											<span className="block truncate font-medium text-fg">
												Motion / Code
											</span>
											<span className="block truncate text-fg-muted">
												{exportOptimizationProfileDescription.production}
											</span>
										</span>
										<span className="font-mono text-fg-muted">PROD</span>
									</button>
									<button
										type="button"
										className={exportMenuItemClass}
										onClick={() => exportMotionCode("editable")}
									>
										<Command
											aria-hidden="true"
											size={13}
											className="text-fg-muted"
										/>
										<span className="min-w-0">
											<span className="block truncate font-medium text-fg">
												Motion / Code
											</span>
											<span className="block truncate text-fg-muted">
												{exportOptimizationProfileDescription.editable}
											</span>
										</span>
										<span className="font-mono text-fg-muted">FULL</span>
									</button>
									<button
										type="button"
										className={exportMenuItemClass}
										disabled={exportBusyLabel !== null}
										onClick={() => void exportVideoWebm()}
									>
										<Timer
											aria-hidden="true"
											size={13}
											className="text-fg-muted"
										/>
										<span className="min-w-0">
											<span className="block truncate font-medium text-fg">
												Video WebM
											</span>
											<span className="block truncate text-fg-muted">
												full timeline WebM
											</span>
										</span>
										<span className="font-mono text-fg-muted">WEBM</span>
									</button>
									<button
										type="button"
										className={exportMenuItemClass}
										disabled={selectedNodeIds.length === 0}
										onClick={exportIndividualVectors}
									>
										<Selection
											aria-hidden="true"
											size={13}
											className="text-fg-muted"
										/>
										<span className="min-w-0">
											<span className="block truncate font-medium text-fg">
												Vectors SVG
											</span>
											<span className="block truncate text-fg-muted">
												{selectedNodeIds.length} selected objects
											</span>
										</span>
										<span className="font-mono text-fg-muted">SVG</span>
									</button>
									<button
										type="button"
										className={exportMenuItemClass}
										onClick={exportLookDctl}
									>
										<FileCode
											aria-hidden="true"
											size={13}
											className="text-fg-muted"
										/>
										<span className="min-w-0">
											<span className="block truncate font-medium text-fg">
												Look DCTL
											</span>
											<span className="block truncate text-fg-muted">
												current frame Look graph for DaVinci Resolve
											</span>
										</span>
										<span className="font-mono text-fg-muted">DCTL</span>
									</button>
									<label className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-fg-muted text-ui leading-3">
										<input
											type="checkbox"
											checked={dctlExposeAllParams}
											onChange={(event) =>
												setDctlExposeAllParams(event.target.checked)
											}
										/>
										<span>DCTL: expose all numeric parameters</span>
									</label>
								</Popover.Popup>
							</Popover.Positioner>
						</Popover.Portal>
					</Popover.Root>
					{importReport ? (
						<ImportReportCard
							report={importReport}
							onClose={() => setImportReport(null)}
						/>
					) : null}
					{exportReport ? (
						<ExportReportCard
							report={exportReport}
							onClose={() => setExportReport(null)}
						/>
					) : null}
				</div>
			</header>
			{platformCapabilities.cloudProjects && versionHistoryOpen ? (
				<VersionHistoryDrawer
					busyKey={versionHistoryBusyKey}
					notice={versionHistoryNotice}
					project={activeCloudProject}
					saveStatus={cloudSaveStatus}
					state={versionHistoryState}
					pendingRestore={pendingVersionRestore}
					onClose={() => {
						setVersionHistoryOpen(false);
						setPendingVersionRestore(null);
					}}
					onDownload={downloadVersionHistoryRevision}
					onOpenRevision={openVersionHistoryRevision}
					onRefresh={loadVersionHistory}
					onRestoreCancel={() => setPendingVersionRestore(null)}
					onRestoreConfirm={restoreVersionHistoryRevision}
					onRestoreRequest={setPendingVersionRestore}
				/>
			) : null}
		</TooltipProvider>
	);
}
