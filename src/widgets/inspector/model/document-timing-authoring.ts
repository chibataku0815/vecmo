import {
	motionTimingRangeIssues,
	updateMotionDocumentTiming,
} from "@/entities/motion/model/commands";
import { useMotionStore } from "@/entities/motion/model/store";
import { useMotionGrammarStore } from "@/entities/motion-grammar/model/store";
import { createUpdateArtboardCommand } from "@/entities/scene/model/node-commands";
import { findArtboardById } from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import { createId } from "@/shared/lib/id";
import { commitInspectorCompound } from "./compound-authoring";

export type DocumentTimingCommitResult =
	| { readonly status: "blocked"; readonly reason: string }
	| { readonly status: "unchanged" }
	| { readonly status: "committed" };

/**
 * Applies the Inspector's artboard/document timing edit through the same Scene
 * and Motion commands used by typed Agent document authoring. Frame addresses
 * are preserved; a shrink with out-of-range durable addresses or unresolved
 * live grammar timing fails before either store opens a transaction.
 */
export function commitDocumentTimingFromInspector({
	artboardId,
	fps,
	durationFrames,
}: {
	readonly artboardId: string;
	readonly fps: number;
	readonly durationFrames: number;
}): DocumentTimingCommitResult {
	const scene = useSceneStore.getState().document;
	const motion = useMotionStore.getState().document;
	const grammar = useMotionGrammarStore.getState().document;
	const artboard = findArtboardById(scene, artboardId);
	if (!artboard) {
		return {
			status: "blocked",
			reason: "The target artboard no longer exists.",
		};
	}
	if (!Number.isInteger(fps) || fps <= 0) {
		return {
			status: "blocked",
			reason: "Frame rate must be a positive whole number.",
		};
	}
	if (!Number.isInteger(durationFrames) || durationFrames <= 0) {
		return {
			status: "blocked",
			reason: "Duration must be a positive whole-frame count.",
		};
	}
	const rangeIssues = motionTimingRangeIssues(motion, durationFrames);
	if (rangeIssues.length > 0) {
		return {
			status: "blocked",
			reason: `Duration would leave ${rangeIssues.length} persisted motion address(es) outside the timeline; remove or retime them first.`,
		};
	}
	const shrinking =
		durationFrames < motion.durationFrames ||
		durationFrames < artboard.durationFrames;
	const grammarBindingCount =
		grammar.bindings.length + (motion.grammar?.bindings.length ?? 0);
	if (shrinking && grammarBindingCount > 0) {
		return {
			status: "blocked",
			reason:
				"Duration cannot shrink while Motion Grammar bindings have an unbounded derived timeline. Remove or expand them first.",
		};
	}
	if (
		artboard.fps === fps &&
		artboard.durationFrames === durationFrames &&
		motion.fps === fps &&
		motion.durationFrames === durationFrames
	) {
		return { status: "unchanged" };
	}

	const compoundId = createId("document-timing");
	try {
		commitInspectorCompound({
			compoundId,
			label: "Update document timing",
			sceneCommands: [
				createUpdateArtboardCommand(
					artboardId,
					{ fps, durationFrames },
					{ label: "Update document timing" },
				),
			],
			motionCommands: [
				updateMotionDocumentTiming({
					fps,
					durationFrames,
					temporalPolicy: "preserve-frame-indices",
					outOfRangePolicy: "reject",
				}),
			],
		});
	} catch {
		return {
			status: "blocked",
			reason:
				"The timing edit failed and was rolled back without a partial write.",
		};
	}
	return { status: "committed" };
}
