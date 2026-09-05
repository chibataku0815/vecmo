import { useEffect } from "react";
import {
	rectNeedsBakedPath,
	roundedPolygonPathData,
	roundedRectPathData,
	roundedStarPathData,
	shapeNeedsBakedPath,
} from "@/entities/scene/model/corner-geometry";
import {
	matrixFromTransform,
	matrixToSvg,
	pathDataForGeometry,
} from "@/entities/scene/model/rendering";
import type { SceneDocument, VectorNode } from "@/entities/scene/model/types";
import type { ScalarEffectFieldMeshScene } from "@/shared/effect-field";
import { effectFieldCanvasState } from "../model/effect-field-canvas";
import { useEffectFieldEditorStore } from "../model/effect-field-editor-store";
import { cancelActiveGesture } from "./handler";

type OverlayProps = {
	readonly document: SceneDocument;
	readonly selection: {
		readonly nodeIds: readonly string[];
		readonly primary: string | null;
	};
	readonly viewport: { readonly zoom: number };
};

const PERCENT = 100;
const LINE_PX = 1.5;
const HANDLE_PX = 12;
const CENTER_PX = 9;
const SELECT_RING_PX = 19;

const polygonPoints = (node: VectorNode): string | null => {
	const geometry = node.geometry;
	if (geometry.kind === "polygon") {
		return geometry.points.map((point) => `${point.x},${point.y}`).join(" ");
	}
	if (geometry.kind !== "star") return null;
	const points: string[] = [];
	for (let index = 0; index < geometry.points * 2; index += 1) {
		const radius =
			index % 2 === 0 ? geometry.outerRadius : geometry.innerRadius;
		const angle = -Math.PI / 2 + (index / (geometry.points * 2)) * Math.PI * 2;
		points.push(
			`${geometry.center.x + Math.cos(angle) * radius},${geometry.center.y + Math.sin(angle) * radius}`,
		);
	}
	return points.join(" ");
};

function ContourShape({
	node,
	stroke,
	strokeWidth,
	dash,
	opacity = 1,
}: {
	readonly node: VectorNode;
	readonly stroke: string;
	readonly strokeWidth: number;
	readonly dash?: string;
	readonly opacity?: number;
}) {
	if (!node.visible) return null;
	const transform = matrixToSvg(matrixFromTransform(node.transform));
	const common = {
		fill: "none",
		stroke,
		strokeWidth,
		strokeDasharray: dash,
		strokeOpacity: opacity,
		transform,
	};
	if (node.children?.length) {
		return (
			<g transform={transform}>
				{node.children.map((child) => (
					<ContourShape
						key={child.id}
						node={child}
						stroke={stroke}
						strokeWidth={strokeWidth}
						dash={dash}
						opacity={opacity}
					/>
				))}
			</g>
		);
	}
	const geometry = node.geometry;
	switch (geometry.kind) {
		case "rect":
			return rectNeedsBakedPath(geometry) ? (
				<path {...common} d={roundedRectPathData(geometry)} />
			) : (
				<rect {...common} {...geometry.bounds} rx={geometry.cornerRadius} />
			);
		case "ellipse":
			return (
				<ellipse
					{...common}
					cx={geometry.bounds.x + geometry.bounds.width / 2}
					cy={geometry.bounds.y + geometry.bounds.height / 2}
					rx={geometry.bounds.width / 2}
					ry={geometry.bounds.height / 2}
				/>
			);
		case "line":
			return (
				<line
					{...common}
					x1={geometry.start.x}
					y1={geometry.start.y}
					x2={geometry.end.x}
					y2={geometry.end.y}
				/>
			);
		case "polygon":
			return shapeNeedsBakedPath(geometry) ? (
				<path {...common} d={roundedPolygonPathData(geometry)} />
			) : (
				<polygon {...common} points={polygonPoints(node) ?? ""} />
			);
		case "star":
			return shapeNeedsBakedPath(geometry) ? (
				<path {...common} d={roundedStarPathData(geometry)} />
			) : (
				<polygon {...common} points={polygonPoints(node) ?? ""} />
			);
		case "path": {
			const path = pathDataForGeometry(geometry);
			return path ? (
				<path {...common} d={path} fillRule={geometry.fillRule} />
			) : null;
		}
		case "image":
		case "text":
			return <rect {...common} {...geometry.bounds} />;
	}
}

function MeshGuide({
	scene,
	selected,
	strokeWidth,
	handleRadius,
	selectRadius,
}: {
	readonly scene: ScalarEffectFieldMeshScene;
	readonly selected: { readonly row: number; readonly col: number } | null;
	readonly strokeWidth: number;
	readonly handleRadius: number;
	readonly selectRadius: number;
}) {
	const path = scene.segments
		.map(
			(segment) =>
				`M${segment.from.x},${segment.from.y}L${segment.to.x},${segment.to.y}`,
		)
		.join("");
	return (
		<>
			<path
				d={path}
				fill="none"
				stroke="#2ec4b6"
				strokeWidth={strokeWidth}
				strokeOpacity={0.8}
				vectorEffect="non-scaling-stroke"
			/>
			{scene.points.map((point) => {
				const active =
					selected?.row === point.row && selected.col === point.col;
				const channel = Math.round(55 + point.value * 200);
				return (
					<g key={`${point.row}:${point.col}`}>
						{active ? (
							<circle
								cx={point.artboard.x}
								cy={point.artboard.y}
								r={selectRadius}
								fill="none"
								stroke="#f7f4eb"
								strokeWidth={strokeWidth}
							/>
						) : null}
						<circle
							cx={point.artboard.x}
							cy={point.artboard.y}
							r={handleRadius}
							fill={`rgb(${channel} ${channel} ${channel})`}
							stroke="#191817"
							strokeWidth={strokeWidth}
						/>
					</g>
				);
			})}
		</>
	);
}

