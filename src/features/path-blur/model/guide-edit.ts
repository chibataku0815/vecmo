import type { AePoint } from "@/shared/glammer/ae-shape";
import type { PathBlurGuide } from "@/shared/path-blur/velocity-field";

/** A point in artboard-pixel space. */
export type ArtboardPoint = { readonly x: number; readonly y: number };

/** A located guide anchor: which guide + vertex, and its artboard-px position. */
export type GuideAnchorHit = {
	readonly guideIndex: number;
	readonly vertexIndex: number;
};

/**
 * Pure geometry for Path Blur guide authoring. Guides are stored in normalized
 * 0..1 frame-UV; the editor works in artboard pixels. These helpers convert
 * between the two and update a vertex immutably — no DOM, no store, so they stay
 * unit-testable.
 */

/** Anchor (vertex) positions of every guide in artboard-pixel space. */
export const guideAnchorsPx = (
	guides: readonly PathBlurGuide[],
	width: number,
	height: number,
): readonly (GuideAnchorHit & ArtboardPoint)[] =>
	guides.flatMap((guide, guideIndex) =>
		guide.shape.vertices.map((vertex, vertexIndex) => ({
			guideIndex,
			vertexIndex,
			x: vertex[0] * width,
			y: vertex[1] * height,
		})),
	);

/**
 * Nearest guide anchor within `tolerance` artboard-px of `point`, or null. Ties
 * resolve to the last-drawn anchor (topmost), matching the overlay's paint order.
 */
export const findGuideAnchorHit = (
	guides: readonly PathBlurGuide[],
	point: ArtboardPoint,
	width: number,
	height: number,
	tolerance: number,
): GuideAnchorHit | null => {
	let best: GuideAnchorHit | null = null;
	let bestDistance = tolerance;
	for (const anchor of guideAnchorsPx(guides, width, height)) {
		const distance = Math.hypot(anchor.x - point.x, anchor.y - point.y);
		if (distance <= bestDistance) {
			bestDistance = distance;
			best = { guideIndex: anchor.guideIndex, vertexIndex: anchor.vertexIndex };
		}
	}
	return best;
};

/** Convert an artboard-pixel point to normalized 0..1 frame-UV, clamped to frame. */
export const artboardPointToUv = (
	point: ArtboardPoint,
	width: number,
	height: number,
): AePoint => [
	Math.min(1, Math.max(0, point.x / Math.max(1, width))),
	Math.min(1, Math.max(0, point.y / Math.max(1, height))),
];

/**
 * Move one guide vertex to a new 0..1 UV position, returning a new guides array.
 * Tangents are relative offsets from the vertex, so they ride along untouched —
 * dragging an anchor translates the curve locally, as expected.
 */
export const updateGuideVertexUv = (
	guides: readonly PathBlurGuide[],
	guideIndex: number,
	vertexIndex: number,
	uv: AePoint,
): readonly PathBlurGuide[] =>
	guides.map((guide, index) =>
		index !== guideIndex
			? guide
			: {
					...guide,
					shape: {
						...guide.shape,
						vertices: guide.shape.vertices.map((vertex, vi) =>
							vi === vertexIndex ? uv : vertex,
						),
					},
				},
	);

/** A located guide tangent handle: which guide/vertex, and which side. */
export type GuideTangentHandle = {
	readonly guideIndex: number;
	readonly vertexIndex: number;
	readonly side: "in" | "out";
};

/** A tangent handle resolved to artboard px, carrying its anchor's px (line end). */
export type GuideTangentHandlePx = GuideTangentHandle &
	ArtboardPoint & {
		readonly anchorX: number;
		readonly anchorY: number;
	};

/**
 * Curve-affecting tangent handles of every guide in artboard-pixel space. A
 * handle sits at `(vertex + tangent)`; segment i is driven by `outTangents[i]`
 * and `inTangents[i+1]`, so for an OPEN path the first vertex's `in` and the last
 * vertex's `out` are dangling and omitted. Zero-length tangents (handle coincides
 * with the anchor) are omitted too — there is nothing to grab.
 */
