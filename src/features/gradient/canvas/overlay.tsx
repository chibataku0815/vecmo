import { Trash } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import {
	type GradientPaint,
	indexOfStop,
	paintLeadColor,
	removeStop,
	setStopColor,
	setStopOpacity,
} from "@/entities/scene/model/gradient-edit";
import {
	createUpdateArtboardCommand,
	createUpdateNodeStyleCommand,
} from "@/entities/scene/model/node-commands";
import {
	findArtboardById,
	findNode,
	type NormalizedArtboard,
} from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import type {
	Paint,
	SceneDocument,
	VectorNode,
} from "@/entities/scene/model/types";
import { ColorPicker } from "@/shared/ui/ColorPicker";
import {
	type GradientPaintRole,
	useGradientEditorStore,
} from "../model/editor-store";
import {
	artboardGradientHandleScene,
	artboardGradientStopPoints,
	draggableGradient,
	type GradientStopPoint,
	gradientHandleScene,
	gradientStopPoints,
} from "../model/handles";
import { cancelActiveGesture } from "./handler";

const PERCENT = 100;
const LINE_PX = 1.5;
const STOP_PX = 13;
const SELECT_RING_PX = 20;

type GradientStopSub = {
	readonly nodeId: string;
	readonly kind: "gradient-stop";
	readonly role: "fills" | "strokes";
	readonly stopId: string;
};

type OverlayProps = {
	readonly document: SceneDocument;
	readonly selection: {
		readonly nodeIds: readonly string[];
		readonly primary: string | null;
		readonly selectedArtboardId: string | null;
		// Mirrors the host's wider sub-selection union; this overlay reads only the
		// gradient-stop variant and ignores the path variants.
		readonly sub:
			| GradientStopSub
			| {
					readonly nodeId: string;
					readonly kind: "anchor" | "handle-in" | "handle-out";
			  }
			| null;
	};
	readonly viewport: { readonly zoom: number };
};

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

type GradientOverlayTarget = NodeGradientTarget | ArtboardGradientTarget;

const targetKey = (target: GradientOverlayTarget): string =>
	target.kind === "node"
		? `node:${target.node.id}:${target.role}`
		: `artboard:${target.artboard.id}:fills`;

const primaryPaints = (
	target: GradientOverlayTarget,
): readonly Paint[] | undefined =>
	target.kind === "node"
		? target.role === "fills"
			? target.node.style.fills
			: target.node.style.strokes
		: target.artboard.fills;

const paintRolePatch = (role: GradientPaintRole, paints: readonly Paint[]) =>
	role === "fills" ? { fills: paints } : { strokes: paints };

