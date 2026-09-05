import {
	collectGridIntersectionsNear,
	collectGridLineCandidatesNear,
	collectGuideCandidates,
	type GuideCandidate,
	type GuideLine,
	type GuideSnapResult,
	snapPointToGuides,
	visibleGridSpacing,
} from "@/entities/guides/model/snapping";
import { useGuideStore } from "@/entities/guides/model/store";
import { createNode } from "@/entities/scene/model/factory";
import type { NodeStyle, SceneDocument } from "@/entities/scene/model/types";
import { collectVertexAnchors } from "@/entities/scene/model/vertex-snap";
import { modifierStateFromEvent } from "@/shared/lib/modifiers";
import { snapToNearestPoint } from "@/shared/lib/snapping";
import { useStrokeIntentStore } from "@/shared/stroke/intent-store";
import {
	buildPencilStrokeIntent,
	type PencilIntentSample,
} from "@/shared/stroke/pencil-intent";
import { addNode } from "../model/command";
import { useDrawStore } from "../model/draw-store";
import type { FreehandPoint } from "../model/freehand";
import { commitFreehandStroke } from "../model/freehand-commit";
import {
	cornerAnchor,
	distance,
	isCloseTarget,
	type PenAnchor,
	penAnchorsToShape,
	smoothAnchor,
} from "../model/pen";
import {
	type DragModifiers,
	type ShapeKind,
	shapeGeometryFromDrag,
	shapeGeometryMeetsMinimum,
} from "../model/shape";

// Local structural mirror of the canvas registry surface. Features cannot
// import the widget-layer registry types (the arch gate bans upward imports),
// so the handlers are typed against this subset; the host passes a compatible
// superset of `HandlerApi`.
type LocalToolId =
	| "select"
	| "direct-select"
	| "pen"
	| "pencil"
	| "shape"
	| "type"
	| "motion-path"
	| "effect";

type CanvasPoint = {
	readonly x: number;
	readonly y: number;
};

type PointerContext = {
	readonly point: CanvasPoint;
	readonly hitNodeId: string | null;
	readonly event: PointerEvent;
};

type HostApi = {
	readonly getDoc: () => SceneDocument;
	readonly viewport: { readonly zoom: number };
	readonly select: (nodeId: string, additive?: boolean) => void;
	readonly setActiveTool: (tool: LocalToolId) => void;
	readonly allowTouchFreehand?: boolean;
};

type DrawToolHandler = {
	readonly id: string;
	readonly tool: LocalToolId;
	readonly onPointerDown: (context: PointerContext, api: HostApi) => void;
	readonly onPointerMove: (context: PointerContext, api: HostApi) => void;
	readonly onPointerUp: (context: PointerContext, api: HostApi) => void;
	readonly onKeyDown?: (event: KeyboardEvent, api: HostApi) => void;
	readonly onDeactivate?: (api: HostApi) => void;
};

const PERCENT = 100;
const CLOSE_TOLERANCE_PX = 12;
const DRAG_THRESHOLD_PX = 3;
const MIN_SHAPE_SIZE_PX = 4;
const SNAP_THRESHOLD_PX = 6;
// Pencil capture/smoothing budgets in screen pixels (converted to artboard-local
// units through the current zoom so the feel is constant on screen).
const FREEHAND_SAMPLE_PX = 2;
const PEN_STYLE: Partial<NodeStyle> = {
	fill: "none",
	stroke: "#191817",
	strokeWidth: 4,
};
const LINE_STYLE: Partial<NodeStyle> = {
	fill: "none",
	stroke: "#191817",
	strokeWidth: 2,
};

const screenScale = (api: HostApi): number =>
	Math.max(api.viewport.zoom / PERCENT, 0.001);

const artboardOrigin = (api: HostApi): CanvasPoint => ({
	x: api.getDoc().artboard.position?.x ?? 0,
	y: api.getDoc().artboard.position?.y ?? 0,
});

const clearActiveGuideSnap = (): void => {
	useGuideStore.getState().clearActiveSnap();
};

// Snap-to-point candidates are a pure function of the document, but `snapDrawPoint`
// runs on every pointermove (pen hover, shape drag), so a naive call would walk the
// whole scene per event. The document is an immutable Zustand ref that only changes
// on a mutation, so a single-entry memo keyed on that ref keeps an in-flight gesture
// at one walk while staying correct the instant the scene changes.
let vertexAnchorCache: {
	readonly doc: SceneDocument;
	readonly anchors: ReturnType<typeof collectVertexAnchors>;
} | null = null;

