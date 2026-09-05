import {
	abortGestureTransaction,
	beginGestureTransaction,
	commitGestureTransaction,
	type GestureTransaction,
} from "@/entities/scene/model/gesture-transaction";
import { findNode } from "@/entities/scene/model/selectors";
import type { SceneDocument, VectorNode } from "@/entities/scene/model/types";
import {
	resolveTextureParticleLinearField,
	textureParticleLinearFieldEffective,
} from "@/shared/vec-core";
import {
	distanceToNoiseGradientAxis,
	hitNoiseGradientAxisHandle,
	hitNoiseGradientFieldMeshPoint,
	type NoiseGradientAxisHandleId,
	noiseGradientAxisScene,
	noiseGradientExtentForPoint,
	noiseGradientFieldMeshPatchAt,
	noiseGradientFieldMeshPointForArtboardPoint,
	noiseGradientFieldMeshScene,
	noiseGradientLinearFieldPointForArtboardPoint,
} from "../model/axis";
import {
	commitNoiseGradientToolExtent,
	commitNoiseGradientToolFieldMeshInsert,
	commitNoiseGradientToolFieldMeshPoint,
	commitNoiseGradientToolFieldMeshRemove,
	commitNoiseGradientToolLinearFieldEndpoint,
	commitNoiseGradientToolLinearFieldEndpoints,
	commitNoiseGradientToolLinearFieldFit,
	commitNoiseGradientToolLinearFieldMove,
	type NoiseGradientToolControlState,
	noiseGradientToolControlState,
} from "../model/tool-controls";

type CanvasPoint = { readonly x: number; readonly y: number };

type PointerContext = {
	readonly point: CanvasPoint;
	readonly hitNodeId: string | null;
	readonly event: PointerEvent;
};

type HostApi = {
	readonly getDoc: () => SceneDocument;
	readonly selection: {
		readonly nodeIds: readonly string[];
		readonly primary: string | null;
		readonly sub: HostSubSelection;
	};
	readonly viewport: { readonly zoom: number };
	readonly select: (nodeId: string, additive?: boolean) => void;
	readonly setSubSelection: (sub: NoiseFieldMeshSub | null) => void;
};

type NoiseGradientToolHandler = {
	readonly id: string;
	readonly tool: "noise-gradient";
	readonly onActivate: (api: HostApi) => void;
	readonly onPointerDown: (context: PointerContext, api: HostApi) => void;
	readonly onPointerMove: (context: PointerContext, api: HostApi) => void;
	readonly onPointerUp: (context: PointerContext, api: HostApi) => void;
	readonly onKeyDown: (event: KeyboardEvent, api: HostApi) => void;
	readonly onDeactivate: () => void;
};

type NoiseFieldMeshSub = {
	readonly nodeId: string;
	readonly kind: "noise-field-mesh-point";
	readonly row: number;
	readonly col: number;
};

type HostSubSelection =
	| NoiseFieldMeshSub
	| {
			readonly nodeId: string;
			readonly kind: "mesh-node" | "gradient-stop";
	  }
	| {
			readonly nodeId: string;
			readonly kind: "anchor" | "handle-in" | "handle-out";
	  }
	| null;

const HANDLE_HIT_PX = 10;
const FIELD_POINT_HIT_PX = 11;
const FIELD_ALT_DELETE_TOLERANCE_FACTOR = 1.6;
const AXIS_HIT_PX = 7;
const DRAG_THRESHOLD_PX = 3;
const PERCENT = 100;
const EDIT_LABEL = "Edit Noise Gradient field";
const EXTENT_LABEL = "Edit Noise Gradient extent";
const FIELD_POINT_LABEL = "Edit Noise Gradient mesh point";

type NoiseGradientGesture = {
	readonly kind: "angle" | "extent" | "field-mesh-point" | "linear-field";
	readonly nodeId: string;
	readonly angleAnchor?: "from" | "to";
	readonly row?: number;
	readonly col?: number;
	readonly start: CanvasPoint;
	linearPoint?: CanvasPoint;
	dragging: boolean;
	transaction: GestureTransaction | null;
};

let gesture: NoiseGradientGesture | null = null;

const screenScale = (api: HostApi): number =>
	Math.max(api.viewport.zoom / PERCENT, 0.001);

const setCursor = (event: PointerEvent, cursor: string): void => {
	if (typeof Element === "undefined" || typeof SVGElement === "undefined") {
		return;
	}
	const target = event.target;
	if (!(target instanceof Element)) return;
	const svg = target.closest("svg");
	if (svg instanceof SVGElement) svg.style.cursor = cursor;
};

