/**
 * Pure model for the resizable motion pane inside the Inspector. When a motion
 * clip is focused, the Inspector splits into two independently-scrolling panes —
 * the normal inspector on top, the clip's motion controls on the bottom — and
 * this module owns that bottom pane's height band, clamp/ceiling math, and the
 * localStorage codec.
 *
 * Mirrors `shared/lib/timeline-height` and lives in `shared` for the same
 * reason: both the editor UI store (a feature) and the presentational resize
 * handle (`shared/ui`) consume it, so only a downward (`shared`) home keeps
 * every importer legal under the FSD import-direction rule.
 *
 * Persisted under its OWN key so it never changes the shape of the panel-width
 * or timeline-height blobs — an old install without this key hydrates to the
 * default.
 */

/**
 * Floor of the band, in CSS px. Tall enough to show the motion section's sticky
 * header plus a couple of parameter rows so the pane is never a useless sliver.
 */
export const INSPECTOR_MOTION_HEIGHT_MIN = 140;
/**
 * Hard px ceiling stored/persisted. The *visual* ceiling is additionally capped
 * in CSS at 62% of the Inspector body so the normal pane always keeps ≥38%,
 * regardless of a tall value persisted on a big monitor.
 */
export const INSPECTOR_MOTION_HEIGHT_MAX_PX = 720;
/**
 * Fraction of the viewport the motion pane's drag ceiling may reach. The CSS
 * `max-height: 62%` is the real visual guard; this only bounds the persisted/
 * drag value so the divider stays glued to the cursor without absurd values.
 */
export const INSPECTOR_MOTION_HEIGHT_MAX_FRACTION = 0.6;
/** Default split height — a solid motion pane that reads as a real second pane on first focus. */
export const DEFAULT_INSPECTOR_MOTION_HEIGHT = 300;

/** localStorage key for the persisted motion-pane height (matches the app key convention). */
export const INSPECTOR_MOTION_HEIGHT_STORAGE_KEY =
	"vector-motion-author:inspector-motion-height:v1";

/** Clamp a height into the px band; non-finite input falls back to the default. */
export function clampInspectorMotionHeight(height: number): number {
	if (!Number.isFinite(height)) return DEFAULT_INSPECTOR_MOTION_HEIGHT;
	return Math.min(
		INSPECTOR_MOTION_HEIGHT_MAX_PX,
		Math.max(INSPECTOR_MOTION_HEIGHT_MIN, height),
	);
}

/**
 * The effective drag ceiling for a given viewport height: the smaller of the
 * hard px cap and the viewport fraction, never below MIN. The resize wiring
 * computes this from `window.innerHeight` at wiring time.
 */
export function inspectorMotionHeightCeiling(viewportHeight: number): number {
	if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) {
		return INSPECTOR_MOTION_HEIGHT_MAX_PX;
	}
	const fractionCeiling = Math.round(
		viewportHeight * INSPECTOR_MOTION_HEIGHT_MAX_FRACTION,
	);
	return Math.max(
		INSPECTOR_MOTION_HEIGHT_MIN,
		Math.min(INSPECTOR_MOTION_HEIGHT_MAX_PX, fractionCeiling),
	);
}

/**
 * Parse a persisted payload into a clamped height. NEVER throws: malformed JSON,
 * a non-object, a missing field, NaN, or out-of-range all fall back to (and are
 * clamped toward) the default. A throw here would white-screen the SPA on
 * reload, since this runs synchronously at store creation.
 */
export function hydrateInspectorMotionHeight(raw: string | null): number {
	if (raw === null) return DEFAULT_INSPECTOR_MOTION_HEIGHT;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (parsed === null || typeof parsed !== "object") {
			return DEFAULT_INSPECTOR_MOTION_HEIGHT;
		}
		const record = parsed as Record<string, unknown>;
		const value = record.height;
		return typeof value === "number" && Number.isFinite(value)
			? clampInspectorMotionHeight(value)
			: DEFAULT_INSPECTOR_MOTION_HEIGHT;
	} catch {
		return DEFAULT_INSPECTOR_MOTION_HEIGHT;
	}
}

/** Serialize the motion-pane height for persistence. */
export function serializeInspectorMotionHeight(height: number): string {
	return JSON.stringify({ height });
}
