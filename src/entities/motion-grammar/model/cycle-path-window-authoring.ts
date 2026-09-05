import type { SceneCommand } from "@/entities/scene/model/command";
import { createUpdateNodeStyleCommand } from "@/entities/scene/model/node-commands";
import { sampleNodePathMetric } from "@/entities/scene/model/path-metrics";
import {
	findNode,
	findRenderableNodeEntry,
} from "@/entities/scene/model/selectors";
import type { SceneDocument } from "@/entities/scene/model/types";
import { CYCLIC_PATH_WINDOW_FRACTION_DEFAULT } from "./catalog";

export type CyclePathWindowPlan =
	| { readonly status: "blocked"; readonly reason: string }
	| {
			readonly status: "ready";
			readonly pathNodeId: string;
			readonly pathLength: number;
			readonly windowFraction: number;
			readonly command: SceneCommand;
	  };

/** Plans the explicit static dash window required by native Cycle path transport. */
export function planCyclePathWindow({
	scene,
	pathNodeId,
	windowFraction = CYCLIC_PATH_WINDOW_FRACTION_DEFAULT,
}: {
	readonly scene: SceneDocument;
	readonly pathNodeId: string;
	readonly windowFraction?: number;
}): CyclePathWindowPlan {
	const path = findNode(scene, pathNodeId);
	if (path?.geometry.kind !== "path" || !path.geometry.shape.closed) {
		return {
			status: "blocked",
			reason: "Cycle stroke window requires one existing closed path.",
		};
	}
	if (!findRenderableNodeEntry(scene, pathNodeId)) {
		return {
			status: "blocked",
			reason: "Cycle stroke window path must be renderable.",
		};
	}
	if (path.style.strokeWidthProfile) {
		return {
			status: "blocked",
			reason: "Cycle stroke window cannot coexist with a stroke width profile.",
		};
	}
	if (
		!Number.isFinite(windowFraction) ||
		windowFraction <= 0 ||
		windowFraction >= 1
	) {
		return {
			status: "blocked",
			reason: "Cycle stroke window fraction must be in (0, 1).",
		};
	}
	const pathSample = sampleNodePathMetric(path, 1);
	if (!pathSample || !(pathSample.length > 0)) {
		return {
			status: "blocked",
			reason: "Cycle stroke window path must have positive metric length.",
		};
	}
	const pathLength = pathSample.length;
	return {
		status: "ready",
		pathNodeId,
		pathLength,
		windowFraction,
		command: createUpdateNodeStyleCommand(pathNodeId, {
			strokeDash: [
				pathLength * windowFraction,
				pathLength * (1 - windowFraction),
			],
			strokeDashoffset: 0,
			strokeWidthProfile: null,
		}),
	};
}