const selectedPrimaryNode = (api: HostApi): VectorNode | null => {
	const id = api.selection.primary ?? api.selection.nodeIds[0];
	if (!id) return null;
	const node = findNode(api.getDoc(), id);
	if (!node || node.locked) return null;
	return node;
};

const selectedPrimaryNoiseGradient = (
	api: HostApi,
): {
	readonly node: VectorNode;
	readonly state: NoiseGradientToolControlState;
} | null => {
	const node = selectedPrimaryNode(api);
	if (!node) return null;
	const state = noiseGradientToolControlState(api.getDoc(), {
		nodeIds: [node.id],
		primary: node.id,
	});
	return state?.editable ? { node, state } : null;
};

const flushOrphanedTransaction = (): void => {
	if (gesture?.transaction) commitGestureTransaction(gesture.transaction);
};

const beginDrag = (current: NoiseGradientGesture): void => {
	current.dragging = true;
	if (!current.transaction) {
		current.transaction = beginGestureTransaction(
			`noise-gradient:${current.nodeId}:${current.kind}`,
			current.kind === "extent"
				? EXTENT_LABEL
				: current.kind === "field-mesh-point"
					? FIELD_POINT_LABEL
					: EDIT_LABEL,
		);
	}
};

const fieldPointHitTolerance = (api: HostApi): number =>
	FIELD_POINT_HIT_PX / screenScale(api);

const selectFieldMeshPoint = (
	api: HostApi,
	nodeId: string,
	row: number,
	col: number,
): void => {
	api.setSubSelection({
		nodeId,
		kind: "noise-field-mesh-point",
		row,
		col,
	});
};

const hitOnAxis = (
	axis: NonNullable<ReturnType<typeof noiseGradientAxisScene>>,
	point: CanvasPoint,
	api: HostApi,
): NoiseGradientAxisHandleId | "field" | null => {
	const scale = screenScale(api);
	const handle = hitNoiseGradientAxisHandle(axis, point, HANDLE_HIT_PX / scale);
	if (handle === "extent") return handle;
	if (!axis.fixedAngle) return null;
	if (handle === "from" || handle === "to") return handle;
	if (handle === "center") return "field";
	if (distanceToNoiseGradientAxis(axis, point) <= AXIS_HIT_PX / scale) {
		return "field";
	}
	return null;
};

const snapPointAroundAnchor = (
	anchor: CanvasPoint,
	point: CanvasPoint,
): CanvasPoint => {
	const dx = point.x - anchor.x;
	const dy = point.y - anchor.y;
	const length = Math.hypot(dx, dy);
	if (length <= 1e-6) return point;
	const step = (Math.PI * 2) / 8;
	const angle = Math.round(Math.atan2(dy, dx) / step) * step;
	return {
		x: anchor.x + Math.cos(angle) * length,
		y: anchor.y + Math.sin(angle) * length,
	};
};

const snapLinearEndpoint = (
	state: NoiseGradientToolControlState,
	endpoint: "from" | "to",
	point: CanvasPoint,
): CanvasPoint => {
	const field = textureParticleLinearFieldEffective(
		resolveTextureParticleLinearField(state.texture),
	);
	const anchor =
		endpoint === "from"
			? { x: field.x2, y: field.y2 }
			: { x: field.x1, y: field.y1 };
	return snapPointAroundAnchor(anchor, point);
};

const symmetricLinearEndpoints = (
	state: NoiseGradientToolControlState,
	endpoint: "from" | "to",
	point: CanvasPoint,
	snap: boolean,
): {
	readonly from: CanvasPoint;
	readonly to: CanvasPoint;
} => {
	const field = textureParticleLinearFieldEffective(
		resolveTextureParticleLinearField(state.texture),
	);
	const center = {
		x: (field.x1 + field.x2) / 2,
		y: (field.y1 + field.y2) / 2,
	};
	const target = snap ? snapPointAroundAnchor(center, point) : point;
	const opposite = {
		x: center.x * 2 - target.x,
		y: center.y * 2 - target.y,
	};
	return endpoint === "from"
		? { from: target, to: opposite }
		: { from: opposite, to: target };
};

const onActivate = (_api: HostApi): void => undefined;

