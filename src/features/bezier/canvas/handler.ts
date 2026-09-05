import {
	composeMatrix,
	type Matrix2D,
	matrixFromTransform,
} from "@/entities/scene/model/rendering";
import {
	findNode,
	findRenderableNodeEntry,
} from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import type {
	SceneDocument,
	Transform,
	VectorNode,
} from "@/entities/scene/model/types";
import type { AeShape } from "@/shared/glammer/ae-shape";
import { createSetPathShapeCommand } from "../model/command";
import {
	applyInverseMatrix,
	type BezierTarget,
	canInsertAtProjection,
	hitTestShape,
	insertAnchor,
	invertMatrix,
	isPathClosed,
	isVisiblePathHandle,
	moveAnchor,
	moveHandle,
	moveSegment,
	projectOntoShape,
	removeAnchor,
	resetHandle,
	screenPixelsToLocalLength,
	setPathClosed,
	type Vec,
} from "../model/geometry";

// Structural mirror of the canvas registry surface. Features cannot import the
// widget-layer registry types (arch bans upward imports), so the handler is
// typed against this local subset; the host passes a compatible superset.
type CanvasPoint = {
	readonly x: number;
	readonly y: number;
};

type PointerContext = {
	readonly point: CanvasPoint;
	readonly hitNodeId: string | null;
	readonly hitStackNodeIds?: readonly string[];
	readonly event: PointerEvent;
};

type PathSub = {
	readonly nodeId: string;
	readonly kind: BezierTarget["kind"];
	readonly index: number;
	readonly indices?: readonly number[];
};

// The host's sub-selection union also carries foreign variants (e.g. the gradient
// annotator's stop selection). Bezier mirrors that read shape so the wider host API
// stays assignable; it guards every foreign variant out before touching the
// path-only `index`/`kind`, and only ever writes the path variant.
type HostSubSelection =
	| PathSub
	| { readonly nodeId?: string; readonly kind: string }
	| null;

type HostApi = {
	readonly apply?: (
		nodeId: string,
		patch: {
			readonly matrix?: Matrix2D;
			readonly transform?: Partial<Transform>;
			readonly opacity?: number;
		},
	) => void;
	readonly getDoc: () => SceneDocument;
	readonly selection: {
		readonly primary: string | null;
		readonly nodeIds: readonly string[];
		readonly sub: HostSubSelection;
	};
	readonly viewport: {
		readonly zoom: number;
	};
	readonly select: (nodeId: string, additive?: boolean) => void;
	readonly setSubSelection: (sub: PathSub | null) => void;
};

type BezierToolHandler = {
	readonly id: string;
	readonly tool: "direct-select";
	readonly onPointerDown: (context: PointerContext, api: HostApi) => void;
	readonly onPointerMove: (context: PointerContext, api: HostApi) => void;
	readonly onPointerUp: (context: PointerContext, api: HostApi) => void;
	readonly onKeyDown: (event: KeyboardEvent, api: HostApi) => void;
	readonly onDeactivate: (api: HostApi) => void;
};

const HIT_RADIUS_PX = 9;
const SEGMENT_HIT_PX = 7;
const DRAG_THRESHOLD_PX = 3;
const PERCENT = 100;
const EDIT_LABEL = "Edit path";
const MOVE_NODE_LABEL = "Move direct selection";
const DELETE_LABEL = "Delete path point";
const RESET_HANDLE_LABEL = "Reset path handle";
const INSERT_LABEL = "Insert path point";
const TOGGLE_CLOSED_LABEL = "Toggle path closed";
const NUDGE_LABEL = "Nudge direct selection";
const NUDGE_COALESCE_MS = 650;
const NUDGE_STEP = 1;
const NUDGE_STEP_LARGE = 10;

type PathGesture = {
	readonly kind: "path";
	readonly nodeId: string;
	readonly originalShape: AeShape;
	readonly matrix: Matrix2D;
	readonly target: BezierTarget | null;
	readonly anchorIndices: readonly number[] | null;
	readonly projection: { readonly segment: number; readonly t: number } | null;
	readonly startPoint: CanvasPoint;
	readonly startLocal: Vec;
	readonly coalesceKey: string;
	dragging: boolean;
	transactionOpen: boolean;
};

