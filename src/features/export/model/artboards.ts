import {
	artboardBounds,
	type NormalizedArtboard,
	selectAllArtboards,
	selectCurrentArtboard,
	selectDefaultArtboard,
	selectNodeArtboardMapping,
} from "@/entities/scene/model/selectors";
import type {
	Artboard,
	SceneDocument,
	SceneLayer,
	VectorNode,
} from "@/entities/scene/model/types";
import type { ExportIssue, ExportIssueSummary } from "./issues";
import { summarizeExportIssues } from "./issues";
import { fileStemForScene } from "./json";

export type ExportArtboardScopeMode = "current" | "all" | "selected";

export type ExportArtboardScopeInput =
	| ExportArtboardScopeMode
	| {
			readonly mode: ExportArtboardScopeMode;
			readonly artboardIds?: readonly string[];
	  };

export type ExportArtboardIssueCode =
	| "artboard-selection-empty"
	| "artboard-selection-missing";

export type ExportArtboardIssue = ExportIssue & {
	readonly code: ExportArtboardIssueCode;
	readonly artboardId?: string;
	readonly requestedArtboardId?: string;
};

export type ExportArtboardBoundsMetadata = {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
};

export type ExportArtboardAssetMetadata = {
	readonly id: string;
	readonly name: string;
	readonly index: number;
	readonly position: {
		readonly x: number;
		readonly y: number;
	};
	readonly bounds: ExportArtboardBoundsMetadata;
	readonly width: number;
	readonly height: number;
	readonly background: string;
	readonly fps: number;
	readonly durationFrames: number;
	readonly nodeCount: number;
	readonly visibleNodeCount: number;
};

export type ResolvedExportArtboard = {
	readonly metadata: ExportArtboardAssetMetadata;
	readonly scene: SceneDocument;
	readonly fileStem: string;
};

export type ResolvedExportArtboardScope = {
	readonly scope: ExportArtboardScopeMode;
	readonly requestedArtboardIds: readonly string[];
	readonly defaultArtboardId: string;
	readonly currentArtboardId: string;
	readonly available: readonly ExportArtboardAssetMetadata[];
	readonly targets: readonly ResolvedExportArtboard[];
	readonly issues: readonly ExportArtboardIssue[];
	readonly issueCodes: readonly ExportArtboardIssueCode[];
	readonly issueSummary: ExportIssueSummary;
};

type NormalizedScopeInput = {
	readonly mode: ExportArtboardScopeMode;
	readonly artboardIds: readonly string[];
};

const slugify = (value: string): string =>
	value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

const uniqueStrings = (values: readonly string[]): readonly string[] => [
	...new Set(values),
];

const issueCodes = (
	issues: readonly ExportArtboardIssue[],
): readonly ExportArtboardIssueCode[] =>
	[...new Set(issues.map((issue) => issue.code))].sort((left, right) =>
		left.localeCompare(right),
	) as readonly ExportArtboardIssueCode[];

const normalizeScopeInput = (
	input: ExportArtboardScopeInput | undefined,
): NormalizedScopeInput => {
	if (!input) return { mode: "current", artboardIds: [] };
	if (typeof input === "string") return { mode: input, artboardIds: [] };
	return {
		mode: input.mode,
		artboardIds: uniqueStrings(input.artboardIds ?? []),
	};
};

const metadataForArtboard = ({
	artboard,
	index,
	scene,
}: {
	readonly artboard: NormalizedArtboard;
	readonly index: number;
	readonly scene: SceneDocument;
}): ExportArtboardAssetMetadata => {
	const mapping = selectNodeArtboardMapping(scene);
	let nodeCount = 0;
	let visibleNodeCount = 0;
	const visit = (
		nodes: readonly VectorNode[],
		visibleByParent: boolean,
	): void => {
		for (const node of nodes) {
			const belongsToArtboard = mapping.byNodeId[node.id] === artboard.id;
			const visible = visibleByParent && node.visible;
			if (belongsToArtboard) {
				nodeCount += 1;
				if (visible) visibleNodeCount += 1;
			}
			if (node.children) visit(node.children, visible);
		}
	};
	for (const layer of scene.layers) visit(layer.nodes, layer.visible);
	const bounds = artboardBounds(artboard);
	return {
		id: artboard.id,
		name: artboard.name,
		index,
		position: artboard.position,
		bounds: {
			x: bounds.x,
			y: bounds.y,
			width: bounds.width,
			height: bounds.height,
		},
		width: artboard.width,
		height: artboard.height,
		background: artboard.background,
		fps: artboard.fps,
		durationFrames: artboard.durationFrames,
		nodeCount,
		visibleNodeCount,
	};
};

const scopedArtboard = (artboard: NormalizedArtboard): Artboard => ({
	id: artboard.id,
	name: artboard.name,
	...(artboard.role ? { role: artboard.role } : {}),
	position: artboard.position,
	width: artboard.width,
	height: artboard.height,
	background: artboard.background,
	...(artboard.fills ? { fills: artboard.fills } : {}),
	fps: artboard.fps,
	durationFrames: artboard.durationFrames,
	...(artboard.activeSceneCameraId
		? { activeSceneCameraId: artboard.activeSceneCameraId }
		: {}),
	...(artboard.cameraSpacePolicy !== undefined
		? { cameraSpacePolicy: artboard.cameraSpacePolicy }
		: {}),
	...(artboard.effectIntent ? { effectIntent: artboard.effectIntent } : {}),
	...(artboard.sourceOpticsRigs
		? { sourceOpticsRigs: artboard.sourceOpticsRigs }
		: {}),
});

