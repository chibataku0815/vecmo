import {
	type EffectInfluenceRecipe,
	type EffectInfluenceRecipeDraft,
	normalizeEffectInfluenceRecipe,
} from "@/shared/vec-core";

export const DEFAULT_FRAME_INFLUENCE_ASSIGNMENT_ID =
	"inspector-frame-soft-mask";

const DEFAULT_FRAME_INFLUENCE_RECIPE_DRAFT = {
	enabled: true,
	assignments: [
		{
			id: DEFAULT_FRAME_INFLUENCE_ASSIGNMENT_ID,
			label: "Radial soft mask",
			target: { scope: "scene" },
			effect: {
				id: "bloom",
				path: "recipe.glow.bloom",
				label: "Bloom",
			},
			influence: {
				enabled: true,
				source: {
					kind: "radialGradient",
					space: "target",
					cx: 0.5,
					cy: 0.5,
					radius: 0.46,
					rx: 0.46,
					ry: 0.46,
				},
				strength: 0.7,
				featherRadius: 0.08,
				falloff: { kind: "smoothstep", softness: 0.35 },
			},
		},
	],
} as const satisfies EffectInfluenceRecipeDraft;

/**
 * Returns the canonical first frame-influence recipe used when an authoring path
 * writes strength/feather before a user has explicitly created a mask.
 */
export const defaultFrameInfluenceRecipe = (): EffectInfluenceRecipe =>
	normalizeEffectInfluenceRecipe(DEFAULT_FRAME_INFLUENCE_RECIPE_DRAFT);
