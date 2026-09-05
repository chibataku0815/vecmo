import { scalarEffectFieldMeshScene } from "@/shared/effect-field";
import {
	encodePngDataUrl,
	type MeshEdge,
	type MeshPatch,
	type RasterPoint,
	rasterizeMesh,
} from "@/shared/mesh-raster";
import type {
	EffectInfluenceFalloff,
	EffectMaskGradientStop,
	EffectMaskSource,
	EffectMaskSpace,
} from "@/shared/vec-core";
import type { EffectFieldRoutePlan } from "./effect-field-routing";
import type { FilterPrimitive } from "./effect-filter";
import type { Bounds } from "./types";

const FIELD_MESH_TARGET_PX = 512;
const TRANSFER_TABLE_SAMPLES = 33;
const CONTOUR_SHELL_SAMPLES = 12;

export type EffectFieldFilterLowering = {
	readonly primitives: readonly FilterPrimitive[];
	readonly output: string;
};

const finite = (value: number, fallback = 0): number =>
	Number.isFinite(value) ? value : fallback;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const coordX = (
	value: number,
	space: EffectMaskSpace,
	bounds: Bounds,
): number =>
	space === "scene" ? finite(value) : bounds.x + finite(value) * bounds.width;

const coordY = (
	value: number,
	space: EffectMaskSpace,
	bounds: Bounds,
): number =>
	space === "scene" ? finite(value) : bounds.y + finite(value) * bounds.height;

const lengthX = (
	value: number,
	space: EffectMaskSpace,
	bounds: Bounds,
): number => (space === "scene" ? finite(value) : finite(value) * bounds.width);

const lengthY = (
	value: number,
	space: EffectMaskSpace,
	bounds: Bounds,
): number =>
	space === "scene" ? finite(value) : finite(value) * bounds.height;

const escapeXml = (value: string): string =>
	value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");

const numberToken = (value: number): string =>
	String(Number(finite(value).toFixed(6)));

const rotationDegrees = (radians: number): number =>
	(finite(radians) * 180) / Math.PI;

const stopsMarkup = (stops: readonly EffectMaskGradientStop[]): string =>
	stops
		.map(
			(stop) =>
				`<stop offset="${numberToken(clamp01(stop.offset))}" stop-color="#fff" stop-opacity="${numberToken(clamp01(stop.alpha))}"/>`,
		)
		.join("");

const svgDataUrl = (bounds: Bounds, body: string, defs = ""): string => {
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="${numberToken(bounds.width)}" height="${numberToken(bounds.height)}" ` +
		`viewBox="${numberToken(bounds.x)} ${numberToken(bounds.y)} ${numberToken(bounds.width)} ${numberToken(bounds.height)}">` +
		(defs ? `<defs>${defs}</defs>` : "") +
		body +
		"</svg>";
	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};

const geometricSourceHref = (
	source: EffectMaskSource,
	bounds: Bounds,
): string | null => {
	switch (source.kind) {
		case "rect": {
			const x = coordX(source.x, source.space, bounds);
			const y = coordY(source.y, source.space, bounds);
			const width = lengthX(source.width, source.space, bounds);
			const height = lengthY(source.height, source.space, bounds);
			const radius =
				source.space === "scene"
					? source.cornerRadius
					: source.cornerRadius * Math.min(bounds.width, bounds.height);
			const transform = source.rotation
				? ` transform="rotate(${numberToken(rotationDegrees(source.rotation))} ${numberToken(x + width / 2)} ${numberToken(y + height / 2)})"`
				: "";
			return svgDataUrl(
				bounds,
				`<rect x="${numberToken(x)}" y="${numberToken(y)}" width="${numberToken(width)}" height="${numberToken(height)}" rx="${numberToken(radius)}" fill="#fff"${transform}/>`,
			);
		}
		case "ellipse": {
			const cx = coordX(source.cx, source.space, bounds);
			const cy = coordY(source.cy, source.space, bounds);
			const transform = source.rotation
				? ` transform="rotate(${numberToken(rotationDegrees(source.rotation))} ${numberToken(cx)} ${numberToken(cy)})"`
				: "";
			return svgDataUrl(
				bounds,
				`<ellipse cx="${numberToken(cx)}" cy="${numberToken(cy)}" rx="${numberToken(lengthX(source.rx, source.space, bounds))}" ry="${numberToken(lengthY(source.ry, source.space, bounds))}" fill="#fff"${transform}/>`,
			);
		}
		case "polygon":
			return svgDataUrl(
				bounds,
				`<polygon points="${escapeXml(
					source.points
						.map(
							(point) =>
								`${numberToken(coordX(point.x, source.space, bounds))},${numberToken(coordY(point.y, source.space, bounds))}`,
						)
						.join(" "),
				)}" fill="#fff"/>`,
			);
		case "linearGradient": {
			const defs = `<linearGradient id="f" gradientUnits="userSpaceOnUse" x1="${numberToken(coordX(source.x1, source.space, bounds))}" y1="${numberToken(coordY(source.y1, source.space, bounds))}" x2="${numberToken(coordX(source.x2, source.space, bounds))}" y2="${numberToken(coordY(source.y2, source.space, bounds))}">${stopsMarkup(source.stops)}</linearGradient>`;
			return svgDataUrl(
				bounds,
				`<rect x="${numberToken(bounds.x)}" y="${numberToken(bounds.y)}" width="${numberToken(bounds.width)}" height="${numberToken(bounds.height)}" fill="url(#f)"/>`,
				defs,
			);
		}
		case "radialGradient": {
			const cx = coordX(source.cx, source.space, bounds);
			const cy = coordY(source.cy, source.space, bounds);
			const rx = Math.max(lengthX(source.rx, source.space, bounds), 1e-6);
			const ry = Math.max(lengthY(source.ry, source.space, bounds), 1e-6);
			const defs = `<radialGradient id="f" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="translate(${numberToken(cx)} ${numberToken(cy)}) rotate(${numberToken(rotationDegrees(source.rotation))}) scale(${numberToken(rx)} ${numberToken(ry)})">${stopsMarkup(source.stops)}</radialGradient>`;
			return svgDataUrl(
				bounds,
				`<rect x="${numberToken(bounds.x)}" y="${numberToken(bounds.y)}" width="${numberToken(bounds.width)}" height="${numberToken(bounds.height)}" fill="url(#f)"/>`,
				defs,
			);
		}
		default:
			return null;
	}
};

