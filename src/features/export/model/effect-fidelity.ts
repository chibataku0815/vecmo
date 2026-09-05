import {
	EFFECT_CAPABILITY_DESCRIPTORS,
	type EffectCapabilityDescriptor,
	type EffectRuntimeSupportMatrix,
} from "@/entities/scene/model/effect-capabilities";
import { readRecipeControlValue } from "@/entities/scene/model/recipe-controls";
import type { VisualRecipe } from "@/shared/vec-core";
import { stableJsonStringify } from "./json";
import type {
	VecCoreFrameEffectLayerPayload,
	VecCoreRecipeAffectedTarget,
	VecCoreRecipePayload,
	VecCoreRecipePayloadTarget,
} from "./vec-core";

export type ExportEffectCapabilityManifestEntry = {
	readonly id: string;
	readonly label: string;
	readonly source: EffectCapabilityDescriptor["source"];
	readonly targetScopes: EffectCapabilityDescriptor["targetScopes"];
	readonly stackPhases: EffectCapabilityDescriptor["stackPhases"];
	readonly control: Pick<
		EffectCapabilityDescriptor["control"],
		"valueKind" | "keyframable" | "expressionBindable" | "advanced"
	>;
	readonly support: EffectRuntimeSupportMatrix;
	readonly active: boolean;
	readonly activeTargetCount: number;
	readonly affectedTargets: readonly VecCoreRecipeAffectedTarget[];
};

/**
 * Bundle-level effect fidelity manifest consumed by generated Motion Runtime JS
 * and React handoff assets. It serializes the authoring contract and its current
 * payload usage; it never stores executable effect code.
 */
export type ExportEffectCapabilitiesManifest = {
	readonly included: true;
	readonly contractVersion: 1;
	readonly capabilityCount: number;
	readonly activeCapabilityCount: number;
	readonly activeCapabilityIds: readonly string[];
	readonly expressionBindableCapabilityCount: number;
	readonly activeExpressionBindableCapabilityIds: readonly string[];
	readonly affectedTargets: readonly VecCoreRecipeAffectedTarget[];
	readonly capabilities: readonly ExportEffectCapabilityManifestEntry[];
};

type ActiveCapabilityUsage = {
	readonly targetCount: number;
	readonly affectedTargets: readonly VecCoreRecipeAffectedTarget[];
};

const ANALOG_FILM_RECIPE_IDS = new Set([
	"analog-film",
	"glammer-time-delay-stage-film",
]);

const isAnalogFilmRecipe = (recipe: VisualRecipe): boolean =>
	ANALOG_FILM_RECIPE_IDS.has(recipe.id) ||
	recipe.metadata["profile.stage"] === "film-background";

const affectedTargetRank: Readonly<
	Record<VecCoreRecipeAffectedTarget["kind"], number>
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
	targets: readonly VecCoreRecipeAffectedTarget[],
): readonly VecCoreRecipeAffectedTarget[] =>
	[
		...new Map(
			targets.map((target) => [affectedTargetKey(target), target]),
		).values(),
	]
		.filter((target) => target.id.length > 0)
		.sort((left, right) => {
			const rankDelta =
				affectedTargetRank[left.kind] - affectedTargetRank[right.kind];
			if (rankDelta !== 0) return rankDelta;
			const idDelta = left.id.localeCompare(right.id);
			if (idDelta !== 0) return idDelta;
			return (left.role ?? "").localeCompare(right.role ?? "");
		});

const changed = (value: unknown, fallback: unknown): boolean =>
	stableJsonStringify(value) !== stableJsonStringify(fallback);

const artboardTargetForPayload = (
	payload: VecCoreRecipePayload,
): VecCoreRecipeAffectedTarget => ({
	kind: "artboard",
	id: payload.artboard.id,
	label: payload.artboard.name,
});

const affectedTargetsForNodeRecipeTarget = (
	payload: VecCoreRecipePayload,
	target: VecCoreRecipePayloadTarget,
): readonly VecCoreRecipeAffectedTarget[] => [
	artboardTargetForPayload(payload),
	{ kind: "node", id: target.nodeId, label: target.nodeName },
	{ kind: "layer", id: target.layerId, label: target.layerName },
];

const affectedTargetsForEffectLayer = (
	payload: VecCoreRecipePayload,
	layer: VecCoreFrameEffectLayerPayload,
): readonly VecCoreRecipeAffectedTarget[] => [
	artboardTargetForPayload(payload),
	{ kind: "effect-layer", id: layer.layerId, label: layer.label },
];

const recipeControlChanged = (
	recipe: VisualRecipe,
	capability: EffectCapabilityDescriptor,
): boolean => {
	if (capability.source.kind !== "recipe-control") return false;
	const value = readRecipeControlValue(recipe, capability.source.recipePath);
	if (value === null) return false;
	return changed(value, capability.control.defaultValue);
};

const nodeRecipeUsage = (
	capability: EffectCapabilityDescriptor,
	payloads: readonly VecCoreRecipePayload[],
): ActiveCapabilityUsage => {
	const affectedTargets: VecCoreRecipeAffectedTarget[] = [];
	let targetCount = 0;
	for (const payload of payloads) {
		for (const target of payload.targets) {
			if (!recipeControlChanged(target.recipe, capability)) continue;
			targetCount += 1;
			affectedTargets.push(
				...affectedTargetsForNodeRecipeTarget(payload, target),
			);
		}
	}
	return {
		targetCount,
		affectedTargets: sortedUniqueAffectedTargets(affectedTargets),
	};
};

