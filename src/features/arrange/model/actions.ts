import { useMotionStore } from "@/entities/motion/model/store";
import { currentMotionGrammarTargetNodeIds } from "@/entities/motion-grammar/model/store";
import {
	createReorderNodeWithinLayerCommand,
	createUpdateNodeTransformCommand,
} from "@/entities/scene/model/node-commands";
import {
	getNodeLocalBounds,
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
	SceneLayer,
	Vec2,
	VectorNode,
} from "@/entities/scene/model/types";

export type AlignAlignment =
	| "left"
	| "center"
	| "right"
	| "top"
	| "middle"
	| "bottom";

export type DistributeAxis = "horizontal" | "vertical";
export type ZOrderDirection = "forward" | "backward" | "to-front" | "to-back";

export type ArrangeAction =
	| { readonly kind: "align"; readonly alignment: AlignAlignment }
	| { readonly kind: "distribute"; readonly axis: DistributeAxis }
	| { readonly kind: "z-order"; readonly direction: ZOrderDirection };

export type TransformedBounds = {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
	readonly width: number;
	readonly height: number;
	readonly centerX: number;
	readonly centerY: number;
};

export type ArrangeEdit = {
	readonly nodeId: string;
	readonly delta: Vec2;
	readonly position: Vec2;
	readonly bounds: TransformedBounds;
};

export type ZOrderEdit = {
	readonly layerId: string;
	readonly nodeId: string;
	readonly fromIndex: number;
	readonly toIndex: number;
};

/** Enabled, non-mutating readiness result for an arrange action surface entry. */
export type SelectedArrangeActionAvailable = {
	readonly enabled: true;
	readonly action: ArrangeAction;
	readonly sourceNodeIds: readonly string[];
	readonly arrangeableNodeIds: readonly string[];
	readonly editCount: number;
};

/**
 * Disabled readiness result with the UI-facing reason produced by the arrange
 * model rather than a widget-local selection count.
 */
export type SelectedArrangeActionUnavailable = {
	readonly enabled: false;
	readonly action: ArrangeAction;
	readonly sourceNodeIds: readonly string[];
	readonly arrangeableNodeIds: readonly string[];
	readonly editCount: number;
	readonly reason: string;
};

/** Non-mutating command-surface state for one arrange action and selection. */
export type SelectedArrangeActionState =
	| SelectedArrangeActionAvailable
	| SelectedArrangeActionUnavailable;

type ArrangeTarget = {
	readonly node: VectorNode;
	readonly bounds: TransformedBounds;
	readonly index: number;
};

type AxisMetrics = {
	readonly start: number;
	readonly end: number;
	readonly size: number;
};

const EPSILON = 1e-6;

let arrangeSequence = 0;

const hasMovement = (delta: Vec2): boolean =>
	Math.abs(delta.x) > EPSILON || Math.abs(delta.y) > EPSILON;

const pointFromMatrix = (matrix: Matrix2D, point: Vec2): Vec2 => ({
	x: matrix.a * point.x + matrix.c * point.y + matrix.e,
	y: matrix.b * point.x + matrix.d * point.y + matrix.f,
});

const boundsFromPoints = (points: readonly Vec2[]): TransformedBounds => {
	const xs = points.map((point) => point.x);
	const ys = points.map((point) => point.y);
	const minX = Math.min(...xs);
	const minY = Math.min(...ys);
	const maxX = Math.max(...xs);
	const maxY = Math.max(...ys);
	return {
		minX,
		minY,
		maxX,
		maxY,
		width: maxX - minX,
		height: maxY - minY,
		centerX: (minX + maxX) / 2,
		centerY: (minY + maxY) / 2,
	};
};

const unionBounds = (
	targets: readonly ArrangeTarget[],
): TransformedBounds | null => {
	if (targets.length === 0) return null;
	return boundsFromPoints(
		targets.flatMap((target) => [
			{ x: target.bounds.minX, y: target.bounds.minY },
			{ x: target.bounds.maxX, y: target.bounds.maxY },
		]),
	);
};

const uniqueNodeIds = (nodeIds: readonly string[]): string[] => [
	...new Set(nodeIds),
];

const nextPosition = (node: VectorNode, delta: Vec2): Vec2 => ({
	x: node.transform.position.x + delta.x,
	y: node.transform.position.y + delta.y,
});

