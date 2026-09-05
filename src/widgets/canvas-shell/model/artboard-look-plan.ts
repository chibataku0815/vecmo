import type { EffectFilterSpec } from "@/entities/scene/model/effect-filter";
import {
	frameChromaticAberrationParams,
	frameFilmGrainParams,
} from "@/entities/scene/model/frame-look-visibility";
import type {
	ResolvedMaskDef,
	SceneMaskPlan,
} from "@/entities/scene/model/mask-render";
import { resolveFrameEffectIntent } from "@/entities/scene/model/recipe-resolve";
import {
	flattenRenderableNodes,
	type NormalizedArtboard,
} from "@/entities/scene/model/selectors";
import { sceneNodeVisualAabb } from "@/entities/scene/model/spatial";
import type {
	Bounds,
	SceneDocument,
	VectorNode,
	VisualRecipeScopedEffectLook,
} from "@/entities/scene/model/types";
import type {
	ChromaticAberrationParams,
	EffectInfluenceRecipe,
	EffectMaskSource,
	FilmGrainParams,
} from "@/shared/vec-core";
import {
	type FrameLookInfluenceMaskPlan,
	resolveFrameLookInfluenceMaskPlan,
} from "./frame-look-influence";

const ANALOG_FILM_SELECTION_SCOPED_LOOK_ID = "inspector-analog-film-selection";

/**
 * Sanitizes IDs exactly as the live canvas' artboard-scoped filter and mask ids
 * did before extraction. Do not replace with the export sanitizer: casing and
 * fallback text are part of existing DOM id stability.
 */
export const artboardLookSvgIdSegment = (value: string): string =>
	value.replace(/[^A-Za-z0-9_-]/g, "_") || "artboard";

export type ArtboardLookMattePlan = {
	readonly nodesByRefId: ReadonlyMap<string, VectorNode>;
	readonly boundsByRefId: ReadonlyMap<string, Bounds>;
};

export type ArtboardLookPlan = {
	readonly artboardGridClipId: string;
	readonly frameLookGraphFilterSpec: EffectFilterSpec | null;
	readonly frameLookMatte: ArtboardLookMattePlan;
	readonly frameInfluenceMaskPlan: FrameLookInfluenceMaskPlan;
	readonly effectInfluenceRecipe: EffectInfluenceRecipe | null;
	readonly frameLookPixelPassSupported: boolean;
	readonly frameGrainParams: FilmGrainParams | null;
	readonly frameGrainFilterId: string | undefined;
	readonly frameCaParams: ChromaticAberrationParams | null;
	readonly frameCaFilterId: string | undefined;
	readonly frameCaPadding: number;
	readonly contentFilterIds: readonly string[];
	readonly scopedLook: VisualRecipeScopedEffectLook | null;
	readonly scopedInfluenceMaskPlan: FrameLookInfluenceMaskPlan;
	readonly scopedLookPixelPassSupported: boolean;
	readonly scopedGrainParams: FilmGrainParams | null;
	readonly scopedGrainFilterId: string | undefined;
	readonly scopedCaParams: ChromaticAberrationParams | null;
	readonly scopedCaFilterId: string | undefined;
	readonly scopedCaPadding: number;
	readonly scopedFilterIds: readonly string[];
	readonly scopedLookMaskId: string | undefined;
	readonly scopedLookRegion: Bounds;
	readonly frameLookSelectionNodeIds: ReadonlySet<string>;
	readonly frameLookUsesSelectionNodes: boolean;
	readonly artboardContentFilterIds: readonly string[];
	readonly filmActive: boolean;
	readonly frameLookMaskId: string | undefined;
	readonly frameLookRegion: Bounds;
	readonly frameLookBaseExcludedNodeIds: ReadonlySet<string>;
	readonly maskDefs: readonly ResolvedMaskDef[];
};

export type BuildArtboardLookPlanInput = {
	readonly artboard: NormalizedArtboard;
	readonly artboardIndex: number;
	readonly document: SceneDocument;
	readonly nodeArtboardIds: Readonly<Record<string, string>>;
	readonly maskPlan: SceneMaskPlan;
	readonly frameLookGraphFilterSpec: EffectFilterSpec | null;
};

const fullFrameLookRegion = (
	artboard: NormalizedArtboard,
	padding: number,
): Bounds => ({
	x: -padding,
	y: -padding,
	width: artboard.width + padding * 2,
	height: artboard.height + padding * 2,
});

