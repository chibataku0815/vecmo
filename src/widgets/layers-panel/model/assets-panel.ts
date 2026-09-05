import {
	type LinkedInstanceCompanionPlan,
	type LinkedInstancePlan,
	planLinkedInstance,
	planLinkedInstanceCompanions,
} from "@/entities/component-motion/model/plan-linked-instance";
import { useMotionStore } from "@/entities/motion/model/store";
import { currentMotionGrammarTargetNodeIds } from "@/entities/motion-grammar/model/store";
import type { MotionGrammarBinding } from "@/entities/motion-grammar/model/types";
import { hrefForImageAsset } from "@/entities/scene/model/assets";
import type { SceneCommand } from "@/entities/scene/model/command";
import {
	createRemoveComponentSymbolCommand,
	createStoreComponentSourceOnAssetBoardCommand,
} from "@/entities/scene/model/component-symbol-commands";
import {
	createComponentSymbol,
	findComponentSymbolBySourceNodeId,
	readComponentSymbols,
	selectComponentInstanceNodes,
} from "@/entities/scene/model/component-symbols";
import { cloneSceneDocument } from "@/entities/scene/model/factory";
import {
	createAddArtboardCommand,
	createPlaceExistingSceneAssetCommand,
	createRemoveUnusedSceneAssetCommand,
	createUpsertSceneAssetCommand,
} from "@/entities/scene/model/node-commands";
import { getNodeParentPaintBounds } from "@/entities/scene/model/rendering";
import {
	allNodes,
	findLayerByNodeId,
	findNode,
	normalizeArtboardRole,
	selectAllArtboards,
	selectCurrentArtboard,
} from "@/entities/scene/model/selectors";
import {
	createApplyStylePresetCommand,
	createInsertStylePresetCommand,
	createRemoveStylePresetCommand,
} from "@/entities/scene/model/style-preset-commands";
import {
	captureStylePresetFromNode,
	createStylePreset,
	readStylePresets,
} from "@/entities/scene/model/style-presets";
import type {
	Artboard,
	Bounds,
	ComponentSymbol,
	Paint,
	SceneAsset,
	SceneDocument,
	StylePreset,
	VectorNode,
	VectorNodeKind,
} from "@/entities/scene/model/types";
import { createId } from "@/shared/lib/id";

export type AssetLibraryImageEntry = {
	readonly kind: "image";
	readonly id: string;
	readonly name: string;
	readonly asset: SceneAsset;
	readonly assetKind: SceneAsset["kind"];
	readonly usageCount: number;
	readonly sourceKind: SceneAsset["source"]["kind"];
	readonly dimensionsLabel: string;
	readonly previewHref?: string;
	readonly usageNodeIds: readonly string[];
};

export type AssetLibraryComponentEntry = {
	readonly kind: "component";
	readonly id: string;
	readonly name: string;
	readonly symbol: ComponentSymbol;
	readonly sourceNodeName: string;
	readonly sourceNodeKind?: VectorNodeKind;
	readonly sourceNode?: VectorNode;
	readonly previewBounds?: Bounds;
	readonly sourceKindLabel: string;
	readonly usageCount: number;
	readonly instanceNodeIds: readonly string[];
	readonly sourceNodeIds: readonly string[];
};

export type AssetLibraryStyleSwatch = {
	readonly id: string;
	readonly kind: "color" | "gradient" | "image" | "mesh" | "empty";
	readonly label: string;
	readonly colors: readonly string[];
};

export type AssetLibraryStyleEntry = {
	readonly kind: "style";
	readonly id: string;
	readonly name: string;
	readonly preset: StylePreset;
	readonly styleKind: StylePreset["kind"];
	readonly payloadLabel: string;
	readonly swatches: readonly AssetLibraryStyleSwatch[];
};

export type AssetLibraryReadModel = {
	readonly images: readonly AssetLibraryImageEntry[];
	readonly components: readonly AssetLibraryComponentEntry[];
	readonly styles: readonly AssetLibraryStyleEntry[];
	readonly totalCount: number;
};

export type PlaceAssetPlan = {
	readonly command: SceneCommand;
	readonly selectNodeId: string;
};

export type PlaceComponentAssetPlan = {
	readonly linkedInstance: LinkedInstancePlan;
	readonly selectNodeId: string;
};

