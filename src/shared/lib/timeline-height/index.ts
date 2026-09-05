/**
 * Pure model for the user-resizable docked timeline ("Timeline mode"): the
 * expanded-height band, the clamp/ceiling math, and the localStorage codec.
 *
 * Mirrors `shared/lib/panel-width` and lives in `shared` for the same reason —
 * both the editor UI store (a feature) and the presentational resize handle
 * (`shared/ui`) consume it, so only a downward (`shared`) home keeps every
 * importer legal under the FSD import-direction rule.
 *
 * Height is persisted under its OWN key (not folded into the panel-width
 * payload) so adding the dimension never changes the `panel-widths:v1` blob
 * shape — an old blob without this key simply hydrates to the default.
 */

/**
 * Floor of the resizable band, in CSS px. Comfortably taller than the compact
 * float ceiling (176px) so entering the mode is always a visible jump, while
 * still keeping the h-10 header + h-9 clip lane + h-6 ruler + a few h-7 track
 * rows on screen.
 */
export const TIMELINE_HEIGHT_MIN = 220;
/**
 * Hard px ceiling stored/persisted. The *visual* ceiling is additionally capped
 * at {@link TIMELINE_HEIGHT_MAX_FRACTION} of the live viewport in CSS, so a tall
 * value persisted on a big monitor never strands the canvas on a small one.
 */
export const TIMELINE_HEIGHT_MAX_PX = 900;
/**
 * Fraction of the viewport the docked timeline may occupy. Keeps the canvas
 * visible (split-rebalance, never full-screen). Mirrors the `62svh` cap in the
 * `.timeline-mode .timeline-panel` rule (src/app/styles/index.css).
 */
export const TIMELINE_HEIGHT_MAX_FRACTION = 0.62;
/** Default expanded height — a solid ~mid-band dock that feels like a real mode on first toggle. */
export const DEFAULT_TIMELINE_HEIGHT = 460;

/** localStorage key for the persisted expanded height (matches the app key convention). */
export const TIMELINE_HEIGHT_STORAGE_KEY =
	"vector-motion-author:timeline-height:v1";

/** Clamp a height into the px band; non-finite input falls back to the default. */
export function clampTimelineHeight(height: number): number {
	if (!Number.isFinite(height)) return DEFAULT_TIMELINE_HEIGHT;
	return Math.min(
		TIMELINE_HEIGHT_MAX_PX,
		Math.max(TIMELINE_HEIGHT_MIN, height),
	);
}

/**
 * The effective drag ceiling for a given viewport height: the smaller of the
 * hard px cap and the viewport fraction, never below MIN. The resize wiring
 * computes this from `window.innerHeight` at wiring time so the divider stays
 * glued to the cursor while never letting the dock overrun the viewport.
 */
export function timelineHeightCeiling(viewportHeight: number): number {
	if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) {
		return TIMELINE_HEIGHT_MAX_PX;
	}
	const fractionCeiling = Math.round(
		viewportHeight * TIMELINE_HEIGHT_MAX_FRACTION,
	);
	return Math.max(
		TIMELINE_HEIGHT_MIN,
		Math.min(TIMELINE_HEIGHT_MAX_PX, fractionCeiling),
	);
}

/**
 * Parse a persisted payload into a clamped height. NEVER throws: malformed JSON,
 * a non-object, a missing field, NaN, or out-of-range all fall back to (and are
 * clamped toward) the default. A throw here would white-screen the SPA on
 * reload, since this runs synchronously at store creation.
 */
export function hydrateTimelineHeight(raw: string | null): number {
	if (raw === null) return DEFAULT_TIMELINE_HEIGHT;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (parsed === null || typeof parsed !== "object") {
			return DEFAULT_TIMELINE_HEIGHT;
		}
		const record = parsed as Record<string, unknown>;
		const value = record.height;
		return typeof value === "number" && Number.isFinite(value)
			? clampTimelineHeight(value)
			: DEFAULT_TIMELINE_HEIGHT;
	} catch {
		return DEFAULT_TIMELINE_HEIGHT;
	}
}

/** Serialize the expanded height for persistence. */
export function serializeTimelineHeight(height: number): string {
	return JSON.stringify({ height });
}
