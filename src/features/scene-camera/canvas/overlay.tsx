import { getNodeParentBounds } from "@/entities/scene/model/rendering";
import {
	readSceneCameraAuthoringState,
	type SceneCameraAuthoringSelection,
	type SceneCameraDepthNodeReadModel,
	type SceneCameraRigReadModel,
} from "@/entities/scene/model/scene-camera-authoring";
import type { SceneDocument, Vec2 } from "@/entities/scene/model/types";
import {
	type SceneCameraCanvasHandleLayoutPoint,
	sceneCameraCanvasHandleLayout,
} from "./handles";

type OverlayProps = {
	readonly document: SceneDocument;
	readonly selection: {
		readonly nodeIds: readonly string[];
		readonly sceneCamera?: SceneCameraAuthoringSelection | null;
	};
	readonly viewport: { readonly zoom: number };
};

const PERCENT = 100;
const CHROME_STROKE = "#2ec4b6";
const CHROME_SHADOW = "#191817";
const CHROME_FILL = "#f7f4eb";
const CHROME_FOCUS = "#f4d35e";
const CHROME_DISABLED = "#7a7770";
const CHROME_TILT_X = "#64d2ff";
const CHROME_TILT_Y = "#ff7ab6";
const LABEL_MIN_WIDTH = 32;
const LABEL_HEIGHT = 14;
const LABEL_CHAR_WIDTH = 5.4;

const cameraRigIdFromSelection = (
	selection: SceneCameraAuthoringSelection | null | undefined,
): string | null => {
	if (!selection) return null;
	if ("cameraRigId" in selection) return selection.cameraRigId ?? null;
	return null;
};

const cameraPoint = (camera: SceneCameraRigReadModel): Vec2 => ({
	x: camera.rig.body.position.x,
	y: camera.rig.body.position.y,
});

const targetPoint = (camera: SceneCameraRigReadModel): Vec2 => {
	return { x: camera.target.point.x, y: camera.target.point.y };
};

const normalize2 = (value: Vec2): Vec2 | null => {
	const length = Math.hypot(value.x, value.y);
	if (!Number.isFinite(length) || length <= 1e-6) return null;
	return { x: value.x / length, y: value.y / length };
};

const cameraForward = (body: Vec2, target: Vec2): Vec2 =>
	normalize2({ x: target.x - body.x, y: target.y - body.y }) ?? { x: 1, y: 0 };

const perpendicular = (value: Vec2): Vec2 => ({ x: -value.y, y: value.x });

const offsetAlong = (
	primary: Vec2,
	primaryAmount: number,
	secondary?: Vec2,
	secondaryAmount = 0,
): Vec2 => ({
	x: primary.x * primaryAmount + (secondary?.x ?? 0) * secondaryAmount,
	y: primary.y * primaryAmount + (secondary?.y ?? 0) * secondaryAmount,
});

const depthLabel = (node: SceneCameraDepthNodeReadModel): string => {
	if (node.preset === "background") return "BG";
	if (node.preset === "midground") return "MG";
	if (node.preset === "foreground") return "FG";
	return `Z ${Math.round(node.depthPlane.z)}`;
};

function DepthBadge({
	node,
	selected,
	scale,
}: {
	readonly node: SceneCameraDepthNodeReadModel;
	readonly selected: boolean;
	readonly scale: number;
}) {
	const bounds = getNodeParentBounds(node.node);
	const label = depthLabel(node);
	const width = Math.max(22, label.length * 6 + 8) / scale;
	const height = 14 / scale;
	const x = bounds.x + bounds.width - width;
	const y = bounds.y - height - 3 / scale;
	return (
		<g opacity={selected ? 1 : 0.74}>
			<rect
				x={x}
				y={y}
				width={width}
				height={height}
				rx={3 / scale}
				fill={selected ? CHROME_STROKE : CHROME_SHADOW}
				fillOpacity={selected ? 0.92 : 0.78}
				stroke={CHROME_FILL}
				strokeOpacity={0.72}
				strokeWidth={1 / scale}
				vectorEffect="non-scaling-stroke"
			/>
			<text
				x={x + width / 2}
				y={y + height / 2}
				dominantBaseline="central"
				fill={selected ? CHROME_SHADOW : CHROME_FILL}
				fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
				fontSize={9 / scale}
				fontWeight={700}
				textAnchor="middle"
			>
				{label}
			</text>
		</g>
	);
}

