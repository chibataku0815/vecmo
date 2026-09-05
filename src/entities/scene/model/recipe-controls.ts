import {
	legacyGlowBloomValue,
	legacyGlowRadiusToCanonical,
	legacyGlowRadiusValue,
	legacyRgbSplitToCanonical,
	legacyRgbSplitValue,
	legacyTextureGrainValue,
	legacyTextureNoiseScaleToGrainSize,
	legacyTextureNoiseScaleValue,
	NEUTRAL_VISUAL_RECIPE,
	normalizeVisualRecipe,
	type RecipeScalar,
	resolveTextureParticleLinearField,
	textureParticleFieldMode,
	textureParticleLinearFieldAngle,
	textureParticleLinearFieldEffective,
	textureParticleLinearFieldExtent,
	textureParticleLinearFieldWithAngle,
	type VisualRecipe,
	type VisualRecipeDraft,
} from "@/shared/vec-core";

export const RECIPE_MIXED_VALUE = "mixed" as const;

export type RecipeMixedValue<T> = T | typeof RECIPE_MIXED_VALUE;

export type RecipeControlKind = "number" | "boolean" | "enum";

export type RecipeControlValue = RecipeScalar;

export type RecipeControlSpec = {
	readonly path: string;
	readonly label: string;
	readonly kind: RecipeControlKind;
	readonly min?: number;
	readonly max?: number;
	readonly step?: number;
	readonly options?: readonly string[];
	readonly activates?: readonly {
		readonly path: string;
		readonly when: (value: RecipeControlValue) => boolean;
	}[];
};

const identity = (value: number): number => value;

