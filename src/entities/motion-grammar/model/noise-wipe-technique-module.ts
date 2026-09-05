import type { MotionCommand } from "@/entities/motion/model/command";
import type { SceneCommand } from "@/entities/scene/model/command";
import { createUpdateNodeRecipeCommand } from "@/entities/scene/model/node-commands";
import { resolveNodeRecipe } from "@/entities/scene/model/recipe-resolve";
import { findNode } from "@/entities/scene/model/selectors";
import type { SceneDocument } from "@/entities/scene/model/types";
import {
	NEUTRAL_VISUAL_RECIPE,
	normalizeVisualRecipe,
	type TextureMaterialReveal,
	type TextureRecipe,
	textureParticleLinearFieldFromAngle,
	type VisualRecipe,
} from "@/shared/vec-core";
import type {
	MotionGrammarAuthoringParameterGroup,
	MotionGrammarAuthoringParameterRole,
	MotionGrammarAuthoringParameterSpec,
	MotionGrammarAuthoringProfileDescriptor,
} from "./authoring-profile";
import { findCatalogEntry } from "./catalog";
import type { MotionGrammarBinding, MotionGrammarParamSpec } from "./types";

const NOISE_WIPE_TECHNIQUE_ID = "noise-wipe";

/**
 * One resolved target: the node id plus its recipe at plan time. Every other
 * promoted module snapshots the scene state it needs (artboard, generated
 * nodes, etc.) into its plan at `createWorkspacePlan` time and applies that
 * snapshot from `createSceneCommands`/`createMotionCommands`, which take only
 * the plan — not a live `scene` — as input; noise-wipe follows the same
 * convention by capturing each target's current {@link VisualRecipe} here.
 */
type NoiseWipeTarget = {
	readonly nodeId: string;
	readonly currentRecipe: VisualRecipe;
};

/**
 * Ready plan for the noise-wipe technique. Unlike the other promoted modules
 * this creates no scene nodes: it seeds and animates `material.reveal` /
 * `material.linearField` directly on each selected target's own recipe. The
 * common `generatedNodes: []` / `nextSelectionNodeIds` fields exist purely so
 * this plan satisfies the same shape the Inspector widget reads
 * polymorphically across every `MotionGrammarTechniqueWorkspacePlan` member
 * (it always reads `.plan.binding`, `.plan.generatedNodes.length`,
 * `.plan.nextSelectionNodeIds`).
 */
export type NoiseWipePlan =
	| {
			readonly status: "blocked";
			readonly reason: string;
	  }
	| {
			readonly status: "ready";
			readonly techniqueId: "noise-wipe";
			readonly binding: MotionGrammarBinding;
			readonly targets: readonly NoiseWipeTarget[];
			readonly generatedNodes: readonly [];
			/**
			 * Never set: noise-wipe generates no nodes, so there is no target layer.
			 * Declared (like every other "ready" plan variant) only so the generic
			 * `createAppendGeneratedSceneCommands` helper in `technique-module.ts`
			 * type-checks across the whole `MotionGrammarTechniqueWorkspacePlan`
			 * union; noise-wipe never calls that helper.
			 */
			readonly layerId?: string;
			readonly roleMap: Readonly<Record<string, string>>;
			readonly selectedSourceNodeIds: readonly string[];
			readonly nextSelectionNodeIds: readonly string[];
	  };

export type ReadyNoiseWipePlan = Extract<
	NoiseWipePlan,
	{ readonly status: "ready" }
>;

const bindingNumber = (
	binding: MotionGrammarBinding,
	key: string,
	fallback: number,
): number => {
	const value = binding.parameters[key];
	return Number.isFinite(value) ? value : fallback;
};

/**
 * Sweep length in frames, floored to at least one frame. Exported so
 * `evaluator.ts`'s per-frame `"noise-wipe"` case can normalize the same
 * `durationFrames` binding parameter this module seeds from, matching how
 * other techniques' evaluator cases import their own duration/timing helpers
 * (e.g. `glammerTimeDelayAuthoringTiming` from `time-delay-materialization.ts`).
 */