const straightMeshEdge = (from: RasterPoint, to: RasterPoint): MeshEdge => [
	from,
	{
		x: from.x + (to.x - from.x) / 3,
		y: from.y + (to.y - from.y) / 3,
	},
	{
		x: from.x + ((to.x - from.x) * 2) / 3,
		y: from.y + ((to.y - from.y) * 2) / 3,
	},
	to,
];

const fieldMeshHref = (
	source: Extract<EffectMaskSource, { readonly kind: "fieldMesh" }>,
	bounds: Bounds,
): string | null => {
	if (bounds.width <= 0 || bounds.height <= 0) return null;
	const scene = scalarEffectFieldMeshScene(
		source.fieldMesh,
		bounds,
		(point) => point,
	);
	const corner = (row: number, col: number): MeshPatch["corners"][number] => {
		const point = scene.points.find(
			(candidate) => candidate.row === row && candidate.col === col,
		);
		return {
			point: point?.local ?? { x: bounds.x, y: bounds.y },
			color: "#ffffff",
			opacity: point?.value ?? 0,
		};
	};
	const patches: MeshPatch[] = [];
	for (let row = 0; row < source.fieldMesh.rows - 1; row += 1) {
		for (let col = 0; col < source.fieldMesh.cols - 1; col += 1) {
			const tl = corner(row, col);
			const tr = corner(row, col + 1);
			const br = corner(row + 1, col + 1);
			const bl = corner(row + 1, col);
			patches.push({
				edges: [
					straightMeshEdge(tl.point, tr.point),
					straightMeshEdge(tr.point, br.point),
					straightMeshEdge(br.point, bl.point),
					straightMeshEdge(bl.point, tl.point),
				],
				corners: [tl, tr, br, bl],
			});
		}
	}
	if (patches.length === 0) return null;
	const raster = rasterizeMesh({
		patches,
		bounds,
		deviceScale:
			FIELD_MESH_TARGET_PX / Math.max(bounds.width, bounds.height, 1),
		dither: false,
	});
	return encodePngDataUrl(raster.pixels, raster.width, raster.height);
};

const falloffValue = (
	value: number,
	falloff: EffectInfluenceFalloff,
): number => {
	const span = Math.max(falloff.inputMax - falloff.inputMin, 1e-6);
	const normalized = clamp01((value - falloff.inputMin) / span);
	switch (falloff.kind) {
		case "linear":
			return normalized;
		case "smoothstep":
			return normalized * normalized * (3 - 2 * normalized);
		case "gamma":
			return normalized ** falloff.gamma;
		case "threshold": {
			const width = Math.max(falloff.softness, 1e-6);
			return clamp01((normalized - (0.5 - width / 2)) / width);
		}
	}
};

