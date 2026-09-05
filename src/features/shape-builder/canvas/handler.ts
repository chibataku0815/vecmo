import {
	composeMatrix,
	IDENTITY_MATRIX,
	type Matrix2D,
	matrixFromTransform,
} from "@/entities/scene/model/rendering";
import {
	flattenRenderableNodes,
	type RenderableNodeEntry,
} from "@/entities/scene/model/selectors";
import type { SceneDocument, VectorNode } from "@/entities/scene/model/types";
import { useColorRecents } from "@/shared/color/recents";
import {
	type ArrangeSource,
	arrange,
	type Pt,
	type ShapeBuilderFace,
} from "../model/arrangement";
import {
	applyShapeBuilderOp,
	deleteShapeBuilderTarget,
	type ShapeBuilderGeneratedStyle,
	type ShapeBuilderMode,
} from "../model/command";
import { nodeToArrangeSource } from "../model/geometry-prep";
import { faceAtTracePoint, facesAlongTraceSegment } from "../model/hit-test";
import {
	buildShapeBuilderFaceGeometries,
	shapeBuilderPathDForGeometries,
} from "../model/output-geometry";
import {
	buildShapeBuilderPalette,
	cycleShapeBuilderSwatch,
} from "../model/palette";
import { useShapeBuilderStore } from "../model/store";

// A gesture is a "click" (precise single-region pick) until the pointer travels
// past this many screen px; only then does it accumulate more faces. Keeps a click
// from grabbing neighbours on a jittery press.
const DRAG_THRESHOLD_PX = 4;
// Screen-px spacing at which the drag path is resampled for face hit-testing, so a
// fast stroke never skips a region between pointer-move events.
const SAMPLE_STEP_PX = 5;
// Illustrator-style stroke tolerance: tracing close to an existing seam/path should
// still collect the adjacent faces instead of requiring a perfect interior hit.
const TRACE_RADIUS_PX = 7;
const screenToLocal = (px: number, zoom: number): number =>
	px / Math.max(zoom / 100, 0.001);

// Local structural mirror of the canvas registry surface (features cannot import
// widget-layer types; the host passes a compatible superset of HandlerApi).
type LocalToolId = "select" | "shape-builder";
type CanvasPoint = { readonly x: number; readonly y: number };
type PointerContext = {
	readonly point: CanvasPoint;
	readonly hitNodeId: string | null;
	readonly hitStackNodeIds: readonly string[];
	readonly event: PointerEvent;
};
type HostApi = {
	readonly getDoc: () => SceneDocument;
	readonly viewport: { readonly zoom: number };
	readonly selection: {
		readonly nodeIds: readonly string[];
		readonly primary: string | null;
	};
	readonly setSelection: (
		nodeIds: readonly string[],
		primary?: string | null,
	) => void;
	readonly setActiveTool: (tool: LocalToolId) => void;
};
type ShapeBuilderHandler = {
	readonly id: string;
	readonly tool: LocalToolId;
	readonly onPointerDown: (context: PointerContext, api: HostApi) => void;
	readonly onPointerMove: (context: PointerContext, api: HostApi) => void;
	readonly onPointerUp: (context: PointerContext, api: HostApi) => void;
	readonly onKeyDown?: (event: KeyboardEvent, api: HostApi) => void;
	readonly onActivate?: (api: HostApi) => void;
	readonly onDeactivate?: (api: HostApi) => void;
};

// Recompute is gated on the selection set + document identity, never per move.
let lastDoc: SceneDocument | null = null;
let lastSelKey = "";
let gesture: {
	readonly pointerId: number;
	readonly marquee: boolean;
	readonly start: Pt;
	/** Flips true once the pointer passes DRAG_THRESHOLD — a click stays false. */
	engaged: boolean;
	mouseDownSourceId: string | null;
} | null = null;

/**
 * Armed on Alt+pointerdown when the hit lands on an editable shape that is NOT
 * part of the current arrangement's sources — a plain (non-drag) release then
 * deletes that whole shape via `deleteShapeBuilderTarget`. Cleared whenever the
 * matching pointer travels past the drag threshold (see `onPointerMove`) or
 * resolves/cancels on `onPointerUp`, so it can never leak into a later,
 * unrelated gesture. No `gesture` object is created for an armed pointer (the
 * mesh's own drag/marquee gesture stays untouched), so `start` is tracked here
 * to detect the same drag-threshold crossing `gesture.engaged` would.
 */
