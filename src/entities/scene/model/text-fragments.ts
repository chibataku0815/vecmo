import { getGeometryBounds } from "./rendering";
import {
	estimateTextLineWidth,
	normalizeTextContent,
	textLineLeftForAlign,
	textMetricsForGeometry,
} from "./text-geometry";
import type {
	Bounds,
	TextGeometry,
	TextStyle,
	Vec2,
	VectorNode,
} from "./types";

/**
 * Granularity a Range Selector addresses fragments by — After Effects' "Based On"
 * axis. `character` includes spaces (AE compatible); `character-no-spaces` keeps
 * the same glyphs but marks whitespace as not selectable so the selector skips it;
 * `grapheme` is the emoji/combining-mark-safe character used for non-Latin scripts.
 */
export type TextFragmentUnit =
	| "grapheme"
	| "character"
	| "character-no-spaces"
	| "word"
	| "line";

/**
 * Every {@link TextFragmentUnit} literal, structurally checked against the type
 * by `satisfies` so a new unit added to the type without a matching entry here
 * is a compile error. The single source other layers (the MCP wire schema)
 * should derive their unit enum from instead of hand-typing a second literal
 * list that can silently drift.
 */
export const TEXT_FRAGMENT_UNITS = [
	"grapheme",
	"character",
	"character-no-spaces",
	"word",
	"line",
] as const satisfies readonly TextFragmentUnit[];

/**
 * Where an ordered fragment comes from and how its pose is realized. Both kinds
 * normalize to the SAME {@link TextMotionFragment} contract so one Range Selector
 * evaluator drives live text and outline/imported glyph groups alike:
 *
 * - `glyph-run`: a substring of ONE live text node, rendered by splitting the
 *   node's `<text>` into per-fragment elements at sample time. `sourceStart` /
 *   `sourceEnd` are UTF-16 indices into the node's normalized text.
 * - `scene-node`: an outline/imported sub-node that *is* the fragment. The pose is
 *   composed onto that real node's transform/opacity (no glyph splitting). This is
 *   the higher-fidelity product target; the evaluator never special-cases it.
 */
export type TextFragmentSource =
	| {
			readonly kind: "glyph-run";
			readonly nodeId: string;
			readonly sourceStart: number;
			readonly sourceEnd: number;
	  }
	| {
			readonly kind: "scene-node";
			readonly nodeId: string;
	  };

/**
 * One ordered, addressable text-motion unit, independent of whether it is a live
 * glyph run or an outline node. The selector reads `orderIndex`/`selectable`; the
 * pose math reads `bounds` (its center is the default rotate/scale pivot); the
 * renderer reads `source` to realize the pose. `orderIndex` is the position among
 * *selectable* units only — non-selectable fragments (e.g. spaces in
 * `character-no-spaces`) carry `-1` and always resolve to zero influence.
 */
export type TextMotionFragment = {
	readonly id: string;
	readonly unit: TextFragmentUnit;
	readonly orderIndex: number;
	readonly selectable: boolean;
	readonly lineIndex: number;
	readonly text: string;
	readonly isWhitespace: boolean;
	/** Node-local fragment box in scene units. Pivot defaults to its center. */
	readonly bounds: Bounds;
	/** Node-local alphabetic baseline y for live-text placement. */
	readonly baseline: number;
	readonly source: TextFragmentSource;
};

/**
 * Ordered fragment set for one motion target, normalized from any source.
 * `selectableCount` is the denominator the selector normalizes `orderIndex`
 * against, so the same window math sweeps live text and outline groups identically.
 */
export type TextMotionTarget = {
	readonly kind: "live-text" | "outline-group";
	readonly fragments: readonly TextMotionFragment[];
	readonly selectableCount: number;
};

/**
 * Cumulative advance model for one rendered line. `advanceAt(index)` returns the x
 * offset (scene units, from the line's left edge) of the UTF-16 boundary at
 * `index`; `width` is the full line advance. This is the measurement *seam*: the
 * pure default is the deterministic estimate (Worker/export-safe), while browser
 * surfaces inject a real measurer so split-fragment positions match the rendered
 * `<text>` instead of drifting on multi-glyph or non-left-aligned lines.
 */
