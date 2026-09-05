import {
	type ColorRecipe,
	composeVisualRecipe,
	type EffectInfluenceRecipe,
	NEUTRAL_VISUAL_RECIPE,
	normalizeVisualRecipe,
	type VisualRecipe,
	type VisualRecipeDraft,
} from "@/shared/vec-core";
import type { EffectCapabilityStackPhase } from "./effect-capabilities";
import {
	colorGradePrimitives,
	type FilterPrimitive,
	glowPrimitives,
	recipeOutwardReach,
	svgIdSegment,
	texturePrimitives,
} from "./effect-filter";
import { BLEND_MODES, type BlendMode, type Bounds } from "./types";

export const EFFECT_LAYER_STACK_SCHEMA_VERSION = 1 as const;

/** Operation role for one ordered effect layer; scalar values stay in VisualRecipe. */
export type EffectLayerKind =
	| "grade"
	| "glow"
	| "grain"
	| "recipe-compat"
	| "blur"
	| "composite";

/** Owner that stores or resolves an effect-layer stack. */
export type EffectLayerOwnerRef =
	| { readonly scope: "scene" }
	| { readonly scope: "artboard"; readonly artboardId: string }
	| { readonly scope: "node"; readonly nodeId: string };

/** Pixel target affected by one effect layer. */
export type EffectLayerTargetRef =
	| { readonly scope: "frame" }
	| { readonly scope: "node"; readonly nodeId: string }
	| { readonly scope: "node-set"; readonly nodeIds: readonly string[] };

/** Source field used to gate a layer's wet amount at compile/render time. */
export type EffectLayerAdaptationSource =
	| "none"
	| "source-alpha"
	| "previous-alpha"
	| "previous-luminance"
	| "mask";

/** Normalized 0..1 applicability control for one effect layer. */
export type EffectLayerAdaptation = {
	readonly source: EffectLayerAdaptationSource;
	readonly strength: number;
	readonly invert?: boolean;
};

/**
 * Ordered wrapper around canonical vec-core look/influence payloads. It gives a
 * recipe stable identity, target, order, mix/blend, and adaptation without
 * duplicating scalar effect state.
 */
export type EffectLayer = {
	readonly id: string;
	readonly kind: EffectLayerKind;
	readonly label: string;
	readonly enabled: boolean;
	readonly phase: EffectCapabilityStackPhase;
	readonly target: EffectLayerTargetRef;
	readonly mix: number;
	readonly blendMode: BlendMode;
	readonly visualRecipe: VisualRecipe;
	readonly influenceAssignmentIds?: readonly string[];
	readonly adaptation?: EffectLayerAdaptation;
};

/** Sparse input accepted from commands, imports, and agent/MCP payloads. */
export type EffectLayerDraft = {
	readonly id?: string;
	readonly kind?: EffectLayerKind;
	readonly label?: string;
	readonly enabled?: boolean;
	readonly phase?: EffectCapabilityStackPhase;
	readonly target?: EffectLayerTargetRef;
	readonly mix?: number;
	readonly blendMode?: BlendMode;
	readonly visualRecipe?: VisualRecipeDraft;
	readonly influenceAssignmentIds?: readonly string[];
	readonly adaptation?: Partial<EffectLayerAdaptation>;
};

/** Persistable ordered effect stack attached to an EffectIntent scope. */
export type EffectLayerStack = {
	readonly schemaVersion: typeof EFFECT_LAYER_STACK_SCHEMA_VERSION;
	readonly layers: readonly EffectLayer[];
};

/** Sparse stack input accepted by normalizers and command helpers. */
export type EffectLayerStackDraft = {
	readonly schemaVersion?: typeof EFFECT_LAYER_STACK_SCHEMA_VERSION;
	readonly layers?: readonly EffectLayerDraft[];
};

/** Patch payload for a single layer while preserving its stable id. */
export type EffectLayerPatch = Partial<
	Omit<EffectLayerDraft, "id" | "target">
