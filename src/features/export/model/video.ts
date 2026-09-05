import { buildMotionPresentationFramePlan } from "@/entities/motion/model/presentation";
import type { MotionDocument } from "@/entities/motion/model/types";
import type { SceneDocument } from "@/entities/scene/model/types";
import { fileStemForScene } from "./json";

export const WEBM_VIDEO_EXPORT_FORMAT =
	"vector-motion-author/video-webm" as const;

export const WEBM_VIDEO_MIME_TYPE_CANDIDATES = [
	"video/webm;codecs=vp9",
	"video/webm;codecs=vp8",
	"video/webm",
] as const;

export type WebmVideoExportPlan = {
	readonly exportFormat: typeof WEBM_VIDEO_EXPORT_FORMAT;
	readonly fileName: string;
	readonly width: number;
	readonly height: number;
	readonly fps: number;
	readonly durationFrames: number;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly stepFrames: number;
	readonly frames: readonly number[];
};

export type CreateWebmVideoExportPlanInput = {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly fileNameStem?: string;
	readonly startFrame?: number;
	readonly endFrame?: number;
	readonly stepFrames?: number;
};

const positiveDimension = (value: number): number =>
	Math.max(1, Math.round(value));

/**
 * Builds the browser WebM export plan for a single scoped scene/artboard.
 *
 * The plan is frame-based and intentionally separate from sequence SVG export:
 * video encoders consume one rendered frame at a time to avoid the memory blowup
 * of embedding every SVG frame into another SVG strip.
 */
export function createWebmVideoExportPlan({
	scene,
	motion,
	fileNameStem = fileStemForScene(scene),
	startFrame = 0,
	endFrame = Math.max(0, motion.durationFrames - 1),
	stepFrames = 1,
}: CreateWebmVideoExportPlanInput): WebmVideoExportPlan {
	const plan = buildMotionPresentationFramePlan({
		motion,
		startFrame,
		endFrame,
		stepFrames,
	});
	return {
		exportFormat: WEBM_VIDEO_EXPORT_FORMAT,
		fileName: `${fileNameStem}.motion.webm`,
		width: positiveDimension(scene.artboard.width),
		height: positiveDimension(scene.artboard.height),
		fps: plan.fps,
		durationFrames: plan.durationFrames,
		startFrame: plan.startFrame,
		endFrame: plan.endFrame,
		stepFrames: plan.stepFrames,
		frames: plan.frames,
	};
}
