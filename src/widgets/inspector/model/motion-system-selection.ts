import type {
	AnimationClip,
	MotionDocument,
} from "@/entities/motion/model/types";
import type { MotionGrammarAuthoringProfileDescriptor } from "@/entities/motion-grammar/model/authoring-profile";
import { describeMotionGrammarAuthoringProfile } from "@/entities/motion-grammar/model/authoring-profile-registry";
import type { MotionGrammarBinding } from "@/entities/motion-grammar/model/types";

export type MotionSystemInspectorSelection = {
	readonly clip: AnimationClip;
	readonly binding: MotionGrammarBinding;
	readonly profile: MotionGrammarAuthoringProfileDescriptor;
};

/**
 * Resolves a focused timeline clip into the semantic motion system it edits.
 * Grammar-backed clips already carry `provenance.bindingId`, so the Inspector can
 * use that bridge instead of guessing from scene selection or duplicating layer
 * hierarchy.
 */
export function motionSystemInspectorSelection({
	motion,
	bindings,
	selectedClipId,
}: {
	readonly motion: MotionDocument;
	readonly bindings: readonly MotionGrammarBinding[];
	readonly selectedClipId: string | null;
}): MotionSystemInspectorSelection | null {
	if (!selectedClipId) return null;
	const clip =
		motion.clips.find((candidate) => candidate.id === selectedClipId) ?? null;
	if (clip?.provenance?.source !== "motion-grammar") {
		return null;
	}
	const binding =
		bindings.find((candidate) => candidate.id === clip.provenance?.bindingId) ??
		null;
	if (!binding) return null;
	const profile = describeMotionGrammarAuthoringProfile(binding);
	if (!profile) return null;
	return { clip, binding, profile };
}
