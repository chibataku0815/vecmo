import type { MotionPresentationIssue } from "@/entities/motion/model/presentation";
import type { MotionGrammarBinding } from "@/entities/motion-grammar/model/types";
import type { ProjectAuthoringOutputReport } from "@/features/export/model/authoring-output-report";
import type {
	ExportBundle,
	ExportBundleAsset,
	ExportFrameRangeManifest,
	ExportManifestAssetEntry,
} from "@/features/export/model/bundle";
import {
	componentPropsExportResultFromBundle,
	interactionsExportResultFromBundle,
} from "@/features/export/model/code";
import type { ComponentPropExportIssue } from "@/features/export/model/component-props-export";
import type { FramePackageDeliveryReport } from "@/features/export/model/frame-package-delivery";
import { interactionHasNodeTrigger } from "@/features/export/model/interactions-export";
import {
	type ExportIssue,
	type ExportIssueAffectedTarget,
	type ExportIssueGroup,
	type ExportReportIssueSummary as ModelExportReportIssueSummary,
	summarizeExportReportIssues,
} from "@/features/export/model/issues";
import type {
	LookDctlFidelity,
	LookDctlReport,
} from "@/features/export/model/look-dctl";
import type {
	ExportOptimizationOptions,
	ExportOptimizationProfile,
	ExportRuntimePackaging,
} from "@/features/export/model/optimization";
import type {
	VecCoreRecipeBundleManifest,
	VecCoreRecipeIssueCode,
	VecCoreRecipePayloadManifestEntry,
} from "@/features/export/model/vec-core";
import {
	VEC_CORE_RECIPE_PAYLOAD_ASSET_ROLE,
	VEC_CORE_RECIPE_SVG_APPROXIMATED_ISSUE_CODE,
} from "@/features/export/model/vec-core";

export type ExportReportStatus = "success" | "warning" | "error";

export type ExportReportAssetRole =
	| ExportManifestAssetEntry["role"]
	| "artboard-scope"
	| "motion-presentation"
	| "scene-camera"
	| "runtime-code"
	| "video-file"
	| "individual-vector"
	| "component-props"
	| "interactions"
	| "look-dctl";

export type ExportReportAssetKind =
	| ExportBundleAsset["kind"]
	| "runtime-js"
	| "runtime-shared-js"
	| "runtime-data-json"
	| "runtime-html"
	| "runtime-react"
	| "runtime-types"
	| "runtime-manifest-json"
	| "scene-camera"
	| "webgl-runtime-js"
	| "webgl-shared-runtime-js"
	| "webgl-data-json"
	| "webgl-runtime-html"
	| "webgl-runtime-react"
	| "video-webm"
	| "component-props"
	| "interactions"
	| "dctl";

export type ExportReportAsset = {
	readonly kind: ExportReportAssetKind;
	readonly fileName: string;
	readonly role: ExportReportAssetRole;
	readonly byteLength?: number;
	readonly issueCount: number;
	readonly issueCodes: readonly string[];
	readonly vecCore?: VecCoreRecipePayloadManifestEntry;
};

export type ExportReportArtboardScope = {
	readonly mode: ExportBundle["artboards"]["scope"];
	readonly requestedCount: number;
	readonly availableCount: number;
	readonly exportedCount: number;
	readonly issueCount: number;
	readonly currentArtboardId: string;
	readonly primaryArtboardId: string;
	readonly exportedArtboardNames: readonly string[];
};

export type ExportReportIssue = {
	readonly severity:
		| ExportIssue["severity"]
		| MotionPresentationIssue["severity"];
	readonly category: ExportIssue["category"] | "motion";
	readonly code: string;
	readonly message: string;
	readonly assetFileName: string;
	readonly assetKind:
		| ExportReportAssetKind
		| "motion-presentation"
		| "artboard-scope";
	readonly assetRole: ExportReportAssetRole;
	/** Component-prop name this issue is about, when `assetKind === "component-props"`. */
	readonly componentPropName?: string;
	/** Interaction id this issue is about, when `assetKind === "interactions"`. */
	readonly interactionId?: string;
	readonly fallback?: ExportIssue["fallback"];
	readonly artboardId?: string;
	readonly layerId?: string;
	readonly nodeId?: string;
	readonly assetId?: string;
	readonly requestedArtboardId?: string;
	readonly trackId?: string;
	readonly sourcePaths?: readonly string[];
};

export type ExportReportIssueSummary = Omit<
	ModelExportReportIssueSummary,
	"assetRoles"
> & {
	readonly assetRoles: readonly ExportReportAssetRole[];
};

export type ExportReportFidelityCategory =
	| "preserved"
	| "approximated"
	| "rasterized"
	| "unsupported";

export type ExportReportFidelityOutcome = {
	readonly category: ExportReportFidelityCategory;
	readonly label: string;
	readonly count: number;
	readonly title: string;
};

