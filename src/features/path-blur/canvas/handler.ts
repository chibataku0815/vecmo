import type { SceneDocument } from "@/entities/scene/model/types";
import type { AePoint } from "@/shared/glammer/ae-shape";
import type { PathBlurGuide } from "@/shared/path-blur/velocity-field";
import {
	ADD_GUIDE_LABEL,
	commitPathBlurGuides,
	DELETE_GUIDE_LABEL,
	INSERT_ANCHOR_LABEL,
	type PathBlurEditSpace,
	type PathBlurWriteTarget,
	REMOVE_ANCHOR_LABEL,
	resolvePathBlurTarget,
} from "../model/guide-commit";
import {
	artboardPointToUv,
	defaultGuideAt,
	findGuideAnchorHit,
	findGuideSegmentHit,
	findGuideTangentHit,
	type GuideSegmentHit,
	type GuideTangentHandle,
	insertGuideAnchor,
	removeGuideAnchor,
	removeGuideAt,
	updateGuideTangentUv,
	updateGuideVertexUv,
} from "../model/guide-edit";

type CanvasPoint = { readonly x: number; readonly y: number };

type PointerContext = {
	readonly point: CanvasPoint;
	readonly hitNodeId: string | null;
	readonly event: PointerEvent;
};

/**
 * Structural mirror of the host's `path-blur-guide` sub-selection variant.
 * Features cannot import `features/selection`, so the handler is typed against
 * this local shape; the host passes a compatible superset at runtime (see
 * gradient/handler.ts for the same mirror pattern).
 */
type PathBlurGuideSub = {
	readonly nodeId: string;
	readonly kind: "path-blur-guide";
	readonly guideIndex: number;
};

/**
 * Mirrors the host's wider sub-selection union for reads; the handler only ever
 * writes the `path-blur-guide` variant.
 */
type HostSubSelection =
	| PathBlurGuideSub
	| {
			readonly nodeId: string;
			readonly kind: string;
	  }
	| null;

/**
 * Narrows the mirrored host sub-selection to this feature's own variant. A plain
 * `sub?.kind === "path-blur-guide"` check cannot narrow, because the mirror's
 * other-kinds variant types `kind` as the wider `string`; this predicate does.
 */
const isPathBlurGuideSub = (sub: HostSubSelection): sub is PathBlurGuideSub =>
	sub?.kind === "path-blur-guide";

type HostApi = {
	readonly getDoc: () => SceneDocument;
	readonly selection: {
		readonly nodeIds: readonly string[];
		readonly primary: string | null;
		readonly sub: HostSubSelection;
	};
	readonly viewport: { readonly zoom: number };
	readonly setSubSelection: (sub: PathBlurGuideSub | null) => void;
};

const ANCHOR_HIT_PX = 12;
const TANGENT_HIT_PX = 11;
/** Roomier hit zone for Alt-click anchor removal — deleting must be forgiving. */
const ALT_REMOVE_HIT_PX = 16;
/** Curve-body pick tolerance for inserting an anchor on a segment. */
const SEGMENT_HIT_PX = 8;
const DRAG_THRESHOLD_PX = 2;
const PERCENT = 100;
/** Soft cap on guide paths — empty-clicks past this no-op, so a runaway click
 *  count can't grow the O(guides × samples) field bake without bound. */
const MAX_GUIDES = 8;

/** What a drag is moving: an anchor vertex, or one of its tangent handles. */
type GuideTarget =
	| {
			readonly kind: "anchor";
			readonly guideIndex: number;
			readonly vertexIndex: number;
	  }
	| { readonly kind: "tangent"; readonly handle: GuideTangentHandle };

type GuideGesture = {
	readonly nodeId: string;
	readonly write: PathBlurWriteTarget;
	readonly space: PathBlurEditSpace;
	readonly coalesceKey: string;
	readonly startPx: CanvasPoint;
	readonly target: GuideTarget;
	dragging: boolean;
};

/**
 * Module-local in-flight drag. No scene transaction is opened (the commit
 * coalesces by key), so a stranded gesture cannot corrupt undo — the next
 * pointer-down clears it. Mirrors the noise-gradient handler's singleton gesture.
 */
let gesture: GuideGesture | null = null;
/**
 * A pending "add another guide path" click, recorded on empty pointer-down and
 * only committed on pointer-up if it stayed a click (never crossed the drag
 * threshold) — so a drag/pan that starts on empty canvas never drops a guide.
 */