type NodeMoveSnapshot = {
	readonly nodeId: string;
	readonly startMatrix: Matrix2D;
	readonly parentMatrix: Matrix2D;
};

type NodeMoveGesture = {
	readonly kind: "node-move";
	readonly snapshots: readonly NodeMoveSnapshot[];
	readonly startPoint: CanvasPoint;
	readonly coalesceKey: string;
	dragging: boolean;
	transactionOpen: boolean;
};

type Gesture = PathGesture | NodeMoveGesture;

type PathHit = {
	readonly node: VectorNode;
	readonly matrix: Matrix2D;
	readonly target: BezierTarget | null;
	readonly projection: { readonly segment: number; readonly t: number } | null;
};

let gesture: Gesture | null = null;
let gestureSeq = 0;
let actionSeq = 0;
let nudgeSeq = 0;
let lastNudgeAt = 0;

const IDENTITY_MATRIX: Matrix2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

const parentMatrixForNode = (
	document: SceneDocument,
	nodeId: string,
): Matrix2D => {
	const entry = findRenderableNodeEntry(document, nodeId);
	if (!entry || entry.parentIds.length === 0) return IDENTITY_MATRIX;
	return entry.parentIds.reduce((matrix, parentId) => {
		const parent = findNode(document, parentId);
		return parent
			? composeMatrix(matrix, matrixFromTransform(parent.transform))
			: matrix;
	}, IDENTITY_MATRIX);
};

const worldMatrixForNode = (
	document: SceneDocument,
	node: VectorNode,
): Matrix2D =>
	composeMatrix(
		parentMatrixForNode(document, node.id),
		matrixFromTransform(node.transform),
	);

const directSelectableNode = (
	document: SceneDocument,
	nodeId: string | null,
): VectorNode | null => {
	const node = findNode(document, nodeId);
	if (!node || node.blendStep) return null;
	const entry = findRenderableNodeEntry(document, node.id);
	return entry && !entry.locked ? node : null;
};

const hitNodeIds = (context: PointerContext): readonly string[] =>
	context.hitStackNodeIds ??
	(context.hitNodeId === null ? [] : [context.hitNodeId]);

const firstDirectSelectableHit = (
	context: PointerContext,
	api: HostApi,
): VectorNode | null => {
	const document = api.getDoc();
	for (const nodeId of hitNodeIds(context)) {
		const node = directSelectableNode(document, nodeId);
		if (node) return node;
	}
	return null;
};

const selectedPathNode = (api: HostApi): VectorNode | null => {
	const node = findNode(api.getDoc(), api.selection.primary);
	return node && node.geometry.kind === "path" ? node : null;
};

const hitPathNode = (
	context: PointerContext,
	api: HostApi,
): VectorNode | null => {
	const document = api.getDoc();
	for (const nodeId of hitNodeIds(context)) {
		const node = directSelectableNode(document, nodeId);
		if (node?.geometry.kind === "path") return node;
	}
	return null;
};

const screenScale = (api: HostApi): number =>
	Number.isFinite(api.viewport.zoom) && api.viewport.zoom > 0
		? api.viewport.zoom / PERCENT
		: 1;

/** Converts a screen-pixel tolerance into node-local units. */
const localTolerance = (
	matrix: Matrix2D,
	api: HostApi,
	pixels: number,
): number => screenPixelsToLocalLength(matrix, api.viewport.zoom, pixels);

