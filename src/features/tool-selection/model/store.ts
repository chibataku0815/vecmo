import { create } from "zustand";
import type { ToolId } from "./tools";

type ToolSelectionState = {
	activeTool: ToolId;
	setActiveTool: (tool: ToolId) => void;
};

export const useToolSelectionStore = create<ToolSelectionState>()((set) => ({
	activeTool: "select",
	setActiveTool: (activeTool) => set({ activeTool }),
}));
