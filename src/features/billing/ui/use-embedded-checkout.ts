import { useCallback, useEffect, useRef, useState } from "react";
import {
	createEmbeddedCheckoutSession,
	createHostedCheckoutUrl,
	pollBillingStatusUntil,
} from "../model/api";
import type { BillingStatus, UpgradeTargetPlan } from "../model/types";
import {
	type EmbeddedCheckoutHandle,
	openEmbeddedCheckout,
} from "./checkout-embed";

/**
 * Lifecycle of an in-app embedded checkout, surfaced to the TopBar account UI.
 *
 * `active` is the only state where the fullscreen Polar iframe covers the page;
 * every other non-idle state renders as a small status host the editor shows over
 * its own chrome so the user always sees feedback after the iframe closes.
 */
export type CheckoutFlowState =
	| { readonly kind: "idle" }
	| { readonly kind: "starting" }
	| { readonly kind: "active" }
	| { readonly kind: "finalizing" }
	| { readonly kind: "completed"; readonly plan: UpgradeTargetPlan }
	| { readonly kind: "pending" }
	| { readonly kind: "fallback"; readonly url: string }
	| { readonly kind: "error" };

export type EmbeddedCheckoutController = {
	readonly state: CheckoutFlowState;
	readonly start: (plan: UpgradeTargetPlan) => void;
	readonly dismiss: () => void;
};

const planReached =
	(plan: UpgradeTargetPlan) =>
	(status: BillingStatus): boolean =>
		status.plan === plan;

/**
 * Drives an embedded Polar checkout entirely within the editor tab.
 *
 * The flow never performs top-level navigation: it creates a Worker-owned
 * checkout session, opens Polar's official embedded iframe, suppresses the
 * library's default off-domain success redirect, then polls the webhook-backed
 * billing status until the plan flips ({@link pollBillingStatusUntil}). When the
 * embed library or iframe is unavailable it degrades to a clickable hosted
 * checkout affordance (`fallback`) rather than auto-opening a popup, which a
 * browser would block outside a fresh user gesture.
 *
 * `onSettled` runs after every finalize attempt (settled or webhook-lag pending)
 * so the caller can refresh its own account snapshot to reflect the new plan.
 * A monotonic run id guards against stale async transitions after a re-start,
 * dismissal, or unmount.
 */
export function useEmbeddedCheckout(
	onSettled: () => void,
): EmbeddedCheckoutController {
	const [state, setState] = useState<CheckoutFlowState>({ kind: "idle" });
	const handleRef = useRef<EmbeddedCheckoutHandle | null>(null);
	const pollAbortRef = useRef<AbortController | null>(null);
	const runIdRef = useRef(0);
	const mountedRef = useRef(true);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			runIdRef.current += 1;
			pollAbortRef.current?.abort();
			handleRef.current?.close();
			handleRef.current = null;
		};
	}, []);

	const setIf = useCallback((runId: number, next: CheckoutFlowState) => {
		if (mountedRef.current && runId === runIdRef.current) setState(next);
	}, []);

	const finalize = useCallback(
		async (plan: UpgradeTargetPlan, runId: number) => {
			setIf(runId, { kind: "finalizing" });
			handleRef.current?.close();
			handleRef.current = null;
			const controller = new AbortController();
			pollAbortRef.current = controller;
			const result = await pollBillingStatusUntil(planReached(plan), {
				signal: controller.signal,
			});
			onSettled();
			setIf(
				runId,
				result.settled ? { kind: "completed", plan } : { kind: "pending" },
			);
		},
		[onSettled, setIf],
	);

	const start = useCallback(
		(plan: UpgradeTargetPlan) => {
			runIdRef.current += 1;
			const runId = runIdRef.current;
			pollAbortRef.current?.abort();
			handleRef.current?.close();
			handleRef.current = null;
			setState({ kind: "starting" });

			void (async () => {
				const session = await createEmbeddedCheckoutSession(plan);
				if (runId !== runIdRef.current) return;
				if (session === null) {
					const hosted = await createHostedCheckoutUrl(plan);
					if (runId !== runIdRef.current) return;
					setIf(
						runId,
						hosted ? { kind: "fallback", url: hosted } : { kind: "error" },
					);
					return;
				}
				try {
					const handle = await openEmbeddedCheckout(session.checkout.url, {
						onSuccess: () => void finalize(plan, runId),
						onClose: () => {
							if (runId !== runIdRef.current) return;
							// A user-dismissed open iframe returns to idle. A programmatic
							// close from finalize does not reach here (the library's close()
							// removes its message listener without re-dispatching `close`).
							setState((current) =>
								current.kind === "active" ? { kind: "idle" } : current,
							);
						},
					});
					if (runId !== runIdRef.current) {
						handle.close();
						return;
					}
					handleRef.current = handle;
					setIf(runId, { kind: "active" });
				} catch {
					// Embed chunk failed to load or the iframe never loaded within the
					// timeout: offer the hosted URL as a clickable affordance instead of
					// an auto-opened (and thus blocked) popup.
					setIf(runId, { kind: "fallback", url: session.checkout.url });
				}
			})();
		},
		[finalize, setIf],
	);

	const dismiss = useCallback(() => {
		runIdRef.current += 1;
		pollAbortRef.current?.abort();
		pollAbortRef.current = null;
		handleRef.current?.close();
		handleRef.current = null;
		setState({ kind: "idle" });
	}, []);

	return { state, start, dismiss };
}
