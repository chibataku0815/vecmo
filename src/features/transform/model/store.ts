import { create } from "zustand";
import type { Aabb, CornerHandleId, HandleId } from "./geometry";

/** A handle/zone the pointer is hovering or actively dragging. */
export type TransformTarget =
	| { readonly kind: "resize"; readonly handle: HandleId }
	| { readonly kind: "rotate"; readonly handle: HandleId }
	| { readonly kind: "anchor" }
	| { readonly kind: "corner-radius"; readonly handle: CornerHandleId }
	| { readonly kind: "move" }
	| null;

/**
 * Per-node bounding-box orientation. Absence of a key means `"auto"` (the
 * default: an oriented frame for one node, the axis-aligned union for many).
 * `"axis-aligned"` forces the upright AABB frame for a single rotated node —
 * Illustrator's "Reset Bounding Box" state.
 */
export type BoundingBoxMode = "axis-aligned";

/**
 * True when `nodeId` is in the upright/axis-aligned bounding-box mode. Pure
 * lookup so the overlay (hook) and the handler (`getState()`) resolve the mode
 * identically — a desync here renders handles where clicks miss.
 */
export function isAxisAlignedMode(
	modes: Readonly<Record<string, BoundingBoxMode>>,
	nodeId: string,
): boolean {
	return modes[nodeId] === "axis-aligned";
}

/**
 * Structural equality for {@link TransformTarget}. Both `hover` and `active`
 * are re-derived from scratch on every pointermove (a fresh object per call),
 * so a reference check alone would repaint the overlay on every move even
 * while hovering the same handle/zone; this compares the discriminant plus
 * whichever handle field applies.
 */
export function sameTransformTarget(
	a: TransformTarget,
	b: TransformTarget,
): boolean {
	if (a === b) return true;
	if (a === null || b === null) return false;
	if (a.kind === "move" && b.kind === "move") return true;
	if (a.kind === "resize" && b.kind === "resize") return a.handle === b.handle;
	if (a.kind === "rotate" && b.kind === "rotate") return a.handle === b.handle;
	if (a.kind === "corner-radius" && b.kind === "corner-radius")
		return a.handle === b.handle;
	return false;
}

/**
 * Ephemeral, view-only state for the select tool's overlay (marquee rectangle,
 * hovered handle, in-progress gesture target). It is deliberately separate from
 * the scene command bus: nothing here is undoable or persisted. The handler
 * writes it; the overlay reads it.
 *
 * `boundingBoxMode` and `boundingBoxHandlesVisible` are user-driven view modes
 * (Reset Bounding Box / Show-Hide Bounding Box). They are keyed by stable nodeId
 * so a Reset survives deselect/reselect, and they live here — NOT in the scene
 * document — because they paint nothing and must never enter undo/redo. They are
 * intentionally excluded from {@link reset}, which only clears gesture scratch.
 */
type TransformUiState = {
	readonly marquee: Aabb | null;
	readonly hover: TransformTarget;
	readonly active: TransformTarget;
	/** The unselected node under the cursor, for a Figma-style hover outline. */
	readonly hoveredNodeId: string | null;
	/**
	 * True while an artboard move/resize gesture is live. The canvas reads this to
	 * FREEZE the pasteboard frame for the gesture's duration: the frame is the
	 * unpadded artboard union, so a live move/resize would otherwise shift the
	 * viewBox/stage under the cursor and make the artboard run away. Cleared by
	 * the handler's gesture-end seams (including {@link reset}).
	 */
	readonly artboardGesture: boolean;
	/** Per-node upright-box overrides; absent key === `"auto"`. */
	readonly boundingBoxMode: Readonly<Record<string, BoundingBoxMode>>;
	/** Global Show/Hide Bounding Box (⇧⌘B). When false, handles are suppressed. */
	readonly boundingBoxHandlesVisible: boolean;
	readonly setMarquee: (rect: Aabb | null) => void;
	readonly setHover: (target: TransformTarget) => void;
	readonly setActive: (target: TransformTarget) => void;
	readonly setHoveredNode: (nodeId: string | null) => void;
	readonly setArtboardGesture: (active: boolean) => void;
	/** Reset Bounding Box: switch the given nodes to the upright AABB frame. */
	readonly resetToAxisAligned: (nodeIds: readonly string[]) => void;
	/** Drop a node's override back to `"auto"` (e.g. after a rotate commits). */
	readonly clearMode: (nodeId: string) => void;
	readonly setBoundingBoxHandlesVisible: (visible: boolean) => void;
	readonly toggleBoundingBoxHandles: () => void;
	readonly reset: () => void;
};

export const useTransformUiStore = create<TransformUiState>()((set) => ({
	marquee: null,
	hover: null,
	active: null,
	hoveredNodeId: null,
	artboardGesture: false,
	boundingBoxMode: {},
	boundingBoxHandlesVisible: true,
	setMarquee: (marquee) => set({ marquee }),
	setHover: (hover) =>
		set((state) =>
			sameTransformTarget(state.hover, hover) ? state : { hover },
		),
	setActive: (active) => set({ active }),
	setHoveredNode: (hoveredNodeId) =>
		set((state) =>
			state.hoveredNodeId === hoveredNodeId ? state : { hoveredNodeId },
		),
	setArtboardGesture: (artboardGesture) => set({ artboardGesture }),
	resetToAxisAligned: (nodeIds) =>
		set((state) => {
			if (nodeIds.length === 0) return state;
			const next = { ...state.boundingBoxMode };
			for (const nodeId of nodeIds) next[nodeId] = "axis-aligned";
			return { boundingBoxMode: next };
		}),
	clearMode: (nodeId) =>
		set((state) => {
			if (state.boundingBoxMode[nodeId] === undefined) return state;
			const next = { ...state.boundingBoxMode };
			delete next[nodeId];
			return { boundingBoxMode: next };
		}),
	setBoundingBoxHandlesVisible: (boundingBoxHandlesVisible) =>
		set({ boundingBoxHandlesVisible }),
	toggleBoundingBoxHandles: () =>
		set((state) => ({
			boundingBoxHandlesVisible: !state.boundingBoxHandlesVisible,
		})),
	reset: () =>
		set({
			marquee: null,
			hover: null,
			active: null,
			hoveredNodeId: null,
			artboardGesture: false,
		}),
}));
