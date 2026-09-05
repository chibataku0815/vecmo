import type { MotionCommand } from "@/entities/motion/model/command";
import type { CreateAnimationClipInput } from "@/entities/motion/model/commands";
import type { SceneCommand } from "@/entities/scene/model/command";
import { createAppendNodeCommand } from "@/entities/scene/model/node-commands";
import type { SceneDocument } from "@/entities/scene/model/types";
import { createId } from "@/shared/lib/id";
import { describeGlammerAfterimageAuthoringProfile } from "./afterimage-authoring-profile";
import {
	createAfterimageMasterRotationEchoPlan,
	createApplyAfterimageMasterRotationEchoSceneCommand,
	describeGlammerAfterimageMasterRotationEchoProfile,
	GLAMMER_AFTERIMAGE_PROFILE_VERSION,
	GLAMMER_AFTERIMAGE_REFERENCE_FRAME,
	type ReadyAfterimageMasterRotationEchoPlan,
} from "./afterimage-master-rotation-echo";
import type { MotionGrammarAuthoringProfileDescriptor } from "./authoring-profile";
import { findCatalogEntry } from "./catalog";
import { COLLISION_BOUNCE_V1 } from "./collision-bounce-v1";
import { COUNT_GROWTH_V1 } from "./count-growth-v1";
import { projectMotionExpressionAuthoringProfile } from "./expression-projection";
import { FOLLOW_THROUGH_V1 } from "./follow-through-v1";
import { GLAMMER_CYCLE_V1 } from "./glammer-cycle-v1";
import { INTERFERENCE_RING_V1 } from "./interference-ring-v1";
import { INVERSE_PROPORTION_V1 } from "./inverse-proportion-v1";
import { MERGE_SPLIT_V1 } from "./merge-split-v1";
import {
	createNoiseWipeMotionCommands,
	createNoiseWipePlan,
	createNoiseWipeSceneCommands,
	describeNoiseWipeAuthoringProfile,
	type ReadyNoiseWipePlan,
} from "./noise-wipe-technique-module";
import { PARALLAX_WAVE_V1 } from "./parallax-wave-v1";
import { RANDOM_PULSE_PROFILE_DEFAULT } from "./random-pulse-profile";
import { RANDOM_PULSE_V1 } from "./random-pulse-v1";
import { SYMMETRY_PULSE_V1 } from "./symmetry-pulse-v1";
import {
	createApplyTimeDelayMaterializationMotionCommand,
	createApplyTimeDelayMaterializationSceneCommand,
	createTimeDelayMaterializationPlan,
	describeGlammerTimeDelayAuthoringProfile,
	GLAMMER_TIME_DELAY_REFERENCE_FRAME,
	type ReadyTimeDelayMaterializationPlan,
} from "./time-delay-materialization";
import {
	createApplyTimeOffsetPropagationMotionCommand,
	createApplyTimeOffsetPropagationSceneCommand,
	createTimeOffsetPropagationPlan,
	describeTimeOffsetPropagationAuthoringProfile,
	type ReadyTimeOffsetPropagationPlan,
	TIME_OFFSET_REFERENCE_FRAME,
} from "./time-offset-authoring-profile";
import type { MotionGrammarBinding, MotionGrammarTechniqueId } from "./types";
import {
	createMotionGrammarWorkspaceInstancePlan,
	type MotionGrammarWorkspaceInstancePlan,
} from "./workspace-instance";

export type MotionGrammarTechniqueWorkspacePlan =
	| Extract<MotionGrammarWorkspaceInstancePlan, { readonly status: "ready" }>
	| ReadyTimeDelayMaterializationPlan
	| ReadyAfterimageMasterRotationEchoPlan
	| ReadyTimeOffsetPropagationPlan
	| ReadyNoiseWipePlan;

export type MotionGrammarTechniqueWorkspacePreview =
	| {
			readonly status: "blocked";
			readonly reason: string;
	  }
	| {
			readonly status: "ready";
			readonly label: string;
			readonly plan: MotionGrammarTechniqueWorkspacePlan;
	  };

/**
 * Technique-owned authoring module. A module is the only place where a promoted
 * Glammer motion technique explains its semantic profile, workspace-system
 * creation, scene/motion command writes, and optional initial transport frame.
 */