export const guideTangentHandlesPx = (
	guides: readonly PathBlurGuide[],
	width: number,
	height: number,
): readonly GuideTangentHandlePx[] =>
	guides.flatMap((guide, guideIndex) => {
		const { shape } = guide;
		const last = shape.vertices.length - 1;
		const handles: GuideTangentHandlePx[] = [];
		shape.vertices.forEach((vertex, vertexIndex) => {
			const anchorX = vertex[0] * width;
			const anchorY = vertex[1] * height;
			const add = (side: "in" | "out", tangent: AePoint): void => {
				if (tangent[0] === 0 && tangent[1] === 0) return;
				handles.push({
					guideIndex,
					vertexIndex,
					side,
					anchorX,
					anchorY,
					x: (vertex[0] + tangent[0]) * width,
					y: (vertex[1] + tangent[1]) * height,
				});
			};
			if (shape.closed || vertexIndex < last) {
				add("out", shape.outTangents[vertexIndex]);
			}
			if (shape.closed || vertexIndex > 0) {
				add("in", shape.inTangents[vertexIndex]);
			}
		});
		return handles;
	});

/** Nearest tangent handle within `tolerance` artboard-px of `point`, or null. */
export const findGuideTangentHit = (
	guides: readonly PathBlurGuide[],
	point: ArtboardPoint,
	width: number,
	height: number,
	tolerance: number,
): GuideTangentHandle | null => {
	let best: GuideTangentHandle | null = null;
	let bestDistance = tolerance;
	for (const handle of guideTangentHandlesPx(guides, width, height)) {
		const distance = Math.hypot(handle.x - point.x, handle.y - point.y);
		if (distance <= bestDistance) {
			bestDistance = distance;
			best = {
				guideIndex: handle.guideIndex,
				vertexIndex: handle.vertexIndex,
				side: handle.side,
			};
		}
	}
	return best;
};

/**
 * Point one guide tangent at a new 0..1 UV target, returning a new guides array.
 * The stored tangent is the relative offset `target − vertex`, matching the AE
 * convention the field builder samples.
 */
/**
 * Minimum tangent length (UV) kept when a tangent is dragged onto its anchor, so
 * the handle never collapses out of the overlay / hit-test — a corner stays
 * recoverable into a curve (the only way back would otherwise be undo).
 */
const MIN_TANGENT_LENGTH = 0.02;

export const updateGuideTangentUv = (
	guides: readonly PathBlurGuide[],
	handle: GuideTangentHandle,
	targetUv: AePoint,
): readonly PathBlurGuide[] =>
	guides.map((guide, index) => {
		if (index !== handle.guideIndex) return guide;
		const vertex = guide.shape.vertices[handle.vertexIndex];
		if (!vertex) return guide;
		const dx = targetUv[0] - vertex[0];
		const dy = targetUv[1] - vertex[1];
		const length = Math.hypot(dx, dy);
		const tangent: AePoint =
			length === 0
				? [MIN_TANGENT_LENGTH, 0]
				: length < MIN_TANGENT_LENGTH
					? [
							(dx / length) * MIN_TANGENT_LENGTH,
							(dy / length) * MIN_TANGENT_LENGTH,
						]
					: [dx, dy];
		const key = handle.side === "in" ? "inTangents" : "outTangents";
		return {
			...guide,
			shape: {
				...guide.shape,
				[key]: guide.shape[key].map((value, vi) =>
					vi === handle.vertexIndex ? tangent : value,
				),
			},
		};
	});

/**
 * Removes one guide path by index, returning a new guides array. Allowed to empty
 * the list: an empty `path-blur` node stays in the graph and a fresh guide is
 * re-addable by clicking empty canvas, so there is no floor at one guide.
 */
export const removeGuideAt = (
	guides: readonly PathBlurGuide[],
	guideIndex: number,
): readonly PathBlurGuide[] =>
	guides.filter((_, index) => index !== guideIndex);

/** Minimum vertices a guide must keep — two vertices describe the shortest curve. */
const MIN_GUIDE_VERTICES = 2;
/** Cubic-segment subdivisions used only for the curve-body hit test. */
const SEGMENT_HIT_STEPS = 32;

/**
 * Closest point on chord `a→b` to `p`, as its distance and the clamped fraction
 * `u ∈ [0, 1]` along the chord. The curve hit-test measures distance to the
 * flattened polyline (its chords), not to the sample points — otherwise a coarse
 * sample count leaves gaps wider than the tolerance and a click exactly on a long
 * curve misses the nearest sample.
 */
const closestPointOnChord = (
	p: ArtboardPoint,
	a: ArtboardPoint,
	b: ArtboardPoint,
): { readonly distance: number; readonly u: number } => {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const len2 = dx * dx + dy * dy;
	const u =
		len2 > 0
			? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
			: 0;
	const cx = a.x + dx * u;
	const cy = a.y + dy * u;
	return { distance: Math.hypot(p.x - cx, p.y - cy), u };
};

