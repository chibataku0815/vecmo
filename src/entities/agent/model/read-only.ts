import {
	createAgentIssue,
	createAgentToolResult,
} from "@/entities/agent/model/contracts";
import {
	type AgentAppearanceEffectsList,
	type AgentArrangementLayoutSnapshotSummary,
	type AgentBindablePropertyCameraChannelValue,
	type AgentBindablePropertyCameraEligibility,
	type AgentBindablePropertyCommandAvailability,
	type AgentBindablePropertyList,
	type AgentBindablePropertyNodeEligibility,
	type AgentBindablePropertySummary,
	type AgentComponentPropSummary,
	type AgentComponentSymbolSummary,
	type AgentDocumentObservation,
	type AgentInteractionSummary,
	type AgentIssue,
	type AgentLayoutMaterializationSummary,
	type AgentListAppearanceEffectsRequest,
	type AgentListBindablePropertiesRequest,
	type AgentListLayersRequest,
	type AgentListLookGraphRequest,
	type AgentListMotionGrammarRequest,
	type AgentLiveArtboardSummary,
	type AgentLiveDocumentIdentity,
	type AgentLiveDocumentObservation,
	type AgentLiveLookGraphNodeSummary,
	type AgentLiveLookNodeTrackSummary,
	type AgentLiveMotionDocumentSummary,
	type AgentLiveMotionInventory,
	type AgentLiveMotionTrackSummary,
	type AgentLiveNodeSummary,
	type AgentLiveScopedLookOverlaySummary,
	type AgentLookGraphTarget,
	type AgentLookGraphView,
	type AgentLookNodeCapabilityList,
	type AgentLookNodeParamCapability,
	type AgentMotionGrammarBindingSummary,
	type AgentMotionGrammarList,
	type AgentMotionGrammarTechniqueSummary,
	type AgentMotionGrammarUnsupportedBindingSummary,
	type AgentNodeComponentPropBindingSummary,
	type AgentNodeComponentRole,
	type AgentNodeGeometrySummary,
	type AgentNodeInteractionSummary,
	type AgentNodeMotionPropertySummary,
	type AgentNodeMotionSummary,
	type AgentNodeObservation,
	type AgentNodeRecipeSummary,
	type AgentNodeRoleSummary,
	type AgentObservationDetail,
	type AgentObserveNodeRequest,
	type AgentObserveNodeResult,
	type AgentSceneAssetSummary,
	type AgentSceneCameraSummary,
	type AgentSelectionSummary,
	type AgentSourceOpticsSummary,
	type AgentStylePresetSummary,
	type AgentToolResult,
	MAX_OBSERVE_NODE_IDS,
} from "@/entities/agent/model/types";
import { CAMERA_STANDARD_SPATIAL_PROPERTIES } from "@/entities/motion/model/camera-standard";
import { inspectMorphTopology } from "@/entities/motion/model/morph-topology";
import { effectiveSourceOpticsParameter } from "@/entities/motion/model/sampler";
import type {
	AnimatableProperty,
	CameraRigAnimatableProperty,
	MotionDocument,
} from "@/entities/motion/model/types";
import {
	type MotionGrammarAuthoringProfileDescriptor,
	motionGrammarAuthoringParameterKeys,
} from "@/entities/motion-grammar/model/authoring-profile";
import { describeMotionGrammarAuthoringProfile } from "@/entities/motion-grammar/model/authoring-profile-registry";
import {
	authorableTechniqueIds,
	findCatalogEntry,
	MOTION_GRAMMAR_CATALOG,
} from "@/entities/motion-grammar/model/catalog";
import type { MotionGrammarStoreDocument } from "@/entities/motion-grammar/model/command";
import type {
	MotionGrammarBinding,
	MotionGrammarCatalogEntry,
	MotionGrammarParamSpec,
	MotionGrammarTechniqueId,
} from "@/entities/motion-grammar/model/types";
import {
	motionGrammarParameterSpecsForBinding,
	motionGrammarParameterSpecsForNewBinding,
	versionedMotionExpressionRoleMapContract,
} from "@/entities/motion-grammar/model/versioned-expression-binding";
import { readAppearanceMaskRelations } from "@/entities/scene/model/appearance";
import { deriveObjectAppearanceEffects } from "@/entities/scene/model/appearance-effects";
import { readArrangementLayoutSnapshot } from "@/entities/scene/model/arrangement-layout-snapshot";
import {
	BINDABLE_PROPERTY_DESCRIPTORS,
	type BindablePropertyDescriptor,
	type BindablePropertyEligibility,
	type BindablePropertySource,
} from "@/entities/scene/model/bindable-property";
import { readComponentProps } from "@/entities/scene/model/component-props";
import {
	readComponentSymbols,
	selectComponentInstanceNodes,
} from "@/entities/scene/model/component-symbols";
import { effectCapabilityById } from "@/entities/scene/model/effect-capabilities";
import { readInteractions } from "@/entities/scene/model/interactions";
import {
	effectiveLayoutFrameContract,
	materializeLayoutChildIntoBounds,
	normalizeLayoutFrameContract,
	resolveLayoutFramePlan,
	resolveLayoutFrameVariantId,
} from "@/entities/scene/model/layout-frame";
import {
	LOOK_GRAPH_NODE_PARAM_CATALOG,
	LOOK_GRAPH_NODE_PORT_CATALOG,
	type LookGraph,
	type LookGraphNodeKind,
	type LookGraphOwnerRef,
	lookGraphFromIntent,
	lookGraphNodeLabel,
	validateLookGraph,
} from "@/entities/scene/model/look-graph";
import { compileLookGraph } from "@/entities/scene/model/look-graph-compile";
import { lookGraphExportManifest } from "@/entities/scene/model/look-graph-export";
import { nativeExpressionPropertyIdFromBindableId } from "@/entities/scene/model/native-expression-binding";
import {
	resolveFrameEffectIntent,
	resolveFrameLookGraph,
} from "@/entities/scene/model/recipe-resolve";
import {
	applyMatrixToPoint,
	getGeometryBounds,
	matrixFromTransform,
} from "@/entities/scene/model/rendering";
import {
	findActiveSceneCameraRig,
	isIdentitySceneCameraRigForArtboard,
} from "@/entities/scene/model/scene-camera";
import { scopedLookGraphOverlays } from "@/entities/scene/model/scoped-look-graph-overlay";
import {
	allNodes,
	findArtboardById,
	findNode,
	type NodeArtboardMapping,
	selectAllArtboards,
	selectArtboardIdForNode,
	selectCurrentArtboard,
	selectDefaultArtboard,
	selectNodeArtboardMapping,
} from "@/entities/scene/model/selectors";
import {
	buildSourceOpticsPresentation,
	SOURCE_OPTICS_PARAMETER_DESCRIPTORS,
	sourceOpticsParameterValue,
	sourceOpticsRigsForArtboard,
} from "@/entities/scene/model/source-optics";
import { readStylePresets } from "@/entities/scene/model/style-presets";
import type {
	ArrangementLayoutSnapshot,
	Artboard,
	Bounds,
	CameraSpacePolicy,
	LayoutCellPlacement,
	LayoutFrameAutoFlow,
	LayoutFrameGap,
	LayoutFramePadding,
	LayoutFramePresetId,
	LayoutFrameVariantContract,
	LayoutFrameVariantMode,
	ProgramSurfaceAsset,
	SceneAsset,
	SceneCameraRigContract,
	SceneDocument,
	SceneLayer,
	VectorNode,
} from "@/entities/scene/model/types";

export type AgentDocumentContext = {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly grammar: MotionGrammarStoreDocument;
	readonly selection?: AgentSelectionSummary;
};

export type AgentArtboardSummary = {
	readonly id: string;
	readonly name: string;
	readonly position: {
		readonly x: number;
		readonly y: number;
	};
	readonly width: number;
	readonly height: number;
	readonly background: string;
	readonly fps: number;
	readonly durationFrames: number;
	readonly cameraSpacePolicy?: CameraSpacePolicy;
	readonly nodeCount: number;
	readonly current: boolean;
};

export type AgentArtboardList = {
	readonly currentArtboardId: string;
	readonly artboards: readonly AgentArtboardSummary[];
};

export type AgentNodeSummary = {
	readonly id: string;
	readonly name: string;
	readonly kind: VectorNode["geometry"]["kind"];
	readonly artboardId?: string;
	readonly visible: boolean;
	readonly locked: boolean;
	readonly childCount: number;
	readonly children?: readonly AgentNodeSummary[];
	readonly layoutChild?: {
		readonly frameNodeId: string;
		readonly frameName: string;
		readonly resolvedVariantId?: string;
		readonly placement: LayoutCellPlacement;
		readonly bounds: Bounds;
		readonly sourceBounds?: Bounds;
		readonly expectedBounds?: Bounds;
		readonly materializationDrift?: AgentLayoutMaterializationDrift;
	};
	readonly frame?: {
		readonly clipsContent: boolean;
		readonly layout?: {
			readonly kind: "grid";
			readonly version: 1;
			readonly columns: number;
			readonly rows: number | "auto";
			readonly autoFlow: LayoutFrameAutoFlow;
			readonly allowOverlap?: boolean;
			readonly gap: LayoutFrameGap;
			readonly padding: LayoutFramePadding;
			readonly preset?: LayoutFramePresetId;
			readonly placements?: Readonly<Record<string, LayoutCellPlacement>>;
			readonly placementCount: number;
			readonly variantMode?: LayoutFrameVariantMode;
			readonly activeVariantId?: string;
			readonly resolvedVariantId?: string;
			readonly variantCount: number;
			readonly variants?: readonly LayoutFrameVariantContract[];
			readonly resolved: {
				readonly columns: number;
				readonly rows: number;
				readonly allowOverlap?: boolean;
				readonly cells: readonly {
					readonly nodeId: string;
					readonly placement: LayoutCellPlacement;
					readonly bounds: Bounds;
					readonly sourceBounds?: Bounds;
					readonly expectedBounds?: Bounds;
					readonly materializationDrift?: AgentLayoutMaterializationDrift;
				}[];
			};
		};
	};
};

export type AgentLayoutMaterializationDrift = {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
	readonly max: number;
};

export type AgentLayerSummary = {
	readonly id: string;
	readonly name: string;
	readonly visible: boolean;
	readonly locked: boolean;
	readonly nodeCount: number;
	readonly visibleNodeCount: number;
	readonly nodes: readonly AgentNodeSummary[];
};

export type AgentLayerList = {
	readonly offset: number;
	readonly limit: number;
	readonly total: number;
	readonly layers: readonly AgentLayerSummary[];
};

type BindablePropertyFilters = Required<
	Pick<
		AgentListBindablePropertiesRequest,
		"sceneWritableOnly" | "keyframableOnly" | "includeIneligible"
	>
> & {
	readonly targetScope:
		| NonNullable<AgentListBindablePropertiesRequest["targetScope"]>
		| undefined;
	readonly sourceKind:
		| NonNullable<AgentListBindablePropertiesRequest["sourceKind"]>
		| undefined;
	readonly nodeId:
		| NonNullable<AgentListBindablePropertiesRequest["nodeId"]>
		| undefined;
	readonly cameraRigId:
		| NonNullable<AgentListBindablePropertiesRequest["cameraRigId"]>
		| undefined;
};

type MotionGrammarFilters = {
	readonly techniqueId: MotionGrammarTechniqueId | undefined;
	readonly nodeId: string | undefined;
	readonly authorableOnly: boolean;
	readonly implementedOnly: boolean;
	readonly includeBindings: boolean;
	readonly includeIneligibleTargets: boolean;
};

export type AgentValidationSummary = {
	readonly ok: boolean;
	readonly issueCount: number;
	readonly errorCount: number;
	readonly warningCount: number;
	readonly infoCount: number;
};

export type AgentValidationReport = {
	readonly summary: AgentValidationSummary;
	readonly issues: readonly AgentIssue[];
};

const DEFAULT_LAYER_LIMIT = 50;

const countNodes = (nodes: readonly VectorNode[]): number =>
	nodes.reduce((total, node) => total + 1 + countNodes(node.children ?? []), 0);

const countVisibleNodes = (nodes: readonly VectorNode[]): number =>
	nodes.reduce((total, node) => {
		if (!node.visible) return total;
		return total + 1 + countVisibleNodes(node.children ?? []);
	}, 0);

const uniqueIds = (ids: readonly string[]): Set<string> => new Set(ids);

const duplicateIds = (ids: readonly string[]): readonly string[] => {
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const id of ids) {
		if (seen.has(id)) duplicates.add(id);
		seen.add(id);
	}
	return [...duplicates].sort();
};

const selectionOrEmpty = (
	selection: AgentSelectionSummary | undefined,
	scene: SceneDocument,
): AgentSelectionSummary => ({
	nodeIds: selection?.nodeIds ?? [],
	primaryNodeId: selection?.primaryNodeId,
	artboardId: selection?.artboardId ?? selectCurrentArtboard(scene).id,
	...(selection?.sceneCamera ? { sceneCamera: selection.sceneCamera } : {}),
});

const summarizeLayoutPlacement = (
	placement: LayoutCellPlacement,
): LayoutCellPlacement => ({
	column: placement.column,
	row: placement.row,
	columnSpan: placement.columnSpan ?? 1,
	rowSpan: placement.rowSpan ?? 1,
	...(placement.fit ? { fit: placement.fit } : {}),
});

