import {
	createIndexedPixelArtObject,
	type IndexedPixelArtSource,
	PIXEL_ART_INDEX_ALPHABET,
} from "@/entities/scene/model/pixel-art-object";
import type { Bounds, VectorNode } from "@/entities/scene/model/types";

export type PixelRaster = {
	readonly width: number;
	readonly height: number;
	readonly data: Uint8ClampedArray;
};

export type PixelObjectifyDiagnostics = {
	readonly sourceWidth: number;
	readonly sourceHeight: number;
	readonly crop: Bounds;
	readonly cropRatio: number;
	readonly logicalWidth: number;
	readonly logicalHeight: number;
	readonly palette: readonly string[];
	readonly rawRegionCount: number;
	readonly regionCount: number;
	readonly aggregatedRegionCount: number;
	readonly rowRunCount: number;
	readonly sceneNodeCount: number;
	readonly logicalPixelCount: number;
	readonly occupiedPixelCount: number;
};

export type PixelObjectifyResult =
	| {
			readonly ok: true;
			readonly node: VectorNode;
			readonly raster: PixelRaster;
			readonly indexedSource: IndexedPixelArtSource;
			readonly diagnostics: PixelObjectifyDiagnostics;
	  }
	| {
			readonly ok: false;
			readonly code:
				| "invalid-raster"
				| "empty-raster"
				| "region-budget-exceeded"
				| "run-budget-exceeded";
			readonly message: string;
			readonly diagnostics?: Partial<PixelObjectifyDiagnostics>;
	  };

type RgbSample = {
	readonly r: number;
	readonly g: number;
	readonly b: number;
	readonly count: number;
};

type PaletteColor = {
	readonly r: number;
	readonly g: number;
	readonly b: number;
};

const DEFAULT_LONG_EDGE = 64;
const DEFAULT_PALETTE_SIZE = 16;
const DEFAULT_ALPHA_THRESHOLD = 16;

const clampInteger = (
	value: number,
	minimum: number,
	maximum: number,
): number => Math.min(maximum, Math.max(minimum, Math.trunc(value)));

const isRasterValid = (raster: PixelRaster): boolean =>
	Number.isInteger(raster.width) &&
	raster.width > 0 &&
	Number.isInteger(raster.height) &&
	raster.height > 0 &&
	raster.data.length === raster.width * raster.height * 4;

const pixelOffset = (width: number, x: number, y: number): number =>
	(y * width + x) * 4;

const rgbaAt = (
	raster: PixelRaster,
	x: number,
	y: number,
): readonly [number, number, number, number] => {
	const offset = pixelOffset(raster.width, x, y);
	return [
		raster.data[offset] ?? 0,
		raster.data[offset + 1] ?? 0,
		raster.data[offset + 2] ?? 0,
		raster.data[offset + 3] ?? 0,
	];
};

const alphaContentBounds = (
	raster: PixelRaster,
	alphaThreshold: number,
): Bounds | null => {
	let minX = raster.width;
	let minY = raster.height;
	let maxX = -1;
	let maxY = -1;
	for (let y = 0; y < raster.height; y += 1) {
		for (let x = 0; x < raster.width; x += 1) {
			if (rgbaAt(raster, x, y)[3] < alphaThreshold) continue;
			minX = Math.min(minX, x);
			minY = Math.min(minY, y);
			maxX = Math.max(maxX, x);
			maxY = Math.max(maxY, y);
		}
	}
	return maxX < minX || maxY < minY
		? null
		: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
};

const contentBounds = (
	raster: PixelRaster,
	alphaThreshold: number,
): Bounds | null => alphaContentBounds(raster, alphaThreshold);

const channelDelta = (
	left: readonly [number, number, number, number],
	right: readonly [number, number, number, number],
): number =>
	Math.max(
		Math.abs(left[0] - right[0]),
		Math.abs(left[1] - right[1]),
		Math.abs(left[2] - right[2]),
		Math.abs(left[3] - right[3]),
	);

