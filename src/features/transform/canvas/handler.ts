import {
	collectGridIntersectionsNear,
	collectGridLineCandidatesNear,
	collectGuideCandidates,
	type GuideCandidate,
	type GuideSnapResult,
	snapPointToGuides,
	snapSelectionBboxToGuides,
	visibleGridSpacing,
} from "@/entities/guides/model/snapping";
import { useGuideStore } from "@/entities/guides/model/store";
import type { SceneCommand } from "@/entities/scene/model/command";
import { collectLayoutManagedChildIds } from "@/entities/scene/model/layout-frame";
import {
	createDeleteNodesCommand,
	createRemoveArtboardCommand,
	createResizeTextBoxCommand,
	createUpdateArtboardCommand,
	createUpdateRectCornerRadiiCommand,
	createUpdateRectCornerRadiusCommand,
} from "@/entities/scene/model/node-commands";
import {
	type Matrix2D,
	normalizeTextGeometry,
	resizeTextBoxBoundsForHandle,
	transformFromMatrix,
	transformWithAnchorPreservingMatrix,
} from "@/entities/scene/model/rendering";
import {
	canvasSelectionTargetId,
	findNode,
	selectAllArtboardBounds,
	selectAllArtboards,
	selectArtboardIdForNode,
} from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import type {
	Bounds,
	SceneDocument,
	Transform,
	VectorNode,
} from "@/entities/scene/model/types";
import {
	collectVertexAnchors,
	type VertexAnchor,
} from "@/entities/scene/model/vertex-snap";
import { cursorForTool, type EditorCursor } from "@/shared/lib/cursor";
import {
	type PointSnapCandidate,
	snapToNearestPoint,
} from "@/shared/lib/snapping";
import {
	type ArtboardRect,
	classifyArtboardHit,
	MIN_ARTBOARD_SIZE,
	resizeArtboardRect,
} from "../model/artboard-resize";
import {
	anchorPoint,
	type CornerHandleId,
	classifyHit,
	cornerRadiusFromLocalPoint,
	type Frame,
	frameFromNodes,
	type HandleId,
	type HitTarget,
	hitTestNodeId,
	localBounds,
	marqueeNodeIds,
	nodeMatrix,
	nodeParentMatrix,
	nodeWorldMatrix,
	normalizeRect,
	type RotationHandleBounds,
	resizeCursorOctant,
	shouldForceAxisAligned,
	transformableSelectionNodes,
} from "../model/geometry";
import {
	axisLockedDelta,
	groupResizeMatrix,
	moveMatrix,
	nudgeDelta,
	resizeSingleMatrix,
	rotateMatrix,
} from "../model/gestures";
import {
	computeLiveTransformOverrides,
	type NodeMatrixPatch,
} from "../model/live-drag";
import { useLiveTransformStore } from "../model/live-drag-store";
import {
	applyToPoint,
	invert,
	multiply,
	type Point,
	translation,
} from "../model/matrix";
import {
	recordDuplicateTransformRepeat,
	recordNodeTransformRepeat,
	recordSelectionMatrixRepeatTransform,
} from "../model/repeat-transform";
import {
	isAxisAlignedMode,
	type TransformTarget,
	useTransformUiStore,
} from "../model/store";

// Structural mirror of the canvas registry surface (registry.ts). Features
// cannot import the widget-layer registry types — the arch gate bans upward
// imports — so the handler is typed against this local subset and the host
// passes a compatible superset (including the additive selection mutators).
type CanvasPoint = {
	readonly x: number;
	readonly y: number;
};

type PointerContext = {
	readonly point: CanvasPoint;
	/** Pointer in pasteboard space; artboard gestures operate here, not in local. */
	readonly pasteboardPoint: CanvasPoint;
	readonly hitNodeId: string | null;
	readonly runtime3dHitResolved?: boolean;
	readonly event: PointerEvent;
};

type HostApi = {
	readonly apply: (
		nodeId: string,
		patch: {
			readonly matrix?: Matrix2D;
			readonly transform?: Partial<Transform>;
			readonly opacity?: number;
		},
	) => void;
	readonly getDoc: () => SceneDocument;
	readonly selection: {
		readonly nodeIds: readonly string[];
		readonly primary: string | null;
		readonly selectedArtboardId: string | null;
	};
	readonly viewport: { readonly zoom: number };
	readonly select: (nodeId: string, additive?: boolean) => void;
	readonly setSelection: (
		nodeIds: readonly string[],
		primary?: string | null,
	) => void;
	readonly clearSelection: () => void;
	readonly selectArtboard: (artboardId: string | null) => void;
	readonly editTextNode: (nodeId: string) => boolean;
	/**
	 * Plans a duplicate-nodes command for `nodeIds` offset by `offset`, without
	 * applying it — the handler applies the returned command itself through the
	 * scene command bus it already writes through. Delegates to the clipboard
	 * feature on the host side, so this feature never imports another feature
	 * (`features/clipboard`) to drive Alt/Option-drag duplicate. `null` means
	 * the selection is not eligible (nested/multi-layer/hidden/locked sources);
	 * the caller must fall back to a plain move. Optional (rather than
	 * required, like every other member here) solely because the real host
	 * always implements it — `CanvasShell`'s `buildHandlerApi` — while the unit
	 * test's hand-rolled `HostApi` stand-ins predate this capability and are
	 * out of this change's scope; `syncDuplicateIntent`/`finalizeDuplicateDrag`
	 * treat a missing implementation the same as an ineligible selection.
	 */
	readonly buildDuplicateCommand?: (
		nodeIds: readonly string[],
		offset: CanvasPoint,
	) => { command: SceneCommand; newRootNodeIds: readonly string[] } | null;
	/**
	 * iPad Pencil-motion "Perform mode" (L3) gate: true only for the single
	 * Select-tool drag Perform was armed for. While true and the gesture is a
	 * single-node move, `onPointerMove` reports live samples through
	 * {@link onPerformSample} instead of the ordinary live-override-only path,
	 * and {@link finalizeNodeDrag} hands off to {@link onPerformCommit} INSTEAD
	 * of writing a scene transform (see `docs/product-knowledge/ipad-perform-motion.md`).
	 * Optional for the same reason as {@link buildDuplicateCommand}: the real
	 * host always supplies it; absent (or false), a gesture behaves exactly as
	 * it did before Perform mode existed.
	 */
	readonly isPerforming?: boolean;
	/** Reports one live drag sample for `nodeId`: position and elapsed ms since the gesture started. */
	readonly onPerformSample?: (
		nodeId: string,
		x: number,
		y: number,
		tMs: number,
	) => void;
	/**
	 * Finalizes a Perform gesture for `nodeId`. The host converts the
	 * accumulated samples to x/y keyframes and commits them as one motion
	 * transaction, then disarms Perform. {@link finalizeNodeDrag} calls this
	 * INSTEAD of its normal scene-transform commit, so the node's base transform
	 * never changes and the recorded motion is the only outcome (no double write).
	 */
	readonly onPerformCommit?: (nodeId: string) => void;
};

type SelectKeyEvent = {
	readonly key: string;
	readonly shiftKey: boolean;
	readonly altKey?: boolean;
	readonly metaKey?: boolean;
	readonly ctrlKey?: boolean;
	readonly preventDefault: () => void;
};

type SelectToolHandler = {
	readonly id: string;
	readonly tool: "select";
	readonly onPointerDown: (context: PointerContext, api: HostApi) => void;
	readonly onPointerMove: (context: PointerContext, api: HostApi) => void;
	readonly onPointerUp: (context: PointerContext, api: HostApi) => void;
	readonly onKeyDown: (event: SelectKeyEvent, api: HostApi) => void;
	readonly onDeactivate: (api: HostApi) => void;
};

const HANDLE_HIT_PX = 9;
const ROTATE_HANDLE_OFFSET_PX = 18;
/**
 * Inset of each corner-radius handle from its corner, in screen px. Kept larger
 * than {@link HANDLE_HIT_PX} so the radius pick disc never overlaps the resize
 * disc on the corner — resize always wins at the corner, rounding on the inset.
 */
const CORNER_RADIUS_HANDLE_INSET_PX = 18;
const SELECTION_HIT_TOLERANCE_PX = 4;
const SNAP_THRESHOLD_PX = 6;
const DRAG_THRESHOLD_PX = 3;
const PERCENT = 100;
// Idle gap that seals one arrow-nudge burst: presses closer than this coalesce
// into a single undo entry; a longer pause starts a fresh one.
const NUDGE_COALESCE_MS = 600;
const MOVE_LABEL = "Move";
const RESIZE_LABEL = "Resize";
const ROTATE_LABEL = "Rotate";
const ANCHOR_LABEL = "Move pivot";
const RADIUS_LABEL = "Round corners";
const NUDGE_LABEL = "Nudge";
const MOVE_ARTBOARD_LABEL = "Move artboard";
const RESIZE_ARTBOARD_LABEL = "Resize artboard";

type Snapshot = {
	readonly nodeId: string;
	readonly parentMatrix: Matrix2D;
	readonly matrix: Matrix2D;
	readonly worldMatrix: Matrix2D;
	readonly transform: Transform;
	readonly bounds: Bounds;
};

type DragMode = "move" | "resize" | "rotate";

