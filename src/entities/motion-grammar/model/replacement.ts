import type { MotionDocument } from "@/entities/motion/model/types";
import type { MotionGrammarBinding } from "./types";

export type MotionGrammarRoleReplacementBlockerCode =
	| "same-node"
	| "missing-role"
	| "duplicate-target"
	| "duplicate-role"
	| "technique-role-not-replaceable";

export type MotionGrammarRoleReplacementPlan =
	| {
			readonly status: "blocked";
			readonly code: MotionGrammarRoleReplacementBlockerCode;
			readonly reason: string;
	  }
	| {
			readonly status: "ready";
			readonly bindingId: string;
			readonly fromNodeId: string;
			readonly toNodeId: string;
			readonly nextTargetIds: readonly string[];
			readonly nextRoleMap?: Readonly<Record<string, string>>;
			readonly retargetTrackIds: readonly string[];
			readonly retargetClipIds: readonly string[];
	  };

const replaceNodeIdList = (
	nodeIds: readonly string[],
	fromNodeId: string,
	toNodeId: string,
): readonly string[] =>
	nodeIds.map((nodeId) => (nodeId === fromNodeId ? toNodeId : nodeId));

const replaceRoleMapKey = (
	roleMap: Readonly<Record<string, string>> | undefined,
	fromNodeId: string,
	toNodeId: string,
): Readonly<Record<string, string>> | undefined => {
	if (!roleMap || !(fromNodeId in roleMap)) return roleMap;
	const nextRoleMap: Record<string, string> = {};
	for (const [nodeId, role] of Object.entries(roleMap)) {
		nextRoleMap[nodeId === fromNodeId ? toNodeId : nodeId] = role;
	}
	return nextRoleMap;
};

const clipProvenanceIncludesNode = (
	clip: MotionDocument["clips"][number],
	nodeId: string,
	bindingId: string,
): boolean => {
	if (!clip.provenance || clip.provenance.bindingId !== bindingId) return false;
	if (clip.provenance.targetIds.includes(nodeId)) return true;
	if (clip.provenance.generatedNodeIds.includes(nodeId)) return true;
	return (
		clip.provenance.editableArtifacts?.some((artifact) =>
			artifact.targetIds.includes(nodeId),
		) ?? false
	);
};

/**
 * Plans replacement of one role-bearing object in a motion-grammar binding.
 * The returned plan is store-free so UI and command coordinators can validate
 * imported-object replacement before mutating grammar or motion documents.
 */
export function createMotionGrammarRoleReplacementPlan({
	binding,
	motion,
	fromNodeId,
	toNodeId,
}: {
	readonly binding: MotionGrammarBinding;
	readonly motion: MotionDocument;
	readonly fromNodeId: string;
	readonly toNodeId: string;
}): MotionGrammarRoleReplacementPlan {
	if (
		binding.techniqueId === "noise-wipe" ||
		binding.techniqueId === "stroke-draw-on"
	) {
		return {
			status: "blocked",
			code: "technique-role-not-replaceable",
			reason:
				"This live semantic channel owns target-specific Scene setup; remove and reapply it to the replacement target instead.",
		};
	}
	if (fromNodeId === toNodeId) {
		return {
			status: "blocked",
			code: "same-node",
			reason: "Replacement node is already assigned to this role.",
		};
	}
	const roleIsTarget = binding.targetIds.includes(fromNodeId);
	const roleIsMapped = Boolean(binding.roleMap?.[fromNodeId]);
	if (!roleIsTarget && !roleIsMapped) {
		return {
			status: "blocked",
			code: "missing-role",
			reason: "Selected source node is not a role in this motion binding.",
		};
	}
	if (binding.targetIds.includes(toNodeId)) {
		return {
			status: "blocked",
			code: "duplicate-target",
			reason: "Replacement node is already used by this motion binding.",
		};
	}
	if (binding.roleMap?.[toNodeId]) {
		return {
			status: "blocked",
			code: "duplicate-role",
			reason: "Replacement node is already part of this motion binding.",
		};
	}

	return {
		status: "ready",
		bindingId: binding.id,
		fromNodeId,
		toNodeId,
		nextTargetIds: replaceNodeIdList(binding.targetIds, fromNodeId, toNodeId),
		nextRoleMap: replaceRoleMapKey(binding.roleMap, fromNodeId, toNodeId),
		retargetTrackIds: motion.tracks
			.filter((track) => track.target.nodeId === fromNodeId)
			.map((track) => track.id),
		retargetClipIds: motion.clips
			.filter((clip) =>
				clipProvenanceIncludesNode(clip, fromNodeId, binding.id),
			)
			.map((clip) => clip.id),
	};
}