export const RECIPE_CONTROL_SPECS = /* @__PURE__ */ (() =>
	[
		{
			path: "color.exposure",
			label: "Exposure",
			kind: "number",
			min: -4,
			max: 4,
			step: 0.01,
		},
		{
			path: "color.contrast",
			label: "Contrast",
			kind: "number",
			min: 0,
			max: 4,
			step: 0.01,
		},
		{
			path: "color.saturation",
			label: "Saturation",
			kind: "number",
			min: 0,
			max: 4,
			step: 0.01,
		},
		{
			path: "color.temperature",
			label: "Temperature",
			kind: "number",
			min: -1,
			max: 1,
			step: 0.01,
		},
		{
			path: "color.tint",
			label: "Tint",
			kind: "number",
			min: -1,
			max: 1,
			step: 0.01,
		},
		{
			path: "color.density",
			label: "Density",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "color.printContrast",
			label: "Print contrast",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "color.cmy.cyan",
			label: "Cyan",
			kind: "number",
			min: -1,
			max: 1,
			step: 0.01,
		},
		{
			path: "color.cmy.magenta",
			label: "Magenta",
			kind: "number",
			min: -1,
			max: 1,
			step: 0.01,
		},
		{
			path: "color.cmy.yellow",
			label: "Yellow",
			kind: "number",
			min: -1,
			max: 1,
			step: 0.01,
		},
		{
			path: "texture.grain.enabled",
			label: "Grain enabled",
			kind: "boolean",
		},
		{
			path: "texture.grain.strength",
			label: "Grain strength",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
			activates: [
				{
					path: "texture.grain.enabled",
					when: (value) => typeof value === "number" && value > 0,
				},
			],
		},
		{
			path: "texture.grain.size",
			label: "Grain size",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "texture.grain.character",
			label: "Grain character",
			kind: "enum",
			options: ["neutral", "soft", "clump", "pepper", "crystal"],
		},
		{
			path: "texture.grain.densityCoupling",
			label: "Density coupling",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "texture.grain.temporalStability",
			label: "Temporal stability",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "texture.grain.seed",
			label: "Grain seed",
			kind: "number",
			min: 0,
			max: 999999,
			step: 1,
		},
		{
			path: "texture.grain.fusionMode",
			label: "Grain fusion",
			kind: "enum",
			options: ["additive", "overlay", "softLight"],
		},
		{
			path: "texture.grain.chroma",
			label: "Grain chroma",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "texture.material.mode",
			label: "Material mode",
			kind: "enum",
			options: ["off", "density", "dye", "particle", "mixed"],
		},
		{
			path: "texture.material.strength",
			label: "Material strength",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "texture.material.dyeShift",
			label: "Dye shift",
			kind: "number",
			min: -1,
			max: 1,
			step: 0.01,
		},
		{
			path: "texture.material.particleContrast",
			label: "Particle contrast",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "texture.material.fieldMode",
			label: "Particle field",
			kind: "enum",
			options: ["contour", "linear", "mesh"],
		},
		{
			path: "texture.material.angle",
			label: "Particle angle",
			kind: "number",
			min: 0,
			max: 360,
			step: 1,
		},
		{
			path: "texture.material.linearField.x1",
			label: "Particle linear X1",
			kind: "number",
			min: -2,
			max: 3,
			step: 0.01,
		},
		{
			path: "texture.material.linearField.y1",
			label: "Particle linear Y1",
			kind: "number",
			min: -2,
			max: 3,
			step: 0.01,
		},
		{
			path: "texture.material.linearField.x2",
			label: "Particle linear X2",
			kind: "number",
			min: -2,
			max: 3,
			step: 0.01,
		},
		{
			path: "texture.material.linearField.y2",
			label: "Particle linear Y2",
			kind: "number",
			min: -2,
			max: 3,
			step: 0.01,
		},
		{
			path: "texture.material.linearField.plateau",
			label: "Particle linear plateau",
			kind: "number",
			min: 0,
			max: 0.99,
			step: 0.01,
		},
		{
			path: "texture.material.alphaMatte.kind",
			label: "Alpha matte kind",
			kind: "enum",
			options: ["linearGradient", "radialGradient"],
		},
		{
			path: "texture.material.alphaMatte.x1",
			label: "Alpha matte X1",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "texture.material.alphaMatte.y1",
			label: "Alpha matte Y1",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "texture.material.alphaMatte.x2",
			label: "Alpha matte X2",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "texture.material.alphaMatte.y2",
			label: "Alpha matte Y2",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "texture.material.alphaMatte.cx",
			label: "Alpha matte CX",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "texture.material.alphaMatte.cy",
			label: "Alpha matte CY",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "texture.material.alphaMatte.rx",
			label: "Alpha matte RX",
			kind: "number",
			min: 0.001,
			max: 1,
			step: 0.01,
		},
		{
			path: "texture.material.alphaMatte.ry",
			label: "Alpha matte RY",
			kind: "number",
			min: 0.001,
			max: 1,
			step: 0.01,
		},
		{
			path: "texture.material.alphaMatte.rotation",
			label: "Alpha matte rotation",
			kind: "number",
			min: 0,
			max: 6.283185307179586,
			step: 0.01,
		},
		{
			path: "texture.material.alphaMatte.feather",
			label: "Alpha matte feather",
			kind: "number",
			min: 0.02,
			max: 1,
			step: 0.01,
		},
		{
			path: "glow.bloom.strength",
			label: "Bloom strength",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "glow.bloom.threshold",
			label: "Bloom threshold",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "glow.bloom.radius",
			label: "Bloom radius",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "glow.bloom.softKnee",
			label: "Bloom soft knee",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "glow.bloom.colorResponse",
			label: "Bloom color response",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "glow.halation.strength",
			label: "Halation strength",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "glow.halation.threshold",
			label: "Halation threshold",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "glow.halation.radius",
			label: "Halation radius",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "glow.halation.hue",
			label: "Halation hue",
			kind: "number",
			min: 0,
			max: 360,
			step: 1,
		},
		{
			path: "glow.diffusion.strength",
			label: "Diffusion strength",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "glow.diffusion.radius",
			label: "Diffusion radius",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "glow.lightShafts.strength",
			label: "Light shafts",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "glow.lightShafts.decay",
			label: "Light shaft decay",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "glow.lightShafts.originX",
			label: "Light shaft origin X",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "glow.lightShafts.originY",
			label: "Light shaft origin Y",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "optics.lensSoftness",
			label: "Lens softness",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "optics.vignette",
			label: "Vignette",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "optics.chromaticFringing",
			label: "Chromatic fringing",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "optics.rayAngleWeight",
			label: "Ray angle weight",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "optics.crossFilter.strength",
			label: "Cross filter strength",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "optics.crossFilter.points",
			label: "Cross filter points",
			kind: "number",
			min: 4,
			max: 12,
			step: 1,
		},
		{
			path: "optics.crossFilter.length",
			label: "Cross filter length",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "optics.crossFilter.angle",
			label: "Cross filter angle",
			kind: "number",
			min: 0,
			max: 360,
			step: 1,
		},
		{
			path: "optics.haloPrism.strength",
			label: "Halo prism strength",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "optics.haloPrism.radius",
			label: "Halo prism radius",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "optics.haloPrism.width",
			label: "Halo prism width",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "optics.haloPrism.chromatic",
			label: "Halo prism chromatic",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "surface.shade.enabled",
			label: "Shade enabled",
			kind: "boolean",
		},
		{
			path: "surface.shade.strength",
			label: "Shade strength",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "surface.shade.softness",
			label: "Shade softness",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "surface.shade.angle",
			label: "Shade angle",
			kind: "number",
			min: 0,
			max: Math.PI * 2,
			step: 0.01,
		},
		{
			path: "surface.shade.offset",
			label: "Shade offset",
			kind: "number",
			min: -1,
			max: 1,
			step: 0.01,
		},
		{
			path: "motion.fps",
			label: "Recipe FPS",
			kind: "number",
			min: 1,
			max: 240,
			step: 1,
		},
		{
			path: "motion.temporalSeedMode",
			label: "Temporal seed",
			kind: "enum",
			options: ["fixed", "frame", "time"],
		},
		{
			path: "motion.shutterAngle",
			label: "Shutter angle",
			kind: "number",
			min: 0,
			max: 720,
			step: 1,
		},
		{
			path: "motion.breath",
			label: "Breath",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "shadow.drop.enabled",
			label: "Drop shadow enabled",
			kind: "boolean",
		},
		{
			path: "shadow.drop.offsetX",
			label: "Drop shadow X",
			kind: "number",
			min: -1,
			max: 1,
			step: 0.01,
		},
		{
			path: "shadow.drop.offsetY",
			label: "Drop shadow Y",
			kind: "number",
			min: -1,
			max: 1,
			step: 0.01,
		},
		{
			path: "shadow.drop.blur",
			label: "Drop shadow blur",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "shadow.drop.opacity",
			label: "Drop shadow opacity",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "shadow.drop.mode",
			label: "Drop shadow mode",
			kind: "enum",
			options: ["behind", "knockout"],
		},
		{
			path: "shadow.inner.enabled",
			label: "Inner shadow enabled",
			kind: "boolean",
		},
		{
			path: "shadow.inner.offsetX",
			label: "Inner shadow X",
			kind: "number",
			min: -1,
			max: 1,
			step: 0.01,
		},
		{
			path: "shadow.inner.offsetY",
			label: "Inner shadow Y",
			kind: "number",
			min: -1,
			max: 1,
			step: 0.01,
		},
		{
			path: "shadow.inner.blur",
			label: "Inner shadow blur",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "shadow.inner.opacity",
			label: "Inner shadow opacity",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "shadow.ambient.enabled",
			label: "Ambient shadow enabled",
			kind: "boolean",
		},
		{
			path: "shadow.ambient.strength",
			label: "Ambient shadow strength",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "shadow.ambient.radius",
			label: "Ambient shadow radius",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "distortion.wave.enabled",
			label: "Wave enabled",
			kind: "boolean",
		},
		{
			path: "distortion.wave.strength",
			label: "Wave strength",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "distortion.wave.frequency",
			label: "Wave frequency",
			kind: "number",
			min: 0,
			max: 32,
			step: 0.01,
		},
		{
			path: "distortion.wave.axis",
			label: "Wave axis",
			kind: "enum",
			options: ["horizontal", "vertical", "radial"],
		},
		{
			path: "distortion.wave.phase",
			label: "Wave phase",
			kind: "number",
			min: 0,
			max: Math.PI * 2,
			step: 0.01,
		},
		{
			path: "distortion.warp.enabled",
			label: "Warp enabled",
			kind: "boolean",
		},
		{
			path: "distortion.warp.strength",
			label: "Warp strength",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "distortion.warp.kind",
			label: "Warp kind",
			kind: "enum",
			options: ["barrel", "pincushion", "twirl"],
		},
		{
			path: "distortion.warp.centerX",
			label: "Warp center X",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "distortion.warp.centerY",
			label: "Warp center Y",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "distortion.displacement.enabled",
			label: "Displacement enabled",
			kind: "boolean",
		},
		{
			path: "distortion.displacement.strength",
			label: "Displacement strength",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "distortion.displacement.scale",
			label: "Displacement scale",
			kind: "number",
			min: 0.25,
			max: 8,
			step: 0.01,
		},
		{
			path: "distortion.displacement.seed",
			label: "Displacement seed",
			kind: "number",
			step: 1,
		},
		{
			path: "stylization.posterize.enabled",
			label: "Posterize enabled",
			kind: "boolean",
		},
		{
			path: "stylization.posterize.levels",
			label: "Posterize levels",
			kind: "number",
			min: 2,
			max: 32,
			step: 1,
		},
		{
			path: "stylization.halftone.enabled",
			label: "Halftone enabled",
			kind: "boolean",
		},
		{
			path: "stylization.halftone.cellSize",
			label: "Halftone cell size",
			kind: "number",
			min: 0.001,
			max: 0.1,
			step: 0.001,
		},
		{
			path: "stylization.halftone.angle",
			label: "Halftone angle",
			kind: "number",
			min: 0,
			max: Math.PI * 2,
			step: 0.01,
		},
		{
			path: "stylization.halftone.shape",
			label: "Halftone shape",
			kind: "enum",
			options: ["dot", "line", "cross"],
		},
		{
			path: "stylization.dither.enabled",
			label: "Dither enabled",
			kind: "boolean",
		},
		{
			path: "stylization.dither.pattern",
			label: "Dither pattern",
			kind: "enum",
			options: ["bayer", "blue-noise", "error-diffusion"],
		},
		{
			path: "stylization.dither.strength",
			label: "Dither strength",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "stylization.contour.enabled",
			label: "Contour enabled",
			kind: "boolean",
		},
		{
			path: "stylization.contour.threshold",
			label: "Contour threshold",
			kind: "number",
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			path: "stylization.contour.thickness",
			label: "Contour thickness",
			kind: "number",
			min: 0,
			max: 0.05,
			step: 0.001,
		},
	] as const satisfies readonly RecipeControlSpec[])();