export type ExportReportFidelity = {
	readonly preservedAssetCount: number;
	readonly approximatedIssueCount: number;
	readonly rasterizedIssueCount: number;
	readonly unsupportedIssueCount: number;
	readonly fallbackIssueCount: number;
	readonly outcomes: readonly ExportReportFidelityOutcome[];
};

export type ExportReportAffectedTargetCounts = Readonly<
	Record<ExportIssueAffectedTarget["kind"], number>
>;

export const EXPORT_REPORT_SOURCE_PATH_MAX_LENGTH = 28;

export type ExportReportOptimization = {
	readonly profile: ExportOptimizationProfile;
	readonly runtimePackaging: ExportRuntimePackaging;
	readonly beforeBytes: number;
	readonly afterBytes: number;
	readonly savedBytes: number;
	readonly savedRatio: number;
};

export type ExportReportModel = {
	readonly status: ExportReportStatus;
	readonly title: string;
	readonly targetLabel: string;
	readonly frame: number;
	readonly frameRange: ExportFrameRangeManifest;
	readonly artboardScope: ExportReportArtboardScope;
	readonly assetCount: number;
	readonly issueCount: number;
	readonly motionIssueCount: number;
	readonly vecCoreIssueCount: number;
	readonly assets: readonly ExportReportAsset[];
	readonly vecCore: VecCoreRecipeBundleManifest | null;
	readonly issues: readonly ExportReportIssue[];
	readonly issueSummary: ExportReportIssueSummary;
	readonly issueGroups: readonly ExportIssueGroup[];
	readonly fidelity: ExportReportFidelity;
	readonly fallbackTypes: readonly ExportIssue["fallback"][];
	readonly affectedTargets: readonly ExportIssueAffectedTarget[];
	readonly affectedTargetCounts: ExportReportAffectedTargetCounts;
	readonly affectedSourcePaths: readonly string[];
	readonly affectedNodeIds: readonly string[];
	readonly affectedAssetIds: readonly string[];
	readonly affectedArtboardIds: readonly string[];
	readonly assetRoles: readonly ExportReportAssetRole[];
	readonly optimization?: ExportReportOptimization;
	readonly authoringOutput?: ProjectAuthoringOutputReport;
	/**
	 * S4-D: what the capture delivered out of a rendered Blender frame package,
	 * and whether it may be called exact. Absent for every export that composed
	 * no frame package, which is what keeps the exact claim scoped to the one
	 * delivery that can actually make it.
	 */
	readonly framePackageDeliveries?: readonly FramePackageDeliveryReport[];
};

export type CreateStandaloneExportReportInput = {
	readonly title: string;
	readonly targetLabel: string;
	readonly frame: number;
	readonly frameRange: ExportFrameRangeManifest;
	readonly artboardScope: ExportReportArtboardScope;
	readonly assets: readonly ExportReportAsset[];
	readonly issues?: readonly ExportReportIssue[];
	readonly optimization?: ExportReportOptimization;
	readonly authoringOutput?: ProjectAuthoringOutputReport;
	readonly framePackageDeliveries?: readonly FramePackageDeliveryReport[];
};

type IssueBearingExportAsset = ExportBundleAsset & {
	readonly issues: readonly ExportIssue[];
};

const hasExportIssues = (
	asset: ExportBundleAsset,
): asset is IssueBearingExportAsset =>
	"issues" in asset &&
	Array.isArray((asset as { readonly issues?: unknown }).issues);

const issuesForAsset = (asset: ExportBundleAsset): readonly ExportIssue[] =>
	hasExportIssues(asset) ? asset.issues : [];

const sortedUnique = (
	values: readonly (string | undefined)[],
): readonly string[] =>
	[
		...new Set(values.filter((value): value is string => Boolean(value))),
	].sort();

/**
 * Shortens imported source locators for the compact TopBar report while keeping
 * the semantic root and leaf visible. The full path remains available to UI
 * callers through `title`, so this never replaces the source of truth.
 */
export function compactExportReportSourcePath(
	path: string,
	maxLength = EXPORT_REPORT_SOURCE_PATH_MAX_LENGTH,
): string {
	if (path.length <= maxLength) return path;
	const parts = path.split("/").filter(Boolean);
	if (parts.length >= 2) return `/${parts[0]}/.../${parts.at(-1)}`;
	const headLength = Math.max(8, Math.floor((maxLength - 3) / 2));
	const tailLength = Math.max(8, maxLength - headLength - 3);
	return `${path.slice(0, headLength)}...${path.slice(-tailLength)}`;
}

const affectedTargetKinds = [
	"artboard",
	"asset",
	"layer",
	"node",
	"requested-artboard",
	"source",
	"track",
] as const satisfies readonly ExportIssueAffectedTarget["kind"][];