let pendingAltDelete: {
	readonly pointerId: number;
	readonly nodeId: string;
	readonly start: Pt;
} | null = null;

const keyOf = (nodeIds: readonly string[]): string =>
	[...nodeIds].sort().join(",");

type ShapeBuilderSourceEntry = {
	readonly id: string;
	readonly source: ArrangeSource;
};

const hasChildren = (node: VectorNode): boolean =>
	(node.children?.length ?? 0) > 0;

const worldMatrixForEntry = (
	entry: RenderableNodeEntry,
	entriesById: ReadonlyMap<string, RenderableNodeEntry>,
): Matrix2D => {
	let matrix = IDENTITY_MATRIX;
	for (const parentId of entry.parentIds) {
		const parent = entriesById.get(parentId);
		if (!parent) continue;
		matrix = composeMatrix(matrix, matrixFromTransform(parent.node.transform));
	}
	return composeMatrix(matrix, matrixFromTransform(entry.node.transform));
};

const shapeBuilderSourceEntries = (
	document: SceneDocument,
	nodeIds: readonly string[],
): readonly ShapeBuilderSourceEntry[] => {
	const selectedIds = new Set(nodeIds);
	if (selectedIds.size === 0) return [];
	const renderableEntries = flattenRenderableNodes(document);
	const entriesById = new Map(
		renderableEntries.map((entry) => [entry.node.id, entry] as const),
	);
	const sources: ShapeBuilderSourceEntry[] = [];
	const seen = new Set<string>();
	for (const entry of renderableEntries) {
		if (entry.locked || seen.has(entry.node.id)) continue;
		if (!selectedIds.has(entry.node.id)) continue;
		// Container children need parent-aware replacement and parent-local output
		// rebasing. Until that lands, Shape Builder is restricted to top-level leaf
		// nodes so it never hoists partial group/frame/blend edits out of their owner.
		if (entry.parentIds.length > 0 || hasChildren(entry.node)) continue;
		const source = nodeToArrangeSource(
			entry.node,
			worldMatrixForEntry(entry, entriesById),
		);
		if (!source) continue;
		seen.add(entry.node.id);
		sources.push({ id: entry.node.id, source });
	}
	return sources;
};

const shapeBuilderSourceIds = (
	document: SceneDocument,
	nodeIds: readonly string[],
): readonly string[] =>
	shapeBuilderSourceEntries(document, nodeIds).map((entry) => entry.id);

const firstShapeBuilderSourceIdInHitOrder = (
	document: SceneDocument,
	hitNodeIds: readonly string[],
	alreadyArranged: ReadonlySet<string>,
): string | null => {
	for (const hitNodeId of hitNodeIds) {
		const sourceIds = shapeBuilderSourceIds(document, [hitNodeId]);
		if (sourceIds.length === 0) continue;
		const sourceId = sourceIds.find((id) => !alreadyArranged.has(id));
		if (sourceId) return sourceId;
		// The frontmost usable source is already in the mesh. A face-hit miss on
		// existing mesh art is a no-op for whole-shape add/delete, not permission to
		// pierce through and modify a hidden source behind it.
		return null;
	}
	return null;
};

/**
 * Cheap per-move cache key: the raw selected node ids, NOT the derived source
 * expansion. For a fixed document, `shapeBuilderSourceEntries` is a pure
 * function of the selected node ids, so (doc, selected ids) alone determines
 * whether a recompute is needed — deriving the actual source list (full
 * flattenRenderableNodes + nodeToArrangeSource Bézier-flattening per node) is
 * only necessary when a recompute is actually going to happen, inside
 * `computeArrangement`. Using this as the sole per-move cost (see `ensureArrangement`)
 * is what keeps idle pointermove O(selection size) instead of O(full expansion).
 */
const rawSelectionKey = (api: HostApi): string => keyOf(api.selection.nodeIds);