export type RecipeControlPath = (typeof RECIPE_CONTROL_SPECS)[number]["path"];

export type RecipePathPatch = {
	readonly path: RecipeControlPath;
	readonly value: RecipeControlValue;
};

export type RecipePathPatchDraft =
	| {
			readonly kind: "ready";
			readonly spec: RecipeControlSpecForPath;
			readonly patch: RecipePathPatch;
	  }
	| {
			readonly kind: "invalid-path";
			readonly path: string;
	  }
	| {
			readonly kind: "invalid-value";
			readonly path: RecipeControlPath;
			readonly value: unknown;
			readonly reason: string;
	  };

export type RecipePathPatchResult =
	| {
			readonly kind: "applied";
			readonly recipe: VisualRecipe;
			readonly patch: RecipePathPatch;
	  }
	| {
			readonly kind: "unchanged";
			readonly recipe: VisualRecipe;
			readonly patch: RecipePathPatch;
	  }
	| {
			readonly kind: "invalid-path";
			readonly recipe: VisualRecipe;
			readonly path: string;
	  }
	| {
			readonly kind: "invalid-value";
			readonly recipe: VisualRecipe;
			readonly path: RecipeControlPath;
			readonly value: unknown;
			readonly reason: string;
	  };

export type RecipeSelectionControlValue =
	| {
			readonly kind: "empty";
			readonly path: RecipeControlPath;
			readonly value: null;
	  }
	| {
			readonly kind: "value";
			readonly path: RecipeControlPath;
			readonly value: RecipeControlValue;
	  }
	| {
			readonly kind: "mixed";
			readonly path: RecipeControlPath;
			readonly value: typeof RECIPE_MIXED_VALUE;
	  }
	| {
			readonly kind: "invalid-path";
			readonly path: string;
			readonly value: null;
	  };

