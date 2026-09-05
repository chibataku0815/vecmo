import type {
	MotionPresentationIssue,
	MotionPresentationIssueCode,
	MotionPresentationNodeValues,
} from "@/entities/motion/model/presentation";
import type { MotionDocument } from "@/entities/motion/model/types";
import type { MotionGrammarBinding } from "@/entities/motion-grammar/model/types";
import type { SceneDocument } from "@/entities/scene/model/types";
import {
	type ExportAsset,
	fileStemForScene,
	stableJsonStringify,
} from "./json";
import {
	buildExportRenderPresentation,
	type ExportRenderPresentation,
} from "./render-presentation";
import { renderSceneSvgWithIssues, type SvgExportIssue } from "./svg";

const JSON_MIME_TYPE = "application/json;charset=utf-8";
const SVG_MIME_TYPE = "image/svg+xml;charset=utf-8";

export const ANIMATION_SEQUENCE_JSON_FORMAT =
	"vector-motion-author/animation-sequence";
export const ANIMATION_SEQUENCE_SVG_FORMAT =
	"vector-motion-author/animation-sequence-svg";

export type ExportAnimationSequenceFrameRange = {
	readonly mode: "current-frame" | "frame-range";
	readonly currentFrame: number;
	readonly fps: number;
	readonly durationFrames: number;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly stepFrames: number;
	readonly frameCount: number;
	readonly frames: readonly number[];
};

export type ExportAnimationSequenceFrameManifest = {
	readonly index: number;
	readonly frame: number;
	readonly timeSeconds: number;
	readonly svgFrameId: string;
	readonly sampledValueCount: number;
	readonly animatedNodeIds: readonly string[];
	readonly values: readonly MotionPresentationNodeValues[];
	readonly motionIssueCount: number;
	readonly motionIssueCodes: readonly MotionPresentationIssueCode[];
	readonly motionIssues: readonly MotionPresentationIssue[];
	readonly svgIssueCount: number;
	readonly svgIssueCodes: readonly SvgExportIssue["code"][];
};

/**
 * Side-car sequence contract for frame-range exports. The JSON payload carries
 * sampled motion values and per-frame diagnostics, while the SVG asset exposes a
 * deterministic visual frame strip using the same renderer as preview/current
 * frame SVG export.
 */
export type ExportAnimationSequenceManifest = {
	readonly exportFormat: typeof ANIMATION_SEQUENCE_JSON_FORMAT;
	readonly sceneSchemaVersion: SceneDocument["schemaVersion"];
	readonly motionSchemaVersion: MotionDocument["schemaVersion"];
	readonly fps: number;
	readonly durationFrames: number;
	readonly frameRange: ExportAnimationSequenceFrameRange;
	readonly frameCount: number;
	readonly includeMotionMetadata: boolean;
	readonly assetFileNames: {
		readonly json: string;
		readonly svg: string;
	};
	readonly motionIssueCount: number;
	readonly motionIssueCodes: readonly MotionPresentationIssueCode[];
	readonly svgIssueCount: number;
	readonly svgIssueCodes: readonly SvgExportIssue["code"][];
	readonly frames: readonly ExportAnimationSequenceFrameManifest[];
};

export type ExportAnimationSequenceJsonAsset = ExportAsset & {
	readonly kind: "animation-sequence-json";
};

export type ExportAnimationSequenceSvgIssue = SvgExportIssue & {
	readonly frame: number;
	readonly frameIndex: number;
};

export type ExportAnimationSequenceSvgAsset = ExportAsset & {
	readonly kind: "animation-sequence-svg";
	readonly issues: readonly ExportAnimationSequenceSvgIssue[];
};

export type ExportAnimationSequenceAssets = {
	readonly manifest: ExportAnimationSequenceManifest;
	readonly jsonAsset: ExportAnimationSequenceJsonAsset;
	readonly svgAsset: ExportAnimationSequenceSvgAsset;
};

type CreateAnimationSequenceExportInput = {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly frameRange: ExportAnimationSequenceFrameRange;
	readonly includeMotionMetadata: boolean;
	readonly fileNameStem?: string;
	readonly grammarBindings?: readonly MotionGrammarBinding[];
};

type RenderedSequenceFrame = {
	readonly index: number;
	readonly frame: number;
	readonly svgFrameId: string;
	readonly renderPresentation: ExportRenderPresentation;
	readonly contents: string;
	readonly issues: readonly SvgExportIssue[];
};

const sortedUnique = <Value extends string>(
	values: readonly (Value | undefined)[],
): readonly Value[] =>
	[...new Set(values.filter((value): value is Value => Boolean(value)))].sort(
		(left, right) => left.localeCompare(right),
	);