const pointPath = (
	points: readonly { readonly x: number; readonly y: number }[],
): string =>
	points
		.map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
		.join("");

function EffectFieldOverlay({ document, selection, viewport }: OverlayProps) {
	const descriptorId = useEffectFieldEditorStore((state) => state.descriptorId);
	const meshPoint = useEffectFieldEditorStore((state) => state.meshPoint);
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
	const nodeId = selection.primary ?? selection.nodeIds[0];
	if (!nodeId) return null;
	const state = effectFieldCanvasState(document, nodeId, descriptorId);
	if (!state) return null;
	const scale = Math.max(viewport.zoom / PERCENT, 0.001);
	const strokeWidth = LINE_PX / scale;
	const handleRadius = HANDLE_PX / scale / 2;
	const centerRadius = CENTER_PX / scale / 2;
	const selectRadius = SELECT_RING_PX / scale / 2;
	const selectedMeshPoint =
		meshPoint?.nodeId === nodeId && meshPoint.fieldId === state.fieldId
			? meshPoint
			: null;
	return (
		<svg
			className="pointer-events-none absolute inset-0 h-full w-full"
			viewBox={`0 0 ${document.artboard.width} ${document.artboard.height}`}
			aria-hidden="true"
		>
			{state.mesh ? (
				<MeshGuide
					scene={state.mesh}
					selected={selectedMeshPoint}
					strokeWidth={strokeWidth}
					handleRadius={handleRadius}
					selectRadius={selectRadius}
				/>
			) : null}
			{state.linear ? (
				<>
					<line
						x1={state.linear.from.x}
						y1={state.linear.from.y}
						x2={state.linear.to.x}
						y2={state.linear.to.y}
						stroke="#2ec4b6"
						strokeWidth={strokeWidth}
						vectorEffect="non-scaling-stroke"
					/>
					{[
						{ id: "from", point: state.linear.from, center: false },
						{ id: "center", point: state.linear.center, center: true },
						{ id: "to", point: state.linear.to, center: false },
					].map(({ id, point, center }) => (
						<circle
							key={id}
							cx={point.x}
							cy={point.y}
							r={center ? centerRadius : handleRadius}
							fill={center ? "#2ec4b6" : "#f7f4eb"}
							stroke="#191817"
							strokeWidth={strokeWidth}
						/>
					))}
				</>
			) : null}
			{state.radial ? (
				<>
					<path
						d={pointPath(state.radial.contour)}
						fill="none"
						stroke="#2ec4b6"
						strokeWidth={strokeWidth}
						strokeDasharray={`${4 / scale} ${3 / scale}`}
						vectorEffect="non-scaling-stroke"
					/>
					{[
						{ id: "center", point: state.radial.center, center: true },
						{
							id: "radius-x",
							point: state.radial.radiusXHandle,
							center: false,
						},
						{
							id: "radius-y",
							point: state.radial.radiusYHandle,
							center: false,
						},
					].map(({ id, point, center }) => (
						<circle
							key={id}
							cx={point.x}
							cy={point.y}
							r={center ? centerRadius : handleRadius}
							fill={center ? "#2ec4b6" : "#f7f4eb"}
							stroke="#191817"
							strokeWidth={strokeWidth}
						/>
					))}
				</>
			) : null}
			{state.rect ? (
				<>
					<path
						d={pointPath(state.rect.contour)}
						fill="none"
						stroke="#2ec4b6"
						strokeWidth={strokeWidth}
						strokeDasharray={`${4 / scale} ${3 / scale}`}
						vectorEffect="non-scaling-stroke"
					/>
					{[
						{ id: "center", point: state.rect.center, center: true },
						{ id: "width", point: state.rect.widthHandle, center: false },
						{ id: "height", point: state.rect.heightHandle, center: false },
					].map(({ id, point, center }) => (
						<circle
							key={id}
							cx={point.x}
							cy={point.y}
							r={center ? centerRadius : handleRadius}
							fill={center ? "#2ec4b6" : "#f7f4eb"}
							stroke="#191817"
							strokeWidth={strokeWidth}
						/>
					))}
				</>
			) : null}
			{state.contour ? (
				<>
					<ContourShape
						node={state.node}
						stroke="#2ec4b6"
						strokeWidth={
							state.contour.source.width *
							Math.min(state.bounds.width, state.bounds.height) *
							2
						}
						opacity={0.14}
					/>
					<ContourShape
						node={state.node}
						stroke="#2ec4b6"
						strokeWidth={strokeWidth}
						dash={`${4 / scale} ${3 / scale}`}
					/>
					<circle
						cx={state.contour.handle.x}
						cy={state.contour.handle.y}
						r={handleRadius}
						fill="#f7f4eb"
						stroke="#191817"
						strokeWidth={strokeWidth}
					/>
				</>
			) : null}
		</svg>
	);
}

export const overlay = {
	id: "effect-field-direct-controls",
	tool: "effect" as const,
	paintOrder: 25,
	Component: EffectFieldOverlay,
};
