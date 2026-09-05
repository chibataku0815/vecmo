import { castDraft } from "immer";
import type { SceneCommand } from "./command";
import { cloneSceneDocument } from "./factory";
import {
	type MotionRelationIssue,
	planMotionParentBinding,
	resolveMotionRelations,
	validateMotionParentTarget,
} from "./motion-relations";
import {
	composeMatrix,
	invertMatrix,
	matrixFromTransform,
	transformFromMatrix,
} from "./rendering";
import { findDraftNode, findNode } from "./selectors";
import type { MotionParentBinding, SceneDocument, Transform } from "./types";

export type BindMotionParentsCommandPlan =
	| {
			readonly status: "ready";
			readonly command: SceneCommand;
			readonly bindings: ReadonlyMap<string, MotionParentBinding>;
	  }
	| {
			readonly status: "blocked";
			readonly issues: readonly MotionRelationIssue[];
	  };

export type DetachMotionParentsCommandPlan =
	| {
			readonly status: "ready";
			readonly command: SceneCommand;
			readonly transforms: ReadonlyMap<string, Transform>;
	  }
	| {
			readonly status: "blocked";
			readonly issues: readonly MotionRelationIssue[];
	  };

/**
 * Plans one undoable keep-world bind for multiple children. Every binding is
 * derived from the same rest/sampled snapshots; if any child is invalid, the
 * whole operation is blocked so a multi-selection cannot be partially rigged.
 */
export function planBindMotionParentsCommand({
	restScene,
	sampledScene,
	nodeIds,
	parentNodeId,
	label = "Parent to motion controller",
}: {
	readonly restScene: SceneDocument;
	readonly sampledScene: SceneDocument;
	readonly nodeIds: readonly string[];
	readonly parentNodeId: string;
	readonly label?: string;
}): BindMotionParentsCommandPlan {
	const uniqueNodeIds = [...new Set(nodeIds)].filter(
		(nodeId) => nodeId !== parentNodeId,
	);
	const bindings = new Map<string, MotionParentBinding>();
	const issues: MotionRelationIssue[] = [];
	for (const nodeId of uniqueNodeIds) {
		const plan = planMotionParentBinding({
			restScene,
			sampledScene,
			nodeId,
			parentNodeId,
		});
		if (plan.status === "blocked") {
			issues.push(...plan.issues);
			continue;
		}
		bindings.set(nodeId, plan.binding);
	}
	if (uniqueNodeIds.length === 0 || issues.length > 0) {
		return { status: "blocked", issues };
	}
	return {
		status: "ready",
		bindings,
		command: {
			type: "scene/set-motion-parents",
			label,
			coalesceKey: `motion-parent:${parentNodeId}:${uniqueNodeIds.join(",")}`,
			run: (draft) => {
				for (const [nodeId, binding] of bindings) {
					if (
						validateMotionParentTarget(
							draft as unknown as SceneDocument,
							nodeId,
							binding.parentNodeId,
						).length > 0
					) {
						return;
					}
				}
				for (const [nodeId, binding] of bindings) {
					const node = findDraftNode(draft, nodeId);
					if (!node) continue;
					node.motionParent = castDraft(cloneSceneDocument(binding));
				}
			},
		},
	};
}

const matricesMatch = (
	left: ReturnType<typeof matrixFromTransform>,
	right: ReturnType<typeof matrixFromTransform>,
): boolean =>
	Object.keys(left).every((key) => {
		const channel = key as keyof typeof left;
		return Math.abs(left[channel] - right[channel]) <= 1e-9;
	});

/**
 * Plans pose-preserving detach for children whose own local transform is not
 * animated at the supplied frame. Animated-local detach is blocked explicitly;
 * its exact implementation must write Scene and Motion stores together rather
 * than silently replacing or baking the existing child curve.
 */
export function planDetachMotionParentsCommand({
	restScene,
	sampledScene,
	nodeIds,
	allowLocalMotionWrite = false,
}: {
	readonly restScene: SceneDocument;
	readonly sampledScene: SceneDocument;
	readonly nodeIds: readonly string[];
	/** Caller will pair the scene detach with MotionDocument keys at this frame. */
	readonly allowLocalMotionWrite?: boolean;
}): DetachMotionParentsCommandPlan {
	const targets = [...new Set(nodeIds)].filter(
		(nodeId) => findNode(restScene, nodeId)?.motionParent !== undefined,
	);
	const resolution = resolveMotionRelations({ restScene, sampledScene });
	const transforms = new Map<string, Transform>();
	const issues: MotionRelationIssue[] = [];
	for (const nodeId of targets) {
		const restNode = findNode(restScene, nodeId);
		const sampledNode = findNode(sampledScene, nodeId);
		if (!restNode || !sampledNode) continue;
		if (
			!allowLocalMotionWrite &&
			!matricesMatch(
				matrixFromTransform(restNode.transform),
				matrixFromTransform(sampledNode.transform),
			)
		) {
			issues.push({
				code: "motion-parent-detach-requires-motion-write",
				severity: "error",
				message: `Node "${nodeId}" has sampled local motion; pose-preserving detach requires a compound MotionDocument write.`,
				nodeId,
				...(restNode.motionParent?.parentNodeId
					? { parentNodeId: restNode.motionParent.parentNodeId }
					: {}),
			});
			continue;
		}
		const world = resolution.worldMatrixByNodeId.get(nodeId);
		const structuralParentId =
			resolution.structuralParentNodeIdById.get(nodeId);
		const structuralParentWorld = structuralParentId
			? resolution.worldMatrixByNodeId.get(structuralParentId)
			: undefined;
		const inverseParent = structuralParentWorld
			? invertMatrix(structuralParentWorld)
			: {
					a: 1,
					b: 0,
					c: 0,
					d: 1,
					e: 0,
					f: 0,
				};
		if (!world || !inverseParent) {
			issues.push({
				code: "motion-parent-render-parent-singular",
				severity: "error",
				message: `Node "${nodeId}" cannot detach because its structural render parent is singular.`,
				nodeId,
				...(structuralParentId ? { parentNodeId: structuralParentId } : {}),
			});
			continue;
		}
		transforms.set(
			nodeId,
			transformFromMatrix(
				composeMatrix(inverseParent, world),
				restNode.transform.anchor,
			),
		);
	}
	if (targets.length === 0 || issues.length > 0) {
		return { status: "blocked", issues };
	}
	return {
		status: "ready",
		transforms,
		command: {
			type: "scene/detach-motion-parents",
			label:
				targets.length === 1 ? "Detach motion parent" : "Detach motion parents",
			coalesceKey: `motion-parent:detach:${targets.join(",")}`,
			run: (draft) => {
				for (const [nodeId, transform] of transforms) {
					const node = findDraftNode(draft, nodeId);
					if (!node?.motionParent) continue;
					node.transform = castDraft(cloneSceneDocument(transform));
					delete node.motionParent;
				}
			},
		},
	};
}
