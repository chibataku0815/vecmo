import {
	beginGestureTransaction,
	commitGestureTransaction,
	type GestureTransaction,
} from "@/entities/scene/model/gesture-transaction";
import {
	addStopAt,
	defaultLinearGradient,
	type GradientPaint,
	gradientStops,
	hydrateGradientStops,
	indexOfStop,
	paintLeadColor,
	removeStop,
	setRadialCenter,
	setRadialRadius,
	setStopOffset,
} from "@/entities/scene/model/gradient-edit";
import {
	createUpdateArtboardCommand,
	createUpdateNodeStyleCommand,
} from "@/entities/scene/model/node-commands";
import { getGeometryBounds } from "@/entities/scene/model/rendering";
import {
	findArtboardById,
	findNode,
	type NormalizedArtboard,
} from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import type {
	LinearGradientPaint,
	Paint,
	SceneDocument,
	Vec2,
	VectorNode,
} from "@/entities/scene/model/types";
import {
	type GradientPaintRole,
	useGradientEditorStore,
} from "../model/editor-store";
import {
	applyHandleDrag,
	artboardGradientHandleScene,
	artboardGradientStopPoints,
	distanceToAxis,
	draggableGradient,
	type GradientHandleId,
	gradientHandleScene,
	gradientStopPoints,
	hitGradientHandle,
	hitGradientStop,
	offsetForPoint,
	toNodeLocalPoint,
} from "../model/handles";

// Structural mirror of the host registry surface; features cannot import the
// widget-layer registry types, so the handler is typed against this local subset
// and the host passes a compatible superset.
type CanvasPoint = { readonly x: number; readonly y: number };

type PointerContext = {
	readonly point: CanvasPoint;
	readonly artboardId: string;
	readonly hitNodeId: string | null;
	readonly event: PointerEvent;
};

type GradientStopSub = {
	readonly nodeId: string;
	readonly kind: "gradient-stop";
	readonly role: "fills" | "strokes";
	readonly stopId: string;
};

// Mirrors the host's wider sub-selection union for reads; the handler only ever
// writes the gradient-stop variant.
type HostSubSelection =
	| GradientStopSub
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
		readonly selectedArtboardId: string | null;
	};
	readonly viewport: { readonly zoom: number };
	readonly select: (nodeId: string, additive?: boolean) => void;
	readonly selectArtboard: (artboardId: string | null) => void;
	readonly setSubSelection: (sub: GradientStopSub | null) => void;
};

type GradientToolHandler = {
	readonly id: string;
	readonly tool: "gradient";
	readonly onActivate: (api: HostApi) => void;
	readonly onPointerDown: (context: PointerContext, api: HostApi) => void;
	readonly onPointerMove: (context: PointerContext, api: HostApi) => void;
	readonly onPointerUp: (context: PointerContext, api: HostApi) => void;
	readonly onKeyDown: (event: KeyboardEvent, api: HostApi) => void;
	readonly onDeactivate: (api: HostApi) => void;
};

const HANDLE_HIT_PX = 9;
const STOP_HIT_PX = 9;
const ADD_HIT_PX = 7;
const DRAG_THRESHOLD_PX = 3;
const DELETE_DISTANCE_PX = 30;
const DOUBLE_CLICK_MS = 320;
const PERCENT = 100;
const RIGHT_ANGLE_STEPS = 8; // 360° / 45°
const EDIT_LABEL = "Edit gradient";
const ADD_LABEL = "Add gradient stop";
const DELETE_LABEL = "Delete gradient stop";
const DEFINE_LABEL = "Set gradient direction";

type NodeGradientTarget = {
	readonly kind: "node";
	readonly node: VectorNode;
	readonly role: GradientPaintRole;
};

type ArtboardGradientTarget = {
	readonly kind: "artboard";
	readonly artboard: NormalizedArtboard;
	readonly role: "fills";
};

type GradientTarget = NodeGradientTarget | ArtboardGradientTarget;

type GradientTargetRef =
	| {
			readonly kind: "node";
			readonly nodeId: string;
			readonly role: GradientPaintRole;
	  }
	| {
			readonly kind: "artboard";
			readonly artboardId: string;
			readonly role: "fills";
	  };

