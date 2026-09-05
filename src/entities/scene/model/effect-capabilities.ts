import { NEUTRAL_VISUAL_RECIPE } from "@/shared/vec-core";
import {
	LEGACY_RECIPE_SCALAR_CONTROLS,
	type LegacyRecipeScalarField,
	type RecipeControlKind,
	type RecipeControlPath,
	type RecipeControlSpec,
	type RecipeControlValue,
	readRecipeControlValue,
	recipeControlSpecForPath,
} from "./recipe-controls";

export type FrameEffectCapabilityInfluenceNumberField =
	| "strength"
	| "featherRadius";

/** Target scopes where a look/effect capability can be authored. */
export type EffectCapabilityTargetScope = "node" | "artboard" | "scene";

/** Composition phase that owns the effect before render/export adapters resolve it. */
export type EffectCapabilityStackPhase =
	| "node-style"
	| "node-recipe"
	| "frame-recipe"
	| "frame-influence"
	| "runtime-presentation";

/** Control value kinds surfaced by the capability contract. */
export type EffectCapabilityValueKind = RecipeControlKind | "recipe-preset";

/**
 * Honest support state for one authoring capability on one render/export
 * surface. `side-car-only` means the canonical intent is exported but this
 * surface does not currently render the pixels itself.
 */
export type EffectRuntimeSupport =
	| "native"
	| "approximated"
	| "side-car-only"
	| "capture-only"
	| "unsupported";

/** Surface-by-surface fidelity contract for generated assets and reports. */
export type EffectRuntimeSupportMatrix = {
	readonly editorCanvas: EffectRuntimeSupport;
	readonly svgExport: EffectRuntimeSupport;
	readonly motionRuntimeJs: EffectRuntimeSupport;
	readonly reactWrapper: EffectRuntimeSupport;
	readonly webmCapture: EffectRuntimeSupport;
	readonly recipeJson: EffectRuntimeSupport;
};

/** Declarative source for a capability; no executable effect code is stored. */
export type EffectCapabilitySource =
	| {
			readonly kind: "recipe-control";
			readonly recipePath: RecipeControlPath;
			readonly legacyField: LegacyRecipeScalarField;
	  }
	| {
			readonly kind: "recipe-preset";
			readonly presetId: "analog-film";
			readonly recipePath: "recipe";
	  }
	| {
			readonly kind: "influence-control";
			readonly field: FrameEffectCapabilityInfluenceNumberField;
			readonly influencePath: "influence.strength" | "influence.featherRadius";
			readonly effectPath: "recipe.glow.bloom";
	  };

/** Machine-readable authoring control metadata for one capability. */
export type EffectCapabilityControl = {
	readonly valueKind: EffectCapabilityValueKind;
	readonly defaultValue: RecipeControlValue | null;
	readonly min?: number;
	readonly max?: number;
	readonly step?: number;
	readonly unit?: string;
	readonly options?: readonly string[];
	readonly keyframable: boolean;
	readonly expressionBindable: boolean;
	readonly advanced?: boolean;
};

/**
 * One source-of-truth row connecting authoring, motion expressions, and export
 * fidelity. It wraps vec-core recipe/influence paths; it does not define a new
 * effect system.
 */
export type EffectCapabilityDescriptor = {
	readonly id: string;
	readonly label: string;
	readonly source: EffectCapabilitySource;
	readonly targetScopes: readonly EffectCapabilityTargetScope[];
	readonly stackPhases: readonly EffectCapabilityStackPhase[];
	readonly control: EffectCapabilityControl;
	readonly support: EffectRuntimeSupportMatrix;
};

export const EFFECT_RUNTIME_SUPPORT_VALUES = [
	"native",
	"approximated",
	"side-car-only",
	"capture-only",
	"unsupported",
] as const satisfies readonly EffectRuntimeSupport[];

const NODE_RECIPE_SUPPORT = {
	editorCanvas: "approximated",
	svgExport: "approximated",
	motionRuntimeJs: "side-car-only",
	reactWrapper: "side-car-only",
	webmCapture: "capture-only",
	recipeJson: "native",
} as const satisfies EffectRuntimeSupportMatrix;

const FRAME_RECIPE_SUPPORT = {
	editorCanvas: "approximated",
	svgExport: "side-car-only",
	motionRuntimeJs: "side-car-only",
	reactWrapper: "side-car-only",
	webmCapture: "capture-only",
	recipeJson: "native",
} as const satisfies EffectRuntimeSupportMatrix;

const FRAME_INFLUENCE_SUPPORT = {
	editorCanvas: "approximated",
	svgExport: "side-car-only",
	motionRuntimeJs: "side-car-only",
	reactWrapper: "side-car-only",
	webmCapture: "capture-only",
	recipeJson: "native",
} as const satisfies EffectRuntimeSupportMatrix;