export const noiseWipeDurationFrames = (
	binding: MotionGrammarBinding,
): number =>
	Math.max(1, Math.round(bindingNumber(binding, "durationFrames", 36)));

/**
 * `mode` is stored as 0 (reveal-in) / 1 (dissolve-out); >= 0.5 reads as "out".
 * Exported for the same reason as {@link noiseWipeDurationFrames}.
 */
export const isRevealOut = (binding: MotionGrammarBinding): boolean =>
	bindingNumber(binding, "mode", 0) >= 0.5;

const clamp01 = (value: number): number => Math.min(Math.max(value, 0), 1);

/**
 * Merges a seeded `material.reveal` + `material.linearField` onto a target's
 * current texture. `progress` starts at the fully-hidden end for the binding's
 * `mode` (0 for "in", 1 for "out") so the object reads correctly before the
 * animated sweep begins; the motion command then keyframes `progress` toward
 * the opposite end. The linear field spans the full target-space bounds along
 * `angle` with `plateau: 0` (a clean full-length ramp, no solid-side hold), so
 * the directional field is valid from the moment the reveal is seeded,
 * independent of whatever field the node's material previously authored.
 */
const noiseWipeTexturePatch = (
	binding: MotionGrammarBinding,
	current: TextureRecipe,
): TextureRecipe => {
	const angle = bindingNumber(binding, "angle", 0);
	const softness = clamp01(bindingNumber(binding, "softness", 0.35));
	const noiseWeight = clamp01(bindingNumber(binding, "noiseWeight", 0.4));
	const mode: TextureMaterialReveal["mode"] = isRevealOut(binding)
		? "out"
		: "in";
	const reveal: TextureMaterialReveal = {
		progress: mode === "out" ? 1 : 0,
		softness,
		noiseWeight,
		mode,
	};
	return {
		...current,
		material: {
			...current.material,
			linearField: textureParticleLinearFieldFromAngle(angle, 1),
			reveal,
		},
	};
};

/**
 * Plans the noise-wipe technique for the current selection. Every selected
 * node that still exists becomes a target; there is no minimum-target role
 * system to fill (each target only edits its own recipe), so the plan never
 * blocks on "not enough targets" the way role-bearing workspace systems do —
 * only an empty/all-missing selection blocks.
 */
export function createNoiseWipePlan({
	scene,
	selectedNodeIds,
	bindingId,
}: {
	readonly scene: SceneDocument;
	readonly selectedNodeIds: readonly string[];
	readonly bindingId?: string;
}): NoiseWipePlan {
	const seen = new Set<string>();
	const targets: NoiseWipeTarget[] = [];
	for (const nodeId of selectedNodeIds) {
		if (seen.has(nodeId)) continue;
		const node = findNode(scene, nodeId);
		if (!node) continue;
		seen.add(nodeId);
		targets.push({
			nodeId,
			currentRecipe: resolveNodeRecipe(node) ?? NEUTRAL_VISUAL_RECIPE,
		});
	}
	if (targets.length === 0) {
		return {
			status: "blocked",
			reason: "Select at least one object for the noise-wipe reveal.",
		};
	}
	const targetIds = targets.map((target) => target.nodeId);
	const id =
		bindingId ??
		`motion-grammar:${NOISE_WIPE_TECHNIQUE_ID}:${targetIds.join("+")}`;
	const binding: MotionGrammarBinding = {
		id,
		techniqueId: NOISE_WIPE_TECHNIQUE_ID,
		targetIds,
		parameters: {
			durationFrames: 36,
			angle: 0,
			softness: 0.35,
			noiseWeight: 0.4,
			mode: 0,
		},
		effectBinding: { kind: "none" },
	};
	return {
		status: "ready",
		techniqueId: NOISE_WIPE_TECHNIQUE_ID,
		binding,
		targets,
		generatedNodes: [],
		roleMap: {},
		selectedSourceNodeIds: targetIds,
		nextSelectionNodeIds: targetIds,
	};
}

