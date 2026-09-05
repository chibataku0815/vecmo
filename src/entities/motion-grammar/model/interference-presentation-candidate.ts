import { sampleMotionPresentationFrame } from "@/entities/motion/model/presentation";
import type { MotionDocument } from "@/entities/motion/model/types";
import { buildExpressionAwareFrameSampler } from "@/entities/scene/model/expression-presentation";
import { materializeLayoutFramesForPresentation } from "@/entities/scene/model/layout-frame-presentation";
import { findNode } from "@/entities/scene/model/selectors";
import type { SceneDocument } from "@/entities/scene/model/types";
import { buildMotionGrammarFrameSampler } from "./evaluator";
import type { MotionGrammarBinding } from "./types";

export const INTERFERENCE_CANDIDATE_SURFACE =
	"shared-presentation-orbit-field" as const;

export type InterferenceCandidateInput = {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly binding: MotionGrammarBinding;
	readonly bindings: readonly MotionGrammarBinding[];
	readonly driverNodeId: string;
	readonly ringNodeIds: readonly string[];
	readonly artboardId?: string | null;
};
export type InterferenceCandidateSample = {
	readonly nodeId: string;
	readonly position: { readonly x: number; readonly y: number };
	readonly scale: number;
	readonly opacity: number;
};

/** Samples the registered Interference field through shared presentation. */
export function sampleInterferencePresentationCandidate(
	input: InterferenceCandidateInput,
	frame: number,
):
	| {
			readonly status: "ready";
			readonly samples: readonly InterferenceCandidateSample[];
	  }
	| { readonly status: "blocked"; readonly reason: string } {
	const artboardId = input.artboardId ?? input.scene.artboard.id;
	const period = Math.max(1, input.binding.parameters.periodFrames ?? 96);
	const candidateFrame = ((frame % period) + period) % period;
	const layoutScene = materializeLayoutFramesForPresentation(input.scene);
	const grammar = buildExpressionAwareFrameSampler({
		scene: layoutScene,
		fps: input.motion.fps,
		baseSampler: buildMotionGrammarFrameSampler({
			bindings: input.bindings,
			scene: layoutScene,
			motion: input.motion,
		}),
	});
	if (!grammar)
		return {
			status: "blocked",
			reason: "Interference candidate has no shared presentation sampler.",
		};
	const presentation = sampleMotionPresentationFrame({
		scene: input.scene,
		motion: input.motion,
		frame: candidateFrame,
		artboardId,
		grammar,
	});
	const values = new Map(
		presentation.values.map((value) => [value.nodeId, value] as const),
	);
	const samples: InterferenceCandidateSample[] = [];
	for (const nodeId of input.ringNodeIds) {
		const node = findNode(input.scene, nodeId);
		const value = values.get(nodeId);
		if (!node || !value)
			return {
				status: "blocked",
				reason: `Interference presentation omitted ${nodeId}.`,
			};
		const scaleX = value.transform.scale.x / node.transform.scale.x;
		const scaleY = value.transform.scale.y / node.transform.scale.y;
		if (Math.abs(scaleX - scaleY) > 1e-8)
			return {
				status: "blocked",
				reason: `Interference emitted non-uniform scale for ${nodeId}.`,
			};
		samples.push({
			nodeId,
			position: value.transform.position,
			scale: (scaleX + scaleY) / 2,
			opacity: value.opacity / node.style.opacity,
		});
	}
	return { status: "ready", samples };
}
