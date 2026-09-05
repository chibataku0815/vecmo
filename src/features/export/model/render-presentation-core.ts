/**
 * Grammar/expression-free counterpart of {@link buildExportRenderPresentation}.
 *
 * This is the bundler entry for the "core" motion/code runtime. When an exported
 * scene has no motion-grammar bindings, no effect-expression bindings, and no
 * duplicate generators, {@link buildExportRenderPresentation} already samples with
 * `grammar: undefined` (see {@link buildExpressionAwareFrameSampler}, which returns
 * `undefined` for exactly that case). So this produces BYTE-IDENTICAL frames for
 * those scenes while importing only the core keyframe sampler — letting esbuild
 * tree-shake the motion-grammar evaluator and expression sampler out of the bundle
 * (~31% smaller runtime for the common keyframe-only export).
 *
 * The return type is the shared {@link ExportRenderPresentation}, so any drift in
 * the full builder's output shape is a compile error here.
 */

import { sampleMotionPresentationFrame } from "@/entities/motion/model/presentation";
import type { MotionDocument } from "@/entities/motion/model/types";
import { buildSourceOpticsPresentation } from "@/entities/scene/model/source-optics";
import type {
	ExportRenderPresentation,
	ExportRenderPresentationInput,
} from "./render-presentation";

const renderOnlyMotion = (motion: MotionDocument): MotionDocument => ({
	...motion,
	automation: undefined,
	clips: [],
	tracks: [],
});

/**
 * Core (grammar/expression-free) render presentation. Mirrors
 * {@link buildExportRenderPresentation} with `grammar` omitted; `grammarBindings`
 * is accepted-and-ignored so the generated runtime's player can call it with the
 * same arguments as the full sampler.
 */
export function buildCoreRenderPresentation({
	scene,
	motion,
	frame,
	artboardId,
	cameraRuntimeControl,
}: Omit<
	ExportRenderPresentationInput,
	"grammarBindings"
>): ExportRenderPresentation {
	const presentation = sampleMotionPresentationFrame({
		scene,
		motion,
		frame,
		artboardId,
		cameraRuntimeControl,
	});
	return {
		sourceScene: scene,
		sourceMotion: motion,
		frame: presentation.frame,
		presentation,
		scene: presentation.scene,
		renderMotion: renderOnlyMotion(motion),
		motionApplied: presentation.values.length > 0,
		camera: presentation.camera,
		sourceOptics: buildSourceOpticsPresentation(
			presentation.scene,
			artboardId,
			"svg-export",
		),
	};
}
