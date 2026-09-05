import {
	blendSourceAttachmentCandidates,
	blendSourceInsertionIndex,
	blendSourceStopParentPoint,
	canUseCustomBlendSpine,
	effectiveBlendSpineForSources,
	insertLineBlendSpineAnchor,
	insertOpenBlendSpineAnchor,
	isClosedBlendSpine,
	moveLineBlendSpineSegment,
	moveOpenBlendSpineSegment,
	projectLineBlendSpineSegment,
	projectOpenBlendSpineSegment,
	removeBlendPathSpineAnchor,
} from "@/entities/scene/model/blend";
import {
	buildCreateBlendCommand,
	buildInsertBlendSourceCommand,
	createDeleteBlendSpineAnchorCommand,
	createResetBlendSpineHandleCommand,
	createUpdateBlendSpineCommand,
} from "@/entities/scene/model/blend-commands";
import {
	abortGestureTransaction,
	type GestureTransaction,
} from "@/entities/scene/model/gesture-transaction";
import {
	applyMatrixToPoint,
	invertMatrix,
	isIdentityMatrix,
	type Matrix2D,
	matrixFromTransform,
} from "@/entities/scene/model/rendering";
import { findNode } from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import type {
	BlendSourceStop,
	BlendSpine,
	SceneDocument,
	Vec2,
	VectorNode,
} from "@/entities/scene/model/types";
import type { AePoint, AeShape } from "@/shared/glammer/ae-shape";
import {
	type BlendSpineSubSelection,
	type BlendSpineTarget,
	useBlendToolStore,
} from "../model/tool-state";

type LocalToolId = "select" | "blend";

type PointerContext = {
	readonly point: Vec2;
	readonly hitNodeId: string | null;
	readonly event: PointerEvent;
};

type HostApi = {
	readonly getDoc: () => SceneDocument;
	readonly selection: {
		readonly nodeIds: readonly string[];
		readonly primary: string | null;
	};
	readonly viewport: {
		readonly zoom: number;
	};
	readonly select: (nodeId: string, additive?: boolean) => void;
	readonly setSelection: (
		nodeIds: readonly string[],
		primary?: string | null,
	) => void;
	readonly setActiveTool: (tool: LocalToolId) => void;
	readonly beginGestureTransaction: (
		scope: string,
		label?: string,
	) => GestureTransaction;
	readonly commitGestureTransaction: (transaction: GestureTransaction) => void;
};

type BlendToolHandler = {
	readonly id: string;
	readonly tool: LocalToolId;
	readonly onPointerDown: (context: PointerContext, api: HostApi) => void;
	readonly onPointerMove: (context: PointerContext, api: HostApi) => void;
	readonly onPointerUp: (context: PointerContext, api: HostApi) => void;
	readonly onKeyDown?: (event: KeyboardEvent, api: HostApi) => void;
	readonly onDeactivate?: (api: HostApi) => void;
};

type SpineGesture = {
	readonly blendNodeId: string;
	readonly originalSpine: BlendSpine;
	readonly target: BlendSpineTarget;
	/** Pointer-down position in the Blend container's local space. */
	readonly startPoint: Vec2;
	readonly containerInverse: Matrix2D | null;
	readonly alignEndpointCenters: readonly ("start" | "end")[];
	readonly persistSpine: boolean;
	dragging: boolean;
	transaction: GestureTransaction | null;
};

type SelectedBlendSpine = {
	readonly blendNode: VectorNode;
	readonly sources: readonly VectorNode[];
	readonly spine: BlendSpine;
	readonly authoredSpine: BlendSpine | null;
	/**
	 * Inverse of the container's own transform, or null when the container is
	 * untouched (identity). Spine coordinates and source children live in the
	 * container's local space, so pointer positions must round-trip through
	 * this before spine hit-testing, drags, and insertion-index projection.
	 */
	readonly containerInverse: Matrix2D | null;
};

