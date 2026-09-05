import { useMotionStore } from "@/entities/motion/model/store";
import { currentMotionGrammarTargetNodeIds } from "@/entities/motion-grammar/model/store";
import type { SceneCommand } from "@/entities/scene/model/command";
import {
	createUpdateNodeStyleCommand,
	createUpdateNodeTransformCommand,
} from "@/entities/scene/model/node-commands";
import type { Matrix2D } from "@/entities/scene/model/rendering";
import { useSceneStore } from "@/entities/scene/model/store";
import type { Transform } from "@/entities/scene/model/types";

export type NodeTransformPatch = {
	readonly matrix?: Matrix2D;
	readonly transform?: Partial<Transform>;
	readonly opacity?: number;
};

export function createApplyNodeTransformCommand(
	nodeId: string,
	patch: NodeTransformPatch,
): SceneCommand {
	const grammarTargetNodeIds = currentMotionGrammarTargetNodeIds();
	const motion = useMotionStore.getState().document;
	return {
		type: "transform/apply-node-transform",
		label: "Apply node transform",
		run: (draft) => {
			if (patch.matrix) {
				createUpdateNodeTransformCommand(
					nodeId,
					{ matrix: patch.matrix },
					{ grammarTargetNodeIds, motion },
				).run(draft);
			}
			if (patch.transform) {
				createUpdateNodeTransformCommand(
					nodeId,
					{ transform: patch.transform },
					{ grammarTargetNodeIds, motion },
				).run(draft);
			}
			if (patch.opacity !== undefined) {
				createUpdateNodeStyleCommand(
					nodeId,
					{ opacity: patch.opacity },
					{ grammarTargetNodeIds, motion },
				).run(draft);
			}
		},
	};
}

/**
 * Single canvas transform writer. UI tools, Inspector edits, and future playback
 * bridges use this function so transform ownership stays centralized.
 */
export function applyNodeTransform(
	nodeId: string,
	patch: NodeTransformPatch,
): void {
	useSceneStore
		.getState()
		.apply(createApplyNodeTransformCommand(nodeId, patch));
}