const editForDelta = (
	target: ArrangeTarget,
	delta: Vec2,
): ArrangeEdit | null => {
	if (!hasMovement(delta)) return null;
	return {
		nodeId: target.node.id,
		delta,
		position: nextPosition(target.node, delta),
		bounds: target.bounds,
	};
};

const axisMetrics = (
	bounds: TransformedBounds,
	axis: DistributeAxis,
): AxisMetrics =>
	axis === "horizontal"
		? { start: bounds.minX, end: bounds.maxX, size: bounds.width }
		: { start: bounds.minY, end: bounds.maxY, size: bounds.height };

const distributionDelta = (
	target: ArrangeTarget,
	axis: DistributeAxis,
	targetStart: number,
): Vec2 => {
	const current = axisMetrics(target.bounds, axis).start;
	const offset = targetStart - current;
	return axis === "horizontal" ? { x: offset, y: 0 } : { x: 0, y: offset };
};

const zOrderLabels = {
	forward: "Bring forward",
	backward: "Send backward",
	"to-front": "Bring to front",
	"to-back": "Send to back",
} as const satisfies Record<ZOrderDirection, string>;

const actionLabel = (action: ArrangeAction): string => {
	if (action.kind === "align") return `Align ${action.alignment}`;
	if (action.kind === "distribute") return `Distribute ${action.axis}`;
	return zOrderLabels[action.direction];
};

const actionKey = (action: ArrangeAction): string => {
	if (action.kind === "align") return `align:${action.alignment}`;
	if (action.kind === "distribute") return `distribute:${action.axis}`;
	return `z-order:${action.direction}`;
};

const nextTransactionKey = (action: ArrangeAction): string =>
	`arrange:${actionKey(action)}:${arrangeSequence++}`;

const minimumArrangeableCount = (action: ArrangeAction): number => {
	if (action.kind === "distribute") return 3;
	if (action.kind === "align") return 2;
	return 1;
};

const minimumArrangeReason = (action: ArrangeAction): string => {
	if (action.kind === "distribute") {
		return "Select at least three unlocked visible layers to distribute.";
	}
	if (action.kind === "align") {
		return "Select at least two unlocked visible layers to align.";
	}
	return "Select an unlocked visible top-level layer to change stacking order.";
};

const noopArrangeReason = (action: ArrangeAction): string => {
	if (action.kind === "distribute") {
		return "Selection is already distributed.";
	}
	if (action.kind === "align") {
		return "Selection is already aligned.";
	}
	return "Selection cannot move farther in that direction.";
};

/**
 * Returns the artboard-space AABB of a node after the scene transform is
 * applied. Arrange actions intentionally align these rendered bounds rather
 * than raw geometry so rotated and scaled objects land where users see them.
 */
export function transformedNodeBounds(node: VectorNode): TransformedBounds {
	const bounds = getNodeLocalBounds(node);
	const matrix = matrixFromTransform(node.transform);
	return boundsFromPoints([
		pointFromMatrix(matrix, { x: bounds.x, y: bounds.y }),
		pointFromMatrix(matrix, { x: bounds.x + bounds.width, y: bounds.y }),
		pointFromMatrix(matrix, {
			x: bounds.x + bounds.width,
			y: bounds.y + bounds.height,
		}),
		pointFromMatrix(matrix, { x: bounds.x, y: bounds.y + bounds.height }),
	]);
}

/**
 * Resolves selection ids into arrangeable scene nodes. Hidden, locked, missing,
 * or layer-protected nodes are dropped up front; scene commands still enforce
 * the same rule at write time so stale UI calls remain harmless.
 */
function arrangeTargetsForDocument(
	document: SceneDocument,
	nodeIds: readonly string[],
): readonly ArrangeTarget[] {
	return uniqueNodeIds(nodeIds).flatMap((nodeId, index) => {
		if (!isNodeTransformable(document, nodeId)) return [];
		const node = findNode(document, nodeId);
		if (!node) return [];
		return [{ node, bounds: transformedNodeBounds(node), index }];
	});
}

/**
 * Computes align edits against the multi-selection bounds without mutating the
 * scene. The returned positions are absolute transform positions so callers can
 * dispatch them safely inside one transaction.
 */
