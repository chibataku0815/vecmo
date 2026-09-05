import type {
	MotionGrammarAuthoringBakePolicy,
	MotionGrammarAuthoringProfileDescriptor,
	MotionGrammarAuthoringProfileKind,
	MotionGrammarAuthoringTimelineMode,
} from "./authoring-profile";
import type { MotionGrammarBinding } from "./types";

export type MotionGrammarAuthoringSourceSummary = {
	readonly label: string;
	readonly ids: readonly string[];
	readonly generatedCount: number;
	readonly boundCount: number;
};

/**
 * UI-facing label for a profile timeline mode. Kept in the motion-grammar model
 * so every technique added to the registry presents the same vocabulary in
 * Inspector, Timeline, and future agent-authored surfaces.
 */
export function motionGrammarAuthoringTimelineLabel(
	mode: MotionGrammarAuthoringTimelineMode,
): string {
	switch (mode) {
		case "trackless-expression":
			return "Expression";
		case "scalar-tracks":
			return "Tracks";
		case "presentation-only":
			return "Presentation";
	}
}

/**
 * UI-facing label for how a semantic profile can be converted to scalar output.
 * Future techniques should only need to set the bake policy in their profile;
 * editor surfaces should not branch on individual technique ids.
 */
export function motionGrammarAuthoringBakeLabel(
	policy: MotionGrammarAuthoringBakePolicy,
): string {
	switch (policy) {
		case "explicit-command":
			return "Explicit";
		case "not-supported":
			return "None";
	}
}

const sourceLabelForProfileKind = (
	kind: MotionGrammarAuthoringProfileKind,
): string => {
	switch (kind) {
		case "master-instances":
			return "Master objects";
		case "source-followers":
			return "Source objects";
		case "presentation-duplicates":
			return "Source objects";
		case "baked-tracks":
			return "Source objects";
	}
};

/**
 * Resolves the editable source side of a motion-grammar profile. The source ids
 * are binding targets, not generated artifacts, so editing or replacing them is
 * the shared authoring path for all grammar-backed motion systems.
 */
export function motionGrammarAuthoringSourceSummary({
	binding,
	profile,
}: {
	readonly binding: MotionGrammarBinding;
	readonly profile: MotionGrammarAuthoringProfileDescriptor;
}): MotionGrammarAuthoringSourceSummary {
	return {
		label: sourceLabelForProfileKind(profile.kind),
		ids: binding.targetIds,
		boundCount: binding.targetIds.length,
		generatedCount: profile.instances.filter(
			(instance) => instance.kind !== "source",
		).length,
	};
}