export type MotionGrammarTechniqueModule = {
	readonly techniqueId: MotionGrammarTechniqueId;
	readonly createLabel: string;
	/**
	 * True only for a technique whose visual effect is NOT produced by live
	 * per-frame sampling (`sampleGrammarFrameDirect`'s expression registry /
	 * technique switch in `evaluator.ts`) and therefore has no effect at all
	 * until its `createSceneCommands`/`createMotionCommands` run. Every other
	 * promoted technique is sample-driven: applying a bare binding (no scene or
	 * motion writes) is already a complete, correct apply, and the module's
	 * `createSceneCommands` is reserved for the separate, heavier "Create
	 * System" workspace materialization (e.g. time-offset-propagation's scene
	 * command replaces the artboard). A commit-on-apply module must not be
	 * treated as sample-driven or its effect silently never appears; a
	 * sample-driven module must not have its scene commands run automatically
	 * on Apply or it triggers that heavier materialization unexpectedly.
	 * Absent/false is the default and matches every module before noise-wipe.
	 */
	readonly commitsOnApply?: boolean;
	readonly describeAuthoringProfile: (
		binding: MotionGrammarBinding,
	) => MotionGrammarAuthoringProfileDescriptor | undefined;
	readonly createWorkspacePlan: (input: {
		readonly scene: SceneDocument;
		readonly selectedNodeIds: readonly string[];
	}) =>
		| MotionGrammarTechniqueWorkspacePlan
		| { readonly status: "blocked"; readonly reason: string };
	readonly createSceneCommands: (
		plan: MotionGrammarTechniqueWorkspacePlan,
		options: {
			readonly label: string;
			readonly coalesceKey: string;
		},
	) => readonly SceneCommand[];
	readonly createMotionCommands?: (
		plan: MotionGrammarTechniqueWorkspacePlan,
		options: {
			readonly label: string;
			readonly coalesceKey: string;
		},
	) => readonly MotionCommand[];
	readonly createWorkspaceClipInput?: (
		plan: MotionGrammarTechniqueWorkspacePlan,
	) => CreateAnimationClipInput | null;
	readonly createdClipId?: (
		plan: MotionGrammarTechniqueWorkspacePlan,
	) => string | null;
	readonly initialFrame?: (
		plan: MotionGrammarTechniqueWorkspacePlan,
	) => number | null;
};

const isTimeDelayWorkspacePlan = (
	plan: MotionGrammarTechniqueWorkspacePlan,
): plan is ReadyTimeDelayMaterializationPlan =>
	plan.techniqueId === "time-delay" && "tracks" in plan && "clip" in plan;

const isAfterimageMasterRotationEchoPlan = (
	plan: MotionGrammarTechniqueWorkspacePlan,
): plan is ReadyAfterimageMasterRotationEchoPlan =>
	plan.techniqueId === "periodic-afterimage" &&
	"clip" in plan &&
	plan.binding.parameters.profileVersion === GLAMMER_AFTERIMAGE_PROFILE_VERSION;

const isTimeOffsetPropagationPlan = (
	plan: MotionGrammarTechniqueWorkspacePlan,
): plan is ReadyTimeOffsetPropagationPlan =>
	plan.techniqueId === "time-offset-propagation" &&
	"tracks" in plan &&
	"clip" in plan;

const isNoiseWipePlan = (
	plan: MotionGrammarTechniqueWorkspacePlan,
): plan is ReadyNoiseWipePlan => plan.techniqueId === "noise-wipe";

const profilePeriodFrames = (
	profile: MotionGrammarAuthoringProfileDescriptor,
	binding: MotionGrammarBinding,
): number => {
	const durationParameterKey = profile.timeline.durationParameterKey;
	if (!durationParameterKey) return 1;
	const periodSpec = profile.parameterGroups
		.flatMap((group) => group.parameters)
		.find((parameter) => parameter.key === durationParameterKey);
	const value =
		binding.parameters[durationParameterKey] ?? periodSpec?.default ?? 1;
	return Math.max(1, Math.round(Number.isFinite(value) ? value : 1));
};