type RecipeControlSpecForPath = RecipeControlSpec;

type LegacyRecipeScalarControl = {
	readonly path: RecipeControlPath;
	readonly read: (recipe: VisualRecipe) => number;
	readonly toCanonical: (value: number) => number;
};

export const LEGACY_RECIPE_SCALAR_CONTROLS = {
	grain: {
		path: "texture.grain.strength",
		read: (recipe) => legacyTextureGrainValue(recipe.texture),
		toCanonical: identity,
	},
	noiseScale: {
		path: "texture.grain.size",
		read: (recipe) => legacyTextureNoiseScaleValue(recipe.texture),
		toCanonical: legacyTextureNoiseScaleToGrainSize,
	},
	saturation: {
		path: "color.saturation",
		read: (recipe) => recipe.color.saturation,
		toCanonical: identity,
	},
	exposure: {
		path: "color.exposure",
		read: (recipe) => recipe.color.exposure,
		toCanonical: identity,
	},
	contrast: {
		path: "color.contrast",
		read: (recipe) => recipe.color.contrast,
		toCanonical: identity,
	},
	glowBloom: {
		path: "glow.bloom.strength",
		read: (recipe) => legacyGlowBloomValue(recipe.glow),
		toCanonical: identity,
	},
	glowRadius: {
		path: "glow.bloom.radius",
		read: (recipe) => legacyGlowRadiusValue(recipe.glow),
		toCanonical: legacyGlowRadiusToCanonical,
	},
	rgbSplit: {
		path: "optics.chromaticFringing",
		read: (recipe) => legacyRgbSplitValue(recipe.optics),
		toCanonical: legacyRgbSplitToCanonical,
	},
} as const satisfies Readonly<Record<string, LegacyRecipeScalarControl>>;