type NodeDrag = {
	readonly kind: "nodes";
	readonly mode: DragMode;
	readonly handle: HandleId | null;
	readonly single: boolean;
	readonly frame: Frame;
	readonly center: Point;
	/** Primary node's rotation at gesture start; drives absolute-angle snap. */
	readonly startAngle: number;
	readonly snapshots: readonly Snapshot[];
	readonly start: CanvasPoint;
	readonly coalesceKey: string;
	readonly collapseTo: string | null;
	dragging: boolean;
	transactionOpen: boolean;
	/**
	 * Snap candidates are scene-immutable for the whole gesture, so they are
	 * collected lazily on the first snapped move and reused — never recollected
	 * per pointermove (which would walk every node's geometry each frame).
	 */
	guideCandidates: GuideCandidate[] | null;
	/** Snap-to-Point vertex candidates, cached for the gesture like the above. */
	pointCandidates: VertexAnchor[] | null;
	/**
	 * The most recent pointermove's raw inputs to `applyDrag`, cached so gesture
	 * end (pointerup, `cancelActiveGesture`, an orphan flush) can replay the
	 * SAME computation once against the real scene store — byte-identical to
	 * what the old per-move write path would have committed on its last move —
	 * instead of re-deriving the final matrix from the transient override.
	 * `null` until the drag crosses the move threshold.
	 */
	live: { point: CanvasPoint; constrain: boolean; fromCenter: boolean } | null;
	/**
	 * Alt/Option-drag-to-duplicate is move-only. `null` until eligibility is
	 * checked (lazily, on first Alt engage) so an ineligible selection (nested
	 * children, multi-layer, hidden/locked sources) never re-checks every move;
	 * `duplicating` is the live toggle, sampled from `event.altKey` each move —
	 * it may flip on and off any number of times before pointerup, which alone
	 * decides the final outcome.
	 */
	duplicateEligible: boolean | null;
	duplicating: boolean;
	/**
	 * Gesture-start `performance.now()`, captured unconditionally at pointerdown
	 * (only ever read for a single-node move gesture while Perform is armed —
	 * see {@link emitPerformSample}). Captured at pointerdown rather than at the
	 * move-threshold crossing deliberately: a real "performance" may include a
	 * deliberate pause before the first move, and that pause is part of the
	 * captured timing rather than clipped from it. `null` for resize/rotate,
	 * which Perform mode never records (position only, v1).
	 */
	performStartMs: number | null;
	/**
	 * Node-snap exclusion set, swapped between the dragged snapshot ids (normal
	 * move: the moving nodes must not snap to their own vacated position) and
	 * empty (duplicate mode: nothing in the document actually moves, so the
	 * originals stay valid snap targets and the moving copy can snap onto its
	 * own source, matching Figma). Read by {@link gestureGuideCandidates} and
	 * {@link gesturePointCandidates} instead of deriving from `snapshots`
	 * directly, so engage/disengage can swap it without changing those
	 * functions' call sites.
	 */
	snapExcludeNodeIds: readonly string[];
};

/**
 * Artboard move/resize gesture, folded into the same `drag` variable as the
 * node gesture so every teardown seam (pointerup, Escape, pointercancel,
 * onDeactivate, cancelActiveGesture) commits/aborts its transaction unchanged —
 * a parallel variable would inevitably miss one and strand an open transaction.
 * `start` and `startRect` are PASTEBOARD-space; artboards carry no matrix, so the
 * write computes position/width/height directly.
 */
type ArtboardDrag = {
	readonly kind: "artboard";
	readonly mode: "move" | "resize";
	readonly artboardId: string;
	readonly handle: HandleId | null;
	readonly startRect: ArtboardRect;
	readonly start: CanvasPoint;
	readonly coalesceKey: string;
	dragging: boolean;
	transactionOpen: boolean;
};

/**
 * On-canvas corner-radius gesture for a single rect. Folded into the same `drag`
 * variable so every teardown seam (pointerup, Escape, pointercancel,
 * cancelActiveGesture) commits/aborts its transaction unchanged. The radius is
 * computed in the node's LOCAL space (via the start snapshot's inverse matrix),
 * so rounding stays scale/rotation-correct.
 */
type CornerRadiusDrag = {
	readonly kind: "corner-radius";
	readonly corner: CornerHandleId;
	readonly snapshot: Snapshot;
	readonly start: CanvasPoint;
	readonly coalesceKey: string;
	dragging: boolean;
	transactionOpen: boolean;
};

/**
 * On-canvas pivot gesture for a single node. The start matrix is kept fixed so
 * the pointer maps into local anchor space while the artwork remains visually
 * stationary through each live update.
 */
type AnchorDrag = {
	readonly kind: "anchor";
	readonly snapshot: Snapshot;
	readonly start: CanvasPoint;
	readonly coalesceKey: string;
	dragging: boolean;
	transactionOpen: boolean;
};

type Drag = NodeDrag | ArtboardDrag | CornerRadiusDrag | AnchorDrag;

type Marquee = {
	readonly origin: CanvasPoint;
	readonly additive: boolean;
	readonly base: readonly string[];
};

let drag: Drag | null = null;
let marquee: Marquee | null = null;
let gestureSeq = 0;
let nudgeSeq = 0;
let lastNudgeAt = 0;
let nudgeRepeatBurst = { seq: 0, key: "", dx: 0, dy: 0 };
/**
 * The most recent `HostApi` seen by `onPointerDown`/`onPointerMove`. Read only
 * by `cancelActiveGesture`'s no-argument call sites (the window
 * `pointercancel`/`blur` seal in `overlay.tsx`, which has no `HostApi` of its
 * own) so an interrupted node drag can still finalize its one real
 * scene-store write. Always as fresh as the in-flight gesture: it is
 * overwritten on every pointer event the gesture receives.
 */
let lastApi: HostApi | null = null;

const screenScale = (api: HostApi): number =>
	Math.max(api.viewport.zoom / PERCENT, 0.001);

const isUnmodifiedDoubleClick = (event: PointerEvent): boolean =>
	event.detail >= 2 &&
	!event.shiftKey &&
	!event.metaKey &&
	!event.ctrlKey &&
	!event.altKey;

const artboardOrigin = (api: HostApi): CanvasPoint => ({
	x: api.getDoc().artboard.position?.x ?? 0,
	y: api.getDoc().artboard.position?.y ?? 0,
});

const selectionHitTolerance = (api: HostApi): number =>
	SELECTION_HIT_TOLERANCE_PX / screenScale(api);

const artboardRotationBounds = (
	document: SceneDocument,
): RotationHandleBounds => ({
	minX: 0,
	minY: 0,
	maxX: document.artboard.width,
	maxY: document.artboard.height,
});

const selectedNodes = (api: HostApi): VectorNode[] => {
	const document = api.getDoc();
	return transformableSelectionNodes(document, api.selection.nodeIds);
};

/**
 * Drops direct layout-managed children from a move/resize gesture's
 * participant list. A managed child's geometry is owned by its layout frame
 * (the runner re-materializes it on every layout-relevant patch), so a raw
 * move/resize write to one is either fought back immediately or discarded.
 */
const withoutLayoutManagedNodes = (
	nodes: readonly VectorNode[],
	managedIds: ReadonlySet<string>,
): readonly VectorNode[] => nodes.filter((node) => !managedIds.has(node.id));

/**
 * Whether the current selection draws the upright (axis-aligned) frame: exactly
 * one node, in axis-aligned mode, and actually rotated off-axis. Read from the
 * same store the overlay reads so chrome and hit-testing never disagree.
 */
const axisAlignedForNodes = (nodes: readonly VectorNode[]): boolean => {
	if (nodes.length !== 1) return false;
	const node = nodes[0];
	if (!node) return false;
	const { boundingBoxMode } = useTransformUiStore.getState();
	return shouldForceAxisAligned(
		node,
		isAxisAlignedMode(boundingBoxMode, node.id),
	);
};

/** Frame-build options for the current selection (upright vs oriented). */
const frameOptionsFor = (
	document: SceneDocument,
	nodes: readonly VectorNode[],
) => ({
	forceAxisAligned: axisAlignedForNodes(nodes),
	document,
});

/**
 * Whether the current selection shows the inset corner-radius handles: exactly
 * one rect, not in axis-aligned mode (the upright AABB frame would mismatch the
 * rotated node's local rounding). Star/polygon/per-corner land with their baked
 * rendering in a later phase.
 */
const cornerRadiusEnabledFor = (nodes: readonly VectorNode[]): boolean =>
	nodes.length === 1 &&
	nodes[0]?.geometry.kind === "rect" &&
	!axisAlignedForNodes(nodes);

/**
 * Hit-test gating: corner-only resize in axis-aligned mode (edge handles would
 * shear a rotated node), no handles at all while Bounding Box is hidden, and the
 * inset corner-radius handles for a single rect. Must mirror the overlay.
 */
const hitOptionsFor = (
	document: SceneDocument,
	nodes: readonly VectorNode[],
	scale: number,
) => ({
	cornerResizeOnly: axisAlignedForNodes(nodes),
	handlesEnabled: useTransformUiStore.getState().boundingBoxHandlesVisible,
	cornerRadiusEnabled: cornerRadiusEnabledFor(nodes),
	cornerRadiusInset: CORNER_RADIUS_HANDLE_INSET_PX / scale,
	anchorPoint:
		nodes.length === 1 && nodes[0] ? anchorPoint(nodes[0], document) : null,
});

const snapshotOf = (document: SceneDocument, node: VectorNode): Snapshot => {
	const matrix = nodeMatrix(node);
	return {
		nodeId: node.id,
		parentMatrix: nodeParentMatrix(document, node.id),
		matrix,
		worldMatrix: nodeWorldMatrix(document, node),
		transform: node.transform,
		bounds: localBounds(node),
	};
};