const hasAlignedPixelLattice = (
	raster: PixelRaster,
	crop: Bounds,
	width: number,
	height: number,
): boolean => {
	if (crop.width % width !== 0 || crop.height % height !== 0) return false;
	const cellWidth = crop.width / width;
	const cellHeight = crop.height / height;
	if (cellWidth < 2 || cellHeight < 2) return false;
	let matchingCells = 0;
	const sampleOffsets = [
		[0.25, 0.25],
		[0.75, 0.25],
		[0.25, 0.75],
		[0.75, 0.75],
	] as const;
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const center = rgbaAt(
				raster,
				crop.x + Math.floor((x + 0.5) * cellWidth),
				crop.y + Math.floor((y + 0.5) * cellHeight),
			);
			const matches = sampleOffsets.every(
				([offsetX, offsetY]) =>
					channelDelta(
						center,
						rgbaAt(
							raster,
							crop.x + Math.floor((x + offsetX) * cellWidth),
							crop.y + Math.floor((y + offsetY) * cellHeight),
						),
					) <= 12,
			);
			if (matches) matchingCells += 1;
		}
	}
	return matchingCells / (width * height) >= 0.9;
};

const resizeToLogicalGrid = (
	raster: PixelRaster,
	crop: Bounds,
	longEdge: number,
): PixelRaster => {
	const scale = longEdge / Math.max(crop.width, crop.height);
	const width = Math.max(1, Math.round(crop.width * scale));
	const height = Math.max(1, Math.round(crop.height * scale));
	const data = new Uint8ClampedArray(width * height * 4);
	const sampleCenters =
		(width === crop.width && height === crop.height) ||
		hasAlignedPixelLattice(raster, crop, width, height);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const offset = pixelOffset(width, x, y);
			if (sampleCenters) {
				const sourceX = Math.min(
					raster.width - 1,
					crop.x + Math.floor(((x + 0.5) * crop.width) / width),
				);
				const sourceY = Math.min(
					raster.height - 1,
					crop.y + Math.floor(((y + 0.5) * crop.height) / height),
				);
				const [red, green, blue, alpha] = rgbaAt(raster, sourceX, sourceY);
				data.set([red, green, blue, alpha], offset);
				continue;
			}

			const sourceX0 = crop.x + (x / width) * crop.width;
			const sourceX1 = crop.x + ((x + 1) / width) * crop.width;
			const sourceY0 = crop.y + (y / height) * crop.height;
			const sourceY1 = crop.y + ((y + 1) / height) * crop.height;
			let red = 0;
			let green = 0;
			let blue = 0;
			let alphaWeight = 0;
			let area = 0;
			for (
				let sourceY = Math.floor(sourceY0);
				sourceY < Math.ceil(sourceY1);
				sourceY += 1
			) {
				const overlapY = Math.max(
					0,
					Math.min(sourceY1, sourceY + 1) - Math.max(sourceY0, sourceY),
				);
				for (
					let sourceX = Math.floor(sourceX0);
					sourceX < Math.ceil(sourceX1);
					sourceX += 1
				) {
					const overlapX = Math.max(
						0,
						Math.min(sourceX1, sourceX + 1) - Math.max(sourceX0, sourceX),
					);
					const sampleArea = overlapX * overlapY;
					const [r, g, b, a] = rgbaAt(raster, sourceX, sourceY);
					const colorWeight = sampleArea * (a / 255);
					red += r * colorWeight;
					green += g * colorWeight;
					blue += b * colorWeight;
					alphaWeight += colorWeight;
					area += sampleArea;
				}
			}
			data[offset] = alphaWeight > 0 ? Math.round(red / alphaWeight) : 0;
			data[offset + 1] = alphaWeight > 0 ? Math.round(green / alphaWeight) : 0;
			data[offset + 2] = alphaWeight > 0 ? Math.round(blue / alphaWeight) : 0;
			data[offset + 3] = area > 0 ? Math.round((alphaWeight / area) * 255) : 0;
		}
	}
	return { width, height, data };
};

