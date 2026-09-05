import {
	type AnimationClipRange,
	type NormalizedAnimationClipRange,
	normalizeAnimationClipRange,
} from "@/entities/motion/model/clips";
import type { MotionCommand } from "@/entities/motion/model/command";
import { trimAnimationClip } from "@/entities/motion/model/commands";
import type {
	AnimationClip,
	MotionDocument,
} from "@/entities/motion/model/types";
import {
	type MotionGrammarAuthoringProfileDescriptor,
	normalizeMotionGrammarAuthoringParameterPatch,
} from "./authoring-profile";
import { describeMotionGrammarAuthoringProfile } from "./authoring-profile-registry";
import type { MotionGrammarCommand } from "./command";
import { updateGrammarBinding } from "./commands";
import type { MotionGrammarBinding } from "./types";

export type MotionGrammarClipRetimeBlockReason = "missing-clip";

export type MotionGrammarClipRetimePlan =
	| {
			readonly status: "blocked";
			readonly reason: MotionGrammarClipRetimeBlockReason;
	  }
	| {
			readonly status: "ready";
			readonly clip: AnimationClip;
			readonly binding?: MotionGrammarBinding;
			readonly profile?: MotionGrammarAuthoringProfileDescriptor;
			readonly durationParameterKey?: string;
			readonly range: NormalizedAnimationClipRange;
			readonly motionCommand: MotionCommand;
			readonly grammarCommand?: MotionGrammarCommand;
	  };

const grammarBindingForClip = (
	clip: AnimationClip,
	bindings: readonly MotionGrammarBinding[],
): MotionGrammarBinding | undefined => {
	if (clip.provenance?.source !== "motion-grammar") return undefined;
	return bindings.find((binding) => binding.id === clip.provenance?.bindingId);
};

const profileDurationRange = ({
	binding,
	profile,
	range,
	motion,
}: {
	readonly binding: MotionGrammarBinding;
	readonly profile: MotionGrammarAuthoringProfileDescriptor;
	readonly range: NormalizedAnimationClipRange;
	readonly motion: MotionDocument;
}): {
	readonly durationParameterKey?: string;
	readonly range: NormalizedAnimationClipRange;
	readonly parameters: Readonly<Record<string, number>>;
	readonly changed: boolean;
} => {
	const durationParameterKey = profile.timeline.durationParameterKey;
	if (!durationParameterKey) {
		return { range, parameters: {}, changed: false };
	}
	const patch = normalizeMotionGrammarAuthoringParameterPatch({
		binding,
		descriptor: profile,
		patch: { [durationParameterKey]: range.durationFrames },
	});
	const nextDuration = patch.parameters[durationParameterKey];
	if (!Number.isFinite(nextDuration)) {
		return { durationParameterKey, range, parameters: {}, changed: false };
	}
	const syncedRange = normalizeAnimationClipRange(
		{ startFrame: range.startFrame, durationFrames: nextDuration },
		motion.durationFrames,
	);
	return {
		durationParameterKey,
		range: syncedRange,
		parameters: { [durationParameterKey]: syncedRange.durationFrames },
		changed:
			binding.parameters[durationParameterKey] !== syncedRange.durationFrames,
	};
};

/**
 * Plans the shared retime operation for grammar-backed motion-system clips.
 * The returned commands keep the MotionDocument clip range and the descriptor's
 * duration-owning binding parameter synchronized without UI-specific technique
 * checks. Callers decide whether to apply the commands inside an existing
 * gesture transaction or as a single field edit.
 */
export function createMotionGrammarClipRetimePlan({
	motion,
	bindings,
	clipId,
	range,
	coalesceKey,
}: {
	readonly motion: MotionDocument;
	readonly bindings: readonly MotionGrammarBinding[];
	readonly clipId: string;
	readonly range: AnimationClipRange;
	readonly coalesceKey?: string;
}): MotionGrammarClipRetimePlan {
	const clip = motion.clips.find((candidate) => candidate.id === clipId);
	if (!clip) return { status: "blocked", reason: "missing-clip" };
	let nextRange = normalizeAnimationClipRange(range, motion.durationFrames);
	const binding = grammarBindingForClip(clip, bindings);
	const profile = binding
		? describeMotionGrammarAuthoringProfile(binding)
		: undefined;
	const durationSync =
		binding && profile
			? profileDurationRange({ binding, profile, range: nextRange, motion })
			: undefined;
	if (durationSync) nextRange = durationSync.range;

	return {
		status: "ready",
		clip,
		...(binding ? { binding } : {}),
		...(profile ? { profile } : {}),
		...(durationSync?.durationParameterKey
			? { durationParameterKey: durationSync.durationParameterKey }
			: {}),
		range: nextRange,
		motionCommand: trimAnimationClip(clipId, nextRange),
		...(binding && durationSync?.changed
			? {
					grammarCommand: updateGrammarBinding(
						binding.id,
						{ parameters: durationSync.parameters },
						coalesceKey ? { coalesceKey } : {},
					),
				}
			: {}),
	};
}
