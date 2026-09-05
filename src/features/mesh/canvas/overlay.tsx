import { useEffect, useRef } from "react";
import {
	meshHandleDirections,
	meshHandleRest,
	meshPointAt,
	setMeshPointColor,
	setMeshPointOpacity,
} from "@/entities/scene/model/mesh-edit";
import { createUpdateNodeStyleCommand } from "@/entities/scene/model/node-commands";
import {
	applyMatrixToPoint,
	matrixFromTransform,
} from "@/entities/scene/model/rendering";
import { findNode } from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import type {
	MeshGradientPaint,
	SceneDocument,
	VectorNode,
} from "@/entities/scene/model/types";
import { ColorPicker } from "@/shared/ui/ColorPicker";
import { useMeshEditorStore } from "../model/editor-store";
import { cancelActiveGesture } from "./handler";

const PERCENT = 100;
const LINE_PX = 1.25;
const POINT_PX = 12;
const HANDLE_PX = 9;
const SELECT_RING_PX = 20;
const FILL_ROLE = "fills" as const;

type MeshNodeSub = {
	readonly nodeId: string;
	readonly kind: "mesh-node";
	readonly role: "fills" | "strokes";
	readonly row: number;
	readonly col: number;
};

type OverlayProps = {
	readonly document: SceneDocument;
	readonly selection: {
		readonly nodeIds: readonly string[];
		readonly primary: string | null;
		readonly sub:
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
	};
	readonly viewport: { readonly zoom: number };
};

const meshFillOf = (node: VectorNode): MeshGradientPaint | null => {
	const paint = node.style.fills?.[0];
	return paint?.kind === "mesh-gradient" ? paint : null;
};

/** Writes the node's fill stack with `paint` primary, coalescing scrubbed edits. */
function applyMeshPaint(
	node: VectorNode,
	paint: MeshGradientPaint,
	coalesceKey: string,
): void {
	const tail = node.style.fills?.slice(1) ?? [];
	useSceneStore.getState().apply({
		...createUpdateNodeStyleCommand(
			node.id,
			{ fills: [paint, ...tail] },
			{ preservesPaintIndices: true },
		),
		coalesceKey,
	});
}

/**
 * Inline color/opacity editor anchored at a mesh point, opened by double-clicking
 * the point on the canvas. Positioned with artboard percentages so it tracks the
 * point under pan and zoom; its own pointer events are isolated from the handler.
 */
