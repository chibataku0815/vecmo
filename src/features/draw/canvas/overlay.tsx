import { type ComponentType, useEffect } from "react";
import { aeShapeToSvgPath } from "@/shared/glammer/ae-shape-svg-path";
import { useDrawStore } from "../model/draw-store";
import { isCloseTarget, type PenAnchor, penAnchorsToShape } from "../model/pen";
import {
	PENCIL_BRUSH_PRESETS,
	usePencilToolStore,
} from "../model/pencil-tool-store";
import {
	type ShapeGeometry,
	shapeGeometryFromDrag,
	starPointsForGeometry,
} from "../model/shape";

// Local structural mirror of the registry overlay surface (features cannot
// import widget-layer types). The host passes a compatible superset.
type LocalToolId =
	| "select"
	| "direct-select"
	| "pen"
	| "pencil"
	| "shape"
	| "type"
	| "motion-path"
	| "effect";

type OverlayProps = {
	readonly document: {
		readonly artboard: { readonly width: number; readonly height: number };
	};
	readonly selection: unknown;
	readonly viewport: { readonly zoom: number };
};

type OverlayDescriptor = {
	readonly id: string;
	readonly tool?: LocalToolId;
	readonly Component: ComponentType<OverlayProps>;
};

const PERCENT = 100;
const CLOSE_TOLERANCE_PX = 12;
const ANCHOR_PX = 9;
const SMOOTH_PX = 5;
const HANDLE_PX = 3.5;
const ACCENT = "#2ec4b6";
const CHROME_FILL = "#f7f4eb";
const CHROME_STROKE = "#191817";

const isCornerAnchor = (anchor: PenAnchor): boolean =>
	anchor.inTangent[0] === 0 &&
	anchor.inTangent[1] === 0 &&
	anchor.outTangent[0] === 0 &&
	anchor.outTangent[1] === 0;

function PenOverlay({ document, viewport }: OverlayProps) {
	const penAnchors = useDrawStore((state) => state.penAnchors);
	const penCursor = useDrawStore((state) => state.penCursor);

	// Deactivating the pen tool unmounts this overlay (the host filters overlays
	// by active tool). Discard any unfinished path so it cannot resurface and
	// accumulate when the pen is next selected.
	useEffect(() => () => useDrawStore.getState().resetPen(), []);

	if (penAnchors.length === 0) return null;

	const { width, height } = document.artboard;
	const scale = viewport.zoom / PERCENT;
	// Screen-pixel chrome size expressed in artboard units so it stays constant
	// on screen across zoom levels.
	const px = (value: number) => value / scale;
	const pathData = aeShapeToSvgPath(penAnchorsToShape(penAnchors, false));
	const last = penAnchors[penAnchors.length - 1];
	const first = penAnchors[0];
	const nearClose = penCursor
		? isCloseTarget(penCursor, penAnchors, px(CLOSE_TOLERANCE_PX))
		: false;

	return (
		<svg
			className="pointer-events-none absolute inset-0 h-full w-full"
			viewBox={`0 0 ${width} ${height}`}
			aria-hidden="true"
		>
			<path
				d={pathData}
				fill="none"
				stroke={ACCENT}
				strokeWidth={2}
				strokeLinecap="round"
				strokeLinejoin="round"
				vectorEffect="non-scaling-stroke"
			/>
			{penCursor && !nearClose ? (
				<line
					x1={last.point[0]}
					y1={last.point[1]}
					x2={penCursor.x}
					y2={penCursor.y}
					stroke={ACCENT}
					strokeOpacity={0.55}
					strokeDasharray="6 7"
					strokeWidth={1.5}
					vectorEffect="non-scaling-stroke"
				/>
			) : null}
			{penAnchors.map((anchor) => {
				const [ax, ay] = anchor.point;
				const corner = isCornerAnchor(anchor);
				return (
					<g
						key={`${ax}-${ay}-${anchor.outTangent[0]}-${anchor.outTangent[1]}`}
					>
						{!corner ? (
							<g>
								<line
									x1={ax}
									y1={ay}
									x2={ax + anchor.outTangent[0]}
									y2={ay + anchor.outTangent[1]}
									stroke={ACCENT}
									strokeWidth={1.5}
									vectorEffect="non-scaling-stroke"
								/>
								<line
									x1={ax}
									y1={ay}
									x2={ax + anchor.inTangent[0]}
									y2={ay + anchor.inTangent[1]}
									stroke={ACCENT}
									strokeWidth={1.5}
									vectorEffect="non-scaling-stroke"
								/>
								<circle
									cx={ax + anchor.outTangent[0]}
									cy={ay + anchor.outTangent[1]}
									r={px(HANDLE_PX)}
									fill={ACCENT}
								/>
								<circle
									cx={ax + anchor.inTangent[0]}
									cy={ay + anchor.inTangent[1]}
									r={px(HANDLE_PX)}
									fill={ACCENT}
								/>
							</g>
						) : null}
						{corner ? (
							<rect
								x={ax - px(ANCHOR_PX) / 2}
								y={ay - px(ANCHOR_PX) / 2}
								width={px(ANCHOR_PX)}
								height={px(ANCHOR_PX)}
								fill={CHROME_FILL}
								stroke={CHROME_STROKE}
								strokeWidth={2}
								vectorEffect="non-scaling-stroke"
							/>
						) : (
							<circle
								cx={ax}
								cy={ay}
								r={px(SMOOTH_PX)}
								fill={CHROME_FILL}
								stroke={CHROME_STROKE}
								strokeWidth={2}
								vectorEffect="non-scaling-stroke"
							/>
						)}
					</g>
				);
			})}
			{nearClose ? (
				<circle
					cx={first.point[0]}
					cy={first.point[1]}
					r={px(ANCHOR_PX)}
					fill="none"
					stroke={ACCENT}
					strokeWidth={2.5}
					vectorEffect="non-scaling-stroke"
				/>
			) : null}
		</svg>
	);
}