/**
 * Recomputes the arrangement for an EXPLICIT node id list and stores it. Callers
 * that just mutated the selection pass the new ids directly rather than re-reading
 * `api.selection` (a per-render snapshot that would lag a frame behind
 * `setSelection`), so the mesh appears immediately. The tool is live from ONE
 * source upward — a single node (e.g. the compound node a merge just produced)
 * arranges on its own, so Alt-click/drag can immediately erase regions of it or
 * a plain click can extract a region, without forcing a return to a two-object
 * selection. Only ZERO fillable sources → a "needs-source" prompt state.
 *
 * `lastSelKey` is cached as `keyOf(nodeIds)` (the raw ids this call was given),
 * matching `rawSelectionKey`'s cache-key shape, so the next `ensureArrangement`
 * call (which reads `api.selection.nodeIds`) compares like-for-like. The
 * store's own `signature` field keeps the more semantically meaningful derived
 * source-id key, since nothing outside this module reads it for comparison.
 */
const computeArrangement = (api: HostApi, nodeIds: readonly string[]): void => {
	const doc = api.getDoc();
	const sourceEntries = shapeBuilderSourceEntries(doc, nodeIds);
	const derivedSelKey = keyOf(sourceEntries.map((entry) => entry.id));
	lastDoc = doc;
	lastSelKey = keyOf(nodeIds);
	const store = useShapeBuilderStore.getState();
	const sources = sourceEntries.map((entry) => entry.source);

	if (sources.length === 0) {
		store.setArrangement(null, derivedSelKey, "shape-builder.needs-source");
		return;
	}
	const result = arrange(sources, { gapTolerance: gapToleranceFor(sources) });
	store.setArrangement(
		result.ok ? result : null,
		derivedSelKey,
		result.ok ? null : result.error,
	);
};

/**
 * Recomputes ONLY when the document identity or the raw selection actually
 * changed since the last COMPUTATION — success or failure alike. A failed or
 * empty arrange (`store.arrangement === null`) is a valid cached outcome, not a
 * signal to keep retrying: without this, any needs-source/error state would
 * re-run the full source derivation + a fresh `arrange()` call on every single
 * pointermove for as long as the selection stays in that state (a full-arrange
 * thrash loop, worst on large compounds). Post-commit invalidation
 * (`lastDoc = null`) and `resetGesture` (both clear `lastDoc`/`lastSelKey`)
 * still force the next call through.
 */
const ensureArrangement = (api: HostApi): void => {
	const doc = api.getDoc();
	const selKey = rawSelectionKey(api);
	if (doc === lastDoc && selKey === lastSelKey) return;
	computeArrangement(api, api.selection.nodeIds);
};

// Adaptive gap-detection tolerance (Illustrator-style gap closing) scaled to the
// selection size and clamped, so hairline-to-small gaps bridge without over-merging
// shapes placed near each other on purpose. A user-facing preset/slider is deferred;
// this is a sensible built-in default.
const GAP_MIN = 4;
const GAP_MAX = 24;
const gapToleranceFor = (
	sources: readonly { readonly rings: readonly (readonly Pt[])[] }[],
): number => {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const s of sources)
		for (const ring of s.rings)
			for (const p of ring) {
				minX = Math.min(minX, p.x);
				minY = Math.min(minY, p.y);
				maxX = Math.max(maxX, p.x);
				maxY = Math.max(maxY, p.y);
			}
	const diag = Math.hypot(maxX - minX, maxY - minY);
	return Math.min(GAP_MAX, Math.max(GAP_MIN, diag * 0.02));
};

/** Dominant covering source of a face (proxy for Illustrator's mouse-down art style). */
const dominantSource = (face: ShapeBuilderFace | null): string | null =>
	face?.coveredBy[0] ?? null;

const faceBboxCenter = (face: ShapeBuilderFace): Pt => {
	let minX = Infinity,
		minY = Infinity,
		maxX = -Infinity,
		maxY = -Infinity;
	for (const p of face.ring) {
		minX = Math.min(minX, p.x);
		minY = Math.min(minY, p.y);
		maxX = Math.max(maxX, p.x);
		maxY = Math.max(maxY, p.y);
	}
	return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
};

const insideRect = (p: Pt, a: Pt, b: Pt): boolean =>
	p.x >= Math.min(a.x, b.x) &&
	p.x <= Math.max(a.x, b.x) &&
	p.y >= Math.min(a.y, b.y) &&
	p.y <= Math.max(a.y, b.y);

type ShapeBuilderStoreState = ReturnType<typeof useShapeBuilderStore.getState>;

