import type { BezierShape } from "@/entities/scene/model/types";

type SubpathBox = {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
};

const subpathBox = (shape: BezierShape): SubpathBox => {
	const xs = shape.vertices.map(([x]) => x);
	const ys = shape.vertices.map(([, y]) => y);
	return {
		minX: Math.min(...xs),
		minY: Math.min(...ys),
		maxX: Math.max(...xs),
		maxY: Math.max(...ys),
	};
};

const boxArea = (box: SubpathBox): number =>
	(box.maxX - box.minX) * (box.maxY - box.minY);

/**
 * Strict bounding-box containment: `outer` encloses `inner` on every side and is
 * strictly larger by area, so two identical boxes never report mutual
 * containment.
 */
const strictlyContains = (outer: SubpathBox, inner: SubpathBox): boolean =>
	outer.minX <= inner.minX &&
	outer.minY <= inner.minY &&
	outer.maxX >= inner.maxX &&
	outer.maxY >= inner.maxY &&
	boxArea(outer) > boxArea(inner);

/**
 * Returns the index pairing of subpaths that form holes: each entry is an inner
 * subpath whose bounding box is strictly inside an outer subpath's box — the
 * structural signature of nested compound paths (donut, letter counter, window
 * cutout).
 *
 * Disjoint subpaths (e.g. an Apple-logo body + detached leaf) are not nested, so
 * the returned set is empty for them; splitting such pieces into separate
 * editable paths renders identically and is not a fidelity loss. Hole topology,
 * not subpath count, is the discriminator.
 */
export const nestedSubpathIndices = (
	shapes: readonly BezierShape[],
): ReadonlySet<number> => {
	const nested = new Set<number>();
	if (shapes.length < 2) return nested;
	const boxes = shapes.map(subpathBox);
	boxes.forEach((inner, innerIndex) => {
		const isHole = boxes.some(
			(outer, outerIndex) =>
				innerIndex !== outerIndex && strictlyContains(outer, inner),
		);
		if (isHole) nested.add(innerIndex);
	});
	return nested;
};

/**
 * Detects whether a multi-subpath SVG path encodes a hole rather than disjoint
 * pieces. Convenience predicate over {@link nestedSubpathIndices}.
 */
export const compoundShapesHaveHole = (
	shapes: readonly BezierShape[],
): boolean => nestedSubpathIndices(shapes).size > 0;