const createProfileBackedWorkspaceClipInput = ({
	plan,
	profile,
}: {
	readonly plan: MotionGrammarTechniqueWorkspacePlan;
	readonly profile: MotionGrammarAuthoringProfileDescriptor;
}): CreateAnimationClipInput | null => {
	if (isTimeDelayWorkspacePlan(plan)) return null;
	if (isAfterimageMasterRotationEchoPlan(plan)) return plan.clip;
	return {
		id: createId("clip"),
		name: profile.timeline.clipLabel ?? profile.label,
		startFrame: 0,
		durationFrames: profilePeriodFrames(profile, plan.binding),
		trackIds: [],
		provenance: {
			source: "motion-grammar",
			label: `${profile.label} authoring profile`,
			bindingId: plan.binding.id,
			techniqueId: plan.binding.techniqueId,
			techniqueLabel: profile.label,
			targetIds: [...plan.binding.targetIds],
			generatedNodeIds: plan.generatedNodes.map(
				(generated) => generated.node.id,
			),
		},
	};
};

const createAppendGeneratedSceneCommands = (
	plan: MotionGrammarTechniqueWorkspacePlan,
	options: { readonly label: string },
): readonly SceneCommand[] =>
	plan.generatedNodes.map((generated) =>
		createAppendNodeCommand(generated.node, {
			layerId: plan.layerId,
			label: options.label,
		}),
	);

const TIME_DELAY_TECHNIQUE_MODULE: MotionGrammarTechniqueModule = {
	techniqueId: "time-delay",
	createLabel: "Time Delay system",
	describeAuthoringProfile: (binding) =>
		describeGlammerTimeDelayAuthoringProfile(binding),
	createWorkspacePlan: ({ scene, selectedNodeIds }) =>
		createTimeDelayMaterializationPlan({ scene, selectedNodeIds }),
	createSceneCommands: (plan, options) =>
		isTimeDelayWorkspacePlan(plan)
			? [
					createApplyTimeDelayMaterializationSceneCommand(plan, {
						label: options.label,
						coalesceKey: options.coalesceKey,
					}),
				]
			: [],
	createMotionCommands: (plan, options) =>
		isTimeDelayWorkspacePlan(plan)
			? [
					createApplyTimeDelayMaterializationMotionCommand(plan, {
						label: options.label,
						coalesceKey: options.coalesceKey,
					}),
				]
			: [],
	createdClipId: (plan) =>
		isTimeDelayWorkspacePlan(plan) ? plan.clip.id : null,
	initialFrame: (plan) =>
		isTimeDelayWorkspacePlan(plan) ? GLAMMER_TIME_DELAY_REFERENCE_FRAME : null,
};

const TIME_OFFSET_TECHNIQUE_MODULE: MotionGrammarTechniqueModule = {
	techniqueId: "time-offset-propagation",
	createLabel: "Time Offset system",
	describeAuthoringProfile: (binding) =>
		describeTimeOffsetPropagationAuthoringProfile(binding),
	createWorkspacePlan: ({ scene, selectedNodeIds }) =>
		createTimeOffsetPropagationPlan({ scene, selectedNodeIds }),
	createSceneCommands: (plan, options) =>
		isTimeOffsetPropagationPlan(plan)
			? [
					createApplyTimeOffsetPropagationSceneCommand(plan, {
						label: options.label,
						coalesceKey: options.coalesceKey,
					}),
				]
			: [],
	createMotionCommands: (plan, options) =>
		isTimeOffsetPropagationPlan(plan)
			? [
					createApplyTimeOffsetPropagationMotionCommand(plan, {
						label: options.label,
						coalesceKey: options.coalesceKey,
					}),
				]
			: [],
	createdClipId: (plan) =>
		isTimeOffsetPropagationPlan(plan) ? plan.clip.id : null,
	initialFrame: (plan) =>
		isTimeOffsetPropagationPlan(plan) ? TIME_OFFSET_REFERENCE_FRAME : null,
};

