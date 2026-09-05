import { createContext, useContext } from "react";

/**
 * The `Window` a React subtree is hosted in. `null` means "the opener" — the
 * default ambient `window`. {@link DetachedWindow} sets this to the popup's
 * window for the detached subtree it renders into a separate OS window, so
 * descendants that touch a real-realm global (portal containers, focus/blur
 * listeners, viewport measurements) target the window they actually live in
 * rather than the opener.
 *
 * Components in the opener tree get no provider, so {@link useTargetWindow}
 * falls back to the global `window` — making every consumer output-equivalent
 * when docked.
 */
export const TargetWindowContext = createContext<Window | null>(null);

/** The `Window` hosting this subtree (popup when detached, else the opener). */
export function useTargetWindow(): Window {
	return useContext(TargetWindowContext) ?? window;
}