const onPointerDown = (context: PointerContext, api: HostApi): void => {
	flushOrphanedTransaction();
	gesture = null;

	const selected = selectedPrimaryNoiseGradient(api);
	const node = selected?.node ?? null;
	const fieldMesh =
		node && selected?.state.fieldMode === "mesh"
			? noiseGradientFieldMeshScene(node, {
					preview: true,
					texture: selected.state.texture,
				})
			: null;
	if (node && fieldMesh) {
		const tolerance = fieldPointHitTolerance(api);
		const hitPoint = hitNoiseGradientFieldMeshPoint(
			fieldMesh,
			context.point,
			context.event.altKey
				? tolerance * FIELD_ALT_DELETE_TOLERANCE_FACTOR
				: tolerance,
		);
		if (context.event.altKey) {
			if (hitPoint) {
				commitNoiseGradientToolFieldMeshRemove(
					node.id,
					hitPoint.row,
					hitPoint.col,
				);
				api.setSubSelection(null);
			}
			return;
		}
		if (hitPoint) {
			selectFieldMeshPoint(api, node.id, hitPoint.row, hitPoint.col);
			gesture = {
				kind: "field-mesh-point",
				nodeId: node.id,
				row: hitPoint.row,
				col: hitPoint.col,
				start: context.point,
				dragging: false,
				transaction: null,
			};
			setCursor(context.event, "grabbing");
			return;
		}
		const patchHit = noiseGradientFieldMeshPatchAt(
			fieldMesh,
			node,
			context.point,
		);
		if (patchHit) {
			if (
				commitNoiseGradientToolFieldMeshInsert(
					node.id,
					patchHit.row,
					patchHit.col,
					patchHit.u,
					patchHit.v,
				)
			) {
				selectFieldMeshPoint(api, node.id, patchHit.row + 1, patchHit.col + 1);
			}
			return;
		}
	}
	const axis = selected
		? noiseGradientAxisScene(selected.node, {
				preview: true,
				texture: selected.state.texture,
			})
		: null;
	const hit = axis ? hitOnAxis(axis, context.point, api) : null;
	if (node && hit === "extent") {
		gesture = {
			kind: "extent",
			nodeId: node.id,
			start: context.point,
			dragging: false,
			transaction: null,
		};
		setCursor(context.event, "grabbing");
		return;
	}
	if (node && axis?.fixedAngle && (hit === "from" || hit === "to")) {
		gesture = {
			kind: "angle",
			nodeId: node.id,
			angleAnchor: hit,
			start: context.point,
			dragging: false,
			transaction: null,
		};
		setCursor(context.event, "grabbing");
		return;
	}
	if (node && axis?.fixedAngle && hit === "field") {
		if (context.event.detail >= 2) {
			commitNoiseGradientToolLinearFieldFit(node.id);
			setCursor(context.event, "move");
			return;
		}
		const linearPoint = noiseGradientLinearFieldPointForArtboardPoint(
			node,
			context.point,
		);
		if (!linearPoint) return;
		gesture = {
			kind: "linear-field",
			nodeId: node.id,
			start: context.point,
			linearPoint,
			dragging: false,
			transaction: null,
		};
		setCursor(context.event, "move");
		return;
	}

	if (!context.hitNodeId) return;
	api.select(context.hitNodeId, context.event.shiftKey);
};

