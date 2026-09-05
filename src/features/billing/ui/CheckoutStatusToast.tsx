import {
	ArrowSquareOut,
	CheckCircle,
	CircleNotch,
	WarningCircle,
	X,
} from "@phosphor-icons/react";
import { createPortal } from "react-dom";
import { planLabel } from "../model/presentation";
import type { CheckoutFlowState } from "./use-embedded-checkout";

const TOAST_CLASS =
	"pointer-events-auto flex max-w-[min(92vw,360px)] items-start gap-2 rounded-lg border border-white/12 bg-surface-raised/98 px-3 py-2.5 text-fg text-ui shadow-2xl shadow-black/55 backdrop-blur-xl";

const DISMISS_CLASS =
	"-mr-1 -mt-0.5 ml-auto inline-flex size-5 shrink-0 items-center justify-center rounded text-fg-muted hover:bg-white/10 hover:text-fg focus-visible:outline focus-visible:outline-1 focus-visible:outline-white/55";

const LINK_CLASS =
	"mt-1.5 inline-flex h-6 items-center gap-1 rounded border border-accent/45 bg-accent-surface px-2 font-medium text-accent-fg text-ui leading-none hover:border-accent focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent/60";

type ToastContent = {
	readonly icon: typeof CheckCircle;
	readonly iconClass: string;
	readonly title: string;
	readonly detail: string;
	readonly spin?: boolean;
};

const contentFor = (state: CheckoutFlowState): ToastContent | null => {
	switch (state.kind) {
		case "starting":
			return {
				icon: CircleNotch,
				iconClass: "text-fg-muted",
				title: "Preparing checkout",
				detail: "Opening a secure checkout without leaving the editor.",
				spin: true,
			};
		case "finalizing":
			return {
				icon: CircleNotch,
				iconClass: "text-accent-fg",
				title: "Finalizing your upgrade",
				detail: "Confirming the payment with the billing provider.",
				spin: true,
			};
		case "completed":
			return {
				icon: CheckCircle,
				iconClass: "text-accent-fg",
				title: `You're on ${planLabel(state.plan)}`,
				detail: "Your new plan is active.",
			};
		case "pending":
			return {
				icon: CheckCircle,
				iconClass: "text-accent-fg",
				title: "Payment received",
				detail: "Refresh in a moment to see your new plan.",
			};
		case "error":
			return {
				icon: WarningCircle,
				iconClass: "text-danger-fg",
				title: "Checkout could not start",
				detail: "The editor is unaffected. Please try again.",
			};
		default:
			return null;
	}
};

/**
 * Always-visible status host for the embedded checkout flow.
 *
 * The Polar iframe covers the page only while the flow is `active`; once it
 * closes (success, dismissal, or failure) the popover and Manage dialog that
 * launched checkout may be gone, so this fixed toast — portalled to `body` above
 * the editor chrome — is where finalize/pending/fallback/error feedback lands.
 * It renders nothing while idle or while the iframe is on screen.
 */
export function CheckoutStatusToast({
	state,
	onDismiss,
}: {
	readonly state: CheckoutFlowState;
	readonly onDismiss: () => void;
}) {
	if (typeof document === "undefined") return null;
	if (state.kind === "idle" || state.kind === "active") return null;

	const dismissible =
		state.kind === "completed" ||
		state.kind === "pending" ||
		state.kind === "error" ||
		state.kind === "fallback";

	return createPortal(
		<div className="pointer-events-none fixed inset-x-0 bottom-4 z-[1000] flex justify-center px-4">
			{state.kind === "fallback" ? (
				<div className={TOAST_CLASS} role="status">
					<WarningCircle
						aria-hidden="true"
						className="mt-0.5 shrink-0 text-warn-fg"
						size={16}
					/>
					<div className="min-w-0">
						<p className="font-medium leading-4">Continue your upgrade</p>
						<p className="text-fg-muted leading-4">
							Checkout could not open in the editor. Open it in a new tab.
						</p>
						<a
							className={LINK_CLASS}
							href={state.url}
							rel="noopener noreferrer"
							target="_blank"
							onClick={onDismiss}
						>
							<ArrowSquareOut aria-hidden="true" size={12} />
							Open checkout
						</a>
					</div>
					<button
						aria-label="Dismiss"
						className={DISMISS_CLASS}
						onClick={onDismiss}
						type="button"
					>
						<X aria-hidden="true" size={12} />
					</button>
				</div>
			) : (
				<ContentToast
					state={state}
					dismissible={dismissible}
					onDismiss={onDismiss}
				/>
			)}
		</div>,
		document.body,
	);
}

function ContentToast({
	state,
	dismissible,
	onDismiss,
}: {
	readonly state: CheckoutFlowState;
	readonly dismissible: boolean;
	readonly onDismiss: () => void;
}) {
	const content = contentFor(state);
	if (content === null) return null;
	const Icon = content.icon;
	return (
		<div className={TOAST_CLASS} role="status">
			<Icon
				aria-hidden="true"
				className={`mt-0.5 shrink-0 ${content.iconClass} ${
					content.spin ? "animate-spin" : ""
				}`}
				size={16}
			/>
			<div className="min-w-0">
				<p className="font-medium leading-4">{content.title}</p>
				<p className="text-fg-muted leading-4">{content.detail}</p>
			</div>
			{dismissible ? (
				<button
					aria-label="Dismiss"
					className={DISMISS_CLASS}
					onClick={onDismiss}
					type="button"
				>
					<X aria-hidden="true" size={12} />
				</button>
			) : null}
		</div>
	);
}
