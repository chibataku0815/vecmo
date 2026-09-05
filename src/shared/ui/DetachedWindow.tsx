import { createElement, type ReactNode, useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TargetWindowContext } from "./target-window-context";

const DEFAULT_FEATURES = "popup=yes,width=1024,height=680";

/**
 * Solid backdrop behind the (translucent) detached chrome. Mirrors `--surface`
 * from the app theme so a `bg-surface-raised/92` panel composites the same way it
 * does floating over the editor canvas. Kept as a literal — the popup body is
 * styled imperatively before the cloned stylesheet's tokens are guaranteed live.
 */
const DETACHED_BACKDROP = "#191817";

const STYLE_SELECTOR = 'style, link[rel="stylesheet"]';

type DetachedWindowProps = {
	/** Title for the popup window (also its taskbar/tab label). */
	readonly title: string;
	/** `window.open` feature string; defaults to a sized popup. */
	readonly features?: string;
	/**
	 * Fired when the popup is gone — the user closed the OS window, the open was
	 * blocked, or the opener is unloading. The parent should flip its state so this
	 * component unmounts (its cleanup also `.close()`s the window).
	 */
	readonly onClose: () => void;
	readonly children: ReactNode;
};

const cloneStylesInto = (source: Document, target: Document): void => {
	for (const node of source.querySelectorAll(STYLE_SELECTOR)) {
		target.head.appendChild(node.cloneNode(true));
	}
};

const resyncStyles = (source: Document, target: Document): void => {
	for (const stale of target.head.querySelectorAll(STYLE_SELECTOR)) {
		stale.remove();
	}
	cloneStylesInto(source, target);
};

/**
 * Renders `children` into a real, separate OS window (`window.open`) using its
 * own React root. The own-root part is load-bearing: `createPortal` into another
 * window silently drops synthetic events because React's delegation listens on
 * the opener's document (facebook/react#18616), which would kill every click,
 * drag, and slider in the popup. A dedicated `createRoot` gives the popup native
 * event delegation, pointer capture, and focus.
 *
 * Live state is preserved for free: every rendered component still runs in the
 * opener's JS realm and reads the same Zustand store singletons, so an edit in
 * either window is reflected in both — that bidirectional sync is the whole point
 * of a detached Look workspace on a second monitor.
 *
 * Theming: the opener's stylesheets are cloned into the popup and kept current
 * via a `MutationObserver` (Vite injects and HMR-patches `<style>` nodes after
 * load), so the popup needs no separate CSS entry.
 *
 * This component renders nothing in the opener tree; it is a pure side-effect
 * host. Drive it declaratively — mount it to detach, unmount it to re-dock.
 */
export function DetachedWindow({
	title,
	features,
	onClose,
	children,
}: DetachedWindowProps) {
	// Latest callback / children read without retriggering the open-once effect.
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;
	const childrenRef = useRef(children);
	childrenRef.current = children;
	const rootRef = useRef<Root | null>(null);
	const popupWindowRef = useRef<Window | null>(null);

	useEffect(() => {
		const popup = window.open("", "", features ?? DEFAULT_FEATURES);
		if (!popup) {
			// Blocked (popup blocker / embedded runtime) or failed — report as a close
			// so the parent reverts to docked instead of leaving the user staring at a
			// no-op. Warn so the cause is diagnosable rather than silent.
			console.warn(
				`DetachedWindow: window.open was blocked for "${title}"; staying docked.`,
			);
			onCloseRef.current();
			return;
		}
		const doc = popup.document;
		doc.title = title;
		doc.documentElement.style.colorScheme = "dark";
		doc.documentElement.style.background = DETACHED_BACKDROP;
		doc.body.style.margin = "0";
		doc.body.style.height = "100vh";
		doc.body.style.background = DETACHED_BACKDROP;

		cloneStylesInto(window.document, doc);
		const styleObserver = new MutationObserver(() =>
			resyncStyles(window.document, doc),
		);
		// `characterData` catches Vite's in-place HMR text patches; `childList`
		// catches freshly injected/removed style nodes.
		styleObserver.observe(window.document.head, {
			childList: true,
			subtree: true,
			characterData: true,
		});

		const mount = doc.createElement("div");
		mount.style.height = "100%";
		doc.body.appendChild(mount);
		const root = createRoot(mount);
		rootRef.current = root;
		popupWindowRef.current = popup;
		// Provide the popup window so the detached subtree targets its OWN realm for
		// portal containers, focus/blur, and viewport measurements.
		root.render(
			createElement(
				TargetWindowContext.Provider,
				{ value: popup },
				childrenRef.current,
			),
		);

		const handlePopupClose = () => onCloseRef.current();
		popup.addEventListener("pagehide", handlePopupClose);
		const closePopup = () => popup.close();
		// Don't orphan the popup if the opener tab/window goes away.
		window.addEventListener("beforeunload", closePopup);

		return () => {
			// Remove the close listener before closing so our own teardown doesn't
			// re-enter onClose (which is already being driven by the unmount).
			popup.removeEventListener("pagehide", handlePopupClose);
			window.removeEventListener("beforeunload", closePopup);
			styleObserver.disconnect();
			root.unmount();
			rootRef.current = null;
			popupWindowRef.current = null;
			popup.close();
		};
	}, [title, features]);

	// Keep the popup tree current when `children` identity changes after mount.
	// The detached subtree is store-driven so it self-updates regardless, but this
	// keeps prop-level changes (e.g. a new element) honest.
	useEffect(() => {
		const target = popupWindowRef.current;
		if (!target) return;
		rootRef.current?.render(
			createElement(TargetWindowContext.Provider, { value: target }, children),
		);
	}, [children]);

	return null;
}