export type AssetLibraryCommandPlan = {
	readonly command?: SceneCommand;
	readonly commands?: readonly SceneCommand[];
	readonly linkedInstanceCompanions?: LinkedInstanceCompanionPlan;
	readonly removeMotionNodeIds?: readonly string[];
	readonly removeGrammarTargetNodeIds?: readonly string[];
	readonly selectNodeIds?: readonly string[];
	readonly primaryNodeId?: string | null;
};

export type AssetLibraryActionAvailability =
	| {
			readonly enabled: true;
			readonly plan: AssetLibraryCommandPlan;
	  }
	| {
			readonly enabled: false;
			readonly reason: string;
	  };

const sceneAssets = (
	document: Pick<SceneDocument, "assets">,
): readonly SceneAsset[] => document.assets ?? [];

const nodeDirectlyReferencesImageAsset = (
	node: VectorNode,
	assetId: string,
): boolean => {
	if (node.geometry.kind === "image" && node.geometry.assetId === assetId) {
		return true;
	}
	const paints = [...(node.style.fills ?? []), ...(node.style.strokes ?? [])];
	return paints.some(
		(paint) => paint.kind === "image-reference" && paint.assetId === assetId,
	);
};

const stylePresetReferencesImageAsset = (
	preset: StylePreset,
	assetId: string,
): boolean => {
	const paints = [
		...(preset.appearance?.fills ?? []),
		...(preset.appearance?.strokes ?? []),
	];
	return paints.some(
		(paint) => paint.kind === "image-reference" && paint.assetId === assetId,
	);
};

const dimensionsLabel = (asset: SceneAsset): string => {
	// Audio (S5a) carries no width/height; the property-existence check keeps
	// this generic across every other asset kind without a per-kind branch.
	if ("width" in asset && "height" in asset && asset.width && asset.height) {
		return `${Math.round(asset.width)} x ${Math.round(asset.height)}`;
	}
	return "unknown size";
};

const nodeKindLabel = (kind: VectorNodeKind | undefined): string => {
	switch (kind) {
		case "rect":
			return "Rectangle source";
		case "ellipse":
			return "Ellipse source";
		case "line":
			return "Line source";
		case "polygon":
			return "Polygon source";
		case "star":
			return "Star source";
		case "path":
			return "Path source";
		case "text":
			return "Text source";
		case "image":
			return "Image source";
		case undefined:
			return "Missing source";
	}
};

const storedObjectName = (symbolName: string): string => {
	const normalized = symbolName.trim().replace(/\s+component$/i, "");
	return normalized.length > 0 ? normalized : symbolName;
};

const collectNodeIds = (
	node: VectorNode,
	output: string[] = [],
): readonly string[] => {
	output.push(node.id);
	for (const child of node.children ?? []) collectNodeIds(child, output);
	return output;
};

const hasNestedComponentBinding = (node: VectorNode): boolean =>
	(node.children ?? []).some(
		(child) => Boolean(child.component) || hasNestedComponentBinding(child),
	);

const stylePayloadLabel = (preset: StylePreset): string => {
	const parts = [
		preset.appearance ? "appearance" : null,
		preset.paint ? "paint" : null,
		preset.typography ? "type" : null,
	].filter((part): part is string => Boolean(part));
	return parts.length > 0 ? parts.join(" / ") : "empty";
};

const swatchFromPaint = (
	paint: Paint,
	index: number,
): AssetLibraryStyleSwatch => {
	switch (paint.kind) {
		case "solid":
			return {
				id: `paint:${index}:solid:${paint.color}`,
				kind: "color",
				label: "Solid fill",
				colors: [paint.color],
			};
		case "linear-gradient":
		case "radial-gradient":
			return {
				id: `paint:${index}:${paint.kind}`,
				kind: "gradient",
				label:
					paint.kind === "linear-gradient"
						? "Linear gradient"
						: "Radial gradient",
				colors: paint.stops.map((stop) => stop.color),
			};
		case "image-reference":
			return {
				id: `paint:${index}:image:${paint.assetId}`,
				kind: "image",
				label: "Image paint",
				colors: [],
			};
		case "mesh-gradient":
			return {
				id: `paint:${index}:mesh`,
				kind: "mesh",
				label: "Mesh gradient",
				colors: paint.points.slice(0, 4).map((point) => point.color),
			};
	}
};

