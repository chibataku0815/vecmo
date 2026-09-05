import { castDraft } from "immer";
import {
	effectiveMesh,
	effectiveOpacity,
	effectiveShape,
	effectiveTransform,
} from "@/entities/motion/model/sampler";
import type { MotionDocument } from "@/entities/motion/model/types";
import type { SceneCommand } from "@/entities/scene/model/command";
import { cloneSceneDocument } from "@/entities/scene/model/factory";
import {
	findDraftLayerByNodeId,
	findLayerByNodeId,
	findNode,
	selectNodeArtboardMapping,
} from "@/entities/scene/model/selectors";
import type {
	NodeStyle,
	SceneDocument,
	SceneLayer,
	VectorNode,
} from "@/entities/scene/model/types";
import type {
	MotionGrammarDecompositionPlan,
	MotionGrammarDecompositionProvenance,
	MotionGrammarSceneNodePlan,
} from "./decomposition";

/** Namespaced node data key used to persist bake provenance without changing `VectorNode`. */
export const MOTION_GRAMMAR_GENERATED_NODE_DATA_KEY =
	"motionGrammarGeneratedNode";

/** Serializable provenance stored on every generated scene node clone. */
export type MotionGrammarGeneratedNodeData = {
	readonly kind: "motion-grammar-generated-node";
	readonly schemaVersion: 1;
	readonly idSeed: string;
	readonly generatedRootNodeId: string;
	readonly sourceNodeId: string;
	readonly sourceRootNodeId: string;
	readonly bindingId: string;
	readonly techniqueId: MotionGrammarDecompositionPlan["techniqueId"];
	readonly techniqueLabel: string;
	readonly role: MotionGrammarSceneNodePlan["role"];
	readonly copyIndex: number;
	readonly previewSourceFrameAtRangeStart: number;
	readonly opacityMultiplier: number;
	readonly scalarTrackIdSeeds: readonly string[];
	readonly provenance: MotionGrammarDecompositionProvenance;
};

export type MotionGrammarSceneNodeMaterializationIssueCode =
	| "missing-source-node"
	| "missing-source-layer"
	| "duplicate-generated-node-id"
	| "nested-source-node-unsupported"
	| "no-editable-layer"
	| "protected-source-layer-fallback"
	| "empty-scene-node-output";

/** Non-blocking and blocking issues detected before scene-node materialization. */
export type MotionGrammarSceneNodeMaterializationIssue = {
	readonly code: MotionGrammarSceneNodeMaterializationIssueCode;
	readonly severity: "warning" | "error";
	readonly idSeed?: string;
	readonly sourceNodeId?: string;
	readonly message: string;
};

/** Resolved layer-placement strategy for a generated scene node clone. */
export type MotionGrammarSceneNodePlacementResolution =
	| {
			readonly kind: "after-source-node";
			readonly layerId: string;
			readonly sourceNodeId: string;
	  }
	| {
			readonly kind: "editable-layer-end";
			readonly layerId: string;
			readonly sourceLayerId?: string;
			readonly reason: "source-layer-protected" | "source-layer-missing";
	  };

/** Concrete editable scene node planned from one `scene-node` decomposition output. */
export type MotionGrammarMaterializedSceneNode = {
	readonly idSeed: string;
	readonly nodeId: string;
	readonly sourceNodeId: string;
	readonly copyIndex: number;
	readonly role: MotionGrammarSceneNodePlan["role"];
	readonly scalarTrackIdSeeds: readonly string[];
	readonly placement: MotionGrammarSceneNodePlacementResolution;
};

/** Command-ready insertion payload for one generated scene-node clone. */
export type MotionGrammarSceneNodeMaterializationInsertion = {
	readonly node: VectorNode;
	readonly sourceNodeId: string;
	readonly idSeed: string;
	readonly placement: MotionGrammarSceneNodePlacementResolution;
};

/**
 * Serializable scene-node materialization plan. `nodeIdBySeed` and
 * `scalarTrackTargetNodeIds` are the handoff seams for scalar-track and clip
 * emitters so they can target concrete editable nodes after scene bake.
 */
export type MotionGrammarSceneNodeMaterializationPlan = {
	readonly schemaVersion: 1;
	readonly bindingId: string;
	readonly techniqueId: MotionGrammarDecompositionPlan["techniqueId"];
	readonly insertions: readonly MotionGrammarSceneNodeMaterializationInsertion[];
	readonly generatedNodes: readonly MotionGrammarMaterializedSceneNode[];
	readonly nodeIdBySeed: Readonly<Record<string, string>>;
	readonly scalarTrackTargetNodeIds: Readonly<Record<string, string>>;
	readonly issues: readonly MotionGrammarSceneNodeMaterializationIssue[];
};

