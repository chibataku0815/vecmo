import {
	estimateTextLineMeasurer,
	type TextLineMeasurer,
} from "./text-fragments";
import type { TextStyle } from "./types";

/**
 * Browser text measurer for the split-fragment renderer. It uses a shared offscreen
 * Canvas 2D context so a fragment's left edge matches where the browser lays the
 * glyph out in the full line — far closer than the deterministic estimate on
 * multi-glyph or center/right-aligned lines. Both the editor canvas and the browser
 * WebM exporter inject THIS measurer so their fragment positions agree; static SVG /
 * Worker export keep the estimate default (no DOM there).
 *
 * It lives in `entities/scene` rather than a widget so `features/export` can import
 * it too (a widget import would violate the feature→widget direction). Canvas
 * `measureText` ignores CSS letter-spacing, so it is added per glyph to mirror the
 * `<text letter-spacing>` the line actually renders with. Falls back to the estimate
 * when no DOM/canvas is available, so the same code path is safe under SSR/tests.
 */

let cachedContext: CanvasRenderingContext2D | null | undefined;

const measureContext = (): CanvasRenderingContext2D | null => {
	if (cachedContext !== undefined) return cachedContext;
	const canvas =
		typeof document !== "undefined" ? document.createElement("canvas") : null;
	cachedContext = canvas?.getContext("2d") ?? null;
	return cachedContext;
};

const fontShorthand = (style: TextStyle): string =>
	`${style.italic ? "italic " : ""}${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`;

export const canvasTextLineMeasurer: TextLineMeasurer = (line, style) => {
	const context = measureContext();
	if (!context) return estimateTextLineMeasurer(line, style);
	context.font = fontShorthand(style);
	const advanceAt = (index: number): number => {
		const prefix = line.slice(0, index);
		const glyphCount = Array.from(prefix).length;
		return context.measureText(prefix).width + glyphCount * style.letterSpacing;
	};
	return {
		advanceAt,
		width: advanceAt(line.length),
	};
};
