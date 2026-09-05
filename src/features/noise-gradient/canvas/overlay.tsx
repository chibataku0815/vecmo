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
import { findNode } from "@/entities/scene/model/selectors";
import type {
	NodeGeometry,
	SceneDocument,
	VectorNode,
} from "@/entities/scene/model/types";
import {
	type NoiseGradientFieldMeshScene,
	noiseGradientAxisScene,
	noiseGradientFieldMeshScene,
} from "../model/axis";
import { noiseGradientToolControlState } from "../model/tool-controls";
import { cancelActiveGesture } from "./handler";

const PERCENT = 100;
const LINE_PX = 1.6;
const HANDLE_PX = 12;
const CENTER_PX = 8;
const EXTENT_PX = 12;
const FIELD_POINT_PX = 12;
const FIELD_SELECT_RING_PX = 20;
const ARROW_PX = 11;
const RANGE_TICK_PX = 15;

type NoiseFieldMeshSub = {
	readonly nodeId: string;
	readonly kind: "noise-field-mesh-point";
	readonly row: number;
	readonly col: number;
};

type OverlayProps = {
	readonly document: SceneDocument;
	readonly selection: {
		readonly nodeIds: readonly string[];
		readonly primary: string | null;
		readonly sub?:
			| NoiseFieldMeshSub
			| {
					readonly nodeId: string;
					readonly kind: string;
			  }
			| null;
	};
	readonly viewport: { readonly zoom: number };
};

const isNoiseFieldMeshSub = (
	sub: OverlayProps["selection"]["sub"],
): sub is NoiseFieldMeshSub =>
	sub?.kind === "noise-field-mesh-point" &&
	typeof (sub as { readonly row?: unknown }).row === "number" &&
	typeof (sub as { readonly col?: unknown }).col === "number";

const starPoints = (
	geometry: Extract<NodeGeometry, { readonly kind: "star" }>,
): string => {
	const points: string[] = [];
	const total = geometry.points * 2;
	for (let index = 0; index < total; index += 1) {
		const radius =
			index % 2 === 0 ? geometry.outerRadius : geometry.innerRadius;
		const angle = -Math.PI / 2 + (index / total) * Math.PI * 2;
		points.push(
			`${geometry.center.x + Math.cos(angle) * radius},${geometry.center.y + Math.sin(angle) * radius}`,
		);
	}
	return points.join(" ");
};

function CircularContourGuide({
	node,
	strokeWidth,
	strokeDasharray,
}: {
	readonly node: VectorNode;
	readonly strokeWidth: number;
	readonly strokeDasharray: string;
}) {
	const transform = matrixToSvg(matrixFromTransform(node.transform));
	const guideProps = {
		fill: "none",
		stroke: "#2ec4b6",
		strokeDasharray,
		strokeWidth,
		transform,
		vectorEffect: "non-scaling-stroke" as const,
	};
	const { geometry } = node;
	switch (geometry.kind) {
		case "rect":
			return rectNeedsBakedPath(geometry) ? (
				<path
					{...guideProps}
					d={roundedRectPathData(geometry)}
					strokeLinejoin="round"
				/>
			) : (
				<rect
					{...guideProps}
					x={geometry.bounds.x}
					y={geometry.bounds.y}
					width={geometry.bounds.width}
					height={geometry.bounds.height}
					rx={geometry.cornerRadius}
				/>
			);
		case "ellipse":
			return (
				<ellipse
					{...guideProps}
					cx={geometry.bounds.x + geometry.bounds.width / 2}
					cy={geometry.bounds.y + geometry.bounds.height / 2}
					rx={geometry.bounds.width / 2}
					ry={geometry.bounds.height / 2}
				/>
			);
		case "line":
			return (
				<line
					{...guideProps}
					x1={geometry.start.x}
					y1={geometry.start.y}
					x2={geometry.end.x}
					y2={geometry.end.y}
				/>
			);
		case "polygon":
			return shapeNeedsBakedPath(geometry) ? (
				<path
					{...guideProps}
					d={roundedPolygonPathData(geometry)}
					strokeLinejoin="round"
				/>
			) : (
				<polygon
					{...guideProps}
					points={geometry.points
						.map((point) => `${point.x},${point.y}`)
						.join(" ")}
				/>
			);
		case "star":
			return shapeNeedsBakedPath(geometry) ? (
				<path
					{...guideProps}
					d={roundedStarPathData(geometry)}
					strokeLinejoin="round"
				/>
			) : (
				<polygon {...guideProps} points={starPoints(geometry)} />
			);
		case "path": {
			const d = pathDataForGeometry(geometry);
			return d ? (
				<path
					{...guideProps}
					d={d}
					fillRule={geometry.fillRule}
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			) : null;
		}
		case "image":
		case "text":
			return (
				<rect
					{...guideProps}
					x={geometry.bounds.x}
					y={geometry.bounds.y}
					width={geometry.bounds.width}
					height={geometry.bounds.height}
				/>
			);
	}
}

