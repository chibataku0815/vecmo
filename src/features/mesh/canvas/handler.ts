import {
	beginGestureTransaction,
	commitGestureTransaction,
	type GestureTransaction,
} from "@/entities/scene/model/gesture-transaction";
import {
	buildDefaultMeshForNode,
	insertMeshColumn,
	insertMeshRow,
	MESH_FILLABLE_KINDS,
	type MeshHandleDirection,
	type MeshPatchHit,
	meshHandleDirections,
	meshHandleRest,
	meshPatchAt,
	meshPointAt,
	moveMeshPoint,
	nearestMeshPoint,
	removeMeshPointLines,
	setMeshPointHandle,
} from "@/entities/scene/model/mesh-edit";
import { createUpdateNodeStyleCommand } from "@/entities/scene/model/node-commands";
import {
	applyMatrixToPoint,
	invertMatrix,
	matrixFromTransform,
} from "@/entities/scene/model/rendering";
import { findNode } from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import type {
	MeshGradientPaint,
	SceneDocument,
	Vec2,
	VectorNode,
} from "@/entities/scene/model/types";
import { useMeshEditorStore } from "../model/editor-store";

type CanvasPoint = { readonly x: number; readonly y: number };

type PointerContext = {
	readonly point: CanvasPoint;
	readonly hitNodeId: string | null;
	readonly event: PointerEvent;
};

type MeshNodeSub = {
	readonly nodeId: string;
	readonly kind: "mesh-node";
	readonly role: "fills" | "strokes";
	readonly row: number;
	readonly col: number;
};

// Mirrors the host's wider sub-selection union for reads; the handler only ever
// writes the mesh-node variant.
type HostSubSelection =
	| MeshNodeSub
	| {
			readonly nodeId: string;
			readonly kind: "gradient-stop";
			readonly role: "fills" | "strokes";
			readonly stopId: string;
	  }
	| {
			readonly nodeId: string;
			readonly kind: "anchor" | "handle-in" | "handle-out";
	  }
	| null;

type HostApi = {
	readonly getDoc: () => SceneDocument;
	readonly selection: {
		readonly nodeIds: readonly string[];
		readonly primary: string | null;
		readonly sub: HostSubSelection;
	};
	readonly viewport: { readonly zoom: number };
	readonly select: (nodeId: string, additive?: boolean) => void;
	readonly setSubSelection: (sub: MeshNodeSub | null) => void;
};

type MeshToolHandler = {
	readonly id: string;
	readonly tool: "mesh";
	readonly onPointerDown: (context: PointerContext, api: HostApi) => void;
	readonly onPointerMove: (context: PointerContext, api: HostApi) => void;
	readonly onPointerUp: (context: PointerContext, api: HostApi) => void;
	readonly onKeyDown: (event: KeyboardEvent, api: HostApi) => void;
	readonly onDeactivate: (api: HostApi) => void;
};

const POINT_HIT_PX = 11;
/** Alt-click delete uses a roomier hit zone than drag: deleting is a deliberate,
 *  destructive aim, so a near-miss should still hit the intended point rather than
 *  fall through and accidentally ADD one. */
const ALT_DELETE_TOLERANCE_FACTOR = 1.6;
const DRAG_THRESHOLD_PX = 3;
const DOUBLE_CLICK_MS = 320;
const PERCENT = 100;
const FILL_ROLE = "fills" as const;
const CREATE_LABEL = "Create mesh";
const EDIT_LABEL = "Edit mesh point";
const HANDLE_LABEL = "Edit mesh handle";

type MeshGesture =
	| {
			readonly kind: "point";
			readonly nodeId: string;
			readonly row: number;
			readonly col: number;
			readonly start: CanvasPoint;
			dragging: boolean;
			transaction: GestureTransaction | null;
	  }
	| {
			readonly kind: "handle";
			readonly nodeId: string;
			readonly row: number;
			readonly col: number;
			readonly direction: MeshHandleDirection;
			readonly start: CanvasPoint;
			dragging: boolean;
			transaction: GestureTransaction | null;
	  };

let gesture: MeshGesture | null = null;
let lastClick: { row: number; col: number; time: number } | null = null;

const screenScale = (api: HostApi): number =>
	Math.max(api.viewport.zoom / PERCENT, 0.001);

const flushOrphanedTransaction = (): void => {
	if (gesture?.transaction) commitGestureTransaction(gesture.transaction);
};

const setCursor = (event: PointerEvent, cursor: string): void => {
	if (typeof Element === "undefined" || typeof SVGElement === "undefined")
		return;
	const target = event.target;
	if (!(target instanceof Element)) return;
	const svg = target.closest("svg");
	if (svg instanceof SVGElement) svg.style.cursor = cursor;
};