const drawVertexAnchors = (doc: SceneDocument) => {
	if (vertexAnchorCache?.doc === doc) return vertexAnchorCache.anchors;
	const anchors = collectVertexAnchors(doc);
	vertexAnchorCache = { doc, anchors };
	return anchors;
};

// Object/artboard/guide-line candidates (`collectGuideCandidates`) are a pure
// function of the document plus guide-line visibility/content; per its own doc
// comment the result is "safe to cache for a drag gesture" since it only holds
// primitives. `snapDrawPoint` runs on every pointermove during a shape/pen/pencil
// drag, so — mirroring `vertexAnchorCache` above — a single-entry memo keyed on
// the document reference, the guide-line array reference, and the visibility
// flag keeps an in-flight gesture at one candidate walk instead of one per move.
// `guideLines` is a separate Zustand store from the scene document, so its
// identity (not just the document's) must gate the cache — otherwise editing
// guide lines between two gestures on the same document would replay stale
// candidates from the first gesture.
let guideCandidateCache: {
	readonly doc: SceneDocument;
	readonly guideLinesVisible: boolean;
	readonly guideLines: readonly GuideLine[];
	readonly candidates: readonly GuideCandidate[];
} | null = null;

const drawGuideCandidates = (
	doc: SceneDocument,
	guideLinesVisible: boolean,
	guideLines: readonly GuideLine[],
): readonly GuideCandidate[] => {
	if (
		guideCandidateCache?.doc === doc &&
		guideCandidateCache.guideLinesVisible === guideLinesVisible &&
		guideCandidateCache.guideLines === guideLines
	) {
		return guideCandidateCache.candidates;
	}
	const candidates = collectGuideCandidates(doc, {
		includeGrid: false,
		guideLines: guideLinesVisible ? guideLines : [],
	});
	guideCandidateCache = { doc, guideLinesVisible, guideLines, candidates };
	return candidates;
};

/**
 * The finest VISIBLE grid spacing (so drawing snaps to what is drawn), or null when
 * the grid is hidden. Draw points are artboard-local, so the lattice phase is 0.
 */
const drawGridSpacing = (api: HostApi): number | null =>
	useGuideStore.getState().view.gridVisible
		? visibleGridSpacing(screenScale(api))
		: null;

/**
 * Resolves draw points through the shared guide model while keeping committed
 * geometry artboard-local. The overlay receives the artboard origin separately,
 * so indicators remain correctly projected for offset artboards.
 */
const snapDrawPoint = (
	point: CanvasPoint,
	api: HostApi,
	options: { readonly isDragging?: boolean } = {},
): CanvasPoint => {
	const guideStore = useGuideStore.getState();
	// Snap to Point wins over edge alignment: drop the drawn point exactly onto an
	// existing anchor (e.g. start a new path on another path's vertex).
	if (guideStore.snap.snapToPoint) {
		const gridSpacing = drawGridSpacing(api);
		const vertices = drawVertexAnchors(api.getDoc());
		// Vertices first so a real anchor wins a same-place tie with a grid crossing.
		const points =
			gridSpacing === null
				? vertices
				: [...vertices, ...collectGridIntersectionsNear(point, gridSpacing)];
		const lock = snapToNearestPoint(point, points, {
			enabled: true,
			thresholdPx: SNAP_THRESHOLD_PX,
			projection: { zoom: screenScale(api), pan: { x: 0, y: 0 } },
		});
		if (lock.snapped) {
			const lockResult: GuideSnapResult = {
				point: lock.point,
				adjustedPoint: lock.point,
				delta: { x: lock.point.x - point.x, y: lock.point.y - point.y },
				snapped: true,
				matches: [],
				guides: [],
				measurements: [],
				indicator: lock.indicator,
			};
			useGuideStore.getState().setActiveSnap(lockResult, {
				isDragging: options.isDragging ?? false,
				origin: artboardOrigin(api),
			});
			return lock.point;
		}
	}
	// Snapping is gated on the Smart Guides behavior toggle, decoupled from
	// grid/guide-line visibility; grid and guide-line candidates still respect
	// their own visibility.
	const snappingEnabled = guideStore.snap.smartGuides;
	const guideGridSpacing = drawGridSpacing(api);
	const candidates = snappingEnabled
		? [
				...drawGuideCandidates(
					api.getDoc(),
					guideStore.view.guideLinesVisible,
					guideStore.guideLines,
				),
				...(guideGridSpacing === null
					? []
					: collectGridLineCandidatesNear(
							api.getDoc(),
							guideGridSpacing,
							[point.x],
							[point.y],
						)),
			]
		: [];
	const result = snapPointToGuides(point, {
		enabled: snappingEnabled,
		threshold: 0,
		thresholdPx: SNAP_THRESHOLD_PX,
		projection: {
			zoom: screenScale(api),
			pan: { x: 0, y: 0 },
		},
		showMeasurements: options.isDragging ?? false,
		candidates,
	});

	if (!result.snapped) {
		clearActiveGuideSnap();
		return point;
	}

	useGuideStore.getState().setActiveSnap(result, {
		isDragging: options.isDragging ?? false,
		origin: artboardOrigin(api),
	});
	return result.adjustedPoint;
};