const pointInBlendContainerSpace = (
	selected: Pick<SelectedBlendSpine, "containerInverse">,
	point: Vec2,
): Vec2 =>
	selected.containerInverse
		? applyMatrixToPoint(selected.containerInverse, point)
		: point;

const PERCENT = 100;
const HANDLE_HIT_RADIUS_PX = 9;
const SEGMENT_HIT_RADIUS_PX = 7;
const DRAG_THRESHOLD_PX = 3;
const EDIT_SPINE_LABEL = "Edit blend spine";
const INSERT_SPINE_POINT_LABEL = "Insert blend spine point";

let spineGesture: SpineGesture | null = null;

const resetBlendGesture = (): void => {
	useBlendToolStore.getState().resetGesture();
};

const spineSubSelection = (
	blendNodeId: string,
	target: BlendSpineTarget,
): BlendSpineSubSelection => ({
	blendNodeId,
	...target,
});

const clearSpineSubSelection = (): void => {
	const store = useBlendToolStore.getState();
	store.setSelectedSpine(null);
	store.setHoverSpine(null);
};

const pointDistance = (from: Vec2, to: Vec2): number =>
	Math.hypot(to.x - from.x, to.y - from.y);

const sceneUnitsForScreenPixels = (api: HostApi, pixels: number): number => {
	const scale =
		Number.isFinite(api.viewport.zoom) && api.viewport.zoom > 0
			? api.viewport.zoom / PERCENT
			: 1;
	return pixels / scale;
};

const selectedBlendSpine = (api: HostApi): SelectedBlendSpine | null => {
	const document = api.getDoc();
	const primaryNode = findNode(document, api.selection.primary);
	const blendNode = primaryNode?.blend
		? primaryNode
		: (api.selection.nodeIds
				.map((nodeId) => findNode(document, nodeId))
				.find((node) => node?.blend) ?? null);
	if (!blendNode?.blend || !blendNode.children) return null;
	const sources = blendNode.blend.sourceNodeIds
		.map((nodeId) => blendNode.children?.find((child) => child.id === nodeId))
		.filter((node): node is VectorNode => Boolean(node));
	if (
		sources.length !== blendNode.blend.sourceNodeIds.length ||
		sources.length < 2
	) {
		return null;
	}
	const containerMatrix = matrixFromTransform(blendNode.transform);
	return {
		blendNode,
		sources,
		authoredSpine:
			blendNode.blend.spine && canUseCustomBlendSpine(blendNode.blend.spine)
				? blendNode.blend.spine
				: null,
		spine: effectiveBlendSpineForSources(
			sources,
			blendNode.blend.spine,
			blendNode.blend.sourceStops,
		),
		containerInverse: isIdentityMatrix(containerMatrix)
			? null
			: invertMatrix(containerMatrix),
	};
};

const pointFromAe = (point: AePoint): Vec2 => ({
	x: point[0],
	y: point[1],
});

const pointToAe = (point: Vec2): AePoint => [point.x, point.y];

const tangentEnd = (vertex: AePoint, tangent: AePoint): Vec2 => ({
	x: vertex[0] + tangent[0],
	y: vertex[1] + tangent[1],
});

const tangentVisible = (tangent: AePoint): boolean =>
	Math.hypot(tangent[0], tangent[1]) > 0;

const isVisibleSpineHandle = (
	shape: AeShape,
	index: number,
	kind: "in" | "out",
): boolean => {
	if (shape.closed) return true;
	const lastIndex = shape.vertices.length - 1;
	return kind === "in" ? index > 0 : index < lastIndex;
};

