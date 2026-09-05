import type { SceneCommand } from "@/entities/scene/model/command";
import { createUpdateNodeStyleCommand } from "@/entities/scene/model/node-commands";
import { findNode } from "@/entities/scene/model/selectors";
import type { SceneDocument } from "@/entities/scene/model/types";
import { aeShapeArcLength } from "@/shared/glammer/ae-shape";
import type { MotionGrammarCommand } from "./command";
import { applyGrammarBinding } from "./commands";
import type { MotionGrammarBinding } from "./types";

const DRAW_ON_TECHNIQUE_ID = "stroke-draw-on" as const;
const DRAW_ON_MIN_FRAMES = 6;
const DRAW_ON_MAX_FRAMES = 300;
const DRAW_ON_DEFAULT_FRAMES = 30;
const MS_PER_SECOND = 1000;

const clampFrames = (frames: number): number =>
	Math.min(
		DRAW_ON_MAX_FRAMES,
		Math.max(DRAW_ON_MIN_FRAMES, Math.round(frames)),
	);

/** Maps a captured stroke duration in milliseconds to the durable draw-on range. */
export function drawOnFramesFromDurationMs(
	durationMs: number,
	fps: number,
): number {
	if (!(durationMs > 0) || !(fps > 0)) return DRAW_ON_DEFAULT_FRAMES;
	return clampFrames((durationMs / MS_PER_SECOND) * fps);
}

export type StrokeDrawOnAuthoringPlan =
	| {
			readonly status: "blocked";
			readonly reason: string;
	  }
	| {
			readonly status: "ready";
			readonly binding: MotionGrammarBinding;
			readonly sceneCommands: readonly SceneCommand[];
			readonly grammarCommands: readonly MotionGrammarCommand[];
	  };

/**
 * Plans the semantic Pencil draw-on conversion without touching a store. GUI,
 * live Agent, and headless adapters all consume these same Scene/Grammar
 * commands, so pressure-profile removal and dash-length calculation cannot
 * drift between entry surfaces.
 */
export function createStrokeDrawOnAuthoringPlan({
	scene,
	nodeId,
	durationFrames,
	reverse = false,
	bindingId = `${DRAW_ON_TECHNIQUE_ID}:${nodeId}`,
}: {
	readonly scene: SceneDocument;
	readonly nodeId: string;
	readonly durationFrames: number;
	readonly reverse?: boolean;
	readonly bindingId?: string;
}): StrokeDrawOnAuthoringPlan {
	const node = findNode(scene, nodeId);
	if (!node) return { status: "blocked", reason: "Draw-on target is missing." };
	if (node.geometry.kind !== "path") {
		return { status: "blocked", reason: "Draw-on target must be a path." };
	}
	const length = Math.ceil(aeShapeArcLength(node.geometry.shape));
	if (!(length > 0)) {
		return { status: "blocked", reason: "Draw-on path has zero arc length." };
	}
	const binding: MotionGrammarBinding = {
		id: bindingId,
		techniqueId: DRAW_ON_TECHNIQUE_ID,
		targetIds: [nodeId],
		parameters: {
			durationFrames: clampFrames(durationFrames),
			reverse: reverse ? 1 : 0,
			dashLength: length,
		},
		effectBinding: { kind: "none" },
	};
	return {
		status: "ready",
		binding,
		sceneCommands: [
			createUpdateNodeStyleCommand(nodeId, {
				strokeDash: [length, length],
				strokeDashoffset: 0,
				strokeWidthProfile: null,
			}),
		],
		grammarCommands: [applyGrammarBinding(binding)],
	};
}