function CameraTargetChrome({
	camera,
	selected,
	scale,
}: {
	readonly camera: SceneCameraRigReadModel;
	readonly selected: boolean;
	readonly scale: number;
}) {
	const body = cameraPoint(camera);
	const target = targetPoint(camera);
	const handles = sceneCameraCanvasHandleLayout(camera, scale);
	const radius = 6 / scale;
	const targetSize = 10 / scale;
	const strokeWidth = selected ? 1.6 / scale : 1.2 / scale;
	return (
		<g opacity={selected || camera.active ? 1 : 0.7}>
			<line
				x1={body.x}
				y1={body.y}
				x2={target.x}
				y2={target.y}
				stroke={CHROME_SHADOW}
				strokeWidth={strokeWidth * 2.2}
				strokeDasharray={`${5 / scale} ${4 / scale}`}
				vectorEffect="non-scaling-stroke"
			/>
			<line
				x1={body.x}
				y1={body.y}
				x2={target.x}
				y2={target.y}
				stroke={CHROME_STROKE}
				strokeWidth={strokeWidth}
				strokeDasharray={`${5 / scale} ${4 / scale}`}
				vectorEffect="non-scaling-stroke"
			/>
			<circle
				cx={body.x}
				cy={body.y}
				r={radius}
				fill={selected ? CHROME_STROKE : CHROME_FILL}
				stroke={CHROME_SHADOW}
				strokeWidth={strokeWidth}
				vectorEffect="non-scaling-stroke"
			/>
			<path
				d={`M ${target.x - targetSize} ${target.y} L ${target.x + targetSize} ${target.y} M ${target.x} ${target.y - targetSize} L ${target.x} ${target.y + targetSize}`}
				fill="none"
				stroke={CHROME_SHADOW}
				strokeLinecap="round"
				strokeWidth={strokeWidth * 2.4}
				vectorEffect="non-scaling-stroke"
			/>
			<path
				d={`M ${target.x - targetSize} ${target.y} L ${target.x + targetSize} ${target.y} M ${target.x} ${target.y - targetSize} L ${target.x} ${target.y + targetSize}`}
				fill="none"
				stroke={CHROME_STROKE}
				strokeLinecap="round"
				strokeWidth={strokeWidth}
				vectorEffect="non-scaling-stroke"
			/>
			<circle
				cx={target.x}
				cy={target.y}
				r={radius * 1.6}
				fill="none"
				stroke={CHROME_STROKE}
				strokeOpacity={selected ? 0.9 : 0.48}
				strokeWidth={strokeWidth}
				vectorEffect="non-scaling-stroke"
			/>
			{selected ? (
				<CameraH3Handles
					body={body}
					target={target}
					handles={handles}
					scale={scale}
				/>
			) : null}
		</g>
	);
}

