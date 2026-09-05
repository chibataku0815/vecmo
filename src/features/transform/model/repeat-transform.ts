import { create } from "zustand";
import { useMotionStore } from "@/entities/motion/model/store";
import { currentMotionGrammarTargetNodeIds } from "@/entities/motion-grammar/model/store";
import type { SceneCommand } from "@/entities/scene/model/command";
import { createUpdateNodeTransformCommand } from "@/entities/scene/model/node-commands";
import {
	type Matrix2D,
	matrixFromTransform,
} from "@/entities/scene/model/rendering";
import { findNode } from "@/entities/scene/model/selectors";
import type { SceneDocument } from "@/entities/scene/model/types";
import { transformableSelectionNodes } from "./geometry";
import { invert, multiply } from "./matrix";

const EPSILON = 1e-6;
let repeatTransformTransactionSequence = 0;

export type RepeatTransformApplication = "world" | "local";

export type RepeatTransformPlan =
	| {
			readonly kind: "transform";
			readonly label: string;
			readonly matrixDeltas: readonly Matrix2D[];
			readonly application: RepeatTransformApplication;
	  }
	| {
			readonly kind: "duplicate-transform";
			readonly label: string;
			readonly matrixDeltas: readonly Matrix2D[];
	  };

export type RepeatTransformSnapshot = {
	readonly nodeId: string;
	readonly matrix: Matrix2D;
};

type PendingDuplicateTransform = {
	readonly sourceMatrices: readonly Matrix2D[];
	readonly duplicateNodeIds: readonly string[];
};

type RepeatTransformStore = {
	readonly plan: RepeatTransformPlan | null;
	readonly pendingDuplicate: PendingDuplicateTransform | null;
	readonly setPlan: (plan: RepeatTransformPlan | null) => void;
	readonly setPendingDuplicate: (
		pendingDuplicate: PendingDuplicateTransform | null,
	) => void;
};

export const useRepeatTransformStore = create<RepeatTransformStore>()(
	(set) => ({
		plan: null,
		pendingDuplicate: null,
		setPlan: (plan) => set({ plan }),
		setPendingDuplicate: (pendingDuplicate) => set({ pendingDuplicate }),
	}),
);

/** Returns a fresh coalesce key so adjacent Transform Again runs undo one at a time. */
export function nextRepeatTransformTransactionKey(): string {
	return `repeat-transform:${repeatTransformTransactionSequence++}`;
}

const matrixDelta = (from: Matrix2D, to: Matrix2D): Matrix2D =>
	multiply(to, invert(from));

const isIdentityMatrix = (matrix: Matrix2D): boolean =>
	Math.abs(matrix.a - 1) <= EPSILON &&
	Math.abs(matrix.b) <= EPSILON &&
	Math.abs(matrix.c) <= EPSILON &&
	Math.abs(matrix.d - 1) <= EPSILON &&
	Math.abs(matrix.e) <= EPSILON &&
	Math.abs(matrix.f) <= EPSILON;

const usableDeltas = (
	matrixDeltas: readonly Matrix2D[],
): readonly Matrix2D[] =>
	matrixDeltas.some((delta) => !isIdentityMatrix(delta)) ? matrixDeltas : [];

const setRepeatPlan = (plan: RepeatTransformPlan | null): void => {
	useRepeatTransformStore.getState().setPlan(plan);
};

const setPendingDuplicate = (
	pendingDuplicate: PendingDuplicateTransform | null,
): void => {
	useRepeatTransformStore.getState().setPendingDuplicate(pendingDuplicate);
};

const clearRepeatTransform = (): void => {
	setRepeatPlan(null);
	setPendingDuplicate(null);
};

const sameNodeOrder = (
	left: readonly string[],
	right: readonly string[],
): boolean =>
	left.length === right.length &&
	left.every((nodeId, index) => nodeId === right[index]);