const pathHit = (
	node: VectorNode,
	point: CanvasPoint,
	api: HostApi,
): PathHit => {
	const matrix = worldMatrixForNode(api.getDoc(), node);
	const local = applyInverseMatrix(matrix, point);
	const shape = node.geometry.kind === "path" ? node.geometry.shape : null;
	const target = shape
		? hitTestShape(shape, local, localTolerance(matrix, api, HIT_RADIUS_PX))
		: null;
	const projected =
		shape && !target
			? projectOntoShape(
					shape,
					local,
					localTolerance(matrix, api, SEGMENT_HIT_PX),
				)
			: null;
	// A projection that collapses onto a segment endpoint would insert a
	// coincident duplicate anchor, so it is not treated as a segment hit; the
	// gesture falls back to a bare miss (anchor wins via hit testing instead).
	const insertable =
		projected &&
		shape &&
		canInsertAtProjection(shape, projected.segment, projected.t)
			? projected
			: null;
	return {
		node,
		matrix,
		target,
		projection: insertable
			? { segment: insertable.segment, t: insertable.t }
			: null,
	};
};

const hasBezierHit = (hit: PathHit): boolean =>
	Boolean(hit.target ?? hit.projection);

const dispatchShape = (
	nodeId: string,
	shape: AeShape,
	coalesceKey: string,
	label = EDIT_LABEL,
): void => {
	useSceneStore
		.getState()
		.apply(createSetPathShapeCommand(nodeId, shape, coalesceKey, label));
};

const nextActionKey = (nodeId: string, action: string): string => {
	actionSeq += 1;
	return `bezier:${nodeId}:${action}:${actionSeq}`;
};

const dispatchShapeAction = (
	nodeId: string,
	shape: AeShape,
	action: string,
	label: string,
): void => {
	const coalesceKey = nextActionKey(nodeId, action);
	const store = useSceneStore.getState();
	store.beginTransaction(coalesceKey, label);
	dispatchShape(nodeId, shape, coalesceKey, label);
	store.commit();
};

const nextShapeForDrag = (
	current: PathGesture,
	local: Vec,
	altKey: boolean,
): AeShape => {
	const target = current.target;
	if (target?.kind === "anchor") {
		if (current.anchorIndices && current.anchorIndices.length > 0) {
			return movedAnchors(current.originalShape, current.anchorIndices, {
				x: local.x - current.startLocal.x,
				y: local.y - current.startLocal.y,
			});
		}
		return moveAnchor(current.originalShape, target.index, local);
	}
	if (!target && current.projection) {
		return moveSegment(
			current.originalShape,
			current.projection.segment,
			current.projection.t,
			{
				x: local.x - current.startLocal.x,
				y: local.y - current.startLocal.y,
			},
		);
	}
	if (!target) return current.originalShape;
	return moveHandle(
		current.originalShape,
		target.index,
		target.kind,
		local,
		altKey,
	);
};

const translationMatrix = (dx: number, dy: number): Matrix2D => ({
	a: 1,
	b: 0,
	c: 0,
	d: 1,
	e: dx,
	f: dy,
});

const nudgeDelta = (
	key: string,
	large: boolean,
): { readonly dx: number; readonly dy: number } | null => {
	const step = large ? NUDGE_STEP_LARGE : NUDGE_STEP;
	switch (key) {
		case "ArrowLeft":
			return { dx: -step, dy: 0 };
		case "ArrowRight":
			return { dx: step, dy: 0 };
		case "ArrowUp":
			return { dx: 0, dy: -step };
		case "ArrowDown":
			return { dx: 0, dy: step };
		default:
			return null;
	}
};

const moveSnapshotByDelta = (
	snapshot: NodeMoveSnapshot,
	dx: number,
	dy: number,
): Matrix2D => {
	const worldStart = composeMatrix(snapshot.parentMatrix, snapshot.startMatrix);
	const worldNext = composeMatrix(translationMatrix(dx, dy), worldStart);
	return composeMatrix(invertMatrix(snapshot.parentMatrix), worldNext);
};

const movedChildMatrix = (
	snapshot: NodeMoveSnapshot,
	startPoint: CanvasPoint,
	point: CanvasPoint,
): Matrix2D => {
	return moveSnapshotByDelta(
		snapshot,
		point.x - startPoint.x,
		point.y - startPoint.y,
	);
};

