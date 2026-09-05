import type { GlowParams } from "./surface";

export type RasterLayerBounds = {
	readonly height: number;
	readonly width: number;
	readonly x: number;
	readonly y: number;
};

export type RasterLayerMatrix = {
	readonly a: number;
	readonly b: number;
	readonly c: number;
	readonly d: number;
	readonly e: number;
	readonly f: number;
};

export type StaticRasterLayerSource = {
	readonly bounds: RasterLayerBounds;
	/** Optional emission-safe variant when base-only optics must not feed glow. */
	readonly emissionSvg?: string;
	readonly emitsGlow: boolean;
	readonly nodeId: string;
	readonly restMatrix: RasterLayerMatrix;
	readonly svg: string;
};

export type StaticRasterCompositionPlan = {
	readonly artboardHeight: number;
	readonly artboardWidth: number;
	readonly background: readonly [number, number, number, number];
	readonly glow: GlowParams;
	readonly layers: readonly StaticRasterLayerSource[];
};

export type StaticRasterLayerFrame = {
	readonly matrix: RasterLayerMatrix;
	readonly nodeId: string;
};

export type StaticRasterCompositionFrame = {
	readonly frame: number;
	readonly layers: readonly StaticRasterLayerFrame[];
};
