import { create } from "zustand";
import type { StrokeCap, StrokeJoin } from "@/entities/scene/model/types";

/**
 * Brush family the Pencil tool authors with. Each family pins a cap/join feel
 * (see {@link PENCIL_BRUSH_PRESETS}) and seeds sensible width/pressure
 * defaults; {@link resolvePencilBrush} always derives `strokeCap`/`strokeJoin`
 * from the active family rather than storing them as independent, driftable
 * state — there is no UI to override cap/join directly.
 */
export type PencilBrushType = "pen" | "pencil" | "marker";

type PencilBrushPreset = {
	readonly width: number;
	readonly strokeCap: StrokeCap;
	readonly strokeJoin: StrokeJoin;
	readonly pressureEnabled: boolean;
};

/**
 * Sensible defaults per brush family, applied by `setBrushType` and read by
 * {@link resolvePencilBrush} for cap/join. Widths/feel mirror the tool each is
 * named after: Pen is a uniform technical line, Pencil tapers with pressure
 * like graphite, Marker is a wide flat-tipped chisel (butt cap reads as a
 * squared-off nib; the round join keeps corners from spiking).
 */
export const PENCIL_BRUSH_PRESETS = {
	pen: {
		width: 2,
		strokeCap: "round",
		strokeJoin: "round",
		pressureEnabled: false,
	},
	pencil: {
		width: 2.4,
		strokeCap: "round",
		strokeJoin: "round",
		pressureEnabled: true,
	},
	marker: {
		width: 8,
		strokeCap: "butt",
		strokeJoin: "round",
		pressureEnabled: false,
	},
} as const satisfies Record<PencilBrushType, PencilBrushPreset>;

/** Default pressure taper strength: 1 = full raw pressure range, 0 = uniform width. */
export const DEFAULT_PENCIL_PRESSURE_SENSITIVITY = 0.8;

/** Authored stroke-width bounds, shared by the store's clamp and the options bar's slider range. */
export const PENCIL_WIDTH_MIN = 0.5;
export const PENCIL_WIDTH_MAX = 40;

const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));

/** Data-only slice of the Pencil tool's config — the shape {@link resolvePencilBrush} reads. */
export type PencilToolConfig = {
	readonly brushType: PencilBrushType;
	readonly width: number;
	readonly pressureEnabled: boolean;
	/** 0..1: how strongly pressure deviates width from uniform; see {@link resolvePencilBrush}. */
	readonly pressureSensitivity: number;
};

type PencilToolState = PencilToolConfig & {
	readonly setBrushType: (brushType: PencilBrushType) => void;
	readonly setWidth: (width: number) => void;
	readonly setPressureEnabled: (enabled: boolean) => void;
	readonly setPressureSensitivity: (sensitivity: number) => void;
};

/**
 * Feature-local store for the Pencil tool's pre-draw brush configuration:
 * brush family, authored width, and pressure taper. Read once per commit via
 * `usePencilToolStore.getState()` (see `commitFreehandStroke` in
 * `freehand-commit.ts`) rather than subscribed inside the draw handler, so a
 * mid-stroke config change never mutates a stroke already in flight — it only
 * affects the next one.
 */
export const usePencilToolStore = create<PencilToolState>()((set) => ({
	brushType: "pencil",
	width: PENCIL_BRUSH_PRESETS.pencil.width,
	pressureEnabled: PENCIL_BRUSH_PRESETS.pencil.pressureEnabled,
	pressureSensitivity: DEFAULT_PENCIL_PRESSURE_SENSITIVITY,
	setBrushType: (brushType) => {
		const preset = PENCIL_BRUSH_PRESETS[brushType];
		set({
			brushType,
			width: preset.width,
			pressureEnabled: preset.pressureEnabled,
		});
	},
	setWidth: (width) =>
		set({ width: clamp(width, PENCIL_WIDTH_MIN, PENCIL_WIDTH_MAX) }),
	setPressureEnabled: (pressureEnabled) => set({ pressureEnabled }),
	setPressureSensitivity: (pressureSensitivity) =>
		set({ pressureSensitivity: clamp(pressureSensitivity, 0, 1) }),
}));

/** The concrete stroke style {@link resolvePencilBrush} resolves a {@link PencilToolConfig} into. */
export type ResolvedPencilBrush = {
	readonly strokeWidth: number;
	readonly strokeCap: StrokeCap;
	readonly strokeJoin: StrokeJoin;
	/** Whether the next commit should derive a pressure-taper `strokeWidthProfile` at all. */
	readonly deriveProfile: boolean;
	/** Blend factor toward the raw derived taper (see `scaleWidthProfileSensitivity` in freehand-commit.ts). */
	readonly sensitivity: number;
};

/**
 * Resolves a pencil-tool config into the concrete style a committed stroke
 * should use. `strokeCap`/`strokeJoin` always come from the brush family's
 * preset, never from independently-stored state, so switching brush type can
 * never leave a stale cap/join behind. Pure and store-independent — callable
 * with any object shaped like {@link PencilToolConfig}, not just
 * `usePencilToolStore.getState()` — so it is unit-testable without mounting
 * the store.
 */
export function resolvePencilBrush(
	state: PencilToolConfig,
): ResolvedPencilBrush {
	const preset = PENCIL_BRUSH_PRESETS[state.brushType];
	return {
		strokeWidth: state.width,
		strokeCap: preset.strokeCap,
		strokeJoin: preset.strokeJoin,
		deriveProfile: state.pressureEnabled,
		sensitivity: state.pressureSensitivity,
	};
}
