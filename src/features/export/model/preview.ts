import type {
	MotionPresentationIssue,
	MotionPresentationIssueCode,
	MotionPresentationNodeValues,
} from "@/entities/motion/model/presentation";
import type { MotionDocument } from "@/entities/motion/model/types";
import type { MotionGrammarBinding } from "@/entities/motion-grammar/model/types";
import type {
	MotionRelationIssue,
	MotionRelationIssueCode,
} from "@/entities/scene/model/motion-relations";
import type { SceneDocument } from "@/entities/scene/model/types";
import {
	type ExportArtboardAssetMetadata,
	type ExportArtboardIssue,
	type ExportArtboardScopeInput,
	type ExportArtboardScopeMode,
	resolveExportArtboardScope,
} from "./artboards";
import { clampExportFrame } from "./frame";
import {
	type ExportIssueGroup,
	type ExportReportIssueLike,
	groupExportIssues,
} from "./issues";
import { buildExportRenderPresentation } from "./render-presentation";
import {
	createVecCoreRecipeBundleManifest,
	createVecCoreRecipeJsonExport,
	type VecCoreRecipeBundleManifest,
	type VecCoreRecipeExportAsset,
} from "./vec-core";

/**
 * Format-neutral artboard scope summary shared by preview and export. Preview
 * renders the whole-scene SVG, but it reports the same resolved scope, primary
 * artboard, and available-artboard list that {@link createExportBundle} would
 * emit so a user can judge which artboards the download will contain.
 */
export type PreviewArtboardScopeMetadata = {
	readonly scope: ExportArtboardScopeMode;
	readonly defaultArtboardId: string;
	readonly currentArtboardId: string;
	readonly primaryArtboardId: string;
	readonly primaryArtboard: ExportArtboardAssetMetadata;
	readonly exportedArtboardIds: readonly string[];
	readonly available: readonly ExportArtboardAssetMetadata[];
	readonly issues: readonly ExportArtboardIssue[];
};

/** Deterministic frame readout shared by preview and the export frame range. */
export type PreviewFrameMetadata = {
	readonly frame: number;
	readonly fps: number;
	readonly durationFrames: number;
	readonly timeSeconds: number;
	readonly durationSeconds: number;
	readonly progress: number;
};

/**
 * Sampled motion diagnostics for the current preview frame. The counts and codes
 * are derived from the same render-presentation bridge that export uses, so
 * preview and export never disagree about what is animated or what degraded.
 */
export type PreviewMotionMetadata = {
	readonly animatedNodeCount: number;
	readonly animatedNodeIds: readonly string[];
	readonly sampledValueCount: number;
	readonly motionApplied: boolean;
	readonly values: readonly MotionPresentationNodeValues[];
	readonly issueCount: number;
	readonly issueCodes: readonly MotionPresentationIssueCode[];
	readonly issues: readonly MotionPresentationIssue[];
	readonly relationIssueCount: number;
	readonly relationIssueCodes: readonly MotionRelationIssueCode[];
	readonly relationIssues: readonly MotionRelationIssue[];
};

/**
 * Preview-time projection of the export contract. Built from the same scene,
 * motion, frame, and artboard-scope inputs as {@link createExportBundle} so a
 * user can verify motion/artboard/issue quality before downloading. It carries
 * metadata only — no SVG/PDF assets are rendered here.
 */
export type PreviewExportMetadata = {
	readonly sceneSchemaVersion: SceneDocument["schemaVersion"];
	readonly motionSchemaVersion: MotionDocument["schemaVersion"];
	readonly frame: PreviewFrameMetadata;
	readonly artboardScope: PreviewArtboardScopeMetadata;
	readonly motion: PreviewMotionMetadata;
	readonly vecCore: VecCoreRecipeBundleManifest | null;
	readonly issueGroups: readonly ExportIssueGroup[];
	readonly issueCount: number;
};

type BuildPreviewMetadataInput = {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly frame: number;
	readonly grammarBindings?: readonly MotionGrammarBinding[];
	readonly artboardScope?: ExportArtboardScopeInput;
};

const secondsForFrame = (frame: number, fps: number): number =>
	Number.isFinite(fps) && fps > 0 ? frame / fps : 0;

const progressForFrame = (frame: number, durationFrames: number): number => {
	if (!Number.isFinite(durationFrames) || durationFrames <= 0) return 0;
	const ratio = frame / durationFrames;
	return Math.min(Math.max(0, ratio), 1);
};

const sortedUnique = <Value extends string>(
	values: readonly Value[],
): readonly Value[] =>
	[...new Set(values)].sort((left, right) => left.localeCompare(right));

const previewRecipeAssets = ({
	targets,
	motion,
	frame,
	grammarBindings,
}: {
	readonly targets: ReturnType<typeof resolveExportArtboardScope>["targets"];
	readonly motion: MotionDocument;
	readonly frame: number;
	readonly grammarBindings?: readonly MotionGrammarBinding[];
}): readonly (VecCoreRecipeExportAsset & {
	readonly artboard: ExportArtboardAssetMetadata;
})[] =>
	targets.flatMap((target) => {
		const renderPresentation = buildExportRenderPresentation({
			scene: target.scene,
			motion,
			frame,
			grammarBindings,
		});
		const recipeAsset = createVecCoreRecipeJsonExport({
			scene: renderPresentation.scene,
			frame,
			fileNameStem: target.fileStem,
		});
		if (!recipeAsset) return [];
		return [
			{
				...recipeAsset,
				artboard: target.metadata,
			},
		];
	});

