import {
	type CompiledEffectLayer,
	compileEffectLayerStack,
	type EffectLayerAdaptation,
	type EffectLayerFidelity,
	type EffectLayerKind,
	type EffectLayerOwnerRef,
	type EffectLayerStack,
	type EffectLayerTargetRef,
	type EffectStackPlan,
} from "@/entities/scene/model/effect-layer-stack";
import type {
	LookGraph,
	LookGraphOwnerRef,
} from "@/entities/scene/model/look-graph";
import { compileLookGraph } from "@/entities/scene/model/look-graph-compile";
import {
	type LookGraphExportManifest,
	lookGraphExportManifest,
} from "@/entities/scene/model/look-graph-export";
import {
	type EffectIntentRecipeSource,
	type ResolvedFrameEffectIntent,
	resolveEffectiveNodeRecipe,
	resolveFrameEffectIntent,
	resolveFrameLookGraph,
} from "@/entities/scene/model/recipe-resolve";
import type {
	SceneDocument,
	SceneLayer,
	VectorNode,
} from "@/entities/scene/model/types";
import {
	type EffectInfluenceRecipe,
	NEUTRAL_VISUAL_RECIPE,
	normalizeVisualRecipe,
	VISUAL_RECIPE_SCHEMA_VERSION,
	type VisualRecipe,
} from "@/shared/vec-core";
import { type ExportAsset, stableJsonStringify } from "./json";

const JSON_MIME_TYPE = "application/json;charset=utf-8";

export const VEC_CORE_RECIPE_PAYLOAD_FORMAT =
	"vector-motion-author/vec-core-recipe-payload" as const;
export const VEC_CORE_RECIPE_PAYLOAD_ASSET_ROLE =
	"vec-core-recipe-payload" as const;
export const VEC_CORE_RECIPE_SVG_APPROXIMATED_ISSUE_CODE =
	"vec-core-recipe-svg-approximated" as const;
export const VEC_CORE_RECIPE_SVG_UNSUPPORTED_ISSUE_CODE =
	"vec-core-recipe-svg-unsupported" as const;
export const VEC_CORE_RECIPE_PDF_UNSUPPORTED_ISSUE_CODE =
	"vec-core-recipe-pdf-unsupported" as const;

/** Issue-code contract shared by recipe payloads, SVG assets, and PDF assets. */
export type VecCoreRecipeIssueCode =
	| typeof VEC_CORE_RECIPE_SVG_APPROXIMATED_ISSUE_CODE
	| typeof VEC_CORE_RECIPE_SVG_UNSUPPORTED_ISSUE_CODE
	| typeof VEC_CORE_RECIPE_PDF_UNSUPPORTED_ISSUE_CODE;

/** SVG filter coverage for one canonical recipe target. */
export type VecCoreRecipeSvgApproximation = {
	readonly approximatedPaths: readonly string[];
	readonly unsupportedPaths: readonly string[];
};

/** Separates the high-fidelity vec-core payload from fallback export renderers. */
export type VecCoreRecipeBridgeDescriptor = {
	readonly highFidelity: {
		readonly payload: "recipe-json";
		readonly renderer: "vec-core";
		readonly loadPolicy: "optional-dynamic-import";
	};
	readonly svgApproximation: {
		readonly renderer: "svg-filter";
		readonly issueCodes: readonly [
			typeof VEC_CORE_RECIPE_SVG_APPROXIMATED_ISSUE_CODE,
			typeof VEC_CORE_RECIPE_SVG_UNSUPPORTED_ISSUE_CODE,
		];
	};
	readonly pdfFallback: {
		readonly renderer: "basic-pdf";
		readonly issueCode: typeof VEC_CORE_RECIPE_PDF_UNSUPPORTED_ISSUE_CODE;
	};
};

export type VecCoreRecipePayloadSource =
	| "node-recipes"
	| "frame-intent"
	| "frame-intent-and-node-recipes";

export type VecCoreRecipeEffectiveSource = EffectIntentRecipeSource | "node";

export type VecCoreRecipeAffectedTargetKind =
	| "artboard"
	| "asset"
	| "effect-layer"
	| "layer"
	| "node";

export type VecCoreRecipeAffectedTarget = {
	readonly kind: VecCoreRecipeAffectedTargetKind;
	readonly id: string;
	readonly label?: string;
	readonly role?: typeof VEC_CORE_RECIPE_PAYLOAD_ASSET_ROLE;
};

/** Visible node recipe included in an artboard-scoped `.recipe.json` payload. */
export type VecCoreRecipePayloadTarget = {
	readonly kind: "node";
	readonly layerId: string;
	readonly layerName: string;
	readonly nodeId: string;
	readonly nodeName: string;
	readonly artboardId: string;
	readonly recipe: VisualRecipe;
	readonly effectiveRecipe: VisualRecipe;
	readonly effectiveRecipeSource: VecCoreRecipeEffectiveSource;
	readonly svgApproximation: VecCoreRecipeSvgApproximation;
};

export type VecCoreInfluencePayloadStatus =
	| {
			readonly included: false;
			readonly source: null;
			readonly assignmentCount: 0;
			readonly reason: string;
	  }
	| {
			readonly included: true;
			readonly source: EffectIntentRecipeSource;
			readonly enabled: boolean;
			readonly assignmentCount: number;
			readonly assignmentIds: readonly string[];
			readonly recipe: EffectInfluenceRecipe;
	  };

