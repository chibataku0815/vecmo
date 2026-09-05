import { create } from "zustand";

/**
 * Ephemeral on-canvas mesh editing UI state, shared between the mesh tool handler
 * (writes) and its overlay (reads). Separate from the canonical selection store:
 * `selection.sub` records which mesh point is *selected* (mirrors to a future
 * inspector), while `editingPoint` records which point has its inline color
 * popover *open* — opened on a double-click, closed on Escape, an outside press,
 * a different selection, or tool deactivation.
 */
export type EditingMeshPoint = { readonly row: number; readonly col: number };

type MeshEditorState = {
	readonly editingPoint: EditingMeshPoint | null;
	readonly openPointEditor: (point: EditingMeshPoint) => void;
	readonly closePointEditor: () => void;
};

export const useMeshEditorStore = create<MeshEditorState>()((set) => ({
	editingPoint: null,
	openPointEditor: (point) => set({ editingPoint: point }),
	closePointEditor: () => set({ editingPoint: null }),
}));