const LAYOUT_MATERIALIZATION_DRIFT_EPSILON = 0.001;

type AgentLayoutMaterializationState = {
	readonly sourceBounds: Bounds;
	readonly expectedBounds: Bounds;
	readonly materializationDrift?: AgentLayoutMaterializationDrift;
};

type AgentLayoutMaterializationDriftFrame = {
	readonly frameNodeId: string;
	readonly frameName: string;
	readonly driftedChildCount: number;
	readonly maxDrift: number;
};

type AgentLayoutMaterializationHealth = AgentLayoutMaterializationSummary & {
	readonly driftedFrames: readonly AgentLayoutMaterializationDriftFrame[];
};

const boundsDrift = (
	source: Bounds,
	expected: Bounds,
): AgentLayoutMaterializationDrift | undefined => {
	const drift = {
		x: Math.abs(source.x - expected.x),
		y: Math.abs(source.y - expected.y),
		width: Math.abs(source.width - expected.width),
		height: Math.abs(source.height - expected.height),
	};
	const max = Math.max(drift.x, drift.y, drift.width, drift.height);
	return max > LAYOUT_MATERIALIZATION_DRIFT_EPSILON
		? { ...drift, max }
		: undefined;
};

const geometryParentBounds = (node: VectorNode): Bounds => {
	const bounds = getGeometryBounds(node.geometry);
	const matrix = matrixFromTransform(node.transform);
	const points = [
		{ x: bounds.x, y: bounds.y },
		{ x: bounds.x + bounds.width, y: bounds.y },
		{ x: bounds.x, y: bounds.y + bounds.height },
		{ x: bounds.x + bounds.width, y: bounds.y + bounds.height },
	].map((point) => applyMatrixToPoint(matrix, point));
	const xs = points.map((point) => point.x);
	const ys = points.map((point) => point.y);
	const minX = Math.min(...xs);
	const minY = Math.min(...ys);
	const maxX = Math.max(...xs);
	const maxY = Math.max(...ys);
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

const layoutMaterializationState = (
	child: VectorNode | undefined,
	bounds: Bounds,
	placement: LayoutCellPlacement,
): AgentLayoutMaterializationState | undefined => {
	if (!child) return undefined;
	const materialized = materializeLayoutChildIntoBounds(
		child,
		bounds,
		placement.fit,
	);
	const sourceBounds = geometryParentBounds(child);
	const expectedBounds = geometryParentBounds({
		...child,
		geometry: materialized.geometry,
		transform: materialized.transform,
	});
	const materializationDrift = boundsDrift(sourceBounds, expectedBounds);
	return {
		sourceBounds,
		expectedBounds,
		...(materializationDrift ? { materializationDrift } : {}),
	};
};

const summarizeLayoutFrame = (
	node: VectorNode,
):
	| NonNullable<NonNullable<AgentNodeSummary["frame"]>["layout"]>
	| undefined => {
	if (!node.frame?.layout || node.geometry.kind !== "rect") return undefined;
	const layout = normalizeLayoutFrameContract(node.frame.layout);
	const children = node.children ?? [];
	const childIds = children.map((child) => child.id);
	const childById = new Map(
		children.map((child) => [child.id, child] as const),
	);
	const plan = resolveLayoutFramePlan(node.geometry.bounds, layout, childIds);
	const resolvedVariantId = resolveLayoutFrameVariantId(
		layout,
		node.geometry.bounds.width,
	);
	const effectiveLayout = effectiveLayoutFrameContract(layout, {
		width: node.geometry.bounds.width,
	});
	return {
		kind: layout.kind,
		version: layout.version,
		columns: layout.columns,
		rows: layout.rows,
		autoFlow: layout.autoFlow,
		...(layout.allowOverlap ? { allowOverlap: true } : {}),
		gap: layout.gap,
		padding: layout.padding,
		...(layout.preset ? { preset: layout.preset } : {}),
		...(layout.placements ? { placements: layout.placements } : {}),
		placementCount: Object.keys(layout.placements ?? {}).length,
		...(layout.variantMode ? { variantMode: layout.variantMode } : {}),
		...(layout.activeVariantId
			? { activeVariantId: layout.activeVariantId }
			: {}),
		...(resolvedVariantId ? { resolvedVariantId } : {}),
		variantCount: layout.variants?.length ?? 0,
		...(layout.variants ? { variants: layout.variants } : {}),
		resolved: {
			columns: plan.columns,
			rows: plan.rows,
			...(effectiveLayout.allowOverlap ? { allowOverlap: true } : {}),
			cells: plan.cells.map((cell) => {
				const materialization = layoutMaterializationState(
					childById.get(cell.nodeId),
					cell.bounds,
					cell.placement,
				);
				return {
					nodeId: cell.nodeId,
					bounds: cell.bounds,
					placement: summarizeLayoutPlacement(cell.placement),
					...(materialization ?? {}),
				};
			}),
		},
	};
};

const emptyLayoutMaterializationHealth =
	(): AgentLayoutMaterializationHealth => ({
		frameCount: 0,
		managedChildCount: 0,
		driftedFrameCount: 0,
		driftedChildCount: 0,
		driftedFrames: [],
	});

const summarizeLayoutMaterializationHealth = (
	nodes: readonly VectorNode[],
): AgentLayoutMaterializationHealth => {
	let frameCount = 0;
	let managedChildCount = 0;
	let driftedChildCount = 0;
	let maxDrift = 0;
	const driftedFrames: AgentLayoutMaterializationDriftFrame[] = [];

	for (const node of nodes) {
		const layout = summarizeLayoutFrame(node);
		if (!layout) continue;
		frameCount += 1;
		managedChildCount += layout.resolved.cells.length;
		let frameDriftedChildCount = 0;
		let frameMaxDrift = 0;
		for (const cell of layout.resolved.cells) {
			const drift = cell.materializationDrift;
			if (!drift) continue;
			frameDriftedChildCount += 1;
			driftedChildCount += 1;
			frameMaxDrift = Math.max(frameMaxDrift, drift.max);
			maxDrift = Math.max(maxDrift, drift.max);
		}
		if (frameDriftedChildCount > 0) {
			driftedFrames.push({
				frameNodeId: node.id,
				frameName: node.name,
				driftedChildCount: frameDriftedChildCount,
				maxDrift: frameMaxDrift,
			});
		}
	}

	if (frameCount === 0) return emptyLayoutMaterializationHealth();
	return {
		frameCount,
		managedChildCount,
		driftedFrameCount: driftedFrames.length,
		driftedChildCount,
		...(driftedChildCount > 0 ? { maxDrift } : {}),
		driftedFrames,
	};
};

const layoutMaterializationSummary = (
	health: AgentLayoutMaterializationHealth,
): AgentLayoutMaterializationSummary | undefined =>
	health.frameCount > 0
		? {
				frameCount: health.frameCount,
				managedChildCount: health.managedChildCount,
				driftedFrameCount: health.driftedFrameCount,
				driftedChildCount: health.driftedChildCount,
				...(health.maxDrift === undefined ? {} : { maxDrift: health.maxDrift }),
			}
		: undefined;

/**
 * Compact discovery rows for the document's style-preset library (id, name,
 * kind, and which parts are present) so an agent can find a preset id before
 * calling `scene/apply-style-preset`/`scene/rename-style-preset` without a
 * heavier full-payload read. Omitted entirely when the library is empty,
 * mirroring `layoutMaterializationSummary`'s omit-when-absent convention.
 */
const stylePresetSummaries = (
	scene: AgentDocumentContext["scene"],
): readonly AgentStylePresetSummary[] | undefined => {
	const presets = readStylePresets(scene);
	if (presets.length === 0) return undefined;
	return presets.map((preset) => ({
		id: preset.id,
		name: preset.name,
		kind: preset.kind,
		hasPaint: preset.paint !== undefined,
		hasTypography: preset.typography !== undefined,
		hasAppearance: preset.appearance !== undefined,
	}));
};

/**
 * Compact discovery rows for the document's component-symbol library (id,
 * name, source node id, live instance count) so an agent can find a symbol id
 * before calling `scene/insert-component-instance-from-symbol`, and gauge
 * blast radius before editing a source. Omitted entirely when the library is
 * empty, mirroring `stylePresetSummaries`' omit-when-absent convention.
 */
const componentSymbolSummaries = (
	scene: AgentDocumentContext["scene"],
): readonly AgentComponentSymbolSummary[] | undefined => {
	const symbols = readComponentSymbols(scene);
	if (symbols.length === 0) return undefined;
	return symbols.map((symbol) => ({
		id: symbol.id,
		name: symbol.name,
		sourceNodeId: symbol.sourceNodeId,
		instanceCount: selectComponentInstanceNodes(scene, symbol.id).length,
	}));
};

/**
 * Compact discovery rows for the document's Motion Component export prop
 * library (id, name, type, default value, binding count) so an agent can find
 * a prop id before calling `scene/update-component-prop`/
 * `scene/remove-component-prop`, and gauge whether it is already wired
 * (`bindingCount`) before editing it. Omitted entirely when the library is
 * empty, mirroring `stylePresetSummaries`'/`componentSymbolSummaries`'
 * omit-when-absent convention.
 */
const componentPropSummaries = (
	scene: AgentDocumentContext["scene"],
): readonly AgentComponentPropSummary[] | undefined => {
	const props = readComponentProps(scene);
	if (props.length === 0) return undefined;
	return props.map((prop) => ({
		id: prop.id,
		name: prop.name,
		type: prop.type,
		defaultValue: prop.defaultValue,
		bindingCount: prop.bindings.length,
	}));
};

/**
 * Compact discovery rows for the document's interaction library (Interactive
 * Motion program, T3-S1): id, name, trigger kind/nodeId, and the kind of every
 * action. Omitted entirely when the library is empty, mirroring
 * `stylePresetSummaries`'/`componentPropSummaries`' omit-when-absent
 * convention.
 */
const interactionSummaries = (
	scene: AgentDocumentContext["scene"],
): readonly AgentInteractionSummary[] | undefined => {
	const interactions = readInteractions(scene);
	if (interactions.length === 0) return undefined;
	return interactions.map((interaction) => ({
		id: interaction.id,
		...(interaction.name ? { name: interaction.name } : {}),
		triggerKind: interaction.trigger.kind,
		...(interaction.trigger.nodeId
			? { triggerNodeId: interaction.trigger.nodeId }
			: {}),
		actionKinds: interaction.actions.map((action) => action.kind),
	}));
};

const scopedArtboardIdsForCameraRig = (
	scene: SceneDocument,
	rig: SceneCameraRigContract,
): readonly string[] =>
	rig.scope.kind === "scene"
		? selectAllArtboards(scene).map((artboard) => artboard.id)
		: [rig.scope.artboardId];

const sceneCameraSummary = (
	scene: SceneDocument,
	motion: MotionDocument,
	artboards: readonly Artboard[],
	nodes: readonly VectorNode[],
): AgentSceneCameraSummary | undefined => {
	const rigs = scene.sceneCameras ?? [];
	const depthNodes = nodes.filter((node) => node.depthPlane);
	const cameraTracks = motion.cameraTracks ?? [];
	const cameraCuts = motion.cameraCuts ?? [];
	if (
		rigs.length === 0 &&
		depthNodes.length === 0 &&
		cameraTracks.length === 0 &&
		cameraCuts.length === 0
	) {
		return undefined;
	}
	const activeCameraRigIds = [
		...uniqueIds(
			artboards.flatMap((artboard) =>
				artboard.activeSceneCameraId ? [artboard.activeSceneCameraId] : [],
			),
		),
	];
	return {
		cameraCount: rigs.length,
		activeCameraRigIds,
		depthNodeCount: depthNodes.length,
		cameraTrackCount: cameraTracks.length,
		cameraCutCount: cameraCuts.length,
		rigs: rigs.map((rig) => {
			const rigTracks = cameraTracks.filter(
				(track) => track.target.cameraRigId === rig.id,
			);
			const rigCuts = cameraCuts.filter(
				(segment) => segment.cameraRigId === rig.id,
			);
			const cameraTrackProperties = [
				...uniqueIds(rigTracks.map((track) => track.target.property)),
			];
			return {
				id: rig.id,
				name: rig.name,
				scope: rig.scope,
				projectionKind: rig.projection.kind,
				projection: rig.projection,
				bodyPosition: rig.body.position,
				...(rig.body.rotation ? { bodyRotation: rig.body.rotation } : {}),
				...(rig.target?.point ? { targetPoint: rig.target.point } : {}),
				scopedArtboardIds: scopedArtboardIdsForCameraRig(scene, rig),
				activeArtboardIds: artboards
					.filter((artboard) => artboard.activeSceneCameraId === rig.id)
					.map((artboard) => artboard.id),
				...(rig.target?.nodeId ? { targetNodeId: rig.target.nodeId } : {}),
				...(rig.body.parentControllerNodeId
					? { bodyControllerNodeId: rig.body.parentControllerNodeId }
					: {}),
				...(rig.target?.parentControllerNodeId
					? { targetControllerNodeId: rig.target.parentControllerNodeId }
					: {}),
				depthNodeCount: depthNodes.filter(
					(node) =>
						!node.depthPlane?.cameraRigId ||
						node.depthPlane.cameraRigId === rig.id,
				).length,
				cameraTrackCount: rigTracks.length,
				cameraTrackProperties,
				cameraCutCount: rigCuts.length,
			};
		}),
		cuts: cameraCuts.map((segment) => ({
			id: segment.id,
			...(segment.name ? { name: segment.name } : {}),
			artboardId: segment.artboardId,
			cameraRigId: segment.cameraRigId,
			...(segment.laneId ? { laneId: segment.laneId } : {}),
			startFrame: segment.startFrame,
			durationFrames: segment.durationFrames,
			transition: segment.transition,
			...(segment.transitionDurationFrames !== undefined
				? { transitionDurationFrames: segment.transitionDurationFrames }
				: {}),
			...(segment.thumbnailFrame !== undefined
				? { thumbnailFrame: segment.thumbnailFrame }
				: {}),
		})),
	};
};

const assetSourceKind = (asset: SceneAsset): SceneAsset["source"]["kind"] =>
	asset.source.kind;

const isExternalSceneAsset = (
	asset: SceneAsset,
): asset is Extract<
	SceneAsset,
	{ readonly kind: "external-scene" | "model-3d" | "code-module" }
> =>
	asset.kind === "external-scene" ||
	asset.kind === "model-3d" ||
	asset.kind === "code-module";

const isProgramSurfaceAsset = (
	asset: SceneAsset,
): asset is ProgramSurfaceAsset => asset.kind === "program-surface";

/**
 * Projects the durable manifest without crossing the source/approval boundary.
 * This is intentionally not a renderer or host eligibility decision.
 */
const programSurfaceObservation = (asset: ProgramSurfaceAsset) => ({
	runtimeKind: asset.manifest.runtime.kind,
	compiledDigest: asset.manifest.runtime.compiledDigest,
	snapshotDigest: asset.manifest.source.snapshotDigest,
	sourcePortability: asset.manifest.source.portability,
	output: {
		kind: asset.manifest.output.kind,
		alphaMode: asset.manifest.output.alphaMode,
		width: asset.manifest.output.width,
		height: asset.manifest.output.height,
	},
	timing: {
		seed: asset.manifest.timing.seed,
		deterministicAtFrame: asset.manifest.timing.deterministicAtFrame,
	},
	cameraSpacePolicy: asset.manifest.space.cameraSpacePolicy,
	delivery: {
		editor: asset.manifest.delivery.editor,
		webglPlayer: asset.manifest.delivery.webglPlayer,
		svgPdf: asset.manifest.delivery.svgPdf,
		video: asset.manifest.delivery.video,
	},
	...(asset.manifest.fallback
		? {
				fallback: {
					assetId: asset.manifest.fallback.assetId,
					...(asset.manifest.fallback.frame !== undefined
						? { frame: asset.manifest.fallback.frame }
						: {}),
				},
			}
		: {}),
});

const sceneAssetSummary = (
	scene: SceneDocument,
	nodes: readonly VectorNode[],
): AgentSceneAssetSummary | undefined => {
	const assets = scene.assets ?? [];
	if (assets.length === 0) return undefined;
	const externalAssets = assets.filter(isExternalSceneAsset);
	const programSurfaces = assets.filter(isProgramSurfaceAsset);
	const placedCounts = new Map<string, number>();
	const placedNodeIds = new Map<string, string[]>();
	for (const node of nodes) {
		if (node.geometry.kind !== "image") continue;
		placedCounts.set(
			node.geometry.assetId,
			(placedCounts.get(node.geometry.assetId) ?? 0) + 1,
		);
		const ids = placedNodeIds.get(node.geometry.assetId) ?? [];
		ids.push(node.id);
		placedNodeIds.set(node.geometry.assetId, ids);
	}
	const placedNodeCount = [...placedCounts.values()].reduce(
		(total, count) => total + count,
		0,
	);
	return {
		assetCount: assets.length,
		imageCount: assets.filter((asset) => asset.kind === "image").length,
		videoCount: assets.filter((asset) => asset.kind === "video").length,
		externalAssetCount: externalAssets.length,
		model3dCount: externalAssets.filter((asset) => asset.kind === "model-3d")
			.length,
		codeModuleCount: externalAssets.filter(
			(asset) => asset.kind === "code-module",
		).length,
		programSurfaceCount: programSurfaces.length,
		placedNodeCount,
		assets: assets.map((asset) => ({
			id: asset.id,
			kind: asset.kind,
			name: asset.name,
			sourceKind: assetSourceKind(asset),
			...(isProgramSurfaceAsset(asset)
				? { programSurface: programSurfaceObservation(asset) }
				: {}),
			...(isExternalSceneAsset(asset) && asset.format
				? { format: asset.format }
				: {}),
			...(isExternalSceneAsset(asset) && asset.preview?.assetId
				? { previewAssetId: asset.preview.assetId }
				: {}),
			...(isExternalSceneAsset(asset) && asset.preview?.role
				? { previewRole: asset.preview.role }
				: {}),
			...(isExternalSceneAsset(asset) && asset.capabilities
				? { capabilities: asset.capabilities }
				: {}),
			...(isExternalSceneAsset(asset) && asset.capabilities
				? {
						runtimeWebglCapable: asset.capabilities.includes("runtime-webgl"),
						exportFallbackCapable:
							asset.capabilities.includes("export-fallback"),
					}
				: {}),
			...(isExternalSceneAsset(asset) && asset.issues
				? { issueCount: asset.issues.length }
				: {}),
			...(isExternalSceneAsset(asset) && asset.issues
				? { issueCodes: [...new Set(asset.issues.map((issue) => issue.code))] }
				: {}),
			...(isProgramSurfaceAsset(asset) && asset.issues
				? { issueCount: asset.issues.length }
				: {}),
			...(isProgramSurfaceAsset(asset) && asset.issues
				? { issueCodes: [...new Set(asset.issues.map((issue) => issue.code))] }
				: {}),
			...(asset.mimeType ? { mimeType: asset.mimeType } : {}),
			// Audio assets (S5a) carry no width/height; the discriminant
			// property-existence check keeps this generic across every other
			// asset kind without adding a per-kind branch here.
			...("width" in asset && asset.width !== undefined
				? { width: asset.width }
				: {}),
			...("height" in asset && asset.height !== undefined
				? { height: asset.height }
				: {}),
			...(asset.kind === "video" && asset.durationSeconds !== undefined
				? { durationSeconds: asset.durationSeconds }
				: {}),
			placedNodeCount: placedCounts.get(asset.id) ?? 0,
			...((placedNodeIds.get(asset.id)?.length ?? 0) > 0
				? { placedNodeIds: placedNodeIds.get(asset.id) }
				: {}),
		})),
	};
};

const sourceOpticsSummary = (
	scene: SceneDocument,
	motion: MotionDocument,
	artboards: readonly Artboard[],
): AgentSourceOpticsSummary | undefined => {
	const rigs = artboards.flatMap((artboard) =>
		sourceOpticsRigsForArtboard(artboard).map((rig) => ({ artboard, rig })),
	);
	if (rigs.length === 0) return undefined;
	const sampledFrame = 0;
	const motionTracks = (motion.sourceOpticsTracks ?? []).map((track) => {
		const artboard = artboards.find(
			(candidate) => candidate.id === track.target.artboardId,
		);
		const staticValue = artboard
			? sourceOpticsParameterValue(artboard, track.target)
			: undefined;
		return {
			id: track.id,
			target: track.target,
			keyframeCount: track.keyframes.length,
			...(staticValue === undefined ? {} : { staticValue }),
			sampledFrame,
			...(staticValue === undefined
				? {}
				: {
						sampledValue: effectiveSourceOpticsParameter(
							motion,
							track.target,
							staticValue,
							sampledFrame,
						),
					}),
		};
	});
	const fidelityStatus = (
		artboardId: string,
		surface: "editor-svg" | "webgpu" | "runtime-svg",
	) => {
		const presentation = buildSourceOpticsPresentation(
			scene,
			artboardId,
			surface,
		);
		return (
			presentation.sourcePlans[0]?.fidelity.status ??
			presentation.targetPlans[0]?.fidelity.status ??
			"unsupported"
		);
	};
	const surfaceFidelity = rigs
		.map(({ artboard }) => artboard.id)
		.filter((artboardId, index, ids) => ids.indexOf(artboardId) === index)
		.map((artboardId) => ({
			artboardId,
			editorSvg: fidelityStatus(artboardId, "editor-svg"),
			webgpu: fidelityStatus(artboardId, "webgpu"),
			runtimeSvg: fidelityStatus(artboardId, "runtime-svg"),
		}));
	return {
		rigCount: rigs.length,
		responseCount: rigs.reduce(
			(total, entry) => total + entry.rig.responses.length,
			0,
		),
		issueCount: artboards.reduce(
			(total, artboard) =>
				total +
				buildSourceOpticsPresentation(scene, artboard.id, "editor-svg").issues
					.length,
			0,
		),
		motionTrackCount: motionTracks.length,
		parameters: SOURCE_OPTICS_PARAMETER_DESCRIPTORS,
		motionTracks,
		surfaceFidelity,
		rigs: rigs.map(({ artboard, rig }) => ({
			id: rig.id,
			name: rig.name,
			artboardId: artboard.id,
			sourceNodeId: rig.sourceNodeId,
			enabled: rig.enabled,
			responseCount: rig.responses.length,
		})),
	};
};

const arrangementLayoutSnapshotSummaries = (
	scene: SceneDocument,
): readonly AgentArrangementLayoutSnapshotSummary[] | undefined => {
	const snapshots = scene.arrangementLayoutSnapshots;
	if (!snapshots || snapshots.length === 0) return undefined;
	return snapshots.map((snapshot: ArrangementLayoutSnapshot) => {
		const read = readArrangementLayoutSnapshot(scene, snapshot);
		return {
			id: snapshot.id,
			name: snapshot.name,
			artboardId: snapshot.artboardId,
			coordinateSpace: snapshot.coordinateSpace,
			memberNodeIds: [...snapshot.memberNodeIds],
			captureToken: snapshot.captureToken,
			capturedArtboardSize: { ...snapshot.capturedArtboardSize },
			status: read.status,
			staleReasons: [...read.reasons],
		};
	});
};

/**
 * Creates the compact read model MCP agents should request before planning
 * edits. Large graph payloads stay out of this default observation so agents can
 * decide whether they need paginated layer or artboard tools.
 */
export function observeAgentDocument(
	context: AgentDocumentContext,
	detail: AgentObservationDetail = "summary",
): AgentToolResult<AgentDocumentObservation> {
	const artboards = selectAllArtboards(context.scene);
	const nodes = allNodes(context.scene);
	const layoutHealth = summarizeLayoutMaterializationHealth(nodes);
	const layoutSummary = layoutMaterializationSummary(layoutHealth);
	const stylePresets = stylePresetSummaries(context.scene);
	const componentSymbols = componentSymbolSummaries(context.scene);
	const componentProps = componentPropSummaries(context.scene);
	const interactions = interactionSummaries(context.scene);
	const cameras = sceneCameraSummary(
		context.scene,
		context.motion,
		artboards,
		nodes,
	);
	const assets = sceneAssetSummary(context.scene, nodes);
	const sourceOptics = sourceOpticsSummary(
		context.scene,
		context.motion,
		artboards,
	);
	const arrangementLayoutSnapshots = arrangementLayoutSnapshotSummaries(
		context.scene,
	);
	const observation: AgentDocumentObservation = {
		contractVersion: 1,
		detail,
		document: {
			id: context.scene.id,
			name: context.scene.name,
			schemaVersion: context.scene.schemaVersion,
			artboardCount: artboards.length,
			layerCount: context.scene.layers.length,
			nodeCount: nodes.length,
			motionTrackCount:
				context.motion.tracks.length +
				(context.motion.sourceOpticsTracks?.length ?? 0) +
				(context.motion.positionPaths?.length ?? 0),
			motionGrammarBindingCount: context.grammar.bindings.length,
			...(arrangementLayoutSnapshots ? { arrangementLayoutSnapshots } : {}),
			...(layoutSummary ? { layout: layoutSummary } : {}),
			...(stylePresets ? { stylePresets } : {}),
			...(componentSymbols ? { componentSymbols } : {}),
			...(componentProps ? { componentProps } : {}),
			...(interactions ? { interactions } : {}),
			...(cameras ? { sceneCamera: cameras } : {}),
			...(assets ? { assets } : {}),
			...(sourceOptics ? { sourceOptics } : {}),
		},
		selection: selectionOrEmpty(context.selection, context.scene),
		issues: [],
	};
	return createAgentToolResult("observe_document", observation);
}

const maxKeyframeTime = (
	keyframes: readonly { readonly time: number }[],
): number =>
	keyframes.reduce((max, keyframe) => Math.max(max, keyframe.time), 0);

/**
 * Builds the LIVE pre-mutation observation (bridge op `"observe"` — B2 in
 * `docs/gravity-parent-child-study-01-live-mcp-resolution-boundary.md`). Pure:
 * `identity` is plain data the caller reads from the live editor session
 * descriptor (features/agent's job — this entity module never touches a live
 * store), and `context` is the same scene/motion/grammar triple every other
 * read-only tool takes. Builds no command, opens no transaction, and mutates
 * nothing — the result can only describe what is already true of the document.
 */
export function observeAgentLiveDocument(
	context: AgentDocumentContext,
	identity: AgentLiveDocumentIdentity,
): AgentToolResult<AgentLiveDocumentObservation> {
	const artboard = selectCurrentArtboard(context.scene);
	const artboardNodes =
		selectNodeArtboardMapping(context.scene).byArtboardId[artboard.id] ?? [];

	const tracks: AgentLiveMotionTrackSummary[] = context.motion.tracks.map(
		(track) => ({
			id: track.id,
			...(track.target.nodeId ? { targetNodeId: track.target.nodeId } : {}),
			property: track.target.property,
			keyframeCount: track.keyframes.length,
			maxKeyframeFrame: maxKeyframeTime(track.keyframes),
		}),
	);

	const lookNodeTracks: AgentLiveLookNodeTrackSummary[] = (
		context.motion.lookNodeTracks ?? []
	).map((track) => ({
		id: track.id,
		owner: track.target.owner,
		lookNodeId: track.target.lookNodeId,
		paramKey: track.target.paramKey,
		keyframeCount: track.keyframes.length,
		maxFrame: maxKeyframeTime(track.keyframes),
	}));

	const scopedOverlaySummaries: AgentLiveScopedLookOverlaySummary[] =
		scopedLookGraphOverlays(artboard).map((overlay) => ({
			id: overlay.id,
			source: overlay.source,
			targetNodeIds: overlay.targetNodeIds,
			graphNodes: overlay.lookGraph.nodes.map(
				(node): AgentLiveLookGraphNodeSummary => ({
					id: node.id,
					kind: node.kind,
					payload: node.payload,
				}),
			),
		}));

	const motionDocument: AgentLiveMotionDocumentSummary = {
		fps: context.motion.fps,
		durationFrames: context.motion.durationFrames,
	};

	const motionInventory: AgentLiveMotionInventory = {
		tracks,
		lookNodeTrackCount: lookNodeTracks.length,
		clipCount: context.motion.clips.length,
		textAnimatorCount: context.motion.textAnimators?.length ?? 0,
		automationTrackCount: context.motion.automation?.tracks.length ?? 0,
		lookNodeTracks,
	};

	const artboardSummary: AgentLiveArtboardSummary = {
		id: artboard.id,
		name: artboard.name,
		width: artboard.width,
		height: artboard.height,
		fps: artboard.fps,
		durationFrames: artboard.durationFrames,
		background: artboard.background,
		...(artboard.cameraSpacePolicy !== undefined
			? { cameraSpacePolicy: artboard.cameraSpacePolicy }
			: {}),
	};

	const observation: AgentLiveDocumentObservation = {
		contractVersion: 1,
		identity,
		artboard: artboardSummary,
		motionDocument,
		motionInventory,
		nodes: artboardNodes.map(
			(node): AgentLiveNodeSummary => ({
				id: node.id,
				name: node.name,
				kind: node.geometry.kind,
			}),
		),
		scopedLookOverlays: scopedOverlaySummaries,
	};
	return createAgentToolResult("observe_document_live", observation);
}

const summarizeNodeGeometry = (
	node: VectorNode,
	includeGeometry: boolean,
): AgentNodeGeometrySummary => {
	const geometry = node.geometry;
	switch (geometry.kind) {
		case "rect":
		case "ellipse":
		case "image":
			return {
				kind: geometry.kind,
				bounds: geometry.bounds,
				...(includeGeometry ? { full: geometry } : {}),
			};
		case "text":
			return {
				kind: "text",
				bounds: geometry.bounds,
				text: { content: geometry.text, style: geometry.style },
				...(includeGeometry ? { full: geometry } : {}),
			};
		case "path":
			return {
				kind: "path",
				anchorCounts: {
					main: geometry.shape.vertices.length,
					subpaths: (geometry.subpaths ?? []).map(
						(subpath) => subpath.vertices.length,
					),
				},
				...(includeGeometry ? { full: geometry } : {}),
			};
		case "line":
		case "polygon":
		case "star":
			return {
				kind: geometry.kind,
				...(includeGeometry ? { full: geometry } : {}),
			};
		default: {
			// Exhaustiveness guard: NodeGeometry is a closed union, so a new kind
			// added there without a matching case above is a compile error here.
			const exhaustive: never = geometry;
			return exhaustive;
		}
	}
};

const summarizeNodeRecipe = (node: VectorNode): AgentNodeRecipeSummary => {
	const recipe = node.recipe;
	return {
		present: recipe !== undefined,
		...(recipe
			? { id: recipe.id, label: recipe.label, intent: recipe.intent }
			: {}),
		...(node.recipeRef ? { recipeRef: node.recipeRef } : {}),
	};
};

/**
 * Builds one node's `AgentNodeComponentRole`, resolving the scalar counts
 * (`instanceCount` for a source, `overrideCount`/`timingOffsetFrames` for an
 * instance) an agent needs to decide whether to edit the source, apply/reset
 * an override, detach, or re-stagger — without a second `observe_document` or
 * `list_layers` round trip for the common cases. `undefined` for a node with no
 * component binding.
 */
const summarizeComponentRole = (
	scene: AgentDocumentContext["scene"],
	node: VectorNode,
): AgentNodeComponentRole | undefined => {
	const binding = node.component;
	if (!binding) return undefined;
	if (binding.kind === "source") {
		return {
			kind: "source",
			symbolId: binding.symbolId,
			instanceCount: selectComponentInstanceNodes(scene, binding.symbolId)
				.length,
		};
	}
	return {
		kind: "instance",
		symbolId: binding.symbolId,
		sourceNodeId: binding.sourceNodeId,
		overrideCount: binding.overrides?.length ?? 0,
		timingOffsetFrames: binding.timingOffsetFrames ?? 0,
	};
};

/**
 * Finds every component-prop binding that targets `nodeId`, across the whole
 * document library (not just one prop) — the "which host-settable props
 * already drive this node?" read `observe_node` exposes per node. A prop can
 * contribute more than one row here (multiple bindings targeting the same
 * node) and this is intentionally unfiltered by that; see
 * `AgentNodeComponentPropBindingSummary`'s doc comment.
 */
const componentPropBindingsForNode = (
	scene: AgentDocumentContext["scene"],
	nodeId: string,
): readonly AgentNodeComponentPropBindingSummary[] => {
	const rows: AgentNodeComponentPropBindingSummary[] = [];
	for (const prop of readComponentProps(scene)) {
		for (const binding of prop.bindings) {
			if (binding.nodeId !== nodeId) continue;
			rows.push({
				propId: prop.id,
				propName: prop.name,
				bindingKind: binding.kind,
			});
		}
	}
	return rows;
};

/**
 * Finds every interaction whose `trigger.nodeId` targets `nodeId` (Interactive
 * Motion program, T3-S1) — the "which interactions already fire from this
 * node?" read `observe_node` exposes per node. Component-level interactions
 * (`trigger.nodeId` omitted) never match here; see `interactionSummaries` for
 * the whole-document equivalent that DOES include them.
 */
const interactionsForNode = (
	scene: AgentDocumentContext["scene"],
	nodeId: string,
): readonly AgentNodeInteractionSummary[] =>
	readInteractions(scene)
		.filter((interaction) => interaction.trigger.nodeId === nodeId)
		.map((interaction) => ({
			interactionId: interaction.id,
			triggerKind: interaction.trigger.kind,
		}));

const summarizeNodeRoles = (
	scene: AgentDocumentContext["scene"],
	node: VectorNode,
): AgentNodeRoleSummary => ({
	...(() => {
		const component = summarizeComponentRole(scene, node);
		return component ? { component } : {};
	})(),
	...(node.frame
		? { frame: { clipsContent: node.frame.clipsContent ?? true } }
		: {}),
	...(node.blend ? { blend: { kind: node.blend.kind } } : {}),
	...(node.motionController
		? { motionController: { kind: node.motionController.kind } }
		: {}),
	...(node.motionParent
		? { motionParent: { parentNodeId: node.motionParent.parentNodeId } }
		: {}),
	...(node.transformConstraint
		? {
				transformConstraint: {
					id: node.transformConstraint.id,
					sourceNodeId: node.transformConstraint.sourceNodeId,
					channels: node.transformConstraint.channels,
					strength: node.transformConstraint.strength,
					sourceSpace: node.transformConstraint.sourceSpace,
					destinationSpace: node.transformConstraint.destinationSpace,
					maintainOffset: node.transformConstraint.maintainOffset,
				},
			}
		: {}),
	...(node.propertyRelations && node.propertyRelations.length > 0
		? {
				propertyRelations: node.propertyRelations.map((relation) => ({
					id: relation.id,
					sourceNodeId: relation.sourceNodeId,
					sourceProperty: relation.sourceProperty,
					targetProperty: relation.targetProperty,
					scale: relation.scale,
					offset: relation.offset,
				})),
			}
		: {}),
	textFragmentGroup: node.textFragmentGroup !== undefined,
	maskRelationCount: readAppearanceMaskRelations(node).length,
});

const summarizeNodeMotion = (
	context: AgentDocumentContext,
	nodeId: string,
): AgentNodeMotionSummary => {
	const nodeTracks = context.motion.tracks.filter(
		(track) => track.target.nodeId === nodeId,
	);
	const propertyCounts = new Map<AnimatableProperty, number>();
	for (const track of nodeTracks) {
		propertyCounts.set(
			track.target.property,
			(propertyCounts.get(track.target.property) ?? 0) + track.keyframes.length,
		);
	}
	const properties: readonly AgentNodeMotionPropertySummary[] = [
		...propertyCounts.entries(),
	].map(([property, keyframeCount]) => ({ property, keyframeCount }));
	const textAnimatorBindingIds = (context.motion.textAnimators ?? [])
		.filter((binding) => binding.target.nodeId === nodeId)
		.map((binding) => binding.id);
	const grammarBindingIds = context.grammar.bindings
		.filter((binding) => binding.targetIds.includes(nodeId))
		.map((binding) => binding.id);
	const spatialPath = context.motion.positionPaths?.find(
		(path) => path.nodeId === nodeId,
	);
	const morphTrack = context.motion.tracks.find(
		(track) =>
			track.target.nodeId === nodeId && track.target.property === "pathShape",
	);
	const morphTopology = morphTrack ? inspectMorphTopology(morphTrack) : null;
	return {
		properties,
		tracks: nodeTracks.map((track) => ({
			id: track.id,
			property: track.target.property,
			keyframes: track.keyframes.map((keyframe) => ({
				frame: keyframe.time,
				value: structuredClone(keyframe.value),
			})),
		})),
		...(spatialPath
			? {
					spatialPath: {
						trackId: spatialPath.id,
						keyCount: spatialPath.keys.length,
						rovingKeyCount: spatialPath.keys.filter((key) => key.roving).length,
						frames: spatialPath.keys.map((key) => key.frame),
					},
				}
			: {}),
		...(morphTrack && morphTopology
			? {
					morphTopology: {
						trackId: morphTrack.id,
						keyCount: morphTrack.keyframes.length,
						compatible: morphTopology.compatible,
						vertexCounts: morphTopology.vertexCounts,
						closedStates: morphTopology.closedStates,
						issueCodes: morphTopology.issues.map((issue) => issue.code),
					},
				}
			: {}),
		textAnimatorBindingIds,
		grammarBindingIds,
	};
};

const sourceOpticsNodeSummary = (
	scene: SceneDocument,
	nodeId: string,
): AgentNodeObservation["sourceOptics"] => {
	const entries = selectAllArtboards(scene).flatMap((artboard) =>
		sourceOpticsRigsForArtboard(artboard).map((rig) => ({ artboard, rig })),
	);
	const sourceRigIds = entries
		.filter(({ rig }) => rig.sourceNodeId === nodeId)
		.map(({ rig }) => rig.id);
	const responseBindings = entries.flatMap(({ rig }) =>
		rig.responses.flatMap((binding) =>
			binding.targetNodeId === nodeId
				? [
						{
							rigId: rig.id,
							bindingId: binding.id,
							sourceNodeId: rig.sourceNodeId,
						},
					]
				: [],
		),
	);
	return sourceRigIds.length > 0 || responseBindings.length > 0
		? { sourceRigIds, responseBindings }
		: undefined;
};

/**
 * Full per-node read for LLM planning: transform, style, geometry (compact by
 * default; `includeGeometry` opts into raw coordinates), roles, recipe/look
 * presence, attached motion (keyframe counts and grammar bindings), and
 * eligible bindable property ids — the fields an agent otherwise has to piece
 * together from `list_layers` (kind/visible/locked only) plus a guess at
 * `list_bindable_properties`. Bounded to {@link MAX_OBSERVE_NODE_IDS} node ids
 * per call since a full-fidelity read is heavier than the other list tools'
 * summaries; missing ids report a per-node issue but do not fail the whole
 * batch, so a caller can still read the nodes that do exist.
 */
export function observeAgentNode(
	context: AgentDocumentContext,
	request: AgentObserveNodeRequest,
): AgentToolResult<AgentObserveNodeResult> {
	const includeGeometry = request.includeGeometry ?? false;
	const issues: AgentIssue[] = [];
	if (request.nodeIds.length === 0) {
		issues.push(
			createAgentIssue(
				"agent.observe-node-empty-request",
				"error",
				"observe_node requires at least one node id.",
				{ kind: "tool", id: "observe_node" },
			),
		);
		return createAgentToolResult("observe_node", { nodes: [] }, issues);
	}
	if (request.nodeIds.length > MAX_OBSERVE_NODE_IDS) {
		issues.push(
			createAgentIssue(
				"agent.observe-node-too-many-ids",
				"error",
				`observe_node accepts at most ${MAX_OBSERVE_NODE_IDS} node ids; got ${request.nodeIds.length}.`,
				{ kind: "tool", id: "observe_node" },
			),
		);
		return createAgentToolResult("observe_node", { nodes: [] }, issues);
	}

	const nodes: AgentNodeObservation[] = [];
	for (const nodeId of request.nodeIds) {
		const node = findNode(context.scene, nodeId);
		if (!node) {
			issues.push(
				createAgentIssue(
					"agent.observe-node-missing-node",
					"error",
					`Node "${nodeId}" was not found.`,
					{ kind: "node", id: nodeId },
				),
			);
			continue;
		}
		const bindableProperties = listAgentBindableProperties(context, {
			tool: "list_bindable_properties",
			nodeId,
		});
		const sourceOptics = sourceOpticsNodeSummary(context.scene, node.id);
		nodes.push({
			nodeId: node.id,
			name: node.name,
			artboardId: selectArtboardIdForNode(context.scene, node.id),
			transform: node.transform,
			style: node.style,
			geometry: summarizeNodeGeometry(node, includeGeometry),
			visible: node.visible,
			locked: node.locked,
			roles: summarizeNodeRoles(context.scene, node),
			recipe: summarizeNodeRecipe(node),
			motion: summarizeNodeMotion(context, node.id),
			bindablePropertyIds: (bindableProperties.data?.properties ?? []).map(
				(property) => property.id,
			),
			componentPropBindings: componentPropBindingsForNode(
				context.scene,
				node.id,
			),
			interactions: interactionsForNode(context.scene, node.id),
			...(sourceOptics ? { sourceOptics } : {}),
		});
	}

	return createAgentToolResult("observe_node", { nodes }, issues);
}

/** Lists normalized artboards with node ownership counts for read-only agents. */
export function listAgentArtboards(
	context: AgentDocumentContext,
): AgentToolResult<AgentArtboardList> {
	const current = selectCurrentArtboard(context.scene);
	const mapping = selectNodeArtboardMapping(context.scene);
	return createAgentToolResult("list_artboards", {
		currentArtboardId: current.id,
		artboards: selectAllArtboards(context.scene).map((artboard) => ({
			id: artboard.id,
			name: artboard.name,
			position: artboard.position,
			width: artboard.width,
			height: artboard.height,
			background: artboard.background,
			fps: artboard.fps,
			durationFrames: artboard.durationFrames,
			...(artboard.cameraSpacePolicy !== undefined
				? { cameraSpacePolicy: artboard.cameraSpacePolicy }
				: {}),
			nodeCount: mapping.byArtboardId[artboard.id]?.length ?? 0,
			current: artboard.id === current.id,
		})),
	});
}

const summarizeNode = (
	node: VectorNode,
	artboardByNodeId: Readonly<Record<string, string>>,
	layoutChild?: AgentNodeSummary["layoutChild"],
): AgentNodeSummary => {
	const layout = summarizeLayoutFrame(node);
	const layoutChildren = new Map<
		string,
		NonNullable<AgentNodeSummary["layoutChild"]>
	>();
	if (layout) {
		for (const cell of layout.resolved.cells) {
			layoutChildren.set(cell.nodeId, {
				frameNodeId: node.id,
				frameName: node.name,
				...(layout.resolvedVariantId
					? { resolvedVariantId: layout.resolvedVariantId }
					: {}),
				placement: summarizeLayoutPlacement(cell.placement),
				bounds: cell.bounds,
				...(cell.sourceBounds ? { sourceBounds: cell.sourceBounds } : {}),
				...(cell.expectedBounds ? { expectedBounds: cell.expectedBounds } : {}),
				...(cell.materializationDrift
					? { materializationDrift: cell.materializationDrift }
					: {}),
			});
		}
	}
	return {
		id: node.id,
		name: node.name,
		kind: node.geometry.kind,
		artboardId: artboardByNodeId[node.id],
		visible: node.visible,
		locked: node.locked,
		childCount: node.children?.length ?? 0,
		...(layoutChild ? { layoutChild } : {}),
		...(node.children?.length
			? {
					children: node.children.map((child) =>
						summarizeNode(
							child,
							artboardByNodeId,
							layoutChildren.get(child.id),
						),
					),
				}
			: {}),
		...(node.frame?.kind === "frame"
			? {
					frame: {
						clipsContent: node.frame.clipsContent ?? true,
						...(layout ? { layout } : {}),
					},
				}
			: {}),
	};
};

const summarizeLayer = (
	layer: SceneLayer,
	artboardByNodeId: Readonly<Record<string, string>>,
): AgentLayerSummary => ({
	id: layer.id,
	name: layer.name,
	visible: layer.visible,
	locked: layer.locked,
	nodeCount: countNodes(layer.nodes),
	visibleNodeCount: countVisibleNodes(layer.nodes),
	nodes: layer.nodes.map((node) => summarizeNode(node, artboardByNodeId)),
});

/** Lists layer rows in stable document order with bounded output. */
export function listAgentLayers(
	context: AgentDocumentContext,
	request: Pick<AgentListLayersRequest, "offset" | "limit"> = {},
): AgentToolResult<AgentLayerList> {
	const offset = Math.max(0, Math.trunc(request.offset ?? 0));
	const requestedLimit = Math.trunc(request.limit ?? DEFAULT_LAYER_LIMIT);
	const limit = Math.max(
		1,
		Math.min(100, requestedLimit || DEFAULT_LAYER_LIMIT),
	);
	const artboardByNodeId = selectNodeArtboardMapping(context.scene).byNodeId;
	const layers = context.scene.layers
		.slice(offset, offset + limit)
		.map((layer) => summarizeLayer(layer, artboardByNodeId));

	return createAgentToolResult("list_layers", {
		offset,
		limit,
		total: context.scene.layers.length,
		layers,
	});
}

const bindableCommandAvailability = (input: {
	readonly supported: boolean;
	readonly tool: AgentBindablePropertyCommandAvailability["tool"];
	readonly commandType: AgentBindablePropertyCommandAvailability["commandType"];
	readonly reason?: string;
}): AgentBindablePropertyCommandAvailability =>
	input.reason
		? {
				supported: input.supported,
				tool: input.tool,
				commandType: input.commandType,
				reason: input.reason,
			}
		: {
				supported: input.supported,
				tool: input.tool,
				commandType: input.commandType,
			};

const sceneSetAvailability = (
	descriptor: BindablePropertyDescriptor,
): AgentBindablePropertyCommandAvailability => {
	if (!descriptor.control.agentWritable) {
		return bindableCommandAvailability({
			supported: false,
			tool: "apply_scene_commands",
			commandType: "scene/set-bindable-property",
			reason: "Descriptor is not marked agent-writable.",
		});
	}
	if (descriptor.control.valueKind !== "number") {
		return bindableCommandAvailability({
			supported: false,
			tool: "apply_scene_commands",
			commandType: "scene/set-bindable-property",
			reason: "scene/set-bindable-property currently accepts numeric values.",
		});
	}
	if (descriptor.source.kind === "scene-property") {
		return bindableCommandAvailability({
			supported: true,
			tool: "apply_scene_commands",
			commandType: "scene/set-bindable-property",
		});
	}
	if (descriptor.source.kind === "duplicate-generator") {
		return bindableCommandAvailability({
			supported: true,
			tool: "apply_scene_commands",
			commandType: "scene/set-bindable-property",
		});
	}
	if (descriptor.source.kind === "scene-camera") {
		return bindableCommandAvailability({
			supported: false,
			tool: "apply_scene_commands",
			commandType: "scene/set-bindable-property",
			reason:
				"Camera-rig channels are written via motion/upsert-camera-keyframe (cameraRigId + property), not scene/set-bindable-property.",
		});
	}
	const capability = effectCapabilityById(descriptor.source.capabilityId);
	if (
		capability?.targetScopes.some((scope) => scope === "node") &&
		capability.source.kind === "recipe-control" &&
		capability.control.valueKind === "number"
	) {
		return bindableCommandAvailability({
			supported: true,
			tool: "apply_scene_commands",
			commandType: "scene/set-bindable-property",
		});
	}
	return bindableCommandAvailability({
		supported: false,
		tool: "apply_scene_commands",
		commandType: "scene/set-bindable-property",
		reason:
			"scene/set-bindable-property currently writes native scene properties, node recipe controls, and duplicate-generator channels.",
	});
};

const frameEffectSetAvailability = (
	descriptor: BindablePropertyDescriptor,
): AgentBindablePropertyCommandAvailability => {
	if (!descriptor.control.agentWritable) {
		return bindableCommandAvailability({
			supported: false,
			tool: "apply_scene_commands",
			commandType: "scene/set-bindable-effect-property",
			reason: "Descriptor is not marked agent-writable.",
		});
	}
	if (descriptor.control.valueKind !== "number") {
		return bindableCommandAvailability({
			supported: false,
			tool: "apply_scene_commands",
			commandType: "scene/set-bindable-effect-property",
			reason:
				"scene/set-bindable-effect-property currently accepts numeric values.",
		});
	}
	if (descriptor.source.kind !== "effect-capability") {
		return bindableCommandAvailability({
			supported: false,
			tool: "apply_scene_commands",
			commandType: "scene/set-bindable-effect-property",
			reason:
				"scene/set-bindable-effect-property writes frame-level effect capabilities only.",
		});
	}
	const capability = effectCapabilityById(descriptor.source.capabilityId);
	if (
		capability?.targetScopes.some(
			(scope) => scope === "artboard" || scope === "scene",
		) &&
		(capability.source.kind === "recipe-control" ||
			capability.source.kind === "influence-control") &&
		capability.control.valueKind === "number"
	) {
		return bindableCommandAvailability({
			supported: true,
			tool: "apply_scene_commands",
			commandType: "scene/set-bindable-effect-property",
		});
	}
	return bindableCommandAvailability({
		supported: false,
		tool: "apply_scene_commands",
		commandType: "scene/set-bindable-effect-property",
		reason:
			"scene/set-bindable-effect-property currently writes scene/artboard numeric frame recipe and influence controls.",
	});
};

const expressionSetAvailability = (
	descriptor: BindablePropertyDescriptor,
	commandType:
		| "scene/set-bindable-expression"
		| "scene/clear-bindable-expression",
): AgentBindablePropertyCommandAvailability => {
	if (!descriptor.control.expressionBindable) {
		return bindableCommandAvailability({
			supported: false,
			tool: "apply_scene_commands",
			commandType,
			reason: "Descriptor is not marked expression-bindable.",
		});
	}
	if (descriptor.source.kind === "duplicate-generator") {
		return bindableCommandAvailability({
			supported: true,
			tool: "apply_scene_commands",
			commandType,
		});
	}
	if (
		descriptor.source.kind === "scene-property" &&
		nativeExpressionPropertyIdFromBindableId(descriptor.id)
	) {
		return bindableCommandAvailability({
			supported: true,
			tool: "apply_scene_commands",
			commandType,
		});
	}
	if (descriptor.source.kind === "effect-capability") {
		const capability = effectCapabilityById(descriptor.source.capabilityId);
		if (
			capability?.targetScopes.some((scope) => scope === "node") &&
			capability.source.kind === "recipe-control" &&
			capability.control.expressionBindable
		) {
			return bindableCommandAvailability({
				supported: true,
				tool: "apply_scene_commands",
				commandType,
			});
		}
	}
	return bindableCommandAvailability({
		supported: false,
		tool: "apply_scene_commands",
		commandType,
		reason:
			"Bindable expressions currently target transform.x/y, transform.anchorX/Y, transform.rotation, style.opacity, corner geometry scalars, node-look recipe controls, and duplicate-generator channels.",
	});
};

const frameEffectExpressionAvailability = (
	descriptor: BindablePropertyDescriptor,
	commandType:
		| "scene/set-bindable-effect-expression"
		| "scene/clear-bindable-effect-expression",
): AgentBindablePropertyCommandAvailability => {
	if (!descriptor.control.expressionBindable) {
		return bindableCommandAvailability({
			supported: false,
			tool: "apply_scene_commands",
			commandType,
			reason: "Descriptor is not marked expression-bindable.",
		});
	}
	if (descriptor.source.kind !== "effect-capability") {
		return bindableCommandAvailability({
			supported: false,
			tool: "apply_scene_commands",
			commandType,
			reason:
				"Frame effect expressions target frame-level effect capabilities only.",
		});
	}
	const capability = effectCapabilityById(descriptor.source.capabilityId);
	if (
		capability?.targetScopes.some(
			(scope) => scope === "artboard" || scope === "scene",
		) &&
		(capability.source.kind === "recipe-control" ||
			capability.source.kind === "influence-control") &&
		capability.control.expressionBindable
	) {
		return bindableCommandAvailability({
			supported: true,
			tool: "apply_scene_commands",
			commandType,
		});
	}
	return bindableCommandAvailability({
		supported: false,
		tool: "apply_scene_commands",
		commandType,
		reason:
			"Frame effect expressions currently target scene/artboard frame recipe and influence controls.",
	});
};

const motionKeyframeAvailability = (
	descriptor: BindablePropertyDescriptor,
): AgentBindablePropertyCommandAvailability => {
	if (descriptor.source.kind === "scene-camera") {
		return bindableCommandAvailability({
			supported: false,
			tool: "apply_motion_commands",
			commandType: "motion/set-bindable-keyframe",
			reason:
				"Camera-rig channels are keyframed via motion/upsert-camera-keyframe (cameraRigId + property + frame + value), not motion/set-bindable-keyframe.",
		});
	}
	if (!descriptor.control.keyframable || !descriptor.keyframeChannel) {
		return bindableCommandAvailability({
			supported: false,
			tool: "apply_motion_commands",
			commandType: "motion/set-bindable-keyframe",
			reason: "Descriptor does not expose a keyframe channel.",
		});
	}
	if (descriptor.control.valueKind !== "number") {
		return bindableCommandAvailability({
			supported: false,
			tool: "apply_motion_commands",
			commandType: "motion/set-bindable-keyframe",
			reason: "motion/set-bindable-keyframe currently accepts numeric values.",
		});
	}
	return bindableCommandAvailability({
		supported: true,
		tool: "apply_motion_commands",
		commandType: "motion/set-bindable-keyframe",
	});
};

const eligibilityReason = (
	eligibility: BindablePropertyEligibility,
): string => {
	switch (eligibility.kind) {
		case "any-node":
			return "Any scene node is eligible.";
		case "geometry":
			return `Requires geometry kind: ${eligibility.geometryKinds.join(", ")}.`;
		case "effect-capability":
			return "Requires a node-targeted effect capability.";
		case "duplicate-generator":
			return "Targets duplicate generators, not scene nodes.";
		case "scene-camera":
			return "Requires an existing scene-camera rig (list_bindable_properties cameraRigId).";
	}
};

const bindableNodeEligibility = (
	descriptor: BindablePropertyDescriptor,
	node: VectorNode,
): AgentBindablePropertyNodeEligibility => {
	if (descriptor.eligibility.kind === "duplicate-generator") {
		return {
			nodeId: node.id,
			eligible: true,
			geometryKind: node.geometry.kind,
			reason: "Uses this node as the duplicate generator source.",
		};
	}
	if (!descriptor.targetScopes.some((scope) => scope === "node")) {
		return {
			nodeId: node.id,
			eligible: false,
			geometryKind: node.geometry.kind,
			reason: "Property does not target scene nodes.",
		};
	}
	switch (descriptor.eligibility.kind) {
		case "any-node":
		case "effect-capability":
			return {
				nodeId: node.id,
				eligible: true,
				geometryKind: node.geometry.kind,
			};
		case "geometry": {
			const eligible = descriptor.eligibility.geometryKinds.some(
				(kind) => kind === node.geometry.kind,
			);
			return {
				nodeId: node.id,
				eligible,
				geometryKind: node.geometry.kind,
				...(descriptor.eligibility.requiredMode
					? { requiredMode: descriptor.eligibility.requiredMode }
					: {}),
				...(eligible
					? {}
					: { reason: eligibilityReason(descriptor.eligibility) }),
			};
		}
		case "scene-camera":
			// Unreachable in practice: the guard above already returns for any
			// descriptor whose targetScopes excludes "node", and scene-camera
			// descriptors never target "node". Kept for switch exhaustiveness.
			return {
				nodeId: node.id,
				eligible: false,
				geometryKind: node.geometry.kind,
				reason: "Targets a scene camera rig, not scene nodes.",
			};
	}
};

/**
 * Reads one {@link CameraRigAnimatableProperty} channel's live value straight
 * off a `SceneCameraRigContract`, mirroring the exact sub-fields
 * `sceneCameraSummary` (this file, `observe_document`'s scene-camera summary)
 * already reads — `body.position`, `body.rotation`, `target.point`,
 * `projection.*` — rather than re-deriving a separate reading of the rig.
 * Returns `undefined` when the underlying field is itself unset (e.g. no
 * `body.rotation` authored, no `target` bound), never a guessed default.
 */
const cameraChannelCurrentValue = (
	rig: SceneCameraRigContract,
	property: CameraRigAnimatableProperty,
): number | undefined => {
	switch (property) {
		case "bodyX":
			return rig.body.position.x;
		case "bodyY":
			return rig.body.position.y;
		case "bodyZ":
			return rig.body.position.z;
		case "bodyRotationX":
			return rig.body.rotation?.x;
		case "bodyRotationY":
			return rig.body.rotation?.y;
		case "bodyRotationZ":
			return rig.body.rotation?.z;
		case "targetX":
			return rig.target?.point.x;
		case "targetY":
			return rig.target?.point.y;
		case "targetZ":
			return rig.target?.point.z;
		case "fovDegrees":
			return rig.projection.fovDegrees;
		case "zoom":
			return rig.projection.zoom;
		case "focusDistance":
			return rig.projection.focusDistance;
		case "aperture":
			return rig.projection.aperture;
	}
};

/**
 * Uniform scope gate for a `cameraRigId`-scoped `list_bindable_properties`
 * request: every `scene-camera`-scoped descriptor is eligible for any
 * existing rig (channel identity does not vary per rig, unlike node
 * eligibility varying by geometry kind), every other descriptor is not.
 */
const bindableCameraEligibility = (
	descriptor: BindablePropertyDescriptor,
	cameraRigId: string,
): AgentBindablePropertyCameraEligibility => {
	if (!descriptor.targetScopes.some((scope) => scope === "scene-camera")) {
		return {
			cameraRigId,
			eligible: false,
			reason: "Property does not target a scene camera.",
		};
	}
	return { cameraRigId, eligible: true };
};

/**
 * Builds the camera-channel current-value row for one descriptor against
 * `cameraRig`, or `undefined` for a non-`scene-camera` descriptor or a rig
 * field that is itself unset. A dedicated function (rather than inlining at
 * the call site) keeps the `descriptor.source.kind === "scene-camera"`
 * narrowing local to one place instead of needing a re-narrow/cast later.
 */
const bindableCameraChannelValue = (
	descriptor: BindablePropertyDescriptor,
	cameraRig: SceneCameraRigContract,
): AgentBindablePropertyCameraChannelValue | undefined => {
	if (descriptor.source.kind !== "scene-camera") return undefined;
	const value = cameraChannelCurrentValue(
		cameraRig,
		descriptor.source.property,
	);
	if (value === undefined) return undefined;
	return {
		cameraRigId: cameraRig.id,
		property: descriptor.source.property,
		value,
	};
};

const summarizeBindableProperty = (
	descriptor: BindablePropertyDescriptor,
	node?: VectorNode,
	cameraRig?: SceneCameraRigContract,
): AgentBindablePropertySummary => {
	const nodeEligibility = node
		? bindableNodeEligibility(descriptor, node)
		: undefined;
	const cameraEligibility = cameraRig
		? bindableCameraEligibility(descriptor, cameraRig.id)
		: undefined;
	const cameraChannelValue = cameraRig
		? bindableCameraChannelValue(descriptor, cameraRig)
		: undefined;
	return {
		id: descriptor.id,
		label: descriptor.label,
		source: descriptor.source,
		targetScopes: descriptor.targetScopes,
		eligibility: descriptor.eligibility,
		control: descriptor.control,
		support: descriptor.support,
		commands: {
			sceneSetBindableProperty: sceneSetAvailability(descriptor),
			sceneSetBindableExpression: expressionSetAvailability(
				descriptor,
				"scene/set-bindable-expression",
			),
			sceneClearBindableExpression: expressionSetAvailability(
				descriptor,
				"scene/clear-bindable-expression",
			),
			sceneSetBindableEffectProperty: frameEffectSetAvailability(descriptor),
			sceneSetBindableEffectExpression: frameEffectExpressionAvailability(
				descriptor,
				"scene/set-bindable-effect-expression",
			),
			sceneClearBindableEffectExpression: frameEffectExpressionAvailability(
				descriptor,
				"scene/clear-bindable-effect-expression",
			),
			motionSetBindableKeyframe: motionKeyframeAvailability(descriptor),
		},
		...(descriptor.keyframeChannel
			? { keyframeChannel: descriptor.keyframeChannel }
			: {}),
		...(descriptor.directManipulation
			? { directManipulation: descriptor.directManipulation }
			: {}),
		...(nodeEligibility ? { nodeEligibility } : {}),
		...(cameraEligibility ? { cameraEligibility } : {}),
		...(cameraChannelValue ? { cameraChannelValue } : {}),
	};
};

const defaultBindableFilters = (
	request: AgentListBindablePropertiesRequest,
): BindablePropertyFilters => ({
	targetScope: request.targetScope,
	sourceKind: request.sourceKind,
	nodeId: request.nodeId,
	cameraRigId: request.cameraRigId,
	sceneWritableOnly: request.sceneWritableOnly ?? false,
	keyframableOnly: request.keyframableOnly ?? false,
	includeIneligible: request.includeIneligible ?? false,
});

const sourceKindMatches = (
	source: BindablePropertySource,
	sourceKind: BindablePropertySource["kind"] | undefined,
): boolean => !sourceKind || source.kind === sourceKind;

const bindablePropertyMatchesFilters = (
	property: AgentBindablePropertySummary,
	filters: BindablePropertyFilters,
): boolean => {
	if (
		filters.targetScope &&
		!property.targetScopes.some((scope) => scope === filters.targetScope)
	) {
		return false;
	}
	if (!sourceKindMatches(property.source, filters.sourceKind)) return false;
	if (
		filters.sceneWritableOnly &&
		!property.commands.sceneSetBindableProperty.supported &&
		!property.commands.sceneSetBindableExpression.supported &&
		!property.commands.sceneSetBindableEffectProperty.supported &&
		!property.commands.sceneSetBindableEffectExpression.supported
	) {
		return false;
	}
	if (
		filters.keyframableOnly &&
		!property.commands.motionSetBindableKeyframe.supported
	) {
		return false;
	}
	if (
		filters.nodeId &&
		!filters.includeIneligible &&
		property.nodeEligibility?.eligible === false
	) {
		return false;
	}
	if (
		filters.cameraRigId &&
		!filters.includeIneligible &&
		property.cameraEligibility?.eligible === false
	) {
		return false;
	}
	return true;
};

/**
 * Lists code-bindable properties from the registry so agents can discover stable
 * ids, command reachability, and target-node eligibility before writing or
 * keyframing through the command bus. Scoping to an existing `cameraRigId`
 * additionally attaches each `scene-camera` channel's live value from that rig
 * (P5, `docs/3d-camera-motion-standards-plan.md` §3.7) — this is a discovery-only
 * addition; camera keyframes are still written through the existing
 * `motion/upsert-camera-keyframe` command, not through this tool.
 */
export function listAgentBindableProperties(
	context: AgentDocumentContext,
	request: AgentListBindablePropertiesRequest = {
		tool: "list_bindable_properties",
	},
): AgentToolResult<AgentBindablePropertyList> {
	const filters = defaultBindableFilters(request);
	const node = filters.nodeId
		? findNode(context.scene, filters.nodeId)
		: undefined;
	if (filters.nodeId && !node) {
		const issues = [
			createAgentIssue(
				"agent.bindable-property-node-missing",
				"error",
				`Node "${filters.nodeId}" was not found.`,
				{ kind: "node", id: filters.nodeId },
			),
		];
		return createAgentToolResult(
			"list_bindable_properties",
			{ filters, total: 0, properties: [] },
			issues,
		);
	}

	const cameraRig = filters.cameraRigId
		? context.scene.sceneCameras?.find((rig) => rig.id === filters.cameraRigId)
		: undefined;
	if (filters.cameraRigId && !cameraRig) {
		const issues = [
			createAgentIssue(
				"agent.bindable-property-camera-missing",
				"error",
				`Scene camera "${filters.cameraRigId}" was not found.`,
				{ kind: "document", id: context.scene.id },
			),
		];
		return createAgentToolResult(
			"list_bindable_properties",
			{ filters, total: 0, properties: [] },
			issues,
		);
	}

	const properties = BINDABLE_PROPERTY_DESCRIPTORS.map((descriptor) =>
		summarizeBindableProperty(descriptor, node, cameraRig),
	).filter((property) => bindablePropertyMatchesFilters(property, filters));

	return createAgentToolResult("list_bindable_properties", {
		filters,
		total: properties.length,
		properties,
	});
}

/**
 * Lists object-appearance effects (stroke-only blur and object mask feather)
 * derived from canonical scene state, so agents can discover otherwise hidden
 * mask relation ids and stroke softness per node and learn the canonical command
 * that writes each one. The effects are a pure projection — there is no separate
 * stored state to drift from the node style / mask relation metadata.
 */
export function listAgentAppearanceEffects(
	context: AgentDocumentContext,
	request: AgentListAppearanceEffectsRequest = {
		tool: "list_appearance_effects",
	},
): AgentToolResult<AgentAppearanceEffectsList> {
	const filters = { nodeId: request.nodeId };
	const node = request.nodeId
		? findNode(context.scene, request.nodeId)
		: undefined;
	if (request.nodeId && !node) {
		return createAgentToolResult(
			"list_appearance_effects",
			{ filters, total: 0, effects: [] },
			[
				createAgentIssue(
					"agent.appearance-effect-node-missing",
					"error",
					`Node "${request.nodeId}" was not found.`,
					{ kind: "node", id: request.nodeId },
				),
			],
		);
	}

	const sourceNodes = node ? [node] : allNodes(context.scene);
	const effects = sourceNodes.flatMap((sceneNode) =>
		deriveObjectAppearanceEffects(sceneNode),
	);

	return createAgentToolResult("list_appearance_effects", {
		filters,
		total: effects.length,
		effects,
	});
}

const AUTHORABLE_TECHNIQUE_IDS = new Set<MotionGrammarTechniqueId>(
	authorableTechniqueIds(),
);

const defaultMotionGrammarFilters = (
	request: AgentListMotionGrammarRequest,
): MotionGrammarFilters => ({
	techniqueId: request.techniqueId,
	nodeId: request.nodeId,
	authorableOnly: request.authorableOnly ?? !request.techniqueId,
	implementedOnly: request.implementedOnly ?? true,
	includeBindings: request.includeBindings ?? true,
	includeIneligibleTargets: request.includeIneligibleTargets ?? true,
});

const motionGrammarTechniqueMatchesFilters = (
	entry: MotionGrammarCatalogEntry,
	filters: MotionGrammarFilters,
): boolean => {
	if (filters.techniqueId && entry.id !== filters.techniqueId) return false;
	if (filters.implementedOnly && entry.status !== "implemented") return false;
	if (filters.authorableOnly && !AUTHORABLE_TECHNIQUE_IDS.has(entry.id)) {
		return false;
	}
	return true;
};

const summarizeMotionGrammarTechnique = (
	entry: MotionGrammarCatalogEntry,
): AgentMotionGrammarTechniqueSummary => {
	const implemented = entry.status === "implemented";
	const authorable = AUTHORABLE_TECHNIQUE_IDS.has(entry.id);
	return {
		id: entry.id,
		label: entry.label,
		family: entry.family,
		status: entry.status,
		implemented,
		authorable,
		minTargets: entry.minTargets,
		usesSeed: entry.usesSeed,
		params: motionGrammarParameterSpecsForNewBinding(entry.id),
		...(versionedMotionExpressionRoleMapContract(entry.id)
			? { roleMapContract: versionedMotionExpressionRoleMapContract(entry.id) }
			: {}),
		commands: {
			applyTechnique: authorable
				? {
						supported: true,
						tool: "apply_motion_grammar_commands",
						commandType: "motion-grammar/apply-technique",
					}
				: {
						supported: false,
						tool: "apply_motion_grammar_commands",
						commandType: "motion-grammar/apply-technique",
						reason:
							"Technique is implemented for the grammar catalog but is not promoted to the production authoring command surface.",
					},
			...(entry.id === "periodic-afterimage"
				? {
						applyAfterimageSelectedSources: {
							supported: authorable,
							tool: "apply_motion_grammar_commands" as const,
							commandType:
								"motion-grammar/apply-afterimage-selected-sources" as const,
							...(authorable
								? {}
								: {
										reason:
											"Afterimage is not promoted to the production authoring command surface.",
									}),
						},
					}
				: {}),
		},
	};
};

const motionGrammarBindingMatchesFilters = (
	binding: MotionGrammarBinding,
	filters: MotionGrammarFilters,
	nodeById: ReadonlyMap<string, VectorNode>,
): boolean => {
	if (filters.techniqueId && binding.techniqueId !== filters.techniqueId) {
		return false;
	}
	if (
		filters.nodeId &&
		!binding.targetIds.some((id) => id === filters.nodeId)
	) {
		return false;
	}
	if (!filters.includeIneligibleTargets) {
		return binding.targetIds.every((nodeId) => nodeById.has(nodeId));
	}
	return true;
};

const motionGrammarBindingParams = (
	binding: MotionGrammarBinding,
	descriptor: MotionGrammarAuthoringProfileDescriptor | undefined,
): readonly MotionGrammarParamSpec[] => {
	const specs = new Map<string, MotionGrammarParamSpec>();
	for (const spec of motionGrammarParameterSpecsForBinding(binding)) {
		specs.set(spec.key, spec);
	}
	for (const group of descriptor?.parameterGroups ?? []) {
		for (const spec of group.parameters) specs.set(spec.key, spec);
	}
	return motionGrammarAuthoringParameterKeys({ binding, descriptor }).flatMap(
		(key) => {
			const spec = specs.get(key);
			return spec ? [spec] : [];
		},
	);
};

const summarizeMotionGrammarBinding = (
	binding: MotionGrammarBinding,
	nodeById: ReadonlyMap<string, VectorNode>,
): AgentMotionGrammarBindingSummary => {
	const entry = findCatalogEntry(binding.techniqueId);
	const descriptor = describeMotionGrammarAuthoringProfile(binding);
	const supportsBake = descriptor?.timeline.bakePolicy === "explicit-command";
	const supportsRoleReplacement =
		descriptor?.instances.some((instance) => instance.replaceable) ?? false;
	return {
		id: binding.id,
		techniqueId: binding.techniqueId,
		techniqueLabel: entry?.label ?? binding.techniqueId,
		targetIds: binding.targetIds,
		targets: binding.targetIds.map((nodeId) => {
			const node = nodeById.get(nodeId);
			return node
				? {
						nodeId,
						exists: true,
						name: node.name,
						kind: node.geometry.kind,
						visible: node.visible,
						locked: node.locked,
					}
				: {
						nodeId,
						exists: false,
					};
		}),
		parameters: binding.parameters,
		...(binding.roleMap ? { roleMap: { ...binding.roleMap } } : {}),
		...(Number.isFinite(binding.parameters.expressionVersion)
			? { expressionVersion: binding.parameters.expressionVersion }
			: {}),
		...(binding.randomPulseProfile
			? { randomPulseProfile: binding.randomPulseProfile }
			: {}),
		...(binding.arrangementMapping
			? {
					arrangementMapping: structuredClone(binding.arrangementMapping),
				}
			: {}),
		params: motionGrammarBindingParams(binding, descriptor),
		...(descriptor
			? {
					authoringProfile: {
						kind: descriptor.kind,
						summary: descriptor.summary,
						timeline: {
							mode: descriptor.timeline.mode,
							bakePolicy: descriptor.timeline.bakePolicy,
						},
						expansion: {
							mode: descriptor.expansion.mode,
							label: descriptor.expansion.label,
							description: descriptor.expansion.description,
							outputSummary: descriptor.expansion.outputSummary,
						},
					},
				}
			: {}),
		...(descriptor?.seedControl === undefined
			? {}
			: { seedControl: descriptor.seedControl }),
		...(descriptor?.timingTemplates
			? { timingTemplates: descriptor.timingTemplates }
			: {}),
		...(binding.seed === undefined ? {} : { seed: binding.seed }),
		...(binding.effectBinding
			? {
					effectBindingKind: binding.effectBinding.kind,
					effectBinding: structuredClone(binding.effectBinding),
				}
			: {}),
		commands: {
			updateParameters: {
				supported: true,
				tool: "apply_motion_grammar_commands",
				commandType: "motion-grammar/update-parameters",
			},
			updateBinding: {
				supported: true,
				tool: "apply_motion_grammar_commands",
				commandType: "motion-grammar/update-binding",
			},
			reorderBinding: {
				supported: true,
				tool: "apply_motion_grammar_commands",
				commandType: "motion-grammar/reorder-binding",
			},
			bakeBinding: {
				supported: supportsBake,
				tool: "apply_document_commands",
				commandType: "document/bake-motion-grammar-binding",
				...(supportsBake
					? {}
					: {
							reason:
								descriptor?.expansion.outputSummary ??
								"This binding has no declared editable bake representation.",
						}),
			},
			expandBinding: {
				supported: supportsBake,
				tool: "apply_document_commands",
				commandType: "document/expand-motion-grammar-binding",
				...(supportsBake
					? {}
					: {
							reason:
								descriptor?.expansion.outputSummary ??
								"This binding has no declared editable expansion representation.",
						}),
			},
			replaceRole: {
				supported: supportsRoleReplacement,
				tool: "apply_document_commands",
				commandType: "document/replace-motion-grammar-role",
				...(supportsRoleReplacement
					? {}
					: {
							reason:
								"This binding owns target-specific Scene setup; remove and reapply it to change targets.",
						}),
			},
			removeBinding: {
				supported: true,
				tool: "apply_motion_grammar_commands",
				commandType: "motion-grammar/remove-binding",
			},
		},
	};
};

const finiteExpressionVersion = (value: unknown): number | undefined =>
	typeof value === "number" && Number.isFinite(value) ? value : undefined;

const summarizeUnsupportedMotionGrammarBinding = (
	binding: MotionGrammarStoreDocument["passthrough"][number],
	diagnostics: MotionGrammarStoreDocument["diagnostics"],
): AgentMotionGrammarUnsupportedBindingSummary => {
	const diagnostic = diagnostics?.find(
		(candidate) => candidate.bindingId === binding.id,
	);
	const version = finiteExpressionVersion(binding.parameters.expressionVersion);
	return {
		id: binding.id,
		techniqueId: binding.techniqueId,
		...(version === undefined ? {} : { expressionVersion: version }),
		reason:
			diagnostic?.message ??
			"Serialized motion binding is preserved but inert because its technique or contract is unsupported.",
		commands: {
			updateParameters: {
				supported: false,
				tool: "apply_motion_grammar_commands",
				commandType: "motion-grammar/update-parameters",
				reason:
					"Unsupported bindings are losslessly preserved and remove-only until a compatible Vecmo version is available.",
			},
			removeBinding: {
				supported: true,
				tool: "apply_motion_grammar_commands",
				commandType: "motion-grammar/remove-binding",
			},
		},
	};
};

const unsupportedMotionGrammarBindingMatchesFilters = (
	binding: MotionGrammarStoreDocument["passthrough"][number],
	filters: MotionGrammarFilters,
): boolean => {
	if (filters.techniqueId && binding.techniqueId !== filters.techniqueId) {
		return false;
	}
	if (filters.nodeId && !binding.targetIds.includes(filters.nodeId)) {
		return false;
	}
	return true;
};

/**
 * Lists the Motion Grammar catalog and current side-car bindings so agents can
 * choose stable technique ids, parameter keys, binding ids, and target nodes
 * before issuing typed `motion-grammar/*` commands.
 */
export function listAgentMotionGrammar(
	context: AgentDocumentContext,
	request: AgentListMotionGrammarRequest = {
		tool: "list_motion_grammar",
	},
): AgentToolResult<AgentMotionGrammarList> {
	const filters = defaultMotionGrammarFilters(request);
	const nodeById = new Map(
		allNodes(context.scene).map((node) => [node.id, node]),
	);
	const issues: AgentIssue[] = [];
	if (filters.nodeId && !nodeById.has(filters.nodeId)) {
		issues.push(
			createAgentIssue(
				"agent.motion-grammar-node-missing",
				"error",
				`Node "${filters.nodeId}" was not found.`,
				{ kind: "node", id: filters.nodeId },
			),
		);
	}

	const techniques = MOTION_GRAMMAR_CATALOG.filter((entry) =>
		motionGrammarTechniqueMatchesFilters(entry, filters),
	).map(summarizeMotionGrammarTechnique);
	const bindings = filters.includeBindings
		? context.grammar.bindings
				.filter((binding) =>
					motionGrammarBindingMatchesFilters(binding, filters, nodeById),
				)
				.map((binding) => summarizeMotionGrammarBinding(binding, nodeById))
		: [];
	const unsupportedBindings = filters.includeBindings
		? context.grammar.passthrough
				.filter((binding) =>
					unsupportedMotionGrammarBindingMatchesFilters(binding, filters),
				)
				.map((binding) =>
					summarizeUnsupportedMotionGrammarBinding(
						binding,
						context.grammar.diagnostics,
					),
				)
		: [];

	return createAgentToolResult(
		"list_motion_grammar",
		{
			filters,
			techniqueCount: techniques.length,
			bindingCount: bindings.length,
			passthroughBindingCount: context.grammar.passthrough.length,
			techniques,
			bindings,
			unsupportedBindings,
		},
		issues,
	);
}

type ResolvedLookTarget = {
	readonly owner: LookGraphOwnerRef;
	readonly graph: LookGraph | null;
	readonly derivedFrom: AgentLookGraphView["derivedFrom"];
	readonly scopedOverlay?: AgentLookGraphView["scopedOverlay"];
};

/** Best-effort report of which precedence tier produced the resolved graph. */
const lookGraphOrigin = (
	slots:
		| {
				readonly lookGraph?: unknown;
				readonly effectLayerStack?: unknown;
				readonly visualRecipe?: unknown;
		  }
		| null
		| undefined,
): AgentLookGraphView["derivedFrom"] => {
	if (!slots) return null;
	if (slots.lookGraph) return "explicit-graph";
	if (slots.effectLayerStack) return "effect-layer-stack";
	if (slots.visualRecipe) return "visual-recipe";
	return null;
};

/**
 * Resolves a bindable effect target to its graph-first Look with the SAME
 * artboard-over-scene precedence the canvas and export read: an artboard inherits a
 * scene-level Look unless it overrides it. Reading only the target slot would
 * report `present:false` for an artboard that inherits a scene Look. Returns `null`
 * only when an explicit artboard id does not resolve.
 */
const resolveLookTarget = (
	scene: SceneDocument,
	target: AgentLookGraphTarget,
): ResolvedLookTarget | null => {
	if (target.scope === "scoped-overlay") {
		const artboard = findArtboardById(scene, target.artboardId);
		const overlay = artboard
			? scopedLookGraphOverlays(artboard).find(
					(look) => look.id === target.scopedLookId,
				)
			: undefined;
		if (!overlay) return null;
		return {
			owner: {
				scope: "scoped-overlay",
				artboardId: target.artboardId,
				scopedLookId: target.scopedLookId,
			},
			graph: overlay.lookGraph,
			derivedFrom: "explicit-graph",
			scopedOverlay: {
				source: overlay.source,
				targetNodeIds: overlay.targetNodeIds,
			},
		};
	}
	if (target.scope === "scene") {
		const owner: LookGraphOwnerRef = { scope: "scene" };
		return {
			owner,
			graph: lookGraphFromIntent(scene.effectIntent, owner) ?? null,
			derivedFrom: lookGraphOrigin(scene.effectIntent),
		};
	}
	const artboardId =
		target.scope === "current-artboard"
			? selectCurrentArtboard(scene).id
			: target.scope === "default-artboard"
				? selectDefaultArtboard(scene).id
				: target.artboardId;
	if (!findArtboardById(scene, artboardId)) return null;
	const resolved = resolveFrameEffectIntent(scene, artboardId);
	return {
		owner: { scope: "artboard", artboardId: resolved.artboardId },
		graph: resolveFrameLookGraph(scene, artboardId),
		derivedFrom: lookGraphOrigin(resolved),
	};
};

/**
 * Reads the graph-first Look resolved for a scene/artboard target (default:
 * current artboard) as the export-shaped manifest plus topology-health issues, so
 * an agent can inspect node ids/ports/fidelity before authoring graph operations.
 */
export function listAgentLookGraph(
	context: AgentDocumentContext,
	request: AgentListLookGraphRequest = { tool: "list_look_graph" },
): AgentToolResult<AgentLookGraphView> {
	const target = request.target ?? { scope: "current-artboard" };
	const resolution = resolveLookTarget(context.scene, target);
	if (!resolution) {
		return createAgentToolResult(
			"list_look_graph",
			{ target, present: false, derivedFrom: null, issues: [] },
			[
				createAgentIssue(
					"agent.look-graph-target-missing",
					"error",
					"The requested look-graph artboard was not found.",
				),
			],
		);
	}
	if (!resolution.graph) {
		return createAgentToolResult("list_look_graph", {
			target,
			present: false,
			derivedFrom: null,
			issues: [],
		});
	}
	const plan = compileLookGraph(resolution.graph, { owner: resolution.owner });
	return createAgentToolResult("list_look_graph", {
		target,
		present: true,
		derivedFrom: resolution.derivedFrom,
		...(resolution.scopedOverlay
			? { scopedOverlay: resolution.scopedOverlay }
			: {}),
		graph: lookGraphExportManifest(resolution.graph, plan),
		issues: validateLookGraph(resolution.graph),
	});
}

/**
 * Lists the graph-first Look node kinds an agent can author, each with its typed
 * input/output ports. Combined with the deterministic `portIdScheme`, this lets a
 * code-native client construct `add-node`/`connect` operations from discovery
 * alone. `params` exposes cataloged payload keys/ranges for graph payload
 * patches, plus explicit numeric keyframe eligibility, without importing editor
 * UI code.
 */
export function listAgentLookNodeCapabilities(): AgentToolResult<AgentLookNodeCapabilityList> {
	const paramsForKind = (
		kind: LookGraphNodeKind,
	): readonly AgentLookNodeParamCapability[] =>
		(LOOK_GRAPH_NODE_PARAM_CATALOG[kind] ?? []).map((param) => ({
			...param,
			keyframable: param.valueType === "number",
		}));
	const nodeKinds = (
		Object.keys(LOOK_GRAPH_NODE_PORT_CATALOG) as readonly LookGraphNodeKind[]
	).map((kind) => ({
		kind,
		label: lookGraphNodeLabel(kind),
		inputs: LOOK_GRAPH_NODE_PORT_CATALOG[kind].inputs,
		outputs: LOOK_GRAPH_NODE_PORT_CATALOG[kind].outputs,
		params: paramsForKind(kind),
	}));
	return createAgentToolResult("list_look_node_capabilities", {
		portIdScheme:
			"input ports are `<nodeId>:in:<portName>`, output ports are `<nodeId>:out:<portName>`",
		nodeKinds,
	});
}

const validateDuplicateIds = (
	kind:
		| "artboard"
		| "layer"
		| "node"
		| "motion-track"
		| "motion-grammar-binding",
	ids: readonly string[],
): readonly AgentIssue[] =>
	duplicateIds(ids).map((id) =>
		createAgentIssue(
			`agent.duplicate-${kind}-id`,
			"error",
			`Duplicate ${kind} id "${id}" found.`,
			{ kind, id },
		),
	);

const summarizeValidation = (
	issues: readonly AgentIssue[],
): AgentValidationSummary => ({
	ok: !issues.some((issue) => issue.severity === "error"),
	issueCount: issues.length,
	errorCount: issues.filter((issue) => issue.severity === "error").length,
	warningCount: issues.filter((issue) => issue.severity === "warning").length,
	infoCount: issues.filter((issue) => issue.severity === "info").length,
});

/**
 * Per-artboard ids with at least one spatial-motion source: a transform-channel
 * keyframe track, a position path, or a motion-grammar binding, each targeting a
 * node that {@link selectNodeArtboardMapping} resolves to that artboard. Grammar
 * bindings count uniformly regardless of technique — the plan does not qualify
 * them by output channel, so a non-transform technique (e.g. `noise-wipe`, a
 * texture reveal) can still mark its artboard as having spatial motion. That is a
 * known, harmless over-trigger: this only feeds a warning, never an error, and the
 * escape hatch is declaring `Artboard.cameraSpacePolicy`.
 */
const artboardIdsWithSpatialMotion = (
	context: AgentDocumentContext,
	nodeArtboardMapping: NodeArtboardMapping,
): ReadonlySet<string> => {
	const artboardIds = new Set<string>();
	for (const track of context.motion.tracks) {
		if (!CAMERA_STANDARD_SPATIAL_PROPERTIES.has(track.target.property)) {
			continue;
		}
		const artboardId = nodeArtboardMapping.byNodeId[track.target.nodeId];
		if (artboardId) artboardIds.add(artboardId);
	}
	for (const path of context.motion.positionPaths ?? []) {
		const artboardId = nodeArtboardMapping.byNodeId[path.nodeId];
		if (artboardId) artboardIds.add(artboardId);
	}
	for (const binding of context.grammar.bindings) {
		for (const targetId of binding.targetIds) {
			const artboardId = nodeArtboardMapping.byNodeId[targetId];
			if (artboardId) artboardIds.add(artboardId);
		}
	}
	return artboardIds;
};

/**
 * Per-artboard camera-first standard issues (plan §3.2):
 * `agent.motion-without-scene-camera` (warning) nudges an artboard with spatial
 * motion and no active camera or `screen_2d` declaration toward authoring
 * through a scene camera; `agent.scene-camera-unused` (info) flags an active
 * camera that is still the untouched identity rig — geometrically a no-op —
 * while the artboard has spatial motion or depth planes that could ride it.
 */
const cameraStandardIssuesForArtboards = (
	context: AgentDocumentContext,
	artboards: readonly Artboard[],
): readonly AgentIssue[] => {
	const nodeArtboardMapping = selectNodeArtboardMapping(context.scene);
	const spatialMotionArtboardIds = artboardIdsWithSpatialMotion(
		context,
		nodeArtboardMapping,
	);
	const issues: AgentIssue[] = [];
	for (const artboard of artboards) {
		const hasSpatialMotion = spatialMotionArtboardIds.has(artboard.id);
		if (
			hasSpatialMotion &&
			!artboard.activeSceneCameraId &&
			artboard.cameraSpacePolicy !== "screen_2d"
		) {
			issues.push(
				createAgentIssue(
					"agent.motion-without-scene-camera",
					"warning",
					`Artboard "${artboard.id}" has spatial motion but no active scene camera. Add a scene camera (scene/add-scene-camera + scene/set-active-scene-camera) or declare Artboard.cameraSpacePolicy: "screen_2d" if flat motion is deliberate.`,
					{ kind: "artboard", id: artboard.id },
				),
			);
		}

		const activeRig = findActiveSceneCameraRig(context.scene, artboard.id);
		if (
			!activeRig ||
			!isIdentitySceneCameraRigForArtboard(activeRig, artboard)
		) {
			continue;
		}
		const hasCameraTrackKeyframes = (context.motion.cameraTracks ?? []).some(
			(track) =>
				track.target.cameraRigId === activeRig.id && track.keyframes.length > 0,
		);
		const hasCameraCuts = (context.motion.cameraCuts ?? []).some(
			(segment) => segment.artboardId === artboard.id,
		);
		const hasDepthPlaneNode = (
			nodeArtboardMapping.byArtboardId[artboard.id] ?? []
		).some((node) => node.depthPlane !== undefined);
		if (
			!hasCameraTrackKeyframes &&
			!hasCameraCuts &&
			(hasSpatialMotion || hasDepthPlaneNode)
		) {
			issues.push(
				createAgentIssue(
					"agent.scene-camera-unused",
					"info",
					`Artboard "${artboard.id}" has a scene camera present but unused (identity projection, no camera tracks, no camera cuts). Consider camera-driven movement (push-in, parallax) or perspective + depth planes.`,
					{ kind: "artboard", id: artboard.id },
				),
			);
		}
	}
	return issues;
};

/** Checks document-level invariants that an MCP agent needs before export/edit. */
export function validateAgentDocument(
	context: AgentDocumentContext,
): AgentToolResult<AgentValidationReport> {
	const artboards = selectAllArtboards(context.scene);
	const nodes = allNodes(context.scene);
	const nodeIds = uniqueIds(nodes.map((node) => node.id));
	const layoutHealth = summarizeLayoutMaterializationHealth(nodes);
	const issues: AgentIssue[] = [
		...validateDuplicateIds(
			"artboard",
			artboards.map((artboard) => artboard.id),
		),
		...validateDuplicateIds(
			"layer",
			context.scene.layers.map((layer) => layer.id),
		),
		...validateDuplicateIds(
			"node",
			nodes.map((node) => node.id),
		),
		...validateDuplicateIds("motion-track", [
			...context.motion.tracks.map((track) => track.id),
			...(context.motion.positionPaths ?? []).map((path) => path.id),
		]),
		...validateDuplicateIds(
			"motion-grammar-binding",
			context.grammar.bindings.map((binding) => binding.id),
		),
	];

	if (artboards.length === 0) {
		issues.push(
			createAgentIssue(
				"agent.no-artboards",
				"error",
				"Scene has no readable artboards.",
				{ kind: "document", id: context.scene.id },
			),
		);
	}

	if (
		context.scene.currentArtboardId &&
		!artboards.some(
			(artboard) => artboard.id === context.scene.currentArtboardId,
		)
	) {
		issues.push(
			createAgentIssue(
				"agent.stale-current-artboard",
				"warning",
				"currentArtboardId does not match a readable artboard; selectors will fall back.",
				{ kind: "artboard", id: context.scene.currentArtboardId },
			),
		);
	}

	for (const track of context.motion.tracks) {
		if (!nodeIds.has(track.target.nodeId)) {
			issues.push(
				createAgentIssue(
					"agent.motion-target-missing",
					"error",
					`Motion track "${track.id}" targets missing node "${track.target.nodeId}".`,
					{ kind: "motion-track", id: track.id },
				),
			);
		}
	}
	for (const path of context.motion.positionPaths ?? []) {
		if (!nodeIds.has(path.nodeId)) {
			issues.push(
				createAgentIssue(
					"agent.motion-target-missing",
					"error",
					`Spatial motion path "${path.id}" targets missing node "${path.nodeId}".`,
					{ kind: "motion-track", id: path.id },
				),
			);
		}
	}

	for (const binding of context.grammar.bindings) {
		for (const nodeId of binding.targetIds) {
			if (!nodeIds.has(nodeId)) {
				issues.push(
					createAgentIssue(
						"agent.motion-grammar-target-missing",
						"error",
						`Motion grammar binding "${binding.id}" targets missing node "${nodeId}".`,
						{ kind: "motion-grammar-binding", id: binding.id },
					),
				);
			}
		}
	}

	const currentArtboard = selectCurrentArtboard(context.scene);
	if (context.motion.fps !== currentArtboard.fps) {
		issues.push(
			createAgentIssue(
				"agent.motion-fps-mismatch",
				"warning",
				"Motion fps differs from the current artboard fps.",
				{ kind: "document", id: context.scene.id },
			),
		);
	}

	for (const frame of layoutHealth.driftedFrames) {
		issues.push(
			createAgentIssue(
				"agent.layout-materialization-drift",
				"warning",
				`Layout frame "${frame.frameName}" has ${frame.driftedChildCount} child placement(s) whose stored geometry differs from resolved layout intent (max drift ${frame.maxDrift}); run scene/reapply-layout-frame before geometry-based edits if stored bounds are the source of truth.`,
				{ kind: "node", id: frame.frameNodeId },
			),
		);
	}

	issues.push(...cameraStandardIssuesForArtboards(context, artboards));

	return createAgentToolResult(
		"run_validation",
		{
			summary: summarizeValidation(issues),
			issues,
		},
		issues,
	);
}