const localMatrixFromWorld = (
	snapshot: Snapshot,
	worldMatrix: Matrix2D,
): Matrix2D => multiply(invert(snapshot.parentMatrix), worldMatrix);

const startRotationOf = (snapshot: Snapshot | undefined): number =>
	snapshot
		? transformFromMatrix(snapshot.worldMatrix, { x: 0, y: 0 }).rotation
		: 0;

const labelFor = (mode: DragMode): string =>
	mode === "move"
		? MOVE_LABEL
		: mode === "resize"
			? RESIZE_LABEL
			: ROTATE_LABEL;

const cssCursor = (cursor: EditorCursor): string =>
	cursor === "rotate" ? "grab" : cursor;

const cursorFor = (hit: HitTarget, frame: Frame, dragging: boolean): string => {
	if (hit.kind === "resize") {
		return cssCursor(
			cursorForTool("select", resizeCursorOctant(frame, hit.handle), dragging),
		);
	}
	if (hit.kind === "rotate") {
		return cssCursor(cursorForTool("select", "rotate", dragging));
	}
	if (hit.kind === "anchor") return dragging ? "grabbing" : "grab";
	if (hit.kind === "corner-radius") return "pointer";
	if (hit.kind === "body") return dragging ? "grabbing" : "move";
	return "default";
};

const hitForDrag = (current: Drag): HitTarget => {
	if (current.kind === "anchor") return { kind: "anchor" };
	if (current.kind === "corner-radius") {
		return { kind: "corner-radius", handle: current.corner };
	}
	if (current.mode === "move") return { kind: "body" };
	if (current.handle) return { kind: current.mode, handle: current.handle };
	return { kind: "none" };
};

const setCursor = (event: PointerEvent, cursor: string): void => {
	const target = event.target;
	if (typeof Element === "undefined" || typeof SVGElement === "undefined") {
		return;
	}
	if (!(target instanceof Element)) return;
	const svg = target.closest("svg");
	if (typeof SVGElement !== "undefined" && svg instanceof SVGElement) {
		svg.style.cursor = cursor;
	}
};

const targetFromHit = (hit: HitTarget): TransformTarget => {
	if (hit.kind === "resize") return { kind: "resize", handle: hit.handle };
	if (hit.kind === "rotate") return { kind: "rotate", handle: hit.handle };
	if (hit.kind === "anchor") return { kind: "anchor" };
	if (hit.kind === "corner-radius") {
		return { kind: "corner-radius", handle: hit.handle };
	}
	if (hit.kind === "body") return { kind: "move" };
	return null;
};

/**
 * Defensively seals a gesture that somehow survived to the next pointerdown
 * without a matching pointerup/cancel. A "nodes" drag finalizes its one real
 * scene-store write first (mirroring `onPointerUp`/`cancelActiveGesture`) so
 * the orphaned drag's progress lands instead of silently vanishing.
 */
const flushOrphanedTransaction = (api: HostApi): void => {
	if (drag?.kind === "nodes" && drag.dragging) finalizeNodeDrag(drag, api);
	if (drag?.transactionOpen) useSceneStore.getState().commit();
};

const clearActiveGuideSnap = (): void => {
	useGuideStore.getState().clearActiveSnap();
};

/**
 * Lazily collects (and caches on the gesture) the smart-guide candidates. Gated
 * on the dedicated `smartGuides` behavior toggle — NOT on grid/guide-line
 * visibility, so snapping is decoupled from what is shown. Guide-line candidates
 * still respect their own visibility; artboard + object anchors are always present
 * under Smart Guides. Grid candidates are NOT collected here — they are generated
 * locally per-move around the dragged box (see {@link guideSnapCandidates}) so the
 * grid snaps across the whole pasteboard instead of only inside the artboard. The
 * dragged selection is excluded so it never snaps to itself — except in duplicate
 * mode, where `snapExcludeNodeIds` is emptied so the stationary originals become
 * valid snap targets for the moving copy (see `NodeDrag.snapExcludeNodeIds`).
 */
const gestureGuideCandidates = (
	current: NodeDrag,
	api: HostApi,
): GuideCandidate[] => {
	if (current.guideCandidates) return current.guideCandidates;
	const guideStore = useGuideStore.getState();
	const candidates = guideStore.snap.smartGuides
		? collectGuideCandidates(api.getDoc(), {
				includeGrid: false,
				guideLines: guideStore.view.guideLinesVisible
					? guideStore.guideLines
					: [],
				excludeNodeIds: current.snapExcludeNodeIds,
			})
		: [];
	current.guideCandidates = candidates;
	return candidates;
};

const snapProjection = (api: HostApi) => ({
	zoom: screenScale(api),
	pan: { x: 0, y: 0 },
});

/**
 * The finest grid spacing that is currently VISIBLE (so snapping matches what is
 * drawn), or null when the grid is hidden — in which case the grid is never a snap
 * target. Snap candidates are in artboard-local space (the lattice is phased to
 * local 0 = the artboard origin), so no offset is needed.
 */
const gridSnapSpacing = (api: HostApi): number | null =>
	useGuideStore.getState().view.gridVisible
		? visibleGridSpacing(screenScale(api))
		: null;

/**
 * Smart-guide candidates for the move/resize box: the cached artboard/object/guide
 * candidates PLUS grid-line candidates generated locally around the given anchor
 * values. Grid lines are gated on both grid visibility and the Smart Guides toggle
 * so a hidden grid is never snapped to.
 */
const guideSnapCandidates = (
	current: NodeDrag,
	api: HostApi,
	anchorsX: readonly number[],
	anchorsY: readonly number[],
): GuideCandidate[] => {
	const base = gestureGuideCandidates(current, api);
	const spacing = gridSnapSpacing(api);
	if (!useGuideStore.getState().snap.smartGuides || spacing === null) {
		return base;
	}
	return [
		...base,
		...collectGridLineCandidatesNear(api.getDoc(), spacing, anchorsX, anchorsY),
	];
};

/** Axis-aligned extents of the gesture's start frame (visual bbox of corners). */
const frameExtents = (frame: Frame) => {
	const xs = frame.corners.map((corner) => corner.x);
	const ys = frame.corners.map((corner) => corner.y);
	return {
		minX: Math.min(...xs),
		maxX: Math.max(...xs),
		minY: Math.min(...ys),
		maxY: Math.max(...ys),
	};
};

/**
 * Lazily collects (and caches) Snap-to-Point vertex candidates for the gesture.
 * Gated on the `snapToPoint` toggle; excludes the dragged subtree so a shape
 * never snaps onto its own anchors (emptied in duplicate mode — see
 * `NodeDrag.snapExcludeNodeIds`).
 */
const gesturePointCandidates = (
	current: NodeDrag,
	api: HostApi,
): VertexAnchor[] => {
	if (current.pointCandidates) return current.pointCandidates;
	const points = useGuideStore.getState().snap.snapToPoint
		? collectVertexAnchors(api.getDoc(), {
				excludeNodeIds: current.snapExcludeNodeIds,
			})
		: [];
	current.pointCandidates = points;
	return points;
};

/**
 * 2-D point-snap candidates: the gesture's cached real vertices FIRST, then grid
 * intersections around `focus`. Vertices come first so a vertex wins a same-place
 * tie against a coincident grid crossing (the 2-D engine is first-wins on exact
 * ties). Grid intersections are gated on grid visibility via {@link gridSnapSpacing}.
 */
const pointSnapCandidates = (
	current: NodeDrag,
	api: HostApi,
	focus: CanvasPoint,
): readonly PointSnapCandidate[] => {
	const vertices = gesturePointCandidates(current, api);
	const spacing = gridSnapSpacing(api);
	if (spacing === null) return vertices;
	return [...vertices, ...collectGridIntersectionsNear(focus, spacing)];
};

/** Overlay-facing result for a 2D point lock: a dot indicator, no guide lines. */
const pointLockResult = (
	from: CanvasPoint,
	to: CanvasPoint,
	indicator: GuideSnapResult["indicator"],
): GuideSnapResult => ({
	point: to,
	adjustedPoint: to,
	delta: { x: to.x - from.x, y: to.y - from.y },
	snapped: true,
	matches: [],
	guides: [],
	measurements: [],
	indicator,
});

/**
 * Snap for MOVE. Snap to Point wins first: it 2D-locks the grab point onto the
 * nearest real vertex (suppressed under Shift, a 1D axis-lock). Otherwise smart
 * guides snap the dragged selection's bounding-box edges/centers (not the grab
 * point) by correcting the move DELTA — the Figma/Illustrator model. The proposed
 * delta is axis-locked FIRST, and only an axis with nonzero proposed movement may
 * snap, so snapping never drifts a constrained or stationary axis. The caller
 * applies the returned point with `moveMatrix(..., false)` since the lock is
 * already baked in. Read-only over the document — the transaction/undo seams are
 * untouched.
 */