export type VecCoreFrameVisualRecipePayload =
	| {
			readonly included: false;
			readonly source: null;
			readonly reason: string;
			readonly svgApproximation: VecCoreRecipeSvgApproximation;
			readonly issueCodes: readonly VecCoreRecipeIssueCode[];
	  }
	| {
			readonly included: true;
			readonly source: EffectIntentRecipeSource;
			readonly recipe: VisualRecipe;
			readonly svgApproximation: VecCoreRecipeSvgApproximation;
			readonly issueCodes: readonly VecCoreRecipeIssueCode[];
	  };

export type VecCoreEffectLayerFidelityStatus = EffectLayerFidelity["status"];

export type VecCoreFrameEffectLayerPayload = {
	readonly layerId: string;
	readonly index: number;
	readonly kind: EffectLayerKind;
	readonly label: string;
	readonly enabled: boolean;
	readonly phase: CompiledEffectLayer["phase"];
	readonly target: EffectLayerTargetRef;
	readonly blendMode: CompiledEffectLayer["blendMode"];
	readonly mix: number;
	readonly adaptation?: EffectLayerAdaptation;
	readonly input: string;
	readonly output: string;
	readonly primitiveCount: number;
	readonly fidelity: EffectLayerFidelity;
	readonly visualRecipe: VisualRecipe;
};

export type VecCoreFrameEffectLayerStackPayload =
	| {
			readonly included: false;
			readonly source: null;
			readonly reason: string;
			readonly layerCount: 0;
			readonly activeLayerCount: 0;
			readonly fidelityStatuses: readonly VecCoreEffectLayerFidelityStatus[];
			readonly layers: readonly [];
	  }
	| {
			readonly included: true;
			readonly source: EffectIntentRecipeSource;
			readonly owner: EffectLayerOwnerRef;
			readonly cacheKey: string;
			readonly input: string;
			readonly output: string;
			readonly outwardReach: number;
			readonly layerCount: number;
			readonly activeLayerCount: number;
			readonly fidelityStatuses: readonly VecCoreEffectLayerFidelityStatus[];
			readonly stack: EffectLayerStack;
			readonly layers: readonly VecCoreFrameEffectLayerPayload[];
	  };

/**
 * Precedence tier the resolved Look graph came from. Mirrors the graph-first read
 * order (`explicit lookGraph > effectLayerStack > visualRecipe`). This is the
 * *origin axis*, distinct from the scope axis that sibling sections call `source`
 * (`scene`/`artboard`) and that the graph already carries via `owner`.
 */
export type VecCoreLookGraphOrigin =
	| "explicit-graph"
	| "effect-layer-stack"
	| "visual-recipe";

/**
 * Graph-first Look manifest for the export frame. Present only when a Look graph
 * resolves (explicit, or projected from a stack/recipe); absent for influence-only
 * intents. Carries the renderer-neutral {@link LookGraphExportManifest} plus the
 * precedence tier it was derived from, so SVG/PDF/runtime adapters report the same
 * node ids and honest per-node fidelity without re-resolving the graph.
 */
export type VecCoreFrameLookGraphPayload = {
	readonly derivedFrom: VecCoreLookGraphOrigin;
} & LookGraphExportManifest;

export type VecCoreFrameEffectIntentPayload = {
	readonly kind: "frame";
	readonly scope: "artboard";
	readonly artboardId: string;
	readonly artboardName: string;
	readonly frame: {
		readonly id: string;
		readonly index: number;
	};
	readonly effectLayerStack: VecCoreFrameEffectLayerStackPayload;
	readonly visualRecipe: VecCoreFrameVisualRecipePayload;
	readonly lookGraph?: VecCoreFrameLookGraphPayload;
	readonly influence: VecCoreInfluencePayloadStatus;
	readonly effectLayerCount: number;
	readonly activeEffectLayerCount: number;
	readonly effectLayerFidelityStatuses: readonly VecCoreEffectLayerFidelityStatus[];
	readonly issueCount: number;
	readonly issueCodes: readonly VecCoreRecipeIssueCode[];
	readonly approximatedPaths: readonly string[];
	readonly unsupportedPaths: readonly string[];
};

/** Deterministic high-fidelity side-car paired with exported SVG/PDF assets. */
export type VecCoreRecipePayload = {
	readonly exportFormat: typeof VEC_CORE_RECIPE_PAYLOAD_FORMAT;
	readonly vecCoreSchemaVersion: typeof VISUAL_RECIPE_SCHEMA_VERSION;
	readonly source: VecCoreRecipePayloadSource;
	readonly scope: "artboard";
	readonly scene: {
		readonly id: string;
		readonly name: string;
		readonly schemaVersion: SceneDocument["schemaVersion"];
	};
	readonly artboard: {
		readonly id: string;
		readonly name: string;
		readonly width: number;
		readonly height: number;
	};
	readonly frame: {
		readonly id: string;
		readonly index: number;
	};
	readonly bridge: VecCoreRecipeBridgeDescriptor;
	readonly influence: VecCoreInfluencePayloadStatus;
	readonly frameIntent?: VecCoreFrameEffectIntentPayload;
	readonly frameIntentCount: number;
	readonly activeFrameIntentCount: number;
	readonly targetCount: number;
	readonly activeTargetCount: number;
	readonly issueCount: number;
	readonly approximatedPaths: readonly string[];
	readonly unsupportedPaths: readonly string[];
	readonly issueCodes: readonly VecCoreRecipeIssueCode[];
	readonly affectedTargets: readonly VecCoreRecipeAffectedTarget[];
	readonly affectedLayerIds: readonly string[];
	readonly affectedNodeIds: readonly string[];
	readonly effectLayerIds: readonly string[];
	readonly effectLayerCount: number;
	readonly activeEffectLayerCount: number;
	readonly effectLayerFidelityStatuses: readonly VecCoreEffectLayerFidelityStatus[];
	readonly targets: readonly VecCoreRecipePayloadTarget[];
};

