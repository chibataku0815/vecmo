import {
	beginGestureTransaction,
	commitGestureTransaction,
	type GestureTransaction,
} from "@/entities/scene/model/gesture-transaction";
import { useSceneStore } from "@/entities/scene/model/store";
import type { SceneDocument, Vec2 } from "@/entities/scene/model/types";
import {
	hitScalarEffectFieldMeshPoint,
	insertScalarEffectFieldMeshColumn,
	insertScalarEffectFieldMeshRow,
	moveScalarEffectFieldMeshPoint,
	removeScalarEffectFieldMeshPointLines,
	scalarEffectFieldMeshPatchAt,
} from "@/shared/effect-field";
import {
	commitNodeEffectFieldCommand,
	createUpdateNodeEffectFieldSourceCommand,
} from "../model/effect-field-authoring";
import {
	effectFieldCanvasState,
	effectFieldLocalPoint,
	effectFieldNormalizedPoint,
} from "../model/effect-field-canvas";
import { useEffectFieldEditorStore } from "../model/effect-field-editor-store";

type PointerContext = {
	readonly point: Vec2;
	readonly event: PointerEvent;
};

type HostApi = {
	readonly getDoc: () => SceneDocument;
	readonly selection: {
		readonly nodeIds: readonly string[];
		readonly primary: string | null;
	};
	readonly viewport: { readonly zoom: number };
};

type EffectFieldToolHandler = {
	readonly id: string;
	readonly tool: "effect";
	readonly onActivate: (api: HostApi) => void;
	readonly onPointerDown: (context: PointerContext, api: HostApi) => void;
	readonly onPointerMove: (context: PointerContext, api: HostApi) => void;
	readonly onPointerUp: (context: PointerContext, api: HostApi) => void;
	readonly onKeyDown: (event: KeyboardEvent, api: HostApi) => void;
	readonly onDeactivate: (api: HostApi) => void;
};

type GestureKind =
	| "linear-from"
	| "linear-to"
	| "linear-center"
	| "radial-center"
	| "radial-x"
	| "radial-y"
	| "rect-center"
	| "rect-width"
	| "rect-height"
	| "contour-width"
	| "mesh-point";

type FieldGesture = {
	readonly kind: GestureKind;
	readonly nodeId: string;
	readonly descriptorId: string;
	readonly fieldId: string;
	readonly transaction: GestureTransaction;
	readonly row?: number;
	readonly col?: number;
	previousNormalized?: Vec2;
};

const HANDLE_HIT_PX = 11;
let gesture: FieldGesture | null = null;

const distance = (left: Vec2, right: Vec2): number =>
	Math.hypot(left.x - right.x, left.y - right.y);

const inverseRotatedOffset = (
	point: Vec2,
	center: Vec2,
	rotation: number,
): Vec2 => {
	const dx = point.x - center.x;
	const dy = point.y - center.y;
	return {
		x: dx * Math.cos(rotation) + dy * Math.sin(rotation),
		y: -dx * Math.sin(rotation) + dy * Math.cos(rotation),
	};
};

const primaryNodeId = (api: HostApi): string | null =>
	api.selection.primary ?? api.selection.nodeIds[0] ?? null;

const commitSource = (
	nodeId: string,
	descriptorId: string,
	source: Parameters<typeof createUpdateNodeEffectFieldSourceCommand>[3],
): boolean =>
	commitNodeEffectFieldCommand(
		createUpdateNodeEffectFieldSourceCommand(
			useSceneStore.getState().document,
			nodeId,
			descriptorId,
			source,
		),
	);

const startGesture = (
	kind: GestureKind,
	state: NonNullable<ReturnType<typeof effectFieldCanvasState>>,
	extra: Pick<FieldGesture, "row" | "col" | "previousNormalized"> = {},
): void => {
	gesture = {
		kind,
		nodeId: state.node.id,
		descriptorId: state.descriptorId,
		fieldId: state.fieldId,
		transaction: beginGestureTransaction(
			`effect-field:${state.node.id}:${state.descriptorId}`,
			"Edit Effect Field",
		),
		...extra,
	};
};

const sealGesture = (): void => {
	if (!gesture) return;
	commitGestureTransaction(gesture.transaction);
	gesture = null;
};

const addMeshLinesAtPointer = (
	state: NonNullable<ReturnType<typeof effectFieldCanvasState>>,
	point: Vec2,
): boolean => {
	if (!state.mesh || state.source.kind !== "fieldMesh") return false;
	const local = effectFieldLocalPoint(state, point);
	const patch = scalarEffectFieldMeshPatchAt(state.mesh, local);
	if (!patch) return false;
	const withRow = insertScalarEffectFieldMeshRow(
		state.source.fieldMesh,
		patch.row,
		patch.v,
	);
	const withColumn = insertScalarEffectFieldMeshColumn(
		withRow,
		patch.col,
		patch.u,
	);
	return commitSource(state.node.id, state.descriptorId, {
		...state.source,
		fieldMesh: withColumn,
	});
};