const hitPathHandle = (
	shape: AeShape,
	point: Vec2,
	tolerance: number,
): BlendSpineTarget | null => {
	for (let index = 0; index < shape.vertices.length; index += 1) {
		const vertex = shape.vertices[index];
		const inTangent = shape.inTangents[index];
		const outTangent = shape.outTangents[index];
		if (!vertex || !inTangent || !outTangent) continue;
		if (
			isVisibleSpineHandle(shape, index, "in") &&
			tangentVisible(inTangent) &&
			pointDistance(point, tangentEnd(vertex, inTangent)) <= tolerance
		) {
			return { kind: "path-in", index };
		}
		if (
			isVisibleSpineHandle(shape, index, "out") &&
			tangentVisible(outTangent) &&
			pointDistance(point, tangentEnd(vertex, outTangent)) <= tolerance
		) {
			return { kind: "path-out", index };
		}
	}
	for (let index = 0; index < shape.vertices.length; index += 1) {
		const vertex = shape.vertices[index];
		if (!vertex) continue;
		if (pointDistance(point, pointFromAe(vertex)) <= tolerance) {
			return { kind: "path-anchor", index };
		}
	}
	return null;
};

const hitSpineTarget = (
	spine: BlendSpine,
	point: Vec2,
	handleTolerance: number,
	segmentTolerance: number,
): BlendSpineTarget | null => {
	if (spine.kind === "line") {
		const startDistance = pointDistance(point, spine.start);
		const endDistance = pointDistance(point, spine.end);
		if (startDistance <= handleTolerance || endDistance <= handleTolerance) {
			return startDistance <= endDistance
				? { kind: "line-start" }
				: { kind: "line-end" };
		}
		const segment = projectLineBlendSpineSegment(
			spine,
			point,
			segmentTolerance,
		);
		return segment ? { kind: "line-segment", t: segment.t } : null;
	}
	const handle = hitPathHandle(spine.shape, point, handleTolerance);
	if (handle) return handle;
	const segment = projectOpenBlendSpineSegment(spine, point, segmentTolerance);
	return segment
		? { kind: "path-segment", index: segment.segment, t: segment.t }
		: null;
};

const cloneShape = (shape: AeShape): AeShape => ({
	type: "Shape",
	closed: shape.closed,
	vertices: shape.vertices.map((point) => [...point] as AePoint),
	inTangents: shape.inTangents.map((point) => [...point] as AePoint),
	outTangents: shape.outTangents.map((point) => [...point] as AePoint),
});

const negate = (point: AePoint): AePoint => [-point[0], -point[1]];

const movePathSpineTarget = (
	shape: AeShape,
	target: BlendSpineTarget,
	point: Vec2,
	breakSymmetry: boolean,
): AeShape => {
	const next = cloneShape(shape);
	if (
		target.kind !== "path-anchor" &&
		target.kind !== "path-in" &&
		target.kind !== "path-out"
	) {
		return next;
	}
	const vertex = next.vertices[target.index];
	if (!vertex) return next;
	if (target.kind === "path-anchor") {
		next.vertices[target.index] = pointToAe(point);
		return next;
	}
	const tangent: AePoint = [point.x - vertex[0], point.y - vertex[1]];
	const lastIndex = next.vertices.length - 1;
	if (target.kind === "path-out") {
		next.outTangents[target.index] = tangent;
		if (!breakSymmetry && (next.closed || target.index > 0)) {
			next.inTangents[target.index] = negate(tangent);
		}
		return next;
	}
	next.inTangents[target.index] = tangent;
	if (!breakSymmetry && (next.closed || target.index < lastIndex)) {
		next.outTangents[target.index] = negate(tangent);
	}
	return next;
};

const nextSpineForGesture = (
	gesture: SpineGesture,
	point: Vec2,
	event: PointerEvent,
): BlendSpine | null => {
	const spine = gesture.originalSpine;
	const target = gesture.target;
	if (spine.kind === "line") {
		if (target.kind === "line-start") {
			return { ...spine, start: point };
		}
		if (target.kind === "line-end") {
			return { ...spine, end: point };
		}
		if (target.kind === "line-segment") {
			return moveLineBlendSpineSegment(spine, target.t, {
				x: point.x - gesture.startPoint.x,
				y: point.y - gesture.startPoint.y,
			});
		}
		return null;
	}
	if (target.kind === "path-segment") {
		return moveOpenBlendSpineSegment(spine, target.index, target.t, {
			x: point.x - gesture.startPoint.x,
			y: point.y - gesture.startPoint.y,
		});
	}
	return {
		kind: "path",
		shape: movePathSpineTarget(
			spine.shape,
			target,
			point,
			event.altKey || event.metaKey,
		),
	};
};