/** Bundle asset carrying the serialized vec-core recipe payload and parsed POJO. */
export type VecCoreRecipeExportAsset = ExportAsset & {
	readonly kind: "recipe-json";
	readonly payload: VecCoreRecipePayload;
};

/** Manifest row for one artboard-scoped `.recipe.json` file-pair. */
export type VecCoreRecipePayloadManifestEntry = {
	readonly scope: "artboard";
	readonly assetRole: typeof VEC_CORE_RECIPE_PAYLOAD_ASSET_ROLE;
	readonly artboardId: string;
	readonly artboardName: string;
	readonly frameId: string;
	readonly frame: number;
	readonly fileName: string;
	readonly frameIntentCount: number;
	readonly activeFrameIntentCount: number;
	readonly targetCount: number;
	readonly activeTargetCount: number;
	readonly influenceIncluded: boolean;
	readonly influenceAssignmentCount: number;
	readonly issueCount: number;
	readonly approximatedPaths: readonly string[];
	readonly unsupportedPaths: readonly string[];
	readonly issueCodes: readonly VecCoreRecipeIssueCode[];
	readonly affectedTargets: readonly VecCoreRecipeAffectedTarget[];
	readonly affectedLayerIds: readonly string[];
	readonly affectedNodeIds: readonly string[];
	readonly influenceAssignmentIds: readonly string[];
	readonly effectLayerIds: readonly string[];
	readonly effectLayerCount: number;
	readonly activeEffectLayerCount: number;
	readonly effectLayerFidelityStatuses: readonly VecCoreEffectLayerFidelityStatus[];
};

/** Top-level manifest summary for all vec-core recipe side-cars in a bundle. */
export type VecCoreRecipeBundleManifest = {
	readonly included: true;
	readonly assetRole: typeof VEC_CORE_RECIPE_PAYLOAD_ASSET_ROLE;
	readonly vecCoreSchemaVersion: typeof VISUAL_RECIPE_SCHEMA_VERSION;
	readonly source: VecCoreRecipePayloadSource;
	readonly payloadAssetCount: number;
	readonly payloadFileNames: readonly string[];
	readonly frameIntentCount: number;
	readonly activeFrameIntentCount: number;
	readonly targetCount: number;
	readonly activeTargetCount: number;
	readonly influenceIncluded: boolean;
	readonly influenceAssignmentCount: number;
	readonly bridge: VecCoreRecipeBridgeDescriptor;
	readonly issueCount: number;
	readonly issueCodes: readonly VecCoreRecipeIssueCode[];
	readonly affectedTargets: readonly VecCoreRecipeAffectedTarget[];
	readonly affectedLayerIds: readonly string[];
	readonly affectedNodeIds: readonly string[];
	readonly influenceAssignmentIds: readonly string[];
	readonly effectLayerIds: readonly string[];
	readonly effectLayerCount: number;
	readonly activeEffectLayerCount: number;
	readonly effectLayerFidelityStatuses: readonly VecCoreEffectLayerFidelityStatus[];
	readonly payloads: readonly VecCoreRecipePayloadManifestEntry[];
};

const bridgeDescriptor = (): VecCoreRecipeBridgeDescriptor => ({
	highFidelity: {
		payload: "recipe-json",
		renderer: "vec-core",
		loadPolicy: "optional-dynamic-import",
	},
	svgApproximation: {
		renderer: "svg-filter",
		issueCodes: [
			VEC_CORE_RECIPE_SVG_APPROXIMATED_ISSUE_CODE,
			VEC_CORE_RECIPE_SVG_UNSUPPORTED_ISSUE_CODE,
		],
	},
	pdfFallback: {
		renderer: "basic-pdf",
		issueCode: VEC_CORE_RECIPE_PDF_UNSUPPORTED_ISSUE_CODE,
	},
});

const changed = (value: unknown, neutral: unknown): boolean =>
	stableJsonStringify(value) !== stableJsonStringify(neutral);

const sortedUnique = (values: readonly string[]): readonly string[] =>
	[...new Set(values)].sort((left, right) => left.localeCompare(right));

const frameIdForIndex = (frame: number): string => `frame-${frame}`;

const recipeIssueCodes = (
	analysis: VecCoreRecipeSvgApproximation,
): readonly VecCoreRecipeIssueCode[] => [
	...(analysis.approximatedPaths.length > 0
		? [VEC_CORE_RECIPE_SVG_APPROXIMATED_ISSUE_CODE]
		: []),
	...(analysis.unsupportedPaths.length > 0
		? [VEC_CORE_RECIPE_SVG_UNSUPPORTED_ISSUE_CODE]
		: []),
	...(analysis.approximatedPaths.length > 0 ||
	analysis.unsupportedPaths.length > 0
		? [VEC_CORE_RECIPE_PDF_UNSUPPORTED_ISSUE_CODE]
		: []),
];