const PERIODIC_AFTERIMAGE_TECHNIQUE_MODULE: MotionGrammarTechniqueModule = {
	techniqueId: "periodic-afterimage",
	createLabel: "Afterimage system",
	describeAuthoringProfile: (binding) =>
		describeGlammerAfterimageMasterRotationEchoProfile(binding) ??
		describeGlammerAfterimageAuthoringProfile(binding),
	createWorkspacePlan: ({ scene, selectedNodeIds }) =>
		createAfterimageMasterRotationEchoPlan({
			scene,
			selectedNodeIds,
		}),
	createSceneCommands: (plan, options) =>
		isAfterimageMasterRotationEchoPlan(plan)
			? [
					createApplyAfterimageMasterRotationEchoSceneCommand(plan, {
						label: options.label,
						coalesceKey: options.coalesceKey,
					}),
				]
			: createAppendGeneratedSceneCommands(plan, options),
	createWorkspaceClipInput: (plan) => {
		const profile =
			describeGlammerAfterimageMasterRotationEchoProfile(plan.binding) ??
			describeGlammerAfterimageAuthoringProfile(plan.binding);
		return profile
			? createProfileBackedWorkspaceClipInput({ plan, profile })
			: null;
	},
	initialFrame: (plan) =>
		isAfterimageMasterRotationEchoPlan(plan)
			? GLAMMER_AFTERIMAGE_REFERENCE_FRAME
			: null,
};

/** Quarter period: surfaces a visible orbit displacement immediately on create. */
const CYCLE_PREVIEW_PERIOD_FRACTION = 4;

/**
 * Cycle is the expression-backed pilot. Its authoring profile is PROJECTED from
 * {@link GLAMMER_CYCLE_V1} rather than hand-written, and its live motion is sampled
 * registry-first through the expression adapter (no evaluator switch case). It
 * reuses the generic workspace-instance planner: a selection orbits in place, an
 * empty selection generates a traveler.
 */
const CYCLE_TECHNIQUE_MODULE: MotionGrammarTechniqueModule = {
	techniqueId: "cyclic-path-travel",
	createLabel: "Cycle system",
	describeAuthoringProfile: (binding) =>
		projectMotionExpressionAuthoringProfile(GLAMMER_CYCLE_V1, binding),
	createWorkspacePlan: ({ scene, selectedNodeIds }) =>
		createMotionGrammarWorkspaceInstancePlan({
			techniqueId: "cyclic-path-travel",
			scene,
			selectedNodeIds,
		}),
	createSceneCommands: (plan, options) =>
		createAppendGeneratedSceneCommands(plan, options),
	createWorkspaceClipInput: (plan) => {
		const profile = projectMotionExpressionAuthoringProfile(
			GLAMMER_CYCLE_V1,
			plan.binding,
		);
		return profile
			? createProfileBackedWorkspaceClipInput({ plan, profile })
			: null;
	},
	initialFrame: (plan) => {
		const profile = projectMotionExpressionAuthoringProfile(
			GLAMMER_CYCLE_V1,
			plan.binding,
		);
		if (!profile) return null;
		return Math.round(
			profilePeriodFrames(profile, plan.binding) /
				CYCLE_PREVIEW_PERIOD_FRACTION,
		);
	},
};

/**
 * Collision Bounce is expression-backed like Cycle: its authoring profile is
 * PROJECTED from {@link COLLISION_BOUNCE_V1} and its live motion is sampled
 * registry-first through the expression adapter (no evaluator switch case).
 * It reuses the generic workspace-instance planner — a selection becomes
 * `subject` role members (and a generated `support` guide when the selection
 * does not already supply one), mirroring Cycle's body/path split.
 * `commitsOnApply` is left unset: applying a bare binding is already a
 * complete, correct sample-driven apply (see the type's doc comment).
 */
const COLLISION_BOUNCE_TECHNIQUE_MODULE: MotionGrammarTechniqueModule = {
	techniqueId: "collision-bounce",
	createLabel: "Collision Bounce system",
	describeAuthoringProfile: (binding) =>
		projectMotionExpressionAuthoringProfile(COLLISION_BOUNCE_V1, binding),
	createWorkspacePlan: ({ scene, selectedNodeIds }) =>
		createMotionGrammarWorkspaceInstancePlan({
			techniqueId: "collision-bounce",
			scene,
			selectedNodeIds,
		}),
	createSceneCommands: (plan, options) =>
		createAppendGeneratedSceneCommands(plan, options),
	createWorkspaceClipInput: (plan) => {
		const profile = projectMotionExpressionAuthoringProfile(
			COLLISION_BOUNCE_V1,
			plan.binding,
		);
		return profile
			? createProfileBackedWorkspaceClipInput({ plan, profile })
			: null;
	},
};