const endpointAlignmentForTarget = (
	spine: BlendSpine,
	target: BlendSpineTarget,
): readonly ("start" | "end")[] => {
	if (target.kind === "line-start") return ["start"];
	if (target.kind === "line-end") return ["end"];
	if (spine.kind !== "path" || target.kind !== "path-anchor") return [];
	if (isClosedBlendSpine(spine)) return [];
	const lastIndex = spine.shape.vertices.length - 1;
	if (target.index === 0) return ["start"];
	if (target.index === lastIndex) return ["end"];
	return [];
};

const finishSpineGesture = (api: HostApi): void => {
	if (spineGesture?.transaction) {
		api.commitGestureTransaction(spineGesture.transaction);
	}
	spineGesture = null;
};

const insertSpinePointFromSegmentClick = (gesture: SpineGesture): void => {
	const target = gesture.target;
	const insertion =
		target.kind === "line-segment"
			? insertLineBlendSpineAnchor(gesture.originalSpine, target.t)
			: target.kind === "path-segment"
				? insertOpenBlendSpineAnchor(
						gesture.originalSpine,
						target.index,
						target.t,
					)
				: null;
	if (!insertion) return;
	useSceneStore.getState().apply(
		createUpdateBlendSpineCommand(gesture.blendNodeId, insertion.spine, {
			label: INSERT_SPINE_POINT_LABEL,
		}),
	);
	const subSelection = spineSubSelection(gesture.blendNodeId, {
		kind: "path-anchor",
		index: insertion.anchorIndex,
	});
	const store = useBlendToolStore.getState();
	store.setSelectedSpine(subSelection);
	store.setHoverSpine(subSelection);
};

const cancelSpineGesture = (): void => {
	if (spineGesture?.transaction) {
		abortGestureTransaction(spineGesture.transaction);
	}
	spineGesture = null;
};

const hitEditableSpine = (
	context: PointerContext,
	api: HostApi,
): {
	readonly blendNodeId: string;
	readonly spine: BlendSpine;
	readonly target: BlendSpineTarget;
	readonly persistSpine: boolean;
	readonly containerInverse: Matrix2D | null;
	readonly localPoint: Vec2;
} | null => {
	const selected = selectedBlendSpine(api);
	if (!selected) return null;
	const localPoint = pointInBlendContainerSpace(selected, context.point);
	const target = hitSpineTarget(
		selected.spine,
		localPoint,
		sceneUnitsForScreenPixels(api, HANDLE_HIT_RADIUS_PX),
		sceneUnitsForScreenPixels(api, SEGMENT_HIT_RADIUS_PX),
	);
	return target
		? {
				blendNodeId: selected.blendNode.id,
				spine: selected.spine,
				target,
				persistSpine:
					Boolean(selected.authoredSpine) ||
					target.kind === "line-segment" ||
					selected.sources.length > 2,
				containerInverse: selected.containerInverse,
				localPoint,
			}
		: null;
};

const selectedSpineTarget = (
	api: HostApi,
): {
	readonly blendNodeId: string;
	readonly spine: BlendSpine;
	readonly target: BlendSpineTarget;
	readonly persistSpine: boolean;
} | null => {
	const selected = selectedBlendSpine(api);
	const sub = useBlendToolStore.getState().selectedSpine;
	if (!selected || !sub || sub.blendNodeId !== selected.blendNode.id) {
		return null;
	}
	return {
		blendNodeId: selected.blendNode.id,
		spine: selected.spine,
		target: sub,
		persistSpine: Boolean(selected.authoredSpine),
	};
};