const transferTable = (route: EffectFieldRoutePlan): readonly number[] =>
	Array.from({ length: TRANSFER_TABLE_SAMPLES }, (_, index) => {
		const source = index / (TRANSFER_TABLE_SAMPLES - 1);
		const fallen = falloffValue(source, route.influence.falloff);
		const directed = route.influence.invert ? 1 - fallen : fallen;
		return clamp01(directed * route.influence.strength);
	});

const contourPrimitives = (
	source: Extract<EffectMaskSource, { readonly kind: "contourGradient" }>,
	bounds: Bounds,
	result: string,
): readonly FilterPrimitive[] => {
	const radius =
		source.space === "scene"
			? source.width
			: source.width * Math.min(bounds.width, bounds.height);
	const sidePrimitives = (
		side: "inside" | "outside",
		prefix: string,
	): {
		readonly primitives: readonly FilterPrimitive[];
		readonly shells: readonly string[];
	} => {
		const primitives: FilterPrimitive[] = [];
		const shells: string[] = [];
		let previous = "SourceAlpha";
		for (let index = 0; index < CONTOUR_SHELL_SAMPLES; index += 1) {
			const expanded = `${prefix}-extent-${index}`;
			const band = `${prefix}-band-${index}`;
			const weighted = `${prefix}-weighted-${index}`;
			primitives.push({
				kind: "morphology",
				operator: side === "inside" ? "erode" : "dilate",
				radius: (radius * (index + 1)) / CONTOUR_SHELL_SAMPLES,
				in: "SourceAlpha",
				result: expanded,
			});
			primitives.push({
				kind: "composite",
				operator: "arithmetic",
				k2: 1,
				k3: -1,
				in: side === "inside" ? previous : expanded,
				in2: side === "inside" ? expanded : previous,
				result: band,
			});
			primitives.push({
				kind: "component-transfer",
				in: band,
				functions: {
					a: {
						type: "linear",
						slope: 1 - index / Math.max(CONTOUR_SHELL_SAMPLES - 1, 1),
						intercept: 0,
					},
				},
				result: weighted,
			});
			shells.push(weighted);
			previous = expanded;
		}
		return { primitives, shells };
	};
	const sides: readonly ("inside" | "outside")[] =
		source.side === "both" ? ["inside", "outside"] : [source.side];
	const lowered = sides.map((side) =>
		sidePrimitives(side, `${result}-${side}`),
	);
	return [
		...lowered.flatMap((entry) => entry.primitives),
		{
			kind: "merge",
			inputs: lowered.flatMap((entry) => entry.shells),
			result,
		},
	];
};

const stackSourcePrimitives = (
	route: EffectFieldRoutePlan,
	bounds: Bounds,
	result: string,
): readonly FilterPrimitive[] | null => {
	if (route.source.kind !== "stack") return null;
	const primitives: FilterPrimitive[] = [];
	const base = `${result}-base`;
	primitives.push({
		kind: "flood",
		floodColor: "#000000",
		floodOpacity: 0,
		result: base,
	});
	let accumulator = base;
	let activeIndex = 0;
	for (const item of route.source.items) {
		if (!item.enabled || item.strength <= 0) continue;
		const itemMatte = effectFieldMattePrimitives(
			{
				...route,
				source: item.source,
				influence: item,
			},
			bounds,
			`${result}-item-${activeIndex}`,
		);
		if (!itemMatte) return null;
		primitives.push(...itemMatte.primitives);
		if (item.combineMode === "replace") {
			accumulator = itemMatte.output;
			activeIndex += 1;
			continue;
		}
		const combined = `${result}-combined-${activeIndex}`;
		if (item.combineMode === "add") {
			primitives.push({
				kind: "composite",
				operator: "arithmetic",
				k2: 1,
				k3: 1,
				in: accumulator,
				in2: itemMatte.output,
				result: combined,
			});
		} else {
			primitives.push({
				kind: "composite",
				operator:
					item.combineMode === "intersect"
						? "in"
						: item.combineMode === "subtract"
							? "out"
							: "xor",
				in: accumulator,
				in2: itemMatte.output,
				result: combined,
			});
		}
		accumulator = combined;
		activeIndex += 1;
	}
	primitives.push({
		kind: "composite",
		operator: "over",
		in: accumulator,
		in2: base,
		result,
	});
	return primitives;
};

