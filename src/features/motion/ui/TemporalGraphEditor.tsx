import {
	type PointerEvent as ReactPointerEvent,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	setCameraRigKeyframeEasingCurve,
	setCameraRigKeyframeTime,
	upsertCameraRigKeyframe,
} from "@/entities/motion/model/camera-commands";
import type { MotionCommand } from "@/entities/motion/model/command";
import {
	setKeyframeEasingCurve,
	setKeyframeTime,
	setSourceOpticsKeyframeEasingCurve,
	setSourceOpticsKeyframeTime,
	setTextAnimatorOffsetKeyframeEasingCurve,
	setTextAnimatorOffsetKeyframeTime,
	setTextAnimatorOffsetKeyframeValue,
	upsertKeyframe,
	upsertSourceOpticsKeyframe,
} from "@/entities/motion/model/commands";
import {
	type EasingCurve,
	normalizeEasingCurve,
	segmentEasingCurveOf,
} from "@/entities/motion/model/easing";
import {
	applyInMotionTransaction,
	beginMotionTransaction,
	commitMotionTransaction,
	type MotionGestureTransaction,
} from "@/entities/motion/model/gesture-transaction";
import { useMotionStore } from "@/entities/motion/model/store";
import { resolveTextAnimatorOffsetKey } from "@/entities/motion/model/text-animator";
import type { AeKeyframe } from "@/entities/motion/model/types";
import { sampleKeyframeTrack } from "@/shared/glammer/keyframe-track";
import { cn } from "@/shared/lib/cn";
import {
	isCameraSelectedKey,
	isNodeSelectedKey,
	isSourceOpticsSelectedKey,
	isTextAnimatorOffsetSelectedKey,
	retimedSelectedKeyInMotion,
	snapTimelineFrame,
} from "./timeline-adapter";
import type { SelectedKey } from "./timeline-model";

type GraphKind = "value" | "speed";

const WIDTH = 900;
const HEIGHT = 250;
const PAD_X = 28;
const PAD_Y = 20;
const SAMPLE_COUNT = 240;
const KEY_HIT_RADIUS = 9;
const HANDLE_RADIUS = 5;
const VALUE_PRECISION = 1000;
const FLAT_SEGMENT_EPSILON = 1e-9;

type CurveHandle = "out" | "in";

type ViewBounds = {
	readonly start: number;
	readonly end: number;
	readonly min: number;
	readonly max: number;
};

type DragState =
	| {
			readonly kind: "key";
			readonly pointerId: number;
			/** Live frame of the dragged key; updated after each successful retime. */
			frame: number;
			readonly valueDraggable: boolean;
			readonly transaction: MotionGestureTransaction;
	  }
	| {
			readonly kind: "handle";
			readonly pointerId: number;
			readonly handle: CurveHandle;
			readonly transaction: MotionGestureTransaction;
	  }
	| {
			readonly kind: "pan";
			readonly pointerId: number;
			readonly startClientX: number;
			readonly startPanFrames: number;
			readonly framesPerClientPixel: number;
	  };

const numericKeys = (
	keyframes: readonly AeKeyframe<unknown>[],
): AeKeyframe<number>[] =>
	keyframes.filter(
		(keyframe): keyframe is AeKeyframe<number> =>
			Number.isFinite(keyframe.time) &&
			typeof keyframe.value === "number" &&
			Number.isFinite(keyframe.value),
	);

const clampUnit = (value: number): number => Math.min(1, Math.max(0, value));

const roundValue = (value: number): number =>
	Math.round(value * VALUE_PRECISION) / VALUE_PRECISION;

/**
 * Value/Speed graph in Timeline mode, backed by the same keyframe sampler as
 * canvas and export, and now a direct authoring surface: keys drag in time and
 * value, and the selected segment's temporal handles reshape the exact cubic
 * through ordinary Motion commands. It stays deliberately single-track:
 * selection defines the owner and avoids visually merging unrelated units into
 * a misleading graph. Every pointer gesture opens one motion transaction so a
 * whole drag undoes as a single history entry.
 */
