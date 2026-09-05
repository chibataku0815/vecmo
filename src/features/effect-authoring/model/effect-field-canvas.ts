import {
	applyMatrixToPoint,
	getNodeLocalBounds,
	invertMatrix,
	type Matrix2D,
	matrixFromTransform,
} from "@/entities/scene/model/rendering";
import {
	findNode,
	isTopLevelSceneNode,
} from "@/entities/scene/model/selectors";
import type {
	Bounds,
	SceneDocument,
	Vec2,
	VectorNode,
} from "@/entities/scene/model/types";
import {
	type ScalarEffectFieldMeshScene,
	scalarEffectFieldMeshScene,
} from "@/shared/effect-field";
import type {
	EffectMaskContourGradientSource,
	EffectMaskFieldMeshSource,
	EffectMaskLinearGradientSource,
	EffectMaskRadialGradientSource,
	EffectMaskRectSource,
} from "@/shared/vec-core";
import { nodeEffectFieldEditingState } from "./effect-field-authoring";

/** Artboard-space direct controls for a normalized Linear field. */
export type EffectFieldLinearCanvasGeometry = {
	readonly source: EffectMaskLinearGradientSource;
	readonly from: Vec2;
	readonly to: Vec2;
	readonly center: Vec2;
};

/** Artboard-space width handle for a shape-following Contour field. */
export type EffectFieldContourCanvasGeometry = {
	readonly source: EffectMaskContourGradientSource;
	readonly handle: Vec2;
};

export type EffectFieldRadialCanvasGeometry = {
	readonly source: EffectMaskRadialGradientSource;
	readonly center: Vec2;
	readonly radiusXHandle: Vec2;
	readonly radiusYHandle: Vec2;
	readonly contour: readonly Vec2[];
};

export type EffectFieldRectCanvasGeometry = {
	readonly source: EffectMaskRectSource;
	readonly center: Vec2;
	readonly widthHandle: Vec2;
	readonly heightHandle: Vec2;
	readonly contour: readonly Vec2[];
};

/** Stable scene-derived geometry consumed by both handler and overlay. */
export type EffectFieldCanvasState = {
	readonly node: VectorNode;
	readonly descriptorId: string;
	readonly fieldId: string;
	readonly bounds: Bounds;
	readonly matrix: Matrix2D;
	readonly inverseMatrix: Matrix2D;
	readonly source:
		| EffectMaskLinearGradientSource
		| EffectMaskRadialGradientSource
		| EffectMaskRectSource
		| EffectMaskContourGradientSource
		| EffectMaskFieldMeshSource;
	readonly linear: EffectFieldLinearCanvasGeometry | null;
	readonly radial: EffectFieldRadialCanvasGeometry | null;
	readonly rect: EffectFieldRectCanvasGeometry | null;
	readonly contour: EffectFieldContourCanvasGeometry | null;
	readonly mesh: ScalarEffectFieldMeshScene | null;
};

const localPoint = (
	bounds: Bounds,
	point: { readonly x: number; readonly y: number },
): Vec2 => ({
	x: bounds.x + point.x * bounds.width,
	y: bounds.y + point.y * bounds.height,
});

const rotatedLocalPoint = (
	center: Vec2,
	offset: Vec2,
	rotation: number,
): Vec2 => ({
	x: center.x + offset.x * Math.cos(rotation) - offset.y * Math.sin(rotation),
	y: center.y + offset.x * Math.sin(rotation) + offset.y * Math.cos(rotation),
});

/**
 * Resolves direct canvas geometry only for top-level object-bounds fields. A
 * nested node stays numerically editable rather than receiving incorrect parent
 * transforms from a guessed coordinate chain.
 */