const styleSwatches = (
	preset: StylePreset,
): readonly AssetLibraryStyleSwatch[] => {
	const paints = [
		...(preset.appearance?.fills ?? []),
		...(preset.appearance?.strokes ?? []),
	];
	const swatches = paints.slice(0, 3).map(swatchFromPaint);
	if (swatches.length > 0) return swatches;
	if (preset.paint?.fill && preset.paint.fill !== "none") {
		return [
			{
				id: "fallback:fill",
				kind: "color",
				label: "Fill",
				colors: [preset.paint.fill],
			},
		];
	}
	if (preset.paint?.stroke && preset.paint.stroke !== "none") {
		return [
			{
				id: "fallback:stroke",
				kind: "color",
				label: "Stroke",
				colors: [preset.paint.stroke],
			},
		];
	}
	return [
		{
			id: "fallback:empty",
			kind: "empty",
			label: preset.typography ? "Type preset" : "No paint",
			colors: [],
		},
	];
};

/** Builds the document-level asset library read model used by the Assets view. */
export function readAssetLibrary(
	document: SceneDocument,
): AssetLibraryReadModel {
	const nodes = allNodes(document);
	const stylePresets = readStylePresets(document);
	const assets = sceneAssets(document);
	const images = assets.map((asset) => {
		const previewHref =
			asset.kind === "image" ? hrefForImageAsset(asset) : null;
		const usageNodeIds = nodes
			.filter((node) => nodeDirectlyReferencesImageAsset(node, asset.id))
			.map((node) => node.id);
		const styleUsageCount = stylePresets.filter((preset) =>
			stylePresetReferencesImageAsset(preset, asset.id),
		).length;
		const fallbackUsageCount = assets.filter(
			(candidate) =>
				candidate.kind === "program-surface" &&
				candidate.manifest.fallback?.assetId === asset.id,
		).length;
		return {
			kind: "image" as const,
			id: asset.id,
			name: asset.name,
			asset,
			assetKind: asset.kind,
			usageCount: usageNodeIds.length + styleUsageCount + fallbackUsageCount,
			sourceKind: asset.source.kind,
			dimensionsLabel: dimensionsLabel(asset),
			...(previewHref ? { previewHref } : {}),
			usageNodeIds,
		};
	});
	const components = readComponentSymbols(document).map((symbol) => {
		const sourceNode = findNode(document, symbol.sourceNodeId);
		const instances = selectComponentInstanceNodes(document, symbol.id);
		return {
			kind: "component" as const,
			id: symbol.id,
			name: storedObjectName(symbol.name),
			symbol,
			sourceNodeName: sourceNode?.name ?? "Missing source",
			...(sourceNode
				? {
						sourceNode,
						sourceNodeKind: sourceNode.geometry.kind,
						previewBounds: getNodeParentPaintBounds(sourceNode),
					}
				: {}),
			sourceKindLabel: nodeKindLabel(sourceNode?.geometry.kind),
			usageCount: instances.length,
			instanceNodeIds: instances.map((entry) => entry.node.id),
			sourceNodeIds: sourceNode ? collectNodeIds(sourceNode) : [],
		};
	});
	const styles = stylePresets.map((preset) => ({
		kind: "style" as const,
		id: preset.id,
		name: preset.name,
		preset,
		styleKind: preset.kind,
		payloadLabel: stylePayloadLabel(preset),
		swatches: styleSwatches(preset),
	}));
	return {
		images,
		components,
		styles,
		totalCount: images.length + components.length + styles.length,
	};
}

const liveSelectedNodeIds = (
	document: SceneDocument,
	nodeIds: readonly string[],
): readonly string[] =>
	[...new Set(nodeIds)].filter(
		(nodeId) => findNode(document, nodeId) !== undefined,
	);

const preferredSelectionNodeId = (
	document: SceneDocument,
	nodeIds: readonly string[],
	primaryNodeId: string | null,
): string | null => {
	const liveIds = liveSelectedNodeIds(document, nodeIds);
	if (primaryNodeId && liveIds.includes(primaryNodeId)) return primaryNodeId;
	return liveIds[0] ?? null;
};

type AssetSourceClonePlan = {
	readonly sourceNode: VectorNode;
	readonly sourceToInstanceNodeIds: Readonly<Record<string, string>>;
	readonly originalToSourceNodeIds: Readonly<Record<string, string>>;
};

const uniqueSceneNodeId = (usedIds: Set<string>): string => {
	let id = createId("asset-node");
	while (usedIds.has(id)) id = createId("asset-node");
	usedIds.add(id);
	return id;
};