function MeshPointPopover({
	node,
	paint,
	row,
	col,
	artboardPoint,
	artboard,
}: {
	readonly node: VectorNode;
	readonly paint: MeshGradientPaint;
	readonly row: number;
	readonly col: number;
	readonly artboardPoint: { readonly x: number; readonly y: number };
	readonly artboard: SceneDocument["artboard"];
}) {
	const popoverRef = useRef<HTMLDivElement | null>(null);
	useEffect(() => {
		const close = () => useMeshEditorStore.getState().closePointEditor();
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

	const meshPoint = meshPointAt(paint, row, col);
	if (!meshPoint) return null;
	const color = meshPoint.color;
	const opacity = meshPoint.opacity ?? 1;
	const left = `${(artboardPoint.x / artboard.width) * PERCENT}%`;
	const top = `${(artboardPoint.y / artboard.height) * PERCENT}%`;

	const onColor = (value: string): void =>
		applyMeshPaint(
			node,
			setMeshPointColor(paint, row, col, value),
			`mesh-point-color:${node.id}:${row}:${col}`,
		);
	const onAlpha = (value: number): void =>
		applyMeshPaint(
			node,
			setMeshPointOpacity(paint, row, col, value),
			`mesh-point-opacity:${node.id}:${row}:${col}`,
		);

	return (
		<div
			ref={popoverRef}
			className="-translate-x-1/2 pointer-events-auto absolute z-30 flex w-[232px] translate-y-[calc(-100%-12px)] flex-col gap-2 rounded-md border border-white/12 bg-surface-raised/98 p-2 shadow-2xl shadow-black/55 backdrop-blur-xl"
			style={{ left, top }}
			onPointerDown={(event) => event.stopPropagation()}
		>
			<ColorPicker
				value={color}
				onChange={onColor}
				onCommit={(hex) => {
					onColor(hex);
					return true;
				}}
				alpha={opacity}
				onAlphaChange={onAlpha}
			/>
		</div>
	);
}

/**
 * Draws the mesh grid lines and per-point dots for the primary selected node's
 * mesh fill while the mesh tool is active. Dots are filled with each point's own
 * color; the selected point gets a ring, and a double-clicked point shows the
 * inline editor. The grid is `pointer-events-none` (the host SVG captures gestures
 * and routes them to the mesh handler); only the popover opts back in.
 */
function MeshOverlay({ document, selection, viewport }: OverlayProps) {
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

	const editingPoint = useMeshEditorStore((state) => state.editingPoint);

	const primaryId = selection.primary ?? selection.nodeIds[0];
	const node = primaryId ? findNode(document, primaryId) : null;
	const paint = node ? meshFillOf(node) : null;
	if (!node || !paint) return null;

	const matrix = matrixFromTransform(node.transform);
	const { rows, cols } = paint;
	const positions: { readonly x: number; readonly y: number }[][] = [];
	for (let row = 0; row < rows; row += 1) {
		const line: { x: number; y: number }[] = [];
		for (let col = 0; col < cols; col += 1) {
			const meshPoint = paint.points[row * cols + col];
			line.push(
				meshPoint
					? applyMatrixToPoint(matrix, meshPoint.point)
					: { x: 0, y: 0 },
			);
		}
		positions.push(line);
	}

	const sub = selection.sub;
	const selected =
		sub?.kind === "mesh-node" &&
		sub.nodeId === node.id &&
		sub.role === FILL_ROLE
			? { row: sub.row, col: sub.col }
			: null;

	const scale = Math.max(viewport.zoom / PERCENT, 0.001);
	const strokeWidth = LINE_PX / scale;

	const segments: string[] = [];
	for (let row = 0; row < rows; row += 1) {
		for (let col = 0; col < cols - 1; col += 1) {
			segments.push(
				`M${positions[row][col].x},${positions[row][col].y}L${positions[row][col + 1].x},${positions[row][col + 1].y}`,
			);
		}
	}
	for (let col = 0; col < cols; col += 1) {
		for (let row = 0; row < rows - 1; row += 1) {
			segments.push(
				`M${positions[row][col].x},${positions[row][col].y}L${positions[row + 1][col].x},${positions[row + 1][col].y}`,
			);
		}
	}
	const gridPath = segments.join("");

	const editingArtboardPoint =
		editingPoint && positions[editingPoint.row]?.[editingPoint.col];

	return (
		<>
			<svg
				className="pointer-events-none absolute inset-0 h-full w-full"
				viewBox={`0 0 ${document.artboard.width} ${document.artboard.height}`}
				aria-hidden="true"
			>
				<path
					d={gridPath}
					fill="none"
					stroke="#191817"
					strokeWidth={strokeWidth * 2.25}
					strokeLinecap="round"
					vectorEffect="non-scaling-stroke"
				/>
				<path
					d={gridPath}
					fill="none"
					stroke="#f7f4eb"
					strokeWidth={strokeWidth}
					strokeLinecap="round"
					vectorEffect="non-scaling-stroke"
				/>
				{positions.flatMap((line, row) =>
					line.map((position, col) => {
						const meshPoint = paint.points[row * cols + col];
						const isSelected = selected?.row === row && selected?.col === col;
						return (
							// biome-ignore lint/suspicious/noArrayIndexKey: a mesh point's identity IS its stable (row, col) grid position; the grid never reorders.
							<g key={`${row}-${col}`}>
								{isSelected ? (
									<circle
										cx={position.x}
										cy={position.y}
										r={SELECT_RING_PX / scale / 2}
										fill="none"
										stroke="#2ec4b6"
										strokeWidth={strokeWidth * 1.5}
										vectorEffect="non-scaling-stroke"
									/>
								) : null}
								<circle
									cx={position.x}
									cy={position.y}
									r={POINT_PX / scale / 2}
									fill={meshPoint?.color || "#f7f4eb"}
									fillOpacity={meshPoint?.opacity ?? 1}
									stroke="#191817"
									strokeWidth={strokeWidth}
									vectorEffect="non-scaling-stroke"
								/>
								<circle
									cx={position.x}
									cy={position.y}
									r={POINT_PX / scale / 2}
									fill="none"
									stroke="#f7f4eb"
									strokeWidth={strokeWidth * 0.75}
									vectorEffect="non-scaling-stroke"
								/>
							</g>
						);
					}),
				)}
				{selected
					? meshHandleDirections(paint, selected.row, selected.col).map(
							(direction) => {
								const restLocal = meshHandleRest(
									paint,
									selected.row,
									selected.col,
									direction,
								);
								const anchor = positions[selected.row]?.[selected.col];
								if (!restLocal || !anchor) return null;
								const rest = applyMatrixToPoint(matrix, restLocal);
								return (
									<g key={`handle-${direction}`}>
										<line
											x1={anchor.x}
											y1={anchor.y}
											x2={rest.x}
											y2={rest.y}
											stroke="#2ec4b6"
											strokeWidth={strokeWidth}
											vectorEffect="non-scaling-stroke"
										/>
										<circle
											cx={rest.x}
											cy={rest.y}
											r={HANDLE_PX / scale / 2}
											fill="#2ec4b6"
											stroke="#f7f4eb"
											strokeWidth={strokeWidth * 0.75}
											vectorEffect="non-scaling-stroke"
										/>
									</g>
								);
							},
						)
					: null}
			</svg>
			{editingPoint && editingArtboardPoint ? (
				<MeshPointPopover
					node={node}
					paint={paint}
					row={editingPoint.row}
					col={editingPoint.col}
					artboardPoint={editingArtboardPoint}
					artboard={document.artboard}
				/>
			) : null}
		</>
	);
}

export const overlay = {
	id: "mesh-handles",
	tool: "mesh" as const,
	Component: MeshOverlay,
};