const matrixDeltasFromSourcesToNodes = (
	sourceMatrices: readonly Matrix2D[],
	document: SceneDocument,
	nodeIds: readonly string[],
): readonly Matrix2D[] =>
	sourceMatrices.flatMap((sourceMatrix, index) => {
		const node = findNode(document, nodeIds[index] ?? null);
		return node
			? [matrixDelta(sourceMatrix, matrixFromTransform(node.transform))]
			: [];
	});

const pendingDuplicateDeltasForSelection = (
	document: SceneDocument,
	nodeIds: readonly string[],
): readonly Matrix2D[] | null => {
	const currentNodeIds = transformableSelectionNodes(document, nodeIds).map(
		(node) => node.id,
	);
	const pendingDuplicate = useRepeatTransformStore.getState().pendingDuplicate;
	if (
		!pendingDuplicate ||
		!sameNodeOrder(currentNodeIds, pendingDuplicate.duplicateNodeIds)
	) {
		return null;
	}
	return matrixDeltasFromSourcesToNodes(
		pendingDuplicate.sourceMatrices,
		document,
		pendingDuplicate.duplicateNodeIds,
	);
};

const recordDuplicateDeltas = (
	matrixDeltas: readonly Matrix2D[],
	label = "Transform again",
): void => {
	const deltas = usableDeltas(matrixDeltas);
	if (deltas.length === 0) {
		clearRepeatTransform();
		return;
	}
	setRepeatPlan({
		kind: "duplicate-transform",
		label,
		matrixDeltas: deltas,
	});
};

/**
 * Captures the transform matrices for the currently transformable selection.
 * The ordering mirrors canvas transforms so repeated duplicate-transform plans
 * can pair source and duplicate nodes without reaching across feature layers.
 */
export function captureRepeatTransformMatrices(
	document: SceneDocument,
	nodeIds: readonly string[],
): readonly Matrix2D[] {
	return transformableSelectionNodes(document, nodeIds).map((node) =>
		matrixFromTransform(node.transform),
	);
}

/**
 * Records a single affine delta as the next Transform Again operation. This is
 * used by actions such as nudge where the committed transform is already known.
 */
export function recordMatrixRepeatTransform(
	matrix: Matrix2D,
	label: string,
): void {
	const matrixDeltas = usableDeltas([matrix]);
	if (matrixDeltas.length === 0) {
		clearRepeatTransform();
		return;
	}
	setRepeatPlan({
		kind: "transform",
		label,
		matrixDeltas,
		application: "world",
	});
	setPendingDuplicate(null);
}

/**
 * Records a matrix delta for the current selection, preserving duplicate-spacing
 * semantics when the selection is still the fresh output of Duplicate.
 */
export function recordSelectionMatrixRepeatTransform(
	matrix: Matrix2D,
	label: string,
	document: SceneDocument,
	nodeIds: readonly string[],
): void {
	const duplicateDeltas = pendingDuplicateDeltasForSelection(document, nodeIds);
	if (duplicateDeltas) {
		recordDuplicateDeltas(duplicateDeltas);
		return;
	}
	recordMatrixRepeatTransform(matrix, label);
}

/**
 * Records per-node affine deltas as the next Transform Again operation.
 * Callers pass final matrices as deltas from each source matrix, preserving
 * local-scale repeat behavior for single-node resize while still supporting
 * shared move/rotate deltas.
 */
export function recordMatrixDeltasRepeatTransform(
	matrixDeltas: readonly Matrix2D[],
	label: string,
	options: {
		readonly application?: RepeatTransformApplication;
		readonly document?: SceneDocument;
		readonly nodeIds?: readonly string[];
	} = {},
): void {
	if (options.document && options.nodeIds) {
		const duplicateDeltas = pendingDuplicateDeltasForSelection(
			options.document,
			options.nodeIds,
		);
		if (duplicateDeltas) {
			recordDuplicateDeltas(duplicateDeltas);
			return;
		}
	}
	const deltas = usableDeltas(matrixDeltas);
	if (deltas.length === 0) {
		clearRepeatTransform();
		return;
	}
	setRepeatPlan({
		kind: "transform",
		label,
		matrixDeltas: deltas,
		application: options.application ?? "world",
	});
	setPendingDuplicate(null);
}

