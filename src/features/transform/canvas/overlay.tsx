import { useEffect } from "react";
import { findNode } from "@/entities/scene/model/selectors";
import type { SceneDocument, VectorNode } from "@/entities/scene/model/types";
import {
	EditorHandle,
	type EditorHandleState,
} from "@/shared/ui/overlay/EditorHandle";
import {
	type Aabb,
	anchorPoint,
	CORNER_HANDLES,
	type CornerHandleId,
	cornerRadiusHandlePoint,
	type Frame,
	frameFromNodes,
	HANDLE_IDS,
	type HandleId,
	handlePoint,
	type RotationHandleBounds,
	rotationHandlePoint,
	selectableNodes,
	shouldForceAxisAligned,
	transformableSelectionNodes,
} from "../model/geometry";
import { useLiveTransformStore } from "../model/live-drag-store";
import {
	isAxisAlignedMode,
	type TransformTarget,
	useTransformUiStore,
} from "../model/store";
import { cancelActiveGesture } from "./handler";

// Structural mirror of the registry OverlayProps; features cannot import the
// widget-layer registry types. The host passes a compatible superset.
type OverlayProps = {
	readonly document: SceneDocument;
	readonly selection: {
		readonly nodeIds: readonly string[];
		readonly primary: string | null;
	};
	readonly viewport: { readonly zoom: number };
};

const PERCENT = 100;
const HANDLE_PX = 10;
const ANCHOR_PX = 8;
const ROTATE_HANDLE_PX = 8;
const ROTATE_HANDLE_OFFSET_PX = 18;
const CORNER_RADIUS_HANDLE_PX = 7;
/** Must match the handler's inset so chrome and hit-testing agree. */
const CORNER_RADIUS_HANDLE_INSET_PX = 18;
const BBOX_STROKE = "#2ec4b6";
const BBOX_STROKE_WIDTH = 1.5;
const MARQUEE_STROKE = "#2ec4b6";
const MARQUEE_FILL = "rgba(46,196,182,0.12)";
const MARQUEE_STROKE_WIDTH = 1;

function handleState(
	handle: HandleId,
	hover: TransformTarget,
	active: TransformTarget,
): EditorHandleState {
	if (active?.kind === "resize" && active.handle === handle) {
		return "active";
	}
	if (!active && hover?.kind === "resize" && hover.handle === handle) {
		return "hover";
	}
	return "idle";
}

function targetState(
	kind: "resize" | "rotate",
	handle: HandleId,
	hover: TransformTarget,
	active: TransformTarget,
): EditorHandleState {
	if (active?.kind === kind && active.handle === handle) return "active";
	if (!active && hover?.kind === kind && hover.handle === handle)
		return "hover";
	return "idle";
}

function cornerRadiusState(
	handle: CornerHandleId,
	hover: TransformTarget,
	active: TransformTarget,
): EditorHandleState {
	if (active?.kind === "corner-radius" && active.handle === handle) {
		return "active";
	}
	if (!active && hover?.kind === "corner-radius" && hover.handle === handle) {
		return "hover";
	}
	return "idle";
}

function anchorState(
	hover: TransformTarget,
	active: TransformTarget,
): EditorHandleState {
	if (active?.kind === "anchor") return "active";
	if (!active && hover?.kind === "anchor") return "hover";
	return "idle";
}

const chromeStroke: Record<EditorHandleState, string> = {
	idle: "#191817",
	hover: "#102927",
	active: "#102927",
	"sub-selected": "#191817",
	disabled: "#191817",
};

const chromeFill: Record<EditorHandleState, string> = {
	idle: "#f7f4eb",
	hover: "#8df1e8",
	active: "#2ec4b6",
	"sub-selected": "#f4c430",
	disabled: "#4b4945",
};

