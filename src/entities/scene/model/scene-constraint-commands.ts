import { castDraft } from "immer";
import { createId } from "@/shared/lib/id";
import type { SceneCommand } from "./command";
import { cloneSceneDocument } from "./factory";
import { resolveMotionRelations } from "./motion-relations";
import { IDENTITY_MATRIX, matrixFromTransform } from "./rendering";
import {
	convertConstraintMatrixSpace,
	transformConstraintOffsetForMatrices,
} from "./scene-constraints";
import { findDraftNode, findNode, selectArtboardIdForNode } from "./selectors";
import type {
	PropertyRelation,
	RelationNumericProperty,
	SceneDocument,
	TransformConstraint,
	TransformConstraintChannel,
	TransformConstraintSpace,
} from "./types";

export type TransformConstraintCommandPlan =
	| {
			readonly status: "ready";
			readonly constraint: TransformConstraint;
			readonly command: SceneCommand;
	  }
	| { readonly status: "blocked"; readonly reason: string };

/** Plans a single-source transform constraint and captures keep-pose offset. */
export function planTransformConstraintCommand({
	scene,
	nodeId,
	sourceNodeId,
	channels,
	strength = 1,
	sourceSpace = "world",
	destinationSpace = "world",
	maintainOffset = true,
}: {
	readonly scene: SceneDocument;
	readonly nodeId: string;
	readonly sourceNodeId: string;
	readonly channels: readonly TransformConstraintChannel[];
	readonly strength?: number;
	readonly sourceSpace?: TransformConstraintSpace;
	readonly destinationSpace?: TransformConstraintSpace;
	readonly maintainOffset?: boolean;
}): TransformConstraintCommandPlan {
	const node = findNode(scene, nodeId);
	const source = findNode(scene, sourceNodeId);
	const normalizedChannels = [...new Set(channels)];
	if (!node || !source)
		return { status: "blocked", reason: "Target or source node is missing." };
	if (node.id === source.id)
		return { status: "blocked", reason: "A node cannot constrain itself." };
	if (node.motionParent)
		return {
			status: "blocked",
			reason:
				"Detach the full motion parent before adding a channel constraint.",
		};
	if (normalizedChannels.length === 0)
		return {
			status: "blocked",
			reason: "At least one transform channel is required.",
		};
	if (
		selectArtboardIdForNode(scene, node.id) !==
		selectArtboardIdForNode(scene, source.id)
	)
		return {
			status: "blocked",
			reason: "Transform constraints must stay inside one artboard.",
		};
	const visited = new Set<string>();
	let dependencyId: string | undefined = source.id;
	while (dependencyId && !visited.has(dependencyId)) {
		if (dependencyId === node.id)
			return {
				status: "blocked",
				reason: "The transform constraint would create a dependency cycle.",
			};
		visited.add(dependencyId);
		const dependency = findNode(scene, dependencyId);
		dependencyId =
			dependency?.transformConstraint?.sourceNodeId ??
			dependency?.motionParent?.parentNodeId;
	}
	const resolution = resolveMotionRelations({ sampledScene: scene });
	const targetParentId = resolution.structuralParentNodeIdById.get(node.id);
	const sourceParentId = resolution.structuralParentNodeIdById.get(source.id);
	const targetParentWorld = targetParentId
		? (resolution.worldMatrixByNodeId.get(targetParentId) ?? IDENTITY_MATRIX)
		: IDENTITY_MATRIX;
	const sourceParentWorld = sourceParentId
		? (resolution.worldMatrixByNodeId.get(sourceParentId) ?? IDENTITY_MATRIX)
		: IDENTITY_MATRIX;
	const targetMatrix =
		destinationSpace === "world"
			? (resolution.worldMatrixByNodeId.get(node.id) ??
				matrixFromTransform(node.transform))
			: matrixFromTransform(node.transform);
	const sourceMatrix = convertConstraintMatrixSpace({
		matrix:
			sourceSpace === "world"
				? (resolution.worldMatrixByNodeId.get(source.id) ??
					matrixFromTransform(source.transform))
				: matrixFromTransform(source.transform),
		from: sourceSpace,
		to: destinationSpace,
		structuralParentWorld:
			sourceSpace === "local" && destinationSpace === "world"
				? sourceParentWorld
				: targetParentWorld,
	});
	if (!sourceMatrix)
		return {
			status: "blocked",
			reason: "The requested space conversion is singular.",
		};
	const constraint: TransformConstraint = {
		id: createId("transform-constraint"),
		sourceNodeId,
		channels: normalizedChannels,
		strength: Math.min(1, Math.max(0, strength)),
		sourceSpace,
		destinationSpace,
		maintainOffset,
		...(maintainOffset
			? {
					offset: transformConstraintOffsetForMatrices(
						targetMatrix,
						sourceMatrix,
						node.transform.anchor,
					),
				}
			: {}),
	};
	return {
		status: "ready",
		constraint,
		command: createSetTransformConstraintCommand(nodeId, constraint),
	};
}