const snappedMovePoint = (
	rawPoint: CanvasPoint,
	current: NodeDrag,
	api: HostApi,
	constrain: boolean,
): CanvasPoint => {
	const start = current.start;
	const proposed = axisLockedDelta(
		rawPoint.x - start.x,
		rawPoint.y - start.y,
		constrain,
	);
	const lockedPoint = { x: start.x + proposed.dx, y: start.y + proposed.dy };
	const snap = useGuideStore.getState().snap;
	if (!snap.smartGuides && !snap.snapToPoint) {
		clearActiveGuideSnap();
		return lockedPoint;
	}
	if (snap.snapToPoint && !constrain) {
		const lock = snapToNearestPoint(
			lockedPoint,
			pointSnapCandidates(current, api, lockedPoint),
			{
				enabled: true,
				thresholdPx: SNAP_THRESHOLD_PX,
				projection: snapProjection(api),
			},
		);
		if (lock.snapped) {
			useGuideStore
				.getState()
				.setActiveSnap(
					pointLockResult(lockedPoint, lock.point, lock.indicator),
					{
						isDragging: current.dragging,
						origin: artboardOrigin(api),
					},
				);
			return lock.point;
		}
	}
	if (!snap.smartGuides) {
		clearActiveGuideSnap();
		return lockedPoint;
	}
	const ext = frameExtents(current.frame);
	// Grid-line candidates are generated around the box's SHIFTED anchors (edges +
	// centers after the proposed move), matching how snapSelectionBboxToGuides tests
	// `anchor + delta` — so a box edge can land on a grid line anywhere on the
	// pasteboard, not only inside the artboard.
	const anchorsX = [ext.minX, (ext.minX + ext.maxX) / 2, ext.maxX].map(
		(value) => value + proposed.dx,
	);
	const anchorsY = [ext.minY, (ext.minY + ext.maxY) / 2, ext.maxY].map(
		(value) => value + proposed.dy,
	);
	const bbox = snapSelectionBboxToGuides(
		ext,
		{ x: proposed.dx, y: proposed.dy },
		{
			enabled: true,
			threshold: 0,
			thresholdPx: SNAP_THRESHOLD_PX,
			projection: snapProjection(api),
			candidates: guideSnapCandidates(current, api, anchorsX, anchorsY),
			axes: { x: proposed.dx !== 0, y: proposed.dy !== 0 },
		},
	);
	if (!bbox.snapped) {
		clearActiveGuideSnap();
		return lockedPoint;
	}
	useGuideStore.getState().setActiveSnap(bbox.result, {
		isDragging: current.dragging,
		origin: artboardOrigin(api),
	});
	return {
		x: start.x + proposed.dx + bbox.correction.x,
		y: start.y + proposed.dy + bbox.correction.y,
	};
};

/**
 * Snap used by RESIZE. Figma-parity: the dragged handle (≈ the cursor ≈ the moving
 * corner) 2D-locks onto the nearest real vertex or grid intersection first, then
 * falls through to 1D edge/center alignment against artboard/object/guide lines and
 * the grid. Point lock is gated on Snap to Point; the 1D pass on Smart Guides.
 */
const snappedPoint = (
	point: CanvasPoint,
	current: NodeDrag,
	api: HostApi,
): CanvasPoint => {
	const snap = useGuideStore.getState().snap;
	if (snap.snapToPoint) {
		const lock = snapToNearestPoint(
			point,
			pointSnapCandidates(current, api, point),
			{
				enabled: true,
				thresholdPx: SNAP_THRESHOLD_PX,
				projection: snapProjection(api),
			},
		);
		if (lock.snapped) {
			useGuideStore
				.getState()
				.setActiveSnap(pointLockResult(point, lock.point, lock.indicator), {
					isDragging: current.dragging,
					origin: artboardOrigin(api),
				});
			return lock.point;
		}
	}
	const result = snapPointToGuides(point, {
		enabled: snap.smartGuides,
		threshold: 0,
		thresholdPx: SNAP_THRESHOLD_PX,
		projection: snapProjection(api),
		showMeasurements: current.dragging,
		candidates: guideSnapCandidates(current, api, [point.x], [point.y]),
	});

	if (!result.snapped) {
		clearActiveGuideSnap();
		return point;
	}

	useGuideStore.getState().setActiveSnap(result, {
		isDragging: current.dragging,
		origin: artboardOrigin(api),
	});
	return result.adjustedPoint;
};

/**
 * Writes one node's resolved matrix. Live pointermoves pass a pure collector
 * (into the transient override store); gesture end passes the real
 * `api.apply`, writing through to the scene store exactly once per gesture.
 */
type MatrixWriter = (nodeId: string, matrix: Matrix2D) => void;

const applyDrag = (
	current: NodeDrag,
	rawPoint: CanvasPoint,
	constrain: boolean,
	fromCenter: boolean,
	api: HostApi,
	write: MatrixWriter,
): void => {
	if (current.mode === "move") {
		// The move point already carries the snapped + axis-locked delta, so
		// moveMatrix must NOT re-apply the Shift lock (constrain = false).
		const point = snappedMovePoint(rawPoint, current, api, constrain);
		const move = moveMatrix(current.start, point, false);
		for (const snap of current.snapshots) {
			write(
				snap.nodeId,
				localMatrixFromWorld(snap, multiply(move, snap.worldMatrix)),
			);
		}
		return;
	}
	if (current.mode === "rotate") {
		const rotate = rotateMatrix(
			current.center,
			current.start,
			rawPoint,
			constrain,
			current.startAngle,
		);
		for (const snap of current.snapshots) {
			write(
				snap.nodeId,
				localMatrixFromWorld(snap, multiply(rotate, snap.worldMatrix)),
			);
		}
		return;
	}
	// Resize: cursor-point snap (the dragged handle is the cursor), unchanged.
	const point = snappedPoint(rawPoint, current, api);
	if (current.handle === null) return;
	if (applyTextBoxResize(current, point, constrain, fromCenter)) return;
	if (current.single) {
		const snap = current.snapshots[0];
		if (!snap) return;
		write(
			snap.nodeId,
			localMatrixFromWorld(
				snap,
				resizeSingleMatrix(
					snap.worldMatrix,
					snap.bounds,
					current.handle,
					point,
					constrain,
					fromCenter,
				),
			),
		);
		return;
	}
	const group = groupResizeMatrix(
		current.frame,
		current.handle,
		point,
		fromCenter,
	);
	for (const snap of current.snapshots) {
		write(
			snap.nodeId,
			localMatrixFromWorld(snap, multiply(group, snap.worldMatrix)),
		);
	}
};

/** Node ids `applyDrag` writes for the current gesture (move/resize/rotate). */
const draggedNodeIds = (current: NodeDrag): readonly string[] =>
	current.snapshots.map((snapshot) => snapshot.nodeId);

/**
 * Drops any cached snap candidates so the next {@link gestureGuideCandidates} /
 * {@link gesturePointCandidates} call recollects them against the gesture's
 * CURRENT `snapExcludeNodeIds` — called whenever engage/disengage swaps that
 * exclusion set, so the very move that toggled duplicate mode also snaps
 * correctly (never one frame stale).
 */
const invalidateSnapCandidates = (current: NodeDrag): void => {
	current.guideCandidates = null;
	current.pointCandidates = null;
};

/**
 * Move-only Alt/Option-drag-to-duplicate toggle, sampled every pointermove
 * (and once from Alt keydown — see `onKeyDown`) so intent can flip any number
 * of times before pointerup, which alone decides the final outcome. Eligibility
 * is checked lazily (once, via a zero-offset `buildDuplicateCommand` probe) so
 * an ineligible selection (nested children, multi-layer, hidden/locked
 * sources — the same contract `Mod+D` and the Duplicate quick-action use)
 * never re-checks every move and Alt is a silent no-op for it. Engage/disengage
 * both swap `snapExcludeNodeIds` (see `NodeDrag.snapExcludeNodeIds`) and
 * invalidate the cached candidates so the change takes effect on the same
 * move, mirroring Figma's snap-to-original behavior while duplicating.
 */
const syncDuplicateIntent = (
	current: NodeDrag,
	api: HostApi,
	altKey: boolean,
): void => {
	if (current.mode !== "move") return;
	if (current.duplicateEligible === null) {
		if (!altKey) return;
		current.duplicateEligible =
			(api.buildDuplicateCommand?.(draggedNodeIds(current), { x: 0, y: 0 }) ??
				null) !== null;
	}
	if (!current.duplicateEligible) return;
	if (altKey && !current.duplicating) {
		current.duplicating = true;
		current.snapExcludeNodeIds = [];
		invalidateSnapCandidates(current);
		const artboardId = selectArtboardIdForNode(
			api.getDoc(),
			current.snapshots[0]?.nodeId,
		);
		if (artboardId) {
			useLiveTransformStore.getState().setDuplicateIntent({
				artboardId,
				sourceIds: draggedNodeIds(current),
			});
		}
		return;
	}
	if (!altKey && current.duplicating) {
		current.duplicating = false;
		current.snapExcludeNodeIds = draggedNodeIds(current);
		invalidateSnapCandidates(current);
		useLiveTransformStore.getState().clearDuplicateIntent();
	}
};

/** Writes a matrix straight through the host's real scene-store writer. */
const commitWrite =
	(api: HostApi): MatrixWriter =>
	(nodeId, matrix) =>
		api.apply(nodeId, { matrix });

/**
 * Recomputes the gesture's final matrices (same recipe as `finalizeNodeDrag`)
 * without writing them anywhere, so the duplicate commit can derive its offset
 * from the SAME data a normal commit would write. Returns `null` when the drag
 * never crossed the move threshold (`current.live` unset).
 */
