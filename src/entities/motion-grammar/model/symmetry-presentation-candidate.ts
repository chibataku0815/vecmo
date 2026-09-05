import { sampleMotionPresentationFrame } from "@/entities/motion/model/presentation";
import type { MotionDocument } from "@/entities/motion/model/types";
import { buildExpressionAwareFrameSampler } from "@/entities/scene/model/expression-presentation";
import { materializeLayoutFramesForPresentation } from "@/entities/scene/model/layout-frame-presentation";
import { findNode } from "@/entities/scene/model/selectors";
import type { SceneDocument } from "@/entities/scene/model/types";
import { buildMotionGrammarFrameSampler } from "./evaluator";
import {
	SYMMETRY_CENTER_ROLE,
	SYMMETRY_INNER_LEFT_ROLE,
	SYMMETRY_INNER_RIGHT_ROLE,
	SYMMETRY_OUTER_LEFT_ROLE,
	SYMMETRY_OUTER_RIGHT_ROLE,
} from "./symmetry-pulse-v1";
import type { MotionGrammarBinding } from "./types";

export const SYMMETRY_CANDIDATE_SURFACE =
	"shared-presentation-symmetric-pulse" as const;

export type SymmetryCandidateInput = {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly binding: MotionGrammarBinding;
	readonly bindings: readonly MotionGrammarBinding[];
	readonly artboardId?: string | null;
};

export type SymmetryCandidateSample = {
	readonly targetId: string;
	readonly nodeId: string;
	readonly role: string;
	readonly position: { readonly x: number; readonly y: number };
	readonly scale: number;
	readonly rotation: number;
};

const ROLE_IDS = [
	SYMMETRY_OUTER_LEFT_ROLE,
	SYMMETRY_OUTER_RIGHT_ROLE,
	SYMMETRY_INNER_LEFT_ROLE,
	SYMMETRY_INNER_RIGHT_ROLE,
	SYMMETRY_CENTER_ROLE,
] as const;

const roleNodeId = (
	binding: MotionGrammarBinding,
	role: string,
): string | null => {
	const aliases = [role, `mirror-symmetric-scale:${role}`];
	for (const alias of aliases) {
		const direct = binding.roleMap?.[alias];
		if (direct && binding.targetIds.includes(direct)) return direct;
	}
	for (const nodeId of binding.targetIds) {
		if (aliases.includes(binding.roleMap?.[nodeId] ?? "")) return nodeId;
	}
	return null;
};

/** Samples the registered Symmetry expression through shared presentation. */
export function sampleSymmetryPresentationCandidate(
	input: SymmetryCandidateInput,
	frame: number,
):
	| {
			readonly status: "ready";
			readonly samples: readonly SymmetryCandidateSample[];
	  }
	| { readonly status: "blocked"; readonly reason: string } {
	const artboardId = input.artboardId ?? input.scene.artboard.id;
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
			reason: "Symmetry candidate has no shared presentation sampler.",
		};
	const presentation = sampleMotionPresentationFrame({
		scene: input.scene,
		motion: input.motion,
		frame:
			((frame % Math.max(1, input.binding.parameters.periodFrames ?? 120)) +
				Math.max(1, input.binding.parameters.periodFrames ?? 120)) %
			Math.max(1, input.binding.parameters.periodFrames ?? 120),
		artboardId,
		grammar,
	});
	const values = new Map(
		presentation.values.map((value) => [value.nodeId, value] as const),
	);
	const samples: SymmetryCandidateSample[] = [];
	for (const role of ROLE_IDS) {
		const nodeId = roleNodeId(input.binding, role);
		if (!nodeId)
			return {
				status: "blocked",
				reason: `Symmetry role ${role} is not mapped.`,
			};
		const node = findNode(input.scene, nodeId);
		const value = values.get(nodeId);
		if (!node || !value)
			return {
				status: "blocked",
				reason: `Symmetry presentation omitted ${nodeId}.`,
			};
		const scaleX = value.transform.scale.x / node.transform.scale.x;
		const scaleY = value.transform.scale.y / node.transform.scale.y;
		if (
			!Number.isFinite(scaleX) ||
			!Number.isFinite(scaleY) ||
			Math.abs(scaleX - scaleY) > 1e-8
		) {
			return {
				status: "blocked",
				reason: `Symmetry emitted a non-uniform scale for ${nodeId}.`,
			};
		}
		samples.push({
			targetId: nodeId,
			nodeId,
			role,
			position: value.transform.position,
			scale: (scaleX + scaleY) / 2,
			rotation: value.transform.rotation - node.transform.rotation,
		});
	}
	return { status: "ready", samples };
}
