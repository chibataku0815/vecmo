import { create } from "zustand";
import {
	MAX_BLEND_STEPS,
	normalizeBlendOrientation,
	normalizeBlendSpacing,
} from "@/entities/scene/model/blend";
import type {
	BlendOrientation,
	BlendSourceStop,
	BlendSpacing,
	Vec2,
} from "@/entities/scene/model/types";

export type BlendSpineTarget =
	| { readonly kind: "line-start" }
	| { readonly kind: "line-end" }
	| { readonly kind: "line-segment"; readonly t: number }
	| { readonly kind: "path-anchor"; readonly index: number }
	| {
			readonly kind: "path-segment";
			readonly index: number;
			readonly t: number;
	  }
	| { readonly kind: "path-in"; readonly index: number }
	| { readonly kind: "path-out"; readonly index: number };

export type BlendSpineSubSelection = BlendSpineTarget & {
	readonly blendNodeId: string;
};

type BlendToolState = {
	/** Ordered pending Blend stops; each stop may carry a clicked local anchor. */
	readonly sourceStops: readonly BlendSourceStop[];
	readonly hoverStop: BlendSourceStop | null;
	readonly cursor: Vec2 | null;
	readonly spacing: BlendSpacing;
	readonly orientation: BlendOrientation;
	readonly selectedSpine: BlendSpineSubSelection | null;
	readonly hoverSpine: BlendSpineSubSelection | null;
	readonly setSourceStops: (stops: readonly BlendSourceStop[]) => void;
	readonly setHoverStop: (stop: BlendSourceStop | null) => void;
	readonly setCursor: (cursor: Vec2 | null) => void;
	readonly setSpacing: (spacing: BlendSpacing) => void;
	readonly setOrientation: (orientation: BlendOrientation) => void;
	readonly setSelectedSpine: (target: BlendSpineSubSelection | null) => void;
	readonly setHoverSpine: (target: BlendSpineSubSelection | null) => void;
	readonly setSteps: (steps: number) => void;
	readonly resetGesture: () => void;
};

export const useBlendToolStore = create<BlendToolState>()((set) => ({
	sourceStops: [],
	hoverStop: null,
	cursor: null,
	spacing: { kind: "specified-steps", steps: 8 },
	orientation: "page",
	selectedSpine: null,
	hoverSpine: null,
	setSourceStops: (sourceStops) => set({ sourceStops }),
	setHoverStop: (hoverStop) => set({ hoverStop }),
	setCursor: (cursor) => set({ cursor }),
	setSpacing: (spacing) => set({ spacing: normalizeBlendSpacing(spacing) }),
	setOrientation: (orientation) =>
		set({ orientation: normalizeBlendOrientation(orientation) }),
	setSelectedSpine: (selectedSpine) => set({ selectedSpine }),
	setHoverSpine: (hoverSpine) => set({ hoverSpine }),
	setSteps: (steps) =>
		set({
			spacing: {
				kind: "specified-steps",
				steps: Math.round(Math.min(MAX_BLEND_STEPS, Math.max(1, steps))),
			},
		}),
	resetGesture: () =>
		set({ sourceStops: [], hoverStop: null, cursor: null, hoverSpine: null }),
}));