const activePathsForAnalysis = (
	analysis: VecCoreRecipeSvgApproximation,
): readonly string[] =>
	sortedUnique([...analysis.approximatedPaths, ...analysis.unsupportedPaths]);

const affectedTargetRank: Readonly<
	Record<VecCoreRecipeAffectedTargetKind, number>
> = {
	artboard: 0,
	node: 1,
	layer: 2,
	"effect-layer": 3,
	asset: 4,
};

const affectedTargetKey = (target: VecCoreRecipeAffectedTarget): string =>
	`${target.kind}:${target.id}:${target.role ?? ""}`;

const sortedUniqueAffectedTargets = (
	targets: readonly (VecCoreRecipeAffectedTarget | undefined)[],
): readonly VecCoreRecipeAffectedTarget[] =>
	[
		...new Map(
			targets
				.filter(
					(target): target is VecCoreRecipeAffectedTarget =>
						target !== undefined && target.id.length > 0,
				)
				.map((target) => [affectedTargetKey(target), target] as const),
		).values(),
	].sort((left, right) => {
		const rankDelta =
			affectedTargetRank[left.kind] - affectedTargetRank[right.kind];
		if (rankDelta !== 0) return rankDelta;
		const idDelta = left.id.localeCompare(right.id);
		if (idDelta !== 0) return idDelta;
		return (left.role ?? "").localeCompare(right.role ?? "");
	});

const affectedTargetsForPayloadParts = ({
	artboard,
	frameIntent,
	targets,
	fileName,
}: {
	readonly artboard: VecCoreRecipePayload["artboard"];
	readonly frameIntent?: VecCoreFrameEffectIntentPayload;
	readonly targets: readonly VecCoreRecipePayloadTarget[];
	readonly fileName?: string;
}): readonly VecCoreRecipeAffectedTarget[] =>
	sortedUniqueAffectedTargets([
		{ kind: "artboard", id: artboard.id, label: artboard.name },
		...(fileName
			? [
					{
						kind: "asset" as const,
						id: fileName,
						role: VEC_CORE_RECIPE_PAYLOAD_ASSET_ROLE,
					},
				]
			: []),
		...targets.flatMap((target) => [
			{
				kind: "node" as const,
				id: target.nodeId,
				label: target.nodeName,
			},
			{
				kind: "layer" as const,
				id: target.layerId,
				label: target.layerName,
			},
		]),
		...(frameIntent?.effectLayerStack.included
			? frameIntent.effectLayerStack.layers.map((layer) => ({
					kind: "effect-layer" as const,
					id: layer.layerId,
					label: layer.label,
				}))
			: []),
	]);

const emptySvgApproximation = (): VecCoreRecipeSvgApproximation => ({
	approximatedPaths: [],
	unsupportedPaths: [],
});

const missingInfluenceStatus = (): VecCoreInfluencePayloadStatus => ({
	included: false,
	source: null,
	assignmentCount: 0,
	reason:
		"No scene/artboard EffectInfluence side-car resolved for this export frame.",
});

const influenceStatus = (
	recipe: EffectInfluenceRecipe | null,
	source: EffectIntentRecipeSource | null,
): VecCoreInfluencePayloadStatus => {
	if (!recipe || !source) return missingInfluenceStatus();
	return {
		included: true,
		source,
		enabled: recipe.enabled,
		assignmentCount: recipe.assignments.length,
		assignmentIds: recipe.assignments.map((assignment) => assignment.id),
		recipe,
	};
};

const influenceAssignmentIds = (
	status: VecCoreInfluencePayloadStatus,
): readonly string[] => (status.included ? status.assignmentIds : []);

const visualRecipeStatus = (
	recipe: VisualRecipe | null,
	source: EffectIntentRecipeSource | null,
): VecCoreFrameVisualRecipePayload => {
	if (!recipe || !source) {
		return {
			included: false,
			source: null,
			reason:
				"No scene/artboard VisualRecipe side-car resolved for this export frame.",
			svgApproximation: emptySvgApproximation(),
			issueCodes: [],
		};
	}
	const svgApproximation = analyzeVecCoreRecipeSvgApproximation(recipe);
	return {
		included: true,
		source,
		recipe,
		svgApproximation,
		issueCodes: recipeIssueCodes(svgApproximation),
	};
};

const missingEffectLayerStackStatus =
	(): VecCoreFrameEffectLayerStackPayload => ({
		included: false,
		source: null,
		reason:
			"No scene/artboard EffectLayerStack side-car resolved for this export frame.",
		layerCount: 0,
		activeLayerCount: 0,
		fidelityStatuses: [],
		layers: [],
	});

const effectLayerOwnerForSource = (
	source: EffectIntentRecipeSource | null,
	artboardId: string,
): EffectLayerOwnerRef | null => {
	if (source === "scene") return { scope: "scene" };
	if (source === "artboard") return { scope: "artboard", artboardId };
	return null;
};