> & {
	readonly target?: EffectLayerTargetRef;
};

/** Pure operation model shared by GUI and code-native writers. */
export type EffectLayerStackOperation =
	| {
			readonly kind: "add";
			readonly layer: EffectLayerDraft;
			readonly index?: number;
	  }
	| {
			readonly kind: "update";
			readonly layerId: string;
			readonly patch: EffectLayerPatch;
	  }
	| {
			readonly kind: "remove";
			readonly layerId: string;
	  }
	| {
			readonly kind: "reorder";
			readonly layerId: string;
			readonly toIndex: number;
	  };

/** Honest renderer/export support status for one compiled effect layer. */
export type EffectLayerFidelity =
	| {
			readonly layerId: string;
			readonly status: "native";
	  }
	| {
			readonly layerId: string;
			readonly status:
				| "approx"
				| "side-car-only"
				| "capture-only"
				| "deferred"
				| "unsupported";
			readonly reason: string;
	  };

/** One layer lowered into the renderer-neutral effect plan. */
export type CompiledEffectLayer = {
	readonly layerId: string;
	readonly kind: EffectLayerKind;
	readonly phase: EffectCapabilityStackPhase;
	readonly input: string;
	readonly output: string;
	readonly mix: number;
	readonly blendMode: BlendMode;
	readonly adaptation?: EffectLayerAdaptation;
	readonly primitives: readonly FilterPrimitive[];
	readonly fidelity: EffectLayerFidelity;
};

/** Renderer-neutral compiled stack consumed by canvas/export/runtime adapters. */
export type EffectStackPlan = {
	readonly owner: EffectLayerOwnerRef;
	readonly input: string;
	readonly output: string;
	readonly layers: readonly CompiledEffectLayer[];
	readonly cacheKey: string;
	readonly outwardReach: number;
	readonly fidelity: readonly EffectLayerFidelity[];
};

/** Inputs needed to compile a stack deterministically for one owner. */
export type CompileEffectLayerStackOptions = {
	readonly owner: EffectLayerOwnerRef;
	readonly input?: string;
	/** Filter-space bounds for texture layers that generate particle ramps. */
	readonly bounds?: Bounds;
	/** Raster export mode: bakes explicit SMIL particle Motion while keeping inlined linear ramps. */
	readonly rasterSafe?: boolean;
	/** Sampled frame time in seconds, used to bake particle Motion when `rasterSafe`. */
	readonly frameTimeSeconds?: number;
};

const DEFAULT_TEXTURE_BOUNDS: Bounds = { x: 0, y: 0, width: 1, height: 1 };

type LayerRenderContext = {
	readonly bounds: Bounds;
	readonly rasterSafe: boolean;
	readonly frameTimeSeconds?: number;
};

type EffectIntentLayerSource = {
	readonly visualRecipe?: VisualRecipe;
	readonly influenceRecipe?: EffectInfluenceRecipe;
	readonly effectLayerStack?: EffectLayerStack;
};

/**
 * Every {@link EffectLayerKind} literal, `satisfies`-checked so other layers
 * (the MCP wire schema) can derive their enum from this instead of hand-typing
 * a second literal list that can silently drift.
 */
export const EFFECT_LAYER_KINDS = [
	"grade",
	"glow",
	"grain",
	"recipe-compat",
	"blur",
	"composite",
] as const satisfies readonly EffectLayerKind[];

/**
 * Every {@link EffectCapabilityStackPhase} literal, `satisfies`-checked so other
 * layers (the MCP wire schema) can derive their enum from this instead of
 * hand-typing a second literal list that can silently drift.
 */
export const EFFECT_LAYER_PHASES = [
	"node-style",
	"node-recipe",
	"frame-recipe",
	"frame-influence",
	"runtime-presentation",
] as const satisfies readonly EffectCapabilityStackPhase[];