const sampledColors = (
	raster: PixelRaster,
	alphaThreshold: number,
): RgbSample[] => {
	const buckets = new Map<
		number,
		{ count: number; red: number; green: number; blue: number }
	>();
	for (let offset = 0; offset < raster.data.length; offset += 4) {
		const alpha = raster.data[offset + 3] ?? 0;
		if (alpha < alphaThreshold) continue;
		const red = raster.data[offset] ?? 0;
		const green = raster.data[offset + 1] ?? 0;
		const blue = raster.data[offset + 2] ?? 0;
		const key = ((red >> 3) << 10) | ((green >> 3) << 5) | (blue >> 3);
		const bucket = buckets.get(key) ?? {
			count: 0,
			red: 0,
			green: 0,
			blue: 0,
		};
		bucket.count += 1;
		bucket.red += red;
		bucket.green += green;
		bucket.blue += blue;
		buckets.set(key, bucket);
	}
	return [...buckets.values()].map((bucket) => ({
		r: Math.round(bucket.red / bucket.count),
		g: Math.round(bucket.green / bucket.count),
		b: Math.round(bucket.blue / bucket.count),
		count: bucket.count,
	}));
};

const channelRange = (
	samples: readonly RgbSample[],
	channel: "r" | "g" | "b",
): number => {
	const values = samples.map((sample) => sample[channel]);
	return Math.max(...values) - Math.min(...values);
};

const splitColorBox = (
	samples: readonly RgbSample[],
): readonly [RgbSample[], RgbSample[]] | null => {
	if (samples.length < 2) return null;
	const channels = ["r", "g", "b"] as const;
	const channel = channels.toSorted(
		(left, right) => channelRange(samples, right) - channelRange(samples, left),
	)[0];
	if (!channel) return null;
	const sorted = samples.toSorted(
		(left, right) => left[channel] - right[channel],
	);
	const total = sorted.reduce((sum, sample) => sum + sample.count, 0);
	let running = 0;
	let splitIndex = 1;
	for (let index = 0; index < sorted.length - 1; index += 1) {
		running += sorted[index]?.count ?? 0;
		if (running >= total / 2) {
			splitIndex = index + 1;
			break;
		}
	}
	return [sorted.slice(0, splitIndex), sorted.slice(splitIndex)];
};

const averageColor = (samples: readonly RgbSample[]): PaletteColor => {
	const total = samples.reduce((sum, sample) => sum + sample.count, 0);
	return {
		r: Math.round(
			samples.reduce((sum, sample) => sum + sample.r * sample.count, 0) / total,
		),
		g: Math.round(
			samples.reduce((sum, sample) => sum + sample.g * sample.count, 0) / total,
		),
		b: Math.round(
			samples.reduce((sum, sample) => sum + sample.b * sample.count, 0) / total,
		),
	};
};

const createPalette = (
	samples: readonly RgbSample[],
	requestedSize: number,
): PaletteColor[] => {
	const boxes: RgbSample[][] = [[...samples]];
	while (boxes.length < requestedSize) {
		const index = boxes
			.map((box, boxIndex) => ({
				boxIndex,
				score:
					Math.max(
						channelRange(box, "r"),
						channelRange(box, "g"),
						channelRange(box, "b"),
					) * box.reduce((sum, sample) => sum + sample.count, 0),
			}))
			.filter(({ score }) => score > 0)
			.toSorted((left, right) => right.score - left.score)[0]?.boxIndex;
		if (index === undefined) break;
		const split = splitColorBox(boxes[index] ?? []);
		if (!split) break;
		boxes.splice(index, 1, split[0], split[1]);
	}
	return boxes.map(averageColor);
};

const paletteDistance = (left: PaletteColor, right: PaletteColor): number =>
	Math.abs(left.r - right.r) +
	Math.abs(left.g - right.g) +
	Math.abs(left.b - right.b);