function AnchorMark({
	point,
	radius,
	state,
}: {
	readonly point: { readonly x: number; readonly y: number };
	readonly radius: number;
	readonly state: EditorHandleState;
}) {
	const active = state !== "idle";
	return (
		<g opacity={active ? 1 : 0.76}>
			<circle
				cx={point.x}
				cy={point.y}
				r={radius}
				fill={active ? chromeFill[state] : "none"}
				stroke={active ? chromeStroke[state] : "#2ec4b6"}
				strokeDasharray={active ? undefined : "2 2"}
				strokeWidth={active ? 1.5 : 1.25}
				vectorEffect="non-scaling-stroke"
			/>
			<path
				d={`M ${point.x - radius * 1.7} ${point.y} L ${point.x + radius * 1.7} ${point.y} M ${point.x} ${point.y - radius * 1.7} L ${point.x} ${point.y + radius * 1.7}`}
				stroke={active ? chromeStroke[state] : "#2ec4b6"}
				strokeLinecap="round"
				strokeWidth={1.25}
				vectorEffect="non-scaling-stroke"
			/>
		</g>
	);
}

function RotationHandle({
	frame,
	handle,
	offset,
	bounds,
	radius,
	state,
}: {
	readonly frame: Frame;
	readonly handle: HandleId;
	readonly offset: number;
	readonly bounds: RotationHandleBounds;
	readonly radius: number;
	readonly state: EditorHandleState;
}) {
	const corner = handlePoint(frame, handle);
	const point = rotationHandlePoint(frame, handle, offset, bounds);
	return (
		<g>
			<line
				x1={corner.x}
				y1={corner.y}
				x2={point.x}
				y2={point.y}
				stroke="#2ec4b6"
				strokeOpacity={state === "idle" ? 0.45 : 0.9}
				strokeWidth={1}
				vectorEffect="non-scaling-stroke"
			/>
			<circle
				cx={point.x}
				cy={point.y}
				r={radius}
				fill={chromeFill[state]}
				stroke={chromeStroke[state]}
				strokeWidth={1.5}
				vectorEffect="non-scaling-stroke"
			/>
		</g>
	);
}

/**
 * Inset corner-radius handles for a single rect. Faint when idle (discoverable
 * without clutter), bright on hover/active. They sit inset from each corner so
 * the resize handle on the corner is never blocked.
 */
function CornerRadiusHandles({
	frame,
	inset,
	radius,
	hover,
	active,
}: {
	readonly frame: Frame;
	readonly inset: number;
	readonly radius: number;
	readonly hover: TransformTarget;
	readonly active: TransformTarget;
}) {
	return (
		<g>
			{CORNER_HANDLES.map((handle) => {
				const point = cornerRadiusHandlePoint(frame, handle, inset);
				const state = cornerRadiusState(handle, hover, active);
				return (
					<circle
						key={`radius-${handle}`}
						cx={point.x}
						cy={point.y}
						r={radius}
						fill={chromeFill[state]}
						stroke={chromeStroke[state]}
						strokeWidth={1.25}
						opacity={state === "idle" ? 0.55 : 1}
						vectorEffect="non-scaling-stroke"
					/>
				);
			})}
		</g>
	);
}

