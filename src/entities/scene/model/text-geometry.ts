import { DEFAULT_CODE_SAFE_TEXT_FONT_FAMILY } from "./text-fonts";
import type {
	Bounds,
	TextAlign,
	TextGeometry,
	TextResizeMode,
	TextStyle,
	Vec2,
} from "./types";

export const DEFAULT_TEXT_STYLE = {
	fontFamily: DEFAULT_CODE_SAFE_TEXT_FONT_FAMILY,
	fontSize: 46,
	lineHeight: 56,
	align: "left",
	fontWeight: 750,
	letterSpacing: 0,
	italic: false,
	underline: false,
} as const satisfies TextStyle;

/**
 * Numeric font-weight endpoints for the binary bold toggle. Font weight is a
 * continuous 1..1000 scene value, so "bold" is a heuristic: any weight at or
 * above {@link BOLD_WEIGHT_THRESHOLD} reads as bold. Toggling off therefore
 * snaps to {@link REGULAR_FONT_WEIGHT} rather than restoring a remembered custom
 * weight — a deliberate v1 simplification for a single bold button. Note the
 * default text weight (750) already reads as bold, so the first toggle on
 * untouched text drops it to 400.
 */
export const REGULAR_FONT_WEIGHT = 400;
export const BOLD_FONT_WEIGHT = 700;
export const BOLD_WEIGHT_THRESHOLD = 600;

const TEXT_ALIGN_VALUES = ["left", "center", "right"] as const;
const TEXT_RESIZE_MODE_VALUES = ["point", "area"] as const;
const MIN_TEXT_WIDTH_EM = 148 / DEFAULT_TEXT_STYLE.fontSize;
const HORIZONTAL_PADDING_EM = 20 / DEFAULT_TEXT_STYLE.fontSize;
const AVERAGE_CHARACTER_WIDTH_EM = 27 / DEFAULT_TEXT_STYLE.fontSize;
const ESTIMATED_ASCENT_EM = 0.8;
const ESTIMATED_DESCENT_EM = 0.2;

export const TEXT_METRICS_FALLBACK = {
	kind: "estimated",
	widthModel: "average-character-em",
	lineModel: "font-size-ascent-descent",
} as const;

export type NormalizedTextGeometry = Omit<
	TextGeometry,
	"mode" | "style" | "text"
> & {
	readonly text: string;
	readonly mode: TextResizeMode;
	readonly style: TextStyle;
};

export type TextStyleField = keyof TextStyle;

/**
 * Records whether a partial scene text style needed fallback or normalization.
 * Export reports use this instead of guessing which typography values were
 * persisted by the document.
 */
export type TextStyleResolution = {
	readonly style: TextStyle;
	readonly fallbackFields: readonly TextStyleField[];
	readonly normalizedFields: readonly TextStyleField[];
};

/**
 * Deterministic font-box values used when no browser/font engine is available.
 * Values are scene units, derived only from normalized font size and line height.
 */
export type TextFontMetrics = {
	readonly kind: typeof TEXT_METRICS_FALLBACK.kind;
	readonly widthModel: typeof TEXT_METRICS_FALLBACK.widthModel;
	readonly lineModel: typeof TEXT_METRICS_FALLBACK.lineModel;
	readonly averageCharacterWidthEm: number;
	readonly ascent: number;
	readonly descent: number;
	readonly leading: number;
	readonly baselineOffset: number;
};

/**
 * One line box in scene coordinates. `top` is the text box top edge, while
 * `baseline` is what SVG/PDF adapters should use for alphabetic text placement.
 */
export type TextLineMetric = {
	readonly index: number;
	readonly text: string;
	readonly width: number;
	readonly top: number;
	readonly baseline: number;
	readonly bottom: number;
};

/**
 * Deterministic layout facts for one text node. These are estimates, not font
 * engine measurements, and are safe to use in Worker/export code.
 */
export type TextMetrics = {
	readonly lines: readonly string[];
	readonly lineWidths: readonly number[];
	readonly lineMetrics: readonly TextLineMetric[];
	readonly naturalBounds: Bounds;
	readonly style: TextStyle;
	readonly styleResolution: TextStyleResolution;
	readonly fontMetrics: TextFontMetrics;
};