type GradientGesture =
	| {
			readonly kind: "endpoint";
			readonly target: GradientTargetRef;
			readonly handleId: GradientHandleId;
			readonly coincidentStopId: string | null;
			readonly start: CanvasPoint;
			dragging: boolean;
			transaction: GestureTransaction | null;
	  }
	| {
			readonly kind: "stop";
			readonly target: GradientTargetRef;
			readonly stopId: string;
			readonly start: CanvasPoint;
			dragging: boolean;
			transaction: GestureTransaction | null;
	  }
	| {
			readonly kind: "define";
			readonly target: GradientTargetRef;
			readonly start: CanvasPoint;
			dragging: boolean;
			transaction: GestureTransaction | null;
	  };

let gesture: GradientGesture | null = null;
let lastClick: {
	readonly targetKey: string;
	readonly stopId: string;
	readonly time: number;
} | null = null;

const screenScale = (api: HostApi): number =>
	Math.max(api.viewport.zoom / PERCENT, 0.001);

const currentRole = (): GradientPaintRole =>
	useGradientEditorStore.getState().targetRole;

const flushOrphanedTransaction = (): void => {
	if (gesture?.transaction) commitGestureTransaction(gesture.transaction);
};

const setCursor = (event: PointerEvent, cursor: string): void => {
	if (typeof Element === "undefined" || typeof SVGElement === "undefined") {
		return;
	}
	const target = event.target;
	if (!(target instanceof Element)) return;
	const svg = target.closest("svg");
	if (svg instanceof SVGElement) svg.style.cursor = cursor;
};

const targetRef = (target: GradientTarget): GradientTargetRef =>
	target.kind === "node"
		? { kind: "node", nodeId: target.node.id, role: target.role }
		: { kind: "artboard", artboardId: target.artboard.id, role: "fills" };

const targetId = (target: GradientTarget | GradientTargetRef): string =>
	target.kind === "node"
		? "node" in target
			? target.node.id
			: target.nodeId
		: "artboard" in target
			? target.artboard.id
			: target.artboardId;

const targetKey = (target: GradientTarget | GradientTargetRef): string =>
	target.kind === "node"
		? `node:${targetId(target)}:${target.role}`
		: `artboard:${targetId(target)}:fills`;

const targetScope = (target: GradientTarget | GradientTargetRef): string =>
	`gradient:${targetKey(target)}`;

const artboardPrimaryPaint = (
	artboard: NormalizedArtboard,
): GradientPaint | null => {
	const paint = artboard.fills?.[0];
	if (!paint) return null;
	if (paint.kind !== "linear-gradient" && paint.kind !== "radial-gradient") {
		return null;
	}
	if (paint.transform) return null;
	return paint;
};

const primaryGradientTarget = (api: HostApi): GradientTarget | null => {
	const id = api.selection.primary ?? api.selection.nodeIds[0];
	if (id) {
		const node = findNode(api.getDoc(), id);
		if (node) {
			const role = currentRole();
			if (draggableGradient(node, role)) return { kind: "node", node, role };
			const sub = api.selection.sub;
			if (
				sub?.kind === "gradient-stop" &&
				sub.nodeId === node.id &&
				draggableGradient(node, sub.role)
			) {
				return { kind: "node", node, role: sub.role };
			}
		}
	}
	const artboard = findArtboardById(
		api.getDoc(),
		api.selection.selectedArtboardId,
	);
	if (artboard && artboardPrimaryPaint(artboard)) {
		return { kind: "artboard", artboard, role: "fills" };
	}
	return null;
};

const primaryPaints = (target: GradientTarget): readonly Paint[] | undefined =>
	target.kind === "node"
		? target.role === "fills"
			? target.node.style.fills
			: target.node.style.strokes
		: target.artboard.fills;

const paintRolePatch = (role: GradientPaintRole, paints: readonly Paint[]) =>
	role === "fills" ? { fills: paints } : { strokes: paints };

const targetFallbackColor = (target: GradientTarget): string =>
	target.kind === "node"
		? target.role === "fills"
			? target.node.style.fill
			: target.node.style.stroke
		: target.artboard.background;

const targetGradientPaint = (target: GradientTarget): GradientPaint | null =>
	target.kind === "node"
		? draggableGradient(target.node, target.role)
		: artboardPrimaryPaint(target.artboard);

const resolveTargetRef = (
	api: HostApi,
	ref: GradientTargetRef,
): GradientTarget | null => {
	if (ref.kind === "node") {
		const node = findNode(api.getDoc(), ref.nodeId);
		return node ? { kind: "node", node, role: ref.role } : null;
	}
	const artboard = findArtboardById(api.getDoc(), ref.artboardId);
	return artboard ? { kind: "artboard", artboard, role: "fills" } : null;
};