/**
 * Reserves scarce palette entries for small but semantically important accents.
 * A population-only quantizer otherwise spends every color on a dark forest or
 * garment and erases glass, flowers, metal glints, and magic-light cues.
 */
const selectAccentColors = (
	samples: readonly RgbSample[],
	limit: number,
): PaletteColor[] => {
	const scoreFunctions = [
		(sample: RgbSample) => sample.r + sample.g + sample.b,
		(sample: RgbSample) => sample.g + sample.b - sample.r * 1.35,
		(sample: RgbSample) => sample.r + sample.b - sample.g * 1.35,
		(sample: RgbSample) => sample.r + sample.g - sample.b * 1.35,
		(sample: RgbSample) => sample.r * 1.6 - sample.g - sample.b,
		(sample: RgbSample) => sample.g * 1.6 - sample.r - sample.b,
		(sample: RgbSample) => sample.b * 1.6 - sample.r - sample.g,
	] as const;
	const selected: PaletteColor[] = [];
	for (const score of scoreFunctions) {
		const sample = samples.toSorted(
			(left, right) => score(right) - score(left),
		)[0];
		if (!sample) continue;
		const candidate = { r: sample.r, g: sample.g, b: sample.b };
		if (selected.every((entry) => paletteDistance(entry, candidate) >= 40)) {
			selected.push(candidate);
		}
		if (selected.length >= limit) break;
	}
	return selected;
};

const nearestPaletteIndex = (
	color: readonly [number, number, number],
	palette: readonly PaletteColor[],
): number => {
	let bestIndex = 0;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (let index = 0; index < palette.length; index += 1) {
		const entry = palette[index];
		if (!entry) continue;
		const red = color[0] - entry.r;
		const green = color[1] - entry.g;
		const blue = color[2] - entry.b;
		const distance = red * red + green * green + blue * blue;
		if (distance < bestDistance) {
			bestDistance = distance;
			bestIndex = index;
		}
	}
	return bestIndex;
};

const quantizeRaster = (
	raster: PixelRaster,
	palette: readonly PaletteColor[],
	alphaThreshold: number,
): Int16Array => {
	const indices = new Int16Array(raster.width * raster.height).fill(-1);
	for (let index = 0; index < indices.length; index += 1) {
		const offset = index * 4;
		if ((raster.data[offset + 3] ?? 0) < alphaThreshold) continue;
		indices[index] = nearestPaletteIndex(
			[
				raster.data[offset] ?? 0,
				raster.data[offset + 1] ?? 0,
				raster.data[offset + 2] ?? 0,
			],
			palette,
		);
	}
	return indices;
};

const colorHex = (color: PaletteColor): string =>
	`#${[color.r, color.g, color.b]
		.map((channel) => channel.toString(16).padStart(2, "0"))
		.join("")}`;

/**
 * Canonicalizes an artistically redrawn RGBA reference into a compact indexed
 * square-pixel field, then delegates all native Scene lowering and budgets to
 * {@link createIndexedPixelArtObject}. This is deterministic import logic, not
 * a photo filter or aesthetic model.
 */
