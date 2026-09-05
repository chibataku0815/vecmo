import type { MotionDocument } from "@/entities/motion/model/types";
import type { MotionGrammarBinding } from "@/entities/motion-grammar/model/types";
import {
	findArtboardById,
	findNode,
	selectArtboardIdForNode,
	selectCurrentArtboard,
} from "@/entities/scene/model/selectors";
import { sceneNodeVisualAabb } from "@/entities/scene/model/spatial";
import {
	type Artboard,
	type Bounds,
	type Paint,
	SCENE_SCHEMA_VERSION,
	type SceneAsset,
	type SceneDocument,
	type SceneLayer,
	type VectorNode,
} from "@/entities/scene/model/types";
import { createSvgExport, type SvgExportAsset } from "./svg";

export type IndividualVectorExportIssueCode =
	| "vector-selection-empty"
	| "vector-selection-missing";

export type IndividualVectorExportIssue = {
	readonly code: IndividualVectorExportIssueCode;
	readonly message: string;
	readonly nodeId?: string;
};

export type IndividualVectorSvgExport = {
	readonly assets: readonly SvgExportAsset[];
	readonly exportedNodeIds: readonly string[];
	readonly issues: readonly IndividualVectorExportIssue[];
};

const MIN_VECTOR_EXPORT_DIMENSION = 1;

const slugify = (value: string): string =>
	value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

const uniqueStrings = (values: readonly string[]): readonly string[] => [
	...new Set(values),
];

const clonePojo = <Value>(value: Value): Value =>
	JSON.parse(JSON.stringify(value)) as Value;

const collectNodeIds = (node: VectorNode): readonly string[] => [
	node.id,
	...(node.children ?? []).flatMap(collectNodeIds),
];

const collectPaintAssetIds = (paint: Paint | undefined): readonly string[] => {
	if (!paint) return [];
	if (paint.kind === "image-reference" && paint.assetId) return [paint.assetId];
	return [];
};

const collectNodeAssetIds = (node: VectorNode): readonly string[] => [
	...(node.geometry.kind === "image" ? [node.geometry.assetId] : []),
	...collectPaintAssetIds(node.style.fills?.[0]),
	...collectPaintAssetIds(node.style.strokes?.[0]),
	...(node.style.fills ?? []).flatMap(collectPaintAssetIds),
	...(node.style.strokes ?? []).flatMap(collectPaintAssetIds),
	...(node.children ?? []).flatMap(collectNodeAssetIds),
];

const assetsForNode = (
	assets: readonly SceneAsset[] | undefined,
	node: VectorNode,
): readonly SceneAsset[] | undefined => {
	if (!assets || assets.length === 0) return undefined;
	const referenced = new Set(collectNodeAssetIds(node));
	if (referenced.size === 0) return undefined;
	const scoped = assets.filter((asset) => referenced.has(asset.id));
	return scoped.length > 0 ? scoped : undefined;
};

const vectorFileStem = (
	scene: SceneDocument,
	node: VectorNode,
	index: number,
): string => {
	const sceneStem = slugify(scene.name) || slugify(scene.id) || "scene";
	const nodeStem =
		slugify(node.name) || slugify(node.id) || `vector-${index + 1}`;
	return `${sceneStem}.${nodeStem}.vector`;
};

const positiveDimension = (value: number): number =>
	Math.max(MIN_VECTOR_EXPORT_DIMENSION, Number(value.toFixed(6)));

const boundsFromVisualAabb = (
	aabb: ReturnType<typeof sceneNodeVisualAabb>,
): Bounds => ({
	x: aabb.minX,
	y: aabb.minY,
	width: Math.max(0, aabb.maxX - aabb.minX),
	height: Math.max(0, aabb.maxY - aabb.minY),
});

const exportArtboardForNode = (
	source: Artboard,
	node: VectorNode,
	bounds: Bounds,
): Artboard => ({
	...source,
	id: `artboard-vector-${node.id}`,
	name: node.name,
	position: { x: 0, y: 0 },
	width: positiveDimension(bounds.width),
	height: positiveDimension(bounds.height),
	background: "transparent",
});

