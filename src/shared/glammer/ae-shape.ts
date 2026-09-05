// Vendored from motion-grammar-lab/packages/motion-grammar/src/ae-shape.ts.
// Keep this module standalone: no DOM, renderer, React, or Worker runtime imports.

export type AePoint = [number, number];
export type AePoint3 = [number, number, number];

export type AeShape = {
	type: "Shape";
	closed: boolean;
	vertices: AePoint[];
	inTangents: AePoint[];
	outTangents: AePoint[];
};

export type AeCompSpace = {
	width: number;
	height: number;
};

export type AeShapeBounds = {
	minX: number;
	maxX: number;
	minY: number;
	maxY: number;
	center: AePoint;
	width: number;
	height: number;
};

export type AePathSample = {
	point: AePoint;
	tangent: AePoint;
	angleDegrees: number;
	segment: number;
	segmentT: number;
};

type ArcSample = {
	length: number;
	segment: number;
	t: number;
	point: AePoint;
};

export const isAeShape = (value: unknown): value is AeShape => {
	if (!value || typeof value !== "object") return false;
	const shape = value as Partial<AeShape>;
	return (
		shape.type === "Shape" &&
		Array.isArray(shape.vertices) &&
		Array.isArray(shape.inTangents) &&
		Array.isArray(shape.outTangents)
	);
};

export const aeShapeTopologyKey = (shape: AeShape): string =>
	[
		shape.vertices.length,
		shape.inTangents.length,
		shape.outTangents.length,
	].join(":");

export const aeShapeToFields = (shape: AeShape): Record<string, number> => {
	const fields: Record<string, number> = {};

	const writePoint = (
		prefix: string,
		point: readonly number[],
		index: number,
	) => {
		fields[`${prefix}${index}x`] = point[0] ?? 0;
		fields[`${prefix}${index}y`] = point[1] ?? 0;
	};

	shape.vertices.forEach((point, index) => {
		writePoint("v", point, index);
	});
	shape.inTangents.forEach((point, index) => {
		writePoint("i", point, index);
	});
	shape.outTangents.forEach((point, index) => {
		writePoint("o", point, index);
	});
	return fields;
};

export const fieldsToAeShape = (
	fields: Record<string, number>,
	template: AeShape,
): AeShape => {
	const readPoint = (prefix: string, index: number): AePoint => [
		fields[`${prefix}${index}x`] ?? 0,
		fields[`${prefix}${index}y`] ?? 0,
	];

	return {
		type: "Shape",
		closed: template.closed,
		vertices: template.vertices.map((_, index) => readPoint("v", index)),
		inTangents: template.inTangents.map((_, index) => readPoint("i", index)),
		outTangents: template.outTangents.map((_, index) => readPoint("o", index)),
	};
};

export const haveSameAeShapeTopology = (
	shapes: readonly AeShape[],
): boolean => {
	if (shapes.length === 0) return true;
	const topology = aeShapeTopologyKey(shapes[0]);
	return shapes.every((shape) => aeShapeTopologyKey(shape) === topology);
};

const addPoint = (a: AePoint, b: AePoint): AePoint => [
	a[0] + b[0],
	a[1] + b[1],
];

const cubicPoint = (
	p0: AePoint,
	p1: AePoint,
	p2: AePoint,
	p3: AePoint,
	t: number,
): AePoint => {
	const mt = 1 - t;
	const mt2 = mt * mt;
	const t2 = t * t;
	return [
		mt2 * mt * p0[0] +
			3 * mt2 * t * p1[0] +
			3 * mt * t2 * p2[0] +
			t2 * t * p3[0],
		mt2 * mt * p0[1] +
			3 * mt2 * t * p1[1] +
			3 * mt * t2 * p2[1] +
			t2 * t * p3[1],
	];
};

const cubicTangent = (
	p0: AePoint,
	p1: AePoint,
	p2: AePoint,
	p3: AePoint,
	t: number,
): AePoint => {
	const mt = 1 - t;
	return [
		3 * mt * mt * (p1[0] - p0[0]) +
			6 * mt * t * (p2[0] - p1[0]) +
			3 * t * t * (p3[0] - p2[0]),
		3 * mt * mt * (p1[1] - p0[1]) +
			6 * mt * t * (p2[1] - p1[1]) +
			3 * t * t * (p3[1] - p2[1]),
	];
};

