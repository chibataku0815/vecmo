import { sampleMotionPresentationFrame } from "@/entities/motion/model/presentation";
import type { MotionDocument } from "@/entities/motion/model/types";
import { buildExpressionAwareFrameSampler } from "@/entities/scene/model/expression-presentation";
import { materializeLayoutFramesForPresentation } from "@/entities/scene/model/layout-frame-presentation";
import { findNode } from "@/entities/scene/model/selectors";
import type { SceneDocument } from "@/entities/scene/model/types";
import { buildMotionGrammarFrameSampler } from "./evaluator";
import type { MotionGrammarBinding } from "./types";

export const FOLLOW_THROUGH_CANDIDATE_SURFACE =
	"shared-presentation-velocity-relation" as const;

export type FollowThroughCandidateInput = {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly binding: MotionGrammarBinding;
	readonly bindings: readonly MotionGrammarBinding[];
	readonly leaderNodeId: string;
	readonly followerNodeIds: readonly string[];
	readonly artboardId?: string | null;
};

export type FollowThroughCandidateSample = {
	readonly nodeId: string;
	readonly position: { readonly x: number; readonly y: number };
	readonly rotation: number;
};

/** Samples the registered Follow-through expression through shared presentation. */
export function sampleFollowThroughPresentationCandidate(
	input: FollowThroughCandidateInput,
	frame: number,
):
	| {
			readonly status: "ready";
			readonly samples: readonly FollowThroughCandidateSample[];
	  }
	| { readonly status: "blocked"; readonly reason: string } {
	const artboardId = input.artboardId ?? input.scene.artboard.id;
	const period = Math.max(1, input.binding.parameters.periodFrames ?? 120);
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
			reason: "Follow-through candidate has no shared presentation sampler.",
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
	const samples: FollowThroughCandidateSample[] = [];
	for (const nodeId of input.followerNodeIds) {
		const node = findNode(input.scene, nodeId);
		const value = values.get(nodeId);
		if (!node || !value)
			return {
				status: "blocked",
				reason: `Follow-through presentation omitted ${nodeId}.`,
			};
		samples.push({
			nodeId,
			position: value.transform.position,
			rotation: value.transform.rotation - node.transform.rotation,
		});
	}
	return { status: "ready", samples };
}