/** The mesh paint on a node's primary fill, or `null` when the fill is not a mesh. */
const meshFillOf = (node: VectorNode): MeshGradientPaint | null => {
	const paint = node.style.fills?.[0];
	return paint?.kind === "mesh-gradient" ? paint : null;
};

/** Maps an artboard-local point into the node's local geometry space. */
const toNodeLocalPoint = (
	node: VectorNode,
	point: CanvasPoint,
): Vec2 | null => {
	const inverse = invertMatrix(matrixFromTransform(node.transform));
	if (!inverse) return null;
	return applyMatrixToPoint(inverse, point);
};

/**
 * Artboard→node-local length factor (`1/scale` for a uniformly scaled node), so a
 * screen/artboard-space hit tolerance can be compared against node-local distances
 * inside {@link nearestMeshPoint}. `sqrt(|det(inverse)|)` is the geometric-mean
 * scale; for non-uniform scale it is an isotropic approximation of the elliptical
 * true target, which is acceptable for a point hit zone. Returns 1 for a singular
 * (non-invertible) transform.
 */
const nodeLocalLengthFactor = (node: VectorNode): number => {
	const inverse = invertMatrix(matrixFromTransform(node.transform));
	if (!inverse) return 1;
	return Math.sqrt(Math.abs(inverse.a * inverse.d - inverse.b * inverse.c));
};

/** Mesh-point hit tolerance converted from screen px into the node's local space. */
const meshHitTolerance = (api: HostApi, node: VectorNode): number =>
	(POINT_HIT_PX / screenScale(api)) * nodeLocalLengthFactor(node);

const primaryMeshNode = (api: HostApi): VectorNode | null => {
	const id = api.selection.primary ?? api.selection.nodeIds[0];
	if (!id) return null;
	const node = findNode(api.getDoc(), id);
	if (!node) return null;
	return meshFillOf(node) ? node : null;
};

/** Writes the node's fill stack with `paint` primary, preserving tail paints. */
const applyMeshFill = (
	node: VectorNode,
	paint: MeshGradientPaint,
	coalesceKey?: string,
): void => {
	const tail = node.style.fills?.slice(1) ?? [];
	const command = createUpdateNodeStyleCommand(
		node.id,
		{ fills: [paint, ...tail] },
		{ preservesPaintIndices: true },
	);
	useSceneStore
		.getState()
		.apply(coalesceKey ? { ...command, coalesceKey } : command);
};

/**
 * Converts a fillable node to a default gradient mesh tonally seeded from its
 * current fill (see {@link buildDefaultMeshForNode}). The mesh shows an immediate
 * light→dark gradient so clicking a solid shape with the mesh tool produces a
 * visible result instead of looking like nothing happened. Wrapped in one
 * transaction so creation is a single undo entry.
 */
const createMeshOnNode = (node: VectorNode): void => {
	const mesh = buildDefaultMeshForNode(node);
	const transaction = beginGestureTransaction(`mesh:${node.id}`, CREATE_LABEL);
	applyMeshFill(node, mesh);
	commitGestureTransaction(transaction);
};

/**
 * Subdivides the mesh at a patch hit: inserts a row at the hit's vertical fraction
 * and a column at its horizontal fraction, so a new editable control point lands
 * under the cursor (Illustrator's "click a face to add a mesh line" — a `+`
 * intersection). Appearance-preserving (the new points sit on the existing
 * gradient) and a single undo; the new intersection point is left selected.
 */
const insertMeshLinesAt = (
	api: HostApi,
	node: VectorNode,
	paint: MeshGradientPaint,
	hit: MeshPatchHit,
): void => {
	const withRow = insertMeshRow(paint, hit.row, hit.v);
	const next = insertMeshColumn(withRow, hit.col, hit.u);
	applyMeshFill(node, next);
	selectPoint(api, node.id, hit.row + 1, hit.col + 1);
};

/**
 * Removes the row and/or column through a mesh point (Alt-click or Delete key).
 * Boundary lines are kept — removing them would shrink the mesh — so a corner
 * point is a no-op and an edge point drops only its interior axis. One undo;
 * clears the sub-selection. Returns whether anything was removed, so the keyboard
 * path can preventDefault only when it actually consumed the key.
 */
const removePointLines = (
	api: HostApi,
	node: VectorNode,
	paint: MeshGradientPaint,
	row: number,
	col: number,
): boolean => {
	const next = removeMeshPointLines(paint, row, col);
	if (next === paint) return false;
	applyMeshFill(node, next);
	api.setSubSelection(null);
	useMeshEditorStore.getState().closePointEditor();
	return true;
};

const selectPoint = (
	api: HostApi,
	nodeId: string,
	row: number,
	col: number,
): void => {
	api.setSubSelection({ nodeId, kind: "mesh-node", role: FILL_ROLE, row, col });
};