const finalGesturePatches = (
	current: NodeDrag,
	api: HostApi,
): readonly NodeMatrixPatch[] | null => {
	if (!current.live) return null;
	const patches: NodeMatrixPatch[] = [];
	applyDrag(
		current,
		current.live.point,
		current.live.constrain,
		current.live.fromCenter,
		api,
		(nodeId, matrix) => patches.push({ nodeId, matrix }),
	);
	return patches;
};

/**
 * Commits the ONE undoable duplicate-insert entry for an Alt/Option-drag that
 * is still in duplicate mode at gesture end. The move gesture's own
 * transaction never received a write (duplicate mode routes geometry through
 * the live-override store, never `api.apply`), so it stays empty and its
 * final `apply` is the duplicate insert; the gesture transaction then commits
 * that insert as one undo entry with the gesture-scoped coalesce key.
 * Returns `false` (and writes nothing) when the drag never crossed the move
 * threshold or duplicate planning fails, so the caller can fall back to the
 * normal move-commit path instead of dead-ending the gesture.
 */
const finalizeDuplicateDrag = (current: NodeDrag, api: HostApi): boolean => {
	const patches = finalGesturePatches(current, api);
	const baseRoot = current.snapshots[0];
	const movedRoot = patches?.find((patch) => patch.nodeId === baseRoot?.nodeId);
	if (!baseRoot || !movedRoot) return false;
	// Move is a uniform pure translation across every dragged root (see
	// `moveMatrix`/`multiply`), so any one root's base-vs-moved position delta
	// is the gesture's delta for all of them.
	const basePosition = transformFromMatrix(baseRoot.matrix, {
		x: 0,
		y: 0,
	}).position;
	const movedPosition = transformFromMatrix(movedRoot.matrix, {
		x: 0,
		y: 0,
	}).position;
	const plan = api.buildDuplicateCommand?.(draggedNodeIds(current), {
		x: movedPosition.x - basePosition.x,
		y: movedPosition.y - basePosition.y,
	});
	if (!plan) return false;
	useSceneStore.getState().apply(plan.command);
	recordDuplicateTransformRepeat({
		sourceMatrices: current.snapshots.map((snapshot) => snapshot.matrix),
		duplicateNodeIds: plan.newRootNodeIds,
		document: useSceneStore.getState().document,
	});
	api.setSelection(plan.newRootNodeIds, plan.newRootNodeIds.at(-1) ?? null);
	return true;
};

/** Outcome of {@link finalizeNodeDrag}, telling the caller which of the three
 * mutually-exclusive finalize paths ran (normal commit, duplicate insert, or
 * Perform hand-off) so it can skip repeat-transform recording appropriately. */
type NodeDragFinalizeResult = {
	readonly duplicated: boolean;
	readonly performed: boolean;
};

/**
 * Replays the gesture's most recent pointermove computation for real, once,
 * against the scene store — this is the ONLY scene-store write a node
 * move/resize/rotate gesture makes. Because `applyDrag` recomputes every
 * snapshot's matrix from the (unchanging) gesture-start snapshot rather than
 * accumulating deltas, replaying the last cached move produces the exact
 * matrix the old per-move write path would have committed on its final move.
 * Always clears the transient override afterward so the committed document
 * and the preview never show different geometry, even if `current.live` is
 * `null` (a drag that never crossed the move threshold).
 *
 * A move gesture still in duplicate mode at this point (`duplicating &&
 * duplicateEligible`) is finalized by {@link finalizeDuplicateDrag} INSTEAD:
 * the originals keep their base transforms (no transform write for them at
 * all) and only the duplicate insert commits. `duplicateIntent` is always
 * cleared here so every finalize seam (pointerup, `cancelActiveGesture`, an
 * orphan flush) drops the ghost pass, matching the transient-override clear
 * right below.
 *
 * A single-node move gesture Perform was armed for (`api.isPerforming`) takes
 * a THIRD, mutually-exclusive path ahead of both of the above: it hands off to
 * {@link HostApi.onPerformCommit} and returns without ever calling
 * `commitWrite`/`api.apply`, so the node's scene transform is left completely
 * untouched — the widget recorder's motion-transaction commit is the only
 * outcome. Every caller's own `useSceneStore` transaction (opened unconditionally
 * the moment the drag crossed the move threshold) is still committed as usual
 * after this returns; committing it with zero patches is a verified no-op (no
 * history entry, no redo-stack wipe — see `SceneStore.commit`), so a Perform
 * gesture's transaction closes cleanly without a special abort path.
 */
const finalizeNodeDrag = (
	current: NodeDrag,
	api: HostApi,
): NodeDragFinalizeResult => {
	const performNodeId =
		api.isPerforming &&
		current.mode === "move" &&
		current.snapshots.length === 1
			? current.snapshots[0]?.nodeId
			: undefined;
	if (performNodeId !== undefined) {
		api.onPerformCommit?.(performNodeId);
		useLiveTransformStore.getState().clearOverrides();
		useLiveTransformStore.getState().clearDuplicateIntent();
		return { duplicated: false, performed: true };
	}
	const duplicated =
		current.duplicating &&
		current.duplicateEligible === true &&
		finalizeDuplicateDrag(current, api);
	if (!duplicated && current.live) {
		applyDrag(
			current,
			current.live.point,
			current.live.constrain,
			current.live.fromCenter,
			api,
			commitWrite(api),
		);
	}
	useLiveTransformStore.getState().clearOverrides();
	useLiveTransformStore.getState().clearDuplicateIntent();
	return { duplicated, performed: false };
};

const applyTextBoxResize = (
	current: NodeDrag,
	point: CanvasPoint,
	constrain: boolean,
	fromCenter: boolean,
): boolean => {
	if (
		current.mode !== "resize" ||
		current.handle === null ||
		current.snapshots.length !== 1
	) {
		return false;
	}
	const snap = current.snapshots[0];
	if (!snap) return false;
	const node = findNode(useSceneStore.getState().document, snap.nodeId);
	if (node?.geometry.kind !== "text") return false;
	const geometry = normalizeTextGeometry(node.geometry);
	if (geometry.mode !== "area") return false;
	const localPoint = applyToPoint(invert(snap.worldMatrix), point);
	const bounds = resizeTextBoxBoundsForHandle(
		snap.bounds,
		localPoint,
		current.handle,
		geometry.style,
		{ constrain, fromCenter },
	);
	useSceneStore.getState().apply(
		createResizeTextBoxCommand(snap.nodeId, {
			mode: "area",
			bounds,
		}),
	);
	return true;
};

const beginDragOnFrame = (
	hit: Extract<HitTarget, { kind: "resize" | "rotate" }>,
	frame: Frame,
	nodes: readonly VectorNode[],
	point: CanvasPoint,
	primary: string | null,
	api: HostApi,
): void => {
	const rotate = hit.kind === "rotate";
	// A layout-managed child's geometry is owned by the layout; ordinary resize
	// routes to cell span handles (CanvasShell) instead, so a resize gesture on a
	// managed node is inert here. Rotation stays a free property the materializer
	// preserves, so a rotate gesture never filters.
	const resizeNodes = rotate
		? nodes
		: withoutLayoutManagedNodes(
				nodes,
				collectLayoutManagedChildIds(api.getDoc()),
			);
	if (resizeNodes.length === 0) return;
	gestureSeq += 1;
	const document = api.getDoc();
	const snapshots = resizeNodes.map((node) => snapshotOf(document, node));
	// A group is one selectable node but must scale UNIFORMLY: a non-uniform scale
	// baked into rotated members on ungroup would shear, which the TRS decompose
	// cannot represent. Route a selected group through the uniform group-resize
	// path (single = false) instead of the per-axis single-node path, keeping group
	// transforms in the similarity class the ungroup bake relies on.
	const groupContainer =
		nodes.length === 1 && Boolean(nodes[0]?.children?.length);
	drag = {
		kind: "nodes",
		mode: rotate ? "rotate" : "resize",
		handle: hit.handle,
		single: frame.oriented && !groupContainer,
		frame,
		center: frame.center,
		// Absolute-angle snap only applies to a single oriented node; a group
		// rotates rigidly, so it snaps the delta (startAngle 0).
		startAngle: rotate && frame.oriented ? startRotationOf(snapshots[0]) : 0,
		snapshots,
		start: point,
		coalesceKey: `select:${primary ?? "multi"}:${gestureSeq}`,
		collapseTo: null,
		dragging: false,
		transactionOpen: false,
		guideCandidates: null,
		pointCandidates: null,
		live: null,
		// Alt-drag-to-duplicate is move-only; resize/rotate never engage it.
		duplicateEligible: null,
		duplicating: false,
		// Perform mode never records resize/rotate (position only, v1).
		performStartMs: null,
		snapExcludeNodeIds: snapshots.map((snapshot) => snapshot.nodeId),
	};
	useTransformUiStore.getState().setActive(targetFromHit(hit));
};