const dragModifiers = (event: PointerEvent): DragModifiers => {
	const modifiers = modifierStateFromEvent(event);
	return {
		constrain: modifiers.constrain,
		fromCenter: modifiers.fromCenter,
	};
};

/** Commits the accumulated pen path, selects it, and returns to the select tool. */
const commitPen = (
	anchors: readonly PenAnchor[],
	closed: boolean,
	api: HostApi,
): void => {
	const store = useDrawStore.getState();
	if (anchors.length < 2) {
		store.resetPen();
		return;
	}
	const node = createNode(
		"path",
		{ kind: "path", shape: penAnchorsToShape(anchors, closed) },
		{ name: "pen path", style: PEN_STYLE },
	);
	const inserted = addNode(node);
	store.resetPen();
	if (!inserted) return;
	api.select(node.id);
	api.setActiveTool("select");
};

// Press point of the pen anchor currently being placed; tracks whether the
// press has crossed the drag threshold into a smooth-handle drag.
let penDown: { readonly start: CanvasPoint; dragging: boolean } | null = null;

const onPenDown = (context: PointerContext, api: HostApi): void => {
	if (context.event.button !== 0) return;
	const store = useDrawStore.getState();
	const tolerance = CLOSE_TOLERANCE_PX / screenScale(api);
	if (isCloseTarget(context.point, store.penAnchors, tolerance)) {
		commitPen(store.penAnchors, true, api);
		clearActiveGuideSnap();
		penDown = null;
		return;
	}
	const point = snapDrawPoint(context.point, api);
	store.appendAnchor(cornerAnchor(point));
	store.setPenCursor(point);
	penDown = { start: point, dragging: false };
};

const onPenMove = (context: PointerContext, api: HostApi): void => {
	const store = useDrawStore.getState();
	if (penDown && context.event.buttons !== 0) {
		const moved = distance(penDown.start, context.point) * screenScale(api);
		if (!penDown.dragging && moved < DRAG_THRESHOLD_PX) return;
		penDown.dragging = true;
		clearActiveGuideSnap();
		store.updateLastAnchor(smoothAnchor(penDown.start, context.point));
		return;
	}
	store.setPenCursor(snapDrawPoint(context.point, api));
};

const onPenUp = (): void => {
	penDown = null;
	clearActiveGuideSnap();
};

/** Abandons the in-progress pen path (Escape, or the tool being deactivated). */
const resetPenGesture = (): void => {
	penDown = null;
	clearActiveGuideSnap();
	useDrawStore.getState().resetPen();
};

const onPenKeyDown = (event: KeyboardEvent): void => {
	if (event.key === "Escape") resetPenGesture();
};

type ShapeGesture = {
	readonly kind: ShapeKind;
	readonly start: CanvasPoint;
};

// Press point and kind of the shape currently being dragged out.
let shapeGesture: ShapeGesture | null = null;

/** Abandons the in-flight shape drag so a cancelled gesture leaves no preview. */
const resetShapeGesture = (): void => {
	shapeGesture = null;
	clearActiveGuideSnap();
	useDrawStore.getState().setShapeDrag(null);
};

const onShapeKeyDown = (event: KeyboardEvent): void => {
	if (event.key === "Escape") resetShapeGesture();
};