/**
 * Seeds `material.reveal`/`material.linearField` on every target's own recipe,
 * merged onto whichever recipe it carried at plan time. This must land before
 * the motion command's automation write: the automation bridge walks
 * `texture.material.reveal.progress` with an own-property check at every path
 * segment, so a target whose recipe never authored `reveal` would fail the
 * write with an invalid-path issue instead of animating.
 */
export function createNoiseWipeSceneCommands(
	plan: ReadyNoiseWipePlan,
	options: { readonly label: string; readonly coalesceKey: string },
): readonly SceneCommand[] {
	return plan.targets.map((target) => {
		const nextRecipe = normalizeVisualRecipe({
			...target.currentRecipe,
			texture: noiseWipeTexturePatch(
				plan.binding,
				target.currentRecipe.texture,
			),
		});
		return {
			...createUpdateNodeRecipeCommand(target.nodeId, nextRecipe),
			label: options.label,
			coalesceKey: `${options.coalesceKey}:${target.nodeId}`,
		};
	});
}

/**
 * Noise-wipe is sample-driven, not track-driven: `evaluator.ts`'s
 * `sampleGrammarFrameDirect` switch has a `"noise-wipe"` case that recomputes
 * `texture.material.reveal.progress` from the binding's `durationFrames`/`mode`
 * every frame and emits it as a `recipeOverride`, the same live per-frame
 * mechanism every other promoted technique uses (see
 * `describeNoiseWipeAuthoringProfile`'s `timeline.mode: "trackless-expression"`).
 * This module therefore writes no `MotionCommand` at all — an `AutomationTrack`
 * keyframing `progress` would be redundant with, and could conflict with, the
 * evaluator's own per-frame computation, and the vec-core presentation bridge
 * that would sample such a track never applies a per-node `effectParam`/recipe
 * write back onto the rendered scene (see `presentation.ts`'s
 * `MotionPresentationNodeAppearance` doc comment) — so a track here would be
 * silently inert. `createSceneCommands` still seeds the base `reveal`/
 * `linearField` state so the object reads correctly before any per-frame
 * override is composed, and so the Inspector's authoring profile has a real
 * `material.reveal` to reflect.
 */
export function createNoiseWipeMotionCommands(
	_plan: ReadyNoiseWipePlan,
	_options: { readonly label: string; readonly coalesceKey: string },
): readonly MotionCommand[] {
	return [];
}

type NoiseWipeParameterGroupDefinition = {
	readonly id: string;
	readonly label: string;
	readonly intent: string;
	readonly parameters: readonly {
		readonly key: string;
		readonly role: MotionGrammarAuthoringParameterRole;
		readonly advanced?: boolean;
	}[];
};

/**
 * Groups the five noise-wipe params for the Inspector's authoring surface.
 * `durationFrames`/`mode` govern when and which direction the sweep runs;
 * `angle` is the wipe's travel direction; `softness`/`noiseWeight` are the
 * edge's visual quality. Mirrors the grouping convention in
 * `time-offset-authoring-profile.ts`'s `TIME_OFFSET_PARAMETER_GROUPS`.
 */
const NOISE_WIPE_PARAMETER_GROUPS: readonly NoiseWipeParameterGroupDefinition[] =
	[
		{
			id: "timing",
			label: "Timing",
			intent: "Controls how long the sweep takes and which way it plays.",
			parameters: [
				{ key: "durationFrames", role: "timing" },
				{ key: "mode", role: "timing" },
			],
		},
		{
			id: "wipe",
			label: "Wipe",
			intent: "Controls the sweep's travel direction and edge quality.",
			parameters: [
				{ key: "angle", role: "motion" },
				{ key: "softness", role: "look" },
				{ key: "noiseWeight", role: "look" },
			],
		},
	] as const;

const isDefined = <T>(value: T | undefined): value is T => value !== undefined;

const noiseWipeCatalogSpecsByKey = (): ReadonlyMap<
	string,
	MotionGrammarParamSpec