/**
 * Idle-move write guards: `onPointerMove` fires on every pixel of pointer
 * travel, but `store.setMode`/`setOperationIntent`/`setHovered` write
 * unconditionally, each triggering a Zustand notify (and downstream React
 * re-render) even when the value is unchanged from the previous move — e.g.
 * hovering the same face, or moving without Alt toggling. Reading current
 * state first and skipping a no-op write keeps idle hover cheap regardless of
 * how densely pointermove fires. `setHoverPoint` intentionally has no guard:
 * the badge follows the cursor by design, so its position changes every move.
 */
const setModeIfChanged = (
	store: ShapeBuilderStoreState,
	mode: ShapeBuilderMode,
): void => {
	if (store.mode !== mode) store.setMode(mode);
};

const setOperationIntentIfChanged = (
	store: ShapeBuilderStoreState,
	intent: Parameters<ShapeBuilderStoreState["setOperationIntent"]>[0],
): void => {
	if (store.operationIntent !== intent) store.setOperationIntent(intent);
};

const setHoveredIfChanged = (
	store: ShapeBuilderStoreState,
	faceId: string | null,
): void => {
	if (store.hoveredFaceId !== faceId) store.setHovered(faceId);
};

const traceTolerance = (api: HostApi): number =>
	screenToLocal(TRACE_RADIUS_PX, api.viewport.zoom);

const generatedStyleForGesture = (): ShapeBuilderGeneratedStyle => {
	const store = useShapeBuilderStore.getState();
	return store.paintMode === "swatch"
		? { kind: "solid-fill", fill: store.activeFill, strokePolicy: "none" }
		: { kind: "inherit-artwork" };
};

const cycleActiveSwatch = (
	api: HostApi,
	direction: -1 | 1,
	step: number,
): boolean => {
	const store = useShapeBuilderStore.getState();
	if (store.paintMode !== "swatch") return false;
	const doc = api.getDoc();
	const palette = buildShapeBuilderPalette({
		document: doc,
		nodeIds: shapeBuilderSourceIds(doc, api.selection.nodeIds),
		recents: useColorRecents.getState().recents,
	});
	const next = cycleShapeBuilderSwatch({
		palette,
		activeFill: store.activeFill,
		activeSwatchIndex: store.activeSwatchIndex,
		direction,
		step,
	});
	store.setActiveFill(next.fill, next.index);
	return true;
};

const onPointerDown = (context: PointerContext, api: HostApi): void => {
	if (context.event.button !== 0) return;
	ensureArrangement(api);
	const store = useShapeBuilderStore.getState();
	store.clearLastCommit(); // starting a new gesture retires any prior commit flash
	store.clearCleanupCandidates(); // cleanup belongs only to the last completed extract
	const arr = store.arrangement;
	const marquee = context.event.shiftKey;
	const face = arr
		? faceAtTracePoint(arr.faces, context.point, traceTolerance(api))
		: null;

	// No operable face hit, no marquee: either arm a consecutive Alt-click delete
	// (Alt held, target outside the current arrangement) or fall back to the
	// stay-in-tool "add to working set" behaviour (plain click). Both branches
	// resolve the same top hit-stack shape to an editable, not-yet-arranged
	// source id — only what happens with that id differs by Alt.
	if (!marquee && !face) {
		const doc = api.getDoc();
		const already = new Set(arr?._dcel.sources.map((s) => s.id) ?? []);
		const hitNodeIds =
			context.hitStackNodeIds.length > 0
				? context.hitStackNodeIds
				: context.hitNodeId
					? [context.hitNodeId]
					: [];
		const id = firstShapeBuilderSourceIdInHitOrder(doc, hitNodeIds, already);
		if (id && context.event.altKey) {
			// Arm only — the actual delete resolves on pointer UP of a true click
			// (see onPointerUp), so an Alt-drag that turns into a marquee/trace
			// gesture never deletes. onPointerMove cancels this if the drag engages.
			pendingAltDelete = {
				pointerId: context.event.pointerId,
				nodeId: id,
				start: context.point,
			};
			return;
		}
		if (id) {
			// Plain (non-Alt) click on a shape outside the arrangement: unchanged
			// stay-in-tool selection. Recompute from the KNOWN new ids so the mesh
			// appears at once (api.selection lags a frame).
			const current = api.selection.nodeIds;
			const next = current.includes(id) ? [...current] : [...current, id];
			api.setSelection(next, id);
			computeArrangement(api, next);
			return;
		}
		if (!arr) return; // empty click with nothing selected — nothing to do
	}
	if (!arr) return;

	store.setMode(context.event.altKey ? "erase" : "merge");
	store.setOperationIntent(
		context.event.altKey ? "erase" : marquee ? "merge" : "extract",
	);
	store.setHoverPoint(context.point);
	gesture = {
		pointerId: context.event.pointerId,
		marquee,
		start: context.point,
		engaged: false,
		mouseDownSourceId: dominantSource(face),
	};
	if (marquee) {
		store.setMarquee([context.point, context.point]);
		store.setSwept([]);
	} else {
		store.setSweepPath([context.point]);
		store.setSwept(face ? [face.id] : []);
	}
	store.setHovered(face?.id ?? null);
};