export type LegacyRecipeScalarField =
	keyof typeof LEGACY_RECIPE_SCALAR_CONTROLS;

/**
 * `@__PURE__`-IIFE-wrapped so a bundler that never reaches a consumer of this
 * lookup (every LEAN/FLAT runtime-sampler tier) can tree-shake it away, same
 * reasoning as `bindable-property.ts`'s `BINDABLE_PROPERTY_BY_ID`: annotating
 * `new Map` alone would not suffice since its `.map(...)` argument is its own
 * unannotated call, evaluated regardless of whether the result is used.
 * `RECIPE_CONTROL_SPECS` itself is a plain array of object literals (no calls
 * inside), so it was already prunable on its own; only this derived Map
 * needed the fix.
 */
const RECIPE_CONTROL_SPEC_BY_PATH: ReadonlyMap<string, RecipeControlSpec> =
	/* @__PURE__ */ (() =>
		new Map(RECIPE_CONTROL_SPECS.map((spec) => [spec.path, spec])))();

const isRecipeControlPath = (path: string): path is RecipeControlPath =>
	RECIPE_CONTROL_SPEC_BY_PATH.has(path);

const specForPath = (path: RecipeControlPath): RecipeControlSpecForPath => {
	const spec = RECIPE_CONTROL_SPEC_BY_PATH.get(path);
	if (!spec) {
		throw new Error(`Missing recipe control spec for ${path}.`);
	}
	return spec;
};

/**
 * Returns the registered vec-core control metadata for UI adapters. Unknown
 * paths stay a typed absence so host panels cannot accidentally mint ad hoc
 * recipe fields while rendering compact path-driven controls.
 */
export function recipeControlSpecForPath(
	path: string,
): RecipeControlSpec | null {
	return RECIPE_CONTROL_SPEC_BY_PATH.get(path) ?? null;
}

const isObjectRecord = (
	value: unknown,
): value is Readonly<Record<string, unknown>> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const sameJson = (left: unknown, right: unknown): boolean =>
	JSON.stringify(left) === JSON.stringify(right);

const valueAtPath = (value: unknown, segments: readonly string[]): unknown => {
	if (segments.length === 0) return value;
	if (!isObjectRecord(value)) return undefined;
	const [head, ...tail] = segments;
	if (head === undefined) return undefined;
	return valueAtPath(value[head], tail);
};

const withValueAtPath = (
	value: unknown,
	segments: readonly string[],
	nextValue: unknown,
): unknown => {
	if (segments.length === 0) return nextValue;
	const [head, ...tail] = segments;
	if (head === undefined) return value;
	if (!isObjectRecord(value)) {
		return {
			[head]: withValueAtPath(undefined, tail, nextValue),
		};
	}
	return {
		...value,
		[head]: withValueAtPath(value[head], tail, nextValue),
	};
};

const setControlPath = (
	recipe: VisualRecipe,
	path: string,
	value: unknown,
): VisualRecipeDraft => {
	const segments = path.split(".");
	return withValueAtPath(recipe, segments, value) as VisualRecipeDraft;
};

const DEFAULT_ALPHA_MATTE_FEATHER = 0.24;