const pathFromSegments = (
	segments: NoiseGradientFieldMeshScene["segments"],
): string =>
	segments
		.map(
			(segment) =>
				`M${segment.from.x},${segment.from.y}L${segment.to.x},${segment.to.y}`,
		)
		.join("");

const axisUnit = (
	from: { readonly x: number; readonly y: number },
	to: { readonly x: number; readonly y: number },
): { readonly x: number; readonly y: number } => {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const length = Math.hypot(dx, dy);
	return length <= 1e-6 ? { x: 1, y: 0 } : { x: dx / length, y: dy / length };
};

const perpendicular = (vector: {
	readonly x: number;
	readonly y: number;
}): { readonly x: number; readonly y: number } => ({
	x: -vector.y,
	y: vector.x,
});

const trianglePoints = (
	tip: { readonly x: number; readonly y: number },
	direction: { readonly x: number; readonly y: number },
	size: number,
): string => {
	const normal = perpendicular(direction);
	const base = {
		x: tip.x - direction.x * size,
		y: tip.y - direction.y * size,
	};
	return [
		`${tip.x},${tip.y}`,
		`${base.x + normal.x * size * 0.5},${base.y + normal.y * size * 0.5}`,
		`${base.x - normal.x * size * 0.5},${base.y - normal.y * size * 0.5}`,
	].join(" ");
};

function FieldMeshGuide({
	scene,
	selected,
	strokeWidth,
	pointRadius,
	selectRingRadius,
}: {
	readonly scene: NoiseGradientFieldMeshScene;
	readonly selected: { readonly row: number; readonly col: number } | null;
	readonly strokeWidth: number;
	readonly pointRadius: number;
	readonly selectRingRadius: number;
}) {
	const gridPath = pathFromSegments(scene.segments);
	const pointFill = (density: number): string => {
		const channel = Math.round(68 + density * 187);
		return `rgb(${channel} ${channel} ${channel})`;
	};
	return (
		<>
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
				stroke="#2ec4b6"
				strokeWidth={strokeWidth}
				strokeLinecap="round"
				vectorEffect="non-scaling-stroke"
			/>
			{scene.points.map((point) => {
				const isSelected =
					selected?.row === point.row && selected?.col === point.col;
				return (
					<g key={`${point.row}-${point.col}`}>
						{isSelected ? (
							<circle
								cx={point.artboard.x}
								cy={point.artboard.y}
								r={selectRingRadius}
								fill="none"
								stroke="#2ec4b6"
								strokeWidth={strokeWidth * 1.5}
								vectorEffect="non-scaling-stroke"
							/>
						) : null}
						<circle
							cx={point.artboard.x}
							cy={point.artboard.y}
							r={pointRadius}
							fill={pointFill(point.density)}
							stroke="#191817"
							strokeWidth={strokeWidth}
							vectorEffect="non-scaling-stroke"
						/>
						<circle
							cx={point.artboard.x}
							cy={point.artboard.y}
							r={pointRadius}
							fill="none"
							stroke="#f7f4eb"
							strokeWidth={strokeWidth * 0.75}
							vectorEffect="non-scaling-stroke"
						/>
					</g>
				);
			})}
		</>
	);
}

