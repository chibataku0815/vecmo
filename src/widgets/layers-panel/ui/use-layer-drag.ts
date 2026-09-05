import type { PointerEvent as ReactPointerEvent } from "react";
import { useRef, useState } from "react";
import type { SceneCommand } from "@/entities/scene/model/command";
import type { SceneLayer } from "@/entities/scene/model/types";
import {
	buildDropLayerRowCommand,
	buildReparentNodeDropCommand,
} from "@/features/layer-hierarchy";
import {
	DRAG_THRESHOLD_PX,
	type DropPlacement,
	normalizeDragSet,
	resolveDropTarget,
} from "../model/drop-target";
import type { ArtboardLayerPanelRow } from "../model/rows";

/** The decoration one row renders during a drag: a line edge or a container ring. */
export type LayerDropIndicator = {
	readonly anchorRowId: string;
	readonly kind: DropPlacement;
	readonly depth: number;
};

type DragResolution = {
	readonly indicator: LayerDropIndicator | null;
	readonly command: SceneCommand | null;
};

const NO_DROP: DragResolution = { indicator: null, command: null };

type ActiveGesture = {
	readonly pointerId: number;
	readonly startX: number;
	readonly startY: number;
	readonly element: HTMLElement;
	readonly grabbedRow: ArtboardLayerPanelRow;
	captured: boolean;
	draggedIds: readonly string[];
	command: SceneCommand | null;
};

export type UseLayerDragParams = {
	readonly rows: readonly ArtboardLayerPanelRow[];
	readonly layers: readonly SceneLayer[];
	readonly selectedNodeIds: readonly string[];
	readonly enabled: boolean;
	readonly applyCommand: (command: SceneCommand) => void;
	readonly onGrabUnselected: (nodeId: string) => void;
};

export type LayerRowDragProps = {
	readonly "data-layer-row-id": string;
	readonly onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
	readonly onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
	readonly onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
	readonly onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
};

export type LayerDragController = {
	readonly indicator: LayerDropIndicator | null;
	readonly rowDragProps: (row: ArtboardLayerPanelRow) => LayerRowDragProps;
	/** True exactly once after a completed drag, so the trailing click does not also select. */
	readonly consumeDragClick: () => boolean;
};

const resolveLayerDrop = (
	grabbedLayerId: string,
	hoveredRow: ArtboardLayerPanelRow,
	rect: DOMRect,
	pointerY: number,
	layers: readonly SceneLayer[],
): DragResolution => {
	if (hoveredRow.kind !== "layer" || hoveredRow.layerId === grabbedLayerId) {
		return NO_DROP;
	}
	const fraction = rect.height > 0 ? (pointerY - rect.top) / rect.height : 0;
	const kind: DropPlacement = fraction < 0.5 ? "before" : "after";
	const command = buildDropLayerRowCommand(
		layers,
		grabbedLayerId,
		hoveredRow.layerId,
		kind,
	);
	if (!command) return NO_DROP;
	return {
		indicator: { anchorRowId: hoveredRow.rowId, kind, depth: 0 },
		command,
	};
};

/**
 * Pointer-driven drag-and-drop for the layers panel. Every structural decision
 * is delegated to the pure resolver ({@link resolveDropTarget}); this hook only
 * owns the gesture lifecycle (threshold, pointer-id pinning, capture) and turns a
 * release into one undoable command. Node rows reparent; layer rows reorder.
 */
export function useLayerDrag(params: UseLayerDragParams): LayerDragController {
	const {
		rows,
		layers,
		selectedNodeIds,
		enabled,
		applyCommand,
		onGrabUnselected,
	} = params;
	const gestureRef = useRef<ActiveGesture | null>(null);
	const movedRef = useRef(false);
	const [indicator, setIndicator] = useState<LayerDropIndicator | null>(null);

	const resolveAt = (
		gesture: ActiveGesture,
		clientX: number,
		clientY: number,
	): DragResolution => {
		const point = gesture.element.ownerDocument.elementFromPoint(
			clientX,
			clientY,
		);
		const rowElement = point?.closest("[data-layer-row-id]");
		const rowId = rowElement?.getAttribute("data-layer-row-id");
		if (!rowElement || !rowId) return NO_DROP;
		const hoveredRow = rows.find((row) => row.rowId === rowId);
		if (!hoveredRow) return NO_DROP;
		const rect = rowElement.getBoundingClientRect();

		if (gesture.grabbedRow.kind === "layer") {
			return resolveLayerDrop(
				gesture.grabbedRow.layerId,
				hoveredRow,
				rect,
				clientY,
				layers,
			);
		}
		const target = resolveDropTarget(
			rows,
			hoveredRow,
			{ top: rect.top, height: rect.height },
			clientY,
			gesture.draggedIds,
		);
		if (!target?.valid) return NO_DROP;
		const command = buildReparentNodeDropCommand(gesture.draggedIds, target);
		if (!command) return NO_DROP;
		return {
			indicator: {
				anchorRowId: target.anchorRowId,
				kind: target.kind,
				depth: target.indicatorDepth,
			},
			command,
		};
	};

	const onPointerDown = (
		row: ArtboardLayerPanelRow,
		event: ReactPointerEvent<HTMLDivElement>,
	): void => {
		if (!enabled || event.button !== 0 || row.kind === "artboard") return;
		gestureRef.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			element: event.currentTarget,
			grabbedRow: row,
			captured: false,
			draggedIds: [],
			command: null,
		};
		movedRef.current = false;
	};

	const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
		const gesture = gestureRef.current;
		if (!gesture || event.pointerId !== gesture.pointerId) return;
		if (!gesture.captured) {
			const dx = event.clientX - gesture.startX;
			const dy = event.clientY - gesture.startY;
			if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
			try {
				gesture.element.setPointerCapture(gesture.pointerId);
			} catch {
				// Synthetic events (tests) reject capture; the gesture still resolves.
			}
			gesture.captured = true;
			movedRef.current = true;
			const grabbed = gesture.grabbedRow;
			if (grabbed.kind === "node") {
				const dragWholeSelection =
					selectedNodeIds.includes(grabbed.nodeId) &&
					selectedNodeIds.length > 1;
				gesture.draggedIds = dragWholeSelection
					? normalizeDragSet(rows, new Set(selectedNodeIds))
					: [grabbed.nodeId];
				if (!selectedNodeIds.includes(grabbed.nodeId)) {
					onGrabUnselected(grabbed.nodeId);
				}
			}
		}
		const resolution = resolveAt(gesture, event.clientX, event.clientY);
		gesture.command = resolution.command;
		setIndicator(resolution.indicator);
	};

	const finishDrag = (
		event: ReactPointerEvent<HTMLDivElement>,
		commit: boolean,
	): void => {
		const gesture = gestureRef.current;
		if (!gesture || event.pointerId !== gesture.pointerId) return;
		gestureRef.current = null;
		setIndicator(null);
		try {
			gesture.element.releasePointerCapture(gesture.pointerId);
		} catch {
			// Capture may never have been granted; releasing is best-effort.
		}
		if (commit && gesture.captured && gesture.command) {
			applyCommand(gesture.command);
		}
	};

	return {
		indicator,
		rowDragProps: (row) => ({
			"data-layer-row-id": row.rowId,
			onPointerDown: (event) => onPointerDown(row, event),
			onPointerMove,
			onPointerUp: (event) => finishDrag(event, true),
			onPointerCancel: (event) => finishDrag(event, false),
		}),
		consumeDragClick: () => {
			if (!movedRef.current) return false;
			movedRef.current = false;
			return true;
		},
	};
}
