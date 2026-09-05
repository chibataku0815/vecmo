import type { BezierShape } from "@/entities/scene/model/types";
import type { AeKeyframe } from "@/shared/glammer/keyframe-track";
import { isValidPathShape } from "./keyframe-validation";
import type { KeyframeTrack } from "./types";

type Point = [number, number];
type MutableBezierShape = {
	type: "Shape";
	closed: boolean;
	vertices: Point[];
	inTangents: Point[];
	outTangents: Point[];
};

export type MorphTopologyIssueCode =
	| "morph-track-not-path-shape"
	| "morph-key-invalid"
	| "morph-closed-state-mismatch"
	| "morph-vertex-count-insufficient"
	| "morph-open-first-vertex-unsupported";

export type MorphTopologyIssue = {
	readonly code: MorphTopologyIssueCode;
	readonly severity: "error" | "warning";
	readonly trackId: string;
	readonly frame?: number;
	readonly message: string;
};

export type MorphTopologyInspection = {
	readonly compatible: boolean;
	readonly vertexCounts: readonly number[];
	readonly closedStates: readonly boolean[];
	readonly targetVertexCount: number;
	readonly issues: readonly MorphTopologyIssue[];
};

const add = (left: Point, right: Point): Point => [
	left[0] + right[0],
	left[1] + right[1],
];
const subtract = (left: Point, right: Point): Point => [
	left[0] - right[0],
	left[1] - right[1],
];
const midpoint = (left: Point, right: Point): Point => [
	(left[0] + right[0]) / 2,
	(left[1] + right[1]) / 2,
];
const distanceSquared = (left: Point, right: Point): number =>
	(left[0] - right[0]) ** 2 + (left[1] - right[1]) ** 2;

const cloneShape = (shape: BezierShape): MutableBezierShape => ({
	type: "Shape",
	closed: shape.closed,
	vertices: shape.vertices.map((point) => [...point] as Point),
	inTangents: shape.inTangents.map((point) => [...point] as Point),
	outTangents: shape.outTangents.map((point) => [...point] as Point),
});

const pathKeys = (track: KeyframeTrack): AeKeyframe<BezierShape>[] =>
	track.keyframes.filter(
		(keyframe): keyframe is AeKeyframe<BezierShape> =>
			Number.isFinite(keyframe.time) && isValidPathShape(keyframe.value),
	);

/** Inspects the interpolation topology carried by one pathShape track. */
export function inspectMorphTopology(
	track: KeyframeTrack,
): MorphTopologyInspection {
	const issues: MorphTopologyIssue[] = [];
	if (track.target.property !== "pathShape") {
		issues.push({
			code: "morph-track-not-path-shape",
			severity: "error",
			trackId: track.id,
			message: "Morph topology commands require a pathShape track.",
		});
	}
	const keys = pathKeys(track);
	if (keys.length !== track.keyframes.length) {
		issues.push({
			code: "morph-key-invalid",
			severity: "error",
			trackId: track.id,
			message: "Every morph key must contain finite aligned path arrays.",
		});
	}
	const vertexCounts = keys.map((key) => key.value.vertices.length);
	const closedStates = keys.map((key) => key.value.closed);
	if (vertexCounts.some((count) => count < 2)) {
		issues.push({
			code: "morph-vertex-count-insufficient",
			severity: "error",
			trackId: track.id,
			message: "Every morph key requires at least two vertices.",
		});
	}
	if (new Set(closedStates).size > 1) {
		issues.push({
			code: "morph-closed-state-mismatch",
			severity: "error",
			trackId: track.id,
			message: "Open and closed path keys cannot be interpolated as one morph.",
		});
	}
	return {
		compatible:
			issues.length === 0 && new Set(vertexCounts).size <= 1 && keys.length > 0,
		vertexCounts,
		closedStates,
		targetVertexCount: Math.max(0, ...vertexCounts),
		issues,
	};
}

const longestSegmentIndex = (shape: BezierShape): number => {
	const segmentCount = shape.closed
		? shape.vertices.length
		: Math.max(0, shape.vertices.length - 1);
	let bestIndex = 0;
	let bestLength = -1;
	for (let index = 0; index < segmentCount; index += 1) {
		const next = (index + 1) % shape.vertices.length;
		const length = distanceSquared(shape.vertices[index], shape.vertices[next]);
		if (length > bestLength) {
			bestLength = length;
			bestIndex = index;
		}
	}
	return bestIndex;
};

/** Splits one cubic segment at t=.5 without changing its curve. */
export function splitMorphSegment(
	shape: BezierShape,
	segmentIndex: number,
): BezierShape {
	const result = cloneShape(shape);
	const count = result.vertices.length;
	if (count < 2) return result;
	const startIndex = Math.max(0, Math.min(count - 1, segmentIndex));
	const endIndex = (startIndex + 1) % count;
	if (!result.closed && startIndex >= count - 1) return result;
	const p0 = result.vertices[startIndex];
	const p1 = add(p0, result.outTangents[startIndex]);
	const p3 = result.vertices[endIndex];
	const p2 = add(p3, result.inTangents[endIndex]);
	const q0 = midpoint(p0, p1);
	const q1 = midpoint(p1, p2);
	const q2 = midpoint(p2, p3);
	const r0 = midpoint(q0, q1);
	const r1 = midpoint(q1, q2);
	const split = midpoint(r0, r1);
	result.outTangents[startIndex] = subtract(q0, p0);
	result.inTangents[endIndex] = subtract(q2, p3);
	result.vertices.splice(endIndex, 0, split);
	result.inTangents.splice(endIndex, 0, subtract(r0, split));
	result.outTangents.splice(endIndex, 0, subtract(r1, split));
	return result;
}

/** Adds exact cubic split points until the requested topology count is reached. */
export function repairMorphShapeVertexCount(
	shape: BezierShape,
	targetVertexCount: number,
): BezierShape {
	let result = cloneShape(shape);
	if (result.vertices.length < 2) return result;
	const target = Math.max(
		result.vertices.length,
		Math.round(targetVertexCount),
	);
	while (result.vertices.length < target) {
		result = splitMorphSegment(result, longestSegmentIndex(result));
	}
	return result;
}

/** Rotates a closed shape's index-zero seam without changing its pixels. */
export function rotateMorphFirstVertex(
	shape: BezierShape,
	firstVertexIndex: number,
): BezierShape | null {
	if (!shape.closed || shape.vertices.length === 0) return null;
	const offset =
		((Math.round(firstVertexIndex) % shape.vertices.length) +
			shape.vertices.length) %
		shape.vertices.length;
	const rotate = <T>(values: readonly T[]): T[] => [
		...values.slice(offset),
		...values.slice(0, offset),
	];
	return {
		type: "Shape",
		closed: true,
		vertices: rotate(shape.vertices),
		inTangents: rotate(shape.inTangents),
		outTangents: rotate(shape.outTangents),
	};
}

/** Reverses winding while preserving each cubic segment's geometry. */
export function reverseMorphWinding(shape: BezierShape): BezierShape {
	return {
		type: "Shape",
		closed: shape.closed,
		vertices: [...shape.vertices].reverse(),
		inTangents: [...shape.outTangents].reverse(),
		outTangents: [...shape.inTangents].reverse(),
	};
}