/**
 * Maps motion presentation issues into the shared {@link ExportReportIssueLike}
 * shape. This is the single seam preview and the export bundle both use so the
 * grouped issue display cannot drift between the two surfaces.
 */
export function motionIssuesAsReportIssues(
	issues: readonly MotionPresentationIssue[],
): readonly ExportReportIssueLike[] {
	return issues.map((issue) => ({
		severity: issue.severity,
		category: "motion",
		code: issue.code,
		message: issue.message,
		nodeId: issue.nodeId,
		trackId: issue.trackId,
	}));
}

/** Maps general motion-relation failures into the shared export issue shape. */
export function motionRelationIssuesAsReportIssues(
	issues: readonly MotionRelationIssue[],
): readonly ExportReportIssueLike[] {
	return issues.map((issue) => ({
		severity: issue.severity,
		category: "motion",
		code: issue.code,
		message: issue.message,
		nodeId: issue.nodeId,
	}));
}

/**
 * Maps resolved artboard-scope issues into the shared report issue shape so the
 * preview surface groups artboard-selection problems alongside motion issues.
 */
export function artboardIssuesAsReportIssues(
	issues: readonly ExportArtboardIssue[],
): readonly ExportReportIssueLike[] {
	return issues.map((issue) => ({
		severity: issue.severity,
		category: issue.category,
		code: issue.code,
		message: issue.message,
		fallback: issue.fallback,
		layerId: issue.layerId,
		nodeId: issue.nodeId,
		artboardId: issue.artboardId,
		requestedArtboardId: issue.requestedArtboardId,
	}));
}

/**
 * Builds the deterministic frame/artboard/issue metadata a user needs to judge
 * export quality before download. The result is pure and serializable: it
 * resolves the same artboard scope and uses the same render-presentation bridge
 * as {@link createExportBundle}, then groups motion + artboard issues with the
 * shared {@link groupExportIssues} helper.
 */
export function buildPreviewExportMetadata({
	scene,
	motion,
	frame,
	grammarBindings,
	artboardScope,
}: BuildPreviewMetadataInput): PreviewExportMetadata {
	const sampledFrame = clampExportFrame(frame, motion.durationFrames);
	const resolvedScope = resolveExportArtboardScope(scene, artboardScope);
	const primaryTarget = resolvedScope.targets[0];
	if (!primaryTarget) {
		throw new Error(
			"Preview metadata requires at least one resolved artboard target.",
		);
	}
	const renderPresentation = buildExportRenderPresentation({
		scene,
		motion,
		frame: sampledFrame,
		grammarBindings,
	});
	const vecCore =
		createVecCoreRecipeBundleManifest(
			previewRecipeAssets({
				targets: resolvedScope.targets,
				motion,
				frame: sampledFrame,
				grammarBindings,
			}),
		) ?? null;
	const presentation = renderPresentation.presentation;
	const animatedNodeIds = sortedUnique(
		presentation.values.map((value) => value.nodeId),
	);
	const issueGroups = groupExportIssues([
		...motionIssuesAsReportIssues(presentation.issues),
		...motionRelationIssuesAsReportIssues(presentation.relationIssues),
		...artboardIssuesAsReportIssues(resolvedScope.issues),
	]);

	return {
		sceneSchemaVersion: scene.schemaVersion,
		motionSchemaVersion: motion.schemaVersion,
		frame: {
			frame: sampledFrame,
			fps: motion.fps,
			durationFrames: motion.durationFrames,
			timeSeconds: secondsForFrame(sampledFrame, motion.fps),
			durationSeconds: secondsForFrame(motion.durationFrames, motion.fps),
			progress: progressForFrame(sampledFrame, motion.durationFrames),
		},
		artboardScope: {
			scope: resolvedScope.scope,
			defaultArtboardId: resolvedScope.defaultArtboardId,
			currentArtboardId: resolvedScope.currentArtboardId,
			primaryArtboardId: primaryTarget.metadata.id,
			primaryArtboard: primaryTarget.metadata,
			exportedArtboardIds: resolvedScope.targets.map(
				(target) => target.metadata.id,
			),
			available: resolvedScope.available,
			issues: resolvedScope.issues,
		},
		motion: {
			animatedNodeCount: animatedNodeIds.length,
			animatedNodeIds,
			sampledValueCount: presentation.values.length,
			motionApplied: renderPresentation.motionApplied,
			values: presentation.values,
			issueCount: presentation.issues.length,
			issueCodes: sortedUnique(presentation.issues.map((issue) => issue.code)),
			issues: presentation.issues,
			relationIssueCount: presentation.relationIssues.length,
			relationIssueCodes: sortedUnique(
				presentation.relationIssues.map((issue) => issue.code),
			),
			relationIssues: presentation.relationIssues,
		},
		vecCore,
		issueGroups,
		issueCount:
			presentation.issues.length +
			presentation.relationIssues.length +
			resolvedScope.issues.length,
	};
}
