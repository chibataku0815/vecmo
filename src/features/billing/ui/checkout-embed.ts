/**
 * Thin, side-effecting wrapper over Polar's official embedded-checkout library.
 *
 * This is the ONLY module that imports `@polar-sh/checkout`, and it imports the
 * `embed` entry **dynamically** so the browser bundle keeps the library in its
 * own async chunk instead of the main editor entry. The library is browser-only
 * (its sole dependency is `date-fns`); the post-build bundle grep
 * (`scripts/check-bundle.ts`) proves it pulls in no Worker/server packages.
 *
 * The library's `create()` injects a fullscreen iframe over the page and posts
 * messages back from `https://polar.sh` / `https://sandbox.polar.sh`. Its default
 * `success` handler navigates the top window to the checkout's `successURL`; we
 * call `preventDefault()` on that event so the editor tab is never unloaded and
 * finalization stays in-app. Because `create()` only ever resolves (on the
 * iframe's `loaded` event) and never rejects, a blocked or never-loading iframe
 * would hang forever and leave the injected DOM behind — so we race it against a
 * timeout and tear the injected DOM down on failure.
 */

/** Subset of the library instance this module drives. */
type EmbedInstance = {
	close: () => void;
	addEventListener: (
		type: "success" | "close" | "confirmed" | "loaded",
		listener: (event: Event) => void,
		options?: AddEventListenerOptions | boolean,
	) => void;
};

/** Handle the caller uses to dismiss the iframe (e.g. after a settled poll). */
export type EmbeddedCheckoutHandle = {
	readonly close: () => void;
};

/** Lifecycle callbacks; all are invoked on the main thread. */
export type EmbeddedCheckoutHandlers = {
	/** Checkout completed. We suppress the default off-domain redirect first. */
	readonly onSuccess: () => void;
	/** User closed the iframe without completing (or it self-closed). */
	readonly onClose: () => void;
	/** Payment confirmed; the iframe locks itself closed while it processes. */
	readonly onConfirmed?: () => void;
};

/** Upper bound on how long we wait for the iframe's `loaded` event. */
const EMBED_LOAD_TIMEOUT_MS = 15_000 as const;

/**
 * Best-effort removal of the DOM the library injects (a fullscreen iframe, a
 * loader spinner, and a `polar-no-scroll` body class). Used only when `create()`
 * times out and never handed us an instance to `close()`.
 */
const teardownInjectedEmbed = (): void => {
	if (typeof document === "undefined") return;
	document.body.classList.remove("polar-no-scroll");
	for (const iframe of Array.from(document.querySelectorAll("iframe"))) {
		const src = iframe.getAttribute("src") ?? "";
		if (src.includes("polar.sh") && src.includes("embed=true")) {
			iframe.remove();
		}
	}
	for (const spinner of Array.from(
		document.querySelectorAll(".polar-loader-spinner"),
	)) {
		spinner.parentElement?.remove();
	}
};

const withLoadTimeout = (
	created: Promise<EmbedInstance>,
	timeoutMs: number,
): Promise<EmbedInstance> =>
	new Promise<EmbedInstance>((resolve, reject) => {
		const timer = setTimeout(() => {
			teardownInjectedEmbed();
			reject(new Error("Embedded checkout timed out while loading."));
		}, timeoutMs);
		created.then(
			(instance) => {
				clearTimeout(timer);
				resolve(instance);
			},
			(error: unknown) => {
				clearTimeout(timer);
				teardownInjectedEmbed();
				reject(error instanceof Error ? error : new Error("Embed failed."));
			},
		);
	});

/**
 * Opens Polar's embedded checkout iframe for a checkout URL and wires its
 * lifecycle to the supplied handlers.
 *
 * Throws if the async chunk fails to load or the iframe never loads within
 * {@link EMBED_LOAD_TIMEOUT_MS}; callers treat a throw as "embed unavailable" and
 * fall back to a clickable hosted-checkout affordance (a fresh user gesture),
 * never an auto-opened popup or a top-level redirect.
 */
export async function openEmbeddedCheckout(
	url: string,
	handlers: EmbeddedCheckoutHandlers,
): Promise<EmbeddedCheckoutHandle> {
	const { PolarEmbedCheckout } = await import("@polar-sh/checkout/embed");
	const checkout = await withLoadTimeout(
		PolarEmbedCheckout.create(url, {
			theme: "dark",
		}) as unknown as Promise<EmbedInstance>,
		EMBED_LOAD_TIMEOUT_MS,
	);

	checkout.addEventListener("success", (event) => {
		// Suppress the library default (top-window navigation to successURL) so the
		// editor tab stays on its own origin; we finalize in-app instead.
		event.preventDefault();
		handlers.onSuccess();
	});
	checkout.addEventListener("close", () => handlers.onClose());
	if (handlers.onConfirmed) {
		const onConfirmed = handlers.onConfirmed;
		checkout.addEventListener("confirmed", () => onConfirmed());
	}

	return { close: () => checkout.close() };
}
