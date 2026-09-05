/**
 * Thin, side-effecting wrapper over Polar's official on-domain payment-method
 * embed (`@polar-sh/checkout/payment-method`).
 *
 * Like {@link ./checkout-embed}, this is the ONLY module importing the embed's
 * `payment-method` entry, and it imports it **dynamically** so the browser bundle
 * keeps the library in its own async chunk. Polar's iframe renders the Stripe
 * card form and attaches the new card via the Customer Portal API internally —
 * the card data lives in Polar's iframe, never in this app.
 *
 * The library's `create()` injects a fullscreen iframe and posts messages back
 * from `*.polar.sh`. Its default `success` action navigates the top window (the
 * event is cancelable), so we call `preventDefault()` to keep the editor tab on
 * its own origin and finalize in-app. `create()` only ever resolves (on the
 * iframe's `loaded` event) and never rejects, so a blocked/never-loading iframe
 * would hang and leave the injected DOM behind — we race it against a timeout and
 * tear the injected DOM down on failure.
 */

/** Subset of the library instance this module drives. */
type EmbedInstance = {
	close: () => void;
	addEventListener: (
		type: "success" | "close" | "confirmed" | "loaded" | "error",
		listener: (event: Event) => void,
		options?: AddEventListenerOptions | boolean,
	) => void;
};

/** Handle the caller uses to dismiss the iframe. */
export type PaymentMethodEmbedHandle = {
	readonly close: () => void;
};

/** Lifecycle callbacks; all are invoked on the main thread. */
export type PaymentMethodEmbedHandlers = {
	/** Card attached. We suppress the default off-domain redirect first. */
	readonly onSuccess: () => void;
	/** User closed the iframe without completing (or it self-closed). */
	readonly onClose: () => void;
	/** Card submitted; the iframe locks itself closed while Stripe processes. */
	readonly onConfirmed?: () => void;
	/** The embed surfaced a typed failure (declined, 3DS failed, server error). */
	readonly onError?: () => void;
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
		if (src.includes("polar.sh")) iframe.remove();
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
			reject(new Error("Embedded payment method timed out while loading."));
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
 * Opens Polar's embedded payment-method iframe for a customer-session token and
 * wires its lifecycle to the supplied handlers.
 *
 * Throws if the async chunk fails to load or the iframe never loads within
 * {@link EMBED_LOAD_TIMEOUT_MS}; callers treat a throw as "embed unavailable" and
 * fall back to the hosted card-update popup (a fresh user gesture), never a
 * top-level redirect.
 */
export async function openPaymentMethodEmbed(
	sessionToken: string,
	handlers: PaymentMethodEmbedHandlers,
): Promise<PaymentMethodEmbedHandle> {
	const { PolarEmbedPaymentMethod } = await import(
		"@polar-sh/checkout/payment-method"
	);
	const embed = await withLoadTimeout(
		PolarEmbedPaymentMethod.create({
			sessionToken,
			theme: "dark",
		}) as unknown as Promise<EmbedInstance>,
		EMBED_LOAD_TIMEOUT_MS,
	);

	embed.addEventListener("success", (event) => {
		// Suppress the library default (top-window navigation) so the editor tab
		// stays on its own origin; we refresh the overview in-app instead.
		event.preventDefault();
		handlers.onSuccess();
	});
	embed.addEventListener("close", () => handlers.onClose());
	if (handlers.onConfirmed) {
		const onConfirmed = handlers.onConfirmed;
		embed.addEventListener("confirmed", () => onConfirmed());
	}
	if (handlers.onError) {
		const onError = handlers.onError;
		embed.addEventListener("error", () => onError());
	}

	return { close: () => embed.close() };
}