const effectLayerPayload = ({
	stack,
	compiled,
	index,
}: {
	readonly stack: EffectLayerStack;
	readonly compiled: CompiledEffectLayer;
	readonly index: number;
}): VecCoreFrameEffectLayerPayload => {
	const sourceLayer = stack.layers[index];
	return {
		layerId: compiled.layerId,
		index,
		kind: compiled.kind,
		label: sourceLayer?.label ?? compiled.kind,
		enabled: sourceLayer?.enabled ?? true,
		phase: compiled.phase,
		target: sourceLayer?.target ?? { scope: "frame" },
		blendMode: compiled.blendMode,
		mix: compiled.mix,
		...(compiled.adaptation ? { adaptation: compiled.adaptation } : {}),
		input: compiled.input,
		output: compiled.output,
		primitiveCount: compiled.primitives.length,
		fidelity: compiled.fidelity,
		visualRecipe: sourceLayer?.visualRecipe ?? NEUTRAL_VISUAL_RECIPE,
	};
};

const effectLayerFidelityStatuses = (
	plan: EffectStackPlan,
): readonly VecCoreEffectLayerFidelityStatus[] =>
	sortedUnique(plan.fidelity.map((fidelity) => fidelity.status)).filter(
		(status): status is VecCoreEffectLayerFidelityStatus =>
			status === "native" ||
			status === "approx" ||
			status === "side-car-only" ||
			status === "capture-only" ||
			status === "deferred" ||
			status === "unsupported",
	);

const effectLayerStackStatus = ({
	stack,
	source,
	artboardId,
}: {
	readonly stack: EffectLayerStack | null;
	readonly source: EffectIntentRecipeSource | null;
	readonly artboardId: string;
}): VecCoreFrameEffectLayerStackPayload => {
	const owner = effectLayerOwnerForSource(source, artboardId);
	if (!stack || !source || !owner) return missingEffectLayerStackStatus();
	const plan = compileEffectLayerStack(stack, { owner });
	const shell = {
		included: true,
		source,
		owner,
		cacheKey: plan.cacheKey,
		input: plan.input,
		output: plan.output,
		outwardReach: plan.outwardReach,
		layerCount: plan.layers.length,
		activeLayerCount: stack.layers.filter(
			(layer) => layer.enabled && layer.mix > 0,
		).length,
		fidelityStatuses: effectLayerFidelityStatuses(plan),
		stack,
	} as const;
	return {
		...shell,
		layers: plan.layers.map((compiled, index) =>
			effectLayerPayload({ stack, compiled, index }),
		),
	};
};

const payloadSource = ({
	frameIntent,
	targetCount,
}: {
	readonly frameIntent: VecCoreFrameEffectIntentPayload | undefined;
	readonly targetCount: number;
}): VecCoreRecipePayloadSource => {
	if (frameIntent && targetCount > 0) return "frame-intent-and-node-recipes";
	if (frameIntent) return "frame-intent";
	return "node-recipes";
};

const bundlePayloadSource = (
	payloads: readonly VecCoreRecipePayloadManifestEntry[],
): VecCoreRecipePayloadSource => {
	const hasFrameIntent = payloads.some(
		(payload) => payload.frameIntentCount > 0,
	);
	const hasNodeRecipes = payloads.some((payload) => payload.targetCount > 0);
	if (hasFrameIntent && hasNodeRecipes) return "frame-intent-and-node-recipes";
	if (hasFrameIntent) return "frame-intent";
	return "node-recipes";
};

const visitVisibleRecipeTargets = ({
	scene,
	layer,
	nodes,
	targets,
	visibleByParent,
}: {
	readonly scene: SceneDocument;
	readonly layer: SceneLayer;
	readonly nodes: readonly VectorNode[];
	readonly targets: VecCoreRecipePayloadTarget[];
	readonly visibleByParent: boolean;
}): void => {
	for (const node of nodes) {
		const visible = visibleByParent && node.visible;
		if (!visible) continue;
		if (node.recipe) {
			const recipe = normalizeVisualRecipe(node.recipe);
			const artboardId =
				node.artboardId ?? scene.currentArtboardId ?? scene.artboard.id;
			const frameIntent = resolveFrameEffectIntent(scene, artboardId);
			const effectiveRecipe = resolveEffectiveNodeRecipe(scene, node) ?? recipe;
			targets.push({
				kind: "node",
				layerId: layer.id,
				layerName: layer.name,
				nodeId: node.id,
				nodeName: node.name,
				artboardId,
				recipe,
				effectiveRecipe,
				effectiveRecipeSource: frameIntent.visualRecipe
					? (frameIntent.visualRecipeSource ?? "node")
					: "node",
				svgApproximation: analyzeVecCoreRecipeSvgApproximation(recipe),
			});
		}
		if (node.children) {
			visitVisibleRecipeTargets({
				scene,
				layer,
				nodes: node.children,
				targets,
				visibleByParent: visible,
			});
		}
	}
};

/**
 * Classifies which parts of a canonical vec-core recipe the string SVG exporter
 * can only approximate, and which parts remain high-fidelity-only. The result is
 * used by SVG/PDF issue reporting and by the `.recipe.json` manifest so all
 * export surfaces explain the same bridge contract.
 */