function NoiseGradientOverlay({ document, selection, viewport }: OverlayProps) {
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

	const primaryId = selection.primary ?? selection.nodeIds[0];
	const node = primaryId ? findNode(document, primaryId) : null;
	if (node?.locked) return null;
	const state = node
		? noiseGradientToolControlState(document, {
				nodeIds: [node.id],
				primary: node.id,
			})
		: null;
	const axis =
		node && state?.editable
			? noiseGradientAxisScene(node, {
					preview: true,
					texture: state.texture,
				})
			: null;
	const fieldMesh =
		node && state?.editable && state.fieldMode === "mesh"
			? noiseGradientFieldMeshScene(node, {
					preview: true,
					texture: state.texture,
				})
			: null;
	if (!node || !axis) return null;

	const scale = Math.max(viewport.zoom / PERCENT, 0.001);
	const strokeWidth = LINE_PX / scale;
	const handleRadius = HANDLE_PX / scale / 2;
	const centerRadius = CENTER_PX / scale / 2;
	const extentRadius = EXTENT_PX / scale / 2;
	const fieldPointRadius = FIELD_POINT_PX / scale / 2;
	const fieldSelectRingRadius = FIELD_SELECT_RING_PX / scale / 2;
	const arrowSize = ARROW_PX / scale;
	const rangeTick = RANGE_TICK_PX / scale / 2;
	const edgeDash = `${4 / scale} ${3 / scale}`;
	const sub = selection.sub;
	const selectedFieldPoint =
		isNoiseFieldMeshSub(sub) && sub.nodeId === node.id
			? { row: sub.row, col: sub.col }
			: null;
	const extentPoints = [
		`${axis.extentPoint.x},${axis.extentPoint.y - extentRadius}`,
		`${axis.extentPoint.x + extentRadius},${axis.extentPoint.y}`,
		`${axis.extentPoint.x},${axis.extentPoint.y + extentRadius}`,
		`${axis.extentPoint.x - extentRadius},${axis.extentPoint.y}`,
	].join(" ");
	const direction = axisUnit(axis.from, axis.to);
	const normal = perpendicular(direction);
	const rangeTickFrom = {
		x: axis.extentPoint.x - normal.x * rangeTick,
		y: axis.extentPoint.y - normal.y * rangeTick,
	};
	const rangeTickTo = {
		x: axis.extentPoint.x + normal.x * rangeTick,
		y: axis.extentPoint.y + normal.y * rangeTick,
	};

	return (
		<svg
			className="pointer-events-none absolute inset-0 h-full w-full"
			viewBox={`0 0 ${document.artboard.width} ${document.artboard.height}`}
			aria-hidden="true"
		>
			{fieldMesh ? (
				<FieldMeshGuide
					scene={fieldMesh}
					selected={selectedFieldPoint}
					strokeWidth={strokeWidth}
					pointRadius={fieldPointRadius}
					selectRingRadius={fieldSelectRingRadius}
				/>
			) : axis.fixedAngle ? (
				<>
					<line
						x1={axis.from.x}
						y1={axis.from.y}
						x2={axis.to.x}
						y2={axis.to.y}
						stroke="#191817"
						strokeWidth={strokeWidth * 3}
						strokeLinecap="round"
						vectorEffect="non-scaling-stroke"
					/>
					<line
						x1={axis.from.x}
						y1={axis.from.y}
						x2={axis.extentPoint.x}
						y2={axis.extentPoint.y}
						stroke="#2ec4b6"
						strokeWidth={strokeWidth * 1.35}
						strokeLinecap="round"
						vectorEffect="non-scaling-stroke"
					/>
					<line
						x1={axis.extentPoint.x}
						y1={axis.extentPoint.y}
						x2={axis.to.x}
						y2={axis.to.y}
						stroke="#f7f4eb"
						strokeWidth={strokeWidth}
						strokeDasharray={`${3 / scale} ${4 / scale}`}
						strokeLinecap="round"
						vectorEffect="non-scaling-stroke"
					/>
					<line
						x1={rangeTickFrom.x}
						y1={rangeTickFrom.y}
						x2={rangeTickTo.x}
						y2={rangeTickTo.y}
						stroke="#2ec4b6"
						strokeWidth={strokeWidth}
						strokeLinecap="round"
						vectorEffect="non-scaling-stroke"
					/>
					<polygon
						points={trianglePoints(axis.to, direction, arrowSize)}
						fill="#2ec4b6"
						stroke="#191817"
						strokeWidth={strokeWidth}
						vectorEffect="non-scaling-stroke"
					/>
				</>
			) : (
				<CircularContourGuide
					node={node}
					strokeWidth={strokeWidth}
					strokeDasharray={edgeDash}
				/>
			)}
			{axis.fixedAngle
				? [
						{ id: "from", point: axis.from },
						{ id: "center", point: axis.center },
						{ id: "to", point: axis.to },
					].map(({ id, point }) => {
						const center = id === "center";
						return (
							<circle
								key={id}
								cx={point.x}
								cy={point.y}
								r={center ? centerRadius : handleRadius}
								fill={center ? "#2ec4b6" : "#f7f4eb"}
								stroke="#191817"
								strokeWidth={strokeWidth}
								vectorEffect="non-scaling-stroke"
							/>
						);
					})
				: null}
			<polygon
				points={extentPoints}
				fill="#2ec4b6"
				stroke="#191817"
				strokeWidth={strokeWidth}
				vectorEffect="non-scaling-stroke"
			/>
		</svg>
	);
}

export const overlay = {
	id: "noise-gradient-axis",
	tool: "noise-gradient" as const,
	Component: NoiseGradientOverlay,
};
