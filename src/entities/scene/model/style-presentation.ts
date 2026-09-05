import type { ResolvedNodeStyle } from "./style-resolve";
import {
	DEFAULT_BLEND_MODE,
	DEFAULT_STROKE_CAP,
	DEFAULT_STROKE_JOIN,
	DEFAULT_STROKE_MITER_LIMIT,
} from "./style-resolve";
import type { BlendMode, StrokeCap, StrokeJoin } from "./types";

/**
 * SVG presentation attributes for a node's stroke sub-options, named with the
 * React/DOM camelCase keys so the live canvas renderer can spread them directly
 * onto a shape element. The SVG exporter consumes the same values, mapping the
 * keys to their kebab attribute names. Centralizing the derivation here is the
 * point: canvas and export previously each computed these inline and drifted,
 * which is why dashes/caps/joins exported but never appeared on the live canvas.
 */
export type StrokePresentation = {
	readonly strokeDasharray?: string;
	readonly strokeDashoffset?: number;
	readonly strokeLinecap?: StrokeCap;
	readonly strokeLinejoin?: StrokeJoin;
	readonly strokeMiterlimit?: number;
};

/**
 * Maps a resolved node style's stroke sub-options into shared presentation
 * attributes. Only non-default values are emitted so the attribute set stays
 * minimal and both render surfaces agree. `hasStroke` gates cap/join/miter,
 * which are meaningless without a painted stroke; the dash array (and its
 * offset) is emitted whenever present because a dash on a zero-width stroke
 * is simply invisible, matching how the SVG exporter already behaves.
 */
export function strokePresentation(
	style: ResolvedNodeStyle,
	hasStroke: boolean,
): StrokePresentation {
	const presentation: {
		strokeDasharray?: string;
		strokeDashoffset?: number;
		strokeLinecap?: StrokeCap;
		strokeLinejoin?: StrokeJoin;
		strokeMiterlimit?: number;
	} = {};
	if (style.strokeDash.length > 0) {
		presentation.strokeDasharray = style.strokeDash.join(" ");
		if (style.strokeDashoffset !== 0) {
			presentation.strokeDashoffset = style.strokeDashoffset;
		}
	}
	if (hasStroke && style.strokeCap !== DEFAULT_STROKE_CAP) {
		presentation.strokeLinecap = style.strokeCap;
	}
	if (hasStroke && style.strokeJoin !== DEFAULT_STROKE_JOIN) {
		presentation.strokeLinejoin = style.strokeJoin;
	}
	if (
		hasStroke &&
		style.strokeJoin === DEFAULT_STROKE_JOIN &&
		style.strokeMiterLimit !== DEFAULT_STROKE_MITER_LIMIT
	) {
		presentation.strokeMiterlimit = style.strokeMiterLimit;
	}
	return presentation;
}

/**
 * The CSS blend mode for a node group, or `undefined` when it is the default
 * `"normal"` (no `mix-blend-mode` needed). Both canvas and export apply blend on
 * the node's wrapping `<g>` with this same gate so the composited result agrees.
 */
export function blendModePresentation(
	style: ResolvedNodeStyle,
): BlendMode | undefined {
	return style.blendMode === DEFAULT_BLEND_MODE ? undefined : style.blendMode;
}
