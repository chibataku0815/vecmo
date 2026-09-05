import { useTransportStore } from "@/features/motion/model/transport-store";

/**
 * Armed-Perform indicator (iPad Pencil-motion L3). Perform arms the next
 * Select-tool drag to be recorded as motion, which is otherwise an invisible
 * state with no exit — the exact "you entered a mode you can't leave" complaint.
 * This banner makes the armed state always visible and always escapable: it
 * shows whenever Perform is armed and offers an explicit Cancel (the keyboard
 * Escape exit stays widget-side in the canvas keydown handler, since key
 * dispatch is a canvas concern; both paths call the same `disarmPerform`).
 *
 * Reads `performing` straight from the transport store and renders nothing when
 * disarmed, so the canvas widget only has to mount it inside its overlay layer —
 * no prop wiring, no lifted state. It owns its own top-center placement.
 */
export function PerformIndicator() {
	const performing = useTransportStore((state) => state.performing);
	if (!performing) return null;
	return (
		// `top-20` (80px) clears the floating top bar (bottom edge ~58px, z-40 in a
		// sibling stacking context that paints above the canvas's z-0). At a smaller
		// offset the banner renders behind the top bar on desktop — present in the
		// DOM but occluded on screen, which silently re-creates the invisible armed
		// state this indicator exists to fix. 80px sits clear of the bar and still
		// reads as a top-center banner when the bar is hidden (iPad focus mode).
		<div className="pointer-events-auto absolute top-20 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-accent/30 bg-accent-surface/95 px-3 py-1.5 text-accent-fg shadow-lg shadow-scrim/40 backdrop-blur-xl">
			<span className="relative flex size-2 shrink-0">
				<span className="absolute inline-flex size-full animate-ping rounded-full bg-accent/60" />
				<span className="relative inline-flex size-2 rounded-full bg-accent" />
			</span>
			<span className="whitespace-nowrap font-medium text-ui">
				Perform: drag the object to record motion
			</span>
			<button
				type="button"
				className="shrink-0 rounded-md border border-hairline/20 bg-hairline/10 px-2 py-0.5 text-fg-secondary text-ui transition hover:border-danger/40 hover:bg-danger-surface/50 hover:text-danger-fg"
				onClick={() => useTransportStore.getState().disarmPerform()}
			>
				Cancel
			</button>
		</div>
	);
}
