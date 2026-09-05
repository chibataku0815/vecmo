import type { AeShape } from "@/shared/glammer/ae-shape";
import { createId } from "@/shared/lib/id";
import { IDENTITY_TRANSFORM, type VectorNode } from "./types";

export const PIXEL_ART_INDEX_ALPHABET = "0123456789abcdefghijklmnopqrstuv";
export const PIXEL_ART_TRANSPARENT_INDEX = ".";
export const PIXEL_ART_MAX_WIDTH = 128;
export const PIXEL_ART_MAX_HEIGHT = 128;
export const PIXEL_ART_MAX_PALETTE_SIZE = 32;
export const PIXEL_ART_MAX_REGIONS = 256;
export const PIXEL_ART_MAX_ROW_RUNS = 16384;

export type IndexedPixelArtSource = {
	readonly name: string;
	readonly origin: { readonly x: number; readonly y: number };
	readonly pixelSize: number;
	readonly palette: readonly string[];
	readonly rows: readonly string[];
	readonly artboardId?: string;
};

export type IndexedPixelArtDiagnostics = {
	readonly width: number;
	readonly height: number;
	readonly paletteSize: number;
	readonly occupiedPixelCount: number;
	readonly sourceRegionCount: number;
	readonly regionCount: number;
	readonly aggregatedRegionCount: number;
	readonly rowRunCount: number;
	readonly sceneNodeCount: number;
};

export type IndexedPixelArtResult =
	| {
			readonly ok: true;
			readonly node: VectorNode;
			readonly diagnostics: IndexedPixelArtDiagnostics;
	  }
	| {
			readonly ok: false;
			readonly code:
				| "invalid-name"
				| "invalid-origin"
				| "invalid-pixel-size"
				| "invalid-palette"
				| "invalid-rows"
				| "invalid-index"
				| "empty-art"
				| "region-budget-exceeded"
				| "run-budget-exceeded";
			readonly message: string;
	  };

type Region = {
	readonly paletteIndex: number;
	readonly pixels: readonly number[];
	readonly sourceRegionCount?: number;
};