export type TextLayoutResult = {
	readonly mode: TextResizeMode;
	readonly authoredBounds: Bounds;
	readonly contentBounds: Bounds;
	readonly renderBounds: Bounds;
	readonly overflowY: number;
	readonly fits: boolean;
	readonly metrics: TextMetrics;
};

export type TextBoxResizeHandle =
	| "nw"
	| "n"
	| "ne"
	| "e"
	| "se"
	| "s"
	| "sw"
	| "w";

export type TextBoxResizeOptions = {
	readonly constrain?: boolean;
	readonly fromCenter?: boolean;
};

const isTextAlign = (value: unknown): value is TextAlign =>
	TEXT_ALIGN_VALUES.includes(value as TextAlign);

const isTextResizeMode = (value: unknown): value is TextResizeMode =>
	TEXT_RESIZE_MODE_VALUES.includes(value as TextResizeMode);

type ResizeHandleAxes = {
	readonly fixedX: 0 | 1;
	readonly fixedY: 0 | 1;
	readonly activeX: boolean;
	readonly activeY: boolean;
};

const TEXT_BOX_HANDLE_AXES: Record<TextBoxResizeHandle, ResizeHandleAxes> = {
	se: { fixedX: 0, fixedY: 0, activeX: true, activeY: true },
	nw: { fixedX: 1, fixedY: 1, activeX: true, activeY: true },
	ne: { fixedX: 0, fixedY: 1, activeX: true, activeY: true },
	sw: { fixedX: 1, fixedY: 0, activeX: true, activeY: true },
	e: { fixedX: 0, fixedY: 0, activeX: true, activeY: false },
	w: { fixedX: 1, fixedY: 0, activeX: true, activeY: false },
	s: { fixedX: 0, fixedY: 0, activeX: false, activeY: true },
	n: { fixedX: 0, fixedY: 1, activeX: false, activeY: true },
};

type ResolvedField<T> = {
	readonly value: T;
	readonly fallback: boolean;
	readonly normalized: boolean;
};

const resolvedFontFamily = (value: unknown): ResolvedField<string> => {
	if (typeof value !== "string") {
		return {
			value: DEFAULT_TEXT_STYLE.fontFamily,
			fallback: true,
			normalized: false,
		};
	}
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		return {
			value: DEFAULT_TEXT_STYLE.fontFamily,
			fallback: true,
			normalized: false,
		};
	}
	return {
		value: trimmed,
		fallback: false,
		normalized: trimmed !== value,
	};
};

const resolvedPositiveNumber = (
	value: unknown,
	fallback: number,
): ResolvedField<number> => {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return { value: fallback, fallback: true, normalized: false };
	}
	return { value, fallback: false, normalized: false };
};

const resolvedTextAlign = (value: unknown): ResolvedField<TextAlign> =>
	isTextAlign(value)
		? { value, fallback: false, normalized: false }
		: { value: DEFAULT_TEXT_STYLE.align, fallback: true, normalized: false };

const resolvedFontWeight = (value: unknown): ResolvedField<number> => {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return {
			value: DEFAULT_TEXT_STYLE.fontWeight,
			fallback: true,
			normalized: false,
		};
	}
	const normalized = Math.min(1000, Math.max(1, Math.round(value)));
	return {
		value: normalized,
		fallback: false,
		normalized: !Object.is(normalized, value),
	};
};

/**
 * Resolves tracking. Unlike size/line-height this allows any finite value,
 * including negatives (tighter text) and `0` (default). It is intentionally
 * NEVER reported as a fallback or normalization: an absent tracking value is
 * exactly `0` (no tracking) with zero fidelity loss, so flagging it would make
 * export reports claim a text-style approximation that did not actually happen.
 * This is why letter spacing is the one `TextStyle` field excluded from the
 * `resolveTextStyle` fallback/normalized accounting below.
 */
const resolvedLetterSpacing = (value: unknown): ResolvedField<number> => {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return {
			value: DEFAULT_TEXT_STYLE.letterSpacing,
			fallback: false,
			normalized: false,
		};
	}
	return { value, fallback: false, normalized: false };
};

/**
 * Resolves an optional typography flag (italic/underline) to a concrete boolean.
 * Like {@link resolvedLetterSpacing} it is never reported as a fallback or
 * normalization: an absent flag is exactly `false` with zero fidelity loss, so
 * flagging it would make export reports claim a text-style approximation that
 * never happened. Only a literal `true` enables the flag; any other value
 * (including a corrupt non-boolean) resolves to `false`.
 */
