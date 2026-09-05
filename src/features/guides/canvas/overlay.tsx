import { useMemo, useState } from "react";
import {
	collectRulerTicks,
	type GuideLine,
	type GuideRulerTick,
	type GuideSnapResult,
	guideLineGlobalValue,
	guideLineLocalValue,
	isGuideLineEditable,
	isGuideLineVisible,
	projectGuideSnapResult,
	visibleDocumentRange,
} from "@/entities/guides/model/snapping";
import { useGuideStore } from "@/entities/guides/model/store";
import {
	findArtboardById,
	type NormalizedArtboard,
	selectDefaultArtboard,
} from "@/entities/scene/model/selectors";
import type { SceneDocument } from "@/entities/scene/model/types";
import type {
	SnapAxis,
	SnapGuideVisual,
	SnapIndicator,
	SnapMeasurement,
	SnapProjection,
} from "@/shared/lib/snapping";
import { projectPoint } from "@/shared/lib/snapping";
import {
	guideLineForRulerDrag,
	type RulerDragAxis,
	type RulerDragScreenPoint,
	rulerDragAxisFromPoint,
} from "../model/ruler-drag";

/**
 * Viewport-fixed ruler + guide layer. It lives OUTSIDE the panned/scaled world
 * group and is sized to the canvas viewport, so the rulers hold the window edges
 * and the guides span the whole visible canvas. All screen positions come from
 * the same `projection` (`screen = world * zoom + pan`) the world group applies,
 * so there is no second copy of the pan/scale math.
 */
type OverlayProps = {
	readonly document: SceneDocument;
	readonly projection: SnapProjection;
	readonly viewportWidth: number;
	readonly viewportHeight: number;
};

const RULER_SIZE_PX = 18;
const RULER_LABEL_PX = 10;
const GUIDE_LABEL_OFFSET_PX = 4;
const GUIDE_STROKE = "#2ec4b6";
const GUIDE_LABEL_FILL = "#0f766e";
// Opaque, not translucent: the two ruler bands both originate at (0,0), so a
// translucent fill compounds where they overlap (the top-left corner gets
// painted twice and reads near-black) and shifts shade depending on whether the
// light artboard or the pasteboard sits behind it. A solid fill paints a single
// uniform chrome strip — the corner is just where the bands meet, no blotch.
const RULER_FILL = "#23252a";
const RULER_HAIRLINE = "rgba(255, 255, 255, 0.08)";
const RULER_STROKE = "rgba(255, 255, 255, 0.2)";
const RULER_LABEL_FILL = "rgba(255, 255, 255, 0.76)";
const MEASUREMENT_STROKE = "#f59e0b";
const ACTIVE_SNAP_FILL = "#f8fafc";
const ACTIVE_SNAP_STROKE = "#0f766e";

type RulerDrag = {
	readonly id: string;
	readonly axis: RulerDragAxis;
	readonly pointerId: number;
	readonly mode: "create" | "move";
	readonly coordinateSpace?: GuideLine["coordinateSpace"];
	readonly artboardId?: string;
};

let rulerGuideSequence = 0;

const offsetPoint = (
	point: { readonly x: number; readonly y: number },
	origin: { readonly x: number; readonly y: number },
) => ({
	x: point.x + origin.x,
	y: point.y + origin.y,
});

const translateSnapResult = (
	result: GuideSnapResult,
	origin: { readonly x: number; readonly y: number },
): GuideSnapResult => ({
	...result,
	point: offsetPoint(result.point, origin),
	adjustedPoint: offsetPoint(result.adjustedPoint, origin),
	guides: result.guides.map((guide) => ({
		...guide,
		from: offsetPoint(guide.from, origin),
		to: offsetPoint(guide.to, origin),
		labelAt: guide.labelAt ? offsetPoint(guide.labelAt, origin) : undefined,
	})),
	measurements: result.measurements.map((measurement) => ({
		...measurement,
		from: offsetPoint(measurement.from, origin),
		to: offsetPoint(measurement.to, origin),
		labelAt: offsetPoint(measurement.labelAt, origin),
	})),
	indicator: result.indicator
		? {
				...result.indicator,
				point: offsetPoint(result.indicator.point, origin),
			}
		: null,
});

/** Screen-space position of a guide's single axis value under the projection. */
const projectedAxisScreen = (
	axis: SnapAxis,
	value: number,
	projection: SnapProjection,
): number => {
	const projected = projectPoint(
		axis === "x" ? { x: value, y: 0 } : { x: 0, y: value },
		projection,
	);
	return axis === "x" ? projected.x : projected.y;
};

