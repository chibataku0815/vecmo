import {
	normalizeVisualRecipe,
	type TextureRecipe,
	type VisualRecipe,
} from "@/shared/vec-core";
import {
	LOOK_GRAPH_SCHEMA_VERSION,
	type LookGraph,
	type LookGraphEdgeDraft,
	type LookGraphEndpoint,
	type LookGraphNode,
	lookGraphEdgeId,
	lookGraphNodeId,
	lookGraphPortId,
	normalizeLookGraph,
} from "./look-graph";
import type {
	Artboard,
	LookGraphScopedEffectLook,
	RevealPaint,
	ScopedEffectLook,
	VectorNode,
} from "./types";

/** Default particle density used when an object recipe has no authored amount yet. */
export const OBJECT_NOISE_GRADIENT_DEFAULT_AMOUNT = 0.55;
/**
 * Default film-grain strength for a Mixed-mode object Noise Gradient when none
 * is authored; mirrors the tool's `DEFAULT_MIXED_GRAIN_STRENGTH`.
 */
export const OBJECT_NOISE_GRADIENT_DEFAULT_MIXED_GRAIN = 0.5;
/** Default dissolve reach for newly enabled object Noise Gradient. */
export const NOISE_GRADIENT_DEFAULT_STRENGTH = 0.9;
/** Default particle threshold hardness; Softness is authored as `1 - this`. */
export const NOISE_GRADIENT_DEFAULT_CONTRAST = 0.36;
/** Static-by-default stability; procedural Motion is authored as `1 - this`. */
export const NOISE_GRADIENT_DEFAULT_TEMPORAL_STABILITY = 1;
/**
 * Blend mode seeded on a truly fresh enable (no `material.blendMode` authored
 * yet), so a one-click/one-call enable shows the reframed noise-OVER-fill look
 * via {@link import("@/shared/vec-core").grainPrimitives} rather than the legacy
 * particle-erosion dissolve. `"dissolve"` remains reachable as an explicit
 * `blendMode` value.
 */
export const NOISE_GRADIENT_FRESH_ENABLE_BLEND_MODE = "hard-light";

/** True when a vec-core texture is using the particle dissolve material path. */
export const textureMaterialIsParticle = (texture: TextureRecipe): boolean =>
	texture.material.mode === "particle" || texture.material.mode === "mixed";

const OBJECT_NOISE_GRADIENT_SCOPED_LOOK_ID_PREFIX = "object-noise-gradient";

/** Stable scoped-overlay id for the graph-backed form of one object's Noise Gradient. */
export const objectNoiseGradientScopedLookId = (nodeId: string): string =>
	`${OBJECT_NOISE_GRADIENT_SCOPED_LOOK_ID_PREFIX}:${nodeId}`;

/** Narrows a scoped effect overlay to the graph-backed Object Noise Gradient form. */
export const isObjectNoiseGradientScopedLook = (
	look: ScopedEffectLook,
): look is LookGraphScopedEffectLook =>
	look.kind === "look-graph-overlay" && look.source === "object-noise-gradient";

/**
 * Builds the scoped Look Graph particle texture from a node recipe, preserving
 * authored particle values when present and filling visible defaults otherwise.
 */
export const objectNoiseGradientTextureFromRecipe = (
	recipe: VisualRecipe,
): TextureRecipe => {
	const texture = recipe.texture;
	const particleActive = textureMaterialIsParticle(texture);
	const authoredMode = texture.material.mode === "mixed" ? "mixed" : "particle";
	const amount =
		texture.grain.densityCoupling > 0
			? texture.grain.densityCoupling
			: texture.grain.strength > 0
				? texture.grain.strength
				: OBJECT_NOISE_GRADIENT_DEFAULT_AMOUNT;
	return normalizeVisualRecipe({
		texture: {
			grain: {
				...texture.grain,
				enabled: true,
				strength:
					authoredMode === "mixed"
						? texture.grain.strength > 0
							? texture.grain.strength
							: OBJECT_NOISE_GRADIENT_DEFAULT_MIXED_GRAIN
						: amount,
				densityCoupling: amount,
				temporalStability: particleActive
					? texture.grain.temporalStability
					: NOISE_GRADIENT_DEFAULT_TEMPORAL_STABILITY,
			},
			material: {
				...texture.material,
				mode: authoredMode,
				strength:
					particleActive || texture.material.strength > 0
						? texture.material.strength
						: NOISE_GRADIENT_DEFAULT_STRENGTH,
				particleContrast:
					particleActive || texture.material.particleContrast > 0
						? texture.material.particleContrast
						: NOISE_GRADIENT_DEFAULT_CONTRAST,
			},
		},
	}).texture;
};