const onShapeDown = (context: PointerContext, api: HostApi): void => {
	if (context.event.button !== 0) return;
	const store = useDrawStore.getState();
	const kind = store.shapeKind;
	const point = snapDrawPoint(context.point, api);
	shapeGesture = { kind, start: point };
	const modifiers = dragModifiers(context.event);
	store.setShapeDrag({
		kind,
		start: point,
		current: point,
		constrain: modifiers.constrain,
		fromCenter: modifiers.fromCenter,
	});
};

const onShapeMove = (context: PointerContext, api: HostApi): void => {
	const gesture = shapeGesture;
	if (!gesture) return;
	// A move with no button held means the press ended without a pointerup we
	// observed (pointercancel / lost capture); abandon so the dashed preview
	// does not stick to the canvas.
	if (context.event.buttons === 0) {
		resetShapeGesture();
		return;
	}
	const store = useDrawStore.getState();
	const modifiers = dragModifiers(context.event);
	const point = snapDrawPoint(context.point, api, { isDragging: true });
	store.setShapeDrag({
		kind: gesture.kind,
		start: gesture.start,
		current: point,
		constrain: modifiers.constrain,
		fromCenter: modifiers.fromCenter,
	});
};

const onShapeUp = (_context: PointerContext, api: HostApi): void => {
	const store = useDrawStore.getState();
	const drag = store.shapeDrag;
	shapeGesture = null;
	store.setShapeDrag(null);
	if (!drag) {
		clearActiveGuideSnap();
		return;
	}

	const kind = drag.kind;
	const geometry = shapeGeometryFromDrag(kind, drag.start, drag.current, {
		constrain: drag.constrain,
		fromCenter: drag.fromCenter,
	});
	clearActiveGuideSnap();

	// Treat a click or a sub-threshold drag as "no shape" so the canvas does not
	// fill with zero-area nodes.
	const minSize = MIN_SHAPE_SIZE_PX / screenScale(api);
	if (!shapeGeometryMeetsMinimum(geometry, minSize)) {
		return;
	}

	const node = createNode(
		kind,
		geometry,
		kind === "line" ? { name: kind, style: LINE_STYLE } : { name: kind },
	);
	if (!addNode(node)) return;
	api.select(node.id);
	api.setActiveTool("select");
};

// Whether a pencil drag is currently capturing samples. Guards a stray pointerup
// (e.g. arriving after Escape) from committing, and tells a button-less move it
// must tear the stroke down (pointercancel / lost capture).
let freehandActive = false;
// The pointer that owns the in-flight stroke. The host captures and dispatches
// every pointer to the active handler, so a second concurrent contact (multitouch
// / pen+mouse / a stray tap) would otherwise reset or pollute the owner's stroke.
// Pinning the gesture to one pointerId makes every other pointer a no-op.
let freehandPointerId: number | null = null;
// Rich per-sample capture for the stroke-intent layer, accumulated in parallel
// with `freehandPoints` (which the overlay renders) and consumed post-commit. A
// fresh array is swapped in on every reset so an in-flight capture reference the
// commit already grabbed is never mutated out from under it.
let freehandIntentSamples: PencilIntentSample[] = [];

/** Abandons the in-flight pencil stroke so a cancelled gesture leaves no preview. */
const resetFreehandGesture = (): void => {
	freehandActive = false;
	freehandPointerId = null;
	freehandIntentSamples = [];
	useDrawStore.getState().resetFreehand();
};

/**
 * Reads the pen pressure to record for a captured sample. Only `"pen"` input
 * carries a real force signal — mice report a fake constant `0.5` and touch
 * has no pressure sensor worth encoding — so every other `pointerType` stores
 * `undefined`, which is what routes {@link freehandStrokeToWidthProfile} (and,
 * upstream, byte-identical mouse geometry) down the no-profile path.
 */
const capturedPressure = (event: PointerEvent): number | undefined =>
	event.pointerType === "pen" ? event.pressure : undefined;

/** Degrees→radians for browser tilt, which PointerEvent reports in degrees. */
const DEG_TO_RAD = Math.PI / 180;

/**
 * Browser pen tilt in radians from vertical, or null when the device reports no
 * usable tilt. iPad Safari typically returns 0/0 here — real tilt and roll arrive
 * through the native bridge — so a flat 0/0 reading is treated as "no signal"
 * rather than a (false) perfectly-upright pen.
 */
const capturedTiltRad = (event: PointerEvent): number | null => {
	if (event.pointerType !== "pen") return null;
	const { tiltX, tiltY } = event;
	if (tiltX === 0 && tiltY === 0) return null;
	return Math.hypot(tiltX, tiltY) * DEG_TO_RAD;
};