export function objectifyPixelArtRaster(
	source: PixelRaster,
	options: {
		readonly sourceName?: string;
		readonly logicalLongEdge?: number;
		readonly paletteSize?: number;
		readonly alphaThreshold?: number;
		readonly pixelSize?: number;
		readonly origin?: { readonly x: number; readonly y: number };
		readonly artboardId?: string;
		readonly idFactory?: (prefix: string) => string;
	} = {},
): PixelObjectifyResult {
	if (!isRasterValid(source)) {
		return {
			ok: false,
			code: "invalid-raster",
			message: "Raster dimensions do not match the RGBA byte length.",
		};
	}
	const alphaThreshold = clampInteger(
		options.alphaThreshold ?? DEFAULT_ALPHA_THRESHOLD,
		1,
		255,
	);
	const crop = contentBounds(source, alphaThreshold);
	if (!crop) {
		return {
			ok: false,
			code: "empty-raster",
			message: "The generated image contains no visible pixels.",
		};
	}
	const logical = resizeToLogicalGrid(
		source,
		crop,
		clampInteger(options.logicalLongEdge ?? DEFAULT_LONG_EDGE, 16, 128),
	);
	const samples = sampledColors(logical, alphaThreshold);
	if (samples.length === 0) {
		return {
			ok: false,
			code: "empty-raster",
			message: "The normalized image contains no visible pixels.",
		};
	}
	const requestedPaletteSize = Math.min(
		samples.length,
		clampInteger(options.paletteSize ?? DEFAULT_PALETTE_SIZE, 2, 32),
	);
	const palette: PaletteColor[] =
		samples.length <= requestedPaletteSize
			? samples.map(({ r, g, b }) => ({ r, g, b }))
			: (() => {
					const accents = selectAccentColors(
						samples,
						Math.min(7, Math.max(1, requestedPaletteSize - 1)),
					);
					const populationPalette = createPalette(
						samples,
						Math.max(1, requestedPaletteSize - accents.length),
					);
					const reduced = [...populationPalette];
					for (const accent of accents) {
						if (
							reduced.every((entry) => paletteDistance(entry, accent) >= 24)
						) {
							reduced.push(accent);
						}
					}
					return reduced;
				})();
	const indices = quantizeRaster(logical, palette, alphaThreshold);
	const origin = options.origin ?? { x: 0, y: 0 };
	const pixelSize = clampInteger(options.pixelSize ?? 8, 1, 32);
	const sourceName = options.sourceName?.trim() || "Generated pixel objects";
	const paletteHex = palette.map(colorHex);
	const rows = Array.from({ length: logical.height }, (_, y) =>
		Array.from({ length: logical.width }, (_, x) => {
			const paletteIndex = indices[y * logical.width + x] ?? -1;
			return paletteIndex < 0
				? "."
				: (PIXEL_ART_INDEX_ALPHABET[paletteIndex] ?? ".");
		}).join(""),
	);
	const indexedSource: IndexedPixelArtSource = {
		name: sourceName,
		origin,
		pixelSize,
		palette: paletteHex,
		rows,
		...(options.artboardId ? { artboardId: options.artboardId } : {}),
	};
	const nativeResult = createIndexedPixelArtObject(
		indexedSource,
		options.idFactory ? { idFactory: options.idFactory } : undefined,
	);
	if (!nativeResult.ok) {
		return {
			ok: false,
			code:
				nativeResult.code === "region-budget-exceeded" ||
				nativeResult.code === "run-budget-exceeded"
					? nativeResult.code
					: "invalid-raster",
			message: nativeResult.message,
			diagnostics: {
				sourceWidth: source.width,
				sourceHeight: source.height,
				crop,
				logicalWidth: logical.width,
				logicalHeight: logical.height,
				palette: paletteHex,
			},
		};
	}
	const nativeDiagnostics = nativeResult.diagnostics;
	const diagnostics: PixelObjectifyDiagnostics = {
		sourceWidth: source.width,
		sourceHeight: source.height,
		crop,
		cropRatio: 1 - (crop.width * crop.height) / (source.width * source.height),
		logicalWidth: logical.width,
		logicalHeight: logical.height,
		palette: paletteHex,
		rawRegionCount: nativeDiagnostics.sourceRegionCount,
		regionCount: nativeDiagnostics.regionCount,
		aggregatedRegionCount: nativeDiagnostics.aggregatedRegionCount,
		rowRunCount: nativeDiagnostics.rowRunCount,
		sceneNodeCount: nativeDiagnostics.sceneNodeCount,
		logicalPixelCount: logical.width * logical.height,
		occupiedPixelCount: nativeDiagnostics.occupiedPixelCount,
	};
	return {
		ok: true,
		node: nativeResult.node,
		raster: logical,
		indexedSource,
		diagnostics,
	};
}