export function analyzeVecCoreRecipeSvgApproximation(
	recipe: VisualRecipe,
): VecCoreRecipeSvgApproximation {
	const approximatedPaths: string[] = [];
	const unsupportedPaths: string[] = [];
	const neutral = NEUTRAL_VISUAL_RECIPE;

	if (changed(recipe.color, neutral.color)) approximatedPaths.push("color");
	if (changed(recipe.texture.grain, neutral.texture.grain)) {
		approximatedPaths.push("texture.grain");
	}
	if (changed(recipe.glow.bloom, neutral.glow.bloom)) {
		approximatedPaths.push("glow.bloom");
	}

	if (changed(recipe.surface, neutral.surface))
		unsupportedPaths.push("surface");
	if (changed(recipe.texture.material, neutral.texture.material)) {
		unsupportedPaths.push("texture.material");
	}
	if (changed(recipe.glow.halation, neutral.glow.halation)) {
		unsupportedPaths.push("glow.halation");
	}
	if (changed(recipe.glow.diffusion, neutral.glow.diffusion)) {
		unsupportedPaths.push("glow.diffusion");
	}
	if (changed(recipe.glow.lightShafts, neutral.glow.lightShafts)) {
		unsupportedPaths.push("glow.lightShafts");
	}
	if (recipe.optics.lensSoftness !== neutral.optics.lensSoftness) {
		unsupportedPaths.push("optics.lensSoftness");
	}
	if (recipe.optics.vignette !== neutral.optics.vignette) {
		unsupportedPaths.push("optics.vignette");
	}
	if (recipe.optics.chromaticFringing !== neutral.optics.chromaticFringing) {
		unsupportedPaths.push("optics.chromaticFringing");
	}
	if (recipe.optics.rayAngleWeight !== neutral.optics.rayAngleWeight) {
		unsupportedPaths.push("optics.rayAngleWeight");
	}
	if (changed(recipe.optics.crossFilter, neutral.optics.crossFilter)) {
		unsupportedPaths.push("optics.crossFilter");
	}
	if (changed(recipe.optics.haloPrism, neutral.optics.haloPrism)) {
		unsupportedPaths.push("optics.haloPrism");
	}
	if (changed(recipe.motion, neutral.motion)) unsupportedPaths.push("motion");
	if (changed(recipe.shadow, neutral.shadow)) unsupportedPaths.push("shadow");
	if (changed(recipe.distortion, neutral.distortion)) {
		unsupportedPaths.push("distortion");
	}
	if (changed(recipe.stylization, neutral.stylization)) {
		unsupportedPaths.push("stylization");
	}

	return { approximatedPaths, unsupportedPaths };
}

/**
 * Stable comma-separated path summary for export issue messages. Keeping this
 * helper beside the payload analyzer prevents SVG/PDF/report wording from
 * drifting away from the manifest contract.
 */
export function vecCoreRecipePathSummary(paths: readonly string[]): string {
	return paths.length > 0 ? paths.join(", ") : "none";
}

/**
 * Resolves which graph-first precedence tier produced the frame's Look graph,
 * mirroring {@link lookGraphFromIntent}: an explicit graph wins, then a stack
 * projection, then a legacy visual-recipe projection. Returns `null` when no Look
 * graph slot is present (e.g. an influence-only intent).
 */
const lookGraphOriginForResolved = (
	resolved: ResolvedFrameEffectIntent,
): VecCoreLookGraphOrigin | null => {
	if (resolved.lookGraph) return "explicit-graph";
	if (resolved.effectLayerStack) return "effect-layer-stack";
	if (resolved.visualRecipe) return "visual-recipe";
	return null;
};

/**
 * Compiles the resolved frame Look graph into its export manifest section. Returns
 * `undefined` when no graph resolves so the `lookGraph` section is simply omitted
 * (additive, non-breaking). The compile is read-only — export never writes scene
 * state — and reuses the same compiler the canvas/runtime consume.
 */
const lookGraphStatus = ({
	graph,
	derivedFrom,
	owner,
}: {
	readonly graph: LookGraph | null;
	readonly derivedFrom: VecCoreLookGraphOrigin | null;
	readonly owner: LookGraphOwnerRef;
}): VecCoreFrameLookGraphPayload | undefined => {
	if (!graph || !derivedFrom) return undefined;
	const plan = compileLookGraph(graph, { owner });
	return { derivedFrom, ...lookGraphExportManifest(graph, plan) };
};

const createFrameEffectIntentPayload = (
	scene: SceneDocument,
	frame: number,
): VecCoreFrameEffectIntentPayload | undefined => {
	const resolved = resolveFrameEffectIntent(scene, scene.artboard.id);
	// A branch-only graph stores `lookGraph` with `visualRecipe`/`effectLayerStack`
	// cleared, so it must be admitted here too or the whole frame intent is dropped.
	// The coarse `activeFrameIntentCount` still ignores graph-only Looks (its honest
	// status lives in the `lookGraph` section: `serialProjectable`/`svgUnsupportedNodeIds`);
	// folding branch graphs into that count is deferred to a graph runtime consumer.
	if (
		!resolved.effectLayerStack &&
		!resolved.visualRecipe &&
		!resolved.influenceRecipe &&
		!resolved.lookGraph
	) {
		return undefined;
	}

	const effectLayerStack = effectLayerStackStatus({
		stack: resolved.effectLayerStack,
		source: resolved.effectLayerStackSource,
		artboardId: resolved.artboardId,
	});
	const visualRecipe = visualRecipeStatus(
		resolved.visualRecipe,
		resolved.visualRecipeSource,
	);
	const influence = influenceStatus(
		resolved.influenceRecipe,
		resolved.influenceRecipeSource,
	);
	const lookGraph = lookGraphStatus({
		graph: resolveFrameLookGraph(scene, resolved.artboardId),
		derivedFrom: lookGraphOriginForResolved(resolved),
		owner: { scope: "artboard", artboardId: resolved.artboardId },
	});
	const approximatedPaths =
		visualRecipe.included === true
			? visualRecipe.svgApproximation.approximatedPaths
			: [];
	const unsupportedPaths =
		visualRecipe.included === true
			? visualRecipe.svgApproximation.unsupportedPaths
			: [];
	const issueCodes =
		visualRecipe.included === true ? visualRecipe.issueCodes : [];

	return {
		kind: "frame",
		scope: "artboard",
		artboardId: resolved.artboardId,
		artboardName: scene.artboard.name,
		frame: {
			id: frameIdForIndex(frame),
			index: frame,
		},
		effectLayerStack,
		visualRecipe,
		...(lookGraph ? { lookGraph } : {}),
		influence,
		effectLayerCount: effectLayerStack.layerCount,
		activeEffectLayerCount: effectLayerStack.activeLayerCount,
		effectLayerFidelityStatuses: effectLayerStack.fidelityStatuses,
		issueCount: issueCodes.length,
		issueCodes,
		approximatedPaths,
		unsupportedPaths,
	};
};