const countAffectedTargetsByKind = (
	targets: readonly ExportIssueAffectedTarget[],
): ExportReportAffectedTargetCounts => {
	const counts = Object.fromEntries(
		affectedTargetKinds.map((kind) => [kind, 0]),
	) as Record<ExportIssueAffectedTarget["kind"], number>;
	for (const target of targets) counts[target.kind] += 1;
	return counts;
};

const issueCategoryCount = (
	summary: ExportReportIssueSummary,
	category: ExportIssue["category"],
): number =>
	summary.byCategory.find((entry) => entry.category === category)?.count ?? 0;

const createExportReportFidelity = (
	assets: readonly ExportReportAsset[],
	issueSummary: ExportReportIssueSummary,
): ExportReportFidelity => {
	const preservedAssetCount = assets.filter(
		(asset) => asset.issueCount === 0,
	).length;
	const approximatedIssueCount = issueCategoryCount(
		issueSummary,
		"approximated",
	);
	const rasterizedIssueCount = issueCategoryCount(issueSummary, "rasterized");
	const unsupportedIssueCount = issueCategoryCount(issueSummary, "unsupported");
	const fallbackIssueCount = issueCategoryCount(issueSummary, "fallback");

	return {
		preservedAssetCount,
		approximatedIssueCount,
		rasterizedIssueCount,
		unsupportedIssueCount,
		fallbackIssueCount,
		outcomes: [
			{
				category: "preserved",
				label: "kept",
				count: preservedAssetCount,
				title: "Bundle assets without reportable fidelity issues.",
			},
			{
				category: "approximated",
				label: "approx",
				count: approximatedIssueCount,
				title: "Vector features preserved with deterministic approximations.",
			},
			{
				category: "rasterized",
				label: "raster",
				count: rasterizedIssueCount,
				title: "Vector or paint features emitted through bitmap fallback.",
			},
			{
				category: "unsupported",
				label: "unsup",
				count: unsupportedIssueCount,
				title: "Features not represented by the selected export format.",
			},
		],
	};
};

const roleForReportAssetKind = (
	kind: ExportBundleAsset["kind"],
): ExportManifestAssetEntry["role"] => {
	switch (kind) {
		case "manifest-json":
			return "bundle-manifest";
		case "scene-json":
			return "scene-document";
		case "motion-json":
			return "motion-document";
		case "recipe-json":
			return "vec-core-recipe-payload";
		case "svg":
			return "frame-svg";
		case "pdf":
			return "frame-pdf";
		case "animation-sequence-json":
			return "animation-sequence-json";
		case "animation-sequence-svg":
			return "animation-sequence-svg";
		case "raster-intent-json":
			return "raster-intent";
	}
};

const motionIssuesForBundle = (
	bundle: ExportBundle,
): readonly ExportReportIssue[] =>
	bundle.motionPresentation.currentFrame.issues.map((issue) => ({
		severity: issue.severity,
		category: "motion",
		code: issue.code,
		message: issue.message,
		assetFileName: "motion presentation",
		assetKind: "motion-presentation",
		assetRole: "motion-presentation",
		nodeId: issue.nodeId,
		trackId: issue.trackId,
	}));

const artboardIssuesForBundle = (
	bundle: ExportBundle,
): readonly ExportReportIssue[] =>
	bundle.artboards.issues.map((issue) => ({
		...issue,
		assetFileName: "artboard scope",
		assetKind: "artboard-scope",
		assetRole: "artboard-scope",
	}));

const sceneCameraIssuesForBundle = (
	bundle: ExportBundle,
): readonly ExportReportIssue[] =>
	bundle.sceneCamera.issues.map((issue) => ({
		severity: issue.severity,
		category: issue.category,
		code: issue.code,
		message: issue.message,
		assetFileName: "scene camera projection",
		assetKind: "scene-camera",
		assetRole: "scene-camera",
		...(issue.artboardId ? { artboardId: issue.artboardId } : {}),
		...(issue.nodeId ? { nodeId: issue.nodeId } : {}),
	}));

const categoryForVecCoreIssueCode = (
	code: VecCoreRecipeIssueCode,
): ExportIssue["category"] =>
	code === VEC_CORE_RECIPE_SVG_APPROXIMATED_ISSUE_CODE
		? "approximated"
		: "unsupported";

const vecCoreReportIssueCodes = (
	payload: VecCoreRecipePayloadManifestEntry,
): readonly VecCoreRecipeIssueCode[] =>
	payload.activeFrameIntentCount > 0 ? payload.issueCodes : [];