const cloneNodeForAssetSource = (
	node: VectorNode,
	artboardId: string,
	options: {
		readonly usedIds: Set<string>;
		readonly sourceToInstanceNodeIds: Record<string, string>;
		readonly originalToSourceNodeIds: Record<string, string>;
	},
): VectorNode => {
	const id = uniqueSceneNodeId(options.usedIds);
	options.sourceToInstanceNodeIds[id] = node.id;
	options.originalToSourceNodeIds[node.id] = id;
	const children = node.children?.map((child) =>
		cloneNodeForAssetSource(child, artboardId, options),
	);
	const cloned = cloneSceneDocument(node);
	const { component: _component, children: _children, ...rest } = cloned;
	return {
		...rest,
		id,
		artboardId,
		...(children ? { children } : {}),
	};
};

const planAssetSourceClone = (
	document: SceneDocument,
	node: VectorNode,
	artboardId: string,
): AssetSourceClonePlan => {
	const usedIds = new Set(allNodes(document).map((entry) => entry.id));
	const sourceToInstanceNodeIds: Record<string, string> = {};
	const originalToSourceNodeIds: Record<string, string> = {};
	const sourceNode = cloneNodeForAssetSource(node, artboardId, {
		usedIds,
		sourceToInstanceNodeIds,
		originalToSourceNodeIds,
	});
	return {
		sourceNode,
		sourceToInstanceNodeIds,
		originalToSourceNodeIds,
	};
};

const assetBoardForDocument = (document: SceneDocument): Artboard | null =>
	selectAllArtboards(document).find(
		(artboard) => normalizeArtboardRole(artboard) === "asset-board",
	) ?? null;

const createDefaultAssetBoard = (document: SceneDocument): Artboard => {
	const current = selectCurrentArtboard(document);
	const artboards = selectAllArtboards(document);
	const rightEdge = Math.max(
		...artboards.map((artboard) => artboard.position.x + artboard.width),
		current.position.x + current.width,
	);
	return {
		id: createId("asset-board"),
		name: "Assets",
		role: "asset-board",
		position: {
			x: Math.round(rightEdge + 120),
			y: Math.round(current.position.y),
		},
		width: current.width,
		height: current.height,
		background: current.background,
		fps: current.fps,
		durationFrames: current.durationFrames,
	};
};

/** Plans turning the current primary selection into a reusable component source. */
export function planCreateComponentAsset(
	document: SceneDocument,
	nodeIds: readonly string[],
	primaryNodeId: string | null,
	grammarBindings: readonly MotionGrammarBinding[] = [],
): AssetLibraryActionAvailability {
	const nodeId = preferredSelectionNodeId(document, nodeIds, primaryNodeId);
	if (!nodeId) return { enabled: false, reason: "Select an object to save" };
	const node = findNode(document, nodeId);
	if (!node)
		return { enabled: false, reason: "Selection is no longer on canvas" };
	if (node.component?.kind === "instance") {
		return { enabled: false, reason: "Detach this placed copy before saving" };
	}
	if (node.component?.kind === "source") {
		return { enabled: false, reason: "This object is already saved" };
	}
	if (findComponentSymbolBySourceNodeId(document, node.id)) {
		return { enabled: false, reason: "This object is already saved" };
	}
	if (hasNestedComponentBinding(node)) {
		return {
			enabled: false,
			reason: "Detach nested saved objects before saving",
		};
	}
	const layer = findLayerByNodeId(document, node.id);
	if (!layer) return { enabled: false, reason: "Selection has no layer" };
	const existingAssetBoard = assetBoardForDocument(document);
	const assetBoard = existingAssetBoard ?? createDefaultAssetBoard(document);
	const sourcePlan = planAssetSourceClone(document, node, assetBoard.id);
	const symbol = createComponentSymbol(
		readComponentSymbols(document),
		sourcePlan.sourceNode,
		{ name: node.name },
	);
	if (!symbol) {
		return { enabled: false, reason: "This object cannot be saved" };
	}
	const sourceNode: VectorNode = {
		...sourcePlan.sourceNode,
		component: {
			kind: "source",
			symbolId: symbol.id,
		},
	};
	const commands: SceneCommand[] = [];
	if (!existingAssetBoard) {
		commands.push(
			createAddArtboardCommand(assetBoard, {
				label: "Create asset board",
				select: false,
				toIndex: selectAllArtboards(document).length,
			}),
		);
	}
	commands.push(
		createStoreComponentSourceOnAssetBoardCommand(
			{
				symbol,
				sourceNode,
				sourceLayerId: layer.id,
				instanceRootNodeId: node.id,
				sourceToInstanceNodeIds: sourcePlan.sourceToInstanceNodeIds,
			},
			{ label: "Save object asset" },
		),
	);
	return {
		enabled: true,
		plan: {
			commands,
			linkedInstanceCompanions: planLinkedInstanceCompanions({
				sourceToInstanceNodeIds: sourcePlan.originalToSourceNodeIds,
				instanceKey: sourceNode.id,
				grammarBindings,
				motionLabel: "Carry saved object motion",
			}),
			selectNodeIds: [node.id],
			primaryNodeId: node.id,
		},
	};
}

