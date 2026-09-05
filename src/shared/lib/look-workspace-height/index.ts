/**
 * Pure model for the resizable docked Look Graph workspace height.
 *
 * The workspace is bottom-anchored like the expanded timeline, but its default
 * stays compact so it can coexist with the editor canvas until the user chooses
 * to grow it. Height is editor chrome state only; scene and motion history never
 * observe it.
 */

/** Minimum useful dock height: enough for header, palette search, and node stage. */
export const LOOK_WORKSPACE_HEIGHT_MIN = 300;
/** Hard persisted px ceiling; CSS also caps the visible height by viewport. */
export const LOOK_WORKSPACE_HEIGHT_MAX_PX = 980;
/** Viewport fraction cap mirrored by the `.look-workspace-panel` CSS rule. */
export const LOOK_WORKSPACE_HEIGHT_MAX_FRACTION = 0.78;
/** Default dock height used until the user resizes or resets the workspace. */
export const DEFAULT_LOOK_WORKSPACE_HEIGHT = 380;
/** One-click expanded height target; still clamped by live viewport height. */
export const LOOK_WORKSPACE_EXPANDED_HEIGHT = 720;

/** localStorage key for the persisted Look workspace height. */
export const LOOK_WORKSPACE_HEIGHT_STORAGE_KEY =
	"vector-motion-author:look-workspace-height:v1";

/** Clamp a persisted or drag-produced height into the stable px band. */
export function clampLookWorkspaceHeight(height: number): number {
	if (!Number.isFinite(height)) return DEFAULT_LOOK_WORKSPACE_HEIGHT;
	return Math.min(
		LOOK_WORKSPACE_HEIGHT_MAX_PX,
		Math.max(LOOK_WORKSPACE_HEIGHT_MIN, height),
	);
}

/**
 * Effective drag ceiling for a viewport. The returned value never drops below
 * the minimum, so the splitter remains operable on short viewports.
 */
export function lookWorkspaceHeightCeiling(viewportHeight: number): number {
	if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) {
		return LOOK_WORKSPACE_HEIGHT_MAX_PX;
	}
	const fractionCeiling = Math.round(
		viewportHeight * LOOK_WORKSPACE_HEIGHT_MAX_FRACTION,
	);
	return Math.max(
		LOOK_WORKSPACE_HEIGHT_MIN,
		Math.min(LOOK_WORKSPACE_HEIGHT_MAX_PX, fractionCeiling),
	);
}

/** Parse the persisted workspace height payload without throwing during boot. */
export function hydrateLookWorkspaceHeight(raw: string | null): number {
	if (raw === null) return DEFAULT_LOOK_WORKSPACE_HEIGHT;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (parsed === null || typeof parsed !== "object") {
			return DEFAULT_LOOK_WORKSPACE_HEIGHT;
		}
		const value = (parsed as Record<string, unknown>).height;
		return typeof value === "number" && Number.isFinite(value)
			? clampLookWorkspaceHeight(value)
			: DEFAULT_LOOK_WORKSPACE_HEIGHT;
	} catch {
		return DEFAULT_LOOK_WORKSPACE_HEIGHT;
	}
}

/** Serialize the workspace height for localStorage persistence. */
export function serializeLookWorkspaceHeight(height: number): string {
	return JSON.stringify({ height });
}