export function computeAlignEdits(
	document: SceneDocument,
	nodeIds: readonly string[],
	alignment: AlignAlignment,
): readonly ArrangeEdit[] {
	const targets = arrangeTargetsForDocument(document, nodeIds);
	const selectionBounds = unionBounds(targets);
	if (!selectionBounds) return [];

	return targets.flatMap((target) => {
		const delta = (() => {
			switch (alignment) {
				case "left":
					return { x: selectionBounds.minX - target.bounds.minX, y: 0 };
				case "center":
					return { x: selectionBounds.centerX - target.bounds.centerX, y: 0 };
				case "right":
					return { x: selectionBounds.maxX - target.bounds.maxX, y: 0 };
				case "top":
					return { x: 0, y: selectionBounds.minY - target.bounds.minY };
				case "middle":
					return { x: 0, y: selectionBounds.centerY - target.bounds.centerY };
				case "bottom":
					return { x: 0, y: selectionBounds.maxY - target.bounds.maxY };
			}
		})();
		const edit = editForDelta(target, delta);
		return edit ? [edit] : [];
	});
}

/**
 * Computes equal-gap distribution edits along one axis. The outermost rendered
 * bounds stay pinned and interior objects are translated so spacing between
 * transformed bounds is even, matching the expected design-tool behavior for
 * multi-selection distribution.
 */
export function computeDistributeEdits(
	document: SceneDocument,
	nodeIds: readonly string[],
	axis: DistributeAxis,
): readonly ArrangeEdit[] {
	const targets = arrangeTargetsForDocument(document, nodeIds);
	if (targets.length < 3) return [];
	const sorted = [...targets].sort((a, b) => {
		const diff =
			axisMetrics(a.bounds, axis).start - axisMetrics(b.bounds, axis).start;
		return diff === 0 ? a.index - b.index : diff;
	});
	const selectionBounds = unionBounds(sorted);
	if (!selectionBounds) return [];
	const totalSize = sorted.reduce(
		(sum, target) => sum + axisMetrics(target.bounds, axis).size,
		0,
	);
	const selection = axisMetrics(selectionBounds, axis);
	const gap = (selection.size - totalSize) / (sorted.length - 1);
	let cursor = selection.start;

	return sorted.flatMap((target, index) => {
		const metrics = axisMetrics(target.bounds, axis);
		const targetStart =
			index === sorted.length - 1 ? selection.end - metrics.size : cursor;
		const edit = editForDelta(
			target,
			distributionDelta(target, axis, targetStart),
		);
		cursor = targetStart + metrics.size + gap;
		return edit ? [edit] : [];
	});
}

const swapOrder = (
	order: string[],
	fromIndex: number,
	toIndex: number,
): void => {
	const moving = order[fromIndex];
	const target = order[toIndex];
	if (!moving || !target) return;
	order[fromIndex] = target;
	order[toIndex] = moving;
};

const reorderableTopLevelNodeIds = (layer: SceneLayer): ReadonlySet<string> => {
	if (!layer.visible || layer.locked) return new Set();
	return new Set(
		layer.nodes
			.filter((node) => node.visible && !node.locked)
			.map((node) => node.id),
	);
};

const reorderableSelectedNodeIds = (
	document: SceneDocument,
	nodeIds: readonly string[],
): readonly string[] => {
	const requestedIds = new Set(uniqueNodeIds(nodeIds));
	const reorderableNodeIds: string[] = [];

	for (const layer of document.layers) {
		const reorderableIds = reorderableTopLevelNodeIds(layer);
		for (const node of layer.nodes) {
			if (requestedIds.has(node.id) && reorderableIds.has(node.id)) {
				reorderableNodeIds.push(node.id);
			}
		}
	}

	return reorderableNodeIds;
};

type ZOrderPassInput = {
	readonly order: string[];
	readonly layerId: string;
	readonly selectedInLayer: ReadonlySet<string>;
	readonly reorderableIds: ReadonlySet<string>;
	readonly edits: ZOrderEdit[];
};

/**
 * Bubbles eligible selected nodes one slot toward the front (higher index) past
 * a single non-selected reorderable sibling. Hidden/locked/protected siblings
 * are not reorderable, so they act as barriers. Returns whether anything moved
 * so callers can iterate to a fixpoint for "bring to front".
 */