const REACHABLE_RECIPE_LOOK_CONTROLS = [
	{ legacyField: "exposure", label: "Exposure" },
	{ legacyField: "contrast", label: "Contrast", unit: "x" },
	{ legacyField: "saturation", label: "Saturation", unit: "x" },
	{ legacyField: "grain", label: "Grain" },
	{ legacyField: "noiseScale", label: "Noise scale", unit: "x" },
	{ legacyField: "glowBloom", label: "Glow" },
	{ legacyField: "glowRadius", label: "Glow radius", unit: "px" },
	{ legacyField: "rgbSplit", label: "RGB split" },
] as const satisfies readonly {
	readonly legacyField: LegacyRecipeScalarField;
	readonly label: string;
	readonly unit?: string;
}[];

const requiredRecipeControlSpec = (
	path: RecipeControlPath,
): RecipeControlSpec => {
	const spec = recipeControlSpecForPath(path);
	if (!spec) throw new Error(`Missing recipe control capability path ${path}.`);
	return spec;
};

const recipeDefaultValue = (path: RecipeControlPath): RecipeControlValue => {
	const value = readRecipeControlValue(NEUTRAL_VISUAL_RECIPE, path);
	if (value === null) {
		throw new Error(`Missing neutral recipe control value for ${path}.`);
	}
	return value;
};

const recipeCapabilityControl = (
	spec: RecipeControlSpec,
	defaultValue: RecipeControlValue,
	options: { readonly unit?: string },
): EffectCapabilityControl => ({
	valueKind: spec.kind,
	defaultValue,
	min: spec.min,
	max: spec.max,
	step: spec.step,
	unit: options.unit,
	options: spec.options,
	keyframable: true,
	expressionBindable: true,
});

const recipeCapability = (
	target: "node" | "frame",
	control: (typeof REACHABLE_RECIPE_LOOK_CONTROLS)[number],
): EffectCapabilityDescriptor => {
	const recipePath = LEGACY_RECIPE_SCALAR_CONTROLS[control.legacyField].path;
	const spec = requiredRecipeControlSpec(recipePath);
	const targetPrefix = target === "node" ? "node-look" : "frame-look";
	return {
		id: `${targetPrefix}.${control.legacyField}`,
		label: control.label,
		source: {
			kind: "recipe-control",
			recipePath,
			legacyField: control.legacyField,
		},
		targetScopes: target === "node" ? ["node"] : ["artboard", "scene"],
		stackPhases: target === "node" ? ["node-recipe"] : ["frame-recipe"],
		control: recipeCapabilityControl(spec, recipeDefaultValue(recipePath), {
			unit: "unit" in control ? control.unit : undefined,
		}),
		support: target === "node" ? NODE_RECIPE_SUPPORT : FRAME_RECIPE_SUPPORT,
	};
};

const frameInfluenceCapability = (
	field: FrameEffectCapabilityInfluenceNumberField,
	options: {
		readonly label: string;
		readonly defaultValue: number;
		readonly min: number;
		readonly max: number;
		readonly step: number;
	},
): EffectCapabilityDescriptor => ({
	id: `frame-influence.${field}`,
	label: options.label,
	source: {
		kind: "influence-control",
		field,
		influencePath:
			field === "strength" ? "influence.strength" : "influence.featherRadius",
		effectPath: "recipe.glow.bloom",
	},
	targetScopes: ["artboard", "scene"],
	stackPhases: ["frame-influence"],
	control: {
		valueKind: "number",
		defaultValue: options.defaultValue,
		min: options.min,
		max: options.max,
		step: options.step,
		keyframable: true,
		expressionBindable: true,
	},
	support: FRAME_INFLUENCE_SUPPORT,
});

/**
 * `@__PURE__`-IIFE-wrapped so a bundler that never reaches a consumer of
 * {@link EFFECT_CAPABILITY_DESCRIPTORS} (every LEAN/FLAT runtime-sampler tier
 * — see `docs/codemap.md`'s motion/timeline row) can tree-shake this whole
 * derivation away, same reasoning and shape as `source-optics.ts`'s
 * `SOURCE_OPTICS_PARAMETER_DESCRIPTORS` and `bindable-property.ts`'s
 * `scalarSceneProperties`. Without it, esbuild can't prove the `.map`/
 * `recipeCapability`/`frameInfluenceCapability` calls inside are free of
 * observable side effects and keeps this array (and `recipe-controls.ts`,
 * which `recipeCapability` pulls in) alive even when nothing in a given
 * bundle calls `effectCapabilityById`/`bindableEffectPropertyForCapabilityId`.
 * Must stay free of real side effects; behavior for every existing caller
 * (editor, FULL, CORE) is unchanged.
 */