const graphImageEndpoint = (
	nodeId: string,
	direction: "input" | "output",
): LookGraphEndpoint => ({
	nodeId,
	portId: lookGraphPortId(nodeId, direction, "image"),
});

const graphImageEdge = (
	fromNodeId: string,
	toNodeId: string,
): LookGraphEdgeDraft => {
	const from = graphImageEndpoint(fromNodeId, "output");
	const to = graphImageEndpoint(toNodeId, "input");
	return { id: lookGraphEdgeId(from, to), from, to };
};

/**
 * Builds the graph-native scoped overlay for one object's Noise Gradient.
 * The graph's SourceGraphic is resolved by the scoped overlay renderer, so this
 * stays independent of canvas/export adapters. `revealPaint`, when provided,
 * rides along on the grain node's payload so a node's own fill + dissolve
 * appearance can reveal a second color/gradient underneath instead of needing
 * a second plate node stacked beneath it (see `LookGraphNodePayload`'s `grain`
 * case doc); omitted leaves the payload without one, matching every other
 * optional field this builder threads through.
 */
export const objectNoiseGradientLookGraph = (
	artboardId: string,
	node: VectorNode,
	revealPaint?: RevealPaint,
): LookGraph | null => {
	const owner = {
		scope: "scoped-overlay",
		artboardId,
		scopedLookId: objectNoiseGradientScopedLookId(node.id),
	} as const;
	const sourceId = lookGraphNodeId(owner, "source");
	const particleId = `${lookGraphNodeId(owner, "grain")}:${node.id}`;
	const outputId = lookGraphNodeId(owner, "output");
	return (
		normalizeLookGraph({
			schemaVersion: LOOK_GRAPH_SCHEMA_VERSION,
			outputNodeId: outputId,
			nodes: [
				{ id: sourceId, kind: "source", payload: { kind: "source" } },
				{
					id: particleId,
					kind: "grain",
					label: "Particle Dissolve",
					payload: {
						kind: "grain",
						texture: objectNoiseGradientTextureFromRecipe(
							normalizeVisualRecipe(node.recipe),
						),
						...(revealPaint ? { revealPaint } : {}),
					},
				},
				{ id: outputId, kind: "output", payload: { kind: "output" } },
			],
			edges: [
				graphImageEdge(sourceId, particleId),
				graphImageEdge(particleId, outputId),
			],
		}) ?? null
	);
};

/** Builds the persisted scoped overlay wrapper for one object's Noise Gradient graph. */
export const objectNoiseGradientScopedLook = (
	artboardId: string,
	node: VectorNode,
	revealPaint?: RevealPaint,
): LookGraphScopedEffectLook | null => {
	const lookGraph = objectNoiseGradientLookGraph(artboardId, node, revealPaint);
	if (!lookGraph) return null;
	return {
		id: objectNoiseGradientScopedLookId(node.id),
		kind: "look-graph-overlay",
		source: "object-noise-gradient",
		lookGraph,
		targetNodeIds: [node.id],
	};
};

/** Finds the Object Noise Gradient scoped overlay that currently owns `nodeId`. */
export const objectNoiseGradientScopedLookForNode = (
	current: Artboard | readonly ScopedEffectLook[] | undefined,
	nodeId: string,
): LookGraphScopedEffectLook | null => {
	if (!current) return null;
	const scopedLooks: readonly ScopedEffectLook[] | undefined = Array.isArray(
		current,
	)
		? current
		: (current as Artboard).effectIntent?.scopedLooks;
	return (
		scopedLooks?.find(
			(look): look is LookGraphScopedEffectLook =>
				isObjectNoiseGradientScopedLook(look) &&
				look.targetNodeIds.includes(nodeId),
		) ?? null
	);
};

/** Finds any graph overlay targeting `nodeId`, regardless of its authoring source. */
export const scopedLookGraphOverlayForNode = (
	current: readonly ScopedEffectLook[] | undefined,
	nodeId: string,
): LookGraphScopedEffectLook | null =>
	current?.find(
		(look): look is LookGraphScopedEffectLook =>
			look.kind === "look-graph-overlay" && look.targetNodeIds.includes(nodeId),
	) ?? null;

/**
 * Replaces the Object Noise Gradient overlay for `nodeId` while preserving other
 * scoped looks. This keeps "one object owns one generated Noise Gradient graph"
 * deterministic across command and Inspector writers.
 */
