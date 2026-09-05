import { create } from "zustand";

export type GradientPaintRole = "fills" | "strokes";

export type GradientStopSelection = {
	readonly targetKey: string;
	readonly stopId: string;
};

/**
 * Ephemeral on-canvas gradient editing UI state, shared between the gradient tool
 * handler (writes) and its overlay (reads). It is deliberately separate from the
 * canonical selection store: `selection.sub` records which stop is *selected* (and
 * mirrors to the inspector for nodes), `selectedStop` covers targets that cannot
 * live in node sub-selection (artboard frame fills), and `editingStopId` records
 * which stop has its inline color popover *open*. `targetRole` records whether
 * the active gradient tool is editing the primary fill or stroke paint; keyboard/
 * tool-rail activation defaults to fills, while Inspector paint popovers switch
 * it to the role they opened.
 */
type GradientEditorState = {
	readonly targetRole: GradientPaintRole;
	readonly selectedStop: GradientStopSelection | null;
	readonly editingStopId: string | null;
	readonly setTargetRole: (role: GradientPaintRole) => void;
	readonly selectStop: (selection: GradientStopSelection | null) => void;
	readonly openStopEditor: (stopId: string) => void;
	readonly closeStopEditor: () => void;
};

export const useGradientEditorStore = create<GradientEditorState>()((set) => ({
	targetRole: "fills",
	selectedStop: null,
	editingStopId: null,
	setTargetRole: (targetRole) =>
		set({ targetRole, selectedStop: null, editingStopId: null }),
	selectStop: (selectedStop) => set({ selectedStop }),
	openStopEditor: (stopId) => set({ editingStopId: stopId }),
	closeStopEditor: () => set({ editingStopId: null }),
}));
