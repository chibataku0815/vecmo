/**
 * FLAT counterpart of {@link buildLeanRenderPresentation} for the export-side
 * FLAT sampler tier (`runtime-sampler-flat-entry.ts`) — LEAN minus camera.
 *
 * {@link sampleFlatMotionPresentationFrame} skips the same source-optics,
 * effect-expression, look-graph, and blend-refresh stages LEAN skips, PLUS
 * real camera projection: it resolves motion-parent/property-relation
 * constraints (a separate capability from camera projection) but never runs
 * `resolveSceneCameraProjection`'s 3D rig/crossfade/depth-of-field matrix
 * math. `code.ts` embeds this bundle only when the motion-artifact tier
 * predicate (`sceneQualifiesForFlatTier`) has confirmed the scene has no
 * scene-camera rig anywhere and the export artboard declares
 * `cameraSpacePolicy: "screen_2d"`.
 *
 * `grammar` is wired to {@link buildDuplicateOnlyFrameSampler} rather than
 * omitted: the tier predicate (`code.ts`'s `selectMotionArtifactRuntimeSamplerTier`)
 * allows a FLAT-eligible scene to still have `duplicateGenerators`, and
 * `sampleFlatMotionPresentationFrame` already calls `resolveGrammarFrame`
 * unconditionally, so a duplicate-free scene takes the exact same
 * `EMPTY_GRAMMAR_FRAME_SAMPLE` path as before (`buildDuplicateOnlyFrameSampler`
 * returns `undefined` when there are no generators).
 */

import { sampleFlatMotionPresentationFrame } from "@/entities/motion/model/presentation";
import type { MotionDocument } from "@/entities/motion/model/types";
import { buildDuplicateOnlyFrameSampler } from "@/entities/scene/model/expression-presentation";
import type { SourceOpticsPresentation } from "@/entities/scene/model/source-optics";
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

const neutralSourceOpticsPresentation = (
	artboardId: string,
): SourceOpticsPresentation => ({
	artboardId,
	sourcePlans: [],
	targetPlans: [],
	nodePlans: {},
	issues: [],
});

/**
 * Flat (camera/source-optics/effect-expression/look-graph/blend-free) render
 * presentation. Mirrors {@link buildLeanRenderPresentation} with
 * `grammarBindings` and `cameraRuntimeControl` both omitted — a FLAT-eligible
 * scene has no camera rig to run runtime camera-cut overrides against.
 * `grammar` carries only duplicate-generator instances (see this module's
 * doc comment); a FLAT-eligible scene never has effect-expression bindings.
 */
export function buildFlatRenderPresentation({
	scene,
	motion,
	frame,
	artboardId,
}: Omit<
	ExportRenderPresentationInput,
	"grammarBindings" | "cameraRuntimeControl"
>): ExportRenderPresentation {
	const presentation = sampleFlatMotionPresentationFrame({
		scene,
		motion,
		frame,
		artboardId,
		grammar: buildDuplicateOnlyFrameSampler(scene, motion.fps),
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
		sourceOptics: neutralSourceOpticsPresentation(
			artboardId ?? presentation.scene.artboard.id,
		),
	};
}