/** Linear interpolation between two UV points. */
const lerpPoint = (a: AePoint, b: AePoint, t: number): AePoint => [
	a[0] + (b[0] - a[0]) * t,
	a[1] + (b[1] - a[1]) * t,
];

/**
 * A guide's open cubic segments as `(p0, c1, c2, p3)` control tuples in UV space,
 * where `c1 = vertex[i] + outTangents[i]` and `c2 = vertex[i+1] + inTangents[i+1]`.
 * Path-blur guides are open, so there are `vertices.length − 1` segments. Returns
 * an empty array when tangent arrays are the wrong length (never reads undefined).
 */
const guideCubicSegments = (
	guide: PathBlurGuide,
): readonly {
	readonly p0: AePoint;
	readonly c1: AePoint;
	readonly c2: AePoint;
	readonly p3: AePoint;
}[] => {
	const { shape } = guide;
	const count = shape.vertices.length;
	if (
		count < MIN_GUIDE_VERTICES ||
		shape.inTangents.length !== count ||
		shape.outTangents.length !== count
	) {
		return [];
	}
	const segments: {
		readonly p0: AePoint;
		readonly c1: AePoint;
		readonly c2: AePoint;
		readonly p3: AePoint;
	}[] = [];
	for (let i = 0; i < count - 1; i += 1) {
		const p0 = shape.vertices[i];
		const p3 = shape.vertices[i + 1];
		const out = shape.outTangents[i];
		const inNext = shape.inTangents[i + 1];
		if (!p0 || !p3 || !out || !inNext) return [];
		segments.push({
			p0,
			c1: [p0[0] + out[0], p0[1] + out[1]],
			c2: [p3[0] + inNext[0], p3[1] + inNext[1]],
			p3,
		});
	}
	return segments;
};

/** Cubic Bézier point at parameter `t`, via nested de Casteljau lerps. */
const cubicPointAt = (
	p0: AePoint,
	c1: AePoint,
	c2: AePoint,
	p3: AePoint,
	t: number,
): AePoint => {
	const a = lerpPoint(p0, c1, t);
	const b = lerpPoint(c1, c2, t);
	const c = lerpPoint(c2, p3, t);
	const d = lerpPoint(a, b, t);
	const e = lerpPoint(b, c, t);
	return lerpPoint(d, e, t);
};

/** A located curve-body hit: which guide, which segment, and its parameter t. */
export type GuideSegmentHit = {
	readonly guideIndex: number;
	readonly segment: number;
	readonly t: number;
};

/**
 * Nearest point on any guide's curve BODY within `tolerancePx` artboard-px of
 * `point`, or null. Each cubic segment is flattened into {@link SEGMENT_HIT_STEPS}
 * chords (converted UV → px like {@link guideAnchorsPx}) and the closest chord
 * sample wins. Callers give segment-insert LOWER priority than anchor/tangent hits,
 * so a click that lands on an anchor is an anchor hit, not a segment hit.
 */
export const findGuideSegmentHit = (
	guides: readonly PathBlurGuide[],
	point: ArtboardPoint,
	width: number,
	height: number,
	tolerancePx: number,
): GuideSegmentHit | null => {
	let best: GuideSegmentHit | null = null;
	let bestDistance = tolerancePx;
	const toPx = (uv: AePoint): ArtboardPoint => ({
		x: uv[0] * width,
		y: uv[1] * height,
	});
	guides.forEach((guide, guideIndex) => {
		guideCubicSegments(guide).forEach(({ p0, c1, c2, p3 }, segment) => {
			let prevPx = toPx(cubicPointAt(p0, c1, c2, p3, 0));
			for (let step = 1; step <= SEGMENT_HIT_STEPS; step += 1) {
				const currPx = toPx(
					cubicPointAt(p0, c1, c2, p3, step / SEGMENT_HIT_STEPS),
				);
				const chord = closestPointOnChord(point, prevPx, currPx);
				if (chord.distance <= bestDistance) {
					bestDistance = chord.distance;
					best = {
						guideIndex,
						segment,
						t: (step - 1 + chord.u) / SEGMENT_HIT_STEPS,
					};
				}
				prevPx = currPx;
			}
		});
	});
	return best;
};

/**
 * Inserts an anchor on guide `guideIndex`'s segment `segment` at parameter `t`,
 * splitting that cubic with de Casteljau so the CURVE IS UNCHANGED. Only three
 * tangents are touched: the segment start's `out`, the new mid vertex's `in`/`out`,
 * and the original segment end's `in`. Every other vertex's tangents — including
 * the non-zero open-endpoint tangents path-blur intentionally keeps — survive
 * byte-for-byte. Returns a new guides array; a no-op (unchanged reference-equal
 * data) for an out-of-range segment.
 */