const gradientHandleSceneForTarget = (
	target: GradientTarget,
	paint: GradientPaint,
) =>
	target.kind === "node"
		? gradientHandleScene(target.node, paint)
		: artboardGradientHandleScene(paint);

const gradientStopPointsForTarget = (
	target: GradientTarget,
	paint: GradientPaint,
) =>
	target.kind === "node"
		? gradientStopPoints(target.node, paint)
		: artboardGradientStopPoints(paint);

/** Writes the target paint stack with `paint` as primary, preserving tail paints. */
const applyPrimaryPaint = (
	target: GradientTarget,
	paint: GradientPaint,
): void => {
	const tail = primaryPaints(target)?.slice(1) ?? [];
	if (target.kind === "node") {
		useSceneStore
			.getState()
			.apply(
				createUpdateNodeStyleCommand(
					target.node.id,
					paintRolePatch(target.role, [paint, ...tail]),
					{ preservesPaintIndices: true },
				),
			);
		return;
	}
	useSceneStore.getState().apply(
		createUpdateArtboardCommand(target.artboard.id, {
			background: paintLeadColor(paint, target.artboard.background),
			fills: [paint, ...tail],
		}),
	);
};

/**
 * Persists stable stop ids onto a legacy/id-less gradient before the tool starts
 * tracking a stop by id. Returns the hydrated paint; for already-authored gradients
 * (ids present) this is a no-op and writes nothing.
 */
const ensureHydrated = (
	target: GradientTarget,
	paint: GradientPaint,
): GradientPaint => {
	const hydrated = hydrateGradientStops(paint);
	if (hydrated !== paint) applyPrimaryPaint(target, hydrated);
	return hydrated;
};

/** The single primary selected node (no gradient filter) — the seed-on-activate target. */
const primarySelectedNode = (api: HostApi): VectorNode | null => {
	if (api.selection.nodeIds.length !== 1) return null;
	const id = api.selection.primary ?? api.selection.nodeIds[0];
	if (!id) return null;
	return findNode(api.getDoc(), id) ?? null;
};

const primarySelectedArtboard = (api: HostApi): NormalizedArtboard | null =>
	findArtboardById(api.getDoc(), api.selection.selectedArtboardId) ?? null;

/**
 * Seeds a default left→right linear gradient when the target role's primary paint
 * is solid or absent, so activating the gradient tool (or clicking a solid shape)
 * applies a gradient with live handles at once — the inverse of the inspector's
 * "switch paint to Linear → reveal handles" hook. The solid-or-absent predicate does
 * triple duty: it never overwrites an existing gradient/image/mesh paint (mesh is
 * the only keyframe-bearing paint, so re-seeding would orphan its track), it makes
 * re-activation on an already-seeded role a clean no-op (breaking the loop with the
 * inspector's two `setActiveTool("gradient")` callers), and it adds no phantom undo
 * entry. The seed is one `applyPrimaryPaint` = exactly one undo entry.
 */
const seedLinearIfSolid = (target: GradientTarget): void => {
	const primary = primaryPaints(target)?.[0];
	if (primary && primary.kind !== "solid") return;
	const bounds =
		target.kind === "node"
			? getGeometryBounds(target.node.geometry)
			: {
					x: 0,
					y: 0,
					width: target.artboard.width,
					height: target.artboard.height,
				};
	const seed = defaultLinearGradient(
		paintLeadColor(primary, targetFallbackColor(target)),
		bounds,
	);
	applyPrimaryPaint(target, seed);
};

/** The first/last stop id that visually coincides with an endpoint handle. */
const coincidentStopId = (
	paint: GradientPaint,
	handleId: GradientHandleId,
): string | null => {
	const sorted = gradientStops(paint);
	const atStart = handleId === "from" || handleId === "center";
	const stop = atStart ? sorted[0] : sorted.at(-1);
	return stop?.id ?? null;
};

const snapTo45 = (from: Vec2, to: Vec2): Vec2 => {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const length = Math.hypot(dx, dy);
	if (length === 0) return to;
	const step = (Math.PI * 2) / RIGHT_ANGLE_STEPS;
	const snapped = Math.round(Math.atan2(dy, dx) / step) * step;
	return {
		x: from.x + Math.cos(snapped) * length,
		y: from.y + Math.sin(snapped) * length,
	};
};

