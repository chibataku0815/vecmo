/**
 * Pure model for the user-resizable editor side panels (layers + inspector):
 * width constants, the clamp/drag math, and the localStorage payload codec.
 *
 * Lives in `shared` on purpose — both the editor UI store (a feature) and the
 * presentational resize handle (`shared/ui`) consume it, so only a downward
 * (`shared`) home keeps every importer legal under the FSD import-direction
 * rule. The 1-line clamp is inlined here rather than reused from
 * `shared/ui/scrub-math` to avoid a `lib -> ui` edge.
 */

/** Persisted/runtime width of both resizable side panels, in CSS px. */
export type PanelWidths = {
	readonly left: number;
	readonly right: number;
};

/** Default layers width — mirrors `--editor-left-panel-width` (src/app/styles/index.css). */
export const DEFAULT_LEFT_PANEL_WIDTH = 228;
/** Default inspector width — mirrors `--editor-right-panel-width` (src/app/styles/index.css). */
export const DEFAULT_RIGHT_PANEL_WIDTH = 244;
/**
 * Resize band shared by both panels. Product-tunable ergonomics, NOT a verified
 * Figma constant: wide enough that content stays legible at MIN and the canvas
 * is never starved at MAX.
 */
export const PANEL_WIDTH_MIN = 192;
export const PANEL_WIDTH_MAX = 480;

/** localStorage key for the persisted pair (matches the app scene/motion key convention). */
export const PANEL_WIDTH_STORAGE_KEY = "vector-motion-author:panel-widths:v1";

/** Clamp a width into the resizable band; non-finite input falls back to MIN. */
export function clampPanelWidth(width: number): number {
	if (!Number.isFinite(width)) return PANEL_WIDTH_MIN;
	return Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, width));
}

/**
 * Resolve the next panel width from a drag delta. `growDirection` is `+1` for a
 * left-anchored panel (widens as the pointer moves right) and `-1` for a
 * right-anchored panel (widens as the pointer moves left), so the inspector's
 * inverted edge is a sign — not a special case.
 */
export function nextPanelWidth(
	startWidth: number,
	dx: number,
	growDirection: 1 | -1,
): number {
	return clampPanelWidth(startWidth + growDirection * dx);
}

const DEFAULT_PANEL_WIDTHS: PanelWidths = {
	left: DEFAULT_LEFT_PANEL_WIDTH,
	right: DEFAULT_RIGHT_PANEL_WIDTH,
};

const resolveWidth = (value: unknown, fallback: number): number =>
	typeof value === "number" && Number.isFinite(value)
		? clampPanelWidth(value)
		: fallback;

/**
 * Parse a persisted payload into a clamped width pair. NEVER throws: malformed
 * JSON, a non-object, missing fields, NaN, or out-of-range values all fall back
 * to (and are clamped toward) the defaults. A throw here would white-screen the
 * SPA on reload, since this runs synchronously at store creation.
 */
export function hydratePanelWidths(raw: string | null): PanelWidths {
	if (raw === null) return DEFAULT_PANEL_WIDTHS;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (parsed === null || typeof parsed !== "object") {
			return DEFAULT_PANEL_WIDTHS;
		}
		const record = parsed as Record<string, unknown>;
		return {
			left: resolveWidth(record.left, DEFAULT_LEFT_PANEL_WIDTH),
			right: resolveWidth(record.right, DEFAULT_RIGHT_PANEL_WIDTH),
		};
	} catch {
		return DEFAULT_PANEL_WIDTHS;
	}
}

/** Serialize a width pair for persistence. */
export function serializePanelWidths(widths: PanelWidths): string {
	return JSON.stringify({ left: widths.left, right: widths.right });
}
