import type { Draft } from "immer";
import type { SceneDocument } from "./types";

export type CommandMeta = {
	readonly type: string;
	readonly label?: string;
	readonly coalesceKey?: string;
	/**
	 * Controls the scene runner's layout-cache repair after this command. Layout
	 * frame commands that already materialize their affected subtree can skip the
	 * global bridge; ordinary commands default to patch-based auto repair.
	 */
	readonly layoutReapply?: "auto" | "skip";
	/**
	 * Optional cross-store grouping token. When several commands dispatched to the
	 * scene, motion, and motion-grammar stores in one logical gesture share the same
	 * `compoundId`, the global undo coordinator pops their history entries together
	 * so a single Cmd+Z reverts the whole gesture atomically. Omitted for ordinary
	 * single-store edits.
	 */
	readonly compoundId?: string;
};

/**
 * Scene commands are imperative draft mutations executed exactly once. Undo and
 * redo replay Immer patches, not the command body, so commands may safely mint ids.
 */
export type SceneCommand = CommandMeta & {
	readonly run: (draft: Draft<SceneDocument>) => void;
};
