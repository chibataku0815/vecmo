import { sampleMotionPresentationScene } from "@/entities/motion/model/presentation";
import type { MotionDocument } from "@/entities/motion/model/types";
import { buildMotionGrammarFrameSampler } from "@/entities/motion-grammar/model/evaluator";
import type { MotionGrammarBinding } from "@/entities/motion-grammar/model/types";
import { buildExpressionAwareFrameSampler } from "@/entities/scene/model/expression-presentation";
import { materializeLayoutFramesForPresentation } from "@/entities/scene/model/layout-frame-presentation";
import { createProductionControlSampler } from "@/entities/scene/model/production-control";
import type { SceneDocument } from "@/entities/scene/model/types";

export type CanvasPresentationTransportSnapshot = {
	readonly currentFrame: number;
	readonly isPlaying: boolean;
};

export type CanvasVideoPresentationSnapshot = {
	readonly source: SceneDocument;
	readonly frame: number;
	readonly document: SceneDocument;
};

const safePresentationFrame = (frame: number): number =>
	Number.isFinite(frame) ? Math.max(0, frame) : 0;

/**
 * Resolves the frame React should use for the sampled canvas presentation.
 * Scrubbing while paused must update the rendered scene, but active playback is
 * driven imperatively by the motion overlay so the shell does not re-render on
 * every rAF transport tick.
 */
export function resolveCanvasPresentationFrame(
	previousFrame: number,
	transport: CanvasPresentationTransportSnapshot,
): number {
	if (transport.isPlaying) return safePresentationFrame(previousFrame);
	return safePresentationFrame(transport.currentFrame);
}

/**
 * Chooses the concrete document the Canvas SVG renderer should read. Motion and
 * grammar sampling produce `sampledDocument`; async video-frame materialization
 * may replace it only when it still matches the same sampled source and frame.
 */
export function resolveCanvasRenderDocument(options: {
	readonly sampledDocument: SceneDocument;
	readonly videoPresentation: CanvasVideoPresentationSnapshot;
	readonly videoPresentationFrame: number;
}): SceneDocument {
	return options.videoPresentation.source === options.sampledDocument &&
		options.videoPresentation.frame === options.videoPresentationFrame
		? options.videoPresentation.document
		: options.sampledDocument;
}

/**
 * Backward-compatible canvas adapter for the entity-owned motion presentation
 * contract. Canvas code keeps the established positional API while the shared
 * sampler lives below widgets for export and preview reuse. Grammar bindings (when
 * present) are evaluated into a per-frame {@link import("@/entities/motion/model/grammar-bridge").GrammarFrameSampler}
 * and injected; presentation composes them without importing the evaluator.
 */
export function samplePresentation(
	scene: SceneDocument,
	motion: MotionDocument,
	frame: number,
	grammarBindings: readonly MotionGrammarBinding[] = [],
): SceneDocument {
	const layoutScene = materializeLayoutFramesForPresentation(scene);
	// Grammar evaluation needs resolved cell geometry, but motion sampling receives
	// the source scene so it can compute authored-rest -> layout-rest offsets.
	const grammar = buildExpressionAwareFrameSampler({
		scene: layoutScene,
		fps: motion.fps,
		baseSampler: buildMotionGrammarFrameSampler({
			bindings: grammarBindings,
			scene: layoutScene,
			motion,
		}),
	});
	return sampleMotionPresentationScene({
		scene,
		motion,
		frame,
		grammar,
		// Published controls resolve the way grammar does: built here from the two
		// documents and injected as a pure function, so presentation never imports
		// the linked-production contract.
		controls: createProductionControlSampler(scene, motion),
	});
}