/**
 * Random Pulse is a sample-driven field: source cells stay editable and the
 * shared authored envelope is evaluated per frame. The generic workspace
 * planner supplies the role map; this module only adds the durable seed/profile
 * envelope so workspace creation and Agent application cannot silently fall
 * back to the legacy sine candidate.
 */
const RANDOM_PULSE_TECHNIQUE_MODULE: MotionGrammarTechniqueModule = {
	techniqueId: "random-phase-pulse",
	createLabel: "Random Pulse system",
	describeAuthoringProfile: (binding) =>
		projectMotionExpressionAuthoringProfile(RANDOM_PULSE_V1, binding),
	createWorkspacePlan: ({ scene, selectedNodeIds }) => {
		const plan = createMotionGrammarWorkspaceInstancePlan({
			techniqueId: "random-phase-pulse",
			scene,
			selectedNodeIds,
		});
		if (plan.status === "blocked") return plan;
		return {
			...plan,
			binding: {
				...plan.binding,
				parameters: {
					...plan.binding.parameters,
					pulseFrames: RANDOM_PULSE_PROFILE_DEFAULT.durationFrames,
				},
				seed: 13,
				randomPulseProfile: RANDOM_PULSE_PROFILE_DEFAULT,
			},
		};
	},
	createSceneCommands: (plan, options) =>
		createAppendGeneratedSceneCommands(plan, options),
	createWorkspaceClipInput: (plan) => {
		const profile = projectMotionExpressionAuthoringProfile(
			RANDOM_PULSE_V1,
			plan.binding,
		);
		return profile
			? createProfileBackedWorkspaceClipInput({ plan, profile })
			: null;
	},
};

/** Count Growth is a sample-driven lattice breath with a durable role map. */
const COUNT_GROWTH_TECHNIQUE_MODULE: MotionGrammarTechniqueModule = {
	techniqueId: "count-growth",
	createLabel: "Count Growth system",
	describeAuthoringProfile: (binding) =>
		projectMotionExpressionAuthoringProfile(COUNT_GROWTH_V1, binding),
	createWorkspacePlan: ({ scene, selectedNodeIds }) =>
		createMotionGrammarWorkspaceInstancePlan({
			techniqueId: "count-growth",
			scene,
			selectedNodeIds,
		}),
	createSceneCommands: (plan, options) =>
		createAppendGeneratedSceneCommands(plan, options),
	createWorkspaceClipInput: (plan) => {
		const profile = projectMotionExpressionAuthoringProfile(
			COUNT_GROWTH_V1,
			plan.binding,
		);
		return profile
			? createProfileBackedWorkspaceClipInput({ plan, profile })
			: null;
	},
};

/** Symmetry is a sample-driven shared-pulse relation over five replaceable roles. */
const SYMMETRY_TECHNIQUE_MODULE: MotionGrammarTechniqueModule = {
	techniqueId: "mirror-symmetric-scale",
	createLabel: "Symmetry system",
	describeAuthoringProfile: (binding) =>
		projectMotionExpressionAuthoringProfile(SYMMETRY_PULSE_V1, binding),
	createWorkspacePlan: ({ scene, selectedNodeIds }) =>
		createMotionGrammarWorkspaceInstancePlan({
			techniqueId: "mirror-symmetric-scale",
			scene,
			selectedNodeIds,
		}),
	createSceneCommands: (plan, options) =>
		createAppendGeneratedSceneCommands(plan, options),
	createWorkspaceClipInput: (plan) => {
		const profile = projectMotionExpressionAuthoringProfile(
			SYMMETRY_PULSE_V1,
			plan.binding,
		);
		return profile
			? createProfileBackedWorkspaceClipInput({ plan, profile })
			: null;
	},
};