const issueCodes = <Code extends string>(
	issues: readonly {
		readonly code: Code;
	}[],
): readonly Code[] => sortedUnique(issues.map((issue) => issue.code));

const animatedNodeIdsForValues = (
	values: readonly MotionPresentationNodeValues[],
): readonly string[] => sortedUnique(values.map((value) => value.nodeId));

const formatNumber = (value: number): string => {
	if (!Number.isFinite(value)) return "0";
	const rounded = Math.abs(value) < 1e-10 ? 0 : Number(value.toFixed(6));
	return String(rounded);
};

const frameToken = (value: number): string =>
	formatNumber(value).replace("-", "neg-").replace(".", "p");

const sequenceFileBase = (
	scene: SceneDocument,
	frameRange: ExportAnimationSequenceFrameRange,
	fileNameStem = fileStemForScene(scene),
): string =>
	`${fileNameStem}.frames-${frameToken(frameRange.startFrame)}-to-${frameToken(frameRange.endFrame)}-step-${frameToken(frameRange.stepFrames)}`;

const escapeText = (value: string): string =>
	value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");

const escapeAttribute = (value: string): string =>
	escapeText(value).replaceAll('"', "&quot;");

const renderAttributes = (
	attributes: readonly (readonly [string, string | number | boolean])[],
): string =>
	attributes
		.map(([name, value]) => {
			const normalized =
				typeof value === "number" ? formatNumber(value) : String(value);
			return `${name}="${escapeAttribute(normalized)}"`;
		})
		.join(" ");

const secondsForFrame = (frame: number, fps: number): number =>
	Number.isFinite(fps) && fps > 0 ? frame / fps : 0;

const renderSequenceFrames = ({
	scene,
	motion,
	frameRange,
	grammarBindings,
}: Pick<
	CreateAnimationSequenceExportInput,
	"scene" | "motion" | "frameRange" | "grammarBindings"
>): readonly RenderedSequenceFrame[] =>
	frameRange.frames.map((frame, index) => {
		const renderPresentation = buildExportRenderPresentation({
			scene,
			motion,
			frame,
			grammarBindings,
		});
		const result = renderSceneSvgWithIssues({
			scene,
			motion,
			frame,
			renderPresentation,
			// Frames embed via `<image href=data:svg>`, which freezes SMIL like a
			// raster `<img>`. Bake explicit particle Motion per frame; Linear fields
			// keep their inlined data-URL ramp inside the embedded SVG.
			rasterSafe: true,
		});
		return {
			index,
			frame: renderPresentation.frame,
			svgFrameId: `frame-${index}-${frameToken(frame)}`,
			renderPresentation,
			contents: result.contents,
			issues: result.issues,
		};
	});

const createFrameManifest = ({
	frameRange,
	includeMotionMetadata,
	renderedFrame,
}: Pick<
	CreateAnimationSequenceExportInput,
	"frameRange" | "includeMotionMetadata"
> & {
	readonly renderedFrame: RenderedSequenceFrame;
}): ExportAnimationSequenceFrameManifest => {
	const presentation = includeMotionMetadata
		? renderedFrame.renderPresentation.presentation
		: null;
	const values = presentation?.values ?? [];
	const motionIssues = presentation?.issues ?? [];

	return {
		index: renderedFrame.index,
		frame: renderedFrame.frame,
		timeSeconds: secondsForFrame(renderedFrame.frame, frameRange.fps),
		svgFrameId: renderedFrame.svgFrameId,
		sampledValueCount: values.length,
		animatedNodeIds: animatedNodeIdsForValues(values),
		values,
		motionIssueCount: motionIssues.length,
		motionIssueCodes: issueCodes(motionIssues),
		motionIssues,
		svgIssueCount: renderedFrame.issues.length,
		svgIssueCodes: issueCodes(renderedFrame.issues),
	};
};

const sequenceSvgIssues = (
	renderedFrames: readonly RenderedSequenceFrame[],
): readonly ExportAnimationSequenceSvgIssue[] =>
	renderedFrames.flatMap((renderedFrame) =>
		renderedFrame.issues.map((issue) => ({
			...issue,
			frame: renderedFrame.frame,
			frameIndex: renderedFrame.index,
		})),
	);