const frameLookContentRegion = (
	artboard: NormalizedArtboard,
	maskPlan: FrameLookInfluenceMaskPlan,
	padding: number,
): Bounds => {
	if (maskPlan.kind !== "masked") return fullFrameLookRegion(artboard, padding);
	const minX = Math.max(-padding, maskPlan.bounds.x - padding);
	const minY = Math.max(-padding, maskPlan.bounds.y - padding);
	const maxX = Math.min(
		artboard.width + padding,
		maskPlan.bounds.x + maskPlan.bounds.width + padding,
	);
	const maxY = Math.min(
		artboard.height + padding,
		maskPlan.bounds.y + maskPlan.bounds.height + padding,
	);
	return {
		x: minX,
		y: minY,
		width: Math.max(1, maxX - minX),
		height: Math.max(1, maxY - minY),
	};
};

const frameChromaticAberrationPadding = (
	params: ChromaticAberrationParams,
): number => Math.ceil(params.fringing * params.maxShiftPx) + 4;

const frameLookMatteBounds = (node: VectorNode): Bounds => {
	const bounds = sceneNodeVisualAabb(node);
	return {
		x: bounds.minX,
		y: bounds.minY,
		width: Math.max(0, bounds.maxX - bounds.minX),
		height: Math.max(0, bounds.maxY - bounds.minY),
	};
};

const frameLookMatteMaps = (
	document: SceneDocument,
	artboardId: string,
	nodeArtboardIds: Readonly<Record<string, string>>,
): ArtboardLookMattePlan => {
	const nodesByRefId = new Map<string, VectorNode>();
	const boundsByRefId = new Map<string, Bounds>();
	for (const { node } of flattenRenderableNodes(document)) {
		if (nodeArtboardIds[node.id] !== artboardId) continue;
		nodesByRefId.set(node.id, node);
		boundsByRefId.set(node.id, frameLookMatteBounds(node));
	}
	return { nodesByRefId, boundsByRefId };
};

const frameLookSvgMatteRefIds = (
	source: EffectMaskSource,
): ReadonlySet<string> => {
	const ids = new Set<string>();
	const collect = (candidate: EffectMaskSource) => {
		if (candidate.kind === "svgMatte") {
			ids.add(candidate.refId);
			return;
		}
		if (candidate.kind !== "stack") return;
		for (const item of candidate.items) {
			if (
				!item.enabled ||
				item.strength <= 0 ||
				(item.combineMode !== "replace" && item.combineMode !== "add") ||
				item.source.kind !== "svgMatte"
			) {
				continue;
			}
			collect(item.source);
		}
	};
	collect(source);
	return ids;
};

const selectionScopedLook = (
	artboard: NormalizedArtboard,
): VisualRecipeScopedEffectLook | null =>
	artboard.effectIntent?.scopedLooks?.find(
		(look): look is VisualRecipeScopedEffectLook =>
			look.kind === "visual-recipe-overlay" &&
			look.id === ANALOG_FILM_SELECTION_SCOPED_LOOK_ID &&
			look.source === "analog-film-selection",
	) ?? null;

/**
 * Builds the deterministic, non-JSX data CanvasShell needs to render an
 * artboard's frame look, scoped look overlay, matte masks, and native mask defs.
 */
