import {
	type ChromaticAberrationParams,
	computeChromaticAberration,
	computeFilmGrain,
	DEFAULT_CHROMATIC_ABERRATION_MAX_SHIFT_PX,
	type FilmGrainParams,
	NEUTRAL_VISUAL_RECIPE,
	VECMO_CHROMATIC_ABERRATION_MAX_SHIFT_METADATA_KEY,
	type VisualRecipe,
} from "@/shared/vec-core";
import { visualRecipeFromEffectLayerStack } from "./effect-layer-stack";
import type { LookGraph, LookGraphDraft } from "./look-graph";
import { lookGraphToEffectLayerStack } from "./look-graph-project";

/**
 * Extracts the same frame-level film-grain pass parameters the live canvas uses.
 * A null result means this recipe has no visible grain pass in the current SVG
 * canvas implementation.
 */
export const frameFilmGrainParams = (
	recipe: VisualRecipe | null,
): FilmGrainParams | null => (recipe ? computeFilmGrain(recipe) : null);

const recipeChromaticAberrationMaxShift = (recipe: VisualRecipe): number => {
	const value =
		recipe.metadata[VECMO_CHROMATIC_ABERRATION_MAX_SHIFT_METADATA_KEY];
	return typeof value === "number" && Number.isFinite(value) && value >= 0
		? value
		: DEFAULT_CHROMATIC_ABERRATION_MAX_SHIFT_PX;
};

/**
 * Extracts the same frame-level chromatic-aberration pass parameters the live
 * canvas uses, including the recipe metadata override for max channel shift.
 */
export const frameChromaticAberrationParams = (
	recipe: VisualRecipe | null,
): ChromaticAberrationParams | null =>
	recipe
		? computeChromaticAberration(
				recipe,
				recipeChromaticAberrationMaxShift(recipe),
			)
		: null;

/**
 * Returns the legacy frame chromatic-aberration params only when that is the
 * recipe's sole live frame-film pass. GPU canvas S17 can reproduce this one
 * SourceGraphic-only pass in WGSL; grain or any future additional frame-film
 * pass must keep using the SVG/canvas fallback until modeled explicitly.
 */
export const frameChromaticAberrationOnlyParams = (
	recipe: VisualRecipe | null,
): ChromaticAberrationParams | null => {
	const params = frameChromaticAberrationParams(recipe);
	if (!params || frameFilmGrainParams(recipe)) return null;
	return params;
};

export type FrameGpuFilmPostEffectParams = {
	readonly grain: FilmGrainParams | null;
	readonly chromaticAberration: ChromaticAberrationParams | null;
};

/**
 * Returns the legacy frame-film passes the GPU canvas can reproduce as
 * SourceGraphic postprocesses. S18 models the same live frame-film pair the SVG
 * frame path owns today: grain and chromatic aberration. Explicit Look graphs,
 * masks/influence, layer stacks, and scoped Looks are intentionally checked by
 * the caller because their projection semantics are outside the legacy recipe
 * itself.
 */
export const frameGpuFilmPostEffectParams = (
	recipe: VisualRecipe | null,
): FrameGpuFilmPostEffectParams | null => {
	const grain = frameFilmGrainParams(recipe);
	const chromaticAberration = frameChromaticAberrationParams(recipe);
	if (!grain && !chromaticAberration) return null;
	return { grain, chromaticAberration };
};

const nonFrameFilmPayload = (recipe: VisualRecipe): object => ({
	intent: recipe.intent,
	alphaMode: recipe.alphaMode,
	color: recipe.color,
	surface: recipe.surface,
	glow: recipe.glow,
	motion: recipe.motion,
	shadow: recipe.shadow,
	distortion: recipe.distortion,
	stylization: recipe.stylization,
});

const recipeHasOnlyFrameFilmOutput = (recipe: VisualRecipe): boolean =>
	JSON.stringify(nonFrameFilmPayload(recipe)) ===
	JSON.stringify(nonFrameFilmPayload(NEUTRAL_VISUAL_RECIPE));

/**
 * Projects the explicit LookGraph subset the GPU frame-film path can render
 * today. S26 admitted the smallest Source -> Grain -> Output graph. S28 keeps
 * using the same serial stack projection but allows neutral/disabled P0 layers
 * around the grain node, which is the shape produced when a legacy frame recipe
 * enters graph-first authoring as Source -> Glow -> Grain -> Grade -> Output.
 *
 * Visible grade/glow, branches, masks, composites, and non-projectable graph
 * nodes still stay on SVG: the WebGPU canvas owns only the legacy frame-film
 * grain/CA pass family here, not the full LookGraph raster runtime.
 */
export const explicitFrameFilmLookGraphRecipe = (
	graph: LookGraph | LookGraphDraft | null | undefined,
): VisualRecipe | null => {
	const stack = lookGraphToEffectLayerStack(graph);
	const recipe = visualRecipeFromEffectLayerStack(stack);
	if (!recipe || !recipeHasOnlyFrameFilmOutput(recipe)) return null;
	return frameGpuFilmPostEffectParams(recipe) ? recipe : null;
};

/**
 * Reports whether a legacy frame visual recipe has any visible pass in the live
 * canvas frame-look path. Capability uses this to avoid treating neutral recipe
 * metadata as a GPU-blocking frame look while still failing closed for the
 * currently renderable frame-film passes.
 */
export const frameVisualRecipeCanRenderVisibly = (
	recipe: VisualRecipe,
): boolean =>
	frameFilmGrainParams(recipe) !== null ||
	frameChromaticAberrationParams(recipe) !== null;
