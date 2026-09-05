/**
 * Pure model for the user-resizable Motion Copilot panel (Creator 2, C2-L2): the
 * width band, the clamp math, and the localStorage codec.
 *
 * Mirrors `shared/lib/panel-width` and lives in `shared` for the same reason —
 * both the editor UI store (a feature) and the presentational resize handle
 * (`shared/ui`) consume it, so only a downward (`shared`) home keeps every
 * importer legal under the FSD import-direction rule.
 *
 * Width is persisted under its OWN key (not folded into the panel-width payload)
 * so adding the dimension never changes the `panel-widths:v1` blob shape — an old
 * blob without this key simply hydrates to the default.
 *
 * The panel is a right-anchored vertical dock, so this is a width (not a height)
 * like the layers/inspector side panels.
 */

/** Default Motion Copilot width — mirrors `--editor-motion-copilot-width` (src/app/styles/index.css). */
export const DEFAULT_MOTION_COPILOT_WIDTH = 320;
/**
 * Resize band. Wide enough that plan cards (intent, steps, per-store counts,
 * warnings) stay legible at MIN, capped so the panel never starves the canvas at
 * MAX. Product-tunable ergonomics, not a verified design constant.
 */
export const MOTION_COPILOT_WIDTH_MIN = 260;
export const MOTION_COPILOT_WIDTH_MAX = 520;

/** localStorage key for the persisted width (matches the app key convention). */
export const MOTION_COPILOT_WIDTH_STORAGE_KEY =
	"vector-motion-author:motion-copilot-width:v1";

/** Clamp a width into the band; non-finite input falls back to the default. */
export function clampMotionCopilotWidth(width: number): number {
	if (!Number.isFinite(width)) return DEFAULT_MOTION_COPILOT_WIDTH;
	return Math.min(
		MOTION_COPILOT_WIDTH_MAX,
		Math.max(MOTION_COPILOT_WIDTH_MIN, width),
	);
}

/**
 * Parse a persisted payload into a clamped width. NEVER throws: malformed JSON,
 * a non-object, a missing field, NaN, or out-of-range all fall back to (and are
 * clamped toward) the default. A throw here would white-screen the SPA on
 * reload, since this runs synchronously at store creation.
 */
export function hydrateMotionCopilotWidth(raw: string | null): number {
	if (raw === null) return DEFAULT_MOTION_COPILOT_WIDTH;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (parsed === null || typeof parsed !== "object") {
			return DEFAULT_MOTION_COPILOT_WIDTH;
		}
		const record = parsed as Record<string, unknown>;
		const value = record.width;
		return typeof value === "number" && Number.isFinite(value)
			? clampMotionCopilotWidth(value)
			: DEFAULT_MOTION_COPILOT_WIDTH;
	} catch {
		return DEFAULT_MOTION_COPILOT_WIDTH;
	}
}

/** Serialize the width for persistence. */
export function serializeMotionCopilotWidth(width: number): string {
	return JSON.stringify({ width });
}