const renderSequenceSvg = ({
	scene,
	motion,
	frameRange,
	renderedFrames,
}: Pick<
	CreateAnimationSequenceExportInput,
	"scene" | "motion" | "frameRange"
> & {
	readonly renderedFrames: readonly RenderedSequenceFrame[];
}): string => {
	const width = scene.artboard.width;
	const height = scene.artboard.height;
	const frameCount = renderedFrames.length;
	const stripWidth = width * Math.max(1, frameCount);
	const metadata = stableJsonStringify({
		durationFrames: frameRange.durationFrames,
		exportFormat: ANIMATION_SEQUENCE_SVG_FORMAT,
		fps: frameRange.fps,
		frameCount,
		frames: renderedFrames.map((renderedFrame) => ({
			frame: renderedFrame.frame,
			index: renderedFrame.index,
			svgFrameId: renderedFrame.svgFrameId,
			timeSeconds: secondsForFrame(renderedFrame.frame, frameRange.fps),
		})),
		motionSchemaVersion: motion.schemaVersion,
		sceneSchemaVersion: scene.schemaVersion,
	}).trim();
	const images = renderedFrames
		.map((renderedFrame) => {
			const href = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderedFrame.contents)}`;
			return `<image ${renderAttributes([
				["id", renderedFrame.svgFrameId],
				["href", href],
				["x", renderedFrame.index * width],
				["y", 0],
				["width", width],
				["height", height],
				["data-frame-index", renderedFrame.index],
				["data-frame", renderedFrame.frame],
				[
					"data-time-seconds",
					secondsForFrame(renderedFrame.frame, frameRange.fps),
				],
			])} />`;
		})
		.join("\n");

	return [
		`<svg ${renderAttributes([
			["xmlns", "http://www.w3.org/2000/svg"],
			["viewBox", `0 0 ${formatNumber(stripWidth)} ${formatNumber(height)}`],
			["width", stripWidth],
			["height", height],
			["data-export-format", ANIMATION_SEQUENCE_SVG_FORMAT],
			["data-scene-schema-version", scene.schemaVersion],
			["data-motion-schema-version", motion.schemaVersion],
			["data-sequence-frame-count", frameCount],
			["data-sequence-start-frame", frameRange.startFrame],
			["data-sequence-end-frame", frameRange.endFrame],
			["data-sequence-step-frames", frameRange.stepFrames],
		])}>`,
		`<metadata>${escapeText(metadata)}</metadata>`,
		`<g ${renderAttributes([["data-sequence-layout", "frame-strip"]])}>`,
		images,
		"</g>",
		"</svg>",
		"",
	].join("\n");
};

/**
 * Creates deterministic JSON and SVG assets for an inclusive animation frame
 * range. Motion remains a side-car input: sequence JSON stores sampled values
 * and issues, while the SVG sequence embeds rendered frame SVGs as data URIs.
 */
export function createAnimationSequenceExport({
	scene,
	motion,
	frameRange,
	includeMotionMetadata,
	fileNameStem,
	grammarBindings,
}: CreateAnimationSequenceExportInput): ExportAnimationSequenceAssets {
	const fileBase = sequenceFileBase(scene, frameRange, fileNameStem);
	const jsonFileName = `${fileBase}.sequence.json`;
	const svgFileName = `${fileBase}.sequence.svg`;
	const renderedFrames = renderSequenceFrames({
		scene,
		motion,
		frameRange,
		grammarBindings,
	});
	const frameManifests = renderedFrames.map((renderedFrame) =>
		createFrameManifest({
			frameRange,
			includeMotionMetadata,
			renderedFrame,
		}),
	);
	const motionIssues = frameManifests.flatMap((frame) => frame.motionIssues);
	const svgIssues = sequenceSvgIssues(renderedFrames);
	const manifest: ExportAnimationSequenceManifest = {
		exportFormat: ANIMATION_SEQUENCE_JSON_FORMAT,
		sceneSchemaVersion: scene.schemaVersion,
		motionSchemaVersion: motion.schemaVersion,
		fps: frameRange.fps,
		durationFrames: frameRange.durationFrames,
		frameRange,
		frameCount: frameManifests.length,
		includeMotionMetadata,
		assetFileNames: {
			json: jsonFileName,
			svg: svgFileName,
		},
		motionIssueCount: motionIssues.length,
		motionIssueCodes: issueCodes(motionIssues),
		svgIssueCount: svgIssues.length,
		svgIssueCodes: issueCodes(svgIssues),
		frames: frameManifests,
	};

	return {
		manifest,
		jsonAsset: {
			kind: "animation-sequence-json",
			fileName: jsonFileName,
			mimeType: JSON_MIME_TYPE,
			contents: stableJsonStringify(manifest),
		},
		svgAsset: {
			kind: "animation-sequence-svg",
			fileName: svgFileName,
			mimeType: SVG_MIME_TYPE,
			contents: renderSequenceSvg({
				scene,
				motion,
				frameRange,
				renderedFrames,
			}),
			issues: svgIssues,
		},
	};
}