const deleteSelectedSpinePoint = (api: HostApi): boolean => {
	const selected = selectedSpineTarget(api);
	if (!selected) return false;
	const target = selected.target;
	if (target.kind === "path-in" || target.kind === "path-out") {
		useSceneStore
			.getState()
			.apply(
				createResetBlendSpineHandleCommand(
					selected.blendNodeId,
					target.index,
					target.kind === "path-in" ? "in" : "out",
				),
			);
		useBlendToolStore.getState().setHoverSpine(null);
		return true;
	}
	if (target.kind !== "path-anchor" || selected.spine.kind !== "path") {
		return true;
	}
	const nextSpine = removeBlendPathSpineAnchor(selected.spine, target.index);
	if (nextSpine?.kind !== "path") return true;
	useSceneStore
		.getState()
		.apply(
			createDeleteBlendSpineAnchorCommand(selected.blendNodeId, target.index),
		);
	const nextVertexCount = nextSpine.shape.vertices.length;
	const nextInteriorCount = nextSpine.shape.closed
		? nextVertexCount
		: Math.max(0, nextVertexCount - 2);
	const store = useBlendToolStore.getState();
	store.setSelectedSpine(
		nextInteriorCount > 0
			? spineSubSelection(selected.blendNodeId, {
					kind: "path-anchor",
					index: nextSpine.shape.closed
						? Math.min(target.index, nextVertexCount - 1)
						: Math.min(Math.max(1, target.index), nextVertexCount - 2),
				})
			: null,
	);
	store.setHoverSpine(null);
	return true;
};

const commitBlend = (
	sourceStops: readonly BlendSourceStop[],
	api: HostApi,
): void => {
	const document = useSceneStore.getState().document;
	const store = useBlendToolStore.getState();
	const sourceNodeIds = sourceStops.map((stop) => stop.nodeId);
	const plan = buildCreateBlendCommand(document, sourceNodeIds, {
		spacing: store.spacing,
		orientation: store.orientation,
		sourceOrder: "selection",
		sourceStops,
	});
	if (!plan.ok) {
		api.setSelection(sourceNodeIds, sourceNodeIds[sourceNodeIds.length - 1]);
		resetBlendGesture();
		return;
	}
	const before = useSceneStore.getState().document;
	useSceneStore.getState().apply(plan.command);
	resetBlendGesture();
	if (useSceneStore.getState().document === before) return;
	api.setSelection([plan.blendNodeId], plan.blendNodeId);
};

/**
 * Adds a clicked source to the selected Blend. The insertion index comes from
 * projecting the clicked registration point onto the effective spine, so an
 * object sitting between two stops joins between them and an object past the
 * ends prepends/appends.
 */
const insertBlendSource = (
	selected: SelectedBlendSpine,
	sourceStop: BlendSourceStop,
	api: HostApi,
): boolean => {
	const document = useSceneStore.getState().document;
	const sourceNode = findNode(document, sourceStop.nodeId);
	if (!sourceNode || !selected.blendNode.blend) return false;
	const index = blendSourceInsertionIndex(
		selected.sources,
		selected.blendNode.blend.spine,
		selected.blendNode.blend.sourceStops,
		pointInBlendContainerSpace(
			selected,
			blendSourceStopParentPoint(sourceNode, sourceStop),
		),
	);
	const plan = buildInsertBlendSourceCommand(
		document,
		selected.blendNode.id,
		sourceStop.nodeId,
		{ index, sourceStop },
	);
	if (!plan.ok) return false;
	const before = useSceneStore.getState().document;
	useSceneStore.getState().apply(plan.command);
	resetBlendGesture();
	if (useSceneStore.getState().document === before) return false;
	api.setSelection([selected.blendNode.id], selected.blendNode.id);
	return true;
};

const isEligibleBlendSourceNode = (node: VectorNode): boolean =>
	!node.blend && !node.blendStep && !node.children;