const vecCoreIssuesForBundle = (
	bundle: ExportBundle,
): readonly ExportReportIssue[] =>
	(bundle.vecCore?.payloads ?? []).flatMap((payload) =>
		vecCoreReportIssueCodes(payload).map((code) => ({
			severity: "warning",
			category: categoryForVecCoreIssueCode(code),
			code,
			message: `Frame-level vec-core intent in ${payload.fileName} is portable high-fidelity payload; local SVG/PDF export reports ${code}.`,
			assetFileName: payload.fileName,
			assetKind: "recipe-json",
			assetRole: VEC_CORE_RECIPE_PAYLOAD_ASSET_ROLE,
			fallback: "normalized-value",
			artboardId: payload.artboardId,
		})),
	);

const LOOK_DCTL_ASSET_ROLE = "look-dctl" as const;
const LOOK_DCTL_ASSET_KIND = "dctl" as const;
/** Every `dctl-*` reason/note carries a leading `code: explanation` shape (see `look-dctl/lower.ts`'s document notes and every emitter's fidelity reason string); falls back to a generic code for the rare case a reason has no colon. */
const LOOK_DCTL_GENERIC_ISSUE_CODE = "dctl-fidelity-note";
const LOOK_DCTL_TAP_BUDGET_CODE = "dctl-tap-budget-summary";

const lookDctlIssueCode = (text: string): string => {
	const colonIndex = text.indexOf(":");
	if (colonIndex <= 0) return LOOK_DCTL_GENERIC_ISSUE_CODE;
	const code = text.slice(0, colonIndex).trim();
	return code.length > 0 ? code : LOOK_DCTL_GENERIC_ISSUE_CODE;
};

const lookDctlNodeIssue = (
	fidelity: LookDctlFidelity,
	fileName: string,
): ExportReportIssue | null => {
	if (fidelity.status === "exact") return null;
	return {
		severity: "warning",
		category:
			fidelity.status === "unsupported" ? "unsupported" : "approximated",
		code: lookDctlIssueCode(fidelity.reason),
		message: `${fidelity.kind} (${fidelity.nodeId}): ${fidelity.reason}`,
		assetFileName: fileName,
		assetKind: LOOK_DCTL_ASSET_KIND,
		assetRole: LOOK_DCTL_ASSET_ROLE,
		fallback: "normalized-value",
		nodeId: fidelity.nodeId,
	};
};

const lookDctlNoteIssue = (
	note: string,
	fileName: string,
): ExportReportIssue => ({
	severity: "info",
	category: "normalized",
	code: lookDctlIssueCode(note),
	message: note,
	assetFileName: fileName,
	assetKind: LOOK_DCTL_ASSET_KIND,
	assetRole: LOOK_DCTL_ASSET_ROLE,
	fallback: "normalized-value",
});

/**
 * Maps a `LookDctlReport` (per-node exact/approx/unsupported fidelity, the
 * always/conditionally-present document notes, and the S3 tap-budget guard's
 * summary) into the same typed `ExportReportIssue` shape every other export
 * format's fidelity degradations use, so the DCTL export surfaces through the
 * existing `ExportReportCard` UI (`TopBar.tsx`'s `exportReport` state) rather
 * than a bespoke panel. Only non-`exact` nodes produce a row — matching every
 * other export's "clean assets carry zero issues" convention — while document
 * notes and the tap-budget summary always appear, since they are export-wide
 * facts the plan's fidelity contract requires staying visible (never silent).
 */
export const lookDctlIssuesForReport = (
	report: LookDctlReport,
	fileName: string,
): readonly ExportReportIssue[] => [
	...report.nodes
		.map((fidelity) => lookDctlNodeIssue(fidelity, fileName))
		.filter((issue): issue is ExportReportIssue => issue !== null),
	...report.notes.map((note) => lookDctlNoteIssue(note, fileName)),
	{
		severity:
			report.tapBudget.worstCaseProduct >= report.tapBudget.budget
				? "warning"
				: "info",
		category: "normalized",
		code: LOOK_DCTL_TAP_BUDGET_CODE,
		message: `Tap-budget guard: worst-case ${report.tapBudget.worstCaseProduct} of ${report.tapBudget.budget} taps used (gather nodes multiply upstream chain evaluations; over-budget nodes degrade instead of failing the export).`,
		assetFileName: fileName,
		assetKind: LOOK_DCTL_ASSET_KIND,
		assetRole: LOOK_DCTL_ASSET_ROLE,
		fallback: "normalized-value",
	},
];

const COMPONENT_PROPS_ASSET_ROLE = "component-props" as const;
const COMPONENT_PROPS_ASSET_KIND = "component-props" as const;
const COMPONENT_PROPS_ASSET_FILE_NAME = "component props";