const onPointerDown = (context: PointerContext, api: HostApi): void => {
	sealGesture();
	const nodeId = primaryNodeId(api);
	if (!nodeId) return;
	const descriptorId = useEffectFieldEditorStore.getState().descriptorId;
	const state = effectFieldCanvasState(api.getDoc(), nodeId, descriptorId);
	if (!state) return;
	const scale = Math.max(api.viewport.zoom / 100, 0.001);
	const tolerance = HANDLE_HIT_PX / scale;
	if (state.mesh && state.source.kind === "fieldMesh") {
		const hit = hitScalarEffectFieldMeshPoint(
			state.mesh,
			context.point,
			tolerance,
		);
		if (hit) {
			useEffectFieldEditorStore.getState().setMeshPoint({
				nodeId,
				fieldId: state.fieldId,
				row: hit.row,
				col: hit.col,
			});
			startGesture("mesh-point", state, hit);
			context.event.preventDefault();
			return;
		}
		if (
			context.event.detail >= 2 &&
			addMeshLinesAtPointer(state, context.point)
		) {
			context.event.preventDefault();
		}
		return;
	}
	if (state.linear) {
		if (distance(context.point, state.linear.from) <= tolerance) {
			startGesture("linear-from", state);
		} else if (distance(context.point, state.linear.to) <= tolerance) {
			startGesture("linear-to", state);
		} else if (distance(context.point, state.linear.center) <= tolerance) {
			startGesture("linear-center", state, {
				previousNormalized:
					effectFieldNormalizedPoint(state, context.point) ?? undefined,
			});
		} else {
			return;
		}
		context.event.preventDefault();
		return;
	}
	if (state.radial) {
		if (distance(context.point, state.radial.center) <= tolerance) {
			startGesture("radial-center", state);
		} else if (
			distance(context.point, state.radial.radiusXHandle) <= tolerance
		) {
			startGesture("radial-x", state);
		} else if (
			distance(context.point, state.radial.radiusYHandle) <= tolerance
		) {
			startGesture("radial-y", state);
		} else {
			return;
		}
		context.event.preventDefault();
		return;
	}
	if (state.rect) {
		if (distance(context.point, state.rect.center) <= tolerance) {
			startGesture("rect-center", state);
		} else if (distance(context.point, state.rect.widthHandle) <= tolerance) {
			startGesture("rect-width", state);
		} else if (distance(context.point, state.rect.heightHandle) <= tolerance) {
			startGesture("rect-height", state);
		} else {
			return;
		}
		context.event.preventDefault();
		return;
	}
	if (
		state.contour &&
		distance(context.point, state.contour.handle) <= tolerance
	) {
		startGesture("contour-width", state);
		context.event.preventDefault();
	}
};

