// Vendored from motion-grammar-lab/packages/motion-grammar/src/ae-shape-svg-path.ts.
// Keep this module standalone: no DOM, renderer, React, or Worker runtime imports.

import type { AePoint, AePoint3, AeShape } from "./ae-shape";

export type AePathPlacementTransform = {
	position: AePoint3;
	anchorPoint: AePoint3;
};

const add = (point: AePoint, tangent: AePoint): AePoint => [
	point[0] + tangent[0],
	point[1] + tangent[1],
];

export const offsetFromAeTransform = (
	transform: AePathPlacementTransform,
): AePoint => [
	transform.position[0] - transform.anchorPoint[0],
	transform.position[1] - transform.anchorPoint[1],
];

export const offsetAeShape = (shape: AeShape, offset: AePoint): AeShape => ({
	...shape,
	vertices: shape.vertices.map((point) => [
		point[0] + offset[0],
		point[1] + offset[1],
	]),
});

export const reverseAeShape = (shape: AeShape): AeShape => {
	const indices = shape.vertices.map((_, index) => index);
	const reversed = [indices[0], ...indices.slice(1).reverse()];

	return {
		...shape,
		vertices: reversed.map((index) => shape.vertices[index]),
		inTangents: reversed.map((index) => shape.outTangents[index]),
		outTangents: reversed.map((index) => shape.inTangents[index]),
	};
};

export const aeShapeToSvgPath = (shape: AeShape): string => {
	if (shape.vertices.length === 0) return "";
	const commands = [`M ${shape.vertices[0][0]} ${shape.vertices[0][1]}`];
	const segmentCount = shape.closed
		? shape.vertices.length
		: shape.vertices.length - 1;

	for (let index = 0; index < segmentCount; index += 1) {
		const nextIndex = (index + 1) % shape.vertices.length;
		const point = shape.vertices[index];
		const nextPoint = shape.vertices[nextIndex];
		const c1 = add(point, shape.outTangents[index]);
		const c2 = add(nextPoint, shape.inTangents[nextIndex]);
		commands.push(
			`C ${c1[0]} ${c1[1]} ${c2[0]} ${c2[1]} ${nextPoint[0]} ${nextPoint[1]}`,
		);
	}

	if (shape.closed) commands.push("Z");
	return commands.join(" ");
};

export const placedAeShapeForSvgPath = (
	shape: AeShape,
	transform: AePathPlacementTransform,
	reverse: boolean,
): AeShape => {
	const placed = offsetAeShape(shape, offsetFromAeTransform(transform));
	return reverse ? reverseAeShape(placed) : placed;
};
