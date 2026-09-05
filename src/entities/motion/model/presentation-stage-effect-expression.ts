import {
	type EffectExpressionBinding,
	resolveEffectExpression,
	resolveEffectInfluenceExpression,
} from "@/entities/scene/model/effect-expression-binding";
import {
	type ResolvedFrameEffectIntent,
	resolveFrameEffectIntent,
} from "@/entities/scene/model/recipe-resolve";
import { selectAllArtboards } from "@/entities/scene/model/selectors";
import type { EffectIntent, SceneDocument } from "@/entities/scene/model/types";
import { expressionFrameTime } from "@/shared/expr-dsl";
import {
	type EffectInfluenceRecipe,
	NEUTRAL_VISUAL_RECIPE,
	type VisualRecipe,
} from "@/shared/vec-core";
import {
	replaceArtboardEffectIntent,
	withoutSceneEffectIntent,
} from "./presentation-effect-intent-scene-ops";

/**
 * Time (seconds) for a frame at a given fps. Re-exported from `shared/expr-dsl`
 * so every expression seam — including camera-channel expressions, which are
 * sampled from `entities/scene` and cannot import this module — reads one
 * definition.
 */
export const frameExpressionTime = expressionFrameTime;

export const frameExpressionBindings = (
	bindings: readonly EffectExpressionBinding[],
): readonly EffectExpressionBinding[] =>
	bindings.filter((binding) => binding.targetRef.kind !== "node");

export const expressionBindingsForSceneTarget = (
	bindings: readonly EffectExpressionBinding[],
): readonly EffectExpressionBinding[] =>
	bindings.filter((binding) => binding.targetRef.kind === "scene");

export const expressionBindingsForArtboardTarget = (
	bindings: readonly EffectExpressionBinding[],
	artboardId: string,
): readonly EffectExpressionBinding[] =>
	bindings.filter(
		(binding) =>
			binding.targetRef.kind === "artboard" &&
			binding.targetRef.artboardId === artboardId,
	);

const frameExpressionBindingWritesVisualRecipe = (
	binding: EffectExpressionBinding,
): boolean => "recipePath" in binding;

const frameExpressionBindingWritesInfluenceRecipe = (
	binding: EffectExpressionBinding,
): boolean => "influenceField" in binding;

export const expressionBindingsForResolvedFrameIntent = (
	bindings: readonly EffectExpressionBinding[],
	resolved: ResolvedFrameEffectIntent,
): readonly EffectExpressionBinding[] =>
	bindings.filter((binding) => {
		if (binding.targetRef.kind !== "scene") return true;
		if (frameExpressionBindingWritesVisualRecipe(binding)) {
			return resolved.visualRecipeSource !== "artboard";
		}
		if (frameExpressionBindingWritesInfluenceRecipe(binding)) {
			return resolved.influenceRecipeSource !== "artboard";
		}
		return false;
	});

/**
 * Exported so `presentation.ts` can type the injected `evaluateExpressionSlots`
 * dependency of `sampleMotionPresentationEffectIntent` without a value import of
 * {@link sampleFrameEffectExpressionSlots} itself — the lean/flat composers
 * inject a no-op instead (see `presentation.ts`'s `leanEvaluateExpressionSlots`),
 * letting this module's real evaluator (and the recipe/effect-capability chain
 * it pulls in) tree-shake out of the LEAN/FLAT runtime-sampler bundles.
 */
export type FrameEffectExpressionSlotSample = {
	readonly visualRecipe: VisualRecipe | null;
	readonly visualRecipeExpressionApplied: boolean;
	readonly influenceRecipe: EffectInfluenceRecipe | null;
	readonly influenceRecipeExpressionApplied: boolean;
};