/** Lowers a supported Effect Field source to one normalized alpha matte. */
export function effectFieldMattePrimitives(
	route: EffectFieldRoutePlan,
	bounds: Bounds,
	resultPrefix: string,
): EffectFieldFilterLowering | null {
	if (
		route.fidelity.status === "unsupported" ||
		route.fidelity.status === "deferred" ||
		route.fidelity.status === "side-car-only"
	) {
		return null;
	}
	const raw = `${resultPrefix}-raw`;
	const feathered = `${resultPrefix}-feathered`;
	const output = `${resultPrefix}-matte`;
	const primitives: FilterPrimitive[] = [];
	const { source } = route;
	if (source.kind === "fullFrame") {
		primitives.push({
			kind: "flood",
			floodColor: "#ffffff",
			floodOpacity: 1,
			result: raw,
		});
	} else if (source.kind === "contourGradient") {
		primitives.push(...contourPrimitives(source, bounds, raw));
	} else if (source.kind === "fieldMesh") {
		const href = fieldMeshHref(source, bounds);
		if (!href) return null;
		primitives.push({
			kind: "image",
			href,
			x: String(bounds.x),
			y: String(bounds.y),
			width: String(bounds.width),
			height: String(bounds.height),
			preserveAspectRatio: "none",
			result: raw,
		});
	} else if (source.kind === "proceduralNoise") {
		primitives.push(
			{
				kind: "turbulence",
				type: "fractalNoise",
				baseFrequency: 1 / Math.max(source.scale, 0.001),
				numOctaves: 3,
				seed: source.seed,
				result: `${raw}-noise`,
			},
			{
				kind: "color-matrix",
				matrixType: "matrix",
				values: [
					0,
					0,
					0,
					0,
					0,
					0,
					0,
					0,
					0,
					0,
					0,
					0,
					0,
					0,
					0,
					0.2126 * source.contrast,
					0.7152 * source.contrast,
					0.0722 * source.contrast,
					0,
					source.bias,
				],
				in: `${raw}-noise`,
				result: raw,
			},
		);
	} else if (source.kind === "stack") {
		const stack = stackSourcePrimitives(route, bounds, raw);
		if (!stack) return null;
		primitives.push(...stack);
	} else {
		const href = geometricSourceHref(source, bounds);
		if (!href) return null;
		primitives.push({
			kind: "image",
			href,
			x: String(bounds.x),
			y: String(bounds.y),
			width: String(bounds.width),
			height: String(bounds.height),
			preserveAspectRatio: "none",
			result: raw,
		});
	}
	const featherPx =
		route.influence.featherRadius * Math.min(bounds.width, bounds.height);
	if (featherPx > 0) {
		primitives.push({
			kind: "gaussian-blur",
			in: raw,
			stdDeviation: featherPx,
			result: feathered,
		});
	}
	primitives.push({
		kind: "component-transfer",
		in: featherPx > 0 ? feathered : raw,
		functions: {
			a: { type: "table", tableValues: transferTable(route) },
		},
		result: output,
	});
	return { primitives, output };
}

/** Applies one normalized field as a terminal alpha/reveal multiplier. */
export function effectFieldAlphaMultiplyPrimitives(
	route: EffectFieldRoutePlan,
	bounds: Bounds,
	input: string,
	result: string,
): EffectFieldFilterLowering | null {
	const matte = effectFieldMattePrimitives(route, bounds, `${result}-field`);
	if (!matte) return null;
	return {
		primitives: [
			...matte.primitives,
			{
				kind: "composite",
				operator: "in",
				in: input,
				in2: matte.output,
				result,
			},
		],
		output: result,
	};
}

/** Mixes dry and already-effected branches using one normalized field matte. */
export function effectFieldWetMixPrimitives(
	route: EffectFieldRoutePlan,
	bounds: Bounds,
	dryInput: string,
	wetInput: string,
	result: string,
): EffectFieldFilterLowering | null {
	const matte = effectFieldMattePrimitives(route, bounds, `${result}-field`);
	if (!matte) return null;
	const inverse = `${result}-inverse`;
	const dry = `${result}-dry`;
	const wet = `${result}-wet`;
	return {
		primitives: [
			...matte.primitives,
			{
				kind: "component-transfer",
				in: matte.output,
				functions: { a: { type: "linear", slope: -1, intercept: 1 } },
				result: inverse,
			},
			{
				kind: "composite",
				operator: "in",
				in: dryInput,
				in2: inverse,
				result: dry,
			},
			{
				kind: "composite",
				operator: "in",
				in: wetInput,
				in2: matte.output,
				result: wet,
			},
			{ kind: "merge", inputs: [dry, wet], result },
		],
		output: result,
	};
}