const distance = (a: AePoint, b: AePoint): number => {
	const dx = a[0] - b[0];
	const dy = a[1] - b[1];
	return Math.sqrt(dx * dx + dy * dy);
};

const normalize = ([x, y]: AePoint): AePoint => {
	const length = Math.sqrt(x * x + y * y);
	return length > 0.000001 ? [x / length, y / length] : [1, 0];
};

const buildArcSamples = (
	shape: AeShape,
	stepsPerSegment: number,
): ArcSample[] => {
	const samples: ArcSample[] = [];
	const segmentCount = shape.closed
		? shape.vertices.length
		: shape.vertices.length - 1;
	let length = 0;
	let previous: AePoint | undefined;

	for (let segment = 0; segment < segmentCount; segment++) {
		const next = (segment + 1) % shape.vertices.length;
		const p0 = shape.vertices[segment];
		const p1 = addPoint(p0, shape.outTangents[segment]);
		const p3 = shape.vertices[next];
		const p2 = addPoint(p3, shape.inTangents[next]);

		for (let step = 0; step <= stepsPerSegment; step++) {
			if (segment > 0 && step === 0) continue;
			const t = step / stepsPerSegment;
			const point = cubicPoint(p0, p1, p2, p3, t);
			if (previous) length += distance(previous, point);
			samples.push({ length, segment, t, point });
			previous = point;
		}
	}

	return samples;
};

export const boundsFromAeShape = (shape: AeShape): AeShapeBounds => {
	const xs = shape.vertices.map(([x]) => x);
	const ys = shape.vertices.map(([, y]) => y);
	const minX = Math.min(...xs);
	const maxX = Math.max(...xs);
	const minY = Math.min(...ys);
	const maxY = Math.max(...ys);
	const width = maxX - minX;
	const height = maxY - minY;
	return {
		minX,
		maxX,
		minY,
		maxY,
		center: [minX + width / 2, minY + height / 2],
		width,
		height,
	};
};

export const radiusFromAeShape = (shape: AeShape): number => {
	const bounds = boundsFromAeShape(shape);
	return Math.max(bounds.width, bounds.height) / 2;
};

export const aeCompPointToWorld = (
	[x, y, z = 0]: readonly number[],
	comp: AeCompSpace,
): AePoint3 => [x - comp.width / 2, comp.height / 2 - y, z];

export const sampleAeShapePath = (
	shape: AeShape,
	percent: number,
	options?: {
		stepsPerSegment?: number;
	},
): AePathSample => {
	const samples = buildArcSamples(shape, options?.stepsPerSegment ?? 400);
	const totalLength = samples[samples.length - 1]?.length ?? 1;
	const target = Math.max(0, Math.min(1, percent)) * totalLength;
	let chosen = samples[samples.length - 1];
	for (const sample of samples) {
		if (sample.length >= target) {
			chosen = sample;
			break;
		}
	}

	const next = (chosen.segment + 1) % shape.vertices.length;
	const p0 = shape.vertices[chosen.segment];
	const p1 = addPoint(p0, shape.outTangents[chosen.segment]);
	const p3 = shape.vertices[next];
	const p2 = addPoint(p3, shape.inTangents[next]);
	const tangent = normalize(cubicTangent(p0, p1, p2, p3, chosen.t));
	const angle = Math.atan2(tangent[1], tangent[0]) * (180 / Math.PI);

	return {
		point: chosen.point,
		tangent,
		angleDegrees: (angle < 0 ? angle + 360 : angle) % 360,
		segment: chosen.segment,
		segmentT: chosen.t,
	};
};

/**
 * Total arc length of a shape's flattened outline, in the shape's own units. Uses
 * the same flattening resolution as {@link sampleAeShapePath}, so a dash array
 * sized from this covers the same path the renderer strokes (round up when using
 * it as a full-length dash so frame 0 fully hides the stroke).
 */
export const aeShapeArcLength = (
	shape: AeShape,
	stepsPerSegment = 400,
): number => {
	const samples = buildArcSamples(shape, stepsPerSegment);
	return samples[samples.length - 1]?.length ?? 0;
};