const onPointerMove = (context: PointerContext, api: HostApi): void => {
	// A pending Alt-click delete only survives a true click (no drag). Cancel it
	// the moment this pointer crosses the same drag threshold `gesture.engaged`
	// uses, before any arrangement-dependent early return, since the pointer may
	// be armed while the mesh itself has no arrangement (e.g. a "needs-source"
	// state cleared by this very click).
	if (
		pendingAltDelete &&
		context.event.pointerId === pendingAltDelete.pointerId &&
		Math.hypot(
			context.point.x - pendingAltDelete.start.x,
			context.point.y - pendingAltDelete.start.y,
		) >= screenToLocal(DRAG_THRESHOLD_PX, api.viewport.zoom)
	) {
		pendingAltDelete = null;
	}
	ensureArrangement(api);
	const store = useShapeBuilderStore.getState();
	const arr = store.arrangement;
	if (!arr) return;
	store.setHoverPoint(context.point);
	const tolerance = traceTolerance(api);
	const face = faceAtTracePoint(arr.faces, context.point, tolerance);

	const g = gesture;
	const active =
		g && context.event.pointerId === g.pointerId && context.event.buttons !== 0;
	if (active && g) {
		setModeIfChanged(store, context.event.altKey ? "erase" : "merge");
		if (g.marquee) {
			setOperationIntentIfChanged(
				store,
				context.event.altKey ? "erase" : "merge",
			);
			store.setMarquee([g.start, context.point]);
			const swept = arr.faces
				.filter((f) => insideRect(faceBboxCenter(f), g.start, context.point))
				.map((f) => f.id);
			store.setSwept(swept);
		} else {
			const path = store.sweepPath ?? [];
			const moved = Math.hypot(
				context.point.x - g.start.x,
				context.point.y - g.start.y,
			);
			// Below the threshold it is still a click — keep the single seeded face so a
			// jittery press extracts exactly one region instead of grabbing neighbours.
			if (
				!g.engaged &&
				moved < screenToLocal(DRAG_THRESHOLD_PX, api.viewport.zoom)
			) {
				setOperationIntentIfChanged(
					store,
					context.event.altKey ? "erase" : "extract",
				);
				setHoveredIfChanged(store, face?.id ?? null);
				return;
			}
			g.engaged = true;
			setOperationIntentIfChanged(
				store,
				context.event.altKey ? "erase" : "merge",
			);
			const last = path[path.length - 1] ?? g.start;
			const step = screenToLocal(SAMPLE_STEP_PX, api.viewport.zoom);
			for (const id of facesAlongTraceSegment(
				arr.faces,
				last,
				context.point,
				step,
				tolerance,
			))
				store.addSwept(id);
			store.setSweepPath([...path, context.point]);
		}
		setHoveredIfChanged(store, face?.id ?? null);
		return;
	}
	// Idle hover: reflect Alt so the mesh tint + cursor badge preview erase vs merge.
	setModeIfChanged(store, context.event.altKey ? "erase" : "merge");
	setOperationIntentIfChanged(
		store,
		context.event.altKey ? "erase" : "extract",
	);
	setHoveredIfChanged(store, face?.id ?? null);
};