const GENERATED_NODE_ID_PREFIX = "node";
const GENERATED_CHILD_ID_PART = "child";
const DEFAULT_COMMAND_LABEL = "Materialize grammar duplicates";

const isEditableLayer = (layer: SceneLayer): boolean =>
	layer.visible && !layer.locked;

const stableIdPart = (value: string): string => {
	const cleaned = value
		.replace(/[^a-zA-Z0-9_-]+/g, "_")
		.replace(/^_+|_+$/g, "");
	return cleaned.length > 0 ? cleaned : "generated";
};

const generatedRootNodeId = (idSeed: string): string =>
	[GENERATED_NODE_ID_PREFIX, stableIdPart(idSeed)].join("-");

const uniqueId = (usedIds: Set<string>, baseId: string): string => {
	if (!usedIds.has(baseId)) {
		usedIds.add(baseId);
		return baseId;
	}
	let suffix = 2;
	let candidate = `${baseId}-${suffix}`;
	while (usedIds.has(candidate)) {
		suffix += 1;
		candidate = `${baseId}-${suffix}`;
	}
	usedIds.add(candidate);
	return candidate;
};

const collectNodeIds = (
	nodes: readonly VectorNode[],
	out: Set<string>,
): void => {
	for (const node of nodes) {
		out.add(node.id);
		if (node.children) collectNodeIds(node.children, out);
	}
};

type NodeIdTree = {
	readonly id: string;
	readonly children?: readonly NodeIdTree[];
};

const collectNodeIdTree = (
	nodes: readonly NodeIdTree[],
	out: Set<string>,
): void => {
	for (const node of nodes) {
		out.add(node.id);
		if (node.children) collectNodeIdTree(node.children, out);
	}
};

const nodeIdTreeIds = (node: NodeIdTree): Set<string> => {
	const ids = new Set<string>();
	collectNodeIdTree([node], ids);
	return ids;
};

const draftNodeIds = (
	draft: Parameters<SceneCommand["run"]>[0],
): Set<string> => {
	const ids = new Set<string>();
	for (const layer of draft.layers) collectNodeIdTree(layer.nodes, ids);
	return ids;
};

const usedSceneNodeIds = (scene: SceneDocument): Set<string> => {
	const ids = new Set<string>();
	for (const layer of scene.layers) collectNodeIds(layer.nodes, ids);
	return ids;
};

const clampOpacity = (value: number): number => {
	if (!Number.isFinite(value)) return 1;
	return Math.min(1, Math.max(0, value));
};

const sampledStyle = (
	source: VectorNode,
	motion: MotionDocument,
	sourceFrame: number,
	opacityMultiplier: number,
): NodeStyle => {
	const style = cloneSceneDocument(source.style);
	const mesh = effectiveMesh(source, motion, sourceFrame);
	const fills =
		mesh && style.fills
			? ([mesh, ...style.fills.slice(1)] satisfies NodeStyle["fills"])
			: style.fills;
	return {
		...style,
		...(fills ? { fills } : {}),
		opacity: clampOpacity(
			effectiveOpacity(source, motion, sourceFrame) * opacityMultiplier,
		),
	};
};

const sourceGeometryAtFrame = (
	source: VectorNode,
	motion: MotionDocument,
	sourceFrame: number,
): VectorNode["geometry"] => {
	const shape = effectiveShape(source, motion, sourceFrame);
	if (shape && source.geometry.kind === "path") {
		return { ...cloneSceneDocument(source.geometry), shape };
	}
	return cloneSceneDocument(source.geometry);
};

const generatedNodeData = ({
	sceneNodePlan,
	sourceNodeId,
	generatedRootNodeId,
	idSeed,
}: {
	readonly sceneNodePlan: MotionGrammarSceneNodePlan;
	readonly sourceNodeId: string;
	readonly generatedRootNodeId: string;
	readonly idSeed: string;
}): MotionGrammarGeneratedNodeData => ({
	kind: "motion-grammar-generated-node",
	schemaVersion: 1,
	idSeed,
	generatedRootNodeId,
	sourceNodeId,
	sourceRootNodeId: sceneNodePlan.sourceNodeId,
	bindingId: sceneNodePlan.provenance.bindingId,
	techniqueId: sceneNodePlan.provenance.techniqueId,
	techniqueLabel: sceneNodePlan.provenance.techniqueLabel,
	role: sceneNodePlan.role,
	copyIndex: sceneNodePlan.copyIndex,
	previewSourceFrameAtRangeStart: sceneNodePlan.previewSourceFrameAtRangeStart,
	opacityMultiplier: sceneNodePlan.opacityMultiplier,
	scalarTrackIdSeeds:
		sourceNodeId === sceneNodePlan.sourceNodeId
			? sceneNodePlan.scalarTrackIdSeeds
			: [],
	provenance: sceneNodePlan.provenance,
});