/**
 * Builds the canonical recipe side-car payload for a scoped export scene. It
 * records both visible legacy node recipes and the resolved scene/artboard frame
 * intent, so the high-fidelity side-car follows the same precedence resolver as
 * editor-domain effect authoring without asking SVG/PDF adapters to become the
 * canonical renderer.
 */
export function createVecCoreRecipePayload(
	scene: SceneDocument,
	frame = 0,
): VecCoreRecipePayload {
	const targets: VecCoreRecipePayloadTarget[] = [];
	for (const layer of scene.layers) {
		visitVisibleRecipeTargets({
			scene,
			layer,
			nodes: layer.nodes,
			targets,
			visibleByParent: layer.visible,
		});
	}
	const frameIntent = createFrameEffectIntentPayload(scene, frame);
	const activeTargets = targets.filter(
		(target) => activePathsForAnalysis(target.svgApproximation).length > 0,
	);
	const approximatedPaths = sortedUnique([
		...(frameIntent?.approximatedPaths ?? []),
		...targets.flatMap((target) => target.svgApproximation.approximatedPaths),
	]);
	const unsupportedPaths = sortedUnique([
		...(frameIntent?.unsupportedPaths ?? []),
		...targets.flatMap((target) => target.svgApproximation.unsupportedPaths),
	]);
	const issueCodes = sortedUnique([
		...(frameIntent?.issueCodes ?? []),
		...targets.flatMap((target) => recipeIssueCodes(target.svgApproximation)),
	]) as readonly VecCoreRecipeIssueCode[];
	const artboard = {
		id: scene.artboard.id,
		name: scene.artboard.name,
		width: scene.artboard.width,
		height: scene.artboard.height,
	};
	const affectedTargets = affectedTargetsForPayloadParts({
		artboard,
		frameIntent,
		targets,
	});
	const frameIntentActive =
		frameIntent !== undefined &&
		(activePathsForAnalysis({
			approximatedPaths: frameIntent.approximatedPaths,
			unsupportedPaths: frameIntent.unsupportedPaths,
		}).length > 0 ||
			frameIntent.activeEffectLayerCount > 0 ||
			(frameIntent.influence.included &&
				frameIntent.influence.assignmentCount > 0));

	return {
		exportFormat: VEC_CORE_RECIPE_PAYLOAD_FORMAT,
		vecCoreSchemaVersion: VISUAL_RECIPE_SCHEMA_VERSION,
		source: payloadSource({ frameIntent, targetCount: targets.length }),
		scope: "artboard",
		scene: {
			id: scene.id,
			name: scene.name,
			schemaVersion: scene.schemaVersion,
		},
		artboard: {
			...artboard,
		},
		frame: {
			id: frameIdForIndex(frame),
			index: frame,
		},
		bridge: bridgeDescriptor(),
		influence: frameIntent?.influence ?? missingInfluenceStatus(),
		...(frameIntent ? { frameIntent } : {}),
		frameIntentCount: frameIntent ? 1 : 0,
		activeFrameIntentCount: frameIntentActive ? 1 : 0,
		targetCount: targets.length,
		activeTargetCount: activeTargets.length,
		issueCount: issueCodes.length,
		approximatedPaths,
		unsupportedPaths,
		issueCodes,
		affectedTargets,
		affectedLayerIds: sortedUnique(targets.map((target) => target.layerId)),
		affectedNodeIds: sortedUnique(targets.map((target) => target.nodeId)),
		effectLayerIds: sortedUnique(
			frameIntent?.effectLayerStack.included
				? frameIntent.effectLayerStack.layers.map((layer) => layer.layerId)
				: [],
		),
		effectLayerCount: frameIntent?.effectLayerCount ?? 0,
		activeEffectLayerCount: frameIntent?.activeEffectLayerCount ?? 0,
		effectLayerFidelityStatuses: frameIntent?.effectLayerFidelityStatuses ?? [],
		targets,
	};
}

/**
 * Creates the `.recipe.json` file-pair asset for a scoped artboard export.
 * Returns `null` when neither visible node recipes nor resolved frame intent are
 * present, so legacy SVG/PDF bundles keep their previous file list and manifest
 * bytes.
 */