const scopedArtboardForGuide = (
	line: GuideLine,
	document: SceneDocument,
): NormalizedArtboard | null => {
	if (line.coordinateSpace === "pasteboard") return null;
	if (!line.artboardId) return selectDefaultArtboard(document);
	return findArtboardById(document, line.artboardId) ?? null;
};

/**
 * Projects a persisted guide into a full-viewport screen line. A vertical
 * (x-axis) guide runs the whole viewport height; a horizontal (y-axis) guide
 * runs the whole viewport width — the guide is no longer clamped to the
 * artboard/pasteboard frame. Explicit artboard-scoped guides are the exception:
 * they render only inside their owning artboard so multi-artboard scope remains
 * visible instead of being implied by whichever frame happens to be active.
 */
const lineForGuide = (
	line: GuideLine,
	document: SceneDocument,
	projection: SnapProjection,
	viewportWidth: number,
	viewportHeight: number,
	guideLabelInsetPx: number,
): SnapGuideVisual | null => {
	const value = guideLineGlobalValue(line, document);
	if (!Number.isFinite(value)) return null;
	const scopedArtboard = scopedArtboardForGuide(line, document);
	if (scopedArtboard) {
		const localValue = guideLineLocalValue(line, {
			...document,
			artboard: scopedArtboard,
		});
		const limit =
			line.axis === "x" ? scopedArtboard.width : scopedArtboard.height;
		if (localValue < 0 || localValue > limit) return null;
		const start = projectPoint(scopedArtboard.position, projection);
		const end = projectPoint(
			{
				x: scopedArtboard.position.x + scopedArtboard.width,
				y: scopedArtboard.position.y + scopedArtboard.height,
			},
			projection,
		);
		const screen = projectedAxisScreen(line.axis, value, projection);
		if (line.axis === "x") {
			return {
				axis: "x",
				from: { x: screen, y: start.y },
				to: { x: screen, y: end.y },
				label: line.label,
				labelAt: { x: screen, y: start.y },
			};
		}
		return {
			axis: "y",
			from: { x: start.x, y: screen },
			to: { x: end.x, y: screen },
			label: line.label,
			labelAt: { x: start.x, y: screen },
		};
	}
	const screen = projectedAxisScreen(line.axis, value, projection);
	if (line.axis === "x") {
		return {
			axis: "x",
			from: { x: screen, y: 0 },
			to: { x: screen, y: viewportHeight },
			label: line.label,
			labelAt: { x: screen, y: guideLabelInsetPx },
		};
	}
	return {
		axis: "y",
		from: { x: 0, y: screen },
		to: { x: viewportWidth, y: screen },
		label: line.label,
		labelAt: { x: guideLabelInsetPx, y: screen },
	};
};

function RulerTickMark({ tick }: { readonly tick: GuideRulerTick }) {
	const major = tick.kind === "major";
	const length = major ? RULER_SIZE_PX : RULER_SIZE_PX * 0.52;
	if (tick.axis === "x") {
		return (
			<g>
				<line
					x1={tick.screenPosition}
					y1={RULER_SIZE_PX}
					x2={tick.screenPosition}
					y2={RULER_SIZE_PX - length}
					stroke={RULER_STROKE}
				/>
				{major && tick.label ? (
					<text
						x={tick.screenPosition + 3}
						y={11}
						fill={RULER_LABEL_FILL}
						fontSize={RULER_LABEL_PX}
					>
						{tick.label}
					</text>
				) : null}
			</g>
		);
	}
	return (
		<g>
			<line
				x1={RULER_SIZE_PX}
				y1={tick.screenPosition}
				x2={RULER_SIZE_PX - length}
				y2={tick.screenPosition}
				stroke={RULER_STROKE}
			/>
			{major && tick.label ? (
				<text
					x={3}
					y={tick.screenPosition - 3}
					fill={RULER_LABEL_FILL}
					fontSize={RULER_LABEL_PX}
				>
					{tick.label}
				</text>
			) : null}
		</g>
	);
}

function GuideVisualLine({
	guide,
	strong = false,
}: {
	readonly guide: SnapGuideVisual;
	readonly strong?: boolean;
}) {
	return (
		<g>
			<line
				x1={guide.from.x}
				y1={guide.from.y}
				x2={guide.to.x}
				y2={guide.to.y}
				stroke={GUIDE_STROKE}
				strokeDasharray={strong ? undefined : "4 4"}
				strokeWidth={strong ? 1.5 : 1}
			/>
			{guide.label && guide.labelAt ? (
				<text
					x={guide.labelAt.x + 5}
					y={guide.labelAt.y + 12}
					fill={GUIDE_LABEL_FILL}
					fontSize="11"
					fontWeight="600"
				>
					{guide.label}
				</text>
			) : null}
		</g>
	);
}