export type TextLineMeasure = {
	readonly advanceAt: (index: number) => number;
	readonly width: number;
};

/** Builds a {@link TextLineMeasure} for one line in a resolved text style. */
export type TextLineMeasurer = (
	line: string,
	style: TextStyle,
) => TextLineMeasure;

/**
 * Deterministic measurer built on {@link estimateTextLineWidth}. It never inspects
 * installed fonts, so it is identical across editor, Worker, and export adapters —
 * the safe default and the only measurer that may run outside a browser. Fragment
 * boundaries always fall on grapheme/word edges, so slicing by UTF-16 index never
 * splits a surrogate pair here.
 */
export const estimateTextLineMeasurer: TextLineMeasurer = (line, style) => ({
	advanceAt: (index) => estimateTextLineWidth(line.slice(0, index), style),
	width: estimateTextLineWidth(line, style),
});

export const DEFAULT_TEXT_FRAGMENT_UNIT =
	"word" as const satisfies TextFragmentUnit;

type ResolveOptions = {
	readonly measurer?: TextLineMeasurer;
	/** BCP-47 locale for `Intl.Segmenter`. Omit to use the host default. */
	readonly locale?: string;
};

/** One raw segment of a line before it is placed into the node coordinate space. */
type LineSegment = {
	readonly text: string;
	readonly start: number;
	readonly end: number;
	readonly selectable: boolean;
	readonly isWhitespace: boolean;
};

// --- Intl.Segmenter seam ------------------------------------------------------
// TypeScript's es2023 lib does not declare Intl.Segmenter, so a narrow structural
// interface is declared here and reached through a single typed `unknown` cast.
// This keeps the dependency lint-clean (no `any`) and lets the resolver fall back
// to deterministic splitting on engines/Workers without the API.

type IntlSegmentDatum = {
	readonly segment: string;
	readonly index: number;
	readonly isWordLike?: boolean;
};

type IntlSegmenterLike = {
	segment(input: string): Iterable<IntlSegmentDatum>;
};

type IntlSegmenterCtor = new (
	locale?: string,
	options?: { readonly granularity: "grapheme" | "word" | "sentence" },
) => IntlSegmenterLike;

const segmenterCtor = (): IntlSegmenterCtor | undefined => {
	const intl = Intl as unknown as { Segmenter?: IntlSegmenterCtor };
	return typeof intl.Segmenter === "function" ? intl.Segmenter : undefined;
};

const WHITESPACE = /^\s+$/u;

const isWhitespaceRun = (text: string): boolean =>
	text.length > 0 && WHITESPACE.test(text);

// --- Per-line segmentation ----------------------------------------------------

const wholeLineSegment = (line: string): readonly LineSegment[] => [
	{
		text: line,
		start: 0,
		end: line.length,
		selectable: true,
		isWhitespace: isWhitespaceRun(line),
	},
];

const graphemeSegments = (
	line: string,
	locale: string | undefined,
	excludeSpaces: boolean,
): readonly LineSegment[] => {
	const Ctor = segmenterCtor();
	const segments: LineSegment[] = [];
	if (Ctor) {
		const segmenter = new Ctor(locale, { granularity: "grapheme" });
		for (const datum of segmenter.segment(line)) {
			const whitespace = isWhitespaceRun(datum.segment);
			segments.push({
				text: datum.segment,
				start: datum.index,
				end: datum.index + datum.segment.length,
				selectable: !(excludeSpaces && whitespace),
				isWhitespace: whitespace,
			});
		}
		return segments;
	}
	// Fallback: code-point iteration keeps surrogate pairs and most emoji intact
	// (it does not join ZWJ sequences, but never splits a single code point).
	let cursor = 0;
	for (const codePoint of line) {
		const whitespace = isWhitespaceRun(codePoint);
		segments.push({
			text: codePoint,
			start: cursor,
			end: cursor + codePoint.length,
			selectable: !(excludeSpaces && whitespace),
			isWhitespace: whitespace,
		});
		cursor += codePoint.length;
	}
	return segments;
};

