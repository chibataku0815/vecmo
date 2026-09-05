import { useMotionStore } from "@/entities/motion/model/store";
import { currentMotionGrammarTargetNodeIds } from "@/entities/motion-grammar/model/store";
import { createUpdateNodeTransformCommand } from "@/entities/scene/model/node-commands";
import {
	getGeometryBounds,
	type Matrix2D,
	matrixFromTransform,
} from "@/entities/scene/model/rendering";
import {
	findNode,
	isNodeTransformable,
} from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import type {
	SceneDocument,
	Vec2,
	VectorNode,
} from "@/entities/scene/model/types";
import { invert, multiply } from "./matrix";
import { recordMatrixDeltasRepeatTransform } from "./repeat-transform";

export type FlipAxis = "horizontal" | "vertical";

export type FlipEdit = {
	readonly nodeId: string;
	readonly matrix: Matrix2D;
};

let flipSequence = 0;

/** Negates while folding -0 to 0 so reflected matrices compare and serialize cleanly. */
const reflect = (value: number): number => (value === 0 ? 0 : -value);

const transformPoint = (matrix: Matrix2D, point: Vec2): Vec2 => ({
	x: matrix.a * point.x + matrix.c * point.y + matrix.e,
	y: matrix.b * point.x + matrix.d * point.y + matrix.f,
});

/**
 * Returns the four artboard-space corners of a node after its transform is
 * applied. The math mirrors `arrange`'s transformedNodeBounds but is replicated
 * here from entity primitives so flip never imports a sibling feature.
 */
const transformedCorners = (node: VectorNode): readonly Vec2[] => {
	const bounds = getGeometryBounds(node.geometry);
	const matrix = matrixFromTransform(node.transform);
	return [
		{ x: bounds.x, y: bounds.y },
		{ x: bounds.x + bounds.width, y: bounds.y },
		{ x: bounds.x + bounds.width, y: bounds.y + bounds.height },
		{ x: bounds.x, y: bounds.y + bounds.height },
	].map((corner) => transformPoint(matrix, corner));
};

/**
 * Reflects a node matrix across the selection pivot line. Composing the mirror
 * on the outside (`mirror · M`) flips the rendered geometry while pinning the
 * pivot, so a multi-selection mirrors as a group. The negative determinant is
 * intentional: anchors are (0,0) in this model, so the flipped matrix round-trips
 * through `transformFromMatrix` (it lands as a 180° rotation + one negative
 * scale, which renders identically to the reflection).
 */
export function flipMatrix(
	axis: FlipAxis,
	pivot: number,
	matrix: Matrix2D,
): Matrix2D {
	if (axis === "horizontal") {
		return {
			a: reflect(matrix.a),
			b: matrix.b,
			c: reflect(matrix.c),
			d: matrix.d,
			e: 2 * pivot - matrix.e,
			f: matrix.f,
		};
	}
	return {
		a: matrix.a,
		b: reflect(matrix.b),
		c: matrix.c,
		d: reflect(matrix.d),
		e: matrix.e,
		f: 2 * pivot - matrix.f,
	};
}

/**
 * Computes flip matrices for every transformable selected node around the shared
 * selection-bounds center, without mutating the scene. Hidden, locked, missing,
 * and layer-protected ids are dropped up front; the transform command re-checks
 * the same rule at write time so stale calls stay harmless.
 */
export function computeFlipEdits(
	document: SceneDocument,
	nodeIds: readonly string[],
	axis: FlipAxis,
): readonly FlipEdit[] {
	const nodes = [...new Set(nodeIds)].flatMap((nodeId) => {
		if (!isNodeTransformable(document, nodeId)) return [];
		const node = findNode(document, nodeId);
		return node ? [node] : [];
	});
	if (nodes.length === 0) return [];

	const corners = nodes.flatMap(transformedCorners);
	const xs = corners.map((point) => point.x);
	const ys = corners.map((point) => point.y);
	const pivot =
		axis === "horizontal"
			? (Math.min(...xs) + Math.max(...xs)) / 2
			: (Math.min(...ys) + Math.max(...ys)) / 2;

	return nodes.map((node) => ({
		nodeId: node.id,
		matrix: flipMatrix(axis, pivot, matrixFromTransform(node.transform)),
	}));
}

/**
 * Commits an axis flip of the selection around its bounds center as exactly one
 * undoable transaction. Returns whether the document changed so callers can skip
 * empty history for unflippable selections.
 */
export function commitFlipNodes(
	nodeIds: readonly string[],
	axis: FlipAxis,
): boolean {
	const before = useSceneStore.getState().document;
	const edits = computeFlipEdits(before, nodeIds, axis);
	if (edits.length === 0) return false;

	const label = axis === "horizontal" ? "Flip horizontal" : "Flip vertical";
	const matrixDeltas = edits.flatMap((edit) => {
		const node = findNode(before, edit.nodeId);
		return node
			? [multiply(edit.matrix, invert(matrixFromTransform(node.transform)))]
			: [];
	});
	useSceneStore
		.getState()
		.beginTransaction(`flip:${axis}:${flipSequence++}`, label);
	const grammarTargetNodeIds = currentMotionGrammarTargetNodeIds();
	const motion = useMotionStore.getState().document;
	for (const edit of edits) {
		useSceneStore
			.getState()
			.apply(
				createUpdateNodeTransformCommand(
					edit.nodeId,
					{ matrix: edit.matrix },
					{ label, grammarTargetNodeIds, motion },
				),
			);
	}
	useSceneStore.getState().commit();
	const changed = useSceneStore.getState().document !== before;
	if (changed) {
		recordMatrixDeltasRepeatTransform(matrixDeltas, label, {
			document: useSceneStore.getState().document,
			nodeIds,
		});
	}
	return changed;
}