const resolveClick = (
	api: HostApi,
	nodeId: string,
	row: number,
	col: number,
	time: number,
): void => {
	const editor = useMeshEditorStore.getState();
	const isDouble =
		lastClick?.row === row &&
		lastClick.col === col &&
		time - lastClick.time <= DOUBLE_CLICK_MS;
	selectPoint(api, nodeId, row, col);
	if (isDouble) {
		editor.openPointEditor({ row, col });
		lastClick = null;
		return;
	}
	editor.closePointEditor();
	lastClick = { row, col, time };
};

/** The mesh point currently sub-selected on `nodeId`, or null. */
const selectedMeshPoint = (
	api: HostApi,
	nodeId: string,
): { readonly row: number; readonly col: number } | null => {
	const sub = api.selection.sub;
	return sub?.kind === "mesh-node" && sub.nodeId === nodeId
		? { row: sub.row, col: sub.col }
		: null;
};

/** Nearest tangent-handle direction of `(row,col)` within tolerance, or null. */
const hitMeshHandle = (
	paint: MeshGradientPaint,
	row: number,
	col: number,
	local: Vec2,
	tolerance: number,
): MeshHandleDirection | null => {
	let best: MeshHandleDirection | null = null;
	let bestDistSq = tolerance * tolerance;
	for (const direction of meshHandleDirections(paint, row, col)) {
		const rest = meshHandleRest(paint, row, col, direction);
		if (!rest) continue;
		const dx = rest.x - local.x;
		const dy = rest.y - local.y;
		const distSq = dx * dx + dy * dy;
		if (distSq <= bestDistSq) {
			bestDistSq = distSq;
			best = direction;
		}
	}
	return best;
};

const onPointerDown = (context: PointerContext, api: HostApi): void => {
	flushOrphanedTransaction();
	gesture = null;

	const node = primaryMeshNode(api);
	if (node) {
		const paint = meshFillOf(node);
		const local = toNodeLocalPoint(node, context.point);
		if (paint && local) {
			const tolerance = meshHitTolerance(api, node);
			// Alt = delete intent: target the nearest point with a roomier tolerance
			// and ALWAYS short-circuit — never fall through to handle-drag or face-
			// insert. The old flow only deleted on an exact point hit and otherwise
			// dropped into subdivide, so a near-miss Alt-click silently ADDED a point
			// when the user meant to remove one (a core reason deletion felt broken).
			if (context.event.altKey) {
				const target = nearestMeshPoint(
					paint,
					local,
					tolerance * ALT_DELETE_TOLERANCE_FACTOR,
				);
				if (target) removePointLines(api, node, paint, target.row, target.col);
				return;
			}
			// A selected point shows its tangent handles; those take hit priority since
			// they sit just off the point.
			const selected = selectedMeshPoint(api, node.id);
			if (selected) {
				const direction = hitMeshHandle(
					paint,
					selected.row,
					selected.col,
					local,
					tolerance,
				);
				if (direction) {
					gesture = {
						kind: "handle",
						nodeId: node.id,
						row: selected.row,
						col: selected.col,
						direction,
						start: context.point,
						dragging: false,
						transaction: null,
					};
					setCursor(context.event, "grabbing");
					return;
				}
			}
			const hit = nearestMeshPoint(paint, local, tolerance);
			if (hit) {
				gesture = {
					kind: "point",
					nodeId: node.id,
					row: hit.row,
					col: hit.col,
					start: context.point,
					dragging: false,
					transaction: null,
				};
				setCursor(context.event, "grabbing");
				return;
			}
			// Inside the mesh but not on a point/handle: subdivide here, adding a row
			// and column whose intersection lands under the cursor.
			const patchHit = meshPatchAt(paint, local);
			if (patchHit) {
				insertMeshLinesAt(api, node, paint, patchHit);
				return;
			}
		}
	}

	// Not on a mesh point: select the node under the cursor, and create a mesh on
	// it if it is fillable and has none yet.
	if (context.hitNodeId) {
		const target = findNode(api.getDoc(), context.hitNodeId);
		api.select(context.hitNodeId, context.event.shiftKey);
		if (
			target &&
			!meshFillOf(target) &&
			MESH_FILLABLE_KINDS.has(target.geometry.kind)
		) {
			createMeshOnNode(target);
		}
	}
};