/** Plans saving the current primary selection's appearance as a style asset. */
export function planCreateStyleAsset(
	document: SceneDocument,
	nodeIds: readonly string[],
	primaryNodeId: string | null,
): AssetLibraryActionAvailability {
	const nodeId = preferredSelectionNodeId(document, nodeIds, primaryNodeId);
	if (!nodeId) {
		return { enabled: false, reason: "Select an object to save style" };
	}
	const node = findNode(document, nodeId);
	if (!node)
		return { enabled: false, reason: "Selection is no longer on canvas" };
	const preset = createStylePreset(
		readStylePresets(document),
		captureStylePresetFromNode(node),
	);
	if (!preset)
		return { enabled: false, reason: "Selected object has no style" };
	return {
		enabled: true,
		plan: {
			command: createInsertStylePresetCommand(preset, {
				label: "Save style asset",
			}),
			selectNodeIds: [node.id],
			primaryNodeId: node.id,
		},
	};
}

/** Plans applying a saved style asset to the live current selection. */
export function planApplyStyleAsset(
	document: SceneDocument,
	presetId: string,
	nodeIds: readonly string[],
	primaryNodeId: string | null,
): AssetLibraryActionAvailability {
	const liveIds = liveSelectedNodeIds(document, nodeIds);
	if (liveIds.length === 0) {
		return { enabled: false, reason: "Select nodes to style" };
	}
	if (!readStylePresets(document).some((preset) => preset.id === presetId)) {
		return { enabled: false, reason: "Style is no longer in the library" };
	}
	return {
		enabled: true,
		plan: {
			command: createApplyStylePresetCommand(presetId, liveIds, {
				label: "Apply style asset",
				grammarTargetNodeIds: currentMotionGrammarTargetNodeIds(),
				motion: useMotionStore.getState().document,
			}),
			selectNodeIds: liveIds,
			primaryNodeId:
				primaryNodeId && liveIds.includes(primaryNodeId)
					? primaryNodeId
					: (liveIds[0] ?? null),
		},
	};
}

/** Plans deleting an unused imported image from the document asset library. */
export function planDeleteImageAsset(
	document: SceneDocument,
	assetId: string,
): AssetLibraryActionAvailability {
	const asset = sceneAssets(document).find(
		(candidate) => candidate.id === assetId,
	);
	if (!asset) return { enabled: false, reason: "Image is no longer saved" };
	const usageNodeIds = allNodes(document)
		.filter((node) => nodeDirectlyReferencesImageAsset(node, asset.id))
		.map((node) => node.id);
	const styleUsageCount = readStylePresets(document).filter((preset) =>
		stylePresetReferencesImageAsset(preset, asset.id),
	).length;
	const fallbackUsageCount = sceneAssets(document).filter(
		(candidate) =>
			candidate.kind === "program-surface" &&
			candidate.manifest.fallback?.assetId === asset.id,
	).length;
	if (usageNodeIds.length + styleUsageCount + fallbackUsageCount > 0) {
		return { enabled: false, reason: "Remove image uses before deleting" };
	}
	return {
		enabled: true,
		plan: {
			command: createRemoveUnusedSceneAssetCommand(asset.id),
		},
	};
}