const forwardZOrderPass = ({
	order,
	layerId,
	selectedInLayer,
	reorderableIds,
	edits,
}: ZOrderPassInput): boolean => {
	let moved = false;
	for (let index = order.length - 2; index >= 0; index -= 1) {
		const nodeId = order[index];
		const nextId = order[index + 1];
		if (
			!nodeId ||
			!nextId ||
			!selectedInLayer.has(nodeId) ||
			!reorderableIds.has(nextId) ||
			selectedInLayer.has(nextId)
		) {
			continue;
		}
		edits.push({ layerId, nodeId, fromIndex: index, toIndex: index + 1 });
		swapOrder(order, index, index + 1);
		moved = true;
	}
	return moved;
};

/** Backward twin of {@link forwardZOrderPass}; moves selected nodes toward index 0. */
const backwardZOrderPass = ({
	order,
	layerId,
	selectedInLayer,
	reorderableIds,
	edits,
}: ZOrderPassInput): boolean => {
	let moved = false;
	for (let index = 1; index < order.length; index += 1) {
		const nodeId = order[index];
		const previousId = order[index - 1];
		if (
			!nodeId ||
			!previousId ||
			!selectedInLayer.has(nodeId) ||
			!reorderableIds.has(previousId) ||
			selectedInLayer.has(previousId)
		) {
			continue;
		}
		edits.push({ layerId, nodeId, fromIndex: index, toIndex: index - 1 });
		swapOrder(order, index, index - 1);
		moved = true;
	}
	return moved;
};

/**
 * Computes top-level z-order moves without mutating the scene. Later sibling
 * indexes render in front, so "forward" moves eligible selected nodes one slot
 * toward the end of their owning layer while preserving selected-node order;
 * "backward" is the mirror. "to-front"/"to-back" repeat the same single-step
 * pass to a fixpoint, so the moves remain as far as a node can travel without
 * crossing a hidden/locked/protected barrier — identical barrier semantics to
 * the one-step variants. Nested child reordering is intentionally skipped until
 * group-specific structure UX has a parent-id contract.
 */
export function computeZOrderEdits(
	document: SceneDocument,
	nodeIds: readonly string[],
	direction: ZOrderDirection,
): readonly ZOrderEdit[] {
	const requestedIds = new Set(uniqueNodeIds(nodeIds));
	if (requestedIds.size === 0) return [];
	const edits: ZOrderEdit[] = [];
	const pass =
		direction === "forward" || direction === "to-front"
			? forwardZOrderPass
			: backwardZOrderPass;
	const repeatToFixpoint = direction === "to-front" || direction === "to-back";

	for (const layer of document.layers) {
		const reorderableIds = reorderableTopLevelNodeIds(layer);
		if (reorderableIds.size === 0) continue;
		const selectedInLayer = new Set(
			layer.nodes
				.filter(
					(node) => requestedIds.has(node.id) && reorderableIds.has(node.id),
				)
				.map((node) => node.id),
		);
		if (selectedInLayer.size === 0) continue;

		const input: ZOrderPassInput = {
			order: layer.nodes.map((node) => node.id),
			layerId: layer.id,
			selectedInLayer,
			reorderableIds,
			edits,
		};
		if (repeatToFixpoint) {
			while (pass(input)) {
				// keep bubbling selected nodes until they hit a barrier or the edge
			}
			continue;
		}
		pass(input);
	}

	return edits;
}

/**
 * Computes arrange edits for the action union used by future UI bridges. This
 * covers transform-like arrange actions only; z-order has separate edit data
 * because it changes sibling indexes rather than transform positions.
 */
export function computeArrangeEdits(
	document: SceneDocument,
	nodeIds: readonly string[],
	action: ArrangeAction,
): readonly ArrangeEdit[] {
	if (action.kind === "z-order") return [];
	return action.kind === "align"
		? computeAlignEdits(document, nodeIds, action.alignment)
		: computeDistributeEdits(document, nodeIds, action.axis);
}

/**
 * Plans whether an arrange action has a real edit for the selected ids without
 * mutating the scene. Command palette and canvas-menu surfaces use this state
 * so disabled reasons, protected-node filtering, and execution readiness stay
 * aligned with the command-bus commit path.
 */
