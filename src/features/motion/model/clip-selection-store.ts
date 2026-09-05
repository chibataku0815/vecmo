import { create } from "zustand";

type MotionClipSelectionStore = {
	readonly selectedClipId: string | null;
	readonly setSelectedClipId: (clipId: string | null) => void;
	readonly clearSelectedClip: () => void;
};

/**
 * Shared timeline clip focus. Timeline owns the gesture, while Inspector reads
 * this store to expose first-class motion-system controls for grammar-backed
 * clips such as `Time Delay expansion`.
 */
export const useMotionClipSelectionStore = create<MotionClipSelectionStore>()(
	(set) => ({
		selectedClipId: null,
		setSelectedClipId: (clipId) => set({ selectedClipId: clipId }),
		clearSelectedClip: () => set({ selectedClipId: null }),
	}),
);