export function createVecCoreRecipeJsonExport({
	scene,
	frame = 0,
	fileNameStem,
}: {
	readonly scene: SceneDocument;
	readonly frame?: number;
	readonly fileNameStem: string;
}): VecCoreRecipeExportAsset | null {
	const payload = createVecCoreRecipePayload(scene, frame);
	if (payload.targetCount === 0 && payload.frameIntentCount === 0) return null;
	return {
		kind: "recipe-json",
		fileName: `${fileNameStem}.recipe.json`,
		mimeType: JSON_MIME_TYPE,
		contents: stableJsonStringify(payload),
		payload,
	};
}

/**
 * Reduces per-artboard recipe side-car assets into the bundle manifest's vec-core
 * section, preserving deterministic file-pair metadata without parsing JSON
 * strings back out of the assets.
 */
export function createVecCoreRecipeBundleManifest(
	assets: readonly (VecCoreRecipeExportAsset & {
		readonly artboard: { readonly id: string; readonly name: string };
	})[],
): VecCoreRecipeBundleManifest | undefined {
	if (assets.length === 0) return undefined;
	const payloads = assets.map((asset) => ({
		scope: asset.payload.scope,
		assetRole: VEC_CORE_RECIPE_PAYLOAD_ASSET_ROLE,
		artboardId: asset.artboard.id,
		artboardName: asset.artboard.name,
		frameId: asset.payload.frame.id,
		frame: asset.payload.frame.index,
		fileName: asset.fileName,
		frameIntentCount: asset.payload.frameIntentCount,
		activeFrameIntentCount: asset.payload.activeFrameIntentCount,
		targetCount: asset.payload.targetCount,
		activeTargetCount: asset.payload.activeTargetCount,
		influenceIncluded: asset.payload.influence.included,
		influenceAssignmentCount: asset.payload.influence.assignmentCount,
		issueCount: asset.payload.issueCount,
		approximatedPaths: asset.payload.approximatedPaths,
		unsupportedPaths: asset.payload.unsupportedPaths,
		issueCodes: asset.payload.issueCodes,
		affectedTargets: affectedTargetsForPayloadParts({
			artboard: {
				...asset.payload.artboard,
				id: asset.artboard.id,
				name: asset.artboard.name,
			},
			frameIntent: asset.payload.frameIntent,
			targets: asset.payload.targets,
			fileName: asset.fileName,
		}),
		affectedLayerIds: asset.payload.affectedLayerIds,
		affectedNodeIds: asset.payload.affectedNodeIds,
		influenceAssignmentIds: influenceAssignmentIds(asset.payload.influence),
		effectLayerIds: asset.payload.effectLayerIds,
		effectLayerCount: asset.payload.effectLayerCount,
		activeEffectLayerCount: asset.payload.activeEffectLayerCount,
		effectLayerFidelityStatuses: asset.payload.effectLayerFidelityStatuses,
	}));
	return {
		included: true,
		assetRole: VEC_CORE_RECIPE_PAYLOAD_ASSET_ROLE,
		vecCoreSchemaVersion: VISUAL_RECIPE_SCHEMA_VERSION,
		source: bundlePayloadSource(payloads),
		payloadAssetCount: assets.length,
		payloadFileNames: payloads.map((payload) => payload.fileName),
		frameIntentCount: payloads.reduce(
			(total, payload) => total + payload.frameIntentCount,
			0,
		),
		activeFrameIntentCount: payloads.reduce(
			(total, payload) => total + payload.activeFrameIntentCount,
			0,
		),
		targetCount: payloads.reduce(
			(total, payload) => total + payload.targetCount,
			0,
		),
		activeTargetCount: payloads.reduce(
			(total, payload) => total + payload.activeTargetCount,
			0,
		),
		influenceIncluded: payloads.some((payload) => payload.influenceIncluded),
		influenceAssignmentCount: payloads.reduce(
			(total, payload) => total + payload.influenceAssignmentCount,
			0,
		),
		bridge: bridgeDescriptor(),
		issueCount: payloads.reduce(
			(total, payload) => total + payload.issueCount,
			0,
		),
		issueCodes: sortedUnique(
			payloads.flatMap((payload) => payload.issueCodes),
		) as readonly VecCoreRecipeIssueCode[],
		affectedTargets: sortedUniqueAffectedTargets(
			payloads.flatMap((payload) => payload.affectedTargets),
		),
		affectedLayerIds: sortedUnique(
			payloads.flatMap((payload) => payload.affectedLayerIds),
		),
		affectedNodeIds: sortedUnique(
			payloads.flatMap((payload) => payload.affectedNodeIds),
		),
		influenceAssignmentIds: sortedUnique(
			payloads.flatMap((payload) => payload.influenceAssignmentIds),
		),
		effectLayerIds: sortedUnique(
			payloads.flatMap((payload) => payload.effectLayerIds),
		),
		effectLayerCount: payloads.reduce(
			(total, payload) => total + payload.effectLayerCount,
			0,
		),
		activeEffectLayerCount: payloads.reduce(
			(total, payload) => total + payload.activeEffectLayerCount,
			0,
		),
		effectLayerFidelityStatuses: sortedUnique(
			payloads.flatMap((payload) => payload.effectLayerFidelityStatuses),
		) as readonly VecCoreEffectLayerFidelityStatus[],
		payloads,
	};
}