/**
 * Every {@link EffectLayerAdaptationSource} literal, `satisfies`-checked so
 * other layers (the MCP wire schema) can derive their enum from this instead of
 * hand-typing a second literal list that can silently drift.
 */
export const ADAPTATION_SOURCES = [
	"none",
	"source-alpha",
	"previous-alpha",
	"previous-luminance",
	"mask",
] as const satisfies readonly EffectLayerAdaptationSource[];

const DEFAULT_LAYER_KIND: EffectLayerKind = "recipe-compat";
const DEFAULT_BLEND_MODE: BlendMode = "normal";
const DEFAULT_MIX = 1;

const isBlendMode = (value: unknown): value is BlendMode =>
	BLEND_MODES.includes(value as BlendMode);

const isLayerKind = (value: unknown): value is EffectLayerKind =>
	EFFECT_LAYER_KINDS.includes(value as EffectLayerKind);

const isStackPhase = (value: unknown): value is EffectCapabilityStackPhase =>
	EFFECT_LAYER_PHASES.includes(value as EffectCapabilityStackPhase);

const isAdaptationSource = (
	value: unknown,
): value is EffectLayerAdaptationSource =>
	ADAPTATION_SOURCES.includes(value as EffectLayerAdaptationSource);

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const finiteOr = (value: unknown, fallback: number): number =>
	typeof value === "number" && Number.isFinite(value) ? value : fallback;

const nonEmpty = (value: unknown): string | null => {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
};

const uniqueStrings = (
	values: readonly string[] | undefined,
): readonly string[] => {
	if (!values) return [];
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		const id = nonEmpty(value);
		if (!id || seen.has(id)) continue;
		seen.add(id);
		result.push(id);
	}
	return result;
};

const defaultLayerLabel = (kind: EffectLayerKind): string => {
	switch (kind) {
		case "grade":
			return "Grade";
		case "glow":
			return "Glow";
		case "grain":
			return "Grain";
		case "recipe-compat":
			return "Look";
		case "blur":
			return "Blur";
		case "composite":
			return "Composite";
	}
};

const defaultPhaseForKind = (
	kind: EffectLayerKind,
	owner: EffectLayerOwnerRef | null,
): EffectCapabilityStackPhase => {
	if (kind === "blur" || kind === "composite") return "runtime-presentation";
	return owner?.scope === "node" ? "node-recipe" : "frame-recipe";
};

const defaultTargetForOwner = (
	owner: EffectLayerOwnerRef | null,
): EffectLayerTargetRef => {
	if (owner?.scope === "node") return { scope: "node", nodeId: owner.nodeId };
	return { scope: "frame" };
};

const normalizeTarget = (
	target: EffectLayerTargetRef | undefined,
	fallback: EffectLayerTargetRef,
): EffectLayerTargetRef => {
	if (!target) return fallback;
	switch (target.scope) {
		case "frame":
			return target;
		case "node": {
			const nodeId = nonEmpty(target.nodeId);
			return nodeId ? { scope: "node", nodeId } : fallback;
		}
		case "node-set": {
			const nodeIds = uniqueStrings(target.nodeIds);
			return nodeIds.length > 0 ? { scope: "node-set", nodeIds } : fallback;
		}
	}
};

const normalizeAdaptation = (
	adaptation: Partial<EffectLayerAdaptation> | undefined,
): EffectLayerAdaptation | undefined => {
	if (!adaptation || !isAdaptationSource(adaptation.source)) return undefined;
	if (adaptation.source === "none") return undefined;
	return {
		source: adaptation.source,
		strength: clamp01(finiteOr(adaptation.strength, 1)),
		...(adaptation.invert === undefined ? {} : { invert: adaptation.invert }),
	};
};