const componentPropDropIssueMessage = (
	issue: ComponentPropExportIssue,
): string => {
	if (issue.reason === "node-pruned") {
		return `Component prop "${issue.propName}" targets node "${issue.binding.nodeId}", which this export profile excludes (hidden layer or unreachable node); the prop will have no runtime effect.`;
	}
	if (issue.reason === "animated-conflict") {
		return `Component prop "${issue.propName}" targets node "${issue.binding.nodeId}", which already has a keyframe track on the same property; the track's sampled value would override this prop every frame, so the binding is dropped from this export. Remove the keyframe track or the binding to resolve the conflict.`;
	}
	if (issue.reason === "ownership-conflict") {
		return issue.binding.kind === "bindable"
			? `Component prop "${issue.propName}" targets a Rotation/Opacity address on node "${issue.binding.nodeId}" that has another driver; the shared value is dropped because runtime write order cannot define ownership safely.`
			: `Component prop "${issue.propName}" shares the same paint slot on node "${issue.binding.nodeId}" with another owner; both drivers are dropped because runtime write order cannot define ownership safely.`;
	}
	if (issue.reason === "color-default-invalid") {
		return `Component prop "${issue.propName}" has a color default outside the supported hex contract; the shared color is dropped until its default is repaired.`;
	}
	if (issue.reason === "default-pixel-mismatch") {
		return `Component prop "${issue.propName}" has a stored value on node "${issue.binding.nodeId}" that does not match its default; the shared driver is dropped until the default is reapplied to every target.`;
	}
	if (issue.reason === "color-prop-peer-unsupported") {
		return `Component prop "${issue.propName}" has another color binding that this export cannot preserve; this otherwise valid binding on node "${issue.binding.nodeId}" is also dropped so a shared color never recolors only part of its visual system.`;
	}
	if (issue.reason === "number-contract-invalid") {
		return `Component prop "${issue.propName}" does not satisfy the native Rotation/Opacity value and range contract; the complete shared value is dropped.`;
	}
	if (issue.reason === "number-prop-peer-unsupported") {
		return `Component prop "${issue.propName}" has another number binding this export cannot preserve; this otherwise valid binding on node "${issue.binding.nodeId}" is also dropped so a shared value never updates only part of its target set.`;
	}
	return `Component prop "${issue.propName}" targets a binding this standalone runtime cannot apply yet (${issue.binding.kind === "bindable" ? `bindable property "${issue.binding.propertyId}"` : issue.binding.kind === "style-color" ? "a non-solid paint slot" : "a non-text node"}); the prop will have no runtime effect.`;
};

const componentPropDropIssueCode = (
	issue: ComponentPropExportIssue,
): string => {
	if (issue.reason === "node-pruned") return "component-prop-target-pruned";
	if (issue.reason === "animated-conflict") {
		return "component-prop-binding-animated";
	}
	if (issue.reason === "ownership-conflict") {
		return "component-prop-binding-ownership";
	}
	if (issue.reason === "color-default-invalid") {
		return "component-prop-color-default-invalid";
	}
	if (issue.reason === "default-pixel-mismatch") {
		return issue.binding.kind === "bindable"
			? "component-prop-number-default-mismatch"
			: "component-prop-color-default-mismatch";
	}
	if (issue.reason === "color-prop-peer-unsupported") {
		return "component-prop-color-atomic-drop";
	}
	if (issue.reason === "number-contract-invalid") {
		return "component-prop-number-contract-invalid";
	}
	if (issue.reason === "number-prop-peer-unsupported") {
		return "component-prop-number-atomic-drop";
	}
	return "component-prop-runtime-unsupported";
};

/**
 * Typed export-report rows for the document's `componentProps` library: one
 * row per binding the export-time applier compiler dropped (see
 * `component-props-export.ts`'s `ComponentPropExportIssue`). Reuses
 * `componentPropsExportResultFromBundle` (the SAME projection
 * `createMotionCodeReactAsset`/`createMotionCodeRuntimeAsset` use) so this
 * report can never diverge from what the shipped payload/appliers actually
 * contain.
 *
 * The WebGL player (slice 3, `webgl-player-runtime.ts`) now applies the SAME
 * compiled applier instructions as the motion/code SVG runtime, so a route
 * through the WebGL player no longer needs a separate blanket "not supported
 * there" row — `result.issues` (compiled once, independent of which runtime
 * family will consume the payload) already reports every binding that is
 * genuinely unsupported in BOTH runtime families (an `effect-capability`-
 * sourced `bindable`, a non-solid paint slot, or a non-text `text-content`
 * target — see `component-props-export.ts`'s JSDoc), and no others.
 * `needsWebglPlayer` is intentionally no longer a parameter here.
 */
export const componentPropsIssuesForExport = ({
	bundle,
	options,
	grammarBindings,
}: {
	readonly bundle: ExportBundle;
	readonly options: ExportOptimizationOptions;
	readonly grammarBindings?: readonly MotionGrammarBinding[];
}): readonly ExportReportIssue[] => {
	const result = componentPropsExportResultFromBundle(
		bundle,
		options,
		grammarBindings,
	);
	if (result.schema.length === 0) return [];
	return result.issues.map((issue) => ({
		severity: "warning",
		category: "unsupported",
		code: componentPropDropIssueCode(issue),
		message: componentPropDropIssueMessage(issue),
		assetFileName: COMPONENT_PROPS_ASSET_FILE_NAME,
		assetKind: COMPONENT_PROPS_ASSET_KIND,
		assetRole: COMPONENT_PROPS_ASSET_ROLE,
		fallback: "normalized-value",
		nodeId: issue.binding.nodeId,
		componentPropName: issue.propName,
	}));
};