export function effectFieldCanvasState(
	document: SceneDocument,
	nodeId: string,
	descriptorId: string,
): EffectFieldCanvasState | null {
	const node = findNode(document, nodeId);
	if (!node || node.locked || !isTopLevelSceneNode(document, nodeId))
		return null;
	const editing = nodeEffectFieldEditingState(document, nodeId, descriptorId);
	const source = editing.source;
	if (
		!editing.assignment ||
		!source ||
		(source.kind !== "linearGradient" &&
			source.kind !== "radialGradient" &&
			source.kind !== "rect" &&
			source.kind !== "contourGradient" &&
			source.kind !== "fieldMesh") ||
		(source.space !== "target" && source.space !== "objectBoundingBox")
	) {
		return null;
	}
	const matrix = matrixFromTransform(node.transform);
	const inverseMatrix = invertMatrix(matrix);
	if (!inverseMatrix) return null;
	const bounds = getNodeLocalBounds(node);
	const toArtboard = (point: Vec2): Vec2 => applyMatrixToPoint(matrix, point);
	const linear =
		source.kind === "linearGradient"
			? (() => {
					const from = toArtboard(
						localPoint(bounds, { x: source.x1, y: source.y1 }),
					);
					const to = toArtboard(
						localPoint(bounds, { x: source.x2, y: source.y2 }),
					);
					return {
						source,
						from,
						to,
						center: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
					};
				})()
			: null;
	const radial =
		source.kind === "radialGradient"
			? (() => {
					const centerLocal = localPoint(bounds, {
						x: source.cx,
						y: source.cy,
					});
					const pointAt = (angle: number): Vec2 =>
						toArtboard(
							rotatedLocalPoint(
								centerLocal,
								{
									x: Math.cos(angle) * source.rx * bounds.width,
									y: Math.sin(angle) * source.ry * bounds.height,
								},
								source.rotation,
							),
						);
					return {
						source,
						center: toArtboard(centerLocal),
						radiusXHandle: pointAt(0),
						radiusYHandle: pointAt(Math.PI / 2),
						contour: Array.from({ length: 49 }, (_, index) =>
							pointAt((index / 48) * Math.PI * 2),
						),
					};
				})()
			: null;
	const rect =
		source.kind === "rect"
			? (() => {
					const centerNormalized = {
						x: source.x + source.width / 2,
						y: source.y + source.height / 2,
					};
					const centerLocal = localPoint(bounds, centerNormalized);
					const pointAt = (x: number, y: number): Vec2 =>
						toArtboard(
							rotatedLocalPoint(
								centerLocal,
								{ x: x * bounds.width, y: y * bounds.height },
								source.rotation,
							),
						);
					const halfWidth = source.width / 2;
					const halfHeight = source.height / 2;
					return {
						source,
						center: toArtboard(centerLocal),
						widthHandle: pointAt(halfWidth, 0),
						heightHandle: pointAt(0, halfHeight),
						contour: [
							pointAt(-halfWidth, -halfHeight),
							pointAt(halfWidth, -halfHeight),
							pointAt(halfWidth, halfHeight),
							pointAt(-halfWidth, halfHeight),
							pointAt(-halfWidth, -halfHeight),
						],
					};
				})()
			: null;
	const contour =
		source.kind === "contourGradient"
			? {
					source,
					handle: toArtboard({
						x:
							bounds.x +
							bounds.width +
							source.width * Math.min(bounds.width, bounds.height),
						y: bounds.y + bounds.height / 2,
					}),
				}
			: null;
	const mesh =
		source.kind === "fieldMesh"
			? scalarEffectFieldMeshScene(source.fieldMesh, bounds, toArtboard)
			: null;
	return {
		node,
		descriptorId,
		fieldId:
			editing.field?.id ?? editing.assignment.fieldId ?? editing.assignment.id,
		bounds,
		matrix,
		inverseMatrix,
		source,
		linear,
		radial,
		rect,
		contour,
		mesh,
	};
}

/** Converts an artboard pointer into normalized object-bounds coordinates. */
export function effectFieldNormalizedPoint(
	state: EffectFieldCanvasState,
	point: Vec2,
): Vec2 | null {
	const local = applyMatrixToPoint(state.inverseMatrix, point);
	if (state.bounds.width <= 1e-6 || state.bounds.height <= 1e-6) return null;
	return {
		x: Math.min(
			1,
			Math.max(0, (local.x - state.bounds.x) / state.bounds.width),
		),
		y: Math.min(
			1,
			Math.max(0, (local.y - state.bounds.y) / state.bounds.height),
		),
	};
}

/** Converts an artboard pointer into node-local coordinates. */
export function effectFieldLocalPoint(
	state: EffectFieldCanvasState,
	point: Vec2,
): Vec2 {
	return applyMatrixToPoint(state.inverseMatrix, point);
}