/** Rubber-bands a gradient's geometry from a drag's start to its current point. */
const redefineGeometry = (
	paint: GradientPaint,
	start: Vec2,
	current: Vec2,
	shift: boolean,
): GradientPaint => {
	if (paint.kind === "linear-gradient") {
		const to = shift ? snapTo45(start, current) : current;
		return { ...paint, from: start, to } satisfies LinearGradientPaint;
	}
	const radius = Math.hypot(current.x - start.x, current.y - start.y);
	return setRadialRadius(setRadialCenter(paint, start), radius);
};

const selectStop = (
	api: HostApi,
	target: GradientTarget | GradientTargetRef,
	stopId: string,
): void => {
	const editor = useGradientEditorStore.getState();
	editor.setTargetRole(target.role);
	if (target.kind === "node") {
		api.setSubSelection({
			nodeId: targetId(target),
			kind: "gradient-stop",
			role: target.role,
			stopId,
		});
		return;
	}
	const artboardId = targetId(target);
	api.selectArtboard(artboardId);
	useGradientEditorStore
		.getState()
		.selectStop({ targetKey: targetKey(target), stopId });
};

/** Resolves a click (no drag) into a stop selection, opening the editor on a double-click. */
const resolveClick = (
	api: HostApi,
	target: GradientTargetRef,
	stopId: string,
	time: number,
): void => {
	const editor = useGradientEditorStore.getState();
	const key = targetKey(target);
	const isDouble =
		lastClick?.targetKey === key &&
		lastClick.stopId === stopId &&
		time - lastClick.time <= DOUBLE_CLICK_MS;
	selectStop(api, target, stopId);
	if (isDouble) {
		editor.openStopEditor(stopId);
		lastClick = null;
		return;
	}
	editor.closeStopEditor();
	lastClick = { targetKey: key, stopId, time };
};

const beginDrag = (
	current: GradientGesture,
	scope: string,
	label: string,
): void => {
	current.dragging = true;
	if (!current.transaction) {
		current.transaction = beginGestureTransaction(scope, label);
	}
};

const onPointerDown = (context: PointerContext, api: HostApi): void => {
	flushOrphanedTransaction();
	gesture = null;

	const target = primaryGradientTarget(api);
	if (target && !(target.kind === "artboard" && context.hitNodeId)) {
		const rawPaint = targetGradientPaint(target);
		if (rawPaint) {
			const paint = ensureHydrated(target, rawPaint);
			const scene = gradientHandleSceneForTarget(target, paint);
			const ref = targetRef(target);
			const tolerance = HANDLE_HIT_PX / screenScale(api);

			const handleId = hitGradientHandle(
				scene.handles,
				context.point,
				tolerance,
			);
			if (handleId) {
				gesture = {
					kind: "endpoint",
					target: ref,
					handleId,
					coincidentStopId: coincidentStopId(paint, handleId),
					start: context.point,
					dragging: false,
					transaction: null,
				};
				setCursor(context.event, "grabbing");
				return;
			}

			const stopPoints = gradientStopPointsForTarget(target, paint);
			const hitStop = hitGradientStop(
				stopPoints,
				context.point,
				STOP_HIT_PX / screenScale(api),
			);
			if (hitStop?.id) {
				gesture = {
					kind: "stop",
					target: ref,
					stopId: hitStop.id,
					start: context.point,
					dragging: false,
					transaction: null,
				};
				setCursor(context.event, "grabbing");
				return;
			}

			if (
				distanceToAxis(scene.line, context.point) <=
				ADD_HIT_PX / screenScale(api)
			) {
				const offset = offsetForPoint(scene.line, context.point);
				const transaction = beginGestureTransaction(
					targetScope(target),
					ADD_LABEL,
				);
				const added = addStopAt(paint, offset);
				applyPrimaryPaint(target, added.paint);
				selectStop(api, target, added.stopId);
				useGradientEditorStore.getState().closeStopEditor();
				gesture = {
					kind: "stop",
					target: ref,
					stopId: added.stopId,
					start: context.point,
					dragging: false,
					transaction,
				};
				setCursor(context.event, "grabbing");
				return;
			}

			if (
				(target.kind === "node" && context.hitNodeId === target.node.id) ||
				(target.kind === "artboard" &&
					context.artboardId === target.artboard.id)
			) {
				gesture = {
					kind: "define",
					target: ref,
					start: context.point,
					dragging: false,
					transaction: null,
				};
				setCursor(context.event, "crosshair");
				return;
			}
		}
	}

	// Not on the active gradient: let the tool select the node under the cursor so
	// it is usable without switching back to the select tool first, and (on a plain
	// click) seed a gradient on a solid/empty target role so pick-tool-then-click
	// applies a gradient with handles — the other half of "the tool does nothing".
	if (context.hitNodeId) {
		api.select(context.hitNodeId, context.event.shiftKey);
		if (!context.event.shiftKey) {
			const hitNode = findNode(api.getDoc(), context.hitNodeId);
			if (hitNode) {
				seedLinearIfSolid({
					kind: "node",
					node: hitNode,
					role: currentRole(),
				});
			}
		}
		return;
	}
	if (!context.event.shiftKey) {
		const artboard = findArtboardById(api.getDoc(), context.artboardId);
		if (!artboard) return;
		const artboardTarget: ArtboardGradientTarget = {
			kind: "artboard",
			artboard,
			role: "fills",
		};
		api.selectArtboard(artboard.id);
		seedLinearIfSolid(artboardTarget);
	}
};

