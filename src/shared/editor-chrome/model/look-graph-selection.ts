import { create } from "zustand";

export type LookGraphSelectionOwnerKey = string;

type LookGraphSelectionState = {
	readonly selectedOwnerKey: LookGraphSelectionOwnerKey | null;
	readonly selectedNodeId: string | null;
	readonly setSelectedNodeId: (nodeId: string | null) => void;
	readonly setSelectedNodeForOwner: (
		ownerKey: LookGraphSelectionOwnerKey,
		nodeId: string | null,
	) => void;
};

/**
 * UI-only selection for the frame Look graph authoring surface. Scene selection
 * still owns artwork/layer targeting. The selected Look node is keyed by graph
 * owner so scene, artboard, and object-scoped overlay graphs cannot interpret a
 * stale node id as their own selection.
 *
 * Lives in `shared` (not a `features` slice) because it is read across features
 * that must not import each other — e.g. an on-canvas overlay feature that
 * self-gates on the currently selected Look graph node without depending on
 * the look-authoring feature that owns key-building/target-resolution helpers.
 * This store intentionally holds only the raw owner-key/node-id strings and
 * their setters; callers compute the owner-key string (e.g. via
 * `lookGraphTargetKey` in `features/look-authoring`) and pass it in.
 */
export const useLookGraphSelectionStore = create<LookGraphSelectionState>()(
	(set) => ({
		selectedOwnerKey: null,
		selectedNodeId: null,
		setSelectedNodeId: (selectedNodeId) =>
			set({ selectedOwnerKey: null, selectedNodeId }),
		setSelectedNodeForOwner: (selectedOwnerKey, selectedNodeId) =>
			set({ selectedOwnerKey, selectedNodeId }),
	}),
);