export const sampleFrameEffectExpressionSlots = ({
	bindings,
	visualRecipe,
	influenceRecipe,
	frame,
	fps,
}: {
	readonly bindings: readonly EffectExpressionBinding[];
	readonly visualRecipe: VisualRecipe | null;
	readonly influenceRecipe: EffectInfluenceRecipe | null;
	readonly frame: number;
	readonly fps?: number;
}): FrameEffectExpressionSlotSample => {
	const context = { time: frameExpressionTime(frame, fps), frame };
	let nextVisualRecipe = visualRecipe ?? NEUTRAL_VISUAL_RECIPE;
	let visualRecipeExpressionApplied = false;
	let nextInfluenceRecipe = influenceRecipe;
	let influenceRecipeExpressionApplied = false;
	for (const binding of bindings) {
		const visual = resolveEffectExpression(binding, nextVisualRecipe, context);
		if (visual) {
			nextVisualRecipe = visual;
			visualRecipeExpressionApplied = true;
			continue;
		}
		const influence = resolveEffectInfluenceExpression(
			binding,
			nextInfluenceRecipe,
			context,
		);
		if (influence) {
			nextInfluenceRecipe = influence;
			influenceRecipeExpressionApplied = true;
		}
	}
	return {
		visualRecipe: visualRecipeExpressionApplied
			? nextVisualRecipe
			: visualRecipe,
		visualRecipeExpressionApplied,
		influenceRecipe: influenceRecipeExpressionApplied
			? nextInfluenceRecipe
			: influenceRecipe,
		influenceRecipeExpressionApplied,
	};
};

export const effectIntentWithExpressionSlots = (
	base: EffectIntent | undefined,
	sample: FrameEffectExpressionSlotSample,
): EffectIntent | undefined => {
	if (
		!sample.visualRecipeExpressionApplied &&
		!sample.influenceRecipeExpressionApplied
	) {
		return base;
	}
	const intent = {
		...base,
		...(sample.visualRecipeExpressionApplied && sample.visualRecipe
			? { visualRecipe: sample.visualRecipe }
			: {}),
		...(sample.influenceRecipeExpressionApplied && sample.influenceRecipe
			? { influenceRecipe: sample.influenceRecipe }
			: {}),
	} satisfies EffectIntent;
	return intent.visualRecipe || intent.influenceRecipe || intent.scopedLooks
		? intent
		: undefined;
};

/**
 * Effect-expression presentation stage: overlays scene/artboard
 * effect-expression bindings onto the frame's `effectIntent`. Reference-
 * preserving identity when there are no bindings, skippable by a lean composer.
 */
export const sampleFrameEffectExpressionScene = ({
	scene,
	frame,
	fps,
}: {
	readonly scene: SceneDocument;
	readonly frame: number;
	readonly fps?: number;
}): SceneDocument => {
	const bindings = frameExpressionBindings(
		scene.effectExpressionBindings ?? [],
	);
	if (bindings.length === 0) return scene;
	let nextScene = scene;
	const sceneSample = sampleFrameEffectExpressionSlots({
		bindings: expressionBindingsForSceneTarget(bindings),
		visualRecipe: scene.effectIntent?.visualRecipe ?? null,
		influenceRecipe: scene.effectIntent?.influenceRecipe ?? null,
		frame,
		fps,
	});
	const sceneEffectIntent = effectIntentWithExpressionSlots(
		scene.effectIntent,
		sceneSample,
	);
	if (sceneEffectIntent !== scene.effectIntent) {
		const rest = withoutSceneEffectIntent(nextScene);
		nextScene = sceneEffectIntent
			? { ...rest, effectIntent: sceneEffectIntent }
			: rest;
	}

	const artboardIds = new Set(
		bindings.flatMap((binding) =>
			binding.targetRef.kind === "artboard"
				? [binding.targetRef.artboardId]
				: [],
		),
	);
	for (const artboardId of artboardIds) {
		const artboard = selectAllArtboards(nextScene).find(
			(item) => item.id === artboardId,
		);
		if (!artboard) continue;
		const resolved = resolveFrameEffectIntent(nextScene, artboardId);
		const artboardSample = sampleFrameEffectExpressionSlots({
			bindings: expressionBindingsForArtboardTarget(bindings, artboardId),
			visualRecipe: resolved.visualRecipe,
			influenceRecipe: resolved.influenceRecipe,
			frame,
			fps,
		});
		const effectIntent = effectIntentWithExpressionSlots(
			artboard.effectIntent,
			artboardSample,
		);
		if (effectIntent !== artboard.effectIntent) {
			nextScene = replaceArtboardEffectIntent(
				nextScene,
				artboardId,
				effectIntent,
			);
		}
	}
	return nextScene;
};