const generatedChildNodeId = (
	parentGeneratedNodeId: string,
	sourceChildId: string,
): string =>
	[
		parentGeneratedNodeId,
		GENERATED_CHILD_ID_PART,
		stableIdPart(sourceChildId),
	].join("-");

const cloneGeneratedNode = ({
	source,
	motion,
	sceneNodePlan,
	nodeId,
	generatedRootNodeId,
	usedIds,
	inheritedArtboardId,
}: {
	readonly source: VectorNode;
	readonly motion: MotionDocument;
	readonly sceneNodePlan: MotionGrammarSceneNodePlan;
	readonly nodeId: string;
	readonly generatedRootNodeId: string;
	readonly usedIds: Set<string>;
	readonly inheritedArtboardId: string;
}): VectorNode => {
	const artboardId = source.artboardId ?? inheritedArtboardId;
	const children = source.children?.map((child) => {
		const childNodeId = uniqueId(
			usedIds,
			generatedChildNodeId(nodeId, child.id),
		);
		return cloneGeneratedNode({
			source: child,
			motion,
			sceneNodePlan,
			nodeId: childNodeId,
			generatedRootNodeId,
			usedIds,
			inheritedArtboardId: artboardId,
		});
	});
	const data = {
		...source.data,
		[MOTION_GRAMMAR_GENERATED_NODE_DATA_KEY]: generatedNodeData({
			sceneNodePlan,
			sourceNodeId: source.id,
			generatedRootNodeId,
			idSeed:
				source.id === sceneNodePlan.sourceNodeId
					? sceneNodePlan.idSeed
					: generatedChildNodeId(sceneNodePlan.idSeed, source.id),
		}),
	};
	const {
		component: _component,
		children: _children,
		...rest
	} = cloneSceneDocument(source);
	return {
		...rest,
		id: nodeId,
		name:
			source.id === sceneNodePlan.sourceNodeId
				? `${source.name} afterimage ${sceneNodePlan.copyIndex}`
				: source.name,
		artboardId,
		geometry: sourceGeometryAtFrame(
			source,
			motion,
			sceneNodePlan.previewSourceFrameAtRangeStart,
		),
		transform: effectiveTransform(
			source,
			motion,
			sceneNodePlan.previewSourceFrameAtRangeStart,
		),
		style: sampledStyle(
			source,
			motion,
			sceneNodePlan.previewSourceFrameAtRangeStart,
			sceneNodePlan.opacityMultiplier,
		),
		visible: true,
		locked: false,
		data,
		...(children ? { children } : {}),
	};
};

const fallbackEditableLayer = (
	scene: SceneDocument,
	preferredLayerId?: string,
): SceneLayer | undefined => {
	const preferred = preferredLayerId
		? scene.layers.find((layer) => layer.id === preferredLayerId)
		: undefined;
	if (preferred && isEditableLayer(preferred)) return preferred;
	return [...scene.layers].reverse().find(isEditableLayer);
};