const pointList = (
	points: readonly { readonly x: number; readonly y: number }[],
) => points.map((point) => `${point.x},${point.y}`).join(" ");

function ShapePreview({ geometry }: { readonly geometry: ShapeGeometry }) {
	switch (geometry.kind) {
		case "rect":
			return (
				<rect
					x={geometry.bounds.x}
					y={geometry.bounds.y}
					width={geometry.bounds.width}
					height={geometry.bounds.height}
					fill={`${ACCENT}22`}
					stroke={ACCENT}
					strokeDasharray="7 6"
					strokeWidth={1.5}
					vectorEffect="non-scaling-stroke"
				/>
			);
		case "ellipse":
			return (
				<ellipse
					cx={geometry.bounds.x + geometry.bounds.width / 2}
					cy={geometry.bounds.y + geometry.bounds.height / 2}
					rx={geometry.bounds.width / 2}
					ry={geometry.bounds.height / 2}
					fill={`${ACCENT}22`}
					stroke={ACCENT}
					strokeDasharray="7 6"
					strokeWidth={1.5}
					vectorEffect="non-scaling-stroke"
				/>
			);
		case "line":
			return (
				<line
					x1={geometry.start.x}
					y1={geometry.start.y}
					x2={geometry.end.x}
					y2={geometry.end.y}
					stroke={ACCENT}
					strokeDasharray="7 6"
					strokeWidth={1.5}
					vectorEffect="non-scaling-stroke"
				/>
			);
		case "polygon":
			return (
				<polygon
					points={pointList(geometry.points)}
					fill={`${ACCENT}22`}
					stroke={ACCENT}
					strokeDasharray="7 6"
					strokeWidth={1.5}
					vectorEffect="non-scaling-stroke"
				/>
			);
		case "star":
			return (
				<polygon
					points={pointList(starPointsForGeometry(geometry))}
					fill={`${ACCENT}22`}
					stroke={ACCENT}
					strokeDasharray="7 6"
					strokeWidth={1.5}
					vectorEffect="non-scaling-stroke"
				/>
			);
	}
}

