import {
	abortGestureTransaction,
	beginGestureTransaction,
	type GestureTransaction,
} from "@/entities/scene/model/gesture-transaction";
import { findNode } from "@/entities/scene/model/selectors";
import type { SceneDocument } from "@/entities/scene/model/types";
import {
	consumeExternalTextCommitPointer,
	useTextEditStore,
} from "../model/text-edit-store";
import {
	beginTextEditing,
	commitActiveTextEditing,
	createCanvasAreaTextNode,
	createCanvasTextNode,
	DEFAULT_TEXT_CONTENT,
	insertTextNode,
} from "../model/text-node";

type CanvasPoint = {
	readonly x: number;
	readonly y: number;
};

type CanvasBounds = {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
};

type PointerContext = {
	readonly point: CanvasPoint;
	readonly hitNodeId: string | null;
	readonly event: PointerEvent;
};

type HostApi = {
	readonly getDoc: () => SceneDocument;
	readonly selection: {
		readonly primary: string | null;
	};
	readonly viewport: { readonly zoom: number };
	readonly select: (nodeId: string, additive?: boolean) => void;
	readonly clearSelection: () => void;
};

type TextToolHandler = {
	readonly id: string;
	readonly tool: "type";
	readonly onPointerDown: (context: PointerContext, api: HostApi) => void;
	readonly onPointerMove: (context: PointerContext, api: HostApi) => void;
	readonly onPointerUp: (context: PointerContext, api: HostApi) => void;
	readonly onKeyDown: (event: KeyboardEvent, api: HostApi) => void;
	readonly onDeactivate: (api: HostApi) => void;
};

const PERCENT = 100;
const DRAG_CREATE_THRESHOLD_PX = 6;
const MIN_AREA_TEXT_WIDTH = 48;
const MIN_AREA_TEXT_HEIGHT = 56;

const isPrimaryButton = (event: PointerEvent): boolean => event.button === 0;

type PointerEditRequest = {
	readonly nodeId: string;
	readonly source: "new" | "existing";
	readonly transaction?: GestureTransaction;
};

let pendingPointerEdit: PointerEditRequest | null = null;
let scheduledPointerEdit: PointerEditRequest | null = null;
let pointerEditVersion = 0;

type PendingCreation = {
	readonly start: CanvasPoint;
	readonly artboardId: string;
	readonly pointerId: number;
	readonly source: "blank-canvas";
};

let pendingCreation: PendingCreation | null = null;

const distanceFromStart = (start: CanvasPoint, point: CanvasPoint): number =>
	Math.hypot(point.x - start.x, point.y - start.y);

const screenScale = (api: HostApi): number =>
	Math.max(api.viewport.zoom / PERCENT, 0.001);

const screenDistanceFromStart = (
	start: CanvasPoint,
	point: CanvasPoint,
	api: HostApi,
): number => distanceFromStart(start, point) * screenScale(api);

const normalizedBoundsFromPoints = (
	start: CanvasPoint,
	end: CanvasPoint,
): CanvasBounds => ({
	x: Math.min(start.x, end.x),
	y: Math.min(start.y, end.y),
	width: Math.abs(end.x - start.x),
	height: Math.abs(end.y - start.y),
});

const areaBoundsFromPreview = (bounds: CanvasBounds): CanvasBounds => ({
	x: bounds.x,
	y: bounds.y,
	width: Math.max(MIN_AREA_TEXT_WIDTH, bounds.width),
	height: Math.max(MIN_AREA_TEXT_HEIGHT, bounds.height),
});

const cancelPointerEditRequest = (): boolean => {
	let removedFreshText = false;
	for (const request of [pendingPointerEdit, scheduledPointerEdit]) {
		if (request?.source === "new") removedFreshText = true;
		if (request?.transaction) abortGestureTransaction(request.transaction);
	}
	pendingPointerEdit = null;
	scheduledPointerEdit = null;
	pendingCreation = null;
	pointerEditVersion += 1;
	useTextEditStore.getState().setCreationPreview(null);
	return removedFreshText;
};

const queueTextEditAfterPointer = (
	nodeId: string,
	source: "new" | "existing",
	transaction?: GestureTransaction,
): void => {
	pendingPointerEdit = { nodeId, source, transaction };
};

const queueExistingTextEdit = (nodeId: string, api: HostApi): boolean => {
	const node = findNode(api.getDoc(), nodeId);
	if (node?.geometry.kind !== "text") return false;
	api.select(node.id, false);
	queueTextEditAfterPointer(node.id, "existing");
	return true;
};

const currentArtboardId = (document: SceneDocument): string =>
	document.currentArtboardId ?? document.artboard.id;