const normalizeLayer = (
	draft: EffectLayerDraft,
	owner: EffectLayerOwnerRef | null,
	usedIds: Set<string>,
): EffectLayer | null => {
	const id = nonEmpty(draft.id);
	if (!id || usedIds.has(id)) return null;
	usedIds.add(id);
	const kind = isLayerKind(draft.kind) ? draft.kind : DEFAULT_LAYER_KIND;
	const phase = isStackPhase(draft.phase)
		? draft.phase
		: defaultPhaseForKind(kind, owner);
	const target = normalizeTarget(draft.target, defaultTargetForOwner(owner));
	const influenceAssignmentIds = uniqueStrings(draft.influenceAssignmentIds);
	const adaptation = normalizeAdaptation(draft.adaptation);
	return {
		id,
		kind,
		label: nonEmpty(draft.label) ?? defaultLayerLabel(kind),
		enabled: draft.enabled ?? true,
		phase,
		target,
		mix: clamp01(finiteOr(draft.mix, DEFAULT_MIX)),
		blendMode: isBlendMode(draft.blendMode)
			? draft.blendMode
			: DEFAULT_BLEND_MODE,
		visualRecipe: normalizeVisualRecipe(
			draft.visualRecipe ?? NEUTRAL_VISUAL_RECIPE,
		),
		...(influenceAssignmentIds.length > 0 ? { influenceAssignmentIds } : {}),
		...(adaptation ? { adaptation } : {}),
	};
};

/**
 * Normalizes the typed effect-layer stack wrapper without duplicating vec-core
 * scalar state. Invalid rows and duplicate layer ids are dropped so stale agent
 * or document input cannot create ambiguous write targets.
 */
export function normalizeEffectLayerStack(
	draft: EffectLayerStackDraft | EffectLayerStack | null | undefined,
	owner: EffectLayerOwnerRef | null = null,
): EffectLayerStack | undefined {
	if (!draft) return undefined;
	const usedIds = new Set<string>();
	const layers = (draft.layers ?? []).flatMap((layer) => {
		const normalized = normalizeLayer(layer, owner, usedIds);
		return normalized ? [normalized] : [];
	});
	return layers.length > 0
		? { schemaVersion: EFFECT_LAYER_STACK_SCHEMA_VERSION, layers }
		: undefined;
}

const clampIndex = (value: number | undefined, length: number): number => {
	if (value === undefined || !Number.isInteger(value)) return length;
	return Math.min(length, Math.max(0, value));
};

const moveItem = <T>(
	items: readonly T[],
	fromIndex: number,
	toIndex: number,
): readonly T[] => {
	if (fromIndex < 0 || fromIndex >= items.length) return items;
	const next = [...items];
	const [item] = next.splice(fromIndex, 1);
	if (item === undefined) return items;
	next.splice(clampIndex(toIndex, next.length), 0, item);
	return next;
};

/**
 * Applies one layer-stack edit as pure data. Command wrappers use this before
 * writing through the scene command bus so GUI, MCP, and future motion surfaces
 * share the same id/reorder semantics.
 */