const wordSegments = (
	line: string,
	locale: string | undefined,
): readonly LineSegment[] => {
	const Ctor = segmenterCtor();
	const segments: LineSegment[] = [];
	if (Ctor) {
		const segmenter = new Ctor(locale, { granularity: "word" });
		for (const datum of segmenter.segment(line)) {
			const whitespace = isWhitespaceRun(datum.segment);
			segments.push({
				text: datum.segment,
				start: datum.index,
				end: datum.index + datum.segment.length,
				// `isWordLike` excludes spaces AND punctuation from the selectable order,
				// matching AE's "words" Based-On, while keeping them as rendered fragments.
				selectable: datum.isWordLike === true,
				isWhitespace: whitespace,
			});
		}
		return segments;
	}
	// Fallback: split on whitespace runs, keeping separators as non-selectable
	// fragments so positions and rendering stay complete.
	const parts = line.split(/(\s+)/u).filter((part) => part.length > 0);
	let cursor = 0;
	for (const part of parts) {
		const whitespace = isWhitespaceRun(part);
		segments.push({
			text: part,
			start: cursor,
			end: cursor + part.length,
			selectable: !whitespace,
			isWhitespace: whitespace,
		});
		cursor += part.length;
	}
	return segments;
};

const segmentLine = (
	line: string,
	unit: TextFragmentUnit,
	locale: string | undefined,
): readonly LineSegment[] => {
	switch (unit) {
		case "line":
			return wholeLineSegment(line);
		case "word":
			return wordSegments(line, locale);
		case "grapheme":
		case "character":
			return graphemeSegments(line, locale, false);
		case "character-no-spaces":
			return graphemeSegments(line, locale, true);
	}
};

// --- Source index mapping -----------------------------------------------------

/**
 * Start offset of each rendered line within the node's normalized text. Exact for
 * point text (lines are `\n`-split paragraphs); best-effort for wrapped area text,
 * where trimmed wrap spaces make an exact mapping impossible. Selectors key off
 * `orderIndex`, not these offsets, so motion stays correct either way — the offsets
 * are provenance for editing and future outline mapping.
 */
const lineSourceStarts = (
	text: string,
	lines: readonly string[],
): readonly number[] => {
	const starts: number[] = [];
	let cursor = 0;
	for (const line of lines) {
		const found = line.length === 0 ? cursor : text.indexOf(line, cursor);
		const start = found === -1 ? cursor : found;
		starts.push(start);
		cursor = start + line.length;
	}
	return starts;
};

const fragmentCenter = (bounds: Bounds): Vec2 => ({
	x: bounds.x + bounds.width / 2,
	y: bounds.y + bounds.height / 2,
});

/**
 * Normalizes one live text node into ordered text-motion fragments. This is the
 * first {@link TextMotionTarget} resolver; outline/imported groups will add their
 * own resolver that yields the same contract. Fragment x positions come from the
 * injected {@link TextLineMeasurer} (default = deterministic estimate), so on
 * browser surfaces split fragments overlay the plain `<text>` render exactly.
 *
 * `nodeId` is the owning scene node id, woven into every fragment id and the
 * `glyph-run` source so poses can be addressed back to the node at render time.
 */