export function selectedArrangeActionState(
	document: SceneDocument,
	nodeIds: readonly string[],
	action: ArrangeAction,
): SelectedArrangeActionState {
	const sourceNodeIds = uniqueNodeIds(nodeIds);
	const arrangeableNodeIds =
		action.kind === "z-order"
			? reorderableSelectedNodeIds(document, sourceNodeIds)
			: arrangeTargetsForDocument(document, sourceNodeIds).map(
					(target) => target.node.id,
				);
	const minimum = minimumArrangeableCount(action);
	if (arrangeableNodeIds.length < minimum) {
		return {
			enabled: false,
			action,
			sourceNodeIds,
			arrangeableNodeIds,
			editCount: 0,
			reason: minimumArrangeReason(action),
		};
	}

	const editCount =
		action.kind === "z-order"
			? computeZOrderEdits(document, sourceNodeIds, action.direction).length
			: computeArrangeEdits(document, sourceNodeIds, action).length;
	if (editCount === 0) {
		return {
			enabled: false,
			action,
			sourceNodeIds,
			arrangeableNodeIds,
			editCount,
			reason: noopArrangeReason(action),
		};
	}

	return {
		enabled: true,
		action,
		sourceNodeIds,
		arrangeableNodeIds,
		editCount,
	};
}

/**
 * Commits an arrange action through the scene command bus. Every call opens a
 * unique transaction so a full align/distribute operation becomes exactly one
 * undo entry and never coalesces with adjacent arrange operations.
 */
export function commitArrangeNodes(
	nodeIds: readonly string[],
	action: ArrangeAction,
): boolean {
	if (action.kind === "z-order") {
		return commitZOrderNodes(nodeIds, action.direction);
	}
	const before = useSceneStore.getState().document;
	const edits = computeArrangeEdits(before, nodeIds, action);
	if (edits.length === 0) return false;

	useSceneStore
		.getState()
		.beginTransaction(nextTransactionKey(action), actionLabel(action));
	const grammarTargetNodeIds = currentMotionGrammarTargetNodeIds();
	const motion = useMotionStore.getState().document;
	for (const edit of edits) {
		useSceneStore
			.getState()
			.apply(
				createUpdateNodeTransformCommand(
					edit.nodeId,
					{ transform: { position: edit.position } },
					{ grammarTargetNodeIds, motion },
				),
			);
	}
	useSceneStore.getState().commit();
	return useSceneStore.getState().document !== before;
}

/**
 * Convenience command API for Inspector, shortcuts, or a future action menu
 * that already knows it is dispatching an align operation.
 */
export function commitAlignNodes(
	nodeIds: readonly string[],
	alignment: AlignAlignment,
): boolean {
	return commitArrangeNodes(nodeIds, { kind: "align", alignment });
}

/**
 * Convenience command API for Inspector, shortcuts, or a future action menu
 * that already knows it is dispatching a distribution operation.
 */
export function commitDistributeNodes(
	nodeIds: readonly string[],
	axis: DistributeAxis,
): boolean {
	return commitArrangeNodes(nodeIds, { kind: "distribute", axis });
}

/**
 * Commits one-step z-order moves for top-level selected nodes as one undoable
 * arrange operation. Hidden, locked, nested, missing, and layer-protected ids
 * are filtered before commands are created so stale action-surface calls cannot
 * add empty history.
 */
export function commitZOrderNodes(
	nodeIds: readonly string[],
	direction: ZOrderDirection,
): boolean {
	const before = useSceneStore.getState().document;
	const edits = computeZOrderEdits(before, nodeIds, direction);
	if (edits.length === 0) return false;

	const action = {
		kind: "z-order",
		direction,
	} as const satisfies ArrangeAction;
	useSceneStore
		.getState()
		.beginTransaction(nextTransactionKey(action), actionLabel(action));
	for (const edit of edits) {
		useSceneStore
			.getState()
			.apply(
				createReorderNodeWithinLayerCommand(
					edit.layerId,
					edit.nodeId,
					edit.toIndex,
				),
			);
	}
	useSceneStore.getState().commit();
	return useSceneStore.getState().document !== before;
}