const beginMove = (
	candidateNodes: readonly VectorNode[],
	point: CanvasPoint,
	keySeed: string,
	collapseTo: string | null,
	api: HostApi,
): void => {
	// A layout-managed child's geometry is owned by the layout; ordinary move
	// routes to cell placement (CanvasShell) instead, so a move gesture that
	// would otherwise touch only managed nodes never starts here.
	const moveNodes = withoutLayoutManagedNodes(
		candidateNodes,
		collectLayoutManagedChildIds(api.getDoc()),
	);
	if (moveNodes.length === 0) return;
	const document = api.getDoc();
	const frame = frameFromNodes(moveNodes, frameOptionsFor(document, moveNodes));
	if (!frame) return;
	gestureSeq += 1;
	const snapshots = moveNodes.map((node) => snapshotOf(document, node));
	drag = {
		kind: "nodes",
		mode: "move",
		handle: null,
		single: moveNodes.length === 1,
		frame,
		center: frame.center,
		startAngle: 0,
		snapshots,
		start: point,
		coalesceKey: `select:${keySeed}:${gestureSeq}`,
		collapseTo,
		dragging: false,
		transactionOpen: false,
		guideCandidates: null,
		pointCandidates: null,
		live: null,
		duplicateEligible: null,
		duplicating: false,
		// See the field doc on `NodeDrag.performStartMs`: captured unconditionally
		// here (pointerdown) rather than gated on Perform being armed, so a
		// mid-drag arm (a stray edge case, not a supported flow) still has a
		// start time rather than needing a second capture path.
		performStartMs: performance.now(),
		snapExcludeNodeIds: snapshots.map((snapshot) => snapshot.nodeId),
	};
};

/** Topmost artboard whose pasteboard frame contains the point, else `null`. */
const artboardAtPasteboardPoint = (
	document: SceneDocument,
	point: CanvasPoint,
): string | null => {
	const bounds = selectAllArtboardBounds(document);
	for (let index = bounds.length - 1; index >= 0; index -= 1) {
		const frame = bounds[index];
		if (!frame) continue;
		if (
			point.x >= frame.x &&
			point.x <= frame.x + frame.width &&
			point.y >= frame.y &&
			point.y <= frame.y + frame.height
		) {
			return frame.artboardId;
		}
	}
	return null;
};

/** Pasteboard rect for an artboard id, or `null` if it no longer exists. */
const artboardRectById = (
	document: SceneDocument,
	artboardId: string,
): ArtboardRect | null => {
	const frame = selectAllArtboardBounds(document).find(
		(candidate) => candidate.artboardId === artboardId,
	);
	return frame
		? { x: frame.x, y: frame.y, width: frame.width, height: frame.height }
		: null;
};

const beginArtboardMove = (
	artboardId: string,
	startRect: ArtboardRect,
	startPasteboard: CanvasPoint,
): void => {
	gestureSeq += 1;
	drag = {
		kind: "artboard",
		mode: "move",
		artboardId,
		handle: null,
		startRect,
		start: startPasteboard,
		coalesceKey: `artboard:move:${artboardId}:${gestureSeq}`,
		dragging: false,
		transactionOpen: false,
	};
	useTransformUiStore.getState().setArtboardGesture(true);
};

const beginArtboardResize = (
	artboardId: string,
	startRect: ArtboardRect,
	handle: HandleId,
	startPasteboard: CanvasPoint,
): void => {
	gestureSeq += 1;
	drag = {
		kind: "artboard",
		mode: "resize",
		artboardId,
		handle,
		startRect,
		start: startPasteboard,
		coalesceKey: `artboard:resize:${artboardId}:${handle}:${gestureSeq}`,
		dragging: false,
		transactionOpen: false,
	};
	useTransformUiStore.getState().setArtboardGesture(true);
};

/**
 * Writes a live artboard move/resize through the command bus in pasteboard
 * space. Move applies a position delta (Shift locks to the dominant axis);
 * resize delegates to the pure {@link resizeArtboardRect}. Child nodes are never
 * rewritten — they live in the artboard-local `<g translate(position)>`, so they
 * translate with the frame on a move or an origin-moving resize (documented
 * Figma-frame behavior; content-fixed resize is a separate, deferred change).
 */
const applyArtboardDrag = (
	current: ArtboardDrag,
	pasteboardPoint: CanvasPoint,
	constrain: boolean,
	fromCenter: boolean,
): void => {
	if (current.mode === "move") {
		let dx = pasteboardPoint.x - current.start.x;
		let dy = pasteboardPoint.y - current.start.y;
		if (constrain) {
			if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
			else dx = 0;
		}
		useSceneStore.getState().apply(
			createUpdateArtboardCommand(
				current.artboardId,
				{
					position: {
						x: current.startRect.x + dx,
						y: current.startRect.y + dy,
					},
				},
				{ coalesceKey: current.coalesceKey, label: MOVE_ARTBOARD_LABEL },
			),
		);
		return;
	}
	if (!current.handle) return;
	const next = resizeArtboardRect(
		current.startRect,
		current.handle,
		pasteboardPoint,
		{
			constrain,
			fromCenter,
			minSize: MIN_ARTBOARD_SIZE,
		},
	);
	useSceneStore
		.getState()
		.apply(
			createUpdateArtboardCommand(
				current.artboardId,
				{ position: next.position, width: next.width, height: next.height },
				{ coalesceKey: current.coalesceKey, label: RESIZE_ARTBOARD_LABEL },
			),
		);
};

const dragLabel = (current: Drag): string => {
	if (current.kind === "artboard") {
		return current.mode === "move"
			? MOVE_ARTBOARD_LABEL
			: RESIZE_ARTBOARD_LABEL;
	}
	if (current.kind === "anchor") return ANCHOR_LABEL;
	if (current.kind === "corner-radius") return RADIUS_LABEL;
	return labelFor(current.mode);
};

const beginAnchorDrag = (
	document: SceneDocument,
	node: VectorNode,
	point: CanvasPoint,
	primary: string | null,
): void => {
	gestureSeq += 1;
	drag = {
		kind: "anchor",
		snapshot: snapshotOf(document, node),
		start: point,
		coalesceKey: `select:anchor:${primary ?? node.id}:${gestureSeq}`,
		dragging: false,
		transactionOpen: false,
	};
	useTransformUiStore.getState().setActive({ kind: "anchor" });
};

const beginCornerRadiusDrag = (
	document: SceneDocument,
	corner: CornerHandleId,
	node: VectorNode,
	point: CanvasPoint,
	primary: string | null,
): void => {
	gestureSeq += 1;
	drag = {
		kind: "corner-radius",
		corner,
		snapshot: snapshotOf(document, node),
		start: point,
		coalesceKey: `select:radius:${primary ?? node.id}:${gestureSeq}`,
		dragging: false,
		transactionOpen: false,
	};
	useTransformUiStore
		.getState()
		.setActive({ kind: "corner-radius", handle: corner });
};

/** Maps a corner handle to its per-corner radii key. */
const CORNER_RADII_KEY: Record<CornerHandleId, "tl" | "tr" | "br" | "bl"> = {
	nw: "tl",
	ne: "tr",
	se: "br",
	sw: "bl",
};

/**
 * Applies a corner-radius drag: maps the pointer into the node's local space via
 * the start snapshot's inverse matrix, derives the RAW radius from the corner's
 * edge insets, and writes through the command bus. A plain drag rounds all four
 * corners uniformly; Alt/Option rounds only the dragged corner. The command
 * clamps to bounds; the open transaction coalesces the drag to one undo.
 */
const applyCornerRadiusDrag = (
	current: CornerRadiusDrag,
	point: CanvasPoint,
	alt: boolean,
): void => {
	const localPoint = applyToPoint(invert(current.snapshot.worldMatrix), point);
	const radius = cornerRadiusFromLocalPoint(
		current.snapshot.bounds,
		current.corner,
		localPoint,
	);
	const store = useSceneStore.getState();
	if (alt) {
		store.apply(
			createUpdateRectCornerRadiiCommand(current.snapshot.nodeId, {
				[CORNER_RADII_KEY[current.corner]]: radius,
			}),
		);
		return;
	}
	store.apply(
		createUpdateRectCornerRadiusCommand(current.snapshot.nodeId, radius),
	);
};

const applyAnchorDrag = (
	current: AnchorDrag,
	point: CanvasPoint,
	api: HostApi,
): void => {
	const anchor = applyToPoint(invert(current.snapshot.worldMatrix), point);
	const transform = transformWithAnchorPreservingMatrix(
		current.snapshot.transform,
		anchor,
	);
	api.apply(current.snapshot.nodeId, {
		transform: {
			position: transform.position,
			anchor: transform.anchor,
		},
	});
};

/**
 * Streams the live drag position to the Perform-mode recorder (an optional
 * widget-owned callback — see `HostApi.onPerformSample`) so a single-node move
 * gesture can be captured as x/y keyframes instead of a scene-transform commit.
 * A no-op unless Perform is armed for a single-node move gesture. Reads the
 * SAME patch `onPointerMove` already computed for the live-override write
 * (`patches`), so this never performs a second transform computation and never
 * writes anywhere itself. It decomposes the moved matrix with the node's OWN
 * anchor (from the drag snapshot) so the recorded x/y equal the position a normal
 * move commit would store; matrix patches preserve the anchor, so a `{ x: 0, y: 0 }`
 * decomposition would offset the recording by the pivot term on a rotated/scaled node.
 */
const emitPerformSample = (
	current: NodeDrag,
	patches: readonly NodeMatrixPatch[],
	api: HostApi,
): void => {
	if (!api.isPerforming || !api.onPerformSample) return;
	if (current.mode !== "move" || current.snapshots.length !== 1) return;
	const snapshot = current.snapshots[0];
	const startMs = current.performStartMs;
	if (!snapshot || startMs === null) return;
	const nodeId = snapshot.nodeId;
	const patch = patches.find((candidate) => candidate.nodeId === nodeId);
	if (!patch) return;
	// Decompose with the node's OWN anchor so the recorded x/y equal the position a
	// normal move commit stores (matrix patches preserve the anchor); a {0,0}
	// decomposition offsets the recording by the pivot term on a rotated/scaled node.
	const position = transformFromMatrix(
		patch.matrix,
		snapshot.transform.anchor,
	).position;
	api.onPerformSample(
		nodeId,
		position.x,
		position.y,
		performance.now() - startMs,
	);
};