const alphaMatteStopsForFeather = (feather: number) => {
	const clamped = Math.min(1, Math.max(0.02, feather));
	return clamped >= 0.995
		? ([
				{ offset: 0, alpha: 1 },
				{ offset: 1, alpha: 0 },
			] as const)
		: ([
				{ offset: 0, alpha: 1 },
				{ offset: Math.max(0, 1 - clamped), alpha: 1 },
				{ offset: 1, alpha: 0 },
			] as const);
};

const alphaMatteFeatherValue = (recipe: VisualRecipe): number => {
	const matte = recipe.texture.material.alphaMatte;
	if (!matte || !("stops" in matte) || matte.stops.length < 2) {
		return DEFAULT_ALPHA_MATTE_FEATHER;
	}
	const lastOpaqueOffset = matte.stops.reduce(
		(maxOffset, stop) =>
			stop.alpha >= 0.98 ? Math.max(maxOffset, stop.offset) : maxOffset,
		0,
	);
	return Math.round((1 - lastOpaqueOffset) * 1000) / 1000;
};

/**
 * `@__PURE__`-annotated, same reason as `bindable-property.ts`'s
 * `strokeBlurProperty`: a single top-level call, unused in LEAN/FLAT once
 * nothing there calls the `alphaMatteDraftForKind`-adjacent functions that
 * read this.
 */
const DEFAULT_ALPHA_MATTE_STOPS = /* @__PURE__ */ alphaMatteStopsForFeather(
	DEFAULT_ALPHA_MATTE_FEATHER,
);

const alphaMatteDraftForKind = (kind: RecipeControlValue): unknown | null => {
	if (kind === "linearGradient") {
		return {
			kind,
			space: "target",
			x1: 1,
			y1: 0.5,
			x2: 0,
			y2: 0.5,
			stops: DEFAULT_ALPHA_MATTE_STOPS,
		};
	}
	if (kind === "radialGradient") {
		return {
			kind,
			space: "target",
			cx: 0.5,
			cy: 0.5,
			radius: 0.5,
			rx: 0.5,
			ry: 0.5,
			rotation: 0,
			stops: DEFAULT_ALPHA_MATTE_STOPS,
		};
	}
	return null;
};

const setAlphaMatteKind = (
	recipe: VisualRecipe,
	kind: RecipeControlValue,
): VisualRecipeDraft => {
	const alphaMatte = alphaMatteDraftForKind(kind);
	return alphaMatte
		? setControlPath(recipe, "texture.material.alphaMatte", alphaMatte)
		: setControlPath(recipe, "texture.material.alphaMatte.kind", kind);
};

const setAlphaMatteFeather = (
	recipe: VisualRecipe,
	value: RecipeControlValue,
): VisualRecipeDraft => {
	const feather =
		typeof value === "number" && Number.isFinite(value)
			? value
			: DEFAULT_ALPHA_MATTE_FEATHER;
	const currentMatte =
		recipe.texture.material.alphaMatte ??
		alphaMatteDraftForKind("radialGradient");
	const alphaMatte = isObjectRecord(currentMatte)
		? {
				...currentMatte,
				stops: alphaMatteStopsForFeather(feather),
			}
		: alphaMatteDraftForKind("radialGradient");
	return setControlPath(recipe, "texture.material.alphaMatte", alphaMatte);
};

const normalizeInputValue = (
	spec: RecipeControlSpec,
	value: unknown,
): RecipeControlValue | null => {
	if (spec.kind === "number") {
		return typeof value === "number" && Number.isFinite(value) ? value : null;
	}
	if (spec.kind === "boolean") return typeof value === "boolean" ? value : null;
	if (typeof value !== "string") return null;
	return spec.options?.includes(value) ? value : null;
};

const invalidValueReason = (spec: RecipeControlSpec): string => {
	if (spec.kind === "enum") {
		return `Expected one of ${spec.options?.join(", ") ?? "the enum options"}.`;
	}
	return `Expected a ${spec.kind} value.`;
};

const normalizeRecipeSource = (
	recipe: VisualRecipeDraft | null | undefined,
): VisualRecipe => normalizeVisualRecipe(recipe ?? NEUTRAL_VISUAL_RECIPE);

/**
 * Creates a validated patch for one canonical vec-core recipe path. The adapter
 * rejects unknown paths before mutation so UI controls cannot persist ad hoc
 * scalar fields such as legacy Inspector names.
 */
