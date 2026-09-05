import { create } from "zustand";
import type { FrameLookGraphWorkspaceTarget } from "./look-graph-editor";

type LookGraphWorkspaceTargetState = {
	readonly targetOverride: FrameLookGraphWorkspaceTarget | null;
	readonly setTargetOverride: (
		target: FrameLookGraphWorkspaceTarget | null,
	) => void;
	readonly clearTargetOverride: () => void;
};

/**
 * UI-only target override for the Look Graph workspace. Tool-specific entry
 * points, such as Object Noise Gradient's Open Graph action, can route the
 * workspace to a scoped graph owner without teaching generic editor chrome about
 * feature-specific targets.
 */
export const useLookGraphWorkspaceTargetStore =
	create<LookGraphWorkspaceTargetState>()((set) => ({
		targetOverride: null,
		setTargetOverride: (targetOverride) => set({ targetOverride }),
		clearTargetOverride: () => set({ targetOverride: null }),
	}));