const onPointerDown = (context: PointerContext, api: HostApi): void => {
	lastApi = api;
	flushOrphanedTransaction(api);
	drag = null;
	marquee = null;
	clearActiveGuideSnap();
	useTransformUiStore.getState().setActive(null);
	useTransformUiStore.getState().setArtboardGesture(false);

	const document = api.getDoc();
	const scale = screenScale(api);
	const selectedArtboardId = api.selection.selectedArtboardId;

	// A selected artboard's resize handles win over any node beneath them, so the
	// frame is always grabbable. Hit-test in PASTEBOARD space: handles sit on the
	// frame edges (outside the body), and the selected artboard may not be the one
	// the cursor's artboard-local `point` was resolved against.
	if (selectedArtboardId) {
		const rect = artboardRectById(document, selectedArtboardId);
		if (rect) {
			const artboardHit = classifyArtboardHit(
				context.pasteboardPoint,
				rect,
				HANDLE_HIT_PX / scale,
			);
			if (artboardHit.kind === "resize") {
				beginArtboardResize(
					selectedArtboardId,
					rect,
					artboardHit.handle,
					context.pasteboardPoint,
				);
				return;
			}
		}
	}

	const hitNodeId = canvasSelectionTargetId(
		document,
		context.runtime3dHitResolved
			? context.hitNodeId
			: hitTestNodeId(document, context.point, {
					tolerance: selectionHitTolerance(api),
				}),
	);
	const nodes = selectedNodes(api);
	const frame = frameFromNodes(nodes, frameOptionsFor(document, nodes));
	const bounds = artboardRotationBounds(document);
	const hit: HitTarget = frame
		? classifyHit(
				context.point,
				frame,
				HANDLE_HIT_PX / scale,
				ROTATE_HANDLE_OFFSET_PX / scale,
				bounds,
				hitOptionsFor(document, nodes, scale),
			)
		: { kind: "none" };

	if (frame && (hit.kind === "resize" || hit.kind === "rotate")) {
		beginDragOnFrame(
			hit,
			frame,
			nodes,
			context.point,
			api.selection.primary,
			api,
		);
		return;
	}

	if (frame && hit.kind === "anchor") {
		const node = nodes[0];
		if (node) {
			beginAnchorDrag(document, node, context.point, api.selection.primary);
		}
		return;
	}

	if (frame && hit.kind === "corner-radius") {
		const node = nodes[0];
		if (node) {
			beginCornerRadiusDrag(
				document,
				hit.handle,
				node,
				context.point,
				api.selection.primary,
			);
		}
		return;
	}

	// A node always beats the artboard background beneath it.
	if (hitNodeId) {
		const id = hitNodeId;
		const hitNode = findNode(document, id);
		if (
			hitNode?.geometry.kind === "text" &&
			isUnmodifiedDoubleClick(context.event) &&
			api.editTextNode(id)
		) {
			return;
		}
		if (context.event.shiftKey) {
			api.select(id, true);
			return;
		}
		const selectedIds = api.selection.nodeIds;
		const clickedTransformable = transformableSelectionNodes(document, [id]);
		if (selectedIds.includes(id)) {
			const collapseTo = selectedIds.length > 1 ? id : null;
			if (clickedTransformable.length > 0 && nodes.length > 0) {
				beginMove(nodes, context.point, id, collapseTo, api);
			} else if (collapseTo) {
				api.select(id, false);
			}
			return;
		}
		api.select(id, false);
		const node = clickedTransformable[0];
		if (node) beginMove([node], context.point, id, null, api);
		return;
	}

	// No node hit. Dragging the already-selected artboard's body moves it; any
	// other empty press arms a marquee. A plain click (no drag) clears selection;
	// a drag marquee-selects child nodes. An artboard is never selected from an
	// empty-interior click — it is selectable only via its name label (select
	// tool), so incidental clicks can't steal focus onto the artboard.
	const overArtboardId = artboardAtPasteboardPoint(
		document,
		context.pasteboardPoint,
	);
	if (overArtboardId && overArtboardId === selectedArtboardId) {
		const rect = artboardRectById(document, overArtboardId);
		if (rect) {
			beginArtboardMove(overArtboardId, rect, context.pasteboardPoint);
			return;
		}
	}

	marquee = {
		origin: context.point,
		additive: context.event.shiftKey,
		base: context.event.shiftKey ? api.selection.nodeIds : [],
	};
};

const onPointerMove = (context: PointerContext, api: HostApi): void => {
	lastApi = api;
	const scale = screenScale(api);
	if (drag) {
		const current = drag;
		// Artboard gestures live in pasteboard space; node gestures in the
		// resolved artboard's local space. The threshold must use the matching one.
		const reference =
			current.kind === "artboard" ? context.pasteboardPoint : context.point;
		const movedPx =
			Math.hypot(reference.x - current.start.x, reference.y - current.start.y) *
			scale;
		if (!current.dragging && movedPx < DRAG_THRESHOLD_PX) return;
		if (!current.dragging) {
			current.dragging = true;
			useSceneStore
				.getState()
				.beginTransaction(current.coalesceKey, dragLabel(current));
			current.transactionOpen = true;
			if (current.kind === "nodes" && current.mode === "move") {
				useTransformUiStore.getState().setActive({ kind: "move" });
			}
		}
		if (current.kind === "artboard") {
			applyArtboardDrag(
				current,
				context.pasteboardPoint,
				context.event.shiftKey,
				context.event.altKey,
			);
			return;
		}
		if (current.kind === "corner-radius") {
			applyCornerRadiusDrag(current, context.point, context.event.altKey);
			setCursor(context.event, "pointer");
			return;
		}
		if (current.kind === "anchor") {
			applyAnchorDrag(current, context.point, api);
			setCursor(context.event, "grabbing");
			return;
		}
		// Alt/Option toggles duplicate-drag intent on every move (see
		// `syncDuplicateIntent`); a no-op outside move mode or an ineligible
		// selection. Sampled before `applyDrag` so an engage/disengage on THIS
		// move already sees its swapped snap-exclusion set below.
		syncDuplicateIntent(current, api, context.event.altKey);
		// Compute the would-be node matrices PURELY (no scene-store write): collect
		// them into the transient override store instead of `api.apply`, so a drag
		// never triggers the document-subscribed render cascade. `api.getDoc()` is
		// the gesture's stable pre-drag document — it does not change mid-drag
		// anymore, since nothing writes `useSceneStore` until gesture end.
		const patches: NodeMatrixPatch[] = [];
		applyDrag(
			current,
			context.point,
			context.event.shiftKey,
			context.event.altKey,
			api,
			(nodeId, matrix) => patches.push({ nodeId, matrix }),
		);
		current.live = {
			point: context.point,
			constrain: context.event.shiftKey,
			fromCenter: context.event.altKey,
		};
		useLiveTransformStore
			.getState()
			.setOverrides(computeLiveTransformOverrides(api.getDoc(), patches));
		emitPerformSample(current, patches, api);
		setCursor(
			context.event,
			cursorFor(hitForDrag(current), current.frame, true),
		);
		return;
	}
	if (marquee) {
		useTransformUiStore
			.getState()
			.setMarquee(normalizeRect(marquee.origin, context.point));
		return;
	}

	// Track the unselected node under the cursor for the hover outline (null over
	// empty canvas). The drag/marquee branches return above, so this only runs on
	// an idle hover; the overlay suppresses the outline during a gesture.
	useTransformUiStore.getState().setHoveredNode(
		canvasSelectionTargetId(
			api.getDoc(),
			hitTestNodeId(api.getDoc(), context.point, {
				tolerance: SELECTION_HIT_TOLERANCE_PX / scale,
			}),
		),
	);

	const nodes = selectedNodes(api);
	const document = api.getDoc();
	const frame = frameFromNodes(nodes, frameOptionsFor(document, nodes));
	if (!frame) {
		useTransformUiStore.getState().setHover(null);
		setCursor(context.event, "default");
		return;
	}
	const hit = classifyHit(
		context.point,
		frame,
		HANDLE_HIT_PX / scale,
		ROTATE_HANDLE_OFFSET_PX / scale,
		artboardRotationBounds(document),
		hitOptionsFor(document, nodes, scale),
	);
	useTransformUiStore.getState().setHover(targetFromHit(hit));
	setCursor(context.event, cursorFor(hit, frame, false));
};

