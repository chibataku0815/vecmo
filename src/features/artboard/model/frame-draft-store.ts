import { create } from "zustand";
import type { Bounds, Vec2 } from "@/entities/scene/model/types";

/**
 * In-flight Frame-tool drag rectangle, expressed in pasteboard ("world") space.
 * Artboards live in pasteboard space (they carry no matrix), so the Frame tool
 * captures the raw `pasteboardPoint` rather than the artboard-local point the
 * shape tools use. This is ephemeral UI state — the artboard only enters the
 * scene document on release, through the command bus.
 */
export type FrameDraft = {
	readonly start: Vec2;
	readonly current: Vec2;
	/** Shift: lock to a square. */
	readonly constrain: boolean;
	/** Alt: grow from the press point as the rectangle's center. */
	readonly fromCenter: boolean;
};

type FrameDraftState = {
	readonly draft: FrameDraft | null;
	readonly setDraft: (draft: FrameDraft | null) => void;
	readonly clearDraft: () => void;
	/**
	 * Pasteboard point where a plain Frame-tool click (no drag) landed. When set,
	 * CanvasShell floats a size-preset menu there (Figma opens presets on click);
	 * choosing one creates a preset-sized artboard centered on this point.
	 */
	readonly presetAnchor: Vec2 | null;
	readonly setPresetAnchor: (anchor: Vec2 | null) => void;
	/** Clears both the in-flight drag and the preset anchor (tool deactivate/Escape). */
	readonly clear: () => void;
};

/**
 * Ephemeral store for the Frame tool's in-progress drag and click-to-preset
 * anchor. Both the tool handler (writer) and CanvasShell's world-space preview +
 * preset menu (readers) share it, mirroring how the draw feature couples its
 * shape handler and shape-preview overlay.
 */
export const useFrameDraftStore = create<FrameDraftState>((set) => ({
	draft: null,
	setDraft: (draft) => set({ draft }),
	clearDraft: () => set({ draft: null }),
	presetAnchor: null,
	setPresetAnchor: (presetAnchor) => set({ presetAnchor }),
	clear: () => set({ draft: null, presetAnchor: null }),
}));

const signOrPositive = (value: number): number => (value < 0 ? -1 : 1);

/**
 * Resolves a {@link FrameDraft} into normalized pasteboard bounds. The same pure
 * function feeds the live preview and the committed artboard, so what the user
 * drags is exactly what is created. `constrain` squares the rectangle to the
 * larger axis; `fromCenter` treats the press point as the center.
 */
export function frameRectFromDraft(draft: FrameDraft): Bounds {
	const rawDx = draft.current.x - draft.start.x;
	const rawDy = draft.current.y - draft.start.y;
	const size = Math.max(Math.abs(rawDx), Math.abs(rawDy));
	const dx = draft.constrain ? signOrPositive(rawDx) * size : rawDx;
	const dy = draft.constrain ? signOrPositive(rawDy) * size : rawDy;

	if (draft.fromCenter) {
		return {
			x: draft.start.x - Math.abs(dx),
			y: draft.start.y - Math.abs(dy),
			width: Math.abs(dx) * 2,
			height: Math.abs(dy) * 2,
		};
	}

	return {
		x: Math.min(draft.start.x, draft.start.x + dx),
		y: Math.min(draft.start.y, draft.start.y + dy),
		width: Math.abs(dx),
		height: Math.abs(dy),
	};
}