const selectedDirectNodes = (
	api: HostApi,
	fallbackNodeId: string,
): readonly VectorNode[] => {
	const document = api.getDoc();
	const selected = api.selection.nodeIds
		.map((nodeId) => directSelectableNode(document, nodeId))
		.filter((node): node is VectorNode => Boolean(node));
	if (selected.some((node) => node.id === fallbackNodeId)) return selected;
	const fallback = directSelectableNode(document, fallbackNodeId);
	return fallback ? [fallback] : [];
};

const nodeMoveSnapshots = (
	api: HostApi,
	nodes: readonly VectorNode[],
): readonly NodeMoveSnapshot[] =>
	nodes.map((node) => ({
		nodeId: node.id,
		startMatrix: matrixFromTransform(node.transform),
		parentMatrix: parentMatrixForNode(api.getDoc(), node.id),
	}));

const applyNodeMove = (
	api: HostApi,
	current: NodeMoveGesture,
	point: CanvasPoint,
): void => {
	if (!api.apply) return;
	for (const snapshot of current.snapshots) {
		api.apply(snapshot.nodeId, {
			matrix: movedChildMatrix(snapshot, current.startPoint, point),
		});
	}
};

const isPathSubSelection = (sub: HostSubSelection): sub is PathSub => {
	if (!sub) return false;
	if (
		sub.kind !== "anchor" &&
		sub.kind !== "handle-in" &&
		sub.kind !== "handle-out"
	) {
		return false;
	}
	return (
		typeof sub.nodeId === "string" &&
		"index" in sub &&
		Number.isInteger(sub.index) &&
		(!("indices" in sub) ||
			sub.indices === undefined ||
			(Array.isArray(sub.indices) && sub.indices.every(Number.isInteger)))
	);
};

const cleanAnchorIndices = (
	shape: AeShape,
	indices: readonly number[],
): readonly number[] => {
	const max = shape.vertices.length - 1;
	return [...new Set(indices)]
		.filter((index) => Number.isInteger(index) && index >= 0 && index <= max)
		.toSorted((a, b) => a - b);
};

const anchorIndicesFromSub = (
	shape: AeShape,
	sub: PathSub,
): readonly number[] =>
	sub.kind === "anchor"
		? cleanAnchorIndices(shape, sub.indices ?? [sub.index])
		: [];

const toggledAnchorSelection = (
	shape: AeShape,
	current: HostSubSelection,
	nodeId: string,
	index: number,
	additive: boolean,
): PathSub | null => {
	const existing =
		isPathSubSelection(current) &&
		current.nodeId === nodeId &&
		current.kind === "anchor"
			? anchorIndicesFromSub(shape, current)
			: [];
	if (!additive && existing.includes(index) && existing.length > 1) {
		return {
			nodeId,
			kind: "anchor",
			index,
			indices: existing,
		};
	}
	if (!additive) {
		return { nodeId, kind: "anchor", index };
	}
	const next = new Set(existing);
	if (next.has(index)) next.delete(index);
	else next.add(index);
	const indices = cleanAnchorIndices(shape, [...next]);
	if (indices.length === 0) return null;
	const primary = indices.includes(index) ? index : (indices.at(-1) ?? index);
	return {
		nodeId,
		kind: "anchor",
		index: primary,
		...(indices.length > 1 ? { indices } : {}),
	};
};

const movedAnchors = (
	shape: AeShape,
	indices: readonly number[],
	delta: Vec,
): AeShape => {
	let next = shape;
	for (const index of indices) {
		const vertex = shape.vertices[index];
		if (!vertex) continue;
		next = moveAnchor(next, index, {
			x: vertex[0] + delta.x,
			y: vertex[1] + delta.y,
		});
	}
	return next;
};

const artboardDeltaToLocalDelta = (
	matrix: Matrix2D,
	delta: { readonly dx: number; readonly dy: number },
): Vec => {
	const origin = applyInverseMatrix(matrix, { x: 0, y: 0 });
	const moved = applyInverseMatrix(matrix, { x: delta.dx, y: delta.dy });
	return { x: moved.x - origin.x, y: moved.y - origin.y };
};