export function createRecipePathPatch(
	path: string,
	value: unknown,
): RecipePathPatchDraft {
	if (!isRecipeControlPath(path)) return { kind: "invalid-path", path };
	const spec = specForPath(path);
	const normalizedValue = normalizeInputValue(spec, value);
	if (normalizedValue === null) {
		return {
			kind: "invalid-value",
			path,
			value,
			reason: invalidValueReason(spec),
		};
	}
	return {
		kind: "ready",
		spec,
		patch: { path, value: normalizedValue },
	};
}

/**
 * Applies a canonical path patch and normalizes the whole recipe afterwards.
 * Normalization clamps ranges and preserves the vec-core contract as the only
 * persisted shape; invalid patches are typed no-ops against the input recipe.
 */
export function applyRecipePathPatch(
	recipe: VisualRecipeDraft | null | undefined,
	patch: RecipePathPatchDraft | RecipePathPatch,
): RecipePathPatchResult {
	const current = normalizeRecipeSource(recipe);
	if ("kind" in patch && patch.kind !== "ready") {
		if (patch.kind === "invalid-path") {
			return { kind: "invalid-path", recipe: current, path: patch.path };
		}
		return {
			kind: "invalid-value",
			recipe: current,
			path: patch.path,
			value: patch.value,
			reason: patch.reason,
		};
	}
	const readyPatch = "kind" in patch ? patch.patch : patch;
	const spec = specForPath(readyPatch.path);
	let withPrimaryValue: VisualRecipeDraft;
	if (readyPatch.path === "texture.material.alphaMatte.feather") {
		withPrimaryValue = setAlphaMatteFeather(current, readyPatch.value);
	} else if (readyPatch.path === "texture.material.alphaMatte.kind") {
		withPrimaryValue = setAlphaMatteKind(current, readyPatch.value);
	} else {
		withPrimaryValue = setControlPath(
			current,
			readyPatch.path,
			readyPatch.value,
		);
	}
	const withActivations =
		spec.activates?.reduce<VisualRecipeDraft>((draft, activation) => {
			if (!activation.when(readyPatch.value)) return draft;
			return setControlPath(
				normalizeVisualRecipe(draft),
				activation.path,
				true,
			);
		}, withPrimaryValue) ?? withPrimaryValue;
	// A bare angle write is an authoring intent for the directional field.
	// Circular may retain a dormant angle, but external path writes should not
	// create a visible no-op by leaving the field in contour mode.
	let withSemanticActivations = withActivations;
	if (
		readyPatch.path === "texture.material.angle" &&
		typeof readyPatch.value === "number" &&
		Number.isFinite(readyPatch.value)
	) {
		const activated = normalizeVisualRecipe(withSemanticActivations);
		const withLinearMode = setControlPath(
			activated,
			"texture.material.fieldMode",
			"linear",
		);
		withSemanticActivations = setControlPath(
			normalizeVisualRecipe(withLinearMode),
			"texture.material.linearField",
			textureParticleLinearFieldWithAngle(
				textureParticleLinearFieldEffective(
					resolveTextureParticleLinearField(activated.texture),
				),
				readyPatch.value,
			),
		);
	}
	if (
		readyPatch.path === "texture.material.strength" &&
		typeof readyPatch.value === "number" &&
		Number.isFinite(readyPatch.value) &&
		textureParticleFieldMode(current.texture) === "linear"
	) {
		const currentLinearField = textureParticleLinearFieldEffective(
			resolveTextureParticleLinearField(current.texture),
		);
		withSemanticActivations = setControlPath(
			normalizeVisualRecipe(withSemanticActivations),
			"texture.material.linearField",
			{
				...currentLinearField,
				plateau: Math.min(0.99, Math.max(0, 1 - readyPatch.value)),
			},
		);
	}
	if (readyPatch.path.startsWith("texture.material.linearField.")) {
		const activated = normalizeVisualRecipe(withSemanticActivations);
		const linearField = activated.texture.material.linearField;
		if (linearField) {
			const effectiveLinearField =
				textureParticleLinearFieldEffective(linearField);
			const linearFieldDx = effectiveLinearField.x2 - effectiveLinearField.x1;
			const linearFieldDy = effectiveLinearField.y2 - effectiveLinearField.y1;
			const isDegenerateLinearField =
				linearFieldDx * linearFieldDx + linearFieldDy * linearFieldDy <= 1e-6;
			// A collided/zero-length field would otherwise persist a degenerate
			// linearGradient, rendering the node fully transparent. Skip the
			// semantic activation for this patch and keep the recipe as-is,
			// mirroring the guard in noise-gradient/model/tool-controls.ts.
			if (!isDegenerateLinearField) {
				const withLinearMode = setControlPath(
					activated,
					"texture.material.fieldMode",
					"linear",
				);
				const withLinearField = setControlPath(
					normalizeVisualRecipe(withLinearMode),
					"texture.material.linearField",
					effectiveLinearField,
				);
				const withAngle = setControlPath(
					normalizeVisualRecipe(withLinearField),
					"texture.material.angle",
					textureParticleLinearFieldAngle(effectiveLinearField),
				);
				withSemanticActivations = setControlPath(
					normalizeVisualRecipe(withAngle),
					"texture.material.strength",
					textureParticleLinearFieldExtent(effectiveLinearField),
				);
			}
		}
	}
	const next = normalizeVisualRecipe(withSemanticActivations);

	return sameJson(current, next)
		? { kind: "unchanged", recipe: current, patch: readyPatch }
		: { kind: "applied", recipe: next, patch: readyPatch };
}