export function resolveLiveTextFragments(
	nodeId: string,
	geometry: TextGeometry,
	unit: TextFragmentUnit,
	options: ResolveOptions = {},
): TextMotionTarget {
	const measurer = options.measurer ?? estimateTextLineMeasurer;
	const metrics = textMetricsForGeometry(geometry);
	const { style } = metrics;
	const normalizedText = normalizeTextContent(geometry.text);
	const lineStarts = lineSourceStarts(normalizedText, metrics.lines);

	const fragments: TextMotionFragment[] = [];
	let orderCursor = 0;

	metrics.lineMetrics.forEach((lineMetric, lineIndex) => {
		const lineText = metrics.lines[lineIndex] ?? "";
		const measure = measurer(lineText, style);
		const left = textLineLeftForAlign(
			geometry.bounds,
			style.align,
			measure.width,
		);
		const top = lineMetric.top;
		const height = lineMetric.bottom - lineMetric.top;
		const lineStart = lineStarts[lineIndex] ?? 0;

		for (const segment of segmentLine(lineText, unit, options.locale)) {
			const x = left + measure.advanceAt(segment.start);
			const width =
				measure.advanceAt(segment.end) - measure.advanceAt(segment.start);
			const bounds: Bounds = { x, y: top, width, height };
			const orderIndex = segment.selectable ? orderCursor : -1;
			if (segment.selectable) orderCursor += 1;
			const sourceStart = lineStart + segment.start;
			const sourceEnd = lineStart + segment.end;
			fragments.push({
				id: `${nodeId}:${unit}:${lineIndex}:${sourceStart}`,
				unit,
				orderIndex,
				selectable: segment.selectable,
				lineIndex,
				text: segment.text,
				isWhitespace: segment.isWhitespace,
				bounds,
				baseline: lineMetric.baseline,
				source: {
					kind: "glyph-run",
					nodeId,
					sourceStart,
					sourceEnd,
				},
			});
		}
	});

	return {
		kind: "live-text",
		fragments,
		selectableCount: orderCursor,
	};
}

export { fragmentCenter };

// --- Outline-group resolver (scene-node fragments) ----------------------------

/**
 * One member of a text-fragment group: a real scene node that *is* a fragment.
 * `orderIndex` is the reading order the selector sweeps (independent of z-order in
 * `children`); `selectable` excludes spaces/punctuation the same way live text does.
 */
export type TextFragmentGroupMember = {
	readonly nodeId: string;
	readonly orderIndex: number;
	readonly selectable: boolean;
};

/**
 * Provenance stored on a group node marking its children as ordered text-motion
 * fragments — the SceneDocument-side membership a `outline-group` animator binds to.
 * Generated by a future "bake/explode text" op (or by outline import); the motion
 * side only references the group id and reads this for order.
 */
export type TextFragmentGroupProvenance = {
	readonly unit: TextFragmentUnit;
	readonly members: readonly TextFragmentGroupMember[];
};

const textOfNode = (node: VectorNode): string =>
	node.geometry.kind === "text" ? node.geometry.text : node.name;

/**
 * Normalizes a group of real sub-nodes into the SAME ordered-fragment contract as
 * live text, so one Range Selector evaluator drives both. Each fragment's `source`
 * is `scene-node`, so the pose is composed onto that real node's transform/opacity
 * at sample time (not by splitting `<text>`). Bounds come from each child's geometry
 * — its center is the rotate/scale pivot. Members missing from `children` are
 * skipped. Reading order is `member.orderIndex`, re-indexed densely over selectable
 * members so the selector denominator matches live text.
 */
export function resolveOutlineGroupFragments(
	group: VectorNode,
): TextMotionTarget {
	const provenance = group.textFragmentGroup;
	if (!provenance) {
		return { kind: "outline-group", fragments: [], selectableCount: 0 };
	}
	const childById = new Map(
		(group.children ?? []).map((child) => [child.id, child] as const),
	);
	const ordered = [...provenance.members].sort(
		(a, b) => a.orderIndex - b.orderIndex,
	);
	let selectableCount = 0;
	const fragments: TextMotionFragment[] = [];
	for (const member of ordered) {
		const child = childById.get(member.nodeId);
		if (!child) continue;
		const bounds = getGeometryBounds(child.geometry);
		const orderIndex = member.selectable ? selectableCount : -1;
		if (member.selectable) selectableCount += 1;
		fragments.push({
			id: `${group.id}:outline:${member.nodeId}`,
			unit: provenance.unit,
			orderIndex,
			selectable: member.selectable,
			lineIndex: 0,
			text: textOfNode(child),
			isWhitespace: false,
			bounds,
			baseline: bounds.y + bounds.height,
			source: { kind: "scene-node", nodeId: member.nodeId },
		});
	}
	return { kind: "outline-group", fragments, selectableCount };
}
