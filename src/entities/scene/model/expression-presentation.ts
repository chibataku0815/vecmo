/**
 * Composes Codeable-Effect and Codeable-Duplicate side-cars into the per-frame
 * grammar presentation sampler.
 *
 * This wraps the optional motion-grammar sampler and folds in the scene's
 * node-targeted `effectExpressionBindings` (as `recipeOverride` on the target
 * node's {@link GrammarNodeSample}) and `duplicateGenerators` (as extra
 * {@link GrammarDuplicateSample} entries). CRITICAL: it returns a working sampler
 * even when there are NO grammar bindings — a plain node with only a generator must
 * still render its instances, which the bare grammar sampler (undefined for empty
 * bindings) would drop. The result is a normal `GrammarFrameSampler`, so the existing
 * presentation bridge consumes it unchanged.
 *
 * Pure and deterministic: it reads the scene for base recipes/positions only and runs
 * the same kernel the exported runtime inlines, so editor preview matches export.
 *
 * The duplicate-generator half is split out as {@link buildDuplicateOnlyFrameSampler}
 * so the LEAN/FLAT export sampler tiers (`render-presentation-lean.ts`,
 * `render-presentation-flat.ts`) can import ONLY that function: those tiers'
 * predicate (`code.ts`'s `selectMotionArtifactRuntimeSamplerTier`) already
 * guarantees a LEAN/FLAT-selected scene has no effect-expression bindings, so a
 * LEAN/FLAT caller never needs (and must never statically reference) the
 * `effect-expression-binding.ts`/`recipe-controls.ts`/`recipe-resolve.ts` chain
 * this module also pulls in for the effect-binding half. `buildExpressionAwareFrameSampler`
 * (FULL's combined path) delegates to the same function for its duplicate
 * expansion, so the two never fork the math.
 */

import type {
	GrammarFrameSample,
	GrammarFrameSampler,
	GrammarNodeSample,
} from "@/entities/motion/model/grammar-bridge";
import { NEUTRAL_VISUAL_RECIPE } from "@/shared/vec-core";
import { expandDuplicateGenerator } from "./duplicate-generator";
import {
	type EffectExpressionBinding,
	resolveEffectExpression,
} from "./effect-expression-binding";
import { resolveNodeRecipe } from "./recipe-resolve";
import { findNode } from "./selectors";
import type { SceneDocument } from "./types";

const EMPTY_FRAME: GrammarFrameSample = {
	samples: new Map<string, GrammarNodeSample>(),
	duplicates: [],
};

const resolveBaseFrame = (
	sampler: GrammarFrameSampler | undefined,
	frame: number,
): GrammarFrameSample => {
	if (!sampler) return EMPTY_FRAME;
	const sample = sampler(frame);
	return "samples" in sample ? sample : { samples: sample, duplicates: [] };
};

/** Inputs for {@link buildExpressionAwareFrameSampler}. */
export type ExpressionPresentationInput = {
	readonly scene: SceneDocument;
	/** Canonical playback fps; drives `time = frame / fps` for every expression. */
	readonly fps: number;
	/** The bare motion-grammar sampler to layer expression side-cars over. */
	readonly baseSampler?: GrammarFrameSampler;
};

const groupNodeEffectBindings = (
	bindings: readonly EffectExpressionBinding[],
): ReadonlyMap<string, readonly EffectExpressionBinding[]> => {
	const grouped = new Map<string, EffectExpressionBinding[]>();
	for (const binding of bindings) {
		if (binding.targetRef.kind !== "node") continue;
		const list = grouped.get(binding.targetRef.nodeId) ?? [];
		list.push(binding);
		grouped.set(binding.targetRef.nodeId, list);
	}
	return grouped;
};

/**
 * Duplicate-generator-only frame sampler: the minimal slice of
 * {@link buildExpressionAwareFrameSampler} a scene with `duplicateGenerators`
 * but no `effectExpressionBindings` and no grammar bindings actually needs.
 * Statically references only {@link expandDuplicateGenerator} (and the
 * `expr-dsl` chain it evaluates over), never the effect-binding/recipe
 * modules, so LEAN/FLAT export sampler bundles that import ONLY this function
 * never pull in `effect-expression-binding.ts`/`recipe-controls.ts`/
 * `recipe-resolve.ts`. Returns `undefined` when the scene has no duplicate
 * generators, matching `buildExpressionAwareFrameSampler`'s "no side-cars →
 * no sampler" contract. Every returned frame sample is freshly allocated
 * (never a shared/reused object), matching this module's general allocation
 * discipline for `GrammarFrameSample` values.
 */
export function buildDuplicateOnlyFrameSampler(
	scene: SceneDocument,
	fps: number,
): GrammarFrameSampler | undefined {
	const generators = scene.duplicateGenerators ?? [];
	if (generators.length === 0) return undefined;
	const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
	return (frame: number): GrammarFrameSample => {
		const time = frame / safeFps;
		const duplicates = generators.flatMap((generator) =>
			expandDuplicateGenerator(generator, { time, frame }),
		);
		return { samples: new Map(), duplicates };
	};
}

/**
 * Builds a frame sampler that layers effect-expression recipe overrides and
 * duplicate-generator instances over an optional base grammar sampler. Returns
 * `undefined` only when there is nothing to sample (no base sampler and no side-cars),
 * so callers can pass the result straight through as `grammar`.
 */
export function buildExpressionAwareFrameSampler(
	input: ExpressionPresentationInput,
): GrammarFrameSampler | undefined {
	const effectBindings = input.scene.effectExpressionBindings ?? [];
	const generators = input.scene.duplicateGenerators ?? [];
	if (
		!input.baseSampler &&
		effectBindings.length === 0 &&
		generators.length === 0
	) {
		return undefined;
	}
	const fps = Number.isFinite(input.fps) && input.fps > 0 ? input.fps : 30;
	const nodeEffectBindings = groupNodeEffectBindings(effectBindings);
	const duplicateSampler = buildDuplicateOnlyFrameSampler(input.scene, fps);

	return (frame: number): GrammarFrameSample => {
		const base = resolveBaseFrame(input.baseSampler, frame);
		const time = frame / fps;
		const samples = new Map(base.samples);

		for (const [nodeId, bindings] of nodeEffectBindings) {
			const node = findNode(input.scene, nodeId);
			if (!node) continue;
			const existing = samples.get(nodeId);
			let recipe =
				existing?.recipeOverride ??
				resolveNodeRecipe(node) ??
				NEUTRAL_VISUAL_RECIPE;
			let changed = false;
			for (const binding of bindings) {
				const next = resolveEffectExpression(binding, recipe, { time, frame });
				if (next) {
					recipe = next;
					changed = true;
				}
			}
			if (!changed) continue;
			samples.set(nodeId, {
				...(existing ?? { nodeId }),
				recipeOverride: recipe,
			});
		}

		const generated = resolveBaseFrame(duplicateSampler, frame).duplicates;
		return {
			samples,
			duplicates:
				generated.length > 0
					? [...base.duplicates, ...generated]
					: base.duplicates,
		};
	};
}