const placementForPlan = (
	scene: SceneDocument,
	sceneNodePlan: MotionGrammarSceneNodePlan,
): {
	readonly placement?: MotionGrammarSceneNodePlacementResolution;
	readonly issues: readonly MotionGrammarSceneNodeMaterializationIssue[];
} => {
	const sourceLayer = findLayerByNodeId(scene, sceneNodePlan.sourceNodeId);
	if (!sourceLayer) {
		const fallback = fallbackEditableLayer(scene);
		return {
			placement: fallback
				? {
						kind: "editable-layer-end",
						layerId: fallback.id,
						reason: "source-layer-missing",
					}
				: undefined,
			issues: [
				{
					code: "missing-source-layer",
					severity: fallback ? "warning" : "error",
					idSeed: sceneNodePlan.idSeed,
					sourceNodeId: sceneNodePlan.sourceNodeId,
					message: `Source node "${sceneNodePlan.sourceNodeId}" has no owning scene layer for generated node "${sceneNodePlan.idSeed}".`,
				},
			],
		};
	}
	if (
		!sourceLayer.nodes.some((node) => node.id === sceneNodePlan.sourceNodeId)
	) {
		return {
			placement: undefined,
			issues: [
				{
					code: "nested-source-node-unsupported",
					severity: "error",
					idSeed: sceneNodePlan.idSeed,
					sourceNodeId: sceneNodePlan.sourceNodeId,
					message: `Generated node "${sceneNodePlan.idSeed}" targets nested source node "${sceneNodePlan.sourceNodeId}", which cannot be materialized without changing its coordinate space.`,
				},
			],
		};
	}
	if (isEditableLayer(sourceLayer)) {
		return {
			placement: {
				kind: "after-source-node",
				layerId: sourceLayer.id,
				sourceNodeId: sceneNodePlan.sourceNodeId,
			},
			issues: [],
		};
	}
	const fallback = fallbackEditableLayer(scene, sourceLayer.id);
	return {
		placement: fallback
			? {
					kind: "editable-layer-end",
					layerId: fallback.id,
					sourceLayerId: sourceLayer.id,
					reason: "source-layer-protected",
				}
			: undefined,
		issues: [
			{
				code: fallback
					? "protected-source-layer-fallback"
					: "no-editable-layer",
				severity: fallback ? "warning" : "error",
				idSeed: sceneNodePlan.idSeed,
				sourceNodeId: sceneNodePlan.sourceNodeId,
				message: fallback
					? `Source layer "${sourceLayer.id}" is hidden or locked, so generated node "${sceneNodePlan.idSeed}" will be placed in editable layer "${fallback.id}".`
					: `No visible unlocked layer can receive generated node "${sceneNodePlan.idSeed}".`,
			},
		],
	};
};

const sceneNodePlans = (
	plan: MotionGrammarDecompositionPlan,
): readonly MotionGrammarSceneNodePlan[] =>
	plan.outputs.filter(
		(output): output is MotionGrammarSceneNodePlan =>
			output.kind === "scene-node",
	);

/**
 * Creates editable scene-node clones from `scene-node` decomposition outputs
 * without mutating the stores. The plan keeps generated ids deterministic and
 * carries the scalar-track target mapping needed by downstream motion emitters.
 */
export function createMotionGrammarSceneNodeMaterializationPlan({
	decompositionPlan,
	scene,
	motion,
}: {
	readonly decompositionPlan: MotionGrammarDecompositionPlan;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
}): MotionGrammarSceneNodeMaterializationPlan {
	const outputs = sceneNodePlans(decompositionPlan);
	const issues: MotionGrammarSceneNodeMaterializationIssue[] = [];
	const insertions: MotionGrammarSceneNodeMaterializationInsertion[] = [];
	const generatedNodes: MotionGrammarMaterializedSceneNode[] = [];
	const nodeIdBySeed: Record<string, string> = {};
	const scalarTrackTargetNodeIds: Record<string, string> = {};
	const usedIds = usedSceneNodeIds(scene);
	const ownership = selectNodeArtboardMapping(scene);

	if (outputs.length === 0) {
		issues.push({
			code: "empty-scene-node-output",
			severity: "warning",
			message: `Decomposition plan "${decompositionPlan.bindingId}" has no scene-node outputs to materialize.`,
		});
	}

	for (const sceneNodePlan of outputs) {
		const source = findNode(scene, sceneNodePlan.sourceNodeId);
		if (!source) {
			issues.push({
				code: "missing-source-node",
				severity: "error",
				idSeed: sceneNodePlan.idSeed,
				sourceNodeId: sceneNodePlan.sourceNodeId,
				message: `Source node "${sceneNodePlan.sourceNodeId}" is missing for generated node "${sceneNodePlan.idSeed}".`,
			});
			continue;
		}
		const nodeId = generatedRootNodeId(sceneNodePlan.idSeed);
		if (usedIds.has(nodeId)) {
			issues.push({
				code: "duplicate-generated-node-id",
				severity: "error",
				idSeed: sceneNodePlan.idSeed,
				sourceNodeId: sceneNodePlan.sourceNodeId,
				message: `Generated node id "${nodeId}" already exists for seed "${sceneNodePlan.idSeed}".`,
			});
			continue;
		}
		usedIds.add(nodeId);
		const { placement, issues: placementIssues } = placementForPlan(
			scene,
			sceneNodePlan,
		);
		issues.push(...placementIssues);
		if (!placement) continue;

		const node = cloneGeneratedNode({
			source,
			motion,
			sceneNodePlan,
			nodeId,
			generatedRootNodeId: nodeId,
			usedIds,
			inheritedArtboardId:
				ownership.byNodeId[sceneNodePlan.sourceNodeId] ??
				scene.currentArtboardId ??
				scene.artboard.id,
		});
		insertions.push({
			node,
			sourceNodeId: sceneNodePlan.sourceNodeId,
			idSeed: sceneNodePlan.idSeed,
			placement,
		});
		generatedNodes.push({
			idSeed: sceneNodePlan.idSeed,
			nodeId,
			sourceNodeId: sceneNodePlan.sourceNodeId,
			copyIndex: sceneNodePlan.copyIndex,
			role: sceneNodePlan.role,
			scalarTrackIdSeeds: sceneNodePlan.scalarTrackIdSeeds,
			placement,
		});
		nodeIdBySeed[sceneNodePlan.idSeed] = nodeId;
		for (const trackIdSeed of sceneNodePlan.scalarTrackIdSeeds) {
			scalarTrackTargetNodeIds[trackIdSeed] = nodeId;
		}
	}

	return {
		schemaVersion: 1,
		bindingId: decompositionPlan.bindingId,
		techniqueId: decompositionPlan.techniqueId,
		insertions,
		generatedNodes,
		nodeIdBySeed,
		scalarTrackTargetNodeIds,
		issues,
	};
}