export function buildArtboardLookPlan({
	artboard,
	artboardIndex,
	document,
	nodeArtboardIds,
	maskPlan,
	frameLookGraphFilterSpec,
}: BuildArtboardLookPlanInput): ArtboardLookPlan {
	const artboardIdSegment = artboardLookSvgIdSegment(artboard.id);
	const artboardGridClipId = `vecmo-artboard-grid-${artboardIdSegment}-${artboardIndex}`;
	const frameIntent = resolveFrameEffectIntent(document, artboard.id);
	const frameLookGraph = frameIntent.lookGraph;
	const frameLookMatte = frameLookMatteMaps(
		document,
		artboard.id,
		nodeArtboardIds,
	);
	const frameVisualRecipe = frameLookGraph ? null : frameIntent.visualRecipe;
	const frameInfluenceMaskPlan = resolveFrameLookInfluenceMaskPlan(
		frameLookGraph ? null : frameIntent.influenceRecipe,
		artboard,
		frameLookMatte.boundsByRefId,
	);
	const frameLookPixelPassSupported =
		frameInfluenceMaskPlan.kind !== "unsupported";
	const frameGrainParams = frameFilmGrainParams(frameVisualRecipe);
	const frameGrainFilterId =
		frameLookPixelPassSupported && frameGrainParams
			? `vecmo-frame-grain-${artboardIdSegment}-${artboardIndex}`
			: undefined;
	const frameCaParams = frameChromaticAberrationParams(frameVisualRecipe);
	const frameCaFilterId =
		frameLookPixelPassSupported && frameCaParams
			? `vecmo-frame-ca-${artboardIdSegment}-${artboardIndex}`
			: undefined;
	const frameCaPadding = frameCaParams
		? frameChromaticAberrationPadding(frameCaParams)
		: 0;
	const contentFilterIds = [
		...(frameLookGraphFilterSpec ? [frameLookGraphFilterSpec.id] : []),
		...(!frameLookGraphFilterSpec && frameCaFilterId ? [frameCaFilterId] : []),
		...(!frameLookGraphFilterSpec && frameGrainFilterId
			? [frameGrainFilterId]
			: []),
	];
	const scopedLook = selectionScopedLook(artboard);
	const scopedLookRecipe = scopedLook?.visualRecipe ?? null;
	const scopedInfluenceMaskPlan = resolveFrameLookInfluenceMaskPlan(
		scopedLook?.influenceRecipe,
		artboard,
		frameLookMatte.boundsByRefId,
	);
	const scopedLookPixelPassSupported =
		Boolean(scopedLook) && scopedInfluenceMaskPlan.kind !== "unsupported";
	const scopedGrainParams = frameFilmGrainParams(scopedLookRecipe);
	const scopedCaParams = frameChromaticAberrationParams(scopedLookRecipe);
	const scopedCaPadding = scopedCaParams
		? frameChromaticAberrationPadding(scopedCaParams)
		: 0;
	const scopedLookRegion = scopedCaParams
		? fullFrameLookRegion(artboard, scopedCaPadding)
		: frameLookContentRegion(
				artboard,
				scopedInfluenceMaskPlan,
				scopedCaPadding,
			);
	const scopedLookIdSegment = scopedLook
		? artboardLookSvgIdSegment(scopedLook.id)
		: "none";
	const scopedGrainFilterId =
		scopedLookPixelPassSupported && scopedGrainParams
			? `vecmo-scoped-grain-${artboardIdSegment}-${scopedLookIdSegment}-${artboardIndex}`
			: undefined;
	const scopedCaFilterId =
		scopedLookPixelPassSupported && scopedCaParams
			? `vecmo-scoped-ca-${artboardIdSegment}-${scopedLookIdSegment}-${artboardIndex}`
			: undefined;
	const scopedFilterIds = [
		...(scopedCaFilterId ? [scopedCaFilterId] : []),
		...(scopedGrainFilterId ? [scopedGrainFilterId] : []),
	];
	const scopedLookMaskId =
		scopedFilterIds.length > 0 && scopedInfluenceMaskPlan.kind === "masked"
			? `vecmo-scoped-look-mask-${artboardIdSegment}-${scopedLookIdSegment}-${artboardIndex}`
			: undefined;
	const frameLookSelectionNodeIds =
		frameInfluenceMaskPlan.kind === "masked"
			? frameLookSvgMatteRefIds(frameInfluenceMaskPlan.source)
			: new Set<string>();
	const frameLookUsesSelectionNodes = frameLookSelectionNodeIds.size > 0;
	const artboardContentFilterIds = frameLookUsesSelectionNodes
		? []
		: contentFilterIds;
	const filmActive =
		artboardContentFilterIds.length > 0 || Boolean(scopedLookMaskId);
	const frameLookMaskId =
		artboardContentFilterIds.length > 0 &&
		frameInfluenceMaskPlan.kind === "masked"
			? `vecmo-frame-look-mask-${artboardIdSegment}-${artboardIndex}`
			: undefined;
	const frameLookRegion = frameLookContentRegion(
		artboard,
		frameInfluenceMaskPlan,
		frameCaPadding,
	);
	const frameLookBaseExcludedNodeIds =
		frameLookUsesSelectionNodes || frameLookMaskId
			? frameLookSelectionNodeIds
			: new Set<string>();
	const maskDefs = maskPlan.defs.filter(
		(def) => nodeArtboardIds[def.maskNodeId] === artboard.id,
	);
	return {
		artboardGridClipId,
		frameLookGraphFilterSpec,
		frameLookMatte,
		frameInfluenceMaskPlan,
		effectInfluenceRecipe: frameIntent.influenceRecipe,
		frameLookPixelPassSupported,
		frameGrainParams,
		frameGrainFilterId,
		frameCaParams,
		frameCaFilterId,
		frameCaPadding,
		contentFilterIds,
		scopedLook,
		scopedInfluenceMaskPlan,
		scopedLookPixelPassSupported,
		scopedGrainParams,
		scopedGrainFilterId,
		scopedCaParams,
		scopedCaFilterId,
		scopedCaPadding,
		scopedFilterIds,
		scopedLookMaskId,
		scopedLookRegion,
		frameLookSelectionNodeIds,
		frameLookUsesSelectionNodes,
		artboardContentFilterIds,
		filmActive,
		frameLookMaskId,
		frameLookRegion,
		frameLookBaseExcludedNodeIds,
		maskDefs,
	};
}
