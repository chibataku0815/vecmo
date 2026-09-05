import { create } from "zustand";
import type { RenameSelectedNodeIntent } from "./selected-object-actions";

export type SelectedObjectRenameRequest = RenameSelectedNodeIntent & {
	readonly requestId: number;
};

type SelectedObjectRenameRequestStore = {
	readonly request: SelectedObjectRenameRequest | null;
	readonly nextRequestId: number;
	readonly requestRename: (intent: RenameSelectedNodeIntent) => void;
	readonly consumeRenameRequest: (requestId: number) => void;
	readonly clearRenameRequest: () => void;
};

/**
 * Carries a selected-object rename intent from global action surfaces to the
 * Layers inline editor. The request is ephemeral editor workflow state, not
 * scene data, so it stays outside the document command history.
 */
export const useSelectedObjectRenameRequestStore =
	create<SelectedObjectRenameRequestStore>()((set) => ({
		request: null,
		nextRequestId: 1,
		requestRename: (intent) =>
			set((state) => ({
				request: { ...intent, requestId: state.nextRequestId },
				nextRequestId: state.nextRequestId + 1,
			})),
		consumeRenameRequest: (requestId) =>
			set((state) =>
				state.request?.requestId === requestId ? { request: null } : state,
			),
		clearRenameRequest: () => set({ request: null }),
	}));
