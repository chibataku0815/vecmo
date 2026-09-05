import type { Draft } from "immer";
import type { MotionDocument } from "./types";

export type MotionCommandMeta = {
	readonly type: string;
	readonly label?: string;
	readonly coalesceKey?: string;
	/**
	 * Optional cross-store grouping token (see scene `CommandMeta.compoundId`). A
	 * motion history entry carrying a `compoundId` joins the global undo coordinator
	 * so it reverts atomically with the scene/grammar halves of the same gesture;
	 * standalone keyframe edits omit it and stay on the timeline-local undo only.
	 */
	readonly compoundId?: string;
};

/**
 * Motion commands are imperative draft mutations executed exactly once. Undo and
 * redo replay Immer patches rather than the command body, so commands may mint
 * track ids freely. Mirrors the scene command contract so the two histories stay
 * conceptually aligned for a future unified undo stack.
 */
export type MotionCommand = MotionCommandMeta & {
	readonly run: (draft: Draft<MotionDocument>) => void;
};