function CameraH3Handles({
	body,
	target,
	handles,
	scale,
}: {
	readonly body: Vec2;
	readonly target: Vec2;
	readonly handles: readonly SceneCameraCanvasHandleLayoutPoint[];
	readonly scale: number;
}) {
	const strokeWidth = 1.2 / scale;
	const handleRadius = 4.2 / scale;
	const pointFor = (role: SceneCameraCanvasHandleLayoutPoint["role"]) =>
		handles.find((handle) => handle.role === role);
	const bodyHandle = pointFor("body");
	const targetHandle = pointFor("target");
	const bodyDepth = pointFor("body-depth");
	const targetDepth = pointFor("target-depth");
	const rotationX = pointFor("rotation-x");
	const rotationY = pointFor("rotation-y");
	const rotationZ = pointFor("rotation-z");
	const focus = pointFor("focus");
	const aperture = pointFor("aperture");
	const forward = cameraForward(body, target);
	const right = perpendicular(forward);
	const axisAngle = (Math.atan2(forward.y, forward.x) * 180) / Math.PI;
	const pitchControl = {
		x: body.x - (right.x * 18) / scale,
		y: body.y - (right.y * 18) / scale,
	};
	const rollControl = {
		x: body.x + (right.x * 18) / scale,
		y: body.y + (right.y * 18) / scale,
	};
	const glyphByRole: Partial<
		Record<SceneCameraCanvasHandleLayoutPoint["role"], string>
	> = {
		"body-depth": "BZ",
		"target-depth": "TZ",
		"rotation-x": "P",
		"rotation-y": "Y",
		"rotation-z": "R",
		focus: "F",
		aperture: "A",
	};
	const handleCircle = (
		handle: SceneCameraCanvasHandleLayoutPoint | undefined,
		fill: string = CHROME_FILL,
	) =>
		handle ? (
			<g key={handle.role}>
				<circle
					cx={handle.point.x}
					cy={handle.point.y}
					r={handleRadius}
					fill={handle.enabled ? fill : CHROME_DISABLED}
					stroke={CHROME_SHADOW}
					strokeWidth={strokeWidth}
					vectorEffect="non-scaling-stroke"
				/>
				{glyphByRole[handle.role] ? (
					<text
						x={handle.point.x}
						y={handle.point.y}
						dominantBaseline="central"
						fill={CHROME_SHADOW}
						fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
						fontSize={
							(glyphByRole[handle.role]?.length === 2 ? 5.2 : 6.4) / scale
						}
						fontWeight={700}
						textAnchor="middle"
					>
						{glyphByRole[handle.role]}
					</text>
				) : null}
			</g>
		) : null;
	const handleProxy = (
		handle: SceneCameraCanvasHandleLayoutPoint | undefined,
		fill: string = CHROME_FILL,
	) => {
		if (!handle) return null;
		if (
			Math.abs(handle.point.x - handle.modelPoint.x) < 1e-6 &&
			Math.abs(handle.point.y - handle.modelPoint.y) < 1e-6
		) {
			return null;
		}
		return (
			<g key={`${handle.role}-proxy`}>
				<line
					x1={handle.modelPoint.x}
					y1={handle.modelPoint.y}
					x2={handle.point.x}
					y2={handle.point.y}
					stroke={fill}
					strokeDasharray={`${2 / scale} ${2 / scale}`}
					strokeOpacity={0.68}
					strokeWidth={strokeWidth}
					vectorEffect="non-scaling-stroke"
				/>
				{handleCircle(handle, fill)}
			</g>
		);
	};
	const handleLabel = (
		handle: SceneCameraCanvasHandleLayoutPoint | undefined,
		offset: Vec2,
		fill: string = CHROME_FILL,
	) => {
		if (!handle?.label || !handle.enabled) return null;
		const width =
			(Math.max(LABEL_MIN_WIDTH, handle.label.length * LABEL_CHAR_WIDTH) + 8) /
			scale;
		const height = LABEL_HEIGHT / scale;
		const x = handle.point.x + offset.x / scale;
		const y = handle.point.y + offset.y / scale;
		return (
			<g key={`${handle.role}-label`}>
				<rect
					x={x - width / 2}
					y={y - height / 2}
					width={width}
					height={height}
					rx={4 / scale}
					fill={CHROME_SHADOW}
					fillOpacity={0.84}
					stroke={fill}
					strokeOpacity={0.42}
					strokeWidth={0.8 / scale}
					vectorEffect="non-scaling-stroke"
				/>
				<text
					x={x}
					y={y}
					dominantBaseline="central"
					fill={fill}
					fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
					fontSize={8 / scale}
					fontWeight={700}
					textAnchor="middle"
				>
					{handle.label}
				</text>
			</g>
		);
	};
	return (
		<g>
			{bodyDepth ? (
				<line
					x1={body.x}
					y1={body.y}
					x2={bodyDepth.point.x}
					y2={bodyDepth.point.y}
					stroke={CHROME_STROKE}
					strokeOpacity={0.72}
					strokeWidth={strokeWidth}
					vectorEffect="non-scaling-stroke"
				/>
			) : null}
			{targetDepth ? (
				<line
					x1={target.x}
					y1={target.y}
					x2={targetDepth.point.x}
					y2={targetDepth.point.y}
					stroke={targetDepth.enabled ? CHROME_STROKE : CHROME_DISABLED}
					strokeOpacity={targetDepth.enabled ? 0.68 : 0.44}
					strokeWidth={strokeWidth}
					vectorEffect="non-scaling-stroke"
				/>
			) : null}
			{rotationX && rotationY && rotationZ ? (
				<>
					<ellipse
						cx={body.x}
						cy={body.y}
						rx={26 / scale}
						ry={11 / scale}
						fill="none"
						stroke={CHROME_TILT_X}
						strokeDasharray={`${3 / scale} ${3 / scale}`}
						strokeOpacity={0.76}
						strokeWidth={strokeWidth}
						transform={`rotate(${axisAngle} ${body.x} ${body.y})`}
						vectorEffect="non-scaling-stroke"
					/>
					<ellipse
						cx={body.x}
						cy={body.y}
						rx={11 / scale}
						ry={26 / scale}
						fill="none"
						stroke={CHROME_TILT_Y}
						strokeDasharray={`${3 / scale} ${3 / scale}`}
						strokeOpacity={0.76}
						strokeWidth={strokeWidth}
						transform={`rotate(${axisAngle} ${body.x} ${body.y})`}
						vectorEffect="non-scaling-stroke"
					/>
					<path
						d={`M ${rotationX.point.x} ${rotationX.point.y} Q ${pitchControl.x} ${pitchControl.y} ${body.x} ${body.y} Q ${rollControl.x} ${rollControl.y} ${rotationZ.point.x} ${rotationZ.point.y} M ${body.x} ${body.y} L ${rotationY.point.x} ${rotationY.point.y}`}
						fill="none"
						stroke={CHROME_STROKE}
						strokeDasharray={`${3 / scale} ${3 / scale}`}
						strokeOpacity={0.82}
						strokeWidth={strokeWidth}
						vectorEffect="non-scaling-stroke"
					/>
				</>
			) : null}
			{focus ? (
				<>
					<line
						x1={focus.point.x - (right.x * 11) / scale}
						y1={focus.point.y - (right.y * 11) / scale}
						x2={focus.point.x + (right.x * 11) / scale}
						y2={focus.point.y + (right.y * 11) / scale}
						stroke={CHROME_SHADOW}
						strokeWidth={strokeWidth * 2}
						vectorEffect="non-scaling-stroke"
					/>
					<line
						x1={focus.point.x - (right.x * 11) / scale}
						y1={focus.point.y - (right.y * 11) / scale}
						x2={focus.point.x + (right.x * 11) / scale}
						y2={focus.point.y + (right.y * 11) / scale}
						stroke={CHROME_FOCUS}
						strokeWidth={strokeWidth}
						vectorEffect="non-scaling-stroke"
					/>
				</>
			) : null}
			{aperture ? (
				<circle
					cx={aperture.point.x}
					cy={aperture.point.y}
					r={8 / scale}
					fill="none"
					stroke={CHROME_FOCUS}
					strokeOpacity={0.82}
					strokeWidth={strokeWidth}
					vectorEffect="non-scaling-stroke"
				/>
			) : null}
			{handleCircle(bodyDepth)}
			{handleCircle(targetDepth)}
			{handleCircle(rotationX, CHROME_TILT_X)}
			{handleCircle(rotationY, CHROME_TILT_Y)}
			{handleCircle(rotationZ, CHROME_STROKE)}
			{handleCircle(focus, CHROME_FOCUS)}
			{handleCircle(aperture, CHROME_FOCUS)}
			{handleProxy(bodyHandle, CHROME_STROKE)}
			{handleProxy(targetHandle, CHROME_FILL)}
			{handleLabel(bodyHandle, offsetAlong(forward, -30, right, -18))}
			{handleLabel(targetHandle, offsetAlong(forward, 30, right, 18))}
		</g>
	);
}