const onPointerUp = (context: PointerContext, api: HostApi): void => {
	// Resolve a consecutive Alt-click delete: this pointer never engaged a drag
	// (onPointerMove would have cancelled `pendingAltDelete` otherwise), so a
	// clean release deletes the whole target shape as one undoable command.
	// One-shot: consumed here regardless of outcome, so it can never resolve twice.
	if (
		pendingAltDelete &&
		context.event.pointerId === pendingAltDelete.pointerId
	) {
		const { nodeId } = pendingAltDelete;
		pendingAltDelete = null;
		const store = useShapeBuilderStore.getState();
		if (deleteShapeBuilderTarget(nodeId)) {
			const remaining = api.selection.nodeIds.filter((id) => id !== nodeId);
			if (remaining.length !== api.selection.nodeIds.length) {
				const primary =
					api.selection.primary === nodeId
						? (remaining.at(-1) ?? null)
						: api.selection.primary;
				api.setSelection(remaining, primary);
			}
			store.clearCleanupCandidates();
			lastDoc = null; // force recompute — the deleted node no longer exists
		}
		return;
	}

	const active = gesture?.pointerId === context.event.pointerId;
	const current = gesture;
	gesture = null;
	const store = useShapeBuilderStore.getState();
	const arr = store.arrangement;
	const mode: ShapeBuilderMode = context.event.altKey ? "erase" : "merge";
	const sweptIds = store.sweptFaceIds;
	const outputDetail = store.outputDetail;
	store.clearGesture();
	if (!active || !current || !arr || sweptIds.length === 0) return;

	const sweptSet = new Set(sweptIds);
	const sweptFaceIndices = arr.faces
		.filter((f) => sweptSet.has(f.id))
		.map((f) => f.index);
	const constructionMerge =
		mode === "merge" && (current.engaged || current.marquee);
	// Mouse-down source (stroke) or dominant covering source of the swept set (marquee).
	let styleSource = current.mouseDownSourceId;
	if (!styleSource) {
		const counts = new Map<string, number>();
		for (const f of arr.faces) {
			if (!sweptSet.has(f.id)) continue;
			for (const id of f.coveredBy) counts.set(id, (counts.get(id) ?? 0) + 1);
		}
		styleSource =
			[...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
	}

	const commit = applyShapeBuilderOp({
		document: api.getDoc(),
		arrangement: arr,
		sweptFaceIndices,
		mode,
		mergeStyleSourceId: styleSource,
		generatedStyle: generatedStyleForGesture(),
		remainderPolicy: constructionMerge
			? "discard-affected"
			: "preserve-affected",
		outputDetail,
	});
	if (!commit.didCommit) return;
	if (commit.cleanupCandidateNodeIds.length > 0) {
		store.setCleanupCandidates({
			operationId: commit.operationId,
			remainderNodeIds: commit.cleanupCandidateNodeIds,
			focusNodeIds: commit.generatedNodeIds,
		});
	} else {
		store.clearCleanupCandidates();
	}
	// Post-commit flash: the union outline of exactly what was committed, built
	// from `commit.outputFaceIndices` (the plan's actual output face set) rather
	// than the raw swept faces — for merge this is the whole-participating-shapes
	// expansion, so the flash matches the committed result for every intent.
	const flashD = shapeBuilderPathDForGeometries(
		buildShapeBuilderFaceGeometries(
			arr,
			commit.outputFaceIndices,
			outputDetail,
		),
	);
	const fill =
		mode === "merge" && store.paintMode === "swatch"
			? store.activeFill
			: undefined;
	if (flashD) store.setLastCommit({ d: flashD, mode, fill });
	if (commit.generatedNodeIds.length > 0 && fill) {
		useColorRecents.getState().addRecent(fill);
	}
	lastDoc = null; // force recompute against the mutated document
	api.setSelection(
		commit.selectionNodeIds,
		commit.selectionNodeIds.at(-1) ?? null,
	);
};

const resetGesture = (): void => {
	gesture = null;
	pendingAltDelete = null;
	useShapeBuilderStore.getState().reset();
	lastDoc = null;
	lastSelKey = "";
};

const onKeyDown = (event: KeyboardEvent, api: HostApi): void => {
	if (event.key === "Escape") {
		gesture = null;
		pendingAltDelete = null;
		useShapeBuilderStore.getState().clearGesture();
		event.preventDefault();
		return;
	}
	if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
	const direction = event.key === "ArrowRight" ? 1 : -1;
	if (cycleActiveSwatch(api, direction, event.shiftKey ? 5 : 1)) {
		event.preventDefault();
	}
};

export const handler: ShapeBuilderHandler = {
	id: "shape-builder",
	tool: "shape-builder",
	onPointerDown,
	onPointerMove,
	onPointerUp,
	onKeyDown,
	onActivate: (api) => ensureArrangement(api),
	onDeactivate: resetGesture,
};
