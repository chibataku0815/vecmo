/**
 * LEAN counterpart of {@link buildCoreRenderPresentation} for the export-side
 * LEAN sampler tier (`runtime-sampler-lean-entry.ts`).
 *
 * {@link sampleLeanMotionPresentationFrame} already skips the source-optics,
 * effect-expression, look-graph, and blend-refresh presentation stages for
 * scenes the motion-artifact tier predicate (`code.ts`) has confirmed need
 * none of them. `sourceOptics` here is a NEUTRAL placeholder rather than a
 * real `buildSourceOpticsPresentation` call: the runtime player never reads
 * `ExportRenderPresentation.sourceOptics` (only `svg.ts`/`pdf.ts` do, for the
 * in-app SVG/PDF export path, which never selects this tier), so computing it
 * for real here would just be wasted work to satisfy a non-optional field.
 *
 * `grammar` is wired to {@link buildDuplicateOnlyFrameSampler} rather than
 * omitted: the tier predicate allows a LEAN-eligible scene to still have
 * `duplicateGenerators`, and `sampleLeanMotionPresentationFrame` already
 * calls `resolveGrammarFrame` unconditionally, so a duplicate-free scene
 * takes the exact same `EMPTY_GRAMMAR_FRAME_SAMPLE` path as before
 * (`buildDuplicateOnlyFrameSampler` returns `undefined` when there are no
 * generators).
 */

import { sampleLeanMotionPresentationFrame } from "@/entities/motion/model/presentation";
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
 * Lean (source-optics/effect-expression/look-graph/blend-free) render
 * presentation. Mirrors {@link buildCoreRenderPresentation} with
 * `grammarBindings` omitted (no motion-grammar evaluator here) and camera
 * KEPT — camera projection is core to visual identity, not an optional
 * capability, in every composer tier. `grammar` carries only
 * duplicate-generator instances (see this module's doc comment); a
 * LEAN-eligible scene never has effect-expression bindings.
 */
export function buildLeanRenderPresentation({
	scene,
	motion,
	frame,
	artboardId,
	cameraRuntimeControl,
}: Omit<
	ExportRenderPresentationInput,
	"grammarBindings"
>): ExportRenderPresentation {
	const presentation = sampleLeanMotionPresentationFrame({
		scene,
		motion,
		frame,
		artboardId,
		cameraRuntimeControl,
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