const nudgeSelectedAnchors = (
	api: HostApi,
	delta: { readonly dx: number; readonly dy: number },
	coalesceKey: string,
): boolean => {
	const sub = api.selection.sub;
	if (!isPathSubSelection(sub) || sub.kind !== "anchor") return false;
	if (!api.selection.nodeIds.includes(sub.nodeId)) return false;
	const node = findNode(api.getDoc(), sub.nodeId);
	const shape = node?.geometry.kind === "path" ? node.geometry.shape : null;
	if (!node || !shape) return false;
	const indices = anchorIndicesFromSub(shape, sub);
	if (indices.length === 0) return false;
	const matrix = worldMatrixForNode(api.getDoc(), node);
	const next = movedAnchors(
		shape,
		indices,
		artboardDeltaToLocalDelta(matrix, delta),
	);
	if (next === shape) return false;
	const store = useSceneStore.getState();
	store.beginTransaction(coalesceKey, NUDGE_LABEL);
	dispatchShape(node.id, next, coalesceKey, NUDGE_LABEL);
	store.commit();
	return true;
};

const selectedDirectNodesForNudge = (api: HostApi): readonly VectorNode[] => {
	const document = api.getDoc();
	return api.selection.nodeIds
		.map((nodeId) => directSelectableNode(document, nodeId))
		.filter((node): node is VectorNode => Boolean(node));
};

const nudgeSelectedDirectNodes = (
	api: HostApi,
	delta: { readonly dx: number; readonly dy: number },
	coalesceKey: string,
): boolean => {
	if (!api.apply) return false;
	const nodes = selectedDirectNodesForNudge(api);
	if (nodes.length === 0) return false;
	const snapshots = nodeMoveSnapshots(api, nodes);
	const store = useSceneStore.getState();
	store.beginTransaction(coalesceKey, NUDGE_LABEL);
	for (const snapshot of snapshots) {
		api.apply(snapshot.nodeId, {
			matrix: moveSnapshotByDelta(snapshot, delta.dx, delta.dy),
		});
	}
	store.commit();
	return true;
};

const pathNodeForSubSelection = (api: HostApi): VectorNode | null => {
	const sub = api.selection.sub;
	if (!isPathSubSelection(sub) || !api.selection.nodeIds.includes(sub.nodeId)) {
		return null;
	}
	const node = findNode(api.getDoc(), sub.nodeId);
	return node && node.geometry.kind === "path" ? node : null;
};

const activePathNode = (api: HostApi): VectorNode | null =>
	pathNodeForSubSelection(api) ?? selectedPathNode(api);

const deleteSelectedAnchor = (api: HostApi): boolean => {
	const sub = api.selection.sub;
	if (!isPathSubSelection(sub) || sub.kind !== "anchor") return false;
	const node = pathNodeForSubSelection(api);
	const shape = node?.geometry.kind === "path" ? node.geometry.shape : null;
	if (!node || !shape) return false;
	const indices = anchorIndicesFromSub(shape, sub);
	if (indices.length === 0) {
		api.setSubSelection(null);
		return true;
	}
	let next = shape;
	for (const index of [...indices].toReversed()) {
		const candidate = removeAnchor(next, index);
		if (candidate !== next) next = candidate;
	}
	if (next !== shape) {
		dispatchShapeAction(node.id, next, "delete-anchor", DELETE_LABEL);
	}
	api.setSubSelection({
		nodeId: node.id,
		kind: "anchor",
		index: Math.min(indices[0] ?? 0, next.vertices.length - 1),
	});
	return true;
};

const resetSelectedHandle = (api: HostApi): boolean => {
	const sub = api.selection.sub;
	if (!isPathSubSelection(sub) || sub.kind === "anchor") return false;
	const node = pathNodeForSubSelection(api);
	const shape = node?.geometry.kind === "path" ? node.geometry.shape : null;
	if (!node || !shape) return false;
	if (sub.index < 0 || sub.index >= shape.vertices.length) return false;
	const next = resetHandle(shape, sub.index, sub.kind);
	if (next !== shape) {
		dispatchShapeAction(node.id, next, "reset-handle", RESET_HANDLE_LABEL);
	}
	api.setSubSelection({
		nodeId: node.id,
		kind: "anchor",
		index: sub.index,
	});
	return true;
};