> => {
	const specs = new Map<string, MotionGrammarParamSpec>();
	for (const spec of findCatalogEntry(NOISE_WIPE_TECHNIQUE_ID)?.params ?? []) {
		specs.set(spec.key, spec);
	}
	return specs;
};

const noiseWipeAuthoringParameter = ({
	spec,
	role,
	advanced,
}: {
	readonly spec: MotionGrammarParamSpec;
	readonly role: MotionGrammarAuthoringParameterRole;
	readonly advanced?: boolean;
}): MotionGrammarAuthoringParameterSpec => ({
	...spec,
	role,
	...(advanced !== undefined ? { advanced } : {}),
});

/**
 * Describes noise-wipe's authoring profile. Every instance is a real,
 * pre-existing scene node (`reference.kind: "scene-node"`, instance `kind:
 * "source"`) — unlike `"presentation-duplicates"`, which `authoring-profile.ts`
 * reserves for runtime-only draw artifacts that must not be treated as
 * layer-panel nodes. There is no driver/follower role split (unlike
 * time-offset's slot conveyor): every target independently wipes its own
 * recipe, so `kind: "master-instances"` is the closest of the four profile
 * kinds even though no single target plays a "master" role here.
 * `timeline.mode: "trackless-expression"` with `bakePolicy: "not-supported"`
 * reflects that `evaluator.ts`'s `"noise-wipe"` case recomputes `progress`
 * from the binding every frame — the same live, sample-driven mechanism every
 * other promoted technique uses — so there are no keyframe tracks to bake.
 * Field shape matches `describeTimeOffsetPropagationAuthoringProfile` exactly
 * so the Inspector's `MotionAuthoringProfileGroup`/`MotionParameterField`
 * renderers see the same contract every other promoted technique provides.
 */
export function describeNoiseWipeAuthoringProfile(
	binding: MotionGrammarBinding,
): MotionGrammarAuthoringProfileDescriptor | undefined {
	if (binding.techniqueId !== NOISE_WIPE_TECHNIQUE_ID) return undefined;
	const specs = noiseWipeCatalogSpecsByKey();
	const direction = isRevealOut(binding) ? "out" : "in";
	const instances: MotionGrammarAuthoringProfileDescriptor["instances"] =
		binding.targetIds.map((nodeId, index) => ({
			index,
			slotId: `target:${index + 1}`,
			reference: { kind: "scene-node", nodeId },
			nodeId,
			role: "target",
			roleLabel: "wipe target",
			kind: "source",
			editable: true,
			replaceable: false,
		}));
	return {
		bindingId: binding.id,
		techniqueId: NOISE_WIPE_TECHNIQUE_ID,
		label: "Noise Wipe",
		summary:
			direction === "in"
				? "Each target sweeps from hidden to fully shown along the wipe angle."
				: "Each target sweeps from fully shown to hidden along the wipe angle.",
		kind: "master-instances",
		timeline: {
			mode: "trackless-expression",
			bakePolicy: "not-supported",
			durationParameterKey: "durationFrames",
		},
		expansion: {
			mode: "live-only",
			label: "Live semantic output",
			actionLabel: "Live output only",
			previewLabel: "Live output contract",
			description:
				"Noise Wipe drives per-node reveal recipe overrides directly; edit its semantic parameters or remove the binding instead of baking an inert automation track.",
			outputSummary:
				"Each target stays an editable scene object while reveal progress remains a live Motion Grammar channel with no equivalent MotionDocument track.",
		},
		parameterGroups: NOISE_WIPE_PARAMETER_GROUPS.map((group) => ({
			id: group.id,
			label: group.label,
			intent: group.intent,
			parameters: group.parameters
				.map((parameter) => {
					const spec = specs.get(parameter.key);
					return spec
						? noiseWipeAuthoringParameter({
								spec,
								role: parameter.role,
								advanced: parameter.advanced,
							})
						: undefined;
				})
				.filter(isDefined),
		})) satisfies readonly MotionGrammarAuthoringParameterGroup[],
		instances,
		roleSlots: instances,
		recipeRoles: ["target"],
	};
}