export const replaceObjectNoiseGradientScopedLook = (
	current: readonly ScopedEffectLook[] | undefined,
	nodeId: string,
	next: LookGraphScopedEffectLook,
): readonly ScopedEffectLook[] => [
	...(current ?? []).filter(
		(look) =>
			!(
				isObjectNoiseGradientScopedLook(look) &&
				(look.id === next.id || look.targetNodeIds.includes(nodeId))
			),
	),
	next,
];

/** Returns the particle-dissolve graph node inside an Object Noise Gradient overlay. */
export const objectNoiseGradientParticleNode = (
	look: LookGraphScopedEffectLook,
): LookGraphNode | null =>
	look.lookGraph.nodes.find(
		(node) =>
			node.payload.kind === "grain" &&
			textureMaterialIsParticle(node.payload.texture),
	) ?? null;

/**
 * Finds the grain graph node inside an Object Noise Gradient overlay REGARDLESS
 * of its material mode (including `"off"`), so the authoring tool/Inspector keep
 * resolving a node the user toggled off and can re-enable it. Render paths use
 * {@link objectNoiseGradientParticleNode} instead, so an off overlay renders nothing.
 */
export const objectNoiseGradientGrainNode = (
	look: LookGraphScopedEffectLook,
): LookGraphNode | null =>
	look.lookGraph.nodes.find((node) => node.payload.kind === "grain") ?? null;

/** Optional companion write alongside a texture refresh; see {@link graphWithObjectNoiseGradientTexture}. */
export type GraphWithObjectNoiseGradientTextureOptions = {
	/**
	 * Tri-state, NOT reset-style: `options` (or `options.revealPaint`) absent
	 * PRESERVES whatever `revealPaint` the grain payload already carries — this
	 * is what the Inspector's texture-only slider edits (`tool-controls.ts`/
	 * `noise-gradient-editing.ts`, both 2-arg callers) rely on, since touching a
	 * grain/material slider must not silently discard an already-authored
	 * dissolve reveal color. Passing `revealPaint: null` explicitly REMOVES it,
	 * and passing a value SETS it. The agent re-author surface
	 * (`createConvertNodeNoiseGradientToScopedLookGraphCommand`'s refresh path)
	 * is the only caller that wants reset-style clearing, and gets it by
	 * threading its own omitted param through as `null` before calling here —
	 * see that command's doc.
	 */
	readonly revealPaint?: RevealPaint | null;
};

/**
 * Returns a copy of `look.lookGraph` with its Object Noise Gradient texture
 * replaced. `options` is omitted by the Inspector's texture-only callers
 * (`tool-controls.ts`/`noise-gradient-editing.ts`), which rely on the
 * PRESERVE default so a grain/material slider edit never discards an
 * already-authored `revealPaint` (see
 * {@link GraphWithObjectNoiseGradientTextureOptions} for the full tri-state).
 * The payload is re-normalized through `normalizeLookGraph` (not written raw)
 * so `normalizeRevealPaint`'s empty-stops drop applies here exactly like every
 * other path that authors a grain payload.
 */
export const graphWithObjectNoiseGradientTexture = (
	look: LookGraphScopedEffectLook,
	texture: TextureRecipe,
	options?: GraphWithObjectNoiseGradientTextureOptions,
): LookGraph | null => {
	const particleNode = objectNoiseGradientGrainNode(look);
	if (!particleNode) return null;
	const existingRevealPaint =
		particleNode.payload.kind === "grain"
			? particleNode.payload.revealPaint
			: undefined;
	const nextRevealPaint =
		options?.revealPaint === undefined
			? existingRevealPaint
			: (options.revealPaint ?? undefined);
	return (
		normalizeLookGraph({
			...look.lookGraph,
			nodes: look.lookGraph.nodes.map((node) =>
				node.id === particleNode.id
					? {
							...node,
							payload: {
								kind: "grain",
								texture,
								...(nextRevealPaint ? { revealPaint: nextRevealPaint } : {}),
							},
						}
					: node,
			),
		}) ?? null
	);
};

/**
 * Clears the node-local particle material after scoped graph extraction. Grain is
 * also disabled because the particle amount was consumed into the scoped graph;
 * leaving it active would render a second plain film-grain pass on the object.
 */
export const visualRecipeWithoutParticleMaterial = (
	recipe: VisualRecipe,
): VisualRecipe | null => {
	if (!textureMaterialIsParticle(recipe.texture)) return null;
	const next = normalizeVisualRecipe({
		...recipe,
		texture: {
			...recipe.texture,
			grain: {
				...recipe.texture.grain,
				enabled: false,
				strength: 0,
				densityCoupling: 0,
			},
			material: { ...recipe.texture.material, mode: "off" },
		},
	});
	return JSON.stringify(recipe) === JSON.stringify(next) ? null : next;
};
