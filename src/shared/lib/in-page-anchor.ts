import { type RefObject, useEffect, useRef } from "react";

/**
 * Makes same-page `#hash` links scroll an internal overflow scroll container.
 *
 * The public pages are full-height internal scroll containers
 * (`h-svh` + `overflow-y-auto`) because the global `body { overflow: hidden }`
 * rule (needed by the editor) disables document scrolling. Native anchor
 * navigation only scrolls the *document*, so it cannot bring a target into view
 * inside such a container — directory, table-of-contents, and footer `#hash`
 * links would no-op.
 *
 * Attach the returned ref to the scroll container. A native `click` listener
 * intercepts plain left-clicks on same-page anchors and scrolls the container to
 * the target. It positions the container with explicit `scrollTo` math (rather
 * than `element.scrollIntoView`, which is unreliable for a nested scroll
 * container behind a sticky header) and subtracts the target's computed
 * `scroll-margin-top` so the sticky header does not overlap it. A native listener
 * (rather than a JSX `onClick` on the container) keeps keyboard activation
 * working — pressing Enter on a focused `<a>` fires a real click that bubbles
 * here — without a non-interactive-element click handler.
 *
 * Modified clicks (new tab/window) and non-hash links are left to the browser.
 */
export function useInPageAnchorScroll<
	T extends HTMLElement,
>(): RefObject<T | null> {
	const ref = useRef<T>(null);
	useEffect(() => {
		const node = ref.current;
		if (!node) return;
		const onClick = (event: MouseEvent): void => {
			if (event.defaultPrevented) return;
			if (
				event.button !== 0 ||
				event.metaKey ||
				event.ctrlKey ||
				event.shiftKey ||
				event.altKey
			) {
				return;
			}
			const target = event.target;
			if (!(target instanceof Element)) return;
			const anchor = target.closest('a[href^="#"]');
			const href = anchor?.getAttribute("href");
			if (!href || href === "#") return;
			const destination = document.getElementById(
				decodeURIComponent(href.slice(1)),
			);
			if (!destination) return;
			event.preventDefault();
			const marginTop =
				Number.parseFloat(getComputedStyle(destination).scrollMarginTop) || 0;
			const top =
				destination.getBoundingClientRect().top -
				node.getBoundingClientRect().top +
				node.scrollTop -
				marginTop;
			node.scrollTo({ top, behavior: "auto" });
			window.history.replaceState(null, "", href);
		};
		node.addEventListener("click", onClick);
		return () => node.removeEventListener("click", onClick);
	}, []);
	return ref;
}