function FrameChrome({
	frame,
	resizeHandles,
	handlesVisible,
	handleRadius,
	anchorPoint,
	anchorRadius,
	rotateHandleRadius,
	rotateHandleOffset,
	rotationBounds,
	cornerRadiusEnabled,
	cornerRadiusInset,
	cornerRadiusRadius,
	hover,
	active,
}: {
	readonly frame: Frame;
	/** Resize handles to draw: all 8, or the 4 corners in axis-aligned mode. */
	readonly resizeHandles: readonly HandleId[];
	/** Show/Hide Bounding Box: when false, only the dashed outline is drawn. */
	readonly handlesVisible: boolean;
	readonly handleRadius: number;
	readonly anchorPoint: { readonly x: number; readonly y: number } | null;
	readonly anchorRadius: number;
	readonly rotateHandleRadius: number;
	readonly rotateHandleOffset: number;
	readonly rotationBounds: RotationHandleBounds;
	/** Draw the inset corner-radius handles (single rect). */
	readonly cornerRadiusEnabled: boolean;
	readonly cornerRadiusInset: number;
	readonly cornerRadiusRadius: number;
	readonly hover: TransformTarget;
	readonly active: TransformTarget;
}) {
	const points = frame.corners
		.map((corner) => `${corner.x},${corner.y}`)
		.join(" ");
	return (
		<g>
			<polygon
				points={points}
				fill="none"
				stroke={BBOX_STROKE}
				strokeWidth={BBOX_STROKE_WIDTH}
				strokeDasharray="6 5"
				vectorEffect="non-scaling-stroke"
			/>
			{handlesVisible ? (
				<g>
					{resizeHandles.map((handle) => {
						const point = handlePoint(frame, handle);
						return (
							<EditorHandle
								key={handle}
								x={point.x}
								y={point.y}
								radius={handleRadius}
								state={handleState(handle, hover, active)}
							/>
						);
					})}
					{CORNER_HANDLES.map((handle) => (
						<RotationHandle
							key={`rotate-${handle}`}
							frame={frame}
							handle={handle}
							offset={rotateHandleOffset}
							bounds={rotationBounds}
							radius={rotateHandleRadius}
							state={targetState("rotate", handle, hover, active)}
						/>
					))}
					{anchorPoint ? (
						<AnchorMark
							point={anchorPoint}
							radius={anchorRadius}
							state={anchorState(hover, active)}
						/>
					) : null}
					{cornerRadiusEnabled ? (
						<CornerRadiusHandles
							frame={frame}
							inset={cornerRadiusInset}
							radius={cornerRadiusRadius}
							hover={hover}
							active={active}
						/>
					) : null}
				</g>
			) : null}
		</g>
	);
}

/** Figma-style outline of the unselected node under the cursor (no handles). */
function HoverOutline({ frame }: { readonly frame: Frame }) {
	const points = frame.corners
		.map((corner) => `${corner.x},${corner.y}`)
		.join(" ");
	return (
		<polygon
			points={points}
			fill="none"
			stroke={BBOX_STROKE}
			strokeWidth={BBOX_STROKE_WIDTH}
			vectorEffect="non-scaling-stroke"
			opacity={0.5}
		/>
	);
}

function MarqueeRect({ rect }: { readonly rect: Aabb }) {
	return (
		<rect
			x={rect.minX}
			y={rect.minY}
			width={rect.maxX - rect.minX}
			height={rect.maxY - rect.minY}
			fill={MARQUEE_FILL}
			stroke={MARQUEE_STROKE}
			strokeWidth={MARQUEE_STROKE_WIDTH}
			strokeDasharray="4 3"
			vectorEffect="non-scaling-stroke"
		/>
	);
}

/**
 * Select-tool chrome: the selection frame (oriented bounds for one node, the
 * axis-aligned union for many), eight resize handles, and the live marquee
 * rectangle. Presentation only — the canvas handler owns interaction because
 * the host SVG captures the pointer, so this layer stays `pointer-events-none`.
 */