const onPointerUp = (context: PointerContext, api: HostApi): void => {
	const scale = screenScale(api);
	if (drag) {
		const current = drag;
		drag = null;
		if (current.dragging) {
			let duplicated = false;
			let performed = false;
			// The one-and-only scene-store write for a node move/resize/rotate
			// gesture: replay the last live computation for real, then drop the
			// transient preview. React batches this with the `commit()` below, so
			// the overlay/canvas swap from override to committed document with no
			// flicker frame. (A move gesture still in duplicate mode here instead
			// commits ONE duplicate-insert entry and leaves the originals' transforms
			// untouched — see `finalizeNodeDrag`/`finalizeDuplicateDrag` — in which
			// case the `commit()` below seals that duplicate insert transaction. A
			// Perform-armed single-node move instead hands off to the widget's
			// motion recorder and writes no scene transform at all — see
			// `finalizeNodeDrag`'s Perform branch.)
			if (current.kind === "nodes") {
				const result = finalizeNodeDrag(current, api);
				duplicated = result.duplicated;
				performed = result.performed;
			}
			if (current.transactionOpen) useSceneStore.getState().commit();
			if (current.kind === "nodes" && !duplicated && !performed) {
				recordNodeTransformRepeat(
					current.snapshots,
					useSceneStore.getState().document,
					labelFor(current.mode),
				);
			}
			// A committed rotation re-orients the artwork, so an upright box no
			// longer matches it; drop axis-aligned mode to restore the oriented
			// frame (and its full shear-free edge handles), mirroring Illustrator.
			if (current.kind === "nodes" && current.mode === "rotate") {
				const ui = useTransformUiStore.getState();
				for (const snap of current.snapshots) ui.clearMode(snap.nodeId);
			}
		} else if (current.kind === "nodes" && current.collapseTo) {
			api.select(current.collapseTo, false);
		}
		clearActiveGuideSnap();
		useTransformUiStore.getState().setActive(null);
		useTransformUiStore.getState().setArtboardGesture(false);
		return;
	}
	if (!marquee) return;
	const current = marquee;
	marquee = null;
	useTransformUiStore.getState().setMarquee(null);
	const movedPx =
		Math.hypot(
			context.point.x - current.origin.x,
			context.point.y - current.origin.y,
		) * scale;
	if (movedPx < DRAG_THRESHOLD_PX) {
		// A plain click (no drag) over empty canvas clears selection — inside an
		// artboard interior or on the bare pasteboard alike. Artboards are selected
		// only via their name label (select tool), never an incidental interior
		// click. Shift-click stays a node-additive no-op.
		if (!current.additive) api.clearSelection();
		return;
	}
	const rect = normalizeRect(current.origin, context.point);
	const document = api.getDoc();
	// Marquee returns every intersecting spatial entry, including a group's members
	// (whose own bounds sit inside the group). Resolve each hit to its outermost
	// group ancestor and dedupe so a marquee selects groups as a unit — and never
	// the group AND its children together, which would move members twice.
	const ids = [
		...new Set(
			marqueeNodeIds(document, rect)
				.map((id) => canvasSelectionTargetId(document, id))
				.filter((id): id is string => id !== null),
		),
	];
	if (current.additive) {
		api.setSelection([...new Set([...current.base, ...ids])]);
		return;
	}
	api.setSelection(ids);
};

const onKeyDown = (event: SelectKeyEvent, api: HostApi): void => {
	if (event.key === "Escape") {
		if (drag) {
			const current = drag;
			drag = null;
			clearActiveGuideSnap();
			useTransformUiStore.getState().setActive(null);
			useTransformUiStore.getState().setArtboardGesture(false);
			// A node move/resize/rotate under the live-override path never wrote
			// `useSceneStore` mid-drag, so its transaction is still empty here —
			// dropping the transient preview already reverts the visible geometry.
			// Committing it would create a no-op history entry and (worse) wipe any
			// pending redo stack, so it must be discarded via `abortTransaction`,
			// never `commit`. Other gestures (artboard move/resize, corner-radius,
			// text-box area resize) still write per move, so their transaction DOES
			// carry real patches here; those keep the original commit-then-undo
			// abort, which reverts them through the same seam pointerup/pointercancel
			// use, landing one (immediately-undone) history entry. Escape cancels
			// duplicate intent too — nothing was ever inserted, so there is no undo
			// entry to unwind for it.
			if (current.kind === "nodes") {
				useLiveTransformStore.getState().clearOverrides();
				useLiveTransformStore.getState().clearDuplicateIntent();
			}
			if (current.transactionOpen) {
				const store = useSceneStore.getState();
				if ((store.transaction?.patches.length ?? 0) > 0) {
					store.commit();
					store.undo();
				} else {
					store.abortTransaction();
				}
				return;
			}
		}
		api.clearSelection();
		return;
	}
	// Alt keydown during an active node-move drag engages duplicate intent
	// immediately, rather than waiting for the next pointermove to sample
	// `event.altKey` (pointermove sampling alone would leave a visible lag if
	// the pointer is momentarily still). Disengage has no keyup channel in the
	// handler contract (see `syncDuplicateIntent`), so it stays pointermove-only.
	if (
		event.key === "Alt" &&
		drag?.kind === "nodes" &&
		drag.mode === "move" &&
		drag.dragging
	) {
		syncDuplicateIntent(drag, api, true);
		return;
	}
	if (event.metaKey || event.ctrlKey || event.altKey) return;
	if (drag || marquee) return;
	if (event.key === "Enter") {
		const primary = api.selection.primary;
		if (primary && api.editTextNode(primary)) event.preventDefault();
		return;
	}
	const selectedArtboardId = api.selection.selectedArtboardId;
	if (event.key === "Backspace" || event.key === "Delete") {
		if (selectedArtboardId) {
			// An editor must always keep at least one artboard — every renderer,
			// exporter, and selector assumes one exists. Hard-block the last delete
			// (undo is not sufficient protection against a zero-artboard document).
			if (selectAllArtboards(api.getDoc()).length <= 1) return;
			event.preventDefault();
			useSceneStore
				.getState()
				.apply(createRemoveArtboardCommand(selectedArtboardId));
			api.selectArtboard(null);
			return;
		}
		const nodeIds = [...api.selection.nodeIds];
		if (nodeIds.length === 0) return;
		event.preventDefault();
		useSceneStore.getState().apply(createDeleteNodesCommand(nodeIds));
		api.clearSelection();
		return;
	}
	const delta = nudgeDelta(event.key, event.shiftKey);
	if (!delta) return;
	if (selectedArtboardId) {
		const rect = artboardRectById(api.getDoc(), selectedArtboardId);
		if (!rect) return;
		event.preventDefault();
		const now = Date.now();
		if (now - lastNudgeAt > NUDGE_COALESCE_MS) nudgeSeq += 1;
		lastNudgeAt = now;
		const store = useSceneStore.getState();
		store.beginTransaction(
			`artboard:nudge:${selectedArtboardId}:${nudgeSeq}`,
			NUDGE_LABEL,
		);
		store.apply(
			createUpdateArtboardCommand(selectedArtboardId, {
				position: { x: rect.x + delta.dx, y: rect.y + delta.dy },
			}),
		);
		store.commit();
		return;
	}
	const nodes = selectedNodes(api);
	if (nodes.length === 0) return;
	event.preventDefault();
	const now = Date.now();
	const startsNewBurst = now - lastNudgeAt > NUDGE_COALESCE_MS;
	if (startsNewBurst) nudgeSeq += 1;
	lastNudgeAt = now;
	const store = useSceneStore.getState();
	store.beginTransaction(
		`select:nudge:${api.selection.primary ?? "multi"}:${nudgeSeq}`,
		NUDGE_LABEL,
	);
	const move = translation(delta.dx, delta.dy);
	const document = api.getDoc();
	for (const node of nodes) {
		const snapshot = snapshotOf(document, node);
		api.apply(node.id, {
			matrix: localMatrixFromWorld(
				snapshot,
				multiply(move, snapshot.worldMatrix),
			),
		});
	}
	store.commit();
	const repeatKey = api.selection.nodeIds.join("\0");
	nudgeRepeatBurst =
		startsNewBurst ||
		nudgeRepeatBurst.seq !== nudgeSeq ||
		nudgeRepeatBurst.key !== repeatKey
			? { seq: nudgeSeq, key: repeatKey, dx: delta.dx, dy: delta.dy }
			: {
					seq: nudgeSeq,
					key: repeatKey,
					dx: nudgeRepeatBurst.dx + delta.dx,
					dy: nudgeRepeatBurst.dy + delta.dy,
				};
	recordSelectionMatrixRepeatTransform(
		translation(nudgeRepeatBurst.dx, nudgeRepeatBurst.dy),
		NUDGE_LABEL,
		useSceneStore.getState().document,
		api.selection.nodeIds,
	);
};

export const handler: SelectToolHandler = {
	id: "select-transform",
	tool: "select",
	onPointerDown,
	onPointerMove,
	onPointerUp,
	onKeyDown,
	onDeactivate: (api) => cancelActiveGesture(api),
};

/**
 * Seals any in-flight gesture immediately. The host exposes no pointercancel
 * seam, so the overlay calls this on window `pointercancel`/`blur` to commit an
 * interrupted drag (keeping it as one recoverable undo entry) and clear
 * transient UI state, instead of waiting for the next pointerdown to self-heal.
 * A "nodes" drag finalizes its one real scene-store write first, mirroring
 * `onPointerUp`, so the interrupted drag's progress lands instead of vanishing.
 * `api` defaults to the last one this module observed (`onDeactivate` always
 * has a fresh one to pass; the window listener in `overlay.tsx` does not).
 */
export const cancelActiveGesture = (api: HostApi | null = lastApi): void => {
	if (drag?.kind === "nodes" && drag.dragging) {
		if (api) {
			finalizeNodeDrag(drag, api);
		} else {
			useLiveTransformStore.getState().clearOverrides();
			useLiveTransformStore.getState().clearDuplicateIntent();
		}
	}
	if (drag?.transactionOpen) useSceneStore.getState().commit();
	drag = null;
	marquee = null;
	clearActiveGuideSnap();
	useTransformUiStore.getState().reset();
};