function MeasurementLine({
	measurement,
}: {
	readonly measurement: SnapMeasurement;
}) {
	return (
		<g>
			<line
				x1={measurement.from.x}
				y1={measurement.from.y}
				x2={measurement.to.x}
				y2={measurement.to.y}
				stroke={MEASUREMENT_STROKE}
				strokeWidth="1.5"
			/>
			<text
				x={measurement.labelAt.x + 5}
				y={measurement.labelAt.y - 5}
				fill={MEASUREMENT_STROKE}
				fontSize="11"
				fontWeight="650"
			>
				{measurement.label}
			</text>
		</g>
	);
}

const SNAP_VERTEX_GLYPH_RADIUS = 4;
const SNAP_GRID_GLYPH_RADIUS = 5;

/**
 * Draws the active snap target with a glyph that names what was snapped to, the
 * way Illustrator distinguishes anchor vs. intersection: a hollow SQUARE for a real
 * shape vertex, a hollow DIAMOND for a grid crossing, and the default dot +
 * crosshair for a 1-D axis/edge alignment. One teal color system throughout — the
 * shape, not the color, carries the meaning.
 */
function SnapIndicatorMark({
	indicator,
}: {
	readonly indicator: SnapIndicator;
}) {
	const { x, y } = indicator.point;

	if (indicator.kind === "vertex") {
		const r = SNAP_VERTEX_GLYPH_RADIUS;
		return (
			<rect
				x={x - r}
				y={y - r}
				width={r * 2}
				height={r * 2}
				fill={ACTIVE_SNAP_FILL}
				stroke={ACTIVE_SNAP_STROKE}
				strokeWidth="1.5"
			/>
		);
	}

	if (indicator.kind === "grid") {
		const r = SNAP_GRID_GLYPH_RADIUS;
		return (
			<polygon
				points={`${x},${y - r} ${x + r},${y} ${x},${y + r} ${x - r},${y}`}
				fill={ACTIVE_SNAP_FILL}
				stroke={ACTIVE_SNAP_STROKE}
				strokeWidth="1.5"
			/>
		);
	}

	const showX = indicator.axes.includes("x");
	const showY = indicator.axes.includes("y");
	return (
		<g>
			<circle
				cx={x}
				cy={y}
				r="4"
				fill={ACTIVE_SNAP_FILL}
				stroke={ACTIVE_SNAP_STROKE}
				strokeWidth="1.5"
			/>
			{showX ? (
				<line
					x1={x}
					y1={y - 8}
					x2={x}
					y2={y + 8}
					stroke={ACTIVE_SNAP_STROKE}
					strokeWidth="1.25"
				/>
			) : null}
			{showY ? (
				<line
					x1={x - 8}
					y1={y}
					x2={x + 8}
					y2={y}
					stroke={ACTIVE_SNAP_STROKE}
					strokeWidth="1.25"
				/>
			) : null}
		</g>
	);
}

function GuideInteractionLine({
	line,
	guide,
	onPointerDown,
	onPointerMove,
	onPointerUp,
	onPointerCancel,
}: {
	readonly line: GuideLine;
	readonly guide: SnapGuideVisual;
	readonly onPointerDown: (
		line: GuideLine,
		event: React.PointerEvent<SVGLineElement>,
	) => void;
	readonly onPointerMove: (event: React.PointerEvent<SVGLineElement>) => void;
	readonly onPointerUp: (event: React.PointerEvent<SVGLineElement>) => void;
	readonly onPointerCancel: (event: React.PointerEvent<SVGLineElement>) => void;
}) {
	return (
		<line
			x1={guide.from.x}
			y1={guide.from.y}
			x2={guide.to.x}
			y2={guide.to.y}
			stroke="transparent"
			strokeWidth="10"
			pointerEvents="stroke"
			cursor={line.axis === "x" ? "col-resize" : "row-resize"}
			onPointerDown={(event) => onPointerDown(line, event)}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerCancel}
		/>
	);
}