const INTERACTIONS_ASSET_ROLE = "interactions" as const;
const INTERACTIONS_ASSET_KIND = "interactions" as const;
const INTERACTIONS_ASSET_FILE_NAME = "interactions";

const interactionCodeSeverity: ExportIssue["severity"] = "warning";
const interactionCodeCategory: ExportIssue["category"] = "unsupported";

/**
 * Typed export-report rows for the document's `interactions` library: one
 * row per interaction/action the export-time gate dropped (see
 * `interactions-export.ts`'s `InteractionExportIssue`), reusing
 * `interactionsExportResultFromBundle` (the SAME projection
 * `createMotionCodeRuntimeAsset` uses) so this report can never diverge from
 * what the shipped payload actually carries. `InteractionExportIssue`
 * already carries a human-readable `message`, so this only re-shapes it into
 * `ExportReportIssue`'s fields rather than re-deriving the wording (unlike
 * `componentPropDropIssueMessage`, which builds messages from a plainer
 * `ComponentPropExportIssue`).
 */
export const interactionsIssuesForExport = ({
	bundle,
	options,
}: {
	readonly bundle: ExportBundle;
	readonly options: ExportOptimizationOptions;
}): readonly ExportReportIssue[] => {
	const result = interactionsExportResultFromBundle(bundle, options);
	return result.issues.map((issue) => ({
		severity: interactionCodeSeverity,
		category: interactionCodeCategory,
		code: issue.code,
		message: issue.message,
		assetFileName: INTERACTIONS_ASSET_FILE_NAME,
		assetKind: INTERACTIONS_ASSET_KIND,
		assetRole: INTERACTIONS_ASSET_ROLE,
		fallback: "normalized-value",
		...(issue.nodeId ? { nodeId: issue.nodeId } : {}),
		interactionId: issue.interactionId,
	}));
};

/**
 * Honest-degrade report row for a runtime family/interaction combination this
 * program does not execute: the sequence player never wires interactions at
 * all (`createVectorMotionSequencePlayer`'s global-frame model spans multiple
 * artboards, which conflicts with a clip window addressed in one artboard's
 * local frame space — see `code.ts`'s `installInteractionWiring` comment),
 * blanket per export; the WebGL player (Interactive Motion T3-S3) wires every
 * COMPONENT-LEVEL interaction natively and only degrades per NODE-SCOPED one
 * (see `interactions-export.ts`'s `interactionHasNodeTrigger` JSDoc), so its
 * degrade row carries `interactionId`/`nodeId` and fires once per excluded
 * interaction rather than once per export.
 */
const unsupportedRuntimeInteractionIssue = (
	code:
		| "interaction-node-trigger-webgl-unsupported"
		| "interaction-sequence-unsupported",
	message: string,
	target?: { readonly interactionId: string; readonly nodeId?: string },
): ExportReportIssue => ({
	severity: interactionCodeSeverity,
	category: interactionCodeCategory,
	code,
	message,
	assetFileName: INTERACTIONS_ASSET_FILE_NAME,
	assetKind: INTERACTIONS_ASSET_KIND,
	assetRole: INTERACTIONS_ASSET_ROLE,
	fallback: "normalized-value",
	...(target?.interactionId ? { interactionId: target.interactionId } : {}),
	...(target?.nodeId ? { nodeId: target.nodeId } : {}),
});

/**
 * Builds the "this export carries interactions but the selected runtime
 * cannot execute them" degrade row(s) alongside the ordinary drop issues
 * from `interactionsIssuesForExport`. `needsWebglPlayer`/`hasSceneSequence`
 * mirror the SAME flags `TopBar.tsx`'s `exportMotionCode` already computes to
 * choose which asset builder to call, so this can never disagree with which
 * runtime the export actually shipped.
 *
 * `needsWebglPlayer` no longer produces one blanket row (Interactive Motion
 * T3-S3 wired the WebGL player's `createVectorMotionWebglPlayer` — see
 * `webgl-player-runtime.ts` — to execute every COMPONENT-LEVEL surviving
 * interaction natively, the SAME `createInteractionEngine` the SVG runtime
 * uses): it now reports exactly the NODE-SCOPED surviving interactions
 * (`interactionHasNodeTrigger`), the ones `webgl-player.ts`'s
 * `createWebglPlayerRuntimePayload` excludes from the WebGL payload because a
 * canvas has no per-node DOM element to ever fire that trigger — one issue
 * row per excluded interaction, not one row per export.
 */