/** Follow-through is a sample-driven derivative-aware relation over leader/follower roles. */
const FOLLOW_THROUGH_TECHNIQUE_MODULE: MotionGrammarTechniqueModule = {
	techniqueId: "lag-follow-through",
	createLabel: "Follow-through system",
	describeAuthoringProfile: (binding) =>
		projectMotionExpressionAuthoringProfile(FOLLOW_THROUGH_V1, binding),
	createWorkspacePlan: ({ scene, selectedNodeIds }) =>
		createMotionGrammarWorkspaceInstancePlan({
			techniqueId: "lag-follow-through",
			scene,
			selectedNodeIds,
		}),
	createSceneCommands: (plan, options) =>
		createAppendGeneratedSceneCommands(plan, options),
	createWorkspaceClipInput: (plan) => {
		const profile = projectMotionExpressionAuthoringProfile(
			FOLLOW_THROUGH_V1,
			plan.binding,
		);
		return profile
			? createProfileBackedWorkspaceClipInput({ plan, profile })
			: null;
	},
};

/** Interference is a sample-driven orbit-driver/ring-field relation. */
const INTERFERENCE_TECHNIQUE_MODULE: MotionGrammarTechniqueModule = {
	techniqueId: "ring-wave-interference",
	createLabel: "Interference system",
	describeAuthoringProfile: (binding) =>
		projectMotionExpressionAuthoringProfile(INTERFERENCE_RING_V1, binding),
	createWorkspacePlan: ({ scene, selectedNodeIds }) =>
		createMotionGrammarWorkspaceInstancePlan({
			techniqueId: "ring-wave-interference",
			scene,
			selectedNodeIds,
		}),
	createSceneCommands: (plan, options) =>
		createAppendGeneratedSceneCommands(plan, options),
	createWorkspaceClipInput: (plan) => {
		const profile = projectMotionExpressionAuthoringProfile(
			INTERFERENCE_RING_V1,
			plan.binding,
		);
		return profile
			? createProfileBackedWorkspaceClipInput({ plan, profile })
			: null;
	},
};

/** Merge / Split is a sample-driven delayed gather/absorb/return field. */
const MERGE_SPLIT_TECHNIQUE_MODULE: MotionGrammarTechniqueModule = {
	techniqueId: "merge-split-cycle",
	createLabel: "Merge / Split system",
	describeAuthoringProfile: (binding) =>
		projectMotionExpressionAuthoringProfile(MERGE_SPLIT_V1, binding),
	createWorkspacePlan: ({ scene, selectedNodeIds }) =>
		createMotionGrammarWorkspaceInstancePlan({
			techniqueId: "merge-split-cycle",
			scene,
			selectedNodeIds,
		}),
	createSceneCommands: (plan, options) =>
		createAppendGeneratedSceneCommands(plan, options),
	createWorkspaceClipInput: (plan) => {
		const profile = projectMotionExpressionAuthoringProfile(
			MERGE_SPLIT_V1,
			plan.binding,
		);
		return profile
			? createProfileBackedWorkspaceClipInput({ plan, profile })
			: null;
	},
};

/** Parallax is a sample-driven screen-space shared-wave relation. */
const PARALLAX_TECHNIQUE_MODULE: MotionGrammarTechniqueModule = {
	techniqueId: "size-speed-parallax",
	createLabel: "Parallax system",
	describeAuthoringProfile: (binding) =>
		projectMotionExpressionAuthoringProfile(PARALLAX_WAVE_V1, binding),
	createWorkspacePlan: ({ scene, selectedNodeIds }) =>
		createMotionGrammarWorkspaceInstancePlan({
			techniqueId: "size-speed-parallax",
			scene,
			selectedNodeIds,
		}),
	createSceneCommands: (plan, options) =>
		createAppendGeneratedSceneCommands(plan, options),
	createWorkspaceClipInput: (plan) => {
		const profile = projectMotionExpressionAuthoringProfile(
			PARALLAX_WAVE_V1,
			plan.binding,
		);
		return profile
			? createProfileBackedWorkspaceClipInput({ plan, profile })
			: null;
	},
};

