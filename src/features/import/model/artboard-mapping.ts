import type { Artboard } from "@/entities/scene/model/types";

export type ImportArtboardBounds = {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
};

export const IMPORT_ARTBOARD_GAP = 80;

const IMPORT_ARTBOARD_DEFAULTS = {
	background: "#ffffff",
	fps: 30,
	durationFrames: 180,
} as const;

const roundImportUnit = (value: number): number =>
	Math.abs(value) < 1e-10 ? 0 : Number(value.toFixed(6));

/**
 * Creates the SceneDocument-compatible artboard contract used by import
 * payloads. Bounds are already in pasteboard units; callers must avoid passing
 * speculative or invalid dimensions so source files do not silently invent
 * artboards from unknown geometry.
 */
export function createImportArtboard(input: {
	readonly id: string;
	readonly name: string;
	readonly bounds: ImportArtboardBounds;
	readonly background?: string;
}): Artboard {
	return {
		id: input.id,
		name: input.name,
		position: {
			x: roundImportUnit(input.bounds.x),
			y: roundImportUnit(input.bounds.y),
		},
		width: roundImportUnit(input.bounds.width),
		height: roundImportUnit(input.bounds.height),
		background: input.background ?? IMPORT_ARTBOARD_DEFAULTS.background,
		fps: IMPORT_ARTBOARD_DEFAULTS.fps,
		durationFrames: IMPORT_ARTBOARD_DEFAULTS.durationFrames,
	};
}
