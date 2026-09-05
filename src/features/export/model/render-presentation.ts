import {
	type MotionPresentationFrame,
	sampleMotionPresentationFrame,
} from "@/entities/motion/model/presentation";
import type { MotionDocument } from "@/entities/motion/model/types";
import { buildMotionGrammarFrameSampler } from "@/entities/motion-grammar/model/evaluator";
import type { MotionGrammarBinding } from "@/entities/motion-grammar/model/types";
import { buildExpressionAwareFrameSampler } from "@/entities/scene/model/expression-presentation";
import { materializeLayoutFramesForPresentation } from "@/entities/scene/model/layout-frame-presentation";
import { createProductionControlSampler } from "@/entities/scene/model/production-control";
import type { SceneCameraRuntimeControl } from "@/entities/scene/model/scene-camera";
import {
	buildSourceOpticsPresentation,
	type SourceOpticsPresentation,
} from "@/entities/scene/model/source-optics";
import type { SceneDocument } from "@/entities/scene/model/types";

/** Raw side-car inputs for sampling one preview/export frame. */
export type ExportRenderPresentationInput = {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly frame: number;
	/** Explicit presentation artboard. Sequence runtimes must pass the active item instead of relying on editor current-artboard state. */
	readonly artboardId?: string | null;
	readonly grammarBindings?: readonly MotionGrammarBinding[];
	readonly cameraRuntimeControl?: SceneCameraRuntimeControl;
};

/**
 * Renderer-facing projection of a side-car motion frame. `scene` is the sampled
 * presentation tree and `renderMotion` is intentionally inert so renderer code
 * cannot apply raw tracks a second time.
 */
export type ExportRenderPresentation = {
	readonly sourceScene: SceneDocument;
	readonly sourceMotion: MotionDocument;
	readonly frame: number;
	readonly presentation: MotionPresentationFrame;
	readonly scene: SceneDocument;
	readonly renderMotion: MotionDocument;
	readonly motionApplied: boolean;
	readonly camera: MotionPresentationFrame["camera"];
	readonly sourceOptics: SourceOpticsPresentation;
};

const renderOnlyMotion = (motion: MotionDocument): MotionDocument => ({
	...motion,
	automation: undefined,
	clips: [],
	tracks: [],
});

/**
 * Builds the optional grammar sampler shared by preview/export. Keeping the
 * evaluator at this feature boundary preserves the motion entity's one-way bridge
 * while making exported frames match the live canvas presentation.
 */
export function buildExportGrammarSampler(
	input:
		| {
				readonly grammarBindings: readonly MotionGrammarBinding[] | undefined;
				readonly scene: SceneDocument;
				readonly motion: MotionDocument;
		  }
		| undefined,
) {
	if (!input?.grammarBindings || input.grammarBindings.length === 0) {
		return undefined;
	}
	const { grammarBindings, scene, motion } = input;
	return buildMotionGrammarFrameSampler({
		bindings: grammarBindings,
		scene,
		motion,
	});
}

/**
 * Bridges the side-car MotionDocument into renderer-facing presentation state.
 * Renderers receive a sampled scene plus an inert motion document so they do not
 * re-interpret raw keyframes or write sampled values back into SceneDocument.
 */
export function buildExportRenderPresentation({
	scene,
	motion,
	frame,
	artboardId,
	grammarBindings,
	cameraRuntimeControl,
}: ExportRenderPresentationInput): ExportRenderPresentation {
	const layoutScene = materializeLayoutFramesForPresentation(scene);
	// Grammar evaluation needs resolved cell geometry, while the motion sampler
	// receives the source scene so layout-managed x/y tracks can stay cell-relative.
	const presentation = sampleMotionPresentationFrame({
		scene,
		motion,
		frame,
		artboardId,
		cameraRuntimeControl,
		// Published controls are resolved from the same two documents the renderer
		// already has, so preview and export cannot diverge on a control value.
		controls: createProductionControlSampler(scene, motion),
		grammar: buildExpressionAwareFrameSampler({
			scene: layoutScene,
			fps: motion.fps,
			baseSampler: buildExportGrammarSampler({
				grammarBindings,
				scene: layoutScene,
				motion,
			}),
		}),
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