export function TemporalGraphEditor({
	selectedKey,
	onSelectKey,
}: {
	readonly selectedKey: SelectedKey;
	readonly onSelectKey: (key: SelectedKey) => void;
}) {
	const motion = useMotionStore((state) => state.document);
	const [kind, setKind] = useState<GraphKind>("value");
	const [zoom, setZoom] = useState(1);
	const [panFrames, setPanFrames] = useState(0);
	const [viewLocked, setViewLocked] = useState(false);
	const svgRef = useRef<SVGSVGElement>(null);
	const dragRef = useRef<DragState | null>(null);
	const viewLockRef = useRef<ViewBounds | null>(null);
	const lastBoundsRef = useRef<ViewBounds | null>(null);
	useEffect(
		() => () => {
			const drag = dragRef.current;
			if (drag && drag.kind !== "pan") {
				commitMotionTransaction(drag.transaction);
			}
			dragRef.current = null;
		},
		[],
	);
	const resolvedTextAnimatorKey = isTextAnimatorOffsetSelectedKey(selectedKey)
		? resolveTextAnimatorOffsetKey(motion, selectedKey)
		: null;
	const track = isTextAnimatorOffsetSelectedKey(selectedKey)
		? resolvedTextAnimatorKey
			? { keyframes: resolvedTextAnimatorKey.selector.offsetKeyframes ?? [] }
			: undefined
		: isCameraSelectedKey(selectedKey)
			? motion.cameraTracks?.find(
					(candidate) => candidate.id === selectedKey.trackId,
				)
			: isSourceOpticsSelectedKey(selectedKey)
				? motion.sourceOpticsTracks?.find(
						(candidate) => candidate.id === selectedKey.trackId,
					)
				: motion.tracks.find(
						(candidate) => candidate.id === selectedKey.trackId,
					);
	const keys = track ? numericKeys(track.keyframes) : [];
	const selectedIndex = keys.findIndex((key) => key.time === selectedKey.frame);
	const selectedKeyframe = selectedIndex >= 0 ? keys[selectedIndex] : undefined;
	const nextKeyframe = selectedIndex >= 0 ? keys[selectedIndex + 1] : undefined;
	/**
	 * X/Y tracks paired to a direct spatial motion path keep their spatial truth
	 * in the path owner; a lone scalar value edit would desync route geometry, so
	 * value dragging fails closed while retime (path-synchronized) stays allowed.
	 */
	const valueDragLocked =
		isNodeSelectedKey(selectedKey) &&
		(selectedKey.property === "x" || selectedKey.property === "y") &&
		(motion.positionPaths?.some((path) => path.nodeId === selectedKey.nodeId) ??
			false);

	const graph = useMemo(() => {
		if (keys.length === 0) return null;
		const locked = viewLocked ? viewLockRef.current : null;
		const totalRange = Math.max(1, motion.durationFrames);
		const visibleRange = totalRange / zoom;
		const start =
			locked?.start ??
			Math.max(
				0,
				Math.min(
					totalRange - visibleRange,
					selectedKey.frame + panFrames - visibleRange / 2,
				),
			);
		const end = locked?.end ?? Math.min(totalRange, start + visibleRange);
		const valueAt = (frame: number): number => sampleKeyframeTrack(keys, frame);
		const sampled = Array.from({ length: SAMPLE_COUNT }, (_, index) => {
			const frame = start + (index / (SAMPLE_COUNT - 1)) * (end - start);
			const value =
				kind === "value"
					? valueAt(frame)
					: ((valueAt(Math.min(end, frame + 0.05)) -
							valueAt(Math.max(start, frame - 0.05))) /
							Math.max(
								0.0001,
								Math.min(end, frame + 0.05) - Math.max(start, frame - 0.05),
							)) *
						motion.fps;
			return { frame, value };
		});
		const values = sampled
			.map((sample) => sample.value)
			.filter(Number.isFinite);
		if (values.length === 0) return null;
		let min = Math.min(...values);
		let max = Math.max(...values);
		if (Math.abs(max - min) < 1e-9) {
			min -= 1;
			max += 1;
		}
		const padding = (max - min) * 0.08;
		min -= padding;
		max += padding;
		if (locked) {
			min = locked.min;
			max = locked.max;
		}
		lastBoundsRef.current = { start, end, min, max };
		const x = (frame: number): number =>
			PAD_X +
			((frame - start) / Math.max(1e-9, end - start)) * (WIDTH - PAD_X * 2);
		const y = (value: number): number =>
			PAD_Y + (1 - (value - min) / (max - min)) * (HEIGHT - PAD_Y * 2);
		const frameAt = (svgX: number): number =>
			start + clampUnit((svgX - PAD_X) / (WIDTH - PAD_X * 2)) * (end - start);
		const valueFromY = (svgY: number): number =>
			min +
			(1 - (svgY - PAD_Y) / Math.max(1e-9, HEIGHT - PAD_Y * 2)) * (max - min);
		return {
			start,
			end,
			min,
			max,
			x,
			y,
			frameAt,
			valueFromY,
			path: sampled
				.map(
					(sample, index) =>
						`${index === 0 ? "M" : "L"} ${x(sample.frame).toFixed(2)} ${y(sample.value).toFixed(2)}`,
				)
				.join(" "),
		};
	}, [
		keys,
		kind,
		motion.durationFrames,
		motion.fps,
		panFrames,
		selectedKey.frame,
		viewLocked,
		zoom,
	]);

	const segmentCurve =
		selectedKeyframe && nextKeyframe
			? segmentEasingCurveOf(selectedKeyframe, nextKeyframe)
			: null;
	const segmentValueDelta =
		selectedKeyframe && nextKeyframe
			? nextKeyframe.value - selectedKeyframe.value
			: 0;
	const flatSegment = Math.abs(segmentValueDelta) < FLAT_SEGMENT_EPSILON;

	const svgPointFromClient = (
		clientX: number,
		clientY: number,
	): { readonly x: number; readonly y: number } => {
		const rect = svgRef.current?.getBoundingClientRect();
		if (!rect || rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
		return {
			x: ((clientX - rect.left) / rect.width) * WIDTH,
			y: ((clientY - rect.top) / rect.height) * HEIGHT,
		};
	};

	const retimeCommand = (
		fromFrame: number,
		toFrame: number,
		coalesceKey: string,
	): MotionCommand =>
		isTextAnimatorOffsetSelectedKey(selectedKey)
			? setTextAnimatorOffsetKeyframeTime(
					{ ...selectedKey, frame: fromFrame },
					toFrame,
					coalesceKey,
				)
			: isCameraSelectedKey(selectedKey)
				? setCameraRigKeyframeTime(
						selectedKey.trackId,
						fromFrame,
						toFrame,
						coalesceKey,
					)
				: isSourceOpticsSelectedKey(selectedKey)
					? setSourceOpticsKeyframeTime(
							selectedKey.trackId,
							fromFrame,
							toFrame,
							coalesceKey,
						)
					: setKeyframeTime(
							selectedKey.trackId,
							fromFrame,
							toFrame,
							coalesceKey,
						);

	const valueCommand = (frame: number, value: number): MotionCommand | null => {
		if (isTextAnimatorOffsetSelectedKey(selectedKey)) {
			return setTextAnimatorOffsetKeyframeValue(
				{ ...selectedKey, frame },
				value,
			);
		}
		if (isCameraSelectedKey(selectedKey)) {
			return upsertCameraRigKeyframe(
				selectedKey.cameraRigId,
				selectedKey.property,
				frame,
				value,
			);
		}
		if (isSourceOpticsSelectedKey(selectedKey)) {
			return upsertSourceOpticsKeyframe(selectedKey.target, frame, value);
		}
		if (!isNodeSelectedKey(selectedKey)) return null;
		return upsertKeyframe(
			selectedKey.nodeId,
			selectedKey.property,
			frame,
			value,
		);
	};

	const easingCurveCommand = (
		frame: number,
		curve: EasingCurve,
	): MotionCommand =>
		isTextAnimatorOffsetSelectedKey(selectedKey)
			? setTextAnimatorOffsetKeyframeEasingCurve(
					{ ...selectedKey, frame },
					curve,
				)
			: isCameraSelectedKey(selectedKey)
				? setCameraRigKeyframeEasingCurve(selectedKey.trackId, frame, curve)
				: isSourceOpticsSelectedKey(selectedKey)
					? setSourceOpticsKeyframeEasingCurve(
							selectedKey.trackId,
							frame,
							curve,
						)
					: setKeyframeEasingCurve(selectedKey.trackId, frame, curve);

	const lockView = (): void => {
		viewLockRef.current = lastBoundsRef.current;
		setViewLocked(true);
	};

	const beginKeyDrag = (
		event: ReactPointerEvent<SVGCircleElement>,
		key: AeKeyframe<number>,
	): void => {
		if (kind !== "value" || dragRef.current) return;
		event.preventDefault();
		event.stopPropagation();
		if (key.time !== selectedKey.frame) {
			onSelectKey({ ...selectedKey, frame: key.time });
		}
		lockView();
		dragRef.current = {
			kind: "key",
			pointerId: event.pointerId,
			frame: key.time,
			valueDraggable: !valueDragLocked,
			transaction: beginMotionTransaction("graph-key-drag", "Drag keyframe"),
		};
		svgRef.current?.setPointerCapture(event.pointerId);
	};

	const beginHandleDrag = (
		event: ReactPointerEvent<SVGCircleElement>,
		handle: CurveHandle,
	): void => {
		if (kind !== "value" || dragRef.current || !segmentCurve) return;
		event.preventDefault();
		event.stopPropagation();
		lockView();
		dragRef.current = {
			kind: "handle",
			pointerId: event.pointerId,
			handle,
			transaction: beginMotionTransaction(
				"graph-handle-drag",
				"Adjust temporal curve",
			),
		};
		svgRef.current?.setPointerCapture(event.pointerId);
	};

	const beginPanDrag = (event: ReactPointerEvent<SVGSVGElement>): void => {
		if (dragRef.current || !graph || zoom <= 1) return;
		event.preventDefault();
		const rect = svgRef.current?.getBoundingClientRect();
		if (!rect || rect.width <= 0) return;
		dragRef.current = {
			kind: "pan",
			pointerId: event.pointerId,
			startClientX: event.clientX,
			startPanFrames: panFrames,
			framesPerClientPixel: (graph.end - graph.start) / rect.width,
		};
		svgRef.current?.setPointerCapture(event.pointerId);
	};

	const continueKeyDrag = (
		drag: Extract<DragState, { kind: "key" }>,
		clientX: number,
		clientY: number,
	): void => {
		if (!graph) return;
		const point = svgPointFromClient(clientX, clientY);
		const targetFrame = snapTimelineFrame(
			graph.frameAt(point.x),
			motion.durationFrames,
		);
		if (targetFrame !== drag.frame) {
			applyInMotionTransaction(
				drag.transaction,
				retimeCommand(drag.frame, targetFrame, drag.transaction.coalesceKey),
			);
			const retimed = retimedSelectedKeyInMotion(
				useMotionStore.getState().document,
				{ ...selectedKey, frame: drag.frame },
				targetFrame,
			);
			if (retimed) {
				drag.frame = retimed.frame;
				onSelectKey(retimed);
			}
		}
		if (!drag.valueDraggable) return;
		const targetValue = roundValue(graph.valueFromY(point.y));
		const command = valueCommand(drag.frame, targetValue);
		if (command) applyInMotionTransaction(drag.transaction, command);
	};

	const continueHandleDrag = (
		drag: Extract<DragState, { kind: "handle" }>,
		clientX: number,
		clientY: number,
	): void => {
		if (!graph || !segmentCurve || !selectedKeyframe || !nextKeyframe) return;
		const span = nextKeyframe.time - selectedKeyframe.time;
		if (span <= 0) return;
		const point = svgPointFromClient(clientX, clientY);
		const fraction = clampUnit(
			(graph.frameAt(point.x) - selectedKeyframe.time) / span,
		);
		const yFraction = flatSegment
			? drag.handle === "out"
				? segmentCurve.y1
				: segmentCurve.y2
			: (graph.valueFromY(point.y) - selectedKeyframe.value) /
				segmentValueDelta;
		const nextCurve = normalizeEasingCurve(
			drag.handle === "out"
				? { ...segmentCurve, x1: fraction, y1: yFraction }
				: { ...segmentCurve, x2: fraction, y2: yFraction },
		);
		applyInMotionTransaction(
			drag.transaction,
			easingCurveCommand(selectedKey.frame, nextCurve),
		);
	};

	const onGraphPointerMove = (
		event: ReactPointerEvent<SVGSVGElement>,
	): void => {
		const drag = dragRef.current;
		if (!drag || event.pointerId !== drag.pointerId) return;
		event.preventDefault();
		if (drag.kind === "key") {
			continueKeyDrag(drag, event.clientX, event.clientY);
			return;
		}
		if (drag.kind === "handle") {
			continueHandleDrag(drag, event.clientX, event.clientY);
			return;
		}
		setPanFrames(
			drag.startPanFrames -
				(event.clientX - drag.startClientX) * drag.framesPerClientPixel,
		);
	};

	const onGraphPointerEnd = (event: ReactPointerEvent<SVGSVGElement>): void => {
		const drag = dragRef.current;
		if (!drag || event.pointerId !== drag.pointerId) return;
		if (drag.kind !== "pan") commitMotionTransaction(drag.transaction);
		dragRef.current = null;
		viewLockRef.current = null;
		setViewLocked(false);
		if (svgRef.current?.hasPointerCapture(event.pointerId)) {
			svgRef.current.releasePointerCapture(event.pointerId);
		}
	};

	if (!graph) {
		return (
			<div className="grid min-h-0 flex-1 place-items-center text-fg-muted text-ui">
				Value and Speed graphs require a numeric track.
			</div>
		);
	}

	const outHandle =
		segmentCurve && selectedKeyframe && nextKeyframe
			? {
					x: graph.x(
						selectedKeyframe.time +
							segmentCurve.x1 * (nextKeyframe.time - selectedKeyframe.time),
					),
					y: graph.y(
						selectedKeyframe.value + segmentCurve.y1 * segmentValueDelta,
					),
				}
			: null;
	const inHandle =
		segmentCurve && selectedKeyframe && nextKeyframe
			? {
					x: graph.x(
						selectedKeyframe.time +
							segmentCurve.x2 * (nextKeyframe.time - selectedKeyframe.time),
					),
					y: graph.y(
						selectedKeyframe.value + segmentCurve.y2 * segmentValueDelta,
					),
				}
			: null;

	return (
		<section
			className="flex min-h-0 flex-1 flex-col bg-black/10"
			aria-label="Temporal graph editor"
		>
			<div className="flex h-8 shrink-0 items-center justify-between border-white/10 border-b px-2 text-ui">
				<div className="flex items-center gap-1">
					{(["value", "speed"] as const).map((candidate) => (
						<button
							key={candidate}
							type="button"
							aria-pressed={kind === candidate}
							onClick={() => setKind(candidate)}
							className={cn(
								"h-6 rounded border px-2 capitalize",
								kind === candidate
									? "border-accent/60 bg-accent-surface text-accent-fg"
									: "border-white/10 bg-white/[0.035] text-fg-secondary",
							)}
						>
							{candidate}
						</button>
					))}
					{valueDragLocked && kind === "value" ? (
						<span className="ml-1 text-fg-muted">
							Value drag owned by motion path
						</span>
					) : null}
				</div>
				<div className="flex items-center gap-1">
					<button
						type="button"
						className="h-6 rounded border border-white/10 px-2 text-fg-secondary"
						onClick={() => {
							setZoom(1);
							setPanFrames(0);
						}}
					>
						Fit
					</button>
					<button
						type="button"
						aria-label="Zoom out"
						className="size-6 rounded border border-white/10 text-fg-secondary"
						onClick={() => setZoom((value) => Math.max(1, value / 2))}
					>
						−
					</button>
					<span className="w-8 text-center font-mono text-fg-muted">
						{zoom}×
					</span>
					<button
						type="button"
						aria-label="Zoom in"
						className="size-6 rounded border border-white/10 text-fg-secondary"
						onClick={() => setZoom((value) => Math.min(16, value * 2))}
					>
						+
					</button>
				</div>
			</div>
			<svg
				ref={svgRef}
				className={cn(
					"min-h-0 w-full flex-1 touch-none",
					zoom > 1 && !dragRef.current && "cursor-grab",
				)}
				viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
				preserveAspectRatio="none"
				aria-label={`${kind} graph`}
				onPointerDown={beginPanDrag}
				onPointerMove={onGraphPointerMove}
				onPointerUp={onGraphPointerEnd}
				onPointerCancel={onGraphPointerEnd}
				onLostPointerCapture={onGraphPointerEnd}
			>
				<line
					x1={PAD_X}
					y1={PAD_Y}
					x2={PAD_X}
					y2={HEIGHT - PAD_Y}
					className="stroke-hairline/30"
					vectorEffect="non-scaling-stroke"
				/>
				<line
					x1={PAD_X}
					y1={HEIGHT - PAD_Y}
					x2={WIDTH - PAD_X}
					y2={HEIGHT - PAD_Y}
					className="stroke-hairline/30"
					vectorEffect="non-scaling-stroke"
				/>
				<path
					d={graph.path}
					fill="none"
					className="stroke-accent"
					strokeWidth={2}
					vectorEffect="non-scaling-stroke"
				/>
				{kind === "value" && outHandle && inHandle && nextKeyframe ? (
					<g aria-label="Temporal curve handles">
						<line
							x1={graph.x(selectedKey.frame)}
							y1={graph.y(selectedKeyframe?.value ?? 0)}
							x2={outHandle.x}
							y2={outHandle.y}
							className="stroke-accent/40"
							strokeWidth={1}
							vectorEffect="non-scaling-stroke"
						/>
						<line
							x1={graph.x(nextKeyframe.time)}
							y1={graph.y(nextKeyframe.value)}
							x2={inHandle.x}
							y2={inHandle.y}
							className="stroke-warn/40"
							strokeWidth={1}
							vectorEffect="non-scaling-stroke"
						/>
						<circle
							cx={outHandle.x}
							cy={outHandle.y}
							r={HANDLE_RADIUS}
							className="cursor-move fill-accent"
							onPointerDown={(event) => beginHandleDrag(event, "out")}
						>
							<title>Outgoing temporal handle</title>
						</circle>
						<circle
							cx={inHandle.x}
							cy={inHandle.y}
							r={HANDLE_RADIUS}
							className="cursor-move fill-warn"
							onPointerDown={(event) => beginHandleDrag(event, "in")}
						>
							<title>Incoming temporal handle</title>
						</circle>
					</g>
				) : null}
				{kind === "value"
					? keys
							.filter((key) => key.time >= graph.start && key.time <= graph.end)
							.map((key) => (
								<g key={key.time}>
									<circle
										cx={graph.x(key.time)}
										cy={graph.y(key.value)}
										r={key.time === selectedKey.frame ? 5 : 3}
										className={
											key.time === selectedKey.frame
												? "fill-accent"
												: "fill-fg-muted"
										}
										vectorEffect="non-scaling-stroke"
									/>
									<circle
										cx={graph.x(key.time)}
										cy={graph.y(key.value)}
										r={KEY_HIT_RADIUS}
										fill="transparent"
										className="cursor-move"
										onPointerDown={(event) => beginKeyDrag(event, key)}
									>
										<title>
											{valueDragLocked
												? `Key @ ${key.time} — drag horizontally to retime`
												: `Key @ ${key.time} — drag to retime and revalue`}
										</title>
									</circle>
								</g>
							))
					: null}
				<text x={PAD_X + 4} y={PAD_Y + 10} className="fill-fg-muted text-ui">
					{graph.max.toFixed(2)}
				</text>
				<text
					x={PAD_X + 4}
					y={HEIGHT - PAD_Y - 4}
					className="fill-fg-muted text-ui"
				>
					{graph.min.toFixed(2)}
				</text>
			</svg>
		</section>
	);
}