const filterNodesForArtboard = (
	nodes: readonly VectorNode[],
	artboardId: string,
	byNodeId: Readonly<Record<string, string>>,
): readonly VectorNode[] =>
	nodes.flatMap((node) => {
		if (byNodeId[node.id] !== artboardId) return [];
		if (!node.children) return [node];

		const children = filterNodesForArtboard(
			node.children,
			artboardId,
			byNodeId,
		);
		return [
			children.length > 0
				? {
						...node,
						children,
					}
				: {
						...node,
						children: undefined,
					},
		];
	});

const scopedLayersForArtboard = (
	scene: SceneDocument,
	artboardId: string,
): readonly SceneLayer[] => {
	const mapping = selectNodeArtboardMapping(scene);
	return scene.layers.map((layer) => ({
		...layer,
		nodes: filterNodesForArtboard(layer.nodes, artboardId, mapping.byNodeId),
	}));
};

/**
 * Narrows a multi-artboard document to one renderer-facing artboard without
 * mutating the source. Sequence runtimes call this only after motion/camera
 * presentation has sampled against the full document and explicit artboard id.
 */
export function scopeSceneToArtboard(
	scene: SceneDocument,
	artboardId: string,
): SceneDocument | null {
	const artboard = selectAllArtboards(scene).find(
		(candidate) => candidate.id === artboardId,
	);
	if (!artboard) return null;
	const scoped = scopedArtboard(artboard);
	return {
		...scene,
		artboard: scoped,
		artboards: [scoped],
		currentArtboardId: artboard.id,
		layers: scopedLayersForArtboard(scene, artboard.id),
	};
}

const fileStemForArtboard = ({
	scene,
	artboard,
	needsArtboardSuffix,
}: {
	readonly scene: SceneDocument;
	readonly artboard: NormalizedArtboard;
	readonly needsArtboardSuffix: boolean;
}): string => {
	const sceneStem = fileStemForScene(scene);
	if (!needsArtboardSuffix) return sceneStem;
	const artboardStem =
		slugify(artboard.name) || slugify(artboard.id) || "artboard";
	return `${sceneStem}.${artboardStem}`;
};

const missingSelectionIssue = (artboardId: string): ExportArtboardIssue => ({
	severity: "warning",
	category: "invalid",
	code: "artboard-selection-missing",
	message: `Selected artboard "${artboardId}" does not exist and was skipped.`,
	fallback: "normalized-value",
	requestedArtboardId: artboardId,
});

const emptySelectionIssue = (
	currentArtboardId: string,
): ExportArtboardIssue => ({
	severity: "warning",
	category: "fallback",
	code: "artboard-selection-empty",
	message:
		"Selected artboard export did not resolve any artboards and fell back to the current artboard.",
	fallback: "normalized-value",
	artboardId: currentArtboardId,
});

/**
 * Resolves current/all/selected artboard export intent into deterministic
 * scoped scene snapshots. The returned scenes preserve the full SceneDocument
 * contract while narrowing `artboard`, `artboards`, `currentArtboardId`, and
 * layer nodes to one export target so existing SVG/PDF renderers remain
 * single-artboard adapters.
 */
export function resolveExportArtboardScope(
	scene: SceneDocument,
	input?: ExportArtboardScopeInput,
): ResolvedExportArtboardScope {
	const { mode, artboardIds } = normalizeScopeInput(input);
	const artboards = selectAllArtboards(scene);
	const defaultArtboard = selectDefaultArtboard(scene);
	const currentArtboard = selectCurrentArtboard(scene);
	const artboardById = new Map(
		artboards.map((artboard) => [artboard.id, artboard] as const),
	);
	const issues: ExportArtboardIssue[] = [];
	const available = artboards.map((artboard, index) =>
		metadataForArtboard({ artboard, index, scene }),
	);

	const targetIds =
		mode === "all"
			? artboards.map((artboard) => artboard.id)
			: mode === "current"
				? [currentArtboard.id]
				: artboards
						.filter((artboard) => artboardIds.includes(artboard.id))
						.map((artboard) => artboard.id);

	if (mode === "selected") {
		for (const artboardId of artboardIds) {
			if (!artboardById.has(artboardId)) {
				issues.push(missingSelectionIssue(artboardId));
			}
		}
		if (targetIds.length === 0) {
			issues.push(emptySelectionIssue(currentArtboard.id));
		}
	}

	const resolvedTargetIds =
		targetIds.length > 0 ? targetIds : [currentArtboard.id];
	const needsArtboardSuffix = artboards.length > 1 || mode !== "current";
	const targets = resolvedTargetIds.map((artboardId) => {
		const artboard = artboardById.get(artboardId) ?? currentArtboard;
		const scopedScene = scopeSceneToArtboard(scene, artboard.id) ?? scene;
		return {
			metadata: metadataForArtboard({
				artboard,
				index: artboards.findIndex((candidate) => candidate.id === artboard.id),
				scene,
			}),
			scene: scopedScene,
			fileStem: fileStemForArtboard({
				scene,
				artboard,
				needsArtboardSuffix,
			}),
		};
	});

	return {
		scope: mode,
		requestedArtboardIds: artboardIds,
		defaultArtboardId: defaultArtboard.id,
		currentArtboardId: currentArtboard.id,
		available,
		targets,
		issues,
		issueCodes: issueCodes(issues),
		issueSummary: summarizeExportIssues(issues),
	};
}