function ShapeOverlay({ document }: OverlayProps) {
	const shapeDrag = useDrawStore((state) => state.shapeDrag);

	// Discard any in-flight drag preview when the shape tool is deactivated.
	useEffect(() => () => useDrawStore.getState().setShapeDrag(null), []);

	if (!shapeDrag) return null;

	const { width, height } = document.artboard;
	const previewGeometry = shapeGeometryFromDrag(
		shapeDrag.kind,
		shapeDrag.start,
		shapeDrag.current,
		{
			constrain: shapeDrag.constrain,
			fromCenter: shapeDrag.fromCenter,
		},
	);

	return (
		<svg
			className="pointer-events-none absolute inset-0 h-full w-full"
			viewBox={`0 0 ${width} ${height}`}
			aria-hidden="true"
		>
			<title>Shape preview</title>
			<ShapePreview geometry={previewGeometry} />
		</svg>
	);
}

function FreehandOverlay({ document, viewport }: OverlayProps) {
	const points = useDrawStore((state) => state.freehandPoints);
	const predictedTail = useDrawStore((state) => state.predictedTail);
	// Reflect the active brush so the live trace reads WYSIWYG: a Marker draws a
	// visibly thick trace and a Pen a thin one, instead of a fixed 2px guide that
	// never showed the chosen width. Width is the brush's artboard-unit width
	// scaled by the current zoom to match the committed stroke's on-screen size
	// (kept a `non-scaling-stroke` screen-pixel value). Colour stays the teal
	// wet-ink guide — this is still the in-progress trace, settled on release.
	const brushWidth = usePencilToolStore((state) => state.width);
	const brushType = usePencilToolStore((state) => state.brushType);
	const brushCap = PENCIL_BRUSH_PRESETS[brushType].strokeCap;
	const traceWidth = (brushWidth * viewport.zoom) / 100;

	// Deactivating the pencil unmounts this overlay (the host filters overlays by
	// active tool); discard any unfinished trace so it cannot resurface later.
	useEffect(() => () => useDrawStore.getState().resetFreehand(), []);

	if (points.length < 2) return null;

	const { width, height } = document.artboard;
	// Raw polyline of the captured samples — the honest in-progress trace, smoothed
	// into a Bézier path only on commit (Illustrator-style: draw rough, settle on
	// release).
	const pathData = `M ${points[0].x} ${points[0].y} ${points
		.slice(1)
		.map((point) => `L ${point.x} ${point.y}`)
		.join(" ")}`;
	// OS-predicted continuation (pen only; see onPencilMove), drawn as a second
	// path segment continuing from the last real sample. It shares the trace's
	// exact stroke style and is recomputed every move / cleared on commit or
	// cancel, so it never diverges into committed geometry.
	const predictedPathData =
		predictedTail.length > 0
			? `M ${points[points.length - 1].x} ${points[points.length - 1].y} ${predictedTail
					.map((point) => `L ${point.x} ${point.y}`)
					.join(" ")}`
			: null;

	return (
		<svg
			className="pointer-events-none absolute inset-0 h-full w-full"
			viewBox={`0 0 ${width} ${height}`}
			aria-hidden="true"
		>
			<path
				d={pathData}
				fill="none"
				stroke={ACCENT}
				strokeWidth={traceWidth}
				strokeLinecap={brushCap}
				strokeLinejoin="round"
				vectorEffect="non-scaling-stroke"
			/>
			{predictedPathData && (
				<path
					d={predictedPathData}
					fill="none"
					stroke={ACCENT}
					strokeWidth={traceWidth}
					strokeLinecap={brushCap}
					strokeLinejoin="round"
					vectorEffect="non-scaling-stroke"
				/>
			)}
		</svg>
	);
}

const penOverlay: OverlayDescriptor = {
	id: "draw-pen-overlay",
	tool: "pen",
	Component: PenOverlay,
};

const freehandOverlay: OverlayDescriptor = {
	id: "draw-pencil-overlay",
	tool: "pencil",
	Component: FreehandOverlay,
};

const shapeOverlay: OverlayDescriptor = {
	id: "draw-shape-overlay",
	tool: "shape",
	Component: ShapeOverlay,
};

export const overlays: readonly OverlayDescriptor[] = [
	penOverlay,
	freehandOverlay,
	shapeOverlay,
];