const onPointerMove = (context: PointerContext, api: HostApi): void => {
	if (!gesture) {
		const node = selectedPrimaryNode(api);
		if (!node) {
			setCursor(context.event, context.hitNodeId ? "crosshair" : "default");
			return;
		}
		const state = noiseGradientToolControlState(api.getDoc(), {
			nodeIds: [node.id],
			primary: node.id,
		});
		if (state?.editable && state.fieldMode === "mesh") {
			const fieldMesh = noiseGradientFieldMeshScene(node, {
				preview: true,
				texture: state.texture,
			});
			const hitPoint = fieldMesh
				? hitNoiseGradientFieldMeshPoint(
						fieldMesh,
						context.point,
						fieldPointHitTolerance(api),
					)
				: null;
			const patchHit =
				fieldMesh && !hitPoint
					? noiseGradientFieldMeshPatchAt(fieldMesh, node, context.point)
					: null;
			const axis = noiseGradientAxisScene(node, {
				preview: true,
				texture: state.texture,
			});
			const hit = axis ? hitOnAxis(axis, context.point, api) : null;
			setCursor(
				context.event,
				hitPoint || hit === "extent"
					? "grab"
					: hit === "field"
						? "move"
						: patchHit
							? "crosshair"
							: "default",
			);
			return;
		}
		const axis = state?.editable
			? noiseGradientAxisScene(node, { preview: true, texture: state.texture })
			: null;
		const hit = axis ? hitOnAxis(axis, context.point, api) : null;
		setCursor(
			context.event,
			hit === "extent"
				? "grab"
				: hit === "field"
					? "move"
					: axis?.fixedAngle && (hit === "from" || hit === "to")
						? "grab"
						: "default",
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

	const node = findNode(api.getDoc(), current.nodeId);
	if (!node || node.locked) return;
	const state = noiseGradientToolControlState(api.getDoc(), {
		nodeIds: [node.id],
		primary: node.id,
	});
	if (!state?.editable) return;
	if (current.kind === "field-mesh-point") {
		const row = current.row;
		const col = current.col;
		if (row === undefined || col === undefined) return;
		const nextPoint = noiseGradientFieldMeshPointForArtboardPoint(
			node,
			context.point,
		);
		if (!nextPoint) return;
		beginDrag(current);
		commitNoiseGradientToolFieldMeshPoint(node.id, row, col, nextPoint);
		setCursor(context.event, "grabbing");
		return;
	}
	if (current.kind === "extent") {
		const axis = noiseGradientAxisScene(node, {
			preview: true,
			texture: state.texture,
		});
		if (!axis) return;
		beginDrag(current);
		commitNoiseGradientToolExtent(
			node.id,
			noiseGradientExtentForPoint(axis, context.point),
		);
		setCursor(context.event, "grabbing");
		return;
	}
	if (current.kind === "linear-field") {
		const previousPoint = current.linearPoint;
		const nextPoint = noiseGradientLinearFieldPointForArtboardPoint(
			node,
			context.point,
		);
		if (!previousPoint || !nextPoint) return;
		beginDrag(current);
		commitNoiseGradientToolLinearFieldMove(node.id, {
			x: nextPoint.x - previousPoint.x,
			y: nextPoint.y - previousPoint.y,
		});
		current.linearPoint = nextPoint;
		setCursor(context.event, "move");
		return;
	}
	const endpoint = current.angleAnchor;
	if (!endpoint) return;
	const linearPoint = noiseGradientLinearFieldPointForArtboardPoint(
		node,
		context.point,
	);
	if (!linearPoint) return;
	beginDrag(current);
	if (context.event.altKey) {
		const endpoints = symmetricLinearEndpoints(
			state,
			endpoint,
			linearPoint,
			context.event.shiftKey,
		);
		commitNoiseGradientToolLinearFieldEndpoints(
			node.id,
			endpoints.from,
			endpoints.to,
		);
	} else {
		const targetPoint = context.event.shiftKey
			? snapLinearEndpoint(state, endpoint, linearPoint)
			: linearPoint;
		commitNoiseGradientToolLinearFieldEndpoint(node.id, endpoint, targetPoint);
	}
	setCursor(context.event, "grabbing");
};

const onPointerUp = (_context: PointerContext, _api: HostApi): void => {
	if (!gesture) return;
	const current = gesture;
	gesture = null;
	if (current.transaction) commitGestureTransaction(current.transaction);
};

const onKeyDown = (event: KeyboardEvent, api: HostApi): void => {
	const sub = api.selection.sub;
	if (event.key === "Escape") {
		if (gesture) {
			if (gesture.transaction) abortGestureTransaction(gesture.transaction);
			gesture = null;
			event.preventDefault();
			return;
		}
		if (sub?.kind === "noise-field-mesh-point") api.setSubSelection(null);
		return;
	}
	if (event.key !== "Delete" && event.key !== "Backspace") return;
	if (event.metaKey || event.ctrlKey) return;
	if (sub?.kind !== "noise-field-mesh-point") return;
	if (commitNoiseGradientToolFieldMeshRemove(sub.nodeId, sub.row, sub.col)) {
		api.setSubSelection(null);
		event.preventDefault();
	}
};

export const cancelActiveGesture = (): void => {
	if (gesture?.transaction) commitGestureTransaction(gesture.transaction);
	gesture = null;
};

export const handler: NoiseGradientToolHandler = {
	id: "noise-gradient-axis",
	tool: "noise-gradient",
	onActivate,
	onPointerDown,
	onPointerMove,
	onPointerUp,
	onKeyDown,
	onDeactivate: () => cancelActiveGesture(),
};