/** Plans a same-kind asset metadata update through the common Scene command. */
export function planRenameSceneAsset(
	document: SceneDocument,
	assetId: string,
	name: string,
): AssetLibraryActionAvailability {
	const asset = sceneAssets(document).find(
		(candidate) => candidate.id === assetId,
	);
	if (!asset) return { enabled: false, reason: "Asset is no longer saved" };
	const nextName = name.trim();
	if (!nextName)
		return { enabled: false, reason: "Asset name cannot be empty" };
	if (nextName === asset.name) {
		return { enabled: false, reason: "Asset already has this name" };
	}
	return {
		enabled: true,
		plan: {
			command: createUpsertSceneAssetCommand({ ...asset, name: nextName }),
		},
	};
}

/** Plans deleting a stored object registration while preserving placed copies. */
export function planDeleteComponentAsset(
	document: SceneDocument,
	symbolId: string,
): AssetLibraryActionAvailability {
	const symbol = readComponentSymbols(document).find(
		(candidate) => candidate.id === symbolId,
	);
	if (!symbol) {
		return { enabled: false, reason: "Stored object is no longer saved" };
	}
	const sourceNode = findNode(document, symbol.sourceNodeId);
	const sourceNodeIds = sourceNode
		? collectNodeIds(sourceNode)
		: [symbol.sourceNodeId];
	return {
		enabled: true,
		plan: {
			command: createRemoveComponentSymbolCommand(symbol.id),
			removeMotionNodeIds: sourceNodeIds,
			removeGrammarTargetNodeIds: sourceNodeIds,
		},
	};
}

/** Plans deleting a saved style preset. Applied nodes keep their copied style. */
export function planDeleteStyleAsset(
	document: SceneDocument,
	presetId: string,
): AssetLibraryActionAvailability {
	if (!readStylePresets(document).some((preset) => preset.id === presetId)) {
		return { enabled: false, reason: "Style is no longer saved" };
	}
	return {
		enabled: true,
		plan: {
			command: createRemoveStylePresetCommand(presetId),
		},
	};
}

const finitePositive = (value: number | undefined): number | undefined =>
	typeof value === "number" && Number.isFinite(value) && value > 0
		? value
		: undefined;

const fittedImageBounds = (
	asset: SceneAsset,
	artboard: { readonly width: number; readonly height: number },
): Bounds => {
	const artboardWidth = finitePositive(artboard.width) ?? 1280;
	const artboardHeight = finitePositive(artboard.height) ?? 720;
	// Audio (S5a) carries no width/height; it never reaches this image-fit
	// helper in practice (it places no node), but the property-existence check
	// keeps the signature total across every `SceneAsset` kind.
	const sourceWidth =
		finitePositive("width" in asset ? asset.width : undefined) ?? 320;
	const sourceHeight =
		finitePositive("height" in asset ? asset.height : undefined) ?? 180;
	const maxWidth = artboardWidth * 0.5;
	const maxHeight = artboardHeight * 0.5;
	const scale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight, 1);
	const width = Math.max(1, Math.round(sourceWidth * scale));
	const height = Math.max(1, Math.round(sourceHeight * scale));

	return {
		x: Math.round((artboardWidth - width) / 2),
		y: Math.round((artboardHeight - height) / 2),
		width,
		height,
	};
};

/** Plans a new image placement that references an existing document asset. */
export function planPlaceImageAsset(
	document: SceneDocument,
	assetId: string,
): PlaceAssetPlan | null {
	const asset = sceneAssets(document).find(
		(candidate) => candidate.id === assetId,
	);
	if (!asset) return null;
	const artboard = selectCurrentArtboard(document);
	const nodeId = createId("node-image");
	return {
		command: createPlaceExistingSceneAssetCommand({
			assetId: asset.id,
			nodeId,
			name: asset.name,
			bounds: fittedImageBounds(asset, artboard),
			artboardId: artboard.id,
		}),
		selectNodeId: nodeId,
	};
}

/** Plans a component instance placement in the current artboard. */
export function planPlaceComponentAsset(
	document: SceneDocument,
	symbolId: string,
	grammarBindings: readonly MotionGrammarBinding[] = [],
): PlaceComponentAssetPlan | null {
	const artboard = selectCurrentArtboard(document);
	const targetLayer = document.layers.at(-1);
	const plan = planLinkedInstance(document, symbolId, {
		artboardId: artboard.id,
		...(targetLayer ? { layerId: targetLayer.id } : {}),
		grammarBindings,
		sceneLabel: "Place saved object",
	});
	if (!plan) return null;
	return {
		linkedInstance: plan,
		selectNodeId: plan.selectNodeIds[0],
	};
}