export const EFFECT_CAPABILITY_DESCRIPTORS = /* @__PURE__ */ (() =>
	[
		...REACHABLE_RECIPE_LOOK_CONTROLS.map((control) =>
			recipeCapability("node", control),
		),
		...REACHABLE_RECIPE_LOOK_CONTROLS.map((control) =>
			recipeCapability("frame", control),
		),
		{
			id: "frame-look.analog-film",
			label: "Analog Film",
			source: {
				kind: "recipe-preset",
				presetId: "analog-film",
				recipePath: "recipe",
			},
			targetScopes: ["artboard", "scene"],
			stackPhases: ["frame-recipe"],
			control: {
				valueKind: "recipe-preset",
				defaultValue: null,
				keyframable: false,
				expressionBindable: false,
			},
			support: FRAME_RECIPE_SUPPORT,
		},
		frameInfluenceCapability("strength", {
			label: "Frame influence strength",
			defaultValue: 0.7,
			min: 0,
			max: 1,
			step: 0.01,
		}),
		frameInfluenceCapability("featherRadius", {
			label: "Frame influence feather",
			defaultValue: 0.08,
			min: 0,
			max: 1,
			step: 0.01,
		}),
	] as const satisfies readonly EffectCapabilityDescriptor[])();

export type EffectCapabilityId =
	(typeof EFFECT_CAPABILITY_DESCRIPTORS)[number]["id"];

export type EffectCapabilityValidationIssue =
	| {
			readonly kind: "duplicate-id";
			readonly id: string;
	  }
	| {
			readonly kind: "duplicate-source-target";
			readonly sourceKey: string;
	  }
	| {
			readonly kind: "invalid-recipe-path";
			readonly id: string;
			readonly path: string;
	  }
	| {
			readonly kind: "empty-target-scopes" | "empty-stack-phases";
			readonly id: string;
	  };

/**
 * `@__PURE__`-IIFE-wrapped for the same reason as `bindable-property.ts`'s
 * `BINDABLE_PROPERTY_BY_ID`: annotating the `new Map` call alone would not be
 * enough since its argument (`.map(...)`) is its own unannotated call, and
 * arguments are evaluated whether or not the call's result is used. Wrapping
 * the whole construction inside a zero-argument arrow function called
 * immediately makes it one atomic, pure-marked unit.
 */
const EFFECT_CAPABILITY_BY_ID: ReadonlyMap<string, EffectCapabilityDescriptor> =
	/* @__PURE__ */ (() =>
		new Map(
			EFFECT_CAPABILITY_DESCRIPTORS.map((capability) => [
				capability.id,
				capability,
			]),
		))();

const sourceTargetKey = (capability: EffectCapabilityDescriptor): string => {
	const source =
		capability.source.kind === "recipe-control"
			? `recipe:${capability.source.recipePath}`
			: capability.source.kind === "recipe-preset"
				? `preset:${capability.source.presetId}`
				: `influence:${capability.source.influencePath}`;
	return `${source}:${capability.targetScopes.join("|")}`;
};

/** Looks up one registered effect capability by stable id. */
export function effectCapabilityById(
	id: string,
): EffectCapabilityDescriptor | null {
	return EFFECT_CAPABILITY_BY_ID.get(id) ?? null;
}

/** Returns capabilities that can author a given canonical vec-core recipe path. */
export function effectCapabilitiesForRecipePath(
	path: RecipeControlPath,
): readonly EffectCapabilityDescriptor[] {
	return EFFECT_CAPABILITY_DESCRIPTORS.filter(
		(capability) =>
			capability.source.kind === "recipe-control" &&
			capability.source.recipePath === path,
	);
}

/** Returns capabilities available for one target scope. */
export function effectCapabilitiesForTargetScope(
	scope: EffectCapabilityTargetScope,
): readonly EffectCapabilityDescriptor[] {
	return EFFECT_CAPABILITY_DESCRIPTORS.filter((capability) =>
		capability.targetScopes.some((targetScope) => targetScope === scope),
	);
}

/**
 * Validates a capability set. Tests and future plugin loaders use this to keep
 * ids, source/target tuples, and recipe path references deterministic.
 */
export function validateEffectCapabilityDescriptors(
	descriptors: readonly EffectCapabilityDescriptor[] = EFFECT_CAPABILITY_DESCRIPTORS,
): readonly EffectCapabilityValidationIssue[] {
	const issues: EffectCapabilityValidationIssue[] = [];
	const ids = new Set<string>();
	const sourceTargets = new Set<string>();
	for (const descriptor of descriptors) {
		if (ids.has(descriptor.id)) {
			issues.push({ kind: "duplicate-id", id: descriptor.id });
		}
		ids.add(descriptor.id);

		const key = sourceTargetKey(descriptor);
		if (sourceTargets.has(key)) {
			issues.push({ kind: "duplicate-source-target", sourceKey: key });
		}
		sourceTargets.add(key);

		if (descriptor.targetScopes.length === 0) {
			issues.push({ kind: "empty-target-scopes", id: descriptor.id });
		}
		if (descriptor.stackPhases.length === 0) {
			issues.push({ kind: "empty-stack-phases", id: descriptor.id });
		}
		if (
			descriptor.source.kind === "recipe-control" &&
			!recipeControlSpecForPath(descriptor.source.recipePath)
		) {
			issues.push({
				kind: "invalid-recipe-path",
				id: descriptor.id,
				path: descriptor.source.recipePath,
			});
		}
	}
	return issues;
}