/** Inverse Proportion is a sample-driven two-circle tangent-anchor relation. */
const INVERSE_PROPORTION_TECHNIQUE_MODULE: MotionGrammarTechniqueModule = {
	techniqueId: "inverse-proportion-link",
	createLabel: "Inverse Proportion system",
	describeAuthoringProfile: (binding) =>
		projectMotionExpressionAuthoringProfile(INVERSE_PROPORTION_V1, binding),
	createWorkspacePlan: ({ scene, selectedNodeIds }) =>
		createMotionGrammarWorkspaceInstancePlan({
			techniqueId: "inverse-proportion-link",
			scene,
			selectedNodeIds,
		}),
	createSceneCommands: (plan, options) =>
		createAppendGeneratedSceneCommands(plan, options),
	createWorkspaceClipInput: (plan) => {
		const profile = projectMotionExpressionAuthoringProfile(
			INVERSE_PROPORTION_V1,
			plan.binding,
		);
		return profile
			? createProfileBackedWorkspaceClipInput({ plan, profile })
			: null;
	},
};

/**
 * Noise-wipe seeds and animates a calibrated final alpha mask
 * (`material.reveal`/`material.linearField`, see `effect-filter.ts`'s
 * `revealMattePrimitives`) directly on each selected target's own recipe.
 * Unlike every other promoted module, it creates no workspace-role scene
 * nodes; `describeAuthoringProfile` delegates to
 * `describeNoiseWipeAuthoringProfile`, which returns a `scalar-tracks` /
 * `bakePolicy: "not-supported"` profile — the motion command already writes
 * real keyframes directly, so there is no separate bake step to offer.
 * `commitsOnApply: true` because noise-wipe has no entry in
 * `evaluator.ts`'s `sampleGrammarFrameDirect` switch or expression registry:
 * applying a bare binding alone is inert (no filter is ever seeded), so its
 * scene/motion commands must run at apply time, not only through the
 * separate "Create System" workspace materialization.
 */
const NOISE_WIPE_TECHNIQUE_MODULE: MotionGrammarTechniqueModule = {
	techniqueId: "noise-wipe",
	createLabel: "Noise Wipe",
	commitsOnApply: true,
	describeAuthoringProfile: (binding) =>
		describeNoiseWipeAuthoringProfile(binding),
	createWorkspacePlan: ({ scene, selectedNodeIds }) =>
		createNoiseWipePlan({ scene, selectedNodeIds }),
	createSceneCommands: (plan, options) =>
		isNoiseWipePlan(plan) ? createNoiseWipeSceneCommands(plan, options) : [],
	createMotionCommands: (plan, options) =>
		isNoiseWipePlan(plan) ? createNoiseWipeMotionCommands(plan, options) : [],
};

const MOTION_GRAMMAR_TECHNIQUE_MODULES = [
	TIME_DELAY_TECHNIQUE_MODULE,
	TIME_OFFSET_TECHNIQUE_MODULE,
	PERIODIC_AFTERIMAGE_TECHNIQUE_MODULE,
	CYCLE_TECHNIQUE_MODULE,
	NOISE_WIPE_TECHNIQUE_MODULE,
	COLLISION_BOUNCE_TECHNIQUE_MODULE,
	RANDOM_PULSE_TECHNIQUE_MODULE,
	COUNT_GROWTH_TECHNIQUE_MODULE,
	SYMMETRY_TECHNIQUE_MODULE,
	FOLLOW_THROUGH_TECHNIQUE_MODULE,
	INTERFERENCE_TECHNIQUE_MODULE,
	MERGE_SPLIT_TECHNIQUE_MODULE,
	PARALLAX_TECHNIQUE_MODULE,
	INVERSE_PROPORTION_TECHNIQUE_MODULE,
] as const satisfies readonly MotionGrammarTechniqueModule[];

/** Promoted Glammer-backed technique modules available to authoring surfaces. */
export function registeredMotionGrammarTechniqueModules(): readonly MotionGrammarTechniqueModule[] {
	return MOTION_GRAMMAR_TECHNIQUE_MODULES;
}

/** Finds the promoted technique module that owns authoring for a technique id. */
export function findMotionGrammarTechniqueModule(
	techniqueId: MotionGrammarTechniqueId,
): MotionGrammarTechniqueModule | undefined {
	return MOTION_GRAMMAR_TECHNIQUE_MODULES.find(
		(module) => module.techniqueId === techniqueId,
	);
}