const resolvedTextFlag = (value: unknown): ResolvedField<boolean> => ({
	value: value === true,
	fallback: false,
	normalized: false,
});

const fallbackAndNormalizedFields = (
	fields: readonly (readonly [TextStyleField, ResolvedField<unknown>])[],
): Pick<TextStyleResolution, "fallbackFields" | "normalizedFields"> => ({
	fallbackFields: fields
		.filter(([, result]) => result.fallback)
		.map(([field]) => field),
	normalizedFields: fields
		.filter(([, result]) => result.normalized)
		.map(([field]) => field),
});

const textFontMetricsFromStyle = (style: TextStyle): TextFontMetrics => {
	const leading = style.lineHeight - style.fontSize;
	const ascent = style.fontSize * ESTIMATED_ASCENT_EM;
	const descent = style.fontSize * ESTIMATED_DESCENT_EM;
	return {
		...TEXT_METRICS_FALLBACK,
		averageCharacterWidthEm: AVERAGE_CHARACTER_WIDTH_EM,
		ascent,
		descent,
		leading,
		baselineOffset: leading / 2 + ascent,
	};
};

const lineMetricsForLines = (
	lines: readonly string[],
	lineWidths: readonly number[],
	bounds: Bounds,
	style: TextStyle,
	fontMetrics: TextFontMetrics,
): readonly TextLineMetric[] =>
	lines.map((line, index) => {
		const top = bounds.y + index * style.lineHeight;
		return {
			index,
			text: line,
			width: lineWidths[index] ?? 0,
			top,
			baseline: top + fontMetrics.baselineOffset,
			bottom: top + style.lineHeight,
		};
	});

/**
 * Keeps text content deterministic across input surfaces and export adapters.
 * Scene text remains an ordinary string, but CRLF/CR drafts are normalized to
 * LF so multiline editing, render signatures, and SVG output agree byte-for-byte.
 */