const artboardDraggableGradient = (
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

const targetGradientPaint = (
	target: GradientOverlayTarget,
): GradientPaint | null =>
	target.kind === "node"
		? draggableGradient(target.node, target.role)
		: artboardDraggableGradient(target.artboard);

const gradientHandleSceneForTarget = (
	target: GradientOverlayTarget,
	paint: GradientPaint,
) =>
	target.kind === "node"
		? gradientHandleScene(target.node, paint)
		: artboardGradientHandleScene(paint);

const gradientStopPointsForTarget = (
	target: GradientOverlayTarget,
	paint: GradientPaint,
) =>
	target.kind === "node"
		? gradientStopPoints(target.node, paint)
		: artboardGradientStopPoints(paint);

/** Writes the target paint stack with `paint` primary, coalescing scrubbed edits. */
function applyStopPaint(
	target: GradientOverlayTarget,
	paint: GradientPaint,
	coalesceKey: string,
): void {
	const tail = primaryPaints(target)?.slice(1) ?? [];
	if (target.kind === "artboard") {
		useSceneStore.getState().apply({
			...createUpdateArtboardCommand(target.artboard.id, {
				background: paintLeadColor(paint, target.artboard.background),
				fills: [paint, ...tail],
			}),
			coalesceKey,
		});
		return;
	}
	useSceneStore.getState().apply({
		...createUpdateNodeStyleCommand(
			target.node.id,
			paintRolePatch(target.role, [paint, ...tail]),
			{ preservesPaintIndices: true },
		),
		coalesceKey,
	});
}

/**
 * The inline color/opacity editor anchored at a stop, opened by double-clicking the
 * stop on the canvas. Positioned with artboard percentages so it tracks the stop
 * under pan and zoom; its own pointer events are isolated from the canvas handler.
 */
function StopEditorPopover({
	target,
	paint,
	stop,
	artboard,
}: {
	readonly target: GradientOverlayTarget;
	readonly paint: GradientPaint;
	readonly stop: GradientStopPoint;
	readonly artboard: SceneDocument["artboard"];
}) {
	const popoverRef = useRef<HTMLDivElement | null>(null);
	// Dismiss on Escape or a press outside the popover. Document-level capture is
	// used so Escape works even while focus is inside the popover's own inputs (the
	// tool handler's keydown seam does not fire when focus is in an editable field).
	useEffect(() => {
		const close = () => useGradientEditorStore.getState().closeStopEditor();
		const onDocPointerDown = (event: PointerEvent) => {
			const target = event.target;
			if (
				popoverRef.current &&
				target instanceof Node &&
				!popoverRef.current.contains(target)
			) {
				close();
			}
		};
		const onDocKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") close();
		};
		document.addEventListener("pointerdown", onDocPointerDown, true);
		document.addEventListener("keydown", onDocKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onDocPointerDown, true);
			document.removeEventListener("keydown", onDocKeyDown);
		};
	}, []);

	const index = indexOfStop(paint, stop.id);
	const left = `${(stop.point.x / artboard.width) * PERCENT}%`;
	const top = `${(stop.point.y / artboard.height) * PERCENT}%`;

	const onColor = (value: string): void => {
		if (index < 0) return;
		applyStopPaint(
			target,
			setStopColor(paint, index, value),
			`gradient-stop-color:${targetKey(target)}:${stop.id}`,
		);
	};
	const onAlpha = (value: number): void => {
		if (index < 0) return;
		applyStopPaint(
			target,
			setStopOpacity(paint, index, value),
			`gradient-stop-opacity:${targetKey(target)}:${stop.id}`,
		);
	};
	const onDelete = (): void => {
		const removed = removeStop(paint, index);
		if (!removed) return;
		applyStopPaint(
			target,
			removed,
			`gradient-stop-delete:${targetKey(target)}:${stop.id}`,
		);
		useGradientEditorStore.getState().closeStopEditor();
	};

	return (
		<div
			ref={popoverRef}
			className="-translate-x-1/2 pointer-events-auto absolute z-30 flex w-[232px] translate-y-[calc(-100%-12px)] flex-col gap-2 rounded-md border border-white/12 bg-surface-raised/98 p-2 shadow-2xl shadow-black/55 backdrop-blur-xl"
			style={{ left, top }}
			onPointerDown={(event) => event.stopPropagation()}
		>
			<ColorPicker
				value={stop.color}
				onChange={onColor}
				onCommit={(hex) => {
					onColor(hex);
					return true;
				}}
				alpha={stop.opacity}
				onAlphaChange={onAlpha}
			/>
			<button
				type="button"
				onClick={onDelete}
				className="flex h-6 items-center justify-center gap-1 rounded-md border border-white/10 bg-white/[0.04] text-fg-secondary text-ui transition hover:bg-white/[0.08] hover:text-fg"
			>
				<Trash aria-hidden="true" size={12} /> Delete stop
			</button>
		</div>
	);
}

/**
 * Draws the gradient axis and its draggable stop dots for the active node or
 * artboard Frame-fill target while the gradient tool is active. Stop dots are
 * filled with each stop's own color; the selected stop gets a ring, and a
 * double-clicked stop shows the inline editor. The dots are drawn
 * `pointer-events-none` (the host SVG captures gestures and routes them to the
 * gradient handler); only the popover opts back into pointer events.
 */