let pendingAdd: {
	readonly uv: AePoint;
	readonly startPx: CanvasPoint;
	readonly write: PathBlurWriteTarget;
	readonly nodeId: string;
} | null = null;
/**
 * A pending "insert an anchor on a guide segment" click, armed on a pointer-down
 * that hit a curve BODY (not an anchor/tangent). Like {@link pendingAdd} it only
 * commits on pointer-up if the click never became a drag, so panning off the curve
 * never drops an anchor. Segment-insert takes priority over the empty-space add, so
 * clicking a curve inserts an anchor rather than adding a whole new guide.
 */
let pendingInsert: {
	readonly nodeId: string;
	readonly write: PathBlurWriteTarget;
	readonly hit: GuideSegmentHit;
	readonly startPx: CanvasPoint;
} | null = null;
let gestureSeq = 0;

/** Converts an artboard-pixel point into the resolved target's own edit space. */
const toEditSpacePoint = (
	point: CanvasPoint,
	space: PathBlurEditSpace,
): CanvasPoint => ({
	x: point.x - space.offsetX,
	y: point.y - space.offsetY,
});

const screenScale = (api: HostApi): number =>
	Math.max(api.viewport.zoom / PERCENT, 0.001);

const setCursor = (event: PointerEvent, cursor: string): void => {
	if (typeof Element === "undefined" || typeof SVGElement === "undefined")
		return;
	const target = event.target;
	if (!(target instanceof Element)) return;
	const svg = target.closest("svg");
	if (svg instanceof SVGElement) svg.style.cursor = cursor;
};

/** Resolves the current tool session's Path Blur target (frame or selected object). */
const currentPathBlur = (document: SceneDocument, api: HostApi) =>
	resolvePathBlurTarget(document, api.selection);

/**
 * Hit-test a guide handle under the pointer. Anchors take priority over tangent
 * handles (anchors paint on top), so an anchor and a short tangent that overlap
 * resolve to the anchor.
 */
const pickGuideTarget = (
	guides: readonly PathBlurGuide[],
	point: CanvasPoint,
	width: number,
	height: number,
	api: HostApi,
): GuideTarget | null => {
	const scale = screenScale(api);
	const anchor = findGuideAnchorHit(
		guides,
		point,
		width,
		height,
		ANCHOR_HIT_PX / scale,
	);
	if (anchor) {
		return {
			kind: "anchor",
			guideIndex: anchor.guideIndex,
			vertexIndex: anchor.vertexIndex,
		};
	}
	const tangent = findGuideTangentHit(
		guides,
		point,
		width,
		height,
		TANGENT_HIT_PX / scale,
	);
	return tangent ? { kind: "tangent", handle: tangent } : null;
};

/**
 * Removes one anchor from a guide immediately (Alt-click intent), committing as a
 * single undo entry. No-ops when the guide only has the minimum vertices; the pure
 * `removeGuideAnchor` guards that, so an unremovable Alt-click leaves the guide
 * untouched instead of silently doing something else.
 */
const commitRemoveAnchor = (
	write: PathBlurWriteTarget,
	nodeId: string,
	guides: readonly PathBlurGuide[],
	guideIndex: number,
	vertexIndex: number,
): void => {
	gestureSeq += 1;
	commitPathBlurGuides(
		write,
		nodeId,
		removeGuideAnchor(guides, guideIndex, vertexIndex),
		`path-blur-remove-anchor:${nodeId}:${gestureSeq}`,
		REMOVE_ANCHOR_LABEL,
	);
};