const onPointerDown = (context: PointerContext, api: HostApi): void => {
	if (!isPrimaryButton(context.event)) return;
	const activeSession = useTextEditStore.getState().session;
	if (activeSession) {
		cancelPointerEditRequest();
		commitActiveTextEditing();
		if (
			activeSession.source === "new" &&
			activeSession.draftText.trim().length === 0
		) {
			api.clearSelection();
		}
		context.event.preventDefault();
		return;
	}
	if (consumeExternalTextCommitPointer(context.event)) {
		cancelPointerEditRequest();
		context.event.preventDefault();
		return;
	}
	cancelPointerEditRequest();
	commitActiveTextEditing();
	if (context.hitNodeId && queueExistingTextEdit(context.hitNodeId, api)) {
		return;
	}

	pendingCreation = {
		start: context.point,
		artboardId: currentArtboardId(api.getDoc()),
		pointerId: context.event.pointerId,
		source: "blank-canvas",
	};
};

const onPointerMove = (context: PointerContext, api: HostApi): void => {
	const creation = pendingCreation;
	if (!creation || context.event.pointerId !== creation.pointerId) return;
	if (
		screenDistanceFromStart(creation.start, context.point, api) <
		DRAG_CREATE_THRESHOLD_PX
	) {
		useTextEditStore.getState().setCreationPreview(null);
		return;
	}
	const rawBounds = normalizedBoundsFromPoints(creation.start, context.point);
	useTextEditStore.getState().setCreationPreview({
		artboardId: creation.artboardId,
		bounds: areaBoundsFromPreview(rawBounds),
	});
};

const insertAndEditNode = (
	node: ReturnType<typeof createCanvasTextNode>,
	api: HostApi,
): void => {
	const transaction = beginGestureTransaction(
		`text:new:${node.id}`,
		"Add text",
	);
	if (!insertTextNode(node)) {
		abortGestureTransaction(transaction);
		return;
	}
	api.select(node.id, false);
	queueTextEditAfterPointer(node.id, "new", transaction);
};

const onPointerUp = (context: PointerContext, api: HostApi): void => {
	const creation = pendingCreation;
	if (creation && context.event.pointerId === creation.pointerId) {
		pendingCreation = null;
		useTextEditStore.getState().setCreationPreview(null);
		const rawBounds = normalizedBoundsFromPoints(creation.start, context.point);
		const shouldCreateArea =
			screenDistanceFromStart(creation.start, context.point, api) >=
			DRAG_CREATE_THRESHOLD_PX;
		const node = shouldCreateArea
			? createCanvasAreaTextNode(
					areaBoundsFromPreview(rawBounds),
					DEFAULT_TEXT_CONTENT,
					creation.artboardId,
				)
			: createCanvasTextNode(
					creation.start,
					DEFAULT_TEXT_CONTENT,
					creation.artboardId,
				);
		insertAndEditNode(node, api);
	}

	const pending = pendingPointerEdit;
	pendingPointerEdit = null;
	if (!pending) return;
	scheduledPointerEdit = pending;
	pointerEditVersion += 1;
	const version = pointerEditVersion;
	globalThis.setTimeout(() => {
		if (version !== pointerEditVersion || scheduledPointerEdit !== pending) {
			return;
		}
		scheduledPointerEdit = null;
		const started = beginTextEditing(pending.nodeId, pending.source, {
			transaction: pending.transaction,
		});
		if (!started && pending.transaction)
			abortGestureTransaction(pending.transaction);
	}, 0);
};

const onKeyDown = (event: KeyboardEvent, api: HostApi): void => {
	if (event.key === "Escape") {
		const removedFreshText = cancelPointerEditRequest();
		const activeSession = useTextEditStore.getState().session;
		commitActiveTextEditing();
		if (
			removedFreshText ||
			(activeSession?.source === "new" &&
				activeSession.draftText.trim().length === 0)
		) {
			api.clearSelection();
		}
		event.preventDefault();
		return;
	}
	if (event.key !== "Enter") return;
	const primary = api.selection.primary;
	if (!primary) return;
	const node = findNode(api.getDoc(), primary);
	if (node?.geometry.kind !== "text") return;
	api.select(node.id, false);
	beginTextEditing(node.id, "existing");
	event.preventDefault();
};

export const handler: TextToolHandler = {
	id: "text-canvas-authoring",
	tool: "type",
	onPointerDown,
	onPointerMove,
	onPointerUp,
	onKeyDown,
	onDeactivate: (api) => {
		const removedFreshText = cancelPointerEditRequest();
		const activeSession = useTextEditStore.getState().session;
		commitActiveTextEditing();
		if (
			removedFreshText ||
			(activeSession?.source === "new" &&
				activeSession.draftText.trim().length === 0)
		) {
			api.clearSelection();
		}
	},
};