function SceneCameraOverlay({ document, selection, viewport }: OverlayProps) {
	const state = readSceneCameraAuthoringState(document);
	const selectedCameraRigId = cameraRigIdFromSelection(selection.sceneCamera);
	const selectedCamera = selectedCameraRigId
		? state.cameras.find((camera) => camera.rig.id === selectedCameraRigId)
		: undefined;
	const camera = selectedCamera ?? state.activeCamera;
	const selectedNodeIds = new Set(selection.nodeIds);
	const depthNodes = state.depthNodes.filter((node) =>
		selectedNodeIds.has(node.node.id),
	);
	if (!camera && depthNodes.length === 0) return null;

	const scale = Math.max(viewport.zoom / PERCENT, 0.001);
	return (
		<svg
			className="pointer-events-none absolute inset-0 h-full w-full"
			viewBox={`0 0 ${document.artboard.width} ${document.artboard.height}`}
			aria-hidden="true"
		>
			{camera ? (
				<CameraTargetChrome
					camera={camera}
					selected={camera.rig.id === selectedCameraRigId}
					scale={scale}
				/>
			) : null}
			{depthNodes.map((node) => (
				<DepthBadge
					key={node.node.id}
					node={node}
					selected={selectedNodeIds.has(node.node.id)}
					scale={scale}
				/>
			))}
		</svg>
	);
}

export const overlay = {
	id: "scene-camera-authoring",
	paintOrder: 12,
	Component: SceneCameraOverlay,
};