export const interactionsRuntimeUnsupportedIssuesForExport = ({
	bundle,
	options,
	needsWebglPlayer,
	hasSceneSequence,
}: {
	readonly bundle: ExportBundle;
	readonly options: ExportOptimizationOptions;
	readonly needsWebglPlayer: boolean;
	readonly hasSceneSequence: boolean;
}): readonly ExportReportIssue[] => {
	if (!needsWebglPlayer && !hasSceneSequence) return [];
	const result = interactionsExportResultFromBundle(bundle, options);
	if (result.interactions.length === 0) return [];
	const issues: ExportReportIssue[] = [];
	if (needsWebglPlayer) {
		const nodeTriggerInteractions = result.interactions.filter(
			interactionHasNodeTrigger,
		);
		for (const interaction of nodeTriggerInteractions) {
			issues.push(
				unsupportedRuntimeInteractionIssue(
					"interaction-node-trigger-webgl-unsupported",
					`Interaction "${interaction.name ?? interaction.id}"'s trigger targets node "${interaction.trigger.nodeId}", but the WebGL player runtime has no per-node DOM element to fire a node-scoped trigger from (it mounts one canvas); this interaction is excluded from the WebGL export and will have no effect.`,
					{ interactionId: interaction.id, nodeId: interaction.trigger.nodeId },
				),
			);
		}
	}
	if (hasSceneSequence) {
		issues.push(
			unsupportedRuntimeInteractionIssue(
				"interaction-sequence-unsupported",
				`This export carries ${result.interactions.length} interaction(s), but the scene-sequence player runtime does not execute interactions yet (its multi-artboard global-frame model conflicts with a clip window addressed in one artboard's local frame space); triggers/actions will have no effect in this export.`,
			),
		);
	}
	return issues;
};

const statusForIssues = (
	issues: readonly ExportReportIssue[],
): ExportReportStatus => {
	if (issues.some((issue) => issue.severity === "error")) return "error";
	if (issues.length > 0) return "warning";
	return "success";
};

/**
 * Converts a deterministic export bundle into a compact UI report. The report
 * reads typed fidelity issues directly from issue-bearing assets, avoiding a
 * second parse of the manifest JSON while still matching the downloaded bundle
 * contents.
 */
export function createExportReport(bundle: ExportBundle): ExportReportModel {
	const assetIssues = bundle.assets.flatMap((asset) =>
		issuesForAsset(asset).map((issue) => ({
			...issue,
			assetFileName: asset.fileName,
			assetKind: asset.kind,
			assetRole: roleForReportAssetKind(asset.kind),
			...(asset.artboard ? { artboardId: asset.artboard.id } : {}),
		})),
	);
	const motionIssues = motionIssuesForBundle(bundle);
	const artboardIssues = artboardIssuesForBundle(bundle);
	const sceneCameraIssues = sceneCameraIssuesForBundle(bundle);
	const vecCoreIssues = vecCoreIssuesForBundle(bundle);
	const issues = [
		...assetIssues,
		...motionIssues,
		...artboardIssues,
		...sceneCameraIssues,
		...vecCoreIssues,
	];
	const vecCorePayloadByFileName = new Map(
		(bundle.vecCore?.payloads ?? []).map(
			(payload) => [payload.fileName, payload] as const,
		),
	);
	const modelIssueSummary = summarizeExportReportIssues(issues);
	const issueSummary = {
		...modelIssueSummary,
		assetRoles:
			modelIssueSummary.assetRoles as readonly ExportReportAssetRole[],
	};
	const issueGroups = issueSummary.groups;
	const assets = bundle.assets.map((asset) => {
		const vecCore = vecCorePayloadByFileName.get(asset.fileName);
		return {
			kind: asset.kind,
			fileName: asset.fileName,
			role: roleForReportAssetKind(asset.kind),
			issueCount:
				issuesForAsset(asset).length +
				(vecCore ? vecCoreReportIssueCodes(vecCore).length : 0),
			issueCodes: sortedUnique([
				...issuesForAsset(asset).map((issue) => issue.code),
				...(vecCore?.issueCodes ?? []),
			]),
			...(vecCore ? { vecCore } : {}),
		};
	});
	const affectedTargetCounts = countAffectedTargetsByKind(
		issueSummary.affectedTargets,
	);
	const affectedSourcePaths = sortedUnique(
		issueSummary.affectedTargets
			.filter((target) => target.kind === "source")
			.map((target) => target.id),
	);
	const status = statusForIssues(issues);
	const artboardScope = {
		mode: bundle.artboards.scope,
		requestedCount: bundle.artboards.requestedArtboardIds.length,
		availableCount: bundle.artboards.available.length,
		exportedCount: bundle.artboards.exportedArtboardIds.length,
		issueCount: bundle.artboards.issueCount,
		currentArtboardId: bundle.artboards.currentArtboardId,
		primaryArtboardId: bundle.artboards.primaryArtboardId,
		exportedArtboardNames: bundle.artboards.exported.map(
			(artboard) => artboard.name,
		),
	} satisfies ExportReportArtboardScope;

	return {
		status,
		title:
			status === "success"
				? "Export bundle ready"
				: "Export completed with issues",
		targetLabel: "boards",
		frame: bundle.frame,
		frameRange: bundle.frameRange,
		artboardScope,
		assetCount: bundle.assets.length,
		issueCount: issues.length,
		motionIssueCount: motionIssues.length,
		vecCoreIssueCount: vecCoreIssues.length,
		assets,
		vecCore: bundle.vecCore ?? null,
		issues,
		issueSummary,
		issueGroups,
		fidelity: createExportReportFidelity(assets, issueSummary),
		fallbackTypes: issueSummary.fallbackTypes,
		affectedTargets: issueSummary.affectedTargets,
		affectedTargetCounts,
		affectedSourcePaths,
		affectedNodeIds: issueSummary.affectedNodeIds,
		affectedAssetIds: issueSummary.affectedAssetIds,
		affectedArtboardIds: issueSummary.affectedArtboardIds,
		assetRoles: issueSummary.assetRoles,
	};
}

