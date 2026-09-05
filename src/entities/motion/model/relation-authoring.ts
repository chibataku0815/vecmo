import type { SceneCommand } from "@/entities/scene/model/command";
import { planDetachMotionParentsCommand } from "@/entities/scene/model/motion-relation-commands";
import type { MotionRelationIssue } from "@/entities/scene/model/motion-relations";
import { findNode } from "@/entities/scene/model/selectors";
import type { SceneDocument, VectorNode } from "@/entities/scene/model/types";
import type { MotionCommand } from "./command";
import { enablePositionPath, upsertKeyframe } from "./commands";
import { sampleMotionPresentationValues } from "./presentation";
import { findTrack } from "./sampler";
import type { MotionDocument } from "./types";

export type MotionRelationDetachPlan =
	| {
			readonly status: "ready";
			readonly sceneCommand: SceneCommand;
			readonly motionCommands: readonly MotionCommand[];
	  }
	| {
			readonly status: "blocked";
			readonly issues: readonly MotionRelationIssue[];
	  };

const replaceNode = (
	nodes: readonly VectorNode[],
	nodeId: string,
	replacement: VectorNode,
): readonly VectorNode[] => {
	let changed = false;
	const next = nodes.map((node) => {
		if (node.id === nodeId) {
			changed = true;
			return replacement;
		}
		if (!node.children) return node;
		const children = replaceNode(node.children, nodeId, replacement);
		if (children === node.children) return node;
		changed = true;
		return { ...node, children };
	});
	return changed ? next : nodes;
};

/** Samples only node-local Motion channels, before controller/camera relations. */
export function sampleMotionRelationLocalScene(
	scene: SceneDocument,
	motion: MotionDocument,
	frame: number,
): SceneDocument {
	const sampled = sampleMotionPresentationValues({ scene, motion, frame });
	let result = scene;
	for (const value of sampled.values) {
		const node = findNode(result, value.nodeId);
		if (!node) continue;
		const replacement = {
			...node,
			transform: value.transform,
			style: { ...node.style, opacity: value.opacity },
			...(value.pathShape && node.geometry.kind === "path"
				? { geometry: { ...node.geometry, shape: value.pathShape } }
				: {}),
		};
		let changed = false;
		const layers = result.layers.map((layer) => {
			const nodes = replaceNode(layer.nodes, node.id, replacement);
			if (nodes === layer.nodes) return layer;
			changed = true;
			return { ...layer, nodes };
		});
		if (changed) result = { ...result, layers };
	}
	return result;
}

/**
 * Plans pose-preserving detach across Scene and Motion without touching stores.
 * Existing animated local channels receive current-frame keys; an interior
 * spatial path receives an exact stop instead of immediately jumping back onto
 * its old cubic segment.
 */
export function planMotionRelationDetachAtFrame({
	scene,
	motion,
	frame,
	nodeIds,
}: {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly frame: number;
	readonly nodeIds: readonly string[];
}): MotionRelationDetachPlan {
	const sampledScene = sampleMotionRelationLocalScene(scene, motion, frame);
	const plan = planDetachMotionParentsCommand({
		restScene: scene,
		sampledScene,
		nodeIds,
		allowLocalMotionWrite: true,
	});
	if (plan.status === "blocked") return plan;
	const keyedProperties = [
		"x",
		"y",
		"anchorX",
		"anchorY",
		"rotation",
		"scaleX",
		"scaleY",
	] as const;
	const motionCommands = [...plan.transforms].flatMap(([nodeId, transform]) => {
		const positionPath = motion.positionPaths?.find(
			(path) => path.nodeId === nodeId,
		);
		const firstPathFrame = positionPath?.keys.at(0)?.frame;
		const lastPathFrame = positionPath?.keys.at(-1)?.frame;
		const requiresSpatialStop =
			positionPath !== undefined &&
			firstPathFrame !== undefined &&
			lastPathFrame !== undefined &&
			frame > firstPathFrame &&
			frame < lastPathFrame &&
			!positionPath.keys.some((key) => key.frame === frame);
		const spatialCommand = requiresSpatialStop
			? (() => {
					const xTrack = findTrack(motion, nodeId, "x");
					const yTrack = findTrack(motion, nodeId, "y");
					const seeds = positionPath.keys.flatMap((key) => {
						const x = xTrack?.keyframes.find(
							(candidate) => candidate.time === key.frame,
						)?.value;
						const y = yTrack?.keyframes.find(
							(candidate) => candidate.time === key.frame,
						)?.value;
						return typeof x === "number" && typeof y === "number"
							? [{ ...key, position: { x, y } }]
							: [];
					});
					if (seeds.length !== positionPath.keys.length) return [];
					return [
						enablePositionPath(nodeId, [
							...seeds,
							{ frame, position: transform.position, spatialMode: "auto" },
						]),
					];
				})()
			: [];
		const keyedCommands = keyedProperties.flatMap((property) => {
			if (requiresSpatialStop && (property === "x" || property === "y"))
				return [];
			if (!findTrack(motion, nodeId, property)?.keyframes.length) return [];
			const value =
				property === "x"
					? transform.position.x
					: property === "y"
						? transform.position.y
						: property === "anchorX"
							? transform.anchor.x
							: property === "anchorY"
								? transform.anchor.y
								: property === "rotation"
									? transform.rotation
									: property === "scaleX"
										? transform.scale.x
										: transform.scale.y;
			return [upsertKeyframe(nodeId, property, frame, value)];
		});
		return [...spatialCommand, ...keyedCommands];
	});
	return { status: "ready", sceneCommand: plan.command, motionCommands };
}
