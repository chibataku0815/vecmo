import type { MotionCommand } from "@/entities/motion/model/command";
import {
	planMotionRelationDetachAtFrame,
	sampleMotionRelationLocalScene,
} from "@/entities/motion/model/relation-authoring";
import { useMotionStore } from "@/entities/motion/model/store";
import type { MotionDocument } from "@/entities/motion/model/types";
import type { SceneCommand } from "@/entities/scene/model/command";
import { planBindMotionParentsCommand } from "@/entities/scene/model/motion-relation-commands";
import type { MotionRelationIssue } from "@/entities/scene/model/motion-relations";
import {
	buildMotionControllerNode,
	createAddMotionControllerNodeCommand,
} from "@/entities/scene/model/scene-camera-commands";
import {
	findLayerByNodeId,
	findNode,
	selectArtboardIdForNode,
	selectCurrentArtboard,
} from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import type {
	SceneDocument,
	Vec2,
	VectorNode,
} from "@/entities/scene/model/types";
import { createId } from "@/shared/lib/id";

export type MotionRelationAuthoringPlan = {
	readonly commands: readonly SceneCommand[];
	readonly motionCommands: readonly MotionCommand[];
	readonly selection: {
		readonly nodeIds: readonly string[];
		readonly primaryNodeId: string | null;
	};
	readonly transaction?: {
		readonly coalesceKey: string;
		readonly label: string;
	};
	readonly issues: readonly MotionRelationIssue[];
};

/**
 * Commits a general motion-relation plan through the Scene/Motion command buses.
 * Cross-store detach uses one compound id so undo restores both the relation and
 * the pose-preserving current-frame keys atomically.
 */
export function commitMotionRelationAuthoringPlan(
	plan: MotionRelationAuthoringPlan,
): void {
	const compoundId =
		plan.commands.length > 0 && plan.motionCommands.length > 0
			? createId("motion-relation")
			: undefined;
	const sceneCommands = compoundId
		? plan.commands.map((command) => ({ ...command, compoundId }))
		: plan.commands;
	const motionCommands = compoundId
		? plan.motionCommands.map((command) => ({
				...command,
				compoundId,
				coalesceKey: compoundId,
			}))
		: plan.motionCommands;
	const sceneStore = useSceneStore.getState();
	if (sceneCommands.length > 1 && plan.transaction && !compoundId) {
		sceneStore.beginTransaction(
			plan.transaction.coalesceKey,
			plan.transaction.label,
		);
		for (const command of sceneCommands) sceneStore.apply(command);
		sceneStore.commit();
	} else {
		for (const command of sceneCommands) sceneStore.apply(command);
	}
	for (const command of motionCommands)
		useMotionStore.getState().apply(command);
}

const appendNode = (
	scene: SceneDocument,
	node: VectorNode,
	layerId: string,
): SceneDocument => ({
	...scene,
	layers: scene.layers.map((layer) =>
		layer.id === layerId ? { ...layer, nodes: [...layer.nodes, node] } : layer,
	),
});

const controllerPosition = (
	sampledScene: SceneDocument,
	nodeIds: readonly string[],
	artboardId: string,
): Vec2 => {
	const nodes = nodeIds.flatMap((nodeId) => {
		const node = findNode(sampledScene, nodeId);
		return node ? [node] : [];
	});
	if (nodes.length === 0) {
		const artboard =
			sampledScene.artboards?.find(
				(candidate) => candidate.id === artboardId,
			) ?? sampledScene.artboard;
		return { x: artboard.width / 2, y: artboard.height / 2 };
	}
	return {
		x:
			nodes.reduce((sum, node) => sum + node.transform.position.x, 0) /
			nodes.length,
		y:
			nodes.reduce((sum, node) => sum + node.transform.position.y, 0) /
			nodes.length,
	};
};