export function applyEffectLayerStackOperation(
	stack: EffectLayerStack | EffectLayerStackDraft | null | undefined,
	operation: EffectLayerStackOperation,
	owner: EffectLayerOwnerRef | null = null,
): EffectLayerStack | undefined {
	const current = normalizeEffectLayerStack(stack, owner) ?? {
		schemaVersion: EFFECT_LAYER_STACK_SCHEMA_VERSION,
		layers: [],
	};
	switch (operation.kind) {
		case "add": {
			const normalized = normalizeEffectLayerStack(
				{ layers: [operation.layer] },
				owner,
			);
			const layer = normalized?.layers[0];
			if (
				!layer ||
				current.layers.some((candidate) => candidate.id === layer.id)
			) {
				return current.layers.length > 0 ? current : undefined;
			}
			const layers = [...current.layers];
			layers.splice(clampIndex(operation.index, layers.length), 0, layer);
			return { ...current, layers };
		}
		case "update": {
			const index = current.layers.findIndex(
				(layer) => layer.id === operation.layerId,
			);
			if (index < 0) return current.layers.length > 0 ? current : undefined;
			const layer = current.layers[index];
			const normalized = normalizeEffectLayerStack(
				{
					layers: [
						{
							...layer,
							...operation.patch,
							id: layer.id,
						},
					],
				},
				owner,
			);
			const nextLayer = normalized?.layers[0];
			if (!nextLayer) return current.layers.length > 0 ? current : undefined;
			return {
				...current,
				layers: current.layers.map((candidate, candidateIndex) =>
					candidateIndex === index ? nextLayer : candidate,
				),
			};
		}
		case "remove": {
			const layers = current.layers.filter(
				(layer) => layer.id !== operation.layerId,
			);
			return layers.length > 0 ? { ...current, layers } : undefined;
		}
		case "reorder": {
			const fromIndex = current.layers.findIndex(
				(layer) => layer.id === operation.layerId,
			);
			if (fromIndex < 0) return current.layers.length > 0 ? current : undefined;
			const layers = moveItem(current.layers, fromIndex, operation.toIndex);
			return layers.length > 0 ? { ...current, layers } : undefined;
		}
	}
}

const legacyLayerId = (
	owner: EffectLayerOwnerRef,
	kind: EffectLayerKind,
): string => {
	switch (owner.scope) {
		case "scene":
			return `scene-look-${kind}`;
		case "artboard":
			return `artboard-${svgIdSegment(owner.artboardId)}-look-${kind}`;
		case "node":
			return `node-${svgIdSegment(owner.nodeId)}-look-${kind}`;
	}
};

const legacyLayer = (
	owner: EffectLayerOwnerRef,
	kind: "grade" | "glow" | "grain",
	recipe: VisualRecipe,
	influenceAssignmentIds: readonly string[],
): EffectLayerDraft => ({
	id: legacyLayerId(owner, kind),
	kind,
	label: defaultLayerLabel(kind),
	phase: defaultPhaseForKind(kind, owner),
	target: defaultTargetForOwner(owner),
	visualRecipe: recipe,
	blendMode:
		kind === "grain" ? "overlay" : kind === "glow" ? "screen" : "normal",
	adaptation:
		kind === "grain" ? { source: "previous-alpha", strength: 1 } : undefined,
	influenceAssignmentIds,
});

const visualRecipeProjectionForLayer = (
	layer: EffectLayer,
): VisualRecipeDraft | null => {
	switch (layer.kind) {
		case "grade":
			return { color: layer.visualRecipe.color };
		case "glow":
			return { glow: layer.visualRecipe.glow };
		case "grain":
			return { texture: layer.visualRecipe.texture };
		case "recipe-compat":
			return layer.visualRecipe;
		case "blur":
		case "composite":
			return null;
	}
};

const mixScalar = (neutral: number, value: number, mix: number): number =>
	neutral + (value - neutral) * mix;

const mixedColorRecipe = (color: ColorRecipe, mix: number): ColorRecipe => {
	const neutral = NEUTRAL_VISUAL_RECIPE.color;
	return {
		exposure: mixScalar(neutral.exposure, color.exposure, mix),
		contrast: mixScalar(neutral.contrast, color.contrast, mix),
		saturation: mixScalar(neutral.saturation, color.saturation, mix),
		temperature: mixScalar(neutral.temperature, color.temperature, mix),
		tint: mixScalar(neutral.tint, color.tint, mix),
		density: mixScalar(neutral.density, color.density, mix),
		printContrast: mixScalar(neutral.printContrast, color.printContrast, mix),
		cmy: {
			cyan: mixScalar(neutral.cmy.cyan, color.cmy.cyan, mix),
			magenta: mixScalar(neutral.cmy.magenta, color.cmy.magenta, mix),
			yellow: mixScalar(neutral.cmy.yellow, color.cmy.yellow, mix),
		},
	};
};

