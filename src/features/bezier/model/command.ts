import type { SceneCommand } from "@/entities/scene/model/command";
import { findDraftNode } from "@/entities/scene/model/selectors";
import type { AeShape } from "@/shared/glammer/ae-shape";
import { isValidPathShape, normalizePathShape } from "./geometry";

/**
 * Builds a command that replaces a path node's BezierShape. Geometry edits flow
 * through the scene command bus so undo/redo replays Immer patches like every
 * other mutation; `pathData` stays derived from the shape. `coalesceKey` is set
 * per gesture by the caller so distinct edits never merge into one undo step.
 * The command normalizes imported path topology and refuses invalid replacements
 * before mutating the scene, while preserving all non-shape node metadata.
 */
export function createSetPathShapeCommand(
	nodeId: string,
	shape: AeShape,
	coalesceKey: string,
	label = "Edit path",
): SceneCommand {
	const nextShape = normalizePathShape(shape);
	return {
		type: "bezier/set-path-shape",
		label,
		coalesceKey,
		run: (draft) => {
			const node = findDraftNode(draft, nodeId);
			if (node?.geometry.kind !== "path") return;
			if (!isValidPathShape(nextShape)) return;
			node.geometry.shape = nextShape;
		},
	};
}