const onPointerDown = (context: PointerContext, api: HostApi): void => {
	gesture = null;
	pendingInsert = null;
	const document = api.getDoc();
	const pathBlur = currentPathBlur(document, api);
	if (!pathBlur) return;
	const { width, height } = pathBlur.space;
	const point = toEditSpacePoint(context.point, pathBlur.space);
	const scale = screenScale(api);

	// Hit priority (explicit so add/remove/insert never collide):
	//   1. Alt-click on an anchor → remove that anchor immediately (short-circuit,
	//      mesh precedent). A roomier tolerance makes deletion forgiving. Because
	//      this returns WITHOUT creating a gesture, onPointerUp sets no guide
	//      selection, so Alt-remove never competes with select-then-Delete (fix 4).
	if (context.event.altKey) {
		const anchor = findGuideAnchorHit(
			pathBlur.guides,
			point,
			width,
			height,
			ALT_REMOVE_HIT_PX / scale,
		);
		if (anchor) {
			commitRemoveAnchor(
				pathBlur.write,
				pathBlur.nodeId,
				pathBlur.guides,
				anchor.guideIndex,
				anchor.vertexIndex,
			);
		}
		return;
	}

	//   2. Anchor / tangent hit → start a drag gesture (existing behavior).
	const target = pickGuideTarget(pathBlur.guides, point, width, height, api);
	if (target) {
		gestureSeq += 1;
		gesture = {
			nodeId: pathBlur.nodeId,
			write: pathBlur.write,
			space: pathBlur.space,
			coalesceKey: `path-blur-guide:${pathBlur.nodeId}:${gestureSeq}`,
			startPx: context.point,
			target,
			dragging: false,
		};
		setCursor(context.event, "grabbing");
		return;
	}

	//   3. Curve BODY hit → arm an anchor-insert (committed on pointer-up if it
	//      stays a click). This takes priority over the empty-space add below, so
	//      clicking the curve inserts an anchor instead of dropping a whole guide.
	const segmentHit = findGuideSegmentHit(
		pathBlur.guides,
		point,
		width,
		height,
		SEGMENT_HIT_PX / scale,
	);
	if (segmentHit) {
		pendingInsert = {
			nodeId: pathBlur.nodeId,
			write: pathBlur.write,
			hit: segmentHit,
			startPx: context.point,
		};
		return;
	}

	//   4. Empty click inside the target arms an "add another guide path" —
	//      committed on pointer-up only if it stays a click, so a pan/drag from
	//      empty never drops a guide.
	const inside =
		point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height;
	if (inside && pathBlur.guides.length < MAX_GUIDES) {
		pendingAdd = {
			uv: artboardPointToUv(point, width, height),
			startPx: context.point,
			write: pathBlur.write,
			nodeId: pathBlur.nodeId,
		};
	}
};

const onPointerMove = (context: PointerContext, api: HostApi): void => {
	if (!gesture) {
		if (pendingAdd) {
			const movedPx =
				Math.hypot(
					context.point.x - pendingAdd.startPx.x,
					context.point.y - pendingAdd.startPx.y,
				) * screenScale(api);
			// The click became a drag (pan/marquee) — cancel the pending add.
			if (movedPx >= DRAG_THRESHOLD_PX) pendingAdd = null;
			return;
		}
		if (pendingInsert) {
			const movedPx =
				Math.hypot(
					context.point.x - pendingInsert.startPx.x,
					context.point.y - pendingInsert.startPx.y,
				) * screenScale(api);
			// The click became a drag (pan) — cancel the pending anchor insert so a
			// pan that starts on the curve never drops an anchor.
			if (movedPx >= DRAG_THRESHOLD_PX) pendingInsert = null;
			return;
		}
		const pathBlur = currentPathBlur(api.getDoc(), api);
		if (!pathBlur) {
			setCursor(context.event, "default");
			return;
		}
		const { width, height } = pathBlur.space;
		const point = toEditSpacePoint(context.point, pathBlur.space);
		const scale = screenScale(api);
		const hovered = pickGuideTarget(pathBlur.guides, point, width, height, api);
		// Cursor hints: Alt over an anchor removes it (not-allowed at min vertices is
		// left to the commit's no-op); a plain anchor/tangent drags; the curve body
		// inserts (crosshair). Anchor/tangent take priority over the segment hint.
		if (hovered) {
			const altRemove = context.event.altKey && hovered.kind === "anchor";
			setCursor(context.event, altRemove ? "not-allowed" : "grab");
			return;
		}
		const onSegment = findGuideSegmentHit(
			pathBlur.guides,
			point,
			width,
			height,
			SEGMENT_HIT_PX / scale,
		);
		setCursor(context.event, onSegment ? "crosshair" : "default");
		return;
	}
	const current = gesture;
	const movedPx =
		Math.hypot(
			context.point.x - current.startPx.x,
			context.point.y - current.startPx.y,
		) * screenScale(api);
	if (!current.dragging && movedPx < DRAG_THRESHOLD_PX) return;
	current.dragging = true;
	const pathBlur = currentPathBlur(api.getDoc(), api);
	if (!pathBlur || pathBlur.nodeId !== current.nodeId) return;
	const point = toEditSpacePoint(context.point, current.space);
	const uv = artboardPointToUv(
		point,
		current.space.width,
		current.space.height,
	);
	const { target } = current;
	const nextGuides =
		target.kind === "anchor"
			? updateGuideVertexUv(
					pathBlur.guides,
					target.guideIndex,
					target.vertexIndex,
					uv,
				)
			: updateGuideTangentUv(pathBlur.guides, target.handle, uv);
	commitPathBlurGuides(
		current.write,
		current.nodeId,
		nextGuides,
		current.coalesceKey,
	);
	setCursor(context.event, "grabbing");
};

