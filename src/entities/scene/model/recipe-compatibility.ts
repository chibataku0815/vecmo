import {
	normalizeVisualRecipe,
	type VisualRecipe,
	type VisualRecipeDraft,
} from "@/shared/vec-core";
import type { SceneDocument, SceneLayer, VectorNode } from "./types";

type RecipeShape = "canonical" | "legacy" | "draft" | "invalid";

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const hasOwn = (
	value: Readonly<Record<string, unknown>>,
	key: string,
): boolean => Object.hasOwn(value, key);

const recordAt = (
	value: Readonly<Record<string, unknown>>,
	key: string,
): Readonly<Record<string, unknown>> | null => {
	const next = value[key];
	return isRecord(next) ? next : null;
};

const hasCanonicalRecipeShape = (
	value: Readonly<Record<string, unknown>>,
): boolean => {
	const color = recordAt(value, "color");
	const texture = recordAt(value, "texture");
	const glow = recordAt(value, "glow");
	const optics = recordAt(value, "optics");

	return Boolean(
		color &&
			(color.tint === undefined || typeof color.tint === "number") &&
			texture &&
			isRecord(texture.grain) &&
			!hasOwn(texture, "noiseScale") &&
			glow &&
			isRecord(glow.bloom) &&
			!hasOwn(glow, "radius") &&
			optics &&
			!hasOwn(optics, "chromaticAberration"),
	);
};

const hasLegacyRecipeShape = (
	value: Readonly<Record<string, unknown>>,
): boolean => {
	const color = recordAt(value, "color");
	const surface = recordAt(value, "surface");
	const texture = recordAt(value, "texture");
	const glow = recordAt(value, "glow");
	const optics = recordAt(value, "optics");

	return Boolean(
		(color &&
			(typeof color.tint === "string" ||
				color.tint === null ||
				color.tint === undefined)) ||
			(surface && (surface.paint === "flat" || surface.paint === "source")) ||
			(texture &&
				(typeof texture.grain === "number" || hasOwn(texture, "noiseScale"))) ||
			(glow && (typeof glow.bloom === "number" || hasOwn(glow, "radius"))) ||
			(optics && hasOwn(optics, "chromaticAberration")),
	);
};

const recipeShape = (value: unknown): RecipeShape => {
	if (!isRecord(value)) return "invalid";
	if (hasCanonicalRecipeShape(value)) return "canonical";
	if (hasLegacyRecipeShape(value)) return "legacy";
	return "draft";
};

const normalizeNodeRecipe = (value: unknown): VisualRecipe => {
	const shape = recipeShape(value);
	if (shape === "invalid") return normalizeVisualRecipe();
	return normalizeVisualRecipe(value as VisualRecipeDraft);
};

const normalizeVectorNodeRecipes = (node: VectorNode): VectorNode => {
	const normalizedChildren = node.children?.map(normalizeVectorNodeRecipes);
	const normalizedRecipe =
		node.recipe === undefined ? undefined : normalizeNodeRecipe(node.recipe);

	return {
		...node,
		...(normalizedRecipe === undefined ? {} : { recipe: normalizedRecipe }),
		...(normalizedChildren === undefined
			? {}
			: { children: normalizedChildren }),
	};
};

const normalizeSceneLayerRecipes = (layer: SceneLayer): SceneLayer => ({
	...layer,
	nodes: layer.nodes.map(normalizeVectorNodeRecipes),
});

/**
 * Canonicalizes node-level vec-core recipes after document validation but before
 * editor hydration. VMA's old recipe payload and upstream vec-core both used
 * `schemaVersion: 3`, so this walk intentionally detects compatibility by
 * field shape and delegates value clamping/defaults to the vec-core normalizer.
 */
export function normalizeSceneDocumentVectorRecipes(
	document: SceneDocument,
): SceneDocument {
	return {
		...document,
		layers: document.layers.map(normalizeSceneLayerRecipes),
	};
}