function SelectOverlay({ document, selection, viewport }: OverlayProps) {
	const marquee = useTransformUiStore((state) => state.marquee);
	const hover = useTransformUiStore((state) => state.hover);
	const active = useTransformUiStore((state) => state.active);
	const hoveredNodeId = useTransformUiStore((state) => state.hoveredNodeId);
	const boundingBoxMode = useTransformUiStore((state) => state.boundingBoxMode);
	const handlesVisible = useTransformUiStore(
		(state) => state.boundingBoxHandlesVisible,
	);
	// The dragged selection's live geometry: `document` is the frozen pre-drag
	// snapshot (a node move/resize/rotate no longer writes `useSceneStore` mid-
	// drag), so the selection frame/handles below must read through the
	// transient override, or they would stay pinned to the pre-drag position
	// for the whole gesture instead of tracking the cursor.
	const overrides = useLiveTransformStore((state) => state.overrides);

	// The host wires no pointercancel seam, so seal an interrupted drag here
	// (touch interruption, OS gesture, window blur) instead of leaving the scene
	// transaction dangling until the next pointerdown self-heals it.
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

	const nodes: readonly VectorNode[] = transformableSelectionNodes(
		document,
		selection.nodeIds,
	).map((node) => overrides?.get(node.id) ?? node);
	const singleNode = nodes.length === 1 ? nodes[0] : null;
	const axisAligned =
		singleNode != null &&
		shouldForceAxisAligned(
			singleNode,
			isAxisAlignedMode(boundingBoxMode, singleNode.id),
		);
	const frame = frameFromNodes(nodes, {
		forceAxisAligned: axisAligned,
		document,
	});
	const resizeHandles = axisAligned ? CORNER_HANDLES : HANDLE_IDS;
	const selectionAnchorPoint = singleNode
		? anchorPoint(singleNode, document)
		: null;
	const scale = viewport.zoom / PERCENT;
	const handleRadius = HANDLE_PX / scale / 2;
	const anchorRadius = ANCHOR_PX / scale / 2;
	const rotateHandleRadius = ROTATE_HANDLE_PX / scale / 2;
	const rotateHandleOffset = ROTATE_HANDLE_OFFSET_PX / scale;
	// Mirror the handler's gating: inset corner-radius handles for a single rect
	// outside axis-aligned mode (where the upright frame mismatches local rounding).
	const cornerRadiusEnabled =
		singleNode != null && singleNode.geometry.kind === "rect" && !axisAligned;
	const cornerRadiusInset = CORNER_RADIUS_HANDLE_INSET_PX / scale;
	const cornerRadiusRadius = CORNER_RADIUS_HANDLE_PX / scale / 2;
	const rotationBounds = {
		minX: 0,
		minY: 0,
		maxX: document.artboard.width,
		maxY: document.artboard.height,
	} satisfies RotationHandleBounds;

	// Outline the hovered node only when idle (no drag/marquee), unselected, and
	// canvas-selectable — a preview of what a click would select. Protected
	// artwork is omitted here because canvas gestures must not target it.
	const hoveredNode =
		hoveredNodeId && !active && !marquee
			? findNode(document, hoveredNodeId)
			: undefined;
	const selectableIds = new Set(
		selectableNodes(document).map((node) => node.id),
	);
	const hoverFrame =
		hoveredNode &&
		!selection.nodeIds.includes(hoveredNode.id) &&
		selectableIds.has(hoveredNode.id)
			? frameFromNodes([hoveredNode], { document })
			: null;

	return (
		<svg
			className="pointer-events-none absolute inset-0 h-full w-full"
			viewBox={`0 0 ${document.artboard.width} ${document.artboard.height}`}
			aria-hidden="true"
		>
			{hoverFrame ? <HoverOutline frame={hoverFrame} /> : null}
			{frame ? (
				<FrameChrome
					frame={frame}
					resizeHandles={resizeHandles}
					handlesVisible={handlesVisible}
					handleRadius={handleRadius}
					anchorPoint={selectionAnchorPoint}
					anchorRadius={anchorRadius}
					rotateHandleRadius={rotateHandleRadius}
					rotateHandleOffset={rotateHandleOffset}
					rotationBounds={rotationBounds}
					cornerRadiusEnabled={cornerRadiusEnabled}
					cornerRadiusInset={cornerRadiusInset}
					cornerRadiusRadius={cornerRadiusRadius}
					hover={hover}
					active={active}
				/>
			) : null}
			{marquee ? <MarqueeRect rect={marquee} /> : null}
		</svg>
	);
}

export const overlay = {
	id: "select-transform",
	tool: "select" as const,
	Component: SelectOverlay,
};
