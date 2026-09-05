import { useEffect, useState } from "react";

/**
 * Web-owned description of whether the editor should use its iPad authoring
 * posture. This is not native editor state and must not be persisted.
 */
export type IpadAuthoringSurface = {
	readonly visible: boolean;
	readonly bridgeAvailable: boolean;
};

const IPAD_AUTHORING_MEDIA_QUERY = "(pointer: coarse) and (hover: none)";

type NativeBridgeHost = typeof globalThis & {
	readonly __vmaNativeBridge?: {
		readonly post?: (message: unknown) => void;
	};
};

/**
 * Detects the native iPad shell bridge without forcing the web editor to own
 * native state. The bridge remains an optional capability adapter.
 */
export const hasNativeBridge = (): boolean =>
	typeof (globalThis as NativeBridgeHost).__vmaNativeBridge?.post ===
	"function";

/**
 * Sends an optional message to the native iPad host. A false return keeps
 * callers on the normal web path when Vecmo is running in a browser.
 */
export const postNativeBridgeMessage = (message: unknown): boolean => {
	const post = (globalThis as NativeBridgeHost).__vmaNativeBridge?.post;
	if (typeof post !== "function") return false;
	post(message);
	return true;
};

/**
 * Reports browser capability observations back to the native host, so runtime
 * decisions are based on the actual WKWebView rather than Safari assumptions.
 */
export const postWebCapabilityProbe = (): boolean => {
	if (typeof navigator === "undefined") return false;
	return postNativeBridgeMessage({
		kind: "web-capability-probe",
		version: 1,
		hasPointerEvent:
			typeof window !== "undefined" &&
			typeof window.PointerEvent === "function",
		hasWebGPU: Boolean((navigator as Navigator & { gpu?: unknown }).gpu),
		userAgent: navigator.userAgent,
	});
};

const isIpadLikeNavigator = (): boolean => {
	if (typeof navigator === "undefined") return false;
	const userAgent = navigator.userAgent;
	return (
		/\biPad\b/.test(userAgent) ||
		(navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
	);
};

/**
 * Enables the iPad authoring posture for the native shell and for iPad-like
 * coarse-pointer surfaces. This is editor chrome state only: scene, viewport,
 * selection, and command history stay in their existing web stores.
 */
export function useIpadAuthoringSurface(): IpadAuthoringSurface {
	const [state, setState] = useState<IpadAuthoringSurface>({
		visible: false,
		bridgeAvailable: false,
	});

	useEffect(() => {
		if (typeof window === "undefined") return;
		const mediaQuery = window.matchMedia?.(IPAD_AUTHORING_MEDIA_QUERY);
		const update = () => {
			const bridgeAvailable = hasNativeBridge();
			const visible =
				bridgeAvailable ||
				(isIpadLikeNavigator() && (mediaQuery?.matches ?? false));
			setState((previous) =>
				previous.visible === visible &&
				previous.bridgeAvailable === bridgeAvailable
					? previous
					: { visible, bridgeAvailable },
			);
		};

		update();
		const bridgeProbeTimer = window.setTimeout(update, 250);
		mediaQuery?.addEventListener("change", update);
		return () => {
			window.clearTimeout(bridgeProbeTimer);
			mediaQuery?.removeEventListener("change", update);
		};
	}, []);

	return state;
}