/**
 * True for a technique whose apply-time effect requires its module's
 * scene/motion commands to run immediately (see
 * {@link MotionGrammarTechniqueModule.commitsOnApply}). Techniques without a
 * promoted module, or whose module leaves this unset, are sample-driven:
 * recording a bare {@link MotionGrammarBinding} is already a complete apply.
 */
export function motionGrammarTechniqueCommitsOnApply(
	techniqueId: MotionGrammarTechniqueId,
): boolean {
	return findMotionGrammarTechniqueModule(techniqueId)?.commitsOnApply ?? false;
}

/**
 * Describes a binding through its owning technique module. Techniques without a
 * promoted module remain on the raw catalog/decomposition path.
 */
export function describeMotionGrammarTechniqueAuthoringProfile(
	binding: MotionGrammarBinding,
): MotionGrammarAuthoringProfileDescriptor | undefined {
	return findMotionGrammarTechniqueModule(
		binding.techniqueId,
	)?.describeAuthoringProfile(binding);
}

/** Plans creation of a role-bearing workspace system through the owning module. */
export function createMotionGrammarTechniqueWorkspacePreview({
	techniqueId,
	scene,
	selectedNodeIds,
}: {
	readonly techniqueId: MotionGrammarTechniqueId;
	readonly scene: SceneDocument;
	readonly selectedNodeIds: readonly string[];
}): MotionGrammarTechniqueWorkspacePreview {
	const module = findMotionGrammarTechniqueModule(techniqueId);
	if (!module) {
		const label = findCatalogEntry(techniqueId)?.label ?? "Motion";
		return {
			status: "blocked",
			reason: `${label} does not have a promoted workspace module yet.`,
		};
	}
	const plan = module.createWorkspacePlan({ scene, selectedNodeIds });
	if (plan.status === "blocked") return plan;
	return {
		status: "ready",
		label: module.createLabel,
		plan,
	};
}

/** Returns undoable scene writes for a planned technique workspace system. */
export function createMotionGrammarTechniqueWorkspaceSceneCommands({
	plan,
	label,
	coalesceKey,
}: {
	readonly plan: MotionGrammarTechniqueWorkspacePlan;
	readonly label: string;
	readonly coalesceKey: string;
}): readonly SceneCommand[] {
	return (
		findMotionGrammarTechniqueModule(plan.techniqueId)?.createSceneCommands(
			plan,
			{ label, coalesceKey },
		) ?? []
	);
}

/** Returns undoable motion writes for a planned technique workspace system. */
export function createMotionGrammarTechniqueWorkspaceMotionCommands({
	plan,
	label,
	coalesceKey,
}: {
	readonly plan: MotionGrammarTechniqueWorkspacePlan;
	readonly label: string;
	readonly coalesceKey: string;
}): readonly MotionCommand[] {
	return (
		findMotionGrammarTechniqueModule(plan.techniqueId)?.createMotionCommands?.(
			plan,
			{ label, coalesceKey },
		) ?? []
	);
}

/** Creates the profile-backed timeline clip when a module does not write it itself. */
export function createMotionGrammarTechniqueWorkspaceClipInput(
	plan: MotionGrammarTechniqueWorkspacePlan,
): CreateAnimationClipInput | null {
	const module = findMotionGrammarTechniqueModule(plan.techniqueId);
	return module?.createWorkspaceClipInput?.(plan) ?? null;
}

/** Clip id written by a module-owned motion command, when no clip input is emitted. */
export function motionGrammarTechniqueWorkspaceCreatedClipId(
	plan: MotionGrammarTechniqueWorkspacePlan,
): string | null {
	const module = findMotionGrammarTechniqueModule(plan.techniqueId);
	return module?.createdClipId?.(plan) ?? null;
}

/** Optional transport frame chosen by a module after creating its workspace system. */
export function motionGrammarTechniqueWorkspaceInitialFrame(
	plan: MotionGrammarTechniqueWorkspacePlan,
): number | null {
	const module = findMotionGrammarTechniqueModule(plan.techniqueId);
	return module?.initialFrame?.(plan) ?? null;
}