const frameRecipeUsage = (
	capability: EffectCapabilityDescriptor,
	payloads: readonly VecCoreRecipePayload[],
): ActiveCapabilityUsage => {
	const affectedTargets: VecCoreRecipeAffectedTarget[] = [];
	let targetCount = 0;
	for (const payload of payloads) {
		const effectLayerStack = payload.frameIntent?.effectLayerStack;
		if (effectLayerStack?.included) {
			for (const layer of effectLayerStack.layers) {
				if (!recipeControlChanged(layer.visualRecipe, capability)) continue;
				targetCount += 1;
				affectedTargets.push(...affectedTargetsForEffectLayer(payload, layer));
			}
			continue;
		}
		const visualRecipe = payload.frameIntent?.visualRecipe;
		if (!visualRecipe?.included) continue;
		if (!recipeControlChanged(visualRecipe.recipe, capability)) continue;
		targetCount += 1;
		affectedTargets.push(artboardTargetForPayload(payload));
	}
	return {
		targetCount,
		affectedTargets: sortedUniqueAffectedTargets(affectedTargets),
	};
};

const frameRecipePresetUsage = (
	capability: EffectCapabilityDescriptor,
	payloads: readonly VecCoreRecipePayload[],
): ActiveCapabilityUsage => {
	const affectedTargets: VecCoreRecipeAffectedTarget[] = [];
	let targetCount = 0;
	for (const payload of payloads) {
		const visualRecipe = payload.frameIntent?.visualRecipe;
		if (!visualRecipe?.included) continue;
		if (
			capability.source.kind !== "recipe-preset" ||
			capability.source.presetId !== "analog-film" ||
			!isAnalogFilmRecipe(visualRecipe.recipe)
		) {
			continue;
		}
		targetCount += 1;
		affectedTargets.push(artboardTargetForPayload(payload));
	}
	return {
		targetCount,
		affectedTargets: sortedUniqueAffectedTargets(affectedTargets),
	};
};

const frameInfluenceUsage = (
	payloads: readonly VecCoreRecipePayload[],
): ActiveCapabilityUsage => {
	const affectedTargets: VecCoreRecipeAffectedTarget[] = [];
	let targetCount = 0;
	for (const payload of payloads) {
		if (
			!payload.influence.included ||
			payload.influence.assignmentCount === 0
		) {
			continue;
		}
		targetCount += payload.influence.assignmentCount;
		affectedTargets.push(artboardTargetForPayload(payload));
	}
	return {
		targetCount,
		affectedTargets: sortedUniqueAffectedTargets(affectedTargets),
	};
};

const capabilityUsage = (
	capability: EffectCapabilityDescriptor,
	payloads: readonly VecCoreRecipePayload[],
): ActiveCapabilityUsage => {
	if (capability.source.kind === "recipe-preset") {
		return frameRecipePresetUsage(capability, payloads);
	}
	if (capability.source.kind === "influence-control") {
		return frameInfluenceUsage(payloads);
	}
	if (capability.stackPhases.some((phase) => phase === "node-recipe")) {
		return nodeRecipeUsage(capability, payloads);
	}
	if (capability.stackPhases.some((phase) => phase === "frame-recipe")) {
		return frameRecipeUsage(capability, payloads);
	}
	return { targetCount: 0, affectedTargets: [] };
};

const manifestEntryForCapability = (
	capability: EffectCapabilityDescriptor,
	payloads: readonly VecCoreRecipePayload[],
): ExportEffectCapabilityManifestEntry => {
	const usage = capabilityUsage(capability, payloads);
	return {
		id: capability.id,
		label: capability.label,
		source: capability.source,
		targetScopes: capability.targetScopes,
		stackPhases: capability.stackPhases,
		control: {
			valueKind: capability.control.valueKind,
			keyframable: capability.control.keyframable,
			expressionBindable: capability.control.expressionBindable,
			...(capability.control.advanced !== undefined
				? { advanced: capability.control.advanced }
				: {}),
		},
		support: capability.support,
		active: usage.targetCount > 0,
		activeTargetCount: usage.targetCount,
		affectedTargets: usage.affectedTargets,
	};
};

/**
 * Creates a deterministic manifest that tells generated code which authored
 * vec-core look controls are present and how each runtime/export surface carries
 * them. Empty bundles omit the section to avoid implying look fidelity work when
 * no recipe side-car was exported.
 */
export function createExportEffectCapabilitiesManifest(
	payloads: readonly VecCoreRecipePayload[],
): ExportEffectCapabilitiesManifest | undefined {
	if (payloads.length === 0) return undefined;
	const capabilities = EFFECT_CAPABILITY_DESCRIPTORS.map((capability) =>
		manifestEntryForCapability(capability, payloads),
	);
	const activeCapabilities = capabilities.filter(
		(capability) => capability.active,
	);
	const expressionBindableCapabilities = capabilities.filter(
		(capability) => capability.control.expressionBindable,
	);
	return {
		included: true,
		contractVersion: 1,
		capabilityCount: capabilities.length,
		activeCapabilityCount: activeCapabilities.length,
		activeCapabilityIds: activeCapabilities.map((capability) => capability.id),
		expressionBindableCapabilityCount: expressionBindableCapabilities.length,
		activeExpressionBindableCapabilityIds: activeCapabilities
			.filter((capability) => capability.control.expressionBindable)
			.map((capability) => capability.id),
		affectedTargets: sortedUniqueAffectedTargets(
			activeCapabilities.flatMap((capability) => capability.affectedTargets),
		),
		capabilities,
	};
}
