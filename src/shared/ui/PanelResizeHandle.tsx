import {
	type KeyboardEvent,
	type PointerEvent as ReactPointerEvent,
	useEffect,
	useRef,
} from "react";
import { cn } from "@/shared/lib/cn";

/** Keyboard nudge step (px); Shift uses the coarse step. */
const PANEL_RESIZE_STEP_PX = 8;
const PANEL_RESIZE_COARSE_STEP_PX = 24;

/**
 * Orientation of the splitter BAR (WAI-ARIA semantics): a `vertical` bar runs
 * top-to-bottom and resizes WIDTH (the two side panels); a `horizontal` bar runs
 * left-to-right and resizes HEIGHT (the docked timeline). Default `vertical`
 * keeps the existing side-panel call sites byte-identical.
 */
export type PanelResizeOrientation = "vertical" | "horizontal";

export type PanelResizeHandleProps = {
	/** Accessible panel name, e.g. "Layers" / "Inspector" / "Timeline". */
	readonly panelName: string;
	/** Orientation of the splitter bar. Defaults to `vertical` (width resize). */
	readonly orientation?: PanelResizeOrientation;
	/**
	 * +1 for a panel whose far edge grows along the positive axis (left panel
	 * widens rightward / a top panel that grows downward); -1 for the inverse
	 * (right panel widens leftward / the bottom-anchored timeline that grows
	 * upward). The inverted edge is a sign — not a special case.
	 */
	readonly growDirection: 1 | -1;
	/**
	 * Non-reactive current-size read (store `getState`). Deliberately a getter,
	 * not a prop: a reactive prop would force the heavy panel body to subscribe
	 * to the size and re-render on every commit.
	 */
	readonly getCurrentWidth: () => number;
	readonly min: number;
	readonly max: number;
	/** Live drag tick — host writes the CSS var imperatively (no React state). */
	readonly onResizeTick: (size: number) => void;
	/** Gesture/keyboard commit — host sets store state + schedules persist. */
	readonly onResizeEnd: (size: number) => void;
	/** Double-click — host resets this panel to its default size. */
	readonly onReset: () => void;
};

/**
 * A thin draggable separator pinned to a panel's canvas-facing inner edge.
 *
 * Mirrors {@link ScrubSlider}'s gesture contract: pointerdown captures;
 * pointermove resolves the next size and writes it imperatively (rAF-coalesced)
 * through `onResizeTick` — NEVER React state, so the large panel bodies don't
 * re-render mid-drag; release flushes the final frame, then commits exactly once
 * via `onResizeEnd`. The gesture is sealed on pointercancel, lost capture, window
 * blur, and unmount so an interrupted drag still commits the size it reached,
 * keeping the committed store value and the imperative CSS var in sync.
 * Double-click resets; Arrow/Home/End give keyboard operability.
 *
 * The `vertical` bar resizes width via `clientX`; the `horizontal` bar resizes
 * height via `clientY`. Both share the entire gesture spine — only the axis,
 * cursor, edge, and keyboard keys differ. The clamp uses the `min`/`max` props
 * (not a hardcoded band) so the timeline's height band and the side panels'
 * width band both stay correct.
 *
 * The strip sits fully INSIDE the panel edge (no straddling translate) because
 * the panel asides are `overflow-hidden` — a half-outside strip would be clipped
 * to an unusably thin hit target.
 */