const scaledVisualRecipeProjection = (
	layer: EffectLayer,
	projection: VisualRecipeDraft,
): VisualRecipeDraft => {
	if (layer.mix >= 1) return projection;
	switch (layer.kind) {
		case "grade":
			return {
				color: mixedColorRecipe(layer.visualRecipe.color, layer.mix),
			};
		case "glow":
			return {
				glow: {
					...layer.visualRecipe.glow,
					bloom: {
						...layer.visualRecipe.glow.bloom,
						strength: layer.visualRecipe.glow.bloom.strength * layer.mix,
					},
					halation: {
						...layer.visualRecipe.glow.halation,
						strength: layer.visualRecipe.glow.halation.strength * layer.mix,
					},
					diffusion: {
						...layer.visualRecipe.glow.diffusion,
						strength: layer.visualRecipe.glow.diffusion.strength * layer.mix,
					},
					lightShafts: {
						...layer.visualRecipe.glow.lightShafts,
						strength: layer.visualRecipe.glow.lightShafts.strength * layer.mix,
					},
				},
			};
		case "grain":
			return {
				texture: {
					...layer.visualRecipe.texture,
					grain: {
						...layer.visualRecipe.texture.grain,
						strength: layer.visualRecipe.texture.grain.strength * layer.mix,
					},
					material: {
						...layer.visualRecipe.texture.material,
						strength: layer.visualRecipe.texture.material.strength * layer.mix,
					},
				},
			};
		case "recipe-compat":
		case "blur":
		case "composite":
			return projection;
	}
};

const visualPayload = (recipe: VisualRecipe): object => ({
	intent: recipe.intent,
	alphaMode: recipe.alphaMode,
	color: recipe.color,
	surface: recipe.surface,
	texture: recipe.texture,
	glow: recipe.glow,
	optics: recipe.optics,
	motion: recipe.motion,
	shadow: recipe.shadow,
	distortion: recipe.distortion,
	stylization: recipe.stylization,
});

const sameVisualPayload = (left: VisualRecipe, right: VisualRecipe): boolean =>
	JSON.stringify(visualPayload(left)) === JSON.stringify(visualPayload(right));

/**
 * Projects the ordered stack back to the legacy `visualRecipe` field that today
 * drives canvas/export pixel approximations. The stack remains the richer
 * authoring contract; this projection is the compatibility bridge that makes
 * stack-only MCP/GUI writes visibly affect existing renderers.
 */
export function visualRecipeFromEffectLayerStack(
	stack: EffectLayerStack | EffectLayerStackDraft | null | undefined,
	owner: EffectLayerOwnerRef | null = null,
): VisualRecipe | undefined {
	const normalized = normalizeEffectLayerStack(stack, owner);
	if (!normalized) return undefined;
	let hasProjectedLayer = false;
	const projected = normalized.layers.reduce<VisualRecipeDraft>(
		(recipe, layer) => {
			if (!layer.enabled || layer.mix <= 0) return recipe;
			const projection = visualRecipeProjectionForLayer(layer);
			if (!projection) return recipe;
			hasProjectedLayer = true;
			return composeVisualRecipe(
				recipe,
				scaledVisualRecipeProjection(layer, projection),
			);
		},
		NEUTRAL_VISUAL_RECIPE,
	);
	if (!hasProjectedLayer) return undefined;
	const normalizedProjection = normalizeVisualRecipe({
		...projected,
		id: "effect-layer-stack-projection",
		label: "Effect layer stack projection",
		metadata: {
			...projected.metadata,
			"vecmo.effectLayerStackProjection": "true",
		},
	});
	return sameVisualPayload(normalizedProjection, NEUTRAL_VISUAL_RECIPE)
		? undefined
		: normalizedProjection;
}