const onActivate = (api: HostApi): void => {
	const node = primarySelectedNode(api);
	if (node) {
		seedLinearIfSolid({ kind: "node", node, role: currentRole() });
		return;
	}
	const artboard = primarySelectedArtboard(api);
	if (artboard) {
		seedLinearIfSolid({ kind: "artboard", artboard, role: "fills" });
	}
};

const onPointerMove = (context: PointerContext, api: HostApi): void => {
	if (!gesture) {
		const target = primaryGradientTarget(api);
		const hoverTarget =
			target?.kind === "artboard" && context.hitNodeId ? null : target;
		setCursor(
			context.event,
			hoverTarget ? hoverCursor(hoverTarget, context.point, api) : "default",
		);
		return;
	}

	const current = gesture;
	const movedPx =
		Math.hypot(
			context.point.x - current.start.x,
			context.point.y - current.start.y,
		) * screenScale(api);
	if (!current.dragging && movedPx < DRAG_THRESHOLD_PX) return;

	const target = resolveTargetRef(api, current.target);
	if (!target) return;
	const paint = targetGradientPaint(target);
	if (!paint) return;

	if (current.kind === "endpoint") {
		beginDrag(
			current,
			`${targetScope(current.target)}:${current.handleId}`,
			EDIT_LABEL,
		);
		const localPoint =
			target.kind === "node"
				? toNodeLocalPoint(target.node, context.point)
				: context.point;
		if (!localPoint) return;
		applyPrimaryPaint(
			target,
			applyHandleDrag(paint, current.handleId, localPoint),
		);
		setCursor(context.event, "grabbing");
		return;
	}

	if (current.kind === "stop") {
		beginDrag(
			current,
			`${targetScope(current.target)}:${current.stopId}`,
			EDIT_LABEL,
		);
		const scene = gradientHandleSceneForTarget(target, paint);
		const offset = offsetForPoint(scene.line, context.point);
		const index = indexOfStop(paint, current.stopId);
		if (index < 0) return;
		applyPrimaryPaint(target, setStopOffset(paint, index, offset));
		const offAxis =
			distanceToAxis(scene.line, context.point) >
			DELETE_DISTANCE_PX / screenScale(api);
		setCursor(context.event, offAxis ? "not-allowed" : "grabbing");
		return;
	}

	// define
	beginDrag(current, `${targetScope(current.target)}:define`, DEFINE_LABEL);
	const start =
		target.kind === "node"
			? toNodeLocalPoint(target.node, current.start)
			: current.start;
	const now =
		target.kind === "node"
			? toNodeLocalPoint(target.node, context.point)
			: context.point;
	if (!start || !now) return;
	applyPrimaryPaint(
		target,
		redefineGeometry(paint, start, now, context.event.shiftKey),
	);
	setCursor(context.event, "crosshair");
};

const onPointerUp = (context: PointerContext, api: HostApi): void => {
	if (!gesture) return;
	const current = gesture;
	gesture = null;

	if (!current.dragging) {
		// A click, not a drag.
		if (current.transaction) commitGestureTransaction(current.transaction);
		if (current.kind === "endpoint" && current.coincidentStopId) {
			resolveClick(
				api,
				current.target,
				current.coincidentStopId,
				context.event.timeStamp,
			);
		} else if (current.kind === "stop") {
			resolveClick(
				api,
				current.target,
				current.stopId,
				context.event.timeStamp,
			);
		}
		return;
	}

	// A completed drag. A stop dragged far off the axis is deleted instead of moved.
	if (current.kind === "stop") {
		const target = resolveTargetRef(api, current.target);
		const paint = target ? targetGradientPaint(target) : null;
		if (target && paint) {
			const scene = gradientHandleSceneForTarget(target, paint);
			const offAxis =
				distanceToAxis(scene.line, context.point) >
				DELETE_DISTANCE_PX / screenScale(api);
			if (offAxis) {
				const removed = removeStop(paint, indexOfStop(paint, current.stopId));
				if (removed) {
					applyPrimaryPaint(target, removed);
					clearStopSelection(api, current.target, current.stopId);
				}
			}
		}
	}
	if (current.transaction) commitGestureTransaction(current.transaction);
};

