import { create } from "zustand";
import type { PencilStrokeIntent } from "./pencil-intent";

/**
 * Transient holder for the most recent {@link PencilStrokeIntent}. It is the
 * seam the motion feature reads after the draw feature commits a stroke: both
 * live below the feature layer, so neither may import the other, and they meet
 * here in `shared` instead. Purely gesture-scoped — overwritten on each stroke,
 * cleared once a conversion consumes it — and never serialized into the scene
 * document.
 */
type StrokeIntentState = {
	readonly lastIntent: PencilStrokeIntent | null;
	readonly setLastIntent: (intent: PencilStrokeIntent) => void;
	readonly clearLastIntent: () => void;
};

export const useStrokeIntentStore = create<StrokeIntentState>()((set) => ({
	lastIntent: null,
	setLastIntent: (lastIntent) => set({ lastIntent }),
	clearLastIntent: () => set({ lastIntent: null }),
}));