const togglePathClosed = (api: HostApi): boolean => {
	const node = activePathNode(api);
	const shape = node?.geometry.kind === "path" ? node.geometry.shape : null;
	if (!node || !shape) return false;
	const currentClosed = isPathClosed(shape);
	const next = setPathClosed(shape, !currentClosed);
	if (next.closed === currentClosed) return false;
	dispatchShapeAction(node.id, next, "toggle-closed", TOGGLE_CLOSED_LABEL);
	const sub = api.selection.sub;
	if (
		isPathSubSelection(sub) &&
		sub.nodeId === node.id &&
		sub.kind !== "anchor" &&
		!isVisiblePathHandle(next, sub.index, sub.kind)
	) {
		const index = Math.min(Math.max(0, sub.index), next.vertices.length - 1);
		api.setSubSelection({
			nodeId: node.id,
			kind: "anchor",
			index,
		});
	}
	return true;
};

const onPointerDown = (context: PointerContext, api: HostApi): void => {
	// Flush a transaction orphaned by a pointerup that never reached this handler
	// (tool switch mid-drag, pointercancel, or a second pointer) so the prior
	// gesture stays its own undo entry instead of swallowing the next edit.
	if (gesture?.transactionOpen) useSceneStore.getState().commit();
	gesture = null;
	const selectedNode = selectedPathNode(api);
	const selectedHit = selectedNode
		? pathHit(selectedNode, context.point, api)
		: null;
	const hitNode = hitPathNode(context, api);
	const hitNodeHit =
		hitNode && hitNode.id !== selectedNode?.id
			? pathHit(hitNode, context.point, api)
			: null;
	const hit =
		selectedHit && hasBezierHit(selectedHit)
			? selectedHit
			: hitNodeHit && hasBezierHit(hitNodeHit)
				? hitNodeHit
				: null;
	if (!hit) {
		const node = firstDirectSelectableHit(context, api);
		if (!node) {
			if (api.selection.sub) api.setSubSelection(null);
			return;
		}
		api.setSubSelection(null);
		if (context.event.shiftKey) {
			api.select(node.id, true);
			return;
		}
		if (!api.apply) return;
		const alreadySelected = api.selection.nodeIds.includes(node.id);
		const nodes = alreadySelected ? selectedDirectNodes(api, node.id) : [node];
		if (!alreadySelected) api.select(node.id, false);
		const snapshots = nodeMoveSnapshots(api, nodes);
		if (snapshots.length === 0) return;
		gestureSeq += 1;
		gesture = {
			kind: "node-move",
			snapshots,
			startPoint: context.point,
			coalesceKey: `direct-select:${node.id}:${gestureSeq}`,
			dragging: false,
			transactionOpen: false,
		};
		return;
	}
	if (hitNodeHit && hit.node.id === hitNodeHit.node.id) {
		api.select(hit.node.id, false);
	}
	const { node, matrix, target, projection } = hit;
	const shape = node.geometry.kind === "path" ? node.geometry.shape : null;
	if (!shape) return;

	if (!target && !projection) {
		api.setSubSelection(null);
		return;
	}

	let gestureSub: PathSub | null = null;
	if (target) {
		const sub =
			target.kind === "anchor"
				? toggledAnchorSelection(
						shape,
						api.selection.sub,
						node.id,
						target.index,
						context.event.shiftKey,
					)
				: { nodeId: node.id, kind: target.kind, index: target.index };
		api.setSubSelection(sub);
		if (!sub) return;
		gestureSub = sub;
	} else if (projection) {
		api.setSubSelection(null);
	}

	const startLocal = applyInverseMatrix(matrix, context.point);
	const anchorIndices =
		target?.kind === "anchor" && gestureSub
			? anchorIndicesFromSub(shape, gestureSub)
			: null;
	gestureSeq += 1;
	gesture = {
		kind: "path",
		nodeId: node.id,
		originalShape: shape,
		matrix,
		target,
		anchorIndices,
		projection,
		startPoint: context.point,
		startLocal,
		coalesceKey: `bezier:${node.id}:${gestureSeq}`,
		dragging: false,
		transactionOpen: false,
	};
};