const draftNodeContains = (node: VectorNode, nodeId: string): boolean => {
	if (node.id === nodeId) return true;
	return (
		node.children?.some((child) => draftNodeContains(child, nodeId)) ?? false
	);
};

const topLevelIndexContainingNode = (
	nodes: readonly VectorNode[],
	nodeId: string,
): number => nodes.findIndex((node) => draftNodeContains(node, nodeId));

const fallbackEditableDraftLayer = (
	draft: Parameters<SceneCommand["run"]>[0],
	preferredLayerId?: string,
) => {
	const preferred = preferredLayerId
		? draft.layers.find((layer) => layer.id === preferredLayerId)
		: undefined;
	if (preferred?.visible && !preferred.locked) return preferred;
	return [...draft.layers]
		.reverse()
		.find((layer) => layer.visible && !layer.locked);
};

const draftPlacementLayer = (
	draft: Parameters<SceneCommand["run"]>[0],
	insertion: MotionGrammarSceneNodeMaterializationInsertion,
) => {
	if (insertion.placement.kind === "after-source-node") {
		const sourceLayer = findDraftLayerByNodeId(
			draft,
			insertion.placement.sourceNodeId,
		);
		if (sourceLayer?.visible && !sourceLayer.locked) return sourceLayer;
		return fallbackEditableDraftLayer(draft, sourceLayer?.id);
	}
	if (insertion.placement.reason === "source-layer-protected") {
		const sourceLayer = findDraftLayerByNodeId(draft, insertion.sourceNodeId);
		if (sourceLayer?.visible && !sourceLayer.locked) return sourceLayer;
	}
	return fallbackEditableDraftLayer(draft, insertion.placement.layerId);
};

/**
 * Builds one undoable scene command for a duplicate materialization plan. The
 * command re-resolves source layers at execution time, so normal scene command
 * ordering and undo/redo semantics remain the post-bake source of truth.
 */
export function createMaterializeMotionGrammarSceneNodesCommand(
	materializationPlan: MotionGrammarSceneNodeMaterializationPlan,
	options: {
		readonly label?: string;
		readonly coalesceKey?: string;
	} = {},
): SceneCommand {
	return {
		type: "scene/materialize-motion-grammar-nodes",
		label: options.label ?? DEFAULT_COMMAND_LABEL,
		coalesceKey:
			options.coalesceKey ??
			`scene/materialize-motion-grammar-nodes:${materializationPlan.bindingId}`,
		run: (draft) => {
			const insertedBySource = new Map<string, number>();
			for (const insertion of materializationPlan.insertions) {
				const existingIds = draftNodeIds(draft);
				const insertionIds = nodeIdTreeIds(insertion.node);
				if ([...insertionIds].some((id) => existingIds.has(id))) continue;
				const targetLayer = draftPlacementLayer(draft, insertion);
				if (!targetLayer) continue;
				let insertIndex = targetLayer.nodes.length;
				const sourceIndex = topLevelIndexContainingNode(
					targetLayer.nodes,
					insertion.sourceNodeId,
				);
				if (sourceIndex >= 0) {
					const key = `${targetLayer.id}:${insertion.sourceNodeId}`;
					const offset = insertedBySource.get(key) ?? 0;
					insertIndex = sourceIndex + 1 + offset;
					insertedBySource.set(key, offset + 1);
				}
				targetLayer.nodes.splice(
					Math.min(insertIndex, targetLayer.nodes.length),
					0,
					castDraft(cloneSceneDocument(insertion.node)),
				);
			}
		},
	};
}