function GradientOverlay({ document, selection, viewport }: OverlayProps) {
	// The host wires no pointercancel seam, so seal an interrupted gesture here
	// (touch interruption / window blur) instead of stranding the transaction.
	useEffect(() => {
		const seal = () => cancelActiveGesture();
		window.addEventListener("pointercancel", seal);
		window.addEventListener("blur", seal);
		return () => {
			seal();
			window.removeEventListener("pointercancel", seal);
			window.removeEventListener("blur", seal);
		};
	}, []);

	const selectedStoreStop = useGradientEditorStore(
		(state) => state.selectedStop,
	);
	const editingStopId = useGradientEditorStore((state) => state.editingStopId);
	const requestedRole = useGradientEditorStore((state) => state.targetRole);

	const primaryId = selection.primary ?? selection.nodeIds[0];
	const node = primaryId ? findNode(document, primaryId) : null;
	const sub = selection.sub;
	const fallbackRole =
		sub?.kind === "gradient-stop" && sub.nodeId === node?.id ? sub.role : null;
	const targetRole =
		node &&
		!draggableGradient(node, requestedRole) &&
		fallbackRole &&
		draggableGradient(node, fallbackRole)
			? fallbackRole
			: requestedRole;
	const nodeTarget: NodeGradientTarget | null =
		node && draggableGradient(node, targetRole)
			? { kind: "node", node, role: targetRole }
			: null;
	const artboard =
		!nodeTarget && selection.selectedArtboardId
			? findArtboardById(document, selection.selectedArtboardId)
			: null;
	const artboardTarget: ArtboardGradientTarget | null =
		artboard && artboardDraggableGradient(artboard)
			? { kind: "artboard", artboard, role: "fills" }
			: null;
	const target: GradientOverlayTarget | null = nodeTarget ?? artboardTarget;
	const paint = target ? targetGradientPaint(target) : null;
	if (!target || !paint) return null;

	const scene = gradientHandleSceneForTarget(target, paint);
	const stopPoints = gradientStopPointsForTarget(target, paint);
	const selectedStopId =
		target.kind === "node"
			? sub?.kind === "gradient-stop" &&
				sub.nodeId === target.node.id &&
				sub.role === target.role
				? sub.stopId
				: null
			: selectedStoreStop?.targetKey === targetKey(target)
				? selectedStoreStop.stopId
				: null;
	const editingStop = editingStopId
		? stopPoints.find((stop) => stop.id === editingStopId)
		: undefined;

	const scale = Math.max(viewport.zoom / PERCENT, 0.001);
	const strokeWidth = LINE_PX / scale;

	return (
		<>
			<svg
				className="pointer-events-none absolute inset-0 h-full w-full"
				viewBox={`0 0 ${document.artboard.width} ${document.artboard.height}`}
				aria-hidden="true"
			>
				<line
					x1={scene.line.a.x}
					y1={scene.line.a.y}
					x2={scene.line.b.x}
					y2={scene.line.b.y}
					stroke="#191817"
					strokeWidth={strokeWidth * 2.5}
					strokeLinecap="round"
					vectorEffect="non-scaling-stroke"
				/>
				<line
					x1={scene.line.a.x}
					y1={scene.line.a.y}
					x2={scene.line.b.x}
					y2={scene.line.b.y}
					stroke="#f7f4eb"
					strokeWidth={strokeWidth}
					strokeLinecap="round"
					vectorEffect="non-scaling-stroke"
				/>
				{stopPoints.map((stop) => {
					const selected = stop.id !== "" && stop.id === selectedStopId;
					return (
						<g key={stop.id || `${stop.offset}-${stop.color}`}>
							{selected ? (
								<circle
									cx={stop.point.x}
									cy={stop.point.y}
									r={SELECT_RING_PX / scale / 2}
									fill="none"
									stroke="#2ec4b6"
									strokeWidth={strokeWidth * 1.5}
									vectorEffect="non-scaling-stroke"
								/>
							) : null}
							<circle
								cx={stop.point.x}
								cy={stop.point.y}
								r={STOP_PX / scale / 2}
								fill={stop.color || "#f7f4eb"}
								fillOpacity={stop.opacity}
								stroke="#191817"
								strokeWidth={strokeWidth}
								vectorEffect="non-scaling-stroke"
							/>
							<circle
								cx={stop.point.x}
								cy={stop.point.y}
								r={STOP_PX / scale / 2}
								fill="none"
								stroke="#f7f4eb"
								strokeWidth={strokeWidth * 0.75}
								vectorEffect="non-scaling-stroke"
							/>
						</g>
					);
				})}
			</svg>
			{editingStop ? (
				<StopEditorPopover
					target={target}
					paint={paint}
					stop={editingStop}
					artboard={
						target.kind === "artboard" ? target.artboard : document.artboard
					}
				/>
			) : null}
		</>
	);
}

export const overlay = {
	id: "gradient-handles",
	tool: "gradient" as const,
	Component: GradientOverlay,
};