function hoverCursor(
	target: GradientTarget,
	point: CanvasPoint,
	api: HostApi,
): string {
	const paint = targetGradientPaint(target);
	if (!paint) return "default";
	const scene = gradientHandleSceneForTarget(target, paint);
	const scale = screenScale(api);
	if (hitGradientHandle(scene.handles, point, HANDLE_HIT_PX / scale))
		return "grab";
	if (
		hitGradientStop(
			gradientStopPointsForTarget(target, paint),
			point,
			STOP_HIT_PX / scale,
		)
	) {
		return "grab";
	}
	if (distanceToAxis(scene.line, point) <= ADD_HIT_PX / scale) return "copy";
	return "default";
}

function clearStopSelection(
	api: HostApi,
	target: GradientTarget | GradientTargetRef,
	stopId: string,
): void {
	const editor = useGradientEditorStore.getState();
	if (editor.editingStopId === stopId) editor.closeStopEditor();
	if (target.kind === "node") {
		const sub = api.selection.sub;
		const nodeId = targetId(target);
		if (
			sub?.kind === "gradient-stop" &&
			sub.nodeId === nodeId &&
			sub.role === target.role &&
			sub.stopId === stopId
		) {
			api.setSubSelection(null);
		}
		return;
	}
	const selected = editor.selectedStop;
	if (selected?.targetKey === targetKey(target) && selected.stopId === stopId) {
		editor.selectStop(null);
	}
}

const onKeyDown = (event: KeyboardEvent, api: HostApi): void => {
	if (event.key === "Escape") {
		const editor = useGradientEditorStore.getState();
		if (editor.editingStopId) {
			editor.closeStopEditor();
			return;
		}
		if (api.selection.sub?.kind === "gradient-stop") api.setSubSelection(null);
		if (editor.selectedStop) editor.selectStop(null);
		return;
	}
	if (event.key !== "Delete" && event.key !== "Backspace") return;
	const sub = api.selection.sub;
	const editor = useGradientEditorStore.getState();
	const ref: GradientTargetRef | null =
		sub?.kind === "gradient-stop"
			? { kind: "node", nodeId: sub.nodeId, role: sub.role }
			: api.selection.selectedArtboardId
				? {
						kind: "artboard",
						artboardId: api.selection.selectedArtboardId,
						role: "fills",
					}
				: null;
	if (!ref) return;
	const stopId =
		ref.kind === "node"
			? (sub as GradientStopSub).stopId
			: editor.selectedStop?.targetKey === targetKey(ref)
				? editor.selectedStop.stopId
				: null;
	if (!stopId) return;
	const target = resolveTargetRef(api, ref);
	const paint = target ? targetGradientPaint(target) : null;
	if (!target || !paint) return;
	const removed = removeStop(paint, indexOfStop(paint, stopId));
	if (!removed) return;
	const transaction = beginGestureTransaction(targetScope(ref), DELETE_LABEL);
	applyPrimaryPaint(target, removed);
	clearStopSelection(api, ref, stopId);
	commitGestureTransaction(transaction);
	event.preventDefault();
};

export const handler: GradientToolHandler = {
	id: "gradient-handles",
	tool: "gradient",
	onActivate,
	onPointerDown,
	onPointerMove,
	onPointerUp,
	onKeyDown,
	onDeactivate: () => cancelActiveGesture(),
};

/**
 * Seals an in-flight gradient gesture immediately, committing its open transaction
 * as one recoverable undo entry. The host calls this on pointercancel / tool
 * deactivation, and the overlay on window `pointercancel`/`blur`, so an interrupted
 * gesture never strands a transaction (a stranded transaction folds later commands'
 * patches into it and corrupts cross-feature undo).
 */
export const cancelActiveGesture = (): void => {
	if (gesture?.transaction) commitGestureTransaction(gesture.transaction);
	gesture = null;
	// Reset double-click tracking too: a click that lands across an interruption
	// (blur / pointercancel / tool switch) should not register as a double-click.
	lastClick = null;
};