const translateNodeToVectorArtboard = (
	node: VectorNode,
	bounds: Bounds,
	artboardId: string,
): VectorNode => ({
	...clonePojo(node),
	artboardId,
	transform: {
		...node.transform,
		position: {
			x: node.transform.position.x - bounds.x,
			y: node.transform.position.y - bounds.y,
		},
	},
});

const layerForNode = (node: VectorNode): SceneLayer => ({
	id: `layer-vector-${node.id}`,
	name: node.name,
	visible: true,
	locked: false,
	nodes: [node],
});

const scopedMotionForNode = (
	motion: MotionDocument,
	nodeIds: ReadonlySet<string>,
): MotionDocument => {
	const tracks = motion.tracks.filter((track) =>
		nodeIds.has(track.target.nodeId),
	);
	const trackIds = new Set(tracks.map((track) => track.id));
	const clips = motion.clips.filter((clip) => {
		if (clip.trackIds.some((trackId) => trackIds.has(trackId))) return true;
		const provenance = clip.provenance;
		if (!provenance) return false;
		return [
			...provenance.targetIds,
			...provenance.generatedNodeIds,
			...(provenance.editableArtifacts ?? []).flatMap(
				(artifact) => artifact.targetIds,
			),
		].some((nodeId) => nodeIds.has(nodeId));
	});
	return { ...motion, tracks, clips };
};

const missingSelectionIssue = (
	nodeId: string,
): IndividualVectorExportIssue => ({
	code: "vector-selection-missing",
	message: `Selected vector "${nodeId}" does not exist and was skipped.`,
	nodeId,
});

const emptySelectionIssue = (): IndividualVectorExportIssue => ({
	code: "vector-selection-empty",
	message:
		"Select at least one vector object before exporting individual vectors.",
});

/**
 * Creates one standalone SVG per selected vector node without mutating the
 * source scene. Each temporary scene keeps the selected node id stable so
 * side-car motion and grammar sampling can still target it while the artboard is
 * resized to the node's visual bounds.
 */
export function createIndividualVectorSvgExports({
	scene,
	motion,
	frame,
	nodeIds,
	grammarBindings,
}: {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly frame: number;
	readonly nodeIds: readonly string[];
	readonly grammarBindings?: readonly MotionGrammarBinding[];
}): IndividualVectorSvgExport {
	const uniqueNodeIds = uniqueStrings(nodeIds);
	const issues: IndividualVectorExportIssue[] = [];
	if (uniqueNodeIds.length === 0) issues.push(emptySelectionIssue());

	const assets: SvgExportAsset[] = [];
	const exportedNodeIds: string[] = [];
	for (const nodeId of uniqueNodeIds) {
		const node = findNode(scene, nodeId);
		if (!node) {
			issues.push(missingSelectionIssue(nodeId));
			continue;
		}
		const artboardId = selectArtboardIdForNode(scene, node.id);
		const sourceArtboard =
			findArtboardById(scene, artboardId) ?? selectCurrentArtboard(scene);
		const bounds = boundsFromVisualAabb(sceneNodeVisualAabb(node));
		const artboard = exportArtboardForNode(sourceArtboard, node, bounds);
		const translatedNode = translateNodeToVectorArtboard(
			node,
			bounds,
			artboard.id,
		);
		const nodeIdSet = new Set(collectNodeIds(translatedNode));
		const scopedScene: SceneDocument = {
			schemaVersion: SCENE_SCHEMA_VERSION,
			id: `${scene.id}-vector-${node.id}`,
			name: `${scene.name} ${node.name}`,
			artboard,
			artboards: [artboard],
			currentArtboardId: artboard.id,
			...(scene.effectIntent ? { effectIntent: scene.effectIntent } : {}),
			layers: [layerForNode(translatedNode)],
			...(assetsForNode(scene.assets, translatedNode)
				? { assets: assetsForNode(scene.assets, translatedNode) }
				: {}),
		};
		assets.push(
			createSvgExport({
				scene: scopedScene,
				motion: scopedMotionForNode(motion, nodeIdSet),
				frame,
				fileNameStem: vectorFileStem(scene, node, assets.length),
				grammarBindings,
			}),
		);
		exportedNodeIds.push(node.id);
	}

	return { assets, exportedNodeIds, issues };
}