const onPointerMove = (context: PointerContext, api: HostApi): void => {
	const active = gesture;
	if (!active) return;
	const state = effectFieldCanvasState(
		api.getDoc(),
		active.nodeId,
		active.descriptorId,
	);
	if (!state || state.fieldId !== active.fieldId) {
		sealGesture();
		return;
	}
	if (
		active.kind === "contour-width" &&
		state.source.kind === "contourGradient"
	) {
		const local = effectFieldLocalPoint(state, context.point);
		const shortAxis = Math.max(
			1e-6,
			Math.min(state.bounds.width, state.bounds.height),
		);
		const width = Math.min(
			1,
			Math.max(
				0.001,
				Math.abs(local.x - (state.bounds.x + state.bounds.width)) / shortAxis,
			),
		);
		commitSource(active.nodeId, active.descriptorId, {
			...state.source,
			width,
		});
		context.event.preventDefault();
		return;
	}
	if (active.kind === "mesh-point" && state.source.kind === "fieldMesh") {
		const point = effectFieldNormalizedPoint(state, context.point);
		if (!point || active.row === undefined || active.col === undefined) return;
		commitSource(active.nodeId, active.descriptorId, {
			...state.source,
			fieldMesh: moveScalarEffectFieldMeshPoint(
				state.source.fieldMesh,
				active.row,
				active.col,
				point,
			),
		});
		context.event.preventDefault();
		return;
	}
	const normalized = effectFieldNormalizedPoint(state, context.point);
	if (!normalized) return;
	if (state.source.kind === "radialGradient") {
		if (active.kind === "radial-center") {
			commitSource(active.nodeId, active.descriptorId, {
				...state.source,
				cx: normalized.x,
				cy: normalized.y,
			});
		} else {
			const offset = inverseRotatedOffset(
				normalized,
				{ x: state.source.cx, y: state.source.cy },
				state.source.rotation,
			);
			if (active.kind === "radial-x") {
				commitSource(active.nodeId, active.descriptorId, {
					...state.source,
					radius: Math.max(0.001, Math.abs(offset.x)),
					rx: Math.max(0.001, Math.abs(offset.x)),
				});
			} else if (active.kind === "radial-y") {
				commitSource(active.nodeId, active.descriptorId, {
					...state.source,
					ry: Math.max(0.001, Math.abs(offset.y)),
				});
			} else {
				return;
			}
		}
		context.event.preventDefault();
		return;
	}
	if (state.source.kind === "rect") {
		const center = {
			x: state.source.x + state.source.width / 2,
			y: state.source.y + state.source.height / 2,
		};
		if (active.kind === "rect-center") {
			commitSource(active.nodeId, active.descriptorId, {
				...state.source,
				x: normalized.x - state.source.width / 2,
				y: normalized.y - state.source.height / 2,
			});
		} else {
			const offset = inverseRotatedOffset(
				normalized,
				center,
				state.source.rotation,
			);
			if (active.kind === "rect-width") {
				const width = Math.max(0.001, Math.abs(offset.x) * 2);
				commitSource(active.nodeId, active.descriptorId, {
					...state.source,
					x: center.x - width / 2,
					width,
				});
			} else if (active.kind === "rect-height") {
				const height = Math.max(0.001, Math.abs(offset.y) * 2);
				commitSource(active.nodeId, active.descriptorId, {
					...state.source,
					y: center.y - height / 2,
					height,
				});
			} else {
				return;
			}
		}
		context.event.preventDefault();
		return;
	}
	if (!state.linear || state.source.kind !== "linearGradient") return;
	const point = normalized;
	if (active.kind === "linear-from") {
		commitSource(active.nodeId, active.descriptorId, {
			...state.source,
			x1: point.x,
			y1: point.y,
		});
	} else if (active.kind === "linear-to") {
		commitSource(active.nodeId, active.descriptorId, {
			...state.source,
			x2: point.x,
			y2: point.y,
		});
	} else if (active.kind === "linear-center") {
		const previous = active.previousNormalized;
		if (!previous) return;
		const rawDx = point.x - previous.x;
		const rawDy = point.y - previous.y;
		const dx = Math.min(
			1 - Math.max(state.source.x1, state.source.x2),
			Math.max(-Math.min(state.source.x1, state.source.x2), rawDx),
		);
		const dy = Math.min(
			1 - Math.max(state.source.y1, state.source.y2),
			Math.max(-Math.min(state.source.y1, state.source.y2), rawDy),
		);
		commitSource(active.nodeId, active.descriptorId, {
			...state.source,
			x1: state.source.x1 + dx,
			y1: state.source.y1 + dy,
			x2: state.source.x2 + dx,
			y2: state.source.y2 + dy,
		});
		active.previousNormalized = { x: previous.x + dx, y: previous.y + dy };
	}
	context.event.preventDefault();
};

const onKeyDown = (event: KeyboardEvent, api: HostApi): void => {
	if (event.key === "Escape") {
		sealGesture();
		useEffectFieldEditorStore.getState().setMeshPoint(null);
		return;
	}
	if (event.key !== "Delete" && event.key !== "Backspace") return;
	if (event.metaKey || event.ctrlKey) return;
	const selected = useEffectFieldEditorStore.getState().meshPoint;
	const nodeId = primaryNodeId(api);
	if (!selected || !nodeId || selected.nodeId !== nodeId) return;
	const descriptorId = useEffectFieldEditorStore.getState().descriptorId;
	const state = effectFieldCanvasState(api.getDoc(), nodeId, descriptorId);
	if (
		state?.source.kind !== "fieldMesh" ||
		state.fieldId !== selected.fieldId
	) {
		return;
	}
	const fieldMesh = removeScalarEffectFieldMeshPointLines(
		state.source.fieldMesh,
		selected.row,
		selected.col,
	);
	if (commitSource(nodeId, descriptorId, { ...state.source, fieldMesh })) {
		useEffectFieldEditorStore.getState().setMeshPoint(null);
		event.preventDefault();
	}
};

/** Commits and releases the active field gesture during host interruption. */
export const cancelActiveGesture = (): void => sealGesture();

export const handler: EffectFieldToolHandler = {
	id: "effect-field-direct-controls",
	tool: "effect",
	onActivate: () => undefined,
	onPointerDown,
	onPointerMove,
	onPointerUp: () => sealGesture(),
	onKeyDown,
	onDeactivate: () => sealGesture(),
};
