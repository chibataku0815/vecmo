import type { NormalizedArtboard } from "@/entities/scene/model/selectors";
import type {
	SnapAxis,
	SnapPoint,
	SnapProjection,
} from "@/shared/lib/snapping";
import {
	BASE_GRID_SPACING,
	gridLineDensity,
	isMajorGridIndex,
} from "./snapping";

const DEFAULT_ARTBOARD_LAYOUT_GRID_SPACING = BASE_GRID_SPACING;
const DEFAULT_ARTBOARD_PIXEL_GRID_SPACING = 1;
const DEFAULT_PIXEL_MIN_SCREEN_STEP_PX = 8;
const EPSILON = 0.000001;

export type ArtboardGridKind = "minor" | "major" | "pixel";

export type ArtboardGridSettings = {
	readonly visible?: boolean;
	readonly spacing?: number;
	readonly minScreenStepPx?: number;
};

export type ArtboardGridLine = {
	readonly artboardId: string;
	readonly axis: SnapAxis;
	readonly value: number;
	readonly from: SnapPoint;
	readonly to: SnapPoint;
	readonly kind: ArtboardGridKind;
	readonly spacing: number;
	readonly index: number;
};

export type CollectArtboardGridLinesOptions = {
	readonly layout?: ArtboardGridSettings;
	readonly pixel?: ArtboardGridSettings;
};

const finitePositive = (value: number | undefined, fallback: number): number =>
	Number.isFinite(value) && value !== undefined && value > 0 ? value : fallback;

const roundGridValue = (value: number): number =>
	Math.abs(value) < EPSILON ? 0 : Number(value.toFixed(6));

const visibleSetting = (
	settings: ArtboardGridSettings | undefined,
	defaultVisible: boolean,
): boolean => settings?.visible ?? defaultVisible;

const effectivePixelSpacing = (
	settings: ArtboardGridSettings | undefined,
	zoom: number,
): number | null => {
	if (!visibleSetting(settings, false)) return null;
	const spacing = finitePositive(
		settings?.spacing,
		DEFAULT_ARTBOARD_PIXEL_GRID_SPACING,
	);
	const minScreenStep =
		settings?.minScreenStepPx ?? DEFAULT_PIXEL_MIN_SCREEN_STEP_PX;
	return spacing * zoom >= minScreenStep ? spacing : null;
};

const lineEndpoints = (
	artboard: NormalizedArtboard,
	axis: SnapAxis,
	value: number,
): { readonly from: SnapPoint; readonly to: SnapPoint } =>
	axis === "x"
		? { from: { x: value, y: 0 }, to: { x: value, y: artboard.height } }
		: { from: { x: 0, y: value }, to: { x: artboard.width, y: value } };

/**
 * Layout strokes (minor + major) for one axis, in artboard-local coordinates. The
 * minor/major split and the suppress-on-zoom-out density rule are shared with the
 * full-screen workspace grid (see `gridLineDensity` / `isMajorGridIndex` in
 * snapping.ts) so the on-card grid and the surrounding desk grid stay one
 * continuous, identically-thinned lattice. Phased to local 0 — i.e. the artboard
 * origin — which is also the workspace grid's phase offset, so the two never seam.
 */
const collectLayoutAxisLines = (
	artboard: NormalizedArtboard,
	axis: SnapAxis,
	spacing: number,
	density: { readonly showMinor: boolean; readonly showMajor: boolean },
): ArtboardGridLine[] => {
	const limit = axis === "x" ? artboard.width : artboard.height;
	const crossLimit = axis === "x" ? artboard.height : artboard.width;
	if (limit <= 0 || crossLimit <= 0) return [];

	const last = Math.floor(limit / spacing);
	const lines: ArtboardGridLine[] = [];
	for (let index = 0; index <= last; index += 1) {
		const major = isMajorGridIndex(index);
		if (major ? !density.showMajor : !density.showMinor) continue;
		const value = roundGridValue(index * spacing);
		if (value < -EPSILON || value > limit + EPSILON) continue;
		lines.push({
			artboardId: artboard.id,
			axis,
			value,
			...lineEndpoints(artboard, axis, value),
			kind: major ? "major" : "minor",
			spacing,
			index,
		});
	}
	return lines;
};

const collectPixelAxisLines = (
	artboard: NormalizedArtboard,
	axis: SnapAxis,
	spacing: number,
): ArtboardGridLine[] => {
	const limit = axis === "x" ? artboard.width : artboard.height;
	const crossLimit = axis === "x" ? artboard.height : artboard.width;
	if (limit <= 0 || crossLimit <= 0) return [];

	const last = Math.floor(limit / spacing);
	const lines: ArtboardGridLine[] = [];
	for (let index = 0; index <= last; index += 1) {
		const value = roundGridValue(index * spacing);
		if (value < -EPSILON || value > limit + EPSILON) continue;
		lines.push({
			artboardId: artboard.id,
			axis,
			value,
			...lineEndpoints(artboard, axis, value),
			kind: "pixel",
			spacing,
			index,
		});
	}
	return lines;
};

/**
 * Collects construction grid strokes inside one artboard's local coordinate
 * system. The returned lines deliberately do not include pasteboard pan offsets:
 * renderers should place them inside the same translated artboard group as the
 * white fill, which keeps every artboard's origin, clip, and zoom thinning
 * independent in multi-artboard documents. The layout tier mirrors the workspace
 * grid's BASE-spaced minor + major lattice so the on-card grid is the same grid as
 * the surrounding desk grid (and as the snap candidates).
 */
export function collectArtboardGridLines(
	artboard: NormalizedArtboard,
	projection: SnapProjection,
	options: CollectArtboardGridLinesOptions = {},
): ArtboardGridLine[] {
	if (!(projection.zoom > 0) || artboard.width <= 0 || artboard.height <= 0) {
		return [];
	}

	const lines: ArtboardGridLine[] = [];

	const pixelSpacing = effectivePixelSpacing(options.pixel, projection.zoom);
	if (pixelSpacing !== null) {
		lines.push(
			...collectPixelAxisLines(artboard, "x", pixelSpacing),
			...collectPixelAxisLines(artboard, "y", pixelSpacing),
		);
	}

	if (visibleSetting(options.layout, true)) {
		const spacing = finitePositive(
			options.layout?.spacing,
			DEFAULT_ARTBOARD_LAYOUT_GRID_SPACING,
		);
		const density = gridLineDensity(projection.zoom, {
			spacing,
			minScreenStepPx: options.layout?.minScreenStepPx,
		});
		if (density.showMinor || density.showMajor) {
			lines.push(
				...collectLayoutAxisLines(artboard, "x", spacing, density),
				...collectLayoutAxisLines(artboard, "y", spacing, density),
			);
		}
	}

	return lines;
}