const blendSourceNodeIdFromHit = (
	hitNodeId: string | null,
	api: HostApi,
): string | null => {
	if (!hitNodeId) return null;
	const document = api.getDoc();
	for (const layer of document.layers) {
		const node = layer.nodes.find((item) => item.id === hitNodeId);
		if (!node || !isEligibleBlendSourceNode(node)) continue;
		return node.id;
	}
	return null;
};

/**
 * Finds the nearest clickable source anchor/endpoint within screen tolerance.
 * Candidates are restricted to top-level pickable Blend sources on the active
 * artboard; later paint-order nodes win distance ties so the topmost anchor is
 * targeted, matching hover expectations.
 */
const hitBlendSourceAnchorStop = (
	context: PointerContext,
	api: HostApi,
): BlendSourceStop | null => {
	const document = api.getDoc();
	const artboardId = document.currentArtboardId ?? document.artboard.id;
	const tolerance = sceneUnitsForScreenPixels(api, HANDLE_HIT_RADIUS_PX);
	let best: {
		readonly stop: BlendSourceStop;
		readonly distance: number;
	} | null = null;
	for (const layer of document.layers) {
		if (!layer.visible || layer.locked) continue;
		for (const node of layer.nodes) {
			if (!isEligibleBlendSourceNode(node)) continue;
			if (!node.visible || node.locked) continue;
			if ((node.artboardId ?? artboardId) !== artboardId) continue;
			const matrix = matrixFromTransform(node.transform);
			for (const candidate of blendSourceAttachmentCandidates(node)) {
				const distance = pointDistance(
					context.point,
					applyMatrixToPoint(matrix, candidate.localPoint),
				);
				if (distance <= tolerance && (!best || distance <= best.distance)) {
					best = {
						stop: {
							nodeId: node.id,
							anchorRef: candidate.anchorRef,
							localPoint: candidate.localPoint,
						},
						distance,
					};
				}
			}
		}
	}
	return best?.stop ?? null;
};

/**
 * Resolves a pointer position to a Blend source stop. Anchor/endpoint
 * candidates win over the body hit; a body click keeps the legacy center
 * registration by omitting `localPoint`.
 */
const hitBlendSourceStop = (
	context: PointerContext,
	api: HostApi,
): BlendSourceStop | null => {
	const anchorStop = hitBlendSourceAnchorStop(context, api);
	if (anchorStop) return anchorStop;
	const bodyNodeId = blendSourceNodeIdFromHit(context.hitNodeId, api);
	return bodyNodeId ? { nodeId: bodyNodeId } : null;
};

const onBlendDown = (context: PointerContext, api: HostApi): void => {
	if (context.event.button !== 0) return;
	const editableSpine = hitEditableSpine(context, api);
	if (editableSpine) {
		resetBlendGesture();
		const subSelection = spineSubSelection(
			editableSpine.blendNodeId,
			editableSpine.target,
		);
		const store = useBlendToolStore.getState();
		store.setSelectedSpine(subSelection);
		store.setHoverSpine(subSelection);
		spineGesture = {
			blendNodeId: editableSpine.blendNodeId,
			originalSpine: editableSpine.spine,
			target: editableSpine.target,
			startPoint: editableSpine.localPoint,
			containerInverse: editableSpine.containerInverse,
			alignEndpointCenters: endpointAlignmentForTarget(
				editableSpine.spine,
				editableSpine.target,
			),
			persistSpine: editableSpine.persistSpine,
			dragging: false,
			transaction: null,
		};
		context.event.preventDefault();
		return;
	}
	const hitStop = hitBlendSourceStop(context, api);
	const store = useBlendToolStore.getState();

	if (!hitStop) {
		clearSpineSubSelection();
		resetBlendGesture();
		return;
	}
	clearSpineSubSelection();

	const sourceStops = store.sourceStops;
	const selected = selectedBlendSpine(api);
	if (sourceStops.length === 0 && selected?.blendNode.id) {
		if (insertBlendSource(selected, hitStop, api)) {
			context.event.preventDefault();
			return;
		}
	}

	if (sourceStops.length === 0) {
		store.setSourceStops([hitStop]);
		store.setHoverStop(null);
		store.setCursor(context.point);
		api.select(hitStop.nodeId, false);
		return;
	}

	if (sourceStops.some((stop) => stop.nodeId === hitStop.nodeId)) return;
	commitBlend([...sourceStops, hitStop], api);
};