/** Sets or replaces a target-owned transform constraint in one undo entry. */
export function createSetTransformConstraintCommand(
	nodeId: string,
	constraint: TransformConstraint,
): SceneCommand {
	return {
		type: "scene/set-transform-constraint",
		label: "Set transform constraint",
		run: (draft) => {
			const node = findDraftNode(draft, nodeId);
			if (!node || node.id === constraint.sourceNodeId || node.motionParent)
				return;
			node.transformConstraint = castDraft(cloneSceneDocument(constraint));
		},
	};
}

/** Removes the selected node's channel constraint without changing authored TRS. */
export function createRemoveTransformConstraintCommand(
	nodeId: string,
): SceneCommand {
	return {
		type: "scene/remove-transform-constraint",
		label: "Remove transform constraint",
		run: (draft) => {
			const node = findDraftNode(draft, nodeId);
			if (node?.transformConstraint) delete node.transformConstraint;
		},
	};
}

/** Creates or replaces one target-property relation by target registry id. */
export function createSetPropertyRelationCommand({
	id,
	nodeId,
	sourceNodeId,
	sourceProperty,
	targetProperty,
	scale = 1,
	offset = 0,
	clamp,
}: {
	readonly id?: string;
	readonly nodeId: string;
	readonly sourceNodeId: string;
	readonly sourceProperty: RelationNumericProperty;
	readonly targetProperty: RelationNumericProperty;
	readonly scale?: number;
	readonly offset?: number;
	readonly clamp?: PropertyRelation["clamp"];
}): SceneCommand {
	return {
		type: "scene/set-property-relation",
		label: "Set property relation",
		run: (draft) => {
			if (
				nodeId === sourceNodeId ||
				!Number.isFinite(scale) ||
				!Number.isFinite(offset) ||
				(clamp !== undefined &&
					(!Number.isFinite(clamp.min) ||
						!Number.isFinite(clamp.max) ||
						clamp.min > clamp.max))
			)
				return;
			const node = findDraftNode(draft, nodeId);
			const source = findDraftNode(draft, sourceNodeId);
			if (!node || !source) return;
			if (
				selectArtboardIdForNode(draft, node.id) !==
				selectArtboardIdForNode(draft, source.id)
			)
				return;
			const visited = new Set<string>();
			let dependencyNodeId = sourceNodeId;
			let dependencyProperty = sourceProperty;
			while (!visited.has(`${dependencyNodeId}:${dependencyProperty}`)) {
				if (
					dependencyNodeId === nodeId &&
					dependencyProperty === targetProperty
				)
					return;
				visited.add(`${dependencyNodeId}:${dependencyProperty}`);
				const dependencyNode = findDraftNode(draft, dependencyNodeId);
				const dependencyRelation = dependencyNode?.propertyRelations?.find(
					(candidate) => candidate.targetProperty === dependencyProperty,
				);
				if (!dependencyRelation) break;
				dependencyNodeId = dependencyRelation.sourceNodeId;
				dependencyProperty = dependencyRelation.sourceProperty;
			}
			const relation: PropertyRelation = {
				id:
					id ??
					node.propertyRelations?.find(
						(candidate) => candidate.targetProperty === targetProperty,
					)?.id ??
					createId("property-relation"),
				sourceNodeId,
				sourceProperty,
				targetProperty,
				scale,
				offset,
				...(clamp ? { clamp } : {}),
			};
			node.propertyRelations = castDraft([
				...(node.propertyRelations?.filter(
					(candidate) =>
						candidate.id !== relation.id &&
						candidate.targetProperty !== targetProperty,
				) ?? []),
				relation,
			]);
		},
	};
}

/** Removes one property relation by stable relation identity. */
export function createRemovePropertyRelationCommand(
	nodeId: string,
	relationId: string,
): SceneCommand {
	return {
		type: "scene/remove-property-relation",
		label: "Remove property relation",
		run: (draft) => {
			const node = findDraftNode(draft, nodeId);
			if (!node?.propertyRelations) return;
			const next = node.propertyRelations.filter(
				(relation) => relation.id !== relationId,
			);
			if (next.length === node.propertyRelations.length) return;
			if (next.length === 0) delete node.propertyRelations;
			else node.propertyRelations = castDraft(next);
		},
	};
}
