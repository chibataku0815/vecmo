import { create } from "zustand";

/** Session-only point focus shared by canvas handles and Inspector precision UI. */
export type EffectFieldMeshPointSelection = {
	readonly nodeId: string;
	readonly fieldId: string;
	readonly row: number;
	readonly col: number;
};

type EffectFieldEditorState = {
	readonly descriptorId: string;
	readonly meshPoint: EffectFieldMeshPointSelection | null;
	readonly setDescriptorId: (descriptorId: string) => void;
	readonly setMeshPoint: (
		meshPoint: EffectFieldMeshPointSelection | null,
	) => void;
	readonly reset: () => void;
};

const DEFAULT_DESCRIPTOR_ID = "style.opacity";

/** Session-only focus shared by Inspector precision controls and canvas handles. */
export const useEffectFieldEditorStore = create<EffectFieldEditorState>()(
	(set) => ({
		descriptorId: DEFAULT_DESCRIPTOR_ID,
		meshPoint: null,
		setDescriptorId: (descriptorId) => set({ descriptorId, meshPoint: null }),
		setMeshPoint: (meshPoint) => set({ meshPoint }),
		reset: () => set({ descriptorId: DEFAULT_DESCRIPTOR_ID, meshPoint: null }),
	}),
);