export const insertGuideAnchor = (
	guides: readonly PathBlurGuide[],
	guideIndex: number,
	segment: number,
	t: number,
): readonly PathBlurGuide[] =>
	guides.map((guide, index) => {
		if (index !== guideIndex) return guide;
		const { shape } = guide;
		const p0 = shape.vertices[segment];
		const p3 = shape.vertices[segment + 1];
		const out = shape.outTangents[segment];
		const inNext = shape.inTangents[segment + 1];
		if (!p0 || !p3 || !out || !inNext) return guide;
		const c1: AePoint = [p0[0] + out[0], p0[1] + out[1]];
		const c2: AePoint = [p3[0] + inNext[0], p3[1] + inNext[1]];
		// de Casteljau split at t: a,b,c are the first level; d,e the second; m is
		// the split point on the curve.
		const a = lerpPoint(p0, c1, t);
		const b = lerpPoint(c1, c2, t);
		const c = lerpPoint(c2, p3, t);
		const d = lerpPoint(a, b, t);
		const e = lerpPoint(b, c, t);
		const m = lerpPoint(d, e, t);
		const midIndex = segment + 1;
		// The three tangents the split rewrites; every other tangent is copied as-is.
		const startOut: AePoint = [a[0] - p0[0], a[1] - p0[1]];
		const midIn: AePoint = [d[0] - m[0], d[1] - m[1]];
		const midOut: AePoint = [e[0] - m[0], e[1] - m[1]];
		const nextIn: AePoint = [c[0] - p3[0], c[1] - p3[1]];
		const outTangents = [...shape.outTangents];
		outTangents[segment] = startOut;
		outTangents.splice(midIndex, 0, midOut);
		const inTangents = [...shape.inTangents];
		inTangents[midIndex] = nextIn;
		inTangents.splice(midIndex, 0, midIn);
		return {
			...guide,
			shape: {
				...shape,
				vertices: [
					...shape.vertices.slice(0, midIndex),
					m,
					...shape.vertices.slice(midIndex),
				],
				outTangents,
				inTangents,
			},
		};
	});

/**
 * Removes one anchor vertex (and its in/out tangents) from a guide, returning a new
 * guides array. Guards a minimum of {@link MIN_GUIDE_VERTICES}: dropping below two
 * would leave no curve, so it returns the guide unchanged. Simple splice, no G1
 * re-fit — the neighboring segment endpoints are unchanged, so the curve only
 * changes where the removed anchor bent it.
 */
export const removeGuideAnchor = (
	guides: readonly PathBlurGuide[],
	guideIndex: number,
	vertexIndex: number,
): readonly PathBlurGuide[] =>
	guides.map((guide, index) => {
		if (index !== guideIndex) return guide;
		const { shape } = guide;
		if (shape.vertices.length <= MIN_GUIDE_VERTICES) return guide;
		if (vertexIndex < 0 || vertexIndex >= shape.vertices.length) return guide;
		const dropAt = <T>(values: readonly T[]): T[] =>
			values.filter((_, vi) => vi !== vertexIndex);
		return {
			...guide,
			shape: {
				...shape,
				vertices: dropAt(shape.vertices),
				inTangents: dropAt(shape.inTangents),
				outTangents: dropAt(shape.outTangents),
			},
		};
	});

const NEW_GUIDE_HALF_WIDTH = 0.12;
const NEW_GUIDE_TANGENT = 0.05;

/**
 * A small horizontal guide centred at `centerUv` (0..1), for "add another path".
 * Two anchors with gentle horizontal tangents — a short directional segment the
 * user reshapes after dropping it. Clamped to stay inside the frame.
 */
export const defaultGuideAt = (centerUv: AePoint): PathBlurGuide => {
	const [cx, cy] = centerUv;
	const left = Math.max(0, cx - NEW_GUIDE_HALF_WIDTH);
	const right = Math.min(1, cx + NEW_GUIDE_HALF_WIDTH);
	return {
		shape: {
			type: "Shape",
			closed: false,
			vertices: [
				[left, cy],
				[right, cy],
			],
			inTangents: [
				[-NEW_GUIDE_TANGENT, 0],
				[-NEW_GUIDE_TANGENT, 0],
			],
			outTangents: [
				[NEW_GUIDE_TANGENT, 0],
				[NEW_GUIDE_TANGENT, 0],
			],
		},
		startSpeed: 1,
		endSpeed: 1,
	};
};