/** Normalizes one captured browser sample into a shared {@link PencilIntentSample}. */
const intentSampleFromEvent = (
	point: FreehandPoint,
	event: PointerEvent,
): PencilIntentSample => ({
	x: point.x,
	y: point.y,
	tMs: event.timeStamp,
	pressure: point.pressure ?? null,
	tiltRad: capturedTiltRad(event),
	azimuthRad: null,
	rollRad: null,
});

const shouldIgnoreFreehandPointer = (
	event: PointerEvent,
	api: HostApi,
): boolean => event.pointerType === "touch" && api.allowTouchFreehand !== true;

/**
 * Converts a coalesced/predicted sub-event's client point into the same
 * artboard-local space as `context.point`, without redoing the host's
 * rect/camera/artboard resolution (not reachable from this layer — see
 * {@link onPencilMove}). The screen↔artboard map is a pure uniform-scale +
 * translation (no rotation), and every coalesced event within one dispatched
 * `pointermove` shares the same rect/camera/artboard resolution as the
 * dispatched event, so the *delta* to the dispatched event's own client point
 * converts by dividing by `scale` alone — the translation terms cancel. The
 * dispatched event's own last coalesced entry reproduces `context.point`
 * exactly (zero delta), which is the sanity check for this reconstruction.
 */
const subEventPoint = (
	sub: PointerEvent,
	dispatched: PointerEvent,
	context: PointerContext,
	scale: number,
): CanvasPoint => ({
	x: context.point.x + (sub.clientX - dispatched.clientX) / scale,
	y: context.point.y + (sub.clientY - dispatched.clientY) / scale,
});

/**
 * Smooths the captured pencil samples into one path node and commits it through
 * the command bus. Click-sized strokes commit nothing, so the canvas never fills
 * with degenerate nodes.
 * The pencil stays active afterward — Illustrator/Figma pencil behavior, where
 * each drag is a fresh stroke — and only selects the new node (selection bounds
 * render for the select tool, so no stray handles appear mid-draw).
 *
 * When every captured sample carries a pen-pressure reading, derives a
 * {@link freehandStrokeToWidthProfile} from the RAW points (before RDP/fitting
 * reshapes them) and attaches it to the created node's style so the committed
 * path renders as a variable-width stroke. Mouse/touch/mixed captures (any
 * point missing `pressure`) fall through to the plain uniform-width style,
 * byte-identical to today.
 */
const commitFreehand = (api: HostApi): void => {
	const points = useDrawStore.getState().freehandPoints;
	// Grab the intent samples before the reset swaps in a fresh array.
	const intentSamples = freehandIntentSamples;
	resetFreehandGesture();
	const result = commitFreehandStroke({
		points,
		viewportZoom: api.viewport.zoom,
		selectNode: api.select,
	});
	// Build the stroke intent AFTER the commit returns, so the drawn path is never
	// held behind analysis. The intent is transient — it feeds later conversions
	// and does not change what was just committed.
	if (result.kind === "inserted") {
		useStrokeIntentStore.getState().setLastIntent(
			buildPencilStrokeIntent({
				id: result.nodeId,
				source: "pointer-event",
				samples: intentSamples,
			}),
		);
	}
};

const onPencilDown = (context: PointerContext, api: HostApi): void => {
	if (context.event.button !== 0) return;
	// Native iPad shells deliver Apple Pencil through the native bridge, so web
	// touch remains palm input there. Plain iPad Safari has no bridge; allowing
	// touch keeps the web Pencil usable when Safari does not expose a pen pointer.
	if (shouldIgnoreFreehandPointer(context.event, api)) return;
	// A press while a stroke is already in flight is a second concurrent pointer;
	// ignore it so it cannot wipe the owner's in-progress work.
	if (freehandActive) return;
	const store = useDrawStore.getState();
	store.resetFreehand();
	const downPoint: FreehandPoint = {
		...context.point,
		pressure: capturedPressure(context.event),
	};
	store.appendFreehandPoint(downPoint);
	freehandIntentSamples = [intentSampleFromEvent(downPoint, context.event)];
	freehandActive = true;
	freehandPointerId = context.event.pointerId;
};