export function normalizeTextContent(text: string): string {
	return text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

/** Resolves legacy text geometry to point text unless an area box was authored. */
export function normalizeTextResizeMode(value: unknown): TextResizeMode {
	return isTextResizeMode(value) ? value : "point";
}

/**
 * Resolves partial typography into concrete scene style and records the exact
 * fields that fell back or were normalized. This keeps renderer issue metadata
 * aligned with the same rules used by canvas editing and scene commands.
 */
export function resolveTextStyle(
	style?: Partial<TextStyle>,
): TextStyleResolution {
	const fontFamily = resolvedFontFamily(style?.fontFamily);
	const fontSize = resolvedPositiveNumber(
		style?.fontSize,
		DEFAULT_TEXT_STYLE.fontSize,
	);
	const lineHeight = resolvedPositiveNumber(
		style?.lineHeight,
		DEFAULT_TEXT_STYLE.lineHeight,
	);
	const align = resolvedTextAlign(style?.align);
	const fontWeight = resolvedFontWeight(style?.fontWeight);
	const letterSpacing = resolvedLetterSpacing(style?.letterSpacing);
	const italic = resolvedTextFlag(style?.italic);
	const underline = resolvedTextFlag(style?.underline);
	// letterSpacing, italic, and underline are deliberately absent from this list:
	// they never fall back or normalize (see resolvedLetterSpacing/resolvedTextFlag),
	// so including them would emit false fidelity-loss claims in export reports.
	const fields = [
		["fontFamily", fontFamily],
		["fontSize", fontSize],
		["lineHeight", lineHeight],
		["align", align],
		["fontWeight", fontWeight],
	] as const satisfies readonly (readonly [
		TextStyleField,
		ResolvedField<unknown>,
	])[];

	return {
		style: {
			fontFamily: fontFamily.value,
			fontSize: fontSize.value,
			lineHeight: lineHeight.value,
			align: align.value,
			fontWeight: fontWeight.value,
			letterSpacing: letterSpacing.value,
			italic: italic.value,
			underline: underline.value,
		},
		...fallbackAndNormalizedFields(fields),
	};
}

/**
 * Whether a font weight reads as bold for the binary bold toggle. See
 * {@link BOLD_WEIGHT_THRESHOLD} for the heuristic the editor commits to.
 */
export function isBoldWeight(fontWeight: number): boolean {
	return fontWeight >= BOLD_WEIGHT_THRESHOLD;
}

/**
 * Target weight for toggling bold across a set of weights. Follows the Figma
 * convention: if every value already reads bold, the toggle turns bold off
 * (regular); otherwise it makes the whole set bold. An empty set is treated as
 * not-yet-bold so a fresh toggle turns bold on.
 */
export function resolveBoldToggleWeight(
	fontWeights: readonly number[],
): number {
	const allBold =
		fontWeights.length > 0 &&
		fontWeights.every((weight) => isBoldWeight(weight));
	return allBold ? REGULAR_FONT_WEIGHT : BOLD_FONT_WEIGHT;
}

/**
 * Target value for toggling a boolean typography flag (italic/underline) across
 * a selection. Mirrors {@link resolveBoldToggleWeight}: enabled only when not
 * every value is already enabled, so a mixed selection turns the flag fully on
 * before it can turn fully off.
 */
export function resolveTextFlagToggle(values: readonly boolean[]): boolean {
	return !(values.length > 0 && values.every(Boolean));
}

/**
 * Converts optional persisted typography into the full text style contract.
 * Missing or invalid values fall back deterministically so old `{ kind: "text",
 * bounds, text }` geometry stays readable without a document migration.
 */
export function normalizeTextStyle(style?: Partial<TextStyle>): TextStyle {
	return resolveTextStyle(style).style;
}

/**
 * Returns a copy of text geometry with normalized text content and a complete
 * typography style. Callers should render from this helper rather than reading
 * optional style fields directly.
 */
export function normalizeTextGeometry(
	geometry: TextGeometry,
): NormalizedTextGeometry {
	return {
		...geometry,
		text: normalizeTextContent(geometry.text),
		mode: normalizeTextResizeMode(geometry.mode),
		style: normalizeTextStyle(geometry.style),
	};
}

/**
 * Splits text node content for SVG-style line rendering while preserving empty
 * text and intentional blank lines. An empty string still renders as one line so
 * the node keeps an addressable SVG text element.
 */
export function textLinesForGeometry(
	geometry: TextGeometry,
): readonly string[] {
	const normalized = normalizeTextGeometry(geometry);
	return linesForTextLayout(
		normalized.text,
		normalized.style,
		normalized.mode,
		normalized.bounds.width,
	);
}

/**
 * Deterministic text width estimate used by canvas authoring and export
 * fallbacks. It deliberately avoids browser font measurement so Worker/PDF/SVG
 * paths stay byte-stable. Tracking is modeled per glyph (`glyphCount ×
 * letterSpacing`), matching the CSS overlay the user edits in, so the estimate
 * stays internally consistent with the alignment fallback and export metadata.
 * Negative tracking narrows the estimate; the line width can therefore go below
 * the glyph-only width but is never used directly without the bounds floor.
 */
export function estimateTextLineWidth(
	line: string,
	style: Partial<TextStyle> = DEFAULT_TEXT_STYLE,
): number {
	const normalized = normalizeTextStyle(style);
	const glyphCount = Array.from(line).length;
	return (
		glyphCount * normalized.fontSize * AVERAGE_CHARACTER_WIDTH_EM +
		glyphCount * normalized.letterSpacing
	);
}

/**
 * Returns the deterministic font-box metrics used by editor/export fallbacks.
 * This deliberately does not inspect installed fonts; it only reflects the
 * normalized scene style.
 */
export function textFontMetricsForStyle(
	style: Partial<TextStyle> = DEFAULT_TEXT_STYLE,
): TextFontMetrics {
	return textFontMetricsFromStyle(normalizeTextStyle(style));
}

const longestLineWidth = (lines: readonly string[], style: TextStyle): number =>
	lines.reduce(
		(longest, line) => Math.max(longest, estimateTextLineWidth(line, style)),
		0,
	);

const finiteOr = (value: number, fallback: number): number =>
	Number.isFinite(value) ? value : fallback;

const minimumTextBoxSize = (
	style: Partial<TextStyle> = DEFAULT_TEXT_STYLE,
): Pick<Bounds, "width" | "height"> => {
	const normalized = normalizeTextStyle(style);
	return {
		width: normalized.fontSize,
		height: normalized.lineHeight,
	};
};

const scaledBoundsAbout = (
	bounds: Bounds,
	pivot: Vec2,
	scaleX: number,
	scaleY: number,
	style: Partial<TextStyle>,
): Bounds =>
	clampTextBoxBounds(
		{
			x: pivot.x + (bounds.x - pivot.x) * scaleX,
			y: pivot.y + (bounds.y - pivot.y) * scaleY,
			width: bounds.width * scaleX,
			height: bounds.height * scaleY,
		},
		style,
	);

const boundsUnion = (a: Bounds, b: Bounds): Bounds => {
	const minX = Math.min(a.x, b.x);
	const minY = Math.min(a.y, b.y);
	const maxX = Math.max(a.x + a.width, b.x + b.width);
	const maxY = Math.max(a.y + a.height, b.y + b.height);
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

export function clampTextBoxBounds(
	bounds: Bounds,
	style: Partial<TextStyle> = DEFAULT_TEXT_STYLE,
): Bounds {
	const min = minimumTextBoxSize(style);
	return {
		x: finiteOr(bounds.x, 0),
		y: finiteOr(bounds.y, 0),
		width: Math.max(min.width, finiteOr(bounds.width, min.width)),
		height: Math.max(min.height, finiteOr(bounds.height, min.height)),
	};
}

const trimTrailingWrapSpace = (line: string): string =>
	line.replace(/\s+$/u, "");

const breakLongToken = (
	token: string,
	maxWidth: number,
	style: TextStyle,
): readonly string[] => {
	const chars = Array.from(token);
	const lines: string[] = [];
	let current = "";
	for (const char of chars) {
		const candidate = `${current}${char}`;
		if (current && estimateTextLineWidth(candidate, style) > maxWidth) {
			lines.push(current);
			current = char;
			continue;
		}
		current = candidate;
	}
	if (current) lines.push(current);
	return lines.length > 0 ? lines : [token];
};

const wrapParagraph = (
	paragraph: string,
	maxWidth: number,
	style: TextStyle,
): readonly string[] => {
	if (paragraph.length === 0) return [""];
	const tokens = paragraph.split(/(\s+)/u).filter((token) => token.length > 0);
	const lines: string[] = [];
	let current = "";
	for (const token of tokens) {
		if (
			!current &&
			token.trim().length > 0 &&
			estimateTextLineWidth(token, style) > maxWidth
		) {
			const broken = breakLongToken(token.trimStart(), maxWidth, style);
			lines.push(...broken.slice(0, -1));
			current = broken.at(-1) ?? "";
			continue;
		}
		const candidate = `${current}${token}`;
		if (!current || estimateTextLineWidth(candidate, style) <= maxWidth) {
			current = candidate;
			continue;
		}
		if (token.trim().length === 0) continue;
		const trimmedCurrent = trimTrailingWrapSpace(current);
		if (trimmedCurrent) lines.push(trimmedCurrent);
		if (estimateTextLineWidth(token, style) <= maxWidth) {
			current = token.trimStart();
			continue;
		}
		const broken = breakLongToken(token.trimStart(), maxWidth, style);
		lines.push(...broken.slice(0, -1));
		current = broken.at(-1) ?? "";
	}
	const finalLine = trimTrailingWrapSpace(current);
	if (finalLine || lines.length === 0) lines.push(finalLine);
	return lines;
};

const linesForTextLayout = (
	text: string,
	style: TextStyle,
	mode: TextResizeMode,
	width: number,
): readonly string[] => {
	const paragraphs = normalizeTextContent(text).split("\n");
	if (mode === "point") return paragraphs;
	const maxWidth = Math.max(style.fontSize, width);
	return paragraphs.flatMap((paragraph) =>
		wrapParagraph(paragraph, maxWidth, style),
	);
};

/**
 * Estimates editable text bounds from content and typography while preserving a
 * deterministic fallback model across canvas, tests, and export adapters.
 */
export function textBoundsForContent(
	origin: Vec2,
	text: string,
	style: Partial<TextStyle> = DEFAULT_TEXT_STYLE,
): Bounds {
	const normalized = normalizeTextStyle(style);
	const lines = normalizeTextContent(text).split("\n");
	const minWidth = normalized.fontSize * MIN_TEXT_WIDTH_EM;
	const padding = normalized.fontSize * HORIZONTAL_PADDING_EM;
	const width = Math.max(
		minWidth,
		longestLineWidth(lines, normalized) + padding,
	);
	return {
		x: origin.x,
		y: origin.y,
		width,
		height: Math.max(
			normalized.lineHeight,
			lines.length * normalized.lineHeight,
		),
	};
}

/**
 * Recomputes text bounds from an existing text box origin. Use this when a text
 * edit or typography edit changes the natural footprint of the node.
 */
export function resizedTextBoundsForGeometry(
	current: Bounds,
	text: string,
	style: Partial<TextStyle> = DEFAULT_TEXT_STYLE,
	mode: TextResizeMode = "point",
): Bounds {
	if (mode === "area") {
		const normalizedStyle = normalizeTextStyle(style);
		const lines = linesForTextLayout(
			text,
			normalizedStyle,
			"area",
			current.width,
		);
		return {
			...current,
			height: Math.max(
				current.height,
				normalizedStyle.lineHeight,
				lines.length * normalizedStyle.lineHeight,
			),
		};
	}
	return textBoundsForContent({ x: current.x, y: current.y }, text, style);
}

/**
 * Resizes an authored area-text box in local text coordinates. The helper
 * mirrors the transform tool's fixed-edge handle semantics but returns geometry
 * bounds instead of a scale matrix, so glyphs keep their size while wrapping
 * changes inside the text box.
 */
export function resizeTextBoxBoundsForHandle(
	current: Bounds,
	pointer: Vec2,
	handle: TextBoxResizeHandle,
	style: Partial<TextStyle> = DEFAULT_TEXT_STYLE,
	options: TextBoxResizeOptions = {},
): Bounds {
	const axes = TEXT_BOX_HANDLE_AXES[handle];
	const center = {
		x: current.x + current.width / 2,
		y: current.y + current.height / 2,
	};
	const proportionalEdge =
		options.constrain === true && axes.activeX !== axes.activeY;
	const fixed = options.fromCenter
		? center
		: {
				x:
					proportionalEdge && !axes.activeX
						? center.x
						: axes.fixedX === 0
							? current.x
							: current.x + current.width,
				y:
					proportionalEdge && !axes.activeY
						? center.y
						: axes.fixedY === 0
							? current.y
							: current.y + current.height,
			};
	const movingX = axes.fixedX === 0 ? current.x + current.width : current.x;
	const movingY = axes.fixedY === 0 ? current.y + current.height : current.y;
	const min = minimumTextBoxSize(style);
	const scaleMinX = current.width === 0 ? 1 : min.width / current.width;
	const scaleMinY = current.height === 0 ? 1 : min.height / current.height;
	const ratio = (numerator: number, denominator: number, minimum: number) =>
		denominator === 0 ? 1 : Math.max(minimum, numerator / denominator);
	let scaleX = axes.activeX
		? ratio(pointer.x - fixed.x, movingX - fixed.x, scaleMinX)
		: 1;
	let scaleY = axes.activeY
		? ratio(pointer.y - fixed.y, movingY - fixed.y, scaleMinY)
		: 1;
	if (options.constrain && axes.activeX && axes.activeY) {
		const uniform = Math.max(scaleX, scaleY);
		scaleX = uniform;
		scaleY = uniform;
	} else if (options.constrain && axes.activeX) {
		scaleY = scaleX;
	} else if (options.constrain && axes.activeY) {
		scaleX = scaleY;
	}
	scaleX = Math.max(scaleMinX, scaleX);
	scaleY = Math.max(scaleMinY, scaleY);
	return scaledBoundsAbout(current, fixed, scaleX, scaleY, style);
}

/**
 * Provides line metrics and natural bounds for text content without mutating the
 * scene. Exporters use the line widths and baselines for deterministic alignment
 * fallback when native font metrics are unavailable.
 */
export function textMetricsForContent(
	bounds: Bounds,
	text: string,
	style?: Partial<TextStyle>,
	mode: TextResizeMode = "point",
): TextMetrics {
	const normalizedText = normalizeTextContent(text);
	const styleResolution = resolveTextStyle(style);
	const normalizedMode = normalizeTextResizeMode(mode);
	const lines = linesForTextLayout(
		normalizedText,
		styleResolution.style,
		normalizedMode,
		bounds.width,
	);
	const lineWidths = lines.map((line) =>
		estimateTextLineWidth(line, styleResolution.style),
	);
	const fontMetrics = textFontMetricsFromStyle(styleResolution.style);
	return {
		lines,
		lineWidths,
		lineMetrics: lineMetricsForLines(
			lines,
			lineWidths,
			bounds,
			styleResolution.style,
			fontMetrics,
		),
		naturalBounds:
			normalizedMode === "area"
				? resizedTextBoundsForGeometry(
						bounds,
						normalizedText,
						styleResolution.style,
						"area",
					)
				: textBoundsForContent(
						{ x: bounds.x, y: bounds.y },
						normalizedText,
						styleResolution.style,
					),
		style: styleResolution.style,
		styleResolution,
		fontMetrics,
	};
}

/**
 * Provides line metrics and natural bounds for a text geometry without mutating
 * the scene. Exporters use the line widths and baselines for deterministic
 * alignment fallback.
 */
export function textMetricsForGeometry(geometry: TextGeometry): TextMetrics {
	const normalized = normalizeTextGeometry(geometry);
	return textMetricsForContent(
		normalized.bounds,
		normalized.text,
		geometry.style,
		normalized.mode,
	);
}

/**
 * Returns the authored box, content footprint, and overflow state for one text
 * geometry without persisting layout data. Renderers can use this as a shared
 * contract while the scene model stays compact and backward-compatible.
 */
export function textLayoutForGeometry(
	geometry: TextGeometry,
): TextLayoutResult {
	const normalized = normalizeTextGeometry(geometry);
	const metrics = textMetricsForGeometry(geometry);
	const lineHeight = metrics.style.lineHeight;
	const contentHeight = Math.max(lineHeight, metrics.lines.length * lineHeight);
	const lineLefts = metrics.lineWidths.map((width) =>
		textLineLeftForAlign(normalized.bounds, metrics.style.align, width),
	);
	const contentBounds =
		normalized.mode === "area"
			? {
					x: Math.min(normalized.bounds.x, ...lineLefts),
					y: normalized.bounds.y,
					width:
						Math.max(
							normalized.bounds.x + normalized.bounds.width,
							...lineLefts.map(
								(left, index) => left + (metrics.lineWidths[index] ?? 0),
							),
						) - Math.min(normalized.bounds.x, ...lineLefts),
					height: contentHeight,
				}
			: metrics.naturalBounds;
	const overflowY =
		normalized.mode === "area"
			? Math.max(0, contentBounds.height - normalized.bounds.height)
			: 0;
	const maxLineWidth = metrics.lineWidths.reduce(
		(max, width) => Math.max(max, width),
		0,
	);
	const fits =
		normalized.mode === "point" ||
		(overflowY === 0 && maxLineWidth <= normalized.bounds.width + 1e-6);
	return {
		mode: normalized.mode,
		authoredBounds: normalized.bounds,
		contentBounds,
		renderBounds:
			normalized.mode === "area"
				? boundsUnion(normalized.bounds, contentBounds)
				: contentBounds,
		overflowY,
		fits,
		metrics,
	};
}

/**
 * Returns the SVG text anchor x-coordinate for the scene text alignment.
 */
export function textAnchorXForAlign(bounds: Bounds, align: TextAlign): number {
	switch (align) {
		case "left":
			return bounds.x;
		case "center":
			return bounds.x + bounds.width / 2;
		case "right":
			return bounds.x + bounds.width;
	}
}

/**
 * Maps scene text alignment onto SVG's text-anchor vocabulary.
 */
export function svgTextAnchorForAlign(
	align: TextAlign,
): "start" | "middle" | "end" {
	switch (align) {
		case "left":
			return "start";
		case "center":
			return "middle";
		case "right":
			return "end";
	}
}

/**
 * Returns a deterministic left-edge fallback for renderers without native text
 * alignment support, such as the minimal PDF writer.
 */
export function textLineLeftForAlign(
	bounds: Bounds,
	align: TextAlign,
	lineWidth: number,
): number {
	switch (align) {
		case "left":
			return bounds.x;
		case "center":
			return bounds.x + (bounds.width - lineWidth) / 2;
		case "right":
			return bounds.x + bounds.width - lineWidth;
	}
}