type PixelRun = {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const finitePoint = (point: IndexedPixelArtSource["origin"]): boolean =>
	Number.isFinite(point.x) && Number.isFinite(point.y);

const decodeRows = (
	rows: readonly string[],
	paletteSize: number,
):
	| { readonly ok: true; readonly width: number; readonly indices: Int16Array }
	| {
			readonly ok: false;
			readonly code: "invalid-rows" | "invalid-index";
			readonly message: string;
	  } => {
	const width = rows[0]?.length ?? 0;
	if (
		rows.length === 0 ||
		rows.length > PIXEL_ART_MAX_HEIGHT ||
		width === 0 ||
		width > PIXEL_ART_MAX_WIDTH ||
		rows.some((row) => row.length !== width)
	) {
		return {
			ok: false,
			code: "invalid-rows",
			message: `Pixel rows must form a non-empty rectangle no larger than ${PIXEL_ART_MAX_WIDTH} × ${PIXEL_ART_MAX_HEIGHT}.`,
		};
	}
	const indices = new Int16Array(width * rows.length).fill(-1);
	for (let y = 0; y < rows.length; y += 1) {
		const row = rows[y] ?? "";
		for (let x = 0; x < width; x += 1) {
			const symbol = row[x] ?? "";
			if (symbol === PIXEL_ART_TRANSPARENT_INDEX) continue;
			const paletteIndex = PIXEL_ART_INDEX_ALPHABET.indexOf(
				symbol.toLowerCase(),
			);
			if (paletteIndex < 0 || paletteIndex >= paletteSize) {
				return {
					ok: false,
					code: "invalid-index",
					message: `Pixel row ${y + 1}, column ${x + 1} uses index "${symbol}" outside the supplied palette.`,
				};
			}
			indices[y * width + x] = paletteIndex;
		}
	}
	return { ok: true, width, indices };
};

const neighbors = (index: number, width: number, height: number): number[] => {
	const x = index % width;
	const y = Math.floor(index / width);
	const result: number[] = [];
	if (x > 0) result.push(index - 1);
	if (x + 1 < width) result.push(index + 1);
	if (y > 0) result.push(index - width);
	if (y + 1 < height) result.push(index + width);
	return result;
};

const extractRegions = (
	indices: Int16Array,
	width: number,
	height: number,
): Region[] => {
	const visited = new Uint8Array(indices.length);
	const regions: Region[] = [];
	for (let start = 0; start < indices.length; start += 1) {
		if (visited[start] || indices[start] < 0) continue;
		const paletteIndex = indices[start] ?? -1;
		const queue = [start];
		const pixels: number[] = [];
		visited[start] = 1;
		for (let cursor = 0; cursor < queue.length; cursor += 1) {
			const current = queue[cursor];
			if (current === undefined) continue;
			pixels.push(current);
			for (const neighbor of neighbors(current, width, height)) {
				if (visited[neighbor] || indices[neighbor] !== paletteIndex) continue;
				visited[neighbor] = 1;
				queue.push(neighbor);
			}
		}
		regions.push({ paletteIndex, pixels });
	}
	return regions;
};

const aggregateRegionsToBudget = (
	regions: readonly Region[],
	maxRegions: number,
): Region[] | null => {
	if (regions.length <= maxRegions) return [...regions];
	const paletteIndexes = [
		...new Set(regions.map((region) => region.paletteIndex)),
	];
	if (paletteIndexes.length > maxRegions) return null;
	const ordered = regions.toSorted(
		(left, right) => right.pixels.length - left.pixels.length,
	);
	const individualCount = Math.max(0, maxRegions - paletteIndexes.length);
	const individual = ordered.slice(0, individualCount);
	const overflow = new Map<number, Region[]>();
	for (const region of ordered.slice(individualCount)) {
		const entries = overflow.get(region.paletteIndex) ?? [];
		entries.push(region);
		overflow.set(region.paletteIndex, entries);
	}
	return [
		...individual,
		...[...overflow.entries()].map(([paletteIndex, entries]) => ({
			paletteIndex,
			pixels: entries.flatMap((entry) => entry.pixels),
			sourceRegionCount: entries.length,
		})),
	];
};

const runsForRegion = (region: Region, width: number): PixelRun[] => {
	const rows = new Map<number, number[]>();
	for (const pixel of region.pixels) {
		const y = Math.floor(pixel / width);
		const row = rows.get(y) ?? [];
		row.push(pixel % width);
		rows.set(y, row);
	}
	const runs: PixelRun[] = [];
	for (const [y, xs] of [...rows.entries()].toSorted(
		(left, right) => left[0] - right[0],
	)) {
		const ordered = xs.toSorted((left, right) => left - right);
		let start = ordered[0];
		let previous = ordered[0];
		if (start === undefined || previous === undefined) continue;
		for (let index = 1; index <= ordered.length; index += 1) {
			const current = ordered[index];
			if (current !== undefined && current === previous + 1) {
				previous = current;
				continue;
			}
			runs.push({ x: start, y, width: previous - start + 1, height: 1 });
			if (current !== undefined) {
				start = current;
				previous = current;
			}
		}
	}
	const coalesced: PixelRun[] = [];
	const latestBySpan = new Map<string, number>();
	for (const run of runs) {
		const key = `${run.x}:${run.width}`;
		const previousIndex = latestBySpan.get(key);
		const previous =
			previousIndex === undefined ? undefined : coalesced[previousIndex];
		if (
			previousIndex !== undefined &&
			previous &&
			previous.y + previous.height === run.y
		) {
			coalesced[previousIndex] = { ...previous, height: previous.height + 1 };
			continue;
		}
		latestBySpan.set(key, coalesced.length);
		coalesced.push(run);
	}
	return coalesced;
};

const rectangleShape = (
	run: PixelRun,
	origin: IndexedPixelArtSource["origin"],
	pixelSize: number,
): AeShape => {
	const left = origin.x + run.x * pixelSize;
	const top = origin.y + run.y * pixelSize;
	const right = left + run.width * pixelSize;
	const bottom = top + run.height * pixelSize;
	return {
		type: "Shape",
		closed: true,
		vertices: [
			[left, top],
			[right, top],
			[right, bottom],
			[left, bottom],
		],
		inTangents: [
			[0, 0],
			[0, 0],
			[0, 0],
			[0, 0],
		],
		outTangents: [
			[0, 0],
			[0, 0],
			[0, 0],
			[0, 0],
		],
	};
};

const identityTransform = (): typeof IDENTITY_TRANSFORM => ({
	position: { ...IDENTITY_TRANSFORM.position },
	rotation: IDENTITY_TRANSFORM.rotation,
	scale: { ...IDENTITY_TRANSFORM.scale },
	anchor: { ...IDENTITY_TRANSFORM.anchor },
});

/**
 * Lowers a compact indexed square-pixel field into one native group containing
 * compound paths for four-connected palette regions. When the child budget is
 * exceeded, small disconnected same-color regions share an overflow path without
 * recoloring or dropping pixels. Each rectangular contour represents a run,
 * never one Scene node per logical pixel.
 */
export function createIndexedPixelArtObject(
	source: IndexedPixelArtSource,
	options: { readonly idFactory?: (prefix: string) => string } = {},
): IndexedPixelArtResult {
	const name = source.name.trim();
	if (!name)
		return {
			ok: false,
			code: "invalid-name",
			message: "A non-empty object name is required.",
		};
	if (!finitePoint(source.origin))
		return {
			ok: false,
			code: "invalid-origin",
			message: "Pixel-art origin coordinates must be finite.",
		};
	if (
		!Number.isInteger(source.pixelSize) ||
		source.pixelSize < 1 ||
		source.pixelSize > 32
	) {
		return {
			ok: false,
			code: "invalid-pixel-size",
			message: "Pixel size must be between 1 and 32 scene units.",
		};
	}
	if (
		source.palette.length < 1 ||
		source.palette.length > PIXEL_ART_MAX_PALETTE_SIZE ||
		source.palette.some((color) => !HEX_COLOR.test(color))
	) {
		return {
			ok: false,
			code: "invalid-palette",
			message: `Palette must contain 1-${PIXEL_ART_MAX_PALETTE_SIZE} six-digit hex colors.`,
		};
	}
	const decoded = decodeRows(source.rows, source.palette.length);
	if (!decoded.ok) return decoded;
	const height = source.rows.length;
	const sourceRegions = extractRegions(decoded.indices, decoded.width, height);
	if (sourceRegions.length === 0)
		return {
			ok: false,
			code: "empty-art",
			message: "At least one visible indexed pixel is required.",
		};
	const regions = aggregateRegionsToBudget(
		sourceRegions,
		PIXEL_ART_MAX_REGIONS,
	);
	if (!regions) {
		return {
			ok: false,
			code: "region-budget-exceeded",
			message: `The indexed field cannot be represented within the ${PIXEL_ART_MAX_REGIONS}-node region budget.`,
		};
	}
	const regionsWithRuns = regions
		.map((region) => ({ region, runs: runsForRegion(region, decoded.width) }))
		.toSorted(
			(left, right) =>
				right.region.pixels.length - left.region.pixels.length ||
				left.region.paletteIndex - right.region.paletteIndex,
		);
	const rowRunCount = regionsWithRuns.reduce(
		(sum, entry) => sum + entry.runs.length,
		0,
	);
	if (rowRunCount > PIXEL_ART_MAX_ROW_RUNS) {
		return {
			ok: false,
			code: "run-budget-exceeded",
			message: `The indexed field needs ${rowRunCount} row-run contours; the limit is ${PIXEL_ART_MAX_ROW_RUNS}.`,
		};
	}
	const idFactory = options.idFactory ?? createId;
	const children = regionsWithRuns.flatMap(({ region, runs }, index) => {
		const contours = runs.map((run) =>
			rectangleShape(run, source.origin, source.pixelSize),
		);
		const first = contours[0];
		const fill = source.palette[region.paletteIndex];
		if (!first || !fill) return [];
		return [
			{
				id: idFactory("node-pixel-region"),
				name: `${name} · region ${index + 1}`,
				...(source.artboardId ? { artboardId: source.artboardId } : {}),
				geometry: {
					kind: "path" as const,
					shape: first,
					...(contours.length > 1
						? { subpaths: contours.slice(1), fillRule: "nonzero" as const }
						: {}),
				},
				transform: identityTransform(),
				style: { fill, stroke: "none", strokeWidth: 0, opacity: 1 },
				visible: true,
				locked: false,
				data: {
					pixelObjectImport: {
						version: 1,
						paletteIndex: region.paletteIndex,
						pixelCount: region.pixels.length,
						rowRunCount: runs.length,
						sourceRegionCount: region.sourceRegionCount ?? 1,
					},
				},
			} satisfies VectorNode,
		];
	});
	const occupiedPixelCount = decoded.indices.reduce(
		(count, paletteIndex) => count + (paletteIndex >= 0 ? 1 : 0),
		0,
	);
	const diagnostics: IndexedPixelArtDiagnostics = {
		width: decoded.width,
		height,
		paletteSize: source.palette.length,
		occupiedPixelCount,
		sourceRegionCount: sourceRegions.length,
		regionCount: children.length,
		aggregatedRegionCount: sourceRegions.length - children.length,
		rowRunCount,
		sceneNodeCount: children.length + 1,
	};
	const group: VectorNode = {
		id: idFactory("node-pixel-object-group"),
		name,
		...(source.artboardId ? { artboardId: source.artboardId } : {}),
		geometry: {
			kind: "line",
			start: { ...source.origin },
			end: { ...source.origin },
		},
		transform: identityTransform(),
		style: { fill: "#000000", stroke: "#000000", strokeWidth: 0, opacity: 1 },
		visible: true,
		locked: false,
		children,
		data: {
			pixelObjectImport: {
				version: 1,
				width: decoded.width,
				height,
				pixelSize: source.pixelSize,
				palette: [...source.palette],
				indexedSource: {
					version: 1,
					origin: { ...source.origin },
					pixelSize: source.pixelSize,
					palette: [...source.palette],
					rows: [...source.rows],
					...(source.artboardId ? { artboardId: source.artboardId } : {}),
				},
				regionCount: children.length,
				rowRunCount,
			},
		},
	};
	return { ok: true, node: group, diagnostics };
}
