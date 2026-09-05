import { create } from "zustand";
import type { VectorNode } from "@/entities/scene/model/types";

/**
 * Marks a live node-move drag as "Alt/Option held" (Figma-style duplicate
 * intent): the dragged `sourceIds` keep their base position in the main
 * render pass while a full-fidelity ghost follows the cursor. Scoped to the
 * artboard the gesture is running in so the ghost renders in that artboard's
 * local coordinate space (matching the overrides, which are also artboard-
 * local). `null` means no duplicate intent is live — the ordinary move
 * render (suppression + ghost) is skipped entirely.
 */
export type DuplicateIntent = {
	readonly artboardId: string;
	readonly sourceIds: readonly string[];
};

type LiveTransformState = {
	/**
	 * Per-node geometry overrides for the in-progress transform drag, or
	 * `null` when no drag is live. Populated every pointermove with a PURE
	 * recomputation from the gesture's start snapshot (see
	 * `computeLiveTransformOverrides` in `./live-drag.ts`) — `useSceneStore`'s
	 * document is written once, at gesture end, so a drag never triggers the
	 * document-subscribed render cascade on every pointermove.
	 */
	readonly overrides: ReadonlyMap<string, VectorNode> | null;
	readonly setOverrides: (overrides: ReadonlyMap<string, VectorNode>) => void;
	readonly clearOverrides: () => void;
	readonly duplicateIntent: DuplicateIntent | null;
	readonly setDuplicateIntent: (intent: DuplicateIntent | null) => void;
	readonly clearDuplicateIntent: () => void;
};

/**
 * Transient store for live transform-drag geometry (move/resize/rotate).
 * `CanvasShell`'s memoized `SceneNode` and the select-tool overlay each
 * subscribe with a per-node selector (`overrides?.get(nodeId)`) so only the
 * actively dragged node(s) re-render mid-drag — everything else in the scene
 * tree is untouched because `useSceneStore`'s document reference does not
 * change until the gesture commits. Mirrors the draw feature's transient
 * `useDrawStore` pattern (`src/features/draw/model/draw-store.ts`): committed
 * geometry lives in the scene store, this holds only gesture-scoped preview
 * state that is cleared when the gesture commits or is cancelled.
 */
export const useLiveTransformStore = create<LiveTransformState>()((set) => ({
	overrides: null,
	setOverrides: (overrides) => set({ overrides }),
	clearOverrides: () => set({ overrides: null }),
	duplicateIntent: null,
	setDuplicateIntent: (duplicateIntent) => set({ duplicateIntent }),
	clearDuplicateIntent: () => set({ duplicateIntent: null }),
}));