/**
 * Builds the same compact report surface for mode-specific downloads that are
 * not represented by the legacy export bundle, such as selected vector SVGs or
 * browser-recorded WebM files.
 */
export function createStandaloneExportReport({
	title,
	targetLabel,
	frame,
	frameRange,
	artboardScope,
	assets,
	issues = [],
	optimization,
	authoringOutput,
	framePackageDeliveries,
}: CreateStandaloneExportReportInput): ExportReportModel {
	const modelIssueSummary = summarizeExportReportIssues(issues);
	const issueSummary = {
		...modelIssueSummary,
		assetRoles:
			modelIssueSummary.assetRoles as readonly ExportReportAssetRole[],
	};
	const assetIssueCount = assets.reduce(
		(total, asset) => total + asset.issueCount,
		0,
	);
	const issueCount = issues.length > 0 ? issues.length : assetIssueCount;
	const fidelity: ExportReportFidelity =
		issues.length > 0
			? createExportReportFidelity(assets, issueSummary)
			: {
					preservedAssetCount: assets.filter((asset) => asset.issueCount === 0)
						.length,
					approximatedIssueCount: 0,
					rasterizedIssueCount: 0,
					unsupportedIssueCount: issueCount,
					fallbackIssueCount: 0,
					outcomes: [
						{
							category: "preserved",
							label: "kept",
							count: assets.filter((asset) => asset.issueCount === 0).length,
							title:
								"Mode-specific assets generated without reportable issues.",
						},
						{
							category: "approximated",
							label: "approx",
							count: 0,
							title:
								"Vector features preserved with deterministic approximations.",
						},
						{
							category: "rasterized",
							label: "raster",
							count: 0,
							title:
								"Vector or paint features emitted through bitmap fallback.",
						},
						{
							category: "unsupported",
							label: "unsup",
							count: issueCount,
							title: "Features not represented by the selected export format.",
						},
					],
				};
	const affectedTargetCounts = countAffectedTargetsByKind(
		issueSummary.affectedTargets,
	);
	const affectedSourcePaths = sortedUnique(
		issueSummary.affectedTargets
			.filter((target) => target.kind === "source")
			.map((target) => target.id),
	);
	const status =
		issues.length > 0
			? statusForIssues(issues)
			: issueCount > 0
				? "warning"
				: "success";
	return {
		status,
		title,
		targetLabel,
		frame,
		frameRange,
		artboardScope,
		assetCount: assets.length,
		issueCount,
		motionIssueCount: 0,
		vecCoreIssueCount: 0,
		assets,
		vecCore: null,
		issues,
		issueSummary,
		issueGroups: issueSummary.groups,
		fidelity,
		fallbackTypes: issueSummary.fallbackTypes,
		affectedTargets: issueSummary.affectedTargets,
		affectedTargetCounts,
		affectedSourcePaths,
		affectedNodeIds: issueSummary.affectedNodeIds,
		affectedAssetIds: issueSummary.affectedAssetIds,
		affectedArtboardIds: issueSummary.affectedArtboardIds,
		assetRoles: sortedUnique([
			...assets.map((asset) => asset.role),
			...issueSummary.assetRoles,
		]) as readonly ExportReportAssetRole[],
		...(optimization ? { optimization } : {}),
		...(authoringOutput ? { authoringOutput } : {}),
		...(framePackageDeliveries && framePackageDeliveries.length > 0
			? { framePackageDeliveries }
			: {}),
	};
}
