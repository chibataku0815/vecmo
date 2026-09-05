import { sampleMotionPresentationScene } from "@/entities/motion/model/presentation";
import type { MotionDocument } from "@/entities/motion/model/types";
import { buildMotionGrammarFrameSampler } from "@/entities/motion-grammar/model/evaluator";
import type { MotionGrammarBinding } from "@/entities/motion-grammar/model/types";
import { buildExpressionAwareFrameSampler } from "@/entities/scene/model/expression-presentation";
import { createProductionControlSampler } from "@/entities/scene/model/production-control";
import type { SceneDocument } from "@/entities/scene/model/types";

/**
 * Samples the same presentation scene used by scrub/export for the imperative
 * playback path. Playback normally patches only authored motion tracks for speed,
 * but grammar effects can create presentation-only nodes, so the driver needs the
 * richer scene whenever grammar bindings are active.
 */
export function samplePlaybackPresentationScene({
	scene,
	motion,
	frame,
	grammarBindings,
}: {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly frame: number;
	readonly grammarBindings: readonly MotionGrammarBinding[];
}): SceneDocument {
	const grammar = buildExpressionAwareFrameSampler({
		scene,
		fps: motion.fps,
		baseSampler: buildMotionGrammarFrameSampler({
			bindings: grammarBindings,
			scene,
			motion,
		}),
	});
	return sampleMotionPresentationScene({
		scene,
		motion,
		frame,
		grammar,
		controls: createProductionControlSampler(scene, motion),
	});
}