/**
 * Reads an effect intent as an ordered layer stack. Explicit stacks win; legacy
 * `visualRecipe` payloads synthesize stable grade/glow/grain layers so existing
 * documents can enter the new authoring model without losing recipe data.
 */
export function effectLayerStackFromIntent(
	intent: EffectIntentLayerSource | null | undefined,
	owner: EffectLayerOwnerRef,
): EffectLayerStack | undefined {
	if (!intent) return undefined;
	const explicit = normalizeEffectLayerStack(intent.effectLayerStack, owner);
	if (explicit) return explicit;
	if (!intent.visualRecipe) return undefined;
	const recipe = normalizeVisualRecipe(intent.visualRecipe);
	const influenceAssignmentIds = uniqueStrings(
		intent.influenceRecipe?.assignments.map((assignment) => assignment.id),
	);
	return normalizeEffectLayerStack(
		{
			layers: [
				legacyLayer(owner, "glow", recipe, influenceAssignmentIds),
				legacyLayer(owner, "grain", recipe, influenceAssignmentIds),
				legacyLayer(owner, "grade", recipe, influenceAssignmentIds),
			],
		},
		owner,
	);
}

const fidelity = (
	layerId: string,
	status: EffectLayerFidelity["status"],
	reason: string,
): EffectLayerFidelity =>
	status === "native" ? { layerId, status } : { layerId, status, reason };

const passOutput = (layer: EffectLayer, index: number): string =>
	`fx-${index}-${svgIdSegment(layer.id)}`;

type PrimitiveCompileResult = {
	readonly output: string;
	readonly primitives: readonly FilterPrimitive[];
	readonly outwardReach: number;
	readonly fidelity: EffectLayerFidelity;
};

const compileRecipeCompat = (
	layer: EffectLayer,
	input: string,
	result: string,
	renderContext: LayerRenderContext,
): PrimitiveCompileResult => {
	const primitives: FilterPrimitive[] = [];
	let cursor = input;
	const glow = glowPrimitives(
		layer.visualRecipe.glow,
		cursor,
		`${result}-glow`,
	);
	if (glow.length > 0) {
		primitives.push(...glow);
		cursor = `${result}-glow`;
	}
	const texture = texturePrimitives({
		texture: layer.visualRecipe.texture,
		bounds: renderContext.bounds,
		input: cursor,
		result,
		rasterSafe: renderContext.rasterSafe,
		...(renderContext.frameTimeSeconds !== undefined
			? { frameTimeSeconds: renderContext.frameTimeSeconds }
			: {}),
	});
	if (texture.primitives.length > 0) {
		primitives.push(...texture.primitives);
		cursor = texture.output;
	}
	const grade = colorGradePrimitives(
		layer.visualRecipe.color,
		cursor,
		`${result}-grade`,
	);
	if (grade.length > 0) {
		primitives.push(...grade);
		cursor = `${result}-grade`;
	}
	return {
		output: cursor,
		primitives,
		outwardReach: recipeOutwardReach(layer.visualRecipe),
		fidelity: fidelity(
			layer.id,
			primitives.length > 0 ? "approx" : "native",
			"legacy vec-core recipe compiled through the SVG approximation tier",
		),
	};
};

