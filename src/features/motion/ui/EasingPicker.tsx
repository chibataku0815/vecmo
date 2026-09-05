import { CaretLeft, CaretRight, Trash } from "@phosphor-icons/react";
import {
	type PointerEvent as ReactPointerEvent,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import {
	removeCameraRigKeyframe,
	setCameraRigKeyframeEasing,
	setCameraRigKeyframeEasingCurve,
	setCameraRigKeyframeEasingWithHold,
	setCameraRigKeyframeTime,
} from "@/entities/motion/model/camera-commands";
import {
	removeKeyframe,
	removeSourceOpticsKeyframe,
	removeTextAnimatorOffsetKeyframe,
	setKeyframeEasing,
	setKeyframeEasingCurve,
	setKeyframeEasingWithHold,
	setKeyframeTime,
	setSourceOpticsKeyframeEasing,
	setSourceOpticsKeyframeEasingCurve,
	setSourceOpticsKeyframeEasingWithHold,
	setSourceOpticsKeyframeTime,
	setTextAnimatorOffsetKeyframeEasing,
	setTextAnimatorOffsetKeyframeEasingCurve,
	setTextAnimatorOffsetKeyframeEasingWithHold,
	setTextAnimatorOffsetKeyframeTime,
	splitNumericKeyframeSegment,
} from "@/entities/motion/model/commands";
import {
	compileMotionTimingTemplateForKeyframe,
	type EasingCurve,
	easingCurveInfluenceOf,
	findMotionTimingTemplate,
	type MotionTimingTemplate,
	motionTimingTemplateKeyframeHoldOf,
	motionTimingTemplatesForKeyframeSegment,
	normalizeEasingCurve,
	pointOnEasingCurve,
	sampleMotionTimingTemplatePreview,
	segmentEasingCurveOf,
	segmentTimingTemplateOf,
} from "@/entities/motion/model/easing";
import {
	applyInMotionTransaction,
	beginMotionTransaction,
	commitMotionTransaction,
	type MotionGestureTransaction,
} from "@/entities/motion/model/gesture-transaction";
import { useMotionStore } from "@/entities/motion/model/store";
import { resolveTextAnimatorOffsetKey } from "@/entities/motion/model/text-animator";
import { cn } from "@/shared/lib/cn";
import { useTransportStore } from "../model/transport-store";
import {
	isCameraSelectedKey,
	isNodeSelectedKey,
	isSourceOpticsSelectedKey,
	isTextAnimatorOffsetSelectedKey,
	resolveSelectedKeyInMotion,
	retimedSelectedKeyInMotion,
	snapTimelineFrame,
} from "./timeline-adapter";
import {
	CAMERA_PROPERTY_LABEL,
	PROPERTY_LABEL,
	type SelectedKey,
} from "./timeline-model";

type EasingPickerProps = {
	readonly selectedKey: SelectedKey;
	readonly onClear: () => void;
	readonly onSelectKey: (key: SelectedKey) => void;
};

const CURVE_WIDTH = 132;
const CURVE_HEIGHT = 76;
const CURVE_PADDING = 10;
const CURVE_INNER_WIDTH = CURVE_WIDTH - CURVE_PADDING * 2;
const CURVE_INNER_HEIGHT = CURVE_HEIGHT - CURVE_PADDING * 2;
const CURVE_SAMPLES = 28;
const TEMPLATE_PREVIEW_WIDTH = 58;
const TEMPLATE_PREVIEW_HEIGHT = 18;
const TEMPLATE_PREVIEW_PADDING = 2;

type CurveHandle = "out" | "in";

type CurveDrag = {
	readonly handle: CurveHandle;
	readonly pointerId: number;
	readonly transaction: MotionGestureTransaction;
};

const KEYFRAME_TIMING_TEMPLATES = motionTimingTemplatesForKeyframeSegment();
let copiedTemporalCurve: EasingCurve | null = null;

const clampUnit = (value: number): number => Math.min(1, Math.max(0, value));

const toSvgPoint = (
	x: number,
	y: number,
	yMin = 0,
	yMax = 1,
): { readonly x: number; readonly y: number } => ({
	x: CURVE_PADDING + x * CURVE_INNER_WIDTH,
	y:
		CURVE_PADDING +
		(1 - (y - yMin) / Math.max(0.000001, yMax - yMin)) * CURVE_INNER_HEIGHT,
});

const curvePath = (curve: EasingCurve, yMin: number, yMax: number): string =>
	Array.from({ length: CURVE_SAMPLES }, (_, index) => {
		const point = pointOnEasingCurve(curve, index / (CURVE_SAMPLES - 1));
		const svgPoint = toSvgPoint(point.x, point.y, yMin, yMax);
		const command = index === 0 ? "M" : "L";
		return `${command} ${svgPoint.x.toFixed(2)} ${svgPoint.y.toFixed(2)}`;
	}).join(" ");

const rangeValue = (value: number): string => Math.round(value).toString();

const templatePreviewPath = (template: MotionTimingTemplate): string => {
	const points = sampleMotionTimingTemplatePreview(template.id);
	if (points.length === 0) return "";
	const innerWidth = TEMPLATE_PREVIEW_WIDTH - TEMPLATE_PREVIEW_PADDING * 2;
	const innerHeight = TEMPLATE_PREVIEW_HEIGHT - TEMPLATE_PREVIEW_PADDING * 2;
	return points
		.map((point, index) => {
			const x = TEMPLATE_PREVIEW_PADDING + point.x * innerWidth;
			const y = TEMPLATE_PREVIEW_PADDING + (1 - point.y) * innerHeight;
			return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
		})
		.join(" ");
};

function TimingTemplatePreview({
	template,
}: {
	readonly template: MotionTimingTemplate;
}) {
	return (
		<svg
			viewBox={`0 0 ${TEMPLATE_PREVIEW_WIDTH} ${TEMPLATE_PREVIEW_HEIGHT}`}
			aria-hidden="true"
			className="h-[18px] w-[58px] shrink-0"
		>
			<path
				d={`M ${TEMPLATE_PREVIEW_PADDING} ${TEMPLATE_PREVIEW_HEIGHT - TEMPLATE_PREVIEW_PADDING} H ${TEMPLATE_PREVIEW_WIDTH - TEMPLATE_PREVIEW_PADDING}`}
				fill="none"
				className="stroke-hairline/25"
				strokeWidth="1"
			/>
			<path
				d={templatePreviewPath(template)}
				fill="none"
				className="stroke-accent"
				strokeLinecap="round"
				strokeWidth="1.5"
			/>
		</svg>
	);
}

/**
 * Editor for the selected keyframe: it applies semantic timing templates or
 * edits the custom sampler-compatible cubic curve of the segment leaving the key.
 * Easing reflects the live segment so it stays correct after retiming.
 */
export function EasingPicker({
	selectedKey,
	onClear,
	onSelectKey,
}: EasingPickerProps) {
	const svgRef = useRef<SVGSVGElement>(null);
	const draggingHandleRef = useRef<CurveDrag | null>(null);
	const [frameDraft, setFrameDraft] = useState(String(selectedKey.frame));
	const [copiedCurve, setCopiedCurve] = useState<EasingCurve | null>(
		copiedTemporalCurve,
	);
	const motion = useMotionStore((state) => state.document);
	const currentFrame = useTransportStore((state) => state.currentFrame);
	const resolvedSelectedKey = resolveSelectedKeyInMotion(motion, selectedKey);
	const resolvedTextAnimatorKey =
		resolvedSelectedKey && isTextAnimatorOffsetSelectedKey(resolvedSelectedKey)
			? resolveTextAnimatorOffsetKey(motion, resolvedSelectedKey)
			: null;
	const track =
		resolvedSelectedKey && !isTextAnimatorOffsetSelectedKey(resolvedSelectedKey)
			? isCameraSelectedKey(resolvedSelectedKey)
				? motion.cameraTracks?.find(
						(item) => item.id === resolvedSelectedKey.trackId,
					)
				: isSourceOpticsSelectedKey(resolvedSelectedKey)
					? motion.sourceOpticsTracks?.find(
							(item) => item.id === resolvedSelectedKey.trackId,
						)
					: motion.tracks.find(
							(item) => item.id === resolvedSelectedKey.trackId,
						)
			: undefined;
	const keyframes = resolvedTextAnimatorKey
		? (resolvedTextAnimatorKey.selector.offsetKeyframes ?? [])
		: track?.keyframes;
	const index =
		keyframes?.findIndex((item) => item.time === resolvedSelectedKey?.frame) ??
		-1;
	const keyframe = index >= 0 ? keyframes?.[index] : undefined;
	const resolvedFrame = resolvedSelectedKey?.frame;
	useLayoutEffect(() => {
		if (!resolvedSelectedKey || !keyframes || !keyframe) onClear();
	}, [keyframes, keyframe, onClear, resolvedSelectedKey]);
	useEffect(() => {
		if (resolvedFrame !== undefined) setFrameDraft(String(resolvedFrame));
	}, [resolvedFrame]);
	useEffect(
		() => () => {
			const drag = draggingHandleRef.current;
			if (!drag) return;
			commitMotionTransaction(drag.transaction);
			draggingHandleRef.current = null;
		},
		[],
	);
	if (!resolvedSelectedKey || !keyframes || !keyframe) return null;

	const next = keyframes[index + 1];
	const previous = keyframes[index - 1];
	const current = segmentTimingTemplateOf(keyframe, next);
	const curve = segmentEasingCurveOf(keyframe, next);
	const curveSamples = Array.from({ length: CURVE_SAMPLES }, (_, sampleIndex) =>
		pointOnEasingCurve(curve, sampleIndex / (CURVE_SAMPLES - 1)),
	);
	const rawCurveMin = Math.min(0, ...curveSamples.map((point) => point.y));
	const rawCurveMax = Math.max(1, ...curveSamples.map((point) => point.y));
	const curveRangePadding = Math.max(0.08, (rawCurveMax - rawCurveMin) * 0.08);
	const curveYMin = rawCurveMin - curveRangePadding;
	const curveYMax = rawCurveMax + curveRangePadding;
	const influence = easingCurveInfluenceOf(curve);
	const isLastKey = next === undefined;
	const currentTemplate =
		current === "custom" ? undefined : findMotionTimingTemplate(current);
	const currentLabel =
		current === "custom" ? "Custom" : (currentTemplate?.uiLabel ?? "Custom");
	const startPoint = toSvgPoint(0, 0, curveYMin, curveYMax);
	const endPoint = toSvgPoint(1, 1, curveYMin, curveYMax);
	const outPoint = toSvgPoint(curve.x1, curve.y1, curveYMin, curveYMax);
	const inPoint = toSvgPoint(curve.x2, curve.y2, curveYMin, curveYMax);
	const minFrame = 0;
	const maxFrame = snapTimelineFrame(
		motion.durationFrames,
		motion.durationFrames,
	);

	const applyCurve = (
		nextCurve: EasingCurve,
		transaction?: MotionGestureTransaction,
	): void => {
		if (isLastKey) return;
		const normalized = normalizeEasingCurve(nextCurve);
		const command = isTextAnimatorOffsetSelectedKey(resolvedSelectedKey)
			? setTextAnimatorOffsetKeyframeEasingCurve(
					resolvedSelectedKey,
					normalized,
				)
			: isCameraSelectedKey(resolvedSelectedKey)
				? setCameraRigKeyframeEasingCurve(
						resolvedSelectedKey.trackId,
						resolvedSelectedKey.frame,
						normalized,
					)
				: isSourceOpticsSelectedKey(resolvedSelectedKey)
					? setSourceOpticsKeyframeEasingCurve(
							resolvedSelectedKey.trackId,
							resolvedSelectedKey.frame,
							normalized,
						)
					: setKeyframeEasingCurve(
							resolvedSelectedKey.trackId,
							resolvedSelectedKey.frame,
							normalized,
						);
		if (transaction) {
			applyInMotionTransaction(transaction, command);
			return;
		}
		useMotionStore.getState().apply(command);
	};

	const updateCurveHandle = (
		handle: CurveHandle,
		x: number,
		y: number,
	): void => {
		const clampedX = clampUnit(x);
		applyCurve(
			handle === "out"
				? normalizeEasingCurve({ ...curve, x1: clampedX, y1: y })
				: normalizeEasingCurve({ ...curve, x2: clampedX, y2: y }),
			draggingHandleRef.current?.transaction,
		);
	};

	const curvePointFromClient = (
		clientX: number,
		clientY: number,
	): { readonly x: number; readonly y: number } => {
		const rect = svgRef.current?.getBoundingClientRect();
		if (!rect || rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
		const svgX = ((clientX - rect.left) / rect.width) * CURVE_WIDTH;
		const svgY = ((clientY - rect.top) / rect.height) * CURVE_HEIGHT;
		return {
			x: clampUnit((svgX - CURVE_PADDING) / CURVE_INNER_WIDTH),
			y:
				curveYMin +
				(1 - (svgY - CURVE_PADDING) / CURVE_INNER_HEIGHT) *
					(curveYMax - curveYMin),
		};
	};

	const beginCurveDrag = (
		event: ReactPointerEvent<SVGCircleElement>,
		handle: CurveHandle,
	): void => {
		if (isLastKey) return;
		event.preventDefault();
		event.stopPropagation();
		draggingHandleRef.current = {
			handle,
			pointerId: event.pointerId,
			transaction: beginMotionTransaction(
				"easing-curve-handle-drag",
				"Adjust temporal curve",
			),
		};
		svgRef.current?.setPointerCapture(event.pointerId);
		const point = curvePointFromClient(event.clientX, event.clientY);
		updateCurveHandle(handle, point.x, point.y);
	};

	const continueCurveDrag = (event: ReactPointerEvent<SVGSVGElement>): void => {
		const drag = draggingHandleRef.current;
		if (!drag || event.pointerId !== drag.pointerId) return;
		event.preventDefault();
		const point = curvePointFromClient(event.clientX, event.clientY);
		updateCurveHandle(drag.handle, point.x, point.y);
	};

	const endCurveDrag = (event: ReactPointerEvent<SVGSVGElement>): void => {
		const drag = draggingHandleRef.current;
		if (!drag || event.pointerId !== drag.pointerId) return;
		commitMotionTransaction(drag.transaction);
		draggingHandleRef.current = null;
		if (svgRef.current?.hasPointerCapture(event.pointerId)) {
			svgRef.current.releasePointerCapture(event.pointerId);
		}
	};

	const commitFrameValue = (value: number): void => {
		if (!Number.isFinite(value)) {
			setFrameDraft(String(resolvedSelectedKey.frame));
			return;
		}
		const targetFrame = snapTimelineFrame(value, motion.durationFrames);
		if (targetFrame === resolvedSelectedKey.frame) {
			setFrameDraft(String(resolvedSelectedKey.frame));
			return;
		}
		useMotionStore
			.getState()
			.apply(
				isTextAnimatorOffsetSelectedKey(resolvedSelectedKey)
					? setTextAnimatorOffsetKeyframeTime(
							resolvedSelectedKey,
							targetFrame,
							`motion-text-animator-keyframe-frame:${resolvedSelectedKey.bindingId}:${resolvedSelectedKey.selectorIndex}`,
						)
					: isCameraSelectedKey(resolvedSelectedKey)
						? setCameraRigKeyframeTime(
								resolvedSelectedKey.trackId,
								resolvedSelectedKey.frame,
								targetFrame,
								`motion-camera-keyframe-frame:${resolvedSelectedKey.trackId}`,
							)
						: isSourceOpticsSelectedKey(resolvedSelectedKey)
							? setSourceOpticsKeyframeTime(
									resolvedSelectedKey.trackId,
									resolvedSelectedKey.frame,
									targetFrame,
									`motion-source-optics-keyframe-frame:${resolvedSelectedKey.trackId}`,
								)
							: setKeyframeTime(
									resolvedSelectedKey.trackId,
									resolvedSelectedKey.frame,
									targetFrame,
									`motion-keyframe-frame:${resolvedSelectedKey.trackId}`,
								),
			);
		const retimed = retimedSelectedKeyInMotion(
			useMotionStore.getState().document,
			resolvedSelectedKey,
			targetFrame,
		);
		if (!retimed) {
			setFrameDraft(String(resolvedSelectedKey.frame));
			return;
		}
		onSelectKey(retimed);
		setFrameDraft(String(retimed.frame));
	};

	const commitFrameDraft = (): void => {
		commitFrameValue(Number(frameDraft));
	};

	const nudgeFrame = (deltaFrames: number): void => {
		commitFrameValue(resolvedSelectedKey.frame + deltaFrames);
	};

	const applyTemplate = (template: MotionTimingTemplate): void => {
		if (isLastKey) return;
		const compiled = compileMotionTimingTemplateForKeyframe(template.id);
		if (compiled.status !== "ready") return;
		const cameraSelected = isCameraSelectedKey(resolvedSelectedKey);
		const sourceOpticsSelected = isSourceOpticsSelectedKey(resolvedSelectedKey);
		const textAnimatorSelected =
			isTextAnimatorOffsetSelectedKey(resolvedSelectedKey);
		const easingCommand = textAnimatorSelected
			? compiled.easing.kind === "preset"
				? setTextAnimatorOffsetKeyframeEasing(
						resolvedSelectedKey,
						compiled.easing.preset,
					)
				: setTextAnimatorOffsetKeyframeEasingCurve(
						resolvedSelectedKey,
						compiled.easing.curve,
					)
			: cameraSelected
				? compiled.easing.kind === "preset"
					? setCameraRigKeyframeEasing(
							resolvedSelectedKey.trackId,
							resolvedSelectedKey.frame,
							compiled.easing.preset,
						)
					: setCameraRigKeyframeEasingCurve(
							resolvedSelectedKey.trackId,
							resolvedSelectedKey.frame,
							compiled.easing.curve,
						)
				: sourceOpticsSelected
					? compiled.easing.kind === "preset"
						? setSourceOpticsKeyframeEasing(
								resolvedSelectedKey.trackId,
								resolvedSelectedKey.frame,
								compiled.easing.preset,
							)
						: setSourceOpticsKeyframeEasingCurve(
								resolvedSelectedKey.trackId,
								resolvedSelectedKey.frame,
								compiled.easing.curve,
							)
					: compiled.easing.kind === "preset"
						? setKeyframeEasing(
								resolvedSelectedKey.trackId,
								resolvedSelectedKey.frame,
								compiled.easing.preset,
							)
						: setKeyframeEasingCurve(
								resolvedSelectedKey.trackId,
								resolvedSelectedKey.frame,
								compiled.easing.curve,
							);
		const motionStore = useMotionStore.getState();
		const hold = motionTimingTemplateKeyframeHoldOf(template.id);
		if (hold) {
			motionStore.apply(
				textAnimatorSelected
					? setTextAnimatorOffsetKeyframeEasingWithHold(
							resolvedSelectedKey,
							compiled.easing,
							hold,
						)
					: cameraSelected
						? setCameraRigKeyframeEasingWithHold(
								resolvedSelectedKey.trackId,
								resolvedSelectedKey.frame,
								compiled.easing,
								hold,
							)
						: sourceOpticsSelected
							? setSourceOpticsKeyframeEasingWithHold(
									resolvedSelectedKey.trackId,
									resolvedSelectedKey.frame,
									compiled.easing,
									hold,
								)
							: setKeyframeEasingWithHold(
									resolvedSelectedKey.trackId,
									resolvedSelectedKey.frame,
									compiled.easing,
									hold,
								),
			);
			return;
		}
		motionStore.apply(easingCommand);
	};
	const removeSelectedKey = (selectPrevious: boolean): void => {
		useMotionStore
			.getState()
			.apply(
				isTextAnimatorOffsetSelectedKey(resolvedSelectedKey)
					? removeTextAnimatorOffsetKeyframe(resolvedSelectedKey)
					: isCameraSelectedKey(resolvedSelectedKey)
						? removeCameraRigKeyframe(
								resolvedSelectedKey.cameraRigId,
								resolvedSelectedKey.property,
								resolvedSelectedKey.frame,
							)
						: isSourceOpticsSelectedKey(resolvedSelectedKey)
							? removeSourceOpticsKeyframe(
									resolvedSelectedKey.target,
									resolvedSelectedKey.frame,
								)
							: removeKeyframe(
									resolvedSelectedKey.trackId,
									resolvedSelectedKey.frame,
								),
			);
		if (selectPrevious && previous) {
			onSelectKey({ ...resolvedSelectedKey, frame: previous.time });
			return;
		}
		onClear();
	};
	const splitFrame = snapTimelineFrame(currentFrame, motion.durationFrames);
	const hasDirectSpatialPath =
		isNodeSelectedKey(resolvedSelectedKey) &&
		(resolvedSelectedKey.property === "x" ||
			resolvedSelectedKey.property === "y") &&
		motion.positionPaths?.some(
			(path) => path.nodeId === resolvedSelectedKey.nodeId,
		);
	const canSplit =
		isNodeSelectedKey(resolvedSelectedKey) &&
		typeof keyframe.value === "number" &&
		next !== undefined &&
		splitFrame > resolvedSelectedKey.frame &&
		splitFrame < next.time &&
		!hasDirectSpatialPath;
	const canJoin =
		typeof keyframe.value === "number" &&
		previous !== undefined &&
		next !== undefined;

	return (
		<div className="border-white/10 border-t px-3 py-2">
			<div className="flex flex-wrap items-center gap-2">
				<span className="shrink-0 text-fg-subtle text-ui">
					{isTextAnimatorOffsetSelectedKey(resolvedSelectedKey)
						? `Offset · Selector ${resolvedSelectedKey.selectorIndex + 1}`
						: isCameraSelectedKey(resolvedSelectedKey)
							? CAMERA_PROPERTY_LABEL[resolvedSelectedKey.property]
							: isSourceOpticsSelectedKey(resolvedSelectedKey)
								? resolvedSelectedKey.property
								: isNodeSelectedKey(resolvedSelectedKey)
									? PROPERTY_LABEL[resolvedSelectedKey.property]
									: "Key"}{" "}
					@ frame {resolvedSelectedKey.frame}
				</span>
				<span
					className={cn(
						"rounded-sm border px-1.5 py-0.5 text-ui",
						current === "custom"
							? "border-warn/30 bg-warn/10 text-warn-fg"
							: "border-white/10 bg-white/[0.035] text-fg-muted",
					)}
				>
					{isLastKey ? "No segment" : currentLabel}
				</span>
				<div className="flex items-center gap-1">
					<button
						type="button"
						aria-label="Move keyframe one frame earlier"
						title="Move keyframe one frame earlier"
						disabled={resolvedSelectedKey.frame <= minFrame}
						onClick={() => nudgeFrame(-1)}
						className={cn(
							"grid size-7 shrink-0 place-items-center rounded-md border border-white/10 bg-white/[0.035] text-fg-secondary transition hover:border-accent/50 hover:text-accent-fg",
							resolvedSelectedKey.frame <= minFrame &&
								"cursor-not-allowed opacity-40 hover:border-white/10 hover:text-fg-secondary",
						)}
					>
						<CaretLeft aria-hidden="true" size={12} />
					</button>
					<label className="flex h-7 items-center gap-1 rounded-md border border-white/10 bg-white/[0.035] px-1.5 text-fg-muted text-ui">
						<span>Frame</span>
						<input
							type="number"
							min={minFrame}
							max={maxFrame}
							step={1}
							value={frameDraft}
							onChange={(event) => setFrameDraft(event.currentTarget.value)}
							onBlur={commitFrameDraft}
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									commitFrameDraft();
									event.currentTarget.blur();
									event.stopPropagation();
								}
								if (event.key === "Escape") {
									setFrameDraft(String(resolvedSelectedKey.frame));
									event.currentTarget.blur();
									event.stopPropagation();
								}
							}}
							className="h-5 w-12 rounded border border-white/10 bg-surface-sunken px-1 font-mono text-fg text-ui tabular-nums outline-none focus:border-accent/70"
						/>
					</label>
					<button
						type="button"
						aria-label="Move keyframe one frame later"
						title="Move keyframe one frame later"
						disabled={resolvedSelectedKey.frame >= maxFrame}
						onClick={() => nudgeFrame(1)}
						className={cn(
							"grid size-7 shrink-0 place-items-center rounded-md border border-white/10 bg-white/[0.035] text-fg-secondary transition hover:border-accent/50 hover:text-accent-fg",
							resolvedSelectedKey.frame >= maxFrame &&
								"cursor-not-allowed opacity-40 hover:border-white/10 hover:text-fg-secondary",
						)}
					>
						<CaretRight aria-hidden="true" size={12} />
					</button>
				</div>
				<div className="flex flex-wrap items-center gap-1">
					{KEYFRAME_TIMING_TEMPLATES.map((template) => (
						<button
							key={template.id}
							type="button"
							disabled={isLastKey}
							aria-label={`Apply ${template.uiLabel} timing`}
							title={`${template.uiLabel}: ${template.intent}`}
							onClick={() => applyTemplate(template)}
							className={cn(
								"flex h-10 min-w-[96px] items-center gap-1.5 rounded-md border px-1.5 py-1 text-left text-ui transition",
								current === template.id
									? "border-accent bg-accent-surface text-accent-fg"
									: "border-white/10 bg-white/[0.035] text-fg-secondary hover:border-white/20 hover:text-white",
								isLastKey && "cursor-not-allowed opacity-40",
							)}
						>
							<TimingTemplatePreview template={template} />
							<span className="min-w-0 truncate">{template.uiLabel}</span>
						</button>
					))}
				</div>
				<div className="flex items-center gap-1">
					<button
						type="button"
						disabled={isLastKey}
						onClick={() => {
							copiedTemporalCurve = curve;
							setCopiedCurve(curve);
						}}
						className="h-7 rounded-md border border-white/10 bg-white/[0.035] px-2 text-fg-secondary text-ui disabled:opacity-40"
					>
						Copy curve
					</button>
					<button
						type="button"
						disabled={isLastKey || !copiedCurve}
						onClick={() => copiedCurve && applyCurve(copiedCurve)}
						className="h-7 rounded-md border border-white/10 bg-white/[0.035] px-2 text-fg-secondary text-ui disabled:opacity-40"
					>
						Paste curve
					</button>
					<button
						type="button"
						disabled={!canSplit}
						title={
							hasDirectSpatialPath
								? "Split direct spatial keys from the motion-path owner"
								: `Split at frame ${splitFrame}`
						}
						onClick={() => {
							if (!isNodeSelectedKey(resolvedSelectedKey)) return;
							useMotionStore
								.getState()
								.apply(
									splitNumericKeyframeSegment(
										resolvedSelectedKey.trackId,
										splitFrame,
									),
								);
							onSelectKey({ ...resolvedSelectedKey, frame: splitFrame });
						}}
						className="h-7 rounded-md border border-white/10 bg-white/[0.035] px-2 text-fg-secondary text-ui disabled:opacity-40"
					>
						Split
					</button>
					<button
						type="button"
						disabled={!canJoin}
						onClick={() => removeSelectedKey(true)}
						className="h-7 rounded-md border border-white/10 bg-white/[0.035] px-2 text-fg-secondary text-ui disabled:opacity-40"
					>
						Join
					</button>
				</div>
				<button
					type="button"
					aria-label="Delete keyframe"
					title="Delete keyframe"
					onClick={() => removeSelectedKey(false)}
					className="ml-auto grid size-7 shrink-0 place-items-center rounded-md border border-white/10 bg-white/[0.035] text-fg-secondary transition hover:border-danger/50 hover:text-danger-fg"
				>
					<Trash aria-hidden="true" size={14} />
				</button>
			</div>
			<div
				className={cn(
					"mt-2 flex flex-wrap items-center gap-3",
					isLastKey && "opacity-45",
				)}
			>
				<svg
					ref={svgRef}
					viewBox={`0 0 ${CURVE_WIDTH} ${CURVE_HEIGHT}`}
					role="img"
					aria-label="Easing curve"
					className={cn(
						"h-[76px] w-[132px] shrink-0 rounded-md border border-white/10 bg-surface-sunken",
						!isLastKey && "touch-none",
					)}
					onPointerMove={continueCurveDrag}
					onPointerUp={endCurveDrag}
					onPointerCancel={endCurveDrag}
					onLostPointerCapture={endCurveDrag}
				>
					<path
						d={`M ${startPoint.x} ${startPoint.y} H ${endPoint.x} M ${startPoint.x} ${startPoint.y} V ${endPoint.y}`}
						fill="none"
						className="stroke-hairline/20"
						strokeWidth="1"
					/>
					<line
						x1={startPoint.x}
						y1={startPoint.y}
						x2={outPoint.x}
						y2={outPoint.y}
						className="stroke-accent/40"
						strokeWidth="1"
					/>
					<line
						x1={endPoint.x}
						y1={endPoint.y}
						x2={inPoint.x}
						y2={inPoint.y}
						className="stroke-warn/40"
						strokeWidth="1"
					/>
					<path
						d={curvePath(curve, curveYMin, curveYMax)}
						fill="none"
						className="stroke-accent"
						strokeLinecap="round"
						strokeWidth="2"
					/>
					<circle
						cx={startPoint.x}
						cy={startPoint.y}
						r="2.5"
						className="fill-fg-subtle"
					/>
					<circle
						cx={endPoint.x}
						cy={endPoint.y}
						r="2.5"
						className="fill-fg-subtle"
					/>
					<circle
						cx={outPoint.x}
						cy={outPoint.y}
						r="5"
						className={cn("fill-accent", !isLastKey && "cursor-move")}
						onPointerDown={(event) => beginCurveDrag(event, "out")}
					/>
					<circle
						cx={inPoint.x}
						cy={inPoint.y}
						r="5"
						className={cn("fill-warn", !isLastKey && "cursor-move")}
						onPointerDown={(event) => beginCurveDrag(event, "in")}
					/>
				</svg>
				<div className="grid min-w-[220px] flex-1 grid-cols-2 gap-3">
					{(
						[
							["X1", curve.x1, "x1"],
							["Y1", curve.y1, "y1"],
							["X2", curve.x2, "x2"],
							["Y2", curve.y2, "y2"],
						] as const
					).map(([label, value, key]) => (
						<label
							key={key}
							className="flex items-center gap-1 text-fg-muted text-ui"
						>
							<span>{label}</span>
							<input
								type="number"
								step="0.01"
								disabled={isLastKey}
								value={Number(value.toFixed(3))}
								onChange={(event) =>
									applyCurve(
										normalizeEasingCurve({
											...curve,
											[key]: Number(event.currentTarget.value),
										}),
									)
								}
								className="h-6 min-w-0 flex-1 rounded border border-white/10 bg-surface-sunken px-1 font-mono text-fg text-ui tabular-nums outline-none focus:border-accent/70"
							/>
						</label>
					))}
					<label className="min-w-0 text-fg-muted text-ui">
						<span className="mb-1 flex items-center justify-between gap-2">
							<span>Start</span>
							<span className="font-mono tabular-nums">
								{rangeValue(influence.outInfluence)}
							</span>
						</span>
						<input
							type="range"
							min={0}
							max={100}
							step={1}
							disabled={isLastKey}
							value={rangeValue(influence.outInfluence)}
							onChange={(event) =>
								applyCurve(
									normalizeEasingCurve({
										...curve,
										x1: Number(event.currentTarget.value) / 100,
									}),
								)
							}
							className="h-1 w-full accent-accent"
						/>
					</label>
					<label className="min-w-0 text-fg-muted text-ui">
						<span className="mb-1 flex items-center justify-between gap-2">
							<span>End</span>
							<span className="font-mono tabular-nums">
								{rangeValue(influence.inInfluence)}
							</span>
						</span>
						<input
							type="range"
							min={0}
							max={100}
							step={1}
							disabled={isLastKey}
							value={rangeValue(influence.inInfluence)}
							onChange={(event) =>
								applyCurve(
									normalizeEasingCurve({
										...curve,
										x2: 1 - Number(event.currentTarget.value) / 100,
									}),
								)
							}
							className="h-1 w-full accent-warn"
						/>
					</label>
				</div>
			</div>
		</div>
	);
}