const onPointerMove = (context: PointerContext, api: HostApi): void => {
	const current = gesture;
	if (!current) return;

	const movedArtboard = Math.hypot(
		context.point.x - current.startPoint.x,
		context.point.y - current.startPoint.y,
	);
	if (
		!current.dragging &&
		movedArtboard * screenScale(api) < DRAG_THRESHOLD_PX
	) {
		return;
	}
	if (!current.dragging) {
		current.dragging = true;
		useSceneStore
			.getState()
			.beginTransaction(
				current.coalesceKey,
				current.kind === "path" ? EDIT_LABEL : MOVE_NODE_LABEL,
			);
		current.transactionOpen = true;
	}

	if (current.kind === "node-move") {
		applyNodeMove(api, current, context.point);
		return;
	}
	if (!current.target && !current.projection) return;
	const local = applyInverseMatrix(current.matrix, context.point);
	const next = nextShapeForDrag(current, local, context.event.altKey);
	dispatchShape(current.nodeId, next, current.coalesceKey);
};

const onPointerUp = (_context: PointerContext, api: HostApi): void => {
	const current = gesture;
	gesture = null;
	if (!current) return;

	if (current.dragging) {
		if (current.transactionOpen) useSceneStore.getState().commit();
		return;
	}
	if (current.kind === "node-move") return;

	// A press without a drag keeps an anchor/handle selected; clicking a bare
	// segment inserts a new anchor at the projected point.
	if (current.target) {
		return;
	}
	if (current.projection) {
		const next = insertAnchor(
			current.originalShape,
			current.projection.segment,
			current.projection.t,
		);
		// Guard against a no-op insert (e.g. a split that collapsed onto an
		// endpoint): dispatching an equal-valued shape would still record an Immer
		// patch, polluting undo with a phantom entry and selecting a ghost anchor.
		if (next.vertices.length <= current.originalShape.vertices.length) return;
		dispatchShapeAction(current.nodeId, next, "insert-anchor", INSERT_LABEL);
		api.setSubSelection({
			nodeId: current.nodeId,
			kind: "anchor",
			index: current.projection.segment + 1,
		});
	}
};

const onKeyDown = (event: KeyboardEvent, api: HostApi): void => {
	if (gesture) return;
	if (event.metaKey || event.ctrlKey) return;
	const delta = nudgeDelta(event.key, event.shiftKey);
	if (delta) {
		const now = Date.now();
		if (now - lastNudgeAt > NUDGE_COALESCE_MS) nudgeSeq += 1;
		lastNudgeAt = now;
		const coalesceKey = `direct-select:nudge:${
			api.selection.primary ?? "multi"
		}:${nudgeSeq}`;
		if (
			nudgeSelectedAnchors(api, delta, coalesceKey) ||
			nudgeSelectedDirectNodes(api, delta, coalesceKey)
		) {
			event.preventDefault();
		}
		return;
	}
	if (event.key === "Backspace" || event.key === "Delete") {
		if (deleteSelectedAnchor(api) || resetSelectedHandle(api)) {
			event.preventDefault();
		}
		return;
	}
	if (event.key === "Enter" || event.key.toLowerCase() === "o") {
		if (togglePathClosed(api)) event.preventDefault();
	}
};

const onDeactivate = (_api: HostApi): void => {
	if (gesture?.transactionOpen) useSceneStore.getState().commit();
	gesture = null;
};

export const handler: BezierToolHandler = {
	id: "bezier-direct-select",
	tool: "direct-select",
	onPointerDown,
	onPointerMove,
	onPointerUp,
	onKeyDown,
	onDeactivate,
};