const onPointerUp = (_context: PointerContext, api: HostApi): void => {
	const finished = gesture;
	const insert = pendingInsert;
	gesture = null;
	pendingInsert = null;
	// A plain anchor click that never became a drag selects that guide, so the
	// user can then press Delete to remove it (fix 4). Tangent clicks and drags
	// are not selections. Alt-click removals short-circuit in onPointerDown and
	// never create a gesture, so they never reach here.
	if (finished && !finished.dragging && finished.target.kind === "anchor") {
		api.setSubSelection({
			nodeId: finished.nodeId,
			kind: "path-blur-guide",
			guideIndex: finished.target.guideIndex,
		});
		return;
	}
	if (finished) return;
	// A curve-body click that stayed a click inserts an anchor there (fix 5). The
	// split keeps the curve shape; committing as its own undo entry.
	if (insert) {
		const document = api.getDoc();
		const pathBlur = currentPathBlur(document, api);
		if (!pathBlur || pathBlur.nodeId !== insert.nodeId) return;
		gestureSeq += 1;
		commitPathBlurGuides(
			insert.write,
			pathBlur.nodeId,
			insertGuideAnchor(
				pathBlur.guides,
				insert.hit.guideIndex,
				insert.hit.segment,
				insert.hit.t,
			),
			`path-blur-insert-anchor:${pathBlur.nodeId}:${gestureSeq}`,
			INSERT_ANCHOR_LABEL,
		);
		return;
	}
	if (!pendingAdd) return;
	const { uv, write, nodeId } = pendingAdd;
	pendingAdd = null;
	const document = api.getDoc();
	const pathBlur = currentPathBlur(document, api);
	if (
		!pathBlur ||
		pathBlur.nodeId !== nodeId ||
		pathBlur.guides.length >= MAX_GUIDES
	)
		return;
	gestureSeq += 1;
	commitPathBlurGuides(
		write,
		nodeId,
		[...pathBlur.guides, defaultGuideAt(uv)],
		`path-blur-add:${nodeId}:${gestureSeq}`,
		ADD_GUIDE_LABEL,
	);
};

/**
 * Keyboard seam for the Path Blur tool. Escape clears a selected guide; Delete /
 * Backspace removes it (guarded off the ⌘/Ctrl chords so it never competes with
 * scene-level shortcuts). Reads the guide from `api.selection.sub`, so the target
 * is the guide the user selected by clicking its anchor (fix 4). The removal is
 * one undo entry via a fresh coalesceKey. Deleting the last guide is allowed —
 * the empty `path-blur` node stays and a guide is re-addable by clicking canvas.
 */
const onKeyDown = (event: KeyboardEvent, api: HostApi): void => {
	const sub = api.selection.sub;
	if (event.key === "Escape") {
		if (isPathBlurGuideSub(sub)) api.setSubSelection(null);
		return;
	}
	if (event.key !== "Delete" && event.key !== "Backspace") return;
	if (event.metaKey || event.ctrlKey) return;
	if (!isPathBlurGuideSub(sub)) return;
	const document = api.getDoc();
	const pathBlur = currentPathBlur(document, api);
	if (!pathBlur || pathBlur.nodeId !== sub.nodeId) return;
	gestureSeq += 1;
	commitPathBlurGuides(
		pathBlur.write,
		pathBlur.nodeId,
		removeGuideAt(pathBlur.guides, sub.guideIndex),
		`path-blur-delete:${pathBlur.nodeId}:${gestureSeq}`,
		DELETE_GUIDE_LABEL,
	);
	api.setSubSelection(null);
	event.preventDefault();
};

/** Clears any in-flight drag or armed add/insert (host calls this on tool deactivation / pointer loss). */
export const cancelActiveGesture = (): void => {
	gesture = null;
	pendingAdd = null;
	pendingInsert = null;
};

export const handler = {
	id: "path-blur-guide",
	tool: "path-blur" as const,
	onPointerDown,
	onPointerMove,
	onPointerUp,
	onKeyDown,
	onDeactivate: cancelActiveGesture,
};
