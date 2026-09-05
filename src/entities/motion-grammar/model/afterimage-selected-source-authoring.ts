import {
	findNode,
	selectArtboardIdForNode,
} from "@/entities/scene/model/selectors";
import type { SceneDocument } from "@/entities/scene/model/types";
import {
	PERIODIC_AFTERIMAGE_COPIES_DEFAULT,
	PERIODIC_AFTERIMAGE_DECAY_DEFAULT,
	PERIODIC_AFTERIMAGE_DELAY_DEFAULT,
	TIME_DELAY_PERIOD_DEFAULT,
} from "./catalog";
import type { MotionGrammarCommand } from "./command";
import { applyGrammarBinding } from "./commands";
import type { MotionGrammarBinding } from "./types";

export type AfterimageSelectedSourcePlan =
	| { readonly status: "blocked"; readonly reason: string }
	| {
			readonly status: "ready";
			readonly binding: MotionGrammarBinding;
			readonly selectedSourceNodeIds: readonly string[];
			readonly artboardId: string;
	  };

/**
 * Plans a presentation-only Afterimage binding around the selected real nodes.
 * The planner never clones or rewrites Scene nodes; duplicate history remains a
 * bounded presentation artifact and the selected ids remain the source roles.
 */
export function planAfterimageSelectedSourceBinding({
	scene,
	selectedNodeIds,
	bindingId,
	periodFrames = TIME_DELAY_PERIOD_DEFAULT,
	copies = PERIODIC_AFTERIMAGE_COPIES_DEFAULT,
	delayFrames = PERIODIC_AFTERIMAGE_DELAY_DEFAULT,
	fadePerCopy = PERIODIC_AFTERIMAGE_DECAY_DEFAULT,
}: {
	readonly scene: SceneDocument;
	readonly selectedNodeIds: readonly string[];
	readonly bindingId: string;
	readonly periodFrames?: number;
	readonly copies?: number;
	readonly delayFrames?: number;
	readonly fadePerCopy?: number;
}): AfterimageSelectedSourcePlan {
	const selectedSourceNodeIds = [...new Set(selectedNodeIds)];
	if (selectedSourceNodeIds.length === 0) {
		return {
			status: "blocked",
			reason: "Afterimage requires at least one selected source node.",
		};
	}
	if (!bindingId.trim()) {
		return {
			status: "blocked",
			reason: "Afterimage selected-source binding requires a stable id.",
		};
	}
	const artboardIds = new Set<string>();
	for (const nodeId of selectedSourceNodeIds) {
		if (!findNode(scene, nodeId)) {
			return {
				status: "blocked",
				reason: `Afterimage source node ${nodeId} is missing.`,
			};
		}
		const artboardId = selectArtboardIdForNode(scene, nodeId);
		if (!artboardId) {
			return {
				status: "blocked",
				reason: `Afterimage source node ${nodeId} has no owning artboard.`,
			};
		}
		artboardIds.add(artboardId);
	}
	if (artboardIds.size !== 1) {
		return {
			status: "blocked",
			reason: "Afterimage selected sources must share one artboard.",
		};
	}
	const artboardId = [...artboardIds][0];
	if (!artboardId) {
		return {
			status: "blocked",
			reason: "Afterimage source artboard could not be resolved.",
		};
	}
	if (
		![periodFrames, copies, delayFrames, fadePerCopy].every(Number.isFinite)
	) {
		return {
			status: "blocked",
			reason: "Afterimage timing and fade parameters must be finite.",
		};
	}
	if (
		periodFrames <= 0 ||
		copies < 0 ||
		delayFrames < 0 ||
		fadePerCopy < 0 ||
		fadePerCopy > 1
	) {
		return {
			status: "blocked",
			reason:
				"Afterimage timing, copy count, and fade must be within their authored ranges.",
		};
	}
	const binding: MotionGrammarBinding = {
		id: bindingId,
		techniqueId: "periodic-afterimage",
		targetIds: selectedSourceNodeIds,
		parameters: {
			periodFrames,
			copies: Math.floor(copies),
			delayFrames,
			decay: fadePerCopy,
		},
		effectBinding: {
			kind: "temporal-echo",
			copies: Math.floor(copies),
			delayFrames,
			decay: fadePerCopy,
		},
	};
	return {
		status: "ready",
		binding,
		selectedSourceNodeIds,
		artboardId,
	};
}

/** Applies the selected-source plan through the motion-grammar command bus. */
export function createAfterimageSelectedSourceBindingCommand(
	plan: Extract<AfterimageSelectedSourcePlan, { readonly status: "ready" }>,
): MotionGrammarCommand {
	return applyGrammarBinding(plan.binding);
}