const onPointerMove = (context: PointerContext, api: HostApi): void => {
	if (!gesture) {
		const node = primaryMeshNode(api);
		const paint = node ? meshFillOf(node) : null;
		const local = node ? toNodeLocalPoint(node, context.point) : null;
		if (paint && local && node) {
			const tolerance = meshHitTolerance(api, node);
			const selected = selectedMeshPoint(api, node.id);
			const overHandle = selected
				? hitMeshHandle(paint, selected.row, selected.col, local, tolerance)
				: null;
			const overPoint = overHandle
				? null
				: nearestMeshPoint(paint, local, tolerance);
			// Over a point/handle → grab it; otherwise inside the mesh → a crosshair
			// hints that clicking adds a mesh line (subdivides) at that spot.
			const overFace =
				!overHandle && !overPoint && meshPatchAt(paint, local) !== null;
			setCursor(
				context.event,
				overHandle || overPoint ? "grab" : overFace ? "crosshair" : "default",
			);
		} else {
			setCursor(context.event, "default");
		}
		return;
	}

	const current = gesture;
	const movedPx =
		Math.hypot(
			context.point.x - current.start.x,
			context.point.y - current.start.y,
		) * screenScale(api);
	if (!current.dragging && movedPx < DRAG_THRESHOLD_PX) return;

	const node = findNode(api.getDoc(), current.nodeId);
	const paint = node ? meshFillOf(node) : null;
	if (!node || !paint) return;
	const local = toNodeLocalPoint(node, context.point);
	if (!local) return;

	if (!current.dragging) {
		current.dragging = true;
		const scope =
			current.kind === "handle"
				? `mesh:${current.nodeId}:${current.row}:${current.col}:${current.direction}`
				: `mesh:${current.nodeId}:${current.row}:${current.col}`;
		current.transaction = beginGestureTransaction(
			scope,
			current.kind === "handle" ? HANDLE_LABEL : EDIT_LABEL,
		);
		useMeshEditorStore.getState().closePointEditor();
	}
	if (current.kind === "handle") {
		const anchor = meshPointAt(paint, current.row, current.col);
		if (!anchor) return;
		applyMeshFill(
			node,
			setMeshPointHandle(paint, current.row, current.col, current.direction, {
				x: local.x - anchor.point.x,
				y: local.y - anchor.point.y,
			}),
		);
	} else {
		applyMeshFill(node, moveMeshPoint(paint, current.row, current.col, local));
	}
	setCursor(context.event, "grabbing");
};

const onPointerUp = (context: PointerContext, api: HostApi): void => {
	if (!gesture) return;
	const current = gesture;
	gesture = null;

	if (!current.dragging) {
		// A click (no drag): only a point click changes selection / opens the editor;
		// a handle click is a no-op. resolveClick handles single- and double-click.
		if (current.kind === "point") {
			resolveClick(
				api,
				current.nodeId,
				current.row,
				current.col,
				context.event.timeStamp,
			);
		}
		return;
	}
	if (current.transaction) commitGestureTransaction(current.transaction);
};

const clearPointSelection = (api: HostApi): void => {
	useMeshEditorStore.getState().closePointEditor();
	if (api.selection.sub?.kind === "mesh-node") api.setSubSelection(null);
};

const onKeyDown = (event: KeyboardEvent, api: HostApi): void => {
	if (event.key === "Escape") {
		const editor = useMeshEditorStore.getState();
		if (editor.editingPoint) {
			editor.closePointEditor();
			return;
		}
		if (api.selection.sub?.kind === "mesh-node") clearPointSelection(api);
		return;
	}
	// Delete/Backspace removes the selected mesh point's lines (the discoverable
	// inverse of click-a-face-to-add). Cmd/Ctrl variants are left to the global
	// shortcut layer. preventDefault only on a real removal so a corner point
	// (nothing removable) doesn't silently swallow the key.
	if (event.key !== "Delete" && event.key !== "Backspace") return;
	if (event.metaKey || event.ctrlKey) return;
	const node = primaryMeshNode(api);
	const paint = node ? meshFillOf(node) : null;
	const selected = node ? selectedMeshPoint(api, node.id) : null;
	if (!node || !paint || !selected) return;
	if (removePointLines(api, node, paint, selected.row, selected.col)) {
		event.preventDefault();
	}
};

export const handler: MeshToolHandler = {
	id: "mesh-handles",
	tool: "mesh",
	onPointerDown,
	onPointerMove,
	onPointerUp,
	onKeyDown,
	onDeactivate: () => cancelActiveGesture(),
};

/**
 * Seals an in-flight mesh gesture immediately, committing its open transaction as
 * one recoverable undo entry. The host calls this on pointercancel / tool
 * deactivation, and the overlay on window `pointercancel`/`blur`, so an interrupted
 * gesture never strands a transaction (a stranded transaction folds later commands'
 * patches into it and corrupts cross-feature undo).
 */
export const cancelActiveGesture = (): void => {
	if (gesture?.transaction) commitGestureTransaction(gesture.transaction);
	gesture = null;
	lastClick = null;
	// Tool deactivation is a stated close trigger for the point editor; without
	// this the popover survives a keyboard tool-switch and re-opens on return.
	useMeshEditorStore.getState().closePointEditor();
};