/** Creates a general controller and optionally binds the current selection. */
export function createMotionControllerWithSelectionPlan({
	scene,
	motion,
	frame,
	nodeIds,
}: {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly frame: number;
	readonly nodeIds: readonly string[];
}): MotionRelationAuthoringPlan | null {
	if (scene.layers.length === 0) return null;
	const sampledScene = sampleMotionRelationLocalScene(scene, motion, frame);
	const selectedNodes = nodeIds.flatMap((nodeId) => {
		const node = findNode(scene, nodeId);
		return node ? [node] : [];
	});
	const selectedArtboardIds = new Set(
		selectedNodes.flatMap((node) => {
			const artboardId = selectArtboardIdForNode(scene, node.id);
			return artboardId ? [artboardId] : [];
		}),
	);
	if (selectedArtboardIds.size > 1) return null;
	const artboardId =
		selectedArtboardIds.values().next().value ??
		selectCurrentArtboard(scene).id;
	const primaryNodeId = nodeIds.at(-1);
	const layerId =
		(primaryNodeId ? findLayerByNodeId(scene, primaryNodeId)?.id : undefined) ??
		scene.layers.at(-1)?.id;
	if (!layerId) return null;
	const position = controllerPosition(sampledScene, nodeIds, artboardId);
	const controller = buildMotionControllerNode(scene, {
		name: "Motion Controller",
		artboardId,
		position: { ...position, z: 0 },
		visible: true,
	});
	if (!controller) return null;
	const restWithController = appendNode(scene, controller, layerId);
	const sampledWithController = appendNode(sampledScene, controller, layerId);
	const bindPlan =
		nodeIds.length > 0
			? planBindMotionParentsCommand({
					restScene: restWithController,
					sampledScene: sampledWithController,
					nodeIds,
					parentNodeId: controller.id,
				})
			: null;
	if (bindPlan?.status === "blocked") {
		return {
			commands: [],
			motionCommands: [],
			selection: { nodeIds, primaryNodeId: primaryNodeId ?? null },
			issues: bindPlan.issues,
		};
	}
	const commands = [
		createAddMotionControllerNodeCommand(controller, {
			layerId,
			label: "Create motion controller",
		}),
		...(bindPlan?.status === "ready" ? [bindPlan.command] : []),
	];
	return {
		commands,
		motionCommands: [],
		selection: { nodeIds: [controller.id], primaryNodeId: controller.id },
		...(commands.length > 1
			? {
					transaction: {
						coalesceKey: `motion-parent:create:${controller.id}`,
						label: "Create motion controller",
					},
				}
			: {}),
		issues: [],
	};
}

/** Parents every non-primary selected node to the primary controller. */
export function createParentSelectionToPrimaryPlan({
	scene,
	motion,
	frame,
	nodeIds,
	primaryNodeId,
}: {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly frame: number;
	readonly nodeIds: readonly string[];
	readonly primaryNodeId: string;
}): MotionRelationAuthoringPlan | null {
	const parent = findNode(scene, primaryNodeId);
	if (parent?.motionController?.kind !== "motion-controller") return null;
	const children = nodeIds.filter((nodeId) => nodeId !== primaryNodeId);
	const sampledScene = sampleMotionRelationLocalScene(scene, motion, frame);
	const plan = planBindMotionParentsCommand({
		restScene: scene,
		sampledScene,
		nodeIds: children,
		parentNodeId: primaryNodeId,
	});
	if (plan.status === "blocked") {
		return {
			commands: [],
			motionCommands: [],
			selection: { nodeIds, primaryNodeId },
			issues: plan.issues,
		};
	}
	return {
		commands: [plan.command],
		motionCommands: [],
		selection: { nodeIds, primaryNodeId },
		issues: [],
	};
}

/** Detaches the selected children while preserving the current sampled pose. */
export function createDetachSelectionPlan({
	scene,
	motion,
	frame,
	nodeIds,
	primaryNodeId,
}: {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly frame: number;
	readonly nodeIds: readonly string[];
	readonly primaryNodeId: string | null;
}): MotionRelationAuthoringPlan {
	const plan = planMotionRelationDetachAtFrame({
		scene,
		motion,
		frame,
		nodeIds,
	});
	if (plan.status === "blocked") {
		return {
			commands: [],
			motionCommands: [],
			selection: { nodeIds, primaryNodeId },
			issues: plan.issues,
		};
	}
	return {
		commands: [plan.sceneCommand],
		motionCommands: plan.motionCommands,
		selection: { nodeIds, primaryNodeId },
		issues: [],
	};
}