const onPencilMove = (context: PointerContext, api: HostApi): void => {
	if (!freehandActive || context.event.pointerId !== freehandPointerId) return;
	if (shouldIgnoreFreehandPointer(context.event, api)) return;
	// A move with no button held means the press ended without a pointerup we
	// observed (pointercancel / lost capture); abandon so the trace does not stick.
	if (context.event.buttons === 0) {
		resetFreehandGesture();
		return;
	}
	const store = useDrawStore.getState();
	const scale = screenScale(api);
	const minDistance = FREEHAND_SAMPLE_PX / scale;
	const appendThrottled = (
		point: FreehandPoint,
		sourceEvent: PointerEvent,
	): void => {
		const points = useDrawStore.getState().freehandPoints;
		const last = points[points.length - 1];
		// Throttle by min spacing: dense raw samples add no shape and only churn
		// the preview store; RDP does the real thinning at commit time.
		if (last && distance(last, point) < minDistance) return;
		store.appendFreehandPoint(point);
		// Mirror every accepted sample into the intent capture with its source
		// event's timing/tilt, so the analysis timeline matches the drawn path.
		freehandIntentSamples.push(intentSampleFromEvent(point, sourceEvent));
	};

	// Pen input only: expand the browser's coalesced sub-events into individual
	// captured samples so a fast stroke's pressure curve survives at full
	// fidelity. Mouse (and any device without the method) takes the single
	// current point unchanged — this keeps mouse strokes byte-identical to
	// before this change, which coalescing a high-poll-rate mouse would not.
	if (
		context.event.pointerType === "pen" &&
		typeof context.event.getCoalescedEvents === "function"
	) {
		const coalesced = context.event.getCoalescedEvents();
		if (coalesced.length > 0) {
			for (const sub of coalesced) {
				appendThrottled(
					{
						...subEventPoint(sub, context.event, context, scale),
						pressure: capturedPressure(sub),
					},
					sub,
				);
			}
		} else {
			appendThrottled(
				{
					...context.point,
					pressure: capturedPressure(context.event),
				},
				context.event,
			);
		}
	} else {
		appendThrottled(
			{
				...context.point,
				pressure: capturedPressure(context.event),
			},
			context.event,
		);
	}

	// Predicted continuation, pen only: a short OS-estimated tail rendered by
	// the same preview overlay to mask input latency. Recomputed every move and
	// cleared on cancel/commit; never merged into `freehandPoints`, so a
	// misprediction can never reach committed geometry.
	if (
		context.event.pointerType === "pen" &&
		typeof context.event.getPredictedEvents === "function"
	) {
		const predicted = context.event.getPredictedEvents();
		store.setPredictedTail(
			predicted.map((sub) => subEventPoint(sub, context.event, context, scale)),
		);
	} else if (store.predictedTail.length > 0) {
		store.setPredictedTail([]);
	}
};

const onPencilUp = (context: PointerContext, api: HostApi): void => {
	if (!freehandActive || context.event.pointerId !== freehandPointerId) return;
	// Pin the exact release point (the last move may have been throttled away).
	const releasePoint: FreehandPoint = {
		...context.point,
		pressure: capturedPressure(context.event),
	};
	useDrawStore.getState().appendFreehandPoint(releasePoint);
	freehandIntentSamples.push(
		intentSampleFromEvent(releasePoint, context.event),
	);
	commitFreehand(api);
};

const onPencilKeyDown = (event: KeyboardEvent): void => {
	if (event.key === "Escape") resetFreehandGesture();
};

const penHandler: DrawToolHandler = {
	id: "draw-pen",
	tool: "pen",
	onPointerDown: onPenDown,
	onPointerMove: onPenMove,
	onPointerUp: onPenUp,
	onKeyDown: onPenKeyDown,
	onDeactivate: resetPenGesture,
};

const pencilHandler: DrawToolHandler = {
	id: "draw-pencil",
	tool: "pencil",
	onPointerDown: onPencilDown,
	onPointerMove: onPencilMove,
	onPointerUp: onPencilUp,
	onKeyDown: onPencilKeyDown,
	onDeactivate: resetFreehandGesture,
};

const shapeHandler: DrawToolHandler = {
	id: "draw-shape",
	tool: "shape",
	onPointerDown: onShapeDown,
	onPointerMove: onShapeMove,
	onPointerUp: onShapeUp,
	onKeyDown: onShapeKeyDown,
	onDeactivate: resetShapeGesture,
};

export const handlers: readonly DrawToolHandler[] = [
	penHandler,
	pencilHandler,
	shapeHandler,
];