export function GuidesOverlay({
	document,
	projection,
	viewportWidth,
	viewportHeight,
}: OverlayProps) {
	const guideLines = useGuideStore((state) => state.guideLines);
	const activeSnap = useGuideStore((state) => state.activeSnap);
	const rulersVisible = useGuideStore((state) => state.view.rulersVisible);
	const guideLinesVisible = useGuideStore(
		(state) => state.view.guideLinesVisible,
	);
	const createGuideLine = useGuideStore((state) => state.createGuideLine);
	const moveGuideLine = useGuideStore((state) => state.moveGuideLine);
	const removeGuideLine = useGuideStore((state) => state.removeGuideLine);
	const [rulerDrag, setRulerDrag] = useState<RulerDrag | null>(null);
	const [draftGuide, setDraftGuide] = useState<GuideLine | null>(null);
	const renderRulers = rulersVisible || rulerDrag !== null;
	const guideLabelInsetPx = rulersVisible
		? RULER_SIZE_PX + GUIDE_LABEL_OFFSET_PX
		: GUIDE_LABEL_OFFSET_PX;
	const ticks = useMemo(
		() =>
			collectRulerTicks(document, projection, {
				visibleRange: visibleDocumentRange(projection, {
					width: viewportWidth,
					height: viewportHeight,
				}),
			}),
		[document, projection, viewportWidth, viewportHeight],
	);
	const projectedSnap = activeSnap
		? projectGuideSnapResult(
				translateSnapResult(
					activeSnap.result,
					activeSnap.origin ?? { x: 0, y: 0 },
				),
				projection,
			)
		: null;
	const displayGuideLines = guideLinesVisible
		? guideLines.filter(isGuideLineVisible)
		: [];
	const visibleGuideLines =
		rulerDrag?.mode === "move"
			? draftGuide
				? displayGuideLines.map((line) =>
						line.id === draftGuide.id ? draftGuide : line,
					)
				: displayGuideLines.filter((line) => line.id !== rulerDrag.id)
			: draftGuide
				? [...displayGuideLines, draftGuide]
				: displayGuideLines;
	const projectedGuideLines = visibleGuideLines.flatMap((line) => {
		const guide = lineForGuide(
			line,
			document,
			projection,
			viewportWidth,
			viewportHeight,
			guideLabelInsetPx,
		);
		return guide ? [{ line, guide }] : [];
	});
	const editableGuideLines = projectedGuideLines.filter(({ line }) =>
		isGuideLineEditable(line),
	);
	const pointFromPointer = (
		event: React.PointerEvent<SVGElement>,
	): RulerDragScreenPoint | null => {
		const rect =
			event.currentTarget.ownerSVGElement?.getBoundingClientRect() ??
			event.currentTarget.getBoundingClientRect();
		return {
			x: event.clientX - rect.left,
			y: event.clientY - rect.top,
		};
	};
	const nextDraftGuide = (
		drag: RulerDrag,
		point: RulerDragScreenPoint,
	): GuideLine | null =>
		guideLineForRulerDrag({
			id: drag.id,
			axis: drag.axis,
			point,
			projection,
			document,
			coordinateSpace: drag.coordinateSpace,
			artboardId: drag.artboardId,
		});
	const onRulerPointerDown = (
		event: React.PointerEvent<SVGRectElement>,
	): void => {
		const point = pointFromPointer(event);
		if (!point) return;
		const axis = rulerDragAxisFromPoint(point, RULER_SIZE_PX);
		if (!axis) return;
		event.preventDefault();
		event.stopPropagation();
		rulerGuideSequence += 1;
		const drag = {
			id: `guide-${axis}-${rulerGuideSequence}`,
			axis,
			pointerId: event.pointerId,
			mode: "create",
			coordinateSpace: "pasteboard",
		} satisfies RulerDrag;
		event.currentTarget.setPointerCapture(event.pointerId);
		setRulerDrag(drag);
		setDraftGuide(nextDraftGuide(drag, point));
	};
	const onGuidePointerDown = (
		line: GuideLine,
		event: React.PointerEvent<SVGLineElement>,
	): void => {
		if (!isGuideLineEditable(line)) return;
		event.preventDefault();
		event.stopPropagation();
		const drag = {
			id: line.id,
			axis: line.axis,
			pointerId: event.pointerId,
			mode: "move",
			coordinateSpace: line.coordinateSpace,
			artboardId: line.artboardId,
		} satisfies RulerDrag;
		event.currentTarget.setPointerCapture(event.pointerId);
		setRulerDrag(drag);
		setDraftGuide(line);
	};
	const onDragPointerMove = (event: React.PointerEvent<SVGElement>): void => {
		if (!rulerDrag || rulerDrag.pointerId !== event.pointerId) return;
		const point = pointFromPointer(event);
		if (!point) return;
		event.preventDefault();
		setDraftGuide(nextDraftGuide(rulerDrag, point));
	};
	const finishRulerDrag = (
		event: React.PointerEvent<SVGElement>,
		commit: boolean,
	): void => {
		if (!rulerDrag || rulerDrag.pointerId !== event.pointerId) return;
		const dropPoint = pointFromPointer(event);
		// Releasing over either ruler band (not only the guide's own axis) cancels a
		// create and deletes a move, so a guide is never stranded under a ruler.
		const releasedOverRuler = dropPoint
			? rulerDragAxisFromPoint(dropPoint, RULER_SIZE_PX) !== null
			: false;
		if (commit && draftGuide && !releasedOverRuler) {
			if (rulerDrag.mode === "create") createGuideLine(draftGuide);
			if (rulerDrag.mode === "move") moveGuideLine(draftGuide);
		}
		if (commit && releasedOverRuler && rulerDrag.mode === "move") {
			removeGuideLine(rulerDrag.id);
		}
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		setRulerDrag(null);
		setDraftGuide(null);
	};

	return (
		<svg
			className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
			viewBox={`0 0 ${viewportWidth} ${viewportHeight}`}
			preserveAspectRatio="none"
			aria-hidden="true"
		>
			{projectedGuideLines.map(({ line, guide }) => (
				<GuideVisualLine key={`guide:${line.id}`} guide={guide} />
			))}
			{editableGuideLines.map(({ line, guide }) => (
				<GuideInteractionLine
					key={`hit:${line.id}`}
					line={line}
					guide={guide}
					onPointerDown={onGuidePointerDown}
					onPointerMove={onDragPointerMove}
					onPointerUp={(event) => finishRulerDrag(event, true)}
					onPointerCancel={(event) => finishRulerDrag(event, false)}
				/>
			))}
			{projectedSnap?.guides.map((guide) => (
				<GuideVisualLine
					key={`snap:${guide.axis}:${guide.from.x}:${guide.from.y}:${guide.to.x}:${guide.to.y}:${guide.label ?? ""}`}
					guide={guide}
					strong
				/>
			))}
			{projectedSnap?.indicator ? (
				<SnapIndicatorMark indicator={projectedSnap.indicator} />
			) : null}
			{activeSnap?.isDragging
				? projectedSnap?.measurements.map((measurement) => (
						<MeasurementLine
							key={`${measurement.axis}:${measurement.from.x}:${measurement.from.y}`}
							measurement={measurement}
						/>
					))
				: null}
			{renderRulers ? (
				<>
					<rect
						width={viewportWidth}
						height={RULER_SIZE_PX}
						fill={RULER_FILL}
					/>
					<rect
						width={RULER_SIZE_PX}
						height={viewportHeight}
						fill={RULER_FILL}
					/>
					<g shapeRendering="crispEdges">
						{/* Inner hairline along the canvas-facing edge for a crisp,
						    Figma-like ruler border (the corner is just where they meet). */}
						<line
							x1={0}
							y1={RULER_SIZE_PX}
							x2={viewportWidth}
							y2={RULER_SIZE_PX}
							stroke={RULER_HAIRLINE}
						/>
						<line
							x1={RULER_SIZE_PX}
							y1={0}
							x2={RULER_SIZE_PX}
							y2={viewportHeight}
							stroke={RULER_HAIRLINE}
						/>
					</g>
					<g shapeRendering="crispEdges">
						{ticks.map((tick) => (
							<RulerTickMark
								key={`${tick.axis}:${tick.kind}:${tick.value}`}
								tick={tick}
							/>
						))}
					</g>
					<rect
						width={viewportWidth}
						height={RULER_SIZE_PX}
						fill="transparent"
						pointerEvents="all"
						cursor="col-resize"
						onPointerDown={onRulerPointerDown}
						onPointerMove={onDragPointerMove}
						onPointerUp={(event) => finishRulerDrag(event, true)}
						onPointerCancel={(event) => finishRulerDrag(event, false)}
					/>
					<rect
						width={RULER_SIZE_PX}
						height={viewportHeight}
						fill="transparent"
						pointerEvents="all"
						cursor="row-resize"
						onPointerDown={onRulerPointerDown}
						onPointerMove={onDragPointerMove}
						onPointerUp={(event) => finishRulerDrag(event, true)}
						onPointerCancel={(event) => finishRulerDrag(event, false)}
					/>
				</>
			) : null}
		</svg>
	);
}