const compileLayerPrimitives = (
	layer: EffectLayer,
	input: string,
	result: string,
	renderContext: LayerRenderContext,
): PrimitiveCompileResult => {
	if (!layer.enabled || layer.mix <= 0) {
		return {
			output: input,
			primitives: [],
			outwardReach: 0,
			fidelity: fidelity(layer.id, "native", "layer is disabled or mixed out"),
		};
	}
	switch (layer.kind) {
		case "grade": {
			const primitives = colorGradePrimitives(
				layer.visualRecipe.color,
				input,
				result,
			);
			return {
				output: primitives.length > 0 ? result : input,
				primitives,
				outwardReach: 0,
				fidelity: fidelity(
					layer.id,
					primitives.length > 0 ? "approx" : "native",
					"color grade uses SVG color-matrix approximation",
				),
			};
		}
		case "glow": {
			const primitives = glowPrimitives(layer.visualRecipe.glow, input, result);
			return {
				output: primitives.length > 0 ? result : input,
				primitives,
				outwardReach: recipeOutwardReach(layer.visualRecipe),
				fidelity: fidelity(
					layer.id,
					primitives.length > 0 ? "approx" : "native",
					"glow uses SVG blur/merge approximation",
				),
			};
		}
		case "grain": {
			const texture = texturePrimitives({
				texture: layer.visualRecipe.texture,
				bounds: renderContext.bounds,
				input,
				result,
				rasterSafe: renderContext.rasterSafe,
				...(renderContext.frameTimeSeconds !== undefined
					? { frameTimeSeconds: renderContext.frameTimeSeconds }
					: {}),
			});
			return {
				output: texture.output,
				primitives: texture.primitives,
				outwardReach: texture.outwardReach,
				fidelity: fidelity(
					layer.id,
					texture.primitives.length > 0 ? "approx" : "native",
					"texture uses deterministic SVG turbulence/particle approximation",
				),
			};
		}
		case "recipe-compat":
			return compileRecipeCompat(layer, input, result, renderContext);
		case "blur":
			return {
				output: input,
				primitives: [],
				outwardReach: 0,
				fidelity: fidelity(
					layer.id,
					"unsupported",
					"effect-layer blur is reserved for a later spatial-pass compiler",
				),
			};
		case "composite":
			return {
				output: input,
				primitives: [],
				outwardReach: 0,
				fidelity: fidelity(
					layer.id,
					"unsupported",
					"effect-layer composite is reserved for a later multi-input compiler",
				),
			};
	}
};

/**
 * Compiles an ordered effect-layer stack into a renderer-neutral plan. The plan
 * keeps layer ids, inputs, outputs, primitive chains, cache key, outward reach,
 * and fidelity together so canvas/export/MCP can explain the same ordered look.
 */
export function compileEffectLayerStack(
	stack: EffectLayerStack | EffectLayerStackDraft,
	options: CompileEffectLayerStackOptions,
): EffectStackPlan {
	const normalized = normalizeEffectLayerStack(stack, options.owner) ?? {
		schemaVersion: EFFECT_LAYER_STACK_SCHEMA_VERSION,
		layers: [],
	};
	const compiled: CompiledEffectLayer[] = [];
	let cursor = options.input ?? "SourceGraphic";
	let outwardReach = 0;
	const renderContext: LayerRenderContext = {
		bounds: options.bounds ?? DEFAULT_TEXTURE_BOUNDS,
		rasterSafe: options.rasterSafe ?? false,
		...(options.frameTimeSeconds !== undefined
			? { frameTimeSeconds: options.frameTimeSeconds }
			: {}),
	};
	for (const [index, layer] of normalized.layers.entries()) {
		const input = cursor;
		const result = passOutput(layer, index);
		const layerResult = compileLayerPrimitives(
			layer,
			input,
			result,
			renderContext,
		);
		cursor = layerResult.output;
		outwardReach = Math.max(outwardReach, layerResult.outwardReach);
		compiled.push({
			layerId: layer.id,
			kind: layer.kind,
			phase: layer.phase,
			input,
			output: layerResult.output,
			mix: layer.mix,
			blendMode: layer.blendMode,
			adaptation: layer.adaptation,
			primitives: layerResult.primitives,
			fidelity: layerResult.fidelity,
		});
	}
	return {
		owner: options.owner,
		input: options.input ?? "SourceGraphic",
		output: cursor,
		layers: compiled,
		cacheKey: JSON.stringify({
			owner: options.owner,
			stack: normalized,
			renderContext,
		}),
		outwardReach,
		fidelity: compiled.map((layer) => layer.fidelity),
	};
}
