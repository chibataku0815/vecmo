import { create } from "zustand";
import type { Vec2 } from "@/entities/scene/model/types";
import type { ColorPickApplyResult } from "./apply-color";
import type { ColorPickPaintRole, ColorPickResult } from "./color-pick";

export type ColorPickToolSample = {
	readonly point: Vec2;
	readonly targetRole: ColorPickPaintRole;
	readonly pick: ColorPickResult;
	readonly application: ColorPickApplyResult | null;
};

type ColorPickToolState = {
	readonly lastSample: ColorPickToolSample | null;
	readonly setLastSample: (sample: ColorPickToolSample) => void;
	readonly clearLastSample: () => void;
};

/**
 * Feature-local status for the active eyedropper tool. It intentionally stores
 * only sampled result metadata, not document state, so document mutation remains
 * exclusively in scene commands.
 */
export const useColorPickToolStore = create<ColorPickToolState>()((set) => ({
	lastSample: null,
	setLastSample: (lastSample) => set({ lastSample }),
	clearLastSample: () => set({ lastSample: null }),
}));