/**
 * Records a committed canvas transform. If the transformed nodes are the fresh
 * output of a duplicate operation, the duplicate spec is upgraded so Transform
 * Again creates another copy at the adjusted spacing instead of merely moving
 * the current duplicate.
 */
export function recordNodeTransformRepeat(
	snapshots: readonly RepeatTransformSnapshot[],
	document: SceneDocument,
	label: string,
	options: { readonly application?: RepeatTransformApplication } = {},
): void {
	const snapshotNodeIds = snapshots.map((snapshot) => snapshot.nodeId);
	const pendingDuplicate = useRepeatTransformStore.getState().pendingDuplicate;
	if (
		pendingDuplicate &&
		sameNodeOrder(snapshotNodeIds, pendingDuplicate.duplicateNodeIds)
	) {
		recordDuplicateDeltas(
			matrixDeltasFromSourcesToNodes(
				pendingDuplicate.sourceMatrices,
				document,
				pendingDuplicate.duplicateNodeIds,
			),
		);
		return;
	}

	const application =
		options.application ??
		(label === "Resize" && snapshots.length === 1 ? "local" : "world");
	const matrixDeltas = usableDeltas(
		snapshots.flatMap((snapshot) => {
			const node = findNode(document, snapshot.nodeId);
			return node
				? [
						application === "local"
							? multiply(
									invert(snapshot.matrix),
									matrixFromTransform(node.transform),
								)
							: matrixDelta(
									snapshot.matrix,
									matrixFromTransform(node.transform),
								),
					]
				: [];
		}),
	);
	if (matrixDeltas.length === 0) {
		clearRepeatTransform();
		return;
	}
	setRepeatPlan({
		kind: "transform",
		label,
		matrixDeltas,
		application,
	});
	setPendingDuplicate(null);
}

/**
 * Seeds Transform Again from a duplicate command. The duplicate is represented
 * as "copy in place, then apply the captured affine delta", which also lets a
 * later manual move of the duplicate refine the spacing before repeated runs.
 */
export function recordDuplicateTransformRepeat(input: {
	readonly sourceMatrices: readonly Matrix2D[];
	readonly duplicateNodeIds: readonly string[];
	readonly document: SceneDocument;
	readonly label?: string;
}): void {
	const matrixDeltas = usableDeltas(
		matrixDeltasFromSourcesToNodes(
			input.sourceMatrices,
			input.document,
			input.duplicateNodeIds,
		),
	);
	if (matrixDeltas.length === 0) {
		clearRepeatTransform();
		return;
	}
	setRepeatPlan({
		kind: "duplicate-transform",
		label: input.label ?? "Transform again",
		matrixDeltas,
	});
	setPendingDuplicate({
		sourceMatrices: input.sourceMatrices,
		duplicateNodeIds: input.duplicateNodeIds,
	});
}

/**
 * Builds scene commands that replay a repeat-transform plan onto the current
 * transformable selection. If the target count differs from the original
 * capture, the first delta is applied to every target, matching the common
 * "repeat last transform on another selection" workflow.
 */
export function buildRepeatTransformCommands(
	document: SceneDocument,
	nodeIds: readonly string[],
	plan: RepeatTransformPlan,
): readonly SceneCommand[] {
	const nodes = transformableSelectionNodes(document, nodeIds);
	const grammarTargetNodeIds = currentMotionGrammarTargetNodeIds();
	const motion = useMotionStore.getState().document;
	return nodes.flatMap((node, index) => {
		const delta = plan.matrixDeltas[index] ?? plan.matrixDeltas[0];
		if (!delta) return [];
		const current = matrixFromTransform(node.transform);
		return [
			createUpdateNodeTransformCommand(
				node.id,
				{
					matrix:
						plan.kind === "transform" && plan.application === "local"
							? multiply(current, delta)
							: multiply(delta, current),
				},
				{ label: "Transform again", grammarTargetNodeIds, motion },
			),
		];
	});
}