export function PanelResizeHandle({
	panelName,
	orientation = "vertical",
	growDirection,
	getCurrentWidth,
	min,
	max,
	onResizeTick,
	onResizeEnd,
	onReset,
}: PanelResizeHandleProps) {
	const separatorRef = useRef<HTMLDivElement>(null);
	const startPosRef = useRef(0);
	const startSizeRef = useRef(0);
	const latestSizeRef = useRef(0);
	const draggingRef = useRef(false);
	const rafRef = useRef<number | null>(null);
	const pendingRef = useRef<number | null>(null);

	const isVertical = orientation === "vertical";
	const clientPos = (event: ReactPointerEvent<HTMLDivElement>): number =>
		isVertical ? event.clientX : event.clientY;
	const clampSize = (value: number): number =>
		Math.min(max, Math.max(min, value));
	const sizeFromDelta = (delta: number): number =>
		clampSize(startSizeRef.current + growDirection * delta);

	const setAriaNow = (size: number) => {
		separatorRef.current?.setAttribute(
			"aria-valuenow",
			String(Math.round(size)),
		);
	};

	const flushTick = () => {
		if (rafRef.current !== null) {
			cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
		}
		if (pendingRef.current !== null) {
			onResizeTick(pendingRef.current);
			pendingRef.current = null;
		}
	};

	const scheduleTick = (next: number) => {
		latestSizeRef.current = next;
		setAriaNow(next);
		pendingRef.current = next;
		if (rafRef.current !== null) return;
		rafRef.current = requestAnimationFrame(() => {
			rafRef.current = null;
			if (pendingRef.current !== null) {
				onResizeTick(pendingRef.current);
				pendingRef.current = null;
			}
		});
	};

	const endGesture = () => {
		if (!draggingRef.current) return;
		flushTick();
		draggingRef.current = false;
		onResizeEnd(latestSizeRef.current);
	};

	// Hold the latest sealer so the mount-only listener always closes over the
	// current callbacks without resubscribing each render.
	const sealRef = useRef(endGesture);
	sealRef.current = endGesture;

	// Seal a drag interrupted by focus loss or unmount, so the committed store
	// size can never diverge from the last imperative CSS-var write.
	useEffect(() => {
		const seal = () => sealRef.current();
		window.addEventListener("blur", seal);
		return () => {
			window.removeEventListener("blur", seal);
			sealRef.current();
		};
	}, []);

	const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) return;
		const el = separatorRef.current;
		if (!el) return;
		try {
			el.setPointerCapture(event.pointerId);
		} catch {
			// Capture can fail on synthetic/edge pointers; element-level move
			// handlers still track the drag.
		}
		startPosRef.current = clientPos(event);
		startSizeRef.current = getCurrentWidth();
		latestSizeRef.current = startSizeRef.current;
		draggingRef.current = true;
	};

	const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (!draggingRef.current) return;
		const delta = clientPos(event) - startPosRef.current;
		scheduleTick(sizeFromDelta(delta));
	};

	const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
		const el = separatorRef.current;
		if (el?.hasPointerCapture(event.pointerId)) {
			try {
				el.releasePointerCapture(event.pointerId);
			} catch {
				// Releasing a capture that was never granted is harmless.
			}
		}
		endGesture();
	};

	const commitDiscrete = (size: number) => {
		latestSizeRef.current = size;
		setAriaNow(size);
		onResizeEnd(size);
	};

	const nudge = (delta: number) => {
		const base = getCurrentWidth();
		commitDiscrete(clampSize(base + growDirection * delta));
	};

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.repeat) return;
		const step = event.shiftKey
			? PANEL_RESIZE_COARSE_STEP_PX
			: PANEL_RESIZE_STEP_PX;
		const growKey = isVertical ? "ArrowRight" : "ArrowUp";
		const shrinkKey = isVertical ? "ArrowLeft" : "ArrowDown";
		if (event.key === growKey) {
			event.preventDefault();
			nudge(isVertical ? step : -step);
		} else if (event.key === shrinkKey) {
			event.preventDefault();
			nudge(isVertical ? -step : step);
		} else if (event.key === "Home") {
			event.preventDefault();
			commitDiscrete(min);
		} else if (event.key === "End") {
			event.preventDefault();
			commitDiscrete(max);
		}
	};

	const edge = isVertical
		? growDirection === 1
			? "right-0"
			: "left-0"
		: growDirection === 1
			? "bottom-0"
			: "top-0";

	return (
		// biome-ignore lint/a11y/useSemanticElements: a draggable, focusable window-splitter must be a div with role=separator + tabindex; <hr> is non-interactive and cannot carry the pointer/keyboard handlers (WAI-ARIA splitter pattern).
		<div
			ref={separatorRef}
			role="separator"
			aria-orientation={orientation}
			aria-label={`Resize ${panelName} panel`}
			aria-valuemin={min}
			aria-valuemax={max}
			aria-valuenow={Math.round(getCurrentWidth())}
			tabIndex={0}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerUp}
			onLostPointerCapture={onPointerUp}
			onKeyDown={onKeyDown}
			onDoubleClick={onReset}
			className={cn(
				"group absolute z-20 touch-none select-none outline-none",
				isVertical
					? "inset-y-0 w-[7px] cursor-ew-resize"
					: "inset-x-0 h-[7px] cursor-ns-resize",
				edge,
			)}
		>
			<div
				className={cn(
					"absolute bg-transparent transition-colors group-hover:bg-accent/60 group-focus-visible:bg-accent group-active:bg-accent",
					isVertical ? "inset-y-0 w-0.5" : "inset-x-0 h-0.5",
					edge,
				)}
			/>
		</div>
	);
}