const onBlendMove = (context: PointerContext, api: HostApi): void => {
	if (spineGesture) {
		const current = spineGesture;
		const localPoint = pointInBlendContainerSpace(current, context.point);
		const moved = pointDistance(localPoint, current.startPoint);
		if (
			!current.dragging &&
			moved < sceneUnitsForScreenPixels(api, DRAG_THRESHOLD_PX)
		) {
			return;
		}
		if (!current.dragging) {
			current.dragging = true;
			current.transaction = api.beginGestureTransaction(
				`blend-spine:${current.blendNodeId}`,
				EDIT_SPINE_LABEL,
			);
		}
		const nextSpine = nextSpineForGesture(current, localPoint, context.event);
		if (!nextSpine) return;
		if (!canUseCustomBlendSpine(nextSpine)) return;
		useSceneStore.getState().apply(
			createUpdateBlendSpineCommand(current.blendNodeId, nextSpine, {
				coalesceKey: current.transaction?.coalesceKey,
				alignEndpointCenters: current.alignEndpointCenters,
				persistSpine: current.persistSpine,
			}),
		);
		if (current.target.kind === "line-segment") {
			const subSelection = spineSubSelection(current.blendNodeId, {
				kind: "path-segment",
				index: 0,
				t: current.target.t,
			});
			const store = useBlendToolStore.getState();
			store.setSelectedSpine(subSelection);
			store.setHoverSpine(subSelection);
		}
		return;
	}
	const store = useBlendToolStore.getState();
	const editableSpine = hitEditableSpine(context, api);
	store.setHoverSpine(
		editableSpine
			? spineSubSelection(editableSpine.blendNodeId, editableSpine.target)
			: null,
	);
	const pendingStops = store.sourceStops;
	const hoverStop = editableSpine ? null : hitBlendSourceStop(context, api);
	store.setHoverStop(
		hoverStop && !pendingStops.some((stop) => stop.nodeId === hoverStop.nodeId)
			? hoverStop
			: null,
	);
	if (pendingStops.length === 0) return;
	store.setCursor(context.point);
};

const onBlendUp = (context: PointerContext, api: HostApi): void => {
	const current = spineGesture;
	if (!current) return;
	if (!current.dragging) {
		spineGesture = null;
		insertSpinePointFromSegmentClick(current);
		if (
			current.target.kind === "line-segment" ||
			current.target.kind === "path-segment"
		) {
			context.event.preventDefault();
		}
		return;
	}
	finishSpineGesture(api);
};

const onBlendKeyDown = (event: KeyboardEvent, api: HostApi): void => {
	if (event.key === "Escape") {
		const store = useBlendToolStore.getState();
		if (spineGesture || store.selectedSpine || store.hoverSpine) {
			event.preventDefault();
			cancelSpineGesture();
			clearSpineSubSelection();
			return;
		}
		event.preventDefault();
		resetBlendGesture();
		return;
	}
	if (event.key !== "Delete" && event.key !== "Backspace") return;
	if (!deleteSelectedSpinePoint(api)) return;
	event.preventDefault();
};

const blendHandler: BlendToolHandler = {
	id: "blend-tool",
	tool: "blend",
	onPointerDown: onBlendDown,
	onPointerMove: onBlendMove,
	onPointerUp: onBlendUp,
	onKeyDown: onBlendKeyDown,
	onDeactivate: (api) => {
		finishSpineGesture(api);
		clearSpineSubSelection();
		resetBlendGesture();
	},
};

export default blendHandler;