/** Convenience helper for the common control flow: path + raw UI value -> recipe. */
export function updateRecipeControl(
	recipe: VisualRecipeDraft | null | undefined,
	path: string,
	value: unknown,
): RecipePathPatchResult {
	return applyRecipePathPatch(recipe, createRecipePathPatch(path, value));
}

/** Reads the current canonical value for a registered control path. */
export function readRecipeControlValue(
	recipe: VisualRecipeDraft | null | undefined,
	path: string,
): RecipeControlValue | null {
	if (!isRecipeControlPath(path)) return null;
	const normalized = normalizeRecipeSource(recipe);
	if (path === "texture.material.alphaMatte.feather") {
		return alphaMatteFeatherValue(normalized);
	}
	const value = valueAtPath(normalized, path.split("."));
	return typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
		? value
		: null;
}

/**
 * Reads one control across a recipe selection, returning an explicit mixed
 * sentinel instead of leaking the primary value into batch-editing UI.
 */
export function recipeControlValueForSelection(
	recipes: readonly (VisualRecipeDraft | null | undefined)[],
	path: string,
): RecipeSelectionControlValue {
	if (!isRecipeControlPath(path)) {
		return { kind: "invalid-path", path, value: null };
	}
	if (recipes.length === 0) return { kind: "empty", path, value: null };
	const first = readRecipeControlValue(recipes[0], path);
	if (first === null) return { kind: "empty", path, value: null };
	const mixed = recipes
		.slice(1)
		.some((recipe) => !Object.is(readRecipeControlValue(recipe, path), first));
	return mixed
		? { kind: "mixed", path, value: RECIPE_MIXED_VALUE }
		: { kind: "value", path, value: first };
}

/**
 * Builds a path-keyed value model for multi-selection controls. Callers can
 * pass a small path subset for panel performance or omit paths to read the full
 * catalog.
 */
export function recipeControlValuesForSelection(
	recipes: readonly (VisualRecipeDraft | null | undefined)[],
	paths: readonly string[] = RECIPE_CONTROL_SPECS.map((spec) => spec.path),
): Readonly<Record<string, RecipeSelectionControlValue>> {
	return Object.fromEntries(
		paths.map((path) => [path, recipeControlValueForSelection(recipes, path)]),
	);
}

/**
 * Projects current canonical recipes back into the existing Inspector scalar
 * names without making those names write targets.
 */
export function readLegacyRecipeScalarValue(
	recipe: VisualRecipeDraft | null | undefined,
	field: LegacyRecipeScalarField,
): number {
	const normalized = normalizeRecipeSource(recipe);
	return LEGACY_RECIPE_SCALAR_CONTROLS[field].read(normalized);
}

/**
 * Converts one existing scalar Inspector field into a canonical path patch.
 * Future UI can call this while it still speaks legacy field names, but the
 * command bus receives only vec-core recipe paths.
 */
export function createLegacyRecipeScalarPatch(
	field: LegacyRecipeScalarField,
	value: number,
): RecipePathPatchDraft {
	const control = LEGACY_RECIPE_SCALAR_CONTROLS[field];
	return createRecipePathPatch(control.path, control.toCanonical(value));
}
