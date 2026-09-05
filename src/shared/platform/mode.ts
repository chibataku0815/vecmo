/**
 * Build-time platform mode for the open-core split.
 *
 * The public (AGPL) build ships as a pure local editor: no commercial UI and no
 * `/api/*` traffic on load. The private build sets `VITE_VECMO_PLATFORM=cloud`
 * and is behaviorally unchanged. This is one build-time constant on purpose —
 * there is no runtime probing and no settings surface that can flip it.
 */
export type PlatformMode = "local" | "cloud";

export const PLATFORM_MODE: PlatformMode =
	import.meta.env.VITE_VECMO_PLATFORM === "cloud" ? "cloud" : "local";

const cloudEnabled = PLATFORM_MODE === "cloud";

/**
 * Capability flags consumed as `platformCapabilities.X && <surface />` at the
 * hook-option or JSX level. Every flag is the same constant today; they stay
 * separate so a future build variant can narrow one surface without a refactor.
 */
export const platformCapabilities = Object.freeze({
	/** Cloud project open/save/autosave, writer lease, revision history. */
	cloudProjects: cloudEnabled,
	/** Account bootstrap, sign in/out, account menu. */
	account: cloudEnabled,
	/** Billing entry, checkout, subscription management. */
	billing: cloudEnabled,
	/** Motion Copilot server planner (`/api/agent/plan`). */
	copilotServerPlanner: cloudEnabled,
	/** Production agent-bridge session endpoint (local relay is unaffected). */
	productionAgentBridge: cloudEnabled,
});
